// ═══════════════════════════════════════════════════════
//  BARRO INDUSTRIES — Firebase Configuration
//  ⚠️  REPLACE these values with your Firebase project config
//  Instructions: See PUBLISHING_GUIDE.md → Step 2
// ═══════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey:            "AIzaSyA1-fDeMCxTsUm29O49l954Ez5BqbyHijk",
  authDomain:        "barro-industries.firebaseapp.com",
  projectId:         "barro-industries",
  storageBucket:     "barro-industries.firebasestorage.app",
  messagingSenderId: "700081895848",
  appId:             "1:700081895848:web:265511313b4ff74575459d"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Expose config for secondary app (HR worker account creation)
window.firebaseConfig = firebaseConfig;

// Global references
const auth = firebase.auth();
const db   = firebase.firestore();
const storage = firebase.storage();

// v14 P1 reliability fix — the SDK default upload retry window is ~10 minutes,
// which on a flaky Wi-Fi/cellular connection left the attendance selfie
// upload silently retrying with no feedback: the kiosk just sat on
// "Uploading selfie…" for minutes with no way to tell whether it was working
// or stuck. Cut to 45s so a genuinely dead connection fails fast enough for
// the Cancel control / offline-queue fallback (js/screens/worker.js
// _uploadSelfieAndGetUrl, _handleClock) to kick in and give the worker a
// clear next step, while still tolerating an ordinary slow-but-working
// upload. Feature-detected — older SDKs without this method just skip it.
if (typeof storage.setMaxUploadRetryTime === 'function') {
  storage.setMaxUploadRetryTime(45000);
}

// ── Auth session persistence ──────────────────────────────────────────────
// LOCAL persistence is IndexedDB-backed (`firebaseLocalStorageDb`) and survives
// tab close / PWA restart for up to AUTO_LOGOUT_MS (10 days), which is what
// keeps background push alive without a re-login. SESSION persistence is
// sessionStorage-backed and is DESTROYED the moment an iOS home-screen PWA is
// closed. Measured on the live compat SDK (10.12.2):
//   LOCAL   persistence object -> { …, db }              (IndexedDB, durable)
//   SESSION persistence object -> { storageRetriever }   (sessionStorage, dies)
// So a downgrade to SESSION reads to the user as "it logged me out again", every
// single time. It is never cosmetic and must never be silent.
//
// 2026-08-09 rewrite. This block used to fall back to SESSION on the FIRST
// rejection with nothing but a console.warn — invisible on a phone, and a
// one-way ratchet, because setPersistence MIGRATES any session that already
// exists. Three properties are now guaranteed:
//   1. RECOVER, DON'T RATCHET. A transient IndexedDB open failure at boot (iOS
//      reclaiming storage, a slow service-worker-controlled load) is the common
//      case and is retryable, so a single rejection no longer condemns the
//      session. Only a persistent failure falls back.
//   2. NEVER SILENTLY DOWNGRADE. The real outcome is published on
//      window.__authPersistence and announced via an 'auth-persistence-change'
//      event, so the login screen can TELL the user their session will not
//      survive closing the app instead of letting them discover it by being
//      logged out.
//   3. BE DIAGNOSABLE. requested/effective/error/attempts are readable on the
//      device itself (and rendered onto the login version line), and a genuine
//      downgrade is reported through logClientError, so the next bug report
//      carries the actual persistence in effect and the actual error code.
//
// Non-blocking throughout: this file runs before everything else, so every path
// stays inside a .catch()/try and nothing here may throw.
window.__authPersistence = {
  requested: 'LOCAL',   // what we asked for
  effective: 'pending', // 'LOCAL' | 'SESSION' | 'NONE' | 'pending' | 'unknown'
  error: null,          // error code/message when degraded, else null
  attempts: 0,
  userChoiceApplied: false, // set by the login handler; stops the boot retry loop
  at: Date.now()
};

(function initAuthPersistence() {
  var P = firebase.auth.Auth.Persistence;
  var BACKOFF_MS = [0, 400, 1500];   // attempt 0 immediate, then two retries
  var MAX_ATTEMPTS = BACKOFF_MS.length;

  function publish(effective, err, attempts) {
    try {
      var st = window.__authPersistence;
      st.effective = effective;
      st.error     = err ? (err.code || err.message || String(err)) : null;
      st.attempts  = attempts;
      st.at        = Date.now();
      // Anything already on screen (the login screen) repaints off this.
      window.dispatchEvent(new CustomEvent('auth-persistence-change', {
        detail: { effective: st.effective, error: st.error, requested: st.requested }
      }));
    } catch (e) { /* a diagnostic must never break boot */ }
  }

  // Honour a DELIBERATE kiosk opt-out across reloads. 'bi-remember-choice' is
  // written only by the login handler when the user unticks "Keep me signed in";
  // absent (every existing device) means LOCAL, so the default self-heals.
  var wantLocal = true;
  try { wantLocal = localStorage.getItem('bi-remember-choice') !== '0'; } catch (e) { /* storage blocked */ }
  window.__authPersistence.requested = wantLocal ? 'LOCAL' : 'SESSION';

  if (!wantLocal) {
    try {
      auth.setPersistence(P.SESSION).then(function () {
        publish('SESSION', null, 1);
      }, function (err) {
        publish('unknown', err, 1);
      });
    } catch (e) { publish('unknown', e, 1); }
    return;
  }

  function attempt(n) {
    // The user's explicit login-screen choice outranks this boot default — bail
    // out so a late retry can never migrate a deliberately session-only login
    // back up to LOCAL.
    if (window.__authPersistence.userChoiceApplied) return;

    // setPersistence is expected to REJECT rather than throw, but this file runs
    // before everything else and a synchronous throw here would brick boot, so
    // the sync call site is wrapped too. (attempt() is otherwise only re-entered
    // from a setTimeout, where a throw could not reach boot anyway.)
    try {
      auth.setPersistence(P.LOCAL).then(function () {
        publish('LOCAL', null, n + 1);
      }, function (err) {
        if (n + 1 < MAX_ATTEMPTS) {
          setTimeout(function () { attempt(n + 1); }, BACKOFF_MS[n + 1]);
          return;
        }
        // Persistently unavailable — Safari Private Browsing, some in-app
        // webviews. Fall back so auth still works for this session, but SAY SO.
        console.warn('[Auth] setPersistence(LOCAL) failed after ' + MAX_ATTEMPTS + ' attempts, falling back to SESSION:', err);
        try {
          if (window.logClientError) {
            window.logClientError(err, 'auth persistence downgraded to SESSION');
          }
        } catch (e) { /* never throw */ }
        auth.setPersistence(P.SESSION).then(function () {
          publish('SESSION', err, n + 1);
        }, function (err2) {
          console.warn('[Auth] setPersistence(SESSION) fallback also failed:', err2);
          publish('NONE', err2, n + 1);
        });
      });
    } catch (e) {
      console.warn('[Auth] setPersistence threw synchronously:', e);
      publish('unknown', e, n + 1);
    }
  }

  attempt(0);
})();

// Firestore offline persistence — caches all reads to IndexedDB so the app
// loads instantly from disk on the next visit while fresh data syncs in background.
// Multi-tab: falls back gracefully if another tab already owns the lock.
// THE IDENTIFIER MATTERS: on the COMPAT SDK this app loads (see index.html —
// firebase-firestore-compat.js, 10.12.2) the instance method is
// `enablePersistence`. `enableIndexedDbPersistence` is the MODULAR API's name
// and does not exist on firebase.firestore(); the old comment here asserted it
// "was removed from the compat SDK, confirmed gone in 10.12.2", and that wrong
// claim is what produced the bug — the feature-detect below was permanently
// false, the else branch ran on every load, and persistence was NEVER enabled
// once. Measured on the live instance at 10.12.2:
//   typeof db.enableIndexedDbPersistence -> "undefined"
//   typeof db.enablePersistence          -> "function"
// So every cold boot and every reload paid full network latency for all of the
// dashboard's queries, and dbCachedGet's in-memory TTLs never survived a
// refresh. The feature-detect is KEPT so a future SDK swap degrades instead of
// throwing at boot — it just has to test the name that actually exists.
//
// FRESHNESS IS UNAFFECTED WHEN ONLINE, which is why this is safe on a system
// where the President reads money: with the compat SDK a plain .get() uses
// source:'default', which round-trips the server whenever the client is online.
// Persistence changes warm-start and OFFLINE behaviour only. The one place that
// genuinely depends on an offline read THROWING is the attendance punch path —
// see the `source:'server'` pins in js/screens/worker.js _resolveActiveRecord,
// which must stay in lockstep with this being enabled.
if (typeof db.enablePersistence === 'function') {
  db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    if (err.code === 'failed-precondition') {
      // Multiple tabs open — persistence available in one tab only
      console.warn('[Firestore] Offline persistence unavailable: multiple tabs open.');
    } else if (err.code === 'unimplemented') {
      // Browser doesn't support IndexedDB
      console.warn('[Firestore] Offline persistence not supported in this browser.');
    } else {
      // Any other failure (e.g. private-browsing IndexedDB quirks) — don't fail silently.
      console.warn('[Firestore] Offline persistence failed to enable:', err.code || err);
    }
  });
} else {
  console.warn('[Firestore] enablePersistence not available on this SDK version — skipping offline persistence.');
}
