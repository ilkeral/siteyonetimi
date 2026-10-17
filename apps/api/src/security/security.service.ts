import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type IncidentCategory, type IncidentSeverity, type LostItem, type LostItemStatus } from '@sy/db';
import {
  daysInCustody,
  formatPlate,
  isOverstay,
  maskNationalId,
  normalizePlate,
  planLostItemTransition,
  visitMinutes,
  VISITOR_OVERSTAY_HOURS,
  type LostItemCreateInput,
  type LostItemDetailsInput,
  type LostItemTransitionBody,
  type SecurityIncidentInput,
  type VisitorInput,
} from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { currentUserId, getTenantContext, requireSiteId } from '../tenant/tenant.context';
import { AuditService } from '../common/audit.service';
import { paginate, toPage } from '../common/pagination';

/** Olay kaydında "görevli" seçilebilecek roller */
const STAFF_ROLES = ['SITE_ADMIN', 'SECURITY'] as const;

interface DateRange {
  from?: string;
  to?: string;
}

interface Paged {
  page: number;
  pageSize: number;
  sortDir: 'asc' | 'desc';
}

export type IncidentQuery = Paged &
  DateRange & { search?: string; category?: IncidentCategory; severity?: IncidentSeverity };
export type LostItemQuery = Paged & { search?: string; status?: LostItemStatus; open?: boolean };
export type VisitorQuery = Paged & DateRange & { search?: string; inside?: boolean };

/** 'YYYY-MM-DD' aralığı → [gün başı, bitiş gününün sonu] (sunucu saat dilimi) */
function dateRange(range: DateRange): Prisma.DateTimeFilter | undefined {
  if (!range.from && !range.to) return undefined;
  return {
    ...(range.from ? { gte: new Date(`${range.from}T00:00:00`) } : {}),
    ...(range.to ? { lte: new Date(`${range.to}T23:59:59.999`) } : {}),
  };
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

const unitSelect = { id: true, doorNumber: true, block: { select: { name: true } } } satisfies Prisma.UnitSelect;
const personSelect = { id: true, firstName: true, lastName: true } satisfies Prisma.PersonSelect;

function unitLabel(unit: { id: string; doorNumber: string; block: { name: string } | null } | null) {
  if (!unit) return null;
  return { id: unit.id, label: unit.block ? `${unit.block.name} / ${unit.doorNumber}` : unit.doorNumber };
}

function personLabel(person: { id: string; firstName: string; lastName: string } | null) {
  return person ? { id: person.id, fullName: `${person.firstName} ${person.lastName}` } : null;
}

const visitorInclude = {
  unit: { select: unitSelect },
  hostPerson: { select: personSelect },
} satisfies Prisma.VisitorLogInclude;

type VisitorRow = Prisma.VisitorLogGetPayload<{ include: typeof visitorInclude }>;

@Injectable()
export class SecurityService {
  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly audit: AuditService,
  ) {}

  // ================================================================ özet

  async summary() {
    const now = new Date();
    const today = startOfToday();
    const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
    const overstayBefore = new Date(now.getTime() - VISITOR_OVERSTAY_HOURS * 3_600_000);

    const [inside, overstay, visitorsToday, incidents, highIncidents, lostByStatus] = await Promise.all([
      this.db.visitorLog.count({ where: { exitedAt: null } }),
      this.db.visitorLog.count({ where: { exitedAt: null, enteredAt: { lt: overstayBefore } } }),
      this.db.visitorLog.count({ where: { enteredAt: { gte: today } } }),
      this.db.securityIncident.count({ where: { date: { gte: monthAgo } } }),
      this.db.securityIncident.count({ where: { date: { gte: monthAgo }, severity: 'HIGH' } }),
      this.db.lostItem.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    const lost = Object.fromEntries(lostByStatus.map((row) => [row.status, row._count._all]));

    return {
      visitorsInside: inside,
      visitorsOverstay: overstay,
      visitorsToday,
      incidentsLast30Days: incidents,
      highIncidentsLast30Days: highIncidents,
      lostReports: lost.LOST ?? 0,
      lostInCustody: (lost.FOUND ?? 0) + (lost.CLAIMED ?? 0),
      lostAwaitingDelivery: lost.CLAIMED ?? 0,
    };
  }

  async meta() {
    const siteId = requireSiteId();
    const memberships = await this.db.siteMembership.findMany({
      where: { siteId, isActive: true, role: { in: [...STAFF_ROLES] }, user: { isActive: true } },
      select: { role: true, user: { select: { id: true, fullName: true } } },
      orderBy: { user: { fullName: 'asc' } },
    });
    return { staff: memberships.map((m) => ({ id: m.user.id, fullName: m.user.fullName, role: m.role })) };
  }

  // ================================================================ ortak doğrulama

  /** Seçilen kişi/daire/görevli bu siteye ait mi — tenant filtresi başka siteyi zaten göstermez */
  private async assertReferences(refs: { personId?: string | null; unitId?: string | null; staffId?: string | null }) {
    const siteId = requireSiteId();
    const [person, unit, staff] = await Promise.all([
      refs.personId ? this.db.person.count({ where: { id: refs.personId } }) : 1,
      refs.unitId ? this.db.unit.count({ where: { id: refs.unitId } }) : 1,
      refs.staffId
        ? this.db.siteMembership.count({
            where: { siteId, userId: refs.staffId, isActive: true, role: { in: [...STAFF_ROLES] } },
          })
        : 1,
    ]);
    if (!person) throw new BadRequestException('Seçilen kişi bulunamadı');
    if (!unit) throw new BadRequestException('Seçilen daire bulunamadı');
    if (!staff) throw new BadRequestException('Seçilen görevli bu sitede güvenlik/yönetici değil');
  }

  /** Yönetici her kaydı, diğerleri yalnızca kendi açtığı kaydı düzenler */
  private assertCanEdit(createdById: string | null) {
    const ctx = getTenantContext();
    if (ctx?.isSuperAdmin || ctx?.role === 'SITE_ADMIN') return;
    if (!createdById || createdById !== ctx?.userId) {
      throw new ForbiddenException('Bu kaydı yalnızca kaydı açan kişi ya da yönetici düzenleyebilir');
    }
  }

  // ================================================================ olaylar

  private incidentInclude = {
    person: { select: personSelect },
    unit: { select: unitSelect },
  } satisfies Prisma.SecurityIncidentInclude;

  private async staffNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (!unique.length) return new Map<string, string>();
    const users = await this.db.user.findMany({ where: { id: { in: unique } }, select: { id: true, fullName: true } });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  async listIncidents(query: IncidentQuery) {
    const where: Prisma.SecurityIncidentWhereInput = {
      date: dateRange(query),
      category: query.category,
      severity: query.severity,
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { body: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.securityIncident.findMany({
        where,
        include: this.incidentInclude,
        orderBy: [{ date: query.sortDir }, { createdAt: query.sortDir }],
        ...paginate(query),
      }),
      this.db.securityIncident.count({ where }),
    ]);
    const names = await this.staffNames(rows.flatMap((r) => [r.staffId, r.createdById]));
    return toPage(
      rows.map((row) => ({
        id: row.id,
        date: row.date,
        title: row.title,
        category: row.category,
        severity: row.severity,
        excerpt: row.body.length > 140 ? `${row.body.slice(0, 140)}…` : row.body,
        person: personLabel(row.person),
        unit: unitLabel(row.unit),
        staff: row.staffId ? { id: row.staffId, fullName: names.get(row.staffId) ?? '—' } : null,
      })),
      total,
      query,
    );
  }

  async getIncident(id: string) {
    const row = await this.db.securityIncident.findFirst({ where: { id }, include: this.incidentInclude });
    if (!row) throw new NotFoundException('Olay kaydı bulunamadı');
    const names = await this.staffNames([row.staffId, row.createdById]);
    const ctx = getTenantContext();
    return {
      id: row.id,
      date: row.date,
      title: row.title,
      category: row.category,
      severity: row.severity,
      body: row.body,
      personId: row.personId,
      unitId: row.unitId,
      staffId: row.staffId,
      person: personLabel(row.person),
      unit: unitLabel(row.unit),
      staff: row.staffId ? { id: row.staffId, fullName: names.get(row.staffId) ?? '—' } : null,
      createdBy: row.createdById ? names.get(row.createdById) ?? '—' : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      canEdit: !!(ctx?.isSuperAdmin || ctx?.role === 'SITE_ADMIN' || (row.createdById && row.createdById === ctx?.userId)),
    };
  }

  private incidentFields(input: SecurityIncidentInput) {
    return {
      date: input.date,
      title: input.title,
      category: input.category,
      severity: input.severity,
      body: input.body,
      staffId: input.staffId ?? null,
      personId: input.personId ?? null,
      unitId: input.unitId ?? null,
    };
  }

  async createIncident(input: SecurityIncidentInput) {
    if (input.date.getTime() > Date.now() + 5 * 60_000) {
      throw new BadRequestException('Olay tarihi ileri bir zaman olamaz');
    }
    await this.assertReferences(input);
    const row = await this.db.securityIncident.create({
      data: { siteId: requireSiteId(), createdById: currentUserId(), ...this.incidentFields(input) },
    });
    await this.audit.record({ action: 'CREATE', entityType: 'SecurityIncident', entityId: row.id, after: input });
    return { id: row.id };
  }

  async updateIncident(id: string, input: SecurityIncidentInput) {
    const existing = await this.db.securityIncident.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException('Olay kaydı bulunamadı');
    this.assertCanEdit(existing.createdById);
    if (input.date.getTime() > Date.now() + 5 * 60_000) {
      throw new BadRequestException('Olay tarihi ileri bir zaman olamaz');
    }
    await this.assertReferences(input);
    await this.db.securityIncident.update({ where: { id }, data: this.incidentFields(input) });
    await this.audit.record({
      action: 'UPDATE',
      entityType: 'SecurityIncident',
      entityId: id,
      before: { title: existing.title, body: existing.body, date: existing.date, severity: existing.severity },
      after: input,
    });
    return { id };
  }

  async deleteIncident(id: string) {
    const existing = await this.db.securityIncident.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException('Olay kaydı bulunamadı');
    await this.db.securityIncident.delete({ where: { id } });
    await this.audit.record({
      action: 'DELETE',
      entityType: 'SecurityIncident',
      entityId: id,
      before: { title: existing.title, body: existing.body, date: existing.date },
    });
    return { id };
  }

  // ================================================================ kayıp eşya

  private lostItemView(row: LostItem, now = new Date()) {
    return {
      ...row,
      daysInCustody: row.status === 'FOUND' || row.status === 'CLAIMED' ? daysInCustody(row.foundAt, now) : null,
    };
  }

  async listLostItems(query: LostItemQuery) {
    const number = query.search && /^\d+$/.test(query.search) ? Number(query.search) : undefined;
    const where: Prisma.LostItemWhereInput = {
      status: query.status ?? (query.open ? { in: ['LOST', 'FOUND', 'CLAIMED'] } : undefined),
      ...(query.search
        ? {
            OR: [
              { itemName: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
              { location: { contains: query.search, mode: 'insensitive' } },
              { loserName: { contains: query.search, mode: 'insensitive' } },
              ...(number !== undefined && number <= 2_147_483_647 ? [{ number }] : []),
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.lostItem.findMany({ where, orderBy: { number: query.sortDir }, ...paginate(query) }),
      this.db.lostItem.count({ where }),
    ]);
    const now = new Date();
    return toPage(
      rows.map((row) => this.lostItemView(row, now)),
      total,
      query,
    );
  }

  private async requireLostItem(id: string) {
    const row = await this.db.lostItem.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Kayıp eşya kaydı bulunamadı');
    return row;
  }

  async getLostItem(id: string) {
    const row = await this.requireLostItem(id);
    const [history, names] = await Promise.all([
      this.db.auditLog.findMany({
        where: { siteId: requireSiteId(), entityType: 'LostItem', entityId: id },
        orderBy: { createdAt: 'asc' },
        select: { id: true, action: true, after: true, createdAt: true, userId: true },
      }),
      this.staffNames([row.createdById]),
    ]);
    const userNames = await this.staffNames(history.map((h) => h.userId));
    return {
      ...this.lostItemView(row),
      createdBy: row.createdById ? names.get(row.createdById) ?? '—' : null,
      history: history.map((h) => ({
        id: h.id,
        action: h.action,
        status: (h.after as { status?: string } | null)?.status ?? null,
        at: h.createdAt,
        user: h.userId ? userNames.get(h.userId) ?? '—' : null,
      })),
    };
  }

  private detailFields(input: LostItemDetailsInput) {
    return {
      itemName: input.itemName,
      description: input.description ?? null,
      location: input.location ?? null,
      lostAt: input.lostAt ?? null,
      loserName: input.loserName ?? null,
      loserPhone: input.loserPhone ?? null,
      finderName: input.finderName ?? null,
      finderPhone: input.finderPhone ?? null,
      custodianName: input.custodianName ?? null,
      custodianRole: input.custodianRole ?? null,
    };
  }

  async createLostItem(input: LostItemCreateInput) {
    const siteId = requireSiteId();
    const now = new Date();
    const foundAt = input.status === 'FOUND' ? input.foundAt ?? now : null;
    if ((foundAt && foundAt > new Date(now.getTime() + 5 * 60_000)) || (input.lostAt && input.lostAt > now)) {
      throw new BadRequestException('Tarih ileri bir zaman olamaz');
    }

    // Emanet numarası site içinde artan; eşzamanlı kayıtta unique çakışırsa yeniden dene
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const row = await this.db.$transaction(async (tx) => {
          const last = await tx.lostItem.findFirst({ orderBy: { number: 'desc' }, select: { number: true } });
          return tx.lostItem.create({
            data: {
              siteId,
              number: (last?.number ?? 0) + 1,
              status: input.status,
              foundAt,
              createdById: currentUserId(),
              ...this.detailFields(input),
            },
          });
        });
        await this.audit.record({
          action: 'CREATE',
          entityType: 'LostItem',
          entityId: row.id,
          after: { status: row.status, itemName: row.itemName },
        });
        return { id: row.id, number: row.number };
      } catch (error) {
        const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!conflict || attempt === 2) throw error;
      }
    }
    throw new ConflictException('Emanet numarası alınamadı, tekrar deneyin');
  }

  async updateLostItem(id: string, input: LostItemDetailsInput) {
    const existing = await this.requireLostItem(id);
    if (existing.status === 'DELIVERED' || existing.status === 'DISPOSED') {
      throw new ConflictException('Teslim edilmiş ya da imha edilmiş kayıt değiştirilemez');
    }
    if (existing.status !== 'LOST' && !input.custodianName) {
      throw new BadRequestException('Emanetteki eşyanın emanetçisi boş bırakılamaz');
    }
    await this.db.lostItem.update({ where: { id }, data: this.detailFields(input) });
    await this.audit.record({ action: 'UPDATE', entityType: 'LostItem', entityId: id, after: { itemName: input.itemName } });
    return { id };
  }

  async transitionLostItem(id: string, body: LostItemTransitionBody) {
    const existing = await this.requireLostItem(id);
    const plan = planLostItemTransition(existing, body, new Date());
    if (!plan.ok) {
      throw new BadRequestException({
        message: plan.errors.map((e) => e.message).join(' · '),
        errors: plan.errors,
      });
    }
    // Eşzamanlı iki geçişten yalnızca biri uygulanır (durum hâlâ okunduğu gibiyse)
    const result = await this.db.lostItem.updateMany({
      where: { id, status: existing.status },
      data: plan.changes,
    });
    if (result.count === 0) throw new ConflictException('Kayıt bu arada değişti, sayfayı yenileyin');
    await this.audit.record({
      action: 'UPDATE',
      entityType: 'LostItem',
      entityId: id,
      before: { status: existing.status },
      after: plan.changes,
    });
    return { id, status: body.to };
  }

  /** Yalnızca henüz bulunmamış kayıp bildirimi geri çekilebilir */
  async deleteLostItem(id: string) {
    const existing = await this.requireLostItem(id);
    if (existing.status !== 'LOST') {
      throw new ConflictException('Yalnızca kayıp bildirimi silinebilir; emanetteki eşya teslim ya da imha ile kapatılır');
    }
    await this.db.lostItem.delete({ where: { id } });
    await this.audit.record({ action: 'DELETE', entityType: 'LostItem', entityId: id, before: { itemName: existing.itemName } });
    return { id };
  }

  // ================================================================ ziyaretçiler

  /**
   * Plaka sitedeki bir araca ait mi? Araç plakaları serbest biçimde girilmiş
   * olabilir ("34 abc 123"), karşılaştırma normalize edilmiş halde yapılır.
   */
  private async vehicleMatches(plates: string[]) {
    const wanted = new Set(plates.filter(Boolean));
    if (!wanted.size) return new Map<string, { status: string | null; owner: string }>();
    const vehicles = await this.db.vehicle.findMany({
      select: { plate: true, status: true, person: { select: personSelect } },
    });
    const result = new Map<string, { status: string | null; owner: string }>();
    for (const vehicle of vehicles) {
      const plate = normalizePlate(vehicle.plate);
      if (wanted.has(plate)) {
        result.set(plate, { status: vehicle.status, owner: `${vehicle.person.firstName} ${vehicle.person.lastName}` });
      }
    }
    return result;
  }

  private visitorView(row: VisitorRow, vehicles: Map<string, { status: string | null; owner: string }>, now: Date) {
    const vehicle = row.plate ? vehicles.get(row.plate) : undefined;
    return {
      id: row.id,
      visitorName: row.visitorName,
      visitorPhone: row.visitorPhone,
      // KVKK: TC kimlik no hiçbir yanıtta açık dönmez
      nationalIdMasked: row.nationalId ? maskNationalId(row.nationalId) : null,
      plate: row.plate ? formatPlate(row.plate) : null,
      vehicle: vehicle ? { owner: vehicle.owner, status: vehicle.status } : null,
      unit: unitLabel(row.unit),
      hostPerson: personLabel(row.hostPerson),
      purpose: row.purpose,
      note: row.note,
      enteredAt: row.enteredAt,
      exitedAt: row.exitedAt,
      minutes: visitMinutes(row.enteredAt, row.exitedAt, now),
      overstay: isOverstay(row.enteredAt, row.exitedAt, now),
    };
  }

  async listVisitors(query: VisitorQuery) {
    const search = query.search?.trim();
    const plate = search ? normalizePlate(search) : '';
    const where: Prisma.VisitorLogWhereInput = {
      enteredAt: dateRange(query),
      ...(query.inside === true ? { exitedAt: null } : query.inside === false ? { exitedAt: { not: null } } : {}),
      ...(search
        ? {
            OR: [
              { visitorName: { contains: search, mode: 'insensitive' } },
              ...(plate.length >= 2 ? [{ plate: { contains: plate } }] : []),
              // TC yalnızca tam eşleşmeyle aranır — kısmi arama ile numara tahmin edilemesin
              ...(/^\d{11}$/.test(search) ? [{ nationalId: search }] : []),
              { hostPerson: { OR: [{ firstName: { contains: search, mode: 'insensitive' } }, { lastName: { contains: search, mode: 'insensitive' } }] } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.visitorLog.findMany({
        where,
        include: visitorInclude,
        orderBy: { enteredAt: query.sortDir },
        ...paginate(query),
      }),
      this.db.visitorLog.count({ where }),
    ]);
    const vehicles = await this.vehicleMatches(rows.map((r) => r.plate ?? ''));
    const now = new Date();
    return toPage(
      rows.map((row) => this.visitorView(row, vehicles, now)),
      total,
      query,
    );
  }

  /** Giriş kaydı. Plaka sitede "yasaklı" bir araca aitse kayıt yine açılır ama uyarı döner. */
  async checkIn(input: VisitorInput) {
    const now = new Date();
    const enteredAt = input.enteredAt ?? now;
    if (enteredAt.getTime() > now.getTime() + 5 * 60_000) {
      throw new BadRequestException('Giriş saati ileri bir zaman olamaz');
    }
    await this.assertReferences({ personId: input.hostPersonId, unitId: input.unitId });
    const settings = await this.db.siteSettings.findUnique({
      where: { siteId: requireSiteId() },
      select: { requireVisitorId: true },
    });
    if (settings?.requireVisitorId && !input.nationalId) {
      throw new BadRequestException('Site parametrelerine göre ziyaretçinin TC kimlik numarası zorunlu');
    }
    const plate = normalizePlate(input.plate) || null;

    const row = await this.db.visitorLog.create({
      data: {
        siteId: requireSiteId(),
        visitorName: input.visitorName,
        visitorPhone: input.visitorPhone ?? null,
        nationalId: input.nationalId || null,
        plate,
        unitId: input.unitId ?? null,
        hostPersonId: input.hostPersonId ?? null,
        purpose: input.purpose ?? null,
        note: input.note ?? null,
        enteredAt,
        createdById: currentUserId(),
      },
      include: visitorInclude,
    });
    await this.audit.record({
      action: 'CREATE',
      entityType: 'VisitorLog',
      entityId: row.id,
      // TC denetim kaydına da açık yazılmaz
      after: { visitorName: row.visitorName, plate, nationalId: row.nationalId ? maskNationalId(row.nationalId) : null },
    });
    const vehicles = await this.vehicleMatches(plate ? [plate] : []);
    const view = this.visitorView(row, vehicles, now);
    const banned = view.vehicle?.status?.toLocaleLowerCase('tr').includes('yasak') ?? false;
    return { ...view, warning: banned ? 'Bu plaka sitede yasaklı olarak kayıtlı' : null };
  }

  async checkOut(id: string, body: { exitedAt?: Date; note?: string | null }) {
    const existing = await this.db.visitorLog.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException('Ziyaret kaydı bulunamadı');
    if (existing.exitedAt) throw new ConflictException('Bu ziyaretçinin çıkışı zaten yapılmış');
    const exitedAt = body.exitedAt ?? new Date();
    if (exitedAt < existing.enteredAt) throw new BadRequestException('Çıkış saati giriş saatinden önce olamaz');
    if (exitedAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException('Çıkış saati ileri bir zaman olamaz');

    // Aynı anda iki kez "çıkış" basılırsa yalnızca biri yazılır
    const result = await this.db.visitorLog.updateMany({
      where: { id, exitedAt: null },
      data: {
        exitedAt,
        exitedById: currentUserId(),
        ...(body.note ? { note: existing.note ? `${existing.note}\n${body.note}` : body.note } : {}),
      },
    });
    if (result.count === 0) throw new ConflictException('Bu ziyaretçinin çıkışı zaten yapılmış');
    return { id, exitedAt };
  }
}
