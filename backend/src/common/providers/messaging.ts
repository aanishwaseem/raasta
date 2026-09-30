import { Injectable, Logger } from '@nestjs/common';

/**
 * Outbound messaging abstractions. Only console implementations exist today: they log a
 * redacted line and record the message in memory so tests can assert delivery. Production needs
 * a real SMS aggregator (e.g. a local PK gateway / Twilio), FCM for push, and an email service.
 */
export interface SentMessage {
  channel: 'SMS' | 'PUSH' | 'EMAIL';
  to: string;
  body: string;
  at: Date;
}

export abstract class SmsProvider {
  abstract send(toE164: string, body: string): Promise<void>;
}
export abstract class PushProvider {
  abstract send(userId: string, title: string, body: string, data?: Record<string, unknown>): Promise<void>;
}

/** In-memory outbox shared by console providers (dev/test only). */
@Injectable()
export class DevOutbox {
  readonly messages: SentMessage[] = [];
  record(m: SentMessage) {
    this.messages.push(m);
    if (this.messages.length > 500) this.messages.shift();
  }
  lastTo(to: string, channel: SentMessage['channel'] = 'SMS'): SentMessage | undefined {
    return [...this.messages].reverse().find((m) => m.to === to && m.channel === channel);
  }
}

@Injectable()
export class ConsoleSmsProvider extends SmsProvider {
  private readonly logger = new Logger('SMS');
  constructor(private readonly outbox: DevOutbox) {
    super();
  }
  async send(to: string, body: string): Promise<void> {
    this.outbox.record({ channel: 'SMS', to, body, at: new Date() });
    // OTP bodies are not logged verbatim outside development
    const shown = process.env.NODE_ENV === 'production' ? body.replace(/\d{4,}/g, '****') : body;
    this.logger.log(`[console-sms] to=${to.slice(0, 5)}*** ${shown}`);
  }
}

@Injectable()
export class ConsolePushProvider extends PushProvider {
  private readonly logger = new Logger('Push');
  constructor(private readonly outbox: DevOutbox) {
    super();
  }
  async send(userId: string, title: string, body: string): Promise<void> {
    this.outbox.record({ channel: 'PUSH', to: userId, body: `${title}: ${body}`, at: new Date() });
    this.logger.debug(`[console-push] user=${userId} ${title}`);
  }
}
