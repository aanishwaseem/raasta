import { baselineCancelProbability, CandidateFeatures, rankCandidates, scoreCandidate } from './scoring';

const base: Omit<CandidateFeatures, 'driverId' | 'distanceM' | 'pickupEtaS'> = {
  offersReceived: 100,
  offersAccepted: 85,
  tripsAssigned: 80,
  tripsCompleted: 76,
  driverCancellations: 4,
  ratingAvg: 4.8,
  ratingCount: 60,
  routeCompatibility: 0.5,
  preferenceMatch: 0.5,
};

describe('matching scoring', () => {
  it('prefers the reliable driver over the nearest one (reference case from the product spec)', () => {
    const driverA = { ...base, driverId: 'A', distanceM: 1000, pickupEtaS: 240, cancelProbability: 0.15 };
    const driverB = { ...base, driverId: 'B', distanceM: 1600, pickupEtaS: 300, cancelProbability: 0.02 };
    const ranked = rankCandidates([driverA, driverB]);
    expect(ranked[0].driverId).toBe('B');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    // explanation is present and traceable
    expect(ranked[0].breakdown.reliability.value).toBeCloseTo(0.98, 3);
    expect(ranked[0].reasons).toContain('very low cancellation likelihood');
  });

  it('still prefers the nearest driver when reliability is equal', () => {
    const near = { ...base, driverId: 'near', distanceM: 800, pickupEtaS: 180, cancelProbability: 0.05 };
    const far = { ...base, driverId: 'far', distanceM: 4000, pickupEtaS: 720, cancelProbability: 0.05 };
    expect(rankCandidates([far, near])[0].driverId).toBe('near');
  });

  it('smooths cancellation probability for new drivers toward the 10% prior', () => {
    expect(baselineCancelProbability({ tripsAssigned: 0, driverCancellations: 0, distanceM: 1000 })).toBeCloseTo(0.1, 5);
    expect(baselineCancelProbability({ tripsAssigned: 200, driverCancellations: 0, distanceM: 1000 })).toBeLessThan(0.01);
    // long pickups raise the likelihood
    expect(baselineCancelProbability({ tripsAssigned: 0, driverCancellations: 0, distanceM: 6000 })).toBeCloseTo(0.14, 5);
  });

  it('keeps every component within [0,1] and the score within [0,1]', () => {
    const s = scoreCandidate({ ...base, driverId: 'x', distanceM: 99999, pickupEtaS: 99999, routeCompatibility: 7, preferenceMatch: -3 });
    for (const c of Object.values(s.breakdown)) {
      expect(c.value).toBeGreaterThanOrEqual(0);
      expect(c.value).toBeLessThanOrEqual(1);
    }
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(1);
  });
});
