-- Delivery bounded context. Deliberately separate from rides: own tables, own state machine, own module.
-- It shares only identity (users/drivers), geography (cities/service areas) and notifications.

CREATE TABLE delivery_rates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id          uuid UNIQUE REFERENCES cities(id) ON DELETE CASCADE,   -- NULL = default for cities without a row
  base_fare        int NOT NULL CHECK (base_fare >= 0),
  per_km           numeric(8,2) NOT NULL CHECK (per_km >= 0),
  minimum_fare     int NOT NULL CHECK (minimum_fare >= 0),
  max_weight_kg    numeric(6,2) NOT NULL CHECK (max_weight_kg > 0),
  max_distance_km  int NOT NULL DEFAULT 40 CHECK (max_distance_km > 0),
  platform_fee_pct numeric(5,2) NOT NULL DEFAULT 15 CHECK (platform_fee_pct BETWEEN 0 AND 40),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_delivery_rates_default ON delivery_rates ((city_id IS NULL)) WHERE city_id IS NULL;
-- development defaults, editable per city by staff
INSERT INTO delivery_rates (city_id, base_fare, per_km, minimum_fare, max_weight_kg) VALUES (NULL, 60, 18, 120, 15);

CREATE TABLE delivery_orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id            uuid NOT NULL REFERENCES users(id),
  driver_id            uuid REFERENCES drivers(user_id),
  city_id              uuid NOT NULL REFERENCES cities(id),
  status               text NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','ACCEPTED','PICKED_UP','DELIVERED','CANCELLED')),
  package_category     text NOT NULL CHECK (package_category IN ('DOCUMENTS','FOOD','PARCEL','FRAGILE','GROCERY','OTHER')),
  package_description  text,
  weight_kg            numeric(6,2) NOT NULL CHECK (weight_kg > 0),
  pickup               geography(Point,4326) NOT NULL,
  pickup_address       text NOT NULL,
  pickup_contact_name  text,
  pickup_contact_phone text,
  dropoff              geography(Point,4326) NOT NULL,
  dropoff_address      text NOT NULL,
  recipient_name       text NOT NULL,
  recipient_phone      text NOT NULL,
  distance_m           int NOT NULL,
  fare                 int NOT NULL CHECK (fare >= 0),
  platform_fee         int NOT NULL DEFAULT 0,
  payment_method       text NOT NULL DEFAULT 'CASH' CHECK (payment_method IN ('CASH')),
  tracking_code        text NOT NULL UNIQUE,
  delivery_pin_hash    text NOT NULL,           -- proof of delivery: the recipient reads the PIN to the driver
  pin_attempts         int NOT NULL DEFAULT 0,
  proof_note           text,
  cancelled_by         text CHECK (cancelled_by IN ('SENDER','DRIVER','STAFF')),
  cancellation_reason  text,
  is_test_data         boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  accepted_at          timestamptz,
  picked_up_at         timestamptz,
  delivered_at         timestamptz,
  cancelled_at         timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_delivery_sender ON delivery_orders (sender_id, created_at DESC);
CREATE INDEX idx_delivery_driver ON delivery_orders (driver_id, status) WHERE driver_id IS NOT NULL;
CREATE INDEX idx_delivery_open ON delivery_orders (city_id, created_at) WHERE status = 'CREATED';
CREATE INDEX idx_delivery_pickup ON delivery_orders USING gist (pickup) WHERE status = 'CREATED';
CREATE TRIGGER trg_delivery_updated BEFORE UPDATE ON delivery_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE delivery_events (
  id          bigserial PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  type        text NOT NULL,
  actor_id    uuid REFERENCES users(id),
  payload     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_delivery_events ON delivery_events (delivery_id, id);
