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
    <div
      className="d-flex align-items-center justify-content-center text-muted"
      style={{ minHeight: '100vh' }}
    >
      Yönlendiriliyor...
    </div>
  );
}
