'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TICKET_CHANNEL_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_TYPE_COLORS,
  TICKET_TYPE_LABELS,
  ticketSchema,
  type TicketInput,
} from '@sy/shared';
import { api } from '@/lib/api';
import { ErrorBox } from './ui';

/** İş takibi ekranlarının ortak tipleri ve parçaları */

export type TicketStatus = keyof typeof TICKET_STATUS_LABELS;
export type TicketType = keyof typeof TICKET_TYPE_LABELS;
export type TicketPriority = keyof typeof TICKET_PRIORITY_LABELS;
export type TicketChannel = keyof typeof TICKET_CHANNEL_LABELS;

export interface TicketCard {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  requestType: TicketType;
  priority: TicketPriority;
  channel: TicketChannel;
  date: string;
  dueDate: string | null;
  completedAt: string | null;
  boardOrder: number;
  area: string | null;
  overdue: boolean;
  person: { id: string; fullName: string } | null;
  unit: { id: string; label: string } | null;
  assignee: { id: string; fullName: string } | null;
  department: { id: string; name: string } | null;
  commentCount: number;
  expenseCount: number;
}

export interface TicketMeta {
  departments: { id: string; name: string; isActive: boolean }[];
  assignees: { id: string; fullName: string; role: string }[];
}

/** Kolon başlığı renkleri — iş akışında soldan sağa ilerleyiş */
export const STATUS_COLORS: Record<TicketStatus, string> = {
  WAITING: '#939FAD',
  REVIEWING: '#4B98CF',
  AWAITING_REPLY: '#E3AA75',
  FORWARDED: '#5163C5',
  PLANNED: '#346384',
  IN_PROGRESS: '#EA4C89',
  POSTPONED: '#D32F2F',
  COMPLETED: '#4EB4A5',
};

const PRIORITY_TONE: Record<TicketPriority, string> = {
  LOW: 'badge-light',
  NORMAL: 'badge-secondary',
  HIGH: 'badge-warning',
  URGENT: 'badge-danger',
};

export function useTicketMeta() {
  return useQuery({
    queryKey: ['tickets', 'meta'],
    queryFn: () => api.get<TicketMeta>('/tickets/meta'),
    staleTime: 5 * 60_000,
  });
}

export function TypeBadge({ type }: { type: TicketType }) {
  return (
    <span className="badge sy-ticket-type" style={{ background: TICKET_TYPE_COLORS[type] }}>
      {TICKET_TYPE_LABELS[type]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  if (priority === 'NORMAL') return null;
  return <span className={`badge ${PRIORITY_TONE[priority]}`}>{TICKET_PRIORITY_LABELS[priority]}</span>;
}

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className="badge sy-ticket-type" style={{ background: STATUS_COLORS[status] }}>
      {TICKET_STATUS_LABELS[status]}
    </span>
  );
}

// ---------------------------------------------------------------- talep formu

interface UnitOption {
  id: string;
  doorNumber: string;
  block: { id: string; name: string } | null;
  owner: { id: string; firstName: string; lastName: string } | null;
  tenant: { id: string; firstName: string; lastName: string } | null;
}

interface PersonOption {
  id: string;
  fullName: string;
}

export interface TicketFormValue {
  subject: string;
  description: string;
  requestType: TicketType;
  priority: TicketPriority;
  channel: TicketChannel;
  personId: string;
  unitId: string;
  departmentId: string;
  assigneeId: string;
  area: string;
  dueDate: string;
}

export const EMPTY_TICKET: TicketFormValue = {
  subject: '',
  description: '',
  requestType: 'FAULT',
  priority: 'NORMAL',
  channel: 'PHONE',
  personId: '',
  unitId: '',
  departmentId: '',
  assigneeId: '',
  area: '',
  dueDate: '',
};

/** Form değerini API gövdesine çevirir; boş seçimler `null` olur */
function toPayload(value: TicketFormValue) {
  return {
    ...value,
    personId: value.personId || null,
    unitId: value.unitId || null,
    departmentId: value.departmentId || null,
    assigneeId: value.assigneeId || null,
    area: value.area || undefined,
    dueDate: value.dueDate || null,
  };
}

/**
 * Yeni talep ve talep düzenleme formu.
 * Doğrulama API ile **aynı** `ticketSchema` üzerinden yapılır.
 */
export function TicketForm({
  initial = EMPTY_TICKET,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: TicketFormValue;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (payload: TicketInput) => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState<TicketFormValue>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { data: meta } = useTicketMeta();

  const { data: units } = useQuery({
    queryKey: ['units', 'options'],
    queryFn: () => api.get<{ items: UnitOption[] }>('/units?pageSize=200'),
    staleTime: 5 * 60_000,
  });
  const { data: people } = useQuery({
    queryKey: ['people', 'options'],
    queryFn: () => api.get<{ items: PersonOption[] }>('/people?pageSize=200'),
    staleTime: 5 * 60_000,
  });

  useEffect(() => setValue(initial), [initial]);

  function set<K extends keyof TicketFormValue>(key: K, next: TicketFormValue[K]) {
    setValue((current) => ({ ...current, [key]: next }));
    // Düzeltilen alanın hatası bir sonraki gönderimi beklemesin
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
  }

  /** Daire seçilince, kişi boşsa oturan kişi (önce kiracı) önerilir */
  function selectUnit(unitId: string) {
    const unit = units?.items.find((u) => u.id === unitId);
    const occupant = unit?.tenant ?? unit?.owner;
    setValue((current) => ({
      ...current,
      unitId,
      personId: current.personId || occupant?.id || '',
    }));
  }

  function submit() {
    const result = ticketSchema.safeParse(toPayload(value));
    if (!result.success) {
      setFieldErrors(
        Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message])),
      );
      return;
    }
    setFieldErrors({});
    onSubmit(result.data);
  }

  const invalid = (field: string) => (fieldErrors[field] ? ' is-invalid' : '');

  return (
    <div>
      <div className="form-group">
        <label className="form-label">Konu</label>
        <input
          className={`form-control${invalid('subject')}`}
          value={value.subject}
          onChange={(event) => set('subject', event.target.value)}
          placeholder="Asansör arızası"
        />
        {fieldErrors.subject && <div className="invalid-feedback">{fieldErrors.subject}</div>}
      </div>

      <div className="form-group">
        <label className="form-label">Açıklama</label>
        <textarea
          className={`form-control${invalid('description')}`}
          rows={4}
          value={value.description}
          onChange={(event) => set('description', event.target.value)}
        />
        {fieldErrors.description && <div className="invalid-feedback">{fieldErrors.description}</div>}
      </div>

      <div className="row">
        <div className="col-md-4 form-group">
          <label className="form-label">Talep Tipi</label>
          <select
            className="custom-select"
            value={value.requestType}
            onChange={(event) => set('requestType', event.target.value as TicketType)}
          >
            {Object.entries(TICKET_TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-4 form-group">
          <label className="form-label">Öncelik</label>
          <select
            className="custom-select"
            value={value.priority}
            onChange={(event) => set('priority', event.target.value as TicketPriority)}
          >
            {Object.entries(TICKET_PRIORITY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-4 form-group">
          <label className="form-label">Geliş Kanalı</label>
          <select
            className="custom-select"
            value={value.channel}
            onChange={(event) => set('channel', event.target.value as TicketChannel)}
          >
            {Object.entries(TICKET_CHANNEL_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="row">
        <div className="col-md-6 form-group">
          <label className="form-label">Daire</label>
          <select
            className="custom-select"
            value={value.unitId}
            onChange={(event) => selectUnit(event.target.value)}
          >
            <option value="">Genel alan / daire yok</option>
            {units?.items.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.block ? `${unit.block.name} / ${unit.doorNumber}` : unit.doorNumber}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-6 form-group">
          <label className="form-label">Talep Eden</label>
          <select
            className="custom-select"
            value={value.personId}
            onChange={(event) => set('personId', event.target.value)}
          >
            <option value="">Seçiniz</option>
            {people?.items.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="row">
        <div className="col-md-6 form-group">
          <label className="form-label">Departman</label>
          <select
            className="custom-select"
            value={value.departmentId}
            onChange={(event) => set('departmentId', event.target.value)}
          >
            <option value="">Seçiniz</option>
            {meta?.departments
              .filter((department) => department.isActive || department.id === value.departmentId)
              .map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
          </select>
        </div>
        <div className="col-md-6 form-group">
          <label className="form-label">Sorumlu</label>
          <select
            className="custom-select"
            value={value.assigneeId}
            onChange={(event) => set('assigneeId', event.target.value)}
          >
            <option value="">Atanmadı</option>
            {meta?.assignees.map((assignee) => (
              <option key={assignee.id} value={assignee.id}>
                {assignee.fullName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="row">
        <div className="col-md-6 form-group">
          <label className="form-label">İlgili Alan</label>
          <input
            className="form-control"
            value={value.area}
            onChange={(event) => set('area', event.target.value)}
            placeholder="Asansör, otopark, çatı..."
          />
        </div>
        <div className="col-md-6 form-group">
          <label className="form-label">Hedef Tarih</label>
          <input
            type="date"
            className="form-control"
            value={value.dueDate}
            onChange={(event) => set('dueDate', event.target.value)}
          />
        </div>
      </div>

      {error ? <ErrorBox error={error} /> : null}

      <div className="d-flex justify-content-end" style={{ gap: '.5rem' }}>
        {onCancel && (
          <button type="button" className="btn btn-outline-secondary" onClick={onCancel}>
            Vazgeç
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>
          {pending ? 'Kaydediliyor...' : submitLabel}
        </button>
      </div>
    </div>
  );
}
