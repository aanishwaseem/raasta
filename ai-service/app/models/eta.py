"""ETA prediction.

Baseline : provider duration x learned hour-of-week congestion ratio, shrunk toward 1.0 when samples are few.
Model    : GradientBoostingRegressor on log(actual / provider_duration), so it only has to learn the *correction*
           to the routing provider's estimate.
With no artifacts the ratio is 1.0, i.e. the provider ETA is returned unchanged (cold start).
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

NAME = "eta"
FEATURES = ["distance_km", "provider_min", "hour_sin", "hour_cos", "weekday", "is_weekend", "is_pickup", "vehicle_bike", "vehicle_xl"]
MIN_RATIO, MAX_RATIO = 0.5, 3.0
SHRINK_K = 20  # samples at which a bucket's own median gets 50% weight


def feature_frame(rows: list[dict[str, Any]]) -> pd.DataFrame:
    """Deterministic features, shared by training and online inference."""
    df = pd.DataFrame(rows)
    hour = df["hour"].astype(float)
    vehicle = df["vehicle_class"] if "vehicle_class" in df else pd.Series("ECONOMY", index=df.index)
    out = pd.DataFrame(
        {
            "distance_km": df["distance_m"].astype(float) / 1000.0,
            "provider_min": df["provider_duration_s"].astype(float) / 60.0,
            "hour_sin": np.sin(2 * math.pi * hour / 24),
            "hour_cos": np.cos(2 * math.pi * hour / 24),
            "weekday": df["weekday"].astype(float),
            "is_weekend": df["weekday"].isin([5, 6, 7]).astype(float),  # Fri-Sun in Pakistan's traffic pattern
            "is_pickup": (df["kind"] == "PICKUP").astype(float),
            "vehicle_bike": (vehicle == "BIKE").astype(float),
            "vehicle_xl": (vehicle == "XL").astype(float),
        }
    )
    return out[FEATURES]


def fit_baseline_ratios(df: pd.DataFrame) -> dict[tuple[int, int], float]:
    """Median(actual/provider) per (weekday, hour), shrunk toward 1.0: r = 1 + n/(n+K) * (median - 1)."""
    ratio = df["actual_s"] / df["provider_duration_s"].clip(lower=1)
    out: dict[tuple[int, int], float] = {}
    for (wd, hr), g in ratio.groupby([df["weekday"], df["hour"]]):
        n = len(g)
        out[(int(wd), int(hr))] = 1.0 + n / (n + SHRINK_K) * (float(g.median()) - 1.0)
    return out


def baseline_predict(rows: list[dict[str, Any]], ratios: dict[tuple[int, int], float] | None) -> list[float]:
    ratios = ratios or {}
    return [
        max(MIN_RATIO, min(MAX_RATIO, ratios.get((int(r["weekday"]), int(r["hour"])), 1.0))) * float(r["provider_duration_s"])
        for r in rows
    ]


def model_predict(rows: list[dict[str, Any]], model: Any) -> list[float]:
    log_ratio = model.predict(feature_frame(rows))
    ratio = np.clip(np.exp(log_ratio), MIN_RATIO, MAX_RATIO)
    return [float(x) * float(r["provider_duration_s"]) for x, r in zip(ratio, rows)]
