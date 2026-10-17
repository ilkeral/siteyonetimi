import { describe, expect, it } from 'vitest';
import { parseDecimalTR, parseReadingSheet, type ReadingSheetUnit } from '../meter-import';

const units: ReadingSheetUnit[] = [
  { unitId: 'a1', blockName: 'A Blok', doorNumber: '1' },
  { unitId: 'a2', blockName: 'A Blok', doorNumber: '2' },
  { unitId: 'b1', blockName: 'B Blok', doorNumber: '1' },
  { unitId: 'c9', blockName: null, doorNumber: '9' },
];

describe('parseDecimalTR', () => {
  it.each([
    ['1.234,56', 1234.56],
    ['1234,5', 1234.5],
    ['1234.5', 1234.5],
    ['1.234.567', 1234567],
    [' 42 ', 42],
    ['0', 0],
  ])('%s → %d', (input, expected) => {
    expect(parseDecimalTR(input)).toBe(expected);
  });

  it.each(['', 'abc', '12a', '1,2,3'])('geçersiz: "%s"', (input) => {
    expect(parseDecimalTR(input)).toBeNull();
  });
});

describe('parseReadingSheet', () => {
  it("Excel'den yapıştırılan sekme ayraçlı listeyi okur", () => {
    const text = 'Blok\tDaire\tÖnceki Okuma\tSon Okuma\nA Blok\t1\t100\t125,5\nA\t2\t\t80';
    const r = parseReadingSheet(text, units);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { unitId: 'a1', line: 2, previousValue: 100, currentValue: 125.5 },
      { unitId: 'a2', line: 3, previousValue: null, currentValue: 80 },
    ]);
  });

  it('Türkçe Excel CSV (noktalı virgül) ve BOM ile çalışır', () => {
    const text = '﻿BLOK;KAPI NO;ENDEKS\r\nB Blok;1;"1.250,75"\r\n';
    const r = parseReadingSheet(text, units);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toMatchObject({ unitId: 'b1', currentValue: 1250.75 });
  });

  it('blok kolonu yoksa tekil kapı numarasını eşler, belirsiz olanı reddeder', () => {
    const r = parseReadingSheet('Daire,Son\n9,10\n1,20', units);
    expect(r.rows.map((row) => row.unitId)).toEqual(['c9']);
    expect(r.errors[0]).toContain('birden çok blokta');
  });

  it('bulunamayan daire, geçersiz sayı ve tekrar eden satırı raporlar', () => {
    const text = 'Blok;Daire;Son\nA;7;10\nA;1;on\nA;2;5\nA Blok;2;6';
    const r = parseReadingSheet(text, units);
    expect(r.rows.map((row) => row.unitId)).toEqual(['a2']);
    expect(r.errors).toEqual([
      '2. satır: A / 7 dairesi bulunamadı',
      '3. satır: son okuma geçersiz ("on")',
      '5. satır: A Blok / 2 dairesi 4. satırda zaten var',
    ]);
  });

  it('zorunlu kolonlar yoksa hata verir', () => {
    expect(parseReadingSheet('Blok;Tutar\nA;5', units).errors[0]).toContain('bulunamadı');
    expect(parseReadingSheet('   \n', units).errors).toEqual(['Dosya boş']);
  });
});
