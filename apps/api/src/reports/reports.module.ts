import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PaymentScoreService } from './payment-score.service';
import { AuditService } from '../common/audit.service';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [FinanceModule],
  controllers: [ReportsController],
  providers: [ReportsService, PaymentScoreService, AuditService],
  exports: [ReportsService],
})
export class ReportsModule {}
