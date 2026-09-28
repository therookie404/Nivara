"""NIVARA scoring API — the bridge between the React frontend and the model.

Serves the hackathon fintech prototype (early financial-stress detection +
recovery planning): risk scoring with belief tracking, proactive alerts, and
the Monte Carlo what-if simulator. Stateless — the frontend passes
prev_belief/prev_status on every call.

Run: uvicorn app:app --port 8000 (from this dir).
"""
import json
import os
import sys
from typing import Dict, List, Optional

# make sibling packages importable regardless of how uvicorn is launched
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "model"))
sys.path.insert(0, os.path.join(_HERE, "..", "simulator"))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import risk_engine as re
import alert_engine as ae
import engine as sim

app = FastAPI(title="NIVARA risk API", version="0.1.0")
# wide-open CORS: hackathon prototype, the Vite frontend runs on another
# localhost port during development and demos
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")


# ---- request models (validated by pydantic before any logic runs) ----
class Month(BaseModel):
    income: float = Field(gt=0)
    expenses: float = Field(ge=0)
    emi: float = 0
    shock: float = 0
    late: int = 0


class ScoreRequest(BaseModel):
    starting_balance: float
    months: List[Month]                      # oldest first, >= 3
    prev_belief: Optional[float] = None
    prev_status: Optional[str] = "STABLE"


class FeatureScoreRequest(BaseModel):
    features: Dict[str, float]               # the 9 model features
    prev_belief: Optional[float] = None
    prev_status: Optional[str] = "STABLE"


# ---- endpoints ----
@app.get("/health")
def health():
    """Liveness check; also tells the frontend the feature list and band thresholds."""
    return {"ok": True, "features": re.FEATURES,
            "thresholds": {"drifting": re.DRIFT_T, "critical": re.CRIT_T}}


@app.get("/personas")
def personas():
    """Curated demo personas (Meera/Arjun/Rahul) with pre-scored features for the public demo."""
    with open(os.path.join(DATA, "demo_personas.json")) as f:
        return json.load(f)


# ---- simulation request models ----
class Scenario(BaseModel):
    starting_balance: float
    base_income: float = Field(gt=0)
    income_trend: float = 0
    income_vol: float = 0
    fixed_exp: float = Field(ge=0)
    var_exp: float = Field(ge=0)
    expense_drift: float = 0
    emi: float = 0
    shock_prob: float = 0
    shock_scale: float = 0
    delay_prob: float = 0


class Variant(BaseModel):
    name: str
    changes: Dict[str, float]


class SimulateRequest(BaseModel):
    base: Scenario
    variants: List[Variant] = []
    months: int = 12
    n_sims: int = 500


@app.post("/simulate")
def simulate(req: SimulateRequest):
    """What-if simulator: project base + variants, compare indicators.

    Receives a base scenario plus named variants (each a dict of changed
    assumptions); returns per-scenario projections and a comparison table
    against the base case.
    """
    if not (1 <= req.months <= 36):
        raise HTTPException(status_code=400, detail="months must be 1-36")
    if not (50 <= req.n_sims <= 5000):
        raise HTTPException(status_code=400, detail="n_sims must be 50-5000")
    try:
        return sim.run_whatif(req.base.model_dump(),
                              [v.model_dump() for v in req.variants],
                              months=req.months, n_sims=req.n_sims)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/score")
def score(req: ScoreRequest):
    """Score from raw monthly data. Frontend sends months; we do the rest."""
    try:
        result = re.assess(req.starting_balance,
                           [m.model_dump() for m in req.months],
                           req.prev_belief, req.prev_status or "STABLE")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # Challenge 2: proactive early-warning alerts on meaningful changes.
    # alerts use the same up-to-6-month window the model scores on
    n_months = min(len(req.months), 6)
    result["alerts"] = ae.detect_alerts(
        req.prev_belief, req.prev_status or "STABLE",
        result["belief"], result["status"], result["drivers"],
        result["confidence"], n_months)
    return result


@app.post("/score-features")
def score_features(req: FeatureScoreRequest):
    """Score from precomputed features (used by the what-if simulator)."""
    missing = [f for f in re.FEATURES if f not in req.features]
    if missing:
        raise HTTPException(status_code=400, detail=f"missing features: {missing}")
    prob, drivers = re.score_features(req.features)
    belief, status, conf = re.update_belief(req.prev_belief, prob, 6,
                                            req.prev_status or "STABLE")
    return {
        "risk_score": round(prob, 4),
        "belief": round(belief, 4),
        "status": status,
        "confidence": round(conf, 3),
        "drivers": drivers[:5],
        "explanation": re.explain(belief, status, drivers, req.features, req.prev_belief),
    }
