"""Runtime configuration. Everything comes from environment variables; nothing secret has a default."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    internal_token: str
    database_url: str | None
    models_dir: Path
    anthropic_api_key: str | None
    anthropic_model: str
    llm_nlu_enabled: bool
    ab_test_fraction: float
    env: str

    @staticmethod
    def load() -> "Settings":
        env = os.environ.get("NODE_ENV", os.environ.get("APP_ENV", "development"))
        token = os.environ.get("AI_INTERNAL_TOKEN", "")
        if not token:
            if env == "production":
                raise RuntimeError("AI_INTERNAL_TOKEN must be set in production")
            token = "dev-only-ai-internal-token"  # matches the backend's clearly-marked dev default
        key = os.environ.get("ANTHROPIC_API_KEY") or None
        return Settings(
            internal_token=token,
            database_url=os.environ.get("DATABASE_URL") or None,
            models_dir=Path(os.environ.get("MODELS_DIR", str(Path(__file__).resolve().parent.parent / "models_store"))),
            anthropic_api_key=key,
            anthropic_model=os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001"),
            llm_nlu_enabled=_bool("LLM_NLU_ENABLED", False) and key is not None,
            ab_test_fraction=float(os.environ.get("AB_TEST_FRACTION", "0")),
            env=env,
        )
