import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { paginationSchema, unitSchema } from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { requireSiteId } from '../tenant/tenant.context';
import { Roles } from '../common/decorators';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { toPage } from '../common/pagination';
import { AuditService } from '../common/audit.service';
import { StructureImportService } from './structure-import.service';

/** 'true' (varsayılan): aktifler · 'false': pasifler · 'all': hepsi */
const activeParam = z.enum(['true', 'false', 'all']).default('true');
const activeWhere = (active: 'true' | 'false' | 'all') => (active === 'all' ? {} : { isActive: active === 'true' });

/** Daire no doğal sıralama: "2" < "10", "A-2" < "A-10" */
const doorCollator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });

/** Bugün ya da sonrasında süren daire ilişkisi */
const currentOccupancy = () => ({ OR: [{ endDate: null }, { endDate: { gte: new Date() } }] });

/** Yapıştırılan metin; 2000 satır × ~200 karakter */
const importSchema = z.object({ text: z.string().min(1, 'Liste boş').max(500_000, 'Liste çok büyük') });

const blockSchema = z.object({
  name: z.string().trim().min(1, 'Blok adı zorunlu').max(50),
  code: z.string().max(10).optional(),
  floorCount: z.coerce.number().int().min(0).max(200).optional(),
  order: z.coerce.number().int().default(0),
});

@ApiTags('Yapı')
@Controller()
export class UnitsController {
  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly audit: AuditService,
    private readonly structureImport: StructureImportService,
  ) {}

  // ------------------------------------------------------------ toplu aktarım

  @Roles('SITE_ADMIN')
  @Post('import/structure/preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Toplu kişi/daire listesi önizleme (hiçbir şey yazılmaz)' })
  previewImport(@Body(new ZodBody(importSchema)) body: z.infer<typeof importSchema>) {
    return this.structureImport.preview(body.text);
  }

  @Roles('SITE_ADMIN')
  @Post('import/structure/commit')
  @ApiOperation({ summary: 'Toplu kişi/daire aktarımı — tek işlem, hata varsa hiçbir şey yazılmaz' })
  commitImport(@Body(new ZodBody(importSchema)) body: z.infer<typeof importSchema>) {
    return this.structureImport.commit(body.text);
  }

  // ------------------------------------------------------------------ bloklar

  @Get('blocks')
  @ApiOperation({ summary: 'Blok listesi (daire sayısı yalnızca aktif daireler)' })
  blocks(@Query(new ZodQuery(z.object({ active: activeParam }))) query: { active: 'true' | 'false' | 'all' }) {
    return this.db.block.findMany({
      where: activeWhere(query.active),
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { units: { where: { isActive: true } } } } },
    });
  }

  @Roles('SITE_ADMIN')
  @Post('blocks')
  @ApiOperation({ summary: 'Blok ekle' })
  async createBlock(@Body(new ZodBody(blockSchema)) dto: z.infer<typeof blockSchema>) {
    await this.assertBlockNameFree(dto.name);
    const block = await this.db.block.create({ data: { siteId: requireSiteId(), ...dto } });
    await this.audit.record({ action: 'CREATE', entityType: 'Block', entityId: block.id, after: dto });
    return block;
  }

  @Roles('SITE_ADMIN')
  @Put('blocks/:id')
  @ApiOperation({ summary: 'Blok güncelle' })
  async updateBlock(@Param('id') id: string, @Body(new ZodBody(blockSchema)) dto: z.infer<typeof blockSchema>) {
    const existing = await this.requireBlock(id);
    await this.assertBlockNameFree(dto.name, id);
    const block = await this.db.block.update({ where: { id }, data: dto });
    await this.audit.record({ action: 'UPDATE', entityType: 'Block', entityId: id, before: { name: existing.name }, after: dto });
    return block;
  }

  @Roles('SITE_ADMIN')
  @Delete('blocks/:id')
  @ApiOperation({ summary: 'Bloğu pasife al (aktif dairesi yoksa)' })
  async deactivateBlock(@Param('id') id: string) {
    await this.requireBlock(id);
    const activeUnits = await this.db.unit.count({ where: { blockId: id, isActive: true } });
    if (activeUnits > 0) {
      throw new ConflictException(`Blokta ${activeUnits} aktif daire var. Önce daireleri pasife alın ya da başka bloğa taşıyın.`);
    }
    await this.db.block.update({ where: { id }, data: { isActive: false } });
    await this.audit.record({ action: 'DELETE', entityType: 'Block', entityId: id, after: { isActive: false } });
    return { id, isActive: false };
  }

  @Roles('SITE_ADMIN')
  @Post('blocks/:id/reactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pasif bloğu yeniden etkinleştir' })
  async reactivateBlock(@Param('id') id: string) {
    await this.requireBlock(id);
    await this.db.block.update({ where: { id }, data: { isActive: true } });
    await this.audit.record({ action: 'UPDATE', entityType: 'Block', entityId: id, after: { isActive: true } });
    return { id, isActive: true };
  }

  private async requireBlock(id: string) {
    const block = await this.db.block.findFirst({ where: { id } });
    if (!block) throw new NotFoundException('Blok bulunamadı');
    return block;
  }

  /** Pasif blokla aynı ad: veritabanı kısıtı yerine anlaşılır mesaj */
  private async assertBlockNameFree(name: string, exceptId?: string) {
    const clash = await this.db.block.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { isActive: true },
    });
    if (clash) {
      throw new ConflictException(
        clash.isActive ? `"${name}" adında bir blok zaten var` : `"${name}" adında pasif bir blok var; onu yeniden etkinleştirin`,
      );
    }
  }

  // ------------------------------------------------------------------ daireler

  @Get('units')
  @ApiOperation({ summary: 'Daire listesi (oturan kişilerle)' })
  async units(
    @Query(new ZodQuery(paginationSchema.extend({ blockId: z.string().uuid().optional(), active: activeParam })))
    query: never,
  ) {
    const q = query as { page: number; pageSize: number; search?: string; blockId?: string; active: 'true' | 'false' | 'all' };
    const where = {
      ...activeWhere(q.active),
      ...(q.blockId ? { blockId: q.blockId } : {}),
      ...(q.search ? { doorNumber: { contains: q.search, mode: 'insensitive' as const } } : {}),
    };

    // Daire no metindir ("10" < "2" olurdu): sıralama ve sayfalama uygulamada,
    // doğal sıralamayla yapılır. Bir sitede en fazla birkaç yüz daire vardır.
    const items = await this.db.unit.findMany({
      where,
      include: {
        block: { select: { id: true, name: true, order: true } },
        occupancies: {
          where: currentOccupancy(),
          include: { person: { select: { id: true, firstName: true, lastName: true, phone: true } } },
        },
      },
    });
    items.sort(
      (a, b) =>
        (a.block?.order ?? Number.MAX_SAFE_INTEGER) - (b.block?.order ?? Number.MAX_SAFE_INTEGER) ||
        doorCollator.compare(a.block?.name ?? '', b.block?.name ?? '') ||
        doorCollator.compare(a.doorNumber, b.doorNumber),
    );
    const start = (q.page - 1) * q.pageSize;

    return toPage(
      items.slice(start, start + q.pageSize).map(({ block, ...unit }) => ({
        ...unit,
        block: block ? { id: block.id, name: block.name } : null,
        owner: unit.occupancies.find((o) => o.role === 'OWNER')?.person ?? null,
        tenant: unit.occupancies.find((o) => o.role === 'TENANT')?.person ?? null,
      })),
      items.length,
      query as never,
    );
  }

  @Get('units/:id')
  @ApiOperation({ summary: 'Daire kartı' })
  unit(@Param('id') id: string) {
    return this.db.unit.findUniqueOrThrow({
      where: { id },
      include: {
        block: true,
        occupancies: {
          include: { person: true },
          orderBy: { startDate: 'desc' },
        },
        meters: true,
      },
    });
  }

  @Roles('SITE_ADMIN')
  @Post('units')
  @ApiOperation({ summary: 'Daire ekle' })
  async createUnit(@Body(new ZodBody(unitSchema)) dto: z.infer<typeof unitSchema>) {
    await this.assertDoorFree(dto);
    return this.db.unit.create({ data: { siteId: requireSiteId(), ...dto } as never });
  }

  @Roles('SITE_ADMIN')
  @Put('units/:id')
  @ApiOperation({ summary: 'Daire güncelle' })
  async updateUnit(@Param('id') id: string, @Body(new ZodBody(unitSchema)) dto: z.infer<typeof unitSchema>) {
    await this.assertDoorFree(dto, id);
    return this.db.unit.update({ where: { id }, data: dto as never });
  }

  /**
   * Aynı blokta aynı daire no olamaz. Veritabanındaki unique kısıt blok
   * seçilmemiş (NULL) dairelerde çalışmaz — PostgreSQL NULL'ları farklı sayar.
   */
  private async assertDoorFree(dto: { blockId?: string | null; doorNumber: string }, exceptId?: string) {
    const clash = await this.db.unit.findFirst({
      where: { blockId: dto.blockId ?? null, doorNumber: dto.doorNumber, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { isActive: true },
    });
    if (clash) {
      throw new ConflictException(
        `Bu blokta ${dto.doorNumber} numaralı daire zaten var${clash.isActive ? '' : ' (pasif)'}`,
      );
    }
  }

  /**
   * Pasif daireye aidat ve sayaç tahakkuku yapılmaz. İçinde oturan varken
   * pasife almak onların borçlanmasını sessizce durdururdu — önce çıkış verilir.
   */
  @Roles('SITE_ADMIN')
  @Delete('units/:id')
  @ApiOperation({ summary: 'Daireyi pasife al (aktif oturanı yoksa)' })
  async deactivateUnit(@Param('id') id: string) {
    const unit = await this.db.unit.findFirst({
      where: { id },
      include: { occupancies: { where: currentOccupancy(), include: { person: { select: { firstName: true, lastName: true } } } } },
    });
    if (!unit) throw new NotFoundException('Daire bulunamadı');
    if (unit.occupancies.length > 0) {
      const names = unit.occupancies.map((o) => `${o.person.firstName} ${o.person.lastName}`).join(', ');
      throw new ConflictException(`Dairede oturan kayıtlı (${names}). Önce kişi kartından çıkış tarihi verin.`);
    }
    await this.db.unit.update({ where: { id }, data: { isActive: false } });
    await this.audit.record({ action: 'DELETE', entityType: 'Unit', entityId: id, after: { isActive: false } });
    return { id, isActive: false };
  }

  @Roles('SITE_ADMIN')
  @Post('units/:id/reactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pasif daireyi yeniden etkinleştir' })
  async reactivateUnit(@Param('id') id: string) {
    const unit = await this.db.unit.findFirst({ where: { id }, include: { block: { select: { isActive: true, name: true } } } });
    if (!unit) throw new NotFoundException('Daire bulunamadı');
    if (unit.block && !unit.block.isActive) {
      throw new ConflictException(`${unit.block.name} pasif. Önce bloğu etkinleştirin.`);
    }
    await this.db.unit.update({ where: { id }, data: { isActive: true } });
    await this.audit.record({ action: 'UPDATE', entityType: 'Unit', entityId: id, after: { isActive: true } });
    return { id, isActive: true };
  }
}
