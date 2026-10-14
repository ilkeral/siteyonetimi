import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Public } from '../common/decorators';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { runWithoutTenant } from '../tenant/tenant.context';

@ApiTags('Sistem')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Servis sağlık kontrolü (veritabanı + Redis)' })
  async check() {
    const [db, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    const status = db === 'ok' && redis === 'ok' ? 'ok' : 'degraded';
    return { status, db, redis, timestamp: new Date().toISOString() };
  }

  private async checkDatabase(): Promise<string> {
    try {
      await runWithoutTenant(() => this.db.$queryRaw`SELECT 1`);
      return 'ok';
    } catch (error) {
      return `error: ${(error as Error).message}`;
    }
  }

  private async checkRedis(): Promise<string> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) return 'disabled';
    const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
    try {
      await client.connect();
      await client.ping();
      return 'ok';
    } catch (error) {
      return `error: ${(error as Error).message}`;
    } finally {
      client.disconnect();
    }
  }
}
