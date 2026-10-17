/**
 * İŞ TAKİBİ (KANBAN) UÇTAN UCA TESTİ
 *
 *   oluşturma → numaralama → pano → taşıma/sıralama → yorum →
 *   masraf → gider faturası → silme kuralları → anket → yetki → izolasyon
 *
 * Kendi izole test sitelerini kurar ve sonunda siler; demo veriye dokunmaz.
 *
 *   pnpm --filter @sy/api run test:tickets
 */
import { PrismaClient } from '@sy/db';
import * as argon2 from 'argon2';

const BASE = process.env.API_BASE ?? 'http://localhost:3101';
const SITE_NAME = 'TEST TALEP SİTESİ';
const OTHER_SITE_NAME = 'TEST TALEP DİĞER SİTE';
const USERS = ['talep-admin@test.local', 'talep-teknik@test.local', 'talep-sakin@test.local'];
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

async function setup() {
  await cleanup();

  const site = await prisma.site.create({
    data: { name: SITE_NAME, city: 'İzmir', settings: { create: {} } },
  });
  const other = await prisma.site.create({
    data: { name: OTHER_SITE_NAME, city: 'Bursa', settings: { create: {} } },
  });
  siteId = site.id;
  otherSiteId = other.id;

  const passwordHash = await argon2.hash('Test1234!');
  const [admin, tech, resident] = await Promise.all(
    USERS.map((email, i) =>
      prisma.user.create({
        data: { email, passwordHash, fullName: ['Talep Yöneticisi', 'Teknik Personel', 'Sakin'][i] },
      }),
    ),
  );
  await prisma.siteMembership.createMany({
    data: [
      { userId: admin.id, siteId, role: 'SITE_ADMIN' },
      { userId: tech.id, siteId, role: 'TECHNICIAN' },
      { userId: resident.id, siteId, role: 'RESIDENT' },
    ],
  });

  const block = await prisma.block.create({ data: { siteId, name: 'A Blok' } });
  await prisma.unit.create({ data: { siteId, blockId: block.id, doorNumber: '7' } });
  await prisma.person.create({ data: { siteId, firstName: 'Ayşe', lastName: 'Yılmaz' } });
  await prisma.department.create({ data: { siteId, name: 'Teknik' } });
  await prisma.account.create({ data: { siteId, type: 'SUPPLIER', name: 'Test Tesisat Ltd.' } });
  await prisma.category.create({ data: { siteId, kind: 'EXPENSE', name: 'Tamirat' } });

  // Diğer sitenin kayıtları — test sitesinden asla erişilememeli
  await prisma.person.create({ data: { siteId: otherSiteId, firstName: 'Yabancı', lastName: 'Kişi' } });
  await prisma.ticket.create({
    data: { siteId: otherSiteId, number: 1, subject: 'Gizli talep', description: 'Görünmemeli' },
  });

  tokens.admin = await login(USERS[0]);
  tokens.tech = await login(USERS[1]);
  tokens.resident = await login(USERS[2]);
}

async function main(): Promise<void> {
  console.log('İş takibi uçtan uca testi\n');
  await setup();

  const meta = await api<any>('/tickets/meta');
  const departmentId = meta.data.departments[0]?.id;
  const techId = meta.data.assignees.find((a: any) => a.role === 'TECHNICIAN')?.id;
  check('Meta: departman ve teknik personel listeleniyor', !!departmentId && !!techId);
  check(
    'Meta: sakin atanabilir personel listesinde yok',
    !meta.data.assignees.some((a: any) => a.role === 'RESIDENT'),
  );

  const unit = await prisma.unit.findFirstOrThrow({ where: { siteId } });
  const person = await prisma.person.findFirstOrThrow({ where: { siteId } });

  // ------------------------------------------------------ 1) oluşturma
  const created: any[] = [];
  for (const subject of ['Kombi arızası', 'Kapı kolu kırık', 'Bahçe sulama']) {
    const res = await api('/tickets', {
      method: 'POST',
      body: {
        subject,
        description: `${subject} — test açıklaması`,
        requestType: 'FAULT',
        priority: 'HIGH',
        personId: person.id,
        unitId: unit.id,
        departmentId,
        dueDate: '2020-01-01',
      },
    });
    created.push(res.data);
  }
  check(
    'Talep numaraları site içinde 1, 2, 3',
    created.map((t) => t.number).join(',') === '1,2,3',
    `(${created.map((t) => t.number).join(',')})`,
  );
  check(
    'Yeni talepler Beklemede kolonunun sonuna ekleniyor',
    created.map((t) => `${t.status}:${t.boardOrder}`).join(',') === 'WAITING:0,WAITING:1,WAITING:2',
  );
  const [t1, t2, t3] = created;

  // ---------------------------------------------------------- 2) pano
  const board = await api<any>('/tickets/board');
  check('Pano 8 kolon döndürüyor', board.data.columns.length === 8);
  const waiting = board.data.columns.find((c: any) => c.status === 'WAITING');
  check('Beklemede kolonunda 3 kart var', waiting.cards.length === 3);
  check('Diğer sitenin talebi panoda görünmüyor', board.data.total === 3);
  check('Hedef tarihi geçen talepler gecikmiş sayılıyor', board.data.overdue === 3);
  check(
    'Kart daire etiketi ve kişi adı içeriyor',
    waiting.cards[0].unit?.label === 'A Blok / 7' && waiting.cards[0].person?.fullName === 'Ayşe Yılmaz',
  );

  // --------------------------------------------------------- 3) taşıma
  await api(`/tickets/${t3.id}/move`, { method: 'PUT', body: { status: 'WAITING', boardOrder: 0 } });
  const reordered = await api<any>('/tickets/board');
  check(
    'Kolon içi sıralama: 3 en üste çıktı',
    reordered.data.columns[0].cards.map((c: any) => c.number).join(',') === '3,1,2',
  );

  const toProgress = await api(`/tickets/${t1.id}/move`, {
    method: 'PUT',
    body: { status: 'IN_PROGRESS', boardOrder: 0 },
    as: 'tech',
  });
  check('Teknik personel kartı taşıyabiliyor', toProgress.status === 200);

  const done = await api<any>(`/tickets/${t2.id}/move`, {
    method: 'PUT',
    body: { status: 'COMPLETED', boardOrder: 0 },
  });
  check('Tamamlandı kolonuna giren talebe tamamlanma tarihi işleniyor', !!done.data.completedAt);

  const afterDone = await api<any>('/tickets/board');
  check('Tamamlanan talep gecikmiş sayılmıyor', afterDone.data.overdue === 2);

  const reopened = await api<any>(`/tickets/${t2.id}/move`, {
    method: 'PUT',
    body: { status: 'REVIEWING', boardOrder: 0 },
  });
  check('Yeniden açılan talebin tamamlanma tarihi siliniyor', reopened.data.completedAt === null);

  // ---------------------------------------------------------- 4) yorum
  const comment = await api<any>(`/tickets/${t1.id}/comments`, {
    method: 'POST',
    body: { body: 'Parça siparişi verildi', isPublic: false },
    as: 'tech',
  });
  check('Teknik personel iç not ekleyebiliyor', comment.status === 201 && comment.data.isPublic === false);

  const detail = await api<any>(`/tickets/${t1.id}`);
  check(
    'Talep kartında yorum yazarı görünüyor',
    detail.data.comments[0]?.authorName === 'Teknik Personel',
  );
  check('Talep kartında işlem geçmişi var', detail.data.history.length >= 2);

  // ---------------------------------------------------------- 5) masraf
  const supplier = await prisma.account.findFirstOrThrow({ where: { siteId, type: 'SUPPLIER' } });
  const category = await prisma.category.findFirstOrThrow({ where: { siteId, kind: 'EXPENSE' } });

  const techInvoice = await api(`/tickets/${t1.id}/expenses`, {
    method: 'POST',
    body: {
      description: 'Kombi kartı',
      amount: '1.250,50',
      invoice: { accountId: supplier.id, categoryId: category.id, date: '2026-10-01' },
    },
    as: 'tech',
  });
  check('Teknik personel gider faturası kesemiyor (403)', techInvoice.status === 403);

  const plain = await api<any>(`/tickets/${t1.id}/expenses`, {
    method: 'POST',
    body: { description: 'Conta', amount: '150' },
    as: 'tech',
  });
  check('Teknik personel faturasız masraf girebiliyor', plain.status === 201 && !plain.data.documentId);

  const invoiced = await api<any>(`/tickets/${t1.id}/expenses`, {
    method: 'POST',
    body: {
      description: 'Kombi kartı',
      amount: '1.250,50',
      invoice: { accountId: supplier.id, categoryId: category.id, date: '2026-10-01' },
    },
  });
  check('Yönetici masrafı faturalı girebiliyor', invoiced.status === 201 && !!invoiced.data.documentId);

  const converted = await api<any>(`/tickets/expenses/${plain.data.id}/invoice`, {
    method: 'POST',
    body: { accountId: supplier.id, categoryId: category.id, date: '2026-10-02' },
  });
  check('Faturasız masraf sonradan faturaya dönüştürülüyor', !!converted.data.documentId);

  const twice = await api(`/tickets/expenses/${plain.data.id}/invoice`, {
    method: 'POST',
    body: { accountId: supplier.id, categoryId: category.id, date: '2026-10-02' },
  });
  check('Aynı masraf iki kez faturalanamıyor (409)', twice.status === 409);

  const withExpenses = await api<any>(`/tickets/${t1.id}`);
  check(
    'Masraf toplamı 1.400,50 TL',
    withExpenses.data.expenseTotalMinor === 140050,
    `(${withExpenses.data.expenseTotalMinor})`,
  );
  check('Talebe bağlı 2 gider evrakı listeleniyor', withExpenses.data.documents.length === 2);

  const supplierBalance = await api<any>(`/finance/accounts/${supplier.id}/statement?from=2026-01-01&to=2026-12-31`);
  check(
    'Tedarikçi carisi 1.400,50 TL alacaklandı',
    supplierBalance.data.closingBalanceMinor === -140050,
    `(${supplierBalance.data.closingBalanceMinor})`,
  );

  // ------------------------------------------------------ 6) silme kuralları
  const blockedExpense = await api(`/tickets/expenses/${invoiced.data.id}`, { method: 'DELETE' });
  check('Faturalı masraf silinemiyor (409)', blockedExpense.status === 409);

  const blockedTicket = await api(`/tickets/${t1.id}`, { method: 'DELETE' });
  check('Gider evrakı olan talep silinemiyor (409)', blockedTicket.status === 409);

  const techDelete = await api(`/tickets/${t3.id}`, { method: 'DELETE', as: 'tech' });
  check('Teknik personel talep silemiyor (403)', techDelete.status === 403);

  await api(`/finance/documents/${invoiced.data.documentId}/cancel`, { method: 'POST', body: {} });
  const afterCancel = await api(`/tickets/expenses/${invoiced.data.id}`, { method: 'DELETE' });
  check('Evrakı iptal edilen masraf silinebiliyor', afterCancel.status === 200);

  // ----------------------------------------------------------- 7) anket
  const earlySurvey = await api(`/tickets/${t3.id}/survey`, { method: 'PUT', body: { rating: 5 } });
  check('Tamamlanmamış talebe anket girilemiyor (400)', earlySurvey.status === 400);

  await api(`/tickets/${t3.id}/move`, { method: 'PUT', body: { status: 'COMPLETED', boardOrder: 0 } });
  const survey = await api<any>(`/tickets/${t3.id}/survey`, {
    method: 'PUT',
    body: { rating: 4, comment: 'Hızlı çözüldü' },
  });
  check('Tamamlanan talebe anket kaydediliyor', survey.status === 200 && survey.data.rating === 4);

  const removed = await api(`/tickets/${t3.id}`, { method: 'DELETE' });
  check('Evrakı olmayan talep silinebiliyor', removed.status === 200);

  // ------------------------------------------------------- 8) yetki
  const residentBoard = await api('/tickets/board', { as: 'resident' });
  check('Sakin personel panosuna erişemiyor (403)', residentBoard.status === 403);

  // ---------------------------------------------------- 9) izolasyon
  const foreignTicket = await prisma.ticket.findFirstOrThrow({ where: { siteId: otherSiteId } });
  const foreignPerson = await prisma.person.findFirstOrThrow({ where: { siteId: otherSiteId } });

  const readForeign = await api(`/tickets/${foreignTicket.id}`);
  check('Diğer sitenin talebi okunamıyor (404)', readForeign.status === 404);

  const commentForeign = await api(`/tickets/${foreignTicket.id}/comments`, {
    method: 'POST',
    body: { body: 'sızma denemesi' },
  });
  check('Diğer sitenin talebine yorum yazılamıyor (404)', commentForeign.status === 404);

  const moveForeign = await api(`/tickets/${foreignTicket.id}/move`, {
    method: 'PUT',
    body: { status: 'COMPLETED', boardOrder: 0 },
  });
  check('Diğer sitenin talebi taşınamıyor (404)', moveForeign.status === 404);

  const linkForeign = await api('/tickets', {
    method: 'POST',
    body: { subject: 'Sızma', description: 'Yabancı kişiye bağlama', personId: foreignPerson.id },
  });
  check('Talep diğer sitenin kişisine bağlanamıyor (400)', linkForeign.status === 400);

  const outsider = await prisma.user.findFirstOrThrow({ where: { email: USERS[2] } });
  const assignResident = await api('/tickets', {
    method: 'POST',
    body: { subject: 'Atama', description: 'Sakine atama', assigneeId: outsider.id },
  });
  check('Talep personel olmayan kullanıcıya atanamıyor (400)', assignResident.status === 400);

  const foreignUntouched = await prisma.ticket.findUniqueOrThrow({ where: { id: foreignTicket.id } });
  const foreignComments = await prisma.ticketComment.count({ where: { ticketId: foreignTicket.id } });
  check(
    'Diğer sitenin talebi değişmedi',
    foreignUntouched.status === 'WAITING' && foreignComments === 0,
  );

  // --------------------------------------------------------- temizlik
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
