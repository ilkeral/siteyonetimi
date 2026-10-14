/**
 * PARA BİRİMİ KURALLARI (tek kaynak)
 *
 * Tüm hesaplamalar TAM SAYI "kuruş" (minor unit) üzerinden yapılır.
 * Kayan nokta aritmetiği hiçbir hesapta kullanılmaz; böylece
 *   - 0.1 + 0.2 türü hatalar oluşmaz,
 *   - dağıtım sonuçlarının toplamı daima dağıtılan tutara eşit olur.
 *
 * Veritabanında Decimal(18,4) saklanır; sınırda toMinor/fromMinor ile çevrilir.
 */

export const MINOR_UNITS = 100; // 1 TL = 100 kuruş

/** "1.234,56" | "1234.56" | 1234.56 → 123456 (kuruş) */
export function toMinor(value: string | number): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Geçersiz tutar: ${value}`);
    return Math.round(value * MINOR_UNITS);
  }

  const normalized = value
    .trim()
    .replace(/\s/g, '')
    .replace(/₺|TL/gi, '')
    // "1.234,56" (TR) → "1234.56"
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.');

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`Geçersiz tutar: ${value}`);
  return Math.round(parsed * MINOR_UNITS);
}

/** 123456 (kuruş) → 1234.56 */
export function fromMinor(minor: number): number {
  return Math.round(minor) / MINOR_UNITS;
}

/** 123456 → "1.234,56 ₺" */
export function formatTRY(minor: number): string {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
  }).format(fromMinor(minor));
}

/** Yarıyı yukarı yuvarlayan tam sayı bölme (negatifte de tutarlı) */
export function roundHalfUp(value: number): number {
  return value >= 0 ? Math.floor(value + 0.5) : -Math.floor(-value + 0.5);
}

/** Yüzde uygula: 10000 kuruşun %5'i → 500 */
export function applyPercent(minor: number, percent: number): number {
  return roundHalfUp((minor * percent) / 100);
}

/**
 * EN BÜYÜK KALAN YÖNTEMİ ile ağırlıklı dağıtım.
 *
 * Bir tutarı ağırlıklara göre böler ve **sonuçların toplamının daima
 * dağıtılan tutara eşit olmasını** garanti eder (kuruş farkı kaybolmaz;
 * artan kuruşlar en büyük kalana sahip paylara birer birer eklenir).
 *
 * @param totalMinor dağıtılacak toplam (kuruş)
 * @param weights    ağırlıklar (m², arsa payı, tüketim, hisse ... )
 * @returns          her ağırlığa düşen tutar (kuruş)
 */
export function distributeByWeights(totalMinor: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];

  const sanitized = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const totalWeight = sanitized.reduce((a, b) => a + b, 0);

  // Hiç ağırlık yoksa eşit böl
  if (totalWeight === 0) return distributeEqually(totalMinor, n);

  const exact = sanitized.map((w) => (totalMinor * w) / totalWeight);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = totalMinor - floors.reduce((a, b) => a + b, 0);

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const result = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++) {
    result[order[k].i] += 1;
    remainder -= 1;
  }
  return result;
}

/** Eşit dağıtım — artan kuruşlar baştan sırayla dağıtılır */
export function distributeEqually(totalMinor: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(totalMinor / count);
  let remainder = totalMinor - base * count;
  return Array.from({ length: count }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return base + extra;
  });
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
