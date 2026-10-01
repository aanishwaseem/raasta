# Raasta

Ride-hailing platform for Pakistan: passenger and driver apps, a NestJS API, a Python AI service, and a React admin dashboard.

| Part | Path | Status |
|---|---|---|
| API + workers (NestJS, Postgres/PostGIS, Redis) | `backend/` | Built; unit and e2e tests pass |
| AI service (FastAPI: ETA, demand, fraud, assistant, training pipeline) | `ai-service/` | Built; pytest passes |
| Admin dashboard (React + Vite) | `admin/` | Built; typechecks, builds, verified against the live API |
| Passenger and driver apps (Flutter) | `mobile/` | Core flows only (no GPS, map or realtime); see `mobile/README.md` |
| Docker compose, `.env.example` | repo root | Compose file validates; images not built here (no Docker daemon in the build sandbox) |

Architecture, API, security, testing and roadmap docs are in `docs/`.

## Run it

**Docker** (everything):
```bash
cp .env.example .env
docker compose up --build
docker compose exec api npm run db:seed   # clearly marked test data
```
API `http://localhost:3000/api/v1` (Swagger at `/api/docs`), admin `http://localhost:5173`, AI service `http://localhost:8000`.

**Native** (Postgres 16 + PostGIS and Redis running locally):
```bash
cd backend && npm ci && npm run db:migrate && npm run db:seed && npm run dev
cd admin   && npm ci && npm run dev
cd ai-service && pip install -r requirements.txt && uvicorn app.main:app --port 8000
```

Seeded staff login: `admin@raasta.test` / `Passw0rd!test` (development data only).

## Tests
```bash
cd backend && npm test && npm run test:e2e
cd ai-service && pytest
cd admin && npm run build
cd mobile/raasta_core && flutter test   # plus passenger_app and driver_app
```

## Known limitations
- Payments use a mock provider; Stripe is a stub.
- Documents are stored on local disk; the S3 provider is not implemented.
- Routing defaults to straight-line (haversine); use OSRM for real road distances.
- AI model metrics were measured on simulated data, not real trips.
- The admin live map is a plain SVG projection, not a tile map.
