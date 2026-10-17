'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LOST_ITEM_STATUS_LABELS, type LostItemDetailsInput, type LostItemTransitionBody } from '@sy/shared';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { dateTime } from '@/lib/format';
import { Card, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { LostStatusBadge, type LostItem, type LostItemStatus } from '@/components/security';
import { LostItemActions, LostItemDetailsForm, LostItemSteps } from '@/components/lost-items';

interface LostItemDetail extends LostItem {
  createdBy: string | null;
  history: { id: string; action: string; status: LostItemStatus | null; at: string; user: string | null }[];
}

export default function LostItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useMe();
  const [editing, setEditing] = useState(false);

  const { data: item, isLoading, error } = useQuery({
    queryKey: ['security', 'lost-item', id],
    queryFn: () => api.get<LostItemDetail>(`/security/lost-items/${id}`),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['security'] });

  const transition = useMutation({
    mutationFn: (body: LostItemTransitionBody) => api.post(`/security/lost-items/${id}/transition`, body),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: (payload: LostItemDetailsInput) => api.put(`/security/lost-items/${id}`, payload),
    onSuccess: () => {
      invalidate();
      setEditing(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/security/lost-items/${id}`),
    onSuccess: () => {
      invalidate();
      router.push('/guvenlik/kayip-esya');
    },
  });

  if (isLoading) return <Loading />;
  if (error || !item) return <ErrorBox error={error ?? new Error('Kayıt bulunamadı')} />;

  const closed = item.status === 'DELIVERED' || item.status === 'DISPOSED';
  const visited = visitedPath(item.history);

  return (
    <>
      <PageHeader
        title={`#${item.number} · ${item.itemName}`}
        breadcrumb={['Güvenlik', 'Kayıp Eşya', `#${item.number}`]}
        actions={
          <>
            <Link href="/guvenlik/kayip-esya" className="btn btn-outline-secondary btn-sm">
              Listeye dön
            </Link>
            {!closed && !editing && (
              <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => setEditing(true)}>
                Bilgileri Düzelt
              </button>
            )}
            {item.status === 'LOST' && can('SITE_ADMIN') && (
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm('Kayıp bildirimi geri çekilecek. Emin misiniz?')) remove.mutate();
                }}
              >
                Bildirimi Geri Çek
              </button>
            )}
          </>
        }
      />
      {Boolean(remove.error) && <ErrorBox error={remove.error} />}

      <LostItemSteps item={item} visited={visited} />

      <div className="row">
        <div className="col-xl-8">
          {editing ? (
            <Card title="Bilgileri Düzelt">
              <div className="card-body">
                <LostItemDetailsForm
                  item={item}
                  pending={update.isPending}
                  error={update.error}
                  onSubmit={(payload) => update.mutate(payload)}
                  onCancel={() => setEditing(false)}
                />
              </div>
            </Card>
          ) : (
            <Card title="Eşya">
              <ul className="list-group list-group-flush">
                <InfoRow label="Durum" value={<LostStatusBadge status={item.status} />} />
                <InfoRow label="Tarif" value={item.description} />
                <InfoRow label="Yer" value={item.location} />
                <InfoRow label="Kaybedilme" value={item.lostAt && dateTime(item.lostAt)} />
                <InfoRow label="Bulunma" value={item.foundAt && dateTime(item.foundAt)} />
                <InfoRow label="Bulan" value={joined(item.finderName, item.finderPhone)} />
                <InfoRow label="Emanetçi" value={joined(item.custodianName, item.custodianRole)} />
                <InfoRow label="Emanette" value={item.daysInCustody !== null && `${item.daysInCustody} gün`} />
                <InfoRow label="Sahibi / talep eden" value={joined(item.loserName, item.loserPhone)} />
                <InfoRow label="Teslim alan" value={item.deliveredTo && `${item.deliveredTo} · ${dateTime(item.deliveredAt)}`} />
                <InfoRow label="İmha / bağış" value={item.disposalNote && `${item.disposalNote} · ${dateTime(item.disposedAt)}`} />
                <InfoRow label="Kaydı açan" value={item.createdBy} />
              </ul>
            </Card>
          )}
        </div>

        <div className="col-xl-4">
          {!closed && (
            <Card title="Sonraki Adım">
              <div className="card-body">
                {/* Durum değişince form yeniden kurulsun (seçili eylem ve alanlar sıfırlansın) */}
                <LostItemActions
                  key={item.status}
                  item={item}
                  pending={transition.isPending}
                  error={transition.error}
                  onSubmit={(body) => transition.mutate(body)}
                />
              </div>
            </Card>
          )}
          <Card title="İşlem Geçmişi">
            <ul className="list-group list-group-flush">
              {item.history.map((h, index) => (
                <li key={h.id} className="list-group-item">
                  <div className="font-weight-bold">{historyLabel(h, lastStatusBefore(item.history, index))}</div>
                  <small className="text-muted">
                    {dateTime(h.at)}
                    {h.user ? ` · ${h.user}` : ''}
                  </small>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

type HistoryEntry = LostItemDetail['history'][number];

/**
 * Eşyanın son haline gelen yol: reddedilen talep (CLAIMED → FOUND) yoldan
 * çıkarılır — sonradan doğrudan teslim edilen eşyada "Sahibi Çıktı" adımı
 * tamamlanmış görünmesin.
 */
function visitedPath(history: HistoryEntry[]): LostItemStatus[] {
  const path: LostItemStatus[] = [];
  for (const entry of history) {
    if (!entry.status) continue;
    if (entry.status === 'FOUND' && path[path.length - 1] === 'CLAIMED') path.pop();
    else path.push(entry.status);
  }
  return path;
}

function lastStatusBefore(history: HistoryEntry[], index: number): LostItemStatus | null {
  for (let i = index - 1; i >= 0; i--) if (history[i].status) return history[i].status;
  return null;
}

function historyLabel(entry: HistoryEntry, previous: LostItemStatus | null) {
  if (entry.action === 'CREATE') return `Kayıt açıldı · ${entry.status ? LOST_ITEM_STATUS_LABELS[entry.status] : ''}`;
  if (!entry.status) return 'Bilgiler düzeltildi';
  if (entry.status === 'FOUND' && previous === 'CLAIMED') return 'Talep reddedildi, emanete döndü';
  return LOST_ITEM_STATUS_LABELS[entry.status];
}

function joined(...parts: (string | null)[]) {
  return parts.filter(Boolean).join(' · ') || null;
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === false || value === '') return null;
  return (
    <li className="list-group-item d-flex justify-content-between align-items-center" style={{ gap: '1rem' }}>
      <span className="text-muted">{label}</span>
      <span className="text-right">{value}</span>
    </li>
  );
}
