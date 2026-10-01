from __future__ import annotations

import hmac
import logging
from contextlib import asynccontextmanager
import threading
from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .config import Settings
from .nlu.llm import LlmNlu
from .nlu.parser import parse as rules_parse
from .registry import ModelRegistry
from .service import Predictor

log = logging.getLogger("ai-service")


class EtaItem(BaseModel):
    kind: str = Field(pattern="^(PICKUP|TRIP)$")
    distance_m: float = Field(ge=0, le=2_000_000)
    provider_duration_s: float = Field(ge=0, le=86400)
    hour: int = Field(ge=0, le=23)
    weekday: int = Field(ge=1, le=7)
    city_id: str | None = None
    zone_code: str | None = None
    vehicle_class: str = "ECONOMY"


class EtaRequest(BaseModel):
    items: list[EtaItem] = Field(max_length=200)


class RankRequest(BaseModel):
    candidates: list[dict[str, Any]] = Field(max_length=100)
    context: dict[str, Any] = {}


class ZoneIn(BaseModel):
    zone_id: str
    code: str
    recent_requests_1h: float = Field(ge=0)
    online_drivers: int = Field(ge=0)


class DemandRequest(BaseModel):
    city_id: str | None = None
    at: datetime
    zones: list[ZoneIn] = Field(max_length=500)


class NluRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    now: datetime
    timezone: str = "Asia/Karachi"
    locale: str | None = None


class FraudRequest(BaseModel):
    signals: dict[str, float]


class TrainRequest(BaseModel):
    models: list[str] = Field(default_factory=lambda: ["eta", "demand", "cancellation"])


def create_app(settings: Settings | None = None, registry: ModelRegistry | None = None) -> FastAPI:
    settings = settings or Settings.load()
    registry = registry or ModelRegistry(settings)
    predictor = Predictor(registry)
    llm = LlmNlu(settings.anthropic_api_key, settings.anthropic_model) if settings.llm_nlu_enabled and settings.anthropic_api_key else None
    train_lock = threading.Lock()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        try:
            loaded = registry.reload()
            log.info("models loaded: %s", loaded or "none (baselines only)")
        except Exception as err:
            log.warning("model load failed, serving baselines: %s", err)
        yield

    app = FastAPI(title="Raasta AI service", version="0.1.0", docs_url=None if settings.env == "production" else "/docs", lifespan=lifespan)
    app.state.registry = registry
    app.state.settings = settings

    def auth(x_internal_token: str = Header(default="")) -> None:
        if not hmac.compare_digest(x_internal_token.encode(), settings.internal_token.encode()):
            raise HTTPException(status_code=401, detail="invalid internal token")

    @app.get("/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "models": registry.describe(), "llmNlu": llm is not None}

    @app.post("/v1/eta/predict", dependencies=[Depends(auth)])
    def eta_predict(req: EtaRequest) -> dict[str, Any]:
        return {"predictions": predictor.predict_eta([i.model_dump() for i in req.items])}

    @app.post("/v1/matching/rank", dependencies=[Depends(auth)])
    def matching_rank(req: RankRequest) -> dict[str, Any]:
        try:
            return predictor.rank(req.candidates, req.context)
        except KeyError as err:
            raise HTTPException(status_code=422, detail=f"candidate missing field {err}")

    @app.post("/v1/demand/forecast", dependencies=[Depends(auth)])
    def demand_forecast(req: DemandRequest) -> dict[str, Any]:
        return {"forecasts": predictor.forecast(req.at, [z.model_dump() for z in req.zones])}

    @app.post("/v1/nlu/parse", dependencies=[Depends(auth)])
    def nlu_parse(req: NluRequest) -> dict[str, Any]:
        now = req.now if req.now.tzinfo else req.now.replace(tzinfo=timezone.utc)
        return (llm.parse if llm else rules_parse)(req.text, now, req.timezone, req.locale)

    @app.post("/v1/fraud/score", dependencies=[Depends(auth)])
    def fraud_score(req: FraudRequest) -> dict[str, Any]:
        return predictor.fraud(req.signals)

    @app.get("/v1/models", dependencies=[Depends(auth)])
    def models() -> dict[str, Any]:
        return {"active": registry.describe()}

    @app.post("/v1/models/reload", dependencies=[Depends(auth)])
    def models_reload() -> dict[str, Any]:
        return {"loaded": registry.reload()}

    @app.post("/v1/training/run", dependencies=[Depends(auth)])
    def training_run(req: TrainRequest) -> dict[str, Any]:
        if not train_lock.acquire(blocking=False):
            raise HTTPException(status_code=409, detail="a training run is already in progress")
        try:
            from pipeline.run import run_training

            return run_training(settings, req.models)
        finally:
            train_lock.release()

    return app


app = create_app() if __name__ != "__main__" else None  # uvicorn app.main:app
