import { rankCandidates, CandidateFeatures, baselineCancelProbability } from '../src/modules/matching/scoring';
import { evaluateRules, scoreHits, FraudSignals } from '../src/modules/fraud/fraud.rules';
import { writeFileSync } from 'fs';

const base: Omit<CandidateFeatures, 'driverId'> = { distanceM: 1000, pickupEtaS: 240, offersReceived: 40, offersAccepted: 32, tripsAssigned: 30, tripsCompleted: 29, driverCancellations: 1, ratingAvg: 4.8, ratingCount: 30, routeCompatibility: 0.5, preferenceMatch: 0.5 };
const cands: CandidateFeatures[][] = [
  [{ ...base, driverId: 'A', distanceM: 1000, pickupEtaS: 240, driverCancellations: 4.5, tripsAssigned: 30 }, { ...base, driverId: 'B', distanceM: 1600, pickupEtaS: 300, driverCancellations: 0 }],
  [{ ...base, driverId: 'new1', offersReceived: 0, offersAccepted: 0, tripsAssigned: 0, tripsCompleted: 0, driverCancellations: 0, ratingAvg: null, ratingCount: 0 }, { ...base, driverId: 'far', distanceM: 6500, pickupEtaS: 880 }, { ...base, driverId: 'pref', preferenceMatch: 1, routeCompatibility: 0.9 }],
  [{ ...base, driverId: 'explicit', cancelProbability: 0.5 }, { ...base, driverId: 'tie1' }, { ...base, driverId: 'tie0' }],
  [{ ...base, driverId: 'x', distanceM: 20000, pickupEtaS: 5000, routeCompatibility: 2, preferenceMatch: -1 }],
];
const fraud: FraudSignals[] = [
  { accountsOnSameDevice: 1, cancellations24h: 0, driverCancellations24h: 0, paymentFailures24h: 0, gpsJumps24h: 0, promoRedemptions7d: 0, referralsWithNoRides: 0, repeatPairShortTrips7d: 0, accountAgeDays: 100 },
  { accountsOnSameDevice: 5, cancellations24h: 6, driverCancellations24h: 0, paymentFailures24h: 4, gpsJumps24h: 0, promoRedemptions7d: 3, referralsWithNoRides: 0, repeatPairShortTrips7d: 0, accountAgeDays: 3 },
  { accountsOnSameDevice: 9, cancellations24h: 12, driverCancellations24h: 8, paymentFailures24h: 9, gpsJumps24h: 12, promoRedemptions7d: 9, referralsWithNoRides: 15, repeatPairShortTrips7d: 9, accountAgeDays: 1 },
  { accountsOnSameDevice: 3, cancellations24h: 4, driverCancellations24h: 3, paymentFailures24h: 3, gpsJumps24h: 5, promoRedemptions7d: 3, referralsWithNoRides: 5, repeatPairShortTrips7d: 3, accountAgeDays: 14 },
];
writeFileSync('../ai-service/tests/data/parity_fixtures.json', JSON.stringify({
  matching: cands.map((c) => ({ candidates: c, expected: rankCandidates(c) })),
  baselineCancel: [{ tripsAssigned: 0, driverCancellations: 0, distanceM: 500 }, { tripsAssigned: 100, driverCancellations: 30, distanceM: 6000 }, { tripsAssigned: 5, driverCancellations: 5, distanceM: 30000 }].map((x) => ({ input: x, expected: baselineCancelProbability(x) })),
  fraud: fraud.map((s) => ({ signals: s, hits: evaluateRules(s), ...scoreHits(evaluateRules(s)) })),
}, null, 1));
console.log('ok');
