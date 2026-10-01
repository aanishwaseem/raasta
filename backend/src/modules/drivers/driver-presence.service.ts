import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../config/config';
import { DatabaseService } from '../../common/db/database.service';
import { RedisService } from '../../common/redis/redis.service';
import { EventBus } from '../../common/events/event-bus';
import { AppError } from '../../common/errors/app-error';
import { haversineM, isValidLatLng, LatLng } from '../../common/geo/geo';
import { GeoService } from '../geo/geo.service';
import { RealtimeService } from '../realtime/realtime.service';

export type PresenceStatus = 'IDLE' | 'OFFERED' | 'ON_TRIP';

export interface Presence {
  driverId: string;
  cityId: string;
  status: PresenceStatus;
  vehicleClass: string;
  seats: number;
  gender: string | null;
  lat: number;
  lng: number;
  heading: number | null;
  speedMps: number | null;
  lastSeen: number;
}

export interface LocationPing extends LatLng {
  heading?: number;
  speed?: number; // m/s
  accuracy?: number; // m
  recordedAt?: string;
}

export const geoKey = (cityId: string) => `drivers:geo:${cityId}`;
export const presenceKey = (driverId: string) => `driver:presence:${driverId}`;
const MAX_ACCURACY_M = 150;

@Injectable()
export class DriverPresenceService {
  private readonly logger = new Logger(DriverPresenceService.name);
  private readonly opsThrottle = new Map<string, number>();

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly geo: GeoService,
    private readonly events: EventBus,
    private readonly realtime: RealtimeService,
  ) {}

  async goOnline(driverId: string, loc: LatLng): Promise<Presence> {
    if (!isValidLatLng(loc)) throw new AppError('VALIDATION_FAILED', 'Invalid location');
    const d = await this.db.one<{ status: string; onboarding_step: string; vehicle_class: string | null; seats: number | null; vehicle_status: string | null; gender: string | null; user_status: string }>(
      `SELECT d.status, d.onboarding_step, v.vehicle_class, v.seats, v.status AS vehicle_status, u.gender, u.status AS user_status
         FROM drivers d JOIN users u ON u.id = d.user_id LEFT JOIN vehicles v ON v.id = d.current_vehicle_id
        WHERE d.user_id = $1`,
      [driverId],
    );
    if (!d) throw AppError.forbidden('Only drivers can go online');
    if (d.user_status !== 'ACTIVE') throw AppError.forbidden('Your account is not active');
    if (d.status !== 'APPROVED') throw AppError.unprocessable('DRIVER_NOT_APPROVED', 'Your driver account has not been approved yet');
    if (d.onboarding_step !== 'ACTIVE') throw AppError.unprocessable('TRAINING_REQUIRED', 'Please complete the safety training acknowledgement first');
    if (!d.vehicle_class || d.vehicle_status !== 'APPROVED') throw AppError.unprocessable('VEHICLE_NOT_APPROVED', 'Your vehicle has not been approved yet');
    const area = await this.geo.serviceAreaAt(loc);
    if (!area) throw AppError.unprocessable('OUT_OF_SERVICE_AREA', 'You are outside our service area');

    const existing = await this.get(driverId);
    const status: PresenceStatus = existing?.status === 'ON_TRIP' || (await this.hasActiveRide(driverId)) ? 'ON_TRIP' : 'IDLE';
    const presence: Presence = {
      driverId,
      cityId: area.cityId,
      status,
      vehicleClass: d.vehicle_class,
      seats: d.seats ?? 4,
      gender: d.gender,
      lat: loc.lat,
      lng: loc.lng,
      heading: null,
      speedMps: null,
      lastSeen: Date.now(),
    };
    if (existing && existing.cityId !== area.cityId) await this.redis.client.zrem(geoKey(existing.cityId), driverId);
    await this.write(presence);
    await this.db.query(`INSERT INTO driver_online_sessions (driver_id) VALUES ($1) ON CONFLICT DO NOTHING`, [driverId]);
    this.realtime.toOps('driver.online', { driverId, cityId: area.cityId, lat: loc.lat, lng: loc.lng });
    return presence;
  }

  async goOffline(driverId: string, opts: { force?: boolean } = {}): Promise<void> {
    if (!opts.force && (await this.hasActiveRide(driverId))) {
      throw AppError.conflict('ACTIVE_RIDE_EXISTS', 'Finish your current trip before going offline');
    }
    const p = await this.get(driverId);
    if (p) await this.redis.client.zrem(geoKey(p.cityId), driverId);
    await this.redis.client.del(presenceKey(driverId));
    await this.db.query(`UPDATE driver_online_sessions SET ended_at = now() WHERE driver_id = $1 AND ended_at IS NULL`, [driverId]);
    this.realtime.toOps('driver.offline', { driverId });
  }

  async get(driverId: string): Promise<Presence | null> {
    const h = await this.redis.client.hgetall(presenceKey(driverId));
    if (!h || !h.driverId) return null;
    return parsePresence(h);
  }

  async getMany(ids: string[]): Promise<Map<string, Presence>> {
    const out = new Map<string, Presence>();
    if (!ids.length) return out;
    const pipeline = this.redis.client.pipeline();
    ids.forEach((id) => pipeline.hgetall(presenceKey(id)));
    const results = (await pipeline.exec()) ?? [];
    results.forEach(([err, h], i) => {
      const hash = h as Record<string, string>;
      if (!err && hash?.driverId) out.set(ids[i], parsePresence(hash));
    });
    return out;
  }

  async setStatus(driverId: string, status: PresenceStatus): Promise<void> {
    const exists = await this.redis.client.exists(presenceKey(driverId));
    if (exists) await this.redis.client.hset(presenceKey(driverId), 'status', status);
  }

  /** Online drivers near a point, nearest first, with stale entries pruned. */
  async nearby(cityId: string, at: LatLng, radiusKm: number, limit = 50): Promise<Array<Presence & { distanceM: number }>> {
    const raw = (await this.redis.client.call(
      'GEOSEARCH', geoKey(cityId), 'FROMLONLAT', String(at.lng), String(at.lat), 'BYRADIUS', String(radiusKm), 'km', 'ASC', 'COUNT', String(limit), 'WITHDIST',
    )) as [string, string][];
    const ids = raw.map(([id]) => id);
    const presences = await this.getMany(ids);
    const stale: string[] = [];
    const out: Array<Presence & { distanceM: number }> = [];
    for (const [id, dist] of raw) {
      const p = presences.get(id);
      if (!p) {
        stale.push(id);
        continue;
      }
      out.push({ ...p, distanceM: Math.round(Number(dist) * 1000) });
    }
    if (stale.length) await this.redis.client.zrem(geoKey(cityId), ...stale);
    return out;
  }

  async onlineInCity(cityId: string): Promise<Presence[]> {
    const ids = await this.redis.client.zrange(geoKey(cityId), 0, -1);
    const map = await this.getMany(ids);
    const stale = ids.filter((id) => !map.has(id));
    if (stale.length) await this.redis.client.zrem(geoKey(cityId), ...stale);
    return [...map.values()];
  }

  /**
   * Driver location ping. Validates accuracy and implied speed, updates the geo index and presence,
   * then publishes a domain event consumed by the ride engine (arrival ETA, trace, safety checks).
   */
  async updateLocation(driverId: string, ping: LocationPing): Promise<{ accepted: boolean; reason?: string }> {
    if (!isValidLatLng(ping)) throw new AppError('VALIDATION_FAILED', 'Invalid location');
    const p = await this.get(driverId);
    if (!p) throw AppError.conflict('DRIVER_OFFLINE', 'Go online to share your location');
    if (ping.accuracy !== undefined && ping.accuracy > MAX_ACCURACY_M) return { accepted: false, reason: 'LOW_ACCURACY' };
    const recordedAt = ping.recordedAt ? new Date(ping.recordedAt) : new Date();
    const ts = Number.isNaN(recordedAt.getTime()) ? Date.now() : Math.min(recordedAt.getTime(), Date.now());
    const dtS = Math.max(1, (ts - p.lastSeen) / 1000);
    const implied = haversineM(p, ping) / dtS;
    if (implied > config().GPS_MAX_PLAUSIBLE_SPEED_MPS && dtS < 600) {
      const key = `fraud:gpsjump:${driverId}:${new Date().toISOString().slice(0, 10)}`;
      await this.redis.client.multi().incr(key).expire(key, 3 * 86400).exec();
      this.logger.warn(`GPS jump for driver ${driverId}: ${Math.round(implied)} m/s`);
      return { accepted: false, reason: 'GPS_INCONSISTENT' };
    }
    const next: Presence = {
      ...p,
      lat: ping.lat,
      lng: ping.lng,
      heading: ping.heading ?? p.heading,
      speedMps: ping.speed ?? Math.round(implied * 10) / 10,
      lastSeen: ts,
    };
    await this.write(next);

    const rides = await this.db.query<{ id: string }>(
      `SELECT id FROM rides WHERE driver_id = $1 AND status IN ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS')`,
      [driverId],
    );
    if (rides.length) {
      this.events.emit('driver.location', {
        driverId,
        rideIds: rides.map((r) => r.id),
        lat: ping.lat,
        lng: ping.lng,
        speedMps: next.speedMps ?? undefined,
        recordedAt: new Date(ts),
      });
    }
    const last = this.opsThrottle.get(driverId) ?? 0;
    if (Date.now() - last > 5000) {
      this.opsThrottle.set(driverId, Date.now());
      this.realtime.toOps('driver.location_updated', { driverId, cityId: p.cityId, lat: ping.lat, lng: ping.lng, status: next.status });
    }
    return { accepted: true };
  }

  async hasActiveRide(driverId: string): Promise<boolean> {
    const r = await this.db.one(
      `SELECT 1 FROM rides WHERE driver_id = $1 AND status IN ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS') LIMIT 1`,
      [driverId],
    );
    return !!r;
  }

  private async write(p: Presence): Promise<void> {
    const ttl = config().DRIVER_PRESENCE_TTL_S;
    await this.redis.client
      .multi()
      .geoadd(geoKey(p.cityId), p.lng, p.lat, p.driverId)
      .hset(presenceKey(p.driverId), {
        driverId: p.driverId,
        cityId: p.cityId,
        status: p.status,
        vehicleClass: p.vehicleClass,
        seats: String(p.seats),
        gender: p.gender ?? '',
        lat: String(p.lat),
        lng: String(p.lng),
        heading: p.heading === null ? '' : String(p.heading),
        speedMps: p.speedMps === null ? '' : String(p.speedMps),
        lastSeen: String(p.lastSeen),
      })
      .expire(presenceKey(p.driverId), ttl)
      .exec();
  }
}

function parsePresence(h: Record<string, string>): Presence {
  return {
    driverId: h.driverId,
    cityId: h.cityId,
    status: h.status as PresenceStatus,
    vehicleClass: h.vehicleClass,
    seats: Number(h.seats || 4),
    gender: h.gender || null,
    lat: Number(h.lat),
    lng: Number(h.lng),
    heading: h.heading ? Number(h.heading) : null,
    speedMps: h.speedMps ? Number(h.speedMps) : null,
    lastSeen: Number(h.lastSeen),
  };
}
