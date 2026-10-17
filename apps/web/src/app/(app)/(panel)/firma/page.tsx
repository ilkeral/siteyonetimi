'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ORGANIZATION_KIND_LABELS,
  ORGANIZATION_STATUS_LABELS,
  PLAN_FEATURES,
  siteCreateSchema,
  type OrganizationKind,
  type OrganizationStatus,
  type PlanFeature,
  type SiteCreateInput,
} from '@sy/shared';
import { api, session } from '@/lib/api';
import { date, money } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Table } from '@/components/ui';

interface LimitCheck {
  limit: number | null;
  used: number;
  remaining: number | null;
}

interface Organization {
  id: string;
  name: string;
  kind: OrganizationKind;
  status: OrganizationStatus;
  trialEndsAt: string | null;
  paidUntil: string | null;
  access: { level: 'FULL' | 'READ_ONLY' | 'BLOCKED'; reason: string | null; daysLeft: number | null };
  plan: { name: string; monthlyPrice: number; maxSites: number | null; maxUnits: number | null; features: string[] } | null;
  usage: { sites: LimitCheck; units: LimitCheck };
  sites: { id: string; name: string; city: string | null; district: string | null; isActive: boolean; unitCount: number }[];
}

const STATUS_TONE: Record<OrganizationStatus, string> = {
  TRIAL: 'badge-info',
  ACTIVE: 'badge-success',
  PAST_DUE: 'badge-warning',
  SUSPENDED: 'badge-danger',
  CANCELLED: 'badge-secondary',
};

function UsageBar({ label, check }: { label: string; check: LimitCheck }) {
  const ratio = check.limit ? Math.min(1, check.used / check.limit) : 0;
  const tone = ratio >= 1 ? 'bg-danger' : ratio >= 0.85 ? 'bg-warning' : 'bg-primary';
  return (
    <div className="mb-3">
      <div className="d-flex justify-content-between small mb-1">
        <strong>{label}</strong>
        <span className="text-muted">
          {check.used} / {check.limit ?? 'sınırsız'}
        </span>
      </div>
      {check.limit !== null && (
        <div className="progress" style={{ height: 8 }}>
          <div className={`progress-bar ${tone}`} role="progressbar" style={{ width: `${ratio * 100}%` }} aria-valuenow={check.used} aria-valuemax={check.limit} />
        </div>
      )}
    </div>
  );
}

/**
 * Firma ve abonelik — müşteri hesabının sahibi (yönetim şirketi) için:
 * paket, kullanım, siteler ve paket sınırı içinde yeni site açma.
 */
export default function OrganizationPage() {
  const queryClient = useQueryClient();
  const [newSite, setNewSite] = useState<{ orgId: string; name: string; city: string; district: string } | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['organization', 'mine'],
    queryFn: () => api.get<Organization[]>('/organization/mine'),
  });

  const create = useMutation({
    mutationFn: ({ orgId, body }: { orgId: string; body: SiteCreateInput }) => api.post<{ id: string }>(`/organization/${orgId}/sites`, body),
    onSuccess: () => {
      setNewSite(null);
      void queryClient.invalidateQueries({ queryKey: ['organization'] });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data?.length) return <EmptyState message="Bir müşteri hesabının sahibi değilsiniz." icon="business" />;

  return (
    <>
      <PageHeader title="Firma ve Abonelik" subtitle="Paketiniz, kullanımınız ve yönettiğiniz siteler" breadcrumb={['Firma']} />
      {data.map((org) => (
        <div key={org.id} className="mb-4">
          <div className="row">
            <div className="col-lg-5">
              <Card title={org.name}>
                <div className="card-body">
                  <div className="d-flex flex-wrap align-items-center mb-3" style={{ gap: '.5rem' }}>
                    <span className={`badge ${STATUS_TONE[org.status]}`}>{ORGANIZATION_STATUS_LABELS[org.status]}</span>
                    <span className="text-muted small">{ORGANIZATION_KIND_LABELS[org.kind]}</span>
                  </div>
                  {org.access.reason && <div className="alert alert-warning py-2">{org.access.reason}</div>}
                  <dl className="row small mb-3">
                    <dt className="col-5 text-muted font-weight-normal">Paket</dt>
                    <dd className="col-7">{org.plan ? `${org.plan.name} · ${money(Math.round(org.plan.monthlyPrice * 100))}/ay` : 'Özel sözleşme'}</dd>
                    {org.status === 'TRIAL' && (
                      <>
                        <dt className="col-5 text-muted font-weight-normal">Deneme bitişi</dt>
                        <dd className="col-7">{date(org.trialEndsAt)}</dd>
                      </>
                    )}
                    {org.paidUntil && (
                      <>
                        <dt className="col-5 text-muted font-weight-normal">Abonelik bitişi</dt>
                        <dd className="col-7">{date(org.paidUntil)}</dd>
                      </>
                    )}
                  </dl>
                  <UsageBar label="Site" check={org.usage.sites} />
                  <UsageBar label="Aktif daire (tüm siteler)" check={org.usage.units} />
                  <div className="small text-muted mb-2">Paketteki modüller</div>
                  <div className="d-flex flex-wrap" style={{ gap: '.35rem' }}>
                    {(Object.keys(PLAN_FEATURES) as PlanFeature[]).map((feature) => {
                      const on = !org.plan || org.plan.features.includes(feature);
                      return (
                        <span key={feature} className={`badge ${on ? 'badge-primary' : 'badge-light text-muted'}`} title={on ? undefined : 'Paketinizde yok'}>
                          {!on && <i className="material-icons" style={{ fontSize: 12, verticalAlign: -2 }}>lock</i>} {PLAN_FEATURES[feature]}
                        </span>
                      );
                    })}
                  </div>
                  <p className="small text-muted mt-3 mb-0">Paket değişikliği için hizmet sağlayıcınızla iletişime geçin.</p>
                </div>
              </Card>
            </div>
            <div className="col-lg-7">
              <Card
                title="Siteler"
                actions={
                  org.access.level === 'FULL' &&
                  !newSite && (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setNewSite({ orgId: org.id, name: '', city: '', district: '' })}>
                      Yeni Site
                    </button>
                  )
                }
              >
                {newSite?.orgId === org.id && (
                  <form
                    className="card-body border-bottom"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const parsed = siteCreateSchema.safeParse({ name: newSite.name, city: newSite.city || null, district: newSite.district || null });
                      if (parsed.success) create.mutate({ orgId: org.id, body: parsed.data });
                    }}
                  >
                    <div className="row">
                      <div className="col-md-6 form-group">
                        <label className="form-label">Site adı</label>
                        <input className="form-control" value={newSite.name} autoFocus onChange={(e) => setNewSite({ ...newSite, name: e.target.value })} />
                      </div>
                      <div className="col-md-3 form-group">
                        <label className="form-label">İl</label>
                        <input className="form-control" value={newSite.city} onChange={(e) => setNewSite({ ...newSite, city: e.target.value })} />
                      </div>
                      <div className="col-md-3 form-group">
                        <label className="form-label">İlçe</label>
                        <input className="form-control" value={newSite.district} onChange={(e) => setNewSite({ ...newSite, district: e.target.value })} />
                      </div>
                    </div>
                    <p className="small text-muted">Kategoriler, kasa/banka hesabı, departmanlar ve bildirim şablonları hazır gelir; siz yönetici olarak eklenirsiniz.</p>
                    {Boolean(create.error) && <ErrorBox error={create.error} />}
                    <div className="d-flex" style={{ gap: '.5rem' }}>
                      <button type="submit" className="btn btn-primary btn-sm" disabled={create.isPending || newSite.name.trim().length < 2}>
                        Siteyi Aç
                      </button>
                      <button type="button" className="btn btn-light btn-sm" onClick={() => setNewSite(null)}>
                        Vazgeç
                      </button>
                    </div>
                  </form>
                )}
                <Table
                  head={
                    <tr>
                      <th>Site</th>
                      <th className="text-right">Aktif Daire</th>
                      <th>Durum</th>
                      <th />
                    </tr>
                  }
                >
                  {org.sites.map((site) => (
                    <tr key={site.id}>
                      <td>
                        <strong>{site.name}</strong>
                        <small className="d-block text-muted">{[site.district, site.city].filter(Boolean).join(' / ') || '—'}</small>
                      </td>
                      <td className="text-right sy-num">{site.unitCount}</td>
                      <td>{site.isActive ? <span className="badge badge-success">Aktif</span> : <span className="badge badge-secondary">Pasif</span>}</td>
                      <td className="text-right">
                        {site.isActive && site.id !== session.siteId && (
                          <button
                            type="button"
                            className="btn btn-link btn-sm"
                            onClick={() => {
                              session.setSiteId(site.id);
                              window.location.href = '/ozet';
                            }}
                          >
                            Bu siteye geç
                          </button>
                        )}
                        {site.id === session.siteId && <span className="text-muted small">Şu an bu sitedesiniz</span>}
                      </td>
                    </tr>
                  ))}
                </Table>
              </Card>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
