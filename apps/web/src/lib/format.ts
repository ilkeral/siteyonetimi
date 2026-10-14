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
  if (minor > 0) return 'text-danger';
  if (minor < 0) return 'text-success';
  return 'text-muted';
}

/** Grafik paleti — tema değişkenlerinden (_variables.scss) türetildi */
export const CHART_COLORS = [
  '#4B98CF', '#4EB4A5', '#E3AA75', '#5163C5', '#16BA71',
  '#346384', '#939FAD', '#EA4C89', '#42b883', '#D32F2F',
  '#00aced', '#3b5998',
];

export const CHART_SUCCESS = '#4EB4A5';
export const CHART_DANGER = '#dc3545';

/** Koyu modda grafik ekseni/metni okunur kalsın diye */
export function chartTextColor(): string {
  if (typeof document === 'undefined') return '#374D67';
  return document.documentElement.getAttribute('data-theme') === 'dark'
    ? 'rgba(227, 236, 242, 0.7)'
    : 'rgba(55, 77, 103, 0.7)';
}
