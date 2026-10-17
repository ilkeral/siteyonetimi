import { describe, expect, it } from 'vitest';
import {
  allocateFifo,
  computePaymentScore,
  scoreSegment,
  summarizeScores,
  timingScore,
  type ScoreCredit,
  type ScoreDebt,
} from '../payment-score';

const d = (iso: string) => new Date(`${iso}T12:00:00`);
const asOf = d('2026-10-16');

/** Aylık 1.000 TL aidat, ayın 15'i vade */
const monthly = (months: string[]): ScoreDebt[] =>
  months.map((m) => ({ id: m, date: d(`${m}-01`), dueDate: d(`${m}-15`), amountMinor: 100000, isLateFee: false }));

const pay = (iso: string, amountMinor = 100000, channel: ScoreCredit['channel'] = 'BANK_TRANSFER'): ScoreCredit => ({
  date: d(iso),
  amountMinor,
  channel,
});

describe('allocateFifo', () => {
  it('alacağı en eski vadeli borca uygular, kapanış tarihini verir', () => {
    const r = allocateFifo(monthly(['2026-08', '2026-09']), [pay('2026-09-20', 150000)]);
    expect(r).toEqual([
      { id: '2026-08', paidMinor: 100000, settledAt: d('2026-09-20') },
      { id: '2026-09', paidMinor: 50000, settledAt: null },
    ]);
  });

  it('borcu birden çok tahsilat kapatırsa son tahsilatın tarihi alınır', () => {
    const r = allocateFifo(monthly(['2026-08']), [pay('2026-08-05', 30000), pay('2026-08-10', 70000)]);
    expect(r[0].settledAt).toEqual(d('2026-08-10'));
  });

  it('avans, borcu doğduğu gün kapatmış sayılır', () => {
    const r = allocateFifo(monthly(['2026-09']), [pay('2026-07-01', 100000)]);
    expect(r[0].settledAt).toEqual(d('2026-09-01'));
  });
});

describe('timingScore', () => {
  it.each([
    [10, 5],
    [5, 5],
    [0, 4],
    [-30, 2],
    [-90, 0],
    [-200, 0],
  ])('%d gün → %d', (days, expected) => {
    expect(timingScore(days)).toBeCloseTo(expected);
  });
});

describe('computePaymentScore', () => {
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

  it('her ay vadeden 5 gün önce havaleyle ödeyen tam puan alır', () => {
    const credits = months.map((m) => pay(`${m}-10`));
    const r = computePaymentScore(monthly(months), credits, asOf);
    expect(r.collectionRate).toBe(1);
    expect(r.avgDaysEarly).toBe(5);
    expect(r.score).toBe(5);
  });

  it('elden ödeme dijital kanal payını düşürür', () => {
    const credits = months.map((m) => pay(`${m}-10`, 100000, 'CASH'));
    expect(computePaymentScore(monthly(months), credits, asOf).score).toBe(4.5);
  });

  it('hiç ödemeyenin skoru düşük, gecikme gün sayısı negatif', () => {
    const r = computePaymentScore(monthly(months), [], asOf);
    expect(r.collectionRate).toBe(0);
    expect(r.avgDaysEarly).toBeLessThan(-60);
    expect(r.score).toBeLessThan(1);
    expect(scoreSegment(r.score!)).toBe('LOW');
  });

  it('vadesi gelmemiş borç ve pencere dışı borç skora girmez', () => {
    const debts = [
      ...monthly(['2025-01']), // 6 aydan eski
      { id: 'gelecek', date: d('2026-10-01'), dueDate: d('2026-10-30'), amountMinor: 100000, isLateFee: false },
    ];
    expect(computePaymentScore(debts, [], asOf).score).toBeNull();
  });

  it('gelecek tarihli tahsilat dikkate alınmaz', () => {
    const r = computePaymentScore(monthly(['2026-09']), [pay('2026-10-20')], asOf);
    expect(r.collectionRate).toBe(0);
  });

  it('gecikme tazminatı yükü skoru düşürür, tahsil edileni raporlanır', () => {
    const debts: ScoreDebt[] = [
      ...monthly(['2026-08']),
      { id: 'gt', date: d('2026-09-01'), dueDate: d('2026-09-01'), amountMinor: 10000, isLateFee: true },
    ];
    const credits = [pay('2026-09-10', 110000)];
    const r = computePaymentScore(debts, credits, asOf);
    expect(r.lateFeeCollectedMinor).toBe(10000);
    const clean = computePaymentScore(monthly(['2026-08']), [pay('2026-09-10', 100000)], asOf);
    expect(r.score!).toBeLessThan(clean.score!);
  });
});

describe('summarizeScores', () => {
  it('ortalama ve segmentler; skorsuz kişi sayılmaz', () => {
    const base = { collectionRate: 0, avgDaysEarly: 0, dueMinor: 0, paidMinor: 0, lateFeeCollectedMinor: 0 };
    const ch = (bank: number) => ({ BANK_TRANSFER: bank, CARD: 0, CASH: 0, OTHER: 0 });
    const s = summarizeScores([
      { ...base, score: 4.8, channels: ch(100) },
      { ...base, score: 3, channels: ch(50) },
      { ...base, score: 1.2, channels: ch(0) },
      { ...base, score: null, channels: ch(0) },
    ]);
    expect(s).toMatchObject({ averageScore: 3, scoredCount: 3, highCount: 1, midCount: 1, lowCount: 1 });
    expect(s.channels.BANK_TRANSFER).toBe(150);
  });
});
