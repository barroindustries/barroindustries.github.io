# Workstream 41 — My Profile tab + Facebook-inspired shell redesign

*This is a post-hoc workstream, added 2026-07-11 after the full 40-workstream v12 plan
(Phases 1-5) shipped. Unlike WS28-40, there is no prior grounding brief for this — this file
is BOTH the grounding recon AND the architecture decision, written in one pass. Read the
owner mandate below, ground it in the real current code, resolve every open decision, and
write your spec as `## DECIDED` (exact enough for Sonnet to implement with no further
judgment calls: function signatures, before/after code, data shapes, migration steps, exact
`firestore.rules`/`storage.rules` diffs where relevant, and a rollout/test checklist).*

## Owner mandate, verbatim (Neil Barro, 2026-07-11)

> add this on the instructions for fable to architect
> create a my profile tab
> Id
> Personal FInance and performance, and personal analytics
> Tasks
> Recent Activities
>
> Thats where these will be
>
> web layout and mobile layout take inspiration from facebook layout
>
> Desktop and Ipad
> Top Nav
> Profile Icon
> Chats Icon
> Notifications Icon
> Menu Icon
> Departments Icon
> Search Bar/Icon
> Barro Industries Logo and TItle
>
> Left Navigation
> the other important parts
> Tasks
> Posts
> Company
> etc etc,

## How to read this mandate

- **A new "My Profile" tab/page**, containing (as sub-sections/sub-tabs within it):
  - **ID** — presumably surfaces the existing employee/worker ID card (WS27, shipped:
    QR-verified, printable at CR80 size) inside the profile instead of/in addition to wherever
    it lives today. Ground where WS27's ID card currently renders and who can reach it.
  - **Personal Finance and Performance** — the signed-in user's own pay/performance view:
    likely their own payslip history, YTD figures, EOM (Employee of the Month) standing if
    applicable, raises history, cash-advance balance — scoped to *their own* record only
    (never another employee's, except president/finance who already have that access
    elsewhere). Ground what personal-finance data already exists per-user and where it's
    currently surfaced (if anywhere) vs. buried in admin-only screens.
  - **Personal Analytics** — individual-level metrics: attendance rate, task completion,
    on-time delivery if relevant to their role, etc. Distinct from WS40's org-wide Analytics/
    Insights (Analytics dept tab) — this is "analytics about me," not "analytics about the
    company." Ground whether WS40's `window.Insights`/metric helpers can be reused per-user or
    need new per-user aggregation.
  - **Tasks** — the user's own task list. Ground whether this duplicates/should link to the
    existing Tasks department screen (scoped to "assigned to me") rather than reimplementing
    task rendering.
  - **Recent Activities** — an activity feed of the user's own recent actions across the app
    (posts, task updates, approvals, chat — whatever is realistically loggable without a new
    heavyweight audit-log system). Ground what activity/audit trails already exist (e.g.
    `contactLog`, `stageHistory`, notification history) that could source this without a new
    collection, vs. what would need one.

- **A Facebook-inspired shell redesign**, explicitly scoped by device tier:
  - **Desktop and iPad**: a persistent **top nav bar** — Barro Industries logo + title on one
    side, then icon-only buttons for: **Profile** (opens the new My Profile tab), **Chats**
    (opens WS37's Team Chat, shipped), **Notifications** (opens the existing `Notifs` bell/
    inbox), **Menu** (a catch-all, ground what this should contain — likely settings, sign
    out, theme toggle, keyboard-shortcuts cheat sheet, the things that don't fit elsewhere),
    **Departments** (a department switcher — ground how department navigation currently works
    for multi-department users), and a **Search bar/icon** (WS18's global search, shipped,
    Ctrl/⌘K-triggered). This is explicitly modeled on Facebook's own top bar (logo left,
    search center-left, icon cluster right: profile/messages/notifications/menu).
  - **Left navigation**: simplifies down to "the other important parts" — the owner names
    **Tasks, Posts, Company** as explicit examples and says "etc etc," meaning: whatever
    remains after Profile/Chats/Notifications/Departments move to the top bar. Ground the
    current full sidebar contents (`getSidebarItems()` in app.js, per role) and propose which
    items stay in the simplified left nav vs. move to the top bar vs. move into My Profile vs.
    move into a department's own space now that Departments has a dedicated top-bar entry.
  - **Mobile**: the owner says mobile layout should also "take inspiration from Facebook
    layout" but did NOT specify mobile's exact icon set the way they did for desktop/iPad —
    this is a genuine open decision. Facebook's own mobile app uses a bottom tab bar (5 icons:
    Home/Friends-or-Video/Marketplace-or-Groups/Notifications/Menu) plus a top bar with
    search+Messenger+notifications icons. The app already has a `*_BOTTOM_NAV` per-role array
    system (`window.BOTTOM_NAV_ITEMS`, `PRESIDENT_BOTTOM_NAV`, `PARTNER_BOTTOM_NAV`,
    `PARTNER_GENERIC_BOTTOM_NAV`, `BRILLIANT_BOTTOM_NAV` in config.js) — decide whether the
    redesign reshapes these existing arrays (adding Profile/Chats icons to the bottom nav,
    since mobile has no room for a full top-bar icon cluster) or introduces something new.
    Flag this specific point for Neil's confirmation since he didn't spell out the mobile icon
    set explicitly.

## Blast radius warning

This workstream touches the app's chrome on **every single page, every role** (president,
manager, employee, agent, finance, partner — 6 roles × their own nav variants) and **every
device tier** (desktop, iPad/tablet, mobile). Unlike a single department's screens, there is
no way to ship this incrementally per-department; it is inherently a cross-cutting shell
change. Because of that:

- Ground the **entire current navigation surface** before deciding anything: `getSidebarItems()`
  (app.js), the topbar markup (index.html + the CSS/JS that populates it), the `*_BOTTOM_NAV`
  arrays (config.js), `navigateTo()`'s router (app.js), how WS37's Chat nav entry and WS18's
  search were wired in (both landed today — they are the two most recent, most relevant
  precedents for "add a new global nav affordance" and should heavily inform this decision,
  not be reinvented).
- Decide a **migration/rollout path** that doesn't strand users mid-navigation on deploy (the
  same "legacy stage mapping" discipline WS28 used for production stages, and the "grandfather
  read-only" discipline several other workstreams used for legacy collections, is the right
  model here too — but for UI chrome, not data).
- This is exactly the kind of workstream that should get **high/xhigh effort** per the
  original INDEX.md's own guidance ("money/security first... use high/xhigh effort there") —
  extend that guidance to "foundational shell architecture that every other screen depends on,"
  which is what WS10-11 (routing+dialogs) and WS17 (design system) were in the original plan.

## Expected deliverable format

Same bar as every other `fable-workplan/NN-*.md`: a `## DECIDED` section with resolved
decisions for every open question above (including the mobile icon-set question, marked
‼️ FLAG FOR NEIL if you can't confidently infer it from the Facebook-analogy instruction),
exact function signatures / before-after code for the new My Profile page and the shell
redesign, any new Firestore fields/collections needed (e.g. if Recent Activities needs a new
lightweight per-user activity log), `firestore.rules` diffs if any new collection is added, a
migration/rollout checklist that accounts for the full-app blast radius, and a manual test
checklist covering all 6 roles across desktop/tablet/mobile.

---

## GROUNDING — current state (Fable, 2026-07-11; every citation verified live on this checkout)

### G1 — The topbar (index.html:167-191)

Static markup, one instance, all roles:
- `#menu-toggle` ☰ (index.html:168) — the SIDEBAR hamburger, hidden on desktop (`display:none` base, styles.css:828-833), shown ≤768px (styles.css:2222). Toggles the off-canvas sidebar (app.js:1094-1100).
- `#nav-back-btn` ‹ (index.html:169) — `window.navBack = history.back` (app.js:1980); shown only when `_navDepth>0 && currentPage!=='dashboard'` (app.js:1974-1979). **The chevron IS device Back — do not touch.**
- Logo area (index.html:170-180): `.topbar-logo-card` (gold-trimmed BI logo, styles.css:838-869) + `.topbar-wordmark-stack` ("Barro Industries" / "Operating System · vX.Y.Z", version injected by `_applyBrandVersion`, index.html:308-319). So **"Barro Industries Logo and Title" already exists** — the mandate item is satisfied by the current markup, unchanged.
- `.topbar-right` (index.html:181-190): `#global-search-btn` 🔍 (hidden for partners/BS-only, shown+labelled in `buildNav`, app.js:897-899; `onclick="navigateTo('search')"`), `#notif-btn` 🔔 + `#notif-badge`, and `#topbar-avatar` (populated + `onclick = openProfileDrawer` in `applyUserUI`, app.js:552-557).
- A `theme-toggle-btn` is referenced by `_applyThemeIcon` (app.js:886-892) but **does not exist in index.html** — theme switching actually lives in the profile drawer's theme picker (app.js:7506-7510, 7584-7596). Dead reference, harmless.
- Bell behavior forks by width (notifications.js:670-702): ≤768px navigates to the `notifications` page; desktop toggles the `#notif-panel` dropdown (index.html:197-206; mobile CSS force-hides the panel, styles.css:2237-2238).

### G2 — The sidebar: `getSidebarItems()` (app.js:919-1015), FIVE role branches

1. **pres** (president OR manager OR secretary, app.js:923, 930-956): Dashboard, Analytics, Tasks, Posts, **Chat**, Company, Approvals(§), Progress Reports, Team Directory(§), HR (`dept:HR`), Attendance, **Departments** (page `departments`), Files (`files-hub`, WS38), Inventory(§Operations), Projects, Sales Orders, + president-only: Product Database(§Catalog), Audit Log(§Security). Comment at 957: *"(Leave, SOPs, Help moved into the profile drawer's 'More' section)"* — the drawer is already the declutter overflow.
2. **generic partner** (app.js:958-967): My Projects, My Tasks, Posts, **Chat**, Quote Builder(§Work Tools), Quotations, Team(§Directory), Files.
3. **Brilliant-Steel partner** (app.js:968-978): My Tasks, Posts, **Chat**, My Projects, Quote Builder(§), Quotations, Client Data, Team(§), Files.
4. **bsOnly** (internal BS-only staff, app.js:979-986): My Projects, **Chat**, Quote Builder, Quotations, Client Data, Files.
5. **employee/agent/finance** (app.js:987-1013): My Tasks, Posts, **Chat**, Company, then one `dept:X` item per membership under "My Departments" (app.js:997-1003; finance role force-prepends Finance), then Team(§Management), Attendance, **Personal Finance** (`personal-finance`, app.js:1007), Files, + conditional Inventory (Production members), Projects (Sales/Production/Finance), Sales Orders (Finance).

`buildSidebarNav` (app.js:1031-1054) renders items + section labels; `buildNav()` = `buildSidebarNav(); buildBottomNav(); buildTopNavStrip();` (app.js:895-903), called from the auth boot (app.js:86). Alt+1..9 jump keys and the `?` cheat sheet derive from `getSidebarItems()` live (app.js:7756-7763, 7790-7793) — reordering the sidebar auto-updates both.

### G3 — Mobile nav is a TOP STRIP, not a bottom bar

**Critical grounding fact the mandate's phrasing hides:** the app no longer renders a bottom tab bar. `buildBottomNav` is a no-op (app.js:1056-1062); `#bottom-nav` markup exists (index.html:251-253) but is `display:none !important` ≤768px (styles.css:2232). Mobile nav = `#top-nav-strip` (index.html:194), a horizontally-scrollable icon+label strip fixed directly UNDER the topbar (styles.css:897-942, `top: calc(var(--topbar-h) + safe-area)`, shown ≤768px at styles.css:2230; `--top-nav-h: 50px`, styles.css:100). `buildTopNavStrip` (app.js:1064-1086) renders the per-role `*_BOTTOM_NAV` array:
- `BOTTOM_NAV_ITEMS` (employee, config.js:293-300): Home, Tasks, Posts, Chat, Cash (`cash-advances`), Finance (`personal-finance`).
- `PRESIDENT_BOTTOM_NAV` (config.js:303-310): Home, Tasks, Posts, Chat, Team, Approve.
- `PARTNER_BOTTOM_NAV` (BS partner, config.js:313-319): Home, Projects, Chat, Quotes, Summary.
- `PARTNER_GENERIC_BOTTOM_NAV` (config.js:324-330): Home, Projects, Chat, Quotes, Tasks.
- `BRILLIANT_BOTTOM_NAV` (bsOnly, config.js:333-340): Home, Projects, Chat, Quotes, Summary, Clients.
Role→array routing in app.js:1067-1072. `setActiveNav` already highlights `.top-nav-item` (app.js:2073-2081). Facebook's own Android app is exactly this pattern (top bar + icon tab strip under it) — **the existing mobile chrome is already Facebook-shaped.**

### G4 — A "My Profile" drawer ALREADY EXISTS (and is really a Menu)

`#profile-drawer` (index.html:274-284, header literally titled "My Profile") ← `openProfileDrawer()` (app.js:7453-7643), opened by tapping the topbar avatar (app.js:552-557). Contents: avatar hero + photo upload, display-name edit, ACCOUNT rows (email/employeeId/role/dept), **COMPENSATION card** (base/allowance/deductions/net, app.js:7492-7499), SETTINGS (theme picker + phone), **MORE shortcuts** (Leave, Attendance, Holidays Admin [role-gated], SOPs, Help — app.js:7522-7537), NOTIFICATIONS toggles, Sign Out. It is NOT Overlay/history-registered (explicit note at app.js:7727-7730; Esc handled via `closeTopOverlay` DOM probe, app.js:7765-7771). **Read: the drawer is already the mandate's "Menu"; what's missing is a routed, content-bearing Profile PAGE.**

### G5 — Router

`navigateTo(page, opts)` (app.js:1982-2071): hash router (`#/page/subtab`, app.js:1959-1972), Overlay teardown, chat-inbox teardown hook (2007), `dept:` prefix dispatch to `renderDeptModule` (2023-2027), then the switch (2029-2070). New-page pattern (WS37 precedent, live at 2058): `case 'chat': window.renderChatPage?.(); break;` — optional chaining because modules.js/chat.js load after app.js. Subtab deep-links: screens read `window.currentSubtab` via `window.initialSubtab(defaultKey)` (config.js:944) and write back via `window.setSubroute(key)` (config.js:939); chip tabs via `window.chipTabs`/`bindChipTabs` (config.js:820, 839).

### G6 — WS37 (Chat) + WS18 (search) wiring precedents

WS37 added: `js/chat.js` loaded LAST (index.html:325), router case (app.js:2058), a Chat item in ALL FIVE sidebar branches (app.js:935, 963, 972, 982, 991) and ALL FIVE `*_BOTTOM_NAV` arrays, notif deep-link branch (`chat_message` → `_navigateFromNotif`), and a `navigateTo` teardown hook (app.js:2004-2007). WS18 added: `#global-search-btn` in the topbar + `window.Keymap` (app.js:7731-7874; Ctrl/⌘K + `/` → `navigateTo('search')` → `renderGlobalSearch`, modules.js:2487; partner/BS-only blocked at all three entry points).

### G7 — Notifications inbox (reuse, don't reinvent)

`window.Notifs` IIFE (notifications.js:7): `updateBadge` (29), `send/sendToDept/sendToAll` (258+), desktop dropdown `#notif-panel` / mobile `notifications` page (`Notifs.renderPage`, router case app.js:2047), `initToggle` fork at notifications.js:670-702. The mandate's "Notifications Icon" = the existing `#notif-btn`, unchanged.

### G8 — Personal surfaces to compose

- **ID (WS27):** `renderIDCard(containerId, u)` (app.js:3447-3564) — digital ID + calling-card 3D flip, QR verify token (`ensureEmployeeVerifyToken` → `id_verify/{token}`, app.js:3429-3445; rules firestore.rules:1319), CR80 print (`window.printIDCards`, app.js:3567). Rendered today on the president dashboard (`#pres-id-card-wrap`, app.js:2488→2602) and the employee dashboard (`#emp-id-card-wrap`, app.js:3068→3266). Partners never get one (photo gate exempts partners, app.js:568-572).
- **Personal Finance & Performance:** `window.renderPersonalFinance(currentUser, currentRole)` (app.js:4301). President/manager branch = TEAM table (4305-4467); everyone else gets the OWN view (4469+): net pay, KPI (`getKpiScore`, app.js:4916-4938), attendance (`getAttendanceScore`), cash advances (`cash_advances where userId==uid`, 4485), 12-month `salary_history` (4486; owner-readable per rules:517-522 — this exact `where userId orderBy month desc` query already runs in prod, so its index exists), applied raises (`salary_raises where subjectId==uid`, 4504), eval grades (`kpi_evals`), frozen-vs-projected payslip via the WS20 `computePayLine` (4529-4545), print payslip. **It renders into `#page-content` directly** (4302) — embedding it in a sub-tab needs a host param. It self-re-renders at app.js:4449, 4769, 4828.
- **Personal Analytics raw materials:** `getKpiScore(uid)` (task completion 70% + deliverable 30%, app.js:4916), `getAttendanceScore(uid)` (app.js:4649+), own-task % (employee dashboard KPI card, app.js:3245-3253), `salary_history` trend, eval grades. Both helpers are top-level declarations in the classic script → reachable as `window.getKpiScore`/`window.getAttendanceScore` from modules.js (which loads after app.js).
- **Tasks:** `window.renderTasks` (departments.js:747). President/finance variant has a "👤 My Tasks" subtab (departments.js:758-762); the employee variant's filter select DEFAULTS to `mine` (departments.js:782-786). So "assigned to me" already exists — the profile Tasks sub-tab must link/embed, not reimplement.
- **Attendance/Leave/CA pages:** `renderAttendancePage` (modules.js:993 — employees see their own calendar; pres/manager/finance get an employee selector), `renderLeavePage` (modules.js:2229), `renderCashAdvancePage` (modules.js:1383).

### G9 — WS40 Insights

`window.Insights` (config.js:650-717) is a PURE rule engine over an org-wide metrics bag `M` built by `renderAnalytics` (rules: net-negative, AR aging, win-rate drop, payroll ratio, on-time production, cash floor, inventory turns — all company-level). The shared metric helpers (config.js:568-632: `quoteWinStats`, `arAging`, `inventoryTurns`, `payrollRatio`) are org-scoped too. **Verdict: reuse the PATTERN (pure computation over a small metrics bag + existing cached reads), not the rules — personal analytics needs person-scoped inputs (`getKpiScore`/`getAttendanceScore`/own tasks/salary_history), all of which already exist. No new aggregation infrastructure.**

### G10 — Department switching today

Employees: one sidebar entry per membership (app.js:997-1003) — switching = clicking another sidebar item. Admins: every dept in the sidebar isn't listed; they get `dept:HR` plus a `departments` grid page (`renderDepartments`, app.js:6317-6345, gated president/manager/secretary) that opens any dept. Partners/bsOnly: no dept pages at all. There is NO dropdown/switcher control anywhere — the "Departments" top-bar icon is net-new chrome.

### G11 — Activity-shaped data already written

- `notifications/{uid}/items` — owner-readable (rules:182-183); everything that happened TO the user (task assignments, approvals, payroll, chat) — already surfaced by the bell, retention indefinite.
- `audit_log` — `window.logAudit(action, entity, entityId, details)` (config.js:760-775), ~30 call sites (payroll/raises/pay-runs/ledger/products/CA/quotes...), actor-stamped + rules-enforced (`actorUid == auth.uid`, `ts == request.time`, fixed key set — firestore.rules:1222-1238). **Read is `isAdmin()` only** — an employee cannot read their own trail today. A `where('actorUid','==',uid)` list query becomes provable with a one-line owner clause; `orderBy ts desc` on top needs one composite index.
- `contactLog` (clients, departments.js:293, 2641, 12106) and `stageHistory` (drawings/production, departments.js:13743, 14033) — ENTITY-keyed arrays, not queryable per user without scanning whole collections. **Rejected as feed sources.**
- Own-queryable event sources with existing rules: `tasks` (`assignedTo array-contains`, rules:282+), `leave_requests` (`userId`, rules:1242+), `cash_advances` (`userId`, rules:253+, existing query app.js:4485), `attendance/{uid}/records` (owner, rules ~201-210), `posts` (`authorId`, blanket authed-non-partner read, rules:166-172).

### G12 — CSS system

Design tokens in `:root` (styles.css:13-142): surfaces `--s0..s3`, `--surface/--border/--text*`, brand `--pink/--blue/--gold` + gradients, layout `--topbar-h:56px / --sidebar-w:258px / --top-nav-h:50px`, type scale `--fs-*`, component backgrounds `--topbar-bg` etc. Topbar buttons share `.notif-btn` (styles.css:944-951); 44px tap-target floor on mobile (styles.css:2244). Breakpoint: single `@media (max-width:768px)` flip (styles.css:2218-2260) — desktop/iPad share the ≥769px layout (fixed sidebar + topbar), phones get drawer sidebar + top strip. **No new tokens needed; fork `.notif-btn` and `.notif-panel` for the new chrome.**

---

## DECIDED — architecture spec (Fable, 2026-07-11)

### Resolved decisions (one line each + rationale)

1. **My Profile = a real routed page, `page:'my-profile'`, rendered by NEW `window.renderMyProfile()` in js/modules.js** (router calls it optional-chained, exactly like `chat`/`posts`). A page — not a drawer/panel — because it hosts five content sub-tabs with deep links (`#/my-profile/finance`), and because the hash router + chipTabs subtab machinery (G5) gives history/back/deep-linking for free.
2. **The existing profile drawer BECOMES the mandate's "Menu"** — retitled "Menu", reachable from a new `#topbar-menu-btn`; its COMPENSATION card moves into My Profile → Finance; everything else (name/photo edit, theme, phone, More shortcuts, notification toggles, Sign Out) stays. Rationale: the drawer already IS Facebook's Menu (settings + shortcuts + logout, G4); renaming beats rebuilding, and nothing else in the mandate covers settings.
3. **Topbar avatar re-targets to `navigateTo('my-profile')`** (it currently opens the drawer) — the avatar is the mandate's "Profile Icon"; Facebook's avatar goes to your profile, its hamburger goes to Menu. No separate profile icon button — the avatar is it.
4. **Five sub-tabs for internal users — `id` / `finance` / `analytics` / `tasks` / `activity` — via `chipTabs` + `initialSubtab('id')`/`setSubroute`.** Partners (generic, BS-partner, bsOnly) get a reduced set: `account` (simple info card) / `tasks` / `activity` — no ID (no company ID exists for partners, G8), no Finance (no payroll), no Analytics (KPI/attendance are internal constructs).
5. **ID sub-tab = the EXISTING `renderIDCard('mp-id-card-wrap', userProfile)` verbatim** (composition, zero new ID code). The dashboard ID cards (president + employee) STAY where they are — additive, zero-risk; removal is offered as an optional cleanup flag, not done here.
6. **Finance & Performance sub-tab = the EXISTING own-view branch of `renderPersonalFinance`, refactored to accept `opts = { host, selfOnly }`** (3-line signature change + 3 recursive-call-site updates, Spec 5). President/manager pass `selfOnly:true` so they see their OWN finance here (the team table remains on the `personal-finance` page, still routed and linked from dashboards, app.js:3253). This kills the buried-in-admin-screens problem without duplicating a 400-line renderer.
7. **Personal Analytics = NEW small `window.renderPersonalAnalytics(host, uid)` composing existing helpers** — `getKpiScore` + `getAttendanceScore` + own-tasks completion/overdue split + 6-month `salary_history` net-pay sparkline (`ensureChart`, config.js WS16) + eval grades. WS40's `Insights` rules are org-scoped (G9) and are NOT reused; the metrics-bag pattern is. No new collections, no new aggregation.
8. **Tasks sub-tab = a compact read-only "assigned to me" list (reusing the exact `assignedTo array-contains` query) + an "Open full Tasks →" button** to the real Tasks page (which already defaults to `mine` for employees, G8). No task CRUD inside the profile — one Tasks implementation stays canonical (departments.js:747).
9. **Recent Activities = a COMPOSED feed from collections the user can already read — NO new collection, NO new writer.** Sources (all `.catch(()=>({docs:[]}))`-wrapped): own `notifications` items (30), own `tasks`, own `leave_requests`, own `cash_advances`, last 14 own `attendance` records, own `posts`, own `audit_log` entries. `contactLog`/`stageHistory` rejected (entity-keyed, G11). A dedicated `user_activity` log collection is explicitly REJECTED for v1: it would need instrumentation at every write site across 4 files for data we can already derive.
10. **One rules edit + one index to unlock the audit trail for its own actor:** `audit_log.read` gains an owner clause (provable for `where actorUid==uid`), and `firestore.indexes.json` gains `(actorUid ASC, ts DESC)`. Privacy-safe: a user sees only entries they themselves generated (rules already force `actorUid == auth.uid` on create).
11. **Desktop/iPad topbar gains exactly two new icon buttons — Departments (`#topbar-depts-btn`) and Chats (`#topbar-chat-btn`) — plus Menu (`#topbar-menu-btn`, all widths).** Final right-cluster order (left→right): **Search · Departments · Chats · Notifications · Menu · Avatar(Profile)** — Facebook's logo-left/icon-cluster-right. Search stays an ICON button at all widths ("Search Bar/Icon" — the icon satisfies it; a fake pill input adds chrome with zero function since search is a full page + Ctrl/⌘K). All reuse the `.notif-btn` class — no new CSS component.
12. **Departments button behavior:** hidden for partners/bsOnly; single-dept internal user → navigates straight to `dept:{their dept}`; multi-dept user or admin → toggles a `#depts-panel` dropdown (forked from `.notif-panel`) listing their openable departments (admins: all 10 internal; employees: `currentDepts` with the finance-role Finance prepend, same derivation as the sidebar, app.js:997-999), with an admin-only footer link "All departments →" → `departments` page.
13. **Simplified left nav:** remove **Chat** from all five branches (top bar owns it), remove **Departments** from the admin branch (top bar owns it), remove **Personal Finance** from the employee branch (My Profile owns it). Everything else Neil gestured at stays: Tasks, Posts, Company, Approvals, Team, Attendance, Files, dept entries, operations pages. Employee per-dept sidebar entries STAY (they are the daily working doors; the top-bar switcher is a shortcut, not a replacement). All removed pages remain fully routed (deep links / dashboards / drawer shortcuts keep working) — the UI-chrome equivalent of "grandfather read-only".
14. **Mobile = reshape the EXISTING `*_BOTTOM_NAV` arrays (rendered as the top strip, G3) — no new nav system.** Employee: `Finance` slot becomes `Profile` (`my-profile`); Cash stays. All other role arrays APPEND a Profile item (strip scrolls horizontally, styles.css:907). Topbar on mobile: Depts + Chats buttons hidden (CSS ≤768px) — chat lives in the strip, departments in the ☰ sidebar; Menu button stays (the drawer is mobile-native chrome). ‼️ FLAG FOR NEIL (question below) since he never specified the mobile icon set.
15. **Rollout = one-shot, single commit, no feature flag/staged toggle.** Justification: the change is additive (new page, new buttons) + nav-entry-subtractive with all routes preserved, so an old cached client (pre-SW-update) keeps working against the same router, and a new client's deep links/hashes all resolve; a toggle would double the chrome states to test across 6 roles × 3 tiers for zero de-risking. Rules+index deploy FIRST (the activity feed degrades gracefully via `.catch` if rules lag, but deploy-first makes day one complete).
16. **New code lives in js/modules.js** (`renderMyProfile`, `renderPersonalAnalytics`, `renderRecentActivity`, `renderMyProfileTasksList`) — it composes app.js globals at runtime (legal: modules.js loads after app.js; guard with `typeof` per the G5/G8 load-order convention). No new script file → no index.html/PRECACHE additions.

**Cross-workstream:** supersedes WS37's Spec 6d/6e placements (Chat sidebar entries are REMOVED in favor of the topbar icon; Chat stays in every `*_BOTTOM_NAV` array). Composes WS27 (ID card), WS20/24 (payslip/finance view), WS18 (search untouched), WS40 (untouched). No Compute/payroll math is touched anywhere in this workstream.

---

### Spec 1 — index.html: topbar + depts panel (before → after)

**1a — `.topbar-right` (index.html:181-190) — BEFORE → AFTER:**
```html
<!-- BEFORE -->
<div class="topbar-right">
  <button class="notif-btn" id="global-search-btn" aria-label="Search" style="display:none" onclick="navigateTo('search')">
    <i data-lucide="search"></i>
  </button>
  <button class="notif-btn" id="notif-btn" aria-label="Notifications">
    <i data-lucide="bell" aria-hidden="true"></i>
    <span class="notif-badge hidden" id="notif-badge">0</span>
  </button>
  <div class="topbar-avatar" id="topbar-avatar">?</div>
</div>
<!-- AFTER  (order: Search · Departments · Chats · Notifications · Menu · Avatar) -->
<div class="topbar-right">
  <button class="notif-btn" id="global-search-btn" aria-label="Search" style="display:none" onclick="navigateTo('search')">
    <i data-lucide="search"></i>
  </button>
  <button class="notif-btn tb-wide" id="topbar-depts-btn" aria-label="Departments" style="display:none">
    <i data-lucide="layout-grid"></i>
  </button>
  <button class="notif-btn tb-wide" id="topbar-chat-btn" aria-label="Chats" style="display:none" onclick="navigateTo('chat')">
    <i data-lucide="message-circle"></i>
  </button>
  <button class="notif-btn" id="notif-btn" aria-label="Notifications">
    <i data-lucide="bell" aria-hidden="true"></i>
    <span class="notif-badge hidden" id="notif-badge">0</span>
  </button>
  <button class="notif-btn" id="topbar-menu-btn" aria-label="Menu">
    <i data-lucide="menu"></i>
  </button>
  <div class="topbar-avatar" id="topbar-avatar" role="button" aria-label="My Profile">?</div>
</div>
```
(`style="display:none"` on depts/chat = same show-per-role pattern as `global-search-btn`; `buildNav` flips them, Spec 3b. No chat unread badge v1 — an accurate count needs a global conversations listener, which WS37's 4-listener budget forbids; noted as a future enhancement.)

**1b — Departments dropdown panel — insert directly after `#notif-backdrop` (index.html:206):**
```html
<!-- Departments switcher panel (desktop/iPad; forked from notif-panel) -->
<div id="depts-panel" class="notif-panel hidden" style="max-width:300px">
  <div class="notif-panel-header"><span>Departments</span></div>
  <div id="depts-list" class="notif-list"></div>
</div>
<div id="depts-backdrop" class="notif-backdrop hidden"></div>
```

**1c — Profile drawer header (index.html:280) — BEFORE `<h3>My Profile</h3>` → AFTER `<h3>Menu</h3>`.**

### Spec 2 — CSS additions (css/styles.css; ~15 lines, zero new tokens)

Append near the topbar block (~styles.css:970):
```css
/* v12 WS41 — topbar icon cluster */
@media (max-width: 768px) {
  /* Depts + Chats are desktop/iPad-only: mobile has the ☰ sidebar (depts) and
     the top-nav-strip Chat item. Menu/avatar/bell/search stay. */
  #topbar-depts-btn, #topbar-chat-btn { display: none !important; }
}
#depts-panel .depts-item {
  display:flex; align-items:center; gap:10px; width:100%;
  padding:11px 14px; background:none; border:none; cursor:pointer;
  color:var(--text); font-size:var(--fs-base); text-align:left;
  border-bottom:1px solid var(--border);
}
#depts-panel .depts-item:hover { background: var(--s2); }
#depts-panel .depts-item:last-child { border-bottom:none; }
```
My Profile page styling reuses existing classes only: `.profile-hero`/`.profile-avatar-*` (drawer hero), `.chip-tab` bar, `.card`, `.data-table`. No new component CSS.

### Spec 3 — js/app.js wiring

**3a — `applyUserUI` (app.js:552-557) — BEFORE → AFTER:**
```js
// BEFORE
    ta.onclick = openProfileDrawer;
// AFTER  (avatar = Profile page; Menu button = the drawer — Decisions 2+3)
    ta.onclick = () => navigateTo('my-profile');
```
And add beside it (still inside `applyUserUI`, so it re-binds on every auth refresh):
```js
  const mb = document.getElementById('topbar-menu-btn');
  if (mb) mb.onclick = openProfileDrawer;
```
(The other drawer entry point at app.js:652 — first-login flow — stays as-is; it deliberately opens settings.)

**3b — `buildNav` (app.js:895-903) — append after the `global-search-btn` block:**
```js
  // v12 WS41 — Departments switcher + Chats topbar buttons
  const db_ = document.getElementById('topbar-depts-btn');
  const cb_ = document.getElementById('topbar-chat-btn');
  const switchable = deptsForSwitcher();                  // [] for partners/bsOnly
  if (db_) db_.style.display = switchable.length ? '' : 'none';
  if (cb_) cb_.style.display = '';                        // every role has Chat (WS37)
  buildDeptsPanel(switchable);
```

**3c — NEW `deptsForSwitcher()` + `buildDeptsPanel()` — insert after `buildTopNavStrip` (app.js:~1086):**
```js
// v12 WS41 — which departments the signed-in user can open from the topbar.
// Mirrors getSidebarItems' derivation exactly (incl. the finance-role Finance
// prepend, app.js:997-999). Partners/bsOnly: none (no dept pages exist for them).
function deptsForSwitcher() {
  if (isPartner() || isBrilliantOnly()) return [];
  const admin = isPresident() || currentRole === 'manager' || currentRole === 'secretary';
  const internal = Object.keys(DEPARTMENTS)
    .filter(d => !DEPARTMENTS[d].isSeparate && !DEPARTMENTS[d].isPartnerDept);
  if (admin) return internal;
  const mine = (currentRole === 'finance' && !currentDepts.includes('Finance'))
    ? ['Finance', ...currentDepts] : currentDepts;
  return mine.filter(d => DEPARTMENTS[d]);
}
function buildDeptsPanel(depts) {
  const list  = document.getElementById('depts-list');
  const panel = document.getElementById('depts-panel');
  const back  = document.getElementById('depts-backdrop');
  const btn   = document.getElementById('topbar-depts-btn');
  if (!list || !btn) return;
  const admin = isPresident() || currentRole === 'manager' || currentRole === 'secretary';
  list.innerHTML = depts.map(d => {
    const cfg = DEPARTMENTS[d];
    return `<button class="depts-item" data-page="dept:${escHtml(d)}">
      ${emojiIcon(cfg.lucideIcon || cfg.icon, 18)}<span>${escHtml(d)}</span></button>`;
  }).join('') + (admin
    ? `<button class="depts-item" data-page="departments" style="color:var(--primary-light)">
         ${emojiIcon('layout-grid',18)}<span>All departments →</span></button>` : '');
  if (window.lucide) lucide.createIcons({ nodes: [list] });
  const close = () => { panel.classList.add('hidden'); back.classList.add('hidden'); };
  list.querySelectorAll('.depts-item').forEach(b =>
    b.addEventListener('click', () => { close(); navigateTo(b.dataset.page); }));
  btn.onclick = (e) => {
    e.stopPropagation();
    if (depts.length === 1 && !admin) { navigateTo('dept:' + depts[0]); return; }   // single-dept: no dropdown
    const open = !panel.classList.contains('hidden');
    if (open) close(); else { panel.classList.remove('hidden'); back.classList.remove('hidden'); }
  };
  back.onclick = close;
}
```
(Depts panel is display-toggled chrome like `#notif-panel` — deliberately NOT Overlay/history-registered, matching the bell's precedent, G1/G4.)

**3d — router case — after `case 'chat'` (app.js:2058):**
```js
    case 'chat':             window.renderChatPage?.(); break;
    case 'my-profile':       window.renderMyProfile?.(); break;
```

**3e — `getSidebarItems` diffs (Decision 13) — exact line removals:**
- app.js:935 admin branch — DELETE `items.push({ icon:'message-circle',label:'Chat', page:'chat' });`
- app.js:942 admin branch — DELETE `items.push({ icon:'layout-grid', label:'Departments', page:'departments' });`
- app.js:963 generic-partner branch — DELETE the Chat push.
- app.js:972 BS-partner branch — DELETE the Chat push.
- app.js:982 bsOnly branch — DELETE the Chat push.
- app.js:991 employee branch — DELETE the Chat push.
- app.js:1007 employee branch — DELETE `items.push({ icon:'credit-card', label:'Personal Finance', page:'personal-finance' });`
No other sidebar edits. (Alt+1..9 and the `?` cheat sheet re-derive automatically, G2. `setActiveNav` needs nothing: `my-profile` simply matches no sidebar item, like `search` today.)

**3f — profile drawer trim (`openProfileDrawer`, app.js:7460-7571):**
- DELETE the COMPENSATION section (the `<div class="profile-section-label">COMPENSATION</div>` + its inset card, app.js:7493-7499) and the now-unused `const net=...` at 7458 — pay now lives in My Profile → Finance.
- In the hero (after app.js:7471), ADD a jump-off button:
```js
      <button class="btn-secondary btn-sm" style="margin-top:10px"
        onclick="closeProfileDrawer(); navigateTo('my-profile')">View My Profile →</button>
```
- Everything else in the drawer (name/photo/theme/phone/More/notif toggles/Sign Out) unchanged.

### Spec 4 — config.js `*_BOTTOM_NAV` diffs (mobile strip — Decision 14, ‼️ flagged)

```js
// BOTTOM_NAV_ITEMS (config.js:293-300) — REPLACE the Finance item:
//   { icon: 'credit-card',  label: 'Finance', page: 'personal-finance' }
// WITH:
     { icon: 'circle-user',  label: 'Profile', page: 'my-profile' }
// (Cash stays — CA filing is a high-frequency employee action.)

// PRESIDENT_BOTTOM_NAV (303-310), PARTNER_BOTTOM_NAV (313-319),
// PARTNER_GENERIC_BOTTOM_NAV (324-330), BRILLIANT_BOTTOM_NAV (333-340):
// APPEND to each:
     { icon: 'circle-user', label: 'Profile', page: 'my-profile' }
```
(7 items on the admin/BS strips is fine — the strip already scrolls horizontally, styles.css:907. `circle-user` is a valid Lucide 0.468 name; if it fails to resolve at implementation time, fall back to `user`.)

### Spec 5 — `renderPersonalFinance` host/selfOnly refactor (js/app.js)

**5a — signature + branch guard (app.js:4301-4305) — BEFORE → AFTER:**
```js
// BEFORE
window.renderPersonalFinance = async function(currentUser, currentRole) {
  const c = document.getElementById('page-content');
  const pres = isPresident() || currentRole === 'manager';
  if (pres) {
// AFTER
window.renderPersonalFinance = async function(currentUser, currentRole, opts) {
  opts = opts || {};                                   // { host?: Element, selfOnly?: bool }
  const c = opts.host || document.getElementById('page-content');
  const pres = (isPresident() || currentRole === 'manager') && !opts.selfOnly;
  if (pres) {
```
**5b — thread `opts` through the three self-re-render call sites** so a refresh from inside the profile sub-tab re-renders into the sub-tab host, not `#page-content`:
- app.js:4449 `window.renderPersonalFinance(currentUser, currentRole);` → `(currentUser, currentRole, opts);`
- app.js:4769 (salary-history delete handler) → same.
- app.js:4828 (self-assessment save) → same.
Everything else in the function (all `document.getElementById` sub-lookups) is ID-based and works unchanged inside a host container — the page renders only one instance at a time. The `personal-finance` router case (app.js:2037) passes no opts → behavior on the standalone page is byte-identical, including the president team table.

### Spec 6 — NEW page: `window.renderMyProfile` + sub-renderers (js/modules.js, append at end)

```js
/* ═══════════════════════════════════════════════════
   v12 WS41 — MY PROFILE (5 sub-tabs; partners get 3)
═══════════════════════════════════════════════════ */
window.renderMyProfile = async function() {
  const c = document.getElementById('page-content'); if (!c) return;
  const u = window.userProfile || {};
  const partner = (typeof isPartner === 'function' && isPartner()) ||
                  (typeof isBrilliantOnly === 'function' && isBrilliantOnly());
  const tabs = partner
    ? [ {key:'account',   label:'👤 Account'},
        {key:'tasks',     label:'✅ Tasks'},
        {key:'activity',  label:'🕘 Recent Activity'} ]
    : [ {key:'id',        label:'🪪 ID'},
        {key:'finance',   label:'💳 Finance & Performance'},
        {key:'analytics', label:'📊 My Analytics'},
        {key:'tasks',     label:'✅ Tasks'},
        {key:'activity',  label:'🕘 Recent Activity'} ];
  const initial = window.initialSubtab(partner ? 'account' : 'id');
  const depts = (Array.isArray(u.departments) && u.departments.length ? u.departments
                 : u.department ? [u.department] : []).join(', ');
  c.innerHTML = `
    <div class="profile-hero" style="margin-bottom:14px">
      <div class="profile-avatar-wrap" style="cursor:default">
        ${u.photoUrl ? `<img src="${escHtml(u.photoUrl)}" class="profile-avatar-img"/>`
                     : `<span class="profile-avatar-initials">${escHtml((u.displayName||'?')[0].toUpperCase())}</span>`}
      </div>
      <div class="profile-hero-name">${escHtml(u.displayName || u.email || 'User')}</div>
      <div class="profile-hero-role">${escHtml(ROLES[u.role]?.label || u.role || '')}${depts ? ' · ' + escHtml(depts) : ''}</div>
      ${u.employeeId ? `<div class="profile-hero-id">${escHtml(u.employeeId)}</div>` : ''}
    </div>
    ${window.chipTabs(tabs, initial, { cls: 'mp-tabs' })}
    <div id="mp-tab-host"></div>`;
  window.bindChipTabs(c.querySelector('.mp-tabs'), key => { window.setSubroute(key); loadMyProfileTab(key); });
  loadMyProfileTab(tabs.some(t => t.key === initial) ? initial : tabs[0].key);
  if (window.lucide) lucide.createIcons({ nodes: [c] });
};

async function loadMyProfileTab(key) {
  const host = document.getElementById('mp-tab-host'); if (!host) return;
  host.innerHTML = '<div class="loading-placeholder">Loading…</div>';
  const uid = currentUser.uid;
  if (key === 'id') {
    host.innerHTML = `<div id="mp-id-card-wrap" style="max-width:420px;margin:0 auto"></div>`;
    if (typeof renderIDCard === 'function') renderIDCard('mp-id-card-wrap', window.userProfile);   // WS27, verbatim
  } else if (key === 'finance') {
    host.innerHTML = '';
    await window.renderPersonalFinance(currentUser, currentRole, { host, selfOnly: true });
    if (['president','manager'].includes(currentRole)) {
      host.insertAdjacentHTML('afterbegin',
        `<div style="text-align:right;margin-bottom:8px"><button class="btn-secondary btn-sm"
           onclick="navigateTo('personal-finance')">Team view →</button></div>`);
    }
  } else if (key === 'analytics')  { await window.renderPersonalAnalytics(host, uid); }
  else if (key === 'tasks')        { await window.renderMyProfileTasksList(host, uid); }
  else if (key === 'activity')     { await window.renderRecentActivity(host, uid); }
  else if (key === 'account') {    // partners only — read-only info card
    const u = window.userProfile || {};
    host.innerHTML = `<div class="card"><div class="card-body">
      <div class="profile-info-row"><span class="pir-label">Email</span><span class="pir-value">${escHtml(u.email||'—')}</span></div>
      <div class="profile-info-row"><span class="pir-label">Company</span><span class="pir-value">${escHtml((typeof partnerCompanyName==='function'&&partnerCompanyName())||'—')}</span></div>
      <div class="profile-info-row no-border"><span class="pir-label">Role</span><span class="pir-value">${escHtml(ROLES[u.role]?.label||u.role||'—')}</span></div>
    </div></div>`;
  }
}
```

**`renderPersonalAnalytics(host, uid)` (js/modules.js — Decision 7).** Exact reads, then prose-specified markup:
```js
window.renderPersonalAnalytics = async function(host, uid) {
  const month = window.bizDate().slice(0, 7);
  const [kpi, att, taskSnap, histSnap, evalSnap] = await Promise.all([
    (typeof getKpiScore === 'function')        ? getKpiScore(uid)        : 0.5,
    (typeof getAttendanceScore === 'function') ? getAttendanceScore(uid) : 0,
    db.collection('tasks').where('assignedTo', 'array-contains', uid).get().catch(() => ({ docs: [] })),
    db.collection('salary_history').where('userId', '==', uid).orderBy('month', 'desc').limit(6).get().catch(() => ({ docs: [] })),
    db.collection('kpi_evals').doc(uid).get().catch(() => null)
  ]);
  // …render (prose spec below)…
};
```
Render body (no judgment calls left): a 2×2 `.kpi-row` of stat cards — **Attendance** `Math.round(att*100)%` this month; **Task completion** done/total using `DONE = ['done','approved','archived']` (the same set as app.js:4324/4478); **KPI composite** `Math.round(kpi*100)%` with the "70% tasks · 30% deliverables" caption; **Overdue now** = open tasks with `dueDate < bizDate()`. Below: a 6-month net-pay line chart from `salary_history` (`netPay ?? finalPay`, oldest→newest; `await ensureChart()` before `new Chart`, canvas id `mp-pay-trend`; skip the card entirely when `histSnap.docs.length === 0` — new hires); then an eval card showing `selfGrade`/10, president grade only via the same first-of-month rule as app.js:4511-4513 (`presidentGradeFromTasks`, shown only when `bizDate()` day === '01'), and `presidentImprovements` if present. All strings through `escHtml`; `fitKpiValues(host)` after render. Zero writes.

**`renderMyProfileTasksList(host, uid)` (js/modules.js — Decision 8).** One read: `db.collection('tasks').where('assignedTo','array-contains',uid).get()` (the app.js:4487 fallback shape is unnecessary here — every WS-era task has an array, departments.js:589). Sort: open-first (status not in DONE), then by `dueDate` asc (nulls last), cap 25 rows. Row = status emoji + `escHtml(title)` + dept badge + due date (red when overdue) — a slimmed clone of the dashboard task-feed row (app.js:3225-3235). Header button `+ Open full Tasks →` → `navigateTo('tasks')`. Read-only: clicking a row also just navigates to `tasks` (task detail panels stay owned by departments.js).

**`renderRecentActivity(host, uid)` (js/modules.js — Decision 9).** Exact reads:
```js
window.renderRecentActivity = async function(host, uid) {
  const partner = (typeof isPartner === 'function' && isPartner());
  const none = Promise.resolve({ docs: [] });
  const [notif, tasks, leave, ca, att, posts, audit] = await Promise.all([
    db.collection('notifications').doc(uid).collection('items')
      .orderBy('createdAt', 'desc').limit(30).get().catch(() => ({ docs: [] })),
    db.collection('tasks').where('assignedTo', 'array-contains', uid).get().catch(() => ({ docs: [] })),
    partner ? none : db.collection('leave_requests').where('userId', '==', uid).get().catch(() => ({ docs: [] })),
    partner ? none : db.collection('cash_advances').where('userId', '==', uid).get().catch(() => ({ docs: [] })),
    partner ? none : db.collection('attendance').doc(uid).collection('records')
      .orderBy(firebase.firestore.FieldPath.documentId(), 'desc').limit(14).get().catch(() => ({ docs: [] })),
    partner ? none : db.collection('posts').where('authorId', '==', uid).get().catch(() => ({ docs: [] })),
    db.collection('audit_log').where('actorUid', '==', uid)
      .orderBy('ts', 'desc').limit(50).get().catch(() => ({ docs: [] }))   // needs Spec 7 rules+index; degrades silently until deployed
  ]);
  // …map → merge → render (prose spec below)…
};
```
Mapping (each source → `{ts:millis, icon, html}`; every user string `escHtml`'d): notifications → `🔔 title` at `createdAt`; tasks → TWO event kinds — `✅ Completed “title”` at `completedAt||updatedAt` when status ∈ DONE (skip if neither timestamp exists), `📋 Assigned “title”` at `createdAt`; leave → `🌴 {type} leave {status}` at `createdAt`; CA → `💸 Cash advance ₱{fmt(amount)} {status}` at `createdAt`; attendance → `📅 Timed in{record.status==='leave' ? ' (leave)' : ''}` at `loginTime` (skip records with no `loginTime` — admin-marked-absent shape, WS26 G-note); posts → `📢 Posted “title”` at `createdAt`; audit → `🛠 {action} {entity}` at `ts`. Merge all, sort `ts` desc, cap 60, render as a single-column feed (`.card` rows with `timeAgo`-style relative dates — fork the notif-list row markup, notifications.js:116 region). Empty state: `🕘 No recent activity yet`. Zero writes, zero listeners, zero new collections.

### Spec 7 — firestore.rules + firestore.indexes.json diffs

**7a — `audit_log` read (firestore.rules:1228-1229) — BEFORE → AFTER (Decision 10):**
```
// BEFORE
    match /audit_log/{docId} {
      allow read:   if isAuth() && isAdmin();
// AFTER
    match /audit_log/{docId} {
      // v12 WS41: a user may list THEIR OWN trail (provable for
      // where('actorUid','==',uid) queries); admins read everything.
      // Create rule already forces actorUid == auth.uid, so "own" is sound.
      allow read:   if isAuth()
        && (isAdmin() || resource.data.get('actorUid','') == request.auth.uid);
```
(create/update/delete clauses unchanged. `.get(field,default)` per the missing-field-throws memory.)

**7b — firestore.indexes.json — ADD one composite index** (the feed query is `where actorUid == … orderBy ts desc`):
```json
{ "collectionGroup": "audit_log", "queryScope": "COLLECTION",
  "fields": [ { "fieldPath": "actorUid", "order": "ASCENDING" },
              { "fieldPath": "ts",       "order": "DESCENDING" } ] }
```
**7c — nothing else.** No new collections; every other feed source rides existing owner-readable rules (G11): `salary_history` (rules:517-522) already serves the identical query the finance view runs today, `leave_requests`/`cash_advances`/`attendance`/`posts`/`notifications` all verified in G11.

Deploy: `~/.npm-global/bin/firebase deploy --only firestore` (rules AND indexes together), SEPARATE from `git push`, after re-running `git diff firestore.rules firestore.indexes.json` against live per the concurrent-edit memory. The index takes minutes to build — the activity feed's audit source `.catch`es to empty until then.

### Spec 8 — What explicitly does NOT change (blast-radius fence)

- `navBack`/`#nav-back-btn`, hash router, Overlay stack, Keymap — untouched.
- `#notif-btn` + panel/page fork, `Notifs.*` — untouched (the mandate's Notifications icon = the existing bell).
- `#global-search-btn`, `renderGlobalSearch`, Ctrl/⌘K — untouched.
- `renderIDCard`, `printIDCards`, `id_verify` — untouched; the dashboards KEEP their ID cards (Decision 5).
- `personal-finance`, `cash-advances`, `leave`, `attendance`, `departments`, `chat` router cases — all stay routed (grandfathered chrome; drawer More-links and dashboard buttons keep working).
- Payroll/Compute/ledger math, `pay_runs`, `salary_history` writers — zero edits (display composition only).
- WS37 chat internals (js/chat.js, conversations rules, teardown hooks) — zero edits; only its sidebar entries move to the topbar.
- `sw.js` PRECACHE list — no new files added (all code lands in existing files); CACHE_VER auto-bumps via the pre-commit hook (per the sw-cache-bump memory — verify the hook output on commit).

### Spec 9 — Migration / rollout checklist (ordered — Decision 15)

1. **Deploy rules + index** (Spec 7) via `--only firestore`, after re-diffing against live. Old clients unaffected (nothing reads the new clause until the JS ships).
2. **Ship ONE commit** with: index.html (Spec 1a-c), styles.css (Spec 2), app.js (Spec 3a-f, Spec 5), config.js (Spec 4), modules.js (Spec 6). `node --check` each edited JS file + a local `npx serve -p 3838 .` boot before pushing. Pre-commit hook auto-bumps APP_VERSION/CACHE_VER — do not hand-edit.
3. **No data migration, no backfill** — the feature composes existing data; a brand-new hire with empty collections sees clean empty states (Spec 6 renderers all have them).
4. **Stranding check:** deep links `#/personal-finance`, `#/chat`, `#/departments` still resolve (routes kept); an old cached client (stale SW) runs the OLD chrome against UNCHANGED collections/rules — nothing breaks mid-session on deploy day; next SW activation swaps the chrome atomically.
5. **Post-deploy:** run the Spec 10 checklist; then tell Neil the mobile-strip question (Flag 1) is live for revision if he wants a different icon set — array edits are one-line reversible.

### Spec 10 — Manual test checklist (6 roles × desktop/tablet/mobile)

1. **President — desktop:** topbar shows Search·Depts·Chats·Bell·Menu·Avatar; avatar → My Profile with 5 tabs; ID tab shows the flip card + QR + print; Finance tab shows OWN payslip view + "Team view →" button that opens the team table; Depts button lists all 10 + "All departments →"; Menu opens the retitled drawer WITHOUT the compensation card; sidebar has NO Chat/Departments entries but Audit Log/Product DB intact; Alt+digit jumps follow the new order; `?` cheat sheet reflects it.
2. **President — mobile (≤768px):** Depts/Chats topbar buttons hidden; strip = Home·Tasks·Posts·Chat·Team·Approve·Profile (scrolls); bell navigates to the notifications page; Menu button opens the drawer.
3. **Manager & Secretary — desktop:** same shell as president minus Product DB/Audit Log; secretary's Finance tab renders the own-view (not the team table — `pres` guard is president/manager only) with no Team-view button.
4. **Employee (single dept) — desktop:** Depts button navigates DIRECTLY to their dept (no dropdown); sidebar shows My Departments entries, NO Chat, NO Personal Finance; My Profile Finance tab shows payslip preview/salary history/CA identical to the old personal-finance page; deep link `#/my-profile/finance` lands on the tab; self-assessment save re-renders INSIDE the tab (opts threading, Spec 5b).
5. **Employee (multi-dept) — desktop:** Depts button opens the dropdown listing exactly `currentDepts`; no "All departments" footer.
6. **Employee — mobile:** strip = Home·Tasks·Posts·Chat·Cash·Profile; Profile item opens My Profile; avatar does the same; drawer still reachable via Menu; check-in button and ID card still on the dashboard.
7. **Finance role — desktop:** Depts dropdown includes Finance (prepend rule); Finance tab shows own view; audit-sourced activity rows appear (finance users generate `logAudit` entries).
8. **Agent — any tier:** behaves as employee (same branch); verify no console errors with zero departments (`deptsForSwitcher` → `[]` → button hidden).
9. **Generic partner + BS partner — desktop:** topbar Depts HIDDEN, Chats visible, Search hidden (existing rule); My Profile shows Account/Tasks/Activity only (no ID/Finance/Analytics); Activity shows tasks + notifications only (posts/leave/CA/attendance skipped); strip gains Profile.
10. **bsOnly internal — desktop/mobile:** Depts hidden, Search hidden, Chat visible; My Profile = full 5 tabs? NO — bsOnly is caught by the `partner` flag in Spec 6 (`isBrilliantOnly()` → reduced tabs). Verify Account card shows "Brilliant Steel".
11. **Analytics tab:** for a user with tasks + attendance + ≥2 salary_history months: 4 stat cards render sane numbers matching the dashboard KPI card, pay-trend chart draws (Chart.js lazy-loads), president grade hidden except on the 1st (Manila).
12. **Recent Activity:** file a leave request + complete a task + check in → all three appear, newest first, correctly escaped (test a task title containing `<b>x</b>`); BEFORE the index finishes building, the tab still renders (audit source silently empty).
13. **Rules probe (console):** as employee, `db.collection('audit_log').where('actorUid','==',myUid).orderBy('ts','desc').limit(5).get()` → allowed; unfiltered `db.collection('audit_log').limit(5).get()` → DENIED; as another user, `where('actorUid','==',someoneElseUid)` → DENIED.
14. **Theme + iPad:** repeat spot-checks in Office (light) theme and at 820px width (iPad = desktop layout: sidebar visible, all six topbar controls present, strip hidden).

### Flags for Neil

- **‼️ FLAG FOR NEIL 1 — mobile icon set (Decision 14).** You specified the desktop/iPad top bar but not mobile. Since v12 the phone layout already uses a Facebook-style icon strip UNDER the top bar (not a bottom bar). I kept that strip and made one swap: employees get **Home · Tasks · Posts · Chat · Cash · Profile** (Profile replaces the old "Finance" item, which now lives inside My Profile); every other role keeps its current strip with **Profile appended**. **Question: is that employee strip the six you want on phones — or should any of Cash/Posts give way to something else (e.g. Notifications)?**
- **‼️ FLAG FOR NEIL 2 — dashboard ID cards.** Your ID card now also lives in My Profile → ID. I LEFT the existing copies on the president/employee dashboards (zero-risk duplication). Say the word if you want the dashboards decluttered to a small "View my ID →" link instead.
- **‼️ FLAG FOR NEIL 3 — own-audit-trail visibility.** Recent Activities lets every user list audit-log entries **they themselves generated** (their own approvals, payroll edits they made, etc. — never anyone else's). This is a small rules loosening from admin-only. Veto it and the feed simply drops that source (one line).
