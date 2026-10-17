import { describe, expect, it } from 'vitest';
import { buildCashFlow, buildIncomeStatement, monthOf, monthRange } from '../income-statement';

describe('ay aralığı', () => {
  it('yıl geçişi dahil, iki uç dahil', () => {
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthRange('2026-05', '2026-05')).toEqual(['2026-05']);
  });

  it('ters ya da bozuk aralık reddedilir', () => {
    expect(() => monthRange('2026-05', '2026-04')).toThrow();
    expect(() => monthRange('2026-13', '2026-14')).toThrow();
  });

  it('yerel saatle ay', () => {
    expect(monthOf(new Date(2026, 0, 31, 23, 59))).toBe('2026-01');
  });
});

describe('gelir-gider tablosu', () => {
  const months = ['2026-01', '2026-02', '2026-03'];

  it('kategori × ay, toplamlar ve net', () => {
    const report = buildIncomeStatement(
      [
        { kind: 'INCOME', label: 'Aidat', month: '2026-01', amountMinor: 100_000 },
        { kind: 'INCOME', label: 'Aidat', month: '2026-01', amountMinor: 50_000 },
        { kind: 'INCOME', label: 'Aidat', month: '2026-03', amountMinor: 150_000 },
        { kind: 'INCOME', label: 'Gecikme Tazminatı', month: '2026-02', amountMinor: 1_234 },
        { kind: 'EXPENSE', label: 'Elektrik', month: '2026-01', amountMinor: 80_000 },
        { kind: 'EXPENSE', label: 'Temizlik', month: '2026-02', amountMinor: 200_000 },
      ],
      months,
    );
    expect(report.income).toEqual([
      { label: 'Aidat', byMonth: [150_000, 0, 150_000], totalMinor: 300_000 },
      { label: 'Gecikme Tazminatı', byMonth: [0, 1_234, 0], totalMinor: 1_234 },
    ]);
    expect(report.incomeTotal).toEqual({ byMonth: [150_000, 1_234, 150_000], totalMinor: 301_234 });
    expect(report.expenseTotal.totalMinor).toBe(280_000);
    // Şubat zararda
    expect(report.net).toEqual({ byMonth: [70_000, -198_766, 150_000], totalMinor: 21_234 });
  });

  it('aralık dışı satır ve sıfırlanan kalem (iade) düşer', () => {
    const report = buildIncomeStatement(
      [
        { kind: 'INCOME', label: 'Aidat', month: '2025-12', amountMinor: 999 },
        { kind: 'INCOME', label: 'Kira', month: '2026-01', amountMinor: 500 },
        { kind: 'INCOME', label: 'Kira', month: '2026-01', amountMinor: -500 },
      ],
      months,
    );
    expect(report.income).toEqual([]);
    expect(report.net.totalMinor).toBe(0);
  });
});

describe('nakit durumu', () => {
  it('dönem başı + giriş − çıkış = ay sonu bakiyeleri', () => {
    const flow = buildCashFlow(
      10_000,
      [
        { direction: 'IN', label: 'Tahsilat Makbuzu', month: '2026-01', amountMinor: 5_000 },
        { direction: 'OUT', label: 'Ödeme', month: '2026-02', amountMinor: 12_000 },
        { direction: 'IN', label: 'Tahsilat Makbuzu', month: '2026-03', amountMinor: 1_000 },
      ],
      ['2026-01', '2026-02', '2026-03'],
    );
    expect(flow.closingByMonth).toEqual([15_000, 3_000, 4_000]);
    expect(flow.closingMinor).toBe(flow.openingMinor + flow.inflowTotal.totalMinor - flow.outflowTotal.totalMinor);
  });
});
