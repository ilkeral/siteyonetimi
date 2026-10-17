import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { accessLevel, type SiteCreateInput } from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { runWithoutTenant } from '../tenant/tenant.context';
import { AuditService } from '../common/audit.service';
import { EntitlementsService } from './entitlements.service';
import { SiteBootstrapService } from './site-bootstrap.service';

/**
 * MÜŞTERİ SAHİBİ ("Firma") İŞLEMLERİ
 *
 * Yönetim şirketinin sahibi kendi paketini, kullanımını ve sitelerini görür;
 * paket sınırı içinde yeni site açar. Yalnızca OWNER üyeliği olan müşteriler.
 */
@Injectable()
export class OrganizationService {
  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly bootstrap: SiteBootstrapService,
  ) {}

  async mine(userId: string) {
    const memberships = await runWithoutTenant(() =>
      this.db.organizationMember.findMany({
        where: { userId },
        include: {
          organization: {
            include: {
              plan: true,
              sites: {
                orderBy: { name: 'asc' },
                select: { id: true, name: true, city: true, district: true, isActive: true, _count: { select: { units: { where: { isActive: true } } } } },
              },
            },
          },
        },
      }),
    );
    const now = new Date();
    return Promise.all(
      memberships.map(async ({ organization: org, role }) => ({
        id: org.id,
        name: org.name,
        kind: org.kind,
        role,
        status: org.status,
        trialEndsAt: org.trialEndsAt,
        paidUntil: org.paidUntil,
        access: accessLevel(org, now),
        plan: org.plan
          ? {
              name: org.plan.name,
              monthlyPrice: Number(org.plan.monthlyPrice),
              maxSites: org.plan.maxSites,
              maxUnits: org.plan.maxUnits,
              features: org.plan.features,
            }
          : null,
        usage: await this.entitlements.usage(org.id),
        sites: org.sites.map(({ _count, ...site }) => ({ ...site, unitCount: _count.units })),
      })),
    );
  }

  async createSite(userId: string, organizationId: string, input: SiteCreateInput) {
    const member = await runWithoutTenant(() =>
      this.db.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        include: { organization: { select: { status: true, trialEndsAt: true, paidUntil: true } } },
      }),
    );
    if (!member) throw new ForbiddenException('Bu müşteri hesabında yetkiniz yok');
    const access = accessLevel(member.organization, new Date());
    if (access.level !== 'FULL') {
      throw new HttpException(access.reason ?? 'Abonelik yeni kayıt açmaya uygun değil', HttpStatus.PAYMENT_REQUIRED);
    }
    const site = await this.bootstrap.create(organizationId, input);
    await this.audit.record({ action: 'CREATE', entityType: 'PlatformSite', entityId: site.id, after: { organizationId, name: site.name, by: 'owner' } });
    return { id: site.id, name: site.name };
  }
}
