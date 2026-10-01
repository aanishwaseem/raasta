import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { AppError } from '../../common/errors/app-error';
import { offsetOf, PageQuery } from '../../common/dto';
import type { AuthUser } from '../../common/auth/auth.types';
import { isStaff } from '../../common/auth/auth.types';
import { AuditService } from '../../common/audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';

export const TICKET_CATEGORIES = ['FARE', 'LOST_ITEM', 'SAFETY', 'DRIVER_BEHAVIOUR', 'PASSENGER_BEHAVIOUR', 'PAYMENT', 'ACCOUNT', 'APP_ISSUE', 'OTHER'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

/** Rule-based triage: suggests a priority from the category and keywords. A human can always change it. */
export function triage(category: TicketCategory, text: string): 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' {
  const t = text.toLowerCase();
  if (category === 'SAFETY' || /\b(unsafe|assault|harass|threat|accident|crash|danger|kidnap)\b/.test(t) || /(دھمکی|حادثہ|خطرہ)/.test(text)) return 'URGENT';
  if (category === 'PAYMENT' || /\b(charged twice|double charge|refund|overcharg)/.test(t)) return 'HIGH';
  if (category === 'LOST_ITEM') return 'NORMAL';
  return category === 'APP_ISSUE' ? 'LOW' : 'NORMAL';
}

@Injectable()
export class SupportService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(user: AuthUser, dto: { category: TicketCategory; subject: string; body: string; rideId?: string }) {
    if (dto.rideId) {
      const r = await this.db.one(`SELECT 1 FROM rides WHERE id = $1 AND (passenger_id = $2 OR driver_id = $2)`, [dto.rideId, user.id]);
      if (!r) throw AppError.notFound('Ride', 'RIDE_NOT_FOUND');
    }
    const priority = triage(dto.category, `${dto.subject} ${dto.body}`);
    const id = await this.db.tx(async (c) => {
      const t = await c.query<{ id: string }>(`INSERT INTO support_tickets (user_id, ride_id, category, subject, priority) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [user.id, dto.rideId ?? null, dto.category, dto.subject, priority]);
      await c.query(`INSERT INTO support_messages (ticket_id, author_id, author_kind, body) VALUES ($1,$2,'USER',$3)`, [t.rows[0].id, user.id, dto.body]);
      return t.rows[0].id;
    });
    this.realtime.toOps('support.ticket_created', { ticketId: id, priority, category: dto.category });
    return this.get(user, id);
  }

  async list(user: AuthUser, q: PageQuery) {
    const [items, total] = await Promise.all([
      this.db.query(
        `SELECT id, category, subject, status, priority, ride_id AS "rideId", created_at AS "createdAt", updated_at AS "updatedAt" FROM support_tickets WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2 OFFSET $3`,
        [user.id, q.pageSize, offsetOf(q)],
      ),
      this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM support_tickets WHERE user_id = $1`, [user.id]),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 };
  }

  async get(user: AuthUser, id: string) {
    const t = await this.db.one<{ id: string; user_id: string; category: string; subject: string; status: string; priority: string; ride_id: string | null; assigned_to: string | null; created_at: Date }>(`SELECT * FROM support_tickets WHERE id = $1`, [id]);
    if (!t || (t.user_id !== user.id && !isStaff(user))) throw AppError.notFound('Ticket', 'TICKET_NOT_FOUND');
    const messages = await this.db.query(
      `SELECT m.id, m.author_kind AS "authorKind", m.body, m.created_at AS "createdAt", CASE WHEN m.author_kind = 'AGENT' THEN 'Raasta Support' ELSE split_part(u.full_name,' ',1) END AS "authorName"
         FROM support_messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.ticket_id = $1 ORDER BY m.created_at`,
      [id],
    );
    return { id: t.id, category: t.category, subject: t.subject, status: t.status, priority: t.priority, rideId: t.ride_id, createdAt: t.created_at, messages, ...(isStaff(user) ? { userId: t.user_id, assignedTo: t.assigned_to } : {}) };
  }

  async addMessage(user: AuthUser, id: string, body: string) {
    const t = await this.db.one<{ user_id: string; status: string }>(`SELECT user_id, status FROM support_tickets WHERE id = $1`, [id]);
    if (!t) throw AppError.notFound('Ticket', 'TICKET_NOT_FOUND');
    const staff = isStaff(user) && t.user_id !== user.id;
    if (!staff && t.user_id !== user.id) throw AppError.notFound('Ticket', 'TICKET_NOT_FOUND');
    if (t.status === 'CLOSED') throw AppError.conflict('TICKET_CLOSED', 'This ticket is closed. Please open a new one.');
    await this.db.query(`INSERT INTO support_messages (ticket_id, author_id, author_kind, body) VALUES ($1,$2,$3,$4)`, [id, user.id, staff ? 'AGENT' : 'USER', body]);
    await this.db.query(`UPDATE support_tickets SET status = $2 WHERE id = $1 AND status <> 'CLOSED'`, [id, staff ? 'WAITING_ON_USER' : 'OPEN']);
    if (staff) await this.notifications.notify({ userId: t.user_id, type: 'SUPPORT_REPLY', title: 'Support replied to your ticket', body: body.slice(0, 120), data: { ticketId: id } });
    else this.realtime.toOps('support.ticket_reply', { ticketId: id });
    return this.get(user, id);
  }

  // ------------------------------------------------ staff
  async adminList(q: PageQuery & { status?: string; priority?: string }) {
    const where = [`($1::text IS NULL OR t.status = $1)`, `($2::text IS NULL OR t.priority = $2)`];
    const [items, total] = await Promise.all([
      this.db.query(
        `SELECT t.id, t.category, t.subject, t.status, t.priority, t.ride_id AS "rideId", t.assigned_to AS "assignedTo", t.created_at AS "createdAt", t.updated_at AS "updatedAt", u.full_name AS "userName"
           FROM support_tickets t JOIN users u ON u.id = t.user_id WHERE ${where.join(' AND ')}
          ORDER BY CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, t.created_at LIMIT $3 OFFSET $4`,
        [q.status ?? null, q.priority ?? null, q.pageSize, offsetOf(q)],
      ),
      this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM support_tickets t WHERE ${where.join(' AND ')}`, [q.status ?? null, q.priority ?? null]),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 };
  }

  async adminUpdate(admin: AuthUser, id: string, patch: { status?: string; priority?: string; assignedTo?: string | null }, meta?: Parameters<AuditService['log']>[0]['meta']) {
    const before = await this.db.one(`SELECT status, priority, assigned_to FROM support_tickets WHERE id = $1`, [id]);
    if (!before) throw AppError.notFound('Ticket', 'TICKET_NOT_FOUND');
    await this.db.query(
      `UPDATE support_tickets SET status = COALESCE($2, status), priority = COALESCE($3, priority), assigned_to = CASE WHEN $4::boolean THEN $5::uuid ELSE assigned_to END WHERE id = $1`,
      [id, patch.status ?? null, patch.priority ?? null, patch.assignedTo !== undefined, patch.assignedTo ?? null],
    );
    await this.audit.log({ actor: admin, action: 'support.ticket.update', entityType: 'support_ticket', entityId: id, before, after: patch, meta });
    return this.get(admin, id);
  }
}
