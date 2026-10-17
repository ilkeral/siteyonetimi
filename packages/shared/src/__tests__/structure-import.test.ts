import { describe, expect, it } from 'vitest';
import {
  parseDateTR,
  parseStructureSheet,
  planStructureImport,
  splitDelimitedLine,
  type ExistingStructure,
} from '../structure-import';

const TC = '10000000146'; // geçerli sağlama haneli
const TODAY = new Date(2026, 9, 17);

const empty: ExistingStructure = {
  blocks: [],
  units: [],
  people: [],
  occupancies: [],
  required: { phone: false, email: false, nationalId: false },
};

const sheet = (...lines: string[]) => lines.join('\n');

describe('satır bölme ve tarih', () => {
  it('tırnak içindeki ayraç ve "" kaçışı', () => {
    expect(splitDelimitedLine('A Blok;"Yılmaz; Ayşe";"5""li"', ';')).toEqual(['A Blok', 'Yılmaz; Ayşe', '5"li']);
  });

  it('Türkçe tarih; takvimde olmayan gün reddedilir', () => {
    expect(parseDateTR('15.03.2024')).toEqual(new Date(2024, 2, 15));
    expect(parseDateTR('2024-03-15')).toEqual(new Date(2024, 2, 15));
    expect(parseDateTR('31.02.2024')).toBe(null);
    expect(parseDateTR('2024/15/03')).toBe(null);
  });
});

describe('liste okuma', () => {
  it('Excel yapıştırması (sekme), esnek başlık, ad soyad ayırma', () => {
    const result = parseStructureSheet(
      sheet(
        'Blok\tDaire No\tKat\tM²\tAd Soyad\tSıfat\tCep Telefonu\tTC Kimlik No\tGiriş Tarihi',
        'A Blok\t1\t1\t110,5\tAyşe Nur Yılmaz\tKat Maliki\t0532 111 22 33\t' + TC + '\t01.06.2020',
        'A Blok\t2\t1\t95\t\t\t\t\t',
      ),
    );
    expect(result.errors).toEqual([]);
    expect(result.columns).toContain('Ad Soyad');
    expect(result.rows[0]).toMatchObject({
      line: 2,
      blockName: 'A Blok',
      doorNumber: '1',
      floor: 1,
      area: 110.5,
      person: { firstName: 'Ayşe Nur', lastName: 'Yılmaz', phone: '5321112233', nationalId: TC, role: 'OWNER' },
    });
    expect(result.rows[0].person?.startDate).toEqual(new Date(2020, 5, 1));
    // kişisiz satır: yalnızca daire
    expect(result.rows[1].person).toBe(null);
  });

  it('CSV (;) ve satır bazlı hatalar', () => {
    const result = parseStructureSheet(
      sheet(
        'Daire;Ad;Soyad;Telefon;TC;Sıfat;Giriş',
        ';Ali;Veli;;;;',
        '3;Ali;;;;;',
        '4;Can;Su;0212 111 22 33;;;',
        '5;Ece;Ak;;12345678901;;',
        '6;Ece;Ak;;;Mal sahibi;',
        '7;Ece;Ak;;;;31.13.2020',
      ),
    );
    expect(result.rows).toEqual([]);
    expect(result.errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(result.errors.find((e) => e.line === 4)?.message).toContain('cep telefonu');
    expect(result.errors.find((e) => e.line === 6)?.message).toContain('Malik');
  });

  it('daire no kolonu yoksa ya da liste boşsa', () => {
    expect(parseStructureSheet('Ad;Soyad\nAli;Veli').errors[0].message).toContain('Daire No');
    expect(parseStructureSheet('   \n').errors[0].message).toBe('Liste boş');
  });
});

describe('aktarım planı', () => {
  it('yeni blok/daire/kişi; iki dairesi olan malik tek kişi; kiracı ayrı', () => {
    const parsed = parseStructureSheet(
      sheet(
        'Blok;Daire;Ad;Soyad;Telefon;Sıfat',
        'C Blok;1;Ali;Veli;05321112233;Malik',
        'C Blok;1;Can;Su;;Kiracı',
        'C Blok;2;Ali;Veli;05321112233;Malik',
        'C Blok;3;;;;',
      ),
    );
    const plan = planStructureImport(parsed.rows, empty, TODAY);
    expect(plan.errors).toEqual([]);
    expect(plan.summary).toMatchObject({ newBlocks: 1, newUnits: 3, newPeople: 2, newOccupancies: 3 });
    expect(plan.occupancies.every((o) => o.startDate === TODAY)).toBe(true);
  });

  it('mevcut kayıtlarla eşleşme: blok adı ("A" = "A Blok"), daire, TC ile kişi; yeniden aktarım kopya üretmez', () => {
    const existing: ExistingStructure = {
      ...empty,
      blocks: [{ id: 'b1', name: 'A Blok', isActive: true }],
      units: [{ id: 'u1', blockId: 'b1', doorNumber: '1', isActive: true }],
      people: [{ id: 'p1', firstName: 'Ayşe', lastName: 'Yılmaz', phone: null, nationalId: TC }],
      occupancies: [{ unitId: 'u1', personId: 'p1', role: 'OWNER', personName: 'Ayşe Yılmaz' }],
    };
    const parsed = parseStructureSheet(sheet('Blok;Daire;Ad;Soyad;TC', `A;1;AYŞE;YILMAZ;${TC}`));
    const plan = planStructureImport(parsed.rows, existing, TODAY);
    expect(plan.errors).toEqual([]);
    expect(plan.rows[0]).toMatchObject({ unitAction: 'existing', personAction: 'existing', occupancyAction: 'existing' });
    expect(plan.summary).toMatchObject({ newBlocks: 0, newUnits: 0, newPeople: 0, matchedPeople: 1, newOccupancies: 0, existingOccupancies: 1 });
  });

  it('tanımlayıcısız kişi: aynı dairede aynı sıfatla oturan aynı adlı kişiyle eşleşir (yeniden aktarım)', () => {
    const existing: ExistingStructure = {
      ...empty,
      units: [{ id: 'u1', blockId: null, doorNumber: '9', isActive: true }],
      people: [{ id: 'p1', firstName: 'Deniz', lastName: 'Ak', phone: null, nationalId: null }],
      occupancies: [{ unitId: 'u1', personId: 'p1', role: 'OWNER', personName: 'Deniz Ak' }],
    };
    const plan = planStructureImport(parseStructureSheet(sheet('Daire;Ad;Soyad', '9;DENİZ;AK')).rows, existing, TODAY);
    expect(plan.errors).toEqual([]);
    expect(plan.rows[0]).toMatchObject({ personAction: 'existing', occupancyAction: 'existing' });
    // başka dairede aynı ad → yeni kişi (yalnız adla eşleşmez)
    const elsewhere = planStructureImport(parseStructureSheet(sheet('Daire;Ad;Soyad', '10;Deniz;Ak')).rows, existing, TODAY);
    expect(elsewhere.summary.newPeople).toBe(1);
  });

  it('yalnızca adla mevcut kişiyle eşleşmez (iki farklı Ahmet Yılmaz olabilir)', () => {
    const existing: ExistingStructure = {
      ...empty,
      people: [{ id: 'p1', firstName: 'Ahmet', lastName: 'Yılmaz', phone: '5320000000', nationalId: null }],
    };
    const plan = planStructureImport(parseStructureSheet(sheet('Daire;Ad;Soyad', '9;Ahmet;Yılmaz')).rows, existing, TODAY);
    expect(plan.summary.newPeople).toBe(1);
  });

  it('çakışmalar: dolu daireye ikinci malik, dosyada aynı dairede iki malik, başkasının TC\'si, pasif daire, zorunlu alan', () => {
    const existing: ExistingStructure = {
      blocks: [{ id: 'b1', name: 'A Blok', isActive: true }],
      units: [
        { id: 'u1', blockId: 'b1', doorNumber: '1', isActive: true },
        { id: 'u2', blockId: 'b1', doorNumber: '2', isActive: false },
      ],
      people: [{ id: 'p1', firstName: 'Ayşe', lastName: 'Yılmaz', phone: null, nationalId: TC }],
      occupancies: [{ unitId: 'u1', personId: 'p1', role: 'OWNER', personName: 'Ayşe Yılmaz' }],
      required: { phone: true, email: false, nationalId: false },
    };
    const parsed = parseStructureSheet(
      sheet(
        'Blok;Daire;Ad;Soyad;Telefon;TC',
        'A;1;Mehmet;Kaya;05321112233;',
        'A;5;Ali;Veli;05321112234;',
        'A;5;Can;Su;05321112235;',
        `A;6;Zeynep;Ak;05321112236;${TC}`,
        'A;2;;;;',
        'A;7;Ece;Ak;;',
      ),
    );
    const plan = planStructureImport(parsed.rows, existing, TODAY);
    const byLine = (line: number) => plan.errors.filter((e) => e.line === line).map((e) => e.message).join(' | ');
    expect(byLine(2)).toContain('zaten malik var: Ayşe Yılmaz');
    expect(byLine(4)).toContain('başka bir malik');
    expect(byLine(5)).toContain('başka bir kişiye ait');
    expect(byLine(6)).toContain('pasif daire');
    expect(byLine(7)).toContain('cep telefonu zorunlu');
    expect(plan.rows.map((r) => r.line)).toEqual([3]);
  });
});
