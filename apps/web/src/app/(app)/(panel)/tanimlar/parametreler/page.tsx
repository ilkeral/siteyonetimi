'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DUES_LIABILITY_LABELS,
  DUES_METHOD_LABELS,
  LATE_FEE_DAILY_MAX,
  LATE_FEE_METHOD_LABELS,
  LATE_FEE_MONTHLY_MAX,
  siteSettingsSchema,
  type SiteSettingsInput,
} from '@sy/shared';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { Card, ErrorBox, Loading, PageHeader, SuccessBox } from '@/components/ui';
import { FormField } from '@/components/people';

type Settings = Omit<SiteSettingsInput, 'lateFeeRate' | 'lateFeeGraceDays'> & {
  lateFeeRate: string;
  lateFeeGraceDays: string;
};

interface CurrentSite {
  site: { name: string; settings: (Record<string, unknown> & { lateFeeRate: string; lateFeeGraceDays: number }) | null };
}

const FIELDS: (keyof SiteSettingsInput)[] = [
  'duesDistributionMethod',
  'duesLiabilityRule',
  'applyLateFee',
  'lateFeeMethod',
  'lateFeeRate',
  'lateFeeGraceDays',
  'requireNationalId',
  'requireEmail',
  'requireMobilePhone',
  'requireVisitorId',
  'notificationSenderName',
  'notificationFooter',
  'autoMatchBankTransactions',
];

function fromApi(settings: NonNullable<CurrentSite['site']['settings']>): Settings {
  const picked = Object.fromEntries(FIELDS.map((key) => [key, settings[key]])) as unknown as Settings;
  return {
    ...picked,
    lateFeeRate: String(Number(settings.lateFeeRate)),
    lateFeeGraceDays: String(settings.lateFeeGraceDays),
    notificationSenderName: (settings.notificationSenderName as string | null) ?? '',
    notificationFooter: (settings.notificationFooter as string | null) ?? '',
  };
}

/**
 * Site parametreleri — yalnızca bir hesapta gerçekten okunan alanlar.
 * Değişiklikler geçmiş evrakları değiştirmez; sonraki tahakkuk / tazminat
 * hesabından itibaren uygulanır.
 */
export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { can } = useMe();
  const editable = can('SITE_ADMIN', 'ACCOUNTANT');
  const [value, setValue] = useState<Settings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['site', 'current'],
    queryFn: () => api.get<CurrentSite>('/sites/current'),
  });

  useEffect(() => {
    if (data?.site.settings) setValue(fromApi(data.site.settings));
  }, [data]);

  const save = useMutation({
    mutationFn: (payload: SiteSettingsInput) => api.put('/sites/settings', payload),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['site'] });
    },
  });

  if (isLoading || (!value && !error)) return <Loading />;
  if (error || !value) return <ErrorBox error={error ?? new Error('Site parametreleri bulunamadı')} />;

  function set<K extends keyof Settings>(key: K, next: Settings[K]) {
    setValue((current) => (current ? { ...current, [key]: next } : current));
    setErrors(({ [key]: _removed, ...rest }) => rest);
    setSaved(false);
  }

  function submit() {
    const result = siteSettingsSchema.safeParse({
      ...value,
      lateFeeRate: value!.lateFeeRate.replace(',', '.'),
      notificationSenderName: value!.notificationSenderName?.trim() || null,
      notificationFooter: value!.notificationFooter?.trim() || null,
    });
    if (!result.success) {
      setErrors(Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message])));
      return;
    }
    save.mutate(result.data);
  }

  const rateMax = value.lateFeeMethod === 'DAILY_PERCENT' ? LATE_FEE_DAILY_MAX : LATE_FEE_MONTHLY_MAX;
  const lateFeeOff = !value.applyLateFee || value.lateFeeMethod === 'NONE';

  return (
    <>
      <PageHeader
        title="Site Parametreleri"
        subtitle={`${data?.site.name} · aidat, gecikme tazminatı, zorunlu alanlar ve bildirim ayarları`}
        breadcrumb={['Tanımlar', 'Parametreler']}
      />
      {!editable && <div className="alert alert-light">Parametreleri yalnızca yönetici ve muhasebe değiştirebilir.</div>}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <fieldset disabled={!editable}>
          <div className="row">
            <div className="col-xl-6">
              <Card title="Aidat">
                <div className="card-body">
                  <FormField label="Dağıtım Yöntemi" hint="Toplam aidat tutarı dairelere bu orana göre bölünür">
                    <select
                      className="custom-select"
                      value={value.duesDistributionMethod}
                      onChange={(e) => set('duesDistributionMethod', e.target.value as Settings['duesDistributionMethod'])}
                    >
                      {Object.entries(DUES_METHOD_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField
                    label="Borç Kime Yazılır"
                    hint="Geçmiş dönem tahakkuku, o dönemde oturana / malike yazılır"
                  >
                    <select
                      className="custom-select"
                      value={value.duesLiabilityRule}
                      onChange={(e) => set('duesLiabilityRule', e.target.value as Settings['duesLiabilityRule'])}
                    >
                      {Object.entries(DUES_LIABILITY_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </FormField>
                </div>
              </Card>

              <Card title="Gecikme Tazminatı">
                <div className="card-body">
                  <Toggle id="applyLateFee" checked={value.applyLateFee} onChange={(v) => set('applyLateFee', v)}>
                    Gecikme tazminatı uygulanır
                  </Toggle>
                  <div className="row mt-3">
                    <FormField label="Yöntem" className="col-md-6 form-group">
                      <select
                        className="custom-select"
                        value={value.lateFeeMethod}
                        disabled={!value.applyLateFee}
                        onChange={(e) => set('lateFeeMethod', e.target.value as Settings['lateFeeMethod'])}
                      >
                        {Object.entries(LATE_FEE_METHOD_LABELS).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField
                      label={value.lateFeeMethod === 'DAILY_PERCENT' ? 'Günlük Oran (%)' : 'Aylık Oran (%)'}
                      error={errors.lateFeeRate}
                      hint={`En fazla %${rateMax} — KMK m.20`}
                      className="col-md-3 form-group"
                    >
                      <input
                        className={`form-control${errors.lateFeeRate ? ' is-invalid' : ''}`}
                        inputMode="decimal"
                        disabled={lateFeeOff}
                        value={value.lateFeeRate}
                        onChange={(e) => set('lateFeeRate', e.target.value)}
                      />
                    </FormField>
                    <FormField label="Tolerans (gün)" error={errors.lateFeeGraceDays} className="col-md-3 form-group" hint="Vadeden sonra">
                      <input
                        className={`form-control${errors.lateFeeGraceDays ? ' is-invalid' : ''}`}
                        inputMode="numeric"
                        disabled={lateFeeOff}
                        value={value.lateFeeGraceDays}
                        onChange={(e) => set('lateFeeGraceDays', e.target.value)}
                      />
                    </FormField>
                  </div>
                </div>
              </Card>
            </div>

            <div className="col-xl-6">
              <Card title="Zorunlu Alanlar">
                <div className="card-body">
                  <p className="text-muted small">Kayıt sırasında boş bırakılamayacak alanlar. Mevcut kayıtlar etkilenmez.</p>
                  <Toggle id="requireMobilePhone" checked={value.requireMobilePhone} onChange={(v) => set('requireMobilePhone', v)}>
                    Kişide cep telefonu
                  </Toggle>
                  <Toggle id="requireEmail" checked={value.requireEmail} onChange={(v) => set('requireEmail', v)}>
                    Kişide e-posta
                  </Toggle>
                  <Toggle id="requireNationalId" checked={value.requireNationalId} onChange={(v) => set('requireNationalId', v)}>
                    Kişide TC kimlik no
                  </Toggle>
                  <Toggle id="requireVisitorId" checked={value.requireVisitorId} onChange={(v) => set('requireVisitorId', v)}>
                    Ziyaretçide TC kimlik no
                    <small className="d-block text-muted">KVKK: yalnızca gerçekten gerekiyorsa açın; kayıtlarda maskeli tutulur.</small>
                  </Toggle>
                </div>
              </Card>

              <Card title="Bildirim">
                <div className="card-body">
                  <FormField label="Gönderen Adı" error={errors.notificationSenderName} hint="E-postada gönderen olarak görünür">
                    <input
                      className="form-control"
                      maxLength={60}
                      value={value.notificationSenderName ?? ''}
                      onChange={(e) => set('notificationSenderName', e.target.value)}
                    />
                  </FormField>
                  <FormField label="Alt Bilgi" error={errors.notificationFooter} hint="Her bildirimin sonuna eklenir">
                    <textarea
                      className="form-control"
                      rows={2}
                      maxLength={500}
                      value={value.notificationFooter ?? ''}
                      onChange={(e) => set('notificationFooter', e.target.value)}
                    />
                  </FormField>
                </div>
              </Card>

              <Card title="Banka">
                <div className="card-body">
                  <Toggle
                    id="autoMatchBankTransactions"
                    checked={value.autoMatchBankTransactions}
                    onChange={(v) => set('autoMatchBankTransactions', v)}
                  >
                    Banka hareketlerini ödeme koduyla otomatik eşleştir
                  </Toggle>
                </div>
              </Card>
            </div>
          </div>
        </fieldset>

        {Boolean(save.error) && <ErrorBox error={save.error} />}
        {saved && <SuccessBox>Parametreler kaydedildi. Sonraki tahakkuk ve tazminat hesaplarında uygulanır.</SuccessBox>}
        {editable && (
          <button type="submit" className="btn btn-primary mb-4" disabled={save.isPending}>
            {save.isPending ? 'Kaydediliyor...' : 'Parametreleri Kaydet'}
          </button>
        )}
      </form>
    </>
  );
}

function Toggle({ id, checked, onChange, children }: { id: string; checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <div className="custom-control custom-checkbox mb-2">
      <input type="checkbox" className="custom-control-input" id={id} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label className="custom-control-label" htmlFor={id}>
        {children}
      </label>
    </div>
  );
}
