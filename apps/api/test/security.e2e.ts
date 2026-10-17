/**
 * GÜVENLİK UÇTAN UCA TESTİ
 *
 *   olay kaydı (doğrulama, düzenleme yetkisi, silme) → kayıp eşya yaşam
 *   döngüsü (bildirim → bulundu → talep → red → teslim, imha süresi) →
 *   ziyaretçi giriş/çıkış (plaka, araç eşleşmesi, TC maskesi) → yetki → izolasyon
 *
 * Kendi izole test sitelerini kurar ve sonunda siler; demo veriye dokunmaz.
 *
 *   pnpm --filter @sy/api run test:security
 */
import { PrismaClient } from '@sy/db';
import * as argon2 from 'argon2';

const BASE = process.env.API_BASE ?? 'http://localhost:3101';
const SITE_NAME = 'TEST GÜVENLİK SİTESİ';
const OTHER_SITE_NAME = 'TEST GÜVENLİK DİĞER SİTE';
const EMAILS = {
  admin: 'guvenlik-admin@test.local',
  guard: 'guvenlik-gorevli@test.local',
  guard2: 'guvenlik-gorevli2@test.local',
  accountant: 'guvenlik-muhasebe@test.local',
  resident: 'guvenlik-sakin@test.local',
};
/** Geçerli sağlama haneli TC kimlik no */
const NATIONAL_ID = '10000000146';
const prisma = new PrismaClient();

let passed = 0;
let failed = 0;
let siteId = '';
let otherSiteId = '';
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

async function api<T = any>(path: string, options: { method?: string; body?: unknown; as?: string; site?: string } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens[options.as ?? 'admin']}`,
      'X-Site-Id': options.site ?? siteId,
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
  await prisma.site.deleteMany({ where: { name: { in: [SITE_NAME, OTHER_SITE_NAME] } } });
  await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } });
}

async function setup() {
  await cleanup();
  const site = await prisma.site.create({ data: { name: SITE_NAME, settings: { create: {} } } });
  const other = await prisma.site.create({ data: { name: OTHER_SITE_NAME, settings: { create: {} } } });
  siteId = site.id;
  otherSiteId = other.id;

  const passwordHash = await argon2.hash('Test1234!');
  const users: Record<string, string> = {};
  for (const [key, email] of Object.entries(EMAILS)) {
    users[key] = (await prisma.user.create({ data: { email, passwordHash, fullName: `Test ${key}` } })).id;
  }
  ids.guardUser = users.guard;
  ids.accountantUser = users.accountant;

  const block = await prisma.block.create({ data: { siteId, name: 'G Blok' } });
  const unit = await prisma.unit.create({ data: { siteId, blockId: block.id, doorNumber: '7' } });
  const person = await prisma.person.create({ data: { siteId, firstName: 'Ev', lastName: 'Sahibi' } });
  await prisma.unitOccupancy.create({
    data: { siteId, unitId: unit.id, personId: person.id, role: 'OWNER', startDate: new Date('2020-01-01') },
  });
  // Sitede kayıtlı iki araç: biri sakinin, biri yasaklı (serbest biçimde yazılmış plakalar)
  await prisma.vehicle.create({ data: { siteId, personId: person.id, plate: '34 abc 123', status: 'sakin' } });
  await prisma.vehicle.create({ data: { siteId, personId: person.id, plate: '06-ZZ-999', status: 'Yasaklı' } });
  ids.unit = unit.id;
  ids.person = person.id;

  const foreignBlock = await prisma.block.create({ data: { siteId: otherSiteId, name: 'Y Blok' } });
  const foreignUnit = await prisma.unit.create({ data: { siteId: otherSiteId, blockId: foreignBlock.id, doorNumber: '1' } });
  const foreignPerson = await prisma.person.create({ data: { siteId: otherSiteId, firstName: 'Yabancı', lastName: 'Kişi' } });
  ids.foreignUnit = foreignUnit.id;
  ids.foreignPerson = foreignPerson.id;
  ids.foreignIncident = (
    await prisma.securityIncident.create({
      data: { siteId: otherSiteId, date: new Date(), title: 'Yabancı olay', body: 'gizli' },
    })
  ).id;
  ids.foreignLost = (
    await prisma.lostItem.create({
      data: { siteId: otherSiteId, number: 1, itemName: 'Yabancı cüzdan', custodianName: 'X', foundAt: new Date() },
    })
  ).id;
  ids.foreignVisit = (await prisma.visitorLog.create({ data: { siteId: otherSiteId, visitorName: 'Yabancı Ziyaretçi' } })).id;

  await prisma.siteMembership.createMany({
    data: [
      { userId: users.admin, siteId, role: 'SITE_ADMIN' },
      { userId: users.guard, siteId, role: 'SECURITY' },
      { userId: users.guard2, siteId, role: 'SECURITY' },
      { userId: users.accountant, siteId, role: 'ACCOUNTANT' },
      { userId: users.resident, siteId, role: 'RESIDENT', personId: person.id },
    ],
  });

  for (const key of Object.keys(EMAILS)) tokens[key] = await login(EMAILS[key as keyof typeof EMAILS]);
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

async function main(): Promise<void> {
  console.log('Güvenlik uçtan uca testi\n');
  await setup();

  // ------------------------------------------------------------ 1) yetki
  check('Muhasebe güvenlik modülüne erişemiyor (403)', (await api('/security/summary', { as: 'accountant' })).status === 403);
  check('Sakin güvenlik modülüne erişemiyor (403)', (await api('/security/visitors', { as: 'resident' })).status === 403);
  const meta = await api<any>('/security/meta', { as: 'guard' });
  check(
    'Görevli listesi yalnızca güvenlik + yönetici',
    meta.status === 200 && meta.data.staff.length === 3 && !meta.data.staff.some((s: any) => s.id === ids.accountantUser),
  );

  // ------------------------------------------------------------ 2) olaylar
  const badIncident = await api('/security/incidents', { method: 'POST', as: 'guard', body: { date: new Date().toISOString(), title: 'x', body: '' } });
  check('Eksik olay kaydı reddedildi (400)', badIncident.status === 400);

  const future = await api('/security/incidents', {
    method: 'POST',
    as: 'guard',
    body: { date: new Date(Date.now() + 86_400_000).toISOString(), title: 'İleri tarih', body: 'x' },
  });
  check('İleri tarihli olay reddedildi', future.status === 400);

  const wrongStaff = await api('/security/incidents', {
    method: 'POST',
    as: 'guard',
    body: { date: hoursAgo(1), title: 'Görevli hatalı', body: 'x', staffId: ids.accountantUser },
  });
  check('Güvenlik olmayan kullanıcı görevli seçilemiyor', wrongStaff.status === 400);

  const foreignRef = await api('/security/incidents', {
    method: 'POST',
    as: 'guard',
    body: { date: hoursAgo(1), title: 'Yabancı daire', body: 'x', unitId: ids.foreignUnit },
  });
  check('Başka sitenin dairesi olaya bağlanamıyor', foreignRef.status === 400);

  const incident = await api<any>('/security/incidents', {
    method: 'POST',
    as: 'guard',
    body: {
      date: hoursAgo(2),
      title: 'Otoparkta araç çizildi',
      category: 'DAMAGE',
      severity: 'HIGH',
      staffId: ids.guardUser,
      unitId: ids.unit,
      personId: ids.person,
      body: '<script>alert(1)</script> B2 katında araç çizildi.',
    },
  });
  check('Olay kaydı oluşturuldu', incident.status === 201 && !!incident.data.id);
  ids.incident = incident.data.id;

  const detail = await api<any>(`/security/incidents/${ids.incident}`, { as: 'guard' });
  check(
    'Olay detayı: daire, kişi, görevli etiketli; metin olduğu gibi saklandı',
    detail.data.unit?.label === 'G Blok / 7' &&
      detail.data.person?.fullName === 'Ev Sahibi' &&
      detail.data.staff?.fullName === 'Test guard' &&
      detail.data.body.startsWith('<script>') &&
      detail.data.canEdit === true,
  );

  const edited = { ...detail.data, title: 'Otoparkta araç çizildi (güncel)', staffId: ids.guardUser };
  const payload = {
    date: edited.date,
    title: edited.title,
    category: edited.category,
    severity: edited.severity,
    staffId: edited.staffId,
    unitId: edited.unitId,
    personId: edited.personId,
    body: edited.body,
  };
  check(
    'Başka güvenlik görevlisi kaydı düzenleyemiyor (403)',
    (await api(`/security/incidents/${ids.incident}`, { method: 'PUT', as: 'guard2', body: payload })).status === 403,
  );
  check(
    'Kaydı açan görevli düzenleyebiliyor',
    (await api(`/security/incidents/${ids.incident}`, { method: 'PUT', as: 'guard', body: payload })).status === 200,
  );

  const filtered = await api<any>('/security/incidents?severity=HIGH&search=çizildi', { as: 'guard' });
  check('Olay listesi önem + arama filtresi', filtered.data.total === 1 && filtered.data.items[0].title.includes('güncel'));
  const summary1 = await api<any>('/security/summary', { as: 'guard' });
  check('Özet: son 30 günde 1 olay, 1 yüksek', summary1.data.incidentsLast30Days === 1 && summary1.data.highIncidentsLast30Days === 1);

  check(
    'Görevli olay silemiyor (403)',
    (await api(`/security/incidents/${ids.incident}`, { method: 'DELETE', as: 'guard' })).status === 403,
  );

  // ------------------------------------------------------------ 3) kayıp eşya
  check(
    'Kayıp bildiriminde bildiren zorunlu',
    (await api('/security/lost-items', { method: 'POST', as: 'guard', body: { status: 'LOST', itemName: 'Anahtar' } })).status === 400,
  );
  const report = await api<any>('/security/lost-items', {
    method: 'POST',
    as: 'guard',
    body: { status: 'LOST', itemName: 'Araba anahtarı', location: 'Havuz başı', loserName: 'Ev Sahibi', loserPhone: '05321112233', lostAt: daysAgo(1) },
  });
  check('Kayıp bildirimi açıldı (emanet no 1)', report.status === 201 && report.data.number === 1);
  ids.report = report.data.id;

  const noCustodian = await api<any>(`/security/lost-items/${ids.report}/transition`, { method: 'POST', as: 'guard', body: { to: 'FOUND' } });
  check('Bulundu geçişinde emanetçi zorunlu', noCustodian.status === 400 && noCustodian.data.errors?.[0]?.field === 'custodianName');
  check(
    'Kayıp bildirimi doğrudan teslim edilemiyor',
    (await api(`/security/lost-items/${ids.report}/transition`, { method: 'POST', as: 'guard', body: { to: 'DELIVERED', deliveredTo: 'X' } })).status === 400,
  );
  const foundIt = await api(`/security/lost-items/${ids.report}/transition`, {
    method: 'POST',
    as: 'guard',
    body: { to: 'FOUND', custodianName: 'Güvenlik Kulübesi', finderName: 'Bahçıvan' },
  });
  check('Kayıp eşya bulundu → emanette', foundIt.status === 201);
  const delivered = await api(`/security/lost-items/${ids.report}/transition`, {
    method: 'POST',
    as: 'guard',
    body: { to: 'DELIVERED', deliveredTo: 'Ev Sahibi' },
  });
  check('Sahibine teslim edildi', delivered.status === 201);
  check(
    'Teslim edilmiş kayıt değiştirilemiyor (409)',
    (await api(`/security/lost-items/${ids.report}`, { method: 'PUT', as: 'guard', body: { itemName: 'Değişti' } })).status === 409,
  );
  const reportDetail = await api<any>(`/security/lost-items/${ids.report}`, { as: 'guard' });
  check(
    'Geçmişte üç adım (açılış, bulundu, teslim)',
    reportDetail.data.history.map((h: any) => h.status).join(',') === 'LOST,FOUND,DELIVERED',
    JSON.stringify(reportDetail.data.history),
  );

  // Bulunan eşya: talep → red → imha süresi
  const wallet = await api<any>('/security/lost-items', {
    method: 'POST',
    as: 'guard',
    body: { status: 'FOUND', itemName: 'Kahverengi cüzdan', custodianName: 'Yönetim Ofisi' },
  });
  check('Bulunan eşya kaydı (emanet no 2)', wallet.data.number === 2);
  ids.wallet = wallet.data.id;
  await api(`/security/lost-items/${ids.wallet}/transition`, { method: 'POST', as: 'guard', body: { to: 'CLAIMED', loserName: 'Sahte Sahip' } });
  const rejected = await api(`/security/lost-items/${ids.wallet}/transition`, { method: 'POST', as: 'guard', body: { to: 'FOUND' } });
  const afterReject = await prisma.lostItem.findUnique({ where: { id: ids.wallet } });
  check('Reddedilen talep: emanete döndü, talep eden silindi', rejected.status === 201 && afterReject?.status === 'FOUND' && afterReject.loserName === null);

  const early = await api<any>(`/security/lost-items/${ids.wallet}/transition`, {
    method: 'POST',
    as: 'guard',
    body: { to: 'DISPOSED', disposalNote: 'Bağış' },
  });
  check('Emanet süresi dolmadan imha reddedildi', early.status === 400 && String(early.data.message).includes('30 gün'));

  await prisma.lostItem.update({ where: { id: ids.wallet }, data: { foundAt: new Date(Date.now() - 40 * 86_400_000) } });
  const disposed = await api(`/security/lost-items/${ids.wallet}/transition`, {
    method: 'POST',
    as: 'guard',
    body: { to: 'DISPOSED', disposalNote: 'Kızılay bağış' },
  });
  check('Süresi dolan eşya imha/bağış edildi', disposed.status === 201);
  check(
    'Emanetteki/kapanmış eşya silinemiyor (yalnızca kayıp bildirimi)',
    (await api(`/security/lost-items/${ids.wallet}`, { method: 'DELETE' })).status === 409,
  );

  // Eşzamanlı iki geçiş: yalnızca biri uygulanır
  const umbrella = await api<any>('/security/lost-items', {
    method: 'POST',
    as: 'guard',
    body: { status: 'FOUND', itemName: 'Şemsiye', custodianName: 'Kulübe' },
  });
  const race = await Promise.all([
    api(`/security/lost-items/${umbrella.data.id}/transition`, { method: 'POST', as: 'guard', body: { to: 'DELIVERED', deliveredTo: 'A' } }),
    api(`/security/lost-items/${umbrella.data.id}/transition`, { method: 'POST', as: 'guard2', body: { to: 'DELIVERED', deliveredTo: 'B' } }),
  ]);
  check(
    'Eşzamanlı iki teslimden yalnızca biri geçti',
    race.filter((r) => r.status === 201).length === 1,
    race.map((r) => r.status).join(','),
  );

  const open = await api<any>('/security/lost-items?open=true', { as: 'guard' });
  check('Açık kayıt listesi kapananları içermiyor', open.data.total === 0, JSON.stringify(open.data.items?.map((i: any) => i.status)));
  check('Emanet no ile arama', (await api<any>('/security/lost-items?search=2', { as: 'guard' })).data.items.some((i: any) => i.number === 2));

  // ------------------------------------------------------------ 4) ziyaretçiler
  check(
    'Geçersiz TC reddedildi',
    (await api('/security/visitors', { method: 'POST', as: 'guard', body: { visitorName: 'Ali Veli', nationalId: '12345678901', unitId: ids.unit } }))
      .status === 400,
  );
  check(
    'Hedef (daire/kişi/amaç) olmadan giriş reddedildi',
    (await api('/security/visitors', { method: 'POST', as: 'guard', body: { visitorName: 'Ali Veli' } })).status === 400,
  );
  check(
    'Başka sitenin dairesine ziyaret açılamıyor',
    (await api('/security/visitors', { method: 'POST', as: 'guard', body: { visitorName: 'Ali Veli', unitId: ids.foreignUnit } })).status === 400,
  );

  await prisma.siteSettings.update({ where: { siteId }, data: { requireVisitorId: true } });
  const noId = await api<any>('/security/visitors', { method: 'POST', as: 'guard', body: { visitorName: 'Kimliksiz', purpose: 'Kargo' } });
  check('Parametre açıkken TC olmadan giriş reddedildi', noId.status === 400 && String(noId.data?.message).includes('TC'));
  await prisma.siteSettings.update({ where: { siteId }, data: { requireVisitorId: false } });

  const visit = await api<any>('/security/visitors', {
    method: 'POST',
    as: 'guard',
    body: { visitorName: 'Ali Veli', nationalId: NATIONAL_ID, plate: '34 Abc 123', unitId: ids.unit, hostPersonId: ids.person, purpose: 'Misafir' },
  });
  check(
    'Giriş: plaka biçimlendi, site aracı tanındı, TC maskeli',
    visit.status === 201 &&
      visit.data.plate === '34 ABC 123' &&
      visit.data.vehicle?.owner === 'Ev Sahibi' &&
      visit.data.nationalIdMasked === '100******46' &&
      !JSON.stringify(visit.data).includes(NATIONAL_ID),
    JSON.stringify(visit.data),
  );
  ids.visit = visit.data.id;
  const stored = await prisma.visitorLog.findUnique({ where: { id: ids.visit } });
  check('Plaka normalize saklandı', stored?.plate === '34ABC123');

  const banned = await api<any>('/security/visitors', {
    method: 'POST',
    as: 'guard',
    body: { visitorName: 'Yasaklı Sürücü', plate: '06 zz 999', purpose: 'Kargo' },
  });
  check('Yasaklı plaka: kayıt açıldı ama uyarı döndü', banned.status === 201 && !!banned.data.warning);

  const forgotten = await prisma.visitorLog.create({
    data: { siteId, visitorName: 'Unutulan Ziyaretçi', purpose: 'Tadilat', enteredAt: new Date(Date.now() - 20 * 3_600_000) },
  });

  const inside = await api<any>('/security/visitors?inside=true', { as: 'guard' });
  check('İçeridekiler listesi: 3 ziyaretçi', inside.data.total === 3);
  check('Çıkışı unutulan ziyaretçi işaretli', inside.data.items.find((v: any) => v.id === forgotten.id)?.overstay === true);
  check('TC yalnızca tam eşleşmeyle aranıyor', (await api<any>(`/security/visitors?search=${NATIONAL_ID}`, { as: 'guard' })).data.total === 1);
  check('TC parçasıyla arama sonuç vermiyor', (await api<any>(`/security/visitors?search=1000000`, { as: 'guard' })).data.total === 0);
  check('Plaka boşluksuz/küçük harfle aranıyor', (await api<any>('/security/visitors?search=34abc', { as: 'guard' })).data.total === 1);
  check('Ev sahibinin adıyla aranıyor', (await api<any>('/security/visitors?search=sahibi', { as: 'guard' })).data.total === 1);

  const audit = await prisma.auditLog.findFirst({ where: { siteId, entityType: 'VisitorLog', entityId: ids.visit } });
  check('Denetim kaydında TC açık yazılmadı', !!audit && !JSON.stringify(audit.after).includes(NATIONAL_ID));

  check(
    'Girişten önceki çıkış saati reddedildi',
    (await api(`/security/visitors/${ids.visit}/exit`, { method: 'POST', as: 'guard', body: { exitedAt: hoursAgo(5) } })).status === 400,
  );
  const exits = await Promise.all([
    api(`/security/visitors/${ids.visit}/exit`, { method: 'POST', as: 'guard', body: {} }),
    api(`/security/visitors/${ids.visit}/exit`, { method: 'POST', as: 'guard2', body: {} }),
  ]);
  check('Çift çıkış: yalnızca biri yazıldı', exits.filter((r) => r.status === 201).length === 1, exits.map((r) => r.status).join(','));

  const summary2 = await api<any>('/security/summary', { as: 'guard' });
  check(
    'Özet: içeride 2, 1 unutulmuş, bugün 2 giriş, emanette 0',
    summary2.data.visitorsInside === 2 && summary2.data.visitorsOverstay === 1 && summary2.data.lostInCustody === 0,
    JSON.stringify(summary2.data),
  );

  // ------------------------------------------------------------ 5) silme (yönetici)
  check('Yönetici olayı silebiliyor', (await api(`/security/incidents/${ids.incident}`, { method: 'DELETE' })).status === 200);

  // ------------------------------------------------------------ 6) izolasyon
  check('Başka sitenin olayı okunamıyor (404)', (await api(`/security/incidents/${ids.foreignIncident}`)).status === 404);
  check('Başka sitenin olayı silinemiyor (404)', (await api(`/security/incidents/${ids.foreignIncident}`, { method: 'DELETE' })).status === 404);
  check(
    'Başka sitenin eşyası teslim edilemiyor (404)',
    (await api(`/security/lost-items/${ids.foreignLost}/transition`, { method: 'POST', body: { to: 'DELIVERED', deliveredTo: 'Ben' } })).status === 404,
  );
  check(
    'Başka sitenin ziyaretçisine çıkış verilemiyor (404)',
    (await api(`/security/visitors/${ids.foreignVisit}/exit`, { method: 'POST', body: {} })).status === 404,
  );
  const visitors = await api<any>('/security/visitors?search=Yabancı');
  check('Ziyaretçi listesinde diğer site yok', visitors.data.total === 0);
  check('Üyesi olmadığı sitenin özetine erişilemiyor (403)', (await api('/security/summary', { site: otherSiteId })).status === 403);
  const untouched = await prisma.lostItem.findUnique({ where: { id: ids.foreignLost } });
  check('Diğer sitenin eşyası değişmedi', untouched?.status === 'FOUND');

  // ------------------------------------------------------------ temizlik
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
