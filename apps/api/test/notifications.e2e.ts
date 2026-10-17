/**
 * BİLDİRİM MOTORU UÇTAN UCA TESTİ
 *
 *   şablon → önizleme (hedef kitle + kişiye özel alanlar) → kampanya →
 *   kuyruk (kalıcı/geçici hata, yeniden deneme) → yeniden gönderim →
 *   zamanlama/iptal → yetki → izolasyon
 *
 * Çalışan API + Redis gerektirir (kuyruk işleyicisi API sürecinde).
 * Mock SMS: "9999" ile biten numara kalıcı, "8888" ile biten ilk denemede
 * geçici hata verir.
 *
 *   pnpm --filter @sy/api run test:notifications
 */
import { PrismaClient } from '@sy/db';
import { cleanupTestOrganizations, testOrganization } from './helpers';
import * as argon2 from 'argon2';

const BASE = process.env.API_BASE ?? 'http://localhost:3101';
const SITE_NAME = 'TEST BİLDİRİM SİTESİ';
const OTHER_SITE_NAME = 'TEST BİLDİRİM DİĞER SİTE';
const USERS = ['bildirim-admin@test.local', 'bildirim-teknik@test.local'];
const prisma = new PrismaClient();

let passed = 0;
let failed = 0;
let siteId = '';
let otherSiteId = '';
const tokens: Record<string, string> = {};
const people: Record<string, string> = {};

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
  options: { method?: string; body?: unknown; as?: string } = {},
): Promise<{ status: number; data: T }> {
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens[options.as ?? 'admin']}`,
      'X-Site-Id': siteId,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data: data as T };
}

async function login(email: string): Promise<string> {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test1234!' }),
  });
  return ((await response.json()) as { accessToken: string }).accessToken;
}

/** Kampanya tamamlanana (ya da süre dolana) kadar bekler */
async function waitFor(id: string, status = 'COMPLETED', timeoutMs = 30_000): Promise<any> {
  const until = Date.now() + timeoutMs;
  let last: any;
  while (Date.now() < until) {
    last = (await api<any>(`/notifications/campaigns/${id}`)).data;
    if (last?.status === status) return last;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return last;
}

async function cleanup() {
  await prisma.site.deleteMany({ where: { name: { in: [SITE_NAME, OTHER_SITE_NAME] } } });
  await cleanupTestOrganizations(prisma);
  await prisma.user.deleteMany({ where: { email: { in: USERS } } });
}

async function setup() {
  await cleanup();
  const site = await prisma.site.create({
    data: {
      name: SITE_NAME, organization: testOrganization(SITE_NAME),
      city: 'İzmir',
      settings: { create: { notificationFooter: 'Site Yönetimi', notificationSenderName: 'Test Yönetim' } },
    },
  });
  const other = await prisma.site.create({ data: { name: OTHER_SITE_NAME, organization: testOrganization(OTHER_SITE_NAME), city: 'Bursa', settings: { create: {} } } });
  siteId = site.id;
  otherSiteId = other.id;

  const passwordHash = await argon2.hash('Test1234!');
  const [admin, tech] = await Promise.all(
    USERS.map((email, i) => prisma.user.create({ data: { email, passwordHash, fullName: ['Bildirim Yöneticisi', 'Teknik'][i] } })),
  );
  await prisma.siteMembership.createMany({
    data: [
      { userId: admin.id, siteId, role: 'SITE_ADMIN' },
      { userId: tech.id, siteId, role: 'TECHNICIAN' },
    ],
  });

  const blockA = await prisma.block.create({ data: { siteId, name: 'A Blok' } });
  const blockB = await prisma.block.create({ data: { siteId, name: 'B Blok' } });

  const specs = [
    { key: 'borclu', block: blockA, role: 'OWNER', email: 'borclu@ornek.com', phone: '0532 111 00 01' },
    { key: 'red', block: blockB, role: 'TENANT', email: null, phone: '0532 111 99 99' },
    { key: 'gecici', block: blockA, role: 'OWNER', email: 'gecici@ornek.com', phone: '0532 111 88 88' },
    { key: 'sabit', block: blockB, role: 'OWNER', email: 'gecersiz', phone: '0212 444 55 66' },
  ] as const;

  for (const [i, spec] of specs.entries()) {
    const unit = await prisma.unit.create({ data: { siteId, blockId: spec.block.id, doorNumber: String(i + 1) } });
    const person = await prisma.person.create({
      data: { siteId, firstName: spec.key, lastName: 'Test', email: spec.email, phone: spec.phone },
    });
    people[spec.key] = person.id;
    const account = await prisma.account.create({
      data: { siteId, type: 'PERSON', name: `${spec.key} Test`, personId: person.id },
    });
    await prisma.unitOccupancy.create({
      data: { siteId, unitId: unit.id, personId: person.id, role: spec.role, startDate: new Date('2020-01-01'), bankPaymentCode: `00${i + 1}` },
    });
    if (spec.key === 'borclu') {
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
          entries: { create: { siteId, accountId: account.id, date: new Date('2026-09-01'), debit: 1500, credit: 0 } },
        },
      });
    }
  }

  // Diğer site: kişisi ve kampanyası asla görünmemeli, mesaj almamalı
  const foreign = await prisma.person.create({
    data: { siteId: otherSiteId, firstName: 'Yabancı', lastName: 'Kişi', phone: '0532 777 77 77', email: 'yabanci@ornek.com' },
  });
  people.yabanci = foreign.id;
  await prisma.notificationCampaign.create({
    data: { siteId: otherSiteId, channel: 'SMS', name: 'Gizli kampanya', body: 'gizli', audience: { group: 'ALL' } },
  });

  tokens.admin = await login(USERS[0]);
  tokens.tech = await login(USERS[1]);
}

async function main(): Promise<void> {
  console.log('Bildirim motoru uçtan uca testi\n');
  await setup();

  // ----------------------------------------------------------- 1) yetki
  check('Teknik personel bildirim modülüne erişemiyor (403)', (await api('/notifications/templates', { as: 'tech' })).status === 403);
  const meta = await api<any>('/notifications/meta');
  check('Meta: desteklenen kanallar', meta.data.channels.join(',') === 'EMAIL,SMS,WHATSAPP,VOICE');

  // ---------------------------------------------------------- 2) şablon
  const badTemplate = await api('/notifications/templates', {
    method: 'POST',
    body: { channel: 'SMS', name: 'Hatalı', body: 'Sayın {{adSoyd}}' },
  });
  check('Tanımsız birleştirme alanlı şablon reddediliyor (400)', badTemplate.status === 400);
  const template = await api<any>('/notifications/templates', {
    method: 'POST',
    body: { channel: 'SMS', name: 'Borç Hatırlatma', body: 'Sayın {{adSoyad}}, {{daireNo}} nolu daire borcu {{toplamBorc}}.' },
  });
  check('Şablon oluşturuluyor', template.status === 201);

  // -------------------------------------------------------- 3) önizleme
  const smsBody = 'Sayın {{adSoyad}}, aidat ödemenizi hatırlatırız.';
  const allSms = await api<any>('/notifications/campaigns/preview', {
    method: 'POST',
    body: { channel: 'SMS', body: smsBody, audience: { group: 'ALL' } },
  });
  check('SMS: 4 kişi eşleşti, 3 alıcı', allSms.data.matchedCount === 4 && allSms.data.recipientCount === 3, JSON.stringify(allSms.data.exclusions));
  check(
    'Sabit hat gerekçesiyle ayıklandı',
    allSms.data.exclusions.length === 1 && allSms.data.exclusions[0].reason === 'Geçerli cep telefonu yok',
  );
  check('Alıcı numarası E.164', allSms.data.samples[0].recipient === '+905321110001');
  check('Site alt bilgisi mesaja ekleniyor', allSms.data.samples[0].body.endsWith('\n\nSite Yönetimi'));
  check(
    'Türkçe karakter UCS-2 olarak raporlanıyor',
    allSms.data.sms.encoding === 'UCS2' && allSms.data.sms.nonGsmChars.includes('ı'),
  );

  const debtors = await api<any>('/notifications/campaigns/preview', {
    method: 'POST',
    body: {
      channel: 'EMAIL',
      subject: '{{siteAdi}} — {{donem}}',
      body: '{{adSoyad}} borcunuz {{borcTutari}}, son ödeme {{sonOdemeTarihi}}, kod {{odemeKodu}} {{odemeLinki}}',
      audience: { group: 'DEBTORS', onlyOverdue: true },
    },
  });
  const sample = debtors.data.samples[0];
  check('Borçlular + vadesi geçmiş: tek alıcı', debtors.data.recipientCount === 1 && sample?.recipient === 'borclu@ornek.com');
  check(
    'Kişiye özel alanlar dolduruluyor (tutar, vade, dönem, kod)',
    sample?.body.includes('1.500,00') && sample.body.includes('15.09.2026') && sample.body.includes('kod 001') &&
      sample.subject === `${SITE_NAME} — 2026 Eylül`,
    JSON.stringify(sample),
  );
  check('Ödeme linki portal ödeme sayfasını gösteriyor', sample?.body.includes('/portal/odeme'), sample?.body);

  const push = await api('/notifications/campaigns/preview', {
    method: 'POST',
    body: { channel: 'PUSH', body: 'x', audience: { group: 'ALL' } },
  });
  check('Sağlayıcısı olmayan kanal reddediliyor (400)', push.status === 400);

  const noSubject = await api('/notifications/campaigns', {
    method: 'POST',
    body: { channel: 'EMAIL', name: 'Konusuz', body: 'x', audience: { group: 'ALL' } },
  });
  check('Konusuz e-posta kampanyası reddediliyor (400)', noSubject.status === 400);

  // ------------------------------------------------ 4) gönderim + kuyruk
  const campaign = await api<any>('/notifications/campaigns', {
    method: 'POST',
    body: { channel: 'SMS', name: 'Eylül hatırlatma', templateId: template.data.id, body: smsBody, audience: { group: 'ALL' } },
  });
  check('Taslak kampanya oluşturuluyor', campaign.status === 201 && campaign.data.status === 'DRAFT');
  const id = campaign.data.id;

  const sent = await api<any>(`/notifications/campaigns/${id}/send`, { method: 'POST', body: {} });
  check('Gönderim başladı: 3 mesaj kuyrukta', sent.status === 201 && sent.data.total === 3, JSON.stringify(sent.data));

  const done = await waitFor(id);
  check('Kampanya tamamlandı', done?.status === 'COMPLETED', `(${done?.status})`);
  check(
    'Sayaçlar: 2 gönderildi, 1 başarısız',
    done?.sentCount === 2 && done?.failedCount === 1 && done?.counts?.SENT === 2 && done?.counts?.FAILED === 1,
    JSON.stringify({ sent: done?.sentCount, failed: done?.failedCount, counts: done?.counts }),
  );

  const failedPage = await api<any>(`/notifications/campaigns/${id}/messages?status=FAILED`);
  check(
    'Kalıcı hata gerekçesiyle kaydedildi',
    failedPage.data.items.length === 1 && failedPage.data.items[0].error.includes('reddedildi'),
  );
  const transient = await prisma.notificationMessage.findFirst({ where: { campaignId: id, recipient: '+905321118888' } });
  check('Geçici hata yeniden denemeyle gönderildi', transient?.status === 'SENT' && !!transient.providerMessageId);

  const history = await api<any>(`/people/${people.borclu}`);
  check('Kişi kartı iletişim geçmişinde mesaj görünüyor', history.data.messages.length === 1);

  // ------------------------------------------------- 5) yeniden deneme
  const retry = await api<any>(`/notifications/campaigns/${id}/retry`, { method: 'POST' });
  check('Başarısız mesaj yeniden kuyruğa alındı', retry.data.requeued === 1);
  const retried = await waitFor(id);
  check('Yeniden denemede kalıcı hata yine başarısız', retried?.status === 'COMPLETED' && retried.failedCount === 1 && retried.sentCount === 2);

  check('Gönderilmiş kampanya düzenlenemiyor (409)', (await api(`/notifications/campaigns/${id}`, { method: 'PUT', body: { channel: 'SMS', name: 'Değişti', body: 'x', audience: { group: 'ALL' } } })).status === 409);
  check('Gönderilmiş kampanya silinemiyor (409)', (await api(`/notifications/campaigns/${id}`, { method: 'DELETE' })).status === 409);

  // -------------------------------------------------- 6) e-posta (log)
  const email = await api<any>('/notifications/campaigns', {
    method: 'POST',
    body: { channel: 'EMAIL', name: 'Borç e-postası', subject: 'Borç', body: '{{adSoyad}} {{toplamBorc}}', audience: { group: 'DEBTORS' } },
  });
  await api(`/notifications/campaigns/${email.data.id}/send`, { method: 'POST', body: {} });
  const emailDone = await waitFor(email.data.id);
  check('E-posta kampanyası log sürücüsüyle gönderildi', emailDone?.sentCount === 1 && emailDone.failedCount === 0);

  // ----------------------------------------------- 7) zamanlama ve iptal
  const later = await api<any>('/notifications/campaigns', {
    method: 'POST',
    body: { channel: 'SMS', name: 'Yarın', body: 'Yarın su kesintisi', audience: { group: 'ALL' } },
  });
  const scheduled = await api<any>(`/notifications/campaigns/${later.data.id}/send`, {
    method: 'POST',
    body: { scheduledAt: new Date(Date.now() + 3600_000).toISOString() },
  });
  check('İleri tarihli gönderim zamanlanıyor', scheduled.data.status === 'SCHEDULED');
  const cancelled = await api<any>(`/notifications/campaigns/${later.data.id}/cancel`, { method: 'POST' });
  check('Zamanlanmış kampanya iptal ediliyor', cancelled.data.status === 'CANCELLED');
  check(
    'İptal edilen zamanlanmış kampanya mesaj üretmedi',
    (await prisma.notificationMessage.count({ where: { campaignId: later.data.id } })) === 0,
  );

  const draft = await api<any>('/notifications/campaigns', {
    method: 'POST',
    body: { channel: 'SMS', name: 'Silinecek', body: 'x', audience: { group: 'ALL' } },
  });
  check('Taslak kampanya silinebiliyor', (await api(`/notifications/campaigns/${draft.data.id}`, { method: 'DELETE' })).status === 200);

  // ----------------------------------------------------- 8) izolasyon
  const foreign = await prisma.notificationCampaign.findFirstOrThrow({ where: { siteId: otherSiteId } });
  check('Diğer sitenin kampanyası okunamıyor (404)', (await api(`/notifications/campaigns/${foreign.id}`)).status === 404);
  check(
    'Diğer sitenin kampanyası gönderilemiyor (404)',
    (await api(`/notifications/campaigns/${foreign.id}/send`, { method: 'POST', body: {} })).status === 404,
  );
  const list = await api<any>('/notifications/campaigns');
  check('Kampanya listesinde diğer site yok', list.data.items.every((c: any) => c.name !== 'Gizli kampanya'));

  const custom = await api<any>('/notifications/campaigns/preview', {
    method: 'POST',
    body: { channel: 'SMS', body: 'x', audience: { group: 'CUSTOM', personIds: [people.yabanci, people.borclu] } },
  });
  check('Özel listeye eklenen diğer site kişisi hedeflenmiyor', custom.data.recipientCount === 1 && custom.data.matchedCount === 1);
  check(
    'Diğer sitenin kişisine hiç mesaj gitmedi',
    (await prisma.notificationMessage.count({ where: { recipient: '+905327777777' } })) === 0,
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
