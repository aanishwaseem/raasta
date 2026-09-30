import { compatibility } from './carpool';

// Real Lahore landmarks (approximate coordinates)
const dhaPhase5 = { lat: 31.4637, lng: 74.4078 };
const dhaPhase5b = { lat: 31.4663, lng: 74.4012 };
const gulbergLiberty = { lat: 31.5102, lng: 74.3441 };
const mmAlam = { lat: 31.5165, lng: 74.3522 };
const johar = { lat: 31.4697, lng: 74.2728 };
const airport = { lat: 31.5216, lng: 74.4036 };

describe('carpool compatibility', () => {
  it('matches DHA → Gulberg with DHA → MM Alam (the product spec example)', () => {
    const r = compatibility({ pickup: dhaPhase5, dropoff: gulbergLiberty }, { pickup: dhaPhase5b, dropoff: mmAlam });
    expect(r.compatible).toBe(true);
    expect(r.score).toBeGreaterThan(0.4);
    expect(r.detourRatioExisting).toBeLessThanOrEqual(1.4);
    expect(r.detourRatioNew).toBeLessThanOrEqual(1.4);
  });

  it('rejects opposite directions', () => {
    const r = compatibility({ pickup: dhaPhase5, dropoff: gulbergLiberty }, { pickup: dhaPhase5b, dropoff: { lat: 31.40, lng: 74.47 } });
    expect(r.compatible).toBe(false);
    expect(r.reason).toBe('different directions');
  });

  it('rejects pickups that are far apart', () => {
    const r = compatibility({ pickup: dhaPhase5, dropoff: gulbergLiberty }, { pickup: johar, dropoff: mmAlam });
    expect(r.compatible).toBe(false);
    expect(r.reason).toBe('pickups too far apart');
  });

  it('rejects same-direction trips whose detour is too long', () => {
    // DHA → Airport (north) vs DHA → Liberty (north-west): similar heading at the start but diverging destinations
    const r = compatibility({ pickup: dhaPhase5, dropoff: airport }, { pickup: dhaPhase5b, dropoff: gulbergLiberty }, { maxDetourRatio: 1.2, maxPickupGapM: 2500, maxHeadingDiffDeg: 60 });
    expect(r.compatible).toBe(false);
  });
});
