import { SignJWT } from 'jose';
import { config } from '../src/config/config';
import { PASSWORD, TestApp } from './harness';

const dev = (id: string) => ({ deviceId: `dev-${id}`, platform: 'web' });
const enc = (s: string) => new TextEncoder().encode(s);
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('authentication hardening', () => {
  const t = new TestApp();
  beforeAll(async () => {
    await t.start();
  }, 120000);
  afterAll(() => {
    process.env.RATE_LIMIT_DISABLED = 'true';
    return t.stop();
  });

  describe('credentials & lockout', () => {
    it('stores argon2id hashes and never returns them', async () => {
      const reg = await t.http.post('/api/v1/auth/register').send({ fullName: 'Hash Check', email: 'hash@raasta.test', password: 'Sup3rSecret', role: 'PASSENGER', device: dev('d-hash') });
      expect(reg.status).toBe(201);
      expect(JSON.stringify(reg.body)).not.toMatch(/password|\$argon2/i);
      const row = await t.db.one<{ password_hash: string }>(`SELECT password_hash FROM users WHERE email = 'hash@raasta.test'`);
      expect(row!.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,(t=2,p=1|p=1,t=2)\$/);
    });

    it('locks an account after repeated failures from any source, even for the right password, without revealing existence', async () => {
      const victim = 'ayesha@raasta.test';
      for (let i = 0; i < 10; i++) {
        const r = await t.http.post('/api/v1/auth/login').send({ identifier: victim, password: `wrong-${i}`, device: dev('attacker') });
        expect(r.status).toBe(401);
      }
      const locked = await t.http.post('/api/v1/auth/login').send({ identifier: victim, password: PASSWORD, device: dev('attacker') });
      expect(locked.status).toBe(429);
      expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
      // the same thing happens for an identifier that does not exist: no enumeration oracle
      for (let i = 0; i < 10; i++) await t.http.post('/api/v1/auth/login').send({ identifier: 'ghost@raasta.test', password: 'x'.repeat(10), device: dev('attacker') });
      const ghost = await t.http.post('/api/v1/auth/login').send({ identifier: 'ghost@raasta.test', password: 'x'.repeat(10), device: dev('attacker') });
      expect(ghost.status).toBe(429);
      expect(ghost.body.error.code).toBe(locked.body.error.code);
      expect(ghost.body.error.message).toBe(locked.body.error.message);
      // other accounts are unaffected
      expect((await t.http.post('/api/v1/auth/login').send({ identifier: 'bilal@raasta.test', password: PASSWORD, device: dev('ok') })).status).toBe(200);
    });

    it('the lockout counter is keyed by canonical identifier (case / formatting variants do not dodge it)', async () => {
      const phone = '+923001110003'; // sana
      for (let i = 0; i < 5; i++) await t.http.post('/api/v1/auth/login').send({ identifier: '0300 1110003', password: 'bad-password-1', device: dev('x') });
      for (let i = 0; i < 5; i++) await t.http.post('/api/v1/auth/login').send({ identifier: phone, password: 'bad-password-1', device: dev('x') });
      const r = await t.http.post('/api/v1/auth/login').send({ identifier: '03001110003', password: PASSWORD, device: dev('x') });
      expect(r.status).toBe(429);
    });

    it('a successful login resets the failure counter', async () => {
      const id = 'sana2@raasta.test';
      await t.http.post('/api/v1/auth/register').send({ fullName: 'Reset Check', email: id, password: 'Sup3rSecret', role: 'PASSENGER', device: dev('d-r') });
      for (let i = 0; i < 6; i++) await t.http.post('/api/v1/auth/login').send({ identifier: id, password: 'nope-nope-1', device: dev('x') });
      expect((await t.http.post('/api/v1/auth/login').send({ identifier: id, password: 'Sup3rSecret', device: dev('x') })).status).toBe(200);
      for (let i = 0; i < 6; i++) await t.http.post('/api/v1/auth/login').send({ identifier: id, password: 'nope-nope-1', device: dev('x') });
      expect((await t.http.post('/api/v1/auth/login').send({ identifier: id, password: 'Sup3rSecret', device: dev('x') })).status).toBe(200);
    });

    it('per-IP limits apply on top (login-ip 20/5min) and answer 429 with Retry-After', async () => {
      process.env.RATE_LIMIT_DISABLED = 'false';
      let last = 0;
      let retryAfter: string | undefined;
      for (let i = 0; i < 25; i++) {
        const r = await t.http.post('/api/v1/auth/login').send({ identifier: `spray${i}@raasta.test`, password: 'whatever-1', device: dev('spray') });
        last = r.status;
        retryAfter = r.headers['retry-after'] ?? retryAfter;
      }
      process.env.RATE_LIMIT_DISABLED = 'true';
      expect(last).toBe(429);
      expect(retryAfter).toBeDefined();
    });
  });

  describe('role escalation & mass assignment', () => {
    it.each(['ADMIN', 'SUPPORT', 'CORPORATE_ADMIN', 'admin', ''])('register as %p is refused', async (role) => {
      const r = await t.http.post('/api/v1/auth/register').send({ fullName: 'Evil', email: `evil-${role || 'empty'}@x.test`, password: 'Sup3rSecret', role, device: dev('e') });
      expect(r.status).toBe(400);
      expect(await t.db.one(`SELECT 1 FROM users WHERE email = $1`, [`evil-${role || 'empty'}@x.test`])).toBeNull();
    });

    it('unknown fields such as roles / status / isAdmin are rejected rather than ignored', async () => {
      for (const extra of [{ roles: ['ADMIN'] }, { isAdmin: true }, { status: 'ACTIVE' }, { emailVerified: true }]) {
        const r = await t.http.post('/api/v1/auth/register').send({ fullName: 'Evil', email: 'mass@x.test', password: 'Sup3rSecret', role: 'PASSENGER', device: dev('e'), ...extra });
        expect(r.status).toBe(400);
      }
      const s = await t.login('bilal@raasta.test');
      for (const extra of [{ roles: ['ADMIN'] }, { status: 'ACTIVE' }, { password_hash: 'x' }, { phone: '+923009999999' }, { emailVerified: true }]) {
        expect((await t.call(s, 'patch', '/me', { fullName: 'Bilal Ahmed', ...extra })).status).toBe(400);
      }
    });

    it('OTP and OAuth sign-up cannot pick a privileged role', async () => {
      const phone = '+923005550001';
      const req = await t.http.post('/api/v1/auth/otp/request').send({ phone });
      for (const role of ['ADMIN', 'SUPPORT']) {
        const r = await t.http.post('/api/v1/auth/otp/verify').send({ phone, code: req.body.devCode, fullName: 'Evil', role, device: dev('o') });
        expect(r.status).toBe(400);
      }
      expect((await t.http.post('/api/v1/auth/oauth').send({ provider: 'GOOGLE', idToken: 'x', role: 'ADMIN', device: dev('o') })).status).toBe(400);
    });

    it('nobody holds a privileged role except the seeded staff', async () => {
      const rows = await t.db.query<{ email: string }>(`SELECT u.email FROM user_roles r JOIN users u ON u.id = r.user_id WHERE r.role IN ('ADMIN','SUPPORT')`);
      expect(rows.map((r) => r.email).sort()).toEqual(['admin@raasta.test', 'support@raasta.test']);
    });
  });

  describe('one-time codes', () => {
    it('are single use even under parallel redemption', async () => {
      const phone = '+923005550002';
      const { body } = await t.http.post('/api/v1/auth/otp/request').send({ phone });
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => t.http.post('/api/v1/auth/otp/verify').send({ phone, code: body.devCode, fullName: 'Race User', device: dev(`race-${i}`) })),
      );
      expect(results.filter((r) => r.status === 200).length).toBe(1);
      expect(await t.db.query(`SELECT 1 FROM users WHERE phone = $1`, [phone])).toHaveLength(1);
      expect((await t.http.post('/api/v1/auth/otp/verify').send({ phone, code: body.devCode, fullName: 'Race User', device: dev('again') })).status).toBe(400);
    });

    it('allow at most 5 guesses per code even when guesses are parallel, and a new code invalidates the old one', async () => {
      const phone = '+923005550003';
      const first = await t.http.post('/api/v1/auth/otp/request').send({ phone });
      const wrong = first.body.devCode === '000000' ? '111111' : '000000';
      const guesses = await Promise.all(Array.from({ length: 20 }, () => t.http.post('/api/v1/auth/otp/verify').send({ phone, code: wrong, fullName: 'Guess', device: dev('g') })));
      expect(guesses.filter((r) => r.status === 400).length).toBe(5);
      expect(guesses.filter((r) => r.status === 429).length).toBe(15);
      const attempts = await t.db.one<{ attempts: number }>(`SELECT attempts FROM otp_codes WHERE phone = $1 ORDER BY created_at DESC LIMIT 1`, [phone]);
      expect(attempts!.attempts).toBe(5);

      const second = await t.http.post('/api/v1/auth/otp/request').send({ phone });
      const stale = await t.http.post('/api/v1/auth/otp/verify').send({ phone, code: first.body.devCode, fullName: 'Guess', device: dev('g') });
      expect(stale.status).toBe(400); // the first code is dead
      expect((await t.http.post('/api/v1/auth/otp/verify').send({ phone, code: second.body.devCode, fullName: 'Guess', device: dev('g') })).status).toBe(200);
    });

    it('expire after 5 minutes', async () => {
      const phone = '+923005550004';
      const { body } = await t.http.post('/api/v1/auth/otp/request').send({ phone });
      await t.db.query(`UPDATE otp_codes SET expires_at = now() - interval '1 second' WHERE phone = $1`, [phone]);
      const r = await t.http.post('/api/v1/auth/otp/verify').send({ phone, code: body.devCode, fullName: 'Late', device: dev('l') });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('OTP_EXPIRED');
    });

    it('are stored only as keyed hashes and rate limits are shared across phone formats', async () => {
      const row = await t.db.one<{ code_hash: string }>(`SELECT code_hash FROM otp_codes LIMIT 1`);
      expect(row!.code_hash).toMatch(/^[0-9a-f]{64}$/);
      process.env.RATE_LIMIT_DISABLED = 'false';
      const a = await t.http.post('/api/v1/auth/otp/request').send({ phone: '0300 5550005' });
      const b = await t.http.post('/api/v1/auth/otp/request').send({ phone: '+923005550005' });
      process.env.RATE_LIMIT_DISABLED = 'true';
      expect(a.status).toBe(200);
      expect(b.status).toBe(429);
    });
  });

  describe('JWT handling', () => {
    const claims = async (over: Record<string, unknown> = {}, secret = config().JWT_ACCESS_SECRET, alg = 'HS256', ttl = '15m') => {
      const s = await t.login('bilal@raasta.test');
      const payload = JSON.parse(Buffer.from(s.token.split('.')[1], 'base64url').toString());
      return new SignJWT({ roles: payload.roles, sid: payload.sid, ...over })
        .setProtectedHeader({ alg })
        .setSubject(payload.sub)
        .setIssuer('raasta-api')
        .setAudience('raasta-clients')
        .setIssuedAt()
        .setExpirationTime(ttl)
        .sign(enc(secret));
    };
    const me = (token: string) => t.http.get('/api/v1/me').set('Authorization', `Bearer ${token}`);

    it('accepts a correctly signed token (control)', async () => {
      expect((await me(await claims())).status).toBe(200);
    });
    it('rejects alg=none, wrong secret, wrong algorithm, wrong audience/issuer and expired tokens', async () => {
      const good = (await claims()).split('.');
      const noneToken = `${b64({ alg: 'none', typ: 'JWT' })}.${good[1]}.`;
      expect((await me(noneToken)).status).toBe(401);
      expect((await me(await claims({}, 'a-completely-different-secret-of-32-chars!!'))).status).toBe(401);
      expect((await me(await claims({}, config().JWT_ACCESS_SECRET, 'HS512'))).status).toBe(401);
      const tampered = `${good[0]}.${b64({ ...JSON.parse(Buffer.from(good[1], 'base64url').toString()), roles: ['ADMIN'] })}.${good[2]}`;
      expect((await me(tampered)).status).toBe(401);
      const s = await t.login('bilal@raasta.test');
      const payload = JSON.parse(Buffer.from(s.token.split('.')[1], 'base64url').toString());
      const wrongAud = await new SignJWT({ roles: payload.roles, sid: payload.sid }).setProtectedHeader({ alg: 'HS256' }).setSubject(payload.sub).setIssuer('raasta-api').setAudience('someone-else').setExpirationTime('15m').sign(enc(config().JWT_ACCESS_SECRET));
      expect((await me(wrongAud)).status).toBe(401);
      const expired = await new SignJWT({ roles: payload.roles, sid: payload.sid }).setProtectedHeader({ alg: 'HS256' }).setSubject(payload.sub).setIssuer('raasta-api').setAudience('raasta-clients').setIssuedAt(Math.floor(Date.now() / 1000) - 3600).setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(enc(config().JWT_ACCESS_SECRET));
      const r = await me(expired);
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('TOKEN_EXPIRED');
    });
    it('access tokens are short-lived', async () => {
      const s = await t.login('bilal@raasta.test');
      const p = JSON.parse(Buffer.from(s.token.split('.')[1], 'base64url').toString());
      expect(p.exp - p.iat).toBeLessThanOrEqual(3600);
      expect(p.exp - p.iat).toBe(config().JWT_ACCESS_TTL_SECONDS);
    });
  });

  describe('sessions', () => {
    it('logout kills the access token immediately and the refresh token', async () => {
      const s = await t.login('hamza@raasta.test', PASSWORD, 'dev-lo');
      expect((await t.call(s, 'get', '/me')).status).toBe(200);
      expect((await t.call(s, 'post', '/auth/logout')).status).toBe(204);
      expect((await t.call(s, 'get', '/me')).status).toBe(401);
      expect((await t.http.post('/api/v1/auth/refresh').send({ refreshToken: s.refreshToken })).status).toBe(401);
    });

    it('logout-all signs out every device', async () => {
      const a = await t.login('farah@raasta.test', PASSWORD, 'dev-phone');
      const b = await t.login('farah@raasta.test', PASSWORD, 'dev-tablet');
      expect((await t.call(a, 'post', '/auth/logout-all')).status).toBe(204);
      expect((await t.call(a, 'get', '/me')).status).toBe(401);
      expect((await t.call(b, 'get', '/me')).status).toBe(401);
      expect((await t.http.post('/api/v1/auth/refresh').send({ refreshToken: b.refreshToken })).status).toBe(401);
    });

    it('a user can list but only revoke their own sessions', async () => {
      const a = await t.login('kamran@raasta.test', PASSWORD, 'dev-k1');
      const other = await t.login('imran@raasta.test', PASSWORD, 'dev-i1');
      const mine = await t.call(a, 'get', '/auth/sessions');
      expect(mine.body.length).toBeGreaterThan(0);
      const theirs = await t.call(other, 'get', '/auth/sessions');
      expect((await t.call(a, 'delete', `/auth/sessions/${theirs.body[0].id}`)).status).toBe(404);
      expect((await t.call(other, 'get', '/me')).status).toBe(200);
    });

    it('bounds live sessions per account (oldest are evicted)', async () => {
      let first: Awaited<ReturnType<typeof t.login>> | undefined;
      for (let i = 0; i < 12; i++) {
        const s = await t.login('adeel@raasta.test', PASSWORD, `dev-adeel-${i}`);
        first ??= s;
      }
      const live = await t.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE u.email = 'adeel@raasta.test' AND s.revoked_at IS NULL`);
      expect(live!.n).toBeLessThanOrEqual(10);
      expect((await t.call(first!, 'get', '/me')).status).toBe(401);
    });

    it('suspending a user kills their live tokens at once', async () => {
      const victim = await t.login('sana@raasta.test', PASSWORD, 'dev-s');
      const admin = await t.login('admin@raasta.test');
      expect((await t.call(admin, 'post', `/admin/users/${victim.userId}/suspend`, { reason: 'security test' })).status).toBe(201);
      expect((await t.call(victim, 'get', '/me')).status).toBe(401);
      expect((await t.http.post('/api/v1/auth/login').send({ identifier: 'sana@raasta.test', password: PASSWORD, device: dev('d-s') })).status).toBe(403);
      expect((await t.http.post('/api/v1/auth/refresh').send({ refreshToken: victim.refreshToken })).status).toBe(401);
    });
  });
});
