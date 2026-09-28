import React, { useEffect, useMemo, useState } from 'react';
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceDot,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../api.js';
import { Field, default as HelpTip } from './HelpTip.jsx';
import ChartNotes from './ChartNotes.jsx';
import { inr, pct, SIM_PRESETS, simPresetBlurb } from '../finance.js';

// What-if simulator: lets the user compare money scenarios side by side and see
// how each reshapes their 12-month projected balance.
// The Monte Carlo engine accepts shock/horizon params and is deterministic
// (base seed 7 plus per-scenario hash seeds); the UI hardcodes 12 months and
// 400 simulated futures. Scenarios come from three sources: built-in presets
// (SIM_PRESETS), recovery actions seeded from the Alerts tab, and user-built
// custom adjustments. Results show as a comparison table plus a median/band
// chart (shaded p10–p90 band, solid median line, red dot = first stress month).
// Props: base (current financial snapshot), seedAction (+ onSeedConsumed) to import
// a recovery action as a scenario, onRun (reports each completed run to the parent log).
const PRESETS = SIM_PRESETS;

const COLORS = ['#2f6bff', '#16a34a', '#f59e0b', '#8b5cf6'];   // per-scenario chart colors, cycled

// Custom tooltip: one clean row per scenario -> median with its low-high range.
function ChartTip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const map = {};
  payload.forEach((p) => {
    const key = String(p.dataKey || '');
    const i = key.lastIndexOf('|');
    if (i < 0) return;
    const nm = key.slice(0, i), stat = key.slice(i + 1);
    if (stat === 'band') return;
    (map[nm] = map[nm] || {})[stat] = p.value;
  });
  const names = Object.keys(map).filter((n) => map[n].p50 != null);
  if (!names.length) return null;
  return (
    <div className="chart-tip">
      <div className="chart-tip-title">{label}</div>
      {names.map((n) => (
        <div key={n} className="chart-tip-row">
          <span className="chart-tip-name">{n}</span>
          <b>{inr(map[n].p50)}</b>
          <span className="chart-tip-range">{inr(map[n].p10)} – {inr(map[n].p90)}</span>
        </div>
      ))}
      <div className="chart-tip-foot">median · (low – high range)</div>
    </div>
  );
}

const FREQS = [
  { id: 'once', label: 'one time', div: null },
  { id: 'monthly', label: 'per month', div: 1 },
  { id: 'quarterly', label: 'per quarter', div: 3 },
  { id: 'annual', label: 'per year', div: 12 },
];
const KINDS = [
  { id: 'income', label: 'Income', key: 'base_income' },
  { id: 'fixed', label: 'Fixed cost', key: 'fixed_exp' },
  { id: 'variable', label: 'Variable cost', key: 'var_exp' },
  { id: 'emi', label: 'EMI / loan', key: 'emi' },
];
let adjSeq = 0;   // client-side ids for custom adjustment rows

// Convert one adjustment row into its monthly rate so different frequencies
// (one-time/quarterly/annual) stay comparable; div=null marks one-time items.
const monthlyOf = (adj) => {
  const amt = Number(adj.amount) || 0;
  const div = (FREQS.find((f) => f.id === adj.freq) || FREQS[0]).div;
  return amt / div;
};

export default function Simulator({ base, seedAction, onSeedConsumed, onRun }) {
  // Component: props — base (snapshot), seedAction (recovery action to import),
  // onSeedConsumed (ack the import), onRun (log completed runs).
  const [activePresets, setActivePresets] = useState(['cutvar', 'side']);
  const [adjustments, setAdjustments] = useState([]);
  const [useCustom, setUseCustom] = useState(false);
  const [actionVars, setActionVars] = useState([]);   // seeded from recovery actions
  const [activeActionVars, setActiveActionVars] = useState([]);
  const [visible, setVisible] = useState({});   // per-scenario chart visibility toggles
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // A recovery action sent over from the Alerts tab becomes a scenario here.
  // The some() check dedupes so re-seeding the same action can't add it twice.
  useEffect(() => {
    if (seedAction && !actionVars.some((v) => v.id === seedAction.id)) {
      setActionVars((v) => [...v, seedAction]);
      setActiveActionVars((v) => [...v, seedAction.id]);
      if (onSeedConsumed) onSeedConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedAction]);

  // Add / edit / remove rows in the custom scenario builder.
  const addAdj = () =>
    setAdjustments((a) => [...a, { id: ++adjSeq, label: '', amount: '', freq: 'monthly', kind: 'income' }]);
  const updAdj = (id, k, v) =>
    setAdjustments((a) => a.map((x) => (x.id === id ? { ...x, [k]: v } : x)));
  const delAdj = (id) =>
    setAdjustments((a) => a.filter((x) => x.id !== id));

  // Fold custom adjustments into baseline-relative changes: recurring items shift the
  // monthly rates (expenses clamped >= 0), one-time items shift the starting balance.
  const customChanges = useMemo(() => {
    const delta = {};
    let once = 0;   // one-time lump sums shift the starting balance, not the monthly rate
    adjustments.forEach((adj) => {
      const amt = Number(adj.amount) || 0;
      if (!amt) return;
      if (adj.freq === 'once') {
        once += adj.kind === 'income' ? amt : -amt;
        return;
      }
      const m = monthlyOf(adj);
      const key = (KINDS.find((k) => k.id === adj.kind) || KINDS[0]).key;
      delta[key] = (delta[key] || 0) + m;
    });
    const out = {};
    if (delta.base_income) out.base_income = base.base_income + delta.base_income;
    if (delta.fixed_exp) out.fixed_exp = Math.max(0, base.fixed_exp + delta.fixed_exp);
    if (delta.var_exp) out.var_exp = Math.max(0, base.var_exp + delta.var_exp);
    if (delta.emi) out.emi = Math.max(0, base.emi + delta.emi);
    if (once) out.starting_balance = (base.starting_balance || 0) + once;
    return out;
  }, [adjustments, base]);

  // Assemble the scenario list for the engine: active presets + active seeded
  // recovery actions + the custom scenario (only when enabled and non-empty).
  const variants = useMemo(() => {
    const vs = PRESETS.filter((p) => activePresets.includes(p.id))
      .map((p) => ({ name: p.name, changes: p.changes(base) }));
    actionVars
      .filter((av) => activeActionVars.includes(av.id))
      .forEach((av) => vs.push({ name: `🛟 ${av.label}`, changes: av.changes(base) }));
    if (useCustom && Object.keys(customChanges).length) {
      vs.push({ name: 'My custom scenario', changes: customChanges });
    }
    return vs;
  }, [activePresets, customChanges, useCustom, base, actionVars, activeActionVars]);

  // Re-run the Monte Carlo simulation whenever the baseline or scenario mix changes.
  // The `live` flag discards stale responses so rapid toggles can't overwrite results.
  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    api.simulate(base, variants, 12, 400)
      .then((r) => { if (live) { setResult(r); setLoading(false); } })
      .catch((e) => { if (live) { setError(String(e.message || e)); setLoading(false); } });
    return () => { live = false; };
  }, [base, variants]);

  // Default chart visibility: show the first 3 scenarios, remember any manual toggles.
  useEffect(() => {
    if (result) {
      const v = {};
      result.scenarios.forEach((s, i) => { v[s.name] = visible[s.name] ?? i < 3; });
      setVisible(v);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result && result.scenarios.map((s) => s.name).join('|')]);

  // Report each completed comparison run to the parent (recent-simulations log).
  useEffect(() => {
    if (!result || !onRun) return;
    onRun(result.scenarios.map((s) => ({
      name: s.name,
      change: s.name === 'Base (no change)' ? 'Current situation' : simPresetBlurb(s.name),
      risk: s.model_risk_6mo,
      stress: (s.indicators && s.indicators.first_stress_month) || null,
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // Flatten engine bands into per-month chart rows: one row per month holding
  // p10/p50/p90 + stacked band height for each visible scenario.
  const chartData = useMemo(() => {
    if (!result) return [];
    const shown = result.scenarios.filter((s) => visible[s.name]);
    return result.scenarios[0].bands.map((b, i) => {
      const row = { m: `M${b.month}` };
      shown.forEach((s) => {
        const bb = s.bands[i];
        row[`${s.name}|p10`] = bb.p10; row[`${s.name}|p50`] = bb.p50; row[`${s.name}|p90`] = bb.p90;
        row[`${s.name}|band`] = bb.p90 - bb.p10;   // stacked-band height (p10 -> p90)
      });
      return row;
    });
  }, [result, visible]);

  const togglePreset = (id) =>
    setActivePresets((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));

  // Build the plain-language notes under the chart: band semantics plus a red
  // flag line for every visible scenario whose median path runs short.
  const projNotes = () => {
    const notes = [
      'The shaded band shows where that scenario\u2019s balance could land across 400 simulated futures \u2014 a wider band means more uncertainty.',
      'The solid line is the median path: half of the simulated futures end above it, half below.',
    ];
    if (result) {
      result.scenarios
        .filter((s) => visible[s.name] && s.indicators.first_stress_month)
        .forEach((s) => notes.push(
          `\uD83D\uDD34 ${s.name}: high chance of running short from month ${s.indicators.first_stress_month}.`
        ));
    }
    notes.push('Bands are scenarios, not predictions \u2014 they show what could happen, not what will.');
    return notes;
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="grid grid-32">
        {/* ---- what-if controls (left column) ---- */}
        <div className="card">
          <h3>What-if controls <HelpTip text="Change the assumptions and watch the future reshape. Every scenario is projected 12 months out with 400 simulated futures — the bands show uncertainty, not a single guaranteed line." /></h3>
          <p className="sub">Toggle quick actions, or build your own scenario line by line</p>

          <p className="kpi" style={{ marginBottom: 8 }}><b style={{ fontSize: 15 }}>Quick actions</b></p>
          <div className="checkrow">
            {PRESETS.map((p) => (
              <label key={p.id}>
                <input type="checkbox" checked={activePresets.includes(p.id)} onChange={() => togglePreset(p.id)} />
                {p.name}
              </label>
            ))}
            {actionVars.map((av) => (
              <label key={av.id} title="Seeded from a recovery action">
                <input
                  type="checkbox"
                  checked={activeActionVars.includes(av.id)}
                  onChange={() => setActiveActionVars((a) =>
                    a.includes(av.id) ? a.filter((x) => x !== av.id) : [...a, av.id])}
                />
                🛟 {av.label}
              </label>
            ))}
          </div>

          <p className="kpi" style={{ margin: '14px 0 4px' }}><b style={{ fontSize: 15 }}>Custom scenario</b></p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, marginBottom: 6 }}>
            <input type="checkbox" checked={useCustom} onChange={(e) => setUseCustom(e.target.checked)} style={{ accentColor: '#2f6bff' }} />
            Include my custom scenario
          </label>
          <div className="field">
            <label>
              Your adjustments{' '}
              <HelpTip text="Add real-life items with their natural frequency — a one-time bonus or repair bill, an annual insurance premium of ₹24,000, quarterly inventory of ₹30,000, or a monthly side gig of ₹12,000. One-time items shift your starting balance as a lump sum; quarterly and yearly items become monthly equivalents (÷3, ÷12) so every scenario stays comparable." />
            </label>
            {adjustments.map((adj) => (
              <div className="adj-row" key={adj.id}>
                <input
                  type="text" placeholder="Label, e.g. Annual bonus"
                  value={adj.label} onChange={(e) => updAdj(adj.id, 'label', e.target.value)}
                />
                <input
                  type="number" placeholder="Amount ₹"
                  value={adj.amount} onChange={(e) => updAdj(adj.id, 'amount', e.target.value)}
                />
                <select value={adj.freq} onChange={(e) => updAdj(adj.id, 'freq', e.target.value)}>
                  {FREQS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
                <select value={adj.kind} onChange={(e) => updAdj(adj.id, 'kind', e.target.value)}>
                  {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
                <span className="adj-eq">
                  {adj.freq === 'once'
                    ? `${inr(Number(adj.amount) || 0)} once`
                    : `= ${inr(monthlyOf(adj))}/mo`}
                </span>
                <button className="adj-del" onClick={() => delAdj(adj.id)} title="Remove">✕</button>
              </div>
            ))}
            <button className="btn ghost" style={{ marginTop: 8, padding: '9px 16px', fontSize: 13 }} onClick={addAdj}>
              ＋ Add adjustment
            </button>
            <div className="hint">
              Type exact numbers — no guessing with sliders. One-time items move the starting balance as a lump sum; quarterly ÷ 3 and yearly ÷ 12 become monthly equivalents automatically.
            </div>
          </div>
        </div>

        {/* ---- scenario comparison table (right column) ---- */}
        <div className="card">
          <h3>Scenario comparison</h3>
          <p className="sub">Which response actually moves the needle?</p>
          {loading && <div className="loading">Projecting futures…</div>}
          {error && <div className="error">{error}</div>}
          {result && (
            <table className="cmp">
              <thead><tr><th>Scenario</th><th>Risk</th><th>Stress</th><th>Min balance</th></tr></thead>
              <tbody>
                {result.comparison.map((r, i) => (
                  <tr key={r.scenario} className={i === 0 ? 'base' : ''}>
                    <td>{r.scenario}</td>
                    <td className={r.model_risk_6mo >= 0.7 ? 'bad' : r.model_risk_6mo < 0.4 ? 'good' : ''}>
                      {pct(r.model_risk_6mo)}
                    </td>
                    <td>{r.first_stress_month ? `Month ${r.first_stress_month}` : <span className="good">none ✓</span>}</td>
                    <td className={r.min_balance < 0 ? 'bad' : 'good'}>{inr(r.min_balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {result && (
            <div className="note">
              <b>Assumptions behind these numbers:</b><br />
              {Object.entries(result.scenarios[0].assumptions)
                .filter(([k]) => !['horizon_months', 'monte_carlo_sims', 'uncertainty_note'].includes(k))
                .map(([k, v]) => <span className="pill" key={k}>{v}</span>)}
              <br /><br />{result.assumptions_note}
            </div>
          )}
        </div>
      </div>

      {/* ---- projected balance chart ---- */}
      <div className="card">
        <h3>Projected balance — 12 months <HelpTip text="The shaded band is the 10th–90th percentile across 400 simulated futures; the solid line is the median path. A band dipping below zero means shortfall is plausible, not certain." /></h3>
        <p className="sub">Shaded = uncertainty band · solid = median path · red dot = stress point</p>
        {result && (
          <>
            <div className="checkrow">
              {result.scenarios.map((s, i) => (
                <label key={s.name}>
                  <input type="checkbox" checked={!!visible[s.name]}
                    onChange={() => setVisible((v) => ({ ...v, [s.name]: !v[s.name] }))} />
                  <span style={{ color: COLORS[i % COLORS.length] }}>●</span> {s.name}
                </label>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart key={result.scenarios.map((s) => s.name).join('|')} data={chartData} margin={{ top: 10 }}>
                <CartesianGrid stroke="#e9edf5" strokeDasharray="3 3" />
                <XAxis dataKey="m" stroke="#9aa7bd" />
                <YAxis stroke="#9aa7bd" tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
                <Tooltip content={<ChartTip />} />
                <Legend />
                {result.scenarios.map((s, i) => {
                  const hidden = !visible[s.name];
                  const color = COLORS[i % COLORS.length];
                  return (
                    <React.Fragment key={s.name}>
                      {/* uncertainty band: invisible p10 base + translucent (p90-p10) stacked on top.
                          `hide` (not unmount) keeps sibling series from re-animating on toggles. */}
                      <Area type="monotone" dataKey={`${s.name}|p10`} stackId={`band-${s.name}`}
                        stroke="none" fill="none" hide={hidden} legendType="none" isAnimationActive={false} />
                      <Area type="monotone" dataKey={`${s.name}|band`} stackId={`band-${s.name}`}
                        stroke="none" fill={color} fillOpacity={0.15}
                        hide={hidden} legendType="none"
                        animationDuration={1200} animationEasing="ease-out" />
                      <Line type="monotone" dataKey={`${s.name}|p50`} stroke={color}
                        strokeWidth={2.5} dot={false} name={s.name}
                        hide={hidden}
                        animationDuration={1200} animationEasing="ease-out" />
                      {!hidden && s.indicators.first_stress_month && (
                        <ReferenceDot x={`M${s.indicators.first_stress_month}`}
                          y={chartData[s.indicators.first_stress_month - 1]?.[`${s.name}|p50`]}
                          r={6} fill="#e5484d" stroke="#ffffff" />
                      )}
                    </React.Fragment>
                  );
                })}
              </ComposedChart>
            </ResponsiveContainer>
            <ChartNotes notes={projNotes()} />
          </>
        )}
      </div>
    </div>
  );
}
