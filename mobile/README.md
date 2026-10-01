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

## Not done yet (be aware before shipping)
- **No real GPS.** The passenger pickup defaults to Liberty Market, Lahore, and the driver app uses `SimulatedLocation`
  (`driver_app/lib/location.dart`). Implement `LocationSource` with `geolocator` and add permission prompts.
- **No map.** No map SDK or API key is configured; trips are shown as text, not on a map.
- **Polling, not realtime.** Trip and offer screens poll every 3s. The API has a Socket.IO channel that is not used yet.
- No phone OTP, Google/Apple sign-in, wallet screens, scheduled rides, safety/SOS, assistant, or driver onboarding in the apps (the API supports them).
- No push notifications. Urdu localisation is not implemented.
- Never run on a device or emulator in this environment; verified only by analyzer, widget tests with a mocked API, and the live API contract test above.
