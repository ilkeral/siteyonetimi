'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  PageHeader,
  Pagination,
  Table,
} from '@/components/ui';

interface UnitRow {
  id: string;
  doorNumber: string;
  floor: number | null;
  area: string | null;
  roomCount: string | null;
  status: 'OCCUPIED' | 'EMPTY' | 'UNDER_RENOVATION';
  isExempt: boolean;
  block: { id: string; name: string } | null;
  owner: { id: string; firstName: string; lastName: string; phone: string | null } | null;
  tenant: { id: string; firstName: string; lastName: string; phone: string | null } | null;
}

interface BlockRow {
  id: string;
  name: string;
  _count: { units: number };
}

const STATUS = {
  OCCUPIED: { label: 'Dolu', tone: 'badge-success' },
  EMPTY: { label: 'Boş', tone: 'badge-secondary' },
  UNDER_RENOVATION: { label: 'Tadilatta', tone: 'badge-warning' },
} as const;

export default function UnitsPage() {
  const [page, setPage] = useState(1);
  const [blockId, setBlockId] = useState('');
  const [search, setSearch] = useState('');

  const { data: blocks } = useQuery({
    queryKey: ['blocks'],
    queryFn: () => api.get<BlockRow[]>('/blocks'),
  });

  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (blockId) params.set('blockId', blockId);
  if (search) params.set('search', search);

  const { data, isLoading, error } = useQuery({
    queryKey: ['units', params.toString()],
    queryFn: () =>
      api.get<{ items: UnitRow[]; total: number; page: number; pageCount: number }>(
        `/units?${params}`,
      ),
  });

  return (
    <>
      <PageHeader title="Daireler" subtitle="Bloklar, daireler ve oturanlar" />

      <Card>
        <div className="card-body py-3 d-flex flex-wrap align-items-center" style={{ gap: '1rem' }}>
          <div className="search-form" style={{ maxWidth: 260, flex: 1 }}>
            <input
              type="search"
              className="form-control"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Daire no ara"
            />
            <button className="btn" type="button">
              <i className="material-icons">search</i>
            </button>
          </div>

          <select
            className="custom-select"
            style={{ maxWidth: 220 }}
            value={blockId}
            onChange={(event) => {
              setBlockId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Tüm bloklar</option>
            {blocks?.map((block) => (
              <option key={block.id} value={block.id}>
                {block.name} ({block._count.units})
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="card-body">
            <Loading />
          </div>
        ) : error ? (
          <div className="card-body">
            <ErrorBox error={error} />
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState message="Daire bulunamadı." icon="home_work" />
        ) : (
          <>
            <Table
              head={
                <tr>
                  <th>Daire</th>
                  <th>Blok</th>
                  <th>Kat</th>
                  <th>m²</th>
                  <th>Oda</th>
                  <th>Kat Maliki</th>
                  <th>Kiracı</th>
                  <th>Durum</th>
                </tr>
              }
            >
              {data.items.map((unit) => (
                <tr key={unit.id}>
                  <td className="font-weight-bold">{unit.doorNumber}</td>
                  <td className="text-muted">{unit.block?.name ?? '—'}</td>
                  <td>{unit.floor ?? '—'}</td>
                  <td className="sy-num">{unit.area ? Number(unit.area) : '—'}</td>
                  <td>{unit.roomCount ?? '—'}</td>
                  <td>
                    {unit.owner ? (
                      <Link href={`/site/${unit.owner.id}`}>
                        {unit.owner.firstName} {unit.owner.lastName}
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    {unit.tenant ? (
                      <Link href={`/site/${unit.tenant.id}`}>
                        {unit.tenant.firstName} {unit.tenant.lastName}
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${STATUS[unit.status].tone}`}>
                      {STATUS[unit.status].label}
                    </span>
                    {unit.isExempt && <span className="badge badge-warning ml-1">Muaf</span>}
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
