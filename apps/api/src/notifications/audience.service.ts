import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationChannel } from '@sy/db';
import {
  OPEN_ITEM_FIELDS,
  buildMergeContext,
  extractMergeFields,
  renderTemplate,
  selectAudience,
  type AudienceInput,
  type AudiencePerson,
  type AudienceResult,
  type MergeSource,
} from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { requireSiteId } from '../tenant/tenant.context';
import { LedgerService } from '../finance/ledger.service';

export interface RenderedMessage {
  personId: string;
  fullName: string;
  recipient: string;
  subject: string | null;
  body: string;
}

export interface ResolvedAudience {
  audience: AudienceResult;
  messages: RenderedMessage[];
  /** Şablonda tanımsız değişkenler */
  unknownFields: string[];
}

/**
 * Hedef kitleyi çözer ve her alıcıya özel mesajı üretir.
 * Seçim ve birleştirme kuralları `@sy/shared/notifications` içindedir;
 * bu servis yalnızca veriyi toplar.
 */
@Injectable()
export class AudienceService {
  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly ledger: LedgerService,
    private readonly config: ConfigService,
  ) {}

  /** Sakin portalının ödeme sayfası — giriş yapan sakin borcunu kartla öder */
  private paymentLink(): string {
    const base =
      this.config.get<string>('PUBLIC_WEB_URL') ??
      (this.config.get<string>('CORS_ORIGIN') ?? 'http://localhost:3100').split(',')[0].trim();
    return `${base.replace(/\/$/, '')}/portal/odeme`;
  }

  async resolve(input: {
    channel: NotificationChannel;
    audience: AudienceInput;
    subject: string | null | undefined;
    body: string;
  }): Promise<ResolvedAudience> {
    const siteId = requireSiteId();
    const now = new Date();

    const [site, settings, bank, people] = await Promise.all([
      this.db.site.findUnique({ where: { id: siteId }, select: { name: true } }),
      this.db.siteSettings.findUnique({ where: { siteId }, select: { notificationFooter: true } }),
      this.db.account.findFirst({
        where: { type: 'BANK', isActive: true, iban: { not: null } },
        select: { iban: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.person.findMany({
        where: { isActive: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        include: {
          account: { select: { id: true } },
          occupancies: {
            where: { startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gte: now } }] },
            include: { unit: { select: { doorNumber: true, blockId: true, block: { select: { name: true } } } } },
          },
        },
      }),
    ]);
    if (!site) throw new NotFoundException('Site bulunamadı');

    const accountIds = people.map((p) => p.account?.id).filter(Boolean) as string[];
    const balances = await this.ledger.balancesOf(accountIds);

    // Açık borç evrakları pahalıdır (kişi başı sorgu) — yalnızca gerekiyorsa
    const fields = extractMergeFields(`${input.subject ?? ''}\n${input.body}`);
    const needOpenItems =
      input.audience.onlyOverdue || fields.some((f) => (OPEN_ITEM_FIELDS as readonly string[]).includes(f));

    const openItems = new Map<string, Awaited<ReturnType<LedgerService['openItems']>>>();
    if (needOpenItems) {
      for (const person of people) {
        const accountId = person.account?.id;
        // Bakiyesi sıfır/avans olan carinin açık borcu yoktur (alacaklar FIFO kapatır)
        if (accountId && (balances.get(accountId) ?? 0) > 0) {
          openItems.set(person.id, await this.ledger.openItems(accountId));
        }
      }
    }

    const audiencePeople: AudiencePerson[] = people.map((person) => {
      const balanceMinor = person.account ? (balances.get(person.account.id) ?? 0) : 0;
      const items = openItems.get(person.id) ?? [];
      return {
        personId: person.id,
        fullName: `${person.firstName} ${person.lastName}`,
        email: person.email,
        phone: person.phone,
        phone2: person.phone2,
        roles: [...new Set(person.occupancies.map((o) => o.role))],
        blockIds: person.occupancies.map((o) => o.unit.blockId).filter(Boolean) as string[],
        balanceMinor,
        overdueMinor: items
          .filter((item) => item.dueDate && item.dueDate < now)
          .reduce((acc, item) => acc + item.remainingMinor, 0),
      };
    });

    const audience = selectAudience(audiencePeople, input.audience, input.channel);

    const byId = new Map(people.map((p) => [p.id, p]));
    const footer = settings?.notificationFooter?.trim();
    const unknown = new Set<string>();

    const messages = audience.recipients.map((recipient) => {
      const person = byId.get(recipient.personId)!;
      const source: MergeSource = {
        fullName: recipient.fullName,
        siteName: site.name,
        units: person.occupancies.map((o) => ({ blockName: o.unit.block?.name ?? null, doorNumber: o.unit.doorNumber })),
        balanceMinor: person.account ? (balances.get(person.account.id) ?? 0) : 0,
        openItems: openItems.get(person.id)?.map((item) => ({
          type: item.type,
          period: item.period,
          dueDate: item.dueDate,
          remainingMinor: item.remainingMinor,
        })),
        paymentCode: person.occupancies.find((o) => o.bankPaymentCode)?.bankPaymentCode ?? null,
        iban: bank?.iban ?? null,
        paymentLink: this.paymentLink(),
        now,
      };
      const context = buildMergeContext(source);
      const subject = input.subject ? renderTemplate(input.subject, context) : null;
      const body = renderTemplate(input.body, context);
      [...(subject?.unknown ?? []), ...body.unknown].forEach((field) => unknown.add(field));

      return {
        personId: recipient.personId,
        fullName: recipient.fullName,
        recipient: recipient.recipient,
        subject: subject?.text ?? null,
        body: footer ? `${body.text}\n\n${footer}` : body.text,
      };
    });

    // Alıcı olmasa da şablondaki tanımsız alanlar raporlansın
    if (messages.length === 0) {
      renderTemplate(`${input.subject ?? ''}\n${input.body}`, buildMergeContext({
        fullName: '', siteName: site.name, units: [], balanceMinor: 0, now,
      })).unknown.forEach((field) => unknown.add(field));
    }

    return { audience, messages, unknownFields: [...unknown] };
  }
}
