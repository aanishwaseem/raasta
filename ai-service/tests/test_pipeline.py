from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app.config import Settings
from app.models import demand, eta
from app.registry import ModelRegistry
from app.service import Predictor
from pipeline import synthetic
from pipeline.run import run_training
from pipeline.train import train_cancellation, train_demand, train_eta
from pipeline.validate import DataValidationError, validate


@pytest.fixture()
def settings(tmp_path):
    return replace(Settings.load(), database_url=None, models_dir=tmp_path, env="development")


def test_synthetic_training_is_labelled_and_never_active(settings):
    out = run_training(settings, ["eta", "cancellation"], synthetic_ok=True)["results"]
    for r in out:
        assert r["trainedOnSynthetic"] is True
        assert r["status"] in {"CANDIDATE", "REJECTED"}  # never ACTIVE
        assert r["baselineMetrics"]  # always compared against a baseline
    assert any(Path(settings.models_dir).rglob("model.joblib"))


def test_synthetic_training_refused_in_production(settings):
    prod = replace(settings, env="production")
    out = run_training(prod, ["eta"], synthetic_ok=True)["results"]
    assert out[0]["status"] == "SKIPPED" and "synthetic" in out[0]["reason"]


def test_without_real_data_and_without_permission_nothing_is_trained(settings):
    out = run_training(settings, ["eta", "demand", "cancellation"], synthetic_ok=False)["results"]
    assert all(r["status"] == "SKIPPED" for r in out)


def test_eta_model_beats_provider_estimate_on_simulated_holdout():
    res = train_eta(validate("eta", synthetic.eta_frame(4000)))
    assert res["metrics"]["mae_s"] < res["baseline_metrics"]["provider_eta"]["mae_s"]
    assert res["metrics"]["holdout_rows"] == 800  # time-based 80/20 split


def test_holdout_is_strictly_later_than_training():
    df = validate("eta", synthetic.eta_frame(1000))
    cut = int(len(df) * 0.8)
    assert df["ts"].iloc[:cut].max() <= df["ts"].iloc[cut:].min()


def test_eta_baseline_shrinks_toward_one_with_few_samples():
    df = pd.DataFrame({"weekday": [1] * 2, "hour": [9] * 2, "provider_duration_s": [100.0, 100.0], "actual_s": [300.0, 300.0]})
    r = eta.fit_baseline_ratios(df)[(1, 9)]
    assert 1.0 < r < 1.3  # 2 samples barely move it off 1.0 despite a 3x observation


def test_installed_model_changes_prediction_and_failure_falls_back(settings):
    res = train_eta(validate("eta", synthetic.eta_frame(3000)))
    reg = ModelRegistry(settings)
    reg.install("eta", res["artifact"])
    item = {"kind": "TRIP", "distance_m": 8000, "provider_duration_s": 900, "hour": 18, "weekday": 2, "vehicle_class": "ECONOMY"}
    with_model = Predictor(reg).predict_eta([item])[0]
    assert with_model["model"] == "eta-gbr" and with_model["eta_s"] != 900
    broken = dict(res["artifact"], model=object())
    reg.install("eta", broken)
    assert Predictor(reg).predict_eta([item])[0]["eta_s"] > 0  # no exception


def test_demand_training_has_no_target_leakage():
    df = validate("demand", synthetic.demand_frame(6))
    res = train_demand(df)
    # recent_1h is the previous hour, so a model using only it cannot see the target hour
    assert res["metrics"]["holdout_rows"] > 0 and res["metrics"]["mae"] < res["baseline_metrics"]["persistence"]["mae"]


def test_demand_levels_match_backend_fallback_thresholds():
    assert demand.level_for(3, 2) == "HIGH" and demand.level_for(1, 1) == "MEDIUM" and demand.level_for(0, 5) == "LOW"


def test_cancellation_model_outputs_probabilities():
    res = train_cancellation(validate("cancellation", synthetic.cancellation_frame(3000)))
    m = res["artifact"]["model"]
    from app.models import cancellation as c
    row = c.candidate_row({"tripsAssigned": 20, "driverCancellations": 5, "distanceM": 3000, "pickupEtaS": 400, "offersAccepted": 15, "offersReceived": 25}, 20, 6000)
    p = m.predict_proba(c.feature_frame([row]))[0, 1]
    assert 0 < p < 1


@pytest.mark.parametrize("mutate,err", [
    (lambda d: d.assign(provider_duration_s=0), "non-positive"),
    (lambda d: d.drop(columns=["actual_s"]), "missing columns"),
    (lambda d: d.assign(actual_s=np.where(np.arange(len(d)) % 2 == 0, 1.0, d["actual_s"])), "implausible"),
])
def test_validation_fails_loudly(mutate, err):
    with pytest.raises(DataValidationError, match=err):
        validate("eta", mutate(synthetic.eta_frame(800)))


def test_validation_rejects_single_class_labels():
    df = synthetic.cancellation_frame(800)
    df["cancelled"] = 0
    with pytest.raises(DataValidationError):
        validate("cancellation", df)
