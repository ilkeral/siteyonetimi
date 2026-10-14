'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, session, type SiteSummary } from '@/lib/api';

interface MeResponse {
  user: { id: string; fullName: string; email: string; isSuperAdmin: boolean };
  sites: SiteSummary[];
}

export function Topbar() {
  const router = useRouter();

  const { data } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/auth/me'),
  });

  const activeSiteId = typeof window !== 'undefined' ? session.siteId : null;
  const activeSite = data?.sites.find((s) => s.id === activeSiteId);

  function switchSite(siteId: string) {
    session.setSiteId(siteId);
    // Site değişince tüm önbellek geçersiz olur — en temizi tam yenileme
    window.location.reload();
  }

  function logout() {
    const refreshToken = session.refreshToken;
    if (refreshToken) void api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    session.clear();
    router.replace('/giris');
  }

  return (
    <header className="fixed inset-x-0 top-0 z-10 flex h-14 items-center gap-4 border-b border-slate-200 bg-white pl-[var(--sidebar-width)] pr-4">
      <div className="flex items-center gap-3 pl-4">
        {data && data.sites.length > 1 ? (
          <select
            value={activeSiteId ?? ''}
            onChange={(e) => switchSite(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700"
          >
            {data.sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        ) : (
          <div>
            <div className="text-sm font-semibold text-slate-800">
              {activeSite?.name ?? 'Site seçilmedi'}
            </div>
            <div className="text-[11px] text-slate-500">
              {[activeSite?.district, activeSite?.city].filter(Boolean).join(' – ')}
            </div>
          </div>
        )}
      </div>

      <div className="flex-1">
        <input
          type="search"
          placeholder="Kişi, daire, evrak veya yardım ara"
          className="w-full max-w-md rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-brand-400 focus:bg-white"
        />
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-sm font-medium text-slate-700">{data?.user.fullName ?? '—'}</div>
          <div className="text-[11px] text-slate-500">{data?.user.email}</div>
        </div>
        <button type="button" onClick={logout} className="btn-ghost px-3 py-1.5 text-xs">
          Çıkış
        </button>
      </div>
    </header>
  );
}
