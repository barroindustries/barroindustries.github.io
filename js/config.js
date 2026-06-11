/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — App Configuration
   config.js
═══════════════════════════════════════════════════ */

// ── Google Drive API Config ──────────────────────
// Get these from Google Cloud Console → APIs & Services → Credentials
// See SETUP_GUIDE.md → Google Drive Setup section
window.DRIVE_CONFIG = {
  CLIENT_ID:    'YOUR_GOOGLE_OAUTH_CLIENT_ID',  // e.g. "123456789-abc.apps.googleusercontent.com"
  API_KEY:      'YOUR_GOOGLE_API_KEY',
  FOLDER_ID:    'YOUR_SHARED_DRIVE_FOLDER_ID',  // The root shared Drive folder ID
  SCOPES:       'https://www.googleapis.com/auth/drive.file',
  DRIVE_ENABLED: false  // Set to true once you configure above
};

// ── EmailJS Config (for email notifications) ─────
// Sign up free at emailjs.com, create a service + template
window.EMAIL_CONFIG = {
  SERVICE_ID:   'YOUR_EMAILJS_SERVICE_ID',
  TEMPLATE_ID:  'YOUR_EMAILJS_TEMPLATE_ID',
  PUBLIC_KEY:   'YOUR_EMAILJS_PUBLIC_KEY',
  ENABLED:      false  // Set to true once configured
};

// ── FCM (Push Notifications) ─────────────────────
// Get VAPID key from Firebase Console → Project Settings → Cloud Messaging
window.FCM_CONFIG = {
  VAPID_KEY: 'YOUR_VAPID_KEY_HERE'
};

// ── Department Definitions ───────────────────────
window.DEPARTMENTS = {
  'Admin': {
    key:     'Admin',
    icon:    '🏢',
    color:   '#1a237e',
    subtabs: ['Policies', 'HR Documents', 'Authorization'],
    navOrder: 1
  },
  'Finance': {
    key:     'Finance',
    icon:    '💰',
    color:   '#1b5e20',
    subtabs: ['Overview', 'Accounting', 'Purchasing', 'SSS / Gov'],
    navOrder: 2
  },
  'Sales and Client Relations': {
    key:     'Sales and Client Relations',
    icon:    '🤝',
    color:   '#e65100',
    subtabs: ['Quote Builder', 'Client Profiles', 'Work Plans', 'Proposals'],
    navOrder: 3
  },
  'Marketing': {
    key:     'Marketing',
    icon:    '📢',
    color:   '#880e4f',
    subtabs: ['Advertising', 'Marketing Designs', 'Plan', 'Budgeting', 'Proposals'],
    navOrder: 4
  },
  'Government Biddings': {
    key:     'Government Biddings',
    icon:    '🏛️',
    color:   '#004d40',
    subtabs: ['PhilGEPS', 'Active Bids', 'Archive'],
    navOrder: 5
  },
  'Design': {
    key:     'Design',
    icon:    '🎨',
    color:   '#4a148c',
    subtabs: ['Projects', 'Clients', 'Product Designs', 'References'],
    navOrder: 6
  },
  'Brilliant Steel': {
    key:       'Brilliant Steel',
    icon:      '⚙️',
    color:     '#37474f',
    subtabs:   ['Quote Builder', 'Quote History', 'Client Records', 'Request Approval'],
    navOrder:  7,
    isSeparate: true  // Partner company
  }
};

// ── Role Definitions ─────────────────────────────
window.ROLES = {
  owner:    { label: 'Owner',        badge: 'badge-blue',   canSeeAll: true },
  manager:  { label: 'Manager',      badge: 'badge-purple', canSeeAll: false },
  employee: { label: 'Employee',     badge: 'badge-gray',   canSeeAll: false },
  agent:    { label: 'Sales Agent',  badge: 'badge-orange', canSeeAll: false },
  finance:  { label: 'Finance Staff',badge: 'badge-green',  canSeeAll: false }
};

// ── Bottom Nav Items ─────────────────────────────
window.BOTTOM_NAV_ITEMS = [
  { icon: '🏠', label: 'Home',       page: 'dashboard'    },
  { icon: '✅', label: 'Tasks',      page: 'tasks'        },
  { icon: '📋', label: 'Submits',    page: 'submissions'  },
  { icon: '💸', label: 'Cash',       page: 'cash'         },
  { icon: '🗂️', label: 'Dept',       page: 'my-dept'      }
];

window.OWNER_BOTTOM_NAV = [
  { icon: '🏠', label: 'Home',       page: 'dashboard'    },
  { icon: '✅', label: 'Tasks',      page: 'tasks'        },
  { icon: '📈', label: 'Analytics',  page: 'analytics'    },
  { icon: '✔️', label: 'Approvals',  page: 'approvals'    },
  { icon: '👥', label: 'Team',       page: 'team'         }
];
