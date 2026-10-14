import { z } from 'zod';
import { PERIOD_RE } from './dates';

/** Backend doğrulaması ve frontend form doğrulaması aynı şemayı kullanır. */

// --- Ortak ------------------------------------------------------------------

export const uuidSchema = z.string().uuid('Geçersiz kayıt numarası');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(200).optional(),
  sortBy: z.string().max(60).optional(),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  /** Listelerdeki A–Z harf filtresi */
  letter: z.string().length(1).optional(),
});
export type PaginationQuery = z.infer<typeof paginationSchema>;

export const periodSchema = z
  .string()
  .regex(PERIOD_RE, "Dönem 'YYYY-AA' biçiminde olmalı (örn. 2026-08)");

/** "1.234,56" / "1234.56" / 1234.56 kabul eder, kuruşa çevirir */
export const moneySchema = z.union([z.string(), z.number()]);

// --- Kimlik -----------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().email('Geçerli bir e-posta giriniz'),
  password: z.string().min(8, 'Parola en az 8 karakter olmalı'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(8),
    newPassword: z
      .string()
      .min(8, 'Parola en az 8 karakter olmalı')
      .regex(/[A-Za-zÇĞİÖŞÜçğıöşü]/, 'Parola harf içermeli')
      .regex(/\d/, 'Parola rakam içermeli'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Parolalar eşleşmiyor',
    path: ['confirmPassword'],
  });

// --- Kişi -------------------------------------------------------------------

/** TC Kimlik No algoritmik doğrulaması */
export function isValidNationalId(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const d = value.split('').map(Number);
  const oddSum = d[0] + d[2] + d[4] + d[6] + d[8];
  const evenSum = d[1] + d[3] + d[5] + d[7];
  const digit10 = (oddSum * 7 - evenSum) % 10;
  const digit11 = (d.slice(0, 10).reduce((a, b) => a + b, 0)) % 10;
  return d[9] === digit10 && d[10] === digit11;
}

export const nationalIdSchema = z
  .string()
  .trim()
  .refine((v) => v === '' || isValidNationalId(v), 'Geçersiz TC Kimlik No');

/** 05xx xxx xx xx → 5xxxxxxxxx (10 hane) olarak normalize eder */
export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('90') && digits.length === 12) return digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) return digits.slice(1);
  return digits;
}

export const phoneSchema = z
  .string()
  .trim()
  .transform(normalizePhone)
  .refine((v) => v === '' || /^5\d{9}$/.test(v), 'Geçerli bir cep telefonu giriniz (5XX XXX XX XX)');

export const personSchema = z.object({
  firstName: z.string().trim().min(2, 'Ad en az 2 karakter'),
  lastName: z.string().trim().min(2, 'Soyad en az 2 karakter'),
  nationalId: nationalIdSchema.optional().or(z.literal('')),
  email: z.string().email('Geçerli bir e-posta giriniz').optional().or(z.literal('')),
  phone: phoneSchema.optional().or(z.literal('')),
  phone2: phoneSchema.optional().or(z.literal('')),
  birthDate: z.coerce.date().optional().nullable(),
  language: z.enum(['TR', 'EN', 'DE', 'RU']).default('TR'),
  note: z.string().max(2000).optional(),
  inLegalAction: z.boolean().default(false),
});
export type PersonInput = z.infer<typeof personSchema>;

// --- Yapı -------------------------------------------------------------------

export const unitSchema = z.object({
  blockId: uuidSchema.optional().nullable(),
  doorNumber: z.string().trim().min(1, 'Daire no zorunlu'),
  floor: z.coerce.number().int().min(-5).max(100).optional().nullable(),
  area: z.coerce.number().positive('m² pozitif olmalı').optional().nullable(),
  landShare: z.coerce.number().positive().optional().nullable(),
  shareRatio: z.coerce.number().positive().default(1),
  roomCount: z.string().max(20).optional(),
  status: z.enum(['OCCUPIED', 'EMPTY', 'UNDER_RENOVATION']).default('OCCUPIED'),
  isExempt: z.boolean().default(false),
  note: z.string().max(1000).optional(),
});

export const occupancySchema = z
  .object({
    unitId: uuidSchema,
    personId: uuidSchema,
    role: z.enum(['OWNER', 'TENANT']),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().optional().nullable(),
    bankPaymentCode: z.string().trim().max(50).optional(),
    note: z.string().max(500).optional(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: 'Çıkış tarihi giriş tarihinden önce olamaz',
    path: ['endDate'],
  });

// --- Aidat ------------------------------------------------------------------

export const duesRunSchema = z.object({
  period: periodSchema,
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  description: z.string().max(500).optional(),
  lines: z
    .array(
      z.object({
        duesItemId: uuidSchema,
        amount: moneySchema,
        mode: z.enum(['TOTAL', 'PER_UNIT']).default('PER_UNIT'),
        method: z
          .enum(['EQUAL', 'BY_AREA', 'BY_LAND_SHARE', 'BY_SHARE_RATIO'])
          .optional(),
      }),
    )
    .min(1, 'En az bir aidat kalemi seçiniz'),
});

// --- Talep (iş takibi) ------------------------------------------------------

export const ticketSchema = z.object({
  subject: z.string().trim().min(3, 'Konu en az 3 karakter'),
  description: z.string().trim().min(3, 'Açıklama zorunlu'),
  requestType: z
    .enum(['COMPLAINT', 'FAULT', 'QUESTION', 'SUGGESTION', 'REQUEST', 'SATISFACTION', 'OTHER'])
    .default('REQUEST'),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  channel: z.enum(['PORTAL', 'PHONE', 'IN_PERSON', 'EMAIL', 'OTHER']).default('PHONE'),
  personId: uuidSchema.optional().nullable(),
  unitId: uuidSchema.optional().nullable(),
  departmentId: uuidSchema.optional().nullable(),
  assigneeId: uuidSchema.optional().nullable(),
  area: z.string().max(100).optional(),
  dueDate: z.coerce.date().optional().nullable(),
});

export const ticketMoveSchema = z.object({
  status: z.enum([
    'WAITING',
    'REVIEWING',
    'AWAITING_REPLY',
    'FORWARDED',
    'PLANNED',
    'IN_PROGRESS',
    'POSTPONED',
    'COMPLETED',
  ]),
  boardOrder: z.coerce.number().int().min(0).default(0),
});

// --- Bildirim ---------------------------------------------------------------

export const audienceSchema = z.object({
  /** ALL | OWNERS | TENANTS | DEBTORS | CUSTOM */
  group: z.enum(['ALL', 'OWNERS', 'TENANTS', 'DEBTORS', 'CUSTOM']).default('ALL'),
  blockIds: z.array(uuidSchema).optional(),
  personIds: z.array(uuidSchema).optional(),
  minDebt: z.coerce.number().min(0).optional(),
  maxDebt: z.coerce.number().min(0).optional(),
  onlyOverdue: z.boolean().default(false),
  includeSecondPhone: z.boolean().default(false),
});
export type AudienceInput = z.infer<typeof audienceSchema>;

export const campaignSchema = z.object({
  channel: z.enum(['EMAIL', 'SMS', 'PUSH', 'WHATSAPP', 'VOICE', 'POST']),
  name: z.string().trim().min(2),
  templateId: uuidSchema.optional().nullable(),
  subject: z.string().max(200).optional(),
  body: z.string().trim().min(1, 'Mesaj içeriği boş olamaz'),
  audience: audienceSchema,
  scheduledAt: z.coerce.date().optional().nullable(),
});

// --- Sayaç ------------------------------------------------------------------

export const meterDistributionSchema = z.object({
  period: periodSchema,
  documentDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  name: z.string().max(200).optional(),
  applyLateFee: z.boolean().default(false),
  lateFeeStartDate: z.coerce.date().optional().nullable(),
  waterInletTemp: z.coerce.number().min(0).max(100).default(15),
  waterOutletTemp: z.coerce.number().min(0).max(100).default(50),
  fuelLowerHeatValue: z.coerce.number().positive().default(8250),
  waterPricingMethod: z.enum(['UNIT_PRICE', 'INVOICE_TOTAL']).default('UNIT_PRICE'),
  waterUnitPrice: moneySchema.default(0),
  penaltyPercent: z.coerce.number().min(0).max(100).default(0),
  fixedSharePercent: z.coerce.number().min(0).max(100).default(0),
});
