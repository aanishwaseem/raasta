"""Model registry: loads ACTIVE model versions recorded in Postgres `model_versions`.

The service works with zero artifacts (every predictor has a baseline). Activation is an admin action in the backend,
which then calls POST /v1/models/reload.
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any

import joblib

from .config import Settings

log = logging.getLogger("registry")


class ModelRegistry:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._lock = threading.Lock()
        self._active: dict[str, dict[str, Any]] = {}

    def get(self, name: str) -> dict[str, Any] | None:
        return self._active.get(name)

    def install(self, name: str, bundle: dict[str, Any]) -> None:
        """Used by tests and by the training pipeline's in-process hot path."""
        with self._lock:
            self._active[name] = bundle

    def clear(self) -> None:
        with self._lock:
            self._active = {}

    def reload(self) -> dict[str, str]:
        """Re-read ACTIVE rows. Returns {model_name: version}. A model that fails to load is skipped, never fatal."""
        loaded: dict[str, dict[str, Any]] = {}
        if self.settings.database_url:
            import psycopg

            try:
                with psycopg.connect(self.settings.database_url, connect_timeout=3) as conn:
                    rows = conn.execute("SELECT model_name, version, artifact_uri, trained_on_synthetic FROM model_versions WHERE status = 'ACTIVE'").fetchall()
            except Exception as err:  # DB down: keep serving what we have
                log.warning("model reload skipped, database unavailable: %s", err)
                return {k: v["version"] for k, v in self._active.items()}
            for name, version, uri, synthetic in rows:
                path = Path(uri) if Path(uri).is_absolute() else self.settings.models_dir / uri
                try:
                    bundle = joblib.load(path)
                    bundle["trained_on_synthetic"] = bool(synthetic)
                    loaded[name] = bundle
                except Exception as err:
                    log.error("could not load %s@%s from %s: %s", name, version, path, err)
            with self._lock:
                self._active = loaded
        return {k: v["version"] for k, v in self._active.items()}

    def describe(self) -> list[dict[str, Any]]:
        return [
            {"name": n, "version": b.get("version"), "algorithm": b.get("algorithm"), "trainedOnSynthetic": b.get("trained_on_synthetic", False)}
            for n, b in sorted(self._active.items())
        ]
