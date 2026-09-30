# System Architecture

## 1. Shape of the system

```
 Passenger app (Flutter) ─┐
 Driver app (Flutter) ────┤  HTTPS /api/v1 (REST, OpenAPI)      ┌──────────────────────────────┐
 Admin + Corporate (React)┤  WSS /realtime (Socket.IO)  ───────▶│  Raasta API (NestJS)          │
 Public tracking page ────┘                                     │  modular monolith             │
                                                                 │  ┌────────────────────────┐   │
                                                                 │  │ Gateway concerns:       │   │
                                                                 │  │ auth, RBAC, throttling, │   │
                                                                 │  │ validation, request id, │   │
                                                                 │  │ idempotency, audit      │   │
                                                                 │  └────────────────────────┘   │
                                                                 │  Domain modules (below)       │
                                                                 │  Mobility engine:             │
                                                                 │   matching · pricing · eta ·  │
                                                                 │   safety · carpool · demand   │
                                                                 │  Workers (BullMQ): offer      │
                                                                 │   timeouts, scheduler,        │
                                                                 │   aggregation, retention      │
                                                                 └───┬──────────┬──────────┬─────┘
                                                                     │          │          │ HTTP (timeouts + fallback)
                                                          PostgreSQL 16│   Redis 7 │          ▼
                                                          + PostGIS    │  geo, locks│   AI service (FastAPI)
                                                                     │  queues,    │   ETA · demand · cancellation
                                                                     │  rate limit │   · matching rank · fraud
                                                                     │  pub/sub    │   · NLU (rules / optional LLM)
                                                                     ▼             ▼   · training pipeline + registry
                                                  External providers (all behind interfaces):
                                                  Routing (OSRM | dev haversine) · Places (local gazetteer | Nominatim)
                                                  Payments (Mock | Stripe-ready | local gateway) · SMS · Email · Push · Storage · LLM
```

The first version is a **modular monolith**: one deployable API with strict module boundaries,
plus a separately deployed Python AI service. It is split this way because the AI service has a different
runtime (Python/scikit-learn), a different scaling profile, and a different release cadence. Nothing else is split yet.
Microservices are not used for their own sake.

## 2. Backend modules (`backend/src/modules`)

| Module | Owns | Talks to |
|---|---|---|
| `auth` | credentials, OTP, OAuth ID tokens, sessions, refresh rotation | users, notifications(SMS) |
| `users` | profile, saved places, emergency contacts, preferences, consents, export/deletion | – |
| `drivers` | driver profile, onboarding state machine, documents, presence, stats, copilot, earnings | vehicles, storage, ai |
| `vehicles` | vehicles, classes | – |
| `geo` | cities, service areas, demand zones, places search, routing provider | – |
| `pricing` | pricing configs, quotes, fare intelligence, promotions application | geo, ai, promotions |
| `rides` | ride lifecycle state machine, ride events, PIN, cancellation, ratings | matching, payments, safety, realtime |
| `matching` | candidate search (Redis GEO), ranking (AI + local fallback), offers, assignment locks | drivers, ai, realtime |
| `carpool` | shared-ride compatibility and grouping | geo, rides |
| `scheduling` | scheduled rides, recurring commutes, dispatcher | rides, ai |
| `safety` | location-stream anomaly detection, SOS, share links, trusted contact notifications | notifications |
| `payments` | PaymentProvider interface, payments, ledger wallets, top-ups, withdrawals | – |
| `promotions` | promo/referral codes, redemptions | payments (credits) |
| `business` | corporate accounts, employees, policies, budgets, invoices | rides |
| `intercity` | configurable city pairs, driver-posted trips, seat bookings | geo |
| `support` | tickets, messages | – |
| `notifications` | persisted notifications, push/SMS/email providers | realtime |
| `realtime` | Socket.IO gateway, rooms, event bus → sockets | – |
| `ai` | AI service client, prediction logging, mobility profile, routine detection, assistant | ai-service |
| `fraud` | deterministic risk rules, fraud events, review | ai |
| `analytics` | KPIs, cancellation hotspots, AI monitoring, ops metrics | read-only |
| `admin` | admin-only endpoints composing other modules and writing audit logs | all |

Rules:
- A module exposes a service class. Other modules call that service, never another module's tables directly
  (read-only analytics queries are the documented exception).
- Cross-module side effects go through the in-process **domain event bus** (`EventBus`), for example
  `ride.completed` → payments, ratings prompt, stats refresh, safety close, AI actuals logging.
  Swapping the bus for Redis Streams/Kafka is the first step toward extracting services.

## 3. Ride state machine

```
            ┌──────────────┐ dispatch  ┌───────────┐
 schedule ─▶│  SCHEDULED   │──────────▶│ MATCHING  │◀─────────────── driver cancels (re-match)
            └──────┬───────┘           └─────┬─────┘
 request ─────────────────────────────▶      │ accept (atomic)         no candidates / timeout
                   │ cancel                  ▼                                   │
                   │                 ┌────────────────┐                          ▼
                   │                 │DRIVER_ASSIGNED │                    ┌───────────┐
                   │                 └──────┬─────────┘                    │NO_DRIVERS │
                   │                        │ first location ping          └───────────┘
                   │                        ▼
                   │                 ┌────────────────┐
                   │                 │DRIVER_ARRIVING │
                   │                 └──────┬─────────┘
                   │                        │ arrived (≤ geofence)
                   │                        ▼
                   │                 ┌────────────────┐
                   │                 │DRIVER_ARRIVED  │
                   │                 └──────┬─────────┘
                   │                        │ correct PIN
                   │                        ▼
                   │                 ┌────────────────┐        ┌───────────┐
                   │                 │  IN_PROGRESS   │───────▶│ COMPLETED │──▶ payment ──▶ ratings
                   │                 └────────────────┘        └───────────┘
                   ▼
            ┌──────────────┐  (from any pre-IN_PROGRESS state by passenger/system/admin)
            │  CANCELLED   │
            └──────────────┘
```

Transitions are implemented in one place (`rides/ride-state.ts`) as a table of
`from → to` with the allowed actor. Every transition is a conditional `UPDATE … WHERE status = $from`
(optimistic concurrency) and writes a `ride_events` row in the same transaction.

## 4. Matching sequence

1. `POST /rides` validates the quote (not expired, belongs to user), applies promo, enforces
   **one active ride per passenger** (partial unique index) and **Idempotency-Key**.
2. Ride → `MATCHING`; a `match` job is queued (BullMQ).
3. Candidate search: `GEOSEARCH drivers:geo:{city}` in expanding radii (config: 2 → 4 → 7 km),
   filtered by presence (`online`, not busy), approved status, vehicle class, declined-list, and
   carpool capacity.
4. Features per candidate (distance, pickup ETA, acceptance/completion/cancellation rates from
   `driver_stats`, rating, preferences, route compatibility) → AI service `/v1/matching/rank`
   (explainable weighted score; the cancellation probability comes from the cancellation model).
   On timeout or error, the **local TypeScript implementation of the same scoring** is used and
   `fallback_used=true` is logged.
5. Offer to the best driver (`ride_requests` row, `ride.offer` socket event) with an expiry job
   (default 15 s). Decline/expiry → next candidate. After the list is exhausted, expand the radius. After the last radius
   → `NO_DRIVERS`.
6. Accept: Redis lock `lock:ride:{id}` + conditional DB update → `DRIVER_ASSIGNED`, 4-digit PIN,
   `ride.driver_assigned` to passenger with driver/vehicle/badges and predicted pickup ETA
   (stored in `ai_predictions` for later error measurement).

## 5. Real-time

Socket.IO namespace `/realtime`. JWT in `auth.token` at handshake. Rooms: `user:{id}`,
`ride:{id}` (joined after an authorization check), `ops` (admin/support). Redis adapter for multi-node.

Server → client events: `ride.requested, ride.matching, ride.offer, ride.offer_expired,
ride.driver_assigned, ride.driver_arriving, ride.driver_arrived, ride.started,
ride.location_updated, ride.route_deviation, ride.completed, ride.cancelled, ride.no_drivers,
driver.online, driver.offline, driver.location_updated (ops only), safety.alert,
payment.updated, notification`.

Client → server: `driver.location` {lat,lng,heading,speed,accuracy,ts} (REST fallback
`POST /driver/location`), `ride.subscribe` {rideId} (resync: the server replies with the current ride
snapshot, so a reconnecting client never depends on missed events).

Location ingestion path: driver ping → validate (accuracy, implied-speed plausibility) →
`GEOADD` + presence hash (TTL 60 s, so stale drivers drop out of matching) → if on a ride: persist
`ride_locations` (every ping during IN_PROGRESS, throttled to one per 5 s otherwise), emit to the ride room,
and run the safety checks.

## 6. Scaling path

| Users | Change |
|---|---|
| 10–1k | Single API + AI service + Postgres + Redis (docker compose) |
| 10k | 2+ API replicas behind LB (stateless; sockets via Redis adapter), managed Postgres with read replica for analytics, BullMQ workers split into their own process (`WORKER_MODE`) |
| 100k | Extract **location ingestion + realtime** (highest write rate), partition `ride_locations` by month, move event bus to Redis Streams/Kafka, H3 indexing for demand, pgbouncer |
| 1M+ | Extract matching per city (city is the natural shard key), dedicated OSRM cluster, feature store for ML |

Design choices that keep this open: city-scoped Redis keys, UUID primary keys, event log
(`ride_events`), idempotent handlers, and no in-memory state that must survive a restart (offers and
schedules live in BullMQ/Redis/Postgres).

## 7. Provider abstractions (dev vs production)

| Interface | Dev implementation (default) | Production implementation |
|---|---|---|
| `RoutingProvider` | `HaversineRoutingProvider`: great-circle × road factor, synthesized polyline, speed by hour. **Not real roads.** | `OsrmRoutingProvider` (implemented; set `ROUTING_PROVIDER=osrm`, `OSRM_URL`) |
| `PlacesProvider` | Local gazetteer table `places` (seeded Pakistani landmarks, English + Urdu aliases, trigram search) | Same table enriched by imports; `NominatimPlacesProvider` implemented as optional |
| `PaymentProvider` | `MockPaymentProvider` (deterministic; test card numbers that fail) + `CashProvider` + `WalletProvider` | `StripePaymentProvider` skeleton requires keys; local gateways (JazzCash/Easypaisa) not implemented |
| `SmsProvider` / `EmailProvider` / `PushProvider` | Console/log providers (OTP printed to server log in dev only) | Twilio/local SMS aggregator, SES, FCM: **not implemented** |
| `StorageProvider` | Local disk (`STORAGE_DIR`) with signed download URLs | S3-compatible: **not implemented** |
| `LlmProvider` (AI service) | none: rule-based NLU | Anthropic Claude when `ANTHROPIC_API_KEY` is set (falls back to rules) |
| Identity verification (CNIC/NADRA) | Manual admin review workflow | External KYC provider: **not implemented** |
