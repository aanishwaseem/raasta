"""Demand forecasting per zone for the next hour.

Baseline : seasonal mean (zone x hour-of-week) blended with last-hour persistence. With no history: persistence only.
Model    : GradientBoostingRegressor (Poisson loss) on seasonal + lag features.
Level (HIGH/MEDIUM/LOW) uses the same thresholds as the backend's persistence fallback so behaviour is continuous.
"""
from __future__ import annotations

import math
from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd

NAME = "demand"
FEATURES = ["how_sin", "how_cos", "hour_sin", "hour_cos", "is_weekend", "recent_1h", "seasonal_mean", "online_drivers"]
PKT_OFFSET_H = 5


def hour_of_week(at: datetime) -> tuple[int, int]:
    """(weekday 0=Mon, hour) in Pakistan local time. Input is a timezone-aware or UTC-naive datetime."""
    from datetime import timedelta, timezone

    utc = at.astimezone(timezone.utc) if at.tzinfo else at.replace(tzinfo=timezone.utc)
    local = utc + timedelta(hours=PKT_OFFSET_H)
    return local.weekday(), local.hour


def feature_frame(rows: list[dict[str, Any]]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    how = df["weekday"] * 24 + df["hour"]
    return pd.DataFrame(
        {
            "how_sin": np.sin(2 * math.pi * how / 168),
            "how_cos": np.cos(2 * math.pi * how / 168),
            "hour_sin": np.sin(2 * math.pi * df["hour"] / 24),
            "hour_cos": np.cos(2 * math.pi * df["hour"] / 24),
            "is_weekend": df["weekday"].isin([4, 5, 6]).astype(float),
            "recent_1h": df["recent_1h"].astype(float),
            "seasonal_mean": df["seasonal_mean"].astype(float),
            "online_drivers": df["online_drivers"].astype(float),
        }
    )[FEATURES]


def seasonal_table(hourly: pd.DataFrame) -> dict[tuple[str, int, int], tuple[float, int]]:
    """Mean requests per hour by (zone, weekday, hour) and the number of weeks observed."""
    g = hourly.groupby(["zone_code", "weekday", "hour"])["requests"].agg(["mean", "count"])
    return {(z, int(w), int(h)): (float(r["mean"]), int(r["count"])) for (z, w, h), r in g.iterrows()}


def blend(seasonal: float | None, n_weeks: int, recent: float) -> float:
    """Seasonal mean weighted by evidence, persistence for the rest."""
    if seasonal is None:
        return recent
    w = n_weeks / (n_weeks + 3)
    return w * seasonal + (1 - w) * recent


def level_for(expected: float, drivers: int) -> str:
    ratio = expected / max(1, drivers)
    if expected >= 3 and ratio >= 1.5:
        return "HIGH"
    if expected >= 1 and ratio >= 0.7:
        return "MEDIUM"
    return "LOW"
