# Site Yönetim Platformu

Çok siteli apartman / site / toplu yapı yönetim yazılımı.
Yönetici paneli + sakin portalı; aidat, cari hesap, sayaç paylaşımı, iş takibi ve
çok kanallı bildirim motoru.

## Yığın

| Katman | Teknoloji |
|---|---|
| Backend | NestJS 10 · TypeScript · Prisma 6 · PostgreSQL 16 |
| Frontend | Next.js 15 (App Router) · React 19 · TanStack Query · Tailwind |
| Kuyruk / önbellek | Redis 7 (BullMQ) |
| Doğrulama | Zod (backend ve frontend aynı şemayı paylaşır) |
| Çalışma ortamı | Docker Compose (postgres · redis · api · web) |

## Hızlı başlangıç

```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Ardından:

```bash
pnpm db:migrate     # şemayı uygula
pnpm db:seed        # demo veri (1 site, 3 blok, 45 daire, 59 kişi)
```

| Adres | Açıklama |
|---|---|
| http://localhost:3100 | Yönetici paneli |
| http://localhost:3101/health | Servis sağlık kontrolü |
| http://localhost:3101/docs | API dokümantasyonu (Swagger) |

Demo giriş: `admin@site.local` / `Admin1234!`
(Teknik personel: `teknik@site.local` / `Teknik1234!`)

> **Not:** 3000/3001 portları bu makinede başka bir proje tarafından
> kullanıldığı için **3100 (web)** ve **3101 (api)** seçilmiştir; `.env` ile
> değiştirilebilir.

## Docker olmadan çalıştırma

```bash
docker compose up -d postgres redis    # yalnızca veritabanı + redis
pnpm install
pnpm build                             # workspace paketlerini derler
pnpm db:migrate && pnpm db:seed
pnpm dev                               # api + web birlikte
```

## Proje yapısı

```
apps/
  api/        NestJS REST API
    src/common/     guard, decorator, Zod pipe
    src/tenant/     AsyncLocalStorage tenant bağlamı
    src/prisma/     tenant filtresi ekleyen Prisma eklentisi
    src/auth/       JWT + site bazlı RBAC
  web/        Next.js panel  (/giris, (panel)/ozet ...)
packages/
  db/         Prisma şeması, migration'lar, seed
  shared/     Zod şemaları, para/tarih yardımcıları, HESAP MOTORLARI
  config/     ortak tsconfig
docker/       api ve web Dockerfile'ları
```

### Hesap motorları (`packages/shared`)

İş kurallarının tamamı **saf fonksiyonlardır** — veritabanına dokunmaz,
tablo bazlı testlerle doğrulanır:

| Dosya | Sorumluluk |
|---|---|
| `money.ts` | Kuruş aritmetiği; **en büyük kalan** yöntemiyle dağıtım (kuruş kaybı yok) |
| `dues.ts` | Aidat dağıtımı (eşit · m² · arsa payı · hisse oranı) |
| `late-fee.ts` | Gecikme tazminatı (KMK m.20: başlayan ay tam sayılır) |
| `meter-calc.ts` | Sayaç paylaşımı: sıcak su yakıt payı, sabit/değişken ısıtma payı, ortak tüketim |

```bash
pnpm test                       # 48 birim testi
```

## Çok kiracılılık (önemli)

Tüm siteler **tek veritabanında**, her tenant tablosunda `siteId` kolonuyla durur.
Üç katmanlı koruma vardır:

1. **AuthGuard** — `X-Site-Id` başlığındaki site için kullanıcının üyeliğini ve
   rolünü doğrular. Üyeliği olmayan site → `403`.
2. **Prisma eklentisi** (`apps/api/src/prisma/prisma.client.ts`) — tenant'lı
   modellerin **her** sorgusuna otomatik `siteId` filtresi ekler. Bir serviste
   filtreyi yazmayı unutmak veri sızdırmaz.
3. **PostgreSQL RLS** — Faz 1 sonunda eklenecek (veritabanı katmanı).

Yeni bir tenant modeli eklerken **`packages/db/src/index.ts` içindeki
`TENANT_MODELS` listesine de eklenmelidir** — aksi halde o model filtrelenmez.

Sistem işleri (seed, cron, siteler arası rapor) `runWithoutTenant()` ile filtreyi
bilinçli olarak devre dışı bırakır.

### İzolasyon testi

```bash
pnpm --filter @sy/api run test:isolation
```

İki site ve iki kullanıcı kurar, B'nin A'ya hiçbir yoldan erişemediğini doğrular
(12 kontrol). Prisma eklentisi veya guard bozulursa bu test kırmızıya döner.

## Faz planı

| Faz | Kapsam | Durum |
|---|---|---|
| 0 | İskelet, Docker, auth + RBAC, çok kiracılılık, seed, panel kabuğu | ✅ tamam |
| 1 | Site/daire/kişi CRUD, cari + evrak defteri, aidat, tahsilat, banka eşleştirme, dashboard | sırada |
| 2 | İş takibi (Kanban), talep detayı, masraf, anket | |
| 3 | Sayaç dağıtım sihirbazı, Excel içe aktarma | |
| 4 | Bildirim motoru (e-posta gerçek; SMS/WhatsApp mock) | |
| 5 | Sakin portalı | |
| 6 | Raporlar, PDF, KVKK maskesi, ödeme skoru | |

## Komutlar

```bash
pnpm dev              # tüm uygulamalar (turbo)
pnpm build            # tümünü derle
pnpm test             # birim testleri
pnpm typecheck        # tip kontrolü
pnpm db:studio        # Prisma Studio
pnpm db:migrate       # yeni migration
pnpm docker:dev       # docker ile tam ortam
```
