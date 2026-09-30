# Database Architecture

PostgreSQL 16 + PostGIS 3.4 (+ `pg_trgm`, `pgcrypto`). The schema lives in versioned SQL migrations in
`backend/migrations/NNNN_*.sql`, applied by `npm run db:migrate`, which records each file in `schema_migrations`
with a checksum and refuses to run if an applied file was edited. Tables are never created by hand.

## Conventions
- UUID primary keys (`gen_random_uuid()`), except append-only high-volume logs (`bigserial`).
- `timestamptz` everywhere, stored in UTC and rendered in the city's timezone (`cities.timezone`).
- Money is stored as integer **PKR** (whole rupees; Pakistani fares are quoted in whole rupees). The
  `currency` columns exist so a minor-unit, multi-currency migration is additive.
- Geography: `geography(Point|LineString|Polygon, 4326)` so distances come out in metres. GiST indexes on
  every geography column used in a predicate.
- Development seed rows carry `is_test_data = true` (users, drivers, rides, corporate accounts).
- Status columns are `text` + `CHECK` constraints (easier to evolve than enums, still validated).

## Entity map

```
cities ─┬─ service_areas (polygons; SERVICE / AIRPORT / RESTRICTED)
        ├─ demand_zones (polygons + centroid) ── demand_snapshots (15-min aggregates)
        ├─ places (gazetteer; trigram search, Urdu aliases)
        ├─ pricing_configs (per city × ride_products)
        └─ intercity_routes (city pairs) ── intercity_trips ── intercity_bookings

users ─┬─ user_roles (RBAC)          ├─ auth_sessions (refresh rotation families, devices)
       ├─ oauth_identities          ├─ otp_codes (hashed codes, attempts)
       ├─ saved_places              ├─ emergency_contacts
       ├─ consents (append-only)    ├─ notifications
       ├─ mobility_profiles         ├─ support_tickets ── support_messages
       ├─ drivers ─┬─ vehicles ── driver_documents
       │           ├─ driver_online_sessions
       │           └─ driver_stats (reliability inputs, internal)
       └─ corporate_users ── corporate_accounts ── corporate_policies

ride_quotes ── rides ─┬─ ride_requests (offers to drivers, score breakdown)
                      ├─ ride_events (append-only state log)
                      ├─ ride_locations (GPS trace; retention-limited)
                      ├─ ride_shares (hashed tracking tokens)
                      ├─ ratings (two-way)
                      ├─ payments ── ledger_transactions ── wallet_transactions ── wallets
                      ├─ promotion_redemptions ── promotions
                      ├─ safety_events
                      └─ carpool_groups (shared rides in one vehicle)
recurring_rides ── scheduled_rides ── rides
fraud_events (internal) · ai_predictions (prediction vs actual) · model_versions · audit_logs · idempotency_keys
```

## Integrity guarantees enforced by the database
| Guarantee | Mechanism |
|---|---|
| No duplicate live ride per passenger (network retries) | partial unique index `idx_rides_one_active_per_passenger` + `idempotency_keys` |
| Only one open presence session per driver | partial unique index on `driver_online_sessions` |
| Ledger is immutable | `BEFORE UPDATE OR DELETE` triggers raise |
| Every ledger transaction balances to zero | deferred constraint trigger `trg_wallet_tx_balanced` |
| One rating per rater per ride | `UNIQUE (ride_id, rater_id)` |
| Unique plates regardless of spacing/case | expression unique index |
| One HOME and one WORK place | partial unique index |
| Recurring occurrences generated once | unique `(recurring_ride_id, pickup_at)` |

## Wallets and ledger
Balances are **derived**: `SELECT bucket, SUM(amount) FROM wallet_transactions WHERE wallet_id = $1 GROUP BY bucket`.
System wallets: `PLATFORM_REVENUE`, `PLATFORM_CASH_CLEARING`, `PAYMENT_GATEWAY`, `PROMOTIONS`.

| Event | Entries (debit − / credit +) |
|---|---|
| Wallet top-up via card | gateway −X, passenger +X |
| Ride paid from wallet (fare F, fee f) | passenger −F, driver(PENDING) +(F−f), revenue +f |
| Ride paid in cash | driver −f (commission owed), revenue +f. The cash itself never enters the platform. |
| Ride paid by card | gateway −F, driver(PENDING) +(F−f), revenue +f |
| Promo discount D on a ride | promotions −D, driver +D (the driver is paid the undiscounted fare) |
| Pending → available (settlement worker, T+1 default) | driver PENDING −X, driver AVAILABLE +X |
| Withdrawal requested / paid | driver −X, clearing +X / clearing −X, gateway +X |
| Corporate ride | corporate −F, driver(PENDING) +(F−f), revenue +f |

## Geospatial queries
- Service check: `ST_Covers(service_areas.boundary, point)`.
- Zone of a point: `ST_Covers(demand_zones.boundary, point)` (GiST).
- Places nearby / search ranking: trigram similarity × distance decay.
- Live driver proximity is **Redis GEO** (write-heavy, ephemeral). Postgres is the system of record for trips.
- Route deviation: distance from the GPS point to `rides.expected_route` (linestring). This is computed in the app for
  the live stream (cheap, no DB round-trip) and persisted with the event. `ST_Distance` is used for audits.

## Retention (privacy)
| Data | Retention | Job |
|---|---|---|
| `ride_locations` | 90 days (config `LOCATION_RETENTION_DAYS`), then deleted | `retention` worker, daily |
| `otp_codes` | 1 day | `retention` worker |
| `ride_quotes` | 7 days | `retention` worker |
| Deleted accounts | PII nulled/anonymized immediately. Financial and ride records are kept for accounting with the user reference anonymized. | `DELETE /me` |
| `mobility_profiles` | Until the user disables or deletes personalization | `DELETE /me/personalization` |

## Scaling notes
Partition `ride_locations`, `ride_events` and `ai_predictions` by month when they pass ~50M rows. The analytics
endpoints read the primary until a replica exists (`DATABASE_READ_URL` is supported by the DB module).
