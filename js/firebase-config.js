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

// LOCAL persistence — session survives tab close/app restart for up to 10 days.
// Background push notifications stay active without re-login.
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(err => {
  // Safari Private Browsing and some in-app webviews reject LOCAL persistence —
  // fall back to SESSION rather than silently leaving persistence undefined.
  // Non-blocking either way: init must continue regardless of the outcome.
  console.warn('[Auth] setPersistence(LOCAL) failed, falling back to SESSION:', err);
  auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(err2 => {
    console.warn('[Auth] setPersistence(SESSION) fallback also failed:', err2);
  });
});

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
