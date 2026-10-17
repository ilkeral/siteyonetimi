'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LOST_ITEM_STATUS_LABELS, type LostItemCreateInput } from '@sy/shared';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Pagination, Table } from '@/components/ui';
import { LostStatusBadge, type LostItem, type LostItemStatus, type Page } from '@/components/security';
import { LostItemCreateForm } from '@/components/lost-items';

type Tab = 'open' | LostItemStatus | 'all';

const TABS: { key: Tab; label: string }[] = [
  { key: 'open', label: 'Açık' },
  { key: 'LOST', label: LOST_ITEM_STATUS_LABELS.LOST },
  { key: 'FOUND', label: LOST_ITEM_STATUS_LABELS.FOUND },
  { key: 'CLAIMED', label: LOST_ITEM_STATUS_LABELS.CLAIMED },
  { key: 'DELIVERED', label: LOST_ITEM_STATUS_LABELS.DELIVERED },
  { key: 'DISPOSED', label: LOST_ITEM_STATUS_LABELS.DISPOSED },
  { key: 'all', label: 'Tümü' },
];

export default function LostItemsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <LostItems />
    </Suspense>
  );
}

function LostItems() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const requested = searchParams.get('yeni');
  const [creating, setCreating] = useState<'FOUND' | 'LOST' | null>(
    requested === 'LOST' ? 'LOST' : requested === 'FOUND' ? 'FOUND' : null,
  );
  const [tab, setTab] = useState<Tab>('open');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (tab === 'open') params.set('open', 'true');
  else if (tab !== 'all') params.set('status', tab);
  if (search.trim()) params.set('search', search.trim());

  const { data, isLoading, error } = useQuery({
    queryKey: ['security', 'lost-items', params.toString()],
    queryFn: () => api.get<Page<LostItem>>(`/security/lost-items?${params.toString()}`),
  });

  const create = useMutation({
    mutationFn: (payload: LostItemCreateInput) => api.post<{ id: string }>('/security/lost-items', payload),
    onSuccess: (item) => {
      void queryClient.invalidateQueries({ queryKey: ['security'] });
      router.push(`/guvenlik/kayip-esya/${item.id}`);
    },
  });

  function filter(update: () => void) {
    update();
    setPage(1);
  }

  return (
    <>
      <PageHeader
        title="Kayıp Eşya"
        subtitle="Kayıp bildirimi → emanet → sahibine teslim ya da süresi dolunca imha/bağış"
        breadcrumb={['Güvenlik', 'Kayıp Eşya']}
        actions={
          !creating && (
            <>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setCreating('LOST')}>
                Kayıp Bildirimi
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating('FOUND')}>
                <i className="material-icons mr-1" style={{ fontSize: 16 }}>add</i>
                Bulunan Eşya
              </button>
            </>
          )
        }
      />

      {creating && (
        <Card title="Yeni Kayıt" className="mb-4">
          <div className="card-body">
            <LostItemCreateForm
              initialStatus={creating}
              pending={create.isPending}
              error={create.error}
              onSubmit={(payload) => create.mutate(payload)}
              onCancel={() => setCreating(null)}
            />
          </div>
        </Card>
      )}

      <Card>
        <div className="card-header">
          <ul className="nav nav-tabs card-header-tabs flex-nowrap sy-tabs-scroll">
            {TABS.map((t) => (
              <li className="nav-item" key={t.key}>
                <button
                  type="button"
                  className={`nav-link btn btn-link${tab === t.key ? ' active' : ''}`}
                  onClick={() => filter(() => setTab(t.key))}
                >
                  {t.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="card-body py-2 d-flex flex-wrap align-items-center sy-board-filters">
          <input
            className="form-control form-control-sm"
            style={{ maxWidth: 280 }}
            placeholder="Ara: emanet no, eşya, yer, sahibi..."
            value={search}
            onChange={(e) => filter(() => setSearch(e.target.value))}
          />
        </div>

        {error && <ErrorBox error={error} />}
        {isLoading ? (
          <Loading />
        ) : !data?.items.length ? (
          <EmptyState message="Kayıt bulunamadı." icon="business_center" />
        ) : (
          <>
            <Table
              head={
                <tr>
                  <th>No</th>
                  <th>Eşya</th>
                  <th>Durum</th>
                  <th>Bulunma / Kayıp</th>
                  <th>Sahibi</th>
                  <th>Emanetçi</th>
                  <th className="text-right">Emanette</th>
                </tr>
              }
            >
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td className="sy-num text-muted">#{item.number}</td>
                  <td>
                    <Link href={`/guvenlik/kayip-esya/${item.id}`} className="font-weight-bold">
                      {item.itemName}
                    </Link>
                    {item.location && <small className="d-block text-muted">{item.location}</small>}
                  </td>
                  <td>
                    <LostStatusBadge status={item.status} />
                  </td>
                  <td className="sy-num">{date(item.foundAt ?? item.lostAt ?? item.createdAt)}</td>
                  <td>{item.loserName ?? <span className="text-muted">Bilinmiyor</span>}</td>
                  <td>{item.custodianName ?? '—'}</td>
                  <td className="text-right sy-num">{item.daysInCustody !== null ? `${item.daysInCustody} gün` : '—'}</td>
                </tr>
              ))}
            </Table>
            <Pagination page={data.page} pageCount={data.pageCount} total={data.total} onChange={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
