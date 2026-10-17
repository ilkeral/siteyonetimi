'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { DOCUMENT_TYPE_LABELS } from '@sy/shared';
import { api } from '@/lib/api';
import { balanceClass, date, money } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, Table } from '@/components/ui';
import { usePortalSummary } from '@/components/portal';

interface Statement {
  openingBalanceMinor: number;
  closingBalanceMinor: number;
  totalDebitMinor: number;
  totalCreditMinor: number;
  lines: {
    id: string;
    date: string;
    documentNumber: string;
    documentType: keyof typeof DOCUMENT_TYPE_LABELS;
    description: string | null;
    debitMinor: number;
    creditMinor: number;
    balanceMinor: number;
  }[];
}

export default function PortalAccountPage() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const { data: summary } = usePortalSummary();
  const { data, isLoading, error } = useQuery({
    queryKey: ['portal', 'statement', year],
    queryFn: () => api.get<Statement>(`/portal/statement?from=${year}-01-01&to=${year}-12-31T23:59:59`),
  });

  return (
    <>
      <div className="d-flex flex-wrap align-items-center justify-content-between mb-3" style={{ gap: '.5rem' }}>
        <h1 className="h3 m-0">Hesap Hareketlerim</h1>
        <div className="d-flex align-items-center" style={{ gap: '.5rem' }}>
          <select className="custom-select custom-select-sm" style={{ width: 110 }} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[0, 1, 2, 3].map((offset) => (
              <option key={offset} value={thisYear - offset}>
                {thisYear - offset}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={() => void api.download(`/portal/statement/pdf?from=${year}-01-01&to=${year}-12-31`)}
          >
            PDF İndir
          </button>
          {summary && summary.balanceMinor > 0 && summary.onlinePayment && (
            <Link href="/portal/odeme" className="btn btn-primary btn-sm">
              Online Öde
            </Link>
          )}
        </div>
      </div>

      {error && <ErrorBox error={error} />}
      {isLoading ? (
        <Loading />
      ) : data ? (
        <>
          <div className="row mb-3">
            {[
              { label: 'Devir', value: data.openingBalanceMinor },
              { label: 'Borç', value: data.totalDebitMinor },
              { label: 'Ödeme', value: data.totalCreditMinor },
              { label: 'Bakiye', value: data.closingBalanceMinor },
            ].map((item) => (
              <div className="col-6 col-md-3 mb-2" key={item.label}>
                <div className="card card-shadow mb-0">
                  <div className="card-body py-3">
                    <div className="sy-stat__label">{item.label}</div>
                    <div className={`h5 m-0 sy-num ${item.label === 'Bakiye' ? balanceClass(item.value) : ''}`}>{money(item.value)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Card>
            {data.lines.length === 0 ? (
              <EmptyState message={`${year} yılında hareket yok.`} icon="receipt" />
            ) : (
              <Table
                head={
                  <tr>
                    <th>Tarih</th>
                    <th>Açıklama</th>
                    <th className="text-right">Borç</th>
                    <th className="text-right">Ödeme</th>
                    <th className="text-right">Bakiye</th>
                  </tr>
                }
              >
                {data.lines.map((line) => (
                  <tr key={line.id}>
                    <td>{date(line.date)}</td>
                    <td>
                      {line.description ?? DOCUMENT_TYPE_LABELS[line.documentType]}
                      <small className="d-block text-muted">
                        {DOCUMENT_TYPE_LABELS[line.documentType]} · {line.documentNumber}
                      </small>
                    </td>
                    <td className="text-right sy-num">{line.debitMinor ? money(line.debitMinor) : ''}</td>
                    <td className="text-right sy-num text-success">{line.creditMinor ? money(line.creditMinor) : ''}</td>
                    <td className={`text-right sy-num font-weight-bold ${balanceClass(line.balanceMinor)}`}>{money(line.balanceMinor)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      ) : null}
    </>
  );
}
