import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../config/config';
import { haversineM, interpolate, LatLng, polylineLengthM } from '../../common/geo/geo';

export interface RouteResult {
  distanceM: number;
  durationS: number; // provider ETA for a car in current conditions
  polyline: LatLng[];
  provider: 'haversine' | 'osrm';
}

export abstract class RoutingProvider {
  abstract route(from: LatLng, to: LatLng, departAt?: Date): Promise<RouteResult>;
}

/**
 * Typical urban car speed (km/h) by local hour in large Pakistani cities. Used only by the development
 * provider; real deployments should use OSRM/traffic data. These are assumptions, not measurements.
 */
export function assumedCitySpeedKmh(localHour: number): number {
  if ((localHour >= 8 && localHour < 10) || (localHour >= 17 && localHour < 20)) return 18;
  if (localHour >= 10 && localHour < 17) return 24;
  if (localHour >= 20 && localHour < 23) return 26;
  return 34;
}

export const localHourPk = (d: Date) => (d.getUTCHours() + 5) % 24; // Asia/Karachi is UTC+5, no DST

/**
 * DEVELOPMENT ONLY. Builds an L-shaped street-grid path (lat leg, then lng leg) so that route corridors,
 * deviation detection and simulations behave plausibly without a road network. Not real roads.
 */
@Injectable()
export class HaversineRoutingProvider extends RoutingProvider {
  async route(from: LatLng, to: LatLng, departAt: Date = new Date()): Promise<RouteResult> {
    const corner: LatLng = { lat: to.lat, lng: from.lng };
    const leg1 = Math.max(1, Math.round(haversineM(from, corner) / 150));
    const leg2 = Math.max(1, Math.round(haversineM(corner, to) / 150));
    const polyline = [...interpolate(from, corner, leg1), ...interpolate(corner, to, leg2).slice(1)];
    const distanceM = Math.round(polylineLengthM(polyline) * 1.05) || Math.round(haversineM(from, to));
    const speedMps = (assumedCitySpeedKmh(localHourPk(departAt)) * 1000) / 3600;
    const durationS = Math.max(60, Math.round(distanceM / speedMps + 45)); // +45 s for junctions/pickup manoeuvres
    return { distanceM, durationS, polyline, provider: 'haversine' };
  }
}

/** OSRM (self-hosted, Pakistan OSM extract recommended). Falls back to the dev provider on failure. */
@Injectable()
export class OsrmRoutingProvider extends RoutingProvider {
  private readonly logger = new Logger(OsrmRoutingProvider.name);
  private readonly fallback = new HaversineRoutingProvider();

  async route(from: LatLng, to: LatLng, departAt?: Date): Promise<RouteResult> {
    const url = `${config().OSRM_URL}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=simplified&geometries=geojson`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
      const body = (await res.json()) as { code: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] };
      const r = body.routes?.[0];
      if (body.code !== 'Ok' || !r) throw new Error(`OSRM code ${body.code}`);
      return {
        distanceM: Math.round(r.distance),
        durationS: Math.round(r.duration),
        polyline: r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
        provider: 'osrm',
      };
    } catch (err) {
      this.logger.warn(`OSRM routing failed, using fallback: ${(err as Error).message}`);
      return this.fallback.route(from, to, departAt);
    }
  }
}
