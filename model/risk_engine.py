"""NIVARA risk engine: scoring + belief tracking + plain-language explanations.

Stateless functions -- the caller (API / frontend) passes prev_belief and
prev_status each time. Handles partial data (3-5 months) by lowering the
update weight instead of failing.

Pipeline per call:
  months + starting_balance -> compute_features -> score_features (XGBoost+SHAP)
      -> update_belief (smoothing + confirmation + hysteresis) -> explain
"""
import json
import os

import numpy as np
import xgboost as xgb

HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, "features.json")) as _f:
    FEATURES = json.load(_f)

DRIFT_T = 0.40   # belief >= this -> DRIFTING
CRIT_T = 0.70    # belief >= this -> CRITICAL
# why hysteresis: without it the status would flicker between bands on tiny
# month-to-month moves; recovery must be clearly below the threshold to count
HYST = 0.10      # must drop this far below a threshold to de-escalate

_model = None
_explainer = None


def get_model():
    """Lazy-load the trained booster once; every call reuses the same object."""
    global _model
    if _model is None:
        _model = xgb.XGBClassifier()
        _model.load_model(os.path.join(HERE, "model.ubj"))
    return _model


def get_explainer():
    """Lazy-load the SHAP explainer (imported late: shap is a heavy dependency)."""
    global _explainer
    if _explainer is None:
        import shap
        _explainer = shap.TreeExplainer(get_model())
    return _explainer


# ------------------------------------------------------------ features
def compute_features(starting_balance, months):
    """Build the 9 model features from raw monthly data.

    months: list of dicts with income, expenses, emi, shock (opt), late (opt),
            oldest first. Uses the last up to 6 months.
    starting_balance: savings balance just before months[0].
    Returns (features_dict, n_months_used).
    """
    if len(months) < 3:
        raise ValueError("need at least 3 months of data")
    balances, bal = [], float(starting_balance)
    for m in months:
        bal += m["income"] - m["expenses"] - m["emi"] - m.get("shock", 0)
        balances.append(bal)

    w = months[-6:]
    wb = balances[-6:]
    n = len(w)
    inc = np.array([m["income"] for m in w], float)
    exp = np.array([m["expenses"] for m in w], float)
    emi = np.array([m["emi"] for m in w], float)
    shk = np.array([m.get("shock", 0) for m in w], float)
    late = np.array([m.get("late", 0) for m in w], int)
    net = inc - exp - emi - shk

    avg_inc, avg_out, eps = inc.mean(), exp.mean() + emi.mean(), 1e-9
    half = max(n // 2, 1)
    slope = float(np.polyfit(np.arange(n), inc, 1)[0]) if n >= 2 else 0.0
    feats = {
        "avg_income": float(avg_inc),
        "income_volatility": float(inc.std() / (avg_inc + eps)),
        "income_trend": float(slope / (avg_inc + eps)),
        "expense_drift": float((exp[half:].mean() - exp[:half].mean()) / (exp[:half].mean() + eps)),
        "debt_service_ratio": float(emi.mean() / (avg_inc + eps)),
        "runway_months": float(wb[-1] / (avg_out + eps)),
        "savings_rate": float(net.mean() / (avg_inc + eps)),
        "late_payments": int(late.sum()),
        "neg_flow_months": int((net < 0).sum()),
    }
    return feats, n


# -------------------------------------------------------------- scoring
def score_features(feats):
    """Return (risk_probability, drivers sorted by |SHAP|).

    Each driver: {feature, value, shap, direction: 'up'|'down'} where 'up'
    means the feature pushes risk higher.
    """
    x = np.array([[feats[f] for f in FEATURES]])
    prob = float(get_model().predict_proba(x)[0, 1])
    sv = get_explainer().shap_values(x)[0]
    drivers = [
        {"feature": f, "value": float(feats[f]), "shap": float(v),
         "direction": "up" if v > 0 else "down"}
        for f, v in sorted(zip(FEATURES, sv), key=lambda t: -abs(t[1]))
    ]
    return prob, drivers


# ------------------------------------------------------ belief tracking
def update_belief(prev_belief, score, n_months=6, prev_status="STABLE"):
    """Smooth the raw score into a belief that resists one-month noise.

    - Exponential smoothing; less complete data -> smaller update weight.
    - Escalation needs the fresh score to confirm (no panic on inertia).
    - De-escalation needs belief to fall HYST below the threshold.
    Returns (belief, status, confidence).
    """
    confidence = min(1.0, n_months / 6)
    alpha = 0.35 + 0.35 * confidence          # 0.35 (thin data) .. 0.70 (full data)
    base = score if prev_belief is None else prev_belief
    belief = alpha * score + (1 - alpha) * base

    def level(b):
        return "CRITICAL" if b >= CRIT_T else "DRIFTING" if b >= DRIFT_T else "STABLE"

    order = {"STABLE": 0, "DRIFTING": 1, "CRITICAL": 2}
    raw, prev = level(belief), prev_status or "STABLE"
    status = raw
    if order[raw] > order[prev]:
        need = CRIT_T if raw == "CRITICAL" else DRIFT_T
        if score < need:                       # fresh data doesn't confirm -> hold
            status = prev
    elif order[raw] < order[prev]:
        t = (CRIT_T if prev == "CRITICAL" else DRIFT_T) - HYST
        status = raw if belief < t else prev   # hysteresis on recovery
    return float(belief), status, float(confidence)


# ----------------------------------------------------------- explanation
def _driver_phrase(d):
    """One plain-language phrase describing a single SHAP driver."""
    f, v = d["feature"], d["value"]
    if f == "runway_months":
        return f"savings cover only {v:.1f} months of expenses" if v < 3 else f"a {v:.1f}-month savings buffer"
    if f == "savings_rate":
        return f"spending {abs(v):.0%} more than earned" if v < 0 else f"saving {v:.0%} of income"
    if f == "debt_service_ratio":
        return f"{v:.0%} of income goes to debt payments"
    if f == "income_volatility":
        return f"income swings ±{v:.0%} month to month"
    if f == "income_trend":
        return f"income is falling {abs(v):.1%}/month" if v < 0 else f"income is growing {v:.1%}/month"
    if f == "expense_drift":
        return f"expenses grew {v:.0%} over the period" if v > 0 else f"expenses shrank {abs(v):.0%}"
    if f == "late_payments":
        return f"{int(v)} late/missed payment{'s' if v != 1 else ''}"
    if f == "neg_flow_months":
        return f"{int(v)} months where spending beat income"
    if f == "avg_income":
        return f"monthly income around ₹{v:,.0f}"
    return f"{f} = {v:.2f}"


def _is_favourable(d):
    """True only if the driver's absolute value is genuinely good news."""
    f, v = d["feature"], d["value"]
    return {
        "runway_months": v >= 3,
        "savings_rate": v > 0.02,
        "debt_service_ratio": v < 0.30,
        "income_volatility": v < 0.15,
        "income_trend": v > 0,
        "expense_drift": v <= 0,
        "late_payments": v == 0,
        "neg_flow_months": v == 0,
    }.get(f, False)


def explain(belief, status, drivers, feats, prev_belief=None):
    """Template-based plain-language explanation (no LLM needed offline).

    Describes only pre-computed numbers -- never invents new ones.
    """
    up = [d for d in drivers if d["direction"] == "up"][:2]
    favourable = [d for d in drivers if d["direction"] == "down" and _is_favourable(d)][:1]

    if status == "STABLE":
        base = f"Finances look STABLE (stress belief {belief:.0%})."
        if favourable:
            base += " Healthy signs: " + _driver_phrase(favourable[0]) + "."
        else:
            base += " No significant risk drivers right now."
    elif status == "DRIFTING":
        base = f"Early warning: finances are DRIFTING toward stress (belief {belief:.0%})."
    else:
        base = f"High stress risk: CRITICAL (belief {belief:.0%})."

    if up and status != "STABLE":
        base += " Main risk drivers: " + "; ".join(_driver_phrase(d) for d in up) + "."
    if favourable and status != "STABLE":
        base += " Working in your favour: " + _driver_phrase(favourable[0]) + "."

    if prev_belief is not None:
        delta = belief - prev_belief
        if abs(delta) >= 0.05:
            base += f" Trend: risk {'rose' if delta > 0 else 'fell'} from {prev_belief:.0%} last month."
        else:
            base += " Trend: roughly unchanged from last month."
    return base


def assess(starting_balance, months, prev_belief=None, prev_status="STABLE"):
    """One-call pipeline: features -> score -> belief -> explanation."""
    feats, n = compute_features(starting_balance, months)
    prob, drivers = score_features(feats)
    belief, status, confidence = update_belief(prev_belief, prob, n, prev_status)
    return {
        "risk_score": round(prob, 4),
        "belief": round(belief, 4),
        "status": status,
        "confidence": round(confidence, 3),
        "drivers": drivers[:5],
        "features": {k: round(float(v), 4) for k, v in feats.items()},
        "explanation": explain(belief, status, drivers, feats, prev_belief),
    }
