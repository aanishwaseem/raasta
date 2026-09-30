# Security & Privacy Architecture

## Threat model (summary)
| Asset | Threats | Controls |
|---|---|---|
| Accounts | credential stuffing, OTP brute force, token theft | argon2id hashing, Redis-backed rate limits per IP + identifier, OTP hashed + 5 attempts + 5 min TTL, 15 min access tokens, rotating refresh tokens with reuse detection (family revoke), device session list and revoke |
| Location data | stalking, over-retention, insider access | consent record, 90-day trace retention, share links hashed + expiring + revocable, public tracking returns a minimal field set, admin access audited, location stored only while on-trip (presence is ephemeral in Redis with TTL) |
| Money | double charge, balance tampering, replay | ledger immutable + balanced (DB triggers), idempotency keys, provider abstraction, no raw card data (tokens only) |
| Driver identity docs | leakage | CNIC and licence numbers AES-256-GCM encrypted (`DATA_ENCRYPTION_KEY`), document files served only to admins through an authorized endpoint, file type and size validation |
| Rides | wrong vehicle, spoofed GPS | 4-digit ride PIN (3 attempts then lock + support), implied-speed GPS plausibility, arrival geofence |
| Platform | injection, XSS, abuse | parameterized SQL only (`pg` placeholders, no string SQL building with input), class-validator whitelist, helmet security headers, strict CORS allowlist, JSON body limit, no HTML rendering of user content in the admin (React escaping) |

## Authentication
- Email/phone + password (argon2id, memoryCost 19 MiB, t=2).
- Phone OTP: 6 digits from `crypto.randomInt`, stored as an HMAC-SHA256 hash, single use.
- Google / Apple: ID token verified with `jose` against provider JWKS, `aud` = configured client IDs. Requires real
  client IDs, so this is **implemented but untested against live providers**.
- JWT access token (HS256, `JWT_ACCESS_SECRET`, 15 min) carrying `sub`, `roles`, `sid` (session id). The refresh token is
  an opaque 256-bit random value, stored as a SHA-256 hash. Each use rotates it. Presenting an already-rotated token
  revokes the family (theft signal) and logs a security audit entry.
- Suspended or deleted users cannot refresh. Access tokens die within 15 min, and the `sid` is checked against the revoked set in Redis.

## Authorization (RBAC)
Roles: `PASSENGER, DRIVER, ADMIN, SUPPORT, CORPORATE_ADMIN`. A global `JwtAuthGuard` applies unless the route is `@Public()`, plus a
`RolesGuard` driven by `@Roles()`. Resource-level checks happen in services (a passenger can only read their own rides; a driver only
rides assigned or offered to them; corporate admins only their own account's employees and rides; SUPPORT is read-mostly).
The socket gateway enforces the same checks before joining `ride:{id}` rooms.

## CSRF / XSS
APIs use bearer tokens (not cookies), so CSRF does not apply to the API. The admin keeps tokens in memory + `sessionStorage`
(documented trade-off). A strict CSP is set for the admin static host in production deploy docs.

## Secrets
Only via environment variables. `.env.example` has placeholders. The server **refuses to start in production** if any
secret still equals a development default or is shorter than 32 chars. `.gitignore` excludes `.env*` except the example.

## Audit logging
`audit_logs` records every admin/support mutation (approve/reject/suspend, pricing change, promo change, ride cancel,
safety resolve, fraud review, wallet adjustment, AI model activation) plus security events (refresh reuse, account deletion).

## Privacy
- Consents (`LOCATION`, `PERSONALIZATION`, `MARKETING`, `TERMS`, `RECURRING_AUTO_DISPATCH`) are append-only records.
- Personalization is off-switchable, and deletion wipes `mobility_profiles` and excludes history from routine mining.
- Export (`GET /me/export`): profile, places, contacts, rides, payments, ratings given, consents.
- Account deletion: PII fields are nulled/anonymized, sessions revoked, contacts/places deleted. Financial and ride records
  are kept anonymized for legal/accounting reasons.
- Admin views show masked phone numbers (`+92 3** *** 4567`) except on the detail view, which is audited.
- Logs never contain tokens, passwords, OTPs, full CNIC or precise passenger coordinates (the pino redaction list).

## Known gaps (tracked in FINAL_PROJECT_REPORT.md)
- No WAF / bot management (deployment concern).
- No KMS integration. The encryption key comes from env, and rotation needs a re-encryption job (not implemented).
- No external NADRA/KYC verification. Documents are reviewed manually.
- Penetration testing has not been performed.
