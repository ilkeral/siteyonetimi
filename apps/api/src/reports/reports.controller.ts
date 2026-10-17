import { Controller, Get, HttpCode, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { moneySchema, toMinor } from '@sy/shared';
import { ReportsService } from './reports.service';
import { PaymentScoreService } from './payment-score.service';
import { agingPdf, incomeStatementPdf, statementPdf } from './pdf';
import { agingXlsx, incomeStatementXlsx, statementXlsx } from './xlsx';
import { Roles } from '../common/decorators';
import { ZodQuery } from '../common/zod-validation.pipe';
import { AuditService } from '../common/audit.service';

/** "true"/"false" sorgu parametresi — KVKK maskesi varsayılan AÇIK (gizlilik öntanımlı) */
const maskParam = z
  .enum(['true', 'false'])
  .default('true')
  .transform((v) => v === 'true');

const statementQuerySchema = z.object({
  accountIds: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').filter(Boolean) : undefined))
    .pipe(z.array(z.string().uuid('Geçersiz cari')).max(500).optional()),
  from: z.coerce.date(),
  to: z.coerce.date(),
  minDebt: moneySchema.optional(),
  minCredit: moneySchema.optional(),
  sort: z.enum(['date', 'number']).default('date'),
  mask: maskParam,
});

const agingQuerySchema = z.object({
  asOf: z.coerce.date().default(() => new Date()),
  blockId: z.string().uuid().optional(),
  mask: maskParam,
});

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Ay YYYY-AA biçiminde olmalı');
const incomeQuerySchema = z.object({ from: month, to: month });

const FILE_TYPES = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

function reportFile(res: Response, name: string, type: keyof typeof FILE_TYPES, buffer: Buffer) {
  const stamp = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Type': FILE_TYPES[type],
    'Content-Disposition': `attachment; filename="${name}-${stamp}.${type}"`,
    'Cache-Control': 'no-store',
  });
  return new StreamableFile(buffer);
}

const pdfFile = (res: Response, name: string, buffer: Buffer) => reportFile(res, name, 'pdf', buffer);

@ApiTags('Raporlar')
@Roles('SITE_ADMIN', 'ACCOUNTANT')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly scores: PaymentScoreService,
    private readonly audit: AuditService,
  ) {}

  private statementQuery(q: z.infer<typeof statementQuerySchema>) {
    return {
      accountIds: q.accountIds,
      from: q.from,
      // Son tarih gün sonuna kadar
      to: new Date(new Date(q.to).setHours(23, 59, 59, 999)),
      minDebtMinor: q.minDebt !== undefined ? toMinor(q.minDebt) : undefined,
      minCreditMinor: q.minCredit !== undefined ? toMinor(q.minCredit) : undefined,
      sort: q.sort,
      mask: q.mask,
    };
  }

  @Get('statements')
  @ApiOperation({ summary: 'Cari hesap ekstresi (çoklu cari, KVKK maskesi)' })
  statements(@Query(new ZodQuery(statementQuerySchema)) q: z.infer<typeof statementQuerySchema>) {
    return this.reports.statements(this.statementQuery(q));
  }

  @Get('statements/pdf')
  @ApiOperation({ summary: 'Cari hesap ekstresi — PDF' })
  async statementsPdf(
    @Query(new ZodQuery(statementQuerySchema)) q: z.infer<typeof statementQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reports.statements(this.statementQuery(q));
    // KVKK hesap verebilirlik: kim, hangi raporu, maskeli mi dışa aldı
    await this.audit.record({
      action: 'EXPORT',
      entityType: 'StatementReport',
      after: { accounts: data.accounts.length, from: q.from, to: q.to, masked: q.mask },
    });
    return pdfFile(res, 'cari-ekstre', await statementPdf(data));
  }

  @Get('statements/xlsx')
  @ApiOperation({ summary: 'Cari hesap ekstresi — Excel' })
  async statementsXlsx(
    @Query(new ZodQuery(statementQuerySchema)) q: z.infer<typeof statementQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reports.statements(this.statementQuery(q));
    await this.audit.record({
      action: 'EXPORT',
      entityType: 'StatementReport',
      after: { format: 'xlsx', accounts: data.accounts.length, from: q.from, to: q.to, masked: q.mask },
    });
    return reportFile(res, 'cari-ekstre', 'xlsx', await statementXlsx(data));
  }

  @Get('aging')
  @ApiOperation({ summary: 'Borç yaşlandırma (0–30 / 31–60 / 61–90 / 90+ gün)' })
  aging(@Query(new ZodQuery(agingQuerySchema)) q: z.infer<typeof agingQuerySchema>) {
    return this.reports.aging(q.asOf, q.mask, q.blockId);
  }

  @Get('aging/pdf')
  @ApiOperation({ summary: 'Borç yaşlandırma — PDF' })
  async agingPdf(@Query(new ZodQuery(agingQuerySchema)) q: z.infer<typeof agingQuerySchema>, @Res({ passthrough: true }) res: Response) {
    const data = await this.reports.aging(q.asOf, q.mask, q.blockId);
    await this.audit.record({
      action: 'EXPORT',
      entityType: 'AgingReport',
      after: { rows: data.rows.length, asOf: q.asOf, masked: q.mask },
    });
    return pdfFile(res, 'borc-yaslandirma', await agingPdf(data));
  }

  @Get('aging/xlsx')
  @ApiOperation({ summary: 'Borç yaşlandırma — Excel' })
  async agingXlsx(@Query(new ZodQuery(agingQuerySchema)) q: z.infer<typeof agingQuerySchema>, @Res({ passthrough: true }) res: Response) {
    const data = await this.reports.aging(q.asOf, q.mask, q.blockId);
    await this.audit.record({
      action: 'EXPORT',
      entityType: 'AgingReport',
      after: { format: 'xlsx', rows: data.rows.length, asOf: q.asOf, masked: q.mask },
    });
    return reportFile(res, 'borc-yaslandirma', 'xlsx', await agingXlsx(data));
  }

  // ---------------------------------------------------------- gelir-gider

  @Get('income-statement')
  @ApiOperation({ summary: 'Gelir-gider (tahakkuk esaslı, kategori × ay) ve kasa+banka nakit durumu' })
  incomeStatement(@Query(new ZodQuery(incomeQuerySchema)) q: z.infer<typeof incomeQuerySchema>) {
    return this.reports.incomeStatement(q.from, q.to);
  }

  @Get('income-statement/pdf')
  @ApiOperation({ summary: 'Gelir-gider — PDF' })
  async incomeStatementPdf(@Query(new ZodQuery(incomeQuerySchema)) q: z.infer<typeof incomeQuerySchema>, @Res({ passthrough: true }) res: Response) {
    const data = await this.reports.incomeStatement(q.from, q.to);
    await this.audit.record({ action: 'EXPORT', entityType: 'IncomeStatement', after: { format: 'pdf', ...q } });
    return reportFile(res, 'gelir-gider', 'pdf', await incomeStatementPdf(data));
  }

  @Get('income-statement/xlsx')
  @ApiOperation({ summary: 'Gelir-gider — Excel' })
  async incomeStatementXlsx(@Query(new ZodQuery(incomeQuerySchema)) q: z.infer<typeof incomeQuerySchema>, @Res({ passthrough: true }) res: Response) {
    const data = await this.reports.incomeStatement(q.from, q.to);
    await this.audit.record({ action: 'EXPORT', entityType: 'IncomeStatement', after: { format: 'xlsx', ...q } });
    return reportFile(res, 'gelir-gider', 'xlsx', await incomeStatementXlsx(data));
  }

  @Get('payment-scores')
  @ApiOperation({ summary: 'Ödeme skoru: site özeti, trend, kıyas ve kişi listesi' })
  paymentScores(@Query(new ZodQuery(z.object({ mask: maskParam }))) q: { mask: boolean }) {
    return this.reports.paymentScores(q.mask);
  }

  @Get('payment-scores/person/:personId')
  @Roles('SITE_ADMIN', 'ACCOUNTANT', 'TECHNICIAN', 'SECURITY')
  @ApiOperation({ summary: 'Kişinin son ödeme skoru (kişi kartı rozeti)' })
  personScore(@Param('personId') personId: string) {
    return this.reports.personScore(personId);
  }

  @Post('payment-scores/recalculate')
  @Roles('SITE_ADMIN')
  @HttpCode(200)
  @ApiOperation({ summary: 'Bu sitenin skorlarını şimdi yeniden hesapla' })
  recalculate() {
    return this.scores.computeSite();
  }
}
