import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  MERGE_FIELDS,
  SUPPORTED_CHANNELS,
  campaignPreviewSchema,
  campaignSchema,
  notificationTemplateSchema,
  paginationSchema,
  type CampaignInput,
  type CampaignPreviewInput,
  type NotificationTemplateInput,
} from '@sy/shared';
import { NotificationsService } from './notifications.service';
import { Roles } from '../common/decorators';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { AuditService } from '../common/audit.service';

const messagesQuerySchema = paginationSchema.extend({
  status: z.enum(['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'FAILED']).optional(),
});

const sendSchema = z.object({ scheduledAt: z.coerce.date().optional().nullable() });

/**
 * Toplu bildirim kişisel veri ve maliyet içerir: yalnızca yönetici ve muhasebe.
 * Sakin tarafı (gelen kutusu, duyurular) Faz 5 portalında.
 */
@ApiTags('İletişim')
@Roles('SITE_ADMIN', 'ACCOUNTANT')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  @Get('meta')
  @ApiOperation({ summary: 'Birleştirme alanları ve desteklenen kanallar' })
  meta() {
    return { mergeFields: MERGE_FIELDS, channels: SUPPORTED_CHANNELS };
  }

  // ------------------------------------------------------------------ şablon

  @Get('templates')
  @ApiOperation({ summary: 'Bildirim şablonları' })
  templates() {
    return this.notifications.listTemplates();
  }

  @Post('templates')
  @ApiOperation({ summary: 'Şablon oluştur' })
  async createTemplate(@Body(new ZodBody(notificationTemplateSchema)) dto: NotificationTemplateInput) {
    const template = await this.notifications.saveTemplate(null, dto);
    await this.audit.record({ action: 'CREATE', entityType: 'NotificationTemplate', entityId: template.id, after: dto });
    return template;
  }

  @Put('templates/:id')
  @ApiOperation({ summary: 'Şablon güncelle' })
  async updateTemplate(
    @Param('id') id: string,
    @Body(new ZodBody(notificationTemplateSchema)) dto: NotificationTemplateInput,
  ) {
    const template = await this.notifications.saveTemplate(id, dto);
    await this.audit.record({ action: 'UPDATE', entityType: 'NotificationTemplate', entityId: id, after: dto });
    return template;
  }

  @Delete('templates/:id')
  @ApiOperation({ summary: 'Şablon sil' })
  async removeTemplate(@Param('id') id: string) {
    const result = await this.notifications.removeTemplate(id);
    await this.audit.record({ action: 'DELETE', entityType: 'NotificationTemplate', entityId: id });
    return result;
  }

  // --------------------------------------------------------------- kampanya

  @Post('campaigns/preview')
  @ApiOperation({ summary: 'Hedef kitle ve kişiye özel mesaj önizlemesi — hiçbir şey yazmaz' })
  preview(@Body(new ZodBody(campaignPreviewSchema)) dto: CampaignPreviewInput) {
    return this.notifications.preview(dto);
  }

  @Get('campaigns')
  @ApiOperation({ summary: 'Kampanya listesi' })
  campaigns(@Query(new ZodQuery(paginationSchema)) query: z.infer<typeof paginationSchema>) {
    return this.notifications.listCampaigns(query);
  }

  @Get('campaigns/:id')
  @ApiOperation({ summary: 'Kampanya ve durum dağılımı' })
  campaign(@Param('id') id: string) {
    return this.notifications.getCampaign(id);
  }

  @Get('campaigns/:id/messages')
  @ApiOperation({ summary: 'Kampanyanın mesajları (sayfalı, duruma göre)' })
  messages(@Param('id') id: string, @Query(new ZodQuery(messagesQuerySchema)) query: z.infer<typeof messagesQuerySchema>) {
    return this.notifications.listMessages(id, query);
  }

  @Post('campaigns')
  @ApiOperation({ summary: 'Taslak kampanya oluştur' })
  async create(@Body(new ZodBody(campaignSchema)) dto: CampaignInput) {
    const campaign = await this.notifications.createCampaign(dto);
    await this.audit.record({ action: 'CREATE', entityType: 'NotificationCampaign', entityId: campaign.id, after: dto });
    return campaign;
  }

  @Put('campaigns/:id')
  @ApiOperation({ summary: 'Taslak kampanyayı güncelle' })
  async update(@Param('id') id: string, @Body(new ZodBody(campaignSchema)) dto: CampaignInput) {
    const campaign = await this.notifications.updateCampaign(id, dto);
    await this.audit.record({ action: 'UPDATE', entityType: 'NotificationCampaign', entityId: id, after: dto });
    return campaign;
  }

  @Post('campaigns/:id/send')
  @ApiOperation({ summary: 'Gönder (ya da ileri tarihe zamanla)' })
  async send(@Param('id') id: string, @Body(new ZodBody(sendSchema)) dto: z.infer<typeof sendSchema>) {
    const result = await this.notifications.send(id, dto.scheduledAt);
    await this.audit.record({ action: 'POST', entityType: 'NotificationCampaign', entityId: id, after: result });
    return result;
  }

  @Post('campaigns/:id/cancel')
  @ApiOperation({ summary: 'İptal et (gönderilmemiş mesajlar düşer)' })
  async cancel(@Param('id') id: string) {
    const result = await this.notifications.cancel(id);
    await this.audit.record({ action: 'CANCEL', entityType: 'NotificationCampaign', entityId: id, after: result });
    return result;
  }

  @Post('campaigns/:id/retry')
  @ApiOperation({ summary: 'Başarısız mesajları yeniden dene' })
  retry(@Param('id') id: string) {
    return this.notifications.retryFailed(id);
  }

  @Delete('campaigns/:id')
  @ApiOperation({ summary: 'Taslak kampanyayı sil' })
  async remove(@Param('id') id: string) {
    const result = await this.notifications.removeCampaign(id);
    await this.audit.record({ action: 'DELETE', entityType: 'NotificationCampaign', entityId: id });
    return result;
  }
}
