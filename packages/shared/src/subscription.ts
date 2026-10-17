import { z } from 'zod';

/**
 * ABONELİK (SaaS) — SAF KURALLAR
 *
 * Müşteri (Organization) paketini ve abonelik durumunu taşır; her site bir
 * müşteriye bağlıdır ve sitenin erişim seviyesi ile açık modülleri buradan
 * türetilir.
 */

/** Paketle açılıp kapanan modüller. Kişi/daire, finans ve aidat her pakette vardır. */
export const PLAN_FEATURES = {
  tickets: 'İş Takibi',
  meters: 'Sayaç Paylaşımı',
  notifications: 'Toplu Bildirim (SMS / e-posta)',
  portal: 'İkamet Eden Portalı ve Online Ödeme',
  reports: 'Gelişmiş Raporlar (gelir-gider, ödeme skoru, Excel)',
  security: 'Güvenlik (ziyaretçi, olay, kayıp eşya)',
} as const;

export type PlanFeature = keyof typeof PLAN_FEATURES;
export const PLAN_FEATURE_KEYS = Object.keys(PLAN_FEATURES) as PlanFeature[];

export const ORGANIZATION_STATUS_LABELS = {
  TRIAL: 'Deneme',
  ACTIVE: 'Aktif',
  PAST_DUE: 'Ödeme Gecikti',
  SUSPENDED: 'Askıda',
  CANCELLED: 'İptal',
} as const;

export const ORGANIZATION_KIND_LABELS = {
  MANAGEMENT_COMPANY: 'Yönetim Şirketi',
  SINGLE_SITE: 'Site / Apartman Yönetimi',
} as const;

export type OrganizationStatus = keyof typeof ORGANIZATION_STATUS_LABELS;
export type OrganizationKind = keyof typeof ORGANIZATION_KIND_LABELS;

/** Ödenmiş süre bittikten sonra salt okunura geçmeden önce tanınan gün */
export const PAYMENT_GRACE_DAYS = 7;
/** Yeni müşterinin varsayılan deneme süresi */
export const DEFAULT_TRIAL_DAYS = 30;

const DAY_MS = 86_400_000;

export type AccessLevel = 'FULL' | 'READ_ONLY' | 'BLOCKED';

export interface SubscriptionState {
  status: OrganizationStatus;
  trialEndsAt: Date | null;
  paidUntil: Date | null;
}

export interface Access {
  level: AccessLevel;
  /** Kullanıcıya gösterilecek gerekçe (FULL'da null) */
  reason: string | null;
  /** Deneme/abonelik bitimine kalan gün (uyarı bandı için); bilinmiyorsa null */
  daysLeft: number | null;
}

export function daysUntil(date: Date | null, now: Date): number | null {
  if (!date) return null;
  return Math.ceil((date.getTime() - now.getTime()) / DAY_MS);
}

/**
 * Sitenin erişim seviyesi.
 *  - Askıda / iptal: giriş yok
 *  - Ödeme gecikti, deneme bitti, ödenmiş süre + tolerans geçti: salt okunur
 *    (veriler görülür, değiştirilemez — müşteri verisini kaybetmez)
 */
export function accessLevel(org: SubscriptionState, now: Date, graceDays = PAYMENT_GRACE_DAYS): Access {
  switch (org.status) {
    case 'SUSPENDED':
      return { level: 'BLOCKED', reason: 'Müşteri hesabı askıya alınmış. Hizmet sağlayıcınızla iletişime geçin.', daysLeft: null };
    case 'CANCELLED':
      return { level: 'BLOCKED', reason: 'Müşteri hesabının sözleşmesi sona ermiş.', daysLeft: null };
    case 'PAST_DUE':
      return { level: 'READ_ONLY', reason: 'Abonelik ödemesi gecikti; kayıtlar salt okunur.', daysLeft: null };
    case 'TRIAL': {
      const left = daysUntil(org.trialEndsAt, now);
      if (left !== null && left <= 0) return { level: 'READ_ONLY', reason: 'Deneme süresi doldu; kayıtlar salt okunur.', daysLeft: 0 };
      return { level: 'FULL', reason: null, daysLeft: left };
    }
    case 'ACTIVE': {
      if (!org.paidUntil) return { level: 'FULL', reason: null, daysLeft: null };
      const left = daysUntil(org.paidUntil, now)!;
      if (left + graceDays <= 0) return { level: 'READ_ONLY', reason: 'Abonelik süresi doldu; kayıtlar salt okunur.', daysLeft: left };
      return { level: 'FULL', reason: null, daysLeft: left };
    }
  }
}

/** Paketi olmayan müşteri (özel sözleşme): tüm modüller açık */
export function hasFeature(plan: { features: readonly string[] } | null | undefined, feature: PlanFeature): boolean {
  return !plan || plan.features.includes(feature);
}

export interface LimitCheck {
  ok: boolean;
  limit: number | null;
  used: number;
  /** null = sınırsız */
  remaining: number | null;
}

/** `adding` kadar ekleme sınırı aşar mı? (limit null = sınırsız) */
export function checkLimit(limit: number | null | undefined, used: number, adding = 1): LimitCheck {
  if (limit === null || limit === undefined) return { ok: true, limit: null, used, remaining: null };
  return { ok: used + adding <= limit, limit, used, remaining: Math.max(0, limit - used) };
}

// ---------------------------------------------------------------- şemalar

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const planSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,30}$/, 'Kod küçük harf, rakam ve tire (2–30)'),
  name: z.string().trim().min(2, 'Paket adı zorunlu').max(60),
  description: optionalText(500),
  monthlyPrice: z.coerce.number().min(0, 'Fiyat negatif olamaz').max(10_000_000),
  maxSites: z.coerce.number().int().min(1).max(100_000).nullable(),
  maxUnits: z.coerce.number().int().min(1).max(10_000_000).nullable(),
  features: z.array(z.enum(PLAN_FEATURE_KEYS as [PlanFeature, ...PlanFeature[]])).max(PLAN_FEATURE_KEYS.length),
  isActive: z.boolean().default(true),
  order: z.coerce.number().int().default(0),
});
export type PlanInput = z.infer<typeof planSchema>;

const organizationFields = {
  name: z.string().trim().min(2, 'Müşteri adı zorunlu').max(150),
  kind: z.enum(['MANAGEMENT_COMPANY', 'SINGLE_SITE']),
  planId: z.string().uuid().nullable(),
  taxNumber: optionalText(20),
  taxOffice: optionalText(80),
  contactName: optionalText(120),
  contactEmail: z.string().trim().toLowerCase().email('Geçerli bir e-posta giriniz').optional().nullable().or(z.literal('')),
  contactPhone: optionalText(30),
  city: optionalText(60),
  address: optionalText(300),
  note: optionalText(2000),
};

export const siteCreateSchema = z.object({
  name: z.string().trim().min(2, 'Site adı zorunlu').max(150),
  type: z.enum(['APARTMAN', 'SITE', 'REZIDANS', 'IS_MERKEZI', 'TOPLU_YAPI']).default('SITE'),
  city: optionalText(60),
  district: optionalText(60),
  address: optionalText(300),
});
export type SiteCreateInput = z.infer<typeof siteCreateSchema>;

/** Yeni müşteri: müşteri + sahip kullanıcı + (isteğe bağlı) ilk site */
export const organizationCreateSchema = z.object({
  ...organizationFields,
  trialDays: z.coerce.number().int().min(0).max(365).default(DEFAULT_TRIAL_DAYS),
  owner: z.object({
    fullName: z.string().trim().min(3, 'Sahip adı soyadı zorunlu').max(120),
    email: z.string().trim().toLowerCase().email('Geçerli bir e-posta giriniz'),
  }),
  firstSite: siteCreateSchema.nullable(),
});
export type OrganizationCreateInput = z.infer<typeof organizationCreateSchema>;

export const organizationUpdateSchema = z.object({
  ...organizationFields,
  status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED']),
  trialEndsAt: z.coerce.date().nullable(),
  paidUntil: z.coerce.date().nullable(),
});
export type OrganizationUpdateInput = z.infer<typeof organizationUpdateSchema>;

export const supportAccessSchema = z.object({
  siteId: z.string().uuid(),
  reason: z.string().trim().min(10, 'Gerekçe en az 10 karakter (destek talebi no, konu)').max(500),
  minutes: z.coerce.number().int().min(15).max(480).default(60),
});
export type SupportAccessInput = z.infer<typeof supportAccessSchema>;
