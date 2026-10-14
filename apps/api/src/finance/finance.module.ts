import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller';
import { LedgerService } from './ledger.service';
import { DuesService } from './dues.service';
import { TransactionsService } from './transactions.service';
import { LateFeeService } from './late-fee.service';
import { BankService } from './bank.service';
import { DashboardService } from './dashboard.service';
import { AuditService } from '../common/audit.service';

@Module({
  controllers: [FinanceController],
  providers: [
    LedgerService,
    DuesService,
    TransactionsService,
    LateFeeService,
    BankService,
    DashboardService,
    AuditService,
  ],
  exports: [LedgerService, TransactionsService],
})
export class FinanceModule {}
