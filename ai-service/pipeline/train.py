"""Training: time-based holdout (last 20%), evaluated against the baseline on the SAME holdout.

A model is registered as CANDIDATE only if it beats the baseline on the primary metric; otherwise REJECTED.
Nothing here activates a model: activation is an explicit admin action.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from app.models import cancellation, demand, eta

MIN_IMPROVEMENT = 0.01  # must beat baseline by >= 1% on the primary metric to be a candidate


def _split(df: pd.DataFrame, frac: float = 0.8) -> tuple[pd.DataFrame, pd.DataFrame]:
    cut = int(len(df) * frac)
    return df.iloc[:cut].copy(), df.iloc[cut:].copy()


def dataset_version(df: pd.DataFrame) -> str:
    h = hashlib.sha256(pd.util.hash_pandas_object(df.drop(columns=[c for c in df.columns if df[c].dtype == object and c not in ("kind", "vehicle_class", "zone_code")]), index=False).values.tobytes())
    return f"{len(df)}r-{h.hexdigest()[:10]}"


def _rows(df: pd.DataFrame, cols: list[str]) -> list[dict[str, Any]]:
    return df[cols].to_dict("records")


# ---------------------------------------------------------------------------------------------- ETA
def train_eta(df: pd.DataFrame) -> dict[str, Any]:
    train, hold = _split(df)
    ratios = eta.fit_baseline_ratios(train)
    cols = ["kind", "vehicle_class", "distance_m", "provider_duration_s", "hour", "weekday"]
    y = np.log((train["actual_s"] / train["provider_duration_s"]).clip(0.2, 6))
    model = GradientBoostingRegressor(n_estimators=250, max_depth=3, learning_rate=0.05, subsample=0.8, random_state=0)
    model.fit(eta.feature_frame(_rows(train, cols)), y)

    actual = hold["actual_s"].to_numpy()
    preds = {
        "provider": hold["provider_duration_s"].to_numpy(),
        "baseline": np.array(eta.baseline_predict(_rows(hold, cols), ratios)),
        "model": np.array(eta.model_predict(_rows(hold, cols), model)),
    }

    def m(p: np.ndarray) -> dict[str, float]:
        err = np.abs(p - actual)
        return {"mae_s": round(float(err.mean()), 2), "median_ae_s": round(float(np.median(err)), 2), "mape": round(float((err / actual).mean()), 4)}

    res = {k: m(v) for k, v in preds.items()}
    return _package("eta", "GradientBoostingRegressor(log actual/provider)", {"model": model, "ratios": ratios}, eta.FEATURES, res["model"], {"baseline_ratio": res["baseline"], "provider_eta": res["provider"]},
                    "mae_s", res["model"]["mae_s"], res["baseline"]["mae_s"], df, len(train), len(hold))


# ---------------------------------------------------------------------------------------------- demand
def _demand_features(df: pd.DataFrame, table: dict, loo: bool) -> pd.DataFrame:
    out = []
    for z, g in df.groupby("zone_code"):
        g = g.sort_values("ts").set_index("ts")
        grid = pd.date_range(g.index.min(), g.index.max(), freq="h")
        g = g.reindex(grid)
        g["zone_code"] = z
        g["requests"] = g["requests"].fillna(0)
        g["online_drivers"] = g["online_drivers"].ffill().bfill().fillna(1)
        g["weekday"] = g.index.dayofweek
        g["hour"] = g.index.hour
        g["recent_1h"] = g["requests"].shift(1)
        out.append(g.dropna(subset=["recent_1h"]).reset_index(names="ts"))
    f = pd.concat(out, ignore_index=True)
    means, ns = [], []
    for z, wd, hr, y in zip(f["zone_code"], f["weekday"], f["hour"], f["requests"]):
        mean, n = table.get((z, int(wd), int(hr)), (None, 0))
        if loo and n > 1 and mean is not None:
            mean, n = (mean * n - y) / (n - 1), n - 1
        elif loo:
            mean, n = None, 0
        means.append(np.nan if mean is None else mean)
        ns.append(n)
    f["seasonal_mean"] = means
    f["n_weeks"] = ns
    f["seasonal_mean"] = f["seasonal_mean"].fillna(f["recent_1h"])
    return f.sort_values("ts").reset_index(drop=True)


def train_demand(df: pd.DataFrame) -> dict[str, Any]:
    cut_ts = df["ts"].sort_values().iloc[int(len(df) * 0.8)]
    train_raw, hold_raw = df[df["ts"] < cut_ts], df[df["ts"] >= cut_ts]
    table = demand.seasonal_table(train_raw)
    tr = _demand_features(train_raw, table, loo=True)
    # holdout rows need their lag from the hour just before the cut, so build features on train+hold and keep only holdout rows
    both = _demand_features(df, table, loo=False)
    ho = both[both["ts"] >= cut_ts].reset_index(drop=True)
    model = HistGradientBoostingRegressor(loss="poisson", max_depth=4, learning_rate=0.06, max_iter=250, random_state=0)
    model.fit(demand.feature_frame(_rows(tr, ["weekday", "hour", "recent_1h", "seasonal_mean", "online_drivers"])), tr["requests"])
    y = ho["requests"].to_numpy()
    cols = ["weekday", "hour", "recent_1h", "seasonal_mean", "online_drivers"]
    p_model = np.clip(model.predict(demand.feature_frame(_rows(ho, cols))), 0, None)
    p_persist = ho["recent_1h"].to_numpy()
    p_base = np.array([demand.blend(None if (z, int(w), int(h)) not in table else table[(z, int(w), int(h))][0], table.get((z, int(w), int(h)), (0, 0))[1], r)
                       for z, w, h, r in zip(ho["zone_code"], ho["weekday"], ho["hour"], ho["recent_1h"])])

    def lvl_acc(p: np.ndarray) -> float:
        pred = [demand.level_for(a, int(d)) for a, d in zip(p, ho["online_drivers"])]
        true = [demand.level_for(a, int(d)) for a, d in zip(y, ho["online_drivers"])]
        return round(float(np.mean([a == b for a, b in zip(pred, true)])), 4)

    def m(p: np.ndarray) -> dict[str, float]:
        return {"mae": round(float(np.abs(p - y).mean()), 4), "level_accuracy": lvl_acc(p)}

    res = {"model": m(p_model), "baseline": m(p_base), "persistence": m(p_persist)}
    return _package("demand", "HistGradientBoostingRegressor(poisson)", {"model": model, "seasonal": table}, demand.FEATURES, res["model"],
                    {"seasonal_blend": res["baseline"], "persistence": res["persistence"]}, "mae", res["model"]["mae"], res["baseline"]["mae"], df, len(tr), len(ho))


# ---------------------------------------------------------------------------------------------- cancellation
def train_cancellation(df: pd.DataFrame) -> dict[str, Any]:
    train, hold = _split(df)
    if train["cancelled"].nunique() < 2 or hold["cancelled"].nunique() < 2:
        raise ValueError("cancellation: a split has a single class; need more data")
    cols = ["trips_assigned", "driver_cancellations", "pickup_distance_m", "pickup_eta_s", "hour", "trip_distance_m", "offers_accepted", "offers_received"]
    model = make_pipeline(StandardScaler(), LogisticRegression(C=1.0, max_iter=500))
    model.fit(cancellation.feature_frame(_rows(train, cols)), train["cancelled"])
    y = hold["cancelled"].to_numpy()
    p_model = model.predict_proba(cancellation.feature_frame(_rows(hold, cols)))[:, 1]
    p_base = np.clip(np.array(cancellation.baseline_predict(_rows(hold, cols))), 1e-4, 1 - 1e-4)
    p_const = np.full_like(p_base, float(train["cancelled"].mean()))

    def m(p: np.ndarray) -> dict[str, float]:
        return {"log_loss": round(float(log_loss(y, p)), 5), "auc": round(float(roc_auc_score(y, p)), 4), "brier": round(float(brier_score_loss(y, p)), 5)}

    res = {"model": m(p_model), "baseline": m(p_base), "train_base_rate": m(p_const)}
    res["model"]["holdout_positive_rate"] = round(float(y.mean()), 4)
    return _package("cancellation", "LogisticRegression(standardized)", {"model": model}, cancellation.FEATURES, res["model"],
                    {"beta_smoothed_rate": res["baseline"], "constant_rate": res["train_base_rate"]}, "log_loss", res["model"]["log_loss"], res["baseline"]["log_loss"], df, len(train), len(hold))


def _package(name: str, algorithm: str, artifact: dict[str, Any], features: list[str], metrics: dict[str, Any], baselines: dict[str, Any],
             primary: str, model_val: float, base_val: float, df: pd.DataFrame, n_train: int, n_hold: int) -> dict[str, Any]:
    improvement = (base_val - model_val) / base_val if base_val else 0.0  # all primary metrics are lower-is-better
    version = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return {
        "name": name,
        "version": version,
        "algorithm": algorithm,
        "artifact": {"name": name, "version": version, "algorithm": algorithm, **artifact},
        "features": features,
        "metrics": {**metrics, "train_rows": n_train, "holdout_rows": n_hold, "primary_metric": primary, "improvement_vs_baseline": round(improvement, 4)},
        "baseline_metrics": baselines,
        "dataset_version": dataset_version(df),
        "dataset_rows": int(len(df)),
        "beats_baseline": improvement >= MIN_IMPROVEMENT,
    }


TRAINERS = {"eta": train_eta, "demand": train_demand, "cancellation": train_cancellation}
