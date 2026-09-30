import { bearingDeg, bearingDiff, haversineM, LatLng } from '../../common/geo/geo';

export interface Trip {
  pickup: LatLng;
  dropoff: LatLng;
}

export interface CompatibilityResult {
  compatible: boolean;
  score: number; // 0..1, higher is better (used as the matching route-compatibility component)
  order: 'P1_P2_D1_D2' | 'P1_P2_D2_D1' | null;
  detourRatioExisting: number;
  detourRatioNew: number;
  pickupGapM: number;
  headingDiffDeg: number;
  reason: string;
}

export interface CarpoolLimits {
  maxDetourRatio: number; // e.g. 1.4 = at most 40% longer than a solo trip for either rider
  maxPickupGapM: number;
  maxHeadingDiffDeg: number;
}

export const DEFAULT_CARPOOL_LIMITS: CarpoolLimits = { maxDetourRatio: 1.4, maxPickupGapM: 2500, maxHeadingDiffDeg: 45 };

/** Road distance proxy (straight line × typical urban circuity). */
const road = (a: LatLng, b: LatLng) => haversineM(a, b) * 1.3;

/**
 * Can a new shared request (t2) be inserted into an existing shared trip (t1) whose pickup has not yet
 * happened? Both riders' in-vehicle distance must stay within the detour limit, pickups must be close,
 * and the trips must head the same way. Pure function, unit-tested.
 */
export function compatibility(t1: Trip, t2: Trip, limits: CarpoolLimits = DEFAULT_CARPOOL_LIMITS): CompatibilityResult {
  const solo1 = road(t1.pickup, t1.dropoff);
  const solo2 = road(t2.pickup, t2.dropoff);
  const pickupGapM = haversineM(t1.pickup, t2.pickup);
  const headingDiffDeg = bearingDiff(bearingDeg(t1.pickup, t1.dropoff), bearingDeg(t2.pickup, t2.dropoff));
  const base = { pickupGapM: Math.round(pickupGapM), headingDiffDeg: Math.round(headingDiffDeg) };

  if (pickupGapM > limits.maxPickupGapM) {
    return { compatible: false, score: 0, order: null, detourRatioExisting: Infinity, detourRatioNew: Infinity, ...base, reason: 'pickups too far apart' };
  }
  if (headingDiffDeg > limits.maxHeadingDiffDeg) {
    return { compatible: false, score: 0, order: null, detourRatioExisting: Infinity, detourRatioNew: Infinity, ...base, reason: 'different directions' };
  }
  const p1p2 = road(t1.pickup, t2.pickup);
  // Order A: P1 → P2 → D1 → D2
  const a1 = p1p2 + road(t2.pickup, t1.dropoff);
  const a2 = road(t2.pickup, t1.dropoff) + road(t1.dropoff, t2.dropoff);
  // Order B: P1 → P2 → D2 → D1
  const b1 = p1p2 + road(t2.pickup, t2.dropoff) + road(t2.dropoff, t1.dropoff);
  const b2 = road(t2.pickup, t2.dropoff);
  const options = [
    { order: 'P1_P2_D1_D2' as const, r1: a1 / solo1, r2: a2 / solo2 },
    { order: 'P1_P2_D2_D1' as const, r1: b1 / solo1, r2: b2 / solo2 },
  ].sort((x, y) => Math.max(x.r1, x.r2) - Math.max(y.r1, y.r2));
  const best = options[0];
  const worst = Math.max(best.r1, best.r2);
  const compatible = worst <= limits.maxDetourRatio;
  const score = compatible ? Math.max(0, 1 - (worst - 1) / (limits.maxDetourRatio - 1 || 1)) * 0.7 + (1 - headingDiffDeg / 180) * 0.3 : 0;
  return {
    compatible,
    score: Math.round(score * 1000) / 1000,
    order: best.order,
    detourRatioExisting: Math.round(best.r1 * 100) / 100,
    detourRatioNew: Math.round(best.r2 * 100) / 100,
    ...base,
    reason: compatible ? 'route overlap within detour limits' : 'detour too long',
  };
}
