/**
 * GÜVENLİK — SAF KURALLAR
 *
 * Kayıp eşyanın yaşam döngüsü, plaka biçimi ve ziyaret süresi. Veritabanına
 * dokunmaz; servis yalnızca burada izin verilen geçişleri uygular.
 */

// ---------------------------------------------------------------- kayıp eşya

export type LostItemStatus = 'LOST' | 'FOUND' | 'CLAIMED' | 'DELIVERED' | 'DISPOSED';

/**
 * İzin verilen geçişler. Teslim ve imha son durumdur.
 *
 *   LOST ──▶ FOUND ──▶ CLAIMED ──▶ DELIVERED
 *              │  ▲        │
 *              │  └────────┘ (talep reddedildi)
 *              ├──────────────────▶ DELIVERED (sahibi doğrudan geldi)
 *              └──────────────────▶ DISPOSED  (emanet süresi doldu)
 *
 * Sahibi belli olan (CLAIMED) eşya imha edilemez; önce talep reddedilmelidir.
 */
export const LOST_ITEM_TRANSITIONS: Record<LostItemStatus, readonly LostItemStatus[]> = {
  LOST: ['FOUND'],
  FOUND: ['CLAIMED', 'DELIVERED', 'DISPOSED'],
  CLAIMED: ['DELIVERED', 'FOUND'],
  DELIVERED: [],
  DISPOSED: [],
};

/** Bulunan eşya en az bu kadar gün emanette kalmadan imha/bağış yapılamaz */
export const LOST_ITEM_HOLD_DAYS = 30;

/** Kayıt saatindeki küçük saat farkları geleceğe tarih sayılmasın */
const CLOCK_SKEW_MS = 5 * 60_000;

export interface LostItemState {
  status: LostItemStatus;
  foundAt: Date | null;
  loserName: string | null;
  custodianName: string | null;
}

export interface LostItemTransitionInput {
  to: LostItemStatus;
  /** Geçişin gerçekleştiği an (bulunma / teslim / imha); yoksa şimdi */
  at?: Date | null;
  custodianName?: string | null;
  custodianRole?: string | null;
  finderName?: string | null;
  finderPhone?: string | null;
  loserName?: string | null;
  loserPhone?: string | null;
  deliveredTo?: string | null;
  disposalNote?: string | null;
}

export interface TransitionError {
  field: string;
  message: string;
}

export type LostItemTransitionPlan =
  | { ok: true; changes: Record<string, string | Date | null> }
  | { ok: false; errors: TransitionError[] };

const DAY_MS = 86_400_000;

function filled(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Bir geçişin geçerli olup olmadığını denetler ve kayda yazılacak alanları
 * döndürür. Hata varsa hiçbir alan yazılmaz (alan bazlı mesajlar döner).
 */
export function planLostItemTransition(
  item: LostItemState,
  input: LostItemTransitionInput,
  now: Date,
  holdDays = LOST_ITEM_HOLD_DAYS,
): LostItemTransitionPlan {
  if (!LOST_ITEM_TRANSITIONS[item.status].includes(input.to)) {
    return { ok: false, errors: [{ field: 'to', message: 'Bu duruma geçiş yapılamaz' }] };
  }

  const errors: TransitionError[] = [];
  const at = input.at ?? now;
  if (at.getTime() > now.getTime() + CLOCK_SKEW_MS) {
    errors.push({ field: 'at', message: 'Tarih ileri bir zaman olamaz' });
  }
  const changes: Record<string, string | Date | null> = { status: input.to };

  switch (input.to) {
    case 'FOUND': {
      if (item.status === 'LOST') {
        const custodian = filled(input.custodianName) ?? item.custodianName;
        if (!custodian) errors.push({ field: 'custodianName', message: 'Emanetçi zorunlu' });
        changes.foundAt = at;
        changes.custodianName = custodian;
        if (input.custodianRole !== undefined) changes.custodianRole = filled(input.custodianRole);
        if (input.finderName !== undefined) changes.finderName = filled(input.finderName);
        if (input.finderPhone !== undefined) changes.finderPhone = filled(input.finderPhone);
      }
      if (item.status === 'CLAIMED') {
        // Talep reddedildi: eşya emanete döner, bulunma tarihi korunur. Talep
        // edenin adı silinir — kalsaydı sonraki teslimde "sahip" sanılırdı.
        changes.loserName = null;
        changes.loserPhone = null;
      }
      break;
    }
    case 'CLAIMED': {
      const claimant = filled(input.loserName);
      if (!claimant) errors.push({ field: 'loserName', message: 'Talep eden kişinin adı zorunlu' });
      changes.loserName = claimant;
      changes.loserPhone = filled(input.loserPhone);
      break;
    }
    case 'DELIVERED': {
      const receiver = filled(input.deliveredTo);
      if (!receiver) errors.push({ field: 'deliveredTo', message: 'Teslim alan kişi zorunlu' });
      if (item.foundAt && at < item.foundAt) {
        errors.push({ field: 'at', message: 'Teslim tarihi bulunma tarihinden önce olamaz' });
      }
      changes.deliveredTo = receiver;
      changes.deliveredAt = at;
      // Sahibi doğrudan geldiyse (FOUND → DELIVERED) kaybeden olarak da kaydedilir
      if (!item.loserName) {
        changes.loserName = receiver;
        if (input.loserPhone !== undefined) changes.loserPhone = filled(input.loserPhone);
      }
      break;
    }
    case 'DISPOSED': {
      const note = filled(input.disposalNote);
      if (!note) errors.push({ field: 'disposalNote', message: 'İmha / bağış açıklaması zorunlu' });
      const foundAt = item.foundAt;
      if (!foundAt) {
        errors.push({ field: 'at', message: 'Bulunma tarihi olmayan eşya imha edilemez' });
      } else {
        const earliest = new Date(foundAt.getTime() + holdDays * DAY_MS);
        if (at < earliest) {
          errors.push({
            field: 'at',
            message: `Emanet süresi (${holdDays} gün) dolmadan imha edilemez`,
          });
        }
      }
      changes.disposalNote = note;
      changes.disposedAt = at;
      break;
    }
    case 'LOST':
      break;
  }

  return errors.length ? { ok: false, errors } : { ok: true, changes };
}

/** Bulunan eşyanın emanette bekleme süresi (gün) */
export function daysInCustody(foundAt: Date | null, now: Date): number | null {
  if (!foundAt) return null;
  return Math.max(0, Math.floor((now.getTime() - foundAt.getTime()) / DAY_MS));
}

// ---------------------------------------------------------------- plaka

/**
 * "34 abc 123", "34-ABC-123", "34ıbc123" → "34IBC123".
 * Türkçe küçük ı/i ikisi de I olur (plakada İ yoktur); boşluk ve işaretler atılır.
 */
export function normalizePlate(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/[ıi]/g, 'I')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Türkiye plaka biçimi: il kodu 01–81, ardından
 * 1 harf + 4–5 rakam · 2 harf + 3–4 rakam · 3 harf + 2–3 rakam.
 */
const TR_PLATE = /^(0[1-9]|[1-7]\d|8[01])([A-Z]{1,3})(\d{2,5})$/;

function trPlateParts(normalized: string): [string, string, string] | null {
  const match = TR_PLATE.exec(normalized);
  if (!match) return null;
  const [, province, letters, digits] = match;
  const valid =
    (letters.length === 1 && digits.length >= 4 && digits.length <= 5) ||
    (letters.length === 2 && digits.length >= 3 && digits.length <= 4) ||
    (letters.length === 3 && digits.length >= 2 && digits.length <= 3);
  return valid ? [province, letters, digits] : null;
}

export function isTurkishPlate(value: string | null | undefined): boolean {
  return trPlateParts(normalizePlate(value)) !== null;
}

/**
 * Görüntüleme biçimi: "34ABC123" → "34 ABC 123". Türkiye plakası değilse
 * (yabancı, diplomatik) normalize edilmiş hali olduğu gibi döner — reddedilmez.
 */
export function formatPlate(value: string | null | undefined): string {
  const normalized = normalizePlate(value);
  const parts = trPlateParts(normalized);
  return parts ? parts.join(' ') : normalized;
}

// ---------------------------------------------------------------- ziyaretçi

/** Bu süreden uzun içeride görünen ziyaret "çıkışı unutulmuş" sayılır */
export const VISITOR_OVERSTAY_HOURS = 12;

export function visitMinutes(enteredAt: Date, exitedAt: Date | null, now: Date): number {
  const end = exitedAt ?? now;
  return Math.max(0, Math.floor((end.getTime() - enteredAt.getTime()) / 60_000));
}

export function isOverstay(
  enteredAt: Date,
  exitedAt: Date | null,
  now: Date,
  hours = VISITOR_OVERSTAY_HOURS,
): boolean {
  return !exitedAt && now.getTime() - enteredAt.getTime() > hours * 3_600_000;
}

/** 135 → "2 sa 15 dk", 40 → "40 dk", 1600 → "1 gün 2 sa" */
export function formatDuration(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours ? `${days} gün ${hours} sa` : `${days} gün`;
  if (hours > 0) return mins ? `${hours} sa ${mins} dk` : `${hours} sa`;
  return `${mins} dk`;
}
