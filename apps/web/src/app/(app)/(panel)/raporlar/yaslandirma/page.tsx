'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { date, money, todayInput } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Table } from '@/components/ui';
import { MaskToggle, ReportActions } from '@/components/reports';

type Bucket = 'notDue' | 'd0_30' | 'd31_60' | 'd61_90' | 'd90';

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: 'notDue', label: 'Vadesi gelmemiş' },
  { key: 'd0_30', label: '0–30 gün' },
  { key: 'd31_60', label: '31–60 gün' },
  { key: 'd61_90', label: '61–90 gün' },
  { key: 'd90', label: '90+ gün' },
];

interface Report {
  asOf: string;
  masked: boolean;
  rows: { accountId: string; name: string; phone: string | null; units: string[]; buckets: Record<Bucket, number>; totalMinor: number }[];
  totals: Record<Bucket, number> & { totalMinor: number };
}

export default function AgingReportPage() {
  const [asOf, setAsOf] = useState(todayInput());
  const [blockId, setBlockId] = useState('');
  const [mask, setMask] = useState(true);
  const [shown, setShown] = useState<string | null>(null);

  const { data: blocks } = useQuery({
    queryKey: ['blocks'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/blocks'),
  });

  const query = useMemo(() => {
    const params = new URLSearchParams({ asOf, mask: String(mask) });
    if (blockId) params.set('blockId', blockId);
    return params.toString();
  }, [asOf, mask, blockId]);

  const { data, isFetching, error } = useQuery({
    queryKey: ['report', 'aging', shown],
    queryFn: () => api.get<Report>(`/reports/aging?${shown}`),
    enabled: !!shown,
  });

  return (
    <>
      <div className="no-print">
        <PageHeader title="Borç Yaşlandırma" breadcrumb={['Raporlar', 'Borç Yaşlandırma']} />
      </div>

      <Card className="mb-4 no-print">
        <div className="card-body">
          <div className="row align-items-end">
            <div className="col-6 col-md-3 form-group">
              <label className="form-label">Rapor Tarihi</label>
              <input type="date" className="form-control" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </div>
            <div className="col-6 col-md-3 form-group">
              <label className="form-label">Blok</label>
              <select className="custom-select" value={blockId} onChange={(e) => setBlockId(e.target.value)}>
                <option value="">Tümü</option>
                {blocks?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-6 form-group">
              <MaskToggle value={mask} onChange={setMask} />
            </div>
          </div>
          <ReportActions onShow={() => setShown(query)} pdfPath={`/reports/aging/pdf?${query}`} xlsxPath={`/reports/aging/xlsx?${query}`} canPrint={!!data} />
        </div>
      </Card>

      {error && <ErrorBox error={error} />}
      {isFetching && <Loading label="Rapor hazırlanıyor..." />}
      {data && !isFetching && (
        <div className="sy-report">
          <div className="sy-report__head">
            <h1 className="h4 mb-0">Borç Yaşlandırma</h1>
            <span className="text-muted">
              {date(data.asOf)} itibarıyla · {data.rows.length} borçlu{data.masked && ' · KVKK maskeli'}
            </span>
          </div>

          <div className="row mb-3">
            {BUCKETS.map((bucket) => (
              <div className="col-6 col-md mb-2" key={bucket.key}>
                <div className={`card card-shadow mb-0 h-100${bucket.key === 'd90' ? ' border-danger' : ''}`}>
                  <div className="card-body py-3">
                    <div className="sy-stat__label">{bucket.label}</div>
                    <div className={`h5 m-0 sy-num${bucket.key === 'd90' ? ' text-danger' : ''}`}>{money(data.totals[bucket.key])}</div>
                    <small className="text-muted">
                      %{data.totals.totalMinor ? Math.round((data.totals[bucket.key] / data.totals.totalMinor) * 100) : 0}
                    </small>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Card>
            {data.rows.length === 0 ? (
              <EmptyState message="Açık borç yok." icon="done_all" />
            ) : (
              <Table
                head={
                  <tr>
                    <th>Kişi</th>
                    <th>Daire</th>
                    <th>Telefon</th>
                    {BUCKETS.map((b) => (
                      <th key={b.key} className="text-right">
                        {b.label}
                      </th>
                    ))}
                    <th className="text-right">Toplam</th>
                  </tr>
                }
              >
                {data.rows.map((row) => (
                  <tr key={row.accountId}>
                    <td className="font-weight-bold">{row.name}</td>
                    <td>{row.units.join(', ')}</td>
                    <td className="text-muted sy-num">{row.phone ?? '—'}</td>
                    {BUCKETS.map((b) => (
                      <td key={b.key} className={`text-right sy-num${b.key === 'd90' && row.buckets.d90 > 0 ? ' text-danger font-weight-bold' : ''}`}>
                        {row.buckets[b.key] ? money(row.buckets[b.key]) : <span className="text-muted">—</span>}
                      </td>
                    ))}
                    <td className="text-right sy-num font-weight-bold">{money(row.totalMinor)}</td>
                  </tr>
                ))}
                <tr className="font-weight-bold">
                  <td colSpan={3}>Toplam</td>
                  {BUCKETS.map((b) => (
                    <td key={b.key} className="text-right sy-num">
                      {money(data.totals[b.key])}
                    </td>
                  ))}
                  <td className="text-right sy-num">{money(data.totals.totalMinor)}</td>
                </tr>
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
