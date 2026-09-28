// finance.js — the money-math core of NIVARA.
// NIVARA is a hackathon fintech prototype: early financial-stress detection +
// recovery planning. This file holds every pure calculation the UI needs:
// monthly balances, the anchor-aware balance chain, month totals, the credit
// window, goal feasibility, rule-based spending alerts, simulator presets and
// plain-language explanations of the model's SHAP drivers. No React here —
// these helpers are shared by the dashboard, the chatbot and the API calls.

// Seeded pseudo-random generator — keeps synthesized/simulated months
// deterministic so the same inputs always produce the same "noise shape".
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Generate n synthetic monthly records from a wizard profile:
// {income, vol, trend, fixed, variable, drift, emi}. Used for the demo
// personas and to sketch the onboarding user's recent past (seeded => stable).
// Returns [{income, expenses, emi, shock, late}] — no balances attached.
export function synthesizeMonths(p, n = 6, seed = 11) {
  const rnd = mulberry32(seed);
  const months = [];
  for (let t = 0; t < n; t++) {
    const inc = p.income * Math.pow(1 + p.trend, t) * (1 + (rnd() - 0.5) * p.vol);
    const exp = (p.fixed + p.variable * (1 + (rnd() - 0.5) * 0.16)) * Math.pow(1 + p.drift, t);
    months.push({
      income: Math.max(0, Math.round(inc)),
      expenses: Math.round(exp),
      emi: p.emi,
      shock: 0,
      late: 0,
    });
  }
  return months;
}

// Turn a wizard/onboarding profile into the scenario dict the backend
// simulator expects (base_income, fixed_exp, var_exp, emi, shock params...).
// This is the "forward-looking profile" — projections and the What-If
// Simulator run off it, while recorded months stay as historical facts.
export function scenarioFromProfile(p, startingBalance) {
  return {
    starting_balance: startingBalance,
    base_income: p.income,
    income_trend: p.trend,
    income_vol: p.vol,
    fixed_exp: p.fixed,
    var_exp: p.variable,
    expense_drift: p.drift,
    emi: p.emi,
    shock_prob: 0.08,
    shock_scale: 0.5,
    delay_prob: p.delayProb || 0,
  };
}

// Adapt a demo persona's backend params into the same scenario dict shape,
// so the public demo can run the real simulator on persona data.
export function scenarioFromPersonaParams(params) {
  const { persona, starting_savings, ...rest } = params;
  return { ...rest, starting_balance: starting_savings };
}

// Format a number as Indian rupees, no decimals: inr(150000) -> "₹1,50,000".
export const inr = (v) =>
  '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });

// Format a 0-1 fraction as a percent string: pct(0.579) -> "58%".
export const pct = (v) => `${Math.round(v * 100)}%`;

// Display names for the model's feature keys, used in driver breakdowns.
export const FEATURE_LABELS = {
  runway_months: 'Savings runway', savings_rate: 'Savings rate',
  debt_service_ratio: 'Debt burden', income_volatility: 'Income volatility',
  income_trend: 'Income trend', expense_drift: 'Expense growth',
  late_payments: 'Late payments', neg_flow_months: 'Loss-making months',
  avg_income: 'Income level',
};

// Plain-language phrase for a SHAP driver, shared by dashboard + conclusions.
export function driverPhrase(d) {
  const f = d.feature, v = d.value;
  switch (f) {
    case 'runway_months': return v < 3 ? `your savings would only last ${v.toFixed(1)} months if income stopped` : `you have a ${v.toFixed(1)}-month savings buffer`;
    case 'savings_rate': return v < 0 ? `you're spending ${Math.abs(v * 100).toFixed(0)}% more than you earn` : `you're saving ${(v * 100).toFixed(0)}% of what you earn`;
    case 'debt_service_ratio': return `${(v * 100).toFixed(0)}% of your income goes to debt payments`;
    case 'income_volatility': return `your income swings ±${(v * 100).toFixed(0)}% month to month`;
    case 'income_trend': return v < 0 ? `your income is falling ${Math.abs(v * 100).toFixed(1)}% per month` : `your income is growing ${(v * 100).toFixed(1)}% per month`;
    case 'expense_drift': return v > 0 ? `your expenses grew ${(v * 100).toFixed(0)}% over this period` : `your expenses are flat or shrinking`;
    case 'late_payments': return `you had ${v} late or missed payments`;
    case 'neg_flow_months': return `in ${v} months, spending beat income`;
    case 'avg_income': return `your monthly income is around ${inr(v)}`;
    default: return f;
  }
}

// Layman "bottom line" notes for the risk dashboard. No jargon.
export function buildConclusion(assessment, baseProj) {
  const a = assessment;
  const notes = [];
  const statusWord = { STABLE: 'stable ✅', DRIFTING: 'drifting toward trouble ⚠️', CRITICAL: 'in critical condition 🚨' }[a.status] || a.status;
  notes.push(`Right now your finances are ${statusWord}. The AI estimates a ${Math.round(a.belief * 100)}% chance of financial stress in the coming months.`);
  const up = a.drivers.find((d) => d.direction === 'up');
  if (up) notes.push(`The biggest warning sign: ${driverPhrase(up)}.`);
  const down = a.drivers.find((d) => d.direction === 'down');
  if (down) notes.push(`What's working in your favour: ${driverPhrase(down)}.`);
  if (baseProj && baseProj.scenarios && baseProj.scenarios[0]) {
    const ind = baseProj.scenarios[0].indicators;
    if (ind.first_stress_month) {
      notes.push(`If nothing changes, you could start running short around month ${ind.first_stress_month} — that's the storm NIVARA sees coming.`);
    } else {
      notes.push(`If nothing changes, your balance is projected to stay positive for the next 12 months. The job now is to keep it that way.`);
    }
  }
  notes.push(`The good news: small changes move the needle. Try them side-by-side in the What-If Simulator.`);
  return notes;
}

// ------------------------------------------------ Challenge 2: recovery actions
// Preset recovery actions. `changes(base)` mirrors the simulator's quick
// actions so an action can be projected with one click; null means the
// action is tracked by belief/runway instead of a scenario tweak.
export const ACTION_PRESETS = [
  { id: 'cutvar', label: 'Cut variable spending by 20%',
    blurb: 'Dining out, shopping, subscriptions — trim the flexible costs first.',
    changes: (b) => ({ var_exp: b.var_exp * 0.8 }) },
  { id: 'side', label: 'Add ₹12,000/month side income',
    blurb: 'Freelancing, overtime, or a small side gig on the side.',
    changes: (b) => ({ base_income: b.base_income + 12000 }) },
  { id: 'emi', label: 'Negotiate EMI down 25%',
    blurb: 'Ask your lender about restructuring, a lower rate, or a longer tenure.',
    changes: (b) => ({ emi: b.emi * 0.75 }) },
  { id: 'buffer', label: 'Build a 3-month emergency buffer',
    blurb: 'A savings cushion softens income shocks. Watch it via your runway.',
    changes: null },
  { id: 'custom', label: 'Custom action…',
    blurb: 'Something else you want to try — describe it in your own words.',
    changes: null },
];

export const ACTION_STATUS = ['planned', 'in_progress', 'completed', 'dropped'];
export const ACTION_STATUS_LABEL = {
  planned: '📌 Planned', in_progress: '🔄 In progress',
  completed: '✅ Completed', dropped: '➖ Dropped',
};

// Verdict for a recovery action from its belief trail:
// compare the belief when the action started vs the latest reading.
export function actionVerdict(action) {
  const t = action.trail || [];
  if (t.length < 2) {
    return { key: 'pending', label: 'Not enough data yet', cls: 'pending',
             detail: 'Add another month of data to see whether this action is moving the needle.' };
  }
  const d = t[t.length - 1].belief - t[0].belief;
  const from = Math.round(t[0].belief * 100), to = Math.round(t[t.length - 1].belief * 100);
  if (d <= -0.10) {
    return { key: 'improving', label: '📉 Improving', cls: 'good',
             detail: `Stress belief fell from ${from}% to ${to}% since you started this.` };
  }
  if (d >= 0.10) {
    return { key: 'deteriorating', label: '📈 Deteriorating', cls: 'bad',
             detail: `Stress belief rose from ${from}% to ${to}% since you started this — it may need a rethink.` };
  }
  return { key: 'unchanged', label: '➖ Unchanged', cls: 'neutral',
           detail: `Stress belief is roughly flat (${from}% → ${to}%). Give it another month or try a different lever.` };
}

// Create a new recovery action from a preset (or a custom label), seeded with
// the stress belief at creation so its trail starts with a "before" reading.
export const newAction = (presetId, customLabel, startBelief) => ({
  id: 'act-' + Math.random().toString(36).slice(2, 9),
  presetId,
  label: presetId === 'custom' ? (customLabel || 'Custom action') :
    (ACTION_PRESETS.find((p) => p.id === presetId) || {}).label || 'Recovery action',
  status: 'planned',
  createdAt: new Date().toISOString(),
  startBelief,
  trail: startBelief != null ? [{ ts: new Date().toISOString(), belief: startBelief }] : [],
});

// ------------------------------------------------ Financial goals
// Goal pickers: categories, priority levels and time horizons (each term
// maps to a month count used by goalPlan's feasibility math).
export const GOAL_CATEGORIES = [
  { id: 'savings', label: '💰 General savings' },
  { id: 'emergency', label: '🛡️ Emergency fund' },
  { id: 'vehicle', label: '🛵 Buy a vehicle' },
  { id: 'home', label: '🏠 Home / down payment' },
  { id: 'gadget', label: '📱 Gadget / electronics' },
  { id: 'education', label: '🎓 Education / course' },
  { id: 'debt', label: '💳 Clear a debt' },
  { id: 'custom', label: '✨ Something else' },
];
export const GOAL_PRIORITIES = [
  { id: 'high', label: '🔴 High' },
  { id: 'mid', label: '🟡 Mid' },
  { id: 'low', label: '🟢 Low' },
];
export const GOAL_TERMS = [
  { id: 'short', label: '⚡ Short term (< 1 yr)', months: 12 },
  { id: 'mid', label: '🗓️ Mid term (1–3 yrs)', months: 36 },
  { id: 'long', label: '🌱 Long term (3+ yrs)', months: 60 },
];

// Create a new goal record from the goal form fields.
export const newGoal = ({ name, category, target, saved, priority, term, milestone }) => ({
  id: 'goal-' + Math.random().toString(36).slice(2, 9),
  name: (name || '').trim() || 'Untitled goal',
  category: category || 'savings',
  target: Math.max(0, +target || 0),
  saved: Math.max(0, +saved || 0),
  priority: priority || 'mid',
  term: term || 'short',
  milestone: Math.min(95, Math.max(10, +milestone || 50)),
  createdAt: new Date().toISOString(),
});

// Monthly saving needed vs the user's current monthly surplus (from the
// assessed features), so each goal gets an honest feasibility read.
export function goalPlan(goal, features) {
  const horizon = (GOAL_TERMS.find((t) => t.id === goal.term) || GOAL_TERMS[0]).months;
  const remaining = Math.max(0, goal.target - goal.saved);
  const perMonth = horizon > 0 ? remaining / horizon : remaining;
  const surplus = features
    ? Math.max(0, (features.savings_rate || 0) * (features.avg_income || 0))
    : null;
  let feasibility;
  if (remaining <= 0) {
    feasibility = { key: 'done', label: '🎉 Goal reached — nicely done!', cls: 'good' };
  } else if (surplus == null) {
    feasibility = { key: 'unknown', label: 'Finish your profile to check feasibility.', cls: 'neutral' };
  } else if (surplus <= 0) {
    feasibility = { key: 'tight', label: '⚠️ No monthly surplus right now — free up cash flow first.', cls: 'bad' };
  } else if (perMonth <= surplus) {
    feasibility = { key: 'ontrack', label: `✅ On track — needs ${inr(perMonth)}/mo of your ~${inr(surplus)}/mo surplus.`, cls: 'good' };
  } else {
    feasibility = { key: 'stretch', label: `🟠 Stretch — needs ${inr(perMonth)}/mo but your surplus is ~${inr(surplus)}/mo.`, cls: 'neutral' };
  }
  return {
    horizon, remaining, perMonth, surplus, feasibility,
    pct: goal.target > 0 ? Math.min(100, (goal.saved / goal.target) * 100) : 0,
  };
}

export const GOAL_PRIORITY_ORDER = { high: 0, mid: 1, low: 2 };

// ------------------------------------------------ Income & expense manager
// Business support: a month can carry many individual transactions
// (client payments, rent, salaries...). Totals fold into income/expenses
// everywhere — UI, balances and the API payload.
export const monthTotals = (m) => {
  let income = +m.income || 0, expenses = +m.expenses || 0;
  (m.txns || []).forEach((t) => {
    const a = +t.amount || 0;
    if (t.kind === 'income') income += a; else expenses += a;
  });
  return { income: Math.round(income), expenses: Math.round(expenses) };
};

// Strip txns and send folded totals to the backend.
export const foldTxns = (m) => {
  const { income, expenses } = monthTotals(m);
  const { txns, ...rest } = m;
  return { ...rest, income, expenses };
};

// Create a single income/expense line item inside a business month.
export const newTxn = (label, kind, amount) => ({
  id: 'txn-' + Math.random().toString(36).slice(2, 9),
  label: (label || '').trim() || (kind === 'income' ? 'Income item' : 'Expense item'),
  kind: kind === 'income' ? 'income' : 'expense',
  amount: Math.max(0, +amount || 0),
});

// Running-balance continuity: recompute every month-end balance from the
// starting balance whenever months are added, edited or deleted.
export const monthNet = (m) => {
  const { income, expenses } = monthTotals(m);
  return income - expenses - (m.emi || 0) - (m.shock || 0);
};

export const withBalances = (starting, months) => {
  let bal = +starting || 0;
  return months.map((m) => {
    bal += monthNet(m);
    return { ...m, balance: Math.round(bal) };
  });
};

// Anchor-aware balance chaining.
// The leading run of wizard-estimated months represents the PAST ending at
// TODAY's known liquidity, so it is anchored to END at startingBalance — a
// fresh user sees their actual figure with no fabricated balance history.
// Real (recorded) months chain forward from there as facts.
export const anchorMonths = (startingBalance, months) => {
  if (!months.length) return [];
  const sb = +startingBalance || 0;
  let i = 0;
  while (i < months.length && months[i].estimated) i++;
  const prefix = months.slice(0, i);
  const rest = months.slice(i);
  let bal = sb - prefix.reduce((s, m) => s + monthNet(m), 0);
  const out = prefix.map((m) => {
    bal += monthNet(m);
    return { ...m, balance: Math.round(bal) };
  });
  for (const m of rest) {
    bal += monthNet(m);
    out.push({ ...m, balance: Math.round(bal) });
  }
  return out;
};

export const DEFAULT_THRESHOLDS = { expense: 30000, savings: 20000, savingsPct: 20, debtPct: 40 };

// Rule-based spending alerts from the monthly series:
// expense limit, savings floor, salary rule (savings as % of income),
// and debt rule (EMI as % of income).
export function moneyAlerts(months, thresholds) {
  const alerts = [];
  (months || []).forEach((m, i) => {
    const label = `M${i + 1}`;
    const { income, expenses } = monthTotals(m);
    if (expenses > thresholds.expense) {
      alerts.push({
        id: `exp-${i}`, kind: 'expense', severity: 'high', month: label, monthIdx: i,
        message: `${label}: expenses of ${inr(expenses)} crossed your ${inr(thresholds.expense)}/month limit.`,
      });
    }
    const net = monthNet(m);
    if (net < thresholds.savings) {
      alerts.push({
        id: `sav-${i}`, kind: 'savings', severity: net < 0 ? 'high' : 'medium', month: label, monthIdx: i,
        message: `${label}: savings of ${inr(net)} fell below your ${inr(thresholds.savings)}/month floor.`,
      });
    }
    if (income > 0 && thresholds.savingsPct > 0) {
      const pct = (net / income) * 100;
      if (pct < thresholds.savingsPct) {
        alerts.push({
          id: `sal-${i}`, kind: 'salary', severity: 'medium', month: label, monthIdx: i,
          message: `${label}: savings were only ${pct.toFixed(0)}% of income — below your ${thresholds.savingsPct}% salary rule.`,
        });
      }
    }
    if (income > 0 && thresholds.debtPct > 0) {
      const dsr = ((m.emi || 0) / income) * 100;
      if (dsr > thresholds.debtPct) {
        alerts.push({
          id: `debt-${i}`, kind: 'debt', severity: 'high', month: label, monthIdx: i,
          message: `${label}: debt payments were ${dsr.toFixed(0)}% of income — above your ${thresholds.debtPct}% limit.`,
        });
      }
    }
  });
  return alerts;
}

// ------------------------------------------------ Assets & credit window
// Assets are either essential (home you live in, work vehicle — excluded from
// the credit window) or non-essential (sellable in an emergency).
export const ASSET_KINDS = [
  { id: 'essential', label: '🏠 Essential' },
  { id: 'nonessential', label: '🎸 Non-essential' },
];

// Create a new asset record from the add-asset form.
export const newAsset = ({ name, value, kind }) => ({
  id: 'asset-' + Math.random().toString(36).slice(2, 9),
  name: (name || '').trim() || 'Untitled asset',
  value: Math.max(0, +value || 0),
  kind: kind === 'nonessential' ? 'nonessential' : 'essential',
  createdAt: new Date().toISOString(),
});

// ------------------------------------------------ Business credit ledger
// Exclusive to business profiles. A receivable is positive credit — money
// owed TO the business. A payable is negative credit — money the business
// owes. Settling a credit moves the amount straight into/out of the starting
// balance, so every downstream number (current balance, runway, projections,
// risk score) reacts: the whole chain re-anchors and the profile is rescored.
export const CREDIT_KINDS = [
  { id: 'receivable', label: '➕ Receivable', hint: 'Money owed TO you — "Received" adds it to your balance.' },
  { id: 'payable', label: '➖ Payable', hint: 'Money YOU owe — "Paid" deducts it from your balance.' },
];

export const newCredit = ({ label, kind, amount }) => ({
  id: 'cr-' + Math.random().toString(36).slice(2, 9),
  label: (label || '').trim() || (kind === 'payable' ? 'Payable' : 'Receivable'),
  kind: kind === 'payable' ? 'payable' : 'receivable',
  amount: Math.max(0, Math.round(+amount || 0)),
  settled: false,
  createdAt: new Date().toISOString(),
  settledAt: null,
});

// Open (unsettled) totals: what is still to receive / still to pay.
export const creditTotals = (credits) => {
  let toReceive = 0, toPay = 0;
  (credits || []).filter((c) => !c.settled).forEach((c) => {
    if (c.kind === 'payable') toPay += +c.amount || 0;
    else toReceive += +c.amount || 0;
  });
  return { toReceive, toPay, net: toReceive - toPay };
};

// Emergency credit window: what selling non-essential assets unlocks,
// expressed in months of average monthly outflow.
export function creditWindow(assets, avgMonthlyOutflow) {
  const sellable = (assets || [])
    .filter((a) => a.kind === 'nonessential')
    .reduce((s, a) => s + (+a.value || 0), 0);
  const essential = (assets || [])
    .filter((a) => a.kind !== 'nonessential')
    .reduce((s, a) => s + (+a.value || 0), 0);
  const monthsCovered = avgMonthlyOutflow > 0 ? sellable / avgMonthlyOutflow : 0;
  return { sellable, essential, total: sellable + essential, monthsCovered };
}

// ------------------------------------------------ Simulator presets (shared)
// Used by the What-If Simulator, the dashboard projection chart and the
// recent-simulations table, so names stay consistent everywhere.
export const SIM_PRESETS = [
  { id: 'cutvar', name: 'Cut variable spending 20%', blurb: 'Variable spending −20%',
    changes: (b) => ({ var_exp: b.var_exp * 0.8 }) },
  { id: 'cutfix', name: 'Trim fixed costs 10%', blurb: 'Fixed costs −10%',
    changes: (b) => ({ fixed_exp: b.fixed_exp * 0.9 }) },
  { id: 'side', name: 'Side income +₹12k/mo', blurb: 'Side income +₹12,000/mo',
    changes: (b) => ({ base_income: b.base_income + 12000 }) },
  { id: 'emi', name: 'Negotiate EMI −25%', blurb: 'EMI −25%',
    changes: (b) => ({ emi: b.emi * 0.75 }) },
];

// Short blurb for a simulator preset name, for the recent-simulations table.
export const simPresetBlurb = (name) =>
  (SIM_PRESETS.find((p) => p.name === name) || {}).blurb || '—';
