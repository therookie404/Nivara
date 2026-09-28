import React, { useState } from 'react';
import { Field } from './HelpTip.jsx';

// Post-login onboarding wizard: 5 steps that collect the profile used to build
// the user's financial history from scratch.
// Steps: 1) individual vs small business, 2) income + predictability + trend,
// 3) fixed/variable costs + cost creep, 4) EMIs + liquid savings (+ late-paying
// customers for businesses), 5) review.
// On finish it calls onDone with the profile. The parent then builds 6 estimated
// months anchored so the day-one balance equals the entered liquidity (marked
// estimated:true, regenerated deterministically when the profile is edited),
// then runs the XGBoost stress scoring over them.
// Props: onDone (({ type: 'manual', profile, savings }) => void).
// Income predictability options: vol feeds the model's volatility expectations.
const STABILITY = [
  { id: 'steady', label: 'Steady', vol: 0.05, desc: 'Same pay every month' },
  { id: 'varies', label: 'Varies a bit', vol: 0.2, desc: 'Commission / seasonal ups & downs' },
  { id: 'irregular', label: 'Irregular', vol: 0.35, desc: 'Freelance, daily wages, unpredictable' },
];
// Direction options: trend feeds the model; a shrinking inflow is an early stress signal.
const TRENDS = [
  { id: 'up', label: 'Growing', trend: 0.01 },
  { id: 'flat', label: 'Roughly flat', trend: 0 },
  { id: 'down', label: 'Shrinking', trend: -0.03 },
];
// Late-payment frequency (business only): prob feeds the model — delayed
// receivables mean revenue on paper but no cash, so income is treated as riskier.
const LATEPAY = [
  { id: 'rarely', label: 'Rarely', prob: 0 },
  { id: 'sometimes', label: 'Sometimes', prob: 0.15 },
  { id: 'often', label: 'Often', prob: 0.3 },
];

export default function Wizard({ onDone }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    profileType: 'individual',
    income: 60000, stability: 'steady', trend: 'flat',
    fixed: 20000, variable: 15000, drift: 0.01,
    emi: 8000, savings: 100000, latePay: 'rarely', name: 'You',
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isBiz = form.profileType === 'business';

  // Fold the wizard form into the model-ready profile object passed to onDone:
  // option ids (stability/trend/latePay) resolve to their numeric vol/trend/prob values.
  const profile = () => ({
    income: Number(form.income) || 0,
    vol: STABILITY.find((s) => s.id === form.stability).vol,
    trend: TRENDS.find((t) => t.id === form.trend).trend,
    fixed: Number(form.fixed) || 0,
    variable: Number(form.variable) || 0,
    drift: Number(form.drift) || 0,
    emi: Number(form.emi) || 0,
    delayProb: LATEPAY.find((l) => l.id === form.latePay).prob,
    profileType: form.profileType,
    name: form.name || (isBiz ? 'My Business' : 'You'),
  });

  const dots = [1, 2, 3, 4, 5].map((i) => (
    <div key={i} className={`step-dot ${i <= step ? 'done' : ''}`} />
  ));

  return (
    <div className="wizard">
      <div className="card">
        {step >= 1 && <div className="steps">{dots}</div>}

        {/* ---- step 1: profile type (individual vs business) ---- */}
        {step === 1 && (
          <>
            <h3>Who is this profile for?</h3>
            <p className="sub">The questions adapt — a shop's "income" is revenue collected, and businesses get asked about late-paying customers.</p>
            <div className="grid grid-2">
              <button className="persona-card" style={form.profileType === 'individual' ? { borderColor: '#2f6bff' } : {}}
                onClick={() => set('profileType', 'individual')}>
                <h4>🙋 Individual</h4>
                <p>Salaried employee, freelancer, gig worker — your personal money.</p>
              </button>
              <button className="persona-card" style={form.profileType === 'business' ? { borderColor: '#2f6bff' } : {}}
                onClick={() => set('profileType', 'business')}>
                <h4>🏪 Small business</h4>
                <p>Shop, boutique, agency, startup — your business's cash flow.</p>
              </button>
            </div>
            <div className="btn-row">
              <button className="btn" onClick={() => setStep(2)}>Next →</button>
            </div>
          </>
        )}

        {/* ---- step 2: income in (amount, predictability, trend) ---- */}
        {step === 2 && (
          <>
            <h3>Step 1 — {isBiz ? 'Revenue in' : 'Income in'}</h3>
            <p className="sub">What comes <b>in</b> every month, and how predictable is it?</p>
            <Field
              label={isBiz ? 'Average monthly revenue collected' : 'Average monthly take-home'}
              help={isBiz
                ? <>Money customers <b>actually pay you</b> per month — not invoiced, <b>collected</b>. Average the last 6 months: add up bank credits and divide by 6.</>
                : <>Money you <b>actually receive</b> per month, after tax. <b>Salaried:</b> your net salary. <b>Gig / freelance:</b> average of the last 6 months.</>}
            >
              <input type="number" value={form.income} onChange={(e) => set('income', e.target.value)} />
            </Field>
            <Field
              label="How predictable is it?"
              help={<>This tells the model how much <b>volatility</b> to expect. A freelancer's income swings far more than a salary — the model treats a bad month very differently for each.</>}
            >
              <div className="seg">
                {STABILITY.map((s) => (
                  <button key={s.id} className={form.stability === s.id ? 'active' : ''}
                    onClick={() => set('stability', s.id)} title={s.desc}>{s.label}</button>
                ))}
              </div>
            </Field>
            <Field
              label="Which way is it heading?"
              help={<>Is it <b>growing, flat, or shrinking</b> lately? A shrinking inflow is one of the earliest stress signals — even if today's balance looks fine.</>}
            >
              <div className="seg">
                {TRENDS.map((t) => (
                  <button key={t.id} className={form.trend === t.id ? 'active' : ''}
                    onClick={() => set('trend', t.id)}>{t.label}</button>
                ))}
              </div>
            </Field>
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setStep(1)}>← Back</button>
              <button className="btn" onClick={() => setStep(3)}>Next →</button>
            </div>
          </>
        )}

        {/* ---- step 3: expenses out (fixed, variable, cost creep) ---- */}
        {step === 3 && (
          <>
            <h3>Step 2 — {isBiz ? 'Business costs' : 'Your expenses'}</h3>
            <p className="sub">What goes <b>out</b> every month? Split it roughly — precision isn't critical.</p>
            <Field
              label={isBiz ? 'Fixed business costs / month' : 'Fixed costs / month'}
              help={isBiz
                ? <><b>Same every month:</b> shop rent, salaries, utilities, insurance. <b>Example:</b> rent ₹20,000 + 1 employee ₹15,000 + utilities ₹3,000 = ₹38,000.</>
                : <><b>Same every month:</b> rent, subscriptions, insurance, school fees. <b>Example:</b> rent ₹15,000 + phone/internet ₹1,500 + insurance ₹2,000 = ₹18,500.</>}
            >
              <input type="number" value={form.fixed} onChange={(e) => set('fixed', e.target.value)} />
            </Field>
            <Field
              label={isBiz ? 'Variable business costs / month' : 'Variable spending / month'}
              help={isBiz
                ? <><b>Changes month to month:</b> inventory, raw material, delivery, marketing. Your best average is fine.</>
                : <><b>Changes month to month:</b> food, travel, fuel, shopping. <b>Example:</b> ~₹4,000/week on food & travel ≈ ₹16,000.</>}
            >
              <input type="number" value={form.variable} onChange={(e) => set('variable', e.target.value)} />
            </Field>
            <Field
              label={<>Are costs creeping up? <span className="val">{Math.round(form.drift * 100)}%/mo</span></>}
              help={<><b>Cost creep</b> — spending rising a little every month — is a classic slow-burn stress driver. 1–2%/month is typical creep; 0% means flat.</>}
            >
              <input type="range" min="0" max="0.06" step="0.005" value={form.drift}
                onChange={(e) => set('drift', Number(e.target.value))} />
            </Field>
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setStep(2)}>← Back</button>
              <button className="btn" onClick={() => setStep(4)}>Next →</button>
            </div>
          </>
        )}

        {/* ---- step 4: debt & safety net (EMIs, liquid savings, late pay if business) ---- */}
        {step === 4 && (
          <>
            <h3>Step 3 — Debt & safety net</h3>
            <p className="sub">Your obligations and your buffer.</p>
            <Field
              label="Total EMIs / month"
              help={<><b>Add up every loan EMI</b>: home, car, personal, business loans, credit-card minimums. <b>Example:</b> car EMI ₹9,000 + personal loan ₹6,000 = ₹15,000. Enter 0 if none.</>}
            >
              <input type="number" value={form.emi} onChange={(e) => set('emi', e.target.value)} />
            </Field>
            <Field
              label={isBiz ? 'Business cash reserves' : 'Current liquid savings'}
              help={isBiz
                ? <>Cash the business could <b>use tomorrow</b>: current account balance + cash in hand. This sets your <b>runway</b> — how many months the business survives with no revenue.</>
                : <>Cash you could <b>use tomorrow</b> in an emergency: bank balance + cash at home. <b>Don't include</b> locked investments (PF, ELSS) or property. This sets your <b>runway</b>.</>}
            >
              <input type="number" value={form.savings} onChange={(e) => set('savings', e.target.value)} />
            </Field>
            {isBiz && (
              <Field
                label="Do customers pay you late?"
                help={<><b>Delayed receivables</b> are a top killer of small businesses — revenue on paper, no cash in hand. If late payments are common, the model treats your income as riskier.</>}
              >
                <div className="seg">
                  {LATEPAY.map((l) => (
                    <button key={l.id} className={form.latePay === l.id ? 'active' : ''}
                      onClick={() => set('latePay', l.id)}>{l.label}</button>
                  ))}
                </div>
              </Field>
            )}
            <Field label={isBiz ? 'Business name' : 'What should we call you?'}>
              <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setStep(3)}>← Back</button>
              <button className="btn" onClick={() => setStep(5)}>Review →</button>
            </div>
          </>
        )}

        {/* ---- step 5: review summary + run analysis ---- */}
        {step === 5 && (
          <>
            <h3>Review & analyze</h3>
            <p className="sub">
              NIVARA will estimate your last 6 months from these inputs — anchored to
              end at the liquid savings you just entered — score your stress risk
              with the AI model, and explain what's driving it.
            </p>
            {[
              ['Profile type', isBiz ? '🏪 Small business' : '🙋 Individual'],
              [isBiz ? 'Monthly revenue' : 'Monthly take-home', `₹${Number(form.income).toLocaleString('en-IN')}`],
              ['Pattern', `${STABILITY.find((s) => s.id === form.stability).label} · ${TRENDS.find((t) => t.id === form.trend).label}`],
              ['Fixed costs', `₹${Number(form.fixed).toLocaleString('en-IN')}`],
              ['Variable costs', `₹${Number(form.variable).toLocaleString('en-IN')}`],
              ['Total EMIs', `₹${Number(form.emi).toLocaleString('en-IN')}`],
              [isBiz ? 'Cash reserves' : 'Liquid savings', `₹${Number(form.savings).toLocaleString('en-IN')}`],
            ].map(([k, v]) => (
              <div className="review-row" key={k}><span>{k}</span><span>{v}</span></div>
            ))}
            <div className="btn-row">
              <button className="btn ghost" onClick={() => setStep(4)}>← Back</button>
              <button className="btn" onClick={() => onDone({ type: 'manual', profile: profile(), savings: Number(form.savings) || 0 })}>
                🔍 Analyze my risk
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
