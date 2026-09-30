import {
  bearingDeg,
  bearingDiff,
  destinationPoint,
  haversineM,
  interpolate,
  pointAlong,
  polylineLengthM,
  projectOnPolyline,
} from './geo';

const libertyMarket = { lat: 31.5102, lng: 74.3441 };
const mmAlam = { lat: 31.5165, lng: 74.3522 };

describe('geo', () => {
  it('computes haversine distances within 0.5% of known values', () => {
    // Lahore -> Islamabad city centres ~ 270 km great-circle
    const d = haversineM({ lat: 31.5204, lng: 74.3587 }, { lat: 33.6844, lng: 73.0479 });
    expect(d / 1000).toBeGreaterThan(265);
    expect(d / 1000).toBeLessThan(275);
  });

  it('destinationPoint round-trips with haversine and bearing', () => {
    const p = destinationPoint(libertyMarket, 45, 1500);
    expect(haversineM(libertyMarket, p)).toBeCloseTo(1500, 0);
    expect(bearingDeg(libertyMarket, p)).toBeCloseTo(45, 0);
  });

  it('bearingDiff wraps around 360', () => {
    expect(bearingDiff(350, 10)).toBe(20);
    expect(bearingDiff(90, 270)).toBe(180);
  });

  it('projects a point onto a polyline and measures perpendicular distance', () => {
    const line = interpolate(libertyMarket, mmAlam, 10);
    const onRoute = pointAlong(line, 400);
    expect(projectOnPolyline(onRoute, line).distanceM).toBeLessThan(1);
    const offRoute = destinationPoint(onRoute, bearingDeg(libertyMarket, mmAlam) + 90, 600);
    const proj = projectOnPolyline(offRoute, line);
    expect(proj.distanceM).toBeGreaterThan(590);
    expect(proj.distanceM).toBeLessThan(610);
    expect(proj.alongM).toBeGreaterThan(350);
    expect(proj.alongM).toBeLessThan(450);
  });

  it('pointAlong clamps to the ends', () => {
    const line = interpolate(libertyMarket, mmAlam, 4);
    expect(pointAlong(line, -10)).toEqual(line[0]);
    expect(pointAlong(line, polylineLengthM(line) + 100)).toEqual(line[line.length - 1]);
  });
});
