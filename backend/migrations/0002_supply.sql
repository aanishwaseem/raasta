-- 0002_supply: products, pricing configuration, drivers, vehicles, documents

-- Ride products are configuration, not code. vehicle_class links a product to the vehicles that can serve it.
CREATE TABLE ride_products (
  code          text PRIMARY KEY,
  name          text NOT NULL,
  description   text NOT NULL,
  vehicle_class text NOT NULL CHECK (vehicle_class IN ('BIKE','ECONOMY','COMFORT','PREMIUM','XL')),
  capacity      int NOT NULL,
  is_shared     boolean NOT NULL DEFAULT false,
  sort_order    int NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true
);

CREATE TABLE pricing_configs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id               uuid NOT NULL REFERENCES cities(id),
  product_code          text NOT NULL REFERENCES ride_products(code),
  base_fare             int NOT NULL,
  per_km                numeric(8,2) NOT NULL,
  per_minute            numeric(8,2) NOT NULL,
  minimum_fare          int NOT NULL,
  booking_fee           int NOT NULL DEFAULT 0,
  platform_fee_pct      numeric(5,2) NOT NULL DEFAULT 15,
  fuel_cost_per_km      numeric(8,2) NOT NULL,          -- used for driver net-earnings estimate and cost floor
  max_surge_multiplier  numeric(4,2) NOT NULL DEFAULT 1.8,
  min_offer_pct         numeric(5,2) NOT NULL DEFAULT 80, -- lowest offer allowed as % of recommended
  shared_discount_pct   numeric(5,2) NOT NULL DEFAULT 0,
  cancellation_fee      int NOT NULL DEFAULT 0,
  free_cancel_seconds   int NOT NULL DEFAULT 120,
  active                boolean NOT NULL DEFAULT true,
  updated_by            uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, product_code)
);
CREATE TRIGGER trg_pricing_updated BEFORE UPDATE ON pricing_configs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE drivers (
  user_id                  uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  city_id                  uuid REFERENCES cities(id),
  status                   text NOT NULL DEFAULT 'ONBOARDING'
                           CHECK (status IN ('ONBOARDING','PENDING_REVIEW','APPROVED','REJECTED','SUSPENDED')),
  onboarding_step          text NOT NULL DEFAULT 'IDENTITY'
                           CHECK (onboarding_step IN ('IDENTITY','DOCUMENTS','VEHICLE','REVIEW','TRAINING','ACTIVE')),
  cnic_encrypted           text,          -- AES-256-GCM, key from env
  cnic_last4               text,
  license_number_encrypted text,
  date_of_birth            date,
  training_acknowledged_at timestamptz,
  current_vehicle_id       uuid,
  preferences              jsonb NOT NULL DEFAULT '{"acceptShared":true,"maxPickupKm":5,"acceptIntercity":false}'::jsonb,
  review_notes             text,
  approved_at              timestamptz,
  approved_by              uuid REFERENCES users(id),
  is_test_data             boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_drivers_status ON drivers (status);
CREATE TRIGGER trg_drivers_updated BEFORE UPDATE ON drivers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE vehicles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id     uuid NOT NULL REFERENCES drivers(user_id) ON DELETE CASCADE,
  vehicle_class text NOT NULL CHECK (vehicle_class IN ('BIKE','ECONOMY','COMFORT','PREMIUM','XL')),
  make          text NOT NULL,
  model         text NOT NULL,
  year          int NOT NULL CHECK (year BETWEEN 1980 AND 2100),
  color         text NOT NULL,
  plate_number  text NOT NULL,
  seats         int NOT NULL CHECK (seats BETWEEN 1 AND 12),
  status        text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','INACTIVE')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_vehicles_plate ON vehicles (upper(replace(plate_number,' ','')));
CREATE INDEX idx_vehicles_driver ON vehicles (driver_id);
ALTER TABLE drivers ADD CONSTRAINT fk_drivers_vehicle FOREIGN KEY (current_vehicle_id) REFERENCES vehicles(id);

CREATE TABLE driver_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id        uuid NOT NULL REFERENCES drivers(user_id) ON DELETE CASCADE,
  vehicle_id       uuid REFERENCES vehicles(id) ON DELETE CASCADE,
  doc_type         text NOT NULL CHECK (doc_type IN ('CNIC_FRONT','CNIC_BACK','DRIVING_LICENSE','PROFILE_PHOTO',
                                                      'VEHICLE_REGISTRATION','VEHICLE_PHOTO','INSURANCE','ROUTE_PERMIT')),
  storage_key      text NOT NULL,
  content_type     text NOT NULL,
  size_bytes       int NOT NULL,
  document_number  text,
  expires_on       date,
  status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED')),
  rejection_reason text,
  reviewed_by      uuid REFERENCES users(id),
  reviewed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_driver_documents_driver ON driver_documents (driver_id);
CREATE INDEX idx_driver_documents_status ON driver_documents (status) WHERE status = 'PENDING';

-- presence sessions (for online hours and idle time analytics); live presence itself is in Redis
CREATE TABLE driver_online_sessions (
  id         bigserial PRIMARY KEY,
  driver_id  uuid NOT NULL REFERENCES drivers(user_id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz
);
CREATE INDEX idx_driver_online_driver ON driver_online_sessions (driver_id, started_at DESC);
CREATE UNIQUE INDEX idx_driver_online_open ON driver_online_sessions (driver_id) WHERE ended_at IS NULL;
