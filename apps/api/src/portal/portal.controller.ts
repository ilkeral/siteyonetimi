import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { statementPdf } from '../reports/pdf';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  announcementSchema,
  paginationSchema,
  portalAccessSchema,
  portalCommentSchema,
  portalPaymentSchema,
  portalTicketSchema,
  ticketSurveySchema,
  type AnnouncementInput,
  type PortalPaymentInput,
  type PortalTicketInput,
} from '@sy/shared';
import { PortalService } from './portal.service';
import { PortalAdminService } from './portal-admin.service';
import { Feature, Roles } from '../common/decorators';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { AuditService } from '../common/audit.service';

const statementQuerySchema = z.object({
  from: z.coerce.date().default(() => new Date(new Date().getFullYear(), 0, 1)),
  to: z.coerce.date().default(() => new Date()),
});

/**
 * İKAMET EDEN PORTALI — yalnızca RESIDENT. Kimlik doğrulama katmanı ikamet edeni bu
 * işaretli olmayan hiçbir uç noktaya geçirmez (varsayılan ret).
 */
@ApiTags('İkamet Eden Portalı')
@Roles('RESIDENT')
@Feature('portal')
@Controller('portal')
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly audit: AuditService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: 'Özet: bakiye, açık borçlar, duyurular, talepler, mesajlar' })
  summary() {
    return this.portal.summary();
  }

  @Get('statement')
  @ApiOperation({ summary: 'Kendi cari hesap ekstresi' })
  statement(@Query(new ZodQuery(statementQuerySchema)) query: z.infer<typeof statementQuerySchema>) {
    return this.portal.statement(query.from, query.to);
  }

  @Get('statement/pdf')
  @ApiOperation({ summary: 'Kendi cari hesap ekstresi — PDF' })
  async statementPdf(
    @Query(new ZodQuery(statementQuerySchema)) query: z.infer<typeof statementQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const to = new Date(new Date(query.to).setHours(23, 59, 59, 999));
    const buffer = await statementPdf(await this.portal.statementReport(query.from, to));
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="hesap-ekstresi-${new Date().toISOString().slice(0, 10)}.pdf"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(buffer);
  }

  @Get('announcements')
  @ApiOperation({ summary: 'Yayındaki duyurular' })
  announcements() {
    return this.portal.announcements();
  }

  @Get('messages')
  @ApiOperation({ summary: 'Bana gönderilen bildirimler' })
  messages(@Query(new ZodQuery(paginationSchema)) query: z.infer<typeof paginationSchema>) {
    return this.portal.messages(query);
  }

  @Get('tickets')
  @ApiOperation({ summary: 'Taleplerim' })
  tickets() {
    return this.portal.myTickets();
  }

  @Get('tickets/:id')
  @ApiOperation({ summary: 'Talep ayrıntısı (yalnızca herkese açık yorumlar)' })
  ticket(@Param('id') id: string) {
    return this.portal.ticket(id);
  }

  @Post('tickets')
  @ApiOperation({ summary: 'Yeni talep / arıza bildirimi' })
  async createTicket(@Body(new ZodBody(portalTicketSchema)) dto: PortalTicketInput) {
    const ticket = await this.portal.createTicket(dto);
    await this.audit.record({ action: 'CREATE', entityType: 'Ticket', entityId: ticket.id, after: dto });
    return { id: ticket.id, number: ticket.number };
  }

  @Post('tickets/:id/comments')
  @ApiOperation({ summary: 'Talebe yorum yaz' })
  async comment(@Param('id') id: string, @Body(new ZodBody(portalCommentSchema)) dto: { body: string }) {
    const comment = await this.portal.comment(id, dto.body);
    return { id: comment.id };
  }

  @Put('tickets/:id/survey')
  @ApiOperation({ summary: 'Tamamlanan talebi puanla' })
  survey(@Param('id') id: string, @Body(new ZodBody(ticketSurveySchema)) dto: z.infer<typeof ticketSurveySchema>) {
    return this.portal.survey(id, dto);
  }

  @Post('payments')
  @HttpCode(200)
  @ApiOperation({ summary: 'Kartla çevrimiçi ödeme (mock sağlayıcı)' })
  async pay(@Body(new ZodBody(portalPaymentSchema)) dto: PortalPaymentInput) {
    const result = await this.portal.pay(dto);
    // Denetim kaydına kart bilgisi yazılmaz
    await this.audit.record({
      action: 'POST',
      entityType: 'OnlinePayment',
      entityId: result.documentId,
      after: { amountMinor: result.amountMinor, card: result.card },
    });
    return result;
  }
}

@ApiTags('İletişim')
@Roles('SITE_ADMIN', 'ACCOUNTANT')
@Feature('portal')
@Controller('announcements')
export class AnnouncementsController {
  constructor(
    private readonly admin: PortalAdminService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Tüm duyurular (yayında olmayanlar dahil)' })
  list() {
    return this.admin.listAnnouncements();
  }

  @Post()
  @ApiOperation({ summary: 'Duyuru oluştur' })
  async create(@Body(new ZodBody(announcementSchema)) dto: AnnouncementInput) {
    const announcement = await this.admin.createAnnouncement(dto);
    await this.audit.record({ action: 'CREATE', entityType: 'Announcement', entityId: announcement.id, after: dto });
    return announcement;
  }

  @Put(':id')
  @ApiOperation({ summary: 'Duyuru güncelle' })
  async update(@Param('id') id: string, @Body(new ZodBody(announcementSchema)) dto: AnnouncementInput) {
    const announcement = await this.admin.updateAnnouncement(id, dto);
    await this.audit.record({ action: 'UPDATE', entityType: 'Announcement', entityId: id, after: dto });
    return announcement;
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Duyuru sil' })
  async remove(@Param('id') id: string) {
    const result = await this.admin.removeAnnouncement(id);
    await this.audit.record({ action: 'DELETE', entityType: 'Announcement', entityId: id });
    return result;
  }
}

/** Kişi kartındaki "Portal Erişimi" — hesap açmak/kapatmak yalnızca site yöneticisi */
@ApiTags('Kişiler')
@Roles('SITE_ADMIN')
@Feature('portal')
@Controller('people/:personId/portal-access')
export class PortalAccessController {
  constructor(
    private readonly admin: PortalAdminService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Portal erişim durumu' })
  get(@Param('personId') personId: string) {
    return this.admin.access(personId);
  }

  @Post()
  @ApiOperation({ summary: 'Portal erişimi ver (yeni hesapta geçici parola bir kez döner)' })
  async grant(@Param('personId') personId: string, @Body(new ZodBody(portalAccessSchema)) dto: { email: string }) {
    const result = await this.admin.grant(personId, dto.email);
    // Geçici parola denetim kaydına yazılmaz
    await this.audit.record({ action: 'CREATE', entityType: 'PortalAccess', entityId: personId, after: { email: dto.email } });
    return result;
  }

  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Geçici parola üret (oturumlar kapanır)' })
  async reset(@Param('personId') personId: string) {
    const result = await this.admin.resetPassword(personId);
    await this.audit.record({ action: 'UPDATE', entityType: 'PortalAccess', entityId: personId, after: { reset: true } });
    return result;
  }

  @Delete()
  @ApiOperation({ summary: 'Portal erişimini kaldır' })
  async revoke(@Param('personId') personId: string) {
    const result = await this.admin.revoke(personId);
    await this.audit.record({ action: 'DELETE', entityType: 'PortalAccess', entityId: personId });
    return result;
  }
}
