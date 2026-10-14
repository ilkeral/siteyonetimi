'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, session, type SiteSummary } from '@/lib/api';
import { getTheme, toggleTheme, type ThemeMode } from '@/lib/theme';

interface MeResponse {
  user: { id: string; fullName: string; email: string; isSuperAdmin: boolean };
  sites: SiteSummary[];
}

export function Navbar({
  onToggleSidebar,
  onToggleMini,
}: {
  onToggleSidebar: () => void;
  onToggleMini: () => void;
}) {
  const router = useRouter();
  const [theme, setThemeState] = useState<ThemeMode>('light');
  const [openMenu, setOpenMenu] = useState<'site' | 'account' | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => setThemeState(getTheme()), []);

  // Dropdown'lar Bootstrap'ın jQuery eklentisiyle değil, React ile açılıp
  // kapanıyor; dışarı tıklamayı kendimiz dinliyoruz.
  useEffect(() => {
    function onDocumentClick(event: MouseEvent) {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, []);

  const { data } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/auth/me'),
  });

  const activeSiteId = typeof window !== 'undefined' ? session.siteId : null;
  const activeSite = data?.sites.find((site) => site.id === activeSiteId);

  function switchSite(siteId: string) {
    session.setSiteId(siteId);
    window.location.reload();
  }

  function logout() {
    const refreshToken = session.refreshToken;
    if (refreshToken) void api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    session.clear();
    router.replace('/giris');
  }

  const initials = (data?.user.fullName ?? '??')
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div
      ref={navRef}
      className="navbar navbar-expand navbar-main navbar-light bg-white sy-navbar"
      id="navbar"
    >
      <button
        type="button"
        className="btn btn-link d-lg-none px-2"
        onClick={onToggleSidebar}
        aria-label="Menüyü aç"
      >
        <i className="material-icons">menu</i>
      </button>

      <button
        type="button"
        className="btn btn-link d-none d-lg-inline-flex align-items-center px-2"
        onClick={onToggleMini}
        title="Menüyü daralt / genişlet"
      >
        <i className="material-icons">menu</i>
      </button>

      {/* ------------------------------------------------------ site seçici */}
      <div className="dropdown d-none d-md-flex align-items-center">
        <button
          type="button"
          className="btn btn-outline-secondary dropdown-toggle ml-2"
          onClick={() => setOpenMenu(openMenu === 'site' ? null : 'site')}
        >
          <span className="d-flex flex-column align-items-start" style={{ lineHeight: 1.15 }}>
            <strong>{activeSite?.name ?? 'Site seçilmedi'}</strong>
            <small className="text-muted">
              {[activeSite?.district, activeSite?.city].filter(Boolean).join(' – ')}
            </small>
          </span>
        </button>
        {openMenu === 'site' && (
          <div className="dropdown-menu show" style={{ top: '100%', left: 0 }}>
            <h6 className="dropdown-header">Erişebildiğiniz siteler</h6>
            {data?.sites.map((site) => (
              <button
                key={site.id}
                type="button"
                className={`dropdown-item${site.id === activeSiteId ? ' active' : ''}`}
                onClick={() => switchSite(site.id)}
              >
                {site.name}
                <small className="d-block text-muted">
                  {[site.district, site.city].filter(Boolean).join(' – ')}
                </small>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------- arama */}
      <form
        className="search-form d-none d-lg-flex mx-3 flex-grow-1"
        style={{ maxWidth: 420 }}
        onSubmit={(event) => event.preventDefault()}
      >
        <input
          type="text"
          className="form-control"
          placeholder="Kişi, daire, evrak veya yardım ara"
        />
        <button className="btn" type="submit">
          <i className="material-icons">search</i>
        </button>
      </form>

      <ul className="nav navbar-nav ml-auto align-items-center flex-row">
        <li className="nav-item">
          <button
            type="button"
            className="nav-link btn btn-link px-2"
            onClick={() => setThemeState(toggleTheme())}
            title={theme === 'dark' ? 'Açık moda geç' : 'Koyu moda geç'}
          >
            <i className="material-icons nav-icon">
              {theme === 'dark' ? 'light_mode' : 'dark_mode'}
            </i>
          </button>
        </li>

        <li className="nav-item">
          <a href="/finans/banka" className="nav-link px-2" title="Bekleyen banka hareketleri">
            <i className="material-icons nav-icon navbar-notifications-indicator">
              notifications_none
            </i>
          </a>
        </li>

        <li className="nav-item dropdown ml-2">
          <button
            type="button"
            className="nav-link btn btn-link d-flex align-items-center px-2"
            onClick={() => setOpenMenu(openMenu === 'account' ? null : 'account')}
          >
            <span className="avatar avatar-sm">
              <span className="avatar-title rounded-circle bg-primary">{initials}</span>
            </span>
          </button>
          {openMenu === 'account' && (
            <div className="dropdown-menu dropdown-menu-right show" style={{ top: '100%' }}>
              <div className="dropdown-item-text dropdown-item-text--lh">
                <div>
                  <strong>{data?.user.fullName}</strong>
                </div>
                <div className="text-muted small">{data?.user.email}</div>
              </div>
              <div className="dropdown-divider" />
              <button type="button" className="dropdown-item" onClick={logout}>
                Çıkış yap
              </button>
            </div>
          )}
        </li>
      </ul>
    </div>
  );
}
