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
  ],
  controllers: [HealthController],
  providers: [
    // Tüm uç noktalar varsayılan olarak korumalıdır; @Public() ile açılır.
    { provide: APP_GUARD, useClass: AuthGuard },
    // Doğrulanan site bilgisini AsyncLocalStorage'a taşır.
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
})
export class AppModule {}
