import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type TicketStatus } from '@sy/db';
import {
  TICKET_STATUS_ORDER,
  isTicketOverdue,
  planBoardMove,
  fromMinor,
  toMinor,
  type TicketCommentInput,
  type TicketExpenseInput,
  type TicketInput,
} from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { currentUserId, getTenantContext, requireSiteId } from '../tenant/tenant.context';
import { TransactionsService } from '../finance/transactions.service';
import { decimal, toMinorDecimal } from '../finance/ledger.service';
import { orderBy, paginate, toPage } from '../common/pagination';

export interface BoardFilter {
  search?: string;
  departmentId?: string;
  assigneeId?: string;
  requestType?: string;
  priority?: string;
  /** Yalnızca bana atananlar */
  mine?: boolean;
}

type ListQuery = BoardFilter & {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortDir: 'asc' | 'desc';
  status?: TicketStatus;
};

/** Tamamlanan kolonda gösterilen geçmiş (gün) — kolon sonsuz uzamasın */
const COMPLETED_WINDOW_DAYS = 30;

/** Talep atanabilecek roller */
const ASSIGNABLE_ROLES = ['SITE_ADMIN', 'TECHNICIAN', 'SECURITY', 'ACCOUNTANT'] as const;

const cardSelect = {
  id: true,
  number: true,
  subject: true,
  status: true,
  requestType: true,
  priority: true,
  channel: true,
  date: true,
  dueDate: true,
  completedAt: true,
  boardOrder: true,
  area: true,
  person: { select: { id: true, firstName: true, lastName: true } },
  unit: { select: { id: true, doorNumber: true, block: { select: { name: true } } } },
  assignee: { select: { id: true, fullName: true } },
  department: { select: { id: true, name: true } },
  _count: { select: { comments: true, expenses: true } },
} satisfies Prisma.TicketSelect;

type CardRow = Prisma.TicketGetPayload<{ select: typeof cardSelect }>;

function unitLabel(unit: { doorNumber: string; block: { name: string } | null } | null) {
  if (!unit) return null;
  return unit.block ? `${unit.block.name} / ${unit.doorNumber}` : unit.doorNumber;
}

function toCard(row: CardRow) {
  return {
    id: row.id,
    number: row.number,
    subject: row.subject,
    status: row.status,
    requestType: row.requestType,
    priority: row.priority,
    channel: row.channel,
    date: row.date,
    dueDate: row.dueDate,
    completedAt: row.completedAt,
    boardOrder: row.boardOrder,
    area: row.area,
    overdue: isTicketOverdue(row),
    person: row.person
      ? { id: row.person.id, fullName: `${row.person.firstName} ${row.person.lastName}` }
      : null,
    unit: row.unit ? { id: row.unit.id, label: unitLabel(row.unit) } : null,
    assignee: row.assignee,
    department: row.department,
    commentCount: row._count.comments,
    expenseCount: row._count.expenses,
  };
}

/**
 * İş takibi (talep / Kanban).
 *
 * `TicketComment`, `TicketExpense`, `TicketSurveyResponse` tabloları `siteId`
 * taşımaz; Prisma eklentisi onları filtreleyemez. Bu yüzden bu tablolara
 * **her erişim önce talebi tenant filtreli sorguyla doğrular** (`requireTicket`)
 * ya da `ticket: { siteId }` koşuluyla yapılır.
 */
@Injectable()
export class TicketsService {
  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly transactions: TransactionsService,
  ) {}

  // ------------------------------------------------------------------ okuma

  private where(filter: BoardFilter): Prisma.TicketWhereInput {
    const search = filter.search?.trim();
    const number = search && /^#?\d+$/.test(search) ? Number(search.replace('#', '')) : null;

    return {
      ...(filter.departmentId ? { departmentId: filter.departmentId } : {}),
      ...(filter.assigneeId === 'none'
        ? { assigneeId: null }
        : filter.assigneeId
          ? { assigneeId: filter.assigneeId }
          : {}),
      ...(filter.mine ? { assigneeId: currentUserId() ?? '__yok__' } : {}),
      ...(filter.requestType ? { requestType: filter.requestType as never } : {}),
      ...(filter.priority ? { priority: filter.priority as never } : {}),
      ...(search
        ? {
            OR: [
              ...(number !== null ? [{ number }] : []),
              { subject: { contains: search, mode: 'insensitive' as const } },
              { description: { contains: search, mode: 'insensitive' as const } },
              { area: { contains: search, mode: 'insensitive' as const } },
              { person: { lastName: { contains: search, mode: 'insensitive' as const } } },
              { person: { firstName: { contains: search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
  }

  /** Kanban panosu: 8 kolon, her kolon `boardOrder` sırasıyla */
  async board(filter: BoardFilter) {
    const since = new Date(Date.now() - COMPLETED_WINDOW_DAYS * 86_400_000);
    const rows = await this.db.ticket.findMany({
      where: {
        AND: [
          this.where(filter),
          // Eski tamamlananlar panoyu doldurmasın; liste görünümünde duruyorlar.
          // NOT(...) yazılmaz: completedAt NULL iken SQL'de NULL döner ve satır elenir.
          {
            OR: [
              { status: { not: 'COMPLETED' } },
              { completedAt: null },
              { completedAt: { gte: since } },
            ],
          },
        ],
      },
      select: cardSelect,
      orderBy: [{ boardOrder: 'asc' }, { number: 'desc' }],
    });

    const columns = TICKET_STATUS_ORDER.map((status) => ({
      status,
      cards: rows.filter((row) => row.status === status).map(toCard),
    }));

    return {
      columns,
      total: rows.length,
      overdue: rows.filter((row) => isTicketOverdue(row)).length,
      completedWindowDays: COMPLETED_WINDOW_DAYS,
    };
  }

  async list(query: ListQuery) {
    const where = {
      ...this.where(query),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.db.ticket.findMany({
        where,
        ...paginate(query),
        select: cardSelect,
        orderBy: orderBy(query, ['number', 'date', 'dueDate', 'priority', 'status'], {
          number: 'desc',
        }),
      }),
      this.db.ticket.count({ where }),
    ]);
    return toPage(items.map(toCard), total, query);
  }

  async get(id: string) {
    const siteId = requireSiteId();
    const ticket = await this.db.ticket.findUnique({
      where: { id },
      include: {
        person: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        unit: { select: { id: true, doorNumber: true, block: { select: { name: true } } } },
        assignee: { select: { id: true, fullName: true } },
        department: { select: { id: true, name: true } },
        comments: { orderBy: { createdAt: 'asc' } },
        attachments: { orderBy: { createdAt: 'asc' } },
        expenses: { orderBy: { createdAt: 'asc' } },
        survey: true,
        documents: {
          select: { id: true, number: true, type: true, status: true, date: true, totalAmount: true },
          orderBy: { date: 'asc' },
        },
      },
    });
    if (!ticket) throw new NotFoundException('Talep bulunamadı');

    // Yorum yazarları ve işlem geçmişi — User/AuditLog global tablolardır
    const authorIds = [...new Set(ticket.comments.map((c) => c.authorId).filter(Boolean))] as string[];
    const [authors, history] = await Promise.all([
      this.db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, fullName: true } }),
      this.db.auditLog.findMany({
        where: { siteId, entityType: 'Ticket', entityId: id },
        select: { id: true, action: true, after: true, createdAt: true, user: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);
    const authorName = new Map(authors.map((a) => [a.id, a.fullName]));
    const documentStatus = new Map(ticket.documents.map((d) => [d.id, d]));

    const { documents, ...rest } = ticket;
    return {
      ...rest,
      overdue: isTicketOverdue(ticket),
      person: ticket.person
        ? { ...ticket.person, fullName: `${ticket.person.firstName} ${ticket.person.lastName}` }
        : null,
      unit: ticket.unit ? { id: ticket.unit.id, label: unitLabel(ticket.unit) } : null,
      comments: ticket.comments.map((c) => ({
        ...c,
        authorName: c.authorId ? (authorName.get(c.authorId) ?? 'Silinmiş kullanıcı') : 'Sistem',
      })),
      expenses: ticket.expenses.map((e) => {
        const document = e.documentId ? documentStatus.get(e.documentId) : undefined;
        return {
          id: e.id,
          description: e.description,
          amountMinor: toMinorDecimal(e.amount),
          createdAt: e.createdAt,
          document: document
            ? { id: document.id, number: document.number, status: document.status }
            : null,
        };
      }),
      expenseTotalMinor: ticket.expenses.reduce((acc, e) => acc + toMinorDecimal(e.amount), 0),
      documents: documents.map((d) => ({
        id: d.id,
        number: d.number,
        type: d.type,
        status: d.status,
        date: d.date,
        totalMinor: toMinorDecimal(d.totalAmount),
      })),
      history,
    };
  }

  /** Form seçenekleri: departmanlar ve atanabilir personel */
  async meta() {
    const siteId = requireSiteId();
    const [departments, memberships] = await Promise.all([
      this.db.department.findMany({ orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
      this.db.siteMembership.findMany({
        where: { siteId, isActive: true, role: { in: [...ASSIGNABLE_ROLES] }, user: { isActive: true } },
        select: { role: true, user: { select: { id: true, fullName: true } } },
        orderBy: { user: { fullName: 'asc' } },
      }),
    ]);
    return {
      departments,
      assignees: memberships.map((m) => ({ id: m.user.id, fullName: m.user.fullName, role: m.role })),
    };
  }

  // ----------------------------------------------------------------- yazma

  async create(input: TicketInput) {
    const siteId = requireSiteId();
    await this.assertReferences(input);

    // Talep numarası site içinde artan; eşzamanlı oluşturmada unique çakışırsa yeniden dene
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(async (tx) => {
          const [last, lastInColumn] = await Promise.all([
            tx.ticket.findFirst({ orderBy: { number: 'desc' }, select: { number: true } }),
            tx.ticket.findFirst({
              where: { status: 'WAITING' },
              orderBy: { boardOrder: 'desc' },
              select: { boardOrder: true },
            }),
          ]);
          return tx.ticket.create({
            data: {
              siteId,
              number: (last?.number ?? 0) + 1,
              boardOrder: (lastInColumn?.boardOrder ?? -1) + 1,
              createdById: currentUserId(),
              ...this.fields(input),
            },
          });
        });
      } catch (error) {
        const isConflict =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!isConflict || attempt === 2) throw error;
      }
    }
    throw new ConflictException('Talep numarası üretilemedi, tekrar deneyin');
  }

  async update(id: string, input: TicketInput) {
    await this.requireTicket(id);
    await this.assertReferences(input);
    return this.db.ticket.update({ where: { id }, data: this.fields(input) });
  }

  /**
   * Kartı kolonlar arasında / kolon içinde taşır.
   * Tamamlandı kolonuna giren talebin `completedAt`'i işlenir, çıkanınki silinir.
   */
  async move(id: string, status: TicketStatus, index: number) {
    const ticket = await this.requireTicket(id);

    return this.db.$transaction(async (tx) => {
      const column = await tx.ticket.findMany({
        where: { status },
        select: { id: true, boardOrder: true },
        orderBy: [{ boardOrder: 'asc' }, { number: 'desc' }],
      });
      const updates = planBoardMove(column, id, index);

      for (const update of updates) {
        if (update.id === id) continue;
        await tx.ticket.update({ where: { id: update.id }, data: { boardOrder: update.boardOrder } });
      }

      const moved = updates.find((u) => u.id === id)!;
      const completedAt =
        status === 'COMPLETED'
          ? (ticket.status === 'COMPLETED' ? ticket.completedAt : null) ?? new Date()
          : null;

      return tx.ticket.update({
        where: { id },
        data: { status, boardOrder: moved.boardOrder, completedAt },
        select: { id: true, status: true, boardOrder: true, completedAt: true },
      });
    });
  }

  /** Gider evrakına bağlanmış masrafı olan talep silinemez (önce evrak iptal edilmeli) */
  async remove(id: string) {
    await this.requireTicket(id);
    const postedDocuments = await this.db.document.count({
      where: { ticketId: id, status: { not: 'CANCELLED' } },
    });
    if (postedDocuments > 0) {
      throw new ConflictException(
        'Bu talebe bağlı işlenmiş gider evrakı var. Önce evrakı iptal edin.',
      );
    }
    await this.db.ticket.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ---------------------------------------------------------------- yorum

  async addComment(ticketId: string, input: TicketCommentInput) {
    await this.requireTicket(ticketId);
    return this.db.ticketComment.create({
      data: { ticketId, authorId: currentUserId(), body: input.body, isPublic: input.isPublic },
    });
  }

  /** Yorumu yalnızca yazarı ya da site yöneticisi silebilir */
  async removeComment(commentId: string) {
    const comment = await this.db.ticketComment.findFirst({
      where: { id: commentId, ticket: { siteId: requireSiteId() } },
    });
    if (!comment) throw new NotFoundException('Yorum bulunamadı');

    const ctx = getTenantContext();
    const canDelete =
      ctx?.isSuperAdmin || ctx?.role === 'SITE_ADMIN' || comment.authorId === ctx?.userId;
    if (!canDelete) throw new ForbiddenException('Yalnızca kendi yorumunuzu silebilirsiniz');

    await this.db.ticketComment.delete({ where: { id: commentId } });
    return { id: commentId, deleted: true };
  }

  // --------------------------------------------------------------- masraf

  /**
   * Talebe masraf ekler. `invoice` verilirse aynı anda gider faturası
   * (EXPENSE evrakı) kesilir ve masrafa bağlanır.
   */
  async addExpense(ticketId: string, input: TicketExpenseInput) {
    const ticket = await this.requireTicket(ticketId);
    const amountMinor = toMinor(input.amount);
    if (amountMinor <= 0) throw new BadRequestException('Masraf tutarı sıfırdan büyük olmalı');

    const document = input.invoice
      ? await this.transactions.expense({
          ...input.invoice,
          amount: input.amount,
          description: `Talep #${ticket.number}: ${input.description}`,
          ticketId,
        })
      : null;

    return this.db.ticketExpense.create({
      data: {
        ticketId,
        description: input.description,
        amount: decimal(amountMinor),
        documentId: document?.id ?? null,
      },
    });
  }

  /** Daha önce faturasız girilmiş masrafı gider evrakına dönüştürür */
  async convertExpense(
    expenseId: string,
    invoice: NonNullable<TicketExpenseInput['invoice']>,
  ) {
    const expense = await this.requireExpense(expenseId);
    if (expense.documentId) {
      const document = await this.db.document.findUnique({
        where: { id: expense.documentId },
        select: { status: true },
      });
      if (document && document.status !== 'CANCELLED') {
        throw new ConflictException('Bu masraf zaten gider evrakına dönüştürülmüş');
      }
    }

    const document = await this.transactions.expense({
      ...invoice,
      amount: fromMinor(toMinorDecimal(expense.amount)),
      description: `Talep #${expense.ticket.number}: ${expense.description}`,
      ticketId: expense.ticketId,
    });

    return this.db.ticketExpense.update({
      where: { id: expenseId },
      data: { documentId: document.id },
    });
  }

  async removeExpense(expenseId: string) {
    const expense = await this.requireExpense(expenseId);
    if (expense.documentId) {
      const document = await this.db.document.findUnique({
        where: { id: expense.documentId },
        select: { status: true },
      });
      if (document && document.status !== 'CANCELLED') {
        throw new ConflictException('Masraf gider evrakına bağlı. Önce evrakı iptal edin.');
      }
    }
    await this.db.ticketExpense.delete({ where: { id: expenseId } });
    return { id: expenseId, deleted: true };
  }

  // ---------------------------------------------------------------- anket

  async saveSurvey(ticketId: string, input: { rating: number; comment?: string }) {
    const ticket = await this.requireTicket(ticketId);
    if (ticket.status !== 'COMPLETED') {
      throw new BadRequestException('Memnuniyet anketi yalnızca tamamlanan talep için girilir');
    }
    return this.db.ticketSurveyResponse.upsert({
      where: { ticketId },
      create: { ticketId, rating: input.rating, comment: input.comment },
      update: { rating: input.rating, comment: input.comment, answeredAt: new Date() },
    });
  }

  // ------------------------------------------------------------- departman

  async saveDepartment(id: string | null, input: { name: string; order: number; isActive: boolean }) {
    const siteId = requireSiteId();
    if (id) {
      const existing = await this.db.department.findUnique({ where: { id }, select: { id: true } });
      if (!existing) throw new NotFoundException('Departman bulunamadı');
      return this.db.department.update({ where: { id }, data: input });
    }
    return this.db.department.create({ data: { siteId, ...input } });
  }

  // --------------------------------------------------------------- yardımcı

  private fields(input: TicketInput) {
    return {
      subject: input.subject,
      description: input.description,
      requestType: input.requestType,
      priority: input.priority,
      channel: input.channel,
      personId: input.personId ?? null,
      unitId: input.unitId ?? null,
      departmentId: input.departmentId ?? null,
      assigneeId: input.assigneeId ?? null,
      area: input.area?.trim() || null,
      dueDate: input.dueDate ?? null,
    };
  }

  /** Tenant filtreli okuma: başka sitenin talebi "bulunamadı" olur */
  private async requireTicket(id: string) {
    const ticket = await this.db.ticket.findUnique({
      where: { id },
      select: { id: true, number: true, status: true, completedAt: true },
    });
    if (!ticket) throw new NotFoundException('Talep bulunamadı');
    return ticket;
  }

  private async requireExpense(id: string) {
    const expense = await this.db.ticketExpense.findFirst({
      where: { id, ticket: { siteId: requireSiteId() } },
      include: { ticket: { select: { number: true } } },
    });
    if (!expense) throw new NotFoundException('Masraf bulunamadı');
    return expense;
  }

  /**
   * İlişkilendirilen kişi/daire/departman bu siteye ait mi, atanan kullanıcı
   * bu sitede personel mi? Kimlikler istemciden geldiği için doğrulanmadan
   * yazılırsa başka sitenin kaydına bağlantı kurulabilir.
   */
  private async assertReferences(input: TicketInput) {
    const siteId = requireSiteId();
    const [person, unit, department, membership] = await Promise.all([
      input.personId
        ? this.db.person.findUnique({ where: { id: input.personId }, select: { id: true } })
        : true,
      input.unitId
        ? this.db.unit.findUnique({ where: { id: input.unitId }, select: { id: true } })
        : true,
      input.departmentId
        ? this.db.department.findUnique({ where: { id: input.departmentId }, select: { id: true } })
        : true,
      input.assigneeId
        ? this.db.siteMembership.findFirst({
            where: {
              siteId,
              userId: input.assigneeId,
              isActive: true,
              role: { in: [...ASSIGNABLE_ROLES] },
            },
            select: { id: true },
          })
        : true,
    ]);

    if (!person) throw new BadRequestException('Seçilen kişi bulunamadı');
    if (!unit) throw new BadRequestException('Seçilen daire bulunamadı');
    if (!department) throw new BadRequestException('Seçilen departman bulunamadı');
    if (!membership) throw new BadRequestException('Talep bu sitenin personeline atanabilir');
  }
}
