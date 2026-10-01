/**
 * Explainable driver-suitability scoring. This TypeScript implementation mirrors
 * ai-service/app/models/matching.py exactly and is used when the AI service is unavailable.
 * Keep the two in sync (both have unit tests asserting the same reference cases).
 */

export interface CandidateFeatures {
  driverId: string;
  distanceM: number;
  pickupEtaS: number;
  offersReceived: number;
  offersAccepted: number;
  tripsAssigned: number;
  tripsCompleted: number;
  driverCancellations: number;
  ratingAvg: number | null;
  ratingCount: number;
  /** 0..1 heading alignment / carpool route compatibility; 0.5 when unknown */
  routeCompatibility: number;
  /** 1 matches a stated passenger preference, 0.5 neutral, 0 stated preference not met */
  preferenceMatch: number;
  /** if provided (e.g. by the cancellation model) it is used as-is */
  cancelProbability?: number;
}

export interface ScoreComponent {
  value: number;
  weight: number;
  contribution: number;
}

export interface RankedCandidate {
  driverId: string;
  score: number;
  cancelProbability: number;
  breakdown: Record<string, ScoreComponent>;
  reasons: string[];
}

export const DEFAULT_WEIGHTS = {
  eta: 0.3,
  reliability: 0.25,
  acceptance: 0.1,
  completion: 0.1,
  rating: 0.1,
  route: 0.05,
  preference: 0.05,
  distance: 0.05,
} as const;
export type Weights = Record<keyof typeof DEFAULT_WEIGHTS, number>;

export const WEIGHTS_VERSION = 'weights-v1';
const MAX_ETA_S = 900;
const MAX_DISTANCE_M = 7000;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Beta(2,18)-smoothed cancellation rate (prior mean 10%), inflated for long pickups. */
export function baselineCancelProbability(f: Pick<CandidateFeatures, 'tripsAssigned' | 'driverCancellations' | 'distanceM'>): number {
  const base = (f.driverCancellations + 2) / (f.tripsAssigned + 20);
  const km = f.distanceM / 1000;
  return Math.min(0.95, base * (1 + 0.1 * Math.max(0, km - 2)));
}

export function scoreCandidate(f: CandidateFeatures, weights: Weights = DEFAULT_WEIGHTS): RankedCandidate {
  const cancelP = f.cancelProbability ?? baselineCancelProbability(f);
  const ratingSmoothed = f.ratingAvg === null ? 4.6 : (f.ratingAvg * f.ratingCount + 4.6 * 5) / (f.ratingCount + 5);
  const values: Record<keyof Weights, number> = {
    eta: 1 - Math.min(f.pickupEtaS, MAX_ETA_S) / MAX_ETA_S,
    reliability: 1 - cancelP,
    acceptance: (f.offersAccepted + 8) / (f.offersReceived + 10),
    completion: (f.tripsCompleted + 9) / (f.tripsAssigned + 10),
    rating: (ratingSmoothed - 1) / 4,
    route: clamp01(f.routeCompatibility),
    preference: clamp01(f.preferenceMatch),
    distance: 1 - Math.min(f.distanceM, MAX_DISTANCE_M) / MAX_DISTANCE_M,
  };
  const breakdown: Record<string, ScoreComponent> = {};
  let score = 0;
  for (const key of Object.keys(weights) as (keyof Weights)[]) {
    const value = clamp01(values[key]);
    const contribution = value * weights[key];
    breakdown[key] = { value: round4(value), weight: weights[key], contribution: round4(contribution) };
    score += contribution;
  }
  return { driverId: f.driverId, score: round4(score), cancelProbability: round4(cancelP), breakdown, reasons: reasonsFor(f, cancelP) };
}

export function rankCandidates(candidates: CandidateFeatures[], weights: Weights = DEFAULT_WEIGHTS): RankedCandidate[] {
  return candidates
    .map((c) => scoreCandidate(c, weights))
    .sort((a, b) => b.score - a.score || a.driverId.localeCompare(b.driverId));
}

function reasonsFor(f: CandidateFeatures, cancelP: number): string[] {
  const r: string[] = [`${Math.max(1, Math.round(f.pickupEtaS / 60))} min pickup ETA`];
  if (cancelP <= 0.05) r.push('very low cancellation likelihood');
  else if (cancelP >= 0.15) r.push('higher cancellation likelihood');
  if (f.ratingCount >= 20 && (f.ratingAvg ?? 0) >= 4.7) r.push('consistently high ratings');
  if (f.tripsAssigned >= 20 && f.tripsCompleted / Math.max(1, f.tripsAssigned) >= 0.95) r.push('high completion reliability');
  if (f.preferenceMatch === 1) r.push('matches your preferences');
  return r;
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;
