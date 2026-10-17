'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  INCIDENT_CATEGORY_LABELS,
  INCIDENT_SEVERITY_LABELS,
  LOST_ITEM_STATUS_LABELS,
  securityIncidentSchema,
  type SecurityIncidentInput,
} from '@sy/shared';
import { api } from '@/lib/api';
import { dateTimeInput } from '@/lib/format';
import { ErrorBox } from './ui';

/** Güvenlik ekranlarının ortak tipleri ve parçaları */

export type IncidentCategory = keyof typeof INCIDENT_CATEGORY_LABELS;
export type IncidentSeverity = keyof typeof INCIDENT_SEVERITY_LABELS;
export type LostItemStatus = keyof typeof LOST_ITEM_STATUS_LABELS;

export interface Labelled {
  id: string;
  label: string;
}

export interface NamedRef {
  id: string;
  fullName: string;
}

export interface SecuritySummary {
  visitorsInside: number;
  visitorsOverstay: number;
  visitorsToday: number;
  incidentsLast30Days: number;
  highIncidentsLast30Days: number;
  lostReports: number;
  lostInCustody: number;
  lostAwaitingDelivery: number;
}

export interface Visitor {
  id: string;
  visitorName: string;
  visitorPhone: string | null;
  nationalIdMasked: string | null;
  plate: string | null;
  vehicle: { owner: string; status: string | null } | null;
  unit: Labelled | null;
  hostPerson: NamedRef | null;
  purpose: string | null;
  note: string | null;
  enteredAt: string;
  exitedAt: string | null;
  minutes: number;
  overstay: boolean;
}

export interface IncidentRow {
  id: string;
  date: string;
  title: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  excerpt: string;
  person: NamedRef | null;
  unit: Labelled | null;
  staff: NamedRef | null;
}

export interface LostItem {
  id: string;
  number: number;
  status: LostItemStatus;
  itemName: string;
  description: string | null;
  location: string | null;
  lostAt: string | null;
  foundAt: string | null;
  loserName: string | null;
  loserPhone: string | null;
  finderName: string | null;
  finderPhone: string | null;
  custodianName: string | null;
  custodianRole: string | null;
  deliveredTo: string | null;
  deliveredAt: string | null;
  disposedAt: string | null;
  disposalNote: string | null;
  daysInCustody: number | null;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageCount: number;
}

const SEVERITY_TONE: Record<IncidentSeverity, string> = {
  LOW: 'badge-secondary',
  MEDIUM: 'badge-warning',
  HIGH: 'badge-danger',
};

export function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  return <span className={`badge ${SEVERITY_TONE[severity]}`}>{INCIDENT_SEVERITY_LABELS[severity]}</span>;
}

/** Yaşam döngüsünde soldan sağa ilerleyiş; imha gri (kapanmış) */
export const LOST_STATUS_COLORS: Record<LostItemStatus, string> = {
  LOST: '#E3AA75',
  FOUND: '#4B98CF',
  CLAIMED: '#5163C5',
  DELIVERED: '#4EB4A5',
  DISPOSED: '#939FAD',
};

export function LostStatusBadge({ status }: { status: LostItemStatus }) {
  return (
    <span className="badge sy-ticket-type" style={{ background: LOST_STATUS_COLORS[status] }}>
      {LOST_ITEM_STATUS_LABELS[status]}
    </span>
  );
}

// ---------------------------------------------------------------- seçenekler

interface UnitOption {
  id: string;
  doorNumber: string;
  block: { id: string; name: string } | null;
  owner: { id: string; firstName: string; lastName: string } | null;
  tenant: { id: string; firstName: string; lastName: string } | null;
}

export function unitOptionLabel(unit: UnitOption) {
  return unit.block ? `${unit.block.name} / ${unit.doorNumber}` : unit.doorNumber;
}

export function useUnitOptions() {
  return useQuery({
    queryKey: ['units', 'options'],
    queryFn: () => api.get<{ items: UnitOption[] }>('/units?pageSize=200'),
    staleTime: 5 * 60_000,
  });
}

export function usePeopleOptions() {
  return useQuery({
    queryKey: ['people', 'options'],
    queryFn: () => api.get<{ items: NamedRef[] }>('/people?pageSize=200'),
    staleTime: 5 * 60_000,
  });
}

export function useSecurityMeta() {
  return useQuery({
    queryKey: ['security', 'meta'],
    queryFn: () => api.get<{ staff: (NamedRef & { role: string })[] }>('/security/meta'),
    staleTime: 5 * 60_000,
  });
}

/** Daire seçilince boşsa oturan kişi (önce kiracı) önerilir */
export function occupantOf(units: UnitOption[] | undefined, unitId: string) {
  const unit = units?.find((u) => u.id === unitId);
  return unit?.tenant ?? unit?.owner ?? null;
}

// ---------------------------------------------------------------- olay formu

export interface IncidentFormValue {
  date: string;
  title: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  staffId: string;
  personId: string;
  unitId: string;
  body: string;
}

export function emptyIncident(staffId = ''): IncidentFormValue {
  return {
    date: dateTimeInput(new Date()),
    title: '',
    category: 'OTHER',
    severity: 'LOW',
    staffId,
    personId: '',
    unitId: '',
    body: '',
  };
}

/**
 * Yeni olay ve olay düzenleme formu. Doğrulama API ile aynı
 * `securityIncidentSchema` üzerinden yapılır. Açıklama düz metindir.
 */
export function IncidentForm({
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial: IncidentFormValue;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (payload: SecurityIncidentInput) => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { data: units } = useUnitOptions();
  const { data: people } = usePeopleOptions();
  const { data: meta } = useSecurityMeta();

  useEffect(() => setValue(initial), [initial]);

  function set<K extends keyof IncidentFormValue>(key: K, next: IncidentFormValue[K]) {
    setValue((current) => ({ ...current, [key]: next }));
    setFieldErrors(({ [key]: _removed, ...rest }) => rest);
  }

  function submit() {
    const result = securityIncidentSchema.safeParse({
      ...value,
      date: value.date ? new Date(value.date) : undefined,
      staffId: value.staffId || null,
      personId: value.personId || null,
      unitId: value.unitId || null,
    });
    if (!result.success) {
      setFieldErrors(Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message])));
      return;
    }
    onSubmit(result.data);
  }

  const invalid = (field: string) => (fieldErrors[field] ? ' is-invalid' : '');

  return (
    <div>
      <div className="row">
        <div className="col-md-8 form-group">
          <label className="form-label">Başlık</label>
          <input
            className={`form-control${invalid('title')}`}
            value={value.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Otoparkta araç çizildi"
          />
          {fieldErrors.title && <div className="invalid-feedback">{fieldErrors.title}</div>}
        </div>
        <div className="col-md-4 form-group">
          <label className="form-label">Olay Zamanı</label>
          <input
            type="datetime-local"
            className={`form-control${invalid('date')}`}
            value={value.date}
            max={dateTimeInput(new Date())}
            onChange={(e) => set('date', e.target.value)}
          />
          {fieldErrors.date && <div className="invalid-feedback">{fieldErrors.date}</div>}
        </div>
      </div>

      <div className="row">
        <div className="col-md-4 form-group">
          <label className="form-label">Kategori</label>
          <select className="custom-select" value={value.category} onChange={(e) => set('category', e.target.value as IncidentCategory)}>
            {Object.entries(INCIDENT_CATEGORY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-4 form-group">
          <label className="form-label">Önem</label>
          <select className="custom-select" value={value.severity} onChange={(e) => set('severity', e.target.value as IncidentSeverity)}>
            {Object.entries(INCIDENT_SEVERITY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-4 form-group">
          <label className="form-label">Görevli</label>
          <select className="custom-select" value={value.staffId} onChange={(e) => set('staffId', e.target.value)}>
            <option value="">— Seçilmedi —</option>
            {meta?.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="row">
        <div className="col-md-6 form-group">
          <label className="form-label">İlgili Daire</label>
          <select
            className={`custom-select${invalid('unitId')}`}
            value={value.unitId}
            onChange={(e) => {
              const unitId = e.target.value;
              const occupant = occupantOf(units?.items, unitId);
              setValue((current) => ({ ...current, unitId, personId: current.personId || occupant?.id || '' }));
            }}
          >
            <option value="">— Yok —</option>
            {units?.items.map((u) => (
              <option key={u.id} value={u.id}>
                {unitOptionLabel(u)}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-6 form-group">
          <label className="form-label">İlgili Kişi</label>
          <select className="custom-select" value={value.personId} onChange={(e) => set('personId', e.target.value)}>
            <option value="">— Yok —</option>
            {people?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Olay Açıklaması</label>
        <textarea
          className={`form-control${invalid('body')}`}
          rows={6}
          value={value.body}
          onChange={(e) => set('body', e.target.value)}
          placeholder="Ne oldu, nerede, kimler vardı, hangi önlem alındı?"
        />
        {fieldErrors.body && <div className="invalid-feedback">{fieldErrors.body}</div>}
      </div>

      {Boolean(error) && <ErrorBox error={error} />}
      <div className="d-flex" style={{ gap: '.5rem' }}>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>
          {pending ? 'Kaydediliyor...' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-light" onClick={onCancel}>
            Vazgeç
          </button>
        )}
      </div>
    </div>
  );
}
