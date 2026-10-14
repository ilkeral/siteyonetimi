import { PrismaClient, TENANT_MODEL_SET } from '@sy/db';
import { getTenantContext } from '../tenant/tenant.context';

/**
 * ÇOK KİRACILILIK KATMANI 2/3 — Prisma eklentisi
 *
 * `siteId` taşıyan her model için sorgulara otomatik site filtresi enjekte
 * edilir. Geliştirici `where: { siteId }` yazmayı unutsa bile veri sızmaz.
 *
 * Katman 1: TenantInterceptor (isteği bağlama taşır)
 * Katman 2: bu eklenti (uygulama katmanı)
 * Katman 3: PostgreSQL RLS (Faz 1 sonunda — veritabanı katmanı)
 *
 * `runWithoutTenant()` ile çalışan sistem işlerinde (seed, cron) filtre
 * uygulanmaz.
 */

/** where nesnesine siteId'yi, mevcut koşulları bozmadan ekler */
function withSite(where: unknown, siteId: string): Record<string, unknown> {
  if (!where || typeof where !== 'object') return { siteId };
  const w = where as Record<string, unknown>;
  // Zaten açıkça bir siteId verilmişse ona dokunmayız (kasıtlı sorgu)
  if ('siteId' in w) return w;
  return { ...w, siteId };
}

function withSiteData(data: unknown, siteId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => withSiteData(item, siteId));
  }
  if (!data || typeof data !== 'object') return data;
  const d = data as Record<string, unknown>;
  if ('siteId' in d || 'site' in d) return d;
  return { ...d, siteId };
}

export function createPrismaClient(databaseUrl?: string) {
  const base = new PrismaClient({
    datasources: databaseUrl ? { db: { url: databaseUrl } } : undefined,
    log:
      process.env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
        : ['warn', 'error'],
  });

  return base.$extends({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ctx = getTenantContext();

          // Bağlam yok, bypass açık ya da model tenant'lı değil → dokunma
          if (!ctx || ctx.bypass || !ctx.siteId || !model || !TENANT_MODEL_SET.has(model)) {
            return query(args);
          }

          const siteId = ctx.siteId;
          const a = (args ?? {}) as Record<string, unknown>;

          // Eklenti doğası gereği dinamiktir: model adı çalışma anında belli
          // olduğu için Prisma'nın model-özel argüman tipleri burada
          // uygulanamaz. Dışarıya sızan API tipleri değişmez.
          const run = (next: Record<string, unknown>) => query(next as typeof args);

          switch (operation) {
            // --- Okuma / toplu güncelleme-silme: where'a siteId ekle
            case 'findFirst':
            case 'findFirstOrThrow':
            case 'findMany':
            case 'count':
            case 'aggregate':
            case 'groupBy':
            case 'updateMany':
            case 'deleteMany':
              return run({ ...a, where: withSite(a.where, siteId) });

            // --- Tekil kayıt: Prisma 5 "extendedWhereUnique" sayesinde
            //     unique alanın yanına siteId koşulu eklenebilir
            case 'findUnique':
            case 'findUniqueOrThrow':
            case 'update':
            case 'delete':
              return run({ ...a, where: withSite(a.where, siteId) });

            // --- Oluşturma: siteId'yi veriye yaz
            case 'create':
            case 'createMany':
            case 'createManyAndReturn':
              return run({ ...a, data: withSiteData(a.data, siteId) });

            case 'upsert':
              return run({
                ...a,
                where: withSite(a.where, siteId),
                create: withSiteData(a.create, siteId),
              });

            default:
              return query(args);
          }
        },
      },
    },
  });
}

export type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

/** Nest DI token'ı: `@Inject(PRISMA) private readonly db: ExtendedPrismaClient` */
export const PRISMA = Symbol('PRISMA');
