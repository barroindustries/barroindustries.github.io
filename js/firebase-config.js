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

// Global references
const auth = firebase.auth();
const db   = firebase.firestore();
const storage = firebase.storage();

// Sign out when app/tab is closed (session-only login)
auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
