import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { checkLimit, type LimitCheck } from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { requireSiteId, runWithoutTenant } from '../tenant/tenant.context';

export interface Usage {
  sites: LimitCheck;
  units: LimitCheck;
}

/**
 * PAKET SINIRLARI
 *
 * Daire sınırı müşterinin TÜM sitelerindeki aktif daireler üzerinden sayılır
 * (yönetim şirketinin paketi şirket geneli). Sayım siteler arası olduğundan
 * tenant filtresi bilinçli kapatılır; yalnızca sayı döner, veri dönmez.
 * Paketsiz (özel sözleşme) müşteride sınır yok.
 *
 * Sınır aşımı 402 (yükseltme gerekli) döner, 403 değil: web istemcisi 403 +
 * "site" mesajında site seçimini silip girişe yollar.
 */
@Injectable()
export class EntitlementsService {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async usage(organizationId: string): Promise<Usage> {
    return runWithoutTenant(async () => {
      const [org, sites, units] = await Promise.all([
        this.db.organization.findUnique({ where: { id: organizationId }, select: { plan: { select: { maxSites: true, maxUnits: true } } } }),
        this.db.site.count({ where: { organizationId, isActive: true } }),
        this.db.unit.count({ where: { isActive: true, site: { organizationId, isActive: true } } }),
      ]);
      return {
        sites: checkLimit(org?.plan?.maxSites, sites, 0),
        units: checkLimit(org?.plan?.maxUnits, units, 0),
      };
    });
  }

  private async organizationOf(siteId: string): Promise<string> {
    const site = await runWithoutTenant(() =>
      this.db.site.findUniqueOrThrow({ where: { id: siteId }, select: { organizationId: true } }),
    );
    return site.organizationId;
  }

  /** Aktif siteye `adding` daire eklenebilir mi (yeni daire, etkinleştirme, toplu aktarım) */
  async unitCapacity(adding: number, siteId = requireSiteId()): Promise<LimitCheck> {
    const usage = await this.usage(await this.organizationOf(siteId));
    return checkLimit(usage.units.limit, usage.units.used, adding);
  }

  async assertUnitCapacity(adding: number, siteId = requireSiteId()): Promise<void> {
    if (adding <= 0) return;
    const check = await this.unitCapacity(adding, siteId);
    if (!check.ok) {
      throw new HttpException(
        `Paketinizin daire sınırı (${check.limit}) doluyor: ${check.remaining} daire daha eklenebilir, ${adding} isteniyor. Paketinizi yükseltin.`,
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  async assertSiteCapacity(organizationId: string): Promise<void> {
    const usage = await this.usage(organizationId);
    const check = checkLimit(usage.sites.limit, usage.sites.used, 1);
    if (!check.ok) {
      throw new HttpException(`Paketin site sınırı (${check.limit}) dolu. Paketi yükseltin.`, HttpStatus.PAYMENT_REQUIRED);
    }
  }
}
