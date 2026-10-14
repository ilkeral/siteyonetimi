import { applyPercent } from './money';
import { daysBetween, startOfDay } from './dates';

export type LateFeeMethod = 'MONTHLY_PERCENT' | 'DAILY_PERCENT' | 'NONE';

export interface LateFeeInput {
  /** Gecikmiş anapara (kuruş) */
  principalMinor: number;
  dueDate: Date;
  /** Hesaplama tarihi (genelde bugün ya da ödeme tarihi) */
  asOf: Date;
  method: LateFeeMethod;
  /** Yüzde. MONTHLY_PERCENT için aylık, DAILY_PERCENT için günlük */
  rate: number;
  /** Tazminatsız gün sayısı */
  graceDays?: number;
  /**
   * Tazminatın başlatılacağı tarih (SiteSettings/dağıtım parametresi).
   * Verilirse dueDate yerine bu tarih esas alınır.
   */
  startDate?: Date | null;
}

export interface LateFeeResult {
  /** Tazminat tutarı (kuruş) */
  amountMinor: number;
  /** Gecikilen gün sayısı (grace sonrası) */
  overdueDays: number;
  /** MONTHLY_PERCENT'te başlatılan ay sayısı */
  overdueMonths: number;
}

/**
 * Gecikme tazminatı hesabı.
 *
 * MONTHLY_PERCENT: KMK m.20 mantığı — başlayan her ay için aylık oran uygulanır
 * (1 gün geçse bile o ay tam sayılır). Türkiye'deki site yönetimlerinin
 * yaygın uygulaması budur.
 *
 * DAILY_PERCENT: gün × günlük oran.
 *
 * Saf fonksiyon: yan etkisi yoktur, tablo bazlı test edilir.
 */
export function computeLateFee(input: LateFeeInput): LateFeeResult {
  const { principalMinor, method, rate, graceDays = 0 } = input;

  if (method === 'NONE' || principalMinor <= 0 || rate <= 0) {
    return { amountMinor: 0, overdueDays: 0, overdueMonths: 0 };
  }

  const base = startOfDay(input.startDate ?? input.dueDate);
  const asOf = startOfDay(input.asOf);

  const rawDays = daysBetween(base, asOf);
  const overdueDays = Math.max(0, rawDays - graceDays);
  if (overdueDays <= 0) {
    return { amountMinor: 0, overdueDays: 0, overdueMonths: 0 };
  }

  if (method === 'DAILY_PERCENT') {
    return {
      amountMinor: applyPercent(principalMinor, rate * overdueDays),
      overdueDays,
      overdueMonths: 0,
    };
  }

  // MONTHLY_PERCENT — başlayan ay tam sayılır
  const overdueMonths = Math.ceil(overdueDays / 30);
  return {
    amountMinor: applyPercent(principalMinor, rate * overdueMonths),
    overdueDays,
    overdueMonths,
  };
}
