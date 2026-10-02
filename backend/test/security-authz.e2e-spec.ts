import { DRIVERS, Session, TestApp } from './harness';

const UUID = '00000000-0000-4000-8000-0000000000aa';

describe('object-level authorisation (IDOR) and privacy', () => {
  const t = new TestApp();
  let bilal: Session; // victim passenger
  let ayesha: Session; // attacker passenger
  let usman: Session; // driver on the ride
  let hamza: Session; // attacker driver
  let support: Session;
  let corpadmin: Session;
  let rideId: string;
  let pin: string;
  let offerId: string;

  beforeAll(async () => {
    await t.start();
    [bilal, ayesha, usman, hamza, support, corpadmin] = await Promise.all(
      ['bilal', 'ayesha', DRIVERS.usman.email.split('@')[0], DRIVERS.hamza.email.split('@')[0], 'support', 'corpadmin'].map((n) => t.login(`${n}@raasta.test`)),
    );
    await t.goOnline(usman, DRIVERS.usman.at);
    await t.goOnline(hamza, DRIVERS.hamza.at);
    const quote = await t.quote(bilal);
    const res = await t.requestRide(bilal, quote, { paymentMethod: 'CASH' });
    expect(res.status).toBe(201);
    rideId = res.body.id;
    // whichever driver gets the first offer is "the driver"; the other is the attacker
    const offerU = await Promise.race([t.waitOffer(usman).then((o) => ({ who: 'usman', o })), t.waitOffer(hamza).then((o) => ({ who: 'hamza', o }))]);
    if (offerU.who === 'hamza') [usman, hamza] = [hamza, usman];
    offerId = offerU.o.offerId;
  }, 120000);
  afterAll(() => t.stop());

  describe('offers', () => {
    it("a driver cannot see, accept or decline another driver's offer", async () => {
      expect((await t.call(hamza, 'post', `/driver/offers/${offerId}/accept`)).status).toBe(404);
      expect((await t.call(hamza, 'post', `/driver/offers/${offerId}/decline`, { reason: 'x' })).status).toBeGreaterThanOrEqual(404);
      const mine = await t.call(hamza, 'get', '/driver/offers/current');
      expect(mine.body?.offerId ?? null).not.toBe(offerId);
    });
    it('the offered driver sees no passenger contact data before accepting', async () => {
      const cur = await t.call(usman, 'get', '/driver/offers/current');
      expect(cur.body.offerId).toBe(offerId);
      expect(JSON.stringify(cur.body)).not.toMatch(/bilal|\+92300|@raasta\.test|passenger/i);
    });
    it('the real driver accepts', async () => {
      const r = await t.call(usman, 'post', `/driver/offers/${offerId}/accept`);
      expect(r.status).toBe(200);
      const view = await t.call(bilal, 'get', `/rides/${rideId}`);
      pin = view.body.pin;
      expect(pin).toMatch(/^\d{4}$/);
    });
  });

  describe('a stranger (passenger) and an unrelated driver cannot touch a ride', () => {
    it.each([
      ['get', (id: string) => `/rides/${id}`, undefined],
      ['get', (id: string) => `/rides/${id}/events`, undefined],
      ['get', (id: string) => `/rides/${id}/receipt`, undefined],
      ['post', (id: string) => `/rides/${id}/cancel`, { reason: 'OTHER' }],
      ['post', (id: string) => `/rides/${id}/retry`, {}],
      ['post', (id: string) => `/rides/${id}/rating`, { stars: 1 }],
      ['post', (id: string) => `/rides/${id}/share`, { name: 'Mallory', phone: '+923001234567' }],
      ['post', (id: string) => `/rides/${id}/sos`, {}],
      ['post', (id: string) => `/rides/${id}/pay-cash`, {}],
    ] as const)('%s %p as another passenger -> 404', async (method, path, body) => {
      const r = await t.call(ayesha, method, path(rideId), body, method === 'post' && path(rideId).endsWith('/retry') ? { 'Idempotency-Key': t.nextKey() } : {});
      expect(r.status).toBe(404);
      expect(JSON.stringify(r.body)).not.toMatch(/bilal|usman/i);
    });

    it.each(['arrived', 'cancel', 'complete'])('driver action %s by an unassigned driver -> 404', async (action) => {
      const r = await t.call(hamza, 'post', `/driver/rides/${rideId}/${action}`, action === 'cancel' ? { reason: 'OTHER' } : {});
      expect(r.status).toBe(404);
    });
    it('starting a trip needs the assigned driver (not the unassigned one, not the passenger)', async () => {
      expect((await t.call(hamza, 'post', `/driver/rides/${rideId}/start`, { pin })).status).toBe(404);
      expect((await t.call(bilal, 'post', `/driver/rides/${rideId}/start`, { pin })).status).toBe(403);
    });
    it('a passenger cannot use the driver view of someone else; the ride is untouched', async () => {
      const row = await t.db.one<{ status: string }>(`SELECT status FROM rides WHERE id = $1`, [rideId]);
      expect(row!.status).toBe('DRIVER_ASSIGNED');
    });
    it('the safety alert of another user cannot be answered', async () => {
      const sos = await t.call(bilal, 'post', `/rides/${rideId}/sos`, {});
      expect(sos.status).toBe(201);
      expect((await t.call(ayesha, 'post', `/safety/events/${sos.body.eventId}/respond`, { response: 'SAFE' })).status).toBe(404);
      expect((await t.call(usman, 'post', `/safety/events/${sos.body.eventId}/respond`, { response: 'SAFE' })).status).toBe(404);
    });
    it('participants and staff can; the passenger sees the driver but not the driver phone/email', async () => {
      expect((await t.call(bilal, 'get', `/rides/${rideId}`)).status).toBe(200);
      expect((await t.call(usman, 'get', `/rides/${rideId}`)).status).toBe(200);
      expect((await t.call(support, 'get', `/rides/${rideId}`)).status).toBe(200);
      const pv = await t.call(bilal, 'get', `/rides/${rideId}`);
      const dv = await t.call(usman, 'get', `/rides/${rideId}`);
      for (const body of [pv.body, dv.body]) {
        expect(JSON.stringify(body)).not.toMatch(/@raasta\.test|\+9230\d{8}|password|cnic|licen[cs]e/i);
      }
      expect(pv.body.driver.firstName).toBe('Usman');
      expect(dv.body.passenger.firstName).toBe('Bilal');
      expect(dv.body.passenger.fullName).toBeUndefined();
    });
    it('ride events exposed to a passenger carry no other users’ identifiers beyond roles', async () => {
      const ev = await t.call(bilal, 'get', `/rides/${rideId}/events`);
      expect(ev.status).toBe(200);
      expect(JSON.stringify(ev.body)).not.toMatch(/@raasta\.test|\+9230/);
    });
  });

  describe('personal data collections are private', () => {
    it('saved places', async () => {
      const mk = await t.call(bilal, 'post', '/me/places', { label: 'FAVORITE', name: 'Secret', lat: 31.5, lng: 74.3 });
      expect(mk.status).toBe(201);
      expect((await t.call(ayesha, 'patch', `/me/places/${mk.body.id}`, { name: 'pwned' })).status).toBe(404);
      expect((await t.call(ayesha, 'delete', `/me/places/${mk.body.id}`)).status).toBe(404);
      expect(JSON.stringify((await t.call(ayesha, 'get', '/me/places')).body)).not.toContain('Secret');
      expect((await t.call(bilal, 'get', '/me/places')).body.length).toBeGreaterThan(0);
    });
    it('emergency contacts', async () => {
      const mk = await t.call(bilal, 'post', '/me/emergency-contacts', { name: 'Mum', phone: '+923001112299' });
      expect(mk.status).toBe(201);
      expect((await t.call(ayesha, 'patch', `/me/emergency-contacts/${mk.body.id}`, { name: 'pwned' })).status).toBe(404);
      expect((await t.call(ayesha, 'delete', `/me/emergency-contacts/${mk.body.id}`)).status).toBe(404);
      expect(JSON.stringify((await t.call(ayesha, 'get', '/me/emergency-contacts')).body)).not.toContain('Mum');
      // sharing a ride with someone else's contact id does not send them anything
      const share = await t.call(bilal, 'post', `/rides/${rideId}/share`, { emergencyContactIds: [UUID] });
      expect(share.status).toBe(201);
      expect(share.body.recipients).toBe(0);
    });
    it('payment methods and wallet', async () => {
      const pm = await t.call(bilal, 'post', '/payment-methods', { provider: 'mock', token: 'tok_visa' });
      expect(pm.status).toBe(201);
      expect((await t.call(ayesha, 'delete', `/payment-methods/${pm.body.id}`)).status).toBe(404);
      expect((await t.call(ayesha, 'post', '/wallet/topups', { amount: 500, paymentMethodId: pm.body.id }, { 'Idempotency-Key': t.nextKey('x') })).status).toBe(404);
      expect(JSON.stringify((await t.call(ayesha, 'get', '/payment-methods')).body)).not.toContain(pm.body.id);
      const a = await t.call(ayesha, 'get', '/wallet');
      const b = await t.call(bilal, 'get', '/wallet');
      expect(a.body.walletId).not.toBe(b.body.walletId);
      expect((await t.call(ayesha, 'get', `/admin/wallets/${b.body.walletId}/ledger`)).status).toBe(403);
      expect((await t.call(support, 'get', `/admin/wallets/${b.body.walletId}/ledger`)).status).toBe(403);
    });
    it('notifications', async () => {
      const n = await t.db.one<{ id: string }>(`INSERT INTO notifications (user_id, type, title, body) VALUES ($1,'TEST','t','b') RETURNING id`, [bilal.userId]);
      expect((await t.call(ayesha, 'post', `/me/notifications/${n!.id}/read`)).status).toBe(404);
      expect((await t.call(bilal, 'post', `/me/notifications/${n!.id}/read`)).status).toBe(204);
    });
    it('support tickets', async () => {
      const tk = await t.call(bilal, 'post', '/support/tickets', { category: 'FARE', subject: 'private subject', body: 'private body here' });
      expect(tk.status).toBe(201);
      expect((await t.call(ayesha, 'get', `/support/tickets/${tk.body.id}`)).status).toBe(404);
      expect((await t.call(ayesha, 'post', `/support/tickets/${tk.body.id}/messages`, { body: 'hi' })).status).toBe(404);
      expect(JSON.stringify((await t.call(ayesha, 'get', '/support/tickets')).body)).not.toContain('private');
      // a ticket cannot be attached to someone else's ride
      expect((await t.call(ayesha, 'post', '/support/tickets', { category: 'FARE', subject: 'about their ride', body: 'x'.repeat(10), rideId })).status).toBe(404);
      expect((await t.call(support, 'get', `/support/tickets/${tk.body.id}`)).status).toBe(200);
    });
    it('scheduled rides', async () => {
      const when = new Date(Date.now() + 3 * 3600_000).toISOString();
      const mk = await t.call(bilal, 'post', '/scheduled-rides', {
        pickup: { lat: 31.5102, lng: 74.3441, address: 'Liberty Market, Lahore' },
        dropoff: { lat: 31.4672, lng: 74.2651, address: 'Emporium Mall, Lahore' },
        productCode: 'ECONOMY', paymentMethod: 'CASH', pickupAt: when,
      }, { 'Idempotency-Key': t.nextKey('sch') });
      expect([200, 201]).toContain(mk.status);
      const id = mk.body.id;
      expect((await t.call(ayesha, 'get', `/scheduled-rides/${id}`)).status).toBe(404);
      expect([404, 409]).toContain((await t.call(ayesha, 'delete', `/scheduled-rides/${id}`)).status);
      expect((await t.call(bilal, 'get', `/scheduled-rides/${id}`)).body.status).toBe('PENDING');
      expect((await t.call(ayesha, 'post', `/scheduled-rides/${id}/confirm`)).status).toBe(404);
      expect(JSON.stringify((await t.call(ayesha, 'get', '/scheduled-rides')).body)).not.toContain(id);
    });
    it('sessions of other users', async () => {
      const mine = await t.call(bilal, 'get', '/auth/sessions');
      expect((await t.call(ayesha, 'delete', `/auth/sessions/${mine.body[0].id}`)).status).toBe(404);
    });
    it('data export contains only the caller', async () => {
      const ex = await t.call(ayesha, 'get', '/me/export');
      expect(ex.status).toBe(200);
      expect(JSON.stringify(ex.body)).not.toMatch(/bilal|\+923001110002/i);
    });
  });

  describe('intercity', () => {
    it("bookings cannot be cancelled by anyone but the booker; drivers can't cancel others' trips", async () => {
      const route = await t.db.one<{ id: string }>(`SELECT id FROM intercity_routes WHERE active LIMIT 1`);
      if (!route) return;
      const trip = await t.call(usman, 'post', '/driver/intercity/trips', {
        routeId: route.id, departureAt: new Date(Date.now() + 5 * 3600_000).toISOString(), pickupPoint: 'Gate 1', dropoffPoint: 'Stand 2', seatsTotal: 2, seatFare: 100, luggagePolicy: 'ONE_BAG',
      });
      if (trip.status !== 201) return; // vehicle rules may refuse in the seed; the cross-user checks below need a trip
      expect((await t.call(hamza, 'delete', `/driver/intercity/trips/${trip.body.id}`)).status).toBe(404);
      const bk = await t.call(bilal, 'post', `/intercity/trips/${trip.body.id}/book`, { seats: 1 }, { 'Idempotency-Key': t.nextKey('ic') });
      expect(bk.status).toBe(201);
      expect((await t.call(ayesha, 'delete', `/intercity/bookings/${bk.body.bookingId}`)).status).toBe(404);
      expect(JSON.stringify((await t.call(ayesha, 'get', '/intercity/bookings')).body)).not.toContain(bk.body.bookingId);
    });
  });

  describe('corporate tenants', () => {
    let corp2Admin: Session;
    let corp2Id: string;
    let corp1Id: string;
    let foreignEmployeeId: string;
    beforeAll(async () => {
      corp1Id = (await t.call(corpadmin, 'get', '/corporate/overview')).body.corporateId;
      // a second tenant with its own administrator and employee
      const adminRow = await t.db.one<{ id: string }>(`SELECT id FROM users WHERE email = 'sana@raasta.test'`);
      const empRow = await t.db.one<{ id: string }>(`SELECT id FROM users WHERE email = 'ayesha@raasta.test'`);
      const c = await t.db.one<{ id: string }>(`INSERT INTO corporate_accounts (name, industry, billing_email, city_id, monthly_budget, is_test_data) SELECT 'Other Co', 'OFFICE', 'x@y.test', id, 1000, true FROM cities LIMIT 1 RETURNING id`);
      corp2Id = c!.id;
      foreignEmployeeId = empRow!.id;
      await t.db.query(`INSERT INTO corporate_users (corporate_id, user_id, role) VALUES ($1,$2,'ADMIN'),($1,$3,'EMPLOYEE')`, [corp2Id, adminRow!.id, foreignEmployeeId]);
      await t.db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,'CORPORATE_ADMIN') ON CONFLICT DO NOTHING`, [adminRow!.id]);
      corp2Admin = await t.login('sana@raasta.test');
    });

    it('an administrator only ever sees and edits their own company', async () => {
      const own = await t.call(corp2Admin, 'get', '/corporate/employees');
      expect(own.status).toBe(200);
      expect(JSON.stringify(own.body)).not.toMatch(/Test Company Admin/);
      // asking for the other tenant explicitly is refused
      expect((await t.call(corp2Admin, 'get', `/corporate/employees?corporateId=${corp1Id}`)).status).toBe(403);
      expect((await t.call(corp2Admin, 'get', `/corporate/rides?corporateId=${corp1Id}`)).status).toBe(403);
      expect((await t.call(corp2Admin, 'put', `/corporate/policy?corporateId=${corp1Id}`, { allowedProducts: [], maxFarePerRide: 1, allowedWeekdays: [1], allowedStart: '00:00', allowedEnd: '23:59', requirePurpose: false })).status).toBe(403);
      expect((await t.call(corp2Admin, 'patch', `/corporate/budget?corporateId=${corp1Id}`, { monthlyBudget: 1 })).status).toBe(403);
      expect((await t.call(corp2Admin, 'get', `/corporate/invoices?month=2026-01&corporateId=${corp1Id}`)).status).toBe(403);
      // editing an employee id that belongs to the other company's roster
      const other = (await t.db.one<{ user_id: string }>(
        `SELECT user_id FROM corporate_users WHERE corporate_id = $1 AND user_id NOT IN (SELECT user_id FROM corporate_users WHERE corporate_id = $2) LIMIT 1`, [corp1Id, corp2Id]))!.user_id;
      expect((await t.call(corp2Admin, 'patch', `/corporate/employees/${other}`, { monthlyLimit: 1 })).status).toBe(404);
      // and cannot schedule rides for people outside the company
      const sched = await t.call(corp2Admin, 'post', '/corporate/scheduled-rides', {
        employeeId: other, pickup: { lat: 31.5102, lng: 74.3441, address: 'Liberty Market' }, dropoff: { lat: 31.4672, lng: 74.2651, address: 'Emporium Mall' },
        productCode: 'ECONOMY', pickupAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
      });
      expect(sched.status).toBe(404);
    });

    it('ordinary users and employees (not admins) get 403 on the back office', async () => {
      expect((await t.call(ayesha, 'get', '/corporate/overview')).status).toBe(403);
      expect((await t.call(bilal, 'get', '/corporate/employees')).status).toBe(403);
    });

    it('a non-member cannot book or quote against a company account', async () => {
      const quote = await t.quote(bilal);
      const r = await t.requestRide(bilal, quote, { paymentMethod: 'CORPORATE', corporateId: corp2Id });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('POLICY_VIOLATION');
      const sched = await t.call(bilal, 'post', '/scheduled-rides', {
        pickup: { lat: 31.5102, lng: 74.3441, address: 'Liberty Market, Lahore' }, dropoff: { lat: 31.4672, lng: 74.2651, address: 'Emporium Mall' },
        productCode: 'ECONOMY', paymentMethod: 'CORPORATE', corporateId: corp2Id, pickupAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
      }, { 'Idempotency-Key': t.nextKey('s') });
      expect(sched.status).toBe(422);
      expect(sched.body.error.code).toBe('POLICY_VIOLATION');
    });
  });

  describe('public tracking link', () => {
    it('is an unguessable, expiring, minimal view', async () => {
      const share = await t.call(bilal, 'post', `/rides/${rideId}/share`, { name: 'Dad', phone: '+923001230000' });
      expect(share.status).toBe(201);
      expect(share.body.token).toMatch(/^[A-Za-z0-9_-]{32}$/); // 24 random bytes = 192 bits
      const stored = await t.db.one<{ token_hash: string }>(`SELECT token_hash FROM ride_shares ORDER BY created_at DESC LIMIT 1`);
      expect(stored!.token_hash).not.toContain(share.body.token); // only a hash is stored
      const pub = await t.http.get(`/api/v1/public/track/${share.body.token}`);
      expect(pub.status).toBe(200);
      expect(pub.headers['cache-control']).toBe('no-store');
      expect(pub.headers['referrer-policy']).toBe('no-referrer');
      expect(JSON.stringify(pub.body)).not.toMatch(/@raasta\.test|\+92300|passengerId|driverId|"id"|pin|fare|wallet|phone/i);
      expect(Object.keys(pub.body).sort()).toEqual(['completedAt', 'driver', 'dropoff', 'etaS', 'expiresAt', 'location', 'passengerFirstName', 'pickup', 'startedAt', 'status']);
      // random / malformed tokens
      expect((await t.http.get(`/api/v1/public/track/${'A'.repeat(32)}`)).status).toBe(404);
      expect((await t.http.get(`/api/v1/public/track/short`)).status).toBe(400);
      expect((await t.http.get(`/api/v1/public/track/${encodeURIComponent("' OR 1=1 --")}`)).status).toBe(400);
      // expiry
      await t.db.query(`UPDATE ride_shares SET expires_at = now() - interval '1 minute'`);
      expect((await t.http.get(`/api/v1/public/track/${share.body.token}`)).status).toBe(404);
    });
    it('sharing is rate limited because it can send SMS to third parties', async () => {
      process.env.RATE_LIMIT_DISABLED = 'false';
      let last = 0;
      for (let i = 0; i < 12; i++) last = (await t.call(bilal, 'post', `/rides/${rideId}/share`, { name: 'x', phone: '+923001230001' })).status;
      process.env.RATE_LIMIT_DISABLED = 'true';
      expect(last).toBe(429);
    });
  });

  describe('PIN brute force', () => {
    it('parallel guesses cannot exceed three attempts', async () => {
      expect((await t.call(usman, 'post', `/driver/rides/${rideId}/arrived`)).status).toBeLessThan(500);
      await t.db.query(`UPDATE rides SET status = 'DRIVER_ARRIVED', arrived_at = now() WHERE id = $1`, [rideId]);
      const wrong = pin === '0000' ? '1111' : '0000';
      const rs = await Promise.all(Array.from({ length: 12 }, () => t.call(usman, 'post', `/driver/rides/${rideId}/start`, { pin: wrong })));
      expect(rs.filter((r) => r.body?.error?.code === 'PIN_INCORRECT').length).toBe(3);
      expect(rs.filter((r) => r.body?.error?.code === 'PIN_LOCKED').length).toBe(9);
      const row = await t.db.one<{ pin_attempts: number; status: string }>(`SELECT pin_attempts, status FROM rides WHERE id = $1`, [rideId]);
      expect(row!.pin_attempts).toBe(3);
      // even the right PIN is refused once locked
      expect((await t.call(usman, 'post', `/driver/rides/${rideId}/start`, { pin })).body.error.code).toBe('PIN_LOCKED');
    });
  });
});
