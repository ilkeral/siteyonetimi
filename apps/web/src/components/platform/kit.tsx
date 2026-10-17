'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ORGANIZATION_KIND_LABELS,
  ORGANIZATION_STATUS_LABELS,
  type AccessLevel,
  type OrganizationStatus,
} from '@sy/shared';
import { api, ApiError, session } from '@/lib/api';

/**
 * PLATFORM PANELİ ORTAK PARÇALARI — yalnızca `pf-*` sınıfları (platform.css).
 * Müşteri panelinin bileşenleri (components/ui.tsx) burada kullanılmaz:
 * onlar Bizzark/Bootstrap sınıflarına bağlı ve o tema bu düzende yüklenmiyor.
 */

export const Icon = ({ name, size }: { name: string; size?: number }) => (
  <span className="pf-icon" style={size ? { fontSize: size } : undefined} aria-hidden="true">
    {name}
  </span>
);

const TRY = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 });
const NUMBER = new Intl.NumberFormat('tr-TR');
const DATE = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const DATETIME = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const fmt = {
  tl: (value: number) => TRY.format(value),
  num: (value: number) => NUMBER.format(value),
  date: (value: string | Date | null | undefined) => (value ? DATE.format(new Date(value)) : '—'),
  dateTime: (value: string | Date | null | undefined) => (value ? DATETIME.format(new Date(value)) : '—'),
  /** <input type="date"> değeri (yerel) */
  dateInput: (value: string | Date | null | undefined) => {
    if (!value) return '';
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },
};

// ---------------------------------------------------------------- tipler

export interface LimitCheck {
  ok: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
}

export interface Access {
  level: AccessLevel;
  reason: string | null;
  daysLeft: number | null;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  monthlyPrice: number;
  maxSites: number | null;
  maxUnits: number | null;
  features: string[];
  isActive: boolean;
  order: number;
  organizationCount?: number;
}

export function usePlans() {
  return useQuery({ queryKey: ['platform', 'plans'], queryFn: () => api.get<Plan[]>('/platform/plans') });
}

// ---------------------------------------------------------------- rozetler

const STATUS_TONE: Record<OrganizationStatus, string> = {
  TRIAL: 'pf-badge--info',
  ACTIVE: 'pf-badge--success',
  PAST_DUE: 'pf-badge--warning',
  SUSPENDED: 'pf-badge--danger',
  CANCELLED: 'pf-badge',
};

export function StatusBadge({ status }: { status: OrganizationStatus }) {
  return <span className={`pf-badge ${STATUS_TONE[status]}`}>{ORGANIZATION_STATUS_LABELS[status]}</span>;
}

export function AccessBadge({ access }: { access: Access }) {
  if (access.level === 'FULL') {
    return access.daysLeft !== null && access.daysLeft <= 7 ? (
      <span className="pf-badge pf-badge--warning">{access.daysLeft} gün kaldı</span>
    ) : null;
  }
  return (
    <span className={`pf-badge ${access.level === 'BLOCKED' ? 'pf-badge--danger' : 'pf-badge--warning'}`} title={access.reason ?? undefined}>
      <Icon name={access.level === 'BLOCKED' ? 'block' : 'lock'} size={14} />
      {access.level === 'BLOCKED' ? 'Erişim kapalı' : 'Salt okunur'}
    </span>
  );
}

export const kindLabel = (kind: keyof typeof ORGANIZATION_KIND_LABELS) => ORGANIZATION_KIND_LABELS[kind];

// ---------------------------------------------------------------- yapı taşları

export function PageHead({ title, subtitle, crumb, actions }: { title: string; subtitle?: ReactNode; crumb?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="pf-head">
      <div>
        {crumb && <div className="pf-crumb">{crumb}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="pf-actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, foot }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; foot?: ReactNode }) {
  return (
    <section className="pf-card">
      {(title || actions) && (
        <div className="pf-card__head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions}
        </div>
      )}
      {children}
      {foot && <div className="pf-card__foot">{foot}</div>}
    </section>
  );
}

export function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean }) {
  return (
    <div className={`pf-card pf-stat${accent ? ' pf-stat--accent' : ''}`}>
      <div className="pf-stat__label">{label}</div>
      <div className="pf-stat__value">{value}</div>
      {hint && <div className="pf-stat__hint">{hint}</div>}
    </div>
  );
}

export function Usage({ label, check }: { label: string; check: LimitCheck }) {
  const ratio = check.limit ? Math.min(1, check.used / check.limit) : 0;
  const tone = ratio >= 1 ? ' pf-meter--danger' : ratio >= 0.85 ? ' pf-meter--warning' : '';
  return (
    <div className="pf-usage">
      <div className="pf-usage__line">
        <span className="pf-strong">{label}</span>
        <span className="pf-muted">
          {fmt.num(check.used)} / {check.limit === null ? 'sınırsız' : fmt.num(check.limit)}
        </span>
      </div>
      {check.limit !== null && (
        <div className={`pf-meter${tone}`} role="progressbar" aria-valuenow={check.used} aria-valuemax={check.limit} aria-label={label}>
          <span style={{ width: `${ratio * 100}%` }} />
        </div>
      )}
    </div>
  );
}

export function ErrorAlert({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu';
  const details = error instanceof ApiError ? error.body?.errors : undefined;
  return (
    <div className="pf-alert pf-alert--danger" role="alert">
      <Icon name="warning" size={18} />
      <div>
        {message}
        {details && details.length > 0 && (
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {details.map((d, i) => (
              <li key={i}>{d.message}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="pf-field">
      <label>
        {label}
        {required && <span className="pf-req"> *</span>}
      </label>
      {children}
      {error ? <div className="pf-error-text">{error}</div> : hint && <div className="pf-hint">{hint}</div>}
    </div>
  );
}

export const Loading = () => <div className="pf-loading">Yükleniyor...</div>;

/** Bir kez gösterilen geçici parola — kopyalama düğmesiyle */
export function SecretBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="pf-secret">
      <span style={{ flex: 1 }}>{value}</span>
      <button
        type="button"
        className="pf-btn pf-btn--sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        <Icon name="content_copy" size={16} />
        {copied ? 'Kopyalandı' : 'Kopyala'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- kabuk

interface Me {
  user: { id: string; fullName: string; email: string; isSuperAdmin: boolean };
}

const NAV = [
  { href: '/platform', label: 'Özet', icon: 'dashboard' },
  { href: '/platform/musteriler', label: 'Müşteriler', icon: 'business' },
  { href: '/platform/paketler', label: 'Paketler', icon: 'layers' },
  { href: '/platform/destek', label: 'Destek Erişimi', icon: 'headset_mic' },
  { href: '/platform/gunluk', label: 'İşlem Günlüğü', icon: 'history' },
];

/**
 * Platform kabuğu: yalnızca süper yönetici. Oturum yoksa ya da kullanıcı
 * platform yöneticisi değilse platform girişine yönlendirir.
 */
export function PlatformShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [hasToken, setHasToken] = useState<boolean | null>(null);

  useEffect(() => {
    const token = !!session.accessToken;
    setHasToken(token);
    if (!token) router.replace('/platform/giris');
  }, [router]);

  const { data: me, isError } = useQuery({
    queryKey: ['platform', 'me'],
    queryFn: () => api.get<Me>('/auth/me'),
    enabled: hasToken === true,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (isError || (me && !me.user.isSuperAdmin)) router.replace('/platform/giris');
  }, [me, isError, router]);

  useEffect(() => setOpen(false), [pathname]);

  function logout() {
    const refreshToken = session.refreshToken;
    if (refreshToken) void api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    session.clear();
    queryClient.clear();
    router.replace('/platform/giris');
  }

  if (!me?.user.isSuperAdmin) return <Loading />;

  const isActive = (href: string) => (href === '/platform' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <div className={`pf-shell${open ? ' is-open' : ''}`}>
      <aside className="pf-side" aria-label="Platform menüsü">
        <div className="pf-brand">
          <span className="pf-brand__mark">SY</span>
          <span>
            Site Yönetim
            <small>Platform Yönetimi</small>
          </span>
        </div>
        <ul className="pf-nav">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className={isActive(item.href) ? 'is-active' : undefined}>
                <Icon name={item.icon} />
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="pf-side__foot">
          <div className="pf-strong" style={{ color: '#e2e8f0' }}>{me.user.fullName}</div>
          <div>{me.user.email}</div>
          <a href="/kilavuz" target="_blank" rel="noopener" style={{ display: 'block', marginTop: 8, color: '#a5b4fc' }}>
            Kullanım kılavuzu
          </a>
          <button type="button" className="pf-btn pf-btn--sm" onClick={logout}>
            <Icon name="exit_to_app" size={16} />
            Çıkış
          </button>
        </div>
      </aside>
      <div className="pf-main">
        <div className="pf-top">
          <button type="button" aria-label="Menüyü aç" onClick={() => setOpen((v) => !v)}>
            <Icon name="menu" />
          </button>
          <strong>Platform Yönetimi</strong>
        </div>
        <main className="pf-content">{children}</main>
      </div>
      {open && <div style={{ position: 'fixed', inset: 0, zIndex: 25 }} onClick={() => setOpen(false)} aria-hidden="true" />}
    </div>
  );
}
