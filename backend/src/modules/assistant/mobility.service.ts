import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { mineRoutines, RideObservation, Routine, Suggestion, suggestionsFor } from './mobility';

const WINDOW_DAYS = 56;

/**
 * Builds the user's mobility profile from their own completed rides (routine mining + typical fares).
 * Everything here is opt-out: personalization_enabled = false returns nothing and stores nothing.
 */
@Injectable()
export class MobilityService {
  constructor(private readonly db: DatabaseService) {}

  private async enabled(userId: string): Promise<boolean> {
    const u = await this.db.one<{ personalization_enabled: boolean }>(`SELECT personalization_enabled FROM users WHERE id = $1 AND status = 'ACTIVE'`, [userId]);
    return !!u?.personalization_enabled;
  }

  async refresh(userId: string) {
    if (!(await this.enabled(userId))) return null;
    const rows = await this.db.query<{
      ride_id: string; local_date: string; weekday: number; minutes: number; pc: string; dc: string; plat: number; plng: number; dlat: number; dlng: number;
      pa: string; da: string; product_code: string; fare: number;
    }>(
      `SELECT id AS ride_id,
              to_char((started_at + interval '5 hours')::date,'YYYY-MM-DD') AS local_date,
              EXTRACT(ISODOW FROM started_at + interval '5 hours')::int AS weekday,
              (EXTRACT(HOUR FROM started_at + interval '5 hours') * 60 + EXTRACT(MINUTE FROM started_at + interval '5 hours'))::int AS minutes,
              ST_AsText(ST_SnapToGrid(pickup::geometry, 0.0025)) AS pc, ST_AsText(ST_SnapToGrid(dropoff::geometry, 0.0025)) AS dc,
              ST_Y(pickup::geometry) AS plat, ST_X(pickup::geometry) AS plng, ST_Y(dropoff::geometry) AS dlat, ST_X(dropoff::geometry) AS dlng,
              pickup_address AS pa, dropoff_address AS da, product_code,
              COALESCE(final_fare, offered_fare - discount_amount) AS fare
         FROM rides WHERE passenger_id = $1 AND status = 'COMPLETED' AND started_at > now() - ($2 || ' days')::interval`,
      [userId, WINDOW_DAYS],
    );
    const obs: RideObservation[] = rows.map((r) => ({
      rideId: r.ride_id, startLocalDate: r.local_date, weekday: r.weekday, minutesOfDay: r.minutes, pickupCell: r.pc, dropoffCell: r.dc,
      pickupLat: r.plat, pickupLng: r.plng, dropoffLat: r.dlat, dropoffLng: r.dlng, pickupAddress: r.pa, dropoffAddress: r.da, productCode: r.product_code, fare: r.fare,
    }));
    const routines = mineRoutines(obs);
    const fares = rows.map((r) => r.fare).sort((a, b) => a - b);
    const q = (p: number) => (fares.length ? fares[Math.min(fares.length - 1, Math.floor(p * fares.length))] : null);
    const products = new Map<string, number>();
    for (const r of rows) products.set(r.product_code, (products.get(r.product_code) ?? 0) + 1);
    const preferred = [...products.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const cancel = await this.db.one<{ rate: number | null }>(
      `SELECT (count(*) FILTER (WHERE status = 'CANCELLED' AND cancelled_by = 'PASSENGER'))::numeric / NULLIF(count(*) FILTER (WHERE status IN ('COMPLETED','CANCELLED')), 0) AS rate
         FROM rides WHERE passenger_id = $1 AND requested_at > now() - interval '90 days'`,
      [userId],
    );
    await this.db.query(
      `INSERT INTO mobility_profiles (user_id, preferred_product, typical_fare_low, typical_fare_high, routines, cancellation_rate, rides_considered, computed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (user_id) DO UPDATE SET preferred_product = EXCLUDED.preferred_product, typical_fare_low = EXCLUDED.typical_fare_low, typical_fare_high = EXCLUDED.typical_fare_high,
         routines = EXCLUDED.routines, cancellation_rate = EXCLUDED.cancellation_rate, rides_considered = EXCLUDED.rides_considered, computed_at = now()`,
      [userId, preferred, q(0.25), q(0.75), JSON.stringify(routines), cancel?.rate ?? null, rows.length],
    );
    return this.profile(userId);
  }

  async profile(userId: string) {
    const enabled = await this.enabled(userId);
    const p = await this.db.one<{ preferred_product: string | null; typical_fare_low: number | null; typical_fare_high: number | null; routines: Routine[]; cancellation_rate: string | null; rides_considered: number; computed_at: Date }>(
      `SELECT * FROM mobility_profiles WHERE user_id = $1`,
      [userId],
    );
    return {
      personalizationEnabled: enabled,
      hasProfile: !!p && enabled,
      preferredProduct: enabled ? p?.preferred_product ?? null : null,
      typicalFareRange: enabled && p?.typical_fare_low != null ? { low: p.typical_fare_low, high: p.typical_fare_high } : null,
      routines: enabled ? p?.routines ?? [] : [],
      ridesConsidered: enabled ? p?.rides_considered ?? 0 : 0,
      computedAt: p?.computed_at ?? null,
      explanation: 'Built only from your own completed rides in the last 8 weeks. A routine needs at least 3 similar trips on 2 different days. You can switch this off or delete it at any time.',
    };
  }

  async suggestions(userId: string): Promise<Suggestion[]> {
    if (!(await this.enabled(userId))) return [];
    const p = await this.db.one<{ routines: Routine[]; computed_at: Date }>(`SELECT routines, computed_at FROM mobility_profiles WHERE user_id = $1`, [userId]);
    let routines = p?.routines;
    if (!p || Date.now() - p.computed_at.getTime() > 12 * 3600_000) routines = (await this.refresh(userId))?.routines ?? [];
    return suggestionsFor(routines ?? [], new Date());
  }

  async setEnabled(userId: string, enabled: boolean) {
    await this.db.query(`UPDATE users SET personalization_enabled = $2 WHERE id = $1`, [userId, enabled]);
    return this.profile(userId);
  }

  /** Right to erasure for the derived profile. Rides themselves are kept (they are financial records). */
  async deleteProfile(userId: string) {
    await this.db.query(`DELETE FROM mobility_profiles WHERE user_id = $1`, [userId]);
    await this.db.query(`UPDATE users SET personalization_enabled = false WHERE id = $1`, [userId]);
    return { deleted: true, personalizationEnabled: false };
  }

  async stats(userId: string) {
    const s = await this.db.one<{ rides: number; km: number; spent: number; cancelled: number; saved: number }>(
      `SELECT count(*) FILTER (WHERE status = 'COMPLETED')::int AS rides,
              COALESCE(sum(COALESCE(actual_distance_m, est_distance_m)) FILTER (WHERE status = 'COMPLETED'), 0)::int / 1000 AS km,
              COALESCE(sum(COALESCE(final_fare, offered_fare - discount_amount)) FILTER (WHERE status = 'COMPLETED'), 0)::int AS spent,
              count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
              COALESCE(sum(discount_amount) FILTER (WHERE status = 'COMPLETED'), 0)::int AS saved
         FROM rides WHERE passenger_id = $1`,
      [userId],
    );
    return { completedRides: s?.rides ?? 0, distanceKm: s?.km ?? 0, totalSpent: s?.spent ?? 0, cancelledRides: s?.cancelled ?? 0, promoSavings: s?.saved ?? 0, currency: 'PKR' };
  }
}
