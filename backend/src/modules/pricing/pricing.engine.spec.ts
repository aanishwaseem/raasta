import { adviseFare, demandMultiplier, expectedMatchSeconds, MarketSnapshot, PricingConfig } from './pricing.engine';

const economy: PricingConfig = {
  productCode: 'ECONOMY',
  baseFare: 120,
  perKm: 32,
  perMinute: 4,
  minimumFare: 200,
  bookingFee: 20,
  platformFeePct: 15,
  fuelCostPerKm: 16,
  maxSurgeMultiplier: 1.8,
  minOfferPct: 80,
  sharedDiscountPct: 30,
  cancellationFee: 80,
  freeCancelSeconds: 120,
};

const calm: MarketSnapshot = { idleDrivers: 8, openRequests: 1, forecastLevel: 'LOW', zoneName: 'Gulberg', historicalAvgFare: null, historicalSamples: 0 };
const busy: MarketSnapshot = { idleDrivers: 1, openRequests: 7, forecastLevel: 'HIGH', zoneName: 'Gulberg', historicalAvgFare: 450, historicalSamples: 12 };

describe('pricing engine', () => {
  it('uses the metered formula with no adjustment when supply is sufficient', () => {
    const a = adviseFare(economy, 6000, 1200, calm);
    // 120 + 32*6 + 4*20 = 392 + 20 booking = 412 -> 410
    expect(a.estimated).toBe(410);
    expect(a.recommended).toBe(410);
    expect(a.demandMultiplier).toBe(1);
    expect(a.explanation[0]).toMatch(/Standard fare/);
  });

  it('applies a capped, explained demand adjustment when demand exceeds supply', () => {
    const a = adviseFare(economy, 6000, 1200, busy);
    expect(a.demandMultiplier).toBeGreaterThan(1);
    expect(a.demandMultiplier).toBeLessThanOrEqual(economy.maxSurgeMultiplier);
    expect(a.recommended).toBeGreaterThan(a.estimated);
    expect(a.explanation.join(' ')).toMatch(/higher than available drivers/);
    expect(a.explanation.join(' ')).toMatch(/Recent similar trips averaged Rs 450/);
    expect(a.explanation.join(' ')).toMatch(/may increase your waiting time/);
  });

  it('never exceeds the city surge cap even in extreme demand', () => {
    expect(demandMultiplier({ ...busy, openRequests: 500, idleDrivers: 0 }, 1.8)).toBe(1.8);
  });

  it('keeps the minimum reasonable fare above the fuel-cost floor and the minimum fare', () => {
    const long = adviseFare(economy, 25000, 2400, calm);
    expect(long.minimumReasonable).toBeGreaterThanOrEqual(Math.ceil(16 * 27 * 1.2));
    const tiny = adviseFare(economy, 300, 90, calm);
    expect(tiny.minimumReasonable).toBeGreaterThanOrEqual(economy.minimumFare);
    expect(tiny.recommended).toBeGreaterThanOrEqual(economy.minimumFare);
  });

  it('breakdown lines add up to the estimate, including the minimum-fare top-up', () => {
    const tiny = adviseFare(economy, 600, 120, calm);
    const b = tiny.breakdown;
    expect(b.minimumFareAdjustment).toBeGreaterThan(0);
    expect(b.base + b.distance + b.time + b.minimumFareAdjustment + b.bookingFee).toBe(Math.max(economy.minimumFare, b.base + b.distance + b.time) + b.bookingFee);
    const long = adviseFare(economy, 20000, 2400, calm);
    expect(long.breakdown.minimumFareAdjustment).toBe(0);
  });

  it('discounts shared rides and says so', () => {
    const solo = adviseFare(economy, 6000, 1200, calm);
    const shared = adviseFare(economy, 6000, 1200, calm, { shared: true });
    expect(shared.recommended).toBeLessThan(solo.recommended);
    expect(shared.breakdown.sharedDiscount).toBeGreaterThan(0);
  });

  it('predicts longer matching for lower offers and no estimate with zero drivers', () => {
    const atRec = expectedMatchSeconds(calm, 400, 400)!;
    const atLow = expectedMatchSeconds(calm, 320, 400)!;
    expect(atLow).toBeGreaterThan(atRec);
    expect(expectedMatchSeconds({ ...calm, idleDrivers: 0 }, 400, 400)).toBeNull();
  });
});
