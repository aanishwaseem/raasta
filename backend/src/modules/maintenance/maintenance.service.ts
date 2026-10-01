import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { config } from '../../config/config';
import { DatabaseService } from '../../common/db/database.service';
import { QueueService } from '../../common/queue/queue.service';
import { RedisService } from '../../common/redis/redis.service';
import { DemandService } from '../ai/demand.service';
import { DriverPresenceService } from '../drivers/driver-presence.service';
import { DriverStatsService } from '../drivers/driver-stats.service';

/** Scheduled housekeeping: data retention, stale sessions, aggregates and closing the loop on AI predictions. */
@Injectable()
export class MaintenanceService implements OnModuleInit {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly queue: QueueService,
    private readonly presence: DriverPresenceService,
    private readonly stats: DriverStatsService,
    private readonly demand: DemandService,
  ) {}

  onModuleInit() {
    const jobs: Array<[string, number, () => Promise<unknown>]> = [
      ['retention', 6 * 3600_000, () => this.retention()],
      ['close-stale-sessions', 60_000, () => this.closeStaleOnlineSessions()],
      ['demand-snapshots', 15 * 60_000, () => this.snapshotDemand()],
      ['resolve-demand-predictions', 15 * 60_000, () => this.resolveDemandPredictions()],
      ['refresh-driver-stats', 3600_000, () => this.refreshDriverStats()],
    ];
    for (const [name, every, fn] of jobs) {
      this.queue.register('maintenance', name, async () => {
        const release = await this.redis.lock(`lock:maintenance:${name}`, Math.max(30_000, Math.floor(every / 2)));
        if (!release) return;
        try {
          const r = await fn();
          this.logger.debug(`${name}: ${JSON.stringify(r)}`);
        } finally {
          await release();
        }
      });
      void this.queue.repeat('maintenance', name, every).catch((e: Error) => this.logger.warn(`${name}: ${e.message}`));
    }
  }

  /** Precise location and short-lived secrets are kept only as long as they have a purpose. */
  async retention() {
    const cfg = config();
    const days = cfg.LOCATION_RETENTION_DAYS;
    const out: Record<string, number> = {};
    const del = async (key: string, sql: string, params: unknown[] = []) => {
      const r = await this.db.pool.query(sql, params);
      out[key] = r.rowCount ?? 0;
    };
    await del('rideLocations', `DELETE FROM ride_locations WHERE created_at < now() - make_interval(days => $1)`, [days]);
    await del('otpCodes', `DELETE FROM otp_codes WHERE created_at < now() - interval '1 day'`);
    await del('quotes', `DELETE FROM ride_quotes q WHERE created_at < now() - interval '7 days' AND NOT EXISTS (SELECT 1 FROM rides r WHERE r.quote_id = q.id)`);
    await del('idempotencyKeys', `DELETE FROM idempotency_keys WHERE created_at < now() - interval '2 days'`);
    await del('authSessions', `DELETE FROM auth_sessions WHERE expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days'`);
    await del('notifications', `DELETE FROM notifications WHERE created_at < now() - interval '90 days'`);
    await del('rideShares', `DELETE FROM ride_shares WHERE expires_at < now() - interval '7 days'`);
    return out;
  }

  /** A driver whose presence key expired (app killed, no network) is no longer online: close the open session. */
  async closeStaleOnlineSessions() {
    const open = await this.db.query<{ id: number; driver_id: string }>(`SELECT id, driver_id FROM driver_online_sessions WHERE ended_at IS NULL`);
    let closed = 0;
    for (const s of open) {
      if (await this.presence.get(s.driver_id)) continue;
      await this.db.query(`UPDATE driver_online_sessions SET ended_at = now() - make_interval(secs => $2) WHERE id = $1 AND ended_at IS NULL`, [s.id, config().DRIVER_PRESENCE_TTL_S]);
      closed++;
    }
    return { closed };
  }

  /** 15-minute per-zone aggregates for the last completed bucket. online_drivers is the live count at snapshot time. */
  async snapshotDemand() {
    const bucket = new Date(Math.floor(Date.now() / 900_000) * 900_000 - 900_000);
    const cities = await this.db.query<{ id: string }>(`SELECT id FROM cities WHERE active`);
    let rows = 0;
    for (const c of cities) {
      const zones = await this.demand.forCity(c.id);
      const agg = await this.db.query<{ zone_id: string; requests: number; completed: number; unfulfilled: number; avg_fare: number | null }>(
        `SELECT z.id AS zone_id, count(r.id)::int AS requests, count(r.id) FILTER (WHERE r.status = 'COMPLETED')::int AS completed,
                count(r.id) FILTER (WHERE r.status = 'NO_DRIVERS')::int AS unfulfilled, avg(r.offered_fare)::int AS avg_fare
           FROM demand_zones z LEFT JOIN rides r ON ST_Covers(z.boundary, r.pickup) AND r.requested_at >= $2 AND r.requested_at < $2 + interval '15 minutes' AND NOT r.is_test_data
          WHERE z.city_id = $1 AND z.active GROUP BY z.id`,
        [c.id, bucket],
      );
      for (const a of agg) {
        const online = zones.find((z) => z.zoneId === a.zone_id)?.onlineDrivers ?? 0;
        await this.db.query(
          `INSERT INTO demand_snapshots (zone_id, bucket_start, requests, completed, unfulfilled, online_drivers, avg_fare) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (zone_id, bucket_start) DO NOTHING`,
          [a.zone_id, bucket, a.requests, a.completed, a.unfulfilled, online, a.avg_fare],
        );
        rows++;
      }
    }
    return { bucket: bucket.toISOString(), rows };
  }

  /** Compares each forecast with the requests actually made in the hour it covered. */
  async resolveDemandPredictions() {
    const r = await this.db.pool.query(
      `UPDATE ai_predictions p SET actual_value = a.actual, abs_error = abs(p.predicted_value - a.actual), resolved_at = now()
         FROM (SELECT p2.id, (SELECT count(*) FROM rides r WHERE r.city_id = p2.entity_id::uuid AND r.requested_at >= p2.created_at AND r.requested_at < p2.created_at + interval '1 hour' AND NOT r.is_test_data)::float AS actual
                 FROM ai_predictions p2 WHERE p2.kind = 'DEMAND' AND p2.resolved_at IS NULL AND p2.entity_type = 'city' AND p2.created_at < now() - interval '1 hour' LIMIT 500) a
        WHERE p.id = a.id`,
    );
    return { resolved: r.rowCount ?? 0 };
  }

  async refreshDriverStats() {
    const ids = await this.db.query<{ user_id: string }>(`SELECT user_id FROM drivers WHERE status IN ('APPROVED','SUSPENDED')`);
    for (const { user_id } of ids) await this.stats.refresh(user_id).catch(() => undefined);
    return { refreshed: ids.length };
  }
}
