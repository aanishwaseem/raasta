import { assertProductionSafe, corsOrigins, loadConfig } from './config';

const strong = (c: string) => c.repeat(40).slice(0, 40);
const prodEnv = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  JWT_ACCESS_SECRET: strong('a1'),
  OTP_HMAC_SECRET: strong('b2'),
  METRICS_TOKEN: strong('c3'),
  AI_INTERNAL_TOKEN: strong('d4'),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  DATABASE_URL: 'postgres://raasta:S0me-long-random-pw@db:5432/raasta',
  PAYMENT_PROVIDER: 'stripe',
  STRIPE_SECRET_KEY: 'sk_live_x',
  SMS_PROVIDER: 'http',
  SMS_HTTP_URL: 'https://sms.example.com/send',
  CORS_ORIGINS: 'https://admin.example.com',
  PUBLIC_BASE_URL: 'https://api.example.com',
  TRACKING_BASE_URL: 'https://track.example.com/t',
  ...over,
});

describe('production configuration guard', () => {
  it('accepts a fully configured production environment', () => {
    expect(() => loadConfig(prodEnv())).not.toThrow();
  });

  it('refuses the console SMS provider and an unconfigured gateway in production', () => {
    expect(() => loadConfig(prodEnv({ SMS_PROVIDER: 'console' }))).toThrow(/SMS_PROVIDER=console/);
    expect(() => loadConfig(prodEnv({ SMS_PROVIDER: 'twilio' }))).toThrow(/TWILIO_ACCOUNT_SID/);
    expect(() => loadConfig(prodEnv({ PUSH_PROVIDER: 'fcm' }))).toThrow(/FCM_SERVICE_ACCOUNT_JSON/);
  });

  it.each([
    ['dev JWT secret', { JWT_ACCESS_SECRET: 'dev-only-access-secret-change-me-0123456789' }],
    ['dev OTP secret', { OTP_HMAC_SECRET: 'dev-only-otp-secret-change-me-0123456789abc' }],
    ['default metrics token', { METRICS_TOKEN: 'dev-only-metrics-token' }],
    ['default AI token', { AI_INTERNAL_TOKEN: 'dev-only-ai-internal-token' }],
    ['dev encryption key', { DATA_ENCRYPTION_KEY: 'ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzJieXRlcyE=' }],
    ['OTP echo', { OTP_DEV_ECHO: 'true' }],
    ['mock payments', { PAYMENT_PROVIDER: 'mock' }],
    ['stripe without key', { STRIPE_SECRET_KEY: '' }],
    ['dev DB password', { DATABASE_URL: 'postgres://raasta:raasta_dev_password@db:5432/raasta' }],
    ['wildcard CORS', { CORS_ORIGINS: '*' }],
    ['localhost CORS', { CORS_ORIGINS: 'https://admin.example.com,http://localhost:5173' }],
    ['plain-http CORS', { CORS_ORIGINS: 'http://admin.example.com' }],
    ['http public url', { PUBLIC_BASE_URL: 'http://api.example.com' }],
    ['shared secrets', { OTP_HMAC_SECRET: strong('a1') }],
  ])('refuses to boot with %s', (_name, over) => {
    expect(() => loadConfig(prodEnv(over))).toThrow(/Refusing to start in production/);
  });

  it('rejects secrets shorter than 32 characters in every environment', () => {
    expect(() => loadConfig({ NODE_ENV: 'development', JWT_ACCESS_SECRET: 'short' })).toThrow(/at least 32/);
    expect(() => loadConfig({ NODE_ENV: 'test', OTP_HMAC_SECRET: 'short' })).toThrow(/at least 32/);
  });

  it('bounds token lifetimes', () => {
    expect(() => loadConfig({ JWT_ACCESS_TTL_SECONDS: '86400' })).toThrow();
    expect(loadConfig({}).JWT_ACCESS_TTL_SECONDS).toBe(900);
  });

  it('assertProductionSafe is exported for reuse', () => {
    expect(() => assertProductionSafe(loadConfig({}))).toThrow();
  });
});

describe('corsOrigins', () => {
  it('splits and trims the allowlist', () => {
    expect(corsOrigins({ CORS_ORIGINS: 'https://a.test, https://b.test' })).toEqual(['https://a.test', 'https://b.test']);
  });
  it('never allows a wildcard together with credentials', () => {
    expect(() => corsOrigins({ CORS_ORIGINS: '*' })).toThrow(/must not contain/);
  });
});
