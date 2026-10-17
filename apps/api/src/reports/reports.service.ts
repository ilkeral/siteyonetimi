import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  DOCUMENT_TYPE_LABELS,
  INCOME_STATEMENT_MAX_MONTHS,
  PAYMENT_CHANNELS,
  buildCashFlow,
  buildIncomeStatement,
  monthOf,
  monthRange,
  type AccrualRow,
  type CashMovement,
  maskName,
  maskNamesInText,
  maskPhone,
  scoreSegment,
  type PaymentChannel,
} from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { requireSiteId } from '../tenant/tenant.context';
import { LedgerService, toMinorDecimal } from '../finance/ledger.service';
import { PaymentScoreService } from './payment-score.service';

export interface StatementReportQuery {
  accountIds?: string[];
  from: Date;
  to: Date;
  /** Kapanış bakiyesi en az bu kadar borç (kuruş) */
  minDebtMinor?: number;
  /** Kapanış bakiyesi en az bu kadar alacak/avans (kuruş) */
  minCreditMinor?: number;
  sort: 'date' | 'number';
  mask: boolean;
}

export type AgingBucket = 'notDue' | 'd0_30' | 'd31_60' | 'd61_90' | 'd90';
export const AGING_BUCKETS: AgingBucket[] = ['notDue', 'd0_30', 'd31_60', 'd61_90', 'd90'];

const DAY_MS = 86_400_000;

function unitLabel(unit: { doorNumber: string; block: { name: string } | null }) {
  return unit.block ? `${unit.block.name} / ${unit.doorNumber}` : unit.doorNumber;
}

/**
 * RAPORLAR
 *
 * KVKK: `mask` açıkken kişi adları, telefonlar ve açıklamalarda geçen adlar
 * (`maskNamesInText` — Türkçe/ASCII duyarsız) maskelenir. Maskeleme sunucuda
 * yapılır; maskesiz veri istemciye hiç gönderilmez.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly ledger: LedgerService,
    private readonly scores: PaymentScoreService,
  ) {}

  private async site() {
    const site = await this.db.site.findUnique({
      where: { id: requireSiteId() },
      select: { name: true, city: true, district: true, address: true },
    });
    if (!site) throw new NotFoundException('Site bulunamadı');
    return site;
  }

  // -------------------------------------------------------- gelir-gider

  /**
   * Tahakkuk esaslı gelir-gider (kategori × ay) ve kasa+banka nakit durumu.
   * Ay sınırları sunucunun saat dilimine göredir (TZ, varsayılan İstanbul).
   */
  async incomeStatement(fromMonth: string, toMonth: string) {
    let months: string[];
    try {
      months = monthRange(fromMonth, toMonth);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    if (months.length > INCOME_STATEMENT_MAX_MONTHS) {
      throw new BadRequestException(`En fazla ${INCOME_STATEMENT_MAX_MONTHS} aylık rapor alınabilir`);
    }
    const [fy, fm] = fromMonth.split('-').map(Number);
    const [ty, tm] = toMonth.split('-').map(Number);
    const start = new Date(fy, fm - 1, 1);
    const end = new Date(ty, tm, 1); // bitiş ayının ertesi ayı (hariç)
    const cashAccounts = { type: { in: ['CASH' as const, 'BANK' as const] } };

    const [site, accrualEntries, opening, cashEntries] = await Promise.all([
      this.site(),
      // Tahakkuk/fatura hareketleri — kasa/banka bacağı sayılmaz (çift sayım olmasın)
      this.db.ledgerEntry.findMany({
        where: {
          date: { gte: start, lt: end },
          account: { type: { notIn: ['CASH', 'BANK'] } },
          document: {
            status: 'POSTED',
            type: { in: ['DUES_ACCRUAL', 'METER_DISTRIBUTION', 'LATE_FEE', 'INCOME', 'EXPENSE'] },
          },
        },
        select: {
          date: true,
          debit: true,
          credit: true,
          category: { select: { name: true } },
          document: { select: { type: true } },
        },
      }),
      this.db.ledgerEntry.aggregate({
        where: { date: { lt: start }, account: cashAccounts, document: { status: 'POSTED' } },
        _sum: { debit: true, credit: true },
      }),
      // Virman kasa↔banka iç harekettir, nakit akışına girmez
      this.db.ledgerEntry.findMany({
        where: {
          date: { gte: start, lt: end },
          account: cashAccounts,
          document: { status: 'POSTED', type: { not: 'TRANSFER' } },
        },
        select: { date: true, debit: true, credit: true, document: { select: { type: true } } },
      }),
    ]);

    const accrualRows: AccrualRow[] = accrualEntries.map((entry) => {
      const isExpense = entry.document.type === 'EXPENSE';
      const debit = toMinorDecimal(entry.debit);
      const credit = toMinorDecimal(entry.credit);
      return {
        kind: isExpense ? 'EXPENSE' : 'INCOME',
        label: entry.category?.name ?? DOCUMENT_TYPE_LABELS[entry.document.type],
        month: monthOf(entry.date),
        amountMinor: isExpense ? credit - debit : debit - credit,
      };
    });

    const movements: CashMovement[] = cashEntries.flatMap((entry) => {
      const label = DOCUMENT_TYPE_LABELS[entry.document.type];
      const month = monthOf(entry.date);
      const debit = toMinorDecimal(entry.debit);
      const credit = toMinorDecimal(entry.credit);
      return [
        ...(debit ? [{ direction: 'IN' as const, label, month, amountMinor: debit }] : []),
        ...(credit ? [{ direction: 'OUT' as const, label, month, amountMinor: credit }] : []),
      ];
    });

    const openingMinor = toMinorDecimal(opening._sum.debit) - toMinorDecimal(opening._sum.credit);

    return {
      site,
      from: fromMonth,
      to: toMonth,
      statement: buildIncomeStatement(accrualRows, months),
      cash: buildCashFlow(openingMinor, movements, months),
    };
  }

  // -------------------------------------------------------------- ekstre

  async statements(query: StatementReportQuery) {
    if (query.from > query.to) throw new BadRequestException('İlk tarih son tarihten sonra olamaz');

    const accounts = await this.db.account.findMany({
      where: {
        isActive: true,
        ...(query.accountIds?.length ? { id: { in: query.accountIds } } : { type: 'PERSON' }),
      },
      select: {
        id: true,
        name: true,
        type: true,
        person: {
          select: {
            firstName: true,
            lastName: true,
            phone: true,
            occupancies: {
              where: { OR: [{ endDate: null }, { endDate: { gte: query.from } }] },
              select: { unit: { select: { doorNumber: true, block: { select: { name: true } } } } },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    if (query.accountIds?.length && accounts.length !== new Set(query.accountIds).size) {
      throw new BadRequestException('Seçilen carilerden bazıları bulunamadı');
    }

    // Maskede açıklamalarda geçebilecek tüm adlar (ad soyad + yalnız soyad değil: yanlış pozitif olmasın)
    const names = accounts.flatMap((a) => [a.name, a.person ? `${a.person.firstName} ${a.person.lastName}` : null]).filter(Boolean) as string[];
    const text = (value: string | null) => (query.mask ? maskNamesInText(value, names) : (value ?? ''));

    const rows = [];
    for (const account of accounts) {
      const statement = await this.ledger.statement(account.id, query.from, query.to);
      const closing = statement.closingBalanceMinor;
      if (query.minDebtMinor !== undefined && closing < query.minDebtMinor) continue;
      if (query.minCreditMinor !== undefined && -closing < query.minCreditMinor) continue;
      if (!query.accountIds?.length && statement.lines.length === 0 && statement.openingBalanceMinor === 0) continue;

      const lines = [...statement.lines];
      if (query.sort === 'number') {
        // Yürüyen bakiye tarih sırasıyla hesaplandı; numaraya göre dizince yeniden toplanır
        lines.sort((a, b) => a.documentNumber.localeCompare(b.documentNumber, 'tr'));
        let running = statement.openingBalanceMinor;
        for (const line of lines) {
          running += line.debitMinor - line.creditMinor;
          line.balanceMinor = running;
        }
      }

      rows.push({
        accountId: account.id,
        name: query.mask ? maskName(account.name) : account.name,
        type: account.type,
        phone: account.person?.phone ? (query.mask ? maskPhone(account.person.phone) : account.person.phone) : null,
        units: account.person?.occupancies.map((o) => unitLabel(o.unit)) ?? [],
        openingBalanceMinor: statement.openingBalanceMinor,
        closingBalanceMinor: closing,
        totalDebitMinor: statement.totalDebitMinor,
        totalCreditMinor: statement.totalCreditMinor,
        lines: lines.map((line) => ({ ...line, description: text(line.description) })),
      });
    }

    return {
      site: await this.site(),
      from: query.from,
      to: query.to,
      masked: query.mask,
      generatedAt: new Date(),
      accounts: rows,
      totals: {
        debitMinor: rows.reduce((acc, r) => acc + r.totalDebitMinor, 0),
        creditMinor: rows.reduce((acc, r) => acc + r.totalCreditMinor, 0),
        closingMinor: rows.reduce((acc, r) => acc + r.closingBalanceMinor, 0),
      },
    };
  }

  // -------------------------------------------------------- yaşlandırma

  /** Borçlu kişilerin açık borçlarının vadeden bu yana geçen güne göre dağılımı */
  async aging(asOf: Date, mask: boolean, blockId?: string) {
    const accounts = await this.db.account.findMany({
      where: {
        type: 'PERSON',
        isActive: true,
        ...(blockId ? { person: { occupancies: { some: { unit: { blockId } } } } } : {}),
      },
      select: {
        id: true,
        name: true,
        person: {
          select: {
            phone: true,
            occupancies: {
              where: { OR: [{ endDate: null }, { endDate: { gte: asOf } }] },
              select: { unit: { select: { doorNumber: true, block: { select: { name: true } } } } },
            },
          },
        },
      },
    });

    const balances = await this.ledger.balancesOf(accounts.map((a) => a.id), asOf);
    const empty = () => Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as Record<AgingBucket, number>;
    const totals = empty();
    const rows = [];

    for (const account of accounts) {
      if ((balances.get(account.id) ?? 0) <= 0) continue;
      const buckets = empty();
      for (const item of await this.ledger.openItems(account.id)) {
        const due = item.dueDate ?? item.date;
        const days = Math.floor((asOf.getTime() - due.getTime()) / DAY_MS);
        const bucket: AgingBucket =
          days < 0 ? 'notDue' : days <= 30 ? 'd0_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90';
        buckets[bucket] += item.remainingMinor;
      }
      const total = AGING_BUCKETS.reduce((acc, b) => acc + buckets[b], 0);
      if (total === 0) continue;
      AGING_BUCKETS.forEach((b) => (totals[b] += buckets[b]));
      rows.push({
        accountId: account.id,
        name: mask ? maskName(account.name) : account.name,
        phone: account.person?.phone ? (mask ? maskPhone(account.person.phone) : account.person.phone) : null,
        units: account.person?.occupancies.map((o) => unitLabel(o.unit)) ?? [],
        buckets,
        totalMinor: total,
      });
    }

    rows.sort((a, b) => b.buckets.d90 - a.buckets.d90 || b.totalMinor - a.totalMinor);
    return {
      site: await this.site(),
      asOf,
      masked: mask,
      generatedAt: new Date(),
      rows,
      totals: { ...totals, totalMinor: AGING_BUCKETS.reduce((acc, b) => acc + totals[b], 0) },
    };
  }

  // ------------------------------------------------------- ödeme skoru

  async paymentScores(mask: boolean) {
    const site = await this.site();
    const latest = await this.db.sitePaymentScore.findFirst({ orderBy: { scoreDate: 'desc' } });
    if (!latest) {
      return { site, calculatedAt: null, summary: null, trend: [], benchmarks: await this.scores.benchmarks(site.city), people: [] };
    }

    const since = new Date(latest.scoreDate);
    since.setDate(since.getDate() - 180);
    const [people, trend, benchmarks] = await Promise.all([
      this.db.paymentScore.findMany({
        where: { scoreDate: latest.scoreDate },
        orderBy: { score: 'desc' },
        include: {
          person: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              occupancies: {
                where: { endDate: null },
                select: { unit: { select: { doorNumber: true, block: { select: { name: true } } } } },
              },
            },
          },
        },
      }),
      this.db.sitePaymentScore.findMany({
        where: { scoreDate: { gte: since } },
        orderBy: { scoreDate: 'asc' },
        select: { scoreDate: true, averageScore: true, scoredCount: true },
      }),
      this.scores.benchmarks(site.city),
    ]);

    const share = (channels: Record<PaymentChannel, number>) => {
      const total = PAYMENT_CHANNELS.reduce((acc, c) => acc + (channels[c] ?? 0), 0);
      return Object.fromEntries(PAYMENT_CHANNELS.map((c) => [c, total ? (channels[c] ?? 0) / total : 0])) as Record<PaymentChannel, number>;
    };

    return {
      site,
      calculatedAt: latest.scoreDate,
      summary: {
        averageScore: Number(latest.averageScore),
        scoredCount: latest.scoredCount,
        highCount: latest.highCount,
        midCount: latest.midCount,
        lowCount: latest.lowCount,
        channels: latest.channels as Record<PaymentChannel, number>,
        channelShares: share(latest.channels as Record<PaymentChannel, number>),
      },
      trend: trend.map((t) => ({ date: t.scoreDate, averageScore: Number(t.averageScore), scoredCount: t.scoredCount })),
      benchmarks,
      people: people.map((row) => {
        const fullName = `${row.person.firstName} ${row.person.lastName}`;
        const score = Number(row.score);
        return {
          personId: row.personId,
          name: mask ? maskName(fullName) : fullName,
          units: row.person.occupancies.map((o) => unitLabel(o.unit)),
          score,
          segment: scoreSegment(score),
          collectionRate: Number(row.collectionRate),
          avgDaysEarly: Number(row.avgDaysEarly),
          dueMinor: toMinorDecimal(row.dueAmount),
          lateFeeCollectedMinor: toMinorDecimal(row.lateFeeCollected),
          channelShares: share(row.channels as Record<PaymentChannel, number>),
        };
      }),
    };
  }

  /** Kişi kartı rozeti için: kişinin son skoru */
  async personScore(personId: string) {
    const row = await this.db.paymentScore.findFirst({
      where: { personId },
      orderBy: { scoreDate: 'desc' },
      select: { score: true, scoreDate: true, collectionRate: true, avgDaysEarly: true },
    });
    return row
      ? {
          score: Number(row.score),
          segment: scoreSegment(Number(row.score)),
          scoreDate: row.scoreDate,
          collectionRate: Number(row.collectionRate),
          avgDaysEarly: Number(row.avgDaysEarly),
        }
      : null;
  }
}
