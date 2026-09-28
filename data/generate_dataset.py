"""NIVARA synthetic dataset generator.

Generates two artifacts (all money in INR):
  1. synthetic_training.csv -- one row per synthetic user.
     Features are computed from months 1-6, label = did a cash shortfall
     (month-end balance < 0) occur in months 7-12 of the simulated future.
     Labels come from simulated outcomes, not hand-labeling.
  2. demo_personas.json -- 3 hand-crafted demo profiles with full 12-month
     monthly series for the live dashboard demo.

Usage: python3 generate_dataset.py [n_users]
"""
import csv
import json
import os
import sys

import numpy as np

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(42)


# ---------------------------------------------------------------- simulation
def simulate(p, months=12, seed_rng=None):
    r = seed_rng or rng
    bal = p["starting_savings"]
    rec = {"income": [], "expenses": [], "emi": [], "shock": [], "balance": [], "late": []}
    for t in range(months):
        inc = p["base_income"] * ((1 + p["income_trend"]) ** t) * (1 + r.normal(0, p["income_vol"]))
        inc = max(inc, p["base_income"] * 0.10)
        if p.get("delay_prob", 0.0) and r.random() < p["delay_prob"]:
            inc *= 0.45  # client payment delayed this month
        exp = (p["fixed_exp"] + p["var_exp"] * (1 + r.normal(0, 0.08))) * ((1 + p["expense_drift"]) ** t)
        shk = p["shock_scale"] * p["base_income"] if r.random() < p["shock_prob"] else 0.0
        net = inc - exp - p["emi"] - shk
        bal = bal + net
        late = 1 if (net < 0 and r.random() < 0.40) else 0
        rec["income"].append(round(inc, 2))
        rec["expenses"].append(round(exp, 2))
        rec["emi"].append(round(p["emi"], 2))
        rec["shock"].append(round(shk, 2))
        rec["balance"].append(round(bal, 2))
        rec["late"].append(late)
    return rec


def _slope(x):
    x = np.asarray(x, dtype=float)
    s = np.polyfit(np.arange(len(x)), x, 1)[0]
    return s


def features_from(rec):
    inc = np.array(rec["income"][:6])
    exp = np.array(rec["expenses"][:6])
    emi = np.array(rec["emi"][:6])
    shk = np.array(rec["shock"][:6])
    bal = np.array(rec["balance"])
    net = inc - exp - emi - shk
    avg_inc = inc.mean()
    avg_out = exp.mean() + emi.mean()
    eps = 1e-9
    return {
        "avg_income": round(float(avg_inc), 2),
        "income_volatility": round(float(inc.std() / (avg_inc + eps)), 4),
        "income_trend": round(float(_slope(inc) / (avg_inc + eps)), 4),
        "expense_drift": round(float((exp[3:].mean() - exp[:3].mean()) / (exp[:3].mean() + eps)), 4),
        "debt_service_ratio": round(float(emi.mean() / (avg_inc + eps)), 4),
        "runway_months": round(float(bal[5] / (avg_out + eps)), 2),
        "savings_rate": round(float(net.mean() / (avg_inc + eps)), 4),
        "late_payments": int(sum(rec["late"][:6])),
        "neg_flow_months": int((net < 0).sum()),
    }


def label_from(rec):
    # shortfall = month-end balance below zero at any point in months 7-12
    return int(min(rec["balance"][6:]) < 0)


# ------------------------------------------------------- persona samplers
def sample_params():
    u = rng.random()
    if u < 0.40:
        persona = "freelancer"
        base = rng.uniform(40000, 80000)
        trend = rng.uniform(-0.06, -0.02) if rng.random() < 0.40 else rng.uniform(-0.01, 0.015)
        p = {
            "persona": persona, "base_income": base,
            "income_trend": trend, "income_vol": rng.uniform(0.25, 0.45),
            "fixed_exp": rng.uniform(12000, 20000), "var_exp": rng.uniform(10000, 20000),
            "expense_drift": rng.uniform(0.0, 0.03), "emi": rng.uniform(0, 8000),
            "shock_prob": rng.uniform(0.08, 0.15), "shock_scale": rng.uniform(0.3, 0.8),
        }
        monthly_out = p["fixed_exp"] + p["var_exp"] + p["emi"]
        p["starting_savings"] = rng.uniform(0.3, 1.5) * monthly_out
    elif u < 0.70:
        persona = "small_biz"
        base = rng.uniform(100000, 250000)
        trend = rng.uniform(-0.04, -0.01) if rng.random() < 0.25 else rng.uniform(-0.01, 0.02)
        p = {
            "persona": persona, "base_income": base,
            "income_trend": trend, "income_vol": rng.uniform(0.15, 0.30),
            "delay_prob": rng.uniform(0.10, 0.20),
            "fixed_exp": rng.uniform(40000, 80000), "var_exp": rng.uniform(20000, 50000),
            "expense_drift": rng.uniform(0.0, 0.02), "emi": rng.uniform(10000, 30000),
            "shock_prob": rng.uniform(0.05, 0.12), "shock_scale": rng.uniform(0.2, 0.6),
        }
        monthly_out = p["fixed_exp"] + p["var_exp"] + p["emi"]
        p["starting_savings"] = rng.uniform(1.0, 3.0) * monthly_out
    else:
        persona = "salaried"
        base = rng.uniform(50000, 120000)
        p = {
            "persona": persona, "base_income": base,
            "income_trend": rng.uniform(-0.005, 0.01), "income_vol": rng.uniform(0.03, 0.08),
            "fixed_exp": rng.uniform(20000, 40000), "var_exp": rng.uniform(15000, 30000),
            # lifestyle creep: 20% get a steep upward drift
            "expense_drift": rng.uniform(0.03, 0.06) if rng.random() < 0.20 else rng.uniform(0.0, 0.02),
            "emi": rng.uniform(10000, 35000),
            "shock_prob": rng.uniform(0.03, 0.08), "shock_scale": rng.uniform(0.3, 0.7),
        }
        monthly_out = p["fixed_exp"] + p["var_exp"] + p["emi"]
        p["starting_savings"] = rng.uniform(1.0, 4.0) * monthly_out
    if rng.random() < 0.45:
        # tight budget: expenses close to income -> more users near the edge
        p["fixed_exp"] *= 1.35
        p["var_exp"] *= 1.35
        p["starting_savings"] *= 1.35
    return p


# ------------------------------------------------------------------ main
def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

    rows = []
    for i in range(n):
        p = sample_params()
        rec = simulate(p)
        feat = features_from(rec)
        feat["user_id"] = f"u{i:05d}"
        feat["persona"] = p["persona"]
        feat["label"] = label_from(rec)
        rows.append(feat)

    cols = ["user_id", "persona", "avg_income", "income_volatility", "income_trend",
            "expense_drift", "debt_service_ratio", "runway_months", "savings_rate",
            "late_payments", "neg_flow_months", "label"]
    csv_path = os.path.join(OUT_DIR, "synthetic_training.csv")
    with open(csv_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r_ in rows:
            w.writerow({c: r_[c] for c in cols})

    personas = build_demo_personas()
    json_path = os.path.join(OUT_DIR, "demo_personas.json")
    with open(json_path, "w") as f:
        json.dump(personas, f, indent=2)

    # summary
    labels = np.array([r_["label"] for r_ in rows])
    print(f"users: {n} -> {csv_path}")
    print(f"label rate (shortfall in months 7-12): {labels.mean():.1%}")
    for pers in ["freelancer", "small_biz", "salaried"]:
        m = np.array([r_["persona"] == pers for r_ in rows])
        print(f"  {pers:10s} n={m.sum():5d}  label_rate={labels[m].mean():.1%}")
    runways = np.array([r_["runway_months"] for r_ in rows])
    print(f"avg runway | label=1: {runways[labels == 1].mean():.2f} mo | "
          f"label=0: {runways[labels == 0].mean():.2f} mo")
    print(f"demo personas -> {json_path}")


def build_demo_personas():
    specs = [
        {
            "id": "demo_stable", "name": "Meera", "city": "Pune", "type": "salaried",
            "storyline": "Steady salary, disciplined spending, healthy savings buffer. The calm baseline.",
            "params": {
                "persona": "salaried", "base_income": 80000, "income_trend": 0.005,
                "income_vol": 0.05, "fixed_exp": 20000, "var_exp": 18000,
                "expense_drift": 0.005, "emi": 10000, "shock_prob": 0.03, "shock_scale": 0.5,
                "starting_savings": 200000.0,
            },
        },
        {
            "id": "demo_drifting", "name": "Arjun", "city": "Mumbai", "type": "freelancer",
            "storyline": "Gig income wobbling while expenses creep up. Runway thinning — watch it.",
            "params": {
                "persona": "freelancer", "base_income": 70000, "income_trend": -0.01,
                "income_vol": 0.18, "fixed_exp": 22000, "var_exp": 24000,
                "expense_drift": 0.025, "emi": 12000, "shock_prob": 0.08, "shock_scale": 0.5,
                "starting_savings": 75000.0,
            },
        },
        {
            "id": "demo_critical", "name": "Rahul", "city": "Bengaluru", "type": "salaried",
            "storyline": "Stable salary but lifestyle creep (+4%/month expenses) and a big EMI. Storm incoming.",
            "params": {
                "persona": "salaried", "base_income": 90000, "income_trend": 0.002,
                "income_vol": 0.05, "fixed_exp": 28000, "var_exp": 26000,
                "expense_drift": 0.05, "emi": 32000, "shock_prob": 0.05, "shock_scale": 0.5,
                "starting_savings": 86000.0,
            },
        },
    ]
    out = {"personas": []}
    for i, s in enumerate(specs):
        rec = simulate(s["params"], seed_rng=np.random.default_rng(100 + i))
        months = [
            {"month": t + 1, "income": rec["income"][t], "expenses": rec["expenses"][t],
             "emi": rec["emi"][t], "shock": rec["shock"][t],
             "balance": rec["balance"][t], "late_payment": rec["late"][t]}
            for t in range(12)
        ]
        out["personas"].append({
            "id": s["id"], "name": s["name"], "city": s["city"], "type": s["type"],
            "storyline": s["storyline"], "params": s["params"], "months": months,
            "features_6mo": features_from(rec),
            "shortfall_in_future": bool(label_from(rec)),
        })
    return out


if __name__ == "__main__":
    main()
