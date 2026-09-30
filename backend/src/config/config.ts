import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const DEV_SECRET_MARKER = 'dev-only';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  TRACKING_BASE_URL: z.string().default('http://localhost:5173/track'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:8080,http://localhost:8081'),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().default('postgres://raasta:raasta_dev_password@localhost:5432/raasta'),
  DATABASE_POOL_MAX: z.coerce.number().default(20),
  REDIS_URL: z.string().default('redis://localhost:6379/0'),

  JWT_ACCESS_SECRET: z.string().default(`${DEV_SECRET_MARKER}-access-secret-change-me-0123456789`),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TTL_DAYS: z.coerce.number().default(30),
  OTP_HMAC_SECRET: z.string().default(`${DEV_SECRET_MARKER}-otp-secret-change-me-0123456789abc`),
  DATA_ENCRYPTION_KEY: z
    .string()
    .default('ZGV2LW9ubHktZW5jcnlwdGlvbi1rZXktMzJieXRlcyE='), // base64 of 32 bytes, dev only
  OTP_DEV_ECHO: bool,
  METRICS_TOKEN: z.string().default(`${DEV_SECRET_MARKER}-metrics-token`),
  GOOGLE_CLIENT_IDS: z.string().default(''),
  APPLE_CLIENT_IDS: z.string().default(''),

  AI_SERVICE_URL: z.string().default('http://localhost:8000'),
  AI_TIMEOUT_MS: z.coerce.number().default(400),
  AI_INTERNAL_TOKEN: z.string().default(`${DEV_SECRET_MARKER}-ai-internal-token`),

  ROUTING_PROVIDER: z.enum(['haversine', 'osrm']).default('haversine'),
  OSRM_URL: z.string().default('http://localhost:5000'),
  PLACES_PROVIDER: z.enum(['local', 'nominatim']).default('local'),
  NOMINATIM_URL: z.string().default('https://nominatim.openstreetmap.org'),
  PAYMENT_PROVIDER: z.enum(['mock', 'stripe']).default('mock'),
  STRIPE_SECRET_KEY: z.string().default(''),
  SMS_PROVIDER: z.enum(['console']).default('console'),
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_BYTES: z.coerce.number().default(8 * 1024 * 1024),

  RUN_WORKERS_IN_API: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  SWAGGER_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  MATCH_OFFER_TIMEOUT_MS: z.coerce.number().default(15000),
  MATCH_RADII_KM: z.string().default('2,4,7'),
  MATCH_MAX_OFFERS: z.coerce.number().default(8),
  /** Pings implying a faster speed than this are treated as GPS jumps (default 252 km/h). Raise only in simulations. */
  GPS_MAX_PLAUSIBLE_SPEED_MPS: z.coerce.number().default(70),
  DRIVER_PRESENCE_TTL_S: z.coerce.number().default(60),
  ARRIVAL_GEOFENCE_M: z.coerce.number().default(300),
  QUOTE_TTL_S: z.coerce.number().default(300),
  LOCATION_RETENTION_DAYS: z.coerce.number().default(90),
  SETTLEMENT_DELAY_HOURS: z.coerce.number().default(24),
  SCHEDULER_INTERVAL_MS: z.coerce.number().default(30000),
  SAFETY_DEVIATION_M: z.coerce.number().default(500),
  SAFETY_DEVIATION_CONSECUTIVE: z.coerce.number().default(2),
  SAFETY_STOP_SECONDS: z.coerce.number().default(300),
  SAFETY_END_FAR_M: z.coerce.number().default(1000),
  REFERRAL_REWARD_PKR: z.coerce.number().default(150),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production') assertProductionSafe(cfg);
  return cfg;
}

/** Production must never run with development defaults or weak secrets. */
export function assertProductionSafe(cfg: AppConfig): void {
  const secrets: Array<[string, string]> = [
    ['JWT_ACCESS_SECRET', cfg.JWT_ACCESS_SECRET],
    ['OTP_HMAC_SECRET', cfg.OTP_HMAC_SECRET],
    ['METRICS_TOKEN', cfg.METRICS_TOKEN],
    ['AI_INTERNAL_TOKEN', cfg.AI_INTERNAL_TOKEN],
  ];
  const problems: string[] = [];
  for (const [name, value] of secrets) {
    if (value.includes(DEV_SECRET_MARKER) || value.length < 32) problems.push(name);
  }
  if (Buffer.from(cfg.DATA_ENCRYPTION_KEY, 'base64').length !== 32 || cfg.DATA_ENCRYPTION_KEY.startsWith('ZGV2LW9ubHkt')) {
    problems.push('DATA_ENCRYPTION_KEY');
  }
  if (cfg.OTP_DEV_ECHO) problems.push('OTP_DEV_ECHO must be false');
  if (cfg.DATABASE_URL.includes('raasta_dev_password')) problems.push('DATABASE_URL uses the development password');
  if (problems.length) {
    throw new Error(`Refusing to start in production with unsafe configuration: ${problems.join(', ')}`);
  }
}

export function config(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Test helper: reset memoized config after mutating process.env. */
export function resetConfigForTests(): void {
  cached = null;
}
