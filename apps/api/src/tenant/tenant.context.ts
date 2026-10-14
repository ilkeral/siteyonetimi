import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '@sy/db';

/**
 * İSTEK BAĞLAMI (tenant context)
 *
 * Her HTTP isteği, AsyncLocalStorage içinde aktif site ve kullanıcı bilgisiyle
 * çalışır. Prisma eklentisi bu bağlamı okuyarak sorgulara otomatik `siteId`
 * filtresi ekler — böylece bir serviste filtreyi yazmayı unutmak, başka bir
 * sitenin verisini sızdırmaz.
 */
export interface TenantContext {
  siteId: string | null;
  userId: string | null;
  role: Role | null;
  isSuperAdmin: boolean;
  /** true ise otomatik siteId filtresi UYGULANMAZ (seed, cron, sistem işleri) */
  bypass: boolean;
}

const storage = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}

export function runWithTenant<T>(context: Partial<TenantContext>, fn: () => T): T {
  return storage.run(
    {
      siteId: null,
      userId: null,
      role: null,
      isSuperAdmin: false,
      bypass: false,
      ...context,
    },
    fn,
  );
}

/**
 * Tenant filtresini devre dışı bırakarak çalıştırır.
 * SADECE sistem işleri için: seed, zamanlanmış görevler, siteler-arası raporlar.
 */
export function runWithoutTenant<T>(fn: () => T): T {
  const current = getTenantContext();
  return storage.run({ ...(current ?? emptyContext()), bypass: true }, fn);
}

export function requireSiteId(): string {
  const ctx = getTenantContext();
  if (!ctx?.siteId) {
    throw new Error('Aktif site bulunamadı (tenant bağlamı kurulmamış)');
  }
  return ctx.siteId;
}

export function currentUserId(): string | null {
  return getTenantContext()?.userId ?? null;
}

function emptyContext(): TenantContext {
  return { siteId: null, userId: null, role: null, isSuperAdmin: false, bypass: false };
}
