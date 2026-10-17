import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  organizationCreateSchema,
  organizationUpdateSchema,
  planSchema,
  siteCreateSchema,
  supportAccessSchema,
  type OrganizationCreateInput,
  type OrganizationUpdateInput,
  type PlanInput,
  type SiteCreateInput,
  type SupportAccessInput,
} from '@sy/shared';
import { CurrentUser, NoSite, PlatformOnly, type AuthUser } from '../common/decorators';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { PlatformService } from './platform.service';
import { OrganizationService } from './organization.service';

const orgListSchema = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED']).optional(),
});

/** Platform (süper yönetici) — site seçimi gerekmez, yalnızca süper yönetici */
@ApiTags('Platform')
@PlatformOnly()
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Platform özeti: müşteriler, gelir, kullanım, uyarılar' })
  overview() {
    return this.platform.overview();
  }

  // ---------------------------------------------------------------- paketler

  @Get('plans')
  plans() {
    return this.platform.plans();
  }

  @Post('plans')
  createPlan(@Body(new ZodBody(planSchema)) body: PlanInput) {
    return this.platform.savePlan(null, body);
  }

  @Put('plans/:id')
  updatePlan(@Param('id') id: string, @Body(new ZodBody(planSchema)) body: PlanInput) {
    return this.platform.savePlan(id, body);
  }

  // ---------------------------------------------------------------- müşteriler

  @Get('organizations')
  organizations(@Query(new ZodQuery(orgListSchema)) query: z.infer<typeof orgListSchema>) {
    return this.platform.listOrganizations(query);
  }

  @Get('organizations/:id')
  organization(@Param('id') id: string) {
    return this.platform.organization(id);
  }

  @Post('organizations')
  @ApiOperation({ summary: 'Yeni müşteri + sahibi (+ ilk site); sahibin geçici parolası yalnızca yanıtta' })
  createOrganization(@Body(new ZodBody(organizationCreateSchema)) body: OrganizationCreateInput) {
    return this.platform.createOrganization(body);
  }

  @Put('organizations/:id')
  updateOrganization(@Param('id') id: string, @Body(new ZodBody(organizationUpdateSchema)) body: OrganizationUpdateInput) {
    return this.platform.updateOrganization(id, body);
  }

  @Post('organizations/:id/owners/:userId/reset-password')
  @HttpCode(200)
  resetOwnerPassword(@Param('id') id: string, @Param('userId') userId: string) {
    return this.platform.resetOwnerPassword(id, userId);
  }

  @Post('organizations/:id/sites')
  createSite(@Param('id') id: string, @Body(new ZodBody(siteCreateSchema)) body: SiteCreateInput) {
    return this.platform.createSite(id, body);
  }

  // ---------------------------------------------------------------- siteler

  @Put('sites/:id/active')
  setSiteActive(@Param('id') id: string, @Body(new ZodBody(z.object({ isActive: z.boolean() }))) body: { isActive: boolean }) {
    return this.platform.setSiteActive(id, body.isActive);
  }

  // ---------------------------------------------------------------- destek

  @Get('support-access')
  supportAccess() {
    return this.platform.supportAccessList();
  }

  @Post('support-access')
  @ApiOperation({ summary: 'Siteye süreli, gerekçeli destek erişimi (müşterinin günlüğüne de yazılır)' })
  grantSupportAccess(@Body(new ZodBody(supportAccessSchema)) body: SupportAccessInput) {
    return this.platform.grantSupportAccess(body);
  }

  @Delete('support-access/:id')
  revokeSupportAccess(@Param('id') id: string) {
    return this.platform.revokeSupportAccess(id);
  }

  @Get('audit')
  audit() {
    return this.platform.auditLog();
  }
}

/** Müşteri sahibi ("Firma") — kendi müşteri hesabı */
@ApiTags('Müşteri Hesabı')
@NoSite()
@Controller('organization')
export class OrganizationController {
  constructor(private readonly organizations: OrganizationService) {}

  @Get('mine')
  @ApiOperation({ summary: 'Sahibi olduğum müşteri hesapları: paket, kullanım, siteler' })
  mine(@CurrentUser() user: AuthUser) {
    return this.organizations.mine(user.id);
  }

  @Post(':id/sites')
  @ApiOperation({ summary: 'Paket sınırı içinde yeni site aç' })
  createSite(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodBody(siteCreateSchema)) body: SiteCreateInput) {
    return this.organizations.createSite(user.id, id, body);
  }
}
