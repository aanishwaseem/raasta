# Raasta: Product Requirements

> **Raasta** (راستہ, "the way") is an AI-native mobility platform for Pakistan.
> Its job is not only connecting passengers with drivers. It predicts, plans, matches, prices,
> moves and protects trips, and it explains what it does.
>
> Core value: **make transportation more predictable, personalized, safe, affordable and
> efficient using intelligent software.**
>
> Operating loop: **Predict → Plan → Match → Move → Protect → Optimize**

## 1. Users and problems

| User | Real problem today | What Raasta does about it |
|---|---|---|
| Passenger (daily commuter) | Books the same trip every day, and fares and waiting times feel random | Routine detection, recurring commutes, transparent fare ranges with expected wait |
| Passenger (safety-conscious, often women travelling alone) | Unknown route, no way to reassure family | Ride PIN, live sharing with trusted contacts, route-deviation checks that the passenger confirms |
| Passenger (price-sensitive) | Low offers go unanswered, and nobody explains why | Fare engine gives a recommended fare, a reasonable minimum, and the trade-off with expected wait |
| Driver | Idle time, fuel cost, no visibility into real net earnings | Copilot with demand forecast, net-earnings analytics, reliability feedback |
| Operations/admin | Reactive firefighting | Live ops map, demand vs supply forecasts, cancellation hotspots, safety and fraud queues |
| Corporate/university | Transport admin in spreadsheets | Corporate accounts, policies, budgets, invoices, scheduled employee rides |

Every AI feature must answer "what transport problem does this solve". Features that could not
answer this were dropped (for example "AI mood-based music", "AI chat for fun").

## 2. Feature priority

| ID | Feature | Priority | AI technique |
|---|---|---|---|
| F1 | Auth (email/password, phone OTP, Google/Apple ID token, JWT + rotating refresh, device sessions, RBAC) | P0 | – |
| F2 | Profiles, saved places, emergency contacts, settings, privacy controls | P0 | – |
| F3 | Driver onboarding, document verification workflow, vehicles | P0 | – |
| F4 | Places search, routing, maps (provider abstraction) | P0 | – |
| F5 | Ride booking: quote → request → match → PIN → trip → complete → pay → rate | P0 | – |
| F6 | Real-time (WebSocket) ride/driver/safety/payment events | P0 | – |
| F7 | Payments abstraction, ledger-based wallets, cash/wallet/card(mock) | P0 | – |
| F8 | Ratings both ways with tags | P0 | – |
| F9 | Admin dashboard (ops, users, drivers, rides, payments, promotions, support, pricing, zones) | P0 | – |
| F10 | AI ride matching (explainable weighted ranking, cancellation-probability aware) | P1 | Scoring + classical ML component |
| F11 | Fare intelligence (recommended fare, minimum reasonable, expected match time, explanation) | P1 | Rules + statistics |
| F12 | ETA intelligence layer with prediction/actual error tracking | P1 | Statistical baseline → gradient boosting |
| F13 | Predictive booking ("your usual trip?") and mobility profile with opt-out/delete | P1 | Routine mining (clustering) |
| F14 | Scheduled rides and recurring commutes with auto-dispatch (explicit consent) | P1 | Dispatch lead-time from ETA |
| F15 | Driver Copilot (stats, demand zones, recommendations phrased as predictions) | P1 | Demand forecast + rules |
| F16 | Safety engine (route deviation, prolonged stop, end-far-from-destination, GPS jump, SOS) | P1 | Geospatial + rules |
| F17 | Voice/text booking in English, Urdu, Roman Urdu, always with confirmation | P1 | Rule NLU, optional LLM |
| F18 | Mobility assistant that calls real backend tools and never invents data | P1 | NLU + deterministic tool execution |
| F19 | Multi-objective options (cheapest/fastest/balanced/shared) | P1 | Pricing + ETA |
| F20 | Carpool / shared rides with route compatibility and detour limits | P2 | Geospatial matching |
| F21 | Corporate accounts, policies, budgets, invoices | P2 | – |
| F22 | Demand prediction heatmaps | P2 | Seasonal baseline → GBM |
| F23 | Fraud and abuse risk engine (rules first, internal only) | P2 | Rules → ML later |
| F24 | Family safety: share links, trusted contacts, women's safety preferences | P2 | – |
| F25 | Intercity scheduled seat booking | P2 | – |
| F26 | Promotions, referrals | P1 | – |
| F27 | Cancellation intelligence (hotspots) | P2 | Statistics |
| F28 | Office shuttle / commute grouping | P3 | Clustering |
| F29 | Delivery | P3 (architecture only) | – |
| F30 | Additional languages, advanced personalization, multimodal | P3 | – |

## 3. Key user flows

### 3.1 Passenger on-demand ride
1. Home: "Where are you going?", with Home/Work/Recent shortcuts and "your usual trips".
2. Choose destination (places search) → **options**: Cheapest / Fastest / Balanced / Shared plus
   per-product list (Bike, Economy, Comfort, Premium, XL), each with fare range, recommended fare,
   pickup ETA and trip ETA. Short explanation of why ("demand is high near Gulberg, offering
   Rs 380 may increase waiting time").
3. Pick payment (Cash / Wallet / Card / Business) and optional promo → **Request**.
4. States, each shown explicitly: Matching → Driver found → Driver arriving (live movement) →
   Driver arrived (shows the 4-digit **Ride PIN**) → Trip in progress (live map, share, SOS) → Arrived →
   Payment → Rating.
5. Errors: no drivers (offer to retry at recommended fare / schedule), driver cancelled
   (automatic re-matching), network loss (reconnect + state resync), payment failed (fallback to cash).

### 3.2 Driver
Register → identity (CNIC) → documents → vehicle → submit for review → admin approves →
acknowledge safety/code-of-conduct training → **Go online** → receive request (large card,
countdown, pickup distance, fare, destination area) → accept → navigate → arrived → enter
passenger PIN → trip → complete → collect cash / see wallet credit → rate passenger.

### 3.3 Scheduled / recurring
Passenger defines route, days, pickup time or target arrival, and explicitly consents to
auto-dispatch. The scheduler creates occurrences and dispatches each one early enough for predicted
pickup ETA + trip ETA + buffer. The regular driver is offered first. If they are unavailable, AI matching finds a
replacement, and the passenger is notified at each step. Nothing is booked without that consent.

### 3.4 Voice booking
"Kal subah 8 baje Johar Town se Gulberg jana hai" → parsed to {pickup: Johar Town,
dropoff: Gulberg, when: tomorrow 08:00} → resolved against the places index → the app reads back
"Johar Town to Gulberg, tomorrow at 8:00 AM. Should I continue?" → **Confirm** creates a
scheduled ride. Missing or ambiguous slots produce a clarifying question, never a booking.

### 3.5 Safety anomaly
Route deviation over the corridor threshold → a `safety_event` is recorded → the passenger sees "Your ride
appears to have deviated from the expected route" with **I'm Safe / Contact Driver / Share Ride / SOS**.
The driver is never labelled as at fault. Escalation reaches the admin safety queue. SOS notifies
trusted contacts and ops.

## 4. Non-functional requirements
- Works on weak mobile networks: idempotent writes, WebSocket reconnect with state resync,
  cached recent places, and explicit offline indicators.
- Transparent pricing: no hidden surge. A surge multiplier is capped per city config, and the explanation is always returned.
- Human override: AI recommends, and people confirm. Nothing is auto-booked, auto-suspended or auto-charged
  outside an explicit user/admin action or a standing consent the user can revoke.
- Privacy: location is sensitive. Precise ride traces are retained for a limited period (default 90 days, config),
  personalization can be disabled and deleted, and accounts can be exported and deleted.
- Scale path: modular monolith → extract matching/realtime/location ingestion first
  (see SYSTEM_ARCHITECTURE.md §6).

## 5. Success metrics (computed from real data only)
Request→match conversion, time to match, pickup ETA, ETA error (MAE), cancellation rate
(by side), acceptance and completion rate, safety events per 1,000 rides, support tickets per 1,000
rides, GMV, active passengers/drivers, driver earnings/hour. Admin analytics compute all of them from
the database. Nothing is hardcoded.
