# Try Raasta

One command starts the API, AI service, admin dashboard and the passenger and driver apps (as web apps), with test data loaded.

```bash
docker compose up --build        # API, AI service, admin dashboard, database
```

## On an Android phone (recommended)
1. Start the stack above on your computer and keep the phone on the same Wi-Fi.
2. On the phone, open https://github.com/aanishwaseem/raasta/releases/tag/demo-latest and install **raasta-rider.apk** (and **raasta-driver.apk** on a second phone, or the same phone).
   Android asks you to allow installs from your browser the first time.
3. Find your computer's address (Windows: `ipconfig`, look for the IPv4 address, e.g. 192.168.1.20). Allow Docker/Node through the Windows firewall if asked.
4. On the app's sign-in screen tap **Server** and enter `192.168.1.20:3000` (your address). Sign in with the accounts below.
The phone GPS is pinned to Liberty Market, Lahore so the seeded data works from anywhere.

## In the browser instead
```bash
docker compose --profile web up --build   # also builds both apps as web apps (large first build, needs a few GB of disk)
```

| What | URL |
|---|---|
| Passenger app (web profile) | http://localhost:8080 |
| Driver app (web profile) | http://localhost:8081 |
| Admin dashboard | http://localhost:5173 |
| API docs | http://localhost:3000/api/docs |

All test accounts use the password `Passw0rd!test`.

| Role | Sign in with |
|---|---|
| Rider (wallet funded) | `bilal@raasta.test` |
| Driver (approved, vehicle ready) | `usman@raasta.test` |
| Admin dashboard | `admin@raasta.test` |

## A full ride in two browser windows
1. Open the **driver app** in one window, sign in as `usman@raasta.test`, tap **Go online**.
2. Open the **passenger app** in another window, sign in as `bilal@raasta.test`.
3. Search a place (try "Emporium"), pick a ride type, tap request. The rider's pickup is pinned to Liberty Market, Lahore.
4. The driver window shows the offer instantly: accept it.
5. Driver: **I've arrived**, then type the PIN shown on the rider's screen, **Start trip**, **Complete trip**.
6. The rider sees each step live, then can rate the driver. Check the wallet, history and safety (SOS, share trip) screens.
7. Open the **admin dashboard** to see the ride, the drivers and the document review queue.

New driver signup: create an account in the driver app, finish onboarding (identity, vehicle, six documents), then approve it in the admin dashboard.

## Notes
- The phone GPS is pinned to Liberty Market by default so it works from any country. Use your browser's real location instead with `DEMO_LOCATION= docker compose up --build`.
- Payments use the built-in mock provider; Google/Apple sign-in and Stripe stay off until you add credentials.
- Without Docker: `scripts/dev-up.sh`, then see `e2e/README.md` and `mobile/README.md` for running the pieces natively.
