import { describe, expect, it } from 'vitest';
import { accessLevel, checkLimit, hasFeature, organizationCreateSchema, planSchema } from '../subscription';

const NOW = new Date('2026-10-17T12:00:00Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe('erişim seviyesi', () => {
  it('askıda ve iptal: giriş yok', () => {
    expect(accessLevel({ status: 'SUSPENDED', trialEndsAt: null, paidUntil: null }, NOW).level).toBe('BLOCKED');
    expect(accessLevel({ status: 'CANCELLED', trialEndsAt: null, paidUntil: null }, NOW).level).toBe('BLOCKED');
  });

  it('deneme: süre içinde tam, bitince salt okunur; kalan gün', () => {
    const trial = accessLevel({ status: 'TRIAL', trialEndsAt: days(5), paidUntil: null }, NOW);
    expect(trial).toEqual({ level: 'FULL', reason: null, daysLeft: 5 });
    expect(accessLevel({ status: 'TRIAL', trialEndsAt: days(-1), paidUntil: null }, NOW).level).toBe('READ_ONLY');
  });

  it('aktif: ödenmiş süre + 7 gün tolerans', () => {
    expect(accessLevel({ status: 'ACTIVE', trialEndsAt: null, paidUntil: days(-6) }, NOW).level).toBe('FULL');
    expect(accessLevel({ status: 'ACTIVE', trialEndsAt: null, paidUntil: days(-7) }, NOW).level).toBe('READ_ONLY');
    expect(accessLevel({ status: 'ACTIVE', trialEndsAt: null, paidUntil: null }, NOW).level).toBe('FULL');
  });

  it('ödeme gecikti: salt okunur', () => {
    expect(accessLevel({ status: 'PAST_DUE', trialEndsAt: null, paidUntil: null }, NOW).level).toBe('READ_ONLY');
  });
});

describe('modül ve sınır', () => {
  it('paketsiz (özel) müşteri tüm modüller', () => {
    expect(hasFeature(null, 'meters')).toBe(true);
    expect(hasFeature({ features: ['tickets'] }, 'meters')).toBe(false);
    expect(hasFeature({ features: ['tickets', 'meters'] }, 'meters')).toBe(true);
  });

  it('sınır', () => {
    expect(checkLimit(null, 9999, 10)).toEqual({ ok: true, limit: null, used: 9999, remaining: null });
    expect(checkLimit(150, 140, 10).ok).toBe(true);
    expect(checkLimit(150, 140, 11)).toEqual({ ok: false, limit: 150, used: 140, remaining: 10 });
  });
});

describe('şemalar', () => {
  it('bilinmeyen modül anahtarı reddedilir', () => {
    const base = { code: 'pro', name: 'Pro', monthlyPrice: 990, maxSites: 5, maxUnits: null, features: ['meters'] };
    expect(planSchema.safeParse(base).success).toBe(true);
    expect(planSchema.safeParse({ ...base, features: ['muhasebe'] }).success).toBe(false);
    expect(planSchema.safeParse({ ...base, code: 'Pro Paket' }).success).toBe(false);
  });

  it('yeni müşteri: sahip e-postası küçük harfe, varsayılan deneme 30 gün', () => {
    const parsed = organizationCreateSchema.parse({
      name: 'Örnek Yönetim',
      kind: 'MANAGEMENT_COMPANY',
      planId: null,
      owner: { fullName: 'Ayşe Yılmaz', email: 'Ayse@Ornek.COM' },
      firstSite: null,
    });
    expect(parsed.owner.email).toBe('ayse@ornek.com');
    expect(parsed.trialDays).toBe(30);
  });
});
