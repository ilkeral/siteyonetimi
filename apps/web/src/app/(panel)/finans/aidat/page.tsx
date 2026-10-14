'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { date, money } from '@/lib/format';
import { Badge, Card, EmptyState, ErrorBox, Loading, PageHeader, Table } from '@/components/ui';

interface DuesItem {
  id: string;
  name: string;
  defaultAmount: string;
  distributionMethod: string | null;
}

interface PreviewRow {
  unitId: string;
  blockName: string | null;
  doorNumber: string;
  personName: string;
  personId: string | null;
  liability: 'OWNER' | 'TENANT' | 'NONE';
  amountMinor: number;
  breakdown: { duesItemId: string; name: string; amountMinor: number }[];
}

interface Preview {
  period: string;
  periodLabel: string;
  rows: PreviewRow[];
  totalMinor: number;
  unitCount: number;
  warnings: string[];
}

interface DuesRun {
  id: string;
  period: string;
  issueDate: string;
  dueDate: string;
  status: string;
  totalAmount: string;
  unitCount: number;
}

const METHODS = [
  { value: 'EQUAL', label: 'Eşit' },
  { value: 'BY_AREA', label: 'm² Oranında' },
  { value: 'BY_LAND_SHARE', label: 'Arsa Payına Göre' },
  { value: 'BY_SHARE_RATIO', label: 'Hisse Oranına Göre' },
];

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function DuesPage() {
  const queryClient = useQueryClient();
  const [period, setPeriod] = useState(currentPeriod());
  const [issueDate, setIssueDate] = useState(`${currentPeriod()}-01`);
  const [dueDate, setDueDate] = useState(`${currentPeriod()}-15`);
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<
    { duesItemId: string; amount: string; mode: 'PER_UNIT' | 'TOTAL'; method?: string }[]
  >([]);
  const [preview, setPreview] = useState<Preview | null>(null);

  const { data: items } = useQuery({
    queryKey: ['dues-items'],
    queryFn: () => api.get<DuesItem[]>('/finance/dues/items'),
  });

  const { data: runs } = useQuery({
    queryKey: ['dues-runs'],
    queryFn: () => api.get<DuesRun[]>('/finance/dues/runs'),
  });

  const payload = { period, issueDate, dueDate, description: description || undefined, lines };

  const previewMutation = useMutation({
    mutationFn: () => api.post<Preview>('/finance/dues/preview', payload),
    onSuccess: setPreview,
  });

  const generateMutation = useMutation({
    mutationFn: () => api.post<{ documentCount: number; totalMinor: number }>(
      '/finance/dues/generate',
      payload,
    ),
    onSuccess: () => {
      setPreview(null);
      setLines([]);
      void queryClient.invalidateQueries({ queryKey: ['dues-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/finance/dues/runs/${id}/cancel`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dues-runs'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  function addLine() {
    const first = items?.[0];
    if (!first) return;
    setLines([
      ...lines,
      {
        duesItemId: first.id,
        amount: String(Number(first.defaultAmount ?? 0)),
        mode: 'PER_UNIT',
        method: first.distributionMethod ?? 'EQUAL',
      },
    ]);
    setPreview(null);
  }

  const error = previewMutation.error ?? generateMutation.error ?? cancelMutation.error;

  return (
    <div className="space-y-5">
      <PageHeader title="Aidat Tahakkuku" subtitle="Dönemsel aidatı hesapla ve carilere işle" />

      <Card title="Dönem Bilgileri">
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-4">
          <div>
            <label className="field-label">Dönem</label>
            <input
              type="month"
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                setIssueDate(`${e.target.value}-01`);
                setDueDate(`${e.target.value}-15`);
                setPreview(null);
              }}
              className="field-input"
            />
          </div>
          <div>
            <label className="field-label">Evrak Tarihi</label>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="field-input"
            />
          </div>
          <div>
            <label className="field-label">Son Ödeme Tarihi</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="field-input"
            />
          </div>
          <div>
            <label className="field-label">Açıklama</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Opsiyonel"
              className="field-input"
            />
          </div>
        </div>
      </Card>

      <Card
        title="Aidat Kalemleri"
        actions={
          <button type="button" onClick={addLine} className="btn-ghost px-3 py-1 text-xs">
            + Kalem Ekle
          </button>
        }
      >
        {lines.length === 0 ? (
          <EmptyState message="Tahakkuka en az bir kalem ekleyin." />
        ) : (
          <div className="space-y-3 p-5">
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                <select
                  value={line.duesItemId}
                  onChange={(e) => {
                    const next = [...lines];
                    next[index] = { ...line, duesItemId: e.target.value };
                    setLines(next);
                    setPreview(null);
                  }}
                  className="field-input"
                >
                  {items?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>

                <select
                  value={line.mode}
                  onChange={(e) => {
                    const next = [...lines];
                    next[index] = { ...line, mode: e.target.value as 'PER_UNIT' | 'TOTAL' };
                    setLines(next);
                    setPreview(null);
                  }}
                  className="field-input"
                >
                  <option value="PER_UNIT">Daire başına</option>
                  <option value="TOTAL">Toplam tutarı dağıt</option>
                </select>

                <select
                  value={line.method ?? 'EQUAL'}
                  disabled={line.mode === 'PER_UNIT'}
                  onChange={(e) => {
                    const next = [...lines];
                    next[index] = { ...line, method: e.target.value };
                    setLines(next);
                    setPreview(null);
                  }}
                  className="field-input disabled:bg-slate-50 disabled:text-slate-400"
                >
                  {METHODS.map((method) => (
                    <option key={method.value} value={method.value}>
                      {method.label}
                    </option>
                  ))}
                </select>

                <input
                  type="text"
                  inputMode="decimal"
                  value={line.amount}
                  onChange={(e) => {
                    const next = [...lines];
                    next[index] = { ...line, amount: e.target.value };
                    setLines(next);
                    setPreview(null);
                  }}
                  placeholder="Tutar"
                  className="field-input"
                />

                <button
                  type="button"
                  onClick={() => {
                    setLines(lines.filter((_, i) => i !== index));
                    setPreview(null);
                  }}
                  className="btn-ghost text-xs text-red-600"
                >
                  Kaldır
                </button>
              </div>
            ))}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => previewMutation.mutate()}
                disabled={previewMutation.isPending}
                className="btn-ghost text-sm"
              >
                {previewMutation.isPending ? 'Hesaplanıyor...' : 'Önizle'}
              </button>
              <button
                type="button"
                onClick={() => generateMutation.mutate()}
                disabled={!preview || generateMutation.isPending}
                className="btn-primary text-sm"
              >
                {generateMutation.isPending ? 'Oluşturuluyor...' : 'Tahakkuku Oluştur'}
              </button>
            </div>
          </div>
        )}
      </Card>

      {error && <ErrorBox error={error instanceof ApiError ? error : error} />}

      {generateMutation.isSuccess && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {generateMutation.data.documentCount} daireye toplam{' '}
          {money(generateMutation.data.totalMinor)} tahakkuk işlendi.
        </div>
      )}

      {preview && (
        <Card
          title={`Önizleme — ${preview.periodLabel}`}
          actions={
            <span className="text-xs font-medium text-slate-600">
              {preview.unitCount} daire · {money(preview.totalMinor)}
            </span>
          }
        >
          {preview.warnings.length > 0 && (
            <div className="border-b border-amber-100 bg-amber-50 px-5 py-3 text-xs text-amber-800">
              {preview.warnings.map((warning, i) => (
                <div key={i}>⚠ {warning}</div>
              ))}
            </div>
          )}
          <Table
            head={
              <tr>
                <th className="px-5 py-2">Daire</th>
                <th className="px-3 py-2">Blok</th>
                <th className="px-3 py-2">Sorumlu</th>
                <th className="px-3 py-2">Sıfat</th>
                <th className="px-3 py-2">Kırılım</th>
                <th className="px-5 py-2 text-right">Tutar</th>
              </tr>
            }
          >
            {preview.rows.map((row) => (
              <tr key={row.unitId} className={row.personId ? '' : 'bg-amber-50/50'}>
                <td className="px-5 py-2.5 font-medium">{row.doorNumber}</td>
                <td className="px-3 py-2.5 text-slate-500">{row.blockName ?? '—'}</td>
                <td className="px-3 py-2.5">{row.personName}</td>
                <td className="px-3 py-2.5">
                  {row.liability === 'NONE' ? (
                    <Badge tone="amber">Sorumlu yok</Badge>
                  ) : (
                    <Badge tone={row.liability === 'OWNER' ? 'blue' : 'purple'}>
                      {row.liability === 'OWNER' ? 'Malik' : 'Kiracı'}
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-500">
                  {row.breakdown.map((b) => `${b.name}: ${money(b.amountMinor)}`).join(' · ')}
                </td>
                <td className="px-5 py-2.5 text-right font-medium">{money(row.amountMinor)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card title="Geçmiş Tahakkuklar">
        {!runs ? (
          <Loading />
        ) : runs.length === 0 ? (
          <EmptyState message="Henüz tahakkuk oluşturulmadı." />
        ) : (
          <Table
            head={
              <tr>
                <th className="px-5 py-2">Dönem</th>
                <th className="px-3 py-2">Evrak Tarihi</th>
                <th className="px-3 py-2">Son Ödeme</th>
                <th className="px-3 py-2">Daire</th>
                <th className="px-3 py-2">Durum</th>
                <th className="px-5 py-2 text-right">Tutar</th>
                <th className="px-5 py-2"></th>
              </tr>
            }
          >
            {runs.map((run) => (
              <tr key={run.id}>
                <td className="px-5 py-2.5 font-medium">{run.period}</td>
                <td className="px-3 py-2.5">{date(run.issueDate)}</td>
                <td className="px-3 py-2.5">{date(run.dueDate)}</td>
                <td className="px-3 py-2.5">{run.unitCount}</td>
                <td className="px-3 py-2.5">
                  <Badge tone={run.status === 'POSTED' ? 'green' : 'slate'}>
                    {run.status === 'POSTED' ? 'İşlendi' : 'İptal'}
                  </Badge>
                </td>
                <td className="px-5 py-2.5 text-right font-medium">
                  {money(Math.round(Number(run.totalAmount) * 100))}
                </td>
                <td className="px-5 py-2.5 text-right">
                  {run.status === 'POSTED' && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`${run.period} dönemi tahakkuku iptal edilsin mi?`)) {
                          cancelMutation.mutate(run.id);
                        }
                      }}
                      className="text-xs text-red-600 hover:underline"
                    >
                      İptal et
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
