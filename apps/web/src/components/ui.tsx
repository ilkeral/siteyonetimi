'use client';

import type { ReactNode } from 'react';

/**
 * Ortak arayüz parçaları — hepsi tema (Bizzark / Bootstrap 4) sınıflarını
 * kullanır. Kendi CSS'imiz yalnızca custom.css'teki `sy-*` sınıflarıdır.
 */

export function PageHeader({
  title,
  subtitle,
  breadcrumb,
  actions,
}: {
  title: string;
  subtitle?: string;
  /** Örn. ['Finans', 'Aidat Tahakkuku'] — başında otomatik "Ana Sayfa" olur */
  breadcrumb?: string[];
  actions?: ReactNode;
}) {
  return (
    <div className="sy-page-heading">
      <div>
        <div className="sy-page-heading__crumb">
          Ana Sayfa
          {(breadcrumb ?? [title]).map((crumb) => (
            <span key={crumb}>
              <i className="material-icons">chevron_right</i>
              {crumb}
            </span>
          ))}
        </div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && (
        <div className="d-flex align-items-center flex-wrap" style={{ gap: '.5rem' }}>
          {actions}
        </div>
      )}
    </div>
  );
}

/** Panodaki hızlı erişim kutuları (referans temadaki "quick access" satırı) */
export function QuickLink({
  href,
  icon,
  label,
  color,
}: {
  href: string;
  icon: string;
  label: string;
  color: string;
}) {
  return (
    <a href={href} className="sy-quick">
      <span className="sy-quick__icon" style={{ background: color }}>
        <i className="material-icons">{icon}</i>
      </span>
      {label}
    </a>
  );
}

export function Card({
  title,
  actions,
  children,
  className = '',
  bodyClassName,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={`card card-shadow ${className}`}>
      {title && (
        <div className="card-header d-flex align-items-center">
          <h5 className="card-header__title m-0 flex">{title}</h5>
          {actions}
        </div>
      )}
      {bodyClassName !== undefined ? (
        <div className={bodyClassName}>{children}</div>
      ) : (
        children
      )}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: string;
  tone?: 'default' | 'warning' | 'danger' | 'success' | 'primary';
}) {
  const toneClass = {
    default: '',
    primary: 'text-primary',
    warning: 'text-warning',
    danger: 'text-danger',
    success: 'text-success',
  }[tone];

  return (
    <div className="card card-shadow mb-0 h-100">
      <div className="card-body d-flex align-items-center">
        {icon && (
          <span className={`material-icons mr-3 ${toneClass || 'text-muted'}`} style={{ fontSize: 34 }}>
            {icon}
          </span>
        )}
        <div className="flex">
          <div className="sy-stat__label">{label}</div>
          <div className={`sy-stat__value sy-num ${toneClass}`}>{value}</div>
          {hint && <div className="text-muted" style={{ fontSize: 12 }}>{hint}</div>}
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ message, icon = 'inbox' }: { message: string; icon?: string }) {
  return (
    <div className="text-center text-muted py-5">
      <i className="material-icons d-block mb-2" style={{ fontSize: 40, opacity: 0.4 }}>
        {icon}
      </i>
      {message}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="alert alert-danger" role="alert">
      {error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu'}
    </div>
  );
}

export function SuccessBox({ children }: { children: ReactNode }) {
  return (
    <div className="alert alert-success" role="status">
      {children}
    </div>
  );
}

export function Loading({ label = 'Yükleniyor...' }: { label?: string }) {
  return (
    <div className="d-flex align-items-center text-muted py-4">
      <div className="spinner-border spinner-border-sm mr-2" role="status" aria-hidden="true" />
      {label}
    </div>
  );
}

/** A–Z harf filtresi — listelerin üstündeki şerit */
const TR_LETTERS = 'ABCÇDEFGHIİJKLMNOÖPRSŞTUÜVYZ'.split('');

export function LetterFilter({
  value,
  onChange,
}: {
  value?: string;
  onChange: (letter?: string) => void;
}) {
  return (
    <div className="sy-letters">
      <button type="button" className={!value ? 'active' : ''} onClick={() => onChange(undefined)}>
        Tümü
      </button>
      {TR_LETTERS.map((letter) => (
        <button
          key={letter}
          type="button"
          className={value === letter ? 'active' : ''}
          onClick={() => onChange(letter)}
        >
          {letter}
        </button>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  pageCount,
  total,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="card-footer d-flex align-items-center justify-content-between">
      <span className="text-muted small">
        Toplam <strong>{total}</strong> kayıt
      </span>
      <nav>
        <ul className="pagination pagination-sm m-0">
          <li className={`page-item${page <= 1 ? ' disabled' : ''}`}>
            <button type="button" className="page-link" onClick={() => onChange(page - 1)}>
              Önceki
            </button>
          </li>
          <li className="page-item disabled">
            <span className="page-link">
              {page} / {pageCount}
            </span>
          </li>
          <li className={`page-item${page >= pageCount ? ' disabled' : ''}`}>
            <button type="button" className="page-link" onClick={() => onChange(page + 1)}>
              Sonraki
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}

export function Badge({
  children,
  tone = 'secondary',
}: {
  children: ReactNode;
  tone?: 'secondary' | 'success' | 'danger' | 'warning' | 'primary' | 'purple' | 'teal';
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** Tablo kabuğu — tema tablolarının yoğun görünümü */
export function Table({
  head,
  children,
  className = '',
}: {
  head: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="table-responsive">
      <table className={`table table-sm table-nowrap table-hover mb-0 ${className}`}>
        <thead className="thead-light">{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
