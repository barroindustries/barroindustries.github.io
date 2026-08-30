/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Extended Modules v1
   modules.js — shared cross-file helpers (escHtml, safeHttpUrl,
                PRESIDENT_UID, isRealPresident) + Inventory.

   As of Wave 7 Pass 7 (2026-08-03) the People screens this file used
   to hold (Posts, Team, Attendance, Cash Advance UI, Company Overview,
   Leave, Global Search, Files Hub, My Profile) moved verbatim to
   js/screens/people.js — see that file's header. What's left here is
   (a) helpers ~120+ call sites across every other JS file depend on by
   bare-global name, which MUST stay put, and (b) Inventory, which
   physically lived in the middle of the moved range but isn't a people
   screen (see the note where it starts, below, for why it didn't move
   either).
═══════════════════════════════════════════════════ */
'use strict';

// ── HTML escape — prevents XSS when inserting user content into innerHTML ──
function escHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── URL allow-list — only return http(s) URLs, else '' ──
// Blocks javascript:, data:, and other breakout vectors before a user-supplied
// URL is used as a src/href or opened in a new tab.
function safeHttpUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(String(url), window.location.origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
  } catch { return ''; }
}

// ── PRESIDENT UID (Neil Barro) ────────────────────
// This controls whose photo/name shows in the president
// message card in Company Overview.
const PRESIDENT_UID = 'neilbarro870@gmail.com'; // fallback: match by email

// Role-based president check — the role itself is the authority; an email match
// is no longer required (roles are assigned/enforced by Firestore rules).
function isRealPresident() {
  return currentRole === 'president';
}


// ══════════════════════════════════════════════════
//  PEOPLE SCREENS — moved verbatim to js/screens/people.js (Wave 7 Pass 7,
//  2026-08-03). Posts feed (renderPosts/loadPosts/openNewPostModal), Team
//  directory (renderTeamTab + End-of-Month standings), Attendance
//  (getPHHolidays/loadHolidayOverrides/renderAttendancePage/
//  renderHolidaysAdmin), Cash Advance UI (renderCashAdvancePage and friends
//  — the CashAdvance SERVICE stays in config.js), and Company Overview
//  (renderCompanyOverviewNew/renderPresidentMessageCard — later DELETED,
//  Wave 7 Pass 10 cleanup, see that file's header) all moved together.
//  See js/screens/people.js's header for the load-order contract and the
//  full contents list.
//
//  Inventory, which used to live directly below (raw materials, finished
//  goods, stock log, job costing), MOVED OUT to js/screens/inventory.js
//  (INVENTORY-DEPT-SPEC-2026-08-31) — promoted to its own department with
//  its own lazy-loaded screen file, alongside a new Finished Products
//  catalog browse and the Count Form moved in from production.js. This
//  shrinks modules.js's eager-loaded boot bundle. window.renderInventory
//  no longer exists; callers now use window.renderInventoryDept (dept
//  screen) or navigateTo('inventory') (legacy standalone route).
// ══════════════════════════════════════════════════

// ══════════════════════════════════════════════════
//  LEAVE MANAGEMENT, GLOBAL SEARCH, FILES HUB, MY PROFILE — moved verbatim
//  to js/screens/people.js (Wave 7 Pass 7, 2026-08-03). See that file's
//  header for the load-order contract and the full contents list.
// ══════════════════════════════════════════════════
