import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  departmentSchema,
  paginationSchema,
  ticketCommentSchema,
  ticketExpenseSchema,
  ticketInvoiceSchema,
  ticketMoveSchema,
  ticketSchema,
  ticketSurveySchema,
  type TicketCommentInput,
  type TicketExpenseInput,
  type TicketInput,
  type TicketMoveInput,
} from '@sy/shared';
import { TicketsService } from './tickets.service';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { AuditService } from '../common/audit.service';

const filterSchema = z.object({
  search: z.string().trim().max(200).optional(),
  departmentId: z.string().uuid().optional(),
  /** Kullanıcı kimliği ya da atanmamışlar için 'none' */
  assigneeId: z.union([z.string().uuid(), z.literal('none')]).optional(),
  requestType: ticketSchema.shape.requestType.removeDefault().optional(),
  priority: ticketSchema.shape.priority.removeDefault().optional(),
  mine: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

const listQuerySchema = paginationSchema.merge(filterSchema).extend({
  status: ticketMoveSchema.shape.status.optional(),
});

/** Gider evrakı kesebilen roller — masrafı faturaya dönüştürmek finansal işlemdir */
const FINANCE_ROLES = ['SITE_ADMIN', 'ACCOUNTANT'] as const;

/**
 * Sakinler (RESIDENT) bu uç noktalara erişemez; kendi talepleri Faz 5'teki
 * portal uç noktalarından gelecek.
 */
@ApiTags('İş Takibi')
@Roles('SITE_ADMIN', 'ACCOUNTANT', 'TECHNICIAN', 'SECURITY')
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly audit: AuditService,
  ) {}

  @Get('board')
  @ApiOperation({ summary: 'Kanban panosu (8 durum kolonu)' })
  board(@Query(new ZodQuery(filterSchema)) query: z.infer<typeof filterSchema>) {
    return this.tickets.board(query);
  }

  @Get('meta')
  @ApiOperation({ summary: 'Form seçenekleri: departmanlar ve atanabilir personel' })
  meta() {
    return this.tickets.meta();
  }

  @Get()
  @ApiOperation({ summary: 'Talep listesi (sayfalı, filtreli)' })
  list(@Query(new ZodQuery(listQuerySchema)) query: z.infer<typeof listQuerySchema>) {
    return this.tickets.list(query as never);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Talep kartı (yorumlar, masraflar, anket, işlem geçmişi)' })
  get(@Param('id') id: string) {
    return this.tickets.get(id);
  }

  @Post()
  @ApiOperation({ summary: 'Yeni talep' })
  async create(@Body(new ZodBody(ticketSchema)) dto: TicketInput) {
    const ticket = await this.tickets.create(dto);
    await this.audit.record({ action: 'CREATE', entityType: 'Ticket', entityId: ticket.id, after: dto });
    return ticket;
  }

  @Put(':id')
  @ApiOperation({ summary: 'Talebi güncelle' })
  async update(@Param('id') id: string, @Body(new ZodBody(ticketSchema)) dto: TicketInput) {
    const ticket = await this.tickets.update(id, dto);
    await this.audit.record({ action: 'UPDATE', entityType: 'Ticket', entityId: id, after: dto });
    return ticket;
  }

  @Put(':id/move')
  @ApiOperation({ summary: 'Kartı taşı (durum + kolon içi sıra)' })
  async move(@Param('id') id: string, @Body(new ZodBody(ticketMoveSchema)) dto: TicketMoveInput) {
    const result = await this.tickets.move(id, dto.status, dto.boardOrder);
    await this.audit.record({
      action: 'UPDATE',
      entityType: 'Ticket',
      entityId: id,
      after: { status: dto.status },
    });
    return result;
  }

  @Roles('SITE_ADMIN')
  @Delete(':id')
  @ApiOperation({ summary: 'Talebi sil' })
  async remove(@Param('id') id: string) {
    const result = await this.tickets.remove(id);
    await this.audit.record({ action: 'DELETE', entityType: 'Ticket', entityId: id });
    return result;
  }

  // ------------------------------------------------------------------ yorum

  @Post(':id/comments')
  @ApiOperation({ summary: 'Yorum / iç not ekle' })
  addComment(
    @Param('id') id: string,
    @Body(new ZodBody(ticketCommentSchema)) dto: TicketCommentInput,
  ) {
    return this.tickets.addComment(id, dto);
  }

  @Delete('comments/:commentId')
  @ApiOperation({ summary: 'Yorumu sil (yazarı ya da site yöneticisi)' })
  removeComment(@Param('commentId') commentId: string) {
    return this.tickets.removeComment(commentId);
  }

  // ----------------------------------------------------------------- masraf

  @Post(':id/expenses')
  @ApiOperation({ summary: 'Masraf ekle (isteğe bağlı olarak gider faturası keserek)' })
  async addExpense(
    @Param('id') id: string,
    @Body(new ZodBody(ticketExpenseSchema)) dto: TicketExpenseInput,
    @CurrentUser() user: AuthUser,
  ) {
    if (dto.invoice) assertFinanceRole(user);
    const expense = await this.tickets.addExpense(id, dto);
    await this.audit.record({ action: 'CREATE', entityType: 'TicketExpense', entityId: expense.id, after: dto });
    return expense;
  }

  @Roles(...FINANCE_ROLES)
  @Post('expenses/:expenseId/invoice')
  @ApiOperation({ summary: 'Masrafı gider faturasına dönüştür' })
  async convertExpense(
    @Param('expenseId') expenseId: string,
    @Body(new ZodBody(ticketInvoiceSchema)) dto: z.infer<typeof ticketInvoiceSchema>,
  ) {
    const expense = await this.tickets.convertExpense(expenseId, dto);
    await this.audit.record({ action: 'POST', entityType: 'TicketExpense', entityId: expenseId, after: dto });
    return expense;
  }

  @Delete('expenses/:expenseId')
  @ApiOperation({ summary: 'Masrafı sil (faturaya dönüşmemişse)' })
  async removeExpense(@Param('expenseId') expenseId: string) {
    const result = await this.tickets.removeExpense(expenseId);
    await this.audit.record({ action: 'DELETE', entityType: 'TicketExpense', entityId: expenseId });
    return result;
  }

  // ------------------------------------------------------------------ anket

  @Put(':id/survey')
  @ApiOperation({ summary: 'Memnuniyet anketi sonucunu kaydet (tamamlanan talep)' })
  saveSurvey(
    @Param('id') id: string,
    @Body(new ZodBody(ticketSurveySchema)) dto: z.infer<typeof ticketSurveySchema>,
  ) {
    return this.tickets.saveSurvey(id, dto);
  }
}

@ApiTags('İş Takibi')
@Controller('departments')
export class DepartmentsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly audit: AuditService,
  ) {}

  @Roles('SITE_ADMIN')
  @Post()
  @ApiOperation({ summary: 'Departman oluştur' })
  async create(@Body(new ZodBody(departmentSchema)) dto: z.infer<typeof departmentSchema>) {
    const department = await this.tickets.saveDepartment(null, dto);
    await this.audit.record({ action: 'CREATE', entityType: 'Department', entityId: department.id, after: dto });
    return department;
  }

  @Roles('SITE_ADMIN')
  @Put(':id')
  @ApiOperation({ summary: 'Departman güncelle' })
  async update(
    @Param('id') id: string,
    @Body(new ZodBody(departmentSchema)) dto: z.infer<typeof departmentSchema>,
  ) {
    const department = await this.tickets.saveDepartment(id, dto);
    await this.audit.record({ action: 'UPDATE', entityType: 'Department', entityId: id, after: dto });
    return department;
  }
}

function assertFinanceRole(user: AuthUser) {
  if (user.isSuperAdmin) return;
  if (!user.role || !(FINANCE_ROLES as readonly string[]).includes(user.role)) {
    throw new ForbiddenException('Gider faturası kesme yetkiniz yok');
  }
}
