import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { TenantInterceptor } from './tenant/tenant.interceptor';
import { HealthController } from './health/health.controller';
import { SitesModule } from './sites/sites.module';
import { FinanceModule } from './finance/finance.module';
import { PeopleModule } from './people/people.module';
import { TicketsModule } from './tickets/tickets.module';
import { MetersModule } from './meters/meters.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PortalModule } from './portal/portal.module';
import { ReportsModule } from './reports/reports.module';
import { SecurityModule } from './security/security.module';
import { PlatformModule } from './platform/platform.module';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';
import { APP_FILTER } from '@nestjs/core';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    PrismaModule,
    AuthModule,
    SitesModule,
    FinanceModule,
    PeopleModule,
    TicketsModule,
    MetersModule,
    NotificationsModule,
    PortalModule,
    ReportsModule,
    SecurityModule,
    PlatformModule,
  ],
  controllers: [HealthController],
  providers: [
    // Tüm uç noktalar varsayılan olarak korumalıdır; @Public() ile açılır.
    { provide: APP_GUARD, useClass: AuthGuard },
    // Doğrulanan site bilgisini AsyncLocalStorage'a taşır.
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    // Prisma hatalarını Türkçe mesajlara çevirir; ham hata sızmaz.
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
