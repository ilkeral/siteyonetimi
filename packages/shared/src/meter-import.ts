/**
 * SAYAÇ OKUMASI İÇE AKTARMA
 *
 * Excel'den kopyalanıp yapıştırılan (sekme ayraçlı) ya da CSV olarak kaydedilen
 * (Türkçe Excel'de `;` ayraçlı) okuma listesini daire kayıtlarıyla eşler.
 * Saf fonksiyondur; dosya okuma ve kayıt işlemi çağıranın işidir.
 *
 * Beklenen başlıklar (büyük/küçük harf ve Türkçe karakter duyarsız):
 *   Blok (isteğe bağlı) · Daire / Kapı No (zorunlu) ·
 *   Önceki / İlk Okuma (isteğe bağlı) · Son / Güncel / Okuma / Endeks (zorunlu)
 */

export interface ReadingSheetUnit {
  unitId: string;
  blockName: string | null;
  doorNumber: string;
}

export interface ParsedReading {
  unitId: string;
  /** Dosyadaki satır numarası (1'den başlar, başlık dahil) */
  line: number;
  /** Dosyada önceki okuma kolonu yoksa null — mevcut değer korunur */
  previousValue: number | null;
  currentValue: number;
}

export interface ReadingSheetResult {
  rows: ParsedReading[];
  errors: string[];
}

/**
 * Türkçe ya da uluslararası biçimdeki sayıyı okur.
 *   "1.234,56" → 1234.56   "1234,5" → 1234.5   "1234.5" → 1234.5
 *   "1.234.567" → 1234567  (birden çok nokta binlik ayraçtır)
 * Virgül varsa noktalar binlik ayraç sayılır. Tek nokta ondalıktır.
 */
export function parseDecimalTR(text: string): number | null {
  let value = text.trim().replace(/\s/g, '');
  if (!value) return null;

  if (value.includes(',')) {
    value = value.replace(/\./g, '').replace(',', '.');
  } else if ((value.match(/\./g) ?? []).length > 1) {
    value = value.replace(/\./g, '');
  }

  if (!/^-?\d+(\.\d+)?$/.test(value)) return null;
  return Number(value);
}

/** Başlık ve blok adlarını karşılaştırmak için sadeleştirir */
export function normalizeKey(text: string): string {
  return text
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/[^a-z0-9]/g, '');
}

/** "A Blok" ile "A" aynı blok sayılır */
export function normalizeBlock(text: string): string {
  return normalizeKey(text).replace(/blok$/, '').replace(/^blok/, '');
}

const HEADERS = {
  block: ['blok', 'blokadi'],
  door: ['daire', 'daireno', 'kapino', 'kapi', 'no', 'bagimsizbolum', 'bbno'],
  previous: ['onceki', 'oncekiokuma', 'ilk', 'ilkokuma', 'oncekiendeks', 'ilkendeks'],
  current: ['son', 'sonokuma', 'guncel', 'guncelokuma', 'okuma', 'endeks', 'sonendeks'],
} as const;

export function detectDelimiter(line: string): string {
  if (line.includes('\t')) return '\t';
  if (line.includes(';')) return ';';
  return ',';
}

export function parseReadingSheet(text: string, units: ReadingSheetUnit[]): ReadingSheetResult {
  const errors: string[] = [];
  const rows: ParsedReading[] = [];

  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim() !== '');
  if (headerIndex === -1) return { rows, errors: ['Dosya boş'] };

  const delimiter = detectDelimiter(lines[headerIndex]);
  const header = lines[headerIndex].split(delimiter).map(normalizeKey);
  const column = (names: readonly string[]) => header.findIndex((h) => names.includes(h));

  const col = {
    block: column(HEADERS.block),
    door: column(HEADERS.door),
    previous: column(HEADERS.previous),
    current: column(HEADERS.current),
  };

  if (col.door === -1 || col.current === -1) {
    return {
      rows,
      errors: ['Başlık satırında "Daire" ve "Son Okuma" kolonları bulunamadı'],
    };
  }

  // Kapı numarası → daireler (aynı numara farklı bloklarda olabilir)
  const byDoor = new Map<string, ReadingSheetUnit[]>();
  for (const unit of units) {
    const key = normalizeKey(unit.doorNumber);
    byDoor.set(key, [...(byDoor.get(key) ?? []), unit]);
  }

  const seen = new Map<string, number>();

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue;
    const lineNo = i + 1;
    const cells = raw.split(delimiter).map((cell) => cell.trim().replace(/^"(.*)"$/, '$1'));

    const door = cells[col.door] ?? '';
    const block = col.block >= 0 ? (cells[col.block] ?? '') : '';
    if (!door) {
      errors.push(`${lineNo}. satır: daire numarası boş`);
      continue;
    }

    let candidates = byDoor.get(normalizeKey(door)) ?? [];
    if (block) {
      candidates = candidates.filter(
        (unit) => normalizeBlock(unit.blockName ?? '') === normalizeBlock(block),
      );
    }

    const label = block ? `${block} / ${door}` : door;
    if (candidates.length === 0) {
      errors.push(`${lineNo}. satır: ${label} dairesi bulunamadı`);
      continue;
    }
    if (candidates.length > 1) {
      errors.push(`${lineNo}. satır: ${label} birden çok blokta var, "Blok" kolonu ekleyin`);
      continue;
    }

    const currentText = cells[col.current] ?? '';
    const currentValue = parseDecimalTR(currentText);
    if (currentValue === null) {
      errors.push(`${lineNo}. satır: son okuma geçersiz ("${currentText}")`);
      continue;
    }

    let previousValue: number | null = null;
    if (col.previous >= 0 && (cells[col.previous] ?? '').trim() !== '') {
      previousValue = parseDecimalTR(cells[col.previous]);
      if (previousValue === null) {
        errors.push(`${lineNo}. satır: önceki okuma geçersiz ("${cells[col.previous]}")`);
        continue;
      }
    }

    const unit = candidates[0];
    const duplicateOf = seen.get(unit.unitId);
    if (duplicateOf !== undefined) {
      errors.push(`${lineNo}. satır: ${label} dairesi ${duplicateOf}. satırda zaten var`);
      continue;
    }
    seen.set(unit.unitId, lineNo);

    rows.push({ unitId: unit.unitId, line: lineNo, previousValue, currentValue });
  }

  return { rows, errors };
}
