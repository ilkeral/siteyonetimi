/**
 * KVKK — KİŞİSEL VERİ MASKESİ
 *
 * Raporlarda "Kişisel Veri Maskesi: Evet" seçilince kişiyi doğrudan tanıtan
 * veriler kısmen gizlenir. Rapor yine okunabilir kalır (hangi satırın kime ait
 * olduğu ilk harflerden ayırt edilir) ama dışarı verildiğinde kimlik ifşa
 * olmaz. Tutarlar ve daire numaraları maskelenmez (kişisel veri değildir).
 */

const MASK = '*';

/** "Ayşe Yılmaz" → "Ay** Yı****" — her kelimenin ilk 2 harfi kalır */
export function maskName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .split(/(\s+)/)
    .map((part) => {
      if (/^\s+$/.test(part)) return part;
      const chars = Array.from(part);
      // Kısa kelime ("Öz", "Su") açık kalırsa kimliği ele verir: yalnızca ilk harf
      if (chars.length <= 2) return chars[0] + MASK.repeat(chars.length - 1);
      return chars.slice(0, 2).join('') + MASK.repeat(chars.length - 2);
    })
    .join('');
}

/** "12345678901" → "123******01" */
export function maskNationalId(value: string | null | undefined): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length < 6) return MASK.repeat(digits.length);
  return digits.slice(0, 3) + MASK.repeat(digits.length - 5) + digits.slice(-2);
}

/** Biçim korunur, ilk 4 ve son 2 hane kalır: "0532 123 45 67" → "0532 *** ** 67" */
export function maskPhone(value: string | null | undefined): string {
  if (!value) return '';
  const total = (value.match(/\d/g) ?? []).length;
  let seen = 0;
  return value.replace(/\d/g, (digit) => {
    seen++;
    return seen <= 4 || seen > total - 2 ? digit : MASK;
  });
}

/** "ayse.yilmaz@ornek.com" → "ay*********@or***.com" */
export function maskEmail(value: string | null | undefined): string {
  if (!value) return '';
  const [local, domain] = value.split('@');
  if (!domain) return maskName(value);
  const dot = domain.lastIndexOf('.');
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  const keep = (part: string) => part.slice(0, 2) + MASK.repeat(Math.max(0, part.length - 2));
  return `${keep(local)}@${keep(host)}${tld}`;
}

/** "TR33 0006 1005 1978 6457 8413 26" → "TR33 **** **** **** **** **13 26" */
export function maskIban(value: string | null | undefined): string {
  if (!value) return '';
  const total = (value.match(/[0-9A-Za-z]/g) ?? []).length;
  let seen = 0;
  return value.replace(/[0-9A-Za-z]/g, (char) => {
    seen++;
    return seen <= 4 || seen > total - 4 ? char : MASK;
  });
}

const FOLD: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };

/**
 * Karşılaştırma anahtarı: Türkçe küçük harf + Türkçe harflerin ASCII karşılığı.
 * Her karakter tek karaktere dönüştüğü için konumlar orijinal metinle aynıdır.
 */
function foldTR(text: string): string {
  return text.toLocaleLowerCase('tr').replace(/[çğıöşü]/g, (c) => FOLD[c]);
}

/**
 * Serbest metinde geçen kişi adlarını maskeler ("Ayşe Yılmaz tahsilatı",
 * banka açıklamasındaki "EFT AYSE YILMAZ" gibi).
 *
 * Eşleştirme Türkçe kurallarla ve ASCII'ye indirgenmiş haliyle yapılır:
 * JavaScript'in `i` bayrağı I↔ı / İ↔i eşleşmesini bilmez ve bankalar adı
 * çoğunlukla Türkçe karaktersiz gönderir ("AYSE YILMAZ").
 */
export function maskNamesInText(text: string | null | undefined, names: readonly string[]): string {
  if (!text) return '';
  let result = text;
  // Uzun adlar önce: "Ayşe Yılmaz" maskelenmeden "Ayşe" maskelenmesin
  const ordered = [...new Set(names.map((n) => n.trim().replace(/\s+/g, ' ')))]
    .filter((n) => n.length > 1)
    .sort((a, b) => b.length - a.length);

  for (const name of ordered) {
    const needle = foldTR(name);
    let from = 0;
    for (;;) {
      const at = foldTR(result).indexOf(needle, from);
      if (at === -1) break;
      const original = result.slice(at, at + name.length);
      result = result.slice(0, at) + maskName(original) + result.slice(at + name.length);
      from = at + name.length;
    }
  }
  return result;
}
