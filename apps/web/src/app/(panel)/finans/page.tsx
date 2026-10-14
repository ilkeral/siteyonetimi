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
  const [type, setType] = useState<string>('');
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
    <div>
      <PageHeader
        title="Finans"
        subtitle="Cari hesaplar ve bakiyeler"
        actions={
          <>
            <Link href="/finans/aidat" className="btn-ghost text-xs">
              Aidat Tahakkuku
            </Link>
            <Link href="/finans/banka" className="btn-ghost text-xs">
              Banka Hareketleri
            </Link>
            <Link href="/finans/tahsilat" className="btn-primary text-xs">
              Tahsilat Gir
            </Link>
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 px-5 py-3">
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Cari adı ara"
            className="field-input max-w-xs"
          />
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
            className="field-input max-w-[12rem]"
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
          <Loading />
        ) : error ? (
          <div className="p-4">
            <ErrorBox error={error} />
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState message="Cari bulunamadı." />
        ) : (
          <>
            <Table
              head={
                <tr>
                  <th className="px-5 py-2">Cari Adı</th>
                  <th className="px-3 py-2">Tip</th>
                  <th className="px-3 py-2">Kod</th>
                  <th className="px-5 py-2 text-right">Bakiye</th>
                </tr>
              }
            >
              {data.items.map((account) => (
                <tr key={account.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-2.5">
                    <Link
                      href={`/finans/cari/${account.id}`}
                      className="font-medium text-slate-800 hover:text-brand-700"
                    >
                      {account.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{TYPE_LABELS[account.type]}</td>
                  <td className="px-3 py-2.5 text-slate-500">{account.code ?? '—'}</td>
                  <td className={`px-5 py-2.5 text-right font-medium ${balanceClass(account.balanceMinor)}`}>
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
    </div>
  );
}
