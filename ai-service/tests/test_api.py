import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

H = {"x-internal-token": "test-token"}


@pytest.fixture()
def client():
    with TestClient(create_app(Settings.load())) as c:
        yield c


def test_health_is_open_but_v1_requires_token(client):
    assert client.get("/health").json()["status"] == "ok"
    assert client.post("/v1/fraud/score", json={"signals": {}}).status_code == 401
    assert client.post("/v1/fraud/score", headers={"x-internal-token": "wrong"}, json={"signals": {}}).status_code == 401


def test_cold_start_eta_returns_provider_estimate_flagged_as_fallback(client):
    r = client.post("/v1/eta/predict", headers=H, json={"items": [{"kind": "TRIP", "distance_m": 5000, "provider_duration_s": 600, "hour": 9, "weekday": 2}]}).json()
    p = r["predictions"][0]
    assert p["eta_s"] == 600 and p["fallback"] is True


def test_eta_validation_rejects_nonsense(client):
    bad = {"items": [{"kind": "TELEPORT", "distance_m": -5, "provider_duration_s": 1, "hour": 99, "weekday": 0}]}
    assert client.post("/v1/eta/predict", headers=H, json=bad).status_code == 422


def test_rank_returns_explanations(client):
    c = {"distanceM": 1000, "pickupEtaS": 240, "offersReceived": 10, "offersAccepted": 9, "tripsAssigned": 9, "tripsCompleted": 9, "driverCancellations": 0,
         "ratingAvg": 4.9, "ratingCount": 40, "routeCompatibility": 0.5, "preferenceMatch": 0.5}
    r = client.post("/v1/matching/rank", headers=H, json={"candidates": [{**c, "driverId": "a"}, {**c, "driverId": "b", "pickupEtaS": 600}], "context": {}}).json()
    assert [x["driverId"] for x in r["ranked"]] == ["a", "b"]
    assert r["ranked"][0]["reasons"] and set(r["ranked"][0]["breakdown"]) >= {"eta", "reliability"}


def test_rank_missing_field_is_a_422_not_a_500(client):
    assert client.post("/v1/matching/rank", headers=H, json={"candidates": [{"driverId": "a"}], "context": {}}).status_code == 422


def test_demand_persistence_when_no_history(client):
    body = {"at": "2026-09-30T10:00:00Z", "zones": [{"zone_id": "z1", "code": "LHR-X", "recent_requests_1h": 6, "online_drivers": 2}, {"zone_id": "z2", "code": "LHR-Y", "recent_requests_1h": 0, "online_drivers": 5}]}
    f = client.post("/v1/demand/forecast", headers=H, json=body).json()["forecasts"]
    assert f[0]["level"] == "HIGH" and f[0]["confidence"] == "low" and f[0]["model"] == "persistence"
    assert f[1]["level"] == "LOW"


def test_fraud_never_returns_action_fields(client):
    r = client.post("/v1/fraud/score", headers=H, json={"signals": {"accountsOnSameDevice": 9, "gpsJumps24h": 12}}).json()
    assert r["level"] in {"MEDIUM", "HIGH"} and "suspend" not in str(r).lower() and "ban" not in str(r).lower()


def test_nlu_endpoint(client):
    r = client.post("/v1/nlu/parse", headers=H, json={"text": "Johar Town se Liberty jana hai", "now": "2026-09-30T10:00:00+05:00"}).json()
    assert r["intent"] == "BOOK_RIDE" and r["slots"]["dropoff"] == "Liberty" and r["engine"] == "rules-v1"


def test_production_requires_a_token(monkeypatch):
    monkeypatch.delenv("AI_INTERNAL_TOKEN")
    monkeypatch.setenv("NODE_ENV", "production")
    with pytest.raises(RuntimeError):
        Settings.load()
