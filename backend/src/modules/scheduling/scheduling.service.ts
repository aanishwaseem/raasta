import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { QueueService } from '../../common/queue/queue.service';
import { RedisService } from '../../common/redis/redis.service';
import { AppError } from '../../common/errors/app-error';
import type { AuthUser } from '../../common/auth/auth.types';
import { latLngSql } from '../../common/dto';
import { NotificationsService } from '../notifications/notifications.service';
import { PricingService } from '../pricing/pricing.service';
import { RidesService } from '../rides/rides.service';
import { RecurringRideDto, ScheduleRideDto } from './dto/scheduling.dto';

const MIN_LEAD_MS = 15 * 60_000;
const MAX_LEAD_MS = 30 * 86400_000;
const DISPATCH_BUFFER_S = 300;
const CONFIRM_GRACE_MS = 15 * 60_000;
const PK_OFFSET_MS = 5 * 3600_000;

interface ScheduledRow {
  id: string;
  passenger_id: string;
  city_id: string;
  recurring_ride_id: string | null;
  pickup: { lat: number; lng: number };
  pickup_address: string;
  dropoff: { lat: number; lng: number };
  dropoff_address: string;
  product_code: string;
  payment_method: 'CASH' | 'WALLET' | 'CARD' | 'CORPORATE';
  pickup_at: Date;
  dispatch_at: Date;
  preferred_driver_id: string | null;
  corporate_id: string | null;
  source: string;
  status: string;
  auto_dispatch: boolean | null;
}

const SELECT = `SELECT s.*, ${latLngSql('s.pickup', 'pickup')}, ${latLngSql('s.dropoff', 'dropoff')}, r.auto_dispatch
                  FROM scheduled_rides s LEFT JOIN recurring_rides r ON r.id = s.recurring_ride_id`;

/**
 * Scheduled and recurring rides. The system NEVER requests a ride the user has not authorised:
 * one-off scheduled rides are explicit; recurring occurrences only dispatch automatically when the user
 * enabled auto-dispatch, otherwise they get a reminder and must tap to confirm.
 */
@Injectable()
export class SchedulingService implements OnModuleInit {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly queue: QueueService,
    private readonly pricing: PricingService,
    private readonly rides: RidesService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.queue.register('scheduler', 'dispatch-due', () => this.dispatchDue());
    this.queue.register('scheduler', 'generate-occurrences', () => this.generateAllOccurrences());
    void this.queue.repeat('scheduler', 'dispatch-due', 30_000).catch((e: Error) => this.logger.warn(e.message));
    void this.queue.repeat('scheduler', 'generate-occurrences', 6 * 3600_000).catch((e: Error) => this.logger.warn(e.message));
  }

  // -------------------------------------------------------------- one-off
  async create(user: AuthUser, dto: ScheduleRideDto, source: 'APP' | 'VOICE' | 'ASSISTANT' | 'CORPORATE' = 'APP') {
    if (!dto.pickupAt && !dto.targetArrivalAt) throw new AppError('VALIDATION_FAILED', 'Provide a pickup time or a time you need to arrive by');
    const quote = await this.pricing.quote(user.id, dto.pickup, dto.dropoff, { corporateId: dto.corporateId });
    const option = quote.options.find((o) => o.productCode === dto.productCode);
    if (!option) throw AppError.unprocessable('PRODUCT_UNAVAILABLE', 'This ride type is not available for this trip');
    let pickupAt: Date;
    if (dto.pickupAt) pickupAt = new Date(dto.pickupAt);
    else pickupAt = new Date(new Date(dto.targetArrivalAt!).getTime() - Math.round(option.tripEtaS * 1.25) * 1000 - 5 * 60_000);
    this.assertLead(pickupAt);
    const dispatchAt = new Date(pickupAt.getTime() - ((option.pickupEtaS ?? 600) + DISPATCH_BUFFER_S) * 1000);
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO scheduled_rides (passenger_id, city_id, pickup, pickup_address, dropoff, dropoff_address, product_code, payment_method, pickup_at,
                                    target_arrival_at, dispatch_at, preferred_driver_id, corporate_id, source)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,$5, ST_SetSRID(ST_MakePoint($6,$7),4326)::geography,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [user.id, quote.cityId, dto.pickup.lng, dto.pickup.lat, dto.pickup.address, dto.dropoff.lng, dto.dropoff.lat, dto.dropoff.address, dto.productCode,
        dto.paymentMethod, pickupAt, dto.targetArrivalAt ?? null, dispatchAt, dto.preferredDriverId ?? null, dto.corporateId ?? null, source],
    );
    return {
      ...(await this.get(user.id, row!.id)),
      estimate: { fare: option.fare.recommended, fareNote: 'Estimate only. The final price is confirmed when your ride is requested.', tripEtaS: option.tripEtaS },
    };
  }

  async list(userId: string) {
    const rows = await this.db.query<ScheduledRow>(`${SELECT} WHERE s.passenger_id = $1 AND s.status IN ('PENDING') ORDER BY s.pickup_at`, [userId]);
    return rows.map((r) => this.view(r));
  }

  async get(userId: string, id: string) {
    const r = await this.db.one<ScheduledRow>(`${SELECT} WHERE s.id = $1 AND s.passenger_id = $2`, [id, userId]);
    if (!r) throw AppError.notFound('Scheduled ride', 'SCHEDULED_RIDE_NOT_FOUND');
    return this.view(r);
  }

  async cancel(userId: string, id: string) {
    const r = await this.db.one(`UPDATE scheduled_rides SET status = 'CANCELLED' WHERE id = $1 AND passenger_id = $2 AND status = 'PENDING' RETURNING id`, [id, userId]);
    if (!r) throw AppError.conflict('CANNOT_CANCEL', 'This scheduled ride is no longer pending');
    return { id, status: 'CANCELLED' };
  }

  /** Passenger taps "confirm" on the reminder for a recurring occurrence, or asks to start a scheduled ride now. */
  async confirm(user: AuthUser, id: string) {
    const r = await this.db.one<ScheduledRow>(`${SELECT} WHERE s.id = $1 AND s.passenger_id = $2`, [id, user.id]);
    if (!r) throw AppError.notFound('Scheduled ride', 'SCHEDULED_RIDE_NOT_FOUND');
    if (r.status !== 'PENDING') throw AppError.conflict('CANNOT_CONFIRM', 'This scheduled ride is no longer pending');
    return this.dispatch(r, user);
  }

  // -------------------------------------------------------------- recurring
  async createRecurring(user: AuthUser, dto: RecurringRideDto) {
    if (!dto.pickupTime && !dto.targetArrivalTime) throw new AppError('VALIDATION_FAILED', 'Provide a pickup time or an arrival time');
    const city = await this.pricing.quote(user.id, dto.pickup, dto.dropoff, { corporateId: dto.corporateId });
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO recurring_rides (passenger_id, city_id, label, pickup, pickup_address, dropoff, dropoff_address, product_code, payment_method, days_of_week,
                                    pickup_time, target_arrival_time, auto_dispatch, preferred_driver_id, corporate_id)
       VALUES ($1,$2,$3, ST_SetSRID(ST_MakePoint($4,$5),4326)::geography,$6, ST_SetSRID(ST_MakePoint($7,$8),4326)::geography,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
      [user.id, city.cityId, dto.label, dto.pickup.lng, dto.pickup.lat, dto.pickup.address, dto.dropoff.lng, dto.dropoff.lat, dto.dropoff.address, dto.productCode,
        dto.paymentMethod, [...new Set(dto.daysOfWeek)].sort(), dto.pickupTime ?? null, dto.targetArrivalTime ?? null, dto.autoDispatch ?? false, dto.preferredDriverId ?? null, dto.corporateId ?? null],
    );
    await this.generateOccurrences(row!.id);
    return this.getRecurring(user.id, row!.id);
  }

  async listRecurring(userId: string) {
    return this.db.query(
      `SELECT id, label, ${latLngSql('pickup')}, pickup_address AS "pickupAddress", ${latLngSql('dropoff')}, dropoff_address AS "dropoffAddress", product_code AS "productCode",
              payment_method AS "paymentMethod", days_of_week AS "daysOfWeek", to_char(pickup_time,'HH24:MI') AS "pickupTime", to_char(target_arrival_time,'HH24:MI') AS "targetArrivalTime",
              auto_dispatch AS "autoDispatch", active, created_at AS "createdAt"
         FROM recurring_rides WHERE passenger_id = $1 AND active ORDER BY created_at`,
      [userId],
    );
  }

  async getRecurring(userId: string, id: string) {
    const rows = (await this.listRecurring(userId)) as Array<{ id: string }>;
    const r = rows.find((x) => x.id === id);
    if (!r) throw AppError.notFound('Recurring ride', 'RECURRING_RIDE_NOT_FOUND');
    return r;
  }

  async deleteRecurring(userId: string, id: string) {
    const r = await this.db.one(`UPDATE recurring_rides SET active = false WHERE id = $1 AND passenger_id = $2 AND active RETURNING id`, [id, userId]);
    if (!r) throw AppError.notFound('Recurring ride', 'RECURRING_RIDE_NOT_FOUND');
    await this.db.query(`UPDATE scheduled_rides SET status = 'CANCELLED' WHERE recurring_ride_id = $1 AND status = 'PENDING'`, [id]);
    return { id, deleted: true };
  }

  async setAutoDispatch(userId: string, id: string, enabled: boolean) {
    const r = await this.db.one(`UPDATE recurring_rides SET auto_dispatch = $3 WHERE id = $1 AND passenger_id = $2 AND active RETURNING id`, [id, userId, enabled]);
    if (!r) throw AppError.notFound('Recurring ride', 'RECURRING_RIDE_NOT_FOUND');
    return this.getRecurring(userId, id);
  }

  /** Creates PENDING occurrences for the next 7 days (idempotent via the unique occurrence index). */
  async generateOccurrences(recurringId: string): Promise<number> {
    const r = await this.db.one<{
      id: string; passenger_id: string; city_id: string; pickup: string; pickup_address: string; dropoff: string; dropoff_address: string; product_code: string;
      payment_method: string; days_of_week: number[]; pickup_time: string | null; target_arrival_time: string | null; starts_on: string; ends_on: string | null;
      preferred_driver_id: string | null; corporate_id: string | null; active: boolean;
    }>(`SELECT * FROM recurring_rides WHERE id = $1 AND active`, [recurringId]);
    if (!r) return 0;
    let created = 0;
    const nowPk = Date.now() + PK_OFFSET_MS;
    for (let i = 0; i < 7; i++) {
      const day = new Date(nowPk + i * 86400_000);
      const iso = ((day.getUTCDay() + 6) % 7) + 1;
      if (!r.days_of_week.includes(iso)) continue;
      const dateStr = day.toISOString().slice(0, 10);
      if (dateStr < String(r.starts_on).slice(0, 10) || (r.ends_on && dateStr > String(r.ends_on).slice(0, 10))) continue;
      let pickupAt: Date;
      if (r.pickup_time) pickupAt = new Date(`${dateStr}T${r.pickup_time.slice(0, 5)}:00+05:00`);
      else {
        const arrive = new Date(`${dateStr}T${r.target_arrival_time!.slice(0, 5)}:00+05:00`);
        pickupAt = new Date(arrive.getTime() - (await this.tripEstimateS(r.id)) * 1250 - 5 * 60_000);
      }
      if (pickupAt.getTime() < Date.now() + 5 * 60_000) continue;
      const dispatchAt = new Date(pickupAt.getTime() - (600 + DISPATCH_BUFFER_S) * 1000);
      const res = await this.db.query(
        `INSERT INTO scheduled_rides (passenger_id, city_id, recurring_ride_id, pickup, pickup_address, dropoff, dropoff_address, product_code, payment_method, pickup_at,
                                      dispatch_at, preferred_driver_id, corporate_id, source)
         SELECT passenger_id, city_id, id, pickup, pickup_address, dropoff, dropoff_address, product_code, payment_method, $2, $3, preferred_driver_id, corporate_id, 'RECURRING'
           FROM recurring_rides WHERE id = $1
         ON CONFLICT (recurring_ride_id, pickup_at) WHERE recurring_ride_id IS NOT NULL DO NOTHING RETURNING id`,
        [r.id, pickupAt, dispatchAt],
      );
      created += res.length;
    }
    return created;
  }

  private async tripEstimateS(recurringId: string): Promise<number> {
    const row = await this.db.one<{ d: number }>(
      `SELECT GREATEST(600, (ST_Distance(pickup, dropoff) * 1.3 / 6)::int) AS d FROM recurring_rides WHERE id = $1`,
      [recurringId],
    );
    return row?.d ?? 1800;
  }

  async generateAllOccurrences(): Promise<number> {
    const ids = await this.db.query<{ id: string }>(`SELECT id FROM recurring_rides WHERE active`);
    let n = 0;
    for (const { id } of ids) n += await this.generateOccurrences(id);
    return n;
  }

  // -------------------------------------------------------------- dispatcher
  async dispatchDue(): Promise<{ dispatched: number; reminded: number; failed: number }> {
    const release = await this.redis.lock('lock:scheduler:dispatch', 25_000);
    if (!release) return { dispatched: 0, reminded: 0, failed: 0 };
    const out = { dispatched: 0, reminded: 0, failed: 0 };
    try {
      const due = await this.db.query<ScheduledRow>(`${SELECT} WHERE s.status = 'PENDING' AND s.dispatch_at <= now() ORDER BY s.dispatch_at LIMIT 50`);
      for (const s of due) {
        const needsConfirm = s.source === 'RECURRING' && !s.auto_dispatch;
        if (needsConfirm) {
          if (Date.now() > s.pickup_at.getTime() + CONFIRM_GRACE_MS) {
            await this.db.query(`UPDATE scheduled_rides SET status = 'FAILED', failure_reason = 'NOT_CONFIRMED' WHERE id = $1 AND status = 'PENDING'`, [s.id]);
            continue;
          }
          const key = `sched:reminded:${s.id}`;
          if (await this.redis.client.set(key, '1', 'EX', 7200, 'NX')) {
            await this.notifications.notify({
              userId: s.passenger_id,
              type: 'SCHEDULED_CONFIRM',
              title: 'Ready to book your ride?',
              body: `Your ${s.pickup_address.split(',')[0]} to ${s.dropoff_address.split(',')[0]} ride is due. Tap to confirm and we will find a driver.`,
              data: { scheduledRideId: s.id },
            });
            out.reminded++;
          }
          continue;
        }
        try {
          await this.dispatch(s, { id: s.passenger_id, roles: ['PASSENGER'], sid: 'system' });
          out.dispatched++;
        } catch (err) {
          out.failed++;
          const reason = err instanceof AppError ? err.code : 'ERROR';
          this.logger.warn(`Scheduled ride ${s.id} failed: ${(err as Error).message}`);
          await this.db.query(`UPDATE scheduled_rides SET status = 'FAILED', failure_reason = $2 WHERE id = $1 AND status = 'PENDING'`, [s.id, reason]);
          await this.notifications.notify({
            userId: s.passenger_id,
            type: 'SCHEDULED_FAILED',
            title: "We couldn't book your scheduled ride",
            body: err instanceof AppError ? err.message : 'Something went wrong. Please book it manually.',
            data: { scheduledRideId: s.id },
          });
        }
      }
    } finally {
      await release();
    }
    return out;
  }

  private async dispatch(s: ScheduledRow, user: AuthUser) {
    // claim first so two workers/taps cannot both dispatch the same occurrence
    const claimed = await this.db.one(`UPDATE scheduled_rides SET status = 'DISPATCHED' WHERE id = $1 AND status = 'PENDING' RETURNING id`, [s.id]);
    if (!claimed) throw AppError.conflict('ALREADY_DISPATCHED', 'Already dispatched');
    try {
      const quote = await this.pricing.quote(s.passenger_id, { ...s.pickup, address: s.pickup_address }, { ...s.dropoff, address: s.dropoff_address }, { corporateId: s.corporate_id });
      const ride = await this.rides.request(
        user,
        { quoteId: quote.id, productCode: s.product_code, paymentMethod: s.payment_method, corporateId: s.corporate_id ?? undefined },
        { scheduledRideId: s.id, mode: 'SCHEDULED' },
      );
      await this.db.query(`UPDATE scheduled_rides SET ride_id = $2 WHERE id = $1`, [s.id, (ride as { id: string }).id]);
      return ride;
    } catch (err) {
      await this.db.query(`UPDATE scheduled_rides SET status = 'PENDING' WHERE id = $1 AND status = 'DISPATCHED' AND ride_id IS NULL`, [s.id]);
      throw err;
    }
  }

  private assertLead(pickupAt: Date) {
    if (Number.isNaN(pickupAt.getTime())) throw new AppError('VALIDATION_FAILED', 'Invalid time');
    const lead = pickupAt.getTime() - Date.now();
    if (lead < MIN_LEAD_MS) throw AppError.unprocessable('TOO_SOON', 'Scheduled rides need at least 15 minutes notice. Request a ride now instead.');
    if (lead > MAX_LEAD_MS) throw AppError.unprocessable('TOO_FAR_AHEAD', 'You can schedule up to 30 days ahead');
  }

  private view(r: ScheduledRow) {
    return {
      id: r.id,
      status: r.status,
      source: r.source,
      recurringRideId: r.recurring_ride_id,
      pickup: { ...r.pickup, address: r.pickup_address },
      dropoff: { ...r.dropoff, address: r.dropoff_address },
      productCode: r.product_code,
      paymentMethod: r.payment_method,
      pickupAt: r.pickup_at,
      dispatchAt: r.dispatch_at,
      requiresConfirmation: r.source === 'RECURRING' && !r.auto_dispatch,
      preferredDriverId: r.preferred_driver_id,
      corporateId: r.corporate_id,
    };
  }
}
