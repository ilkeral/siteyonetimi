import type { ReactNode } from 'react';
import { PlatformShell } from '@/components/platform/kit';

export default function PlatformShellLayout({ children }: { children: ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>;
}
