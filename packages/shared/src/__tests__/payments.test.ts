import { describe, expect, it } from 'vitest';
import { isValidCardNumber, isValidExpiry, maskCard } from '../payments';
import { portalPaymentSchema } from '../schemas';

describe('isValidCardNumber (Luhn)', () => {
  it.each(['4111 1111 1111 1111', '5555-5555-5555-4444', '4508034508034509', '371449635398431'])(
    'geçerli: %s',
    (number) => expect(isValidCardNumber(number)).toBe(true),
  );

  it.each(['4111 1111 1111 1112', '1234', 'abcd efgh ijkl mnop', ''])('geçersiz: "%s"', (number) =>
    expect(isValidCardNumber(number)).toBe(false),
  );
});

describe('isValidExpiry', () => {
  const now = new Date('2026-10-16');

  it('içinde bulunulan ay geçerli, geçen ay değil', () => {
    expect(isValidExpiry('10/26', now)).toBe(true);
    expect(isValidExpiry('09/26', now)).toBe(false);
  });

  it('ileri yıl geçerli, biçim ve ay kontrolü', () => {
    expect(isValidExpiry('01/27', now)).toBe(true);
    expect(isValidExpiry('13/27', now)).toBe(false);
    expect(isValidExpiry('1/27', now)).toBe(false);
  });
});

describe('portalPaymentSchema', () => {
  const card = { holder: 'Ayşe Yılmaz', number: '4111 1111 1111 1111', expiry: '12/30', cvc: '123' };

  it('geçerli ödeme', () => {
    expect(portalPaymentSchema.safeParse({ amount: '1.500,00', card }).success).toBe(true);
  });

  it('Luhn hatalı kart ve CVC biçimi reddedilir', () => {
    const r = portalPaymentSchema.safeParse({ amount: 10, card: { ...card, number: '4111 1111 1111 1112', cvc: '12' } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.path.join('.'))).toEqual(['card.number', 'card.cvc']);
    }
  });

  it('kart maskelenir', () => {
    expect(maskCard(card.number)).toBe('**** 1111');
  });
});
