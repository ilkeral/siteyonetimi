'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  INCOME_STATEMENT_MAX_MONTHS,
  formatPeriodShortTR,
  monthRange,
  type CashFlow,
  type IncomeStatement,
  type StatementLine,
} from '@sy/shared';
import { api } from '@/lib/api';
import { CHART_COLORS, chartTextColor, money, moneyShort, todayInput } from '@/lib/format';
import { Card, ErrorBox, Loading, PageHeader, StatCard } from '@/components/ui';
import { ReportActions } from '@/components/reports';

interface Report {
  from: string;
  to: string;
  statement: IncomeStatement;
  cash: CashFlow;
}

/** Kategorik kimlik renkleri — durum (yeşil/kırmızı) renkleri gelir/gider için kullanılmaz */
const INCOME_COLOR = CHART_COLORS[0];
const EXPENSE_COLOR = CHART_COLORS[2];

interface Row {
  label: string;
  values: (number | null)[];
  total: number | null;
  style: 'section' | 'line' | 'subtotal' | 'net';
}

const lineRow = (l: StatementLine): Row => ({ label: l.label, values: l.byMonth, total: l.totalMinor, style: 'line' });

export default function IncomeStatementPage() {
  const thisMonth = todayInput().slice(0, 7);
  const [from, setFrom] = useState(`${thisMonth.slice(0, 4)}-01`);
  const [to, setTo] = useState(thisMonth);
  const [shown, setShown] = useState<string | null>(null);

  const rangeError = useMemo(() => {
    try {
      const months = monthRange(from, to);
      return months.length > INCOME_STATEMENT_MAX_MONTHS ? `En fazla ${INCOME_STATEMENT_MAX_MONTHS} ay seçilebilir` : null;
    } catch {
      return 'Bitiş ayı başlangıçtan önce olamaz';
    }
  }, [from, to]);

  const query = `from=${from}&to=${to}`;
  const { data, isFetching, error } = useQuery({
    queryKey: ['report', 'income-statement', shown],
    queryFn: () => api.get<Report>(`/reports/income-statement?${shown}`),
    enabled: !!shown,
  });

  const months = data?.statement.months ?? [];
  const width = months.length;
  const section = (label: string): Row => ({ label, values: Array(width).fill(null), total: null, style: 'section' });

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Gelir-Gider"
          subtitle="Tahakkuk esaslı gelir ve gider, kasa+banka nakit durumu"
          breadcrumb={['Raporlar', 'Gelir-Gider']}
        />
      </div>

      <Card className="mb-4 no-print">
        <div className="card-body">
          <div className="row align-items-end">
            <div className="col-6 col-md-3 form-group">
              <label className="form-label" htmlFor="ie-from">Başlangıç Ayı</label>
              <input id="ie-from" type="month" className="form-control" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="col-6 col-md-3 form-group">
              <label className="form-label" htmlFor="ie-to">Bitiş Ayı</label>
              <input id="ie-to" type="month" className="form-control" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="col-md-6 form-group text-muted small">
              Gelir, tahakkuk edildiği ayda sayılır (tahsil edilip edilmediğine bakılmaz). Nakit durumu kasa ve banka
              hesaplarının gerçek giriş-çıkışıdır; kasa↔banka virmanı hariçtir.
            </div>
          </div>
          {rangeError && <div className="text-danger small mb-2">{rangeError}</div>}
          <ReportActions
            onShow={() => setShown(query)}
            pdfPath={`/reports/income-statement/pdf?${query}`}
            xlsxPath={`/reports/income-statement/xlsx?${query}`}
            canPrint={!!data}
            disabled={!!rangeError}
          />
        </div>
      </Card>

      {error && <ErrorBox error={error} />}
      {isFetching && <Loading label="Rapor hazırlanıyor..." />}
      {data && !isFetching && (
        <div className="sy-report">
          <div className="sy-report__head">
            <h1 className="h4 mb-0">Gelir-Gider Raporu</h1>
            <span className="text-muted">
              {formatPeriodShortTR(data.from)} – {formatPeriodShortTR(data.to)}
            </span>
          </div>

          <div className="row mb-3">
            <div className="col-6 col-xl-3 mb-3">
              <StatCard label="Toplam Gelir" value={money(data.statement.incomeTotal.totalMinor)} icon="trending_up" />
            </div>
            <div className="col-6 col-xl-3 mb-3">
              <StatCard label="Toplam Gider" value={money(data.statement.expenseTotal.totalMinor)} icon="receipt" />
            </div>
            <div className="col-6 col-xl-3 mb-3">
              <StatCard
                label={data.statement.net.totalMinor >= 0 ? 'Dönem Fazlası' : 'Dönem Açığı'}
                value={money(data.statement.net.totalMinor)}
                icon="account_balance"
                tone={data.statement.net.totalMinor >= 0 ? 'success' : 'danger'}
              />
            </div>
            <div className="col-6 col-xl-3 mb-3">
              <StatCard
                label="Dönem Sonu Kasa+Banka"
                value={money(data.cash.closingMinor)}
                icon="account_balance_wallet"
                hint={`Dönem başı ${money(data.cash.openingMinor)}`}
              />
            </div>
          </div>

          <Card title="Aylık Gelir ve Gider" className="mb-4">
            <div className="card-body" style={{ height: 280 }}>
              <IncomeExpenseChart statement={data.statement} />
            </div>
          </Card>

          <MonthTable
            title="Gelir-Gider (tahakkuk esaslı)"
            months={months}
            totalHeader="Dönem Toplamı"
            rows={[
              section('GELİRLER'),
              ...data.statement.income.map(lineRow),
              { label: 'Toplam Gelir', values: data.statement.incomeTotal.byMonth, total: data.statement.incomeTotal.totalMinor, style: 'subtotal' },
              section('GİDERLER'),
              ...data.statement.expense.map(lineRow),
              { label: 'Toplam Gider', values: data.statement.expenseTotal.byMonth, total: data.statement.expenseTotal.totalMinor, style: 'subtotal' },
              { label: 'NET (Gelir − Gider)', values: data.statement.net.byMonth, total: data.statement.net.totalMinor, style: 'net' },
            ]}
          />

          <MonthTable
            title="Kasa + Banka Durumu (nakit, virman hariç)"
            months={months}
            totalHeader="Dönem"
            rows={[
              {
                label: 'Ay başı bakiye',
                values: data.cash.closingByMonth.map((_, i) => (i === 0 ? data.cash.openingMinor : data.cash.closingByMonth[i - 1])),
                total: data.cash.openingMinor,
                style: 'subtotal',
              },
              section('GİRİŞLER'),
              ...data.cash.inflow.map(lineRow),
              { label: 'Toplam Giriş', values: data.cash.inflowTotal.byMonth, total: data.cash.inflowTotal.totalMinor, style: 'subtotal' },
              section('ÇIKIŞLAR'),
              ...data.cash.outflow.map(lineRow),
              { label: 'Toplam Çıkış', values: data.cash.outflowTotal.byMonth, total: data.cash.outflowTotal.totalMinor, style: 'subtotal' },
              { label: 'Ay sonu bakiye', values: data.cash.closingByMonth, total: data.cash.closingMinor, style: 'net' },
            ]}
          />
        </div>
      )}
    </>
  );
}

function IncomeExpenseChart({ statement }: { statement: IncomeStatement }) {
  const axis = chartTextColor();
  const chartData = statement.months.map((month, i) => ({
    label: formatPeriodShortTR(month),
    income: statement.incomeTotal.byMonth[i],
    expense: statement.expenseTotal.byMonth[i],
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--sy-border)" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: axis }} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={(v) => moneyShort(Number(v))} tick={{ fontSize: 11, fill: axis }} tickLine={false} axisLine={false} width={56} />
        <Tooltip
          cursor={{ fill: 'var(--sy-surface-2)' }}
          formatter={(value: number, name) => [money(value), name]}
          contentStyle={{
            fontSize: 12,
            borderRadius: 5,
            background: 'var(--sy-surface)',
            border: '1px solid var(--sy-border)',
            color: 'var(--sy-text)',
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: axis }} />
        <Bar dataKey="income" name="Gelir" fill={INCOME_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        <Bar dataKey="expense" name="Gider" fill={EXPENSE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function MonthTable({ title, months, totalHeader, rows }: { title: string; months: string[]; totalHeader: string; rows: Row[] }) {
  const cell = (value: number | null, style: Row['style']) => {
    if (value === null) return '';
    if (style === 'line' && value === 0) return <span className="text-muted">—</span>;
    return money(value);
  };
  return (
    <Card title={title} className="mb-4">
      <div className="table-responsive">
        <table className="table table-sm table-nowrap mb-0 sy-month-table">
          <thead className="thead-light">
            <tr>
              <th />
              {months.map((m) => (
                <th key={m} className="text-right">
                  {formatPeriodShortTR(m)}
                </th>
              ))}
              <th className="text-right">{totalHeader}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.label}-${index}`} className={`sy-month-table__${row.style}`}>
                <th scope="row" className={row.style === 'line' ? 'pl-4 font-weight-normal' : ''}>
                  {row.label}
                </th>
                {row.values.map((value, i) => (
                  <td key={i} className={`text-right sy-num${row.style === 'net' && value !== null && value < 0 ? ' text-danger' : ''}`}>
                    {cell(value, row.style)}
                  </td>
                ))}
                <td className={`text-right sy-num font-weight-bold${row.style === 'net' && (row.total ?? 0) < 0 ? ' text-danger' : ''}`}>
                  {cell(row.total, row.style)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
