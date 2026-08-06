/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — App Configuration v3
   config.js
═══════════════════════════════════════════════════ */

// ── App Version ──────────────────────────────────
// Auto-incremented by git pre-commit hook (.git/hooks/pre-commit)
window.APP_VERSION = '14.0.78';

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
  // → 0–6 (0 = Sunday), the day-of-week in Manila. Omit for today; pass a Date,
  // or an ISO 'YYYY-MM-DD' string (noon-anchored to dodge TZ boundary rollover —
  // v13 Phase 17).
  let d = date;
  if (typeof d === 'string') d = new Date(d.slice(0,10) + 'T12:00:00+08:00');
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: window.BIZ_TZ, weekday: 'short' })
    .format(d || new Date());
  return { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 }[wd];
};
window.bizYear = function() { return parseInt(window.bizDate().slice(0, 4), 10); };

// ── Task completion-month resolution (payroll recall spec §A3.2) ──────────
// Used by computePayRun's month-scoped KPI (window.computeKpiForMonth,
// js/money-core.js) to determine which calendar month a task was completed
// in (vs. simply scoring "the employee's entire task history as it exists
// today", which silently rescored old months whenever a task's live status
// changed). Tasks have no dedicated `completedAt` field historically —
// js/screens/tasks.js/approvals.js now stamp one going forward (§A3.1) — so
// this resolves a best-effort ladder for tasks finished before that existed.
// `t` fields may be Firestore Timestamps OR plain {seconds} POJOs (cached
// reads sometimes serialize Timestamps down to plain objects).
window.taskDoneMonth = function(t) {
  const DONE_ST_LOCAL = ['done','approved','archived'];
  if (!t || DONE_ST_LOCAL.indexOf(t.status) === -1) return null;
  const ts = t.completedAt || t.approvedAt || t.lastModifiedAt || null;
  if (!ts) return ''; // done, but no timestamp to resolve a month from — see computeKpiForMonth
  const d = (ts.toDate && typeof ts.toDate === 'function') ? ts.toDate() : new Date((ts.seconds||0)*1000);
  return (window.bizDate ? window.bizDate(d) : d.toISOString().slice(0,10)).slice(0,7);
};
window.taskCreatedMonth = function(t) {
  if (!t || !t.createdAt) return ''; // legacy task, no createdAt — treated as "existed since forever"
  const ts = t.createdAt;
  const d = (ts.toDate && typeof ts.toDate === 'function') ? ts.toDate() : new Date((ts.seconds||0)*1000);
  return (window.bizDate ? window.bizDate(d) : d.toISOString().slice(0,10)).slice(0,7);
};

// ── Haptics (v14 G2) ──────────────────────────────────────────────
// Thin, feature-detected wrapper over navigator.vibrate — desktop/iOS Safari
// (no Vibration API) silently no-ops. Named patterns keep call sites terse:
//   light   — 10ms  tick   (nav taps, sheet/dialog dismiss, PTR soft threshold)
//   medium  — 20ms  tick   (PTR hard threshold)
//   success — 10-30-10ms   (destructive-confirm completion)
window.haptic = function(pattern) {
  try {
    if (!navigator.vibrate) return;
    const P = { light: 10, medium: 20, success: [10, 30, 10] };
    navigator.vibrate(P[pattern] || P.light);
  } catch (_) { /* no-op */ }
};

// Manila wall-clock display for ISO-string/Timestamp instants (v12 WS35). Storage
// stays ISO (arrayUnion can't hold serverTimestamp — same pattern as WS38's
// versions[]); this only fixes the DISPLAY, which previously showed UTC wall-clock
// via a raw .slice(0,16) on the ISO string.
window.fmtManila = function(v){
  try {
    const d = (v && v.toDate) ? v.toDate() : new Date(v);
    if (isNaN(d)) return '';
    return d.toLocaleString('en-PH', { timeZone:'Asia/Manila',
      year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false });
  } catch(_) { return ''; }
};

// Canonical peso formatters (Part H Phase 111). Three flavors, pick by call site:
//   fmtPeso(n, {dp})     -> '₱' + en-PH grouped number, default 2dp (symbol + 2dp)
//   fmtPesoWhole(n)      -> '₱' + en-PH grouped number, rounded to 0dp (symbol + 0dp)
//   fmtN2(n)             -> bare en-PH grouped number, 2dp, NO symbol (matches legacy
//                            fmt()/fmtN() call sites that prepend '₱' themselves)
window.fmtPeso = function(n, opts){
  const dp = (opts && opts.dp != null) ? opts.dp : 2;
  return '₱' + Number(n||0).toLocaleString('en-PH', {minimumFractionDigits: dp, maximumFractionDigits: dp});
};
window.fmtPesoWhole = n => window.fmtPeso(Math.round(Number(n)||0), {dp:0});
window.fmtN2 = n => Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});

// Manila-correct "Month YYYY" label for a 'YYYY-MM' string or a Date (v13 Phase 17).
// Noon-anchors YYYY-MM-01 to dodge UTC/Manila day-boundary rollover when the
// device clock is in a different timezone.
window.fmtMonthLabel = function(ymOrDate){
  try {
    let d;
    if (ymOrDate instanceof Date) {
      d = ymOrDate;
    } else if (typeof ymOrDate === 'string' && /^\d{4}-\d{2}/.test(ymOrDate)) {
      d = new Date(ymOrDate.slice(0,7) + '-01T12:00:00+08:00');
    } else {
      d = new Date(ymOrDate);
    }
    if (isNaN(d)) return '';
    return d.toLocaleString('en-PH', { timeZone:'Asia/Manila', month:'long', year:'numeric' });
  } catch(_) { return ''; }
};

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
// v12 WS42 Phase 21 — harmonized modern color set (keeps each dept's hue identity
// while normalizing saturation/lightness so the icon-tile gradients read as one
// coherent system instead of the old ad-hoc material-design swatches).
// v14 C2 — subtabs corrected to match what each render function ACTUALLY
// shows today (verified against departments.js). navOrder collisions (Finance/HR
// both 2, IT/Design both 6, Production/Brilliant Steel both 7, Purchasing/Partners
// both 8) fixed by renumbering uniquely in the object's existing key order — the
// only order any current consumer (Object.keys(DEPARTMENTS) in the dept
// switcher/pickers) actually reads; navOrder itself has no reader yet.
window.DEPARTMENTS = {
  'Admin': {
    key: 'Admin', icon: '🏢', lucideIcon: 'building-2', color: '#3B5BDB',
    // renderDeptModule has no 'Admin' case → falls to renderGenericDept, a static
    // "Module coming soon" placeholder. No chip tabs are ever rendered for it.
    subtabs: [], navOrder: 1
  },
  'Finance': {
    key: 'Finance', icon: '💰', lucideIcon: 'wallet', color: '#2F9E44',
    // v14 wave4 F1: the 7 user-visible groups (FINANCE_GROUPS in departments.js);
    // every old flat key still resolves via FINANCE_KEY_TO_GROUP aliasing.
    subtabs: ['Overview', 'Money In/Out', 'Reports', 'Payroll & HR',
              'Purchases & Inventory', 'Taxes & BIR', 'Records'], navOrder: 2
  },
  'HR': {
    key: 'HR', icon: '👥', lucideIcon: 'users', color: '#E64980',
    // renderHR's card list (departments.js:3153-3159); 'Accounts & Logins' only
    // shows for president/manager, kept in its real position for accuracy.
    subtabs: ['People & Roles', 'Payroll', 'Accounts & Logins', 'Leave', 'Attendance'], navOrder: 3
  },
  'Sales': {
    key: 'Sales', icon: '🤝', lucideIcon: 'handshake', color: '#F76707',
    // renderSales's real salesTabs (departments.js:6563). 'BK Quotes'/'Quotations'/
    // 'Quick Estimate' are dead aliases that resolve to 'Quotes' — removed here.
    // 'AEC' moved out to the CRM department (2026-08-04) — the architect/
    // engineer/contractor prospecting directory now lives under CRM > AEC Leads.
    subtabs: ['Clients', 'Quotes', 'Partner', 'Files', 'SOP', 'Tasks'], navOrder: 4
  },
  'CRM': {
    key: 'CRM', icon: '🎯', lucideIcon: 'target', color: '#F59F00',
    // New department (2026-08-04) consolidating lead management: the AEC
    // directory (moved in from Sales, js/screens/sales.js's renderAECDirectory)
    // + the new ROC restaurant-lead directory + a funnel dashboard + pipeline
    // (js/screens/crm.js). navOrder is a fractional slot right after Sales (4) —
    // per the comment above, navOrder has no reader yet so no renumbering of
    // the departments below is needed; this key is also placed immediately
    // after 'Sales' in this object's OWN order, which IS what Object.keys()
    // consumers (dept switcher/pickers) actually read.
    subtabs: ['Dashboard', 'AEC Leads', 'ROC Leads', 'Pipeline'], navOrder: 4.5
  },
  'Marketing': {
    key: 'Marketing', icon: '📢', lucideIcon: 'megaphone', color: '#D6336C',
    subtabs: ['Campaigns', 'Leads', 'Promos', 'Insights', 'Advertising', 'Marketing Designs',
              'Plan', 'Strategy', 'Budgeting', 'Proposals', 'Tasks'], navOrder: 5
  },
  'Government Biddings': {
    key: 'Government Biddings', icon: '🏛️', lucideIcon: 'landmark', color: '#0CA678',
    subtabs: ['PhilGEPS', 'Active Bids', 'Archive'], navOrder: 6
  },
  'IT': {
    key: 'IT', icon: '💻', lucideIcon: 'laptop', color: '#1C7ED6',
    subtabs: ['Overview', 'IT Tickets', 'Assets', 'Software', 'Access Control', 'Network', 'Tasks'], navOrder: 7
  },
  'Design': {
    key: 'Design', icon: '🎨', lucideIcon: 'palette', color: '#7048E8',
    subtabs: ['Projects', 'Drawings', 'Clients', 'Product Designs', 'References', 'Tasks'], navOrder: 8
  },
  'Production': {
    key: 'Production', icon: '🏭', lucideIcon: 'factory', color: '#A05A2C',
    // renderProductionDept's real subs (departments.js:13667) — Inventory and
    // Count Form were missing, Files was there but out of place vs runtime order.
    subtabs: ['Orders', 'Materials', 'Inventory', 'Count Form', 'Tasks', 'Files'], navOrder: 9
  },
  'Purchasing': {
    key: 'Purchasing', icon: '🛒', lucideIcon: 'shopping-cart', color: '#099268',
    subtabs: ['Request for Quotation', 'Purchase Requests', 'Tasks'], navOrder: 10
  },
  'Brilliant Steel': {
    key: 'Brilliant Steel', icon: '⚙️', lucideIcon: 'settings', color: '#495057',
    // renderBrilliantSteel's real tabs (departments.js:9287) — there is no
    // 'Dashboard' tab; the default landing subtab is 'Quotations Summary'.
    subtabs: ['Quote Builder', 'Quotations Summary', 'Client Data', 'Files'],
    navOrder: 11, isSeparate: true
  },
  'Partners': {
    key: 'Partners', icon: '🤝', lucideIcon: 'handshake', color: '#1971C2',
    // renderPartnersDept's real chip tabs (app.js:4107-4113) — 'Deals' and
    // 'Quote Builder' were missing from the old list.
    subtabs: ['Overview', 'Deals', 'Tasks', 'Quotes', 'Quote Builder', 'Activity'],
    navOrder: 12, isPartnerDept: true
  }
};

// ── v12 WS42 Phase 21 — BI icon-tile system ──────────────────────────────
// Small hex-lighten helper (used once at load to precompute each dept's
// duotone gradient — never recomputed at render time).
window.lightenHex = function(hex, pct){
  const h = (hex||'#888888').replace('#','');
  const full = h.length===3 ? h.split('').map(c=>c+c).join('') : h;
  const num = parseInt(full,16);
  if (isNaN(num)) return hex;
  const r = (num>>16)&255, g = (num>>8)&255, b = num&255;
  const lift = (c) => Math.round(c + (255-c)*(pct/100));
  const toHex = (c) => c.toString(16).padStart(2,'0');
  return `#${toHex(lift(r))}${toHex(lift(g))}${toHex(lift(b))}`;
};
// Precompute a `gradient` (color → lightened color, ~18%) for every department —
// this is the "unique to BI" duotone used by deptIconTile below.
Object.keys(window.DEPARTMENTS).forEach(k => {
  const cfg = window.DEPARTMENTS[k];
  cfg.gradient = `linear-gradient(135deg, ${cfg.color}, ${window.lightenHex(cfg.color, 18)})`;
});

// Generic rounded-squircle duotone icon tile: any Lucide icon + a 2-color gradient.
// size: 28 | 36 | 44 (px). Returns a self-contained <span> — call lucide.createIcons()
// after injecting into the DOM (same rule as emojiIcon()).
window.iconTile = function(lucideName, colorA, colorB, size){
  const s = size || 36;
  const grad = colorB ? `linear-gradient(135deg, ${colorA}, ${colorB})` : (colorA || 'var(--primary)');
  const r = Math.round(s * 0.32); // --r-sm-ish proportion, squircle feel at any size
  const strokeW = s >= 40 ? 2.25 : 2;
  const iconSize = Math.round(s * 0.56);
  return `<span class="bi-icon-tile" style="width:${s}px;height:${s}px;min-width:${s}px;border-radius:${r}px;background:${grad}">` +
    `<i data-lucide="${lucideName||'square'}" style="width:${iconSize}px;height:${iconSize}px;stroke:#fff;stroke-width:${strokeW}"></i></span>`;
};
// Department icon tile — resolves a dept key (string) OR an already-fetched
// DEPARTMENTS[...] config object, using its precomputed gradient + lucideIcon.
window.deptIconTile = function(deptKeyOrObj, size){
  const cfg = (typeof deptKeyOrObj === 'string') ? window.DEPARTMENTS[deptKeyOrObj] : deptKeyOrObj;
  if (!cfg) return window.iconTile('folder', 'var(--text-muted)', null, size);
  const grad = cfg.gradient || `linear-gradient(135deg, ${cfg.color||'#888'}, ${window.lightenHex(cfg.color||'#888',18)})`;
  const s = size || 36;
  const r = Math.round(s * 0.32);
  const strokeW = s >= 40 ? 2.25 : 2;
  const iconSize = Math.round(s * 0.56);
  return `<span class="bi-icon-tile" style="width:${s}px;height:${s}px;min-width:${s}px;border-radius:${r}px;background:${grad}">` +
    `<i data-lucide="${cfg.lucideIcon||'folder'}" style="width:${iconSize}px;height:${iconSize}px;stroke:#fff;stroke-width:${strokeW}"></i></span>`;
};

// ── Emoji → Lucide icon-name map (UI chrome). Extend as new glyphs appear. ──
window.LUCIDE_EMOJI_MAP = {
  '✅':'check-circle','✓':'check','☑':'check-square','❌':'x-circle','✗':'x','✕':'x','✖':'x','✖️':'x','⚠':'alert-triangle','⚠️':'alert-triangle',
  '📋':'clipboard-list','🗑':'trash-2','🗑️':'trash-2','📄':'file-text','🧾':'receipt','📊':'bar-chart-3','📈':'trending-up','📉':'trending-down',
  '📅':'calendar','🗓':'calendar','🗓️':'calendar','🕐':'clock','🕘':'clock','🕓':'clock','⏰':'alarm-clock','⏱':'timer','⏱️':'timer','⌛':'hourglass',
  '🌅':'sunrise','📦':'package','💸':'banknote','💰':'wallet','💵':'banknote','💳':'credit-card','🏦':'landmark',
  '🔔':'bell','🔒':'lock','🔓':'unlock','🔏':'lock','🔑':'key','⚙️':'settings','⚙':'settings','🔧':'wrench','🛠':'wrench','🛠️':'wrench','🩹':'wrench',
  '🔍':'search','🔎':'search','➕':'plus','➖':'minus',
  '✏️':'pencil','✏':'pencil','✎':'pencil','📝':'file-pen-line','📌':'pin','📎':'paperclip','🏢':'building-2','🏭':'factory','🏛️':'landmark','🏛':'landmark',
  '👥':'users','👤':'user','👁':'eye','👀':'eye','🤝':'handshake','📢':'megaphone','💻':'laptop','🎨':'palette','🛒':'shopping-cart','📁':'folder','📂':'folder-open',
  '🗂':'folder-open','🗂️':'folder-open','🗄':'archive','🗄️':'archive',
  '🚀':'rocket','⭐':'star','🌟':'star','❓':'help-circle','ℹ️':'info','💡':'lightbulb','🎯':'target','🔗':'link','📧':'mail','📩':'mail','📭':'inbox','📞':'phone',
  '🌴':'palm-tree','📖':'book-open','📚':'book-open','📒':'book','📕':'book','🖨️':'printer','🖨':'printer','⬇️':'download','⬇':'download','⬆️':'upload','⬆':'upload',
  '📥':'download','📤':'upload','🔄':'refresh-cw','🔁':'repeat','🔀':'shuffle','▶️':'play','⏸️':'pause','🏆':'trophy','🥇':'award','🥈':'award','🥉':'award','🎁':'gift',
  '👷':'hard-hat','🏗':'construction','🏗️':'construction','🧭':'compass','📐':'ruler','📍':'map-pin','🚨':'siren','🖥️':'monitor','🖥':'monitor','📱':'smartphone',
  '🔲':'square','🟡':'circle','🟠':'circle','🔴':'circle','🟢':'circle','🔵':'circle','🔖':'bookmark','🔥':'flame','♻️':'recycle','🎌':'flag','🎉':'party-popper',
  '✨':'sparkles','✂️':'scissors','🍽️':'utensils','⚡':'zap','🧊':'box','📑':'files','💤':'moon','😴':'moon','🏠':'home','🌱':'sprout','🤒':'thermometer',
  '🤷':'help-circle','💭':'message-circle','🖼':'image','🖼️':'image','📇':'id-card','💼':'briefcase','🧮':'calculator','🎫':'ticket','📡':'wifi','💾':'save',
  '🌐':'globe','↩':'undo-2','↩️':'undo-2','↻':'refresh-cw','↺':'refresh-cw',
  '📣':'megaphone','🖊':'pen-line','💬':'message-circle','✉️':'mail','✉':'mail','⏳':'hourglass',
  '🪪':'id-card','🏷':'tag','📷':'camera','⎘':'copy','🙋':'hand','🚚':'truck','🔬':'microscope',
  '📜':'scroll-text','👋':'hand','ℹ':'info'
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
// Back-compat alias — the WS42 spec refers to this helper as lucideIconHtml();
// keep both names pointing at the same implementation so either call-site works.
window.lucideIconHtml = window.emojiIcon;

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

// ── v14 C1 — ONE nav registry ─────────────────────────────────────────────
// Single source of truth for the desktop sidebar (getSidebarItems, app.js) and
// the mobile bottom nav (buildBottomNav/_primaryNavItems, app.js). Ported
// mechanically from the pre-C1 getSidebarItems() branches and the 5 hand-rolled
// *_BOTTOM_NAV arrays below — same items, same order, same per-role/per-variant
// gating, just declared once instead of drifting in two places (the exact
// failure mode that dropped Chat/Cash-Advance from the desktop sidebar before).
//
// Shape:
//   predicates      — named boolean checks an item can reference via `when`
//                      (kept as functions, evaluated live, so the registry
//                      itself stays plain data — no runtime state baked in).
//   sidebarUniversal— items every sidebar variant gets first (Dashboard, Chat).
//   sidebar[variant]— ordered items after the universal prefix. `deptLoop:true`
//                      is a placeholder the renderer expands into the signed-in
//                      user's OWN department items (from window.DEPARTMENTS +
//                      currentDepts) — that block is inherently per-user data,
//                      not static nav config, so it stays generated in app.js
//                      exactly as it always has; the registry only marks WHERE
//                      it goes.
//   bottom[variant] — the 5 mobile bottom-nav variants, each already complete
//                      (unlike sidebar there was never a shared prefix to
//                      factor out — every *_BOTTOM_NAV array today lists Home
//                      itself, at a genuinely different relative spot each time).
// variant is one of: 'admin' | 'genericPartner' | 'partnerBS' | 'bsOnly' | 'staff'
// (mirrors the exact if/else-if order both getSidebarItems and the old
// _primaryNavItems already checked in).
window.NAV_REGISTRY = {
  predicates: {
    isPresident:        () => typeof isPresident === 'function' && isPresident(),
    hasProductionDept:  () => (window.currentDepts||[]).includes('Production'),
    hasProjectsDept:    () => (window.currentDepts||[]).some(d => ['Sales','Production','Finance'].includes(d)) || window.currentRole === 'finance',
    hasSalesOrdersDept: () => (window.currentDepts||[]).includes('Finance') || window.currentRole === 'finance',
    isFinanceRole:      () => window.currentRole === 'finance'
  },

  sidebarUniversal: [
    { key:'dashboard', icon:'home',            label:'Dashboard', page:'dashboard' },
    { key:'chat',       icon:'message-circle', label:'Chat',      page:'chat'      }
  ],

  sidebar: {
    // ── Admin / President Command Center (president, manager, secretary) ──
    admin: [
      { key:'analytics',    icon:'bar-chart-2',  label:'Analytics',        page:'analytics' },
      { key:'tasks',        icon:'check-square', label:'Tasks',            page:'tasks' },
      { key:'posts',        icon:'megaphone',    label:'Posts',            page:'posts' },
      { key:'company',      icon:'building-2',   label:'Company',          page:'company' },
      { key:'departments',  icon:'layout-grid',  label:'All Departments',  page:'departments' },
      { key:'approvals',    icon:'shield-check', label:'Approvals',        page:'approvals', section:true },
      { key:'progress',     icon:'trending-up',  label:'Progress Reports', page:'progress' },
      { key:'team',         icon:'users',        label:'Team Directory',   page:'team-directory', section:true },
      { key:'hr',           icon:'user-cog',     label:'HR',               page:'dept:HR' },
      { key:'attendance',   icon:'calendar',     label:'Attendance',       page:'attendance' },
      { key:'files-hub',    icon:'folder-open',  label:'Files',            page:'files-hub' },
      { key:'inventory',    icon:'boxes',        label:'Inventory',        page:'inventory', section:true, sectionLabel:'Operations' },
      { key:'projects',     icon:'trending-up',  label:'Projects',         page:'projects-lifecycle' },
      { key:'sales-orders', icon:'receipt',      label:'Sales Orders',     page:'sales-orders' },
      { key:'product-db',   icon:'package',      label:'Product Database', page:'product-database', section:true, sectionLabel:'Catalog', when:'isPresident' },
      { key:'audit-log',    icon:'scroll-text',  label:'Audit Log',        page:'audit-log',       section:true, sectionLabel:'Security', when:'isPresident' },
      { key:'sys-health',   icon:'activity',     label:'System Health',    page:'system-health', when:'isPresident' }
    ],
    // ── Generic external partner (any company) ──
    genericPartner: [
      { key:'projects', icon:'briefcase',    label:'My Projects',   page:'partner-projects' },
      { key:'tasks',    icon:'check-square', label:'My Tasks',      page:'tasks' },
      { key:'posts',    icon:'megaphone',    label:'Posts',         page:'posts' },
      { key:'qb',       icon:'calculator',   label:'Quote Builder', page:'bs-quote-builder', section:true, sectionLabel:'Work Tools' },
      { key:'quotes',   icon:'file-text',    label:'Quotations',    page:'bs-quotations' },
      { key:'team',     icon:'users',        label:'Team',          page:'team-directory', section:true, sectionLabel:'Directory' },
      { key:'files',    icon:'folder',       label:'Files',         page:'files' }
    ],
    // ── External Partner role (Brilliant Steel) ──
    partnerBS: [
      { key:'tasks',    icon:'check-square', label:'My Tasks',      page:'tasks' },
      { key:'posts',    icon:'megaphone',    label:'Posts',         page:'posts' },
      { key:'projects', icon:'briefcase',    label:'My Projects',   page:'partner-projects' },
      { key:'qb',       icon:'calculator',   label:'Quote Builder', page:'bs-quote-builder', section:true, sectionLabel:'Work Tools' },
      { key:'quotes',   icon:'file-text',    label:'Quotations',    page:'bs-quotations' },
      { key:'clients',  icon:'book-open',    label:'Client Data',   page:'bs-clients' },
      { key:'team',     icon:'users',        label:'Team',          page:'team-directory', section:true, sectionLabel:'Directory' },
      { key:'files',    icon:'folder',       label:'Files',         page:'files' }
    ],
    // ── Partner — Brilliant Steel (ISOLATED, single-dept non-partner user) ──
    bsOnly: [
      { key:'projects', icon:'briefcase',  label:'My Projects',   page:'partner-projects' },
      { key:'qb',       icon:'calculator', label:'Quote Builder', page:'bs-quote-builder' },
      { key:'quotes',   icon:'file-text',  label:'Quotations',    page:'bs-quotations' },
      { key:'clients',  icon:'book-open',  label:'Client Data',   page:'bs-clients' },
      { key:'files',    icon:'folder',     label:'Files',         page:'bs-files' }
    ],
    // ── Employee / Agent / Finance ──
    staff: [
      { key:'tasks',    icon:'check-square', label:'My Tasks',      page:'tasks' },
      { key:'posts',    icon:'megaphone',    label:'Posts',         page:'posts' },
      { key:'cash',     icon:'banknote',     label:'Cash Advance',  page:'cash-advances' },
      { key:'company',  icon:'building-2',   label:'Company',       page:'company' },
      { deptLoop:true },
      { key:'team',        icon:'users',       label:'Team',         page:'team-directory', section:true, sectionLabel:'Management' },
      { key:'attendance',  icon:'calendar',    label:'Attendance',   page:'attendance' },
      { key:'files',       icon:'folder',      label:'Files',        page:'files' },
      { key:'inventory',   icon:'boxes',       label:'Inventory',    page:'inventory', when:'hasProductionDept' },
      { key:'projects',    icon:'trending-up', label:'Projects',     page:'projects-lifecycle', when:'hasProjectsDept' },
      { key:'sales-orders',icon:'receipt',     label:'Sales Orders', page:'sales-orders', when:'hasSalesOrdersDept' },
      { key:'sys-health',  icon:'activity',    label:'System Health',page:'system-health', when:'isFinanceRole' }
    ]
  },

  bottom: {
    // Bottom Nav — Admin / President
    admin: [
      { icon:'home',           label:'Home',    page:'dashboard'       },
      { icon:'check-square',   label:'Tasks',   page:'tasks'           },
      { icon:'megaphone',      label:'Posts',   page:'posts'           },
      { icon:'message-circle', label:'Chat',    page:'chat'            },
      { icon:'users',          label:'Team',    page:'team-directory'  },
      { icon:'shield-check',   label:'Approve', page:'approvals'       },
      { icon:'circle-user',    label:'Profile', page:'my-profile'      }
    ],
    // Bottom Nav — Generic Partner (any company)
    genericPartner: [
      { icon:'home',           label:'Home',     page:'dashboard'        },
      { icon:'briefcase',      label:'Projects', page:'partner-projects' },
      { icon:'message-circle', label:'Chat',     page:'chat'             },
      { icon:'calculator',     label:'Quotes',   page:'bs-quote-builder' },
      { icon:'check-square',   label:'Tasks',    page:'tasks'            },
      { icon:'circle-user',    label:'Profile',  page:'my-profile'       }
    ],
    // Bottom Nav — External Partner (Brilliant Steel)
    partnerBS: [
      { icon:'home',           label:'Home',     page:'dashboard'        },
      { icon:'briefcase',      label:'Projects', page:'partner-projects' },
      { icon:'message-circle', label:'Chat',     page:'chat'             },
      { icon:'calculator',     label:'Quotes',   page:'bs-quote-builder' },
      { icon:'file-text',      label:'Summary',  page:'bs-quotations'    },
      { icon:'circle-user',    label:'Profile',  page:'my-profile'       }
    ],
    // Bottom Nav — Partner (Brilliant Steel, isolated)
    bsOnly: [
      { icon:'home',           label:'Home',     page:'dashboard'        },
      { icon:'briefcase',      label:'Projects', page:'partner-projects' },
      { icon:'message-circle', label:'Chat',     page:'chat'             },
      { icon:'calculator',     label:'Quotes',   page:'bs-quote-builder' },
      { icon:'file-text',      label:'Summary',  page:'bs-quotations'    },
      { icon:'book-open',      label:'Clients',  page:'bs-clients'       },
      { icon:'circle-user',    label:'Profile',  page:'my-profile'       }
    ],
    // Bottom Nav — Employee
    staff: [
      { icon:'home',           label:'Home',    page:'dashboard'      },
      { icon:'check-square',   label:'Tasks',   page:'tasks'          },
      { icon:'megaphone',      label:'Posts',   page:'posts'          },
      { icon:'message-circle', label:'Chat',    page:'chat'           },
      { icon:'banknote',       label:'Cash',    page:'cash-advances'  },
      { icon:'circle-user',    label:'Profile', page:'my-profile'     }
    ],
    // Bottom Nav — Type-B (Production, weekly self-service worker; js/app.js
    // isTypeBWorker()/_navVariant()). Deliberately minimal: their "Home"
    // (js/screens/worker.js renderWorkerHome) already IS the whole
    // dashboard — Time In/Out, attendance calendar, finance/payslips, month
    // & YTD summary all in one screen — so there's nothing to duplicate a
    // Tasks/Posts/Cash tab for. 3 items, well under the 5-tab/More-tab
    // threshold (_bottomNavSplit, js/app.js).
    workerB: [
      { icon:'home',           label:'Home',    page:'dashboard'   },
      { icon:'message-circle', label:'Chat',    page:'chat'        },
      { icon:'circle-user',    label:'Profile', page:'my-profile'  }
    ]
  }
};

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
  // Negative cache: brief backoff for keys whose fetch just failed (e.g.
  // permission-denied), so a hot key isn't re-hit on every render/navigation.
  // Never cached permanently — entries expire after FAIL_TTL and are cleared
  // as soon as a fetch for that key succeeds or the key is explicitly invalidated.
  const _failStore = {};
  const FAIL_TTL = 4000;
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
    // Still within the post-failure backoff window — reject immediately
    // instead of re-hitting Firestore for a key that just errored.
    const fail = _failStore[key];
    if (fail && Date.now() - fail.ts < FAIL_TTL) throw fail.err;
    const promise = fetcher().then(data => {
      _store[key] = { data, ts: Date.now(), pending: null };
      delete _failStore[key];
      return data;
    }).catch(err => {
      delete _store[key];
      _failStore[key] = { ts: Date.now(), err };
      throw err;
    });
    _store[key] = { data: null, ts: 0, pending: promise };
    return promise;
  };
  // Aliases + sub-key prefixes cleared when a base collection key is invalidated.
  const _alias = {
    'ledger':   { prefixes: ['ledger:', 'ledger>=', 'ledger<='] },  // period-scoped + since/through-scoped reads (v12 WS39 Balance Sheet cumulative-to-date read)
    'expenses': { alsoKeys: ['expenses-pending', 'expenses-recent'] },
    // Defensive cascade for CashAdvance.planFor's bulk reads (v14 perf pass) —
    // NOT required for correctness (both keys are cached with ttlMs:0, so they
    // never serve stale data time-wise regardless), but every existing CA
    // mutation already calls dbCacheInvalidate('ca-pending'), so piggybacking
    // here keeps the in-memory store tidy without a new call site.
    'ca-pending': { alsoKeys: ['ca-approved-all'], prefixes: ['ca-deduct-requests-'] },
  };
  window.dbCacheInvalidate = function(key) {
    if (!key) {
      Object.keys(_store).forEach(k => delete _store[k]);
      Object.keys(_failStore).forEach(k => delete _failStore[k]);
      return;
    }
    delete _store[key];
    delete _failStore[key];
    const a = _alias[key];
    if (a) {
      (a.alsoKeys || []).forEach(k => { delete _store[k]; delete _failStore[k]; });
      (a.prefixes || []).forEach(pfx => Object.keys(_store).forEach(k => { if (k.indexOf(pfx) === 0) delete _store[k]; }));
      (a.prefixes || []).forEach(pfx => Object.keys(_failStore).forEach(k => { if (k.indexOf(pfx) === 0) delete _failStore[k]; }));
    }
  };
})();

// ── Canonical quote-outcome + client-name-key helpers (v12 WS32) ─────────
// THE one won/lost definition (decision 8). Retires: Analytics 'accepted'-only
// win-rate calc, and the client modal's 'filed'/'approved'-as-won calc.
// 'accepted' kept for legacy `quotes` docs only.
window.isQuoteWon  = q => !!(q && (q.salesOrderId || q.status === 'won' || q.status === 'accepted'));
// isQuoteWon short-circuits true on salesOrderId regardless of status, so a doc
// with BOTH salesOrderId and status:'rejected' would otherwise satisfy isQuoteLost
// too (double-counted in win-rate). Excluding isQuoteWon(q) here keeps won/lost
// mutually exclusive; isQuoteOpen's own won/lost exclusion is unaffected.
window.isQuoteLost = q => !!(q && q.status === 'rejected' && !window.isQuoteWon(q));
window.isQuoteOpen = q => !!q && !window.isQuoteWon(q) && !window.isQuoteLost(q);
// THE one client-name normalizer — every join and dedupe uses this, nothing else.
window.clientNameKey = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// ── Lead-source vocabulary (v12 WS34) — mirrors the BS quote-number codes ──
window.LEAD_SOURCES = [
  { code:'FB', label:'Facebook'   }, { code:'IG', label:'Instagram' },
  { code:'TK', label:'TikTok'     }, { code:'WB', label:'Website'   },
  { code:'VB', label:'Viber'      }, { code:'EM', label:'Email'     },
  { code:'OF', label:'In-Office'  }, { code:'RF', label:'Referral'  },
  { code:'EX', label:'Exhibition' },
];
window.leadSourceLabel = code =>
  (window.LEAD_SOURCES.find(s => s.code === code) || {}).label || code || '—';

// ── Canonical quote status/approvalStatus WRITE pairs (v12 WS31) ─────────
// Both fields are kept for reader compatibility; every write site sets them
// TOGETHER via this table so they can never drift again (the roa-chip bug was
// enabled by independent, partial writes). Read-side truth stays
// isQuoteWon/isQuoteLost/isQuoteOpen (WS32) — do not branch on raw strings.
window.quoteStateFields = function (state) {
  return ({
    filed:            { status:'filed',            approvalStatus:'filed'          },
    pending_approval: { status:'pending_approval', approvalStatus:'pending_review' },
    approved:         { status:'filed',            approvalStatus:'approved'       },
    needs_revision:   { status:'needs_revision',   approvalStatus:'needs_revision' },
    rejected:         { status:'rejected',         approvalStatus:'rejected'       },
  })[state] || { status: state, approvalStatus: state };
};
window.QUOTE_STALE_DAYS = 14;   // "filed but no Sales Order" badge threshold (WS31 decision 13)

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
// Bounded general_journal reader — symmetric with ledgerForPeriod (v12 WS39).
// general_journal has no active writer today (legacy/orphaned collection, read-only)
// but renderFinancialReports still merges it in, so it needs the same date-range
// bound as the ledger read to fix the same "silently truncates an older period"
// compliance risk.
window.gjForPeriod = function(periodKey) {
  const p = Period.parse(periodKey);
  if (p.type === 'all')
    return dbCachedGet('gj', () => db.collection('general_journal').get().catch(() => ({docs:[]})), 45000);
  return dbCachedGet('gj:' + p.key,
    () => db.collection('general_journal').where('date','>=',p.start).where('date','<=',p.end)
            .get().catch(() => ({docs:[]})), 45000);
};

// ── Bank accounts registry (v12 WS36) ──────────────────────────────────────
// Balances are DERIVED (opening anchor + tagged ledger flows) — never stored.
// Field family: bankAccountId/bankAccountName/bankFlow — NEVER 'account'/
// 'accountType' (those are WS13 chart-of-accounts fields on every ledger row).
window.BankAccounts = {
  async list({ activeOnly = true } = {}) {
    // Static-ish config (nickname/id/active-flag registry, NOT live balances —
    // those are always derived from the ledger, never stored here), and every
    // write path already calls BankAccounts.invalidate() explicitly, so a
    // longer TTL only widens the window for a miss on that invalidation call
    // (e.g. a concurrent tab) — bumped from 60s to 5min, unlike money/live-
    // status collections which keep short TTLs.
    const snap = await dbCachedGet('bank_accounts',
      () => db.collection('bank_accounts').get().catch(() => ({ docs: [] })), 300000);
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (a.sortOrder||0)-(b.sortOrder||0) || (a.nickname||'').localeCompare(b.nickname||''));
    return activeOnly ? all.filter(a => a.active !== false) : all;
  },
  invalidate() { if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('bank_accounts'); },
  label(a) {                                   // 'BDO Checking — Main (•••• 7890)' — masked, safe for lists
    if (!a) return '';
    const tail = (a.accountNo||'').replace(/\D/g,'').slice(-4);
    return (a.nickname || a.bankName || '') + (tail ? ` (•••• ${tail})` : '');
  },
  async optionsHTML(selectedId) {              // <option> set for pickers; preselects selectedId, else isDefault
    const list = await this.list();
    const def = selectedId || (list.find(a => a.isDefault) || {}).id || '';
    return ['<option value="">— no account —</option>']
      .concat(list.map(a => `<option value="${escHtml(a.id)}" ${a.id===def?'selected':''}>${escHtml(this.label(a))}</option>`))
      .join('');
  },
  async pick(id) {                             // picked id → the write-ready pair (null-safe)
    if (!id) return { bankAccountId: null, bankAccountName: null };
    const a = (await this.list({ activeOnly: false })).find(x => x.id === id);
    return { bankAccountId: id, bankAccountName: a ? this.label(a) : null };
  },
  tag(acct, flow) {                            // spread into a ledger write; {} when untagged (keys OMITTED, not null)
    return (acct && acct.bankAccountId)
      ? { bankAccountId: acct.bankAccountId, bankAccountName: acct.bankAccountName || null, bankFlow: flow }
      : {};
  },
  // DERIVED balances (decision 2). rows = ledger doc datas. Pure — no reads.
  computeBalances(accounts, rows, { reconciledOnly = false, asOf = null } = {}) {
    const out = {};
    accounts.forEach(a => { out[a.id] = { account: a, balance: +(a.openingBalance||0), in: 0, out: 0 }; });
    rows.forEach(r => {
      if (!r || !r.bankAccountId || !out[r.bankAccountId]) return;
      const acc = out[r.bankAccountId].account;
      if (r.date && acc.openingDate && r.date < acc.openingDate) return;  // pre-anchor rows excluded
      if (asOf && r.date && r.date > asOf) return;
      if (reconciledOnly && !r.reconciled) return;
      const amt = +(r.amount||0);
      if (r.bankFlow === 'in')  { out[r.bankAccountId].balance += amt; out[r.bankAccountId].in  += amt; }
      if (r.bankFlow === 'out') { out[r.bankAccountId].balance -= amt; out[r.bankAccountId].out += amt; }
    });
    return out;
  },
  // WS40 reads THIS (see handoff note above).
  async cashPosition() {
    const [accounts, snap] = await Promise.all([ this.list(), window.ledgerForPeriod('all') ]);
    const per = this.computeBalances(accounts, snap.docs.map(d => d.data()));
    return { total: Object.values(per).reduce((s,x) => s + x.balance, 0), perAccount: per };
  }
};

// ── Shared metric helpers (v12 WS40) — the single win-rate/AR/turns/payroll-
// ratio computation. KPI cards AND the Insights engine read from these so a
// number and the sentence describing it can never silently disagree.
window.quoteWinStats = function(quotes){
  const won  = quotes.filter(window.isQuoteWon), lost = quotes.filter(window.isQuoteLost),
        open = quotes.filter(window.isQuoteOpen);
  const val = q => q.total || q.grandTotal || 0;
  return { won, lost, open, wonCount: won.length, lostCount: lost.length,
    winRate: (won.length+lost.length) ? Math.round(won.length/(won.length+lost.length)*100) : null,
    wonVal: won.reduce((s,q)=>s+val(q),0), pipelineVal: open.reduce((s,q)=>s+val(q),0) };
};
window.bidWinStats = function(bids){       // Government — ALWAYS labeled "(Government)"
  const won = bids.filter(b=>b.status==='won'), lost = bids.filter(b=>b.status==='lost');
  return { wonCount: won.length, lostCount: lost.length,
    winRate: (won.length+lost.length) ? Math.round(won.length/(won.length+lost.length)*100) : null };
};
// WS40 decision 5, corrected per the RE-GROUNDED pass: real call sites round
// and null-out (not the DECIDED spec's unrounded-float/0 version, which would
// change displayed values). Denominators are NOT unified across call sites —
// Overview passes revMTD, Finance tab passes finInP — only the formula/rounding
// is shared.
window.payrollRatio = function(totalPayroll, revenue){
  return revenue > 0 ? Math.round(totalPayroll / revenue * 100) : null;
};
// ONE aging engine. Anchor = earliest invoices[].due, else project createdAt
// (today's Finance-Dashboard proxy IS the fallback). projects = Projects.normalize shapes.
window.arAging = function(projects, asOf){
  asOf = asOf || window.bizDate();
  const asOfT = new Date(asOf + 'T12:00:00').getTime();
  const days = ymd => Math.floor((asOfT - new Date(ymd + 'T12:00:00').getTime()) / 86400000);
  const toYmd = ts => { const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
    return (d && !isNaN(d)) ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` : null; };
  const out = { cur:0, d3160:0, d6190:0, d90:0, total:0, topDebtor:null };
  const perClient = {};
  (projects||[]).forEach(p => {
    const bal = +(p.arBalance || 0); if (bal <= 0) return;
    let anchor = null;
    (p.invoices||[]).forEach(inv => { if (inv && inv.due && (!anchor || inv.due < anchor)) anchor = inv.due; });
    if (!anchor) anchor = toYmd(p.createdAt);
    const d = anchor ? days(anchor) : 0;
    out[d > 90 ? 'd90' : d > 60 ? 'd6190' : d > 30 ? 'd3160' : 'cur'] += bal;
    out.total += bal;
    const nm = p.clientName || p.name || '—';
    perClient[nm] = (perClient[nm] || 0) + bal;
  });
  const top = Object.entries(perClient).sort((a,b)=>b[1]-a[1])[0];
  if (top) out.topDebtor = { name: top[0], amount: top[1] };
  return out;
};
// WS29 decision-12 formula — the canonical turns metric. ledgerRows must come from a
// date-range-bounded read (ledgerSince) covering [asOf-windowDays, asOf]; NEVER .limit(N).
window.inventoryTurns = function(ledgerRows, items, windowDays){
  windowDays = windowDays || 365;
  const end = window.bizDate();
  const s = new Date(end + 'T12:00:00'); s.setDate(s.getDate() - windowDays);
  const start = `${s.getFullYear()}-${String(s.getMonth()+1).padStart(2,'0')}-${String(s.getDate()).padStart(2,'0')}`;
  const cos = (ledgerRows||[]).reduce((sum,r)=> sum + ((r && r.accountType==='expense'
    && r.category==='COS – Direct Material' && r.date>=start && r.date<=end) ? +(r.amount||0) : 0), 0);
  const annualizedCOGS = cos * (365/windowDays);
  const invValue = (items||[]).reduce((sum,it)=> sum + (Number(it.qty)||0)*(Number(it.unitCost)||0), 0);
  const turns = (invValue > 0 && annualizedCOGS > 0) ? annualizedCOGS/invValue : null;
  return { turns, daysOnHand: turns ? Math.round(365/turns) : null, annualizedCOGS, invValue };
};

// ── Analytics conclusions engine (v12 WS40) ─────────────────────────
// ‼️ Every threshold below is a PLACEHOLDER for Neil to tune — see the Flags
// for Neil in fable-workplan/40-analytics.md. They gate SENTENCES only, never
// a displayed money number.
window.ANALYTICS_POLICY = {
  ar90SharePct: 25,        // warn when 90+ bucket ≥ this % of total AR…
  arMinAlert: 50000,       // …AND ≥ this ₱ amount (both, to avoid noise on tiny AR)
  winRateDropPts: 10,      // percentage-POINT drop vs previous period
  minOutcomes: 3,          // min (won+lost) in BOTH periods before win-rate rules speak
  payrollRatioWarnPct: 35, // payroll as % of period revenue
  onTimeWarnPct: 80,       // production on-time task completion floor
  minProdDone: 3,          // min completed tasks before the on-time rule speaks
  cashFloor: 100000,       // ₱ — cash-position floor (only fires post-WS36)
  turnsSlowBelow: 2,       // turns/yr — slow-stock advisory (only fires post-WS29)
  maxInsights: 6           // Overview card cap (Strategy tab shows all)
};
// Pure rule engine: rules read ONLY the metrics bag M (renderAnalytics's buildMetrics())
// + POLICY. No fetches, no Date.now() — 'as of' semantics live in M. Output: ordered
// insight objects, worst severity first.
window.Insights = {
  _esc(s){ return (window.escHtml || (x=>x))(s); },
  rules: [
    function netNegative(M, P){ if (M.netP >= 0) return null;
      return { id:'net-negative', severity:'bad', icon:'📉',
        text:`Expenses exceeded income by ₱${fmt(-M.netP)} ${M.periodLabel ? 'in '+M.periodLabel : 'this period'}.`,
        action:'Review the Finance tab expense breakdown for the biggest categories.' }; },
    function ar90(M, P){ const a = M.aging; if (!a || !a.total) return null;
      const pct = Math.round(a.d90 / a.total * 100);
      if (a.d90 < P.arMinAlert || pct < P.ar90SharePct) return null;
      const top = a.topDebtor ? ` Largest balance: ${window.Insights._esc(a.topDebtor.name)} (₱${fmt(a.topDebtor.amount)}).` : '';
      return { id:'ar-90', severity:'bad', icon:'📥',
        text:`₱${fmt(a.d90)} (${pct}%) of receivables are over 90 days old.${top}`,
        action:'Prioritize collection calls on the 90+ day bucket.' }; },
    function arLargest(M, P){ const a = M.aging; if (!a || !a.total) return null;
      const buckets = [['d90','90+ days'],['d6190','61–90 days'],['d3160','31–60 days'],['cur','0–30 days']];
      const [k, label] = buckets.reduce((m,b)=> a[b[0]] > a[m[0]] ? b : m);
      if (k === 'cur' || k === 'd90') return null;   // d90 already covered; current AR needs no chase note
      return { id:'ar-largest', severity:'info', icon:'📬',
        text:`The largest receivables bucket is ${label} (₱${fmt(a[k])} of ₱${fmt(a.total)}).`,
        action:'Chase this bucket before it ages into 90+.' }; },
    function winRateDrop(M, P){ const q = M.q, p = M.qPrev;
      if (!q || !p || q.winRate == null || p.winRate == null) return null;
      if (q.wonCount + q.lostCount < P.minOutcomes || p.wonCount + p.lostCount < P.minOutcomes) return null;
      if (p.winRate - q.winRate < P.winRateDropPts) return null;
      return { id:'win-rate-drop', severity:'warn', icon:'📊',
        text:`Quote win rate fell from ${p.winRate}% to ${q.winRate}% vs the previous period.`,
        action:'Review pricing and quote follow-ups on the Sales tab.' }; },
    function payrollHigh(M, P){ if (!(M.revP > 0) || M.payrollRatio <= P.payrollRatioWarnPct) return null;
      return { id:'payroll-ratio', severity:'warn', icon:'💼',
        text:`Payroll is ${Math.round(M.payrollRatio)}% of period revenue (watch level: ${P.payrollRatioWarnPct}%).`,
        action:'Compare headcount cost against the revenue trend before adding staff.' }; },
    function onTimeLow(M, P){ if (M.prodDoneCount + M.prodOverdueCount < P.minProdDone) return null;
      if (M.onTimeRate >= P.onTimeWarnPct) return null;
      return { id:'on-time', severity:'warn', icon:'🏭',
        text:`Production on-time task completion is ${Math.round(M.onTimeRate)}% (${M.prodOverdueCount} overdue).`,
        action:'Rebalance due dates or assignments on the overdue production tasks.' }; },
    function followUps(M, P){ if (!M.dueFu) return null;
      return { id:'follow-ups', severity:'info', icon:'📞',
        text:`${M.dueFu} client follow-up${M.dueFu===1?' is':'s are'} due.`,
        action:'Open the Client Relations hub and log contact or reschedule.' }; },
    function cashLow(M, P){ if (!M.cash || M.cash.total >= P.cashFloor) return null;
      return { id:'cash-floor', severity:'bad', icon:'🏦',
        text:`Cash position ₱${fmt(M.cash.total)} is below the ₱${fmt(P.cashFloor)} floor.`,
        action:'Check the balance schedule and 90+ receivables for collectible cash.' }; },
    function turnsSlow(M, P){ if (!M.turns || M.turns.turns == null || M.turns.turns >= P.turnsSlowBelow) return null;
      return { id:'turns-slow', severity:'info', icon:'📦',
        text:`Inventory turns ${M.turns.turns.toFixed(1)}×/yr (~${M.turns.daysOnHand} days on hand) — stock is slow-moving.`,
        action:'Review slow items in Inventory before the next bulk purchase.' }; }
  ],
  compute(M, P){
    P = P || window.ANALYTICS_POLICY;
    const out = this.rules.map(r => { try { return r(M, P); } catch(_) { return null; } }).filter(Boolean);
    if (!out.some(i => i.severity === 'bad' || i.severity === 'warn'))
      out.push({ id:'all-clear', severity:'good', icon:'✅',
        text:'No red flags this period — cash flow positive, receivables current, win rate steady.',
        action:'' });
    const rank = { bad:0, warn:1, info:2, good:3 };
    return out.sort((a,b) => rank[a.severity] - rank[b.severity]);
  }
};

// Ported from quote-builder-v2.html:1821-1878 (that file is iframe-isolated by
// design — math re-derived here, not imported). Returns the POST-DP schedule.
window.buildBalanceSchedule = function(contract, dpAmount, balMode, interestRate, invoiceDate, completionDate) {
  const bal = Math.max(0, (+contract||0) - (+dpAmount||0));
  if (bal <= 0) return [];
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const addDays   = (s,n) => { const d = new Date(s+'T12:00:00'); d.setDate(d.getDate()+n);   return iso(d); };
  const addMonths = (s,n) => { const d = new Date(s+'T12:00:00'); d.setMonth(d.getMonth()+n); return iso(d); };
  if (balMode === 'lump')
    return [{ seq:1, label:'Balance — due upon completion', dueDate: completionDate||null, amount:+bal.toFixed(2) }];
  if (/^stagger[345]$/.test(balMode)) {
    const n = +balMode.replace('stagger',''), per = +(bal/n).toFixed(2), out = [];
    const span = (invoiceDate && completionDate)
      ? Math.max(0, Math.round((new Date(completionDate+'T12:00:00') - new Date(invoiceDate+'T12:00:00'))/86400000)) : 0;
    for (let i=1;i<=n;i++) out.push({ seq:i, label:`Progress payment ${i} of ${n}`,
      dueDate: span ? addDays(invoiceDate, Math.round(span*i/n)) : null,
      amount: i===n ? +(bal - per*(n-1)).toFixed(2) : per });          // last row absorbs rounding
    return out;
  }
  if (/^install(3|6|9|12)$/.test(balMode)) {
    const m = +balMode.replace('install',''), r = (+interestRate||0)/100/12;
    const monthly = r > 0 ? bal*r/(1-Math.pow(1+r,-m)) : bal/m, out = [];
    for (let i=1;i<=m;i++) out.push({ seq:i,
      label:`Installment ${i} of ${m}${r>0?` (@ ${interestRate}% p.a.)`:''}`,
      dueDate: invoiceDate ? addMonths(invoiceDate, i) : null, amount:+monthly.toFixed(2) });
    return out;
  }
  return [{ seq:1, label:'Balance', dueDate:null, amount:+bal.toFixed(2) }];
};

// ── Chart.js on demand (WS16 D8) ──
window.ensureChart = function() {
  if (window.Chart) return Promise.resolve();
  if (window._chartLoading) return window._chartLoading;
  window._chartLoading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    // SRI (v13 Phase 30) — pin the exact pinned-version file's hash so a
    // compromised/altered CDN response is refused instead of silently executed.
    s.integrity = 'sha384-e6nUZLBkQ86NJ6TVVKAeSaK8jWa3NhkYWZFomE39AvDbQWeie9PlQqM3pmYW5d1g';
    s.crossOrigin = 'anonymous';
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
//   `icon` is TRUSTED (developer-authored constant) and rendered RAW so it may hold
//   Lucide markup from emojiIcon(); `label` is always escaped. Never pass user content
//   as `icon` — put it in `label`.
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
      (it.icon ? it.icon + ' ' : '') + esc(it.label) + pill + '</button>';
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
//
// v14 Batch1 1c — optional 3rd param `el`: the surface's own root element.
// When passed, push()/replaceTop() give it a dynamic inline z-index so open
// order determines stacking (a modal opened from a pushed page renders above
// it, etc.) instead of the static CSS --z-modal/--z-page-panel tokens racing
// each other. Reserved range for this dynamic tier: 300–398 (see the --z-*
// scale comment in styles.css for the full token list; that file is Batch 2's
// — this comment is the interim reference). Dialogs stay on --z-dialog (5000)
// and are NOT part of this dynamic tier — always pass no `el` for 'dialog'.
window.Overlay = {
  _stack: [], _seq: 0, _closing: false,
  isOpen(){ return this._stack.length > 0; },
  push(kind, teardown, el){
    const id = ++this._seq;
    this._stack.push({ id, kind, teardown, el: el || null });
    if (el) { try { el.style.zIndex = String(300 + this._stack.length * 2); } catch(_){} }
    const base = { page: window.currentPage || 'dashboard', subtab: window.currentSubtab || null };
    try { history.pushState({ t:'overlay', kind, oid:id, base, d:(window._navDepth||0) }, '', location.hash); } catch(_){}
    if (typeof window.devCheckStacking === 'function') { try { window.devCheckStacking(); } catch(_){} }
    this._sync();                                              // ← mobile window model (see _sync)
    return id;
  },
  // Swap the top entry's kind/teardown/el WITHOUT touching history — used by
  // modal-over-modal (openModal) and opts.replace (openPage) so "one Back"
  // still closes the (now-different) surface. Re-applies the same z the top
  // slot already had (stack depth is unchanged by a swap).
  //
  // ── The discarded-teardown leak, and why the fix is CONDITIONAL ───────────
  // Overwriting `top.teardown` throws the previous closure away. Whether that
  // is a leak depends ENTIRELY on whether the caller already hand-rolled the
  // equivalent cleanup, and the two live callers do:
  //
  //   • openModal's modal-over-modal branch (js/app.js:3074-3075) only replaces
  //     when topKind()==='modal', reuses the ONE static #modal-overlay node, and
  //     has ALREADY re-shown it (js/app.js:3058-3059) by the time it calls us.
  //     Running the old teardown here would do `ov.classList.add('hidden')` on
  //     the modal that was just opened — it would blank the screen.
  //   • openPage's opts.replace branch (js/app.js:3111-3119) has already popped
  //     _pageStack, called prevTop._onClose(), detached the focus trap and
  //     removed the node. Running the old teardown here would fire _onClose a
  //     SECOND time — and onClose is not always idempotent: the payslip page
  //     wires `onClose: () => { _fitCleanup(); backFn(); }` (js/screens/hr.js:3666)
  //     and re-opens itself with {replace:true} (js/screens/hr.js:3884), so a
  //     double-fire would run its navigate-back callback twice.
  //
  // So an UNCONDITIONAL `top.teardown()` here is a regression on both live
  // paths. The genuinely orphaned case is the CROSS-KIND clobber: openPage's
  // doReplace test reads window._pageStack (js/app.js:3107-3108) and never
  // checks what is actually on top of THIS stack (unlike openModal, which
  // guards on topKind()==='modal'). A deep-linked conversation switch while a
  // chat image lightbox is open (js/chat.js:1051 vs js/chat.js:3985) therefore
  // overwrites the lightbox entry, and its teardown — the only thing that
  // removes the lightbox element and its keydown listener — is never called.
  // That element then sits in the DOM, above everything, forever.
  //
  // Discriminator: a caller that replaces a DIFFERENT kind than it is pushing
  // did not know what it was clobbering, so it cannot have cleaned it up.
  // `kind === top.kind` → today's exact behaviour (zero change for both live
  // callers); `kind !== top.kind` → run the orphaned teardown. Fields are
  // swapped FIRST so a teardown that reads Overlay sees the new truth, and it
  // is wrapped in try/catch + `_closing` exactly like _popOne's.
  replaceTop(kind, teardown, el){
    if (!this._stack.length) return this.push(kind, teardown, el);
    const top = this._stack[this._stack.length - 1];
    const orphan = (top.kind !== kind) ? top.teardown : null;
    top.kind = kind; top.teardown = teardown; top.el = el || null;
    if (el) { try { el.style.zIndex = String(300 + this._stack.length * 2); } catch(_){} }
    if (orphan) { this._closing = true; try { orphan(); } catch(_){} this._closing = false; }
    if (typeof window.devCheckStacking === 'function') { try { window.devCheckStacking(); } catch(_){} }
    this._sync();                                              // ← mobile window model (see _sync)
    return top.id;
  },
  topEl(){ const top = this._stack[this._stack.length - 1]; return top ? top.el : null; },
  topKind(){ const top = this._stack[this._stack.length - 1]; return top ? top.kind : null; },
  dismissTop(){ if (this._stack.length) history.back(); },   // → popstate → _popOne
  _popOne(){
    const top = this._stack.pop(); if (!top) return;
    if (navigator.maxTouchPoints > 0) window.haptic && window.haptic('light'); // v14 G2 — swipe/back dismiss, touch only
    this._closing = true; try { top.teardown(); } catch(_){} this._closing = false;
    this._sync();                                              // ← mobile window model (see _sync)
  },
  clearAll(){
    if (!this._stack.length) return;
    const n = this._stack.length;
    while (this._stack.length){ const o = this._stack.pop(); try { o.teardown(); } catch(_){} }
    // v14 hotfix (iOS): history.go(-n) here RACED navigateTo's immediate
    // pushState — on iOS the async rewind landed after the push and its stale
    // popstate yanked navigation back to the old page (every More-sheet/
    // drawer tap "did nothing"). Instead: leave the stale overlay entries in
    // history and tell navigateTo to ABSORB the top one via replaceState.
    // Remaining stale entries are harmless — the popstate handler already
    // maps t:'overlay' entries to their base page on future Back presses.
    this._pendingRewind = (this._pendingRewind || 0) + n;
    this._sync();                                              // ← mobile window model (see _sync)
  },

  // ── Mobile window model (2026-08) — derived scroll-lock + occlusion ────────
  // On the phone shell an open window must (a) stop the document behind it from
  // scrolling and (b) hide the app chrome it covers. BOTH states are DERIVED
  // from _stack here, at the four (and only four) places that mutate it —
  // push / replaceTop / _popOne / clearAll — instead of being acquired and
  // released by the feature code that opens each surface.
  //
  // WHY derived and not a caller-side acquire/release pair (this is the whole
  // point — do not "simplify" it back):
  //   • replaceTop DISCARDS the previous entry's teardown on the same-kind path
  //     (by design — see the comment above it), so a release living in that
  //     teardown would never run. Every openPage({replace:true}) and every
  //     modal-over-modal would permanently increment the refcount and the lock
  //     would survive forever, leaving the app unscrollable.
  //   • openModal can push a SECOND 'modal' entry pointing at the SAME static
  //     #modal-overlay node (js/app.js:3074-3078), so push-counting counts one
  //     visible surface twice.
  //   • clearAll pops and tears down in a tight loop, and dismissTop() is
  //     ASYNC (history.back() → popstate), so a popstate can land after the
  //     stack is already empty (recon 4.3(3)).
  // A pure function of _stack, reconciled against what is currently applied, is
  // immune to all three: whatever path got us here, the state matches the stack.
  //
  // Kind sets:
  //   _LOCK_KINDS  — surfaces that own the phone viewport's scroll: pages,
  //     modals (a modal IS a full-screen page at phone width), dialogs (opaque
  //     at ≤639px, and promptDialog reliably raises the keyboard — iOS
  //     auto-scrolls the DOCUMENT to a focused input unless the document cannot
  //     scroll), the chat lightbox (fixed, inset:0), and qb-fullscreen.
  //
  //     'qb-fullscreen' was the ONE lock _sync did not own: enterQbFullscreen /
  //     exitQbFullscreen (js/app.js) acquired and released ScrollLock by hand,
  //     so NOTHING reconciled it on a breakpoint crossing. iPhone portrait
  //     (393px) → open the Quote Builder → rotate to landscape (852px): the
  //     body.qb-fullscreen CSS stops matching so the chrome comes back, but the
  //     body was still position:fixed;overflow:hidden — the page clipped to one
  //     390px-tall viewport with no way to scroll out of it. It already pushes a
  //     real Overlay entry (js/app.js, enterQbFullscreen), so listing it here is
  //     the entire fix: _sync sees it like every other kind, and the hand-rolled
  //     acquire/release pair in app.js is gone. It is NOT a cover kind — the
  //     quote-builder CSS hides the chrome itself, and body.page-open on top of
  //     that would also blank the iframe's own container.
  //   _COVER_KINDS — the SUBSET that drives body.page-open (the CSS hides
  //     topbar / top-nav-strip / bottom-nav / main-content). Dialogs and the
  //     lightbox are deliberately NOT here: a bare confirm() over the dashboard
  //     is a centred box at 640-768px, and blanking the whole shell behind it
  //     would look broken.
  //
  //     'modal' is in the set only BELOW 640px, and that is why this is a live
  //     getter and not a constant. It is the same argument as the dialog one
  //     above: a modal is a full-cover opaque page only at ≤639px
  //     (css/styles.css §"WS42 Phase 10 — mobile bottom sheet refinement" —
  //     .modal-overlay goes opaque, .modal-box goes position:fixed/full-height).
  //     In the 640-768px band it is still the ≤768px bottom sheet
  //     (max-height:92dvh over a translucent scrim), so ~8% of the screen above
  //     it is a dimmed view of the page — and body.page-open turned exactly that
  //     strip flat blank. On an iPad mini in portrait (744px) every modal made
  //     the app read as wiped. Evaluated per call so a rotation across 640px
  //     is picked up (the matchMedia reconcile below listens on BOTH queries).
  //     Exposed as a GETTER, not a method, so js/app.js's _syncMainInert — which
  //     reads Overlay._COVER_KINDS as an array to drive #main-content's `inert`
  //     from the same predicate — keeps working untouched and can never disagree
  //     with this pass.
  //
  //   Because COVER ⊆ LOCK and both are computed in the same pass, page-open can
  //   never be on while the scroll is unlocked.
  // Deliberately excluded from both:
  //   'sidebar'       — already carries body.sidebar-open{overflow:hidden}
  //                     (css/styles.css:1214); a second mechanism would fight it.
  //   'drawer'        — a bottom sheet, not a full cover; unchanged behaviour.
  //   'push-prompt'   — a small toast-like card.
  _LOCK_KINDS:  ['page', 'modal', 'dialog', 'lightbox', 'qb-fullscreen'],
  get _COVER_KINDS() { return this._fullCoverModalTier() ? ['page', 'modal'] : ['page']; },
  // ≤639px is where .modal-box becomes a full-cover opaque page. Same fallback
  // shape as isPhoneShell() for engines that throw on matchMedia.
  _fullCoverModalTier() {
    try { return window.matchMedia('(max-width: 639px)').matches; }
    catch (_) { return (window.innerWidth || 0) <= 639; }
  },
  _lockHeld: false, _coverOn: false,
  _sync(){
    // Everything below is a no-op above 768px: `phone` is false, so both wants
    // are false, and the first _sync on a desktop boot finds both flags already
    // false and touches nothing.
    const phone = !!(window.isPhoneShell && window.isPhoneShell());
    const st = this._stack;
    const cover = this._COVER_KINDS;                 // live getter — read ONCE per pass
    const wantLock  = phone && st.some(e => this._LOCK_KINDS.indexOf(e.kind) !== -1);
    const wantCover = phone && st.some(e => cover.indexOf(e.kind) !== -1);
    const SL = window.ScrollLock;
    if (SL) {
      // Self-heal: ScrollLock._reset() (session boundary) drops the lock behind
      // our back, so also re-acquire when we THINK we hold one but don't.
      if (wantLock && (!this._lockHeld || !SL.isLocked())) { this._lockHeld = true; try { SL.acquire(); } catch(_){} }
      else if (!wantLock && this._lockHeld)                { this._lockHeld = false; try { SL.release(); } catch(_){} }
    }
    if (wantCover !== this._coverOn) {
      this._coverOn = wantCover;
      try { document.body.classList.toggle('page-open', wantCover); } catch(_){}
    }
  }
};

// ── Mobile window model (2026-08) — shared primitives ─────────────────────
// Three globals consumed by css/styles.css, js/app.js and js/chat.js. They are
// defined HERE because config.js is the earliest script in index.html's defer
// chain that everything else can depend on (firebase-config → config → drive →
// notifications → departments → app → modules), so every later consumer can
// assume they exist. Consumers still guard with `window.X &&` so no file hard-
// depends on load order.
//
// isPhoneShell: THE phone-tier check for the window model. 768px is the mobile
// shell breakpoint (top-nav-strip / bottom-nav / sidebar collapse, and
// body.qb-fullscreen); chat's old one-off 640px check is retired. Everything
// below is inert above 768px — nothing acquires, nothing is classed.
window.isPhoneShell = function () {
  try { return window.matchMedia('(max-width: 768px)').matches; }
  catch (_) { return (window.innerWidth || 0) <= 768; }
};

// ── ViewportSync — the single owner of the visual-viewport CSS variables ────
// Publishes on <html>, on every device (the vars are harmless on desktop —
// nothing reads them there):
//   --vvh     visualViewport.height  — height of the VISIBLE area
//   --vv-top  visualViewport.offsetTop — how far iOS panned the layout viewport
//             to reveal a focused input (0 at rest)
//   --kb-h    innerHeight - vv.height - vv.offsetTop, clamped at 0 — the soft
//             keyboard's height; 0 when it is closed
//
// WHY: position:fixed resolves against the LAYOUT viewport. The iOS keyboard
// never shrinks that viewport — it overlays it and PANS it to reveal the caret.
// So a `fixed; inset:0` panel keeps its full pre-keyboard height and its footer
// sits underneath the keyboard. Anchoring a panel to the VISUAL rect
// (top: var(--vv-top); height: var(--vvh)) is the only geometry the keyboard
// cannot break, and --kb-h lets a composer pad itself instead of guessing.
//
// WHY SO MANY LISTENERS: whether iOS reports the keyboard pan as a visualViewport
// 'resize', a visualViewport 'scroll' (a pure pan changes offsetTop with no
// resize — the old chat handler missed exactly this), or a document 'scroll',
// is UNMEASURED on the target device (iPhone, installed to the home screen).
// Binding all of them makes the fix independent of that unknown instead of
// resting on an assumption; the write is rAF-coalesced and change-gated, so the
// extra signals cost nothing. focusin/focusout additionally schedule re-syncs at
// +250ms and +700ms because iOS standalone is known to swallow vv events around
// keyboard show/hide (the keyboard animation outlives the event).
window.ViewportSync = window.ViewportSync || (function () {
  var raf = 0;
  var last = { vvh: '', top: '', kb: '' };          // write-only-on-change
  function set(de, name, val, key) {
    if (last[key] === val) return;
    last[key] = val;
    try { de.style.setProperty(name, val); } catch (_) {}
  }
  function apply() {
    raf = 0;
    var de = document.documentElement;
    if (!de) return;
    var vv = window.visualViewport;
    var ih = window.innerHeight || 0;
    var h, t;
    if (vv) { h = vv.height; t = vv.offsetTop || 0; }
    else    { h = ih;        t = 0; }               // no visualViewport → assume no keyboard
    var kbRaw = Math.max(0, Math.round(ih - h - t));
    // A soft keyboard is never SMALL. iPhone keyboards are ~260-340pt; even a
    // compact/floating one clears 150. So a shortfall of a few dozen px is not
    // a keyboard — it is iOS reporting a visual viewport slightly shorter than
    // the layout viewport with nothing presented. Honouring that verbatim made
    // `height: var(--vvh)` leave a dead band of exactly that size UNDER the
    // window: owner-reported twice as "there's a space below" in a chat thread,
    // measured at ~60 CSS px beneath the composer with no keyboard on screen.
    // Below the threshold we treat it as no keyboard and let the window fill
    // the viewport, which is what "no keyboard" should always mean. Above it,
    // vv.height is tracked verbatim — real keyboard geometry is unchanged, and
    // that is the part the whole visual-viewport anchoring exists to get right.
    var KB_MIN_PX = 90;
    var kb = kbRaw >= KB_MIN_PX ? kbRaw : 0;
    if (!kb) h = Math.max(h, ih - t);
    set(de, '--vvh',    Math.round(h) + 'px', 'vvh');
    set(de, '--vv-top', Math.round(t) + 'px', 'top');
    set(de, '--kb-h',   kb + 'px',            'kb');
    // `kb-open` on <html> is what lets the CSS stop deriving a window's BOTTOM
    // edge from the visual viewport when there is no keyboard to track.
    //
    // Clamping --vvh above was not enough, and the reason is worth recording:
    // it clamps against window.innerHeight, so if the layout viewport ALSO
    // reads short, max() of two short numbers is still short. The owner
    // reported the resulting dead band under the chat composer three times,
    // and a light-theme screenshot proved it was page-painted background (it
    // followed the theme), i.e. the panel genuinely was not reaching the
    // bottom of a viewport that extended past it.
    //
    // With no keyboard presented, a window's bottom edge should not be a
    // measurement at all — it should just be the bottom of the viewport. So
    // the CSS pins `bottom: 0` at rest and only switches to the measured
    // `height: var(--vvh)` while this class is present. That is immune to
    // whatever visualViewport reports at rest, on any engine, forever.
    // The threshold is shared with `kb` above deliberately: the class and the
    // var must never disagree about whether a keyboard is up.
    try { de.classList.toggle('kb-open', kb > 0); } catch (_) {}
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(apply); }
  var vv = window.visualViewport;
  if (vv) {
    vv.addEventListener('resize', schedule, { passive: true });
    vv.addEventListener('scroll', schedule, { passive: true });
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  ['focusin', 'focusout'].forEach(function (t) {
    window.addEventListener(t, function () {
      schedule();
      setTimeout(schedule, 250);
      setTimeout(schedule, 700);
    }, { passive: true });
  });
  apply();                                          // publish before first paint
  return { refresh: schedule };
})();

// ── ScrollLock — refcounted, iOS-proof body scroll lock ────────────────────
// NEVER called by feature code, with exactly one exception: withUnlocked(),
// which print/capture code wraps around html2canvas and window.print(). The only
// caller of acquire()/release() is Overlay._sync(), which derives the desired
// state from the overlay stack — including qb-fullscreen, which used to
// acquire/release by hand (see _LOCK_KINDS). Refcounted so stacked windows
// neither double-lock nor early-unlock; the exact scroll offset is restored on
// the final release.
//
// WHY position:fixed and not overflow:hidden — `overflow:hidden` on body does
// propagate to the viewport (that is how body.sidebar-open works today), but it
// does NOT stop iOS from auto-scrolling the document to a focused input, which
// is the failure this exists to kill.
//
// HARD CONSTRAINTS baked into the implementation below — read before touching:
//   • NEVER put transform / filter / perspective / backdrop-filter /
//     will-change:transform / contain:paint|layout|strict|content /
//     container-type / translate / rotate / scale on <body>. Any one of them
//     makes body the containing block for EVERY position:fixed descendant at
//     once — and ~24 of this app's surfaces (topbar, top-nav-strip, bottom-nav,
//     sidebar, page panels, modals, dialogs, drawers, toasts, splash, PTR
//     indicator, the gesture pill…) are direct fixed children of body. The
//     inset:0 ones would resize to body's full document height. `position:fixed`
//     on body itself is safe: it does not create a containing block for fixed
//     descendants.
//   • left/right/width are MANDATORY, not hardening. An out-of-flow box with
//     left/right/width:auto is shrink-to-fit; measured against this exact
//     html/body cascade, body collapsed 375px → ~30px under
//     `position:fixed; top:-Ypx` alone.
//   • html{scroll-behavior:smooth} (css/styles.css:70) would ANIMATE the
//     restore, so scroll-behavior is forced to 'auto' across the scrollTo and
//     put back afterwards.
window.ScrollLock = window.ScrollLock || {
  _n: 0,                       // refcount
  _y: 0,                       // scrollY captured at the 0→1 transition
  _gen: 0,                     // lock generation — bumped on every fresh 0→1
                               // acquire AND by _reset(); see withUnlocked
  _restoreSet: false,          // have we forced history.scrollRestoration?
  _prevRestore: null,          // …and what it was before we forced it
  _uDepth: 0,                  // withUnlocked reentrancy depth
  _uUnlocked: false,           // did a withUnlocked actually drop a LIVE lock?
  _uY: 0,                      // offset to re-apply when the last one exits
  _uGen: 0,                    // _gen at the instant of that unlock
  isLocked() { return this._n > 0; },
  depth()    { return this._n; },

  acquire() {
    if (++this._n > 1) return;                      // already locked — just count
    this._gen++;                                    // a NEW lock: see withUnlocked
    this._apply(window.scrollY || window.pageYOffset || 0);
  },
  release() {
    if (this._n === 0) return;                      // unbalanced release — ignore
    if (--this._n > 0) return;                      // still held by someone else
    this._restore(true);
    this._unforceScrollRestoration();               // fully released → hand history back to the UA
  },

  // Fully unlock for the duration of fn(), then re-lock at the SAME offset,
  // regardless of how deep the refcount is. For code that genuinely needs a
  // scrollable document — html2canvas derives its capture window from live
  // window scroll offsets and clones body's inline style into an offscreen
  // iframe, and window.print() paginates from the document flow. The refcount
  // is untouched (so callers' own release() calls stay balanced, and _reset()
  // and Overlay._sync() keep working normally across the await). Restores in a
  // finally so a throwing fn cannot strand the app unlocked.
  //
  // ── WHY the finally cannot simply trust its entry-time snapshot ────────────
  // fn() is a 1-3s html2canvas capture of an A4 at scale 2, and the world is
  // fully live for that whole window. The naive `if (held) this._apply(y)` had
  // two ways to re-freeze a body that nobody can ever unfreeze again, because
  // _apply() writes position:fixed directly while _n is 0 and Overlay._lockHeld
  // is false — there is no refcount left to release and _sync's self-heal only
  // ever ADDS a lock:
  //   1. The lock legitimately went away during fn(). Payslip open (_n=1,
  //      _y=640) → tap "Save as JPEG" → tap Back mid-capture → _popOne → _sync →
  //      release() → _n=0, body unlocked. The capture resolves and the finally
  //      re-applies top:-640px over a page with no window open. It also happens
  //      with NO user action at all: auto-logout / force-logout call
  //      ScrollLock._reset() (js/app.js resetSessionOverlays), so the capture
  //      re-freezes the LOGIN SCREEN, shifted off-screen, until a hard reload.
  //   2. Two captures overlap. The payslip header offers "Save as JPEG" and
  //      "Print / Save PDF" side by side and each disables only ITSELF
  //      (js/screens/hr.js), so tapping both is a two-tap gesture, not a race
  //      you have to engineer. Both computed held=true; whichever finished first
  //      re-locked the body while the other capture was still measuring — under
  //      exactly the lock this wrapper exists to eliminate, handing an employee a
  //      blank or half-height payslip.
  // So the re-lock is guarded by THREE conditions, all required:
  //   • _uDepth back to 0 — the last overlapping caller is the one that re-locks
  //     (unlock happens on 0→1, re-apply on 1→0, decremented in a finally so a
  //     throw inside fn() cannot leak depth).
  //   • _gen unchanged since the unlock — _reset() and every fresh 0→1 acquire
  //     bump it, so a capture whose world was torn down (or whose lock was
  //     released and then re-taken at a DIFFERENT offset, which _apply(_uY) would
  //     clobber) never re-applies.
  //   • _n > 0 — the lock is still genuinely wanted right now.
  // The unlock side is symmetric: whoever gets here first and finds a live lock
  // performs it (normally the outermost call; a later one only ever qualifies if
  // the lock was taken AFTER the outer call started, in which case the body
  // really is fixed again and this capture would otherwise measure a frozen
  // document).
  async withUnlocked(fn) {
    this._uDepth++;
    if (this._n > 0 && !this._uUnlocked) {
      this._uUnlocked = true;
      this._uGen = this._gen;
      this._uY   = this._y;
      this._restore(true);
    }
    try {
      return await fn();
    } finally {
      if (--this._uDepth <= 0) {
        this._uDepth = 0;                           // clamp: never go negative
        const relock = this._uUnlocked && this._gen === this._uGen && this._n > 0;
        const y = this._uY;
        this._uUnlocked = false;
        if (relock) this._apply(y);                 // re-apply at the SAME y, not a re-read
      }
    }
  },

  // Emergency full unlock — session boundary (logout / force-logout), where the
  // stack is being torn down wholesale and any remaining refcount is garbage.
  // Deliberately does NOT restore the scroll offset: the document it belonged
  // to is being replaced by the login screen, and top is the right place to be.
  // Overlay._sync() self-heals its own bookkeeping afterwards.
  _reset() {
    this._n = 0;
    this._gen++;                                    // invalidate any in-flight withUnlocked…
    this._uUnlocked = false;                        // …and the re-lock it was holding
    this._restore(false);
    this._unforceScrollRestoration();
  },

  // ── internals ──

  // history.scrollRestoration defaults to 'auto', which snapshots scroll AT
  // pushState TIME — and every overlay open is a pushState. Under the lock that
  // snapshot is 0, and the UA re-applies it on the Back that triggers our
  // unlock, racing the manual restore in the same frame. Forced lazily, on the
  // 0→1 lock: that way it can only ever be set on the phone shell (nothing above
  // 768px acquires) and desktop history behaviour is untouched.
  //
  // It IS reverted now, on the full release (refcount 0). Leaving it 'manual'
  // for the rest of the session was a real regression: navigateTo does not
  // scroll to top, so ordinary in-app Back relied on the UA's 'auto' restore.
  // Open+close ONE task detail and, for the rest of the session, Dashboard →
  // Tasks → scroll → Finance → Back landed on Tasks at offset 0. It survived
  // rotating back above 768px, because nothing ever put it back.
  //
  // Reverting does NOT re-open the race the original comment feared. Per spec a
  // pushState entry inherits the CURRENT entry's scroll-restoration mode, and
  // Overlay.push() pushes BEFORE _sync() acquires — so the base entry is always
  // navigated away from while the document is still scrollable and unforced, and
  // the UA records its true offset. The entries created while locked (overlay on
  // overlay) inherit 'manual' from the overlay entry that acquire() forced, so
  // the UA still never fights our manual restore on the way back down the stack.
  //
  // The withUnlocked() temporary release must NOT flap this: it calls _restore()/
  // _apply() directly and never touches the refcount, so the force/unforce pair
  // lives in acquire()/_apply and release()/_reset() only — never in _restore().
  _forceScrollRestoration() {
    if (this._restoreSet) return;
    this._restoreSet = true;
    try {
      if ('scrollRestoration' in history) {
        this._prevRestore = history.scrollRestoration;   // usually 'auto'
        history.scrollRestoration = 'manual';
      }
    } catch (_) {}
  },
  _unforceScrollRestoration() {
    if (!this._restoreSet) return;
    this._restoreSet = false;
    const prev = this._prevRestore;
    this._prevRestore = null;
    if (!prev) return;                               // never captured → nothing to put back
    try { if ('scrollRestoration' in history) history.scrollRestoration = prev; } catch (_) {}
  },

  _apply(y) {
    this._y = y || 0;
    this._forceScrollRestoration();
    const b = document.body;
    if (!b) return;
    b.style.position = 'fixed';
    b.style.top      = (-this._y) + 'px';
    b.style.left     = '0';
    b.style.right    = '0';
    b.style.width    = '100%';
    b.style.overflow = 'hidden';
  },
  _restore(restoreScroll) {
    const b = document.body;
    if (b) {
      b.style.position = '';
      b.style.top      = '';
      b.style.left     = '';
      b.style.right    = '';
      b.style.width    = '';
      b.style.overflow = '';
    }
    if (!restoreScroll) return;
    const de = document.documentElement;
    const prev = de ? de.style.scrollBehavior : '';
    if (de) de.style.scrollBehavior = 'auto';        // beat html{scroll-behavior:smooth}
    try { window.scrollTo(0, this._y); } catch (_) {}
    if (de) de.style.scrollBehavior = prev;
  }
};

// Crossing the phone breakpoint (an iPad rotating, a desktop window being
// dragged narrow) changes what isPhoneShell() answers while a window is already
// open — reconcile so a lock taken on the phone tier is released on the way up,
// and re-taken on the way back down. Fires only on the crossing, not on resize.
//
// BOTH queries matter, and they are not the same crossing:
//   768px — the lock/cover tier itself (isPhoneShell).
//   639px — whether 'modal' is a cover kind (Overlay._COVER_KINDS is a live
//           getter over this width; see its comment). A device that rotates
//           600px → 700px crosses 639 WITHOUT crossing 768, and body.page-open
//           would otherwise stay on over a 640-768px bottom-sheet modal — the
//           exact blank-shell defect the getter exists to prevent.
// _sync is idempotent (it reconciles against _lockHeld/_coverOn), so on a phone
// rotation that crosses both, the two firings cost one extra no-op pass.
(function () {
  try {
    const onChange = function () { if (window.Overlay && window.Overlay._sync) window.Overlay._sync(); };
    ['(max-width: 768px)', '(max-width: 639px)'].forEach(function (q) {
      const mq = window.matchMedia(q);
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);        // older WebKit
    });
  } catch (_) {}
})();

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
    ov.querySelector('[data-act=ok]').onclick     = () => { if (opts.danger) window.haptic && window.haptic('success'); window.Overlay.dismissTop(); done(true); }; // v14 G2 — danger-confirm tap
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

// ── Double-click guard for money-writing buttons (v13 Phase 103) ───────────
// Disables btn synchronously (before any await), swaps its label to
// 'Working…' (icon-only buttons keep their icon), runs fn(), and always
// restores the label + re-enables in finally. Rethrows fn's errors.
window.busy = async function(btn, fn){
  if (!btn) return fn();
  const orig = btn.innerHTML;
  const hasIcon = btn.querySelector && btn.querySelector('i,svg');
  btn.disabled = true;
  if (!hasIcon) btn.textContent = 'Working…';
  try {
    return await fn();
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
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
  asset:     ['Cash', 'Accounts Receivable', 'Inventory', 'Advances to Employees'],
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
  // v12 WS36 — bank-accounts blast-radius retrofit (A/R & A/P settlement legs,
  // cash-advance release). Safety fallback; rows always carry accountType too.
  'Cash Advance':'asset', 'A/R Collection':'asset', 'A/P Settlement':'liability',
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

// ── Theme-aware chart chrome (v12 WS40) ─────────────────────────────
// cssVar: promoted verbatim from Notifs.showToast's proven local closure
// (notifications.js:508-512). Reads a CSS custom property off <html> live,
// so it tracks THEMES switches including the 'auto' matchMedia flip.
window.cssVar = function(name, fallback){
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch(_) { return fallback; }
};
// Dataset palette — TODAY'S exact hexes, single source (WS40 decision 12). Not theme-reactive.
window.CHART_COLORS = { good:'#30D158', bad:'#FF453A', neutral:'#0A84FF', warn:'#FF9F0A',
  muted:'#636366', accent:'#9BA8FF', goodAlt:'#34C759', warnAlt:'#FFAA00',
  goodA:'#30D15822', neutralA:'#0A84FF22' };
// One call per chart-bearing render — chrome colors resolved against the LIVE theme.
window.chartTheme = function(){
  return { text: window.cssVar('--text-muted', '#ebebf5bb'),
           grid: window.cssVar('--border',     '#ffffff18'),
           ...window.CHART_COLORS };
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
      '<input type="month" class="pc-month" max="' + curMonth + '" value="' + customVal + '" style="padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)"/>' +
      '<span style="font-size:11px;color:var(--text-muted)">or</span>' +
      '<select class="pc-quarter" style="padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)">' +
        '<option value="">Quarter…</option>' +
        [1,2,3,4].map(function(q){ return '<option value="' + q + '">Q' + q + '</option>'; }).join('') +
      '</select>' +
      '<select class="pc-year" style="padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)">' +
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
    // 2026-08-03 owner ruling: the NEILBARRO STEEL & METAL sole prop DOES NOT
    // EXIST — every document identity is now Barro Kitchens / Barro Industries
    // OPC. dtiName kept as an alias of the doc name for legacy readers; the
    // old TIN belonged to the dead entity and MUST NOT print under the new
    // name — blank until the accountant supplies the OPC TIN (D6).
    dtiName:         'BARRO KITCHENS — By Barro Industries OPC',
    dtiTin:          '',
    address:         'Metro Manila',
    addressShort:    'Metro Manila',
    phone:           '09276836300',
    email:           'barroindustries@gmail.com',
    signatory:       { name: 'NEIL BARRO', title: 'President, Barro Industries OPC' }
  },

  logo: {
    // 2026-08-03 owner ruling (BK-cube rollout): in-app splash/login/topbar
    // chrome should show the same BK cube as everything else. NOTE — nothing
    // in the codebase currently reads BRAND.logo.wordmark (index.html's
    // splash/login/topbar <img> tags hardcode their own src and are NOT owned
    // by this file); this value is kept as the documented intent for whoever
    // next edits those three <img> tags, not a live wire-up. ‼️ FLAG — index.html
    // is out of this pass's edit scope; the actual <img src> swap is pending.
    wordmark:  'icons/barro-kitchens.png',
    print:     'icons/barro-kitchens.png',   // print-document header logo — BK cube logo (owner-supplied 2026-08-03)
    pwaIcon:   'icons/icon-192.png',         // PWA/apple-touch
    pushBadge: 'icons/icon-192.png'          // FCM badge (retires icons/barro-logo.png)
  },

  // Per-company sub-brands. Field shape is IDENTICAL to quote-builder-v2.html's
  // local CO object (that iframe keeps its OWN copy for isolation — see comment there).
  // CO.PT (generic partner) is runtime-synthesized inside the iframe from URL params
  // and is NOT mirrored here.
  companies: {
    BK: { name:'BARRO KITCHENS',
      sub:'By Barro Industries OPC',
      addr:'Metro Manila', contact:'09276836300  |  barroindustries@gmail.com',
      sig:{name:'NEIL BARRO',title:'President, Barro Industries OPC'}, code:'BK',
      thanks:'Thank you for considering Barro Kitchens. We look forward to building a kitchen you can rely on for years.',
      creds:'Barro Industries OPC  •  SEC Registered  •  barroindustries@gmail.com  •  09276836300  •  Metro Manila' },
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
    name: L.dtiName, registration: 'BIR registration pending accountant confirmation (D6)',
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
  // userId/userName/employeeId/private are optional overrides used by the
  // president's "record CA for employee" admin flow (modules.js) — self-service
  // employee requests never pass them and behave exactly as before.
  async request({ amount, terms, reason, dateNeeded, userId, userName, employeeId, private: isPrivate }) {
    const amt = parseFloat(amount)||0;
    const isAdminIssued = !!userId;
    // Re-audit 2026-08-03 (HIGH) — the admin-issued path intentionally skips
    // the ₱100 minimum (`!isAdminIssued &&` below), but had NO independent
    // floor: `parseFloat('-500')` is -500, which is truthy, so `!amt` passed
    // it straight through with a negative amount, negative balance:0 default,
    // status:'pending' — then CashAdvance.approve()'s compound-interest math
    // would compute a negative totalPayable/monthlyPayment once approved.
    if (!(amt > 0)) throw new Error('Enter a valid amount (must be greater than ₱0).');
    if (!isAdminIssued && amt < 100)             throw new Error('Enter a valid amount (min ₱100).');
    if (!isAdminIssued && amt > 50000)          throw new Error('Maximum cash advance is ₱50,000.');
    const t    = parseInt(terms)||1;
    const uid  = userId || (window.currentUser && window.currentUser.uid);
    const name = userName || (window.userProfile && window.userProfile.displayName) || (window.currentUser && window.currentUser.email) || '';
    const docData = {
      userId: uid, userName: name,
      employeeId: employeeId || (window.userProfile && window.userProfile.employeeId) || uid,
      amount: amt, terms: t,
      // Interest/monthly/total are finalized at approval (v12 WS22 decision 3) —
      // the employee no longer picks whether interest applies.
      interest: 0, interestCharged: false, monthlyPayment: null, totalPayable: null,
      balance: 0, status: 'pending', payments: [],
      date: dateNeeded || (window.bizDate ? window.bizDate() : today()),
      reason: (reason||'').trim(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (typeof isPrivate !== 'undefined') docData.private = isPrivate;
    const ref = await db.collection('cash_advances').add(docData);
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ca-pending');
    // Admin-issued records are approved immediately by the same actor — the
    // "requests approval" owner ping only makes sense for self-service requests.
    if (!isAdminIssued) await Notifs.sendToOwner({ title:'Cash Advance Request', body:`${name} requests ₱${fmt(amt)} (${t}-month plan).`, icon:'💸', type:'cash_advance' });
    return ref.id;
  },

  // v14 Batch6/5-leftover — openPage, not openModal: this is a substantial form
  // (4 fields), matching the sibling openPresidentCashAdvanceModal (modules.js)
  // which already made this switch. SAME signature/body/footer; openPage takes
  // identical args and closeModal() (== Overlay.dismissTop()) still closes it.
  openRequestForm() {
    openPage('Request Cash Advance', `
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
        <textarea id="ca-req-reason" rows="3" placeholder="e.g., Medical emergency, school fees…" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);resize:vertical"></textarea>
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
  async approve(id, { interestPct = null, bankAccount = null } = {}) {
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
      // Round monthlyPayment FIRST, then derive totalPayable from the rounded
      // monthly so sum-of-installments === totalPayable exactly (no centavo drift).
      const monthly      = _caRound2(total / terms);
      const totalPayable = _caRound2(monthly * terms);
      const uid     = window.currentUser && window.currentUser.uid;
      t.update(ref, {
        status: 'approved', interest: pct, interestCharged: pct > 0,
        totalPayable, monthlyPayment: monthly, balance: totalPayable,
        bankAccountId: (bankAccount && bankAccount.bankAccountId) || null,
        bankAccountName: (bankAccount && bankAccount.bankAccountName) || null,
        approvedBy: uid, approvedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      result = { userId: cur.userId, amount: cur.amount, total: totalPayable, userName: cur.userName || '' };
    });
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ca-pending');
    if (result) {
      // v12 WS36 — mirror the cash release into the ledger (idempotent, keyed CA-<id>).
      // Best-effort: an approver without ledger-write rights (or a closed period —
      // ledgerPeriodOpen() is enforced server-side) must not break the approval itself.
      try {
        const lref = `CA-${id}`;
        const dupe = await db.collection('ledger').where('refNumber','==',lref).limit(1).get().catch(()=>({docs:[]}));
        if (!dupe.docs.length) {
          await db.collection('ledger').add({
            date: (window.bizDate ? window.bizDate() : today()), type:'debit',
            accountType:'asset', account:'Advances to Employees',
            description:`Cash advance released — ${result.userName}`,
            amount: result.amount, category:'Cash Advance', refNumber: lref, source:'Cash Advance',
            ...window.BankAccounts.tag(bankAccount, 'out'),
            addedBy: window.currentUser?.uid || null,
            addedByName: (window.userProfile && window.userProfile.displayName) || (window.currentUser && window.currentUser.email) || '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
        }
      } catch(e) { console.warn('[CA ledger]', e?.message || e); }
      await Notifs.send(result.userId, { title:'Cash Advance Approved', body:`Your ₱${fmt(result.amount)} cash advance was approved — repay ₱${fmt(result.total)}.`, icon:'💸', type:'cash_advance', dedupKey:`ca-approved-${id}` });
      window.logAudit && window.logAudit('approve','cash_advance', id, { total: result.total });
    }
    return result;
  },

  // v14 Batch6/5-leftover — openPage. Data (record + bank account options) is
  // fully fetched BEFORE the panel opens (same as before), so there's no
  // post-open async body-fill to retarget — a straight openModal→openPage swap.
  async openApproveModal(id, onDone) {
    const snap = await db.collection('cash_advances').doc(id).get();
    if (!snap.exists) { Notifs.showToast('Record no longer exists.','error'); if (onDone) onDone(); return; }
    const a = snap.data();
    const terms = a.terms || 1;
    const bankOpts = await window.BankAccounts.optionsHTML();
    openPage(`Approve Cash Advance — ${escHtml(a.userName||'Employee')}`, `
      <div class="ca-detail" style="margin-bottom:10px"><span>Principal</span><strong>₱${fmt(a.amount)}</strong></div>
      <div class="ca-detail" style="margin-bottom:10px"><span>Terms</span><span>${terms} month${terms>1?'s':''}</span></div>
      <div class="form-group"><label>Interest Rate (%/month)</label>
        <input id="ca-appr-rate" type="number" inputmode="decimal" min="0" step="0.5" value="${window.CashAdvance.RATE_DEFAULT}"/>
      </div>
      <div class="form-group"><label>Release from (company account)</label>
        <select id="ca-appr-bank" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${bankOpts}</select></div>
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
        const acct = await window.BankAccounts.pick(document.getElementById('ca-appr-bank').value);
        await window.CashAdvance.approve(id, { interestPct: pct, bankAccount: acct });
        closeModal();
        Notifs.showToast('Approved!');
      } catch (err) {
        Notifs.showToast(err.message || 'Could not approve.', 'error');
      }
      if (onDone) onDone();
    });
  },

  async reject(id, reason) {
    const ref = db.collection('cash_advances').doc(id);
    let a = null;
    await db.runTransaction(async t => {
      const fresh = await t.get(ref);
      if (!fresh.exists) throw new Error('Record no longer exists.');
      const cur = fresh.data();
      if (cur.status !== 'pending') throw new Error('This request is no longer pending.');
      const uid = window.currentUser && window.currentUser.uid;
      t.update(ref, {
        status: 'rejected', rejectedBy: uid, rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
        ...(reason ? { rejectReason: reason } : {})
      });
      a = cur;
    });
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ca-pending');
    await Notifs.send(a.userId, { title:'Cash Advance Rejected', body: reason ? `Your cash advance request was not approved: ${reason}` : 'Your cash advance request was not approved.', icon:'❌', type:'cash_advance', dedupKey:`ca-rejected-${id}` });
    window.logAudit && window.logAudit('reject','cash_advance', id, {});
  },

  // ── Payments (ALWAYS transactional — fixes the one unguarded record-payment site) ──
  async recordPayment(id, { amount, date, bankAccount = null }) {
    const paid = parseFloat(amount)||0;
    if (paid <= 0) throw new Error('Enter a payment amount greater than ₱0.');
    const ref     = db.collection('cash_advances').doc(id);
    const uid     = window.currentUser && window.currentUser.uid;
    const payDate = date || (window.bizDate ? window.bizDate() : today());
    // Stable id minted ONCE, shared by the stored payment record AND its ledger
    // ref, so a resync/backfill can reconstruct the exact ref and can never
    // double-post a repayment that already reached the ledger.
    const paymentId = db.collection('ledger').doc().id;
    let result = null;
    await db.runTransaction(async t => {
      const fresh = await t.get(ref);
      if (!fresh.exists) throw new Error('Record no longer exists.');
      const cur = fresh.data();
      if (cur.status !== 'approved' || (cur.balance||0) <= 0)
        throw new Error('This cash advance has no outstanding balance (already paid or not approved).');
      const newBal   = Math.max(0, (cur.balance||0) - paid);
      const payments = [...(cur.payments||[]), { amount: paid, date: payDate, recordedBy: uid, paymentId, source:'manual' }];
      t.update(ref, { balance: newBal, payments, status: newBal <= 0 ? 'paid' : 'approved', ...(newBal<=0?{paidAt:firebase.firestore.FieldValue.serverTimestamp()}:{}) });
      result = { newBal, userId: cur.userId, userName: cur.userName || '' };
    });
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ca-pending');
    if (result) {
      // Money-critical fix — mirror the repayment into the ledger so the
      // 'Advances to Employees' receivable actually goes DOWN on a manual
      // (non-payroll) payment. Previously recordPayment reduced only the CA
      // doc's balance and posted NOTHING to the ledger, so Reports/Dashboard
      // (which read the ledger only) kept the full receivable and never saw
      // the returning cash. Exact reverse of approve()'s debit+bank-'out': a
      // CREDIT to the SAME 'Advances to Employees' asset + a bank-'in' tag.
      // Same raw-add-with-dupe-check path approve() uses (so bankFlow is
      // written verbatim and, like the release leg, it stays out of
      // finance_rollup — a credit/asset row is ledgerKind 'asset', i.e. 0
      // income / 0 expense, so it never inflates reports). Best-effort: a
      // closed period or a non-finance actor's blocked write must never break
      // the CA payment record the transaction already committed.
      try {
        const lref = `CA-${id}-REPAY-${paymentId}`;
        const dupe = await db.collection('ledger').where('refNumber','==',lref).limit(1).get().catch(()=>({docs:[]}));
        if (!dupe.docs.length) {
          await db.collection('ledger').add({
            date: payDate, type:'credit',
            accountType:'asset', account:'Advances to Employees',
            description:`Cash advance repayment — ${result.userName||''}`.trim(),
            amount: paid, category:'Cash Advance', refNumber: lref, source:'Cash Advance',
            ...window.BankAccounts.tag(bankAccount, 'in'),
            addedBy: window.currentUser?.uid || null,
            addedByName: (window.userProfile && window.userProfile.displayName) || (window.currentUser && window.currentUser.email) || '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
        }
      } catch(e){ console.warn('[CA repay ledger]', e?.message || e); }
      const statusMsg = result.newBal <= 0 ? 'fully paid off 🎉' : `balance remaining: ₱${fmt(result.newBal)}`;
      await Notifs.send(result.userId, { title:'💳 Cash Advance Payment Recorded', body:`₱${fmt(paid)} payment was recorded. ${statusMsg}`, icon:'💳', type:'cash_advance' });
    }
    return result;
  },

  // v14 Batch6/5-leftover — openPage. Same pattern as openApproveModal: the
  // record fetch resolves BEFORE the panel opens, so the full body HTML is
  // already known at open time — no post-open #modal-body targeting needed.
  openPaymentModal(id, onDone) {
    db.collection('cash_advances').doc(id).get().then(async snap => {
      if (!snap.exists) { Notifs.showToast('Record no longer exists.','error'); if (onDone) onDone(); return; }
      const a = snap.data();
      // Bank picker so the repayment's ledger mirror can tag which company
      // account the cash landed in ('— no account —' is fine: the receivable
      // still gets credited, just without a bank-balance movement).
      const bankOpts = await window.BankAccounts.optionsHTML();
      openPage(`Record Payment${a.userName?` — ${escHtml(a.userName)}`:''}`, `
        <div class="ca-detail" style="margin-bottom:12px"><span>Balance:</span><strong>₱${fmt(a.balance||0)}</strong></div>
        <div class="form-group"><label>Amount Paid</label><input id="ca-pay-amt" type="number" inputmode="decimal" value="${a.monthlyPayment||a.balance||0}" min="0" max="${a.balance||0}"/></div>
        <div class="form-group"><label>Date</label><input id="ca-pay-date" type="date" value="${window.bizDate?window.bizDate():today()}"/></div>
        <div class="form-group"><label>Deposited to (company account)</label>
          <select id="ca-pay-bank" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${bankOpts}</select></div>
      `, `<button class="btn-primary" id="ca-pay-confirm-btn">Record</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('ca-pay-confirm-btn').addEventListener('click', async () => {
        try {
          const acct = await window.BankAccounts.pick(document.getElementById('ca-pay-bank').value);
          await window.CashAdvance.recordPayment(id, {
            amount: document.getElementById('ca-pay-amt').value,
            date:   document.getElementById('ca-pay-date').value,
            bankAccount: acct
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
  //
  // v14 perf pass — both callers (Payroll Compute in departments.js, the HR
  // Payroll table in hr.js) invoke planFor(uid, month) once per employee inside
  // a Promise.all, which used to fire N separate `where('userId','==',uid)`
  // queries against cash_advances/approval_requests. Both are now ONE
  // collection-wide query (status/type/month only, no userId) run through
  // dbCachedGet with ttlMs:0 — that gives pure IN-FLIGHT request coalescing
  // (concurrent calls for the same key share the one pending Firestore read;
  // see dbCachedGet's `entry.pending` short-circuit above) with ZERO
  // time-based caching: `Date.now() - entry.ts < 0` never holds, so every call
  // that lands after the shared fetch has already resolved starts a brand-new
  // live read. Net effect: N reads collapse to 1 for a concurrent Promise.all
  // batch (the actual hot path), while a single later/isolated call is exactly
  // as fresh as the old per-uid query — no staleness window is introduced.
  // Filtering by uid happens client-side after the fetch, which returns the
  // identical row set per uid (Firestore's cash_advances/approval_requests
  // read rules are per-document, not query-shaped, and both callers here run
  // in an isFinanceOrAdmin()/non-partner admin context that can already read
  // every row this widened query touches — see firestore.rules ~415, ~915).
  async planFor(uid, month) {
    const caAllSnap = await dbCachedGet('ca-approved-all',
      () => db.collection('cash_advances').where('status','==','approved').get().catch(()=>({docs:[]})), 0);
    const cas = caAllSnap.docs.map(d=>({id:d.id,...d.data()}))
      .filter(a => a.userId === uid && (a.balance||0) > 0)
      .sort((a,b) => (a.createdAt?.toMillis?.()||0) - (b.createdAt?.toMillis?.()||0)); // oldest-first
    const caBalance = _caRound2(cas.reduce((s,a)=>s+(a.balance||0),0));
    if (!cas.length) return { caBalance: 0, mode: 'full', caPlanned: 0, plan: [], source: 'none' };

    // Custom source, priority: approved approval_requests(ca_deduct) → legacy
    // payroll_ca_overrides (transition only) → default installment.
    let customAmount = null, source = 'installment';
    const reqAllSnap = await dbCachedGet('ca-deduct-requests-' + month,
      () => db.collection('approval_requests')
        .where('type','==','ca_deduct').where('month','==',month).where('status','==','approved')
        .get().catch(()=>({docs:[]})), 0);
    const mine = reqAllSnap.docs.filter(d => d.data().userId === uid);
    if (mine.length) { customAmount = mine[0].data().amount; source = 'custom-request'; }
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
      // Idempotency (payroll recall spec §D2 — fixes G4): a resumed
      // disbursePayRun re-runs this whole step (Resume Disburse on a stuck
      // 'disbursing' run, or a reopen→recompute→re-disburse of the SAME
      // month). If THIS month's payroll deduction already posted to this CA,
      // skip it — never deduct the same month twice. Correct both for
      // resume-after-crash (attempt 1 committed the batch -> attempt 2 skips
      // every CA for this month; attempt 1 crashed pre-commit -> nothing to
      // skip) and for the reopen/re-disburse case (the month key is the
      // identity, regardless of which attempt actually wrote it).
      if ((cur.payments || []).some(pm => pm.source === 'payroll' && pm.month === month)) continue;
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
