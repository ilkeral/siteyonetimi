import { Global, Module } from '@nestjs/common';
import { AuditService } from '../common/audit.service';
import { EntitlementsService } from './entitlements.service';
import { SiteBootstrapService } from './site-bootstrap.service';
import { PlatformService } from './platform.service';
import { OrganizationService } from './organization.service';
import { OrganizationController, PlatformController } from './platform.controller';

/**
 * SaaS katmanı: müşteri, paket, abonelik, destek erişimi.
 * `EntitlementsService` global — daire/site ekleyen modüller sınırı denetler.
 */
@Global()
@Module({
  controllers: [PlatformController, OrganizationController],
  providers: [PlatformService, OrganizationService, EntitlementsService, SiteBootstrapService, AuditService],
  exports: [EntitlementsService],
})
export class PlatformModule {}
