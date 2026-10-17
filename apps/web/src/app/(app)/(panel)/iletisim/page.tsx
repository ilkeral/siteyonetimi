'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Pagination, Table } from '@/components/ui';
import { CampaignStatusBadge, ChannelLabel, type CampaignStatus, type Channel } from '@/components/notifications';

interface CampaignRow {
  id: string;
  name: string;
  channel: Channel;
  status: CampaignStatus;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  scheduledAt: string | null;
  startedAt: string | null;
  createdAt: string;
  template: { id: string; name: string } | null;
}

export default function CampaignsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ['notifications', 'campaigns', page],
    queryFn: () =>
      api.get<{ items: CampaignRow[]; total: number; page: number; pageCount: number }>(
        `/notifications/campaigns?page=${page}&pageSize=25`,
      ),
    // Gönderimi süren kampanya varsa liste kendini tazelesin
    refetchInterval: (query) =>
      query.state.data?.items.some((c) => c.status === 'RUNNING') ? 2000 : false,
  });

  return (
    <>
      <PageHeader
        title="Bildirimler"
        subtitle="Toplu e-posta, SMS, WhatsApp ve sesli mesaj kampanyaları"
        breadcrumb={['İletişim', 'Bildirimler']}
        actions={
          <>
            <Link href="/iletisim/sablonlar" className="btn btn-outline-secondary btn-sm">
              Şablonlar
            </Link>
            <Link href="/iletisim/yeni" className="btn btn-primary btn-sm">
              <i className="material-icons mr-1" style={{ fontSize: 16 }}>add</i>
              Yeni Bildirim
            </Link>
          </>
        }
      />

      <Card>
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
          <EmptyState message="Henüz bildirim gönderilmedi." icon="mail_outline" />
        ) : data ? (
          <>
            <Table
              head={
                <tr>
                  <th>Kampanya</th>
                  <th>Kanal</th>
                  <th>Tarih</th>
                  <th style={{ width: 220 }}>İlerleme</th>
                  <th>Durum</th>
                </tr>
              }
            >
              {data.items.map((campaign) => {
                const done = campaign.sentCount + campaign.failedCount;
                const percent = campaign.totalCount ? Math.round((done / campaign.totalCount) * 100) : 0;
                return (
                  <tr key={campaign.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/iletisim/${campaign.id}`)}>
                    <td>
                      <div className="font-weight-bold">{campaign.name}</div>
                      {campaign.template && <small className="text-muted">Şablon: {campaign.template.name}</small>}
                    </td>
                    <td>
                      <ChannelLabel channel={campaign.channel} />
                    </td>
                    <td className="text-muted">
                      {campaign.status === 'SCHEDULED'
                        ? `Zamanlandı: ${dateTime(campaign.scheduledAt)}`
                        : dateTime(campaign.startedAt ?? campaign.createdAt)}
                    </td>
                    <td>
                      {campaign.totalCount > 0 ? (
                        <>
                          <div className="progress" style={{ height: 6 }}>
                            <div className="progress-bar bg-success" style={{ width: `${(campaign.sentCount / campaign.totalCount) * 100}%` }} />
                            <div className="progress-bar bg-danger" style={{ width: `${(campaign.failedCount / campaign.totalCount) * 100}%` }} />
                          </div>
                          <small className="text-muted">
                            {campaign.sentCount}/{campaign.totalCount} gönderildi
                            {campaign.failedCount > 0 && <span className="text-danger"> · {campaign.failedCount} başarısız</span>}
                            {campaign.status === 'RUNNING' && ` · %${percent}`}
                          </small>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      <CampaignStatusBadge status={campaign.status} />
                    </td>
                  </tr>
                );
              })}
            </Table>
            <Pagination page={data.page} pageCount={data.pageCount} total={data.total} onChange={setPage} />
          </>
        ) : null}
      </Card>
    </>
  );
}
