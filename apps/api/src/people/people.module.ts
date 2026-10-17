import { Module } from '@nestjs/common';
import { PeopleController } from './people.controller';
import { UnitsController } from './units.controller';
import { PeopleService } from './people.service';
import { StructureImportService } from './structure-import.service';
import { AuditService } from '../common/audit.service';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [FinanceModule],
  controllers: [PeopleController, UnitsController],
  providers: [PeopleService, StructureImportService, AuditService],
})
export class PeopleModule {}
