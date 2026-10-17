'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { changePasswordSchema } from '@sy/shared';
import { api, session } from '@/lib/api';
import { Card, ErrorBox, SuccessBox } from '@/components/ui';
import { usePortalSummary } from '@/components/portal';

export default function PortalProfilePage() {
  const { data: summary } = usePortalSummary();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [formError, setFormError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: () => api.post<{ accessToken: string; refreshToken: string }>('/auth/change-password', form),
    onSuccess: (tokens) => {
      // Diğer oturumlar kapandı; bu cihaz yeni tokenlarla devam eder
      session.setTokens(tokens.accessToken, tokens.refreshToken);
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    },
  });

  function submit() {
    const result = changePasswordSchema.safeParse(form);
    if (!result.success) return setFormError(result.error.issues[0].message);
    setFormError(null);
    change.mutate();
  }

  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <>
      <h1 className="h3 mb-3">Profil</h1>
      <div className="row">
        <div className="col-lg-5 mb-4">
          <Card title="Kayıtlı Bilgileriniz">
            <div className="card-body">
              <dl className="sy-dl mb-2">
                <dt>Ad Soyad</dt>
                <dd>{summary?.person.fullName}</dd>
                <dt>E-posta</dt>
                <dd>{summary?.person.email ?? '—'}</dd>
                <dt>Telefon</dt>
                <dd>{summary?.person.phone ?? '—'}</dd>
                <dt>Daire</dt>
                <dd>{summary?.units.map((u) => u.label).join(', ')}</dd>
              </dl>
              <small className="text-muted">Bilgileriniz yanlışsa site yönetiminize bildirin.</small>
            </div>
          </Card>
        </div>
        <div className="col-lg-5">
          <Card title="Parola Değiştir">
            <div className="card-body">
              <div className="form-group">
                <label className="form-label">Mevcut Parola</label>
                <input type="password" className="form-control" autoComplete="current-password" value={form.currentPassword} onChange={(e) => set('currentPassword', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Yeni Parola</label>
                <input type="password" className="form-control" autoComplete="new-password" value={form.newPassword} onChange={(e) => set('newPassword', e.target.value)} />
                <small className="text-muted">En az 8 karakter; harf ve rakam içermeli.</small>
              </div>
              <div className="form-group">
                <label className="form-label">Yeni Parola (tekrar)</label>
                <input type="password" className="form-control" autoComplete="new-password" value={form.confirmPassword} onChange={(e) => set('confirmPassword', e.target.value)} />
              </div>
              {(formError || change.error) && <ErrorBox error={formError ? new Error(formError) : change.error} />}
              {change.isSuccess && <SuccessBox>Parolanız değiştirildi. Diğer cihazlardaki oturumlar kapatıldı.</SuccessBox>}
              <button type="button" className="btn btn-primary" disabled={change.isPending} onClick={submit}>
                Parolayı Değiştir
              </button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
