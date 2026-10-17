import { formatPeriodShortTR, type CashFlow, type IncomeStatement, type StatementLine } from '@sy/shared';
import type { SiteInfo } from './pdf';

/**
 * Gelir-gider raporunun PDF ve Excel'de AYNI satır düzeniyle basılması için
 * ortak tablo modeli. Değerler kuruş; `null` boş hücre.
 */

export interface IncomeStatementData {
  site: SiteInfo;
  from: string;
  to: string;
  statement: IncomeStatement;
  cash: CashFlow;
}

export type RowStyle = 'section' | 'line' | 'subtotal' | 'net';

export interface TableRow {
  label: string;
  values: (number | null)[];
  total: number | null;
  style: RowStyle;
}

export interface ReportTable {
  title: string;
  columns: string[];
  totalHeader: string;
  rows: TableRow[];
}

const section = (label: string, width: number): TableRow => ({
  label,
  values: Array(width).fill(null),
  total: null,
  style: 'section',
});

const line = (l: StatementLine): TableRow => ({ label: l.label, values: l.byMonth, total: l.totalMinor, style: 'line' });

export function incomeStatementTables(data: IncomeStatementData): ReportTable[] {
  const { statement, cash } = data;
  const columns = statement.months.map(formatPeriodShortTR);
  const width = columns.length;

  const accrual: TableRow[] = [
    section('GELİRLER', width),
    ...statement.income.map(line),
    { label: 'Toplam Gelir', values: statement.incomeTotal.byMonth, total: statement.incomeTotal.totalMinor, style: 'subtotal' },
    section('GİDERLER', width),
    ...statement.expense.map(line),
    { label: 'Toplam Gider', values: statement.expenseTotal.byMonth, total: statement.expenseTotal.totalMinor, style: 'subtotal' },
    { label: 'NET (Gelir − Gider)', values: statement.net.byMonth, total: statement.net.totalMinor, style: 'net' },
  ];

  // Ay başı bakiyesi = önceki ayın ay sonu bakiyesi
  const monthOpenings = cash.closingByMonth.map((_, i) => (i === 0 ? cash.openingMinor : cash.closingByMonth[i - 1]));
  const cashRows: TableRow[] = [
    { label: 'Ay başı bakiye', values: monthOpenings, total: cash.openingMinor, style: 'subtotal' },
    section('GİRİŞLER', width),
    ...cash.inflow.map(line),
    { label: 'Toplam Giriş', values: cash.inflowTotal.byMonth, total: cash.inflowTotal.totalMinor, style: 'subtotal' },
    section('ÇIKIŞLAR', width),
    ...cash.outflow.map(line),
    { label: 'Toplam Çıkış', values: cash.outflowTotal.byMonth, total: cash.outflowTotal.totalMinor, style: 'subtotal' },
    { label: 'Ay sonu bakiye', values: cash.closingByMonth, total: cash.closingMinor, style: 'net' },
  ];

  return [
    { title: 'Gelir-Gider (tahakkuk esaslı)', columns, totalHeader: 'Dönem Toplamı', rows: accrual },
    { title: 'Kasa + Banka Durumu (nakit, virman hariç)', columns, totalHeader: 'Dönem', rows: cashRows },
  ];
}
