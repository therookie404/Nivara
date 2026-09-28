"""Train NIVARA's XGBoost stress-detection model.

Reads ../data/synthetic_training.csv, trains a classifier to predict
shortfall in months 7-12 from features computed over months 1-6.

Outputs (in this directory):
  model.ubj            trained XGBoost booster (native format)
  features.json        ordered feature list
  metrics.json         test-set metrics
  shap_importance.json mean |SHAP| per feature (global explanation)
  shap_summary.png     SHAP beeswarm plot for the deck (if matplotlib present)

Also prints: classification metrics, per-persona demo scores with top
SHAP drivers, and lead-time analysis (how many months of warning the
model gives before a shortfall).

Usage: ~/workspace/nivara/venv/bin/python train.py
"""
import json
import os
import sys

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import (accuracy_score, average_precision_score,
                             confusion_matrix, f1_score, precision_score,
                             recall_score, roc_auc_score)
from sklearn.model_selection import train_test_split

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")
sys.path.insert(0, DATA)
# reuse the same synthetic-data generator for the lead-time check below
import generate_dataset as gen  # noqa: E402

FEATURES = ["avg_income", "income_volatility", "income_trend", "expense_drift",
            "debt_service_ratio", "runway_months", "savings_rate",
            "late_payments", "neg_flow_months"]
LABEL = "label"
SEED = 42  # fixed seed -> retrains, splits and demos are reproducible


def main():
    """Full training + evaluation + reporting run. Writes all artifacts to model/."""
    # ---- Load data + train the classifier ----
    df = pd.read_csv(os.path.join(DATA, "synthetic_training.csv"))
    X = df[FEATURES].values
    y = df[LABEL].values
    print(f"loaded {len(df)} users, positive rate {y.mean():.1%}")

    Xtr, Xte, ytr, yte = train_test_split(
        X, y, test_size=0.2, random_state=SEED, stratify=y)

    neg, pos = (ytr == 0).sum(), (ytr == 1).sum()
    clf = xgb.XGBClassifier(
        n_estimators=300, max_depth=5, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8, reg_lambda=1.0,
        # upweight the minority class: for early warning, missing a crisis
        # costs more than a false alarm
        scale_pos_weight=neg / pos, eval_metric="logloss",
        random_state=SEED, n_jobs=-1,
    )
    clf.fit(Xtr, ytr)
    proba = clf.predict_proba(Xte)[:, 1]
    pred = (proba >= 0.5).astype(int)

    metrics = {
        "accuracy": round(float(accuracy_score(yte, pred)), 4),
        "precision": round(float(precision_score(yte, pred)), 4),
        "recall": round(float(recall_score(yte, pred)), 4),
        "f1": round(float(f1_score(yte, pred)), 4),
        "roc_auc": round(float(roc_auc_score(yte, proba)), 4),
        "pr_auc": round(float(average_precision_score(yte, proba)), 4),
        "confusion_matrix": confusion_matrix(yte, pred).tolist(),  # [[tn,fp],[fn,tp]]
        "n_test": int(len(yte)),
    }
    print("\n-- test metrics --")
    for k, v in metrics.items():
        print(f"  {k}: {v}")

    # high-recall operating point (early warning wants to miss few crises)
    for thr in (0.3, 0.5, 0.7):
        p = (proba >= thr).astype(int)
        print(f"  thr={thr}: precision={precision_score(yte, p):.3f} recall={recall_score(yte, p):.3f}")

    # ---- SHAP global importance ----
    import shap
    # SHAP on a capped 1000-row sample: the full test set would be slow, and a
    # fixed-seed sample is plenty for stable global importance
    sample = Xte[np.random.RandomState(SEED).choice(len(Xte), min(1000, len(Xte)), replace=False)]
    explainer = shap.TreeExplainer(clf)
    sv = explainer.shap_values(sample)
    mean_abs = np.abs(sv).mean(axis=0)
    importance = sorted(zip(FEATURES, mean_abs), key=lambda t: -t[1])
    print("\n-- mean |SHAP| (global drivers) --")
    for f, v in importance:
        print(f"  {f:20s} {v:.4f}")
    with open(os.path.join(HERE, "shap_importance.json"), "w") as f:
        json.dump([{"feature": k, "mean_abs_shap": round(float(v), 4)} for k, v in importance], f, indent=2)
    try:
        import matplotlib
        matplotlib.use("Agg")
        shap.summary_plot(sv, sample, feature_names=FEATURES, show=False, max_display=9)
        import matplotlib.pyplot as plt
        plt.tight_layout()
        plt.savefig(os.path.join(HERE, "shap_summary.png"), dpi=120)
        plt.close()
        print("saved shap_summary.png")
    except ImportError:
        print("(matplotlib missing, skipped plot)")

    # ---- save model ----
    clf.save_model(os.path.join(HERE, "model.ubj"))
    with open(os.path.join(HERE, "features.json"), "w") as f:
        json.dump(FEATURES, f, indent=2)
    with open(os.path.join(HERE, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)
    print("saved model.ubj, features.json, metrics.json")

    # ---- demo personas: score + per-user SHAP drivers ----
    print("\n-- demo personas --")
    personas = json.load(open(os.path.join(DATA, "demo_personas.json")))["personas"]
    for p in personas:
        fv = np.array([[p["features_6mo"][f] for f in FEATURES]])
        pr = float(clf.predict_proba(fv)[0, 1])
        sv1 = explainer.shap_values(fv)[0]
        drivers = sorted(zip(FEATURES, sv1), key=lambda t: -abs(t[1]))[:3]
        status = "CRITICAL" if pr >= 0.7 else "DRIFTING" if pr >= 0.4 else "STABLE"
        print(f"  {p['name']} ({p['type']}): risk={pr:.0%} -> {status}")
        for f, v in drivers:
            direction = "pushes risk UP" if v > 0 else "pushes risk DOWN"
            print(f"      {f:20s} {direction} (shap {v:+.3f})")

    # ---- lead-time analysis on fresh simulated users ----
    print("\n-- lead time (fresh 1500 users) --")
    leads, caught = [], 0
    n_eval, n_pos = 1500, 0
    for _ in range(n_eval):
        params = gen.sample_params()
        rec = gen.simulate(params)
        feat = gen.features_from(rec)
        true = gen.label_from(rec)
        if not true:
            continue
        n_pos += 1
        pr = float(clf.predict_proba(np.array([[feat[f] for f in FEATURES]]))[0, 1])
        if pr < 0.5:
            continue
        caught += 1
        # first month in the 7-12 window where the balance actually goes negative
        first_bad = next(t for t in range(6, 12) if rec["balance"][t] < 0)
        leads.append(first_bad - 5)  # months of warning after the 6-month window
    leads = np.array(leads)
    print(f"  positives: {n_pos}, caught at thr=0.5: {caught} ({caught/max(n_pos,1):.0%} recall)")
    if len(leads):
        print(f"  warning lead time: mean {leads.mean():.1f} mo, median {np.median(leads):.0f} mo, "
              f"min {leads.min():.0f} mo, >=2mo warning: {(leads >= 2).mean():.0%}")


if __name__ == "__main__":
    main()
