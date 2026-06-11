/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — App Configuration v3
   config.js
═══════════════════════════════════════════════════ */

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
window.FCM_CONFIG = { VAPID_KEY: 'YOUR_VAPID_KEY_HERE' };

// ── Auto-Logout ───────────────────────────────────
window.AUTO_LOGOUT_MS = 60 * 60 * 1000; // 1 hour inactivity

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
    subtabs: ['BK Quotes', 'Quotations', 'BK Packages', 'Clients', 'Work Plans', 'Proposals'], navOrder: 3
  },
  'Marketing': {
    key: 'Marketing', icon: '📢', color: '#880e4f',
    subtabs: ['Advertising', 'Marketing Designs', 'Plan', 'Budgeting', 'Proposals'], navOrder: 4
  },
  'Government Biddings': {
    key: 'Government Biddings', icon: '🏛️', color: '#004d40',
    subtabs: ['PhilGEPS', 'Active Bids', 'Archive'], navOrder: 5
  },
  'Design': {
    key: 'Design', icon: '🎨', color: '#4a148c',
    subtabs: ['Projects', 'Clients', 'Product Designs', 'References'], navOrder: 6
  },
  'Brilliant Steel': {
    key: 'Brilliant Steel', icon: '⚙️', color: '#37474f',
    subtabs: ['Dashboard', 'Quote Builder', 'Quotations Summary', 'Client Data'],
    navOrder: 7, isSeparate: true
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
  { icon: 'home',         label: 'Home',       page: 'dashboard'        },
  { icon: 'check-square', label: 'Tasks',      page: 'tasks'            },
  { icon: 'megaphone',    label: 'Posts',      page: 'posts'            },
  { icon: 'banknote',     label: 'Cash',       page: 'cash-advances'    },
  { icon: 'credit-card',  label: 'Finance',    page: 'personal-finance' }
];

// ── Bottom Nav — Admin / President ───────────────
window.PRESIDENT_BOTTOM_NAV = [
  { icon: 'home',         label: 'Home',     page: 'dashboard'      },
  { icon: 'check-square', label: 'Tasks',    page: 'tasks'          },
  { icon: 'megaphone',    label: 'Posts',    page: 'posts'          },
  { icon: 'users',        label: 'Team',     page: 'team-directory' },
  { icon: 'shield-check', label: 'Approve',  page: 'approvals'      }
];

// ── Bottom Nav — Partner (Brilliant Steel) ───────
window.BRILLIANT_BOTTOM_NAV = [
  { icon: 'home',       label: 'Home',    page: 'dashboard'        },
  { icon: 'calculator', label: 'Quotes',  page: 'bs-quote-builder' },
  { icon: 'file-text',  label: 'Summary', page: 'bs-quotations'    },
  { icon: 'book-open',  label: 'Clients', page: 'bs-clients'       },
  { icon: 'folder',     label: 'Files',   page: 'bs-files'         }
];
