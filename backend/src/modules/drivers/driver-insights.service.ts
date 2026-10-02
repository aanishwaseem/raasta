import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { AppError } from '../../common/errors/app-error';
import { haversineM } from '../../common/geo/geo';
import { DemandService } from '../ai/demand.service';
import { DriverPresenceService } from './driver-presence.service';
import { DriverStatsService } from './driver-stats.service';

const PK_OFFSET = "interval '5 hours'";

export interface EarningsSummary {
  from: string;
  to: string;
  trips: number;
  gross: number;
  platformFees: number;
  cancellationFeesEarned: number;
  net: number;
  fuelEstimate: number;
  netAfterFuelEstimate: number;
  distanceKm: number;
  onlineHours: number;
  busyHours: number;
  idleHours: number;
  perHour: number | null;
  perKm: number | null;
  daily: Array<{ date: string; trips: number; net: number; onlineHours: number }>;
  /** Rolling 90-day rates (0..1), null until there is enough data. */
  acceptanceRate: number | null;
  completionRate: number | null;
  cancellationRate: number | null;
  notes: string[];
}

/**
 * Driver copilot and earnings analytics. Every forward-looking number is labelled a prediction with its basis
 * (sample size / model); nothing here promises income.
 */
@Injectable()
export class DriverInsightsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly presence: DriverPresenceService,
    private readonly demand: DemandService,
    private readonly stats: DriverStatsService,
  ) {}

  async earnings(driverId: string, from?: string, to?: string): Promise<EarningsSummary> {
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - 7 * 86400_000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) throw new AppError('VALIDATION_FAILED', 'Invalid date range');
    if (end.getTime() - start.getTime() > 93 * 86400_000) throw new AppError('VALIDATION_FAILED', 'Date range can be at most 93 days');

    const trips = await this.db.query<{ day: string; fare: number; fee: number; fuel: number; km: number; busy_s: number }>(
      `SELECT to_char((r.completed_at + ${PK_OFFSET})::date, 'YYYY-MM-DD') AS day,
              r.offered_fare AS fare,
              round(r.offered_fare * COALESCE(pc.platform_fee_pct, 15) / 100.0)::int AS fee,
              round(COALESCE(r.actual_distance_m, r.est_distance_m) / 1000.0 * COALESCE(pc.fuel_cost_per_km, 0))::int AS fuel,
              COALESCE(r.actual_distance_m, r.est_distance_m) / 1000.0 AS km,
              EXTRACT(EPOCH FROM (r.completed_at - COALESCE(r.assigned_at, r.started_at)))::int AS busy_s
         FROM rides r
         LEFT JOIN pricing_configs pc ON pc.city_id = r.city_id AND pc.product_code = r.product_code AND pc.active
        WHERE r.driver_id = $1 AND r.status = 'COMPLETED' AND r.completed_at >= $2 AND r.completed_at < $3`,
      [driverId, start, end],
    );
    const cancelFees = await this.db.one<{ n: number }>(
      `SELECT COALESCE(SUM(r.cancellation_fee - round(r.cancellation_fee * COALESCE(pc.platform_fee_pct, 15) / 100.0)),0)::int AS n
         FROM rides r LEFT JOIN pricing_configs pc ON pc.city_id = r.city_id AND pc.product_code = r.product_code AND pc.active
        WHERE r.driver_id = $1 AND r.status = 'CANCELLED' AND r.cancellation_fee > 0 AND r.cancelled_at >= $2 AND r.cancelled_at < $3`,
      [driverId, start, end],
    );
    const online = await this.db.query<{ day: string; s: number }>(
      `SELECT to_char((GREATEST(started_at, $2) + ${PK_OFFSET})::date, 'YYYY-MM-DD') AS day,
              SUM(EXTRACT(EPOCH FROM (LEAST(COALESCE(ended_at, now()), $3) - GREATEST(started_at, $2))))::int AS s
         FROM driver_online_sessions
        WHERE driver_id = $1 AND started_at < $3 AND COALESCE(ended_at, now()) > $2
        GROUP BY 1`,
      [driverId, start, end],
    );

    const sum = (f: (t: (typeof trips)[number]) => number) => trips.reduce((s, t) => s + Number(f(t)), 0);
    const gross = sum((t) => t.fare);
    const fees = sum((t) => t.fee);
    const fuel = sum((t) => t.fuel);
    const km = sum((t) => t.km);
    const busyS = sum((t) => Math.max(0, t.busy_s));
    const onlineS = online.reduce((s, o) => s + Math.max(0, o.s), 0);
    const cancellationFeesEarned = cancelFees?.n ?? 0;
    const net = gross - fees + cancellationFeesEarned;
    const onlineHours = round1(onlineS / 3600);

    const days = new Map<string, { trips: number; net: number; onlineS: number }>();
    for (const t of trips) {
      const d = days.get(t.day) ?? { trips: 0, net: 0, onlineS: 0 };
      d.trips += 1;
      d.net += t.fare - t.fee;
      days.set(t.day, d);
    }
    for (const o of online) {
      const d = days.get(o.day) ?? { trips: 0, net: 0, onlineS: 0 };
      d.onlineS += o.s;
      days.set(o.day, d);
    }
    const st = await this.stats.get(driverId);
    const rate = (n: number, d: number) => (d >= 5 ? Math.round((n / d) * 1000) / 1000 : null);
    const notes = ['Fuel cost is an estimate from trip distance and the city fuel-cost setting; it excludes the drive to pickup.'];
    if (onlineS === 0 && trips.length) notes.push('No online-session data for this range, so hourly figures are unavailable.');
    return {
      from: start.toISOString(),
      to: end.toISOString(),
      trips: trips.length,
      gross,
      platformFees: fees,
      cancellationFeesEarned,
      net,
      fuelEstimate: fuel,
      netAfterFuelEstimate: net - fuel,
      distanceKm: round1(km),
      onlineHours,
      busyHours: round1(busyS / 3600),
      idleHours: round1(Math.max(0, onlineS - busyS) / 3600),
      perHour: onlineS > 0 ? Math.round(net / (onlineS / 3600)) : null,
      perKm: km > 0 ? Math.round(net / km) : null,
      daily: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ date, trips: d.trips, net: d.net, onlineHours: round1(d.onlineS / 3600) })),
      acceptanceRate: st ? rate(st.offersAccepted, st.offersReceived) : null,
      completionRate: st ? rate(st.tripsCompleted, st.tripsAssigned) : null,
      cancellationRate: st ? rate(st.driverCancellations, st.tripsAssigned) : null,
      notes,
    };
  }

  async demandZones(driverId: string) {
    const cityId = await this.cityOf(driverId);
    const zones = await this.demand.forCity(cityId);
    return {
      cityId,
      generatedAt: new Date().toISOString(),
      model: zones[0] ? `${zones[0].model}@${zones[0].version}` : null,
      disclaimer: 'Demand levels are predictions for the next hour, not guarantees.',
      zones: zones.map((z) => ({
        zoneId: z.zoneId,
        code: z.code,
        name: z.name,
        centroid: z.centroid,
        boundary: z.boundary,
        level: z.level,
        confidence: z.confidence,
        expectedRequests: Math.round(z.expectedRequests * 10) / 10,
        onlineDrivers: z.onlineDrivers,
        recentRequests1h: z.recentRequests1h,
      })),
    };
  }

  async copilot(driverId: string) {
    const cityId = await this.cityOf(driverId);
    const [today, zones, presence, stats, hours] = await Promise.all([
      this.earnings(driverId, startOfPkDay().toISOString(), new Date().toISOString()),
      this.demand.forCity(cityId),
      this.presence.get(driverId),
      this.stats.get(driverId),
      this.bestHours(cityId),
    ]);
    const recommendations: Array<{ type: string; title: string; detail: string; basis: string; confidence: string; zoneId?: string; target?: { lat: number; lng: number } }> = [];
    const gapZones = zones
      .filter((z) => z.level !== 'LOW')
      .map((z) => ({ z, distM: presence ? haversineM(presence, z.centroid) : null }))
      .filter((x) => x.distM === null || x.distM < 8000)
      .sort((a, b) => b.z.supplyGap - a.z.supplyGap || (a.distM ?? 0) - (b.distM ?? 0))
      .slice(0, 3);
    for (const { z, distM } of gapZones) {
      recommendations.push({
        type: 'REPOSITION',
        title: `${z.level === 'HIGH' ? 'High' : 'Moderate'} demand expected in ${z.name}`,
        detail: `About ${Math.max(1, Math.round(z.expectedRequests))} requests expected in the next hour with ${z.onlineDrivers} drivers nearby${distM !== null ? `; ${(distM / 1000).toFixed(1)} km from you` : ''}.`,
        basis: `Prediction from ${z.model}@${z.version}; not a guarantee of rides.`,
        confidence: z.confidence,
        zoneId: z.zoneId,
        target: z.centroid,
      });
    }
    if (hours.best.length) {
      recommendations.push({
        type: 'SCHEDULE',
        title: 'Busiest hours in your city recently',
        detail: hours.best.map((h) => `${fmtHour(h.hour)} (${h.avgRequests.toFixed(1)} requests/hr)`).join(', '),
        basis: `Averages of the last ${hours.weeks} weeks for ${hours.weekdayName}, from ${hours.sample} requests.`,
        confidence: hours.sample >= 200 ? 'medium' : 'low',
      });
    }
    const acceptance = stats && stats.offersReceived >= 10 ? stats.offersAccepted / stats.offersReceived : null;
    if (acceptance !== null && acceptance < 0.6) {
      recommendations.push({
        type: 'TIP',
        title: 'Accepting more offers can bring more trips',
        detail: `You accepted ${Math.round(acceptance * 100)}% of recent offers. Adjusting your pickup distance in preferences filters offers you do not want.`,
        basis: 'Your offers over the last 90 days.',
        confidence: 'high',
      });
    }
    return {
      online: !!presence,
      status: presence?.status ?? 'OFFLINE',
      today: { trips: today.trips, net: today.net, onlineHours: today.onlineHours, perHour: today.perHour },
      recommendations,
      disclaimer: 'Copilot suggestions are predictions based on recent data. Earnings are never guaranteed.',
    };
  }

  /** Historical requests per hour for today's weekday over recent weeks (Pakistan time). */
  private async bestHours(cityId: string) {
    const weeks = 8;
    const rows = await this.db.query<{ hour: number; n: number }>(
      `SELECT EXTRACT(HOUR FROM requested_at + ${PK_OFFSET})::int AS hour, count(*)::int AS n
         FROM rides
        WHERE city_id = $1 AND requested_at > now() - interval '${weeks} weeks'
          AND EXTRACT(ISODOW FROM requested_at + ${PK_OFFSET}) = EXTRACT(ISODOW FROM now() + ${PK_OFFSET})
        GROUP BY 1`,
      [cityId],
    );
    const sample = rows.reduce((s, r) => s + r.n, 0);
    const nowHour = new Date(Date.now() + 5 * 3600_000).getUTCHours();
    const best =
      sample < 30
        ? []
        : rows
            .filter((r) => r.hour >= nowHour)
            .map((r) => ({ hour: r.hour, avgRequests: r.n / weeks }))
            .sort((a, b) => b.avgRequests - a.avgRequests)
            .slice(0, 3)
            .sort((a, b) => a.hour - b.hour);
    const weekdayName = new Date(Date.now() + 5 * 3600_000).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    return { best, sample, weeks, weekdayName };
  }

  private async cityOf(driverId: string): Promise<string> {
    const row = await this.db.one<{ city_id: string | null }>(`SELECT city_id FROM drivers WHERE user_id = $1`, [driverId]);
    if (!row?.city_id) throw AppError.unprocessable('DRIVER_CITY_REQUIRED', 'Complete your identity step to choose your city first');
    return row.city_id;
  }
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const fmtHour = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;
function startOfPkDay(): Date {
  const pk = new Date(Date.now() + 5 * 3600_000);
  return new Date(Date.UTC(pk.getUTCFullYear(), pk.getUTCMonth(), pk.getUTCDate()) - 5 * 3600_000);
}
