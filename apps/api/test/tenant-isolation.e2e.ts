/**
 * ÇOK KİRACILILIK SIZINTI TESTİ
 *
 * Çalışan bir API'ye karşı koşar:
 *   node --env-file=../../.env test/tenant-isolation.e2e.ts   (veya pnpm test:isolation)
 *
 * İki site ve iki kullanıcı kurar, sonra B sitesinin kullanıcısının A sitesinin
 * verisine HİÇBİR şekilde ulaşamadığını doğrular. Bu test, Prisma eklentisi ya
 * da AuthGuard bozulursa kırmızıya döner.
 */
import { PrismaClient } from '@sy/db';
import { cleanupTestOrganizations, testOrganization } from './helpers';
import * as argon2 from 'argon2';

const BASE = process.env.API_BASE ?? 'http://localhost:3101';
const prisma = new PrismaClient();

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

async function api(
  path: string,
  options: { token?: string; siteId?: string; method?: string; body?: unknown } = {},
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.siteId) headers['X-Site-Id'] = options.siteId;

  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

async function main(): Promise<void> {
  console.log('Çok kiracılılık izolasyon testi\n');

  // ------------------------------------------------------------- hazırlık
  for (const name of ['TEST SITE A', 'TEST SITE B']) {
    const existing = await prisma.site.findFirst({ where: { name } });
    if (existing) await prisma.site.delete({ where: { id: existing.id } });
    await cleanupTestOrganizations(prisma);
  }

  const siteA = await prisma.site.create({
    data: { name: 'TEST SITE A', organization: testOrganization('TEST SITE A'), city: 'İstanbul', settings: { create: {} } },
  });
  const siteB = await prisma.site.create({
    data: { name: 'TEST SITE B', organization: testOrganization('TEST SITE B'), city: 'Ankara', settings: { create: {} } },
  });

  const passwordHash = await argon2.hash('Test1234!');
  const userA = await prisma.user.upsert({
    where: { email: 'a@test.local' },
    update: { passwordHash, isSuperAdmin: false, isActive: true },
    create: { email: 'a@test.local', passwordHash, fullName: 'A Yöneticisi' },
  });
  const userB = await prisma.user.upsert({
    where: { email: 'b@test.local' },
    update: { passwordHash, isSuperAdmin: false, isActive: true },
    create: { email: 'b@test.local', passwordHash, fullName: 'B Yöneticisi' },
  });

  await prisma.siteMembership.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
  await prisma.siteMembership.createMany({
    data: [
      { userId: userA.id, siteId: siteA.id, role: 'SITE_ADMIN' },
      { userId: userB.id, siteId: siteB.id, role: 'SITE_ADMIN' },
    ],
  });

  // A sitesine, B'nin asla görmemesi gereken bir blok ve kişi
  const blockA = await prisma.block.create({ data: { siteId: siteA.id, name: 'GİZLİ BLOK' } });
  const personA = await prisma.person.create({
    data: { siteId: siteA.id, firstName: 'Gizli', lastName: 'Kişi', phone: '5321112233' },
  });
  const unitA = await prisma.unit.create({ data: { siteId: siteA.id, blockId: blockA.id, doorNumber: '1' } });
  const blockB = await prisma.block.create({ data: { siteId: siteB.id, name: 'B BLOK' } });
  const unitB = await prisma.unit.create({ data: { siteId: siteB.id, blockId: blockB.id, doorNumber: '1' } });
  const personB = await prisma.person.create({ data: { siteId: siteB.id, firstName: 'B', lastName: 'İkamet edeni' } });

  // --------------------------------------------------------------- testler
  const loginA = await api('/auth/login', {
    method: 'POST',
    body: { email: 'a@test.local', password: 'Test1234!' },
  });
  const loginB = await api('/auth/login', {
    method: 'POST',
    body: { email: 'b@test.local', password: 'Test1234!' },
  });

  check('A kullanıcısı giriş yapabiliyor', loginA.status === 200);
  check('B kullanıcısı giriş yapabiliyor', loginB.status === 200);

  const tokenA: string = loginA.data?.accessToken;
  const tokenB: string = loginB.data?.accessToken;

  check(
    'A kullanıcısı yalnızca kendi sitesini görüyor',
    loginA.data?.sites?.length === 1 && loginA.data.sites[0].id === siteA.id,
    `(dönen: ${loginA.data?.sites?.length})`,
  );
  check(
    'B kullanıcısı yalnızca kendi sitesini görüyor',
    loginB.data?.sites?.length === 1 && loginB.data.sites[0].id === siteB.id,
  );

  const ownA = await api('/sites/current', { token: tokenA, siteId: siteA.id });
  check('A kendi sitesine erişebiliyor', ownA.status === 200 && ownA.data?.site?.id === siteA.id);
  check(
    'A kendi blok sayısını doğru görüyor',
    ownA.data?.stats?.blockCount === 1,
    `(dönen: ${ownA.data?.stats?.blockCount})`,
  );

  // >>> ASIL TEST: B, A'nın site kimliğiyle istek atıyor
  const cross = await api('/sites/current', { token: tokenB, siteId: siteA.id });
  check(
    'B kullanıcısı A sitesine ERİŞEMİYOR (403)',
    cross.status === 403,
    `(dönen: ${cross.status} ${JSON.stringify(cross.data)})`,
  );

  const noSite = await api('/sites/current', { token: tokenB });
  check('Site başlığı olmadan istek reddediliyor (400)', noSite.status === 400);

  const fakeSite = await api('/sites/current', {
    token: tokenB,
    siteId: '00000000-0000-0000-0000-000000000000',
  });
  check('Var olmayan site reddediliyor (403)', fakeSite.status === 403);

  const badSite = await api('/sites/current', { token: tokenB, siteId: 'bu-bir-uuid-degil' });
  check('Geçersiz biçimli site kimliği reddediliyor (400)', badSite.status === 400);

  const noToken = await api('/sites/current', { siteId: siteA.id });
  check('Tokensiz istek reddediliyor (401)', noToken.status === 401);

  const badToken = await api('/sites/current', { token: 'sahte.token.degeri', siteId: siteA.id });
  check('Sahte token reddediliyor (401)', badToken.status === 401);

  // ------------------------------------------- ilişki kimlikleriyle sızma
  // Prisma eklentisi ana sorguyu daraltır ama gövdedeki yabancı anahtarları
  // denetlemez; B kendi kaydını A'nın kaydına bağlayıp include ile okuyabilirdi.
  const asB = { token: tokenB, siteId: siteB.id };

  const foreignBlockUnit = await api('/units', { ...asB, method: 'POST', body: { blockId: blockA.id, doorNumber: '99' } });
  check("B, A'nın bloğuna daire açamıyor", foreignBlockUnit.status === 400, `status ${foreignBlockUnit.status}`);

  const moveUnit = await api(`/units/${unitB.id}`, { ...asB, method: 'PUT', body: { blockId: blockA.id, doorNumber: '1' } });
  check("B, dairesini A'nın bloğuna taşıyamıyor", moveUnit.status === 400, `status ${moveUnit.status}`);

  const foreignPerson = await api('/people/occupancies', {
    ...asB,
    method: 'POST',
    body: { unitId: unitB.id, personId: personA.id, role: 'OWNER', startDate: '2024-01-01' },
  });
  check("B, A'nın kişisini kendi dairesine bağlayamıyor", foreignPerson.status === 400, `status ${foreignPerson.status}`);

  const foreignUnit = await api('/people/occupancies', {
    ...asB,
    method: 'POST',
    body: { unitId: unitA.id, personId: personB.id, role: 'OWNER', startDate: '2024-01-01' },
  });
  check("B, kendi kişisini A'nın dairesine bağlayamıyor", foreignUnit.status === 400, `status ${foreignUnit.status}`);

  const foreignVehicle = await api(`/people/${personA.id}/vehicles`, { ...asB, method: 'POST', body: { plate: '34 ABC 123' } });
  check("B, A'nın kişisine araç ekleyemiyor", foreignVehicle.status === 404, `status ${foreignVehicle.status}`);

  const unitsB = await api('/units?pageSize=200', asB);
  check("B'nin daire listesinde A'nın kişisi görünmüyor",
    !JSON.stringify(unitsB.data).includes('Gizli') && !JSON.stringify(unitsB.data).includes('5321112233'),
  );
  const leaked = await prisma.unitOccupancy.count({ where: { siteId: siteB.id, personId: personA.id } });
  check("Veritabanında siteler arası daire ilişkisi oluşmadı", leaked === 0);

  // ------------------------------------------------ parametre gövdesiyle sızma
  // Ayar uç noktası gövdeyi doğrudan veritabanına veriyordu: siteId taşıma ve
  // iç içe yazma (site adı, üyelik) mümkündü.
  const nested = await api('/sites/settings', {
    ...asB,
    method: 'PUT',
    body: { site: { update: { name: 'ELE GEÇİRİLDİ' } } },
  });
  const siteBAfter = await prisma.site.findUnique({ where: { id: siteB.id } });
  check('Parametre gövdesiyle site kaydı değiştirilemiyor', nested.status === 400 && siteBAfter?.name === 'TEST SITE B', `status ${nested.status}`);

  const escalate = await api('/sites/settings', {
    ...asB,
    method: 'PUT',
    body: { site: { update: { memberships: { create: { userId: userA.id, role: 'SITE_ADMIN' } } } } },
  });
  const membershipCount = await prisma.siteMembership.count({ where: { userId: userA.id, siteId: siteB.id } });
  check('Parametre gövdesiyle üyelik oluşturulamıyor', escalate.status === 400 && membershipCount === 0, `status ${escalate.status}`);

  const settingsA = await prisma.siteSettings.findUnique({ where: { siteId: siteA.id } });
  const moved = await api('/sites/settings', { ...asB, method: 'PUT', body: { siteId: siteA.id, lateFeeGraceDays: 99 } });
  const settingsAAfter = await prisma.siteSettings.findUnique({ where: { siteId: siteA.id } });
  check(
    'Parametre gövdesindeki siteId yok sayılıyor / reddediliyor',
    moved.status === 400 && settingsAAfter?.lateFeeGraceDays === settingsA?.lateFeeGraceDays,
    `status ${moved.status}`,
  );

  // ------------------------------------------------------------- temizlik
  await prisma.site.deleteMany({ where: { id: { in: [siteA.id, siteB.id] } } });
  await cleanupTestOrganizations(prisma);
  await prisma.user.deleteMany({ where: { email: { in: ['a@test.local', 'b@test.local'] } } });

  console.log(`\n${passed} başarılı, ${failed} başarısız`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((error) => {
    console.error('Test hatası:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
