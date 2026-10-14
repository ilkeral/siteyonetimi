import { Inject, Injectable, Logger } from '@nestjs/common';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { getTenantContext, runWithoutTenant } from '../tenant/tenant.context';

/**
 * Kayıt değişiklik günlüğü — ekranlardaki "İşlem Geçmişi" sekmesini besler.
 * Günlük yazımı asla asıl işlemi düşürmez (hata yutulur, loglanır).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async record(params: {
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'POST' | 'CANCEL' | 'LOGIN' | 'IMPORT';
    entityType: string;
    entityId?: string;
    before?: unknown;
    after?: unknown;
  }): Promise<void> {
    const ctx = getTenantContext();
    try {
      await runWithoutTenant(() =>
        this.db.auditLog.create({
          data: {
            siteId: ctx?.siteId ?? null,
            userId: ctx?.userId ?? null,
            action: params.action,
            entityType: params.entityType,
            entityId: params.entityId,
            before: params.before === undefined ? undefined : (params.before as object),
            after: params.after === undefined ? undefined : (params.after as object),
          },
        }),
      );
    } catch (error) {
      this.logger.warn(`Denetim kaydı yazılamadı: ${(error as Error).message}`);
    }
  }
}
