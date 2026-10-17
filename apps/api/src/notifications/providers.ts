import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { NotificationChannel } from '@sy/db';

export interface OutgoingMessage {
  id: string;
  channel: NotificationChannel;
  recipient: string;
  subject: string | null;
  body: string;
  /** E-postada gönderen adı (site ayarı) */
  senderName?: string | null;
}

/**
 * Sağlayıcı hatası. `permanent` ise yeniden denemek anlamsızdır (geçersiz
 * numara, reddedilen adres) — kuyruk tekrar denemeden başarısız işaretler.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

export interface NotificationProvider {
  send(message: OutgoingMessage): Promise<{ providerMessageId: string }>;
}

/**
 * E-posta: MAIL_DRIVER=smtp gerçek SMTP, `log` (varsayılan) iletiyi yalnızca
 * loglar — geliştirmede kimseye posta gitmez.
 */
@Injectable()
export class EmailProvider implements NotificationProvider {
  private readonly logger = new Logger('Mail');
  private readonly transport: nodemailer.Transporter;
  private readonly from: string;
  private readonly driver: 'log' | 'smtp';

  constructor(config: ConfigService) {
    this.driver = config.get('MAIL_DRIVER') ?? 'log';
    this.from = config.get('MAIL_FROM') ?? 'Site Yönetimi <noreply@example.com>';
    this.transport =
      this.driver === 'smtp'
        ? nodemailer.createTransport({
            host: config.get('MAIL_HOST'),
            port: config.get('MAIL_PORT'),
            secure: config.get('MAIL_SECURE'),
            auth: config.get('MAIL_USER')
              ? { user: config.get('MAIL_USER'), pass: config.get('MAIL_PASSWORD') }
              : undefined,
          })
        : nodemailer.createTransport({ jsonTransport: true });
  }

  async send(message: OutgoingMessage) {
    const from = message.senderName ? `${message.senderName} <${addressOf(this.from)}>` : this.from;
    try {
      const info = await this.transport.sendMail({
        from,
        to: message.recipient,
        subject: message.subject ?? '',
        text: message.body,
      });
      if (this.driver === 'log') {
        this.logger.log(`[log] → ${message.recipient} | ${message.subject ?? ''}`);
      }
      return { providerMessageId: String(info.messageId ?? message.id) };
    } catch (error) {
      const err = error as Error & { responseCode?: number };
      // 5xx SMTP yanıtı kalıcıdır (adres yok, reddedildi); diğerleri geçici
      throw new ProviderError(err.message, !!err.responseCode && err.responseCode >= 500);
    }
  }
}

function addressOf(from: string): string {
  return from.match(/<([^>]+)>/)?.[1] ?? from;
}

/**
 * SMS / WhatsApp / sesli mesaj için sahte sağlayıcı (gerçek entegrasyon
 * sözleşme gerektirir). Gerçekçi davranır:
 *   - "9999" ile biten numara kalıcı hata verir (test ve demo için)
 *   - "8888" ile biten numara ilk denemede geçici hata verir, sonra başarılı olur
 */
export class MockProvider implements NotificationProvider {
  private readonly logger: Logger;
  private readonly transientSeen = new Set<string>();

  constructor(private readonly channel: NotificationChannel) {
    this.logger = new Logger(`Mock${channel}`);
  }

  async send(message: OutgoingMessage) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (message.recipient.endsWith('9999')) {
      throw new ProviderError('Numara operatör tarafından reddedildi (mock)', true);
    }
    if (message.recipient.endsWith('8888') && !this.transientSeen.has(message.id)) {
      this.transientSeen.add(message.id);
      throw new ProviderError('Sağlayıcı geçici olarak yanıt vermiyor (mock)', false);
    }
    this.logger.debug(`→ ${message.recipient}: ${message.body.slice(0, 60)}`);
    return { providerMessageId: `mock-${this.channel.toLowerCase()}-${message.id}` };
  }
}

@Injectable()
export class ProviderRegistry {
  private readonly providers: Partial<Record<NotificationChannel, NotificationProvider>>;

  constructor(email: EmailProvider) {
    this.providers = {
      EMAIL: email,
      SMS: new MockProvider('SMS'),
      WHATSAPP: new MockProvider('WHATSAPP'),
      VOICE: new MockProvider('VOICE'),
    };
  }

  for(channel: NotificationChannel): NotificationProvider {
    const provider = this.providers[channel];
    if (!provider) throw new ProviderError(`${channel} kanalı için sağlayıcı yok`, true);
    return provider;
  }
}
