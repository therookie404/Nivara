"""Challenge 2: proactive financial early-warning alerts.

Stateless change detection: given the previous and current assessment,
detect *meaningful* moves in the risk indicators and produce plain-language
alerts with the reason (SHAP drivers) and contributing factors.

Design notes for the evaluation criteria:
- "Meaningful" = a status-band change (with the engine's hysteresis, so no
  flicker) OR a belief move of >= DRIFT_PP without a band change.
- Smaller moves (>= WATCH_PP) become low-key "watch" notes, not alarms.
- Alerts never give financial advice; every alert carries a disclaimer and
  the confidence / data-completeness note so uncertainty is explicit.
"""
import uuid
from datetime import datetime, timezone

from risk_engine import _driver_phrase

DISCLAIMER = (
    "NIVARA's alerts are estimates based on the data you entered, not financial "
    "advice. They describe what the numbers suggest, not what will happen. "
    "Consider speaking to a qualified financial adviser before making big money decisions."
)

DRIFT_PP = 0.10   # belief move that matters on its own
WATCH_PP = 0.05   # worth a quiet note


def _now():
    """UTC timestamp stamped on every alert record."""
    return datetime.now(timezone.utc).isoformat()


def _base(prev_belief, belief, confidence, n_months):
    """Shared envelope every alert carries: ids, before/after beliefs, the
    not-advice disclaimer, and a note when the data window is thin."""
    return {
        "id": "al-" + uuid.uuid4().hex[:8],
        "ts": _now(),
        "belief_before": round(prev_belief, 4) if prev_belief is not None else None,
        "belief_after": round(belief, 4),
        "delta_pp": round((belief - (prev_belief if prev_belief is not None else belief)) * 100, 1),
        "confidence": round(confidence, 3),
        "data_note": (
            f"Based on only {n_months} month{'s' if n_months != 1 else ''} of data — "
            "add more months to sharpen this estimate."
            if n_months < 6 else None
        ),
        "disclaimer": DISCLAIMER,
        "reasons": [],
    }


def _reasons(drivers, direction, k=2):
    """Top-k plain-language driver phrases pushing in `direction` ('up'/'down')."""
    ds = [d for d in drivers if d.get("direction") == direction][:k]
    return [_driver_phrase(d) for d in ds]


def detect_alerts(prev_belief, prev_status, belief, status, drivers,
                  confidence=1.0, n_months=6):
    """Return a list of alert dicts (possibly empty) for this assessment step.

    Compares the previous assessment against the current one and fires at most
    one alert per step, in priority order: band change, large drift, watch note.
    """
    order = {"STABLE": 0, "DRIFTING": 1, "CRITICAL": 2}
    prev_status = prev_status or "STABLE"
    alerts = []

    # First assessment: establish the baseline, nothing to compare against.
    # No alert when there is effectively no stress — a "0% (stable)" baseline
    # notice is just noise for a healthy profile.
    if prev_belief is None:
        if belief < 0.005:  # displays as 0%
            return []
        a = _base(None, belief, confidence, n_months)
        a.update(
            type="baseline", severity="info",
            title="Baseline established",
            message=(
                f"Your starting stress belief is {belief:.0%} ({status.lower()}). "
                "We'll watch for meaningful moves from here and alert you when "
                "the picture changes."
            ),
        )
        return [a]

    delta = belief - prev_belief
    escalated = order[status] > order[prev_status]
    deescalated = order[status] < order[prev_status]

    # ---- alert types: a band change beats raw drift; drift beats watch notes ----
    if escalated:
        a = _base(prev_belief, belief, confidence, n_months)
        a.update(
            type="status_escalated",
            severity="high" if status == "CRITICAL" else "medium",
            title=f"Risk escalated: {prev_status} → {status}",
            message=(
                f"Your stress belief rose from {prev_belief:.0%} to {belief:.0%}, "
                f"moving you into {status}. "
                + ("This is the highest risk band — earlier responses tend to leave more options open."
                   if status == "CRITICAL"
                   else "Catching this drift early leaves more room to respond.")
            ),
            reasons=_reasons(drivers, "up"),
        )
        alerts.append(a)
    elif deescalated:
        a = _base(prev_belief, belief, confidence, n_months)
        a.update(
            type="status_deescalated", severity="positive",
            title=f"Risk eased: {prev_status} → {status}",
            message=(
                f"Your stress belief fell from {prev_belief:.0%} to {belief:.0%}, "
                f"moving you into {status}. Whatever changed is moving the numbers "
                "in the right direction."
            ),
            reasons=_reasons(drivers, "down"),
        )
        alerts.append(a)
    elif abs(delta) >= DRIFT_PP:
        rising = delta > 0
        a = _base(prev_belief, belief, confidence, n_months)
        a.update(
            type="risk_rising" if rising else "risk_falling",
            severity="medium" if rising else "positive",
            title=("Risk rising — no band change yet" if rising
                   else "Risk falling — no band change yet"),
            message=(
                f"Your stress belief moved from {prev_belief:.0%} to {belief:.0%} "
                f"({'+' if rising else ''}{delta:.0%}). "
                + ("Not a band change yet, but the direction is worth watching."
                   if rising else "The trend is improving even though the band hasn't changed.")
            ),
            reasons=_reasons(drivers, "up" if rising else "down"),
        )
        alerts.append(a)
    elif abs(delta) >= WATCH_PP:
        rising = delta > 0
        a = _base(prev_belief, belief, confidence, n_months)
        a.update(
            type="watch", severity="low",
            title="Small shift noted",
            message=(
                f"Stress belief moved from {prev_belief:.0%} to {belief:.0%} — "
                "a small shift, noted for the record. No action implied."
            ),
            reasons=_reasons(drivers, "up" if rising else "down", k=1),
        )
        alerts.append(a)

    return alerts
