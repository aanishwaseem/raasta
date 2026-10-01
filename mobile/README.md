# Raasta mobile

Flutter 3.47 / Dart 3.13. Three packages:

| Package | What it is |
|---|---|
| `raasta_core` | API client (bearer auth, single-flight token refresh, idempotency keys), session store, theme, shared login screen |
| `passenger_app` | Sign in, place search, fare options, request, live trip status, cancel, rate, ride history |
| `driver_app` | Sign in, go online/offline, incoming offer (accept/decline), trip steps (arrived, PIN, complete), earnings |

## Run
```bash
cd mobile/passenger_app && flutter run --dart-define=API_URL=http://10.0.2.2:3000/api/v1   # Android emulator
cd mobile/driver_app    && flutter run --dart-define=API_URL=http://10.0.2.2:3000/api/v1
```
Seeded logins (development data): passenger `bilal@raasta.test`, driver `usman@raasta.test`, password `Passw0rd!test`.

## Tests
```bash
cd mobile/raasta_core && flutter test                                   # client unit tests
RAASTA_LIVE_API=http://localhost:3000/api/v1 flutter test test/live_api_test.dart   # full ride against a seeded API
cd mobile/passenger_app && flutter test && cd ../driver_app && flutter test         # widget tests
flutter analyze
```

## What the apps do now
- **Passenger:** sign in or create an account; pickup from device GPS (reverse-geocoded), place search, map with route, fare options, request, live trip with driver position, PIN, cancel, share trip link, SOS, rating; wallet (balance, test-card top-up, transactions); trusted contacts; ride history.
- **Driver:** sign in or create an account; onboarding checklist from the API (identity, vehicle, six document uploads, submit); code of conduct; go online with GPS pings every 5s; incoming offers; trip steps (arrived, PIN, complete) with map; earnings and withdrawal requests.
- Both: token refresh, idempotency keys on money and ride requests, friendly error copy, OpenStreetMap tiles (no key).

## Verified how
`flutter analyze` and widget tests (mocked API) pass, the live-API contract test passes, and `e2e/full-ride.mjs` drives the real web builds plus the admin dashboard through a complete ride in headless Chromium (see `e2e/README.md`). The E2E run found and fixed two real bugs (a disabled Submit button and a disabled Start-trip button).

## Not done yet (be aware before shipping)
- **Never run on a physical device or Android/iOS emulator** from this environment. Android and iOS location permissions are declared, but only the web builds were exercised.
- **Android allows cleartext HTTP** (`usesCleartextTraffic`) so the dev API works. Remove it and use HTTPS for production.
- **Polling, not realtime.** Trip and offer screens poll every 3s (driver position and offers can lag a few seconds). The API's Socket.IO channel is not used yet.
- **Driver GPS only reports while the app is open.** No background location service, so a locked phone stops pings.
- Map tiles use the public OpenStreetMap servers, which are not meant for production traffic. Use your own tile server or a paid provider.
- **Wallet top-up uses the API's mock gateway** with a test card token. A real gateway needs its card SDK.
- Not in the apps yet (the API supports them): phone OTP and Google/Apple sign-in, scheduled and recurring rides, assistant, promo codes, corporate rides, driver document expiry reminders, push notifications. No Urdu localisation.
