/**
 * Uçtan uca testlerin ortak yardımcıları.
 *
 * Her site bir müşteriye (Organization) bağlı olmak zorunda. Testler kendi
 * sitelerini kurarken paketsiz (özel sözleşme = sınırsız, tüm modüller) ve
 * aktif bir test müşterisi oluşturur; adı TEST_ORG_SUFFIX ile biter, böylece
 * temizlikte yalnızca test müşterileri silinir.
 */
import type { PrismaClient } from '@sy/db';

export const TEST_ORG_SUFFIX = ' (test müşterisi)';

/** `prisma.site.create({ data: { name, organization: testOrganization(name), ... } })` */
export function testOrganization(siteName: string) {
  return { create: { name: `${siteName}${TEST_ORG_SUFFIX}`, status: 'ACTIVE' as const } };
}

/** Sitesi kalmamış test müşterilerini siler (site → müşteri ilişkisi Restrict: önce siteler) */
export async function cleanupTestOrganizations(prisma: Pick<PrismaClient, 'organization'>) {
  await prisma.organization.deleteMany({ where: { name: { endsWith: TEST_ORG_SUFFIX }, sites: { none: {} } } });
}
