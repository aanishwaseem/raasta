"""Optional LLM NLU (Anthropic Claude) with a strict schema.

The LLM only extracts intent and slots. Its output is validated against the same schema the rules produce; anything
invalid, low-confidence, or any API failure falls back to the rule parser. It is OFF unless LLM_NLU_ENABLED=true and
ANTHROPIC_API_KEY is set. Note: the live API path has NOT been exercised in this repository's tests (no key was
available); only the validation/fallback logic is unit-tested, with a fake client.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from .parser import parse as rules_parse

log = logging.getLogger("nlu.llm")

INTENTS = ["BOOK_RIDE", "SCHEDULE_RIDE", "BOOK_USUAL", "QUOTE", "CHEAPEST", "FASTEST", "RIDE_STATUS", "WHY_FARE",
           "CANCEL_RIDE", "RIDE_HISTORY", "SAFETY_HELP", "SUPPORT", "UNKNOWN"]
PRODUCTS = ["BIKE", "ECONOMY", "COMFORT", "XL", "SHARED"]

TOOL = {
    "name": "parse_request",
    "description": "Extract the intent and slots from a ride-hailing request. Never invent places; copy place names exactly as spoken.",
    "input_schema": {
        "type": "object",
        "properties": {
            "intent": {"type": "string", "enum": INTENTS},
            "language": {"type": "string", "enum": ["en", "ur", "roman-ur"]},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "pickup": {"type": ["string", "null"]},
            "dropoff": {"type": ["string", "null"]},
            "datetime_iso": {"type": ["string", "null"], "description": "ISO-8601 with +05:00 offset, only if the user gave a time"},
            "product": {"type": ["string", "null"], "enum": [*PRODUCTS, None]},
            "preference": {"type": ["string", "null"], "enum": ["CHEAPEST", "FASTEST", None]},
        },
        "required": ["intent", "language", "confidence"],
    },
}

SYSTEM = (
    "You extract structured data from short ride-hailing requests in English, Urdu script, or Roman Urdu (Urdu written in Latin letters). "
    "You do not answer the user, book anything, or add facts. Copy place names verbatim. If the destination is missing set dropoff to null. "
    "Times are Pakistan local time (UTC+5). If the request is not about rides, use intent UNKNOWN. Use low confidence when unsure."
)


def validate(raw: dict[str, Any], engine: str) -> dict[str, Any] | None:
    """Returns a parser-shaped result, or None if the model output is not acceptable."""
    try:
        intent = raw["intent"]
        if intent not in INTENTS:
            return None
        conf = float(raw["confidence"])
        if not 0.0 <= conf <= 1.0:
            return None
        lang = raw.get("language", "en")
        if lang not in ("en", "ur", "roman-ur"):
            return None
        dt = raw.get("datetime_iso")
        if dt is not None:
            datetime.fromisoformat(dt)  # raises if malformed
        product = raw.get("product")
        if product is not None and product not in PRODUCTS:
            return None
        pref = raw.get("preference")
        if pref not in (None, "CHEAPEST", "FASTEST"):
            return None
        for k in ("pickup", "dropoff"):
            v = raw.get(k)
            if v is not None and (not isinstance(v, str) or len(v) > 80):
                return None
    except (KeyError, TypeError, ValueError):
        return None
    missing = ["dropoff"] if intent in ("BOOK_RIDE", "SCHEDULE_RIDE", "QUOTE", "CHEAPEST", "FASTEST") and not raw.get("dropoff") else []
    if intent == "SCHEDULE_RIDE" and not dt:
        missing.append("datetime")
    return {
        "intent": intent,
        "language": lang,
        "confidence": round(conf, 2),
        "slots": {"pickup": raw.get("pickup"), "dropoff": raw.get("dropoff"), "datetime": dt, "datetimeText": None,
                  "productCode": product, "preference": pref, "period": None},
        "missing": missing,
        "engine": engine,
    }


class LlmNlu:
    def __init__(self, api_key: str, model: str, client: Any | None = None):
        self.model = model
        if client is None:
            import anthropic

            client = anthropic.Anthropic(api_key=api_key, timeout=3.5, max_retries=0)
        self.client = client

    def parse(self, text: str, now: datetime, timezone_name: str = "Asia/Karachi", locale: str | None = None) -> dict[str, Any]:
        rules = rules_parse(text, now, timezone_name, locale)
        try:
            msg = self.client.messages.create(
                model=self.model,
                max_tokens=300,
                system=SYSTEM,
                tools=[TOOL],
                tool_choice={"type": "tool", "name": "parse_request"},
                messages=[{"role": "user", "content": f"Current time (Pakistan): {now.isoformat()}\nRequest: {text}"}],
            )
            block = next(b for b in msg.content if getattr(b, "type", "") == "tool_use")
            parsed = validate(dict(block.input), f"llm:{self.model}")
        except Exception as err:  # network, timeout, schema, anything: rules win
            log.warning("LLM NLU failed, using rules: %s", err)
            return rules
        if parsed is None:
            return rules
        # Safety net: never let the LLM be *more* willing to act than the rules when they disagree on an action.
        actions = {"BOOK_RIDE", "SCHEDULE_RIDE", "BOOK_USUAL", "CHEAPEST", "FASTEST"}
        if parsed["intent"] in actions and rules["intent"] == "UNKNOWN":
            parsed["confidence"] = min(parsed["confidence"], 0.5)
        return parsed
