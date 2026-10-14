'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { balanceClass, date, dateTime, money } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Table } from '@/components/ui';

interface PersonDetail {
  id: string;
  firstName: string;
  lastName: string;
  nationalId: string | null;
  email: string | null;
  phone: string | null;
  phone2: string | null;
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
  }[];
  occupancies: {
    id: string;
    role: 'OWNER' | 'TENANT';
    startDate: string;
    endDate: string | null;
    bankPaymentCode: string | null;
    unit: { doorNumber: string; floor: number | null; block: { name: string } | null };
  }[];
  tickets: { id: string; number: number; subject: string; status: string; date: string }[];
  messages: {
    id: string;
    channel: string;
    subject: string | null;
    status: string;
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
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('genel');

  const { data, isLoading, error } = useQuery({
    queryKey: ['person', params.id],
    queryFn: () => api.get<PersonDetail>(`/people/${params.id}`),
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  return (
    <>
      <PageHeader
        title={`${data.firstName} ${data.lastName}`}
        subtitle={data.inLegalAction ? 'İcra takibinde' : 'Kişi kartı'}
        actions={
          <>
            <span className={`h5 m-0 sy-num ${balanceClass(data.balanceMinor)}`}>
              {money(data.balanceMinor)}
            </span>
            <Link href="/site" className="btn btn-outline-secondary btn-sm">
              Listeye dön
            </Link>
          </>
        }
      />

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
          {tab === 'genel' && (
            <div className="row">
              <div className="col-md-6">
                <Row label="TC Kimlik No" value={data.nationalId} />
                <Row label="Cep telefonu" value={data.phone} />
                <Row label="E-posta" value={data.email} />
              </div>
              <div className="col-md-6">
                <Row label="İletişim dili" value={data.language} />
                <Row label="2. telefon" value={data.phone2} />
                <Row label="Cari hesap" value={data.account?.name} />
              </div>
              <div className="col-12 mt-3">
                <div className="text-muted small mb-1">Not</div>
                <div>{data.note || '—'}</div>
              </div>
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
                </tr>
              ))}
              {data.occupancies.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-muted py-4">
                    Daire ilişkisi yok.
                  </td>
                </tr>
              )}
            </Table>
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
                  </tr>
                }
              >
                {data.vehicles.map((vehicle) => (
                  <tr key={vehicle.id}>
                    <td className="font-weight-bold">{vehicle.plate}</td>
                    <td>{vehicle.brand ?? '—'}</td>
                    <td>{vehicle.model ?? '—'}</td>
                    <td>{vehicle.color ?? '—'}</td>
                    <td>{vehicle.hgsNumber ?? '—'}</td>
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
                  <div
                    key={ticket.id}
                    className="list-group-item d-flex justify-content-between align-items-center"
                  >
                    <span>
                      <span className="text-muted mr-2">#{ticket.number}</span>
                      {ticket.subject}
                    </span>
                    <span className="text-muted small">{date(ticket.date)}</span>
                  </div>
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
                    <span>
                      <span className="badge badge-secondary mr-2">{message.channel}</span>
                      {message.subject ?? '—'}
                    </span>
                    <span className="text-muted small">{dateTime(message.createdAt)}</span>
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
