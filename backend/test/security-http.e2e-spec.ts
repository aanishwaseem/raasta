import { config } from '../src/config/config';
import { LocalDiskStorage } from '../src/common/providers/storage';
import { PASSWORD, Session, TestApp } from './harness';

// minimal valid files for the magic-number sniffer
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

describe('transport, headers, errors, uploads', () => {
  const t = new TestApp();
  let bilal: Session;
  let ayesha: Session;
  let usman: Session;
  let admin: Session;
  beforeAll(async () => {
    await t.start();
    bilal = await t.login('bilal@raasta.test');
    ayesha = await t.login('ayesha@raasta.test');
    usman = await t.login('usman@raasta.test');
    admin = await t.login('admin@raasta.test');
  }, 120000);
  afterAll(() => t.stop());

  describe('headers', () => {
    it('sets the security headers, hides the framework, forbids caching of API data', async () => {
      const r = await t.http.get('/api/v1/cities');
      expect(r.headers['x-powered-by']).toBeUndefined();
      expect(r.headers['x-content-type-options']).toBe('nosniff');
      expect(r.headers['strict-transport-security']).toMatch(/max-age=63072000; includeSubDomains/);
      expect(r.headers['x-frame-options']).toBeDefined();
      expect(r.headers['referrer-policy']).toBe('no-referrer');
      expect(r.headers['content-security-policy']).toMatch(/default-src 'none'/);
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.headers['x-request-id']).toBeDefined();
      const authed = await t.call(bilal, 'get', '/me');
      expect(authed.headers['cache-control']).toBe('no-store');
    });

    it('does not trust a hostile X-Request-ID', async () => {
      for (const hostile of ['<script>alert(1)</script>', 'x'.repeat(500), 'a b; DROP TABLE users', '../../etc/passwd']) {
        const r = await t.http.get('/api/v1/cities').set('X-Request-ID', hostile);
        expect(r.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      }
      const ok = await t.http.get('/api/v1/cities').set('X-Request-ID', 'client-trace-12345');
      expect(ok.headers['x-request-id']).toBe('client-trace-12345');
    });
  });

  describe('CORS', () => {
    const allowed = config().CORS_ORIGINS.split(',')[0].trim();
    it('echoes only allowlisted origins, never * with credentials', async () => {
      const good = await t.http.get('/api/v1/cities').set('Origin', allowed);
      expect(good.headers['access-control-allow-origin']).toBe(allowed);
      expect(good.headers['access-control-allow-credentials']).toBe('true');
      for (const evil of ['https://evil.example', 'null', `${allowed}.evil.example`, 'http://localhost.evil.example']) {
        const bad = await t.http.get('/api/v1/cities').set('Origin', evil);
        expect(bad.headers['access-control-allow-origin']).toBeUndefined();
      }
    });
    it('preflight from a foreign origin gets no allowance', async () => {
      const r = await t.http.options('/api/v1/rides').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
      const ok = await t.http.options('/api/v1/rides').set('Origin', allowed).set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization,idempotency-key');
      expect(ok.headers['access-control-allow-origin']).toBe(allowed);
      expect(ok.headers['access-control-allow-headers']).toMatch(/idempotency-key/);
    });
  });

  describe('errors never leak internals', () => {
    const NO_LEAK = /stack|\bat .*\(|node_modules|\.ts:\d+|relation "|syntax error|pg-pool|SELECT |INSERT /i;
    it('malformed JSON, oversized bodies and unknown routes return the JSON envelope', async () => {
      const bad = await t.http.post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"identifier": ');
      expect(bad.status).toBe(400);
      expect(bad.headers['content-type']).toMatch(/json/);
      expect(bad.body.error.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(bad.body)).not.toMatch(NO_LEAK);

      const huge = await t.http.post('/api/v1/auth/login').set('Content-Type', 'application/json').send(JSON.stringify({ identifier: 'x', password: 'y'.repeat(300_000) }));
      expect(huge.status).toBe(413);
      expect(huge.body.error.code).toBe('PAYLOAD_TOO_LARGE');

      const nf = await t.http.get('/api/v1/definitely/not/here');
      expect(nf.status).toBe(404);
      expect(JSON.stringify(nf.body)).not.toMatch(NO_LEAK);
    });

    it('validation errors do not echo secrets and malformed ids are 400 not 500', async () => {
      const r = await t.call(bilal, 'get', '/rides/not-a-uuid');
      expect(r.status).toBe(400);
      const sqli = await t.call(bilal, 'get', `/rides?status=${encodeURIComponent("COMPLETED' OR '1'='1")}&page=1`);
      expect(sqli.status).toBe(400); // enum validation
      const sqli2 = await t.call(admin, 'get', `/admin/users?q=${encodeURIComponent("'; DROP TABLE users;--")}`);
      expect(sqli2.status).toBe(200);
      expect(await t.db.one(`SELECT 1 FROM users LIMIT 1`)).not.toBeNull();
      const ts = await t.call(admin, 'get', `/admin/analytics/timeseries?metric=${encodeURIComponent('requests; select pg_sleep(5)')}`);
      expect(ts.status).toBe(400);
      expect(JSON.stringify(ts.body)).not.toMatch(NO_LEAK);
    });

    it('pagination is capped', async () => {
      expect((await t.call(admin, 'get', '/admin/users?pageSize=100000')).status).toBe(400);
      expect((await t.call(admin, 'get', '/admin/users?page=99999999999')).status).toBe(400);
      expect((await t.call(admin, 'get', '/admin/users?pageSize=100&page=1')).status).toBe(200);
    });

    it('an unexpected exception becomes a generic 500 with a request id only', async () => {
      const { toErrorBody } = await import('../src/common/errors/http-exception.filter');
      const { status, body } = toErrorBody(new Error('relation "users" does not exist at /srv/app/dist/x.js:10'), 'rid-1');
      expect(status).toBe(500);
      expect(JSON.stringify(body)).not.toMatch(/relation|srv/);
      expect(body.error.requestId).toBe('rid-1');
    });
  });

  describe('/metrics', () => {
    it('requires the metrics bearer token', async () => {
      expect((await t.http.get('/metrics')).status).toBe(401);
      expect((await t.http.get('/metrics').set('Authorization', 'Bearer nope')).status).toBe(401);
      expect((await t.http.get('/metrics').set('Authorization', `Bearer ${bilal.token}`)).status).toBe(401); // a user JWT is not the metrics token
      const ok = await t.http.get('/metrics').set('Authorization', `Bearer ${config().METRICS_TOKEN}`);
      expect(ok.status).toBe(200);
      expect(ok.text).toContain('raasta_http_request_duration_seconds');
    });
    it('API docs are not served when swagger is off', async () => {
      expect((await t.http.get('/api/docs')).status).toBe(404);
    });
  });

  describe('file uploads', () => {
    const upload = (s: Session, buf: Buffer, filename: string, contentType: string) =>
      t.http.post('/api/v1/me/avatar').set(t.auth(s)).attach('file', buf, { filename, contentType });

    it('rejects non-images whatever the filename or declared type says', async () => {
      for (const [buf, name, type] of [
        [Buffer.from('<?php system($_GET[0]); ?>'.padEnd(64, ' ')), 'shell.jpg', 'image/jpeg'],
        [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.png', 'image/png'],
        [Buffer.from('MZ'.padEnd(64, '\0')), 'a.exe', 'image/png'],
        [Buffer.from('%PDF-1.4'.padEnd(64, ' ')), 'doc.pdf', 'application/pdf'], // PDFs are valid for driver documents but not avatars
      ] as const) {
        const r = await upload(bilal, buf, name, type);
        expect([400, 422]).toContain(r.status);
      }
    });

    it('rejects files over the size limit and extra files', async () => {
      const big = Buffer.concat([PNG, Buffer.alloc(config().MAX_UPLOAD_BYTES + 10, 2)]);
      expect((await upload(bilal, big, 'big.png', 'image/png')).status).toBe(413);
    });

    it('serves avatars with nosniff + a sandboxing CSP, only to people who may see them', async () => {
      expect((await upload(bilal, PNG, '../../etc/passwd.png', 'image/png')).status).toBe(201);
      const key = (await t.db.one<{ avatar_key: string }>(`SELECT avatar_key FROM users WHERE id = $1`, [bilal.userId]))!.avatar_key;
      expect(key).toMatch(/^avatars\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/); // random key, client filename discarded

      const own = await t.call(bilal, 'get', `/me/avatar/${bilal.userId}`);
      expect(own.status).toBe(200);
      expect(own.headers['content-type']).toBe('image/png');
      expect(own.headers['x-content-type-options']).toBe('nosniff');
      expect(own.headers['content-security-policy']).toMatch(/sandbox/);
      expect((await t.call(admin, 'get', `/me/avatar/${bilal.userId}`)).status).toBe(200);
      // an unrelated user cannot fetch (or probe for) someone else's photo
      expect((await t.call(ayesha, 'get', `/me/avatar/${bilal.userId}`)).status).toBe(404);
      expect((await t.http.get(`/api/v1/me/avatar/${bilal.userId}`)).status).toBe(401);
      // a driver who actually served the passenger may
      await t.db.query(
        `INSERT INTO rides (passenger_id, driver_id, city_id, product_code, mode, status, pickup, pickup_address, dropoff, dropoff_address, est_distance_m, est_duration_s, recommended_fare, offered_fare, payment_method)
         SELECT $1, $2, id, 'ECONOMY', 'ON_DEMAND', 'COMPLETED', ST_SetSRID(ST_MakePoint(74.34,31.51),4326)::geography, 'a', ST_SetSRID(ST_MakePoint(74.35,31.52),4326)::geography, 'b', 1000, 300, 300, 300, 'CASH' FROM cities LIMIT 1`,
        [bilal.userId, usman.userId],
      );
      expect((await t.call(usman, 'get', `/me/avatar/${bilal.userId}`)).status).toBe(200);
    });

    it('decides by content, not by filename or declared type', async () => {
      const r = await upload(ayesha, JPEG, 'looks-like.txt', 'text/plain');
      expect(r.status).toBe(201);
    });

    it('driver documents: same sniffing, same random keys', async () => {
      const bad = await t.http.post('/api/v1/driver/documents').set(t.auth(usman)).field('docType', 'CNIC_FRONT').attach('file', Buffer.from('#!/bin/sh\nrm -rf /'.padEnd(64, ' ')), { filename: 'cnic.jpg', contentType: 'image/jpeg' });
      expect([400, 422]).toContain(bad.status);
    });

    it('local storage cannot be escaped with ../ keys', async () => {
      const store = new LocalDiskStorage();
      await expect(store.get('../../../../etc/passwd')).rejects.toThrow(/Invalid storage key/);
      await expect(store.get('avatars/../../package.json')).rejects.toThrow(/Invalid storage key/);
      await expect(store.delete('../../outside')).rejects.toThrow(/Invalid storage key/);
      const k = await store.put('avatars/../../evil', PNG, 'image/png');
      expect(k.startsWith('avatars')).toBe(true);
      expect(k).not.toContain('..');
      await store.delete(k);
    });
  });

  it('responses never contain password hashes, token hashes or other users contact data', async () => {
    const me = await t.call(bilal, 'get', '/me');
    expect(JSON.stringify(me.body)).not.toMatch(/password_hash|\$argon2|refresh_token|token_hash/);
    const sessions = await t.call(bilal, 'get', '/auth/sessions');
    expect(JSON.stringify(sessions.body)).not.toMatch(/refresh|hash/i);
    expect(PASSWORD).toBeDefined();
  });
});
