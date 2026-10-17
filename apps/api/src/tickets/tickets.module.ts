import { Module } from '@nestjs/common';
import { DepartmentsController, TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { AuditService } from '../common/audit.service';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [FinanceModule],
  controllers: [TicketsController, DepartmentsController],
  providers: [TicketsService, AuditService],
  exports: [TicketsService],
})
export class TicketsModule {}
