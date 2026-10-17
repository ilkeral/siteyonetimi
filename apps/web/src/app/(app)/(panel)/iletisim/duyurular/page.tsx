'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { announcementSchema } from '@sy/shared';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Table } from '@/components/ui';

interface Announcement {
  id: string;
  title: string;
  body: string;
  publishAt: string;
  expireAt: string | null;
  isPinned: boolean;
  isActive: boolean;
}

type Form = { title: string; body: string; publishAt: string; expireAt: string; isPinned: boolean; isActive: boolean };

/** datetime-local girişi yerel saat ister: "2026-10-16T14:30" */
function localInput(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

const empty = (): Form => ({ title: '', body: '', publishAt: localInput(new Date()), expireAt: '', isPinned: false, isActive: true });

function state(item: Announcement): { label: string; tone: string } {
  const now = Date.now();
  if (!item.isActive) return { label: 'Pasif', tone: 'badge-light' };
  if (new Date(item.publishAt).getTime() > now) return { label: 'Zamanlandı', tone: 'badge-purple' };
  if (item.expireAt && new Date(item.expireAt).getTime() <= now) return { label: 'Süresi doldu', tone: 'badge-secondary' };
  return { label: 'Yayında', tone: 'badge-success' };
}

export default function AnnouncementsPage() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['announcements'],
    queryFn: () => api.get<Announcement[]>('/announcements'),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['announcements'] });

  const payload = () => ({
    title: form.title,
    body: form.body,
    publishAt: form.publishAt ? new Date(form.publishAt).toISOString() : undefined,
    expireAt: form.expireAt ? new Date(form.expireAt).toISOString() : null,
    isPinned: form.isPinned,
    isActive: form.isActive,
  });

  const save = useMutation({
    mutationFn: () => (editingId ? api.put(`/announcements/${editingId}`, payload()) : api.post('/announcements', payload())),
    onSuccess: () => {
      setEditingId(null);
      setForm(empty());
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/announcements/${id}`),
    onSuccess: () => void refresh(),
  });

  function submit() {
    const result = announcementSchema.safeParse(payload());
    if (!result.success) return setFormError(result.error.issues[0].message);
    setFormError(null);
    save.mutate();
  }

  function edit(item: Announcement) {
    setEditingId(item.id);
    setForm({
      title: item.title,
      body: item.body,
      publishAt: localInput(item.publishAt),
      expireAt: localInput(item.expireAt),
      isPinned: item.isPinned,
      isActive: item.isActive,
    });
  }

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <>
      <PageHeader title="Duyurular" subtitle="İkamet Eden Portalında yayınlanan duyurular" breadcrumb={['İletişim', 'Duyurular']} />
      <div className="row">
        <div className="col-xl-7 mb-4">
          <Card>
            {(error || remove.error) && (
              <div className="card-body pb-0">
                <ErrorBox error={error ?? remove.error} />
              </div>
            )}
            {isLoading ? (
              <div className="card-body">
                <Loading />
              </div>
            ) : data && data.length === 0 ? (
              <EmptyState message="Duyuru yok." icon="announcement" />
            ) : data ? (
              <Table
                head={
                  <tr>
                    <th>Duyuru</th>
                    <th>Yayın</th>
                    <th>Bitiş</th>
                    <th>Durum</th>
                    <th />
                  </tr>
                }
              >
                {data.map((item) => {
                  const status = state(item);
                  return (
                    <tr key={item.id} className={editingId === item.id ? 'table-active' : ''}>
                      <td>
                        <strong>
                          {item.isPinned && <i className="material-icons text-warning mr-1" style={{ fontSize: 16, verticalAlign: -3 }}>star</i>}
                          {item.title}
                        </strong>
                        <small className="d-block text-muted text-truncate" style={{ maxWidth: 300 }}>
                          {item.body}
                        </small>
                      </td>
                      <td>{dateTime(item.publishAt)}</td>
                      <td>{item.expireAt ? dateTime(item.expireAt) : '—'}</td>
                      <td>
                        <span className={`badge ${status.tone}`}>{status.label}</span>
                      </td>
                      <td className="text-right text-nowrap">
                        <button type="button" className="btn btn-link btn-sm p-0 mr-2" onClick={() => edit(item)}>
                          Düzenle
                        </button>
                        <button
                          type="button"
                          className="btn btn-link btn-sm text-danger p-0"
                          onClick={() => window.confirm(`"${item.title}" silinsin mi?`) && remove.mutate(item.id)}
                        >
                          Sil
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </Table>
            ) : null}
          </Card>
        </div>

        <div className="col-xl-5">
          <Card title={editingId ? 'Duyuruyu Düzenle' : 'Yeni Duyuru'}>
            <div className="card-body">
              <div className="form-group">
                <label className="form-label">Başlık</label>
                <input className="form-control" value={form.title} onChange={(e) => set('title', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Metin</label>
                <textarea className="form-control" rows={6} value={form.body} onChange={(e) => set('body', e.target.value)} />
              </div>
              <div className="row">
                <div className="col-6 form-group">
                  <label className="form-label">Yayın Zamanı</label>
                  <input type="datetime-local" className="form-control" value={form.publishAt} onChange={(e) => set('publishAt', e.target.value)} />
                </div>
                <div className="col-6 form-group">
                  <label className="form-label">Bitiş (isteğe bağlı)</label>
                  <input type="datetime-local" className="form-control" value={form.expireAt} onChange={(e) => set('expireAt', e.target.value)} />
                </div>
              </div>
              <div className="custom-control custom-checkbox">
                <input type="checkbox" className="custom-control-input" id="pinned" checked={form.isPinned} onChange={(e) => set('isPinned', e.target.checked)} />
                <label className="custom-control-label" htmlFor="pinned">
                  Sabitle (listenin en üstünde)
                </label>
              </div>
              <div className="custom-control custom-checkbox mb-3">
                <input type="checkbox" className="custom-control-input" id="activeAnn" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
                <label className="custom-control-label" htmlFor="activeAnn">
                  Aktif
                </label>
              </div>
              {(formError || save.error) && <ErrorBox error={formError ? new Error(formError) : save.error} />}
              <div className="d-flex justify-content-end" style={{ gap: '.5rem' }}>
                {editingId && (
                  <button type="button" className="btn btn-outline-secondary" onClick={() => { setEditingId(null); setForm(empty()); }}>
                    Vazgeç
                  </button>
                )}
                <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={submit}>
                  {editingId ? 'Kaydet' : 'Yayınla'}
                </button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
