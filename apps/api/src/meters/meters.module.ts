import { Module } from '@nestjs/common';
import { MetersController } from './meters.controller';
import { MetersService } from './meters.service';
import { AuditService } from '../common/audit.service';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [FinanceModule],
  controllers: [MetersController],
  providers: [MetersService, AuditService],
})
export class MetersModule {}
