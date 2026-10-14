import { describe, expect, it } from 'vitest';
import { allocateDues, type DuesUnitInput } from '../dues';
import { sum, toMinor } from '../money';

const units: DuesUnitInput[] = [
  { unitId: 'd1', area: 120, landShare: 10, shareRatio: 1 },
  { unitId: 'd2', area: 80, landShare: 6, shareRatio: 1 },
  { unitId: 'd3', area: 100, landShare: 8, shareRatio: 2 },
  { unitId: 'd4', area: 100, landShare: 8, shareRatio: 1, isExempt: true },
];

describe('allocateDues', () => {
  it('PER_UNIT kalemi her daireye aynı tutarla yazar', () => {
    const r = allocateDues(units, [
      { duesItemId: 'a', name: 'Aidat', mode: 'PER_UNIT', amountMinor: toMinor(1500) },
    ]);
    // muaf daire hariç 3 daire
    expect(Object.keys(r.byUnit)).toHaveLength(3);
    expect(r.byUnit['d1']).toBe(toMinor(1500));
    expect(r.totalMinor).toBe(toMinor(4500));
  });

  it('muaf daireye tahakkuk yazmaz', () => {
    const r = allocateDues(units, [
      { duesItemId: 'a', name: 'Aidat', mode: 'PER_UNIT', amountMinor: toMinor(1000) },
    ]);
    expect(r.byUnit['d4']).toBeUndefined();
  });

  it('TOTAL kalemi m² oranında böler ve toplamı korur', () => {
    const total = toMinor(30000);
    const r = allocateDues(
      units,
      [{ duesItemId: 'y', name: 'Yakıt', mode: 'TOTAL', amountMinor: total, method: 'BY_AREA' }],
      'EQUAL',
    );
    expect(r.totalMinor).toBe(total);
    // 120 / (120+80+100) = %40
    expect(r.byUnit['d1']).toBe(toMinor(12000));
    expect(r.byUnit['d2']).toBe(toMinor(8000));
    expect(r.byUnit['d3']).toBe(toMinor(10000));
  });

  it('arsa payına göre böler', () => {
    const total = toMinor(2400);
    const r = allocateDues(units, [
      { duesItemId: 'k', name: 'Kalorifer', mode: 'TOTAL', amountMinor: total, method: 'BY_LAND_SHARE' },
    ]);
    // 10/24, 6/24, 8/24
    expect(r.byUnit['d1']).toBe(toMinor(1000));
    expect(r.byUnit['d2']).toBe(toMinor(600));
    expect(r.byUnit['d3']).toBe(toMinor(800));
    expect(sum(Object.values(r.byUnit))).toBe(total);
  });

  it('hisse oranına göre böler', () => {
    const total = toMinor(4000);
    const r = allocateDues(units, [
      { duesItemId: 'h', name: 'Havuz', mode: 'TOTAL', amountMinor: total, method: 'BY_SHARE_RATIO' },
    ]);
    // 1 + 1 + 2 = 4 pay
    expect(r.byUnit['d3']).toBe(toMinor(2000));
    expect(sum(Object.values(r.byUnit))).toBe(total);
  });

  it('m² verisi yoksa eşit böler', () => {
    const noArea: DuesUnitInput[] = [
      { unitId: 'x1' },
      { unitId: 'x2' },
      { unitId: 'x3' },
    ];
    const r = allocateDues(noArea, [
      { duesItemId: 'a', name: 'Aidat', mode: 'TOTAL', amountMinor: 1000, method: 'BY_AREA' },
    ]);
    expect(sum(Object.values(r.byUnit))).toBe(1000);
    expect(Object.values(r.byUnit).sort()).toEqual([333, 333, 334].sort());
  });

  it('birden çok kalemi tek tahakkukta birleştirir', () => {
    const r = allocateDues(units, [
      { duesItemId: 'a', name: 'Aidat', mode: 'PER_UNIT', amountMinor: toMinor(1000) },
      { duesItemId: 'd', name: 'Demirbaş', mode: 'PER_UNIT', amountMinor: toMinor(250) },
      { duesItemId: 'y', name: 'Yakıt', mode: 'TOTAL', amountMinor: toMinor(9000), method: 'BY_AREA' },
    ]);
    expect(r.lines).toHaveLength(9); // 3 daire × 3 kalem
    expect(r.totalMinor).toBe(toMinor(1000 * 3 + 250 * 3 + 9000));
  });

  it('daire yoksa boş sonuç döner', () => {
    const r = allocateDues([], [
      { duesItemId: 'a', name: 'Aidat', mode: 'PER_UNIT', amountMinor: 1000 },
    ]);
    expect(r.totalMinor).toBe(0);
    expect(r.lines).toEqual([]);
  });
});
