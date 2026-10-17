import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';

export const NOTIFICATION_QUEUE = 'notifications';

export type NotificationJob =
  | { kind: 'send'; siteId: string; messageId: string }
  | { kind: 'start-campaign'; siteId: string; campaignId: string };

export type NotificationJobHandler = (job: Job<NotificationJob>) => Promise<void>;

/** Gönderim denemesi: 3 kez, 2 sn → 4 sn bekleyerek */
export const SEND_ATTEMPTS = 3;

/**
 * BullMQ kuyruğu ve işleyicisi.
 *
 * İşleyici fonksiyonu `NotificationsService` tarafından `setHandler` ile
 * bağlanır (kuyruk ↔ servis döngüsel bağımlılığı olmasın diye). İşler
 * yalnızca kimlik taşır; mesaj içeriği veritabanındadır — kuyruk kaybolsa
 * bile `QUEUED` mesajlar yeniden kuyruğa alınabilir.
 */
@Injectable()
export class NotificationQueue implements OnModuleDestroy {
  private readonly logger = new Logger('NotificationQueue');
  private readonly queue: Queue<NotificationJob>;
  private worker: Worker<NotificationJob> | null = null;
  private readonly connections: Redis[] = [];

  constructor(private readonly config: ConfigService) {
    this.queue = new Queue<NotificationJob>(NOTIFICATION_QUEUE, {
      connection: this.connection(),
      defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 },
    });
  }

  private connection() {
    // BullMQ işleyicisi engelleyici komutlar kullandığı için maxRetriesPerRequest null olmalı
    const client = new Redis(this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
    this.connections.push(client);
    return client;
  }

  setHandler(handler: NotificationJobHandler) {
    if (this.worker) return;
    this.worker = new Worker<NotificationJob>(NOTIFICATION_QUEUE, handler, {
      connection: this.connection(),
      concurrency: 5,
      // Sağlayıcı kotalarını aşmamak için saniyede en fazla 20 iş
      limiter: { max: 20, duration: 1000 },
    });
    this.worker.on('failed', (job, error) => {
      this.logger.warn(`İş başarısız (${job?.data.kind}, deneme ${job?.attemptsMade}): ${error.message}`);
    });
  }

  async enqueueMessages(siteId: string, messageIds: string[]) {
    if (messageIds.length === 0) return;
    await this.queue.addBulk(
      messageIds.map((messageId) => ({
        name: 'send',
        data: { kind: 'send' as const, siteId, messageId },
        opts: { attempts: SEND_ATTEMPTS, backoff: { type: 'exponential', delay: 2000 } },
      })),
    );
  }

  /** Zamanlanmış kampanya: belirtilen anda başlatma işi */
  async scheduleCampaign(siteId: string, campaignId: string, at: Date) {
    await this.unscheduleCampaign(campaignId);
    await this.queue.add(
      'start-campaign',
      { kind: 'start-campaign', siteId, campaignId },
      { jobId: startJobId(campaignId), delay: Math.max(0, at.getTime() - Date.now()) },
    );
  }

  async unscheduleCampaign(campaignId: string) {
    const job = await this.queue.getJob(startJobId(campaignId));
    if (job) await job.remove().catch(() => undefined);
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue.close();
    await Promise.all(this.connections.map((c) => c.quit().catch(() => undefined)));
  }
}

const startJobId = (campaignId: string) => `start-${campaignId}`;
