"""Rule-based multilingual (English / Roman Urdu / Urdu script) intent and slot parser.

It extracts text spans only. Resolving 'Liberty' to an actual place, checking availability and prices, and booking
are the backend's job; this parser never decides anything with side effects.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from .timeparse import PKT, extract_when, normalize, strip_spans

PRODUCTS = [
    ("BIKE", r"\b(bike|motorbike|motorcycle|moto)\b|موٹر ?سائیکل|بائیک"),
    ("SHARED", r"\b(shared|sharing|carpool|car pool|pool)\b|شیئر"),
    ("XL", r"\b(xl|van|suv|6 seater|six seater|family (?:car|gari|gaari)|bari (?:gari|gaari))\b|بڑی گاڑی|وین"),
    ("COMFORT", r"\b(comfort|ac (?:car|gari|gaari)|premium|aram ?deh)\b|\bac\b|آرام"),
    ("ECONOMY", r"\b(economy|normal (?:car|gari)|mini)\b"),
]
CHEAPEST = re.compile(r"\b(cheapest|cheap|lowest (?:price|fare)|sasta|sasti|sastay|kam (?:kiraya|paisay|paise)|budget)\b|سستا|سستی|کم کرایہ")
FASTEST = re.compile(r"\b(fastest|quickest|quickly|fast|jaldi|tez|urgent|urgently)\b|جلدی|تیز")

_ROMAN_MARKERS = re.compile(
    r"\b(se|tak|jana|jaana|jani|chalo|chahiye|chahiyay|hai|hain|kal|aaj|parson|subah|shaam|raat|dopahar|baje|mujhe|mujhay|hamein|humein|"
    r"gari|gaari|karo|kar|do|dena|kahan|kitna|kitni|kiraya|ghar|dafter|abhi|mera|meri|nahi|nahin|bhai|yaar|wali|wala|le|lo|ko|ka|ki|ke|mein|par|aur|kyun|kyon|itna|mehnga)\b")
_EN_MARKERS = re.compile(r"\b(the|to|from|please|take|me|book|ride|cab|taxi|need|want|where|my|driver|how|much|why|is|at|tomorrow|today|pick|up|cancel)\b")
_URDU_SCRIPT = re.compile(r"[؀-ۿ]")

FILLER_START = re.compile(
    r"^(?:(?:please|plz|pls|hi|hello|hey|salam|salaam|assalam o alaikum|bhai|yaar|ek|a|an|the|mujhe|mujhay|hamein|humein|mera|meri|"
    r"chahiye|chahiyay|need|want|send|i need|i want|i would like|i'd like|can you|could you|book|booking|arrange|get|find|me|my|cab|taxi|ride|gari|gaari|car|"
    r"pick me up|pickup|pick up|take me|drop me|book a|book me|ek ride|ek gari|ride book karo|book karo|karo|kar do|"
    r"چاہیے|چاہئے|مجھے|ایک|براہ کرم|پلیز|گاڑی|رائیڈ|بک کریں|بک کرو)\s+)+", re.I)
FILLER_END = re.compile(
    r"(?:\s+(?:on|at|by|around|in|and take me|and drop me|and|please|plz|pls|thanks|thank you|ok|okay|now|book karo|book kar do|karo|kar do|kardo|chahiye|chahiyay|jana hai|jaana hai|jani hai|"
    r"hai|hain|jana|jaana|janay|chalo|tak|ke liye|ki|ka|ko|wali|wala|gari|gaari|ride|cab|taxi|car|book|"
    r"چاہیے|چاہئے|جانا ہے|جانا|ہے|تک|کے لیے|پلیز|شکریہ|گاڑی|رائیڈ)\b)+$", re.I)

INTENT_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("SAFETY_HELP", re.compile(r"\b(sos|emergency|unsafe|not safe|scared|afraid|followed|following me|harass\w*|threat\w*|kidnap\w*|accident|attack\w*|danger\w*|madad|bachao|khatra|khatray|dar lag\w*|peecha)\b|مدد|بچاؤ|خطرہ|ایمرجنسی")),
    ("CANCEL_RIDE", re.compile(r"\b(cancel|cancle|band kar(?:o| do)|mat bhejo|nahi chahiye|nahin chahiye|rehne do)\b|منسوخ|کینسل|نہیں چاہیے")),
    ("WHY_FARE", re.compile(r"\b(why .*(?:fare|price|expensive|costly|high)|(?:fare|price) .*(?:so high|too high|expensive)|kiraya itna|itna (?:kiraya|mehnga|zyada)|kyun .*(?:kiraya|mehnga)|kiraya .*kyun)\b|کرایہ اتنا|اتنا مہنگا")),
    ("RIDE_STATUS", re.compile(r"\b(where is (?:my )?(?:driver|ride|cab)|driver (?:kahan|kidhar)|kahan (?:hai|hain) (?:mera )?driver|ride status|my ride status|status of my ride|when will (?:he|the driver|it) arrive|kitni der|kab (?:aayega|ayega|pahunchega)|driver kab|where (?:is|'s) (?:he|she|it)|not coming|hasn't arrived|has not arrived|driver (?:is )?late|driver nahi aaya|abhi tak nahi aaya)\b|ڈرائیور کہاں|کتنی دیر")),
    ("RIDE_HISTORY", re.compile(r"\b(ride history|trip history|past rides|previous rides|last ride|last trip|pichli ride|purani rides|meri rides)\b|پچھلی رائیڈ|میری رائیڈز")),
    ("SUPPORT", re.compile(r"\b(support|complaint|complain|refund|customer care|helpline|shikayat|shikayet|paisay wapas|paise wapas)\b|شکایت|ریفنڈ|سپورٹ")),
    ("BOOK_USUAL", re.compile(r"\b(usual|same as always|as usual|regular trip|my routine|routine wali|hamesha wali|roz ki tarah|usual wali)\b|روز کی طرح|معمول")),
]
QUOTE_WORDS = re.compile(r"\b(how much|price|fare|cost|estimate|quote|kitna|kitne|kitni|kiraya kitna|rate|charges)\b|کتنا|کرایہ کتنا|ریٹ")
BOOK_WORDS = re.compile(r"\b(book|get me|need a|want a|i need|i want|chahiye|chahiyay|bhejo|bhej do|bula do|arrange|ride|cab|taxi|gari|gaari|pick me up|take me|drop me)\b|چاہیے|چاہئے|بک|گاڑی")
TRAVEL_WORDS = re.compile(r"\b(jana|jaana|jani|janay|chalo|jaana hai|le chalo|le jao|pohanchna|pahunchna|go to|going to|head to|heading to|drop me|take me|ride to|cab to|taxi to|to)\b|جانا|چلو|لے چلو")

_TERM_TIME_PRODUCT = re.compile(r"\b(?:tomorrow|today|tonight|tmrw|kal|aaj|parson|abhi|now|asap|at \d|by \d|in \d+)\b", re.I)


def detect_language(text: str) -> str:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return "en"
    ur = sum(1 for c in letters if _URDU_SCRIPT.match(c))
    if ur / len(letters) > 0.3:
        return "ur"
    low = text.lower()
    ro = len(_ROMAN_MARKERS.findall(low))
    en = len(_EN_MARKERS.findall(low))
    # 'to', 'me', 'is' etc. are weak; only call it Roman Urdu when its markers clearly dominate.
    return "roman-ur" if ro >= 2 and ro > en else "en"


def _clean_place(s: str | None) -> str | None:
    if not s:
        return None
    s = re.sub(r"[\"'“”‘’.,!?؟،]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    prev = None
    while prev != s:
        prev = s
        s = FILLER_START.sub("", s).strip()
        s = FILLER_END.sub("", s).strip()
    if not s or len(s) > 60 or len(s) < 2:
        return None
    if re.fullmatch(r"(?:me|my|it|there|here|this|that|wahan|yahan|udhar|idhar|ride|cab|taxi|gari|gaari|car|jana|jaana|jani|janay|chalo|ja|jao|on|at|by)", s, re.I):
        return None
    return s


def _product(low: str) -> tuple[str | None, list[tuple[int, int]]]:
    for code, pat in PRODUCTS:
        m = re.search(pat, low)
        if m:
            return code, [m.span()]
    return None, []


def _places(residual: str) -> tuple[str | None, str | None, float]:
    """Returns (pickup, dropoff, structure_confidence) from text that has had time/product phrases removed."""
    t = residual.strip()
    low = t.lower()
    # ---- Urdu script: "X سے Y تک/جانا"
    m = re.search(r"(.+?)\s+سے\s+(.+?)(?:\s+تک)?(?:\s+(?:جانا|جانے|چلو|لے چلو|پہنچنا|کی گاڑی|کے لیے).*)?$", t)
    if m and _URDU_SCRIPT.search(t):
        return _clean_place(m.group(1)), _clean_place(m.group(2)), 0.93
    m = re.search(r"(.+?)\s+(?:جانا|جانے|چلو|لے چلو|پہنچنا)", t)
    if m and _URDU_SCRIPT.search(t) and " سے " not in t:
        return None, _clean_place(m.group(1)), 0.85
    # ---- English: "from X to Y" / "to Y from X" / "pick me up at X and take me to Y"
    m = re.search(r"\bfrom\s+(.+?)\s+to\s+(.+)$", low)
    if m:
        a, b = m.span(1), m.span(2)
        return _clean_place(t[a[0]:a[1]]), _clean_place(t[b[0]:b[1]]), 0.94
    m = re.search(r"\b(?:pick(?:\s+me)?\s*up|pickup)\s+(?:from|at)\s+(.+?)\s+(?:and\s+)?(?:drop(?:\s+me)?|take\s+me|go|to)\s+(?:off\s+)?(?:at|to)?\s*(.+)$", low)
    if m:
        a, b = m.span(1), m.span(2)
        return _clean_place(t[a[0]:a[1]]), _clean_place(t[b[0]:b[1]]), 0.92
    m = re.search(r"\b(?:to|towards)\s+(.+?)\s+from\s+(.+)$", low)
    if m:
        a, b = m.span(1), m.span(2)
        return _clean_place(t[b[0]:b[1]]), _clean_place(t[a[0]:a[1]]), 0.92
    # ---- Roman Urdu: "X se Y (tak) jana hai"
    m = re.search(r"^(.+?)\s+se\s+(.+?)(?:\s+tak)?(?:\s+(?:jana|jaana|jani|janay|chalo|le chalo|le jao|pohanchna|ki gari|ki ride|ka ride|ke liye|ja|jao)\b.*)?$", low)
    if m and " se " in f" {low} ":
        a, b = m.span(1), m.span(2)
        return _clean_place(t[a[0]:a[1]]), _clean_place(t[b[0]:b[1]]), 0.92
    m = re.search(r"^(.+?)\s+to\s+(.+)$", low)
    if m and not re.search(r"\b(?:take me|drop me|ride|cab|taxi|car|bike|go|going|head|heading|book|price|fare|cost|rate|estimate|quote|way|route|trip|charges)\s*(?:a |an |me )?(?:to)?$", m.group(1)):
        a, b = m.span(1), m.span(2)
        pu, do = _clean_place(t[a[0]:a[1]]), _clean_place(t[b[0]:b[1]])
        if pu and do:
            return pu, do, 0.72
    # ---- destination only: "Y jana hai", "take me to Y", "ride to Y", "drop me at Y", "to Y"
    m = re.search(r"\b(?:take me to|drop me (?:at|to)|ride to|cab to|taxi to|go to|going to|head(?:ing)? to|heading to|book(?: a)? (?:ride|cab|taxi)? ?to|to)\s+(.+)$", low)
    if m:
        a = m.span(1)
        return None, _clean_place(t[a[0]:a[1]]), 0.85
    m = re.search(r"^(.+?)\s+(?:jana|jaana|jani|janay|chalo|le chalo|le jao|pohanchna|ja(?:na)? hai)\b", low)
    if m:
        a = m.span(1)
        return None, _clean_place(t[a[0]:a[1]]), 0.85
    m = re.search(r"^(.+?)\s+(?:tak|ki gari|ki ride|ke liye gari)\b", low)
    if m:
        a = m.span(1)
        return None, _clean_place(t[a[0]:a[1]]), 0.75
    return None, None, 0.0


def parse(text: str, now: datetime, timezone_name: str = "Asia/Karachi", locale: str | None = None) -> dict[str, Any]:
    raw = normalize(text)
    lang = detect_language(raw)
    low = raw.lower()

    # ---- non-booking intents first (they have narrow, unambiguous vocab)
    if re.search(r"\bhelp\b", low) and not re.search(r"\b(book|cab|taxi|ride|gari|gaari|car|bike|jana|jaana|to)\b", low):
        return _result("SAFETY_HELP", lang, 0.8, {}, [])
    for intent, pat in INTENT_PATTERNS:
        if pat.search(low):
            # "cancel the ride at 5" is still CANCEL_RIDE; nothing to extract.
            return _result(intent, lang, 0.88, {}, [])

    now_local = now.astimezone(PKT)
    when = extract_when(raw, now_local)
    residual = strip_spans(raw, when.spans)
    product, pspans = _product(residual.lower())
    if pspans:
        residual = strip_spans(residual, pspans)
    preference = "CHEAPEST" if CHEAPEST.search(residual.lower()) else "FASTEST" if FASTEST.search(residual.lower()) else None
    if preference:
        pat = CHEAPEST if preference == "CHEAPEST" else FASTEST
        residual = pat.sub(" ", residual)
    residual = re.sub(r"\b(?:ka|ki|ke)\s+(?:kiraya|rate|price|fare|kharcha)\b.*$", " ", residual, flags=re.I)
    residual = re.sub(r"\s+(?:kitna|kitne|kitni|kiraya|rate)\b.*$", " ", residual, flags=re.I)
    residual = re.sub(r"\s+", " ", residual).strip()

    pickup, dropoff, structure = _places(residual)
    slots: dict[str, Any] = {
        "pickup": pickup,
        "dropoff": dropoff,
        "datetime": when.when.isoformat() if (when.when and not when.relative_now) else None,
        "datetimeText": when.text,
        "productCode": product,
        "preference": preference,
        "period": when.period,
    }
    has_travel = bool(TRAVEL_WORDS.search(low)) or bool(BOOK_WORDS.search(low))
    is_quote = bool(QUOTE_WORDS.search(low))
    is_now = when.relative_now or when.when is None
    # A time more than ~10 minutes ahead means the user is scheduling, not requesting now.
    scheduled = when.when is not None and not when.relative_now and (when.when - now_local).total_seconds() > 600

    if any(pat.search(low) for _, pat in [INTENT_PATTERNS[6]]):
        return _result("BOOK_USUAL", lang, 0.85, slots, [])

    if dropoff is None and pickup is None and not (has_travel or is_quote):
        return _result("UNKNOWN", lang, 0.15, slots, [])

    if is_quote:
        intent = "QUOTE"
    elif scheduled:
        intent = "SCHEDULE_RIDE"
    elif preference == "CHEAPEST" and dropoff:
        intent = "CHEAPEST"
    elif preference == "FASTEST" and dropoff:
        intent = "FASTEST"
    else:
        intent = "BOOK_RIDE"

    missing: list[str] = []
    if dropoff is None:
        missing.append("dropoff")
    if intent == "SCHEDULE_RIDE" and when.when is None:
        missing.append("datetime")
    if when.when is None and when.text and not when.relative_now:
        # a day/period was given but no clock time, e.g. "kal subah"
        slots["datetimeText"] = when.text
        intent = "SCHEDULE_RIDE"
        missing.append("datetime")

    conf = 0.5 + 0.45 * structure if dropoff else 0.35
    if pickup and dropoff:
        conf = max(conf, structure)
    if when.assumed:
        conf -= 0.08
    if not has_travel and not is_quote and structure < 0.9:
        conf -= 0.15
    if dropoff is None:
        conf = min(conf, 0.6)
    conf = max(0.05, min(0.97, conf))
    _ = is_now
    return _result(intent, lang, round(conf, 2), slots, missing)


def _result(intent: str, lang: str, confidence: float, slots: dict[str, Any], missing: list[str]) -> dict[str, Any]:
    full = {"pickup": None, "dropoff": None, "datetime": None, "datetimeText": None, "productCode": None, "preference": None, "period": None}
    full.update(slots)
    return {"intent": intent, "language": lang, "confidence": confidence, "slots": full, "missing": missing, "engine": "rules-v1"}
