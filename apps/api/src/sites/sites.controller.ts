import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators';
import { requireSiteId, runWithoutTenant } from '../tenant/tenant.context';

@ApiTags('Site')
@Controller('sites')
export class SitesController {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

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
  async updateSettings(@Body() body: Record<string, unknown>) {
    const siteId = requireSiteId();
    return runWithoutTenant(() =>
      this.db.siteSettings.upsert({
        where: { siteId },
        create: { siteId, ...body },
        update: body,
      }),
    );
  }
}
