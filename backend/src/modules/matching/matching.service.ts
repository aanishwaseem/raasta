import { Injectable, OnModuleInit } from '@nestjs/common';
import { config } from '../../config/config';
import { DatabaseService } from '../../common/db/database.service';
import { RedisService } from '../../common/redis/redis.service';
import { QueueService } from '../../common/queue/queue.service';
import { EventBus } from '../../common/events/event-bus';
import { MetricsService } from '../../common/metrics/metrics.service';
import { AppError } from '../../common/errors/app-error';
import { bearingDeg, bearingDiff, coarsen } from '../../common/geo/geo';
import { randomDigits } from '../../common/crypto/crypto';
import { DriverPresenceService, Presence } from '../drivers/driver-presence.service';
import { DriverStatsService } from '../drivers/driver-stats.service';
import { AiClient } from '../ai/ai.client';
import { PredictionsService } from '../ai/predictions.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { localHourPk } from '../geo/routing.provider';
import { RideRepository, RideRow } from '../rides/ride.repository';
import { RideViewService } from '../rides/ride-view.service';
import { compatibility, DEFAULT_CARPOOL_LIMITS } from '../carpool/carpool';
import type { CandidateFeatures } from './scoring';

interface MatchJob {
  rideId: string;
  radiusIdx: number;
}

const offerLockKey = (driverId: string) => `driver:offer-lock:${driverId}`;
const AVG_PICKUP_SPEED_MPS = 6; // ~22 km/h urban approach speed used for candidate pickup ETAs before AI refinement

/**
 * Sequential-offer matching: rank eligible drivers, offer the best one, wait for accept/decline/expiry,
 * then move to the next candidate or widen the search radius. All state lives in Postgres + Redis +
 * BullMQ so any API/worker replica can continue the process after a restart.
 */
@Injectable()
export class MatchingService implements OnModuleInit {

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly queue: QueueService,
    private readonly events: EventBus,
    private readonly metrics: MetricsService,
    private readonly presence: DriverPresenceService,
    private readonly stats: DriverStatsService,
    private readonly ai: AiClient,
    private readonly predictions: PredictionsService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly rides: RideRepository,
    private readonly views: RideViewService,
  ) {}

  onModuleInit() {
    this.queue.register('matching', 'match', (d: MatchJob) => this.runMatching(d.rideId, d.radiusIdx));
    this.queue.register('matching', 'offer-expire', (d: { offerId: string }) => this.expireOffer(d.offerId));
  }

  private get radii(): number[] {
    return config()
      .MATCH_RADII_KM.split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => n > 0);
  }

  async start(rideId: string): Promise<void> {
    await this.queue.add('matching', 'match', { rideId, radiusIdx: 0 } satisfies MatchJob, { jobId: `match-${rideId}-${Date.now()}` });
  }

  /** One matching step: find, rank and offer. Idempotent: does nothing unless the ride is MATCHING with no live offer. */
  async runMatching(rideId: string, radiusIdx: number): Promise<void> {
    const ride = await this.rides.find(rideId);
    if (!ride || ride.status !== 'MATCHING') return;
    const live = await this.db.one(`SELECT 1 FROM ride_requests WHERE ride_id = $1 AND status = 'SENT' AND expires_at > now()`, [rideId]);
    if (live) return;

    const offered = await this.db.query<{ driver_id: string }>(`SELECT DISTINCT driver_id FROM ride_requests WHERE ride_id = $1`, [rideId]);
    if (offered.length >= config().MATCH_MAX_OFFERS) return this.noDrivers(ride, 'offer limit reached');
    const excluded = new Set([...ride.excluded_driver_ids, ...offered.map((o) => o.driver_id), ride.passenger_id]);

    const radiusKm = this.radii[Math.min(radiusIdx, this.radii.length - 1)];
    const product = await this.db.one<{ vehicle_class: string; is_shared: boolean; capacity: number }>(
      `SELECT vehicle_class, is_shared, capacity FROM ride_products WHERE code = $1`,
      [ride.product_code],
    );
    const nearby = await this.presence.nearby(ride.city_id, ride.pickup, radiusKm, 60);
    const eligible: Array<Presence & { distanceM: number; routeCompat: number; carpoolGroupId?: string | null }> = [];
    const driverPrefs = await this.driverPrefs(nearby.map((n) => n.driverId));
    for (const d of nearby) {
      if (excluded.has(d.driverId) || d.vehicleClass !== product!.vehicle_class || d.seats < ride.seats) continue;
      const prefs = driverPrefs.get(d.driverId);
      if (prefs && prefs.maxPickupKm * 1000 < d.distanceM) continue;
      if (await this.redis.client.exists(offerLockKey(d.driverId))) continue;
      if (d.status === 'IDLE') {
        const heading = d.heading === null ? 0.5 : 1 - bearingDiff(d.heading, bearingDeg(d, ride.pickup)) / 180;
        eligible.push({ ...d, routeCompat: heading });
      } else if (d.status === 'ON_TRIP' && product!.is_shared && prefs?.acceptShared !== false) {
        const pool = await this.carpoolFit(d.driverId, ride, product!.capacity);
        if (pool) eligible.push({ ...d, routeCompat: pool.score, carpoolGroupId: pool.groupId });
      }
    }

    if (!eligible.length) {
      if (radiusIdx < this.radii.length - 1) {
        await this.queue.add('matching', 'match', { rideId, radiusIdx: radiusIdx + 1 } satisfies MatchJob, { jobId: `match-${rideId}-r${radiusIdx + 1}-${Date.now()}` });
        this.realtime.toUser(ride.passenger_id, 'ride.matching', { rideId, stage: 'expanding_search', radiusKm: this.radii[radiusIdx + 1] });
        return;
      }
      return this.noDrivers(ride, 'no eligible drivers');
    }

    const passengerPrefs = await this.db.one<{ safety_preferences: { preferFemaleDriver?: boolean } }>(`SELECT safety_preferences FROM users WHERE id = $1`, [ride.passenger_id]);
    const wantsFemale = !!passengerPrefs?.safety_preferences?.preferFemaleDriver;
    const statsMap = await this.stats.getMany(eligible.map((e) => e.driverId));
    const now = new Date();
    const etas = await this.ai.predictEta(
      eligible.map((e) => ({
        kind: 'PICKUP' as const,
        distanceM: Math.round(e.distanceM * 1.3),
        providerDurationS: Math.round((e.distanceM * 1.3) / AVG_PICKUP_SPEED_MPS) + 30,
        hour: localHourPk(now),
        weekday: ((now.getUTCDay() + 6) % 7) + 1,
        cityId: ride.city_id,
        vehicleClass: e.vehicleClass,
      })),
    );
    const candidates: CandidateFeatures[] = eligible.map((e, i) => {
      const s = statsMap.get(e.driverId);
      return {
        driverId: e.driverId,
        distanceM: e.distanceM,
        pickupEtaS: etas[i].etaS,
        offersReceived: s?.offersReceived ?? 0,
        offersAccepted: s?.offersAccepted ?? 0,
        tripsAssigned: s?.tripsAssigned ?? 0,
        tripsCompleted: s?.tripsCompleted ?? 0,
        driverCancellations: s?.driverCancellations ?? 0,
        ratingAvg: s?.ratingAvg ?? null,
        ratingCount: s?.ratingCount ?? 0,
        routeCompatibility: e.routeCompat,
        preferenceMatch: wantsFemale ? (e.gender === 'FEMALE' ? 1 : 0) : 0.5,
      };
    });

    // Recurring commute: the regular driver is offered first when eligible (the passenger chose them).
    const preferred = ride.scheduled_ride_id
      ? await this.db.one<{ preferred_driver_id: string | null }>(`SELECT preferred_driver_id FROM scheduled_rides WHERE id = $1`, [ride.scheduled_ride_id])
      : null;

    const { ranked, meta } = await this.ai.rank(candidates, { rideId, productCode: ride.product_code, attempt: ride.match_attempt, tripDistanceM: ride.est_distance_m });
    let top = ranked[0];
    if (preferred?.preferred_driver_id) {
      const p = ranked.find((r) => r.driverId === preferred.preferred_driver_id);
      if (p) top = { ...p, reasons: ['your regular driver', ...p.reasons] };
    }
    await this.predictions.log({
      kind: 'MATCH_RANK',
      model: meta.model,
      version: meta.version,
      entityType: 'ride',
      entityId: rideId,
      features: { candidates: candidates.length, radiusKm },
      prediction: { top: top.driverId, ranked: ranked.slice(0, 5).map((r) => ({ driverId: r.driverId, score: r.score })) },
      predictedValue: top.score,
      latencyMs: meta.latencyMs,
      fallback: meta.fallback,
    });

    const chosen = eligible.find((e) => e.driverId === top.driverId)!;
    const idx = eligible.indexOf(chosen);
    const release = await this.redis.lock(offerLockKey(chosen.driverId), config().MATCH_OFFER_TIMEOUT_MS + 5000);
    if (!release) {
      // raced with another ride's offer; try again immediately
      await this.queue.add('matching', 'match', { rideId, radiusIdx } satisfies MatchJob, { jobId: `match-${rideId}-retry-${Date.now()}` });
      return;
    }
    const rank = ranked.indexOf(top) + 1;
    const offer = await this.db.one<{ id: string; expires_at: Date }>(
      `INSERT INTO ride_requests (ride_id, driver_id, attempt, rank, score, score_breakdown, pickup_distance_m, pickup_eta_s, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(secs => $9)) RETURNING id, expires_at`,
      [
        rideId,
        chosen.driverId,
        ride.match_attempt,
        rank,
        top.score,
        JSON.stringify({ ...top.breakdown, reasons: top.reasons, cancelProbability: top.cancelProbability, model: `${meta.model}@${meta.version}`, carpoolGroupId: chosen.carpoolGroupId ?? null }),
        chosen.distanceM,
        etas[idx].etaS,
        config().MATCH_OFFER_TIMEOUT_MS / 1000,
      ],
    );
    // Ranking calls the AI service and can take a while (a cold start takes seconds). If the passenger cancelled
    // meanwhile, drop the offer instead of sending a driver a request for a ride that no longer exists.
    const stillMatching = await this.db.one(`SELECT 1 FROM rides WHERE id = $1 AND status = 'MATCHING'`, [rideId]);
    if (!stillMatching) {
      await this.db.query(`UPDATE ride_requests SET status = 'CANCELLED', responded_at = now() WHERE id = $1`, [offer!.id]);
      await release();
      return;
    }
    if (chosen.status === 'IDLE') await this.presence.setStatus(chosen.driverId, 'OFFERED');
    await this.queue.add('matching', 'offer-expire', { offerId: offer!.id }, { delay: config().MATCH_OFFER_TIMEOUT_MS, jobId: `offer-${offer!.id}` });

    const passenger = await this.views.passengerCard(ride.passenger_id);
    this.realtime.toUser(chosen.driverId, 'ride.offer', {
      offerId: offer!.id,
      rideId,
      expiresAt: offer!.expires_at,
      productCode: ride.product_code,
      mode: ride.mode,
      fare: Math.max(0, ride.offered_fare - 0), // drivers see the agreed fare; promo discounts are funded by the platform
      paymentMethod: ride.payment_method,
      pickup: { ...ride.pickup, address: ride.pickup_address },
      dropoffArea: { ...coarsen(ride.dropoff, 2), address: ride.dropoff_address.split(',').slice(-2).join(',').trim() || ride.dropoff_address },
      pickupDistanceM: chosen.distanceM,
      pickupEtaS: etas[idx].etaS,
      tripDistanceM: ride.est_distance_m,
      tripDurationS: ride.est_duration_s,
      passenger: passenger ? { firstName: passenger.firstName, rating: passenger.rating } : null,
      shared: !!chosen.carpoolGroupId || ride.mode === 'SHARED',
    });
    this.realtime.toUser(ride.passenger_id, 'ride.matching', { rideId, stage: 'offer_sent', candidates: eligible.length, radiusKm });
  }

  async accept(driverId: string, offerId: string) {
    const result = await this.db.tx(async (c) => {
      const offer = await this.db.one<{ id: string; ride_id: string; driver_id: string; status: string; expires_at: Date; pickup_eta_s: number; score_breakdown: { carpoolGroupId?: string | null } }>(
        `SELECT id, ride_id, driver_id, status, expires_at, pickup_eta_s, score_breakdown FROM ride_requests WHERE id = $1 FOR UPDATE`,
        [offerId],
        c,
      );
      if (!offer || offer.driver_id !== driverId) throw AppError.notFound('Offer', 'OFFER_NOT_FOUND');
      if (offer.status !== 'SENT' || offer.expires_at.getTime() < Date.now()) throw AppError.conflict('OFFER_NO_LONGER_AVAILABLE', 'This request is no longer available');
      const ride = await this.rides.get(offer.ride_id, c, true);
      if (ride.status !== 'MATCHING') throw AppError.conflict('OFFER_NO_LONGER_AVAILABLE', 'This request is no longer available');
      const vehicle = await this.db.one<{ current_vehicle_id: string }>(`SELECT current_vehicle_id FROM drivers WHERE user_id = $1 AND status = 'APPROVED'`, [driverId], c);
      if (!vehicle?.current_vehicle_id) throw AppError.forbidden('Your driver account is not active');

      let groupId: string | null = null;
      if (offer.score_breakdown?.carpoolGroupId !== undefined && ride.mode === 'SHARED') {
        groupId = await this.joinCarpool(c, driverId, ride, offer.score_breakdown.carpoolGroupId ?? null);
      }
      await c.query(`UPDATE ride_requests SET status = 'ACCEPTED', responded_at = now() WHERE id = $1`, [offerId]);
      await c.query(`UPDATE ride_requests SET status = 'CANCELLED' WHERE ride_id = $1 AND status = 'SENT' AND id <> $2`, [ride.id, offerId]);
      const updated = await this.rides.transition(c, ride.id, 'DRIVER_ASSIGNED', 'DRIVER', {
        actorId: driverId,
        set: {
          driver_id: driverId,
          vehicle_id: vehicle.current_vehicle_id,
          assigned_at: new Date(),
          pin_code: randomDigits(4),
          pin_attempts: 0,
          predicted_pickup_eta_s: offer.pickup_eta_s,
          carpool_group_id: groupId,
        },
        payload: { offerId },
      });
      return { ride: updated, pickupEtaS: offer.pickup_eta_s };
    });

    const ride = result.ride;
    await this.queue.remove('matching', `offer-${offerId}`);
    await this.redis.client.del(offerLockKey(driverId));
    await this.presence.setStatus(driverId, 'ON_TRIP');
    await this.realtime.joinUserToRide(ride.passenger_id, ride.id);
    await this.realtime.joinUserToRide(driverId, ride.id);
    this.metrics.matchLatency.observe((Date.now() - ride.requested_at.getTime()) / 1000);
    this.metrics.matchOutcomes.inc({ outcome: 'assigned' });
    // closes the loop on the "expected matching time" shown at booking (kind FARE, value = seconds)
    await this.predictions.resolve('FARE', 'ride', ride.id, (Date.now() - ride.requested_at.getTime()) / 1000).catch(() => undefined);
    await this.predictions.log({
      kind: 'ETA_PICKUP',
      model: 'eta',
      version: 'at-assignment',
      entityType: 'ride',
      entityId: ride.id,
      prediction: { etaS: result.pickupEtaS },
      predictedValue: result.pickupEtaS,
    });

    const passengerView = await this.views.build(ride, 'PASSENGER');
    const driverView = await this.views.build(ride, 'DRIVER');
    this.realtime.toUser(ride.passenger_id, 'ride.driver_assigned', { ride: passengerView });
    this.realtime.toUser(driverId, 'ride.updated', { ride: driverView });
    this.realtime.toOps('ride.driver_assigned', { rideId: ride.id, driverId });
    await this.notifications.notify({
      userId: ride.passenger_id,
      type: 'RIDE_DRIVER_ASSIGNED',
      title: 'Driver found',
      body: `${passengerView.driver?.firstName ?? 'Your driver'} is on the way in a ${passengerView.driver?.vehicle?.color ?? ''} ${passengerView.driver?.vehicle?.make ?? ''} ${passengerView.driver?.vehicle?.model ?? ''}. Your PIN is ${passengerView.pin}.`.replace(/\s+/g, ' '),
      data: { rideId: ride.id },
    });
    this.events.emit('ride.assigned', { rideId: ride.id, driverId });
    void this.stats.refresh(driverId).catch(() => undefined);
    return driverView;
  }

  async decline(driverId: string, offerId: string, reason?: string) {
    const row = await this.db.one<{ ride_id: string }>(
      `UPDATE ride_requests SET status = 'DECLINED', responded_at = now(), decline_reason = $3
        WHERE id = $1 AND driver_id = $2 AND status = 'SENT' RETURNING ride_id`,
      [offerId, driverId, reason ?? null],
    );
    if (!row) throw AppError.conflict('OFFER_NO_LONGER_AVAILABLE', 'This request is no longer available');
    await this.afterOfferClosed(driverId, offerId, row.ride_id);
    void this.stats.refresh(driverId).catch(() => undefined);
    return { declined: true };
  }

  async expireOffer(offerId: string): Promise<void> {
    const row = await this.db.one<{ ride_id: string; driver_id: string }>(
      `UPDATE ride_requests SET status = 'EXPIRED', responded_at = now() WHERE id = $1 AND status = 'SENT' RETURNING ride_id, driver_id`,
      [offerId],
    );
    if (!row) return;
    this.realtime.toUser(row.driver_id, 'ride.offer_expired', { offerId, rideId: row.ride_id });
    await this.afterOfferClosed(row.driver_id, offerId, row.ride_id);
  }

  private async afterOfferClosed(driverId: string, offerId: string, rideId: string) {
    await this.queue.remove('matching', `offer-${offerId}`);
    await this.redis.client.del(offerLockKey(driverId));
    const p = await this.presence.get(driverId);
    if (p?.status === 'OFFERED') await this.presence.setStatus(driverId, (await this.presence.hasActiveRide(driverId)) ? 'ON_TRIP' : 'IDLE');
    await this.queue.add('matching', 'match', { rideId, radiusIdx: 0 } satisfies MatchJob, { jobId: `match-${rideId}-after-${offerId}` });
  }

  /** Cancel any live offer for a ride (ride cancelled by passenger/admin). */
  async cancelOffers(rideId: string): Promise<void> {
    const rows = await this.db.query<{ id: string; driver_id: string }>(
      `UPDATE ride_requests SET status = 'CANCELLED', responded_at = now() WHERE ride_id = $1 AND status = 'SENT' RETURNING id, driver_id`,
      [rideId],
    );
    for (const r of rows) {
      await this.queue.remove('matching', `offer-${r.id}`);
      await this.redis.client.del(offerLockKey(r.driver_id));
      const p = await this.presence.get(r.driver_id);
      if (p?.status === 'OFFERED') await this.presence.setStatus(r.driver_id, 'IDLE');
      this.realtime.toUser(r.driver_id, 'ride.offer_expired', { offerId: r.id, rideId, reason: 'cancelled' });
    }
  }

  async currentOffer(driverId: string) {
    return this.db.one(
      `SELECT rr.id AS "offerId", rr.ride_id AS "rideId", rr.expires_at AS "expiresAt", rr.pickup_distance_m AS "pickupDistanceM",
              rr.pickup_eta_s AS "pickupEtaS", r.offered_fare AS fare, r.product_code AS "productCode", r.payment_method AS "paymentMethod",
              r.pickup_address AS "pickupAddress", r.dropoff_address AS "dropoffAddress", r.est_distance_m AS "tripDistanceM",
              r.est_duration_s AS "tripDurationS",
              json_build_object('lat', ST_Y(r.pickup::geometry), 'lng', ST_X(r.pickup::geometry)) AS pickup
         FROM ride_requests rr JOIN rides r ON r.id = rr.ride_id
        WHERE rr.driver_id = $1 AND rr.status = 'SENT' AND rr.expires_at > now()
        ORDER BY rr.sent_at DESC LIMIT 1`,
      [driverId],
    );
  }

  private async noDrivers(ride: RideRow, reason: string) {
    try {
      await this.db.tx((c) => this.rides.transition(c, ride.id, 'NO_DRIVERS', 'SYSTEM', { payload: { reason } }));
    } catch (err) {
      if (err instanceof AppError && err.code === 'INVALID_STATE_TRANSITION') return;
      throw err;
    }
    this.metrics.matchOutcomes.inc({ outcome: 'no_drivers' });
    const view = await this.views.build((await this.rides.get(ride.id))!, 'PASSENGER');
    this.realtime.toUser(ride.passenger_id, 'ride.no_drivers', { ride: view, suggestion: 'Try again with the recommended fare, or schedule the ride.' });
    await this.notifications.notify({ userId: ride.passenger_id, type: 'RIDE_NO_DRIVERS', title: 'No drivers available', body: 'We could not find a driver nearby. You have not been charged.', data: { rideId: ride.id } });
    this.events.emit('ride.no_drivers', { rideId: ride.id });
  }

  private async driverPrefs(ids: string[]): Promise<Map<string, { maxPickupKm: number; acceptShared: boolean }>> {
    if (!ids.length) return new Map();
    const rows = await this.db.query<{ user_id: string; preferences: { maxPickupKm?: number; acceptShared?: boolean } }>(
      `SELECT user_id, preferences FROM drivers WHERE user_id = ANY($1::uuid[]) AND status = 'APPROVED'`,
      [ids],
    );
    return new Map(rows.map((r) => [r.user_id, { maxPickupKm: r.preferences?.maxPickupKm ?? 5, acceptShared: r.preferences?.acceptShared ?? true }]));
  }

  /** For a driver already on a shared trip: can this new shared request join? Returns route compatibility. */
  private async carpoolFit(driverId: string, ride: RideRow, capacity: number): Promise<{ score: number; groupId: string | null } | null> {
    const active = await this.rides.activeForDriver(driverId);
    if (!active.length || active.some((r) => r.mode !== 'SHARED' || r.status === 'IN_PROGRESS')) return null;
    const seatsUsed = active.reduce((s, r) => s + r.seats, 0);
    if (seatsUsed + ride.seats > capacity) return null;
    const city = await this.db.one<{ settings: { carpoolMaxDetourRatio?: number } }>(`SELECT settings FROM cities WHERE id = $1`, [ride.city_id]);
    const limits = { ...DEFAULT_CARPOOL_LIMITS, maxDetourRatio: city?.settings?.carpoolMaxDetourRatio ?? DEFAULT_CARPOOL_LIMITS.maxDetourRatio };
    let worst = 1;
    for (const r of active) {
      const c = compatibility({ pickup: r.pickup, dropoff: r.dropoff }, { pickup: ride.pickup, dropoff: ride.dropoff }, limits);
      if (!c.compatible) return null;
      worst = Math.min(worst, c.score);
    }
    return { score: worst, groupId: active[0].carpool_group_id };
  }

  private async joinCarpool(c: Parameters<RideRepository['event']>[0], driverId: string, ride: RideRow, existingGroupId: string | null): Promise<string> {
    const active = await c.query<{ id: string; carpool_group_id: string | null }>(
      `SELECT id, carpool_group_id FROM rides WHERE driver_id = $1 AND status IN ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED') AND mode = 'SHARED' FOR UPDATE`,
      [driverId],
    );
    let groupId = existingGroupId ?? active.rows.find((r) => r.carpool_group_id)?.carpool_group_id ?? null;
    if (!groupId) {
      const cap = await c.query<{ capacity: number }>(`SELECT capacity FROM ride_products WHERE code = $1`, [ride.product_code]);
      const g = await c.query<{ id: string }>(`INSERT INTO carpool_groups (city_id, driver_id, seats_total) VALUES ($1,$2,$3) RETURNING id`, [ride.city_id, driverId, cap.rows[0]?.capacity ?? 3]);
      groupId = g.rows[0].id;
    }
    await c.query(`UPDATE rides SET carpool_group_id = $2 WHERE id = ANY($1::uuid[])`, [active.rows.map((r) => r.id), groupId]);
    for (const r of active.rows) {
      await this.rides.event(c, r.id, 'carpool_joined', { actorRole: 'SYSTEM', payload: { joinedRideId: ride.id, groupId } });
    }
    return groupId;
  }
}
