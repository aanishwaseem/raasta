import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { RedisService } from '../../common/redis/redis.service';
import { AuditService } from '../../common/audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { offsetOf, PageQuery } from '../../common/dto';
import type { AuthUser } from '../../common/auth/auth.types';
import type { RequestMeta } from '../../common/auth/decorators';
import { StorageProvider } from '../../common/providers/storage';
import { QueueService } from '../../common/queue/queue.service';
import { AuthService } from '../auth/auth.service';
import { config } from '../../config/config';
import { AiClient } from '../ai/ai.client';
import { DriverPresenceService } from '../drivers/driver-presence.service';
import { DriverStatsService } from '../drivers/driver-stats.service';
import { OnboardingService } from '../drivers/onboarding.service';
import { GeoService } from '../geo/geo.service';
import { PricingService } from '../pricing/pricing.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RideViewService } from '../rides/ride-view.service';
import { RideRepository } from '../rides/ride.repository';
import { RidesService } from '../rides/rides.service';
import { PromotionDto, PromotionPatchDto, PricingUpdateDto, RideListQuery, UserListQuery, DriverListQuery, CorporateAccountDto, CorporateAccountPatchDto, AuditQuery } from './dto/admin.dto';

type Meta = RequestMeta | undefined;
const ACTIVE = `('MATCHING','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS')`;

@Injectable()
export class AdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly ai: AiClient,
    private readonly presence: DriverPresenceService,
    private readonly stats: DriverStatsService,
    private readonly onboarding: OnboardingService,
    private readonly geo: GeoService,
    private readonly pricing: PricingService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageProvider,
    private readonly queue: QueueService,
    private readonly views: RideViewService,
    private readonly rideRepo: RideRepository,
    private readonly rides_: RidesService,
  ) {}

  /** Human override: staff can cancel any non-terminal ride. Audited with a mandatory reason. */
  async cancelRide(admin: AuthUser, id: string, reason: string, meta: Meta) {
    const r = await this.rides_.cancelByAdmin(admin, id, reason);
    await this.audit.log({ actor: admin, action: 'ride.cancel', entityType: 'ride', entityId: id, after: r, reason, meta });
    return r;
  }

  // ------------------------------------------------------------------ users
  async users(q: UserListQuery) {
    const like = q.q ? `%${q.q.toLowerCase()}%` : null;
    const where = `($1::text IS NULL OR lower(u.full_name) LIKE $1 OR lower(u.email) LIKE $1 OR u.phone LIKE $1) AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = $2)) AND ($3::text IS NULL OR u.status = $3)`;
    const [items, total] = await Promise.all([
      this.db.query(
        `SELECT u.id, u.full_name AS "fullName", u.email, u.phone, u.status, u.is_test_data AS "isTestData", u.created_at AS "createdAt",
                (SELECT array_agg(role) FROM user_roles r WHERE r.user_id = u.id) AS roles
           FROM users u WHERE ${where} ORDER BY u.created_at DESC LIMIT $4 OFFSET $5`,
        [like, q.role ?? null, q.status ?? null, q.pageSize, offsetOf(q)],
      ),
      this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM users u WHERE ${where}`, [like, q.role ?? null, q.status ?? null]),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 };
  }

  async user(id: string) {
    const u = await this.db.one(
      `SELECT u.id, u.full_name AS "fullName", u.email, u.phone, u.status, u.suspended_reason AS "suspendedReason", u.gender, u.is_test_data AS "isTestData", u.created_at AS "createdAt",
              (SELECT array_agg(role) FROM user_roles r WHERE r.user_id = u.id) AS roles,
              (SELECT count(*) FROM rides WHERE passenger_id = u.id)::int AS "ridesAsPassenger",
              (SELECT count(*) FROM rides WHERE driver_id = u.id)::int AS "ridesAsDriver",
              (SELECT count(*) FROM rides WHERE passenger_id = u.id AND status = 'CANCELLED' AND cancelled_by = 'PASSENGER')::int AS "passengerCancellations"
         FROM users u WHERE u.id = $1`,
      [id],
    );
    if (!u) throw AppError.notFound('User');
    return u;
  }

  async setUserStatus(admin: AuthUser, id: string, suspend: boolean, reason: string, meta: Meta) {
    if (id === admin.id) throw AppError.conflict('CANNOT_ACT_ON_SELF', 'You cannot change your own account status');
    const before = await this.db.one<{ status: string }>(`SELECT status FROM users WHERE id = $1`, [id]);
    if (!before || before.status === 'DELETED') throw AppError.notFound('User');
    if (suspend) {
      const active = await this.db.one(`SELECT 1 FROM rides WHERE (passenger_id = $1 OR driver_id = $1) AND status IN ${ACTIVE} LIMIT 1`, [id]);
      if (active) throw AppError.conflict('ACTIVE_RIDE_EXISTS', 'This user has a ride in progress. Resolve or cancel it first.');
    }
    await this.db.query(`UPDATE users SET status = $2, suspended_reason = $3 WHERE id = $1`, [id, suspend ? 'SUSPENDED' : 'ACTIVE', suspend ? reason : null]);
    if (suspend) {
      await this.presence.goOffline(id, { force: true }).catch(() => undefined);
      await this.auth.revokeAllForUser(id, 'admin_suspended');
    }
    await this.audit.log({ actor: admin, action: suspend ? 'user.suspend' : 'user.reinstate', entityType: 'user', entityId: id, before, after: { status: suspend ? 'SUSPENDED' : 'ACTIVE' }, reason, meta });
    return { id, status: suspend ? 'SUSPENDED' : 'ACTIVE' };
  }

  // ------------------------------------------------------------------ drivers
  async drivers(q: DriverListQuery) {
    const like = q.q ? `%${q.q.toLowerCase()}%` : null;
    const where = `($1::text IS NULL OR d.status = $1) AND ($2::text IS NULL OR lower(u.full_name) LIKE $2 OR u.phone LIKE $2)`;
    const [items, total] = await Promise.all([
      this.db.query(
        `SELECT d.user_id AS id, u.full_name AS "fullName", u.phone, d.status, d.onboarding_step AS "onboardingStep", c.name AS city, d.created_at AS "createdAt", d.is_test_data AS "isTestData",
                (SELECT count(*) FROM driver_documents dd WHERE dd.driver_id = d.user_id AND dd.status = 'PENDING')::int AS "pendingDocuments",
                v.make || ' ' || v.model AS vehicle
           FROM drivers d JOIN users u ON u.id = d.user_id LEFT JOIN cities c ON c.id = d.city_id LEFT JOIN vehicles v ON v.id = d.current_vehicle_id
          WHERE ${where} ORDER BY (d.status = 'PENDING_REVIEW') DESC, d.created_at DESC LIMIT $3 OFFSET $4`,
        [q.status ?? null, like, q.pageSize, offsetOf(q)],
      ),
      this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM drivers d JOIN users u ON u.id = d.user_id WHERE ${where}`, [q.status ?? null, like]),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 };
  }

  /** Staff view of a driver. The reliability score is internal, so it appears here and never in passenger or driver responses. */
  async driver(id: string) {
    const profile = await this.onboarding.profile(id);
    const [stats, docs] = await Promise.all([this.stats.get(id), this.onboarding.documents(id)]);
    return { ...profile, documents: docs, internalStats: stats };
  }

  async reviewDocument(admin: AuthUser, docId: string, decision: 'APPROVED' | 'REJECTED', reason: string, meta: Meta) {
    const before = await this.db.one<{ status: string; driver_id: string; doc_type: string }>(`SELECT status, driver_id, doc_type FROM driver_documents WHERE id = $1`, [docId]);
    if (!before) throw AppError.notFound('Document');
    await this.db.query(`UPDATE driver_documents SET status = $2, rejection_reason = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1`, [docId, decision, decision === 'REJECTED' ? reason : null, admin.id]);
    await this.audit.log({ actor: admin, action: 'driver.document.review', entityType: 'driver_document', entityId: docId, before, after: { decision }, reason, meta });
    if (decision === 'REJECTED') {
      await this.notifications.notify({ userId: before.driver_id, type: 'DOCUMENT_REJECTED', title: 'A document needs attention', body: `${before.doc_type.replace(/_/g, ' ').toLowerCase()}: ${reason}`, data: { documentId: docId } });
    }
    return { id: docId, status: decision };
  }

  async documentFile(admin: AuthUser, docId: string, meta: Meta) {
    const d = await this.db.one<{ storage_key: string; content_type: string; driver_id: string }>(`SELECT storage_key, content_type, driver_id FROM driver_documents WHERE id = $1`, [docId]);
    if (!d) throw AppError.notFound('Document');
    await this.audit.log({ actor: admin, action: 'driver.document.view', entityType: 'driver_document', entityId: docId, meta });
    return { buffer: await this.storage.get(d.storage_key), contentType: d.content_type };
  }

  async reviewVehicle(admin: AuthUser, vehicleId: string, decision: 'APPROVED' | 'REJECTED', reason: string, meta: Meta) {
    const before = await this.db.one<{ status: string; driver_id: string }>(`SELECT status, driver_id FROM vehicles WHERE id = $1`, [vehicleId]);
    if (!before) throw AppError.notFound('Vehicle');
    await this.db.query(`UPDATE vehicles SET status = $2 WHERE id = $1`, [vehicleId, decision]);
    await this.audit.log({ actor: admin, action: 'vehicle.review', entityType: 'vehicle', entityId: vehicleId, before, after: { decision }, reason, meta });
    return { id: vehicleId, status: decision };
  }

  /**
   * Approval is a human decision. The platform does not verify identity with any government database, so every
   * personal and vehicle document must have been reviewed and approved by staff first.
   */
  async approveDriver(admin: AuthUser, id: string, reason: string, meta: Meta) {
    const d = await this.db.one<{ status: string }>(`SELECT status FROM drivers WHERE user_id = $1`, [id]);
    if (!d) throw AppError.notFound('Driver');
    if (d.status !== 'PENDING_REVIEW') throw AppError.conflict('NOT_PENDING_REVIEW', 'Only applications under review can be approved');
    const checklist = await this.onboarding.checklist(id);
    const open = checklist.filter((c) => !['REVIEW', 'TRAINING'].includes(c.key) && !['DONE', 'APPROVED'].includes(c.status));
    if (open.length) throw AppError.unprocessable('REVIEW_INCOMPLETE', 'Approve or reject every document and the vehicle first', { open: open.map((o) => o.key) });
    await this.db.query(`UPDATE drivers SET status = 'APPROVED', onboarding_step = 'TRAINING', approved_at = now(), approved_by = $2, review_notes = NULL WHERE user_id = $1`, [id, admin.id]);
    await this.audit.log({ actor: admin, action: 'driver.approve', entityType: 'driver', entityId: id, before: d, after: { status: 'APPROVED' }, reason, meta });
    await this.notifications.notify({ userId: id, type: 'DRIVER_APPROVED', title: 'You are approved!', body: 'Complete the short safety guidelines to start driving.', data: {} });
    return { id, status: 'APPROVED' };
  }

  async rejectDriver(admin: AuthUser, id: string, reason: string, meta: Meta) {
    const d = await this.db.one<{ status: string }>(`SELECT status FROM drivers WHERE user_id = $1`, [id]);
    if (!d) throw AppError.notFound('Driver');
    if (d.status !== 'PENDING_REVIEW') throw AppError.conflict('NOT_PENDING_REVIEW', 'Only applications under review can be rejected');
    await this.db.query(`UPDATE drivers SET status = 'REJECTED', review_notes = $2, onboarding_step = 'DOCUMENTS' WHERE user_id = $1`, [id, reason]);
    await this.audit.log({ actor: admin, action: 'driver.reject', entityType: 'driver', entityId: id, before: d, after: { status: 'REJECTED' }, reason, meta });
    await this.notifications.notify({ userId: id, type: 'DRIVER_REJECTED', title: 'Your application needs changes', body: reason, data: {} });
    return { id, status: 'REJECTED' };
  }

  async setDriverSuspended(admin: AuthUser, id: string, suspend: boolean, reason: string, meta: Meta) {
    const d = await this.db.one<{ status: string }>(`SELECT status FROM drivers WHERE user_id = $1`, [id]);
    if (!d) throw AppError.notFound('Driver');
    if (suspend) {
      const active = await this.db.one(`SELECT 1 FROM rides WHERE driver_id = $1 AND status IN ${ACTIVE} LIMIT 1`, [id]);
      if (active) throw AppError.conflict('ACTIVE_RIDE_EXISTS', 'This driver has a ride in progress. Resolve it first.');
      await this.presence.goOffline(id, { force: true }).catch(() => undefined);
    } else if (d.status !== 'SUSPENDED') throw AppError.conflict('NOT_SUSPENDED', 'This driver is not suspended');
    await this.db.query(`UPDATE drivers SET status = $2 WHERE user_id = $1`, [id, suspend ? 'SUSPENDED' : 'APPROVED']);
    await this.audit.log({ actor: admin, action: suspend ? 'driver.suspend' : 'driver.reinstate', entityType: 'driver', entityId: id, before: d, after: { status: suspend ? 'SUSPENDED' : 'APPROVED' }, reason, meta });
    return { id, status: suspend ? 'SUSPENDED' : 'APPROVED' };
  }

  // ------------------------------------------------------------------ rides, live map
  async rides(q: RideListQuery) {
    const like = q.q ? `%${q.q.toLowerCase()}%` : null;
    const from = q.from ? new Date(q.from) : null;
    const to = q.to ? new Date(q.to) : null;
    const where = `($1::text IS NULL OR r.status = $1) AND ($2::uuid IS NULL OR r.city_id = $2) AND ($3::timestamptz IS NULL OR r.requested_at >= $3) AND ($4::timestamptz IS NULL OR r.requested_at < $4)
                   AND ($5::text IS NULL OR r.id::text LIKE $5 OR lower(pu.full_name) LIKE $5 OR lower(r.pickup_address) LIKE $5 OR lower(r.dropoff_address) LIKE $5)`;
    const args = [q.status ?? null, q.cityId ?? null, from, to, like];
    const [items, total] = await Promise.all([
      this.db.query(
        `SELECT r.id, r.status, r.product_code AS "productCode", r.mode, pu.full_name AS "passengerName", du.full_name AS "driverName", r.pickup_address AS "pickupAddress", r.dropoff_address AS "dropoffAddress",
                r.offered_fare AS "offeredFare", r.final_fare AS "finalFare", r.payment_method AS "paymentMethod", r.payment_status AS "paymentStatus", r.requested_at AS "requestedAt",
                r.completed_at AS "completedAt", r.is_test_data AS "isTestData"
           FROM rides r JOIN users pu ON pu.id = r.passenger_id LEFT JOIN users du ON du.id = r.driver_id WHERE ${where} ORDER BY r.requested_at DESC LIMIT $6 OFFSET $7`,
        [...args, q.pageSize, offsetOf(q)],
      ),
      this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM rides r JOIN users pu ON pu.id = r.passenger_id WHERE ${where}`, args),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 };
  }

  async ride(id: string) {
    const ride = await this.rideRepo.get(id);
    const view = await this.views.build(ride, 'STAFF');
    const [events, offers, payments, locations, safety] = await Promise.all([
      this.rideRepo.events(id),
      this.db.query(`SELECT driver_id AS "driverId", attempt, rank, score::float AS score, status, pickup_eta_s AS "pickupEtaS", score_breakdown AS "scoreBreakdown", created_at AS "createdAt" FROM ride_requests WHERE ride_id = $1 ORDER BY attempt, rank`, [id]),
      this.db.query(`SELECT id, purpose, method, provider, amount, status, failure_reason AS "failureReason", created_at AS "createdAt" FROM payments WHERE ride_id = $1 ORDER BY created_at`, [id]),
      this.db.query(`SELECT phase, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, recorded_at AS "recordedAt" FROM ride_locations WHERE ride_id = $1 ORDER BY recorded_at LIMIT 1000`, [id]),
      this.db.query(`SELECT id, type, severity, status, created_at AS "createdAt" FROM safety_events WHERE ride_id = $1 ORDER BY created_at`, [id]),
    ]);
    return { ride: view, events, matchingOffers: offers, payments, trace: locations, safetyEvents: safety };
  }

  async liveMap(cityId?: string) {
    const cities = cityId ? [{ id: cityId }] : await this.db.query<{ id: string }>(`SELECT id FROM cities WHERE active`);
    const drivers = (await Promise.all(cities.map((c) => this.presence.onlineInCity(c.id)))).flat();
    const [rides, safety] = await Promise.all([
      this.db.query(
        `SELECT id, status, city_id AS "cityId", product_code AS "productCode", ST_Y(pickup::geometry) AS "pickupLat", ST_X(pickup::geometry) AS "pickupLng",
                ST_Y(dropoff::geometry) AS "dropoffLat", ST_X(dropoff::geometry) AS "dropoffLng", driver_id AS "driverId", requested_at AS "requestedAt"
           FROM rides WHERE status IN ${ACTIVE} AND ($1::uuid IS NULL OR city_id = $1)`,
        [cityId ?? null],
      ),
      this.db.query(`SELECT id, ride_id AS "rideId", type, severity, status, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, created_at AS "createdAt" FROM safety_events WHERE status IN ('OPEN','ESCALATED') AND location IS NOT NULL`),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      drivers: drivers.map((d) => ({ id: d.driverId, cityId: d.cityId, lat: d.lat, lng: d.lng, status: d.status, vehicleClass: d.vehicleClass, heading: d.heading })),
      rides,
      safetyEvents: safety,
    };
  }

  // ------------------------------------------------------------------ money
  async payments(q: PageQuery & { status?: string; method?: string }) {
    const where = `($1::text IS NULL OR p.status = $1) AND ($2::text IS NULL OR p.method = $2)`;
    const [items, total] = await Promise.all([
      this.db.query(
        `SELECT p.id, p.ride_id AS "rideId", p.purpose, p.method, p.provider, p.amount, p.status, p.failure_reason AS "failureReason", p.created_at AS "createdAt" FROM payments p WHERE ${where} ORDER BY p.created_at DESC LIMIT $3 OFFSET $4`,
        [q.status ?? null, q.method ?? null, q.pageSize, offsetOf(q)],
      ),
      this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM payments p WHERE ${where}`, [q.status ?? null, q.method ?? null]),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 };
  }

  async withdrawals(q: PageQuery & { status?: string }) {
    const items = await this.db.query(
      `SELECT w.id, w.driver_id AS "driverId", u.full_name AS "driverName", w.amount, w.destination, w.status, w.created_at AS "createdAt", w.processed_at AS "processedAt"
         FROM withdrawals w JOIN users u ON u.id = w.driver_id WHERE ($1::text IS NULL OR w.status = $1) ORDER BY (w.status = 'REQUESTED') DESC, w.created_at DESC LIMIT $2 OFFSET $3`,
      [q.status ?? null, q.pageSize, offsetOf(q)],
    );
    return { items, page: q.page, pageSize: q.pageSize, total: items.length };
  }

  async promotions() {
    return this.db.query(
      `SELECT p.id, p.code, p.name, p.kind, p.discount_type AS "discountType", p.discount_value AS "discountValue", p.max_discount AS "maxDiscount", p.min_fare AS "minFare",
              p.starts_at AS "startsAt", p.ends_at AS "endsAt", p.usage_limit_total AS "usageLimitTotal", p.usage_limit_per_user AS "usageLimitPerUser", p.new_users_only AS "newUsersOnly", p.active,
              (SELECT count(*) FROM promotion_redemptions r WHERE r.promotion_id = p.id AND r.status <> 'RELEASED')::int AS redemptions
         FROM promotions p ORDER BY p.created_at DESC`,
    );
  }

  async createPromotion(admin: AuthUser, dto: PromotionDto, meta: Meta) {
    if (new Date(dto.endsAt) <= new Date(dto.startsAt)) throw new AppError('VALIDATION_FAILED', 'endsAt must be after startsAt');
    if (dto.discountType === 'PERCENT' && dto.discountValue > 100) throw new AppError('VALIDATION_FAILED', 'A percentage discount cannot exceed 100');
    const exists = await this.db.one(`SELECT 1 FROM promotions WHERE code = $1 AND active`, [dto.code]);
    if (exists) throw AppError.conflict('PROMO_CODE_EXISTS', 'An active promotion already uses this code');
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO promotions (code, name, kind, discount_type, discount_value, max_discount, min_fare, starts_at, ends_at, usage_limit_total, usage_limit_per_user, city_ids, product_codes, new_users_only, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [dto.code, dto.name, dto.kind, dto.discountType, dto.discountValue, dto.maxDiscount ?? null, dto.minFare ?? 0, dto.startsAt, dto.endsAt, dto.usageLimitTotal ?? null, dto.usageLimitPerUser ?? 1, dto.cityIds ?? [], dto.productCodes ?? [], dto.newUsersOnly ?? false, admin.id],
    );
    await this.audit.log({ actor: admin, action: 'promotion.create', entityType: 'promotion', entityId: row!.id, after: dto, meta });
    return { id: row!.id };
  }

  async patchPromotion(admin: AuthUser, id: string, dto: PromotionPatchDto, meta: Meta) {
    const before = await this.db.one(`SELECT active, ends_at, usage_limit_total FROM promotions WHERE id = $1`, [id]);
    if (!before) throw AppError.notFound('Promotion');
    await this.db.query(`UPDATE promotions SET active = COALESCE($2, active), ends_at = COALESCE($3, ends_at), usage_limit_total = COALESCE($4, usage_limit_total) WHERE id = $1`, [id, dto.active ?? null, dto.endsAt ?? null, dto.usageLimitTotal ?? null]);
    await this.audit.log({ actor: admin, action: 'promotion.update', entityType: 'promotion', entityId: id, before, after: dto, meta });
    return { id, ...dto };
  }

  async pricingConfigs() {
    return this.db.query(
      `SELECT pc.id, c.name AS city, pc.city_id AS "cityId", pc.product_code AS "productCode", pc.base_fare AS "baseFare", pc.per_km::float AS "perKm", pc.per_minute::float AS "perMinute",
              pc.minimum_fare AS "minimumFare", pc.booking_fee AS "bookingFee", pc.platform_fee_pct::float AS "platformFeePct", pc.fuel_cost_per_km::float AS "fuelCostPerKm",
              pc.max_surge_multiplier::float AS "maxSurgeMultiplier", pc.min_offer_pct::float AS "minOfferPct", pc.shared_discount_pct::float AS "sharedDiscountPct",
              pc.cancellation_fee AS "cancellationFee", pc.free_cancel_seconds AS "freeCancelSeconds", pc.updated_at AS "updatedAt"
         FROM pricing_configs pc JOIN cities c ON c.id = pc.city_id ORDER BY c.name, pc.product_code`,
    );
  }

  async updatePricing(admin: AuthUser, id: string, dto: PricingUpdateDto, meta: Meta) {
    const before = await this.db.one(`SELECT * FROM pricing_configs WHERE id = $1`, [id]);
    if (!before) throw AppError.notFound('Pricing config');
    await this.db.query(
      `UPDATE pricing_configs SET base_fare=$2, per_km=$3, per_minute=$4, minimum_fare=$5, booking_fee=$6, platform_fee_pct=$7, fuel_cost_per_km=$8, max_surge_multiplier=$9,
              min_offer_pct=$10, shared_discount_pct=$11, cancellation_fee=$12, free_cancel_seconds=$13, updated_by=$14 WHERE id=$1`,
      [id, dto.baseFare, dto.perKm, dto.perMinute, dto.minimumFare, dto.bookingFee, dto.platformFeePct, dto.fuelCostPerKm, dto.maxSurgeMultiplier, dto.minOfferPct, dto.sharedDiscountPct, dto.cancellationFee, dto.freeCancelSeconds, admin.id],
    );
    this.pricing.invalidateCache();
    const { reason, ...after } = dto;
    await this.audit.log({ actor: admin, action: 'pricing.update', entityType: 'pricing_config', entityId: id, before, after, reason, meta });
    return { id, ...after };
  }

  // ------------------------------------------------------------------ geography
  cities() {
    return this.db.query(`SELECT id, slug, name, name_ur AS "nameUr", ST_Y(center::geometry) AS lat, ST_X(center::geometry) AS lng, active, settings FROM cities ORDER BY name`);
  }
  async createCity(admin: AuthUser, dto: { slug: string; name: string; nameUr?: string; lat: number; lng: number }, meta: Meta) {
    const row = await this.db.one<{ id: string }>(`INSERT INTO cities (slug, name, name_ur, center) VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint($5,$4),4326)::geography) RETURNING id`, [dto.slug, dto.name, dto.nameUr ?? null, dto.lat, dto.lng]);
    await this.audit.log({ actor: admin, action: 'city.create', entityType: 'city', entityId: row!.id, after: dto, meta });
    this.geo.invalidateCache();
    return { id: row!.id };
  }
  async patchCity(admin: AuthUser, id: string, dto: { active?: boolean; name?: string }, meta: Meta) {
    const before = await this.db.one(`SELECT active, name FROM cities WHERE id = $1`, [id]);
    if (!before) throw AppError.notFound('City');
    await this.db.query(`UPDATE cities SET active = COALESCE($2, active), name = COALESCE($3, name) WHERE id = $1`, [id, dto.active ?? null, dto.name ?? null]);
    await this.audit.log({ actor: admin, action: 'city.update', entityType: 'city', entityId: id, before, after: dto, meta });
    this.geo.invalidateCache();
    return { id, ...dto };
  }
  zones(cityId?: string) {
    return this.db.query(`SELECT id, city_id AS "cityId", code, name, active, ST_AsGeoJSON(boundary)::json AS boundary FROM demand_zones WHERE ($1::uuid IS NULL OR city_id = $1) ORDER BY name`, [cityId ?? null]);
  }
  async createZone(admin: AuthUser, dto: { cityId: string; code: string; name: string; polygon: number[][] }, meta: Meta) {
    const ring = closeRing(dto.polygon);
    const wkt = `SRID=4326;POLYGON((${ring.map(([lng, lat]) => `${lng} ${lat}`).join(',')}))`;
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO demand_zones (city_id, code, name, boundary, centroid) VALUES ($1,$2,$3, ST_GeogFromText($4), ST_Centroid(ST_GeomFromText($5, 4326))::geography) RETURNING id`,
      [dto.cityId, dto.code, dto.name, wkt, wkt.replace('SRID=4326;', '')],
    );
    await this.audit.log({ actor: admin, action: 'zone.create', entityType: 'demand_zone', entityId: row!.id, after: dto, meta });
    return { id: row!.id };
  }
  async patchZone(admin: AuthUser, id: string, dto: { active?: boolean; name?: string }, meta: Meta) {
    const r = await this.db.one(`UPDATE demand_zones SET active = COALESCE($2, active), name = COALESCE($3, name) WHERE id = $1 RETURNING id`, [id, dto.active ?? null, dto.name ?? null]);
    if (!r) throw AppError.notFound('Zone');
    await this.audit.log({ actor: admin, action: 'zone.update', entityType: 'demand_zone', entityId: id, after: dto, meta });
    return { id, ...dto };
  }
  serviceAreas(cityId?: string) {
    return this.db.query(`SELECT id, city_id AS "cityId", name, kind, active, ST_AsGeoJSON(boundary)::json AS boundary FROM service_areas WHERE ($1::uuid IS NULL OR city_id = $1) ORDER BY name`, [cityId ?? null]);
  }
  async createServiceArea(admin: AuthUser, dto: { cityId: string; name: string; kind: 'SERVICE' | 'AIRPORT' | 'RESTRICTED'; polygon: number[][] }, meta: Meta) {
    const ring = closeRing(dto.polygon);
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO service_areas (city_id, name, kind, boundary) VALUES ($1,$2,$3, ST_GeogFromText($4)) RETURNING id`,
      [dto.cityId, dto.name, dto.kind, `SRID=4326;POLYGON((${ring.map(([lng, lat]) => `${lng} ${lat}`).join(',')}))`],
    );
    await this.audit.log({ actor: admin, action: 'service_area.create', entityType: 'service_area', entityId: row!.id, after: dto, meta });
    this.geo.invalidateCache();
    return { id: row!.id };
  }
  async patchServiceArea(admin: AuthUser, id: string, dto: { active?: boolean }, meta: Meta) {
    const r = await this.db.one(`UPDATE service_areas SET active = COALESCE($2, active) WHERE id = $1 RETURNING id`, [id, dto.active ?? null]);
    if (!r) throw AppError.notFound('Service area');
    await this.audit.log({ actor: admin, action: 'service_area.update', entityType: 'service_area', entityId: id, after: dto, meta });
    this.geo.invalidateCache();
    return { id, ...dto };
  }

  // ------------------------------------------------------------------ corporate accounts
  corporateAccounts() {
    return this.db.query(
      `SELECT ca.id, ca.name, ca.industry, ca.billing_email AS "billingEmail", ca.monthly_budget AS "monthlyBudget", ca.status, ca.is_test_data AS "isTestData",
              (SELECT count(*) FROM corporate_users cu WHERE cu.corporate_id = ca.id AND cu.active)::int AS employees FROM corporate_accounts ca ORDER BY ca.created_at DESC`,
    );
  }
  async createCorporateAccount(admin: AuthUser, dto: CorporateAccountDto, meta: Meta) {
    const adminUser = await this.db.one<{ id: string }>(`SELECT id FROM users WHERE lower(email) = lower($1) AND status = 'ACTIVE'`, [dto.adminEmail]);
    if (!adminUser) throw AppError.notFound('User', 'ADMIN_USER_NOT_FOUND');
    const id = await this.db.tx(async (c) => {
      const a = await c.query<{ id: string }>(`INSERT INTO corporate_accounts (name, industry, billing_email, city_id, monthly_budget) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [dto.name, dto.industry, dto.billingEmail, dto.cityId ?? null, dto.monthlyBudget ?? 0]);
      await c.query(`INSERT INTO corporate_policies (corporate_id) VALUES ($1)`, [a.rows[0].id]);
      await c.query(`INSERT INTO corporate_users (corporate_id, user_id, role) VALUES ($1,$2,'ADMIN')`, [a.rows[0].id, adminUser.id]);
      await c.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,'CORPORATE_ADMIN') ON CONFLICT DO NOTHING`, [adminUser.id]);
      return a.rows[0].id;
    });
    await this.audit.log({ actor: admin, action: 'corporate.create', entityType: 'corporate_account', entityId: id, after: dto, meta });
    return { id };
  }
  async patchCorporateAccount(admin: AuthUser, id: string, dto: CorporateAccountPatchDto, meta: Meta) {
    const before = await this.db.one(`SELECT status, monthly_budget FROM corporate_accounts WHERE id = $1`, [id]);
    if (!before) throw AppError.notFound('Corporate account');
    await this.db.query(`UPDATE corporate_accounts SET status = COALESCE($2, status), monthly_budget = COALESCE($3, monthly_budget) WHERE id = $1`, [id, dto.status ?? null, dto.monthlyBudget ?? null]);
    await this.audit.log({ actor: admin, action: 'corporate.update', entityType: 'corporate_account', entityId: id, before, after: dto, reason: dto.reason, meta });
    return { id };
  }

  // ------------------------------------------------------------------ AI operations
  async aiModels() {
    const [registry, live] = await Promise.all([
      this.db.query(
        `SELECT id, model_name AS name, version, algorithm, status, training_date AS "trainingDate", features, metrics, baseline_metrics AS "baselineMetrics", dataset_version AS "datasetVersion",
                dataset_rows AS "datasetRows", trained_on_synthetic AS "trainedOnSynthetic", notes FROM model_versions ORDER BY model_name, training_date DESC`,
      ),
      this.ai.models(),
    ]);
    return { registry, serving: live ?? { available: false, note: 'AI service unreachable: the backend is using built-in fallbacks.' } };
  }
  async trainModels(admin: AuthUser, models: string[], meta: Meta) {
    const result = await this.ai.train(models);
    await this.audit.log({ actor: admin, action: 'ai.train', entityType: 'model', after: { models }, meta });
    return result ?? { started: false, note: 'AI service unreachable' };
  }
  async activateModel(admin: AuthUser, id: string, reason: string, meta: Meta) {
    const m = await this.db.one<{ model_name: string; status: string; version: string; trained_on_synthetic: boolean }>(`SELECT model_name, status, version, trained_on_synthetic FROM model_versions WHERE id = $1`, [id]);
    if (!m) throw AppError.notFound('Model version');
    if (m.status === 'REJECTED') throw AppError.conflict('MODEL_REJECTED', 'This candidate did not beat the baseline and cannot be activated');
    if (m.trained_on_synthetic && config().NODE_ENV === 'production') throw AppError.conflict('MODEL_SYNTHETIC', 'This model was trained on simulated data and cannot be activated in production');
    await this.db.tx(async (c) => {
      await c.query(`UPDATE model_versions SET status = 'RETIRED' WHERE model_name = $1 AND status = 'ACTIVE'`, [m.model_name]);
      await c.query(`UPDATE model_versions SET status = 'ACTIVE' WHERE id = $1`, [id]);
    });
    await this.ai.reloadModels();
    await this.audit.log({ actor: admin, action: 'ai.activate', entityType: 'model_version', entityId: id, before: m, after: { status: 'ACTIVE' }, reason, meta });
    return { id, status: 'ACTIVE' };
  }

  // ------------------------------------------------------------------ system
  async systemHealth() {
    const [db, redis, ai, queues, migrations] = await Promise.all([
      this.db.ping().catch(() => false),
      this.redis.ping().catch(() => false),
      this.ai.health().catch(() => false),
      this.queue.stats().catch(() => ({})),
      this.db.one<{ n: number; last: string }>(`SELECT count(*)::int AS n, max(filename) AS last FROM schema_migrations`).catch(() => null),
    ]);
    return { postgres: db, redis, aiService: ai, queues, migrations, uptimeS: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576), node: process.version };
  }

  async auditLogs(q: AuditQuery) {
    const where = `($1::text IS NULL OR a.action = $1) AND ($2::text IS NULL OR a.entity_type = $2) AND ($3::uuid IS NULL OR a.actor_id = $3)`;
    const args = [q.action ?? null, q.entityType ?? null, q.actorId ?? null];
    const [items, total] = await Promise.all([
      this.db.query(
        `SELECT a.id, a.actor_id AS "actorId", u.full_name AS "actorName", a.action, a.entity_type AS "entityType", a.entity_id AS "entityId", a.before, a.after, a.reason, a.request_id AS "requestId", a.created_at AS "createdAt"
           FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE ${where} ORDER BY a.id DESC LIMIT $4 OFFSET $5`,
        [...args, q.pageSize, offsetOf(q)],
      ),
      this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs a WHERE ${where}`, args),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 };
  }
}

function closeRing(points: number[][]): number[][] {
  if (!Array.isArray(points) || points.length < 3 || points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) {
    throw new AppError('VALIDATION_FAILED', 'polygon must be an array of at least 3 [lng, lat] points');
  }
  const first = points[0];
  const last = points[points.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, first];
}
