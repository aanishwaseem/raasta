import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { offsetOf, PageQuery } from '../../common/dto';
import { MetricsService } from '../../common/metrics/metrics.service';
import { DemandService } from '../ai/demand.service';
import { Range } from '../analytics/analytics.service';

/** Read-only operational lists and the AI-operations summary (master prompt sections 45-47). */
@Injectable()
export class AdminOpsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly metrics: MetricsService,
    private readonly demand: DemandService,
  ) {}

  async vehicles(q: PageQuery & { status?: string; q?: string }) {
    const args = [q.status ?? null, q.q ? `%${q.q}%` : null];
    const where = `($1::text IS NULL OR v.status = $1) AND ($2::text IS NULL OR v.plate_number ILIKE $2 OR v.make ILIKE $2 OR u.full_name ILIKE $2)`;
    const [items, total] = await Promise.all([
      this.db.query(
        `SELECT v.id, v.driver_id AS "driverId", u.full_name AS "driverName", v.vehicle_class AS "vehicleClass", v.make, v.model, v.year, v.color, v.plate_number AS plate, v.seats, v.status,
                (SELECT count(*) FROM driver_documents d WHERE d.vehicle_id = v.id AND d.status = 'PENDING')::int AS "pendingDocuments", v.created_at AS "createdAt"
           FROM vehicles v JOIN users u ON u.id = v.driver_id WHERE ${where} ORDER BY (v.status = 'PENDING') DESC, v.created_at DESC LIMIT $3 OFFSET $4`,
        [...args, q.pageSize, offsetOf(q)],
      ),
      this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM vehicles v JOIN users u ON u.id = v.driver_id WHERE ${where}`, args),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 };
  }

  /** Wallet balances are always derived from immutable ledger entries, never stored. */
  async wallets(q: PageQuery & { ownerType?: string }) {
    const [items, total] = await Promise.all([
      this.db.query(
        `SELECT w.id, w.owner_type AS "ownerType", w.owner_id AS "ownerId", COALESCE(u.full_name, w.owner_type) AS owner,
                COALESCE(sum(t.amount) FILTER (WHERE t.bucket = 'AVAILABLE'),0)::bigint::float AS available,
                COALESCE(sum(t.amount) FILTER (WHERE t.bucket = 'PENDING'),0)::bigint::float AS pending, count(t.id)::int AS entries
           FROM wallets w LEFT JOIN users u ON u.id = w.owner_id AND w.owner_type IN ('PASSENGER','DRIVER')
           LEFT JOIN wallet_transactions t ON t.wallet_id = w.id
          WHERE ($1::text IS NULL OR w.owner_type = $1) GROUP BY w.id, u.full_name ORDER BY entries DESC, w.created_at DESC LIMIT $2 OFFSET $3`,
        [q.ownerType ?? null, q.pageSize, offsetOf(q)],
      ),
      this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM wallets WHERE ($1::text IS NULL OR owner_type = $1)`, [q.ownerType ?? null]),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 };
  }

  /** Section 47: matching success, ETA error, deviations, shortages, live sockets. Everything is computed from recorded data. */
  async aiOps(r: Range, cityId?: string) {
    const [matching, eta, fare, safety, fraud] = await Promise.all([
      this.db.one<{ requested: number; assigned: number; noDrivers: number; avgSeconds: number | null }>(
        `SELECT count(*)::int AS requested, count(*) FILTER (WHERE assigned_at IS NOT NULL)::int AS assigned, count(*) FILTER (WHERE status = 'NO_DRIVERS')::int AS "noDrivers",
                avg(EXTRACT(EPOCH FROM assigned_at - requested_at))::int AS "avgSeconds" FROM rides WHERE requested_at >= $1 AND requested_at < $2`,
        [r.from, r.to],
      ),
      this.db.query(
        `SELECT kind, count(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolved, round(avg(abs_error) FILTER (WHERE resolved_at IS NOT NULL)::numeric, 1)::float AS "maeSeconds",
                round(avg(predicted_value) FILTER (WHERE resolved_at IS NOT NULL)::numeric, 1)::float AS "avgPredicted", round(avg(actual_value)::numeric, 1)::float AS "avgActual",
                round((100.0 * count(*) FILTER (WHERE fallback_used) / NULLIF(count(*),0))::numeric, 1)::float AS "fallbackPct"
           FROM ai_predictions WHERE kind IN ('ETA_PICKUP','ETA_TRIP') AND created_at >= $1 AND created_at < $2 GROUP BY kind ORDER BY kind`,
        [r.from, r.to],
      ),
      this.db.one<{ resolved: number; mae: number | null }>(
        `SELECT count(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolved, round(avg(abs_error) FILTER (WHERE resolved_at IS NOT NULL)::numeric, 1)::float AS mae
           FROM ai_predictions WHERE kind = 'FARE' AND created_at >= $1 AND created_at < $2`,
        [r.from, r.to],
      ),
      this.db.query(`SELECT type, severity, count(*)::int AS count FROM safety_events WHERE created_at >= $1 AND created_at < $2 GROUP BY 1,2 ORDER BY count DESC`, [r.from, r.to]),
      this.db.one<{ open: number; high: number }>(`SELECT count(*) FILTER (WHERE status = 'OPEN')::int AS open, count(*) FILTER (WHERE status = 'OPEN' AND risk_level = 'HIGH')::int AS high FROM fraud_events`),
    ]);
    const cid = cityId ?? (await this.db.one<{ id: string }>(`SELECT id FROM cities WHERE active ORDER BY name LIMIT 1`))?.id;
    const zones = cid ? await this.demand.forCity(cid) : [];
    const sockets = (await this.metrics.socketConnections.get()).values.reduce((s, v) => s + v.value, 0);
    const m = matching!;
    return {
      matching: { ...m, successRate: m.requested ? Math.round((m.assigned / m.requested) * 1000) / 1000 : null },
      etaError: eta,
      expectedMatchTimeError: { resolved: fare?.resolved ?? 0, maeSeconds: fare?.mae ?? null },
      safetyByType: safety,
      fraud,
      liveSockets: sockets,
      forecast: {
        cityId: cid ?? null,
        zones: zones.map((z) => ({ zoneId: z.zoneId, code: z.code, name: z.name, level: z.level, expectedRequests: z.expectedRequests, onlineDrivers: z.onlineDrivers, supplyGap: z.supplyGap, confidence: z.confidence, model: `${z.model}@${z.version}` })),
        predictedShortages: zones.filter((z) => z.supplyGap > 0).sort((a, b) => b.supplyGap - a.supplyGap).slice(0, 5).map((z) => ({ zone: z.name, supplyGap: z.supplyGap, level: z.level })),
      },
    };
  }
}
