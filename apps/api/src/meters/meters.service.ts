import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { MeterType } from '@sy/db';
import {
  METER_TYPE_LABELS,
  calculateMeterDistribution,
  formatPeriodTR,
  periodToDate,
  toMinor,
  type MainMeterReadingsInput,
  type MeterDistributionInput,
  type MeterLineComponent,
  type UnitMeterReadingsInput,
} from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { currentUserId, requireSiteId } from '../tenant/tenant.context';
import { LedgerService, decimal, toMinorDecimal } from '../finance/ledger.service';
import { pickResponsible } from '../finance/dues.service';

export const METER_TYPES: MeterType[] = ['FUEL', 'HOT_WATER', 'COLD_WATER', 'COOLING', 'ELECTRIC'];

const COMPONENT_LABELS: Record<MeterLineComponent, string> = {
  HOT_WATER_ENERGY: 'sıcak su enerjisi',
  FIXED: 'sabit pay',
  VARIABLE: 'ısınma payı',
};

export interface MeterPreviewLine {
  type: MeterType;
  component: MeterLineComponent | null;
  label: string;
  consumption: number;
  amountMinor: number;
  estimated: boolean;
}

export interface MeterPreviewRow {
  unitId: string;
  label: string;
  personId: string | null;
  personName: string;
  liability: 'OWNER' | 'TENANT' | 'NONE';
  amountMinor: number;
  lines: MeterPreviewLine[];
}

function unitLabel(unit: { doorNumber: string; block: { name: string } | null }) {
  return unit.block ? `${unit.block.name} / ${unit.doorNumber}` : unit.doorNumber;
}

/** Sayaç değerleri para değildir; Decimal → number okunur (hesap motoru number ister) */
const num = (value: { toString(): string } | null | undefined) => (value == null ? 0 : Number(value.toString()));

/**
 * SAYAÇ PAYLAŞIMI — 4 adımlı sihirbazın arka ucu.
 *
 *   1. Taslak dağıtım (evrak bilgileri + parametreler)
 *   2. Ana sayaç okumaları ve fatura tutarları
 *   3. Daire okumaları (elle ya da Excel/CSV'den)
 *   4. Önizleme → onay: daire başına bir METER_DISTRIBUTION evrakı
 *
 * `MainMeterReading` / `UnitMeterReading` `siteId` taşımaz; Prisma eklentisi
 * onları filtreleyemez. Bu yüzden onlara **her erişim önce dağıtımı tenant
 * filtreli okuyarak** (`requireDistribution`) yapılır.
 */
@Injectable()
export class MetersService {
  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly ledger: LedgerService,
  ) {}

  // ------------------------------------------------------------------ okuma

  async list() {
    const rows = await this.db.meterDistribution.findMany({
      orderBy: { period: 'desc' },
      include: {
        _count: { select: { unitReadings: true } },
        mainReadings: { select: { type: true, skip: true } },
      },
    });
    const documentCounts = await this.db.document.groupBy({
      by: ['meterDistributionId'],
      where: { meterDistributionId: { in: rows.map((r) => r.id) }, status: 'POSTED' },
      _count: true,
    });
    const docs = new Map(documentCounts.map((d) => [d.meterDistributionId, d._count]));

    return rows.map((row) => ({
      id: row.id,
      period: row.period,
      periodLabel: formatPeriodTR(row.period),
      name: row.name,
      status: row.status,
      documentDate: row.documentDate,
      dueDate: row.dueDate,
      approvedAt: row.approvedAt,
      totalMinor: toMinorDecimal(row.totalAmount),
      types: row.mainReadings.filter((m) => !m.skip).map((m) => m.type),
      readingCount: row._count.unitReadings,
      documentCount: docs.get(row.id) ?? 0,
    }));
  }

  /**
   * Sihirbazın tüm verisi: parametreler, ana sayaçlar, daire okuma ızgarası
   * ve son onaylı dönemden gelen "önceki okuma" önerileri.
   */
  async get(id: string) {
    const distribution = await this.requireDistribution(id);
    const [main, readings, units, factors, suggestions] = await Promise.all([
      this.db.mainMeterReading.findMany({ where: { distributionId: id } }),
      this.db.unitMeterReading.findMany({ where: { distributionId: id } }),
      this.units(),
      this.factors(),
      this.suggestions(distribution.period),
    ]);

    const grid: Record<string, Record<string, { previousValue: number; currentValue: number; consumption: number; amountMinor: number; note: string | null }>> = {};
    for (const reading of readings) {
      grid[reading.type] ??= {};
      grid[reading.type][reading.unitId] = {
        previousValue: num(reading.previousValue),
        currentValue: num(reading.currentValue),
        consumption: num(reading.consumption),
        amountMinor: toMinorDecimal(reading.amount),
        note: reading.note,
      };
    }

    return {
      ...this.params(distribution),
      id: distribution.id,
      status: distribution.status,
      approvedAt: distribution.approvedAt,
      totalMinor: toMinorDecimal(distribution.totalAmount),
      periodLabel: formatPeriodTR(distribution.period),
      mainReadings: METER_TYPES.map((type) => {
        const row = main.find((m) => m.type === type);
        return row
          ? {
              type,
              readingDate: row.readingDate,
              previousValue: num(row.previousValue),
              currentValue: num(row.currentValue),
              invoiceAmountMinor: toMinorDecimal(row.invoiceAmount),
              skip: row.skip,
              saved: true,
            }
          : {
              type,
              readingDate: distribution.documentDate,
              previousValue: suggestions.main[type] ?? 0,
              currentValue: 0,
              invoiceAmountMinor: 0,
              skip: true,
              saved: false,
            };
      }),
      units: units.map((unit) => ({
        unitId: unit.id,
        label: unitLabel(unit),
        blockName: unit.block?.name ?? null,
        doorNumber: unit.doorNumber,
        area: unit.area ? Number(unit.area) : null,
        isExempt: unit.isExempt,
        factors: factors.get(unit.id) ?? {},
      })),
      readings: grid,
      suggestions: suggestions.units,
      suggestedFrom: suggestions.period,
    };
  }

  // ------------------------------------------------------------------ yazma

  async create(input: MeterDistributionInput) {
    const siteId = requireSiteId();
    await this.assertPeriodFree(input.period);
    await this.assertCategory(input.categoryId);

    return this.db.meterDistribution.create({
      data: { siteId, createdById: currentUserId(), ...this.paramData(input) },
      select: { id: true, period: true },
    });
  }

  async update(id: string, input: MeterDistributionInput) {
    const distribution = await this.requireDraft(id);
    if (input.period !== distribution.period) await this.assertPeriodFree(input.period);
    await this.assertCategory(input.categoryId);
    return this.db.meterDistribution.update({
      where: { id },
      data: this.paramData(input),
      select: { id: true, period: true },
    });
  }

  async saveMainReadings(id: string, input: MainMeterReadingsInput) {
    const distribution = await this.requireDraft(id);
    const provided = input.readings.map((r) => r.type);

    await this.db.$transaction(async (tx) => {
      await tx.mainMeterReading.deleteMany({
        where: { distributionId: id, type: { notIn: provided } },
      });
      for (const reading of input.readings) {
        if (reading.currentValue < reading.previousValue && !reading.skip) {
          throw new BadRequestException(
            `${METER_TYPE_LABELS[reading.type]} ana sayacının son okuması öncekinden küçük olamaz`,
          );
        }
        const data = {
          readingDate: reading.readingDate ?? distribution.documentDate,
          previousValue: reading.previousValue,
          currentValue: reading.currentValue,
          invoiceAmount: decimal(toMinor(reading.invoiceAmount)),
          skip: reading.skip,
        };
        await tx.mainMeterReading.upsert({
          where: { distributionId_type: { distributionId: id, type: reading.type } },
          create: { distributionId: id, type: reading.type, ...data },
          update: data,
        });
      }
    });
    return { saved: input.readings.length };
  }

  /**
   * Tek türün daire okumalarını kaydeder. Önceki okuma boş bırakılırsa son
   * onaylı dönemin son okuması alınır. `currentValue: null` okumayı siler.
   */
  async saveUnitReadings(id: string, input: UnitMeterReadingsInput) {
    const distribution = await this.requireDraft(id);

    // Daire kimlikleri istemciden gelir — bu siteye ait olduklarını doğrula
    const unitIds = [...new Set(input.readings.map((r) => r.unitId))];
    if (unitIds.length !== input.readings.length) {
      throw new BadRequestException('Aynı daire için birden çok okuma gönderildi');
    }
    const owned = await this.db.unit.count({ where: { id: { in: unitIds } } });
    if (owned !== unitIds.length) throw new BadRequestException('Okumalardaki bazı daireler bulunamadı');

    const [factors, suggestions, meters] = await Promise.all([
      this.factors(),
      this.suggestions(distribution.period),
      this.db.meter.findMany({
        where: { type: input.type, unitId: { in: unitIds }, isActive: true },
        select: { id: true, unitId: true },
      }),
    ]);
    const meterByUnit = new Map(meters.map((m) => [m.unitId!, m.id]));

    let saved = 0;
    let removed = 0;
    await this.db.$transaction(
      async (tx) => {
        for (const reading of input.readings) {
          const key = { distributionId: id, unitId: reading.unitId, type: input.type };
          if (reading.currentValue === null) {
            const result = await tx.unitMeterReading.deleteMany({ where: key });
            removed += result.count;
            continue;
          }
          const previousValue =
            reading.previousValue ?? suggestions.units[input.type]?.[reading.unitId] ?? 0;
          const factor = factors.get(reading.unitId)?.[input.type] ?? 1;
          const data = {
            previousValue,
            currentValue: reading.currentValue,
            // Geri giden sayaç burada 0; motor ayrıca uyarı üretir
            consumption: Math.max(0, (reading.currentValue - previousValue) * factor),
            note: reading.note ?? null,
            meterId: meterByUnit.get(reading.unitId) ?? null,
          };
          await tx.unitMeterReading.upsert({
            where: { distributionId_unitId_type: key },
            create: { ...key, ...data },
            update: data,
          });
          saved++;
        }
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    return { saved, removed };
  }

  /** Hesap motorunu çalıştırır; hiçbir şey yazmaz */
  async preview(id: string) {
    const distribution = await this.requireDistribution(id);
    const siteId = requireSiteId();
    const [settings, main, readings, units, factors] = await Promise.all([
      this.db.siteSettings.findUnique({ where: { siteId }, select: { duesLiabilityRule: true } }),
      this.db.mainMeterReading.findMany({ where: { distributionId: id } }),
      this.db.unitMeterReading.findMany({ where: { distributionId: id } }),
      this.units(),
      this.factors(),
    ]);
    if (!settings) throw new NotFoundException('Site parametreleri bulunamadı');

    const active = main.filter((m) => !m.skip);
    const warnings: string[] = [];
    if (active.length === 0) {
      warnings.push('Hesaplanacak ana sayaç yok. 2. adımda en az bir sayaç türü seçin.');
    }

    const result = calculateMeterDistribution(
      units.map((unit) => ({
        unitId: unit.id,
        label: unitLabel(unit),
        area: unit.area ? Number(unit.area) : null,
        isExempt: unit.isExempt,
      })),
      main.map((m) => ({
        type: m.type,
        previousValue: num(m.previousValue),
        currentValue: num(m.currentValue),
        invoiceAmountMinor: toMinorDecimal(m.invoiceAmount),
        skip: m.skip,
      })),
      readings.map((r) => ({
        unitId: r.unitId,
        type: r.type,
        previousValue: num(r.previousValue),
        currentValue: num(r.currentValue),
        factor: factors.get(r.unitId)?.[r.type] ?? 1,
      })),
      {
        waterInletTemp: num(distribution.waterInletTemp),
        waterOutletTemp: num(distribution.waterOutletTemp),
        fuelLowerHeatValue: num(distribution.fuelLowerHeatValue),
        waterPricingMethod: distribution.waterPricingMethod,
        waterUnitPriceMinor: toMinorDecimal(distribution.waterUnitPrice),
        fixedSharePercent: num(distribution.fixedSharePercent),
        penaltyPercent: num(distribution.penaltyPercent),
      },
    );
    warnings.push(...result.warnings);

    // Fatura tutarıyla dağıtılan toplamı karşılaştır (birim fiyatlı su faturadan bağımsızdır)
    for (const m of active) {
      const invoiceMinor = toMinorDecimal(m.invoiceAmount);
      const distributed = result.byType[m.type] ?? 0;
      const priced =
        distribution.waterPricingMethod === 'UNIT_PRICE' && (m.type === 'COLD_WATER' || m.type === 'HOT_WATER');
      if (!priced && invoiceMinor === 0) {
        warnings.push(`${METER_TYPE_LABELS[m.type]} için fatura tutarı girilmedi; bu tür dağıtılmadı.`);
      }
      if (priced && distributed === 0 && num(m.currentValue) - num(m.previousValue) > 0) {
        warnings.push(`${METER_TYPE_LABELS[m.type]} için birim fiyat girilmedi; bu tür dağıtılmadı.`);
      }
    }

    const referenceDate = periodToDate(distribution.period);
    const rows: MeterPreviewRow[] = [];
    for (const unit of units) {
      const amountMinor = result.byUnit[unit.id] ?? 0;
      if (amountMinor === 0) continue;
      const responsible = pickResponsible(unit.occupancies, referenceDate, settings.duesLiabilityRule);
      if (!responsible) {
        warnings.push(`${unitLabel(unit)} dairesinin sorumlusu bulunamadı; onay için kişi bağlayın.`);
      }
      rows.push({
        unitId: unit.id,
        label: unitLabel(unit),
        personId: responsible?.person.id ?? null,
        personName: responsible ? `${responsible.person.firstName} ${responsible.person.lastName}` : '—',
        liability: responsible ? responsible.role : 'NONE',
        amountMinor,
        lines: result.lines
          .filter((line) => line.unitId === unit.id && line.amountMinor > 0)
          .map((line) => ({
            type: line.type,
            component: line.component ?? null,
            label: line.component
              ? `${METER_TYPE_LABELS[line.type]} — ${COMPONENT_LABELS[line.component]}`
              : METER_TYPE_LABELS[line.type],
            consumption: line.consumption,
            amountMinor: line.amountMinor,
            estimated: line.estimated,
          })),
      });
    }

    return {
      id,
      period: distribution.period,
      periodLabel: formatPeriodTR(distribution.period),
      status: distribution.status,
      rows,
      totalMinor: result.totalMinor,
      byType: result.byType,
      commonConsumption: result.commonConsumption,
      unitCount: rows.length,
      warnings,
      /** Onayı engelleyen durumlar */
      blockers: [
        ...(rows.length === 0 ? ['Dağıtılacak tutar yok'] : []),
        ...rows.filter((r) => !r.personId).map((r) => `${r.label} dairesinin sorumlusu yok`),
      ],
    };
  }

  /**
   * Onay: her daireye bir METER_DISTRIBUTION evrakı, sorumlunun carisine
   * borç. Tamamı tek işlemde yazılır; işlenen evrak değiştirilmez, düzeltme
   * `revert` (evrakları iptal edip taslağa döndürme) ile yapılır.
   */
  async approve(id: string) {
    const siteId = requireSiteId();
    const distribution = await this.requireDraft(id);
    const preview = await this.preview(id);
    if (preview.blockers.length > 0) {
      throw new BadRequestException(`Onaylanamaz: ${preview.blockers.slice(0, 3).join('; ')}`);
    }

    const accounts = await this.db.account.findMany({
      where: { personId: { in: preview.rows.map((r) => r.personId!) }, type: 'PERSON' },
      select: { id: true, personId: true },
    });
    const accountByPerson = new Map(accounts.map((a) => [a.personId!, a.id]));
    const missing = preview.rows.filter((r) => !accountByPerson.has(r.personId!));
    if (missing.length > 0) {
      throw new BadRequestException(`${missing.length} kişinin cari hesabı yok. Önce cari hesapları oluşturun.`);
    }

    const firstNumber = await this.ledger.nextDocumentNumber('METER_DISTRIBUTION', distribution.documentDate);
    const prefix = firstNumber.slice(0, firstNumber.lastIndexOf('-') + 1);
    const startSeq = Number(firstNumber.slice(prefix.length));
    const description = distribution.name || `${formatPeriodTR(distribution.period)} dönemi sayaç paylaşımı`;

    // Daire × tür tutarları — okuma satırlarına sonuç olarak yazılır
    const amountByReading = new Map<string, number>();
    for (const row of preview.rows) {
      for (const line of row.lines) {
        const key = `${row.unitId}:${line.type}`;
        amountByReading.set(key, (amountByReading.get(key) ?? 0) + line.amountMinor);
      }
    }

    await this.db.$transaction(
      async (tx) => {
        for (const [index, row] of preview.rows.entries()) {
          const accountId = accountByPerson.get(row.personId!)!;
          await tx.document.create({
            data: {
              siteId,
              type: 'METER_DISTRIBUTION',
              status: 'POSTED',
              number: `${prefix}${String(startSeq + index).padStart(6, '0')}`,
              date: distribution.documentDate,
              dueDate: distribution.dueDate,
              period: distribution.period,
              description: distribution.documentNote || description,
              unitId: row.unitId,
              meterDistributionId: id,
              totalAmount: decimal(row.amountMinor),
              createdById: currentUserId(),
              entries: {
                create: row.lines.map((line) => ({
                  siteId,
                  accountId,
                  categoryId: distribution.categoryId,
                  unitId: row.unitId,
                  date: distribution.documentDate,
                  debit: decimal(line.amountMinor),
                  credit: decimal(0),
                  description: line.label,
                })),
              },
            },
          });
        }

        const readings = await tx.unitMeterReading.findMany({
          where: { distributionId: id },
          select: { id: true, unitId: true, type: true },
        });
        for (const reading of readings) {
          const amountMinor = amountByReading.get(`${reading.unitId}:${reading.type}`) ?? 0;
          await tx.unitMeterReading.update({ where: { id: reading.id }, data: { amount: decimal(amountMinor) } });
        }

        await tx.meterDistribution.update({
          where: { id },
          data: { status: 'APPROVED', approvedAt: new Date(), totalAmount: decimal(preview.totalMinor) },
        });
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    return { id, documentCount: preview.rows.length, totalMinor: preview.totalMinor };
  }

  /**
   * Onayı geri alır: evraklar iptal edilir, dağıtım taslağa döner ve
   * düzeltilip yeniden onaylanabilir. Sonraki dönem onaylıysa engellenir —
   * o dönemin "önceki okumaları" bu dönemden türetilmiştir.
   */
  async revert(id: string) {
    const distribution = await this.requireDistribution(id);
    if (distribution.status !== 'APPROVED') throw new BadRequestException('Yalnızca onaylı dağıtım geri alınabilir');

    const later = await this.db.meterDistribution.findFirst({
      where: { status: 'APPROVED', period: { gt: distribution.period } },
      select: { period: true },
      orderBy: { period: 'asc' },
    });
    if (later) {
      throw new ConflictException(
        `${formatPeriodTR(later.period)} dönemi onaylı. Önce sonraki dönemlerin onayını geri alın.`,
      );
    }

    const result = await this.db.$transaction(async (tx) => {
      const cancelled = await tx.document.updateMany({
        where: { meterDistributionId: id, status: 'POSTED' },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      await tx.unitMeterReading.updateMany({ where: { distributionId: id }, data: { amount: decimal(0) } });
      await tx.meterDistribution.update({
        where: { id },
        data: { status: 'DRAFT', approvedAt: null, totalAmount: decimal(0) },
      });
      return cancelled.count;
    });
    return { id, cancelled: result };
  }

  async remove(id: string) {
    await this.requireDraft(id);
    await this.db.meterDistribution.delete({ where: { id } });
    return { id, deleted: true };
  }

  // --------------------------------------------------------------- yardımcı

  private params(d: Awaited<ReturnType<MetersService['requireDistribution']>>) {
    return {
      period: d.period,
      documentDate: d.documentDate,
      dueDate: d.dueDate,
      name: d.name,
      categoryId: d.categoryId,
      documentNote: d.documentNote,
      applyLateFee: d.applyLateFee,
      lateFeeStartDate: d.lateFeeStartDate,
      waterInletTemp: num(d.waterInletTemp),
      waterOutletTemp: num(d.waterOutletTemp),
      fuelLowerHeatValue: num(d.fuelLowerHeatValue),
      waterPricingMethod: d.waterPricingMethod,
      waterUnitPriceMinor: toMinorDecimal(d.waterUnitPrice),
      penaltyPercent: num(d.penaltyPercent),
      fixedSharePercent: num(d.fixedSharePercent),
    };
  }

  private paramData(input: MeterDistributionInput) {
    return {
      period: input.period,
      documentDate: input.documentDate,
      dueDate: input.dueDate,
      name: input.name?.trim() || null,
      categoryId: input.categoryId ?? null,
      documentNote: input.documentNote?.trim() || null,
      applyLateFee: input.applyLateFee,
      lateFeeStartDate: input.lateFeeStartDate ?? null,
      waterInletTemp: input.waterInletTemp,
      waterOutletTemp: input.waterOutletTemp,
      fuelLowerHeatValue: input.fuelLowerHeatValue,
      waterPricingMethod: input.waterPricingMethod,
      waterUnitPrice: decimal(toMinor(input.waterUnitPrice)),
      penaltyPercent: input.penaltyPercent,
      fixedSharePercent: input.fixedSharePercent,
    };
  }

  /**
   * Aktif daireler, oturanlarıyla (sorumlu seçimi tarihli ilişkiden yapılır).
   * Kapı numarası metin olduğu için veritabanı "1, 10, 2" sıralar; okuma
   * listesi sahadaki sırayla eşleşsin diye doğal sıraya çevrilir.
   */
  private async units() {
    const units = await this.db.unit.findMany({
      where: { isActive: true },
      include: {
        block: { select: { name: true, order: true } },
        occupancies: { include: { person: { select: { id: true, firstName: true, lastName: true } } } },
      },
    });
    return units.sort(
      (a, b) =>
        (a.block?.order ?? 0) - (b.block?.order ?? 0) ||
        (a.block?.name ?? '').localeCompare(b.block?.name ?? '', 'tr') ||
        a.doorNumber.localeCompare(b.doorNumber, 'tr', { numeric: true }),
    );
  }

  /** Daire sayaçlarının çarpanları: unitId → tür → çarpan */
  private async factors() {
    const meters = await this.db.meter.findMany({
      where: { unitId: { not: null }, isActive: true },
      select: { unitId: true, type: true, factor: true },
    });
    const map = new Map<string, Partial<Record<MeterType, number>>>();
    for (const meter of meters) {
      const entry = map.get(meter.unitId!) ?? {};
      entry[meter.type] = num(meter.factor);
      map.set(meter.unitId!, entry);
    }
    return map;
  }

  /** Bu dönemden önceki son onaylı dağıtımın son okumaları → "önceki okuma" önerisi */
  private async suggestions(period: string) {
    const last = await this.db.meterDistribution.findFirst({
      where: { status: 'APPROVED', period: { lt: period } },
      orderBy: { period: 'desc' },
      select: { id: true, period: true },
    });
    const main: Partial<Record<MeterType, number>> = {};
    const units: Partial<Record<MeterType, Record<string, number>>> = {};
    if (!last) return { period: null, main, units };

    const [mainRows, unitRows] = await Promise.all([
      this.db.mainMeterReading.findMany({ where: { distributionId: last.id } }),
      this.db.unitMeterReading.findMany({ where: { distributionId: last.id } }),
    ]);
    for (const row of mainRows) main[row.type] = num(row.currentValue);
    for (const row of unitRows) {
      units[row.type] ??= {};
      units[row.type]![row.unitId] = num(row.currentValue);
    }
    return { period: last.period, main, units };
  }

  private async requireDistribution(id: string) {
    const distribution = await this.db.meterDistribution.findUnique({ where: { id } });
    if (!distribution) throw new NotFoundException('Sayaç dağıtımı bulunamadı');
    return distribution;
  }

  private async requireDraft(id: string) {
    const distribution = await this.requireDistribution(id);
    if (distribution.status !== 'DRAFT') {
      throw new ConflictException('Onaylanmış dağıtım değiştirilemez. Önce onayı geri alın.');
    }
    return distribution;
  }

  private async assertPeriodFree(period: string) {
    const existing = await this.db.meterDistribution.findFirst({ where: { period }, select: { id: true } });
    if (existing) {
      throw new ConflictException(`${formatPeriodTR(period)} dönemi için zaten bir sayaç dağıtımı var`);
    }
  }

  private async assertCategory(categoryId: string | null | undefined) {
    if (!categoryId) return;
    const category = await this.db.category.findUnique({ where: { id: categoryId }, select: { kind: true } });
    if (!category) throw new BadRequestException('Gelir kategorisi bulunamadı');
    if (category.kind !== 'INCOME') throw new BadRequestException('Seçilen kategori bir gelir kategorisi değil');
  }
}

