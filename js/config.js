/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — App Configuration v3
   config.js
═══════════════════════════════════════════════════ */

// ── App Version ──────────────────────────────────
// Auto-incremented by git pre-commit hook (.git/hooks/pre-commit)
window.APP_VERSION = '12.0.19';

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

// ── Consolidated attendance-record readers (WS25) ────────────────
// Single source of truth for reading an attendance/{uid}/records/{date} doc.
// Defined here (config.js) so they load before every caller (departments.js,
// app.js, modules.js) per the fixed script-load-order rule.
// score: paid leave is stored as 1.0 so no special-case needed here.
window.attRecScore = function(rec){
  if (!rec) return 0;
  if (typeof rec.attendanceScore === 'number') return rec.attendanceScore;
  if (rec.fullTime) return 1.0;
  if (rec.loginTime) return 0.5;
  return 0;
};
// kind: status wins, then score. Drives badge/colour in the six UIs.
window.attRecKind = function(rec){
  if (!rec) return 'none';
  if (rec.status === 'leave')        return 'leave';
  if (rec.status === 'unpaid_leave') return 'unpaid-leave';
  if (rec.status === 'absent')       return 'absent';
  const sc = window.attRecScore(rec);
  if (sc >= 1) return 'present';
  if (sc > 0 || rec.loginTime) return 'half';
  return 'none';
};
// central badge glyph/colour so all readers agree
window.attKindBadge = function(kind){
  return ({ present:{m:'✓',c:'#30d158'}, half:{m:'½',c:'#ffa040'},
            absent:{m:'✗',c:'#ff6b6b'}, leave:{m:'🌴',c:'#30d158'},
            'unpaid-leave':{m:'📅',c:'#8e8e93'}, none:{m:'',c:'#8e8e93'} })[kind] || {m:'',c:'#8e8e93'};
};

// ── Attendance extension window (single source of truth) (WS26) ────
window.ATT_EXT_HOURS = 6;   // approved extension duration, in hours
// Is an approved extension still active? Returns {active, expiresAt:Date|null}.
window.attExtActive = function(extData, now) {
  now = now || new Date();
  const expiresAt = (extData && extData.expiresAt && extData.expiresAt.toDate)
                      ? extData.expiresAt.toDate() : null;
  const active = !!(extData && extData.status === 'approved' && expiresAt && now < expiresAt);
  return { active, expiresAt };
};
// Elapsed worked hours between two Date objects, minus a flat 1-hr lunch if the
// span crosses local noon. Best-effort (informational field) — Manila-anchored.
window.computeHoursBetween = function(inDate, outDate) {
  if (!inDate || !outDate) return 0;
  let mins = (outDate.getTime() - inDate.getTime()) / 60000;
  if (mins <= 0) return 0;
  const inH = window.bizHour(inDate), outH = window.bizHour(outDate);
  if (inH < 13 && outH >= 12) mins -= 60;   // crossed the 12–1PM lunch window
  return Math.max(0, mins / 60);
};

// ── Holiday admin overrides (sync in-memory cache, filled at boot) ─
window._holidayOverrides = window._holidayOverrides || {};   // { [year]: overridesMap }

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
    key: 'Admin', icon: '🏢', lucideIcon: 'building-2', color: '#1a237e',
    subtabs: ['Policies', 'HR Documents', 'Authorization'], navOrder: 1
  },
  'Finance': {
    key: 'Finance', icon: '💰', lucideIcon: 'wallet', color: '#1b5e20',
    subtabs: ['Overview', 'Accounting', 'Purchases', 'SSS / Gov'], navOrder: 2
  },
  'HR': {
    key: 'HR', icon: '👥', lucideIcon: 'users', color: '#ad1457',
    subtabs: ['People & Roles', 'Payroll', 'Worker Payslips', 'Leave', 'Attendance'], navOrder: 2
  },
  'Sales': {
    key: 'Sales', icon: '🤝', lucideIcon: 'handshake', color: '#e65100',
    subtabs: ['BK Quotes', 'Quotations', 'Clients', 'Work Plans', 'Proposals', 'SOP'], navOrder: 3
  },
  'Marketing': {
    key: 'Marketing', icon: '📢', lucideIcon: 'megaphone', color: '#880e4f',
    subtabs: ['Advertising', 'Marketing Designs', 'Plan', 'Budgeting', 'Proposals'], navOrder: 4
  },
  'Government Biddings': {
    key: 'Government Biddings', icon: '🏛️', lucideIcon: 'landmark', color: '#004d40',
    subtabs: ['PhilGEPS', 'Active Bids', 'Archive'], navOrder: 5
  },
  'IT': {
    key: 'IT', icon: '💻', lucideIcon: 'laptop', color: '#0d47a1',
    subtabs: ['Overview', 'IT Tickets', 'Assets', 'Software', 'Access Control', 'Network', 'Tasks'], navOrder: 6
  },
  'Design': {
    key: 'Design', icon: '🎨', lucideIcon: 'palette', color: '#4a148c',
    subtabs: ['Projects', 'Drawings', 'Clients', 'Product Designs', 'References', 'Tasks'], navOrder: 6
  },
  'Production': {
    key: 'Production', icon: '🏭', lucideIcon: 'factory', color: '#5d4037',
    subtabs: ['Orders', 'Materials', 'Tasks', 'Files'], navOrder: 7
  },
  'Purchasing': {
    key: 'Purchasing', icon: '🛒', lucideIcon: 'shopping-cart', color: '#00695c',
    subtabs: ['Request for Quotation', 'Purchase Requests', 'Tasks'], navOrder: 8
  },
  'Brilliant Steel': {
    key: 'Brilliant Steel', icon: '⚙️', lucideIcon: 'settings', color: '#37474f',
    subtabs: ['Dashboard', 'Quote Builder', 'Quotations Summary', 'Client Data'],
    navOrder: 7, isSeparate: true
  },
  'Partners': {
    key: 'Partners', icon: '🤝', lucideIcon: 'handshake', color: '#0a84ff',
    subtabs: ['Overview', 'Tasks', 'Quotes', 'Activity'],
    navOrder: 8, isPartnerDept: true
  }
};

// ── Emoji → Lucide icon-name map (UI chrome). Extend as new glyphs appear. ──
window.LUCIDE_EMOJI_MAP = {
  '✅':'check-circle','✓':'check','☑':'check-square','❌':'x-circle','✗':'x','⚠':'alert-triangle','⚠️':'alert-triangle',
  '📋':'clipboard-list','🗑':'trash-2','🗑️':'trash-2','📄':'file-text','🧾':'receipt','📊':'bar-chart-3','📈':'trending-up','📉':'trending-down',
  '📅':'calendar','🕐':'clock','⏰':'alarm-clock','🌅':'sunrise','📦':'package','💸':'banknote','💰':'wallet','💵':'banknote',
  '🔔':'bell','🔒':'lock','🔓':'unlock','🔑':'key','⚙️':'settings','⚙':'settings','🔧':'wrench','🔍':'search','➕':'plus','➖':'minus',
  '✏️':'pencil','✏':'pencil','📝':'file-pen-line','📌':'pin','📎':'paperclip','🏢':'building-2','🏭':'factory','🏛️':'landmark','🏛':'landmark',
  '👥':'users','👤':'user','🤝':'handshake','📢':'megaphone','💻':'laptop','🎨':'palette','🛒':'shopping-cart','📁':'folder','📂':'folder-open',
  '🚀':'rocket','⭐':'star','🌟':'star','❓':'help-circle','ℹ️':'info','💡':'lightbulb','🎯':'target','🔗':'link','📧':'mail','📞':'phone',
  '🌴':'palm-tree','📖':'book-open','🖨️':'printer','⬇️':'download','⬆️':'upload','🔄':'refresh-cw','▶️':'play','⏸️':'pause','🏆':'trophy','🎁':'gift'
};
// Render helper: emoji OR a Lucide name -> Lucide <i>. Falls back to the raw emoji if unmapped.
// size in px (optional). ALWAYS follow an innerHTML write that uses this with lucide.createIcons(...).
window.emojiIcon = function(glyph, size){
  if (!glyph) return '';
  const name = window.LUCIDE_EMOJI_MAP[glyph] || (/^[a-z0-9-]+$/.test(glyph) ? glyph : null);
  if (!name) return `<span class="emoji-icon">${(window.escHtml?escHtml(glyph):glyph)}</span>`; // legacy/unmapped: keep emoji
  const s = size ? ` style=\"width:${size}px;height:${size}px\"` : '';
  return `<i data-lucide=\"${name}\"${s}></i>`;
};

// ── Role Definitions ─────────────────────────────
// `secretary` (Corporate Secretary) is an admin-portal oversight role: manager-level
// access to oversee the whole company. In Approvals the secretary uses a TWO-TIER
// model — they may approve MINOR everyday items (sign-ups, attendance, leave, work
// submissions, task reviews) but MAJOR / money-moving items (cash advances, quote
// approvals, payroll & finance deletes, quote/client deletions) escalate to the
// President via a "Request President approval" action. (See APPROVAL_CAPS in
// renderApprovals.) Deletions of key records still route through the President's
// approval just like every other non-president role.
window.ROLES = {
  president: { label: 'President',           badge: 'badge-blue',   canSeeAll: true  },
  manager:   { label: 'Manager',             badge: 'badge-purple', canSeeAll: false },
  secretary: { label: 'Corporate Secretary', badge: 'badge-gold',   canSeeAll: true  },
  employee:  { label: 'Employee',            badge: 'badge-gray',   canSeeAll: false },
  agent:     { label: 'Sales Agent',         badge: 'badge-orange', canSeeAll: false },
  finance:   { label: 'Accountant',          badge: 'badge-green',  canSeeAll: false },
  partner:   { label: 'Partner',             badge: 'badge-teal',   canSeeAll: false }
};

// ── Leave policy (WS25) ──────────────────────────
// ‼️ PLACEHOLDER — Neil to confirm (legal floor is ONE 5-day SIL pool, not
// 5 vacation + 5 sick). Do NOT present this as the legal minimum in any UI.
window.LEAVE_POLICY = {
  grants: { vacation: 5, sick: 5 },   // PLACEHOLDER — Neil to confirm
  yearBasis: 'calendar',
  probation: 'prorate-from-hire'
};

// ── Leave-accrual service (WS25) ──────────────────
// Manual, idempotent annual grant/seed mechanism — no cron, no Cloud Function.
// Runs in admin context only (finance/president via the Leave admin screen).
window.LeaveAccrual = {
  policyYear(){ return window.bizDate().slice(0,4); },      // calendar year, Manila
  // pure proration: full year unless hired within `year`
  grantFor(annual, startDate, year){
    const y = String(year), hy = (startDate||'').slice(0,4);
    if (hy !== y) return { vacation:annual.vacation, sick:annual.sick, proratedFromMonth:null };
    if ((window.LEAVE_POLICY.probation) === 'after-1-year')
      return { vacation:0, sick:0, proratedFromMonth:parseInt((startDate||'').slice(5,7),10)||1 };
    const hm = parseInt((startDate||'').slice(5,7),10) || 1;   // 1-12
    const f  = (12 - (hm - 1)) / 12;                           // Jan→1, Jul→0.5, Dec→1/12
    const r5 = x => Math.round(x*2)/2;                         // nearest 0.5
    return { vacation:r5(annual.vacation*f), sick:r5(annual.sick*f), proratedFromMonth:hm };
  },
  // idempotent per {uid, year}: skip if leave_accruals/{uid}_{year} already exists
  async grantForYear(uid, { startDate }={}, year, { force }={}){
    year = year || this.policyYear();
    const mref = db.collection('leave_accruals').doc(`${uid}_${year}`);
    const mkr  = await mref.get();
    if (mkr.exists && !force) return { uid, skipped:true };
    const g    = this.grantFor(window.LEAVE_POLICY.grants, startDate, year);
    const cur  = await db.collection('leave_balances').doc(uid).get();
    const prior = cur.exists ? cur.data() : {};
    const FV = firebase.firestore.FieldValue;
    await db.collection('leave_balances').doc(uid).set(
      { vacation:g.vacation, sick:g.sick, year:String(year), updatedAt:FV.serverTimestamp() }, {merge:true});
    await mref.set({ uid, year:String(year),
      grantedVacation:g.vacation, grantedSick:g.sick, proratedFromMonth:g.proratedFromMonth,
      priorYearEndingVacation: cur.exists ? (prior.vacation??null) : null,
      priorYearEndingSick:     cur.exists ? (prior.sick??null) : null,
      grantedBy: (window.currentUser && currentUser.uid) || 'system',
      grantedAt: FV.serverTimestamp() });
    return { uid, granted:g };
  },
  // one-button seed / annual rollover — the backfillPayrollLedger analogue
  async runAnnualAccrual(onProgress){
    const year = this.policyYear();
    const usnap = await db.collection('users').get();
    let seeded=0, skipped=0, i=0;
    for (const d of usnap.docs){
      const u = d.data();
      if (u.role === 'partner') { skipped++; continue; }        // partners have no leave
      const res = await this.grantForYear(d.id, { startDate:u.startDate }, year);
      res.skipped ? skipped++ : seeded++;
      onProgress && onProgress(++i, usnap.size);
    }
    return { year, seeded, skipped, total:usnap.size };
  }
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

// ── Bottom Nav — External Partner (Brilliant Steel) ─
window.PARTNER_BOTTOM_NAV = [
  { icon: 'home',         label: 'Home',     page: 'dashboard'        },
  { icon: 'briefcase',    label: 'Projects', page: 'partner-projects' },
  { icon: 'calculator',   label: 'Quotes',   page: 'bs-quote-builder' },
  { icon: 'file-text',    label: 'Summary',  page: 'bs-quotations'    }
];

// ── Bottom Nav — Generic Partner (any company) ──────
// Company-branded partner doing projects with Barro Industries: their affiliated
// projects + ability to generate quotes. No Brilliant-Steel client book.
window.PARTNER_GENERIC_BOTTOM_NAV = [
  { icon: 'home',         label: 'Home',     page: 'dashboard'        },
  { icon: 'briefcase',    label: 'Projects', page: 'partner-projects' },
  { icon: 'calculator',   label: 'Quotes',   page: 'bs-quote-builder' },
  { icon: 'check-square', label: 'Tasks',    page: 'tasks'            }
];

// ── Bottom Nav — Partner (Brilliant Steel) ───────
window.BRILLIANT_BOTTOM_NAV = [
  { icon: 'home',       label: 'Home',     page: 'dashboard'        },
  { icon: 'briefcase',  label: 'Projects', page: 'partner-projects' },
  { icon: 'calculator', label: 'Quotes',   page: 'bs-quote-builder' },
  { icon: 'file-text',  label: 'Summary',  page: 'bs-quotations'    },
  { icon: 'book-open',  label: 'Clients',  page: 'bs-clients'       }
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
  // Aliases + sub-key prefixes cleared when a base collection key is invalidated.
  const _alias = {
    'ledger':   { prefixes: ['ledger:', 'ledger>='] },  // period-scoped + since-scoped reads
    'expenses': { alsoKeys: ['expenses-pending', 'expenses-recent'] },
  };
  window.dbCacheInvalidate = function(key) {
    if (!key) { Object.keys(_store).forEach(k => delete _store[k]); return; }
    delete _store[key];
    const a = _alias[key];
    if (a) {
      (a.alsoKeys || []).forEach(k => delete _store[k]);
      (a.prefixes || []).forEach(pfx => Object.keys(_store).forEach(k => { if (k.indexOf(pfx) === 0) delete _store[k]; }));
    }
  };
})();

// ── Stock movement log — single shared shape (v12 WS29) ─────────────────────
// buildStockMovement is PURE (returns the payload) so atomic call sites can
// tx.set/batch.set it with a deterministic doc id; postStockMovement is the
// convenience writer for one-off manual flows. Lives in config.js because
// modules.js (the old writers) loads LAST and departments.js (the new writers)
// loads before it — config.js is the only file both can see at parse time.
window.buildStockMovement = function(f) {
  return {
    itemId: f.itemId, itemName: f.itemName || '',
    type: f.type,                                   // 'in' | 'out' | 'adjust'
    qty: Number(f.qty) || 0,                        // always positive
    source: f.source || 'manual',                   // 'manual'|'receive'|'consume'|'count'
    refNumber: f.refNumber || null,
    project: f.project || '', note: f.note || '',
    unitCost: (f.unitCost == null ? null : Number(f.unitCost)),
    qtyAfter: (f.qtyAfter == null ? null : Number(f.qtyAfter)),
    by: window.currentUser?.uid || '',
    byName: window.userProfile?.displayName || window.currentUser?.email || '',
    date: bizDate(),                                // Manila — never toISOString()
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
};
window.postStockMovement = function(f) {
  return db.collection('stock_movements').add(window.buildStockMovement(f));
};

// ── Month-string arithmetic (Manila-safe, no Date parsing) ──
window.ymAddMonths = function(ym, delta) {
  let [y, m] = String(ym).split('-').map(Number);
  m += delta; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1;
  return y + '-' + String(m).padStart(2, '0');
};

// ── Bounded ledger readers (WS16) — return {docs:[{data()}...]} like a snapshot ──
// Cached per RESOLVED period key so switching period re-queries only that range.
// 'all' (or an unbounded need) falls back to the full cached read.
window.ledgerForPeriod = function(periodKey) {
  const p = Period.parse(periodKey);
  if (p.type === 'all')
    return dbCachedGet('ledger', () => db.collection('ledger').get().catch(() => ({docs:[]})), 45000);
  return dbCachedGet('ledger:' + p.key,
    () => db.collection('ledger').where('date','>=',p.start).where('date','<=',p.end)
            .get().catch(() => ({docs:[]})), 45000);
};
// Everything on/after startYYYYMMDD (for the 6-month trend etc.). Bounded, cached by start.
window.ledgerSince = function(startYmd) {
  if (!startYmd)
    return dbCachedGet('ledger', () => db.collection('ledger').get().catch(() => ({docs:[]})), 60000);
  return dbCachedGet('ledger>=' + startYmd,
    () => db.collection('ledger').where('date','>=',startYmd).get().catch(() => ({docs:[]})), 60000);
};

// ── Chart.js on demand (WS16 D8) ──
window.ensureChart = function() {
  if (window.Chart) return Promise.resolve();
  if (window._chartLoading) return window._chartLoading;
  window._chartLoading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    s.onload = () => res(); s.onerror = rej; document.head.appendChild(s);
  });
  return window._chartLoading;
};

// ── Audit log (append-only) ───────────────────────
// Records who-changed-what on sensitive data (payroll, finance, inventory,
// products, production, partner deals, password resets). FIRE-AND-FORGET:
// the whole thing is wrapped so it can NEVER throw or reject into the caller —
// a failed/denied audit write must never break the user's actual mutation.
// Call (do NOT await): window.logAudit('update','payroll',uid,{salary});
window.logAudit = function(action, entity, entityId, details) {
  try {
    if (typeof db === 'undefined' || !db) return;
    db.collection('audit_log').add({
      ts:        firebase.firestore.FieldValue.serverTimestamp(),
      action:    action || 'update',
      entity:    entity || 'unknown',
      entityId:  entityId || null,
      details:   details || {},
      actorUid:  (window.currentUser && window.currentUser.uid) || null,
      actorName: (window.userProfile && window.userProfile.displayName) || (window.currentUser && window.currentUser.email) || 'system',
      actorRole: window.currentRole || null,
    }).catch(() => {});  // swallow permission/network errors silently
  } catch (_) { /* never propagate */ }
};

// ── CSV export (dependency-free) ──────────────────
// exportCSV('payroll', rows, [{key:'name',label:'Name'},{key:'net',label:'Net',get:r=>r.salary-r.deductions}])
// rows: array of objects. columns: optional [{key,label,get?}] for order/labels/computed
// values; omit to use the first row's keys. Triggers a client-side download.
window.exportCSV = function(filename, rows, columns) {
  if (!rows || !rows.length) { try { Notifs.showToast('Nothing to export', 'error'); } catch (_) {} return; }
  const cols = (columns && columns.length) ? columns : Object.keys(rows[0]).map(k => ({ key: k, label: k }));
  const cell = (v) => {
    if (v == null) v = '';
    v = String(typeof v === 'object' ? JSON.stringify(v) : v);
    // CSV formula-injection guard: a TEXT cell starting with = + - @ can execute
    // as a formula in Excel/Sheets. Prefix with a single quote to neutralize it —
    // but leave plain numbers (incl. negative/decimal) untouched so they stay numeric.
    if (!/^-?\d+(\.\d+)?$/.test(v) && /^[\s]*[=+\-@\t\r]/.test(v)) v = "'" + v;
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  };
  const header = cols.map(c => cell(c.label)).join(',');
  const body = rows.map(r => cols.map(c => cell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(',')).join('\r\n');
  const csv = '﻿' + header + '\r\n' + body;  // UTF-8 BOM so Excel reads PHP ₱ + accents correctly
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = (typeof window.bizDate === 'function') ? window.bizDate() : new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = (filename.endsWith('.csv') ? filename.slice(0, -4) : filename) + '-' + stamp + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  try { Notifs.showToast('Exported ' + a.download); } catch (_) {}
};

// ── Chip-style subtabs (shared declutter helper) ──────────
// Renders a wrapping chip bar with optional count pills, and wires the clicks.
// Replaces the old horizontally-scrolling .subtab-bar where we want fewer,
// clearer filters. Visual: css .chip-tabs / .chip-tab / .chip-count.
//
//   container.innerHTML = window.chipTabs([
//     { key:'all',   label:'All Requests', count: 5, icon:'📋' },
//     { key:'leave', label:'Leave',        count: 2 },
//   ], 'all');
//   window.bindChipTabs(container, (key) => loadSub(key));
//
// items: [{ key, label, count?, icon?, hidden? }]  — count omitted = no pill;
//   count>0 renders a red "on" pill, count===0 a muted pill, count==null none.
// activeKey: the key to mark active. opts.cls: extra class on the wrapper.
window.chipTabs = function(items, activeKey, opts) {
  opts = opts || {};
  var esc = window.escHtml || function(s){ return String(s == null ? '' : s); };
  var html = (items || []).filter(function(it){ return it && !it.hidden; }).map(function(it) {
    var active = it.key === activeKey;
    var pill = '';
    if (it.count != null && it.count !== '') {
      var on = (Number(it.count) > 0) ? ' on' : '';
      pill = '<span class="chip-count' + on + '">' + esc(it.count) + '</span>';
    }
    return '<button type="button" class="chip-tab' + (active ? ' active' : '') +
      '" data-chip="' + esc(it.key) + '">' +
      (it.icon ? esc(it.icon) + ' ' : '') + esc(it.label) + pill + '</button>';
  }).join('');
  return '<div class="chip-tabs' + (opts.cls ? ' ' + opts.cls : '') + '">' + html + '</div>';
};

// Wire chip clicks within `scope` (an element). Calls onSelect(key, btn) and
// manages the .active class. Safe to call repeatedly after re-rendering chips.
window.bindChipTabs = function(scope, onSelect) {
  if (!scope) return;
  scope.querySelectorAll('.chip-tab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      scope.querySelectorAll('.chip-tab').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      try { onSelect(btn.dataset.chip, btn); } catch (e) { /* swallow */ }
    });
  });
};

// ── Overlay stack (v12 WS10) — one history entry per dismissable surface ──
// The single source of truth for "what's on top and how to tear it down."
// Every modal/page-panel/task-panel/confirm-dialog pushes exactly one entry;
// popstate is the ONLY teardown trigger — every UI-close path (X button,
// backdrop click, closeModal()) delegates to history.back() via dismissTop().
window.Overlay = {
  _stack: [], _seq: 0, _closing: false,
  isOpen(){ return this._stack.length > 0; },
  push(kind, teardown){
    const id = ++this._seq;
    this._stack.push({ id, kind, teardown });
    const base = { page: window.currentPage || 'dashboard', subtab: window.currentSubtab || null };
    try { history.pushState({ t:'overlay', kind, oid:id, base, d:(window._navDepth||0) }, '', location.hash); } catch(_){}
    return id;
  },
  dismissTop(){ if (this._stack.length) history.back(); },   // → popstate → _popOne
  _popOne(){
    const top = this._stack.pop(); if (!top) return;
    this._closing = true; try { top.teardown(); } catch(_){} this._closing = false;
  },
  clearAll(){
    if (!this._stack.length) return;
    const n = this._stack.length;
    while (this._stack.length){ const o = this._stack.pop(); try { o.teardown(); } catch(_){} }
    // Drop the overlays' history entries so the new page push lands cleanly.
    try { history.go(-n); } catch(_){}
  }
};

// ── Confirm / prompt dialogs (v12 WS11) — replace native confirm()/prompt() ──
// Both resolve on: OK click, Cancel click, backdrop click, Esc, or device Back
// (Overlay.push's teardown fires resolve() exactly like a cancel).
function _dlgEsc(s){ return (window.escHtml||function(x){return String(x==null?'':x);})(s); }
window.confirmDialog = function(opts){
  opts = opts || {};
  return new Promise((resolve) => {
    const ov = document.getElementById('dialog-overlay');
    const msg = opts.html ? (opts.message||'') : _dlgEsc(opts.message||'');
    ov.innerHTML = `<div class="dialog-box overlay-active" role="alertdialog" aria-modal="true">
      ${opts.title ? `<h4 class="dialog-title">${_dlgEsc(opts.title)}</h4>` : ''}
      <div class="dialog-msg">${msg}</div>
      <div class="dialog-actions">
        <button class="btn-secondary" data-act="cancel">${_dlgEsc(opts.cancelLabel||'Cancel')}</button>
        <button class="${opts.danger?'btn-danger':'btn-primary'}" data-act="ok">${_dlgEsc(opts.confirmLabel||'Confirm')}</button>
      </div></div>`;
    ov.classList.remove('hidden'); ov.classList.add('active');
    let settled = false;
    const done = (val) => { if (settled) return; settled = true;
      ov.classList.add('hidden'); ov.classList.remove('active'); ov.innerHTML=''; resolve(val); };
    window.Overlay.push('dialog', () => done(false));           // Back/Esc/backdrop → false
    ov.querySelector('[data-act=ok]').onclick     = () => { window.Overlay.dismissTop(); done(true); };
    ov.querySelector('[data-act=cancel]').onclick = () => window.Overlay.dismissTop();
    ov.onclick = (e) => { if (e.target === ov) window.Overlay.dismissTop(); };
  });
};
window.promptDialog = function(opts){
  opts = opts || {};
  return new Promise((resolve) => {
    const ov = document.getElementById('dialog-overlay');
    const field = opts.multiline
      ? `<textarea id="dlg-input" rows="3" placeholder="${_dlgEsc(opts.placeholder||'')}"></textarea>`
      : `<input id="dlg-input" placeholder="${_dlgEsc(opts.placeholder||'')}"/>`;
    ov.innerHTML = `<div class="dialog-box overlay-active" role="dialog" aria-modal="true">
      ${opts.title ? `<h4 class="dialog-title">${_dlgEsc(opts.title)}</h4>` : ''}
      ${opts.message ? `<div class="dialog-msg">${_dlgEsc(opts.message)}</div>` : ''}
      <div class="form-group">${field}</div>
      <div class="dialog-actions">
        <button class="btn-secondary" data-act="cancel">${_dlgEsc(opts.cancelLabel||'Cancel')}</button>
        <button class="btn-primary" data-act="ok">${_dlgEsc(opts.confirmLabel||'OK')}</button>
      </div></div>`;
    ov.classList.remove('hidden'); ov.classList.add('active');
    const input = ov.querySelector('#dlg-input');
    input.value = opts.value || '';
    const okBtn = ov.querySelector('[data-act=ok]');
    const validate = () => { if (opts.required) okBtn.disabled = (input.value.trim()===''); };
    input.addEventListener('input', validate); validate(); setTimeout(()=>input.focus(),40);
    let settled = false;
    const done = (val) => { if (settled) return; settled = true;
      ov.classList.add('hidden'); ov.classList.remove('active'); ov.innerHTML=''; resolve(val); };
    window.Overlay.push('dialog', () => done(null));            // Back/Esc/backdrop → null (== native cancel)
    okBtn.onclick = () => { const v = input.value.trim(); if (opts.required && !v) return;
      window.Overlay.dismissTop(); done(v); };
    ov.querySelector('[data-act=cancel]').onclick = () => window.Overlay.dismissTop();
    ov.onclick = (e) => { if (e.target === ov) window.Overlay.dismissTop(); };
    if (!opts.multiline) input.addEventListener('keydown', e => { if (e.key==='Enter') okBtn.click(); });
  });
};

// ── Sub-tab routing helpers (v12 WS10, opt-in per screen) ──────────────────
window.setSubroute = function(subtab){
  const st = Object.assign({}, history.state||{t:'page',page:window.currentPage,d:(window._navDepth||0)}, { subtab });
  window.currentSubtab = subtab;
  try { history.replaceState(st, '', (window.hashFor||function(p,s){return location.hash;})(window.currentPage, subtab)); } catch(_){}
};
window.initialSubtab = function(defaultKey){
  return (window.currentSubtab != null) ? window.currentSubtab : defaultKey;
};

// ── Month-over-month growth indicator (shared analytics) ──
// Returns a small coloured "▲ 12% vs last mo" span. goodUp=false flips the
// colour logic (e.g. expenses going UP is bad). prev<=0 with cur>0 shows a hint.
window.momDelta = function(cur, prev, goodUp) {
  goodUp = goodUp !== false;
  cur = Number(cur) || 0; prev = Number(prev) || 0;
  if (!prev) return cur ? '<span style="font-size:11px;color:var(--text-muted)">— no prior month</span>' : '';
  var pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (pct === 0) return '<span style="font-size:11px;color:var(--text-muted)">→ 0% vs last mo</span>';
  var up = pct > 0;
  var color = (up === goodUp) ? 'var(--success,#30D158)' : 'var(--danger,#e5484d)';
  return '<span style="font-size:11px;font-weight:700;color:' + color + '">' + (up ? '▲' : '▼') + ' ' +
    Math.abs(pct) + '% <span style="font-weight:400;color:var(--text-muted)">vs last mo</span></span>';
};

// ── In-app SOP panel (collapsible "How this works") ───────
// A consistent, dismissible explainer for each department/screen, so the
// workflow is documented where the work happens. Returns an HTML string.
//   container.innerHTML = window.sopPanel('How Sales works', ['Build a quote…','File it…'], {open:false});
window.sopPanel = function(title, steps, opts) {
  opts = opts || {};
  var esc = window.escHtml || function(s){ return String(s == null ? '' : s); };
  return '<details class="sop-panel"' + (opts.open ? ' open' : '') +
    ' style="background:var(--s1,rgba(255,255,255,0.04));border:1px solid var(--border);border-radius:12px;padding:10px 14px;margin-bottom:16px">' +
    '<summary style="cursor:pointer;font-weight:700;font-size:13px;color:var(--text)">📖 ' + esc(title || 'How this works') + '</summary>' +
    '<ol style="margin:8px 0 2px;padding-left:18px;font-size:13px;color:var(--text-muted);line-height:1.9">' +
    (steps || []).map(function(s){ return '<li>' + esc(s) + '</li>'; }).join('') +
    '</ol></details>';
};

// ── Chart of Accounts (v12 WS13) ─────────────────────────────
// Static, code-versioned. accountType drives P&L vs balance-sheet; legacy
// rows (no accountType) derive their kind from category/type via ledgerKind.
window.COA = {
  income:    ['Sales Revenue', 'Other Income'],
  expense:   ['COS – Direct Material', 'COS – Direct Labor', 'Payroll Expense',
              'Operating Expense', 'Utilities', 'Tax', 'Materials',
              'General Expense', 'Other Expense'],
  asset:     ['Cash', 'Accounts Receivable', 'Inventory'],
  liability: ['Accounts Payable', 'VAT Payable', 'Statutory Payables',
              'SSS Payable', 'PhilHealth Payable', 'Pag-IBIG Payable', 'Withholding Tax Payable'], // v12 WS20/21 — per-agency remittance legs (WS39 reads these)
  equity:    ["Owner's Equity", 'Retained Earnings'],
};
// Legacy category → accountType (used by ledgerKind's fallback + the backfill).
// A category not listed here falls back to type: credit→income, debit/payslip→expense.
window.COA_LEGACY_MAP = {
  'Sales Revenue':'income', 'Other Income':'income',
  'Inventory – Materials':'asset',
  'COS – Direct Material':'expense', 'COS – Direct Labor':'expense',
  'Payroll Expense':'expense', 'Operating Expense':'expense', 'Payroll':'expense',
  'Utilities':'expense', 'Tax':'expense', 'Materials':'expense',
  'General Expense':'expense', 'Other Expense':'expense',
  'Journal Entry':null, 'Journal Entry (Non-cash)':null,   // null = derive from type
};
// The ONE place P&L income/expense classification happens — replaces raw
// row.type==='credit'/'debit' checks everywhere so asset/liability rows
// (e.g. the Inventory leg) never silently inflate expense totals.
window.ledgerKind = function(row) {
  if (row && typeof row.accountType === 'string') return row.accountType;
  var viaCat = row && window.COA_LEGACY_MAP[row.category];
  if (viaCat) return viaCat;
  if (!row) return 'expense';
  if (row.type === 'credit') return 'income';
  return 'expense';               // 'debit' AND legacy 'payslip' rows
};

// ── Period engine (v12 WS12) — ONE period filter for every money screen ──
// Canonical keys: 'month:YYYY-MM' | 'quarter:YYYY-Qn' | 'year:YYYY' | 'all',
// plus the aliases 'month'/'prev'/'ytd'/'year' (legacy Reports spelling).
window.Period = (function() {
  function ym() { return window.bizDate().slice(0, 7); }
  var api = {
    parse: function(key) {
      key = String(key || 'month');
      if (key === 'month') key = 'month:' + ym();
      else if (key === 'prev') key = 'month:' + window.prevBizMonth();
      else if (key === 'ytd' || key === 'year') key = 'year:' + window.bizYear();
      if (key === 'all') return { type:'all', key:'all', start:null, end:null, label:'All Time' };
      var m;
      if ((m = key.match(/^month:(\d{4})-(\d{2})$/))) {
        var s = m[1] + '-' + m[2];
        return { type:'month', key:key, start: s+'-01', end: s+'-31',
          label: new Date(s+'-01T12:00:00').toLocaleString('en-PH',{month:'long',year:'numeric'}) };
      }
      if ((m = key.match(/^quarter:(\d{4})-Q([1-4])$/))) {
        var q = +m[2], sm = String((q-1)*3+1).padStart(2,'0'), em = String(q*3).padStart(2,'0');
        return { type:'quarter', key:key, start: m[1]+'-'+sm+'-01', end: m[1]+'-'+em+'-31', label: 'Q'+q+' '+m[1] };
      }
      if ((m = key.match(/^year:(\d{4})$/)))
        return { type:'year', key:key, start: m[1]+'-01-01', end: m[1]+'-12-31', label: 'Year '+m[1] };
      return api.parse('month');    // unknown → safe default
    },
    match: function(dateStr, key) {
      var ss = String(dateStr || ''); if (!ss) return false;
      var p = (key && typeof key === 'object') ? key : api.parse(key);
      if (p.type === 'all') return true;
      var d = ss.length === 7 ? ss + '-15' : ss;   // month-level rows (YYYY-MM) match inside
      return d >= p.start && d <= p.end;
    },
    monthKeyOf: function(dateStr) { return String(dateStr || '').slice(0, 7); },
  };
  return api;
})();
// Previous Manila month as 'YYYY-MM' (kept so completed months are always one
// click away — records never "disappear" at rollover).
window.prevBizMonth = function() {
  var parts = window.bizDate().slice(0, 7).split('-').map(Number);
  var y = parts[0], m = parts[1];
  return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0');
};
// Back-compat aliases — every existing call site keeps working untouched.
window.finPeriodMatch = function(dateStr, period) { return window.Period.match(dateStr, period); };
window.finPeriodLabel = function(period) {
  if (period === 'ytd' || period === 'year') return 'YTD ' + window.bizYear();
  return window.Period.parse(period).label;
};

// ── Shared period picker (chip row + inline "Custom" month/quarter/year) ──
// Renders quick chips plus an inline custom-period row (no modal, per the
// no-pop-ups mandate). Pair with window.bindPeriodPicker to wire clicks.
window.periodPicker = function(activeKey, opts) {
  opts = opts || {};
  var p = window.Period.parse(activeKey || 'month');
  var isQuickKey = ['month','prev','ytd','year','all'].indexOf(String(activeKey)) !== -1;
  var chips = [
    { key:'month', label:'This Month' },
    { key:'prev',  label:'Last Month' },
    { key:'ytd',   label:'YTD' },
    { key:'all',   label:'All Time' },
    { key:'custom', label: isQuickKey ? '📅 Custom' : ('📅 ' + p.label) },
  ].map(function(c) {
    var active = isQuickKey ? (c.key === activeKey) : (c.key === 'custom');
    return { key:c.key, label:c.label, active: active };
  });
  var chipHtml = window.chipTabs(chips, isQuickKey ? activeKey : 'custom', { cls:'period-picker-chips' });
  var yr = window.bizYear();
  var years = []; for (var y = yr; y >= yr - 3; y--) years.push(y);
  var curMonth = window.bizDate().slice(0, 7);
  var customVal = (p.type === 'month') ? p.key.slice(7) : '';
  var custom =
    '<div class="period-custom-row" style="display:' + (isQuickKey ? 'none' : 'flex') + ';gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">' +
      '<input type="month" class="pc-month" max="' + curMonth + '" value="' + customVal + '" style="padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:12px"/>' +
      '<span style="font-size:11px;color:var(--text-muted)">or</span>' +
      '<select class="pc-quarter" style="padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:12px">' +
        '<option value="">Quarter…</option>' +
        [1,2,3,4].map(function(q){ return '<option value="' + q + '">Q' + q + '</option>'; }).join('') +
      '</select>' +
      '<select class="pc-year" style="padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:12px">' +
        years.map(function(y){ return '<option value="' + y + '">' + y + '</option>'; }).join('') +
      '</select>' +
      '<button type="button" class="btn-secondary btn-sm pc-apply">Apply</button>' +
      (opts.closedBadge ? '<span class="pc-closed-badge"></span>' : '') +
    '</div>';
  return '<div class="period-picker">' + chipHtml + custom + '</div>';
};
// Wire a rendered periodPicker inside `scope`; onSelect(newKey) fires on any
// chip click or a Custom Apply. If opts.closedBadge, also read-through checks
// finance_periods for the resolved month and appends a 🔒 Closed badge.
window.bindPeriodPicker = function(scope, onSelect, opts) {
  if (!scope) return;
  opts = opts || {};
  window.bindChipTabs(scope, function(key) {
    if (key === 'custom') {
      var row = scope.querySelector('.period-custom-row');
      if (row) row.style.display = 'flex';
      return; // wait for Apply / date input
    }
    onSelect(key);
  });
  var monthInput = scope.querySelector('.pc-month');
  if (monthInput) monthInput.addEventListener('change', function() {
    if (monthInput.value) onSelect('month:' + monthInput.value);
  });
  var applyBtn = scope.querySelector('.pc-apply');
  if (applyBtn) applyBtn.addEventListener('click', function() {
    var mv = scope.querySelector('.pc-month').value;
    var qv = scope.querySelector('.pc-quarter').value;
    var yv = scope.querySelector('.pc-year').value;
    if (mv) onSelect('month:' + mv);
    else if (qv && yv) onSelect('quarter:' + yv + '-Q' + qv);
    else if (yv) onSelect('year:' + yv);
  });
  if (opts.closedBadge) {
    var badge = scope.querySelector('.pc-closed-badge');
    if (badge) {
      var p = window.Period.parse(opts.activeKey || 'month');
      if (p.type === 'month') {
        window.isPeriodClosed(p.start).then(function(closed) {
          badge.innerHTML = closed ? '&nbsp;<span class="badge badge-gray">🔒 Closed</span>' : '';
        });
      }
    }
  }
};

// ── Period close (v12 WS12) — finance_periods/{YYYY-MM} governance ───────
// Read-through cached check + a client-side guard every ledger-write call
// site invokes before posting. Mirrored server-side by firestore.rules'
// periodOpen() so a devtools write can't bypass a closed month either.
window.isPeriodClosed = async function(dateStr) {
  var mk = window.Period.monthKeyOf(dateStr); if (!mk) return false;
  var snap = await window.dbCachedGet('finperiod-' + mk,
    function() { return db.collection('finance_periods').doc(mk).get(); }, 60000).catch(function(){ return null; });
  return !!(snap && snap.exists && snap.data().closed);
};
window.assertPeriodOpen = async function(dateStr) {
  if (await window.isPeriodClosed(dateStr)) {
    var mk = window.Period.monthKeyOf(dateStr);
    if (window.Notifs && window.Notifs.showToast) {
      window.Notifs.showToast("That month's books are closed. Ask the President to reopen " + mk + " first.", 'error');
    }
    throw new Error('period-closed:' + mk);
  }
};

// ── Brand / Company Identity (v12 WS09) ──────────────────
// Canonical source of truth for company/system identity used by all JS-rendered
// chrome (title, splash, login, topbar, version strings, Company tab, nav) AND
// consumed by the WS14 letterhead engine for print-document headers/footers.
//
// NON-JS MIRRORS (cannot read window.BRAND — keep in sync BY HAND):
//   • manifest.json  name/short_name/description   (browser-parsed, pre-JS)
//   • sw.js  header comment + CACHE_VER prefix       (worker scope, no window)
//   • firebase-messaging-sw.js  L38 title fallback    (worker scope)
//   • functions/index.js  L48 title fallback          (separate deploy pipeline)
window.BRAND = {
  name:       'Barro Industries',            // display company name (chrome)
  systemName: 'Operating System',            // product/system suffix
  fullName:   'Barro Industries Operating System',
  shortName:  'Barro Ops',                   // replaces the retired 'BI Ops'
  tagline:    'Building the Future, Brick by Brick.',  // the one live tagline we keep
  verifyBase: '/v/',                         // public ID-verify route prefix (WS27)

  legal: {
    // Corporate entity (SEC OPC) — client-facing / marketing documents
    opcName:         'Barro Industries OPC',
    opcRegistration: 'SEC-registered One Person Corporation',
    opcTin:          '',   // ‼️ FLAG FOR NEIL — OPC TIN not present anywhere in code
    // DTI sole-proprietorship trade name — the registered BIR taxpayer today
    // (currently printed on payslips + billing invoices)
    dtiName:         'NEILBARRO STEEL & METAL FABRICATION SERVICES',
    dtiTin:          '951-145-613-000',
    address:         'PUROK 6, CARLATAN, 2500, CITY OF SAN FERNANDO, LA UNION, PHILIPPINES',
    addressShort:    'La Union | Baguio City | Manila',
    phone:           '0927 683 6300',        // canonical spaced form
    email:           'hello@barroindustries.com',
    signatory:       { name: 'NEIL BARRO', title: 'President, Barro Industries OPC' }
  },

  logo: {
    wordmark:  'icons/bi-logo.svg',          // in-app splash/login/topbar
    print:     'icons/barro-industries.png', // print-document header logo (WS14)
    pwaIcon:   'icons/icon-192.png',         // PWA/apple-touch
    pushBadge: 'icons/icon-192.png'          // FCM badge (retires icons/barro-logo.png)
  },

  // Per-company sub-brands. Field shape is IDENTICAL to quote-builder-v2.html's
  // local CO object (that iframe keeps its OWN copy for isolation — see comment there).
  // CO.PT (generic partner) is runtime-synthesized inside the iframe from URL params
  // and is NOT mirrored here.
  companies: {
    BK: { name:'BARRO KITCHENS',
      sub:'Commercial Kitchen One-Stop-Shop  •  Design · Fabricate · Install  •  by Barro Industries OPC',
      addr:'La Union  |  Baguio City  |  Manila', contact:'09276836300  |  hello@barroindustries.com',
      sig:{name:'NEIL BARRO',title:'President, Barro Industries OPC'}, code:'BK',
      thanks:'Thank you for considering Barro Kitchens. We look forward to building a kitchen you can rely on for years.',
      creds:'Barro Industries OPC  •  DTI / BIR Registered  •  hello@barroindustries.com  •  0927 683 6300  •  La Union | Baguio | Manila' },
    BS: { name:'BRILLIANT STEEL CORPORATION', sub:'', addr:'Pasig City, Metro Manila', contact:'09276836300',
      sig:{name:'GERALD CHAN',title:'President, Brilliant Steel Corporation'}, code:'BS',
      thanks:'Thank you for considering Brilliant Steel Corporation. We are committed to quality steelworks delivered on time.',
      creds:'Brilliant Steel Corporation  •  SEC / BIR Registered  •  Pasig City, Metro Manila  •  0927 683 6300' }
  }
};

// Convenience: pick the correct legal entity for a document type.
//   brandEntity('bir')       → DTI trade name + real TIN (payslips, invoices, BIR docs)
//   brandEntity('corporate') → OPC name (quotes, POs, proposals, marketing)
// Consumed by the WS14 letterhead engine.
window.brandEntity = function(kind){
  var L = window.BRAND.legal;
  if (kind === 'bir') return {
    name: L.dtiName, registration: 'DTI-registered · BIR-registered',
    tin: L.dtiTin, address: L.address, phone: L.phone, email: L.email };
  return {  // 'corporate' (default)
    name: L.opcName, registration: L.opcRegistration,
    tin: L.opcTin, address: L.addressShort, phone: L.phone, email: L.email };
};

// ── Cash Advance service (v12 WS22) ──────────────────────
// ONE writer for all cash_advances mutations — every UI (Cash Advance tab,
// Finance CA tab, Approvals aggregated tab, Approvals CA subtab, Personal
// Finance, the worker-payslip CA field, the HR profile editor) becomes a thin
// caller. Lives here (not departments.js/modules.js) because modules.js loads
// LAST in index.html's script order — a shared service usable by app.js AND
// modules.js AND departments.js must load before all three.
function _caRound2(n){ return Math.round((n+Number.EPSILON)*100)/100; }
// Oldest-first split of `total` across a user's approved CA docs, capped per-doc
// balance. Shared by CashAdvance.planFor()'s custom-amount branch AND the Edit
// Payroll modal's live "Custom amount" / "Pay in full" previews, so there is
// exactly one splitting algorithm, not one per caller.
function _caSplit(cas, total) {
  let remaining = Math.max(0, total||0);
  const plan = [];
  for (const a of cas) {
    if (remaining <= 0) break;
    const due = Math.min(a.balance||0, remaining);
    if (due > 0) plan.push({ caId:a.id, amount:_caRound2(due), installmentNo:_caInstallmentNo(a), terms:a.terms||1, monthlyPayment:a.monthlyPayment||a.balance });
    remaining -= due;
  }
  return plan;
}
// "Installment N of M" — N = prior payroll-sourced payments (tagged source:'payroll') + 1.
function _caInstallmentNo(a) {
  return ((a.payments||[]).filter(p => p && p.source === 'payroll').length) + 1;
}

window.CashAdvance = {
  RATE_DEFAULT: 2, // %/mo — approval-time prefill; nothing charges until an approver confirms

  canAct() {
    const role = window.currentRole || '';
    if (['president','manager','finance'].includes(role)) return true;
    return typeof window.canEditDept === 'function' && window.canEditDept('Finance');
  },

  // ── Request (the ONE request form's data path) ──────────────────────
  async request({ amount, terms, reason, dateNeeded }) {
    const amt = parseFloat(amount)||0;
    if (!amt || amt < 100) throw new Error('Enter a valid amount (min ₱100).');
    if (amt > 50000)       throw new Error('Maximum cash advance is ₱50,000.');
    const t    = parseInt(terms)||1;
    const uid  = window.currentUser && window.currentUser.uid;
    const name = (window.userProfile && window.userProfile.displayName) || (window.currentUser && window.currentUser.email) || '';
    await db.collection('cash_advances').add({
      userId: uid, userName: name,
      employeeId: (window.userProfile && window.userProfile.employeeId) || uid,
      amount: amt, terms: t,
      // Interest/monthly/total are finalized at approval (v12 WS22 decision 3) —
      // the employee no longer picks whether interest applies.
      interest: 0, interestCharged: false, monthlyPayment: null, totalPayable: null,
      balance: 0, status: 'pending', payments: [],
      date: dateNeeded || (window.bizDate ? window.bizDate() : today()),
      reason: (reason||'').trim(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ca-pending');
    await Notifs.sendToOwner({ title:'Cash Advance Request', body:`${name} requests ₱${fmt(amt)} (${t}-month plan).`, icon:'💸', type:'cash_advance' });
  },

  openRequestForm() {
    openModal('Request Cash Advance', `
      <div class="form-group"><label>Amount Needed (₱, max ₱50,000)</label>
        <input id="ca-req-amt" type="number" inputmode="decimal" min="100" max="50000" step="100" placeholder="0.00"/>
      </div>
      <div class="form-group"><label>Repayment Terms</label>
        <select id="ca-req-terms" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          <option value="1">1 month (lump sum)</option>
          <option value="2">2 months</option>
          <option value="3" selected>3 months</option>
          <option value="6">6 months</option>
          <option value="12">12 months</option>
        </select>
      </div>
      <div class="form-group"><label>Date Needed</label><input id="ca-req-date" type="date" value="${window.bizDate?window.bizDate():today()}"/></div>
      <div class="form-group"><label>Reason / Purpose</label>
        <textarea id="ca-req-reason" rows="3" placeholder="e.g., Medical emergency, school fees…" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical"></textarea>
      </div>
      <p style="font-size:11px;color:var(--text-muted);margin-top:2px">Interest (if any) and the exact repayment schedule are set by Finance when your request is approved.</p>
    `, `<button class="btn-primary" id="ca-req-submit-btn">Submit Request</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('ca-req-submit-btn').addEventListener('click', async () => {
      try {
        await window.CashAdvance.request({
          amount:     document.getElementById('ca-req-amt').value,
          terms:      document.getElementById('ca-req-terms').value,
          reason:     document.getElementById('ca-req-reason').value,
          dateNeeded: document.getElementById('ca-req-date').value
        });
        closeModal();
        Notifs.showToast('Request submitted! Waiting for approval.');
        if (typeof window.renderCashAdvancePage === 'function') window.renderCashAdvancePage();
        else if (typeof window.renderPersonalFinance === 'function' && window.currentUser) window.renderPersonalFinance(window.currentUser, window.currentRole);
      } catch (err) {
        Notifs.showToast(err.message || 'Could not submit request.', 'error');
      }
    });
  },

  // ── Approve / reject (race-safe everywhere — a strict upgrade over the two
  //    call sites that previously skipped the transaction) ────────────────
  async approve(id, { interestPct = null } = {}) {
    const ref = db.collection('cash_advances').doc(id);
    let result = null;
    await db.runTransaction(async t => {
      const fresh = await t.get(ref);
      if (!fresh.exists) throw new Error('Record no longer exists.');
      const cur = fresh.data();
      if (cur.status !== 'pending') throw new Error('This request is no longer pending (already actioned).');
      const pct     = interestPct != null ? interestPct : (cur.interest || 0);
      const terms   = cur.terms || 1;
      const total   = pct > 0 ? cur.amount * Math.pow(1 + pct/100, terms) : cur.amount;
      const monthly = total / terms;
      const uid     = window.currentUser && window.currentUser.uid;
      t.update(ref, {
        status: 'approved', interest: pct, interestCharged: pct > 0,
        totalPayable: _caRound2(total), monthlyPayment: _caRound2(monthly), balance: _caRound2(total),
        approvedBy: uid, approvedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      result = { userId: cur.userId, amount: cur.amount, total: _caRound2(total) };
    });
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ca-pending');
    if (result) {
      await Notifs.send(result.userId, { title:'Cash Advance Approved', body:`Your ₱${fmt(result.amount)} cash advance was approved — repay ₱${fmt(result.total)}.`, icon:'💸', type:'cash_advance', dedupKey:`ca-approved-${id}` });
      window.logAudit && window.logAudit('approve','cash_advance', id, { total: result.total });
    }
    return result;
  },

  openApproveModal(id, onDone) {
    db.collection('cash_advances').doc(id).get().then(snap => {
      if (!snap.exists) { Notifs.showToast('Record no longer exists.','error'); if (onDone) onDone(); return; }
      const a = snap.data();
      const terms = a.terms || 1;
      openModal(`Approve Cash Advance — ${escHtml(a.userName||'Employee')}`, `
        <div class="ca-detail" style="margin-bottom:10px"><span>Principal</span><strong>₱${fmt(a.amount)}</strong></div>
        <div class="ca-detail" style="margin-bottom:10px"><span>Terms</span><span>${terms} month${terms>1?'s':''}</span></div>
        <div class="form-group"><label>Interest Rate (%/month)</label>
          <input id="ca-appr-rate" type="number" inputmode="decimal" min="0" step="0.5" value="${window.CashAdvance.RATE_DEFAULT}"/>
        </div>
        <div id="ca-appr-preview" style="font-size:13px;color:var(--text-muted);margin-top:8px"></div>
      `, `<button class="btn-primary" id="ca-appr-confirm-btn">Approve</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      const updatePreview = () => {
        const pct = parseFloat(document.getElementById('ca-appr-rate').value)||0;
        const total = pct>0 ? a.amount*Math.pow(1+pct/100,terms) : a.amount;
        const monthly = total/terms;
        document.getElementById('ca-appr-preview').innerHTML = `Employee repays <strong>₱${fmt(total)}</strong> (₱${fmt(monthly)}/mo × ${terms})`;
      };
      document.getElementById('ca-appr-rate').addEventListener('input', updatePreview);
      updatePreview();
      document.getElementById('ca-appr-confirm-btn').addEventListener('click', async () => {
        const pct = parseFloat(document.getElementById('ca-appr-rate').value)||0;
        try {
          await window.CashAdvance.approve(id, { interestPct: pct });
          closeModal();
          Notifs.showToast('Approved!');
        } catch (err) {
          Notifs.showToast(err.message || 'Could not approve.', 'error');
        }
        if (onDone) onDone();
      });
    });
  },

  async reject(id, reason) {
    const ref  = db.collection('cash_advances').doc(id);
    const snap = await ref.get().catch(()=>null);
    if (!snap || !snap.exists) throw new Error('Record no longer exists.');
    const a   = snap.data();
    const uid = window.currentUser && window.currentUser.uid;
    await ref.update({
      status: 'rejected', rejectedBy: uid, rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
      ...(reason ? { rejectReason: reason } : {})
    });
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ca-pending');
    await Notifs.send(a.userId, { title:'Cash Advance Rejected', body: reason ? `Your cash advance request was not approved: ${reason}` : 'Your cash advance request was not approved.', icon:'❌', type:'cash_advance', dedupKey:`ca-rejected-${id}` });
    window.logAudit && window.logAudit('reject','cash_advance', id, {});
  },

  // ── Payments (ALWAYS transactional — fixes the one unguarded record-payment site) ──
  async recordPayment(id, { amount, date }) {
    const paid = parseFloat(amount)||0;
    if (paid <= 0) throw new Error('Enter a payment amount greater than ₱0.');
    const ref     = db.collection('cash_advances').doc(id);
    const uid     = window.currentUser && window.currentUser.uid;
    const payDate = date || (window.bizDate ? window.bizDate() : today());
    let result = null;
    await db.runTransaction(async t => {
      const fresh = await t.get(ref);
      if (!fresh.exists) throw new Error('Record no longer exists.');
      const cur = fresh.data();
      if (cur.status !== 'approved' || (cur.balance||0) <= 0)
        throw new Error('This cash advance has no outstanding balance (already paid or not approved).');
      const newBal   = Math.max(0, (cur.balance||0) - paid);
      const payments = [...(cur.payments||[]), { amount: paid, date: payDate, recordedBy: uid }];
      t.update(ref, { balance: newBal, payments, status: newBal <= 0 ? 'paid' : 'approved', ...(newBal<=0?{paidAt:firebase.firestore.FieldValue.serverTimestamp()}:{}) });
      result = { newBal, userId: cur.userId };
    });
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ca-pending');
    if (result) {
      const statusMsg = result.newBal <= 0 ? 'fully paid off 🎉' : `balance remaining: ₱${fmt(result.newBal)}`;
      await Notifs.send(result.userId, { title:'💳 Cash Advance Payment Recorded', body:`₱${fmt(paid)} payment was recorded. ${statusMsg}`, icon:'💳', type:'cash_advance' });
    }
    return result;
  },

  openPaymentModal(id, onDone) {
    db.collection('cash_advances').doc(id).get().then(snap => {
      if (!snap.exists) { Notifs.showToast('Record no longer exists.','error'); if (onDone) onDone(); return; }
      const a = snap.data();
      openModal(`Record Payment${a.userName?` — ${escHtml(a.userName)}`:''}`, `
        <div class="ca-detail" style="margin-bottom:12px"><span>Balance:</span><strong>₱${fmt(a.balance||0)}</strong></div>
        <div class="form-group"><label>Amount Paid</label><input id="ca-pay-amt" type="number" inputmode="decimal" value="${a.monthlyPayment||a.balance||0}" min="0" max="${a.balance||0}"/></div>
        <div class="form-group"><label>Date</label><input id="ca-pay-date" type="date" value="${window.bizDate?window.bizDate():today()}"/></div>
      `, `<button class="btn-primary" id="ca-pay-confirm-btn">Record</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('ca-pay-confirm-btn').addEventListener('click', async () => {
        try {
          await window.CashAdvance.recordPayment(id, {
            amount: document.getElementById('ca-pay-amt').value,
            date:   document.getElementById('ca-pay-date').value
          });
          closeModal();
          Notifs.showToast('Payment recorded!');
        } catch (err) {
          Notifs.showToast('Error recording payment: ' + err.message, 'error');
        }
        if (onDone) onDone();
      });
    });
  },

  // ── Payroll plug-ins (WS20 calls these; nothing else should touch CA balances) ──
  // planFor: the DEFAULT plan for this uid/month — installment-by-default, or a
  // custom total if an approved ca_deduct request or a legacy override exists.
  async planFor(uid, month) {
    const caSnap = await db.collection('cash_advances')
      .where('userId','==',uid).where('status','==','approved').get().catch(()=>({docs:[]}));
    const cas = caSnap.docs.map(d=>({id:d.id,...d.data()}))
      .filter(a => (a.balance||0) > 0)
      .sort((a,b) => (a.createdAt?.toMillis?.()||0) - (b.createdAt?.toMillis?.()||0)); // oldest-first
    const caBalance = _caRound2(cas.reduce((s,a)=>s+(a.balance||0),0));
    if (!cas.length) return { caBalance: 0, mode: 'full', caPlanned: 0, plan: [], source: 'none' };

    // Custom source, priority: approved approval_requests(ca_deduct) → legacy
    // payroll_ca_overrides (transition only) → default installment.
    let customAmount = null, source = 'installment';
    const reqSnap = await db.collection('approval_requests')
      .where('userId','==',uid).where('type','==','ca_deduct').where('month','==',month).where('status','==','approved')
      .limit(1).get().catch(()=>({docs:[]}));
    if (reqSnap.docs.length) { customAmount = reqSnap.docs[0].data().amount; source = 'custom-request'; }
    if (customAmount == null) {
      const ovrSnap = await db.collection('payroll_ca_overrides').doc(`${uid}_${month}`).get().catch(()=>null);
      if (ovrSnap && ovrSnap.exists) { customAmount = ovrSnap.data().amount; source = 'legacy-override'; }
    }

    if (customAmount != null) {
      const plan = _caSplit(cas, Math.min(customAmount, caBalance));
      return { caBalance, mode:'custom', caPlanned: _caRound2(plan.reduce((s,p)=>s+p.amount,0)), plan, source };
    }
    // Default installment: per-CA (monthlyPayment ?? balance), oldest-first.
    const plan = cas.map(a => {
      const due = Math.min(a.monthlyPayment != null ? a.monthlyPayment : a.balance, a.balance||0);
      return { caId:a.id, amount:_caRound2(due), installmentNo:_caInstallmentNo(a), terms:a.terms||1, monthlyPayment:a.monthlyPayment||a.balance };
    });
    return { caBalance, mode:'installment', caPlanned: _caRound2(plan.reduce((s,p)=>s+p.amount,0)), plan, source:'installment' };
  },

  // "Pay in full" preview/plan — every approved CA's full balance, oldest-first.
  planFull(cas) { return _caSplit(cas, cas.reduce((s,a)=>s+(a.balance||0),0)); },
  // "Custom amount" preview/plan — split a Finance-typed total, oldest-first.
  planCustom(cas, amount) { return _caSplit(cas, amount); },

  // deduct: THE only balance mutation for payroll — called from disbursePayRun,
  // never from Compute. `actorUid` is the disbursing president/finance user (for
  // the payments[] audit trail); omit only for system/backfill callers.
  async deduct(uid, month, plan, actorUid) {
    if (!Array.isArray(plan) || !plan.length) return [];
    const batch = db.batch();
    const caDeductions = [];
    for (const p of plan) {
      if (!p.caId || !(p.amount > 0)) continue;
      const ref  = db.collection('cash_advances').doc(p.caId);
      const snap = await ref.get().catch(()=>null);
      if (!snap || !snap.exists) continue;
      const cur = snap.data();
      const toDeduct = Math.min(cur.balance||0, p.amount);
      if (toDeduct <= 0) continue;
      const newBal   = Math.max(0, (cur.balance||0) - toDeduct);
      const payments = [...(cur.payments||[]), { amount:_caRound2(toDeduct), date:(window.bizDate?window.bizDate():today()), recordedBy: actorUid||'system', source:'payroll', month }];
      batch.update(ref, {
        balance: newBal, payments,
        ...(newBal <= 0 ? { status:'paid', paidAt: firebase.firestore.FieldValue.serverTimestamp() } : {})
      });
      caDeductions.push({ caId: p.caId, amount: _caRound2(toDeduct) });
    }
    if (caDeductions.length) await batch.commit();
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ca-pending');
    if (caDeductions.length) {
      await Notifs.send(uid, {
        title: '💳 Cash Advance Deducted from Payroll',
        body: `₱${fmt(caDeductions.reduce((s,c)=>s+c.amount,0))} was deducted from your ${month} payroll.`,
        icon: '💳', type: 'cash_advance'
      });
    }
    return caDeductions;
  },

  // worker_profiles is a SEPARATE, non-cash_advances-backed population (no
  // migration — that would force an identity-model project). Clamped,
  // transaction-guarded, audit-logged decrement — used by the weekly payslip
  // generator/editor. NOT for the HR profile editor's "set starting balance"
  // field, which is a direct value-set, not a deduction (see call site).
  async deductWorker(profileId, amount, ctx = {}) {
    const amt = parseFloat(amount)||0;
    const ref = db.collection('worker_profiles').doc(profileId);
    let result = null;
    await db.runTransaction(async t => {
      const fresh = await t.get(ref);
      if (!fresh.exists) throw new Error('Worker profile not found.');
      const cur = fresh.data();
      const before = cur.caBalance || 0;
      const after  = Math.max(0, before - amt);
      t.update(ref, { caBalance: after });
      result = { before, after };
    });
    window.logAudit && window.logAudit('worker-ca-deduct','worker_profiles', profileId, { amount: amt, ...ctx, ...result });
    return result;
  },
};
