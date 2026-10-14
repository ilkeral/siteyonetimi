'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { balanceClass, date, money } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Table } from '@/components/ui';

interface Statement {
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  totalDebitMinor: number;
  totalCreditMinor: number;
  lines: {
    id: string;
    date: string;
    documentNumber: string;
    documentType: string;
    description: string | null;
    category: string | null;
    unit: string | null;
    debitMinor: number;
    creditMinor: number;
    balanceMinor: number;
  }[];
}

const DOCUMENT_LABELS: Record<string, string> = {
  OPENING_BALANCE: 'Açılış',
  DUES_ACCRUAL: 'Aidat',
  METER_DISTRIBUTION: 'Sayaç',
  LATE_FEE: 'Gecikme',
  EXPENSE: 'Gider',
  INCOME: 'Gelir',
  COLLECTION: 'Tahsilat',
  PAYMENT: 'Ödeme',
  TRANSFER: 'Virman',
};

export default function StatementPage() {
  const params = useParams<{ id: string }>();
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const { data, isLoading, error } = useQuery({
    queryKey: ['statement', params.id, from, to],
    queryFn: () =>
      api.get<Statement>(`/finance/accounts/${params.id}/statement?from=${from}&to=${to}`),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cari Hesap Ekstresi"
        subtitle="Seçilen tarih aralığındaki tüm hareketler"
        actions={
          <>
            <Link href="/finans" className="btn-ghost text-xs">
              Cari listesi
            </Link>
            <button type="button" onClick={() => window.print()} className="btn-ghost text-xs">
              Yazdır
            </button>
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap items-end gap-4 px-5 py-4">
          <div>
            <label className="field-label">İlk Tarih</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="field-input"
            />
          </div>
          <div>
            <label className="field-label">Son Tarih</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="field-input"
            />
          </div>
        </div>
      </Card>

      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} />
      ) : !data ? null : (
        <Card>
          <div className="grid grid-cols-2 gap-4 border-b border-slate-100 px-5 py-4 text-sm sm:grid-cols-4">
            <Summary label="Devir" value={money(data.openingBalanceMinor)} />
            <Summary label="Toplam Borç" value={money(data.totalDebitMinor)} />
            <Summary label="Toplam Alacak" value={money(data.totalCreditMinor)} />
            <Summary
              label="Kalan Bakiye"
              value={money(data.closingBalanceMinor)}
              className={balanceClass(data.closingBalanceMinor)}
            />
          </div>

          {data.lines.length === 0 ? (
            <EmptyState message="Bu tarih aralığında hareket yok." />
          ) : (
            <Table
              head={
                <tr>
                  <th className="px-5 py-2">Tarih</th>
                  <th className="px-3 py-2">Evrak No</th>
                  <th className="px-3 py-2">Tür</th>
                  <th className="px-3 py-2">Açıklama</th>
                  <th className="px-3 py-2">Daire</th>
                  <th className="px-3 py-2 text-right">Borç</th>
                  <th className="px-3 py-2 text-right">Alacak</th>
                  <th className="px-5 py-2 text-right">Bakiye</th>
                </tr>
              }
            >
              {data.lines.map((line) => (
                <tr key={line.id} className="hover:bg-slate-50/60">
                  <td className="whitespace-nowrap px-5 py-2">{date(line.date)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">
                    {line.documentNumber}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {DOCUMENT_LABELS[line.documentType] ?? line.documentType}
                  </td>
                  <td className="px-3 py-2">{line.description ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{line.unit ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {line.debitMinor > 0 ? money(line.debitMinor) : ''}
                  </td>
                  <td className="px-3 py-2 text-right text-emerald-700">
                    {line.creditMinor > 0 ? money(line.creditMinor) : ''}
                  </td>
                  <td className={`px-5 py-2 text-right font-medium ${balanceClass(line.balanceMinor)}`}>
                    {money(line.balanceMinor)}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}

function Summary({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-0.5 font-semibold ${className ?? 'text-slate-800'}`}>{value}</div>
    </div>
  );
}
