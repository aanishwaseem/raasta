# External services

Everything below sits behind an interface, has a local development implementation, and is chosen by environment variable.
Nothing in this table is faked in production: with `NODE_ENV=production` the API **refuses to start** if a development
provider is still selected (`SMS_PROVIDER=console`, `PAYMENT_PROVIDER=mock`) or a chosen provider lacks credentials.

| Capability | Interface (code) | Development provider | Real providers in the repo | Env vars | What you must obtain |
|---|---|---|---|---|---|
| SMS / OTP | `SmsProvider` (`common/providers/messaging.ts`) | `console` (logs, keeps an in-memory outbox) | `twilio`, `http` (`common/providers/sms.providers.ts`) | `SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `SMS_HTTP_URL`, `SMS_HTTP_AUTH`, `SMS_SENDER_ID` | A Twilio account, or an account with a Pakistani aggregator (Jazz/Telenor business SMS, Eocean, etc.). For the `http` provider, adjust the payload in `HttpSmsProvider` if the vendor's API differs. Register a sender ID with PTA-approved routes. |
| Push notifications | `PushProvider` | `console` (the in-app notification centre still works) | `fcm` (`common/providers/fcm.provider.ts`, HTTP v1) | `PUSH_PROVIDER`, `FCM_SERVICE_ACCOUNT_JSON` | A Firebase project and service account. Mobile apps additionally need `firebase_messaging` plus `google-services.json` / `GoogleService-Info.plist`, then call `POST /me/devices {platform, token}` after sign-in. Until then push is delivered server-side only; the apps show notifications through the in-app centre and realtime events. |
| Google sign-in | `AuthService.verifyIdToken` (JWKS verification) | none: returns 501 `PROVIDER_NOT_CONFIGURED` | Google ID tokens | `GOOGLE_CLIENT_IDS` | OAuth client IDs (web/Android/iOS). The mobile apps still need the `google_sign_in` plugin wired to `POST /auth/oauth`. |
| Apple sign-in | same | same | Apple ID tokens | `APPLE_CLIENT_IDS` | Apple Developer account, Services ID / bundle ID. Required by App Store rules if any other social login is offered on iOS. |
| Payments | `PaymentProvider` (`modules/payments/payment-provider.ts`) | `mock` (approves `tok_visa`, declines `tok_declined`) | `stripe` (stub for PaymentIntents) | `PAYMENT_PROVIDER`, `STRIPE_SECRET_KEY` | A merchant account. For Pakistan add a `PaymentProvider` for JazzCash / Easypaisa / a local card acquirer (same interface). Card data never touches this API: only provider tokens. |
| Routing / ETA | `RoutingProvider` | `haversine` (street-grid approximation) | `osrm` | `ROUTING_PROVIDER`, `OSRM_URL` | A self-hosted OSRM with the Pakistan OSM extract (or swap in a commercial directions API). Without it, distances and ETAs are approximations. |
| Places search | `GeoService.searchPlaces` | `local` (seeded places table) | `nominatim` | `PLACES_PROVIDER`, `NOMINATIM_URL` | Own Nominatim instance (the public one forbids production use) or a commercial geocoder. |
| Document storage | `StorageProvider` | local disk (`STORAGE_DIR`) | none yet | `STORAGE_DIR` | S3-compatible bucket and an `S3Storage` implementation (documents are encrypted references; the interface is already used everywhere). |
| Identity verification (CNIC) | admin document review | human review in the admin dashboard | none | n/a | NADRA/third-party verification API if wanted; today approval is a person looking at the documents. |
| LLM assistant | AI service `nlu/llm.py` | rule-based NLU for English, Urdu and Roman Urdu | Anthropic API | `ANTHROPIC_API_KEY` (AI service) | An API key. Optional: the rule-based parser handles the booking grammar and always asks for confirmation. |
| Map tiles (apps) | `raasta_core` map widget | OpenStreetMap tiles (not for production load) | any XYZ tile server | build-time define | A tile provider / self-hosted tiles. |
| Error tracking | none | stdout JSON logs | n/a | n/a | Sentry or similar: add its SDK in `main.ts`; logs are already JSON in production (`LOG_FORMAT`). |

## Sending a test message

```bash
# Twilio
SMS_PROVIDER=twilio TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=... TWILIO_FROM=+1555... npm run dev
curl -X POST localhost:3000/api/v1/auth/otp/request -H 'content-type: application/json' -d '{"phone":"+92300XXXXXXX"}'
```

Notification (push/SMS) failures are logged and never block the ride flow. An OTP request fails with an error if the SMS cannot be sent, so users are not left waiting for a code that will not arrive.
Unit tests for all providers run with the network mocked (`src/common/providers/providers.spec.ts`).
