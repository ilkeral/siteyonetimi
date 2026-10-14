import type { PaginationQuery } from '@sy/shared';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export function paginate(query: PaginationQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export function toPage<T>(items: T[], total: number, query: PaginationQuery): Page<T> {
  return {
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

/**
 * Listelerin üstündeki A–Z harf filtresi.
 * Türkçe harfler için büyük/küçük duyarsız `startsWith` üretir.
 */
export function letterFilter(field: string, letter?: string) {
  if (!letter) return undefined;
  return { [field]: { startsWith: letter, mode: 'insensitive' as const } };
}

/**
 * Sıralama girdisini güvenli alan listesiyle sınırlar.
 * Böylece istemci rastgele bir ilişki üzerinden sıralama yaptıramaz.
 */
export function orderBy(
  query: PaginationQuery,
  allowed: readonly string[],
  fallback: Record<string, 'asc' | 'desc'>,
): Record<string, unknown> {
  if (query.sortBy && allowed.includes(query.sortBy)) {
    return { [query.sortBy]: query.sortDir };
  }
  return fallback;
}
