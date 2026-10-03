import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { config } from '../../config/config';
import { DatabaseService } from '../../common/db/database.service';
import { EventBus } from '../../common/events/event-bus';
import { AppError } from '../../common/errors/app-error';
import { haversineM, LatLng } from '../../common/geo/geo';
import { AuthUser, hasRole } from '../../common/auth/auth.types';
import { offsetOf } from '../../common/dto';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DriverPresenceService, LocationPing } from '../drivers/driver-presence.service';
import { DriverStatsService } from '../drivers/driver-stats.service';
import { PricingService, Quote, QuoteOption } from '../pricing/pricing.service';
import { PromotionsService } from '../promotions/promotions.service';
import { PaymentsService } from '../payments/payments.service';
import { LedgerService } from '../payments/ledger.service';
import { PredictionsService } from '../ai/predictions.service';
import { AiClient } from '../ai/ai.client';
import { localHourPk } from '../geo/routing.provider';
import { SafetyService } from '../safety/safety.service';
import { CorporatePolicyService } from '../business/corporate-policy.service';
import { MatchingService } from '../matching/matching.service';
import { RideRepository, RideRow } from './ride.repository';
import { RideViewService } from './ride-view.service';
import { PASSENGER_CANCELLABLE } from './ride-state';
import { CancelRideDto, RatingDto, RideHistoryQuery, RideRequestDto } from './dto/rides.dto';

const PIN_MAX_ATTEMPTS = 3;
const NO_SHOW_WAIT_S = 300;

interface StoredQuote {
  id: string;
  passenger_id: string;
  city_id: string;
  pickup: LatLng;
  pickup_address: string;
  dropoff: LatLng;
  dropoff_address: string;
  distance_m: number;
  duration_s: number;
  options: { options: QuoteOption[]; corporateId: string | null };
  expires_at: Date;
}

@Injectable()
export class RidesService implements OnModuleInit {
  private readonly logger = new Logger(RidesService.name);
  private readonly traceThrottle = new Map<string, number>();
  /** Per-driver tail of the GPS processing chain, so pings are handled one at a time and in order. */
  private readonly locationChains = new Map<string, Promise<void>>();

  constructor(
    private readonly db: DatabaseService,
    private readonly events: EventBus,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly presence: DriverPresenceService,
    private readonly stats: DriverStatsService,
    private readonly pricing: PricingService,
    private readonly promotions: PromotionsService,
    private readonly payments: PaymentsService,
    private readonly ledger: LedgerService,
    private readonly predictions: PredictionsService,
    private readonly ai: AiClient,
    private readonly safety: SafetyService,
    private readonly policy: CorporatePolicyService,
    private readonly matching: MatchingService,
    private readonly rides: RideRepository,
    private readonly views: RideViewService,
  ) {}

  onModuleInit() {
    this.events.on('driver.location', (e) => this.enqueueLocation(e.driverId, () => this.onDriverLocation(e.driverId, e.rideIds, { lat: e.lat, lng: e.lng }, e.recordedAt, e.speedMps)));
    this.realtime.registerHandler('ride.subscribe', async (user, payload) => {
      const rideId = (payload as { rideId?: string })?.rideId;
      if (!rideId || !/^[0-9a-f-]{36}$/i.test(rideId)) throw new AppError('VALIDATION_FAILED', 'rideId is required');
      return this.views.forUser(user, rideId);
    });
    this.realtime.registerHandler('driver.location', async (user, payload) => {
      if (!hasRole(user, 'DRIVER')) throw AppError.forbidden();
      return this.presence.updateLocation(user.id, payload as LocationPing);
    });
  }

  quote(passengerId: string, dto: Parameters<PricingService['quote']>[1], dropoff: Parameters<PricingService['quote']>[2], opts: Parameters<PricingService['quote']>[3]): Promise<Quote> {
    return this.pricing.quote(passengerId, dto, dropoff, opts);
  }

  // ------------------------------------------------------------ passenger: request
  async request(passenger: AuthUser, dto: RideRequestDto, source: { scheduledRideId?: string; mode?: 'ON_DEMAND' | 'SCHEDULED' } = {}) {
    const q = await this.db.one<StoredQuote>(
      `SELECT id, passenger_id, city_id, pickup_address, dropoff_address, distance_m, duration_s, options, expires_at,
              json_build_object('lat', ST_Y(pickup::geometry), 'lng', ST_X(pickup::geometry)) AS pickup,
              json_build_object('lat', ST_Y(dropoff::geometry), 'lng', ST_X(dropoff::geometry)) AS dropoff
         FROM ride_quotes WHERE id = $1`,
      [dto.quoteId],
    );
    if (!q || q.passenger_id !== passenger.id) throw AppError.notFound('Quote', 'QUOTE_NOT_FOUND');
    if (q.expires_at.getTime() < Date.now()) throw new AppError('QUOTE_EXPIRED', 'Prices have changed. Please review the updated fare.', 410);
    const option = q.options.options.find((o) => o.productCode === dto.productCode);
    if (!option) throw AppError.unprocessable('PRODUCT_UNAVAILABLE', 'This ride type is not available for this trip');

    const offered = dto.offeredFare ?? option.fare.recommended;
    if (offered < option.fare.minimumReasonable) {
      throw AppError.unprocessable('OFFER_TOO_LOW', `The lowest fare drivers are likely to accept for this trip is Rs ${option.fare.minimumReasonable}`, {
        minimumReasonable: option.fare.minimumReasonable,
      });
    }
    if (offered > option.fare.high * 2) throw AppError.unprocessable('OFFER_TOO_HIGH', 'This offer is unusually high. Please check the amount.');

    const corporateId = dto.corporateId ?? null;
    let paymentMethod = dto.paymentMethod;
    if (corporateId) {
      await this.policy.assertAllowed({ corporateId, userId: passenger.id, productCode: dto.productCode, fare: offered, at: new Date(), tripPurpose: dto.tripPurpose });
      paymentMethod = 'CORPORATE';
    } else if (paymentMethod === 'CORPORATE') {
      throw new AppError('VALIDATION_FAILED', 'Choose a business profile to pay with your company account');
    }

    let promo: { promotionId: string; discount: number } | null = null;
    if (dto.promoCode) {
      promo = await this.promotions.preview(dto.promoCode, passenger.id, { cityId: q.city_id, productCode: dto.productCode, fare: offered, corporateId });
    }
    const payable = offered - (promo?.discount ?? 0);
    if (paymentMethod === 'WALLET') {
      const bal = await this.ledger.balance(await this.ledger.wallet('PASSENGER', passenger.id));
      if (bal.available < payable) throw AppError.unprocessable('INSUFFICIENT_BALANCE', `Your wallet balance (Rs ${bal.available}) is lower than the fare. Top up or choose cash.`);
    }
    if (paymentMethod === 'CARD') {
      const pm = await this.db.one(`SELECT 1 FROM payment_methods WHERE user_id = $1 LIMIT 1`, [passenger.id]);
      if (!pm) throw AppError.unprocessable('NO_PAYMENT_METHOD', 'Add a card first, or choose cash');
    }
    const user = await this.db.one<{ safety_preferences: { autoShareWithContacts?: boolean } }>(`SELECT safety_preferences FROM users WHERE id = $1`, [passenger.id]);
    const mode = option.isShared ? 'SHARED' : source.mode ?? 'ON_DEMAND';

    let ride: RideRow;
    try {
      ride = await this.db.tx(async (c) => {
        const inserted = await c.query<{ id: string }>(
          `INSERT INTO rides (passenger_id, city_id, quote_id, product_code, mode, status, pickup, pickup_address, dropoff, dropoff_address,
                              expected_route, est_distance_m, est_duration_s, recommended_fare, offered_fare, discount_amount, payment_method,
                              promo_id, seats, scheduled_ride_id, corporate_id, trip_purpose, safety_mode, predicted_trip_eta_s, is_test_data)
           SELECT $1, q.city_id, q.id, $2, $3, 'MATCHING', q.pickup, q.pickup_address, q.dropoff, q.dropoff_address, q.route,
                  q.distance_m, q.duration_s, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, COALESCE((SELECT is_test_data FROM users WHERE id = $1), false)
             FROM ride_quotes q WHERE q.id = $15
           RETURNING id`,
          [
            passenger.id,
            dto.productCode,
            mode,
            option.fare.recommended,
            offered,
            promo?.discount ?? 0,
            paymentMethod,
            promo?.promotionId ?? null,
            dto.seats ?? 1,
            source.scheduledRideId ?? null,
            corporateId,
            dto.tripPurpose ?? null,
            dto.safetyMode ?? !!user?.safety_preferences?.autoShareWithContacts,
            option.tripEtaS,
            q.id,
          ],
        );
        const rideId = inserted.rows[0].id;
        if (promo) await this.promotions.reserve(c, promo.promotionId, passenger.id, rideId, promo.discount);
        await this.rides.event(c, rideId, 'requested', {
          to: 'MATCHING',
          actorId: passenger.id,
          actorRole: 'PASSENGER',
          payload: { offeredFare: offered, recommendedFare: option.fare.recommended, paymentMethod, productCode: dto.productCode },
        });
        return (await this.rides.find(rideId, c))!;
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw AppError.conflict('ACTIVE_RIDE_EXISTS', 'You already have a ride in progress', { rideId: (await this.rides.activeForPassenger(passenger.id))?.id });
      }
      throw err;
    }

    await this.predictions.log({
      kind: 'ETA_TRIP',
      model: option.etaModel.split('@')[0],
      version: option.etaModel.split('@')[1] ?? 'n/a',
      entityType: 'ride',
      entityId: ride.id,
      features: { distanceM: q.distance_m, providerDurationS: q.duration_s },
      prediction: { etaS: option.tripEtaS },
      predictedValue: option.tripEtaS,
      fallback: option.etaModel.startsWith('provider-eta'),
    });
    await this.predictions.log({
      kind: 'FARE',
      model: 'fare-intelligence',
      version: 'rules-v1',
      entityType: 'ride',
      entityId: ride.id,
      features: { demandMultiplier: option.fare.demandMultiplier },
      prediction: { recommended: option.fare.recommended, minimum: option.fare.minimumReasonable, offered },
      predictedValue: option.fare.expectedMatchSeconds.atRecommended,
    });
    await this.realtime.joinUserToRide(passenger.id, ride.id);
    await this.matching.start(ride.id);
    const view = await this.views.build(ride, 'PASSENGER');
    this.realtime.toUser(passenger.id, 'ride.requested', { ride: view });
    this.realtime.toOps('ride.requested', { rideId: ride.id, cityId: ride.city_id, pickup: ride.pickup });
    this.events.emit('ride.requested', { rideId: ride.id });
    return view;
  }

  /** Retry after NO_DRIVERS with a fresh server-side quote (optionally a higher offer). */
  async retry(passenger: AuthUser, rideId: string, offeredFare?: number) {
    const prev = await this.rides.get(rideId);
    if (prev.passenger_id !== passenger.id) throw AppError.notFound('Ride', 'RIDE_NOT_FOUND');
    if (prev.status !== 'NO_DRIVERS') throw AppError.conflict('RETRY_NOT_ALLOWED', 'Only rides that found no driver can be retried');
    const quote = await this.pricing.quote(passenger.id, { ...prev.pickup, address: prev.pickup_address }, { ...prev.dropoff, address: prev.dropoff_address }, { corporateId: prev.corporate_id });
    const opt = quote.options.find((o) => o.productCode === prev.product_code);
    return this.request(passenger, {
      quoteId: quote.id,
      productCode: prev.product_code,
      offeredFare: offeredFare ?? Math.max(opt?.fare.recommended ?? prev.offered_fare, prev.offered_fare),
      paymentMethod: prev.payment_method,
      corporateId: prev.corporate_id ?? undefined,
      tripPurpose: prev.trip_purpose ?? undefined,
      safetyMode: prev.safety_mode,
      seats: prev.seats,
    });
  }

  // ------------------------------------------------------------ passenger: cancel
  async cancelByPassenger(passenger: AuthUser, rideId: string, dto: CancelRideDto) {
    const before = await this.rides.get(rideId);
    if (before.passenger_id !== passenger.id) throw AppError.notFound('Ride', 'RIDE_NOT_FOUND');
    if (!PASSENGER_CANCELLABLE.includes(before.status)) throw AppError.invalidTransition(before.status, 'CANCELLED');
    const cfg = await this.pricing.config(before.city_id, before.product_code);
    const secondsSinceAssign = before.assigned_at ? (Date.now() - before.assigned_at.getTime()) / 1000 : 0;
    const fee = before.driver_id && secondsSinceAssign > cfg.freeCancelSeconds && dto.reason !== 'SAFETY_CONCERN' && dto.reason !== 'DRIVER_ASKED' ? cfg.cancellationFee : 0;
    const ride = await this.db.tx(async (c) => {
      const r = await this.rides.transition(c, rideId, 'CANCELLED', 'PASSENGER', {
        actorId: passenger.id,
        set: { cancelled_at: new Date(), cancelled_by: 'PASSENGER', cancellation_reason: dto.reason, cancellation_fee: fee },
        payload: { reason: dto.reason, fee },
      });
      await this.promotions.release(rideId, c);
      return r;
    });
    await this.afterCancel(ride, 'PASSENGER');
    if (fee > 0) await this.payments.chargeCancellationFee(ride.id, ride.passenger_id, before.driver_id, ride.city_id, ride.product_code, fee);
    return { ride: await this.views.build(ride, 'PASSENGER'), cancellationFee: fee };
  }

  private async afterCancel(ride: RideRow, by: 'PASSENGER' | 'SYSTEM' | 'ADMIN' | 'DRIVER') {
    await this.matching.cancelOffers(ride.id);
    const driverId = (await this.db.one<{ driver_id: string | null }>(`SELECT driver_id FROM rides WHERE id = $1`, [ride.id]))?.driver_id;
    if (driverId) {
      if (!(await this.presence.hasActiveRide(driverId))) await this.presence.setStatus(driverId, 'IDLE');
      this.realtime.toUser(driverId, 'ride.cancelled', { rideId: ride.id, by, message: 'The passenger cancelled this ride.' });
      await this.notifications.notify({ userId: driverId, type: 'RIDE_CANCELLED', title: 'Ride cancelled', body: `The ride to ${ride.dropoff_address} was cancelled.`, data: { rideId: ride.id } });
    }
    this.realtime.toUser(ride.passenger_id, 'ride.cancelled', { ride: await this.views.build(ride, 'PASSENGER'), by });
    this.realtime.toOps('ride.cancelled', { rideId: ride.id, by });
    this.events.emit('ride.cancelled', { rideId: ride.id, by, driverId });
  }

  // ------------------------------------------------------------ driver lifecycle
  private async driverRide(driverId: string, rideId: string): Promise<RideRow> {
    const ride = await this.rides.get(rideId);
    if (ride.driver_id !== driverId) throw AppError.notFound('Ride', 'RIDE_NOT_FOUND');
    return ride;
  }

  async arrived(driverId: string, rideId: string) {
    const ride = await this.driverRide(driverId, rideId);
    const p = await this.presence.get(driverId);
    if (p) {
      const dist = haversineM(p, ride.pickup);
      if (dist > config().ARRIVAL_GEOFENCE_M) {
        throw AppError.unprocessable('TOO_FAR_FROM_PICKUP', `You are about ${Math.round(dist)} m from the pickup point`, { distanceM: Math.round(dist) });
      }
    }
    const updated = await this.db.tx((c) => this.rides.transition(c, rideId, 'DRIVER_ARRIVED', 'DRIVER', { actorId: driverId, set: { arrived_at: new Date() } }));
    if (updated.assigned_at) {
      await this.predictions.resolve('ETA_PICKUP', 'ride', rideId, (updated.arrived_at!.getTime() - updated.assigned_at.getTime()) / 1000);
    }
    await this.broadcast(updated, 'ride.driver_arrived');
    await this.notifications.notify({ userId: updated.passenger_id, type: 'RIDE_DRIVER_ARRIVED', title: 'Your driver has arrived', body: `Share your PIN ${updated.pin_code} with the driver to start the trip.`, data: { rideId } });
    return this.views.build(updated, 'DRIVER');
  }

  async start(driverId: string, rideId: string, pin: string) {
    const ride = await this.driverRide(driverId, rideId);
    if (ride.status !== 'DRIVER_ARRIVED') throw AppError.invalidTransition(ride.status, 'IN_PROGRESS');
    // Count the attempt atomically before comparing so parallel requests cannot brute-force the 4-digit PIN past the limit.
    const counted = await this.db.one<{ pin_attempts: number }>(
      `UPDATE rides SET pin_attempts = pin_attempts + 1 WHERE id = $1 AND pin_attempts < $2 RETURNING pin_attempts`,
      [rideId, PIN_MAX_ATTEMPTS],
    );
    if (!counted) throw AppError.unprocessable('PIN_LOCKED', 'Too many incorrect PINs. Please confirm the passenger and contact support.');
    if (!ride.pin_code || pin.length !== ride.pin_code.length || !timingSafeEqual(Buffer.from(pin), Buffer.from(ride.pin_code))) {
      await this.rides.event(this.db.pool, rideId, 'pin_failed', { actorId: driverId, actorRole: 'DRIVER' });
      const left = PIN_MAX_ATTEMPTS - counted.pin_attempts;
      throw AppError.unprocessable('PIN_INCORRECT', left > 0 ? `That PIN is not correct. ${left} attempt(s) left. Make sure this is the right passenger.` : 'Too many incorrect PINs.', { attemptsLeft: left });
    }
    const now = new Date();
    const etas = await this.ai.predictEta([
      { kind: 'TRIP', distanceM: ride.est_distance_m, providerDurationS: ride.est_duration_s, hour: localHourPk(now), weekday: ((now.getUTCDay() + 6) % 7) + 1, cityId: ride.city_id },
    ]);
    const updated = await this.db.tx((c) =>
      this.rides.transition(c, rideId, 'IN_PROGRESS', 'DRIVER', { actorId: driverId, set: { started_at: now, predicted_trip_eta_s: etas[0].etaS } }),
    );
    await this.predictions.log({
      kind: 'ETA_TRIP',
      model: etas[0].model,
      version: etas[0].version,
      entityType: 'ride-start',
      entityId: rideId,
      features: { distanceM: ride.est_distance_m, providerDurationS: ride.est_duration_s },
      prediction: { etaS: etas[0].etaS },
      predictedValue: etas[0].etaS,
      fallback: etas[0].fallback,
    });
    await this.broadcast(updated, 'ride.started');
    this.events.emit('ride.started', { rideId });
    return this.views.build(updated, 'DRIVER');
  }

  async complete(driverId: string, rideId: string, end?: LatLng) {
    const ride = await this.driverRide(driverId, rideId);
    const presence = await this.presence.get(driverId);
    const endPoint = end ?? (presence ? { lat: presence.lat, lng: presence.lng } : null);
    const traced = await this.db.one<{ m: number | null }>(
      `SELECT ST_Length(ST_MakeLine(location::geometry ORDER BY recorded_at)::geography)::int AS m FROM ride_locations WHERE ride_id = $1 AND phase = 'ON_TRIP'`,
      [rideId],
    );
    const updated = await this.db.tx(async (c) => {
      const r = await this.rides.transition(c, rideId, 'COMPLETED', 'DRIVER', {
        actorId: driverId,
        set: { completed_at: new Date(), actual_distance_m: traced?.m ?? null },
        payload: { endPoint },
      });
      await this.promotions.markApplied(rideId, c);
      return r;
    });
    const payment = await this.payments.settleRide(rideId).catch((err: Error) => {
      this.logger.error(`Settlement failed for ${rideId}: ${err.message}`);
      return { status: 'FAILED' as const, method: ride.payment_method, amount: ride.offered_fare - ride.discount_amount, failureReason: 'settlement_error' };
    });
    if (updated.started_at) {
      const actual = (updated.completed_at!.getTime() - updated.started_at.getTime()) / 1000;
      await this.predictions.resolve('ETA_TRIP', 'ride-start', rideId, actual);
      await this.predictions.resolve('ETA_TRIP', 'ride', rideId, actual);
    }
    if (!(await this.presence.hasActiveRide(driverId))) await this.presence.setStatus(driverId, 'IDLE');
    await this.safety.checkCompletion(updated, endPoint);
    const final = await this.rides.get(rideId);
    await this.broadcast(final, 'ride.completed', { payment });
    await this.notifications.notify({
      userId: final.passenger_id,
      type: 'RIDE_COMPLETED',
      title: 'You have arrived',
      body: payment.status === 'PAID' ? `Rs ${payment.amount} paid by ${payment.method.toLowerCase()}. Please rate your trip.` : `Payment of Rs ${payment.amount} did not go through. Please pay the driver in cash.`,
      data: { rideId },
    });
    this.events.emit('ride.completed', { rideId });
    void this.payments.rewardReferral(final.passenger_id, rideId).catch((e: Error) => this.logger.warn(`referral: ${e.message}`));
    void this.stats.refresh(driverId).catch(() => undefined);
    return { ride: await this.views.build(final, 'DRIVER'), payment };
  }

  async cancelByDriver(driverId: string, rideId: string, reason: string) {
    const ride = await this.driverRide(driverId, rideId);
    // A genuine no-show (driver waited at pickup) ends the ride and is not held against the driver.
    const waited = ride.arrived_at ? (Date.now() - ride.arrived_at.getTime()) / 1000 : 0;
    if (reason === 'PASSENGER_NO_SHOW' && ride.status === 'DRIVER_ARRIVED' && waited >= NO_SHOW_WAIT_S) {
      const cfg = await this.pricing.config(ride.city_id, ride.product_code);
      const updated = await this.db.tx(async (c) => {
        const r = await this.rides.transition(c, rideId, 'CANCELLED', 'SYSTEM', {
          actorId: driverId,
          eventType: 'passenger_no_show',
          set: { cancelled_at: new Date(), cancelled_by: 'SYSTEM', cancellation_reason: 'PASSENGER_NO_SHOW', cancellation_fee: cfg.cancellationFee },
          payload: { waitedS: Math.round(waited) },
        });
        await this.promotions.release(rideId, c);
        return r;
      });
      await this.payments.chargeCancellationFee(rideId, ride.passenger_id, driverId, ride.city_id, ride.product_code, cfg.cancellationFee);
      await this.afterCancel(updated, 'SYSTEM');
      return { status: 'CANCELLED', noShow: true };
    }
    if (reason === 'PASSENGER_NO_SHOW' && ride.status === 'DRIVER_ARRIVED') {
      throw AppError.unprocessable('WAIT_LONGER', `Please wait at least ${NO_SHOW_WAIT_S / 60} minutes after arriving before marking a no-show`, {
        secondsRemaining: Math.ceil(NO_SHOW_WAIT_S - waited),
      });
    }
    const updated = await this.db.tx((c) =>
      this.rides.transition(c, rideId, 'MATCHING', 'DRIVER', {
        actorId: driverId,
        eventType: 'driver_cancelled',
        set: {
          driver_id: null,
          vehicle_id: null,
          pin_code: null,
          assigned_at: null,
          arrived_at: null,
          carpool_group_id: null,
          predicted_pickup_eta_s: null,
          match_attempt: ride.match_attempt + 1,
          excluded_driver_ids: [...ride.excluded_driver_ids, driverId],
        },
        payload: { reason },
      }),
    );
    if (!(await this.presence.hasActiveRide(driverId))) await this.presence.setStatus(driverId, 'IDLE');
    // the cancelling driver must stop receiving this ride's room traffic (the next driver's live location)
    await this.realtime.removeUserFromRide(driverId, rideId);
    this.realtime.toUser(ride.passenger_id, 'ride.matching', {
      rideId,
      stage: 'driver_cancelled',
      message: 'Your driver had to cancel. We are finding you another driver at the same fare.',
      ride: await this.views.build(updated, 'PASSENGER'),
    });
    await this.notifications.notify({ userId: ride.passenger_id, type: 'RIDE_DRIVER_CANCELLED', title: 'Finding you another driver', body: 'Your driver had to cancel. You keep the same fare.', data: { rideId } });
    this.events.emit('ride.driver_cancelled', { rideId, driverId });
    await this.matching.start(rideId);
    void this.stats.refresh(driverId).catch(() => undefined);
    return { status: 'MATCHING', reassigned: true };
  }

  /** Admin/ops cancellation (human override), including rides in progress. */
  async cancelByAdmin(admin: AuthUser, rideId: string, reason: string) {
    const before = await this.rides.get(rideId);
    const ride = await this.db.tx(async (c) => {
      const r = await this.rides.transition(c, rideId, 'CANCELLED', 'ADMIN', {
        actorId: admin.id,
        set: { cancelled_at: new Date(), cancelled_by: 'ADMIN', cancellation_reason: reason },
        payload: { reason },
      });
      await this.promotions.release(rideId, c);
      return r;
    });
    await this.afterCancel(ride, 'ADMIN');
    return { id: ride.id, status: ride.status, previousStatus: before.status };
  }

  // ------------------------------------------------------------ location stream
  /**
   * GPS events arrive fire-and-forget. Handling two pings of the same driver at once makes the
   * route-deviation counter (read, update, write) lose updates and raise the same alert twice,
   * so each driver's pings are processed strictly one after another.
   */
  private enqueueLocation(driverId: string, job: () => Promise<void>): void {
    const tail = (this.locationChains.get(driverId) ?? Promise.resolve())
      .then(job)
      .catch((err: Error) => this.logger.error(`Location handling failed for driver ${driverId}: ${err.message}`));
    this.locationChains.set(driverId, tail);
    void tail.then(() => {
      if (this.locationChains.get(driverId) === tail) this.locationChains.delete(driverId);
    });
  }

  async onDriverLocation(driverId: string, rideIds: string[], point: LatLng, recordedAt: Date, speedMps?: number) {
    for (const rideId of rideIds) {
      let ride = await this.rides.find(rideId);
      if (!ride || ride.driver_id !== driverId) continue;
      if (ride.status === 'DRIVER_ASSIGNED') {
        try {
          ride = await this.db.tx((c) => this.rides.transition(c, rideId, 'DRIVER_ARRIVING', 'SYSTEM', { from: ['DRIVER_ASSIGNED'] }));
          await this.broadcast(ride, 'ride.driver_arriving');
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
        }
      }
      const phase = ride.status === 'IN_PROGRESS' ? 'ON_TRIP' : 'TO_PICKUP';
      const last = this.traceThrottle.get(rideId) ?? 0;
      if (phase === 'ON_TRIP' || Date.now() - last > 5000) {
        this.traceThrottle.set(rideId, Date.now());
        await this.db.query(
          `INSERT INTO ride_locations (ride_id, driver_id, phase, location, speed_mps, recorded_at)
           VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint($4,$5),4326)::geography, $6, $7)`,
          [rideId, driverId, phase, point.lng, point.lat, speedMps ?? null, recordedAt],
        );
      }
      const target = phase === 'ON_TRIP' ? ride.dropoff : ride.pickup;
      const remainingM = haversineM(point, target) * 1.3;
      const etaS = Math.round(remainingM / Math.max(4, speedMps && speedMps > 2 ? speedMps : 6));
      this.realtime.toRide(rideId, 'ride.location_updated', { rideId, lat: point.lat, lng: point.lng, phase, etaS, recordedAt });
      if (phase === 'ON_TRIP') await this.safety.checkLocation(ride, point);
    }
  }

  // ------------------------------------------------------------ ratings, history, receipts
  async rate(user: AuthUser, rideId: string, dto: RatingDto) {
    const ride = await this.rides.get(rideId);
    const role = ride.passenger_id === user.id ? 'PASSENGER' : ride.driver_id === user.id ? 'DRIVER' : null;
    if (!role) throw AppError.notFound('Ride', 'RIDE_NOT_FOUND');
    if (ride.status !== 'COMPLETED') throw AppError.conflict('RIDE_NOT_COMPLETED', 'You can rate a trip after it ends');
    if (ride.completed_at && Date.now() - ride.completed_at.getTime() > 7 * 86400_000) throw AppError.conflict('RATING_WINDOW_CLOSED', 'Ratings can be given within 7 days');
    const ratee = role === 'PASSENGER' ? ride.driver_id! : ride.passenger_id;
    try {
      await this.db.query(
        `INSERT INTO ratings (ride_id, rater_id, ratee_id, rater_role, stars, tags, comment) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [rideId, user.id, ratee, role, dto.stars, dto.tags ?? [], dto.comment?.trim() || null],
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw AppError.conflict('ALREADY_RATED', 'You have already rated this trip');
      throw err;
    }
    if (role === 'PASSENGER') {
      void this.stats.refresh(ratee).catch(() => undefined);
      if (dto.tags?.includes('FELT_UNSAFE')) {
        await this.db.query(
          `INSERT INTO safety_events (ride_id, user_id, type, severity, details) VALUES ($1,$2,'MANUAL_REPORT','HIGH',$3)`,
          [rideId, user.id, JSON.stringify({ source: 'rating', stars: dto.stars, comment: dto.comment ?? null })],
        );
        this.realtime.toOps('safety.alert', { rideId, type: 'MANUAL_REPORT', severity: 'HIGH' });
      }
    }
    return { rideId, stars: dto.stars, tags: dto.tags ?? [], role };
  }

  async history(user: AuthUser, q: RideHistoryQuery) {
    const as = q.as ?? (hasRole(user, 'DRIVER') && !hasRole(user, 'PASSENGER') ? 'DRIVER' : 'PASSENGER');
    const col = as === 'DRIVER' ? 'driver_id' : 'passenger_id';
    const statusFilter =
      q.status === 'ACTIVE'
        ? `AND status IN ('MATCHING','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS')`
        : q.status === 'COMPLETED'
          ? `AND status = 'COMPLETED'`
          : q.status === 'CANCELLED'
            ? `AND status IN ('CANCELLED','NO_DRIVERS')`
            : '';
    const [items, total] = await Promise.all([
      this.db.query(
        `SELECT r.id, r.status, r.product_code AS "productCode", r.mode, r.pickup_address AS "pickupAddress", r.dropoff_address AS "dropoffAddress",
                r.offered_fare AS "offeredFare", r.discount_amount AS discount, r.final_fare AS "finalFare", r.payment_method AS "paymentMethod",
                r.payment_status AS "paymentStatus", r.est_distance_m AS "distanceM", r.requested_at AS "requestedAt", r.completed_at AS "completedAt",
                r.cancelled_at AS "cancelledAt", r.corporate_id AS "corporateId",
                (SELECT stars FROM ratings WHERE ride_id = r.id AND rater_id = $1) AS "myRating"
           FROM rides r WHERE r.${col} = $1 ${statusFilter}
          ORDER BY r.requested_at DESC LIMIT $2 OFFSET $3`,
        [user.id, q.pageSize, offsetOf(q)],
      ),
      this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM rides WHERE ${col} = $1 ${statusFilter}`, [user.id]),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 };
  }

  async receipt(user: AuthUser, rideId: string) {
    const { ride, viewer } = await this.views.assertCanView(user, rideId);
    if (ride.status !== 'COMPLETED' && ride.cancellation_fee === 0) throw AppError.conflict('NO_RECEIPT', 'A receipt is available after the trip is completed');
    const payments = await this.db.query(
      `SELECT id, purpose, method, provider, amount, status, failure_reason AS "failureReason", created_at AS "createdAt" FROM payments WHERE ride_id = $1 ORDER BY created_at`,
      [rideId],
    );
    const quote = ride.quote_id ? await this.db.one<{ options: { options: QuoteOption[] } }>(`SELECT options FROM ride_quotes WHERE id = $1`, [ride.quote_id]) : null;
    const opt = quote?.options.options.find((o) => o.productCode === ride.product_code);
    return {
      rideId,
      viewer,
      productCode: ride.product_code,
      pickupAddress: ride.pickup_address,
      dropoffAddress: ride.dropoff_address,
      startedAt: ride.started_at,
      completedAt: ride.completed_at,
      distanceM: ride.actual_distance_m ?? ride.est_distance_m,
      fare: {
        breakdown: opt?.fare.breakdown ?? null,
        recommended: ride.recommended_fare,
        agreed: ride.offered_fare,
        discount: ride.discount_amount,
        charged: ride.final_fare ?? ride.offered_fare - ride.discount_amount,
        cancellationFee: ride.cancellation_fee,
        currency: ride.currency,
        explanation: opt?.fare.explanation ?? [],
      },
      paymentMethod: ride.payment_method,
      paymentStatus: ride.payment_status,
      payments,
    };
  }

  async events_(user: AuthUser, rideId: string) {
    await this.views.assertCanView(user, rideId);
    return this.rides.events(rideId);
  }

  async active(user: AuthUser) {
    const ride = await this.rides.activeForPassenger(user.id);
    return ride ? this.views.build(ride, 'PASSENGER') : null;
  }

  async activeForDriver(driverId: string) {
    const rides = await this.rides.activeForDriver(driverId);
    return Promise.all(rides.map((r) => this.views.build(r, 'DRIVER')));
  }

  private async broadcast(ride: RideRow, event: 'ride.driver_arriving' | 'ride.driver_arrived' | 'ride.started' | 'ride.completed', extra: Record<string, unknown> = {}) {
    const [pv, dv] = await Promise.all([this.views.build(ride, 'PASSENGER'), this.views.build(ride, 'DRIVER')]);
    this.realtime.toUser(ride.passenger_id, event, { ride: pv, ...extra });
    if (ride.driver_id) this.realtime.toUser(ride.driver_id, event, { ride: dv, ...extra });
    this.realtime.toOps(event, { rideId: ride.id, status: ride.status });
  }
}
