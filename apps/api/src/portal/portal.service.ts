import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  cardDigits,
  fromMinor,
  maskCard,
  toMinor,
  type PortalPaymentInput,
  type PortalTicketInput,
} from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { currentUserId, requirePersonId, requireSiteId } from '../tenant/tenant.context';
import { LedgerService } from '../finance/ledger.service';
import { TransactionsService } from '../finance/transactions.service';
import { TicketsService } from '../tickets/tickets.service';
import { paginate, toPage } from '../common/pagination';

function unitLabel(unit: { doorNumber: string; block: { name: string } | null }) {
  return unit.block ? `${unit.block.name} / ${unit.doorNumber}` : unit.doorNumber;
}

/**
 * İKAMET EDEN PORTALI
 *
 * ÇOK KİRACILILIĞIN İÇİNDE İKİNCİ BİR SINIR: site filtresi Prisma eklentisinden
 * gelir, ama aynı sitedeki başka bir ikamet edenin verisi de görülmemelidir. Bu
 * yüzden buradaki **her** sorgu `requirePersonId()` ile oturumun kişisine
 * daraltılır. İstemciden kişi/cari kimliği alınmaz; daire kimliği alınırsa
 * kişinin kendi daireleri arasında olduğu doğrulanır.
 */
@Injectable()
export class PortalService {
  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly ledger: LedgerService,
    private readonly transactions: TransactionsService,
    private readonly tickets: TicketsService,
  ) {}

  // ------------------------------------------------------------------- özet

  async summary() {
    const personId = requirePersonId();
    const now = new Date();
    const [person, account, units, announcements, openTickets, ticketCount, messages, paymentAccount] =
      await Promise.all([
        this.db.person.findUnique({
          where: { id: personId },
          select: { id: true, firstName: true, lastName: true, email: true, phone: true },
        }),
        this.account(),
        this.units(),
        this.activeAnnouncements(5),
        this.db.ticket.findMany({
          where: { personId, status: { not: 'COMPLETED' } },
          select: { id: true, number: true, subject: true, status: true, date: true },
          orderBy: { date: 'desc' },
          take: 5,
        }),
        this.db.ticket.count({ where: { personId, status: { not: 'COMPLETED' } } }),
        this.db.notificationMessage.findMany({
          where: { personId },
          select: { id: true, channel: true, subject: true, body: true, sentAt: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        this.paymentAccount(),
      ]);
    if (!person) throw new NotFoundException('Kişi kaydınız bulunamadı');

    const [balance, openItems] = account
      ? await Promise.all([this.ledger.balanceOf(account.id), this.ledger.openItems(account.id)])
      : [null, []];

    return {
      person: { ...person, fullName: `${person.firstName} ${person.lastName}` },
      units,
      balanceMinor: balance?.balanceMinor ?? 0,
      openItems: openItems.map((item) => ({
        ...item,
        overdue: !!item.dueDate && item.dueDate < now,
      })),
      announcements,
      openTickets,
      openTicketCount: ticketCount,
      messages,
      onlinePayment: !!account && !!paymentAccount,
    };
  }

  async statement(from: Date, to: Date) {
    const account = await this.account();
    if (!account) throw new NotFoundException('Cari hesabınız bulunamadı');
    return this.ledger.statement(account.id, from, to);
  }

  /** PDF için ekstre — ikamet edenin kendi verisi, maskesiz */
  async statementReport(from: Date, to: Date) {
    const personId = requirePersonId();
    const [statement, person, units, site] = await Promise.all([
      this.statement(from, to),
      this.db.person.findUnique({ where: { id: personId }, select: { firstName: true, lastName: true, phone: true } }),
      this.units(),
      // Site global tablodur (tenant filtresi yok): kimlikle sorgulanmalı
      this.db.site.findUnique({ where: { id: requireSiteId() }, select: { name: true, city: true, district: true } }),
    ]);
    return {
      site: site ?? { name: '', city: null, district: null },
      from,
      to,
      masked: false,
      accounts: [
        {
          name: person ? `${person.firstName} ${person.lastName}` : '',
          units: units.map((u) => u.label),
          phone: person?.phone ?? null,
          ...statement,
          lines: statement.lines.map((line) => ({ ...line, description: line.description ?? '' })),
        },
      ],
    };
  }

  // ---------------------------------------------------------------- duyuru

  announcements() {
    return this.activeAnnouncements(100);
  }

  private activeAnnouncements(take: number) {
    const now = new Date();
    return this.db.announcement.findMany({
      where: { isActive: true, publishAt: { lte: now }, OR: [{ expireAt: null }, { expireAt: { gt: now } }] },
      select: { id: true, title: true, body: true, publishAt: true, isPinned: true },
      orderBy: [{ isPinned: 'desc' }, { publishAt: 'desc' }],
      take,
    });
  }

  // ---------------------------------------------------------------- mesaj

  async messages(query: { page: number; pageSize: number }) {
    const where = { personId: requirePersonId() };
    const [items, total] = await Promise.all([
      this.db.notificationMessage.findMany({
        where,
        ...paginate(query as never),
        select: { id: true, channel: true, subject: true, body: true, status: true, sentAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.notificationMessage.count({ where }),
    ]);
    return toPage(items, total, query as never);
  }

  // ---------------------------------------------------------------- talep

  myTickets() {
    return this.db.ticket.findMany({
      where: { personId: requirePersonId() },
      select: {
        id: true,
        number: true,
        subject: true,
        status: true,
        requestType: true,
        date: true,
        completedAt: true,
        unit: { select: { doorNumber: true, block: { select: { name: true } } } },
        survey: { select: { rating: true } },
        _count: { select: { comments: { where: { isPublic: true } } } },
      },
      orderBy: { date: 'desc' },
    });
  }

  /** İkamet eden yalnızca herkese açık yorumları görür; iç notlar, masraflar ve geçmiş gizlidir */
  async ticket(id: string) {
    const ticket = await this.db.ticket.findFirst({
      where: { id, personId: requirePersonId() },
      select: {
        id: true,
        number: true,
        subject: true,
        description: true,
        status: true,
        requestType: true,
        area: true,
        date: true,
        completedAt: true,
        unit: { select: { doorNumber: true, block: { select: { name: true } } } },
        comments: {
          where: { isPublic: true },
          select: { id: true, body: true, authorId: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
        survey: { select: { rating: true, comment: true, answeredAt: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Talep bulunamadı');

    const userId = currentUserId();
    return {
      ...ticket,
      unit: ticket.unit ? unitLabel(ticket.unit) : null,
      comments: ticket.comments.map(({ authorId, ...comment }) => ({
        ...comment,
        // Personelin adı ikamet edene gösterilmez
        author: authorId === userId ? 'Siz' : 'Yönetim',
        mine: authorId === userId,
      })),
    };
  }

  async createTicket(input: PortalTicketInput) {
    const personId = requirePersonId();
    if (input.unitId) {
      const units = await this.units();
      if (!units.some((u) => u.id === input.unitId)) {
        throw new BadRequestException('Talep yalnızca kendi daireniz için açılabilir');
      }
    }
    return this.tickets.create({
      subject: input.subject,
      description: input.description,
      requestType: input.requestType,
      priority: 'NORMAL',
      channel: 'PORTAL',
      personId,
      unitId: input.unitId ?? null,
      departmentId: null,
      assigneeId: null,
      area: input.area,
      dueDate: null,
    });
  }

  async comment(ticketId: string, body: string) {
    await this.requireOwnTicket(ticketId);
    return this.tickets.addComment(ticketId, { body, isPublic: true });
  }

  async survey(ticketId: string, input: { rating: number; comment?: string }) {
    await this.requireOwnTicket(ticketId);
    return this.tickets.saveSurvey(ticketId, input);
  }

  // ---------------------------------------------------------------- ödeme

  /**
   * Çevrimiçi ödeme (mock sağlayıcı). Başarılıysa ikamet edenin carisine tahsilat
   * makbuzu kesilir; FIFO kapatma en eski borçtan başlar. Kart verisi
   * saklanmaz — evrak açıklamasında yalnızca son 4 hane bulunur.
   *
   * Mock: "0002" ile biten kart bankaca reddedilir.
   */
  async pay(input: PortalPaymentInput) {
    const account = await this.account();
    const paymentAccount = await this.paymentAccount();
    if (!account || !paymentAccount) {
      throw new BadRequestException('Çevrimiçi ödeme bu site için henüz açık değil');
    }

    const amountMinor = toMinor(input.amount);
    if (amountMinor <= 0) throw new BadRequestException('Ödeme tutarı sıfırdan büyük olmalı');
    const { balanceMinor } = await this.ledger.balanceOf(account.id);
    if (balanceMinor <= 0) throw new BadRequestException('Ödenecek borcunuz bulunmuyor');
    if (amountMinor > balanceMinor) {
      throw new BadRequestException('Ödeme tutarı güncel borcunuzdan fazla olamaz');
    }

    if (cardDigits(input.card.number).endsWith('0002')) {
      throw new HttpException('Kartınız bankanız tarafından reddedildi', HttpStatus.PAYMENT_REQUIRED);
    }

    const masked = maskCard(input.card.number);
    const document = await this.transactions.collect({
      accountId: account.id,
      cashAccountId: paymentAccount.id,
      amount: fromMinor(amountMinor),
      date: new Date(),
      description: `Online ödeme — kart ${masked}`,
      channel: 'CARD',
    });

    return {
      documentId: document.id,
      documentNumber: document.number,
      amountMinor,
      card: masked,
      balanceMinor: balanceMinor - amountMinor,
    };
  }

  // -------------------------------------------------------------- yardımcı

  private account() {
    return this.db.account.findFirst({
      where: { personId: requirePersonId(), type: 'PERSON', isActive: true },
      select: { id: true },
    });
  }

  /** Çevrimiçi tahsilatların düştüğü hesap: sitenin ilk aktif banka hesabı */
  private paymentAccount() {
    return this.db.account.findFirst({
      where: { type: 'BANK', isActive: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Kişinin bugün geçerli daireleri */
  private async units() {
    const now = new Date();
    const occupancies = await this.db.unitOccupancy.findMany({
      where: {
        personId: requirePersonId(),
        startDate: { lte: now },
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
      select: {
        role: true,
        unit: { select: { id: true, doorNumber: true, block: { select: { name: true } } } },
      },
    });
    return occupancies.map((o) => ({ id: o.unit.id, label: unitLabel(o.unit), role: o.role }));
  }

  private async requireOwnTicket(id: string) {
    const ticket = await this.db.ticket.findFirst({
      where: { id, personId: requirePersonId() },
      select: { id: true },
    });
    if (!ticket) throw new NotFoundException('Talep bulunamadı');
  }
}
