import { describe, expect, it } from 'vitest';
import {
  daysInCustody,
  formatDuration,
  formatPlate,
  isOverstay,
  isTurkishPlate,
  normalizePlate,
  planLostItemTransition,
  visitMinutes,
  type LostItemState,
} from '../security';

const NOW = new Date('2026-10-16T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const found: LostItemState = { status: 'FOUND', foundAt: daysAgo(10), loserName: null, custodianName: 'Güvenlik' };

describe('kayıp eşya yaşam döngüsü', () => {
  it('kayıp bildirimi bulununca emanetçi zorunlu, bulunma tarihi yazılır', () => {
    const lost: LostItemState = { status: 'LOST', foundAt: null, loserName: 'Ayşe Yılmaz', custodianName: null };
    const missing = planLostItemTransition(lost, { to: 'FOUND' }, NOW);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.map((e) => e.field)).toEqual(['custodianName']);

    const ok = planLostItemTransition(lost, { to: 'FOUND', custodianName: ' Ali Kaya ', finderName: 'Bahçıvan' }, NOW);
    expect(ok).toEqual({
      ok: true,
      changes: { status: 'FOUND', foundAt: NOW, custodianName: 'Ali Kaya', finderName: 'Bahçıvan' },
    });
  });

  it('izin verilmeyen geçişler reddedilir', () => {
    const lost: LostItemState = { status: 'LOST', foundAt: null, loserName: 'A', custodianName: null };
    expect(planLostItemTransition(lost, { to: 'DELIVERED', deliveredTo: 'A' }, NOW).ok).toBe(false);
    expect(planLostItemTransition({ ...found, status: 'DELIVERED' }, { to: 'FOUND' }, NOW).ok).toBe(false);
    expect(planLostItemTransition({ ...found, status: 'DISPOSED' }, { to: 'FOUND' }, NOW).ok).toBe(false);
    // sahibi belli olan eşya imha edilemez
    const claimed = { ...found, status: 'CLAIMED' as const, foundAt: daysAgo(100) };
    expect(planLostItemTransition(claimed, { to: 'DISPOSED', disposalNote: 'x' }, NOW).ok).toBe(false);
  });

  it('talep: talep edenin adı zorunlu', () => {
    expect(planLostItemTransition(found, { to: 'CLAIMED', loserName: '  ' }, NOW).ok).toBe(false);
    expect(planLostItemTransition(found, { to: 'CLAIMED', loserName: 'Mehmet', loserPhone: '05321234567' }, NOW)).toEqual({
      ok: true,
      changes: { status: 'CLAIMED', loserName: 'Mehmet', loserPhone: '05321234567' },
    });
  });

  it('reddedilen talep emanete döner, talep eden silinir', () => {
    const claimed: LostItemState = { ...found, status: 'CLAIMED', loserName: 'Sahte Sahip' };
    expect(planLostItemTransition(claimed, { to: 'FOUND' }, NOW)).toEqual({
      ok: true,
      changes: { status: 'FOUND', loserName: null, loserPhone: null },
    });
  });

  it('doğrudan teslimde teslim alan kaybeden olarak da yazılır', () => {
    const plan = planLostItemTransition(found, { to: 'DELIVERED', deliveredTo: 'Zeynep Ak' }, NOW);
    expect(plan).toEqual({
      ok: true,
      changes: { status: 'DELIVERED', deliveredTo: 'Zeynep Ak', deliveredAt: NOW, loserName: 'Zeynep Ak' },
    });
    // talep edilmişse kaybeden değişmez
    const claimed: LostItemState = { ...found, status: 'CLAIMED', loserName: 'Mehmet' };
    const viaClaim = planLostItemTransition(claimed, { to: 'DELIVERED', deliveredTo: 'Mehmet (kardeşi Ali)' }, NOW);
    expect(viaClaim.ok && viaClaim.changes.loserName).toBe(undefined);
  });

  it('teslim tarihi bulunmadan önce ya da ileride olamaz', () => {
    const before = planLostItemTransition(found, { to: 'DELIVERED', deliveredTo: 'X', at: daysAgo(20) }, NOW);
    expect(before.ok).toBe(false);
    const future = planLostItemTransition(found, { to: 'DELIVERED', deliveredTo: 'X', at: new Date(NOW.getTime() + 3_600_000) }, NOW);
    expect(future.ok).toBe(false);
  });

  it('imha: emanet süresi dolmalı ve açıklama zorunlu', () => {
    const early = planLostItemTransition(found, { to: 'DISPOSED', disposalNote: 'Bağışlandı' }, NOW);
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.errors[0].message).toContain('30 gün');

    const old = { ...found, foundAt: daysAgo(31) };
    expect(planLostItemTransition(old, { to: 'DISPOSED', disposalNote: '' }, NOW).ok).toBe(false);
    expect(planLostItemTransition(old, { to: 'DISPOSED', disposalNote: 'Kızılay' }, NOW)).toEqual({
      ok: true,
      changes: { status: 'DISPOSED', disposalNote: 'Kızılay', disposedAt: NOW },
    });
    // süre sitede kısaltılmışsa
    expect(planLostItemTransition(found, { to: 'DISPOSED', disposalNote: 'x' }, NOW, 7).ok).toBe(true);
  });

  it('emanette geçen gün', () => {
    expect(daysInCustody(daysAgo(3), NOW)).toBe(3);
    expect(daysInCustody(null, NOW)).toBe(null);
  });
});

describe('plaka', () => {
  it('normalize: boşluk, tire ve Türkçe küçük harfler', () => {
    expect(normalizePlate('34 abc 123')).toBe('34ABC123');
    expect(normalizePlate('06-ıj-4567')).toBe('06IJ4567');
    expect(normalizePlate(null)).toBe('');
  });

  it('Türkiye plaka biçimi', () => {
    expect(isTurkishPlate('34 A 1234')).toBe(true);
    expect(isTurkishPlate('34 A 12345')).toBe(true);
    expect(isTurkishPlate('06 AB 123')).toBe(true);
    expect(isTurkishPlate('06 AB 1234')).toBe(true);
    expect(isTurkishPlate('35 ABC 12')).toBe(true);
    expect(isTurkishPlate('81 ABC 123')).toBe(true);
    expect(isTurkishPlate('82 ABC 123')).toBe(false); // il kodu yok
    expect(isTurkishPlate('00 AB 123')).toBe(false);
    expect(isTurkishPlate('34 ABC 1234')).toBe(false); // 3 harf + 4 rakam yok
    expect(isTurkishPlate('34 A 123')).toBe(false);
  });

  it('biçimleme; yabancı plaka reddedilmez', () => {
    expect(formatPlate('34abc123')).toBe('34 ABC 123');
    expect(formatPlate('B-MW 1234')).toBe('BMW1234');
  });
});

describe('ziyaretçi', () => {
  const entered = new Date('2026-10-16T08:00:00Z');

  it('süre: çıkış yoksa şimdiye kadar', () => {
    expect(visitMinutes(entered, new Date('2026-10-16T09:30:00Z'), NOW)).toBe(90);
    expect(visitMinutes(entered, null, NOW)).toBe(240);
  });

  it('çıkışı unutulmuş ziyaret', () => {
    expect(isOverstay(entered, null, NOW)).toBe(false);
    expect(isOverstay(new Date('2026-10-16T01:00:00Z'), null, NOW)).toBe(false);
    expect(isOverstay(new Date('2026-10-15T23:00:00Z'), null, NOW)).toBe(true);
    expect(isOverstay(new Date('2026-10-14T23:00:00Z'), NOW, NOW)).toBe(false);
  });

  it('süre biçimi', () => {
    expect(formatDuration(40)).toBe('40 dk');
    expect(formatDuration(135)).toBe('2 sa 15 dk');
    expect(formatDuration(120)).toBe('2 sa');
    expect(formatDuration(1600)).toBe('1 gün 2 sa');
  });
});
