/**
 * YENİ SİTENİN VARSAYILAN TANIMLARI
 *
 * Platform ya da müşteri sahibi yeni site açtığında oluşturulur. Finans
 * çekirdeği kategorileri ADIYLA arar ("Aidat Geliri", "Gecikme Tazminatı") —
 * bu adlar değiştirilirse aidat/tazminat evrakı kategorisiz kalır.
 * (Demo verisi `packages/db/prisma/seed.ts` aynı listeleri kullanır.)
 */

export const DUES_INCOME_CATEGORY = 'Aidat Geliri';
export const LATE_FEE_INCOME_CATEGORY = 'Gecikme Tazminatı';

export const DEFAULT_INCOME_CATEGORIES = [
  DUES_INCOME_CATEGORY,
  'Demirbaş Geliri',
  LATE_FEE_INCOME_CATEGORY,
  'Kira Geliri',
  'Diğer Gelirler',
] as const;

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Personel Gideri',
  'Elektrik',
  'Su',
  'Doğalgaz',
  'Asansör Bakım',
  'Temizlik',
  'Güvenlik',
  'Bahçe Bakım',
  'Tamir Onarım',
  'Demirbaş',
  'Sigorta',
  'Diğer Giderler',
] as const;

export const DEFAULT_DEPARTMENTS = ['Teknik', 'Temizlik', 'Güvenlik', 'Yönetim'] as const;

/** Tutarlar yönetim tarafından girilir; kalemler yalnızca iskelet */
export const DEFAULT_DUES_ITEMS = [
  { name: 'Aidat', distributionMethod: 'EQUAL' },
  { name: 'Demirbaş', distributionMethod: 'EQUAL' },
] as const;

export const DEFAULT_NOTIFICATION_TEMPLATES = [
  {
    channel: 'EMAIL',
    name: 'Aidat Borcu Bilgilendirme',
    subject: '{{siteAdi}} — {{donem}} dönemi aidat bilgilendirmesi',
    body:
      'Sayın {{adSoyad}},\n\n{{daireNo}} nolu daireye ait {{donem}} dönemi aidat borcunuz {{borcTutari}} tutarındadır.\n' +
      'Son ödeme tarihi: {{sonOdemeTarihi}}\n\nÖdeme yapmak için: {{odemeLinki}}\n\nSite Yönetimi',
  },
  {
    channel: 'SMS',
    name: 'Aidat Hatırlatma',
    subject: null,
    body: '{{siteAdi}}: {{donem}} aidat borcunuz {{borcTutari}}. Son ödeme {{sonOdemeTarihi}}. Ödeme: {{odemeLinki}}',
  },
] as const;
