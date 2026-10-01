import { Injectable } from '@nestjs/common';
import { DatabaseService, Queryable } from '../db/database.service';
import type { AuthUser } from '../auth/auth.types';
import type { RequestMeta } from '../auth/decorators';

export interface AuditEntry {
  actor?: AuthUser | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  meta?: RequestMeta | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  async log(e: AuditEntry, client?: Queryable): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_logs (actor_id, actor_roles, action, entity_type, entity_id, before, after, reason, ip, request_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        e.actor?.id ?? null,
        e.actor?.roles ?? null,
        e.action,
        e.entityType,
        e.entityId ?? null,
        e.before === undefined ? null : JSON.stringify(e.before),
        e.after === undefined ? null : JSON.stringify(e.after),
        e.reason ?? null,
        e.meta?.ip ?? null,
        e.meta?.requestId ?? null,
      ],
      client,
    );
  }
}
