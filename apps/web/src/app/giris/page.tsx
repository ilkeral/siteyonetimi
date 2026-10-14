'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@sy/shared';
import { api, session, type SiteSummary } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
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

      if (data.sites.length === 0) {
        setServerError('Hesabınıza tanımlı bir site bulunmuyor. Yöneticinizle görüşün.');
        return;
      }
      // Tek siteye yetkiliyse doğrudan gir, değilse seçtir
      if (data.sites.length === 1) {
        session.setSiteId(data.sites[0].id);
        router.replace('/ozet');
        return;
      }
      setSites(data.sites);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Giriş yapılamadı');
    }
  }

  function chooseSite(siteId: string) {
    session.setSiteId(siteId);
    router.replace('/ozet');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-xl font-bold text-white">
            SY
          </div>
          <h1 className="text-xl font-semibold text-slate-800">Site Yönetim Paneli</h1>
          <p className="mt-1 text-sm text-slate-500">Devam etmek için giriş yapın</p>
        </div>

        {sites ? (
          <div className="card p-5">
            <h2 className="mb-1 text-sm font-semibold text-slate-700">Site seçiniz</h2>
            <p className="mb-4 text-xs text-slate-500">
              {sites.length} siteye erişim yetkiniz var.
            </p>
            <ul className="space-y-2">
              {sites.map((site) => (
                <li key={site.id}>
                  <button
                    type="button"
                    onClick={() => chooseSite(site.id)}
                    className="w-full rounded-md border border-slate-200 px-4 py-3 text-left transition hover:border-brand-400 hover:bg-brand-50"
                  >
                    <span className="block text-sm font-medium text-slate-800">{site.name}</span>
                    <span className="block text-xs text-slate-500">
                      {[site.district, site.city].filter(Boolean).join(' – ')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4 p-6">
            <div>
              <label className="field-label" htmlFor="email">
                E-posta
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                className="field-input"
                placeholder="ornek@site.local"
                {...register('email')}
              />
              {errors.email && <p className="field-error">{errors.email.message}</p>}
            </div>

            <div>
              <label className="field-label" htmlFor="password">
                Parola
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="field-input"
                {...register('password')}
              />
              {errors.password && <p className="field-error">{errors.password.message}</p>}
            </div>

            {serverError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {serverError}
              </div>
            )}

            <button type="submit" disabled={isSubmitting} className="btn-primary w-full">
              {isSubmitting ? 'Giriş yapılıyor...' : 'Giriş Yap'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
