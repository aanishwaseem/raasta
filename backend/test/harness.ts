import './env';
import { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'net';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { createApp } from '../src/main';
import { migrate } from '../src/database/migrate';
import { seed } from '../src/database/seed/seed';
import { config } from '../src/config/config';
import { QueueService } from '../src/common/queue/queue.service';
import { RedisService } from '../src/common/redis/redis.service';
import { DatabaseService } from '../src/common/db/database.service';

export const PASSWORD = 'Passw0rd!test';
export const LIBERTY = { lat: 31.5102, lng: 74.3441, address: 'Liberty Market, Gulberg III, Lahore' };
export const EMPORIUM = { lat: 31.4672, lng: 74.2651, address: 'Emporium Mall, Johar Town, Lahore' };
export const JOHAR = { lat: 31.4697, lng: 74.2728, address: 'Johar Town, Lahore' };
// the DB and Redis are reset once per test file; reference data and TEST accounts come from the seed
export const DRIVERS = {
  usman: { email: 'usman@raasta.test', at: { lat: 31.5105, lng: 74.3432 } },
  hamza: { email: 'hamza@raasta.test', at: { lat: 31.5002, lng: 74.3501 } },
  farah: { email: 'farah@raasta.test', at: { lat: 31.4812, lng: 74.3301 } },
  kamran: { email: 'kamran@raasta.test', at: { lat: 31.4712, lng: 74.279 } },
  imran: { email: 'imran@raasta.test', at: { lat: 31.5201, lng: 74.3602 } },
  adeel: { email: 'adeel@raasta.test', at: { lat: 31.515, lng: 74.34 } },
} as const;

export interface Session {
  token: string;
  refreshToken: string;
  userId: string;
  roles: string[];
}

export class TestApp {
  app!: INestApplication;
  baseUrl!: string;
  private sockets: Socket[] = [];
  private counter = 0;

  async start(opts: { resetDb?: boolean; env?: Record<string, string> } = {}) {
    Object.assign(process.env, opts.env ?? {});
    if (opts.resetDb !== false) {
      await migrate(config().DATABASE_URL, { reset: true, quiet: true });
      await seed(config().DATABASE_URL, { quiet: true });
    }
    const redis = new (await import('ioredis')).default(config().REDIS_URL);
    await redis.flushdb();
    redis.disconnect();
    this.app = await createApp();
    await this.app.init();
    await this.app.listen(0);
    await this.app.get(QueueService).startWorkers();
    this.baseUrl = `http://127.0.0.1:${(this.app.getHttpServer().address() as AddressInfo).port}`;
    return this;
  }

  async stop() {
    this.sockets.forEach((s) => s.close());
    await this.app.close();
  }

  get http() {
    return request(this.app.getHttpServer());
  }
  get<T>(token: new (...a: never[]) => T): T {
    return this.app.get(token);
  }
  get db() {
    return this.app.get(DatabaseService);
  }
  get redis() {
    return this.app.get(RedisService);
  }

  nextKey(prefix = 'k') {
    return `${prefix}-${Date.now()}-${++this.counter}`;
  }

  async login(email: string, password = PASSWORD, deviceId = `dev-${email}`): Promise<Session> {
    const res = await this.http.post('/api/v1/auth/login').send({ identifier: email, password, device: { deviceId, platform: 'web' } });
    if (res.status !== 200 && res.status !== 201) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
    const t = res.body.tokens;
    return { token: t.accessToken, refreshToken: t.refreshToken, userId: res.body.user.id, roles: res.body.user.roles };
  }

  auth(s: Session) {
    return { Authorization: `Bearer ${s.token}` };
  }

  call(s: Session, method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, body?: unknown, headers: Record<string, string> = {}) {
    const r = this.http[method](`/api/v1${path}`).set(this.auth(s));
    for (const [k, v] of Object.entries(headers)) r.set(k, v);
    return body === undefined ? r : r.send(body as object);
  }

  async goOnline(s: Session, at: { lat: number; lng: number }) {
    const res = await this.call(s, 'post', '/driver/online', at);
    if (res.status >= 300) throw new Error(`go online failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  async quote(s: Session, pickup = LIBERTY, dropoff = EMPORIUM, extra: Record<string, unknown> = {}) {
    const res = await this.call(s, 'post', '/rides/quotes', { pickup, dropoff, ...extra });
    if (res.status !== 201 && res.status !== 200) throw new Error(`quote failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  async requestRide(s: Session, quote: { id: string }, body: Record<string, unknown> = {}, key = this.nextKey('ride')) {
    return this.call(s, 'post', '/rides', { quoteId: quote.id, productCode: 'ECONOMY', paymentMethod: 'CASH', ...body }, { 'Idempotency-Key': key });
  }

  socket(s: Session): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const sock = io(`${this.baseUrl}/realtime`, { auth: { token: s.token }, transports: ['websocket'], reconnection: false });
      this.sockets.push(sock);
      sock.once('connect', () => resolve(sock));
      sock.once('connect_error', (e) => reject(e));
    });
  }

  /** Resolves with the first matching event payload, or rejects on timeout. Attach BEFORE triggering the action. */
  static waitFor<T = unknown>(sock: Socket, event: string, pred: (p: T) => boolean = () => true, ms = 8000): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        sock.off(event, h);
        reject(new Error(`timeout waiting for ${event}`));
      }, ms);
      const h = (p: T) => {
        if (pred(p)) {
          clearTimeout(t);
          sock.off(event, h);
          resolve(p);
        }
      };
      sock.on(event, h);
    });
  }

  /** Polls until the driver has an offer, returning it. */
  async waitOffer(s: Session, ms = 8000): Promise<{ offerId: string; rideId: string }> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const r = await this.call(s, 'get', '/driver/offers/current');
      if (r.body && r.body.offerId) return r.body;
      await new Promise((r2) => setTimeout(r2, 150));
    }
    throw new Error('no offer arrived');
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
