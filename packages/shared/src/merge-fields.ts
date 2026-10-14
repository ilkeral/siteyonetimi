import { MERGE_FIELDS } from './labels';

export type MergeContext = Record<string, string | number | null | undefined>;

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Bildirim gövdesindeki {{degisken}} alanlarını doldurur.
 *
 * Bilinmeyen değişken boş string'e dönüşür ve `unknown` listesinde raporlanır —
 * böylece kampanya gönderilmeden önce "bu şablonda tanımsız alan var" uyarısı
 * verilebilir.
 */
export function renderTemplate(
  body: string,
  context: MergeContext,
): { text: string; unknown: string[] } {
  const unknown: string[] = [];
  const text = body.replace(PLACEHOLDER_RE, (_match, key: string) => {
    if (!(key in context)) {
      if (!unknown.includes(key)) unknown.push(key);
      return '';
    }
    const value = context[key];
    return value === null || value === undefined ? '' : String(value);
  });
  return { text, unknown };
}

/** Şablondaki değişkenleri çıkarır (editörde önizleme/doğrulama için) */
export function extractMergeFields(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(PLACEHOLDER_RE)) {
    found.add(match[1]);
  }
  return [...found];
}

const KNOWN_KEYS = new Set<string>(MERGE_FIELDS.map((f) => f.key));

/** Şablonda tanımlı olmayan değişkenleri döndürür */
export function validateMergeFields(body: string): string[] {
  return extractMergeFields(body).filter((k) => !KNOWN_KEYS.has(k));
}
