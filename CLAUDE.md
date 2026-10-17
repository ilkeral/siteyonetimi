# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proje

Çok siteli (multi-tenant) apartman/site yönetim platformu. Apsiyon benzeri bir
ürünün sıfırdan yazımı: aidat tahakkuku, cari hesap defteri, tahsilat, banka
eşleştirme, sayaç paylaşımı, iş takibi ve çok kanallı bildirim.

**Dil:** Kullanıcıya görünen tüm metinler, kod yorumları ve commit mesajları
Türkçedir. Kod tanımlayıcıları (değişken, fonksiyon, tip) İngilizcedir.

## Komutlar

```bash
pnpm install                 # pnpm 12 — yeni paket build script'i isterse: pnpm approve-builds --all --yes
pnpm build                   # turbo: tüm paketler (workspace paketleri dist üretir)
pnpm dev                     # api + web birlikte
pnpm typecheck
pnpm lint                    # yalnızca web (next lint); api'de lint script'i yok
```

### Veritabanı

```bash
docker compose up -d postgres redis   # yalnızca altyapı
pnpm db:migrate                       # yeni migration (prisma migrate dev)
pnpm db:seed                          # demo veri: 1 site, 3 blok, 45 daire, 59 kişi, 10 aylık finansal geçmiş
pnpm db:studio
APP_DB_PASSWORD=... pnpm db:app-role   # RLS için tablo sahibi olmayan uygulama rolü (sitey_app)
```

`DATABASE_URL` host'tan çalışırken `localhost:5432`, konteyner içinden
`postgres:5432` olmalıdır — `.env` içinde iki ayrı değer var
(`DATABASE_URL` / `DATABASE_URL_HOST`).

### Testler

```bash
pnpm test                                       # tüm birim testleri (vitest; api'de *.spec.ts)
pnpm --filter @sy/shared run test               # hesap motorları — 173 test
pnpm --filter @sy/shared exec vitest run src/__tests__/meter-calc.test.ts   # tek dosya
pnpm --filter @sy/shared exec vitest run -t "ortak tüketimi"                # tek test (isimle)

# Uçtan uca — ÇALIŞAN BİR API gerektirir (API_BASE, varsayılan http://localhost:3101)
pnpm --filter @sy/api run test:structure       # 32 kontrol: blok/daire kuralları, doğal sıralama, toplu kişi/daire aktarımı
pnpm --filter @sy/api run test:isolation        # 22 kontrol: çok kiracılılık sızıntısı (ilişki kimlikleri, parametre gövdesi dahil)
pnpm --filter @sy/api run test:finance          # 30 kontrol: tahakkuk→tahsilat→tazminat→banka→pano
pnpm --filter @sy/api run test:tickets          # 39 kontrol: talep→pano→taşıma→masraf→fatura→yetki→izolasyon
pnpm --filter @sy/api run test:meters           # 37 kontrol: taslak→okuma→önizleme→onay→geri alma→tazminat→izolasyon
pnpm --filter @sy/api run test:notifications    # 35 kontrol: şablon→önizleme→kuyruk (hata/yeniden deneme)→zamanlama→izolasyon (Redis gerekir)
pnpm --filter @sy/api run test:portal           # 46 kontrol: sakin varsayılan ret→sakinler arası izolasyon→talep→ödeme→erişim
pnpm --filter @sy/api run test:reports          # 48 kontrol: ekstre+KVKK maskesi→PDF/Excel→yaşlandırma→ödeme skoru→gelir-gider→izolasyon
pnpm --filter @sy/api run test:rls              # 10 kontrol, API gerektirmez: kural kapsamı + uygulama rolüyle RLS (APP_DATABASE_URL)
pnpm --filter @sy/api run test:security         # 55 kontrol: olay→kayıp eşya yaşam döngüsü→ziyaretçi (plaka, TC maskesi)→yetki→izolasyon
```

E2E testleri kendi izole test sitelerini kurar ve sonunda siler; demo veriye
dokunmazlar. `test:isolation` bozulursa tenant izolasyonunda gerçek bir açık
var demektir — görmezden gelmeyin.

### Yerel çalıştırma (Docker'sız)

API'yi host'ta çalıştırırken ortam değişkenleri **zorunludur** (açılışta Zod ile
doğrulanır, eksikse süreç ölür):

```bash
docker compose up -d postgres redis
# apps/api dizininde:
DATABASE_URL=postgresql://sitey:sitey_dev_parola@localhost:5432/sitey?schema=public \
REDIS_URL=redis://localhost:6379 \
JWT_ACCESS_SECRET=<16+ karakter> JWT_REFRESH_SECRET=<16+ karakter> \
API_PORT=3101 CORS_ORIGIN=http://localhost:3100 node dist/main.js
```

**Portlar 3100 (web) / 3101 (api)** — bilinçli seçim; bu makinede 3000/3001
başka bir proje tarafından kullanılıyor.

Demo giriş: `admin@site.local` / `Admin1234!` · sakin portalı: `sakin@site.local` / `Sakin1234!` ·
güvenlik görevlisi: `guvenlik@site.local` / `Guvenlik1234!` (seed'den sonra)

## Mimari

### Monorepo

```
apps/api      NestJS 10 REST API
apps/web      Next.js 15 (App Router) panel
packages/db   Prisma şeması + migration + seed; PrismaClient'ı yeniden ihraç eder
packages/shared  Zod şemaları, TR etiketler ve SAF HESAP MOTORLARI
packages/config  ortak tsconfig
```

`@sy/db` ve `@sy/shared` **dist üretir** (`main` → `dist/index.js`). Ham `.ts`
göstermeye çalışmak çalışma anında `ERR_MODULE_NOT_FOUND` verir; API'yi
çalıştırmadan önce bu paketler derlenmiş olmalı (`pnpm build`).

### Çok kiracılılık — üç katman

Veri tek veritabanında, her tenant tablosunda `siteId` ile durur.

1. **`AuthGuard`** (`apps/api/src/auth/auth.guard.ts`) — `X-Site-Id` başlığını
   doğrular: site var mı, aktif mi, kullanıcının o sitede üyeliği ve rolü ne.
   Üyeliği olmayan site → 403.
2. **Prisma eklentisi** (`apps/api/src/prisma/prisma.client.ts`) — tenant'lı
   modellerin **her** sorgusuna otomatik `siteId` filtresi enjekte eder.
   Bir serviste `where: { siteId }` yazmayı unutmak veri sızdırmaz.
3. **PostgreSQL RLS** (`DB_RLS=on`, varsayılan kapalı) — migration
   `row_level_security` her tenant tablosuna `tenant_isolation` kuralı koyar:
   satır yalnızca `"siteId" = current_setting('app.site_id')` ya da
   `app.bypass_rls = 'on'` ise görünür/yazılır. Açıkken eklenti her sorguyu
   ayarla aynı işlemde çalıştırır; servisin `$transaction`'ında ayar işlemin
   ilk komutudur. **Kurallar yalnızca tablo sahibi olmayan rolle bağlanınca
   işler** (`pnpm db:app-role`; sahip ve süper kullanıcı RLS'yi atlar —
   `test:rls` bunu da denetler). Migration'lar sahip rolle
   (`MIGRATE_DATABASE_URL`). Maliyet: istek başına ~7–11 ms.

> **Eklenti yazma gövdesindeki ilişki kimliklerini de denetler**
> (`apps/api/src/prisma/foreign-refs.ts`): `unitId`, `personId`,
> `connect: { id }` ve iç içe `create` içindeki kimlikler başka bir siteye
> aitse işlem 400 ile reddedilir. Gerekçe: `include` ile okunan ilişkiler
> filtrelenmez; yabancı bir kayda bağlanan satır onu sızdırırdı. Denetim
> "bu siteye ait mi" değil "başka siteye ait mi" diye sorar — aynı
> işlemde yeni oluşturulup henüz commit edilmemiş kayıtlar reddedilmesin.
> `siteId` taşımayan modellerde (TicketComment.ticketId) de çalışır.

> **Ham gövdeyi veritabanına vermeyin.** Her yazma uç noktası katı bir Zod
> şemasıyla doğrulanır; `runWithoutTenant` içinde gövde yayılırsa (`...body`)
> `siteId` taşıma ve iç içe yazma (`site: { update }`) mümkün olur.

> **Sakin (RESIDENT) varsayılan olarak reddedilir.** `AuthGuard`, sakini
> yalnızca `@Roles('RESIDENT')` taşıyan uç noktalara geçirir. Rol listesi
> olmayan bir panel uç noktası (ör. `GET /people`) yazmak güvenlidir —
> personele açık, sakine kapalıdır. Portal servislerinde (`portal.service.ts`)
> her sorgu ayrıca `requirePersonId()` ile oturumun kişisine daraltılır:
> aynı sitedeki başka sakinin verisi de görünmemelidir.

> **Yeni tenant modeli eklerken `packages/db/src/index.ts` içindeki
> `TENANT_MODELS` listesine de ekleyin** ve bir migration ile RLS kuralını
> (`ENABLE ROW LEVEL SECURITY` + `tenant_isolation`) yazın. Unutulursa o
> model filtrelenmez ve siteler arası sızar; `test:rls` eksik kuralı yakalar.

> **RLS açıkken interaktif `$transaction` içinde daima `tx` kullanın.** Kök
> istemci (`this.db`) ayarsız bir bağlantıya gider ve hiçbir site satırı
> görmez — sızıntı değil, hata olarak ortaya çıkar. Global bir modelin
> sorgusu da ilişki üzerinden site tablolarını okuyabildiği için RLS
> kipinde **her** sorgu sarılır.

Aktif site/kullanıcı `AsyncLocalStorage`'da taşınır
(`apps/api/src/tenant/tenant.context.ts`). Sistem işleri (seed, cron, siteler
arası rapor) `runWithoutTenant()` ile filtreyi bilinçli olarak kapatır —
üyelik ve site sorguları gibi global tablolara erişim de bunu kullanır.

### Finans çekirdeği

Tek yazma kapısı `apps/api/src/finance/ledger.service.ts`. Kuralları:

- **Tutarlar servise kuruş (tam sayı) olarak girer/çıkar.** `Decimal` çevrimi
  yalnızca `ledger.service.ts` içindeki `decimal()` / `toMinorDecimal()`
  yardımcılarında yapılır. Kayan nokta aritmetiği hiçbir hesapta kullanılmaz.
- **Bakiye saklanmaz**, daima `LedgerEntry` toplamından türetilir.
- **Kapatma bağlantısı da saklanmaz, türetilir:** carinin tüm alacak hareketleri
  tek havuz sayılıp borç evraklarına vade sırasıyla (FIFO) uygulanır. Bir
  tahsilat iptal edilince dağıtım kendiliğinden yeniden hesaplanır.
- **Evrak iki biçimden biridir:** tek hareketli (tahakkuk/fatura — karşı taraf
  bir gelir/gider *kategorisi*) ya da çok hareketli (tahsilat/ödeme/virman —
  borç toplamı alacak toplamına **eşit olmak zorunda**, değilse reddedilir).
- **İşlenen (POSTED) evrak değiştirilmez**; düzeltme iptal + yeniden oluşturma
  ile yapılır.

Borcun kime yazılacağı `UnitOccupancy`'nin **tarihli ve rollü** ilişkisinden
çözülür (`pickResponsible`, `dues.service.ts`): geçmiş bir dönemin tahakkuku o
dönemde oturana yazılır, bugünküne değil.

### Saf hesap motorları (`packages/shared`)

İş kurallarının tamamı veritabanına dokunmayan saf fonksiyonlardır; tablo bazlı
testlerle sabitlenmiştir. Yeni bir hesap kuralı eklerken **önce buraya yazın**,
sonra servisten çağırın.

| Dosya | Sorumluluk |
|---|---|
| `money.ts` | Kuruş aritmetiği; **en büyük kalan** yöntemiyle dağıtım — dağıtılan tutarların toplamı daima girilen tutara eşittir |
| `dues.ts` | Aidat dağıtımı (eşit · m² · arsa payı · hisse oranı) |
| `late-fee.ts` | Gecikme tazminatı (KMK m.20: başlayan ay tam sayılır) |
| `board.ts` | Kanban kolon içi sıralama (`planBoardMove`), gecikme kuralı (`isTicketOverdue`) |
| `meter-calc.ts` | Sayaç paylaşımı: sıcak suyun yakıt payı (ΔT / alt ısı değeri), sabit+değişken ısıtma payı, ortak tüketim, okuması olmayan daire için ortalama+ceza. Yakıt satırları `component` ile ayrılır |
| `notifications.ts` | Hedef kitle seçimi (gerekçeli ayıklama), TR cep telefonu → E.164, kişiye özel birleştirme alanları, SMS parça hesabı (GSM-7 / UCS-2) |
| `payment-score.ts` | Ödeme skoru (0–5): FIFO kapatma tarihleri, tahsilat oranı/zamanlama/tazminat/dijital kanal; segmentler; kıyas eşiği |
| `income-statement.ts` | Gelir-gider (tahakkuk esaslı, kategori × ay, net) ve kasa+banka nakit akışı; ay aralığı |
| `kvkk.ts` | KVKK maskesi: ad, TC, telefon, e-posta, IBAN; metindeki adlar (Türkçe + ASCII duyarsız) |
| `security.ts` | Kayıp eşya durum makinesi (`planLostItemTransition`, emanet süresi), TR plaka normalize/biçim, ziyaret süresi ve "çıkışı unutulmuş" kuralı |
| `structure-import.ts` | Toplu kişi/daire listesi okuma (tırnaklı CSV, esnek TR başlık, TR tarih/ondalık) ve aktarım planı (kişi eşleştirme, çakışma) |
| `payments.ts` | Kart doğrulama (Luhn, son kullanma), maskeleme — kart verisi saklanmaz |
| `meter-import.ts` | Excel'den yapıştırılan / CSV okuma listesini dairelerle eşleme, Türkçe ondalık okuma |

Aynı dosyalar Zod şemalarını da barındırır (`schemas.ts`): API doğrulaması ve
frontend form doğrulaması **aynı şemayı** kullanır.

### Frontend

- **Tailwind yok.** Arayüz, ThemeForest **Bizzark** temasının derlenmiş CSS'i
  (Bootstrap 4 + Material Design Kit) üzerine kuruludur.
- Tema dosyaları `apps/web/public/theme/` altında, `<link>` ile yüklenir
  (`src/app/layout.tsx`), webpack'e sokulmaz. Sıra: `app.css` → ikonlar →
  `custom.css`.
- **`app.css` asla elle düzenlenmez.** Tüm ezmeler `custom.css`'te.
- **`<html dir="ltr">` zorunlu:** tema RTL desteği için her kuralı
  `[dir=ltr] .x` biçiminde üretmiş.
- **Bu yüzden tema kuralları (0,2,0) özgüllüğünde.** Kendi düzen kurallarınızı
  da `[dir] .sy-x` biçiminde yazın; aksi halde `position: fixed` gibi tanımlar
  sessizce ezilir (navbar/sidebar akışa düşer). Benzer şekilde tema bazı
  bileşenleri `display: none` ile gizler — alt menüler `open` sınıfı ister.
- `custom.css` değiştiğinde `layout.tsx` içindeki **`THEME_VERSION`** sabitini
  artırın; `public/` dosyaları hash'lenmediği için tarayıcı eskisini kullanır.
- **`StatCard`** telefonda (<576 px) ikonu gizler ve tutarı küçültür: iki
  sütunlu yerleşimde "₺1.048.725,00" gibi bölünemeyen tutar sayfayı taşırıyordu.
- **Material Icons fontu eski:** `how_to_reg`, `apartment`, `speed`,
  `payments`, `dark_mode` gibi yeni adlar fontta yok ve ikon yerine ad
  metin olarak basılır (dar ekranda sayfayı taşırır). Yeni ikon eklerken
  tarayıcıda genişliğini ölçün: gerçek ikon tam 1em'dir.
- Koyu mod temada yoktu; `html[data-theme="dark"]` altında yüzey değişkenleri
  (`--sy-surface`, `--sy-border`, …) değiştirilerek eklendi. **Varsayılan daima
  açık tema** — işletim sisteminin `prefers-color-scheme` tercihi bilinçli
  olarak takip edilmez.
- API istemcisi `src/lib/api.ts`: access token + `X-Site-Id` ekler, 401'de
  refresh ile bir kez yeniler, 403 + "site" mesajında bayat site seçimini
  temizleyip girişe yollar.

## Faz durumu

| Faz | Kapsam | Durum |
|---|---|---|
| 0 | İskelet, Docker, auth + RBAC, çok kiracılılık, seed | ✅ |
| 1 | Kişi/daire, cari defter, aidat, gecikme tazminatı, tahsilat, banka eşleştirme, pano | ✅ |
| 2 | İş Takibi (Kanban) | ✅ |
| 3 | Sayaç paylaşım sihirbazı | ✅ |
| 4 | Bildirim motoru | ✅ |
| 5 | Sakin portalı | ✅ |
| 6 | Raporlar, PDF, KVKK maskesi, ödeme skoru | ✅ |
| 7 | Güvenlik (olaylar, kayıp eşya, ziyaretçi) | ✅ |

Çalışan API modülleri yalnızca `Prisma, Auth, Sites, Finance, People, Tickets, Meters, Notifications, Portal, Reports, Security`
(`apps/api/src/app.module.ts`). Menüde `ready: false` olan modüller
(`apps/web/src/components/sidebar.tsx`) görünür ama tıklanamaz.

### Tamamlanmamış fazlarda neyin hazır olduğu

Prisma şeması **tüm fazların modellerini şimdiden içerir** ve hesap motorları
ile Zod şemalarının bir kısmı yazılmış/testlidir. Yeni faza başlarken sıfırdan
başlamayın — aşağıdakileri kullanın.

**Faz 2 — İş Takibi (bitti, notlar)**
- `TicketComment` / `TicketExpense` / `TicketSurveyResponse` `siteId` taşımaz,
  `TENANT_MODELS`'te değildir. Bunlara erişim **daima** önce talebi tenant
  filtreli okuyarak (`requireTicket`) ya da `ticket: { siteId }` koşuluyla
  yapılır (`tickets.service.ts`).
- Talep uç noktaları sınıf düzeyinde `@Roles` ile personele kapalıdır;
  `RESIDENT` erişemez (sakin talepleri Faz 5 portalından gelecek). Masrafı
  gider faturasına çevirmek yalnızca `SITE_ADMIN`/`ACCOUNTANT`.
- Panoda tamamlananlar yalnızca son 30 gün; tamamı `/teknik/liste`'de.
- Eksik: talep eki yükleme (`TicketAttachment` — dosya depolama yok),
  departman yönetim ekranı (`POST/PUT /departments` uç noktaları var).

**Faz 3 — Sayaç paylaşımı (bitti, notlar)**
- `MainMeterReading` / `UnitMeterReading` `siteId` taşımaz; erişim daima
  önce dağıtımı tenant filtreli okuyarak (`requireDistribution`) yapılır,
  okumalardaki `unitId`'ler siteye ait mi diye ayrıca sayılır.
- Dönem başına tek dağıtım (`@@unique([siteId, period])`). Onaylı dağıtım
  değiştirilmez; **geri alma** evrakları iptal edip taslağa döndürür. Sonraki
  dönem onaylıysa geri alma engellenir (onun "önceki okumaları" bundan gelir).
- "Önceki okuma" saklanmayan alanlarda son onaylı dönemin son okumasından
  önerilir. Okuması olmayan daire tahmin edilir; tahmini tutar okuma satırına
  yazılmaz, yalnızca evrakta/önizlemede görünür.
- Dağıtımın `applyLateFee` / `lateFeeStartDate` alanları gecikme
  tazminatında uygulanır (`late-fee.service.ts`): kapalıysa sayaç evrakına
  tazminat işlenmez.
- Okuma girişi `TECHNICIAN` açık; oluşturma, parametreler, onay ve geri alma
  yalnızca `SITE_ADMIN`/`ACCOUNTANT`.
- Eksik: `.xlsx` doğrudan okunmuyor (Excel'den yapıştırma ve CSV var);
  `Meter` kayıtlarını (seri no, çarpan) yöneten ekran yok — çarpan varsa
  hesapta kullanılıyor; dağıtıma yakıt/su faturası evrakı bağlama
  (`fuelInvoiceDocumentId` …) kullanılmıyor.

**Faz 4 — Bildirim motoru (bitti, notlar)**
- Kuyruk **BullMQ** (`notifications/notification.queue.ts`), işleyici API
  sürecinin içinde çalışır; Redis yoksa gönderim yapılmaz (health `degraded`).
  İş yalnızca kimlik taşır, içerik `NotificationMessage` satırındadır.
- İşleyicide HTTP bağlamı yok: her iş `runWithTenant({ siteId })` ile çalışır,
  Prisma eklentisi kuyrukta da site filtresi uygular.
- Mesaj sahiplenme `QUEUED → SENDING` atomik `updateMany` ile; iptal edilen
  kampanyanın mesajları işleyicide atlanır. Kalıcı sağlayıcı hatası
  (`ProviderError.permanent`) yeniden denenmez, geçici olan 3 kez denenir.
- Hedef kitle **gönderim anında** çözülür (zamanlanmış "borçlulara" o anki
  borçlulara gider). Açık borç evrakları yalnızca `onlyOverdue` ya da
  `borcTutari/sonOdemeTarihi/donem/gecikmeTazminati` kullanılıyorsa okunur.
- Sağlayıcılar: e-posta `MAIL_DRIVER=log|smtp`; SMS/WhatsApp/sesli **mock** —
  `…9999` ile biten numara kalıcı, `…8888` ilk denemede geçici hata verir.
- Yalnızca `SITE_ADMIN`/`ACCOUNTANT`. PUSH ve POST kanalı reddedilir (sağlayıcı yok).
- Eksik: `{{odemeLinki}}` boş (ödeme Faz 5), teslim raporu (DELIVERED)
  webhook'u yok, KVKK/ileti izni (İYS) kontrolü yok, kişinin diline göre
  şablon seçimi yok (kampanya tek metin).

**Faz 5 — Sakin portalı (bitti, notlar)**
- Web: `apps/web/src/app/(portal)/portal/*` (özet, hesap, talepler, duyurular,
  mesajlar, ödeme, profil). Giriş sonrası rol `RESIDENT` ise `/portal`'a,
  değilse `/ozet`'e gidilir (`homePath`); panel düzeni sakini portala geri yollar.
- Portal erişimi kişi kartından verilir (`/people/:id/portal-access`): yeni
  hesapta geçici parola **yalnızca yanıtta** döner, saklanmaz/loglanmaz.
  Personel e-postası sakine bağlanamaz; personel parolası buradan sıfırlanamaz.
- Çevrimiçi ödeme **mock** (`PAYMENT_DRIVER=mock`): Luhn + son kullanma
  doğrulanır, `…0002` kartı reddedilir (402). Başarılıysa sitenin ilk aktif
  BANK hesabına tahsilat makbuzu kesilir; evrakta yalnızca son 4 hane.
  `{{odemeLinki}}` → `PUBLIC_WEB_URL` (yoksa `CORS_ORIGIN`) + `/portal/odeme`.
- Sakin talepte yalnızca `isPublic` yorumları görür, personel adı "Yönetim"
  olarak gösterilir; masraf ve işlem geçmişi dönmez.
- Çıkışta ve girişte React Query önbelleği temizlenir (`useLogout`) — aynı
  sekmede giren sonraki kullanıcı öncekinin rolünü/verisini görmesin.
- Eksik: gerçek ödeme kuruluşu (3D Secure) entegrasyonu ve ödeme isteğinde
  idempotency anahtarı; sakinin kendi iletişim bilgisini güncellemesi;
  e-postayla davet/parola sıfırlama bağlantısı (şimdilik yönetici geçici
  parolayı iletir); PWA/mobil bildirim (PUSH kanalı).

**Faz 6 — Raporlar (bitti, notlar)**
- `apps/api/src/reports/`: çoklu cari ekstresi, borç yaşlandırma, ödeme
  skoru; JSON + PDF (`pdf.ts`, pdfkit). PDF'te Helvetica Türkçe karakter
  içermez → **DejaVu** (`dejavu-fonts-ttf`) gömülür; tutarlar "TL" ile.
- **KVKK maskesi varsayılan AÇIK** (`mask=true`), maskeleme sunucuda yapılır.
  Ad eşleştirme Türkçe küçük harf + ASCII katlama ile: bankanın "AYSE
  YILMAZ"ı da yakalanır (JS `i` bayrağı I/ı'yı bilmez). Her PDF dışa
  aktarımı `AuditLog`'a `EXPORT` + maske bilgisiyle yazılır.
- Tahsilat kanalı `Document.paymentChannel` (kasa → CASH, banka → BANK_TRANSFER,
  portal → CARD); eski kayıtlar migration'da geriye dönük dolduruldu.
- Ödeme skoru `PaymentScore` (kişi) / `SitePaymentScore` (site) tablolarında
  günlük anlık görüntü. BullMQ `upsertJobScheduler` ile her gece 03:00
  (`TZ`) tüm siteler; "Şimdi Hesapla" yalnızca `SITE_ADMIN`. Siteler arası
  kıyas en az 3 site varsa döner (`BENCHMARK_MIN_SITES`).
- CORS `exposedHeaders: Content-Disposition` — PDF dosya adını istemci okur.
- **Gelir-gider** (`/raporlar/gelir-gider`, en fazla 24 ay): gelir, tahakkuk
  edildiği ayda sayılır (aidat/sayaç/tazminat evrakı), gider faturası gider
  kategorisine göre. Kasa/banka bacağı tahakkuk tarafında sayılmaz (çift sayım
  olmasın). Nakit bölümü kasa+banka hareketleridir; **virman hariç**. Dönem
  sonu nakit = kasa+banka gerçek bakiyesi (testte doğrulanır). Kategorisiz
  kayıt evrak türü adıyla görünür. PDF'te 12 aydan uzun dönem 12'şer aylık
  tablolara bölünür.
- **Excel** (`exceljs`): ekstre, yaşlandırma, gelir-gider. Tutarlar metin değil
  sayıdır (TL); maske PDF'tekiyle aynı. PDF ve Excel tablosu aynı satır
  modelinden üretilir (`income-statement-table.ts`). Her Excel dışa aktarımı
  da `EXPORT` + `format: 'xlsx'` ile denetim kaydına yazılır.
- Eksik: bütçe (planlanan/gerçekleşen — şemada bütçe modeli yok), rapor
  görüntüleyicide arama/zoom (tarayıcının PDF görüntüleyicisine bırakıldı),
  PDF'i e-postayla gönderme (bildirim motoruna ek desteği yok).

**Faz 7 — Güvenlik (bitti, notlar)**
- `apps/api/src/security/`, web `/guvenlik/*` (özet, ziyaretçiler, olay
  kayıtları, kayıp eşya). Yalnızca `SITE_ADMIN` + `SECURITY`; silme yalnızca
  yönetici. Olayı açan görevli dışında yalnızca yönetici düzenler.
  `SECURITY` rolü girişte `/guvenlik`'e düşer (`homePath`).
- Kayıp eşya: `LOST → FOUND → CLAIMED → DELIVERED`, emanetteyken `DISPOSED`
  (en az `LOST_ITEM_HOLD_DAYS` = 30 gün). Durum **yalnızca**
  `POST /lost-items/:id/transition` ile değişir; geçiş eski durum koşullu
  `updateMany` ile yazılır (eşzamanlı iki teslimden biri 409 alır).
  Reddedilen talep (CLAIMED → FOUND) talep edenin adını siler. Geçmiş
  `AuditLog`'dan okunur. Yalnızca LOST kaydı silinebilir.
- Ziyaretçi TC kimlik no **hiçbir yanıtta ve denetim kaydında açık dönmez**
  (`nationalIdMasked`); yalnızca 11 hane tam eşleşmeyle aranır. Plaka
  normalize saklanır (`34ABC123`), sitedeki `Vehicle` plakalarıyla
  normalize karşılaştırılır; durumu "yasaklı" olan araçta giriş açılır ama
  uyarı döner. 12 saati aşan açık ziyaret "çıkışı unutulmuş" işaretlenir.
- Olay metni düz metindir (HTML yorumlanmaz, `white-space: pre-wrap`).
- Eksik: ziyaretçi TC'si için saklama süresi/otomatik silme (KVKK politikası
  kararı bekliyor), eşya fotoğrafı (`photoPath` — dosya depolama yok),
  sakinin portaldan kayıp bildirmesi / bulunan eşyaları görmesi, araç
  (`Vehicle`) yönetim ekranı, emanet süresinin site parametresi olması.

### Diğer tamamlanmamış işler

- **RLS varsayılan kapalı.** Tüm uçtan uca testler RLS açık (`sitey_app` +
  `DB_RLS=on`) da geçiyor; üretimde açılması önerilir. Bağlantı havuzu
  (PgBouncer) kullanılacaksa *transaction* kipinde olmalı — ayar işlem içi
  (`set_config(..., true)`) yapıldığı için oturum kipine gerek yok.
- **Site parametreleri** (`/tanimlar/parametreler`, `siteSettingsSchema`)
  yalnızca gerçekten okunan alanları düzenler. Şemada olup hiçbir yerde
  okunmayanlar: `fiscalStart*`, `dueDayOfMonth`, `defaultCashAccountId`,
  `requireDeviceOnTicket`, `communicationLanguages`, `paymentAllocationRule`
  (kapatma daima FIFO), `customFieldLabels`, `policyTexts`. Bunları ekrana
  koymadan önce hesapta kullanın.
- Kişi/daire formları var (`/site/yeni`, kişi kartında düzenle/daire
  bağla/çıkış ver/araç, `/site/daireler`'de daire ve blok). Daire ilişkisi
  arayüzden **silinmez**, çıkış tarihi verilir — geçmiş dönem borcu bu
  tarihli kayıtlardan çözülür.
- **Pasife alma:** aktif oturanı olan daire pasife alınamaz (pasif daireye
  aidat/sayaç tahakkuku yapılmaz — borçlanma sessizce durmasın); aktif
  dairesi olan blok pasife alınamaz; pasif bloktaki daire blok açılmadan
  etkinleşmez. `GET /units?active=false|all`, `GET /blocks?active=all`.
- Daire listesi **uygulamada doğal sıralanır** (`Intl.Collator numeric`):
  `doorNumber` metin olduğundan veritabanı sıralaması "10" < "2" verirdi.
- **Toplu aktarım** (`/site/ice-aktar`, yalnızca `SITE_ADMIN`): önizleme ve
  aktarım aynı saf planı kullanır; aktarım planı işlemin içinde yeniden
  hesaplar, **tek hata varsa hiçbir şey yazmaz**, toplu `createMany` ile yazar
  (kimlikler uygulamada üretilir). Kişi mevcut kayıtla TC ya da telefon+ad ile
  eşleşir; yalnızca adla eşleşmez — tek istisna aynı dairede aynı sıfatla
  oturan aynı adlı kişi (yeniden aktarım kopya üretmesin). Mevcut daire/kişi
  bilgisi değiştirilmez. CSV Windows-1254 de okunur (`lib/files.ts`).
  Gövde sınırı bu yüzden 1 MB (`main.ts`). Eksik: `.xlsx` doğrudan okuma.
- **Projede prettier yapılandırması yok** — `npx prettier --write` dosyayı
  varsayılan stile (çift tırnak, 80 kolon) çevirir. Kullanmayın; mevcut stil
  tek tırnak, ~120 kolon.
- Bloksuz dairelerde daire no tekrarı uygulamada engellenir
  (`assertDoorFree`): `@@unique([siteId, blockId, doorNumber])` NULL blokta
  çalışmaz.

## Dikkat

- `demo/` lisanslı ThemeForest tema kaynağıdır, `.gitignore`'dadır. Kullanılan
  parçalar `apps/web/public/theme` altına kopyalanmıştır.
- Site içi ilişkiler Prisma'da `onDelete: Cascade`'dir; "hareketi olan cari
  silinemez" gibi kurallar uygulama katmanında uygulanır
  (`PeopleService.deactivate`). Veritabanı kısıtına taşımayın — site silme
  kilitlenir.
- Para biçimlendirme yalnızca `apps/web/src/lib/format.ts` ve
  `packages/shared/money.ts` üzerinden yapılır.
