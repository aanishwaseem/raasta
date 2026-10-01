"""Training entrypoint: extract -> validate -> train -> evaluate -> register. Never activates a model."""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
from typing import Any

import joblib

from app.config import Settings
from . import extract, synthetic
from .train import TRAINERS
from .validate import MIN_ROWS, DataValidationError, enough, validate

log = logging.getLogger("training")
SYNTH = {"eta": synthetic.eta_frame, "demand": synthetic.demand_frame, "cancellation": synthetic.cancellation_frame}


def _allow_synthetic(settings: Settings, explicit: bool | None) -> bool:
    import os

    if settings.env == "production":
        return False
    return explicit if explicit is not None else os.environ.get("ALLOW_SYNTHETIC_TRAINING", "false").lower() == "true"


def register(settings: Settings, result: dict[str, Any], synthetic_data: bool) -> str:
    """Saves the artifact and records the version. CANDIDATE if it beat the baseline, else REJECTED."""
    path = settings.models_dir / result["name"] / result["version"] / "model.joblib"
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(result["artifact"], path)
    status = "CANDIDATE" if result["beats_baseline"] else "REJECTED"
    note = ("Trained on SIMULATED data: metrics do not reflect real-world accuracy. " if synthetic_data else "") + (
        "" if result["beats_baseline"] else "Did not beat the baseline on the holdout set.")
    if settings.database_url:
        import psycopg
        from psycopg.types.json import Jsonb

        with psycopg.connect(settings.database_url, connect_timeout=5) as conn:
            conn.execute(
                """INSERT INTO model_versions (model_name, version, algorithm, training_date, features, metrics, baseline_metrics, dataset_version, dataset_rows,
                                               trained_on_synthetic, status, artifact_uri, notes)
                   VALUES (%s,%s,%s,now(),%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (result["name"], result["version"], result["algorithm"], result["features"], Jsonb(result["metrics"]), Jsonb(result["baseline_metrics"]),
                 result["dataset_version"], result["dataset_rows"], synthetic_data, status, str(path.relative_to(settings.models_dir)), note.strip() or None),
            )
    return status


def run_training(settings: Settings, models: list[str], synthetic_ok: bool | None = None) -> dict[str, Any]:
    allow = _allow_synthetic(settings, synthetic_ok)
    out: list[dict[str, Any]] = []
    for name in models:
        if name not in TRAINERS:
            out.append({"name": name, "status": "SKIPPED", "reason": "unknown model"})
            continue
        df = None
        used_synth = False
        real_problem = "no DATABASE_URL"
        if settings.database_url:
            try:
                df = validate(name, extract.EXTRACTORS[name](settings.database_url))
                if not enough(name, df):
                    real_problem = f"only {len(df)} real rows; need at least {MIN_ROWS[name]}"
                    df = None
            except DataValidationError as err:
                real_problem = str(err)
                df = None
            except Exception as err:  # a broken query or unreachable database is an error, never a reason to fall back to fake data
                log.exception("%s: extraction failed", name)
                out.append({"name": name, "status": "ERROR", "reason": f"extraction failed: {type(err).__name__}: {err}"})
                continue
        if df is None:
            if not allow:
                out.append({"name": name, "status": "SKIPPED", "reason": f"insufficient real data ({real_problem}); synthetic training is not allowed in this environment"})
                continue
            df = validate(name, SYNTH[name]())
            used_synth = True
        try:
            res = TRAINERS[name](df)
        except ValueError as err:
            out.append({"name": name, "status": "SKIPPED", "reason": str(err)})
            continue
        status = register(settings, res, used_synth)
        out.append({"name": name, "version": res["version"], "status": status, "trainedOnSynthetic": used_synth, "datasetRows": res["dataset_rows"],
                    "metrics": res["metrics"], "baselineMetrics": res["baseline_metrics"]})
    return {"results": out}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="*", default=["eta", "demand", "cancellation"])
    ap.add_argument("--synthetic", action="store_true", help="allow simulated data when real data is insufficient (development only)")
    a = ap.parse_args()
    print(json.dumps(run_training(Settings.load(), a.models, True if a.synthetic else None), indent=1, default=str))
