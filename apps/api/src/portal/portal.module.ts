import { Module } from '@nestjs/common';
import { AnnouncementsController, PortalAccessController, PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { PortalAdminService } from './portal-admin.service';
import { AuditService } from '../common/audit.service';
import { FinanceModule } from '../finance/finance.module';
import { TicketsModule } from '../tickets/tickets.module';

@Module({
  imports: [FinanceModule, TicketsModule],
  controllers: [PortalController, AnnouncementsController, PortalAccessController],
  providers: [PortalService, PortalAdminService, AuditService],
})
export class PortalModule {}
