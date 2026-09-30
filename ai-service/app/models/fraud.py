"""Fraud risk. Deterministic rules mirroring backend/src/modules/fraud/fraud.rules.ts (parity-tested).

Output is INTERNAL ONLY and never auto-suspends anyone; the backend records it for human review.
"""
from __future__ import annotations

from typing import Any

MODEL_NAME = "fraud-rules"
MODEL_VERSION = "v1"


def evaluate_rules(s: dict[str, float]) -> list[dict[str, Any]]:
    g = lambda k: s.get(k, 0)  # noqa: E731 - missing signals count as zero
    hits: list[dict[str, Any]] = []

    def add(rule: str, weight: float, reason: str) -> None:
        hits.append({"rule": rule, "weight": weight, "reason": reason})

    if g("accountsOnSameDevice") >= 3:
        add("DEVICE_MULTI_ACCOUNT", min(40, 15 + (g("accountsOnSameDevice") - 3) * 8), f"{int(g('accountsOnSameDevice'))} accounts share a device")
    if g("cancellations24h") >= 4:
        add("EXCESSIVE_CANCELLATIONS", min(30, 10 + (g("cancellations24h") - 4) * 5), f"{int(g('cancellations24h'))} passenger cancellations in 24h")
    if g("driverCancellations24h") >= 3:
        add("DRIVER_CANCEL_PATTERN", min(30, 10 + (g("driverCancellations24h") - 3) * 6), f"{int(g('driverCancellations24h'))} driver cancellations in 24h")
    if g("paymentFailures24h") >= 3:
        add("PAYMENT_FAILURES", min(35, 15 + (g("paymentFailures24h") - 3) * 7), f"{int(g('paymentFailures24h'))} failed payments in 24h")
    if g("gpsJumps24h") >= 5:
        add("GPS_SPOOFING", min(45, 20 + (g("gpsJumps24h") - 5) * 4), f"{int(g('gpsJumps24h'))} implausible location jumps today")
    if g("promoRedemptions7d") >= 3 and g("accountAgeDays") < 14:
        add("PROMO_ABUSE", 25, f"{int(g('promoRedemptions7d'))} promo redemptions on an account {int(g('accountAgeDays'))} days old")
    if g("referralsWithNoRides") >= 5:
        add("REFERRAL_FARMING", min(40, 20 + (g("referralsWithNoRides") - 5) * 4), f"{int(g('referralsWithNoRides'))} referred accounts never completed a ride")
    if g("repeatPairShortTrips7d") >= 3:
        add("COLLUSION_SHORT_TRIPS", min(45, 25 + (g("repeatPairShortTrips7d") - 3) * 5), f"{int(g('repeatPairShortTrips7d'))} short trips with the same counterpart in 7 days")
    return hits


def risk_level(score: float) -> str:
    return "HIGH" if score >= 60 else "MEDIUM" if score >= 30 else "LOW"


def score_signals(signals: dict[str, float]) -> dict[str, Any]:
    hits = evaluate_rules(signals)
    score = min(100, sum(h["weight"] for h in hits))
    return {"level": risk_level(score), "score": score, "reasons": [h["reason"] for h in hits], "rules": [h["rule"] for h in hits], "model": f"{MODEL_NAME}@{MODEL_VERSION}"}
