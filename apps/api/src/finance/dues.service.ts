import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  allocateDues,
  dueDateForPeriod,
  formatPeriodTR,
  periodToDate,
  toMinor,
  sum,
  type DuesDistributionMethod,
  type DuesItemInput,
  type DuesUnitInput,
} from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { requireSiteId } from '../tenant/tenant.context';
import { LedgerService, decimal, type LedgerEntryInput } from './ledger.service';

export interface DuesRunLineInput {
  duesItemId: string;
  /** TL ya da "1.234,56" — kuruşa burada çevrilir */
  amount: string | number;
  mode: 'TOTAL' | 'PER_UNIT';
  method?: DuesDistributionMethod;
}

export interface GenerateDuesInput {
  period: string;
  issueDate: Date;
  dueDate: Date;
  description?: string;
  lines: DuesRunLineInput[];
}

export interface DuesPreviewRow {
  unitId: string;
  blockName: string | null;
  doorNumber: string;
  personId: string | null;
  personName: string;
  /** Borcun kime yazıldığı */
  liability: 'OWNER' | 'TENANT' | 'NONE';
  amountMinor: number;
  breakdown: { duesItemId: string; name: string; amountMinor: number }[];
}

export interface DuesPreview {
  period: string;
  periodLabel: string;
  dueDate: Date;
  rows: DuesPreviewRow[];
  totalMinor: number;
  unitCount: number;
  /** Sorumlusu bulunamayan daireler — tahakkuk yazılamaz */
  warnings: string[];
}

@Injectable()
export class DuesService {
  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Tahakkuk önizlemesi — hiçbir şey yazmaz.
   * Yönetici "Oluştur" demeden önce tam olarak ne olacağını görür.
   */
  async preview(input: GenerateDuesInput): Promise<DuesPreview> {
    const siteId = requireSiteId();
    const settings = await this.db.siteSettings.findUnique({ where: { siteId } });
    if (!settings) throw new NotFoundException('Site parametreleri bulunamadı');

    const units = await this.db.unit.findMany({
      where: { isActive: true },
      include: {
        block: { select: { name: true } },
        occupancies: {
          include: { person: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
      orderBy: [{ block: { order: 'asc' } }, { doorNumber: 'asc' }],
    });

    const duesItems = await this.db.duesItem.findMany({
      where: { id: { in: input.lines.map((l) => l.duesItemId) } },
      select: { id: true, name: true, distributionMethod: true },
    });
    if (duesItems.length !== input.lines.length) {
      throw new BadRequestException('Seçilen aidat kalemlerinden bazıları bulunamadı');
    }
    const itemById = new Map(duesItems.map((i) => [i.id, i]));

    // --- Hesap motoruna girdi hazırla
    const calcUnits: DuesUnitInput[] = units.map((unit) => ({
      unitId: unit.id,
      area: unit.area ? Number(unit.area) : null,
      landShare: unit.landShare ? Number(unit.landShare) : null,
      shareRatio: unit.shareRatio ? Number(unit.shareRatio) : 1,
      isExempt: unit.isExempt,
    }));

    const calcItems: DuesItemInput[] = input.lines.map((line) => {
      const item = itemById.get(line.duesItemId)!;
      return {
        duesItemId: line.duesItemId,
        name: item.name,
        mode: line.mode,
        amountMinor: toMinor(line.amount),
        method:
          line.method ??
          (item.distributionMethod as DuesDistributionMethod | null) ??
          undefined,
      };
    });

    const result = allocateDues(
      calcUnits,
      calcItems,
      settings.duesDistributionMethod as DuesDistributionMethod,
    );

    // --- Borcu kime yazacağız
    const referenceDate = periodToDate(input.period);
    const warnings: string[] = [];
    const rows: DuesPreviewRow[] = [];

    for (const unit of units) {
      if (unit.isExempt) continue;
      const amountMinor = result.byUnit[unit.id] ?? 0;
      if (amountMinor === 0) continue;

      const responsible = pickResponsible(
        unit.occupancies,
        referenceDate,
        settings.duesLiabilityRule,
      );

      if (!responsible) {
        warnings.push(
          `${unit.block?.name ?? ''} ${unit.doorNumber} nolu dairenin sorumlusu bulunamadı; tahakkuk yazılmayacak.`,
        );
      }

      rows.push({
        unitId: unit.id,
        blockName: unit.block?.name ?? null,
        doorNumber: unit.doorNumber,
        personId: responsible?.person.id ?? null,
        personName: responsible
          ? `${responsible.person.firstName} ${responsible.person.lastName}`
          : '—',
        liability: responsible ? responsible.role : 'NONE',
        amountMinor,
        breakdown: result.lines
          .filter((l) => l.unitId === unit.id)
          .map((l) => ({
            duesItemId: l.duesItemId,
            name: itemById.get(l.duesItemId)?.name ?? '',
            amountMinor: l.amountMinor,
          })),
      });
    }

    return {
      period: input.period,
      periodLabel: formatPeriodTR(input.period),
      dueDate: input.dueDate,
      rows,
      totalMinor: sum(rows.map((r) => r.amountMinor)),
      unitCount: rows.length,
      warnings,
    };
  }

  /**
   * Tahakkuku üretir: her daire için bir DUES_ACCRUAL evrakı ve sorumlusunun
   * carisine borç hareketi. Tamamı tek işlemde yazılır — yarım kalmaz.
   */
  async generate(input: GenerateDuesInput): Promise<{ duesRunId: string; totalMinor: number; documentCount: number }> {
    const siteId = requireSiteId();

    const existing = await this.db.duesRun.findFirst({ where: { period: input.period } });
    if (existing) {
      throw new BadRequestException(
        `${formatPeriodTR(input.period)} dönemi için zaten tahakkuk oluşturulmuş`,
      );
    }

    const preview = await this.preview(input);
    const payableRows = preview.rows.filter((r) => r.personId);
    if (payableRows.length === 0) {
      throw new BadRequestException('Tahakkuk yazılacak daire bulunamadı');
    }

    // Kişi → cari eşlemesi
    const personIds = payableRows.map((r) => r.personId!);
    const accounts = await this.db.account.findMany({
      where: { personId: { in: personIds }, type: 'PERSON' },
      select: { id: true, personId: true },
    });
    const accountByPerson = new Map(accounts.map((a) => [a.personId!, a.id]));

    const missing = payableRows.filter((r) => !accountByPerson.has(r.personId!));
    if (missing.length > 0) {
      throw new BadRequestException(
        `${missing.length} kişinin cari hesabı yok. Önce cari hesapları oluşturun.`,
      );
    }

    // Aidat gelir kategorisi (varsa) — gelir dağılımı grafiği bunu kullanır
    const incomeCategory = await this.db.category.findFirst({
      where: { kind: 'INCOME', name: 'Aidat Geliri' },
      select: { id: true },
    });

    // Evrak numaralarını önceden üret (işlem içinde N sorgu yapmamak için)
    const firstNumber = await this.ledger.nextDocumentNumber('DUES_ACCRUAL', input.issueDate);
    const prefix = firstNumber.slice(0, firstNumber.lastIndexOf('-') + 1);
    const startSeq = Number(firstNumber.slice(prefix.length));

    const documents = payableRows.map((row, index) => ({
      siteId,
      type: 'DUES_ACCRUAL' as const,
      status: 'POSTED' as const,
      number: `${prefix}${String(startSeq + index).padStart(6, '0')}`,
      date: input.issueDate,
      dueDate: input.dueDate,
      period: input.period,
      description:
        input.description ?? `${formatPeriodTR(input.period)} dönemi aidat tahakkuku`,
      unitId: row.unitId,
      totalAmount: decimal(row.amountMinor),
      entries: row.breakdown.map<LedgerEntryInput & { name: string }>((item) => ({
        accountId: accountByPerson.get(row.personId!)!,
        debitMinor: item.amountMinor,
        categoryId: incomeCategory?.id ?? null,
        unitId: row.unitId,
        duesItemId: item.duesItemId,
        description: item.name,
        name: item.name,
      })),
    }));

    const totalMinor = sum(payableRows.map((r) => r.amountMinor));

    const duesRun = await this.db.$transaction(
      async (tx) => {
        const run = await tx.duesRun.create({
          data: {
            siteId,
            period: input.period,
            issueDate: input.issueDate,
            dueDate: input.dueDate,
            description: input.description,
            status: 'POSTED',
            totalAmount: decimal(totalMinor),
            unitCount: payableRows.length,
            postedAt: new Date(),
            lines: {
              create: input.lines.map((line) => ({
                duesItemId: line.duesItemId,
                amount: decimal(toMinor(line.amount)),
                distributionMethod: (line.method ?? 'EQUAL') as DuesDistributionMethod,
              })),
            },
          },
          select: { id: true },
        });

        for (const document of documents) {
          await tx.document.create({
            data: {
              ...document,
              duesRunId: run.id,
              entries: {
                create: document.entries.map((entry) => ({
                  siteId,
                  accountId: entry.accountId,
                  categoryId: entry.categoryId,
                  unitId: entry.unitId,
                  duesItemId: entry.duesItemId,
                  date: document.date,
                  debit: decimal(entry.debitMinor ?? 0),
                  credit: decimal(0),
                  description: entry.description,
                })),
              },
            },
          });
        }

        return run;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    return { duesRunId: duesRun.id, totalMinor, documentCount: documents.length };
  }

  async list() {
    return this.db.duesRun.findMany({
      orderBy: { period: 'desc' },
      include: { _count: { select: { documents: true } } },
    });
  }

  /** Dönemin tahakkukunu tümüyle iptal eder (tahsilat görmüş evrak varsa engellenir) */
  async cancelRun(duesRunId: string): Promise<{ cancelled: number }> {
    const run = await this.db.duesRun.findUnique({
      where: { id: duesRunId },
      include: { documents: { select: { id: true, status: true } } },
    });
    if (!run) throw new NotFoundException('Tahakkuk bulunamadı');

    const paid = await this.db.document.count({
      where: { parentId: { in: run.documents.map((d) => d.id) }, status: 'POSTED' },
    });
    if (paid > 0) {
      throw new BadRequestException(
        `Bu dönemde ${paid} adet tahsilat var. Önce tahsilatları iptal edin.`,
      );
    }

    const result = await this.db.document.updateMany({
      where: { duesRunId, status: 'POSTED' },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await this.db.duesRun.update({ where: { id: duesRunId }, data: { status: 'CANCELLED' } });

    return { cancelled: result.count };
  }
}

/**
 * Bir dairenin, verilen tarihteki borç sorumlusunu bulur.
 *
 * OCCUPANT kuralında önce o tarihte geçerli kiracı aranır; yoksa malike düşer.
 * OWNER kuralında daima malik sorumludur.
 * Tarihli ilişki (giriş/çıkış) bu yüzden kritik: geçmiş bir dönemin tahakkuku
 * o dönemde oturan kişiye yazılır, bugünkü oturana değil.
 */
function pickResponsible<
  T extends {
    role: 'OWNER' | 'TENANT';
    startDate: Date;
    endDate: Date | null;
    person: { id: string; firstName: string; lastName: string };
  },
>(occupancies: T[], date: Date, rule: 'OWNER' | 'OCCUPANT'): T | null {
  const active = occupancies.filter(
    (o) => o.startDate <= date && (!o.endDate || o.endDate >= date),
  );

  if (rule === 'OCCUPANT') {
    const tenant = active.find((o) => o.role === 'TENANT');
    if (tenant) return tenant;
  }
  return active.find((o) => o.role === 'OWNER') ?? null;
}

export { pickResponsible };
