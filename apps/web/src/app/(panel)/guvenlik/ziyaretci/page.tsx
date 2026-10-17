'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { todayInput } from '@/lib/format';
import { Card, ErrorBox, Loading, PageHeader, Pagination } from '@/components/ui';
import { type Page, type Visitor } from '@/components/security';
import { VisitorCheckInForm, VisitorTable } from '@/components/visitors';

type Tab = 'inside' | 'today' | 'all';

const TABS: { key: Tab; label: string }[] = [
  { key: 'inside', label: 'İçeride' },
  { key: 'today', label: 'Bugün' },
  { key: 'all', label: 'Tüm Kayıtlar' },
];

export default function VisitorsPage() {
  const [tab, setTab] = useState<Tab>('inside');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (tab === 'inside') params.set('inside', 'true');
  if (tab === 'today') {
    params.set('from', todayInput());
    params.set('to', todayInput());
  }
  if (tab === 'all') {
    if (from) params.set('from', from);
    if (to) params.set('to', to);
  }
  if (search.trim()) params.set('search', search.trim());

  const { data, isLoading, error } = useQuery({
    queryKey: ['security', 'visitors', params.toString()],
    queryFn: () => api.get<Page<Visitor>>(`/security/visitors?${params.toString()}`),
    refetchInterval: tab === 'inside' ? 60_000 : false,
  });

  function filter(update: () => void) {
    update();
    setPage(1);
  }

  return (
    <>
      <PageHeader
        title="Ziyaretçiler"
        subtitle="Kapı giriş-çıkış defteri"
        breadcrumb={['Güvenlik', 'Ziyaretçiler']}
      />
      <div className="row">
        <div className="col-lg-4">
          <Card title="Ziyaretçi Girişi">
            <div className="card-body">
              <VisitorCheckInForm />
            </div>
          </Card>
        </div>
        <div className="col-lg-8">
          <Card>
            <div className="card-header">
              <ul className="nav nav-tabs card-header-tabs">
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
                style={{ maxWidth: 260 }}
                placeholder="Ara: ad, plaka, ev sahibi, TC (tam)"
                value={search}
                onChange={(e) => filter(() => setSearch(e.target.value))}
              />
              {tab === 'all' && (
                <>
                  <input
                    type="date"
                    className="form-control form-control-sm"
                    style={{ maxWidth: 160 }}
                    value={from}
                    onChange={(e) => filter(() => setFrom(e.target.value))}
                    aria-label="Başlangıç"
                  />
                  <input
                    type="date"
                    className="form-control form-control-sm"
                    style={{ maxWidth: 160 }}
                    value={to}
                    onChange={(e) => filter(() => setTo(e.target.value))}
                    aria-label="Bitiş"
                  />
                </>
              )}
            </div>
            {error && <ErrorBox error={error} />}
            {isLoading ? (
              <Loading />
            ) : (
              <>
                <VisitorTable
                  visitors={data?.items ?? []}
                  emptyMessage={tab === 'inside' ? 'Şu an içeride kayıtlı ziyaretçi yok.' : 'Kayıt bulunamadı.'}
                />
                {data && data.total > 0 && (
                  <Pagination page={data.page} pageCount={data.pageCount} total={data.total} onChange={setPage} />
                )}
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
