'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { balanceClass, date, dateTime, money } from '@/lib/format';
import { Badge, Card, EmptyState, ErrorBox, Loading, PageHeader, Table } from '@/components/ui';

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
  { key: 'genel', label: 'Genel Bilgiler' },
  { key: 'daireler', label: 'Daireler' },
  { key: 'araclar', label: 'Araçlar' },
  { key: 'hesap', label: 'Cari Hesap' },
  { key: 'talepler', label: 'Talepler' },
  { key: 'iletisim', label: 'İletişim Geçmişi' },
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
    <div>
      <PageHeader
        title={`${data.firstName} ${data.lastName}`}
        subtitle={data.inLegalAction ? 'İcra takibinde' : 'Kişi kartı'}
        actions={
          <>
            <span className={`text-sm font-semibold ${balanceClass(data.balanceMinor)}`}>
              Bakiye: {money(data.balanceMinor)}
            </span>
            <Link href="/site" className="btn-ghost text-xs">
              Listeye dön
            </Link>
          </>
        }
      />

      <div className="card">
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 pt-2">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={
                tab === item.key
                  ? 'border-b-2 border-brand-600 px-3 py-2 text-sm font-medium text-brand-700'
                  : 'border-b-2 border-transparent px-3 py-2 text-sm text-slate-500 hover:text-slate-700'
              }
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-5">
          {tab === 'genel' && (
            <dl className="grid grid-cols-1 gap-x-10 gap-y-3 text-sm sm:grid-cols-2">
              <Row label="TC Kimlik No" value={data.nationalId} />
              <Row label="İletişim dili" value={data.language} />
              <Row label="Cep telefonu" value={data.phone} />
              <Row label="2. telefon" value={data.phone2} />
              <Row label="E-posta" value={data.email} />
              <Row label="Cari hesap" value={data.account?.name} />
              <div className="sm:col-span-2">
                <dt className="mb-1 text-slate-500">Not</dt>
                <dd className="text-slate-700">{data.note || '—'}</dd>
              </div>
            </dl>
          )}

          {tab === 'daireler' && (
            <Table
              head={
                <tr>
                  <th className="py-2 pr-4">Daire</th>
                  <th className="px-4 py-2">Blok</th>
                  <th className="px-4 py-2">Kat</th>
                  <th className="px-4 py-2">Sıfat</th>
                  <th className="px-4 py-2">Giriş</th>
                  <th className="px-4 py-2">Çıkış</th>
                  <th className="px-4 py-2">Banka Ödeme Kodu</th>
                </tr>
              }
            >
              {data.occupancies.map((occupancy) => (
                <tr key={occupancy.id}>
                  <td className="py-2.5 pr-4 font-medium">{occupancy.unit.doorNumber}</td>
                  <td className="px-4 py-2.5">{occupancy.unit.block?.name ?? '—'}</td>
                  <td className="px-4 py-2.5">{occupancy.unit.floor ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={occupancy.role === 'OWNER' ? 'blue' : 'purple'}>
                      {occupancy.role === 'OWNER' ? 'Kat Maliki' : 'Kiracı'}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">{date(occupancy.startDate)}</td>
                  <td className="px-4 py-2.5">
                    {occupancy.endDate ? date(occupancy.endDate) : '—'}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {occupancy.bankPaymentCode ?? '—'}
                  </td>
                </tr>
              ))}
              {data.occupancies.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    Daire ilişkisi yok.
                  </td>
                </tr>
              )}
            </Table>
          )}

          {tab === 'araclar' &&
            (data.vehicles.length === 0 ? (
              <EmptyState message="Kayıtlı araç yok." />
            ) : (
              <Table
                head={
                  <tr>
                    <th className="py-2 pr-4">Plaka</th>
                    <th className="px-4 py-2">Marka</th>
                    <th className="px-4 py-2">Model</th>
                    <th className="px-4 py-2">Renk</th>
                    <th className="px-4 py-2">HGS No</th>
                  </tr>
                }
              >
                {data.vehicles.map((vehicle) => (
                  <tr key={vehicle.id}>
                    <td className="py-2.5 pr-4 font-medium">{vehicle.plate}</td>
                    <td className="px-4 py-2.5">{vehicle.brand ?? '—'}</td>
                    <td className="px-4 py-2.5">{vehicle.model ?? '—'}</td>
                    <td className="px-4 py-2.5">{vehicle.color ?? '—'}</td>
                    <td className="px-4 py-2.5">{vehicle.hgsNumber ?? '—'}</td>
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
              <EmptyState message="Talep kaydı yok." />
            ) : (
              <ul className="divide-y divide-slate-50 text-sm">
                {data.tickets.map((ticket) => (
                  <li key={ticket.id} className="flex justify-between py-2.5">
                    <span>
                      <span className="text-slate-400">#{ticket.number}</span> {ticket.subject}
                    </span>
                    <span className="text-slate-500">{date(ticket.date)}</span>
                  </li>
                ))}
              </ul>
            ))}

          {tab === 'iletisim' &&
            (data.messages.length === 0 ? (
              <EmptyState message="Gönderilmiş bildirim yok." />
            ) : (
              <ul className="divide-y divide-slate-50 text-sm">
                {data.messages.map((message) => (
                  <li key={message.id} className="flex justify-between py-2.5">
                    <span>
                      <Badge>{message.channel}</Badge>{' '}
                      <span className="ml-1">{message.subject ?? '—'}</span>
                    </span>
                    <span className="text-slate-500">{dateTime(message.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      </div>
    </div>
  );
}

function AccountTab({ accountId }: { accountId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['open-items', accountId],
    queryFn: () =>
      api.get<{
        items: { documentId: string; number: string; dueDate: string | null; period: string | null; remainingMinor: number }[];
        totalMinor: number;
        advanceMinor: number;
      }>(`/finance/accounts/${accountId}/open-items`),
  });

  if (isLoading) return <Loading />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex gap-6 text-sm">
        <div>
          <span className="text-slate-500">Açık borç: </span>
          <strong className="text-red-600">{money(data.totalMinor)}</strong>
        </div>
        <div>
          <span className="text-slate-500">Avans: </span>
          <strong className="text-emerald-600">{money(data.advanceMinor)}</strong>
        </div>
        <Link href={`/finans/cari/${accountId}`} className="text-brand-700 hover:underline">
          Ekstreyi aç →
        </Link>
      </div>

      {data.items.length === 0 ? (
        <EmptyState message="Kapanmamış borç yok." />
      ) : (
        <Table
          head={
            <tr>
              <th className="py-2 pr-4">Evrak No</th>
              <th className="px-4 py-2">Dönem</th>
              <th className="px-4 py-2">Son Ödeme</th>
              <th className="px-4 py-2 text-right">Kalan</th>
            </tr>
          }
        >
          {data.items.map((item) => (
            <tr key={item.documentId}>
              <td className="py-2.5 pr-4 font-mono text-xs">{item.number}</td>
              <td className="px-4 py-2.5">{item.period ?? '—'}</td>
              <td className="px-4 py-2.5">{date(item.dueDate)}</td>
              <td className="px-4 py-2.5 text-right font-medium text-red-600">
                {money(item.remainingMinor)}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-50 pb-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{value || '—'}</dd>
    </div>
  );
}
