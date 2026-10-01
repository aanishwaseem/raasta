# Try Raasta

One command starts the API, AI service, admin dashboard and the passenger and driver apps (as web apps), with test data loaded.

```bash
docker compose up --build        # first build takes a few minutes (it builds Flutter)
```

| What | URL |
|---|---|
| Passenger app | http://localhost:8080 |
| Driver app | http://localhost:8081 |
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
