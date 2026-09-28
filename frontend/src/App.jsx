// App.jsx — the NIVARA app shell.
// NIVARA is a hackathon fintech prototype: early financial-stress detection +
// recovery planning. This file owns everything top-level: Firebase auth gating
// (landing page -> login -> onboarding wizard -> app), the tab navigation,
// all shared state (months, assessment, goals, assets, alerts...), the scoring
// orchestration (`analyze` calls the Python backend and folds results into
// state), per-account persistence, and the live context object that powers
// Nivara Coach (the chat assistant). Individual tabs are separate components.
import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { scenarioFromPersonaParams, scenarioFromProfile, synthesizeMonths, ACTION_PRESETS, newAction } from './finance.js';
import { withBalances, anchorMonths, moneyAlerts, DEFAULT_THRESHOLDS, monthTotals, monthNet } from './finance.js';
import { loadUserData, saveUserData } from './store.js';
import { AuthProvider, AuthScreen, useAuth } from './components/Auth.jsx';
import Wizard from './components/Wizard.jsx';
import { Landing } from './components/Landing.jsx';
import { Logo } from './components/Logo.jsx';
import Dashboard from './components/Dashboard.jsx';
import Simulator from './components/Simulator.jsx';
import HowItWorks from './components/HowItWorks.jsx';
import Alerts from './components/Alerts.jsx';
import Goals from './components/Goals.jsx';
import MoneyManager from './components/MoneyManager.jsx';
import Assets from './components/Assets.jsx';
import ProfilePage from './components/ProfilePage.jsx';
import ChatBot from './components/ChatBot.jsx';
import Demo from './components/Demo.jsx';

// Shell: the whole authenticated app. Owns every piece of shared state and
// renders the sidebar, topbar, tab pages and the Coach chat widget.
// Auth gating order: public demo > auth loading > logged-out (landing/auth)
// > logged-in wizard/app. `inApp` is true only once scoring has produced an
// assessment, so no tab ever renders without model data behind it.
function Shell() {
  const { user, loading: authLoading, logout } = useAuth();
  const [screen, setScreen] = useState('wizard');
  const [showLanding, setShowLanding] = useState(true); // pre-login marketing page
  const [demoId, setDemoId] = useState(null); // public no-login demo case
  const [tab, setTab] = useState('dashboard');
  const [backendOk, setBackendOk] = useState(null);
  const [input, setInput] = useState(null); // {name, profileType, starting_balance, months, scenarioBase}
  const [assessment, setAssessment] = useState(null);
  const [beliefHistory, setBeliefHistory] = useState([]);
  const [alertsFeed, setAlertsFeed] = useState([]);
  const [actions, setActions] = useState([]);
  const [goals, setGoals] = useState([]);
  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
  const [assets, setAssets] = useState([]);
  const [simRuns, setSimRuns] = useState([]); // recent simulator comparisons
  const [simSeed, setSimSeed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [alertsOpen, setAlertsOpen] = useState(false);

  const SEV_ICON = { high: '🔴', medium: '🟠', low: '🟡', positive: '🟢', info: '🔵' };
  // Human "x minutes ago" for alert timestamps; never throws on bad input.
  const relTime = (ts) => {
    try {
      const s = Math.max(1, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
      if (s < 60) return 'just now';
      const m = Math.floor(s / 60);
      if (m < 60) return `${m}m ago`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h ago`;
      return `${Math.floor(h / 24)}d ago`;
    } catch { return ''; }
  };

  // ---- Per-account persistence (Firestore cloud + localStorage fallback) ----
  const [restored, setRestored] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  // Fresh login (or account switch): reset session state, then restore.
  // Saved input is re-scored fresh so the assessment always reflects the
  // current model, not a stale snapshot from the last session.
  useEffect(() => {
    setRestored(false);
    setScreen('wizard');
    setAssessment(null); setInput(null); setBeliefHistory([]);
    setAlertsFeed([]); setSimSeed(null); setSimRuns([]);
    setActions([]); setGoals([]); setAssets([]);
    setThresholds(DEFAULT_THRESHOLDS); setSavedAt(null);
    if (!user) return;
    (async () => {
      const data = await loadUserData(user);
      if (data && data.input) {
        setInput({ ...data.input, credits: data.input.credits || [] });
        setActions(data.actions || []);
        setGoals(data.goals || []);
        setThresholds(data.thresholds || DEFAULT_THRESHOLDS);
        setAssets(data.assets || []);
        setSimRuns(data.simruns || []);
        setScreen('app');
        setTab('dashboard');
        await analyze(data.input);      // fresh scoring from the saved months
        setSavedAt(new Date());
      }
      setRestored(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user && user.uid]);

  // Save everything on every change (debounced cloud write inside).
  // Skipped until the restore above finishes, so we never overwrite the
  // cloud with an empty just-logged-in state.
  useEffect(() => {
    if (!user || !restored) return;
    if (!input && actions.length === 0 && goals.length === 0 && assets.length === 0 && simRuns.length === 0) return;
    saveUserData(user, { input, actions, goals, thresholds, assets, simruns: simRuns });
    setSavedAt(new Date());
  }, [input, actions, goals, thresholds, assets, simRuns, restored, user && user.uid]);

  // Recent-simulations log (dedupe: one entry per distinct comparison).
  // Keeps the last 12 runs so the dashboard can show "recent simulations".
  const logSimRun = useCallback((rows) => {
    const sig = rows.map((r) => r.name).join('|');
    setSimRuns((prev) => {
      if (prev.length && prev[0].sig === sig) return prev;
      const stamped = rows.map((r, i) => ({
        id: `sim-${Date.now()}-${i}`,
        sig,
        name: r.name, change: r.change, risk: r.risk, stress: r.stress,
        date: new Date().toISOString(),
      }));
      return [...stamped, ...prev].slice(0, 12);
    });
  }, []);

  useEffect(() => {
    api.health().then(() => setBackendOk(true)).catch(() => setBackendOk(false));
  }, []);

  // The single scoring funnel: every month add/edit/delete, profile change and
  // credit settlement flows through here. Sends months to the backend
  // (needs >= 3 months — fewer and the backend refuses to score), stores the
  // assessment, appends to the belief history, accumulates fresh alerts and
  // extends the belief trail of in-progress recovery actions so their verdicts
  // stay current. Passing the previous belief/status lets the model apply
  // hysteresis, so the STABLE/DRIFTING/CRITICAL status doesn't flicker on
  // borderline scores.
  const analyze = async (inp, prevBelief = null, prevStatus = 'STABLE') => {
    setLoading(true); setError('');
    try {
      const a = await api.score(inp.starting_balance, inp.months, prevBelief, prevStatus);
      setAssessment(a);
      setBeliefHistory((h) => [...h, a.belief]);
      // Challenge 2: accumulate fresh alerts (dedupe by id) and extend
      // the belief trail of every in-progress recovery action.
      if (a.alerts && a.alerts.length) {
        setAlertsFeed((prev) => {
          const ids = new Set(prev.map((x) => x.id));
          const fresh = a.alerts.filter((x) => !ids.has(x.id));
          return [...fresh, ...prev];
        });
      }
      const point = { ts: new Date().toISOString(), belief: a.belief };
      setActions((prev) => prev.map((ac) =>
        ac.status === 'in_progress' ? { ...ac, trail: [...(ac.trail || []), point] } : ac
      ));
    } catch (e) {
      setError(`Couldn't reach the analysis backend (${api.apiBase}): ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Onboarding wizard completion. Two paths:
  // - persona: a curated demo case -> months + scenario straight from it.
  // - profile: a real new user -> 6 estimated months, flagged `estimated`,
  //   anchored to END at the liquidity just entered (see anchorMonths), so
  //   day one shows the user's actual figure with ₹0 delta, not a fake past.
  const handleDone = async (done) => {
    let inp;
    if (done.type === 'persona') {
      const p = done.persona;
      const months = p.months.map((m) => ({
        income: m.income, expenses: m.expenses, emi: m.emi,
        shock: m.shock || 0, late: m.late_payment ?? m.late ?? 0, balance: m.balance,
      }));
      inp = {
        name: p.name,
        profileType: done.profileType || 'individual',
        starting_balance: p.params.starting_savings,
        months,
        scenarioBase: scenarioFromPersonaParams(p.params),
        credits: [],
      };
    } else {
      const rawMonths = synthesizeMonths(done.profile, 6);
      // Estimated past, flagged as such: the balance chain is anchored to END
      // at the liquidity the user just entered — the dashboard must show their
      // actual figure, not a fabricated history.
      const months = anchorMonths(done.savings,
        rawMonths.map((m) => ({ ...m, estimated: true })));
      inp = {
        name: done.profile.name,
        profileType: done.profile.profileType,
        starting_balance: done.savings,
        months,
        scenarioBase: scenarioFromProfile(done.profile, done.savings),
        credits: [],
      };
    }
    setInput(inp);
    setBeliefHistory([]);
    setScreen('app');
    setTab('dashboard');
    await analyze(inp);
  };

  // Add one real month: chain its balance off the previous month-end (or the
  // starting balance), keep only the last 12, then re-score with hysteresis.
  const addMonth = async (month) => {
    const prev = input.months[input.months.length - 1];
    const prevBal = prev && prev.balance != null ? prev.balance : input.starting_balance;
    const withBal = {
      ...month,
      balance: Math.round(prevBal + month.income - month.expenses - month.emi - (month.shock || 0)),
    };
    const months = [...input.months, withBal].slice(-12);
    const inp = { ...input, months };
    setInput(inp);
    await analyze(inp, assessment.belief, assessment.status);
  };

  // Manual income/expense edits: recompute running balances, then re-score.
  // Anchor-aware: estimated history stays anchored to the stated liquidity.
  const replaceMonths = async (rawMonths) => {
    const months = anchorMonths(input.starting_balance, rawMonths);
    const inp = { ...input, months };
    setInput(inp);
    await analyze(inp, assessment.belief, assessment.status);
  };

  // Profile editor: basic info, forward-looking income/EMI, starting balance.
  // Estimated history derives from the profile, so when every month is still
  // estimated it is REGENERATED from the edited profile (same seed => same
  // noise shape, new levels) and re-anchored — every dashboard feature reacts.
  // Once real months exist they are facts and stay untouched; edits then feed
  // projections + the simulator via scenarioBase.
  const updateProfile = async (p) => {
    const scenarioBase = {
      ...input.scenarioBase,
      base_income: p.income,
      emi: p.emi,
      fixed_exp: p.fixedExp,
      var_exp: p.varExp,
      starting_balance: p.startingBalance,
    };
    let months;
    if ((input.months || []).length && input.months.every((m) => m.estimated)) {
      const sp = {
        income: scenarioBase.base_income || 0,
        vol: scenarioBase.income_vol ?? 0.1,
        trend: scenarioBase.income_trend ?? 0,
        fixed: scenarioBase.fixed_exp || 0,
        variable: scenarioBase.var_exp || 0,
        drift: scenarioBase.expense_drift ?? 0,
        emi: scenarioBase.emi || 0,
      };
      months = anchorMonths(p.startingBalance,
        synthesizeMonths(sp, input.months.length, 11).map((m) => ({ ...m, estimated: true })));
    } else {
      months = anchorMonths(p.startingBalance, input.months);
    }
    const inp = {
      ...input,
      name: p.name,
      profileType: p.profileType,
      starting_balance: p.startingBalance,
      months,
      scenarioBase,
    };
    setInput(inp);
    await analyze(inp, assessment.belief, assessment.status);
  };

  // Seed values for the profile editor: prefer the forward-looking scenarioBase
  // figures, falling back to recorded-month averages when unset.
  const profileInitial = () => {
    const totals = (input.months || []).map(monthTotals);
    const avg = (arr) => arr.reduce((s, v) => s + v, 0) / Math.max(1, arr.length);
    return {
      name: input.name || '',
      profileType: input.profileType || 'individual',
      income: Math.round(input.scenarioBase?.base_income ?? avg(totals.map((t) => t.income))),
      emi: Math.round(input.scenarioBase?.emi ?? avg((input.months || []).map((m) => m.emi || 0))),
      fixedExp: Math.round(input.scenarioBase?.fixed_exp ?? 0),
      varExp: Math.round(input.scenarioBase?.var_exp ?? 0),
      startingBalance: Math.round(input.starting_balance || 0),
    };
  };

  // Challenge 2: recovery-action management.
  // Create a tracked action from a preset, seeded with today's belief as the
  // "before" reading for its verdict trail.
  const addAction = (presetId, customLabel) => {
    const act = newAction(presetId, customLabel, assessment ? assessment.belief : null);
    setActions((prev) => [act, ...prev]);
  };
  // Change an action's lifecycle status; (re)starting tracking anchors a fresh
  // trail point at the current belief so the verdict measures from "now".
  const setActionStatus = (id, status) => {
    setActions((prev) => prev.map((ac) => {
      if (ac.id !== id) return ac;
      const next = { ...ac, status };
      // (re)starting tracking anchors a fresh trail point at the current belief
      if ((status === 'in_progress') && assessment) {
        next.trail = [...(ac.trail || []), { ts: new Date().toISOString(), belief: assessment.belief }];
      }
      return next;
    }));
  };
  // "Test in simulator": jump to the simulator with this action's scenario
  // tweak pre-loaded, so the user sees its projected impact before committing.
  const testAction = (action) => {
    const preset = ACTION_PRESETS.find((p) => p.id === action.presetId);
    if (preset && typeof preset.changes === 'function') {
      setSimSeed({ id: action.id, label: action.label, changes: preset.changes });
      setTab('simulator');
    }
  };

  // Financial goals.
  // Prepend a new goal (newest first).
  const addGoal = (goal) => setGoals((prev) => [goal, ...prev]);
  // Add a contribution to a goal's saved amount.
  const contributeGoal = (id, amount) =>
    setGoals((prev) => prev.map((g) => g.id === id ? { ...g, saved: g.saved + amount } : g));
  // Remove a goal.
  const deleteGoal = (id) => setGoals((prev) => prev.filter((g) => g.id !== id));

  // Assets & credit window.
  // Prepend / remove an asset (newest first).
  const addAsset = (asset) => setAssets((prev) => [asset, ...prev]);
  const deleteAsset = (id) => setAssets((prev) => prev.filter((a) => a.id !== id));
  // Business credit ledger (receivables / payables). Add/edit/delete persist
  // immediately; settling moves the amount into/out of the starting balance,
  // re-anchors the whole chain and rescores — every dynamic variable reacts.
  // Add a new open credit (receivable or payable) to the ledger.
  const addCredit = (credit) =>
    setInput((inp) => (inp ? { ...inp, credits: [credit, ...(inp.credits || [])] } : inp));
  // Patch a credit's label/amount (only meaningful while unsettled).
  const updateCredit = (id, patch) =>
    setInput((inp) => (inp ? {
      ...inp,
      credits: (inp.credits || []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
    } : inp));
  // Remove a credit from the ledger entirely.
  const deleteCredit = (id) =>
    setInput((inp) => (inp ? {
      ...inp, credits: (inp.credits || []).filter((c) => c.id !== id),
    } : inp));
  // Settle a credit: "Received" adds a receivable to the starting balance,
  // "Paid" deducts a payable. Re-anchors every month and re-scores, so the
  // dashboard, projections, runway and risk all react at once.
  const settleCredit = async (id) => {
    const credit = (input.credits || []).find((c) => c.id === id);
    if (!credit || credit.settled || !(+credit.amount > 0)) return;
    const delta = credit.kind === 'payable' ? -credit.amount : credit.amount;
    const starting_balance = Math.round((input.starting_balance || 0) + delta);
    const credits = (input.credits || []).map((c) =>
      (c.id === id ? { ...c, settled: true, settledAt: new Date().toISOString() } : c));
    const scenarioBase = { ...input.scenarioBase, starting_balance };
    const months = anchorMonths(starting_balance, input.months);
    const inp = { ...input, starting_balance, months, credits, scenarioBase };
    setInput(inp);
    await analyze(inp, assessment.belief, assessment.status);
  };

  // "Simulate selling": jump to the simulator with starting_balance bumped by
  // the sale proceeds, so the user sees the impact of liquidating assets.
  const simulateSell = (amount) => {
    setSimSeed({
      id: `sell-${Date.now()}`,
      label: `Sell non-essential assets (+${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)})`,
      changes: (b) => ({ starting_balance: (b.starting_balance || 0) + amount }),
    });
    setTab('simulator');
  };

  // Log out and return to the marketing landing page.
  const doLogout = () => { logout(); setShowLanding(true); };

  // Public demo: works with or without login, straight from the landing page.
  // Renders the read-only demo shell for the chosen persona and nothing else.
  if (demoId) return <Demo personaId={demoId} onExit={() => setDemoId(null)} />;

  if (authLoading) return <div className="loading">Loading…</div>;
  if (!user) {
    if (showLanding) {
      return (
        <Landing
          onGetStarted={() => setShowLanding(false)}
          onLogin={() => setShowLanding(false)}
          onTryDemo={setDemoId}
        />
      );
    }
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 20px' }}>
        <button className="backhome" onClick={() => setShowLanding(true)}>← Back to home</button>
        <AuthScreen />
      </div>
    );
  }

  // inApp gates every tab: no assessment yet => no dashboard/simulator/etc.
  // Badges show live counts (spending alerts, risk alerts, goals, assets).
  const inApp = screen === 'app' && assessment;
  const moneyAlertCount = input ? moneyAlerts(input.months, thresholds).length : 0;
  const navItems = [
    ['dashboard', 'Dashboard', '🏠', null],
    ['simulator', 'What-If Simulator', '🔮', null],
    ['money', 'Income & Expenses', '💵', moneyAlertCount || null],
    ['alerts', 'Alerts & Recovery', '🔔', alertsFeed.length || null],
    ['goals', 'Goals', '🎯', goals.length || null],
    ['assets', 'Assets & Credit', '💰', assets.length || null],
    ['profile', 'Edit Profile', '✎', null],
    ['how', 'How it works', '❓', null],
  ];
  const userName = user.displayName || (user.email || '').split('@')[0] || 'friend';

  // Live context for Nivara Coach (the chat assistant): a snapshot of
  // everything the coach may quote — score, drivers, months, goals, alerts,
  // actions, assets. Rebuilt every render so answers always use fresh data.
  const coachCtx = assessment && input ? {
    userName,
    profileType: input.profileType,
    belief: assessment.belief,
    status: assessment.status,
    drivers: assessment.drivers,
    features: assessment.features,
    beliefHistory,
    months: input.months,
    scenarioBase: input.scenarioBase,
    currentBalance: (input.months.length && input.months[input.months.length - 1].balance != null)
      ? input.months[input.months.length - 1].balance
      : input.starting_balance,
    goals, alertsFeed, actions, assets,
  } : null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="side-logo">
          <Logo size={32} text={false} />
          <div>
            <h1>NIVARA</h1>
            <p>see the financial storm before it hits</p>
          </div>
        </div>
        {inApp && (
          <nav className="side-nav">
            {navItems.map(([id, label, icon, badge]) => (
              <button key={id} className={`side-item ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
                <span className="side-icon">{icon}</span>
                <span className="side-label">{label}</span>
                {badge ? <span className="side-badge">{badge}</span> : null}
              </button>
            ))}
          </nav>
        )}
        <div className="side-promo">
          <div className="side-promo-title">Plan Smarter.<br />Reduce Financial Stress.</div>
          <p>AI-powered projections for a more secure tomorrow.</p>
          {inApp && (
            <button className="btn" style={{ width: '100%', marginTop: 6 }} onClick={() => setTab('simulator')}>
              🔮 Try the simulator
            </button>
          )}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="top-actions">
            {inApp && (
              <div className="alerts-wrap">
                <button className={`alerts-pill ${alertsFeed.length ? 'has' : ''}`} onClick={() => setAlertsOpen((o) => !o)}>
                  🔔 Risk Alerts{alertsFeed.length ? ` (${alertsFeed.length})` : ''} {alertsOpen ? '▴' : '▾'}
                </button>
                {alertsOpen && (
                  <>
                    <div className="search-backdrop" onClick={() => setAlertsOpen(false)} />
                    <div className="alerts-dropdown">
                      <div className="alerts-dd-head">
                        <b>Risk Alerts</b>
                        <button className="linklike" onClick={() => { setAlertsOpen(false); setTab('alerts'); }}>View All</button>
                      </div>
                      {alertsFeed.length === 0 && <div className="search-empty">All quiet — no alerts yet.</div>}
                      {alertsFeed.slice(0, 4).map((a) => (
                        <button key={a.id} className="alerts-dd-item"
                          onClick={() => { setAlertsOpen(false); goTo('alerts', `alert-${a.id}`); }}>
                          <span className="alerts-dd-icon">{SEV_ICON[a.severity] || '🔔'}</span>
                          <span className="alerts-dd-body">
                            <b>{a.title}</b>
                            <span>{(a.message || '').slice(0, 90)}</span>
                          </span>
                          <span className="alerts-dd-time">{relTime(a.ts)}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            {savedAt && inApp && (
              <span className="pill" title={`All your data is saved to your account (last save ${savedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })})`}>
                ✓ Saved
              </span>
            )}
            <button className="user-chip clickable" title={`${user.email} — edit profile`} onClick={() => setTab('profile')}>
              <span className="avatar">{(userName[0] || '?').toUpperCase()}</span>
              <span className="user-meta"><b>{userName}</b><span>{user.email}</span></span>
              <span className="edit-hint">✎</span>
            </button>
            <button className="btn ghost" style={{ padding: '8px 14px', fontSize: 13 }} onClick={doLogout}>
              Logout
            </button>
          </div>
        </header>

        {inApp && (
          <nav className="mobile-nav">
            {navItems.map(([id, label, icon, badge]) => (
              <button key={id} className={`mnav-item ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
                {icon} {label}{badge ? ` (${badge})` : ''}
              </button>
            ))}
          </nav>
        )}

        <div className="page">
      {/* ---- Tab pages: only the active tab mounts, so each page loads fresh ---- */}
      {inApp && tab === 'profile' && (
        <ProfilePage
          initial={profileInitial()}
          credits={input.credits || []}
          currentBalance={
            (input.months.length && input.months[input.months.length - 1].balance != null)
              ? input.months[input.months.length - 1].balance
              : input.starting_balance
          }
          onAddCredit={addCredit}
          onUpdateCredit={updateCredit}
          onDeleteCredit={deleteCredit}
          onSettleCredit={settleCredit}
          onSave={updateProfile}
        />
      )}
      {backendOk === false && inApp && (
        <div className="error">
          Backend not reachable at {api.apiBase}. Start it with:
          <code> cd api && uvicorn app:app --host 0.0.0.0 --port 8000</code>
        </div>
      )}

      {screen === 'wizard' && <Wizard onDone={handleDone} />}

      {screen === 'app' && loading && !assessment && <div className="loading">Analyzing…</div>}
      {screen === 'app' && error && <div className="error">{error}</div>}

      {inApp && tab === 'dashboard' && (
        <Dashboard
          name={input.name}
          profileType={input.profileType}
          scenarioBase={input.scenarioBase}
          startingBalance={input.starting_balance}
          assessment={assessment}
          months={input.months}
          beliefHistory={beliefHistory}
          simRuns={simRuns}
          onAddMonth={addMonth}
          onGotoSimulator={() => setTab('simulator')}
        />
      )}
      {inApp && tab === 'alerts' && (
        <Alerts
          alerts={alertsFeed}
          actions={actions}
          onAddAction={addAction}
          onSetActionStatus={setActionStatus}
          onTestAction={testAction}
          currentBelief={assessment.belief}
        />
      )}
      {inApp && tab === 'money' && (
        <MoneyManager
          months={input.months}
          thresholds={thresholds}
          onThresholds={setThresholds}
          onReplaceMonths={replaceMonths}
        />
      )}
      {inApp && tab === 'goals' && (
        <Goals
          goals={goals}
          features={assessment.features}
          onAddGoal={addGoal}
          onContribute={contributeGoal}
          onDeleteGoal={deleteGoal}
        />
      )}
      {inApp && tab === 'assets' && (
        <Assets
          assets={assets}
          onAddAsset={addAsset}
          onDeleteAsset={deleteAsset}
          assessment={assessment}
          months={input.months}
          onSimulateSell={simulateSell}
        />
      )}
      {inApp && tab === 'simulator' && (
        <Simulator base={input.scenarioBase} seedAction={simSeed} onSeedConsumed={() => setSimSeed(null)} onRun={logSimRun} />
      )}
      {inApp && tab === 'how' && <HowItWorks />}
        </div>
      </div>
      {inApp && coachCtx && <ChatBot ctx={coachCtx} />}
    </div>
  );
}

// App: wraps the Shell in the Firebase AuthProvider so useAuth() works
// everywhere below. This is the component main.jsx actually mounts.
export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
