/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — App Configuration v3
   config.js
═══════════════════════════════════════════════════ */

// ── App Version ──────────────────────────────────
// Auto-incremented by git pre-commit hook (.git/hooks/pre-commit)
window.APP_VERSION = '9.4.51';

// ── Business timezone helpers (Philippines, UTC+8) ──────────────────
// IMPORTANT: use these wherever a calendar "day" or local hour matters
// (attendance, payroll, deadlines, reminders). Plain new Date().toISOString()
// returns a UTC date, which lands on the WRONG day for the first 8 hours of every
// Manila day and silently corrupted attendance + pay. These anchor to Asia/Manila
// regardless of the device's own timezone — so the app is correct even when an
// admin opens it while travelling abroad.
window.BIZ_TZ = 'Asia/Manila';
window.bizDate = function(date) {
  // → "YYYY-MM-DD" in Manila time. Pass a Date to convert it, or omit for today.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: window.BIZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date || new Date());
};
window.bizHour = function(date) {
  // → 0–23, the current hour in Manila.
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: window.BIZ_TZ, hour: '2-digit', hour12: false
  }).format(date || new Date());
  return parseInt(h, 10) % 24;
};
window.bizDow = function(date) {
  // → 0–6 (0 = Sunday), the current day-of-week in Manila.
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: window.BIZ_TZ, weekday: 'short' })
    .format(date || new Date());
  return { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 }[wd];
};
window.bizYear = function() { return parseInt(window.bizDate().slice(0, 4), 10); };

// ── Google Drive API Config ──────────────────────
window.DRIVE_CONFIG = {
  CLIENT_ID:    'YOUR_GOOGLE_OAUTH_CLIENT_ID',
  API_KEY:      'YOUR_GOOGLE_API_KEY',
  FOLDER_ID:    '1cJjMhdHgzbk-f9b94dmBh3WnFXWvZLQM',  // Operations folder in Drive
  SCOPES:       'https://www.googleapis.com/auth/drive.file',
  DRIVE_ENABLED: false
};

// ── Google Sheets (Brilliant Steel Clients) ──────
window.SHEETS_CONFIG = {
  SPREADSHEET_ID: '1wnOdoC58ppYXBK3F1tJwzMrDKv8rjfhlDK2yirmKb5s',
  ENABLED: false
};

// ── EmailJS Config ───────────────────────────────
window.EMAIL_CONFIG = {
  SERVICE_ID:   'YOUR_EMAILJS_SERVICE_ID',
  TEMPLATE_ID:  'YOUR_EMAILJS_TEMPLATE_ID',
  PUBLIC_KEY:   'YOUR_EMAILJS_PUBLIC_KEY',
  ENABLED:      false
};

// ── FCM (Push Notifications) ─────────────────────
window.FCM_CONFIG = { VAPID_KEY: 'BOA1XyfiU9FmeTyy-4XqRD6-JOh_vNyqHwbwhiBkS2gTyUndms-SjmfDetMCg8IKs9-FgMrSRh0ECNydPUfWCkk' };

// ── Auto-Logout ───────────────────────────────────
// 10 days — keeps session alive so push notifications stay active in background
window.AUTO_LOGOUT_MS = 10 * 24 * 60 * 60 * 1000;

// ── Department Definitions ───────────────────────
window.DEPARTMENTS = {
  'Admin': {
    key: 'Admin', icon: '🏢', color: '#1a237e',
    subtabs: ['Policies', 'HR Documents', 'Authorization'], navOrder: 1
  },
  'Finance': {
    key: 'Finance', icon: '💰', color: '#1b5e20',
    subtabs: ['Overview', 'Accounting', 'Purchasing', 'SSS / Gov'], navOrder: 2
  },
  'Sales': {
    key: 'Sales', icon: '🤝', color: '#e65100',
    subtabs: ['BK Quotes', 'Quotations', 'Clients', 'Work Plans', 'Proposals'], navOrder: 3
  },
  'Marketing': {
    key: 'Marketing', icon: '📢', color: '#880e4f',
    subtabs: ['Advertising', 'Marketing Designs', 'Plan', 'Budgeting', 'Proposals'], navOrder: 4
  },
  'Government Biddings': {
    key: 'Government Biddings', icon: '🏛️', color: '#004d40',
    subtabs: ['PhilGEPS', 'Active Bids', 'Archive'], navOrder: 5
  },
  'IT': {
    key: 'IT', icon: '💻', color: '#0d47a1',
    subtabs: ['Overview', 'IT Tickets', 'Assets', 'Software', 'Access Control', 'Network', 'Tasks'], navOrder: 6
  },
  'Design': {
    key: 'Design', icon: '🎨', color: '#4a148c',
    subtabs: ['Projects', 'Clients', 'Product Designs', 'References'], navOrder: 6
  },
  'Production': {
    key: 'Production', icon: '🏭', color: '#5d4037',
    subtabs: ['Orders', 'Materials', 'Tasks', 'Files'], navOrder: 7
  },
  'Brilliant Steel': {
    key: 'Brilliant Steel', icon: '⚙️', color: '#37474f',
    subtabs: ['Dashboard', 'Quote Builder', 'Quotations Summary', 'Client Data'],
    navOrder: 7, isSeparate: true
  },
  'Partners': {
    key: 'Partners', icon: '🤝', color: '#0a84ff',
    subtabs: ['Overview', 'Tasks', 'Quotes', 'Activity'],
    navOrder: 8, isPartnerDept: true
  }
};

// ── Role Definitions ─────────────────────────────
window.ROLES = {
  president: { label: 'President',      badge: 'badge-blue',   canSeeAll: true  },
  manager:   { label: 'Manager',        badge: 'badge-purple', canSeeAll: false },
  employee:  { label: 'Employee',       badge: 'badge-gray',   canSeeAll: false },
  agent:     { label: 'Sales Agent',    badge: 'badge-orange', canSeeAll: false },
  finance:   { label: 'Finance Staff',  badge: 'badge-green',  canSeeAll: false }
};

// ── Bottom Nav — Employee ────────────────────────
window.BOTTOM_NAV_ITEMS = [
  { icon: 'home',         label: 'Home',    page: 'dashboard'        },
  { icon: 'check-square', label: 'Tasks',   page: 'tasks'            },
  { icon: 'megaphone',    label: 'Posts',   page: 'posts'            },
  { icon: 'banknote',     label: 'Cash',    page: 'cash-advances'    },
  { icon: 'credit-card',  label: 'Finance', page: 'personal-finance' }
];

// ── Bottom Nav — Admin / President ───────────────
window.PRESIDENT_BOTTOM_NAV = [
  { icon: 'home',         label: 'Home',    page: 'dashboard'      },
  { icon: 'check-square', label: 'Tasks',   page: 'tasks'          },
  { icon: 'megaphone',    label: 'Posts',   page: 'posts'          },
  { icon: 'users',        label: 'Team',    page: 'team-directory' },
  { icon: 'shield-check', label: 'Approve', page: 'approvals'      }
];

// ── Bottom Nav — External Partner ────────────────
window.PARTNER_BOTTOM_NAV = [
  { icon: 'home',         label: 'Home',    page: 'dashboard'        },
  { icon: 'check-square', label: 'Tasks',   page: 'tasks'            },
  { icon: 'calculator',   label: 'Quotes',  page: 'bs-quote-builder' },
  { icon: 'file-text',    label: 'Summary', page: 'bs-quotations'    }
];

// ── Bottom Nav — Partner (Brilliant Steel) ───────
window.BRILLIANT_BOTTOM_NAV = [
  { icon: 'home',       label: 'Home',    page: 'dashboard'        },
  { icon: 'calculator', label: 'Quotes',  page: 'bs-quote-builder' },
  { icon: 'file-text',  label: 'Summary', page: 'bs-quotations'    },
  { icon: 'book-open',  label: 'Clients', page: 'bs-clients'       }
];

// ── Users + payroll merge ─────────────────────────
// Pay fields (salary/allowance/deductions) live in a PROTECTED payroll/{uid}
// collection (readable only by the owner or finance/admin) — NOT on the
// world-readable users doc. This fetcher returns a users-snapshot-like object
// ({docs:[{id,data()}], size, empty}) with pay merged in, so the ~70 existing
// `u.salary` reads keep working unchanged. Non-admins get an empty payroll map
// (their unfiltered payroll query is denied → .catch), so they never see others'
// pay; a user's OWN pay is merged into userProfile separately at auth.
window.fetchUsersWithPayroll = async function() {
  const [uSnap, pSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('payroll').get().catch(() => ({ docs: [] }))
  ]);
  const pay = {};
  pSnap.docs.forEach(d => { pay[d.id] = d.data(); });
  const docs = uSnap.docs.map(d => {
    const merged = { ...d.data(), ...(pay[d.id] || {}) };
    return { id: d.id, data: () => merged };
  });
  return { docs, size: uSnap.size, empty: uSnap.empty };
};

// ── Firestore In-Memory Cache ─────────────────────
// Prevents re-fetching the same collection on every navigation.
// Usage: window.dbCachedGet('users', () => db.collection('users').get(), 30000)
;(function() {
  const _store = {};
  window.dbCachedGet = async function(key, fetcher, ttlMs = 30000) {
    // The 'users' key must always carry merged pay data — and consistently,
    // regardless of which call site populates the cache first — so force the
    // payroll-aware fetcher here instead of trusting each call site's lambda.
    if (key === 'users' && typeof window.fetchUsersWithPayroll === 'function') {
      fetcher = window.fetchUsersWithPayroll;
    }
    const entry = _store[key];
    if (entry && Date.now() - entry.ts < ttlMs) return entry.data;
    // Deduplicate concurrent requests for the same key
    if (entry && entry.pending) return entry.pending;
    const promise = fetcher().then(data => {
      _store[key] = { data, ts: Date.now(), pending: null };
      return data;
    }).catch(err => {
      delete _store[key];
      throw err;
    });
    _store[key] = { data: null, ts: 0, pending: promise };
    return promise;
  };
  window.dbCacheInvalidate = function(key) {
    if (key) delete _store[key];
    else Object.keys(_store).forEach(k => delete _store[k]);
  };
})();
