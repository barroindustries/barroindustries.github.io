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

// ── ClickUp Spaces ────────────────────────────────
window.CLICKUP_SPACES = {
  'Admin':                      '90167142742',
  'Design':                     '90167142722',
  'Marketing':                  '90167142730',
  'Finance':                    '90167150832'
};
window.CLICKUP_LISTS = {
  'Admin':     '901615221527',
  'Design':    '901615219620',
  'Marketing': '901615202622',
  'Finance':   '901615221520'
};

// ── ClickUp Member Map (email → ClickUp user ID) ─
window.CLICKUP_MEMBERS = {
  'tecagshaira1@gmail.com':      101081236,
  'cabilatazangenesis@gmail.com':101081235,
  'isobarro2023@gmail.com':      101081234,
  'brandonpaulchang12@gmail.com':101081086,
  'margojilopez@gmail.com':      101081085,
  'neilbarro870@gmail.com':      312718117
};

// ── ClickUp API Key ───────────────────────────────
// Set your ClickUp personal API token here
window.CLICKUP_API_KEY = 'YOUR_CLICKUP_API_KEY';

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
  'Sales and Client Relations': {
    key: 'Sales and Client Relations', icon: '🤝', color: '#e65100',
    subtabs: ['Quote Builder', 'Client Profiles', 'Work Plans', 'Proposals'], navOrder: 3
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

// ── Bottom Nav Items ─────────────────────────────
window.BOTTOM_NAV_ITEMS = [
  { icon: '🏠', label: 'Home',    page: 'dashboard'  },
  { icon: '✅', label: 'Tasks',   page: 'tasks'      },
  { icon: '📁', label: 'Files',   page: 'files'      },
  { icon: '💸', label: 'Cash',    page: 'cash'       },
  { icon: '🗂️', label: 'Dept',    page: 'my-dept'    }
];

window.PRESIDENT_BOTTOM_NAV = [
  { icon: '🏠', label: 'Home',      page: 'dashboard'  },
  { icon: '✅', label: 'Tasks',     page: 'tasks'      },
  { icon: '✔️', label: 'Approvals', page: 'approvals'  },
  { icon: '📈', label: 'Progress',  page: 'progress'   },
  { icon: '👥', label: 'Team',      page: 'team'       }
];

window.BRILLIANT_BOTTOM_NAV = [
  { icon: '🏠', label: 'Home',    page: 'dashboard'       },
  { icon: '💼', label: 'Quotes',  page: 'bs-quote-builder'},
  { icon: '📋', label: 'Summary', page: 'bs-quotations'   },
  { icon: '👤', label: 'Clients', page: 'bs-clients'      }
];
