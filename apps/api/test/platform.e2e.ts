/**
 * PLATFORM (SaaS) UÇTAN UCA TESTİ
 *
 *   paket → müşteri + sahip + ilk site (varsayılan tanımlar) → paket sınırları
 *   (daire, site) → modül kilidi → destek erişimi (gerekçe, süre, müşteri
 *   günlüğü) → abonelik durumları (salt okunur, askı, deneme bitişi) →
 *   paket yükseltme (yeni site, modül) → yetki
 *
 * Kendi kayıtlarını kurar ve sonunda siler; demo veriye dokunmaz.
 *
 *   pnpm --filter @sy/api run test:platform
 */
import { PrismaClient } from '@sy/db';
import * as argon2 from 'argon2';

const BASE = process.env.API_BASE ?? 'http://localhost:3101';
const PREFIX = 'TEST PLATFORM';
const EMAILS = { platform: 'platform-test@test.local', owner: 'platform-sahip@test.local', outsider: 'platform-disari@test.local' };
const PLAN_CODES = ['test-mini', 'test-genis'];
const prisma = new PrismaClient();

let passed = 0;
let failed = 0;
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

async function api<T = any>(path: string, options: { method?: string; body?: unknown; as?: string; site?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[options.as ?? 'platform']}` };
  if (options.site) headers['X-Site-Id'] = options.site;
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, data: (await response.json().catch(() => null)) as T };
}

async function login(email: string, password = 'Test1234!'): Promise<string> {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return ((await response.json()) as { accessToken: string }).accessToken;
}

async function cleanup() {
  const orgs = await prisma.organization.findMany({ where: { name: { startsWith: PREFIX } }, select: { id: true } });
  await prisma.site.deleteMany({ where: { OR: [{ organizationId: { in: orgs.map((o) => o.id) } }, { name: { startsWith: PREFIX } }] } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs.map((o) => o.id) } } });
  await prisma.plan.deleteMany({ where: { code: { in: PLAN_CODES } } });
  await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } });
}

async function main(): Promise<void> {
  console.log('Platform (SaaS) uçtan uca testi\n');
  await cleanup();
  const passwordHash = await argon2.hash('Test1234!');
  await prisma.user.create({ data: { email: EMAILS.platform, passwordHash, fullName: 'Test Platform', isSuperAdmin: true } });
  await prisma.user.create({ data: { email: EMAILS.outsider, passwordHash, fullName: 'Dışarıdan' } });
  tokens.platform = await login(EMAILS.platform);
  tokens.outsider = await login(EMAILS.outsider);

  // ------------------------------------------------------------ yetki
  check('Platform özeti süper yönetici olmayana kapalı (403)', (await api('/platform/overview', { as: 'outsider' })).status === 403);

  // ------------------------------------------------------------ paket
  const badPlan = await api('/platform/plans', { method: 'POST', body: { code: 'test-mini', name: 'X', monthlyPrice: 1, maxSites: 1, maxUnits: 1, features: ['muhasebe'] } });
  check('Bilinmeyen modül anahtarlı paket reddedildi', badPlan.status === 400);
  const mini = await api<any>('/platform/plans', {
    method: 'POST',
    body: { code: 'test-mini', name: 'Test Mini', monthlyPrice: 100, maxSites: 1, maxUnits: 2, features: ['tickets'] },
  });
  check('Paket oluşturuldu', mini.status === 201 && mini.data.monthlyPrice === 100);

  // ------------------------------------------------------------ müşteri + ilk site
  const created = await api<any>('/platform/organizations', {
    method: 'POST',
    body: {
      name: `${PREFIX} Yönetim`,
      kind: 'MANAGEMENT_COMPANY',
      planId: mini.data.id,
      trialDays: 14,
      owner: { fullName: 'Test Sahip', email: EMAILS.owner },
      firstSite: { name: `${PREFIX} Sitesi`, type: 'SITE', city: 'İzmir' },
    },
  });
  check(
    'Müşteri + sahip + ilk site oluşturuldu; geçici parola yalnızca yanıtta',
    created.status === 201 && !!created.data.owner.temporaryPassword && !!created.data.site?.id,
    JSON.stringify(created.data),
  );
  const orgId = created.data.organization.id;
  const siteId = created.data.site.id;
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  check('Deneme 14 gün', org?.status === 'TRIAL' && Math.round(((org?.trialEndsAt?.getTime() ?? 0) - Date.now()) / 86_400_000) === 14);

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: { categories: true, accounts: true, settings: true, memberships: { include: { user: true } }, departments: true },
  });
  check(
    'Yeni site boş açılmadı: parametre, kategoriler (Aidat Geliri, Gecikme Tazminatı), kasa+banka, departman',
    !!site?.settings &&
      site.categories.some((c) => c.name === 'Aidat Geliri') &&
      site.categories.some((c) => c.name === 'Gecikme Tazminatı') &&
      site.accounts.some((a) => a.type === 'CASH') &&
      site.accounts.some((a) => a.type === 'BANK') &&
      site.departments.length === 4,
  );
  check('Sahip siteye yönetici olarak eklendi', site?.memberships.some((m) => m.user.email === EMAILS.owner && m.role === 'SITE_ADMIN') === true);
  const audit = await prisma.auditLog.findFirst({ where: { entityType: 'Organization', entityId: orgId, action: 'CREATE' } });
  check('Müşteri açılışı denetimde, parola yazılmadı', !!audit && !JSON.stringify(audit.after).includes(created.data.owner.temporaryPassword));

  tokens.owner = await login(EMAILS.owner, created.data.owner.temporaryPassword);
  const me = await api<any>('/auth/me', { as: 'owner' });
  const mySite = me.data.sites.find((s: any) => s.id === siteId);
  check(
    'Oturum bilgisi abonelik durumunu taşıyor (deneme, modüller)',
    mySite?.subscription?.status === 'TRIAL' && mySite.subscription.access === 'FULL' && mySite.subscription.features.join() === 'tickets',
    JSON.stringify(mySite?.subscription),
  );

  // ------------------------------------------------------------ paket sınırları
  check('Daire 1/2', (await api('/units', { method: 'POST', as: 'owner', site: siteId, body: { doorNumber: '1' } })).status === 201);
  check('Daire 2/2', (await api('/units', { method: 'POST', as: 'owner', site: siteId, body: { doorNumber: '2' } })).status === 201);
  const third = await api<any>('/units', { method: 'POST', as: 'owner', site: siteId, body: { doorNumber: '3' } });
  check('3. daire paket sınırında reddedildi (402)', third.status === 402 && String(third.data.message).includes('daire sınırı'), `${third.status}`);
  const importPreview = await api<any>('/import/structure/preview', { method: 'POST', as: 'owner', site: siteId, body: { text: 'Daire\n5\n6' } });
  check('Toplu aktarım önizlemesi sınırı gösteriyor, aktarıma izin vermiyor', importPreview.data.canCommit === false && importPreview.data.errors[0].line === 0);
  const secondSite = await api<any>(`/organization/${orgId}/sites`, { method: 'POST', as: 'owner', body: { name: `${PREFIX} İkinci` } });
  check('Sahip ikinci siteyi açamıyor: site sınırı (402)', secondSite.status === 402);
  check('Başkası bu müşteriye site açamıyor (403)', (await api(`/organization/${orgId}/sites`, { method: 'POST', as: 'outsider', body: { name: `${PREFIX} X` } })).status === 403);
  const mine = await api<any>('/organization/mine', { as: 'owner' });
  check('Firma özeti: kullanım 1/1 site, 2/2 daire', mine.data[0]?.usage.sites.used === 1 && mine.data[0].usage.units.used === 2 && mine.data[0].usage.units.limit === 2);

  // ------------------------------------------------------------ modül kilidi
  const meters = await api<any>('/meters/distributions', { as: 'owner', site: siteId });
  check('Pakette olmayan modül kapalı (sayaç → 403)', meters.status === 403 && String(meters.data.message).includes('paketinizde yok'));
  check('Pakette olan modül açık (iş takibi)', (await api('/tickets/board', { as: 'owner', site: siteId })).status === 200);
  check('Temel finans her pakette açık', (await api('/finance/accounts', { as: 'owner', site: siteId })).status === 200);

  // ------------------------------------------------------------ destek erişimi
  const noSupport = await api<any>('/blocks', { site: siteId });
  check('Süper yönetici müşteri verisine kendiliğinden giremiyor (403)', noSupport.status === 403 && String(noSupport.data.message).includes('Destek erişimi'));
  check('Gerekçesiz destek erişimi reddedildi', (await api('/platform/support-access', { method: 'POST', body: { siteId, reason: 'kısa' } })).status === 400);
  const grant = await api<any>('/platform/support-access', { method: 'POST', body: { siteId, reason: 'Destek talebi #1234: aidat tahakkuku hatası', minutes: 30 } });
  check('Destek erişimi açıldı (30 dk)', grant.status === 201 && Math.round((new Date(grant.data.expiresAt).getTime() - Date.now()) / 60_000) === 30);
  check('Destek erişimiyle okunuyor', (await api('/blocks', { site: siteId })).status === 200);
  const meSa = await api<any>('/auth/me');
  check('Süper yöneticinin site listesinde yalnızca destek açtığı site', meSa.data.sites.length === 1 && meSa.data.sites[0].id === siteId && !!meSa.data.sites[0].supportUntil);
  const customerLog = await prisma.auditLog.findFirst({ where: { siteId, entityType: 'SupportAccess', action: 'CREATE' } });
  check('Destek erişimi müşterinin günlüğünde (gerekçesiyle)', String((customerLog?.after as any)?.reason).includes('#1234'));
  await api(`/platform/support-access/${grant.data.id}`, { method: 'DELETE' });
  check('Erişim kapatılınca tekrar 403', (await api('/blocks', { site: siteId })).status === 403);

  // ------------------------------------------------------------ abonelik durumları
  const update = (patch: Record<string, unknown>) =>
    api(`/platform/organizations/${orgId}`, {
      method: 'PUT',
      body: { name: `${PREFIX} Yönetim`, kind: 'MANAGEMENT_COMPANY', planId: mini.data.id, trialEndsAt: null, paidUntil: null, status: 'ACTIVE', ...patch },
    });
  await update({ status: 'PAST_DUE' });
  check('Ödeme gecikti: okuma açık', (await api('/blocks', { as: 'owner', site: siteId })).status === 200);
  const readOnly = await api<any>('/blocks', { method: 'POST', as: 'owner', site: siteId, body: { name: 'Z' } });
  check('Ödeme gecikti: yazma 402 (salt okunur)', readOnly.status === 402 && String(readOnly.data.message).includes('salt okunur'));
  await update({ status: 'TRIAL', trialEndsAt: new Date(Date.now() - 86_400_000).toISOString() });
  check('Deneme bitti: yazma 402', (await api('/blocks', { method: 'POST', as: 'owner', site: siteId, body: { name: 'Z' } })).status === 402);
  await update({ status: 'SUSPENDED' });
  const suspended = await api<any>('/blocks', { as: 'owner', site: siteId });
  check('Askıya alındı: okuma da kapalı (403), mesajda "site" geçmiyor', suspended.status === 403 && !/site/i.test(suspended.data.message), suspended.data.message);
  const meSuspended = await api<any>('/auth/me', { as: 'owner' });
  check('Oturum bilgisi askı durumunu gösteriyor', meSuspended.data.sites.find((s: any) => s.id === siteId)?.subscription.access === 'BLOCKED');
  await update({ status: 'ACTIVE', paidUntil: new Date(Date.now() + 30 * 86_400_000).toISOString() });
  check('Ödeme alındı: yazma açık', (await api('/blocks', { method: 'POST', as: 'owner', site: siteId, body: { name: 'Z Blok' } })).status === 201);

  // ------------------------------------------------------------ paket yükseltme
  // Her site bir müşteriye bağlı olmak zorunda (veritabanı kısıtı)
  const orphanRejected = await prisma.site
    .create({ data: { name: `${PREFIX} Sahipsiz`, settings: { create: {} } } as never })
    .then(() => false)
    .catch(() => true);
  check('Müşteriye bağlı olmayan site oluşturulamıyor', orphanRejected);
  const wide = await api<any>('/platform/plans', {
    method: 'POST',
    body: { code: 'test-genis', name: 'Test Geniş', monthlyPrice: 900, maxSites: null, maxUnits: null, features: ['tickets', 'meters'] },
  });
  await update({ status: 'ACTIVE', planId: wide.data.id });
  const upgradedSite = await api<any>(`/organization/${orgId}/sites`, { method: 'POST', as: 'owner', body: { name: `${PREFIX} İkinci` } });
  check('Paket yükseltilince sahip ikinci siteyi açtı', upgradedSite.status === 201, `${upgradedSite.status}`);
  check(
    'Sahip yeni siteye yönetici oldu',
    (await prisma.siteMembership.count({ where: { siteId: upgradedSite.data.id, role: 'SITE_ADMIN', user: { email: EMAILS.owner } } })) === 1,
  );
  check('Yükseltilen pakette sayaç açıldı', (await api('/meters/distributions', { as: 'owner', site: siteId })).status === 200);

  // ------------------------------------------------------------ özet, liste, parola
  const overview = await api<any>('/platform/overview');
  check('Özet: müşteri sayısı ve aylık gelir (ACTIVE paket fiyatı)', overview.status === 200 && overview.data.organizations.total >= 1 && overview.data.mrr >= 900);
  const list = await api<any>(`/platform/organizations?search=${encodeURIComponent(PREFIX)}`);
  check('Müşteri listesi arama + kullanım', list.data.length === 1 && list.data[0].siteCount === 2 && list.data[0].unitCount === 2);
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: EMAILS.owner } });
  const reset = await api<any>(`/platform/organizations/${orgId}/owners/${owner.id}/reset-password`, { method: 'POST' });
  check('Sahip parolası sıfırlandı, yeni parolayla giriş', reset.status === 200 && !!(await login(EMAILS.owner, reset.data.temporaryPassword)));

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
