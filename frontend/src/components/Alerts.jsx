import React, { useState } from 'react';
import { ACTION_PRESETS, ACTION_STATUS_LABEL, actionVerdict, newAction } from '../finance.js';

// Alerts.jsx — two things the "Signals" tab shows:
// 1. Early-warning alert feed: what the alert engine raised (risk moves, de-escalations)
//    and why (belief delta + SHAP-ish contributing factors).
// 2. Recovery actions: preset or custom habits the user tracks; the card re-scores
//    each action against live belief so they see whether it is actually helping.
// Re-exports newAction so App.jsx can seed an action from a demo / what-if scenario.

const SEV_LABEL = {
  high: '🔴 High', medium: '🟠 Medium', low: '🟡 Watch',
  positive: '🟢 Improving', info: '🔵 Info',
};

// Formats a Firestore/ISO timestamp for the alert meta line (Indian locale, short).
function fmtTs(ts) {
  try { return new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

// One alert row: title, severity pill, explanation, contributing-factor pills,
// and the meta line showing how belief moved (in percentage points) and confidence.
// Severity ladder: high/medium/low = worsening risk; positive = recovery progress
// (e.g. status_deescalated, risk_falling); info = neutral notices.
function AlertCard({ a }) {
  return (
    <div className={`alert-card sev-${a.severity}`} id={`alert-${a.id}`}>
      <div className="alert-head">
        <b>{a.title}</b>
        <span className={`sev-pill sev-${a.severity}`}>{SEV_LABEL[a.severity] || a.severity}</span>
      </div>
      <p className="expl" style={{ margin: '8px 0' }}>{a.message}</p>
      {a.reasons && a.reasons.length > 0 && (
        <div style={{ margin: '8px 0' }}>
          <span className="kpi">Contributing factors: </span>
          {a.reasons.map((r, i) => <span className="pill" key={i}>{r}</span>)}
        </div>
      )}
      <div className="alert-meta">
        {a.belief_before != null && (
          <span>Belief {Math.round(a.belief_before * 100)}% → {Math.round(a.belief_after * 100)}%
            {' '}({a.delta_pp >= 0 ? '+' : ''}{a.delta_pp}pp)</span>
        )}
        <span> · Confidence {Math.round(a.confidence * 100)}%</span>
        <span> · {fmtTs(a.ts)}</span>
      </div>
      {a.data_note && <div className="alert-datanote">⚠️ {a.data_note}</div>}
    </div>
  );
}

// One recovery-action row: label, status pill, verdict badge computed from the live
// belief trail, and lifecycle buttons (Start tracking → Mark done / Drop / Reopen).
// Props: action — the action object; onStatus — status transitions; onTest — sends the
// action's preset changes into the what-if simulator for a projection.
// canSimulate gates the "Project this in the simulator" button on presets whose
// changes are an actual function (custom free-text actions can't be simulated).
function ActionCard({ action, onStatus, onTest }) {
  const v = actionVerdict(action);
  const trail = (action.trail || []).map((t) => `${Math.round(t.belief * 100)}%`).join(' → ');
  const preset = ACTION_PRESETS.find((p) => p.id === action.presetId);
  const canSimulate = preset && typeof preset.changes === 'function';
  return (
    <div className={`action-card`} id={`action-${action.id}`}>
      <div className="alert-head">
        <b>{action.label}</b>
        <span className={`status-pill st-${action.status}`}>{ACTION_STATUS_LABEL[action.status]}</span>
      </div>
      {preset && preset.id !== 'custom' && <p className="sub" style={{ margin: '6px 0' }}>{preset.blurb}</p>}
      <div style={{ margin: '10px 0' }}>
        <span className={`verdict verdict-${v.cls}`}>{v.label}</span>
        <p className="kpi" style={{ margin: '6px 0 0' }}>{v.detail}</p>
        {trail && <p className="kpi" style={{ margin: '6px 0 0' }}>Belief trail: <b style={{ display: 'inline', fontSize: 13 }}>{trail}</b></p>}
      </div>
      <div className="btn-row" style={{ marginTop: 10 }}>
        {action.status === 'planned' && (
          <button className="btn" style={{ padding: '9px 18px', fontSize: 13 }} onClick={() => onStatus(action.id, 'in_progress')}>▶ Start tracking</button>
        )}
        {action.status === 'in_progress' && (
          <>
            <button className="btn" style={{ padding: '9px 18px', fontSize: 13 }} onClick={() => onStatus(action.id, 'completed')}>✅ Mark done</button>
            <button className="btn ghost" style={{ padding: '9px 18px', fontSize: 13 }} onClick={() => onStatus(action.id, 'dropped')}>Drop</button>
          </>
        )}
        {(action.status === 'completed' || action.status === 'dropped') && (
          <button className="btn ghost" style={{ padding: '9px 18px', fontSize: 13 }} onClick={() => onStatus(action.id, 'in_progress')}>↺ Reopen</button>
        )}
        {canSimulate && (
          <button className="btn ghost" style={{ padding: '9px 18px', fontSize: 13 }} onClick={() => onTest(action)}>🔮 Project this in the simulator</button>
        )}
      </div>
    </div>
  );
}

// The Signals tab: alert feed on top, recovery-action tracker below.
// Props: alerts — engine-raised alerts; actions — tracked actions; onAddAction,
// onSetActionStatus, onTestAction — callbacks into App; currentBelief — shown on the
// "Add action" button so the user sees the baseline they are tracking from.
export default function Alerts({ alerts, actions, onAddAction, onSetActionStatus, onTestAction, currentBelief }) {
  const [presetId, setPresetId] = useState('cutvar');
  const [customLabel, setCustomLabel] = useState('');

  const add = () => {
    onAddAction(presetId, customLabel.trim());
    setCustomLabel('');
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* ---- Alert feed ---- */}
      <div className="card">
        <h3>🔔 Early-warning alerts</h3>
        <p className="sub">Meaningful moves in your risk indicators — with the reasons behind each one</p>
        {alerts.length === 0 && (
          <div className="note"><b>All quiet.</b> No significant changes since your last check. Alerts appear here when your stress belief moves meaningfully or crosses a risk band.</div>
        )}
        <div className="grid" style={{ gap: 12 }}>
          {alerts.map((a) => <AlertCard key={a.id} a={a} />)}
        </div>
      </div>

      {/* ---- Recovery actions ---- */}
      <div className="card">
        <h3>🛟 Recovery actions</h3>
        <p className="sub">Pick something to try, track it over time, and see whether the numbers actually move</p>
        <div className="grid grid-2" style={{ alignItems: 'end' }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Choose an action</label>
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
              style={{ width: '100%', padding: '11px 13px', borderRadius: 10, border: '1px solid var(--input-border)', background: '#fff', color: 'var(--ink)', fontSize: 14 }}
            >
              {ACTION_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            <div className="hint">{(ACTION_PRESETS.find((p) => p.id === presetId) || {}).blurb}</div>
          </div>
          <div className="field" style={{ margin: 0 }}>
            {presetId === 'custom' && (
              <>
                <label>Describe it</label>
                <input type="text" value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="e.g. Pause my streaming subscriptions" />
              </>
            )}
            <div className="btn-row" style={{ marginTop: presetId === 'custom' ? 12 : 0 }}>
              <button className="btn" onClick={add}>＋ Add action{currentBelief != null ? ` (tracking from ${Math.round(currentBelief * 100)}%)` : ''}</button>
            </div>
          </div>
        </div>

        <div className="grid" style={{ gap: 12, marginTop: 16 }}>
          {actions.length === 0 && (
            <div className="note"><b>No actions yet.</b> Add one above — for example, cutting variable spending — then log a new month of data on the dashboard. NIVARA will show whether your risk indicators improve, stay flat, or get worse.</div>
          )}
          {actions.map((ac) => (
            <ActionCard key={ac.id} action={ac} onStatus={onSetActionStatus} onTest={onTestAction} />
          ))}
        </div>
      </div>

      {/* ---- Disclaimer ---- */}
      <div className="note">
        <b>⚖️ A note on uncertainty:</b> alerts and projections are estimates from the data you entered — they show what <i>could</i> happen, not what <i>will</i>. They are not financial advice. If you're making a big money decision, consider speaking to a qualified financial adviser.
      </div>
    </div>
  );
}

export { newAction };
