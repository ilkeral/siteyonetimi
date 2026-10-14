/**
 * Demo veri üretici.
 *
 * `pnpm db:seed` ile çalışır. Tekrar çalıştırıldığında mevcut demo siteyi
 * siler ve yeniden kurar (idempotent). Rastgelelik sabit tohumludur —
 * her çalıştırmada aynı veri üretilir, böylece testler ve ekran görüntüleri
 * tutarlı kalır.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const SITE_NAME = 'ADAKENT APARTMANI';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@site.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Admin1234!';

// --- Sabit tohumlu rastgelelik (Mulberry32) --------------------------------
let seedState = 20260814;
function rnd(): number {
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)];
}
function int(min: number, max: number): number {
  return Math.floor(rnd() * (max - min + 1)) + min;
}

const FIRST_NAMES = [
  'Ali', 'Ayşe', 'Mehmet', 'Fatma', 'Mustafa', 'Zeynep', 'Hasan', 'Emine',
  'Hüseyin', 'Hatice', 'İbrahim', 'Elif', 'Murat', 'Meryem', 'Ahmet', 'Sibel',
  'Furkan', 'Selma', 'Erdoğan', 'Nazlı', 'Recep', 'Zehra', 'Sedat', 'Derya',
  'Emrecan', 'Gül', 'Serkan', 'Pınar', 'Burak', 'Esra',
] as const;

const LAST_NAMES = [
  'Yılmaz', 'Demir', 'Çelik', 'Şahin', 'Yıldız', 'Aydın', 'Özdemir', 'Arslan',
  'Doğan', 'Kılıç', 'Aslan', 'Çetin', 'Kaya', 'Koç', 'Kurt', 'Özkan',
  'Şimşek', 'Polat', 'Erdoğan', 'Taş',
] as const;

const EXPENSE_CATEGORIES = [
  'Personel Gideri', 'Elektrik', 'Su', 'Doğalgaz', 'Asansör Bakım',
  'Temizlik', 'Güvenlik', 'Bahçe Bakım', 'Tamir Onarım', 'Demirbaş',
  'Sigorta', 'Diğer Giderler',
] as const;

const INCOME_CATEGORIES = [
  'Aidat Geliri', 'Demirbaş Geliri', 'Gecikme Tazminatı', 'Kira Geliri', 'Diğer Gelirler',
] as const;

async function main(): Promise<void> {
  console.log('→ Demo veri kuruluyor...');

  // ---------------------------------------------------------------- temizlik
  const existing = await prisma.site.findFirst({ where: { name: SITE_NAME } });
  if (existing) {
    console.log('  mevcut demo site siliniyor...');
    await prisma.site.delete({ where: { id: existing.id } });
  }

  // ---------------------------------------------------------------- kullanıcı
  const passwordHash = await argon2.hash(ADMIN_PASSWORD);
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { passwordHash, isSuperAdmin: true, isActive: true },
    create: {
      email: ADMIN_EMAIL,
      passwordHash,
      fullName: 'Sistem Yöneticisi',
      isSuperAdmin: true,
    },
  });

  const technician = await prisma.user.upsert({
    where: { email: 'teknik@site.local' },
    update: {},
    create: {
      email: 'teknik@site.local',
      passwordHash: await argon2.hash('Teknik1234!'),
      fullName: 'Kemal Usta',
    },
  });

  // -------------------------------------------------------------------- site
  const site = await prisma.site.create({
    data: {
      name: SITE_NAME,
      type: 'APARTMAN',
      city: 'İstanbul',
      district: 'Tuzla',
      address: 'Postane Mah. Site Cad. No:1 Tuzla/İstanbul',
      settings: {
        create: {
          fiscalStartMonth: 1,
          fiscalStartYear: new Date().getFullYear(),
          duesDistributionMethod: 'EQUAL',
          duesLiabilityRule: 'OCCUPANT',
          dueDayOfMonth: 15,
          lateFeeMethod: 'MONTHLY_PERCENT',
          lateFeeRate: 5,
          applyLateFee: true,
          requireMobilePhone: true,
          communicationLanguages: ['TR', 'EN'],
          autoMatchBankTransactions: true,
        },
      },
    },
  });
  const siteId = site.id;

  await prisma.siteMembership.createMany({
    data: [
      { userId: admin.id, siteId, role: 'SITE_ADMIN' },
      { userId: technician.id, siteId, role: 'TECHNICIAN' },
    ],
  });

  // ------------------------------------------------------------------ bloklar
  const blockNames = ['A Blok', 'B Blok', 'C Blok'];
  const blocks = [];
  for (const [i, name] of blockNames.entries()) {
    blocks.push(
      await prisma.block.create({
        data: { siteId, name, code: name[0], floorCount: 5, order: i },
      }),
    );
  }

  // ------------------------------------------------------------------ daireler
  const units = [];
  let doorNo = 1;
  for (const block of blocks) {
    for (let floor = 1; floor <= 5; floor++) {
      for (let d = 0; d < 3; d++) {
        const area = pick([85, 95, 110, 120, 135]);
        units.push(
          await prisma.unit.create({
            data: {
              siteId,
              blockId: block.id,
              doorNumber: String(doorNo++),
              floor,
              area,
              landShare: area / 10,
              shareRatio: 1,
              roomCount: area > 110 ? '3+1' : '2+1',
              status: rnd() > 0.92 ? 'EMPTY' : 'OCCUPIED',
            },
          }),
        );
      }
    }
  }
  console.log(`  ${blocks.length} blok, ${units.length} daire`);

  // -------------------------------------------------------------------- kişiler
  const people = [];
  for (const unit of units) {
    const ownerIsResident = rnd() > 0.35;

    const owner = await createPerson(siteId);
    people.push(owner);
    await prisma.unitOccupancy.create({
      data: {
        siteId,
        unitId: unit.id,
        personId: owner.id,
        role: 'OWNER',
        startDate: new Date(2020, int(0, 11), int(1, 28)),
        bankPaymentCode: `${String(unit.doorNumber).padStart(4, '0')}`,
      },
    });

    if (!ownerIsResident && unit.status === 'OCCUPIED') {
      const tenant = await createPerson(siteId);
      people.push(tenant);
      await prisma.unitOccupancy.create({
        data: {
          siteId,
          unitId: unit.id,
          personId: tenant.id,
          role: 'TENANT',
          startDate: new Date(2024, int(0, 11), int(1, 28)),
          bankPaymentCode: `K${String(unit.doorNumber).padStart(3, '0')}`,
        },
      });
    }
  }
  console.log(`  ${people.length} kişi`);

  // --------------------------------------------------------------------- cari
  await prisma.account.createMany({
    data: people.map((p) => ({
      siteId,
      type: 'PERSON' as const,
      name: `${p.firstName} ${p.lastName}`,
      personId: p.id,
    })),
  });

  const cash = await prisma.account.create({
    data: { siteId, type: 'CASH', name: 'Merkez Kasa', code: '100.01' },
  });
  await prisma.account.create({
    data: {
      siteId,
      type: 'BANK',
      name: 'Ziraat Bankası - Site Hesabı',
      code: '102.01',
      iban: 'TR000001000000000000000001',
      bankName: 'Ziraat Bankası',
    },
  });
  await prisma.account.createMany({
    data: [
      { siteId, type: 'SUPPLIER' as const, name: 'FİBE MÜHENDİSLİK ASANSÖR SAN. TİC. LTD. ŞTİ.', taxNumber: '1234567890' },
      { siteId, type: 'SUPPLIER' as const, name: 'MESİ TEMİZLİK HİZMETLERİ A.Ş.', taxNumber: '2345678901' },
      { siteId, type: 'SUPPLIER' as const, name: 'BOĞAZİÇİ ELEKTRİK PERAKENDE SATIŞ A.Ş.' },
      { siteId, type: 'EMPLOYEE' as const, name: 'Kemal Usta (Kapıcı)' },
    ],
  });

  // --------------------------------------------------------------- kategoriler
  await prisma.category.createMany({
    data: [
      ...EXPENSE_CATEGORIES.map((name, i) => ({ siteId, kind: 'EXPENSE' as const, name, order: i })),
      ...INCOME_CATEGORIES.map((name, i) => ({ siteId, kind: 'INCOME' as const, name, order: i })),
    ],
  });

  // -------------------------------------------------------------- aidat kalemleri
  await prisma.duesItem.createMany({
    data: [
      { siteId, name: 'Aidat', defaultAmount: 1500, distributionMethod: 'EQUAL', order: 0 },
      { siteId, name: 'Demirbaş', defaultAmount: 250, distributionMethod: 'EQUAL', order: 1 },
      { siteId, name: 'Yakıt Avansı', defaultAmount: 0, distributionMethod: 'BY_AREA', order: 2 },
    ] satisfies Prisma.DuesItemCreateManyInput[],
  });

  // ---------------------------------------------------------------- departmanlar
  await prisma.department.createMany({
    data: [
      { siteId, name: 'Teknik', order: 0 },
      { siteId, name: 'Temizlik', order: 1 },
      { siteId, name: 'Güvenlik', order: 2 },
      { siteId, name: 'Yönetim', order: 3 },
    ],
  });
  const technicalDept = await prisma.department.findFirst({ where: { siteId, name: 'Teknik' } });

  // ---------------------------------------------------------- bildirim şablonları
  await prisma.notificationTemplate.createMany({
    data: [
      {
        siteId,
        channel: 'EMAIL',
        language: 'TR',
        name: 'Aidat Borcu Bilgilendirme',
        subject: '{{siteAdi}} — {{donem}} dönemi aidat bilgilendirmesi',
        body:
          'Sayın {{adSoyad}},\n\n' +
          '{{daireNo}} nolu daireye ait {{donem}} dönemi aidat borcunuz {{borcTutari}} tutarındadır.\n' +
          'Son ödeme tarihi: {{sonOdemeTarihi}}\n\n' +
          'Ödeme yapmak için: {{odemeLinki}}\n\n' +
          'Site Yönetimi',
      },
      {
        siteId,
        channel: 'SMS',
        language: 'TR',
        name: 'Aidat Hatırlatma',
        body: '{{siteAdi}}: {{donem}} aidat borcunuz {{borcTutari}}. Son ödeme {{sonOdemeTarihi}}. Ödeme: {{odemeLinki}}',
      },
      {
        siteId,
        channel: 'EMAIL',
        language: 'EN',
        name: 'Aidat Borcu Bilgilendirme',
        subject: '{{siteAdi}} — maintenance fee for {{donem}}',
        body:
          'Dear {{adSoyad}},\n\nYour maintenance fee for {{donem}} is {{borcTutari}}.\n' +
          'Due date: {{sonOdemeTarihi}}\n\nPay online: {{odemeLinki}}\n\nBuilding Management',
      },
    ],
  });

  // --------------------------------------------------------------------- talepler
  const ticketSeeds = [
    { subject: 'Diyafon çalışmıyor', description: 'Diyafon çalışmıyor, aşağı kapıları açamıyorum.', requestType: 'FAULT' as const, status: 'WAITING' as const },
    { subject: 'Asansör arızası', description: 'A blok asansörü 3. katta takılı kaldı.', requestType: 'FAULT' as const, status: 'IN_PROGRESS' as const },
    { subject: 'Otopark aydınlatması', description: 'Otoparkın arka kısmındaki lambalar yanmıyor.', requestType: 'REQUEST' as const, status: 'PLANNED' as const },
    { subject: 'Gürültü şikayeti', description: 'Üst kattan gece geç saatlerde gürültü geliyor.', requestType: 'COMPLAINT' as const, status: 'REVIEWING' as const },
    { subject: 'Bahçeye bank konulması', description: 'Bahçeye birkaç bank konulmasını öneriyorum.', requestType: 'SUGGESTION' as const, status: 'COMPLETED' as const },
    { subject: 'Çatı akıtıyor', description: '5. katta tavanda su lekesi oluştu.', requestType: 'FAULT' as const, status: 'AWAITING_REPLY' as const },
  ];

  for (const [i, t] of ticketSeeds.entries()) {
    const unit = units[int(0, units.length - 1)];
    const occ = await prisma.unitOccupancy.findFirst({ where: { siteId, unitId: unit.id } });
    await prisma.ticket.create({
      data: {
        siteId,
        number: i + 1,
        subject: t.subject,
        description: t.description,
        requestType: t.requestType,
        status: t.status,
        priority: t.requestType === 'FAULT' ? 'HIGH' : 'NORMAL',
        channel: 'PORTAL',
        unitId: unit.id,
        personId: occ?.personId,
        departmentId: technicalDept?.id,
        assigneeId: t.status === 'WAITING' ? null : technician.id,
        boardOrder: i,
        date: new Date(Date.now() - int(1, 30) * 86_400_000),
      },
    });
  }

  // --------------------------------------------------------------------- duyuru
  await prisma.announcement.create({
    data: {
      siteId,
      title: 'Yıllık olağan genel kurul toplantısı',
      body:
        'Değerli kat malikleri, yıllık olağan genel kurul toplantımız gelecek ayın ilk cumartesi günü ' +
        'saat 14:00\'te site toplantı salonunda yapılacaktır. Katılımınızı rica ederiz.',
      isPinned: true,
    },
  });

  console.log('\n✓ Demo veri hazır');
  console.log(`  Site      : ${site.name} (${site.district}/${site.city})`);
  console.log(`  Giriş     : ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`  Teknik    : teknik@site.local / Teknik1234!`);
  console.log(`  Daire     : ${units.length}, Kişi: ${people.length}, Talep: ${ticketSeeds.length}`);
}

async function createPerson(siteId: string) {
  const firstName = pick(FIRST_NAMES);
  const lastName = pick(LAST_NAMES);
  return prisma.person.create({
    data: {
      siteId,
      firstName,
      lastName,
      phone: `5${int(300000000, 599999999)}`,
      email: rnd() > 0.25 ? `${slug(firstName)}.${slug(lastName)}${int(1, 999)}@ornek.com` : null,
      language: rnd() > 0.95 ? 'EN' : 'TR',
      inLegalAction: rnd() > 0.97,
    },
  });
}

function slug(value: string): string {
  const map: Record<string, string> = {
    ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u',
    Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u',
  };
  return value
    .split('')
    .map((c) => map[c] ?? c)
    .join('')
    .toLowerCase();
}

main()
  .catch((error) => {
    console.error('Seed hatası:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
