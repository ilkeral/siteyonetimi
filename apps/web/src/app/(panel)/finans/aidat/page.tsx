'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { date, money } from '@/lib/format';
import {
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  PageHeader,
  SuccessBox,
  Table,
} from '@/components/ui';

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
    mutationFn: () =>
      api.post<{ documentCount: number; totalMinor: number }>('/finance/dues/generate', payload),
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
    <>
      <PageHeader title="Aidat Tahakkuku" subtitle="Dönemsel aidatı hesapla ve carilere işle" />

      <Card title="Dönem Bilgileri" className="mb-4">
        <div className="card-body">
          <div className="row">
            <div className="col-md-3 form-group">
              <label className="form-label">Dönem</label>
              <input
                type="month"
                className="form-control"
                value={period}
                onChange={(event) => {
                  setPeriod(event.target.value);
                  setIssueDate(`${event.target.value}-01`);
                  setDueDate(`${event.target.value}-15`);
                  setPreview(null);
                }}
              />
            </div>
            <div className="col-md-3 form-group">
              <label className="form-label">Evrak Tarihi</label>
              <input
                type="date"
                className="form-control"
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
              />
            </div>
            <div className="col-md-3 form-group">
              <label className="form-label">Son Ödeme Tarihi</label>
              <input
                type="date"
                className="form-control"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
            <div className="col-md-3 form-group">
              <label className="form-label">Açıklama</label>
              <input
                type="text"
                className="form-control"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Opsiyonel"
              />
            </div>
          </div>
        </div>
      </Card>

      <Card
        title="Aidat Kalemleri"
        className="mb-4"
        actions={
          <button type="button" onClick={addLine} className="btn btn-outline-primary btn-sm">
            <i className="material-icons mr-1" style={{ fontSize: 15 }}>
              add
            </i>
            Kalem Ekle
          </button>
        }
      >
        {lines.length === 0 ? (
          <EmptyState message="Tahakkuka en az bir kalem ekleyin." icon="playlist_add" />
        ) : (
          <div className="card-body">
            {lines.map((line, index) => (
              <div className="row align-items-end mb-2" key={index}>
                <div className="col-md-3 form-group mb-0">
                  <select
                    className="custom-select"
                    value={line.duesItemId}
                    onChange={(event) => {
                      const next = [...lines];
                      next[index] = { ...line, duesItemId: event.target.value };
                      setLines(next);
                      setPreview(null);
                    }}
                  >
                    {items?.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-md-3 form-group mb-0">
                  <select
                    className="custom-select"
                    value={line.mode}
                    onChange={(event) => {
                      const next = [...lines];
                      next[index] = {
                        ...line,
                        mode: event.target.value as 'PER_UNIT' | 'TOTAL',
                      };
                      setLines(next);
                      setPreview(null);
                    }}
                  >
                    <option value="PER_UNIT">Daire başına</option>
                    <option value="TOTAL">Toplam tutarı dağıt</option>
                  </select>
                </div>

                <div className="col-md-3 form-group mb-0">
                  <select
                    className="custom-select"
                    disabled={line.mode === 'PER_UNIT'}
                    value={line.method ?? 'EQUAL'}
                    onChange={(event) => {
                      const next = [...lines];
                      next[index] = { ...line, method: event.target.value };
                      setLines(next);
                      setPreview(null);
                    }}
                  >
                    {METHODS.map((method) => (
                      <option key={method.value} value={method.value}>
                        {method.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="col-md-2 form-group mb-0">
                  <input
                    type="text"
                    inputMode="decimal"
                    className="form-control text-right"
                    value={line.amount}
                    onChange={(event) => {
                      const next = [...lines];
                      next[index] = { ...line, amount: event.target.value };
                      setLines(next);
                      setPreview(null);
                    }}
                    placeholder="Tutar"
                  />
                </div>

                <div className="col-md-1 form-group mb-0">
                  <button
                    type="button"
                    className="btn btn-link text-danger p-0"
                    onClick={() => {
                      setLines(lines.filter((_, i) => i !== index));
                      setPreview(null);
                    }}
                    title="Kaldır"
                  >
                    <i className="material-icons">delete</i>
                  </button>
                </div>
              </div>
            ))}

            <div className="mt-3">
              <button
                type="button"
                onClick={() => previewMutation.mutate()}
                disabled={previewMutation.isPending}
                className="btn btn-outline-secondary mr-2"
              >
                {previewMutation.isPending ? 'Hesaplanıyor...' : 'Önizle'}
              </button>
              <button
                type="button"
                onClick={() => generateMutation.mutate()}
                disabled={!preview || generateMutation.isPending}
                className="btn btn-primary"
              >
                {generateMutation.isPending ? 'Oluşturuluyor...' : 'Tahakkuku Oluştur'}
              </button>
            </div>
          </div>
        )}
      </Card>

      {error && <ErrorBox error={error} />}

      {generateMutation.isSuccess && (
        <SuccessBox>
          {generateMutation.data.documentCount} daireye toplam{' '}
          {money(generateMutation.data.totalMinor)} tahakkuk işlendi.
        </SuccessBox>
      )}

      {preview && (
        <Card
          title={`Önizleme — ${preview.periodLabel}`}
          className="mb-4"
          actions={
            <span className="text-muted small">
              {preview.unitCount} daire · <strong>{money(preview.totalMinor)}</strong>
            </span>
          }
        >
          {preview.warnings.length > 0 && (
            <div className="alert alert-warning m-3 py-2">
              {preview.warnings.map((warning, index) => (
                <div key={index} className="small">
                  {warning}
                </div>
              ))}
            </div>
          )}
          <Table
            head={
              <tr>
                <th>Daire</th>
                <th>Blok</th>
                <th>Sorumlu</th>
                <th>Sıfat</th>
                <th>Kırılım</th>
                <th className="text-right">Tutar</th>
              </tr>
            }
          >
            {preview.rows.map((row) => (
              <tr key={row.unitId} className={row.personId ? '' : 'table-warning'}>
                <td className="font-weight-bold">{row.doorNumber}</td>
                <td className="text-muted">{row.blockName ?? '—'}</td>
                <td>{row.personName}</td>
                <td>
                  {row.liability === 'NONE' ? (
                    <span className="badge badge-warning">Sorumlu yok</span>
                  ) : (
                    <span
                      className={`badge ${
                        row.liability === 'OWNER' ? 'badge-primary' : 'badge-purple'
                      }`}
                    >
                      {row.liability === 'OWNER' ? 'Malik' : 'Kiracı'}
                    </span>
                  )}
                </td>
                <td className="text-muted small">
                  {row.breakdown.map((b) => `${b.name}: ${money(b.amountMinor)}`).join(' · ')}
                </td>
                <td className="text-right sy-num font-weight-bold">{money(row.amountMinor)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card title="Geçmiş Tahakkuklar">
        {!runs ? (
          <div className="card-body">
            <Loading />
          </div>
        ) : runs.length === 0 ? (
          <EmptyState message="Henüz tahakkuk oluşturulmadı." icon="history" />
        ) : (
          <Table
            head={
              <tr>
                <th>Dönem</th>
                <th>Evrak Tarihi</th>
                <th>Son Ödeme</th>
                <th>Daire</th>
                <th>Durum</th>
                <th className="text-right">Tutar</th>
                <th />
              </tr>
            }
          >
            {runs.map((run) => (
              <tr key={run.id}>
                <td className="font-weight-bold">{run.period}</td>
                <td>{date(run.issueDate)}</td>
                <td>{date(run.dueDate)}</td>
                <td>{run.unitCount}</td>
                <td>
                  <span
                    className={`badge ${run.status === 'POSTED' ? 'badge-success' : 'badge-secondary'}`}
                  >
                    {run.status === 'POSTED' ? 'İşlendi' : 'İptal'}
                  </span>
                </td>
                <td className="text-right sy-num font-weight-bold">
                  {money(Math.round(Number(run.totalAmount) * 100))}
                </td>
                <td className="text-right">
                  {run.status === 'POSTED' && (
                    <button
                      type="button"
                      className="btn btn-link btn-sm text-danger p-0"
                      onClick={() => {
                        if (confirm(`${run.period} dönemi tahakkuku iptal edilsin mi?`)) {
                          cancelMutation.mutate(run.id);
                        }
                      }}
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
    </>
  );
}
