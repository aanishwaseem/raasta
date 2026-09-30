/**
 * Cross-service test: the real NestJS backend talking to the real Python AI service over HTTP.
 * No mocks. Needs python3 with the ai-service requirements installed.
 */
import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import { config, resetConfigForTests } from '../src/config/config';
import { AiClient } from '../src/modules/ai/ai.client';
import { rankCandidates } from '../src/modules/matching/scoring';
import { DRIVERS, EMPORIUM, LIBERTY, Session, TestApp, sleep } from './harness';
import { endActiveRides } from './helpers';

const PORT = 18765;
const TOKEN = 'e2e-ai-token';

describe('backend ↔ Python AI service (live)', () => {
  const t = new TestApp();
  let py: ChildProcess;
  let s: Session;

  beforeAll(async () => {
    process.env.AI_SERVICE_URL = `http://127.0.0.1:${PORT}`;
    process.env.AI_INTERNAL_TOKEN = TOKEN;
    process.env.AI_TIMEOUT_MS = '2000';
    resetConfigForTests();
    py = spawn('python3', ['-m', 'uvicorn', 'app.main:app', '--port', String(PORT), '--log-level', 'warning'], {
      cwd: path.resolve(__dirname, '../../ai-service'),
      env: { ...process.env, AI_INTERNAL_TOKEN: TOKEN, MODELS_DIR: '/tmp/raasta-e2e-models', DATABASE_URL: '' },
      stdio: 'ignore',
    });
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break;
      } catch { /* not up yet */ }
      await sleep(250);
    }
    await t.start();
    s = await t.login('bilal@raasta.test');
  }, 120000);

  afterAll(async () => {
    py?.kill('SIGTERM');
    await t.stop();
    resetConfigForTests();
  });

  it('health and auth: the client reaches the service with the shared token', async () => {
    expect(config().AI_SERVICE_URL).toContain(String(PORT));
    expect(await t.get(AiClient).health()).toBe(true);
    const bad = await fetch(`http://127.0.0.1:${PORT}/v1/models`, { headers: { 'x-internal-token': 'nope' } });
    expect(bad.status).toBe(401);
  });

  it('ETA cold start returns the provider estimate, flagged as fallback, never an invented number', async () => {
    const [p] = await t.get(AiClient).predictEta([{ kind: 'TRIP', distanceM: 6000, providerDurationS: 780, hour: 9, weekday: 3, cityId: 'x' }]);
    expect(p.etaS).toBe(780);
    expect(p.fallback).toBe(true);
  });

  it('TS and Python rankings agree on the same candidates (cross-language parity, live)', async () => {
    const base = { offersReceived: 40, offersAccepted: 32, tripsAssigned: 30, tripsCompleted: 29, driverCancellations: 1, ratingAvg: 4.8, ratingCount: 30, routeCompatibility: 0.5, preferenceMatch: 0.5 };
    const cands = [
      { ...base, driverId: 'A', distanceM: 1000, pickupEtaS: 240, driverCancellations: 5 },
      { ...base, driverId: 'B', distanceM: 1600, pickupEtaS: 300, driverCancellations: 0 },
      { ...base, driverId: 'C', distanceM: 3000, pickupEtaS: 500, ratingAvg: null, ratingCount: 0 },
    ];
    const { ranked, meta } = await t.get(AiClient).rank(cands, { tripDistanceM: 5000 });
    expect(meta.fallback).toBe(false);
    const local = rankCandidates(cands);
    expect(ranked.map((r) => r.driverId)).toEqual(local.map((r) => r.driverId));
    ranked.forEach((r, i) => expect(r.score).toBeCloseTo(local[i].score, 9));
  });

  it('real NLU → pending action → explicit confirm → ride (no stubs)', async () => {
    await t.goOnline(await t.login(DRIVERS.usman.email), DRIVERS.usman.at);
    const m = await t.call(s, 'post', '/assistant/message', { text: 'Liberty Market se Emporium Mall jana hai', lat: LIBERTY.lat, lng: LIBERTY.lng });
    expect(m.status).toBe(200);
    expect(m.body.intent).toBe('BOOK_RIDE');
    expect(m.body.language).toBe('roman-ur');
    expect(m.body.pendingAction?.token).toBeTruthy();
    expect(Number((await t.db.one<{ n: string }>(`SELECT count(*) AS n FROM rides WHERE passenger_id = $1`, [s.userId]))!.n)).toBe(0);
    const c = await t.call(s, 'post', '/assistant/confirm', { token: m.body.pendingAction.token, paymentMethod: 'CASH' });
    expect(c.status).toBe(200);
    expect(Number((await t.db.one<{ n: string }>(`SELECT count(*) AS n FROM rides WHERE passenger_id = $1`, [s.userId]))!.n)).toBe(1);
    await endActiveRides(t);
  });

  it('an ambiguous voice command books nothing', async () => {
    const v = await t.call(s, 'post', '/voice/parse', { transcript: 'hmm maybe' });
    expect(v.body.pendingAction).toBeUndefined();
  });

  it('when the AI service dies, rides still work and the assistant says it is unavailable', async () => {
    py.kill('SIGTERM');
    await sleep(800);
    const a = await t.call(s, 'post', '/assistant/message', { text: 'Liberty se Emporium jana hai' });
    expect(a.body.intent).toBe('UNAVAILABLE');
    const driver = await t.login(DRIVERS.hamza.email); // fresh driver: usman was used by the previous test
    await t.goOnline(driver, DRIVERS.hamza.at);
    await t.call(await t.login(DRIVERS.usman.email), 'post', '/driver/offline');
    const q = await t.quote(s, LIBERTY, EMPORIUM);
    expect(q.options.length).toBeGreaterThan(0);
    const r = await t.requestRide(s, q);
    expect(r.status).toBe(201);
    // the previous test's offer may still be live for a few seconds; wait for this ride's offer
    let offered = '';
    for (let i = 0; i < 60 && offered !== r.body.id; i++) {
      const cur = await t.call(driver, 'get', '/driver/offers/current');
      offered = cur.body?.rideId ?? '';
      if (offered !== r.body.id) await sleep(250);
    }
    if (offered !== r.body.id) {
      const row = await t.db.one(`SELECT status, match_attempt FROM rides WHERE id = $1`, [r.body.id]);
      const offers = await t.db.query(`SELECT driver_id, status, sent_at FROM ride_requests WHERE ride_id = $1`, [r.body.id]);
      throw new Error(`no offer. ride=${JSON.stringify(row)} offers=${JSON.stringify(offers)}`);
    }
    expect(offered).toBe(r.body.id); // ranking fell back to the local scorer
  }, 40000);
});
