import { BadRequestException } from '@nestjs/common';
import { Prisma, PrismaClient, TENANT_MODEL_SET } from '@sy/db';
import { getTenantContext, runInRlsTransaction } from '../tenant/tenant.context';
import { buildRelationIndex, collectForeignRefs, writeBodies } from './foreign-refs';

const RELATIONS = buildRelationIndex(Prisma.dmmf.datamodel.models);

const delegateName = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

/**
 * ÇOK KİRACILILIK KATMANI 2/3 — Prisma eklentisi
 *
 * `siteId` taşıyan her model için sorgulara otomatik site filtresi enjekte
 * edilir. Geliştirici `where: { siteId }` yazmayı unutsa bile veri sızmaz.
 *
 * Katman 1: TenantInterceptor (isteği bağlama taşır)
 * Katman 2: bu eklenti (uygulama katmanı)
 * Katman 3: PostgreSQL RLS (`rls: true` — aşağıda)
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

export interface PrismaClientOptions {
  /**
   * Katman 3: PostgreSQL RLS. Açıkken her sorgu, aktif siteyi
   * (`app.site_id`) ya da sistem işi bayrağını (`app.bypass_rls`) işlem içi
   * ayarlayan bir veritabanı işleminde çalışır. Bağlantı tablo sahibi OLMAYAN
   * bir rolle yapılmalı (pnpm db:app-role) — sahip ve süper kullanıcı RLS'ye
   * takılmaz.
   */
  rls?: boolean;
}

export function createPrismaClient(databaseUrl?: string, options: PrismaClientOptions = {}) {
  const rls = options.rls ?? false;
  const base = new PrismaClient({
    datasources: databaseUrl ? { db: { url: databaseUrl } } : undefined,
    log:
      process.env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
        : ['warn', 'error'],
  });

  /** İşlem içi RLS ayarı; bağlamı olmayan sorgu hiçbir site satırı görmez */
  const setRlsConfig = (client: { $executeRaw: PrismaClient['$executeRaw'] }, bypass?: boolean) => {
    const ctx = getTenantContext();
    const siteId = ctx?.siteId ?? '';
    const flag = (bypass ?? ctx?.bypass) ? 'on' : 'off';
    return client.$executeRaw`SELECT set_config('app.site_id', ${siteId}, true), set_config('app.bypass_rls', ${flag}, true)`;
  };

  /**
   * Sorguyu RLS ayarıyla aynı işlemde çalıştırır. Ayarı yapılmış bir işlemin
   * içindeysek (servisin `$transaction`'ı) doğrudan çalıştırır.
   */
  const withRls = async <T>(run: () => Prisma.PrismaPromise<T>): Promise<T> => {
    if (!rls || getTenantContext()?.rlsTransaction) return run();
    const [, result] = await base.$transaction([setRlsConfig(base), run()]);
    return result as T;
  };

  /** İlişki kimliği denetimi başka sitenin satırlarını görmeli — RLS'de bilinçli bypass */
  const countForeign = async (target: string, ids: string[], siteId: string): Promise<number> => {
    const delegate = (base as unknown as Record<string, { count: (a: unknown) => Prisma.PrismaPromise<number> }>)[
      delegateName(target)
    ];
    const count = () => delegate.count({ where: { id: { in: ids }, siteId: { not: siteId } } });
    if (!rls) return count();
    const [, result] = await base.$transaction([setRlsConfig(base, true), count()]);
    return result;
  };

  const rawOperation = async ({ args, query }: { args: unknown; query: (a: never) => Prisma.PrismaPromise<unknown> }) =>
    withRls(() => query(args as never));

  const extended = base.$extends({
    name: 'tenant-isolation',
    query: {
      // Ham SQL eklentinin site filtresinden geçmez; RLS kipinde en azından
      // veritabanı kuralları uygulanır (siteId'yi unutan ham sorgu boş döner).
      $queryRaw: rawOperation,
      $executeRaw: rawOperation,
      $queryRawUnsafe: rawOperation,
      $executeRawUnsafe: rawOperation,

      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ctx = getTenantContext();

          // Gövdedeki ilişki kimlikleri başka siteye ait olmamalı — siteId
          // taşımayan modellerde de (TicketComment.ticketId gibi) denetlenir.
          if (ctx && !ctx.bypass && ctx.siteId && model) {
            const refs = new Map<string, Set<string>>();
            for (const body of writeBodies(operation, (args ?? {}) as Record<string, unknown>)) {
              collectForeignRefs(RELATIONS, TENANT_MODEL_SET, model, body, refs);
            }
            for (const [target, ids] of refs) {
              // "Bu siteye ait mi" değil "başka siteye ait mi": aynı işlemde
              // yeni oluşturulup henüz görünmeyen kayıtlar reddedilmesin.
              // Var olmayan kimliği veritabanının yabancı anahtarı zaten reddeder.
              if ((await countForeign(target, [...ids], ctx.siteId)) > 0) {
                // Mesajda "site" geçmesin: web istemcisi 403/"site"de seçimi siler
                throw new BadRequestException('Seçilen ilişkili kayıt bulunamadı');
              }
            }
          }

          // Eklenti doğası gereği dinamiktir: model adı çalışma anında belli
          // olduğu için Prisma'nın model-özel argüman tipleri burada
          // uygulanamaz. Dışarıya sızan API tipleri değişmez.
          const run = (next: unknown) => withRls(() => query(next as typeof args) as Prisma.PrismaPromise<unknown>);

          // Bağlam yok, bypass açık ya da model tenant'lı değil → filtre ekleme.
          // RLS sarması yine yapılır: global bir modelin sorgusu da ilişki
          // üzerinden (include, `ticket: { siteId }` koşulu) site tablolarını okur.
          if (!ctx || ctx.bypass || !ctx.siteId || !model || !TENANT_MODEL_SET.has(model)) {
            return run(args);
          }

          const siteId = ctx.siteId;
          const a = (args ?? {}) as Record<string, unknown>;

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
              return run(args);
          }
        },
      },
    },
  });

  if (!rls) return extended;

  /**
   * Servislerin `$transaction`'ı: RLS ayarı işlemin ilk komutu olur, içerideki
   * sorgular ayrıca sarılmaz (aynı bağlantı, aynı işlem).
   *
   * DİKKAT: interaktif işlemin içinde `tx` yerine kök istemci (`this.db`)
   * kullanılırsa sorgu ayarsız bir bağlantıya gider ve hiçbir site satırı
   * görmez — sızıntı değil, hata olarak ortaya çıkar. İşlem içinde daima `tx`.
   */
  const transaction = ((arg: unknown, txOptions?: unknown) => {
    const target = extended as unknown as {
      $transaction: (a: unknown, o?: unknown) => Promise<unknown>;
    };
    if (Array.isArray(arg)) {
      return runInRlsTransaction(() => target.$transaction([setRlsConfig(base), ...arg], txOptions)).then(
        (results) => (results as unknown[]).slice(1),
      );
    }
    const fn = arg as (tx: unknown) => Promise<unknown>;
    return target.$transaction(
      (tx: { $executeRaw: PrismaClient['$executeRaw'] }) =>
        runInRlsTransaction(async () => {
          await setRlsConfig(tx);
          return fn(tx);
        }),
      txOptions,
    );
  }) as (typeof extended)['$transaction'];

  return new Proxy(extended, {
    get(target, property, receiver) {
      if (property === '$transaction') return transaction;
      return Reflect.get(target, property, receiver);
    },
  });
}

export type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

/** Nest DI token'ı: `@Inject(PRISMA) private readonly db: ExtendedPrismaClient` */
export const PRISMA = Symbol('PRISMA');
