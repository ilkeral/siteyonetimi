import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { PRISMA, createPrismaClient, type ExtendedPrismaClient } from './prisma.client';

@Global()
@Module({
  providers: [
    {
      provide: PRISMA,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createPrismaClient(config.get<string>('DATABASE_URL')),
    },
  ],
  exports: [PRISMA],
})
export class PrismaModule implements OnApplicationShutdown {
  constructor(private readonly moduleRef: ModuleRef) {}

  async onApplicationShutdown(): Promise<void> {
    try {
      const client = this.moduleRef.get<ExtendedPrismaClient>(PRISMA as never);
      await client.$disconnect();
    } catch {
      // kapanışta bağlantı zaten kapalıysa sessiz geç
    }
  }
}
