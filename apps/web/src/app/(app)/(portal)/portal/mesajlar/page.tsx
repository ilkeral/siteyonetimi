'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CHANNEL_LABELS } from '@sy/shared';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, Pagination } from '@/components/ui';

interface Message {
  id: string;
  channel: keyof typeof CHANNEL_LABELS;
  subject: string | null;
  body: string;
  sentAt: string | null;
  createdAt: string;
}

export default function PortalMessagesPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ['portal', 'messages', page],
    queryFn: () =>
      api.get<{ items: Message[]; total: number; page: number; pageCount: number }>(`/portal/messages?page=${page}&pageSize=20`),
  });

  return (
    <>
      <h1 className="h3 mb-3">Bana Gönderilen Bildirimler</h1>
      {error && <ErrorBox error={error} />}
      <Card>
        {isLoading ? (
          <div className="card-body">
            <Loading />
          </div>
        ) : data && data.items.length === 0 ? (
          <EmptyState message="Size gönderilmiş bildirim yok." icon="mail_outline" />
        ) : data ? (
          <>
            <ul className="list-group list-group-flush">
              {data.items.map((message) => (
                <li key={message.id} className="list-group-item">
                  <div className="d-flex justify-content-between mb-1">
                    <span className="badge badge-light">{CHANNEL_LABELS[message.channel]}</span>
                    <small className="text-muted">{dateTime(message.sentAt ?? message.createdAt)}</small>
                  </div>
                  {message.subject && <strong className="d-block">{message.subject}</strong>}
                  <div style={{ whiteSpace: 'pre-wrap' }}>{message.body}</div>
                </li>
              ))}
            </ul>
            <Pagination page={data.page} pageCount={data.pageCount} total={data.total} onChange={setPage} />
          </>
        ) : null}
      </Card>
    </>
  );
}
