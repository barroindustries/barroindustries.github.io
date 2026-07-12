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
// `enableIndexedDbPersistence` was removed from the compat SDK in newer Firebase
// versions (confirmed gone in 10.12.2) — feature-detect so older/newer SDKs both
// degrade gracefully instead of throwing an uncaught TypeError at boot.
if (typeof db.enableIndexedDbPersistence === 'function') {
  db.enableIndexedDbPersistence({ synchronizeTabs: true }).catch(err => {
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
  console.warn('[Firestore] enableIndexedDbPersistence not available on this SDK version — skipping offline persistence.');
}
