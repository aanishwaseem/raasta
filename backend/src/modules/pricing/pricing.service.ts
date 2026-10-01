import { Injectable } from '@nestjs/common';
import { config } from '../../config/config';
import { DatabaseService } from '../../common/db/database.service';
import { AppError } from '../../common/errors/app-error';
import { haversineM, LatLng, toWktLine } from '../../common/geo/geo';
import { GeoService } from '../geo/geo.service';
import { localHourPk, RoutingProvider } from '../geo/routing.provider';
import { DriverPresenceService } from '../drivers/driver-presence.service';
import { AiClient } from '../ai/ai.client';
import { DemandService } from '../ai/demand.service';
import { PromoPreview, PromotionsService } from '../promotions/promotions.service';
import { adviseFare, FareAdvice, MarketSnapshot, PricingConfig } from './pricing.engine';

export interface Product {
  code: string;
  name: string;
  description: string;
  vehicleClass: string;
  capacity: number;
  isShared: boolean;
}

export interface QuoteOption {
  productCode: string;
  name: string;
  description: string;
  vehicleClass: string;
  capacity: number;
  isShared: boolean;
  fare: FareAdvice & { discount: number; payable: number };
  pickupEtaS: number | null;
  tripEtaS: number;
  availability: 'GOOD' | 'LIMITED' | 'NONE';
  nearbyDrivers: number;
  etaModel: string;
}

export interface Recommendation {
  kind: 'CHEAPEST' | 'FASTEST' | 'BALANCED' | 'SHARED';
  productCode: string;
  fare: number;
  pickupEtaS: number | null;
  tripEtaS: number;
  reasons: string[];
}

export interface Quote {
  id: string;
  expiresAt: string;
  cityId: string;
  pickup: LatLng & { address: string };
  dropoff: LatLng & { address: string };
  distanceM: number;
  durationS: number;
  route: [number, number][];
  options: QuoteOption[];
  recommendations: Recommendation[];
  promo: PromoPreview | null;
  promoError: string | null;
  context: { demandLevel: string | null; zoneName: string | null; routingProvider: string };
}

const PICKUP_SEARCH_KM = 4;

@Injectable()
export class PricingService {
  private configCache = new Map<string, { at: number; cfg: PricingConfig }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly geo: GeoService,
    private readonly routing: RoutingProvider,
    private readonly presence: DriverPresenceService,
    private readonly ai: AiClient,
    private readonly demand: DemandService,
    private readonly promotions: PromotionsService,
  ) {}

  async products(cityId?: string): Promise<Product[]> {
    return this.db.query<Product>(
      `SELECT p.code, p.name, p.description, p.vehicle_class AS "vehicleClass", p.capacity, p.is_shared AS "isShared"
         FROM ride_products p
        WHERE p.active AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM pricing_configs c WHERE c.product_code = p.code AND c.city_id = $1 AND c.active))
        ORDER BY p.sort_order`,
      [cityId ?? null],
    );
  }

  async config(cityId: string, productCode: string): Promise<PricingConfig> {
    const key = `${cityId}:${productCode}`;
    const hit = this.configCache.get(key);
    if (hit && Date.now() - hit.at < 30_000) return hit.cfg;
    const cfg = await this.db.one<PricingConfig>(
      `SELECT product_code AS "productCode", base_fare AS "baseFare", per_km AS "perKm", per_minute AS "perMinute",
              minimum_fare AS "minimumFare", booking_fee AS "bookingFee", platform_fee_pct AS "platformFeePct",
              fuel_cost_per_km AS "fuelCostPerKm", max_surge_multiplier AS "maxSurgeMultiplier", min_offer_pct AS "minOfferPct",
              shared_discount_pct AS "sharedDiscountPct", cancellation_fee AS "cancellationFee", free_cancel_seconds AS "freeCancelSeconds"
         FROM pricing_configs WHERE city_id = $1 AND product_code = $2 AND active`,
      [cityId, productCode],
    );
    if (!cfg) throw AppError.unprocessable('PRODUCT_UNAVAILABLE', 'This ride type is not available in this city');
    this.configCache.set(key, { at: Date.now(), cfg });
    return cfg;
  }

  invalidateCache() {
    this.configCache.clear();
  }

  async quote(
    passengerId: string,
    pickup: LatLng & { address: string },
    dropoff: LatLng & { address: string },
    opts: { promoCode?: string; corporateId?: string | null; seats?: number } = {},
  ): Promise<Quote> {
    const pickupArea = await this.geo.requireServiceable(pickup, 'pickup');
    const dropArea = await this.geo.requireServiceable(dropoff, 'destination');
    if (pickupArea.cityId !== dropArea.cityId) {
      throw AppError.unprocessable('INTERCITY_NOT_SUPPORTED', 'For trips between cities, please use Intercity');
    }
    if (haversineM(pickup, dropoff) < 200) throw AppError.unprocessable('TRIP_TOO_SHORT', 'Pickup and destination are too close');
    const cityId = pickupArea.cityId;
    const now = new Date();
    const hour = localHourPk(now);
    const weekday = ((now.getUTCDay() + 6) % 7) + 1;

    const [route, zone, products] = await Promise.all([this.routing.route(pickup, dropoff, now), this.geo.zoneAt(pickup), this.products(cityId)]);
    const zoneDemand = await this.demand.levelAt(cityId, zone?.id ?? null);
    const nearby = await this.presence.nearby(cityId, pickup, PICKUP_SEARCH_KM, 100);
    const openRequests = await this.db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM rides WHERE status = 'MATCHING' AND city_id = $1
          AND ST_DWithin(pickup, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography, 3000)`,
      [cityId, pickup.lng, pickup.lat],
    );
    const profile = await this.db.one<{ typical_fare_low: number | null; typical_fare_high: number | null; preferred_product: string | null }>(
      `SELECT mp.typical_fare_low, mp.typical_fare_high, mp.preferred_product FROM mobility_profiles mp
         JOIN users u ON u.id = mp.user_id AND u.personalization_enabled WHERE mp.user_id = $1`,
      [passengerId],
    );

    // Per product: market snapshot, fare advice, ETA predictions
    const etaItems: Parameters<AiClient['predictEta']>[0] = [];
    const drafts: { p: Product; cfg: PricingConfig; market: MarketSnapshot; nearest: (typeof nearby)[number] | undefined; count: number }[] = [];
    for (const p of products) {
      if (opts.seats && opts.seats > p.capacity) continue;
      const cfg = await this.config(cityId, p.code);
      const classDrivers = nearby.filter((d) => d.vehicleClass === p.vehicleClass && (d.status === 'IDLE' || (p.isShared && d.status === 'ON_TRIP')));
      const idle = classDrivers.filter((d) => d.status === 'IDLE');
      const hist = await this.db.one<{ avg: number | null; n: number }>(
        `SELECT avg(offered_fare)::int AS avg, count(*)::int AS n FROM rides
          WHERE status = 'COMPLETED' AND city_id = $1 AND product_code = $2 AND completed_at > now() - interval '30 days'
            AND ST_DWithin(pickup, ST_SetSRID(ST_MakePoint($3,$4),4326)::geography, 1500)
            AND ST_DWithin(dropoff, ST_SetSRID(ST_MakePoint($5,$6),4326)::geography, 1500)`,
        [cityId, p.code, pickup.lng, pickup.lat, dropoff.lng, dropoff.lat],
      );
      const market: MarketSnapshot = {
        idleDrivers: idle.length,
        openRequests: openRequests?.n ?? 0,
        forecastLevel: zoneDemand?.level ?? null,
        zoneName: zone?.name ?? null,
        historicalAvgFare: hist?.avg ?? null,
        historicalSamples: hist?.n ?? 0,
      };
      const nearest = idle[0] ?? classDrivers[0];
      drafts.push({ p, cfg, market, nearest, count: classDrivers.length });
      etaItems.push({ kind: 'TRIP', distanceM: route.distanceM, providerDurationS: route.durationS, hour, weekday, cityId, zoneCode: zone?.code, vehicleClass: p.vehicleClass });
      if (nearest) {
        const pickupDurS = Math.round((nearest.distanceM * 1.3) / ((route.distanceM / route.durationS) || 6)) + 60;
        etaItems.push({ kind: 'PICKUP', distanceM: Math.round(nearest.distanceM * 1.3), providerDurationS: pickupDurS, hour, weekday, cityId, zoneCode: zone?.code, vehicleClass: p.vehicleClass });
      }
    }
    const etas = await this.ai.predictEta(etaItems);

    let promo: PromoPreview | null = null;
    let promoError: string | null = null;
    const options: QuoteOption[] = [];
    let etaIdx = 0;
    for (const d of drafts) {
      const trip = etas[etaIdx++];
      const pickupEta = d.nearest ? etas[etaIdx++] : null;
      const tripEtaS = d.p.isShared ? Math.round(trip.etaS * 1.25) : trip.etaS; // detour allowance for pooled trips
      const advice = adviseFare(d.cfg, route.distanceM, route.durationS, d.market, { shared: d.p.isShared });
      let discount = 0;
      if (opts.promoCode) {
        try {
          const preview = await this.promotions.preview(opts.promoCode, passengerId, { cityId, productCode: d.p.code, fare: advice.recommended, corporateId: opts.corporateId });
          discount = preview.discount;
          promo = promo && promo.discount >= preview.discount ? promo : preview;
        } catch (err) {
          promoError = err instanceof AppError ? err.message : 'This promo code is not valid';
        }
      }
      if (profile?.typical_fare_low && profile.typical_fare_high && advice.recommended >= profile.typical_fare_low && advice.recommended <= profile.typical_fare_high) {
        advice.explanation.push('Within your usual price range.');
      }
      options.push({
        productCode: d.p.code,
        name: d.p.name,
        description: d.p.description,
        vehicleClass: d.p.vehicleClass,
        capacity: d.p.capacity,
        isShared: d.p.isShared,
        fare: { ...advice, discount, payable: Math.max(0, advice.recommended - discount) },
        pickupEtaS: pickupEta?.etaS ?? null,
        tripEtaS,
        availability: d.count === 0 ? 'NONE' : d.count < 3 ? 'LIMITED' : 'GOOD',
        nearbyDrivers: d.count,
        etaModel: `${trip.model}@${trip.version}`,
      });
    }
    if (promo && options.every((o) => o.fare.discount === 0)) promo = null;
    if (promo) promoError = null;
    if (!options.length) throw AppError.unprocessable('NO_PRODUCTS', 'No ride types are available for this trip');

    const recommendations = recommend(options, profile?.preferred_product ?? null);
    const expiresAt = new Date(Date.now() + config().QUOTE_TTL_S * 1000);
    const context = { demandLevel: zoneDemand?.level ?? null, zoneName: zone?.name ?? null, routingProvider: route.provider, openRequests: openRequests?.n ?? 0 };
    const row = await this.db.one<{ id: string }>(
      `INSERT INTO ride_quotes (passenger_id, city_id, pickup, pickup_address, dropoff, dropoff_address, distance_m, duration_s, route, options, context, expires_at)
       VALUES ($1,$2, ST_SetSRID(ST_MakePoint($3,$4),4326)::geography, $5, ST_SetSRID(ST_MakePoint($6,$7),4326)::geography, $8, $9, $10,
               ST_GeogFromText($11), $12, $13, $14) RETURNING id`,
      [passengerId, cityId, pickup.lng, pickup.lat, pickup.address, dropoff.lng, dropoff.lat, dropoff.address, route.distanceM, route.durationS,
        toWktLine(route.polyline), JSON.stringify({ options, promo, corporateId: opts.corporateId ?? null }), JSON.stringify(context), expiresAt],
    );
    return {
      id: row!.id,
      expiresAt: expiresAt.toISOString(),
      cityId,
      pickup,
      dropoff,
      distanceM: route.distanceM,
      durationS: route.durationS,
      route: route.polyline.map((p) => [Math.round(p.lat * 1e6) / 1e6, Math.round(p.lng * 1e6) / 1e6]),
      options,
      recommendations,
      promo,
      promoError,
      context: { demandLevel: context.demandLevel, zoneName: context.zoneName, routingProvider: context.routingProvider },
    };
  }
}

/** Multi-objective options. Every recommendation carries its reasons; nothing is hidden. */
export function recommend(options: QuoteOption[], preferredProduct: string | null): Recommendation[] {
  const available = options.filter((o) => o.availability !== 'NONE');
  const pool = available.length ? available : options;
  const solo = pool.filter((o) => !o.isShared);
  const out: Recommendation[] = [];
  const total = (o: QuoteOption) => (o.pickupEtaS ?? 900) + o.tripEtaS;
  const toRec = (kind: Recommendation['kind'], o: QuoteOption, reasons: string[]): Recommendation => ({
    kind,
    productCode: o.productCode,
    fare: o.fare.payable,
    pickupEtaS: o.pickupEtaS,
    tripEtaS: o.tripEtaS,
    reasons,
  });
  if (solo.length) {
    const cheapest = [...solo].sort((a, b) => a.fare.payable - b.fare.payable)[0];
    out.push(toRec('CHEAPEST', cheapest, [`Lowest fare: Rs ${cheapest.fare.payable}`]));
    const fastest = [...solo].sort((a, b) => total(a) - total(b) || a.fare.payable - b.fare.payable)[0];
    out.push(toRec('FASTEST', fastest, [`Arrives soonest: about ${Math.round(total(fastest) / 60)} min door to door`]));
    const minFare = Math.min(...solo.map((o) => o.fare.payable));
    const minTime = Math.min(...solo.map(total));
    const balancedScore = (o: QuoteOption) => o.fare.payable / minFare + total(o) / minTime - (o.productCode === preferredProduct ? 0.05 : 0);
    const balanced = [...solo].sort((a, b) => balancedScore(a) - balancedScore(b))[0];
    const reasons = [`${Math.max(1, Math.round((balanced.pickupEtaS ?? 0) / 60))} min pickup`, `Rs ${balanced.fare.payable}`];
    if (balanced.productCode === preferredProduct) reasons.push('your usual ride type');
    if (balanced.availability === 'GOOD') reasons.push('good driver availability');
    out.push(toRec('BALANCED', balanced, reasons));
  }
  const shared = pool.find((o) => o.isShared);
  if (shared) {
    const soloEquivalent = solo.find((o) => o.vehicleClass === shared.vehicleClass);
    const saving = soloEquivalent ? soloEquivalent.fare.payable - shared.fare.payable : 0;
    out.push(toRec('SHARED', shared, saving > 0 ? [`Share and save about Rs ${saving}`, 'may take a few minutes longer'] : ['Shared with riders going your way']));
  }
  return out;
}
