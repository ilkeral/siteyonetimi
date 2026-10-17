'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ORGANIZATION_STATUS_LABELS, type OrganizationKind, type OrganizationStatus } from '@sy/shared';
import { api } from '@/lib/api';
import { AccessBadge, Card, ErrorAlert, Icon, Loading, PageHead, StatusBadge, fmt, kindLabel, type Access } from '@/components/platform/kit';

interface OrganizationRow {
  id: string;
  name: string;
  kind: OrganizationKind;
  status: OrganizationStatus;
  access: Access;
  trialEndsAt: string | null;
  paidUntil: string | null;
  contactEmail: string | null;
  city: string | null;
  plan: { name: string; maxSites: number | null; maxUnits: number | null; monthlyPrice: number } | null;
  siteCount: number;
  unitCount: number;
  createdAt: string;
}

export default function OrganizationsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const params = new URLSearchParams();
  if (search.trim()) params.set('search', search.trim());
  if (status) params.set('status', status);

  const { data, isLoading, error } = useQuery({
    queryKey: ['platform', 'organizations', params.toString()],
    queryFn: () => api.get<OrganizationRow[]>(`/platform/organizations?${params.toString()}`),
  });

  return (
    <>
      <PageHead
        title="Müşteriler"
        subtitle="Yönetim şirketleri ve site yönetimleri"
        actions={
          <Link href="/platform/musteriler/yeni" className="pf-btn pf-btn--primary">
            <Icon name="add" size={18} />
            Yeni Müşteri
          </Link>
        }
      />
      <Card
        title={
          <div className="pf-actions" style={{ flex: 1 }}>
            <input
              className="pf-input"
              style={{ maxWidth: 280 }}
              placeholder="Ara: ad, e-posta, vergi no"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Müşteri ara"
            />
            <select className="pf-select" style={{ maxWidth: 200 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Durum">
              <option value="">Tüm durumlar</option>
              {Object.entries(ORGANIZATION_STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <ErrorAlert error={error} />
        {isLoading ? (
          <Loading />
        ) : (
          <div className="pf-table-wrap">
            <table className="pf-table">
              <thead>
                <tr>
                  <th>Müşteri</th>
                  <th>Paket</th>
                  <th>Durum</th>
                  <th className="pf-num">Site</th>
                  <th className="pf-num">Daire</th>
                  <th>Deneme / Ödenen</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((org) => (
                  <tr key={org.id}>
                    <td>
                      <Link href={`/platform/musteriler/${org.id}`} className="pf-strong">
                        {org.name}
                      </Link>
                      <div className="pf-small pf-muted">
                        {kindLabel(org.kind)}
                        {org.city ? ` · ${org.city}` : ''}
                      </div>
                    </td>
                    <td>
                      {org.plan ? (
                        <>
                          {org.plan.name}
                          <div className="pf-small pf-muted">{fmt.tl(org.plan.monthlyPrice)}/ay</div>
                        </>
                      ) : (
                        <span className="pf-muted">Özel</span>
                      )}
                    </td>
                    <td>
                      <div className="pf-actions">
                        <StatusBadge status={org.status} />
                        <AccessBadge access={org.access} />
                      </div>
                    </td>
                    <td className="pf-num">
                      {org.siteCount}
                      {org.plan?.maxSites ? <span className="pf-muted"> / {org.plan.maxSites}</span> : null}
                    </td>
                    <td className="pf-num">
                      {fmt.num(org.unitCount)}
                      {org.plan?.maxUnits ? <span className="pf-muted"> / {fmt.num(org.plan.maxUnits)}</span> : null}
                    </td>
                    <td className="pf-muted">
                      {org.status === 'TRIAL' ? `Deneme: ${fmt.date(org.trialEndsAt)}` : org.paidUntil ? `Ödenen: ${fmt.date(org.paidUntil)}` : '—'}
                    </td>
                  </tr>
                ))}
                {data?.length === 0 && (
                  <tr>
                    <td colSpan={6} className="pf-empty">
                      Müşteri bulunamadı.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
