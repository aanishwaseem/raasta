import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { haversineM, LatLng } from '../../common/geo/geo';
import { DriverPresenceService } from '../drivers/driver-presence.service';
import { GeoService } from '../geo/geo.service';
import { AiClient, DemandForecast } from './ai.client';
import { PredictionsService } from './predictions.service';

export interface ZoneDemand extends DemandForecast {
  code: string;
  name: string;
  centroid: LatLng;
  recentRequests1h: number;
  boundary: unknown;
}

/**
 * Live demand/supply per zone (recent requests from Postgres + online drivers from Redis),
 * with a next-hour forecast from the AI service (or a persistence baseline). Cached briefly per city.
 */
@Injectable()
export class DemandService {
  private readonly cache = new Map<string, { at: number; zones: ZoneDemand[] }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly geo: GeoService,
    private readonly presence: DriverPresenceService,
    private readonly ai: AiClient,
    private readonly predictions: PredictionsService,
  ) {}

  async forCity(cityId: string, opts: { fresh?: boolean } = {}): Promise<ZoneDemand[]> {
    const hit = this.cache.get(cityId);
    if (!opts.fresh && hit && Date.now() - hit.at < 60_000) return hit.zones;

    const zones = await this.geo.zones(cityId);
    const recent = await this.db.query<{ zone_id: string; n: number }>(
      `SELECT z.id AS zone_id, count(r.id)::int AS n
         FROM demand_zones z LEFT JOIN rides r
           ON ST_Covers(z.boundary, r.pickup) AND r.requested_at > now() - interval '1 hour'
        WHERE z.city_id = $1 AND z.active GROUP BY z.id`,
      [cityId],
    );
    const recentMap = new Map(recent.map((r) => [r.zone_id, r.n]));
    const online = await this.presence.onlineInCity(cityId);
    // attribute each online driver to the nearest zone centroid within 3 km
    const driverCounts = new Map<string, number>();
    for (const d of online) {
      let best: { id: string; dist: number } | null = null;
      for (const z of zones) {
        const dist = haversineM(d, z.centroid);
        if (dist < 3000 && (!best || dist < best.dist)) best = { id: z.id, dist };
      }
      if (best) driverCounts.set(best.id, (driverCounts.get(best.id) ?? 0) + 1);
    }
    const inputs = zones.map((z) => ({ zoneId: z.id, code: z.code, recentRequests1h: recentMap.get(z.id) ?? 0, onlineDrivers: driverCounts.get(z.id) ?? 0 }));
    const started = Date.now();
    const forecasts = await this.ai.demandForecast(cityId, new Date(), inputs);
    const byId = new Map(forecasts.map((f) => [f.zoneId, f]));
    const out: ZoneDemand[] = zones.map((z) => {
      const f = byId.get(z.id)!;
      const input = inputs.find((i) => i.zoneId === z.id)!;
      return { ...f, code: z.code, name: z.name, centroid: z.centroid, recentRequests1h: input.recentRequests1h, boundary: JSON.parse(z.boundary) };
    });
    if (forecasts[0]) {
      await this.predictions.log({
        kind: 'DEMAND',
        model: forecasts[0].model,
        version: forecasts[0].version,
        entityType: 'city',
        entityId: cityId,
        features: { zones: inputs.length },
        prediction: { total: out.reduce((s, z) => s + z.expectedRequests, 0), high: out.filter((z) => z.level === 'HIGH').map((z) => z.code) },
        predictedValue: out.reduce((s, z) => s + z.expectedRequests, 0),
        latencyMs: Date.now() - started,
        fallback: forecasts[0].model === 'persistence',
      });
    }
    this.cache.set(cityId, { at: Date.now(), zones: out });
    return out;
  }

  async levelAt(cityId: string, zoneId: string | null): Promise<ZoneDemand | null> {
    if (!zoneId) return null;
    return (await this.forCity(cityId)).find((z) => z.zoneId === zoneId) ?? null;
  }
}
