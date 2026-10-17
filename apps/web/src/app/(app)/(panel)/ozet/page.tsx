'use client';

import { useEffect, useState } from 'react';
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
import {
  CHART_COLORS,
  CHART_DANGER,
  CHART_SUCCESS,
  chartTextColor,
  date,
  money,
  moneyShort,
} from '@/lib/format';
import {
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  PageHeader,
  QuickLink,
  StatCard,
  Table,
} from '@/components/ui';

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
  cash: {
    items: { id: string; name: string; type: string; balanceMinor: number }[];
    totalMinor: number;
  };
  counters: { pendingBankTransactions: number; openTickets: number; overdueDocuments: number };
}

export default function DashboardPage() {
  const [tick, setTick] = useState(0);

  // Koyu moda geçilince grafik eksen renkleri yeniden hesaplansın
  useEffect(() => {
    const handler = () => setTick((value) => value + 1);
    window.addEventListener('sy:theme', handler);
    return () => window.removeEventListener('sy:theme', handler);
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/finance/dashboard'),
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const axisColor = chartTextColor();
  const totalOutstanding = data.collection.reduce((a, c) => a + c.outstandingMinor, 0);

  return (
    <>
      <PageHeader
        title="Özet"
        subtitle="Sitenin güncel finansal durumu"
        actions={
          <a href="/finans/aidat" className="btn btn-outline-secondary btn-sm">
            <i className="material-icons mr-1" style={{ fontSize: 15 }}>
              settings
            </i>
            Aidat Tahakkuku
          </a>
        }
      />

      {/* ------------------------------------------------------ hızlı erişim */}
      <div className="row mb-4">
        {[
          { href: '/finans/tahsilat', icon: 'credit_card', label: 'Tahsilat Gir', color: '#4B98CF' },
          { href: '/finans/gider', icon: 'receipt', label: 'Gider Faturası', color: '#4EB4A5' },
          { href: '/finans/banka', icon: 'compare_arrows', label: 'Banka Hareketleri', color: '#E3AA75' },
          { href: '/site', icon: 'people', label: 'Kişiler', color: '#5163C5' },
        ].map((item) => (
          <div className="col-sm-6 col-xl-3 mb-3 mb-xl-0" key={item.href}>
            <QuickLink {...item} />
          </div>
        ))}
      </div>

      <div className="row mb-4">
        <div className="col-sm-6 col-xl-3 mb-3 mb-xl-0">
          <StatCard
            label="Kasa + Banka"
            value={money(data.cash.totalMinor)}
            icon="account_balance"
            tone="success"
          />
        </div>
        <div className="col-sm-6 col-xl-3 mb-3 mb-xl-0">
          <StatCard
            label="Toplam Alacak"
            value={money(totalOutstanding)}
            hint="Tahsil edilmemiş aidat"
            icon="trending_up"
            tone={totalOutstanding > 0 ? 'danger' : 'default'}
          />
        </div>
        <div className="col-sm-6 col-xl-3 mb-3 mb-xl-0">
          <StatCard
            label="Ödenecek Fatura"
            value={money(data.payables.totalMinor)}
            icon="receipt"
            tone={data.payables.totalMinor > 0 ? 'warning' : 'default'}
          />
        </div>
        <div className="col-sm-6 col-xl-3">
          <StatCard
            label="Bekleyen Banka Hareketi"
            value={data.counters.pendingBankTransactions}
            hint={
              data.counters.pendingBankTransactions > 0 ? 'Eşleştirme bekliyor' : 'Tümü eşleşti'
            }
            icon="compare_arrows"
            tone={data.counters.pendingBankTransactions > 0 ? 'warning' : 'default'}
          />
        </div>
      </div>

      {/* --------------------------------------------- aidat tahsilat durumu */}
      <Card title="Aidat Tahsilat Durumu" className="mb-4">
        <div className="card-body" style={{ height: 300 }} key={tick}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.collection} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--sy-border)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: axisColor }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={(value) => moneyShort(Number(value))}
                tick={{ fontSize: 11, fill: axisColor }}
                tickLine={false}
                axisLine={false}
                width={56}
              />
              <Tooltip
                formatter={(value: number, name) => [money(value), name]}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 5,
                  background: 'var(--sy-surface)',
                  border: '1px solid var(--sy-border)',
                  color: 'var(--sy-text)',
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: axisColor }} />
              <Bar dataKey="collectedMinor" name="Tahsil edilen" stackId="a" fill={CHART_SUCCESS} />
              <Bar
                dataKey="outstandingMinor"
                name="Tahsil edilemeyen"
                stackId="a"
                fill={CHART_DANGER}
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* --------------------------------------------------- gelir / gider */}
      <div className="row mb-4">
        <div className="col-lg-6 mb-4 mb-lg-0">
          <DistributionCard
            title="Gider Dağılımı"
            data={data.distribution.expense}
            total={data.distribution.expenseTotalMinor}
            tick={tick}
          />
        </div>
        <div className="col-lg-6">
          <DistributionCard
            title="Gelir Dağılımı"
            data={data.distribution.income}
            total={data.distribution.incomeTotalMinor}
            tick={tick}
          />
        </div>
      </div>

      {/* ------------------------------------------------- ödenecek faturalar */}
      <Card
        title="Ödenecek Faturalar"
        className="mb-4"
        actions={<span className="text-muted small">Toplam {money(data.payables.totalMinor)}</span>}
      >
        {data.payables.items.length === 0 ? (
          <EmptyState message="Ödenecek fatura yok." icon="done_all" />
        ) : (
          <Table
            head={
              <tr>
                <th>Ödeme Tarihi</th>
                <th>Evrak No</th>
                <th>Cari</th>
                <th>Açıklama</th>
                <th className="text-right">Kalan</th>
              </tr>
            }
          >
            {data.payables.items.map((item) => (
              <tr key={item.documentId}>
                <td className={item.overdue ? 'text-danger font-weight-bold' : ''}>
                  {item.overdue && (
                    <i className="material-icons mr-1" style={{ fontSize: 14 }}>
                      error_outline
                    </i>
                  )}
                  {date(item.dueDate)}
                </td>
                <td className="text-muted">{item.number}</td>
                <td className="font-weight-bold">{item.supplier}</td>
                <td className="text-muted">{item.description ?? '—'}</td>
                <td className="text-right sy-num font-weight-bold">{money(item.remainingMinor)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* ------------------------------------------------------ kasa / banka */}
      <div className="row">
        <div className="col-lg-6 mb-4 mb-lg-0">
          <Card title="Kasa ve Banka">
            <Table
              head={
                <tr>
                  <th>Hesap</th>
                  <th className="text-right">Bakiye</th>
                </tr>
              }
            >
              {data.cash.items.map((account) => (
                <tr key={account.id}>
                  <td>
                    {account.name}
                    <span className="badge badge-secondary ml-2">
                      {account.type === 'CASH' ? 'Kasa' : 'Banka'}
                    </span>
                  </td>
                  <td className="text-right sy-num font-weight-bold">
                    {money(account.balanceMinor)}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <div className="col-lg-6">
          <Card title="Dikkat Gerektirenler">
            <div className="list-group list-group-flush">
              <AlertRow
                icon="compare_arrows"
                label="Eşleşmeyi bekleyen banka hareketi"
                count={data.counters.pendingBankTransactions}
                href="/finans/banka"
              />
              <AlertRow
                icon="event_busy"
                label="Vadesi geçmiş borç evrakı"
                count={data.counters.overdueDocuments}
                href="/finans"
              />
              <AlertRow icon="build" label="Açık iş takibi" count={data.counters.openTickets} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function DistributionCard({
  title,
  data,
  total,
  tick,
}: {
  title: string;
  data: { name: string; amountMinor: number }[];
  total: number;
  tick: number;
}) {
  return (
    <Card title={title}>
      {data.length === 0 ? (
        <EmptyState message="Bu dönemde kayıt yok." icon="pie_chart" />
      ) : (
        <div className="card-body position-relative" style={{ height: 280 }} key={tick}>
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
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 5,
                  background: 'var(--sy-surface)',
                  border: '1px solid var(--sy-border)',
                  color: 'var(--sy-text)',
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
          <div
            className="position-absolute text-center"
            style={{ top: '45%', left: 0, right: 0, pointerEvents: 'none' }}
          >
            <div className="text-muted" style={{ fontSize: 11 }}>
              Toplam
            </div>
            <strong className="sy-num">{money(total)}</strong>
          </div>
        </div>
      )}
    </Card>
  );
}

function AlertRow({
  icon,
  label,
  count,
  href,
}: {
  icon: string;
  label: string;
  count: number;
  href?: string;
}) {
  const body = (
    <>
      <span className="d-flex align-items-center">
        <i className="material-icons mr-2 text-muted" style={{ fontSize: 18 }}>
          {icon}
        </i>
        {label}
      </span>
      <span className={count > 0 ? 'badge badge-warning' : 'text-muted small'}>{count}</span>
    </>
  );

  const className = 'list-group-item d-flex align-items-center justify-content-between';

  return href && count > 0 ? (
    <Link href={href} className={`${className} list-group-item-action`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
