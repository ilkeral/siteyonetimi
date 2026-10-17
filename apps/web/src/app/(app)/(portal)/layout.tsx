'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { session } from '@/lib/api';
import { useLogout, useMe } from '@/lib/me';
import { usePortalSummary } from '@/components/portal';

const NAV = [
  { href: '/portal', label: 'Özet', icon: 'home' },
  { href: '/portal/hesap', label: 'Hesabım', icon: 'account_balance_wallet' },
  { href: '/portal/talepler', label: 'Talepler', icon: 'build' },
  { href: '/portal/duyurular', label: 'Duyurular', icon: 'announcement' },
  { href: '/portal/mesajlar', label: 'Mesajlar', icon: 'mail_outline' },
];

/**
 * İkamet Eden Portalı — panelden ayrı, sade ve mobil öncelikli bir kabuk.
 * Personel bu düzene girerse panele, oturumsuz kullanıcı girişe yönlenir.
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { role, loaded, user } = useMe();
  const logout = useLogout();
  const [ready, setReady] = useState(false);
  const { data: summary } = usePortalSummary(role === 'RESIDENT');

  useEffect(() => {
    if (!session.accessToken || !session.siteId) {
      router.replace('/giris');
      return;
    }
    setReady(true);
  }, [router]);

  useEffect(() => {
    if (!loaded) return;
    if (!role) {
      session.clearSite();
      router.replace('/giris');
    } else if (role !== 'RESIDENT') {
      router.replace('/ozet');
    }
  }, [loaded, role, router]);

  if (!ready || role !== 'RESIDENT') {
    return (
      <div className="d-flex align-items-center justify-content-center text-muted" style={{ minHeight: '100vh' }}>
        Yükleniyor...
      </div>
    );
  }

  const active = (href: string) => (href === '/portal' ? pathname === href : pathname.startsWith(href));

  return (
    <div className="sy-portal">
      <header className="sy-portal__header">
        <div className="sy-portal__container d-flex align-items-center">
          <Link href="/portal" className="sy-portal__brand">
            <span className="sy-brand__mark">SY</span>
            <span className="d-none d-sm-inline">İkamet Eden Portalı</span>
          </Link>
          <span className="ml-auto mr-3 d-none d-md-inline text-white-50 small">
            {summary?.units.map((u) => u.label).join(', ')}
          </span>
          <Link href="/portal/profil" className="sy-portal__user ml-auto ml-md-0" title="Profil ve parola">
            <i className="material-icons">account_circle</i>
            <span className="d-none d-sm-inline">{user?.fullName}</span>
          </Link>
          <button type="button" className="btn btn-link text-white px-2" onClick={logout} title="Çıkış">
            <i className="material-icons">exit_to_app</i>
          </button>
        </div>
        <nav className="sy-portal__container sy-portal__nav">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} className={active(item.href) ? 'is-active' : ''}>
              <i className="material-icons">{item.icon}</i>
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="sy-portal__container py-4">{children}</main>
    </div>
  );
}
