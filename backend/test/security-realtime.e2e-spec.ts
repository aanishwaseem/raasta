import { io, Socket } from 'socket.io-client';
import { DRIVERS, Session, TestApp } from './harness';

const ack = (s: Socket, event: string, payload: unknown) =>
  new Promise<{ ok: boolean; error?: { code: string } }>((resolve) => s.emit(event, payload, resolve));

describe('realtime gateway security', () => {
  const t = new TestApp();
  let bilal: Session;
  let ayesha: Session;
  let usman: Session;
  let rideId: string;

  beforeAll(async () => {
    await t.start();
    [bilal, ayesha, usman] = await Promise.all(['bilal', 'ayesha', DRIVERS.usman.email.split('@')[0]].map((n) => t.login(`${n}@raasta.test`)));
    const quote = await t.quote(bilal);
    const res = await t.requestRide(bilal, quote, { paymentMethod: 'CASH' });
    expect(res.status).toBe(201);
    rideId = res.body.id;
  }, 60000);
  afterAll(() => t.stop());

  const connect = (auth: Record<string, unknown>) =>
    new Promise<Socket>((resolve, reject) => {
      const s = io(`${t.baseUrl}/realtime`, { auth, transports: ['websocket'], reconnection: false });
      s.once('connect', () => resolve(s));
      s.once('connect_error', reject);
    });

  it('refuses sockets with no, garbage or tampered tokens', async () => {
    await expect(connect({})).rejects.toBeDefined();
    await expect(connect({ token: 'not-a-jwt' })).rejects.toBeDefined();
    await expect(connect({ token: bilal.token.slice(0, -4) + 'AAAA' })).rejects.toBeDefined();
  });

  it('a stranger cannot subscribe to someone else’s ride room; the participant can', async () => {
    const a = await t.socket(ayesha);
    const denied = await ack(a, 'ride.subscribe', { rideId });
    expect(denied.ok).toBe(false);
    const b = await t.socket(bilal);
    expect((await ack(b, 'ride.subscribe', { rideId })).ok).toBe(true);
    // a stranger receives nothing that is emitted to the ride room
    let leaked = false;
    a.on('ride.updated', () => (leaked = true));
    await t.call(bilal, 'post', `/rides/${rideId}/cancel`, { reason: 'OTHER' });
    await new Promise((r) => setTimeout(r, 500));
    expect(leaked).toBe(false);
  });

  it('malformed subscribe payloads fail cleanly instead of crashing the gateway', async () => {
    const s = await t.socket(usman);
    for (const p of [null, undefined, 5, 'x', {}, { rideId: 5 }, { rideId: 'nope' }, { rideId: { $ne: 1 } }]) {
      const r = await Promise.race([ack(s, 'ride.subscribe', p), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('no ack for ' + JSON.stringify(p))), 3000))]);
      expect(r.ok).toBe(false);
    }
    expect((await ack(s, 'ping', {})).ok).toBe(true);
  });

  it('a revoked session can no longer open a socket', async () => {
    const fresh = await t.login('ayesha@raasta.test');
    expect((await t.call(fresh, 'post', '/auth/logout')).status).toBeLessThan(300);
    await expect(connect({ token: fresh.token })).rejects.toBeDefined();
  });

  it('floods are throttled and then disconnected', async () => {
    const s = await t.socket(usman);
    const closed = new Promise<void>((r) => s.once('disconnect', () => r()));
    for (let i = 0; i < 2000; i++) s.emit('ping', {});
    await Promise.race([closed, new Promise((_, rej) => setTimeout(() => rej(new Error('not disconnected')), 8000))]);
    expect(s.connected).toBe(false);
  });
});
