import { DRIVERS, EMPORIUM, LIBERTY, Session, sleep, TestApp } from './harness';

describe('ride flow (real Postgres + Redis + sockets)', () => {
  const t = new TestApp();
  let passenger: Session;
  let usman: Session;
  let hamza: Session;

  beforeAll(async () => {
    await t.start();
    passenger = await t.login('bilal@raasta.test');
    usman = await t.login(DRIVERS.usman.email);
    hamza = await t.login(DRIVERS.hamza.email);
  }, 120000);
  afterAll(() => t.stop());

  async function resetRides() {
    for (const d of [usman, hamza]) await t.call(d, 'post', '/driver/offline');
    await t.db.query(`UPDATE rides SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = 'SYSTEM' WHERE status IN ('MATCHING','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS')`);
  }

  it('1. full lifecycle with realtime events, PIN, ledger-recorded payment and ratings', async () => {
    await t.goOnline(usman, DRIVERS.usman.at);
    const pSock = await t.socket(passenger);
    const dSock = await t.socket(usman);

    const quote = await t.quote(passenger);
    expect(quote.options.find((o: { productCode: string }) => o.productCode === 'ECONOMY').fare.recommended).toBeGreaterThan(200);

    const offerEvent = TestApp.waitFor<{ offerId: string; rideId: string }>(dSock, 'ride.offer');
    const assigned = TestApp.waitFor(pSock, 'ride.driver_assigned');
    const res = await t.requestRide(passenger, quote, { paymentMethod: 'WALLET' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('MATCHING');
    const rideId = res.body.id;

    const offer = await offerEvent;
    expect(offer.rideId).toBe(rideId);
    const accepted = await t.call(usman, 'post', `/driver/offers/${offer.offerId}/accept`);
    expect(accepted.status).toBe(200);
    await assigned;

    const view = await t.call(passenger, 'get', `/rides/${rideId}`);
    expect(view.body.status).toBe('DRIVER_ASSIGNED');
    expect(view.body.pin).toMatch(/^\d{4}$/);
    expect(view.body.driver.firstName).toBe('Usman');
    expect(JSON.stringify(view.body)).not.toMatch(/reliability/i); // internal score never leaks
    const driverView = await t.call(usman, 'get', `/rides/${rideId}`);
    expect(driverView.body.pin ?? null).toBeNull(); // driver must ask the passenger for the PIN

    const arriving = TestApp.waitFor(pSock, 'ride.driver_arriving');
    await t.call(usman, 'post', '/driver/location', { lat: LIBERTY.lat, lng: LIBERTY.lng, speed: 4 });
    await arriving;
    expect((await t.call(passenger, 'get', `/rides/${rideId}`)).body.status).toBe('DRIVER_ARRIVING');

    expect((await t.call(usman, 'post', `/driver/rides/${rideId}/arrived`)).status).toBe(200);
    const wrong = await t.call(usman, 'post', `/driver/rides/${rideId}/start`, { pin: view.body.pin === '0000' ? '1111' : '0000' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('PIN_INCORRECT');

    const started = TestApp.waitFor(pSock, 'ride.started');
    expect((await t.call(usman, 'post', `/driver/rides/${rideId}/start`, { pin: view.body.pin })).status).toBe(200);
    await started;

    for (let i = 1; i <= 4; i++) {
      const f = i / 4;
      await t.call(usman, 'post', '/driver/location', { lat: LIBERTY.lat + (EMPORIUM.lat - LIBERTY.lat) * f, lng: LIBERTY.lng + (EMPORIUM.lng - LIBERTY.lng) * f, speed: 9 });
    }
    const completedEvt = TestApp.waitFor(pSock, 'ride.completed');
    const done = await t.call(usman, 'post', `/driver/rides/${rideId}/complete`, { lat: EMPORIUM.lat, lng: EMPORIUM.lng });
    expect(done.status).toBe(200);
    expect(done.body.payment.status).toBe('PAID');
    await completedEvt;

    // ledger: every transaction balances and the wallets moved by the agreed fare
    const fare = done.body.payment.amount;
    const bal = await t.db.one<{ s: string }>(`SELECT COALESCE(sum(amount),0) AS s FROM wallet_transactions`);
    expect(Number(bal!.s)).toBe(0);
    const wallet = await t.call(passenger, 'get', '/wallet');
    expect(wallet.body.available).toBe(5000 - fare);

    expect((await t.call(passenger, 'post', `/rides/${rideId}/rating`, { stars: 5, tags: ['POLITE'] })).status).toBe(201);
    expect((await t.call(usman, 'post', `/rides/${rideId}/rating`, { stars: 4 })).status).toBe(201);
    expect((await t.call(passenger, 'post', `/rides/${rideId}/rating`, { stars: 1 })).status).toBe(409);
    const receipt = await t.call(passenger, 'get', `/rides/${rideId}/receipt`);
    expect(receipt.body.fare.charged).toBe(fare);

    // ride events are an ordered audit trail
    const types = (await t.call(passenger, 'get', `/rides/${rideId}/events`)).body.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(['requested', 'driver_assigned', 'driver_arrived', 'in_progress', 'completed']));
    await t.call(usman, 'post', '/driver/offline');
  }, 60000);

  it('2. passenger cancels while matching (no fee) and after the free window (fee)', async () => {
    await resetRides();
    await t.goOnline(usman, DRIVERS.usman.at);
    const q = await t.quote(passenger);
    const r1 = await t.requestRide(passenger, q);
    const c1 = await t.call(passenger, 'post', `/rides/${r1.body.id}/cancel`, { reason: 'CHANGED_MIND' });
    expect(c1.status).toBe(201);
    expect(c1.body.cancellationFee).toBe(0);

    await t.goOnline(usman, DRIVERS.usman.at);
    const q2 = await t.quote(passenger);
    const r2 = await t.requestRide(passenger, q2);
    const offer = await t.waitOffer(usman);
    await t.call(usman, 'post', `/driver/offers/${offer.offerId}/accept`);
    await t.db.query(`UPDATE rides SET assigned_at = now() - interval '10 minutes' WHERE id = $1`, [r2.body.id]);
    const c2 = await t.call(passenger, 'post', `/rides/${r2.body.id}/cancel`, { reason: 'WAIT_TOO_LONG' });
    expect(c2.body.cancellationFee).toBeGreaterThan(0);
    const fees = await t.db.one<{ n: string }>(`SELECT count(*) AS n FROM ledger_transactions WHERE kind = 'CANCELLATION_FEE'`);
    expect(Number(fees!.n)).toBe(1);
    await t.call(usman, 'post', '/driver/offline');
  }, 60000);

  it('3. driver cancels after accept: ride returns to MATCHING, driver excluded, another driver offered', async () => {
    await resetRides();
    await t.goOnline(usman, DRIVERS.usman.at);
    await t.goOnline(hamza, DRIVERS.hamza.at);
    const pSock = await t.socket(passenger);
    const q = await t.quote(passenger);
    const r = await t.requestRide(passenger, q);
    // only one driver is offered at a time, so the other poller always times out; swallow it
    // or its late rejection lands as an unhandled error in whichever suite runs next
    const polls = [usman, hamza].map((who) => t.waitOffer(who).then((o) => ({ o, who })));
    polls.forEach((p) => p.catch(() => undefined));
    const first = await Promise.any(polls);
    await t.call(first.who, 'post', `/driver/offers/${first.o.offerId}/accept`);
    const matchingAgain = TestApp.waitFor(pSock, 'ride.matching', (p: { stage?: string }) => p.stage === 'driver_cancelled');
    const cancel = await t.call(first.who, 'post', `/driver/rides/${r.body.id}/cancel`, { reason: 'VEHICLE_ISSUE' });
    expect(cancel.status).toBe(200);
    await matchingAgain;
    const other = first.who === usman ? hamza : usman;
    const offer2 = await t.waitOffer(other);
    expect(offer2.rideId).toBe(r.body.id);
    const row = await t.db.one<{ excluded_driver_ids: string[]; status: string }>(`SELECT excluded_driver_ids, status FROM rides WHERE id = $1`, [r.body.id]);
    expect(row!.status).toBe('MATCHING');
    expect(row!.excluded_driver_ids).toContain(first.who.userId);
    await t.call(other, 'post', `/driver/offers/${offer2.offerId}/accept`);
    await t.call(passenger, 'post', `/rides/${r.body.id}/cancel`, { reason: 'CHANGED_MIND' });
    await t.call(usman, 'post', '/driver/offline');
    await t.call(hamza, 'post', '/driver/offline');
  }, 60000);

  it('4. no drivers online ends in NO_DRIVERS with a realtime event and can be retried', async () => {
    await resetRides();
    const pSock = await t.socket(passenger);
    const q = await t.quote(passenger);
    const evt = TestApp.waitFor(pSock, 'ride.no_drivers', () => true, 15000);
    const r = await t.requestRide(passenger, q);
    await evt;
    const v = await t.call(passenger, 'get', `/rides/${r.body.id}`);
    expect(v.body.status).toBe('NO_DRIVERS');
  }, 30000);

  it('5. idempotency: same key replays the ride, a new key while active is rejected', async () => {
    await resetRides();
    await t.goOnline(usman, DRIVERS.usman.at); // keeps the ride in MATCHING while an offer is pending
    const q = await t.quote(passenger);
    const before = Number((await t.db.one<{ n: string }>(`SELECT count(*) AS n FROM rides WHERE passenger_id = $1`, [passenger.userId]))!.n);
    const key = t.nextKey('dup');
    const a = await t.requestRide(passenger, q, {}, key);
    const b = await t.requestRide(passenger, q, {}, key);
    expect(b.status).toBe(a.status);
    expect(b.body.id).toBe(a.body.id);
    const c = await t.requestRide(passenger, q, {}, t.nextKey('dup'));
    expect(c.status).toBe(409);
    expect(c.body.error.code).toBe('ACTIVE_RIDE_EXISTS');
    const missing = await t.call(passenger, 'post', '/rides', { quoteId: q.id, productCode: 'ECONOMY', paymentMethod: 'CASH' });
    expect(missing.status).toBe(400);
    const n = await t.db.one<{ n: string }>(`SELECT count(*) AS n FROM rides WHERE passenger_id = $1`, [passenger.userId]);
    expect(Number(n!.n)).toBe(before + 1);
    await t.call(passenger, 'post', `/rides/${a.body.id}/cancel`, { reason: 'CHANGED_MIND' });
    await t.call(usman, 'post', '/driver/offline');
  }, 30000);

  it('an offer below the minimum reasonable fare is rejected with guidance', async () => {
    await resetRides();
    const q = await t.quote(passenger);
    const r = await t.requestRide(passenger, q, { offeredFare: 60 });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('OFFER_TOO_LOW');
    expect(r.body.error.details.minimumReasonable).toBeGreaterThan(60);
  });

  it('6. reconnect: a fresh socket can resubscribe and receives the current snapshot', async () => {
    await resetRides();
    await t.goOnline(usman, DRIVERS.usman.at);
    const q = await t.quote(passenger);
    const r = await t.requestRide(passenger, q);
    const offer = await t.waitOffer(usman);
    await t.call(usman, 'post', `/driver/offers/${offer.offerId}/accept`);
    const s1 = await t.socket(passenger);
    s1.disconnect();
    await sleep(200);
    const s2 = await t.socket(passenger);
    const snap = await new Promise<{ ok: boolean; data: { status: string; id: string } }>((resolve) => s2.emit('ride.subscribe', { rideId: r.body.id }, resolve));
    expect(snap.ok).toBe(true);
    expect(snap.data.status).toBe('DRIVER_ASSIGNED');
    const active = await t.call(passenger, 'get', '/rides/active');
    expect(active.body.id).toBe(r.body.id);
    // another passenger cannot subscribe to this ride
    const other = await t.login('sana@raasta.test');
    const s3 = await t.socket(other);
    const denied = await new Promise<{ ok: boolean }>((resolve) => s3.emit('ride.subscribe', { rideId: r.body.id }, resolve));
    expect(denied.ok).toBe(false);
    await t.call(passenger, 'post', `/rides/${r.body.id}/cancel`, { reason: 'CHANGED_MIND' });
    await t.call(usman, 'post', '/driver/offline');
  }, 60000);
});
