'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TICKET_TYPE_LABELS, portalTicketSchema } from '@sy/shared';
import { api } from '@/lib/api';
import { date } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading } from '@/components/ui';
import { TicketStatusBadge, usePortalSummary, type TicketStatus } from '@/components/portal';

interface MyTicket {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  requestType: keyof typeof TICKET_TYPE_LABELS;
  date: string;
  completedAt: string | null;
  unit: { doorNumber: string; block: { name: string } | null } | null;
  survey: { rating: number } | null;
  _count: { comments: number };
}

/** Sakinin seçebileceği tipler — "memnuniyet" ayrı anketle toplanır */
const RESIDENT_TYPES = ['FAULT', 'REQUEST', 'COMPLAINT', 'SUGGESTION', 'QUESTION', 'OTHER'] as const;

export default function PortalTicketsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PortalTickets />
    </Suspense>
  );
}

function PortalTickets() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(searchParams.get('yeni') === '1');
  const [form, setForm] = useState({ subject: '', description: '', requestType: 'FAULT', unitId: '', area: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: summary } = usePortalSummary();
  // Varsayılan daire: sakinin ilk dairesi (ortak alan ayrıca seçilebilir)
  const firstUnit = summary?.units[0]?.id;
  useEffect(() => {
    if (firstUnit) setForm((current) => (current.unitId ? current : { ...current, unitId: firstUnit }));
  }, [firstUnit]);
  const { data, isLoading, error } = useQuery({
    queryKey: ['portal', 'tickets'],
    queryFn: () => api.get<MyTicket[]>('/portal/tickets'),
  });

  const create = useMutation({
    mutationFn: (payload: unknown) => api.post<{ id: string }>('/portal/tickets', payload),
    onSuccess: (ticket) => {
      void queryClient.invalidateQueries({ queryKey: ['portal'] });
      router.push(`/portal/talepler/${ticket.id}`);
    },
  });

  function submit() {
    const payload = { ...form, unitId: form.unitId || null, area: form.area || undefined };
    const result = portalTicketSchema.safeParse(payload);
    if (!result.success) {
      setErrors(Object.fromEntries(result.error.issues.map((i) => [i.path.join('.'), i.message])));
      return;
    }
    setErrors({});
    create.mutate(result.data);
  }

  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h3 m-0">Taleplerim</h1>
        {!formOpen && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setFormOpen(true)}>
            <i className="material-icons mr-1" style={{ fontSize: 16, verticalAlign: -3 }}>add</i>
            Yeni Talep
          </button>
        )}
      </div>

      {formOpen && (
        <Card title="Yeni Talep / Arıza Bildirimi" className="mb-4">
          <div className="card-body">
            <div className="row">
              <div className="col-md-6 form-group">
                <label className="form-label">Konu</label>
                <input
                  className={`form-control${errors.subject ? ' is-invalid' : ''}`}
                  value={form.subject}
                  onChange={(e) => set('subject', e.target.value)}
                  placeholder="Mutfak musluğu damlatıyor"
                />
                {errors.subject && <div className="invalid-feedback">{errors.subject}</div>}
              </div>
              <div className="col-md-3 col-6 form-group">
                <label className="form-label">Tür</label>
                <select className="custom-select" value={form.requestType} onChange={(e) => set('requestType', e.target.value)}>
                  {RESIDENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {TICKET_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-3 col-6 form-group">
                <label className="form-label">Daire</label>
                <select className="custom-select" value={form.unitId} onChange={(e) => set('unitId', e.target.value)}>
                  {summary?.units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.label}
                    </option>
                  ))}
                  <option value="">Ortak alan</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Açıklama</label>
              <textarea
                className={`form-control${errors.description ? ' is-invalid' : ''}`}
                rows={4}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Sorunu ve varsa uygun olduğunuz saatleri yazın"
              />
              {errors.description && <div className="invalid-feedback">{errors.description}</div>}
            </div>
            <div className="form-group">
              <label className="form-label">İlgili Alan (isteğe bağlı)</label>
              <input className="form-control" value={form.area} onChange={(e) => set('area', e.target.value)} placeholder="Banyo, otopark, asansör..." />
            </div>
            {create.error && <ErrorBox error={create.error} />}
            <div className="d-flex justify-content-end" style={{ gap: '.5rem' }}>
              <button type="button" className="btn btn-outline-secondary" onClick={() => setFormOpen(false)}>
                Vazgeç
              </button>
              <button type="button" className="btn btn-primary" disabled={create.isPending} onClick={submit}>
                {create.isPending ? 'Gönderiliyor...' : 'Talebi Gönder'}
              </button>
            </div>
          </div>
        </Card>
      )}

      {error && <ErrorBox error={error} />}
      <Card>
        {isLoading ? (
          <div className="card-body">
            <Loading />
          </div>
        ) : data && data.length === 0 ? (
          <EmptyState message="Henüz talebiniz yok." icon="build" />
        ) : (
          <ul className="list-group list-group-flush">
            {data?.map((ticket) => (
              <li key={ticket.id} className="list-group-item">
                <Link href={`/portal/talepler/${ticket.id}`} className="d-flex justify-content-between align-items-center" style={{ gap: '.75rem' }}>
                  <span>
                    <span className="text-muted mr-2">#{ticket.number}</span>
                    <strong>{ticket.subject}</strong>
                    <small className="d-block text-muted">
                      {TICKET_TYPE_LABELS[ticket.requestType]} · {date(ticket.date)}
                      {ticket._count.comments > 0 && ` · ${ticket._count.comments} yanıt`}
                    </small>
                  </span>
                  <span className="text-nowrap">
                    {ticket.status === 'COMPLETED' && !ticket.survey && <span className="badge badge-warning mr-1">Puanlayın</span>}
                    <TicketStatusBadge status={ticket.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
