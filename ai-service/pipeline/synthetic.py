"""Synthetic data for exercising the pipeline in development.

EVERYTHING produced here is simulated from formulas written in this file. A model trained on it learns those
formulas, so its metrics say nothing about real-world accuracy. The training pipeline therefore registers such models
with trained_on_synthetic = true and the admin UI labels them. Never quote these numbers as performance.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

ZONES = ["LHR-GULBERG", "LHR-JOHAR", "LHR-DHA", "LHR-MODEL", "LHR-CANTT", "LHR-WALLED"]
ZONE_BASE = dict(zip(ZONES, [1.6, 1.2, 1.0, 0.8, 0.7, 0.5]))


def congestion(weekday: np.ndarray, hour: np.ndarray) -> np.ndarray:
    """Actual/provider duration ratio by time (weekday ISO 1..7). Made-up but plausible rush-hour shape."""
    morning = np.exp(-((hour - 9) ** 2) / 4.0)
    evening = np.exp(-((hour - 18) ** 2) / 5.0)
    weekday_factor = np.where(weekday <= 5, 1.0, 0.6)
    return 0.92 + 0.45 * (morning + evening) * weekday_factor


def eta_frame(n: int = 6000, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    t0 = pd.Timestamp("2026-01-05")
    ts = t0 + pd.to_timedelta(rng.integers(0, 84 * 24 * 60, n), unit="m")
    ts = ts.sort_values()
    weekday = ts.dayofweek.to_numpy() + 1
    hour = ts.hour.to_numpy()
    kind = rng.choice(["TRIP", "PICKUP"], n, p=[0.6, 0.4])
    vehicle = rng.choice(["ECONOMY", "BIKE", "COMFORT", "XL"], n, p=[0.55, 0.2, 0.15, 0.1])
    dist = np.where(kind == "TRIP", rng.gamma(4.0, 1600, n), rng.gamma(2.5, 700, n)).clip(300, 40000)
    provider = dist / np.where(kind == "TRIP", rng.uniform(7.0, 10.0, n), 6.0) + 30
    ratio = congestion(weekday, hour) * np.where(vehicle == "BIKE", 0.85, 1.0) * np.where(kind == "PICKUP", 1.1, 1.0)
    actual = provider * ratio * rng.lognormal(0, 0.12, n)
    return pd.DataFrame(
        {"ts": ts, "kind": kind, "vehicle_class": vehicle, "distance_m": dist, "provider_duration_s": provider, "actual_s": actual, "hour": hour, "weekday": weekday}
    )


def demand_frame(weeks: int = 8, seed: int = 11) -> pd.DataFrame:
    """Hourly requests per zone (Poisson around a zone x hour-of-week rate) plus online drivers."""
    rng = np.random.default_rng(seed)
    start = pd.Timestamp("2026-01-05")  # a Monday
    rows = []
    for z in ZONES:
        for h in range(weeks * 7 * 24):
            ts = start + pd.Timedelta(hours=h)
            wd, hr = ts.dayofweek, ts.hour
            rate = ZONE_BASE[z] * (0.3 + 2.2 * np.exp(-((hr - 9) ** 2) / 5) + 2.6 * np.exp(-((hr - 18.5) ** 2) / 6) + (0.8 if wd >= 4 and hr >= 20 else 0))
            rate *= 0.75 if wd == 6 else 1.0
            rows.append((z, ts, wd, hr, rng.poisson(rate), int(max(1, rng.poisson(rate * 0.8)))))
    df = pd.DataFrame(rows, columns=["zone_code", "ts", "weekday", "hour", "requests", "online_drivers"])
    return df


def cancellation_frame(n: int = 8000, seed: int = 3) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    n_drivers = 120
    driver_rate = rng.beta(2, 16, n_drivers)
    d = rng.integers(0, n_drivers, n)
    assigned = rng.integers(0, 300, n)
    true_rate = driver_rate[d]
    cancels = rng.binomial(assigned, true_rate)
    pickup_m = rng.gamma(2.2, 900, n).clip(100, 12000)
    eta_s = pickup_m / 6 + 30 + rng.normal(0, 40, n)
    hour = rng.integers(0, 24, n)
    trip_m = rng.gamma(4.0, 1600, n).clip(500, 40000)
    received = assigned + rng.integers(0, 120, n)
    accepted = np.minimum(received, assigned + rng.integers(0, 10, n))
    logit = -2.6 + 9 * (true_rate - 0.1) + 0.0003 * (pickup_m - 2000) + 0.35 * ((hour >= 22) | (hour <= 4)) - 0.00002 * (trip_m - 6000)
    y = rng.random(n) < 1 / (1 + np.exp(-logit))
    ts = pd.Timestamp("2026-01-05") + pd.to_timedelta(np.sort(rng.integers(0, 84 * 24 * 60, n)), unit="m")
    return pd.DataFrame(
        {"ts": ts, "trips_assigned": assigned, "driver_cancellations": cancels, "pickup_distance_m": pickup_m, "pickup_eta_s": eta_s.clip(30),
         "hour": hour, "trip_distance_m": trip_m, "offers_accepted": accepted, "offers_received": received, "cancelled": y.astype(int)}
    )
