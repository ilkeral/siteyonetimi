import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PersonInput } from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { requireSiteId } from '../tenant/tenant.context';
import { LedgerService } from '../finance/ledger.service';
import { orderBy, paginate, toPage } from '../common/pagination';

type ListQuery = {
  page: number;
  pageSize: number;
  search?: string;
  letter?: string;
  sortBy?: string;
  sortDir: 'asc' | 'desc';
};

@Injectable()
export class PeopleService {
  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly ledger: LedgerService,
  ) {}

  async list(query: ListQuery & { onlyDebtors?: boolean }) {
    const where = {
      isActive: true,
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' as const } },
              { lastName: { contains: query.search, mode: 'insensitive' as const } },
              { nationalId: { contains: query.search } },
              { phone: { contains: query.search } },
              { email: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(query.letter
        ? { lastName: { startsWith: query.letter, mode: 'insensitive' as const } }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.db.person.findMany({
        where,
        ...paginate(query),
        orderBy: orderBy(query, ['lastName', 'firstName', 'createdAt'], {
          lastName: 'asc',
        }),
        include: {
          account: { select: { id: true } },
          occupancies: {
            where: { OR: [{ endDate: null }, { endDate: { gte: new Date() } }] },
            select: {
              role: true,
              unit: { select: { doorNumber: true, block: { select: { name: true } } } },
            },
          },
        },
      }),
      this.db.person.count({ where }),
    ]);

    const balances = await this.ledger.balancesOf(
      items.map((i) => i.account?.id).filter(Boolean) as string[],
    );

    const rows = items.map((person) => ({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      fullName: `${person.firstName} ${person.lastName}`,
      nationalId: person.nationalId,
      phone: person.phone,
      email: person.email,
      language: person.language,
      inLegalAction: person.inLegalAction,
      accountId: person.account?.id ?? null,
      balanceMinor: person.account ? (balances.get(person.account.id) ?? 0) : 0,
      // "4(M) 16(K)" — Apsiyon'daki daire kolonunun karşılığı
      units: person.occupancies.map((o) => ({
        doorNumber: o.unit.doorNumber,
        blockName: o.unit.block?.name ?? null,
        role: o.role,
      })),
    }));

    return toPage(
      query.onlyDebtors ? rows.filter((r) => r.balanceMinor > 0) : rows,
      total,
      query,
    );
  }

  async get(id: string) {
    const person = await this.db.person.findUnique({
      where: { id },
      include: {
        account: { select: { id: true, name: true } },
        vehicles: true,
        occupancies: {
          include: { unit: { include: { block: { select: { name: true } } } } },
          orderBy: { startDate: 'desc' },
        },
        tickets: {
          select: { id: true, number: true, subject: true, status: true, date: true },
          orderBy: { date: 'desc' },
          take: 20,
        },
        messages: {
          select: { id: true, channel: true, subject: true, status: true, sentAt: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!person) throw new NotFoundException('Kişi bulunamadı');

    const balanceMinor = person.account
      ? (await this.ledger.balanceOf(person.account.id)).balanceMinor
      : 0;

    return { ...person, balanceMinor };
  }

  /**
   * Kişi oluşturur ve **cari hesabını da aynı anda açar**.
   * Cari hesapsız kişi, aidat tahakkukunda sessizce atlanacağı için
   * bu ikisi hiçbir zaman ayrı yaratılmaz.
   */
  async create(input: PersonInput) {
    const siteId = requireSiteId();
    await this.assertRequiredFields(input);

    return this.db.$transaction(async (tx) => {
      const person = await tx.person.create({
        data: {
          siteId,
          firstName: input.firstName,
          lastName: input.lastName,
          nationalId: emptyToNull(input.nationalId),
          email: emptyToNull(input.email),
          phone: emptyToNull(input.phone),
          phone2: emptyToNull(input.phone2),
          birthDate: input.birthDate ?? null,
          language: input.language,
          note: input.note,
          inLegalAction: input.inLegalAction,
        },
      });

      await tx.account.create({
        data: {
          siteId,
          type: 'PERSON',
          name: `${person.firstName} ${person.lastName}`,
          personId: person.id,
          phone: person.phone,
          email: person.email,
        },
      });

      return person;
    });
  }

  async update(id: string, input: PersonInput) {
    await this.assertRequiredFields(input);

    return this.db.$transaction(async (tx) => {
      const person = await tx.person.update({
        where: { id },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          nationalId: emptyToNull(input.nationalId),
          email: emptyToNull(input.email),
          phone: emptyToNull(input.phone),
          phone2: emptyToNull(input.phone2),
          birthDate: input.birthDate ?? null,
          language: input.language,
          note: input.note,
          inLegalAction: input.inLegalAction,
        },
      });

      // Cari adı kişi adıyla senkron kalsın (ekstrelerde doğru isim görünür)
      await tx.account.updateMany({
        where: { personId: id },
        data: {
          name: `${person.firstName} ${person.lastName}`,
          phone: person.phone,
          email: person.email,
        },
      });

      return person;
    });
  }

  /**
   * Kişiyi pasife alır. Hareketi olan kişi silinmez — defterin bütünlüğü
   * ve geçmiş dönem ekstreleri bozulmasın diye.
   */
  async deactivate(id: string) {
    const account = await this.db.account.findFirst({ where: { personId: id } });
    if (account) {
      const entryCount = await this.db.ledgerEntry.count({ where: { accountId: account.id } });
      if (entryCount > 0) {
        await this.db.person.update({ where: { id }, data: { isActive: false } });
        await this.db.account.update({ where: { id: account.id }, data: { isActive: false } });
        return { deleted: false, deactivated: true };
      }
    }
    await this.db.person.delete({ where: { id } });
    return { deleted: true, deactivated: false };
  }

  // ------------------------------------------------------------- daire ilişkisi

  async addOccupancy(input: {
    unitId: string;
    personId: string;
    role: 'OWNER' | 'TENANT';
    startDate: Date;
    endDate?: Date | null;
    bankPaymentCode?: string;
    note?: string;
  }) {
    const siteId = requireSiteId();

    // Aynı rol için tarih aralığı çakışması engellenir:
    // bir dairede aynı anda iki malik ya da iki kiracı olamaz.
    const overlapping = await this.db.unitOccupancy.findFirst({
      where: {
        unitId: input.unitId,
        role: input.role,
        AND: [
          { startDate: { lte: input.endDate ?? new Date('2999-12-31') } },
          { OR: [{ endDate: null }, { endDate: { gte: input.startDate } }] },
        ],
      },
      include: { person: { select: { firstName: true, lastName: true } } },
    });

    if (overlapping) {
      throw new BadRequestException(
        `Bu tarih aralığında dairede zaten bir ${
          input.role === 'OWNER' ? 'malik' : 'kiracı'
        } var: ${overlapping.person.firstName} ${overlapping.person.lastName}`,
      );
    }

    return this.db.unitOccupancy.create({
      data: {
        siteId,
        unitId: input.unitId,
        personId: input.personId,
        role: input.role,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        bankPaymentCode: input.bankPaymentCode?.trim() || null,
        note: input.note,
      },
    });
  }

  async endOccupancy(id: string, endDate: Date) {
    const occupancy = await this.db.unitOccupancy.findUnique({ where: { id } });
    if (!occupancy) throw new NotFoundException('Daire ilişkisi bulunamadı');
    if (endDate < occupancy.startDate) {
      throw new BadRequestException('Çıkış tarihi giriş tarihinden önce olamaz');
    }
    return this.db.unitOccupancy.update({ where: { id }, data: { endDate } });
  }

  async removeOccupancy(id: string) {
    return this.db.unitOccupancy.delete({ where: { id } });
  }

  // ------------------------------------------------------------------- araçlar

  async addVehicle(personId: string, input: Record<string, string | undefined>) {
    const siteId = requireSiteId();
    return this.db.vehicle.create({
      data: {
        siteId,
        personId,
        plate: (input.plate ?? '').toUpperCase().replace(/\s+/g, ' ').trim(),
        brand: input.brand,
        model: input.model,
        color: input.color,
        hgsNumber: input.hgsNumber,
        status: input.status,
      },
    });
  }

  async removeVehicle(id: string) {
    return this.db.vehicle.delete({ where: { id } });
  }

  // ------------------------------------------------------------------ yardımcı

  /** SiteSettings'teki "Zorunlu Alanlar" ayarını uygular */
  private async assertRequiredFields(input: PersonInput): Promise<void> {
    const siteId = requireSiteId();
    const settings = await this.db.siteSettings.findUnique({ where: { siteId } });
    if (!settings) return;

    const missing: string[] = [];
    if (settings.requireNationalId && !input.nationalId) missing.push('TC Kimlik No');
    if (settings.requireEmail && !input.email) missing.push('E-posta');
    if (settings.requireMobilePhone && !input.phone) missing.push('Cep telefonu');

    if (missing.length > 0) {
      throw new BadRequestException(
        `Site ayarlarına göre şu alanlar zorunlu: ${missing.join(', ')}`,
      );
    }
  }
}

function emptyToNull(value: string | undefined | null): string | null {
  return value && value.trim() !== '' ? value.trim() : null;
}
