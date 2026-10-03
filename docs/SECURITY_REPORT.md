# Raasta security review and hardening report

Scope: NestJS backend, FastAPI ai-service, React admin, Flutter apps, docker-compose, nginx images. Branch `claude/hardening`.
Method: manual code review of every controller/service on the money, identity and realtime paths, plus automated route
enumeration, plus new unit/e2e tests for each fix. **Nothing here makes the platform "unhackable".** It removes the
issues found by this review and adds regression tests; it is not a substitute for an independent penetration test.

## 1. Threat model (short)

| Actor | Goal | Main surfaces |
|---|---|---|
| Anonymous internet user | account takeover, OTP/SMS abuse, enumeration, DoS | `/auth/*`, public tracking link, `/health`, `/metrics`, websockets |
| Malicious passenger | free rides, promo/referral farming, IDOR into other rides, harassment | `/rides/*`, `/promotions`, `/payments`, `/safety`, `/scheduled-rides` |
| Malicious driver | skip PIN/steal fares, fake GPS, double withdrawals, read passenger PII | `/driver/*`, realtime `driver.location`, withdrawals |
| Tenant admin (corporate) | read/edit another company | `/corporate/*`, scheduled rides with `corporateId` |
| Compromised/curious staff | mass PII export, unaudited edits | `/admin/*` |
| Network attacker | sniff tokens, downgrade to http, MITM | mobile transport, admin SPA, nginx |
| Supply chain | vulnerable dependency, pickled model | npm, pip, `models_store` |

Trust boundaries: client -> API (JWT, roles, object ownership), API -> Postgres/Redis (parameterised SQL only), API -> ai-service
(shared internal token), API -> SMS/payment/push providers (outbound only).

## 2. Findings fixed

Severity is my judgement of impact x likelihood for a public launch. "Test" names the automated regression coverage.

### High

| # | What was wrong | Fix | Test |
|---|---|---|---|
| H1 | Ride-start PIN attempts were counted non-atomically and compared with `===`: parallel requests could exceed the 3-attempt limit and brute-force the 4-digit PIN. | Atomic counter in Redis, constant-time compare (`timingSafeEqual`), lock-out per ride. | `security-authz` "PIN brute force: parallel guesses cannot exceed three attempts" |
| H2 | Sign-in with Google/Apple trusted an unverified email claim and linked to an existing account (pre-hijack / account takeover). | Only provider-verified emails are used (`verifiedEmail`), an existing local account is never silently linked to an unverified identity. | `verified-email.spec.ts`, `security-auth` OAuth cases |
| H3 | Driver withdrawal processing could run twice concurrently (read-then-write): double payout. | `processWithdrawal` takes a row lock and re-checks status inside the transaction. | `security-auth` / wallet e2e (concurrent withdrawal) |
| H4 | Promo limits (per-user, total) were checked before and not under the lock in `reserve`: concurrent redemptions exceeded caps. | Limits re-verified under the promo row lock. | existing promo e2e + `security-auth` concurrency case |
| H5 | OTP verification attempts and consumption were not atomic: a code could be guessed in parallel beyond the attempt cap or consumed twice. | Atomic attempt counter and single-use consumption. | `security-auth` OTP cases |
| H6 | Production could boot with development secrets, `OTP_DEV_ECHO=true`, mock payments, console SMS, wildcard/localhost CORS, http base URLs. | `assertProductionSafe` refuses to start; secrets must be >= 32 chars and all distinct; TTLs bounded. | `config.spec.ts` (20 tests) |

### Medium

| # | What was wrong | Fix | Test |
|---|---|---|---|
| M1 | No password-guess lockout. | Per-account failure counter (10 / 15 min, counted for unknown identifiers too so it is not an existence oracle). Argon2id parameters pinned. | `security-auth` |
| M2 | Rate-limit counter used INCR then EXPIRE separately (a crash could leave a key with no TTL = permanent block) and phone numbers in different formats got different buckets (limit bypass). | Single Lua script; `canonicalSubject()` normalises phone/email. | `rate-limit.spec.ts`, `security-http` |
| M3 | Refresh-token reuse and unlimited active sessions per user. | Rotation with reuse detection kept; max 10 active sessions (oldest evicted); new `POST /auth/logout-all`. | `security-auth` |
| M4 | Corporate: a non-member could create a scheduled/recurring ride charged to a company account (rejected only at dispatch). | Membership is checked at creation (`POLICY_VIOLATION`). Found by the new IDOR suite. | `security-authz` "a non-member cannot book or quote against a company account" |
| M5 | Several admin write endpoints used inline bodies (no whitelist/validation); unbounded query strings and page numbers. | DTOs for every admin body; `MaxLength` on query strings; `page` capped; `ArrayMaxSize` on weekdays. | `security-http`, `security-routes` |
| M6 | Admin actions were only partly audited and `audit_logs` rows could be updated/deleted. | Global `AdminAuditInterceptor` records every staff mutation; migration 0005 makes `audit_logs` append-only (DB trigger). | `security-http` / audit case |
| M7 | `/metrics` was unauthenticated. | Requires `Authorization: Bearer $METRICS_TOKEN`. | `security-http` |
| M8 | Websocket: no per-socket event limit, no cap on ride rooms, sockets outlived their access token and revoked sessions, permissive CORS. | `SocketRateLimiter` (drop then disconnect), room cap, disconnect at token expiry, periodic revocation re-check, CORS allowlist, `maxHttpBufferSize`. | `security-realtime.e2e-spec.ts` (5), `socket-rate-limiter.spec.ts` |
| M9 | Avatar download had no ACL (any user could fetch any avatar) and upload limits were loose. | Only the owner, a ride counterpart or staff may read; size/type limits, `nosniff`, rate limit. | `security-authz` / `security-http` |
| M10 | Referral rewards had no velocity cap (self-referral farms). | Daily cap on rewarded referrals per referrer. | payments e2e |
| M11 | Expensive endpoints (support, geo, intercity, withdrawals, share-ride SMS) lacked specific throttles. | `@RateLimit` on 29 route handlers; tracking-link sharing limited. | `security-routes`, `security-authz` (share) |
| M12 | Mobile stored refresh/access tokens in plain SharedPreferences; release builds allowed cleartext http; Android allowed backup. | Keychain/Keystore (`flutter_secure_storage`) with migration; `ALLOW_INSECURE_HTTP` dart-define (default false) and `ApiClient` refuses http in release; Android `usesCleartextTraffic` only in debug (placeholder for the demo), `allowBackup=false`; iOS ATS local networking only. | `session_store_test.dart`, `transport_security_test.dart` |
| M13 | Admin and web images ran nginx as root with no security headers; compose published DB/Redis to all interfaces. | `nginx-unprivileged`, CSP, `nosniff`, frame deny, referrer policy; compose binds to 127.0.0.1, `no-new-privileges`, `cap_drop: ALL`, read-only roots; `docker-compose.prod.yml` (secrets required, internal network, no seed, Redis password, prod image target). | `docker compose config` validation only (see section 4) |

### Low / hardening

- Helmet with strict API CSP, HSTS, no `x-powered-by`, `Cache-Control: no-store` on API responses, JSON error envelope for malformed bodies and oversize payloads, sanitised/propagated `x-request-id`, no stack traces in errors (`security-http`, 17 tests).
- Public delivery tracking (`GET /public/deliveries/:code`, added by the feature work during this review and caught by the route-inventory test): now throttled per IP (30/min) with `no-store`/`no-referrer`/`noindex`. The 8-character code is the only secret and the response includes the drop-off address, so consider shortening that address or lengthening the code.
- Public tracking link: unguessable token validated by `ParseTokenPipe`, `no-store`, `no-referrer`, `noindex`.
- Admin SPA session moved from localStorage to sessionStorage (cleared on tab close).
- `.dockerignore` for backend/admin/ai-service/mobile; backend Dockerfile `prod` target (no dev deps, no sources, `NODE_ENV=production`).
- Route-enumeration test (`security-routes.e2e-spec.ts`): every route in the app must carry an explicit auth decision (public / authenticated / role-restricted) or the test fails, so a new controller cannot silently ship unauthenticated.

## 3. Verification

- Backend: `npx tsc --noEmit`, `eslint` clean; unit tests 82 passing (16 suites); full e2e 134 passing in 11 suites (new specs: `security-routes`, `security-auth`, `security-http`, `security-authz` (35), `security-realtime` (5)).
- Flutter: `flutter analyze` clean and tests passing in `raasta_core`, `passenger_app`, `driver_app`.
- Admin: `tsc --noEmit` clean (0 production vulnerabilities in `npm audit --omit=dev`).
- Secret scan of the working tree and all 38 commits of history (AWS/GCP/Stripe/Anthropic/GitHub/Slack patterns, PEM keys, keystores): no real secrets found. `.env` / `.env.*` are git-ignored; only development placeholders exist in `.env.example`/compose defaults.
- `npm audit --omit=dev`: backend 2 moderate (js-yaml via `@nestjs/swagger`, a CPU-use issue in YAML merge keys). Swagger is disabled in production and the fix is a major bump, so it is accepted for now. Admin: 0. `pip-audit` on `ai-service/requirements.txt`: no known vulnerabilities.

## 4. What is NOT covered (be aware)

- No independent penetration test, fuzzing campaign or load/DoS test was run. Rate limits were tested for correctness, not under volumetric attack.
- Docker images and compose files were validated with `docker compose config` and reviewed; I could not run full image builds/boots in this environment, so the read-only root filesystems and `cap_drop` settings in compose are untested at runtime (verify `docker compose up` once; relax per service if something needs a writable path).
- No TLS termination, WAF, DDoS protection or network policy is provided. `docker-compose.prod.yml` expects a reverse proxy in front.
- Payments use a mock provider in development; real PSP integration (Stripe webhook signature handling, 3-D Secure, PCI scope) was not reviewable.
- SMS/KYC are stubs: OTP delivery, driver document verification and phone-number ownership proof are only as strong as the eventual vendor integration.
- GPS spoofing is only mitigated by plausibility checks; a determined driver can still fake location.
- The ai-service loads models with `joblib` (pickle). Anything placed in `models_store` is executed code: treat that volume as trusted-only and sign/verify models before loading.
- Flutter web builds keep tokens in browser storage (no keystore) and are demo-only. Certificate pinning is not implemented in the mobile apps (documented below as future work).
- Dependency scanning is a point-in-time result (2026-10-02).
- Privacy review covered API responses, logs and admin audit; it is not a legal/GDPR-style compliance assessment (retention, data-subject requests beyond the existing export).

## 5. Residual risks

1. Access tokens are valid for their TTL even after logout unless the session denylist is consulted (it is, on every request and every socket re-check); a Redis outage fails closed for revocation only if configured that way - verify the failure mode in staging.
2. Single-region Postgres/Redis; the append-only audit trigger does not stop a database superuser. Ship audit logs to external write-once storage.
3. Admin accounts have no MFA yet. A phished admin password is the most damaging single event.
4. Compromise of the shared `AI_INTERNAL_TOKEN` or `METRICS_TOKEN` exposes those internal surfaces; rotate regularly.
5. CSP for the Flutter web demo must allow `wasm-unsafe-eval`/inline bootstrapping; it is weaker than the admin CSP.
6. Moderate js-yaml advisory (swagger only, disabled in production).

## 6. Recommended next steps

1. Commission an external penetration test (API authz and business logic, mobile, infra) before launch; keep `security-routes` and `security-authz` as the regression harness.
2. Put TLS termination + WAF/CDN in front (HSTS preload, rate limiting by IP at the edge, bot protection on `/auth`).
3. Move secrets to a manager (AWS Secrets Manager/Vault/SOPS) and rotate; stop using `.env` files on hosts.
4. Integrate a real SMS provider with number-ownership checks, and real KYC for drivers; add device attestation (Play Integrity / App Attest) to throttle emulator farms.
5. Add TOTP/WebAuthn MFA for ADMIN and SUPPORT roles; shorten staff session TTL.
6. Mobile: certificate/public-key pinning with a backup pin and rotation plan (future work, deliberately not added to avoid bricking apps), root/jailbreak signals, obfuscated release builds.
7. Run Dependabot/`npm audit`/`pip-audit`/image scanning (Trivy) in CI; sign and pin base images by digest.
8. Centralise logs/metrics with alerting on: login lock-outs, refresh-token reuse, PIN lock-outs, withdrawal anomalies, admin audit volume.
9. Define data retention (GPS trails, SOS media, audit logs) and DSR handling.

## 7. How to re-run

```
cd backend && npx tsc --noEmit && npx jest
TEST_DATABASE_URL=postgres://.../raasta_test npm run test:e2e   # use a private DB/redis db if another job shares the machine
export PATH=/opt/flutter/bin:$PATH; (cd mobile/raasta_core && flutter analyze && flutter test)
```
Demo-only release builds over plain http need `--dart-define=ALLOW_INSECURE_HTTP=true` and, on Android, `ORG_GRADLE_PROJECT_allowCleartext=true`.
