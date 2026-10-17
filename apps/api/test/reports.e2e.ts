/**
 * RAPORLAR UÇTAN UCA TESTİ
 *
 *   cari ekstre (KVKK maskesi, eşik filtreleri) → PDF + denetim kaydı →
 *   borç yaşlandırma → ödeme skoru (hesap, segment, kıyas gizliliği) →
 *   tahsilat kanalı → sakinin kendi PDF'i → yetki → izolasyon
 *
 * Kendi izole test sitelerini kurar ve sonunda siler; demo veriye dokunmaz.
 *
 *   pnpm --filter @sy/api run test:reports
 */
import { PrismaClient, type PaymentChannel } from '@sy/db';
import * as argon2 from 'argon2';

const BASE = process.env.API_BASE ?? 'http://localhost:3101';
const SITE_NAME = 'TEST RAPOR SİTESİ';
const OTHER_SITE_NAME = 'TEST RAPOR DİĞER SİTE';
/** Benzersiz şehir: kıyasta yalnızca bu site olsun */
const CITY = 'Testkent Rapor';
const EMAILS = {
  admin: 'rapor-admin@test.local',
  accountant: 'rapor-muhasebe@test.local',
  tech: 'rapor-teknik@test.local',
  resident: 'rapor-sakin@test.local',
};
const prisma = new PrismaClient();

let passed = 0;
let failed = 0;
let siteId = '';
let otherSiteId = '';
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
let docSeq = 1;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

async function raw(path: string, options: { method?: string; body?: unknown; as?: string } = {}) {
  return fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens[options.as ?? 'admin']}`,
      'X-Site-Id': siteId,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

async function api<T = any>(path: string, options: { method?: string; body?: unknown; as?: string } = {}) {
  const response = await raw(path, options);
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

/** Ay başı tahakkuk (vade ayın 15'i) */
async function accrue(accountId: string, month: Date, amount = 1000, type: 'DUES_ACCRUAL' | 'LATE_FEE' = 'DUES_ACCRUAL') {
  const date = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const dueDate = new Date(month.getFullYear(), month.getMonth(), 15, 12);
  await prisma.document.create({
    data: {
      siteId,
      type,
      status: 'POSTED',
      number: `T-${docSeq++}`,
      date,
      dueDate,
      period: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`,
      totalAmount: amount,
      entries: { create: { siteId, accountId, date, debit: amount, credit: 0 } },
    },
  });
}

async function collect(accountId: string, cashId: string, date: Date, amount: number, channel: PaymentChannel, description: string) {
  await prisma.document.create({
    data: {
      siteId,
      type: 'COLLECTION',
      status: 'POSTED',
      number: `T-${docSeq++}`,
      date,
      description,
      totalAmount: amount,
      paymentChannel: channel,
      entries: {
        create: [
          { siteId, accountId, date, debit: 0, credit: amount, description },
          { siteId, accountId: cashId, date, debit: amount, credit: 0, description },
        ],
      },
    },
  });
}

async function setup() {
  await cleanup();
  const site = await prisma.site.create({ data: { name: SITE_NAME, city: CITY, settings: { create: {} } } });
  const other = await prisma.site.create({ data: { name: OTHER_SITE_NAME, city: CITY, settings: { create: {} } } });
  siteId = site.id;
  otherSiteId = other.id;

  const passwordHash = await argon2.hash('Test1234!');
  const users = await Promise.all(
    Object.values(EMAILS).map((email) => prisma.user.create({ data: { email, passwordHash, fullName: email } })),
  );
  const block = await prisma.block.create({ data: { siteId, name: 'R Blok' } });
  const bank = await prisma.account.create({ data: { siteId, type: 'BANK', name: 'Rapor Banka' } });
  const cash = await prisma.account.create({ data: { siteId, type: 'CASH', name: 'Rapor Kasa' } });
  ids.bank = bank.id;
  ids.cash = cash.id;

  const people = [
    { key: 'good', first: 'İyi', last: 'Ödeyen', phone: '0532 111 22 33' },
    { key: 'bad', first: 'Geç', last: 'Ödeyen', phone: '0532 444 55 66' },
    { key: 'ayse', first: 'Ayşe', last: 'Yılmaz', phone: '0532 777 88 99' },
  ];
  for (const [i, p] of people.entries()) {
    const unit = await prisma.unit.create({ data: { siteId, blockId: block.id, doorNumber: String(i + 1) } });
    const person = await prisma.person.create({ data: { siteId, firstName: p.first, lastName: p.last, phone: p.phone } });
    const account = await prisma.account.create({
      data: { siteId, type: 'PERSON', name: `${p.first} ${p.last}`, personId: person.id },
    });
    await prisma.unitOccupancy.create({
      data: { siteId, unitId: unit.id, personId: person.id, role: 'OWNER', startDate: new Date('2020-01-01') },
    });
    ids[`person_${p.key}`] = person.id;
    ids[`account_${p.key}`] = account.id;
  }

  // Son 6 ayın tahakkukları (bu ay hariç — vadesi gelmiş olsun)
  const now = new Date();
  for (let back = 6; back >= 1; back--) {
    const month = new Date(now.getFullYear(), now.getMonth() - back, 1);
    for (const key of ['good', 'bad', 'ayse']) await accrue(ids[`account_${key}`], month);
    // İyi ödeyen: vadeden 5 gün önce havale
    await collect(ids.account_good, bank.id, new Date(month.getFullYear(), month.getMonth(), 10, 12), 1000, 'BANK_TRANSFER', 'İyi Ödeyen tahsilatı');
  }
  // Geç ödeyen: hiç ödemedi, üstüne tazminat
  await accrue(ids.account_bad, new Date(now.getFullYear(), now.getMonth() - 1, 1), 150, 'LATE_FEE');
  // Ayşe: banka açıklamasında ASCII büyük harf ve Türkçe hâliyle adı geçen iki ödeme
  const m = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  await collect(ids.account_ayse, bank.id, new Date(m.getFullYear(), m.getMonth(), 20, 12), 1000, 'BANK_TRANSFER', 'Banka: EFT AYSE YILMAZ 0003');
  await collect(ids.account_ayse, cash.id, new Date(m.getFullYear(), m.getMonth(), 25, 12), 500, 'CASH', 'Ayşe Yılmaz tahsilatı');

  await prisma.siteMembership.createMany({
    data: [
      { userId: users[0].id, siteId, role: 'SITE_ADMIN' },
      { userId: users[1].id, siteId, role: 'ACCOUNTANT' },
      { userId: users[2].id, siteId, role: 'TECHNICIAN' },
      { userId: users[3].id, siteId, role: 'RESIDENT', personId: ids.person_ayse },
    ],
  });

  // Diğer site: kişisi ve carisi raporlara asla girmemeli
  const foreignPerson = await prisma.person.create({ data: { siteId: otherSiteId, firstName: 'Yabancı', lastName: 'Borçlu' } });
  const foreignAccount = await prisma.account.create({
    data: { siteId: otherSiteId, type: 'PERSON', name: 'Yabancı Borçlu', personId: foreignPerson.id },
  });
  ids.account_foreign = foreignAccount.id;

  tokens.admin = await login(EMAILS.admin);
  tokens.accountant = await login(EMAILS.accountant);
  tokens.tech = await login(EMAILS.tech);
  tokens.resident = await login(EMAILS.resident);
}

const year = new Date().getFullYear();
const range = `from=${year - 1}-01-01&to=${year}-12-31`;

async function main(): Promise<void> {
  console.log('Raporlar uçtan uca testi\n');
  await setup();

  // ------------------------------------------------------ 1) ekstre + KVKK
  check('Teknik personel raporlara erişemiyor (403)', (await api(`/reports/statements?${range}`, { as: 'tech' })).status === 403);

  const masked = await api<any>(`/reports/statements?${range}&accountIds=${ids.account_ayse}`, { as: 'accountant' });
  const ayse = masked.data.accounts[0];
  check('Maske varsayılan açık', masked.data.masked === true && ayse.name === 'Ay** Yı****', ayse?.name);
  check('Telefon maskeli', ayse.phone === '0532 *** ** 99', ayse.phone);
  const descriptions = ayse.lines.map((l: any) => l.description).join(' | ');
  check(
    'Açıklamadaki ad Türkçe ve ASCII hâliyle maskeli',
    descriptions.includes('EFT AY** YI****') && descriptions.includes('Ay** Yı**** tahsilatı') && !/ay[sş]e/i.test(descriptions),
    descriptions,
  );

  const plain = await api<any>(`/reports/statements?${range}&accountIds=${ids.account_ayse}&mask=false`);
  check('Maske kapalıyken tam ad', plain.data.accounts[0].name === 'Ayşe Yılmaz');
  check(
    'Ekstre bakiyesi doğru (6.000 borç − 1.500 ödeme)',
    plain.data.accounts[0].closingBalanceMinor === 450000,
    String(plain.data.accounts[0].closingBalanceMinor),
  );

  const debtors = await api<any>(`/reports/statements?${range}&minDebt=5000&mask=false`);
  check(
    'En az borç eşiği: yalnızca 5.000 TL üstü borçlular',
    debtors.data.accounts.map((a: any) => a.name).sort().join(',') === 'Geç Ödeyen',
    debtors.data.accounts.map((a: any) => a.name).join(','),
  );

  const sorted = await api<any>(`/reports/statements?${range}&accountIds=${ids.account_ayse}&sort=number&mask=false`);
  const last = sorted.data.accounts[0].lines.at(-1);
  check('Evrak no sıralamasında da kapanış bakiyesi aynı', last.balanceMinor === 450000);

  check(
    'Diğer sitenin carisi ekstreye eklenemiyor (400)',
    (await api(`/reports/statements?${range}&accountIds=${ids.account_foreign}`)).status === 400,
  );

  // -------------------------------------------------------------- 2) PDF
  const pdf = await raw(`/reports/statements/pdf?${range}`, { as: 'accountant' });
  const bytes = Buffer.from(await pdf.arrayBuffer());
  check(
    'Ekstre PDF üretiliyor',
    pdf.status === 200 && pdf.headers.get('content-type') === 'application/pdf' && bytes.subarray(0, 5).toString() === '%PDF-' && bytes.length > 2000,
    `${pdf.status} ${bytes.length}`,
  );
  check('PDF dosya adı ve önbellek başlığı', /cari-ekstre-\d{4}-\d{2}-\d{2}\.pdf/.test(pdf.headers.get('content-disposition') ?? '') && pdf.headers.get('cache-control') === 'no-store');
  const exportLog = await prisma.auditLog.findFirst({ where: { siteId, action: 'EXPORT', entityType: 'StatementReport' } });
  check('PDF dışa aktarımı denetim günlüğünde (maske bilgisiyle)', (exportLog?.after as any)?.masked === true);

  // ------------------------------------------------------ 3) yaşlandırma
  const aging = await api<any>('/reports/aging?mask=false');
  const bad = aging.data.rows.find((r: any) => r.name === 'Geç Ödeyen');
  check('İyi ödeyen yaşlandırmada yok', !aging.data.rows.some((r: any) => r.name === 'İyi Ödeyen'));
  check('Geç ödeyenin 90+ gün borcu var', bad?.buckets.d90 > 0 && bad.totalMinor === 615000, JSON.stringify(bad?.buckets));
  const bucketSum = ['notDue', 'd0_30', 'd31_60', 'd61_90', 'd90'].reduce((acc, k) => acc + aging.data.totals[k], 0);
  check('Kova toplamları genel toplama eşit', bucketSum === aging.data.totals.totalMinor);
  const agingPdf = await raw('/reports/aging/pdf');
  check('Yaşlandırma PDF üretiliyor', agingPdf.status === 200 && (await agingPdf.arrayBuffer()).byteLength > 2000);

  // ----------------------------------------------------- 4) ödeme skoru
  const empty = await api<any>('/reports/payment-scores');
  check('Hesaplanmadan önce skor yok', empty.data.calculatedAt === null);
  check('Muhasebe yeniden hesaplatamıyor (403)', (await api('/reports/payment-scores/recalculate', { method: 'POST', as: 'accountant' })).status === 403);

  const calc = await api<any>('/reports/payment-scores/recalculate', { method: 'POST' });
  check('Skorlar hesaplandı: 3 kişi', calc.status === 200 && calc.data.scoredCount === 3, JSON.stringify(calc.data));

  const scores = await api<any>('/reports/payment-scores?mask=false');
  const byName = Object.fromEntries(scores.data.people.map((p: any) => [p.name, p]));
  check('İyi ödeyen: oran %100, 5 gün peşin, skor 5', byName['İyi Ödeyen']?.score === 5 && byName['İyi Ödeyen'].avgDaysEarly === 5, JSON.stringify(byName['İyi Ödeyen']));
  check('Geç ödeyen: düşük segment', byName['Geç Ödeyen']?.segment === 'LOW' && byName['Geç Ödeyen'].collectionRate === 0);
  // 6. ayın vadesi (15'i) pencere başlangıcından önce kalır → pencerede 5 borç (5.000 TL).
  // 1.500 TL FIFO ile önce pencere dışındaki en eski borcu kapatır; pencereye 500 TL düşer.
  check(
    'Ayşe: FIFO ile pencere içi tahsilat oranı %10, kanal payı %67 havale',
    byName['Ayşe Yılmaz']?.collectionRate === 0.1 &&
      byName['Ayşe Yılmaz'].dueMinor === 500000 && Math.abs(byName['Ayşe Yılmaz'].channelShares.BANK_TRANSFER - 2 / 3) < 0.001,
    JSON.stringify(byName['Ayşe Yılmaz']),
  );
  check(
    'Site özeti segmentleri',
    scores.data.summary.scoredCount === 3 && scores.data.summary.highCount === 1 && scores.data.summary.highCount + scores.data.summary.midCount + scores.data.summary.lowCount === 3,
  );
  check('Trend bugünü içeriyor', scores.data.trend.length === 1);
  check(
    'İl kıyası 3 siteden az veriyle gösterilmiyor (gizlilik)',
    scores.data.benchmarks.cityAverage === null && scores.data.benchmarks.citySiteCount === 1,
    JSON.stringify(scores.data.benchmarks),
  );
  check('Skor listesi maskeli de alınabiliyor', (await api<any>('/reports/payment-scores')).data.people.every((p: any) => p.name.includes('*')));
  const personScore = await api<any>(`/reports/payment-scores/person/${ids.person_good}`, { as: 'tech' });
  check('Kişi kartı skor rozeti', personScore.data.score === 5 && personScore.data.segment === 'HIGH');

  const again = await api<any>('/reports/payment-scores/recalculate', { method: 'POST' });
  check(
    'Aynı gün yeniden hesap üzerine yazar (çift kayıt yok)',
    again.data.scoredCount === 3 && (await prisma.paymentScore.count({ where: { siteId } })) === 3,
  );

  // ------------------------------------------------ 5) tahsilat kanalı
  const cashReceipt = await api<any>('/finance/collections', {
    method: 'POST',
    body: { accountId: ids.account_bad, cashAccountId: ids.cash, amount: 100, date: new Date().toISOString() },
  });
  const receipt = await prisma.document.findUnique({ where: { id: cashReceipt.data.id } });
  check('Kasaya tahsilat "elden" kanalıyla kaydedildi', receipt?.paymentChannel === 'CASH');

  // -------------------------------------------- 6) sakinin kendi PDF'i
  const own = await raw(`/portal/statement/pdf?${range}`, { as: 'resident' });
  check('Sakin kendi ekstresini PDF indiriyor', own.status === 200 && (await own.arrayBuffer()).byteLength > 1500);
  check('Sakin site raporuna erişemiyor (403)', (await api(`/reports/statements?${range}`, { as: 'resident' })).status === 403);

  // ---------------------------------------------------- 7) izolasyon
  const all = await api<any>(`/reports/statements?${range}&mask=false`);
  check('Ekstrede diğer sitenin carisi yok', !all.data.accounts.some((a: any) => a.name === 'Yabancı Borçlu'));
  check('Yaşlandırmada diğer sitenin carisi yok', !aging.data.rows.some((r: any) => r.name === 'Yabancı Borçlu'));
  check(
    'Diğer sitede skor kaydı oluşmadı',
    (await prisma.paymentScore.count({ where: { siteId: otherSiteId } })) === 0,
  );

  // ---------------------------------------------------- 8) gelir-gider
  // Bilinen veri: son 6 ay × 3 kişi × 1.000 TL aidat, geç ödeyene 150 TL
  // tazminat; buna 2.500 TL gider faturası + ödemesi, iptal edilmiş bir
  // tahakkuk, kasa→banka virmanı ve diğer sitede bir tahakkuk ekleniyor.
  const now = new Date();
  const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12);
  const range6 = `from=${ym(new Date(now.getFullYear(), now.getMonth() - 6, 1))}&to=${ym(now)}`;

  const category = await prisma.category.create({ data: { siteId, kind: 'EXPENSE', name: 'Test Elektrik' } });
  const supplier = await prisma.account.create({ data: { siteId, type: 'SUPPLIER', name: 'Test Elektrik AŞ' } });
  const doc = (data: Parameters<typeof prisma.document.create>[0]['data']) => prisma.document.create({ data });
  await doc({
    siteId, type: 'EXPENSE', status: 'POSTED', number: `T-${docSeq++}`, date: lastMonth, totalAmount: 2500,
    entries: { create: { siteId, accountId: supplier.id, categoryId: category.id, date: lastMonth, debit: 0, credit: 2500 } },
  });
  await doc({
    siteId, type: 'PAYMENT', status: 'POSTED', number: `T-${docSeq++}`, date: lastMonth, totalAmount: 2500,
    entries: { create: [
      { siteId, accountId: supplier.id, date: lastMonth, debit: 2500, credit: 0 },
      { siteId, accountId: ids.bank, date: lastMonth, debit: 0, credit: 2500 },
    ] },
  });
  await doc({
    siteId, type: 'DUES_ACCRUAL', status: 'CANCELLED', number: `T-${docSeq++}`, date: lastMonth, totalAmount: 777,
    entries: { create: { siteId, accountId: ids.account_good, date: lastMonth, debit: 777, credit: 0 } },
  });
  await doc({
    siteId, type: 'TRANSFER', status: 'POSTED', number: `T-${docSeq++}`, date: lastMonth, totalAmount: 300,
    entries: { create: [
      { siteId, accountId: ids.bank, date: lastMonth, debit: 300, credit: 0 },
      { siteId, accountId: ids.cash, date: lastMonth, debit: 0, credit: 300 },
    ] },
  });
  await doc({
    siteId: otherSiteId, type: 'DUES_ACCRUAL', status: 'POSTED', number: 'Y-1', date: lastMonth, totalAmount: 99999,
    entries: { create: { siteId: otherSiteId, accountId: ids.account_foreign, date: lastMonth, debit: 99999, credit: 0 } },
  });

  check('Teknik personel gelir-gidere erişemiyor (403)', (await api(`/reports/income-statement?${range6}`, { as: 'tech' })).status === 403);
  check('25 aylık aralık reddedildi (400)', (await api('/reports/income-statement?from=2024-01&to=2026-01')).status === 400);
  check('Ters aralık reddedildi (400)', (await api('/reports/income-statement?from=2026-05&to=2026-04')).status === 400);

  const income = await api<any>(`/reports/income-statement?${range6}`, { as: 'accountant' });
  const st = income.data.statement;
  check('Gelir-gider 7 ay sütunu', income.status === 200 && st.months.length === 7, String(income.status));
  check(
    'Toplam gelir 18.150 TL (iptal edilen ve diğer sitenin evrakı yok)',
    st.incomeTotal.totalMinor === 1_815_000,
    String(st.incomeTotal.totalMinor),
  );
  check(
    'Kategorisiz tahakkuk evrak türüyle etiketlendi',
    st.income.some((l: any) => l.label === 'Aidat Tahakkuku' && l.totalMinor === 1_800_000) &&
      st.income.some((l: any) => l.label === 'Gecikme Tazminatı' && l.totalMinor === 15_000),
    JSON.stringify(st.income.map((l: any) => [l.label, l.totalMinor])),
  );
  check(
    'Gider kategorisiyle 2.500 TL, net 15.650 TL',
    st.expense.length === 1 && st.expense[0].label === 'Test Elektrik' && st.net.totalMinor === 1_565_000,
  );

  const cash = income.data.cash;
  const cashBalance = await prisma.ledgerEntry.aggregate({
    where: { siteId, account: { type: { in: ['CASH', 'BANK'] } }, document: { status: 'POSTED' } },
    _sum: { debit: true, credit: true },
  });
  const realCash = Math.round((Number(cashBalance._sum.debit) - Number(cashBalance._sum.credit)) * 100);
  check(
    'Nakit: dönem sonu = kasa+banka gerçek bakiyesi',
    cash.closingMinor === realCash && cash.closingMinor === cash.openingMinor + cash.inflowTotal.totalMinor - cash.outflowTotal.totalMinor,
    `${cash.closingMinor} / ${realCash}`,
  );
  check(
    'Nakit: virman giriş/çıkışa yazılmadı, ödeme çıkışta',
    !cash.inflow.some((l: any) => l.label === 'Virman') &&
      !cash.outflow.some((l: any) => l.label === 'Virman') &&
      cash.outflow.some((l: any) => l.label === 'Ödeme' && l.totalMinor === 250_000),
  );

  const incomePdf = await raw(`/reports/income-statement/pdf?${range6}`);
  const pdfBytes = Buffer.from(await incomePdf.arrayBuffer());
  check('Gelir-gider PDF', incomePdf.status === 200 && pdfBytes.subarray(0, 4).toString() === '%PDF');

  const ExcelJS = (await import('exceljs')).default;
  const incomeXlsx = await raw(`/reports/income-statement/xlsx?${range6}`);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await incomeXlsx.arrayBuffer()) as never);
  const sheet = book.getWorksheet('Gelir-Gider')!;
  const netRow = sheet.getColumn(1).values.findIndex((v) => v === 'NET (Gelir − Gider)');
  const netTotal = sheet.getRow(netRow).getCell(sheet.columnCount).value;
  check(
    'Gelir-gider Excel: tutar hücresi sayı ve net doğru',
    incomeXlsx.headers.get('content-disposition')?.includes('gelir-gider-') === true && netTotal === 15650,
    `net hücre: ${JSON.stringify(netTotal)}`,
  );

  const agingXlsx = await raw('/reports/aging/xlsx?mask=true');
  const agingBook = new ExcelJS.Workbook();
  await agingBook.xlsx.load(Buffer.from(await agingXlsx.arrayBuffer()) as never);
  const agingText = JSON.stringify(agingBook.getWorksheet('Yaşlandırma')!.getSheetValues());
  check('Yaşlandırma Excel maskeli (açık ad yok)', agingXlsx.status === 200 && !agingText.includes('Ödeyen') && agingText.includes('KVKK'));

  const statementXlsx = await raw(`/reports/statements/xlsx?${range}&accountIds=${ids.account_ayse}`);
  check('Ekstre Excel indiriliyor', statementXlsx.status === 200 && (await statementXlsx.arrayBuffer()).byteLength > 3000);
  check(
    'Excel dışa aktarımları denetim kaydında',
    (await prisma.auditLog.count({ where: { siteId, action: 'EXPORT', after: { path: ['format'], equals: 'xlsx' } } })) === 3,
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
