/** Pure routine-mining logic (unit-tested). Times are Pakistan local. */
export interface RideObservation {
  rideId: string;
  startLocalDate: string; // YYYY-MM-DD
  weekday: number; // ISO 1..7
  minutesOfDay: number; // local
  pickupCell: string;
  dropoffCell: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  pickupAddress: string;
  dropoffAddress: string;
  productCode: string;
  fare: number;
}

export interface Routine {
  id: string;
  pickup: { lat: number; lng: number; address: string };
  dropoff: { lat: number; lng: number; address: string };
  dayClass: 'WEEKDAY' | 'WEEKEND';
  weekdays: number[];
  typicalMinutes: number;
  occurrences: number;
  distinctDays: number;
  productCode: string;
  typicalFare: number;
  confidence: number;
  lastSeen: string;
}

export const ROUTINE_MIN_OCCURRENCES = 3;
export const ROUTINE_MIN_DAYS = 2;
const BUCKET_MIN = 30;

const dayClass = (wd: number): 'WEEKDAY' | 'WEEKEND' => (wd >= 6 ? 'WEEKEND' : 'WEEKDAY');
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mode = <T>(xs: T[]): T => {
  const c = new Map<T, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0];
};

/**
 * A routine = the same origin cell, destination cell, weekday class and 30-minute time bucket seen on
 * at least 3 occasions across at least 2 distinct days. Confidence grows with repetitions and with how
 * tightly the departure times cluster. Nothing is inferred from fewer observations.
 */
export function mineRoutines(obs: RideObservation[]): Routine[] {
  const groups = new Map<string, RideObservation[]>();
  for (const o of obs) {
    const bucket = Math.floor(o.minutesOfDay / BUCKET_MIN);
    const key = `${o.pickupCell}|${o.dropoffCell}|${dayClass(o.weekday)}|${bucket}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(o);
  }
  const routines: Routine[] = [];
  for (const [key, g] of groups) {
    const days = new Set(g.map((o) => o.startLocalDate));
    if (g.length < ROUTINE_MIN_OCCURRENCES || days.size < ROUTINE_MIN_DAYS) continue;
    const minutes = g.map((o) => o.minutesOfDay);
    const spread = Math.max(...minutes) - Math.min(...minutes);
    const tightness = 1 - Math.min(spread, 60) / 120; // 1.0 (identical) .. 0.5 (an hour apart)
    const repetition = Math.min(1, g.length / 8);
    const latest = g.reduce((a, b) => (a.startLocalDate >= b.startLocalDate ? a : b));
    routines.push({
      id: key,
      pickup: { lat: latest.pickupLat, lng: latest.pickupLng, address: latest.pickupAddress },
      dropoff: { lat: latest.dropoffLat, lng: latest.dropoffLng, address: latest.dropoffAddress },
      dayClass: dayClass(g[0].weekday),
      weekdays: [...new Set(g.map((o) => o.weekday))].sort(),
      typicalMinutes: Math.round(median(minutes)),
      occurrences: g.length,
      distinctDays: days.size,
      productCode: mode(g.map((o) => o.productCode)),
      typicalFare: Math.round(median(g.map((o) => o.fare))),
      confidence: Math.round(repetition * tightness * 100) / 100,
      lastSeen: latest.startLocalDate,
    });
  }
  return routines.sort((a, b) => b.confidence - a.confidence);
}

export interface Suggestion {
  routineId: string;
  title: string;
  pickup: Routine['pickup'];
  dropoff: Routine['dropoff'];
  productCode: string;
  suggestedPickupAt: string;
  typicalFare: number;
  confidence: number;
  reason: string;
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Suggestions for routines whose usual time falls within the next `horizonMin` minutes. Never books. */
export function suggestionsFor(routines: Routine[], nowUtc: Date, horizonMin = 90, minConfidence = 0.35): Suggestion[] {
  const local = new Date(nowUtc.getTime() + 5 * 3600_000);
  const wd = ((local.getUTCDay() + 6) % 7) + 1;
  const nowMin = local.getUTCHours() * 60 + local.getUTCMinutes();
  const out: Suggestion[] = [];
  for (const r of routines) {
    if (r.confidence < minConfidence) continue;
    if (!r.weekdays.includes(wd)) continue;
    const delta = r.typicalMinutes - nowMin;
    if (delta < -15 || delta > horizonMin) continue;
    const when = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 0, r.typicalMinutes) - 5 * 3600_000);
    out.push({
      routineId: r.id,
      title: `Your usual trip to ${r.dropoff.address.split(',')[0]}?`,
      pickup: r.pickup,
      dropoff: r.dropoff,
      productCode: r.productCode,
      suggestedPickupAt: when.toISOString(),
      typicalFare: r.typicalFare,
      confidence: r.confidence,
      reason: `You took this trip ${r.occurrences} times around ${hhmm(r.typicalMinutes)} on ${r.dayClass === 'WEEKDAY' ? 'weekdays' : 'weekends'}.`,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}
