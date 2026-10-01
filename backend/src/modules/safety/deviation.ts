import { haversineM, LatLng, projectOnPolyline } from '../../common/geo/geo';

export interface DeviationState {
  consecutiveOff: number;
  maxDistanceM: number;
  lastAlongM: number;
}

export interface DeviationDecision {
  distanceM: number;
  offRoute: boolean;
  trigger: boolean;
  severity: 'MEDIUM' | 'HIGH';
  state: DeviationState;
}

export const INITIAL_DEVIATION_STATE: DeviationState = { consecutiveOff: 0, maxDistanceM: 0, lastAlongM: 0 };

/**
 * Route-corridor check for one GPS point. A single noisy point never triggers: the vehicle must be
 * outside the corridor for `consecutive` points in a row. Points close to the destination are
 * ignored (drivers legitimately leave the planned line to reach the exact drop-off).
 */
export function evaluateDeviation(
  route: LatLng[],
  point: LatLng,
  destination: LatLng,
  prev: DeviationState,
  opts: { thresholdM: number; consecutive: number },
): DeviationDecision {
  if (route.length < 2) {
    return { distanceM: 0, offRoute: false, trigger: false, severity: 'MEDIUM', state: prev };
  }
  const proj = projectOnPolyline(point, route);
  const nearDestination = haversineM(point, destination) < Math.max(400, opts.thresholdM);
  const offRoute = !nearDestination && proj.distanceM > opts.thresholdM;
  const consecutiveOff = offRoute ? prev.consecutiveOff + 1 : 0;
  const state: DeviationState = {
    consecutiveOff,
    maxDistanceM: offRoute ? Math.max(prev.maxDistanceM, proj.distanceM) : 0,
    lastAlongM: Math.max(prev.lastAlongM, proj.alongM),
  };
  const trigger = offRoute && consecutiveOff === opts.consecutive; // fire once per excursion
  return {
    distanceM: Math.round(proj.distanceM),
    offRoute,
    trigger,
    severity: proj.distanceM > opts.thresholdM * 3 ? 'HIGH' : 'MEDIUM',
    state,
  };
}

/** Stationary for too long, away from pickup and destination? */
export function isProlongedStop(
  points: { lat: number; lng: number; recordedAt: Date }[],
  pickup: LatLng,
  destination: LatLng,
  opts: { stopSeconds: number; radiusM?: number; exclusionM?: number },
): boolean {
  if (points.length < 3) return false;
  const radius = opts.radiusM ?? 60;
  const exclusion = opts.exclusionM ?? 300;
  const last = points[points.length - 1];
  const windowStart = last.recordedAt.getTime() - opts.stopSeconds * 1000;
  const window = points.filter((p) => p.recordedAt.getTime() >= windowStart);
  if (!window.length || window[0].recordedAt.getTime() - windowStart > 60_000) return false; // not enough coverage
  if (window.some((p) => haversineM(p, last) > radius)) return false;
  if (haversineM(last, pickup) < exclusion || haversineM(last, destination) < exclusion) return false;
  return true;
}
