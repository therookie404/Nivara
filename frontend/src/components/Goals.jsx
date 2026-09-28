// Goals: savings-goal tracking tab — the add-goal form, per-goal progress
// cards with feasibility verdicts, and goal milestone / behind-pace alerts.
// Props: goals, features (from the risk assessment, used for feasibility),
// onAddGoal, onContribute, onDeleteGoal.
import React, { useState } from 'react';
import { default as HelpTip } from './HelpTip.jsx';
import {
  GOAL_CATEGORIES, GOAL_PRIORITIES, GOAL_TERMS,
  GOAL_PRIORITY_ORDER, goalPlan, newGoal, inr,
} from '../finance.js';

// CSS classes for the high/mid/low priority pills.
const PRI_CLS = { high: 'pri-high', mid: 'pri-mid', low: 'pri-low' };

// One goal card: progress bar, monthly-save math, milestone alert note, and
// contribute/delete actions. Props: goal, plan (from goalPlan), onContribute, onDelete.
function GoalCard({ goal, plan, onContribute, onDelete }) {
  const [amt, setAmt] = useState('');
  const cat = (GOAL_CATEGORIES.find((c) => c.id === goal.category) || {}).label || goal.category;
  const pri = (GOAL_PRIORITIES.find((p) => p.id === goal.priority) || {}).label || goal.priority;
  const term = (GOAL_TERMS.find((t) => t.id === goal.term) || {}).label || goal.term;
  const f = plan.feasibility;

  // Contributes the typed amount (ignoring empty/invalid input), then clears the field.
  const add = () => {
    const v = parseFloat(amt);
    if (v > 0) { onContribute(goal.id, v); setAmt(''); }
  };

  return (
    <div className={`goal-card`} id={`goal-${goal.id}`}>
      <div className="alert-head">
        <b>{cat} — {goal.name}</b>
        <span style={{ display: 'flex', gap: 8 }}>
          <span className={`pri-pill ${PRI_CLS[goal.priority]}`}>{pri}</span>
          <span className="term-pill">{term}</span>
        </span>
      </div>
      <div className="goal-progress">
        <div className="goal-bar"><div style={{ width: `${plan.pct}%` }} /></div>
        <div className="goal-nums">
          <span><b style={{ display: 'inline', fontSize: 14 }}>{inr(goal.saved)}</b> of {inr(goal.target)}</span>
          <span>{Math.round(plan.pct)}%</span>
        </div>
      </div>
      <p className="kpi" style={{ margin: '8px 0' }}>
        {plan.remaining > 0
          ? <>Save <b style={{ display: 'inline', fontSize: 13 }}>{inr(plan.perMonth)}/mo</b> for {plan.horizon} months to hit this.</>
          : 'Target reached.'}
      </p>
      <p className="kpi" style={{ margin: '4px 0 0' }}><span className={`verdict verdict-${f.cls}`}>{f.label}</span></p>
      <p className="hint" style={{ margin: '8px 0 0' }}>🔔 Your alert: fires at {Math.min(95, Math.max(10, +goal.milestone || 50))}% of this goal.</p>
      <div className="goal-actions">
        <input
          type="number" min="1" placeholder="＋ Add savings ₹"
          value={amt} onChange={(e) => setAmt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn" style={{ padding: '9px 16px', fontSize: 13 }} onClick={add}>Add</button>
        <button className="btn ghost" style={{ padding: '9px 16px', fontSize: 13 }} onClick={() => onDelete(goal.id)}>Delete</button>
      </div>
    </div>
  );
}

export default function Goals({ goals, features, onAddGoal, onContribute, onDeleteGoal }) {
  const [form, setForm] = useState({
    name: '', category: 'savings', target: '', saved: '', priority: 'high', term: 'short', milestone: 50,
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Adds the goal (needs a positive target), then resets the form.
  const add = () => {
    if (!form.target || +form.target <= 0) return;
    onAddGoal(newGoal(form));
    setForm({ name: '', category: 'savings', target: '', saved: '', priority: 'high', term: 'short', milestone: 50 });
  };

  // High-priority goals sort first; newest of equal priority on top.
  const sorted = [...goals].sort(
    (a, b) => (GOAL_PRIORITY_ORDER[a.priority] ?? 1) - (GOAL_PRIORITY_ORDER[b.priority] ?? 1)
      || new Date(b.createdAt) - new Date(a.createdAt)
  );

  // Goal alerts: user-defined milestones + behind-schedule warnings.
  const goalAlerts = [];
  sorted.forEach((g) => {
    const plan = goalPlan(g, features);
    // Clamp the milestone to 10–95% so it stays meaningful (0% never fires, 100% has its own alert).
    const ms = Math.min(95, Math.max(10, +g.milestone || 50));
    if (g.target > 0 && plan.pct >= 100) {
      goalAlerts.push({ id: `gdone-${g.id}`, sev: 'positive', icon: '🎉', text: `"${g.name}" hit 100% — goal complete!` });
    } else if (g.target > 0 && plan.pct >= ms) {
      goalAlerts.push({ id: `gms-${g.id}`, sev: 'positive', icon: '🎯', text: `"${g.name}" crossed your ${ms}% milestone (now ${Math.round(plan.pct)}%).` });
    }
    if (plan.feasibility.key === 'stretch' || plan.feasibility.key === 'tight') {
      goalAlerts.push({ id: `gbehind-${g.id}`, sev: plan.feasibility.key === 'tight' ? 'high' : 'medium', icon: '⚠️', text: `"${g.name}" is behind pace: ${plan.feasibility.label.replace(/^[✅🟠⚠️]\s*/, '')}` });
    }
  });

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* ---- Add-goal form ---- */}
      <div className="card">
        <h3>🎯 Financial goals <HelpTip text="Set a milestone % on each goal and you'll get an alert when you cross it. Feasibility compares the monthly saving you need against your actual surplus from the risk assessment." /></h3>
        <p className="sub">What are you saving toward? NIVARA checks each goal against your actual cash flow.</p>
        <div className="grid grid-2">
          <div className="field" style={{ margin: 0 }}>
            <label>Goal type</label>
            <select value={form.category} onChange={(e) => set('category', e.target.value)}
              style={{ width: '100%', padding: '11px 13px', borderRadius: 10, border: '1px solid var(--input-border)', background: '#fff', color: 'var(--ink)', fontSize: 14 }}>
              {GOAL_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Goal name</label>
            <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Scooter down payment" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Target amount (₹)</label>
            <input type="number" min="1" value={form.target} onChange={(e) => set('target', e.target.value)} placeholder="e.g. 80000" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Already saved (₹)</label>
            <input type="number" min="0" value={form.saved} onChange={(e) => set('saved', e.target.value)} placeholder="e.g. 15000" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Priority</label>
            <select value={form.priority} onChange={(e) => set('priority', e.target.value)}
              style={{ width: '100%', padding: '11px 13px', borderRadius: 10, border: '1px solid var(--input-border)', background: '#fff', color: 'var(--ink)', fontSize: 14 }}>
              {GOAL_PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label} priority</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Timeline</label>
            <select value={form.term} onChange={(e) => set('term', e.target.value)}
              style={{ width: '100%', padding: '11px 13px', borderRadius: 10, border: '1px solid var(--input-border)', background: '#fff', color: 'var(--ink)', fontSize: 14 }}>
              {GOAL_TERMS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Alert me at (% of goal)</label>
            <input type="number" min="10" max="95" value={form.milestone} onChange={(e) => set('milestone', e.target.value)} placeholder="e.g. 50" />
            <div className="hint">Your custom milestone alert for this goal.</div>
          </div>
        </div>
        <div className="btn-row" style={{ marginTop: 14 }}>
          <button className="btn" onClick={add}>＋ Add goal</button>
        </div>
      </div>

      {/* ---- Goal milestone / behind-pace alerts ---- */}
      {goalAlerts.length > 0 && (
        <div className="grid" style={{ gap: 10 }}>
          {goalAlerts.map((a) => (
            <div key={a.id} className={`alert-card sev-${a.sev}`}>
              <div className="alert-head">
                <b>{a.icon} Goal alert</b>
                <span className={`sev-pill sev-${a.sev}`}>{a.sev === 'positive' ? '🟢 Good' : a.sev === 'high' ? '🔴 High' : '🟠 Medium'}</span>
              </div>
              <p className="expl" style={{ margin: '8px 0 0' }}>{a.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* ---- Goal cards ---- */}
      {sorted.length > 0 && (
        <div className="grid" style={{ gap: 12 }}>
          {sorted.map((g) => (
            <GoalCard key={g.id} goal={g} plan={goalPlan(g, features)}
              onContribute={onContribute} onDelete={onDeleteGoal} />
          ))}
        </div>
      )}
      {sorted.length === 0 && (
        <div className="note"><b>No goals yet.</b> Add your first one above — an emergency fund, something you want to buy, a debt to clear. High-priority goals always sort to the top.</div>
      )}

      {/* ---- Feasibility explainer ---- */}
      <div className="note">
        <b>How feasibility is checked:</b> each goal's required monthly saving is compared against your current monthly surplus
        (savings rate × average income from your assessment). It's a rough guide, not a promise — income changes will move these numbers.
      </div>
    </div>
  );
}
