import { AiClient } from '../src/modules/ai/ai.client';
import { DRIVERS, Session, TestApp } from './harness';
import { endActiveRides } from './helpers';

const nlu = (over: Record<string, unknown> = {}) => ({
  intent: 'BOOK_RIDE', language: 'en', confidence: 0.9, engine: 'test-stub', missing: [],
  slots: { pickup: 'Liberty Market', dropoff: 'Emporium Mall', datetime: null, productCode: null, preference: null, period: null },
  ...over,
});

describe('assistant (AI service stubbed; the stub is test-only)', () => {
  const t = new TestApp();
  let s: Session;
  let spy: jest.SpyInstance;
  beforeAll(async () => { await t.start(); s = await t.login('bilal@raasta.test'); spy = jest.spyOn(t.get(AiClient), 'nlu'); await t.goOnline(await t.login(DRIVERS.usman.email), DRIVERS.usman.at); }, 120000);
  afterAll(() => t.stop());

  it('13a. says it is unavailable, and books nothing, when the AI service is down', async () => {
    spy.mockResolvedValue(null);
    const r = await t.call(s, 'post', '/assistant/message', { text: 'Johar Town se Liberty jana hai' });
    expect(r.status).toBe(200);
    expect(r.body.intent).toBe('UNAVAILABLE');
    expect(r.body.pendingAction).toBeUndefined();
  });

  it('13b. a clear booking creates a pending action only; confirm books once; token is single-use', async () => {
    spy.mockResolvedValue(nlu());
    const m = await t.call(s, 'post', '/assistant/message', { text: 'Book a ride from Liberty Market to Emporium Mall', lat: 31.5102, lng: 74.3441 });
    expect(m.status).toBe(200);
    if (!m.body.pendingAction) throw new Error(JSON.stringify(m.body));
    expect(m.body.pendingAction?.token).toBeTruthy();
    expect((await t.call(s, 'get', '/rides/active')).body?.id).toBeUndefined(); // nothing booked yet
    const c = await t.call(s, 'post', '/assistant/confirm', { token: m.body.pendingAction.token, paymentMethod: 'CASH' });
    expect(c.status).toBe(200);
    const again = await t.call(s, 'post', '/assistant/confirm', { token: m.body.pendingAction.token, paymentMethod: 'CASH' });
    expect(again.status).toBeGreaterThanOrEqual(400);
    const n = await t.db.one<{ n: string }>(`SELECT count(*) AS n FROM rides WHERE passenger_id = $1`, [s.userId]);
    expect(Number(n!.n)).toBe(1);
    await endActiveRides(t);
    const u = await t.login(DRIVERS.usman.email);
    await t.call(u, 'post', '/driver/offline');
    await t.goOnline(u, DRIVERS.usman.at);
  });

  it('13c. another user cannot confirm my pending action', async () => {
    spy.mockResolvedValue(nlu());
    const m = await t.call(s, 'post', '/assistant/message', { text: 'Book a ride from Liberty Market to Emporium Mall', lat: 31.5102, lng: 74.3441 });
    expect(m.body.pendingAction?.token).toBeTruthy();
    const other = await t.login('ayesha@raasta.test');
    const c = await t.call(other, 'post', '/assistant/confirm', { token: m.body.pendingAction.token, paymentMethod: 'CASH' });
    expect(c.status).toBeGreaterThanOrEqual(400);
  });

  it('13d. low confidence or missing destination never produces a booking', async () => {
    spy.mockResolvedValue(nlu({ confidence: 0.3 }));
    const low = await t.call(s, 'post', '/assistant/message', { text: 'hmm maybe' });
    expect(low.body.pendingAction).toBeUndefined();
    spy.mockResolvedValue(nlu({ slots: { pickup: 'Johar Town', dropoff: null }, missing: ['dropoff'] }));
    const miss = await t.call(s, 'post', '/assistant/message', { text: 'take me from Johar Town' });
    expect(miss.body.pendingAction).toBeUndefined();
    expect(miss.body.missing).toContain('dropoff');
  });

  it('13e. voice: an unknown place is not guessed into a booking', async () => {
    spy.mockResolvedValue(nlu({ slots: { pickup: 'Johar Town', dropoff: 'Zzyzx Nowhere Place' } }));
    const v = await t.call(s, 'post', '/voice/parse', { transcript: 'Johar Town se Zzyzx jana hai' });
    expect(v.status).toBe(200);
    expect(v.body.pendingAction).toBeUndefined();
  });

  it('personalization can be switched off and deleted', async () => {
    expect((await t.call(s, 'patch', '/me/personalization', { enabled: false })).status).toBe(200);
    expect((await t.call(s, 'delete', '/me/personalization')).status).toBeLessThan(300);
  });
});

describe('scheduling', () => {
  const t = new TestApp();
  let s: Session;
  beforeAll(async () => { await t.start(); s = await t.login('bilal@raasta.test'); }, 120000);
  afterAll(() => t.stop());
  const places = {
    pickup: { lat: 31.5102, lng: 74.3441, address: 'Liberty Market, Gulberg III, Lahore' },
    dropoff: { lat: 31.4672, lng: 74.2651, address: 'Emporium Mall, Johar Town, Lahore' },
  };

  it('9a. a one-off scheduled ride is stored, must be in the future, and can be cancelled', async () => {
    const past = await t.call(s, 'post', '/scheduled-rides', { ...places, productCode: 'ECONOMY', paymentMethod: 'CASH', pickupAt: new Date(Date.now() - 3600_000).toISOString() });
    expect(past.status).toBeGreaterThanOrEqual(400);
    const at = new Date(Date.now() + 3 * 3600_000).toISOString();
    const ok = await t.call(s, 'post', '/scheduled-rides', { ...places, productCode: 'ECONOMY', paymentMethod: 'CASH', pickupAt: at });
    expect(ok.status).toBe(201);
    expect((await t.call(s, 'get', '/scheduled-rides')).body.items?.length ?? (await t.call(s, 'get', '/scheduled-rides')).body.length).toBeGreaterThan(0);
    expect((await t.call(s, 'delete', `/scheduled-rides/${ok.body.id}`)).status).toBeLessThan(300);
  });

  it('9b. a due scheduled ride dispatches through the normal matching flow', async () => {
    const driver = await t.login(DRIVERS.usman.email);
    await t.goOnline(driver, DRIVERS.usman.at);
    const at = new Date(Date.now() + 3 * 3600_000).toISOString();
    const r = await t.call(s, 'post', '/scheduled-rides', { ...places, productCode: 'ECONOMY', paymentMethod: 'CASH', pickupAt: at });
    expect(r.status).toBe(201);
    await t.db.query(`UPDATE scheduled_rides SET dispatch_at = now() - interval '1 minute' WHERE id = $1`, [r.body.id]);
    const { SchedulingService } = await import('../src/modules/scheduling/scheduling.service');
    await t.get(SchedulingService).dispatchDue();
    const row = await t.db.one<{ status: string; ride_id: string | null }>(`SELECT status, ride_id FROM scheduled_rides WHERE id = $1`, [r.body.id]);
    expect(row!.ride_id).toBeTruthy();
    const offer = await t.waitOffer(driver);
    expect(offer.rideId).toBe(row!.ride_id);
  }, 30000);

  it('9c. recurring rides do not auto-dispatch unless the user opted in', async () => {
    const rec = await t.call(s, 'post', '/recurring-rides', { label: 'Office', ...places, productCode: 'ECONOMY', paymentMethod: 'CASH', daysOfWeek: [1, 2, 3, 4, 5, 6, 7], pickupTime: '08:15' });
    expect(rec.status).toBe(201);
    const row = await t.db.one<{ auto_dispatch: boolean }>(`SELECT auto_dispatch FROM recurring_rides WHERE id = $1`, [rec.body.id]);
    expect(row!.auto_dispatch).toBe(false);
  });
});

describe('admin', () => {
  const t = new TestApp();
  let admin: Session;
  beforeAll(async () => { await t.start(); admin = await t.login('admin@raasta.test'); }, 120000);
  afterAll(() => t.stop());

  it('14a. pricing updates require a reason and are audited', async () => {
    const list = await t.call(admin, 'get', '/admin/pricing');
    expect(list.status).toBe(200);
    const items = list.body.items ?? list.body;
    const cfg = items[0];
    const keys = ['baseFare', 'perKm', 'perMinute', 'minimumFare', 'bookingFee', 'platformFeePct', 'fuelCostPerKm', 'maxSurgeMultiplier', 'minOfferPct', 'sharedDiscountPct', 'cancellationFee', 'freeCancelSeconds'];
    const body: Record<string, unknown> = {};
    for (const k of keys) body[k] = Number(cfg[k]);
    const noReason = await t.call(admin, 'put', `/admin/pricing/${cfg.id}`, body);
    expect(noReason.status).toBe(400);
    const ok = await t.call(admin, 'put', `/admin/pricing/${cfg.id}`, { ...body, baseFare: body.baseFare as number + 5, reason: 'e2e test adjustment' });
    if (ok.status >= 300) throw new Error(JSON.stringify(ok.body));
    expect(ok.status).toBeLessThan(300);
    const audit = await t.db.one<{ n: string }>(`SELECT count(*) AS n FROM audit_logs WHERE actor_id = $1`, [admin.userId]);
    expect(Number(audit!.n)).toBeGreaterThan(0);
  });

  it('14b. driver approval is blocked until documents are human-approved', async () => {
    const reg = await t.http.post('/api/v1/auth/register').send({ fullName: 'Pending Driver', email: 'pending.driver@raasta.test', password: 'Sup3rSecret', role: 'DRIVER', device: { deviceId: 'd-pend', platform: 'android' } });
    expect(reg.status).toBe(201);
    const id = reg.body.user.id;
    const before = await t.db.one<{ status: string }>(`SELECT status FROM drivers WHERE user_id = $1`, [id]);
    expect(before).toBeTruthy();
    expect(before!.status).not.toBe('APPROVED');
    const r = await t.call(admin, 'post', `/admin/drivers/${id}/approve`, { reason: 'e2e: should be refused, no documents' });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
    expect((await t.db.one<{ status: string }>(`SELECT status FROM drivers WHERE user_id = $1`, [id]))!.status).not.toBe('APPROVED');
  });

  it('14c. live map and KPIs respond; non-admins are refused', async () => {
    expect((await t.call(admin, 'get', '/admin/analytics/kpis')).status).toBe(200);
    const live = await t.call(admin, 'get', '/admin/live-map');
    expect(live.status).toBe(200);
    expect(live.body).toHaveProperty('drivers');
    const p = await t.login('ayesha@raasta.test');
    expect((await t.call(p, 'get', '/admin/audit-logs')).status).toBe(403);
  });
});
