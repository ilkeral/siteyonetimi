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
    <>
      <PageHeader
        title="Cari Hesap Ekstresi"
        subtitle="Seçilen tarih aralığındaki tüm hareketler"
        actions={
          <>
            <Link href="/finans" className="btn btn-outline-secondary btn-sm">
              Cari listesi
            </Link>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => window.print()}
            >
              <i className="material-icons mr-1" style={{ fontSize: 15 }}>
                print
              </i>
              Yazdır
            </button>
          </>
        }
      />

      <Card className="mb-4">
        <div className="card-body d-flex flex-wrap align-items-end" style={{ gap: '1rem' }}>
          <div className="form-group mb-0">
            <label className="form-label">İlk Tarih</label>
            <input
              type="date"
              className="form-control"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="form-group mb-0">
            <label className="form-label">Son Tarih</label>
            <input
              type="date"
              className="form-control"
              value={to}
              onChange={(event) => setTo(event.target.value)}
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
          <div className="card-body border-bottom">
            <div className="row">
              <Summary label="Devir" value={money(data.openingBalanceMinor)} />
              <Summary label="Toplam Borç" value={money(data.totalDebitMinor)} />
              <Summary label="Toplam Alacak" value={money(data.totalCreditMinor)} />
              <Summary
                label="Kalan Bakiye"
                value={money(data.closingBalanceMinor)}
                className={balanceClass(data.closingBalanceMinor)}
              />
            </div>
          </div>

          {data.lines.length === 0 ? (
            <EmptyState message="Bu tarih aralığında hareket yok." icon="receipt_long" />
          ) : (
            <Table
              head={
                <tr>
                  <th>Tarih</th>
                  <th>Evrak No</th>
                  <th>Tür</th>
                  <th>Açıklama</th>
                  <th>Daire</th>
                  <th className="text-right">Borç</th>
                  <th className="text-right">Alacak</th>
                  <th className="text-right">Bakiye</th>
                </tr>
              }
            >
              {data.lines.map((line) => (
                <tr key={line.id}>
                  <td>{date(line.date)}</td>
                  <td>
                    <code style={{ fontSize: 11 }}>{line.documentNumber}</code>
                  </td>
                  <td>
                    <span className="badge badge-secondary">
                      {DOCUMENT_LABELS[line.documentType] ?? line.documentType}
                    </span>
                  </td>
                  <td>{line.description ?? '—'}</td>
                  <td className="text-muted">{line.unit ?? '—'}</td>
                  <td className="text-right sy-num">
                    {line.debitMinor > 0 ? money(line.debitMinor) : ''}
                  </td>
                  <td className="text-right sy-num text-success">
                    {line.creditMinor > 0 ? money(line.creditMinor) : ''}
                  </td>
                  <td className={`text-right sy-num font-weight-bold ${balanceClass(line.balanceMinor)}`}>
                    {money(line.balanceMinor)}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </>
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
    <div className="col-6 col-md-3">
      <div className="sy-stat__label">{label}</div>
      <div className={`font-weight-bold sy-num ${className ?? ''}`}>{value}</div>
    </div>
  );
}
