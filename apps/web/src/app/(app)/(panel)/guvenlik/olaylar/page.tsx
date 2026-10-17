'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { INCIDENT_CATEGORY_LABELS, INCIDENT_SEVERITY_LABELS } from '@sy/shared';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Pagination, Table } from '@/components/ui';
import { SeverityBadge, type IncidentRow, type Page } from '@/components/security';

export default function IncidentsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (search.trim()) params.set('search', search.trim());
  if (category) params.set('category', category);
  if (severity) params.set('severity', severity);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const { data, isLoading, error } = useQuery({
    queryKey: ['security', 'incidents', params.toString()],
    queryFn: () => api.get<Page<IncidentRow>>(`/security/incidents?${params.toString()}`),
  });

  function filter(update: () => void) {
    update();
    setPage(1);
  }

  return (
    <>
      <PageHeader
        title="Olay Kayıtları"
        breadcrumb={['Güvenlik', 'Olay Kayıtları']}
        actions={
          <Link href="/guvenlik/olaylar/yeni" className="btn btn-primary btn-sm">
            <i className="material-icons mr-1" style={{ fontSize: 16 }}>add</i>
            Yeni Olay
          </Link>
        }
      />

      <Card>
        <div className="card-body py-2 d-flex flex-wrap align-items-center sy-board-filters">
          <input
            className="form-control form-control-sm"
            style={{ maxWidth: 240 }}
            placeholder="Ara: başlık, açıklama..."
            value={search}
            onChange={(e) => filter(() => setSearch(e.target.value))}
          />
          <select className="custom-select custom-select-sm" value={category} onChange={(e) => filter(() => setCategory(e.target.value))}>
            <option value="">Tüm kategoriler</option>
            {Object.entries(INCIDENT_CATEGORY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <select className="custom-select custom-select-sm" value={severity} onChange={(e) => filter(() => setSeverity(e.target.value))}>
            <option value="">Tüm önem dereceleri</option>
            {Object.entries(INCIDENT_SEVERITY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
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
        </div>

        {error && <ErrorBox error={error} />}
        {isLoading ? (
          <Loading />
        ) : !data?.items.length ? (
          <EmptyState message="Olay kaydı bulunamadı." icon="verified_user" />
        ) : (
          <>
            <Table
              head={
                <tr>
                  <th>Tarih</th>
                  <th>Olay</th>
                  <th>Kategori</th>
                  <th>Önem</th>
                  <th>Daire / Kişi</th>
                  <th>Görevli</th>
                </tr>
              }
            >
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td className="sy-num">{dateTime(row.date)}</td>
                  <td style={{ whiteSpace: 'normal', minWidth: 260 }}>
                    <Link href={`/guvenlik/olaylar/${row.id}`} className="font-weight-bold">
                      {row.title}
                    </Link>
                    <small className="d-block text-muted">{row.excerpt}</small>
                  </td>
                  <td>{INCIDENT_CATEGORY_LABELS[row.category]}</td>
                  <td>
                    <SeverityBadge severity={row.severity} />
                  </td>
                  <td>
                    {row.unit?.label ?? '—'}
                    {row.person && <small className="d-block text-muted">{row.person.fullName}</small>}
                  </td>
                  <td>{row.staff?.fullName ?? '—'}</td>
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
