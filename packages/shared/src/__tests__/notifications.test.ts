import { describe, expect, it } from 'vitest';
import {
  buildMergeContext,
  normalizePhoneTR,
  selectAudience,
  smsInfo,
  type AudiencePerson,
} from '../notifications';
import type { AudienceInput } from '../schemas';
import { toMinor } from '../money';

const person = (overrides: Partial<AudiencePerson> & { personId: string }): AudiencePerson => ({
  fullName: overrides.personId.toUpperCase(),
  email: `${overrides.personId}@ornek.com`,
  phone: '0532 111 22 33',
  phone2: null,
  roles: ['OWNER'],
  blockIds: ['A'],
  balanceMinor: 0,
  ...overrides,
});

/** Şemadan geçirilmez: testte kısa kimlikler (UUID değil) kullanılıyor */
const audience = (input: Partial<AudienceInput> = {}): AudienceInput => ({
  group: 'ALL',
  onlyOverdue: false,
  includeSecondPhone: false,
  ...input,
});

describe('normalizePhoneTR', () => {
  it.each([
    ['05321112233', '+905321112233'],
    ['0532 111 22 33', '+905321112233'],
    ['5321112233', '+905321112233'],
    ['+90 532 111 22 33', '+905321112233'],
    ['00905321112233', '+905321112233'],
    ['(0532) 111-22-33', '+905321112233'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhoneTR(input)).toBe(expected);
  });

  it.each(['0212 444 55 66', '12345', '', null])('cep olmayan reddedilir: %s', (input) => {
    expect(normalizePhoneTR(input)).toBeNull();
  });
});

describe('selectAudience', () => {
  const people = [
    person({ personId: 'malik', balanceMinor: toMinor(1500), overdueMinor: toMinor(1500) }),
    person({ personId: 'kiraci', roles: ['TENANT'], blockIds: ['B'], phone: '05441112233', balanceMinor: toMinor(200) }),
    person({ personId: 'avans', balanceMinor: toMinor(-300), email: null, phone: '0212 444 55 66' }),
    person({ personId: 'cikmis', roles: [], blockIds: [], balanceMinor: toMinor(5000) }),
  ];

  it('TÜMÜ sitede oturmayanları almaz', () => {
    const r = selectAudience(people, audience(), 'EMAIL');
    expect(r.matchedCount).toBe(3);
    expect(r.recipients.map((x) => x.personId)).toEqual(['malik', 'kiraci']);
    expect(r.excluded).toEqual([{ personId: 'avans', fullName: 'AVANS', reason: 'E-posta adresi yok ya da geçersiz' }]);
  });

  it('malik / kiracı / borçlu grupları', () => {
    expect(selectAudience(people, audience({ group: 'OWNERS' }), 'EMAIL').matchedCount).toBe(2);
    expect(selectAudience(people, audience({ group: 'TENANTS' }), 'EMAIL').recipients[0].personId).toBe('kiraci');
    expect(
      selectAudience(people, audience({ group: 'DEBTORS' }), 'EMAIL').recipients.map((x) => x.personId),
    ).toEqual(['malik', 'kiraci']);
  });

  it('borç aralığı TL olarak verilir, kuruşla karşılaştırılır', () => {
    const r = selectAudience(people, audience({ group: 'DEBTORS', minDebt: 1000, maxDebt: 2000 }), 'EMAIL');
    expect(r.recipients.map((x) => x.personId)).toEqual(['malik']);
  });

  it('blok ve vadesi geçmiş filtresi', () => {
    expect(selectAudience(people, audience({ blockIds: ['B'] }), 'SMS').recipients[0].personId).toBe('kiraci');
    expect(selectAudience(people, audience({ onlyOverdue: true }), 'SMS').matchedCount).toBe(1);
  });

  it('özel listede çıkmış kişi de seçilebilir', () => {
    const r = selectAudience(people, audience({ group: 'CUSTOM', personIds: ['cikmis'] }), 'EMAIL');
    expect(r.recipients.map((x) => x.personId)).toEqual(['cikmis']);
  });

  it('SMS cep telefonunu E.164 yapar, sabit hattı ayıklar', () => {
    const r = selectAudience(people, audience(), 'SMS');
    expect(r.recipients.map((x) => x.recipient)).toEqual(['+905321112233', '+905441112233']);
    expect(r.excluded[0].reason).toBe('Geçerli cep telefonu yok');
  });

  it('aynı adrese ikinci kez göndermez', () => {
    const twins = [person({ personId: 'es1' }), person({ personId: 'es2' })];
    const r = selectAudience(twins, audience(), 'SMS');
    expect(r.recipients).toHaveLength(1);
    expect(r.excluded[0].reason).toContain('zaten gönderiliyor');
  });

  it('2. telefon istenirse ek alıcı olarak eklenir', () => {
    const p = [person({ personId: 'x', phone2: '0555 999 88 77' })];
    expect(selectAudience(p, audience(), 'SMS').recipients).toHaveLength(1);
    const r = selectAudience(p, audience({ includeSecondPhone: true }), 'SMS');
    expect(r.recipients.map((x) => [x.recipient, x.secondary])).toEqual([
      ['+905321112233', false],
      ['+905559998877', true],
    ]);
  });

  it('sağlayıcısı olmayan kanal hata verir', () => {
    expect(() => selectAudience(people, audience(), 'PUSH')).toThrow();
  });
});

describe('buildMergeContext', () => {
  const now = new Date('2026-10-16T12:00:00');

  it('en son vadeli açık borcu ve toplamı yazar', () => {
    const ctx = buildMergeContext({
      fullName: 'Ayşe Yılmaz',
      siteName: 'Adakent',
      units: [
        { blockName: 'A Blok', doorNumber: '5' },
        { blockName: 'A Blok', doorNumber: '6' },
      ],
      balanceMinor: toMinor(3250),
      openItems: [
        { type: 'DUES_ACCRUAL', period: '2026-08', dueDate: new Date('2026-08-15'), remainingMinor: toMinor(1500) },
        { type: 'DUES_ACCRUAL', period: '2026-09', dueDate: new Date('2026-09-15'), remainingMinor: toMinor(1500) },
        { type: 'LATE_FEE', period: '2026-09', dueDate: new Date('2026-09-30'), remainingMinor: toMinor(250) },
      ],
      paymentCode: '0042',
      now,
    });
    expect(ctx.adSoyad).toBe('Ayşe Yılmaz');
    expect(ctx.daireNo).toBe('5, 6');
    expect(ctx.blokAdi).toBe('A Blok');
    expect(ctx.donem).toBe('2026 Eylül');
    expect(ctx.borcTutari).toMatch(/1\.500,00/);
    expect(ctx.sonOdemeTarihi).toBe('15.09.2026');
    expect(ctx.gecikmeTazminati).toMatch(/250,00/);
    expect(ctx.toplamBorc).toMatch(/3\.250,00/);
    expect(ctx.odemeKodu).toBe('0042');
  });

  it('avanslı kişide toplam borç 0, dönem bugünün dönemi', () => {
    const ctx = buildMergeContext({
      fullName: 'X',
      siteName: 'S',
      units: [],
      balanceMinor: toMinor(-100),
      now,
    });
    expect(ctx.toplamBorc).toMatch(/0,00/);
    expect(ctx.donem).toBe('2026 Ekim');
    expect(ctx.sonOdemeTarihi).toBe('');
  });
});

describe('smsInfo', () => {
  it('GSM-7: 160 karaktere kadar tek parça', () => {
    expect(smsInfo('a'.repeat(160))).toMatchObject({ encoding: 'GSM7', segments: 1 });
    expect(smsInfo('a'.repeat(161))).toMatchObject({ encoding: 'GSM7', segments: 2, perSegment: 153 });
  });

  it('genişletilmiş karakter 2 birim sayılır', () => {
    expect(smsInfo('€').length).toBe(2);
  });

  it('Türkçe ş/ğ/ı UCS-2ye düşürür (70 / 67)', () => {
    const r = smsInfo('Sayın sakin, aidat borcunuz');
    expect(r.encoding).toBe('UCS2');
    expect(r.nonGsmChars).toEqual(['ı']);
    expect(smsInfo('ş'.repeat(70)).segments).toBe(1);
    expect(smsInfo('ş'.repeat(71)).segments).toBe(2);
    expect(smsInfo('ş'.repeat(135))).toMatchObject({ segments: 3, perSegment: 67 });
  });

  it('boş metin 0 parça', () => {
    expect(smsInfo('').segments).toBe(0);
  });
});
