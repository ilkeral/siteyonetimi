'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { session } from '@/lib/api';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';

export default function PanelLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!session.accessToken || !session.siteId) {
      router.replace('/giris');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Yükleniyor...
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Sidebar />
      <Topbar />
      <main className="pl-[var(--sidebar-width)] pt-14">
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
