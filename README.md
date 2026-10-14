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

### Uçtan uca testler

Çalışan bir API'ye karşı koşarlar; her ikisi de kendi izole test sitesini kurup
sonunda siler, demo veriye dokunmaz.

```bash
pnpm --filter @sy/api run test:isolation   # 12 kontrol — çok kiracılılık sızıntısı
pnpm --filter @sy/api run test:finance     # 30 kontrol — finans döngüsü
```

`test:isolation` iki site ve iki kullanıcı kurar, B'nin A'ya hiçbir yoldan
erişemediğini doğrular. Prisma eklentisi veya guard bozulursa kırmızıya döner.

`test:finance` tüm finans zincirini sınar: tahakkuk → bakiye → kısmi/tam
tahsilat → avans → gecikme tazminatı (ve çift uygulanmaması) → banka ekstresi →
ödeme koduyla otomatik eşleştirme → elle eşleştirme → gider faturası →
pano toplamları → ekstre kapanış bakiyesi.

## Faz planı

| Faz | Kapsam | Durum |
|---|---|---|
| 0 | İskelet, Docker, auth + RBAC, çok kiracılılık, seed, panel kabuğu | ✅ tamam |
| 1 | Kişi/daire yönetimi, cari + evrak defteri, aidat tahakkuku, gecikme tazminatı, tahsilat, banka eşleştirme, pano | ✅ tamam |
| 2 | İş takibi (Kanban), talep detayı, masraf, anket | |
| 3 | Sayaç dağıtım sihirbazı, Excel içe aktarma | |
| 4 | Bildirim motoru (e-posta gerçek; SMS/WhatsApp mock) | |
| 5 | Sakin portalı | |
| 6 | Raporlar, PDF, KVKK maskesi, ödeme skoru | |

## Faz 1'de gelen ekranlar

| Yol | Ekran |
|---|---|
| `/ozet` | Pano: aidat tahsilat grafiği, gelir/gider dağılımı, ödenecek faturalar, kasa pozisyonu |
| `/site` | Kişi listesi (A–Z filtresi, daire rozetleri, bakiye, "sadece borçlular") |
| `/site/[id]` | Kişi kartı: genel bilgiler, daireler, araçlar, cari hesap, talepler, iletişim geçmişi |
| `/finans` | Cari hesap listesi (tip filtresi, bakiye) |
| `/finans/cari/[id]` | Cari hesap ekstresi (yürüyen bakiye, devir, yazdır) |
| `/finans/aidat` | Aidat tahakkuku: kalem tanımı → önizleme → oluştur; geçmiş dönemler |
| `/finans/tahsilat` | Tahsilat makbuzu + carinin açık borçları |
| `/finans/banka` | Ekstre yapıştır-yükle, otomatik eşleştirme, bekleyenleri elle bağla |

### Finans çekirdeğinin kuralları

- **Bakiye saklanmaz**, hareketlerden türetilir (`LedgerService.balanceOf`).
- **Kapatma bağlantısı saklanmaz**: tahsilatlar tek havuz sayılıp borçlara vade
  sırasıyla (FIFO) uygulanır. Bir tahsilat iptal edilince dağıtım kendiliğinden
  yeniden hesaplanır.
- **Evrak iki biçimdedir**: tek hareketli (tahakkuk/fatura — karşı taraf bir
  gelir/gider kategorisi) ya da çok hareketli (tahsilat/ödeme/virman — borç
  toplamı alacak toplamına eşit olmak zorunda, değilse reddedilir).
- **İşlenen evrak değiştirilmez**; düzeltme iptal + yeniden oluşturma ile yapılır.
- Borcun kime yazılacağı `UnitOccupancy`'nin **tarihli ve rollü** ilişkisinden
  çözülür: geçmiş bir dönemin tahakkuku o dönemde oturana yazılır.

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
