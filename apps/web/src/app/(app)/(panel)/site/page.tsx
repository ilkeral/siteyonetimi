'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
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
  const { can } = useMe();

  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (search) params.set('search', search);
  if (letter) params.set('letter', letter);
  if (onlyDebtors) params.set('onlyDebtors', 'true');

  const { data, isLoading, error } = useQuery({
    queryKey: ['people', params.toString()],
    queryFn: () => api.get<PageResult>(`/people?${params}`),
  });

  return (
    <>
      <PageHeader
        title="Kişiler"
        subtitle="Kat malikleri, kiracılar ve bakiyeleri"
        actions={
          can('SITE_ADMIN', 'ACCOUNTANT') && (
            <>
              {can('SITE_ADMIN') && (
                <Link href="/site/ice-aktar" className="btn btn-outline-secondary">
                  Toplu Aktarım
                </Link>
              )}
              <Link href="/site/yeni" className="btn btn-primary">
                <i className="material-icons mr-1" style={{ fontSize: 16 }}>
                  person_add
                </i>
                Yeni Kişi
              </Link>
            </>
          )
        }
      />

      <Card>
        <div className="card-body py-3 d-flex flex-wrap align-items-center" style={{ gap: '1rem' }}>
          <div className="search-form" style={{ maxWidth: 360, flex: 1 }}>
            <input
              type="search"
              className="form-control"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Ad, soyad, TC, telefon veya e-posta ara"
            />
            <button className="btn" type="button">
              <i className="material-icons">search</i>
            </button>
          </div>

          <div className="custom-control custom-checkbox">
            <input
              type="checkbox"
              className="custom-control-input"
              id="onlyDebtors"
              checked={onlyDebtors}
              onChange={(event) => {
                setOnlyDebtors(event.target.checked);
                setPage(1);
              }}
            />
            <label className="custom-control-label" htmlFor="onlyDebtors">
              Sadece borçlular
            </label>
          </div>
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
          <EmptyState message="Kayıt bulunamadı." icon="person_search" />
        ) : (
          <>
            <Table
              head={
                <tr>
                  <th>Adı Soyadı</th>
                  <th>TC Kimlik</th>
                  <th>Telefon</th>
                  <th>E-Posta</th>
                  <th>Daireler</th>
                  <th className="text-right">Bakiye</th>
                </tr>
              }
            >
              {data.items.map((person) => (
                <tr key={person.id}>
                  <td>
                    <Link href={`/site/${person.id}`} className="font-weight-bold">
                      {person.fullName}
                    </Link>
                    {person.inLegalAction && (
                      <span className="badge badge-danger ml-2">İcra takibinde</span>
                    )}
                  </td>
                  <td className="text-muted">{person.nationalId ?? '—'}</td>
                  <td className="text-muted">{person.phone ?? '—'}</td>
                  <td className="text-muted">{person.email ?? '—'}</td>
                  <td>
                    {person.units.length === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      person.units.map((unit, index) => (
                        <span
                          key={index}
                          className={`badge mr-1 ${
                            unit.role === 'OWNER' ? 'badge-primary' : 'badge-purple'
                          }`}
                          title={unit.blockName ?? undefined}
                        >
                          {unit.doorNumber}({unit.role === 'OWNER' ? 'M' : 'K'})
                        </span>
                      ))
                    )}
                  </td>
                  <td className={`text-right sy-num font-weight-bold ${balanceClass(person.balanceMinor)}`}>
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
    </>
  );
}
