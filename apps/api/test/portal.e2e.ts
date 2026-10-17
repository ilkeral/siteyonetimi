/**
 * İKAMET EDEN PORTALI UÇTAN UCA TESTİ
 *
 *   varsayılan ret (ikamet eden → panel uç noktaları) → özet/ekstre →
 *   aynı sitede ikamet edenler arası izolasyon → talepler (iç not gizliliği) →
 *   duyurular → çevrimiçi ödeme (mock) → portal erişimi verme/kaldırma →
 *   parola değiştirme
 *
 * Kendi izole test sitelerini kurar ve sonunda siler; demo veriye dokunmaz.
 *
 *   pnpm --filter @sy/api run test:portal
 */
import { PrismaClient } from '@sy/db';
import { cleanupTestOrganizations, testOrganization } from './helpers';
import * as argon2 from 'argon2';

const BASE = process.env.API_BASE ?? 'http://localhost:3101';
const SITE_NAME = 'TEST PORTAL SİTESİ';
const OTHER_SITE_NAME = 'TEST PORTAL DİĞER SİTE';
const PASSWORD = 'Test1234!';
const EMAILS = {
  admin: 'portal-admin@test.local',
  a: 'sakin-a@test.local',
  b: 'sakin-b@test.local',
  unlinked: 'sakin-bagsiz@test.local',
  c: 'sakin-c@test.local',
};
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

async function api<T = any>(
  path: string,
  options: { method?: string; body?: unknown; as?: string; token?: string } = {},
): Promise<{ status: number; data: T }> {
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.token ?? tokens[options.as ?? 'a']}`,
      'X-Site-Id': siteId,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data: data as T };
}

async function login(email: string, password = PASSWORD) {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: response.status, data: (await response.json()) as any };
}

async function cleanup() {
  await prisma.site.deleteMany({ where: { name: { in: [SITE_NAME, OTHER_SITE_NAME] } } });
  await cleanupTestOrganizations(prisma);
  await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } });
}

async function setup() {
  await cleanup();
  const site = await prisma.site.create({ data: { name: SITE_NAME, organization: testOrganization(SITE_NAME), city: 'Antalya', settings: { create: {} } } });
  const other = await prisma.site.create({ data: { name: OTHER_SITE_NAME, organization: testOrganization(OTHER_SITE_NAME), city: 'Muğla', settings: { create: {} } } });
  siteId = site.id;
  otherSiteId = other.id;

  const block = await prisma.block.create({ data: { siteId, name: 'A Blok' } });
  const passwordHash = await argon2.hash(PASSWORD);

  for (const [i, key] of (['a', 'b', 'c'] as const).entries()) {
    const unit = await prisma.unit.create({ data: { siteId, blockId: block.id, doorNumber: String(i + 1) } });
    const person = await prisma.person.create({ data: { siteId, firstName: `Sakin${key.toUpperCase()}`, lastName: 'Test' } });
    const account = await prisma.account.create({
      data: { siteId, type: 'PERSON', name: `Sakin${key.toUpperCase()} Test`, personId: person.id },
    });
    await prisma.unitOccupancy.create({
      data: { siteId, unitId: unit.id, personId: person.id, role: 'OWNER', startDate: new Date('2020-01-01') },
    });
    ids[`person_${key}`] = person.id;
    ids[`unit_${key}`] = unit.id;
    ids[`account_${key}`] = account.id;
  }

  // A'nın vadesi geçmiş 1.500 TL aidat borcu
  await prisma.document.create({
    data: {
      siteId,
      type: 'DUES_ACCRUAL',
      status: 'POSTED',
      number: 'AID-2026-000001',
      date: new Date('2026-09-01'),
      dueDate: new Date('2026-09-15'),
      period: '2026-09',
      totalAmount: 1500,
      unitId: ids.unit_a,
      entries: { create: { siteId, accountId: ids.account_a, date: new Date('2026-09-01'), debit: 1500, credit: 0 } },
    },
  });
  await prisma.account.create({ data: { siteId, type: 'BANK', name: 'Test Banka' } });

  const admin = await prisma.user.create({ data: { email: EMAILS.admin, passwordHash, fullName: 'Portal Yöneticisi' } });
  const a = await prisma.user.create({ data: { email: EMAILS.a, passwordHash, fullName: 'SakinA Test' } });
  const b = await prisma.user.create({ data: { email: EMAILS.b, passwordHash, fullName: 'SakinB Test' } });
  const unlinked = await prisma.user.create({ data: { email: EMAILS.unlinked, passwordHash, fullName: 'Bağsız' } });
  await prisma.siteMembership.createMany({
    data: [
      { userId: admin.id, siteId, role: 'SITE_ADMIN' },
      { userId: a.id, siteId, role: 'RESIDENT', personId: ids.person_a },
      { userId: b.id, siteId, role: 'RESIDENT', personId: ids.person_b },
      { userId: unlinked.id, siteId, role: 'RESIDENT' },
    ],
  });

  // Duyurular: 2 yayında (biri sabitlenmiş), 1 ileri tarihli, 1 süresi dolmuş, 1 pasif
  const day = 86_400_000;
  await prisma.announcement.createMany({
    data: [
      { siteId, title: 'Normal duyuru', body: 'x', publishAt: new Date(Date.now() - day) },
      { siteId, title: 'Sabit duyuru', body: 'x', publishAt: new Date(Date.now() - 2 * day), isPinned: true },
      { siteId, title: 'Gelecek duyuru', body: 'x', publishAt: new Date(Date.now() + day) },
      { siteId, title: 'Bitmiş duyuru', body: 'x', publishAt: new Date(Date.now() - 3 * day), expireAt: new Date(Date.now() - day) },
      { siteId, title: 'Pasif duyuru', body: 'x', isActive: false },
    ],
  });

  // Bildirim geçmişi: A'ya bir, B'ye bir mesaj
  await prisma.notificationMessage.createMany({
    data: [
      { siteId, personId: ids.person_a, channel: 'SMS', recipient: '+905320000001', body: 'A mesajı', status: 'SENT' },
      { siteId, personId: ids.person_b, channel: 'SMS', recipient: '+905320000002', body: 'B mesajı', status: 'SENT' },
    ],
  });

  const foreign = await prisma.person.create({ data: { siteId: otherSiteId, firstName: 'Yabancı', lastName: 'Kişi' } });
  ids.person_foreign = foreign.id;

  tokens.admin = (await login(EMAILS.admin)).data.accessToken;
  tokens.a = (await login(EMAILS.a)).data.accessToken;
  tokens.b = (await login(EMAILS.b)).data.accessToken;
  tokens.unlinked = (await login(EMAILS.unlinked)).data.accessToken;
}

async function main(): Promise<void> {
  console.log('İkamet Eden Portalı uçtan uca testi\n');
  await setup();

  // ---------------------------------------------- 1) varsayılan ret
  const panelEndpoints = [
    '/finance/accounts',
    '/finance/dashboard',
    '/people',
    `/people/${ids.person_b}`,
    '/units',
    '/blocks',
    '/sites/current',
    '/tickets/board',
    '/meters/distributions',
    '/notifications/campaigns',
    '/announcements',
  ];
  const leaks: string[] = [];
  for (const path of panelEndpoints) {
    const res = await api(path);
    if (res.status !== 403) leaks.push(`${path} → ${res.status}`);
  }
  check(`İkamet eden ${panelEndpoints.length} panel uç noktasının hiçbirine erişemiyor (403)`, leaks.length === 0, leaks.join(', '));
  check('İkamet eden /auth/me ile kendi oturumunu okuyabiliyor', (await api('/auth/me')).status === 200);
  check('Personel portal uç noktasına erişemiyor (403)', (await api('/portal/summary', { as: 'admin' })).status === 403);
  const unlinked = await api<any>('/portal/summary', { as: 'unlinked' });
  check('Kişiye bağlı olmayan ikamet eden hesabı reddediliyor (403)', unlinked.status === 403 && unlinked.data.message.includes('kişi kaydına'));

  // ------------------------------------------------ 2) özet ve ekstre
  const summary = await api<any>('/portal/summary');
  check('Özet: bakiye 1.500 TL', summary.data.balanceMinor === 150000, JSON.stringify(summary.data.balanceMinor));
  check(
    'Özet: açık borç vadesi geçmiş olarak işaretli',
    summary.data.openItems.length === 1 && summary.data.openItems[0].overdue === true,
  );
  check('Özet: yalnızca kendi dairesi', summary.data.units.length === 1 && summary.data.units[0].label === 'A Blok / 1');
  check('Özet: çevrimiçi ödeme açık', summary.data.onlinePayment === true);
  check('Özet: yalnızca kendi mesajı', summary.data.messages.length === 1 && summary.data.messages[0].body === 'A mesajı');

  const statementA = await api<any>('/portal/statement?from=2026-01-01&to=2026-12-31');
  const statementB = await api<any>('/portal/statement?from=2026-01-01&to=2026-12-31', { as: 'b' });
  check('A ekstresinde kendi borcu var', statementA.data.closingBalanceMinor === 150000);
  check('B ekstresinde A\'nın hareketi yok', statementB.data.closingBalanceMinor === 0 && statementB.data.lines.length === 0);

  const messagesB = await api<any>('/portal/messages', { as: 'b' });
  check('B yalnızca kendi mesajını görüyor', messagesB.data.total === 1 && messagesB.data.items[0].body === 'B mesajı');

  // ------------------------------------------------------- 3) duyuru
  const announcements = await api<any[]>('/portal/announcements');
  check(
    'Yalnızca yayındaki 2 duyuru, sabitlenen önce',
    announcements.data.map((a) => a.title).join(',') === 'Sabit duyuru,Normal duyuru',
    announcements.data.map((a) => a.title).join(','),
  );

  // ------------------------------------------------------- 4) talep
  const foreignUnit = await api('/portal/tickets', {
    method: 'POST',
    body: { subject: 'Komşunun dairesi', description: 'x x x', requestType: 'FAULT', unitId: ids.unit_b },
  });
  check('Başkasının dairesi için talep açılamıyor (400)', foreignUnit.status === 400);

  const created = await api<any>('/portal/tickets', {
    method: 'POST',
    body: { subject: 'Musluk damlatıyor', description: 'Banyo musluğu', requestType: 'FAULT', unitId: ids.unit_a },
  });
  check('İkamet eden kendi dairesi için talep açıyor', created.status === 201 && created.data.number === 1);
  const ticketId = created.data.id;

  const board = await api<any>('/tickets/board', { as: 'admin' });
  const card = board.data.columns[0].cards.find((c: any) => c.id === ticketId);
  check(
    'Talep personel panosuna PORTAL kanalıyla düşüyor',
    card?.channel === 'PORTAL' && card.person?.id === ids.person_a && card.unit?.id === ids.unit_a,
  );

  check('B, A\'nın talebini okuyamıyor (404)', (await api(`/portal/tickets/${ticketId}`, { as: 'b' })).status === 404);
  check(
    'B, A\'nın talebine yorum yazamıyor (404)',
    (await api(`/portal/tickets/${ticketId}/comments`, { method: 'POST', body: { body: 'sızma' }, as: 'b' })).status === 404,
  );
  check('B\'nin talep listesi boş', (await api<any[]>('/portal/tickets', { as: 'b' })).data.length === 0);

  await api(`/tickets/${ticketId}/comments`, { method: 'POST', as: 'admin', body: { body: 'Tesisatçı fiyatı yüksek', isPublic: false } });
  await api(`/tickets/${ticketId}/comments`, { method: 'POST', as: 'admin', body: { body: 'Yarın ekip gelecek', isPublic: true } });
  await api(`/portal/tickets/${ticketId}/comments`, { method: 'POST', body: { body: 'Teşekkürler' } });

  const detail = await api<any>(`/portal/tickets/${ticketId}`);
  check(
    'İkamet eden iç notu görmüyor, yalnızca herkese açık yorumları görüyor',
    detail.data.comments.map((c: any) => `${c.author}:${c.body}`).join('|') === 'Yönetim:Yarın ekip gelecek|Siz:Teşekkürler',
    JSON.stringify(detail.data.comments),
  );
  check('İkamet eden yanıtında masraf/geçmiş alanı yok', !('expenses' in detail.data) && !('history' in detail.data));

  const staffView = await api<any>(`/tickets/${ticketId}`, { as: 'admin' });
  check('İkamet edenin yorumu personel tarafında görünüyor', staffView.data.comments.some((c: any) => c.body === 'Teşekkürler'));

  check(
    'Tamamlanmamış talep puanlanamıyor (400)',
    (await api(`/portal/tickets/${ticketId}/survey`, { method: 'PUT', body: { rating: 5 } })).status === 400,
  );
  await api(`/tickets/${ticketId}/move`, { method: 'PUT', as: 'admin', body: { status: 'COMPLETED', boardOrder: 0 } });
  check(
    'B, A\'nın talebini puanlayamıyor (404)',
    (await api(`/portal/tickets/${ticketId}/survey`, { method: 'PUT', body: { rating: 1 }, as: 'b' })).status === 404,
  );
  const survey = await api<any>(`/portal/tickets/${ticketId}/survey`, { method: 'PUT', body: { rating: 5, comment: 'Hızlı' } });
  check('İkamet eden tamamlanan talebi puanlıyor', survey.status === 200 && survey.data.rating === 5);

  // ------------------------------------------------------- 5) ödeme
  const card4111 = { holder: 'SakinA Test', number: '4111 1111 1111 1111', expiry: '12/30', cvc: '123' };
  check(
    'Luhn hatalı kart reddediliyor (400)',
    (await api('/portal/payments', { method: 'POST', body: { amount: 100, card: { ...card4111, number: '4111111111111112' } } })).status === 400,
  );
  const declined = await api('/portal/payments', {
    method: 'POST',
    body: { amount: 100, card: { ...card4111, number: '4000 0000 0000 0002' } },
  });
  check('Bankanın reddettiği kart 402 dönüyor', declined.status === 402);
  check(
    'Borçtan fazla ödeme reddediliyor (400)',
    (await api('/portal/payments', { method: 'POST', body: { amount: 2000, card: card4111 } })).status === 400,
  );
  check(
    'Borcu olmayan ikamet eden ödeme yapamıyor (400)',
    (await api('/portal/payments', { method: 'POST', body: { amount: 10, card: card4111 }, as: 'b' })).status === 400,
  );

  const paid = await api<any>('/portal/payments', { method: 'POST', body: { amount: '500,00', card: card4111 } });
  check('500 TL ödeme alındı, kalan 1.000 TL', paid.status === 200 && paid.data.balanceMinor === 100000, JSON.stringify(paid.data));
  const receipt = await prisma.document.findUnique({ where: { id: paid.data.documentId } });
  check(
    'Tahsilat makbuzu kesildi, kart yalnızca son 4 hane',
    receipt?.type === 'COLLECTION' && !!receipt.description?.includes('**** 1111') && !receipt.description?.includes('4111 1111'),
  );
  const audit = await prisma.auditLog.findFirst({ where: { siteId, entityType: 'OnlinePayment' } });
  check('Denetim kaydında kart numarası yok', !!audit && !JSON.stringify(audit.after).includes('4111'));
  check('Özet bakiyesi güncellendi', (await api<any>('/portal/summary')).data.balanceMinor === 100000);

  // ------------------------------------------------ 6) portal erişimi
  const grant = await api<any>(`/people/${ids.person_c}/portal-access`, {
    method: 'POST',
    as: 'admin',
    body: { email: EMAILS.c },
  });
  check('Yöneticiye geçici parola bir kez dönüyor', grant.status === 201 && typeof grant.data.temporaryPassword === 'string');
  const cLogin = await login(EMAILS.c, grant.data.temporaryPassword);
  check(
    'Geçici parolayla giriş, rol RESIDENT',
    cLogin.status === 200 && cLogin.data.sites.find((s: any) => s.id === siteId)?.role === 'RESIDENT',
  );
  const cSummary = await api<any>('/portal/summary', { token: cLogin.data.accessToken });
  check('Yeni ikamet eden kendi özetini görüyor', cSummary.status === 200 && cSummary.data.person.fullName === 'SakinC Test');

  check(
    'Açık erişim ikinci kez verilemiyor (409)',
    (await api(`/people/${ids.person_c}/portal-access`, { method: 'POST', as: 'admin', body: { email: EMAILS.c } })).status === 409,
  );
  check(
    'Personel e-postası ikamet edene bağlanamıyor (409)',
    (await api(`/people/${ids.person_b}/portal-access`, { method: 'POST', as: 'admin', body: { email: EMAILS.admin } })).status === 409,
  );
  check(
    'İkamet eden, portal erişimi veremiyor (403)',
    (await api(`/people/${ids.person_c}/portal-access`, { method: 'POST', body: { email: 'x@test.local' } })).status === 403,
  );
  check(
    'Diğer sitenin kişisine erişim verilemiyor (404)',
    (await api(`/people/${ids.person_foreign}/portal-access`, { method: 'POST', as: 'admin', body: { email: 'yabanci@test.local' } })).status === 404,
  );

  const reset = await api<any>(`/people/${ids.person_c}/portal-access/reset-password`, { method: 'POST', as: 'admin' });
  check(
    'Parola sıfırlanınca eski parola geçersiz, yenisi geçerli',
    (await login(EMAILS.c, grant.data.temporaryPassword)).status === 401 &&
      (await login(EMAILS.c, reset.data.temporaryPassword)).status === 200,
  );

  await api(`/people/${ids.person_c}/portal-access`, { method: 'DELETE', as: 'admin' });
  const afterRevoke = await login(EMAILS.c, reset.data.temporaryPassword);
  check('Erişim kaldırılınca site listesinden düşüyor', !afterRevoke.data.sites?.some((s: any) => s.id === siteId));
  check(
    'Erişimi kaldırılan ikamet edenin eski tokenı reddediliyor (403)',
    (await api('/portal/summary', { token: cLogin.data.accessToken })).status === 403,
  );

  // --------------------------------------------- 7) parola değiştirme
  const wrong = await api('/auth/change-password', {
    method: 'POST',
    body: { currentPassword: 'Yanlis1234', newPassword: 'Yeni12345', confirmPassword: 'Yeni12345' },
  });
  check('Mevcut parola yanlışsa reddediliyor (400)', wrong.status === 400);
  const changed = await api<any>('/auth/change-password', {
    method: 'POST',
    body: { currentPassword: PASSWORD, newPassword: 'Yeni12345', confirmPassword: 'Yeni12345' },
  });
  check('Parola değişti, yeni token döndü', changed.status === 200 && !!changed.data.accessToken);
  check(
    'Yeni parolayla giriş yapılıyor, eskisiyle yapılamıyor',
    (await login(EMAILS.a, 'Yeni12345')).status === 200 && (await login(EMAILS.a)).status === 401,
  );

  // ------------------------------------------------------- temizlik
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
