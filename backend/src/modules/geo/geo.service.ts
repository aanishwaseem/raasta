import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../common/db/database.service';
import { AppError } from '../../common/errors/app-error';
import { latLngSql } from '../../common/dto';
import type { LatLng } from '../../common/geo/geo';
import { config } from '../../config/config';

export interface City {
  id: string;
  slug: string;
  name: string;
  nameUr: string | null;
  timezone: string;
  currency: string;
  center: LatLng;
  settings: CitySettings;
}

export interface CitySettings {
  deviationThresholdM?: number;
  maxPickupRadiusKm?: number;
  carpoolMaxDetourRatio?: number;
}

export interface PlaceResult {
  id: string;
  name: string;
  address: string | null;
  category: string;
  location: LatLng;
  cityId: string;
  source: 'local' | 'nominatim';
}

@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);
  private citiesCache: { at: number; cities: City[] } | null = null;

  constructor(private readonly db: DatabaseService) {}

  async cities(): Promise<City[]> {
    if (this.citiesCache && Date.now() - this.citiesCache.at < 60_000) return this.citiesCache.cities;
    const cities = await this.db.query<City>(
      `SELECT id, slug, name, name_ur AS "nameUr", timezone, currency, ${latLngSql('center')}, settings
         FROM cities WHERE active ORDER BY name`,
    );
    this.citiesCache = { at: Date.now(), cities };
    return cities;
  }

  invalidateCache() {
    this.citiesCache = null;
  }

  async city(id: string): Promise<City> {
    const c = (await this.cities()).find((x) => x.id === id);
    if (!c) throw AppError.notFound('City');
    return c;
  }

  /** The active service area covering a point, or null when outside every service area. */
  async serviceAreaAt(p: LatLng): Promise<{ cityId: string; areaName: string; kind: string } | null> {
    return this.db.one(
      `SELECT sa.city_id AS "cityId", sa.name AS "areaName", sa.kind
         FROM service_areas sa JOIN cities c ON c.id = sa.city_id AND c.active
        WHERE sa.active AND sa.kind <> 'RESTRICTED' AND ST_Covers(sa.boundary, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography)
        ORDER BY CASE sa.kind WHEN 'SERVICE' THEN 1 ELSE 0 END
        LIMIT 1`,
      [p.lng, p.lat],
    );
  }

  async isRestricted(p: LatLng): Promise<boolean> {
    const r = await this.db.one(
      `SELECT 1 FROM service_areas WHERE active AND kind = 'RESTRICTED'
          AND ST_Covers(boundary, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) LIMIT 1`,
      [p.lng, p.lat],
    );
    return !!r;
  }

  async requireServiceable(p: LatLng, what: 'pickup' | 'destination'): Promise<{ cityId: string; areaName: string }> {
    const area = await this.serviceAreaAt(p);
    if (!area || (await this.isRestricted(p))) {
      throw AppError.unprocessable('OUT_OF_SERVICE_AREA', `Sorry, we don't serve this ${what} yet`, { what });
    }
    return area;
  }

  async zoneAt(p: LatLng): Promise<{ id: string; code: string; name: string } | null> {
    return this.db.one(
      `SELECT id, code, name FROM demand_zones
        WHERE active AND ST_Covers(boundary, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) LIMIT 1`,
      [p.lng, p.lat],
    );
  }

  async nearestZone(p: LatLng, cityId: string) {
    return this.db.one<{ id: string; code: string; name: string; distanceM: number }>(
      `SELECT id, code, name, ST_Distance(centroid, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS "distanceM"
         FROM demand_zones WHERE active AND city_id = $3
        ORDER BY centroid <-> ST_SetSRID(ST_MakePoint($1,$2),4326)::geography LIMIT 1`,
      [p.lng, p.lat, cityId],
    );
  }

  async zones(cityId: string) {
    return this.db.query<{ id: string; code: string; name: string; centroid: LatLng; boundary: string }>(
      `SELECT id, code, name, ${latLngSql('centroid')}, ST_AsGeoJSON(boundary) AS boundary
         FROM demand_zones WHERE active AND city_id = $1 ORDER BY name`,
      [cityId],
    );
  }

  async searchPlaces(q: string, near?: LatLng, cityId?: string, limit = 8): Promise<PlaceResult[]> {
    const query = q.trim().toLowerCase();
    if (query.length < 2) return [];
    const local = await this.db.query<PlaceResult & { score: number }>(
      `SELECT id, name, address, category, city_id AS "cityId", ${latLngSql('location')}, 'local' AS source,
              greatest(similarity(search_text, $1), word_similarity($1, search_text))
                + CASE WHEN search_text LIKE $1 || '%' THEN 0.3 WHEN search_text LIKE '%' || $1 || '%' THEN 0.15 ELSE 0 END
                + least(popularity, 100) / 1000.0
                - CASE WHEN $2::float8 IS NULL THEN 0
                       ELSE least(ST_Distance(location, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography) / 200000.0, 0.3) END AS score
         FROM places
        WHERE ($4::uuid IS NULL OR city_id = $4)
          AND (search_text % $1 OR search_text LIKE '%' || $1 || '%' OR $1 <% search_text)
        ORDER BY score DESC LIMIT $5`,
      [query, near?.lng ?? null, near?.lat ?? null, cityId ?? null, limit],
    );
    if (local.length || config().PLACES_PROVIDER !== 'nominatim') return local.map(({ score: _s, ...p }) => p);
    return this.nominatim(query, limit);
  }

  async reverse(p: LatLng): Promise<{ name: string; address: string; zone: string | null; cityId: string | null }> {
    const place = await this.db.one<{ name: string; address: string | null; city_id: string; d: number }>(
      `SELECT name, address, city_id, ST_Distance(location, ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS d
         FROM places ORDER BY location <-> ST_SetSRID(ST_MakePoint($1,$2),4326)::geography LIMIT 1`,
      [p.lng, p.lat],
    );
    const zone = await this.zoneAt(p);
    const area = await this.serviceAreaAt(p);
    const name = place && place.d < 400 ? place.name : zone ? `Near ${zone.name}` : 'Pinned location';
    return {
      name,
      address: place && place.d < 400 ? place.address ?? place.name : `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`,
      zone: zone?.name ?? null,
      cityId: area?.cityId ?? place?.city_id ?? null,
    };
  }

  /** Optional OSM Nominatim lookup (respect its usage policy: low volume, identify the app). */
  private async nominatim(q: string, limit: number): Promise<PlaceResult[]> {
    try {
      const url = `${config().NOMINATIM_URL}/search?format=jsonv2&countrycodes=pk&limit=${limit}&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Raasta/0.1 (development)' }, signal: AbortSignal.timeout(2500) });
      if (!res.ok) return [];
      const rows = (await res.json()) as { place_id: number; name: string; display_name: string; lat: string; lon: string; type: string }[];
      const out: PlaceResult[] = [];
      for (const r of rows) {
        const location = { lat: Number(r.lat), lng: Number(r.lon) };
        const area = await this.serviceAreaAt(location);
        if (!area) continue;
        out.push({ id: `osm:${r.place_id}`, name: r.name || r.display_name.split(',')[0], address: r.display_name, category: r.type.toUpperCase(), location, cityId: area.cityId, source: 'nominatim' });
      }
      return out;
    } catch (err) {
      this.logger.warn(`Nominatim failed: ${(err as Error).message}`);
      return [];
    }
  }
}
