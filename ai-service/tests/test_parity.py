"""The Python scorer/fraud rules must equal the TypeScript ones on fixtures generated from the TS implementation
(backend/scripts/gen-parity-fixtures.ts)."""
import json
from pathlib import Path

import pytest

from app.models import fraud, matching

FIX = json.loads((Path(__file__).parent / "data" / "parity_fixtures.json").read_text())


@pytest.mark.parametrize("case", FIX["matching"])
def test_matching_matches_typescript(case):
    got = matching.rank_candidates(case["candidates"])
    assert [g["driverId"] for g in got] == [e["driverId"] for e in case["expected"]]
    for g, e in zip(got, case["expected"]):
        assert g["score"] == pytest.approx(e["score"], abs=1e-9)
        assert g["cancelProbability"] == pytest.approx(e["cancelProbability"], abs=1e-9)
        assert g["reasons"] == e["reasons"]
        for k, v in e["breakdown"].items():
            assert g["breakdown"][k]["value"] == pytest.approx(v["value"], abs=1e-9)
            assert g["breakdown"][k]["contribution"] == pytest.approx(v["contribution"], abs=1e-9)


@pytest.mark.parametrize("case", FIX["baselineCancel"])
def test_baseline_cancel_matches_typescript(case):
    i = case["input"]
    assert matching.baseline_cancel_probability(i["tripsAssigned"], i["driverCancellations"], i["distanceM"]) == pytest.approx(case["expected"], abs=1e-12)


@pytest.mark.parametrize("case", FIX["fraud"])
def test_fraud_matches_typescript(case):
    out = fraud.score_signals(case["signals"])
    assert out["level"] == case["level"]
    assert out["score"] == case["score"]
    assert out["rules"] == [h["rule"] for h in case["hits"]]
    assert out["reasons"] == [h["reason"] for h in case["hits"]]


def test_prompt_example_prefers_lower_cancellation_driver():
    """Product brief example: A (1 km, 4 min, 15% cancel) vs B (1.6 km, 5 min, 2% cancel): B should win."""
    base = dict(offersReceived=40, offersAccepted=32, tripsAssigned=30, tripsCompleted=29, driverCancellations=1, ratingAvg=4.8, ratingCount=30, routeCompatibility=0.5, preferenceMatch=0.5)
    a = dict(base, driverId="A", distanceM=1000, pickupEtaS=240, cancelProbability=0.15)
    b = dict(base, driverId="B", distanceM=1600, pickupEtaS=300, cancelProbability=0.02)
    assert matching.rank_candidates([a, b])[0]["driverId"] == "B"
