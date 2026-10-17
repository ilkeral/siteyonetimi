/**
 * ÖDEME SKORU (0–5) — saf hesap
 *
 * Kişinin son 6 ayda vadesi gelen borçlarını ne oranda, ne kadar zamanında ve
 * hangi kanaldan ödediğini tek bir puana indirger:
 *
 *   %50  tahsilat oranı      — vadesi gelen borcun ödenen kısmı
 *   %30  zamanlama           — tutar ağırlıklı "vadeden kaç gün önce/sonra"
 *   %10  gecikme tazminatı   — tazminat yükü / vadesi gelen borç (az = iyi)
 *   %10  dijital kanal payı  — havale/EFT + kart / toplam tahsilat
 *
 * Kapatma tarihi saklanmaz, defterdeki kuralla TÜRETİLİR: alacaklar borçlara
 * vade sırasıyla (FIFO) uygulanır. Bir borcu son kuruşuna kadar kapatan
 * tahsilatın tarihi o borcun ödeme tarihidir.
 */

export type PaymentChannel = 'BANK_TRANSFER' | 'CARD' | 'CASH' | 'OTHER';

export const PAYMENT_CHANNELS: readonly PaymentChannel[] = ['BANK_TRANSFER', 'CARD', 'CASH', 'OTHER'];

const DIGITAL: readonly PaymentChannel[] = ['BANK_TRANSFER', 'CARD'];

const DAY_MS = 86_400_000;

export interface ScoreDebt {
  id: string;
  /** Evrak tarihi */
  date: Date;
  /** Son ödeme tarihi; yoksa evrak tarihi vade sayılır */
  dueDate: Date | null;
  amountMinor: number;
  isLateFee: boolean;
}

export interface ScoreCredit {
  date: Date;
  amountMinor: number;
  channel: PaymentChannel;
}

export interface DebtAllocation {
  id: string;
  paidMinor: number;
  /** Tamamen kapandıysa kapanış tarihi */
  settledAt: Date | null;
}

const dueOf = (debt: ScoreDebt) => debt.dueDate ?? debt.date;

/**
 * Alacakları borçlara vade sırasıyla uygular (ledger.openItems ile aynı kural).
 * Avans (borçtan önce yapılan ödeme) borcu, borcun doğduğu gün kapatmış sayılır.
 */
export function allocateFifo(debts: readonly ScoreDebt[], credits: readonly ScoreCredit[]): DebtAllocation[] {
  const orderedDebts = [...debts].sort((a, b) => dueOf(a).getTime() - dueOf(b).getTime() || a.date.getTime() - b.date.getTime());
  const orderedCredits = [...credits].filter((c) => c.amountMinor > 0).sort((a, b) => a.date.getTime() - b.date.getTime());

  let index = 0;
  let remaining = orderedCredits[0]?.amountMinor ?? 0;
  const result: DebtAllocation[] = [];

  for (const debt of orderedDebts) {
    let paid = 0;
    let lastDate: Date | null = null;
    while (paid < debt.amountMinor && index < orderedCredits.length) {
      const take = Math.min(remaining, debt.amountMinor - paid);
      paid += take;
      remaining -= take;
      lastDate = orderedCredits[index].date;
      if (remaining === 0) {
        index++;
        remaining = orderedCredits[index]?.amountMinor ?? 0;
      }
    }
    const settled = paid >= debt.amountMinor && debt.amountMinor > 0;
    result.push({
      id: debt.id,
      paidMinor: paid,
      settledAt: settled && lastDate ? new Date(Math.max(lastDate.getTime(), debt.date.getTime())) : null,
    });
  }
  return result;
}

export interface PaymentScoreResult {
  /** Penceresinde vadesi gelen borcu yoksa null (skorlanmaz) */
  score: number | null;
  collectionRate: number;
  /** Pozitif = peşin (vadeden önce) ödeme günü */
  avgDaysEarly: number;
  dueMinor: number;
  paidMinor: number;
  lateFeeCollectedMinor: number;
  channels: Record<PaymentChannel, number>;
}

/** Zamanlama puanı: 5+ gün erken → 5, vadesinde → 4, 30 gün geç → 2, 90+ gün geç → 0 */
export function timingScore(daysEarly: number): number {
  if (daysEarly >= 5) return 5;
  if (daysEarly >= 0) return 4 + daysEarly / 5;
  if (daysEarly >= -30) return 4 + (daysEarly * 2) / 30;
  if (daysEarly >= -90) return 2 + ((daysEarly + 30) * 2) / 60;
  return 0;
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

export function computePaymentScore(
  debts: readonly ScoreDebt[],
  credits: readonly ScoreCredit[],
  asOf: Date,
  windowMonths = 6,
): PaymentScoreResult {
  const windowStart = new Date(asOf);
  windowStart.setMonth(windowStart.getMonth() - windowMonths);

  // Gelecekteki tahsilat skora giremez (geçmiş tarihli hesap yeniden üretilebilsin)
  const knownCredits = credits.filter((c) => c.date <= asOf);
  const allocation = new Map(allocateFifo(debts, knownCredits).map((a) => [a.id, a]));

  const inWindow = (date: Date) => date >= windowStart && date <= asOf;
  const dueDebts = debts.filter((d) => !d.isLateFee && inWindow(dueOf(d)));
  const lateFees = debts.filter((d) => d.isLateFee && inWindow(dueOf(d)));

  const channels = Object.fromEntries(PAYMENT_CHANNELS.map((c) => [c, 0])) as Record<PaymentChannel, number>;
  for (const credit of knownCredits) {
    if (inWindow(credit.date)) channels[credit.channel] += credit.amountMinor;
  }

  const dueMinor = dueDebts.reduce((acc, d) => acc + d.amountMinor, 0);
  const paidMinor = dueDebts.reduce((acc, d) => acc + Math.min(d.amountMinor, allocation.get(d.id)?.paidMinor ?? 0), 0);
  const lateFeeAccrued = lateFees.reduce((acc, d) => acc + d.amountMinor, 0);
  const lateFeeCollectedMinor = lateFees.reduce((acc, d) => acc + (allocation.get(d.id)?.paidMinor ?? 0), 0);

  if (dueMinor === 0) {
    return { score: null, collectionRate: 0, avgDaysEarly: 0, dueMinor, paidMinor, lateFeeCollectedMinor, channels };
  }

  // Tutar ağırlıklı zamanlama: kapanmayan borç bugüne kadar geç sayılır
  let weightedDays = 0;
  for (const debt of dueDebts) {
    const settledAt = allocation.get(debt.id)?.settledAt;
    const days = settledAt
      ? (dueOf(debt).getTime() - settledAt.getTime()) / DAY_MS
      : -(asOf.getTime() - dueOf(debt).getTime()) / DAY_MS;
    weightedDays += days * debt.amountMinor;
  }
  const avgDaysEarly = weightedDays / dueMinor;

  const collectionRate = paidMinor / dueMinor;
  const totalCredit = PAYMENT_CHANNELS.reduce((acc, c) => acc + channels[c], 0);
  const digitalShare = totalCredit > 0 ? DIGITAL.reduce((acc, c) => acc + channels[c], 0) / totalCredit : 0;
  // Borcun %10'u kadar tazminat yükü puanı sıfırlar
  const lateFeeScore = 5 * (1 - Math.min(1, (lateFeeAccrued / dueMinor) * 10));

  const score = 0.5 * collectionRate * 5 + 0.3 * timingScore(avgDaysEarly) + 0.1 * lateFeeScore + 0.1 * digitalShare * 5;

  return {
    score: round(Math.min(5, Math.max(0, score)), 1),
    collectionRate: round(collectionRate, 4),
    avgDaysEarly: round(avgDaysEarly, 1),
    dueMinor,
    paidMinor,
    lateFeeCollectedMinor,
    channels,
  };
}

export type ScoreSegment = 'HIGH' | 'MID' | 'LOW';

/** 4 ve üzeri / 2–4 / 2 altı */
export function scoreSegment(score: number): ScoreSegment {
  if (score >= 4) return 'HIGH';
  if (score >= 2) return 'MID';
  return 'LOW';
}

export interface SiteScoreSummary {
  averageScore: number | null;
  scoredCount: number;
  highCount: number;
  midCount: number;
  lowCount: number;
  channels: Record<PaymentChannel, number>;
}

export function summarizeScores(results: readonly PaymentScoreResult[]): SiteScoreSummary {
  const scored = results.filter((r): r is PaymentScoreResult & { score: number } => r.score !== null);
  const channels = Object.fromEntries(PAYMENT_CHANNELS.map((c) => [c, 0])) as Record<PaymentChannel, number>;
  for (const result of results) for (const c of PAYMENT_CHANNELS) channels[c] += result.channels[c];

  const segments = scored.map((r) => scoreSegment(r.score));
  return {
    averageScore: scored.length ? round(scored.reduce((acc, r) => acc + r.score, 0) / scored.length, 1) : null,
    scoredCount: scored.length,
    highCount: segments.filter((s) => s === 'HIGH').length,
    midCount: segments.filter((s) => s === 'MID').length,
    lowCount: segments.filter((s) => s === 'LOW').length,
    channels,
  };
}

/**
 * Siteler arası kıyas yalnızca yeterli sayıda site varsa gösterilir:
 * tek-iki sitelik "il ortalaması" o sitelerin verisini ifşa eder.
 */
export const BENCHMARK_MIN_SITES = 3;
