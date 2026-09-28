import React, { useState, useEffect } from 'react';
import { Logo, LogoLockup } from './Logo.jsx';

// Landing.jsx — NIVARA's public marketing page, shown before login.
// Renders nav, hero (with a decorative dashboard mock), feature cards, a
// 3-step "How It Works", stats strip, the Live Demo section (3 read-only
// stress cases — Meera/Arjun/Rahul — launched via onTryDemo, no login or
// persistence), About, and footer. Login/Get Started route to auth;
// "Watch Demo" scrolls to the demo cases instead of a video.
/* ---------- static dashboard mock for the hero (decorative) ---------- */
// DashboardMock — pure-visual hero mock of the app dashboard (aria-hidden, never interactive).
// Gives visitors a feel of the product before they sign up; numbers are static.
function DashboardMock() {
  return (
    <div className="mock" aria-hidden="true">
      <div className="mock-side">
        <Logo size={22} text={false} />
        <div className="mock-nav on">⌂</div>
        <div className="mock-nav">◈</div>
        <div className="mock-nav">◔</div>
        <div className="mock-nav">▤</div>
      </div>
      <div className="mock-main">
        <div className="mock-topbar">
          <div className="mock-search" />
          <div className="mock-alert">⚠ Risk Alerts (3)</div>
        </div>
        <div className="mock-greet">
          <span>Good evening,</span>
          <b>Japnish!</b>
        </div>
        <div className="mock-kpis">
          <div className="mock-kpi"><span>Monthly Income</span><b>₹60,000</b><em className="up">+5%</em></div>
          <div className="mock-kpi"><span>Total Expenses</span><b>₹40,000</b><em className="up">+3%</em></div>
          <div className="mock-kpi"><span>Current Savings</span><b>₹2,00,000</b><em className="up">+8%</em></div>
        </div>
        <div className="mock-charts">
          <div className="mock-cash">
            <b>Cash Flow Projection</b>
            <svg viewBox="0 0 300 90" preserveAspectRatio="none">
              <polyline points="0,70 30,64 60,58 90,60 120,48 150,52 180,44 210,46 240,36 270,34 300,26" fill="none" stroke="#2563eb" strokeWidth="2.5" />
              <polyline points="0,78 30,76 60,74 90,72 120,70 150,72 180,74 210,76 240,78 270,80 300,82" fill="none" stroke="#f59e0b" strokeWidth="2" />
              <polyline points="0,84 30,86 60,88 90,88 120,89 150,89 180,89 210,89 240,89 270,89 300,89" fill="none" stroke="#ef4444" strokeWidth="2" />
            </svg>
          </div>
          <div className="mock-donut">
            <b>Stress Outlook</b>
            <svg viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="30" fill="none" stroke="#e8eefc" strokeWidth="10" />
              <circle cx="40" cy="40" r="30" fill="none" stroke="#22c55e" strokeWidth="10"
                strokeDasharray="188 188" strokeLinecap="round" transform="rotate(-90 40 40)" />
              <text x="40" y="38" textAnchor="middle" fontSize="15" fontWeight="800" fill="#0f2743">0</text>
              <text x="40" y="50" textAnchor="middle" fontSize="8" fill="#64748b">deficit months</text>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  { icon: '▰▰', title: 'What-If Simulations', text: 'Test life before it happens — cut spending, add side income, sell an asset — and watch 12 months of cash flow redraw instantly.' },
  { icon: '🛡', title: 'Risk Detection', text: 'An XGBoost model trained on 8,000 financial trajectories flags shortfalls ~2.3 months before they hit, with 98% recall.' },
  { icon: '◉', title: 'Actionable Insights', text: 'SHAP explains every score in plain words — which expenses, EMIs or shocks are pushing you toward the red, and by how much.' },
  { icon: '👥', title: 'Financial Stability', text: 'Recovery plans, belief-smoothed alerts and a trackable belief curve turn "you are at risk" into "here is the way out."' },
];

const STEPS = [
  { n: '1', title: 'Feed 3+ months', text: 'Enter monthly income, expenses, EMIs and any shocks. NIVARA builds your money trail and learns your baseline.' },
  { n: '2', title: 'See risk early', text: 'Get a shortfall-risk score for the next 12 months, with SHAP drivers and calm, hysteresis-smoothed alerts — no alarm fatigue.' },
  { n: '3', title: 'Simulate & recover', text: 'Run what-if scenarios, pick a recovery plan, and watch your projected stress month push further away as you act.' },
];

const STATS = [
  ['98%', 'shortfall recall'],
  ['~2.3 mo', 'average early warning'],
  ['0.97', 'ROC-AUC on held-out data'],
  ['8,000', 'synthetic user trajectories'],
];

// Landing — the public page. Props: onGetStarted / onLogin (route to auth),
// onTryDemo(caseId) (launch one of the 3 read-only demo personas). Also runs a
// one-time brand intro splash per browser session (sessionStorage flag), click to skip.
export function Landing({ onGetStarted, onLogin, onTryDemo }) {
  // Smooth-scrolls to an in-page anchor section (nav links, "Watch Demo").
  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

  // Brand intro: the logo's draw-in animation plays once per session when the
  // landing page first opens. Click to skip.
  const [intro, setIntro] = useState(() => {
    try { return !sessionStorage.getItem('nivara_intro_seen'); } catch { return true; }
  });
  const [introFade, setIntroFade] = useState(false);
  useEffect(() => {
    if (!intro) return;
    const t1 = setTimeout(() => setIntroFade(true), 2200);
    const t2 = setTimeout(() => {
      setIntro(false);
      try { sessionStorage.setItem('nivara_intro_seen', '1'); } catch { /* noop */ }
    }, 2750);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [intro]);
  const dismissIntro = () => {
    setIntro(false);
    try { sessionStorage.setItem('nivara_intro_seen', '1'); } catch { /* noop */ }
  };

  return (
    <div className="landing" id="top">
      {/* intro splash: plays once per session, two timers fade then unmount it */}
      {intro && (
        <div className={`intro-splash${introFade ? ' fade' : ''}`} onClick={dismissIntro} aria-hidden="true">
          <div style={{ width: 220, maxWidth: '60vw' }}>
            <LogoLockup width={220} />
          </div>
        </div>
      )}
      {/* nav */}
      <nav className="lnav">
        <Logo />
        <div className="lnav-links">
          <button className="on" onClick={() => scrollTo('top')}>Home</button>
          <button onClick={() => scrollTo('features')}>Features</button>
          <button onClick={() => scrollTo('how')}>How It Works</button>
          <button onClick={() => scrollTo('about')}>About</button>
        </div>
        <div className="lnav-cta">
          <button className="btn-ghost" onClick={onLogin}>Login</button>
          <button className="btn-primary" onClick={onGetStarted}>Get Started <span>→</span></button>
        </div>
      </nav>

      {/* hero */}
      <header className="lhero">
        <div className="lhero-copy">
          <div className="lpill"><span className="dot" /> AI-Powered Financial Planning</div>
          <h1>Plan Smarter.<br /><span>Reduce Financial Stress.</span></h1>
          <p>
            NIVARA helps you simulate scenarios, detect risks early and make
            data-driven financial decisions for a more secure tomorrow.
          </p>
          <div className="lhero-btns">
            <button className="btn-primary big" onClick={onGetStarted}>Get Started <span>→</span></button>
            <button className="btn-ghost big" onClick={() => scrollTo('demo')}><span className="play">▶</span> Watch Demo</button>
          </div>
          <div className="ltrust">
            <div className="lavas">
              <span style={{ background: '#dbeafe', color: '#1d4ed8' }}>MS</span>
              <span style={{ background: '#dcfce7', color: '#15803d' }}>SB</span>
              <span style={{ background: '#fef3c7', color: '#b45309' }}>JC</span>
              <span style={{ background: '#fce7f3', color: '#be185d' }}>KM</span>
            </div>
            <p>Built by Team <b>Honey Trap</b> —<br />see the financial storm before it hits.</p>
          </div>
        </div>
        <div className="lhero-mock">
          <div className="mock-glow" />
          <DashboardMock />
        </div>
      </header>

      {/* feature cards */}
      <section className="lfeatures" id="features">
        {FEATURES.map((f) => (
          <div className="lfeat" key={f.title}>
            <div className="lfeat-icon">{f.icon}</div>
            <div>
              <b>{f.title}</b>
              <p>{f.text}</p>
            </div>
          </div>
        ))}
      </section>

      {/* how it works */}
      <section className="lsection" id="how">
        <div className="lpill center"><span className="dot" /> How It Works</div>
        <h2>From chaos to clarity in <span>three steps</span></h2>
        <div className="lsteps">
          {STEPS.map((s) => (
            <div className="lstep" key={s.n}>
              <div className="lstep-n">{s.n}</div>
              <b>{s.title}</b>
              <p>{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* stats */}
      <section className="lstats">
        {STATS.map(([v, l]) => (
          <div key={l}><b>{v}</b><span>{l}</span></div>
        ))}
      </section>

      {/* demo: entry point to the public no-login demo. Each case button fires
          onTryDemo with its persona id ('demo_stable' = Meera, 'demo_drifting' =
          Arjun, 'demo_critical' = Rahul); the app opens that persona in a
          read-only shell (dashboard + what-if simulator, no edits saved).
          The alert cards beside it are illustrative, not live. */}
      <section className="lsection ldemo" id="demo">
        <div className="ldemo-copy">
          <div className="lpill"><span className="dot" /> Live Demo</div>
          <h2>Try a real case <span>right now</span> — no login needed</h2>
          <p>
            Pick one of three stress cases and explore it end to end: the live AI
            assessment with SHAP drivers, the 12-month projection — then open the
            what-if simulator and test recovery moves yourself. The cases are
            read-only; sign up to analyze your own money.
          </p>
          <div className="ldemo-cases">
            <button className="ldemo-case" onClick={() => onTryDemo && onTryDemo('demo_stable')}>
              <span className="pill ok">STABLE</span>
              <b>Meera · Pune</b>
              <span className="ldemo-case-type">🙋 Salaried · steady saver</span>
              <p>Disciplined spending, healthy buffer. The calm baseline.</p>
              <span className="ldemo-go">Launch →</span>
            </button>
            <button className="ldemo-case" onClick={() => onTryDemo && onTryDemo('demo_drifting')}>
              <span className="pill warn">DRIFTING</span>
              <b>Arjun · Mumbai</b>
              <span className="ldemo-case-type">💼 Freelancer · stretched thin</span>
              <p>Gig income wobbling while expenses creep up. Runway thinning.</p>
              <span className="ldemo-go">Launch →</span>
            </button>
            <button className="ldemo-case" onClick={() => onTryDemo && onTryDemo('demo_critical')}>
              <span className="pill bad">CRITICAL</span>
              <b>Rahul · Bengaluru</b>
              <span className="ldemo-case-type">🙋 Salaried · storm incoming</span>
              <p>Lifestyle creep + big EMI. 100% shortfall belief — can you save him?</p>
              <span className="ldemo-go">Launch →</span>
            </button>
          </div>
        </div>
        <div className="ldemo-card">
          <div className="lalert">
            <div className="lalert-head"><span>⚠</span><b>Status escalated: DRIFTING → CRITICAL</b></div>
            <p>Shortfall belief rose from <b>38%</b> to <b>72%</b> — EMIs now exceed 40% of income.</p>
            <div className="lalert-tags"><span>emi_ratio</span><span>late_payments</span><span>savings_rate</span></div>
          </div>
          <div className="lalert ok">
            <div className="lalert-head"><span>✓</span><b>Recovery working</b></div>
            <p>Side income +₹12,000/mo → belief fell to <b>41%</b>. Stress month cleared.</p>
          </div>
        </div>
      </section>

      {/* about */}
      <section className="lsection labout" id="about">
        <div className="lpill center"><span className="dot" /> About</div>
        <h2>Why <span>NIVARA</span> exists</h2>
        <p className="labout-p">
          Most budgeting apps tell you where your money <i>went</i>. NIVARA tells you where
          it is <i>going</i> — and whether that path ends in a shortfall. We combine an
          XGBoost early-warning model, SHAP explainability, belief smoothing that respects
          your attention, and a what-if simulator, so a borrower sees the financial storm
          <b> before </b>it hits and gets a concrete plan to steer around it.
        </p>
        <p className="ldisclaimer">
          Prototype built for a hackathon. Scores and simulations are computed from data you
          enter (plus synthetic training data) — educational, not financial advice.
        </p>
      </section>

      {/* footer */}
      <footer className="lfooter">
        <Logo size={26} />
        <p>See the financial storm before it hits.</p>
        <div className="lfooter-links">
          <button onClick={() => scrollTo('features')}>Features</button>
          <button onClick={() => scrollTo('how')}>How It Works</button>
          <button onClick={onGetStarted}>Get Started</button>
        </div>
        <small>© 2026 NIVARA · Team Honey Trap</small>
      </footer>
    </div>
  );
}
