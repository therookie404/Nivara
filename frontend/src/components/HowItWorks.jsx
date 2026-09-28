import React from 'react';

// HowItWorks.jsx — the "how NIVARA reasons" explainer card used in the app.
// It renders the 5-step decision-support pipeline (data → XGBoost score →
// SHAP explanation → belief smoothing → Monte Carlo what-if), a strip of
// model metrics, and an "Honest limits" card. Pure content, no interactivity.

// The five pipeline steps: number, heading, and the plain-language paragraph.
// Copy is deliberate about expectations: labels come from simulated futures,
// scores are decomposed (never a black box), and projections are scenarios.
const STEPS = [
  ['1', 'You describe your money flow',
    'Income, expenses, EMIs and savings — through a guided wizard, or a demo profile. Every field explains what to enter and why the model needs it.'],
  ['2', 'XGBoost predicts stress risk',
    '9 features (runway, savings rate, income volatility, debt burden…) feed a gradient-boosted model trained on 8,000 simulated financial lives. Labels come from simulated futures — did a shortfall actually happen? — never from hand-labels.'],
  ['3', 'SHAP explains the score',
    'The score is decomposed into per-factor contributions, so you see exactly what pushes risk up or down — e.g. "runway: +2.9, expense drift: +1.9". No black box.'],
  ['4', 'Belief tracking smooths the verdict',
    'The raw score is blended with history (exponential smoothing). One bad month can\'t flip you to CRITICAL — escalation needs fresh data to confirm, and recovery needs a margin. Thin data = lower confidence, not a failure.'],
  ['5', 'Monte Carlo simulates your options',
    'The what-if engine projects 12 months across 400 simulated futures per scenario, flags stress/recovery points, and re-scores each scenario with the model — so you compare actions, not just admire the problem.'],
];

// HowItWorks — renders the pipeline explainer + metric strip + limits card.
// No props; all content is static marketing-grade copy.
export default function HowItWorks() {
  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* ---- Pipeline steps ---- */}
      <div className="card">
        <h3>How NIVARA reasons</h3>
        <p className="sub">A decision-support pipeline — it advises, never transacts</p>
        {STEPS.map(([n, h, p]) => (
          <div className="how-step" key={n}>
            <div className="how-num">{n}</div>
            <div><h4>{h}</h4><p>{p}</p></div>
          </div>
        ))}
      </div>
      {/* ---- Model metrics strip ---- */}
      <div className="grid grid-3">
        <div className="card"><div className="kpi">Test accuracy<b>91%</b></div><p className="sub">1,600 held-out synthetic users</p></div>
        <div className="card"><div className="kpi">Avg. early warning<b>2.3 months</b></div><p className="sub">Lead time before a shortfall, on fresh simulations</p></div>
        <div className="card"><div className="kpi">Recall at warning threshold<b>93%</b></div><p className="sub">Tuned to miss very few real crises</p></div>
      </div>
      {/* ---- Honest limits disclaimer ---- */}
      <div className="card">
        <h3>Honest limits</h3>
        <p className="sub" style={{ lineHeight: 1.7 }}>
          • Projections are <b>scenarios, not predictions</b> — bands show uncertainty, never a guaranteed line.<br />
          • The model learned from <b>synthetic data</b>; real-world accuracy needs validation on anonymized real data.<br />
          • NIVARA is <b>decision support</b>: it ranks options and explains trade-offs. It never moves money. Big decisions deserve a human advisor.
        </p>
      </div>
    </div>
  );
}
