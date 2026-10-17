'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@sy/shared';
import { api, homePath, session, type SiteSummary } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [sites, setSites] = useState<SiteSummary[] | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginInput) {
    setServerError(null);
    try {
      const data = await api.login(values.email, values.password);
      session.setTokens(data.accessToken, data.refreshToken);
      // Önceki oturumun önbelleği (rol, site, liste verileri) yeni kullanıcıya taşınmasın
      queryClient.clear();

      if (data.sites.length === 0) {
        setServerError('Hesabınıza tanımlı bir site bulunmuyor. Yöneticinizle görüşün.');
        return;
      }
      const previous = data.sites.find((site) => site.id === session.siteId);
      if (previous) {
        router.replace(homePath(previous.role));
        return;
      }
      if (data.sites.length === 1) {
        session.setSiteId(data.sites[0].id);
        router.replace(homePath(data.sites[0].role));
        return;
      }
      setSites(data.sites);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Giriş yapılamadı');
    }
  }

  function chooseSite(site: SiteSummary) {
    session.setSiteId(site.id);
    router.replace(homePath(site.role));
  }

  return (
    <div
      className="d-flex align-items-center justify-content-center p-3"
      style={{ minHeight: '100vh', background: 'var(--sy-body-bg)' }}
    >
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div className="text-center mb-4">
          <span
            className="sy-brand__mark mx-auto mb-3"
            style={{ width: 48, height: 48, fontSize: '1rem' }}
          >
            SY
          </span>
          <h4 className="mb-1">Site Yönetim Paneli</h4>
          <p className="text-muted mb-0">Devam etmek için giriş yapın</p>
        </div>

        {sites ? (
          <div className="card card-shadow">
            <div className="card-header">
              <h5 className="m-0">Site seçiniz</h5>
              <small className="text-muted">{sites.length} siteye erişim yetkiniz var</small>
            </div>
            <div className="list-group list-group-flush">
              {sites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => chooseSite(site)}
                  className="list-group-item list-group-item-action text-left"
                >
                  <strong className="d-block">{site.name}</strong>
                  <small className="text-muted">
                    {[site.district, site.city].filter(Boolean).join(' – ')}
                  </small>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="card card-shadow">
            <div className="card-body">
              <div className="form-group">
                <label className="form-label" htmlFor="email">
                  E-posta
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  className={`form-control${errors.email ? ' is-invalid' : ''}`}
                  placeholder="ornek@site.local"
                  {...register('email')}
                />
                {errors.email && <div className="invalid-feedback">{errors.email.message}</div>}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="password">
                  Parola
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  className={`form-control${errors.password ? ' is-invalid' : ''}`}
                  {...register('password')}
                />
                {errors.password && (
                  <div className="invalid-feedback">{errors.password.message}</div>
                )}
              </div>

              {serverError && (
                <div className="alert alert-danger py-2" role="alert">
                  {serverError}
                </div>
              )}

              <button type="submit" disabled={isSubmitting} className="btn btn-primary btn-block">
                {isSubmitting ? 'Giriş yapılıyor...' : 'Giriş Yap'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
