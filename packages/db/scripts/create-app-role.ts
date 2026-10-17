/**
 * UYGULAMA VERİTABANI ROLÜ (RLS için)
 *
 * PostgreSQL satır düzeyi güvenlik (RLS) tablo sahibine ve süper kullanıcıya
 * uygulanmaz. API'nin kurallara tabi olması için tablo sahibi OLMAYAN, yalnızca
 * okuma/yazma yetkili ayrı bir rolle bağlanması gerekir. Bu betik o rolü
 * oluşturur (varsa parolasını günceller) ve yetkileri verir. İdempotenttir.
 *
 *   DATABASE_URL=<sahip/migration bağlantısı> APP_DB_PASSWORD=... pnpm db:app-role
 *
 * Sonra API: DATABASE_URL=<sitey_app bağlantısı> DB_RLS=on
 * Migration'lar yine sahip rolüyle çalışır (MIGRATE_DATABASE_URL).
 */
import { PrismaClient } from '@prisma/client';

const role = process.env.APP_DB_USER ?? 'sitey_app';
const password = process.env.APP_DB_PASSWORD;

if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
  throw new Error('APP_DB_USER yalnızca küçük harf, rakam ve alt çizgi içerebilir');
}
if (!password || password.length < 12) {
  throw new Error('APP_DB_PASSWORD zorunlu (en az 12 karakter)');
}

const prisma = new PrismaClient();

async function main() {
  const [{ owner }] = await prisma.$queryRaw<{ owner: string }[]>`SELECT current_user AS owner`;
  const exists = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_roles WHERE rolname = ${role}`;

  // Parola literal'i format(%L) ile kaçırılır — elle birleştirme yok
  const [{ sql }] = await prisma.$queryRaw<{ sql: string }[]>`
    SELECT format(${exists[0].n > 0n ? 'ALTER ROLE %I LOGIN PASSWORD %L' : 'CREATE ROLE %I LOGIN PASSWORD %L'}, ${role}::text, ${password}::text) AS sql`;
  await prisma.$executeRawUnsafe(sql);

  const db = (await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`)[0].db;
  const statements = [
    `GRANT CONNECT ON DATABASE "${db}" TO ${role}`,
    `GRANT USAGE ON SCHEMA public TO ${role}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    // Migration geçmişi uygulamanın işi değil
    `REVOKE ALL ON TABLE "_prisma_migrations" FROM ${role}`,
    // Sonraki migration'ların açacağı tablolara da yetki
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE "${owner}" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
  ];
  for (const statement of statements) await prisma.$executeRawUnsafe(statement);

  console.log(`✓ ${role} rolü hazır (tablo sahibi: ${owner}). API'yi bu rolle ve DB_RLS=on ile çalıştırın.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
