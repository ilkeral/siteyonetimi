'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { balanceClass, money } from '@/lib/format';
import {
  Badge,
  Card,
  EmptyState,
  ErrorBox,
  LetterFilter,
  Loading,
  PageHeader,
  Pagination,
  Table,
} from '@/components/ui';

interface PersonRow {
  id: string;
  fullName: string;
  nationalId: string | null;
  phone: string | null;
  email: string | null;
  inLegalAction: boolean;
  balanceMinor: number;
  units: { doorNumber: string; blockName: string | null; role: 'OWNER' | 'TENANT' }[];
}

interface PageResult {
  items: PersonRow[];
  total: number;
  page: number;
  pageCount: number;
}

export default function PeoplePage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [letter, setLetter] = useState<string | undefined>();
  const [onlyDebtors, setOnlyDebtors] = useState(false);

  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (search) params.set('search', search);
  if (letter) params.set('letter', letter);
  if (onlyDebtors) params.set('onlyDebtors', 'true');

  const { data, isLoading, error } = useQuery({
    queryKey: ['people', params.toString()],
    queryFn: () => api.get<PageResult>(`/people?${params}`),
  });

  return (
    <div>
      <PageHeader
        title="Kişiler"
        subtitle="Kat malikleri, kiracılar ve bakiyeleri"
        actions={
          <Link href="/site/yeni" className="btn-primary text-xs">
            Yeni Kişi
          </Link>
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
            placeholder="Ad, soyad, TC, telefon veya e-posta ara"
            className="field-input max-w-sm"
          />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={onlyDebtors}
              onChange={(e) => {
                setOnlyDebtors(e.target.checked);
                setPage(1);
              }}
            />
            Sadece borçlular
          </label>
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
          <EmptyState message="Kayıt bulunamadı." />
        ) : (
          <>
            <Table
              head={
                <tr>
                  <th className="px-5 py-2">Adı Soyadı</th>
                  <th className="px-3 py-2">TC Kimlik</th>
                  <th className="px-3 py-2">Telefon</th>
                  <th className="px-3 py-2">E-Posta</th>
                  <th className="px-3 py-2">Daireler</th>
                  <th className="px-5 py-2 text-right">Bakiye</th>
                </tr>
              }
            >
              {data.items.map((person) => (
                <tr key={person.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-2.5">
                    <Link
                      href={`/site/${person.id}`}
                      className="font-medium text-slate-800 hover:text-brand-700"
                    >
                      {person.fullName}
                    </Link>
                    {person.inLegalAction && (
                      <span className="ml-2">
                        <Badge tone="red">İcra takibinde</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-slate-500">{person.nationalId ?? '—'}</td>
                  <td className="px-3 py-2.5 text-slate-500">{person.phone ?? '—'}</td>
                  <td className="px-3 py-2.5 text-slate-500">{person.email ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {person.units.map((unit, i) => (
                        <Badge key={i} tone={unit.role === 'OWNER' ? 'blue' : 'purple'}>
                          {unit.doorNumber}({unit.role === 'OWNER' ? 'M' : 'K'})
                        </Badge>
                      ))}
                      {person.units.length === 0 && <span className="text-slate-400">—</span>}
                    </div>
                  </td>
                  <td className={`px-5 py-2.5 text-right font-medium ${balanceClass(person.balanceMinor)}`}>
                    {money(person.balanceMinor)}
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
