import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../config/config';
import { MetricsService } from '../../common/metrics/metrics.service';
import { CandidateFeatures, rankCandidates, RankedCandidate, WEIGHTS_VERSION } from '../matching/scoring';

export interface EtaItem {
  kind: 'PICKUP' | 'TRIP';
  distanceM: number;
  providerDurationS: number;
  hour: number;
  weekday: number; // ISO 1..7
  cityId: string;
  zoneCode?: string | null;
  vehicleClass?: string;
}
export interface EtaPrediction {
  etaS: number;
  model: string;
  version: string;
  fallback: boolean;
}

export interface DemandZoneInput {
  zoneId: string;
  code: string;
  recentRequests1h: number;
  onlineDrivers: number;
}
export interface DemandForecast {
  zoneId: string;
  expectedRequests: number;
  onlineDrivers: number;
  supplyGap: number;
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  confidence: 'low' | 'medium' | 'high';
  model: string;
  version: string;
}

export interface NluResult {
  intent: string;
  language: string;
  confidence: number;
  slots: {
    pickup?: string | null;
    dropoff?: string | null;
    datetime?: string | null;
    datetimeText?: string | null;
    productCode?: string | null;
    preference?: 'CHEAPEST' | 'FASTEST' | null;
    period?: string | null;
  };
  missing: string[];
  engine: string;
}

export interface FraudScore {
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  score: number;
  reasons: string[];
  model: string;
}

export interface AiCallMeta {
  model: string;
  version: string;
  fallback: boolean;
  latencyMs: number;
}

const VEHICLE_ETA_FACTOR: Record<string, number> = { BIKE: 0.85, ECONOMY: 1, COMFORT: 1, PREMIUM: 1, XL: 1.05 };

/**
 * Client for the Python AI service. Every call has a hard timeout and a deterministic local fallback,
 * so the ride flow never depends on the AI service being up (cold start and outage behaviour).
 */
@Injectable()
export class AiClient {
  private readonly logger = new Logger(AiClient.name);

  constructor(private readonly metrics: MetricsService) {}

  async predictEta(items: EtaItem[]): Promise<EtaPrediction[]> {
    if (!items.length) return [];
    const res = await this.call<{ predictions: { eta_s: number; model: string; version: string; fallback: boolean }[] }>('/v1/eta/predict', {
      items: items.map((i) => ({
        kind: i.kind,
        distance_m: i.distanceM,
        provider_duration_s: i.providerDurationS,
        hour: i.hour,
        weekday: i.weekday,
        city_id: i.cityId,
        zone_code: i.zoneCode ?? null,
        vehicle_class: i.vehicleClass ?? 'ECONOMY',
      })),
    });
    if (res && res.predictions.length === items.length) {
      return res.predictions.map((p) => ({ etaS: Math.round(p.eta_s), model: p.model, version: p.version, fallback: p.fallback }));
    }
    return items.map((i) => ({
      etaS: Math.round(i.providerDurationS * (VEHICLE_ETA_FACTOR[i.vehicleClass ?? 'ECONOMY'] ?? 1)),
      model: 'provider-eta',
      version: 'local',
      fallback: true,
    }));
  }

  async rank(candidates: CandidateFeatures[], context: Record<string, unknown>): Promise<{ ranked: RankedCandidate[]; meta: AiCallMeta }> {
    const started = Date.now();
    const res = await this.call<{ ranked: RankedCandidate[]; model: string; version: string }>('/v1/matching/rank', { candidates, context });
    if (res?.ranked?.length === candidates.length) {
      return { ranked: res.ranked, meta: { model: res.model, version: res.version, fallback: false, latencyMs: Date.now() - started } };
    }
    return {
      ranked: rankCandidates(candidates),
      meta: { model: 'weighted-scoring', version: `${WEIGHTS_VERSION}-local`, fallback: true, latencyMs: Date.now() - started },
    };
  }

  async demandForecast(cityId: string, at: Date, zones: DemandZoneInput[]): Promise<DemandForecast[]> {
    if (!zones.length) return [];
    const res = await this.call<{ forecasts: { zone_id: string; expected_requests: number; online_drivers: number; supply_gap: number; level: DemandForecast['level']; confidence: DemandForecast['confidence']; model: string; version: string }[] }>(
      '/v1/demand/forecast',
      {
        city_id: cityId,
        at: at.toISOString(),
        zones: zones.map((z) => ({ zone_id: z.zoneId, code: z.code, recent_requests_1h: z.recentRequests1h, online_drivers: z.onlineDrivers })),
      },
      800,
    );
    if (res?.forecasts?.length) {
      return res.forecasts.map((f) => ({
        zoneId: f.zone_id,
        expectedRequests: f.expected_requests,
        onlineDrivers: f.online_drivers,
        supplyGap: f.supply_gap,
        level: f.level,
        confidence: f.confidence,
        model: f.model,
        version: f.version,
      }));
    }
    return persistenceForecast(zones);
  }

  async nlu(text: string, now: Date, timezone: string, locale?: string): Promise<NluResult | null> {
    return this.call<NluResult>('/v1/nlu/parse', { text, now: now.toISOString(), timezone, locale: locale ?? null }, 4000);
  }

  async fraudScore(signals: Record<string, number>): Promise<FraudScore | null> {
    return this.call<FraudScore>('/v1/fraud/score', { signals });
  }

  async models(): Promise<unknown> {
    return this.call('/v1/models', undefined, 2000, 'GET');
  }

  async train(models: string[]): Promise<unknown> {
    return this.call('/v1/training/run', { models }, 120_000);
  }

  async reloadModels(): Promise<unknown> {
    return this.call('/v1/models/reload', {}, 5000);
  }

  async health(): Promise<boolean> {
    const r = await this.call<{ status: string }>('/health', undefined, 1500, 'GET');
    return r?.status === 'ok';
  }

  private async call<T>(path: string, body?: unknown, timeoutMs = config().AI_TIMEOUT_MS, method: 'GET' | 'POST' = 'POST'): Promise<T | null> {
    const started = process.hrtime.bigint();
    try {
      const res = await fetch(`${config().AI_SERVICE_URL}${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-internal-token': config().AI_INTERNAL_TOKEN },
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      const reason = (err as Error).name === 'TimeoutError' ? 'timeout' : 'error';
      this.metrics.aiFallbacks.inc({ endpoint: path, reason });
      this.logger.debug(`AI call ${path} failed (${reason}): ${(err as Error).message}`);
      return null;
    } finally {
      this.metrics.aiLatency.observe({ endpoint: path }, Number(process.hrtime.bigint() - started) / 1e9);
    }
  }
}

/** Fallback when the AI service is unavailable: next hour ≈ last hour. Levels by supply ratio. */
export function persistenceForecast(zones: DemandZoneInput[]): DemandForecast[] {
  return zones.map((z) => {
    const expected = z.recentRequests1h;
    const gap = expected - z.onlineDrivers;
    const ratio = expected / Math.max(1, z.onlineDrivers);
    const level: DemandForecast['level'] = expected >= 3 && ratio >= 1.5 ? 'HIGH' : expected >= 1 && ratio >= 0.7 ? 'MEDIUM' : 'LOW';
    return { zoneId: z.zoneId, expectedRequests: expected, onlineDrivers: z.onlineDrivers, supplyGap: gap, level, confidence: 'low', model: 'persistence', version: 'local' };
  });
}
