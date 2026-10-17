'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { session } from '@/lib/api';
import { useMe } from '@/lib/me';
import { getSidebarMini, setSidebarMini } from '@/lib/theme';
import { Sidebar } from '@/components/sidebar';
import { Navbar } from '@/components/navbar';

export default function PanelLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [mini, setMini] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { role, loaded } = useMe();

  useEffect(() => {
    if (!session.accessToken || !session.siteId) {
      router.replace('/giris');
      return;
    }
    setMini(getSidebarMini());
    setReady(true);
  }, [router]);

  // Sakin paneli göremez (API de reddeder); portala gönder
  useEffect(() => {
    if (role === 'RESIDENT') router.replace('/portal');
    // Seçili site artık bu kullanıcıya ait değil → yeniden seçtir
    if (loaded && !role) {
      session.clearSite();
      router.replace('/giris');
    }
  }, [role, loaded, router]);

  // Mobilde sayfa değişince çekmece kapansın
  useEffect(() => setDrawerOpen(false), [pathname]);

  function toggleMini() {
    setMini((current) => {
      setSidebarMini(!current);
      return !current;
    });
  }

  if (!ready || !role || role === 'RESIDENT') {
    return (
      <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '100vh' }}>
        <div className="text-muted">Yükleniyor...</div>
      </div>
    );
  }

  return (
    <div className={[mini ? 'sy-mini' : '', drawerOpen ? 'sy-open' : ''].filter(Boolean).join(' ')}>
      <Navbar onToggleSidebar={() => setDrawerOpen((v) => !v)} onToggleMini={toggleMini} />
      <Sidebar mini={mini} />
      {drawerOpen && (
        <div className="sy-backdrop d-lg-none" onClick={() => setDrawerOpen(false)} />
      )}
      <div className="sy-content">
        <div className="sy-content__inner">{children}</div>
      </div>
    </div>
  );
}
