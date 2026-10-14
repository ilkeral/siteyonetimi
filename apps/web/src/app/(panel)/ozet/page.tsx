'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface CurrentSiteResponse {
  site: {
    id: string;
    name: string;
    city: string | null;
    district: string | null;
    type: string;
    settings: {
      duesDistributionMethod: string;
      dueDayOfMonth: number;
      lateFeeRate: string;
      lateFeeMethod: string;
      communicationLanguages: string[];
      autoMatchBankTransactions: boolean;
    } | null;
  } | null;
  role: string | null;
  stats: { blockCount: number; unitCount: number; personCount: number };
}

const DUES_METHOD_LABELS: Record<string, string> = {
  EQUAL: 'Eşit',
  BY_AREA: 'm² Oranında',
  BY_LAND_SHARE: 'Arsa Payına Göre',
  BY_SHARE_RATIO: 'Hisse Oranına Göre',
};

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['site', 'current'],
    queryFn: () => api.get<CurrentSiteResponse>('/sites/current'),
  });

  if (isLoading) {
    return <p className="text-sm text-slate-500">Yükleniyor...</p>;
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error instanceof Error ? error.message : 'Veri alınamadı'}
      </div>
    );
  }

  const settings = data?.site?.settings;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-800">Özet</h1>
        <p className="text-sm text-slate-500">{data?.site?.name}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Blok" value={data?.stats.blockCount ?? 0} />
        <StatCard label="Daire" value={data?.stats.unitCount ?? 0} />
        <StatCard label="Kayıtlı Kişi" value={data?.stats.personCount ?? 0} />
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Site Parametreleri</h2>
          <span className="text-xs text-slate-400">Rolünüz: {data?.role}</span>
        </div>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 px-5 py-4 text-sm sm:grid-cols-2">
          <Row
            label="Aidat dağıtım şekli"
            value={DUES_METHOD_LABELS[settings?.duesDistributionMethod ?? ''] ?? '—'}
          />
          <Row label="Son ödeme kaidesi" value={`Her ayın ${settings?.dueDayOfMonth ?? '—'}'i`} />
          <Row label="Gecikme tazminatı" value={`Aylık %${Number(settings?.lateFeeRate ?? 0)}`} />
          <Row
            label="Banka otomatik eşleştirme"
            value={settings?.autoMatchBankTransactions ? 'Açık' : 'Kapalı'}
          />
          <Row
            label="İletişim dilleri"
            value={(settings?.communicationLanguages ?? []).join(', ') || '—'}
          />
          <Row label="Site tipi" value={data?.site?.type ?? '—'} />
        </dl>
      </div>

      <div className="card px-5 py-8 text-center">
        <p className="text-sm text-slate-500">
          Aidat tahsilat grafiği, gelir/gider dağılımı ve ödenecek faturalar{' '}
          <strong className="font-medium text-slate-700">Faz 1</strong> ile bu sayfaya eklenecek.
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card px-5 py-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-800">{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-50 pb-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}
