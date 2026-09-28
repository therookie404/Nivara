import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { LogoLockup } from './Logo.jsx';
import { auth, firebaseConfigured } from '../firebase.js';

// Auth.jsx — Firebase authentication plumbing for the Nivara prototype
// (Firebase project 'nivara-15e0c'; Email/Password + Google providers must be
// enabled in the Firebase console).
// Provides: AuthCtx/useAuth, AuthProvider (user + login/signup/loginGoogle/logout),
// and AuthScreen, the branded sign-in/sign-up form. If firebase.js still has
// placeholder keys, AuthScreen renders a setup checklist instead of the form.

// Context + hook exposing { user, loading, login, signup, loginGoogle, logout }.
const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

// Wraps the app. Subscribes once to Firebase auth state on mount; flips loading off
// once the initial state resolves. If Firebase isn't configured yet, it just yields
// null user and skips the subscription (AuthScreen shows the setup checklist).
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!firebaseConfigured) { setLoading(false); return; }
    return onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false); });
  }, []);

  // Each auth helper resolves to the Firebase user (or a promise of it), letting
  // callers await the sign-in and handle friendlyError'd failures.
  const login = (email, pw) =>
    signInWithEmailAndPassword(auth, email, pw).then((r) => r.user);
  const signup = async (name, email, pw) => {
    const { user } = await createUserWithEmailAndPassword(auth, email, pw);
    // Stash the full name on the Firebase profile so the app can greet them.
    if (name) await updateProfile(user, { displayName: name });
    return user;
  };
  const loginGoogle = () =>
    signInWithPopup(auth, new GoogleAuthProvider()).then((r) => r.user);
  const logout = () => signOut(auth);

  return (
    <AuthCtx.Provider value={{ user, loading, login, signup, loginGoogle, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

// Maps Firebase auth error codes to plain-language messages (Firebase errors are
// developer jargon; the user sees these instead). Unknown codes get a generic fallback.
function friendlyError(code) {
  switch (code) {
    case 'auth/user-not-found':
    case 'auth/invalid-credential':
      return 'No account found with these details — check your email/password or create an account.';
    case 'auth/wrong-password':
      return 'Incorrect password. Try again.';
    case 'auth/email-already-in-use':
      return 'This email already has an account — try signing in instead.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/invalid-email':
      return 'That email address doesn\'t look valid.';
    case 'auth/popup-closed-by-user':
      return 'Google sign-in was cancelled.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

// Inline SVG icons for the form fields (kept local so the auth screen is dependency-free).
const I = {
  mail: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3.5 7l8.5 6 8.5-6" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.6" /><path d="M5 20c1.4-3.4 4-5 7-5s5.6 1.6 7 5" />
    </svg>
  ),
  eye: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" />
    </svg>
  ),
  eyeOff: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4l16 16" /><path d="M10.6 6c.5-.1.9-.1 1.4-.1 6 0 9.5 6.1 9.5 6.1a17 17 0 0 1-3 3.4M6.6 6.9C4.1 8.6 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.4 0 2.7-.3 3.8-.8" />
    </svg>
  ),
  google: (
    <svg viewBox="0 0 24 24">
      <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.3h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.6 2.8c2.3-2.1 3.8-5.2 3.8-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.1 1.2-3.1 0-5.8-2.1-6.8-5l-3.7 2.9C3.5 21.3 7.5 24 12 24z" />
      <path fill="#FBBC05" d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4L1.4 6.8C.5 8.5 0 10.2 0 12s.5 3.5 1.4 5.2l3.8-2.8z" />
      <path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.5 0 3.5 2.7 1.4 6.8l3.8 2.9c1-2.9 3.7-5 6.8-5z" />
    </svg>
  ),
};

// The branded sign-in / sign-up screen. mode toggles between the two; busy locks
// the form during async Firebase calls. Shows the name field and password-length
// hint only in signup mode, and "Forgot password?" only in signin mode.
export function AuthScreen() {
  const { login, signup, loginGoogle } = useAuth();
  const [mode, setMode] = useState('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  // Fallback when firebase.js still has placeholder keys: a 4-step wiring checklist.
  if (!firebaseConfigured) {
    return (
      <div className="wizard">
        <div className="card">
          <h3>🔑 One step left: connect your Firebase project</h3>
          <p className="sub" style={{ lineHeight: 1.8 }}>
            The login screen is built — it just needs your Firebase keys:<br /><br />
            1. Go to <b>console.firebase.google.com</b> → your project → <b>Project settings</b> → copy the <b>firebaseConfig</b> values.<br />
            2. Paste them into <b>frontend/src/firebase.js</b> (each placeholder is labeled).<br />
            3. In Firebase console → <b>Authentication → Sign-in method</b> → enable <b>Email/Password</b> (and <b>Google</b> if you want the Google button).<br />
            4. Restart the frontend with <code>npm run dev</code>.
          </p>
        </div>
      </div>
    );
  }

  // Email/password submit: signin or signup based on mode; Firebase errors become
  // friendly messages via friendlyError. busy stays true until the finally block.
  const submit = async (e) => {
    e.preventDefault();
    setError(''); setInfo(''); setBusy(true);
    try {
      if (mode === 'signin') await login(email, pw);
      else await signup(name, email, pw);
    } catch (err) {
      setError(friendlyError(err.code));
    } finally {
      setBusy(false);
    }
  };

  // Google popup sign-in; a user-closed popup maps to a friendly "cancelled" message.
  const google = async () => {
    setError(''); setInfo(''); setBusy(true);
    try { await loginGoogle(); }
    catch (err) { setError(friendlyError(err.code)); }
    finally { setBusy(false); }
  };

  // Password reset: requires the email field to be filled first, then Firebase sends
  // the reset link; success shows in the info banner.
  const forgot = async () => {
    setError(''); setInfo('');
    if (!email) { setError('Enter your email above first, then tap Forgot password.'); return; }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setInfo(`Password reset link sent to ${email}. Check your inbox.`);
    } catch (err) {
      setError(friendlyError(err.code));
    } finally {
      setBusy(false);
    }
  };

  const isSignin = mode === 'signin';

  return (
    <div className="auth-page">
      <div className="auth-blob b1" aria-hidden="true" />
      <div className="auth-blob b2" aria-hidden="true" />
      <div className="auth-blob b3" aria-hidden="true" />
      <div className="auth-blob b4" aria-hidden="true" />
      <div className="auth-wrap">
        {/* ---- Branding + heading ---- */}
        <div className="auth-logo"><LogoLockup width={128} /></div>
        <h1>{isSignin ? 'Welcome Back' : 'Create Your Account'}</h1>
        <p className="auth-sub">
          {isSignin
            ? 'Log in to continue managing your finances with clarity.'
            : 'Start your journey towards smarter financial decisions.'}
        </p>

        {/* ---- Email/password form ---- */}
        <form onSubmit={submit} className="auth-form">
          {!isSignin && (
            <label className="auth-field">
              <span>Full Name</span>
              <div className="auth-input">
                <span className="auth-ico">{I.user}</span>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your full name" autoComplete="name" />
              </div>
            </label>
          )}
          <label className="auth-field">
            <span>Email</span>
            <div className="auth-input">
              <span className="auth-ico">{I.mail}</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email" required autoComplete="email" />
            </div>
          </label>
          <label className="auth-field">
            <span>Password</span>
            <div className="auth-input">
              <span className="auth-ico">{I.lock}</span>
              <input type={showPw ? 'text' : 'password'} value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder={isSignin ? 'Enter your password' : 'Create a password'}
                required autoComplete={isSignin ? 'current-password' : 'new-password'} />
              <button type="button" className="auth-eye" onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                // tabIndex -1: the eye is decorative-only; keep tab order on the real fields.
                tabIndex={-1}>
                {showPw ? I.eyeOff : I.eye}
              </button>
            </div>
          </label>
          {!isSignin && <p className="auth-hint">At least 8 characters</p>}
          {isSignin && (
            <div className="auth-row">
              <button type="button" className="auth-link" onClick={forgot} disabled={busy}>
                Forgot password?
              </button>
            </div>
          )}

          {error && <div className="auth-error">{error}</div>}
          {info && <div className="auth-info">{info}</div>}

          <button className="auth-btn" disabled={busy}>
            {busy ? 'Please wait…' : (<>{isSignin ? 'Log In' : 'Sign Up'} <span aria-hidden="true">→</span></>)}
          </button>
        </form>

        {/* ---- Google sign-in ---- */}
        <div className="auth-or"><span>OR</span></div>

        <button className="auth-google" onClick={google} disabled={busy}>
          <span className="auth-g">{I.google}</span> Continue with Google
        </button>

        {/* ---- Sign-in / sign-up mode switch ---- */}
        <p className="auth-switch">
          {isSignin ? (
            <>Don&apos;t have an account? <button type="button" onClick={() => { setMode('signup'); setError(''); setInfo(''); }}>Sign Up</button></>
          ) : (
            <>Already have an account? <button type="button" onClick={() => { setMode('signin'); setError(''); setInfo(''); }}>Log In</button></>
          )}
        </p>
      </div>
    </div>
  );
}
