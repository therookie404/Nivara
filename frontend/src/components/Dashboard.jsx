// Dashboard: post-login home screen of Nivara — greeting hero with the live
// stress belief badge, KPI cards, the plain-words "bottom line" verdict, the
// health gauge, cash-flow projection + debt-burden charts, SHAP explanations,
// money trail, recent sims, and the add-a-month form.
// Status bands: STABLE < 0.40, DRIFTING >= 0.40, CRITICAL >= 0.70 of stress
// belief (0-1). The 0.10 status hysteresis lives upstream — this screen just
// displays the belief/status it is given.
import React, { useEffect, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, ComposedChart, Bar, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import RiskGauge from './RiskGauge.jsx';
import { Field, default as HelpTip } from './HelpTip.jsx';
import ScoreExplainer from './ScoreExplainer.jsx';
import ChartNotes from './ChartNotes.jsx';
import { api } from '../api.js';
import {
  buildConclusion, driverPhrase, FEATURE_LABELS, inr, monthTotals, SIM_PRESETS,
} from '../finance.js';

// Line colors for the projection chart: base path first, then the two recovery variants.
const PROJ_COLORS = ['#2f6bff', '#16a34a', '#f59e0b'];
// Shortens the base scenario's label for chart legends and tables.
const shortName = (n) => (n === 'Base (no change)' ? 'Base' : n);
// Traffic-light color mirroring the status bands: STABLE < 0.40 green, DRIFTING >= 0.40 amber, CRITICAL >= 0.70 red.
const riskColor = (r) => (r >= 0.7 ? '#dc2626' : r >= 0.4 ? '#d97706' : '#16a34a');

// Time-of-day greeting for the hero kicker.
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// Small stat card. Props: icon, tint (icon background), label, value,
// delta (optional context line), deltaGood (colors it green/red/neutral, optional).
function Kpi({ icon, tint, label, value, delta, deltaGood }) {
  return (
    <div className="kpi-card2">
      <div className="kpi-top">
        <span className="kpi-ico" style={{ background: tint }}>{icon}</span>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-value">{value}</div>
      {delta && (
        <div className={`kpi-delta ${deltaGood == null ? 'neutral' : deltaGood ? 'good' : 'bad'}`}>{delta}</div>
      )}
    </div>
  );
}

// Props: name, profileType, scenarioBase (live income/expense shape), startingBalance,
// assessment (scored belief/status/drivers/features), months, beliefHistory, simRuns,
// onAddMonth, onGotoSimulator, onGotoAlerts, readOnly (demo hides the add-month button).
export default function Dashboard({
  name, profileType, scenarioBase, startingBalance, assessment, months,
  beliefHistory, simRuns, onAddMonth, onGotoSimulator, onGotoAlerts, readOnly,
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false); // cash-flow graph hidden until asked for
  const [nm, setNm] = useState({ income: '', expenses: '', emi: '' });
  const [proj, setProj] = useState(null);
  const a = assessment;
  // Largest |SHAP| value: scales every driver bar to a common width.
  const maxShap = Math.max(...a.drivers.map((d) => Math.abs(d.shap)), 0.001);

  // Base + two illustrative recovery variants, for the projection chart and
  // the debt-burden trend: median path across 300 simulated futures for each.
  // The `live` flag drops late responses if scenarioBase changes mid-flight.
  useEffect(() => {
    let live = true;
    setProj(null);
    if (scenarioBase) {
      const picks = SIM_PRESETS.filter((p) => p.id === 'cutvar' || p.id === 'side');
      const variants = picks.map((p) => ({ name: p.name, changes: p.changes(scenarioBase) }));
      api.simulate(scenarioBase, variants, 12, 300)
        .then((r) => { if (live) setProj(r); })
        .catch(() => {});
    }
    return () => { live = false; };
  }, [scenarioBase]);

  // ---- KPI numbers ----
  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / Math.max(1, arr.length);
  const totals = months.map(monthTotals);
  const avgIncome = avg(totals.map((t) => t.income));
  const avgExp = avg(totals.map((t) => t.expenses));
  const avgEmi = avg(months.map((m) => m.emi || 0));
  const last = months[months.length - 1] || {};
  const prevM = months[months.length - 2] || null;
  const lastT = totals[totals.length - 1] || { income: 0, expenses: 0 };
  const prevT = totals[totals.length - 2] || null;
  // Renders an ↑/↓ percent-change string vs the previous month (null when there is none).
  const dpct = (cur, prv) => (prv ? `${cur >= prv ? '↑' : '↓'} ${Math.abs(((cur - prv) / Math.abs(prv)) * 100).toFixed(0)}%` : null);
  const lastBal = last.balance != null ? last.balance : startingBalance;
  const balDelta = lastBal - startingBalance;
  // Fresh user with no recorded history: every month is estimated, so the
  // dashboard shows the actual stated figures — no fabricated past.
  const allEstimated = months.length > 0 && months.every((m) => m.estimated);
  // The income/EMI cards follow the PROFILE's current figures, so editing
  // them visibly moves the dashboard. Recorded months stay as facts for the
  // model and for the "vs last month" context line.
  const profIncome = Math.round(scenarioBase?.base_income ?? avgIncome);
  const profEmi = Math.round(scenarioBase?.emi ?? avgEmi);
  const profExp = Math.round((scenarioBase?.fixed_exp || 0) + (scenarioBase?.var_exp || 0));

  // ---- projection-derived ----
  const det = proj ? proj.scenarios[0].months : [];
  const projData = proj
    ? proj.scenarios[0].bands.map((b, i) => {
        const row = { m: `M${b.month}` };
        proj.scenarios.forEach((s) => { row[shortName(s.name)] = s.bands[i].p50; });
        return row;
      })
    : [];
  const curDSR = avgIncome > 0 ? (avgEmi / avgIncome) * 100 : 0;
  const dsrTrend = det.map((d) => ({
    m: `M${d.month}`,
    dsr: d.income > 0 ? +((d.emi / d.income) * 100).toFixed(1) : 0,
  }));

  const chartData = months.map((m, i) => {
    const t = monthTotals(m);
    return {
      m: `M${i + 1}`,
      // No fake history for fresh users: flat bars at the stated averages and
      // a flat balance line at the actual figure.
      income: allEstimated ? Math.round(avgIncome) : t.income,
      expenses: allEstimated ? Math.round(avgExp + avgEmi) : t.expenses + m.emi,
      balance: allEstimated ? startingBalance : m.balance,
    };
  });
  const balNote = lastBal < startingBalance
    ? `Your balance fell from ${inr(startingBalance)} to ${inr(lastBal)} over this period — the classic early-warning pattern, even when income looks steady.`
    : lastBal > startingBalance
      ? `Your balance grew from ${inr(startingBalance)} to ${inr(lastBal)} over this period — the trend is moving the right way.`
      : `Your balance stands at ${inr(startingBalance)} — the figure you entered. Add real months to start tracking how it moves.`;

  // Validates the new month, pushes it up to the parent, and resets the form.
  const submitMonth = () => {
    const month = {
      income: Number(nm.income) || 0,
      expenses: Number(nm.expenses) || 0,
      emi: Number(nm.emi) || 0,
      shock: 0, late: 0,
    };
    if (month.income <= 0) return;
    onAddMonth(month);
    setNm({ income: '', expenses: '', emi: '' });
    setShowAdd(false);
  };

  return (
    <div className="dash">
      {/* ---------------- hero ---------------- */}
      <section className="hero">
        <div className="hero-text">
          <p className="hero-kicker">{greeting()},</p>
          <h2>Welcome back, {name}!</h2>
          <p className="hero-sub">Plan smarter. Reduce financial stress with AI-powered projections.</p>
          <div className="hero-risk">
            <span className={`badge ${a.status}`}>{a.status}</span>
            <span className="hero-belief">{Math.round(a.belief * 100)}% stress belief</span>
            <span className="kpi">Runway {a.features.runway_months.toFixed(1)} mo</span>
          </div>
        </div>
        <svg className="hero-art" viewBox="0 0 300 120" preserveAspectRatio="xMaxYMax slice">
          <path d="M0 120 L0 80 L60 40 L120 75 L180 30 L240 70 L300 45 L300 120 Z" fill="#dbe7ff" opacity="0.7" />
          <path d="M0 120 L0 95 L80 60 L150 90 L220 55 L300 85 L300 120 Z" fill="#c3d6fd" opacity="0.55" />
        </svg>
      </section>

      {/* ---------------- KPI row ---------------- */}
      <section className="kpi-row">
        <Kpi icon="💰" tint="#dcfce7" label="Monthly Income" value={inr(profIncome)}
          delta={!allEstimated && lastT ? `${dpct(profIncome, lastT.income)} vs last month` : null}
          deltaGood={lastT ? profIncome >= lastT.income : null} />
        <Kpi icon="🛒" tint="#fee2e2" label="Total Expenses" value={inr(profExp)}
          delta={!allEstimated && lastT ? `${dpct(profExp, lastT.expenses)} vs last month` : null}
          deltaGood={lastT ? profExp <= lastT.expenses : null} />
        <Kpi icon="💳" tint="#dbeafe" label="Monthly EMI" value={inr(profEmi)}
          delta={!allEstimated && last ? `${dpct(profEmi, last.emi || 0)} vs last month` : null}
          deltaGood={last ? profEmi <= (last.emi || 0) : null} />
        <Kpi icon="🐷" tint="#f3e8ff" label="Current Balance" value={inr(lastBal)}
          delta={`${balDelta >= 0 ? '↑' : '↓'} ${inr(Math.abs(balDelta))} since start`}
          deltaGood={balDelta >= 0} />
      </section>

      {/* ---------------- bottom line: plain-words verdict, right up top ---------------- */}
      <section className={`bottom-line prominent ${a.status.toLowerCase()}`}>
        <div className="bl-head">
          <span className="bl-icon">{a.status === 'STABLE' ? '✅' : a.status === 'DRIFTING' ? '⚠️' : '🚨'}</span>
          <div>
            <h3>The bottom line</h3>
            <p className="sub">No jargon. Just what this means for you.</p>
          </div>
          <span className={`badge ${a.status}`}>{a.status}</span>
        </div>
        {buildConclusion(a, proj ? proj.scenarios[0] : null).map((t, i) => (
          <p key={i} className="bl-text">{t}</p>
        ))}
        <div className="btn-row">
          <button className="btn" onClick={onGotoSimulator}>🔮 Test fixes in the What-If Simulator →</button>
        </div>
      </section>

      {/* ---------------- detailed graphical breakdown (hidden until asked for) ---------------- */}
      <div className="breakdown-wrap">
        <button
          className={`breakdown-toggle${showBreakdown ? ' open' : ''}`}
          onClick={() => setShowBreakdown((v) => !v)}
          aria-expanded={showBreakdown}
        >
          <span className="bt-caret">{showBreakdown ? '▴' : '▾'}</span>
          {showBreakdown ? 'Hide detailed graphical breakdown' : 'Show detailed graphical breakdown'}
        </button>
      </div>
      {showBreakdown && (
      <div className="grid-21">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Cash Flow Projection <HelpTip text="Median projected balance over the next 12 months for your current path plus two recovery scenarios. Lines show the middle outcome across 300 simulated futures." /></h3>
              <p className="sub">Compare your monthly balance across scenarios</p>
            </div>
          </div>
          {proj ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={projData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#e9edf5" strokeDasharray="3 3" />
                <XAxis dataKey="m" stroke="#9aa7bd" interval={0} tick={{ fontSize: 11 }} />
                <YAxis stroke="#9aa7bd" tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, color: '#23235e' }}
                  formatter={(v) => inr(v)}
                />
                <Legend />
                {proj.scenarios.map((s, i) => (
                  <Line key={s.name} type="monotone" dataKey={shortName(s.name)}
                    stroke={PROJ_COLORS[i % PROJ_COLORS.length]} strokeWidth={2.5} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : <p className="kpi">Projecting…</p>}
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn ghost" style={{ padding: '8px 16px', fontSize: 13 }} onClick={onGotoSimulator}>
              Open full What-If Simulator →
            </button>
          </div>
        </div>

        <div className="card" style={{ textAlign: 'center' }}>
          <h3>{name}'s financial health</h3>
          <p className="sub">
            <span className="pill">{profileType === 'business' ? '🏪 Small business' : '🙋 Individual'}</span>
            {' '}AI stress belief · updated {new Date().toLocaleDateString('en-IN')}
          </p>
          <ScoreExplainer assessment={a}>
            <RiskGauge belief={a.belief} />
          </ScoreExplainer>
          <div style={{ marginTop: 6 }}>
            <span className={`badge ${a.status}`}>{a.status}</span>
          </div>
          <div className="grid grid-3" style={{ marginTop: 16, textAlign: 'left' }}>
            <div className="kpi">Raw model score<b>{Math.round(a.risk_score * 100)}%</b></div>
            <div className="kpi">Data confidence<b>{Math.round(a.confidence * 100)}%</b></div>
            <div className="kpi">Runway<b>{a.features.runway_months.toFixed(1)} mo</b></div>
          </div>
          {beliefHistory.length > 1 && (
            <p className="kpi" style={{ marginTop: 12 }}>
              Belief trend: {beliefHistory.map((b) => `${Math.round(b * 100)}%`).join(' → ')}
            </p>
          )}
        </div>
      </div>
      )}

      {/* ---------------- recent sims + debt burden ---------------- */}
      <div className="grid-21">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Recent Simulations</h3>
              <p className="sub">What you've tested in the What-If Simulator</p>
            </div>
            <button className="linklike" onClick={onGotoSimulator}>View All →</button>
          </div>
          {(simRuns || []).length === 0 ? (
            <div className="note"><b>No simulations yet.</b> Toggle scenarios in the What-If Simulator and they'll appear here with their shortfall risk.</div>
          ) : (
            <table className="cmp sim-table">
              <thead><tr><th>Scenario</th><th>Shortfall Risk</th><th>Date</th></tr></thead>
              <tbody>
                {(simRuns || []).slice(0, 5).map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="dot" style={{ background: riskColor(r.risk || 0), display: 'inline-block', marginRight: 8 }} />
                      <b>{shortName(r.name)}</b>
                      <div className="kpi">{r.change}{r.stress ? ` · stress from M${r.stress}` : ''}</div>
                    </td>
                    <td><span className="risk-pill" style={{ background: `${riskColor(r.risk || 0)}1a`, color: riskColor(r.risk || 0) }}>
                      {Math.round((r.risk || 0) * 100)}%
                    </span></td>
                    <td className="kpi">{new Date(r.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3>Projected Debt Burden <HelpTip text="EMI as a share of monthly income, now and across the projected year. Lenders usually start worrying past 40%." /></h3>
          <p className="sub">of monthly income (current)</p>
          <div className="dsr-big">{curDSR.toFixed(0)}%</div>
          <div className="dsr-bar"><div style={{ width: `${Math.min(100, curDSR)}%` }} /></div>
          <p className="sub" style={{ marginTop: 14 }}>Projected trend across 12 months</p>
          {proj ? (
            <ResponsiveContainer width="100%" height={130}>
              <AreaChart data={dsrTrend} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#e9edf5" strokeDasharray="3 3" />
                <XAxis dataKey="m" stroke="#9aa7bd" tick={{ fontSize: 10 }} interval={2} />
                <YAxis stroke="#9aa7bd" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10 }} domain={[0, 'auto']} />
                <Tooltip formatter={(v) => `${v}%`} contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10 }} />
                <Area type="monotone" dataKey="dsr" stroke="#2f6bff" fill="#2f6bff22" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <p className="kpi">Projecting…</p>}
        </div>
      </div>

      {/* ---------------- why this assessment (kept from our project) ---------------- */}
      <div className="card">
          <h3>Why this assessment? <HelpTip text="Every claim below comes from the model's own numbers (SHAP values) — the AI never invents reasons. 'Pushing risk up' factors make a future shortfall more likely." /></h3>
          <p className="sub">Plain-language explanation of the model's reasoning</p>
          <p className="expl">{a.explanation}</p>
          <div style={{ marginTop: 14 }}>
            {a.drivers.map((d) => (
              <div className="driver" key={d.feature}>
                <div className="driver-top">
                  <span><b>{FEATURE_LABELS[d.feature] || d.feature}</b>{' '}
                    <span className={d.direction === 'up' ? 'tag-up' : 'tag-down'}>
                      {d.direction === 'up' ? '▲ pushes risk up' : '▼ pushes risk down'}
                    </span>
                  </span>
                </div>
                <div className="driver-bar">
                  <div className={`driver-fill ${d.direction}`} style={{ width: `${(Math.abs(d.shap) / maxShap) * 100}%` }} />
                </div>
                <div className="phrase">{driverPhrase(d)}</div>
              </div>
            ))}
          </div>
        </div>

      {/* ---------------- money trail ---------------- */}
      <div className="card">
        <h3>Money trail <HelpTip text="Your monthly income vs total outflow (expenses + EMIs), and how your balance evolved. A shrinking balance line while income looks flat is the classic early-warning pattern." /></h3>
        <p className="sub">{allEstimated
          ? 'Your stated figures — add real months and this becomes your actual history'
          : 'Income vs outflow (bars) · balance (line)'}</p>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData}>
            <CartesianGrid stroke="#e9edf5" strokeDasharray="3 3" />
            <XAxis dataKey="m" stroke="#9aa7bd" />
            <YAxis stroke="#9aa7bd" tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
            <Tooltip
              contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 10, color: '#23235e' }}
              formatter={(v) => inr(v)}
            />
            <Legend />
            <Bar dataKey="income" fill="#22c55e" name="Income" radius={[4, 4, 0, 0]} />
            <Bar dataKey="expenses" fill="#fb923c" name="Outflow" radius={[4, 4, 0, 0]} />
            <Line type="monotone" dataKey="balance" stroke="#2f6bff" strokeWidth={2.5} name="Balance" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <ChartNotes notes={[
          'Green bars = money coming in. Orange bars = money going out (expenses + EMIs). The blue line = your balance at each month-end.',
          balNote,
          'A falling blue line while the bars look similar is exactly what NIVARA watches for — trouble shows in the trend before the balance hits zero.',
        ]} />
      </div>

      {/* ---------------- keep it current ---------------- */}
      <div className="card">
        <h3>Keep it current <HelpTip text="Got a new month of real numbers? Add them here. NIVARA re-scores and smoothly updates its belief — that's how the assessment adapts as your life changes, instead of judging you on old data." /></h3>
        <p className="sub">Add your latest month — the assessment adapts instead of going stale</p>
        {!showAdd ? (
          <div className="btn-row" style={{ marginTop: 0 }}>
            {/* Demo is read-only, so the add-month button stays hidden there. */}
            {!readOnly && <button className="btn ghost" onClick={() => setShowAdd(true)}>+ Add latest month</button>}
            <button className="btn" onClick={onGotoSimulator}>🔮 Simulate recovery actions →</button>
          </div>
        ) : (
          <div className="grid grid-3">
            <Field label="Income"><input type="number" value={nm.income} onChange={(e) => setNm({ ...nm, income: e.target.value })} placeholder="e.g. 62000" /></Field>
            <Field label="Expenses"><input type="number" value={nm.expenses} onChange={(e) => setNm({ ...nm, expenses: e.target.value })} placeholder="e.g. 38000" /></Field>
            <Field label="EMI"><input type="number" value={nm.emi} onChange={(e) => setNm({ ...nm, emi: e.target.value })} placeholder="e.g. 8000" /></Field>
            <div className="btn-row" style={{ marginTop: 0, alignItems: 'end' }}>
              <button className="btn" onClick={submitMonth}>Update assessment</button>
              <button className="btn ghost" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
