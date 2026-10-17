'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { INCIDENT_CATEGORY_LABELS } from '@sy/shared';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, StatCard } from '@/components/ui';
import { SeverityBadge, type IncidentRow, type Page, type SecuritySummary, type Visitor } from '@/components/security';
import { VisitorTable } from '@/components/visitors';

/** Güvenlik özeti — görevlinin vardiya başında baktığı ekran */
export default function SecurityHomePage() {
  const summary = useQuery({
    queryKey: ['security', 'summary'],
    queryFn: () => api.get<SecuritySummary>('/security/summary'),
    refetchInterval: 60_000,
  });
  const inside = useQuery({
    queryKey: ['security', 'visitors', 'inside'],
    queryFn: () => api.get<Page<Visitor>>('/security/visitors?inside=true&pageSize=50'),
    refetchInterval: 60_000,
  });
  const incidents = useQuery({
    queryKey: ['security', 'incidents', 'latest'],
    queryFn: () => api.get<Page<IncidentRow>>('/security/incidents?pageSize=6'),
  });

  const s = summary.data;

  return (
    <>
      <PageHeader
        title="Güvenlik"
        subtitle="Ziyaretçi giriş-çıkışı, olay kayıtları ve kayıp eşya emaneti"
        breadcrumb={['Güvenlik']}
        actions={
          <>
            <Link href="/guvenlik/kayip-esya?yeni=FOUND" className="btn btn-outline-secondary btn-sm">
              <i className="material-icons mr-1" style={{ fontSize: 16 }}>business_center</i>
              Bulunan Eşya
            </Link>
            <Link href="/guvenlik/olaylar/yeni" className="btn btn-outline-secondary btn-sm">
              <i className="material-icons mr-1" style={{ fontSize: 16 }}>report_problem</i>
              Olay Kaydı
            </Link>
            <Link href="/guvenlik/ziyaretci" className="btn btn-primary btn-sm">
              <i className="material-icons mr-1" style={{ fontSize: 16 }}>person_add</i>
              Ziyaretçi Girişi
            </Link>
          </>
        }
      />

      {summary.error && <ErrorBox error={summary.error} />}
      <div className="row mb-4">
        <div className="col-6 col-xl-3 mb-3">
          <StatCard
            label="İçerideki Ziyaretçi"
            value={s?.visitorsInside ?? '—'}
            icon="people_outline"
            tone={s?.visitorsOverstay ? 'warning' : 'primary'}
            hint={s ? (s.visitorsOverstay ? `${s.visitorsOverstay} kişi 12 saati aştı` : `Bugün ${s.visitorsToday} giriş`) : undefined}
          />
        </div>
        <div className="col-6 col-xl-3 mb-3">
          <StatCard
            label="Olay (son 30 gün)"
            value={s?.incidentsLast30Days ?? '—'}
            icon="report_problem"
            tone={s?.highIncidentsLast30Days ? 'danger' : 'default'}
            hint={s ? `${s.highIncidentsLast30Days} yüksek önem` : undefined}
          />
        </div>
        <div className="col-6 col-xl-3 mb-3">
          <StatCard
            label="Emanetteki Eşya"
            value={s?.lostInCustody ?? '—'}
            icon="business_center"
            hint={s ? `${s.lostAwaitingDelivery} teslim bekliyor` : undefined}
          />
        </div>
        <div className="col-6 col-xl-3 mb-3">
          <StatCard
            label="Açık Kayıp Bildirimi"
            value={s?.lostReports ?? '—'}
            icon="search"
            tone={s?.lostReports ? 'warning' : 'default'}
            hint="Henüz bulunmadı"
          />
        </div>
      </div>

      <div className="row">
        <div className="col-xl-8">
          <Card
            title="İçerideki Ziyaretçiler"
            actions={
              <Link href="/guvenlik/ziyaretci" className="btn btn-link btn-sm">
                Tüm kayıtlar
              </Link>
            }
          >
            {inside.error && <ErrorBox error={inside.error} />}
            {inside.isLoading ? (
              <Loading />
            ) : (
              <VisitorTable visitors={inside.data?.items ?? []} emptyMessage="Şu an içeride kayıtlı ziyaretçi yok." />
            )}
          </Card>
        </div>
        <div className="col-xl-4">
          <Card
            title="Son Olaylar"
            actions={
              <Link href="/guvenlik/olaylar" className="btn btn-link btn-sm">
                Tümü
              </Link>
            }
          >
            {incidents.isLoading ? (
              <Loading />
            ) : !incidents.data?.items.length ? (
              <EmptyState message="Kayıtlı olay yok." icon="verified_user" />
            ) : (
              <ul className="list-group list-group-flush">
                {incidents.data.items.map((incident) => (
                  <li key={incident.id} className="list-group-item">
                    <div className="d-flex align-items-start justify-content-between" style={{ gap: '.5rem' }}>
                      <Link href={`/guvenlik/olaylar/${incident.id}`} className="font-weight-bold">
                        {incident.title}
                      </Link>
                      <SeverityBadge severity={incident.severity} />
                    </div>
                    <small className="text-muted">
                      {dateTime(incident.date)} · {INCIDENT_CATEGORY_LABELS[incident.category]}
                      {incident.unit ? ` · ${incident.unit.label}` : ''}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
