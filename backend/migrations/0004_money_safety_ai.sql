-- 0004: payments & ledger, promotions, notifications, support, safety, fraud, AI, intercity

-- ------------------------------------------------------------ ledger
-- Balances are never stored. A wallet balance is SUM(wallet_entries.amount) per bucket.
-- Every ledger transaction is double-entry: its entries sum to zero (enforced by a deferred trigger).
CREATE TABLE wallets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type  text NOT NULL CHECK (owner_type IN ('PASSENGER','DRIVER','CORPORATE','PLATFORM_REVENUE','PLATFORM_CASH_CLEARING','PAYMENT_GATEWAY','PROMOTIONS')),
  owner_id    uuid,                        -- NULL for platform system wallets
  currency    char(3) NOT NULL DEFAULT 'PKR',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (owner_type, owner_id, currency)
);

CREATE TABLE ledger_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('TOPUP','RIDE_PAYMENT','RIDE_CASH_COMMISSION','DRIVER_EARNING','PLATFORM_FEE',
                                                'WITHDRAWAL','WITHDRAWAL_SETTLED','REFUND','PROMO_CREDIT','REFERRAL_REWARD',
                                                'CANCELLATION_FEE','CORPORATE_CHARGE','ADJUSTMENT')),
  reference_type  text,
  reference_id    text,
  idempotency_key text NOT NULL UNIQUE,
  description     text NOT NULL,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallet_transactions (   -- ledger entries (immutable)
  id             bigserial PRIMARY KEY,
  transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
  wallet_id      uuid NOT NULL REFERENCES wallets(id),
  bucket         text NOT NULL DEFAULT 'AVAILABLE' CHECK (bucket IN ('AVAILABLE','PENDING')),
  amount         bigint NOT NULL CHECK (amount <> 0),   -- signed PKR; + credit, - debit
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_wallet_tx_wallet ON wallet_transactions (wallet_id, id DESC);
CREATE INDEX idx_wallet_tx_txn ON wallet_transactions (transaction_id);

CREATE OR REPLACE FUNCTION ledger_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'ledger entries are immutable'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_wallet_tx_immutable BEFORE UPDATE OR DELETE ON wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER trg_ledger_tx_immutable BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

CREATE OR REPLACE FUNCTION ledger_balanced() RETURNS trigger AS $$
DECLARE s bigint;
BEGIN
  SELECT COALESCE(SUM(amount),0) INTO s FROM wallet_transactions WHERE transaction_id = NEW.transaction_id;
  IF s <> 0 THEN RAISE EXCEPTION 'ledger transaction % is unbalanced (%)', NEW.transaction_id, s; END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER trg_wallet_tx_balanced AFTER INSERT ON wallet_transactions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_balanced();

CREATE TABLE payment_methods (   -- tokenized references only; never raw card data
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider       text NOT NULL,
  provider_token text NOT NULL,
  brand          text,
  last4          text,
  exp_month      int,
  exp_year       int,
  is_default     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id         uuid REFERENCES rides(id),
  payer_user_id   uuid REFERENCES users(id),
  purpose         text NOT NULL CHECK (purpose IN ('RIDE','TOPUP','CANCELLATION_FEE','INTERCITY')),
  method          text NOT NULL CHECK (method IN ('CASH','WALLET','CARD','CORPORATE','BANK_TRANSFER')),
  provider        text NOT NULL,
  provider_ref    text,
  amount          int NOT NULL CHECK (amount >= 0),
  currency        char(3) NOT NULL DEFAULT 'PKR',
  status          text NOT NULL CHECK (status IN ('PENDING','SUCCEEDED','FAILED','REFUNDED')),
  failure_reason  text,
  idempotency_key text NOT NULL UNIQUE,
  ledger_transaction_id uuid REFERENCES ledger_transactions(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_ride ON payments (ride_id);
CREATE INDEX idx_payments_payer ON payments (payer_user_id, created_at DESC);
CREATE INDEX idx_payments_failed ON payments (created_at) WHERE status = 'FAILED';

CREATE TABLE withdrawals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id     uuid NOT NULL REFERENCES drivers(user_id),
  amount        int NOT NULL CHECK (amount > 0),
  destination   jsonb NOT NULL,         -- masked bank/wallet account reference
  status        text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','PAID','REJECTED')),
  processed_by  uuid REFERENCES users(id),
  processed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------ promotions
CREATE TABLE promotions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text NOT NULL,
  name                 text NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('PROMO','FIRST_RIDE','CORPORATE','CAMPAIGN','REFERRAL')),
  discount_type        text NOT NULL CHECK (discount_type IN ('PERCENT','FLAT')),
  discount_value       int NOT NULL CHECK (discount_value > 0),
  max_discount         int,
  min_fare             int NOT NULL DEFAULT 0,
  starts_at            timestamptz NOT NULL,
  ends_at              timestamptz NOT NULL,
  usage_limit_total    int,
  usage_limit_per_user int NOT NULL DEFAULT 1,
  city_ids             uuid[] NOT NULL DEFAULT '{}',      -- empty = all
  product_codes        text[] NOT NULL DEFAULT '{}',      -- empty = all
  new_users_only       boolean NOT NULL DEFAULT false,
  corporate_id         uuid REFERENCES corporate_accounts(id),
  active               boolean NOT NULL DEFAULT true,
  created_by           uuid REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (discount_type <> 'PERCENT' OR discount_value <= 100)
);
CREATE UNIQUE INDEX idx_promotions_code ON promotions (upper(code));

CREATE TABLE promotion_redemptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES promotions(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  ride_id      uuid REFERENCES rides(id),
  amount       int NOT NULL,
  status       text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','APPLIED','RELEASED')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_redemptions_promo_user ON promotion_redemptions (promotion_id, user_id);
ALTER TABLE rides ADD CONSTRAINT fk_rides_promo FOREIGN KEY (promo_id) REFERENCES promotions(id);

CREATE TABLE referral_rewards (
  referrer_id uuid NOT NULL REFERENCES users(id),
  referee_id  uuid NOT NULL REFERENCES users(id) UNIQUE,
  ride_id     uuid REFERENCES rides(id),
  amount      int NOT NULL,
  status      text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','BLOCKED')),
  blocked_reason text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------ notifications & support
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);

CREATE TABLE support_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  ride_id     uuid REFERENCES rides(id),
  category    text NOT NULL CHECK (category IN ('FARE','LOST_ITEM','SAFETY','DRIVER_BEHAVIOUR','PASSENGER_BEHAVIOUR','PAYMENT','ACCOUNT','APP_ISSUE','OTHER')),
  subject     text NOT NULL,
  status      text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','WAITING_ON_USER','RESOLVED','CLOSED')),
  priority    text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  assigned_to uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_support_status ON support_tickets (status, priority, created_at);
CREATE TRIGGER trg_support_updated BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE support_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id   uuid REFERENCES users(id),
  author_kind text NOT NULL CHECK (author_kind IN ('USER','AGENT','SYSTEM')),
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------ safety
CREATE TABLE safety_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id            uuid REFERENCES rides(id),
  user_id            uuid REFERENCES users(id),     -- who raised / who it concerns (passenger)
  type               text NOT NULL CHECK (type IN ('ROUTE_DEVIATION','PROLONGED_STOP','END_FAR_FROM_DESTINATION',
                                                   'GPS_INCONSISTENCY','SOS','REPEATED_EMERGENCY','SPEEDING','MANUAL_REPORT')),
  severity           text NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  status             text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CONFIRMED_SAFE','ESCALATED','RESOLVED','FALSE_POSITIVE')),
  location           geography(Point, 4326),
  details            jsonb NOT NULL DEFAULT '{}'::jsonb,
  passenger_response text,
  resolved_by        uuid REFERENCES users(id),
  resolution_note    text,
  resolved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_safety_open ON safety_events (created_at DESC) WHERE status IN ('OPEN','ESCALATED');
CREATE INDEX idx_safety_ride ON safety_events (ride_id);

-- ------------------------------------------------------------ fraud (internal only)
CREATE TABLE fraud_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id uuid NOT NULL REFERENCES users(id),
  rule_code       text NOT NULL,
  risk_level      text NOT NULL CHECK (risk_level IN ('LOW','MEDIUM','HIGH')),
  score           numeric(5,2) NOT NULL,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DISMISSED','ACTIONED')),
  reviewed_by     uuid REFERENCES users(id),
  review_note     text,
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_fraud_open ON fraud_events (created_at DESC) WHERE status = 'OPEN';
CREATE INDEX idx_fraud_subject ON fraud_events (subject_user_id, rule_code, created_at DESC);

-- ------------------------------------------------------------ AI / ML
CREATE TABLE ai_predictions (
  id             bigserial PRIMARY KEY,
  kind           text NOT NULL CHECK (kind IN ('ETA_PICKUP','ETA_TRIP','DEMAND','CANCELLATION','MATCH_RANK','FRAUD','FARE','NLU')),
  model_name     text NOT NULL,
  model_version  text NOT NULL,
  entity_type    text,
  entity_id      text,
  features       jsonb NOT NULL DEFAULT '{}'::jsonb,
  prediction     jsonb NOT NULL,
  predicted_value double precision,
  actual_value   double precision,
  abs_error      double precision,
  latency_ms     int,
  fallback_used  boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);
CREATE INDEX idx_ai_predictions_kind ON ai_predictions (kind, created_at DESC);
CREATE INDEX idx_ai_predictions_entity ON ai_predictions (entity_type, entity_id);

CREATE TABLE model_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name      text NOT NULL,
  version         text NOT NULL,
  algorithm       text NOT NULL,
  training_date   timestamptz NOT NULL,
  features        text[] NOT NULL,
  metrics         jsonb NOT NULL,
  baseline_metrics jsonb NOT NULL,
  dataset_version text NOT NULL,
  dataset_rows    int NOT NULL,
  trained_on_synthetic boolean NOT NULL,
  status          text NOT NULL CHECK (status IN ('CANDIDATE','ACTIVE','REJECTED','RETIRED')),
  artifact_uri    text NOT NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_name, version)
);

CREATE TABLE demand_snapshots (   -- 15-minute aggregates per zone (feature store for demand model)
  zone_id        uuid NOT NULL REFERENCES demand_zones(id),
  bucket_start   timestamptz NOT NULL,
  requests       int NOT NULL DEFAULT 0,
  completed      int NOT NULL DEFAULT 0,
  unfulfilled    int NOT NULL DEFAULT 0,
  online_drivers int NOT NULL DEFAULT 0,
  avg_fare       int,
  PRIMARY KEY (zone_id, bucket_start)
);

CREATE TABLE mobility_profiles (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferred_product text,
  typical_fare_low  int,
  typical_fare_high int,
  routines        jsonb NOT NULL DEFAULT '[]'::jsonb,
  cancellation_rate numeric(5,4),
  rides_considered int NOT NULL DEFAULT 0,
  computed_at     timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------ intercity
CREATE TABLE intercity_routes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_city_id  uuid NOT NULL REFERENCES cities(id),
  dest_city_id    uuid NOT NULL REFERENCES cities(id),
  distance_km     int NOT NULL,
  typical_duration_min int NOT NULL,
  suggested_seat_fare int NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  UNIQUE (origin_city_id, dest_city_id),
  CHECK (origin_city_id <> dest_city_id)
);

CREATE TABLE intercity_trips (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id        uuid NOT NULL REFERENCES intercity_routes(id),
  driver_id       uuid NOT NULL REFERENCES drivers(user_id),
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  departure_at    timestamptz NOT NULL,
  pickup_point    text NOT NULL,
  dropoff_point   text NOT NULL,
  seats_total     int NOT NULL CHECK (seats_total BETWEEN 1 AND 12),
  seat_fare       int NOT NULL CHECK (seat_fare > 0),
  luggage_policy  text NOT NULL DEFAULT 'ONE_BAG' CHECK (luggage_policy IN ('NONE','ONE_BAG','TWO_BAGS','LARGE_ALLOWED')),
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','FULL','DEPARTED','COMPLETED','CANCELLED')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_intercity_trips_route ON intercity_trips (route_id, departure_at) WHERE status = 'OPEN';

CREATE TABLE intercity_bookings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id       uuid NOT NULL REFERENCES intercity_trips(id),
  passenger_id  uuid NOT NULL REFERENCES users(id),
  seats         int NOT NULL CHECK (seats >= 1),
  luggage_count int NOT NULL DEFAULT 0,
  fare_total    int NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('CASH','WALLET')),
  status        text NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED','CANCELLED','COMPLETED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, passenger_id)
);

-- ------------------------------------------------------------ driver statistics (reliability inputs)
-- Materialized per driver; refreshed by a worker and after ride completion. Internal only.
CREATE TABLE driver_stats (
  driver_id           uuid PRIMARY KEY REFERENCES drivers(user_id) ON DELETE CASCADE,
  offers_received     int NOT NULL DEFAULT 0,
  offers_accepted     int NOT NULL DEFAULT 0,
  trips_assigned      int NOT NULL DEFAULT 0,
  trips_completed     int NOT NULL DEFAULT 0,
  driver_cancellations int NOT NULL DEFAULT 0,
  avg_response_s      numeric(6,2),
  rating_avg          numeric(3,2),
  rating_count        int NOT NULL DEFAULT 0,
  safety_events_90d   int NOT NULL DEFAULT 0,
  route_adherence     numeric(5,4),
  reliability_score   numeric(5,4),           -- internal, never shown to passengers
  computed_at         timestamptz NOT NULL DEFAULT now()
);
