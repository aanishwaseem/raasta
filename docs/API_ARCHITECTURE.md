# API Architecture

- Base path **`/api/v1`**. Breaking changes go to `/api/v2`, and v1 stays for at least 6 months after that. Additive changes
  (new optional fields, new endpoints) are made in place, and clients must ignore unknown fields.
- OpenAPI 3 is generated from the code (`@nestjs/swagger`). Swagger UI is at `/api/docs` and the JSON at `/api/docs-json`
  (disabled in production unless `SWAGGER_ENABLED=true`).
- Every endpoint declares: auth requirement (`@Public()` or bearer), roles (`@Roles(...)`), request DTO
  (class-validator, whitelist + forbidNonWhitelisted), response DTO, and error responses.
- Real-time uses Socket.IO at `/realtime` (see SYSTEM_ARCHITECTURE.md §5).

## Conventions
| Topic | Rule |
|---|---|
| Auth | `Authorization: Bearer <access JWT>` (15 min). Refresh tokens (30 days) rotate on every use. Reusing a rotated token revokes the whole session family. |
| Idempotency | `Idempotency-Key: <uuid>` **required** on `POST /rides`, `POST /wallet/topups`, `POST /driver/withdrawals`, `POST /intercity/trips/:id/book`, and optional on other POSTs. Same key + same body → the stored response is replayed. Same key + a different body → `409 IDEMPOTENCY_KEY_REUSED`. |
| Geo | `{ "lat": 31.5204, "lng": 74.3587 }` (WGS84). Routes are `[[lat,lng], ...]`. |
| Money | integer PKR plus `currency: "PKR"` |
| Time | ISO-8601 UTC strings. Local display uses the city timezone. |
| Lists | `?page=1&pageSize=20` (max 100) → `{ items, page, pageSize, total }` |
| Errors | `{ "error": { "code": "RIDE_NOT_FOUND", "message": "User-safe message", "details": {...}, "requestId": "..." } }`. Raw stack traces never leave the server. |
| Request IDs | `X-Request-Id` is accepted or generated, echoed in the response, and present in every log line |
| Rate limits | Global 120 req/min per user or IP. Auth/OTP: 5/min and 10/hour per phone. `429 RATE_LIMITED` with `Retry-After`. |

Common error codes: `VALIDATION_FAILED` 400, `UNAUTHENTICATED` 401, `TOKEN_EXPIRED` 401, `FORBIDDEN` 403,
`NOT_FOUND` 404, `CONFLICT` 409, `INVALID_STATE_TRANSITION` 409, `ACTIVE_RIDE_EXISTS` 409,
`QUOTE_EXPIRED` 410, `OUT_OF_SERVICE_AREA` 422, `OFFER_TOO_LOW` 422, `POLICY_VIOLATION` 422,
`INSUFFICIENT_BALANCE` 422, `PAYMENT_FAILED` 402, `RATE_LIMITED` 429, `INTERNAL` 500.

## Endpoints

### Auth & sessions (`auth`)
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /auth/register | public | `{fullName, email?, phone?, password, role: PASSENGER\|DRIVER, referralCode?, device}` → `{user, tokens}` |
| POST | /auth/login | public | `{identifier (email or phone), password, device}` |
| POST | /auth/otp/request | public | `{phone, purpose}`. OTP goes via SmsProvider, and `devCode` is returned only when `OTP_DEV_ECHO=true` (never in production). |
| POST | /auth/otp/verify | public | `{phone, code, fullName?, role?, device}` → tokens (creates the account on first login) |
| POST | /auth/oauth | public | `{provider: GOOGLE\|APPLE, idToken, device}`. ID token verified against the provider JWKS + configured client ID. |
| POST | /auth/refresh | public | `{refreshToken}` → new pair (rotation) |
| POST | /auth/logout | bearer | revokes the current session |
| GET | /auth/sessions | bearer | device list |
| DELETE | /auth/sessions/:id | bearer | revoke a device |

### Me (`users`)
`GET/PATCH /me` · `POST /me/avatar` (multipart) · `GET/POST /me/places`, `PATCH/DELETE /me/places/:id` ·
`GET/POST /me/emergency-contacts`, `PATCH/DELETE /me/emergency-contacts/:id` · `GET/PATCH /me/preferences` ·
`POST /me/consents` · `GET /me/personalization` · `PATCH /me/personalization {enabled}` · `DELETE /me/personalization` ·
`GET /me/suggestions` (predictive booking) · `GET /me/stats` · `GET /me/notifications` · `POST /me/notifications/:id/read` ·
`GET /me/export` · `DELETE /me` `{confirm: "DELETE"}`

### Geo
`GET /cities` · `GET /places/search?q&cityId&lat&lng` · `GET /places/reverse?lat&lng` · `GET /geo/service-check?lat&lng`

### Rides (passenger)
| Method | Path | Notes |
|---|---|---|
| POST | /rides/quotes | `{pickup:{lat,lng,address}, dropoff:{...}, promoCode?, corporateId?, seats?}` → quote with per-product options, fare intelligence, multi-objective recommendations, explanations. Valid 5 min. |
| POST | /rides | `{quoteId, productCode, offeredFare?, paymentMethod, promoCode?, corporateId?, tripPurpose?, safetyMode?}` + Idempotency-Key |
| GET | /rides/active | current live ride snapshot or `null` (used for reconnect resync) |
| GET | /rides | history (paged) |
| GET | /rides/:id | detail (passenger sees PIN; driver sees passenger first name only) |
| GET | /rides/:id/events | state timeline |
| POST | /rides/:id/cancel | `{reason}`. The fee applies only after the free-cancel window, and the response states it. |
| POST | /rides/:id/rating | `{stars, tags[], comment?}` (passenger or driver) |
| GET | /rides/:id/receipt | fare breakdown and payment |
| POST | /rides/:id/share | `{emergencyContactIds?[], name?, phone?}` → `{url, expiresAt}` |
| POST | /rides/:id/sos | `{lat?, lng?}` |
| POST | /safety/events/:id/respond | `{response: SAFE \| CONTACT_DRIVER \| SHARE \| SOS}` |
| GET | /public/track/:token | **public**, limited fields, expires |

### Scheduling, recurring, carpool, intercity
`POST/GET /scheduled-rides`, `DELETE /scheduled-rides/:id` ·
`POST/GET /recurring-rides`, `PATCH/DELETE /recurring-rides/:id` ·
Shared rides use `productCode: "SHARED"` on `POST /rides`, and the ride carries a `carpool` block. ·
`GET /intercity/routes` · `GET /intercity/trips?routeId&date` · `POST /intercity/trips/:id/book` · `GET /intercity/bookings` ·
`POST /intercity/bookings/:id/cancel`

### Assistant & voice
| Method | Path | Notes |
|---|---|---|
| POST | /assistant/message | `{text, lat?, lng?}` → `{reply, intent, data, pendingAction?}`. Any state-changing intent returns `pendingAction {token, summary}` and **does nothing yet**. |
| POST | /assistant/confirm | `{token}` → executes the confirmed pending action (book / schedule / cancel) |
| POST | /voice/parse | `{transcript, locale?}` → `{language, intent, pickup, dropoff, when, productCode, missing[], confirmationText, pendingAction?}` |

### Wallet, payments, promotions
`GET /wallet` · `GET /wallet/transactions` · `POST /wallet/topups {amount, paymentMethodId}` ·
`GET/POST /payment-methods` (`{provider, token}`, **tokens only**) · `DELETE /payment-methods/:id` ·
`POST /promotions/validate {code, quoteId, productCode}`

### Driver
| Method | Path | Notes |
|---|---|---|
| GET | /driver/me | profile, onboarding checklist, vehicle, badges |
| POST | /driver/onboarding/identity | `{cnicNumber, dateOfBirth, licenseNumber, cityId, gender?}` (CNIC encrypted at rest) |
| POST | /driver/vehicles · GET /driver/vehicles | vehicle registration |
| POST | /driver/documents (multipart) · GET /driver/documents | `docType, file, documentNumber?, expiresOn?, vehicleId?` |
| POST | /driver/onboarding/submit | → PENDING_REVIEW (validates all required documents) |
| POST | /driver/onboarding/training | `{acknowledged: true}` after approval → ACTIVE |
| POST | /driver/online · /driver/offline | presence (online requires APPROVED + ACTIVE + approved vehicle) |
| POST | /driver/location | REST fallback for the `driver.location` socket event |
| GET | /driver/offers/current | pending offer (resync) |
| POST | /driver/offers/:id/accept · /decline | atomic assignment |
| GET | /driver/rides/active | active rides (more than one only when they are in the same carpool group) |
| POST | /driver/rides/:id/arrived · /start `{pin}` · /complete · /cancel `{reason}` | lifecycle |
| GET | /driver/copilot | today's stats, demand zones, recommendations (labelled predictions) |
| GET | /driver/earnings?from&to | gross, fees, fuel estimate, net, per hour/km, idle time, daily series |
| GET | /driver/demand | demand zones heat levels |
| GET | /driver/wallet · POST /driver/withdrawals | ledger-backed |
| PATCH | /driver/preferences | |
| POST/GET | /driver/intercity/trips | post seats on configured city pairs |

### Corporate (`CORPORATE_ADMIN`)
`GET /corporate/overview` · `GET/POST /corporate/employees`, `PATCH/DELETE /corporate/employees/:userId` ·
`GET/PUT /corporate/policy` · `PATCH /corporate/budget` · `GET /corporate/rides` · `GET /corporate/invoices?month=YYYY-MM` ·
`POST /corporate/scheduled-rides` (for an employee). Employees see their business profiles via `GET /me` (`corporateProfiles`).

### Support
`POST/GET /support/tickets` · `GET /support/tickets/:id` · `POST /support/tickets/:id/messages`

### Admin (`ADMIN`; `SUPPORT` where marked S)
`GET /admin/overview` · `GET /admin/users` (S) · `GET /admin/users/:id` (S) · `POST /admin/users/:id/suspend|reinstate` ·
`GET /admin/drivers` (S) · `GET /admin/drivers/:id` (S) · `POST /admin/drivers/:id/approve|reject|suspend|reinstate` ·
`POST /admin/documents/:id/review` · `GET /admin/documents/:id/file` · `POST /admin/vehicles/:id/review` ·
`GET /admin/rides` (S) · `GET /admin/rides/:id` (S) · `POST /admin/rides/:id/cancel` · `GET /admin/live-map` (S) ·
`GET /admin/payments` · `GET /admin/wallets/:id/ledger` · `GET /admin/withdrawals` · `POST /admin/withdrawals/:id/process` ·
`GET/POST /admin/promotions`, `PATCH /admin/promotions/:id` · `GET /admin/support/tickets` (S), `PATCH /admin/support/tickets/:id` (S),
`POST /admin/support/tickets/:id/messages` (S) · `GET /admin/safety/events` (S) · `POST /admin/safety/events/:id/resolve` (S) ·
`GET /admin/fraud/events` · `POST /admin/fraud/events/:id/review` · `POST /admin/fraud/scan` ·
`GET /admin/analytics/kpis` · `GET /admin/analytics/timeseries` · `GET /admin/analytics/cancellations` ·
`GET /admin/demand/forecast` · `GET /admin/pricing` · `PUT /admin/pricing/:id` · `GET/POST/PATCH /admin/cities` ·
`GET/POST/PATCH /admin/zones` · `GET/POST/PATCH /admin/service-areas` · `GET/POST/PATCH /admin/corporate-accounts` ·
`GET /admin/ai/models` · `POST /admin/ai/train` · `POST /admin/ai/models/:id/activate` · `GET /admin/ai/monitoring` ·
`GET /admin/system/health` · `GET /admin/audit-logs`

Every admin mutation writes `audit_logs` (actor, before/after, reason, request id).

### Ops
`GET /health` (liveness) · `GET /health/ready` (db + redis) · `GET /metrics` (Prometheus, requires `METRICS_TOKEN` bearer)

## AI service (internal, `ai-service`, not exposed publicly)
| Method | Path | Purpose |
|---|---|---|
| GET | /health · /metrics | |
| GET | /v1/models | active model versions and whether each uses baseline or trained |
| POST | /v1/eta/predict | batch ETA predictions |
| POST | /v1/demand/forecast | per-zone next-horizon demand + level |
| POST | /v1/cancellation/predict | per-candidate cancellation probability |
| POST | /v1/matching/rank | explainable ranked candidates |
| POST | /v1/fraud/score | risk level from signals |
| POST | /v1/nlu/parse | intent + slots (rules; optional LLM) |
| POST | /v1/training/run | runs the pipeline for the requested models (admin-triggered via backend) |

Backend → AI calls have a 400 ms default timeout (`AI_TIMEOUT_MS`). Any failure falls back to the in-process
baseline, and the fallback is logged in `ai_predictions.fallback_used` and in the `raasta_ai_fallback_total` metric.
