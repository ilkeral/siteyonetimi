'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { balanceClass, money } from '@/lib/format';
import {
  Card,
  EmptyState,
  ErrorBox,
  LetterFilter,
  Loading,
  PageHeader,
  Pagination,
  Table,
} from '@/components/ui';

interface AccountRow {
  id: string;
  name: string;
  type: 'PERSON' | 'SUPPLIER' | 'EMPLOYEE' | 'CASH' | 'BANK';
  code: string | null;
  balanceMinor: number;
}

const TYPE_LABELS: Record<AccountRow['type'], string> = {
  PERSON: 'Kişi',
  SUPPLIER: 'Tedarikçi',
  EMPLOYEE: 'Personel',
  CASH: 'Kasa',
  BANK: 'Banka',
};

export default function FinancePage() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [letter, setLetter] = useState<string | undefined>();

  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (type) params.set('type', type);
  if (search) params.set('search', search);
  if (letter) params.set('letter', letter);

  const { data, isLoading, error } = useQuery({
    queryKey: ['accounts', params.toString()],
    queryFn: () =>
      api.get<{ items: AccountRow[]; total: number; page: number; pageCount: number }>(
        `/finance/accounts?${params}`,
      ),
  });

  return (
    <>
      <PageHeader
        title="Finans"
        subtitle="Cari hesaplar ve bakiyeler"
        actions={
          <>
            <Link href="/finans/aidat" className="btn btn-outline-secondary btn-sm">
              Aidat Tahakkuku
            </Link>
            <Link href="/finans/banka" className="btn btn-outline-secondary btn-sm">
              Banka Hareketleri
            </Link>
            <Link href="/finans/tahsilat" className="btn btn-primary btn-sm">
              Tahsilat Gir
            </Link>
          </>
        }
      />

      <Card>
        <div className="card-body py-3 d-flex flex-wrap align-items-center" style={{ gap: '1rem' }}>
          <div className="search-form" style={{ maxWidth: 320, flex: 1 }}>
            <input
              type="search"
              className="form-control"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Cari adı ara"
            />
            <button className="btn" type="button">
              <i className="material-icons">search</i>
            </button>
          </div>

          <select
            className="custom-select"
            style={{ maxWidth: 200 }}
            value={type}
            onChange={(event) => {
              setType(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Tüm cari tipleri</option>
            {Object.entries(TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <LetterFilter
          value={letter}
          onChange={(value) => {
            setLetter(value);
            setPage(1);
          }}
        />

        {isLoading ? (
          <div className="card-body">
            <Loading />
          </div>
        ) : error ? (
          <div className="card-body">
            <ErrorBox error={error} />
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState message="Cari bulunamadı." icon="search_off" />
        ) : (
          <>
            <Table
              head={
                <tr>
                  <th>Cari Adı</th>
                  <th>Tip</th>
                  <th>Kod</th>
                  <th className="text-right">Bakiye</th>
                </tr>
              }
            >
              {data.items.map((account) => (
                <tr key={account.id}>
                  <td>
                    <Link href={`/finans/cari/${account.id}`} className="font-weight-bold">
                      {account.name}
                    </Link>
                  </td>
                  <td>
                    <span className="badge badge-secondary">{TYPE_LABELS[account.type]}</span>
                  </td>
                  <td className="text-muted">{account.code ?? '—'}</td>
                  <td className={`text-right sy-num font-weight-bold ${balanceClass(account.balanceMinor)}`}>
                    {money(account.balanceMinor)}
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination
              page={data.page}
              pageCount={data.pageCount}
              total={data.total}
              onChange={setPage}
            />
          </>
        )}
      </Card>
    </>
  );
}
