"""Explainable driver-suitability scoring.

This is a line-for-line port of backend/src/modules/matching/scoring.ts. Both are tested against the same
fixtures (tests/data/parity_fixtures.json, generated from the TypeScript implementation), so a change to one
that is not mirrored in the other fails a test.
"""
from __future__ import annotations

from typing import Any, Callable

WEIGHTS_VERSION = "weights-v1"
DEFAULT_WEIGHTS: dict[str, float] = {
    "eta": 0.30,
    "reliability": 0.25,
    "acceptance": 0.10,
    "completion": 0.10,
    "rating": 0.10,
    "route": 0.05,
    "preference": 0.05,
    "distance": 0.05,
}
MAX_ETA_S = 900
MAX_DISTANCE_M = 7000


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def _round4(v: float) -> float:
    # JS Math.round rounds half up; Python round() rounds half to even. Match JS.
    import math

    return math.floor(v * 10000 + 0.5) / 10000


def baseline_cancel_probability(trips_assigned: float, driver_cancellations: float, distance_m: float) -> float:
    """Beta(2,18)-smoothed cancellation rate (prior mean 10%), inflated for long pickups."""
    base = (driver_cancellations + 2) / (trips_assigned + 20)
    km = distance_m / 1000
    return min(0.95, base * (1 + 0.1 * max(0.0, km - 2)))


def _reasons(f: dict[str, Any], cancel_p: float) -> list[str]:
    import math

    minutes = max(1, math.floor(f["pickupEtaS"] / 60 + 0.5))
    r = [f"{minutes} min pickup ETA"]
    if cancel_p <= 0.05:
        r.append("very low cancellation likelihood")
    elif cancel_p >= 0.15:
        r.append("higher cancellation likelihood")
    if f["ratingCount"] >= 20 and (f.get("ratingAvg") or 0) >= 4.7:
        r.append("consistently high ratings")
    if f["tripsAssigned"] >= 20 and f["tripsCompleted"] / max(1, f["tripsAssigned"]) >= 0.95:
        r.append("high completion reliability")
    if f["preferenceMatch"] == 1:
        r.append("matches your preferences")
    return r


def score_candidate(f: dict[str, Any], weights: dict[str, float] | None = None, cancel_fn: Callable[[dict[str, Any]], float] | None = None) -> dict[str, Any]:
    weights = weights or DEFAULT_WEIGHTS
    if f.get("cancelProbability") is not None:
        cancel_p = float(f["cancelProbability"])
    elif cancel_fn is not None:
        cancel_p = cancel_fn(f)
    else:
        cancel_p = baseline_cancel_probability(f["tripsAssigned"], f["driverCancellations"], f["distanceM"])
    rating_avg = f.get("ratingAvg")
    rating_smoothed = 4.6 if rating_avg is None else (rating_avg * f["ratingCount"] + 4.6 * 5) / (f["ratingCount"] + 5)
    values = {
        "eta": 1 - min(f["pickupEtaS"], MAX_ETA_S) / MAX_ETA_S,
        "reliability": 1 - cancel_p,
        "acceptance": (f["offersAccepted"] + 8) / (f["offersReceived"] + 10),
        "completion": (f["tripsCompleted"] + 9) / (f["tripsAssigned"] + 10),
        "rating": (rating_smoothed - 1) / 4,
        "route": _clamp01(f["routeCompatibility"]),
        "preference": _clamp01(f["preferenceMatch"]),
        "distance": 1 - min(f["distanceM"], MAX_DISTANCE_M) / MAX_DISTANCE_M,
    }
    breakdown: dict[str, dict[str, float]] = {}
    score = 0.0
    for key, w in weights.items():
        value = _clamp01(values[key])
        contribution = value * w
        breakdown[key] = {"value": _round4(value), "weight": w, "contribution": _round4(contribution)}
        score += contribution
    return {
        "driverId": f["driverId"],
        "score": _round4(score),
        "cancelProbability": _round4(cancel_p),
        "breakdown": breakdown,
        "reasons": _reasons(f, cancel_p),
    }


def rank_candidates(candidates: list[dict[str, Any]], weights: dict[str, float] | None = None, cancel_fn: Callable[[dict[str, Any]], float] | None = None) -> list[dict[str, Any]]:
    scored = [score_candidate(c, weights, cancel_fn) for c in candidates]
    # score desc, then driverId asc (same tie-break as the TypeScript version)
    return sorted(scored, key=lambda s: (-s["score"], s["driverId"]))
