"""Date/time phrase extraction for English, Roman Urdu and Urdu script. All times are Pakistan local time (UTC+5)."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

PKT = timezone(timedelta(hours=5))

URDU_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")

DAY_OFFSET = {
    "today": 0, "aaj": 0, "آج": 0,
    "tomorrow": 1, "tmrw": 1, "tmr": 1, "kal": 1, "کل": 1,
    "parson": 2, "parso": 2, "perso": 2, "پرسوں": 2,
}
WEEKDAYS = {  # Monday = 0
    "monday": 0, "somwar": 0, "peer": 0, "پیر": 0,
    "tuesday": 1, "mangal": 1, "منگل": 1,
    "wednesday": 2, "budh": 2, "بدھ": 2,
    "thursday": 3, "jumerat": 3, "jumeraat": 3, "جمعرات": 3,
    "friday": 4, "juma": 4, "jumma": 4, "جمعہ": 4,
    "saturday": 5, "hafta": 5, "ہفتہ": 5,
    "sunday": 6, "itwar": 6, "itvar": 6, "اتوار": 6,
}
MORNING = {"morning", "subah", "subha", "sabah", "صبح"}
AFTERNOON = {"afternoon", "dopahar", "dopehar", "دوپہر"}
EVENING = {"evening", "shaam", "sham", "شام"}
NIGHT = {"night", "tonight", "raat", "rat", "رات"}
NOW_WORDS = re.compile(r"\b(right now|now|abhi|asap|immediately|foran|jaldi se abhi)\b|ابھی|فوراً|فورا")

_TIME = r"(\d{1,2})(?:[:.](\d{2}))?"
_FRACTION = {"sawa": (0, 15), "saade": (0, 30), "saarhe": (0, 30), "sarhe": (0, 30), "paune": (-1, 45), "pone": (-1, 45), "سوا": (0, 15), "ساڑھے": (0, 30), "پونے": (-1, 45)}
_SPECIAL_HOURS = {"dhai": (2, 30), "dhaai": (2, 30), "derh": (1, 30), "dedh": (1, 30), "ڈھائی": (2, 30), "ڈیڑھ": (1, 30)}
_BAJE = r"(?:baje|bajay|bajey|baj|بجے|بجکر)"
_AMPM = r"(?:a\.?m\.?|p\.?m\.?)"


@dataclass
class WhenResult:
    when: datetime | None
    text: str | None
    assumed: bool  # the am/pm or day had to be assumed
    period: str | None
    spans: list[tuple[int, int]]
    relative_now: bool = False


def normalize(text: str) -> str:
    return text.translate(URDU_DIGITS).replace("‌", " ").replace("‏", "").strip()


def _mask(text: str, spans: list[tuple[int, int]]) -> str:
    chars = list(text)
    for a, b in spans:
        for i in range(a, b):
            chars[i] = " "
    return re.sub(r"\s+", " ", "".join(chars)).strip()


def strip_spans(text: str, spans: list[tuple[int, int]]) -> str:
    return _mask(text, spans)


def _period_of(words: set[str]) -> str | None:
    if words & MORNING: return "MORNING"
    if words & AFTERNOON: return "AFTERNOON"
    if words & EVENING: return "EVENING"
    if words & NIGHT: return "NIGHT"
    return None


def _to_24h(hour: int, period: str | None, ampm: str | None) -> tuple[int, bool]:
    """Returns (hour24, assumed)."""
    if ampm:
        pm = ampm.lower().startswith("p")
        return (hour % 12) + (12 if pm else 0), False
    if hour >= 13:
        return hour % 24, False
    if period == "MORNING":
        return (0 if hour == 12 else hour), False
    if period == "AFTERNOON":
        return (12 if hour in (12, 0) else (hour + 12 if hour < 12 else hour)), False
    if period == "EVENING":
        return (hour + 12 if hour < 12 else hour), False
    if period == "NIGHT":
        if hour == 12: return 0, False
        if hour <= 4: return hour, False       # "raat 2 baje" = 2 am
        return hour + 12, False                 # "raat 9 baje" = 9 pm
    return hour, True                            # bare clock hour: am/pm unknown


def extract_when(text: str, now: datetime) -> WhenResult:
    """Finds the booking time in text. `now` must be timezone-aware."""
    now_local = now.astimezone(PKT)
    low = text.lower()
    spans: list[tuple[int, int]] = []

    # ---- relative: "in 30 minutes", "30 minute mein", "آدھے گھنٹے میں"
    m = re.search(r"\bin\s+(\d{1,3})\s*(min(?:ute)?s?|hours?|hrs?|h)\b", low) or re.search(
        r"(\d{1,3})\s*(min(?:ute)?s?|ghant[ae]|ghanta|منٹ|گھنٹے|گھنٹہ)\s*(?:mein|me|baad|میں|بعد)", low)
    if m:
        n = int(m.group(1))
        unit = m.group(2)
        delta = timedelta(hours=n) if unit.startswith(("h", "gh", "گھ")) else timedelta(minutes=n)
        return WhenResult((now_local + delta).replace(second=0, microsecond=0), m.group(0), False, None, [m.span()])
    m = re.search(r"\b(half an hour|aadhe ghante|aadha ghanta)\b|آدھے گھنٹے", low)
    if m and ("mein" in low or "in " in low or "میں" in low or "baad" in low):
        return WhenResult(now_local + timedelta(minutes=30), m.group(0), False, None, [m.span()])

    nm = NOW_WORDS.search(low)
    if nm:
        return WhenResult(now_local, nm.group(0), False, None, [nm.span()], relative_now=True)

    # ---- day
    day_offset: int | None = None
    day_assumed = False
    words = list(re.finditer(r"[^\W\d_]+", low))
    wordset = {w.group(0) for w in words}
    for w in words:
        t = w.group(0)
        if t in DAY_OFFSET and not (t == "kal" and re.search(r"\bkal\b.*\b(tha|thi|the|gaya|gayi)\b", low)):
            day_offset = DAY_OFFSET[t]; spans.append(w.span()); break
    if day_offset is None and "day after tomorrow" in low:
        i = low.index("day after tomorrow"); day_offset = 2; spans.append((i, i + 18))
    if day_offset is None:
        for w in words:
            if w.group(0) in WEEKDAYS:
                target = WEEKDAYS[w.group(0)]
                day_offset = (target - now_local.weekday()) % 7 or 7
                spans.append(w.span())
                prev = re.search(r"(next|coming|agle|agla|on)\s+$", low[: w.start()])
                if prev:
                    spans.append(prev.span(1))
                break
    period = _period_of(wordset)
    for w in words:
        if w.group(0) in (MORNING | AFTERNOON | EVENING | NIGHT):
            spans.append(w.span())

    # ---- clock time
    hour = minute = None
    ampm = None
    frac = re.search(rf"\b({'|'.join(k for k in _FRACTION if k.isascii())})\s+(\d{{1,2}})\b|({'|'.join(k for k in _FRACTION if not k.isascii())})\s+(\d{{1,2}})", low)
    special = re.search(rf"\b({'|'.join(k for k in _SPECIAL_HOURS if k.isascii())})\b|({'|'.join(k for k in _SPECIAL_HOURS if not k.isascii())})", low)
    t = re.search(rf"(?<![\d:.])(?:at\s+|by\s+|around\s+)?{_TIME}\s*({_AMPM})", low) or re.search(
        rf"(?<![\d:.]){_TIME}\s*{_BAJE}", low) or re.search(rf"\b(?:at|by|around)\s+{_TIME}\b", low) or re.search(
        r"(?<![\d:.])(\d{1,2}):(\d{2})(?![\d:])", low)
    if frac:
        key = frac.group(1) or frac.group(3)
        base = int(frac.group(2) or frac.group(4))
        add_h, minute = _FRACTION[key]
        hour = base + add_h if add_h >= 0 else base - 1
        spans.append(frac.span())
        if re.search(rf"{_BAJE}", low):
            bj = re.search(rf"{_BAJE}", low); spans.append(bj.span())
    elif special:
        key = special.group(1) or special.group(2)
        hour, minute = _SPECIAL_HOURS[key]
        spans.append(special.span())
        bj = re.search(rf"{_BAJE}", low)
        if bj: spans.append(bj.span())
    elif t:
        hour = int(t.group(1)); minute = int(t.group(2) or 0)
        am = re.search(rf"{_AMPM}", t.group(0))
        ampm = am.group(0) if am else None
        spans.append(t.span())
        if hour > 24 or minute > 59:
            hour = None
    if hour is None and day_offset is None and period is None:
        return WhenResult(None, None, False, None, [])
    if hour is None:
        # "kal subah" with no hour: day known but time missing -> caller asks for the time
        return WhenResult(None, _slice(text, spans), False, period, spans)

    h24, assumed = _to_24h(hour, period, ampm)
    if h24 == 24: h24 = 0
    base_day = (now_local + timedelta(days=day_offset or 0)).replace(hour=h24, minute=minute or 0, second=0, microsecond=0)
    if assumed and day_offset is None:
        # Bare clock time, am/pm unknown: pick the nearest future occurrence on a 12-hour clock.
        cands = [base_day + timedelta(hours=k) for k in (0, 12)] + [base_day + timedelta(days=1), base_day + timedelta(days=1, hours=12)]
        base_day = next((c for c in sorted(cands) if c > now_local + timedelta(minutes=1)), base_day)
    elif day_offset is None and base_day <= now_local:
        base_day += timedelta(days=1)
        day_assumed = True
    return WhenResult(base_day, _slice(text, spans), assumed or day_assumed, period, spans)


def _slice(text: str, spans: list[tuple[int, int]]) -> str | None:
    if not spans:
        return None
    a, b = min(s[0] for s in spans), max(s[1] for s in spans)
    return text[a:b].strip() or None
