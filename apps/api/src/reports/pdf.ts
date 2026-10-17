import PDFDocument from 'pdfkit';
import { dirname, join } from 'node:path';
import { DOCUMENT_TYPE_LABELS, formatDateTR, formatPeriodShortTR } from '@sy/shared';
import { incomeStatementTables, type IncomeStatementData, type TableRow } from './income-statement-table';
import type { AgingBucket } from './reports.service';

/**
 * PDF ÇIKTISI (pdfkit)
 *
 * PDF'in yerleşik Helvetica'sında ş/ğ/ı/İ yoktur; Türkçe metin için DejaVu
 * (açık lisanslı) gömülür. Tutarlar "1.234,56" biçiminde, para birimi sütun
 * başlığında "TL" olarak yazılır.
 */

const FONT_DIR = join(dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const FONTS = {
  regular: join(FONT_DIR, 'DejaVuSansCondensed.ttf'),
  bold: join(FONT_DIR, 'DejaVuSansCondensed-Bold.ttf'),
};

const NUMBER = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amount = (minor: number) => NUMBER.format(minor / 100);
const day = (value: Date | string | null | undefined) => (value ? formatDateTR(new Date(value)) : '');

export interface Column<T> {
  header: string;
  width: number;
  align?: 'left' | 'right';
  value: (row: T) => string;
  bold?: (row: T) => boolean;
}

export interface SiteInfo {
  name: string;
  city: string | null;
  district: string | null;
}

/** Ortak belge: başlık, alt bilgi (sayfa no, maske notu) ve tablo çizimi */
export class ReportPdf {
  readonly doc: PDFKit.PDFDocument;
  private readonly chunks: Buffer[] = [];

  constructor(
    private readonly title: string,
    private readonly site: SiteInfo,
    private readonly masked: boolean,
    layout: 'portrait' | 'landscape' = 'portrait',
  ) {
    this.doc = new PDFDocument({
      size: 'A4',
      layout,
      margins: { top: 40, bottom: 50, left: 36, right: 36 },
      bufferPages: true,
      info: { Title: title, Author: site.name, Producer: 'Site Yönetim' },
    });
    this.doc.registerFont('regular', FONTS.regular);
    this.doc.registerFont('bold', FONTS.bold);
    this.doc.font('regular');
    this.doc.on('data', (chunk: Buffer) => this.chunks.push(chunk));
  }

  get width() {
    return this.doc.page.width - this.doc.page.margins.left - this.doc.page.margins.right;
  }

  private get bottom() {
    return this.doc.page.height - this.doc.page.margins.bottom;
  }

  header(subtitle: string) {
    const { doc } = this;
    doc.font('bold').fontSize(14).fillColor('#112b4a').text(this.site.name, { continued: false });
    doc.font('regular').fontSize(9).fillColor('#5b6b7c')
      .text([this.site.district, this.site.city].filter(Boolean).join(' / '));
    doc.moveDown(0.6);
    doc.font('bold').fontSize(12).fillColor('#112b4a').text(this.title);
    doc.font('regular').fontSize(9).fillColor('#5b6b7c').text(subtitle);
    doc.moveDown(0.8);
    doc.fillColor('#000');
  }

  /** Sayfa sonuna yaklaşınca yeni sayfa aç */
  ensure(height: number) {
    if (this.doc.y + height > this.bottom) this.doc.addPage();
  }

  table<T>(columns: Column<T>[], rows: T[], options: { fontSize?: number } = {}) {
    const { doc } = this;
    const fontSize = options.fontSize ?? 8;
    const left = doc.page.margins.left;
    const padding = 3;

    const drawHeader = () => {
      const y = doc.y;
      doc.font('bold').fontSize(fontSize);
      // Uzun başlık ("Vadesi gelmemiş") dar sütunda sarabilir: yükseklik ölçülür
      const height =
        Math.max(...columns.map((col) => doc.heightOfString(col.header, { width: col.width - padding * 2 }))) + 8;
      doc.rect(left, y, this.width, height).fill('#eef3f7');
      doc.fillColor('#112b4a');
      let x = left;
      for (const col of columns) {
        doc.text(col.header, x + padding, y + 4, { width: col.width - padding * 2, align: col.align ?? 'left' });
        x += col.width;
      }
      doc.y = y + height;
      doc.fillColor('#000').font('regular');
    };

    this.ensure(40);
    drawHeader();
    rows.forEach((row, index) => {
      doc.fontSize(fontSize);
      const height =
        Math.max(...columns.map((col) => doc.heightOfString(col.value(row) || ' ', { width: col.width - padding * 2 }))) + 5;
      if (doc.y + height > this.bottom) {
        doc.addPage();
        drawHeader();
      }
      const y = doc.y;
      if (index % 2 === 1) doc.rect(left, y, this.width, height).fill('#f8fafb').fillColor('#000');
      let x = left;
      for (const col of columns) {
        doc.font(col.bold?.(row) ? 'bold' : 'regular').fontSize(fontSize)
          .text(col.value(row), x + padding, y + 2.5, { width: col.width - padding * 2, align: col.align ?? 'left' });
        x += col.width;
      }
      doc.y = y + height;
    });
    // Sonraki metin sol kenardan başlasın (text() imleci son sütunda bırakır)
    doc.x = left;
    doc.font('regular');
  }

  /** Tüm sayfalara alt bilgi yazıp belgeyi kapatır */
  async finish(): Promise<Buffer> {
    const { doc } = this;
    const range = doc.bufferedPageRange();
    const generated = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const y = doc.page.height - 32;
      // Alt kenar boşluğuna yazarken otomatik sayfa eklenmesin
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('regular').fontSize(7).fillColor('#8794a1');
      doc.text(
        `${this.site.name} · ${generated}${this.masked ? ' · KVKK: kişisel veriler maskelenmiştir' : ''}`,
        doc.page.margins.left,
        y,
        { width: this.width - 60, lineBreak: false },
      );
      doc.text(`Sayfa ${i - range.start + 1} / ${range.count}`, doc.page.margins.left, y, { width: this.width, align: 'right' });
      doc.page.margins.bottom = bottomMargin;
    }
    return new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(this.chunks)));
      doc.end();
    });
  }
}

// ------------------------------------------------------------------ ekstre

export interface StatementData {
  site: SiteInfo;
  from: Date;
  to: Date;
  masked: boolean;
  accounts: {
    name: string;
    units: string[];
    phone: string | null;
    openingBalanceMinor: number;
    closingBalanceMinor: number;
    totalDebitMinor: number;
    totalCreditMinor: number;
    lines: {
      date: Date;
      documentNumber: string;
      documentType: string;
      description: string;
      debitMinor: number;
      creditMinor: number;
      balanceMinor: number;
    }[];
  }[];
}

export async function statementPdf(data: StatementData): Promise<Buffer> {
  const pdf = new ReportPdf('Cari Hesap Ekstresi', data.site, data.masked);
  const { doc } = pdf;
  pdf.header(`${day(data.from)} – ${day(data.to)} · ${data.accounts.length} cari`);

  type Line = StatementData['accounts'][number]['lines'][number] | { opening: number } | { closing: StatementData['accounts'][number] };
  const w = pdf.width;
  const columns: Column<Line>[] = [
    { header: 'Tarih', width: 52, value: (r) => ('date' in r ? day(r.date) : '') },
    { header: 'Evrak', width: 78, value: (r) => ('documentNumber' in r ? r.documentNumber : '') },
    {
      header: 'Açıklama',
      width: w - 52 - 78 - 3 * 68,
      value: (r) =>
        'opening' in r
          ? 'Devir bakiyesi'
          : 'closing' in r
            ? 'Dönem toplamı'
            : r.description || DOCUMENT_TYPE_LABELS[r.documentType as keyof typeof DOCUMENT_TYPE_LABELS] || r.documentType,
      bold: (r) => 'opening' in r || 'closing' in r,
    },
    {
      header: 'Borç (TL)',
      width: 68,
      align: 'right',
      value: (r) => ('closing' in r ? amount(r.closing.totalDebitMinor) : 'debitMinor' in r && r.debitMinor ? amount(r.debitMinor) : ''),
      bold: (r) => 'closing' in r,
    },
    {
      header: 'Alacak (TL)',
      width: 68,
      align: 'right',
      value: (r) => ('closing' in r ? amount(r.closing.totalCreditMinor) : 'creditMinor' in r && r.creditMinor ? amount(r.creditMinor) : ''),
      bold: (r) => 'closing' in r,
    },
    {
      header: 'Bakiye (TL)',
      width: 68,
      align: 'right',
      value: (r) => amount('opening' in r ? r.opening : 'closing' in r ? r.closing.closingBalanceMinor : r.balanceMinor),
      bold: () => true,
    },
  ];

  data.accounts.forEach((account, index) => {
    if (index > 0) {
      pdf.ensure(120);
      doc.moveDown(1.2);
    }
    const left = doc.page.margins.left;
    doc.font('bold').fontSize(10).fillColor('#112b4a').text(account.name, left, doc.y, { width: pdf.width });
    const meta = [account.units.join(', '), account.phone].filter(Boolean).join(' · ');
    if (meta) doc.font('regular').fontSize(8).fillColor('#5b6b7c').text(meta, left, doc.y, { width: pdf.width });
    doc.fillColor('#000').moveDown(0.3);
    pdf.table<Line>(columns, [{ opening: account.openingBalanceMinor }, ...account.lines, { closing: account }]);
  });

  if (data.accounts.length === 0) {
    doc.fontSize(10).text('Seçilen ölçütlere uyan cari bulunamadı.');
  }
  return pdf.finish();
}

// ------------------------------------------------------------- yaşlandırma

export interface AgingData {
  site: SiteInfo;
  asOf: Date;
  masked: boolean;
  rows: { name: string; units: string[]; phone: string | null; buckets: Record<AgingBucket, number>; totalMinor: number }[];
  totals: Record<AgingBucket, number> & { totalMinor: number };
}

export async function agingPdf(data: AgingData): Promise<Buffer> {
  const pdf = new ReportPdf('Borç Yaşlandırma Raporu', data.site, data.masked, 'landscape');
  pdf.header(`${day(data.asOf)} itibarıyla · ${data.rows.length} borçlu · vadeden bu yana geçen güne göre`);

  type Row = AgingData['rows'][number] | { total: AgingData['totals'] };
  const bucket = (key: AgingBucket) => (r: Row) => amount('total' in r ? r.total[key] : r.buckets[key]);
  const isTotal = (r: Row) => 'total' in r;
  const w = pdf.width;
  pdf.table<Row>(
    [
      { header: 'Kişi', width: 150, value: (r) => ('total' in r ? 'TOPLAM' : r.name), bold: isTotal },
      { header: 'Daire', width: 90, value: (r) => ('units' in r ? r.units.join(', ') : '') },
      { header: 'Telefon', width: 90, value: (r) => ('phone' in r ? (r.phone ?? '') : '') },
      { header: 'Vadesi gelmemiş', width: (w - 330) / 6, align: 'right', value: bucket('notDue'), bold: isTotal },
      { header: '0–30 gün', width: (w - 330) / 6, align: 'right', value: bucket('d0_30'), bold: isTotal },
      { header: '31–60 gün', width: (w - 330) / 6, align: 'right', value: bucket('d31_60'), bold: isTotal },
      { header: '61–90 gün', width: (w - 330) / 6, align: 'right', value: bucket('d61_90'), bold: isTotal },
      { header: '90+ gün', width: (w - 330) / 6, align: 'right', value: bucket('d90'), bold: () => true },
      {
        header: 'Toplam (TL)',
        width: (w - 330) / 6,
        align: 'right',
        value: (r) => amount('total' in r ? r.total.totalMinor : r.totalMinor),
        bold: () => true,
      },
    ],
    [...data.rows, { total: data.totals }],
  );
  return pdf.finish();
}

// ------------------------------------------------------------- gelir-gider

/** Yatay A4'te okunaklı kalması için en fazla 12 ay yan yana basılır */
const PDF_MONTHS_PER_TABLE = 12;

export async function incomeStatementPdf(data: IncomeStatementData): Promise<Buffer> {
  const pdf = new ReportPdf('Gelir-Gider Raporu', data.site, false, 'landscape');
  const { doc } = pdf;
  pdf.header(`${formatPeriodShortTR(data.from)} – ${formatPeriodShortTR(data.to)} · tutarlar TL`);

  for (const table of incomeStatementTables(data)) {
    for (let start = 0; start < table.columns.length; start += PDF_MONTHS_PER_TABLE) {
      const end = Math.min(start + PDF_MONTHS_PER_TABLE, table.columns.length);
      const last = end === table.columns.length;
      const labelWidth = 140;
      const totalWidth = last ? 64 : 0;
      const monthWidth = (pdf.width - labelWidth - totalWidth) / (end - start);
      const strong = (row: TableRow) => row.style !== 'line';
      // Kalem satırında sıfır "—" (ekrandaki gibi); toplamlarda 0,00 yazılır
      const cell = (value: number | null, row?: TableRow) =>
        value === null ? '' : row?.style === 'line' && value === 0 ? '—' : amount(value);

      pdf.ensure(60);
      doc.font('bold').fontSize(10).fillColor('#112b4a')
        .text(start === 0 ? table.title : `${table.title} (devam)`);
      doc.moveDown(0.3).fillColor('#000');

      const columns: Column<TableRow>[] = [
        {
          header: '',
          width: labelWidth,
          value: (row) => (row.style === 'line' ? `   ${row.label}` : row.label),
          bold: strong,
        },
        ...table.columns.slice(start, end).map((header, offset) => ({
          header,
          width: monthWidth,
          align: 'right' as const,
          value: (row: TableRow) => cell(row.values[start + offset], row),
          bold: strong,
        })),
        ...(last
          ? [{ header: table.totalHeader, width: totalWidth, align: 'right' as const, value: (row: TableRow) => cell(row.total, row), bold: () => true }]
          : []),
      ];
      pdf.table(columns, table.rows, { fontSize: 7 });
      doc.moveDown(1);
    }
  }
  return pdf.finish();
}
