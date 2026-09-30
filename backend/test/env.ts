// Loaded before anything imports the config. Isolates tests from the dev database and Redis db 0.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://raasta:raasta_dev_password@localhost:5432/raasta_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';
process.env.OTP_DEV_ECHO = 'true';
process.env.RUN_WORKERS_IN_API = 'true';
process.env.GPS_MAX_PLAUSIBLE_SPEED_MPS = '1000000'; // simulated drives teleport between pings
process.env.AI_SERVICE_URL = process.env.TEST_AI_SERVICE_URL ?? 'http://127.0.0.1:1'; // unreachable on purpose: exercises fallbacks
process.env.MATCH_OFFER_TIMEOUT_MS = process.env.MATCH_OFFER_TIMEOUT_MS ?? '3000';
process.env.STORAGE_DIR = './storage-test';
process.env.SWAGGER_ENABLED = 'false';
process.env.RATE_LIMIT_DISABLED = 'true'; // rate limiting has its own test that re-enables it
