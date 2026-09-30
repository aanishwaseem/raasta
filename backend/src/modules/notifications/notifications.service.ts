import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { PushProvider, SmsProvider } from '../../common/providers/messaging';
import { PageQuery, offsetOf, Page } from '../../common/dto';
import { AppError } from '../../common/errors/app-error';
import { RealtimeService } from '../realtime/realtime.service';

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** also send SMS (safety-critical messages only) */
  sms?: boolean;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService,
    private readonly push: PushProvider,
    private readonly smsProvider: SmsProvider,
  ) {}

  async notify(n: NotifyInput): Promise<void> {
    const row = await this.db.one<{ id: string; created_at: Date }>(
      `INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
      [n.userId, n.type, n.title, n.body, JSON.stringify(n.data ?? {})],
    );
    this.realtime.toUser(n.userId, 'notification', { id: row!.id, type: n.type, title: n.title, body: n.body, data: n.data ?? {} });
    const prefs = await this.db.one<{ notification_preferences: Record<string, boolean>; phone: string | null }>(
      `SELECT notification_preferences, phone FROM users WHERE id=$1`,
      [n.userId],
    );
    if (prefs?.notification_preferences?.push !== false) {
      await this.push.send(n.userId, n.title, n.body, n.data).catch((e: Error) => this.logger.warn(`push failed: ${e.message}`));
    }
    if (n.sms && prefs?.phone) {
      await this.smsProvider.send(prefs.phone, `${n.title}: ${n.body}`).catch((e: Error) => this.logger.warn(`sms failed: ${e.message}`));
    }
  }

  /** Direct SMS to a non-user (e.g. trusted contact). */
  async smsTo(phone: string, body: string): Promise<void> {
    await this.smsProvider.send(phone, body);
  }

  async list(userId: string, q: PageQuery): Promise<Page<unknown> & { unread: number }> {
    const [items, total, unread] = await Promise.all([
      this.db.query(
        `SELECT id, type, title, body, data, read_at AS "readAt", created_at AS "createdAt" FROM notifications
          WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [userId, q.pageSize, offsetOf(q)],
      ),
      this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE user_id=$1`, [userId]),
      this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL`, [userId]),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0, unread: unread?.n ?? 0 };
  }

  async markRead(userId: string, id: string) {
    const row = await this.db.one(`UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id=$1 AND user_id=$2 RETURNING id`, [id, userId]);
    if (!row) throw AppError.notFound('Notification');
  }

  async markAllRead(userId: string) {
    await this.db.query(`UPDATE notifications SET read_at = now() WHERE user_id=$1 AND read_at IS NULL`, [userId]);
  }
}
