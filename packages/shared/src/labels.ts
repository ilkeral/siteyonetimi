/**
 * Enum → Türkçe etiket sözlükleri.
 * API (rapor başlıkları) ve Web (tablo/filtre etiketleri) aynı kaynağı kullanır.
 */

export const ROLE_LABELS = {
  SUPER_ADMIN: 'Sistem Yöneticisi',
  SITE_ADMIN: 'Site Yöneticisi',
  ACCOUNTANT: 'Muhasebe',
  TECHNICIAN: 'Teknik Personel',
  SECURITY: 'Güvenlik',
  RESIDENT: 'Sakin',
} as const;

export const OCCUPANCY_ROLE_LABELS = {
  OWNER: 'Kat Maliki',
  TENANT: 'Kiracı',
} as const;

/** Liste kolonlarında kullanılan kısa kod: 4(M) 16(K) */
export const OCCUPANCY_ROLE_SHORT = {
  OWNER: 'M',
  TENANT: 'K',
} as const;

export const UNIT_STATUS_LABELS = {
  OCCUPIED: 'Dolu',
  EMPTY: 'Boş',
  UNDER_RENOVATION: 'Tadilatta',
} as const;

export const ACCOUNT_TYPE_LABELS = {
  PERSON: 'Kişi',
  SUPPLIER: 'Tedarikçi',
  EMPLOYEE: 'Personel',
  CASH: 'Kasa',
  BANK: 'Banka',
} as const;

export const DOCUMENT_TYPE_LABELS = {
  OPENING_BALANCE: 'Açılış Fişi',
  DUES_ACCRUAL: 'Aidat Tahakkuku',
  METER_DISTRIBUTION: 'Sayaç Paylaşımı',
  LATE_FEE: 'Gecikme Tazminatı',
  EXPENSE: 'Gider Faturası',
  INCOME: 'Gelir Evrakı',
  COLLECTION: 'Tahsilat Makbuzu',
  PAYMENT: 'Ödeme',
  TRANSFER: 'Virman',
} as const;

export const DOCUMENT_STATUS_LABELS = {
  DRAFT: 'Taslak',
  POSTED: 'İşlendi',
  CANCELLED: 'İptal',
} as const;

export const DUES_METHOD_LABELS = {
  EQUAL: 'Eşit',
  BY_AREA: 'm² Oranında',
  BY_LAND_SHARE: 'Arsa Payına Göre',
  BY_SHARE_RATIO: 'Hisse Oranına Göre',
} as const;

export const METER_TYPE_LABELS = {
  FUEL: 'Yakıt',
  HOT_WATER: 'Sıcak Su',
  COLD_WATER: 'Soğuk Su',
  COOLING: 'Soğutma',
  ELECTRIC: 'Elektrik',
} as const;

/** Kanban kolon sırası — panonun kolon düzenini bu dizi belirler */
export const TICKET_STATUS_ORDER = [
  'WAITING',
  'REVIEWING',
  'AWAITING_REPLY',
  'FORWARDED',
  'PLANNED',
  'IN_PROGRESS',
  'POSTPONED',
  'COMPLETED',
] as const;

export const TICKET_STATUS_LABELS = {
  WAITING: 'Beklemede',
  REVIEWING: 'İnceleniyor',
  AWAITING_REPLY: 'Cevap Bekleniyor',
  FORWARDED: 'İletildi',
  PLANNED: 'Planlandı',
  IN_PROGRESS: 'Çalışılıyor',
  POSTPONED: 'Ertelendi',
  COMPLETED: 'Tamamlandı',
} as const;

export const TICKET_TYPE_LABELS = {
  COMPLAINT: 'Şikayet',
  FAULT: 'Arıza',
  QUESTION: 'Soru / Bilgi',
  SUGGESTION: 'Öneri',
  REQUEST: 'İstek / Talep',
  SATISFACTION: 'Memnuniyet',
  OTHER: 'Diğer',
} as const;

/** Talep tipi renkleri (Tailwind sınıf adı değil, ham renk — grafik ve rozetler için) */
export const TICKET_TYPE_COLORS = {
  COMPLAINT: '#dc2626',
  FAULT: '#ea580c',
  QUESTION: '#2563eb',
  SUGGESTION: '#16a34a',
  REQUEST: '#7c3aed',
  SATISFACTION: '#0891b2',
  OTHER: '#64748b',
} as const;

export const TICKET_PRIORITY_LABELS = {
  LOW: 'Düşük',
  NORMAL: 'Normal',
  HIGH: 'Yüksek',
  URGENT: 'Acil',
} as const;

export const TICKET_CHANNEL_LABELS = {
  PORTAL: 'Portal üzerinden',
  PHONE: 'Telefon',
  IN_PERSON: 'Yüz yüze',
  EMAIL: 'E-posta',
  OTHER: 'Diğer',
} as const;

export const CHANNEL_LABELS = {
  EMAIL: 'E-Posta',
  SMS: 'SMS',
  PUSH: 'Mobil Bildirim',
  WHATSAPP: 'WhatsApp',
  VOICE: 'Sesli Mesaj',
  POST: 'Posta',
} as const;

export const MESSAGE_STATUS_LABELS = {
  QUEUED: 'Kuyrukta',
  SENDING: 'Gönderiliyor',
  SENT: 'Gönderildi',
  DELIVERED: 'Ulaştı',
  FAILED: 'Başarısız',
} as const;

export const BANK_MATCH_STATUS_LABELS = {
  UNMATCHED: 'Eşleşmedi',
  AUTO_MATCHED: 'Otomatik Eşleşti',
  MANUAL_MATCHED: 'Elle Eşleştirildi',
  IGNORED: 'Yok Sayıldı',
} as const;

export const LANGUAGE_LABELS = {
  TR: 'Türkçe',
  EN: 'İngilizce',
  DE: 'Almanca',
  RU: 'Rusça',
} as const;

export const SITE_TYPE_LABELS = {
  APARTMAN: 'Apartman',
  SITE: 'Site',
  REZIDANS: 'Rezidans',
  IS_MERKEZI: 'İş Merkezi',
  TOPLU_YAPI: 'Toplu Yapı',
} as const;

/** Bildirim gövdesinde kullanılabilecek değişkenler (editördeki etiket butonları) */
export const MERGE_FIELDS = [
  { key: 'adSoyad', label: 'Ad Soyad' },
  { key: 'daireNo', label: 'Daire No' },
  { key: 'blokAdi', label: 'Blok Adı' },
  { key: 'siteAdi', label: 'Site Adı' },
  { key: 'donem', label: 'Dönem' },
  { key: 'borcTutari', label: 'Borç Tutarı' },
  { key: 'sonOdemeTarihi', label: 'Son Ödeme Tarihi' },
  { key: 'gecikmeTazminati', label: 'Gecikme Tazminatı' },
  { key: 'toplamBorc', label: 'Toplam Borç' },
  { key: 'odemeLinki', label: 'Ödeme Linki' },
  { key: 'odemeKodu', label: 'Banka Ödeme Kodu' },
  { key: 'iban', label: 'IBAN' },
] as const;

export type MergeFieldKey = (typeof MERGE_FIELDS)[number]['key'];

// ---------------------------------------------------------------- güvenlik

export const INCIDENT_CATEGORY_LABELS = {
  THEFT: 'Hırsızlık',
  DAMAGE: 'Hasar',
  NOISE: 'Gürültü / Komşuluk',
  TRESPASS: 'İzinsiz Giriş',
  FIRE: 'Yangın / Duman',
  ACCIDENT: 'Kaza / Yaralanma',
  TECHNICAL: 'Teknik (su baskını, elektrik)',
  OTHER: 'Diğer',
} as const;

export const INCIDENT_SEVERITY_LABELS = {
  LOW: 'Düşük',
  MEDIUM: 'Orta',
  HIGH: 'Yüksek',
} as const;

export const LOST_ITEM_STATUS_LABELS = {
  LOST: 'Kayıp Bildirimi',
  FOUND: 'Emanette',
  CLAIMED: 'Sahibi Çıktı',
  DELIVERED: 'Teslim Edildi',
  DISPOSED: 'İmha / Bağış',
} as const;
