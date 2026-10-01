# Browser end-to-end test

Drives the real Flutter web builds and the admin dashboard in headless Chromium against a running, seeded API.

`full-ride.mjs` covers: a new driver signs up in the driver app, completes onboarding (identity, vehicle, six document uploads) and
submits; staff approve the documents, vehicle and driver in the admin dashboard; the driver passes the code of conduct and goes online
with browser GPS; a rider signs in to the rider app, searches a place and requests an Economy ride; the driver accepts, marks arrival,
enters the rider's PIN, and completes the trip; the script checks the ride ends `COMPLETED`.

## Run
```bash
# 1. services: Postgres + Redis + API (seeded), admin on :5173, passenger web on :8080, driver web on :8081
scripts/dev-up.sh
(cd admin && npm run build && npx vite preview --port 5173 &)
for a in passenger_app driver_app; do (cd mobile/$a && flutter build web --release --no-web-resources-cdn --dart-define=API_URL=http://localhost:3000/api/v1); done
(cd mobile/passenger_app/build/web && python3 -m http.server 8080 &)
(cd mobile/driver_app/build/web && python3 -m http.server 8081 &)
# 2. run
cd e2e && npm install && CHROME_PATH=/path/to/chrome node full-ride.mjs
```
Notes
- The API rate-limits sign-ups (10/hour per IP). If you re-run often in development, clear the keys: `redis-cli --scan --pattern '*register*' | xargs redis-cli del`.
- Flutter web only exposes an accessibility tree after it is switched on, and in that mode typing into a field that triggers a result list clears the field. So the script drives the rider's search by screen coordinates (420x900 viewport) and switches accessibility on for the later taps.
- Map tiles come from OpenStreetMap and may not load in a sandbox; the pins and route still render.
