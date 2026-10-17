'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { METER_TYPE_LABELS, parseReadingSheet } from '@sy/shared';
import { api } from '@/lib/api';
import { readTextFile } from '@/lib/files';
import { useMe } from '@/lib/me';
import { dateTime, money, moneyInput, quantity } from '@/lib/format';
import { Card, EmptyState, ErrorBox, Loading, PageHeader, SuccessBox, Table } from '@/components/ui';
import {
  DocumentFields,
  METER_TYPE_ORDER,
  METER_UNITS,
  StatusBadge,
  decimalText,
  distributionPayload,
  documentFieldsOf,
  paramsOf,
  parseLocal,
  type DistributionDetail,
  type DocumentFieldsValue,
  type MainReading,
  type MeterType,
  type ParamsValue,
} from '@/components/meters';

const STEPS = [
  { key: 1, label: 'Evrak Bilgileri' },
  { key: 2, label: 'Parametreler ve Ana Sayaçlar' },
  { key: 3, label: 'Daire Okumaları' },
  { key: 4, label: 'Önizleme ve Onay' },
] as const;

type Step = (typeof STEPS)[number]['key'];

export default function DistributionWizardPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = useMe();

  const initialStep = Number(searchParams.get('adim')) as Step;
  const [step, setStep] = useState<Step>(STEPS.some((s) => s.key === initialStep) ? initialStep : 1);

  const key = ['meters', 'detail', params.id];
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => api.get<DistributionDetail>(`/meters/distributions/${params.id}`),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['meters'] });

  const remove = useMutation({
    mutationFn: () => api.delete(`/meters/distributions/${params.id}`),
    onSuccess: () => {
      void refresh();
      router.push('/sayac');
    },
  });

  function goTo(next: Step) {
    setStep(next);
    // Sayfa yenilenince aynı adımda kalsın
    window.history.replaceState(null, '', `/sayac/${params.id}?adim=${next}`);
  }

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const draft = data.status === 'DRAFT';
  const finance = can('SITE_ADMIN', 'ACCOUNTANT');

  return (
    <>
      <PageHeader
        title={data.name || `${data.periodLabel} Sayaç Dağıtımı`}
        subtitle={`${data.periodLabel} dönemi`}
        breadcrumb={['Sayaç İşlemleri', 'Dağıtımlar', data.periodLabel]}
        actions={
          <>
            <StatusBadge status={data.status} />
            {draft && finance && (
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`${data.periodLabel} taslak dağıtımı silinsin mi?`)) remove.mutate();
                }}
              >
                Taslağı Sil
              </button>
            )}
            <Link href="/sayac" className="btn btn-outline-secondary btn-sm">
              Listeye dön
            </Link>
          </>
        }
      />

      {remove.error && <ErrorBox error={remove.error} />}
      {!draft && (
        <div className="alert alert-info">
          Bu dağıtım onaylandı ({dateTime(data.approvedAt)}); okumalar ve parametreler yalnızca okunabilir.
          Düzeltmek için 4. adımdan onayı geri alın.
        </div>
      )}

      <ol className="sy-steps">
        {STEPS.map((item) => (
          <li key={item.key} className={item.key === step ? 'is-active' : item.key < step ? 'is-done' : ''}>
            <button type="button" onClick={() => goTo(item.key)}>
              <span className="sy-steps__no">{item.key}</span>
              {item.label}
            </button>
          </li>
        ))}
      </ol>

      {step === 1 && (
        <DocumentStep detail={data} editable={draft && finance} onSaved={() => goTo(2)} refresh={refresh} />
      )}
      {step === 2 && (
        <ParamsStep
          detail={data}
          editable={draft}
          canEditParams={finance}
          onSaved={() => goTo(3)}
          refresh={refresh}
        />
      )}
      {step === 3 && <ReadingsStep detail={data} editable={draft} onNext={() => goTo(4)} refresh={refresh} />}
      {step === 4 && <PreviewStep detail={data} canApprove={finance} refresh={refresh} />}
    </>
  );
}

// ------------------------------------------------------------ 1. evrak bilgileri

function DocumentStep({
  detail,
  editable,
  onSaved,
  refresh,
}: {
  detail: DistributionDetail;
  editable: boolean;
  onSaved: () => void;
  refresh: () => Promise<void>;
}) {
  const initial = useMemo(() => documentFieldsOf(detail), [detail]);
  const [value, setValue] = useState<DocumentFieldsValue>(initial);
  useEffect(() => setValue(initial), [initial]);

  const save = useMutation({
    mutationFn: () => api.put(`/meters/distributions/${detail.id}`, distributionPayload(value, paramsOf(detail))),
    onSuccess: async () => {
      await refresh();
      onSaved();
    },
  });

  return (
    <div className="row">
      <div className="col-xl-8">
        <Card title="Oluşacak Evrak Bilgileri">
          <div className="card-body">
            <DocumentFields value={value} onChange={setValue} disabled={!editable} />
            {save.error && <ErrorBox error={save.error} />}
            <div className="d-flex justify-content-end">
              {editable ? (
                <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
                  Kaydet ve Devam Et
                </button>
              ) : (
                <button type="button" className="btn btn-outline-secondary" onClick={onSaved}>
                  Sonraki Adım
                </button>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------- 2. parametreler ve ana sayaçlar

interface MainRow {
  type: MeterType;
  enabled: boolean;
  previousValue: string;
  currentValue: string;
  invoiceAmount: string;
}

function mainRowsOf(readings: MainReading[]): MainRow[] {
  return METER_TYPE_ORDER.map((type) => {
    const reading = readings.find((r) => r.type === type)!;
    return {
      type,
      enabled: !reading.skip,
      previousValue: decimalText(reading.previousValue),
      currentValue: reading.saved ? decimalText(reading.currentValue) : '',
      invoiceAmount: moneyInput(reading.invoiceAmountMinor),
    };
  });
}

function ParamsStep({
  detail,
  editable,
  canEditParams,
  onSaved,
  refresh,
}: {
  detail: DistributionDetail;
  editable: boolean;
  canEditParams: boolean;
  onSaved: () => void;
  refresh: () => Promise<void>;
}) {
  const initialParams = useMemo(() => paramsOf(detail), [detail]);
  const initialRows = useMemo(() => mainRowsOf(detail.mainReadings), [detail]);
  const [params, setParams] = useState<ParamsValue>(initialParams);
  const [rows, setRows] = useState<MainRow[]>(initialRows);
  useEffect(() => setParams(initialParams), [initialParams]);
  useEffect(() => setRows(initialRows), [initialRows]);

  const setParam = <K extends keyof ParamsValue>(key: K, value: ParamsValue[K]) =>
    setParams((current) => ({ ...current, [key]: value }));
  const setRow = (type: MeterType, patch: Partial<MainRow>) =>
    setRows((current) => current.map((row) => (row.type === type ? { ...row, ...patch } : row)));

  const save = useMutation({
    mutationFn: async () => {
      if (canEditParams) {
        await api.put(`/meters/distributions/${detail.id}`, distributionPayload(documentFieldsOf(detail), params));
      }
      await api.put(`/meters/distributions/${detail.id}/main-readings`, {
        readings: rows.map((row) => ({
          type: row.type,
          skip: !row.enabled,
          previousValue: row.previousValue || '0',
          currentValue: row.currentValue || row.previousValue || '0',
          invoiceAmount: row.invoiceAmount || '0',
        })),
      });
    },
    onSuccess: async () => {
      await refresh();
      onSaved();
    },
  });

  const unitPriced = params.waterPricingMethod === 'UNIT_PRICE';
  /** Bu tür fatura tutarı ister mi (birim fiyatlı su faturaya bakmaz) */
  const needsInvoice = (type: MeterType) => !(unitPriced && (type === 'COLD_WATER' || type === 'HOT_WATER'));

  return (
    <>
    <fieldset disabled={!editable}>
      <div className="row">
        <div className="col-xl-4 mb-4">
          <Card title="Dağıtım Parametreleri">
            <fieldset className="card-body" disabled={!canEditParams}>
              <div className="row">
                <div className="col-6 form-group">
                  <label className="form-label">Su Giriş Sıcaklığı (°C)</label>
                  <input className="form-control" value={params.waterInletTemp} onChange={(e) => setParam('waterInletTemp', e.target.value)} />
                </div>
                <div className="col-6 form-group">
                  <label className="form-label">Su Çıkış Sıcaklığı (°C)</label>
                  <input className="form-control" value={params.waterOutletTemp} onChange={(e) => setParam('waterOutletTemp', e.target.value)} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Yakıt Alt Isı Değeri (kcal)</label>
                <input className="form-control" value={params.fuelLowerHeatValue} onChange={(e) => setParam('fuelLowerHeatValue', e.target.value)} />
                <small className="text-muted">Doğalgaz için tipik değer 8.250 kcal/m³.</small>
              </div>
              <div className="form-group">
                <label className="form-label">Su Bedeli Hesaplama Şekli</label>
                <select
                  className="custom-select"
                  value={params.waterPricingMethod}
                  onChange={(e) => setParam('waterPricingMethod', e.target.value as ParamsValue['waterPricingMethod'])}
                >
                  <option value="UNIT_PRICE">Birim fiyat üzerinden</option>
                  <option value="INVOICE_TOTAL">Fatura tutarının tüketime bölünmesi</option>
                </select>
              </div>
              {unitPriced && (
                <div className="form-group">
                  <label className="form-label">Su Birim Fiyatı (₺ / m³)</label>
                  <input className="form-control text-right" inputMode="decimal" value={params.waterUnitPrice} onChange={(e) => setParam('waterUnitPrice', e.target.value)} placeholder="45,50" />
                </div>
              )}
              <div className="row">
                <div className="col-6 form-group">
                  <label className="form-label">Sabit Gider Payı (%)</label>
                  <input className="form-control" value={params.fixedSharePercent} onChange={(e) => setParam('fixedSharePercent', e.target.value)} />
                </div>
                <div className="col-6 form-group">
                  <label className="form-label">Ceza Yüzdesi (%)</label>
                  <input className="form-control" value={params.penaltyPercent} onChange={(e) => setParam('penaltyPercent', e.target.value)} />
                </div>
              </div>
              <small className="text-muted d-block">
                Sabit gider payı ısınmanın m²'ye göre bölünen kısmıdır (ortak alan ısıtması). Ceza yüzdesi,
                okuması olmayan daireye site ortalamasının üzerine eklenir.
              </small>
              {!canEditParams && (
                <small className="text-warning d-block mt-2">Parametreleri yalnızca yönetici veya muhasebe değiştirebilir.</small>
              )}
            </fieldset>
          </Card>
        </div>

        <div className="col-xl-8 mb-4">
          <Card title="Ana Sayaçlar ve Faturalar">
            <Table
              head={
                <tr>
                  <th>Hesapla</th>
                  <th>Sayaç</th>
                  <th className="text-right">Önceki Okuma</th>
                  <th className="text-right">Son Okuma</th>
                  <th className="text-right">Tüketim</th>
                  <th className="text-right">Fatura Tutarı (₺)</th>
                </tr>
              }
            >
              {rows.map((row) => {
                const consumption = (parseLocal(row.currentValue) ?? 0) - (parseLocal(row.previousValue) ?? 0);
                return (
                  <tr key={row.type} className={row.enabled ? '' : 'text-muted'}>
                    <td>
                      <div className="custom-control custom-checkbox">
                        <input
                          type="checkbox"
                          className="custom-control-input"
                          id={`enable-${row.type}`}
                          checked={row.enabled}
                          onChange={(e) => setRow(row.type, { enabled: e.target.checked })}
                        />
                        <label className="custom-control-label" htmlFor={`enable-${row.type}`} />
                      </div>
                    </td>
                    <td className="font-weight-bold">
                      {METER_TYPE_LABELS[row.type]} <span className="text-muted small">({METER_UNITS[row.type]})</span>
                    </td>
                    <td>
                      <input className="form-control form-control-sm text-right sy-cell" disabled={!row.enabled} value={row.previousValue} onChange={(e) => setRow(row.type, { previousValue: e.target.value })} />
                    </td>
                    <td>
                      <input className="form-control form-control-sm text-right sy-cell" disabled={!row.enabled} value={row.currentValue} onChange={(e) => setRow(row.type, { currentValue: e.target.value })} />
                    </td>
                    <td className={`text-right sy-num${consumption < 0 ? ' text-danger' : ''}`}>
                      {row.enabled && row.currentValue ? quantity(consumption) : '—'}
                    </td>
                    <td>
                      {needsInvoice(row.type) ? (
                        <input className="form-control form-control-sm text-right sy-cell" inputMode="decimal" disabled={!row.enabled} value={row.invoiceAmount} onChange={(e) => setRow(row.type, { invoiceAmount: e.target.value })} placeholder="0,00" />
                      ) : (
                        <span className="text-muted small">birim fiyatla</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
            <div className="card-body">
              <small className="text-muted d-block mb-2">
                Ana sayaç tüketimi ile daire tüketimleri toplamı arasındaki fark ortak tüketimdir (kayıp/kaçak,
                ortak alan) ve tüketim oranında paylaştırılır. Yakıt faturasından önce sıcak suyun ısınması için
                harcanan pay ayrılır.
                {detail.suggestedFrom && ' Önceki okumalar son onaylı dönemden alınmıştır.'}
              </small>
              {save.error && <ErrorBox error={save.error} />}
              <div className="d-flex justify-content-end">
                {editable ? (
                  <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
                    Kaydet ve Devam Et
                  </button>
                ) : null}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </fieldset>
      {!editable && (
        <div className="d-flex justify-content-end">
          <button type="button" className="btn btn-outline-secondary" onClick={onSaved}>
            Sonraki Adım
          </button>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------ 3. daire okumaları

interface GridCell {
  previousValue: string;
  currentValue: string;
  note: string;
}

function ReadingsStep({
  detail,
  editable,
  onNext,
  refresh,
}: {
  detail: DistributionDetail;
  editable: boolean;
  onNext: () => void;
  refresh: () => Promise<void>;
}) {
  const types = detail.mainReadings.filter((r) => r.saved && !r.skip).map((r) => r.type);
  const [type, setType] = useState<MeterType | null>(types[0] ?? null);
  const [grid, setGrid] = useState<Record<string, GridCell>>({});
  const [dirty, setDirty] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Tür değişince (ya da veri tazelenince) ızgarayı sunucudaki okumalarla doldur
  useEffect(() => {
    if (!type) return;
    const saved = detail.readings[type] ?? {};
    setGrid(
      Object.fromEntries(
        detail.units.map((unit) => {
          const reading = saved[unit.unitId];
          return [
            unit.unitId,
            {
              previousValue: reading ? decimalText(reading.previousValue) : '',
              currentValue: reading ? decimalText(reading.currentValue) : '',
              note: reading?.note ?? '',
            },
          ];
        }),
      ),
    );
    setDirty(false);
  }, [detail, type]);

  const save = useMutation({
    mutationFn: () =>
      api.put<{ saved: number; removed: number }>(`/meters/distributions/${detail.id}/unit-readings`, {
        type,
        readings: detail.units
          .filter((unit) => !unit.isExempt)
          .map((unit) => {
            const cell = grid[unit.unitId];
            return {
              unitId: unit.unitId,
              previousValue: cell?.previousValue || null,
              currentValue: cell?.currentValue || null,
              note: cell?.note || null,
            };
          }),
      }),
    onSuccess: () => refresh(),
  });

  if (types.length === 0 || !type) {
    return (
      <Card>
        <EmptyState message="Hesaplanacak sayaç türü yok. 2. adımda en az bir ana sayacı işaretleyip kaydedin." icon="av_timer" />
      </Card>
    );
  }

  const suggestions = detail.suggestions[type] ?? {};
  const setCell = (unitId: string, patch: Partial<GridCell>) => {
    setGrid((current) => ({ ...current, [unitId]: { ...current[unitId], ...patch } }));
    setDirty(true);
  };

  let entered = 0;
  let totalConsumption = 0;
  const consumptionOf = (unitId: string) => {
    const cell = grid[unitId];
    const current = cell ? parseLocal(cell.currentValue) : null;
    if (current === null) return null;
    const previous = parseLocal(cell.previousValue) ?? suggestions[unitId] ?? 0;
    const factor = detail.units.find((u) => u.unitId === unitId)?.factors[type] ?? 1;
    return (current - previous) * factor;
  };
  for (const unit of detail.units) {
    const consumption = consumptionOf(unit.unitId);
    if (consumption !== null) {
      entered++;
      totalConsumption += Math.max(0, consumption);
    }
  }
  const main = detail.mainReadings.find((r) => r.type === type)!;
  const mainConsumption = main.currentValue - main.previousValue;
  const active = detail.units.filter((u) => !u.isExempt).length;

  return (
    <Card>
      <div className="card-header p-0">
        <ul className="nav nav-tabs nav-tabs-card">
          {types.map((item) => (
            <li className="nav-item" key={item}>
              <button
                type="button"
                className={`nav-link${item === type ? ' active' : ''}`}
                onClick={() => {
                  if (dirty && !window.confirm('Kaydedilmemiş okumalar var. Yine de geçilsin mi?')) return;
                  setType(item);
                }}
              >
                {METER_TYPE_LABELS[item]}
                <span className="badge badge-light ml-1">{Object.keys(detail.readings[item] ?? {}).length}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="card-body d-flex flex-wrap align-items-center" style={{ gap: '1.5rem' }}>
        <span>
          Girilen okuma <strong className="sy-num">{entered}</strong> / {active}
        </span>
        <span>
          Daire tüketimi <strong className="sy-num">{quantity(totalConsumption)}</strong> {METER_UNITS[type]}
        </span>
        <span>
          Ana sayaç <strong className="sy-num">{quantity(mainConsumption)}</strong> {METER_UNITS[type]}
        </span>
        {mainConsumption > 0 && (
          <span className={totalConsumption > mainConsumption ? 'text-danger' : 'text-muted'}>
            Ortak tüketim{' '}
            <strong className="sy-num">{quantity(Math.max(0, mainConsumption - totalConsumption))}</strong>
          </span>
        )}
        {editable && (
          <button type="button" className="btn btn-outline-secondary btn-sm ml-auto" onClick={() => setImportOpen((v) => !v)}>
            <i className="material-icons mr-1" style={{ fontSize: 16 }}>file_upload</i>
            Excel / CSV'den Aktar
          </button>
        )}
      </div>

      {importOpen && editable && (
        <ImportPanel
          detail={detail}
          onApply={(rows) => {
            setGrid((current) => {
              const next = { ...current };
              for (const row of rows) {
                next[row.unitId] = {
                  ...next[row.unitId],
                  currentValue: decimalText(row.currentValue),
                  ...(row.previousValue !== null ? { previousValue: decimalText(row.previousValue) } : {}),
                };
              }
              return next;
            });
            setDirty(true);
            setImportOpen(false);
          }}
        />
      )}

      <fieldset disabled={!editable}>
        <Table
          head={
            <tr>
              <th>Daire</th>
              <th className="text-right">m²</th>
              <th className="text-right">Önceki Okuma</th>
              <th className="text-right">Son Okuma</th>
              <th className="text-right">Tüketim</th>
              {!editable && <th className="text-right">Tutar</th>}
              <th>Not</th>
            </tr>
          }
        >
          {detail.units.map((unit) => {
            const cell = grid[unit.unitId];
            const consumption = consumptionOf(unit.unitId);
            const factor = unit.factors[type];
            return (
              <tr key={unit.unitId} className={unit.isExempt ? 'text-muted' : ''}>
                <td className="font-weight-bold">
                  {unit.label}
                  {unit.isExempt && <span className="badge badge-light ml-1">Muaf</span>}
                  {factor && factor !== 1 && <span className="badge badge-light ml-1" title="Sayaç çarpanı">×{decimalText(factor)}</span>}
                </td>
                <td className="text-right sy-num">{unit.area ? quantity(unit.area) : '—'}</td>
                <td>
                  <input
                    className="form-control form-control-sm text-right sy-cell"
                    disabled={unit.isExempt}
                    value={cell?.previousValue ?? ''}
                    placeholder={decimalText(suggestions[unit.unitId] ?? 0)}
                    onChange={(e) => setCell(unit.unitId, { previousValue: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="form-control form-control-sm text-right sy-cell"
                    disabled={unit.isExempt}
                    value={cell?.currentValue ?? ''}
                    onChange={(e) => setCell(unit.unitId, { currentValue: e.target.value })}
                  />
                </td>
                <td className={`text-right sy-num${consumption !== null && consumption < 0 ? ' text-danger font-weight-bold' : ''}`}>
                  {consumption === null ? (unit.isExempt ? '—' : <span className="text-muted small">tahmin</span>) : quantity(consumption)}
                </td>
                {!editable && (
                  <td className="text-right sy-num">
                    {detail.readings[type]?.[unit.unitId] ? (
                      money(detail.readings[type]![unit.unitId].amountMinor)
                    ) : (
                      // Tahmin edilen dairenin tutarı okuma satırında tutulmaz; dökümü 4. adımda
                      <span className="text-muted small" title="Tahmini tutar Önizleme adımında">—</span>
                    )}
                  </td>
                )}
                <td>
                  <input
                    className="form-control form-control-sm"
                    disabled={unit.isExempt}
                    value={cell?.note ?? ''}
                    onChange={(e) => setCell(unit.unitId, { note: e.target.value })}
                  />
                </td>
              </tr>
            );
          })}
        </Table>
      </fieldset>

      <div className="card-footer d-flex align-items-center flex-wrap" style={{ gap: '.5rem' }}>
        <small className="text-muted flex">
          Önceki okuma boşsa gri öneri (son onaylı dönemin son okuması) kullanılır. Son okuması boş bırakılan
          daire site ortalaması (+ ceza) ile tahmin edilir.
        </small>
        {save.error && <ErrorBox error={save.error} />}
        {save.isSuccess && !dirty && (
          <span className="text-success small">
            {save.data.saved} okuma kaydedildi{save.data.removed > 0 ? `, ${save.data.removed} silindi` : ''}.
          </span>
        )}
        {editable && (
          <button type="button" className="btn btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Kaydediliyor...' : `${METER_TYPE_LABELS[type]} Okumalarını Kaydet`}
          </button>
        )}
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={() => {
            if (dirty && !window.confirm('Kaydedilmemiş okumalar var. Yine de önizlemeye geçilsin mi?')) return;
            onNext();
          }}
        >
          Önizlemeye Geç
        </button>
      </div>
    </Card>
  );
}

/** Excel'den yapıştırma ya da CSV dosyası — ayrıştırma tarayıcıda yapılır, kayıt "Kaydet" ile */
function ImportPanel({
  detail,
  onApply,
}: {
  detail: DistributionDetail;
  onApply: (rows: ReturnType<typeof parseReadingSheet>['rows']) => void;
}) {
  const [text, setText] = useState('');
  const result = useMemo(
    () =>
      text.trim()
        ? parseReadingSheet(
            text,
            detail.units.filter((u) => !u.isExempt).map((u) => ({ unitId: u.unitId, blockName: u.blockName, doorNumber: u.doorNumber })),
          )
        : null,
    [text, detail.units],
  );

  async function readFile(file: File) {
    setText(await readTextFile(file));
  }

  return (
    <div className="card-body border-top sy-import">
      <div className="d-flex flex-wrap align-items-center mb-2" style={{ gap: '.75rem' }}>
        <strong>Okuma listesini aktar</strong>
        <label className="btn btn-outline-secondary btn-sm mb-0">
          CSV dosyası seç
          <input
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
        </label>
        <small className="text-muted">
          ya da Excel'de satırları seçip aşağıya yapıştırın. Başlıklar: <code>Blok</code>, <code>Daire</code>,{' '}
          <code>Önceki Okuma</code> (isteğe bağlı), <code>Son Okuma</code>.
        </small>
      </div>
      <textarea
        className="form-control mb-2"
        rows={5}
        style={{ fontFamily: 'monospace', fontSize: 12 }}
        placeholder={'Blok\tDaire\tSon Okuma\nA Blok\t1\t1250,5'}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {result && (
        <>
          {result.errors.length > 0 && (
            <div className="alert alert-warning py-2 mb-2">
              <strong>{result.errors.length} satır aktarılamayacak:</strong>
              <ul className="mb-0 pl-3">
                {result.errors.slice(0, 8).map((error) => (
                  <li key={error}>{error}</li>
                ))}
                {result.errors.length > 8 && <li>… ve {result.errors.length - 8} satır daha</li>}
              </ul>
            </div>
          )}
          <div className="d-flex align-items-center justify-content-end" style={{ gap: '.75rem' }}>
            <span className="text-muted small">{result.rows.length} daire eşleşti</span>
            <button type="button" className="btn btn-primary btn-sm" disabled={result.rows.length === 0} onClick={() => onApply(result.rows)}>
              Tabloya Aktar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------- 4. önizleme ve onay

interface Preview {
  rows: {
    unitId: string;
    label: string;
    personId: string | null;
    personName: string;
    liability: 'OWNER' | 'TENANT' | 'NONE';
    amountMinor: number;
    lines: { type: MeterType; label: string; consumption: number; amountMinor: number; estimated: boolean }[];
  }[];
  totalMinor: number;
  byType: Partial<Record<MeterType, number>>;
  commonConsumption: Partial<Record<MeterType, number>>;
  unitCount: number;
  warnings: string[];
  blockers: string[];
}

function PreviewStep({
  detail,
  canApprove,
  refresh,
}: {
  detail: DistributionDetail;
  canApprove: boolean;
  refresh: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['meters', 'preview', detail.id],
    queryFn: () => api.get<Preview>(`/meters/distributions/${detail.id}/preview`),
  });

  const approve = useMutation({
    mutationFn: () => api.post<{ documentCount: number; totalMinor: number }>(`/meters/distributions/${detail.id}/approve`),
    onSuccess: () => {
      void refresh();
    },
  });
  const revert = useMutation({
    mutationFn: () => api.post<{ cancelled: number }>(`/meters/distributions/${detail.id}/revert`),
    onSuccess: () => {
      approve.reset();
      void refresh();
    },
  });

  if (isLoading) return <Loading label="Dağıtım hesaplanıyor..." />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const types = METER_TYPE_ORDER.filter((type) => (data.byType[type] ?? 0) > 0);
  const typeTotal = (row: Preview['rows'][number], type: MeterType) =>
    row.lines.filter((l) => l.type === type).reduce((acc, l) => acc + l.amountMinor, 0);
  const draft = detail.status === 'DRAFT';

  return (
    <>
      <div className="row mb-4">
        <div className="col-sm-6 col-xl-3 mb-3 mb-xl-0">
          <div className="card card-shadow mb-0 h-100">
            <div className="card-body">
              <div className="sy-stat__label">Dağıtılan Toplam</div>
              <div className="sy-stat__value sy-num text-primary">{money(data.totalMinor)}</div>
            </div>
          </div>
        </div>
        <div className="col-sm-6 col-xl-3 mb-3 mb-xl-0">
          <div className="card card-shadow mb-0 h-100">
            <div className="card-body">
              <div className="sy-stat__label">Borçlandırılacak Daire</div>
              <div className="sy-stat__value sy-num">{data.unitCount}</div>
            </div>
          </div>
        </div>
        {types.slice(0, 2).map((type) => (
          <div className="col-sm-6 col-xl-3 mb-3 mb-xl-0" key={type}>
            <div className="card card-shadow mb-0 h-100">
              <div className="card-body">
                <div className="sy-stat__label">{METER_TYPE_LABELS[type]}</div>
                <div className="sy-stat__value sy-num">{money(data.byType[type])}</div>
                {(data.commonConsumption[type] ?? 0) > 0 && (
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    Ortak tüketim {quantity(data.commonConsumption[type])} {METER_UNITS[type]}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {data.blockers.length > 0 && draft && (
        <div className="alert alert-danger">
          <strong>Onaylanamaz:</strong>
          <ul className="mb-0 pl-3">
            {data.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}
      {data.warnings.length > 0 && (
        <div className="alert alert-warning">
          <strong>Uyarılar</strong>
          <ul className="mb-0 pl-3">
            {data.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <Card
        title="Daire Bazında Dağılım"
        actions={<span className="text-muted small">Satıra tıklayınca kalem ayrıntısı açılır</span>}
      >
        {data.rows.length === 0 ? (
          <EmptyState message="Dağıtılacak tutar yok. Ana sayaç faturası ve okumaları kontrol edin." icon="av_timer" />
        ) : (
          <Table
            head={
              <tr>
                <th>Daire</th>
                <th>Borçlu</th>
                {types.map((type) => (
                  <th key={type} className="text-right">
                    {METER_TYPE_LABELS[type]}
                  </th>
                ))}
                <th className="text-right">Toplam</th>
              </tr>
            }
          >
            {data.rows.map((row) => (
              <FragmentRow
                key={row.unitId}
                row={row}
                types={types}
                typeTotal={typeTotal}
                open={expanded === row.unitId}
                onToggle={() => setExpanded(expanded === row.unitId ? null : row.unitId)}
              />
            ))}
            <tr className="font-weight-bold">
              <td colSpan={2} className="text-right">
                Toplam
              </td>
              {types.map((type) => (
                <td key={type} className="text-right sy-num">
                  {money(data.byType[type])}
                </td>
              ))}
              <td className="text-right sy-num">{money(data.totalMinor)}</td>
            </tr>
          </Table>
        )}

        <div className="card-footer d-flex align-items-center justify-content-end flex-wrap" style={{ gap: '.5rem' }}>
          {approve.error && <ErrorBox error={approve.error} />}
          {revert.error && <ErrorBox error={revert.error} />}
          {approve.isSuccess && (
            <SuccessBox>
              Dağıtım onaylandı: {approve.data.documentCount} evrak, {money(approve.data.totalMinor)} carilere işlendi.
            </SuccessBox>
          )}
          {revert.isSuccess && <SuccessBox>Onay geri alındı: {revert.data.cancelled} evrak iptal edildi.</SuccessBox>}

          {canApprove && draft && (
            <button
              type="button"
              className="btn btn-success"
              disabled={data.blockers.length > 0 || approve.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `${data.unitCount} daireye toplam ${money(data.totalMinor)} borç yazılacak. Onaylıyor musunuz?`,
                  )
                ) {
                  approve.mutate();
                }
              }}
            >
              {approve.isPending ? 'Onaylanıyor...' : 'Onayla ve Evrakları Oluştur'}
            </button>
          )}
          {canApprove && detail.status === 'APPROVED' && (
            <button
              type="button"
              className="btn btn-outline-danger"
              disabled={revert.isPending}
              onClick={() => {
                if (window.confirm('Bu dağıtımın tüm evrakları iptal edilip taslağa döndürülecek. Emin misiniz?')) {
                  revert.mutate();
                }
              }}
            >
              Onayı Geri Al
            </button>
          )}
          {!canApprove && draft && (
            <span className="text-muted small">Onay yetkisi yalnızca yönetici ve muhasebededir.</span>
          )}
        </div>
      </Card>
    </>
  );
}

function FragmentRow({
  row,
  types,
  typeTotal,
  open,
  onToggle,
}: {
  row: Preview['rows'][number];
  types: MeterType[];
  typeTotal: (row: Preview['rows'][number], type: MeterType) => number;
  open: boolean;
  onToggle: () => void;
}) {
  const estimated = row.lines.some((l) => l.estimated);
  return (
    <>
      <tr style={{ cursor: 'pointer' }} onClick={onToggle}>
        <td className="font-weight-bold">
          <i className="material-icons text-muted" style={{ fontSize: 16, verticalAlign: -3 }}>
            {open ? 'expand_less' : 'expand_more'}
          </i>
          {row.label}
          {estimated && (
            <span className="badge badge-warning ml-1" title="Okuması olmayan tür tahmin edildi">
              tahmini
            </span>
          )}
        </td>
        <td>
          {row.personName}
          {row.liability !== 'NONE' && (
            <span className={`badge ml-1 ${row.liability === 'OWNER' ? 'badge-primary' : 'badge-purple'}`}>
              {row.liability === 'OWNER' ? 'M' : 'K'}
            </span>
          )}
        </td>
        {types.map((type) => (
          <td key={type} className="text-right sy-num">
            {money(typeTotal(row, type))}
          </td>
        ))}
        <td className="text-right sy-num font-weight-bold">{money(row.amountMinor)}</td>
      </tr>
      {open && (
        <tr className="sy-subrow">
          <td colSpan={types.length + 3}>
            <table className="table table-sm mb-0">
              <tbody>
                {row.lines.map((line, index) => (
                  <tr key={index}>
                    <td>{line.label}</td>
                    <td className="text-right text-muted sy-num">
                      {line.consumption > 0 ? `${quantity(line.consumption)} ${METER_UNITS[line.type]}` : ''}
                      {line.estimated && ' (tahmin)'}
                    </td>
                    <td className="text-right sy-num" style={{ width: 140 }}>
                      {money(line.amountMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}
