'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { METER_TYPE_LABELS } from '@sy/shared';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { date, money } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Table } from '@/components/ui';
import { StatusBadge, type DistributionStatus, type MeterType } from '@/components/meters';

interface DistributionRow {
  id: string;
  period: string;
  periodLabel: string;
  name: string | null;
  status: DistributionStatus;
  documentDate: string;
  dueDate: string;
  approvedAt: string | null;
  totalMinor: number;
  types: MeterType[];
  readingCount: number;
  documentCount: number;
}

export default function MeterDistributionsPage() {
  const router = useRouter();
  const { can } = useMe();
  const { data, isLoading, error } = useQuery({
    queryKey: ['meters', 'list'],
    queryFn: () => api.get<DistributionRow[]>('/meters/distributions'),
  });

  return (
    <>
      <PageHeader
        title="Sayaç Dağıtımları"
        subtitle="Yakıt, su ve elektrik faturalarının daire okumalarına göre paylaştırılması"
        breadcrumb={['Sayaç İşlemleri', 'Dağıtımlar']}
        actions={
          can('SITE_ADMIN', 'ACCOUNTANT') ? (
            <Link href="/sayac/yeni" className="btn btn-primary btn-sm">
              <i className="material-icons mr-1" style={{ fontSize: 16 }}>add</i>
              Yeni Dağıtım
            </Link>
          ) : null
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
        ) : data && data.length === 0 ? (
          <EmptyState message="Henüz sayaç dağıtımı yok. İlk dönemi oluşturarak başlayın." icon="av_timer" />
        ) : data ? (
          <Table
            head={
              <tr>
                <th>Dönem</th>
                <th>Dağıtım Adı</th>
                <th>Sayaç Türleri</th>
                <th>Evrak Tarihi</th>
                <th>Son Ödeme</th>
                <th className="text-right">Okuma</th>
                <th className="text-right">Evrak</th>
                <th className="text-right">Toplam</th>
                <th>Durum</th>
              </tr>
            }
          >
            {data.map((row) => (
              <tr key={row.id} style={{ cursor: 'pointer' }} onClick={() => router.push(`/sayac/${row.id}`)}>
                <td className="font-weight-bold">{row.periodLabel}</td>
                <td>{row.name ?? <span className="text-muted">—</span>}</td>
                <td>
                  {row.types.length === 0 ? (
                    <span className="text-muted">—</span>
                  ) : (
                    row.types.map((type) => (
                      <span key={type} className="badge badge-light mr-1">
                        {METER_TYPE_LABELS[type]}
                      </span>
                    ))
                  )}
                </td>
                <td>{date(row.documentDate)}</td>
                <td>{date(row.dueDate)}</td>
                <td className="text-right sy-num">{row.readingCount}</td>
                <td className="text-right sy-num">{row.documentCount}</td>
                <td className="text-right sy-num font-weight-bold">
                  {row.status === 'APPROVED' ? money(row.totalMinor) : <span className="text-muted">—</span>}
                </td>
                <td>
                  <StatusBadge status={row.status} />
                </td>
              </tr>
            ))}
          </Table>
        ) : null}
      </Card>
    </>
  );
}
