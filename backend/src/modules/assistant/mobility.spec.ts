import { mineRoutines, RideObservation, suggestionsFor } from './mobility';

const base = {
  pickupCell: 'A',
  dropoffCell: 'B',
  pickupLat: 31.47,
  pickupLng: 74.27,
  dropoffLat: 31.51,
  dropoffLng: 74.34,
  pickupAddress: 'Johar Town, Lahore',
  dropoffAddress: 'Liberty Market, Gulberg, Lahore',
  productCode: 'ECONOMY',
  fare: 600,
};
const obs = (date: string, weekday: number, minutesOfDay: number, extra: Partial<RideObservation> = {}): RideObservation => ({
  rideId: `${date}-${minutesOfDay}`,
  startLocalDate: date,
  weekday,
  minutesOfDay,
  ...base,
  ...extra,
});

describe('routine mining', () => {
  it('finds a weekday commute seen on 4 days', () => {
    const r = mineRoutines([obs('2026-09-07', 1, 455), obs('2026-09-08', 2, 460), obs('2026-09-09', 3, 450), obs('2026-09-10', 4, 458)]);
    expect(r).toHaveLength(1);
    expect(r[0].dayClass).toBe('WEEKDAY');
    expect(r[0].occurrences).toBe(4);
    expect(r[0].confidence).toBeGreaterThan(0.4);
  });

  it('does not invent a routine from two rides', () => {
    expect(mineRoutines([obs('2026-09-07', 1, 455), obs('2026-09-08', 2, 460)])).toHaveLength(0);
  });

  it('requires at least two distinct days', () => {
    expect(mineRoutines([obs('2026-09-07', 1, 455), obs('2026-09-07', 1, 456), obs('2026-09-07', 1, 457)])).toHaveLength(0);
  });

  it('keeps different time buckets and weekday classes apart', () => {
    const morning = [1, 2, 3].map((d) => obs(`2026-09-0${6 + d}`, d, 455));
    const evening = [1, 2, 3].map((d) => obs(`2026-09-0${6 + d}`, d, 1050));
    expect(mineRoutines([...morning, ...evening])).toHaveLength(2);
  });
});

describe('suggestions', () => {
  const routines = mineRoutines([obs('2026-09-07', 1, 455), obs('2026-09-08', 2, 455), obs('2026-09-09', 3, 455), obs('2026-09-10', 4, 455), obs('2026-09-11', 5, 455)]);
  // 2026-09-14 is a Monday; 07:00 PK = 02:00 UTC
  it('suggests the usual trip shortly before its usual time', () => {
    const s = suggestionsFor(routines, new Date('2026-09-14T02:00:00Z'));
    expect(s).toHaveLength(1);
    expect(s[0].title).toContain('Liberty Market');
  });
  it('stays quiet at unrelated times and on other day classes', () => {
    expect(suggestionsFor(routines, new Date('2026-09-14T10:00:00Z'))).toHaveLength(0);
    expect(suggestionsFor(routines, new Date('2026-09-13T02:00:00Z'))).toHaveLength(0); // Sunday
  });
});
