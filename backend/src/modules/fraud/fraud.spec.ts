import { evaluateRules, FraudSignals, scoreHits } from './fraud.rules';

const clean: FraudSignals = { accountsOnSameDevice: 1, cancellations24h: 0, driverCancellations24h: 0, paymentFailures24h: 0, gpsJumps24h: 0, promoRedemptions7d: 0, referralsWithNoRides: 0, repeatPairShortTrips7d: 0, accountAgeDays: 90 };

describe('fraud rules', () => {
  it('produces no hits for normal behaviour', () => {
    expect(evaluateRules(clean)).toEqual([]);
    expect(scoreHits([]).level).toBe('LOW');
  });
  it('flags a device shared by many accounts', () => {
    const hits = evaluateRules({ ...clean, accountsOnSameDevice: 5 });
    expect(hits.map((h) => h.rule)).toEqual(['DEVICE_MULTI_ACCOUNT']);
  });
  it('combines independent signals into HIGH risk', () => {
    const { level, score } = scoreHits(evaluateRules({ ...clean, accountsOnSameDevice: 4, promoRedemptions7d: 4, accountAgeDays: 2, paymentFailures24h: 5 }));
    expect(level).toBe('HIGH');
    expect(score).toBeGreaterThanOrEqual(60);
  });
  it('a single moderate signal stays MEDIUM, never auto-HIGH', () => {
    expect(scoreHits(evaluateRules({ ...clean, cancellations24h: 6 })).level).toBe('LOW');
    expect(scoreHits(evaluateRules({ ...clean, gpsJumps24h: 8 })).level).toBe('MEDIUM');
  });
  it('does not treat promo use on an established account as abuse', () => {
    expect(evaluateRules({ ...clean, promoRedemptions7d: 5, accountAgeDays: 200 })).toEqual([]);
  });
});
