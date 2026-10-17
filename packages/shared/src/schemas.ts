import { z } from 'zod';
import { PERIOD_RE } from './dates';
import { parseDecimalTR } from './meter-import';
import { isValidCardNumber, isValidExpiry } from './payments';

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
  /** Hedef kolondaki konum (0 = en üst) */
  boardOrder: z.coerce.number().int().min(0).default(0),
});

export type TicketInput = z.infer<typeof ticketSchema>;
export type TicketMoveInput = z.infer<typeof ticketMoveSchema>;

export const ticketCommentSchema = z.object({
  body: z.string().trim().min(1, 'Yorum boş olamaz').max(5000),
  /** false → yalnızca personelin gördüğü iç not */
  isPublic: z.boolean().default(true),
});
export type TicketCommentInput = z.infer<typeof ticketCommentSchema>;

/** Gider faturası bilgisi — verilirse masraf aynı anda gider evrakına dönüşür */
export const ticketInvoiceSchema = z.object({
  accountId: uuidSchema,
  categoryId: uuidSchema,
  date: z.coerce.date(),
  dueDate: z.coerce.date().optional().nullable(),
});

export const ticketExpenseSchema = z.object({
  description: z.string().trim().min(2, 'Açıklama zorunlu').max(300),
  amount: moneySchema,
  invoice: ticketInvoiceSchema.optional(),
});
export type TicketExpenseInput = z.infer<typeof ticketExpenseSchema>;

export const ticketSurveySchema = z.object({
  rating: z.coerce.number().int().min(1, 'Puan 1–5 arası').max(5, 'Puan 1–5 arası'),
  comment: z.string().trim().max(1000).optional(),
});

export const departmentSchema = z.object({
  name: z.string().trim().min(2, 'Departman adı zorunlu').max(60),
  order: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
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

export const channelSchema = z.enum(['EMAIL', 'SMS', 'PUSH', 'WHATSAPP', 'VOICE', 'POST']);

export const campaignSchema = z
  .object({
    channel: channelSchema,
    name: z.string().trim().min(2, 'Kampanya adı en az 2 karakter'),
    templateId: uuidSchema.optional().nullable(),
    subject: z.string().max(200).optional(),
    body: z.string().trim().min(1, 'Mesaj içeriği boş olamaz').max(5000),
    audience: audienceSchema,
    scheduledAt: z.coerce.date().optional().nullable(),
  })
  .refine((c) => c.channel !== 'EMAIL' || !!c.subject?.trim(), {
    message: 'E-posta için konu zorunlu',
    path: ['subject'],
  });
export type CampaignInput = z.infer<typeof campaignSchema>;

/** Önizleme: kampanya gibi ama ad zorunlu değil */
export const campaignPreviewSchema = z.object({
  channel: channelSchema,
  subject: z.string().max(200).optional(),
  body: z.string().max(5000).default(''),
  audience: audienceSchema,
});
export type CampaignPreviewInput = z.infer<typeof campaignPreviewSchema>;

export const notificationTemplateSchema = z.object({
  channel: channelSchema,
  language: z.enum(['TR', 'EN', 'DE', 'RU']).default('TR'),
  name: z.string().trim().min(2, 'Şablon adı en az 2 karakter').max(100),
  subject: z.string().max(200).optional().nullable(),
  body: z.string().trim().min(1, 'Şablon içeriği boş olamaz').max(5000),
  isActive: z.boolean().default(true),
});
export type NotificationTemplateInput = z.infer<typeof notificationTemplateSchema>;

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
  /** Oluşacak evrakların gelir kategorisi */
  categoryId: uuidSchema.optional().nullable(),
  documentNote: z.string().max(500).optional().nullable(),
});
export type MeterDistributionInput = z.infer<typeof meterDistributionSchema>;

export const meterTypeSchema = z.enum(['FUEL', 'HOT_WATER', 'COLD_WATER', 'COOLING', 'ELECTRIC']);

/** Sayaç değeri: sayı ya da "1.234,5" biçiminde metin */
export const meterValueSchema = z
  .union([z.number(), z.string()])
  .transform((value) => (typeof value === 'number' ? value : parseDecimalTR(value)))
  .refine((value): value is number => value !== null && Number.isFinite(value) && value >= 0, {
    message: 'Geçerli bir sayaç değeri giriniz',
  });

export const mainMeterReadingsSchema = z.object({
  readings: z
    .array(
      z.object({
        type: meterTypeSchema,
        readingDate: z.coerce.date().optional(),
        previousValue: meterValueSchema.default(0),
        currentValue: meterValueSchema.default(0),
        /** Dönemin fatura tutarı */
        invoiceAmount: moneySchema.default(0),
        skip: z.boolean().default(false),
      }),
    )
    .refine((rows) => new Set(rows.map((r) => r.type)).size === rows.length, {
      message: 'Her sayaç türü bir kez girilebilir',
    }),
});
export type MainMeterReadingsInput = z.infer<typeof mainMeterReadingsSchema>;

/** Tek türün daire okumaları; `currentValue: null` okumayı siler (daire tahmin edilir) */
export const unitMeterReadingsSchema = z.object({
  type: meterTypeSchema,
  readings: z
    .array(
      z.object({
        unitId: uuidSchema,
        /** Boşsa son onaylı dönemin son okuması kullanılır */
        previousValue: meterValueSchema.nullable().optional(),
        currentValue: meterValueSchema.nullable(),
        note: z.string().max(200).optional().nullable(),
      }),
    )
    .max(5000),
});
export type UnitMeterReadingsInput = z.infer<typeof unitMeterReadingsSchema>;

// --- İkamet Eden Portalı ----------------------------------------------------------

/** İkamet edenin açtığı talep: kişi, kanal ve öncelik sunucuda belirlenir */
export const portalTicketSchema = z.object({
  subject: z.string().trim().min(3, 'Konu en az 3 karakter').max(200),
  description: z.string().trim().min(3, 'Açıklama zorunlu').max(5000),
  requestType: ticketSchema.shape.requestType,
  unitId: uuidSchema.optional().nullable(),
  area: z.string().max(100).optional(),
});
export type PortalTicketInput = z.infer<typeof portalTicketSchema>;

export const portalCommentSchema = z.object({
  body: z.string().trim().min(1, 'Yorum boş olamaz').max(5000),
});

/**
 * Kart bilgisi yalnızca doğrulanır ve ödeme sağlayıcısına iletilir;
 * hiçbir yerde saklanmaz (evrakta yalnızca son 4 hane).
 */
export const portalPaymentSchema = z.object({
  amount: moneySchema,
  card: z.object({
    holder: z.string().trim().min(3, 'Kart üzerindeki isim zorunlu').max(100),
    number: z.string().refine(isValidCardNumber, 'Kart numarası geçersiz'),
    expiry: z.string().refine((v) => isValidExpiry(v), 'Son kullanma tarihi geçersiz (AA/YY)'),
    cvc: z.string().regex(/^\d{3,4}$/, 'Güvenlik kodu 3–4 hane'),
  }),
});
export type PortalPaymentInput = z.infer<typeof portalPaymentSchema>;

export const announcementSchema = z
  .object({
    title: z.string().trim().min(3, 'Başlık en az 3 karakter').max(200),
    body: z.string().trim().min(1, 'Duyuru metni boş olamaz').max(10000),
    publishAt: z.coerce.date().optional(),
    expireAt: z.coerce.date().optional().nullable(),
    isPinned: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .refine((a) => !a.expireAt || !a.publishAt || a.expireAt > a.publishAt, {
    message: 'Bitiş tarihi yayın tarihinden sonra olmalı',
    path: ['expireAt'],
  });
export type AnnouncementInput = z.infer<typeof announcementSchema>;

export const portalAccessSchema = z.object({
  email: z.string().trim().toLowerCase().email('Geçerli bir e-posta giriniz'),
});

// ---------------------------------------------------------------- güvenlik

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();
const optionalId = z.string().uuid().optional().nullable();

export const incidentCategorySchema = z.enum(['THEFT', 'DAMAGE', 'NOISE', 'TRESPASS', 'FIRE', 'ACCIDENT', 'TECHNICAL', 'OTHER']);
export const incidentSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const securityIncidentSchema = z.object({
  date: z.coerce.date({ errorMap: () => ({ message: 'Olay tarihi zorunlu' }) }),
  title: z.string().trim().min(3, 'Başlık en az 3 karakter').max(200),
  category: incidentCategorySchema.default('OTHER'),
  severity: incidentSeveritySchema.default('LOW'),
  staffId: optionalId,
  personId: optionalId,
  unitId: optionalId,
  body: z.string().trim().min(1, 'Olay açıklaması boş olamaz').max(10000),
});
export type SecurityIncidentInput = z.infer<typeof securityIncidentSchema>;

export const lostItemStatusSchema = z.enum(['LOST', 'FOUND', 'CLAIMED', 'DELIVERED', 'DISPOSED']);

/** Eşya bilgileri — durum bu şemayla değişmez, yalnızca geçiş uç noktasıyla */
export const lostItemDetailsSchema = z.object({
  itemName: z.string().trim().min(2, 'Eşya adı en az 2 karakter').max(200),
  description: optionalText(2000),
  location: optionalText(200),
  lostAt: z.coerce.date().optional().nullable(),
  loserName: optionalText(120),
  loserPhone: optionalText(30),
  finderName: optionalText(120),
  finderPhone: optionalText(30),
  custodianName: optionalText(120),
  custodianRole: optionalText(120),
});

/** Yeni kayıt: kayıp bildirimi (LOST) ya da bulunmuş eşya (FOUND) */
export const lostItemCreateSchema = lostItemDetailsSchema
  .extend({
    status: z.enum(['LOST', 'FOUND']).default('FOUND'),
    foundAt: z.coerce.date().optional().nullable(),
  })
  .superRefine((item, ctx) => {
    if (item.status === 'LOST' && !item.loserName) {
      ctx.addIssue({ code: 'custom', path: ['loserName'], message: 'Kayıp bildiren kişinin adı zorunlu' });
    }
    if (item.status === 'FOUND' && !item.custodianName) {
      ctx.addIssue({ code: 'custom', path: ['custodianName'], message: 'Emanetçi zorunlu' });
    }
  });
export type LostItemCreateInput = z.infer<typeof lostItemCreateSchema>;
export type LostItemDetailsInput = z.infer<typeof lostItemDetailsSchema>;

export const lostItemTransitionSchema = z.object({
  to: lostItemStatusSchema,
  at: z.coerce.date().optional().nullable(),
  custodianName: optionalText(120),
  custodianRole: optionalText(120),
  finderName: optionalText(120),
  finderPhone: optionalText(30),
  loserName: optionalText(120),
  loserPhone: optionalText(30),
  deliveredTo: optionalText(120),
  disposalNote: optionalText(1000),
});
export type LostItemTransitionBody = z.infer<typeof lostItemTransitionSchema>;

export const visitorSchema = z
  .object({
    visitorName: z.string().trim().min(2, 'Ziyaretçi adı en az 2 karakter').max(120),
    visitorPhone: optionalText(30),
    nationalId: nationalIdSchema.optional().nullable(),
    plate: z.string().trim().max(15).optional().nullable(),
    unitId: optionalId,
    hostPersonId: optionalId,
    purpose: optionalText(200),
    note: optionalText(1000),
    enteredAt: z.coerce.date().optional(),
  })
  .refine((v) => v.unitId || v.hostPersonId || v.purpose, {
    message: 'Ziyaret edilen daire, kişi ya da ziyaret amacı girilmeli',
    path: ['unitId'],
  });
export type VisitorInput = z.infer<typeof visitorSchema>;

export const visitorExitSchema = z.object({
  exitedAt: z.coerce.date().optional(),
  note: optionalText(1000),
});
