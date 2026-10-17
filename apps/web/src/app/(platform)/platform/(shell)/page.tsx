'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { OrganizationStatus } from '@sy/shared';
import { api } from '@/lib/api';
import { Card, ErrorAlert, Icon, Loading, PageHead, Stat, StatusBadge, fmt } from '@/components/platform/kit';

interface Overview {
  organizations: { total: number; byStatus: Partial<Record<OrganizationStatus, number>>; newLast30Days: number };
  mrr: number;
  sites: number;
  units: number;
  users: { residents: number; staff: number };
  activeSupportAccess: number;
  trialsEnding: { id: string; name: string; trialEndsAt: string; daysLeft: number }[];
  pastDue: { id: string; name: string; status: OrganizationStatus; paidUntil: string | null }[];
  recent: { id: string; name: string; status: OrganizationStatus; createdAt: string; plan: { name: string } | null }[];
}

export default function PlatformOverviewPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['platform', 'overview'], queryFn: () => api.get<Overview>('/platform/overview') });

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorAlert error={error ?? new Error('Özet alınamadı')} />;
  const s = data.organizations.byStatus;

  return (
    <>
      <PageHead
        title="Platform Özeti"
        subtitle="Müşteriler, abonelikler ve kullanım"
        actions={
          <Link href="/platform/musteriler/yeni" className="pf-btn pf-btn--primary">
            <Icon name="add" size={18} />
            Yeni Müşteri
          </Link>
        }
      />

      <div className="pf-grid pf-grid--stats">
        <Stat accent label="Aylık Tekrarlayan Gelir" value={fmt.tl(data.mrr)} hint="Aktif müşterilerin paket fiyatı, KDV hariç" />
        <Stat label="Müşteri" value={fmt.num(data.organizations.total)} hint={`Son 30 günde ${data.organizations.newLast30Days} yeni`} />
        <Stat label="Aktif" value={fmt.num(s.ACTIVE ?? 0)} hint={`Denemede ${s.TRIAL ?? 0}`} />
        <Stat label="Ödeme Bekleyen / Askıda" value={`${s.PAST_DUE ?? 0} / ${s.SUSPENDED ?? 0}`} hint={`İptal ${s.CANCELLED ?? 0}`} />
        <Stat label="Yönetilen Site" value={fmt.num(data.sites)} hint={`${fmt.num(data.units)} aktif daire`} />
        <Stat
          label="Kullanıcı"
          value={fmt.num(data.users.staff + data.users.residents)}
          hint={`${fmt.num(data.users.staff)} personel · ${fmt.num(data.users.residents)} ikamet eden`}
        />
      </div>

      <div className="pf-grid pf-grid--2">
        <Card title="Deneme Süresi Bitenler (7 gün)">
          {data.trialsEnding.length === 0 ? (
            <div className="pf-empty">Yakında biten deneme yok.</div>
          ) : (
            <ul className="pf-list">
              {data.trialsEnding.map((org) => (
                <li key={org.id}>
                  <Link href={`/platform/musteriler/${org.id}`}>{org.name}</Link>
                  <span className={`pf-badge ${org.daysLeft <= 0 ? 'pf-badge--danger' : 'pf-badge--warning'}`}>
                    {org.daysLeft <= 0 ? 'Süresi doldu' : `${org.daysLeft} gün`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Ödemesi Gecikenler">
          {data.pastDue.length === 0 ? (
            <div className="pf-empty">Ödemesi geciken müşteri yok.</div>
          ) : (
            <ul className="pf-list">
              {data.pastDue.map((org) => (
                <li key={org.id}>
                  <Link href={`/platform/musteriler/${org.id}`}>{org.name}</Link>
                  <span className="pf-small pf-muted">
                    <StatusBadge status={org.status} /> {org.paidUntil ? `ödenen: ${fmt.date(org.paidUntil)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card
          title="Son Eklenen Müşteriler"
          actions={
            <Link href="/platform/musteriler" className="pf-btn pf-btn--ghost pf-btn--sm">
              Tümü
            </Link>
          }
          foot={
            data.activeSupportAccess > 0 ? (
              <span className="pf-small">
                <Icon name="headset_mic" size={16} /> Şu an {data.activeSupportAccess} açık destek erişimi var.{' '}
                <Link href="/platform/destek">Görüntüle</Link>
              </span>
            ) : undefined
          }
        >
          <div className="pf-table-wrap">
            <table className="pf-table">
              <thead>
                <tr>
                  <th>Müşteri</th>
                  <th>Paket</th>
                  <th>Durum</th>
                  <th>Kayıt</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((org) => (
                  <tr key={org.id}>
                    <td>
                      <Link href={`/platform/musteriler/${org.id}`} className="pf-strong">
                        {org.name}
                      </Link>
                    </td>
                    <td>{org.plan?.name ?? <span className="pf-muted">Özel</span>}</td>
                    <td>
                      <StatusBadge status={org.status} />
                    </td>
                    <td className="pf-muted">{fmt.date(org.createdAt)}</td>
                  </tr>
                ))}
                {data.recent.length === 0 && (
                  <tr>
                    <td colSpan={4} className="pf-empty">
                      Henüz müşteri yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
