import React, { useState } from 'react';
import { default as HelpTip } from './HelpTip.jsx';
import {
  ASSET_KINDS, newAsset, creditWindow, monthTotals, inr,
} from '../finance.js';

// Assets.jsx — the "Assets & Credit" tab. Two ideas:
// 1. Emergency credit window: the cash the user could unlock by selling NON-essential
//    assets, expressed in months of average spending — a self-funded credit line with
//    no lender involved. Essential assets (home, work vehicle) are never counted.
// 2. Asset list: what the user owns and today's estimated value, essential vs
//    non-essential. Status-aware nudges: CRITICAL gets a red sell recommendation,
//    DRIFTING gets an amber heads-up.
// Note: this tab has no credit ledger — Received/Paid money movement lives in
// the dashboard ledger; merely adding an asset moves no money.

// The Assets & Credit tab.
// Props: assets — the asset list; onAddAsset/onDeleteAsset — mutate it;
// assessment — current risk assessment (status + runway_months); months — recorded
// months (used for average monthly outflow); onSimulateSell — runs the what-if
// simulator with the sellable total as a cash injection.
export default function Assets({ assets, onAddAsset, onDeleteAsset, assessment, months, onSimulateSell }) {
  // Local form state for the add-asset row; add() validates value > 0, then clears the form.
  const [form, setForm] = useState({ name: '', value: '', kind: 'nonessential' });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Guard: ignore the add when the value isn't a positive number.
  const add = () => {
    if (!(+form.value > 0)) return;
    onAddAsset(newAsset(form));
    setForm({ name: '', value: '', kind: 'nonessential' });
  };

  // Average monthly outflow (expenses + EMI) over recorded months — the divisor that
  // converts sellable assets into "months of spending covered". 0 when no months exist.
  const avgOut = months && months.length
    ? months.reduce((s, m) => { const t = monthTotals(m); return s + t.expenses + (m.emi || 0); }, 0) / months.length
    : 0;
  const win = creditWindow(assets, avgOut);
  const runway = assessment?.features?.runway_months || 0;
  const status = assessment?.status || 'STABLE';
  // Non-essential assets, most valuable first — the candidate sell list.
  const sellableList = [...assets].filter((a) => a.kind === 'nonessential').sort((a, b) => b.value - a.value);

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* ---------------- credit window ---------------- */}
      <div className="card">
        <h3>💰 Emergency credit window <HelpTip text="The cash you could unlock by selling non-essential assets — your self-funded credit line, with no lender involved. Expressed in months of your average spending." /></h3>
        <p className="sub">What you could unlock if you had to — no lender needed</p>
        <div className="grid grid-3">
          <div className="kpi-card">
            <span className="kpi">Sellable assets</span>
            <b>{inr(win.sellable)}</b>
          </div>
          <div className="kpi-card">
            <span className="kpi">Covers spending for</span>
            <b>{win.monthsCovered.toFixed(1)} months</b>
          </div>
          <div className="kpi-card">
            <span className="kpi">Runway becomes</span>
            <b>{runway.toFixed(1)} → {(runway + win.monthsCovered).toFixed(1)} mo</b>
          </div>
        </div>
        {win.sellable > 0 && (
          <div className="btn-row" style={{ marginTop: 14 }}>
            <button className="btn" onClick={() => onSimulateSell(win.sellable)}>
              🔮 Simulate selling these in the What-If Simulator
            </button>
          </div>
        )}
      </div>

      {/* ---------------- sell recommendation ---------------- */}
      {status === 'CRITICAL' && sellableList.length > 0 && (
        <div className="alert-card sev-high">
          <div className="alert-head">
            <b>🔴 High risk — consider selling non-essential assets</b>
            <span className="sev-pill sev-high">🔴 High</span>
          </div>
          <p className="expl" style={{ margin: '8px 0' }}>
            Your risk status is <b>CRITICAL</b>. Selling your non-essential assets could unlock{' '}
            <b>{inr(win.sellable)}</b> — about <b>{win.monthsCovered.toFixed(1)} months</b> of spending —
            and stretch your runway from {runway.toFixed(1)} to {(runway + win.monthsCovered).toFixed(1)} months.
          </p>
          <div style={{ margin: '8px 0' }}>
            {sellableList.map((a) => <span className="pill" key={a.id}>{a.name} · {inr(a.value)}</span>)}
          </div>
          <p className="hint" style={{ margin: '8px 0 0' }}>
            Selling has trade-offs (tax, replacement cost, sentiment). This is information from your numbers, not financial advice —
            talk to a qualified adviser before selling anything big.
          </p>
        </div>
      )}
      {status === 'DRIFTING' && sellableList.length > 0 && (
        <div className="alert-card sev-medium">
          <div className="alert-head">
            <b>🟠 Worth knowing while risk is drifting</b>
            <span className="sev-pill sev-medium">🟠 Medium</span>
          </div>
          <p className="expl" style={{ margin: '8px 0 0' }}>
            Nothing urgent — but if things worsen, your non-essential assets (<b>{inr(win.sellable)}</b>)
            could cover <b>{win.monthsCovered.toFixed(1)} months</b> of spending. Good to have the option mapped before you need it.
          </p>
        </div>
      )}

      {/* ---------------- asset list ---------------- */}
      <div className="card">
        <h3>📋 Asset list <HelpTip text="List what you own and what it's worth today. Mark what's essential (home you live in, work vehicle) vs non-essential (second vehicle, jewellery, gadgets, land). Only non-essential assets count toward your credit window." /></h3>
        <p className="sub">Everything you own, marked essential or non-essential</p>
        <div className="grid grid-3" style={{ alignItems: 'end' }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Asset name</label>
            <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Second scooter, Gold jewellery" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Current value (₹)</label>
            <input type="number" min="1" value={form.value} onChange={(e) => set('value', e.target.value)} placeholder="e.g. 120000" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Type</label>
            <select value={form.kind} onChange={(e) => set('kind', e.target.value)}
              style={{ width: '100%', padding: '11px 13px', borderRadius: 10, border: '1px solid var(--input-border)', background: '#fff', color: 'var(--ink)', fontSize: 14 }}>
              {ASSET_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </div>
        </div>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={add}>＋ Add asset</button>
        </div>
        <div className="warn-note">
          ⚠️ Values of assets are subject to change — ensure that values are as accurate as possible and update them when needed.
        </div>

        <div className="grid" style={{ gap: 10, marginTop: 16 }}>
          {assets.length === 0 && (
            <div className="note"><b>No assets listed yet.</b> Add your first one above — start with the big non-essential items, they matter most in an emergency.</div>
          )}
          {[...assets].sort((a, b) => b.value - a.value).map((a) => (
            <div key={a.id} id={`asset-${a.id}`} className={`asset-row`}>
              <div>
                <b style={{ fontSize: 14 }}>{a.name}</b>
                <div><span className={`pri-pill ${a.kind === 'nonessential' ? 'pri-mid' : 'pri-low'}`}>
                  {(ASSET_KINDS.find((k) => k.id === a.kind) || {}).label}
                </span></div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <b style={{ fontSize: 15 }}>{inr(a.value)}</b>
                <button className="btn ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => onDeleteAsset(a.id)}>✕</button>
              </div>
            </div>
          ))}
        </div>

        {assets.length > 0 && (
          // ---- asset totals ----
          <div className="grid grid-3" style={{ marginTop: 14 }}>
            <div className="kpi-card"><span className="kpi">Essential</span><b>{inr(win.essential)}</b></div>
            <div className="kpi-card"><span className="kpi">Non-essential</span><b>{inr(win.sellable)}</b></div>
            <div className="kpi-card"><span className="kpi">Total assets</span><b>{inr(win.total)}</b></div>
          </div>
        )}
      </div>
    </div>
  );
}
