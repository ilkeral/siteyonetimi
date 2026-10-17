'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { INCIDENT_CATEGORY_LABELS, type SecurityIncidentInput } from '@sy/shared';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { dateTime, dateTimeInput } from '@/lib/format';
import { Card, ErrorBox, Loading, PageHeader } from '@/components/ui';
import {
  IncidentForm,
  SeverityBadge,
  type IncidentCategory,
  type IncidentFormValue,
  type IncidentSeverity,
  type Labelled,
  type NamedRef,
} from '@/components/security';

interface IncidentDetail {
  id: string;
  date: string;
  title: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  body: string;
  personId: string | null;
  unitId: string | null;
  staffId: string | null;
  person: NamedRef | null;
  unit: Labelled | null;
  staff: NamedRef | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useMe();
  const [editing, setEditing] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['security', 'incident', id],
    queryFn: () => api.get<IncidentDetail>(`/security/incidents/${id}`),
  });

  const initial = useMemo<IncidentFormValue | null>(
    () =>
      data
        ? {
            date: dateTimeInput(data.date),
            title: data.title,
            category: data.category,
            severity: data.severity,
            staffId: data.staffId ?? '',
            personId: data.personId ?? '',
            unitId: data.unitId ?? '',
            body: data.body,
          }
        : null,
    [data],
  );

  const update = useMutation({
    mutationFn: (payload: SecurityIncidentInput) => api.put(`/security/incidents/${id}`, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['security'] });
      setEditing(false);
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/security/incidents/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['security'] });
      router.push('/guvenlik/olaylar');
    },
  });

  if (isLoading) return <Loading />;
  if (error || !data || !initial) return <ErrorBox error={error ?? new Error('Olay kaydı bulunamadı')} />;

  return (
    <>
      <PageHeader
        title={data.title}
        breadcrumb={['Güvenlik', 'Olay Kayıtları', 'Detay']}
        actions={
          <>
            <Link href="/guvenlik/olaylar" className="btn btn-outline-secondary btn-sm">
              Listeye dön
            </Link>
            {data.canEdit && !editing && (
              <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => setEditing(true)}>
                Düzenle
              </button>
            )}
            {can('SITE_ADMIN') && (
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm('Olay kaydı kalıcı olarak silinecek. Emin misiniz?')) remove.mutate();
                }}
              >
                Sil
              </button>
            )}
          </>
        }
      />
      {Boolean(remove.error) && <ErrorBox error={remove.error} />}

      <div className="row">
        <div className="col-xl-8">
          {editing ? (
            <Card title="Olayı Düzenle">
              <div className="card-body">
                <IncidentForm
                  initial={initial}
                  submitLabel="Kaydet"
                  pending={update.isPending}
                  error={update.error}
                  onSubmit={(payload) => update.mutate(payload)}
                  onCancel={() => setEditing(false)}
                />
              </div>
            </Card>
          ) : (
            <Card title="Olay Açıklaması">
              {/* Düz metin: HTML olarak yorumlanmaz, satır sonları korunur */}
              <div className="card-body sy-plain-text">{data.body}</div>
            </Card>
          )}
        </div>
        <div className="col-xl-4">
          <Card title="Bilgiler">
            <ul className="list-group list-group-flush">
              <InfoRow label="Olay zamanı" value={dateTime(data.date)} />
              <InfoRow label="Kategori" value={INCIDENT_CATEGORY_LABELS[data.category]} />
              <InfoRow label="Önem" value={<SeverityBadge severity={data.severity} />} />
              <InfoRow label="Daire" value={data.unit?.label ?? '—'} />
              <InfoRow
                label="Kişi"
                value={data.person ? <Link href={`/site/${data.person.id}`}>{data.person.fullName}</Link> : '—'}
              />
              <InfoRow label="Görevli" value={data.staff?.fullName ?? '—'} />
              <InfoRow label="Kaydı açan" value={data.createdBy ?? '—'} />
              <InfoRow label="Kayıt" value={dateTime(data.createdAt)} />
              {data.updatedAt !== data.createdAt && <InfoRow label="Son değişiklik" value={dateTime(data.updatedAt)} />}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <li className="list-group-item d-flex justify-content-between align-items-center" style={{ gap: '1rem' }}>
      <span className="text-muted">{label}</span>
      <span className="text-right">{value}</span>
    </li>
  );
}
