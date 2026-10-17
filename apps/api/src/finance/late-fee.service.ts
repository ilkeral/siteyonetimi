import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { computeLateFee, toPeriod, type LateFeeMethod } from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { requireSiteId } from '../tenant/tenant.context';
import { LedgerService, decimal } from './ledger.service';

export interface LateFeeRow {
  accountId: string;
  accountName: string;
  documentId: string;
  documentNumber: string;
  dueDate: Date | null;
  principalMinor: number;
  overdueDays: number;
  overdueMonths: number;
  feeMinor: number;
  /** Bu dönem için tazminat zaten işlenmişse true */
  alreadyApplied: boolean;
}

/**
 * GECİKME TAZMİNATI
 *
 * Hesaplama `@sy/shared/computeLateFee` içindedir (saf fonksiyon, testli).
 * Bu servis yalnızca veriyi toplar ve sonucu evraka dönüştürür.
 *
 * Çift uygulama koruması: üretilen her LATE_FEE evrakı, kaynağı olan borç
 * evrakına `parentId` ile bağlanır ve `period` alanına hesap dönemi yazılır.
 * Aynı borç + aynı dönem için ikinci kez tazminat işlenmez.
 */
@Injectable()
export class LateFeeService {
  private readonly logger = new Logger('LateFee');

  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly ledger: LedgerService,
  ) {}

  /** Önizleme — hiçbir şey yazmaz */
  async preview(asOf: Date = new Date()): Promise<{ rows: LateFeeRow[]; totalMinor: number }> {
    const siteId = requireSiteId();
    const settings = await this.db.siteSettings.findUnique({ where: { siteId } });
    if (!settings) throw new NotFoundException('Site parametreleri bulunamadı');

    const rows: LateFeeRow[] = [];
    if (!settings.applyLateFee || settings.lateFeeMethod === 'NONE') {
      return { rows, totalMinor: 0 };
    }

    const period = toPeriod(asOf);

    // Vadesi geçmiş borcu olan kişi carileri
    const accounts = await this.db.account.findMany({
      where: { type: 'PERSON', isActive: true },
      select: { id: true, name: true },
    });

    // Bu dönem zaten tazminat işlenmiş borçlar
    const applied = await this.db.document.findMany({
      where: { type: 'LATE_FEE', period, status: 'POSTED' },
      select: { parentId: true },
    });
    const appliedParents = new Set(applied.map((d) => d.parentId).filter(Boolean) as string[]);

    // Sayaç paylaşım evrakları için tazminat dağıtımın kendi ayarına bağlıdır:
    // "Gecikme Tazminatı Uygula" kapalıysa işlenmez, başlama tarihi verildiyse
    // gecikme vadeden değil o tarihten sayılır.
    const meterRules = new Map(
      (
        await this.db.document.findMany({
          where: { type: 'METER_DISTRIBUTION', status: 'POSTED' },
          select: {
            id: true,
            meterDistribution: { select: { applyLateFee: true, lateFeeStartDate: true } },
          },
        })
      ).map((d) => [d.id, d.meterDistribution]),
    );

    for (const account of accounts) {
      const openItems = await this.ledger.openItems(account.id);

      for (const item of openItems) {
        // Tazminatın kendisine tazminat işlenmez
        if (item.type === 'LATE_FEE' || !item.dueDate) continue;

        let dueDate = item.dueDate;
        if (item.type === 'METER_DISTRIBUTION') {
          const rule = meterRules.get(item.documentId);
          if (!rule?.applyLateFee) continue;
          if (rule.lateFeeStartDate) dueDate = rule.lateFeeStartDate;
        }
        if (dueDate >= asOf) continue;

        const result = computeLateFee({
          principalMinor: item.remainingMinor,
          dueDate,
          asOf,
          method: settings.lateFeeMethod as LateFeeMethod,
          rate: Number(settings.lateFeeRate),
          graceDays: settings.lateFeeGraceDays,
        });
        if (result.amountMinor <= 0) continue;

        rows.push({
          accountId: account.id,
          accountName: account.name,
          documentId: item.documentId,
          documentNumber: item.number,
          dueDate: item.dueDate,
          principalMinor: item.remainingMinor,
          overdueDays: result.overdueDays,
          overdueMonths: result.overdueMonths,
          feeMinor: result.amountMinor,
          alreadyApplied: appliedParents.has(item.documentId),
        });
      }
    }

    return {
      rows,
      totalMinor: rows.filter((r) => !r.alreadyApplied).reduce((a, r) => a + r.feeMinor, 0),
    };
  }

  /** Tazminatları evraklaştırır (daha önce işlenenler atlanır) */
  async apply(asOf: Date = new Date()): Promise<{ created: number; totalMinor: number }> {
    const siteId = requireSiteId();
    const { rows } = await this.preview(asOf);
    const pending = rows.filter((r) => !r.alreadyApplied);
    if (pending.length === 0) return { created: 0, totalMinor: 0 };

    const period = toPeriod(asOf);
    const category = await this.db.category.findFirst({
      where: { kind: 'INCOME', name: 'Gecikme Tazminatı' },
      select: { id: true },
    });

    const firstNumber = await this.ledger.nextDocumentNumber('LATE_FEE', asOf);
    const prefix = firstNumber.slice(0, firstNumber.lastIndexOf('-') + 1);
    const startSeq = Number(firstNumber.slice(prefix.length));

    let totalMinor = 0;

    await this.db.$transaction(
      async (tx) => {
        for (const [index, row] of pending.entries()) {
          totalMinor += row.feeMinor;
          await tx.document.create({
            data: {
              siteId,
              type: 'LATE_FEE',
              status: 'POSTED',
              number: `${prefix}${String(startSeq + index).padStart(6, '0')}`,
              date: asOf,
              dueDate: asOf,
              period,
              parentId: row.documentId,
              description: `${row.documentNumber} nolu borç için gecikme tazminatı (${row.overdueDays} gün)`,
              totalAmount: decimal(row.feeMinor),
              entries: {
                create: [
                  {
                    siteId,
                    accountId: row.accountId,
                    categoryId: category?.id ?? null,
                    date: asOf,
                    debit: decimal(row.feeMinor),
                    credit: decimal(0),
                    description: 'Gecikme tazminatı',
                  },
                ],
              },
            },
          });
        }
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    this.logger.log(`${pending.length} adet gecikme tazminatı işlendi`);
    return { created: pending.length, totalMinor };
  }
}
