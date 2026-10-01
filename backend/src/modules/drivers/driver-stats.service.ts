import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';

export interface DriverStats {
  driverId: string;
  offersReceived: number;
  offersAccepted: number;
  tripsAssigned: number;
  tripsCompleted: number;
  driverCancellations: number;
  avgResponseS: number | null;
  ratingAvg: number | null;
  ratingCount: number;
  safetyEvents90d: number;
  reliabilityScore: number;
}

export interface DriverBadge {
  code: 'VERIFIED' | 'HIGH_COMPLETION' | 'CONSISTENTLY_RATED';
  label: string;
}

/**
 * Reliability inputs over a rolling 90-day window. The composite reliability score is INTERNAL:
 * passengers only ever see factual badges derived from these numbers.
 */
@Injectable()
export class DriverStatsService {
  constructor(private readonly db: DatabaseService) {}

  async refresh(driverId: string): Promise<DriverStats> {
    await this.db.query(
      `WITH offers AS (
         SELECT count(*) FILTER (WHERE status <> 'CANCELLED') AS received,
                count(*) FILTER (WHERE status = 'ACCEPTED') AS accepted,
                avg(extract(epoch FROM responded_at - sent_at)) FILTER (WHERE responded_at IS NOT NULL) AS avg_resp
           FROM ride_requests WHERE driver_id = $1 AND sent_at > now() - interval '90 days'),
       trips AS (
         SELECT count(*) FILTER (WHERE assigned_at IS NOT NULL) AS assigned,
                count(*) FILTER (WHERE status = 'COMPLETED') AS completed
           FROM rides WHERE driver_id = $1 AND requested_at > now() - interval '90 days'),
       dcancel AS (
         SELECT count(*) AS n FROM ride_events
          WHERE type = 'driver_cancelled' AND actor_id = $1 AND created_at > now() - interval '90 days'),
       rt AS (
         SELECT avg(stars)::numeric(3,2) AS avg, count(*) AS n FROM ratings WHERE ratee_id = $1 AND rater_role = 'PASSENGER'),
       safety AS (
         SELECT count(*) AS n FROM safety_events s JOIN rides r ON r.id = s.ride_id
          WHERE r.driver_id = $1 AND s.created_at > now() - interval '90 days' AND s.status NOT IN ('FALSE_POSITIVE','CONFIRMED_SAFE'))
       INSERT INTO driver_stats (driver_id, offers_received, offers_accepted, trips_assigned, trips_completed, driver_cancellations,
                                 avg_response_s, rating_avg, rating_count, safety_events_90d, reliability_score, computed_at)
       SELECT $1, offers.received, offers.accepted, trips.assigned + dcancel.n, trips.completed, dcancel.n, offers.avg_resp,
              rt.avg, rt.n, safety.n,
              round((0.35 * ((trips.completed + 9)::numeric / (trips.assigned + dcancel.n + 10))
                   + 0.25 * (1 - (dcancel.n + 2)::numeric / (trips.assigned + dcancel.n + 20))
                   + 0.15 * ((offers.accepted + 8)::numeric / (offers.received + 10))
                   + 0.15 * ((COALESCE(rt.avg, 4.6) * rt.n + 4.6 * 5) / (rt.n + 5) - 1) / 4
                   + 0.10 * (1 - least(safety.n, 5) / 5.0))::numeric, 4),
              now()
         FROM offers, trips, dcancel, rt, safety
       ON CONFLICT (driver_id) DO UPDATE SET
         offers_received = EXCLUDED.offers_received, offers_accepted = EXCLUDED.offers_accepted,
         trips_assigned = EXCLUDED.trips_assigned, trips_completed = EXCLUDED.trips_completed,
         driver_cancellations = EXCLUDED.driver_cancellations, avg_response_s = EXCLUDED.avg_response_s,
         rating_avg = EXCLUDED.rating_avg, rating_count = EXCLUDED.rating_count, safety_events_90d = EXCLUDED.safety_events_90d,
         reliability_score = EXCLUDED.reliability_score, computed_at = now()`,
      [driverId],
    );
    return (await this.get(driverId))!;
  }

  async get(driverId: string): Promise<DriverStats | null> {
    return this.db.one<DriverStats>(
      `SELECT driver_id AS "driverId", offers_received AS "offersReceived", offers_accepted AS "offersAccepted",
              trips_assigned AS "tripsAssigned", trips_completed AS "tripsCompleted", driver_cancellations AS "driverCancellations",
              avg_response_s AS "avgResponseS", rating_avg AS "ratingAvg", rating_count AS "ratingCount",
              safety_events_90d AS "safetyEvents90d", reliability_score AS "reliabilityScore"
         FROM driver_stats WHERE driver_id = $1`,
      [driverId],
    );
  }

  async getMany(ids: string[]): Promise<Map<string, DriverStats>> {
    if (!ids.length) return new Map();
    const rows = await this.db.query<DriverStats>(
      `SELECT driver_id AS "driverId", offers_received AS "offersReceived", offers_accepted AS "offersAccepted",
              trips_assigned AS "tripsAssigned", trips_completed AS "tripsCompleted", driver_cancellations AS "driverCancellations",
              avg_response_s AS "avgResponseS", rating_avg AS "ratingAvg", rating_count AS "ratingCount",
              safety_events_90d AS "safetyEvents90d", reliability_score AS "reliabilityScore"
         FROM driver_stats WHERE driver_id = ANY($1::uuid[])`,
      [ids],
    );
    return new Map(rows.map((r) => [r.driverId, r]));
  }

  /** Passenger-facing, factual badges only (no opaque scores). */
  async badges(driverId: string): Promise<DriverBadge[]> {
    const row = await this.db.one<{ verified: boolean; assigned: number; completed: number; rating_avg: number | null; rating_count: number }>(
      `SELECT (d.status = 'APPROVED' AND NOT EXISTS (
                 SELECT 1 FROM driver_documents dd WHERE dd.driver_id = d.user_id AND dd.status = 'EXPIRED')) AS verified,
              COALESCE(s.trips_assigned, 0) AS assigned, COALESCE(s.trips_completed, 0) AS completed,
              s.rating_avg, COALESCE(s.rating_count, 0) AS rating_count
         FROM drivers d LEFT JOIN driver_stats s ON s.driver_id = d.user_id WHERE d.user_id = $1`,
      [driverId],
    );
    if (!row) return [];
    return badgesFrom(row);
  }
}

export function badgesFrom(s: { verified: boolean; assigned: number; completed: number; rating_avg: number | null; rating_count: number }): DriverBadge[] {
  const out: DriverBadge[] = [];
  if (s.verified) out.push({ code: 'VERIFIED', label: 'Verified Driver' });
  if (s.assigned >= 20 && s.completed / s.assigned >= 0.95) out.push({ code: 'HIGH_COMPLETION', label: 'High Completion Reliability' });
  if (s.rating_count >= 20 && (s.rating_avg ?? 0) >= 4.7) out.push({ code: 'CONSISTENTLY_RATED', label: 'Consistently Rated' });
  return out;
}
