# LAYOFF-SPEC — HR Layoff, Employee Lockdown, Statement of Account, File Requests
**Date:** 2026-08-19 · **Author:** Fable (architect) · **Status:** READY TO IMPLEMENT
**Implementers:** Sonnet subagents, one per parcel (§10). Follow this spec verbatim; escalate ambiguities, do not improvise.

---

## 0. Ground rules (repeat of the binding constraints)

- Vanilla JS, no bundler, no ESM. Everything attaches to `window.*`. Script load order in
  [index.html](index.html) is load-bearing.
- **NEVER** run `git stash`, `git reset --hard`, `git checkout -- <file>`, or `git clean`.
- Escape ALL user content with `escHtml()` before it reaches `innerHTML`. The layoff **reason**,
  expense **descriptions**, and file-request **descriptions** are user content.
- Money display: `window.fmtPeso(n)` (js/config.js:127). NEVER `fmt()` alone for currency
  (js/departments.js:10 `fmt` has no peso sign).
- Dates: `window.bizDate()` / `bizHour()` / `bizDow()` (js/config.js:45/51/57). NEVER raw
  `toISOString()` for date logic.
- Icons: Lucide `<i data-lucide="...">` + `lucide.createIcons({nodes:[el]})` after injection.
- **Notification `title` / `icon` fields take PLAIN emoji strings ('🔒'), never `emojiIcon()`** —
  enforced by ci-invariants check 5/6 (scripts/ci-invariants.sh:192).
- `CACHE_VER` in sw.js is derived from `APP_VERSION` by the pre-commit hook — do NOT hand-edit
  either. DO hand-add new files to the sw.js `PRECACHE` array (that part is manual; ci-invariants
  check 2/3 fails the build if you forget).
- Every money-mutating button goes through `window.busy(btn, fn)` (js/config.js:2257).
- `openPage(...)` (js/app.js:4151) RETURNS the panel element. ALWAYS `panel.querySelector(...)`,
  never `document.getElementById` (a dying panel lingers ~300ms). Exception:
  `Drive.renderUploadArea` takes a string id and resolves it itself via `liveEl` — that's fine.
- Firestore rules are NOT filters: every list query must carry the filter its rule proves against.
- If an Edit tool call fails twice with "modified since read" (OneDrive mtime race), batch the
  remaining edits via a python exact-match replace script per the project memory.

---

## 1. Overview & data model

### 1.1 What is being built

HR (HR-department members, plus President/Manager) can place an employee **on layoff until
further notice** with a written reason shown to the employee. Effective immediately, no approval
step. While laid off, the employee's app collapses to: a layoff dashboard (banner + reason),
a **Statement of Account** (expense reimbursement claims: employee submits lines, HR
approves/adjusts/rejects, HR marks lines paid), **HR file requests** (HR asks for a document,
employee uploads a file or link, the upload lands in the Files Hub), the **Notifications** inbox,
**Payslips / payroll history** (My Finance), and **Chat with HR**. Everything else is hidden from
nav AND blocked in the router. HR lifts the layoff manually; history is retained (a person can be
laid off more than once).

### 1.2 Where layoff state lives — decision

**Both a pointer field and a history collection.**

- `users/{uid}.layoff` — a single **map** field, the live pointer. One top-level key, so the
  Firestore-rules `affectedKeys()` machinery sees exactly `['layoff']` on any write to it, which
  makes the HR escape-hatch rule (§7.2) a one-key `hasOnly`. It rides into `window.userProfile`
  via the existing `loadUserProfile()` users-doc read (js/app.js:941-971) — **zero extra reads at
  boot**, and the state is available before `buildNav()`/`navigateTo()` run (they run at
  js/app.js:211-214, after `loadUserProfile` resolves at :143).
- `layoffs/{autoId}` — one doc per layoff **episode**, never deleted on lift (ruling 5: history
  retained, repeatable). The pointer carries a denormalized copy of the reason so the employee
  dashboard needs no second read.

Why not `employmentStatus` (advisory-only by design, js/config.js:473-496), not `removed` (hard
sign-out lockout, js/app.js:156-160 — a laid-off user must stay signed in), not
`worker_profiles.status` (load-bearing for the payroll double-pay guard and punch rules).
None of those fields are touched by this feature.

### 1.3 Collections — exact doc shapes

Writers named per field. "HR-tier" below always means: role `president` or `manager`, OR any
non-partner user whose `department`/`departments` includes `'HR'` (client predicate
`window.canLayoffAdmin()` §3.2; rules predicate `isSeniorAdmin() || isHrDept()`).
Note the Corporate Secretary and the Accountant can **view** (rules `canHrView()`) but can
**not** write — matching the existing "membership buys the door, not the pen" HR posture.

#### `users/{uid}.layoff` (map field on the existing users doc)

| key | type | values | required | writer |
|---|---|---|---|---|
| `active` | boolean | `true` while laid off, `false` after lift | yes | HR-tier |
| `id` | string | docId of the `layoffs` episode doc | yes | HR-tier |
| `reason` | string ≤2000 | HR's reason, verbatim copy of `layoffs.reason` (shown to employee) | yes | HR-tier |
| `at` | string | `bizDate()` effective date `YYYY-MM-DD` | yes | HR-tier |
| `byName` | string ≤200 | display name of the HR actor | yes | HR-tier |

On **lift**, the whole field is set to `null` (not deleted, not `{active:false}` — a single
canonical "not laid off" representation; `isLaidOff()` checks `layoff?.active === true` so both
`null` and legacy-absent read the same). The lifted episode's full record lives in `layoffs`.

#### `layoffs/{autoId}`

| field | type | values | required | writer |
|---|---|---|---|---|
| `uid` | string | Firebase Auth uid of the employee | yes | HR-tier at create |
| `userName` | string ≤200 | display name snapshot | yes | HR-tier at create |
| `employeeId` | string ≤50 | e.g. `BI-2026-014` (may be `''`) | yes | HR-tier at create |
| `reason` | string 1..2000 | shown verbatim to the employee | yes | HR-tier (create; editable while active) |
| `status` | string | `'active'` \| `'lifted'` | yes | create `'active'`; lift sets `'lifted'` |
| `effectiveDate` | string | `YYYY-MM-DD` (defaults `bizDate()`) | yes | HR-tier at create |
| `placedBy` | string | uid of actor | yes | HR-tier at create |
| `placedByName` | string ≤200 | | yes | HR-tier at create |
| `createdAt` | timestamp | `serverTimestamp()` | yes | HR-tier at create |
| `liftedAt` | timestamp | `serverTimestamp()` | on lift | HR-tier |
| `liftedBy` | string | uid | on lift | HR-tier |
| `liftedByName` | string ≤200 | | on lift | HR-tier |
| `liftNote` | string ≤1000 | optional note (may be `''`) | on lift | HR-tier |

#### `layoff_expenses/{autoId}` — one Statement-of-Account line

| field | type | values | required | writer |
|---|---|---|---|---|
| `layoffId` | string | parent `layoffs` docId | yes | employee at create |
| `uid` | string | employee's uid (== `request.auth.uid` at create) | yes | employee |
| `userName` | string ≤200 | | yes | employee |
| `description` | string 1..1000 | what the expense was | yes | employee (editable while pending) |
| `amount` | number ≥0 | claimed amount, pesos (2dp) | yes | employee (editable while pending) |
| `expenseDate` | string | `YYYY-MM-DD` when the expense was made | yes | employee |
| `receiptUrl` | string ≤500 or `null` | Storage download URL or external link | optional | employee |
| `receiptName` | string ≤300 or `null` | file/link label | optional | employee |
| `receiptKind` | string or `null` | `'file'` \| `'link'` | optional | employee |
| `status` | string | `'pending'` → `'approved'` \| `'rejected'`; `'approved'` → `'paid'` | yes | create `'pending'`; HR-tier transitions |
| `approvedAmount` | number ≥0 or `null` | HR's (possibly adjusted) amount; set on approve | on approve | HR-tier |
| `hrNote` | string ≤1000 or `null` | adjustment explanation / rejection reason | on approve/reject | HR-tier |
| `decidedAt` | timestamp or `null` | | on approve/reject | HR-tier |
| `decidedBy` / `decidedByName` | string / string ≤200 or `null` | | on approve/reject | HR-tier |
| `paidAt` | timestamp or `null` | | on mark-paid | HR-tier |
| `paidDate` | string or `null` | `YYYY-MM-DD` (HR-entered, defaults `bizDate()`) | on mark-paid | HR-tier |
| `paidBy` / `paidByName` | string / string ≤200 or `null` | | on mark-paid | HR-tier |
| `paidMethod` | string ≤200 or `null` | free text ("GCash", "Cash", bank...) | optional | HR-tier |
| `createdAt` | timestamp | `serverTimestamp()` | yes | employee |
| `updatedAt` | timestamp | `serverTimestamp()` | yes | every writer |

All optional/on-event fields are written as explicit `null` at create so the doc shape is stable
(matches the hub_files WS38 house style, js/departments.js:1353-1366).

#### `layoff_file_requests/{autoId}` — HR asks, employee delivers

| field | type | values | required | writer |
|---|---|---|---|---|
| `layoffId` | string | parent `layoffs` docId | yes | HR-tier |
| `uid` | string | employee's uid | yes | HR-tier |
| `userName` | string ≤200 | | yes | HR-tier |
| `description` | string 1..1000 | what HR wants ("Signed clearance form", ...) | yes | HR-tier |
| `dueDate` | string or `null` | `YYYY-MM-DD`, optional | optional | HR-tier |
| `allowLink` | boolean | may the employee attach a URL instead of a file | yes (default `true`) | HR-tier |
| `status` | string | `'open'` \| `'fulfilled'` | yes | create `'open'`; employee sets `'fulfilled'` |
| `createdAt` | timestamp | `serverTimestamp()` | yes | HR-tier |
| `createdBy` / `createdByName` | string / string ≤200 | | yes | HR-tier |
| `fulfilledAt` | timestamp or `null` | | on fulfil | employee |
| `hubFileId` | string or `null` | docId of the `hub_files` doc created on fulfil (§6.3) | on fulfil | employee |
| `fileUrl` | string ≤500 or `null` | resolved URL of the delivered file/link | on fulfil | employee |
| `fileName` | string ≤300 or `null` | | on fulfil | employee |
| `fileKind` | string or `null` | `'file'` \| `'link'` | on fulfil | employee |
| `updatedAt` | timestamp | `serverTimestamp()` | yes | every writer |

#### Why NOT the dept-budgets ledger shape

js/screens/dept-budgets.js's claim→approve→mark-paid ledger (`dept_spend_logs` /
`dept_budget_requests`) was considered and rejected: its docs are **department-scoped and
admin-written** with people-are-owed semantics driven by budget releases, whereas SoA lines are
**employee-authored, owner-scoped** request docs with an approval workflow — which is exactly the
`cash_advances` pattern (js/config.js:2740-3230, firestore.rules:940-970). This spec mirrors
cash_advances (flat collection, owner create-as-pending, privileged transitions, owner read via
provable `uid ==` query) and adds a `paid` terminal state.

### 1.4 Queries the UI issues (all provable, none need composite indexes)

| # | Query | Issuer | Proven by |
|---|---|---|---|
| Q1 | `layoffs.where('status','==','active')` | HR admin screen | `canHrView()` role disjunct |
| Q2 | `layoffs.where('status','==','lifted')` | HR history tab | same |
| Q3 | `layoffs.where('uid','==',<uid>)` | HR per-employee history | same |
| Q4 | `layoff_expenses.where('layoffId','==',<id>)` | HR detail view | same |
| Q5 | `layoff_expenses.where('uid','==',me).where('layoffId','==',<id>)` | employee dashboard | owner disjunct — the `uid==me` filter makes it provable |
| Q6 | `layoff_file_requests.where('layoffId','==',<id>)` | HR detail view | `canHrView()` |
| Q7 | `layoff_file_requests.where('uid','==',me).where('layoffId','==',<id>)` | employee dashboard | owner disjunct |

All are equality-only (Firestore merges single-field indexes; no `orderBy` in any query — sort
client-side by `createdAt?.seconds`). **Zero `firestore.indexes.json` entries needed.** Do not add
any.

---

## 2. The lockdown gate

### 2.1 Single source of truth — `window.isLaidOff()`

**File: js/config.js.** Add immediately AFTER `window.employmentStatusMeta` (currently ends at
js/config.js:503), so it sits beside the other status vocabulary and — because config.js loads
before app.js, chat.js, and every screen file — exists before any caller:

```js
// ── Layoff (LAYOFF-SPEC 2026-08-19) ──────────────────────────────────────
// THE one predicate for "this signed-in user is on layoff". Reads the
// users/{uid}.layoff pointer map that loadUserProfile() (js/app.js) merges
// onto window.userProfile at auth time — no extra read, available before
// buildNav()/navigateTo() run. FAIL-OPEN by design: if the profile read
// failed, layoff reads false. Layoff lockdown is an HR-workflow affordance,
// not the security boundary (firestore.rules is) — failing closed here would
// lock every user out of the whole app on any transient profile-read error.
window.isLaidOff = function () {
  return !!(window.userProfile && window.userProfile.layoff
            && window.userProfile.layoff.active === true);
};
// Pages a laid-off user may still reach (owner ruling, 2026-08-19):
// dashboard (renders the layoff view incl. Statement of Account + uploads),
// notifications inbox, payslips/payroll history (My Finance), chat with HR.
// Everything else redirects to 'dashboard' in navigateTo (js/app.js).
window.LAYOFF_ALLOWED_PAGES = ['dashboard', 'chat', 'notifications', 'personal-finance'];
```

Caching/invalidation: the state IS `window.userProfile.layoff`. It refreshes (a) on every auth
bootstrap via `loadUserProfile`, and (b) mid-session via the claims-listener piggyback (§2.6).
No dbCachedGet involvement.

### 2.2 Nav — new NAV_REGISTRY variant `laidOff`

**File: js/config.js**, `window.NAV_REGISTRY` (:611-869).

1. In `sidebar:` (after the `staff:` array, :762-793), add:

```js
    // ── Laid-off employee (LAYOFF-SPEC). Deliberately tiny: the layoff
    // dashboard carries the Statement of Account and uploads itself, the
    // topbar bell reaches 'notifications'. Every page here already has a
    // .nav-item[data-page] colour rule in css/styles.css (dashboard :1354,
    // chat :1384, personal-finance :1380) — NO new CSS needed, and
    // ci-invariants 6/6 stays green because no NEW page key is introduced.
    laidOff: [
      { key:'my-finance', icon:'wallet', label:'My Payslips', page:'personal-finance' }
    ],
```

(`sidebarUniversal` — Dashboard + Chats — is prepended to EVERY variant by `getSidebarItems`,
js/app.js:1670-1672, so the laid-off sidebar is: Dashboard, Chats, My Payslips.)

2. In `bottom:` (after the `workerB:` array, :863-867), add:

```js
    // Bottom Nav — laid-off employee (LAYOFF-SPEC). 4 items, under the 5-tab
    // More threshold. Profile is stripped by _primaryNavItems as everywhere.
    laidOff: [
      { icon:'home',           label:'Home',        page:'dashboard'        },
      { icon:'message-circle', label:'Chats',       page:'chat'             },
      { icon:'wallet',         label:'My Payslips', page:'personal-finance' }
    ],
```

3. **File: js/app.js**, `_navVariant()` (:1627-1641). Insert the laid-off check **FIRST**, before
the `pres` branch — a laid-off person of any role gets the lockdown chrome:

```js
function _navVariant() {
  // LAYOFF-SPEC — layoff lockdown beats every other variant, including admin
  // and Type-B: whoever is laid off gets the minimal chrome, full stop.
  if (window.isLaidOff && window.isLaidOff()) return 'laidOff';
  const pres = isPresident() || currentRole === 'manager' || currentRole === 'secretary';
  ...unchanged...
}
```

4. **File: js/app.js**, `buildNav()` (:1568-1585): hide the global-search magnifier for laid-off
users (search surfaces department content). Change line :1572 from

```js
  if (gs) { gs.style.display = (isPartner() || isBrilliantOnly()) ? 'none' : ''; ... }
```
to
```js
  if (gs) { gs.style.display = (isPartner() || isBrilliantOnly() || (window.isLaidOff && window.isLaidOff())) ? 'none' : ''; ... }
```

### 2.3 Router — `navigateTo` gate

**File: js/app.js**, `function navigateTo(page, opts)` (:2640). Insert immediately after
`const subtab = ...` (:2642) and BEFORE the Overlay/history block (:2646) so the redirect is what
gets written into history:

```js
  // ── LAYOFF LOCKDOWN (LAYOFF-SPEC) ────────────────────────────────────────
  // THE router interception point — same posture as _deptBlockedForRole below:
  // sidebar, bottom nav, deep links (#/dept/Finance), notification payloads,
  // search results and hand-typed hashes ALL come through here, and the
  // `dept:` prefix branch below returns before the main switch, so the gate
  // must sit above both. Rewrites (not blocks) to 'dashboard': a laid-off
  // user always lands somewhere honest, never on a dead "access denied".
  // UI-only — firestore.rules on the layoff collections is the data boundary;
  // see LAYOFF-SPEC §12 for the acknowledged residual gap on old dept data.
  if (window.isLaidOff && window.isLaidOff()
      && !(window.LAYOFF_ALLOWED_PAGES || ['dashboard']).includes(page)) {
    page = 'dashboard';
  }
```

This covers the `page.startsWith('dept:')` early-return branch (:2698-2704) because the rewrite
happens before it. Do NOT touch `_deptBlockedForRole` (:3173) — that stays secretary-only.

### 2.4 Dashboard dispatch (incl. the Type-B worker path)

1. **File: js/app.js**, the `'dashboard'` case (:2713). A laid-off Type-B (production) worker must
get the layoff view, not `renderWorkerHome()` (which carries Time In/Out — a laid-off worker must
not punch). Replace the case with:

```js
    case 'dashboard':        (window.isLaidOff && window.isLaidOff())
                               ? renderDashboard()
                               : ((isTypeBWorker() && window.renderWorkerHome) ? window.renderWorkerHome() : renderDashboard()); break;
```

2. **File: js/screens/dashboards.js**, `renderDashboard()` (:874-890). Add as the FIRST branch:

```js
async function renderDashboard() {
  // LAYOFF-SPEC — a laid-off user of ANY role gets the layoff view. A separate
  // render function (js/screens/layoff.js), not a branch inside
  // renderEmployeeDashboard: the layoff screen shares nothing with the normal
  // dashboard (no tasks/KPI/attendance), and gutting a 200-line template with
  // conditionals would be strictly worse than dispatching cleanly here.
  if (window.isLaidOff && window.isLaidOff() && window.renderLayoffDashboard) {
    await window.renderLayoffDashboard();
    return;
  }
  if (isPresident()) {
  ...unchanged...
```

### 2.5 Boot-path guards

**File: js/app.js**, in the auth bootstrap (:202-237): the attendance reminder and deadline
checks are meaningless (and noisy) for a laid-off user. Change :205-206 from

```js
      Notifs.checkDeadlines(user.uid);
      if (userProfile.role !== 'partner') Notifs.checkAttendanceReminder(user.uid, userProfile.displayName);
```
to
```js
      if (!(window.isLaidOff && window.isLaidOff())) Notifs.checkDeadlines(user.uid);
      if (userProfile.role !== 'partner' && !(window.isLaidOff && window.isLaidOff())) Notifs.checkAttendanceReminder(user.uid, userProfile.displayName);
```

Leave `Notifs.startListener` / `initPush` / presence heartbeat / force-logout / claims listeners
untouched — a laid-off user keeps notifications, push, and chat.

### 2.6 Mid-session enforcement (layoff placed/lifted while the target is signed in)

**File: js/app.js**, inside `startClaimsListener(uid)`'s snapshot handler (:446-...). There is
already a live `onSnapshot` on the user's OWN users doc; piggyback rather than opening a second
listener. Directly after the existing displayName sync block (`if (window.userProfile &&
userProfile.id === uid) { ... }` at ~:460-463), add:

```js
    // LAYOFF-SPEC — live layoff enforcement. HR flipping users/{uid}.layoff
    // must take effect mid-session, not on next sign-in. Compare the wire
    // state to the cached pointer; on ANY change: refresh the cached profile,
    // rebuild the chrome, and if the current page is no longer allowed, land
    // on the dashboard (which renders the layoff view / normal view as
    // appropriate). Runs before the claims baseline logic below on purpose —
    // it is independent of the claims re-gate.
    if (window.userProfile && userProfile.id === uid) {
      const wireL = data.layoff || null;
      const curL  = userProfile.layoff || null;
      const changed = (!!(wireL && wireL.active) !== !!(curL && curL.active))
                   || ((wireL && wireL.id) !== (curL && curL.id));
      if (changed) {
        userProfile.layoff = wireL;
        window.userProfile = userProfile;
        try { buildNav(); } catch(_) {}
        const allowed = (window.LAYOFF_ALLOWED_PAGES || ['dashboard']);
        if (window.isLaidOff() && !allowed.includes(window.currentPage)) {
          navigateTo('dashboard', { replace: true });
        } else if (window.currentPage === 'dashboard') {
          navigateTo('dashboard', { replace: true });   // repaint: layoff view on/off
        }
        if (window.Notifs) {
          Notifs.showToast(window.isLaidOff()
            ? '🔒 Your account has been placed on layoff. See your dashboard.'
            : '✅ Your layoff has been lifted. Welcome back.',
            window.isLaidOff() ? 'error' : 'success');
        }
      }
    }
```

(Toast text is plain emoji in a TEXT sink — allowed; `emojiIcon()` is not.)

### 2.7 Chat scope (ruling 1: "Chat with HR")

**File: js/chat.js.**

1. `dmCandidates(users)` (:420-428) — restrict the "New Message" picker for a laid-off user to
HR-tier people. Insert before the final internal return (:427):

```js
    // LAYOFF-SPEC — a laid-off employee may only START a conversation with
    // HR-department members, the President, or a Manager. Existing threads in
    // their inbox stay readable/writable (deliberate: an in-flight work
    // conversation should be closable, and the inbox query cannot prove a
    // role filter anyway — see the fence comment above).
    if (window.isLaidOff && window.isLaidOff()) {
      return users.filter(u => u.id !== currentUser.uid && u.role !== 'partner' && (
        ['president','manager'].includes(u.role) ||
        u.department === 'HR' || (u.departments || []).includes('HR')));
    }
```

2. `myDeptChannels()` (the function containing the `blocked` filter at :412-418) — a laid-off
user gets NO department channels. Add as the first line of that function:

```js
    if (window.isLaidOff && window.isLaidOff()) return [];
```

### 2.8 Personal-finance trim

**File: js/screens/dashboards.js**, `renderPersonalFinance` (:2340). Payslips/payroll history
stay (ruling allows them); Cash Advance does not. Two edits in the employee (non-`pres`) branch:

- The `+ Cash Advance` button (`id="req-advance-btn"`, ~:2919): wrap the button's template chunk
  in `${(window.isLaidOff && window.isLaidOff()) ? '' : ` ... `}`.
- The Cash-Advance entry-point card (the NOTES-AND-DRAWER §3.4 block, ~:3063): wrap the same way.

The `cash-advances` page itself is already unreachable via the router gate (§2.3).

---

## 3. New file: js/screens/layoff.js (single owner — Parcel B)

One new file holds the service layer, the employee layoff dashboard, and the HR admin screens.
~600-800 lines. Header comment must name this spec.

**Wiring (Parcel A does these two edits):**

- [index.html](index.html): insert `<script defer src="js/screens/layoff.js"></script>`
  **immediately after** the `js/screens/dashboards.js` tag (currently index.html:763). All calls
  into it are runtime-dispatched (`window.*`), so position is not load-bearing, but keeping it by
  dashboards.js groups the dashboard family.
- [sw.js](sw.js): add `'/js/screens/layoff.js',` to `PRECACHE` immediately after
  `'/js/screens/dashboards.js',` (currently sw.js:98). Do NOT touch `CACHE_VER` (hook-derived).

### 3.1 Module skeleton

```js
/* ═══════════════════════════════════════════════════
   LAYOFF (LAYOFF-SPEC 2026-08-19) — js/screens/layoff.js
   - window.canLayoffAdmin()            write-authority predicate
   - window.LayoffSvc                   place/lift/claim/decide/pay/file-request service
   - window.renderLayoffDashboard()     the laid-off employee's whole dashboard
   - window.renderLayoffAdmin()         HR hub screen (list + place + history)
   - window.openLayoffDetail(layoff)    HR per-employee detail (SoA + file requests)
   Collections: layoffs, layoff_expenses, layoff_file_requests (+ the
   users/{uid}.layoff pointer). See LAYOFF-SPEC.md — implement verbatim.
═══════════════════════════════════════════════════ */
```

### 3.2 `window.canLayoffAdmin`

```js
// Ruling 2 (2026-08-19): HR-department members plus President/Manager place
// and lift layoffs — no approval step. Mirrors firestore.rules' write gate
// (isSeniorAdmin() || isHrDept()). Deliberately NARROWER than isHrPriv()
// (js/screens/hr.js:402): secretary/finance keep SIGHT via canHrView-backed
// reads but never the pen. Partners are excluded outright.
window.canLayoffAdmin = function () {
  const role = window.currentRole || '';
  if (role === 'partner') return false;
  return ['president','manager'].includes(role)
      || (window.currentDepts || []).includes('HR');
};
```

### 3.3 `window.LayoffSvc` — service functions

All writes wrapped by callers in `busy(btn, fn)`. All service functions `throw` on failure (the
caller toasts `Notifs.showToast('...: ' + (e.message||e.code), 'error')`). Every mutation calls
`window.logAudit(action, entity, entityId, details)` (js/config.js:1387) after the write.

Centavo-safe totaling helper (module-local, exported on LayoffSvc for reuse by both screens):

```js
// Sum peso amounts without float drift: accumulate in integer centavos.
sumPesos(nums) { return nums.reduce((s, n) => s + Math.round((Number(n) || 0) * 100), 0) / 100; },
```

#### `LayoffSvc.place({ uid, userName, employeeId, reason, effectiveDate })`
1. Validate: `reason` non-empty after trim, ≤2000 chars; `uid` present; `effectiveDate` defaults
   `today()`.
2. Guard: read `users/{uid}`; if `data().layoff?.active` → throw `'Already on layoff'`. If
   `data().removed === true` → throw `'This person is removed from the system'`. If
   `data().role === 'president'` → throw (rules also refuse).
3. `const ref = db.collection('layoffs').doc();` then ONE `db.batch()`:
   - `batch.set(ref, {...§1.3 layoffs shape..., status:'active', createdAt: serverTimestamp()})`
   - `batch.update(db.collection('users').doc(uid), { layoff: { active:true, id:ref.id, reason, at:effectiveDate, byName: placedByName } })`
   - commit.
4. `dbCacheInvalidate('users')`.
5. Notify (§8 N1) + `logAudit('layoff_place','layoff',ref.id,{uid,userName,effectiveDate})`.
6. Return `ref.id`.

(The batch's two writes hit two different rule branches — `layoffs` create and the users
`hasOnly(['layoff'])` branch (§7.2) — both allowed for HR-tier, so the batch commits atomically.)

#### `LayoffSvc.lift(layoff, { liftNote })`
1. `confirmDialog` is the CALLER's job (§3.6); service just writes.
2. ONE batch:
   - `batch.update(layoffs/{layoff.id}, { status:'lifted', liftedAt: serverTimestamp(), liftedBy, liftedByName, liftNote: liftNote||'' })`
   - `batch.update(users/{layoff.uid}, { layoff: null })`
3. `dbCacheInvalidate('users')`; notify (§8 N2); `logAudit('layoff_lift','layoff',layoff.id,{uid:layoff.uid})`.

#### `LayoffSvc.submitClaim({ layoffId, description, amount, expenseDate, receipt })`
Employee-side. `receipt` is the `Drive.renderUploadArea` result or `null`.
1. Validate: description 1..1000; `amount` a finite number ≥ 0 (`Math.round(x*100)/100` it);
   `expenseDate` defaults `today()`.
2. `db.collection('layoff_expenses').add({ ...§1.3 shape..., uid: currentUser.uid, status:'pending', approvedAmount:null, hrNote:null, decidedAt:null, decidedBy:null, decidedByName:null, paidAt:null, paidDate:null, paidBy:null, paidByName:null, paidMethod:null, receiptUrl: receipt ? (Drive.resolveUrl(receipt)||null) : null, receiptName: receipt ? (receipt.name||null) : null, receiptKind: receipt ? (receipt.source==='link'?'link':'file') : null, createdAt/updatedAt: serverTimestamp() })`
3. Notify HR (§8 N3); `logAudit('create','layoff_expense',ref.id,{layoffId,amount})`.

#### `LayoffSvc.approveClaim(claim, { approvedAmount, hrNote })`
1. Validate `approvedAmount` finite ≥ 0 (defaults to `claim.amount`).
2. `update({ status:'approved', approvedAmount, hrNote: hrNote||null, decidedAt: serverTimestamp(), decidedBy, decidedByName, updatedAt: serverTimestamp() })`
3. Notify employee (§8 N4); `logAudit('approve','layoff_expense',claim.id,{amount:claim.amount,approvedAmount})`.

#### `LayoffSvc.rejectClaim(claim, { hrNote })`
`hrNote` REQUIRED non-empty (the employee must see why). Same update with `status:'rejected'`,
`approvedAmount:null`. Notify (§8 N5); `logAudit('reject','layoff_expense',claim.id,{})`.

#### `LayoffSvc.markPaid(claim, { paidDate, paidMethod })`
Only valid from `'approved'` (guard client-side; rules enforce too §7.3).
`update({ status:'paid', paidAt: serverTimestamp(), paidDate: paidDate||today(), paidBy, paidByName, paidMethod: paidMethod||null, updatedAt: serverTimestamp() })`
Notify (§8 N6); `logAudit('pay','layoff_expense',claim.id,{approvedAmount:claim.approvedAmount})`.

#### `LayoffSvc.createFileRequest({ layoffId, uid, userName, description, dueDate, allowLink })`
HR-side. `add({...§1.3 shape..., status:'open', fulfilledAt:null, hubFileId:null, fileUrl:null, fileName:null, fileKind:null, createdAt/updatedAt: serverTimestamp()})`.
Notify employee (§8 N7); `logAudit('create','layoff_file_request',ref.id,{uid,description:description.slice(0,80)})`.

#### `LayoffSvc.fulfilRequest(req, uploadResult, file)`
Employee-side, called from the upload `onUpload` callback. Two writes, sequential:
1. **hub_files doc** — §6.3, capture `hubRef.id`. If this write throws, abort (toast) — the
   request stays open.
2. `layoff_file_requests/{req.id}.update({ status:'fulfilled', fulfilledAt: serverTimestamp(), hubFileId: hubRef.id, fileUrl: Drive.resolveUrl(uploadResult)||null, fileName: uploadResult.name||null, fileKind: uploadResult.source==='link'?'link':'file', updatedAt: serverTimestamp() })`
3. Notify HR (§8 N8); `logAudit('fulfil','layoff_file_request',req.id,{})`.

### 3.4 `window.renderLayoffDashboard()` — full markup spec (§4 has the visual contract)

Paints `document.getElementById('page-content')` (this is a dashboard, not an overlay).

```
skeletonHtml('cards') → Promise.all:
  [expSnap, reqSnap] =
    Q5: db.collection('layoff_expenses').where('uid','==',uid).where('layoffId','==',L.id).get().catch(()=>({docs:[]}))
    Q7: db.collection('layoff_file_requests').where('uid','==',uid).where('layoffId','==',L.id).get().catch(()=>({docs:[]}))
  where L = window.userProfile.layoff  (if !L?.active — defensive — call renderDashboard-equivalent
  by navigateTo('dashboard',{replace:true}) and return)
```

Sort both client-side newest-first by `createdAt?.seconds||0`.

Derived totals (via `LayoffSvc.sumPesos`):
- `pendingTotal` = Σ `amount` over `status=='pending'`
- `owedTotal`    = Σ `approvedAmount` over `status=='approved'`   ← "what the company owes them"
- `paidTotal`    = Σ `approvedAmount` over `status=='paid'`
- `claimedTotal` = Σ `amount` over pending+approved+paid (rejected excluded)

Markup (existing classes only — `page-header`, `alert-banner alert-danger`, `card`,
`card-header`, `card-body`, `kpi-row`, `kpi-card`, `badge`, `file-chip`, `empty-state`,
`btn-primary`/`btn-secondary`/`btn-sm`, `item-card`):

1. `page-header`: `<h2>${emojiIcon('🔒',20)} Layoff Notice</h2>`
2. Banner (models the overdue-tasks banner, js/screens/dashboards.js:1993, but NOT clickable):
   ```html
   <div class="alert-banner alert-danger" style="cursor:default;display:block">
     <span>${emojiIcon('⚠️',16)} <strong>You are on layoff until further notice</strong>
       · since ${escHtml(L.at||'')}${L.byName?` · placed by ${escHtml(L.byName)}`:''}</span>
     <div style="margin-top:6px;font-size:13px;white-space:pre-wrap">${escHtml(L.reason||'')}</div>
   </div>
   ```
   (**reason is user content → escHtml, always.**)
3. `kpi-row` with four `kpi-card`s: Submitted `fmtPeso(pendingTotal)` / Owed to you
   `fmtPeso(owedTotal)` (class `accent` when > 0) / Paid `fmtPeso(paidTotal)` (class `green`) /
   Total claimed `fmtPeso(claimedTotal)`. Icon tiles via `window.iconTile(...)` as the employee
   dashboard's kpi cards do (dashboards.js:2001).
4. **Statement of Account card**: `card` with `card-header` `<h3>${emojiIcon('🧾',20)} Statement
   of Account</h3>` + a `btn-primary btn-sm` `id="lo-add-claim"` "＋ Add expense". Body: if no
   lines, `renderEmptyState({icon:'🧾', title:'No expense claims yet', hint:'Add every expense you made that the company should reimburse.'})`; else one `item-card` per line:
   - row 1: `escHtml(description)` (bold, 13px) + `statusBadge2('layoff_expense', x.status)`
   - row 2 (muted, 12px): `expenseDate` · claimed `fmtPeso(amount)`
     `+ (status approved/paid && approvedAmount !== amount ? " · approved ${fmtPeso(approvedAmount)}" : "")`
     `+ (status paid ? " · paid ${escHtml(paidDate||'')}${paidMethod?` via ${escHtml(paidMethod)}`:''}" : "")`
   - if `hrNote`: muted italic line `HR: ${escHtml(hrNote)}`
   - if `receiptUrl`: a `file-chip` anchor (`target="_blank" rel="noopener"`,
     `href="${escHtml(safeHttpUrl(receiptUrl))}"`) with lucide `link-2`/`file-text` per
     `receiptKind` and `escHtml(receiptName||'Receipt')`
   - while `status=='pending'`: `btn-secondary btn-sm` "Edit" (`data-id`) and "Withdraw"
     (`data-id`, confirmDialog danger → `doc.delete()` — allowed by rules §7.3).
5. **Documents HR asked for card** (only rendered when `reqSnap` non-empty): `card`, header
   `<h3>${emojiIcon('📎',20)} Documents HR asked for</h3>`. Per request an `item-card`:
   - `escHtml(description)` + `statusBadge2('layoff_request', r.status)` +
     (dueDate ? muted `Due ${dueDate}` : '')
   - `'open'`: an upload mount `<div id="lo-req-up-${r.id}"></div>`; after innerHTML is set call
     `Drive.renderUploadArea('lo-req-up-'+r.id, (result,file)=>LayoffSvc.fulfilRequest(r,result,file).then(rerender).catch(toast), { dept:'HR', subfolder:'Layoff', allowLinks: r.allowLink !== false, label:'Upload for HR' })`
     (**containerId is a STRING; renderUploadArea resolves via liveEl itself — js/drive.js:298-306**)
   - `'fulfilled'`: a `file-chip` anchor to `safeHttpUrl(r.fileUrl)` labeled
     `escHtml(r.fileName||'Submitted')` + muted "Sent to HR ✓"
6. Footer card ("While you are on layoff"), `card-body` with two buttons:
   `btn-primary` "💬 Message HR" → `navigateTo('chat')`;
   `btn-secondary` "🧾 My payslips" → `navigateTo('personal-finance')`.
7. `lucide.createIcons({ nodes: [c] })`; bind all buttons with listeners scoped
   `c.querySelectorAll(...)`.

**Add-expense form** (`#lo-add-claim`, also used by Edit with fields prefilled): use the
`openPage` idiom from `CashAdvance.openRequestForm` (js/config.js:2793-2840): keep the returned
`_panel`, scope ALL queries to it.
- Fields: `textarea` description (required), `input type="number" min="0" step="0.01"` amount
  (required), `input type="date"` value `today()`, an upload mount `<div id="lo-claim-up"></div>`
  → `Drive.renderUploadArea('lo-claim-up', (result)=>{ pendingReceipt = result; }, { dept:'HR', subfolder:'Layoff Receipts', allowLinks:true, label:'Attach receipt (optional)' })`.
- Footer: `btn-primary` Submit inside `busy(btn, async () => { await LayoffSvc.submitClaim(...); Overlay.dismissTop(); rerender(); Notifs.success('Expense claim submitted'); })`.
- Edit path: while pending, same form; Submit does `layoff_expenses/{id}.update({description, amount, expenseDate, receipt* if replaced, updatedAt: serverTimestamp()})` (owner-pending rule branch §7.3).

`rerender` = call `window.renderLayoffDashboard()` again (same pattern as
`bindAttendanceCard(..., renderEmployeeDashboard)`).

### 3.5 `window.renderLayoffAdmin()` — HR hub screen

Renders into `deptContainer()` (js/departments.js:9). Entry from the HR card (§5). View gate:
`if (!window.isHrPriv()) → empty-state lock` (same as renderHR :417-421). Write buttons render
only when `canLayoffAdmin()`; when the viewer is view-only (secretary/finance outside HR), show
the list with a muted "view only" tag in the header, matching the Work Sites/Leave desc pattern
(hr.js:482-484).

Layout:
1. `page-header`: `<h2>${emojiIcon('🔒',20)} Layoff</h2>` + (canLayoffAdmin) `btn-primary`
   `id="lo-place-btn"` "＋ Place on layoff". Below it a back link `btn-secondary btn-sm`
   "← HR" → `window.renderHR(currentUser, currentRole)`.
2. `window.sopPanel('How layoff works', [...])` (js/config.js:2300) with 4 steps: place with a
   written reason the employee sees; employee files reimbursable expenses; HR approves/adjusts/
   rejects then marks lines paid; lift when they return — history is kept.
3. `chipTabs([{key:'active',label:'On Layoff'},{key:'history',label:'History'}], 'active')` +
   `bindChipTabs` (js/config.js:1494/1537).
4. `active` pane: Q1, sorted by `createdAt` desc. Per row an `item-card` (click → §3.6):
   userName (bold) · employeeId (muted) · `since ${effectiveDate}` ·
   `statusBadge2('layoff', 'active')` · reason first 120 chars escaped.
   Empty → `renderEmptyState({icon:'✅', title:'Nobody is on layoff'})`.
5. `history` pane: Q2, same rows with `lifted ${liftedAt → toDate → toLocaleDateString('en-PH')}`
   and badge `statusBadge2('layoff','lifted')`. Rows also clickable (§3.6, read-only actions).

**Place-on-layoff form** (`#lo-place-btn`, openPage idiom):
- Employee `<select>`: options from
  `dbCachedGet('users', () => db.collection('users').get(), 30000)` (the fetcher is
  force-substituted with `fetchUsersWithPayroll` — fine), filtered:
  `role !== 'partner' && role !== 'president' && !removed && !(layoff && layoff.active)`;
  label `${displayName} — ${employeeId||role}` (escHtml).
- `textarea` reason, required, with helper text "This is shown to the employee word-for-word."
- `input type="date"` effective date, default `today()`.
- Footer `btn-primary` "Place on layoff" → `busy(btn, ...)` →
  `LayoffSvc.place({...})` → `Overlay.dismissTop(); renderLayoffAdmin();`
  `Notifs.success('Placed on layoff')`.

### 3.6 `window.openLayoffDetail(layoff)` — HR per-employee view

`openPage('🔒 ' + layoff.userName, body, footer)` — keep `_panel`. Loads Q4 + Q6 in a
`Promise.all`, client-sorted desc.

Body:
1. Summary block: reason (escHtml, `white-space:pre-wrap`), effectiveDate, placedByName; if
   lifted: liftedByName/liftNote too.
2. Totals strip (same four figures as §3.4, from HR's perspective; "Owed" prominent).
3. **Expense lines** — per line, same display rows as §3.4 plus, when `canLayoffAdmin()` and
   status permits:
   - `pending` → `btn-primary btn-sm` **Approve** `data-id`, `btn-secondary btn-sm` **Reject** `data-id`
   - `approved` → `btn-primary btn-sm` **Mark paid** `data-id`
   - Approve → `openModal('Approve expense', ...)` (js/app.js:3836) with a prefilled
     `input type="number" step="0.01"` = claimed amount (HR may adjust down/up) + optional note
     input; confirm via `busy` → `LayoffSvc.approveClaim`.
   - Reject → `promptDialog({title:'Reject expense', message:'Reason shown to the employee', required})`
     (js/config.js:2220); null → abort; else `LayoffSvc.rejectClaim`.
   - Mark paid → `openModal('Mark as paid', ...)`: date input default `today()`, method text
     input (optional); `busy` → `LayoffSvc.markPaid`.
4. **File requests** — list with `statusBadge2('layoff_request', ...)`; fulfilled ones render the
   `file-chip` link. `canLayoffAdmin()` gets `btn-primary btn-sm` `id="lo-new-req"`
   "＋ Request a document" → openModal with description textarea (required), due-date input
   (optional), `checkbox` "Allow a link instead of a file" (checked default) →
   `LayoffSvc.createFileRequest`.
5. Footer: `canLayoffAdmin()` gets `btn-secondary` (danger-styled: `style="color:var(--danger)"`)
   **Lift layoff** for `status=='active'` rows:
   `confirmDialog({title:'Lift layoff', message:'${userName} will immediately regain full access. Continue?', confirmLabel:'Lift layoff', danger:true})`
   → optional `promptDialog` lift note → `busy` → `LayoffSvc.lift` → close page, re-render admin.

After every action, reload the two queries and repaint the panel body in place
(`_panel.querySelector('#lo-detail-body')`).

---

## 4. Employee dashboard layoff view — decision record

- **Separate render function** (`renderLayoffDashboard`, §3.4) dispatched from `renderDashboard`
  (§2.4), NOT edits inside `renderEmployeeDashboard` (dashboards.js:1918). Justification: the two
  screens share zero data reads; a branch inside the 200-line template would double every
  conditional and still need the Type-B interception anyway.
- `renderEmployeeDashboard` itself is **untouched**.
- The existing `alert-banner alert-danger` (dashboards.js:1993) is the visual model for the
  layoff banner; ours is non-clickable and carries the reason body (§3.4 item 2).

---

## 5. HR side entry point

**File: js/screens/hr.js**, `renderHR`'s `const cards = [...]` (:447-485). Insert AFTER the
`People & Roles` entry (:456):

```js
    // LAYOFF-SPEC — place/lift layoffs, review reimbursement claims, request
    // documents. Door for every isHrPriv() viewer; write buttons inside are
    // canLayoffAdmin() (HR dept + president/manager) — secretary/finance get
    // sight, not the pen, same split as Work Sites/Leave/Attendance below.
    { icon:'🔒', title:'Layoff', desc:`Place staff on layoff, reimbursements & requested documents${(window.canLayoffAdmin && window.canLayoffAdmin())?'':' · view only'}`, go:()=>window.renderLayoffAdmin && window.renderLayoffAdmin() },
```

(The cards renderer and click binding at :498-510 need no changes — it's data-driven.)
Also add `'Layoff'` to `DEPARTMENTS['HR'].subtabs` in js/config.js:249 (display metadata only;
keeps the dept description honest): `['People & Roles', 'Payroll', 'Accounts & Logins', 'Leave', 'Attendance', 'Budgeting', 'Layoff']`.

---

## 6. Files: uploads, and landing in the Files Hub

### 6.1 Upload plumbing (both employee flows)

`Drive.renderUploadArea(containerId, onUpload, opts)` (js/drive.js:298). Blobs go to Firebase
Storage under `dept:'HR'`:
- expense receipts → `subfolder:'Layoff Receipts'`
- file-request fulfilments → `subfolder:'Layoff'`
`onUpload` receives `(result, file)` where result = `{id, name, url, driveUrl:null,
source:'firebase'|'link', folder}` (js/drive.js:33-40). Resolve display URLs ONLY via
`Drive.resolveUrl(result)` and render through `safeHttpUrl` (js/modules.js:28).

### 6.2 What goes to the Files Hub — decision

Only **file-request fulfilments** become `hub_files` docs (that is the stated requirement:
"upload file/attach link which goes to the file system of barro industries"). Expense receipts
stay as plain URLs on the expense line — they are evidence attached to a money request, exactly
like payslip proofs (js/screens/hr.js:4509), and hub-filing every receipt would spam the hub.

### 6.3 The hub_files doc (written by `LayoffSvc.fulfilRequest`, employee context)

Copy the WS38 Spec-1 shape verbatim from js/departments.js:1353-1366, with these values:

```js
const FV = firebase.firestore.FieldValue, nowIso = new Date().toISOString();
// Who can see it: NOT company-visible (a layoff document can be sensitive —
// clearances, medical papers). visibility:'private' + an explicit share to the
// HR tier, expanded to uids NOW (the FilesHub.share precedent, js/drive.js:630
// — dept/role targets are always expanded client-side because rules prove
// sharing with uid arrays only). President/manager read everything anyway
// (hub_files rules isSeniorAdmin()); the shares make HR-department members'
// 3-query fan-out (sharedUserIds array-contains) find it.
const usersSnap = await dbCachedGet('users', () => db.collection('users').get(), 30000);
const hrUids = usersSnap.docs.map(d=>({id:d.id,...d.data()}))
  .filter(u => u.role !== 'partner' && (
     ['president','manager'].includes(u.role) ||
     u.department === 'HR' || (u.departments||[]).includes('HR')))
  .map(u => u.id);
const hubRef = await db.collection('hub_files').add({
  name: result.name, description: `Layoff document — ${req.description}`.slice(0,300),
  fileType: 'Other',
  kind: result.source === 'link' ? 'link' : 'file',
  scope: 'hr_layoff', department: 'HR', folderId: null,
  url: result.url, driveUrl: null,
  size: file?.size || null, contentType: file?.type || null,
  source: result.source || 'firebase', currentV: 1,
  versions: [{ v:1, url:result.url, name:result.name, size:file?.size||null,
    contentType:file?.type||null, note:'', by:currentUser.uid,
    byName:(userProfile?.displayName||currentUser.email), at: nowIso }],
  archived:false, deleted:false, deletedAt:null, deletedBy:null,
  visibility:'private',
  sharedUserIds: hrUids, editorUserIds: [],
  shares: [{ type:'role', id:'hr-tier', label:'HR & Management', perm:'view',
    by:currentUser.uid, byName:(userProfile?.displayName||currentUser.email), at: nowIso }],
  uploadedBy: currentUser.uid, uploaderName:(userProfile?.displayName||currentUser.email),
  createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() });
```

This satisfies the EXISTING hub_files create rule unchanged (firestore.rules:3720-3723:
non-partner, `uploadedBy == auth.uid`, visibility in ['company','private'], `deleted == false`).
**No hub_files rules change needed.**

### 6.4 Making it findable in the Files Hub UI

**File: js/screens/people.js**, `SEED_SCOPES` in `renderFilesHub` (:2772-2784). Add after the
`'sss'`/`'accounting'` Finance pair:

```js
    { key:'hr_layoff',       label:'Layoff Documents',  dept:'HR'         },
```

HR-department members see the chip and their `FilesHub.loadFiles('hr_layoff')` fan-out finds the
docs via `sharedUserIds array-contains`. President/manager get the broad read. The secretary
subtraction logic (:2798-2801) doesn't block `dept:'HR'`, which matches canHrView — fine.
The HR layoff detail screen ALSO links each fulfilment directly (fileUrl on the request doc), so
the hub is the archive, not the only door.

---

## 7. Firestore rules — paste-ready

**File: firestore.rules.** Deploy with `~/.npm-global/bin/firebase deploy --only firestore:rules`
(project `barro-industries`) — `git push` does NOT deploy rules. Per the house memory: re-run
`git diff firestore.rules` immediately before deploying so a full-file deploy doesn't ship
another session's uncommitted edits.

### 7.1 Freeze the pointer — edit `userPrivilegedFieldsUnchanged()` (:245-281)

Insert after the `reinstatedBy` line (:276), before the identity-binding call:

```js
          // LAYOFF-SPEC — the layoff pointer map is privileged: an employee
          // must never lift (or place!) their OWN layoff via a raw client
          // write, and the secretary's isAdmin() branch calls this helper so
          // freezing it here keeps that role view-only on layoffs too. HR-dept
          // members and senior admins write it via their own branches below.
          && n.get('layoff', null)       == o.get('layoff', null)
```

### 7.2 Users update — new HR branch (:515-528)

The existing `allow update` disjunction gains ONE branch, appended after the offboarding branch
(:525-527), inside the same `(...)`:

```js
        ||
        // LAYOFF-SPEC — HR-dept members (any role except partner — isHrDept()
        // excludes partners itself) plus the senior branch above may toggle
        // ONLY the layoff pointer map on ANOTHER user's doc; never president,
        // never self (self-lift laundering). `layoff` is ONE top-level map
        // key, so hasOnly(['layoff']) covers place (map) and lift (null).
        (isHrDept() && !isOwner(uid)
          && resource.data.get('role', 'employee') != 'president'
          && request.resource.data.diff(resource.data).affectedKeys()
               .hasOnly(['layoff']))
```

(Senior admins — president/manager — already pass via `isPresident()` / the `isSeniorAdmin()`
branch, which does not call `userPrivilegedFieldsUnchanged`, so the §7.1 freeze does not block
them. The secretary's `isAdmin()` branch DOES call it → view-only, as ruled. Do NOT touch
`onlyOffboardingFieldsChanged()`.)

### 7.3 Three new collection blocks

Insert as a group directly AFTER the `cash_advances` block's closing brace (:970), before
`// ── Tasks`:

```rules
    // ── Layoff (LAYOFF-SPEC 2026-08-19) ─────────────────────────────────
    // Owner ruling: HR-department members + president/manager place and lift
    // layoffs, no approval step. The Corporate Secretary / Accountant keep
    // SIGHT via canHrView() (same split as leave_requests/attendance above)
    // and never the write verb. One doc per layoff EPISODE — history is
    // retained after lifting (status flips to 'lifted', doc is never
    // deleted; delete is president-only cleanup).
    // The live pointer lives on users/{uid}.layoff (frozen in
    // userPrivilegedFieldsUnchanged; HR writes it via the hasOnly(['layoff'])
    // branch in the users update rule).
    match /layoffs/{docId} {
      // Employee reads their own episode(s); HR surface reads all. The HR
      // list queries (status=='active' / 'lifted' / uid==X) are provable via
      // the role disjunct; the employee side never lists (the pointer carries
      // everything) but may resolve their own doc.
      allow read: if isAuth() && (
        resource.data.get('uid', '') == request.auth.uid || canHrView()
      );
      allow create: if isAuth() && (isSeniorAdmin() || isHrDept())
        && request.resource.data.keys().hasOnly(
             ['uid','userName','employeeId','reason','status','effectiveDate',
              'placedBy','placedByName','createdAt',
              'liftedAt','liftedBy','liftedByName','liftNote'])
        && request.resource.data.get('status', '') == 'active'
        && request.resource.data.get('uid', '') != request.auth.uid
        && request.resource.data.get('placedBy', '') == request.auth.uid
        && request.resource.data.get('reason', '') != ''
        && isBoundedString(request.resource.data.get('reason', ''), 2000)
        && isBoundedString(request.resource.data.get('userName', ''), 200)
        && isBoundedString(request.resource.data.get('employeeId', ''), 50)
        && isBoundedString(request.resource.data.get('effectiveDate', ''), 20)
        && isBoundedString(request.resource.data.get('placedByName', ''), 200);
      // Lift / edit-reason-while-active. Status may only ever be
      // 'active'|'lifted'; uid is immutable (an episode can't be re-pointed).
      allow update: if isAuth() && (isSeniorAdmin() || isHrDept())
        && request.resource.data.get('uid', '') == resource.data.get('uid', '')
        && request.resource.data.get('status', '') in ['active', 'lifted']
        && isBoundedString(request.resource.data.get('reason', ''), 2000)
        && isBoundedString(request.resource.data.get('liftNote', ''), 1000);
      allow delete: if isAuth() && isPresident();
    }

    // ── Layoff expenses — the Statement of Account lines ─────────────────
    // Mirrors cash_advances: the employee files their OWN line as 'pending';
    // only the layoff-write tier moves status/money. Employee may edit or
    // withdraw a line ONLY while it is still pending; after HR has decided,
    // the line is theirs to read, not to touch.
    match /layoff_expenses/{docId} {
      allow read: if isAuth() && (
        resource.data.get('uid', '') == request.auth.uid || canHrView()
      );
      allow create: if isAuth() && !isPartner()
        && request.resource.data.get('uid', '') == request.auth.uid
        && request.resource.data.get('status', '') == 'pending'
        && isNonNegNumber(request.resource.data.get('amount', 0))
        && request.resource.data.get('description', '') != ''
        && isBoundedString(request.resource.data.get('description', ''), 1000)
        && isBoundedString(request.resource.data.get('userName', ''), 200)
        && isBoundedString(request.resource.data.get('expenseDate', ''), 20)
        && isBoundedString(request.resource.data.get('layoffId', ''), 128)
        && (request.resource.data.get('receiptUrl', null) == null
            || isBoundedString(request.resource.data.get('receiptUrl', ''), 500))
        && (request.resource.data.get('receiptName', null) == null
            || isBoundedString(request.resource.data.get('receiptName', ''), 300))
        && request.resource.data.keys().hasOnly(
             ['layoffId','uid','userName','description','amount','expenseDate',
              'receiptUrl','receiptName','receiptKind','status',
              'approvedAmount','hrNote','decidedAt','decidedBy','decidedByName',
              'paidAt','paidDate','paidBy','paidByName','paidMethod',
              'createdAt','updatedAt']);
      allow update: if isAuth() && (
        // HR decisions & payment. approvedAmount validated whenever present.
        ((isSeniorAdmin() || isHrDept())
          && request.resource.data.get('status', '') in
               ['pending', 'approved', 'rejected', 'paid']
          && (request.resource.data.get('approvedAmount', null) == null
              || isNonNegNumber(request.resource.data.get('approvedAmount', 0)))
          && isBoundedString(request.resource.data.get('hrNote', ''), 1000)) ||
        // Owner edit while (and only while) still pending — never the money
        // decision fields, never a status change, never re-owning.
        (resource.data.get('uid', '') == request.auth.uid
          && resource.data.get('status', '') == 'pending'
          && request.resource.data.get('status', '') == 'pending'
          && request.resource.data.get('uid', '') == request.auth.uid
          && request.resource.data.get('layoffId', '')
               == resource.data.get('layoffId', '')
          && isNonNegNumber(request.resource.data.get('amount', 0))
          && isBoundedString(request.resource.data.get('description', ''), 1000))
      );
      // Owner may withdraw a still-pending line; president cleans up anything.
      allow delete: if isAuth() && (
        isPresident() ||
        (resource.data.get('uid', '') == request.auth.uid
          && resource.data.get('status', '') == 'pending')
      );
    }

    // ── Layoff file requests — HR asks, the employee delivers ────────────
    match /layoff_file_requests/{docId} {
      allow read: if isAuth() && (
        resource.data.get('uid', '') == request.auth.uid || canHrView()
      );
      allow create: if isAuth() && (isSeniorAdmin() || isHrDept())
        && request.resource.data.get('status', '') == 'open'
        && request.resource.data.get('createdBy', '') == request.auth.uid
        && request.resource.data.get('description', '') != ''
        && isBoundedString(request.resource.data.get('description', ''), 1000)
        && isBoundedString(request.resource.data.get('userName', ''), 200)
        && isBoundedString(request.resource.data.get('layoffId', ''), 128)
        && request.resource.data.keys().hasOnly(
             ['layoffId','uid','userName','description','dueDate','allowLink',
              'status','createdAt','createdBy','createdByName',
              'fulfilledAt','hubFileId','fileUrl','fileName','fileKind',
              'updatedAt']);
      allow update: if isAuth() && (
        (isSeniorAdmin() || isHrDept()) ||
        // The employee's ONE legitimate update: fulfilling the request.
        // Locked to the fulfilment fields so the request text/ownership can
        // never be rewritten from the receiving end.
        (resource.data.get('uid', '') == request.auth.uid
          && request.resource.data.get('status', '') == 'fulfilled'
          && request.resource.data.diff(resource.data).affectedKeys()
               .hasOnly(['status','fulfilledAt','hubFileId','fileUrl',
                         'fileName','fileKind','updatedAt'])
          && (request.resource.data.get('fileUrl', null) == null
              || isBoundedString(request.resource.data.get('fileUrl', ''), 500))
          && (request.resource.data.get('fileName', null) == null
              || isBoundedString(request.resource.data.get('fileName', ''), 300)))
      );
      allow delete: if isAuth() && (isSeniorAdmin() || isHrDept());
    }
```

Notes for the implementer:
- Every field read uses `.get(field, default)` — the missing-field-throws hazard (project
  memory) denies the whole rule otherwise.
- `notifications` create rule (:742-787) needs **NO change**: layoff notifications use only
  allowlisted fields (`title,body,icon,type,link,read,createdAt,dedupKey,senderUid`), and `type`
  is a free-form bounded string.
- `hub_files` / `hub_folders` need **NO change** (§6.3).
- **No `firestore.indexes.json` change** (§1.4).
- Ruling 4 acknowledged: the ~40 existing department collection blocks are NOT touched. See §12.

---

## 8. Notifications

All via `window.Notifs` (js/notifications.js:519 `send`, :598 `sendToDept`). **`title` and
`icon` are PLAIN emoji + text — never `emojiIcon()`** (ci check 5/6 greps for violations).
`link` values are page keys — `_navigateFromNotif` (js/notifications.js:142-179) falls through
to `navigateTo(link)` for types it doesn't special-case, which is exactly what we want.

| # | Trigger (writer) | Recipient | send call |
|---|---|---|---|
| N1 | `LayoffSvc.place` | employee | `Notifs.send(uid, { title:'🔒 You have been placed on layoff', body:'Reason: ' + reason.slice(0,180) + ' — open your dashboard for your statement of account.', icon:'🔒', type:'layoff_placed', link:'dashboard', dedupKey:'layoff-placed-'+layoffId })` |
| N2 | `LayoffSvc.lift` | employee | `Notifs.send(uid, { title:'✅ Your layoff has been lifted', body:'Welcome back — your full access is restored.', icon:'✅', type:'layoff_lifted', link:'dashboard', dedupKey:'layoff-lifted-'+layoffId })` |
| N3 | `LayoffSvc.submitClaim` | HR dept | `Notifs.sendToDept('HR', { title:'🧾 Layoff expense claim', body:userName+' claims '+fmtPeso(amount)+' — '+description.slice(0,120), icon:'🧾', type:'layoff_expense', link:'dept:HR', dedupKey:'layoff-exp-'+ref.id }, { fallbackToOwner:true })` |
| N4 | `approveClaim` | employee | `Notifs.send(uid, { title:'✅ Expense approved', body:fmtPeso(approvedAmount)+' approved for: '+description.slice(0,120), icon:'✅', type:'layoff_expense_approved', link:'dashboard', dedupKey:'layoff-exp-app-'+claim.id })` |
| N5 | `rejectClaim` | employee | `Notifs.send(uid, { title:'❌ Expense rejected', body:description.slice(0,100)+' — '+hrNote.slice(0,120), icon:'❌', type:'layoff_expense_rejected', link:'dashboard', dedupKey:'layoff-exp-rej-'+claim.id })` |
| N6 | `markPaid` | employee | `Notifs.send(uid, { title:'💰 Reimbursement paid', body:fmtPeso(approvedAmount)+' paid'+(paidMethod?' via '+paidMethod:'')+' for: '+description.slice(0,100), icon:'💰', type:'layoff_expense_paid', link:'dashboard', dedupKey:'layoff-exp-paid-'+claim.id })` |
| N7 | `createFileRequest` | employee | `Notifs.send(uid, { title:'📎 HR requested a document', body:description.slice(0,150)+(dueDate?' · due '+dueDate:''), icon:'📎', type:'layoff_file_request', link:'dashboard', dedupKey:'layoff-req-'+ref.id })` |
| N8 | `fulfilRequest` | HR dept | `Notifs.sendToDept('HR', { title:'📥 Layoff document received', body:userName+' sent: '+(fileName||req.description).slice(0,120), icon:'📥', type:'layoff_file_fulfilled', link:'dept:HR', dedupKey:'layoff-req-done-'+req.id }, { fallbackToOwner:true })` |

`sendToDept('HR', ...)` fans out on `department=='HR'` OR `departments array-contains 'HR'`
(js/notifications.js:603-606); `fallbackToOwner` routes to the President when nobody is in HR.
The secretary carve-out (:628-631) only applies to Finance/IT — HR sends reach a secretary in the
HR dept, which is correct.

**Edits in js/notifications.js:**

1. `NOTIF_TYPE_META` (:188-250) — add under the "Attendance" family block:

```js
    // Layoff (LAYOFF-SPEC)
    layoff_placed:{icon:'🔒',accent:'#D92D20'}, layoff_lifted:{icon:'✅',accent:'#2F9E44'},
    layoff_expense:{icon:'🧾',accent:'#E8590C'}, layoff_expense_approved:{icon:'✅',accent:'#2F9E44'},
    layoff_expense_rejected:{icon:'❌',accent:'#D92D20'}, layoff_expense_paid:{icon:'💰',accent:'#2F9E44'},
    layoff_file_request:{icon:'📎',accent:'#7048E8'}, layoff_file_fulfilled:{icon:'📥',accent:'#1C7ED6'},
```

2. `NAV_TYPES` (:316) — although every layoff notification carries `link` (which alone makes it
tappable via `isNavigable`), add the eight types for robustness:
`'layoff_placed','layoff_lifted','layoff_expense','layoff_expense_approved','layoff_expense_rejected','layoff_expense_paid','layoff_file_request','layoff_file_fulfilled'`.

3. `_navigateFromNotif` (:142-179): **no edit** — the trailing `else if (link) navigateTo(link)`
branch handles all eight (none of the earlier type-prefix branches match `layoff*`).

---

## 9. statusBadge2 domains

**File: js/ui-status-meta.js.** Add two tables next to `CA_STATUSES` (:121-127):

```js
  // ── Layoff (LAYOFF-SPEC 2026-08-19) ────────────────────────────────────
  const LAYOFF_EXPENSE_STATUSES = [
    { id: 'pending',   label: 'Pending',   badge: 'badge-orange' },
    { id: 'approved',  label: 'Approved',  badge: 'badge-green'  },
    { id: 'paid',      label: 'Paid',      badge: 'badge-blue'   },
    { id: 'rejected',  label: 'Rejected',  badge: 'badge-red'    },
  ];
  const LAYOFF_REQUEST_STATUSES = [
    { id: 'open',      label: 'Awaiting upload', badge: 'badge-orange' },
    { id: 'fulfilled', label: 'Submitted',       badge: 'badge-green'  },
  ];
```

and register them in `REGISTRY` (:143-171):

```js
    layoff_expense: LAYOFF_EXPENSE_STATUSES,
    layoff_request: LAYOFF_REQUEST_STATUSES,
    layoff: [
      { id:'active', label:'On Layoff', badge:'badge-red'  },
      { id:'lifted', label:'Lifted',    badge:'badge-gray' },
    ],
```

Never hand-roll badge classes in layoff.js — always `statusBadge2('layoff_expense', s)` etc.

---

## 10. File-by-file work order & parcels

| # | File | Change | §§ | Parcel |
|---|---|---|---|---|
| 1 | js/config.js | `isLaidOff` + `LAYOFF_ALLOWED_PAGES` (:503-ish); NAV_REGISTRY `sidebar.laidOff` + `bottom.laidOff`; `DEPARTMENTS['HR'].subtabs` +'Layoff' | 2.1, 2.2, 5 | **A** |
| 2 | js/app.js | `_navVariant` laidOff-first; buildNav search-btn hide; navigateTo gate; `'dashboard'` case; boot guards; claims-listener piggyback | 2.2-2.6 | **A** |
| 3 | index.html | `<script defer src="js/screens/layoff.js">` after dashboards.js (:763) | 3 | **A** |
| 4 | sw.js | PRECACHE `'/js/screens/layoff.js',` after dashboards.js entry (:98). NOT CACHE_VER | 3 | **A** |
| 5 | js/screens/layoff.js | **NEW** — whole feature surface | 3, 4, 6, 8 | **B** |
| 6 | js/screens/dashboards.js | `renderDashboard` dispatch; `renderPersonalFinance` CA trims | 2.4, 2.8 | **C** |
| 7 | js/screens/hr.js | Layoff card in `renderHR` | 5 | **C** |
| 8 | js/chat.js | `dmCandidates` + `myDeptChannels` layoff filters | 2.7 | **C** |
| 9 | js/screens/people.js | `SEED_SCOPES` +'hr_layoff' | 6.4 | **C** |
| 10 | js/notifications.js | NOTIF_TYPE_META + NAV_TYPES entries | 8 | **C** |
| 11 | js/ui-status-meta.js | two new domains + registry entries | 9 | **C** |
| 12 | firestore.rules | §7.1 freeze, §7.2 branch, §7.3 three blocks | 7 | **D** |

**Parcels (run B, C, D in parallel; A last or first but alone):**
- **Parcel A — chrome & boot** (single owner of the four HIGH-CONTENTION files: js/config.js,
  js/app.js, index.html, sw.js). Per the version-hook memory, ONE agent only ever touches these;
  no other parcel may edit them.
- **Parcel B — the new screen** (js/screens/layoff.js only; no contention by construction).
- **Parcel C — integrations** (dashboards.js, hr.js, chat.js, people.js, notifications.js,
  ui-status-meta.js — six files, all single-owner within C).
- **Parcel D — rules** (firestore.rules only, plus the deploy).

No file appears in two parcels. Cross-parcel calls are all runtime `window.*` lookups with
`&&`/`typeof` guards as specified, so partial landings never throw. Commit order doesn't matter
for correctness, but ship rules (D) before or with the first client parcel that writes the new
collections, or writes will be denied.

---

## 11. Verification checklist (concrete)

**Static (grep from repo root):**
1. `bash scripts/ci-invariants.sh` → all 6 checks PASS (PRECACHE completeness proves #4;
   drawer-icons proves the laidOff variant introduced no unstyled page key; text-sinks proves no
   `emojiIcon()` leaked into a notification field).
2. `grep -n "emojiIcon" js/screens/layoff.js` → no hit inside any `Notifs.send*` title/body/icon
   argument (HTML template usage is fine).
3. `grep -c "escHtml" js/screens/layoff.js` → ≥ 15 (reason, descriptions, names, notes, file
   names are ALL escaped).
4. `grep -n "toISOString" js/screens/layoff.js` → only the hub_files `versions[].at`/`shares[].at`
   ISO stamps (the WS38 shape requires them); no date-LOGIC use.
5. `grep -n "layoff" firestore.rules` → hits in `userPrivilegedFieldsUnchanged`, the users update
   branch, and the three new blocks; `grep -n "layoff" firestore.indexes.json` → ZERO hits.
6. `grep -n "layoff.js" index.html sw.js` → one hit each.
7. `node -e "new Function(require('fs').readFileSync('js/screens/layoff.js','utf8'))"` → no
   syntax error (repeat for each edited js file).

**Browser (`npx serve -p 3838 .` → http://localhost:3838; hard-reload + SW update per the
deploy-delivery memory — verify the version banner BEFORE debugging anything):**
8. President: HR dept → Layoff card visible; place a TEST employee on layoff (reason with
   `<b>xss</b>` — must render literally, not bold); row appears under On Layoff.
9. Test employee session (before reload if concurrently signed in): within seconds the toast
   fires, nav collapses to Dashboard/Chats/My Payslips, dashboard shows the banner with the
   reason.
10. As the laid-off employee: hand-type `#/dept/Finance`, `#/tasks`, `#/attendance`,
    `#/cash-advances`, `#/my-profile` → each lands on the layoff dashboard. `#/chat`,
    `#/notifications`, `#/personal-finance` → load normally. My Finance shows payslips but NO
    "+ Cash Advance" button and no Cash Advance entry card. Chat "New Message" lists only
    HR/president/manager. Global-search magnifier hidden.
11. Employee adds an expense claim (amount `123.45`, receipt link) → appears Pending; totals
    row shows Submitted ₱123.45. Edit it; withdraw a second test line.
12. HR: open the detail → Approve with adjusted amount `100`; employee sees "Owed to you ₱100.00"
    + approved badge + adjusted figure. Reject another line with a reason → reason visible to
    employee. Mark the approved line paid → Paid badge, Paid total ₱100.00, Owed ₱0.00. Each step
    fires exactly one notification (check both inboxes; re-running does not duplicate —
    dedupKeys).
13. Rapid double-click every money button → single write each (busy()).
14. HR requests a document (allowLink on) → employee sees it, attaches a link → request flips to
    Submitted, HR gets N8, and Files Hub → Layoff Documents chip (as an HR member AND as
    president) shows the hub_files doc; as an unrelated employee the doc is NOT visible
    (visibility private).
15. Console as the laid-off employee:
    `db.collection('users').doc(uid).update({layoff:null})` → PERMISSION_DENIED;
    `db.collection('layoff_expenses').doc(<approved id>).update({status:'paid'})` → DENIED;
    `db.collection('layoff_expenses').doc(<approved id>).update({amount:99999})` → DENIED.
    Console as secretary: `db.collection('layoffs').add({...})` → DENIED;
    `db.collection('layoffs').where('status','==','active').get()` → allowed.
16. Lift the layoff → employee toasts, chrome restores, dashboard normal; History tab shows the
    lifted episode; place the SAME employee on layoff again → works (repeatability), history
    keeps both episodes.
17. Type-B check: set a test account `payClass:'production'`, lay off → dashboard shows the
    layoff view (not renderWorkerHome), bottom nav is the laidOff 3-tab bar.
18. Roles sweep: manager can place/lift; an HR-department `employee` can place/lift; secretary
    and finance see the Layoff card "· view only" with no write buttons; a normal employee has
    no Layoff card.

**Ship:** commit normally — the pre-commit hook bumps `APP_VERSION` and derives `CACHE_VER`
(never hand-edit either; `git diff --cached` before committing per the re-stage-footgun memory).
Deploy rules separately (§7 header). After `git push`, verify the live version string on a
device before calling anything broken.

---

## 12. Residual risks (explicit)

1. **Ruling-4 gap — old department data stays readable outside the UI.** Enforcement is nav +
   router + rules on the NEW collections only. A laid-off employee with devtools can still run
   direct Firestore queries against every collection their role/departments granted before
   (tasks, dept docs, attendance, chat threads, company-visible hub_files, ...). Accepted by
   owner ruling 4; closing it means threading a layoff check through ~40 rule blocks (server-side
   `users/{uid}.layoff.active` lookups), which is a separate, deliberate pass. Documented here so
   nobody mistakes the UI lockdown for a data boundary.
2. **A laid-off HR member could lay off / lift others via console.** `isHrDept()` in rules doesn't
   know about layoff. The UI hides HR, but the rules verb remains. Same family as risk 1; fix
   belongs to the same future rules pass (add `get(...users/$(request.auth.uid)).data.get('layoff',{}).get('active',false) != true` to the write gates if Neil wants it).
3. **Self-create with a layoff field.** The users CREATE rule (:407-422) doesn't forbid `layoff`
   on a brand-new self-signup doc; a user could create their own doc pre-flagged. Self-harm only
   (locks themselves out; HR can lift), no privilege gained. Left as-is to keep the rules diff
   minimal.
4. **Existing chat threads stay open** (§2.7 restricts only NEW conversations and dept channels).
   Deliberate — an inbox list rule cannot prove a role filter (see js/chat.js:405-411).
5. **Push notifications keep flowing** for everything the user is still a party to (tasks they're
   still assigned to, etc.). The boot guards silence attendance/deadline reminders only. If HR
   wants full silence, that's task reassignment, not a layoff feature.
6. **`sendToDept('HR')` reaches a secretary who is IN the HR department** — consistent with
   canHrView sight, but means a view-only role gets actionable-looking notifications; the link
   lands them on a view-only screen, which is honest.
7. **Concurrent-edit hazard**: parcels A and C touch files other live sessions also edit
   (app.js, dashboards.js). Re-diff before committing; one agent per shared file (§10).
8. **OneDrive mtime race** on Edit calls — see §0 last bullet for the fallback procedure.
