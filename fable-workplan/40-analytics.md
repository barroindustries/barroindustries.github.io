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

## DECIDED — architecture spec (Fable, 2026-07-11)

> **Binding upstream contracts (this spec builds on, never re-decides):**
> **WS32** — all win/loss math via `window.isQuoteWon/isQuoteLost/isQuoteOpen` (config.js), all
> client rollups via `window.Clients.listAll()` (cache key `'clients'`), CRM stage funnel is a
> separately-labeled "Client conversion" — NOT a win-rate input; revenue-per-client joins go
> `ledger.projectId → job_projects.clientId`, never name-string scans (32-sales-crm.md:1206-1209).
> **WS36** — cash position = `await window.BankAccounts.cashPosition()` → `{total, perAccount}`;
> registry-empty IS the feature flag (empty → placeholder card, never a flow proxy)
> (36-finance-additions.md:87). **WS29** — inventory turns = decision 12's formula verbatim
> (29-inventory.md:694-703). **WS39** — period reads are date-range-bounded queries
> (`ledgerForPeriod`/`ledgerSince`); fixed-row-count reads banned; `finance_rollup` declined —
> WS40 likewise persists NO aggregation/snapshot doc.

### Resolved decisions (numbered to match the 15 open decisions)

1. **Cash position → option (b) placeholder now, WS36's `cashPosition()` on the same card once
   accounts exist — exactly per the WS36 handoff.** The Overview gains ONE new KPI card "🏦 Cash
   Position": if `window.BankAccounts?.cashPosition` is undefined OR `(await
   BankAccounts.list()).length === 0`, the card renders "—" with sub-line "Register bank accounts
   (Finance → Bank Accounts) to activate" (pending WS36 implementation); otherwise it renders
   `fmt(total)` with a tap-to-expand per-account list from `perAccount`. It NEVER falls back to
   the "Net Cash (period)" flow figure — that existing KPI stays as its own separate, unchanged
   card (`netMTD`, app.js:6451/6477). Fine-print on the real card (WS36's accepted residual
   gap): "excludes statutory remittances until WS39's remittance flow ships."
2. **AR aging → invoice-due-date anchor with project-age fallback, computed by ONE shared
   `window.arAging()` helper used by BOTH surfaces.** Anchor per project = the EARLIEST `due`
   across `p.invoices[]` entries; when no invoice carries a `due` (the common legacy case),
   fall back to project `createdAt` — i.e. today's Finance-Dashboard proxy IS the fallback, so
   projects without due-dated invoices bucket identically to today. A new "📥 Receivables
   Aging" card is added to the Analytics→Finance tab (`renderFinanceAnalytics`), and
   `renderFinanceDashboard`'s existing card (app.js:2810-2861) is REWIRED onto the same helper
   — no 4th independent AR number. **Money note:** total AR is unchanged by construction (same
   `arBalance>0` set, same sum); per-BUCKET amounts MAY shift for projects that have due-dated
   invoices — that is the deliberate correctness fix, and both surfaces shift together because
   they share the helper. The hardcoded "Chase the 90+ day bucket first" copy (app.js:2860) is
   replaced by a rule that names the actual largest bucket (Spec 3, rule `ar-largest`).
3. **Win-rate → WS32's canonical quote-outcome definition, period; gov bids stay a separately
   named metric.** WS40 adds `window.quoteWinStats(quotes)` and `window.bidWinStats(bids)`
   (thin, pure wrappers in config.js) so the KPI cards and the insight sentences compute from
   literally the same function. "Win Rate (quotes)" = WS32 Spec 7b's formula; "Bid win rate
   (Government)" keeps its `won/lost` status basis but is ALWAYS rendered/spoken with the
   "(Government)" qualifier. The BS quote-approvals card's third definition is already retired
   by WS32 — WS40 touches nothing there. Insight rules name which rate they mean, always.
4. **On-time % → ship the existing task-based definition, relabeled honestly; delivery on-time
   is a documented WS28 wire-in.** The Production KPI copy becomes "On-time task completion"
   (not "On-time delivery"). Once WS28's `production_orders.stageHistory` ships, a true
   delivery metric (= delivery-stage `enteredAt` ≤ order due date) is added as a SECOND,
   separately-labeled KPI — the task metric is not redefined in place (WS16 discipline: don't
   silently change what a displayed number means).
5. **Payroll ratio → confirmed as payroll ÷ period ledger revenue; the two duplicate call
   sites consolidate onto one helper, formula byte-identical.** `window.payrollRatio(totalPayroll,
   revenueForPeriod)` returns the same `totalPayroll/rev*100` (0 when rev ≤ 0). Overview
   (app.js:6462-6463) and Finance tab (app.js:6648) both call it. No denominator change —
   headcount-normalized/gross-margin variants declined (would violate "no displayed money
   number changes" and the mandate names no such variant).
6. **Inventory turns → implement WS29 decision 12's formula verbatim, self-gating on data
   presence.** `window.inventoryTurns(ledgerRows, items, windowDays=365)` (Spec 2c). The KPI
   renders on the Finance tab: when `annualizedCOGS === 0` (no `COS – Direct Material` rows in
   the window — i.e. pre-WS29-consume-costing) it shows "—" with sub-line "pending WS29
   inventory movements"; otherwise `X.X× /yr · ~N days on hand` with fine-print "meaningful
   going-forward from WS29 ship date (WAC-costed)". Negative-qty items included as-is per
   WS29 (they're data errors the count form fixes; hiding them would hide the error).
7. **Insight engine → new `window.Insights` module + `window.ANALYTICS_POLICY` threshold
   config, both in config.js; rules are pure functions over ONE metrics bag.** No per-tab
   duplication. Thresholds are config (the `LEAVE_POLICY`/`STATUTORY` precedent) so Neil tunes
   without code changes — shipped values are ‼️ PLACEHOLDERS (flag below). The engine does ZERO
   fetching: it receives a `metrics` object assembled once per `renderAnalytics` fetch from the
   SAME variables the KPI cards render (the WS16 sentence-equals-number guarantee, Spec 2d).
8. **Conclusion block → computed LIVE on every render; NO persisted snapshot collection.**
   Mirrors WS39's `finance_rollup` "declined" reasoning: a snapshot doc duplicates truth and
   needs write-fanout/retention decisions for a "what did it say last Tuesday" feature nobody
   asked for. The daily digest (decision 13) recomputes its own small number set server-side
   from the same documented formulas — it does not need a snapshot either. If historical
   conclusions are ever wanted, that's a future additive collection, not a v1 blocker.
9. **Strategy page → a 7th Analytics subtab (`🎯 Strategy`), NOT a new nav item; same
   four-role gate as Analytics.** It reuses the exact fetch/cache/`Period` context of
   `renderAnalytics` (zero new reads beyond what Overview already triggers), inherits the
   existing `isPresident()||manager||secretary||finance` gate (app.js:6341) — president/finance-
   only was considered and rejected: managers already see every number the recommendations are
   derived from, and secretary is a view-only oversight role by design. Contents: full insight
   list (uncapped, grouped bad→warn→info→good, each with an action line), a "wire-in status"
   card (the decision-14 stub table, visible in-product), and the market-research notes
   (decision 10). Overview gets a compact "📌 Conclusions" card capped at
   `ANALYTICS_POLICY.maxInsights` with a "See all → Strategy" link.
10. **Market-research notes → NEW small collection `strategy_notes/{deptKey}` with an
    append-only `entries[]` array (WS32 `contactLog` pattern); NOT a `settings/{docId}`
    singleton.** Rationale: the settings match is president-only-write (loosening it would
    loosen `sales_sop`/`employeeOfMonth` too — the exact trap WS26 dodged with
    `settings_holidays`), and a single overwritten blob loses authorship/history. Six fixed doc
    ids: `general`,`sales`,`marketing`,`production`,`finance`,`gov`. Rules read/write =
    `isFinanceOrAdmin()`; the add-entry UI is client-gated to president/manager/finance
    (secretary reads but doesn't write — same client-gate pattern as WS25 decision 9).
11. **Theme-aware charts → promote `window.cssVar(name, fallback)` AND add
    `window.chartTheme()` (option b), one call per sub-renderer; re-render on theme change via
    one `bi-theme-change` event.** `cssVar` is `Notifs.showToast`'s proven closure
    (notifications.js:508-512) promoted verbatim to config.js. `chartTheme()` returns
    `{text, grid, ...CHART_COLORS}` where `text = cssVar('--text-muted','#ebebf5bb')` and
    `grid = cssVar('--border','#ffffff18')` — so Office theme gets `#616161` ticks (legible)
    and dark themes keep today's look. Each of the six sub-renderers opens with
    `const CT = window.chartTheme();`; the 22 `'#ebebf5bb'` and 8 `'#ffffff18'` literals inside
    app.js:6340-6778 become `CT.text`/`CT.grid` (mechanical, Spec 1c). Live re-theme:
    `setTheme()` (and the `auto` matchMedia listener) dispatch `bi-theme-change`;
    `renderAnalytics` installs a self-removing listener that re-runs the ACTIVE tab renderer
    (charts are cheap to rebuild from the already-cached arrays; recoloring in place is more
    code for no gain). `Notifs.showToast`'s local closure is left alone (working code, zero
    benefit to touching it).
12. **Dataset palette → consolidated into ONE `window.CHART_COLORS` constant with semantic
    keys, keeping today's EXACT hex values; re-meaning colors is out of scope.** `{good:'#30D158',
    bad:'#FF453A', neutral:'#0A84FF', warn:'#FF9F0A', muted:'#636366', accent:'#9BA8FF',
    goodAlt:'#34C759', warnAlt:'#FFAA00', goodA:'#30D15822', neutralA:'#0A84FF22'}`. These read
    fine on both themes (they're saturated data colors, not chrome), so they stay literal —
    only the chrome (ticks/grid/legend) is theme-reactive. Zero visual change on dark themes;
    the only intended visual change anywhere is chrome legibility on light themes.
13. **Daily digest → GitHub Actions cron + a `scripts/daily-digest.js` admin-SDK runner
    writing into `notifications/{uid}/items` — NOT a Cloud Scheduled Function.** Rationale:
    (a) zero new billing dependency (Blaze not required; every existing automation runs on
    Actions' free minutes — the brief's ⚠️ cost flag dissolves); (b) matches the
    `sync-to-drive.yml` daily-cron precedent exactly; (c) the brief's objection that an Actions
    script "cannot easily send a push" is wrong in this codebase — writing the notification doc
    IS the push (the existing `sendPushOnNotification` trigger fires on the new doc, FCM logic
    reused untouched). Cron `'0 0 * * *'` = 08:00 Asia/Manila (PH has no DST), plus
    `workflow_dispatch` for manual test runs. Idempotency: deterministic doc id
    `digest_{YYYY-MM-DD}` + a script-side exists-check skip, so a re-run/retry can never
    double-send regardless of the Cloud Function's trigger semantics.
14. **Scoping → v1 ships everything computable today; blocked metrics ship as honest,
    self-activating stubs — nothing is sequenced-blocked.** The stub table (Spec 8) is also
    rendered in-product on the Strategy tab so a later session (and Neil) sees exactly what
    "wires in" when WS28/29/30/32/36 land. Feature detection is always data-shaped
    (registry-empty, zero COS rows), never a hardcoded flag to flip.
15. **Digest recipients → president + finance roles only, in-app notification + existing FCM
    push; no email.** AR/collections and cash content is the sensitive tier (matches WS36's
    `canFinance()`-only registry read). Managers/secretary see the same conclusions live in
    Analytics; they don't get the morning push. No email dependency (zero precedent in
    functions/package.json — correctly stays out). Dedup field `dedupKey:
    'digest-'+uid+'-'+date` mirrors `checkLowStock`'s convention on top of the deterministic id.

**Sequencing:** implement AFTER WS32's Analytics rewire (WS40's `quoteWinStats` wraps WS32's
canonical helpers and its `renderSales` block; if WS40 is implemented first, lift
`isQuoteWon/isQuoteLost/isQuoteOpen` + the Spec-7b block verbatim from 32-sales-crm.md — do not
invent variants). WS36/WS29/WS28/WS30 are NOT blockers (stubs self-activate). The `dpSnap` bug
fix (Spec 4a) is IN scope — one line, in the same function, and our AR/receivables sentences
would otherwise inherit the undercount.

---

### Spec 1 — Theme-aware charts

**1a — config.js additions** (place near `ledgerKind`; config.js loads before every caller):
```js
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
// Dataset palette — TODAY'S exact hexes, single source (decision 12). Not theme-reactive.
window.CHART_COLORS = { good:'#30D158', bad:'#FF453A', neutral:'#0A84FF', warn:'#FF9F0A',
  muted:'#636366', accent:'#9BA8FF', goodAlt:'#34C759', warnAlt:'#FFAA00',
  goodA:'#30D15822', neutralA:'#0A84FF22' };
// One call per chart-bearing render — chrome colors resolved against the LIVE theme.
window.chartTheme = function(){
  return { text: window.cssVar('--text-muted', '#ebebf5bb'),
           grid: window.cssVar('--border',     '#ffffff18'),
           ...window.CHART_COLORS };
};
```

**1b — theme-change event.** In `setTheme` (app.js:~846-865), after the class/`<meta theme-color>`
update: `window.dispatchEvent(new CustomEvent('bi-theme-change'));`. In `initTheme`
(app.js:842-844), the `auto` entry's `matchMedia('(prefers-color-scheme: dark)')` listener (add
one if none exists — today charts can't react anyway) dispatches the same event after
re-resolving. In `renderAnalytics` (after the `bindChipTabs` wiring at 6770-6774):
```js
  const onTheme = () => {
    const bar = document.getElementById('an-tabs') || wrap.querySelector('.chip-tabs');
    if (!bar || !document.body.contains(bar)) { window.removeEventListener('bi-theme-change', onTheme); return; }
    const active = bar.querySelector('.active')?.dataset.tab || 'overview';
    (TAB_RENDERERS[active] || renderOverview)();   // rebuild charts with the new chrome colors
  };
  window.addEventListener('bi-theme-change', onTheme);
```
(Self-removing on the first event after navigation away — same lifecycle trick as the existing
`Chart.getChart(cv).destroy()` swap logic, which continues to handle chart disposal.)

**1c — the 13 `new Chart(` sites (app.js:6508, 6514, 6572, 6578, 6617, 6619, 6673, 6675, 6677,
6712, 6715, 6754, 6757) — mechanical retrofit.** At the top of EACH of the six sub-renderers
(`renderOverview` 6434, `renderSales` 6521, `renderMarketing` 6581, `renderFinanceAnalytics`
6622, `renderProduction` 6680, `renderGovernment` 6718): `const CT = window.chartTheme();`.
Then, within app.js:6340-6778 ONLY, replace inside `new Chart(...)` options/datasets:

| Literal | Replacement | Count |
|---|---|---|
| `'#ebebf5bb'` (legend labels + axis ticks) | `CT.text` | 22 |
| `'#ffffff18'` (grid lines) | `CT.grid` | 8 |
| `'#30D158'` / `'#34C759'` | `CT.good` / `CT.goodAlt` | 15 / 1 |
| `'#FF453A'` | `CT.bad` | 8 |
| `'#0A84FF'` | `CT.neutral` | 8 |
| `'#FF9F0A'` / `'#FFAA00'` | `CT.warn` / `CT.warnAlt` | 6 / 1 |
| `'#636366'` | `CT.muted` | 10 |
| `'#9BA8FF'` | `CT.accent` | 1 |
| `'#30D15822'` / `'#0A84FF22'` | `CT.goodA` / `CT.neutralA` | — |

Representative before/after (site 6508 pattern):
```js
// BEFORE
plugins:{legend:{labels:{color:'#ebebf5bb'}}}, scales:{y:{ticks:{color:'#ebebf5bb'},grid:{color:'#ffffff18'}}}
// AFTER
plugins:{legend:{labels:{color:CT.text}}}, scales:{y:{ticks:{color:CT.text},grid:{color:CT.grid}}}
```
Hex literals OUTSIDE `new Chart(` calls (KPI-card HTML) are untouched. WS32's Spec 7d chart
(the rewritten `sq-chart`) gets the same treatment when both land. Do NOT sweep other files —
grep confirms all 13 chart sites live in this one range.

### Spec 2 — Shared metric helpers (js/config.js)

**2a — quote/bid outcome stats** (thin wrappers over WS32's canonical helpers — the ONE place
both KPI cards and sentences compute from):
```js
// v12 WS40 — the single win-rate computation. KPI cards AND Insights read this.
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
window.payrollRatio = function(totalPayroll, revenue){    // decision 5 — formula unchanged
  return revenue > 0 ? (totalPayroll / revenue) * 100 : 0;
};
```

**2b — AR aging engine** (decision 2; replaces the inline bucket loop at app.js:2810-2861 AND
powers the new Analytics card):
```js
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
```

**2c — inventory turns** (WS29 decision 12, verbatim math; date-range discipline per WS39):
```js
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
```

**2d — the metrics bag** (assembled in a NEW closure fn `buildMetrics()` inside
`renderAnalytics`, called once after the `Promise.all`, result stashed as `const M = ...` in
the shared closure so ALL six sub-renderers + `renderStrategy` read the same object). **This is
the WS16 guarantee: every field of `M` is either the exact variable a KPI card renders, or is
rendered ONLY by cards this workstream adds.** Fields:
```js
M = { periodLabel,                                     // Period.parse(...).label
  revP, ledOutP, netP,                                 // the existing Overview figures (6451/6477) — reused, not recomputed
  payrollTotal, payrollRatio,                          // payrollRatio(payrollTotal, revP) — both call sites now read this
  aging,                                               // window.arAging(allProjects) — Spec 2b
  q: quoteWinStats(salesQuotes), qPrev,                // this period vs previous same-type period (WS32 wonMTD/wonPrev ymOf pattern)
  bid: bidWinStats(govBiddings),
  onTimeRate, prodDoneCount, prodOverdueCount,         // the existing renderProduction figures (6685-6693) — reused
  dueFu,                                               // WS32 Spec 7b's due-follow-up count
  cash: null | {total, perAccount},                    // WS36 gate (decision 1)
  turns: null | {turns, daysOnHand, invValue}          // Spec 2c gate (decision 6)
};
```

### Spec 3 — `window.ANALYTICS_POLICY` + `window.Insights` (js/config.js)

```js
// ── Analytics conclusions engine (v12 WS40) ─────────────────────────
// ‼️ Every threshold below is a PLACEHOLDER for Neil to tune — see flags.
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
// Pure rule engine: rules read ONLY the metrics bag M (Spec 2d) + POLICY. No fetches,
// no Date.now() — 'as of' semantics live in M. Output: ordered insight objects.
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
```
**Rendering (Overview "📌 Conclusions" card, inserted after the KPI grid in `renderOverview`):**
severity chip colors via `cssVar('--danger'/'--warning'/'--text-muted'/'--success', …)`; list =
`Insights.compute(M).slice(0, ANALYTICS_POLICY.maxInsights)`; each row = `icon + text` with the
`action` as a muted sub-line; footer link `See all → 🎯 Strategy` that programmatically activates
the strategy chip. All dynamic names are escaped INSIDE the rules (`_esc`), numbers via `fmt()` —
render with template strings as usual.

### Spec 4 — Analytics wiring changes (js/app.js)

**4a — `dpSnap` bug fix (pre-existing, adopted here).** Replace the broken manual merge
(app.js:6383-6388, `dpSnap?.docs||[]` never fetched) with the WS32-canonical unified read: in
the `Promise.all` (6357-6371) REMOVE the phantom `dpSnap` binding and ADD
`cg('projects-unified', () => window.Projects.listAll())` (the WS32-established cache key); then
`const allProjects = <that result>;` deleting the normalize-merge block. Design-board projects
enter Overview's Top-Clients/Receivables (and our `arAging`) for the first time — the
receivables TOTAL may increase; this is the bug fix, called out in the test checklist, not a
silent drift.

**4b — new cached reads (Finance tab only, WS16-conformant).** For the turns KPI:
`cg('inventory_items', db.collection('inventory_items'))` (reuse the existing key if one
already exists — grep first) and `cg('ledger>='+turnsStart, () => window.ledgerSince(turnsStart))`
where `turnsStart` = bizDate−365d (this reuses `ledgerSince`'s own canonical key shape,
config.js:397-411, and the `ledger` alias invalidation reaches it). Both fetched INSIDE
`renderFinanceAnalytics` (lazy — Overview doesn't pay for them), 60s TTL.

**4c — Finance tab AR aging card** (`renderFinanceAnalytics`, 6622-6679): add a "📥
Receivables Aging" card rendering `M.aging` — four bucket stat cells (labels 0–30 / 31–60 /
61–90 / 90+, amounts via `fmt`) + the top-debtor line (escHtml). Same bucket cell markup as the
Finance-Dashboard card for visual consistency.

**4d — Finance-Dashboard card rewire** (app.js:2810-2861): delete the inline `_daysSince`
bucket loop; compute `const a = window.arAging(openARProjects);` and render `a.cur/a.d3160/
a.d6190/a.d90`. Replace the static line at 2860 with the dynamic largest-bucket copy
(same logic as rule `ar-largest`, inline): `Chase the <strong>${label}</strong> bucket first
(₱${fmt(a[k])}).` — falling back to a neutral "Receivables are current." when `cur` is largest.

**4e — payroll-ratio consolidation:** app.js:6462-6463 and 6648 both become
`window.payrollRatio(totalPayroll, revP)` — rendered values byte-identical to today.

**4f — Production KPI relabel** (6693 card copy): "On-time Rate" → "On-time task completion".

**4g — Strategy subtab:** `SUBTABS` (6419-6426) gains `{key:'strategy', label:'🎯 Strategy'}`
(7th, last); `TAB_RENDERERS` (6760-6767) gains `strategy: renderStrategy`. `renderStrategy()`
(new closure sibling of the six): (1) full `Insights.compute(M)` list grouped by severity with
action lines; (2) "Wire-in status" card = the Spec 8 table rendered as rows
(`metric · status · pending workstream`); (3) Market research notes: chip row over the six
`strategy_notes` dept keys; active dept shows `entries` newest-first (cap 30, each
`date · byName — note`, all through escHtml), plus, when
`['president','manager','finance'].includes(currentRole)`, a textarea + "Add note" button:
```js
await db.collection('strategy_notes').doc(deptKey).set({
  dept: deptKey,
  entries: firebase.firestore.FieldValue.arrayUnion({
    date: window.bizDate(), by: currentUser.uid,
    byName: userProfile?.displayName || currentUser.email, note: noteText.trim() }),
  updatedAt: firebase.firestore.FieldValue.serverTimestamp()
}, { merge: true });
dbCacheInvalidate('strategy_notes');
```
Read via `cg('strategy_notes', db.collection('strategy_notes'))` (≤6 docs). No charts on this
tab in v1 (no `ensureChart` needed there).

### Spec 5 — firestore.rules diff (ONE new block)

Insert near the other v12 collections (after `settings_holidays` if WS26's block exists, else
after `settings/{docId}` ~372). Rules do not cascade — this is the only new collection.
```
    // ── Strategy / market-research notes (v12 WS40) ──────────────────
    // docId ∈ {general,sales,marketing,production,finance,gov}. Read scoped to the
    // Analytics tier (president/manager/secretary/finance); entries appended via
    // arrayUnion. Secretary is view-only CLIENT-side (WS25 decision-9 pattern) —
    // rules keep the tier uniform. .get() defaults per missing-field-throws memory.
    match /strategy_notes/{deptKey} {
      allow read:  if isAuth() && isFinanceOrAdmin();
      allow write: if isAuth() && isFinanceOrAdmin()
        && request.resource.data.get('entries', []) is list;
      allow delete: if isAuth() && isPresident();
    }
```
Deploy `~/.npm-global/bin/firebase deploy --only firestore:rules` — separate from `git push`;
re-run `git diff firestore.rules` immediately before (concurrent-session memory). Add
`strategy_notes` to `scripts/monthly-backup.js` EXPORTS in the same commit. No composite
indexes (all reads are whole-tiny-collection or existing patterns) — firestore.indexes.json
untouched.

### Spec 6 — Cash-position + turns KPI wire-ins (feature-gated stubs)

**6a — Cash Position (Overview KPI row, new card):**
```js
let cash = null;   // null = WS36 not live yet → placeholder card
try {
  if (window.BankAccounts?.cashPosition && (await window.BankAccounts.list()).length)
    cash = await window.BankAccounts.cashPosition();
} catch(_) {}
M.cash = cash;
// card: cash ? `₱${fmt(cash.total)}` (+ expandable perAccount rows, each
//   `${escHtml(x.account.nickname)} · ₱${fmt(x.balance)}`)
//      : `—` with sub-line `Register bank accounts to activate (WS36)`.
// Fine print when live: `Excludes statutory remittances until the WS39 remittance flow ships.`
```
Note: `BankAccounts.list()` is `canFinance()`-gated in rules (WS36 decision 11) — for
manager/secretary sessions the `.catch` collapses to the placeholder; the card sub-line for a
denied-but-registry-exists case reads "Finance-only figure". (Acceptable: the same section of
users who can see the ledger can see cash.)

**6b — Inventory Turns (Finance tab, new KPI):** `M.turns = window.inventoryTurns(ledger365Rows,
invItems)`; render `turns ? `${turns.toFixed(1)}× /yr · ~${daysOnHand}d on hand` : '—'` with the
pending/fine-print copy per decision 6.

### Spec 7 — Daily digest (GitHub Actions + scripts/daily-digest.js)

**7a — `.github/workflows/daily-digest.yml` (NEW):**
```yaml
name: Daily ops digest
on:
  schedule:
    - cron: '0 0 * * *'    # 00:00 UTC = 08:00 Asia/Manila (PH has no DST)
  workflow_dispatch: {}     # manual test runs
jobs:
  digest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: cd scripts && npm ci && npm run digest
        env:
          FIREBASE_SERVICE_ACCOUNT: ${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
```
`scripts/package.json` gains `"digest": "node daily-digest.js"`. Secret already exists (used by
sync/backup).

**7b — `scripts/daily-digest.js` (NEW, firebase-admin, mirrors `monthly-backup.js` boot).**
Steps, all date-range-bounded (WS39 discipline, no `.limit(N)`):
1. `today = new Date(Date.now() + 8*3600e3).toISOString().slice(0,10)` (Manila; PH has no DST —
   the server-side equivalent of `bizDate()`); `monthStart = today.slice(0,8) + '01'`.
2. **MTD net cash flow:** `ledger.where('date','>=',monthStart).where('date','<=',today)`;
   classify each row exactly like `window.ledgerKind` (config.js:676-683): `accountType`
   `'income'`→in / `'expense'`→out / `'asset'|'liability'`→SKIP (the WS13 leg exclusion);
   rows with no `accountType` → `type==='credit'` ? in : out. (Legacy-category map omitted —
   MTD rows post-date WS13 and always carry `accountType`; comment this in the script.)
3. **AR:** `job_projects.where('arBalance','>',0)` → `arTotal`, `count` (stored `arBalance` is
   kept in sync — departments.js:12297; totals only, no aging server-side in v1).
4. **MTD quote outcomes:** `bk_quotes` + `bs_quotes` + `quotes` created since `monthStart`
   (each `.where('createdAt','>=',<monthStart Timestamp>)`), WON/LOST per WS32's canonical
   definition duplicated with a `// MUST match window.isQuoteWon/-Lost (32-sales-crm.md Spec 2a)`
   comment: won = `salesOrderId || status==='won' || status==='accepted'`; lost =
   `status==='rejected'`.
5. **Recipients:** `users.where('role','==','president')` ∪ `users.where('role','==','finance')`.
6. **Write (idempotent):** for each uid, `ref = notifications/{uid}/items/digest_{today}`;
   `if ((await ref.get()).exists) continue;` then `ref.set({ title: '📊 Daily Ops Digest — '
   + today, body: <two sentences: 'MTD: ₱X in / ₱Y out (net ₱Z). Receivables: ₱A across N
   projects. Quotes MTD: WwW/LlL.'>, icon:'📊', type:'daily_digest', dedupKey:
   'digest-'+uid+'-'+today, read:false, createdAt: FieldValue.serverTimestamp() })`. The
   existing `sendPushOnNotification` Cloud Function fires on the new doc — push delivery reuses
   the shipped FCM path with ZERO functions/ changes and NO Blaze requirement.
7. Digest copy is COARSE by design (MTD totals + counts, labeled "MTD") so it can only be
   compared against the Overview's month period — the two are computed from the same
   definitions documented here; no per-insight sentences server-side in v1 (those live client-
   side where the full metrics bag exists).

### Spec 8 — v1 ship matrix (also rendered on the Strategy tab)

| Metric / feature | v1 status | Activates when |
|---|---|---|
| Quote win rate (+ prev-period delta rule) | ✅ live (WS32 canonical) | now (post-WS32 helpers) |
| Bid win rate (Government) | ✅ live, separately labeled | now |
| Payroll ratio (% of revenue) | ✅ live (consolidated helper) | now |
| On-time task completion (Production) | ✅ live (relabeled) | now |
| AR aging (due-date anchor + fallback) | ✅ live, both surfaces unified | now |
| Conclusions card + Strategy tab + notes | ✅ live | now |
| Theme-aware charts (13 sites) | ✅ live | now |
| Daily digest (Actions cron → notif/push) | ✅ live | now (after secret check) |
| Cash Position KPI | 🔲 placeholder card | **WS36** implemented + ≥1 bank account registered |
| Inventory turns KPI + turns-slow rule | 🔲 "—" until COS rows exist | **WS29** implemented (consume-time COS @ WAC) |
| On-time DELIVERY % (second KPI) | ⛔ not built | **WS28** `stageHistory` (delivery `enteredAt` vs due date) |
| Material price-trend insights | ⛔ not built | **WS29** movement cost trail + **WS30** PO receiving |
| Purchasing recommendations | ⛔ not built | **WS30** `purchase_requisitions`/receiving analytics |
| `job_costs` materials in any metric | ⛔ excluded | per WS29 decision 11(c) — third manual number, unreliable |

### Spec 9 — Migration / rollout checklist (ordered)

1. **Deploy rules** (Spec 5, `strategy_notes` only) via `--only firestore:rules`, re-diffing
   first. Old clients unaffected (they never read the collection).
2. **Ship config.js helpers** (Specs 1a, 2a-2c, 3) + the app.js wiring (Specs 1b-1c, 4a-4g) in
   one commit. `node --check` each edited file; CACHE_VER/APP_VERSION bump via the pre-commit
   hook (verify CACHE_VER moved — it is the one thing users' stale SW caches hinge on).
3. **No data migration exists in this workstream** — no backfill, no snapshot seeding, no new
   indexes. `strategy_notes` docs are created lazily on first note.
4. **Digest:** add `daily-digest.yml` + `scripts/daily-digest.js` + the `digest` npm script;
   trigger once via `workflow_dispatch` and verify the notification + push land (test №12)
   BEFORE trusting the cron.
5. **Backup coverage:** add `strategy_notes` to `scripts/monthly-backup.js` EXPORTS (same
   commit as step 2).
6. **Confirm ANALYTICS_POLICY numbers with Neil** (flags below) — the engine ships with
   placeholders that only affect sentence copy, never money numbers, so this can follow ship.
7. **Post-WS36 / post-WS29 wire-ins are ZERO-code activations** (data-shaped gates) — verify
   each stub flips live during THOSE workstreams' test passes, per the Spec 8 matrix.

### Spec 10 — Manual test checklist (no automated suite)

1. **Payroll ratio consistency:** Overview KPI vs Finance-tab KPI show the identical % for the
   same period (both now call `payrollRatio`) — byte-identical to pre-change values.
2. **AR unification:** Finance Dashboard aging buckets == Analytics→Finance aging buckets
   (same helper). Total AR == the pre-change total PLUS any Design-board project AR that the
   `dpSnap` fix (4a) legitimately adds — spot-check one design project's `arBalance` explains
   the delta exactly.
3. **Due-date anchor:** on a test project, generate an invoice with `due` 100 days ago while
   `createdAt` is recent → the balance moves to the 90+ bucket (due-date won); remove the due →
   falls back to project-age bucketing.
4. **Dynamic chase copy:** with the largest balance in 31–60, the Finance-Dashboard footer
   names 31–60, not the old hardcoded 90+.
5. **Insight threshold flip:** set `window.ANALYTICS_POLICY.payrollRatioWarnPct = 1` in the
   console, re-open Analytics → the payroll warning appears with the same % as the KPI card;
   restore to 35 → it disappears; with nothing firing, the ✅ all-clear line shows.
6. **Win-rate sentence == KPI:** the win-rate-drop sentence's "to Y%" equals the Sales tab's
   Win Rate KPI for the same period (both from `quoteWinStats`).
7. **Theme legibility:** open each of the 7 subtabs under Office (light) → axis ticks/legends
   are dark gray (`#616161`-ish), grid subtle; switch to Obsidian (dark) via the theme picker
   WITHOUT reloading → charts on the open tab re-render with light ticks (the `bi-theme-change`
   hook); set theme `auto` and flip the OS scheme → same live re-render. Navigate away, flip
   theme again → no console errors (listener self-removed).
8. **Strategy tab:** visible for president/manager/secretary/finance; absent for
   employee/agent/partner (whole Analytics gate). Secretary sees notes but NO add-note form;
   manager adds a note → entry appears with today's `bizDate()` + their name, escaped (test a
   note containing `<b>`); rules: employee console-write to `strategy_notes/sales` → DENIED.
9. **Cash Position stub:** pre-WS36 the card shows the placeholder (and no Net-Cash fallback
   number on it); the existing "Net Cash (period)" card is unchanged.
10. **Turns stub:** with zero `COS – Direct Material` rows in the last 365d the Finance-tab KPI
    shows "—/pending WS29"; seed one COS row in a test ledger → KPI computes and the value
    equals decision 12's formula by hand.
11. **Read-cost regression guard:** Network tab on Analytics open — the only NEW Firestore
    reads vs pre-WS40 are `strategy_notes` (≤6 docs), `inventory_items` + the 365d ledger range
    (Finance tab only, cached 60s), and (post-WS36) `bank_accounts`. No uncached repeats on
    tab-switching within 60s.
12. **Digest end-to-end:** run the workflow via `workflow_dispatch` → president + finance users
    each get ONE `digest_{today}` inbox item and an FCM push (existing pipeline); re-run the
    workflow same day → NO duplicate (exists-check); digest MTD net matches the Overview
    month-period Net Cash sign and magnitude; a manager gets NO digest.
13. **Sentence escaping:** name a test client `<img src=x onerror=alert(1)>` with an AR balance
    → the ar-90 sentence renders it inert.

### Flags for Neil

- **‼️ FLAG FOR NEIL — ANALYTICS_POLICY thresholds are placeholders.** `ar90SharePct:25`,
  `arMinAlert:₱50k`, `winRateDropPts:10`, `payrollRatioWarnPct:35`, `onTimeWarnPct:80`,
  `cashFloor:₱100k`, `turnsSlowBelow:2`. They gate SENTENCES only (never money numbers), so
  wrong values are noisy, not harmful — but please set real ones (esp. `cashFloor` and
  `payrollRatioWarnPct`, which are business judgments).
- **‼️ FLAG FOR NEIL — digest recipients = president + finance only** (decision 15). Managers/
  secretary see everything live in Analytics but get no 08:00 push. Say the word to widen (one
  line in `daily-digest.js`).
- **‼️ FLAG FOR NEIL — no Blaze billing needed.** The digest runs on GitHub Actions (free
  minutes, same as Drive sync/backup); push reuses the existing Cloud Function. The brief's
  Cloud-Scheduler/Blaze question is moot under this design.
- **‼️ FLAG FOR NEIL — AR bucket amounts may shift** on projects that carry due-dated invoices
  (decision 2): the buckets get MORE accurate (invoice due-date beats project age); totals are
  unchanged. Plus the `dpSnap` fix can legitimately RAISE the receivables total by previously
  silently-dropped Design-board project balances. Both are correctness fixes, listed here so a
  changed number isn't mistaken for a regression.
