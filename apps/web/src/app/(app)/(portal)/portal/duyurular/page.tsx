'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading } from '@/components/ui';
import type { Announcement } from '@/components/portal';

export default function PortalAnnouncementsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['portal', 'announcements'],
    queryFn: () => api.get<Announcement[]>('/portal/announcements'),
  });

  return (
    <>
      <h1 className="h3 mb-3">Duyurular</h1>
      {error && <ErrorBox error={error} />}
      {isLoading ? (
        <Loading />
      ) : data && data.length === 0 ? (
        <Card>
          <EmptyState message="Yayında duyuru yok." icon="announcement" />
        </Card>
      ) : (
        data?.map((item) => (
          <Card key={item.id} className={`mb-3${item.isPinned ? ' sy-pinned' : ''}`}>
            <div className="card-body">
              <div className="d-flex justify-content-between align-items-start mb-2">
                <h2 className="h5 m-0">
                  {item.isPinned && <i className="material-icons text-warning mr-1" style={{ fontSize: 18, verticalAlign: -3 }}>star</i>}
                  {item.title}
                </h2>
                <small className="text-muted text-nowrap ml-3">{date(item.publishAt)}</small>
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{item.body}</div>
            </div>
          </Card>
        ))
      )}
    </>
  );
}
