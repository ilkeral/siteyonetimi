import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_DEPARTMENTS,
  DEFAULT_DUES_ITEMS,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_NOTIFICATION_TEMPLATES,
  type SiteCreateInput,
} from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { runWithoutTenant } from '../tenant/tenant.context';
import { EntitlementsService } from './entitlements.service';

/**
 * YENİ SİTE KURULUMU
 *
 * Site boş açılmaz: parametreler, gelir/gider kategorileri (finans adıyla
 * arar), merkez kasa ve banka hesabı, departmanlar, aidat kalemi iskeleti ve
 * bildirim şablonları birlikte, tek işlemde oluşturulur. Müşterinin sahipleri
 * siteye yönetici olarak eklenir.
 */
@Injectable()
export class SiteBootstrapService {
  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly entitlements: EntitlementsService,
  ) {}

  async create(organizationId: string, input: SiteCreateInput) {
    await this.entitlements.assertSiteCapacity(organizationId);

    // Henüz site bağlamı yok: tenant filtresi bilinçli kapalı, siteId açıkça yazılır
    return runWithoutTenant(() =>
      this.db.$transaction(async (tx) => {
        const site = await tx.site.create({
          data: {
            organizationId,
            name: input.name,
            type: input.type,
            city: input.city ?? null,
            district: input.district ?? null,
            address: input.address ?? null,
            settings: { create: {} },
          },
        });
        const siteId = site.id;

        await tx.category.createMany({
          data: [
            ...DEFAULT_INCOME_CATEGORIES.map((name, order) => ({ siteId, kind: 'INCOME' as const, name, order })),
            ...DEFAULT_EXPENSE_CATEGORIES.map((name, order) => ({ siteId, kind: 'EXPENSE' as const, name, order })),
          ],
        });
        await tx.account.createMany({
          data: [
            { siteId, type: 'CASH' as const, name: 'Merkez Kasa', code: '100.01' },
            { siteId, type: 'BANK' as const, name: 'Banka Hesabı', code: '102.01' },
          ],
        });
        await tx.department.createMany({ data: DEFAULT_DEPARTMENTS.map((name, order) => ({ siteId, name, order })) });
        await tx.duesItem.createMany({
          data: DEFAULT_DUES_ITEMS.map((item, order) => ({ siteId, name: item.name, distributionMethod: item.distributionMethod, order })),
        });
        await tx.notificationTemplate.createMany({
          data: DEFAULT_NOTIFICATION_TEMPLATES.map((t) => ({ siteId, channel: t.channel, name: t.name, subject: t.subject, body: t.body })),
        });

        const owners = await tx.organizationMember.findMany({ where: { organizationId }, select: { userId: true } });
        if (owners.length) {
          await tx.siteMembership.createMany({
            data: owners.map((o) => ({ userId: o.userId, siteId, role: 'SITE_ADMIN' as const })),
            skipDuplicates: true,
          });
        }
        return site;
      }),
    );
  }
}
