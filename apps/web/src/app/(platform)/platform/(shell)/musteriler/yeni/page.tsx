'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_TRIAL_DAYS,
  ORGANIZATION_KIND_LABELS,
  organizationCreateSchema,
  type OrganizationCreateInput,
  type OrganizationKind,
} from '@sy/shared';
import { api } from '@/lib/api';
import { Card, ErrorAlert, Field, Icon, PageHead, SecretBox, fmt, usePlans } from '@/components/platform/kit';

interface Created {
  organization: { id: string; name: string };
  owner: { email: string; temporaryPassword: string | null; existingUser: boolean };
  site: { id: string; name: string } | null;
}

const SITE_TYPES = { SITE: 'Site', APARTMAN: 'Apartman', REZIDANS: 'Rezidans', IS_MERKEZI: 'İş Merkezi', TOPLU_YAPI: 'Toplu Yapı' } as const;

export default function NewOrganizationPage() {
  const queryClient = useQueryClient();
  const { data: plans } = usePlans();
  const [form, setForm] = useState({
    name: '',
    kind: 'SINGLE_SITE' as OrganizationKind,
    planId: '',
    trialDays: String(DEFAULT_TRIAL_DAYS),
    taxNumber: '',
    taxOffice: '',
    contactPhone: '',
    city: '',
    ownerName: '',
    ownerEmail: '',
    withSite: true,
    siteName: '',
    siteType: 'SITE',
    siteCity: '',
    siteDistrict: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<Created | null>(null);

  const create = useMutation({
    mutationFn: (body: OrganizationCreateInput) => api.post<Created>('/platform/organizations', body),
    onSuccess: (result) => {
      setCreated(result);
      void queryClient.invalidateQueries({ queryKey: ['platform'] });
    },
  });

  const set = (key: keyof typeof form, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors(({ [key]: _removed, ...rest }) => rest);
  };

  function submit() {
    const result = organizationCreateSchema.safeParse({
      name: form.name,
      kind: form.kind,
      planId: form.planId || null,
      trialDays: form.trialDays,
      taxNumber: form.taxNumber || null,
      taxOffice: form.taxOffice || null,
      contactPhone: form.contactPhone || null,
      city: form.city || null,
      owner: { fullName: form.ownerName, email: form.ownerEmail },
      firstSite: form.withSite
        ? { name: form.siteName || form.name, type: form.siteType, city: form.siteCity || form.city || null, district: form.siteDistrict || null }
        : null,
    });
    if (!result.success) {
      setErrors(
        Object.fromEntries(
          result.error.issues.map((i) => [i.path.join('.').replace('owner.fullName', 'ownerName').replace('owner.email', 'ownerEmail'), i.message]),
        ),
      );
      return;
    }
    create.mutate(result.data);
  }

  if (created) {
    return (
      <>
        <PageHead title="Müşteri oluşturuldu" crumb={<Link href="/platform/musteriler">Müşteriler</Link>} />
        <Card title={created.organization.name}>
          <div className="pf-card__body pf-form">
            <div className="pf-alert pf-alert--success">
              <Icon name="check_circle" size={18} />
              <div>
                Müşteri hesabı{created.site ? ` ve "${created.site.name}" sitesi` : ''} hazır. Sahip ({created.owner.email}) siteye yönetici olarak eklendi.
              </div>
            </div>
            {created.owner.temporaryPassword ? (
              <>
                <div>
                  <div className="pf-strong">Sahibin geçici parolası</div>
                  <div className="pf-small pf-muted">
                    Yalnızca şimdi gösterilir, hiçbir yerde saklanmaz. Müşteriye güvenli bir kanaldan iletin; ilk girişte değiştirmesini isteyin.
                  </div>
                </div>
                <SecretBox value={created.owner.temporaryPassword} />
              </>
            ) : (
              <div className="pf-alert pf-alert--info">Bu e-posta zaten kayıtlıydı; mevcut parolasıyla giriş yapacak.</div>
            )}
            <div className="pf-actions">
              <Link href={`/platform/musteriler/${created.organization.id}`} className="pf-btn pf-btn--primary">
                Müşteri Kartına Git
              </Link>
              <Link href="/platform/musteriler/yeni" className="pf-btn" onClick={() => setCreated(null)}>
                Başka Müşteri Ekle
              </Link>
            </div>
          </div>
        </Card>
      </>
    );
  }

  const selectedPlan = plans?.find((p) => p.id === form.planId);

  return (
    <>
      <PageHead title="Yeni Müşteri" crumb={<Link href="/platform/musteriler">Müşteriler</Link>} subtitle="Müşteri hesabı, sahibi ve (isteğe bağlı) ilk sitesi tek adımda açılır" />
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="pf-grid pf-grid--2">
          <Card title="Müşteri ve Paket">
            <div className="pf-card__body pf-form">
              <Field label="Müşteri adı" required error={errors.name}>
                <input className="pf-input" value={form.name} aria-invalid={!!errors.name} onChange={(e) => set('name', e.target.value)} placeholder="Örnek Yönetim Hizmetleri Ltd." />
              </Field>
              <Field label="Tür">
                <select className="pf-select" value={form.kind} onChange={(e) => set('kind', e.target.value)}>
                  {Object.entries(ORGANIZATION_KIND_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="pf-row">
                <Field label="Paket" hint={selectedPlan ? `${fmt.tl(selectedPlan.monthlyPrice)}/ay · ${selectedPlan.maxSites ?? '∞'} site · ${selectedPlan.maxUnits ?? '∞'} daire` : 'Paketsiz: özel sözleşme (sınırsız)'}>
                  <select className="pf-select" value={form.planId} onChange={(e) => set('planId', e.target.value)}>
                    <option value="">Özel (paketsiz)</option>
                    {plans?.filter((p) => p.isActive).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Deneme süresi (gün)" error={errors.trialDays} hint="0 = hemen aktif">
                  <input className="pf-input" inputMode="numeric" value={form.trialDays} onChange={(e) => set('trialDays', e.target.value)} />
                </Field>
              </div>
              <div className="pf-row">
                <Field label="Vergi no" error={errors.taxNumber}>
                  <input className="pf-input" value={form.taxNumber} onChange={(e) => set('taxNumber', e.target.value)} />
                </Field>
                <Field label="Vergi dairesi">
                  <input className="pf-input" value={form.taxOffice} onChange={(e) => set('taxOffice', e.target.value)} />
                </Field>
              </div>
              <div className="pf-row">
                <Field label="Telefon">
                  <input className="pf-input" value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} />
                </Field>
                <Field label="Şehir">
                  <input className="pf-input" value={form.city} onChange={(e) => set('city', e.target.value)} />
                </Field>
              </div>
            </div>
          </Card>

          <div>
            <Card title="Hesap Sahibi">
              <div className="pf-card__body pf-form">
                <Field label="Ad soyad" required error={errors.ownerName}>
                  <input className="pf-input" value={form.ownerName} aria-invalid={!!errors.ownerName} onChange={(e) => set('ownerName', e.target.value)} />
                </Field>
                <Field label="E-posta" required error={errors.ownerEmail} hint="Giriş e-postası. Kayıtlı değilse geçici parolayla hesap açılır.">
                  <input className="pf-input" type="email" value={form.ownerEmail} aria-invalid={!!errors.ownerEmail} onChange={(e) => set('ownerEmail', e.target.value)} />
                </Field>
              </div>
            </Card>
            <Card title="İlk Site">
              <div className="pf-card__body pf-form">
                <label className="pf-check">
                  <input type="checkbox" checked={form.withSite} onChange={(e) => set('withSite', e.target.checked)} />
                  <span>
                    İlk siteyi şimdi aç
                    <small>Kategoriler, kasa/banka hesabı, departmanlar ve şablonlar hazır gelir.</small>
                  </span>
                </label>
                {form.withSite && (
                  <>
                    <Field label="Site adı" error={errors['firstSite.name']} hint="Boşsa müşteri adı kullanılır">
                      <input className="pf-input" value={form.siteName} onChange={(e) => set('siteName', e.target.value)} />
                    </Field>
                    <div className="pf-row">
                      <Field label="Tür">
                        <select className="pf-select" value={form.siteType} onChange={(e) => set('siteType', e.target.value)}>
                          {Object.entries(SITE_TYPES).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="İl">
                        <input className="pf-input" value={form.siteCity} onChange={(e) => set('siteCity', e.target.value)} placeholder={form.city} />
                      </Field>
                      <Field label="İlçe">
                        <input className="pf-input" value={form.siteDistrict} onChange={(e) => set('siteDistrict', e.target.value)} />
                      </Field>
                    </div>
                  </>
                )}
              </div>
            </Card>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <ErrorAlert error={create.error} />
          <div className="pf-actions">
            <button type="submit" className="pf-btn pf-btn--primary" disabled={create.isPending}>
              <Icon name="person_add" size={18} />
              {create.isPending ? 'Oluşturuluyor...' : 'Müşteriyi Oluştur'}
            </button>
            <Link href="/platform/musteriler" className="pf-btn">
              Vazgeç
            </Link>
          </div>
        </div>
      </form>
    </>
  );
}
