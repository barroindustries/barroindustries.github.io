# Workstream 40 — Analytics with conclusions (rule-based insights, Strategy page, scheduled digests)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

1) THE ANALYTICS TAB TODAY — `renderAnalytics()`, js/app.js:6340-6778 (full function read
verbatim). Gate: `if(!isPresident()&&currentRole!=='manager'&&currentRole!=='secretary'&&currentRole!=='finance')` →
`renderAccessDenied('Analytics')` (line 6341) — narrower than the general dashboard set (no
plain `employee`/`agent`/`partner` access). Nav entry: `{icon:'bar-chart-2', label:'Analytics',
page:'analytics', section:false}` (app.js:927) → router `case 'analytics': renderAnalytics();
break;` (app.js:2003). Six sub-renderers, confirmed by reading each in full: `renderOverview`
(6434-6519), `renderSales` (6521-6580), `renderMarketing` (6581-6620), `renderFinanceAnalytics`
(6622-6679), `renderProduction` (6680-6717), `renderGovernment` (6718-6758) — matching WS16's
Build Log claim exactly ("6 async Analytics tab-renderers"). `SUBTABS` (6419-6426) renders via
`window.chipTabs(...)`; `TAB_RENDERERS` (6760-6767) maps tab key → renderer; `window.bindChipTabs`
wiring (6770-6774) destroys every live `Chart` instance on the swapped-out canvas before calling
the next renderer (`Chart.getChart(cv).destroy()`) — the only chart-lifecycle management that
exists. `renderOverview` runs on initial load (line 6777).

2) DATA FETCH STRATEGY (post-WS16) — one `Promise.all` of 13 reads (app.js:6357-6371): `users`
(via `fetchUsersWithPayroll`, cached), `tasks-all`, `all-quotes`, `submissions`, `expenses`,
`cash_advances`, `payslips`, the ledger (via `window.ledgerForPeriod`/`ledgerSince` — bounded to
the selected period extended to a 6-month trend window, `window._AN_LED_START`, 6349-6354),
`gov_biddings`, `job_projects`, `job_costs`, a Design-board project set (`dpSnap`, only
partially wired — see gap below), and `sales_clients`. All keys route through the shared
`cg(key,q,ttl=60000)` helper (line 6347) or `dbCachedGet` directly — the exact cache-key
unification WS16 did specifically so Analytics stops lagging the Dashboard. **Governing
constraint inherited from WS16 (must not be silently violated by this workstream): "no
displayed money number changes" — any new derived metric must be computed from the SAME
already-fetched arrays, not a fresh uncached full-collection read, or it reintroduces the exact
read-cost regression WS16 just fixed.**

   Gap actually found while reading: `dpSnap` (Design-board projects, meant to combine with
   `job_projects` into `allProjects` via `window.Projects.normalize` — app.js:6383-6388) is
   referenced but **never fetched** in the `Promise.all` array (6357-6371 lists 13 promises with
   no `design_projects`/`dpSnap` source) — `dpSnap?.docs||[]` silently evaluates to `[]` every
   time. This means `allProjects` (used for Overview's Top Clients + Receivables-by-job cards)
   is job-projects-only today, not the merged shape the code's own comment claims. Not part of
   this workstream's scope to fix, but relevant context: this workstream's "AR aging"/"cash
   position" numbers, if sourced from `allProjects`, inherit this same silent gap.

3) METRIC-BY-METRIC AUDIT against the mandate's six named metrics:
   - **Cash position** — does NOT exist as a point-in-time balance anywhere. What exists is a
     *period net cash flow* figure: Overview's "Net Cash (period)" KPI (`netMTD = revMTD -
     ledOutP`, app.js:6451, 6477) and Finance tab's "Net Income (period)" (app.js:6647, 6653) —
     both derived from the `ledger` collection's income/expense rows for the selected period, not
     from any bank-account balance. There is no `bank_accounts` collection or running-balance
     concept in the repo at all (confirmed: zero hits for `bank_account`, `bankBalance`,
     `accountBalance` across js/*.js) — that's V12-PLAN workstream 36's "bank accounts registry"
     (not yet built, Phase 4). "Cash position" in the mandate's accounting sense (cash-on-hand
     across accounts) is therefore **not computable from any data source that exists today.**
   - **AR aging** — partially exists, but NOT inside Analytics. `renderFinanceDashboard()`
     (app.js:2775+, a *different* screen from the Analytics→Finance tab) has a full "📥
     Receivables Aging" card (app.js:2810-2861, quoted): buckets `{cur, d3160, d6190, d90}` by
     `_daysSince(p.createdAt)` — i.e. **project age**, not invoice due-date — over
     `p.arBalance>0` projects. The Analytics→Finance tab (`renderFinanceAnalytics`,
     app.js:6622-6679) has NO aging breakdown at all, only a flat lifetime `receivables` sum in
     the Overview tab (app.js:6460, `sum(openProjects, arOf)`, no bucketing). A truer aging
     anchor already exists in the data, just unused for aging: `job_projects/{id}.invoices[]`
     entries carry a real `due` date field (`inv.due`, set from a `<input type="date"
     id="jinv-due">` with no default value — departments.js:12313, 12339) written by
     `openJobBillingInvoiceModal`'s "Generate Invoice" handler (departments.js:12309-12374). This
     due-date is **optional/manually typed per invoice, not guaranteed populated** — some
     projects will have `invoices[]` entries with no `due` at all, so an invoice-due-date-based
     aging engine needs a fallback (the existing `createdAt` proxy is exactly that fallback).
   - **Win-rate** — exists in THREE independent, differently-defined places, none inside a
     unified analytics concept: (a) Analytics→Sales tab, `winRate` from Sales-department
     `quotes` where `status` is `accepted`/`rejected` (app.js:6522-6527); (b) Analytics→Government
     tab, `winRate` from `gov_biddings` where `status` is `won`/`lost` (app.js:6719-6724); (c) the
     Brilliant Steel quote-approvals screen's own "Quote Analytics" card, `winRate` defined as
     `salesOrderId` existing on the LATEST revision of a quote (i.e. "became an order", NOT
     "status===accepted") (js/departments.js:9163-9174, quoted). Three different definitions of
     "win" (quote status / bid status / has-a-sales-order) computed independently with no shared
     helper. Separately, the Analytics→Sales tab already renders a CRM-stage pipeline widget
     (`stageCount` over `lead`/`prospect`/`won`/`lost` from `sales_clients`, app.js:6534-6556) —
     this is the natural hook V12-PLAN workstream 32 ("CRM stages rolled into win-rate
     analytics") will extend, but today that widget is a raw stage-count breakdown, not itself a
     win-rate calculation.
   - **On-time %** — exists ONLY for Production department tasks: `onTimeRate =
     doneProd.length/(doneProd.length+prodOverdue.length)*100`, where `prodOverdue` is a task
     whose `dueDate < bizDate()` and status isn't done/approved/archived (app.js:6685-6686,
     6693). This is a *task* on-time rate, not an *order/delivery* on-time rate — there is no
     "delivered by promised date" concept anywhere (no `promisedDate`/`deliveryDate` vs-actual
     comparison found by grep across departments.js's production-order code). V12-PLAN workstream
     28 ("Production process flow", stage timestamps/`stageHistory`, not yet built) would be the
     natural source for a true delivery on-time metric.
   - **Payroll ratio** — already computed, twice, as "Payroll % of Revenue" = `totalPayroll /
     revenueForPeriod * 100`: Overview tab (app.js:6462-6463, 6480) and Finance tab
     (app.js:6648, 6654), both over the exact same `users` payroll sum
     (`sum(u.salary+u.allowance-u.deductions)`) and the same period-scoped ledger income figure.
     Two call sites, identical formula, not shared via a helper — cheap to consolidate but not
     currently broken.
   - **Inventory turns** — wholly absent (zero hits for `turnover`/`turn` as an inventory
     concept anywhere in js/*.js). Structurally blocked, not just unbuilt: `inventory_items`
     docs only carry a live `qty`/`unitCost`/`reorderLevel` snapshot (departments.js references
     throughout, e.g. 13022-13046); the ONLY consumption write is an in-place
     `FieldValue.increment(-qty)` on production material use (departments.js:12579) with **no
     accompanying timestamped movement-log entry** — so there is no historical time series of
     stock levels or consumption rate to compute a turns ratio (COGS ÷ average inventory value,
     or units-consumed ÷ average units-on-hand) from. This is exactly V12-PLAN workstream 29's
     ("Inventory correctness … movements logged for consumption + receiving … currently
     missing") gap — inventory turns cannot be built before WS29 lands, not merely "hasn't been
     built yet."

4) ZERO INSIGHT-SENTENCE / RULE-BASED-CONCLUSION GENERATION EXISTS TODAY — confirmed by
   repo-wide grep for `insight`, `recommend`, `conclusion`, `strategy` (case-insensitive) across
   every `.js`/`.html` file: the only "strategy" hits are unrelated code comments (a print
   page-break "strategy" in js/letterhead.js:100, a fetch-routing "strategy" comment in
   sw.js:3,72) and zero hits at all for insight/recommend/conclusion as domain concepts. Every
   one of the six sub-renderers read in full (item 1) is pure data → KPI-card / chart / table —
   confirmed by reading `renderOverview` end-to-end: every value feeding `wrap.innerHTML`
   (app.js:6473-6505) is a number, a percentage, or a raw client/stage/status string; there is
   no branch anywhere that emits a sentence like "X is above/below threshold, therefore Y." The
   single closest existing analog, found in the *unrelated* Finance Dashboard screen (not
   Analytics): a hardcoded, non-conditional line of copy — `<div ...>${openAR.length} open
   project${openAR.length===1?'':'s'} with a balance. Chase the <strong ...>90+ day</strong>
   bucket first.</div>` (app.js:2860, quoted verbatim). This ALWAYS says "chase the 90+ day
   bucket first" regardless of whether that bucket actually holds the most money, is zero, or
   the `cur`/`d3160` buckets are worse — it is static advisory copy, not a rule that reads the
   data and branches. There is no equivalent line anywhere inside `renderAnalytics` itself.

5) ALL 13 `new Chart(` SITES HARDCODE COLORS — repo-wide grep for `new Chart(` returns exactly
   13 hits, ALL inside `renderAnalytics`'s six sub-renderers (js/app.js:6508, 6514, 6572, 6578,
   6617, 6619, 6673, 6675, 6677, 6712, 6715, 6754, 6757 — matching WS16's Build Log count
   exactly, confirming no other chart sites exist anywhere else in the app). Counting literal hex
   colors inside the `renderAnalytics` function body (lines 6340-6778): `#ebebf5bb` appears 22
   times (every legend-label and axis-tick `color:` — e.g. `plugins:{legend:{labels:{color:
   '#ebebf5bb'}}}`, `scales:{y:{ticks:{color:'#ebebf5bb'}}}`), `#ffffff18` appears 8 times (every
   grid-line `color:`), plus per-dataset literal hexes: `#30D158` (green, ×15), `#636366` (gray,
   ×10), `#FF453A` (red, ×8), `#0A84FF` (blue, ×8), `#FF9F0A` (orange, ×6), `#9BA8FF`, `#34C759`,
   `#FFAA00` (×1 each), plus alpha-suffixed variants `#30D15822`/`#0A84FF22`. **Zero** of the 13
   `new Chart(` call sites reference a `var(--...)` CSS custom property or any theme-aware
   helper — confirmed by grepping `var(--` inside the same 6340-6778 range, which returns only 9
   hits, all in surrounding non-canvas HTML (KPI-card copy using `var(--text-muted)` ×7,
   `var(--danger)` ×1, `var(--surface2)` ×1), never inside a `new Chart(...)` options object.
   `#ebebf5bb` is Apple's dark-mode "secondary label" gray (≈`rgba(235,235,245,0.73)`) — a color
   designed to read as light-gray-on-near-black. Since WS17 (this session), the app's DEFAULT
   theme is the light "Office" theme (`initTheme()`, app.js:842-844: `"Default to the light
   'Office' (Fluent) theme"`; `THEMES.office.cls = 'light theme-office'`, app.js:831), whose
   `--bg` is `#FAF9F8` and `--text-muted` is `#616161` (css/styles.css:2427, 2464) — a near-white
   background. A `#ebebf5bb`-colored legend label or axis tick against a `#FAF9F8` chart card is
   low-contrast to the point of near-illegibility — this is the concrete, quantified version of
   the mandate's "currently dark-hardcoded" claim. `THEMES` also has a live `auto` entry
   (app.js:830) that resolves Office↔Obsidian via `matchMedia`, so the SAME chart can be viewed
   under either extreme in one session with no reload, which the hardcoded hex values cannot
   track at all (charts render once at tab-open, never re-themed). **A reusable fix pattern
   already exists in this codebase, just not applied to charts:** `Notifs.showToast()`
   (js/notifications.js:502-521, quoted) defines a local `cssVar(name, fallback)` closure —
   `getComputedStyle(root).getPropertyValue(name).trim() || fallback` — reading
   `--toast-success`/`--toast-error`/`--toast-info`/`--toast-text`, which ARE defined with
   different values in both the dark `:root` (css/styles.css:125-128) and the light theme
   (css/styles.css:2352-2355) — i.e. this exact technique is proven and already exercised
   live in production, just scoped locally inside one function rather than exposed on
   `window`. `getComputedStyle`/`getPropertyValue` otherwise appears only twice more in the
   whole codebase (app.js:866-867 for the `<meta theme-color>` sync, app.js:7598 for
   `fitKpiValues`'s font-size read) — there is no existing `window.cssVar` global helper today.

6) ZERO STRATEGY PAGE / RECOMMENDATIONS ENGINE EXISTS ANYWHERE — confirmed by the same grep as
   item 4 (zero hits for "strategy"/"recommend" as a feature concept) and by checking the nav
   builders (`getSidebarItems`, app.js:838-924) and the router (`navigateTo`'s switch,
   app.js:~1870-2010) for any `page:'strategy'`-shaped entry — none exists. This is greenfield in
   every sense: no page, no nav entry, no data shape, no rules block. The closest existing
   *pattern* (not feature) for "a persisted per-department text block a privileged role edits"
   is the `settings/{docId}` singleton-config convention already used twice: `settings/sales_sop`
   (an editable Sales playbook, President-only write, js/departments.js:5888-6182) and
   `settings/employeeOfMonth` (js/modules.js:502-765). Rules for this collection
   (firestore.rules:365-372, confirmed) are `allow read: if isAuth()` /
   president-only-write-equivalent — a `settings/strategy_notes_{dept}` (or one doc keyed by
   dept inside a single doc) would slot into this exact existing rule shape with zero new rules
   work, IF Fable chooses to reuse it rather than a new richer collection (e.g. one supporting
   per-entry history/attachments, which `settings/sales_sop`'s single-blob-overwrite shape does
   not).

7) ZERO FIREBASE SCHEDULED FUNCTION EXISTS — grepped `onSchedule` and `functions.pubsub.schedule`
   across `functions/index.js`: zero hits. The file's five exports are all confirmed:
   `sendPushOnNotification` (Firestore onWrite trigger, index.js:9), `createUserDocOnAuthCreate`
   (Auth onCreate, index.js:101), `adminResetPassword` (onCall, index.js:185),
   `syncUserClaims` (Firestore onWrite, index.js:253), `backfillUserClaims` (onCall,
   index.js:309) — no cron-triggered function of any kind. This repeats the identical finding
   the leave workstream (fable-workplan/25-leave.md) made this same session: **"the only cron
   precedent in the repo is GitHub Actions."** Re-confirmed directly: `keepalive.yml` (`cron: '0
   18 14 * *'`, monthly), `monthly-backup.yml` (`cron: '0 17 1 * *'`, monthly), `sync-to-drive.yml`
   (`cron: '0 16 * * *'`, daily — the closest-cadence existing precedent to a "daily digest"),
   each invoking a Node script in `scripts/` against `FIREBASE_SERVICE_ACCOUNT`. `firebase.json`
   declares `"functions": {"source":"functions","runtime":"nodejs22"}` with no `scheduler`/cron
   config block, and `functions/package.json` has no `firebase-functions` version pin beyond
   `^5.0.0` (which does support `onSchedule`, but nothing in this repo currently invokes it).
   **A different, NOT-equivalent "daily digest" pattern already exists, client-triggered:**
   `Notifs.checkLowStock(uid, role)` (js/notifications.js:602-624, quoted) sends one batched
   low-stock notification per admin/Purchasing user per day, deduped via a Firestore
   `dedupKey: 'lowstock-'+uid+'-'+todayStr` (the standard dedup convention used throughout
   `Notifs`) — but it is called from exactly one site, `Notifs.checkLowStock?.(user.uid,
   userProfile.role)` at **app.js:82**, inside the auth-state-changed / login-boot path. This
   means the digest **only fires if that specific user happens to log in that day** — if nobody
   with the qualifying role opens the app on a given day, no digest is ever sent, which is
   structurally different from a true server-side scheduled digest that fires regardless of
   whether anyone is logged in. **This is a genuinely new infrastructure dependency for the
   repo, not a trivial extension**: Cloud Scheduler-backed `onSchedule` functions require the
   Firebase project to be on the **Blaze (pay-as-you-go) plan** (Spark/free-tier does not
   support Cloud Scheduler-triggered functions) — worth flagging explicitly for Neil rather than
   assuming it's already covered, since nothing in this repo's config confirms the current
   billing tier one way or the other.

8) SEQUENCING / DATA-AVAILABILITY DEPENDENCY — this is explicitly the LAST workstream in
   V12-PLAN (Phase 5, #40 of 40) and, per the audit above, several of its named metrics read most
   naturally from data structures other still-`[ ]`-unstarted Phase 4 workstreams would introduce
   or correct: true cash position needs WS36's bank-accounts registry (doesn't exist); a
   CRM-stage-driven win-rate needs WS32's "CRM stages rolled into win-rate analytics" (the
   `sales_clients` stage data exists today, per item 3, but isn't wired into any win-rate
   calculation yet); inventory turns and any price-trend recommendation ("material Y price up
   12%") needs WS29's movements log + moving-average cost (today `inventory_items.unitCost` is
   simply overwritten on each receive — departments.js:13518, `upd.unitCost =
   Number(it.unitPrice)` — destroying any historical price trail, so a price-delta calculation
   has literally no historical data to compare against even for a single item); a true delivery
   on-time metric needs WS28's stage timestamps; a `purchase_orders`/receiving collection for
   purchasing-side recommendations does not exist at all yet (WS30, confirmed by grep — zero
   hits for `purchase_orders`/`receiving` collections in departments.js). By contrast, several
   named metrics ARE fully computable from data that exists RIGHT NOW with no upstream
   dependency: win-rate (from `quotes`/`gov_biddings`, albeit under 3 different definitions —
   item 3), payroll ratio (already computed twice), Production on-time % (task-based, already
   computed), and a project-age-proxy AR aging (already computed, just not inside Analytics) —
   and a real invoice-due-date AR aging is ALSO already possible today from
   `job_projects.invoices[].due` (item 3), no other workstream required. This split is the
   concrete basis for open decision 14 below.

## Data model

**Collections/read paths `renderAnalytics` already touches** (all via the `cg`/`dbCachedGet`
cache layer, 60s TTL unless noted): `users` (merged with `payroll/{uid}` via
`fetchUsersWithPayroll`, cache key `'users'`), `tasks` (key `'tasks-all'`), quotes across ALL
brands via `getAllQuotes()` (key `'all-quotes'`), `submissions` (key `'submissions'`), `expenses`
(key `'expenses'`), `cash_advances` (key `'cash_advances'`), `payslips` (key `'payslips'`),
`ledger` (bounded via `window.ledgerForPeriod(periodKey)`/`window.ledgerSince(startYmd)`, cache
keys `'ledger:'+periodKey` / `'ledger>='+startYmd`, config.js:397-411 — falls back to the full
`'ledger'` key only for `'all'`), `gov_biddings` (ordered `createdAt desc`, key
`'gov_biddings'`), `job_projects` (key `'job_projects'`), `job_costs` (key `'job_costs'`),
`sales_clients` (key `'sales_clients'`), and a `dpSnap` (Design-board projects) that is
**referenced but never actually fetched** (see item 2's gap note — always resolves to `[]`
today).

**`window.dbCachedGet(key, fetcher, ttlMs)` / `window.dbCacheInvalidate(key)`**
(js/config.js:348-385): a closure-scoped in-memory `_store` keyed by string; `dbCacheInvalidate`
supports an `_alias` map (currently only `ledger` → clears `ledger:`/`ledger>=` prefixed
sub-keys, and `expenses` → also clears `expenses-pending`/`expenses-recent`) so a single
canonical writer-side invalidation call reaches every period-scoped reader. Any NEW cache key
this workstream introduces (e.g. a cached "insights" computation, or a persisted digest-history
read) should register into this SAME `_store`/`_alias` mechanism rather than inventing a second
caching layer.

**`window.Period` engine** (config.js:688+): canonical period keys `month:YYYY-MM` /
`quarter:YYYY-Qn` / `year:YYYY` / `all`, plus legacy aliases `month`/`prev`/`ytd`/`year`;
`Period.parse(key)` returns `{type, key, start, end, label}`. `window.periodPicker`/
`window.bindPeriodPicker` are the shared UI widgets every money screen (including
`renderOverview`'s and `renderFinanceAnalytics`'s period pickers) already uses — a Strategy page
or a "conclusion" block that is itself period-scoped should reuse this engine rather than
inventing a parallel date-range picker.

**`window.ledgerKind(row)`** (config.js:676-683): the single income/expense classifier —
`row.accountType` if present, else a legacy-category lookup (`COA_LEGACY_MAP`), else
`type==='credit'` → income / anything else → expense. Any new metric reading the ledger
(e.g. a real cash-position projection, or a "collect ₱X" recommendation amount) MUST classify
rows through this function, not a raw `type` check, per WS13's asset/liability-leg exclusion
fix.

**`window.Projects.normalize(doc, kind)`** (js/departments.js:55-78): canonical project shape —
`{id, kind:'job'|'design', no, name, clientName, contractAmount, collected, arBalance, stage,
payments:[], invoices:[], jobProjectId, partnerUid, createdAt, raw}`. `arBalance` is DERIVED
(`contract - collected`) unless a job-kind doc has a stored `arBalance` field already (job
projects post-payment-collection code keeps a stored `arBalance` in sync — departments.js:9563,
12297 `arBalance:newAR`). `invoices[]` entries (job_projects only, via
`openJobBillingInvoiceModal`, departments.js:12309-12374) have shape `{no, date, due
(optional!), billTo, desc, amount, notes, contractAmount, paidToDate, balanceBefore,
projectName, projectNo, issuedBy, createdAt}` — `due` is the field a real invoice-based AR
aging would key off, when present.

**`gov_biddings/{docId}`** (top-level, read at app.js:6366): fields referenced —
`status` (`won`/`lost`/`pending`/`submitted`, default treated as pending), `contractAmount`,
`bidAmount`, `projectName`/`title`, `agency`, `createdAt`.

**`inventory_items/{docId}`** (top-level, read at multiple sites incl. departments.js:12650,
12797, 13022): `qty`, `unitCost` (last-price-wins, no history), `reorderLevel`, `unit`, `name`,
`kind` (`'material'` by default). No movements/history sub-collection exists.

**`window.THEMES`** (app.js:829-837): 7 entries (`auto`, `office`, `dark`(Obsidian),
`midnight`, `light`(Aurora), `pink`(Astral), `grey`(Slate)); `office` is the shipped default
(`initTheme`, app.js:842-844). Relevant CSS custom properties already defined in BOTH the dark
`:root` (css/styles.css:44-79) and `html.theme-office` (css/styles.css:2425-2470+) that a
theme-aware chart fix could read: `--text` , `--text-2`, `--text-muted`, `--border`,
`--surface`/`--surface2`, `--success`, `--warning`, `--danger`, `--primary`, `--bg` — e.g. dark
`--text-muted: rgba(240,240,250,0.45)` vs Office `--text-muted: #616161`. The reusable
read-pattern is `Notifs.showToast`'s local `cssVar(name, fallback)` (notifications.js:508-512,
quoted in Current State item 5) — not currently exposed as a shared `window.cssVar` helper.

**`window.ensureChart()`** (config.js:414+, WS16): lazy-loads Chart.js from the CDN
(`chart.js@4.4.0`, URL kept in `sw.js`'s PRECACHE list) on first use; every one of the 13 chart
sites already calls `if (!window.Chart) { await window.ensureChart(); }` before constructing a
`new Chart(...)` — any new chart this workstream adds (e.g. a Strategy-page sparkline) must
follow the same guard.

**Notification "digest" convention** (js/notifications.js, `Notifs` IIFE): the `dedupKey`
pattern (`'lowstock-'+uid+'-'+todayStr`, using `window.bizDate()`) writing to
`notifications/{uid}/items/{id}` is the established cross-user "send" mechanism (per CLAUDE.md);
`checkLowStock` is called once, client-side, at app.js:82. Any server-side digest this
workstream builds should either write into this SAME `notifications/{uid}/items` shape (so it
renders in the existing inbox/toast UI and triggers the existing `sendPushOnNotification` Cloud
Function automatically) or explicitly justify a different delivery channel.

**`settings/{docId}`** (top-level, rules firestore.rules:365-372): existing docs
`settings/sales_sop`, `settings/employeeOfMonth`, `settings/system`. Read = `isAuth()`, write =
president-only (per the existing pattern) unless a doc-specific override exists. The natural,
already-rules-covered home for a "market-research notes" doc IF Fable chooses a
settings-singleton shape over a new collection.

## Constraints — must respect

- **No regression of WS16's read-cost/staleness fixes.** Any new Analytics computation must
  read from the SAME already-fetched, already-cached arrays inside `renderAnalytics` (or via
  `dbCachedGet`/`ledgerForPeriod` with the SAME cache keys) — not a fresh uncached
  `.collection(...).get()`. WS16's own governing rule, "no displayed money number changes,"
  applies transitively: an insight sentence that recomputes a number differently than the KPI
  card next to it (e.g. a different period boundary, a different `ledgerKind` filter) would
  create a silent mismatch between the number and the sentence describing it — worse than no
  sentence at all.
- Script load order is fixed and load-bearing (CLAUDE.md, config.js → drive.js →
  notifications.js → departments.js → app.js → modules.js, all deferred, `window.*` globals, no
  ES modules). A new shared insight/recommendation helper (analogous to `window.ledgerKind`)
  must live in config.js so every later-loading caller can see it; a `window.cssVar` promotion
  (see item 5) belongs there too, not duplicated per-file.
- CACHE_VER in sw.js must be bumped on every JS/CSS touch (per CLAUDE.md; the pre-commit hook
  auto-bumps `APP_VERSION`/index.html version strings but NOT `CACHE_VER` — confirmed the same
  caveat WS26/27 both flagged).
- escHtml() discipline: any new insight sentence, conclusion block, or Strategy-page
  recommendation that interpolates a client name, department name, or other stored string (not
  just a formatted number) into `innerHTML` must go through `escHtml()` — the universal
  convention confirmed throughout `renderAnalytics`'s existing table rows (e.g. `escHtml(p.clientName||p.name||'—')`, app.js:6494).
- Firestore rules do not cascade or match by prefix (repo-wide convention, re-confirmed against
  `settings/{docId}` at firestore.rules:365-372 and every other collection cited above) — any
  NEW collection this workstream introduces (a digest-log, a persisted "conclusion" snapshot, a
  Strategy-recommendations collection, a market-research-notes collection if not reusing
  `settings/{docId}`) needs its own explicit match block, or reads silently deny (blank
  screen unless wrapped in `.catch()`, the pattern used everywhere in this codebase).
- Manila-time discipline: any "as of today" boundary in an insight sentence, a digest's
  send-time, or a dedup key must use `window.bizDate()`/`bizHour()`/`bizDow()` — never raw
  `new Date().toISOString()` — per the manila-time-helpers memory; the existing `checkLowStock`
  dedup key (`'lowstock-'+uid+'-'+bizDate()`) is the pattern to mirror for any new
  per-day-deduped digest.
- Cloud Functions deploy separately from the frontend: `cd functions && npm run deploy` (=
  `firebase deploy --only functions`, Node 22) is NOT triggered by `git push` (which only
  deploys the static frontend to GitHub Pages per CLAUDE.md). If the digest mechanism becomes a
  new Firebase Scheduled Function, that is a SEPARATE deploy step, sequenced after any
  rules/frontend changes it depends on, and it is the FIRST `onSchedule`/Cloud Scheduler usage
  in this codebase — a new infra dependency (Blaze billing tier), not a mechanical extension of
  an existing pattern.
- Re-diff before a whole-file `firestore.rules` deploy (per the repo's working memory) —
  concurrent sessions may edit `firestore.rules`; re-run `git diff` immediately before
  `firebase deploy --only firestore:rules` so this workstream's rules edit doesn't clobber an
  unrelated in-flight change.
- The Analytics access gate (`isPresident()||manager||secretary||finance`, app.js:6341) is
  narrower than the general employee dashboard set — a Strategy page, if it lives alongside
  Analytics, inherits an open question about whether it should use the SAME gate or a narrower
  one (see Open Decisions).

## Open decisions

1. **Cash position — scope now, or defer entirely?** No bank-balance data source exists (no
   `bank_accounts` collection; WS36, not yet built, is the only planned source). Options: (a)
   ship "Net Cash (period)" as the mandate's "cash position" proxy, clearly labeled as a
   flow-not-balance figure; (b) add a placeholder KPI card that reads "—, wire in once WS36
   ships" so the mandate's exact metric name is visible but honestly empty; (c) skip the KPI
   entirely from v1 and only document the gap. Each has different UI/copy implications Fable
   must pick.
2. **AR aging — proxy anchor or invoice due-date, and where does it live?** Two data sources
   exist: the shipped project-age proxy (`_daysSince(p.createdAt)`, currently only on the
   separate Finance Dashboard screen, not inside Analytics at all) vs. the more accurate but
   sparsely-populated `job_projects.invoices[].due` field. Decide: (a) which anchor Analytics'
   version uses (with what fallback when `due` is absent per invoice); (b) whether to surface AR
   aging inside the Analytics→Finance tab for the first time (today it's Finance-Dashboard-only)
   or treat the Finance Dashboard's existing card as sufficient and have Analytics/Strategy just
   read the SAME computed buckets rather than re-deriving them independently (avoiding a 4th
   independently-computed AR number in the app).
3. **Win-rate — unify the 3 existing definitions, or let the Strategy engine read all 3
   independently?** Sales quotes (`accepted`/`rejected` status), Gov bids (`won`/`lost` status),
   and BS/BK quote-approvals (`salesOrderId` presence) are three genuinely different
   definitions of "won" computed in three different files with zero shared helper. A recommendation
   like "quote win-rate fell — review pricing" needs to know WHICH win-rate it means (and
   whether "fell" compares this month vs last, or vs a rolling average) before it can be a rule
   rather than a vague sentence.
4. **On-time % — task-completion semantics or (future) delivery semantics?** Today's only
   "on-time" figure is Production task-due-date-vs-now, not order/delivery-promise-vs-actual (that
   would need WS28's not-yet-built stage timestamps). Decide whether v1's "on-time %" metric is
   explicitly scoped to the existing task-based definition (shippable now) with a documented
   note that it will mean something more literal once WS28 ships, or whether this metric is
   deferred entirely until WS28 exists.
5. **Payroll ratio — keep "% of revenue," or a different ratio?** The mandate says "payroll
   ratio" without specifying the denominator; the two existing call sites already compute
   payroll ÷ period revenue. Confirm that's the intended ratio (vs., say, payroll ÷ gross
   margin, or a headcount-normalized figure) before consolidating the two duplicate calculations
   into one shared helper.
6. **Inventory turns — placeholder or fully deferred?** Structurally blocked on WS29 (no
   movements log, no price history). Decide whether v1 ships a "—, needs WS29" placeholder KPI
   (consistent with cash position's option (b) above) or is omitted from the UI entirely until
   WS29 ships, so this workstream doesn't silently promise a number it can't compute.
7. **Insight-sentence engine — architecture and threshold ownership.** Where does the
   sentence-generation logic live (a new shared `window.Insights`-style module in config.js,
   analogous to `window.ledgerKind`, vs. inline per-tab logic duplicated 6 times the way the
   pre-WS16 cache keys were)? Are the trigger thresholds (e.g. "AR > 60 days," "win-rate fell
   more than X%") hardcoded constants, or a configurable `window.ANALYTICS_POLICY`-style object
   (mirroring the `LEAVE_POLICY`/`STATUTORY` precedent from other workstreams this session) so
   Neil can tune them without a code change?
8. **"Conclusion" block — computed live on every render, or persisted as a daily snapshot?**
   Live computation is cheap (reuses already-fetched arrays, no new collection, no rules
   change) but can't be referenced historically ("what did the conclusion say last Tuesday?") or
   fed into a scheduled digest without also running the dashboard's fetch/compute path headlessly
   in a Cloud Function. A persisted `analytics_snapshots/{date}`-style doc would need its own
   rules block and a decision on retention/backfill — and is the more natural shape if the daily
   digest (open decision 13) needs to embed the SAME conclusion text server-side.
9. **Strategy page — nav placement, role gate, and page architecture.** Fully greenfield: no
   existing `page:'strategy'` entry, no `renderStrategy` function. Decide the nav gate (same
   four roles as Analytics — president/manager/secretary/finance — or narrower, e.g.
   president/finance only, given it surfaces pricing/collections recommendations); whether it's
   a new top-level nav item or a 7th Analytics subtab; and whether recommendations are generated
   fresh per-visit (cheap, always current) or read from the same persisted snapshot as decision
   8 (consistent with what the daily digest emailed/pushed that morning).
10. **Market-research notes section per department — storage shape and write permissions.**
    Reuse the existing `settings/{docId}` singleton pattern (zero new rules, but only supports
    one overwritten blob per doc, no per-entry history — matching `settings/sales_sop`'s
    existing limitation) vs. a new collection with per-entry authorship/timestamp/history (more
    capable, needs new rules + a decision on who can write per department — `canEditDept(dept)`
    is the existing gate function other department screens use, per CLAUDE.md's conventions
    section, and is the natural candidate here too).
11. **Theme-aware charts — promote `cssVar()` to a shared helper, and how far to retrofit.**
    The existing `Notifs.showToast` closure proves the technique works; decide whether to (a)
    promote it verbatim to `window.cssVar(name, fallback)` in config.js and mechanically
    re-point all 13 `new Chart(` sites' `color:'#ebebf5bb'`/`'#ffffff18'` literals at
    `cssVar('--text-muted', '#ebebf5bb')`/`cssVar('--border', '#ffffff18')`-equivalents, or (b)
    build a richer `window.chartTheme()` that returns a whole palette object once per render (one
    call instead of ~30 inline `cssVar()` calls across 13 sites) — and whether charts need to
    re-render (not just re-color) when `auto` theme flips live via `matchMedia`, given today
    charts are constructed once at tab-open and never revisited.
12. **Dataset color palette — re-point only the theme-dependent chrome (legend/tick/grid), or
    also consolidate the ad hoc per-dataset palette?** The 13 sites' dataset colors
    (`#30D158`/`#FF453A`/`#0A84FF`/`#636366`/`#FF9F0A`/`#9BA8FF`/`#34C759`/`#FFAA00`) are
    semantically consistent within each chart (green=good, red=bad, blue=neutral) but are
    independently-chosen literals with no shared "chart palette" constant. Consolidating those
    too is a larger, separate-scope cleanup (touches what a color MEANS, not just whether it
    reads a CSS var) — decide if it's in-scope for this workstream or explicitly deferred.
13. **Server-side daily digest mechanism — new Firebase Scheduled Function vs. extend the
    GitHub Actions cron precedent.** Two real options exist in this codebase today, with
    different cost/ops tradeoffs: (a) a genuinely new `functions.pubsub.schedule`/`onSchedule`
    Cloud Function — the FIRST of its kind here, requiring the Blaze billing plan (‼️ flag for
    Neil — confirm current billing tier before assuming this is free) but keeping all logic
    inside `functions/index.js` with direct `firebase-admin` Firestore access; (b) a new
    `.github/workflows/*.yml` cron (matching `sync-to-drive.yml`'s daily `'0 16 * * *'`
    precedent) plus a `scripts/` Node runner using the existing `FIREBASE_SERVICE_ACCOUNT`
    secret — no new billing dependency, but the script would need its own Firestore
    read/aggregate logic duplicated (or shared) with whatever computes the live dashboard
    numbers, and cannot easily send a push notification without also duplicating the FCM-send
    logic that `sendPushOnNotification` already owns.
14. **Data-availability scoping — build against only currently-available data, or sequence
    behind unbuilt Phase 4 workstreams?** Per Current State item 8: win-rate, payroll ratio,
    Production on-time%, and a project-age (or even invoice-due-date) AR aging are ALL
    computable today with zero upstream dependency; cash position (WS36), inventory turns
    (WS29), a CRM-stage win-rate (WS32), and any material-price-trend recommendation (WS29/30)
    are NOT. Decide whether this workstream ships v1 scoped to the currently-available metrics
    with an explicit, documented "wire in X once workstream Y ships" list (recommended shape per
    the task's own framing, but Fable's call), or whether specific sub-features are deliberately
    blocked/sequenced to run only after those Phase 4 workstreams land.
15. **Digest recipients and channel.** If a server-side digest is built (decision 13), decide
    who receives it (all Analytics-gated roles — president/manager/secretary/finance — or a
    narrower "president + finance" set given the sensitivity of AR/collections content), what
    channel (writing into `notifications/{uid}/items` so the existing push pipeline fires
    automatically — cheapest, reuses `sendPushOnNotification` — vs. a new email dependency, which
    this repo has zero precedent for: no `nodemailer`/SendGrid/etc. dependency exists in
    `functions/package.json` today), and the dedup key shape (mirroring `checkLowStock`'s
    `'lowstock-'+uid+'-'+bizDate()` convention so a redeployed/retried scheduled function can't
    double-send the same day's digest).

## Risks / cross-workstream interactions

- ⚠️ This is the LAST workstream in the 40-item plan and the audit above confirms it is not
  self-contained: 4 of the mandate's 6 named metrics (cash position, inventory turns, a
  CRM-stage win-rate, any price-trend recommendation) depend on data shapes that Phase 4
  workstreams 29 (Inventory correctness), 30 (Purchasing), 32 (Sales CRM), and 36 (Finance
  additions) are meant to introduce or correct — all still `[ ]` not started per V12-PLAN.md.
  Building this workstream's Strategy/recommendation logic against TODAY's `inventory_items`
  (no movements log) or TODAY's absent bank-accounts data risks producing confidently-wrong
  numbers (e.g. an "inventory turns" figure computed from a single live snapshot with no
  history is not a turns ratio at all) rather than an honest "not available yet" state.
- ⚠️ Collision risk with WS16's governing "no displayed money number changes" constraint: any
  new derived metric (an insight sentence's dollar figure, a Strategy-page recommendation
  amount) that recomputes a number slightly differently than an adjacent KPI card (different
  period boundary, different `ledgerKind` filter, a different win-rate definition per item 3)
  creates a visible internal contradiction on the same page — worse for trust than the current
  "just numbers, no narrative" state, since a wrong SENTENCE reads as an authoritative claim in
  a way a wrong number in isolation does not.
- ⚠️ Collision risk with WS17 (Design-system consolidation, this session): WS17 explicitly
  left `.kpi-value`/`.stat-num` CSS byte-identical and deliberately did NOT touch chart color
  logic (the 13 `new Chart(` sites are still 100% hardcoded post-WS17, confirmed above) —
  meaning this workstream inherits WS17's THEMES/token system as a stable foundation but must do
  its OWN chart-theming work; it should not assume WS17 already started this (it explicitly
  didn't — WS17's Build Log scope was CSS/icons/theme-switching infrastructure only, not
  chart internals).
- ⚠️ The `dpSnap` bug found in item 2 (Design-board projects referenced but never fetched,
  always `[]`) is a PRE-EXISTING gap in `renderAnalytics`, not something this workstream
  introduces — but if this workstream's Strategy engine or conclusion text reads from
  `allProjects` (e.g. "N open projects, ₱X receivable"), it will silently inherit an
  undercount that already exists today. Worth deciding whether to fix that one-line gap as part
  of this workstream (cheap, in the same function) or flag it as a separate, smaller,
  spin-off fix.
- ⚠️ If the digest mechanism becomes a genuinely new Firebase Scheduled Function (open decision
  13a), that is a NEW recurring cost line item (Blaze billing) Neil has not previously incurred
  in this codebase for any prior workstream this session — every other automation to date
  (backup, Drive sync, keepalive) runs on GitHub Actions' free minutes. This should be
  surfaced as a clear, single-sentence decision point for Neil, not buried inside a larger spec.
- ⚠️ Three independently-defined "win rate" calculations (item 3) is the same
  three-surfaces-disagree bug class flagged elsewhere this session for CashAdvance (per the
  payroll-pay-run-workflow memory) — a Strategy-page rule like "quote win-rate fell — review
  pricing" that silently picks just ONE of the three without saying which, or without the other
  two screens' win-rate numbers being reconciled to match, reproduces that exact bug class in a
  new place.

## Files likely touched

`js/app.js` (`renderAnalytics` and its 6 sub-renderers, app.js:6340-6778, for any new insight
sentence/conclusion block/theme-aware chart color logic; `getSidebarItems`/nav around
app.js:838-924 and the `navigateTo` switch around app.js:1870-2010 if a Strategy page gets a new
nav entry; `renderFinanceDashboard`'s existing Receivables Aging card, app.js:2775-2861, if AR
aging is unified rather than left duplicated; `THEMES`/`setTheme`/`initTheme`, app.js:829-887,
only if chart re-theming needs a live-swap hook beyond what already exists), `js/config.js`
(home for any new shared helper: a promoted `window.cssVar`, a `window.Insights`/recommendation-
rule module, a `window.ANALYTICS_POLICY`-style threshold config, alongside the existing
`ledgerKind`/`Period`/`dbCachedGet` helpers it must compose with), `js/departments.js`
(`window.Projects.normalize`/`listAll`, departments.js:55-90+, if AR aging migrates to
invoice-due-date; the 3 win-rate call sites at app.js:6522-6527/6719-6724 and
departments.js:9163-9174 if unified; `openJobBillingInvoiceModal`, departments.js:12309-12374,
only if invoice `due` becomes required rather than optional), `js/notifications.js`
(`checkLowStock`'s dedup-key pattern as the template for any new digest dedup; possibly a new
`Notifs.sendDigest`-style function if the digest write-path reuses the notification inbox),
`functions/index.js` (only if the digest becomes a Cloud Scheduled Function — genuinely new
territory, no existing `onSchedule` to extend), `scripts/` + a new `.github/workflows/*.yml`
(only if the digest instead follows the GitHub Actions cron precedent), `firestore.rules` (any
new collection: a persisted analytics/conclusion snapshot, a Strategy-recommendations
collection, a market-research-notes collection if not reusing `settings/{docId}`), `css/
styles.css` (only if new chart-legend/UI chrome needs new tokens beyond the existing
`--text-muted`/`--border`/`--success`/`--warning`/`--danger`/`--surface2` set already available),
`sw.js` (CACHE_VER bump, required on any JS/CSS edit per repo convention).

## Expected deliverable format

> A numbered build spec Sonnet can execute without further judgment calls: one, the exact
> decision made for each open decision above, stated as a one-line policy (e.g. which AR-aging
> anchor, which single win-rate definition becomes canonical and whether the other two screens
> get updated to match or stay separately-labeled, live-vs-persisted conclusion text, which
> digest mechanism). Two, exact function signatures and before/after code for any new shared
> helper (a `window.cssVar`/`window.chartTheme` promotion with the literal replacement diff for
> each of the 13 `new Chart(` sites by file:line; a rule-based insight/recommendation engine
> with its threshold inputs and output sentence shape spelled out; any policy config object
> mirroring the `LEAVE_POLICY`/`STATUTORY` precedent). Three, the exact new or changed Firestore
> document shapes — field name, type, default — for any new collection (digest log, persisted
> snapshot, Strategy recommendations, market-research notes), plus a literal `firestore.rules`
> diff in the same comment-then-match style as the existing rules file, for every collection
> touched. Four, if a Firebase Scheduled Function is chosen: the exact `onSchedule` cron
> expression (Manila-time-correct), its Firestore read/aggregate logic, its dedup mechanism
> against re-invocation, and an explicit callout that this requires the Blaze plan, sequenced
> against the existing `cd functions && npm run deploy` step (separate from `git push`). Five,
> an explicit list of which named metrics ship in v1 (fully wired) vs. which are stubbed with a
> "pending workstream N" placeholder, cross-referenced against workstreams 28/29/30/32/36 by
> number, so a later session knows exactly what to "wire in" once each of those ships and
> doesn't have to rediscover the dependency. Six, a numbered manual test checklist (no automated
> suite in this repo) covering: each KPI card showing consistent numbers with its
> already-existing counterpart elsewhere in the app (Overview vs Finance-tab payroll ratio,
> Analytics vs Finance-Dashboard AR totals), an insight sentence changing correctly when the
> underlying number crosses its threshold in a test/staging scenario, chart legend/tick
> legibility under BOTH the Office (light) and Obsidian (dark) themes plus a live `auto` OS-scheme
> flip, and — if built — one real end-to-end firing of the scheduled digest with its
> notification/push landing in the existing inbox UI.
