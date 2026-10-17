import { formatDateTR, formatPeriodTR, toPeriod } from './dates';
import { formatTRY, toMinor } from './money';
import type { AudienceInput } from './schemas';
import type { MergeContext } from './merge-fields';

/**
 * BİLDİRİM MOTORU — saf kurallar
 *
 * Hedef kitle seçimi, alıcı adresinin çıkarılması, kişiye özel birleştirme
 * alanları ve SMS uzunluk hesabı. Veritabanına dokunmaz; servis veriyi toplar,
 * kararı bu fonksiyonlar verir.
 */

export type NotificationChannel = 'EMAIL' | 'SMS' | 'PUSH' | 'WHATSAPP' | 'VOICE' | 'POST';

/**
 * Gönderim sağlayıcısı olan kanallar. PUSH (mobil uygulama) ve POST (basılı
 * mektup) için alıcı adresi tutulmuyor; İkamet Eden Portalı/mobil ile gelecek.
 */
export const SUPPORTED_CHANNELS: readonly NotificationChannel[] = ['EMAIL', 'SMS', 'WHATSAPP', 'VOICE'];

const PHONE_CHANNELS: readonly NotificationChannel[] = ['SMS', 'WHATSAPP', 'VOICE'];

// ------------------------------------------------------------------ telefon

/**
 * Türkiye cep telefonunu E.164 biçimine çevirir: "0532 123 45 67" → "+905321234567".
 * Cep numarası değilse (5 ile başlayan 10 hane) null döner — sabit hatta SMS gitmez.
 */
export function normalizePhoneTR(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0090')) digits = digits.slice(4);
  else if (digits.startsWith('90') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);
  return /^5\d{9}$/.test(digits) ? `+90${digits}` : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase();
  return value && EMAIL_RE.test(value) ? value : null;
}

// -------------------------------------------------------------- hedef kitle

export interface AudiencePerson {
  personId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  phone2: string | null;
  /** Bugün geçerli daire ilişkileri; boşsa sitede oturmuyor */
  roles: ('OWNER' | 'TENANT')[];
  blockIds: string[];
  /** Cari bakiye (kuruş, pozitif = borçlu) */
  balanceMinor: number;
  /** Vadesi geçmiş borç (kuruş) — yalnızca gerektiğinde hesaplanır */
  overdueMinor?: number;
}

export interface AudienceRecipient {
  personId: string;
  fullName: string;
  recipient: string;
  /** 2. telefona giden kopya mı */
  secondary: boolean;
}

export interface AudienceExclusion {
  personId: string;
  fullName: string;
  reason: string;
}

export interface AudienceResult {
  /** Filtrelere uyan kişi sayısı (adresi olmayanlar dahil) */
  matchedCount: number;
  recipients: AudienceRecipient[];
  excluded: AudienceExclusion[];
}

/** Hedef kitle sorgusunu kişi listesine uygular ve kanal adreslerini çıkarır */
export function selectAudience(
  people: readonly AudiencePerson[],
  audience: AudienceInput,
  channel: NotificationChannel,
): AudienceResult {
  if (!SUPPORTED_CHANNELS.includes(channel)) {
    throw new Error(`${channel} kanalı için gönderim sağlayıcısı yok`);
  }

  const blockFilter = audience.blockIds?.length ? new Set(audience.blockIds) : null;
  const customIds = new Set(audience.personIds ?? []);
  const minMinor = audience.minDebt !== undefined ? toMinor(audience.minDebt) : null;
  const maxMinor = audience.maxDebt !== undefined ? toMinor(audience.maxDebt) : null;

  const matched = people.filter((person) => {
    switch (audience.group) {
      case 'CUSTOM':
        if (!customIds.has(person.personId)) return false;
        break;
      case 'OWNERS':
        if (!person.roles.includes('OWNER')) return false;
        break;
      case 'TENANTS':
        if (!person.roles.includes('TENANT')) return false;
        break;
      case 'DEBTORS':
        if (person.balanceMinor <= 0 || person.roles.length === 0) return false;
        break;
      default:
        // Sitede oturmayan (çıkmış) kişilere toplu bildirim gitmez
        if (person.roles.length === 0) return false;
    }
    if (blockFilter && !person.blockIds.some((id) => blockFilter.has(id))) return false;
    if (minMinor !== null && person.balanceMinor < minMinor) return false;
    if (maxMinor !== null && person.balanceMinor > maxMinor) return false;
    if (audience.onlyOverdue && (person.overdueMinor ?? 0) <= 0) return false;
    return true;
  });

  const recipients: AudienceRecipient[] = [];
  const excluded: AudienceExclusion[] = [];
  const seen = new Set<string>();

  const add = (person: AudiencePerson, recipient: string, secondary: boolean) => {
    if (seen.has(recipient)) {
      if (!secondary) {
        excluded.push({
          personId: person.personId,
          fullName: person.fullName,
          reason: 'Aynı adrese başka bir kişi için zaten gönderiliyor',
        });
      }
      return;
    }
    seen.add(recipient);
    recipients.push({ personId: person.personId, fullName: person.fullName, recipient, secondary });
  };

  for (const person of matched) {
    if (channel === 'EMAIL') {
      const email = normalizeEmail(person.email);
      if (email) add(person, email, false);
      else excluded.push({ personId: person.personId, fullName: person.fullName, reason: 'E-posta adresi yok ya da geçersiz' });
      continue;
    }

    if (PHONE_CHANNELS.includes(channel)) {
      const primary = normalizePhoneTR(person.phone);
      const secondary = audience.includeSecondPhone ? normalizePhoneTR(person.phone2) : null;
      if (primary) add(person, primary, false);
      if (secondary && secondary !== primary) add(person, secondary, !!primary);
      if (!primary && !secondary) {
        excluded.push({ personId: person.personId, fullName: person.fullName, reason: 'Geçerli cep telefonu yok' });
      }
    }
  }

  return { matchedCount: matched.length, recipients, excluded };
}

// --------------------------------------------------------- birleştirme alanları

export interface MergeOpenItem {
  type: string;
  period: string | null;
  dueDate: Date | null;
  remainingMinor: number;
}

export interface MergeSource {
  fullName: string;
  siteName: string;
  units: { blockName: string | null; doorNumber: string }[];
  balanceMinor: number;
  /** Kapanmamış borç evrakları; verilmezse dönem/borç alanları bakiyeden türetilir */
  openItems?: MergeOpenItem[];
  paymentCode?: string | null;
  iban?: string | null;
  paymentLink?: string | null;
  now: Date;
}

/**
 * Kişiye özel `MERGE_FIELDS` değerleri.
 *
 *   borcTutari / sonOdemeTarihi / donem → en son vadeli açık borç (tazminat hariç)
 *   gecikmeTazminati → açık tazminat evraklarının kalanı
 *   toplamBorc → cari bakiye (avans varsa 0)
 */
export function buildMergeContext(source: MergeSource): MergeContext {
  const items = source.openItems ?? [];
  const principal = items
    .filter((item) => item.type !== 'LATE_FEE' && item.remainingMinor > 0)
    .sort(
      (a, b) =>
        (b.dueDate?.getTime() ?? 0) - (a.dueDate?.getTime() ?? 0) ||
        (b.period ?? '').localeCompare(a.period ?? ''),
    );
  const latest = principal[0];
  const lateFeeMinor = items
    .filter((item) => item.type === 'LATE_FEE')
    .reduce((acc, item) => acc + Math.max(0, item.remainingMinor), 0);

  const blocks = [...new Set(source.units.map((u) => u.blockName).filter(Boolean))];

  return {
    adSoyad: source.fullName,
    daireNo: source.units.map((u) => u.doorNumber).join(', '),
    blokAdi: blocks.join(', '),
    siteAdi: source.siteName,
    donem: formatPeriodTR(latest?.period ?? toPeriod(source.now)),
    borcTutari: formatTRY(latest ? latest.remainingMinor : Math.max(0, source.balanceMinor)),
    sonOdemeTarihi: latest?.dueDate ? formatDateTR(latest.dueDate) : '',
    gecikmeTazminati: formatTRY(lateFeeMinor),
    toplamBorc: formatTRY(Math.max(0, source.balanceMinor)),
    odemeLinki: source.paymentLink ?? '',
    odemeKodu: source.paymentCode ?? '',
    iban: source.iban ?? '',
  };
}

/** Bu alanlar açık borç evraklarını ister — yalnızca kullanılıyorsa hesaplanır */
export const OPEN_ITEM_FIELDS = ['borcTutari', 'sonOdemeTarihi', 'donem', 'gecikmeTazminati'] as const;

// ---------------------------------------------------------------------- SMS

/** GSM 03.38 temel alfabe (1 birim) */
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
/** Genişletilmiş tablo (kaçış karakteriyle 2 birim) */
const GSM7_EXTENDED = '^{}\\[~]|€\f';

export interface SmsInfo {
  encoding: 'GSM7' | 'UCS2';
  /** Kodlama birimi cinsinden uzunluk */
  length: number;
  segments: number;
  /** Mesaj tek parça değilse parça başına kapasite */
  perSegment: number;
  /** UCS-2'ye düşüren karakterler (ş, ğ, ı, İ …) */
  nonGsmChars: string[];
}

/**
 * SMS parça hesabı. Türkçe ş/ğ/ı/İ GSM-7 temel alfabede olmadığından mesaj
 * UCS-2'ye düşer ve parça 160 yerine 70 karakter olur — maliyeti doğrudan
 * etkiler, editörde gösterilir.
 */
export function smsInfo(text: string): SmsInfo {
  const nonGsm = new Set<string>();
  let gsmLength = 0;
  for (const char of text) {
    if (GSM7_BASIC.includes(char)) gsmLength += 1;
    else if (GSM7_EXTENDED.includes(char)) gsmLength += 2;
    else nonGsm.add(char);
  }

  if (nonGsm.size === 0) {
    const segments = gsmLength === 0 ? 0 : gsmLength <= 160 ? 1 : Math.ceil(gsmLength / 153);
    return { encoding: 'GSM7', length: gsmLength, segments, perSegment: segments > 1 ? 153 : 160, nonGsmChars: [] };
  }

  const length = text.length; // UTF-16 kod birimi
  const segments = length <= 70 ? 1 : Math.ceil(length / 67);
  return { encoding: 'UCS2', length, segments, perSegment: segments > 1 ? 67 : 70, nonGsmChars: [...nonGsm] };
}
