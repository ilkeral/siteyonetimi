import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma, type OrganizationStatus } from '@sy/db';
import {
  accessLevel,
  type OrganizationCreateInput,
  type OrganizationUpdateInput,
  type PlanInput,
  type SiteCreateInput,
  type SupportAccessInput,
} from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { currentUserId, runWithoutTenant } from '../tenant/tenant.context';
import { AuditService } from '../common/audit.service';
import { temporaryPassword } from '../portal/portal-admin.service';
import { EntitlementsService } from './entitlements.service';
import { SiteBootstrapService } from './site-bootstrap.service';

const DAY_MS = 86_400_000;
const money = (value: Prisma.Decimal | number | null | undefined) => Number(value ?? 0);

/** Platform işlemlerinin denetim kaydındaki türleri (platform günlüğü bunları listeler) */
export const PLATFORM_AUDIT_TYPES = ['Organization', 'Plan', 'SupportAccess', 'PlatformSite'] as const;

/**
 * PLATFORM (SÜPER YÖNETİCİ) İŞLEMLERİ
 *
 * Müşteri, paket, abonelik ve destek erişimi. Tüm sorgular global ya da
 * siteler arası olduğundan tenant filtresi bilinçli kapatılır
 * (`runWithoutTenant`). Müşterilerin iş verisi (kişi, borç, talep) burada
 * okunmaz — yalnızca sayılar. İçeriğe erişim destek erişimiyle, site içinden.
 */
@Injectable()
export class PlatformService {
  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly bootstrap: SiteBootstrapService,
  ) {}

  // ================================================================ özet

  overview() {
    return runWithoutTenant(async () => {
      const now = new Date();
      const soon = new Date(now.getTime() + 7 * DAY_MS);
      const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
      const [byStatus, activeOrgs, sites, units, residents, staff, newOrgs, trialsEnding, pastDue, support, recent] =
        await Promise.all([
          this.db.organization.groupBy({ by: ['status'], _count: { _all: true } }),
          this.db.organization.findMany({ where: { status: 'ACTIVE' }, select: { plan: { select: { monthlyPrice: true } } } }),
          this.db.site.count({ where: { isActive: true } }),
          this.db.unit.count({ where: { isActive: true, site: { isActive: true } } }),
          this.db.siteMembership.count({ where: { role: 'RESIDENT', isActive: true } }),
          this.db.siteMembership.count({ where: { role: { not: 'RESIDENT' }, isActive: true } }),
          this.db.organization.count({ where: { createdAt: { gte: monthAgo } } }),
          this.db.organization.findMany({
            where: { status: 'TRIAL', trialEndsAt: { lte: soon } },
            select: { id: true, name: true, trialEndsAt: true },
            orderBy: { trialEndsAt: 'asc' },
            take: 10,
          }),
          this.db.organization.findMany({
            where: { OR: [{ status: 'PAST_DUE' }, { status: 'ACTIVE', paidUntil: { lt: now } }] },
            select: { id: true, name: true, status: true, paidUntil: true },
            orderBy: { paidUntil: 'asc' },
            take: 10,
          }),
          this.db.supportAccess.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
          this.db.organization.findMany({
            select: { id: true, name: true, status: true, createdAt: true, plan: { select: { name: true } } },
            orderBy: { createdAt: 'desc' },
            take: 6,
          }),
        ]);
      const statusCounts = Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])) as Partial<Record<OrganizationStatus, number>>;
      return {
        organizations: {
          total: Object.values(statusCounts).reduce((a, b) => a + (b ?? 0), 0),
          byStatus: statusCounts,
          newLast30Days: newOrgs,
        },
        // Aylık tekrarlayan gelir: ACTIVE müşterilerin paket liste fiyatı (KDV hariç)
        mrr: activeOrgs.reduce((sum, org) => sum + money(org.plan?.monthlyPrice), 0),
        sites,
        units,
        users: { residents, staff },
        activeSupportAccess: support,
        trialsEnding: trialsEnding.map((o) => ({ ...o, daysLeft: Math.ceil(((o.trialEndsAt?.getTime() ?? now.getTime()) - now.getTime()) / DAY_MS) })),
        pastDue,
        recent,
      };
    });
  }

  // ================================================================ paketler

  plans() {
    return runWithoutTenant(async () => {
      const plans = await this.db.plan.findMany({ orderBy: [{ order: 'asc' }, { monthlyPrice: 'asc' }], include: { _count: { select: { organizations: true } } } });
      return plans.map(({ _count, monthlyPrice, ...plan }) => ({ ...plan, monthlyPrice: money(monthlyPrice), organizationCount: _count.organizations }));
    });
  }

  async savePlan(id: string | null, input: PlanInput) {
    return runWithoutTenant(async () => {
      const clash = await this.db.plan.findFirst({ where: { code: input.code, ...(id ? { id: { not: id } } : {}) } });
      if (clash) throw new ConflictException(`"${input.code}" kodlu paket zaten var`);
      const data = { ...input, description: input.description ?? null };
      const plan = id ? await this.db.plan.update({ where: { id }, data }) : await this.db.plan.create({ data });
      await this.audit.record({ action: id ? 'UPDATE' : 'CREATE', entityType: 'Plan', entityId: plan.id, after: input });
      return { ...plan, monthlyPrice: money(plan.monthlyPrice) };
    });
  }

  // ================================================================ müşteriler

  listOrganizations(query: { search?: string; status?: OrganizationStatus }) {
    return runWithoutTenant(async () => {
      const orgs = await this.db.organization.findMany({
        where: {
          status: query.status,
          ...(query.search
            ? {
                OR: [
                  { name: { contains: query.search, mode: 'insensitive' } },
                  { contactEmail: { contains: query.search, mode: 'insensitive' } },
                  { taxNumber: { contains: query.search } },
                ],
              }
            : {}),
        },
        include: {
          plan: { select: { name: true, maxSites: true, maxUnits: true, monthlyPrice: true } },
          sites: { where: { isActive: true }, select: { _count: { select: { units: { where: { isActive: true } } } } } },
        },
        orderBy: { name: 'asc' },
      });
      const now = new Date();
      return orgs.map((org) => ({
        id: org.id,
        name: org.name,
        kind: org.kind,
        status: org.status,
        access: accessLevel(org, now),
        trialEndsAt: org.trialEndsAt,
        paidUntil: org.paidUntil,
        contactEmail: org.contactEmail,
        city: org.city,
        plan: org.plan ? { ...org.plan, monthlyPrice: money(org.plan.monthlyPrice) } : null,
        siteCount: org.sites.length,
        unitCount: org.sites.reduce((sum, site) => sum + site._count.units, 0),
        createdAt: org.createdAt,
      }));
    });
  }

  async organization(id: string) {
    return runWithoutTenant(async () => {
      const org = await this.db.organization.findUnique({
        where: { id },
        include: {
          plan: true,
          members: { include: { user: { select: { id: true, fullName: true, email: true, lastLoginAt: true, isActive: true } } } },
          sites: {
            orderBy: { name: 'asc' },
            select: {
              id: true,
              name: true,
              type: true,
              city: true,
              district: true,
              isActive: true,
              createdAt: true,
              _count: { select: { units: { where: { isActive: true } }, people: { where: { isActive: true } }, memberships: { where: { isActive: true, role: { not: 'RESIDENT' } } } } },
            },
          },
        },
      });
      if (!org) throw new NotFoundException('Müşteri bulunamadı');
      const [usage, history] = await Promise.all([
        this.entitlements.usage(id),
        this.db.auditLog.findMany({
          where: { entityType: 'Organization', entityId: id },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, action: true, after: true, createdAt: true, user: { select: { fullName: true } } },
        }),
      ]);
      return {
        ...org,
        plan: org.plan ? { ...org.plan, monthlyPrice: money(org.plan.monthlyPrice) } : null,
        access: accessLevel(org, new Date()),
        usage,
        history,
      };
    });
  }

  private async assertPlan(planId: string | null) {
    if (!planId) return;
    const plan = await this.db.plan.findUnique({ where: { id: planId }, select: { id: true } });
    if (!plan) throw new BadRequestException('Paket bulunamadı');
  }

  /** Yeni müşteri + sahibi (+ ilk site). Sahibin geçici parolası yalnızca yanıtta döner. */
  async createOrganization(input: OrganizationCreateInput) {
    const created = await runWithoutTenant(async () => {
      await this.assertPlan(input.planId);
      const existing = await this.db.user.findUnique({ where: { email: input.owner.email } });
      if (existing?.isSuperAdmin) throw new BadRequestException('Platform yöneticisi müşteri sahibi yapılamaz');

      const password = existing ? null : temporaryPassword();
      const now = Date.now();
      return this.db.$transaction(async (tx) => {
        const user =
          existing ??
          (await tx.user.create({
            data: { email: input.owner.email, fullName: input.owner.fullName, passwordHash: await argon2.hash(password!) },
          }));
        const organization = await tx.organization.create({
          data: {
            name: input.name,
            kind: input.kind,
            planId: input.planId,
            status: input.trialDays > 0 ? 'TRIAL' : 'ACTIVE',
            trialEndsAt: input.trialDays > 0 ? new Date(now + input.trialDays * DAY_MS) : null,
            taxNumber: input.taxNumber ?? null,
            taxOffice: input.taxOffice ?? null,
            contactName: input.contactName ?? input.owner.fullName,
            contactEmail: input.contactEmail || input.owner.email,
            contactPhone: input.contactPhone ?? null,
            city: input.city ?? null,
            address: input.address ?? null,
            note: input.note ?? null,
            members: { create: { userId: user.id, role: 'OWNER' } },
          },
        });
        return { organization, owner: { email: user.email, temporaryPassword: password, existingUser: !!existing } };
      });
    });

    const site = input.firstSite ? await this.bootstrap.create(created.organization.id, input.firstSite) : null;
    // Denetim kaydına parola yazılmaz
    await this.audit.record({
      action: 'CREATE',
      entityType: 'Organization',
      entityId: created.organization.id,
      after: { name: input.name, planId: input.planId, owner: input.owner.email, trialDays: input.trialDays, firstSite: site?.name ?? null },
    });
    return { ...created, site: site ? { id: site.id, name: site.name } : null };
  }

  async updateOrganization(id: string, input: OrganizationUpdateInput) {
    return runWithoutTenant(async () => {
      const before = await this.db.organization.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Müşteri bulunamadı');
      await this.assertPlan(input.planId);
      const organization = await this.db.organization.update({
        where: { id },
        data: { ...input, contactEmail: input.contactEmail || null },
      });
      await this.audit.record({
        action: 'UPDATE',
        entityType: 'Organization',
        entityId: id,
        before: { status: before.status, planId: before.planId, trialEndsAt: before.trialEndsAt, paidUntil: before.paidUntil },
        after: { status: input.status, planId: input.planId, trialEndsAt: input.trialEndsAt, paidUntil: input.paidUntil },
      });
      return organization;
    });
  }

  /** Sahibin parolasını sıfırla (müşteri girişini kaybettiyse); yeni geçici parola yalnızca yanıtta */
  async resetOwnerPassword(organizationId: string, userId: string) {
    return runWithoutTenant(async () => {
      const member = await this.db.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        include: { user: { select: { email: true, isSuperAdmin: true } } },
      });
      if (!member) throw new NotFoundException('Müşteri sahibi bulunamadı');
      if (member.user.isSuperAdmin) throw new BadRequestException('Platform yöneticisinin parolası buradan sıfırlanamaz');
      const password = temporaryPassword();
      await this.db.$transaction([
        this.db.user.update({ where: { id: userId }, data: { passwordHash: await argon2.hash(password) } }),
        this.db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
      await this.audit.record({ action: 'UPDATE', entityType: 'Organization', entityId: organizationId, after: { ownerPasswordReset: member.user.email } });
      return { email: member.user.email, temporaryPassword: password };
    });
  }

  // ================================================================ siteler

  async createSite(organizationId: string, input: SiteCreateInput) {
    const exists = await runWithoutTenant(() => this.db.organization.count({ where: { id: organizationId } }));
    if (!exists) throw new NotFoundException('Müşteri bulunamadı');
    const site = await this.bootstrap.create(organizationId, input);
    await this.audit.record({ action: 'CREATE', entityType: 'PlatformSite', entityId: site.id, after: { organizationId, name: site.name } });
    return site;
  }

  async setSiteActive(siteId: string, isActive: boolean) {
    await runWithoutTenant(async () => {
      const site = await this.db.site.findUnique({ where: { id: siteId }, select: { organizationId: true } });
      if (!site) throw new NotFoundException('Site bulunamadı');
      if (isActive) await this.entitlements.assertSiteCapacity(site.organizationId);
      await this.db.site.update({ where: { id: siteId }, data: { isActive } });
    });
    await this.audit.record({ action: 'UPDATE', entityType: 'PlatformSite', entityId: siteId, after: { isActive } });
    return { id: siteId, isActive };
  }

  // ================================================================ destek erişimi

  supportAccessList() {
    return runWithoutTenant(async () => {
      const rows = await this.db.supportAccess.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          user: { select: { fullName: true, email: true } },
          site: { select: { id: true, name: true, organization: { select: { name: true } } } },
        },
      });
      const now = new Date();
      return rows.map((row) => ({
        id: row.id,
        site: { id: row.site.id, name: row.site.name, organization: row.site.organization.name },
        user: row.user,
        reason: row.reason,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        active: !row.revokedAt && row.expiresAt > now,
      }));
    });
  }

  /**
   * Süreli destek erişimi. Kayıt, MÜŞTERİNİN sitesinin denetim günlüğüne de
   * yazılır: müşteri, platformun ne zaman ve neden verisine eriştiğini görür.
   */
  async grantSupportAccess(input: SupportAccessInput) {
    const userId = currentUserId()!;
    const grant = await runWithoutTenant(async () => {
      const site = await this.db.site.findUnique({ where: { id: input.siteId }, select: { id: true, isActive: true } });
      if (!site) throw new NotFoundException('Site bulunamadı');
      if (!site.isActive) throw new BadRequestException('Pasif siteye destek erişimi açılamaz');
      // Aynı siteye açık erişim varsa kapatılır, yenisi açılır (aynı anda tek geçerli erişim)
      await this.db.supportAccess.updateMany({
        where: { userId, siteId: input.siteId, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date() },
      });
      const created = await this.db.supportAccess.create({
        data: { userId, siteId: input.siteId, reason: input.reason, expiresAt: new Date(Date.now() + input.minutes * 60_000) },
      });
      await this.db.auditLog.create({
        data: {
          siteId: input.siteId,
          userId,
          action: 'CREATE',
          entityType: 'SupportAccess',
          entityId: created.id,
          after: { reason: input.reason, minutes: input.minutes, expiresAt: created.expiresAt },
        },
      });
      return created;
    });
    return { id: grant.id, siteId: grant.siteId, expiresAt: grant.expiresAt };
  }

  async revokeSupportAccess(id: string) {
    return runWithoutTenant(async () => {
      const grant = await this.db.supportAccess.findUnique({ where: { id } });
      if (!grant) throw new NotFoundException('Destek erişimi bulunamadı');
      if (!grant.revokedAt) {
        await this.db.supportAccess.update({ where: { id }, data: { revokedAt: new Date() } });
        await this.db.auditLog.create({
          data: { siteId: grant.siteId, userId: currentUserId(), action: 'DELETE', entityType: 'SupportAccess', entityId: id },
        });
      }
      return { id, revoked: true };
    });
  }

  // ================================================================ günlük

  auditLog() {
    return runWithoutTenant(() =>
      this.db.auditLog.findMany({
        where: { entityType: { in: [...PLATFORM_AUDIT_TYPES] } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, action: true, entityType: true, entityId: true, after: true, createdAt: true, siteId: true, user: { select: { fullName: true } } },
      }),
    );
  }
}
