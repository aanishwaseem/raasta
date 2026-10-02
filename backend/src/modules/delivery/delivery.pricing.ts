import { haversineM, LatLng } from '../../common/geo/geo';

export interface DeliveryRate {
  baseFare: number;
  perKm: number;
  minimumFare: number;
  maxWeightKg: number;
  maxDistanceKm: number;
  platformFeePct: number;
}

export interface DeliveryQuote {
  distanceM: number;
  durationS: number;
  fare: number;
  platformFee: number;
  driverEarning: number;
  breakdown: { baseFare: number; distanceCharge: number; minimumApplied: boolean };
}

/** Plain, explainable tariff: base + per-km, floored at the minimum. No surge, so the sender can always see how the price was made. */
export function priceDelivery(rate: DeliveryRate, distanceM: number, durationS: number): DeliveryQuote {
  const distanceCharge = Math.round((distanceM / 1000) * rate.perKm);
  const raw = rate.baseFare + distanceCharge;
  const fare = Math.max(raw, rate.minimumFare);
  const platformFee = Math.round((fare * rate.platformFeePct) / 100);
  return { distanceM, durationS, fare, platformFee, driverEarning: fare - platformFee, breakdown: { baseFare: rate.baseFare, distanceCharge, minimumApplied: raw < rate.minimumFare } };
}

/** Straight-line distance used only to sort open deliveries for a driver; the fare uses the routing provider. */
export const crowDistanceM = (a: LatLng, b: LatLng) => Math.round(haversineM(a, b));

const TRANSITIONS: Record<string, string[]> = {
  CREATED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PICKED_UP', 'CANCELLED', 'CREATED'], // CREATED = the driver released it back to the pool
  PICKED_UP: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};
export const canTransition = (from: string, to: string) => TRANSITIONS[from]?.includes(to) ?? false;
