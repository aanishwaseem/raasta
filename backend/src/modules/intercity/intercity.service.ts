import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { AppError } from '../../common/errors/app-error';
import { NotificationsService } from '../notifications/notifications.service';

export interface PostTripInput {
  routeId: string;
  departureAt: string;
  pickupPoint: string;
  dropoffPoint: string;
  seatsTotal: number;
  seatFare: number;
  luggagePolicy: 'NONE' | 'ONE_BAG' | 'TWO_BAGS' | 'LARGE_ALLOWED';
}

/**
 * Shared intercity seats between configured city pairs. Payment is cash to the driver in this phase
 * (wallet escrow for intercity is not implemented). Seat counts are protected by a row lock.
 */
@Injectable()
export class IntercityService {
  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  routes() {
    return this.db.query(
      `SELECT r.id, o.id AS "originCityId", o.name AS origin, d.id AS "destCityId", d.name AS destination, r.distance_km AS "distanceKm",
              r.typical_duration_min AS "typicalDurationMin", r.suggested_seat_fare AS "suggestedSeatFare"
         FROM intercity_routes r JOIN cities o ON o.id = r.origin_city_id JOIN cities d ON d.id = r.dest_city_id
        WHERE r.active AND o.active AND d.active ORDER BY o.name, d.name`,
    );
  }

  async trips(q: { routeId?: string; date?: string }) {
    return this.db.query(
      `SELECT t.id, t.route_id AS "routeId", t.departure_at AS "departureAt", t.pickup_point AS "pickupPoint", t.dropoff_point AS "dropoffPoint",
              t.seat_fare AS "seatFare", t.luggage_policy AS "luggagePolicy", t.status,
              t.seats_total - COALESCE((SELECT sum(seats) FROM intercity_bookings b WHERE b.trip_id = t.id AND b.status = 'CONFIRMED'), 0)::int AS "seatsLeft",
              split_part(u.full_name, ' ', 1) AS "driverFirstName", v.make, v.model, v.color,
              s.rating_avg AS "ratingAvg", s.rating_count AS "ratingCount"
         FROM intercity_trips t JOIN users u ON u.id = t.driver_id JOIN vehicles v ON v.id = t.vehicle_id
         LEFT JOIN driver_stats s ON s.driver_id = t.driver_id
        WHERE t.status = 'OPEN' AND t.departure_at > now() + interval '30 minutes'
          AND ($1::uuid IS NULL OR t.route_id = $1)
          AND ($2::date IS NULL OR (t.departure_at + interval '5 hours')::date = $2::date)
        ORDER BY t.departure_at LIMIT 50`,
      [q.routeId ?? null, q.date ?? null],
    );
  }

  async postTrip(driverId: string, input: PostTripInput) {
    const d = await this.db.one<{ status: string; preferences: { acceptIntercity?: boolean }; current_vehicle_id: string | null; seats: number | null }>(
      `SELECT d.status, d.preferences, d.current_vehicle_id, v.seats FROM drivers d LEFT JOIN vehicles v ON v.id = d.current_vehicle_id AND v.status = 'APPROVED' WHERE d.user_id = $1`,
      [driverId],
    );
    if (!d || d.status !== 'APPROVED') throw AppError.unprocessable('DRIVER_NOT_APPROVED', 'Your driver account is not approved');
    if (!d.preferences?.acceptIntercity) throw AppError.unprocessable('INTERCITY_DISABLED', 'Turn on intercity trips in your preferences first');
    if (!d.current_vehicle_id || !d.seats) throw AppError.unprocessable('VEHICLE_NOT_APPROVED', 'You need an approved vehicle');
    if (input.seatsTotal > d.seats - 1) throw AppError.unprocessable('TOO_MANY_SEATS', `Your vehicle has ${d.seats} seats; offer at most ${d.seats - 1} (the driver needs one)`);
    const departure = new Date(input.departureAt);
    if (Number.isNaN(departure.getTime()) || departure.getTime() < Date.now() + 3600_000) throw AppError.unprocessable('DEPARTURE_TOO_SOON', 'Departure must be at least 1 hour from now');
    const route = await this.db.one<{ suggested_seat_fare: number }>(`SELECT suggested_seat_fare FROM intercity_routes WHERE id = $1 AND active`, [input.routeId]);
    if (!route) throw AppError.notFound('Route', 'ROUTE_NOT_FOUND');
    if (input.seatFare > route.suggested_seat_fare * 2) throw AppError.unprocessable('FARE_TOO_HIGH', `Seat fare is capped at Rs ${route.suggested_seat_fare * 2} on this route`);
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO intercity_trips (route_id, driver_id, vehicle_id, departure_at, pickup_point, dropoff_point, seats_total, seat_fare, luggage_policy)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [input.routeId, driverId, d.current_vehicle_id, departure, input.pickupPoint, input.dropoffPoint, input.seatsTotal, input.seatFare, input.luggagePolicy],
    );
    return { id: row!.id, suggestedSeatFare: route.suggested_seat_fare };
  }

  myTrips(driverId: string) {
    return this.db.query(
      `SELECT t.id, t.route_id AS "routeId", t.departure_at AS "departureAt", t.pickup_point AS "pickupPoint", t.dropoff_point AS "dropoffPoint", t.seat_fare AS "seatFare", t.status,
              t.seats_total AS "seatsTotal", COALESCE(sum(b.seats) FILTER (WHERE b.status = 'CONFIRMED'),0)::int AS "seatsBooked"
         FROM intercity_trips t LEFT JOIN intercity_bookings b ON b.trip_id = t.id WHERE t.driver_id = $1 GROUP BY t.id ORDER BY t.departure_at DESC LIMIT 50`,
      [driverId],
    );
  }

  async cancelTrip(driverId: string, tripId: string) {
    const booked = await this.db.tx(async (c) => {
      const t = await c.query<{ status: string }>(`SELECT status FROM intercity_trips WHERE id = $1 AND driver_id = $2 FOR UPDATE`, [tripId, driverId]);
      if (!t.rowCount) throw AppError.notFound('Trip', 'TRIP_NOT_FOUND');
      if (!['OPEN', 'FULL'].includes(t.rows[0].status)) throw AppError.conflict('CANNOT_CANCEL', 'This trip can no longer be cancelled');
      await c.query(`UPDATE intercity_trips SET status = 'CANCELLED' WHERE id = $1`, [tripId]);
      const b = await c.query<{ passenger_id: string }>(`UPDATE intercity_bookings SET status = 'CANCELLED' WHERE trip_id = $1 AND status = 'CONFIRMED' RETURNING passenger_id`, [tripId]);
      return b.rows;
    });
    for (const b of booked) {
      await this.notifications.notify({ userId: b.passenger_id, type: 'INTERCITY_CANCELLED', title: 'Your intercity trip was cancelled', body: 'The driver cancelled this trip. Nothing was charged. Please book another seat.', data: { tripId } });
    }
    return { id: tripId, status: 'CANCELLED', passengersNotified: booked.length };
  }

  async book(passengerId: string, tripId: string, input: { seats: number; luggageCount?: number }) {
    return this.db.tx(async (c) => {
      const t = await c.query<{ id: string; status: string; seat_fare: number; seats_total: number; departure_at: Date; driver_id: string; luggage_policy: string }>(
        `SELECT id, status, seat_fare, seats_total, departure_at, driver_id, luggage_policy FROM intercity_trips WHERE id = $1 FOR UPDATE`,
        [tripId],
      );
      const trip = t.rows[0];
      if (!trip) throw AppError.notFound('Trip', 'TRIP_NOT_FOUND');
      if (trip.status !== 'OPEN') throw AppError.conflict('TRIP_NOT_OPEN', 'This trip is no longer open for booking');
      if (trip.departure_at.getTime() < Date.now() + 30 * 60_000) throw AppError.conflict('TOO_LATE', 'Booking closes 30 minutes before departure');
      if (trip.driver_id === passengerId) throw AppError.forbidden('You cannot book your own trip');
      const luggage = input.luggageCount ?? 0;
      const maxBags = { NONE: 0, ONE_BAG: 1, TWO_BAGS: 2, LARGE_ALLOWED: 4 }[trip.luggage_policy] ?? 1;
      if (luggage > maxBags * input.seats) throw AppError.unprocessable('LUGGAGE_NOT_ALLOWED', `This driver allows ${maxBags} bag(s) per seat`);
      const booked = await c.query<{ n: number }>(`SELECT COALESCE(sum(seats),0)::int AS n FROM intercity_bookings WHERE trip_id = $1 AND status = 'CONFIRMED'`, [tripId]);
      const left = trip.seats_total - booked.rows[0].n;
      if (input.seats > left) throw AppError.conflict('NOT_ENOUGH_SEATS', left > 0 ? `Only ${left} seat(s) left` : 'This trip is full', { seatsLeft: left });
      const b = await c.query<{ id: string }>(
        `INSERT INTO intercity_bookings (trip_id, passenger_id, seats, luggage_count, fare_total, payment_method) VALUES ($1,$2,$3,$4,$5,'CASH')
         ON CONFLICT (trip_id, passenger_id) DO UPDATE SET seats = EXCLUDED.seats, luggage_count = EXCLUDED.luggage_count, fare_total = EXCLUDED.fare_total, status = 'CONFIRMED'
           WHERE intercity_bookings.status = 'CANCELLED' RETURNING id`,
        [tripId, passengerId, input.seats, luggage, trip.seat_fare * input.seats],
      );
      if (!b.rowCount) throw AppError.conflict('ALREADY_BOOKED', 'You already have a booking on this trip');
      if (left - input.seats === 0) await c.query(`UPDATE intercity_trips SET status = 'FULL' WHERE id = $1`, [tripId]);
      return { bookingId: b.rows[0].id, tripId, seats: input.seats, total: trip.seat_fare * input.seats, paymentMethod: 'CASH', paymentNote: 'Pay the driver in cash at pickup.' };
    });
  }

  async cancelBooking(passengerId: string, bookingId: string) {
    const r = await this.db.tx(async (c) => {
      const b = await c.query<{ trip_id: string; departure_at: Date }>(
        `SELECT b.trip_id, t.departure_at FROM intercity_bookings b JOIN intercity_trips t ON t.id = b.trip_id WHERE b.id = $1 AND b.passenger_id = $2 AND b.status = 'CONFIRMED' FOR UPDATE OF b`,
        [bookingId, passengerId],
      );
      if (!b.rowCount) throw AppError.notFound('Booking', 'BOOKING_NOT_FOUND');
      if (b.rows[0].departure_at.getTime() < Date.now() + 2 * 3600_000) throw AppError.conflict('TOO_LATE', 'Bookings can be cancelled up to 2 hours before departure');
      await c.query(`UPDATE intercity_bookings SET status = 'CANCELLED' WHERE id = $1`, [bookingId]);
      await c.query(`UPDATE intercity_trips SET status = 'OPEN' WHERE id = $1 AND status = 'FULL'`, [b.rows[0].trip_id]);
      return { bookingId, status: 'CANCELLED' };
    });
    return r;
  }

  myBookings(passengerId: string) {
    return this.db.query(
      `SELECT b.id, b.trip_id AS "tripId", b.seats, b.luggage_count AS "luggageCount", b.fare_total AS "fareTotal", b.status, t.departure_at AS "departureAt",
              t.pickup_point AS "pickupPoint", t.dropoff_point AS "dropoffPoint", split_part(u.full_name,' ',1) AS "driverFirstName"
         FROM intercity_bookings b JOIN intercity_trips t ON t.id = b.trip_id JOIN users u ON u.id = t.driver_id
        WHERE b.passenger_id = $1 ORDER BY t.departure_at DESC LIMIT 50`,
      [passengerId],
    );
  }
}
