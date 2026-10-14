import { Inject, Injectable } from '@nestjs/common';
import { formatPeriodTR, previousPeriod, toPeriod, sum } from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { DEBT_DOCUMENT_TYPES, toMinorDecimal } from './ledger.service';

export interface PeriodCollection {
  period: string;
  label: string;
  accruedMinor: number;
  collectedMinor: number;
  outstandingMinor: number;
  collectionRate: number;
}

@Injectable()
export class DashboardService {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  /**
   * Dönem bazında aidat tahsilat durumu (panodaki çubuk grafik).
   *
   * Tahsilat hangi döneme sayılır? Cari defterde tahsilatlar tek bir havuzdur;
   * bu yüzden kapanma, borçlara vade sırasıyla (FIFO) uygulanarak hesaplanır —
   * ekstredeki mantığın aynısı. Böylece "Ağustos tahsil edildi mi?" sorusunun
   * cevabı, bakiyeyle birebir tutarlı olur.
   */
  async duesCollectionByPeriod(monthCount = 12): Promise<PeriodCollection[]> {
    const periods: string[] = [];
    let cursor = toPeriod(new Date());
    for (let i = 0; i < monthCount; i++) {
      periods.unshift(cursor);
      cursor = previousPeriod(cursor);
    }
    const oldest = periods[0];

    // Tüm borç evrakları (cari + dönem + tutar)
    const documents = await this.db.document.findMany({
      where: { status: 'POSTED', type: { in: DEBT_DOCUMENT_TYPES } },
      select: {
        id: true,
        period: true,
        date: true,
        dueDate: true,
        number: true,
        entries: { where: { debit: { gt: 0 } }, select: { accountId: true, debit: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { date: 'asc' }, { number: 'asc' }],
    });

    // Cari başına toplam alacak (tahsilat havuzu)
    const creditRows = await this.db.ledgerEntry.groupBy({
      by: ['accountId'],
      where: { credit: { gt: 0 }, document: { status: 'POSTED' } },
      _sum: { credit: true },
    });
    const creditPool = new Map(
      creditRows.map((row) => [row.accountId, toMinorDecimal(row._sum.credit)]),
    );

    const accrued = new Map<string, number>();
    const collected = new Map<string, number>();

    for (const document of documents) {
      for (const entry of document.entries) {
        const amount = toMinorDecimal(entry.debit);
        if (amount <= 0) continue;

        const period = document.period ?? toPeriod(document.dueDate ?? document.date);
        const pool = creditPool.get(entry.accountId) ?? 0;
        const paid = Math.min(pool, amount);
        creditPool.set(entry.accountId, pool - paid);

        accrued.set(period, (accrued.get(period) ?? 0) + amount);
        collected.set(period, (collected.get(period) ?? 0) + paid);
      }
    }

    return periods.map((period) => {
      const accruedMinor = accrued.get(period) ?? 0;
      const collectedMinor = collected.get(period) ?? 0;
      return {
        period,
        label: formatPeriodTR(period),
        accruedMinor,
        collectedMinor,
        outstandingMinor: accruedMinor - collectedMinor,
        collectionRate: accruedMinor > 0 ? Math.round((collectedMinor / accruedMinor) * 100) : 0,
      };
    });
  }

  /** Gelir / gider dağılımı (iki halka grafik) */
  async distribution(from: Date, to: Date) {
    const rows = await this.db.ledgerEntry.groupBy({
      by: ['categoryId'],
      where: {
        categoryId: { not: null },
        date: { gte: from, lte: to },
        document: { status: 'POSTED' },
      },
      _sum: { debit: true, credit: true },
    });

    const categories = await this.db.category.findMany({
      where: { id: { in: rows.map((r) => r.categoryId!).filter(Boolean) } },
      select: { id: true, name: true, kind: true },
    });
    const categoryById = new Map(categories.map((c) => [c.id, c]));

    const income: { name: string; amountMinor: number }[] = [];
    const expense: { name: string; amountMinor: number }[] = [];

    for (const row of rows) {
      const category = categoryById.get(row.categoryId!);
      if (!category) continue;
      // Gelir kategorileri borç hareketiyle (tahakkuk), gider kategorileri
      // alacak hareketiyle (fatura) oluşur.
      const amountMinor =
        category.kind === 'INCOME'
          ? toMinorDecimal(row._sum.debit)
          : toMinorDecimal(row._sum.credit);
      if (amountMinor <= 0) continue;
      (category.kind === 'INCOME' ? income : expense).push({
        name: category.name,
        amountMinor,
      });
    }

    income.sort((a, b) => b.amountMinor - a.amountMinor);
    expense.sort((a, b) => b.amountMinor - a.amountMinor);

    return {
      income,
      expense,
      incomeTotalMinor: sum(income.map((i) => i.amountMinor)),
      expenseTotalMinor: sum(expense.map((e) => e.amountMinor)),
    };
  }

  /** Ödenecek faturalar — vadesi geçenler önce */
  async payableInvoices() {
    const documents = await this.db.document.findMany({
      where: { status: 'POSTED', type: 'EXPENSE' },
      select: {
        id: true,
        number: true,
        date: true,
        dueDate: true,
        description: true,
        entries: {
          where: { credit: { gt: 0 } },
          select: { accountId: true, credit: true, account: { select: { name: true } } },
        },
      },
      orderBy: [{ dueDate: 'asc' }, { date: 'asc' }],
    });

    // Tedarikçiye yapılan ödemeler (borç hareketleri) FIFO ile kapatır
    const debitRows = await this.db.ledgerEntry.groupBy({
      by: ['accountId'],
      where: { debit: { gt: 0 }, document: { status: 'POSTED', type: 'PAYMENT' } },
      _sum: { debit: true },
    });
    const paymentPool = new Map(
      debitRows.map((row) => [row.accountId, toMinorDecimal(row._sum.debit)]),
    );

    const items = [];
    for (const document of documents) {
      for (const entry of document.entries) {
        const totalMinor = toMinorDecimal(entry.credit);
        const pool = paymentPool.get(entry.accountId) ?? 0;
        const paidMinor = Math.min(pool, totalMinor);
        paymentPool.set(entry.accountId, pool - paidMinor);

        const remainingMinor = totalMinor - paidMinor;
        if (remainingMinor <= 0) continue;

        items.push({
          documentId: document.id,
          number: document.number,
          date: document.date,
          dueDate: document.dueDate,
          supplier: entry.account.name,
          description: document.description,
          totalMinor,
          paidMinor,
          remainingMinor,
          overdue: document.dueDate ? document.dueDate < new Date() : false,
        });
      }
    }

    return { items, totalMinor: sum(items.map((i) => i.remainingMinor)) };
  }

  /** Kasa ve banka bakiyeleri */
  async cashPosition() {
    const accounts = await this.db.account.findMany({
      where: { type: { in: ['CASH', 'BANK'] }, isActive: true },
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    });

    const rows = await this.db.ledgerEntry.groupBy({
      by: ['accountId'],
      where: {
        accountId: { in: accounts.map((a) => a.id) },
        document: { status: 'POSTED' },
      },
      _sum: { debit: true, credit: true },
    });
    const balances = new Map(
      rows.map((row) => [
        row.accountId,
        toMinorDecimal(row._sum.debit) - toMinorDecimal(row._sum.credit),
      ]),
    );

    const items = accounts.map((account) => ({
      ...account,
      balanceMinor: balances.get(account.id) ?? 0,
    }));

    return { items, totalMinor: sum(items.map((i) => i.balanceMinor)) };
  }

  /** Panodaki uyarı/sayaç kartları */
  async counters() {
    const [pendingBank, openTickets, overdueAccounts] = await Promise.all([
      this.db.bankTransaction.count({ where: { matchStatus: 'UNMATCHED' } }),
      this.db.ticket.count({ where: { status: { notIn: ['COMPLETED'] } } }),
      this.db.document.count({
        where: {
          status: 'POSTED',
          type: { in: DEBT_DOCUMENT_TYPES },
          dueDate: { lt: new Date() },
        },
      }),
    ]);

    return { pendingBankTransactions: pendingBank, openTickets, overdueDocuments: overdueAccounts };
  }
}
