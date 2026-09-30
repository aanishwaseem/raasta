import { Injectable } from '@nestjs/common';
import { DatabaseService, Queryable } from '../../common/db/database.service';
import { AppError } from '../../common/errors/app-error';
import { fromGeoJsonLine, LatLng } from '../../common/geo/geo';
import { Actor, RideStatus, sourcesFor } from './ride-state';

export interface RideRow {
  id: string;
  passenger_id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  city_id: string;
  quote_id: string | null;
  product_code: string;
  mode: 'ON_DEMAND' | 'SCHEDULED' | 'SHARED';
  status: RideStatus;
  pickup: LatLng;
  pickup_address: string;
  dropoff: LatLng;
  dropoff_address: string;
  route_geojson: string | null;
  est_distance_m: number;
  est_duration_s: number;
  recommended_fare: number;
  offered_fare: number;
  discount_amount: number;
  final_fare: number | null;
  cancellation_fee: number;
  currency: string;
  payment_method: 'CASH' | 'WALLET' | 'CARD' | 'CORPORATE';
  payment_status: string;
  promo_id: string | null;
  pin_code: string | null;
  pin_attempts: number;
  carpool_group_id: string | null;
  seats: number;
  scheduled_ride_id: string | null;
  corporate_id: string | null;
  trip_purpose: string | null;
  safety_mode: boolean;
  match_attempt: number;
  excluded_driver_ids: string[];
  predicted_pickup_eta_s: number | null;
  predicted_trip_eta_s: number | null;
  actual_distance_m: number | null;
  requested_at: Date;
  assigned_at: Date | null;
  arrived_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
}

const SELECT_RIDE = `
  SELECT r.*, json_build_object('lat', ST_Y(r.pickup::geometry), 'lng', ST_X(r.pickup::geometry)) AS pickup,
         json_build_object('lat', ST_Y(r.dropoff::geometry), 'lng', ST_X(r.dropoff::geometry)) AS dropoff,
         ST_AsGeoJSON(r.expected_route) AS route_geojson
    FROM rides r`;

@Injectable()
export class RideRepository {
  constructor(private readonly db: DatabaseService) {}

  async find(id: string, client?: Queryable, forUpdate = false): Promise<RideRow | null> {
    return this.db.one<RideRow>(`${SELECT_RIDE} WHERE r.id = $1 ${forUpdate ? 'FOR UPDATE OF r' : ''}`, [id], client);
  }

  async get(id: string, client?: Queryable, forUpdate = false): Promise<RideRow> {
    const r = await this.find(id, client, forUpdate);
    if (!r) throw AppError.notFound('Ride', 'RIDE_NOT_FOUND');
    return r;
  }

  async activeForPassenger(passengerId: string): Promise<RideRow | null> {
    return this.db.one<RideRow>(
      `${SELECT_RIDE} WHERE r.passenger_id = $1 AND r.status IN ('MATCHING','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS')
       ORDER BY r.requested_at DESC LIMIT 1`,
      [passengerId],
    );
  }

  async activeForDriver(driverId: string): Promise<RideRow[]> {
    return this.db.query<RideRow>(
      `${SELECT_RIDE} WHERE r.driver_id = $1 AND r.status IN ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS')
       ORDER BY r.assigned_at`,
      [driverId],
    );
  }

  /**
   * Conditional state transition: succeeds only if the ride is currently in a status from which
   * `actor` may move it to `to`. Writes a ride_events row in the same transaction.
   */
  async transition(
    client: Queryable,
    rideId: string,
    to: RideStatus,
    actor: Actor,
    opts: { set?: Record<string, unknown>; actorId?: string | null; eventType?: string; payload?: Record<string, unknown>; from?: RideStatus[] } = {},
  ): Promise<RideRow> {
    const allowed = opts.from ?? sourcesFor(to, actor);
    const setEntries = Object.entries(opts.set ?? {});
    const setSql = setEntries.map(([col], i) => `${col} = $${i + 4}`).join(', ');
    const res = await client.query<{ id: string; prev: RideStatus }>(
      `UPDATE rides SET status = $2${setSql ? ', ' + setSql : ''}
        WHERE id = $1 AND status = ANY($3::text[])
        RETURNING id, (SELECT status FROM rides WHERE id = $1) AS prev`,
      [rideId, to, allowed, ...setEntries.map(([, v]) => v)],
    );
    if (!res.rowCount) {
      const current = await client.query<{ status: RideStatus }>(`SELECT status FROM rides WHERE id = $1`, [rideId]);
      if (!current.rowCount) throw AppError.notFound('Ride', 'RIDE_NOT_FOUND');
      throw AppError.invalidTransition(current.rows[0].status, to);
    }
    await this.event(client, rideId, opts.eventType ?? to.toLowerCase(), { from: res.rows[0].prev, to, actorId: opts.actorId ?? null, actorRole: actor, payload: opts.payload });
    return (await this.find(rideId, client))!;
  }

  async event(
    client: Queryable,
    rideId: string,
    type: string,
    e: { from?: string | null; to?: string | null; actorId?: string | null; actorRole?: string | null; payload?: Record<string, unknown> } = {},
  ): Promise<void> {
    await client.query(
      `INSERT INTO ride_events (ride_id, type, from_status, to_status, actor_id, actor_role, payload) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [rideId, type, e.from ?? null, e.to ?? null, e.actorId ?? null, e.actorRole ?? null, JSON.stringify(e.payload ?? {})],
    );
  }

  events(rideId: string) {
    return this.db.query(
      `SELECT id, type, from_status AS "fromStatus", to_status AS "toStatus", actor_role AS "actorRole", payload, created_at AS "createdAt"
         FROM ride_events WHERE ride_id = $1 ORDER BY id`,
      [rideId],
    );
  }

  routeOf(r: RideRow): LatLng[] {
    return fromGeoJsonLine(r.route_geojson);
  }
}
