import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { siteSettingsSchema, type SiteSettingsInput } from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { ZodBody } from '../common/zod-validation.pipe';
import { AuditService } from '../common/audit.service';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { requireSiteId, runWithoutTenant } from '../tenant/tenant.context';

@ApiTags('Site')
@Controller('sites')
export class SitesController {
  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly audit: AuditService,
  ) {}

  @Get('current')
  @ApiOperation({ summary: 'Aktif sitenin bilgileri ve ayarları' })
  async current(@CurrentUser() user: AuthUser) {
    const siteId = requireSiteId();

    const site = await runWithoutTenant(() =>
      this.db.site.findUnique({
        where: { id: siteId },
        include: { settings: true },
      }),
    );

    const [blockCount, unitCount, personCount] = await Promise.all([
      this.db.block.count(),
      this.db.unit.count({ where: { isActive: true } }),
      this.db.person.count({ where: { isActive: true } }),
    ]);

    return { site, role: user.role, stats: { blockCount, unitCount, personCount } };
  }

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Put('settings')
  @ApiOperation({ summary: 'Site parametrelerini güncelle' })
  async updateSettings(@Body(new ZodBody(siteSettingsSchema)) body: SiteSettingsInput) {
    // Şema katı: yalnızca bilinen alanlar gelir (siteId, iç içe yazma reddedilir).
    // Ayar satırı açık siteId ile bulunur; tenant filtresini kapatmaya gerek yok.
    const siteId = requireSiteId();
    const before = await this.db.siteSettings.findUnique({ where: { siteId } });
    const settings = await this.db.siteSettings.upsert({
      where: { siteId },
      create: { siteId, ...body },
      update: body,
    });
    await this.audit.record({ action: 'UPDATE', entityType: 'SiteSettings', entityId: settings.id, before, after: body });
    return settings;
  }
}
