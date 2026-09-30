import { bearingDeg, destinationPoint, interpolate, pointAlong } from '../../common/geo/geo';
import { evaluateDeviation, INITIAL_DEVIATION_STATE, isProlongedStop } from './deviation';

const A = { lat: 31.4697, lng: 74.2728 }; // Johar Town
const D = { lat: 31.5102, lng: 74.3441 }; // Liberty, Gulberg
const route = interpolate(A, D, 40);
const opts = { thresholdM: 500, consecutive: 2 };

describe('route deviation', () => {
  it('stays quiet on the expected route (A → B → C → D)', () => {
    let state = INITIAL_DEVIATION_STATE;
    for (let m = 0; m <= 8000; m += 400) {
      const d = evaluateDeviation(route, pointAlong(route, m), D, state, opts);
      expect(d.trigger).toBe(false);
      state = d.state;
    }
  });

  it('ignores a single noisy point outside the corridor', () => {
    const on = pointAlong(route, 2000);
    const off = destinationPoint(on, 330, 800);
    const d1 = evaluateDeviation(route, off, D, INITIAL_DEVIATION_STATE, opts);
    expect(d1.offRoute).toBe(true);
    expect(d1.trigger).toBe(false);
    const d2 = evaluateDeviation(route, pointAlong(route, 2200), D, d1.state, opts);
    expect(d2.state.consecutiveOff).toBe(0);
  });

  it('triggers once when the vehicle stays outside the corridor (A → B → X)', () => {
    const b = pointAlong(route, 3000);
    const side = bearingDeg(A, D) + 90; // perpendicular to the route
    const x1 = destinationPoint(b, side, 700);
    const x2 = destinationPoint(b, side, 1200);
    const x3 = destinationPoint(b, side, 1800);
    const s1 = evaluateDeviation(route, x1, D, INITIAL_DEVIATION_STATE, opts);
    const s2 = evaluateDeviation(route, x2, D, s1.state, opts);
    const s3 = evaluateDeviation(route, x3, D, s2.state, opts);
    expect(s1.trigger).toBe(false);
    expect(s2.trigger).toBe(true);
    expect(s3.trigger).toBe(false); // no alert storm for the same excursion
    expect(s3.severity).toBe('HIGH');
  });

  it('does not flag the final approach to the destination', () => {
    const nearDest = destinationPoint(D, 90, 350);
    const s = evaluateDeviation(route, nearDest, D, { ...INITIAL_DEVIATION_STATE, consecutiveOff: 5 }, { thresholdM: 300, consecutive: 2 });
    expect(s.offRoute).toBe(false);
  });
});

describe('prolonged stop', () => {
  const mid = pointAlong(route, 4000);
  const now = Date.now();
  const pts = (n: number, stepS: number) => Array.from({ length: n }, (_, i) => ({ ...mid, recordedAt: new Date(now - (n - 1 - i) * stepS * 1000) }));

  it('detects a stationary vehicle mid-route for longer than the threshold', () => {
    expect(isProlongedStop(pts(12, 30), A, D, { stopSeconds: 300 })).toBe(true);
  });

  it('ignores short stops (traffic lights)', () => {
    expect(isProlongedStop(pts(4, 30), A, D, { stopSeconds: 300 })).toBe(false);
  });

  it('ignores waiting near the destination', () => {
    const atDest = Array.from({ length: 12 }, (_, i) => ({ ...D, recordedAt: new Date(now - (11 - i) * 30000) }));
    expect(isProlongedStop(atDest, A, D, { stopSeconds: 300 })).toBe(false);
  });
});
