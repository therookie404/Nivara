// api.js — thin client for the NIVARA FastAPI backend.
// NIVARA is a hackathon fintech prototype: early financial-stress detection +
// recovery planning. All heavy lifting (XGBoost scoring, Monte Carlo
// simulation) runs in Python; this file just POSTs/GETs JSON to it.
// The base URL comes from VITE_API_URL, defaulting to local dev (:8000).
import { foldTxns } from './finance.js';
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// POST helper: throws a readable Error (backend's `detail` when present)
// so the UI can show what actually went wrong.
async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let detail = r.statusText;
    try { detail = (await r.json()).detail || detail; } catch (e) { /* noop */ }
    throw new Error(detail);
  }
  return r.json();
}

// GET helper: throws on non-2xx so callers can fall back (offline mode).
async function get(path) {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
}

// The four backend calls NIVARA needs:
// - health: is the Python backend reachable? (drives the "backend down" banner)
// - personas: curated demo cases for the public no-login demo
// - score: the stress model. Needs >= 3 months of data to be meaningful —
//   fewer than that and the backend rejects the request. Passing the previous
//   belief/status lets the model apply hysteresis so the status doesn't
//   flicker between STABLE/DRIFTING/CRITICAL on borderline scores.
// - simulate: Monte Carlo what-if engine. `base` is the scenario dict,
//   `variants` are [{name, changes}] tweaks; months/n_sims size the run.
export const api = {
  health: () => get('/health'),
  personas: () => get('/personas'),
  score: (starting_balance, months, prev_belief = null, prev_status = 'STABLE') =>
    post('/score', { starting_balance, months: months.map(foldTxns), prev_belief, prev_status }),
  simulate: (base, variants, months = 12, n_sims = 400) =>
    post('/simulate', { base, variants, months, n_sims }),
  apiBase: BASE,
};
