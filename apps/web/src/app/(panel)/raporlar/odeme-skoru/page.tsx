'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '@/lib/api';
import { useMe } from '@/lib/me';
import { chartTextColor, date, money } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, Table } from '@/components/ui';
import {
  CHANNEL_NAMES,
  MaskToggle,
  SEGMENTS,
  ScoreBadge,
  type PaymentChannel,
  type ScoreSegment,
} from '@/components/reports';

interface ScoreReport {
  calculatedAt: string | null;
  summary: {
    averageScore: number;
    scoredCount: number;
    highCount: number;
    midCount: number;
    lowCount: number;
    channelShares: Record<PaymentChannel, number>;
  } | null;
  trend: { date: string; averageScore: number; scoredCount: number }[];
  benchmarks: {
    city: string | null;
    cityAverage: number | null;
    citySiteCount: number;
    overallAverage: number | null;
    overallSiteCount: number;
    minimumSites: number;
  };
  people: {
    personId: string;
    name: string;
    units: string[];
    score: number;
    segment: ScoreSegment;
    collectionRate: number;
    avgDaysEarly: number;
    dueMinor: number;
    lateFeeCollectedMinor: number;
    channelShares: Record<PaymentChannel, number>;
  }[];
}

const CHANNEL_ORDER: PaymentChannel[] = ['BANK_TRANSFER', 'CARD', 'CASH', 'OTHER'];
const percent = (value: number) => `%${Math.round(value * 100)}`;
const fixed1 = (value: number) => value.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function PaymentScorePage() {
  const queryClient = useQueryClient();
  const { can } = useMe();
  const [mask, setMask] = useState(true);
  const [segment, setSegment] = useState<ScoreSegment | ''>('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['report', 'scores', mask],
    queryFn: () => api.get<ScoreReport>(`/reports/payment-scores?mask=${mask}`),
  });

  const recalc = useMutation({
    mutationFn: () => api.post('/reports/payment-scores/recalculate'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['report', 'scores'] }),
  });

  const axis = chartTextColor();
  const people = data?.people.filter((p) => !segment || p.segment === segment) ?? [];

  return (
    <>
      <PageHeader
        title="Ödeme Skoru"
        subtitle={
          data?.calculatedAt
            ? `Son hesap: ${date(data.calculatedAt)} · her gece son 6 aylık verilerle güncellenir`
            : 'Her gece son 6 aylık verilerle güncellenir'
        }
        breadcrumb={['Raporlar', 'Ödeme Skoru']}
        actions={
          can('SITE_ADMIN') ? (
            <button type="button" className="btn btn-outline-secondary btn-sm" disabled={recalc.isPending} onClick={() => recalc.mutate()}>
              <i className="material-icons mr-1" style={{ fontSize: 16, verticalAlign: -3 }}>refresh</i>
              {recalc.isPending ? 'Hesaplanıyor...' : 'Şimdi Hesapla'}
            </button>
          ) : null
        }
      />

      {(error || recalc.error) && <ErrorBox error={error ?? recalc.error} />}
      {isLoading && <Loading />}

      {data && !data.summary && (
        <Card>
          <EmptyState message="Henüz skor hesaplanmadı. İlk hesap bu gece yapılacak ya da “Şimdi Hesapla” ile başlatabilirsiniz." icon="grade" />
        </Card>
      )}

      {data?.summary && (
        <>
          <div className="row">
            {/* Tek bir başlık sayısı: grafik değil, büyük sayı */}
            <div className="col-lg-4 mb-4">
              <Card className="h-100" bodyClassName="card-body text-center">
                <div className="sy-stat__label">Site Ödeme Skoru</div>
                <div className="sy-score-hero sy-num">{fixed1(data.summary.averageScore)}</div>
                <div className="text-muted mb-3">5 üzerinden · {data.summary.scoredCount} kişi skorlandı</div>

                {/* Segment dağılımı: etiketli tek yığılmış çubuk */}
                <div className="sy-segments" role="img" aria-label="Skor segment dağılımı">
                  {(['HIGH', 'MID', 'LOW'] as ScoreSegment[]).map((key) => {
                    const count = key === 'HIGH' ? data.summary!.highCount : key === 'MID' ? data.summary!.midCount : data.summary!.lowCount;
                    return count > 0 ? (
                      <span key={key} style={{ flexGrow: count, background: SEGMENTS[key].color }} title={`${SEGMENTS[key].label}: ${count}`} />
                    ) : null;
                  })}
                </div>
                <ul className="list-unstyled text-left small mt-2 mb-0">
                  {(['HIGH', 'MID', 'LOW'] as ScoreSegment[]).map((key) => {
                    const count = key === 'HIGH' ? data.summary!.highCount : key === 'MID' ? data.summary!.midCount : data.summary!.lowCount;
                    return (
                      <li key={key} className="d-flex align-items-center py-1">
                        <span className="sy-swatch" style={{ background: SEGMENTS[key].color }} />
                        <span className="flex">{SEGMENTS[key].label}</span>
                        <strong className="sy-num">{count}</strong>
                        <span className="text-muted sy-num ml-2" style={{ width: 44, textAlign: 'right' }}>
                          {percent(count / data.summary!.scoredCount)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </div>

            <div className="col-lg-8 mb-4">
              <Card title="Skor Trendi (site ortalaması)" className="h-100">
                <div className="card-body">
                  {data.trend.length < 2 ? (
                    <p className="text-muted small mb-0">
                      Trend için en az iki günlük hesap gerekir. Gece hesaplamaları biriktikçe çizgi oluşur.
                    </p>
                  ) : (
                    <div style={{ height: 220 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data.trend} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--sy-border)" />
                          <XAxis dataKey="date" tickFormatter={(v) => date(v)} tick={{ fontSize: 11, fill: axis }} tickLine={false} axisLine={false} minTickGap={24} />
                          <YAxis domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} tick={{ fontSize: 11, fill: axis }} tickLine={false} axisLine={false} width={28} />
                          <Tooltip
                            formatter={(value: number) => [fixed1(value), 'Site ortalaması']}
                            labelFormatter={(v) => date(v)}
                            contentStyle={{ fontSize: 12, borderRadius: 5, background: 'var(--sy-surface)', border: '1px solid var(--sy-border)', color: 'var(--sy-text)' }}
                          />
                          {data.benchmarks.cityAverage !== null && (
                            <ReferenceLine y={data.benchmarks.cityAverage} stroke={axis} strokeDasharray="4 4" label={{ value: `${data.benchmarks.city} ort.`, fontSize: 11, fill: axis, position: 'insideTopRight' }} />
                          )}
                          <Line type="monotone" dataKey="averageScore" stroke="var(--sy-primary)" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 5 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <div className="d-flex flex-wrap mt-3 small" style={{ gap: '1.5rem' }}>
                    <span>
                      {data.benchmarks.city ?? 'İl'} ortalaması:{' '}
                      <strong className="sy-num">{data.benchmarks.cityAverage !== null ? fixed1(data.benchmarks.cityAverage) : '—'}</strong>
                    </span>
                    <span>
                      Tüm siteler: <strong className="sy-num">{data.benchmarks.overallAverage !== null ? fixed1(data.benchmarks.overallAverage) : '—'}</strong>
                    </span>
                    {(data.benchmarks.cityAverage === null || data.benchmarks.overallAverage === null) && (
                      <span className="text-muted">
                        Kıyas en az {data.benchmarks.minimumSites} site verisiyle gösterilir (diğer sitelerin verisi ifşa olmasın diye).
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            </div>
          </div>

          <div className="row">
            <div className="col-lg-4 mb-4">
              <Card title="Tahsilat Kanalları" className="h-100">
                <div className="card-body">
                  {/* Kanal payı: tek renkli yatay çubuklar, değer metinle */}
                  {CHANNEL_ORDER.map((channel) => (
                    <div key={channel} className="mb-3">
                      <div className="d-flex justify-content-between small mb-1">
                        <span>{CHANNEL_NAMES[channel]}</span>
                        <strong className="sy-num">{percent(data.summary!.channelShares[channel] ?? 0)}</strong>
                      </div>
                      <div className="sy-hbar">
                        <span style={{ width: `${(data.summary!.channelShares[channel] ?? 0) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                  <small className="text-muted">Havale ve online kart dijital kanal sayılır; skorda %10 ağırlığı var.</small>
                </div>
              </Card>
            </div>

            <div className="col-lg-8 mb-4">
              <Card
                title="Kişi Bazlı Skorlar"
                actions={
                  <select className="custom-select custom-select-sm" style={{ width: 160 }} value={segment} onChange={(e) => setSegment(e.target.value as ScoreSegment | '')}>
                    <option value="">Tüm segmentler</option>
                    {(['HIGH', 'MID', 'LOW'] as ScoreSegment[]).map((key) => (
                      <option key={key} value={key}>
                        {SEGMENTS[key].label}
                      </option>
                    ))}
                  </select>
                }
              >
                <div className="card-body py-2 border-bottom">
                  <MaskToggle value={mask} onChange={setMask} />
                </div>
                <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                  <Table
                    head={
                      <tr>
                        <th>Kişi</th>
                        <th>Daire</th>
                        <th className="text-right" title="Vadesi gelen borcun ödenen oranı">Tahsilat</th>
                        <th className="text-right" title="Pozitif: vadeden önce, negatif: vadeden sonra">Ödeme günü</th>
                        <th className="text-right">Tahsil edilen G.T.</th>
                        <th className="text-right">Dijital</th>
                        <th className="text-right">Skor</th>
                      </tr>
                    }
                  >
                    {people.map((person) => (
                      <tr key={person.personId}>
                        <td className="font-weight-bold">{person.name}</td>
                        <td className="text-muted">{person.units.join(', ')}</td>
                        <td className="text-right sy-num">{percent(person.collectionRate)}</td>
                        <td className={`text-right sy-num ${person.avgDaysEarly < 0 ? 'text-danger' : 'text-success'}`}>
                          {person.avgDaysEarly > 0 ? '+' : ''}
                          {fixed1(person.avgDaysEarly)}
                        </td>
                        <td className="text-right sy-num">{money(person.lateFeeCollectedMinor)}</td>
                        <td className="text-right sy-num">{percent(person.channelShares.BANK_TRANSFER + person.channelShares.CARD)}</td>
                        <td className="text-right">
                          <ScoreBadge score={person.score} segment={person.segment} />
                        </td>
                      </tr>
                    ))}
                  </Table>
                </div>
              </Card>
            </div>
          </div>

          <details className="text-muted small mb-4">
            <summary>Skor nasıl hesaplanır?</summary>
            <p className="mt-2 mb-1">Son 6 ayda vadesi gelen borçlar üzerinden, 0–5 arası:</p>
            <ul className="mb-0">
              <li>%50 tahsilat oranı — vadesi gelen borcun ödenen kısmı</li>
              <li>%30 zamanlama — tutar ağırlıklı ortalama ödeme günü (5+ gün erken = tam, vadesinde = 4, 30 gün geç = 2, 90+ gün geç = 0)</li>
              <li>%10 gecikme tazminatı yükü — tazminat / vadesi gelen borç</li>
              <li>%10 dijital kanal — havale/EFT ve online kart payı</li>
            </ul>
            <p className="mt-1 mb-0">Tahsilatlar borçlara en eskisinden başlayarak (FIFO) uygulanır; bir borcu kapatan tahsilatın tarihi ödeme günüdür.</p>
          </details>
        </>
      )}
    </>
  );
}
