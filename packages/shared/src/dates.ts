export const APP_TIMEZONE = 'Europe/Istanbul';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const targetMonth = d.getMonth() + months;
  d.setMonth(targetMonth);
  return d;
}

/** 'YYYY-MM' */
export type Period = string;

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidPeriod(period: string): boolean {
  return PERIOD_RE.test(period);
}

export function toPeriod(date: Date): Period {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function periodToDate(period: Period): Date {
  if (!isValidPeriod(period)) throw new Error(`Geçersiz dönem: ${period}`);
  const [year, month] = period.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

export function nextPeriod(period: Period): Period {
  return toPeriod(addMonths(periodToDate(period), 1));
}

export function previousPeriod(period: Period): Period {
  return toPeriod(addMonths(periodToDate(period), -1));
}

const TR_MONTHS = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];

/** '2026-08' → '2026 Ağustos' */
export function formatPeriodTR(period: Period): string {
  const d = periodToDate(period);
  return `${d.getFullYear()} ${TR_MONTHS[d.getMonth()]}`;
}

const TR_MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

/** '2026-08' → 'Ağu 2026' — dar tablo sütun başlıkları için */
export function formatPeriodShortTR(period: Period): string {
  const d = periodToDate(period);
  return `${TR_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Bir dönemin son ödeme tarihi: o ayın `dayOfMonth`'ı.
 * Ay o günü içermiyorsa (ör. 31 Şubat) ayın son günü kullanılır.
 */
export function dueDateForPeriod(period: Period, dayOfMonth: number): Date {
  const first = periodToDate(period);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(dayOfMonth, lastDay));
}

export function formatDateTR(date: Date): string {
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short' }).format(date);
}

/** Bir tarihin, tarihli daire-kişi ilişkisi aralığına düşüp düşmediği */
export function isWithin(date: Date, start: Date, end?: Date | null): boolean {
  const t = startOfDay(date).getTime();
  if (t < startOfDay(start).getTime()) return false;
  if (end && t > startOfDay(end).getTime()) return false;
  return true;
}
