"""Data validation. Fails loudly: a model must never be trained on data that violates these checks."""
from __future__ import annotations

import pandas as pd


class DataValidationError(ValueError):
    pass


REQUIRED = {
    "eta": ["ts", "kind", "vehicle_class", "distance_m", "provider_duration_s", "actual_s", "hour", "weekday"],
    "demand": ["zone_code", "ts", "weekday", "hour", "requests", "online_drivers"],
    "cancellation": ["ts", "trips_assigned", "driver_cancellations", "pickup_distance_m", "pickup_eta_s", "hour", "trip_distance_m", "offers_accepted", "offers_received", "cancelled"],
}
MIN_ROWS = {"eta": 500, "demand": 24 * 14 * 3, "cancellation": 500}  # below this a model would be noise
MAX_NULL_RATE = 0.02


def validate(name: str, df: pd.DataFrame) -> pd.DataFrame:
    missing = [c for c in REQUIRED[name] if c not in df.columns]
    if missing:
        raise DataValidationError(f"{name}: missing columns {missing}")
    if df.empty:
        raise DataValidationError(f"{name}: no rows")
    nulls = df[REQUIRED[name]].isna().mean()
    bad = nulls[nulls > MAX_NULL_RATE]
    if len(bad):
        raise DataValidationError(f"{name}: too many nulls in {bad.to_dict()}")
    df = df.dropna(subset=REQUIRED[name]).copy()
    if name == "eta":
        if (df["provider_duration_s"] <= 0).any() or (df["distance_m"] <= 0).any():
            raise DataValidationError("eta: non-positive distance/provider duration")
        ratio = df["actual_s"] / df["provider_duration_s"]
        # Drop physically implausible observations (e.g. an abandoned trip left open); refuse if that is a large share.
        keep = (ratio > 0.2) & (ratio < 6) & (df["actual_s"] > 30)
        if keep.mean() < 0.9:
            raise DataValidationError(f"eta: {100 * (1 - keep.mean()):.1f}% of rows implausible; investigate before training")
        df = df[keep]
        if not df["hour"].between(0, 23).all() or not df["weekday"].between(1, 7).all():
            raise DataValidationError("eta: hour/weekday out of range")
    elif name == "demand":
        if (df["requests"] < 0).any():
            raise DataValidationError("demand: negative request counts")
    elif name == "cancellation":
        if not set(df["cancelled"].unique()) <= {0, 1}:
            raise DataValidationError("cancellation: label must be 0/1")
        if df["cancelled"].nunique() < 2:
            raise DataValidationError("cancellation: only one class present; cannot train")
        if (df["trips_assigned"] < 0).any() or (df["driver_cancellations"] > df["trips_assigned"] + 1).any():
            raise DataValidationError("cancellation: inconsistent driver history (cancellations > assigned)")
    if not df["ts"].is_monotonic_increasing:
        df = df.sort_values("ts").reset_index(drop=True)
    return df.reset_index(drop=True)


def enough(name: str, df: pd.DataFrame) -> bool:
    return len(df) >= MIN_ROWS[name]
