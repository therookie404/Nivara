// store.js — per-account persistence for NIVARA.
// NIVARA is a hackathon fintech prototype: early financial-stress detection +
// recovery planning. One document per user: users/{uid} ->
// { input, actions, goals, thresholds, assets, simruns, updatedAt }.
// Firestore is the cloud source of truth (works across devices); localStorage
// is always written instantly as a fallback so the app also works offline or
// before Firestore is enabled in the console. Keys are namespaced per email
// so two accounts on one browser never collide.

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, firebaseConfigured } from './firebase.js';
import { DEFAULT_THRESHOLDS } from './finance.js';

const lsKey = (email, k) => `nivara-${k}-${email}`;
const KEYS = ['input', 'actions', 'goals', 'thresholds', 'assets', 'simruns'];

// Read this account's snapshot from localStorage (synchronous, instant).
function readLocal(email) {
  try {
    const j = (k, fb) => {
      const raw = localStorage.getItem(lsKey(email, k));
      return raw ? JSON.parse(raw) : fb;
    };
    return {
      input: j('input', null),
      actions: j('actions', []),
      goals: j('goals', []),
      thresholds: { ...DEFAULT_THRESHOLDS, ...j('thresholds', {}) },
      assets: j('assets', []),
      simruns: j('simruns', []),
    };
  } catch {
    return null;
  }
}

// Write the snapshot to localStorage right away; never throws (private mode
// or full storage just means the write is skipped silently).
function writeLocal(email, data) {
  try {
    KEYS.forEach((k) => localStorage.setItem(lsKey(email, k), JSON.stringify(data[k])));
  } catch { /* storage full / private mode */ }
}

// Fill in defaults for any missing keys so old/partial saves still load.
function normalize(d) {
  return {
    input: d.input || null,
    actions: d.actions || [],
    goals: d.goals || [],
    thresholds: { ...DEFAULT_THRESHOLDS, ...(d.thresholds || {}) },
    assets: d.assets || [],
    simruns: d.simruns || [],
  };
}

/** Load saved data: local instantly, Firestore wins when reachable.
 *  Returns the snapshot plus `fromCloud` so the UI knows where it came from,
 *  or null when this account has never saved anything. */
export async function loadUserData(user) {
  const local = readLocal(user.email);
  if (firebaseConfigured && db) {
    try {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if (snap.exists()) {
        const merged = normalize(snap.data());
        writeLocal(user.email, merged); // keep the offline copy in sync
        return { ...merged, fromCloud: true };
      }
    } catch {
      /* offline or Firestore not enabled yet -> fall through to local */
    }
  }
  return local ? { ...local, fromCloud: false } : null;
}

let saveTimer = null;
/** Save: localStorage instantly + debounced Firestore write (800ms) so rapid
 *  successive edits collapse into one cloud write. Offline failures are
 *  swallowed — the local copy stays the source of truth. */
export function saveUserData(user, data) {
  writeLocal(user.email, data);
  if (!(firebaseConfigured && db)) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        { ...data, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    } catch {
      /* offline -> the local copy remains the source of truth */
    }
  }, 800);
}

/** Wipe saved data (used by "Start over"). Clears both local and cloud. */
export function clearUserData(user) {
  try {
    KEYS.forEach((k) => localStorage.removeItem(lsKey(user.email, k)));
  } catch {}
  if (firebaseConfigured && db) {
    setDoc(
      doc(db, 'users', user.uid),
      { input: null, actions: [], goals: [], thresholds: DEFAULT_THRESHOLDS, assets: [], simruns: [], updatedAt: new Date().toISOString() },
      { merge: true }
    ).catch(() => {});
  }
}
