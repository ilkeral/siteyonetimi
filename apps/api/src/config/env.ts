import { z } from 'zod';

/**
 * Ortam değişkenleri uygulama açılışında doğrulanır.
 * Eksik/hatalı bir değer varsa süreç açılışta ölür — çalışma anında değil.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TZ: z.string().default('Europe/Istanbul'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL zorunlu'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  API_PORT: z.coerce.number().int().default(3001),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET en az 16 karakter olmalı'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET en az 16 karakter olmalı'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  STORAGE_DRIVER: z.enum(['local']).default('local'),
  STORAGE_PATH: z.string().default('./storage'),

  MAIL_DRIVER: z.enum(['log', 'smtp']).default('log'),
  MAIL_HOST: z.string().optional(),
  MAIL_PORT: z.coerce.number().int().default(587),
  MAIL_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  MAIL_USER: z.string().optional(),
  MAIL_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('Site Yönetimi <noreply@example.com>'),

  SMS_DRIVER: z.enum(['mock']).default('mock'),
  WHATSAPP_DRIVER: z.enum(['mock']).default('mock'),
  VOICE_DRIVER: z.enum(['mock']).default('mock'),
  PAYMENT_DRIVER: z.enum(['mock']).default('mock'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Ortam değişkenleri geçersiz:\n${issues}`);
  }
  return parsed.data;
}
