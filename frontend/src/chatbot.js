import { inr, driverPhrase, monthTotals } from './finance.js';
import { api } from './api.js';

// Nivara Coach — a data-grounded financial assistant.
//
// Deliberately no external LLM: every number in every answer comes from the
// user's live state (stress model, projections, months, goals, alerts). It
// answers questions about their finances and runs real what-if simulations
// through the existing backend simulator. Why no LLM: a hackathon demo can't
// depend on API keys the judges don't have, and grounding every answer in the
// user's actual model output means the coach can never hallucinate a number.
//
// coachReply(text, ctx) -> Promise<{ text, chips: string[] }>
// The router below matches intents in priority order (what-if first, then
// greetings, definitions, advice, data questions, ...); each answer builder
// returns markdown-ish text plus follow-up suggestion chips for the widget.
//
// ctx = {
//   userName, profileType,
//   belief, status, drivers, features, beliefHistory,
//   months, scenarioBase, currentBalance,
//   goals, alertsFeed, actions, assets,
// }

const pct = (b) => `${Math.round((b || 0) * 100)}%`; // 0-1 belief -> "58%"

const STATUS_WORD = {
  STABLE: 'Stable ✅',
  DRIFTING: 'Drifting ⚠️',
  CRITICAL: 'Critical 🚨',
}; // model status -> chat-friendly label

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1); // "runway" -> "Runway"

// Average income/expenses/EMI across recorded months, plus the latest month's
// totals — the raw material for most money answers.
function monthStats(ctx) {
  const ms = ctx.months || [];
  const totals = ms.map(monthTotals);
  const n = Math.max(1, totals.length);
  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / n;
  return {
    n: ms.length,
    avgIncome: Math.round(avg(totals.map((t) => t.income))),
    avgExp: Math.round(avg(totals.map((t) => t.expenses))),
    avgEmi: Math.round(avg(ms.map((m) => m.emi || 0))),
    last: totals[totals.length - 1] || null,
  };
}

// Top n SHAP drivers pushing the score up ('up') or pulling it down ('down').
function topDrivers(ctx, dir, n = 3) {
  return (ctx.drivers || []).filter((d) => d.direction === dir).slice(0, n);
}

// One-line trend from the belief history ("improving — down from 45% to 38%").
// Returns null when there aren't two readings yet; moves under 3 points count
// as flat so borderline wobble isn't reported as a trend.
function trendLine(ctx) {
  const h = ctx.beliefHistory || [];
  if (h.length < 2) return null;
  const d = h[h.length - 1] - h[0];
  if (Math.abs(d) < 0.03) return 'roughly flat across your recent checks';
  return d < 0
    ? `improving — down from ${pct(h[0])} to ${pct(h[h.length - 1])}`
    : `worsening — up from ${pct(h[0])} to ${pct(h[h.length - 1])}`;
}

// ---------------------------------------------------------------------------
// What-if parsing: "what if my income drops 20%" -> simulator variants.
// ---------------------------------------------------------------------------
// Turn a natural-language "what if" into backend simulator variants:
// [{name, changes}], where `changes` patches the scenarioBase dict
// (base_income, fixed_exp/var_exp, emi, starting_balance). Handles % changes
// with up/down direction words, job loss ("no income"), absolute rupee
// changes, and emergency amounts whether the number comes before or after
// the keyword ("₹50,000 emergency" vs "emergency of 50000").
function parseWhatIf(q, base) {
  const variants = [];
  const amt = (s) => parseInt(s.replace(/,/g, ''), 10);

  let m = q.match(/income[^\d%₹]*(\d+(?:\.\d+)?)\s*%/);
  if (m) {
    const p = parseFloat(m[1]) / 100;
    const down = /(drop|fall|fell|decreas|cut|reduc|less|down|lower)/.test(q);
    const f = down ? 1 - p : 1 + p;
    variants.push({
      name: `Income ${down ? '−' : '+'}${m[1]}%`,
      changes: { base_income: Math.max(0, Math.round(base.base_income * f)) },
    });
  }
  if (/(lose|lost|losing)\s+(my\s+)?job|no income|income\s*(drops?|falls?)\s*to\s*(0|zero)/.test(q)) {
    variants.push({ name: 'Job loss (no income)', changes: { base_income: 0 } });
  }
  m = q.match(/(expense|spend|spending)[^\d%₹]*(\d+(?:\.\d+)?)\s*%/);
  if (m) {
    const p = parseFloat(m[2]) / 100;
    const down = /(cut|reduc|save|less|down|decreas|lower)/.test(q);
    const f = down ? 1 - p : 1 + p;
    variants.push({
      name: `Expenses ${down ? '−' : '+'}${m[2]}%`,
      changes: {
        fixed_exp: Math.max(0, Math.round(base.fixed_exp * f)),
        var_exp: Math.max(0, Math.round(base.var_exp * f)),
      },
    });
  }
  m = q.match(/(?:spend|expense|expenses)[^\d₹]*₹?\s*([\d,]+)\s*(more|extra|less)/);
  if (m && !variants.some((v) => v.name.startsWith('Expenses'))) {
    const d = amt(m[1]) * (m[2] === 'less' ? -1 : 1);
    variants.push({
      name: `Spending ${d < 0 ? '−' : '+'}${inr(Math.abs(d))}/mo`,
      changes: { var_exp: Math.max(0, Math.round(base.var_exp + d)) },
    });
  }
  m = q.match(/emi[^\d%₹]*(\d+(?:\.\d+)?)\s*%/);
  if (m) {
    const p = parseFloat(m[1]) / 100;
    const down = /(drop|fall|decreas|cut|reduc|less|down|lower|paid off|pay off)/.test(q);
    const f = down ? 1 - p : 1 + p;
    variants.push({
      name: `EMI ${down ? '−' : '+'}${m[1]}%`,
      changes: { emi: Math.max(0, Math.round(base.emi * f)) },
    });
  }
  let em = q.match(/(emergency|shock|unexpected|medical)[^\d₹]*₹?\s*([\d,]+)/);
  if (!em) {
    // amount before the keyword: "a ₹50,000 emergency"
    const rev = q.match(/₹?\s*([\d,]+)[^\d₹]{0,24}(emergency|shock|unexpected|medical)/);
    if (rev) em = [rev[0], rev[2], rev[1]];
  }
  if (em) {
    const a = amt(em[2]);
    if (a > 0) {
      variants.push({
        name: `${cap(em[1])} of ${inr(a)}`,
        changes: { starting_balance: Math.round(base.starting_balance - a) },
      });
    }
  }
  return variants;
}

// Turn one backend comparison-table row into a chat-friendly verdict:
// 6-month risk before -> after, lowest balance vs doing nothing, and the
// first stress month. `base` is the "no change" row for the deltas.
function summarizeWhatIf(name, base, row) {
  const lines = [`**${name}** — here's what the next 12 months look like:`];
  const riskBase = pct(base.model_risk_6mo);
  const riskVar = pct(row.model_risk_6mo);
  const dRisk = row.model_risk_6mo - base.model_risk_6mo;
  lines.push(
    `• 6-month stress risk: **${riskBase} → ${riskVar}**` +
    (Math.abs(dRisk) < 0.005 ? ' (basically unchanged)' : dRisk > 0 ? ' ⚠️ worse' : ' ✅ better')
  );
  lines.push(
    `• Lowest balance: **${inr(row.min_balance)}**` +
    (row.d_min_balance_vs_base >= 0
      ? ` (${inr(row.d_min_balance_vs_base)} better than doing nothing)`
      : ` (${inr(-row.d_min_balance_vs_base)} worse than doing nothing)`)
  );
  lines.push(
    `• First stress month: **${row.first_stress_month == null ? 'none 🎉' : `month ${row.first_stress_month}`}` +
    `** (base case: ${base.first_stress_month == null ? 'none' : `month ${base.first_stress_month}`})`
  );
  return lines.join('\n');
}

// Answer a "what if" question: parse -> run the REAL backend simulator
// (12 months, 300 sims — fewer than the tab's 400 for a snappier chat reply)
// -> summarize each variant vs the base case. When nothing parseable is found,
// suggest example phrasings instead of guessing. Backend failures get a plain
// "start the backend" message, never a fabricated answer.
async function answerWhatIf(q, ctx) {
  const base = ctx.scenarioBase || {};
  const variants = parseWhatIf(q.toLowerCase(), base);
  if (!variants.length) {
    return {
      text:
        'I can simulate that — try something like:\n' +
        '• "what if my income drops 20%"\n' +
        '• "what if I lose my job"\n' +
        '• "what if I cut expenses by 15%"\n' +
        '• "what if I have a ₹50,000 emergency"',
      chips: ['What if my income drops 20%?', 'What if I cut expenses by 15%?', 'What if I lose my job?'],
    };
  }
  try {
    const r = await api.simulate(base, variants, 12, 300);
    const table = r.comparison || [];
    const baseRow = table[0];
    const parts = table.slice(1).map((row, i) => summarizeWhatIf(variants[i].name, baseRow, row));
    return {
      text: parts.join('\n\n') + '\n\nWant to test another scenario, or save one as a recovery action?',
      chips: ['What if my income drops 20%?', 'How can I reduce my stress?', 'Try the simulator'],
    };
  } catch (e) {
    return {
      text: 'I couldn\'t run that simulation — the analysis backend isn\'t reachable right now. Start it and ask me again.',
      chips: ['How am I doing?', 'Why is my stress this level?'],
    };
  }
}

// ---------------------------------------------------------------------------
// Glossary: "what is X?", "what does X mean?", "why is it called X?"
// ---------------------------------------------------------------------------
// Static definitions of NIVARA's own vocabulary (stress bands, runway, credit
// window...). These never touch user data — they're the same everywhere.
const GLOSSARY = [
  {
    keys: ['stress score', 'belief'],
    title: 'Stress score (belief)',
    text: 'Your **stress score** is the model\'s estimate — 0% to 100% — of you hitting money trouble in the coming months. It\'s called "belief" because it\'s the model\'s current degree of belief: each new month of data nudges it up or down, so it learns as you go.',
    chips: ['How am I doing?', 'Why is my stress this level?'],
  },
  {
    keys: ['stable'],
    title: 'STABLE',
    text: '**STABLE** means your stress score is under 40%. Nothing in your numbers is flashing red — the model sees no meaningful risk of trouble ahead.',
    chips: ['How am I doing?'],
  },
  {
    keys: ['drifting'],
    title: 'DRIFTING',
    text: '**DRIFTING** means your score is between 40% and 70% — an early warning. You\'re not in trouble yet, but the trend is bending the wrong way. This is the stage where small fixes work best.',
    chips: ['Why is my stress this level?', 'How can I reduce my stress?'],
  },
  {
    keys: ['critical'],
    title: 'CRITICAL',
    text: '**CRITICAL** means your score is 70% or higher — the model sees a high chance of financial stress soon. Time for decisive moves: cut spending, protect cash, check the recovery actions.',
    chips: ['Why is my stress this level?', 'How can I reduce my stress?'],
  },
  {
    keys: ['runway'],
    title: 'Runway',
    text: '**Runway** is how many months your money would last if your income stopped tomorrow. Under 3 months is fragile, 3–6 is decent, 6+ is a solid cushion.',
    chips: ['How long will my money last?', 'What if I lose my job?'],
  },
  {
    keys: ['savings rate'],
    title: 'Savings rate',
    text: '**Savings rate** is the share of your income you keep after spending. Positive means you\'re building wealth; negative means you\'re spending more than you earn — one of the strongest stress drivers.',
    chips: ['Where does my money go?', 'How can I reduce my stress?'],
  },
  {
    keys: ['debt service ratio', 'debt burden'],
    title: 'Debt service ratio',
    text: '**Debt service ratio** is the percentage of your income eaten by debt payments (EMIs). Above 40% is heavy and a major stress driver; under 25% is comfortable.',
    chips: ['What is my EMI?', 'Why is my stress this level?'],
  },
  {
    keys: ['income volatility'],
    title: 'Income volatility',
    text: '**Income volatility** measures how much your income swings month to month. Wild swings make planning hard, so the model treats high volatility as a risk driver even when average income looks fine.',
    chips: ['How much do I earn?', 'Why is my stress this level?'],
  },
  {
    keys: ['expense drift', 'expense growth'],
    title: 'Expense drift',
    text: '**Expense drift** is how fast your spending has been growing over your recorded months. Creeping expenses are a quiet killer — the model flags it before you feel it.',
    chips: ['Where does my money go?', 'What if I cut expenses by 15%?'],
  },
  {
    keys: ['credit window'],
    title: 'Credit window',
    text: 'Your **credit window** is the cash you could unlock by selling non-essential assets (second vehicle, jewellery, gadgets) — expressed in months of spending. Think of it as a self-funded credit line with no lender involved.',
    chips: ['What assets do I have?', 'How long will my money last?'],
  },
  {
    keys: ['essential asset', 'non-essential', 'nonessential'],
    title: 'Essential vs non-essential assets',
    text: '**Essential** assets are things you can\'t sell without hurting daily life (the home you live in, your work vehicle). **Non-essential** ones (second vehicle, jewellery, gadgets, land) count toward your credit window — they\'re your emergency reserve.',
    chips: ['What assets do I have?'],
  },
  {
    keys: ['what-if', 'what if simulator', 'simulator'],
    title: 'What-If Simulator',
    text: 'The **What-If Simulator** runs 400 Monte Carlo simulations of your next 12 months per scenario — income drops, expense cuts, emergencies — and shows how each changes your stress risk. You can also just ask me "what if…" right here.',
    chips: ['What if my income drops 20%?', 'What if I lose my job?'],
  },
  {
    keys: ['recovery action'],
    title: 'Recovery actions',
    text: '**Recovery actions** are concrete steps you commit to — cut variable spending 15%, build a buffer, pause EMIs. You track them in Alerts & Recovery, and the simulator can test their impact before you commit.',
    chips: ['How can I reduce my stress?', 'What if I cut expenses by 15%?'],
  },
  {
    keys: ['alert'],
    title: 'Alerts',
    text: '**Alerts** are the model tapping you on the shoulder: a baseline when scoring starts, warnings when risk rises or your status changes, and good-news alerts when risk falls. They live in the Alerts & Recovery tab.',
    chips: ['Do I have any alerts?', 'How am I doing?'],
  },
  {
    keys: ['current balance'],
    title: 'Current Balance',
    text: '**Current Balance** is your running month-end balance, chained from your starting balance: each month adds income and subtracts expenses, EMIs and shocks. The "↑/↓ since start" tells you whether you\'re richer or poorer than day one.',
    chips: ['What is my balance?', 'Where does my money go?'],
  },
  {
    keys: ['emi'],
    title: 'EMI',
    text: '**EMI** (Equated Monthly Instalment) is your fixed monthly loan payment. In Nivara it feeds your debt burden directly — big EMIs relative to income are a top stress driver.',
    chips: ['What is my EMI?', 'Why is my stress this level?'],
  },
  {
    keys: ['fixed expense', 'variable expense'],
    title: 'Fixed vs variable expenses',
    text: '**Fixed** expenses barely move (rent, EMIs, insurance); **variable** ones do (food, travel, shopping). Splitting them matters because variable spending is what you can actually cut in a crunch.',
    chips: ['Where does my money go?', 'What if I cut expenses by 15%?'],
  },
  {
    keys: ['projection', 'forecast'],
    title: 'Projection',
    text: 'The **projection** simulates your balance 12 months out, hundreds of times. The middle line is the median outcome; the shaded band (p10–p90) is the range — narrow means predictable, wide means uncertain.',
    chips: ['Will I run out of money?', 'What if my income drops 20%?'],
  },
  {
    keys: ['shortfall'],
    title: 'Shortfall',
    text: 'A **shortfall** is a simulated month where your balance goes negative — spending beat everything you had. The simulator counts how often that happens to estimate each scenario\'s risk.',
    chips: ['What if I lose my job?', 'How can I reduce my stress?'],
  },
  {
    keys: ['shap', 'driver'],
    title: 'Drivers',
    text: '**Drivers** are the factors pushing your stress score up or down, ranked by the model\'s SHAP analysis — the same technique used to explain AI predictions. "Why is my stress this level?" lists yours in plain language.',
    chips: ['Why is my stress this level?', 'How am I doing?'],
  },
];

// Phrasings that signal a definition request rather than a data question.
const DEF_PATTERNS = /(what is|what's|what are|what does|define|definition of|meaning of|mean by|explain|why is it called|why's it called)/;

// Match a definition request against the glossary. Returns {text, chips} or
// null. The `my <term>` guard keeps personal questions ("what is MY emi?")
// on the data-intent path instead of returning a dictionary definition.
function answerDefinition(q) {
  if (!DEF_PATTERNS.test(q)) return null;
  for (const g of GLOSSARY) {
    for (const k of g.keys) {
      const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${esc}s?\\b`);
      if (!re.test(q)) continue;
      // "what is MY emi" is a personal question, not a definition request.
      if (new RegExp(`my\\s+${esc}s?`).test(q)) continue;
      return { text: g.text, chips: g.chips || ['What can you do?'] };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Intent answers (all grounded in live data).
// ---------------------------------------------------------------------------
// "How am I doing?" — current score + status + trend + the top warning sign.
function answerStatus(ctx) {
  const s = monthStats(ctx);
  const t = trendLine(ctx);
  let text =
    `${ctx.userName}, your financial stress is at **${pct(ctx.belief)}** — **${STATUS_WORD[ctx.status] || ctx.status}**.\n` +
    `That's the model's estimate of hitting money trouble in the coming months, based on your last ${s.n} recorded month${s.n === 1 ? '' : 's'}.`;
  if (t) text += `\nTrend: ${t}.`;
  const up = topDrivers(ctx, 'up', 1)[0];
  if (up && ctx.status !== 'STABLE') text += `\nBiggest warning sign right now: ${driverPhrase(up)}.`;
  return {
    text,
    chips: ['Why is my stress this level?', 'How can I reduce my stress?', 'What if my income drops 20%?'],
  };
}

// "Why is my stress this level?" — top risk drivers in plain language via
// driverPhrase(), plus the strongest favourable factor for balance.
function answerWhy(ctx) {
  const ups = topDrivers(ctx, 'up', 3);
  const downs = topDrivers(ctx, 'down', 1);
  if (!ups.length) {
    return {
      text: `Honestly? There's no single culprit — your score is **${pct(ctx.belief)}** (${STATUS_WORD[ctx.status] || ctx.status}) and no risk driver stands out. That's a genuinely calm picture.`,
      chips: ['How can I reduce my stress?', 'How am I doing?'],
    };
  }
  let text = `Here's what's pushing your stress to **${pct(ctx.belief)}**:\n` +
    ups.map((d, i) => `${i + 1}. ${cap(driverPhrase(d))}.`).join('\n');
  if (downs.length) text += `\n\nWorking in your favour: ${driverPhrase(downs[0])}.`;
  return {
    text,
    chips: ['How can I reduce my stress?', 'What if I cut expenses by 15%?', 'How am I doing?'],
  };
}

// "Is it getting better?" — trend from the belief history.
function answerTrend(ctx) {
  const t = trendLine(ctx);
  if (!t) {
    return {
      text: `I need at least two check-ins to call a trend — right now I only have your current score of **${pct(ctx.belief)}**. Add a month or tweak your profile and check back.`,
      chips: ['How am I doing?', 'Why is my stress this level?'],
    };
  }
  return {
    text: `Your stress score is **${t}**. Current level: **${pct(ctx.belief)}** (${STATUS_WORD[ctx.status] || ctx.status}).`,
    chips: ['Why is my stress this level?', 'How can I reduce my stress?'],
  };
}

// "How long will my money last?" — runway from the assessed features, with a
// plain read on whether that cushion is thin, decent or solid.
function answerRunway(ctx) {
  const r = ctx.features?.runway_months;
  if (r == null) {
    return { text: `I don't have a runway figure for you yet — add a few months of data first.`, chips: ['How am I doing?'] };
  }
  const word = r < 3 ? 'That\'s thin — anything under 3 months is fragile.'
    : r < 6 ? 'Decent, but one long shock could still hurt.'
    : 'That\'s a solid cushion. ✅';
  return {
    text: `If your income stopped today, your money would last **${r.toFixed(1)} months**. ${word}`,
    chips: ['What if I lose my job?', 'How can I reduce my stress?', 'Where does my money go?'],
  };
}

// "How can I reduce my stress?" — tips chosen from the user's ACTUAL top
// drivers (spending, debt load, runway, volatility), not generic advice.
// Mentions tracked recovery actions when any are in flight.
function answerAdvice(ctx) {
  const ups = topDrivers(ctx, 'up', 2);
  const tips = [];
  const feats = ctx.features || {};
  if (ups.some((d) => d.feature === 'savings_rate') || (feats.savings_rate ?? 1) < 0.1) {
    tips.push('**Spend a little less than you earn** — even a 10% expense cut moves the needle fast. Try: "what if I cut expenses by 10%?"');
  }
  if (ups.some((d) => d.feature === 'debt_service_ratio') || (feats.debt_service_ratio ?? 0) > 0.35) {
    tips.push('**Ease the debt load** — over a third of income going to EMIs is heavy. Avoid new loans; consider prepaying the costliest one.');
  }
  if (ups.some((d) => d.feature === 'runway_months') || (feats.runway_months ?? 99) < 3) {
    tips.push('**Build a buffer** — aim for 3 months of expenses parked safely. Your runway is the single biggest shock absorber.');
  }
  if (ups.some((d) => d.feature === 'income_volatility')) {
    tips.push('**Smooth the income swings** — volatile income is a top stress driver. A second income stream or retainer-style work helps.');
  }
  if (!tips.length) {
    tips.push('**Keep doing what you\'re doing** — no big red flags. The highest-leverage move is growing the emergency buffer a little each month.');
  }
  const acts = (ctx.actions || []).filter((a) => a.status !== 'done');
  let text = `To bring **${pct(ctx.belief)}** down:\n` + tips.map((t, i) => `${i + 1}. ${t}`).join('\n');
  if (acts.length) text += `\n\nYou're already tracking ${acts.length} recovery action${acts.length === 1 ? '' : 's'} — nice. Check the Alerts & Recovery tab to update them.`;
  return {
    text,
    chips: ['What if I cut expenses by 15%?', 'Try the simulator', 'Why is my stress this level?'],
  };
}

// "Where does my money go?" — average monthly spend, the profile's
// fixed/variable split, and a nudge when last month diverged from average.
function answerExpenses(ctx) {
  const s = monthStats(ctx);
  const sb = ctx.scenarioBase || {};
  const fixed = Math.round(sb.fixed_exp || 0), variable = Math.round(sb.var_exp || 0);
  let text = `You spend about **${inr(s.avgExp)}/month** on average across your last ${s.n} month${s.n === 1 ? '' : 's'}.`;
  if (fixed || variable) text += `\nYour profile splits that into **${inr(fixed)}** fixed + **${inr(variable)}** variable.`;
  if (s.last && s.n > 1) {
    const d = s.last.expenses - s.avgExp;
    if (Math.abs(d) > s.avgExp * 0.1) {
      text += `\nLast month was ${d > 0 ? 'above' : 'below'} your average by **${inr(Math.abs(Math.round(d)))}** — ${d > 0 ? 'worth a look at what drove it.' : 'nice discipline. 👍'}`;
    }
  }
  return {
    text,
    chips: ['What if I cut expenses by 15%?', 'How much do I earn?', 'How can I reduce my stress?'],
  };
}

// "How much do I earn?" — profile income vs recorded average, plus the EMI
// share of income for context.
function answerIncome(ctx) {
  const s = monthStats(ctx);
  const base = Math.round(ctx.scenarioBase?.base_income || 0);
  let text = `Your profile income is **${inr(base)}/month**`;
  if (s.n) text += `, and your recorded months average **${inr(s.avgIncome)}**`;
  text += '.';
  const emi = Math.round(ctx.scenarioBase?.emi || 0);
  if (base && emi) text += `\n${Math.round((emi / base) * 100)}% of that goes to EMIs (${inr(emi)}).`;
  return {
    text,
    chips: ['What if my income drops 20%?', 'Where does my money go?', 'How am I doing?'],
  };
}

// "What is my EMI?" — EMI plus the debt-service ratio read (heavy/moderate/
// comfortable) so the number comes with a verdict.
function answerEmi(ctx) {
  const emi = Math.round(ctx.scenarioBase?.emi || 0);
  const dsr = ctx.features?.debt_service_ratio;
  let text = `Your EMI is **${inr(emi)}/month**.`;
  if (dsr != null) {
    text += ` That's **${Math.round(dsr * 100)}%** of your income going to debt — ` +
      (dsr > 0.4 ? 'heavy. This is likely a big part of your stress score.' : dsr > 0.25 ? 'moderate. Keep an eye on it before taking new loans.' : 'comfortable. ✅');
  }
  return {
    text,
    chips: ['Why is my stress this level?', 'How can I reduce my stress?'],
  };
}

// "What is my balance?" — current (latest month-end) balance + runway.
function answerBalance(ctx) {
  const bal = Math.round(ctx.currentBalance || 0);
  const r = ctx.features?.runway_months;
  let text = `Your current balance is **${inr(bal)}** (end of your latest recorded month).`;
  if (r != null) text += `\nThat's about **${r.toFixed(1)} months** of runway.`;
  return {
    text,
    chips: ['How long will my money last?', 'Where does my money go?'],
  };
}

// "What are my goals?" — lists goals with saved/target progress.
function answerGoals(ctx) {
  const gs = ctx.goals || [];
  if (!gs.length) {
    return {
      text: `You haven't set any goals yet — the Goals tab is the place. A classic first one: a 3-month emergency buffer.`,
      chips: ['How long will my money last?', 'How can I reduce my stress?'],
    };
  }
  const lines = gs.slice(0, 5).map((g) => {
    const p = g.target > 0 ? Math.round((g.saved / g.target) * 100) : 0;
    return `• **${g.name}** — ${inr(g.saved)} of ${inr(g.target)} (${p}%)`;
  });
  return {
    text: `You've got **${gs.length} goal${gs.length === 1 ? '' : 's'}**:\n` + lines.join('\n'),
    chips: ['How am I doing?', 'How can I reduce my stress?'],
  };
}

// "Do I have any alerts?" — count + latest headlines from the alerts feed.
function answerAlerts(ctx) {
  const feed = ctx.alertsFeed || [];
  if (!feed.length) {
    return {
      text: `All quiet — no risk alerts right now. That's the sound of **${pct(ctx.belief)}** stress behaving itself. 🔕`,
      chips: ['How am I doing?', 'What if my income drops 20%?'],
    };
  }
  const top = feed.slice(0, 3).map((a) => `• ${a.title || a.kind}`).join('\n');
  return {
    text: `You have **${feed.length} alert${feed.length === 1 ? '' : 's'}**. Latest:\n${top}\n\nFull list lives in the Alerts & Recovery tab.`,
    chips: ['How can I reduce my stress?', 'Why is my stress this level?'],
  };
}

// "What assets do I have?" — count, total value and months-of-spending cover.
function answerAssets(ctx) {
  const as = ctx.assets || [];
  if (!as.length) {
    return {
      text: `No assets listed yet. Non-essential assets (second vehicle, jewellery, gadgets) are your self-funded emergency credit — worth listing in Assets & Credit.`,
      chips: ['How long will my money last?', 'How am I doing?'],
    };
  }
  const total = as.reduce((s, a) => s + (a.value || 0), 0);
  const s = monthStats(ctx);
  const win = s.avgExp + s.avgEmi > 0 ? total / (s.avgExp + s.avgEmi) : 0;
  return {
    text: `You've listed **${as.length} asset${as.length === 1 ? '' : 's'}** worth **${inr(total)}** in total — roughly **${win.toFixed(1)} months** of spending if you ever needed to unlock it.`,
    chips: ['How long will my money last?', 'How am I doing?'],
  };
}

// "Will I run out of money?" — quick pace check from recorded averages:
// monthly surplus vs shortfall, pointing at the simulator for the full story.
function answerProjection(ctx) {
  const s = monthStats(ctx);
  const net = s.avgIncome - s.avgExp - s.avgEmi;
  let text;
  if (net >= 0) {
    text = `On your current pace you save about **${inr(net)}/month** — the 12-month projection trends upward. The simulator can stress-test that against shocks.`;
  } else {
    text = `Heads up: on your current pace you're **short about ${inr(-net)}/month** — spending beats income. The projection slides downhill unless something changes.`;
  }
  return {
    text,
    chips: ['What if I cut expenses by 15%?', 'Try the simulator', 'How can I reduce my stress?'],
  };
}

// "What can you do?" — capability list with example questions.
function answerHelp(ctx) {
  return {
    text:
      `I'm **Nivara Coach** — I answer from your real numbers, not generic advice. Ask me things like:\n` +
      `• "How am I doing?" / "Why is my stress this level?"\n` +
      `• "Where does my money go?" / "How long will my money last?"\n` +
      `• "What if my income drops 20%?" — I'll run a real simulation\n` +
      `• "How can I reduce my stress?"\n` +
      `• "What does runway mean?" — I'll explain any term in the app`,
    chips: ['How am I doing?', 'Why is my stress this level?', 'What if I lose my job?'],
  };
}

// Last resort: admit the miss and suggest questions the coach CAN answer.
function answerFallback(ctx) {
  return {
    text:
      `I'm not sure I got that — I work best on your money questions. Try:\n` +
      `"How am I doing?", "Why is my stress this level?", or "What if my income drops 20%?"`,
    chips: ['How am I doing?', 'Why is my stress this level?', 'What can you do?'],
  };
}

// ---------------------------------------------------------------------------
// Router.
// ---------------------------------------------------------------------------
// The single entry point. Intents are checked in priority order because
// questions overlap: "what if" first (it contains other keywords), then
// greetings/small talk, then definitions (before data intents, so "what does
// runway mean?" doesn't return the user's runway number), then advice/why/
// trend, then the data questions, then the catch-all status ("how am I
// doing?"), then the fallback. Returns a promise because what-if answers
// await the backend simulator.
export async function coachReply(rawText, ctx) {
  const q = rawText.toLowerCase().trim();
  if (!q) return { text: 'Ask me anything about your finances — try "How am I doing?"', chips: ['How am I doing?'] };

  if (/what if|suppose|scenario/i.test(rawText)) return answerWhatIf(rawText, ctx);
  if (/^(hi|hii+|hello|hey|namaste|good\s(morning|afternoon|evening))\b/.test(q)) {
    return {
      text: `Hey ${ctx.userName} 👋 I'm Nivara Coach. Ask me how you're doing, why your stress is what it is, or throw a "what if" at me.`,
      chips: ['How am I doing?', 'Why is my stress this level?', 'What if I lose my job?'],
    };
  }
  if (/thank|shukriya|dhanyavad/.test(q)) return { text: 'Anytime 👍 Keep an eye on that runway.', chips: ['How am I doing?'] };
  if (/^(bye|goodbye|see you|good ?night)\b/.test(q)) return { text: 'See you soon — I\'ll be watching the numbers. 📊', chips: [] };
  if (/who are you|your name|what are you/.test(q)) return answerHelp(ctx);
  if (/help|what can you do|abilities|what do you do/.test(q)) return answerHelp(ctx);
  const def = answerDefinition(q);
  if (def) return def;
  if (/what should i do|how (can|do) i (reduce|lower|bring down|improve|fix)|advice|suggest|recommend|tips|save money|saving tips/.test(q)) return answerAdvice(ctx);
  if (/\bwhy\b|reason|driver|driving|caus|behind this|so high/.test(q)) return answerWhy(ctx);
  if (/trend|improving|getting (better|worse)|better or worse|progress/.test(q)) return answerTrend(ctx);
  if (/runway|how long.*(last|survive|go)/.test(q)) return answerRunway(ctx);
  if (/\bemi\b|debt|loan/.test(q)) return answerEmi(ctx);
  if (/expense|spend|where.*money go|costs|kharcha/.test(q)) return answerExpenses(ctx);
  if (/income|earn|salary|revenue/.test(q)) return answerIncome(ctx);
  if (/balance|cash in hand|savings\b/.test(q)) return answerBalance(ctx);
  if (/goal/.test(q)) return answerGoals(ctx);
  if (/alert|warning|notification/.test(q)) return answerAlerts(ctx);
  if (/action|recovery/.test(q)) {
    const acts = (ctx.actions || []).filter((a) => a.status !== 'done');
    return {
      text: acts.length
        ? `You're tracking **${acts.length}** recovery action${acts.length === 1 ? '' : 's'}: ${acts.slice(0, 3).map((a) => a.label).join('; ')}. Update them in Alerts & Recovery as you go.`
        : `No recovery actions tracked yet — the Alerts & Recovery tab has presets like cutting variable spending or building a buffer.`,
      chips: ['How can I reduce my stress?', 'Why is my stress this level?'],
    };
  }
  if (/asset|sell|property|jewell|gold|credit window/.test(q)) return answerAssets(ctx);
  if (/simulator|simulate(?!.*what if)/.test(q)) {
    return {
      text: `The What-If Simulator tab runs full 12-month, 400-simulation scenarios. Or just ask me here — "what if my income drops 20%?" and I'll run it for you.`,
      chips: ['What if my income drops 20%?', 'What if I cut expenses by 15%?'],
    };
  }
  if (/project|forecast|future|next \d+ months|next few months|run out|go negative|will i/.test(q)) return answerProjection(ctx);
  if (/how am i|how('| i)s (my|the)|my (financial |)health|my score|stress|am i (ok|okay|fine|safe)|overview|summary|doing|condition|status/.test(q)) return answerStatus(ctx);
  return answerFallback(ctx);
}

// Starter chips shown when the chat widget first opens.
export const COACH_GREETING_CHIPS = ['How am I doing?', 'Why is my stress this level?', 'What if I lose my job?'];
