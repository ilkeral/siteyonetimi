'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CHANNEL_LABELS, campaignSchema } from '@sy/shared';
import { api } from '@/lib/api';
import { Card, ErrorBox, Loading, PageHeader } from '@/components/ui';
import {
  AUDIENCE_GROUPS,
  CHANNEL_ICONS,
  MergeFieldButtons,
  SUPPORTED_CHANNELS,
  useDebounced,
  useTemplates,
  type Audience,
  type Channel,
} from '@/components/notifications';

interface Preview {
  matchedCount: number;
  recipientCount: number;
  excludedCount: number;
  exclusions: { reason: string; count: number }[];
  excludedSample: { personId: string; fullName: string; reason: string }[];
  samples: { personId: string; fullName: string; recipient: string; subject: string | null; body: string }[];
  unknownFields: string[];
  warnings: string[];
  sms: { encoding: 'GSM7' | 'UCS2'; maxSegments: number; totalSegments: number; nonGsmChars: string[] } | null;
}

interface CampaignDetail {
  id: string;
  status: string;
  channel: Channel;
  name: string;
  templateId: string | null;
  subject: string | null;
  body: string;
  audience: Audience;
}

const EMPTY_AUDIENCE: Audience = { group: 'ALL', onlyOverdue: false, includeSecondPhone: false };

/** Yeni kampanya; `?id=` ile taslak düzenleme */
export default function CampaignComposerPage() {
  // useSearchParams statik sayfada Suspense sınırı ister
  return (
    <Suspense fallback={<Loading />}>
      <CampaignComposer />
    </Suspense>
  );
}

function CampaignComposer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('id');
  const queryClient = useQueryClient();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [channel, setChannel] = useState<Channel>('SMS');
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>(EMPTY_AUDIENCE);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: templates } = useTemplates();
  const { data: blocks } = useQuery({
    queryKey: ['blocks'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/blocks'),
    staleTime: 5 * 60_000,
  });
  const { data: people } = useQuery({
    queryKey: ['people', 'options'],
    queryFn: () => api.get<{ items: { id: string; fullName: string }[] }>('/people?pageSize=200'),
    enabled: audience.group === 'CUSTOM',
    staleTime: 5 * 60_000,
  });

  // Taslak düzenleme: mevcut kampanyayı forma yükle
  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ['notifications', 'campaign', editId],
    queryFn: () => api.get<CampaignDetail>(`/notifications/campaigns/${editId}`),
    enabled: !!editId,
  });
  useEffect(() => {
    if (!existing) return;
    setChannel(existing.channel);
    setName(existing.name);
    setTemplateId(existing.templateId ?? '');
    setSubject(existing.subject ?? '');
    setBody(existing.body);
    setAudience({ ...EMPTY_AUDIENCE, ...existing.audience });
  }, [existing]);

  const setAud = <K extends keyof Audience>(key: K, value: Audience[K]) =>
    setAudience((current) => ({ ...current, [key]: value }));

  function applyTemplate(id: string) {
    setTemplateId(id);
    const template = templates?.find((t) => t.id === id);
    if (!template) return;
    if (body.trim() && body !== template.body && !window.confirm('Mesaj metni şablonla değiştirilsin mi?')) return;
    setBody(template.body);
    setSubject(template.subject ?? '');
    if (!name) setName(template.name);
  }

  // --- canlı önizleme: yazmayı bırakınca hesaplanır
  const previewInput = useMemo(
    () => JSON.stringify({ channel, subject: channel === 'EMAIL' ? subject : undefined, body, audience }),
    [channel, subject, body, audience],
  );
  const debouncedInput = useDebounced(previewInput, 600);
  const { data: preview, isFetching: previewing, error: previewError } = useQuery({
    queryKey: ['notifications', 'preview', debouncedInput],
    queryFn: () => api.post<Preview>('/notifications/campaigns/preview', JSON.parse(debouncedInput)),
    placeholderData: (previous) => previous,
  });

  function payload() {
    return {
      channel,
      name,
      templateId: templateId || null,
      subject: channel === 'EMAIL' ? subject : undefined,
      body,
      audience: {
        ...audience,
        blockIds: audience.blockIds?.length ? audience.blockIds : undefined,
        personIds: audience.group === 'CUSTOM' ? audience.personIds : undefined,
      },
    };
  }

  function validate(): boolean {
    const result = campaignSchema.safeParse(payload());
    if (result.success) {
      setErrors({});
      return true;
    }
    setErrors(Object.fromEntries(result.error.issues.map((i) => [i.path.join('.'), i.message])));
    return false;
  }

  const save = useMutation({
    mutationFn: async (mode: 'draft' | 'send') => {
      const campaign = editId
        ? await api.put<{ id: string }>(`/notifications/campaigns/${editId}`, payload())
        : await api.post<{ id: string }>('/notifications/campaigns', payload());
      if (mode === 'send') {
        await api.post(`/notifications/campaigns/${campaign.id}/send`, {
          scheduledAt: scheduleMode && scheduledAt ? new Date(scheduledAt).toISOString() : null,
        });
      }
      return campaign;
    },
    onSuccess: (campaign) => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      router.push(`/iletisim/${campaign.id}`);
    },
  });

  function submit(mode: 'draft' | 'send') {
    if (!validate()) return;
    if (mode === 'send') {
      const count = preview?.recipientCount ?? 0;
      const when = scheduleMode && scheduledAt ? `${new Date(scheduledAt).toLocaleString('tr-TR')} tarihinde` : 'şimdi';
      if (!window.confirm(`${CHANNEL_LABELS[channel]} ${when} yaklaşık ${count} alıcıya gönderilecek. Onaylıyor musunuz?`)) return;
    }
    save.mutate(mode);
  }

  if (editId && loadingExisting) return <Loading />;
  if (existing && existing.status !== 'DRAFT') {
    return <ErrorBox error={new Error('Yalnızca taslak kampanya düzenlenebilir.')} />;
  }

  const channelTemplates = templates?.filter((t) => t.channel === channel && t.isActive) ?? [];

  return (
    <>
      <PageHeader
        title={editId ? 'Kampanyayı Düzenle' : 'Yeni Bildirim'}
        subtitle="Kişiye özel toplu e-posta, SMS, WhatsApp ya da sesli mesaj"
        breadcrumb={['İletişim', editId ? 'Düzenle' : 'Yeni Bildirim']}
        actions={
          <Link href="/iletisim" className="btn btn-outline-secondary btn-sm">
            Listeye dön
          </Link>
        }
      />

      <div className="row">
        <div className="col-xl-7 mb-4">
          <Card title="Mesaj">
            <div className="card-body">
              <div className="sy-channel-picker mb-3">
                {SUPPORTED_CHANNELS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={item === channel ? 'is-active' : ''}
                    onClick={() => {
                      setChannel(item);
                      setTemplateId('');
                    }}
                  >
                    <i className="material-icons">{CHANNEL_ICONS[item]}</i>
                    {CHANNEL_LABELS[item]}
                  </button>
                ))}
              </div>

              <div className="row">
                <div className="col-md-6 form-group">
                  <label className="form-label">Kampanya Adı</label>
                  <input
                    className={`form-control${errors.name ? ' is-invalid' : ''}`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Eylül aidat hatırlatması"
                  />
                  {errors.name && <div className="invalid-feedback">{errors.name}</div>}
                </div>
                <div className="col-md-6 form-group">
                  <label className="form-label">Şablon</label>
                  <select className="custom-select" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
                    <option value="">Şablonsuz</option>
                    {channelTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} ({template.language})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {channel === 'EMAIL' && (
                <div className="form-group">
                  <label className="form-label">Konu</label>
                  <input
                    className={`form-control${errors.subject ? ' is-invalid' : ''}`}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="{{siteAdi}} — {{donem}} aidat bilgilendirmesi"
                  />
                  {errors.subject && <div className="invalid-feedback">{errors.subject}</div>}
                </div>
              )}

              <div className="form-group mb-2">
                <label className="form-label">Mesaj Metni</label>
                <textarea
                  ref={bodyRef}
                  className={`form-control${errors.body ? ' is-invalid' : ''}`}
                  rows={channel === 'EMAIL' ? 9 : 5}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Sayın {{adSoyad}}, {{daireNo}} nolu dairenizin borcu {{toplamBorc}} tutarındadır."
                />
                {errors.body && <div className="invalid-feedback">{errors.body}</div>}
              </div>
              <MergeFieldButtons target={bodyRef} value={body} onChange={setBody} />
              {preview?.sms && (
                <small className={`d-block mt-2 ${preview.sms.maxSegments > 1 ? 'text-warning' : 'text-muted'}`}>
                  {preview.sms.encoding === 'UCS2'
                    ? `GSM alfabesinde olmayan karakterler (${preview.sms.nonGsmChars.slice(0, 6).join(' ')}) nedeniyle mesaj başına 70 karakter. `
                    : 'Mesaj başına 160 karakter. '}
                  En uzun mesaj {preview.sms.maxSegments} parça · toplam {preview.sms.totalSegments} SMS.
                </small>
              )}
            </div>
          </Card>

          <Card title="Hedef Kitle" className="mt-4">
            <div className="card-body">
              <div className="btn-group btn-group-toggle flex-wrap mb-3" role="group">
                {AUDIENCE_GROUPS.map((group) => (
                  <button
                    key={group.value}
                    type="button"
                    className={`btn btn-sm ${audience.group === group.value ? 'btn-primary' : 'btn-outline-secondary'}`}
                    onClick={() => setAud('group', group.value)}
                  >
                    {group.label}
                  </button>
                ))}
              </div>

              {audience.group === 'CUSTOM' ? (
                <div className="form-group">
                  <label className="form-label">Kişiler (Ctrl ile çoklu seçim)</label>
                  <select
                    multiple
                    className="custom-select"
                    style={{ height: 180 }}
                    value={audience.personIds ?? []}
                    onChange={(e) => setAud('personIds', Array.from(e.target.selectedOptions).map((o) => o.value))}
                  >
                    {people?.items.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.fullName}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <>
                  <div className="form-group">
                    <label className="form-label">Bloklar</label>
                    <div className="d-flex flex-wrap" style={{ gap: '.25rem 1rem' }}>
                      {blocks?.map((block) => {
                        const checked = audience.blockIds?.includes(block.id) ?? false;
                        return (
                          <div className="custom-control custom-checkbox" key={block.id}>
                            <input
                              type="checkbox"
                              className="custom-control-input"
                              id={`block-${block.id}`}
                              checked={checked}
                              onChange={() =>
                                setAud(
                                  'blockIds',
                                  checked
                                    ? audience.blockIds?.filter((id) => id !== block.id)
                                    : [...(audience.blockIds ?? []), block.id],
                                )
                              }
                            />
                            <label className="custom-control-label" htmlFor={`block-${block.id}`}>
                              {block.name}
                            </label>
                          </div>
                        );
                      })}
                      <small className="text-muted">Hiçbiri seçilmezse tüm bloklar.</small>
                    </div>
                  </div>
                  <div className="row">
                    <div className="col-6 col-md-3 form-group">
                      <label className="form-label">En az borç (₺)</label>
                      <input
                        className="form-control"
                        inputMode="decimal"
                        value={audience.minDebt ?? ''}
                        onChange={(e) => setAud('minDebt', e.target.value === '' ? undefined : Number(e.target.value))}
                      />
                    </div>
                    <div className="col-6 col-md-3 form-group">
                      <label className="form-label">En çok borç (₺)</label>
                      <input
                        className="form-control"
                        inputMode="decimal"
                        value={audience.maxDebt ?? ''}
                        onChange={(e) => setAud('maxDebt', e.target.value === '' ? undefined : Number(e.target.value))}
                      />
                    </div>
                    <div className="col-md-6 form-group d-flex flex-column justify-content-end">
                      <div className="custom-control custom-checkbox">
                        <input
                          type="checkbox"
                          className="custom-control-input"
                          id="onlyOverdue"
                          checked={audience.onlyOverdue}
                          onChange={(e) => setAud('onlyOverdue', e.target.checked)}
                        />
                        <label className="custom-control-label" htmlFor="onlyOverdue">
                          Yalnızca vadesi geçmiş borcu olanlar
                        </label>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {channel !== 'EMAIL' && (
                <div className="custom-control custom-checkbox">
                  <input
                    type="checkbox"
                    className="custom-control-input"
                    id="secondPhone"
                    checked={audience.includeSecondPhone}
                    onChange={(e) => setAud('includeSecondPhone', e.target.checked)}
                  />
                  <label className="custom-control-label" htmlFor="secondPhone">
                    2. telefon numarasına da gönder
                  </label>
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="col-xl-5">
          <Card
            title="Önizleme"
            actions={previewing ? <span className="spinner-border spinner-border-sm text-muted" /> : null}
            className="sy-sticky"
          >
            <div className="card-body">
              {previewError && <ErrorBox error={previewError} />}
              {preview && (
                <>
                  <div className="d-flex align-items-baseline mb-3" style={{ gap: '1rem' }}>
                    <div>
                      <div className="sy-stat__label">Alıcı</div>
                      <div className="sy-stat__value sy-num text-primary">{preview.recipientCount}</div>
                    </div>
                    <div className="text-muted small">
                      {preview.matchedCount} kişi eşleşti
                      {preview.excludedCount > 0 && <> · {preview.excludedCount} kişi gönderim dışı</>}
                    </div>
                  </div>

                  {preview.exclusions.length > 0 && (
                    <details className="mb-3">
                      <summary className="small text-warning">
                        {preview.exclusions.map((e) => `${e.count} × ${e.reason}`).join(' · ')}
                      </summary>
                      <ul className="small text-muted mb-0 mt-1 pl-3">
                        {preview.excludedSample.map((item) => (
                          <li key={`${item.personId}-${item.reason}`}>
                            {item.fullName} — {item.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {preview.warnings.map((warning) => (
                    <div key={warning} className="alert alert-warning py-2 small">
                      {warning}
                    </div>
                  ))}

                  {preview.samples.length === 0 ? (
                    <p className="text-muted small mb-0">
                      {body.trim() ? 'Bu kriterlere uyan alıcı yok.' : 'Mesaj yazınca örnek burada görünür.'}
                    </p>
                  ) : (
                    preview.samples.map((sample) => (
                      <div key={sample.recipient} className={`sy-message-sample${channel === 'EMAIL' ? ' is-email' : ''}`}>
                        <div className="sy-message-sample__to">
                          {sample.fullName} · <span className="text-muted">{sample.recipient}</span>
                        </div>
                        {sample.subject && <div className="font-weight-bold mb-1">{sample.subject}</div>}
                        <div style={{ whiteSpace: 'pre-wrap' }}>{sample.body || <em className="text-muted">(boş)</em>}</div>
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
            <div className="card-footer">
              <div className="custom-control custom-checkbox mb-2">
                <input
                  type="checkbox"
                  className="custom-control-input"
                  id="schedule"
                  checked={scheduleMode}
                  onChange={(e) => setScheduleMode(e.target.checked)}
                />
                <label className="custom-control-label" htmlFor="schedule">
                  İleri bir tarihe zamanla
                </label>
              </div>
              {scheduleMode && (
                <input
                  type="datetime-local"
                  className="form-control mb-2"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              )}
              {save.error && <ErrorBox error={save.error} />}
              <div className="d-flex justify-content-end" style={{ gap: '.5rem' }}>
                <button type="button" className="btn btn-outline-secondary" disabled={save.isPending} onClick={() => submit('draft')}>
                  Taslak Kaydet
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={save.isPending || !preview?.recipientCount || (scheduleMode && !scheduledAt)}
                  onClick={() => submit('send')}
                >
                  <i className="material-icons mr-1" style={{ fontSize: 16, verticalAlign: -3 }}>send</i>
                  {scheduleMode ? 'Zamanla' : 'Gönder'}
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
