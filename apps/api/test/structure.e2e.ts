/**
 * SİTE YAPISI UÇTAN UCA TESTİ
 *
 *   blok / daire / kişi / daire ilişkisi: doğal sıralama, daire no tekrarı,
 *   aktif oturanlı daireyi pasife alma engeli, pasif listeleme ve geri alma,
 *   blok pasife alma kuralları, yetki
 *
 * Kendi izole test sitesini kurar ve sonunda siler; demo veriye dokunmaz.
 *
 *   pnpm --filter @sy/api run test:structure
 */
import { PrismaClient } from '@sy/db';
import { cleanupTestOrganizations, testOrganization } from './helpers';
import * as argon2 from 'argon2';

const BASE = process.env.API_BASE ?? 'http://localhost:3101';
const SITE_NAME = 'TEST YAPI SİTESİ';
const EMAILS = { admin: 'yapi-admin@test.local', accountant: 'yapi-muhasebe@test.local' };
const prisma = new PrismaClient();

let passed = 0;
let failed = 0;
let siteId = '';
const tokens: Record<string, string> = {};

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

async function api<T = any>(path: string, options: { method?: string; body?: unknown; as?: string } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens[options.as ?? 'admin']}`,
      'X-Site-Id': siteId,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, data: (await response.json().catch(() => null)) as T };
}

async function login(email: string): Promise<string> {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test1234!' }),
  });
  return ((await response.json()) as { accessToken: string }).accessToken;
}

async function cleanup() {
  await prisma.site.deleteMany({ where: { name: { in: [SITE_NAME, `${SITE_NAME} DİĞER`] } } });
  await cleanupTestOrganizations(prisma);
  await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } });
}

async function main(): Promise<void> {
  console.log('Site yapısı uçtan uca testi\n');
  await cleanup();
  // Zorunlu alan ayarları kapalı: test kişileri telefonsuz açılabilsin
  const site = await prisma.site.create({ data: { name: SITE_NAME, organization: testOrganization(SITE_NAME), settings: { create: { requireMobilePhone: false } } } });
  siteId = site.id;
  const passwordHash = await argon2.hash('Test1234!');
  const admin = await prisma.user.create({ data: { email: EMAILS.admin, passwordHash, fullName: 'Yapı Admin' } });
  const accountant = await prisma.user.create({ data: { email: EMAILS.accountant, passwordHash, fullName: 'Yapı Muhasebe' } });
  await prisma.siteMembership.createMany({
    data: [
      { userId: admin.id, siteId, role: 'SITE_ADMIN' },
      { userId: accountant.id, siteId, role: 'ACCOUNTANT' },
    ],
  });
  tokens.admin = await login(EMAILS.admin);
  tokens.accountant = await login(EMAILS.accountant);

  // ------------------------------------------------------------ bloklar
  const blockA = await api<any>('/blocks', { method: 'POST', body: { name: 'A Blok', order: 0 } });
  const blockB = await api<any>('/blocks', { method: 'POST', body: { name: 'B Blok', order: 1 } });
  check('Blok eklendi', blockA.status === 201 && blockB.status === 201);
  check('Muhasebe blok ekleyemiyor (403)', (await api('/blocks', { method: 'POST', as: 'accountant', body: { name: 'C Blok' } })).status === 403);
  check('Aynı adla blok (büyük/küçük harf duyarsız) reddedildi', (await api('/blocks', { method: 'POST', body: { name: 'a blok' } })).status === 409);

  // ------------------------------------------------------------ daireler + doğal sıralama
  for (const door of ['10', '2', '1', '11']) {
    await api('/units', { method: 'POST', body: { blockId: blockA.data.id, doorNumber: door } });
  }
  const list = await api<any>('/units?pageSize=50');
  check(
    'Daire no doğal sıralanıyor (1, 2, 10, 11 — "10" < "2" değil)',
    list.data.items.map((u: any) => u.doorNumber).join(',') === '1,2,10,11',
    list.data.items.map((u: any) => u.doorNumber).join(','),
  );
  const page2 = await api<any>('/units?pageSize=2&page=2');
  check('Sayfalama sıralamadan sonra uygulanıyor', page2.data.items.map((u: any) => u.doorNumber).join(',') === '10,11' && page2.data.total === 4);

  const free1 = await api('/units', { method: 'POST', body: { doorNumber: 'Dükkan 1' } });
  const free2 = await api<any>('/units', { method: 'POST', body: { doorNumber: 'Dükkan 1' } });
  check('Bloksuz dairede daire no tekrarı reddedildi (NULL unique açığı)', free1.status === 201 && free2.status === 409, `${free1.status}/${free2.status}`);

  // ------------------------------------------------------------ pasife alma kuralları
  const unit = list.data.items.find((u: any) => u.doorNumber === '2');
  const person = await api<any>('/people', { method: 'POST', body: { firstName: 'Oturan', lastName: 'Kişi', language: 'TR' } });
  const occupancy = await api<any>('/people/occupancies', {
    method: 'POST',
    body: { unitId: unit.id, personId: person.data.id, role: 'OWNER', startDate: '2024-01-01' },
  });
  check('Kişi daireye bağlandı', occupancy.status === 201);

  const blocked = await api<any>(`/units/${unit.id}`, { method: 'DELETE' });
  check(
    'Aktif oturanlı daire pasife alınamıyor (aidatı sessizce durmasın)',
    blocked.status === 409 && String(blocked.data.message).includes('Oturan Kişi'),
    `${blocked.status} ${blocked.data?.message}`,
  );

  const past = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await api(`/people/occupancies/${occupancy.data.id}/end`, { method: 'PUT', body: { endDate: past } });
  const deactivated = await api(`/units/${unit.id}`, { method: 'DELETE' });
  check('Çıkış verilince daire pasife alındı', deactivated.status === 200);
  check('Aktif listede yok, pasif listede var',
    !(await api<any>('/units?pageSize=50')).data.items.some((u: any) => u.id === unit.id) &&
      (await api<any>('/units?pageSize=50&active=false')).data.items.some((u: any) => u.id === unit.id));
  check('Pasif dairenin no\'su yeni daireye verilemiyor', (await api('/units', { method: 'POST', body: { blockId: blockA.data.id, doorNumber: '2' } })).status === 409);

  // ------------------------------------------------------------ blok kuralları
  const blockBlocked = await api<any>(`/blocks/${blockA.data.id}`, { method: 'DELETE' });
  check('Aktif dairesi olan blok pasife alınamıyor', blockBlocked.status === 409 && String(blockBlocked.data.message).includes('3 aktif daire'));
  check('Boş blok pasife alındı', (await api(`/blocks/${blockB.data.id}`, { method: 'DELETE' })).status === 200);
  const blocks = await api<any>('/blocks');
  check('Blok listesi pasifi göstermiyor, daire sayısı yalnızca aktif daireler', blocks.data.length === 1 && blocks.data[0]._count.units === 3);
  const reuse = await api<any>('/blocks', { method: 'POST', body: { name: 'B Blok' } });
  check('Pasif blokla aynı ad: yeniden etkinleştir mesajı', reuse.status === 409 && String(reuse.data.message).includes('pasif'));
  check('Blok yeniden etkinleştirildi', (await api(`/blocks/${blockB.data.id}/reactivate`, { method: 'POST' })).status === 200);

  // Pasif bloktaki daire, blok etkinleşmeden geri açılamaz
  const unitInB = await api<any>('/units', { method: 'POST', body: { blockId: blockB.data.id, doorNumber: '1' } });
  await api(`/units/${unitInB.data.id}`, { method: 'DELETE' });
  await api(`/blocks/${blockB.data.id}`, { method: 'DELETE' });
  const reactivateInPassive = await api(`/units/${unitInB.data.id}/reactivate`, { method: 'POST' });
  check('Pasif bloktaki daire önce blok açılmadan etkinleşmiyor', reactivateInPassive.status === 409);
  check('Daire yeniden etkinleştirildi', (await api(`/units/${unit.id}/reactivate`, { method: 'POST' })).status === 200);

  const audit = await prisma.auditLog.count({ where: { siteId, entityType: { in: ['Unit', 'Block'] } } });
  check('Blok/daire işlemleri denetim kaydında', audit >= 6, String(audit));

  // ------------------------------------------------------------ toplu aktarım
  const TC = '10000000146';
  // Başka sitede aynı TC'li bir kişi: eşleşmemeli (anlık görüntü siteye daraltılır)
  const other = await prisma.site.create({ data: { name: `${SITE_NAME} DİĞER`, organization: testOrganization(`${SITE_NAME} DİĞER`), settings: { create: {} } } });
  await prisma.person.create({ data: { siteId: other.id, firstName: 'Yabancı', lastName: 'Kişi', nationalId: TC } });

  const good = [
    'Blok\tDaire No\tKat\tm²\tAd Soyad\tSıfat\tCep Telefonu\tTC Kimlik No\tGiriş Tarihi',
    `C Blok\t1\t1\t110,5\tAyşe Nur Yılmaz\tMalik\t0532 111 22 33\t${TC}\t01.06.2020`,
    'C Blok\t1\t1\t110,5\tCan Su\tKiracı\t0532 444 55 66\t\t15.01.2025',
    `C Blok\t2\t1\t95\tAyşe Nur Yılmaz\tMalik\t0532 111 22 33\t${TC}\t01.06.2020`,
    'C Blok\t3\t2\t\t\t\t\t\t',
    'A Blok\t1\t\t\tDeniz Ak\tMalik\t\t\t',
  ].join('\n');
  const bad = good + '\nC Blok\t4\t\t\tTek\tMalik\t0212 000 00 00\t\t';

  check('Muhasebe toplu aktarım yapamıyor (403)', (await api('/import/structure/preview', { method: 'POST', as: 'accountant', body: { text: good } })).status === 403);

  const before = await prisma.person.count({ where: { siteId } });
  const badPreview = await api<any>('/import/structure/preview', { method: 'POST', body: { text: bad } });
  check(
    'Önizleme hatalı satırı gösteriyor, aktarıma izin vermiyor',
    badPreview.status === 200 && badPreview.data.canCommit === false && badPreview.data.errors.some((e: any) => e.line === 7),
    JSON.stringify(badPreview.data?.errors),
  );
  const badCommit = await api<any>('/import/structure/commit', { method: 'POST', body: { text: bad } });
  check(
    'Hatalı listede aktarım reddedildi, hiçbir kayıt yazılmadı',
    badCommit.status === 400 && (await prisma.person.count({ where: { siteId } })) === before && (await prisma.block.count({ where: { siteId, name: 'C Blok' } })) === 0,
  );

  const preview = await api<any>('/import/structure/preview', { method: 'POST', body: { text: good } });
  check(
    'Önizleme planı: 1 yeni blok, 3 yeni daire, A/1 mevcut daire, 3 yeni kişi (aynı TC tek kişi), 4 ilişki',
    preview.data.canCommit === true &&
      preview.data.summary.newBlocks === 1 &&
      preview.data.summary.newUnits === 3 &&
      preview.data.summary.existingUnits === 1 &&
      preview.data.summary.newPeople === 3 &&
      preview.data.summary.newOccupancies === 4,
    JSON.stringify(preview.data.summary),
  );
  check('Önizleme hiçbir şey yazmadı', (await prisma.person.count({ where: { siteId } })) === before);

  const commit = await api<any>('/import/structure/commit', { method: 'POST', body: { text: good } });
  check('Aktarım tamamlandı', commit.status === 201, `${commit.status} ${JSON.stringify(commit.data)}`);
  const ayse = await prisma.person.findFirst({
    where: { siteId, nationalId: TC },
    include: { account: true, occupancies: { include: { unit: true } } },
  });
  check(
    'Kişi, cari hesabı ve iki dairesi oluştu; giriş tarihi dosyadan',
    !!ayse && ayse.firstName === 'Ayşe Nur' && ayse.phone === '5321112233' && !!ayse.account &&
      ayse.occupancies.length === 2 && ayse.occupancies.every((o) => o.startDate.getFullYear() === 2020),
  );
  const c1 = await prisma.unit.findFirst({ where: { siteId, doorNumber: '1', block: { name: 'C Blok' } }, include: { occupancies: true } });
  check('C/1: m² Türkçe ondalıkla, malik + kiracı', Number(c1?.area) === 110.5 && c1?.occupancies.length === 2);
  const c3 = await prisma.unit.findFirst({ where: { siteId, doorNumber: '3', block: { name: 'C Blok' } } });
  check('Kimsenin bağlanmadığı yeni daire "Boş"', c3?.status === 'EMPTY' && c1?.status === 'OCCUPIED');
  check('Başka sitedeki aynı TC eşleşmedi', (await prisma.person.count({ where: { siteId: other.id } })) === 1 && ayse?.siteId === siteId);

  const again = await api<any>('/import/structure/preview', { method: 'POST', body: { text: good } });
  check(
    'Aynı liste ikinci kez: her şey mevcut, yeni kayıt yok',
    again.data.canCommit === true &&
      again.data.summary.newBlocks === 0 &&
      again.data.summary.newUnits === 0 &&
      again.data.summary.newPeople === 0 &&
      again.data.summary.newOccupancies === 0 &&
      again.data.summary.existingOccupancies === 4,
    JSON.stringify(again.data.summary),
  );
  const conflict = await api<any>('/import/structure/preview', {
    method: 'POST',
    body: { text: 'Blok;Daire;Ad;Soyad;Sıfat\nC Blok;2;Başka;Malik;Malik' },
  });
  check('Dolu daireye ikinci malik reddediliyor', conflict.data.errors.some((e: any) => String(e.message).includes('zaten malik var')));
  check('Aktarım denetim kaydında', (await prisma.auditLog.count({ where: { siteId, action: 'IMPORT', entityType: 'Structure' } })) === 1);
  await prisma.site.delete({ where: { id: other.id } });
  await cleanupTestOrganizations(prisma);

  await cleanup();
  console.log(`\n${passed} başarılı, ${failed} başarısız`);
  if (failed > 0) process.exit(1);
}

main()
  .catch(async (error) => {
    console.error('Test hatası:', error);
    await cleanup().catch(() => undefined);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
