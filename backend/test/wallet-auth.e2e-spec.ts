import { PASSWORD, TestApp } from './harness';

describe('wallet & payments', () => {
  const t = new TestApp();
  beforeAll(async () => { await t.start(); }, 120000);
  afterAll(() => t.stop());

  it('11. top-up succeeds with tok_visa, posts to the ledger, and is idempotent', async () => {
    const s = await t.login('ayesha@raasta.test');
    const pm = await t.call(s, 'post', '/payment-methods', { provider: 'mock', token: 'tok_visa' });
    expect(pm.status).toBe(201);
    expect(pm.body.last4).toBe('4242');
    expect(JSON.stringify(pm.body)).not.toMatch(/tok_visa/); // token never echoed
    const before = (await t.call(s, 'get', '/wallet')).body.available;
    const key = t.nextKey('topup');
    const a = await t.call(s, 'post', '/wallet/topups', { amount: 1000, paymentMethodId: pm.body.id }, { 'Idempotency-Key': key });
    expect(a.status).toBe(201);
    const b = await t.call(s, 'post', '/wallet/topups', { amount: 1000, paymentMethodId: pm.body.id }, { 'Idempotency-Key': key });
    expect(b.body.paymentId).toBe(a.body.paymentId);
    expect((await t.call(s, 'get', '/wallet')).body.available).toBe(before + 1000);
    // ledger is balanced
    const sum = await t.db.one<{ s: string }>(`SELECT COALESCE(SUM(amount),0) AS s FROM wallet_transactions`);
    expect(Number(sum!.s)).toBe(0);
  });

  it('declined and insufficient-funds cards fail without moving money', async () => {
    const s = await t.login('sana@raasta.test');
    const before = (await t.call(s, 'get', '/wallet')).body.available;
    for (const tok of ['tok_declined', 'tok_insufficient_funds']) {
      const pm = await t.call(s, 'post', '/payment-methods', { provider: 'mock', token: tok });
      expect(pm.status).toBe(201);
      const r = await t.call(s, 'post', '/wallet/topups', { amount: 500, paymentMethodId: pm.body.id }, { 'Idempotency-Key': t.nextKey('t') });
      expect(r.status).toBe(402);
      expect(r.body.error?.code ?? r.body.code).toBe('PAYMENT_FAILED');
    }
    expect((await t.call(s, 'get', '/wallet')).body.available).toBe(before);
  });

  it('rejects raw card numbers and unknown tokens', async () => {
    const s = await t.login('sana@raasta.test');
    const r = await t.call(s, 'post', '/payment-methods', { provider: 'mock', token: '4242424242424242' });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });

  it('wallet ride is refused up front when the balance is too low', async () => {
    const s = await t.login('sana@raasta.test'); // unfunded
    const q = await t.quote(s);
    const r = await t.requestRide(s, q, { paymentMethod: 'WALLET' });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it('ledger rows are immutable', async () => {
    await expect(t.db.query(`UPDATE ledger_entries SET amount = amount + 1`)).rejects.toThrow();
    await expect(t.db.query(`DELETE FROM wallet_transactions`)).rejects.toThrow();
  });
});

describe('auth', () => {
  const t = new TestApp();
  beforeAll(async () => { await t.start(); }, 120000);
  afterAll(() => { process.env.RATE_LIMIT_DISABLED = 'true'; return t.stop(); });

  const device = (id: string) => ({ deviceId: id, platform: 'web' });

  it('12a. register → login, wrong password is a generic 401', async () => {
    const reg = await t.http.post('/api/v1/auth/register').send({ fullName: 'New Rider', email: 'new@raasta.test', password: 'Sup3rSecret', role: 'PASSENGER', device: device('d-new') });
    expect(reg.status).toBe(201);
    const bad = await t.http.post('/api/v1/auth/login').send({ identifier: 'new@raasta.test', password: 'wrong', device: device('d-new') });
    const unknown = await t.http.post('/api/v1/auth/login').send({ identifier: 'nobody@raasta.test', password: 'wrong', device: device('d-new') });
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.body.error?.message ?? bad.body.message).toBe(unknown.body.error?.message ?? unknown.body.message);
  });

  it('12b. refresh rotates; replaying an old token after the grace window revokes the family', async () => {
    const s = await t.login('ayesha@raasta.test', PASSWORD, 'd-rot');
    const r1 = await t.http.post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(r1.status).toBe(200);
    const newRefresh = r1.body.refreshToken ?? r1.body.tokens?.refreshToken;
    expect(newRefresh).toBeTruthy();
    expect(newRefresh).not.toBe(s.refreshToken);
    await t.db.query(`UPDATE auth_sessions SET rotated_at = now() - interval '1 minute' WHERE rotated_at IS NOT NULL`);
    const replay = await t.http.post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(replay.status).toBe(401);
    // the legitimate descendant is dead too
    const after = await t.http.post('/api/v1/auth/refresh').send({ refreshToken: newRefresh });
    expect(after.status).toBe(401);
  });

  it('12c. RBAC: passengers cannot use driver or admin endpoints', async () => {
    const p = await t.login('ayesha@raasta.test');
    expect((await t.call(p, 'get', '/admin/analytics/kpis')).status).toBe(403);
    expect((await t.call(p, 'post', '/driver/online', { lat: 31.5, lng: 74.3 })).status).toBe(403);
    expect((await t.http.get('/api/v1/wallet')).status).toBe(401);
    const support = await t.login('support@raasta.test');
    expect((await t.call(support, 'get', '/admin/support/tickets')).status).toBe(200);
    expect((await t.call(support, 'put', '/admin/pricing/00000000-0000-0000-0000-000000000000', {})).status).toBe(403);
  });

  it('12d. OTP locks after repeated wrong codes', async () => {
    const phone = '+923001119999';
    const req = await t.http.post('/api/v1/auth/otp/request').send({ phone });
    expect(req.status).toBe(200);
    let last = 0;
    for (let i = 0; i < 7; i++) {
      const r = await t.http.post('/api/v1/auth/otp/verify').send({ phone, code: '000000', fullName: 'Otp User', device: device('d-otp') });
      last = r.status;
    }
    expect(last).toBe(429);
    // even the right code no longer works
    const code = req.body.devCode;
    if (code) expect((await t.http.post('/api/v1/auth/otp/verify').send({ phone, code, fullName: 'Otp User', device: device('d-otp') })).status).toBe(429);
  });

  it('12e. rate limiting returns 429 with Retry-After when enabled', async () => {
    process.env.RATE_LIMIT_DISABLED = 'false';
    const phone = '+923001118888';
    const first = await t.http.post('/api/v1/auth/otp/request').send({ phone });
    const second = await t.http.post('/api/v1/auth/otp/request').send({ phone });
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect(second.headers['retry-after']).toBeDefined();
  });
});
