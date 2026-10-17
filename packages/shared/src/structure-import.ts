/**
 * TOPLU KİŞİ / DAİRE İÇE AKTARMA (saf hesap)
 *
 * Excel'den yapıştırılan (sekme ayraçlı) ya da CSV (`;` / `,`) listeyi okur,
 * doğrular ve mevcut kayıtlarla eşleyip bir PLAN çıkarır. Veritabanına
 * dokunmaz: önizleme de aktarım da aynı planı kullanır.
 *
 * Bir satır = bir daire (+ isteğe bağlı bir kişi ve o kişinin dairedeki sıfatı).
 * Aynı daire birden çok satırda geçebilir (malik + kiracı); aynı kişi birden
 * çok dairede geçebilir (iki dairesi olan malik).
 *
 * Kişi eşleştirme (mevcut kayıtlarla): TC kimlik no; yoksa cep telefonu + ad
 * soyad. Yalnızca adla eşleştirilmez — iki farklı "Ahmet Yılmaz" olabilir.
 * Dosya içinde ise tanımlayıcısı olmayan aynı ad aynı kişi sayılır.
 */
import { detectDelimiter, normalizeBlock, normalizeKey, parseDecimalTR } from './meter-import';
import { isValidNationalId, normalizePhone } from './schemas';

export const STRUCTURE_IMPORT_MAX_ROWS = 2000;

export type OccupancyRole = 'OWNER' | 'TENANT';

export interface ImportPerson {
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  nationalId: string | null;
  role: OccupancyRole;
  startDate: Date | null;
  bankPaymentCode: string | null;
}

export interface StructureRow {
  /** Dosyadaki satır numarası (başlık 1. satır) */
  line: number;
  blockName: string | null;
  doorNumber: string;
  floor: number | null;
  area: number | null;
  landShare: number | null;
  person: ImportPerson | null;
}

export interface RowError {
  line: number;
  message: string;
}

export interface StructureParseResult {
  rows: StructureRow[];
  errors: RowError[];
  /** Tanınan kolonlar (önizlemede gösterilir) */
  columns: string[];
}

const HEADERS = {
  block: ['blok', 'blokadi', 'bina'],
  door: ['daire', 'daireno', 'kapino', 'kapi', 'no', 'bagimsizbolum', 'bbno', 'bagimsizbolumno'],
  floor: ['kat'],
  area: ['m2', 'metrekare', 'alan', 'brutm2', 'brutalan'],
  landShare: ['arsapayi', 'arsa'],
  firstName: ['ad', 'adi', 'isim'],
  lastName: ['soyad', 'soyadi'],
  fullName: ['adsoyad', 'adisoyadi', 'adsoyadi', 'kisi', 'adisoyad'],
  role: ['sifat', 'tip', 'rol', 'malikkiraci', 'durum'],
  phone: ['telefon', 'tel', 'cep', 'ceptelefonu', 'gsm', 'ceptel', 'telefonno'],
  email: ['eposta', 'email', 'mail', 'epostaadresi'],
  nationalId: ['tc', 'tckimlik', 'tckimlikno', 'tcno', 'tckn', 'kimlikno'],
  startDate: ['giristarihi', 'giris', 'baslangic', 'baslangictarihi', 'tasinmatarihi'],
  bankPaymentCode: ['bankaodemekodu', 'odemekodu', 'bankakodu', 'odemeno'],
} as const;

type Field = keyof typeof HEADERS;

const FIELD_LABELS: Record<Field, string> = {
  block: 'Blok',
  door: 'Daire No',
  floor: 'Kat',
  area: 'm²',
  landShare: 'Arsa Payı',
  firstName: 'Ad',
  lastName: 'Soyad',
  fullName: 'Ad Soyad',
  role: 'Sıfat',
  phone: 'Telefon',
  email: 'E-posta',
  nationalId: 'TC Kimlik No',
  startDate: 'Giriş Tarihi',
  bankPaymentCode: 'Banka Ödeme Kodu',
};

const ROLE_WORDS: Record<string, OccupancyRole> = {
  malik: 'OWNER',
  katmaliki: 'OWNER',
  evsahibi: 'OWNER',
  sahip: 'OWNER',
  owner: 'OWNER',
  kiraci: 'TENANT',
  tenant: 'TENANT',
};

/** Tırnak içindeki ayracı ve "" kaçışını bilen tek satır bölücü */
export function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"' && current.trim() === '') {
      quoted = true;
      current = '';
    } else if (char === delimiter) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/** "15.03.2024", "15/03/2024", "2024-03-15" → yerel gece yarısı */
export function parseDateTR(text: string): Date | null {
  const value = text.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(value);
  if (match) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value))) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    return null;
  }
  const date = new Date(y, m - 1, d);
  // 31.02.2024 gibi takvimde olmayan günleri reddet
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseStructureSheet(text: string): StructureParseResult {
  const errors: RowError[] = [];
  const rows: StructureRow[] = [];

  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim() !== '');
  if (headerIndex === -1) return { rows, errors: [{ line: 0, message: 'Liste boş' }], columns: [] };

  const delimiter = detectDelimiter(lines[headerIndex]);
  // "m²" sadeleştirmede "m"ye düşerdi: üst simge önce rakama çevrilir
  const header = splitDelimitedLine(lines[headerIndex], delimiter).map((h) => normalizeKey(h.replace(/²/g, '2')));
  const col = Object.fromEntries(
    (Object.keys(HEADERS) as Field[]).map((field) => [field, header.findIndex((h) => (HEADERS[field] as readonly string[]).includes(h))]),
  ) as Record<Field, number>;
  const columns = (Object.keys(col) as Field[]).filter((f) => col[f] >= 0).map((f) => FIELD_LABELS[f]);

  if (col.door === -1) {
    return { rows, errors: [{ line: headerIndex + 1, message: 'Başlık satırında "Daire No" kolonu bulunamadı' }], columns };
  }

  const dataLines = lines.slice(headerIndex + 1).filter((l) => l.trim() !== '').length;
  if (dataLines > STRUCTURE_IMPORT_MAX_ROWS) {
    return { rows, errors: [{ line: 0, message: `En fazla ${STRUCTURE_IMPORT_MAX_ROWS} satır aktarılabilir (${dataLines} satır var)` }], columns };
  }

  for (let i = headerIndex + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const line = i + 1;
    const cells = splitDelimitedLine(lines[i], delimiter);
    const get = (field: Field) => (col[field] >= 0 ? (cells[col[field]] ?? '').trim() : '');
    const rowErrors: string[] = [];

    const doorNumber = get('door');
    if (!doorNumber) rowErrors.push('daire no boş');

    const number = (field: Field, integer = false): number | null => {
      const raw = get(field);
      if (!raw) return null;
      const value = parseDecimalTR(raw);
      if (value === null || (integer && !Number.isInteger(value))) {
        rowErrors.push(`${FIELD_LABELS[field]} sayı değil: "${raw}"`);
        return null;
      }
      return value;
    };
    const floor = number('floor', true);
    const area = number('area');
    const landShare = number('landShare');
    if (area !== null && area <= 0) rowErrors.push('m² sıfırdan büyük olmalı');

    // ---- kişi
    let firstName = get('firstName');
    let lastName = get('lastName');
    const fullName = get('fullName');
    if (!firstName && !lastName && fullName) {
      // "Ayşe Nur Yılmaz" → ad "Ayşe Nur", soyad "Yılmaz"
      const parts = fullName.split(/\s+/);
      if (parts.length < 2) rowErrors.push(`ad soyad ayrılamadı: "${fullName}"`);
      lastName = parts.pop() ?? '';
      firstName = parts.join(' ');
    }
    const personFields = [firstName, lastName, get('phone'), get('email'), get('nationalId'), get('role'), get('startDate'), get('bankPaymentCode')];
    let person: ImportPerson | null = null;

    if (personFields.some(Boolean)) {
      if (firstName.length < 2 || lastName.length < 2) rowErrors.push('kişi için ad ve soyad (en az 2 harf) zorunlu');

      const rawPhone = get('phone');
      const phone = rawPhone ? normalizePhone(rawPhone) : null;
      if (phone && !/^5\d{9}$/.test(phone)) rowErrors.push(`geçersiz cep telefonu: "${rawPhone}"`);

      const email = get('email') || null;
      if (email && !EMAIL.test(email)) rowErrors.push(`geçersiz e-posta: "${email}"`);

      const nationalId = get('nationalId').replace(/\s/g, '') || null;
      if (nationalId && !isValidNationalId(nationalId)) rowErrors.push(`geçersiz TC kimlik no: "${nationalId}"`);

      const rawRole = get('role');
      const role = rawRole ? ROLE_WORDS[normalizeKey(rawRole)] : 'OWNER';
      if (!role) rowErrors.push(`sıfat "Malik" ya da "Kiracı" olmalı: "${rawRole}"`);

      const rawDate = get('startDate');
      const startDate = rawDate ? parseDateTR(rawDate) : null;
      if (rawDate && !startDate) rowErrors.push(`geçersiz tarih (GG.AA.YYYY): "${rawDate}"`);

      person = {
        firstName,
        lastName,
        phone,
        email: email?.toLowerCase() ?? null,
        nationalId,
        role: role ?? 'OWNER',
        startDate,
        bankPaymentCode: get('bankPaymentCode') || null,
      };
    }

    if (rowErrors.length) {
      for (const message of rowErrors) errors.push({ line, message });
      continue;
    }
    rows.push({ line, blockName: get('block') || null, doorNumber, floor, area, landShare, person });
  }

  return { rows, errors, columns };
}

// ---------------------------------------------------------------- plan

export interface ExistingStructure {
  blocks: { id: string; name: string; isActive: boolean }[];
  units: { id: string; blockId: string | null; doorNumber: string; isActive: boolean }[];
  people: { id: string; firstName: string; lastName: string; phone: string | null; nationalId: string | null }[];
  /** Bugün süren daire ilişkileri */
  occupancies: { unitId: string; personId: string; role: OccupancyRole; personName: string }[];
  /** Site parametresi: zorunlu alanlar */
  required: { phone: boolean; email: boolean; nationalId: boolean };
}

/** Planda bir kayıt: mevcut kimlikle eşleşti ya da dosyadaki anahtarla yeni oluşturulacak */
export type Ref = { existing: string } | { create: string };

export interface PlannedBlock {
  key: string;
  name: string;
}
export interface PlannedUnit {
  key: string;
  block: Ref | null;
  doorNumber: string;
  floor: number | null;
  area: number | null;
  landShare: number | null;
}
export interface PlannedPerson {
  key: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  nationalId: string | null;
}
export interface PlannedOccupancy {
  unit: Ref;
  person: Ref;
  role: OccupancyRole;
  startDate: Date;
  bankPaymentCode: string | null;
}

export interface RowPlan {
  line: number;
  unitLabel: string;
  unitAction: 'create' | 'existing';
  personLabel: string | null;
  personAction: 'create' | 'existing' | null;
  occupancyAction: 'create' | 'existing' | null;
}

export interface StructurePlan {
  blocks: PlannedBlock[];
  units: PlannedUnit[];
  people: PlannedPerson[];
  occupancies: PlannedOccupancy[];
  rows: RowPlan[];
  errors: RowError[];
  summary: {
    newBlocks: number;
    newUnits: number;
    existingUnits: number;
    newPeople: number;
    matchedPeople: number;
    newOccupancies: number;
    existingOccupancies: number;
  };
}

const fold = (text: string) => normalizeKey(text);
const nameKey = (first: string, last: string) => fold(`${first} ${last}`);

export function planStructureImport(rows: readonly StructureRow[], existing: ExistingStructure, today: Date): StructurePlan {
  const errors: RowError[] = [];
  const blocks = new Map<string, PlannedBlock>();
  const units = new Map<string, PlannedUnit>();
  const people = new Map<string, PlannedPerson>();
  const occupancies: PlannedOccupancy[] = [];
  const rowPlans: RowPlan[] = [];
  let matchedPeople = 0;
  let existingOccupancies = 0;
  const matchedIds = new Set<string>();

  const blockByKey = new Map(existing.blocks.map((b) => [normalizeBlock(b.name), b]));
  const unitByKey = new Map(existing.units.map((u) => [`${u.blockId ?? '-'}|${fold(u.doorNumber)}`, u]));
  const personByTc = new Map(existing.people.filter((p) => p.nationalId).map((p) => [p.nationalId!, p]));
  const personByPhoneName = new Map(
    existing.people.filter((p) => p.phone).map((p) => [`${p.phone}|${nameKey(p.firstName, p.lastName)}`, p]),
  );
  /** Dosyada ilk geçişinden sonra aynı kişiye işaret eden anahtar (TC / tel+ad / ad) → planlanan anahtar */
  const filePersonAlias = new Map<string, Ref>();
  /** daire anahtarı|rol → dosyadaki ilk kişi (aynı dairede iki malik olmasın) */
  const fileRoleHolder = new Map<string, { person: string; line: number }>();

  for (const row of rows) {
    const rowErrors: string[] = [];

    // ---------------- blok
    let blockRef: Ref | null = null;
    let blockIdForMatch: string | null = null;
    if (row.blockName) {
      const key = normalizeBlock(row.blockName);
      const found = blockByKey.get(key);
      if (found) {
        if (!found.isActive) rowErrors.push(`${found.name} pasif`);
        blockRef = { existing: found.id };
        blockIdForMatch = found.id;
      } else {
        if (!blocks.has(key)) blocks.set(key, { key, name: row.blockName });
        blockRef = { create: key };
      }
    }

    // ---------------- daire
    const unitLabel = row.blockName ? `${row.blockName} / ${row.doorNumber}` : row.doorNumber;
    const unitKeyFile = `${row.blockName ? normalizeBlock(row.blockName) : '-'}|${fold(row.doorNumber)}`;
    let unitRef: Ref;
    let unitAction: RowPlan['unitAction'];
    const existingUnit = blockRef && 'create' in blockRef ? undefined : unitByKey.get(`${blockIdForMatch ?? '-'}|${fold(row.doorNumber)}`);
    if (existingUnit) {
      if (!existingUnit.isActive) rowErrors.push(`${unitLabel} pasif daire`);
      unitRef = { existing: existingUnit.id };
      unitAction = 'existing';
    } else {
      if (!units.has(unitKeyFile)) {
        units.set(unitKeyFile, { key: unitKeyFile, block: blockRef, doorNumber: row.doorNumber, floor: row.floor, area: row.area, landShare: row.landShare });
      }
      unitRef = { create: unitKeyFile };
      unitAction = 'create';
    }

    // ---------------- kişi
    let personRef: Ref | null = null;
    let personAction: RowPlan['personAction'] = null;
    let occupancyAction: RowPlan['occupancyAction'] = null;
    let personLabel: string | null = null;
    const p = row.person;

    if (p) {
      personLabel = `${p.firstName} ${p.lastName}`;
      if (existing.required.phone && !p.phone) rowErrors.push('site parametresine göre cep telefonu zorunlu');
      if (existing.required.email && !p.email) rowErrors.push('site parametresine göre e-posta zorunlu');
      if (existing.required.nationalId && !p.nationalId) rowErrors.push('site parametresine göre TC kimlik no zorunlu');

      const aliases = [
        p.nationalId ? `tc:${p.nationalId}` : null,
        p.phone ? `tel:${p.phone}|${nameKey(p.firstName, p.lastName)}` : null,
        !p.nationalId && !p.phone ? `ad:${nameKey(p.firstName, p.lastName)}` : null,
      ].filter((a): a is string => !!a);

      const fromFile = aliases.map((a) => filePersonAlias.get(a)).find(Boolean);
      if (fromFile) {
        personRef = fromFile;
        personAction = 'existing' in fromFile ? 'existing' : 'create';
      } else {
        const byTc = p.nationalId ? personByTc.get(p.nationalId) : undefined;
        if (byTc && nameKey(byTc.firstName, byTc.lastName) !== nameKey(p.firstName, p.lastName)) {
          rowErrors.push(`TC kimlik no kayıtlı başka bir kişiye ait (${byTc.firstName} ${byTc.lastName})`);
        }
        // Son çare: aynı dairede aynı sıfatla oturan kişinin adı aynıysa o kişidir
        // (tanımlayıcısız kişinin yeniden aktarımı, telefonu değişmiş kişi).
        // Daire + sıfat + ad birlikte eşleştiği için iki farklı kişi karışmaz.
        const occupant = existingUnit
          ? existing.occupancies.find(
              (o) => o.unitId === existingUnit.id && o.role === p.role && fold(o.personName) === nameKey(p.firstName, p.lastName),
            )
          : undefined;
        const match =
          byTc ??
          (p.phone ? personByPhoneName.get(`${p.phone}|${nameKey(p.firstName, p.lastName)}`) : undefined) ??
          (occupant && !p.nationalId ? existing.people.find((x) => x.id === occupant.personId) : undefined);
        if (match) {
          personRef = { existing: match.id };
          personAction = 'existing';
          if (!matchedIds.has(match.id)) {
            matchedIds.add(match.id);
            matchedPeople++;
          }
        } else {
          const key = aliases[0];
          people.set(key, { key, firstName: p.firstName, lastName: p.lastName, phone: p.phone, email: p.email, nationalId: p.nationalId });
          personRef = { create: key };
          personAction = 'create';
        }
        for (const alias of aliases) filePersonAlias.set(alias, personRef);
      }

      // ---------------- daire ilişkisi
      const personKey = 'existing' in personRef ? personRef.existing : personRef.create;
      const holderKey = `${unitKeyFile}|${p.role}`;
      const holder = fileRoleHolder.get(holderKey);
      const roleName = p.role === 'OWNER' ? 'malik' : 'kiracı';
      if (holder && holder.person !== personKey) {
        rowErrors.push(`${unitLabel} için ${holder.line}. satırda başka bir ${roleName} var`);
      } else if (holder) {
        rowErrors.push(`${holder.line}. satırın tekrarı`);
      } else {
        fileRoleHolder.set(holderKey, { person: personKey, line: row.line });
      }

      const current = existingUnit ? existing.occupancies.filter((o) => o.unitId === existingUnit.id && o.role === p.role) : [];
      const same = 'existing' in personRef && current.find((o) => o.personId === (personRef as { existing: string }).existing);
      if (same) {
        occupancyAction = 'existing';
      } else if (current.length > 0) {
        rowErrors.push(`${unitLabel} dairesinde zaten ${roleName} var: ${current[0].personName} — önce çıkış verin`);
      } else {
        occupancyAction = 'create';
      }

      if (!rowErrors.length) {
        if (occupancyAction === 'create') {
          occupancies.push({
            unit: unitRef,
            person: personRef,
            role: p.role,
            startDate: p.startDate ?? today,
            bankPaymentCode: p.bankPaymentCode,
          });
        } else {
          existingOccupancies++;
        }
      }
    }

    if (rowErrors.length) {
      for (const message of rowErrors) errors.push({ line: row.line, message });
      continue;
    }
    rowPlans.push({ line: row.line, unitLabel, unitAction, personLabel, personAction, occupancyAction });
  }

  const usedUnits = new Set(rowPlans.filter((r) => r.unitAction === 'existing').map((r) => r.unitLabel));
  return {
    blocks: [...blocks.values()],
    units: [...units.values()],
    people: [...people.values()],
    occupancies,
    rows: rowPlans,
    errors,
    summary: {
      newBlocks: blocks.size,
      newUnits: units.size,
      existingUnits: usedUnits.size,
      newPeople: people.size,
      matchedPeople,
      newOccupancies: occupancies.length,
      existingOccupancies,
    },
  };
}
