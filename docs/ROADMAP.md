# Development Roadmap

| Phase | Scope | Exit criteria |
|---|---|---|
| 1 Inspection | Environment and repository review | Decision to start fresh (done) |
| 2 Architecture | Docs in `/docs` | Reviewed docs committed |
| 3 Database | SQL migrations, migrator, seed | Migrations apply on a clean DB. Integrity tests pass. |
| 4 Auth | Password, OTP, OAuth ID token, rotation, RBAC | Auth e2e tests pass |
| 5 Passenger app | Flutter passenger app on raasta_core | `flutter analyze` clean. Widget tests pass. Web build renders. |
| 6 Driver app | Flutter driver app | same |
| 7 Ride engine | quotes, pricing, matching, lifecycle, cancellation, ratings | Ride-flow e2e passes |
| 8 Real-time | Socket.IO gateway, Redis adapter, resync | Socket e2e passes |
| 9 Admin | React dashboard + corporate portal | Build + tests pass. Screens reviewed. |
| 10 AI services | FastAPI predictors, NLU, pipeline, registry | pytest passes. Backend fallback verified. |
| 11 Safety | deviation, stops, SOS, share links | Safety e2e passes |
| 12 Payments | providers, ledger, wallets, promos, referrals | Ledger tests pass |
| 13 Corporate/recurring/carpool/intercity | | e2e for each |
| 14 Testing | full suites | All green, results recorded |
| 15 Optimization | query plans, indexes, bundle size | measured |
| 16 Documentation | README, report | complete |
| 17 Production-style local run | docker compose / dev-up | full flow runs locally |

## After this build (recommended next phases)
1. Real integrations: SMS aggregator (OTP), FCM push, S3 storage, JazzCash/Easypaisa + card gateway, self-hosted OSRM with the Pakistan extract.
2. Pilot in one city (Lahore) with a small driver cohort to collect real data. Keep the baselines until models beat them on real holdouts.
3. Security: external penetration test, KMS-backed encryption keys, WAF.
4. Mobile: native maps SDK evaluation, background location service for drivers, offline map tiles.
5. Office shuttle product (B2B) on top of recurring + carpool grouping.
6. Delivery as a separate bounded context (see FINAL_PROJECT_REPORT.md).
