#!/usr/bin/env bash
# Start native dev services (Postgres 16 cluster "main", Redis) and the built API. Idempotent.
# Requires: backend/dist built (cd backend && npm run build), DB migrated and seeded.
set -u
cd "$(dirname "$0")/.."
pg_isready -q || { pg_ctlcluster 16 main start 2>/dev/null || sudo -n pg_ctlcluster 16 main start; }
redis-cli ping >/dev/null 2>&1 || redis-server --daemonize yes >/dev/null
for i in $(seq 1 30); do pg_isready -q && break; sleep 1; done
curl -sf localhost:3000/health >/dev/null || backend/scripts/dev-api.sh | tail -1
