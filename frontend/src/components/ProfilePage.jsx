import React, { useState } from 'react';
import { inr, newCredit, creditTotals, CREDIT_KINDS } from '../finance.js';

// Full-page profile editor: basic info, forward-looking income/expenses/EMI
// and the starting balance. Income/expenses/EMI feed the dashboard cards,
// future projections + the simulator; the starting balance re-anchors every
// recorded month's running balance.
//
// Business profiles also get the exclusive credit ledger: receivables
// (positive credit — money owed TO you) and payables (negative credit —
// money YOU owe). "Received" / "Paid" moves the amount into/out of the
// balance immediately and rescores everything.
// props: initial (profile fields), credits + currentBalance (business ledger),
// handlers for credit CRUD/settle, onSave (persist profile edits)
export default function ProfilePage({
  initial, credits = [], currentBalance = 0,
  onAddCredit, onUpdateCredit, onDeleteCredit, onSettleCredit,
  onSave,
}) {
  const [name, setName] = useState(initial.name || '');
  const [profileType, setProfileType] = useState(initial.profileType || 'individual');
  const [income, setIncome] = useState(initial.income || 0);
  const [emi, setEmi] = useState(initial.emi || 0);
  const [fixedExp, setFixedExp] = useState(initial.fixedExp || 0);
  const [varExp, setVarExp] = useState(initial.varExp || 0);
  const [startingBalance, setStartingBalance] = useState(initial.startingBalance || 0);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Credit ledger form state (business only).
  const [clabel, setClabel] = useState('');
  const [camount, setCamount] = useState('');
  const [ckind, setCkind] = useState('receivable');
  const [editingId, setEditingId] = useState(null);
  const [elabel, setElabel] = useState('');
  const [eamount, setEamount] = useState('');
  const [settlingId, setSettlingId] = useState(null);

  // Clamp any numeric field to a non-negative integer.
  const num = (v) => Math.max(0, Math.round(Number(v) || 0));

  // Save profile; shows a temporary "Saved" tick so the user knows dashboard cards update.
  const save = async () => {
    setBusy(true);
    try {
      await onSave({
        name: name.trim() || 'You',
        profileType,
        income: num(income),
        emi: num(emi),
        fixedExp: num(fixedExp),
        varExp: num(varExp),
        startingBalance: num(startingBalance),
      });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 3500);
    } finally {
      setBusy(false);
    }
  };

  const openCredits = credits.filter((c) => !c.settled);
  const settledCredits = credits.filter((c) => c.settled);
  const totals = creditTotals(credits);

  const addNewCredit = () => {
    if (!(+camount > 0)) return;   // guard: ignore empty/zero amounts
    onAddCredit(newCredit({ label: clabel, kind: ckind, amount: camount }));
    setClabel(''); setCamount(''); setCkind('receivable');
  };

  // Begin inline editing of one credit row (label + amount fields).
  const startEdit = (c) => {
    setEditingId(c.id);
    setElabel(c.label);
    setEamount(String(c.amount));
  };

  const saveEdit = () => {
    if (!(+eamount > 0)) return;
    onUpdateCredit(editingId, { label: elabel.trim() || 'Credit', amount: Math.round(+eamount) });
    setEditingId(null);
  };

  // Settle a credit: "Received"/"Paid" moves the amount into/out of the balance via the parent.
  // The parent rescores risk and refreshes projections after the settle completes.
  const settle = async (c) => {
    setSettlingId(c.id);
    try { await onSettleCredit(c.id); }
    finally { setSettlingId(null); }
  };

  return (
    <div className="grid" style={{ gap: 16 }}>
      {/* ---------------- personal ---------------- */}
      <div className="card">
        <h3>👤 Personal</h3>
        <p className="sub">Who this profile belongs to</p>
        <label className="fld">
          <span>Display name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
        </label>
        <div className="fld" style={{ marginBottom: 0 }}>
          <span>Profile type</span>
          <div className="seg">
            <button className={profileType === 'individual' ? 'on' : ''} onClick={() => setProfileType('individual')}>🧑 Individual</button>
            <button className={profileType === 'business' ? 'on' : ''} onClick={() => setProfileType('business')}>🏢 Business</button>
          </div>
        </div>
      </div>

      {/* ---------------- monthly figures ---------------- */}
      <div className="card">
        <h3>💵 Monthly figures</h3>
        <p className="sub">Your current numbers — these drive the dashboard cards, projections and the simulator</p>
        <div className="fld-row">
          <label className="fld">
            <span>Monthly income (₹)</span>
            <input type="number" min="0" value={income} onChange={(e) => setIncome(e.target.value)} />
          </label>
          <label className="fld">
            <span>Monthly EMI (₹)</span>
            <input type="number" min="0" value={emi} onChange={(e) => setEmi(e.target.value)} />
          </label>
        </div>
        <div className="fld-row">
          <label className="fld">
            <span>Fixed expenses (₹)</span>
            <input type="number" min="0" value={fixedExp} onChange={(e) => setFixedExp(e.target.value)} />
          </label>
          <label className="fld">
            <span>Variable expenses (₹)</span>
            <input type="number" min="0" value={varExp} onChange={(e) => setVarExp(e.target.value)} />
          </label>
        </div>
        <label className="fld" style={{ marginBottom: 0 }}>
          <span>Starting balance (₹)</span>
          <input type="number" min="0" value={startingBalance} onChange={(e) => setStartingBalance(e.target.value)} />
          <small>Currently {inr(initial.startingBalance || 0)} — changing this re-anchors every month's running balance.</small>
        </label>
        <p className="modal-note" style={{ marginTop: 12 }}>
          Income, expenses &amp; EMI update your dashboard cards, future projections and the
          What-If Simulator. Your recorded months keep their values — edit those in
          Income &amp; Expenses.
        </p>
      </div>

      {/* ---------------- credit ledger (business only) ---------------- */}
      {profileType === 'business' && (
        <div className="card">
          <div className="credit-head">
            <h3 style={{ margin: 0 }}>💳 Credit ledger <span className="pill">business only</span></h3>
            <span className="kpi">Balance <b>{inr(currentBalance)}</b></span>
          </div>
          <p className="modal-note" style={{ marginTop: 8 }}>
            Track money owed <b>to</b> you (receivables ➕) and money <b>you</b> owe (payables ➖).
            Hitting <b>Received</b> / <b>Paid</b> moves the amount into / out of your balance
            immediately — projections, runway and the risk score all update.
          </p>

          {openCredits.length === 0 && (
            <p className="sub" style={{ margin: '8px 0' }}>No open credits. Add one below.</p>
          )}
          {openCredits.map((c) => (
            <div className="credit-row" key={c.id}>
              {editingId === c.id ? (
                <>
                  <input className="credit-edit" value={elabel}
                    onChange={(e) => setElabel(e.target.value)} placeholder="Label" />
                  <input className="credit-edit amt" type="number" min="1" value={eamount}
                    onChange={(e) => setEamount(e.target.value)} placeholder="₹" />
                  <button className="btn ghost sm" onClick={saveEdit}>Save</button>
                  <button className="btn ghost sm" onClick={() => setEditingId(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <span className={`credit-kind ${c.kind}`}>
                    {c.kind === 'payable' ? '➖' : '➕'}
                  </span>
                  <span className="credit-label">{c.label}</span>
                  <b className={`credit-amt ${c.kind}`}>{inr(c.amount)}</b>
                  <button
                    className={`btn sm ${c.kind === 'payable' ? 'danger' : ''}`}
                    disabled={settlingId === c.id}
                    onClick={() => settle(c)}
                    title={c.kind === 'payable'
                      ? `Mark paid — deduct ${inr(c.amount)} from your balance`
                      : `Mark received — add ${inr(c.amount)} to your balance`}
                  >
                    {settlingId === c.id ? '…' : c.kind === 'payable' ? 'Paid' : 'Received'}
                  </button>
                  <button className="icon-btn sm" onClick={() => startEdit(c)} title="Edit">✎</button>
                  <button className="icon-btn sm" onClick={() => onDeleteCredit(c.id)} title="Delete">✕</button>
                </>
              )}
            </div>
          ))}

          <div className="credit-add">
            <input value={clabel} onChange={(e) => setClabel(e.target.value)}
              placeholder="Label, e.g. Client invoice #42" />
            <input type="number" min="1" value={camount}
              onChange={(e) => setCamount(e.target.value)} placeholder="Amount ₹" />
            <div className="seg sm">
              {CREDIT_KINDS.map((k) => (
                <button key={k.id} className={ckind === k.id ? 'on' : ''}
                  onClick={() => setCkind(k.id)} title={k.hint}>{k.label}</button>
              ))}
            </div>
            <button className="btn sm" onClick={addNewCredit} disabled={!(+camount > 0)}>
              ＋ Add
            </button>
          </div>

          {(totals.toReceive > 0 || totals.toPay > 0) && (
            <p className="credit-totals">
              To receive <b className="good">{inr(totals.toReceive)}</b>
              {' · '}To pay <b className="bad">{inr(totals.toPay)}</b>
              {' · '}Net <b>{inr(totals.net)}</b>
            </p>
          )}

          {settledCredits.length > 0 && (
            <details className="credit-settled">
              <summary>Settled ({settledCredits.length})</summary>
              {settledCredits.map((c) => (
                <div className="credit-row settled" key={c.id}>
                  <span className="credit-kind">{c.kind === 'payable' ? '➖' : '➕'}</span>
                  <span className="credit-label">{c.label}</span>
                  <b className="credit-amt">{inr(c.amount)}</b>
                  <span className="sub">✓ {c.settledAt ? new Date(c.settledAt).toLocaleDateString('en-IN') : ''}</span>
                  <button className="icon-btn sm" onClick={() => onDeleteCredit(c.id)} title="Remove">✕</button>
                </div>
              ))}
            </details>
          )}
        </div>
      )}

      {/* ---------------- save ---------------- */}
      <div className="btn-row" style={{ alignItems: 'center' }}>
        <button className="btn" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save profile'}
        </button>
        {justSaved && <span className="saved-tick">✓ Saved — dashboard updated</span>}
      </div>
    </div>
  );
}
