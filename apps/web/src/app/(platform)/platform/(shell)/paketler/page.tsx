'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PLAN_FEATURES, planSchema, type PlanFeature, type PlanInput } from '@sy/shared';
import { api } from '@/lib/api';
import { Card, ErrorAlert, Field, Icon, Loading, PageHead, fmt, usePlans, type Plan } from '@/components/platform/kit';

interface PlanForm {
  id: string | null;
  code: string;
  name: string;
  description: string;
  monthlyPrice: string;
  maxSites: string;
  maxUnits: string;
  features: PlanFeature[];
  isActive: boolean;
  order: string;
}

const EMPTY: PlanForm = { id: null, code: '', name: '', description: '', monthlyPrice: '0', maxSites: '', maxUnits: '', features: [], isActive: true, order: '0' };

const toForm = (p: Plan): PlanForm => ({
  id: p.id,
  code: p.code,
  name: p.name,
  description: p.description ?? '',
  monthlyPrice: String(p.monthlyPrice),
  maxSites: p.maxSites === null ? '' : String(p.maxSites),
  maxUnits: p.maxUnits === null ? '' : String(p.maxUnits),
  features: p.features as PlanFeature[],
  isActive: p.isActive,
  order: String(p.order),
});

/**
 * Paketler: fiyat (aylık, KDV hariç), sınırlar ve açık modüller. Kişi/daire,
 * finans ve aidat her pakette vardır; buradaki modüller paketle açılıp kapanır.
 * Paketi değişen müşteride değişiklik bir sonraki istekten itibaren geçerlidir.
 */
export default function PlansPage() {
  const queryClient = useQueryClient();
  const { data: plans, isLoading, error } = usePlans();
  const [form, setForm] = useState<PlanForm | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: PlanInput }) =>
      id ? api.put(`/platform/plans/${id}`, body) : api.post('/platform/plans', body),
    onSuccess: () => {
      setForm(null);
      void queryClient.invalidateQueries({ queryKey: ['platform'] });
    },
  });

  function submit() {
    if (!form) return;
    const result = planSchema.safeParse({
      code: form.code,
      name: form.name,
      description: form.description || null,
      monthlyPrice: form.monthlyPrice.replace(',', '.'),
      maxSites: form.maxSites === '' ? null : form.maxSites,
      maxUnits: form.maxUnits === '' ? null : form.maxUnits,
      features: form.features,
      isActive: form.isActive,
      order: form.order,
    });
    if (!result.success) {
      setErrors(Object.fromEntries(result.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    save.mutate({ id: form.id, body: result.data });
  }

  const set = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setErrors(({ [key as string]: _removed, ...rest }) => rest);
  };

  return (
    <>
      <PageHead
        title="Paketler"
        subtitle="Fiyat, sınırlar ve modüller — müşteriye atanan paket erişimi belirler"
        actions={
          !form && (
            <button type="button" className="pf-btn pf-btn--primary" onClick={() => setForm(EMPTY)}>
              <Icon name="add" size={18} />
              Yeni Paket
            </button>
          )
        }
      />

      {form && (
        <Card title={form.id ? `Paketi düzenle · ${form.name}` : 'Yeni paket'}>
          <form
            className="pf-card__body pf-form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="pf-row">
              <Field label="Paket adı" required error={errors.name}>
                <input className="pf-input" value={form.name} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label="Kod" required error={errors.code} hint="Küçük harf, rakam, tire — değişmez anahtar">
                <input className="pf-input pf-mono" value={form.code} onChange={(e) => set('code', e.target.value)} />
              </Field>
              <Field label="Aylık fiyat (TL, KDV hariç)" error={errors.monthlyPrice}>
                <input className="pf-input" inputMode="decimal" value={form.monthlyPrice} onChange={(e) => set('monthlyPrice', e.target.value)} />
              </Field>
            </div>
            <div className="pf-row">
              <Field label="Site sınırı" error={errors.maxSites} hint="Boş = sınırsız">
                <input className="pf-input" inputMode="numeric" value={form.maxSites} onChange={(e) => set('maxSites', e.target.value)} />
              </Field>
              <Field label="Daire sınırı" error={errors.maxUnits} hint="Tüm sitelerdeki aktif daire toplamı; boş = sınırsız">
                <input className="pf-input" inputMode="numeric" value={form.maxUnits} onChange={(e) => set('maxUnits', e.target.value)} />
              </Field>
              <Field label="Sıra">
                <input className="pf-input" inputMode="numeric" value={form.order} onChange={(e) => set('order', e.target.value)} />
              </Field>
            </div>
            <Field label="Açıklama">
              <input className="pf-input" value={form.description} onChange={(e) => set('description', e.target.value)} />
            </Field>
            <div className="pf-legend">Modüller (kişi/daire, finans ve aidat her pakette vardır)</div>
            <div className="pf-row">
              {(Object.keys(PLAN_FEATURES) as PlanFeature[]).map((feature) => (
                <label key={feature} className="pf-check">
                  <input
                    type="checkbox"
                    checked={form.features.includes(feature)}
                    onChange={(e) => set('features', e.target.checked ? [...form.features, feature] : form.features.filter((f) => f !== feature))}
                  />
                  <span>{PLAN_FEATURES[feature]}</span>
                </label>
              ))}
            </div>
            <label className="pf-check" style={{ maxWidth: 360 }}>
              <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
              <span>
                Satışta
                <small>Kapalı paket yeni müşteriye atanamaz; mevcut müşteriler etkilenmez.</small>
              </span>
            </label>
            <ErrorAlert error={save.error} />
            <div className="pf-actions">
              <button type="submit" className="pf-btn pf-btn--primary" disabled={save.isPending}>
                {save.isPending ? 'Kaydediliyor...' : 'Kaydet'}
              </button>
              <button type="button" className="pf-btn" onClick={() => setForm(null)}>
                Vazgeç
              </button>
            </div>
          </form>
        </Card>
      )}

      <ErrorAlert error={error} />
      {isLoading ? (
        <Loading />
      ) : (
        <div className="pf-grid pf-grid--3" style={{ marginTop: form ? 16 : 0 }}>
          {plans?.map((plan) => (
            <section key={plan.id} className="pf-card" style={plan.isActive ? undefined : { opacity: 0.65 }}>
              <div className="pf-card__head">
                <div>
                  <h2>{plan.name}</h2>
                  <div className="pf-small pf-muted pf-mono">{plan.code}</div>
                </div>
                {!plan.isActive && <span className="pf-badge">Satışta değil</span>}
              </div>
              <div className="pf-card__body pf-form">
                <div>
                  <span className="pf-stat__value">{fmt.tl(plan.monthlyPrice)}</span>
                  <span className="pf-muted"> /ay</span>
                </div>
                {plan.description && <div className="pf-muted">{plan.description}</div>}
                <div className="pf-small">
                  <strong>{plan.maxSites ?? 'Sınırsız'}</strong> site · <strong>{plan.maxUnits ? fmt.num(plan.maxUnits) : 'Sınırsız'}</strong> daire
                </div>
                <div className="pf-features">
                  {plan.features.length === 0 && <span className="pf-muted pf-small">Yalnızca temel modüller</span>}
                  {plan.features.map((f) => (
                    <span key={f} className="pf-badge pf-badge--accent">
                      {PLAN_FEATURES[f as PlanFeature] ?? f}
                    </span>
                  ))}
                </div>
              </div>
              <div className="pf-card__foot pf-actions" style={{ justifyContent: 'space-between' }}>
                <span className="pf-small pf-muted">{plan.organizationCount ?? 0} müşteri</span>
                <button type="button" className="pf-btn pf-btn--sm" onClick={() => setForm(toForm(plan))}>
                  <Icon name="edit" size={16} />
                  Düzenle
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
