# PERF-WAVE1 — Boot payload, deploy re-download, Firestore read cost, render leaks
**Date:** 2026-08-24 · **Author:** Fable (spec), from a 4-agent audit of the full tree
**Status:** IMPLEMENTING

## Goal

The app must stay fast on mobile data as it grows. Four measured problems:
1. **5.0 MB local JS (1.47 MB gz) parsed on every boot by every role**; 3.21 MB (64%) is
   dept-scoped code a typical employee never runs. No code-splitting exists.
2. **Every deploy re-downloads the whole 65-file precache** (~1.6 MB gz) because
   `CACHE_VER` bumps per commit and `install()` refetches everything.
3. **Hot-path Firestore reads bypass the existing `dbCachedGet` cache** (~29% coverage):
   boot fires 10 uncached reads; chat presence refetches `users`+`payroll` every 30 s;
   Approvals refires 15 uncached queries per visit; several N+1 fan-outs.
4. **Chart.js instances + a theme listener leak** in Analytics; 3 unbounded list renders.

## Non-goals (explicitly out of scope this wave)

- Lucide icon subsetting (CDN URL is versioned + SW-cached; parse cost accepted for now).
- CSS dedupe of the 70 repeated selectors (cascade-order risk; separate pass).
- Splitting `chat.js` (374 KB) or `dashboards.js` (535 KB) internally — follow-up wave.
- Payroll-Compute N+1 redesign (weekly cadence, acknowledged in code); `nextCounterId`
  whole-collection `.size` read (rare path). The `getAttendanceScore` cache (WP3) already
  softens both.
- `loadStatutoryTables()` boot read (1 doc/login — not worth the risk).
- Firestore rules, indexes, Cloud Functions: **unchanged**. No new collections.

## Hard rules for every executor

- **NEVER run `git stash`, `git reset`, `git checkout -- <file>`, `git clean`, or ANY
  git write command. Do not commit. Leave edits uncommitted in the tree.** Other
  sessions edit this tree live.
- Do not touch `window.APP_VERSION`, version strings, or `CACHE_VER` (pre-commit hook
  owns them).
- Only edit files in YOUR work package. If a fix seems to need another file, write the
  need into your final report instead of editing it.
- Preserve existing conventions: `escHtml()` before innerHTML, `bizDate()/bizHour()`
  for date logic (never raw `toISOString()` for calendar days), Lucide via
  `lucide.createIcons({nodes:[el]})`, `fmt()`/`fmtPeso()` for pesos.
- If an `Edit` fails with "modified since read" more than twice (OneDrive mtime race),
  batch your remaining edits through a python exact-match replace script instead.
- Finish with `node --check <file>` on every JS file you edited (index.html/sw.js
  excluded; for sw.js use `node --check` too — it parses). Report pass/fail honestly.
- Your final report: list every edit (file:line, what), every spec deviation, every
  discovered risk. Raw facts, no marketing.

---

## WP1 — Lazy-load architecture (`js/config.js`, `js/app.js`, `index.html`, `scripts/ci-invariants.sh`)

The single biggest win: a typical employee boot should parse ~1.8 MB, not 5.0 MB.

### 1a. Generic loader in config.js
Add `window.ensureScript(src)` next to `ensureChart` (config.js:1375 shows the exact
pattern to follow): per-src cached promise map; inject `<script src=...>`; resolve on
load; on error, delete the cached promise (so retry is possible) and reject. No SRI for
same-origin files. Also add `window.ensurePage(page)` = look up `PAGE_SCRIPTS[page]`,
`Promise.all(list.map(ensureScript))`, resolve immediately for unknown pages.

### 1b. PAGE_SCRIPTS manifest in config.js
Map every `navigateTo` switch case whose render function lives in a lazified file to the
file list it needs. Derive the mapping by reading the `navigateTo` switch (app.js:2673+)
and grepping which file defines each `render*`. Any payroll-touching page
(payroll screens, HR payroll tabs, backfill) gets the full engine set:
`js/pay-policy.js, js/statutory-status.js, js/payroll-weekly.js, js/payroll.js` +
its screen file. Keep the manifest data-only, commented per entry.

### 1c. navigateTo integration in app.js
Inside `navigateTo`, after the skeleton paint (`c.innerHTML = skeletonHtml(...)`,
~app.js:2742) and before the switch: `await window.ensurePage(page)`. On rejection:
render a retry card into the container (`<button onclick="navigateTo('<page>')">`,
escaped) and `console.warn` — never a blank screen.

### 1d. index.html script-list rewrite
Remove from the defer list (they stay on disk and in sw.js PRECACHE):
`js/gestures.js` (dead — zero callers, listeners commented out), `js/qrcode.js`,
`js/bir.js`, `js/print-docs.js`, `js/letterhead.js`, `js/migrations.js`,
`js/pay-policy.js`, `js/statutory-status.js`, `js/payroll-weekly.js`, `js/payroll.js`,
and these under `js/screens/`: `design, tasks, sales, crm, ventures, hr,
employee-profile, payroll, payroll-backfill, production, finance, dept-budgets,
statutory-rates, approvals, govit, partners, people, notes, layoff, worker`.
KEEP eager, in current order: firebase SDK + lucide CDN, `firebase-config, errlog,
config, ui-states, ui-status-meta, statutory-tables, finance-ledger, drive,
notifications, meetings, calendar-feed, svc-approvals, ui-crud-table, money-core,
geo-core, departments, screens/dashboards, migrationsless… (i.e. everything not listed
above), app, modules, chat`. Preserve the interleaved inline `<script defer>` block
(index.html:449) exactly where it is relative to config.js.

### 1e. THE EXPORT/CALLER SWEEP (the safety-critical step)
For EACH lazified file: extract its `window.X =` exports AND bare top-level
`function name(...)` declarations. Grep ALL eager files (list in 1d) + index.html
inline scripts for references. Classify each reference:
- guarded (`typeof`/`?.`/`window.X &&`) → OK;
- inside the navigateTo switch → OK (1c covers it);
- unguarded in eager code → EITHER make the call site optional-chained (when silent
  no-op is acceptable, e.g. teardown calls like `closeTaskPanel()` in navigateTo —
  convert to `window.closeTaskPanel?.()`), OR ensure-then-call for user actions
  (`window.ensureScript('js/screens/X.js').then(() => window.fn(...))`), OR — if the
  coupling is deep — REMOVE that file from the lazy list, restore it in index.html,
  and say so in your report.
Known cases you must handle: `closeTaskPanel()` in navigateTo teardown;
`chat.js:2908 openTaskDetail` is handled by WP4 (do not edit chat.js yourself — but
verify nothing ELSE in eager code hits tasks.js unguarded); QR call sites
app.js:3089+3109 — replace with: render `''` placeholder, then
`ensureScript('js/qrcode.js').then(() => { if (qrEl && window.buildQRSVG) qrEl.innerHTML = buildQRSVG(url, 64); })`.
(hr.js:2975's QR site is WP7's.) Check `openProfileDrawer`/employee-profile openers in
eager code and ensure-wrap them.

### 1f. Small app.js fixes riding along
- `app.js:1301`: `window.addEventListener('auth-persistence-change', paintPersistenceState)`
  re-added per `showLogin()` — precede with the matching `removeEventListener` (idempotent rebind).
- Same-page short-circuit: bottom-nav and drawer tap handlers (the nav builders in
  app.js) pass a new `opts.fromNav = true` into `navigateTo`; at the top of
  `navigateTo`: `if (opts.fromNav && page === window.currentPage) return;`.
  Programmatic/refresh callers are unaffected (they don't pass the flag).

### 1g. ci-invariants
Read `scripts/ci-invariants.sh` CHECK 2 + 3. CHECK 2 (PRECACHE completeness) must keep
passing — lazy files REMAIN in PRECACHE. If CHECK 2 derives its expectation from
index.html's script list, extend it to also cover the PAGE_SCRIPTS manifest paths
(every manifest path must exist on disk and appear in PRECACHE). Add a new CHECK:
every path in PAGE_SCRIPTS exists as a file.

---

## WP2 — Deploy-diff precache (`sw.js`, `.githooks/pre-commit`, live `.git/hooks/pre-commit`)

Goal: a deploy that changes 3 files costs users ~those 3 files, not 1.6 MB.

- Pre-commit hook (edit the tracked `.githooks/pre-commit`; then check whether
  `git config core.hooksPath` is `.githooks` — if not, copy your edited hook over
  `.git/hooks/pre-commit` too so the live one matches): after the version bump,
  generate `precache-manifest.json` at repo root: `{"files": {"<path>": "<sha1>"},
  "version": "<APP_VERSION>"}` for every path in sw.js's PRECACHE array (parse the
  array from sw.js; skip `/` and other non-file URL entries like `/t/`, `/v/` —
  hash their `index.html` targets instead where they exist). `git add` it. Loud
  `exit 1` if generation fails (match the hook's existing hardening style).
- sw.js `install`: fetch `precache-manifest.json` with `{cache:'no-store'}`. Locate the
  newest previous `bi-ops-*-static` cache. Read its stored manifest (a synthetic
  `new Response(JSON.stringify(manifest))` cached under key `'/__precache-manifest__'`).
  For each PRECACHE entry: if prev-hash === new-hash AND the old cache has the response
  → `newCache.put(request, oldResponse.clone())` (copy-forward, zero network); else
  fetch fresh. Always fetch fresh: `/`, `/index.html`, `/t/`, `/t/index.html`, `/v/`,
  `/v/index.html` (documents pin the app version). Store the new manifest under
  `'/__precache-manifest__'` in the new cache. If anything about the manifest is
  missing/unparseable → fall back to today's `cache.addAll(PRECACHE)` wholesale.
  `activate` still prunes old caches AFTER install completes (unchanged).
- Do NOT change CACHE_VER derivation, the fetch strategies, or timeouts.
- Verify by simulation in your report: describe (with the actual code you wrote) what
  happens on (a) same-version reinstall, (b) one-file change, (c) first run after this
  feature ships (no stored manifest → wholesale).

---

## WP3 — `js/screens/dashboards.js`

1. **Chart leaks.** Add a local helper `destroyChartsIn(el)` (querySelectorAll canvas →
   `Chart.getChart(c)?.destroy()`, guard `window.Chart`). Call it at the top of
   `_anRenderOverview` (before `wrap.innerHTML =`, ~:6080-6094) and in the theme-change
   path (~:6607-6613) before `(TAB_RENDERERS[active] || renderOverview)()`. The
   chip-tab switcher (:6597-6601) already does this — mirror its style.
2. **Theme listener accumulation** (:6613): store the handler globally
   (`window._anThemeHandler`); `removeEventListener('bi-theme-change', window._anThemeHandler)`
   before adding the new one.
3. **Employee dashboard reads → dbCachedGet** (:1934-1943): wrap each of the 5 reads:
   keys `tasks-mine-{uid}` (30 s), `att-card-{uid}-{bizDate()}` (15 s),
   `ca-mine-{uid}` (60 s), `kpi-{uid}` (300 s), attendance score via item 4 below.
   The attendance punch write path (in this file) must `dbCacheInvalidate('att-card-{uid}-{date}')`
   after a successful punch so the card updates instantly.
4. **`getAttendanceScore` (:3527)**: wrap its internal range read in
   `dbCachedGet('att-score-' + uid + '-' + monthKey, fetcher, 600000)` (10 min). This
   single wrap collapses the repeat cost of three N+1 sites (Team-tab standings, admin
   personal-finance-team, payroll Compute). Note in a comment that attendance edits can
   be up to 10 min stale here and that's accepted.
5. **Presence dots** (:6642): change key `'users-presence'` → `'users'`, TTL 30000
   (aligns with the app-wide users cache; `dbCachedGet` forces the payroll-aware
   fetcher for `'users'` automatically).

## WP4 — `js/chat.js`

1. Presence header (:2676) and inbox rows (:598): `dbCachedGet('users-presence', …, 8000)`
   → `dbCachedGet('users', window.fetchUsersWithPayroll, 30000)`. The 30 s repaint
   interval then hits cache roughly every other tick instead of refetching two whole
   collections per tick. Do not change the repaint interval.
2. Task deep-link (:2908): unguarded `window.openTaskDetail(...)` → 
   `const go = () => window.openTaskDetail(ref.id, window.currentUser, window.currentRole);
   window.openTaskDetail ? go() : window.ensureScript?.('js/screens/tasks.js').then(go);`
   (degrade: if ensureScript absent, no-op with console.warn).

## WP5 — `js/screens/tasks.js`, `js/notifications.js`, `js/errlog.js`

1. tasks.js (:471): the default `'mine'` filter's raw query → 
   `dbCachedGet('tasks-mine-' + uid, fetcher, 30000)` (same key WP3 uses — one shared
   cache). Every task write path in this file (create/update/status/delete) must call
   `dbCacheInvalidate('tasks-mine-' + <affected uid>)` for the acting user AND
   `dbCacheInvalidate('tasks-all')` (existing key elsewhere).
2. tasks.js `'all'`/`'dept'` render: keep the cached full fetch, but render at most 150
   cards + a "Show all N" button that re-renders unbounded on tap. Preserve filter
   behavior exactly.
3. notifications.js checkDeadlines (:1194-1195): wrap both queries:
   `dbCachedGet('deadline-today-' + uid, …, 600000)` / `'deadline-tomorrow-' + uid`.
   They run once per login; the cache guards against repeat auth-state flaps.
4. errlog.js (:125-133): poll interval 500 ms → 1000 ms, tries 40 → 20 (same 20 s window).

## WP6 — `js/screens/approvals.js`, `js/svc-approvals.js`

1. approvals.js (:157-176): each of the 15 pending queries →
   `dbCachedGet('approvals-pending:' + collName, fetcher, 30000)`.
2. svc-approvals.js: in `Approvals.dispatch` (and any other approve/reject/mutation
   path), after a successful write: `dbCacheInvalidate('approvals-pending:' + coll)`
   for the affected collection. Grep approvals.js for its own inline mutation handlers
   too and add the matching invalidate there.
3. Do NOT touch `nextCounterId` (flagged, out of scope).

## WP7 — `js/screens/hr.js`, `js/screens/finance.js`

1. hr.js Print-All N+1 (:2788-2794 → :5479 → :5459): thread the already-fetched
   `usersByUid` map through `payslipYtdMonthly` into `thirteenthMonthFor` so the
   per-employee `users/{uid}.get()` fallback never fires on the bulk path. Signature
   change is fine — update all callers of both functions IN THIS FILE (grep; they are
   hr-internal per the audit).
2. hr.js tasks scan (:1959): `db.collection('tasks').get()` →
   `dbCachedGet('tasks-all', () => db.collection('tasks').get(), 30000)`.
3. hr.js unscoped `lucide.createIcons()` (:4580) → scope: `{nodes:[<modal root el>]}`.
4. hr.js QR (:2975): same ensure-wrap pattern as WP1's app.js QR sites
   (`window.buildQRSVG ? use : ensureScript('js/qrcode.js').then(use)`).
5. finance.js unscoped `lucide.createIcons()` (:956, :1298) → scope both to their panel
   root elements.

## WP8 — `js/screens/people.js`, `js/meetings.js`

1. people.js `computeEomStandings` (:970-980): wrap the WHOLE computation in
   `dbCachedGet('eom-standings-' + monthKey, computeFn, 1800000)` (30 min). The banner
   shows month-scale standings; 30 min staleness is fine (comment it). This turns
   ~headcount reads per Team visit into ~headcount per 30 min. (WP3's
   `getAttendanceScore` cache stacks under it.)
2. people.js unscoped `lucide.createIcons()` (:1613) → scope to the modal element.
3. meetings.js invitee picker (:668): `users.get()` →
   `dbCachedGet('users', window.fetchUsersWithPayroll, 60000)`; adapt to the
   `{docs:[...]}` shape it returns (same shape as a snapshot — see fetchUsersWithPayroll
   config.js:901-936).

## WP9 — `js/screens/production.js`, `js/departments.js`

1. production.js `renderProdOrders` (:2453-2480) and `renderProdJobOrders` (:1318):
   keep the (cached) fetch; render at most 150 rows + "Show all N" button (same pattern
   as WP5 item 2).
2. departments.js `buildPayRunLines` tasks scan (:2102): →
   `dbCachedGet('tasks-all', () => db.collection('tasks').get(), 30000)`.

---

## Invalidation completeness rule (WP3, WP5, WP6 especially)

Any write that mutates data served by a NEW cache key must invalidate that key in the
same success path. If you cannot find the write path for a key inside your own files,
REPORT it (the verifier will chase it) — do not silently ship a stale-forever key.
Acceptable-staleness exceptions (comment them in code): `att-score-*` 10 min,
`eom-standings-*` 30 min, `deadline-*` 10 min.

## Verification (after all WPs land — run by the coordinator, not executors)

1. `node --check` on every edited JS file (executors already did; coordinator re-runs).
2. `bash scripts/ci-invariants.sh` → all checks green.
3. Preview server (launch config `app`, port 3838): login screen boots with ZERO console
   errors; network tab shows the reduced script set; `window.PAGE_SCRIPTS` +
   `window.ensureScript('js/screens/notes.js')` resolve pre-login via eval.
4. Adversarial verify pass (independent agents): (a) re-run the export/caller sweep
   from scratch against the final diff; (b) simulate sw.js install paths; (c) audit
   every new dbCachedGet key for invalidation completeness.
5. Single commit (one session, `git diff --cached` reviewed, pre-commit hook bumps
   version + regenerates manifest), then push. Firestore rules untouched — no rules deploy.
