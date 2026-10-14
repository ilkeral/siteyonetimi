import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { occupancySchema, paginationSchema, personSchema, type PersonInput } from '@sy/shared';
import { PeopleService } from './people.service';
import { Roles } from '../common/decorators';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { AuditService } from '../common/audit.service';

const listQuerySchema = paginationSchema.extend({
  onlyDebtors: z.coerce.boolean().optional(),
});

const vehicleSchema = z.object({
  plate: z.string().trim().min(2, 'Plaka zorunlu').max(20),
  brand: z.string().max(50).optional(),
  model: z.string().max(50).optional(),
  color: z.string().max(30).optional(),
  hgsNumber: z.string().max(50).optional(),
  status: z.string().max(30).optional(),
});

@ApiTags('Kişiler')
@Controller('people')
export class PeopleController {
  constructor(
    private readonly people: PeopleService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Kişi listesi (daire ve bakiye bilgisiyle)' })
  list(@Query(new ZodQuery(listQuerySchema)) query: z.infer<typeof listQuerySchema>) {
    return this.people.list(query as never);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Kişi kartı (daireler, araçlar, talepler, iletişim geçmişi)' })
  get(@Param('id') id: string) {
    return this.people.get(id);
  }

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Post()
  @ApiOperation({ summary: 'Kişi oluştur (cari hesabı da açılır)' })
  async create(@Body(new ZodBody(personSchema)) dto: PersonInput) {
    const person = await this.people.create(dto);
    await this.audit.record({
      action: 'CREATE',
      entityType: 'Person',
      entityId: person.id,
      after: dto,
    });
    return person;
  }

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Put(':id')
  @ApiOperation({ summary: 'Kişi güncelle' })
  async update(@Param('id') id: string, @Body(new ZodBody(personSchema)) dto: PersonInput) {
    const person = await this.people.update(id, dto);
    await this.audit.record({ action: 'UPDATE', entityType: 'Person', entityId: id, after: dto });
    return person;
  }

  @Roles('SITE_ADMIN')
  @Delete(':id')
  @ApiOperation({ summary: 'Kişiyi sil (hareketi varsa pasife alınır)' })
  async remove(@Param('id') id: string) {
    const result = await this.people.deactivate(id);
    await this.audit.record({ action: 'DELETE', entityType: 'Person', entityId: id, after: result });
    return result;
  }

  // ---------------------------------------------------------------- daireler

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Post('occupancies')
  @ApiOperation({ summary: 'Kişiyi daireye bağla (malik/kiracı, tarihli)' })
  addOccupancy(@Body(new ZodBody(occupancySchema)) dto: never) {
    return this.people.addOccupancy(dto as never);
  }

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Put('occupancies/:id/end')
  @ApiOperation({ summary: 'Daire ilişkisini sonlandır (çıkış tarihi ver)' })
  endOccupancy(
    @Param('id') id: string,
    @Body(new ZodBody(z.object({ endDate: z.coerce.date() }))) dto: { endDate: Date },
  ) {
    return this.people.endOccupancy(id, dto.endDate);
  }

  @Roles('SITE_ADMIN')
  @Delete('occupancies/:id')
  @ApiOperation({ summary: 'Daire ilişkisini sil' })
  removeOccupancy(@Param('id') id: string) {
    return this.people.removeOccupancy(id);
  }

  // ----------------------------------------------------------------- araçlar

  @Roles('SITE_ADMIN', 'ACCOUNTANT', 'SECURITY')
  @Post(':id/vehicles')
  @ApiOperation({ summary: 'Kişiye araç ekle' })
  addVehicle(
    @Param('id') id: string,
    @Body(new ZodBody(vehicleSchema)) dto: z.infer<typeof vehicleSchema>,
  ) {
    return this.people.addVehicle(id, dto);
  }

  @Roles('SITE_ADMIN', 'ACCOUNTANT', 'SECURITY')
  @Delete('vehicles/:id')
  @ApiOperation({ summary: 'Araç sil' })
  removeVehicle(@Param('id') id: string) {
    return this.people.removeVehicle(id);
  }
}
