import { Module } from '@nestjs/common';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';
import { AuditService } from '../common/audit.service';

@Module({
  controllers: [SecurityController],
  providers: [SecurityService, AuditService],
})
export class SecurityModule {}
