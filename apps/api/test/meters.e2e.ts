/**
 * SAYAÇ PAYLAŞIMI UÇTAN UCA TESTİ
 *
 *   taslak → ana sayaç → daire okumaları → önizleme → onay (evrak + cari) →
 *   sonraki dönem önerileri → onayı geri alma → yetki → izolasyon
 *
 * Kendi izole test sitelerini kurar ve sonunda siler; demo veriye dokunmaz.
 *
 *   pnpm --filter @sy/api run test:meters
 */
import { PrismaClient } from '@sy/db';
import * as argon2 from 'argon2';

const BASE = process.env.API_BASE ?? 'http://localhost:3101';
const SITE_NAME = 'TEST SAYAÇ SİTESİ';
const OTHER_SITE_NAME = 'TEST SAYAÇ DİĞER SİTE';
const USERS = ['sayac-admin@test.local', 'sayac-teknik@test.local'];
const prisma = new PrismaClient();

let passed = 0;
let failed = 0;
let siteId = '';
let otherSiteId = '';
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

async function cleanup() {
  await prisma.site.deleteMany({ where: { name: { in: [SITE_NAME, OTHER_SITE_NAME] } } });
  await prisma.user.deleteMany({ where: { email: { in: USERS } } });
}

/** Sitedeki kişi carilerinin işlenmiş (iptal edilmemiş) borç toplamı */
async function postedDebt(): Promise<number> {
  const result = await prisma.ledgerEntry.aggregate({
    where: { siteId, document: { type: 'METER_DISTRIBUTION', status: 'POSTED' } },
    _sum: { debit: true },
  });
  return Math.round(Number(result._sum.debit ?? 0) * 100);
}

const units: { id: string; door: string }[] = [];

async function setup() {
  await cleanup();

  const site = await prisma.site.create({
    data: { name: SITE_NAME, city: 'Ankara', settings: { create: { duesLiabilityRule: 'OCCUPANT' } } },
  });
  const other = await prisma.site.create({
    data: { name: OTHER_SITE_NAME, city: 'Konya', settings: { create: {} } },
  });
  siteId = site.id;
  otherSiteId = other.id;

  const passwordHash = await argon2.hash('Test1234!');
  const [admin, tech] = await Promise.all(
    USERS.map((email, i) =>
      prisma.user.create({ data: { email, passwordHash, fullName: ['Sayaç Yöneticisi', 'Sayaç Okuyucu'][i] } }),
    ),
  );
  await prisma.siteMembership.createMany({
    data: [
      { userId: admin.id, siteId, role: 'SITE_ADMIN' },
      { userId: tech.id, siteId, role: 'TECHNICIAN' },
    ],
  });

  const block = await prisma.block.create({ data: { siteId, name: 'A Blok' } });
  for (const [i, area] of [100, 100, 200].entries()) {
    const unit = await prisma.unit.create({
      data: { siteId, blockId: block.id, doorNumber: String(i + 1), area },
    });
    units.push({ id: unit.id, door: String(i + 1) });
    const owner = await prisma.person.create({ data: { siteId, firstName: `Malik${i + 1}`, lastName: 'Test' } });
    await prisma.account.create({ data: { siteId, type: 'PERSON', name: `Malik${i + 1} Test`, personId: owner.id } });
    await prisma.unitOccupancy.create({
      data: { siteId, unitId: unit.id, personId: owner.id, role: 'OWNER', startDate: new Date('2020-01-01') },
    });
  }
  // 3 numarada kiracı var → OCCUPANT kuralında borç kiracıya yazılır
  const tenant = await prisma.person.create({ data: { siteId, firstName: 'Kiracı', lastName: 'Test' } });
  await prisma.account.create({ data: { siteId, type: 'PERSON', name: 'Kiracı Test', personId: tenant.id } });
  await prisma.unitOccupancy.create({
    data: { siteId, unitId: units[2].id, personId: tenant.id, role: 'TENANT', startDate: new Date('2024-01-01') },
  });
  await prisma.category.create({ data: { siteId, kind: 'INCOME', name: 'Isınma ve Su Payı' } });

  // Diğer sitenin daire ve dağıtımı — asla erişilememeli
  const foreignUnit = await prisma.unit.create({ data: { siteId: otherSiteId, doorNumber: '99' } });
  await prisma.meterDistribution.create({
    data: {
      siteId: otherSiteId,
      period: '2026-09',
      documentDate: new Date('2026-10-01'),
      dueDate: new Date('2026-10-15'),
      unitReadings: { create: { unitId: foreignUnit.id, type: 'COLD_WATER', currentValue: 7 } },
    },
  });

  tokens.admin = await login(USERS[0]);
  tokens.tech = await login(USERS[1]);
}

const september = {
  period: '2026-09',
  documentDate: '2026-10-01',
  dueDate: '2026-10-20',
  name: 'Eylül 2026 sayaç paylaşımı',
  waterPricingMethod: 'UNIT_PRICE',
  waterUnitPrice: '50',
  fixedSharePercent: 30,
};

async function main(): Promise<void> {
  console.log('Sayaç paylaşımı uçtan uca testi\n');
  await setup();

  const category = await prisma.category.findFirstOrThrow({ where: { siteId } });

  // ------------------------------------------------------- 1) taslak
  const techCreate = await api('/meters/distributions', { method: 'POST', body: september, as: 'tech' });
  check('Teknik personel dağıtım oluşturamıyor (403)', techCreate.status === 403);

  const created = await api<any>('/meters/distributions', {
    method: 'POST',
    body: { ...september, categoryId: category.id },
  });
  check('Taslak dağıtım oluşturuluyor', created.status === 201 && !!created.data.id);
  const sepId = created.data.id;

  const duplicate = await api('/meters/distributions', { method: 'POST', body: september });
  check('Aynı döneme ikinci dağıtım açılamıyor (409)', duplicate.status === 409);

  // ----------------------------------------------- 2) ana sayaçlar
  const main = await api(`/meters/distributions/${sepId}/main-readings`, {
    method: 'PUT',
    body: {
      readings: [
        { type: 'COLD_WATER', previousValue: 0, currentValue: '100' },
        { type: 'FUEL', previousValue: 0, currentValue: '1.000', invoiceAmount: '10.000,00' },
        { type: 'ELECTRIC', skip: true },
      ],
    },
  });
  check('Ana sayaç okumaları kaydediliyor', main.status === 200);

  const backwards = await api(`/meters/distributions/${sepId}/main-readings`, {
    method: 'PUT',
    body: { readings: [{ type: 'COLD_WATER', previousValue: 50, currentValue: 10 }] },
  });
  check('Geri giden ana sayaç reddediliyor (400)', backwards.status === 400);

  // ----------------------------------------------- 3) daire okumaları
  const cold = await api<any>(`/meters/distributions/${sepId}/unit-readings`, {
    method: 'PUT',
    as: 'tech',
    body: {
      type: 'COLD_WATER',
      readings: [
        { unitId: units[0].id, currentValue: 20 },
        { unitId: units[1].id, currentValue: '30' },
        { unitId: units[2].id, currentValue: '50,0' },
      ],
    },
  });
  check('Teknik personel daire okuması girebiliyor', cold.status === 200 && cold.data.saved === 3);

  await api(`/meters/distributions/${sepId}/unit-readings`, {
    method: 'PUT',
    body: {
      type: 'FUEL',
      readings: [
        { unitId: units[0].id, currentValue: 10 },
        { unitId: units[1].id, currentValue: 10 },
        { unitId: units[2].id, currentValue: 99 },
      ],
    },
  });
  const removeReading = await api<any>(`/meters/distributions/${sepId}/unit-readings`, {
    method: 'PUT',
    body: { type: 'FUEL', readings: [{ unitId: units[2].id, currentValue: null }] },
  });
  check('Boş okuma gönderilince kayıt siliniyor', removeReading.data.removed === 1);

  // ----------------------------------------------------- 4) önizleme
  const preview = await api<any>(`/meters/distributions/${sepId}/preview`);
  check(
    'Önizleme toplamı: 100 m³ × 50 TL + 10.000 TL yakıt = 15.000 TL',
    preview.data.totalMinor === 1500000,
    `(${preview.data.totalMinor})`,
  );
  check('Soğuk su tüketim oranında: 1.000 / 1.500 / 2.500 TL', (() => {
    const cold = (i: number) =>
      preview.data.rows[i].lines.find((l: any) => l.type === 'COLD_WATER')?.amountMinor;
    return cold(0) === 100000 && cold(1) === 150000 && cold(2) === 250000;
  })());
  check(
    'Okuması olmayan daire için etiketli uyarı',
    preview.data.warnings.some((w: string) => w.startsWith('A Blok / 3 dairesinde Yakıt okuması yok')),
    JSON.stringify(preview.data.warnings),
  );
  check(
    'Yakıt sabit pay satırı ayrı gösteriliyor',
    preview.data.rows[0].lines.some((l: any) => l.label === 'Yakıt — sabit pay'),
  );
  check(
    'OCCUPANT kuralında 3 numaranın borcu kiracıya',
    preview.data.rows[2].liability === 'TENANT' && preview.data.rows[2].personName === 'Kiracı Test',
  );
  check('Önizleme onay engeli içermiyor', preview.data.blockers.length === 0);

  // --------------------------------------------------------- 5) onay
  const techApprove = await api(`/meters/distributions/${sepId}/approve`, { method: 'POST', as: 'tech' });
  check('Teknik personel onaylayamıyor (403)', techApprove.status === 403);

  const approved = await api<any>(`/meters/distributions/${sepId}/approve`, { method: 'POST' });
  check('Onay 3 evrak üretiyor', approved.status === 201 && approved.data.documentCount === 3);
  check('Carilere toplam 15.000 TL borç yazıldı', (await postedDebt()) === 1500000);

  const documents = await prisma.document.findMany({
    where: { siteId, meterDistributionId: sepId },
    include: { entries: true },
  });
  check(
    'Evrak hareketleri gelir kategorisine bağlı',
    documents.every((d) => d.entries.every((e) => e.categoryId === category.id)),
  );

  const afterApprove = await api<any>(`/meters/distributions/${sepId}`);
  check(
    'Okuma satırlarına dağıtım tutarı işlendi',
    afterApprove.data.readings.COLD_WATER[units[2].id].amountMinor === 250000,
  );

  const editApproved = await api(`/meters/distributions/${sepId}/unit-readings`, {
    method: 'PUT',
    body: { type: 'COLD_WATER', readings: [{ unitId: units[0].id, currentValue: 1 }] },
  });
  check('Onaylı dağıtımın okuması değiştirilemiyor (409)', editApproved.status === 409);

  const deleteApproved = await api(`/meters/distributions/${sepId}`, { method: 'DELETE' });
  check('Onaylı dağıtım silinemiyor (409)', deleteApproved.status === 409);

  // ---------------------------------------- 6) sonraki dönem önerileri
  const october = await api<any>('/meters/distributions', {
    method: 'POST',
    body: { ...september, period: '2026-10', documentDate: '2026-11-01', dueDate: '2026-11-20' },
  });
  const octId = october.data.id;
  const octDetail = await api<any>(`/meters/distributions/${octId}`);
  check(
    'Ana sayaç önceki okuması bir önceki dönemden geliyor (100)',
    octDetail.data.mainReadings.find((m: any) => m.type === 'COLD_WATER').previousValue === 100,
  );
  check(
    'Daire önceki okuma önerisi bir önceki dönemden geliyor (50)',
    octDetail.data.suggestions.COLD_WATER?.[units[2].id] === 50 && octDetail.data.suggestedFrom === '2026-09',
  );

  await api(`/meters/distributions/${octId}/unit-readings`, {
    method: 'PUT',
    body: { type: 'COLD_WATER', readings: [{ unitId: units[2].id, currentValue: 62 }] },
  });
  const octReadings = await api<any>(`/meters/distributions/${octId}`);
  const reading = octReadings.data.readings.COLD_WATER[units[2].id];
  check(
    'Önceki okuma boşsa öneri kullanılıyor, tüketim 12',
    reading.previousValue === 50 && reading.consumption === 12,
  );

  // ------------------------------------------------- 7) onayı geri al
  await api(`/meters/distributions/${octId}/main-readings`, {
    method: 'PUT',
    body: { readings: [{ type: 'COLD_WATER', previousValue: 100, currentValue: 112 }] },
  });
  const octApprove = await api<any>(`/meters/distributions/${octId}/approve`, { method: 'POST' });
  check('Ekim dağıtımı onaylanıyor', octApprove.status === 201, JSON.stringify(octApprove.data));

  const blockedRevert = await api(`/meters/distributions/${sepId}/revert`, { method: 'POST' });
  check('Sonraki dönem onaylıyken önceki geri alınamıyor (409)', blockedRevert.status === 409);

  await api(`/meters/distributions/${octId}/revert`, { method: 'POST' });
  const revert = await api<any>(`/meters/distributions/${sepId}/revert`, { method: 'POST' });
  check('Eylül onayı geri alınıyor, 3 evrak iptal', revert.status === 201 && revert.data.cancelled === 3);
  check('Geri alma sonrası carilerde sayaç borcu kalmadı', (await postedDebt()) === 0);

  const reverted = await api<any>(`/meters/distributions/${sepId}`);
  check('Dağıtım taslağa döndü ve düzenlenebilir', reverted.data.status === 'DRAFT');

  const deleteDraft = await api(`/meters/distributions/${octId}`, { method: 'DELETE' });
  check('Taslak dağıtım silinebiliyor', deleteDraft.status === 200);

  // ------------------------------------------- 8) gecikme tazminatı ayarı
  // Site genelinde tazminat açık (varsayılan %5/ay); dağıtımdaki ayar belirleyici
  const meterFeeRows = async () =>
    (await api<any>('/finance/late-fees/preview?asOf=2026-12-20')).data.rows.filter((r: any) =>
      r.documentNumber.startsWith('SAY'),
    );

  await api(`/meters/distributions/${sepId}/approve`, { method: 'POST' });
  check('"Tazminat uygula" kapalı dağıtımın borcuna tazminat işlenmiyor', (await meterFeeRows()).length === 0);

  await api(`/meters/distributions/${sepId}/revert`, { method: 'POST' });
  await api(`/meters/distributions/${sepId}`, {
    method: 'PUT',
    body: { ...september, applyLateFee: true, lateFeeStartDate: '2026-11-25' },
  });
  await api(`/meters/distributions/${sepId}/approve`, { method: 'POST' });
  const feeRows = await meterFeeRows();
  check(
    'Tazminat açıkken başlama tarihinden sayılıyor (25.11 → 20.12: 1 ay)',
    feeRows.length === 3 && feeRows.every((r: any) => r.overdueMonths === 1),
    JSON.stringify(feeRows.map((r: any) => [r.overdueDays, r.overdueMonths])),
  );
  // İzolasyon kontrolleri taslak üzerinde yapılsın (onaylıda istek 409 ile erken döner)
  await api(`/meters/distributions/${sepId}/revert`, { method: 'POST' });

  // ---------------------------------------------------- 9) izolasyon
  const foreign = await prisma.meterDistribution.findFirstOrThrow({ where: { siteId: otherSiteId } });
  const foreignUnit = await prisma.unit.findFirstOrThrow({ where: { siteId: otherSiteId } });

  check('Diğer sitenin dağıtımı listede yok', (await api<any[]>('/meters/distributions')).data.length === 1);
  check(
    'Diğer sitenin dağıtımı okunamıyor (404)',
    (await api(`/meters/distributions/${foreign.id}`)).status === 404,
  );
  check(
    'Diğer sitenin önizlemesi alınamıyor (404)',
    (await api(`/meters/distributions/${foreign.id}/preview`)).status === 404,
  );

  const writeForeign = await api(`/meters/distributions/${foreign.id}/unit-readings`, {
    method: 'PUT',
    body: { type: 'COLD_WATER', readings: [{ unitId: foreignUnit.id, currentValue: 999 }] },
  });
  check('Diğer sitenin dağıtımına okuma yazılamıyor (404)', writeForeign.status === 404);

  const foreignUnitInOwn = await api(`/meters/distributions/${sepId}/unit-readings`, {
    method: 'PUT',
    body: { type: 'COLD_WATER', readings: [{ unitId: foreignUnit.id, currentValue: 5 }] },
  });
  check('Kendi dağıtımına diğer sitenin dairesi eklenemiyor (400)', foreignUnitInOwn.status === 400);

  const untouched = await prisma.unitMeterReading.findFirstOrThrow({ where: { distributionId: foreign.id } });
  check('Diğer sitenin okuması değişmedi', Number(untouched.currentValue) === 7);

  // ----------------------------------------------------- temizlik
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
