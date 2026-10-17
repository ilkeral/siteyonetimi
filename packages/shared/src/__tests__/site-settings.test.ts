import { describe, expect, it } from 'vitest';
import { LATE_FEE_DAILY_MAX, siteSettingsSchema } from '../site-settings';

const valid = {
  duesDistributionMethod: 'EQUAL',
  duesLiabilityRule: 'OCCUPANT',
  applyLateFee: true,
  lateFeeMethod: 'MONTHLY_PERCENT',
  lateFeeRate: 5,
  lateFeeGraceDays: 0,
  requireNationalId: false,
  requireEmail: false,
  requireMobilePhone: true,
  requireVisitorId: false,
  notificationSenderName: null,
  notificationFooter: null,
  autoMatchBankTransactions: true,
};

describe('site parametreleri', () => {
  it('geçerli gövde', () => {
    expect(siteSettingsSchema.safeParse(valid).success).toBe(true);
  });

  it('bilinmeyen alan reddedilir (siteId, iç içe site yazması)', () => {
    expect(siteSettingsSchema.safeParse({ ...valid, siteId: 'x' }).success).toBe(false);
    expect(siteSettingsSchema.safeParse({ ...valid, site: { update: { name: 'x' } } }).success).toBe(false);
  });

  it('KMK m.20: aylık %5 tavanı', () => {
    expect(siteSettingsSchema.safeParse({ ...valid, lateFeeRate: 5.01 }).success).toBe(false);
    expect(siteSettingsSchema.safeParse({ ...valid, lateFeeRate: -1 }).success).toBe(false);
  });

  it('günlük oran 30 günde aylık tavanı aşamaz', () => {
    expect(LATE_FEE_DAILY_MAX).toBe(0.1666);
    expect(siteSettingsSchema.safeParse({ ...valid, lateFeeMethod: 'DAILY_PERCENT', lateFeeRate: 0.1666 }).success).toBe(true);
    expect(siteSettingsSchema.safeParse({ ...valid, lateFeeMethod: 'DAILY_PERCENT', lateFeeRate: 0.2 }).success).toBe(false);
  });

  it('tazminat uygulanmıyorsa oran tavanı aranmaz', () => {
    expect(siteSettingsSchema.safeParse({ ...valid, lateFeeMethod: 'NONE', lateFeeRate: 9 }).success).toBe(true);
  });
});
