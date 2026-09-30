-- 0001_core: extensions, reference geography, identity & access
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- geography
CREATE TABLE cities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  name_ur       text,
  country_code  char(2) NOT NULL DEFAULT 'PK',
  timezone      text NOT NULL DEFAULT 'Asia/Karachi',
  currency      char(3) NOT NULL DEFAULT 'PKR',
  center        geography(Point, 4326) NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  -- safety / ops tunables live in config, not code
  settings      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_cities_updated BEFORE UPDATE ON cities FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE service_areas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id    uuid NOT NULL REFERENCES cities(id),
  name       text NOT NULL,
  kind       text NOT NULL DEFAULT 'SERVICE' CHECK (kind IN ('SERVICE','AIRPORT','RESTRICTED')),
  boundary   geography(Polygon, 4326) NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_service_areas_boundary ON service_areas USING gist (boundary);
CREATE INDEX idx_service_areas_city ON service_areas (city_id);

CREATE TABLE demand_zones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id    uuid NOT NULL REFERENCES cities(id),
  code       text NOT NULL,
  name       text NOT NULL,
  boundary   geography(Polygon, 4326) NOT NULL,
  centroid   geography(Point, 4326) NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, code)
);
CREATE INDEX idx_demand_zones_boundary ON demand_zones USING gist (boundary);

CREATE TABLE places (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id     uuid NOT NULL REFERENCES cities(id),
  name        text NOT NULL,
  aliases     text[] NOT NULL DEFAULT '{}',
  category    text NOT NULL DEFAULT 'AREA',
  address     text,
  location    geography(Point, 4326) NOT NULL,
  search_text text NOT NULL,
  popularity  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_places_trgm ON places USING gin (search_text gin_trgm_ops);
CREATE INDEX idx_places_location ON places USING gist (location);

-- ---------------------------------------------------------------- identity
CREATE TABLE users (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                   text,
  email_verified_at       timestamptz,
  phone                   text UNIQUE,
  phone_verified_at       timestamptz,
  password_hash           text,
  full_name               text NOT NULL,
  avatar_key              text,
  gender                  text CHECK (gender IN ('FEMALE','MALE','OTHER','UNDISCLOSED')),
  locale                  text NOT NULL DEFAULT 'en',
  status                  text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','DELETED')),
  suspended_reason        text,
  referral_code           text UNIQUE,
  referred_by             uuid REFERENCES users(id),
  personalization_enabled boolean NOT NULL DEFAULT true,
  safety_preferences      jsonb NOT NULL DEFAULT '{"autoShareWithContacts":false,"routeDeviationAlerts":true,"preferFemaleDriver":false}'::jsonb,
  notification_preferences jsonb NOT NULL DEFAULT '{"push":true,"sms":true,"email":false,"marketing":false}'::jsonb,
  home_city_id            uuid REFERENCES cities(id),
  is_test_data            boolean NOT NULL DEFAULT false,
  deleted_at              timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL OR status = 'DELETED')
);
CREATE UNIQUE INDEX idx_users_email_lower ON users (lower(email)) WHERE email IS NOT NULL;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_roles (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('PASSENGER','DRIVER','ADMIN','SUPPORT','CORPORATE_ADMIN')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE oauth_identities (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider   text NOT NULL CHECK (provider IN ('GOOGLE','APPLE')),
  subject    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);

CREATE TABLE auth_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id          uuid NOT NULL,
  refresh_token_hash text NOT NULL UNIQUE,
  device_id          text,
  device_name        text,
  platform           text,
  ip                 inet,
  user_agent         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  rotated_at         timestamptz,
  revoked_at         timestamptz,
  revoked_reason     text
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_auth_sessions_family ON auth_sessions (family_id);
CREATE INDEX idx_auth_sessions_device ON auth_sessions (device_id);

CREATE TABLE otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL,
  purpose     text NOT NULL CHECK (purpose IN ('LOGIN','VERIFY_PHONE')),
  code_hash   text NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_otp_phone ON otp_codes (phone, created_at DESC);

CREATE TABLE consents (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('LOCATION','PERSONALIZATION','MARKETING','TERMS','DRIVER_CODE_OF_CONDUCT','RECURRING_AUTO_DISPATCH')),
  granted    boolean NOT NULL,
  version    text NOT NULL DEFAULT '1',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_consents_user ON consents (user_id, kind, created_at DESC);

CREATE TABLE saved_places (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      text NOT NULL CHECK (label IN ('HOME','WORK','FAVORITE')),
  name       text NOT NULL,
  address    text,
  location   geography(Point, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_saved_places_home_work ON saved_places (user_id, label) WHERE label IN ('HOME','WORK');

CREATE TABLE emergency_contacts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             text NOT NULL,
  phone            text NOT NULL,
  relationship     text,
  share_by_default boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_emergency_contacts_user ON emergency_contacts (user_id);

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id),
  actor_roles text[],
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  reason      text,
  ip          inet,
  request_id  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_actor ON audit_logs (actor_id, created_at DESC);

CREATE TABLE idempotency_keys (
  user_id      uuid NOT NULL,
  key          text NOT NULL,
  scope        text NOT NULL,
  request_hash text NOT NULL,
  status       text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','COMPLETED')),
  response     jsonb,
  status_code  int,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope, key)
);
