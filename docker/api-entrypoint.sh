#!/bin/sh
set -e

# Veritabanı şemasını güncelle (idempotent — uygulanmamış migration yoksa hiçbir şey yapmaz)
# RLS kipinde DATABASE_URL tablo sahibi olmayan uygulama rolüdür; migration
# sahip rolle çalışmalı (MIGRATE_DATABASE_URL). Verilmemişse DATABASE_URL.
echo "[entrypoint] prisma migrate deploy"
DATABASE_URL="${MIGRATE_DATABASE_URL:-$DATABASE_URL}" \
  npx --no-install prisma migrate deploy --schema ./prisma/schema.prisma || {
  echo "[entrypoint] migrate deploy başarısız; şema senkronizasyonu atlandı" >&2
}

exec "$@"
