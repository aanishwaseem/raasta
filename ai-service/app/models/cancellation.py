"""Probability that a driver cancels after accepting.

Baseline : Beta(2,18)-smoothed driver cancellation rate, inflated for long pickups (same as the TS scorer).
Model    : LogisticRegression on the smoothed rate, pickup distance/ETA, time of day and trip distance.
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from .matching import baseline_cancel_probability

NAME = "cancellation"
FEATURES = ["smoothed_rate", "pickup_km", "pickup_eta_min", "hour_sin", "hour_cos", "trip_km", "accept_rate"]


def smoothed_rate(assigned: float, cancels: float) -> float:
    return (cancels + 2) / (assigned + 20)


def feature_frame(rows: list[dict[str, Any]]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    return pd.DataFrame(
        {
            "smoothed_rate": [smoothed_rate(a, c) for a, c in zip(df["trips_assigned"], df["driver_cancellations"])],
            "pickup_km": df["pickup_distance_m"].astype(float) / 1000.0,
            "pickup_eta_min": df["pickup_eta_s"].astype(float) / 60.0,
            "hour_sin": np.sin(2 * math.pi * df["hour"] / 24),
            "hour_cos": np.cos(2 * math.pi * df["hour"] / 24),
            "trip_km": df["trip_distance_m"].astype(float) / 1000.0,
            "accept_rate": [(acc + 8) / (rec + 10) for acc, rec in zip(df["offers_accepted"], df["offers_received"])],
        }
    )[FEATURES]


def baseline_predict(rows: list[dict[str, Any]]) -> list[float]:
    return [baseline_cancel_probability(r["trips_assigned"], r["driver_cancellations"], r["pickup_distance_m"]) for r in rows]


def candidate_row(c: dict[str, Any], hour: int, trip_distance_m: float) -> dict[str, Any]:
    """Map a matching candidate (camelCase, from the backend) to the model's input row."""
    return {
        "trips_assigned": c["tripsAssigned"],
        "driver_cancellations": c["driverCancellations"],
        "pickup_distance_m": c["distanceM"],
        "pickup_eta_s": c["pickupEtaS"],
        "hour": hour,
        "trip_distance_m": trip_distance_m,
        "offers_accepted": c["offersAccepted"],
        "offers_received": c["offersReceived"],
    }
