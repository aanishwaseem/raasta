import { TestApp, Session } from './harness';
import { listRoutes, RouteInfo } from './route-inventory';

/**
 * Route-level authorisation policy. EVERY HTTP route must make an explicit auth decision:
 *   - public (@Public)                         -> must be in PUBLIC_ROUTES below
 *   - role-gated (@Roles)                      -> enforced by the guards, verified dynamically here
 *   - any signed-in user (no @Roles)           -> must be in AUTHENTICATED_ONLY below, and its handler/service must scope
 *                                                 every object to the caller (the IDOR tests in security-authz cover these)
 * Adding a controller method without an entry fails this test, which is the point: a reviewer has to look at it.
 */
const PUBLIC_ROUTES = [
  'GET /api/v1/cities',
  'GET /api/v1/geo/service-check',
  'GET /api/v1/public/track/:token', // unguessable 192-bit token, expiring, minimal payload
  'GET /api/v1/public/deliveries/:code', // 8-char code sent by SMS to the recipient; throttled per IP, no-store
  'GET /health',
  'GET /health/ready',
  'GET /metrics', // public route but checks METRICS_TOKEN itself (see security-http)
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/oauth',
  'POST /api/v1/auth/otp/request',
  'POST /api/v1/auth/otp/verify',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/register',
];

const AUTHENTICATED_ONLY = [
  // push device tokens: every statement is scoped to the caller's user id
  'POST /api/v1/me/devices', 'DELETE /api/v1/me/devices',
  // session / account of the caller
  'DELETE /api/v1/auth/sessions/:id', 'GET /api/v1/auth/sessions', 'POST /api/v1/auth/logout', 'POST /api/v1/auth/logout-all',
  'DELETE /api/v1/me', 'GET /api/v1/me', 'PATCH /api/v1/me', 'GET /api/v1/me/export',
  'GET /api/v1/me/consents', 'POST /api/v1/me/consents', 'GET /api/v1/me/preferences', 'PATCH /api/v1/me/preferences',
  // avatar: owner, staff or ride counterpart only (service checks)
  'GET /api/v1/me/avatar/:userId', 'POST /api/v1/me/avatar',
  // caller's own saved data (every query filters on user_id)
  'DELETE /api/v1/me/emergency-contacts/:id', 'GET /api/v1/me/emergency-contacts', 'PATCH /api/v1/me/emergency-contacts/:id', 'POST /api/v1/me/emergency-contacts',
  'DELETE /api/v1/me/places/:id', 'GET /api/v1/me/places', 'PATCH /api/v1/me/places/:id', 'POST /api/v1/me/places',
  'GET /api/v1/me/notifications', 'POST /api/v1/me/notifications/:id/read', 'POST /api/v1/me/notifications/read-all',
  'DELETE /api/v1/payment-methods/:id', 'GET /api/v1/payment-methods', 'POST /api/v1/payment-methods',
  'GET /api/v1/support/tickets', 'GET /api/v1/support/tickets/:id', 'POST /api/v1/support/tickets', 'POST /api/v1/support/tickets/:id/messages',
  // rides: participant (passenger/driver) or staff, checked in RideViewService / the service methods
  'GET /api/v1/rides', 'GET /api/v1/rides/:id', 'GET /api/v1/rides/:id/events', 'GET /api/v1/rides/:id/receipt',
  'POST /api/v1/rides/:id/pay-cash', 'POST /api/v1/rides/:id/rating', 'POST /api/v1/rides/:id/share', 'POST /api/v1/rides/:id/sos',
  'POST /api/v1/safety/events/:id/respond',
  // reference data
  'GET /api/v1/intercity/routes', 'GET /api/v1/intercity/trips', 'GET /api/v1/places/reverse', 'GET /api/v1/places/search',
];

describe('route authorisation inventory', () => {
  const t = new TestApp();
  let routes: RouteInfo[];
  const tokens: Record<string, Session> = {};
  const UUID = '00000000-0000-4000-8000-000000000001';

  beforeAll(async () => {
    await t.start();
    routes = listRoutes(t.app);
    tokens.passenger = await t.login('bilal@raasta.test');
    tokens.driver = await t.login('usman@raasta.test');
    tokens.admin = await t.login('admin@raasta.test');
    tokens.support = await t.login('support@raasta.test');
    tokens.corp = await t.login('corpadmin@raasta.test');
  }, 120000);
  afterAll(() => t.stop());

  const concrete = (path: string) => path.replace(/:token/g, 'A'.repeat(32)).replace(/:[A-Za-z]+/g, UUID);
  const fire = (r: RouteInfo, headers: Record<string, string> = {}) => {
    const req = (t.http as unknown as Record<string, (p: string) => import('supertest').Test>)[r.method.toLowerCase()](concrete(r.path));
    for (const [k, v] of Object.entries(headers)) req.set(k, v);
    return ['GET', 'DELETE'].includes(r.method) ? req : req.send({});
  };

  it('discovers a plausible number of routes', () => {
    expect(routes.length).toBeGreaterThan(150);
  });

  it('every route has an explicit auth decision', () => {
    const undecided = routes.filter((r) => !r.isPublic && r.roles.length === 0 && !AUTHENTICATED_ONLY.includes(r.key)).map((r) => r.key);
    expect(undecided).toEqual([]);
    const unexpectedPublic = routes.filter((r) => r.isPublic && !PUBLIC_ROUTES.includes(r.key)).map((r) => r.key);
    expect(unexpectedPublic).toEqual([]);
  });

  it('the allowlists contain no stale or contradictory entries', () => {
    const byKey = new Map(routes.map((r) => [r.key, r]));
    expect(PUBLIC_ROUTES.filter((k) => !byKey.get(k)?.isPublic)).toEqual([]);
    expect(AUTHENTICATED_ONLY.filter((k) => !byKey.has(k) || byKey.get(k)!.isPublic || byKey.get(k)!.roles.length > 0)).toEqual([]);
  });

  it('every admin route is staff-only and admin-only unless explicitly read-only for support', () => {
    const admin = routes.filter((r) => r.path.startsWith('/api/v1/admin'));
    expect(admin.length).toBeGreaterThan(40);
    for (const r of admin) {
      expect(r.isPublic).toBe(false);
      expect(r.roles.length).toBeGreaterThan(0);
      expect(r.roles.every((x) => x === 'ADMIN' || x === 'SUPPORT')).toBe(true);
      // SUPPORT may only be granted on GET reads and ticket / safety handling, never on money, pricing, geography or AI routes
      if (r.roles.includes('SUPPORT') && r.method !== 'GET') {
        expect(r.path).toMatch(/\/admin\/(support\/tickets|safety\/events)/);
      }
      if (/\/admin\/(payments|wallets|withdrawals|pricing|promotions|ai|cities|zones|service-areas|corporate-accounts|fraud|audit-logs|system|analytics|demand|overview)/.test(r.path)) {
        expect(r.roles).toEqual(['ADMIN']);
      }
    }
  });

  it('role-gated routes: driver/corporate/admin areas are closed to the other roles', () => {
    for (const r of routes.filter((x) => x.path.startsWith('/api/v1/driver')) ) expect(r.roles).toContain('DRIVER');
    for (const r of routes.filter((x) => x.path.startsWith('/api/v1/corporate'))) expect(r.roles).toContain('CORPORATE_ADMIN');
    for (const r of routes.filter((x) => x.path.startsWith('/api/v1/wallet'))) expect(r.roles.length).toBeGreaterThan(0);
  });

  it('no non-public route answers without a valid access token (401)', async () => {
    const failures: string[] = [];
    for (const r of routes.filter((x) => !x.isPublic)) {
      const res = await fire(r);
      if (res.status !== 401) failures.push(`${r.key} -> ${res.status}`);
      const bogus = await fire(r, { Authorization: 'Bearer not.a.jwt' });
      if (bogus.status !== 401) failures.push(`${r.key} (bogus token) -> ${bogus.status}`);
    }
    expect(failures).toEqual([]);
  });

  it('role-gated routes return 403 to a signed-in user without the role', async () => {
    const failures: string[] = [];
    for (const r of routes.filter((x) => !x.isPublic && x.roles.length)) {
      const outsider = Object.values(tokens).find((s) => !r.roles.some((role) => s.roles.includes(role)));
      expect(outsider).toBeDefined();
      const res = await fire(r, t.auth(outsider!));
      if (res.status !== 403) failures.push(`${r.key} as [${outsider!.roles}] -> ${res.status}`);
    }
    expect(failures).toEqual([]);
  });
});
