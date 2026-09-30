/** Deterministic fraud rules (unit-tested). Output is INTERNAL ONLY: it is never returned to passengers or drivers. */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface FraudSignals {
  accountsOnSameDevice: number; // distinct accounts seen on any of this user's devices
  cancellations24h: number;
  driverCancellations24h: number;
  paymentFailures24h: number;
  gpsJumps24h: number;
  promoRedemptions7d: number;
  referralsWithNoRides: number; // referees who never completed a ride
  repeatPairShortTrips7d: number; // completed trips < 1.5 km with the same counterpart
  accountAgeDays: number;
}

export interface RuleHit {
  rule: string;
  weight: number;
  reason: string;
}

export function evaluateRules(s: FraudSignals): RuleHit[] {
  const hits: RuleHit[] = [];
  if (s.accountsOnSameDevice >= 3) {
    hits.push({ rule: 'DEVICE_MULTI_ACCOUNT', weight: Math.min(40, 15 + (s.accountsOnSameDevice - 3) * 8), reason: `${s.accountsOnSameDevice} accounts share a device` });
  }
  if (s.cancellations24h >= 4) hits.push({ rule: 'EXCESSIVE_CANCELLATIONS', weight: Math.min(30, 10 + (s.cancellations24h - 4) * 5), reason: `${s.cancellations24h} passenger cancellations in 24h` });
  if (s.driverCancellations24h >= 3) hits.push({ rule: 'DRIVER_CANCEL_PATTERN', weight: Math.min(30, 10 + (s.driverCancellations24h - 3) * 6), reason: `${s.driverCancellations24h} driver cancellations in 24h` });
  if (s.paymentFailures24h >= 3) hits.push({ rule: 'PAYMENT_FAILURES', weight: Math.min(35, 15 + (s.paymentFailures24h - 3) * 7), reason: `${s.paymentFailures24h} failed payments in 24h` });
  if (s.gpsJumps24h >= 5) hits.push({ rule: 'GPS_SPOOFING', weight: Math.min(45, 20 + (s.gpsJumps24h - 5) * 4), reason: `${s.gpsJumps24h} implausible location jumps today` });
  if (s.promoRedemptions7d >= 3 && s.accountAgeDays < 14) hits.push({ rule: 'PROMO_ABUSE', weight: 25, reason: `${s.promoRedemptions7d} promo redemptions on an account ${s.accountAgeDays} days old` });
  if (s.referralsWithNoRides >= 5) hits.push({ rule: 'REFERRAL_FARMING', weight: Math.min(40, 20 + (s.referralsWithNoRides - 5) * 4), reason: `${s.referralsWithNoRides} referred accounts never completed a ride` });
  if (s.repeatPairShortTrips7d >= 3) hits.push({ rule: 'COLLUSION_SHORT_TRIPS', weight: Math.min(45, 25 + (s.repeatPairShortTrips7d - 3) * 5), reason: `${s.repeatPairShortTrips7d} short trips with the same counterpart in 7 days` });
  return hits;
}

export function riskLevel(score: number): RiskLevel {
  return score >= 60 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW';
}

export function scoreHits(hits: RuleHit[]): { score: number; level: RiskLevel } {
  const score = Math.min(100, hits.reduce((s, h) => s + h.weight, 0));
  return { score, level: riskLevel(score) };
}
