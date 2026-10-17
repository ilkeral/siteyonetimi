import { Module } from '@nestjs/common';
import { SitesController } from './sites.controller';
import { AuditService } from '../common/audit.service';

@Module({
  controllers: [SitesController],
  providers: [AuditService],
})
export class SitesModule {}
