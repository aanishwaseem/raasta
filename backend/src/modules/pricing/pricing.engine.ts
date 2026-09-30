/**
 * Fare intelligence (pure functions, unit-tested). No hidden surge: every adjustment is capped by
 * city configuration and explained in plain language.
 */

export interface PricingConfig {
  productCode: string;
  baseFare: number;
  perKm: number;
  perMinute: number;
  minimumFare: number;
  bookingFee: number;
  platformFeePct: number;
  fuelCostPerKm: number;
  maxSurgeMultiplier: number;
  minOfferPct: number;
  sharedDiscountPct: number;
  cancellationFee: number;
  freeCancelSeconds: number;
}

export interface MarketSnapshot {
  /** idle drivers of the right class within the pickup radius */
  idleDrivers: number;
  /** open (matching) requests near the pickup */
  openRequests: number;
  /** forecast level for the pickup zone */
  forecastLevel: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  zoneName: string | null;
  /** average agreed fare for similar recent trips (same zone & product), if enough data */
  historicalAvgFare: number | null;
  historicalSamples: number;
}

export interface FareBreakdown {
  base: number;
  distance: number;
  time: number;
  bookingFee: number;
  demandAdjustment: number;
  sharedDiscount: number;
}

export interface FareAdvice {
  estimated: number;
  recommended: number;
  minimumReasonable: number;
  low: number;
  high: number;
  demandMultiplier: number;
  breakdown: FareBreakdown;
  expectedMatchSeconds: { atRecommended: number | null; atMinimum: number | null };
  explanation: string[];
}

export const roundTo5 = (v: number) => Math.max(0, Math.round(v / 5) * 5);

export function demandMultiplier(m: MarketSnapshot, cap: number): number {
  const ratio = (m.openRequests + 1) / (m.idleDrivers + 1);
  let mult = 1 + 0.25 * Math.max(0, ratio - 1);
  if (m.forecastLevel === 'HIGH') mult += 0.05;
  return Math.round(Math.min(Math.max(1, mult), Math.max(1, cap)) * 100) / 100;
}

/** Heuristic time-to-match estimate (seconds). Replaced by a learned model once real data exists. */
export function expectedMatchSeconds(m: MarketSnapshot, offer: number, recommended: number): number | null {
  if (m.idleDrivers === 0) return null;
  const ratio = (m.openRequests + 1) / (m.idleDrivers + 1);
  const scarcity = m.idleDrivers < 3 ? 40 : 0;
  const base = 20 + 15 * ratio + scarcity;
  const priceFactor = Math.pow(recommended / Math.max(1, offer), 3);
  return Math.round(Math.min(900, base * priceFactor));
}

export function adviseFare(cfg: PricingConfig, distanceM: number, durationS: number, m: MarketSnapshot, opts: { shared?: boolean } = {}): FareAdvice {
  const km = distanceM / 1000;
  const minutes = durationS / 60;
  const base = cfg.baseFare;
  const distance = Math.round(cfg.perKm * km);
  const time = Math.round(cfg.perMinute * minutes);
  const metered = Math.max(cfg.minimumFare, base + distance + time);
  const estimated = roundTo5(metered + cfg.bookingFee);

  const mult = demandMultiplier(m, cfg.maxSurgeMultiplier);
  let recommended = roundTo5(estimated * mult);
  const demandAdjustment = recommended - estimated;
  let sharedDiscount = 0;
  if (opts.shared) {
    sharedDiscount = roundTo5(recommended * (cfg.sharedDiscountPct / 100));
    recommended -= sharedDiscount;
  }

  // Floor: a fare below this is unlikely to be accepted and may not cover the driver's fuel (+2 km avg pickup).
  const fuelFloor = Math.ceil(cfg.fuelCostPerKm * (km + 2) * 1.2);
  const minimumReasonable = roundTo5(Math.max(cfg.minimumFare, fuelFloor, recommended * (cfg.minOfferPct / 100)));
  const low = Math.min(minimumReasonable, recommended);
  const high = roundTo5(recommended * 1.15);

  const explanation: string[] = [];
  if (mult > 1) {
    const pct = Math.round((mult - 1) * 100);
    explanation.push(`Demand${m.zoneName ? ` near ${m.zoneName}` : ''} is higher than available drivers right now (+${pct}%).`);
  } else {
    explanation.push('Standard fare: enough drivers are available nearby.');
  }
  if (m.historicalAvgFare && m.historicalSamples >= 5) {
    explanation.push(`Recent similar trips averaged Rs ${roundTo5(m.historicalAvgFare)}.`);
  }
  const atRecommended = expectedMatchSeconds(m, recommended, recommended);
  const atMinimum = expectedMatchSeconds(m, minimumReasonable, recommended);
  if (atMinimum !== null && atRecommended !== null && minimumReasonable < recommended && atMinimum > atRecommended * 1.3) {
    explanation.push(`Offering Rs ${minimumReasonable} may increase your waiting time.`);
  }
  if (m.idleDrivers === 0) explanation.push('No drivers are free nearby right now; matching may take longer.');
  if (opts.shared && sharedDiscount > 0) explanation.push(`Sharing saves about Rs ${sharedDiscount}; the trip may take a little longer.`);

  return {
    estimated,
    recommended,
    minimumReasonable,
    low,
    high,
    demandMultiplier: mult,
    breakdown: { base, distance, time, bookingFee: cfg.bookingFee, demandAdjustment, sharedDiscount },
    expectedMatchSeconds: { atRecommended, atMinimum },
    explanation,
  };
}

/** Commission split for an agreed fare. */
export function platformFee(fare: number, pct: number): number {
  return Math.round((fare * pct) / 100);
}
