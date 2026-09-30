# Deployment

## Local (one command)
```bash
cp .env.example .env
docker compose up --build        # postgres+postgis, redis, api, worker, ai-service, admin
docker compose exec api npm run db:seed   # development/test data (clearly marked)
```
| Service | URL |
|---|---|
| API | http://localhost:3000/api/v1 (Swagger at /api/docs) |
| Admin | http://localhost:5173 |
| AI service | http://localhost:8000 (internal) |
| Postgres | localhost:5432 |
| Redis | localhost:6379 |

Without Docker, `scripts/dev-up.sh` starts the services natively. It expects local Postgres 16 + PostGIS 3 and Redis 7.

Mobile apps: `cd mobile/passenger_app && flutter run --dart-define=API_URL=http://10.0.2.2:3000` (Android emulator),
or `flutter run -d chrome` for a web preview.

## Processes
| Process | Command | Scale |
|---|---|---|
| `api` | `node dist/main.js` (`WORKER_MODE=false`) | horizontal, stateless |
| `worker` | `node dist/worker.js` (BullMQ: matching offers, scheduler, aggregation, retention, settlement) | 1+ (jobs are idempotent) |
| `ai-service` | `uvicorn app.main:app` | horizontal |
| `admin` | static files (nginx / CDN) | CDN |

In development the API runs the workers in-process (`RUN_WORKERS_IN_API=true`).

## Production reference (single region, Pakistan-near)
- Managed Postgres 16 with PostGIS (AWS RDS / Azure Flexible / GCP Cloud SQL) with PITR backups, and a read replica for analytics.
- Managed Redis with persistence (queues).
- Container platform (ECS/Kubernetes). Minimum 2 API replicas behind an HTTPS load balancer with WebSocket support and sticky
  sessions **not** required (Socket.IO Redis adapter + websocket-only transport).
- Object storage (S3-compatible) for documents. **The S3 provider must be implemented first** (see known limitations).
- Self-hosted OSRM with the Pakistan OSM extract for routing (`ROUTING_PROVIDER=osrm`).
- Secrets from the platform secret manager. TLS termination at the LB, with HSTS.
- Observability: ship JSON logs to your log stack, scrape `/metrics` with Prometheus, and alert on
  `raasta_ride_match_latency_seconds` p95, `raasta_payment_failures_total`, `raasta_ai_fallback_total` rate, and 5xx rate.

## Migrations
`npm run db:migrate` runs as a one-off job before new API pods start. Migrations are forward-only and written to be
backward compatible with the previous release (expand → migrate → contract).

## Environment variables
See `.env.example` for the authoritative list with descriptions. Production start-up validation rejects default secrets.
