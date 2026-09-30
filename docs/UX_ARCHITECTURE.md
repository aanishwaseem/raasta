# UX & Frontend Architecture

## Design language
- Calm, trustworthy, low-cognitive-load. One primary action per screen.
- Colour: deep teal primary `#0F766E` (trust, calm; not the green/black of incumbents), warm amber accent
  `#F59E0B` for attention, and semantic red only for safety/destructive actions. Neutral slate greys. Contrast ≥ 4.5:1 for text.
- Type: Inter (Latin) with Noto Nastaliq Urdu for Urdu strings. Base size 16, min 13 for captions.
- 8-pt spacing grid, 12–16 px radius, subtle elevation. No glassmorphism, no heavy gradients.
- Motion: 150–250 ms ease-out for sheets/state changes, and none for decoration.
- Touch targets ≥ 48 px (driver app ≥ 56 px primary actions).

## Passenger app (Flutter, `mobile/passenger_app`)
Architecture: `presentation (screens/widgets) → Riverpod providers/notifiers → repositories → raasta_core (ApiClient, RealtimeClient, models)`.

Bottom navigation: **Home · Activity · Wallet · Safety · Profile**

| Screen | Content | States |
|---|---|---|
| Onboarding / auth | phone OTP (primary), email/password, Google/Apple buttons (shown when configured) | loading, invalid code, rate-limited |
| Home | Map with pickup pin, "Where are you going?" search, Home/Work/Recent chips, "Your usual trips" (routines), upcoming scheduled rides, one smart suggestion at most | skeleton, no location permission, out of service area, offline banner |
| Search | places autocomplete, saved places, recents (cached offline) | empty, no results |
| Ride options (bottom sheet) | Cheapest / Fastest / Balanced / Shared cards with fare + ETA + reason, product list, fare slider bounded by the minimum reasonable fare with an expected-wait hint, payment picker, promo | quote expired → refresh |
| Matching | animated searching state, cancel, "increase offer" hint on long waits | no drivers → retry / schedule |
| Driver assigned / arriving | driver card (first name, photo, vehicle, plate, badges), live car marker, ETA, **PIN**, call/share/cancel | driver cancelled → re-matching banner |
| Trip in progress | live route, share trip, SOS, safety alert sheet (I'm Safe / Contact Driver / Share / SOS) | socket reconnecting banner |
| Completed | fare breakdown, payment status, rating (stars + tags + comment) | payment failed → pay with cash/wallet |
| Activity | ride history, scheduled & recurring rides | empty state |
| Wallet | balance, pending, transactions, top up (mock provider in dev) | |
| Safety | trusted contacts, safety preferences (women's safety mode), how Raasta protects you | |
| Profile | profile, saved places, personalization (view / disable / delete), privacy (export, delete account), sessions, language | |
| Assistant | chat + mic (voice booking) with confirmation cards | |

## Driver app (Flutter, `mobile/driver_app`)
Principles: large controls, minimal text while driving, one-hand reach (primary actions at the bottom), high contrast,
optional Urdu. Tabs: **Drive · Earnings · Copilot · Account**.

| Screen | Content |
|---|---|
| Onboarding wizard | Identity → Documents (camera/file) → Vehicle → Review status → Training acknowledgement |
| Drive (offline) | big "Go online" button, demand heat summary, today's earnings |
| Drive (online) | map with demand zones, full-width incoming request card (fare, pickup distance/ETA, destination area, rider rating, 15 s countdown ring, Accept/Decline) |
| On trip | step card: Navigate to pickup → I've arrived → Enter PIN (large keypad) → Navigate to destination → Complete. Cash to collect is shown in large type. |
| Earnings | gross, fees, fuel estimate, net, per hour, per km, idle time, daily chart |
| Copilot | recommendations (labelled "Prediction"), demand zones list, reliability tips |
| Account | documents status, vehicle, wallet & withdrawals, preferences |

## Admin & corporate web (`admin`, React + TypeScript + Vite + Tailwind + shadcn-style components + Recharts + MapLibre)
Layout: left sidebar (grouped: Operations, People, Money, Trust & Safety, Intelligence, Configuration, System), top bar with
city switcher and user menu, content max width 1440, cards + dense tables with filters and pagination, and detail drawers.
Corporate admins get a separate, reduced navigation (Overview, Employees, Policy, Rides, Invoices, Schedule).

## Resilience patterns (all clients)
- Idempotency-Key generated per user intent (kept across retries of the same tap).
- Retries with exponential backoff for idempotent requests. Mutating requests without keys are never retried automatically.
- WebSocket reconnect with backoff. On reconnect: `ride.subscribe` → server snapshot → UI reconciles.
- Offline banner. Recent places are cached locally. Actions that need the network are disabled with an explanation.
- Friendly error copy mapped from error codes. Raw errors are never shown.
