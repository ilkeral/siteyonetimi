/**
 * ÇEVRİMİÇİ ÖDEME — kart doğrulama kuralları (saf)
 *
 * Gerçek tahsilat bir ödeme kuruluşu (3D Secure) üzerinden yapılır; kart
 * verisi bizim sunucumuzda SAKLANMAZ. Buradaki kontroller yalnızca hatalı
 * girişi erkenden yakalamak içindir.
 */

/** Yalnızca rakamlar: "4111 1111-1111 1111" → "4111111111111111" */
export function cardDigits(number: string): string {
  return number.replace(/[\s-]/g, '');
}

/** Luhn (mod 10) kontrol hanesi doğrulaması */
export function isValidCardNumber(number: string): boolean {
  const digits = cardDigits(number);
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** "AA/YY" son kullanma tarihi, verilen tarihin ayı dahil geçerli mi */
export function isValidExpiry(expiry: string, now: Date = new Date()): boolean {
  const match = /^(\d{2})\s*\/\s*(\d{2})$/.exec(expiry.trim());
  if (!match) return false;
  const month = Number(match[1]);
  const year = 2000 + Number(match[2]);
  if (month < 1 || month > 12) return false;
  // Kart, son kullanma ayının sonuna kadar geçerlidir
  return year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);
}

/** Ekranda ve evrak açıklamasında gösterilecek maskeli numara: "**** 1111" */
export function maskCard(number: string): string {
  return `**** ${cardDigits(number).slice(-4)}`;
}
