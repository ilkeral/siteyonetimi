'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MESSAGE_STATUS_LABELS } from '@sy/shared';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Pagination, StatCard, Table } from '@/components/ui';
import {
  AUDIENCE_GROUPS,
  CampaignStatusBadge,
  ChannelLabel,
  MessageStatusBadge,
  type Audience,
  type CampaignStatus,
  type Channel,
  type MessageStatus,
} from '@/components/notifications';

interface Campaign {
  id: string;
  name: string;
  channel: Channel;
  status: CampaignStatus;
  subject: string | null;
  body: string;
  audience: Audience;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  template: { id: string; name: string } | null;
  counts: Partial<Record<MessageStatus, number>>;
}

interface Message {
  id: string;
  recipient: string;
  status: MessageStatus;
  error: string | null;
  sentAt: string | null;
  subject: string | null;
  body: string;
  person: { id: string; firstName: string; lastName: string } | null;
}

const FILTERS: (MessageStatus | '')[] = ['', 'SENT', 'FAILED', 'QUEUED'];

export default function CampaignDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<MessageStatus | ''>('');
  const [page, setPage] = useState(1);
  const [opened, setOpened] = useState<string | null>(null);

  const live = (data?: Campaign) => data?.status === 'RUNNING';
  const { data, isLoading, error } = useQuery({
    queryKey: ['notifications', 'campaign', params.id],
    queryFn: () => api.get<Campaign>(`/notifications/campaigns/${params.id}`),
    // Gönderim sürerken ilerleme canlı izlenir
    refetchInterval: (query) => (live(query.state.data) ? 1500 : false),
  });

  const { data: messages } = useQuery({
    queryKey: ['notifications', 'messages', params.id, status, page],
    queryFn: () =>
      api.get<{ items: Message[]; total: number; page: number; pageCount: number }>(
        `/notifications/campaigns/${params.id}/messages?page=${page}&pageSize=25${status ? `&status=${status}` : ''}`,
      ),
    enabled: !!data && data.status !== 'DRAFT',
    refetchInterval: live(data) ? 1500 : false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });
  const action = useMutation({
    mutationFn: (kind: 'send' | 'cancel' | 'retry' | 'delete') =>
      kind === 'delete'
        ? api.delete(`/notifications/campaigns/${params.id}`)
        : api.post(`/notifications/campaigns/${params.id}/${kind}`, kind === 'send' ? {} : undefined),
    onSuccess: (_result, kind) => {
      if (kind === 'delete') router.push('/iletisim');
      else void refresh();
    },
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const pending = (data.counts.QUEUED ?? 0) + (data.counts.SENDING ?? 0);
  const done = data.sentCount + data.failedCount;
  const group = AUDIENCE_GROUPS.find((g) => g.value === data.audience.group)?.label;
  const confirmThen = (message: string, kind: 'send' | 'cancel' | 'retry' | 'delete') => {
    if (window.confirm(message)) action.mutate(kind);
  };

  return (
    <>
      <PageHeader
        title={data.name}
        subtitle={`Oluşturma: ${dateTime(data.createdAt)}`}
        breadcrumb={['İletişim', 'Bildirimler', data.name]}
        actions={
          <>
            <CampaignStatusBadge status={data.status} />
            {data.status === 'DRAFT' && (
              <>
                <Link href={`/iletisim/yeni?id=${data.id}`} className="btn btn-outline-secondary btn-sm">
                  Düzenle
                </Link>
                <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => confirmThen('Taslak silinsin mi?', 'delete')}>
                  Sil
                </button>
                <button type="button" className="btn btn-primary btn-sm" disabled={action.isPending} onClick={() => confirmThen('Kampanya şimdi gönderilsin mi?', 'send')}>
                  Şimdi Gönder
                </button>
              </>
            )}
            {['SCHEDULED', 'RUNNING'].includes(data.status) && (
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                disabled={action.isPending}
                onClick={() => confirmThen('Gönderilmemiş mesajlar iptal edilecek. Emin misiniz?', 'cancel')}
              >
                İptal Et
              </button>
            )}
            {data.status === 'COMPLETED' && data.failedCount > 0 && (
              <button type="button" className="btn btn-outline-primary btn-sm" disabled={action.isPending} onClick={() => action.mutate('retry')}>
                Başarısızları Yeniden Dene
              </button>
            )}
            <Link href="/iletisim" className="btn btn-outline-secondary btn-sm">
              Listeye dön
            </Link>
          </>
        }
      />

      {action.error && <ErrorBox error={action.error} />}
      {data.status === 'SCHEDULED' && (
        <div className="alert alert-info">
          {dateTime(data.scheduledAt)} tarihinde gönderilecek. Hedef kitle gönderim anında belirlenir.
        </div>
      )}

      {data.status !== 'DRAFT' && (
        <>
          <div className="row mb-3">
            <div className="col-6 col-lg-3 mb-3">
              <StatCard label="Alıcı" value={data.totalCount} icon="people_outline" />
            </div>
            <div className="col-6 col-lg-3 mb-3">
              <StatCard label="Gönderildi" value={data.sentCount} icon="done_all" tone="success" />
            </div>
            <div className="col-6 col-lg-3 mb-3">
              <StatCard label="Başarısız" value={data.failedCount} icon="error_outline" tone={data.failedCount ? 'danger' : 'default'} />
            </div>
            <div className="col-6 col-lg-3 mb-3">
              <StatCard label="Kuyrukta" value={pending} icon="schedule" tone={pending ? 'primary' : 'default'} />
            </div>
          </div>
          {data.totalCount > 0 && (
            <div className="progress mb-4" style={{ height: 8 }}>
              <div className="progress-bar bg-success" style={{ width: `${(data.sentCount / data.totalCount) * 100}%` }} />
              <div className="progress-bar bg-danger" style={{ width: `${(data.failedCount / data.totalCount) * 100}%` }} />
              {data.status === 'RUNNING' && done < data.totalCount && (
                <div className="progress-bar progress-bar-striped progress-bar-animated bg-secondary" style={{ width: `${(pending / data.totalCount) * 100}%` }} />
              )}
            </div>
          )}
        </>
      )}

      <div className="row">
        <div className="col-xl-4 mb-4">
          <Card title="Kampanya">
            <div className="card-body">
              <dl className="sy-dl">
                <dt>Kanal</dt>
                <dd><ChannelLabel channel={data.channel} /></dd>
                <dt>Hedef</dt>
                <dd>
                  {group}
                  {data.audience.blockIds?.length ? ` · ${data.audience.blockIds.length} blok` : ''}
                  {data.audience.onlyOverdue ? ' · vadesi geçmiş' : ''}
                  {data.audience.minDebt !== undefined ? ` · en az ${data.audience.minDebt} ₺` : ''}
                </dd>
                <dt>Şablon</dt>
                <dd>{data.template?.name ?? '—'}</dd>
                <dt>Başlangıç</dt>
                <dd>{dateTime(data.startedAt)}</dd>
                <dt>Bitiş</dt>
                <dd>{dateTime(data.completedAt)}</dd>
              </dl>
              {data.subject && <div className="font-weight-bold mb-1">{data.subject}</div>}
              <div className="sy-message-sample" style={{ whiteSpace: 'pre-wrap' }}>
                {data.body}
              </div>
            </div>
          </Card>
        </div>

        <div className="col-xl-8">
          {data.status === 'DRAFT' ? (
            <Card>
              <EmptyState message="Taslak henüz gönderilmedi. Gönderince mesajlar burada izlenir." icon="drafts" />
            </Card>
          ) : (
            <Card>
              <div className="card-header p-0">
                <ul className="nav nav-tabs nav-tabs-card">
                  {FILTERS.map((filter) => (
                    <li className="nav-item" key={filter || 'all'}>
                      <button
                        type="button"
                        className={`nav-link${status === filter ? ' active' : ''}`}
                        onClick={() => {
                          setStatus(filter);
                          setPage(1);
                        }}
                      >
                        {filter ? MESSAGE_STATUS_LABELS[filter] : 'Tümü'}
                        <span className="badge badge-light ml-1">
                          {filter ? (data.counts[filter] ?? 0) : data.totalCount}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              {!messages ? (
                <div className="card-body">
                  <Loading />
                </div>
              ) : messages.items.length === 0 ? (
                <EmptyState message="Bu durumda mesaj yok." icon="inbox" />
              ) : (
                <>
                  <Table
                    head={
                      <tr>
                        <th>Kişi</th>
                        <th>Alıcı</th>
                        <th>Durum</th>
                        <th>Gönderim</th>
                        <th>Açıklama</th>
                      </tr>
                    }
                  >
                    {messages.items.map((message) => (
                      <Fragment key={message.id}>
                        <tr style={{ cursor: 'pointer' }} onClick={() => setOpened(opened === message.id ? null : message.id)}>
                          <td>
                            {message.person ? (
                              <Link href={`/site/${message.person.id}`} onClick={(e) => e.stopPropagation()}>
                                {message.person.firstName} {message.person.lastName}
                              </Link>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="sy-num">{message.recipient}</td>
                          <td>
                            <MessageStatusBadge status={message.status} />
                          </td>
                          <td className="text-muted">{dateTime(message.sentAt)}</td>
                          <td className="text-danger small" style={{ whiteSpace: 'normal' }}>
                            {message.error ?? ''}
                          </td>
                        </tr>
                        {opened === message.id && (
                          <tr className="sy-subrow">
                            <td colSpan={5} style={{ whiteSpace: 'pre-wrap' }}>
                              {message.subject && <strong className="d-block mb-1">{message.subject}</strong>}
                              {message.body}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </Table>
                  <Pagination page={messages.page} pageCount={messages.pageCount} total={messages.total} onChange={setPage} />
                </>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
