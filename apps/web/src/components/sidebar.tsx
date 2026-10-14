'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

/**
 * Ana menü — Apsiyon'daki 13 modülün karşılığı.
 * `ready: false` olanlar sonraki fazlarda açılacak; menüde görünür ama pasiftir,
 * böylece ürünün bütünü baştan görünür olur.
 */
export const MENU = [
  { href: '/ozet', label: 'Özet', icon: '▦', ready: true },
  { href: '/site', label: 'Site', icon: '🏢', ready: true },
  { href: '/finans', label: 'Finans', icon: '₺', ready: false },
  { href: '/sayac', label: 'Sayaç İşlemleri', icon: '⏱', ready: false },
  { href: '/raporlar', label: 'Raporlar', icon: '📊', ready: false },
  { href: '/guvenlik', label: 'Güvenlik', icon: '🛡', ready: false },
  { href: '/teknik', label: 'Teknik', icon: '🔧', ready: false },
  { href: '/tanimlar', label: 'Tanımlar', icon: '⚙', ready: false },
  { href: '/iletisim', label: 'İletişim', icon: '✉', ready: false },
  { href: '/ada', label: 'ADA', icon: '🗺', ready: false },
  { href: '/web-sitesi', label: 'Web Sitesi', icon: '🌐', ready: false },
  { href: '/sigorta', label: 'Sigorta', icon: '📄', ready: false },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-20 flex w-[var(--sidebar-width)] flex-col border-r border-slate-200 bg-white">
      <div className="flex h-14 items-center gap-2 border-b border-slate-100 px-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
          SY
        </span>
        <span className="text-sm font-semibold text-slate-800">Site Yönetim</span>
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        <ul className="space-y-0.5 px-2">
          {MENU.map((item) => {
            const active = pathname.startsWith(item.href);
            const className = clsx(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-brand-50 font-medium text-brand-700'
                : item.ready
                  ? 'text-slate-600 hover:bg-slate-50'
                  : 'cursor-not-allowed text-slate-300',
            );

            return (
              <li key={item.href}>
                {item.ready ? (
                  <Link href={item.href} className={className}>
                    <span className="w-4 text-center">{item.icon}</span>
                    {item.label}
                  </Link>
                ) : (
                  <span className={className} title="Sonraki fazda">
                    <span className="w-4 text-center">{item.icon}</span>
                    {item.label}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-400">
        Sürüm 0.1.0 — Faz 0
      </div>
    </aside>
  );
}
