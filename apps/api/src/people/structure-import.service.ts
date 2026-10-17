import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  parseStructureSheet,
  planStructureImport,
  type ExistingStructure,
  type Ref,
  type StructurePlan,
} from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { requireSiteId } from '../tenant/tenant.context';
import { AuditService } from '../common/audit.service';

type Db = Pick<ExtendedPrismaClient, 'block' | 'unit' | 'person' | 'unitOccupancy' | 'siteSettings'>;

/**
 * TOPLU KİŞİ / DAİRE İÇE AKTARMA
 *
 * Önizleme ve aktarım aynı saf planı (`planStructureImport`) kullanır. Aktarım
 * planı işlemin İÇİNDE yeniden hesaplar (önizlemeden sonra değişen kayıtlar
 * gözden kaçmasın) ve tek bir hata varsa hiçbir şey yazmaz.
 */
@Injectable()
export class StructureImportService {
  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly audit: AuditService,
  ) {}

  private async snapshot(db: Db): Promise<ExistingStructure> {
    const siteId = requireSiteId();
    const [blocks, units, people, occupancies, settings] = await Promise.all([
      db.block.findMany({ select: { id: true, name: true, isActive: true } }),
      db.unit.findMany({ select: { id: true, blockId: true, doorNumber: true, isActive: true } }),
      db.person.findMany({
        where: { isActive: true },
        select: { id: true, firstName: true, lastName: true, phone: true, nationalId: true },
      }),
      db.unitOccupancy.findMany({
        where: { OR: [{ endDate: null }, { endDate: { gte: new Date() } }] },
        select: { unitId: true, personId: true, role: true, person: { select: { firstName: true, lastName: true } } },
      }),
      db.siteSettings.findUnique({ where: { siteId } }),
    ]);
    return {
      blocks,
      units,
      people,
      occupancies: occupancies.map((o) => ({
        unitId: o.unitId,
        personId: o.personId,
        role: o.role,
        personName: `${o.person.firstName} ${o.person.lastName}`,
      })),
      required: {
        phone: settings?.requireMobilePhone ?? false,
        email: settings?.requireEmail ?? false,
        nationalId: settings?.requireNationalId ?? false,
      },
    };
  }

  private today() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  private async plan(text: string, db: Db) {
    const parsed = parseStructureSheet(text);
    const plan = planStructureImport(parsed.rows, await this.snapshot(db), this.today());
    const errors = [...parsed.errors, ...plan.errors].sort((a, b) => a.line - b.line);
    return { parsed, plan, errors };
  }

  async preview(text: string) {
    const { parsed, plan, errors } = await this.plan(text, this.db);
    return {
      columns: parsed.columns,
      summary: plan.summary,
      rows: plan.rows,
      errors,
      // Toplam satır: geçerli + hatalı (bir satırın birden çok hatası olabilir)
      totalRows: plan.rows.length + new Set(errors.map((e) => e.line)).size,
      canCommit: errors.length === 0 && plan.rows.length > 0,
    };
  }

  async commit(text: string) {
    const siteId = requireSiteId();
    const summary = await this.db.$transaction(
      async (tx) => {
        const { plan, errors } = await this.plan(text, tx);
        if (errors.length) {
          throw new BadRequestException({
            message: `${new Set(errors.map((e) => e.line)).size} satırda hata var; hiçbir kayıt yazılmadı`,
            errors,
          });
        }
        if (!plan.rows.length) throw new BadRequestException('Aktarılacak satır yok');
        await this.write(tx, siteId, plan);
        return plan.summary;
      },
      // Toplu yazma birkaç saniye sürebilir; varsayılan 5 sn yetmeyebilir
      { timeout: 60_000, maxWait: 10_000 },
    );
    await this.audit.record({ action: 'IMPORT', entityType: 'Structure', after: summary });
    return summary;
  }

  /** Kimlikler burada üretilir: ilişkiler aynı işlemde, toplu yazmayla kurulur */
  private async write(tx: Db, siteId: string, plan: StructurePlan) {
    const blockIds = new Map(plan.blocks.map((b) => [b.key, randomUUID()]));
    const unitIds = new Map(plan.units.map((u) => [u.key, randomUUID()]));
    const personIds = new Map(plan.people.map((p) => [p.key, randomUUID()]));
    const resolve = (ref: Ref, created: Map<string, string>) => ('existing' in ref ? ref.existing : created.get(ref.create)!);

    if (plan.blocks.length) {
      const maxOrder = await tx.block.aggregate({ _max: { order: true } });
      let order = (maxOrder._max.order ?? -1) + 1;
      await tx.block.createMany({
        data: plan.blocks.map((b) => ({ id: blockIds.get(b.key)!, siteId, name: b.name, order: order++ })),
      });
    }
    if (plan.units.length) {
      // Kimsenin bağlanmadığı yeni daire "Boş" açılır (varsayılan "Dolu")
      const occupied = new Set(plan.occupancies.flatMap((o) => ('create' in o.unit ? [o.unit.create] : [])));
      await tx.unit.createMany({
        data: plan.units.map((u) => ({
          id: unitIds.get(u.key)!,
          siteId,
          blockId: u.block ? resolve(u.block, blockIds) : null,
          doorNumber: u.doorNumber,
          floor: u.floor,
          area: u.area,
          landShare: u.landShare,
          status: occupied.has(u.key) ? ('OCCUPIED' as const) : ('EMPTY' as const),
        })),
      });
    }
    if (plan.people.length) {
      await tx.person.createMany({
        data: plan.people.map((p) => ({
          id: personIds.get(p.key)!,
          siteId,
          firstName: p.firstName,
          lastName: p.lastName,
          phone: p.phone,
          email: p.email,
          nationalId: p.nationalId,
        })),
      });
      // Her kişinin cari hesabı (PeopleService.create ile aynı kural)
      await (tx as unknown as ExtendedPrismaClient).account.createMany({
        data: plan.people.map((p) => ({
          siteId,
          type: 'PERSON' as const,
          name: `${p.firstName} ${p.lastName}`,
          personId: personIds.get(p.key)!,
          phone: p.phone,
          email: p.email,
        })),
      });
    }
    if (plan.occupancies.length) {
      await tx.unitOccupancy.createMany({
        data: plan.occupancies.map((o) => ({
          siteId,
          unitId: resolve(o.unit, unitIds),
          personId: resolve(o.person, personIds),
          role: o.role,
          startDate: o.startDate,
          bankPaymentCode: o.bankPaymentCode,
        })),
      });
    }
  }
}
