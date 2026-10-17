'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { TICKET_STATUS_LABELS, TICKET_STATUS_ORDER, TICKET_TYPE_LABELS } from '@sy/shared';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Pagination, Table } from '@/components/ui';
import { PriorityBadge, StatusBadge, TypeBadge, type TicketCard } from '@/components/tickets';

interface TicketPage {
  items: TicketCard[];
  total: number;
  page: number;
  pageCount: number;
}

/** Tüm talepler — panodan farklı olarak eski tamamlananlar da burada */
export default function TicketListPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [requestType, setRequestType] = useState('');

  const params = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (search.trim()) params.set('search', search.trim());
  if (status) params.set('status', status);
  if (requestType) params.set('requestType', requestType);

  const { data, isLoading, error } = useQuery({
    queryKey: ['tickets', 'list', params.toString()],
    queryFn: () => api.get<TicketPage>(`/tickets?${params.toString()}`),
  });

  function filter(update: () => void) {
    update();
    setPage(1);
  }

  return (
    <>
      <PageHeader
        title="Talep Listesi"
        breadcrumb={['Teknik', 'Talep Listesi']}
        actions={
          <>
            <Link href="/teknik" className="btn btn-outline-secondary btn-sm">
              <i className="material-icons mr-1" style={{ fontSize: 16 }}>view_column</i>
              Pano
            </Link>
            <Link href="/teknik/yeni" className="btn btn-primary btn-sm">
              <i className="material-icons mr-1" style={{ fontSize: 16 }}>add</i>
              Yeni Talep
            </Link>
          </>
        }
      />

      <Card>
        <div className="card-body py-2 d-flex flex-wrap align-items-center sy-board-filters">
          <input
            className="form-control form-control-sm"
            style={{ maxWidth: 240 }}
            placeholder="Ara: #no, konu, kişi..."
            value={search}
            onChange={(event) => filter(() => setSearch(event.target.value))}
          />
          <select
            className="custom-select custom-select-sm"
            value={status}
            onChange={(event) => filter(() => setStatus(event.target.value))}
          >
            <option value="">Tüm durumlar</option>
            {TICKET_STATUS_ORDER.map((key) => (
              <option key={key} value={key}>
                {TICKET_STATUS_LABELS[key]}
              </option>
            ))}
          </select>
          <select
            className="custom-select custom-select-sm"
            value={requestType}
            onChange={(event) => filter(() => setRequestType(event.target.value))}
          >
            <option value="">Tüm tipler</option>
            {Object.entries(TICKET_TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="card-body">
            <ErrorBox error={error} />
          </div>
        )}
        {isLoading ? (
          <div className="card-body">
            <Loading />
          </div>
        ) : data && data.items.length === 0 ? (
          <EmptyState message="Kriterlere uyan talep yok." icon="build" />
        ) : data ? (
          <>
            <Table
              head={
                <tr>
                  <th>No</th>
                  <th>Tarih</th>
                  <th>Konu</th>
                  <th>Tip</th>
                  <th>Daire / Kişi</th>
                  <th>Sorumlu</th>
                  <th>Hedef</th>
                  <th>Durum</th>
                </tr>
              }
            >
              {data.items.map((ticket) => (
                <tr
                  key={ticket.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => router.push(`/teknik/${ticket.id}`)}
                >
                  <td className="text-muted">#{ticket.number}</td>
                  <td>{date(ticket.date)}</td>
                  <td>
                    <span className="font-weight-bold mr-1">{ticket.subject}</span>
                    <PriorityBadge priority={ticket.priority} />
                  </td>
                  <td>
                    <TypeBadge type={ticket.requestType} />
                  </td>
                  <td className="text-muted">
                    {[ticket.unit?.label, ticket.person?.fullName].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td>{ticket.assignee?.fullName ?? <span className="text-muted">Atanmadı</span>}</td>
                  <td className={ticket.overdue ? 'text-danger font-weight-bold' : ''}>
                    {date(ticket.dueDate)}
                  </td>
                  <td>
                    <StatusBadge status={ticket.status} />
                  </td>
                </tr>
              ))}
            </Table>
            <Pagination page={data.page} pageCount={data.pageCount} total={data.total} onChange={setPage} />
          </>
        ) : null}
      </Card>
    </>
  );
}
