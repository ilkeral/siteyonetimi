/** Arayüz biçimlendirme yardımcıları — tüm ekranlar bunları kullanır. */

const TRY = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  minimumFractionDigits: 2,
});

const NUMBER = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const DATE = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short' });
const DATETIME = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' });

/** API'den gelen kuruş değerini "1.234,56 ₺" yapar */
export function money(minor: number | null | undefined): string {
  return TRY.format((minor ?? 0) / 100);
}

/** Grafik eksenleri için kısa gösterim: 55.4B ₺ */
export function moneyShort(minor: number): string {
  const value = minor / 100;
  if (Math.abs(value) >= 1_000_000) return `${NUMBER.format(value / 1_000_000)}M`;
  if (Math.abs(value) >= 1000) return `${NUMBER.format(value / 1000)}B`;
  return NUMBER.format(value);
}

export function date(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return DATE.format(new Date(value));
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return DATETIME.format(new Date(value));
}

/** Bugünün tarihi, <input type="date"> için */
export function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Bakiye rengini belirler: borçlu kırmızı, alacaklı (avans) yeşil */
export function balanceClass(minor: number): string {
  if (minor > 0) return 'text-red-600';
  if (minor < 0) return 'text-emerald-600';
  return 'text-slate-500';
}

export const CHART_COLORS = [
  '#257deb', '#16a34a', '#ea580c', '#7c3aed', '#0891b2',
  '#dc2626', '#ca8a04', '#db2777', '#059669', '#4f46e5',
  '#64748b', '#9333ea',
];
