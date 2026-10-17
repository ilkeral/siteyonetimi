import ExcelJS from 'exceljs';
import { DOCUMENT_TYPE_LABELS, formatPeriodShortTR } from '@sy/shared';
import type { AgingData, SiteInfo, StatementData } from './pdf';
import { incomeStatementTables, type IncomeStatementData } from './income-statement-table';

/**
 * EXCEL ÇIKTISI (exceljs)
 *
 * Tutarlar metin değil SAYI olarak yazılır (TL, 2 ondalık) — kullanıcı
 * Excel'de toplayıp süzebilsin. Tarihler gerçek tarih hücresidir. Başlık
 * satırı dondurulur. KVKK maskesi PDF'tekiyle aynıdır (veri sunucuda maskeli
 * gelir); maske notu dosyaya da yazılır.
 */

const MONEY = '#,##0.00;[Red]-#,##0.00';
const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF3F7' } };
const TOTAL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFB' } };

/** Kuruş → TL (Excel sayısı). Hesap kuruşta yapılır; burada yalnızca gösterim. */
const tl = (minor: number) => minor / 100;

function workbook(site: SiteInfo) {
  const book = new ExcelJS.Workbook();
  book.creator = 'Site Yönetim';
  book.company = site.name;
  book.created = new Date();
  return book;
}

/** Sayfa başına site adı, rapor adı, alt başlık; tablo başlığının satır numarasını döndürür */
function title(sheet: ExcelJS.Worksheet, site: SiteInfo, name: string, subtitle: string, masked: boolean): number {
  sheet.getCell('A1').value = site.name;
  sheet.getCell('A1').font = { bold: true, size: 13 };
  sheet.getCell('A2').value = name;
  sheet.getCell('A2').font = { bold: true, size: 11 };
  sheet.getCell('A3').value = subtitle + (masked ? ' · KVKK: kişisel veriler maskelenmiştir' : '');
  sheet.getCell('A3').font = { italic: true, color: { argb: 'FF5B6B7C' } };
  return 5;
}

function headerRow(sheet: ExcelJS.Worksheet, rowNumber: number, headers: string[]) {
  const row = sheet.getRow(rowNumber);
  headers.forEach((header, i) => {
    const cell = row.getCell(i + 1);
    cell.value = header;
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  sheet.views = [{ state: 'frozen', ySplit: rowNumber }];
}

async function toBuffer(book: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await book.xlsx.writeBuffer());
}

// ------------------------------------------------------------------ ekstre

export async function statementXlsx(data: StatementData): Promise<Buffer> {
  const book = workbook(data.site);
  const sheet = book.addWorksheet('Ekstre');
  const day = (d: Date) => new Date(d).toLocaleDateString('tr-TR');
  let r = title(sheet, data.site, 'Cari Hesap Ekstresi', `${day(data.from)} – ${day(data.to)} · ${data.accounts.length} cari`, data.masked);
  headerRow(sheet, r, ['Cari', 'Daire', 'Tarih', 'Evrak No', 'Açıklama', 'Borç (TL)', 'Alacak (TL)', 'Bakiye (TL)']);
  sheet.columns = [{ width: 24 }, { width: 14 }, { width: 12 }, { width: 16 }, { width: 44 }, { width: 14 }, { width: 14 }, { width: 14 }];

  for (const account of data.accounts) {
    const units = account.units.join(', ');
    const opening = sheet.getRow(++r);
    opening.values = [account.name, units, null, null, 'Devir bakiyesi', null, null, tl(account.openingBalanceMinor)];
    opening.font = { italic: true };
    for (const line of account.lines) {
      sheet.getRow(++r).values = [
        account.name,
        units,
        new Date(line.date),
        line.documentNumber,
        line.description || DOCUMENT_TYPE_LABELS[line.documentType as keyof typeof DOCUMENT_TYPE_LABELS] || line.documentType,
        line.debitMinor ? tl(line.debitMinor) : null,
        line.creditMinor ? tl(line.creditMinor) : null,
        tl(line.balanceMinor),
      ];
    }
    const total = sheet.getRow(++r);
    total.values = [account.name, units, null, null, 'Dönem toplamı', tl(account.totalDebitMinor), tl(account.totalCreditMinor), tl(account.closingBalanceMinor)];
    total.font = { bold: true };
    total.eachCell((cell) => (cell.fill = TOTAL_FILL));
  }
  sheet.getColumn(3).numFmt = 'dd.mm.yyyy';
  for (const col of [6, 7, 8]) sheet.getColumn(col).numFmt = MONEY;
  sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: 8 } };
  return toBuffer(book);
}

// ------------------------------------------------------------- yaşlandırma

export async function agingXlsx(data: AgingData): Promise<Buffer> {
  const book = workbook(data.site);
  const sheet = book.addWorksheet('Yaşlandırma');
  const asOf = new Date(data.asOf).toLocaleDateString('tr-TR');
  let r = title(sheet, data.site, 'Borç Yaşlandırma Raporu', `${asOf} itibarıyla · ${data.rows.length} borçlu`, data.masked);
  headerRow(sheet, r, ['Kişi', 'Daire', 'Telefon', 'Vadesi gelmemiş', '0–30 gün', '31–60 gün', '61–90 gün', '90+ gün', 'Toplam (TL)']);
  sheet.columns = [{ width: 26 }, { width: 16 }, { width: 16 }, ...Array(6).fill({ width: 15 })];

  for (const row of data.rows) {
    sheet.getRow(++r).values = [
      row.name,
      row.units.join(', '),
      row.phone ?? '',
      tl(row.buckets.notDue),
      tl(row.buckets.d0_30),
      tl(row.buckets.d31_60),
      tl(row.buckets.d61_90),
      tl(row.buckets.d90),
      tl(row.totalMinor),
    ];
  }
  const total = sheet.getRow(++r);
  total.values = [
    'TOPLAM',
    null,
    null,
    tl(data.totals.notDue),
    tl(data.totals.d0_30),
    tl(data.totals.d31_60),
    tl(data.totals.d61_90),
    tl(data.totals.d90),
    tl(data.totals.totalMinor),
  ];
  total.font = { bold: true };
  total.eachCell((cell) => (cell.fill = TOTAL_FILL));
  for (let col = 4; col <= 9; col++) sheet.getColumn(col).numFmt = MONEY;
  sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: 9 } };
  return toBuffer(book);
}

// ------------------------------------------------------------- gelir-gider

export async function incomeStatementXlsx(data: IncomeStatementData): Promise<Buffer> {
  const book = workbook(data.site);
  const subtitle = `${formatPeriodShortTR(data.from)} – ${formatPeriodShortTR(data.to)} · tutarlar TL`;

  for (const [index, table] of incomeStatementTables(data).entries()) {
    const sheet = book.addWorksheet(index === 0 ? 'Gelir-Gider' : 'Kasa-Banka');
    let r = title(sheet, data.site, table.title, subtitle, false);
    headerRow(sheet, r, ['', ...table.columns, table.totalHeader]);
    sheet.columns = [{ width: 30 }, ...table.columns.map(() => ({ width: 13 })), { width: 15 }];
    for (const row of table.rows) {
      const excelRow = sheet.getRow(++r);
      excelRow.values = [
        row.style === 'line' ? `   ${row.label}` : row.label,
        ...row.values.map((v) => (v === null ? null : tl(v))),
        row.total === null ? null : tl(row.total),
      ];
      if (row.style !== 'line') excelRow.font = { bold: true };
      if (row.style === 'subtotal' || row.style === 'net') excelRow.eachCell((cell) => (cell.fill = TOTAL_FILL));
    }
    for (let col = 2; col <= table.columns.length + 2; col++) sheet.getColumn(col).numFmt = MONEY;
  }
  return toBuffer(book);
}
