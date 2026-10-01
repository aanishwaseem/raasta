import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { AppError } from '../../common/errors/app-error';
import { QueueService } from '../../common/queue/queue.service';
import { DriverPresenceService } from '../drivers/driver-presence.service';

export interface Range {
  from: Date;
  to: Date;
}

export function parseRange(from?: string, to?: string, defaultDays = 7): Range {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : new Date(end.getTime() - defaultDays * 86400_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) throw new AppError('VALIDATION_FAILED', 'Invalid date range');
  if (end.getTime() - start.getTime() > 366 * 86400_000) throw new AppError('VALIDATION_FAILED', 'Date range can be at most one year');
  return { from: start, to: end };
}

/** Operational analytics. Every number is computed from recorded rides, ledger entries and logged predictions, never estimated. */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly queue: QueueService,
    private readonly presence: DriverPresenceService,
  ) {}

  async kpis(r: Range, opts: { includeTestData?: boolean } = {}) {
    const inc = opts.includeTestData ?? true;
    const rides = await this.db.one<Record<string, number | null>>(
      `SELECT count(*)::int AS requested,
              count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
              count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
              count(*) FILTER (WHERE status = 'NO_DRIVERS')::int AS "noDrivers",
              count(*) FILTER (WHERE status IN ('MATCHING','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS'))::int AS active,
              COALESCE(sum(COALESCE(final_fare, offered_fare - discount_amount)) FILTER (WHERE status = 'COMPLETED'),0)::int AS gmv,
              COALESCE(sum(discount_amount) FILTER (WHERE status = 'COMPLETED'),0)::int AS discounts,
              avg(EXTRACT(EPOCH FROM assigned_at - requested_at)) FILTER (WHERE assigned_at IS NOT NULL)::int AS "avgMatchSeconds",
              percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM assigned_at - requested_at)) FILTER (WHERE assigned_at IS NOT NULL)::int AS "p90MatchSeconds",
              avg(EXTRACT(EPOCH FROM completed_at - started_at)) FILTER (WHERE status = 'COMPLETED')::int AS "avgTripSeconds",
              avg(COALESCE(actual_distance_m, est_distance_m)) FILTER (WHERE status = 'COMPLETED')::int AS "avgDistanceM",
              count(DISTINCT driver_id) FILTER (WHERE status = 'COMPLETED')::int AS "activeDrivers",
              count(DISTINCT passenger_id)::int AS "activePassengers"
         FROM rides WHERE requested_at >= $1 AND requested_at < $2 AND ($3::boolean OR NOT is_test_data)`,
      [r.from, r.to, inc],
    );
    const revenue = await this.db.one<{ fees: number }>(
      `SELECT COALESCE(sum(wt.amount),0)::int AS fees FROM wallet_transactions wt JOIN wallets w ON w.id = wt.wallet_id JOIN ledger_transactions lt ON lt.id = wt.transaction_id
        WHERE w.owner_type = 'PLATFORM_REVENUE' AND lt.created_at >= $1 AND lt.created_at < $2`,
      [r.from, r.to],
    );
    const ratings = await this.db.one<{ avg: number | null; n: number }>(`SELECT avg(stars)::numeric(3,2)::float AS avg, count(*)::int AS n FROM ratings WHERE rater_role = 'PASSENGER' AND created_at >= $1 AND created_at < $2`, [r.from, r.to]);
    const open = await this.db.one<{ safety: number; fraud: number; support: number; pendingDrivers: number; pendingWithdrawals: number }>(
      `SELECT (SELECT count(*) FROM safety_events WHERE status IN ('OPEN','ESCALATED'))::int AS safety,
              (SELECT count(*) FROM fraud_events WHERE status = 'OPEN')::int AS fraud,
              (SELECT count(*) FROM support_tickets WHERE status IN ('OPEN','IN_PROGRESS'))::int AS support,
              (SELECT count(*) FROM drivers WHERE status = 'PENDING_REVIEW')::int AS "pendingDrivers",
              (SELECT count(*) FROM withdrawals WHERE status = 'REQUESTED')::int AS "pendingWithdrawals"`,
    );
    const requested = Number(rides!.requested);
    const completed = Number(rides!.completed);
    const decided = completed + Number(rides!.cancelled) + Number(rides!.noDrivers);
    return {
      range: { from: r.from.toISOString(), to: r.to.toISOString() },
      rides: { ...rides, completionRate: decided ? round(completed / decided) : null, fulfilmentRate: requested ? round(completed / requested) : null },
      money: { gmv: rides!.gmv, discounts: rides!.discounts, platformRevenue: revenue?.fees ?? 0, currency: 'PKR' },
      quality: { avgPassengerRating: ratings?.avg ?? null, ratingCount: ratings?.n ?? 0 },
      queues: open,
      onlineDriversNow: await this.onlineNow(),
      includesTestData: inc,
    };
  }

  private async onlineNow(): Promise<number> {
    const cities = await this.db.query<{ id: string }>(`SELECT id FROM cities WHERE active`);
    let n = 0;
    for (const c of cities) n += (await this.presence.onlineInCity(c.id)).length;
    return n;
  }

  async timeseries(metric: string, r: Range, interval: 'hour' | 'day') {
    const metrics: Record<string, string> = {
      requests: `count(*)`,
      completed: `count(*) FILTER (WHERE status = 'COMPLETED')`,
      cancelled: `count(*) FILTER (WHERE status = 'CANCELLED')`,
      no_drivers: `count(*) FILTER (WHERE status = 'NO_DRIVERS')`,
      gmv: `COALESCE(sum(COALESCE(final_fare, offered_fare - discount_amount)) FILTER (WHERE status = 'COMPLETED'),0)`,
      avg_match_seconds: `COALESCE(avg(EXTRACT(EPOCH FROM assigned_at - requested_at)) FILTER (WHERE assigned_at IS NOT NULL),0)`,
    };
    const expr = metrics[metric];
    if (!expr) throw new AppError('VALIDATION_FAILED', `Unknown metric. Use one of: ${Object.keys(metrics).join(', ')}`);
    if (interval === 'hour' && r.to.getTime() - r.from.getTime() > 14 * 86400_000) throw new AppError('VALIDATION_FAILED', 'Hourly series are limited to 14 days');
    const rows = await this.db.query<{ t: Date; v: number }>(
      `SELECT g.t, COALESCE(x.v, 0)::float AS v FROM generate_series(date_trunc('${interval}', $1::timestamptz AT TIME ZONE 'Asia/Karachi'), date_trunc('${interval}', $2::timestamptz AT TIME ZONE 'Asia/Karachi'), '1 ${interval}') g(t)
         LEFT JOIN (SELECT date_trunc('${interval}', requested_at AT TIME ZONE 'Asia/Karachi') AS t, ${expr} AS v FROM rides WHERE requested_at >= $1 AND requested_at < $2 GROUP BY 1) x ON x.t = g.t ORDER BY g.t`,
      [r.from, r.to],
    );
    return { metric, interval, timezone: 'Asia/Karachi', points: rows.map((p) => ({ t: p.t, value: Math.round(p.v * 100) / 100 })) };
  }

  /** Why and where rides get cancelled, including geographic hotspots by demand zone. */
  async cancellations(r: Range) {
    const base = `FROM rides WHERE requested_at >= $1 AND requested_at < $2 AND status IN ('CANCELLED','NO_DRIVERS','COMPLETED')`;
    const [totals, byReason, byActor, byHour, hotspots, timing] = await Promise.all([
      this.db.one<{ total: number; cancelled: number }>(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled ${base}`, [r.from, r.to]),
      this.db.query(`SELECT COALESCE(cancellation_reason,'UNSPECIFIED') AS reason, count(*)::int AS count ${base} AND status = 'CANCELLED' GROUP BY 1 ORDER BY 2 DESC`, [r.from, r.to]),
      this.db.query(`SELECT COALESCE(cancelled_by,'UNKNOWN') AS "cancelledBy", count(*)::int AS count ${base} AND status = 'CANCELLED' GROUP BY 1 ORDER BY 2 DESC`, [r.from, r.to]),
      this.db.query(`SELECT EXTRACT(HOUR FROM requested_at AT TIME ZONE 'Asia/Karachi')::int AS hour, count(*)::int AS total, count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled ${base} GROUP BY 1 ORDER BY 1`, [r.from, r.to]),
      this.db.query(
        `SELECT z.id AS "zoneId", z.name, count(*)::int AS total, count(*) FILTER (WHERE r.status = 'CANCELLED')::int AS cancelled,
                round(100.0 * count(*) FILTER (WHERE r.status = 'CANCELLED') / count(*), 1)::float AS "cancelPct"
           FROM rides r JOIN demand_zones z ON ST_Covers(z.boundary, r.pickup)
          WHERE r.requested_at >= $1 AND r.requested_at < $2 AND r.status IN ('CANCELLED','NO_DRIVERS','COMPLETED')
          GROUP BY z.id HAVING count(*) >= 5 ORDER BY "cancelPct" DESC, total DESC LIMIT 10`,
        [r.from, r.to],
      ),
      this.db.one<{ avg: number | null }>(`SELECT avg(EXTRACT(EPOCH FROM cancelled_at - assigned_at))::int AS avg FROM rides WHERE cancelled_by = 'PASSENGER' AND assigned_at IS NOT NULL AND requested_at >= $1 AND requested_at < $2`, [r.from, r.to]),
    ]);
    return {
      total: totals?.total ?? 0, cancelled: totals?.cancelled ?? 0, cancelRate: totals?.total ? round((totals.cancelled ?? 0) / totals.total) : null,
      byReason, byActor, byHour, hotspots, avgSecondsFromAssignToPassengerCancel: timing?.avg ?? null,
      note: 'Hotspots need at least 5 rides in a zone. Correlation is not causation: use it to decide where to investigate.',
    };
  }

  /** Online accuracy and health of each model, computed from logged predictions vs observed outcomes. */
  async aiMonitoring(r: Range) {
    const perModel = await this.db.query(
      `SELECT kind, model_name AS model, model_version AS version, count(*)::int AS predictions, count(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolved,
              round(avg(abs_error) FILTER (WHERE resolved_at IS NOT NULL)::numeric, 2)::float AS mae,
              round((100.0 * count(*) FILTER (WHERE fallback_used) / count(*))::numeric, 1)::float AS "fallbackPct",
              percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL)::int AS "p50Ms",
              percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE latency_ms IS NOT NULL)::int AS "p95Ms"
         FROM ai_predictions WHERE created_at >= $1 AND created_at < $2 GROUP BY 1,2,3 ORDER BY kind, predictions DESC`,
      [r.from, r.to],
    );
    const tests = await this.db.one<{ test: number }>(`SELECT count(*)::int AS test FROM rides WHERE is_test_data AND requested_at >= $1 AND requested_at < $2`, [r.from, r.to]);
    const models = await this.db.query(
      `SELECT model_name AS name, version, algorithm, status, training_date AS "trainingDate", dataset_rows AS "datasetRows", trained_on_synthetic AS "trainedOnSynthetic", metrics, baseline_metrics AS "baselineMetrics"
         FROM model_versions ORDER BY model_name, training_date DESC`,
    );
    return {
      perModel, registry: models, queues: await this.queue.stats(),
      caveats: [
        'MAE compares each prediction with the value observed later. Rows with no outcome yet are excluded.',
        ...(tests?.test ? [`${tests.test} rides in this period are flagged test data; their timings come from simulated trips and are not evidence of real-world accuracy.`] : []),
      ],
    };
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;
