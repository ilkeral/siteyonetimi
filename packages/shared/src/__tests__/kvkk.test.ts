import { describe, expect, it } from 'vitest';
import { maskEmail, maskIban, maskName, maskNamesInText, maskNationalId, maskPhone } from '../kvkk';

describe('KVKK maskesi', () => {
  it('ad soyad: her kelimenin ilk 2 harfi, kısa kelimede yalnız ilk harf', () => {
    expect(maskName('Ayşe Yılmaz')).toBe('Ay** Yı****');
    expect(maskName('İbrahim Öz')).toBe('İb***** Ö*');
    expect(maskName('Ali Can Su')).toBe('Al* Ca* S*');
    expect(maskName('')).toBe('');
  });

  it('TC kimlik no', () => {
    expect(maskNationalId('12345678901')).toBe('123******01');
  });

  it('telefon biçimi korunur', () => {
    expect(maskPhone('0532 123 45 67')).toBe('0532 *** ** 67');
    expect(maskPhone('+905321234567')).toBe('+9053******67');
  });

  it('e-posta', () => {
    expect(maskEmail('ayse.yilmaz@ornek.com')).toBe('ay*********@or***.com');
  });

  it('IBAN', () => {
    expect(maskIban('TR33 0006 1005 1978 6457 8413 26')).toBe('TR33 **** **** **** **** **13 26');
  });

  it('metindeki adları büyük/küçük harf duyarsız maskeler', () => {
    expect(maskNamesInText('AYŞE YILMAZ tahsilatı', ['Ayşe Yılmaz'])).toBe('AY** YI**** tahsilatı');
    expect(maskNamesInText('EFT - ibrahim kılıç - 0042', ['İbrahim Kılıç'])).toBe('EFT - ib***** kı*** - 0042');
    // Bankaların ASCII'ye çevirdiği ad da yakalanır
    expect(maskNamesInText('Banka: EFT AYSE YILMAZ 0042', ['Ayşe Yılmaz'])).toBe('Banka: EFT AY** YI**** 0042');
    expect(maskNamesInText('Ayşe Yılmaz ve Ayşe', ['Ayşe', 'Ayşe Yılmaz'])).toBe('Ay** Yı**** ve Ay**');
  });
});
