import { destinationPoint, bearingDeg } from '../src/common/geo/geo';
import { DevOutbox } from '../src/common/providers/messaging';
import { DRIVERS, EMPORIUM, LIBERTY, Session, TestApp } from './harness';
import { startTrip } from './helpers';

describe('safety engine', () => {
  const t = new TestApp();
  let passenger: Session;
  let usman: Session;
  beforeAll(async () => {
    await t.start();
    passenger = await t.login('bilal@raasta.test');
    usman = await t.login(DRIVERS.usman.email);
  }, 120000);
  afterAll(() => t.stop());

  it('7. route deviation: on-route stays quiet, off-corridor raises an event, passenger responds SAFE', async () => {
    const pSock = await t.socket(passenger);
    const { rideId, route } = await startTrip(t, passenger, usman);
    // drive along the planned route: no alert
    for (let i = 0; i < route.length; i += Math.ceil(route.length / 6)) await t.call(usman, 'post', '/driver/location', { lat: route[i][0], lng: route[i][1], speed: 10 });
    expect(Number((await t.db.one<{ n: string }>(`SELECT count(*) AS n FROM safety_events WHERE ride_id = $1`, [rideId]))!.n)).toBe(0);

    // leave the corridor perpendicular to the route and stay out for 3 pings
    const mid = { lat: route[Math.floor(route.length / 2)][0], lng: route[Math.floor(route.length / 2)][1] };
    const side = bearingDeg(LIBERTY, EMPORIUM) + 90;
    const alert = TestApp.waitFor<{ eventId: string; type: string; severity: string; actions: { code: string }[] }>(pSock, 'ride.route_deviation');
    for (const d of [900, 1400, 1900]) {
      const p = destinationPoint(mid, side, d);
      await t.call(usman, 'post', '/driver/location', { lat: p.lat, lng: p.lng, speed: 10 });
    }
    const evt = await alert;
    expect(evt.type).toBe('ROUTE_DEVIATION');
    expect(evt.actions.map((a) => a.code)).toEqual(expect.arrayContaining(['SAFE', 'SOS']));
    // one excursion = one event (no alert storm)
    expect(Number((await t.db.one<{ n: string }>(`SELECT count(*) AS n FROM safety_events WHERE ride_id = $1 AND type = 'ROUTE_DEVIATION'`, [rideId]))!.n)).toBe(1);

    const ok = await t.call(passenger, 'post', `/safety/events/${evt.eventId}/respond`, { response: 'SAFE' });
    expect(ok.status).toBe(201);
    const row = await t.db.one<{ status: string; passenger_response: string }>(`SELECT status, passenger_response FROM safety_events WHERE id = $1`, [evt.eventId]);
    expect(row!.passenger_response).toBe('SAFE');
    expect(row!.status).toBe('CONFIRMED_SAFE');
    // the driver is never accused: passenger-facing text is neutral
    expect(evt).not.toHaveProperty('driverName');
    expect(JSON.stringify(evt)).not.toMatch(/kidnap|attack|fraud|unsafe driver/i);
    await t.db.query(`UPDATE rides SET status = 'CANCELLED' WHERE id = $1`, [rideId]);
    await t.call(usman, 'post', '/driver/offline');
  }, 60000);

  it('8. SOS creates a CRITICAL event, notifies emergency contacts by SMS and alerts ops', async () => {
    await t.redis.client.flushdb();
    const contact = await t.call(passenger, 'post', '/me/emergency-contacts', { name: 'Amma', phone: '+923001234000', relationship: 'Mother' });
    expect(contact.status).toBe(201);
    const admin = await t.login('admin@raasta.test');
    const adminSock = await t.socket(admin);
    const { rideId } = await startTrip(t, passenger, usman);
    const opsAlert = TestApp.waitFor<{ type: string; severity: string }>(adminSock, 'safety.alert', (p) => p.type === 'SOS');
    const res = await t.call(passenger, 'post', `/rides/${rideId}/sos`, {});
    expect(res.status).toBe(201);
    expect((await opsAlert).severity).toBe('CRITICAL');
    const ev = await t.db.one<{ type: string; severity: string }>(`SELECT type, severity FROM safety_events WHERE ride_id = $1 AND type = 'SOS'`, [rideId]);
    expect(ev!.severity).toBe('CRITICAL');
    const sms = t.get(DevOutbox).messages.filter((m) => m.channel === 'SMS' && m.to.includes('3001234000'));
    expect(sms.length).toBeGreaterThan(0);
    expect(sms[0].body).toMatch(/SOS/);
    expect(sms[0].body).toMatch(/\/track\//); // live-tracking link for the contact
    // the public tracking link exposes limited fields only
    const token = /\/track\/([\w-]+)/.exec(sms[0].body)![1];
    const pub = await t.http.get(`/api/v1/public/track/${token}`);
    expect(pub.status).toBe(200);
    expect(JSON.stringify(pub.body)).not.toMatch(/pin|phone|email/i);
    // a stranger cannot SOS someone else's ride
    const sana = await t.login('sana@raasta.test');
    expect((await t.call(sana, 'post', `/rides/${rideId}/sos`, {})).status).toBe(404);
    await t.db.query(`UPDATE rides SET status = 'CANCELLED' WHERE id = $1`, [rideId]);
  }, 60000);

  it('ending far from the destination raises a low-severity neutral alert', async () => {
    await t.redis.client.flushdb();
    const pSock = await t.socket(passenger);
    const { rideId } = await startTrip(t, passenger, usman);
    const alert = TestApp.waitFor<{ type: string; severity: string }>(pSock, 'safety.alert', (p) => p.type === 'END_FAR_FROM_DESTINATION');
    await t.call(usman, 'post', `/driver/rides/${rideId}/complete`, { lat: LIBERTY.lat + 0.02, lng: LIBERTY.lng });
    expect((await alert).severity).toBe('LOW');
  }, 60000);
});
