import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { QueueService } from '../../common/queue/queue.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuditService } from '../../common/audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { offsetOf, PageQuery } from '../../common/dto';
import type { AuthUser } from '../../common/auth/auth.types';
import { AiClient } from '../ai/ai.client';
import { PredictionsService } from '../ai/predictions.service';
import { RealtimeService } from '../realtime/realtime.service';
import { evaluateRules, FraudSignals, RiskLevel, scoreHits } from './fraud.rules';

/**
 * Scans recent activity for fraud signals and records events for human review.
 * It NEVER suspends, blocks, or penalises anyone by itself, and scores are never exposed to end users.
 */
@Injectable()
export class FraudService implements OnModuleInit {
  private readonly logger = new Logger(FraudService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly queue: QueueService,
    private readonly ai: AiClient,
    private readonly predictions: PredictionsService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit() {
    this.queue.register('maintenance', 'fraud-scan', () => this.scan());
    void this.queue.repeat('maintenance', 'fraud-scan', 15 * 60_000).catch((e: Error) => this.logger.warn(e.message));
  }

  async signalsFor(userId: string): Promise<FraudSignals> {
    const row = await this.db.one<Omit<FraudSignals, 'gpsJumps24h'>>(
      `SELECT
         COALESCE((SELECT count(DISTINCT s2.user_id) FROM auth_sessions s1 JOIN auth_sessions s2 ON s2.device_id = s1.device_id
                    WHERE s1.user_id = $1 AND s1.device_id IS NOT NULL), 1)::int AS "accountsOnSameDevice",
         (SELECT count(*) FROM rides WHERE passenger_id = $1 AND status = 'CANCELLED' AND cancelled_by = 'PASSENGER' AND cancelled_at > now() - interval '24 hours')::int AS "cancellations24h",
         (SELECT count(*) FROM ride_events WHERE type = 'driver_cancelled' AND actor_id = $1 AND created_at > now() - interval '24 hours')::int AS "driverCancellations24h",
         (SELECT count(*) FROM payments p JOIN rides r ON r.id = p.ride_id WHERE r.passenger_id = $1 AND p.status = 'FAILED' AND p.created_at > now() - interval '24 hours')::int AS "paymentFailures24h",
         (SELECT count(*) FROM promotion_redemptions WHERE user_id = $1 AND created_at > now() - interval '7 days' AND status <> 'RELEASED')::int AS "promoRedemptions7d",
         (SELECT count(*) FROM users ref WHERE ref.referred_by = $1 AND NOT EXISTS (SELECT 1 FROM rides r WHERE r.passenger_id = ref.id AND r.status = 'COMPLETED'))::int AS "referralsWithNoRides",
         COALESCE((SELECT max(n) FROM (SELECT count(*) AS n FROM rides r WHERE (r.passenger_id = $1 OR r.driver_id = $1) AND r.status = 'COMPLETED'
                     AND r.est_distance_m < 1500 AND r.completed_at > now() - interval '7 days'
                   GROUP BY CASE WHEN r.passenger_id = $1 THEN r.driver_id ELSE r.passenger_id END) t), 0)::int AS "repeatPairShortTrips7d",
         GREATEST(0, EXTRACT(DAY FROM now() - (SELECT created_at FROM users WHERE id = $1)))::int AS "accountAgeDays"`,
      [userId],
    );
    const day = new Date().toISOString().slice(0, 10);
    const jumps = Number((await this.redis.client.get(`fraud:gpsjump:${userId}:${day}`)) ?? 0);
    return { ...row!, gpsJumps24h: jumps };
  }

  /** Scores one user and records an event if risk is at least MEDIUM and no open event exists for the same rule. */
  async evaluateUser(userId: string): Promise<{ level: RiskLevel; score: number; created: number }> {
    const signals = await this.signalsFor(userId);
    const hits = evaluateRules(signals);
    const local = scoreHits(hits);
    const remote = hits.length ? await this.ai.fraudScore({ ...signals }).catch(() => null) : null;
    // the AI service only aggregates; take the more cautious of the two, but it never acts alone
    const level: RiskLevel = remote && rank(remote.level) > rank(local.level) ? remote.level : local.level;
    const score = remote ? Math.max(local.score, remote.score) : local.score;
    if (hits.length) {
      await this.predictions.log({ kind: 'FRAUD', model: remote?.model ?? 'rules', version: 'v1', entityType: 'user', entityId: userId, features: signals, prediction: { level, score, rules: hits.map((h) => h.rule) }, fallback: !remote });
    }
    let created = 0;
    if (level !== 'LOW') {
      for (const h of hits) {
        const dup = await this.db.one(`SELECT 1 FROM fraud_events WHERE subject_user_id = $1 AND rule_code = $2 AND (status = 'OPEN' OR created_at > now() - interval '24 hours')`, [userId, h.rule]);
        if (dup) continue;
        await this.db.query(`INSERT INTO fraud_events (subject_user_id, rule_code, risk_level, score, details) VALUES ($1,$2,$3,$4,$5)`, [userId, h.rule, level, score, JSON.stringify({ reason: h.reason, signals })]);
        created++;
      }
      if (created) this.realtime.toOps('fraud.event_created', { userId, level });
    }
    return { level, score, created };
  }

  /** Candidate users: anyone with recent cancellations/failures/referrals/promos or GPS anomalies. */
  async scan(): Promise<{ scanned: number; events: number }> {
    const candidates = await this.db.query<{ id: string }>(
      `SELECT DISTINCT id FROM (
         SELECT passenger_id AS id FROM rides WHERE requested_at > now() - interval '7 days' AND (status = 'CANCELLED' OR payment_status = 'FAILED' OR promo_id IS NOT NULL)
         UNION SELECT actor_id FROM ride_events WHERE type = 'driver_cancelled' AND created_at > now() - interval '24 hours' AND actor_id IS NOT NULL
         UNION SELECT referred_by FROM users WHERE referred_by IS NOT NULL AND created_at > now() - interval '14 days'
         UNION SELECT driver_id FROM rides WHERE completed_at > now() - interval '7 days' AND est_distance_m < 1500 AND driver_id IS NOT NULL
       ) c WHERE id IS NOT NULL LIMIT 500`,
    );
    let events = 0;
    for (const { id } of candidates) events += (await this.evaluateUser(id)).created;
    return { scanned: candidates.length, events };
  }

  async list(q: PageQuery & { status?: string; level?: string }) {
    const [items, total] = await Promise.all([
      this.db.query(
        `SELECT f.id, f.subject_user_id AS "userId", u.full_name AS "userName", f.rule_code AS rule, f.risk_level AS level, f.score::float AS score, f.details, f.status,
                f.review_note AS "reviewNote", f.created_at AS "createdAt"
           FROM fraud_events f JOIN users u ON u.id = f.subject_user_id
          WHERE ($1::text IS NULL OR f.status = $1) AND ($2::text IS NULL OR f.risk_level = $2) ORDER BY f.created_at DESC LIMIT $3 OFFSET $4`,
        [q.status ?? null, q.level ?? null, q.pageSize, offsetOf(q)],
      ),
      this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM fraud_events WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR risk_level = $2)`, [q.status ?? null, q.level ?? null]),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 };
  }

  async review(admin: AuthUser, id: string, decision: 'DISMISSED' | 'ACTIONED', note: string, meta?: Parameters<AuditService['log']>[0]['meta']) {
    const r = await this.db.one(`UPDATE fraud_events SET status = $2, reviewed_by = $3, review_note = $4, reviewed_at = now() WHERE id = $1 AND status = 'OPEN' RETURNING id`, [id, decision, admin.id, note]);
    if (!r) throw AppError.conflict('ALREADY_REVIEWED', 'This event was already reviewed');
    await this.audit.log({ actor: admin, action: 'fraud.review', entityType: 'fraud_event', entityId: id, after: { decision }, reason: note, meta });
    return { id, status: decision };
  }
}

const rank = (l: RiskLevel) => ({ LOW: 0, MEDIUM: 1, HIGH: 2 })[l];
