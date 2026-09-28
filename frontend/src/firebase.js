// firebase.js — Firebase auth + Firestore setup for NIVARA.
// NIVARA is a hackathon fintech prototype: early financial-stress detection +
// recovery planning. This file initializes the Firebase app (project
// 'nivara-15e0c') and exports `auth` / `db` handles plus a `firebaseConfigured`
// flag. If the config is missing/placeholder, the app silently falls back to
// localStorage-only persistence — login then won't work, but nothing crashes.
//
// Setup checklist (one-time, in the Firebase console):
// 1. Go to console.firebase.google.com -> your project -> Project settings
//    -> "Your apps" -> copy the firebaseConfig values.
// 2. Paste them below, replacing the PASTE_* placeholders.
// 3. In the Firebase console -> Authentication -> Sign-in method,
//    enable "Email/Password" (and "Google" if you want the Google button).
// 4. For cross-device data saving: Firebase console -> Firestore Database ->
//    "Create database". Then in the Rules tab paste:
//
//      rules_version = '2';
//      service cloud.firestore {
//        match /databases/{database}/documents {
//          match /users/{uid} {
//            allow read, write: if request.auth != null && request.auth.uid == uid;
//          }
//        }
//      }
//
//    Until Firestore is enabled, data is saved in this browser only.
// 5. Restart the frontend (npm run dev).

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyDY0wnoTmb1J6xa4DYJneHyfrrbg879ALQ',
  authDomain: 'nivara-15e0c.firebaseapp.com',
  projectId: 'nivara-15e0c',
  appId: '1:18406589222:web:0efd28fb62ef53e24a37e7',
};

// True only when a real API key is pasted in — guards every Firebase call
// so the app degrades gracefully to local-only mode when unconfigured.
export const firebaseConfigured =
  firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('PASTE');

let _auth = null, _db = null;
if (firebaseConfigured) {
  const _app = initializeApp(firebaseConfig);
  _auth = getAuth(_app);
  _db = getFirestore(_app);
}
// Null when unconfigured; consumers must check `firebaseConfigured` first.
export const auth = _auth;
export const db = _db;
