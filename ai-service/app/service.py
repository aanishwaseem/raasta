"""Prediction logic used by the HTTP layer. Kept free of FastAPI so it is easy to unit-test."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from .models import cancellation, demand, eta, fraud, matching
from .registry import ModelRegistry


class Predictor:
    def __init__(self, registry: ModelRegistry):
        self.registry = registry

    # ------------------------------------------------------------------ ETA
    def predict_eta(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        bundle = self.registry.get(eta.NAME)
        if bundle and bundle.get("model") is not None:
            try:
                vals = eta.model_predict(items, bundle["model"])
                return [{"eta_s": v, "model": "eta-gbr", "version": bundle["version"], "fallback": False} for v in vals]
            except Exception:  # a broken artifact must never break quoting
                pass
        ratios = bundle.get("ratios") if bundle else None
        vals = eta.baseline_predict(items, ratios)
        name, version = ("eta-baseline", bundle["version"]) if ratios else ("eta-provider", "v1")
        return [{"eta_s": v, "model": name, "version": version, "fallback": not ratios} for v in vals]

    # ------------------------------------------------------------------ matching
    def rank(self, candidates: list[dict[str, Any]], context: dict[str, Any]) -> dict[str, Any]:
        bundle = self.registry.get(cancellation.NAME)
        hour = (datetime.now(timezone.utc) + timedelta(hours=demand.PKT_OFFSET_H)).hour
        trip_m = float(context.get("tripDistanceM") or 5000)
        cancel_fn = None
        version = matching.WEIGHTS_VERSION
        if bundle and bundle.get("model") is not None:
            mdl = bundle["model"]

            def cancel_fn(c: dict[str, Any]) -> float:  # noqa: E306
                row = cancellation.candidate_row(c, hour, trip_m)
                return float(mdl.predict_proba(cancellation.feature_frame([row]))[0, 1])

            version = f"{matching.WEIGHTS_VERSION}+cancel@{bundle['version']}"
        ranked = matching.rank_candidates(candidates, None, cancel_fn)
        return {"ranked": ranked, "model": "weighted-scoring", "version": version}

    # ------------------------------------------------------------------ demand
    def forecast(self, at: datetime, zones: list[dict[str, Any]]) -> list[dict[str, Any]]:
        bundle = self.registry.get(demand.NAME)
        wd, hr = demand.hour_of_week(at)
        out = []
        for z in zones:
            recent = float(z["recent_requests_1h"])
            drivers = int(z["online_drivers"])
            seasonal = None
            n_weeks = 0
            if bundle:
                hit = bundle["seasonal"].get((z["code"], wd, hr))
                if hit:
                    seasonal, n_weeks = hit
            if bundle and bundle.get("model") is not None and seasonal is not None:
                row = {"weekday": wd, "hour": hr, "recent_1h": recent, "seasonal_mean": seasonal, "online_drivers": drivers}
                expected = max(0.0, float(bundle["model"].predict(demand.feature_frame([row]))[0]))
                model, conf = "demand-gbr", "medium"
            elif seasonal is not None:
                expected = demand.blend(seasonal, n_weeks, recent)
                model, conf = "demand-seasonal", "medium" if n_weeks >= 4 else "low"
            else:
                expected = recent
                model, conf = "persistence", "low"
            version = bundle["version"] if bundle else "local"
            out.append({
                "zone_id": z["zone_id"],
                "expected_requests": round(expected, 2),
                "online_drivers": drivers,
                "supply_gap": round(expected - drivers, 2),
                "level": demand.level_for(expected, drivers),
                "confidence": conf,
                "model": model,
                "version": version,
            })
        return out

    # ------------------------------------------------------------------ fraud
    @staticmethod
    def fraud(signals: dict[str, float]) -> dict[str, Any]:
        return fraud.score_signals(signals)
