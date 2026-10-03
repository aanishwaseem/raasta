import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { AuthUser } from '../../common/auth/auth.types';
import { isStaff } from '../../common/auth/auth.types';
import { randomDigits, safeEqualHex, sha256 } from '../../common/crypto/crypto';
import { DatabaseService } from '../../common/db/database.service';
import { offsetOf, PageQuery } from '../../common/dto';
import { AppError } from '../../common/errors/app-error';
import { normalizePkPhone } from '../../common/crypto/crypto';
import { GeoService } from '../geo/geo.service';
import { RoutingProvider } from '../geo/routing.provider';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../realtime/realtime.service';
import { canTransition, crowDistanceM, DeliveryRate, priceDelivery } from './delivery.pricing';
import type { CreateDeliveryDto, DeliveryQuoteDto } from './dto/delivery.dto';

const PIN_MAX_ATTEMPTS = 3;
const MAX_ACTIVE_PER_DRIVER = 2;
const COLS = `d.id, d.status, d.package_category AS "packageCategory", d.package_description AS "packageDescription", d.weight_kg::float AS "weightKg",
  d.pickup_address AS "pickupAddress", ST_Y(d.pickup::geometry) AS "pickupLat", ST_X(d.pickup::geometry) AS "pickupLng", d.pickup_contact_name AS "pickupContactName", d.pickup_contact_phone AS "pickupContactPhone",
  d.dropoff_address AS "dropoffAddress", ST_Y(d.dropoff::geometry) AS "dropoffLat", ST_X(d.dropoff::geometry) AS "dropoffLng", d.recipient_name AS "recipientName", d.recipient_phone AS "recipientPhone",
  d.distance_m AS "distanceM", d.fare, d.platform_fee AS "platformFee", d.payment_method AS "paymentMethod", d.tracking_code AS "trackingCode", d.driver_id AS "driverId",
  d.created_at AS "createdAt", d.accepted_at AS "acceptedAt", d.picked_up_at AS "pickedUpAt", d.delivered_at AS "deliveredAt", d.cancelled_at AS "cancelledAt", d.cancellation_reason AS "cancellationReason"`;

type Row = Record<string, unknown> & { id: string; status: string; driverId: string | null };

/** Parcel delivery: separate bounded context with its own state machine. Nothing here touches ride tables or matching. */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly geo: GeoService,
    private readonly routing: RoutingProvider,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  async rateFor(cityId: string): Promise<DeliveryRate> {
    const r = await this.db.one<{ base_fare: number; per_km: number; minimum_fare: number; max_weight_kg: number; max_distance_km: number; platform_fee_pct: number }>(
      `SELECT base_fare, per_km::float, minimum_fare, max_weight_kg::float, max_distance_km, platform_fee_pct::float FROM delivery_rates WHERE city_id = $1 OR city_id IS NULL ORDER BY city_id NULLS LAST LIMIT 1`,
      [cityId],
    );
    if (!r) throw new AppError('DELIVERY_NOT_CONFIGURED', 'Delivery is not available yet', 503);
    return { baseFare: r.base_fare, perKm: r.per_km, minimumFare: r.minimum_fare, maxWeightKg: r.max_weight_kg, maxDistanceKm: r.max_distance_km, platformFeePct: r.platform_fee_pct };
  }

  async quote(dto: DeliveryQuoteDto) {
    const [from, to] = [await this.geo.requireServiceable(dto.pickup, 'pickup'), await this.geo.requireServiceable(dto.dropoff, 'destination')];
    if (from.cityId !== to.cityId) throw AppError.unprocessable('DELIVERY_CROSS_CITY', 'Deliveries must stay within one city');
    const rate = await this.rateFor(from.cityId);
    if (dto.weightKg > rate.maxWeightKg) throw AppError.unprocessable('DELIVERY_TOO_HEAVY', `Packages can weigh at most ${rate.maxWeightKg} kg`);
    const route = await this.routing.route(dto.pickup, dto.dropoff);
    if (route.distanceM > rate.maxDistanceKm * 1000) throw AppError.unprocessable('DELIVERY_TOO_FAR', `Deliveries are limited to ${rate.maxDistanceKm} km`);
    return { cityId: from.cityId, ...priceDelivery(rate, route.distanceM, route.durationS), maxWeightKg: rate.maxWeightKg };
  }

  async create(sender: AuthUser, dto: CreateDeliveryDto) {
    const phone = normalizePkPhone(dto.recipientPhone);
    if (!phone) throw new AppError('VALIDATION_FAILED', 'Recipient phone number is not valid');
    const q = await this.quote(dto);
    if (q.fare !== Math.round(dto.expectedFare)) throw AppError.conflict('FARE_CHANGED', `The delivery price is now Rs ${q.fare}. Please review and confirm.`);
    const pin = randomDigits(4);
    const code = randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8).toUpperCase();
    const id = await this.db.tx(async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO delivery_orders (sender_id, city_id, package_category, package_description, weight_kg, pickup, pickup_address, pickup_contact_name, pickup_contact_phone,
                                      dropoff, dropoff_address, recipient_name, recipient_phone, distance_m, fare, platform_fee, tracking_code, delivery_pin_hash, is_test_data)
         VALUES ($1,$2,$3,$4,$5, ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,$8,$9,$10, ST_SetSRID(ST_MakePoint($11,$12),4326)::geography,$13,$14,$15,$16,$17,$18,$19,$20,
                 (SELECT is_test_data FROM users WHERE id = $1)) RETURNING id`,
        [sender.id, q.cityId, dto.packageCategory, dto.packageDescription ?? null, dto.weightKg, dto.pickup.lng, dto.pickup.lat, dto.pickup.address, dto.pickupContactName ?? null, dto.pickupContactPhone ?? null,
          dto.dropoff.lng, dto.dropoff.lat, dto.dropoff.address, dto.recipientName, phone, q.distanceM, q.fare, q.platformFee, code, sha256(pin)],
      );
      await this.event(c, r.rows[0].id, 'created', sender.id, { fare: q.fare });
      return r.rows[0].id;
    });
    // the recipient is not a user: they get the tracking link and the handover PIN by SMS
    await this.notifications.smsTo(phone, `Raasta: a parcel from your sender is on its way. Handover PIN ${pin} (tell it to the rider only on delivery). Track: ${code}`).catch(() => undefined);
    return { ...(await this.mine(sender.id, id)), deliveryPin: pin };
  }

  private async event(c: { query: (sql: string, p?: unknown[]) => Promise<unknown> }, id: string, type: string, actor: string | null, payload: object = {}) {
    await c.query(`INSERT INTO delivery_events (delivery_id, type, actor_id, payload) VALUES ($1,$2,$3,$4)`, [id, type, actor, JSON.stringify(payload)]);
  }

  async list(sender: AuthUser, q: PageQuery) {
    const [items, total] = await Promise.all([
      this.db.query(`SELECT ${COLS} FROM delivery_orders d WHERE d.sender_id = $1 ORDER BY d.created_at DESC LIMIT $2 OFFSET $3`, [sender.id, q.pageSize, offsetOf(q)]),
      this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM delivery_orders WHERE sender_id = $1`, [sender.id]),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 };
  }

  async mine(senderId: string, id: string) {
    const row = await this.db.one<Row>(`SELECT ${COLS} FROM delivery_orders d WHERE d.id = $1 AND d.sender_id = $2`, [id, senderId]);
    if (!row) throw AppError.notFound('Delivery', 'DELIVERY_NOT_FOUND');
    return { ...row, driver: await this.driverCard(row.driverId), events: await this.events(id) };
  }

  /** Visible to the sender, the assigned driver and staff. */
  async get(user: AuthUser, id: string) {
    const row = await this.db.one<Row & { senderId: string }>(`SELECT ${COLS}, d.sender_id AS "senderId" FROM delivery_orders d WHERE d.id = $1`, [id]);
    if (!row || (row.senderId !== user.id && row.driverId !== user.id && !isStaff(user))) throw AppError.notFound('Delivery', 'DELIVERY_NOT_FOUND');
    return { ...row, driver: await this.driverCard(row.driverId), events: await this.events(id) };
  }

  private events(id: string) {
    return this.db.query(`SELECT type, created_at AS "at" FROM delivery_events WHERE delivery_id = $1 ORDER BY id`, [id]);
  }

  private async driverCard(driverId: string | null) {
    if (!driverId) return null;
    return this.db.one(
      `SELECT split_part(u.full_name,' ',1) AS "firstName", v.vehicle_class AS "vehicleClass", v.make, v.model, v.color, v.plate_number AS plate
         FROM users u LEFT JOIN drivers dr ON dr.user_id = u.id LEFT JOIN vehicles v ON v.id = dr.current_vehicle_id WHERE u.id = $1`,
      [driverId],
    );
  }

  /** Public tracking page for the recipient: status and timeline only, no phone numbers or addresses beyond the dropoff area. */
  async track(code: string) {
    const row = await this.db.one<{ id: string; status: string; driverId: string | null; dropoffAddress: string; createdAt: Date }>(
      `SELECT id, status, driver_id AS "driverId", dropoff_address AS "dropoffAddress", created_at AS "createdAt" FROM delivery_orders WHERE tracking_code = $1`,
      [code.toUpperCase()],
    );
    if (!row) throw AppError.notFound('Delivery', 'DELIVERY_NOT_FOUND');
    const driver = await this.driverCard(row.driverId);
    return { status: row.status, dropoffAddress: row.dropoffAddress, createdAt: row.createdAt, driverFirstName: (driver as { firstName?: string } | null)?.firstName ?? null, events: await this.events(row.id) };
  }

  async cancel(user: AuthUser, id: string, reason?: string) {
    const d = await this.db.one<{ sender_id: string; driver_id: string | null; status: string }>(`SELECT sender_id, driver_id, status FROM delivery_orders WHERE id = $1`, [id]);
    if (!d || (d.sender_id !== user.id && !isStaff(user))) throw AppError.notFound('Delivery', 'DELIVERY_NOT_FOUND');
    if (!canTransition(d.status, 'CANCELLED')) throw AppError.conflict('DELIVERY_NOT_CANCELLABLE', 'This delivery can no longer be cancelled');
    const by = d.sender_id === user.id ? 'SENDER' : 'STAFF';
    await this.db.tx(async (c) => {
      await c.query(`UPDATE delivery_orders SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $2, cancellation_reason = $3 WHERE id = $1`, [id, by, reason ?? null]);
      await this.event(c, id, 'cancelled', user.id, { by });
    });
    if (d.driver_id) await this.notifications.notify({ userId: d.driver_id, type: 'DELIVERY_CANCELLED', title: 'Delivery cancelled', body: 'The sender cancelled this delivery.', data: { deliveryId: id } });
    return this.get(user, id);
  }

  // ------------------------------------------------------------------ driver side (pull model: no matching engine needed)
  async open(driverId: string, q: PageQuery & { lat?: number; lng?: number }) {
    const d = await this.db.one<{ city_id: string }>(`SELECT city_id FROM drivers WHERE user_id = $1 AND status = 'APPROVED'`, [driverId]);
    if (!d) throw AppError.forbidden('Your driver account is not active');
    const rows = await this.db.query<Row & { pickupLat: number; pickupLng: number }>(`SELECT ${COLS} FROM delivery_orders d WHERE d.status = 'CREATED' AND d.city_id = $1 ORDER BY d.created_at LIMIT 100`, [d.city_id]);
    const here = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : null;
    const items = rows
      .map((r) => ({ ...r, recipientPhone: undefined, pickupContactPhone: undefined, pickupDistanceM: here ? crowDistanceM(here, { lat: r.pickupLat, lng: r.pickupLng }) : null }))
      .sort((a, b) => (a.pickupDistanceM ?? 0) - (b.pickupDistanceM ?? 0))
      .slice(offsetOf(q), offsetOf(q) + q.pageSize);
    return { items, page: q.page, pageSize: q.pageSize, total: rows.length };
  }

  async accept(driverId: string, id: string) {
    await this.db.tx(async (c) => {
      const dr = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM drivers WHERE user_id = $1 AND status = 'APPROVED' AND current_vehicle_id IS NOT NULL`, [driverId]);
      if (!dr.rows[0]?.n) throw AppError.forbidden('Your driver account is not active');
      const active = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM delivery_orders WHERE driver_id = $1 AND status IN ('ACCEPTED','PICKED_UP')`, [driverId]);
      if (active.rows[0].n >= MAX_ACTIVE_PER_DRIVER) throw AppError.conflict('TOO_MANY_DELIVERIES', 'Finish your current deliveries first');
      const r = await c.query(`UPDATE delivery_orders SET status = 'ACCEPTED', driver_id = $2, accepted_at = now() WHERE id = $1 AND status = 'CREATED' RETURNING id`, [id, driverId]);
      if (!r.rowCount) throw AppError.conflict('DELIVERY_TAKEN', 'Another driver already took this delivery');
      await this.event(c, id, 'accepted', driverId);
    });
    await this.tellSender(id, 'Driver found', 'A rider accepted your delivery and is heading to the pickup.');
    return this.get({ id: driverId, roles: ['DRIVER'], sid: '' }, id);
  }

  async release(driverId: string, id: string) {
    await this.transition(driverId, id, 'ACCEPTED', 'CREATED', 'released', `driver_id = NULL, accepted_at = NULL`);
    return { id, status: 'CREATED' };
  }

  async pickUp(driverId: string, id: string) {
    await this.transition(driverId, id, 'ACCEPTED', 'PICKED_UP', 'picked_up', `picked_up_at = now()`);
    await this.tellSender(id, 'Parcel picked up', 'Your parcel is on its way to the recipient.');
    return this.get({ id: driverId, roles: ['DRIVER'], sid: '' }, id);
  }

  private async transition(driverId: string, id: string, from: string, to: string, evt: string, setSql: string) {
    if (!canTransition(from, to)) throw AppError.conflict('INVALID_TRANSITION', `Cannot go from ${from} to ${to}`);
    await this.db.tx(async (c) => {
      const r = await c.query(`UPDATE delivery_orders SET status = $3, ${setSql} WHERE id = $1 AND driver_id = $2 AND status = $4 RETURNING id`, [id, driverId, to, from]);
      if (!r.rowCount) throw AppError.conflict('INVALID_TRANSITION', 'This delivery is not in the right state');
      await this.event(c, id, evt, driverId);
    });
  }

  /** Proof of delivery: the recipient's PIN. Three wrong attempts lock the order for staff review instead of allowing guessing. */
  async deliver(driverId: string, id: string, pin: string, note?: string) {
    const d = await this.db.one<{ status: string; driver_id: string | null; delivery_pin_hash: string; pin_attempts: number }>(`SELECT status, driver_id, delivery_pin_hash, pin_attempts FROM delivery_orders WHERE id = $1`, [id]);
    if (!d || d.driver_id !== driverId) throw AppError.notFound('Delivery', 'DELIVERY_NOT_FOUND');
    if (d.status !== 'PICKED_UP') throw AppError.conflict('INVALID_TRANSITION', 'Pick the parcel up first');
    if (d.pin_attempts >= PIN_MAX_ATTEMPTS) throw AppError.forbidden('Too many wrong PIN attempts. Contact support.');
    if (!safeEqualHex(sha256(pin), d.delivery_pin_hash)) {
      await this.db.query(`UPDATE delivery_orders SET pin_attempts = pin_attempts + 1 WHERE id = $1`, [id]);
      throw new AppError('WRONG_DELIVERY_PIN', 'That PIN is not correct. Ask the recipient for the PIN they received by SMS.', 422);
    }
    await this.db.tx(async (c) => {
      await c.query(`UPDATE delivery_orders SET status = 'DELIVERED', delivered_at = now(), proof_note = $2 WHERE id = $1`, [id, note ?? null]);
      await this.event(c, id, 'delivered', driverId, { proof: 'PIN' });
    });
    await this.tellSender(id, 'Delivered', 'Your parcel was handed over and the PIN was verified.');
    return this.get({ id: driverId, roles: ['DRIVER'], sid: '' }, id);
  }

  async mineAsDriver(driverId: string) {
    return this.db.query(`SELECT ${COLS} FROM delivery_orders d WHERE d.driver_id = $1 AND d.status IN ('ACCEPTED','PICKED_UP') ORDER BY d.accepted_at`, [driverId]);
  }

  private async tellSender(id: string, title: string, body: string) {
    const r = await this.db.one<{ sender_id: string }>(`SELECT sender_id FROM delivery_orders WHERE id = $1`, [id]);
    if (!r) return;
    this.realtime.toUser(r.sender_id, 'delivery.updated', { deliveryId: id });
    await this.notifications.notify({ userId: r.sender_id, type: 'DELIVERY_UPDATE', title, body, data: { deliveryId: id } });
  }

  async adminList(q: PageQuery & { status?: string }) {
    const [items, total] = await Promise.all([
      this.db.query(`SELECT ${COLS}, u.full_name AS "senderName" FROM delivery_orders d JOIN users u ON u.id = d.sender_id WHERE ($1::text IS NULL OR d.status = $1) ORDER BY d.created_at DESC LIMIT $2 OFFSET $3`, [q.status ?? null, q.pageSize, offsetOf(q)]),
      this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM delivery_orders WHERE ($1::text IS NULL OR status = $1)`, [q.status ?? null]),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 };
  }
}
