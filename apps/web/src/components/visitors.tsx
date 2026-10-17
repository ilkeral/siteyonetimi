'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDuration, visitorSchema, type VisitorInput } from '@sy/shared';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { EmptyState, ErrorBox, Table } from './ui';
import { occupantOf, unitOptionLabel, usePeopleOptions, useUnitOptions, type Visitor } from './security';

/** Giriş/çıkış sonrası özet sayaçları ve listeler birlikte tazelenir */
function useInvalidateSecurity() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: ['security'] });
}

export function useVisitorExit() {
  const invalidate = useInvalidateSecurity();
  return useMutation({
    mutationFn: (id: string) => api.post(`/security/visitors/${id}/exit`, {}),
    onSuccess: invalidate,
  });
}

const isBanned = (status: string | null | undefined) => /yasak/i.test(status ?? '');

export function VisitorTable({ visitors, emptyMessage }: { visitors: Visitor[]; emptyMessage: string }) {
  const exit = useVisitorExit();
  if (!visitors.length) return <EmptyState message={emptyMessage} icon="people_outline" />;

  return (
    <>
      {Boolean(exit.error) && (
        <div className="px-3 pt-3">
          <ErrorBox error={exit.error} />
        </div>
      )}
      <Table
        head={
          <tr>
            <th>Ziyaretçi</th>
            <th>Plaka</th>
            <th>Ziyaret</th>
            <th>Giriş</th>
            <th>Süre</th>
            <th />
          </tr>
        }
      >
        {visitors.map((v) => (
          <tr key={v.id} className={v.overstay ? 'table-warning' : undefined}>
            <td>
              <strong>{v.visitorName}</strong>
              <small className="d-block text-muted">
                {[v.visitorPhone, v.nationalIdMasked && `TC ${v.nationalIdMasked}`].filter(Boolean).join(' · ') || '—'}
              </small>
            </td>
            <td>
              {v.plate ? <span className="sy-plate">{v.plate}</span> : <span className="text-muted">—</span>}
              {v.vehicle && (
                <small className={`d-block ${isBanned(v.vehicle.status) ? 'text-danger font-weight-bold' : 'text-muted'}`}>
                  {v.vehicle.owner}
                  {v.vehicle.status ? ` · ${v.vehicle.status}` : ''}
                </small>
              )}
            </td>
            <td>
              {v.unit?.label ?? v.hostPerson?.fullName ?? v.purpose ?? '—'}
              <small className="d-block text-muted">
                {[v.unit && v.hostPerson?.fullName, (v.unit || v.hostPerson) && v.purpose].filter(Boolean).join(' · ')}
              </small>
            </td>
            <td className="sy-num">
              {dateTime(v.enteredAt)}
              {v.exitedAt && <small className="d-block text-muted">Çıkış {dateTime(v.exitedAt)}</small>}
            </td>
            <td className="sy-num">
              {formatDuration(v.minutes)}
              {v.overstay && <small className="d-block text-warning font-weight-bold">Çıkışı unutulmuş olabilir</small>}
            </td>
            <td className="text-right">
              {!v.exitedAt && (
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm"
                  disabled={exit.isPending && exit.variables === v.id}
                  onClick={() => exit.mutate(v.id)}
                >
                  Çıkış
                </button>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}

interface VisitorFormValue {
  visitorName: string;
  visitorPhone: string;
  nationalId: string;
  plate: string;
  unitId: string;
  hostPersonId: string;
  purpose: string;
}

const EMPTY_VISITOR: VisitorFormValue = {
  visitorName: '',
  visitorPhone: '',
  nationalId: '',
  plate: '',
  unitId: '',
  hostPersonId: '',
  purpose: '',
};

const PURPOSES = ['Misafir', 'Kargo / Kurye', 'Tadilat / Usta', 'Temizlik', 'Servis / Teknik', 'Emlak'];

type CheckInResult = Visitor & { warning: string | null };

/** Kapıdaki hızlı giriş formu — kayıt sonrası boşalır, sonraki ziyaretçiye hazır */
export function VisitorCheckInForm() {
  const [value, setValue] = useState(EMPTY_VISITOR);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CheckInResult | null>(null);
  const { data: units } = useUnitOptions();
  const { data: people } = usePeopleOptions();
  const invalidate = useInvalidateSecurity();

  const checkIn = useMutation({
    mutationFn: (payload: VisitorInput) => api.post<CheckInResult>('/security/visitors', payload),
    onSuccess: (visitor) => {
      setResult(visitor);
      setValue(EMPTY_VISITOR);
      invalidate();
    },
  });

  function set<K extends keyof VisitorFormValue>(key: K, next: string) {
    setValue((current) => ({ ...current, [key]: next }));
    setFieldErrors(({ [key]: _removed, ...rest }) => rest);
  }

  function submit() {
    const parsed = visitorSchema.safeParse({
      visitorName: value.visitorName,
      visitorPhone: value.visitorPhone || null,
      nationalId: value.nationalId || null,
      plate: value.plate || null,
      unitId: value.unitId || null,
      hostPersonId: value.hostPersonId || null,
      purpose: value.purpose || null,
    });
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message])));
      return;
    }
    setResult(null);
    checkIn.mutate(parsed.data);
  }

  const invalid = (field: string) => (fieldErrors[field] ? ' is-invalid' : '');

  return (
    <div>
      {result && (
        <div className={`alert ${result.warning ? 'alert-danger' : 'alert-success'} py-2`}>
          {result.warning ? (
            <>
              <strong>{result.warning}.</strong> {result.visitorName} girişi kaydedildi; yönetime bilgi verin.
            </>
          ) : (
            <>
              <strong>{result.visitorName}</strong> girişi kaydedildi
              {result.vehicle ? ` · araç: ${result.vehicle.owner}` : ''}.
            </>
          )}
        </div>
      )}

      <div className="form-group">
        <label className="form-label">Ad Soyad</label>
        <input
          className={`form-control${invalid('visitorName')}`}
          value={value.visitorName}
          onChange={(e) => set('visitorName', e.target.value)}
        />
        {fieldErrors.visitorName && <div className="invalid-feedback">{fieldErrors.visitorName}</div>}
      </div>
      <div className="row">
        <div className="col-6 form-group">
          <label className="form-label">Plaka</label>
          <input
            className="form-control text-uppercase"
            value={value.plate}
            onChange={(e) => set('plate', e.target.value)}
            placeholder="34 ABC 123"
          />
        </div>
        <div className="col-6 form-group">
          <label className="form-label">Telefon</label>
          <input className="form-control" value={value.visitorPhone} onChange={(e) => set('visitorPhone', e.target.value)} />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">
          TC Kimlik No <small className="text-muted">(isteğe bağlı)</small>
        </label>
        <input
          className={`form-control${invalid('nationalId')}`}
          inputMode="numeric"
          maxLength={11}
          autoComplete="off"
          value={value.nationalId}
          onChange={(e) => set('nationalId', e.target.value.replace(/\D/g, ''))}
        />
        {fieldErrors.nationalId ? (
          <div className="invalid-feedback">{fieldErrors.nationalId}</div>
        ) : (
          <small className="form-text text-muted">Kayıtlarda maskeli görünür; yalnızca tam numarayla aranır.</small>
        )}
      </div>
      <div className="form-group">
        <label className="form-label">Ziyaret Edilen Daire</label>
        <select
          className={`custom-select${invalid('unitId')}`}
          value={value.unitId}
          onChange={(e) => {
            const unitId = e.target.value;
            const occupant = occupantOf(units?.items, unitId);
            setValue((current) => ({ ...current, unitId, hostPersonId: occupant?.id ?? current.hostPersonId }));
            setFieldErrors(({ unitId: _removed, ...rest }) => rest);
          }}
        >
          <option value="">— Seçilmedi —</option>
          {units?.items.map((u) => (
            <option key={u.id} value={u.id}>
              {unitOptionLabel(u)}
            </option>
          ))}
        </select>
        {fieldErrors.unitId && <div className="invalid-feedback">{fieldErrors.unitId}</div>}
      </div>
      <div className="form-group">
        <label className="form-label">Ziyaret Edilen Kişi</label>
        <select className="custom-select" value={value.hostPersonId} onChange={(e) => set('hostPersonId', e.target.value)}>
          <option value="">— Seçilmedi —</option>
          {people?.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName}
            </option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Ziyaret Amacı</label>
        <input
          className="form-control"
          list="sy-visit-purposes"
          value={value.purpose}
          onChange={(e) => set('purpose', e.target.value)}
          placeholder="Misafir, kargo, tadilat..."
        />
        <datalist id="sy-visit-purposes">
          {PURPOSES.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </div>

      {Boolean(checkIn.error) && <ErrorBox error={checkIn.error} />}
      <button type="button" className="btn btn-primary btn-block" disabled={checkIn.isPending} onClick={submit}>
        {checkIn.isPending ? 'Kaydediliyor...' : 'Girişi Kaydet'}
      </button>
    </div>
  );
}
