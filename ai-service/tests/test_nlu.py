from datetime import datetime

import pytest

from app.nlu import llm
from app.nlu.evaluate import evaluate
from app.nlu.parser import parse
from app.nlu.timeparse import PKT

NOW = datetime(2026, 9, 30, 10, 0, tzinfo=PKT)  # Wednesday


def test_regression_suite_reports_real_numbers():
    res = evaluate()
    print({k: v for k, v in res.items() if k != "failures"})
    assert res["cases"] >= 90
    assert res["intentAccuracy"] >= 0.97
    assert res["slotAccuracy"] >= 0.97
    assert not [f for f in res["failures"] if "intent" in f["problems"][0]], res["failures"]


@pytest.mark.parametrize("text", ["I'm being followed, help", "help me I feel unsafe", "madad chahiye khatra hai", "SOS", "bachao"])
def test_safety_phrases_are_recognised(text):
    assert parse(text, NOW)["intent"] == "SAFETY_HELP"


def test_help_booking_is_not_a_safety_alert():
    assert parse("can you help me book a cab to Liberty", NOW)["intent"] == "BOOK_RIDE"


@pytest.mark.parametrize("text", ["hmm maybe", "what is the weather", "thank you", "kal", "Liberty", ""])
def test_non_requests_never_become_bookings(text):
    if not text:
        return
    r = parse(text, NOW)
    assert r["intent"] not in {"BOOK_RIDE", "SCHEDULE_RIDE", "CHEAPEST", "FASTEST"}


def test_missing_destination_is_reported_and_confidence_capped():
    r = parse("I need a cab", NOW)
    assert "dropoff" in r["missing"] and r["confidence"] <= 0.6


def test_bare_hour_is_marked_as_assumed_and_less_confident():
    sure = parse("Liberty se Johar Town jana hai kal subah 8 baje", NOW)
    vague = parse("Liberty se Johar Town jana hai kal 8 baje", NOW)
    assert vague["confidence"] < sure["confidence"]


def test_urdu_digits_and_script():
    r = parse("کل صبح ۸ بجے جوہر ٹاؤن سے لبرٹی جانا ہے", NOW)
    assert r["language"] == "ur" and r["slots"]["datetime"].startswith("2026-10-01T08:00")


def test_relative_time_is_a_schedule():
    assert parse("Liberty jana hai 30 minute mein", NOW)["slots"]["datetime"].startswith("2026-09-30T10:30")


# ---------------------------------------------------------------- LLM path: validation and fallback only (no live API in tests)
class _Block:
    type = "tool_use"

    def __init__(self, data):
        self.input = data


class _Msg:
    def __init__(self, data):
        self.content = [_Block(data)]


class _FakeClient:
    def __init__(self, data=None, raises=None):
        self.data, self.raises = data, raises
        self.messages = self

    def create(self, **kw):
        if self.raises:
            raise self.raises
        return _Msg(self.data)


def test_llm_valid_output_is_used():
    good = {"intent": "BOOK_RIDE", "language": "en", "confidence": 0.9, "pickup": "Liberty", "dropoff": "Emporium", "datetime_iso": None}
    r = llm.LlmNlu("k", "m", _FakeClient(good)).parse("ride from Liberty to Emporium", NOW)
    assert r["engine"].startswith("llm:") and r["slots"]["dropoff"] == "Emporium"


@pytest.mark.parametrize("bad", [
    {"intent": "DELETE_DATABASE", "language": "en", "confidence": 0.9},
    {"intent": "BOOK_RIDE", "language": "en", "confidence": 7},
    {"intent": "BOOK_RIDE", "language": "en", "confidence": 0.9, "product": "SPACESHIP"},
    {"intent": "BOOK_RIDE", "language": "en", "confidence": 0.9, "datetime_iso": "tomorrow-ish"},
    {"confidence": 0.9},
])
def test_llm_invalid_output_falls_back_to_rules(bad):
    r = llm.LlmNlu("k", "m", _FakeClient(bad)).parse("take me to Emporium Mall", NOW)
    assert r["engine"] == "rules-v1"


def test_llm_failure_falls_back_to_rules():
    r = llm.LlmNlu("k", "m", _FakeClient(raises=TimeoutError("slow"))).parse("take me to Emporium Mall", NOW)
    assert r["engine"] == "rules-v1" and r["slots"]["dropoff"] == "Emporium Mall"


def test_llm_cannot_turn_nonsense_into_a_confident_booking():
    eager = {"intent": "BOOK_RIDE", "language": "en", "confidence": 0.95, "pickup": None, "dropoff": "somewhere"}
    r = llm.LlmNlu("k", "m", _FakeClient(eager)).parse("hmm maybe", NOW)
    assert r["confidence"] <= 0.5
