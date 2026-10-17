import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  incidentCategorySchema,
  incidentSeveritySchema,
  lostItemCreateSchema,
  lostItemDetailsSchema,
  lostItemStatusSchema,
  lostItemTransitionSchema,
  paginationSchema,
  securityIncidentSchema,
  visitorExitSchema,
  visitorSchema,
  type LostItemCreateInput,
  type LostItemDetailsInput,
  type LostItemTransitionBody,
  type SecurityIncidentInput,
  type VisitorInput,
} from '@sy/shared';
import { Roles } from '../common/decorators';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { SecurityService } from './security.service';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarih YYYY-AA-GG biçiminde olmalı');
/** Güvenlik listelerinde en yeni kayıt üstte */
const newestFirst = { sortDir: z.enum(['asc', 'desc']).default('desc') };

const flag = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

const incidentQuerySchema = paginationSchema.extend({
  ...newestFirst,
  from: day.optional(),
  to: day.optional(),
  search: z.string().trim().max(200).optional(),
  category: incidentCategorySchema.optional(),
  severity: incidentSeveritySchema.optional(),
});

const lostQuerySchema = paginationSchema.extend({
  ...newestFirst,
  search: z.string().trim().max(200).optional(),
  status: lostItemStatusSchema.optional(),
  /** Kapanmamış (kayıp, emanette, sahibi çıktı) kayıtlar */
  open: flag,
});

const visitorQuerySchema = paginationSchema.extend({
  ...newestFirst,
  from: day.optional(),
  to: day.optional(),
  search: z.string().trim().max(200).optional(),
  /** true: içeride olanlar, false: çıkış yapmışlar */
  inside: flag,
});

/**
 * Güvenlik modülü: güvenlik personeli ve site yöneticisi. Sakin (RESIDENT)
 * varsayılan ret kuralıyla zaten giremez; muhasebe ve teknik personel de kapalı.
 * Silme işlemleri yalnızca yönetici.
 */
@ApiTags('Güvenlik')
@Roles('SITE_ADMIN', 'SECURITY')
@Controller('security')
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Güvenlik özeti: içerideki ziyaretçi, son 30 gün olay, emanetteki eşya' })
  summary() {
    return this.security.summary();
  }

  @Get('meta')
  @ApiOperation({ summary: 'Form seçenekleri: görevli personel' })
  meta() {
    return this.security.meta();
  }

  // ---------------------------------------------------------------- olaylar

  @Get('incidents')
  listIncidents(@Query(new ZodQuery(incidentQuerySchema)) query: z.infer<typeof incidentQuerySchema>) {
    return this.security.listIncidents(query);
  }

  @Get('incidents/:id')
  getIncident(@Param('id') id: string) {
    return this.security.getIncident(id);
  }

  @Post('incidents')
  createIncident(@Body(new ZodBody(securityIncidentSchema)) body: SecurityIncidentInput) {
    return this.security.createIncident(body);
  }

  @Put('incidents/:id')
  updateIncident(@Param('id') id: string, @Body(new ZodBody(securityIncidentSchema)) body: SecurityIncidentInput) {
    return this.security.updateIncident(id, body);
  }

  @Delete('incidents/:id')
  @Roles('SITE_ADMIN')
  deleteIncident(@Param('id') id: string) {
    return this.security.deleteIncident(id);
  }

  // ---------------------------------------------------------------- kayıp eşya

  @Get('lost-items')
  listLostItems(@Query(new ZodQuery(lostQuerySchema)) query: z.infer<typeof lostQuerySchema>) {
    return this.security.listLostItems(query);
  }

  @Get('lost-items/:id')
  getLostItem(@Param('id') id: string) {
    return this.security.getLostItem(id);
  }

  @Post('lost-items')
  @ApiOperation({ summary: 'Kayıp bildirimi (LOST) ya da bulunan eşya (FOUND) kaydı' })
  createLostItem(@Body(new ZodBody(lostItemCreateSchema)) body: LostItemCreateInput) {
    return this.security.createLostItem(body);
  }

  @Put('lost-items/:id')
  @ApiOperation({ summary: 'Eşya bilgilerini düzelt (durum değişmez)' })
  updateLostItem(@Param('id') id: string, @Body(new ZodBody(lostItemDetailsSchema)) body: LostItemDetailsInput) {
    return this.security.updateLostItem(id, body);
  }

  @Post('lost-items/:id/transition')
  @ApiOperation({ summary: 'Durum geçişi: bulundu · sahibi çıktı · teslim · imha' })
  transitionLostItem(
    @Param('id') id: string,
    @Body(new ZodBody(lostItemTransitionSchema)) body: LostItemTransitionBody,
  ) {
    return this.security.transitionLostItem(id, body);
  }

  @Delete('lost-items/:id')
  @Roles('SITE_ADMIN')
  @ApiOperation({ summary: 'Kayıp bildirimini geri çek (yalnızca LOST)' })
  deleteLostItem(@Param('id') id: string) {
    return this.security.deleteLostItem(id);
  }

  // ---------------------------------------------------------------- ziyaretçiler

  @Get('visitors')
  listVisitors(@Query(new ZodQuery(visitorQuerySchema)) query: z.infer<typeof visitorQuerySchema>) {
    return this.security.listVisitors(query);
  }

  @Post('visitors')
  @ApiOperation({ summary: 'Ziyaretçi girişi' })
  checkIn(@Body(new ZodBody(visitorSchema)) body: VisitorInput) {
    return this.security.checkIn(body);
  }

  @Post('visitors/:id/exit')
  @ApiOperation({ summary: 'Ziyaretçi çıkışı' })
  checkOut(@Param('id') id: string, @Body(new ZodBody(visitorExitSchema)) body: z.infer<typeof visitorExitSchema>) {
    return this.security.checkOut(id, body);
  }
}
