'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Ana menü — Apsiyon'daki 13 modülün karşılığı.
 * `ready: false` olanlar sonraki fazlarda açılacak; menüde görünür ama
 * tıklanamaz, böylece ürünün bütünü baştan görünür olur.
 *
 * İkonlar Material Design Icons (tema ile birlikte geliyor).
 */
interface MenuItem {
  href: string;
  label: string;
  icon: string;
  ready: boolean;
  children?: { href: string; label: string }[];
}

export const MENU: MenuItem[] = [
  { href: '/ozet', label: 'Özet', icon: 'dashboard', ready: true },
  {
    href: '/site',
    label: 'Site',
    icon: 'apartment',
    ready: true,
    children: [
      { href: '/site', label: 'Kişiler' },
      { href: '/site/daireler', label: 'Daireler' },
    ],
  },
  {
    href: '/finans',
    label: 'Finans',
    icon: 'account_balance_wallet',
    ready: true,
    children: [
      { href: '/finans', label: 'Cari Hesaplar' },
      { href: '/finans/aidat', label: 'Aidat Tahakkuku' },
      { href: '/finans/tahsilat', label: 'Tahsilat' },
      { href: '/finans/gider', label: 'Gider Faturası' },
      { href: '/finans/banka', label: 'Banka Hareketleri' },
    ],
  },
  { href: '/sayac', label: 'Sayaç İşlemleri', icon: 'speed', ready: false },
  { href: '/raporlar', label: 'Raporlar', icon: 'assessment', ready: false },
  { href: '/guvenlik', label: 'Güvenlik', icon: 'security', ready: false },
  { href: '/teknik', label: 'Teknik', icon: 'build', ready: false },
  { href: '/tanimlar', label: 'Tanımlar', icon: 'settings', ready: false },
  { href: '/iletisim', label: 'İletişim', icon: 'mail_outline', ready: false },
  { href: '/ada', label: 'ADA', icon: 'map', ready: false },
  { href: '/web-sitesi', label: 'Web Sitesi', icon: 'public', ready: false },
  { href: '/sigorta', label: 'Sigorta', icon: 'verified_user', ready: false },
];

export function Sidebar({ mini }: { mini: boolean }) {
  const pathname = usePathname();

  function isActive(item: MenuItem): boolean {
    if (item.href === '/site') {
      return pathname === '/site' || pathname.startsWith('/site/');
    }
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  return (
    <div className="sidebar sidebar-primary sidebar-left sy-sidebar">
      <Link href="/ozet" className="sidebar-brand sidebar-brand-bg sy-brandblock">
        <span className="sy-brand__mark">SY</span>
        {!mini && <span>Site Yönetim</span>}
      </Link>

      {!mini && <div className="sidebar-heading">Ana Menü</div>}
      <MenuList items={MENU.filter((item) => item.ready)} mini={mini} pathname={pathname} />

      {!mini && <div className="sidebar-heading">Diğer Modüller</div>}
      <MenuList items={MENU.filter((item) => !item.ready)} mini={mini} pathname={pathname} />

      <div className="sy-sidebar-footer">Sürüm 0.1.0 — Faz 1</div>
    </div>
  );
}

function MenuList({
  items,
  mini,
  pathname,
}: {
  items: MenuItem[];
  mini: boolean;
  pathname: string;
}) {
  function isActive(item: MenuItem): boolean {
    if (item.href === '/site') {
      return pathname === '/site' || pathname.startsWith('/site/');
    }
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  return (
    <ul className="sidebar-menu">
      {items.map((item) => {
          const active = isActive(item);
          const showChildren = active && !mini && item.children && item.ready;

          return (
            <li
              key={item.href}
              // `open`: temanın CSS'i alt menüyü yalnızca bu sınıfla gösteriyor
              className={[
                'sidebar-menu-item',
                active ? 'active' : '',
                showChildren ? 'open' : '',
                item.ready ? '' : 'disabled',
              ]
                .filter(Boolean)
                .join(' ')}
              data-label={item.label}
            >
              {item.ready ? (
                <Link href={item.href} className="sidebar-menu-button">
                  <i className="sidebar-menu-icon sidebar-menu-icon--left material-icons">
                    {item.icon}
                  </i>
                  <span className="sidebar-menu-text">{item.label}</span>
                </Link>
              ) : (
                <span className="sidebar-menu-button" title="Sonraki fazda">
                  <i className="sidebar-menu-icon sidebar-menu-icon--left material-icons">
                    {item.icon}
                  </i>
                  <span className="sidebar-menu-text">{item.label}</span>
                </span>
              )}

              {showChildren && (
                <ul className="sidebar-submenu collapse show">
                  {item.children!.map((child) => (
                    <li
                      key={child.href}
                      className={`sidebar-menu-item${pathname === child.href ? ' active' : ''}`}
                    >
                      <Link href={child.href} className="sidebar-menu-button">
                        <span className="sidebar-menu-text">{child.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
      })}
    </ul>
  );
}
