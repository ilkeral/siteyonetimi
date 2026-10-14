import { describe, expect, it } from 'vitest';
import { computeLateFee } from '../late-fee';
import { toMinor } from '../money';

const principal = toMinor(1000); // 1.000,00 TL

describe('computeLateFee', () => {
  it('vadesi gelmemiş borca tazminat işlemez', () => {
    const r = computeLateFee({
      principalMinor: principal,
      dueDate: new Date('2026-08-15'),
      asOf: new Date('2026-08-10'),
      method: 'MONTHLY_PERCENT',
      rate: 5,
    });
    expect(r.amountMinor).toBe(0);
    expect(r.overdueDays).toBe(0);
  });

  it('vade gününde tazminat yoktur', () => {
    const r = computeLateFee({
      principalMinor: principal,
      dueDate: new Date('2026-08-15'),
      asOf: new Date('2026-08-15'),
      method: 'MONTHLY_PERCENT',
      rate: 5,
    });
    expect(r.amountMinor).toBe(0);
  });

  it('1 gün gecikmede başlayan ay tam sayılır (KMK m.20)', () => {
    const r = computeLateFee({
      principalMinor: principal,
      dueDate: new Date('2026-08-15'),
      asOf: new Date('2026-08-16'),
      method: 'MONTHLY_PERCENT',
      rate: 5,
    });
    expect(r.overdueDays).toBe(1);
    expect(r.overdueMonths).toBe(1);
    expect(r.amountMinor).toBe(toMinor(50)); // %5
  });

  it('2 ay gecikmede iki kat uygulanır', () => {
    const r = computeLateFee({
      principalMinor: principal,
      dueDate: new Date('2026-08-15'),
      asOf: new Date('2026-10-14'), // 60 gün
      method: 'MONTHLY_PERCENT',
      rate: 5,
    });
    expect(r.overdueMonths).toBe(2);
    expect(r.amountMinor).toBe(toMinor(100));
  });

  it('grace gün sayısı kadar gecikme affedilir', () => {
    const r = computeLateFee({
      principalMinor: principal,
      dueDate: new Date('2026-08-15'),
      asOf: new Date('2026-08-18'),
      method: 'MONTHLY_PERCENT',
      rate: 5,
      graceDays: 5,
    });
    expect(r.amountMinor).toBe(0);
  });

  it('günlük yöntemde gün × oran uygulanır', () => {
    const r = computeLateFee({
      principalMinor: principal,
      dueDate: new Date('2026-08-15'),
      asOf: new Date('2026-08-25'), // 10 gün
      method: 'DAILY_PERCENT',
      rate: 0.1,
    });
    expect(r.overdueDays).toBe(10);
    expect(r.amountMinor).toBe(toMinor(10)); // %1
  });

  it('NONE yönteminde tazminat hesaplanmaz', () => {
    const r = computeLateFee({
      principalMinor: principal,
      dueDate: new Date('2026-01-01'),
      asOf: new Date('2026-12-31'),
      method: 'NONE',
      rate: 5,
    });
    expect(r.amountMinor).toBe(0);
  });

  it('startDate verilirse vade yerine o tarih esas alınır', () => {
    const r = computeLateFee({
      principalMinor: principal,
      dueDate: new Date('2026-08-15'),
      startDate: new Date('2026-09-01'),
      asOf: new Date('2026-09-10'),
      method: 'MONTHLY_PERCENT',
      rate: 5,
    });
    expect(r.overdueDays).toBe(9);
    expect(r.overdueMonths).toBe(1);
  });

  it('sıfır/negatif anaparada hesaplamaz', () => {
    expect(
      computeLateFee({
        principalMinor: 0,
        dueDate: new Date('2026-01-01'),
        asOf: new Date('2026-06-01'),
        method: 'MONTHLY_PERCENT',
        rate: 5,
      }).amountMinor,
    ).toBe(0);
  });
});
