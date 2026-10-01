import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { config } from '../../config/config';
import { DatabaseService } from '../../common/db/database.service';
import { RedisService } from '../../common/redis/redis.service';
import { EventBus } from '../../common/events/event-bus';
import { MetricsService } from '../../common/metrics/metrics.service';
import { QueueService } from '../../common/queue/queue.service';
import { AuditService } from '../../common/audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { haversineM, LatLng } from '../../common/geo/geo';
import { randomToken, sha256 } from '../../common/crypto/crypto';
import { AuthUser, isStaff } from '../../common/auth/auth.types';
import { offsetOf, PageQuery } from '../../common/dto';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DriverPresenceService } from '../drivers/driver-presence.service';
import { firstName } from '../users/users.repository';
import { RideRepository, RideRow } from '../rides/ride.repository';
import { DeviationState, evaluateDeviation, INITIAL_DEVIATION_STATE, isProlongedStop } from './deviation';

type SafetyType = 'ROUTE_DEVIATION' | 'PROLONGED_STOP' | 'END_FAR_FROM_DESTINATION' | 'GPS_INCONSISTENCY' | 'SOS' | 'REPEATED_EMERGENCY' | 'MANUAL_REPORT';
type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

const deviationKey = (rideId: string) => `safety:deviation:${rideId}`;

/** Actions offered to the passenger with every anomaly alert. The passenger decides; nobody is accused. */
export const ALERT_ACTIONS = [
  { code: 'SAFE', label: "I'm Safe" },
  { code: 'CONTACT_DRIVER', label: 'Contact Driver' },
  { code: 'SHARE', label: 'Share Ride' },
  { code: 'SOS', label: 'SOS' },
];

@Injectable()
export class SafetyService implements OnModuleInit {
  private readonly logger = new Logger(SafetyService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly events: EventBus,
    private readonly metrics: MetricsService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly presence: DriverPresenceService,
    private readonly rides: RideRepository,
  ) {}

  onModuleInit() {
    this.events.on('ride.assigned', ({ rideId }) => this.autoShare(rideId));
    this.events.on('ride.completed', ({ rideId }) => this.redis.client.del(deviationKey(rideId)).then(() => undefined));
    this.queue.register('maintenance', 'safety-stop-scan', () => this.scanProlongedStops());
  }

  // ------------------------------------------------------------ live checks
  /** Called by the ride engine for every accepted GPS point while a trip is IN_PROGRESS. */
  async checkLocation(ride: RideRow, point: LatLng): Promise<void> {
    const route = this.rides.routeOf(ride);
    if (route.length < 2) return;
    const city = await this.db.one<{ settings: { deviationThresholdM?: number } }>(`SELECT settings FROM cities WHERE id = $1`, [ride.city_id]);
    const thresholdM = city?.settings?.deviationThresholdM ?? config().SAFETY_DEVIATION_M;
    const raw = await this.redis.client.get(deviationKey(ride.id));
    const prev: DeviationState = raw ? JSON.parse(raw) : INITIAL_DEVIATION_STATE;
    const d = evaluateDeviation(route, point, ride.dropoff, prev, { thresholdM, consecutive: config().SAFETY_DEVIATION_CONSECUTIVE });
    await this.redis.client.set(deviationKey(ride.id), JSON.stringify(d.state), 'EX', 6 * 3600);
    if (!d.trigger) return;

    const prefs = await this.db.one<{ safety_preferences: { routeDeviationAlerts?: boolean } }>(`SELECT safety_preferences FROM users WHERE id = $1`, [ride.passenger_id]);
    const event = await this.createEvent({
      rideId: ride.id,
      userId: ride.passenger_id,
      type: 'ROUTE_DEVIATION',
      severity: d.severity,
      location: point,
      details: { distanceFromRouteM: d.distanceM, thresholdM },
    });
    const payload = {
      eventId: event.id,
      rideId: ride.id,
      type: 'ROUTE_DEVIATION',
      severity: d.severity,
      message: 'Your ride appears to have deviated from the expected route.',
      detail: `About ${d.distanceM} m away from the planned route. This can happen because of traffic or road closures.`,
      actions: ALERT_ACTIONS,
    };
    // Passengers can opt out of deviation pop-ups; ops still see the event.
    if (prefs?.safety_preferences?.routeDeviationAlerts !== false) {
      this.realtime.toUser(ride.passenger_id, 'ride.route_deviation', payload);
      this.realtime.toUser(ride.passenger_id, 'safety.alert', payload);
    }
    this.realtime.toOps('safety.alert', payload);
  }

  async checkCompletion(ride: RideRow, endPoint: LatLng | null): Promise<void> {
    if (!endPoint) return;
    const dist = haversineM(endPoint, ride.dropoff);
    if (dist <= config().SAFETY_END_FAR_M) return;
    const event = await this.createEvent({
      rideId: ride.id,
      userId: ride.passenger_id,
      type: 'END_FAR_FROM_DESTINATION',
      severity: 'LOW',
      location: endPoint,
      details: { distanceFromDestinationM: Math.round(dist) },
    });
    const payload = {
      eventId: event.id,
      rideId: ride.id,
      type: 'END_FAR_FROM_DESTINATION',
      severity: 'LOW',
      message: 'Your trip ended away from the destination you set.',
      detail: `About ${(dist / 1000).toFixed(1)} km from ${ride.dropoff_address}. If this was not your choice, let us know.`,
      actions: ALERT_ACTIONS.filter((a) => a.code !== 'CONTACT_DRIVER'),
    };
    this.realtime.toUser(ride.passenger_id, 'safety.alert', payload);
    this.realtime.toOps('safety.alert', payload);
  }

  /** Periodic scan for vehicles stationary mid-trip for too long. */
  async scanProlongedStops(): Promise<number> {
    const rides = await this.db.query<{ id: string }>(`SELECT id FROM rides WHERE status = 'IN_PROGRESS' AND started_at < now() - make_interval(secs => $1)`, [config().SAFETY_STOP_SECONDS]);
    let created = 0;
    for (const { id } of rides) {
      const recent = await this.db.one(
        `SELECT 1 FROM safety_events WHERE ride_id = $1 AND type = 'PROLONGED_STOP' AND created_at > now() - interval '15 minutes'`,
        [id],
      );
      if (recent) continue;
      const pts = await this.db.query<{ lat: number; lng: number; recorded_at: Date }>(
        `SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, recorded_at FROM ride_locations
          WHERE ride_id = $1 AND phase = 'ON_TRIP' AND recorded_at > now() - make_interval(secs => $2) ORDER BY recorded_at`,
        [id, config().SAFETY_STOP_SECONDS + 60],
      );
      const ride = await this.rides.get(id);
      if (!isProlongedStop(pts.map((p) => ({ lat: p.lat, lng: p.lng, recordedAt: p.recorded_at })), ride.pickup, ride.dropoff, { stopSeconds: config().SAFETY_STOP_SECONDS })) continue;
      const last = pts[pts.length - 1];
      const event = await this.createEvent({
        rideId: id,
        userId: ride.passenger_id,
        type: 'PROLONGED_STOP',
        severity: 'MEDIUM',
        location: { lat: last.lat, lng: last.lng },
        details: { stoppedSeconds: config().SAFETY_STOP_SECONDS },
      });
      const payload = {
        eventId: event.id,
        rideId: id,
        type: 'PROLONGED_STOP',
        severity: 'MEDIUM',
        message: 'Your ride has been stopped for a while.',
        detail: 'Is everything okay?',
        actions: ALERT_ACTIONS,
      };
      this.realtime.toUser(ride.passenger_id, 'safety.alert', payload);
      this.realtime.toOps('safety.alert', payload);
      created++;
    }
    return created;
  }

  // ------------------------------------------------------------ SOS & responses
  async sos(user: AuthUser, rideId: string, location?: LatLng) {
    const ride = await this.rides.get(rideId);
    if (ride.passenger_id !== user.id && ride.driver_id !== user.id) throw AppError.notFound('Ride', 'RIDE_NOT_FOUND');
    let loc = location ?? null;
    if (!loc && ride.driver_id) {
      const p = await this.presence.get(ride.driver_id);
      if (p) loc = { lat: p.lat, lng: p.lng };
    }
    const event = await this.createEvent({ rideId, userId: user.id, type: 'SOS', severity: 'CRITICAL', location: loc, details: { raisedBy: user.id === ride.passenger_id ? 'PASSENGER' : 'DRIVER' } });
    const share = await this.createShare(user, rideId, { reason: 'SOS' });
    const contacts = await this.db.query<{ name: string; phone: string }>(`SELECT name, phone FROM emergency_contacts WHERE user_id = $1`, [user.id]);
    const me = await this.db.one<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [user.id]);
    for (const c of contacts) {
      await this.notifications.smsTo(c.phone, `URGENT: ${firstName(me?.full_name)} pressed SOS during a Raasta ride. Live location: ${share.url}. If you cannot reach them, call 15 (Police).`);
    }
    const payload = { eventId: event.id, rideId, type: 'SOS', severity: 'CRITICAL', location: loc, raisedBy: user.id, contactsNotified: contacts.length, trackingUrl: share.url };
    this.realtime.toOps('safety.alert', payload);
    await this.notifications.notify({
      userId: user.id,
      type: 'SOS_RECEIVED',
      title: 'SOS received',
      body: `Our safety team has been alerted${contacts.length ? ` and ${contacts.length} trusted contact(s) notified` : ''}. In immediate danger, call 15.`,
      data: { rideId, eventId: event.id },
    });
    const recentSos = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM safety_events WHERE user_id = $1 AND type = 'SOS' AND created_at > now() - interval '30 days'`, [user.id]);
    if ((recentSos?.n ?? 0) >= 3) {
      await this.createEvent({ rideId, userId: user.id, type: 'REPEATED_EMERGENCY', severity: 'HIGH', location: loc, details: { sosLast30Days: recentSos!.n } });
    }
    return { eventId: event.id, status: 'ESCALATED', contactsNotified: contacts.length, trackingUrl: share.url, emergencyNumber: '15' };
  }

  async respond(user: AuthUser, eventId: string, response: 'SAFE' | 'CONTACT_DRIVER' | 'SHARE' | 'SOS') {
    const ev = await this.db.one<{ id: string; ride_id: string; user_id: string; status: string }>(`SELECT id, ride_id, user_id, status FROM safety_events WHERE id = $1`, [eventId]);
    if (!ev || ev.user_id !== user.id) throw AppError.notFound('Safety alert');
    if (response === 'SAFE') {
      await this.db.query(`UPDATE safety_events SET status = 'CONFIRMED_SAFE', passenger_response = 'SAFE' WHERE id = $1 AND status = 'OPEN'`, [eventId]);
      this.realtime.toOps('safety.alert', { eventId, rideId: ev.ride_id, update: 'CONFIRMED_SAFE' });
      return { eventId, status: 'CONFIRMED_SAFE' };
    }
    if (response === 'CONTACT_DRIVER') {
      await this.db.query(`UPDATE safety_events SET passenger_response = 'CONTACT_DRIVER' WHERE id = $1`, [eventId]);
      const driver = await this.db.one<{ phone: string | null }>(`SELECT u.phone FROM rides r JOIN users u ON u.id = r.driver_id WHERE r.id = $1`, [ev.ride_id]);
      return { eventId, status: ev.status, driverPhone: driver?.phone ?? null };
    }
    if (response === 'SHARE') {
      await this.db.query(`UPDATE safety_events SET passenger_response = 'SHARE' WHERE id = $1`, [eventId]);
      const share = await this.createShare(user, ev.ride_id, { reason: 'SAFETY_ALERT' });
      return { eventId, status: ev.status, ...share };
    }
    await this.db.query(`UPDATE safety_events SET status = 'ESCALATED', passenger_response = 'SOS' WHERE id = $1`, [eventId]);
    return this.sos(user, ev.ride_id);
  }

  // ------------------------------------------------------------ sharing / family safety
  async createShare(user: AuthUser, rideId: string, opts: { contactIds?: string[]; name?: string; phone?: string; reason?: string } = {}) {
    const ride = await this.rides.get(rideId);
    if (ride.passenger_id !== user.id && ride.driver_id !== user.id) throw AppError.notFound('Ride', 'RIDE_NOT_FOUND');
    if (['COMPLETED', 'CANCELLED', 'NO_DRIVERS'].includes(ride.status)) throw AppError.conflict('RIDE_ENDED', 'This ride has already ended');
    const token = randomToken(24);
    const expiresAt = new Date(Date.now() + 6 * 3600 * 1000);
    await this.db.query(
      `INSERT INTO ride_shares (ride_id, created_by, token_hash, recipient_name, recipient_phone, expires_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [rideId, user.id, sha256(token), opts.name ?? null, opts.phone ?? null, expiresAt],
    );
    const url = `${config().TRACKING_BASE_URL}/${token}`;
    const recipients: { name: string; phone: string }[] = [];
    if (opts.contactIds?.length) {
      recipients.push(...(await this.db.query<{ name: string; phone: string }>(`SELECT name, phone FROM emergency_contacts WHERE user_id = $1 AND id = ANY($2::uuid[])`, [user.id, opts.contactIds])));
    }
    if (opts.phone) recipients.push({ name: opts.name ?? 'Contact', phone: opts.phone });
    const me = await this.db.one<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [user.id]);
    for (const r of recipients) {
      await this.notifications.smsTo(r.phone, `${firstName(me?.full_name)} is sharing a Raasta ride with you. Track it live: ${url}`);
    }
    await this.rides.event(this.db.pool, rideId, 'ride_shared', { actorId: user.id, actorRole: 'PASSENGER', payload: { recipients: recipients.length, reason: opts.reason ?? 'USER' } });
    return { url, token, expiresAt: expiresAt.toISOString(), recipients: recipients.length };
  }

  private async autoShare(rideId: string): Promise<void> {
    const ride = await this.rides.get(rideId);
    const u = await this.db.one<{ safety_preferences: { autoShareWithContacts?: boolean } }>(`SELECT safety_preferences FROM users WHERE id = $1`, [ride.passenger_id]);
    if (!u?.safety_preferences?.autoShareWithContacts && !ride.safety_mode) return;
    const contacts = await this.db.query<{ id: string }>(`SELECT id FROM emergency_contacts WHERE user_id = $1 AND share_by_default`, [ride.passenger_id]);
    if (!contacts.length) return;
    await this.createShare({ id: ride.passenger_id, roles: ['PASSENGER'], sid: 'system' }, rideId, { contactIds: contacts.map((c) => c.id), reason: 'AUTO_SHARE' });
  }

  /** Public tracking view: minimal fields, only while the link is valid. */
  async publicTrack(token: string) {
    const share = await this.db.one<{ ride_id: string; expires_at: Date; revoked_at: Date | null }>(`SELECT ride_id, expires_at, revoked_at FROM ride_shares WHERE token_hash = $1`, [sha256(token)]);
    if (!share || share.revoked_at || share.expires_at < new Date()) throw AppError.notFound('Tracking link', 'LINK_EXPIRED');
    const ride = await this.rides.get(share.ride_id);
    const endedLongAgo = ride.completed_at && Date.now() - ride.completed_at.getTime() > 30 * 60 * 1000;
    if (endedLongAgo || ride.cancelled_at) throw AppError.notFound('Tracking link', 'LINK_EXPIRED');
    const d = ride.driver_id
      ? await this.db.one<{ full_name: string; make: string; model: string; color: string; plate_number: string }>(
          `SELECT u.full_name, v.make, v.model, v.color, v.plate_number FROM users u LEFT JOIN vehicles v ON v.id = $2 WHERE u.id = $1`,
          [ride.driver_id, ride.vehicle_id],
        )
      : null;
    const live = ride.driver_id && ['DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(ride.status) ? await this.presence.get(ride.driver_id) : null;
    const passenger = await this.db.one<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [ride.passenger_id]);
    return {
      status: ride.status,
      passengerFirstName: firstName(passenger?.full_name),
      driver: d ? { firstName: firstName(d.full_name), vehicle: `${d.color} ${d.make} ${d.model}`, plateNumber: d.plate_number } : null,
      pickup: { address: ride.pickup_address, ...ride.pickup },
      dropoff: { address: ride.dropoff_address, ...ride.dropoff },
      location: live ? { lat: live.lat, lng: live.lng, updatedAt: new Date(live.lastSeen).toISOString() } : null,
      etaS: ride.status === 'IN_PROGRESS' ? ride.predicted_trip_eta_s : ride.predicted_pickup_eta_s,
      startedAt: ride.started_at,
      completedAt: ride.completed_at,
      expiresAt: share.expires_at,
    };
  }

  // ------------------------------------------------------------ admin
  async list(q: PageQuery & { status?: string }) {
    const items = await this.db.query(
      `SELECT s.id, s.ride_id AS "rideId", s.user_id AS "userId", u.full_name AS "userName", s.type, s.severity, s.status,
              CASE WHEN s.location IS NULL THEN NULL ELSE json_build_object('lat', ST_Y(s.location::geometry), 'lng', ST_X(s.location::geometry)) END AS location,
              s.details, s.passenger_response AS "passengerResponse", s.resolution_note AS "resolutionNote", s.created_at AS "createdAt", s.resolved_at AS "resolvedAt"
         FROM safety_events s LEFT JOIN users u ON u.id = s.user_id
        WHERE ($3::text IS NULL OR s.status = $3)
        ORDER BY CASE s.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
                 s.created_at DESC LIMIT $1 OFFSET $2`,
      [q.pageSize, offsetOf(q), q.status ?? null],
    );
    const total = await this.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM safety_events WHERE ($1::text IS NULL OR status = $1)`, [q.status ?? null]);
    return { items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 };
  }

  async resolve(admin: AuthUser, eventId: string, status: 'RESOLVED' | 'FALSE_POSITIVE' | 'ESCALATED', note: string) {
    if (!isStaff(admin)) throw AppError.forbidden();
    const before = await this.db.one(`SELECT status FROM safety_events WHERE id = $1`, [eventId]);
    if (!before) throw AppError.notFound('Safety event');
    await this.db.query(`UPDATE safety_events SET status = $2, resolution_note = $3, resolved_by = $4, resolved_at = CASE WHEN $2 = 'ESCALATED' THEN NULL ELSE now() END WHERE id = $1`, [eventId, status, note, admin.id]);
    await this.audit.log({ actor: admin, action: 'safety.resolve', entityType: 'safety_event', entityId: eventId, before, after: { status }, reason: note });
    return { id: eventId, status };
  }

  private async createEvent(e: { rideId: string | null; userId: string; type: SafetyType; severity: Severity; location: LatLng | null; details: Record<string, unknown> }) {
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO safety_events (ride_id, user_id, type, severity, location, details)
       VALUES ($1,$2,$3,$4, CASE WHEN $5::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($5,$6),4326)::geography END, $7) RETURNING id`,
      [e.rideId, e.userId, e.type, e.severity, e.location?.lng ?? null, e.location?.lat ?? null, JSON.stringify(e.details)],
    );
    if (e.rideId) await this.rides.event(this.db.pool, e.rideId, 'safety_event', { actorRole: 'SYSTEM', payload: { eventId: row!.id, type: e.type, severity: e.severity } });
    this.metrics.safetyEvents.inc({ type: e.type, severity: e.severity });
    this.events.emit('safety.event_created', { eventId: row!.id, rideId: e.rideId, type: e.type, severity: e.severity });
    this.logger.log(`Safety event ${e.type}/${e.severity} for ride ${e.rideId ?? '-'}`);
    return row!;
  }
}
