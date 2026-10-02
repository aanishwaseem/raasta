import { EMPORIUM, LIBERTY, Session, TestApp, DRIVERS } from './harness';
import { startTrip } from './helpers';

describe('delivery module (separate bounded context)', () => {
  const t = new TestApp();
  let sender: Session;
  let driver: Session;
  let other: Session;
  const body = (fare: number) => ({ pickup: LIBERTY, dropoff: EMPORIUM, weightKg: 2, packageCategory: 'PARCEL', recipientName: 'Test Recipient', recipientPhone: '+923001119999', expectedFare: fare });

  beforeAll(async () => {
    await t.start();
    sender = await t.login('bilal@raasta.test');
    driver = await t.login(DRIVERS.usman.email);
    other = await t.login(DRIVERS.hamza.email);
  });
  afterAll(() => t.stop());

  it('quotes from the delivery tariff, not the ride fare, and rejects overweight parcels', async () => {
    const q = await t.call(sender, 'post', '/deliveries/quote', { pickup: LIBERTY, dropoff: EMPORIUM, weightKg: 2 });
    expect(q.status).toBe(201);
    expect(q.body.fare).toBeGreaterThanOrEqual(120);
    expect(q.body.fare).toBe(q.body.platformFee + q.body.driverEarning);
    const heavy = await t.call(sender, 'post', '/deliveries/quote', { pickup: LIBERTY, dropoff: EMPORIUM, weightKg: 80 });
    expect(heavy.status).toBe(422);
    expect(heavy.body.error.code).toBe('DELIVERY_TOO_HEAVY');
  });

  it('create rejects a stale price, then runs the whole lifecycle with PIN proof of delivery', async () => {
    const q = (await t.call(sender, 'post', '/deliveries/quote', { pickup: LIBERTY, dropoff: EMPORIUM, weightKg: 2 })).body;
    const stale = await t.call(sender, 'post', '/deliveries', body(q.fare - 50), { 'Idempotency-Key': t.nextKey('d') });
    expect(stale.status).toBe(409);

    const key = t.nextKey('d');
    const created = await t.call(sender, 'post', '/deliveries', body(q.fare), { 'Idempotency-Key': key });
    expect(created.status).toBe(201);
    const replay = await t.call(sender, 'post', '/deliveries', body(q.fare), { 'Idempotency-Key': key });
    expect(replay.body.id).toBe(created.body.id);
    const { id, deliveryPin, trackingCode } = { id: created.body.id as string, deliveryPin: created.body.deliveryPin as string, trackingCode: created.body.trackingCode as string };
    expect(deliveryPin).toMatch(/^\d{4}$/);

    // the pool is visible to approved drivers, with no recipient phone number
    const open = await t.call(driver, 'get', '/driver/deliveries/open?lat=31.51&lng=74.34');
    expect(open.status).toBe(200);
    const mine = open.body.items.find((d: { id: string }) => d.id === id);
    expect(mine).toBeTruthy();
    expect(mine.recipientPhone).toBeUndefined();

    expect((await t.call(driver, 'post', `/driver/deliveries/${id}/accept`)).status).toBe(201);
    const taken = await t.call(other, 'post', `/driver/deliveries/${id}/accept`);
    expect(taken.status).toBe(409);
    expect((await t.call(driver, 'post', `/driver/deliveries/${id}/deliver`, { pin: deliveryPin })).status).toBe(409); // not picked up yet
    expect((await t.call(driver, 'post', `/driver/deliveries/${id}/pickup`)).status).toBe(201);

    const wrong = await t.call(driver, 'post', `/driver/deliveries/${id}/deliver`, { pin: deliveryPin === '0000' ? '1111' : '0000' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('WRONG_DELIVERY_PIN');
    const done = await t.call(driver, 'post', `/driver/deliveries/${id}/deliver`, { pin: deliveryPin, note: 'handed to recipient' });
    expect(done.status).toBe(201);
    expect(done.body.status).toBe('DELIVERED');

    const pub = await t.http.get(`/api/v1/public/deliveries/${trackingCode}`);
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe('DELIVERED');
    expect(JSON.stringify(pub.body)).not.toContain('+92300');
    expect((await t.call(sender, 'post', `/deliveries/${id}/cancel`, {})).status).toBe(409);
    const rides = await t.db.one<{ n: string }>(`SELECT count(*) AS n FROM rides WHERE passenger_id = $1`, [sender.userId]);
    expect(Number(rides!.n)).toBe(0); // the ride domain was never touched
  });

  it('the PIN locks after three wrong attempts and the sender can cancel before pickup', async () => {
    const q = (await t.call(sender, 'post', '/deliveries/quote', { pickup: LIBERTY, dropoff: EMPORIUM, weightKg: 1 })).body;
    const d = (await t.call(sender, 'post', '/deliveries', { ...body(q.fare), weightKg: 1 }, { 'Idempotency-Key': t.nextKey('d') })).body;
    await t.call(driver, 'post', `/driver/deliveries/${d.id}/accept`);
    await t.call(driver, 'post', `/driver/deliveries/${d.id}/pickup`);
    const bad = d.deliveryPin === '0000' ? '1111' : '0000';
    for (let i = 0; i < 3; i++) expect((await t.call(driver, 'post', `/driver/deliveries/${d.id}/deliver`, { pin: bad })).status).toBe(422);
    expect((await t.call(driver, 'post', `/driver/deliveries/${d.id}/deliver`, { pin: d.deliveryPin })).status).toBe(403);

    const c = (await t.call(sender, 'post', '/deliveries/quote', { pickup: LIBERTY, dropoff: EMPORIUM, weightKg: 1 })).body;
    const e = (await t.call(sender, 'post', '/deliveries', { ...body(c.fare), weightKg: 1 }, { 'Idempotency-Key': t.nextKey('d') })).body;
    const cancelled = await t.call(sender, 'post', `/deliveries/${e.id}/cancel`, { reason: 'changed my mind' });
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.status).toBe('CANCELLED');
  });
});

describe('admin operations lists and corporate invoices', () => {
  const t = new TestApp();
  let admin: Session;
  beforeAll(async () => { await t.start(); admin = await t.login('admin@raasta.test'); });
  afterAll(() => t.stop());

  it('vehicles, wallets (derived from the ledger), deliveries and AI ops respond for staff only', async () => {
    for (const p of ['/admin/vehicles', '/admin/wallets?ownerType=PLATFORM_REVENUE', '/admin/deliveries']) {
      const r = await t.call(admin, 'get', p);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body.items)).toBe(true);
    }
    const ops = await t.call(admin, 'get', '/admin/ops/ai');
    expect(ops.status).toBe(200);
    expect(ops.body.matching).toHaveProperty('successRate');
    expect(ops.body.forecast.zones).toBeInstanceOf(Array);
    const pax = await t.login('bilal@raasta.test');
    expect((await t.call(pax, 'get', '/admin/vehicles')).status).toBe(403);
    expect((await t.call(pax, 'get', '/admin/ops/ai')).status).toBe(403);
  });

  it('ride detail for staff includes offers, events, payments and trace (regression: offers query used a missing column)', async () => {
    const pax = await t.login('bilal@raasta.test');
    const drv = await t.login(DRIVERS.usman.email);
    const { rideId } = await startTrip(t, pax, drv);
    const r = await t.call(admin, 'get', `/admin/rides/${rideId}`);
    expect(r.status).toBe(200);
    expect(r.body.ride.id).toBe(rideId);
    expect(r.body.matchingOffers.length).toBeGreaterThan(0);
    for (const k of ['events', 'matchingOffers', 'payments', 'trace', 'safetyEvents']) expect(Array.isArray(r.body[k])).toBe(true);
  });

  it('a company admin can fetch a monthly invoice (month is validated)', async () => {
    const corp = await t.login('corpadmin@raasta.test');
    const month = new Date().toISOString().slice(0, 7);
    const ok = await t.call(corp, 'get', `/corporate/invoices?month=${month}`);
    expect(ok.status).toBe(200);
    expect(ok.body.invoiceNumber).toContain('RAASTA-');
    expect((await t.call(corp, 'get', '/corporate/invoices?month=2026-13')).status).toBe(400);
  });
});
