/**
 * GELİR-GİDER RAPORU (saf hesap)
 *
 * İki bölüm:
 *  1. Tahakkuk esaslı gelir-gider: işlenmiş tahakkuk/fatura evraklarının
 *     kategori × ay kırılımı ve dönem net sonucu. Tahsil edilip edilmediğine
 *     bakılmaz (aidat yazıldığı ay gelirdir).
 *  2. Nakit durumu: kasa + banka hesaplarının dönem başı bakiyesi, giriş ve
 *     çıkışlar (evrak türüne göre) ve ay sonu bakiyeleri. Virman (kasa↔banka)
 *     hariçtir — iç para hareketi gelir ya da gider değildir.
 *
 * Tutarlar kuruş (tam sayı); toplamlar daima satırların toplamına eşittir.
 */

export const INCOME_STATEMENT_MAX_MONTHS = 24;

/** 'YYYY-MM' → 'YYYY-MM' arası tüm aylar (iki uç dahil) */
export function monthRange(from: string, to: string): string[] {
  const parse = (value: string) => {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new Error(`Geçersiz ay: ${value}`);
    return Number(match[1]) * 12 + Number(match[2]) - 1;
  };
  const start = parse(from);
  const end = parse(to);
  if (end < start) throw new Error('Bitiş ayı başlangıçtan önce olamaz');
  const months: string[] = [];
  for (let m = start; m <= end; m++) {
    months.push(`${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`);
  }
  return months;
}

/** Yerel saatle tarihin ayı: 'YYYY-MM' */
export function monthOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export interface StatementLine {
  label: string;
  /** `months` ile aynı sırada */
  byMonth: number[];
  totalMinor: number;
}

export interface Totals {
  byMonth: number[];
  totalMinor: number;
}

function aggregate(
  rows: readonly { label: string; month: string; amountMinor: number }[],
  months: readonly string[],
): StatementLine[] {
  const index = new Map(months.map((m, i) => [m, i]));
  const lines = new Map<string, number[]>();
  for (const row of rows) {
    const column = index.get(row.month);
    if (column === undefined) continue; // aralık dışı
    if (!lines.has(row.label)) lines.set(row.label, months.map(() => 0));
    lines.get(row.label)![column] += row.amountMinor;
  }
  return [...lines.entries()]
    .map(([label, byMonth]) => ({ label, byMonth, totalMinor: byMonth.reduce((a, b) => a + b, 0) }))
    .filter((line) => line.byMonth.some((v) => v !== 0))
    .sort((a, b) => b.totalMinor - a.totalMinor || a.label.localeCompare(b.label, 'tr'));
}

function totals(lines: readonly StatementLine[], months: readonly string[]): Totals {
  const byMonth = months.map((_, i) => lines.reduce((sum, line) => sum + line.byMonth[i], 0));
  return { byMonth, totalMinor: byMonth.reduce((a, b) => a + b, 0) };
}

export interface AccrualRow {
  kind: 'INCOME' | 'EXPENSE';
  /** Kategori adı; kategorisiz kayıtta evrak türü etiketi */
  label: string;
  month: string;
  amountMinor: number;
}

export interface IncomeStatement {
  months: string[];
  income: StatementLine[];
  expense: StatementLine[];
  incomeTotal: Totals;
  expenseTotal: Totals;
  /** Gelir − gider; negatifse dönem zararı */
  net: Totals;
}

export function buildIncomeStatement(rows: readonly AccrualRow[], months: readonly string[]): IncomeStatement {
  const income = aggregate(rows.filter((r) => r.kind === 'INCOME'), months);
  const expense = aggregate(rows.filter((r) => r.kind === 'EXPENSE'), months);
  const incomeTotal = totals(income, months);
  const expenseTotal = totals(expense, months);
  const netByMonth = months.map((_, i) => incomeTotal.byMonth[i] - expenseTotal.byMonth[i]);
  return {
    months: [...months],
    income,
    expense,
    incomeTotal,
    expenseTotal,
    net: { byMonth: netByMonth, totalMinor: incomeTotal.totalMinor - expenseTotal.totalMinor },
  };
}

export interface CashMovement {
  direction: 'IN' | 'OUT';
  label: string;
  month: string;
  amountMinor: number;
}

export interface CashFlow {
  openingMinor: number;
  inflow: StatementLine[];
  outflow: StatementLine[];
  inflowTotal: Totals;
  outflowTotal: Totals;
  /** Her ayın sonundaki kasa + banka bakiyesi */
  closingByMonth: number[];
  closingMinor: number;
}

export function buildCashFlow(openingMinor: number, movements: readonly CashMovement[], months: readonly string[]): CashFlow {
  const inflow = aggregate(movements.filter((m) => m.direction === 'IN'), months);
  const outflow = aggregate(movements.filter((m) => m.direction === 'OUT'), months);
  const inflowTotal = totals(inflow, months);
  const outflowTotal = totals(outflow, months);
  let running = openingMinor;
  const closingByMonth = months.map((_, i) => {
    running += inflowTotal.byMonth[i] - outflowTotal.byMonth[i];
    return running;
  });
  return {
    openingMinor,
    inflow,
    outflow,
    inflowTotal,
    outflowTotal,
    closingByMonth,
    closingMinor: running,
  };
}
