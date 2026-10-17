'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api, session, type SiteSummary } from './api';

interface MeResponse {
  user: { id: string; fullName: string; email: string; isSuperAdmin: boolean };
  sites: SiteSummary[];
}

/**
 * Oturumdaki kullanıcı ve aktif sitedeki rolü.
 * Navbar ile aynı sorgu anahtarını (`['me']`) kullanır — ek istek atılmaz.
 *
 * Yalnızca arayüzde düğme gizlemek içindir; asıl yetki kontrolü API'dedir.
 */
export function useMe() {
  const { data, isSuccess } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/auth/me'),
    staleTime: 5 * 60_000,
  });

  const role = data?.sites.find((site) => site.id === session.siteId)?.role ?? null;

  return {
    user: data?.user ?? null,
    role,
    /** Oturum bilgisi geldi (rol null ise seçili site bu kullanıcıya ait değil) */
    loaded: isSuccess,
    /** Rollerden birine sahip mi (süper yönetici her şeye sahiptir) */
    can: (...roles: string[]) => !!data?.user.isSuperAdmin || (!!role && roles.includes(role)),
  };
}

/**
 * Çıkış: refresh token iptal edilir, oturum ve TÜM sorgu önbelleği silinir —
 * aynı sekmede giriş yapan bir sonraki kullanıcı öncekinin verisini görmesin.
 */
export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return () => {
    const refreshToken = session.refreshToken;
    if (refreshToken) void api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    session.clear();
    queryClient.clear();
    router.replace('/giris');
  };
}
