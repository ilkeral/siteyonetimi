'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { session } from '@/lib/api';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(session.accessToken && session.siteId ? '/ozet' : '/giris');
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
      Yönlendiriliyor...
    </div>
  );
}
