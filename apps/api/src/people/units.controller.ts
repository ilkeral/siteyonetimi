import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { paginationSchema, unitSchema } from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { requireSiteId } from '../tenant/tenant.context';
import { Roles } from '../common/decorators';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { paginate, toPage } from '../common/pagination';

const blockSchema = z.object({
  name: z.string().trim().min(1, 'Blok adı zorunlu').max(50),
  code: z.string().max(10).optional(),
  floorCount: z.coerce.number().int().min(0).max(200).optional(),
  order: z.coerce.number().int().default(0),
});

@ApiTags('Yapı')
@Controller()
export class UnitsController {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  // ------------------------------------------------------------------ bloklar

  @Get('blocks')
  @ApiOperation({ summary: 'Blok listesi' })
  blocks() {
    return this.db.block.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
      include: { _count: { select: { units: true } } },
    });
  }

  @Roles('SITE_ADMIN')
  @Post('blocks')
  @ApiOperation({ summary: 'Blok ekle' })
  createBlock(@Body(new ZodBody(blockSchema)) dto: z.infer<typeof blockSchema>) {
    return this.db.block.create({ data: { siteId: requireSiteId(), ...dto } });
  }

  @Roles('SITE_ADMIN')
  @Put('blocks/:id')
  @ApiOperation({ summary: 'Blok güncelle' })
  updateBlock(@Param('id') id: string, @Body(new ZodBody(blockSchema)) dto: z.infer<typeof blockSchema>) {
    return this.db.block.update({ where: { id }, data: dto });
  }

  // ------------------------------------------------------------------ daireler

  @Get('units')
  @ApiOperation({ summary: 'Daire listesi (oturan kişilerle)' })
  async units(
    @Query(new ZodQuery(paginationSchema.extend({ blockId: z.string().uuid().optional() })))
    query: never,
  ) {
    const q = query as { page: number; pageSize: number; search?: string; blockId?: string };
    const where = {
      isActive: true,
      ...(q.blockId ? { blockId: q.blockId } : {}),
      ...(q.search ? { doorNumber: { contains: q.search } } : {}),
    };

    const [items, total] = await Promise.all([
      this.db.unit.findMany({
        where,
        ...paginate(query as never),
        orderBy: [{ block: { order: 'asc' } }, { doorNumber: 'asc' }],
        include: {
          block: { select: { id: true, name: true } },
          occupancies: {
            where: { OR: [{ endDate: null }, { endDate: { gte: new Date() } }] },
            include: { person: { select: { id: true, firstName: true, lastName: true, phone: true } } },
          },
        },
      }),
      this.db.unit.count({ where }),
    ]);

    return toPage(
      items.map((unit) => ({
        ...unit,
        owner: unit.occupancies.find((o) => o.role === 'OWNER')?.person ?? null,
        tenant: unit.occupancies.find((o) => o.role === 'TENANT')?.person ?? null,
      })),
      total,
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
  createUnit(@Body(new ZodBody(unitSchema)) dto: z.infer<typeof unitSchema>) {
    return this.db.unit.create({ data: { siteId: requireSiteId(), ...dto } as never });
  }

  @Roles('SITE_ADMIN')
  @Put('units/:id')
  @ApiOperation({ summary: 'Daire güncelle' })
  updateUnit(@Param('id') id: string, @Body(new ZodBody(unitSchema)) dto: z.infer<typeof unitSchema>) {
    return this.db.unit.update({ where: { id }, data: dto as never });
  }

  @Roles('SITE_ADMIN')
  @Delete('units/:id')
  @ApiOperation({ summary: 'Daireyi pasife al' })
  deactivateUnit(@Param('id') id: string) {
    return this.db.unit.update({ where: { id }, data: { isActive: false } });
  }
}
