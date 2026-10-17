import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type DocumentType, type PaymentChannel } from '@sy/db';
import { fromMinor, toMinor, sum } from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { requireSiteId } from '../tenant/tenant.context';

/**
 * CARİ DEFTER — finans çekirdeğinin tek yazma kapısı.
 *
 * Kurallar:
 *  1. Tutarlar servise **kuruş (tam sayı)** olarak girer/çıkar; Decimal'e
 *     çevrim yalnızca bu dosyada yapılır.
 *  2. Bakiye hiçbir yerde saklanmaz — daima hareketlerden türetilir.
 *  3. Evrak iki biçimden biridir:
 *       - Tek hareketli (tahakkuk / fatura): karşı taraf bir GELİR/GİDER
 *         kategorisidir. Bu yüzden borç-alacak eşitliği aranmaz.
 *       - Çok hareketli (tahsilat / ödeme / virman): borç toplamı alacak
 *         toplamına EŞİT olmak zorundadır; değilse evrak reddedilir.
 *  4. İşlenen (POSTED) evrak değiştirilmez; düzeltme iptal + yeniden
 *     oluşturma ile yapılır. Böylece defter denetlenebilir kalır.
 */

export interface LedgerEntryInput {
  accountId: string;
  /** kuruş */
  debitMinor?: number;
  /** kuruş */
  creditMinor?: number;
  categoryId?: string | null;
  unitId?: string | null;
  duesItemId?: string | null;
  description?: string | null;
}

export interface CreateDocumentInput {
  type: DocumentType;
  date: Date;
  dueDate?: Date | null;
  period?: string | null;
  description?: string | null;
  unitId?: string | null;
  parentId?: string | null;
  duesRunId?: string | null;
  meterDistributionId?: string | null;
  ticketId?: string | null;
  /** Yalnızca tahsilatta: ödeme skorunun kanal dağılımı için */
  paymentChannel?: PaymentChannel | null;
  number?: string;
  entries: LedgerEntryInput[];
}

export interface AccountBalance {
  accountId: string;
  /** Borç toplamı (kuruş) */
  debitMinor: number;
  /** Alacak toplamı (kuruş) */
  creditMinor: number;
  /** Bakiye = borç − alacak (pozitif ⇒ cari borçlu) */
  balanceMinor: number;
}

/** Kapanmamış (bakiyesi kalan) tahakkuk */
export interface OpenItem {
  documentId: string;
  number: string;
  type: DocumentType;
  date: Date;
  dueDate: Date | null;
  period: string | null;
  totalMinor: number;
  paidMinor: number;
  remainingMinor: number;
}

@Injectable()
export class LedgerService {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  // ------------------------------------------------------------------ evrak no

  /**
   * Site içinde benzersiz evrak numarası: `TİP-YIL-SIRA` (ör. AID-2026-000042).
   * Çakışma olasılığına karşı çağıran taraf işlemi yeniden dener.
   */
  async nextDocumentNumber(type: DocumentType, date: Date): Promise<string> {
    const prefix = DOCUMENT_PREFIX[type];
    const year = date.getFullYear();
    const search = `${prefix}-${year}-`;

    const last = await this.db.document.findFirst({
      where: { number: { startsWith: search } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });

    const lastSeq = last ? Number(last.number.slice(search.length)) : 0;
    return `${search}${String(lastSeq + 1).padStart(6, '0')}`;
  }

  // ---------------------------------------------------------------- oluşturma

  /** Evrakı TASLAK olarak oluşturur (hareketler yazılır ama bakiyeye sayılmaz) */
  async createDraft(input: CreateDocumentInput): Promise<{ id: string; number: string }> {
    return this.create(input, 'DRAFT');
  }

  /** Evrakı oluşturur ve doğrudan işler (POSTED) */
  async createPosted(input: CreateDocumentInput): Promise<{ id: string; number: string }> {
    return this.create(input, 'POSTED');
  }

  private async create(
    input: CreateDocumentInput,
    status: 'DRAFT' | 'POSTED',
  ): Promise<{ id: string; number: string }> {
    const siteId = requireSiteId();

    if (input.entries.length === 0) {
      throw new BadRequestException('Evrakta en az bir hareket olmalı');
    }

    const debit = sum(input.entries.map((e) => e.debitMinor ?? 0));
    const credit = sum(input.entries.map((e) => e.creditMinor ?? 0));

    for (const entry of input.entries) {
      const d = entry.debitMinor ?? 0;
      const c = entry.creditMinor ?? 0;
      if (d < 0 || c < 0) throw new BadRequestException('Tutarlar negatif olamaz');
      if (d > 0 && c > 0) {
        throw new BadRequestException('Bir hareket aynı anda hem borç hem alacak olamaz');
      }
      if (d === 0 && c === 0) throw new BadRequestException('Sıfır tutarlı hareket yazılamaz');
    }

    // Çok hareketli evrakta borç = alacak olmalı
    if (input.entries.length > 1 && debit !== credit) {
      throw new BadRequestException(
        `Evrak dengeli değil: borç ${fromMinor(debit)} ≠ alacak ${fromMinor(credit)}`,
      );
    }

    const number = input.number ?? (await this.nextDocumentNumber(input.type, input.date));

    const document = await this.db.document.create({
      data: {
        siteId,
        type: input.type,
        status,
        number,
        date: input.date,
        dueDate: input.dueDate ?? null,
        period: input.period ?? null,
        description: input.description ?? null,
        unitId: input.unitId ?? null,
        parentId: input.parentId ?? null,
        duesRunId: input.duesRunId ?? null,
        meterDistributionId: input.meterDistributionId ?? null,
        ticketId: input.ticketId ?? null,
        paymentChannel: input.paymentChannel ?? null,
        totalAmount: decimal(Math.max(debit, credit)),
        entries: {
          create: input.entries.map((entry) => ({
            siteId,
            accountId: entry.accountId,
            categoryId: entry.categoryId ?? null,
            unitId: entry.unitId ?? input.unitId ?? null,
            duesItemId: entry.duesItemId ?? null,
            date: input.date,
            debit: decimal(entry.debitMinor ?? 0),
            credit: decimal(entry.creditMinor ?? 0),
            description: entry.description ?? input.description ?? null,
          })),
        },
      },
      select: { id: true, number: true },
    });

    return document;
  }

  // ------------------------------------------------------------------- durum

  async post(documentId: string): Promise<void> {
    const document = await this.db.document.findUnique({
      where: { id: documentId },
      select: { id: true, status: true },
    });
    if (!document) throw new NotFoundException('Evrak bulunamadı');
    if (document.status === 'POSTED') return;
    if (document.status === 'CANCELLED') {
      throw new BadRequestException('İptal edilmiş evrak işlenemez');
    }
    await this.db.document.update({ where: { id: documentId }, data: { status: 'POSTED' } });
  }

  /**
   * Evrakı iptal eder. Hareketler silinmez; evrak CANCELLED olduğu için
   * bakiye hesabına dahil edilmez — denetim izi korunur.
   */
  async cancel(documentId: string, reason?: string): Promise<void> {
    const document = await this.db.document.findUnique({
      where: { id: documentId },
      select: { id: true, status: true, type: true },
    });
    if (!document) throw new NotFoundException('Evrak bulunamadı');
    if (document.status === 'CANCELLED') return;

    // Kapatma kaydı olan bir tahakkuk doğrudan iptal edilemez
    const childCount = await this.db.document.count({
      where: { parentId: documentId, status: 'POSTED' },
    });
    if (childCount > 0) {
      throw new BadRequestException(
        'Bu evraka bağlı tahsilat/ödeme kayıtları var. Önce onları iptal edin.',
      );
    }

    await this.db.document.update({
      where: { id: documentId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        description: reason ? `${reason}` : undefined,
      },
    });
  }

  // ------------------------------------------------------------------ bakiye

  /** Tek bir carinin bakiyesi */
  async balanceOf(accountId: string, asOf?: Date): Promise<AccountBalance> {
    const result = await this.db.ledgerEntry.aggregate({
      where: {
        accountId,
        document: { status: 'POSTED' },
        ...(asOf ? { date: { lte: asOf } } : {}),
      },
      _sum: { debit: true, credit: true },
    });

    const debitMinor = toMinorDecimal(result._sum.debit);
    const creditMinor = toMinorDecimal(result._sum.credit);
    return { accountId, debitMinor, creditMinor, balanceMinor: debitMinor - creditMinor };
  }

  /** Birden çok carinin bakiyesi (tek sorgu) — liste ekranları için */
  async balancesOf(accountIds: string[], asOf?: Date): Promise<Map<string, number>> {
    if (accountIds.length === 0) return new Map();

    const rows = await this.db.ledgerEntry.groupBy({
      by: ['accountId'],
      where: {
        accountId: { in: accountIds },
        document: { status: 'POSTED' },
        ...(asOf ? { date: { lte: asOf } } : {}),
      },
      _sum: { debit: true, credit: true },
    });

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.accountId, toMinorDecimal(row._sum.debit) - toMinorDecimal(row._sum.credit));
    }
    for (const id of accountIds) if (!map.has(id)) map.set(id, 0);
    return map;
  }

  /** Cari hesap ekstresi — yürüyen bakiye ile */
  async statement(accountId: string, from: Date, to: Date) {
    const [opening, entries] = await Promise.all([
      this.balanceOf(accountId, new Date(from.getTime() - 1)),
      this.db.ledgerEntry.findMany({
        where: {
          accountId,
          document: { status: 'POSTED' },
          date: { gte: from, lte: to },
        },
        include: {
          document: { select: { number: true, type: true, dueDate: true } },
          category: { select: { name: true } },
          unit: { select: { doorNumber: true } },
        },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    let running = opening.balanceMinor;
    const lines = entries.map((entry) => {
      const debitMinor = toMinorDecimal(entry.debit);
      const creditMinor = toMinorDecimal(entry.credit);
      running += debitMinor - creditMinor;
      return {
        id: entry.id,
        date: entry.date,
        documentNumber: entry.document.number,
        documentType: entry.document.type,
        description: entry.description,
        category: entry.category?.name ?? null,
        unit: entry.unit?.doorNumber ?? null,
        debitMinor,
        creditMinor,
        balanceMinor: running,
      };
    });

    return {
      openingBalanceMinor: opening.balanceMinor,
      closingBalanceMinor: running,
      totalDebitMinor: sum(lines.map((l) => l.debitMinor)),
      totalCreditMinor: sum(lines.map((l) => l.creditMinor)),
      lines,
    };
  }

  // ------------------------------------------------------------- açık kalemler

  /**
   * Carinin kapanmamış borç evrakları.
   *
   * KAPATMA BAĞLANTISI SAKLANMAZ, TÜRETİLİR: carinin tüm alacak hareketleri
   * (tahsilatlar, avanslar) tek bir havuz sayılır ve borç evraklarına vade
   * sırasıyla (FIFO) uygulanır. Bunun iki faydası var:
   *   - Bir tahsilat iptal edildiğinde ya da tarihi değiştiğinde dağıtım
   *     kendiliğinden yeniden hesaplanır; bayat eşleşme kaydı kalmaz.
   *   - Site yönetiminin gerçek davranışına uyar: "önce en eski borç kapanır".
   */
  async openItems(accountId: string): Promise<OpenItem[]> {
    const [documents, creditAgg] = await Promise.all([
      this.db.document.findMany({
        where: {
          status: 'POSTED',
          type: { in: DEBT_DOCUMENT_TYPES },
          entries: { some: { accountId, debit: { gt: 0 } } },
        },
        include: { entries: { where: { accountId }, select: { debit: true } } },
        orderBy: [{ dueDate: 'asc' }, { date: 'asc' }, { number: 'asc' }],
      }),
      this.db.ledgerEntry.aggregate({
        where: { accountId, credit: { gt: 0 }, document: { status: 'POSTED' } },
        _sum: { credit: true },
      }),
    ]);

    let creditPool = toMinorDecimal(creditAgg._sum.credit);
    const items: OpenItem[] = [];

    for (const document of documents) {
      const totalMinor = sum(document.entries.map((e) => toMinorDecimal(e.debit)));
      const paidMinor = Math.min(creditPool, totalMinor);
      creditPool -= paidMinor;

      const remainingMinor = totalMinor - paidMinor;
      if (remainingMinor <= 0) continue;

      items.push({
        documentId: document.id,
        number: document.number,
        type: document.type,
        date: document.date,
        dueDate: document.dueDate,
        period: document.period,
        totalMinor,
        paidMinor,
        remainingMinor,
      });
    }
    return items;
  }

  /** Borcu aşan tahsilat tutarı (avans) */
  async advanceOf(accountId: string): Promise<number> {
    const balance = await this.balanceOf(accountId);
    return balance.balanceMinor < 0 ? -balance.balanceMinor : 0;
  }

  /**
   * Tahsilatı açık kalemlere dağıtır.
   * `OLDEST_FIRST` (varsayılan): en eski vadeli borç önce kapanır.
   * Artan tutar avans olarak kalır (hiçbir evraka bağlanmaz).
   */
  allocate(
    openItems: OpenItem[],
    amountMinor: number,
    rule: 'OLDEST_FIRST' | 'NEWEST_FIRST' = 'OLDEST_FIRST',
  ): { allocations: { documentId: string; amountMinor: number }[]; advanceMinor: number } {
    const ordered = [...openItems].sort((a, b) => {
      const aKey = (a.dueDate ?? a.date).getTime();
      const bKey = (b.dueDate ?? b.date).getTime();
      return rule === 'OLDEST_FIRST' ? aKey - bKey : bKey - aKey;
    });

    let remaining = amountMinor;
    const allocations: { documentId: string; amountMinor: number }[] = [];

    for (const item of ordered) {
      if (remaining <= 0) break;
      const applied = Math.min(remaining, item.remainingMinor);
      allocations.push({ documentId: item.documentId, amountMinor: applied });
      remaining -= applied;
    }

    return { allocations, advanceMinor: remaining };
  }
}

// --------------------------------------------------------------------- yardımcılar

/** Cariyi borçlandıran evrak türleri */
export const DEBT_DOCUMENT_TYPES: DocumentType[] = [
  'OPENING_BALANCE',
  'DUES_ACCRUAL',
  'METER_DISTRIBUTION',
  'LATE_FEE',
];

const DOCUMENT_PREFIX: Record<DocumentType, string> = {
  OPENING_BALANCE: 'ACL',
  DUES_ACCRUAL: 'AID',
  METER_DISTRIBUTION: 'SAY',
  LATE_FEE: 'GEC',
  EXPENSE: 'GID',
  INCOME: 'GEL',
  COLLECTION: 'TAH',
  PAYMENT: 'ODM',
  TRANSFER: 'VRM',
};

/** kuruş → Prisma Decimal */
export function decimal(minor: number): Prisma.Decimal {
  return new Prisma.Decimal(fromMinor(minor).toFixed(4));
}

/** Prisma Decimal → kuruş */
export function toMinorDecimal(value: Prisma.Decimal | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return toMinor(value.toString());
}
