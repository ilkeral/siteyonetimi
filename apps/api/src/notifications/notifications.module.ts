import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { AudienceService } from './audience.service';
import { NotificationQueue } from './notification.queue';
import { EmailProvider, ProviderRegistry } from './providers';
import { AuditService } from '../common/audit.service';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [FinanceModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    AudienceService,
    NotificationQueue,
    EmailProvider,
    ProviderRegistry,
    AuditService,
  ],
})
export class NotificationsModule {}
