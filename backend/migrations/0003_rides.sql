-- 0003_rides: corporate, quotes, rides, offers, events, locations, carpool, scheduling, ratings

CREATE TABLE corporate_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  industry       text NOT NULL DEFAULT 'OTHER' CHECK (industry IN ('SOFTWARE','FACTORY','UNIVERSITY','HOSPITAL','OFFICE','OTHER')),
  billing_email  text NOT NULL,
  city_id        uuid REFERENCES cities(id),
  monthly_budget int NOT NULL DEFAULT 0,        -- PKR, 0 = unlimited
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  is_test_data   boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE corporate_users (
  corporate_id  uuid NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'EMPLOYEE' CHECK (role IN ('EMPLOYEE','ADMIN')),
  monthly_limit int NOT NULL DEFAULT 0,          -- PKR, 0 = policy default
  employee_code text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (corporate_id, user_id)
);
CREATE INDEX idx_corporate_users_user ON corporate_users (user_id);

CREATE TABLE corporate_policies (
  corporate_id     uuid PRIMARY KEY REFERENCES corporate_accounts(id) ON DELETE CASCADE,
  allowed_products text[] NOT NULL DEFAULT '{ECONOMY,COMFORT}',
  max_fare_per_ride int NOT NULL DEFAULT 0,     -- 0 = no cap
  allowed_weekdays int[] NOT NULL DEFAULT '{1,2,3,4,5}',  -- ISO 1=Mon
  allowed_start    time NOT NULL DEFAULT '06:00',
  allowed_end      time NOT NULL DEFAULT '22:00',
  require_purpose  boolean NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ride_quotes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id  uuid NOT NULL REFERENCES users(id),
  city_id       uuid NOT NULL REFERENCES cities(id),
  pickup        geography(Point, 4326) NOT NULL,
  pickup_address text NOT NULL,
  dropoff       geography(Point, 4326) NOT NULL,
  dropoff_address text NOT NULL,
  distance_m    int NOT NULL,
  duration_s    int NOT NULL,
  route         geography(LineString, 4326),
  options       jsonb NOT NULL,            -- per product fare breakdown + explanation
  context       jsonb NOT NULL,            -- demand/supply snapshot used for the quote (auditable)
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ride_quotes_passenger ON ride_quotes (passenger_id, created_at DESC);

CREATE TABLE carpool_groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id    uuid NOT NULL REFERENCES cities(id),
  driver_id  uuid REFERENCES drivers(user_id),
  status     text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','COMPLETED','CANCELLED')),
  seats_total int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recurring_rides (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_id             uuid NOT NULL REFERENCES cities(id),
  label               text NOT NULL,
  pickup              geography(Point, 4326) NOT NULL,
  pickup_address      text NOT NULL,
  dropoff             geography(Point, 4326) NOT NULL,
  dropoff_address     text NOT NULL,
  product_code        text NOT NULL REFERENCES ride_products(code),
  payment_method      text NOT NULL,
  days_of_week        int[] NOT NULL,                 -- ISO 1=Mon .. 7=Sun
  pickup_time         time,                           -- either pickup_time or target_arrival_time
  target_arrival_time time,
  starts_on           date NOT NULL DEFAULT current_date,
  ends_on             date,
  preferred_driver_id uuid REFERENCES drivers(user_id),
  corporate_id        uuid REFERENCES corporate_accounts(id),
  auto_dispatch       boolean NOT NULL DEFAULT false, -- explicit user permission to dispatch without a tap
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (pickup_time IS NOT NULL OR target_arrival_time IS NOT NULL),
  CHECK (array_length(days_of_week, 1) >= 1)
);
CREATE INDEX idx_recurring_active ON recurring_rides (active) WHERE active;

CREATE TABLE scheduled_rides (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_id           uuid NOT NULL REFERENCES cities(id),
  recurring_ride_id uuid REFERENCES recurring_rides(id) ON DELETE SET NULL,
  pickup            geography(Point, 4326) NOT NULL,
  pickup_address    text NOT NULL,
  dropoff           geography(Point, 4326) NOT NULL,
  dropoff_address   text NOT NULL,
  product_code      text NOT NULL REFERENCES ride_products(code),
  payment_method    text NOT NULL,
  pickup_at         timestamptz NOT NULL,
  target_arrival_at timestamptz,
  dispatch_at       timestamptz NOT NULL,           -- when matching starts (pickup_at - predicted pickup eta - buffer)
  preferred_driver_id uuid REFERENCES drivers(user_id),
  corporate_id      uuid REFERENCES corporate_accounts(id),
  source            text NOT NULL DEFAULT 'APP' CHECK (source IN ('APP','VOICE','ASSISTANT','RECURRING','CORPORATE')),
  status            text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DISPATCHED','CANCELLED','FAILED')),
  ride_id           uuid,
  failure_reason    text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_scheduled_due ON scheduled_rides (dispatch_at) WHERE status = 'PENDING';
CREATE UNIQUE INDEX idx_scheduled_recurring_occurrence ON scheduled_rides (recurring_ride_id, pickup_at) WHERE recurring_ride_id IS NOT NULL;

CREATE TABLE rides (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id          uuid NOT NULL REFERENCES users(id),
  driver_id             uuid REFERENCES drivers(user_id),
  vehicle_id            uuid REFERENCES vehicles(id),
  city_id               uuid NOT NULL REFERENCES cities(id),
  quote_id              uuid REFERENCES ride_quotes(id),
  product_code          text NOT NULL REFERENCES ride_products(code),
  mode                  text NOT NULL DEFAULT 'ON_DEMAND' CHECK (mode IN ('ON_DEMAND','SCHEDULED','SHARED')),
  status                text NOT NULL CHECK (status IN ('MATCHING','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED',
                                                       'IN_PROGRESS','COMPLETED','CANCELLED','NO_DRIVERS')),
  pickup                geography(Point, 4326) NOT NULL,
  pickup_address        text NOT NULL,
  dropoff               geography(Point, 4326) NOT NULL,
  dropoff_address       text NOT NULL,
  expected_route        geography(LineString, 4326),
  est_distance_m        int NOT NULL,
  est_duration_s        int NOT NULL,
  recommended_fare      int NOT NULL,
  offered_fare          int NOT NULL,          -- what passenger agreed to pay before discounts
  discount_amount       int NOT NULL DEFAULT 0,
  final_fare            int,                   -- charged amount (offered - discount + fees) set at completion
  cancellation_fee      int NOT NULL DEFAULT 0,
  currency              char(3) NOT NULL DEFAULT 'PKR',
  payment_method        text NOT NULL CHECK (payment_method IN ('CASH','WALLET','CARD','CORPORATE')),
  payment_status        text NOT NULL DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING','PAID','FAILED','REFUNDED','WAIVED')),
  promo_id              uuid,
  pin_code              text,                  -- 4 digits, only returned to the passenger
  pin_attempts          int NOT NULL DEFAULT 0,
  carpool_group_id      uuid REFERENCES carpool_groups(id),
  seats                 int NOT NULL DEFAULT 1,
  scheduled_ride_id     uuid REFERENCES scheduled_rides(id),
  corporate_id          uuid REFERENCES corporate_accounts(id),
  trip_purpose          text,
  safety_mode           boolean NOT NULL DEFAULT false,
  match_attempt         int NOT NULL DEFAULT 0,
  excluded_driver_ids   uuid[] NOT NULL DEFAULT '{}',
  predicted_pickup_eta_s int,
  predicted_trip_eta_s  int,
  actual_distance_m     int,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  assigned_at           timestamptz,
  arrived_at            timestamptz,
  started_at            timestamptz,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  cancelled_by          text CHECK (cancelled_by IN ('PASSENGER','DRIVER','SYSTEM','ADMIN')),
  cancellation_reason   text,
  is_test_data          boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_rides_updated BEFORE UPDATE ON rides FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_rides_passenger ON rides (passenger_id, requested_at DESC);
CREATE INDEX idx_rides_driver ON rides (driver_id, requested_at DESC);
CREATE INDEX idx_rides_status ON rides (status) WHERE status NOT IN ('COMPLETED','CANCELLED','NO_DRIVERS');
CREATE INDEX idx_rides_city_time ON rides (city_id, requested_at DESC);
CREATE INDEX idx_rides_pickup ON rides USING gist (pickup);
CREATE INDEX idx_rides_corporate ON rides (corporate_id, requested_at DESC) WHERE corporate_id IS NOT NULL;
-- a passenger can have at most one live on-demand ride (network retries can never create duplicates)
CREATE UNIQUE INDEX idx_rides_one_active_per_passenger ON rides (passenger_id)
  WHERE status IN ('MATCHING','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS');
ALTER TABLE scheduled_rides ADD CONSTRAINT fk_scheduled_ride FOREIGN KEY (ride_id) REFERENCES rides(id);

CREATE TABLE ride_requests (  -- offers sent to drivers
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id       uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  driver_id     uuid NOT NULL REFERENCES drivers(user_id),
  attempt       int NOT NULL,
  rank          int NOT NULL,
  score         numeric(6,4) NOT NULL,
  score_breakdown jsonb NOT NULL,
  pickup_distance_m int NOT NULL,
  pickup_eta_s  int NOT NULL,
  status        text NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT','ACCEPTED','DECLINED','EXPIRED','CANCELLED')),
  sent_at       timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  responded_at  timestamptz,
  decline_reason text
);
CREATE INDEX idx_ride_requests_ride ON ride_requests (ride_id);
CREATE INDEX idx_ride_requests_driver ON ride_requests (driver_id, sent_at DESC);

CREATE TABLE ride_events (
  id         bigserial PRIMARY KEY,
  ride_id    uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  type       text NOT NULL,
  from_status text,
  to_status  text,
  actor_id   uuid,
  actor_role text,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ride_events_ride ON ride_events (ride_id, id);

CREATE TABLE ride_locations (
  id          bigserial PRIMARY KEY,
  ride_id     uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  driver_id   uuid NOT NULL,
  phase       text NOT NULL CHECK (phase IN ('TO_PICKUP','ON_TRIP')),
  location    geography(Point, 4326) NOT NULL,
  speed_mps   real,
  heading     real,
  accuracy_m  real,
  recorded_at timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ride_locations_ride ON ride_locations (ride_id, recorded_at);
CREATE INDEX idx_ride_locations_created ON ride_locations (created_at);  -- retention job

CREATE TABLE ride_shares (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES users(id),
  token_hash  text NOT NULL UNIQUE,
  recipient_name text,
  recipient_phone text,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ratings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id    uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  rater_id   uuid NOT NULL REFERENCES users(id),
  ratee_id   uuid NOT NULL REFERENCES users(id),
  rater_role text NOT NULL CHECK (rater_role IN ('PASSENGER','DRIVER')),
  stars      int NOT NULL CHECK (stars BETWEEN 1 AND 5),
  tags       text[] NOT NULL DEFAULT '{}',
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ride_id, rater_id)
);
CREATE INDEX idx_ratings_ratee ON ratings (ratee_id, created_at DESC);
