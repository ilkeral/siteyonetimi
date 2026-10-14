'use client';

import clsx from 'clsx';
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-800">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx('card', className)}>
      {title && (
        <div className="card-header">
          <h2 className="card-title">{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}) {
  const toneClass = {
    default: 'text-slate-800',
    warning: 'text-amber-600',
    danger: 'text-red-600',
    success: 'text-emerald-600',
  }[tone];

  return (
    <div className="card px-5 py-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={clsx('mt-1 text-2xl font-semibold', toneClass)}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="px-5 py-12 text-center text-sm text-slate-400">{message}</div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {error instanceof Error ? error.message : 'Beklenmeyen bir hata oluştu'}
    </div>
  );
}

export function Loading({ label = 'Yükleniyor...' }: { label?: string }) {
  return <p className="px-1 py-6 text-sm text-slate-500">{label}</p>;
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
    <div className="flex flex-wrap gap-0.5 border-b border-slate-100 px-3 py-2">
      <button
        type="button"
        onClick={() => onChange(undefined)}
        className={clsx(
          'rounded px-2 py-0.5 text-xs transition',
          !value ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100',
        )}
      >
        Tümü
      </button>
      {TR_LETTERS.map((letter) => (
        <button
          key={letter}
          type="button"
          onClick={() => onChange(letter)}
          className={clsx(
            'w-6 rounded py-0.5 text-xs transition',
            value === letter ? 'bg-brand-600 text-white' : 'text-slate-500 hover:bg-slate-100',
          )}
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
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm">
      <span className="text-slate-500">
        Toplam <strong className="font-medium text-slate-700">{total}</strong> kayıt
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="btn-ghost px-3 py-1 text-xs"
        >
          Önceki
        </button>
        <span className="text-xs text-slate-500">
          {page} / {pageCount}
        </span>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => onChange(page + 1)}
          className="btn-ghost px-3 py-1 text-xs"
        >
          Sonraki
        </button>
      </div>
    </div>
  );
}

export function Badge({
  children,
  tone = 'slate',
}: {
  children: ReactNode;
  tone?: 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'purple';
}) {
  const tones = {
    slate: 'bg-slate-100 text-slate-600',
    green: 'bg-emerald-50 text-emerald-700',
    red: 'bg-red-50 text-red-700',
    amber: 'bg-amber-50 text-amber-700',
    blue: 'bg-brand-50 text-brand-700',
    purple: 'bg-purple-50 text-purple-700',
  };
  return (
    <span className={clsx('rounded px-1.5 py-0.5 text-[11px] font-medium', tones[tone])}>
      {children}
    </span>
  );
}

/** Basit tablo kabuğu — kolon başlıkları ve zebra olmadan, yoğun liste görünümü */
export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-100 bg-slate-50/60 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          {head}
        </thead>
        <tbody className="divide-y divide-slate-50">{children}</tbody>
      </table>
    </div>
  );
}
