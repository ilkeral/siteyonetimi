import { describe, expect, it } from 'vitest';
import {
  distributeByWeights,
  distributeEqually,
  formatTRY,
  fromMinor,
  applyPercent,
  sum,
  toMinor,
} from '../money';

describe('toMinor', () => {
  it.each([
    ['1234.56', 123456],
    ['1.234,56', 123456],
    ['1.234.567,89', 123456789],
    ['0,05', 5],
    [1234.56, 123456],
    ['1.234,56 ₺', 123456],
    ['250', 25000],
  ])('%s → %i kuruş', (input, expected) => {
    expect(toMinor(input as string | number)).toBe(expected);
  });

  it('kayan nokta hatası üretmez', () => {
    expect(toMinor(0.1) + toMinor(0.2)).toBe(toMinor(0.3));
  });

  it('geçersiz değerde hata verir', () => {
    expect(() => toMinor('abc')).toThrow(/Geçersiz tutar/);
  });
});

describe('distributeByWeights', () => {
  it('toplamı daima korur (kuruş kaybolmaz)', () => {
    const amounts = distributeByWeights(10000, [1, 1, 1]);
    expect(sum(amounts)).toBe(10000);
    expect(amounts).toEqual([3334, 3333, 3333]);
  });

  it('ağırlıklara göre orantılı böler', () => {
    const amounts = distributeByWeights(100000, [100, 50, 50]);
    expect(amounts).toEqual([50000, 25000, 25000]);
    expect(sum(amounts)).toBe(100000);
  });

  it('bölünemeyen tutarda en büyük kalana ekler', () => {
    const amounts = distributeByWeights(1000, [1, 2, 4]);
    expect(sum(amounts)).toBe(1000);
  });

  it('tüm ağırlıklar sıfırsa eşit böler', () => {
    expect(distributeByWeights(999, [0, 0, 0])).toEqual([333, 333, 333]);
  });

  it('negatif ve geçersiz ağırlıkları yok sayar', () => {
    const amounts = distributeByWeights(1000, [-5, 10, Number.NaN]);
    expect(sum(amounts)).toBe(1000);
    expect(amounts[1]).toBe(1000);
  });

  it('büyük daire sayısında bile toplamı korur', () => {
    const weights = Array.from({ length: 137 }, (_, i) => i + 1);
    const amounts = distributeByWeights(1_234_567, weights);
    expect(sum(amounts)).toBe(1_234_567);
  });
});

describe('distributeEqually', () => {
  it('artan kuruşları baştan dağıtır', () => {
    expect(distributeEqually(1001, 3)).toEqual([334, 334, 333]);
    expect(sum(distributeEqually(1001, 3))).toBe(1001);
  });
});

describe('applyPercent / formatTRY', () => {
  it('yüzde hesaplar', () => {
    expect(applyPercent(10000, 5)).toBe(500);
    expect(applyPercent(12345, 7.5)).toBe(926);
  });

  it('TR para biçimi üretir', () => {
    expect(formatTRY(123456).replace(/ /g, ' ')).toContain('1.234,56');
  });

  it('fromMinor geri çevirir', () => {
    expect(fromMinor(123456)).toBe(1234.56);
  });
});
