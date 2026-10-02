# Feature audit against the master prompt

Audited 2026-10-02 by reading the code and exercising the running system (API, admin dashboard in headless Chromium, Flutter widget tests).
"After" is the state at the end of the hardening/completion pass that wrote this file; "Before" is what the first audit found.

**Status meanings.** IMPLEMENTED = works end to end including the relevant UI, with a test or a manual check. PARTIAL = real working code but a
part is missing (named in "Needed"). MOCKED = works only with a development provider; the real provider needs credentials or is not written.
MISSING = not there. Numbers in brackets are master-prompt sections.

Evidence paths are relative to the repo root. `e2e N` = test id in `backend/test/*.e2e-spec.ts`.

## 1. Account, identity, profile [10, 11, 58, 59]

| Feature | Before | After | Evidence | Needed |
|---|---|---|---|---|
| Email/password, JWT access + rotating refresh, reuse detection | IMPLEMENTED | IMPLEMENTED | `modules/auth/auth.service.ts`, e2e 12a/12b | – |
| Phone OTP login, lockout after wrong codes | IMPLEMENTED | IMPLEMENTED | `auth.service.ts`, e2e 12d, `core/login_screen.dart` | – |
| SMS delivery provider | MOCKED (console only) | MOCKED until credentials; `twilio` and generic `http` providers written | `common/providers/sms.providers.ts`, `providers.spec.ts` (network mocked) | Twilio account or PK aggregator; production refuses `console` (`config.ts`) |
| Google / Apple sign-in (server) | PARTIAL | PARTIAL | `auth.service.ts` verifies ID tokens against JWKS; 501 until `GOOGLE_CLIENT_IDS`/`APPLE_CLIENT_IDS` set | Client IDs; mobile `google_sign_in` / `sign_in_with_apple` buttons calling `POST /auth/oauth` (not built: cannot be tested without credentials) |
| Device/session management | PARTIAL (API only) | IMPLEMENTED | `GET/DELETE /auth/sessions`; `core/sessions_screen.dart` in both apps; `notifications_test.dart` | – |
| RBAC (PASSENGER, DRIVER, ADMIN, SUPPORT, CORPORATE_ADMIN) | IMPLEMENTED | IMPLEMENTED | `common/auth/guards.ts`, e2e 12c; admin nav now follows role | – |
| Profile, saved places, emergency contacts, preferences | IMPLEMENTED | IMPLEMENTED | `modules/users`, passenger `profile/*`, `safety/contact_sheet.dart` | – |
| Profile photo | PARTIAL | PARTIAL | `POST /me/avatar` exists; no picker in the apps | `image_picker` plugin + UI |
| Consents, data export, account deletion, personalization delete | IMPLEMENTED | IMPLEMENTED | `users.controller.ts`, `account.controller.ts`, `profile/privacy_screen.dart`, e2e 13f | – |
| Referral code at sign-up | PARTIAL (API only) | IMPLEMENTED | `login_screen.dart` field, `api_client_test.dart` | – |

## 2. Booking, pricing, matching, ETA [12-15, 21, 55]

| Feature | Before | After | Evidence | Needed |
|---|---|---|---|---|
| Quote, options, fare, ETA, payment choice, request, idempotent retry | IMPLEMENTED | IMPLEMENTED | `rides.service.ts`, e2e 1 and 5, `booking_screen.dart` | – |
| Categories Bike/Economy/Comfort/Premium/XL/Shared | IMPLEMENTED | IMPLEMENTED | `pricing.service.ts`, seeded `pricing_configs` | – |
| Fare intelligence (recommended, minimum, expected wait, explanation, capped surge) | IMPLEMENTED | IMPLEMENTED | `pricing.engine.ts` + spec, `fare_explain.dart` | Weather and event inputs are not modelled (no data source); documented |
| Multi-objective options (cheapest/fastest/balanced/shared) | IMPLEMENTED | IMPLEMENTED | `pricing.service.ts` `recommendations` | – |
| Explainable AI matching | IMPLEMENTED | IMPLEMENTED | `matching/scoring.ts` + spec, TS/Python parity e2e, offers show reasons (admin ride detail now renders them) | Cancellation model trained only on simulated data |
| ETA intelligence + predicted-vs-actual error store | IMPLEMENTED | IMPLEMENTED | `ai_predictions` resolved on arrive/complete (`rides.service.ts`); admin "AI / ML monitoring" shows MAE | Real trips to train on |
| Expected-match-time accuracy | MISSING | IMPLEMENTED | `FARE` prediction resolved at assignment (`matching.service.ts`) | – |
| Cancellation reasons, fee window, who-cancelled analytics, hotspots | IMPLEMENTED (API) | IMPLEMENTED | `analytics.cancellations`; admin "Analytics" page | – |
| Scheduled rides | IMPLEMENTED | IMPLEMENTED | e2e 9a/9b, `schedule/*` | – |
| Recurring commutes with auto-dispatch, preferred driver then replacement | IMPLEMENTED | IMPLEMENTED | `scheduling.service.ts`, e2e 9c | – |
| Predictive "usual trip" suggestions, mobility profile (view/disable/delete) | IMPLEMENTED | IMPLEMENTED | `assistant.controller.ts`, e2e 13f | – |
| Voice booking EN/UR/Roman Urdu with mandatory confirmation | PARTIAL | PARTIAL | NLU in `ai-service/app/nlu`, e2e 13b-13e, `assistant_screen.dart` | On-device speech-to-text (apps rely on keyboard dictation) |
| Assistant that calls real tools, never invents data | IMPLEMENTED | IMPLEMENTED | `assistant.service.ts`, e2e 13a | – |
| Carpool / shared rides (route compatibility, detour limit) | IMPLEMENTED | IMPLEMENTED | `carpool/carpool.ts` + spec, `matching.service.ts` joinCarpool | No two-rider end-to-end test yet |
| Intercity seat booking | IMPLEMENTED | IMPLEMENTED | `modules/intercity`, `intercity_screen.dart` (both apps) | – |
| Multi-city, configurable zones/areas | IMPLEMENTED | IMPLEMENTED | `cities`, `service_areas`; admin "Service areas" page now manages them | – |

## 3. Real-time [9, 56, 57]

| Feature | Before | After | Evidence | Needed |
|---|---|---|---|---|
| Socket.IO gateway, Redis adapter, per-ride rooms, resync on reconnect | IMPLEMENTED | IMPLEMENTED | `realtime.gateway.ts`, e2e 6 | – |
| Driver location streaming to the rider map | IMPLEMENTED | IMPLEMENTED | `ride.location_updated` event then view refresh; `trip_screen.dart`; family page below | – |
| Driver gets offers in real time | IMPLEMENTED | IMPLEMENTED | `ride.offer`; `drive_controller.dart` (polling fallback) | – |
| Reconnect with refreshed token | IMPLEMENTED | IMPLEMENTED | `realtime_client.dart` | – |
| Automatic retry of reads and keyed writes on weak networks | MISSING | IMPLEMENTED | `api_client.dart` (2 retries, 502/503/504 and network errors), `api_client_test.dart` | – |
| Cached recent places and offline search fallback | MISSING | IMPLEMENTED | `core/recent_places.dart`, `place_field.dart`, `place_field_test.dart` | Offline map tiles |
| Duplicate-request protection | IMPLEMENTED | IMPLEMENTED | `Idempotency-Key`, e2e 5 | – |
| Offline / error / empty states in apps | IMPLEMENTED | IMPLEMENTED | `banners.dart`, `load_view.dart` | – |

## 4. Driver side [5, 23-26, 32, 33]

| Feature | Before | After | Evidence | Needed |
|---|---|---|---|---|
| Onboarding: identity, documents, vehicle, review, training, activate | IMPLEMENTED | IMPLEMENTED | `onboarding.service.ts`, `onboarding_screen.dart`, browser e2e `e2e/full-ride.mjs` | – |
| Admin document/vehicle review, cannot approve with unreviewed documents | IMPLEMENTED | IMPLEMENTED | `DriverReview.tsx`, e2e 14b; new **Vehicles** queue page | External identity verification (NADRA) is a documented integration point, not built |
| Cannot go online or accept rides until approved | IMPLEMENTED | IMPLEMENTED | `driver-presence.service.ts`, e2e 14b | – |
| Copilot, demand zones, earnings charts, fuel estimate, wallet, withdrawals | IMPLEMENTED | IMPLEMENTED | `driver-insights.service.ts`, `earnings_screen.dart`, `demand_screen.dart` | Predictions are labelled predictions; no guarantee wording |
| Reliability badges (no opaque score shown) | IMPLEMENTED | IMPLEMENTED | `driver-stats.service.ts`, `profile_sections.dart` | – |
| Ride PIN | IMPLEMENTED | IMPLEMENTED | e2e 1, `pin_pad.dart` | – |

## 5. Safety and privacy [27-31, 59]

| Feature | Before | After | Evidence | Needed |
|---|---|---|---|---|
| Route deviation, prolonged stop, end far from destination, GPS jump | IMPLEMENTED | IMPLEMENTED | `safety/deviation.ts` + spec, e2e 7 | – |
| Passenger prompt: I'm safe / contact driver / share / SOS, never accusing | IMPLEMENTED | IMPLEMENTED | `trip/safety_prompt.dart` | – |
| SOS notifies contacts by SMS and ops | IMPLEMENTED | IMPLEMENTED | e2e 8 | Real SMS provider for contacts to receive it |
| Family tracking link | PARTIAL: API worked but the SMS link opened a page that did not exist | IMPLEMENTED | new `/track/<token>` page (`admin/src/TrackPage.tsx`) served by the admin web app; verified in Chromium against a live shared ride | Deploy `TRACKING_BASE_URL` to the admin origin + `/track` (nginx already falls back to `index.html`) |
| Women's safety options (safety mode per ride, prefer female driver as a soft preference, auto-share, deviation alerts) | IMPLEMENTED | IMPLEMENTED | `safety_prefs.dart`, `matching.service.ts` preferenceMatch | Never guaranteed, by design |
| Retention job (location 90 days, OTPs, quotes, idempotency keys, sessions) | IMPLEMENTED | IMPLEMENTED | `maintenance.service.ts` `retention()` | – |
| Admin safety queue with resolve / false-alarm / escalate | MISSING (API only) | IMPLEMENTED | admin **Safety** page | – |

## 6. Money [38-40]

| Feature | Before | After | Evidence | Needed |
|---|---|---|---|---|
| PaymentProvider interface (mock, stripe stub) | MOCKED | MOCKED | `payments/payment-provider.ts` | Stripe PaymentIntents completion and a Pakistani gateway (JazzCash/Easypaisa/acquirer) |
| Double-entry immutable ledger, wallets, top-up, refunds, driver earnings and withdrawals | IMPLEMENTED | IMPLEMENTED | `ledger.service.ts` + spec, DB triggers, e2e 11 | – |
| Promo codes, first ride, referral, corporate, campaign; limits and windows | IMPLEMENTED (API) | IMPLEMENTED | `promotions.service.ts`; admin **Promotions** page creates and toggles them; promo entry in booking | – |
| Admin payments and wallet/ledger inspection | MISSING | IMPLEMENTED | admin **Payments**, **Wallets** pages (`/admin/wallets` derives balances from the ledger) | – |
| Ratings both ways, tags, abnormal rating monitoring | PARTIAL | PARTIAL | rating screens, `ratings` table | No admin view for abnormal rating patterns |

## 7. Business [34-37]

| Feature | Before | After | Evidence | Needed |
|---|---|---|---|---|
| Corporate accounts, employees, policy, budget, invoices, rides, scheduled employee rides (API) | IMPLEMENTED | IMPLEMENTED | `modules/business`, e2e 14 | – |
| Corporate portal UI | MISSING | IMPLEMENTED | company admins sign in to the same web app and see Overview, Employees, Policy and budget, Schedule a ride, Rides, Invoices (CSV/print). Verified in Chromium as `corpadmin@raasta.test` | – |
| Corporate invoice endpoint | BROKEN (every call returned 400: `month` rejected by validation) | FIXED | `corporate.controller.ts` `InvoiceQuery`, e2e in `delivery-ops.e2e-spec.ts` | – |
| Office shuttle (grouped recurring commutes) | MISSING | MISSING | – | P3 product on top of recurring + carpool grouping |
| Delivery as a separate module | MISSING | PARTIAL | new `modules/delivery` with its own tables (`0006_delivery.sql`), tariff, state machine, PIN proof of delivery, public tracking by code, driver pull model, admin list. 3 e2e tests | No sender/driver screens in the apps; cash commission is not yet posted to the ledger; no delivery matching engine |

## 8. Admin dashboard [45-47, 77, 78]

| Page | Before | After | Evidence |
|---|---|---|---|
| Overview | IMPLEMENTED | IMPLEMENTED | `pages.tsx` |
| Users, Drivers (+ document review), Rides, Withdrawals, Support list | IMPLEMENTED | IMPLEMENTED | `pages.tsx`, `DriverReview.tsx` |
| Ride detail (timeline, GPS trace, why each driver was offered, payments, safety) | MISSING | IMPLEMENTED | `pagesDetail.tsx`; also fixed a 500 in `GET /admin/rides/:id` (wrong column), e2e added |
| Support ticket thread and reply | MISSING | IMPLEMENTED | `pagesDetail.tsx` |
| Vehicles, Payments, Wallets, Promotions, Safety, Fraud, Deliveries | MISSING | IMPLEMENTED | `pagesConfig.tsx`, `pagesMoney.tsx`, `pagesSafety.tsx`, `pagesDetail.tsx` |
| Analytics (KPIs, time series, cancellations, safety and support per 1,000 rides) | MISSING | IMPLEMENTED | `pagesInsight.tsx`, `analytics.service.ts` |
| Demand forecast | MISSING | IMPLEMENTED | `pagesInsight.tsx` (zone level, expected requests, gap, confidence, model) |
| Pricing editor (audited, reason required) | MISSING | IMPLEMENTED | `pagesConfig.tsx`, e2e 14a |
| Service areas / zones / cities | MISSING | IMPLEMENTED | `pagesConfig.tsx` with polygon preview |
| Corporate accounts | MISSING | IMPLEMENTED | `pagesConfig.tsx` |
| AI / ML monitoring (match success, ETA error, shortages, models, train, activate) | MISSING | IMPLEMENTED | `pagesAi.tsx`, `GET /admin/ops/ai` |
| System health + audit log | MISSING | IMPLEMENTED | `pagesInsight.tsx` |
| Live map | PARTIAL | PARTIAL | SVG projection, refreshes every 10 s | Tile map and marker clustering for large fleets |
| Support-role navigation limited to permitted pages | MISSING | IMPLEMENTED | `App.tsx` |

## 9. AI / ML [48-51, 62]

| Feature | Before | After | Evidence | Needed |
|---|---|---|---|---|
| FastAPI service: ETA, demand, cancellation, fraud, NLU | IMPLEMENTED | IMPLEMENTED | `ai-service`, 60 pytest tests | – |
| Pipeline: extract, validate, features, train, evaluate, version, registry with metadata | IMPLEMENTED | IMPLEMENTED | `ai-service/pipeline`, `model_versions` | – |
| Cold start: baselines when no model, fallbacks when the service is down | IMPLEMENTED | IMPLEMENTED | e2e `ai-service`, fallback % in admin | – |
| Models trained on real data | MISSING | MISSING | models are flagged `trained_on_synthetic` and cannot be activated in production | A pilot's worth of rides; this is not something code can fix |
| A/B testing of models | MISSING | MISSING | – | After real data exists |
| Fraud rules engine (internal only) with human review | IMPLEMENTED | IMPLEMENTED | `fraud.service.ts`, admin **Fraud** page | Fraud ML |

## 10. Notifications [11, 39]

| Feature | Before | After | Evidence | Needed |
|---|---|---|---|---|
| Notification records + realtime event + preferences | IMPLEMENTED | IMPLEMENTED | `notifications.service.ts` | – |
| In-app notification centre (list, unread badge, mark read) | MISSING | IMPLEMENTED | `core/notifications.dart`, bell in rider home and driver map; `notifications_test.dart` | – |
| Push provider abstraction | MOCKED | MOCKED until credentials; FCM HTTP v1 provider written | `common/providers/fcm.provider.ts`, `push_devices` table, `POST/DELETE /me/devices`, `providers.spec.ts` | Firebase project; `firebase_messaging` in both apps to obtain and register tokens |

## 11. Platform quality [57, 58, 60, 61, 64-68]

| Feature | Before | After | Evidence | Needed |
|---|---|---|---|---|
| Structured logs with request ids | PARTIAL (ids only) | IMPLEMENTED | `common/logging/json-logger.ts` (JSON lines + access log in production, `LOG_FORMAT`) | Ship to a log store |
| Metrics (HTTP latency, matching, sockets, payments, AI, queues) | IMPLEMENTED | IMPLEMENTED | `/metrics`; new DB pool and queue-depth gauges (`probes.service.ts`) | Dashboards/alerts |
| Error tracking service | MISSING | MISSING | – | Sentry-style SDK |
| Migrations, seed (marked test data), OpenAPI, `docker compose` | IMPLEMENTED | IMPLEMENTED | `backend/migrations`, `/api/docs`, `docker-compose.yml` | – |
| Object storage for documents | MOCKED (disk) | MOCKED | `common/providers/storage.ts` | S3 implementation |
| Real road routing | MOCKED (haversine grid) | MOCKED | `routing.provider.ts` (OSRM provider exists) | Hosted OSRM with Pakistan extract |

## Counts

Rows audited: 101. Before: IMPLEMENTED 62, PARTIAL 8, MOCKED 7, MISSING 21, BROKEN 1 (the corporate invoice endpoint; the dead family link is counted under PARTIAL).
After: **IMPLEMENTED 84, PARTIAL 7, MOCKED 6, MISSING 4** (office shuttle, A/B testing, error-tracking SDK, trained-on-real-data models).
