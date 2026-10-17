'use client';

import { useQuery } from '@tanstack/react-query';
import { METER_TYPE_LABELS } from '@sy/shared';
import { api } from '@/lib/api';
import { moneyInput } from '@/lib/format';

/** Sayaç paylaşımı ekranlarının ortak tipleri ve parçaları */

export type MeterType = keyof typeof METER_TYPE_LABELS;
export type DistributionStatus = 'DRAFT' | 'APPROVED' | 'CANCELLED';

export const METER_TYPE_ORDER: MeterType[] = ['FUEL', 'HOT_WATER', 'COLD_WATER', 'COOLING', 'ELECTRIC'];

/** Okuma birimi — tablo başlıklarında */
export const METER_UNITS: Record<MeterType, string> = {
  FUEL: 'birim',
  HOT_WATER: 'm³',
  COLD_WATER: 'm³',
  COOLING: 'kWh',
  ELECTRIC: 'kWh',
};

export const STATUS_LABELS: Record<DistributionStatus, { label: string; tone: string }> = {
  DRAFT: { label: 'Taslak', tone: 'badge-secondary' },
  APPROVED: { label: 'Onaylı', tone: 'badge-success' },
  CANCELLED: { label: 'İptal', tone: 'badge-danger' },
};

export function StatusBadge({ status }: { status: DistributionStatus }) {
  const { label, tone } = STATUS_LABELS[status];
  return <span className={`badge ${tone}`}>{label}</span>;
}

export interface MainReading {
  type: MeterType;
  readingDate: string;
  previousValue: number;
  currentValue: number;
  invoiceAmountMinor: number;
  skip: boolean;
  /** Daha önce kaydedildi mi (kaydedilmemiş türler öneriyle gelir) */
  saved: boolean;
}

export interface UnitReading {
  previousValue: number;
  currentValue: number;
  consumption: number;
  amountMinor: number;
  note: string | null;
}

export interface DistributionDetail {
  id: string;
  status: DistributionStatus;
  approvedAt: string | null;
  totalMinor: number;
  period: string;
  periodLabel: string;
  documentDate: string;
  dueDate: string;
  name: string | null;
  categoryId: string | null;
  documentNote: string | null;
  applyLateFee: boolean;
  lateFeeStartDate: string | null;
  waterInletTemp: number;
  waterOutletTemp: number;
  fuelLowerHeatValue: number;
  waterPricingMethod: 'UNIT_PRICE' | 'INVOICE_TOTAL';
  waterUnitPriceMinor: number;
  penaltyPercent: number;
  fixedSharePercent: number;
  mainReadings: MainReading[];
  units: {
    unitId: string;
    label: string;
    blockName: string | null;
    doorNumber: string;
    area: number | null;
    isExempt: boolean;
    factors: Partial<Record<MeterType, number>>;
  }[];
  readings: Partial<Record<MeterType, Record<string, UnitReading>>>;
  suggestions: Partial<Record<MeterType, Record<string, number>>>;
  suggestedFrom: string | null;
}

/** Evrak bilgileri (1. adım) */
export interface DocumentFieldsValue {
  period: string;
  documentDate: string;
  dueDate: string;
  name: string;
  categoryId: string;
  documentNote: string;
  applyLateFee: boolean;
  lateFeeStartDate: string;
}

/** Dağıtım parametreleri (2. adım) */
export interface ParamsValue {
  waterInletTemp: string;
  waterOutletTemp: string;
  fuelLowerHeatValue: string;
  waterPricingMethod: 'UNIT_PRICE' | 'INVOICE_TOTAL';
  waterUnitPrice: string;
  penaltyPercent: string;
  fixedSharePercent: string;
}

export const DEFAULT_PARAMS: ParamsValue = {
  waterInletTemp: '15',
  waterOutletTemp: '50',
  fuelLowerHeatValue: '8250',
  waterPricingMethod: 'UNIT_PRICE',
  waterUnitPrice: '',
  penaltyPercent: '0',
  fixedSharePercent: '0',
};

const day = (value: string | null | undefined) => (value ? value.slice(0, 10) : '');

/** Sayıyı Türkçe ondalıkla düzenlenebilir metne çevirir: 8250.5 → "8250,5" */
export const decimalText = (value: number | null | undefined) =>
  value === null || value === undefined ? '' : String(value).replace('.', ',');

/** "8250,5" → 8250.5 (API Türkçe biçimi de kabul eder; burada form içi hesap için) */
export function parseLocal(text: string): number | null {
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  if (normalized.trim() === '') return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function documentFieldsOf(detail: DistributionDetail): DocumentFieldsValue {
  return {
    period: detail.period,
    documentDate: day(detail.documentDate),
    dueDate: day(detail.dueDate),
    name: detail.name ?? '',
    categoryId: detail.categoryId ?? '',
    documentNote: detail.documentNote ?? '',
    applyLateFee: detail.applyLateFee,
    lateFeeStartDate: day(detail.lateFeeStartDate),
  };
}

export function paramsOf(detail: DistributionDetail): ParamsValue {
  return {
    waterInletTemp: decimalText(detail.waterInletTemp),
    waterOutletTemp: decimalText(detail.waterOutletTemp),
    fuelLowerHeatValue: decimalText(detail.fuelLowerHeatValue),
    waterPricingMethod: detail.waterPricingMethod,
    waterUnitPrice: moneyInput(detail.waterUnitPriceMinor),
    penaltyPercent: decimalText(detail.penaltyPercent),
    fixedSharePercent: decimalText(detail.fixedSharePercent),
  };
}

/** PUT/POST /meters/distributions gövdesi — evrak bilgileri ve parametreler birlikte gider */
export function distributionPayload(doc: DocumentFieldsValue, params: ParamsValue) {
  const number = (text: string) => parseLocal(text) ?? 0;
  return {
    period: doc.period,
    documentDate: doc.documentDate,
    dueDate: doc.dueDate,
    name: doc.name || undefined,
    categoryId: doc.categoryId || null,
    documentNote: doc.documentNote || null,
    applyLateFee: doc.applyLateFee,
    lateFeeStartDate: doc.applyLateFee && doc.lateFeeStartDate ? doc.lateFeeStartDate : null,
    waterInletTemp: number(params.waterInletTemp),
    waterOutletTemp: number(params.waterOutletTemp),
    fuelLowerHeatValue: number(params.fuelLowerHeatValue),
    waterPricingMethod: params.waterPricingMethod,
    waterUnitPrice: params.waterUnitPrice || '0',
    penaltyPercent: number(params.penaltyPercent),
    fixedSharePercent: number(params.fixedSharePercent),
  };
}

export function useIncomeCategories() {
  return useQuery({
    queryKey: ['categories', 'income'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/finance/categories?kind=INCOME'),
    staleTime: 5 * 60_000,
  });
}

/** 1. adım: oluşacak evrak bilgileri */
export function DocumentFields({
  value,
  onChange,
  disabled,
}: {
  value: DocumentFieldsValue;
  onChange: (next: DocumentFieldsValue) => void;
  disabled?: boolean;
}) {
  const { data: categories } = useIncomeCategories();
  const set = <K extends keyof DocumentFieldsValue>(key: K, next: DocumentFieldsValue[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <fieldset disabled={disabled}>
      <div className="row">
        <div className="col-md-4 form-group">
          <label className="form-label">Dağıtım Dönemi</label>
          <input
            type="month"
            className="form-control"
            value={value.period}
            onChange={(event) => set('period', event.target.value)}
          />
        </div>
        <div className="col-md-4 form-group">
          <label className="form-label">Evrak Tarihi</label>
          <input
            type="date"
            className="form-control"
            value={value.documentDate}
            onChange={(event) => set('documentDate', event.target.value)}
          />
        </div>
        <div className="col-md-4 form-group">
          <label className="form-label">Son Ödeme Tarihi</label>
          <input
            type="date"
            className="form-control"
            value={value.dueDate}
            onChange={(event) => set('dueDate', event.target.value)}
          />
        </div>
      </div>

      <div className="row">
        <div className="col-md-6 form-group">
          <label className="form-label">Dağıtım Adı</label>
          <input
            className="form-control"
            value={value.name}
            onChange={(event) => set('name', event.target.value)}
            placeholder="Ağustos 2026 ısınma ve su payı"
          />
        </div>
        <div className="col-md-6 form-group">
          <label className="form-label">Gelir Kategorisi</label>
          <select
            className="custom-select"
            value={value.categoryId}
            onChange={(event) => set('categoryId', event.target.value)}
          >
            <option value="">Seçiniz</option>
            {categories?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Evrak Açıklaması</label>
        <input
          className="form-control"
          value={value.documentNote}
          onChange={(event) => set('documentNote', event.target.value)}
          placeholder="Boş bırakılırsa dağıtım adı kullanılır"
        />
      </div>

      <div className="row align-items-end">
        <div className="col-md-6 form-group">
          <div className="custom-control custom-checkbox">
            <input
              type="checkbox"
              className="custom-control-input"
              id="applyLateFee"
              checked={value.applyLateFee}
              onChange={(event) => set('applyLateFee', event.target.checked)}
            />
            <label className="custom-control-label" htmlFor="applyLateFee">
              Gecikme tazminatı uygula
            </label>
          </div>
          <small className="text-muted">
            Kapalıysa bu dağıtımın borçlarına site genelindeki tazminat işlenmez.
          </small>
        </div>
        {value.applyLateFee && (
          <div className="col-md-6 form-group">
            <label className="form-label">Tazminat Başlama Tarihi</label>
            <input
              type="date"
              className="form-control"
              value={value.lateFeeStartDate}
              onChange={(event) => set('lateFeeStartDate', event.target.value)}
            />
            <small className="text-muted">Boşsa son ödeme tarihinden itibaren sayılır.</small>
          </div>
        )}
      </div>
    </fieldset>
  );
}
