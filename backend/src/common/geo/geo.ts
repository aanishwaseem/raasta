export interface LatLng {
  lat: number;
  lng: number;
}

const R = 6_371_008.8; // mean Earth radius (m)
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from a to b in degrees [0, 360). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest absolute difference between two bearings (0..180). */
export function bearingDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function destinationPoint(from: LatLng, bearing: number, distanceM: number): LatLng {
  const δ = distanceM / R;
  const θ = toRad(bearing);
  const φ1 = toRad(from.lat);
  const λ1 = toRad(from.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lng: ((toDeg(λ2) + 540) % 360) - 180 };
}

/**
 * Distance from p to segment ab using a local equirectangular projection (accurate to <0.5% for
 * city-scale segments, which is all we need for route corridors).
 * Returns the distance and the fraction t in [0,1] of the closest point along ab.
 */
export function pointToSegment(p: LatLng, a: LatLng, b: LatLng): { distanceM: number; t: number } {
  const lat0 = toRad((a.lat + b.lat + p.lat) / 3);
  const kx = Math.cos(lat0) * R;
  const ky = R;
  const ax = toRad(a.lng) * kx;
  const ay = toRad(a.lat) * ky;
  const bx = toRad(b.lng) * kx;
  const by = toRad(b.lat) * ky;
  const px = toRad(p.lng) * kx;
  const py = toRad(p.lat) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { distanceM: Math.hypot(px - cx, py - cy), t };
}

export interface PolylineProjection {
  distanceM: number; // perpendicular distance to route
  segmentIndex: number;
  alongM: number; // distance travelled along the route to the projected point
}

export function projectOnPolyline(p: LatLng, line: LatLng[]): PolylineProjection {
  if (line.length === 0) return { distanceM: Infinity, segmentIndex: -1, alongM: 0 };
  if (line.length === 1) return { distanceM: haversineM(p, line[0]), segmentIndex: 0, alongM: 0 };
  let best: PolylineProjection = { distanceM: Infinity, segmentIndex: 0, alongM: 0 };
  let cumulative = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const segLen = haversineM(line[i], line[i + 1]);
    const { distanceM, t } = pointToSegment(p, line[i], line[i + 1]);
    if (distanceM < best.distanceM) best = { distanceM, segmentIndex: i, alongM: cumulative + t * segLen };
    cumulative += segLen;
  }
  return best;
}

export function polylineLengthM(line: LatLng[]): number {
  let total = 0;
  for (let i = 0; i < line.length - 1; i++) total += haversineM(line[i], line[i + 1]);
  return total;
}

/** Evenly spaced points between a and b (inclusive), used by the dev routing provider and simulators. */
export function interpolate(a: LatLng, b: LatLng, steps: number): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  }
  return out;
}

/** Point at a given distance along a polyline (clamped to the ends). */
export function pointAlong(line: LatLng[], distanceM: number): LatLng {
  if (line.length === 0) throw new Error('empty polyline');
  let remaining = Math.max(0, distanceM);
  for (let i = 0; i < line.length - 1; i++) {
    const seg = haversineM(line[i], line[i + 1]);
    if (remaining <= seg) {
      const t = seg === 0 ? 0 : remaining / seg;
      return { lat: line[i].lat + (line[i + 1].lat - line[i].lat) * t, lng: line[i].lng + (line[i + 1].lng - line[i].lng) * t };
    }
    remaining -= seg;
  }
  return line[line.length - 1];
}

/** Square polygon ring (closed) of half-size `halfM` around a centre. Used for dev zones. */
export function squareAround(center: LatLng, halfM: number): LatLng[] {
  const n = destinationPoint(center, 0, halfM).lat;
  const s = destinationPoint(center, 180, halfM).lat;
  const e = destinationPoint(center, 90, halfM).lng;
  const w = destinationPoint(center, 270, halfM).lng;
  return [
    { lat: s, lng: w },
    { lat: s, lng: e },
    { lat: n, lng: e },
    { lat: n, lng: w },
    { lat: s, lng: w },
  ];
}

export function toWktPoint(p: LatLng): string {
  return `SRID=4326;POINT(${p.lng} ${p.lat})`;
}

export function toWktLine(line: LatLng[]): string {
  return `SRID=4326;LINESTRING(${line.map((p) => `${p.lng} ${p.lat}`).join(', ')})`;
}

export function toWktPolygon(ring: LatLng[]): string {
  return `SRID=4326;POLYGON((${ring.map((p) => `${p.lng} ${p.lat}`).join(', ')}))`;
}

/** Parse GeoJSON LineString / Point coming back from ST_AsGeoJSON. */
export function fromGeoJsonLine(geojson: string | null | undefined): LatLng[] {
  if (!geojson) return [];
  const g = JSON.parse(geojson) as { coordinates: [number, number][] };
  return g.coordinates.map(([lng, lat]) => ({ lat, lng }));
}

export function isValidLatLng(p: LatLng): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

/** Round coordinates for privacy-reduced displays (≈110 m at 3 decimals). */
export function coarsen(p: LatLng, decimals = 3): LatLng {
  const f = 10 ** decimals;
  return { lat: Math.round(p.lat * f) / f, lng: Math.round(p.lng * f) / f };
}
