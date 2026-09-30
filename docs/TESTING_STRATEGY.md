# Testing Strategy

"It compiles" is not done. Each layer has its own tests, and the core ride flow is tested end to end against real
Postgres/PostGIS and Redis instances (not mocks).

| Layer | Tool | Location | What |
|---|---|---|---|
| Backend unit | Jest | `backend/src/**/*.spec.ts` | pricing engine, matching scorer (incl. the Driver A/B example), geo math (point-to-polyline, bearings), route-deviation detector, carpool compatibility, ride state machine, routine mining, ledger entry builder, fraud rules, PIN, token rotation |
| Backend integration / API | Jest + supertest + socket.io-client | `backend/test/*.e2e-spec.ts` | real HTTP against a booted Nest app, a real `raasta_test` database (migrated) and Redis db 15 |
| Database | Jest | `backend/test/db.e2e-spec.ts` | migrations apply cleanly, ledger immutability and balance triggers, one-active-ride index |
| AI service | pytest | `ai-service/tests` | each predictor's baseline and trained paths, API contracts, NLU cases (EN / Urdu / Roman Urdu), pipeline runs on a fixture, fallback when no artifacts |
| Admin | Vitest + Testing Library; `tsc --noEmit`; production build | `admin/src/**/*.test.tsx` | API client error mapping, key components |
| Mobile | `flutter analyze`, `flutter test` | `mobile/*/test` | models/serialization, repositories with a fake API, widget tests for key screens |
| UI review | Playwright screenshots | `scripts/screenshots` | admin pages + Flutter web builds rendered and inspected |

## Required end-to-end scenarios (backend `test/ride-flow.e2e-spec.ts` and friends)
1. Passenger registers → quote → request (Idempotency-Key) → driver (approved, online) receives the `ride.offer` socket event →
   accepts → passenger receives `ride.driver_assigned` → location pings → `ride.driver_arriving` → arrived → wrong PIN
   rejected → correct PIN → `ride.started` → complete → payment recorded in the ledger → both ratings submitted.
2. Passenger cancels while matching (no fee) and after the free window (fee).
3. Driver cancels after accept → ride returns to MATCHING, the driver is excluded, and another driver is offered.
4. No-driver scenario → `NO_DRIVERS` + `ride.no_drivers` event.
5. Duplicate request: same Idempotency-Key replays the same ride. A new key while active → `409 ACTIVE_RIDE_EXISTS`.
6. Network interruption: the socket disconnects mid-ride, reconnects, and `ride.subscribe` returns the current snapshot.
7. Route deviation: GPS points off the corridor → `safety_events` row + `ride.route_deviation` to the passenger → passenger responds SAFE.
8. SOS → CRITICAL event, emergency contacts notified (SMS provider log), ops room notified.
9. Scheduled ride dispatch, and a recurring commute generating occurrences with preferred-driver-first.
10. Carpool: second compatible shared request joins the group, and an incompatible one does not.
11. Wallet: top-up (mock success and a declined test token), ride paid from wallet, insufficient balance.
12. Auth: refresh rotation and reuse detection, RBAC denial, OTP attempts limit, rate limiting.
13. Voice/assistant: Roman Urdu booking → pending action → confirm creates a scheduled ride. Ambiguous input → clarification, no booking.
14. Admin: driver approval workflow, pricing update audited, live map payload.

## How to run
```bash
make test            # everything that can run locally
cd backend && npm test && npm run test:e2e
cd ai-service && pytest -q
cd admin && npm test && npm run build
cd mobile/passenger_app && flutter analyze && flutter test   # same for driver_app and packages/raasta_core
```

Results of the latest run are recorded in `docs/FINAL_PROJECT_REPORT.md`, with exact counts and no rounding up.
