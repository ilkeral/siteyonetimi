'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { occupancySchema, personSchema, unitSchema, type PersonInput } from '@sy/shared';
import type { z } from 'zod';
import { api } from '@/lib/api';
import { todayInput } from '@/lib/format';
import { ErrorBox } from './ui';

/**
 * Kişi / daire formları. Doğrulama API ile AYNI Zod şemalarıyla yapılır
 * (`personSchema`, `occupancySchema`, `unitSchema`); sunucu yine de kendi
 * kurallarını (zorunlu alan ayarı, tarih çakışması, daire no tekrarı) uygular.
 */

type Errors = Record<string, string>;

function issuesToErrors(issues: { path: (string | number)[]; message: string }[]): Errors {
  return Object.fromEntries(issues.map((issue) => [issue.path.join('.'), issue.message]));
}

function useForm<T extends Record<string, string | boolean>>(initial: T) {
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<Errors>({});
  const set = <K extends keyof T>(key: K, next: T[K]) => {
    setValue((current) => ({ ...current, [key]: next }));
    setErrors(({ [key as string]: _removed, ...rest }) => rest);
  };
  return { value, setValue, errors, setErrors, set };
}

export function FormField({
  label,
  error,
  hint,
  required,
  className = 'form-group',
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className="form-label">
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      {children}
      {error ? (
        <div className="invalid-feedback d-block">{error}</div>
      ) : (
        hint && <small className="form-text text-muted">{hint}</small>
      )}
    </div>
  );
}

function FormButtons({ pending, label, onCancel }: { pending: boolean; label: string; onCancel?: () => void }) {
  return (
    <div className="d-flex" style={{ gap: '.5rem' }}>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Kaydediliyor...' : label}
      </button>
      {onCancel && (
        <button type="button" className="btn btn-light" onClick={onCancel}>
          Vazgeç
        </button>
      )}
    </div>
  );
}

const cls = (errors: Errors, field: string, base = 'form-control') => `${base}${errors[field] ? ' is-invalid' : ''}`;

// ---------------------------------------------------------------- kişi

export interface PersonFormValue extends Record<string, string | boolean> {
  firstName: string;
  lastName: string;
  nationalId: string;
  phone: string;
  phone2: string;
  email: string;
  birthDate: string;
  language: string;
  note: string;
  inLegalAction: boolean;
}

export const EMPTY_PERSON: PersonFormValue = {
  firstName: '',
  lastName: '',
  nationalId: '',
  phone: '',
  phone2: '',
  email: '',
  birthDate: '',
  language: 'TR',
  note: '',
  inLegalAction: false,
};

/** Kişi kartındaki kayıttan form değeri */
export function personToForm(person: {
  firstName: string;
  lastName: string;
  nationalId: string | null;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  birthDate?: string | null;
  language: string;
  note: string | null;
  inLegalAction: boolean;
}): PersonFormValue {
  return {
    firstName: person.firstName,
    lastName: person.lastName,
    nationalId: person.nationalId ?? '',
    phone: person.phone ?? '',
    phone2: person.phone2 ?? '',
    email: person.email ?? '',
    birthDate: person.birthDate ? person.birthDate.slice(0, 10) : '',
    language: person.language,
    note: person.note ?? '',
    inLegalAction: person.inLegalAction,
  };
}

/** Form değerini doğrular; geçerliyse API gövdesini, değilse alan hatalarını döndürür */
export function parsePerson(value: PersonFormValue) {
  return personSchema.safeParse({ ...value, birthDate: value.birthDate || null, note: value.note || undefined });
}

export function PersonFields({
  form,
}: {
  form: ReturnType<typeof useForm<PersonFormValue>>;
}) {
  const { value, errors, set } = form;
  return (
    <>
      <div className="row">
        <FormField label="Ad" error={errors.firstName} required className="col-md-6 form-group">
          <input className={cls(errors, 'firstName')} value={value.firstName} onChange={(e) => set('firstName', e.target.value)} />
        </FormField>
        <FormField label="Soyad" error={errors.lastName} required className="col-md-6 form-group">
          <input className={cls(errors, 'lastName')} value={value.lastName} onChange={(e) => set('lastName', e.target.value)} />
        </FormField>
      </div>
      <div className="row">
        <FormField label="Cep Telefonu" error={errors.phone} className="col-md-4 form-group" hint="5XX XXX XX XX">
          <input className={cls(errors, 'phone')} inputMode="tel" value={value.phone} onChange={(e) => set('phone', e.target.value)} />
        </FormField>
        <FormField label="2. Telefon" error={errors.phone2} className="col-md-4 form-group">
          <input className={cls(errors, 'phone2')} inputMode="tel" value={value.phone2} onChange={(e) => set('phone2', e.target.value)} />
        </FormField>
        <FormField label="E-posta" error={errors.email} className="col-md-4 form-group">
          <input className={cls(errors, 'email')} type="email" value={value.email} onChange={(e) => set('email', e.target.value)} />
        </FormField>
      </div>
      <div className="row">
        <FormField label="TC Kimlik No" error={errors.nationalId} className="col-md-4 form-group">
          <input
            className={cls(errors, 'nationalId')}
            inputMode="numeric"
            maxLength={11}
            autoComplete="off"
            value={value.nationalId}
            onChange={(e) => set('nationalId', e.target.value.replace(/\D/g, ''))}
          />
        </FormField>
        <FormField label="Doğum Tarihi" error={errors.birthDate} className="col-md-4 form-group">
          <input className={cls(errors, 'birthDate')} type="date" max={todayInput()} value={value.birthDate} onChange={(e) => set('birthDate', e.target.value)} />
        </FormField>
        <FormField label="İletişim Dili" className="col-md-4 form-group">
          <select className="custom-select" value={value.language} onChange={(e) => set('language', e.target.value)}>
            <option value="TR">Türkçe</option>
            <option value="EN">İngilizce</option>
            <option value="DE">Almanca</option>
            <option value="RU">Rusça</option>
          </select>
        </FormField>
      </div>
      <FormField label="Not" error={errors.note}>
        <textarea className={cls(errors, 'note')} rows={2} value={value.note} onChange={(e) => set('note', e.target.value)} />
      </FormField>
      <div className="custom-control custom-checkbox mb-3">
        <input
          type="checkbox"
          className="custom-control-input"
          id="person-legal"
          checked={value.inLegalAction}
          onChange={(e) => set('inLegalAction', e.target.checked)}
        />
        <label className="custom-control-label" htmlFor="person-legal">
          İcra takibinde
        </label>
      </div>
    </>
  );
}

export function usePersonForm(initial: PersonFormValue = EMPTY_PERSON) {
  return useForm<PersonFormValue>(initial);
}

export function PersonForm({
  initial,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial: PersonFormValue;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (payload: PersonInput) => void;
  onCancel?: () => void;
}) {
  const form = usePersonForm(initial);
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const result = parsePerson(form.value);
        if (!result.success) return form.setErrors(issuesToErrors(result.error.issues));
        onSubmit(result.data);
      }}
    >
      <PersonFields form={form} />
      {Boolean(error) && <ErrorBox error={error} />}
      <FormButtons pending={pending} label={submitLabel} onCancel={onCancel} />
    </form>
  );
}

// ---------------------------------------------------------------- daire seçenekleri

export interface UnitOption {
  id: string;
  doorNumber: string;
  block: { id: string; name: string } | null;
  owner: { id: string; firstName: string; lastName: string } | null;
  tenant: { id: string; firstName: string; lastName: string } | null;
}

export const unitLabel = (unit: { doorNumber: string; block: { name: string } | null }) =>
  unit.block ? `${unit.block.name} / ${unit.doorNumber}` : unit.doorNumber;

export function useUnitOptions() {
  return useQuery({
    queryKey: ['units', 'options'],
    queryFn: () => api.get<{ items: UnitOption[] }>('/units?pageSize=200'),
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------- daire ilişkisi

export type OccupancyInput = z.infer<typeof occupancySchema>;

export interface OccupancyFormValue extends Record<string, string | boolean> {
  unitId: string;
  role: string;
  startDate: string;
  bankPaymentCode: string;
}

export const EMPTY_OCCUPANCY: OccupancyFormValue = { unitId: '', role: 'OWNER', startDate: todayInput(), bankPaymentCode: '' };

export function parseOccupancy(value: OccupancyFormValue, personId: string) {
  return occupancySchema.safeParse({
    ...value,
    personId,
    bankPaymentCode: value.bankPaymentCode || undefined,
  });
}

export function OccupancyFields({
  form,
  optional,
}: {
  form: ReturnType<typeof useForm<OccupancyFormValue>>;
  /** Yeni kişi formunda daire seçimi isteğe bağlı */
  optional?: boolean;
}) {
  const { value, errors, set } = form;
  const { data: units } = useUnitOptions();
  const selected = units?.items.find((u) => u.id === value.unitId);
  const current = selected && (value.role === 'OWNER' ? selected.owner : selected.tenant);

  return (
    <div className="row">
      <FormField label="Daire" error={errors.unitId} required={!optional} className="col-md-5 form-group">
        <select className={cls(errors, 'unitId', 'custom-select')} value={value.unitId} onChange={(e) => set('unitId', e.target.value)}>
          <option value="">{optional ? '— Daire bağlama —' : '— Seçin —'}</option>
          {units?.items.map((u) => (
            <option key={u.id} value={u.id}>
              {unitLabel(u)}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Sıfat" className="col-md-3 form-group">
        <select className="custom-select" value={value.role} onChange={(e) => set('role', e.target.value)}>
          <option value="OWNER">Kat Maliki</option>
          <option value="TENANT">Kiracı</option>
        </select>
      </FormField>
      <FormField label="Giriş Tarihi" error={errors.startDate} required className="col-md-4 form-group">
        <input type="date" className={cls(errors, 'startDate')} value={value.startDate} onChange={(e) => set('startDate', e.target.value)} />
      </FormField>
      {current && (
        <div className="col-12">
          <div className="alert alert-warning py-2">
            Bu dairede şu an {value.role === 'OWNER' ? 'kat maliki' : 'kiracı'} olarak{' '}
            <strong>
              {current.firstName} {current.lastName}
            </strong>{' '}
            kayıtlı. Önce onun daire ilişkisine çıkış tarihi verin; tarihler çakışırsa kayıt reddedilir.
          </div>
        </div>
      )}
      <FormField
        label="Banka Ödeme Kodu"
        className="col-md-5 form-group"
        hint="Banka açıklamasında bu kod geçerse tahsilat otomatik eşleşir"
      >
        <input className="form-control" value={value.bankPaymentCode} onChange={(e) => set('bankPaymentCode', e.target.value)} />
      </FormField>
    </div>
  );
}

export function useOccupancyForm() {
  return useForm<OccupancyFormValue>(EMPTY_OCCUPANCY);
}

export function OccupancyForm({
  personId,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  personId: string;
  pending: boolean;
  error: unknown;
  onSubmit: (payload: OccupancyInput) => void;
  onCancel: () => void;
}) {
  const form = useOccupancyForm();
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const result = parseOccupancy(form.value, personId);
        if (!result.success) return form.setErrors(issuesToErrors(result.error.issues));
        onSubmit(result.data);
      }}
    >
      <OccupancyFields form={form} />
      {Boolean(error) && <ErrorBox error={error} />}
      <FormButtons pending={pending} label="Daireye Bağla" onCancel={onCancel} />
    </form>
  );
}

// ---------------------------------------------------------------- araç

export interface VehicleInput {
  plate: string;
  brand?: string;
  model?: string;
  color?: string;
  hgsNumber?: string;
  status?: string;
}

export function VehicleForm({
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  error: unknown;
  onSubmit: (payload: VehicleInput) => void;
  onCancel: () => void;
}) {
  const { value, errors, setErrors, set } = useForm({ plate: '', brand: '', model: '', color: '', hgsNumber: '', status: 'ikamet eden' });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (value.plate.replace(/\W/g, '').length < 2) return setErrors({ plate: 'Plaka zorunlu' });
        const payload = Object.fromEntries(Object.entries(value).filter(([, v]) => v !== '')) as unknown as VehicleInput;
        onSubmit(payload);
      }}
    >
      <div className="row">
        <FormField label="Plaka" error={errors.plate} required className="col-md-3 form-group">
          <input className={`${cls(errors, 'plate')} text-uppercase`} value={value.plate} placeholder="34 ABC 123" onChange={(e) => set('plate', e.target.value)} />
        </FormField>
        <FormField label="Marka" className="col-md-3 form-group">
          <input className="form-control" value={value.brand} onChange={(e) => set('brand', e.target.value)} />
        </FormField>
        <FormField label="Model" className="col-md-2 form-group">
          <input className="form-control" value={value.model} onChange={(e) => set('model', e.target.value)} />
        </FormField>
        <FormField label="Renk" className="col-md-2 form-group">
          <input className="form-control" value={value.color} onChange={(e) => set('color', e.target.value)} />
        </FormField>
        <FormField label="Durum" className="col-md-2 form-group">
          <select className="custom-select" value={value.status} onChange={(e) => set('status', e.target.value)}>
            <option value="ikamet eden">İkamet Eden</option>
            <option value="misafir">Misafir</option>
            <option value="yasaklı">Yasaklı</option>
          </select>
        </FormField>
      </div>
      <FormField label="HGS / OGS No" className="form-group" hint="Otopark bariyeri tanıma için">
        <input className="form-control" style={{ maxWidth: 260 }} value={value.hgsNumber} onChange={(e) => set('hgsNumber', e.target.value)} />
      </FormField>
      {Boolean(error) && <ErrorBox error={error} />}
      <FormButtons pending={pending} label="Aracı Ekle" onCancel={onCancel} />
    </form>
  );
}

// ---------------------------------------------------------------- daire

export type UnitInput = z.infer<typeof unitSchema>;

export interface UnitFormValue extends Record<string, string | boolean> {
  blockId: string;
  doorNumber: string;
  floor: string;
  area: string;
  landShare: string;
  shareRatio: string;
  roomCount: string;
  status: string;
  isExempt: boolean;
  note: string;
}

export const EMPTY_UNIT: UnitFormValue = {
  blockId: '',
  doorNumber: '',
  floor: '',
  area: '',
  landShare: '',
  shareRatio: '1',
  roomCount: '',
  status: 'OCCUPIED',
  isExempt: false,
  note: '',
};

const decimalInput = (value: string) => value.replace(',', '.');

export function UnitForm({
  initial,
  blocks,
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initial: UnitFormValue;
  blocks: { id: string; name: string }[];
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (payload: UnitInput) => void;
  onCancel: () => void;
}) {
  const { value, errors, setErrors, set } = useForm(initial);
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const result = unitSchema.safeParse({
          ...value,
          blockId: value.blockId || null,
          floor: value.floor === '' ? null : value.floor,
          area: value.area === '' ? null : decimalInput(value.area),
          landShare: value.landShare === '' ? null : decimalInput(value.landShare),
          shareRatio: decimalInput(value.shareRatio) || '1',
          // Boş metin gönderilir: düzenlemede alan temizlenebilsin (undefined dokunmaz)
          roomCount: value.roomCount.trim(),
          note: value.note.trim(),
        });
        if (!result.success) return setErrors(issuesToErrors(result.error.issues));
        onSubmit(result.data);
      }}
    >
      <div className="row">
        <FormField label="Blok" className="col-md-4 form-group">
          <select className="custom-select" value={value.blockId} onChange={(e) => set('blockId', e.target.value)}>
            <option value="">— Bloksuz —</option>
            {blocks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Daire No" error={errors.doorNumber} required className="col-md-4 form-group">
          <input className={cls(errors, 'doorNumber')} value={value.doorNumber} onChange={(e) => set('doorNumber', e.target.value)} />
        </FormField>
        <FormField label="Kat" error={errors.floor} className="col-md-4 form-group">
          <input className={cls(errors, 'floor')} type="number" value={value.floor} onChange={(e) => set('floor', e.target.value)} />
        </FormField>
      </div>
      <div className="row">
        <FormField label="Brüt m²" error={errors.area} className="col-md-3 form-group">
          <input className={cls(errors, 'area')} inputMode="decimal" value={value.area} onChange={(e) => set('area', e.target.value)} />
        </FormField>
        <FormField label="Arsa Payı" error={errors.landShare} className="col-md-3 form-group">
          <input className={cls(errors, 'landShare')} inputMode="decimal" value={value.landShare} onChange={(e) => set('landShare', e.target.value)} />
        </FormField>
        <FormField label="Hisse Oranı" error={errors.shareRatio} className="col-md-3 form-group" hint="Aidat dağıtımında">
          <input className={cls(errors, 'shareRatio')} inputMode="decimal" value={value.shareRatio} onChange={(e) => set('shareRatio', e.target.value)} />
        </FormField>
        <FormField label="Oda" className="col-md-3 form-group">
          <input className="form-control" value={value.roomCount} placeholder="3+1" onChange={(e) => set('roomCount', e.target.value)} />
        </FormField>
      </div>
      <div className="row align-items-center">
        <FormField label="Durum" className="col-md-4 form-group">
          <select className="custom-select" value={value.status} onChange={(e) => set('status', e.target.value)}>
            <option value="OCCUPIED">Dolu</option>
            <option value="EMPTY">Boş</option>
            <option value="UNDER_RENOVATION">Tadilatta</option>
          </select>
        </FormField>
        <div className="col-md-8">
          <div className="custom-control custom-checkbox">
            <input
              type="checkbox"
              className="custom-control-input"
              id="unit-exempt"
              checked={value.isExempt}
              onChange={(e) => set('isExempt', e.target.checked)}
            />
            <label className="custom-control-label" htmlFor="unit-exempt">
              Aidattan muaf (yönetici dairesi, sığınak vb.)
            </label>
          </div>
        </div>
      </div>
      <FormField label="Not">
        <textarea className="form-control" rows={2} value={value.note} onChange={(e) => set('note', e.target.value)} />
      </FormField>
      {Boolean(error) && <ErrorBox error={error} />}
      <FormButtons pending={pending} label={submitLabel} onCancel={onCancel} />
    </form>
  );
}

export { issuesToErrors };
