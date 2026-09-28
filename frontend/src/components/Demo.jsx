import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { scenarioFromPersonaParams } from '../finance.js';
import Dashboard from './Dashboard.jsx';
import Simulator from './Simulator.jsx';
import { Logo } from './Logo.jsx';

// Status badge styles for the three curated stress cases.
const BADGE = {
  STABLE: { label: 'STABLE', cls: 'ok' },
  DRIFTING: { label: 'DRIFTING', cls: 'warn' },
  CRITICAL: { label: 'CRITICAL', cls: 'bad' },
};

/**
 * Public demo shell: pick one of the 3 curated stress cases, view the live
 * assessment dashboard and run the what-if simulator. No login, no persistence,
 * and the case's basic info is read-only.
 * The cases (Meera STABLE 0.000, Arjun DRIFTING 0.579, Rahul CRITICAL 1.000)
 * are curated in data/demo_personas.json.
 */
// Props: personaId — which of the 3 curated cases to load; onExit — callback back to the landing page.
export default function Demo({ personaId, onExit }) {
  const [persona, setPersona] = useState(null);
  const [input, setInput] = useState(null);
  const [assessment, setAssessment] = useState(null);
  const [tab, setTab] = useState('dashboard');
  const [error, setError] = useState('');

  // Loads the persona's months from the backend, reshapes them for the
  // scorer, and scores them live — the dashboard shows real model output.
  // The `alive` flag drops late responses if the persona changes or the demo unmounts.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await api.personas();
        const p = (d.personas || []).find((x) => x.id === personaId);
        if (!p) { if (alive) setError('Demo case not found.'); return; }
        // Accept either late-payment field name from the persona file.
        const months = p.months.map((m) => ({
          income: m.income, expenses: m.expenses, emi: m.emi,
          shock: m.shock || 0, late: m.late_payment ?? m.late ?? 0, balance: m.balance,
        }));
        const inp = {
          name: p.name,
          profileType: 'individual',
          starting_balance: p.params.starting_savings,
          months,
          scenarioBase: scenarioFromPersonaParams(p.params),
        };
        const a = await api.score(inp.starting_balance, inp.months);
        if (!alive) return;
        setPersona(p); setInput(inp); setAssessment(a);
      } catch (e) {
        if (alive) setError(`Couldn't reach the demo backend (${api.apiBase}). Start the backend, then relaunch the demo.`);
      }
    })();
    return () => { alive = false; };
  }, [personaId]);

  const badge = assessment ? BADGE[assessment.status] : null;

  return (
    <div className="demo">
      {/* ---- Demo top bar ---- */}
      <header className="demo-top">
        <div className="demo-brand">
          <Logo size={30} />
          <div>
            <b>NIVARA</b>
            <span className="demo-case">
              {persona ? `Demo · ${persona.name}'s case` : 'Demo'}
            </span>
          </div>
        </div>
        <div className="demo-top-right">
          <span className="pill readonly">🔒 read-only demo</span>
          {badge && <span className={`pill ${badge.cls}`}>{badge.label}</span>}
          <button className="btn ghost" onClick={onExit}>← Exit demo</button>
        </div>
      </header>

      {error && <div className="error" style={{ margin: 16 }}>{error}</div>}

      {!error && (!persona || !assessment) && (
        <div className="loading">Loading demo case…</div>
      )}

      {persona && input && assessment && (
        <>
          {/* ---- Story + tab navigation ---- */}
          <p className="demo-story">{persona.storyline} You can explore the dashboard and run simulations — the case's basic info can't be edited.</p>
          <nav className="demo-tabs">
            <button className={tab === 'dashboard' ? 'on' : ''} onClick={() => setTab('dashboard')}>📊 Dashboard</button>
            <button className={tab === 'simulator' ? 'on' : ''} onClick={() => setTab('simulator')}>🔮 What-If Simulator</button>
          </nav>
          {/* ---- Read-only dashboard tab ---- */}
          {tab === 'dashboard' && (
            <Dashboard
              name={input.name}
              profileType={input.profileType}
              scenarioBase={input.scenarioBase}
              startingBalance={input.starting_balance}
              assessment={assessment}
              months={input.months}
              beliefHistory={[assessment.belief]} // Single snapshot — no belief history accumulates in read-only mode.
              simRuns={[]}
              onAddMonth={() => {}} // Deliberate no-op: demo visitors may NOT add months.
              onGotoSimulator={() => setTab('simulator')}
              readOnly // Read-only shell: no profile editing, no persistence, no add-month.
            />
          )}
          {/* ---- Simulator tab: scenario testing is allowed, nothing is persisted ---- */}
          {tab === 'simulator' && <Simulator base={input.scenarioBase} />}
          {/* ---- Disclaimer footer ---- */}
          <p className="demo-foot">
            Demo data is synthetic and illustrative. Sign up to analyze your own finances.
          </p>
        </>
      )}
    </div>
  );
}
