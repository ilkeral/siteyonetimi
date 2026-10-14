#!/bin/sh
set -e

# Veritabanı şemasını güncelle (idempotent — uygulanmamış migration yoksa hiçbir şey yapmaz)
echo "[entrypoint] prisma migrate deploy"
npx --no-install prisma migrate deploy --schema ./prisma/schema.prisma || {
  echo "[entrypoint] migrate deploy başarısız; şema senkronizasyonu atlandı" >&2
}

exec "$@"
