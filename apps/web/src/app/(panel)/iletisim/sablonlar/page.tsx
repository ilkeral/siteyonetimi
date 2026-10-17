'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CHANNEL_LABELS, LANGUAGE_LABELS, notificationTemplateSchema, validateMergeFields } from '@sy/shared';
import { api } from '@/lib/api';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Table } from '@/components/ui';
import {
  ChannelLabel,
  MergeFieldButtons,
  SUPPORTED_CHANNELS,
  useTemplates,
  type Channel,
  type Template,
} from '@/components/notifications';

type Form = Omit<Template, 'id' | '_count' | 'subject'> & { subject: string };

const EMPTY: Form = { channel: 'SMS', language: 'TR', name: '', subject: '', body: '', isActive: true };

export default function TemplatesPage() {
  const queryClient = useQueryClient();
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const { data, isLoading, error } = useTemplates();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const unknown = validateMergeFields(`${form.subject}\n${form.body}`);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications', 'templates'] });
  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, subject: form.channel === 'EMAIL' ? form.subject : null };
      return editingId
        ? api.put(`/notifications/templates/${editingId}`, payload)
        : api.post('/notifications/templates', payload);
    },
    onSuccess: () => {
      void refresh();
      setEditingId(null);
      setForm(EMPTY);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/notifications/templates/${id}`),
    onSuccess: () => void refresh(),
  });

  function edit(template: Template) {
    setEditingId(template.id);
    setForm({ ...template, subject: template.subject ?? '' });
    setFormError(null);
  }

  function submit() {
    const result = notificationTemplateSchema.safeParse(form);
    if (!result.success) return setFormError(result.error.issues[0].message);
    if (form.channel === 'EMAIL' && !form.subject.trim()) return setFormError('E-posta şablonu için konu zorunlu');
    setFormError(null);
    save.mutate();
  }

  return (
    <>
      <PageHeader
        title="Bildirim Şablonları"
        subtitle="Tekrar kullanılan mesaj metinleri — {{alan}} yerleri kişiye özel doldurulur"
        breadcrumb={['İletişim', 'Şablonlar']}
        actions={
          <Link href="/iletisim" className="btn btn-outline-secondary btn-sm">
            Bildirimlere dön
          </Link>
        }
      />

      <div className="row">
        <div className="col-xl-7 mb-4">
          <Card>
            {error && (
              <div className="card-body">
                <ErrorBox error={error} />
              </div>
            )}
            {remove.error && (
              <div className="card-body pb-0">
                <ErrorBox error={remove.error} />
              </div>
            )}
            {isLoading ? (
              <div className="card-body">
                <Loading />
              </div>
            ) : data && data.length === 0 ? (
              <EmptyState message="Şablon yok." icon="description" />
            ) : data ? (
              <Table
                head={
                  <tr>
                    <th>Şablon</th>
                    <th>Kanal</th>
                    <th>Dil</th>
                    <th className="text-right">Kullanım</th>
                    <th />
                  </tr>
                }
              >
                {data.map((template) => (
                  <tr key={template.id} className={editingId === template.id ? 'table-active' : ''}>
                    <td>
                      <div className="font-weight-bold">
                        {template.name}
                        {!template.isActive && <span className="badge badge-light ml-1">Pasif</span>}
                      </div>
                      <small className="text-muted d-block text-truncate" style={{ maxWidth: 320 }}>
                        {template.subject ?? template.body}
                      </small>
                    </td>
                    <td>
                      <ChannelLabel channel={template.channel} />
                    </td>
                    <td>{LANGUAGE_LABELS[template.language]}</td>
                    <td className="text-right sy-num">{template._count?.campaigns ?? 0}</td>
                    <td className="text-right text-nowrap">
                      <button type="button" className="btn btn-link btn-sm p-0 mr-2" onClick={() => edit(template)}>
                        Düzenle
                      </button>
                      <button
                        type="button"
                        className="btn btn-link btn-sm text-danger p-0"
                        onClick={() => {
                          if (window.confirm(`"${template.name}" şablonu silinsin mi? Gönderilmiş kampanyalar etkilenmez.`)) {
                            remove.mutate(template.id);
                          }
                        }}
                      >
                        Sil
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            ) : null}
          </Card>
        </div>

        <div className="col-xl-5">
          <Card title={editingId ? 'Şablonu Düzenle' : 'Yeni Şablon'}>
            <div className="card-body">
              <div className="row">
                <div className="col-6 form-group">
                  <label className="form-label">Kanal</label>
                  <select className="custom-select" value={form.channel} onChange={(e) => set('channel', e.target.value as Channel)}>
                    {SUPPORTED_CHANNELS.map((channel) => (
                      <option key={channel} value={channel}>
                        {CHANNEL_LABELS[channel]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-6 form-group">
                  <label className="form-label">Dil</label>
                  <select className="custom-select" value={form.language} onChange={(e) => set('language', e.target.value as Form['language'])}>
                    {Object.entries(LANGUAGE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Şablon Adı</label>
                <input className="form-control" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Aidat hatırlatma" />
              </div>
              {form.channel === 'EMAIL' && (
                <div className="form-group">
                  <label className="form-label">Konu</label>
                  <input className="form-control" value={form.subject} onChange={(e) => set('subject', e.target.value)} />
                </div>
              )}
              <div className="form-group mb-2">
                <label className="form-label">Metin</label>
                <textarea ref={bodyRef} className="form-control" rows={7} value={form.body} onChange={(e) => set('body', e.target.value)} />
              </div>
              <MergeFieldButtons target={bodyRef} value={form.body} onChange={(value) => set('body', value)} />
              {unknown.length > 0 && (
                <small className="text-danger d-block mt-2">
                  Tanımsız alan: {unknown.map((f) => `{{${f}}}`).join(', ')}
                </small>
              )}
              <div className="custom-control custom-checkbox mt-3">
                <input type="checkbox" className="custom-control-input" id="active" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
                <label className="custom-control-label" htmlFor="active">
                  Aktif (kampanya oluştururken listelenir)
                </label>
              </div>
              {(formError || save.error) && (
                <div className="mt-3">
                  <ErrorBox error={formError ? new Error(formError) : save.error} />
                </div>
              )}
              <div className="d-flex justify-content-end mt-3" style={{ gap: '.5rem' }}>
                {editingId && (
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => {
                      setEditingId(null);
                      setForm(EMPTY);
                    }}
                  >
                    Vazgeç
                  </button>
                )}
                <button type="button" className="btn btn-primary" disabled={save.isPending || unknown.length > 0} onClick={submit}>
                  {editingId ? 'Kaydet' : 'Şablonu Ekle'}
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
