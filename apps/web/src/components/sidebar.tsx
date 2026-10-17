'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { PlanFeature } from '@sy/shared';
import { useMe } from '@/lib/me';

/**
 * Ana menü — yalnızca çalışan modüller. Müşterinin paketinde olmayan modül
 * kilitli görünür ve tıklanamaz (`feature`); asıl denetim API'dedir.
 *
 * İkonlar Material Design Icons (tema ile birlikte geliyor).
 */
interface MenuChild {
  href: string;
  label: string;
  /** Müşterinin paketinde yoksa kilitli görünür */
  feature?: PlanFeature;
}

interface MenuItem {
  href: string;
  label: string;
  icon: string;
  /** Müşterinin paketinde yoksa kilitli görünür (tıklanamaz) */
  feature?: PlanFeature;
  locked?: boolean;
  children?: (MenuChild & { locked?: boolean })[];
}

export const MENU: MenuItem[] = [
  { href: '/ozet', label: 'Özet', icon: 'dashboard' },
  {
    href: '/site',
    label: 'Site',
    icon: 'location_city',
    children: [
      { href: '/site', label: 'Kişiler' },
      { href: '/site/daireler', label: 'Daireler' },
      { href: '/site/ice-aktar', label: 'Toplu Aktarım' },
    ],
  },
  {
    href: '/finans',
    label: 'Finans',
    icon: 'account_balance_wallet',
    children: [
      { href: '/finans', label: 'Cari Hesaplar' },
      { href: '/finans/aidat', label: 'Aidat Tahakkuku' },
      { href: '/finans/tahsilat', label: 'Tahsilat' },
      { href: '/finans/gider', label: 'Gider Faturası' },
      { href: '/finans/banka', label: 'Banka Hareketleri' },
    ],
  },
  {
    href: '/sayac',
    label: 'Sayaç İşlemleri',
    icon: 'av_timer',
    feature: 'meters',
    children: [
      { href: '/sayac', label: 'Dağıtımlar' },
      { href: '/sayac/yeni', label: 'Yeni Dağıtım' },
    ],
  },
  {
    href: '/raporlar',
    label: 'Raporlar',
    icon: 'assessment',
    children: [
      { href: '/raporlar/ekstre', label: 'Cari Ekstre' },
      { href: '/raporlar/yaslandirma', label: 'Borç Yaşlandırma' },
      { href: '/raporlar/gelir-gider', label: 'Gelir-Gider', feature: 'reports' },
      { href: '/raporlar/odeme-skoru', label: 'Ödeme Skoru', feature: 'reports' },
    ],
  },
  {
    href: '/teknik',
    label: 'Teknik',
    icon: 'build',
    feature: 'tickets',
    children: [
      { href: '/teknik', label: 'İş Takibi' },
      { href: '/teknik/liste', label: 'Talep Listesi' },
      { href: '/teknik/yeni', label: 'Yeni Talep' },
    ],
  },
  {
    href: '/iletisim',
    label: 'İletişim',
    icon: 'mail_outline',
    children: [
      { href: '/iletisim', label: 'Bildirimler', feature: 'notifications' },
      { href: '/iletisim/yeni', label: 'Yeni Bildirim', feature: 'notifications' },
      { href: '/iletisim/sablonlar', label: 'Şablonlar', feature: 'notifications' },
      { href: '/iletisim/duyurular', label: 'Duyurular', feature: 'portal' },
    ],
  },
  {
    href: '/guvenlik',
    label: 'Güvenlik',
    icon: 'security',
    feature: 'security',
    children: [
      { href: '/guvenlik', label: 'Özet' },
      { href: '/guvenlik/ziyaretci', label: 'Ziyaretçiler' },
      { href: '/guvenlik/olaylar', label: 'Olay Kayıtları' },
      { href: '/guvenlik/kayip-esya', label: 'Kayıp Eşya' },
    ],
  },
  {
    href: '/tanimlar',
    label: 'Tanımlar',
    icon: 'settings',
    children: [{ href: '/tanimlar/parametreler', label: 'Parametreler' }],
  },
];

export function Sidebar({ mini }: { mini: boolean }) {
  const pathname = usePathname();
  const { hasFeature } = useMe();
  // Paketteki modüller: kilit yalnızca arayüz ipucu, asıl denetim API'de (403)
  const menu = MENU.map((item) => ({
    ...item,
    locked: !!item.feature && !hasFeature(item.feature),
    children: item.children?.map((child) => ({ ...child, locked: !!child.feature && !hasFeature(child.feature) })),
  }));

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
      <MenuList items={menu} mini={mini} pathname={pathname} />

      <div className="sy-sidebar-footer">Sürüm 0.8.0 — SaaS</div>
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
          const usable = !item.locked;
          const showChildren = active && !mini && item.children && usable;

          return (
            <li
              key={item.href}
              // `open`: temanın CSS'i alt menüyü yalnızca bu sınıfla gösteriyor
              className={[
                'sidebar-menu-item',
                active ? 'active' : '',
                showChildren ? 'open' : '',
                usable ? '' : 'disabled',
              ]
                .filter(Boolean)
                .join(' ')}
              data-label={item.label}
            >
              {usable ? (
                <Link href={item.href} className="sidebar-menu-button">
                  <i className="sidebar-menu-icon sidebar-menu-icon--left material-icons">
                    {item.icon}
                  </i>
                  <span className="sidebar-menu-text">{item.label}</span>
                </Link>
              ) : (
                <span className="sidebar-menu-button" title="Paketinizde yok">
                  <i className="sidebar-menu-icon sidebar-menu-icon--left material-icons">
                    {item.icon}
                  </i>
                  <span className="sidebar-menu-text">{item.label}</span>
                  {item.locked && !mini && <i className="material-icons sy-menu-lock" aria-label="Paketinizde yok">lock</i>}
                </span>
              )}

              {showChildren && (
                <ul className="sidebar-submenu collapse show">
                  {item.children!.map((child) => (
                    <li
                      key={child.href}
                      className={`sidebar-menu-item${pathname === child.href ? ' active' : ''}`}
                    >
                      {child.locked ? (
                        <span className="sidebar-menu-button sy-menu-locked" title="Paketinizde yok">
                          <span className="sidebar-menu-text">{child.label}</span>
                          <i className="material-icons sy-menu-lock" aria-label="Paketinizde yok">lock</i>
                        </span>
                      ) : (
                        <Link href={child.href} className="sidebar-menu-button">
                          <span className="sidebar-menu-text">{child.label}</span>
                        </Link>
                      )}
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
