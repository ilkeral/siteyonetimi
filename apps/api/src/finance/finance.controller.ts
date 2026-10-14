import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { duesRunSchema, moneySchema, paginationSchema, uuidSchema } from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { Roles } from '../common/decorators';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { orderBy, paginate, toPage } from '../common/pagination';
import { AuditService } from '../common/audit.service';
import { LedgerService } from './ledger.service';
import { DuesService } from './dues.service';
import { TransactionsService } from './transactions.service';
import { LateFeeService } from './late-fee.service';
import { BankService } from './bank.service';
import { DashboardService } from './dashboard.service';

const dateRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const collectionSchema = z.object({
  accountId: uuidSchema,
  cashAccountId: uuidSchema,
  amount: moneySchema,
  date: z.coerce.date(),
  description: z.string().max(500).optional(),
  bankTransactionId: uuidSchema.optional(),
});

const expenseSchema = z.object({
  accountId: uuidSchema,
  categoryId: uuidSchema,
  amount: moneySchema,
  date: z.coerce.date(),
  dueDate: z.coerce.date().optional().nullable(),
  description: z.string().max(500).optional(),
  ticketId: uuidSchema.optional(),
});

const paymentSchema = z.object({
  accountId: uuidSchema,
  cashAccountId: uuidSchema,
  amount: moneySchema,
  date: z.coerce.date(),
  description: z.string().max(500).optional(),
});

const bankImportSchema = z.object({
  bankAccountId: uuidSchema,
  rows: z
    .array(
      z.object({
        date: z.union([z.string(), z.coerce.date()]),
        amount: moneySchema,
        description: z.string().max(500),
        balance: moneySchema.optional().nullable(),
        reference: z.string().max(100).optional().nullable(),
      }),
    )
    .min(1, 'En az bir satır gerekli')
    .max(5000, 'Tek seferde en fazla 5000 satır yüklenebilir'),
});

@ApiTags('Finans')
@Controller('finance')
export class FinanceController {
  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly ledger: LedgerService,
    private readonly dues: DuesService,
    private readonly transactions: TransactionsService,
    private readonly lateFee: LateFeeService,
    private readonly bank: BankService,
    private readonly dashboard: DashboardService,
    private readonly audit: AuditService,
  ) {}

  // ----------------------------------------------------------------- cariler

  @Get('accounts')
  @ApiOperation({ summary: 'Cari hesap listesi (bakiyeli)' })
  async accounts(
    @Query(new ZodQuery(paginationSchema.extend({ type: z.string().optional() })))
    query: { page: number; pageSize: number; search?: string; letter?: string; type?: string; sortBy?: string; sortDir: 'asc' | 'desc' },
  ) {
    const where = {
      ...(query.type ? { type: query.type as never } : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
      ...(query.letter
        ? { name: { startsWith: query.letter, mode: 'insensitive' as const } }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.account.findMany({
        where,
        ...paginate(query as never),
        orderBy: orderBy(query as never, ['name', 'type', 'createdAt'], { name: 'asc' }),
        select: { id: true, name: true, type: true, code: true, isActive: true, personId: true },
      }),
      this.db.account.count({ where }),
    ]);

    const balances = await this.ledger.balancesOf(items.map((i) => i.id));
    return toPage(
      items.map((item) => ({ ...item, balanceMinor: balances.get(item.id) ?? 0 })),
      total,
      query as never,
    );
  }

  @Get('accounts/:id/statement')
  @ApiOperation({ summary: 'Cari hesap ekstresi (yürüyen bakiyeli)' })
  async statement(@Param('id') id: string, @Query(new ZodQuery(dateRangeSchema)) range: { from?: Date; to?: Date }) {
    const from = range.from ?? new Date(new Date().getFullYear(), 0, 1);
    const to = range.to ?? new Date();
    return this.ledger.statement(id, from, to);
  }

  @Get('accounts/:id/open-items')
  @ApiOperation({ summary: 'Carinin kapanmamış borçları' })
  async openItems(@Param('id') id: string) {
    const [items, advanceMinor] = await Promise.all([
      this.ledger.openItems(id),
      this.ledger.advanceOf(id),
    ]);
    return {
      items,
      totalMinor: items.reduce((a, i) => a + i.remainingMinor, 0),
      advanceMinor,
    };
  }

  // ------------------------------------------------------------------- aidat

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Post('dues/preview')
  @ApiOperation({ summary: 'Aidat tahakkuk önizlemesi (hiçbir şey yazılmaz)' })
  preview(@Body(new ZodBody(duesRunSchema)) dto: never) {
    return this.dues.preview(dto as never);
  }

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Post('dues/generate')
  @ApiOperation({ summary: 'Aidat tahakkukunu oluştur ve işle' })
  async generate(@Body(new ZodBody(duesRunSchema)) dto: never) {
    const result = await this.dues.generate(dto as never);
    await this.audit.record({
      action: 'POST',
      entityType: 'DuesRun',
      entityId: result.duesRunId,
      after: result,
    });
    return result;
  }

  @Get('dues/runs')
  @ApiOperation({ summary: 'Dönemsel tahakkuk listesi' })
  runs() {
    return this.dues.list();
  }

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Post('dues/runs/:id/cancel')
  @ApiOperation({ summary: 'Dönem tahakkukunu iptal et' })
  async cancelRun(@Param('id') id: string) {
    const result = await this.dues.cancelRun(id);
    await this.audit.record({ action: 'CANCEL', entityType: 'DuesRun', entityId: id });
    return result;
  }

  @Get('dues/items')
  @ApiOperation({ summary: 'Aidat kalemleri' })
  duesItems() {
    return this.db.duesItem.findMany({ where: { isActive: true }, orderBy: { order: 'asc' } });
  }

  // -------------------------------------------------------- gecikme tazminatı

  @Get('late-fees/preview')
  @ApiOperation({ summary: 'Gecikme tazminatı önizlemesi' })
  lateFeePreview(@Query(new ZodQuery(z.object({ asOf: z.coerce.date().optional() }))) q: { asOf?: Date }) {
    return this.lateFee.preview(q.asOf);
  }

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Post('late-fees/apply')
  @ApiOperation({ summary: 'Gecikme tazminatlarını işle' })
  async applyLateFees(@Body(new ZodBody(z.object({ asOf: z.coerce.date().optional() }))) dto: { asOf?: Date }) {
    const result = await this.lateFee.apply(dto.asOf);
    await this.audit.record({ action: 'POST', entityType: 'LateFee', after: result });
    return result;
  }

  // ---------------------------------------------------------------- hareketler

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Post('collections')
  @ApiOperation({ summary: 'Tahsilat makbuzu oluştur' })
  async collect(@Body(new ZodBody(collectionSchema)) dto: z.infer<typeof collectionSchema>) {
    const document = await this.transactions.collect(dto);
    await this.audit.record({
      action: 'CREATE',
      entityType: 'Document',
      entityId: document.id,
      after: { type: 'COLLECTION', ...dto },
    });
    return document;
  }

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Post('expenses')
  @ApiOperation({ summary: 'Gider faturası kaydet' })
  async expense(@Body(new ZodBody(expenseSchema)) dto: z.infer<typeof expenseSchema>) {
    const document = await this.transactions.expense(dto);
    await this.audit.record({
      action: 'CREATE',
      entityType: 'Document',
      entityId: document.id,
      after: { type: 'EXPENSE', ...dto },
    });
    return document;
  }

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Post('payments')
  @ApiOperation({ summary: 'Tedarikçiye/personele ödeme' })
  pay(@Body(new ZodBody(paymentSchema)) dto: z.infer<typeof paymentSchema>) {
    return this.transactions.pay(dto);
  }

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Post('documents/:id/cancel')
  @ApiOperation({ summary: 'Evrak iptal' })
  async cancelDocument(
    @Param('id') id: string,
    @Body(new ZodBody(z.object({ reason: z.string().max(300).optional() }))) dto: { reason?: string },
  ) {
    await this.ledger.cancel(id, dto.reason);
    await this.audit.record({ action: 'CANCEL', entityType: 'Document', entityId: id });
    return { ok: true };
  }

  @Get('documents')
  @ApiOperation({ summary: 'Evrak listesi' })
  async documents(
    @Query(new ZodQuery(paginationSchema.extend({ type: z.string().optional(), period: z.string().optional() })))
    query: never,
  ) {
    const q = query as { page: number; pageSize: number; type?: string; period?: string; search?: string };
    const where = {
      ...(q.type ? { type: q.type as never } : {}),
      ...(q.period ? { period: q.period } : {}),
      ...(q.search ? { number: { contains: q.search, mode: 'insensitive' as const } } : {}),
    };

    const [items, total] = await Promise.all([
      this.db.document.findMany({
        where,
        ...paginate(query as never),
        orderBy: { date: 'desc' },
        include: {
          unit: { select: { doorNumber: true } },
          entries: { select: { account: { select: { name: true } } }, take: 1 },
        },
      }),
      this.db.document.count({ where }),
    ]);

    return toPage(items, total, query as never);
  }

  // -------------------------------------------------------------------- banka

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Post('bank/import')
  @ApiOperation({ summary: 'Banka ekstresi içe aktar (Excel/CSV satırları)' })
  async importBank(@Body(new ZodBody(bankImportSchema)) dto: z.infer<typeof bankImportSchema>) {
    const result = await this.bank.import(dto.bankAccountId, dto.rows as never);
    await this.audit.record({ action: 'IMPORT', entityType: 'BankTransaction', after: result });
    return result;
  }

  @Get('bank/pending')
  @ApiOperation({ summary: 'Eşleşmeyi bekleyen banka hareketleri' })
  pendingBank() {
    return this.bank.listPending();
  }

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Post('bank/:id/match')
  @ApiOperation({ summary: 'Banka hareketini elle eşleştir' })
  matchBank(
    @Param('id') id: string,
    @Body(new ZodBody(z.object({ accountId: uuidSchema }))) dto: { accountId: string },
  ) {
    return this.bank.matchManually(id, dto.accountId);
  }

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Post('bank/:id/ignore')
  @ApiOperation({ summary: 'Banka hareketini yok say' })
  ignoreBank(@Param('id') id: string) {
    return this.bank.ignore(id);
  }

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Post('bank/auto-match')
  @ApiOperation({ summary: 'Bekleyen hareketleri otomatik eşleştir' })
  async autoMatch() {
    const matched = await this.bank.autoMatch();
    return { matched };
  }

  // --------------------------------------------------------------- gösterge

  @Get('dashboard')
  @ApiOperation({ summary: 'Panodaki tüm kartların verisi' })
  async dashboardData(@Query(new ZodQuery(dateRangeSchema)) range: { from?: Date; to?: Date }) {
    const year = new Date().getFullYear();
    const from = range.from ?? new Date(year, 0, 1);
    const to = range.to ?? new Date(year, 11, 31, 23, 59, 59);

    const [collection, distribution, payables, cash, counters] = await Promise.all([
      this.dashboard.duesCollectionByPeriod(10),
      this.dashboard.distribution(from, to),
      this.dashboard.payableInvoices(),
      this.dashboard.cashPosition(),
      this.dashboard.counters(),
    ]);

    return { collection, distribution, payables, cash, counters, range: { from, to } };
  }

  @Get('categories')
  @ApiOperation({ summary: 'Gelir/gider kategorileri' })
  categories(@Query('kind') kind?: string) {
    return this.db.category.findMany({
      where: { isActive: true, ...(kind ? { kind: kind as never } : {}) },
      orderBy: [{ kind: 'asc' }, { order: 'asc' }],
    });
  }
}
