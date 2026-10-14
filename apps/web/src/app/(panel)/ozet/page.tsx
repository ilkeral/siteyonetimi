'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { CHART_COLORS, date, money, moneyShort } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, StatCard, Table } from '@/components/ui';

interface DashboardData {
  collection: {
    period: string;
    label: string;
    accruedMinor: number;
    collectedMinor: number;
    outstandingMinor: number;
    collectionRate: number;
  }[];
  distribution: {
    income: { name: string; amountMinor: number }[];
    expense: { name: string; amountMinor: number }[];
    incomeTotalMinor: number;
    expenseTotalMinor: number;
  };
  payables: {
    items: {
      documentId: string;
      number: string;
      dueDate: string | null;
      supplier: string;
      description: string | null;
      remainingMinor: number;
      overdue: boolean;
    }[];
    totalMinor: number;
  };
  cash: { items: { id: string; name: string; type: string; balanceMinor: number }[]; totalMinor: number };
  counters: { pendingBankTransactions: number; openTickets: number; overdueDocuments: number };
}

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/finance/dashboard'),
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const totalOutstanding = data.collection.reduce((a, c) => a + c.outstandingMinor, 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Özet" subtitle="Sitenin güncel finansal durumu" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Kasa + Banka" value={money(data.cash.totalMinor)} tone="success" />
        <StatCard
          label="Toplam Alacak"
          value={money(totalOutstanding)}
          tone={totalOutstanding > 0 ? 'danger' : 'default'}
          hint="Tahsil edilmemiş aidat"
        />
        <StatCard
          label="Ödenecek Fatura"
          value={money(data.payables.totalMinor)}
          tone={data.payables.totalMinor > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Bekleyen Banka Hareketi"
          value={data.counters.pendingBankTransactions}
          tone={data.counters.pendingBankTransactions > 0 ? 'warning' : 'default'}
          hint={data.counters.pendingBankTransactions > 0 ? 'Eşleştirme bekliyor' : 'Tümü eşleşti'}
        />
      </div>

      {/* --------------------------------------------- aidat tahsilat durumu */}
      <Card title="Aidat Tahsilat Durumu">
        <div className="h-72 px-3 py-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.collection} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis
                tickFormatter={(v) => moneyShort(Number(v))}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              <Tooltip
                formatter={(value: number, name) => [money(value), name]}
                labelStyle={{ fontSize: 12 }}
                contentStyle={{ fontSize: 12, borderRadius: 6 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar
                dataKey="collectedMinor"
                name="Tahsil edilen"
                stackId="a"
                fill="#16a34a"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="outstandingMinor"
                name="Tahsil edilemeyen"
                stackId="a"
                fill="#dc2626"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* --------------------------------------------------- gelir / gider */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DistributionCard
          title="Gider Dağılımı"
          data={data.distribution.expense}
          total={data.distribution.expenseTotalMinor}
        />
        <DistributionCard
          title="Gelir Dağılımı"
          data={data.distribution.income}
          total={data.distribution.incomeTotalMinor}
        />
      </div>

      {/* ------------------------------------------------- ödenecek faturalar */}
      <Card
        title="Ödenecek Faturalar"
        actions={
          <span className="text-xs font-medium text-slate-600">
            Toplam {money(data.payables.totalMinor)}
          </span>
        }
      >
        {data.payables.items.length === 0 ? (
          <EmptyState message="Ödenecek fatura yok." />
        ) : (
          <Table
            head={
              <tr>
                <th className="px-5 py-2">Ödeme Tarihi</th>
                <th className="px-3 py-2">Evrak No</th>
                <th className="px-3 py-2">Cari</th>
                <th className="px-3 py-2">Açıklama</th>
                <th className="px-5 py-2 text-right">Kalan</th>
              </tr>
            }
          >
            {data.payables.items.map((item) => (
              <tr key={item.documentId} className="hover:bg-slate-50/60">
                <td className="whitespace-nowrap px-5 py-2.5">
                  <span className={item.overdue ? 'font-medium text-red-600' : ''}>
                    {date(item.dueDate)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-slate-500">{item.number}</td>
                <td className="px-3 py-2.5 font-medium text-slate-700">{item.supplier}</td>
                <td className="px-3 py-2.5 text-slate-500">{item.description ?? '—'}</td>
                <td className="px-5 py-2.5 text-right font-medium">{money(item.remainingMinor)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* ------------------------------------------------------ kasa / banka */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Kasa ve Banka">
          <Table
            head={
              <tr>
                <th className="px-5 py-2">Hesap</th>
                <th className="px-5 py-2 text-right">Bakiye</th>
              </tr>
            }
          >
            {data.cash.items.map((account) => (
              <tr key={account.id}>
                <td className="px-5 py-2.5">
                  {account.name}
                  <span className="ml-2 text-xs text-slate-400">
                    {account.type === 'CASH' ? 'Kasa' : 'Banka'}
                  </span>
                </td>
                <td className="px-5 py-2.5 text-right font-medium">{money(account.balanceMinor)}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Dikkat Gerektirenler">
          <ul className="divide-y divide-slate-50 text-sm">
            <AlertRow
              label="Eşleşmeyi bekleyen banka hareketi"
              count={data.counters.pendingBankTransactions}
              href="/finans/banka"
            />
            <AlertRow
              label="Vadesi geçmiş borç evrakı"
              count={data.counters.overdueDocuments}
              href="/finans"
            />
            <AlertRow label="Açık iş takibi" count={data.counters.openTickets} />
          </ul>
        </Card>
      </div>
    </div>
  );
}

function DistributionCard({
  title,
  data,
  total,
}: {
  title: string;
  data: { name: string; amountMinor: number }[];
  total: number;
}) {
  return (
    <Card title={title}>
      {data.length === 0 ? (
        <EmptyState message="Bu dönemde kayıt yok." />
      ) : (
        <div className="h-64 px-3 py-3">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="amountMinor"
                nameKey="name"
                innerRadius="55%"
                outerRadius="80%"
                paddingAngle={1}
              >
                {data.map((_, index) => (
                  <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, name) => [money(value), name]}
                contentStyle={{ fontSize: 12, borderRadius: 6 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
          <p className="-mt-6 text-center text-sm font-semibold text-slate-700">{money(total)}</p>
        </div>
      )}
    </Card>
  );
}

function AlertRow({ label, count, href }: { label: string; count: number; href?: string }) {
  const content = (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="text-slate-600">{label}</span>
      <span
        className={
          count > 0
            ? 'rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700'
            : 'text-xs text-slate-400'
        }
      >
        {count}
      </span>
    </div>
  );

  return (
    <li>
      {href && count > 0 ? (
        <Link href={href} className="block transition hover:bg-slate-50">
          {content}
        </Link>
      ) : (
        content
      )}
    </li>
  );
}
