import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import type { Job } from 'bullmq';
import type { MessageStatus, NotificationChannel, Prisma } from '@sy/db';
import {
  SUPPORTED_CHANNELS,
  audienceSchema,
  smsInfo,
  validateMergeFields,
  type CampaignInput,
  type CampaignPreviewInput,
  type NotificationTemplateInput,
} from '@sy/shared';
import { PRISMA, type ExtendedPrismaClient } from '../prisma/prisma.client';
import { currentUserId, requireSiteId, runWithTenant } from '../tenant/tenant.context';
import { orderBy, paginate, toPage } from '../common/pagination';
import { AudienceService } from './audience.service';
import { NotificationQueue, SEND_ATTEMPTS, type NotificationJob } from './notification.queue';
import { ProviderError, ProviderRegistry } from './providers';

const PHONE_CHANNELS: NotificationChannel[] = ['SMS', 'WHATSAPP', 'VOICE'];

const CHANNEL_NAMES: Record<NotificationChannel, string> = {
  EMAIL: 'E-posta',
  SMS: 'SMS',
  PUSH: 'Mobil bildirim',
  WHATSAPP: 'WhatsApp',
  VOICE: 'Sesli mesaj',
  POST: 'Posta',
};

/**
 * BİLDİRİM MOTORU
 *
 * Kampanya yaşam döngüsü:
 *   DRAFT ──send──▶ RUNNING ──(tüm mesajlar bitti)──▶ COMPLETED
 *     │               │                                  │
 *     └─send(ileri)─▶ SCHEDULED ──(zamanı gelince)──▶ RUNNING
 *   DRAFT/SCHEDULED/RUNNING ──cancel──▶ CANCELLED
 *   COMPLETED ──retry (başarısızlar)──▶ RUNNING
 *
 * Hedef kitle **gönderim anında** çözülür: zamanlanmış "borçlulara hatırlatma"
 * o an borçlu olanlara gider. Her mesaj ayrı satırdır (`NotificationMessage`)
 * ve kişi kartındaki "İletişim Geçmişi"ni besler.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger('Notifications');

  constructor(
    @Inject(PRISMA) private readonly db: ExtendedPrismaClient,
    private readonly audience: AudienceService,
    private readonly queue: NotificationQueue,
    private readonly providers: ProviderRegistry,
  ) {}

  onModuleInit() {
    this.queue.setHandler((job) => this.handle(job));
  }

  // ---------------------------------------------------------------- şablonlar

  listTemplates() {
    return this.db.notificationTemplate.findMany({
      orderBy: [{ channel: 'asc' }, { language: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { campaigns: true } } },
    });
  }

  async saveTemplate(id: string | null, input: NotificationTemplateInput) {
    const unknown = validateMergeFields(`${input.subject ?? ''}\n${input.body}`);
    if (unknown.length > 0) {
      throw new BadRequestException(`Tanımsız birleştirme alanı: ${unknown.map((f) => `{{${f}}}`).join(', ')}`);
    }
    if (input.channel === 'EMAIL' && !input.subject?.trim()) {
      throw new BadRequestException('E-posta şablonu için konu zorunlu');
    }
    const data = { ...input, subject: input.subject?.trim() || null };
    if (id) {
      await this.requireTemplate(id);
      return this.db.notificationTemplate.update({ where: { id }, data });
    }
    return this.db.notificationTemplate.create({ data: { siteId: requireSiteId(), ...data } });
  }

  async removeTemplate(id: string) {
    await this.requireTemplate(id);
    // Kampanyalar metnin kopyasını taşır; şablon silinince bağlantı boşalır (SetNull)
    await this.db.notificationTemplate.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ---------------------------------------------------------------- önizleme

  async preview(input: CampaignPreviewInput) {
    this.assertChannel(input.channel);
    const resolved = await this.audience.resolve({
      channel: input.channel,
      audience: input.audience,
      subject: input.subject,
      body: input.body,
    });

    const reasons = new Map<string, number>();
    for (const item of resolved.audience.excluded) reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1);

    const warnings: string[] = [];
    if (resolved.unknownFields.length > 0) {
      warnings.push(`Tanımsız alanlar boş gönderilir: ${resolved.unknownFields.map((f) => `{{${f}}}`).join(', ')}`);
    }

    let sms: null | { encoding: string; maxSegments: number; totalSegments: number; nonGsmChars: string[] } = null;
    if (PHONE_CHANNELS.includes(input.channel) && input.channel !== 'VOICE') {
      const infos = resolved.messages.map((m) => smsInfo(m.body));
      const template = smsInfo(input.body);
      sms = {
        encoding: infos.some((i) => i.encoding === 'UCS2') || template.encoding === 'UCS2' ? 'UCS2' : 'GSM7',
        maxSegments: Math.max(template.segments, ...infos.map((i) => i.segments)),
        totalSegments: infos.reduce((acc, i) => acc + i.segments, 0),
        nonGsmChars: [...new Set([...template.nonGsmChars, ...infos.flatMap((i) => i.nonGsmChars)])],
      };
    }

    return {
      matchedCount: resolved.audience.matchedCount,
      recipientCount: resolved.messages.length,
      excludedCount: resolved.audience.excluded.length,
      exclusions: [...reasons.entries()].map(([reason, count]) => ({ reason, count })),
      excludedSample: resolved.audience.excluded.slice(0, 20),
      samples: resolved.messages.slice(0, 3),
      unknownFields: resolved.unknownFields,
      warnings,
      sms,
    };
  }

  // --------------------------------------------------------------- kampanyalar

  async listCampaigns(query: { page: number; pageSize: number; sortBy?: string; sortDir: 'asc' | 'desc' }) {
    const [items, total] = await Promise.all([
      this.db.notificationCampaign.findMany({
        ...paginate(query),
        orderBy: orderBy(query, ['createdAt', 'name', 'status'], { createdAt: 'desc' }),
        include: { template: { select: { id: true, name: true } } },
      }),
      this.db.notificationCampaign.count(),
    ]);
    return toPage(items, total, query);
  }

  async getCampaign(id: string) {
    const campaign = await this.db.notificationCampaign.findUnique({
      where: { id },
      include: { template: { select: { id: true, name: true } } },
    });
    if (!campaign) throw new NotFoundException('Kampanya bulunamadı');

    const grouped = await this.db.notificationMessage.groupBy({
      by: ['status'],
      where: { campaignId: id },
      _count: true,
    });
    const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count])) as Partial<Record<MessageStatus, number>>;
    return { ...campaign, counts };
  }

  async listMessages(campaignId: string, query: { page: number; pageSize: number; status?: MessageStatus; search?: string }) {
    await this.requireCampaign(campaignId);
    const where: Prisma.NotificationMessageWhereInput = {
      campaignId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { recipient: { contains: query.search, mode: 'insensitive' } },
              { person: { lastName: { contains: query.search, mode: 'insensitive' } } },
              { person: { firstName: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.notificationMessage.findMany({
        where,
        ...paginate(query as never),
        orderBy: { createdAt: 'asc' },
        include: { person: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.db.notificationMessage.count({ where }),
    ]);
    return toPage(items, total, query as never);
  }

  async createCampaign(input: CampaignInput) {
    this.assertChannel(input.channel);
    await this.assertTemplate(input.templateId);
    return this.db.notificationCampaign.create({
      data: {
        siteId: requireSiteId(),
        createdById: currentUserId(),
        ...this.campaignData(input),
      },
    });
  }

  async updateCampaign(id: string, input: CampaignInput) {
    const campaign = await this.requireCampaign(id);
    if (campaign.status !== 'DRAFT') throw new ConflictException('Yalnızca taslak kampanya düzenlenebilir');
    this.assertChannel(input.channel);
    await this.assertTemplate(input.templateId);
    return this.db.notificationCampaign.update({ where: { id }, data: this.campaignData(input) });
  }

  /**
   * Gönder: `scheduledAt` ileri bir tarihse kampanya zamanlanır, değilse hemen
   * başlatılır. Mesajlar oluşturulup kuyruğa alınır; gönderim arka planda.
   */
  async send(id: string, scheduledAt?: Date | null) {
    const campaign = await this.requireCampaign(id);
    if (campaign.status !== 'DRAFT') throw new ConflictException('Yalnızca taslak kampanya gönderilebilir');

    if (scheduledAt && scheduledAt.getTime() > Date.now() + 30_000) {
      await this.db.notificationCampaign.update({ where: { id }, data: { status: 'SCHEDULED', scheduledAt } });
      await this.queue.scheduleCampaign(campaign.siteId, id, scheduledAt);
      return { id, status: 'SCHEDULED' as const, scheduledAt };
    }
    return this.start(id);
  }

  async cancel(id: string) {
    const campaign = await this.requireCampaign(id);
    if (!['DRAFT', 'SCHEDULED', 'RUNNING'].includes(campaign.status)) {
      throw new ConflictException('Bu kampanya iptal edilemez');
    }
    await this.queue.unscheduleCampaign(id);

    // Henüz gönderilmemiş mesajlar başarısız sayılır; işleyici onları atlar
    const result = await this.db.$transaction(async (tx) => {
      const dropped = await tx.notificationMessage.updateMany({
        where: { campaignId: id, status: 'QUEUED' },
        data: { status: 'FAILED', error: 'Kampanya iptal edildi' },
      });
      await tx.notificationCampaign.update({
        where: { id },
        data: { status: 'CANCELLED', completedAt: new Date(), failedCount: { increment: dropped.count } },
      });
      return dropped.count;
    });
    return { id, status: 'CANCELLED' as const, dropped: result };
  }

  /** Tamamlanan kampanyanın başarısız mesajlarını yeniden kuyruğa alır */
  async retryFailed(id: string) {
    const campaign = await this.requireCampaign(id);
    if (campaign.status !== 'COMPLETED') throw new ConflictException('Yalnızca tamamlanan kampanyada yeniden denenir');

    const failed = await this.db.notificationMessage.findMany({
      where: { campaignId: id, status: 'FAILED' },
      select: { id: true },
    });
    if (failed.length === 0) throw new BadRequestException('Başarısız mesaj yok');

    await this.db.$transaction([
      this.db.notificationMessage.updateMany({
        where: { id: { in: failed.map((m) => m.id) } },
        data: { status: 'QUEUED', error: null },
      }),
      this.db.notificationCampaign.update({
        where: { id },
        data: { status: 'RUNNING', completedAt: null, failedCount: { decrement: failed.length } },
      }),
    ]);
    await this.queue.enqueueMessages(campaign.siteId, failed.map((m) => m.id));
    return { id, requeued: failed.length };
  }

  async removeCampaign(id: string) {
    const campaign = await this.requireCampaign(id);
    if (campaign.status !== 'DRAFT') throw new ConflictException('Yalnızca taslak kampanya silinebilir');
    await this.db.notificationCampaign.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ------------------------------------------------------------- arka plan

  /** Hedef kitleyi çözer, mesaj satırlarını üretir ve kuyruğa alır */
  private async start(id: string) {
    const claimed = await this.db.notificationCampaign.updateMany({
      where: { id, status: { in: ['DRAFT', 'SCHEDULED'] } },
      data: { status: 'RUNNING', startedAt: new Date() },
    });
    if (claimed.count === 0) return { id, status: 'SKIPPED' as const, total: 0 };

    const campaign = (await this.db.notificationCampaign.findUnique({ where: { id } }))!;
    try {
      const resolved = await this.audience.resolve({
        channel: campaign.channel,
        audience: audienceSchema.parse(campaign.audience),
        subject: campaign.subject,
        body: campaign.body,
      });

      const messages = resolved.messages.map((m) => ({
        siteId: campaign.siteId,
        campaignId: id,
        personId: m.personId,
        channel: campaign.channel,
        recipient: m.recipient,
        subject: m.subject,
        body: m.body,
      }));
      const created = await this.db.notificationMessage.createManyAndReturn({ data: messages, select: { id: true } });

      await this.db.notificationCampaign.update({
        where: { id },
        data: {
          totalCount: created.length,
          ...(created.length === 0 ? { status: 'COMPLETED', completedAt: new Date() } : {}),
        },
      });
      await this.queue.enqueueMessages(campaign.siteId, created.map((m) => m.id));
      return { id, status: created.length === 0 ? ('COMPLETED' as const) : ('RUNNING' as const), total: created.length };
    } catch (error) {
      // Başlatılamayan kampanya RUNNING'de asılı kalmasın
      await this.db.notificationCampaign.update({ where: { id }, data: { status: 'DRAFT', startedAt: null } });
      throw error;
    }
  }

  /** Kuyruk işleyicisi — HTTP bağlamı olmadığı için tenant bağlamını iş kurar */
  private async handle(job: Job<NotificationJob>) {
    const data = job.data;
    await runWithTenant({ siteId: data.siteId }, async () => {
      if (data.kind === 'start-campaign') {
        await this.start(data.campaignId);
        return;
      }
      await this.deliver(job, data.messageId);
    });
  }

  private async deliver(job: Job<NotificationJob>, messageId: string) {
    // Mesajı sahiplen: iptal edilmiş ya da başka işçi almışsa atla
    const claimed = await this.db.notificationMessage.updateMany({
      where: { id: messageId, status: 'QUEUED' },
      data: { status: 'SENDING' },
    });
    if (claimed.count === 0) return;

    const message = (await this.db.notificationMessage.findUnique({ where: { id: messageId } }))!;
    const settings = await this.db.siteSettings.findUnique({
      where: { siteId: message.siteId },
      select: { notificationSenderName: true },
    });

    try {
      const result = await this.providers.for(message.channel).send({
        id: message.id,
        channel: message.channel,
        recipient: message.recipient,
        subject: message.subject,
        body: message.body,
        senderName: settings?.notificationSenderName,
      });
      await this.db.notificationMessage.update({
        where: { id: messageId },
        data: { status: 'SENT', sentAt: new Date(), providerMessageId: result.providerMessageId, error: null },
      });
      if (message.campaignId) {
        await this.db.notificationCampaign.update({
          where: { id: message.campaignId },
          data: { sentCount: { increment: 1 } },
        });
      }
    } catch (error) {
      const permanent = error instanceof ProviderError && error.permanent;
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? SEND_ATTEMPTS);
      const reason = (error as Error).message;

      if (!permanent && !lastAttempt) {
        // Bir sonraki deneme yeniden sahiplenebilsin
        await this.db.notificationMessage.update({ where: { id: messageId }, data: { status: 'QUEUED', error: reason } });
        throw error;
      }
      await this.db.notificationMessage.update({ where: { id: messageId }, data: { status: 'FAILED', error: reason } });
      if (message.campaignId) {
        await this.db.notificationCampaign.update({
          where: { id: message.campaignId },
          data: { failedCount: { increment: 1 } },
        });
      }
    }

    if (message.campaignId) await this.completeIfDone(message.campaignId);
  }

  private async completeIfDone(campaignId: string) {
    const pending = await this.db.notificationMessage.count({
      where: { campaignId, status: { in: ['QUEUED', 'SENDING'] } },
    });
    if (pending > 0) return;
    await this.db.notificationCampaign.updateMany({
      where: { id: campaignId, status: 'RUNNING' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  }

  // --------------------------------------------------------------- yardımcı

  private campaignData(input: CampaignInput) {
    return {
      channel: input.channel,
      name: input.name,
      templateId: input.templateId ?? null,
      subject: input.channel === 'EMAIL' ? (input.subject?.trim() ?? null) : null,
      body: input.body,
      audience: input.audience as unknown as Prisma.InputJsonValue,
      scheduledAt: input.scheduledAt ?? null,
    };
  }

  private assertChannel(channel: NotificationChannel) {
    if (!SUPPORTED_CHANNELS.includes(channel)) {
      throw new BadRequestException(`${CHANNEL_NAMES[channel]} kanalı henüz desteklenmiyor`);
    }
  }

  private async assertTemplate(templateId: string | null | undefined) {
    if (templateId) await this.requireTemplate(templateId);
  }

  private async requireTemplate(id: string) {
    const template = await this.db.notificationTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Şablon bulunamadı');
    return template;
  }

  private async requireCampaign(id: string) {
    const campaign = await this.db.notificationCampaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Kampanya bulunamadı');
    return campaign;
  }
}
