'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { portalAccessSchema } from '@sy/shared';
import { api } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { ErrorBox, Loading } from './ui';

interface Access {
  enabled: boolean;
  email: string | null;
  lastLoginAt: string | null;
  createdAt: string | null;
}

/**
 * Kişi kartındaki "İkamet Eden Portalı" kutusu. Geçici parola yalnızca üretildiği
 * anda gösterilir; sunucuda düz metin saklanmaz, yeniden görüntülenemez.
 */
export function PortalAccessBox({ personId, defaultEmail }: { personId: string; defaultEmail: string | null }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [formError, setFormError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);

  const key = ['portal-access', personId];
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => api.get<Access>(`/people/${personId}/portal-access`),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const grant = useMutation({
    mutationFn: () =>
      api.post<{ email: string; temporaryPassword: string | null; existingUser: boolean }>(
        `/people/${personId}/portal-access`,
        { email },
      ),
    onSuccess: (result) => {
      setSecret(result.temporaryPassword ? { email: result.email, password: result.temporaryPassword } : null);
      void refresh();
    },
  });
  const reset = useMutation({
    mutationFn: () => api.post<{ email: string; temporaryPassword: string }>(`/people/${personId}/portal-access/reset-password`),
    onSuccess: (result) => setSecret({ email: result.email, password: result.temporaryPassword }),
  });
  const revoke = useMutation({
    mutationFn: () => api.delete(`/people/${personId}/portal-access`),
    onSuccess: () => {
      setSecret(null);
      void refresh();
    },
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const mutationError = grant.error ?? reset.error ?? revoke.error;

  return (
    <div className="sy-portal-access">
      <div className="d-flex align-items-center mb-2">
        <i className="material-icons mr-2 text-muted">phonelink_lock</i>
        <strong>İkamet Eden Portalı</strong>
        <span className={`badge ml-2 ${data.enabled ? 'badge-success' : 'badge-light'}`}>
          {data.enabled ? 'Açık' : 'Kapalı'}
        </span>
      </div>

      {secret && (
        <div className="alert alert-warning">
          <strong>Geçici parola — yalnızca şimdi görünür:</strong>
          <div className="sy-num h5 my-2" style={{ letterSpacing: 1 }}>
            {secret.password}
          </div>
          <small>
            {secret.email} ile giriş yapıp Profil sayfasından parolasını değiştirmesini isteyin.
          </small>
        </div>
      )}
      {mutationError && <ErrorBox error={mutationError} />}

      {data.enabled ? (
        <>
          <div className="small text-muted mb-2">
            {data.email} · son giriş: {data.lastLoginAt ? dateTime(data.lastLoginAt) : 'henüz yok'}
          </div>
          <button type="button" className="btn btn-outline-secondary btn-sm mr-2" disabled={reset.isPending} onClick={() => {
            if (window.confirm('Yeni geçici parola üretilecek ve açık oturumlar kapanacak. Devam edilsin mi?')) reset.mutate();
          }}>
            Parolayı Sıfırla
          </button>
          <button type="button" className="btn btn-outline-danger btn-sm" disabled={revoke.isPending} onClick={() => {
            if (window.confirm('Portal erişimi kaldırılsın mı?')) revoke.mutate();
          }}>
            Erişimi Kaldır
          </button>
        </>
      ) : (
        <div className="d-flex flex-wrap" style={{ gap: '.5rem' }}>
          <input
            type="email"
            className="form-control form-control-sm"
            style={{ maxWidth: 280 }}
            placeholder="E-posta adresi"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={grant.isPending}
            onClick={() => {
              const result = portalAccessSchema.safeParse({ email });
              if (!result.success) return setFormError(result.error.issues[0].message);
              setFormError(null);
              grant.mutate();
            }}
          >
            Portal Erişimi Ver
          </button>
          {formError && <small className="text-danger w-100">{formError}</small>}
        </div>
      )}
    </div>
  );
}
