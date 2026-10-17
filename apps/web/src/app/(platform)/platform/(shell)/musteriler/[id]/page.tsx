'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ORGANIZATION_KIND_LABELS,
  ORGANIZATION_STATUS_LABELS,
  PLAN_FEATURES,
  organizationUpdateSchema,
  siteCreateSchema,
  supportAccessSchema,
  type OrganizationKind,
  type OrganizationStatus,
  type OrganizationUpdateInput,
  type PlanFeature,
  type SiteCreateInput,
  type SupportAccessInput,
} from '@sy/shared';
import { api, session } from '@/lib/api';
import {
  AccessBadge,
  Card,
  ErrorAlert,
  Field,
  Icon,
  Loading,
  PageHead,
  SecretBox,
  StatusBadge,
  Usage,
  fmt,
  usePlans,
  type Access,
  type LimitCheck,
} from '@/components/platform/kit';

interface Detail {
  id: string;
  name: string;
  kind: OrganizationKind;
  status: OrganizationStatus;
  planId: string | null;
  trialEndsAt: string | null;
  paidUntil: string | null;
  taxNumber: string | null;
  taxOffice: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  city: string | null;
  address: string | null;
  note: string | null;
  createdAt: string;
  plan: { name: string; monthlyPrice: number; features: string[] } | null;
  access: Access;
  usage: { sites: LimitCheck; units: LimitCheck };
  members: { id: string; role: string; user: { id: string; fullName: string; email: string; lastLoginAt: string | null; isActive: boolean } }[];
  sites: {
    id: string;
    name: string;
    type: string;
    city: string | null;
    district: string | null;
    isActive: boolean;
    createdAt: string;
    _count: { units: number; people: number; memberships: number };
  }[];
  history: { id: string; action: string; after: Record<string, unknown> | null; createdAt: string; user: { fullName: string } | null }[];
}

type FormState = Record<string, string>;

function toForm(d: Detail): FormState {
  return {
    name: d.name,
    kind: d.kind,
    status: d.status,
    planId: d.planId ?? '',
    trialEndsAt: fmt.dateInput(d.trialEndsAt),
    paidUntil: fmt.dateInput(d.paidUntil),
    taxNumber: d.taxNumber ?? '',
    taxOffice: d.taxOffice ?? '',
    contactName: d.contactName ?? '',
    contactEmail: d.contactEmail ?? '',
    contactPhone: d.contactPhone ?? '',
    city: d.city ?? '',
    address: d.address ?? '',
    note: d.note ?? '',
  };
}

/** Tarih alanı gün sonuna: "15.03" seçilince o gün boyunca geçerli olsun */
const endOfDay = (value: string) => (value ? new Date(`${value}T23:59:59`) : null);

export default function OrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: plans } = usePlans();
  const { data, isLoading, error } = useQuery({
    queryKey: ['platform', 'organization', id],
    queryFn: () => api.get<Detail>(`/platform/organizations/${id}`),
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [newSite, setNewSite] = useState<FormState | null>(null);
  const [support, setSupport] = useState<{ siteId: string; reason: string; minutes: string } | null>(null);
  const [granted, setGranted] = useState<{ siteId: string; expiresAt: string } | null>(null);

  useEffect(() => {
    if (data) setForm(toForm(data));
  }, [data]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['platform'] });

  const update = useMutation({
    mutationFn: (body: OrganizationUpdateInput) => api.put(`/platform/organizations/${id}`, body),
    onSuccess: () => {
      setSaved(true);
      refresh();
    },
  });
  const reset = useMutation({
    mutationFn: (userId: string) => api.post<{ email: string; temporaryPassword: string }>(`/platform/organizations/${id}/owners/${userId}/reset-password`),
    onSuccess: (result) => setSecret({ email: result.email, password: result.temporaryPassword }),
  });
  const createSite = useMutation({
    mutationFn: (body: SiteCreateInput) => api.post(`/platform/organizations/${id}/sites`, body),
    onSuccess: () => {
      setNewSite(null);
      refresh();
    },
  });
  const toggleSite = useMutation({
    mutationFn: (site: { id: string; isActive: boolean }) => api.put(`/platform/sites/${site.id}/active`, { isActive: !site.isActive }),
    onSuccess: refresh,
  });
  const grant = useMutation({
    mutationFn: (body: SupportAccessInput) => api.post<{ siteId: string; expiresAt: string }>('/platform/support-access', body),
    onSuccess: (result) => {
      setGranted(result);
      setSupport(null);
      refresh();
    },
  });

  if (isLoading || (!form && !error)) return <Loading />;
  if (error || !data || !form) return <ErrorAlert error={error ?? new Error('Müşteri bulunamadı')} />;

  const set = (key: string, value: string) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setErrors(({ [key]: _removed, ...rest }) => rest);
    setSaved(false);
  };

  function save() {
    const result = organizationUpdateSchema.safeParse({
      ...form,
      planId: form!.planId || null,
      trialEndsAt: endOfDay(form!.trialEndsAt),
      paidUntil: endOfDay(form!.paidUntil),
      ...Object.fromEntries(['taxNumber', 'taxOffice', 'contactName', 'contactPhone', 'city', 'address', 'note'].map((k) => [k, form![k] || null])),
    });
    if (!result.success) {
      setErrors(Object.fromEntries(result.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    update.mutate(result.data);
  }

  /** Destek erişimiyle müşterinin sitesine geç (tam sayfa: müşteri tarafı ayrı kök düzen) */
  function enterSite(siteId: string) {
    session.setSiteId(siteId);
    window.location.href = '/ozet';
  }

  const plan = plans?.find((p) => p.id === form.planId);

  return (
    <>
      <PageHead
        title={data.name}
        crumb={<Link href="/platform/musteriler">Müşteriler</Link>}
        subtitle={
          <span className="pf-actions">
            <StatusBadge status={data.status} />
            <AccessBadge access={data.access} />
            <span className="pf-muted">
              {ORGANIZATION_KIND_LABELS[data.kind]} · kayıt {fmt.date(data.createdAt)}
            </span>
          </span>
        }
      />
      {data.access.reason && (
        <div className={`pf-alert ${data.access.level === 'BLOCKED' ? 'pf-alert--danger' : 'pf-alert--warning'}`}>
          <Icon name={data.access.level === 'BLOCKED' ? 'block' : 'lock'} size={18} />
          <div>Müşteri şu an: {data.access.reason}</div>
        </div>
      )}

      <div className="pf-grid pf-grid--2">
        <Card title="Abonelik ve Bilgiler">
          <form
            className="pf-card__body pf-form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="pf-row">
              <Field label="Durum">
                <select className="pf-select" value={form.status} onChange={(e) => set('status', e.target.value)}>
                  {Object.entries(ORGANIZATION_STATUS_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Paket">
                <select className="pf-select" value={form.planId} onChange={(e) => set('planId', e.target.value)}>
                  <option value="">Özel (paketsiz)</option>
                  {plans?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.isActive ? '' : ' (satışta değil)'}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="pf-row">
              <Field label="Deneme bitişi" error={errors.trialEndsAt}>
                <input className="pf-input" type="date" value={form.trialEndsAt} onChange={(e) => set('trialEndsAt', e.target.value)} />
              </Field>
              <Field label="Ödenen süre bitişi" error={errors.paidUntil} hint="Geçerse 7 gün sonra salt okunur">
                <input className="pf-input" type="date" value={form.paidUntil} onChange={(e) => set('paidUntil', e.target.value)} />
              </Field>
            </div>
            {plan && (
              <div className="pf-features">
                {(Object.keys(PLAN_FEATURES) as PlanFeature[]).map((feature) => (
                  <span key={feature} className={`pf-badge ${plan.features.includes(feature) ? 'pf-badge--accent' : ''}`} style={plan.features.includes(feature) ? undefined : { opacity: 0.5, textDecoration: 'line-through' }}>
                    {PLAN_FEATURES[feature]}
                  </span>
                ))}
              </div>
            )}
            <div className="pf-legend">Müşteri bilgileri</div>
            <Field label="Müşteri adı" required error={errors.name}>
              <input className="pf-input" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <div className="pf-row">
              <Field label="Tür">
                <select className="pf-select" value={form.kind} onChange={(e) => set('kind', e.target.value)}>
                  {Object.entries(ORGANIZATION_KIND_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Şehir">
                <input className="pf-input" value={form.city} onChange={(e) => set('city', e.target.value)} />
              </Field>
            </div>
            <div className="pf-row">
              <Field label="Vergi no">
                <input className="pf-input" value={form.taxNumber} onChange={(e) => set('taxNumber', e.target.value)} />
              </Field>
              <Field label="Vergi dairesi">
                <input className="pf-input" value={form.taxOffice} onChange={(e) => set('taxOffice', e.target.value)} />
              </Field>
            </div>
            <div className="pf-row">
              <Field label="İletişim kişisi">
                <input className="pf-input" value={form.contactName} onChange={(e) => set('contactName', e.target.value)} />
              </Field>
              <Field label="E-posta" error={errors.contactEmail}>
                <input className="pf-input" type="email" value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} />
              </Field>
              <Field label="Telefon">
                <input className="pf-input" value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} />
              </Field>
            </div>
            <Field label="Not (yalnızca platform görür)">
              <textarea className="pf-textarea" rows={2} value={form.note} onChange={(e) => set('note', e.target.value)} />
            </Field>
            <ErrorAlert error={update.error} />
            {saved && <div className="pf-alert pf-alert--success">Kaydedildi.</div>}
            <div className="pf-actions">
              <button type="submit" className="pf-btn pf-btn--primary" disabled={update.isPending}>
                {update.isPending ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
            </div>
          </form>
        </Card>

        <div>
          <Card title="Kullanım">
            <div className="pf-card__body pf-form">
              <Usage label="Site" check={data.usage.sites} />
              <Usage label="Aktif daire" check={data.usage.units} />
              {data.plan && <div className="pf-small pf-muted">Paket: {data.plan.name} · {fmt.tl(data.plan.monthlyPrice)}/ay (KDV hariç)</div>}
            </div>
          </Card>
          <Card title="Hesap Sahipleri">
            <ul className="pf-list">
              {data.members.map((m) => (
                <li key={m.id}>
                  <div>
                    <div className="pf-strong">{m.user.fullName}</div>
                    <div className="pf-small pf-muted">
                      {m.user.email} · son giriş {fmt.dateTime(m.user.lastLoginAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="pf-btn pf-btn--sm"
                    disabled={reset.isPending}
                    onClick={() => {
                      if (window.confirm(`${m.user.email} için yeni geçici parola üretilecek ve açık oturumları kapatılacak. Devam edilsin mi?`)) {
                        reset.mutate(m.user.id);
                      }
                    }}
                  >
                    Parola Sıfırla
                  </button>
                </li>
              ))}
            </ul>
            {secret && (
              <div className="pf-card__body pf-form">
                <div className="pf-small">
                  {secret.email} için yeni geçici parola — yalnızca şimdi gösterilir:
                </div>
                <SecretBox value={secret.password} />
              </div>
            )}
            <div className="pf-card__body" style={{ paddingTop: 0 }}>
              <ErrorAlert error={reset.error} />
            </div>
          </Card>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card
          title="Siteler"
          actions={
            !newSite && (
              <button type="button" className="pf-btn pf-btn--sm" onClick={() => setNewSite({ name: '', type: 'SITE', city: data.city ?? '', district: '' })}>
                <Icon name="add" size={16} />
                Yeni Site
              </button>
            )
          }
        >
          {newSite && (
            <form
              className="pf-card__body pf-form"
              style={{ borderBottom: '1px solid var(--pf-border)' }}
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = siteCreateSchema.safeParse({ ...newSite, city: newSite.city || null, district: newSite.district || null });
                if (parsed.success) createSite.mutate(parsed.data);
              }}
            >
              <div className="pf-row">
                <Field label="Site adı" required>
                  <input className="pf-input" value={newSite.name} onChange={(e) => setNewSite({ ...newSite, name: e.target.value })} autoFocus />
                </Field>
                <Field label="İl">
                  <input className="pf-input" value={newSite.city} onChange={(e) => setNewSite({ ...newSite, city: e.target.value })} />
                </Field>
                <Field label="İlçe">
                  <input className="pf-input" value={newSite.district} onChange={(e) => setNewSite({ ...newSite, district: e.target.value })} />
                </Field>
              </div>
              <ErrorAlert error={createSite.error} />
              <div className="pf-actions">
                <button type="submit" className="pf-btn pf-btn--primary pf-btn--sm" disabled={createSite.isPending || newSite.name.trim().length < 2}>
                  Siteyi Aç
                </button>
                <button type="button" className="pf-btn pf-btn--sm" onClick={() => setNewSite(null)}>
                  Vazgeç
                </button>
              </div>
            </form>
          )}
          {granted && (
            <div className="pf-card__body" style={{ borderBottom: '1px solid var(--pf-border)' }}>
              <div className="pf-alert pf-alert--info" style={{ marginBottom: 0 }}>
                <Icon name="headset_mic" size={18} />
                <div style={{ flex: 1 }}>
                  Destek erişimi {fmt.dateTime(granted.expiresAt)} tarihine kadar açık. Erişim müşterinin işlem günlüğüne yazıldı.
                </div>
                <button type="button" className="pf-btn pf-btn--primary pf-btn--sm" onClick={() => enterSite(granted.siteId)}>
                  <Icon name="open_in_new" size={16} />
                  Siteye Gir
                </button>
              </div>
            </div>
          )}
          {support && (
            <form
              className="pf-card__body pf-form"
              style={{ borderBottom: '1px solid var(--pf-border)' }}
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = supportAccessSchema.safeParse(support);
                if (parsed.success) grant.mutate(parsed.data);
              }}
            >
              <div className="pf-alert pf-alert--warning" style={{ marginBottom: 0 }}>
                <Icon name="lock_open" size={18} />
                <div>
                  Müşterinin kişisel verilerine erişeceksiniz. Gerekçe ve süre müşterinin işlem günlüğüne yazılır; yalnızca destek talebi
                  için açın.
                </div>
              </div>
              <div className="pf-row">
                <Field label="Gerekçe" required hint="Destek talebi no ve konu (en az 10 karakter)">
                  <input className="pf-input" value={support.reason} onChange={(e) => setSupport({ ...support, reason: e.target.value })} autoFocus />
                </Field>
                <Field label="Süre">
                  <select className="pf-select" value={support.minutes} onChange={(e) => setSupport({ ...support, minutes: e.target.value })}>
                    {[15, 30, 60, 120, 240].map((m) => (
                      <option key={m} value={m}>
                        {m < 60 ? `${m} dakika` : `${m / 60} saat`}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <ErrorAlert error={grant.error} />
              <div className="pf-actions">
                <button type="submit" className="pf-btn pf-btn--primary pf-btn--sm" disabled={grant.isPending || support.reason.trim().length < 10}>
                  Erişimi Aç
                </button>
                <button type="button" className="pf-btn pf-btn--sm" onClick={() => setSupport(null)}>
                  Vazgeç
                </button>
              </div>
            </form>
          )}
          <ErrorAlert error={toggleSite.error} />
          <div className="pf-table-wrap">
            <table className="pf-table">
              <thead>
                <tr>
                  <th>Site</th>
                  <th className="pf-num">Daire</th>
                  <th className="pf-num">Kişi</th>
                  <th className="pf-num">Personel</th>
                  <th>Durum</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.sites.map((site) => (
                  <tr key={site.id}>
                    <td>
                      <span className="pf-strong">{site.name}</span>
                      <div className="pf-small pf-muted">{[site.district, site.city].filter(Boolean).join(' / ') || '—'}</div>
                    </td>
                    <td className="pf-num">{fmt.num(site._count.units)}</td>
                    <td className="pf-num">{fmt.num(site._count.people)}</td>
                    <td className="pf-num">{site._count.memberships}</td>
                    <td>{site.isActive ? <span className="pf-badge pf-badge--success">Aktif</span> : <span className="pf-badge">Pasif</span>}</td>
                    <td className="pf-num">
                      <div className="pf-actions" style={{ justifyContent: 'flex-end' }}>
                        {site.isActive && (
                          <button
                            type="button"
                            className="pf-btn pf-btn--sm"
                            onClick={() => {
                              setGranted(null);
                              setSupport({ siteId: site.id, reason: '', minutes: '60' });
                            }}
                          >
                            <Icon name="headset_mic" size={16} />
                            Destek Erişimi
                          </button>
                        )}
                        <button
                          type="button"
                          className={`pf-btn pf-btn--sm${site.isActive ? ' pf-btn--danger' : ''}`}
                          disabled={toggleSite.isPending}
                          onClick={() => {
                            const message = site.isActive
                              ? `${site.name} pasife alınacak; kullanıcılar bu siteye giremez. Devam edilsin mi?`
                              : `${site.name} yeniden açılacak. Devam edilsin mi?`;
                            if (window.confirm(message)) toggleSite.mutate(site);
                          }}
                        >
                          {site.isActive ? 'Pasife Al' : 'Etkinleştir'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {data.sites.length === 0 && (
                  <tr>
                    <td colSpan={6} className="pf-empty">
                      Henüz site yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="İşlem Geçmişi">
          {data.history.length === 0 ? (
            <div className="pf-empty">Kayıt yok.</div>
          ) : (
            <ul className="pf-list">
              {data.history.map((h) => (
                <li key={h.id}>
                  <span>
                    <span className="pf-strong">{h.action === 'CREATE' ? 'Müşteri açıldı' : 'Güncellendi'}</span>{' '}
                    <span className="pf-small pf-muted">{describe(h.after)}</span>
                  </span>
                  <span className="pf-small pf-muted">
                    {fmt.dateTime(h.createdAt)}
                    {h.user ? ` · ${h.user.fullName}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

/** Denetim kaydı özeti: durum / paket / sahip parolası */
function describe(after: Record<string, unknown> | null): string {
  if (!after) return '';
  if (after.ownerPasswordReset) return `sahip parolası sıfırlandı (${String(after.ownerPasswordReset)})`;
  const parts: string[] = [];
  if (after.status) parts.push(`durum: ${ORGANIZATION_STATUS_LABELS[after.status as OrganizationStatus] ?? String(after.status)}`);
  if (after.paidUntil) parts.push(`ödenen: ${fmt.date(after.paidUntil as string)}`);
  if (after.trialEndsAt) parts.push(`deneme: ${fmt.date(after.trialEndsAt as string)}`);
  if (after.owner) parts.push(`sahip: ${String(after.owner)}`);
  return parts.join(' · ');
}
