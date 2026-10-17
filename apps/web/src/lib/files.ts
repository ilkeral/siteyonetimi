/**
 * Metin dosyası (CSV) okuma. Türkçe Excel "CSV" kaydederken çoğunlukla UTF-8
 * değil Windows-1254 kullanır; UTF-8 çözümünde bozuk karakter çıkarsa ona düşülür.
 */
export async function readTextFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  return utf8.includes('�') ? new TextDecoder('windows-1254').decode(buffer) : utf8;
}
