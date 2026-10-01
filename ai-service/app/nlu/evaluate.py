"""Evaluate the NLU against tests/data/nlu_cases.json and report real numbers (never hard-coded)."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from .parser import parse

CASES = Path(__file__).resolve().parents[2] / "tests" / "data" / "nlu_cases.json"


def _norm(s: str | None) -> str | None:
    return s.strip().lower() if s else None


def evaluate(parse_fn: Callable[..., dict[str, Any]] = parse, path: Path = CASES) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    now = datetime.fromisoformat(data["now"])
    n = len(data["cases"])
    intent_ok = 0
    slot_total = slot_ok = 0
    lang_ok = 0
    failures: list[dict[str, Any]] = []
    per_intent: dict[str, list[int]] = {}
    for c in data["cases"]:
        r = parse_fn(c["text"], now)
        s = r["slots"]
        ok_intent = r["intent"] == c["intent"]
        intent_ok += ok_intent
        per_intent.setdefault(c["intent"], [0, 0])
        per_intent[c["intent"]][1] += 1
        per_intent[c["intent"]][0] += ok_intent
        lang_ok += r["language"] == c["language"]
        bad: list[str] = []
        for key, got in (("pickup", s.get("pickup")), ("dropoff", s.get("dropoff"))):
            want = c.get(key)
            slot_total += 1
            if _norm(got) == _norm(want):
                slot_ok += 1
            else:
                bad.append(f"{key}: want {want!r} got {got!r}")
        want_dt = c.get("datetime")
        got_dt = (s.get("datetime") or "")[:16] or None
        slot_total += 1
        if got_dt == want_dt:
            slot_ok += 1
        else:
            bad.append(f"datetime: want {want_dt!r} got {got_dt!r}")
        for key, got in (("product", s.get("productCode")), ("preference", s.get("preference"))):
            slot_total += 1
            if got == c.get(key):
                slot_ok += 1
            else:
                bad.append(f"{key}: want {c.get(key)!r} got {got!r}")
        if not ok_intent:
            bad.insert(0, f"intent: want {c['intent']} got {r['intent']}")
        if c["missing"] and not set(c["missing"]) <= set(r["missing"]):
            bad.append(f"missing: want {c['missing']} got {r['missing']}")
        if bad:
            failures.append({"text": c["text"], "problems": bad})
    return {
        "cases": n,
        "intentAccuracy": round(intent_ok / n, 4),
        "slotAccuracy": round(slot_ok / slot_total, 4),
        "languageAccuracy": round(lang_ok / n, 4),
        "perIntent": {k: f"{v[0]}/{v[1]}" for k, v in sorted(per_intent.items())},
        "failures": failures,
    }


if __name__ == "__main__":
    res = evaluate()
    print(json.dumps({k: v for k, v in res.items() if k != "failures"}, indent=1))
    for f in res["failures"]:
        print("-", f["text"], "\n   ", "; ".join(f["problems"]))
