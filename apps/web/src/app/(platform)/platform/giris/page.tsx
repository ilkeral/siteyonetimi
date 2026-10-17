'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { api, session } from '@/lib/api';
import { ErrorAlert, Field, Icon } from '@/components/platform/kit';

/**
 * Platform girişi. Yalnızca süper yönetici kabul edilir; site kullanıcısı
 * buradan giriş yaparsa oturumu açılmaz (müşteri girişine yönlendirilir).
 */
export default function PlatformLoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const data = await api.login(email.trim(), password);
      if (!data.user.isSuperAdmin) {
        // Oturumu hiç kaydetmeden reddet
        void api.post('/auth/logout', { refreshToken: data.refreshToken }).catch(() => undefined);
        throw new Error('Bu giriş yalnızca platform yöneticileri içindir. Site paneline /giris adresinden girin.');
      }
      session.clear();
      session.setTokens(data.accessToken, data.refreshToken);
      queryClient.clear();
      router.replace('/platform');
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="pf-auth">
      <form
        className="pf-auth__card pf-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="pf-brand">
          <span className="pf-brand__mark" style={{ color: '#fff' }}>SY</span>
          <span>
            Platform Yönetimi
            <small>Müşteri, paket ve abonelik yönetimi</small>
          </span>
        </div>
        <ErrorAlert error={error} />
        <Field label="E-posta">
          <input className="pf-input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Parola">
          <input
            className="pf-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <button type="submit" className="pf-btn pf-btn--primary pf-btn--block" disabled={pending || !email || !password}>
          <Icon name="vpn_key" size={18} />
          {pending ? 'Giriş yapılıyor...' : 'Giriş Yap'}
        </button>
      </form>
    </div>
  );
}
