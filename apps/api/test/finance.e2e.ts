/**
 * FİNANS DÖNGÜSÜ UÇTAN UCA TESTİ
 *
 *   tahakkuk → bakiye → tahsilat → kapanma → gecikme tazminatı →
 *   banka ekstresi → otomatik eşleştirme → gösterge
 *
 * Kendi izole test sitesini kurar ve sonunda siler; demo veriye dokunmaz.
 *
 *   pnpm --filter @sy/api run test:finance
 */
import { PrismaClient } from '@sy/db';
import { cleanupTestOrganizations, testOrganization } from './helpers';
import * as argon2 from 'argon2';

const BASE = process.env.API_BASE ?? 'http://localhost:3101';
const SITE_NAME = 'TEST FİNANS SİTESİ';
const prisma = new PrismaClient();

let passed = 0;
let failed = 0;
let token = '';
let siteId = '';

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
  options: { method?: string; body?: unknown } = {},
): Promise<{ status: number; data: T }> {
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-Site-Id': siteId,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data: data as T };
}

/** TL cinsinden okunabilir çıktı */
const tl = (minor: number) => (minor / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 });

async function setup() {
  const existing = await prisma.site.findFirst({ where: { name: SITE_NAME } });
  if (existing) await prisma.site.delete({ where: { id: existing.id } });
  await cleanupTestOrganizations(prisma);

  const site = await prisma.site.create({
    data: {
      name: SITE_NAME, organization: testOrganization(SITE_NAME),
      city: 'İstanbul',
      settings: {
        create: {
          duesDistributionMethod: 'EQUAL',
          duesLiabilityRule: 'OCCUPANT',
          dueDayOfMonth: 15,
          lateFeeMethod: 'MONTHLY_PERCENT',
          lateFeeRate: 5,
          applyLateFee: true,
          autoMatchBankTransactions: true,
          requireMobilePhone: false,
        },
      },
    },
  });
  siteId = site.id;

  const admin = await prisma.user.upsert({
    where: { email: 'finans@test.local' },
    update: { passwordHash: await argon2.hash('Test1234!'), isActive: true },
    create: {
      email: 'finans@test.local',
      passwordHash: await argon2.hash('Test1234!'),
      fullName: 'Finans Testçisi',
    },
  });
  await prisma.siteMembership.deleteMany({ where: { userId: admin.id } });
  await prisma.siteMembership.create({
    data: { userId: admin.id, siteId, role: 'SITE_ADMIN' },
  });

  const block = await prisma.block.create({ data: { siteId, name: 'A Blok' } });

  // 3 daire, 3 malik, ödeme kodları
  for (const [i, code] of ['0001', '0002', '0003'].entries()) {
    const unit = await prisma.unit.create({
      data: { siteId, blockId: block.id, doorNumber: String(i + 1), area: 100, shareRatio: 1 },
    });
    const person = await prisma.person.create({
      data: { siteId, firstName: `Test${i + 1}`, lastName: 'Kullanıcı' },
    });
    await prisma.account.create({
      data: { siteId, type: 'PERSON', name: `Test${i + 1} Kullanıcı`, personId: person.id },
    });
    await prisma.unitOccupancy.create({
      data: {
        siteId,
        unitId: unit.id,
        personId: person.id,
        role: 'OWNER',
        startDate: new Date('2020-01-01'),
        bankPaymentCode: code,
      },
    });
  }

  await prisma.account.create({
    data: { siteId, type: 'CASH', name: 'Test Kasa' },
  });
  await prisma.account.create({
    data: { siteId, type: 'BANK', name: 'Test Banka' },
  });
  await prisma.account.create({
    data: { siteId, type: 'SUPPLIER', name: 'Test Asansör Ltd.' },
  });
  await prisma.category.createMany({
    data: [
      { siteId, kind: 'INCOME', name: 'Aidat Geliri' },
      { siteId, kind: 'INCOME', name: 'Gecikme Tazminatı' },
      { siteId, kind: 'EXPENSE', name: 'Asansör Bakım' },
    ],
  });
  await prisma.duesItem.create({
    data: { siteId, name: 'Aidat', defaultAmount: 1500, distributionMethod: 'EQUAL' },
  });

  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'finans@test.local', password: 'Test1234!' }),
  });
  const loginData = (await login.json()) as { accessToken: string };
  token = loginData.accessToken;
}

async function main(): Promise<void> {
  console.log('Finans döngüsü uçtan uca testi\n');
  await setup();

  // ------------------------------------------------------- 1) aidat tahakkuku
  const items = await api<{ id: string; name: string }[]>('/finance/dues/items');
  const duesItemId = items.data[0]?.id;
  check('Aidat kalemi listeleniyor', !!duesItemId);

  const runPayload = {
    period: '2026-09',
    issueDate: '2026-09-01',
    dueDate: '2026-09-15',
    description: 'Eylül dönemi aidat',
    lines: [{ duesItemId, amount: 1500, mode: 'PER_UNIT' }],
  };

  const preview = await api<{ totalMinor: number; unitCount: number; rows: any[] }>(
    '/finance/dues/preview',
    { method: 'POST', body: runPayload },
  );
  check(
    'Önizleme 3 daireye 1.500 TL yazıyor',
    preview.data.unitCount === 3 && preview.data.totalMinor === 450000,
    `(daire: ${preview.data.unitCount}, toplam: ${tl(preview.data.totalMinor)})`,
  );
  check(
    'Önizleme borcu malike yazıyor',
    preview.data.rows.every((r: any) => r.liability === 'OWNER' && r.personId),
  );

  const generated = await api<{ documentCount: number; totalMinor: number }>(
    '/finance/dues/generate',
    { method: 'POST', body: runPayload },
  );
  check(
    'Tahakkuk oluşturuldu (3 evrak)',
    generated.status === 201 && generated.data.documentCount === 3,
    `(${generated.status} ${JSON.stringify(generated.data)})`,
  );

  const duplicate = await api('/finance/dues/generate', { method: 'POST', body: runPayload });
  check('Aynı dönem ikinci kez tahakkuk edilemiyor', duplicate.status === 400);

  // --------------------------------------------------------------- 2) bakiye
  const accounts = await api<{ items: any[] }>('/finance/accounts?pageSize=50&type=PERSON');
  const debtor = accounts.data.items.find((a) => a.balanceMinor === 150000);
  check(
    'Kişi carisinde 1.500 TL borç görünüyor',
    !!debtor,
    `(bakiyeler: ${accounts.data.items.map((a) => tl(a.balanceMinor)).join(', ')})`,
  );

  const openItems = await api<{ items: any[]; totalMinor: number }>(
    `/finance/accounts/${debtor.id}/open-items`,
  );
  check(
    'Açık kalem olarak 1 adet tahakkuk var',
    openItems.data.items.length === 1 && openItems.data.totalMinor === 150000,
  );

  // ------------------------------------------------------------- 3) tahsilat
  const cashAccounts = await api<{ items: any[] }>('/finance/accounts?type=CASH');
  const cashId = cashAccounts.data.items[0].id;

  const partial = await api('/finance/collections', {
    method: 'POST',
    body: { accountId: debtor.id, cashAccountId: cashId, amount: 500, date: '2026-09-20' },
  });
  check('Kısmi tahsilat kaydedildi', partial.status === 201);

  const afterPartial = await api<{ items: any[]; totalMinor: number }>(
    `/finance/accounts/${debtor.id}/open-items`,
  );
  check(
    'Kısmi tahsilat sonrası kalan 1.000 TL',
    afterPartial.data.totalMinor === 100000,
    `(kalan: ${tl(afterPartial.data.totalMinor)})`,
  );

  await api('/finance/collections', {
    method: 'POST',
    body: { accountId: debtor.id, cashAccountId: cashId, amount: 1000, date: '2026-09-21' },
  });
  const afterFull = await api<{ items: any[]; advanceMinor: number }>(
    `/finance/accounts/${debtor.id}/open-items`,
  );
  check('Tam tahsilat sonrası açık kalem kalmadı', afterFull.data.items.length === 0);

  // Fazla ödeme avansa düşmeli
  await api('/finance/collections', {
    method: 'POST',
    body: { accountId: debtor.id, cashAccountId: cashId, amount: 250, date: '2026-09-22' },
  });
  const withAdvance = await api<{ advanceMinor: number }>(
    `/finance/accounts/${debtor.id}/open-items`,
  );
  check(
    'Fazla ödeme 250 TL avans olarak duruyor',
    withAdvance.data.advanceMinor === 25000,
    `(avans: ${tl(withAdvance.data.advanceMinor)})`,
  );

  // Kasa bakiyesi = 500 + 1000 + 250
  const cashAfter = await api<{ items: any[] }>('/finance/accounts?type=CASH');
  check(
    'Kasa bakiyesi 1.750 TL',
    cashAfter.data.items[0].balanceMinor === 175000,
    `(kasa: ${tl(cashAfter.data.items[0].balanceMinor)})`,
  );

  // ------------------------------------------------- 4) gecikme tazminatı
  const lateFee = await api<{ rows: any[]; totalMinor: number }>(
    '/finance/late-fees/preview?asOf=2026-10-20',
  );
  // Ödemeyen 2 daire × 1500 × %5 × 2 ay (15 Eylül → 20 Ekim = 35 gün ⇒ 2 ay)
  check(
    'Gecikme tazminatı ödemeyen 2 daire için hesaplandı',
    lateFee.data.rows.length === 2,
    `(satır: ${lateFee.data.rows.length})`,
  );
  check(
    'Tazminat tutarı doğru (2 × 150 TL)',
    lateFee.data.totalMinor === 30000,
    `(toplam: ${tl(lateFee.data.totalMinor)})`,
  );

  const applied = await api<{ created: number }>('/finance/late-fees/apply', {
    method: 'POST',
    body: { asOf: '2026-10-20' },
  });
  check('Tazminatlar işlendi', applied.data.created === 2);

  const reapplied = await api<{ created: number }>('/finance/late-fees/apply', {
    method: 'POST',
    body: { asOf: '2026-10-20' },
  });
  check('Aynı dönemde tazminat iki kez işlenmiyor', reapplied.data.created === 0);

  // ------------------------------------------------------------ 5) banka
  const bankAccounts = await api<{ items: any[] }>('/finance/accounts?type=BANK');
  const bankId = bankAccounts.data.items[0].id;

  const imported = await api<{ imported: number; autoMatched: number; pending: number }>(
    '/finance/bank/import',
    {
      method: 'POST',
      body: {
        bankAccountId: bankId,
        rows: [
          { date: '2026-10-05', amount: 1500, description: 'EFT 0002 AIDAT ODEMESI' },
          { date: '2026-10-06', amount: 1500, description: 'HAVALE ACIKLAMASI BULUNMAYAN' },
        ],
      },
    },
  );
  check('2 banka hareketi yüklendi', imported.data.imported === 2);
  check(
    'Ödeme kodu geçen hareket otomatik eşleşti',
    imported.data.autoMatched === 1,
    `(eşleşen: ${imported.data.autoMatched})`,
  );
  check('Eşleşmeyen hareket bekliyor', imported.data.pending === 1);

  const reimport = await api<{ duplicates: number }>('/finance/bank/import', {
    method: 'POST',
    body: {
      bankAccountId: bankId,
      rows: [{ date: '2026-10-05', amount: 1500, description: 'EFT 0002 AIDAT ODEMESI' }],
    },
  });
  check('Aynı ekstre tekrar yüklenince satır kopyalanmıyor', reimport.data.duplicates === 1);

  const pending = await api<any[]>('/finance/bank/pending');
  check('Bekleyen hareket listeleniyor', pending.data.length === 1);

  const remainingDebtor = accounts.data.items.find(
    (a) => a.id !== debtor.id && a.balanceMinor === 150000,
  );
  const manual = await api(`/finance/bank/${pending.data[0].id}/match`, {
    method: 'POST',
    body: { accountId: remainingDebtor.id },
  });
  check('Elle eşleştirme tahsilat üretti', manual.status === 201);

  // ---------------------------------------------------------- 6) gider
  const suppliers = await api<{ items: any[] }>('/finance/accounts?type=SUPPLIER');
  const categories = await api<any[]>('/finance/categories?kind=EXPENSE');
  const expense = await api('/finance/expenses', {
    method: 'POST',
    body: {
      accountId: suppliers.data.items[0].id,
      categoryId: categories.data[0].id,
      amount: '8.400,00',
      date: '2026-10-01',
      dueDate: '2026-10-12',
      description: 'Asansör bakım faturası',
    },
  });
  check('Gider faturası kaydedildi (TR biçimli tutar)', expense.status === 201);

  // ------------------------------------------------------- 7) gösterge
  const dashboard = await api<any>('/finance/dashboard?from=2026-01-01&to=2026-12-31');
  const september = dashboard.data.collection.find((c: any) => c.period === '2026-09');
  check(
    'Panoda Eylül tahakkuku 4.500 TL',
    september?.accruedMinor === 450000,
    `(${tl(september?.accruedMinor ?? 0)})`,
  );
  check(
    'Panoda Eylül tahsilatı 3.000 TL (1.500 + 1.500)',
    september?.collectedMinor === 300000,
    `(${tl(september?.collectedMinor ?? 0)})`,
  );
  check(
    'Ödenecek fatura listesinde 8.400 TL var',
    dashboard.data.payables.totalMinor === 840000,
    `(${tl(dashboard.data.payables.totalMinor)})`,
  );
  check(
    'Gider dağılımında asansör bakım görünüyor',
    dashboard.data.distribution.expenseTotalMinor === 840000,
  );
  check('Kasa + banka pozisyonu raporlanıyor', dashboard.data.cash.items.length === 2);

  // ----------------------------------------------------------- 8) ekstre
  const statement = await api<any>(
    `/finance/accounts/${debtor.id}/statement?from=2026-01-01&to=2026-12-31`,
  );
  check('Ekstre hareketleri listeliyor', statement.data.lines.length >= 4);
  check(
    'Ekstre kapanış bakiyesi −250 TL (avans)',
    statement.data.closingBalanceMinor === -25000,
    `(${tl(statement.data.closingBalanceMinor)})`,
  );

  // --------------------------------------------------------------- temizlik
  await prisma.site.delete({ where: { id: siteId } });
  await cleanupTestOrganizations(prisma);
  await prisma.user.deleteMany({ where: { email: 'finans@test.local' } });

  console.log(`\n${passed} başarılı, ${failed} başarısız`);
  if (failed > 0) process.exit(1);
}

main()
  .catch(async (error) => {
    console.error('Test hatası:', error);
    if (siteId) await prisma.site.delete({ where: { id: siteId } }).catch(() => undefined);
    await cleanupTestOrganizations(prisma);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
