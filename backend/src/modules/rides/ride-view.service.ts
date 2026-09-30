import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { AppError } from '../../common/errors/app-error';
import { AuthUser, isStaff } from '../../common/auth/auth.types';
import { DriverPresenceService } from '../drivers/driver-presence.service';
import { DriverStatsService } from '../drivers/driver-stats.service';
import { firstName } from '../users/users.repository';
import { RideRepository, RideRow } from './ride.repository';

export type Viewer = 'PASSENGER' | 'DRIVER' | 'STAFF';

/**
 * Role-aware ride snapshot. This is the single shape every client renders and what the realtime
 * layer returns on (re)subscribe, so a reconnecting client never depends on missed events.
 */
@Injectable()
export class RideViewService {
  constructor(
    private readonly db: DatabaseService,
    private readonly rides: RideRepository,
    private readonly presence: DriverPresenceService,
    private readonly stats: DriverStatsService,
  ) {}

  viewerOf(user: AuthUser, ride: RideRow): Viewer {
    if (ride.passenger_id === user.id) return 'PASSENGER';
    if (ride.driver_id === user.id) return 'DRIVER';
    if (isStaff(user)) return 'STAFF';
    throw AppError.notFound('Ride', 'RIDE_NOT_FOUND');
  }

  /** Access check that also allows a driver who currently holds an offer for the ride. */
  async assertCanView(user: AuthUser, rideId: string): Promise<{ ride: RideRow; viewer: Viewer }> {
    const ride = await this.rides.get(rideId);
    if (ride.passenger_id === user.id) return { ride, viewer: 'PASSENGER' };
    if (ride.driver_id === user.id) return { ride, viewer: 'DRIVER' };
    if (isStaff(user)) return { ride, viewer: 'STAFF' };
    const corpAdmin = ride.corporate_id
      ? await this.db.one(`SELECT 1 FROM corporate_users WHERE corporate_id=$1 AND user_id=$2 AND role='ADMIN' AND active`, [ride.corporate_id, user.id])
      : null;
    if (corpAdmin) return { ride, viewer: 'STAFF' };
    throw AppError.notFound('Ride', 'RIDE_NOT_FOUND');
  }

  async build(ride: RideRow, viewer: Viewer) {
    const [product, driverInfo, passengerInfo, myRating, carpool, driverLocation] = await Promise.all([
      this.db.one<{ name: string; vehicle_class: string }>(`SELECT name, vehicle_class FROM ride_products WHERE code = $1`, [ride.product_code]),
      ride.driver_id ? this.driverCard(ride.driver_id, ride.vehicle_id) : Promise.resolve(null),
      viewer !== 'PASSENGER' ? this.passengerCard(ride.passenger_id) : Promise.resolve(null),
      viewer !== 'STAFF'
        ? this.db.one<{ stars: number }>(`SELECT stars FROM ratings WHERE ride_id = $1 AND rater_id = $2`, [ride.id, viewer === 'PASSENGER' ? ride.passenger_id : ride.driver_id])
        : Promise.resolve(null),
      ride.carpool_group_id
        ? this.db.one<{ riders: number }>(`SELECT count(*)::int AS riders FROM rides WHERE carpool_group_id = $1 AND status NOT IN ('CANCELLED','NO_DRIVERS')`, [ride.carpool_group_id])
        : Promise.resolve(null),
      ride.driver_id && ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(ride.status)
        ? this.presence.get(ride.driver_id)
        : Promise.resolve(null),
    ]);
    const route = this.rides.routeOf(ride).map((p) => [round6(p.lat), round6(p.lng)]);
    return {
      id: ride.id,
      status: ride.status,
      mode: ride.mode,
      productCode: ride.product_code,
      productName: product?.name ?? ride.product_code,
      vehicleClass: product?.vehicle_class ?? null,
      cityId: ride.city_id,
      pickup: { ...ride.pickup, address: ride.pickup_address },
      dropoff: { ...ride.dropoff, address: ride.dropoff_address },
      route,
      distanceM: ride.est_distance_m,
      durationS: ride.est_duration_s,
      seats: ride.seats,
      fare: {
        recommended: ride.recommended_fare,
        offered: ride.offered_fare,
        discount: ride.discount_amount,
        payable: Math.max(0, ride.offered_fare - ride.discount_amount),
        final: ride.final_fare,
        cancellationFee: ride.cancellation_fee,
        currency: ride.currency,
      },
      paymentMethod: ride.payment_method,
      paymentStatus: ride.payment_status,
      pin: viewer === 'PASSENGER' && ride.pin_code && ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED'].includes(ride.status) ? ride.pin_code : null,
      driver: driverInfo
        ? { ...driverInfo, location: driverLocation ? { lat: driverLocation.lat, lng: driverLocation.lng, heading: driverLocation.heading } : null }
        : null,
      passenger: passengerInfo,
      etas: { pickupEtaS: ride.predicted_pickup_eta_s, tripEtaS: ride.predicted_trip_eta_s },
      carpool: ride.carpool_group_id ? { groupId: ride.carpool_group_id, riders: carpool?.riders ?? 1 } : null,
      corporateId: ride.corporate_id,
      safetyMode: ride.safety_mode,
      myRating: myRating?.stars ?? null,
      matchAttempt: ride.match_attempt,
      timestamps: {
        requestedAt: ride.requested_at,
        assignedAt: ride.assigned_at,
        arrivedAt: ride.arrived_at,
        startedAt: ride.started_at,
        completedAt: ride.completed_at,
        cancelledAt: ride.cancelled_at,
      },
      cancellation: ride.cancelled_at ? { by: ride.cancelled_by, reason: ride.cancellation_reason } : null,
    };
  }

  async forUser(user: AuthUser, rideId: string) {
    const { ride, viewer } = await this.assertCanView(user, rideId);
    return this.build(ride, viewer);
  }

  async driverCard(driverId: string, vehicleId: string | null) {
    const d = await this.db.one<{ full_name: string; avatar_key: string | null; make: string | null; model: string | null; color: string | null; plate_number: string | null; vehicle_class: string | null; rating_avg: number | null; rating_count: number | null }>(
      `SELECT u.full_name, u.avatar_key, v.make, v.model, v.color, v.plate_number, v.vehicle_class, s.rating_avg, s.rating_count
         FROM users u JOIN drivers d ON d.user_id = u.id
         LEFT JOIN vehicles v ON v.id = COALESCE($2, d.current_vehicle_id)
         LEFT JOIN driver_stats s ON s.driver_id = d.user_id
        WHERE u.id = $1`,
      [driverId, vehicleId],
    );
    if (!d) return null;
    return {
      id: driverId,
      firstName: firstName(d.full_name),
      photoUrl: d.avatar_key ? `/api/v1/me/avatar/${driverId}` : null,
      rating: d.rating_avg,
      ratingCount: d.rating_count ?? 0,
      badges: await this.stats.badges(driverId),
      vehicle: d.make ? { make: d.make, model: d.model, color: d.color, plateNumber: d.plate_number, vehicleClass: d.vehicle_class } : null,
    };
  }

  async passengerCard(passengerId: string) {
    const p = await this.db.one<{ full_name: string; avg: number | null; n: number }>(
      `SELECT u.full_name, (SELECT avg(stars)::numeric(3,2) FROM ratings WHERE ratee_id = u.id AND rater_role='DRIVER') AS avg,
              (SELECT count(*)::int FROM ratings WHERE ratee_id = u.id AND rater_role='DRIVER') AS n
         FROM users u WHERE u.id = $1`,
      [passengerId],
    );
    return p ? { id: passengerId, firstName: firstName(p.full_name), rating: p.avg, ratingCount: p.n } : null;
  }
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
