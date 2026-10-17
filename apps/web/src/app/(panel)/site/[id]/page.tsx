'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CHANNEL_LABELS, MESSAGE_STATUS_LABELS, TICKET_STATUS_LABELS, type PersonInput } from '@sy/shared';
import { api } from '@/lib/api';
import { balanceClass, date, dateTime, money, todayInput } from '@/lib/format';
import { OccupancyForm, PersonForm, VehicleForm, personToForm, type OccupancyInput, type VehicleInput } from '@/components/people';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Table } from '@/components/ui';
import { PortalAccessBox } from '@/components/portal-access';
import { ScoreBadge, type ScoreSegment } from '@/components/reports';
import { useMe } from '@/lib/me';

interface PersonDetail {
  id: string;
  firstName: string;
  lastName: string;
  nationalId: string | null;
  email: string | null;
  phone: string | null;
  phone2: string | null;
  birthDate: string | null;
  language: string;
  note: string | null;
  inLegalAction: boolean;
  balanceMinor: number;
  account: { id: string; name: string } | null;
  vehicles: {
    id: string;
    plate: string;
    brand: string | null;
    model: string | null;
    color: string | null;
    hgsNumber: string | null;
    status: string | null;
  }[];
  occupancies: {
    id: string;
    role: 'OWNER' | 'TENANT';
    startDate: string;
    endDate: string | null;
    bankPaymentCode: string | null;
    unit: { id: string; doorNumber: string; floor: number | null; block: { name: string } | null };
  }[];
  tickets: { id: string; number: number; subject: string; status: string; date: string }[];
  messages: {
    id: string;
    channel: string;
    subject: string | null;
    body: string;
    recipient: string;
    status: keyof typeof MESSAGE_STATUS_LABELS;
    createdAt: string;
  }[];
}

const TABS = [
  { key: 'genel', label: 'Genel Bilgiler', icon: 'person' },
  { key: 'daireler', label: 'Daireler', icon: 'home' },
  { key: 'araclar', label: 'Araçlar', icon: 'directions_car' },
  { key: 'hesap', label: 'Cari Hesap', icon: 'account_balance_wallet' },
  { key: 'talepler', label: 'Talepler', icon: 'build' },
  { key: 'iletisim', label: 'İletişim Geçmişi', icon: 'mail_outline' },
] as const;

export default function PersonDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('genel');
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState<'occupancy' | 'vehicle' | null>(null);
  const [ending, setEnding] = useState<{ id: string; endDate: string } | null>(null);
  const { can } = useMe();
  const canEdit = can('SITE_ADMIN', 'ACCOUNTANT');
  const canVehicles = can('SITE_ADMIN', 'ACCOUNTANT', 'SECURITY');

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['person', params.id] });
    void queryClient.invalidateQueries({ queryKey: ['people'] });
    void queryClient.invalidateQueries({ queryKey: ['units'] });
  };
  const update = useMutation({
    mutationFn: (payload: PersonInput) => api.put(`/people/${params.id}`, payload),
    onSuccess: () => {
      refresh();
      setEditing(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete<{ deleted: boolean; deactivated: boolean }>(`/people/${params.id}`),
    onSuccess: (result) => {
      // Kart sorgusuna dokunulmaz: sayfa hâlâ açıkken yenilenirse silinen kişi
      // için 404 alınır. Yalnızca listeler tazelenir.
      void queryClient.invalidateQueries({ queryKey: ['people'] });
      void queryClient.invalidateQueries({ queryKey: ['units'] });
      if (result.deactivated) {
        window.alert('Kişinin cari hareketleri olduğu için silinmedi, pasife alındı. Geçmiş kayıtlar korunuyor.');
      }
      router.push('/site');
    },
  });
  const addOccupancy = useMutation({
    mutationFn: (payload: OccupancyInput) => api.post('/people/occupancies', payload),
    onSuccess: () => {
      refresh();
      setAdding(null);
    },
  });
  const endOccupancy = useMutation({
    mutationFn: (body: { id: string; endDate: string }) =>
      api.put(`/people/occupancies/${body.id}/end`, { endDate: body.endDate }),
    onSuccess: () => {
      refresh();
      setEnding(null);
    },
  });
  const addVehicle = useMutation({
    mutationFn: (payload: VehicleInput) => api.post(`/people/${params.id}/vehicles`, payload),
    onSuccess: () => {
      refresh();
      setAdding(null);
    },
  });
  const removeVehicle = useMutation({
    mutationFn: (id: string) => api.delete(`/people/vehicles/${id}`),
    onSuccess: refresh,
  });
  const { data: score } = useQuery({
    queryKey: ['person-score', params.id],
    queryFn: () => api.get<{ score: number; segment: ScoreSegment } | null>(`/reports/payment-scores/person/${params.id}`),
    enabled: can('SITE_ADMIN', 'ACCOUNTANT', 'TECHNICIAN', 'SECURITY'),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['person', params.id],
    queryFn: () => api.get<PersonDetail>(`/people/${params.id}`),
  });

  const formInitial = useMemo(() => (data ? personToForm(data) : null), [data]);

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data || !formInitial) return null;

  return (
    <>
      <PageHeader
        title={`${data.firstName} ${data.lastName}`}
        subtitle={data.inLegalAction ? 'İcra takibinde' : 'Kişi kartı'}
        actions={
          <>
            {score && (
              <Link href="/raporlar/odeme-skoru" title="Ödeme skoru (son 6 ay)" className="d-inline-flex align-items-center" style={{ gap: 4 }}>
                <small className="text-muted">Skor</small>
                <ScoreBadge score={score.score} segment={score.segment} />
              </Link>
            )}
            <span className={`h5 m-0 sy-num ${balanceClass(data.balanceMinor)}`}>
              {money(data.balanceMinor)}
            </span>
            <Link href="/site" className="btn btn-outline-secondary btn-sm">
              Listeye dön
            </Link>
            {canEdit && !editing && (
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={() => {
                  setTab('genel');
                  setEditing(true);
                }}
              >
                Düzenle
              </button>
            )}
            {can('SITE_ADMIN') && (
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                disabled={remove.isPending}
                onClick={() => {
                  const message = `${data.firstName} ${data.lastName} silinecek. Cari hareketi varsa yalnızca pasife alınır. Devam edilsin mi?`;
                  if (window.confirm(message)) remove.mutate();
                }}
              >
                Sil
              </button>
            )}
          </>
        }
      />

      {Boolean(remove.error) && <ErrorBox error={remove.error} />}
      <div className="card card-shadow">
        <div className="card-header p-0">
          <ul className="nav nav-tabs nav-tabs-card">
            {TABS.map((item) => (
              <li className="nav-item" key={item.key}>
                <button
                  type="button"
                  className={`nav-link${tab === item.key ? ' active' : ''}`}
                  onClick={() => setTab(item.key)}
                >
                  <i className="material-icons mr-1" style={{ fontSize: 16 }}>
                    {item.icon}
                  </i>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className={tab === 'genel' ? 'card-body' : ''}>
          {tab === 'genel' && editing && (
            <PersonForm
              initial={formInitial}
              submitLabel="Kaydet"
              pending={update.isPending}
              error={update.error}
              onSubmit={(payload) => update.mutate(payload)}
              onCancel={() => setEditing(false)}
            />
          )}
          {tab === 'genel' && !editing && (
            <div className="row">
              <div className="col-md-6">
                <Row label="TC Kimlik No" value={data.nationalId} />
                <Row label="Cep telefonu" value={data.phone} />
                <Row label="E-posta" value={data.email} />
              </div>
              <div className="col-md-6">
                <Row label="İletişim dili" value={data.language} />
                <Row label="2. telefon" value={data.phone2} />
                <Row label="Doğum tarihi" value={data.birthDate ? date(data.birthDate) : null} />
                <Row label="Cari hesap" value={data.account?.name} />
              </div>
              <div className="col-12 mt-3">
                <div className="text-muted small mb-1">Not</div>
                <div>{data.note || '—'}</div>
              </div>
              {can('SITE_ADMIN') && (
                <div className="col-12 mt-4 pt-3 border-top">
                  <PortalAccessBox personId={data.id} defaultEmail={data.email} />
                </div>
              )}
            </div>
          )}

          {tab === 'daireler' && canEdit && (
            <div className="card-body border-bottom">
              {adding === 'occupancy' ? (
                <OccupancyForm
                  personId={data.id}
                  pending={addOccupancy.isPending}
                  error={addOccupancy.error}
                  onSubmit={(payload) => addOccupancy.mutate(payload)}
                  onCancel={() => setAdding(null)}
                />
              ) : (
                <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => setAdding('occupancy')}>
                  <i className="material-icons mr-1" style={{ fontSize: 16 }}>add</i>
                  Daireye Bağla
                </button>
              )}
              {Boolean(endOccupancy.error) && <ErrorBox error={endOccupancy.error} />}
            </div>
          )}
          {tab === 'daireler' && (
            <Table
              head={
                <tr>
                  <th>Daire</th>
                  <th>Blok</th>
                  <th>Kat</th>
                  <th>Sıfat</th>
                  <th>Giriş</th>
                  <th>Çıkış</th>
                  <th>Banka Ödeme Kodu</th>
                  <th />
                </tr>
              }
            >
              {data.occupancies.map((occupancy) => (
                <tr key={occupancy.id}>
                  <td className="font-weight-bold">{occupancy.unit.doorNumber}</td>
                  <td>{occupancy.unit.block?.name ?? '—'}</td>
                  <td>{occupancy.unit.floor ?? '—'}</td>
                  <td>
                    <span
                      className={`badge ${
                        occupancy.role === 'OWNER' ? 'badge-primary' : 'badge-purple'
                      }`}
                    >
                      {occupancy.role === 'OWNER' ? 'Kat Maliki' : 'Kiracı'}
                    </span>
                  </td>
                  <td>{date(occupancy.startDate)}</td>
                  <td>{occupancy.endDate ? date(occupancy.endDate) : '—'}</td>
                  <td>
                    <code>{occupancy.bankPaymentCode ?? '—'}</code>
                  </td>
                  <td className="text-right">
                    {canEdit && !occupancy.endDate && ending?.id !== occupancy.id && (
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() => setEnding({ id: occupancy.id, endDate: todayInput() })}
                      >
                        Çıkış Ver
                      </button>
                    )}
                    {ending?.id === occupancy.id && (
                      <div className="d-inline-flex align-items-center" style={{ gap: '.25rem' }}>
                        <input
                          type="date"
                          className="form-control form-control-sm"
                          style={{ width: 150 }}
                          value={ending.endDate}
                          min={occupancy.startDate.slice(0, 10)}
                          onChange={(e) => setEnding({ id: occupancy.id, endDate: e.target.value })}
                          aria-label="Çıkış tarihi"
                        />
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={endOccupancy.isPending || !ending.endDate}
                          onClick={() => endOccupancy.mutate(ending)}
                        >
                          Kaydet
                        </button>
                        <button type="button" className="btn btn-light btn-sm" onClick={() => setEnding(null)}>
                          Vazgeç
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {data.occupancies.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-muted py-4">
                    Daire ilişkisi yok.
                  </td>
                </tr>
              )}
            </Table>
          )}

          {tab === 'araclar' && canVehicles && (
            <div className="card-body border-bottom">
              {adding === 'vehicle' ? (
                <VehicleForm
                  pending={addVehicle.isPending}
                  error={addVehicle.error}
                  onSubmit={(payload) => addVehicle.mutate(payload)}
                  onCancel={() => setAdding(null)}
                />
              ) : (
                <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => setAdding('vehicle')}>
                  <i className="material-icons mr-1" style={{ fontSize: 16 }}>add</i>
                  Araç Ekle
                </button>
              )}
              {Boolean(removeVehicle.error) && <ErrorBox error={removeVehicle.error} />}
            </div>
          )}
          {tab === 'araclar' &&
            (data.vehicles.length === 0 ? (
              <EmptyState message="Kayıtlı araç yok." icon="directions_car" />
            ) : (
              <Table
                head={
                  <tr>
                    <th>Plaka</th>
                    <th>Marka</th>
                    <th>Model</th>
                    <th>Renk</th>
                    <th>HGS No</th>
                    <th>Durum</th>
                    <th />
                  </tr>
                }
              >
                {data.vehicles.map((vehicle) => (
                  <tr key={vehicle.id}>
                    <td>
                      <span className="sy-plate">{vehicle.plate}</span>
                    </td>
                    <td>{vehicle.brand ?? '—'}</td>
                    <td>{vehicle.model ?? '—'}</td>
                    <td>{vehicle.color ?? '—'}</td>
                    <td>{vehicle.hgsNumber ?? '—'}</td>
                    <td>
                      {vehicle.status ? (
                        <span className={`badge ${/yasak/i.test(vehicle.status) ? 'badge-danger' : 'badge-light'}`}>
                          {vehicle.status}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="text-right">
                      {canVehicles && (
                        <button
                          type="button"
                          className="btn btn-link btn-sm text-danger"
                          disabled={removeVehicle.isPending}
                          onClick={() => {
                            if (window.confirm(`${vehicle.plate} silinsin mi?`)) removeVehicle.mutate(vehicle.id);
                          }}
                        >
                          Sil
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            ))}

          {tab === 'hesap' &&
            (data.account ? (
              <AccountTab accountId={data.account.id} />
            ) : (
              <EmptyState message="Bu kişinin cari hesabı yok." />
            ))}

          {tab === 'talepler' &&
            (data.tickets.length === 0 ? (
              <EmptyState message="Talep kaydı yok." icon="build" />
            ) : (
              <div className="list-group list-group-flush">
                {data.tickets.map((ticket) => (
                  <Link
                    key={ticket.id}
                    href={`/teknik/${ticket.id}`}
                    className="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                  >
                    <span>
                      <span className="text-muted mr-2">#{ticket.number}</span>
                      {ticket.subject}
                    </span>
                    <span className="text-muted small">
                      {TICKET_STATUS_LABELS[ticket.status as keyof typeof TICKET_STATUS_LABELS]} ·{' '}
                      {date(ticket.date)}
                    </span>
                  </Link>
                ))}
              </div>
            ))}

          {tab === 'iletisim' &&
            (data.messages.length === 0 ? (
              <EmptyState message="Gönderilmiş bildirim yok." icon="mail_outline" />
            ) : (
              <div className="list-group list-group-flush">
                {data.messages.map((message) => (
                  <div
                    key={message.id}
                    className="list-group-item d-flex justify-content-between align-items-center"
                  >
                    <span className="text-truncate mr-3">
                      <span className="badge badge-secondary mr-2">
                        {CHANNEL_LABELS[message.channel as keyof typeof CHANNEL_LABELS] ?? message.channel}
                      </span>
                      {message.subject ?? message.body.slice(0, 90)}
                      <span className="text-muted small ml-2">{message.recipient}</span>
                    </span>
                    <span className="text-muted small text-nowrap">
                      <span className={`badge mr-2 ${message.status === 'FAILED' ? 'badge-danger' : message.status === 'SENT' ? 'badge-success' : 'badge-light'}`}>
                        {MESSAGE_STATUS_LABELS[message.status]}
                      </span>
                      {dateTime(message.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
        </div>
      </div>
    </>
  );
}

function AccountTab({ accountId }: { accountId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['open-items', accountId],
    queryFn: () =>
      api.get<{
        items: {
          documentId: string;
          number: string;
          dueDate: string | null;
          period: string | null;
          remainingMinor: number;
        }[];
        totalMinor: number;
        advanceMinor: number;
      }>(`/finance/accounts/${accountId}/open-items`),
  });

  if (isLoading) return <div className="card-body"><Loading /></div>;
  if (!data) return null;

  return (
    <>
      <div className="card-body d-flex flex-wrap align-items-center" style={{ gap: '1.5rem' }}>
        <div>
          <div className="text-muted small">Açık borç</div>
          <strong className="text-danger sy-num">{money(data.totalMinor)}</strong>
        </div>
        <div>
          <div className="text-muted small">Avans</div>
          <strong className="text-success sy-num">{money(data.advanceMinor)}</strong>
        </div>
        <Link href={`/finans/cari/${accountId}`} className="btn btn-outline-primary btn-sm ml-auto">
          Ekstreyi aç
        </Link>
      </div>

      {data.items.length === 0 ? (
        <EmptyState message="Kapanmamış borç yok." icon="done_all" />
      ) : (
        <Table
          head={
            <tr>
              <th>Evrak No</th>
              <th>Dönem</th>
              <th>Son Ödeme</th>
              <th className="text-right">Kalan</th>
            </tr>
          }
        >
          {data.items.map((item) => (
            <tr key={item.documentId}>
              <td>
                <code>{item.number}</code>
              </td>
              <td>{item.period ?? '—'}</td>
              <td>{date(item.dueDate)}</td>
              <td className="text-right sy-num text-danger font-weight-bold">
                {money(item.remainingMinor)}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="d-flex justify-content-between border-bottom py-2">
      <span className="text-muted">{label}</span>
      <strong>{value || '—'}</strong>
    </div>
  );
}
