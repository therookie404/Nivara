import React, { useState } from 'react';
import {
  LineChart, Line, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  ReferenceLine, ReferenceDot, Legend,
} from 'recharts';
import {
  inr, monthNet, monthTotals, newTxn, moneyAlerts, DEFAULT_THRESHOLDS,
} from '../finance.js';
import { Field, default as HelpTip } from './HelpTip.jsx';

// MoneyManager.jsx — the "Your money" tab: the editable monthly ledger that is
// the evidence behind every stress score. Rows are months (income, expenses, EMI,
// shock, late payments); each can be split into individual transactions. Edits
// re-run the risk score on every change, so the table is the model's input form.
// The model needs at least 3 months — deleting below that is blocked here.
// Below the table: expense/debt risk graphs with user-set alert thresholds,
// a money-trend chart, and the full alert feed.
const blankMonth = () => ({ income: '', expenses: '', emi: '', shock: '', late: '' });

// Form fields come back as strings; coerce to a non-negative number so NaN/blank
// never leaks into totals or the model (falls back to 0).
function toNum(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Alert kind labels for display; KIND_SEV fixes severity per kind (null falls
// back to whatever severity the alert engine assigned per-alert).
const KIND_LABEL = { expense: '💸 Expense alert', savings: '🏦 Savings alert', salary: '💼 Salary-rule alert', debt: '💳 Debt alert' };
const KIND_SEV = { expense: 'high', savings: null, salary: 'medium', debt: 'high' }; // null -> per-alert

// AlertList — renders the breach cards for a chosen subset of alert kinds.
// Props: alerts (from moneyAlerts), kinds (which kinds to show here).
function AlertList({ alerts, kinds }) {
  const list = alerts.filter((a) => kinds.includes(a.kind));
  if (!list.length) return <div className="note"><b>✅ All clear.</b> No month broke this limit.</div>;
  return (
    <div className="grid" style={{ gap: 10 }}>
      {list.map((a) => {
        const sev = KIND_SEV[a.kind] || a.severity;
        return (
          <div key={a.id} className={`alert-card sev-${sev}`}>
            <div className="alert-head">
              <b>{KIND_LABEL[a.kind]}</b>
              <span className={`sev-pill sev-${sev}`}>{sev === 'high' ? '🔴 High' : '🟠 Medium'}</span>
            </div>
            <p className="expl" style={{ margin: '8px 0 0' }}>{a.message}</p>
          </div>
        );
      })}
    </div>
  );
}

// TxnEditor — expands one month into individual transactions (for businesses:
// client payments, rent, salaries…). Adds/removes pills; onChange pushes the
// txn list up via patchMonth so totals — and the re-scored risk — fold them in.
function TxnEditor({ month, onChange }) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState('expense');
  const [amount, setAmount] = useState('');
  const txns = month.txns || [];

  // Appends a validated txn to the month; no-op unless the amount is positive.
  const add = () => {
    if (!(toNum(amount) > 0)) return;
    onChange({ ...month, txns: [...txns, newTxn(label, kind, amount)] });
    setLabel(''); setAmount('');
  };
  // Removes one transaction pill by id.
  const del = (id) => onChange({ ...month, txns: txns.filter((t) => t.id !== id) });

  return (
    <div className="txn-editor">
      <p className="kpi" style={{ margin: '0 0 8px' }}>
        <b style={{ fontSize: 13 }}>🧾 Individual transactions</b> — businesses: split the month into every payment in and out. Totals fold into the month automatically.
      </p>
      {txns.length > 0 && (
        <div className="txn-list">
          {txns.map((t) => (
            <span key={t.id} className={`txn-pill ${t.kind}`}>
              {t.kind === 'income' ? '＋' : '－'} {t.label} · {inr(t.amount)}
              <button onClick={() => del(t.id)} title="Remove">✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="txn-add">
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Client payment, Rent, Salaries" />
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="income">＋ Income</option>
          <option value="expense">－ Expense</option>
        </select>
        <input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="₹ amount" />
        <button className="btn" style={{ padding: '9px 16px', fontSize: 13 }} onClick={add}>Add</button>
      </div>
    </div>
  );
}

// MoneyManager — the month ledger + risk graphs + alert rules.
// Props: months (array of month objects, the scoring evidence), thresholds
// (user-set alert limits), onThresholds (persist a limit change), onReplaceMonths
// (persist month add/edit/delete). Every mutation re-scores risk upstream.
export default function MoneyManager({ months, thresholds, onThresholds, onReplaceMonths }) {
  const [nm, setNm] = useState(blankMonth());
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(blankMonth());
  const [openTxns, setOpenTxns] = useState(null);
  const [err, setErr] = useState('');

  // Which alert kinds breached which months — drives the red dots on the graphs.
  const alerts = moneyAlerts(months, thresholds);
  const expBreaches = new Set(alerts.filter((a) => a.kind === 'expense').map((a) => a.monthIdx));
  const debtBreaches = new Set(alerts.filter((a) => a.kind === 'debt').map((a) => a.monthIdx));

  // Normalizes one month's raw form values into the numeric shape the finance
  // helpers expect (late payments rounded to whole counts).
  const clean = (m) => ({
    income: toNum(m.income),
    expenses: toNum(m.expenses),
    emi: toNum(m.emi),
    shock: toNum(m.shock),
    late: Math.round(toNum(m.late)),
  });

  // Merges a patch into one month (used by the TxnEditor to save transactions).
  const patchMonth = (i, patch) => onReplaceMonths(months.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  // Appends the "+ New" row; requires positive income, then caps history at the
  // latest 12 months so the ledger (and charts) stay readable.
  const addMonth = () => {
    if (!(toNum(nm.income) > 0)) { setErr('Income must be more than zero.'); return; }
    setErr('');
    onReplaceMonths([...months, clean(nm)].slice(-12));
    setNm(blankMonth());
  };

  // Opens the inline edit row for month i, pre-filling the draft from current values.
  const startEdit = (i) => {
    const m = months[i];
    setEditing(i); setOpenTxns(null);
    setDraft({ income: m.income, expenses: m.expenses, emi: m.emi || '', shock: m.shock || '', late: m.late || '' });
    setErr('');
  };

  // Commits the draft row (income must stay positive); merges cleaned values into the month.
  const saveEdit = () => {
    if (!(toNum(draft.income) > 0)) { setErr('Income must be more than zero.'); return; }
    setErr('');
    const next = months.map((m, i) => (i === editing ? { ...m, ...clean(draft) } : m));
    onReplaceMonths(next);
    setEditing(null);
  };

  // Deletes month i — blocked at 3 months because the stress model cannot score
  // with less evidence (fewer months would silently break risk analysis).
  const delMonth = (i) => {
    if (months.length <= 3) { setErr('Keep at least 3 months — the model needs them.'); return; }
    setErr('');
    onReplaceMonths(months.filter((_, j) => j !== i));
  };

  // Chart-ready series derived from the ledger: per-month income/expenses/savings,
  // expenses-only (for the limit graph), and debt-service-ratio = EMI ÷ income %.
  const trendData = months.map((m, i) => {
    const t = monthTotals(m);
    return { m: `M${i + 1}`, income: t.income, expenses: t.expenses, savings: monthNet(m) };
  });
  const expData = months.map((m, i) => ({ m: `M${i + 1}`, expenses: monthTotals(m).expenses }));
  const debtData = months.map((m, i) => {
    const t = monthTotals(m);
    return { m: `M${i + 1}`, dsr: t.income > 0 ? +(((m.emi || 0) / t.income) * 100).toFixed(1) : 0 };
  });

  // Small number-input factory for the add/edit rows (full-width, numeric).
  const num = (v, onChange, ph) => (
    <input type="number" min="0" value={v} onChange={(e) => onChange(e.target.value)} placeholder={ph} style={{ width: '100%' }} />
  );

  const tipStyle = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, color: '#23235e' };

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* ---------------- month table with transactions ---------------- */}
      <div className="card">
        <h3>💵 Monthly income & expenses <HelpTip text="Each month is one row. Running a business? Open 🧾 on any month to split it into individual transactions — client payments, rent, salaries. They fold into the totals automatically, and the risk score re-runs on every change." /></h3>
        <p className="sub">Add, edit or remove months — open 🧾 on any month to split it into individual transactions (for businesses)</p>
        {err && <div className="error">{err}</div>}
        <div style={{ overflowX: 'auto' }}>
          <table className="cmp money-table">
            <thead><tr><th>Month</th><th>Income</th><th>Expenses</th><th>EMI</th><th>Shock</th><th>Late</th><th>Savings</th><th></th></tr></thead>
            <tbody>
              {months.map((m, i) => {
                const t = monthTotals(m);
                const net = monthNet(m);
                const txnCount = (m.txns || []).length;
                return (
                  <React.Fragment key={i}>
                    {editing === i ? (
                      <tr className="editing">
                        <td><b>M{i + 1}</b></td>
                        <td>{num(draft.income, (v) => setDraft({ ...draft, income: v }))}</td>
                        <td>{num(draft.expenses, (v) => setDraft({ ...draft, expenses: v }))}</td>
                        <td>{num(draft.emi, (v) => setDraft({ ...draft, emi: v }))}</td>
                        <td>{num(draft.shock, (v) => setDraft({ ...draft, shock: v }))}</td>
                        <td>{num(draft.late, (v) => setDraft({ ...draft, late: v }))}</td>
                        <td className={monthNet({ ...m, ...clean(draft) }) < 0 ? 'bad' : 'good'}>
                          {inr(monthNet({ ...m, ...clean(draft) }))}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn" style={{ padding: '6px 12px', fontSize: 12 }} onClick={saveEdit}>Save</button>{' '}
                          <button className="btn ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => setEditing(null)}>Cancel</button>
                        </td>
                      </tr>
                    ) : (
                      <tr>
                        <td><b>M{i + 1}</b></td>
                        <td>{inr(t.income)}{txnCount > 0 && <span className="kpi"> incl. {txnCount} items</span>}</td>
                        <td className={t.expenses > thresholds.expense ? 'bad' : ''}>{inr(t.expenses)}</td>
                        <td>{inr(m.emi || 0)}</td>
                        <td>{m.shock ? inr(m.shock) : '—'}</td>
                        <td>{m.late || 0}</td>
                        <td className={net < thresholds.savings ? 'bad' : 'good'}><b>{inr(net)}</b></td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn ghost" style={{ padding: '6px 10px', fontSize: 12 }}
                            title="Individual transactions" onClick={() => setOpenTxns(openTxns === i ? null : i)}>
                            🧾{txnCount > 0 ? ` ${txnCount}` : ''}
                          </button>{' '}
                          <button className="btn ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => startEdit(i)}>Edit</button>{' '}
                          <button className="btn ghost" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => delMonth(i)} title="Delete month">✕</button>
                        </td>
                      </tr>
                    )}
                    {openTxns === i && editing !== i && (
                      <tr><td colSpan={8} style={{ padding: 0, border: 'none' }}>
                        <TxnEditor month={m} onChange={(nm2) => patchMonth(i, { txns: nm2.txns })} />
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
              <tr className="addrow">
                <td><b>+ New</b></td>
                <td>{num(nm.income, (v) => setNm({ ...nm, income: v }), 'e.g. 62000')}</td>
                <td>{num(nm.expenses, (v) => setNm({ ...nm, expenses: v }), 'e.g. 34000')}</td>
                <td>{num(nm.emi, (v) => setNm({ ...nm, emi: v }), 'e.g. 8000')}</td>
                <td>{num(nm.shock, (v) => setNm({ ...nm, shock: v }), '0')}</td>
                <td>{num(nm.late, (v) => setNm({ ...nm, late: v }), '0')}</td>
                <td>—</td>
                <td><button className="btn" style={{ padding: '8px 14px', fontSize: 12 }} onClick={addMonth}>＋ Add</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Savings = income − expenses − EMI − shocks (transactions included). Balances recompute automatically so the timeline stays continuous.
        </p>
      </div>

      {/* ---------------- expense risk graph ---------------- */}
      <div className="card">
        <h3>💸 Expense risk <HelpTip text="Red dots mark months where expenses crossed your set limit. The red dashed line is your limit — change it in Alert rules below and the dots move with it." /></h3>
        <p className="sub">Monthly expenses against your limit — red dots mark every breach</p>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={expData} margin={{ top: 10, right: 10 }}>
            <CartesianGrid stroke="#e9edf5" strokeDasharray="3 3" />
            <XAxis dataKey="m" stroke="#9aa7bd" />
            <YAxis stroke="#9aa7bd" tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
            <Tooltip contentStyle={tipStyle} formatter={(v) => [inr(v), 'Expenses']} />
            <ReferenceLine y={thresholds.expense} stroke="#e5484d" strokeDasharray="6 4"
              label={{ value: `alert at ${inr(thresholds.expense)}`, fill: '#e5484d', fontSize: 12, position: 'insideTopRight' }} />
            <Line type="monotone" dataKey="expenses" stroke="#f59e0b" strokeWidth={2.5}
              dot={(p) => expBreaches.has(p.index)
                ? <circle cx={p.cx} cy={p.cy} r={6} fill="#e5484d" stroke="#fff" strokeWidth={2} />
                : <circle cx={p.cx} cy={p.cy} r={3} fill="#f59e0b" />}
              name="expenses" animationDuration={900} animationEasing="ease-out" />
          </LineChart>
        </ResponsiveContainer>
        <div style={{ marginTop: 12 }}><AlertList alerts={alerts} kinds={['expense']} /></div>
      </div>

      {/* ---------------- debt risk graph ---------------- */}
      <div className="card">
        <h3>💳 Debt risk <HelpTip text="Debt load = EMI ÷ income, per month. Lenders usually start worrying past 40%. Red dots mark months that crossed your set limit." /></h3>
        <p className="sub">EMI as % of income each month — red dots mark every breach of your debt limit</p>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={debtData} margin={{ top: 10, right: 10 }}>
            <CartesianGrid stroke="#e9edf5" strokeDasharray="3 3" />
            <XAxis dataKey="m" stroke="#9aa7bd" />
            <YAxis stroke="#9aa7bd" tickFormatter={(v) => `${v}%`} domain={[0, 'auto']} />
            <Tooltip contentStyle={tipStyle} formatter={(v) => [`${v}% of income`, 'Debt load']} />
            <ReferenceLine y={thresholds.debtPct} stroke="#e5484d" strokeDasharray="6 4"
              label={{ value: `alert at ${thresholds.debtPct}%`, fill: '#e5484d', fontSize: 12, position: 'insideTopRight' }} />
            <Line type="monotone" dataKey="dsr" stroke="#8b5cf6" strokeWidth={2.5}
              dot={(p) => debtBreaches.has(p.index)
                ? <circle cx={p.cx} cy={p.cy} r={6} fill="#e5484d" stroke="#fff" strokeWidth={2} />
                : <circle cx={p.cx} cy={p.cy} r={3} fill="#8b5cf6" />}
              name="dsr" animationDuration={900} animationEasing="ease-out" />
          </LineChart>
        </ResponsiveContainer>
        <div style={{ marginTop: 12 }}><AlertList alerts={alerts} kinds={['debt']} /></div>
      </div>

      {/* ---------------- overview trend ---------------- */}
      <div className="card">
        <h3>📈 Money trend <HelpTip text="Green = money in, orange = money out, blue dashed = what you kept. When the blue line slides down while the others look flat, that's the early warning NIVARA watches for." /></h3>
        <p className="sub">Income vs expenses vs savings — the full picture</p>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={trendData} margin={{ top: 10, right: 10 }}>
            <CartesianGrid stroke="#e9edf5" strokeDasharray="3 3" />
            <XAxis dataKey="m" stroke="#9aa7bd" />
            <YAxis stroke="#9aa7bd" tickFormatter={(v) => `₹${Math.round(v / 1000)}k`} />
            <Tooltip contentStyle={tipStyle}
              formatter={(v, name) => [inr(v), { income: 'Income', expenses: 'Expenses', savings: 'Savings' }[name] || name]} />
            <Legend />
            <Line type="monotone" dataKey="income" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3 }} name="income" animationDuration={900} animationEasing="ease-out" />
            <Line type="monotone" dataKey="expenses" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} name="expenses" animationDuration={900} animationEasing="ease-out" />
            <Line type="monotone" dataKey="savings" stroke="#2f6bff" strokeWidth={2} strokeDasharray="5 3" dot={false} name="savings" animationDuration={900} animationEasing="ease-out" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ---------------- alert settings + full feed ---------------- */}
      <div className="card">
        <h3>🚨 Alert rules <HelpTip text="These are your rules, not ours. Set each limit and NIVARA flags every month that breaks it — as red dots on the graphs above and in the list below." /></h3>
        <p className="sub">Set your own limits — every breach is flagged on the graphs above and listed here</p>
        <div className="grid grid-2" style={{ maxWidth: 640 }}>
          <Field label="Expense limit (₹/month)">
            <input type="number" min="1" value={thresholds.expense}
              onChange={(e) => onThresholds({ ...thresholds, expense: Math.max(1, +e.target.value || DEFAULT_THRESHOLDS.expense) })} />
            <div className="hint">Alert when monthly expenses cross this.</div>
          </Field>
          <Field label="Savings floor (₹/month)">
            <input type="number" min="0" value={thresholds.savings}
              onChange={(e) => onThresholds({ ...thresholds, savings: Math.max(0, +e.target.value || 0) })} />
            <div className="hint">Alert when monthly savings fall below this.</div>
          </Field>
          <Field label="Salary rule — save at least (% of income)">
            <input type="number" min="0" max="100" value={thresholds.savingsPct}
              onChange={(e) => onThresholds({ ...thresholds, savingsPct: Math.min(100, Math.max(0, +e.target.value || 0)) })} />
            <div className="hint">Alert when savings are a smaller slice of income than this.</div>
          </Field>
          <Field label="Debt limit (% of income to EMI)">
            <input type="number" min="1" max="100" value={thresholds.debtPct}
              onChange={(e) => onThresholds({ ...thresholds, debtPct: Math.min(100, Math.max(1, +e.target.value || DEFAULT_THRESHOLDS.debtPct)) })} />
            <div className="hint">Alert when EMI eats more of income than this.</div>
          </Field>
        </div>
        <div className="grid" style={{ gap: 10, marginTop: 14 }}>
          {alerts.length === 0 && <div className="note"><b>✅ All within limits.</b> Nothing breached any of your rules.</div>}
          {alerts.map((a) => {
            const sev = KIND_SEV[a.kind] || a.severity;
            return (
              <div key={a.id} className={`alert-card sev-${sev}`}>
                <div className="alert-head">
                  <b>{KIND_LABEL[a.kind]}</b>
                  <span className={`sev-pill sev-${sev}`}>{sev === 'high' ? '🔴 High' : '🟠 Medium'}</span>
                </div>
                <p className="expl" style={{ margin: '8px 0 0' }}>{a.message}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
