import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import {
  BENCHMARK_MIN_SITES,
  computePaymentScore,
  summarizeScores,
  type PaymentChannel,
  type PaymentScoreResult,
  type ScoreCredit,
  type ScoreDebt,
} from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { requireSiteId, runWithTenant, runWithoutTenant } from '../tenant/tenant.context';
import { decimal, toMinorDecimal } from '../finance/ledger.service';

const QUEUE = 'payment-scores';

/** Günün tarihi (saat bilgisi olmadan) — @db.Date alanı için */
function today(date = new Date()): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/**
 * ÖDEME SKORU — günlük anlık görüntü
 *
 * Hesap `@sy/shared/payment-score` içindedir; bu servis defterden borç ve
 * tahsilat olaylarını toplar, sonucu `PaymentScore` / `SitePaymentScore`
 * tablolarına yazar. Her gece 03:00'te (İstanbul) tüm siteler için çalışır;
 * yönetici "Şimdi hesapla" ile kendi sitesini anında yenileyebilir.
 */
@Injectable()
export class PaymentScoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PaymentScore');
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private readonly connections: Redis[] = [];

  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const connection = () => {
      const client = new Redis(this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379', {
        maxRetriesPerRequest: null,
      });
      this.connections.push(client);
      return client;
    };
    this.queue = new Queue(QUEUE, { connection: connection() });
    this.worker = new Worker(QUEUE, () => this.computeAllSites(), { connection: connection() });
    this.worker.on('failed', (_job, error) => this.logger.error(`Gece skor hesabı başarısız: ${error.message}`));

    // Tekrarlayan iş: aynı kimlikle upsert edilir, her açılışta çoğalmaz
    await this.queue.upsertJobScheduler(
      'daily',
      { pattern: '0 3 * * *', tz: this.config.get<string>('TZ') ?? 'Europe/Istanbul' },
      { name: 'compute-all' },
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
  }

  /** Tüm aktif siteler — her site kendi tenant bağlamında hesaplanır */
  async computeAllSites(asOf = new Date()) {
    const sites = await runWithoutTenant(() =>
      this.db.site.findMany({ where: { isActive: true }, select: { id: true } }),
    );
    let total = 0;
    for (const site of sites) {
      const result = await runWithTenant({ siteId: site.id }, () => this.computeSite(asOf));
      total += result.scoredCount;
    }
    this.logger.log(`${sites.length} site, ${total} kişi skorlandı`);
    return { sites: sites.length, scored: total };
  }

  /** Aktif sitenin bugünkü skorlarını hesaplar ve yazar (aynı gün tekrar çalışırsa üzerine yazar) */
  async computeSite(asOf = new Date()) {
    const siteId = requireSiteId();
    const scoreDate = today(asOf);

    const entries = await this.db.ledgerEntry.findMany({
      where: {
        account: { type: 'PERSON', personId: { not: null } },
        document: { status: 'POSTED' },
        date: { lte: asOf },
      },
      select: {
        debit: true,
        credit: true,
        date: true,
        account: { select: { personId: true } },
        document: { select: { id: true, type: true, date: true, dueDate: true, paymentChannel: true } },
      },
    });

    // Kişi → borç evrakları (evrak bazında toplanır) ve tahsilatlar
    const byPerson = new Map<string, { debts: Map<string, ScoreDebt>; credits: ScoreCredit[] }>();
    for (const entry of entries) {
      const personId = entry.account.personId!;
      const bucket = byPerson.get(personId) ?? { debts: new Map<string, ScoreDebt>(), credits: [] as ScoreCredit[] };
      byPerson.set(personId, bucket);

      const debit = toMinorDecimal(entry.debit);
      const credit = toMinorDecimal(entry.credit);
      if (debit > 0) {
        const existing = bucket.debts.get(entry.document.id);
        bucket.debts.set(entry.document.id, {
          id: entry.document.id,
          date: entry.document.date,
          dueDate: entry.document.dueDate,
          amountMinor: (existing?.amountMinor ?? 0) + debit,
          isLateFee: entry.document.type === 'LATE_FEE',
        });
      }
      if (credit > 0) {
        bucket.credits.push({
          date: entry.date,
          amountMinor: credit,
          channel: (entry.document.paymentChannel ?? 'OTHER') as PaymentChannel,
        });
      }
    }

    const results: { personId: string; result: PaymentScoreResult }[] = [];
    for (const [personId, data] of byPerson) {
      results.push({ personId, result: computePaymentScore([...data.debts.values()], data.credits, asOf) });
    }
    const scored = results.filter((r) => r.result.score !== null);
    const summary = summarizeScores(results.map((r) => r.result));

    await this.db.$transaction(
      async (tx) => {
        await tx.paymentScore.deleteMany({ where: { scoreDate } });
        if (scored.length > 0) {
          await tx.paymentScore.createMany({
            data: scored.map(({ personId, result }) => ({
              siteId,
              personId,
              scoreDate,
              score: result.score!,
              collectionRate: result.collectionRate,
              avgDaysEarly: result.avgDaysEarly,
              dueAmount: decimal(result.dueMinor),
              lateFeeCollected: decimal(result.lateFeeCollectedMinor),
              channels: result.channels,
            })),
          });
        }
        await tx.sitePaymentScore.deleteMany({ where: { scoreDate } });
        if (summary.averageScore !== null) {
          await tx.sitePaymentScore.create({
            data: {
              siteId,
              scoreDate,
              averageScore: summary.averageScore,
              scoredCount: summary.scoredCount,
              highCount: summary.highCount,
              midCount: summary.midCount,
              lowCount: summary.lowCount,
              channels: summary.channels,
            },
          });
        }
      },
      { timeout: 60_000 },
    );

    return { scoreDate, scoredCount: scored.length, averageScore: summary.averageScore };
  }

  /**
   * Siteler arası anonim kıyas: her sitenin en son ortalaması alınır.
   * En az BENCHMARK_MIN_SITES site yoksa döndürülmez (tek siteli "il
   * ortalaması" o sitenin verisini ifşa eder).
   */
  async benchmarks(city: string | null) {
    const latest = await runWithoutTenant(() =>
      this.db.$queryRaw<{ siteId: string; city: string | null; averageScore: string }[]>`
        SELECT DISTINCT ON (s."siteId") s."siteId", site."city", s."averageScore"::text AS "averageScore"
        FROM "SitePaymentScore" s JOIN "Site" site ON site."id" = s."siteId"
        WHERE site."isActive" = true
        ORDER BY s."siteId", s."scoreDate" DESC`,
    );
    const average = (rows: typeof latest) =>
      rows.length >= BENCHMARK_MIN_SITES
        ? Math.round((rows.reduce((acc, r) => acc + Number(r.averageScore), 0) / rows.length) * 10) / 10
        : null;
    const sameCity = city ? latest.filter((r) => r.city?.toLocaleLowerCase('tr') === city.toLocaleLowerCase('tr')) : [];
    return {
      city,
      cityAverage: average(sameCity),
      citySiteCount: sameCity.length,
      overallAverage: average(latest),
      overallSiteCount: latest.length,
      minimumSites: BENCHMARK_MIN_SITES,
    };
  }
}
