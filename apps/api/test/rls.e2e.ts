/**
 * POSTGRESQL RLS TESTİ (çok kiracılılığın 3. katmanı)
 *
 * API gerektirmez; veritabanına doğrudan iki rolle bağlanır:
 *   DATABASE_URL      — tablo sahibi (kurulum/temizlik)
 *   APP_DATABASE_URL  — uygulama rolü (pnpm db:app-role), kurallara tabi
 *
 *   APP_DATABASE_URL=postgresql://sitey_app:...@localhost:5432/sitey pnpm --filter @sy/api run test:rls
 *
 * Yeni bir tenant modeli eklenip RLS kuralı unutulursa ilk kontrol kırmızıya döner.
 */
import { PrismaClient, TENANT_MODELS } from '@sy/db';

const appUrl = process.env.APP_DATABASE_URL;
if (!appUrl) {
  console.error('APP_DATABASE_URL zorunlu (uygulama rolü bağlantısı — pnpm db:app-role)');
  process.exit(1);
}

const owner = new PrismaClient();
const app = new PrismaClient({ datasources: { db: { url: appUrl } } });
const SITE_A = 'TEST RLS A';
const SITE_B = 'TEST RLS B';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

/** Uygulama rolüyle, verilen RLS ayarıyla tek işlemde sorgu */
async function asApp<T>(settings: { siteId?: string; bypass?: boolean }, run: (db: PrismaClient) => Promise<T>): Promise<T> {
  return app.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.site_id', ${settings.siteId ?? ''}, true), set_config('app.bypass_rls', ${settings.bypass ? 'on' : 'off'}, true)`;
    return run(tx as unknown as PrismaClient);
  });
}

async function cleanup() {
  await owner.site.deleteMany({ where: { name: { in: [SITE_A, SITE_B] } } });
}

async function main() {
  console.log('PostgreSQL RLS testi\n');

  // ---------------------------------------------------------- kurallar
  const policies = await owner.$queryRaw<{ tablename: string; rowsecurity: boolean }[]>`
    SELECT p.tablename, c.relrowsecurity AS rowsecurity
    FROM pg_policies p JOIN pg_class c ON c.relname = p.tablename
    WHERE p.policyname = 'tenant_isolation' AND p.schemaname = 'public'`;
  const covered = new Set(policies.filter((p) => p.rowsecurity).map((p) => p.tablename));
  const missing = TENANT_MODELS.filter((model) => !covered.has(model));
  check('Her tenant tablosunda RLS açık ve kural tanımlı', missing.length === 0, `eksik: ${missing.join(', ')}`);

  const [role] = await app.$queryRaw<{ name: string; superuser: boolean; owns: bigint }[]>`
    SELECT current_user AS name, r.rolsuper AS superuser,
      (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user) AS owns
    FROM pg_roles r WHERE r.rolname = current_user`;
  check(
    'Uygulama rolü süper kullanıcı değil ve tablo sahibi değil (yoksa RLS atlanır)',
    !role.superuser && Number(role.owns) === 0,
    JSON.stringify({ ...role, owns: Number(role.owns) }),
  );

  // ---------------------------------------------------------- veri
  await cleanup();
  const a = await owner.site.create({ data: { name: SITE_A, settings: { create: {} } } });
  const b = await owner.site.create({ data: { name: SITE_B, settings: { create: {} } } });
  await owner.person.create({ data: { siteId: a.id, firstName: 'Rls', lastName: 'Akişi' } });
  await owner.person.create({ data: { siteId: b.id, firstName: 'Rls', lastName: 'Bkişi' } });
  const where = { firstName: 'Rls' };

  const unset = await app.person.count({ where });
  check('Ayarsız bağlantı hiçbir site satırı görmüyor', unset === 0, `görünen ${unset}`);

  const scoped = await asApp({ siteId: a.id }, (db) => db.person.findMany({ where, select: { lastName: true } }));
  check('Site ayarıyla yalnızca o sitenin satırı görünüyor', scoped.length === 1 && scoped[0].lastName === 'Akişi');

  // Ham sorgu siteId koşulunu unutsa bile
  const raw = await asApp({ siteId: a.id }, (db) =>
    db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Person" WHERE "firstName" = 'Rls'`,
  );
  check('siteId koşulu unutulmuş ham sorgu da yalnızca kendi sitesini görüyor', Number(raw[0].n) === 1);

  const bypass = await asApp({ bypass: true }, (db) => db.person.count({ where }));
  check('Sistem işi bayrağıyla (bypass) tüm siteler görünüyor', bypass === 2);

  let insertBlocked = false;
  try {
    await asApp({ siteId: a.id }, (db) => db.person.create({ data: { siteId: b.id, firstName: 'Rls', lastName: 'Sızma' } }));
  } catch (error) {
    insertBlocked = String(error).includes('row-level security');
  }
  check('Başka site adına satır eklenemiyor', insertBlocked);

  const moved = await asApp({ siteId: a.id }, (db) =>
    db.person.updateMany({ where: { lastName: 'Bkişi' }, data: { lastName: 'Değişti' } }),
  );
  check('Başka sitenin satırı güncellenemiyor (görünmüyor)', moved.count === 0);

  let reassignBlocked = false;
  try {
    await asApp({ siteId: a.id }, (db) => db.person.updateMany({ where: { lastName: 'Akişi' }, data: { siteId: b.id } }));
  } catch (error) {
    reassignBlocked = String(error).includes('row-level security');
  }
  check('Kendi satırı başka siteye taşınamıyor', reassignBlocked);

  let migrationsHidden = false;
  try {
    await app.$queryRaw`SELECT count(*) FROM "_prisma_migrations"`;
  } catch {
    migrationsHidden = true;
  }
  check('Uygulama rolü migration geçmişine erişemiyor', migrationsHidden);

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
  .finally(async () => {
    await owner.$disconnect();
    await app.$disconnect();
  });
