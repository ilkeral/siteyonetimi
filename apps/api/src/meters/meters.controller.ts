import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  mainMeterReadingsSchema,
  meterDistributionSchema,
  unitMeterReadingsSchema,
  type MainMeterReadingsInput,
  type MeterDistributionInput,
  type UnitMeterReadingsInput,
} from '@sy/shared';
import { MetersService } from './meters.service';
import { Roles } from '../common/decorators';
import { ZodBody } from '../common/zod-validation.pipe';
import { AuditService } from '../common/audit.service';

/**
 * Teknik personel okuma girebilir; dağıtımı oluşturma, parametreler, onay ve
 * geri alma finansal işlemdir (yönetici / muhasebe).
 */
@ApiTags('Sayaç İşlemleri')
@Roles('SITE_ADMIN', 'ACCOUNTANT', 'TECHNICIAN')
@Controller('meters/distributions')
export class MetersController {
  constructor(
    private readonly meters: MetersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Sayaç dağıtımları (dönem listesi)' })
  list() {
    return this.meters.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Dağıtım sihirbazı verisi (parametreler, okumalar, öneriler)' })
  get(@Param('id') id: string) {
    return this.meters.get(id);
  }

  @Get(':id/preview')
  @ApiOperation({ summary: 'Dağıtım önizlemesi — hiçbir şey yazmaz' })
  preview(@Param('id') id: string) {
    return this.meters.preview(id);
  }

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Post()
  @ApiOperation({ summary: 'Taslak dağıtım oluştur (1. adım)' })
  async create(@Body(new ZodBody(meterDistributionSchema)) dto: MeterDistributionInput) {
    const distribution = await this.meters.create(dto);
    await this.audit.record({ action: 'CREATE', entityType: 'MeterDistribution', entityId: distribution.id, after: dto });
    return distribution;
  }

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Put(':id')
  @ApiOperation({ summary: 'Evrak bilgileri ve dağıtım parametrelerini güncelle' })
  async update(@Param('id') id: string, @Body(new ZodBody(meterDistributionSchema)) dto: MeterDistributionInput) {
    const distribution = await this.meters.update(id, dto);
    await this.audit.record({ action: 'UPDATE', entityType: 'MeterDistribution', entityId: id, after: dto });
    return distribution;
  }

  @Put(':id/main-readings')
  @ApiOperation({ summary: 'Ana sayaç okumaları ve fatura tutarları (2. adım)' })
  saveMain(@Param('id') id: string, @Body(new ZodBody(mainMeterReadingsSchema)) dto: MainMeterReadingsInput) {
    return this.meters.saveMainReadings(id, dto);
  }

  @Put(':id/unit-readings')
  @ApiOperation({ summary: 'Tek türün daire okumaları (3. adım, elle ya da içe aktarım)' })
  saveUnits(@Param('id') id: string, @Body(new ZodBody(unitMeterReadingsSchema)) dto: UnitMeterReadingsInput) {
    return this.meters.saveUnitReadings(id, dto);
  }

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Post(':id/approve')
  @ApiOperation({ summary: 'Onayla: daire başına sayaç paylaşım evrakı üret (4. adım)' })
  async approve(@Param('id') id: string) {
    const result = await this.meters.approve(id);
    await this.audit.record({ action: 'POST', entityType: 'MeterDistribution', entityId: id, after: result });
    return result;
  }

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Post(':id/revert')
  @ApiOperation({ summary: 'Onayı geri al: evrakları iptal et, taslağa döndür' })
  async revert(@Param('id') id: string) {
    const result = await this.meters.revert(id);
    await this.audit.record({ action: 'CANCEL', entityType: 'MeterDistribution', entityId: id, after: result });
    return result;
  }

  @Roles('SITE_ADMIN', 'ACCOUNTANT')
  @Delete(':id')
  @ApiOperation({ summary: 'Taslak dağıtımı sil' })
  async remove(@Param('id') id: string) {
    const result = await this.meters.remove(id);
    await this.audit.record({ action: 'DELETE', entityType: 'MeterDistribution', entityId: id });
    return result;
  }
}
