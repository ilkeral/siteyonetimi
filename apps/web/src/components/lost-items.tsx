'use client';

import { useState } from 'react';
import {
  LOST_ITEM_HOLD_DAYS,
  LOST_ITEM_STATUS_LABELS,
  LOST_ITEM_TRANSITIONS,
  lostItemCreateSchema,
  lostItemDetailsSchema,
  type LostItemCreateInput,
  type LostItemDetailsInput,
  type LostItemTransitionBody,
} from '@sy/shared';
import { date, dateTimeInput } from '@/lib/format';
import { ErrorBox } from './ui';
import type { LostItem, LostItemStatus } from './security';

/** Kayıp eşya formlarının ortak parçaları */

type Fields = Record<string, string>;

function Field({
  label,
  name,
  value,
  error,
  onChange,
  type = 'text',
  hint,
  required,
  max,
}: {
  label: string;
  name: string;
  value: string;
  error?: string;
  onChange: (name: string, value: string) => void;
  type?: string;
  hint?: string;
  required?: boolean;
  max?: string;
}) {
  return (
    <div className="form-group">
      <label className="form-label" htmlFor={`lost-${name}`}>
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      {type === 'textarea' ? (
        <textarea
          id={`lost-${name}`}
          className={`form-control${error ? ' is-invalid' : ''}`}
          rows={3}
          value={value}
          onChange={(e) => onChange(name, e.target.value)}
        />
      ) : (
        <input
          id={`lost-${name}`}
          type={type}
          max={max}
          className={`form-control${error ? ' is-invalid' : ''}`}
          value={value}
          onChange={(e) => onChange(name, e.target.value)}
        />
      )}
      {error ? <div className="invalid-feedback">{error}</div> : hint && <small className="form-text text-muted">{hint}</small>}
    </div>
  );
}

/** Boş metinler null, tarih alanları Date olur */
function toPayload(fields: Fields, dateKeys: string[]) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      if (!value.trim()) return [key, null];
      return [key, dateKeys.includes(key) ? new Date(value) : value];
    }),
  );
}

function issuesToErrors(issues: { path: (string | number)[]; message: string }[]) {
  return Object.fromEntries(issues.map((issue) => [issue.path.join('.'), issue.message]));
}

function useFields(initial: Fields) {
  const [fields, setFields] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const change = (name: string, value: string) => {
    setFields((current) => ({ ...current, [name]: value }));
    setErrors(({ [name]: _removed, ...rest }) => rest);
  };
  return { fields, setFields, errors, setErrors, change };
}

// ---------------------------------------------------------------- yeni kayıt

export function LostItemCreateForm({
  initialStatus,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  initialStatus: 'FOUND' | 'LOST';
  pending: boolean;
  error: unknown;
  onSubmit: (payload: LostItemCreateInput) => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState(initialStatus);
  const now = dateTimeInput(new Date());
  const { fields, errors, setErrors, change } = useFields({
    itemName: '',
    description: '',
    location: '',
    foundAt: now,
    finderName: '',
    finderPhone: '',
    custodianName: '',
    custodianRole: '',
    lostAt: '',
    loserName: '',
    loserPhone: '',
  });

  function submit() {
    // Seçilmeyen türün alanları gönderilmez
    const relevant = { ...fields };
    if (status === 'LOST') {
      for (const key of ['foundAt', 'finderName', 'finderPhone', 'custodianName', 'custodianRole']) delete relevant[key];
    }
    const result = lostItemCreateSchema.safeParse({ ...toPayload(relevant, ['foundAt', 'lostAt']), status });
    if (!result.success) {
      setErrors(issuesToErrors(result.error.issues));
      return;
    }
    onSubmit(result.data);
  }

  const field = (name: string, label: string, extra: Partial<Parameters<typeof Field>[0]> = {}) => (
    <Field label={label} name={name} value={fields[name]} error={errors[name]} onChange={change} {...extra} />
  );

  return (
    <div>
      <div className="btn-group btn-group-toggle mb-3" role="group">
        {(['FOUND', 'LOST'] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={`btn btn-sm ${status === key ? 'btn-primary' : 'btn-outline-primary'}`}
            onClick={() => setStatus(key)}
          >
            {key === 'FOUND' ? 'Bulunan eşya (emanete al)' : 'Kayıp bildirimi'}
          </button>
        ))}
      </div>

      <div className="row">
        <div className="col-md-6">{field('itemName', 'Eşya', { required: true })}</div>
        <div className="col-md-6">{field('location', status === 'FOUND' ? 'Bulunduğu yer' : 'Kaybedildiği yer')}</div>
      </div>
      {field('description', 'Tarif (renk, marka, içindekiler)', { type: 'textarea' })}

      {status === 'FOUND' ? (
        <>
          <div className="row">
            <div className="col-md-4">{field('foundAt', 'Bulunma zamanı', { type: 'datetime-local', max: now })}</div>
            <div className="col-md-4">{field('finderName', 'Bulan kişi')}</div>
            <div className="col-md-4">{field('finderPhone', 'Bulanın telefonu')}</div>
          </div>
          <div className="row">
            <div className="col-md-6">
              {field('custodianName', 'Emanetçi', { required: true, hint: 'Eşyayı kim/nerede saklıyor: "Güvenlik kulübesi", "Yönetim ofisi"' })}
            </div>
            <div className="col-md-6">{field('custodianRole', 'Emanetçinin görevi')}</div>
          </div>
        </>
      ) : (
        <div className="row">
          <div className="col-md-4">{field('lostAt', 'Kaybedilme zamanı', { type: 'datetime-local', max: now })}</div>
          <div className="col-md-4">{field('loserName', 'Bildiren (sahibi)', { required: true })}</div>
          <div className="col-md-4">{field('loserPhone', 'Telefon')}</div>
        </div>
      )}

      {Boolean(error) && <ErrorBox error={error} />}
      <div className="d-flex" style={{ gap: '.5rem' }}>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>
          {pending ? 'Kaydediliyor...' : status === 'FOUND' ? 'Emanete Al' : 'Bildirimi Kaydet'}
        </button>
        <button type="button" className="btn btn-light" onClick={onCancel}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- bilgileri düzelt

export function LostItemDetailsForm({
  item,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  item: LostItem;
  pending: boolean;
  error: unknown;
  onSubmit: (payload: LostItemDetailsInput) => void;
  onCancel: () => void;
}) {
  const { fields, errors, setErrors, change } = useFields({
    itemName: item.itemName,
    description: item.description ?? '',
    location: item.location ?? '',
    lostAt: item.lostAt ? dateTimeInput(item.lostAt) : '',
    loserName: item.loserName ?? '',
    loserPhone: item.loserPhone ?? '',
    finderName: item.finderName ?? '',
    finderPhone: item.finderPhone ?? '',
    custodianName: item.custodianName ?? '',
    custodianRole: item.custodianRole ?? '',
  });

  function submit() {
    const result = lostItemDetailsSchema.safeParse(toPayload(fields, ['lostAt']));
    if (!result.success) {
      setErrors(issuesToErrors(result.error.issues));
      return;
    }
    onSubmit(result.data);
  }

  const field = (name: string, label: string, extra: Partial<Parameters<typeof Field>[0]> = {}) => (
    <Field label={label} name={name} value={fields[name]} error={errors[name]} onChange={change} {...extra} />
  );

  return (
    <div>
      <div className="row">
        <div className="col-md-6">{field('itemName', 'Eşya', { required: true })}</div>
        <div className="col-md-6">{field('location', 'Yer')}</div>
      </div>
      {field('description', 'Tarif', { type: 'textarea' })}
      <div className="row">
        <div className="col-md-4">{field('lostAt', 'Kaybedilme zamanı', { type: 'datetime-local' })}</div>
        <div className="col-md-4">{field('loserName', 'Sahibi / bildiren')}</div>
        <div className="col-md-4">{field('loserPhone', 'Telefon')}</div>
      </div>
      <div className="row">
        <div className="col-md-6">{field('finderName', 'Bulan kişi')}</div>
        <div className="col-md-6">{field('finderPhone', 'Bulanın telefonu')}</div>
      </div>
      <div className="row">
        <div className="col-md-6">{field('custodianName', 'Emanetçi', { required: item.status !== 'LOST' })}</div>
        <div className="col-md-6">{field('custodianRole', 'Emanetçinin görevi')}</div>
      </div>
      {Boolean(error) && <ErrorBox error={error} />}
      <div className="d-flex" style={{ gap: '.5rem' }}>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={submit}>
          {pending ? 'Kaydediliyor...' : 'Kaydet'}
        </button>
        <button type="button" className="btn btn-light" onClick={onCancel}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- yaşam döngüsü

const STEPS: LostItemStatus[] = ['LOST', 'FOUND', 'CLAIMED', 'DELIVERED'];

/** Kayıp → emanette → sahibi çıktı → teslim (imha edilmişse son adım imha olur) */
export function LostItemSteps({ item, visited }: { item: LostItem; visited: string[] }) {
  const steps = item.status === 'DISPOSED' ? (['LOST', 'FOUND', 'DISPOSED'] as LostItemStatus[]) : STEPS;
  const current = steps.indexOf(item.status);
  const stamp: Partial<Record<LostItemStatus, string | null>> = {
    LOST: item.lostAt,
    FOUND: item.foundAt,
    DELIVERED: item.deliveredAt,
    DISPOSED: item.disposedAt,
  };

  const closed = item.status === 'DELIVERED' || item.status === 'DISPOSED';

  return (
    <ol className="sy-steps sy-steps--static">
      {steps.map((step, index) => {
        // Geçilen adım: kaydın geçmişinde o duruma girilmiş mi (ör. doğrudan
        // "bulundu" açılan kayıtta kayıp bildirimi, doğrudan teslimde talep atlanır)
        const past = index < current;
        const done = (past && visited.includes(step)) || (index === current && closed);
        const skipped = past && !visited.includes(step);
        const className = done ? 'is-done' : index === current ? 'is-active' : '';
        return (
          <li key={step} className={className}>
            <div className="sy-steps__item" aria-current={index === current ? 'step' : undefined}>
              <span className="sy-steps__no">{done ? '✓' : index + 1}</span>
              <span>
                {LOST_ITEM_STATUS_LABELS[step]}
                <small className="d-block font-weight-normal">
                  {skipped ? 'Atlandı' : (past || index === current) && stamp[step] ? date(stamp[step]) : ' '}
                </small>
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const ACTION_LABELS: Record<string, string> = {
  'LOST>FOUND': 'Bulundu, emanete al',
  'FOUND>CLAIMED': 'Sahibi çıktı',
  'FOUND>DELIVERED': 'Sahibine teslim et',
  'FOUND>DISPOSED': 'İmha / bağış',
  'CLAIMED>DELIVERED': 'Teslim et',
  'CLAIMED>FOUND': 'Talebi reddet',
};

/**
 * Mevcut durumdan izin verilen geçişler. Kurallar (zorunlu alanlar, emanet
 * süresi) sunucuda `planLostItemTransition` ile aynen uygulanır; burada
 * yalnızca kullanıcıyı yönlendirmek için gösterilir.
 */
export function LostItemActions({
  item,
  pending,
  error,
  onSubmit,
}: {
  item: LostItem;
  pending: boolean;
  error: unknown;
  onSubmit: (body: LostItemTransitionBody) => void;
}) {
  const targets = LOST_ITEM_TRANSITIONS[item.status];
  const [target, setTarget] = useState<LostItemStatus | null>(targets.length === 1 ? targets[0] : null);
  const now = dateTimeInput(new Date());
  const { fields, setFields, errors, change } = useFields({
    at: now,
    custodianName: item.custodianName ?? '',
    custodianRole: item.custodianRole ?? '',
    finderName: item.finderName ?? '',
    finderPhone: item.finderPhone ?? '',
    loserName: '',
    loserPhone: '',
    deliveredTo: item.loserName ?? '',
    disposalNote: '',
  });

  if (!targets.length) return null;

  const earliestDisposal = item.foundAt ? new Date(new Date(item.foundAt).getTime() + LOST_ITEM_HOLD_DAYS * 86_400_000) : null;
  const disposalBlocked = !earliestDisposal || earliestDisposal > new Date();

  function choose(next: LostItemStatus) {
    setTarget(next);
    setFields((current) => ({ ...current, at: dateTimeInput(new Date()) }));
  }

  function submit() {
    if (!target) return;
    const keys: Record<LostItemStatus, string[]> = {
      LOST: [],
      FOUND: item.status === 'LOST' ? ['at', 'custodianName', 'custodianRole', 'finderName', 'finderPhone'] : [],
      CLAIMED: ['loserName', 'loserPhone'],
      DELIVERED: ['at', 'deliveredTo', 'loserPhone'],
      DISPOSED: ['at', 'disposalNote'],
    };
    const picked = Object.fromEntries(keys[target].map((key) => [key, fields[key]]));
    onSubmit({ to: target, ...(toPayload(picked, ['at']) as Omit<LostItemTransitionBody, 'to'>) });
  }

  const field = (name: string, label: string, extra: Partial<Parameters<typeof Field>[0]> = {}) => (
    <Field label={label} name={name} value={fields[name]} error={errors[name]} onChange={change} {...extra} />
  );

  return (
    <div>
      {targets.length > 1 && (
        <div className="d-flex flex-wrap mb-3" style={{ gap: '.5rem' }}>
          {targets.map((next) => (
            <button
              key={next}
              type="button"
              className={`btn btn-sm ${target === next ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => choose(next)}
            >
              {ACTION_LABELS[`${item.status}>${next}`]}
            </button>
          ))}
        </div>
      )}

      {target === 'FOUND' && item.status === 'LOST' && (
        <>
          {field('at', 'Bulunma zamanı', { type: 'datetime-local', max: now })}
          {field('custodianName', 'Emanetçi', { required: true })}
          {field('custodianRole', 'Emanetçinin görevi')}
          {field('finderName', 'Bulan kişi')}
          {field('finderPhone', 'Bulanın telefonu')}
        </>
      )}
      {target === 'FOUND' && item.status === 'CLAIMED' && (
        <p className="text-muted">
          <strong>{item.loserName}</strong> eşyanın sahibi değilse talebi reddedin. Eşya emanete döner ve talep edenin bilgisi silinir.
        </p>
      )}
      {target === 'CLAIMED' && (
        <>
          {field('loserName', 'Talep eden', { required: true, hint: 'Eşyayı tarif ederek sahiplenen kişi' })}
          {field('loserPhone', 'Telefon')}
        </>
      )}
      {target === 'DELIVERED' && (
        <>
          {field('deliveredTo', 'Teslim alan', { required: true, hint: 'Kimlik kontrolü yapılarak teslim edin' })}
          {!item.loserName && field('loserPhone', 'Telefon')}
          {field('at', 'Teslim zamanı', { type: 'datetime-local', max: now })}
        </>
      )}
      {target === 'DISPOSED' && (
        <>
          <div className={`alert ${disposalBlocked ? 'alert-warning' : 'alert-light'} py-2`}>
            Eşya en az {LOST_ITEM_HOLD_DAYS} gün emanette kalmalı.
            {earliestDisposal && <> En erken: <strong>{date(earliestDisposal)}</strong>.</>}
          </div>
          {field('disposalNote', 'Açıklama', { type: 'textarea', required: true, hint: 'Ne yapıldı, kime bağışlandı, tutanak no' })}
          {field('at', 'İşlem zamanı', { type: 'datetime-local', max: now })}
        </>
      )}

      {Boolean(error) && <ErrorBox error={error} />}
      {target && (
        <button
          type="button"
          className={`btn ${target === 'DISPOSED' || (target === 'FOUND' && item.status === 'CLAIMED') ? 'btn-outline-danger' : 'btn-primary'}`}
          disabled={pending || (target === 'DISPOSED' && disposalBlocked)}
          onClick={submit}
        >
          {pending ? 'Kaydediliyor...' : ACTION_LABELS[`${item.status}>${target}`]}
        </button>
      )}
    </div>
  );
}
