import { z } from 'zod';

/**
 * SİTE PARAMETRELERİ
 *
 * Yalnızca bir hesapta/akışta gerçekten okunan alanlar düzenlenebilir.
 * Şema `.strict()`: bilinmeyen alan (siteId, iç içe `site` yazması vb.)
 * reddedilir — gövde doğrudan veritabanına gider.
 */

/** KMK m.20: gecikme tazminatı aylık %5 hesabıyla; yönetim planıyla aşılamaz */
export const LATE_FEE_MONTHLY_MAX = 5;
/** Günlük oran 30 günde aylık tavanı aşmasın */
export const LATE_FEE_DAILY_MAX = Math.floor((LATE_FEE_MONTHLY_MAX / 30) * 10_000) / 10_000;

export const DUES_LIABILITY_LABELS = {
  OCCUPANT: 'Oturana (kiracı varsa kiracıya)',
  OWNER: 'Kat malikine',
} as const;

export const LATE_FEE_METHOD_LABELS = {
  MONTHLY_PERCENT: 'Aylık yüzde (başlayan ay tam sayılır)',
  DAILY_PERCENT: 'Günlük yüzde',
  NONE: 'Uygulanmaz',
} as const;

export const siteSettingsSchema = z
  .object({
    duesDistributionMethod: z.enum(['EQUAL', 'BY_AREA', 'BY_LAND_SHARE', 'BY_SHARE_RATIO']),
    duesLiabilityRule: z.enum(['OWNER', 'OCCUPANT']),

    applyLateFee: z.boolean(),
    lateFeeMethod: z.enum(['MONTHLY_PERCENT', 'DAILY_PERCENT', 'NONE']),
    lateFeeRate: z.coerce.number().min(0, 'Oran negatif olamaz'),
    lateFeeGraceDays: z.coerce.number().int('Tam gün giriniz').min(0).max(365),

    requireNationalId: z.boolean(),
    requireEmail: z.boolean(),
    requireMobilePhone: z.boolean(),
    requireVisitorId: z.boolean(),

    notificationSenderName: z.string().trim().max(60).nullable(),
    notificationFooter: z.string().trim().max(500).nullable(),

    autoMatchBankTransactions: z.boolean(),
  })
  .strict()
  .superRefine((s, ctx) => {
    const max = s.lateFeeMethod === 'DAILY_PERCENT' ? LATE_FEE_DAILY_MAX : LATE_FEE_MONTHLY_MAX;
    if (s.lateFeeMethod !== 'NONE' && s.lateFeeRate > max) {
      ctx.addIssue({
        code: 'custom',
        path: ['lateFeeRate'],
        message:
          s.lateFeeMethod === 'DAILY_PERCENT'
            ? `Günlük oran en fazla %${LATE_FEE_DAILY_MAX} olabilir (30 günde aylık %${LATE_FEE_MONTHLY_MAX})`
            : `KMK m.20 gereği aylık oran en fazla %${LATE_FEE_MONTHLY_MAX} olabilir`,
      });
    }
  });

export type SiteSettingsInput = z.infer<typeof siteSettingsSchema>;
