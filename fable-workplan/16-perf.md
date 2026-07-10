# Workstream 16 — Performance & Scale (aggregate/counter docs, unbounded reads, cache-key unification)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

Verified live on branch `v12` (Phase 1 already committed) by grepping js/app.js, js/departments.js, js/modules.js, js/notifications.js, js/config.js. All line numbers below are re-checked against the current tree, not the old audit artifact.

## A. window.dbCachedGet — the actual cache API (js/config.js:212-239)
```js
window.dbCachedGet = async function(key, fetcher, ttlMs = 30000) {
  if (key === 'users' && typeof window.fetchUsersWithPayroll === 'function') {
    fetcher = window.fetchUsersWithPayroll;               // <- silently overrides caller's fetcher
  }
  const entry = _store[key];
  if (entry && Date.now() - entry.ts < ttlMs) return entry.data;
  if (entry && entry.pending) return entry.pending;         // de-dupes concurrent same-key calls
  const promise = fetcher().then(data => { _store[key] = {data, ts: Date.now(), pending:null}; return data; })
    .catch(err => { delete _store[key]; throw err; });
  _store[key] = { data: null, ts: 0, pending: promise };
  return promise;
};
window.dbCacheInvalidate = function(key) { if (key) delete _store[key]; else Object.keys(_store).forEach(k=>delete _store[k]); };
```
Single in-memory `_store` object, module-global (not per-user, not persisted — cleared on full page reload/refresh). Key facts a redesign must respect:
- Cache identity is a flat string chosen ad hoc per call site — no namespacing by collection/query, so two call sites reading the *identical* `db.collection('X').get()` under different key strings get two independent cache slots and two independent Firestore reads (see section B).
- The `key === 'users'` special-case means whatever fetcher a caller passes for key `'users'` is *ignored* — always resolved via `window.fetchUsersWithPayroll` (config.js:195-207), which does 2 full reads (`users` + `payroll`) merged client-side into a users-snapshot-shaped object. Any new cache API must preserve (or deliberately replace) this override.
- `dbCacheInvalidate(key)` must be called manually by every writer; there is no reverse index from "collection written" → "keys to invalidate". Confirmed by grep: `grep -rn "dbCacheInvalidate('an_" js/*.js` returns **zero matches** — none of the 12 `an_*` Analytics cache keys are ever explicitly invalidated anywhere in the app; they rely solely on their 60s TTL. Meanwhile the 'ledger' key IS invalidated on every ledger write (11+ call sites, e.g. departments.js:1429, 1451, 1478, 1517, 1522, 1539, 2288, 2308, 2359, 2752, 3076, 3868, 6190, 8633, 9420, 9676, 10706, 11339, 11656, 12639; app.js:4172). Net effect: after a Finance action, the President/Manager/Secretary dashboards refresh within the write (cache busted), but the Analytics page (`an_ledger`, `an_tasks`, `an_quotes`, etc.) can show stale figures for up to 60s — a live consistency gap caused directly by the duplicate-key pattern, not a bug in the invalidation calls themselves.
- 54 total `dbCachedGet(` call sites across app.js/departments.js/modules.js, spanning 21 distinct literal keys, plus 11 more keys reached indirectly through the `cg()` wrapper inside renderAnalytics (see below) — 32 effective cache identities for what is really ~12-15 distinct underlying queries.

## B. Duplicate / inconsistent cache keys for the same underlying read (grep: `dbCachedGet('` and the `cg('` wrapper it's built on)

**tasks (full `db.collection('tasks').get()`, no `.where()`)** — 3 different keys, 13 call sites, all reading the identical unfiltered collection:
- `'tasks-all'` — 11 sites: app.js:2242 (renderPresidentDashboard), 2458 (renderManagerDashboard), 2569 (renderSecretaryDashboard), 3966, 4115; departments.js:545, 592, 633, 638, 643 (renderTasks-family callers); modules.js:2423 (renderGlobalSearch).
- `'tasks'` — 1 site: modules.js:664, inside `computeEomStandings` (line 644): `dbCachedGet('tasks', () => db.collection('tasks').get(), 60000)`.
- `'an_tasks'` — 1 site: app.js:6098, inside `renderAnalytics`, via the local wrapper `const cg = (key,q,ttl=60000) => dbCachedGet(key, ()=>q.get(), ttl)...` (app.js:6093) called as `cg('an_tasks', db.collection('tasks'))` (app.js:6098). The comment right above it (app.js:6092) is explicit about *why*: "Analytics re-reads the same heavy collections on every visit — cache 60s. Own 'an_' keys so we don't clash with other modules' caches." — i.e. the duplication was a deliberate choice to avoid TTL collisions, not an oversight, but it does duplicate reads.

**ledger (full `db.collection('ledger').get()`, no filter)** — 3 paths:
- `'ledger'` — app.js:2249 (renderPresidentDashboard, 45000ms TTL), app.js:2681 (renderFinanceDashboard, 45000ms).
- `'an_ledger'` — app.js:6104, via `cg()`, 60000ms, in renderAnalytics.
- **Uncached, no limit, no key at all**: departments.js:4516-4517, inside `renderFinanceOverview` (departments.js:4508) — `Promise.all([db.collection('expenses').get(), db.collection('ledger').get()])` fires on every open of Finance ▸ Overview subtab regardless of any TTL.
- Two *bounded* ledger reads already exist as precedent: departments.js:2884 `db.collection('ledger').orderBy('date','desc').limit(3000)` inside `renderFinancialReports`, and departments.js:2974 `.limit(100)` inside `renderLedgerTab` — i.e. the pattern of capping ledger reads is already partially adopted, just not everywhere, and 3000 is itself not future-proof against "records forever" (workstream 15) as the company scales past 3000 rows.

**expenses (full collection)** — same split: `'expenses'` (app.js:2682, 45000ms) vs `'an_expenses'` (app.js:6101, cg(), 60000ms) vs uncached raw read in `renderFinanceOverview` (departments.js:4516).

**quotes (bk_quotes + bs_quotes + legacy quotes, 3 collections merged)** — `getAllQuotes()` (app.js:1919-1931) already self-caches under `'all-quotes'` (30000ms) and documents itself as the shared merge point ("Self-cache under the shared 'all-quotes' key so every caller ... reuses one snapshot instead of re-reading three collections each"). But `renderAnalytics` wraps that same function under a *second* outer key: app.js:6099 `dbCachedGet('an_quotes', getAllQuotes, 60000)`. This double-wraps a cache inside a cache — harmless for read count after first population (the inner 'all-quotes' 30s cache still gates the real 3-collection Firestore reads) but creates the same up-to-60s staleness gap as ledger/tasks, and is confusing to reason about. `dbCacheInvalidate('all-quotes')` is called on quote writes (app.js:1206, 1922) but `'an_quotes'` is never invalidated — same orphaned-namespace pattern.

**users** — the best-unified case: 11 `dbCachedGet('users', ...)` sites all funnel into `fetchUsersWithPayroll` via the config.js:218 override, so despite many call sites there is really only one read pattern. Two genuine outliers:
- `'users-payroll'` — 1 site, app.js:2680 (renderFinanceDashboard): `dbCachedGet('users-payroll', fetchUsersWithPayroll, 30000)`. This is calling the *exact same fetcher* the `'users'` key would already force — a pure accidental duplicate with no documented reason, unlike the next one.
- `'users-presence'` — 1 site, app.js:6511 (renderTeam/Team Directory), deliberately short-TTL (8000ms) with an explanatory comment (app.js:6506-6510): "Short TTL here so the online/offline presence dots reflect 'now' ... Must use the payroll-aware fetcher so the Team table's Base/Allowance/Net columns ... carry merged pay." This one is intentional and should probably stay separate — a genuine open decision, not a bug.
- Both `'users-payroll'` and `'users-presence'` ARE correctly invalidated alongside `'users'` at app.js:6604, 6730, 6792 (all three keys invalidated together) — so at least invalidation hygiene is fine for this family; the only issue is `'users-payroll'`'s redundant read.

**inventory_items (full collection, no cache at all)** — read via 7+ separate uncached `db.collection('inventory_items').get()` calls, each independently full-scanning: js/notifications.js:607 (`checkLowStock`, fires on *every login* for president/manager/finance/Purchasing-dept users — see C1), js/app.js:1686 (`openBomModal`, product BOM costing modal), js/departments.js:11823 (`renderProdInventoryForm`), js/departments.js:12034 (`renderProdMaterials`), js/departments.js:12124 (`renderRFQs`, "From low stock" prefill), js/departments.js:12515 (`receivePurchaseIntoInventory`), js/modules.js:1887 (`renderStock`, the main Inventory ▸ Stock tab). Only 2 sites go through `dbCachedGet('inventory_items', ...)`: app.js:2250/2684 (dashboards, 45000ms) and departments.js:11676 (`prodOrderModal`, 30000ms). Inventory is likely a small-to-medium collection (finite SKU count) so less of a raw-scale risk than ledger/tasks, but it is read redundantly and un-cached in the highest-traffic screens (Inventory tab, login-time low-stock check).

**projects (job_projects + projects, 2 collections merged)** — GOOD existing precedent already in the codebase: `window.Projects.listAll(scope)` (departments.js:55-97) merges both collections into one canonical shape and self-caches under `'projects-unified'` (30000ms), explicitly bypassing the cache for partner-scoped reads to avoid cross-tenant leakage (departments.js:91-94 comment). Invalidated correctly at departments.js:6173, 6245, 6383, 11656. However several call sites bypass this unifier and read the two raw collections directly with no cache at all: departments.js:84-85 and 103-104 (inside the same `Projects` IIFE's `listAll`/`backfillProjectKind` — fine, those are the canonical fetch), but also departments.js:6699, 7591-7592, 11061, 11784 read `job_projects`/`projects` raw outside the unifier — worth flagging as inconsistent adoption of an already-good pattern.

## C. Worst full-collection-read offenders (no `.limit()`, no `.where()` date/status filter, and not behind dbCachedGet)

1. **notifications.js:601-623, `checkLowStock(uid, role)`** — fires on *every successful login/session-resume* for `president`/`manager`/`finance` roles or anyone in the Purchasing dept (called at app.js:81: `Notifs.checkLowStock?.(user.uid, userProfile.role)`, inside the `auth.onAuthStateChanged` handler alongside `startPresenceHeartbeat`/`startAutoLogout`). Body: `const snap = await db.collection('inventory_items').get();` (notifications.js:607) — completely uncached, no limit, runs once per login per eligible user, purely to compute a count for a daily digest notification (deduped by `dedupKey: lowstock-${uid}-${todayStr}`, notifications.js:620). This is the single cleanest aggregate-counter candidate in the app: the *count* is all that's needed, not the documents.
2. **js/departments.js:4508-4517, `renderFinanceOverview`** — every open of Finance ▸ Overview does `Promise.all([db.collection('expenses').get(), db.collection('ledger').get()])`, fully uncached (no dbCachedGet, no limit), purely to sum `ledIncome`/`ledExpense`/`pendingExp` (departments.js:4519-4521). At ledger scale this is the single worst per-click offender because it doesn't even benefit from the 45s dashboard TTL other functions share.
3. **js/app.js:2234-2303, `renderPresidentDashboard`** and its near-duplicate **js/app.js:2670-2699, `renderFinanceDashboard`** — each fires ~7-11 parallel full-collection reads (`users`, `tasks`, `submissions`, `ledger`, `inventory_items`, quotes×3, `job_costs`, plus several `.where('status','==','pending')` bounded reads) purely to compute month-to-date/previous-month sums and simple counts client-side (app.js:2274-2286: `_allLedger.filter(e=>(e.date||'').slice(0,7)===mtd)` — a full-table scan-and-filter in JS for a number that in principle only needs 2 monthly totals). This is the textbook "replace with an aggregate/counter doc, maintained on write" case referenced in V12-PLAN.md workstream 16's own description.
4. **js/app.js:6087-6110, `renderAnalytics`** — 13 parallel collection reads in one `Promise.all` (users, tasks, quotes, submissions, expenses, cash_advances, payslips, ledger, gov_biddings, job_projects, job_costs, projects, sales_clients — app.js:6096-6109), self-documented in-code as "the same heavy collections" re-read on every visit (app.js:6092). This is literally the "analytics×13" line item named in V12-PLAN.md workstream 16.
5. **js/modules.js:1805-1887 area, `window.renderInventory` → `renderStock`** — `db.collection('inventory_items').orderBy('name').get()` (modules.js:1887) on every visit to the main Inventory tab, uncached, just to compute `low` (low-stock filter, modules.js:1890), `totalValue`, `matValue` and render the table.
6. **js/modules.js:2395-2429, `window.renderGlobalSearch`** — on first keystroke, loads 7 collections in parallel (modules.js:2422-2430): `tasks` (cached, key `'tasks-all'` — fine), quotes (via `getAllQuotes`, cached — fine), but `sales_clients`, `design_clients`, `bs_clients`, `inventory_items` are raw uncached `.get()` calls, and only `products` has a `.limit(1000)` (modules.js:2429). Session-local `sources` variable avoids re-fetching within one open of Search, but every fresh open re-reads all 7.

Total distinct "read the whole collection with no bound" call sites found across app.js + departments.js + modules.js for the 4 heaviest collections (ledger, tasks, users, inventory_items): ledger ×4 paths (2 cached same-key + 1 cached different-key + 1 uncached), tasks ×3 keys/13 sites (all cached, just under 3 different keys), users ×2 outlier keys beyond the well-unified 'users' (1 redundant, 1 intentional), inventory_items ×9 sites (2 cached, 7 uncached).

## Data model

All shapes below are read directly from real `.add({...})` / `.get()` call sites, not inferred.

**ledger/{docId}** (source of truth per CLAUDE.md; also see `ledger_entries/{docId}` — a second, apparently legacy/parallel collection with identical rules shape at firestore.rules:601-605, which departments.js does not appear to write to in the paths grepped — worth flagging to Fable as a possible dead/duplicate collection, consistent with the "two 'project' collections" pattern already logged in the finance-reporting-open-items memory). Canonical write shape (departments.js:1418-1428):
```js
{
  date: 'YYYY-MM-DD', type: 'debit'|'credit'|'payslip'(seen elsewhere), description: string,
  amount: number, category: string, refNumber: string (idempotency key, e.g. 'EXP-<id>', 'CRJ-<id>', 'CDJ-<id>', 'PAY-<month>-<uid>', 'POCOS-*', 'SO-*'),
  source: string ('Expense'|'Finance'|'Production'|...), addedByName: string,
  projectId: string|null (optional, seen on Sales Revenue postings, e.g. departments.js:8631, 11338),
  vatAmount/net/vatTreatment: optional numeric/enum fields (seen on Sales Revenue postings),
  dept: optional string (queried at departments.js:10542 `.where('dept','==',dept)`),
  createdAt: firebase.firestore.FieldValue.serverTimestamp()
}
```
Read/aggregated client-side today for: MTD income/expense/net (renderPresidentDashboard, renderFinanceDashboard, renderAnalytics — all via `.filter(e=>(e.date||'').slice(0,7)===mtd)`), expense-by-category breakdown (renderFinanceDashboard: `byCat` object keyed by `e.category`), 6-month trend (renderAnalytics `months6`).

**inventory_items/{docId}** — fields used: `name`, `qty`, `reorderLevel`, `unitCost`, `kind` ('material'|'product', default 'material'), `supplier`, `unit`. Low-stock predicate used identically in 4 places (modules.js:1890, departments.js:12036, app.js:2286/2726): `(i.reorderLevel||0)>0 && (i.qty||0)<=(i.reorderLevel||0)`.

**tasks/{docId}** — fields used for dashboards: `status` (open-vs-closed set is `['done','approved','archived']` = closed, everything else = open — this exact array is repeated verbatim in at least 3 functions: app.js:2256, 2470, 2582), `dueDate` ('YYYY-MM-DD' string, compared lexically against `todayStr`), `priority` ('high'|'medium'|'low'), `department`, `assignedTo` (string or string[]), `openFollowUpCount`. Existing composite indexes (firestore.indexes.json:21-34): `(assignedTo ARRAY_CONTAINS, dueDate ASC)` and `(status ASC, lastModifiedAt DESC)` — no index yet for a `status not-in [...] + orderBy(dueDate)` style bounded query, which a limits/filters redesign would likely need.

**users/{uid}** — profile fields (`displayName`, `email`, `role`, `department`/`departments[]`, `lastSeen`) live here; pay fields (`salary`, `allowance`, `deductions`) are read via the merge in `fetchUsersWithPayroll` from a **separate protected `payroll/{uid}` collection** (config.js:187-207) — per CLAUDE.md/memory, never read payroll off the `users` doc directly.

**Aggregation candidates' natural key shape** (grounding only, not prescribing): ledger MTD sums are always grouped by `date.slice(0,7)` (calendar month string 'YYYY-MM') — any monthly-rollup counter doc would naturally be keyed the same way, e.g. `ledger_monthly/{YYYY-MM}` with fields like `creditTotal`, `debitTotal`, `byCategory: {category: total}`, updated via `FieldValue.increment()` at the exact same call sites that currently do `db.collection('ledger').add({...})` (11+ sites enumerated in section B) and their corresponding delete/cascade paths (departments.js:141-170, `financeDeleteCascade`, which already deletes matching ledger rows by `refNumber` lookup — any new counter doc must be decremented in the same cascade).

## Constraints — must respect

- Manila-time discipline: any new period/aggregation key must be derived via window.bizDate()/bizYear() (config.js:17-37), never raw toISOString(); the existing MTD logic already keys off bizDate().slice(0,7) everywhere (e.g. app.js:2275, 6131) — a new monthly counter-doc scheme must use the identical key format to stay compatible with existing period pickers (finPeriodMatch, app.js:2652-2658).
- Idempotent-ledger-write pattern is load-bearing and must not be broken: every ledger poster does `where('refNumber','==',ref).limit(1).get()` before `.add()` (e.g. departments.js:1416, 1438, 1460, 2665-2709 the payroll aggregate-row poster) to guarantee re-running a backfill/compute never double-posts. Any aggregate/counter-doc write path added alongside these adds must be equally idempotent (e.g. guard re-increment on retry) or it will double-count on the exact retry paths the ledger already defends against (see roadmap-handoff/payroll-compute-existing-bug memory — this codebase has already been bitten by a ReferenceError re-running Compute).
- Firestore rules require an explicit match per collection — no cascade/prefix matching (see firestore.rules:582-605 for the ledger/ledger_entries pattern: read gated by canFinance(), create additionally allows a narrowly-fenced Production posting). Any new aggregate/counter collection (e.g. ledger_monthly, kpi_counters) needs its own explicit firestore.rules match block and, if queried with new where/orderBy combinations, a new entry in firestore.indexes.json (existing precedent: firestore.indexes.json:21-34 for tasks) followed by `firebase deploy --only firestore`.
- dbCacheInvalidate has no reverse index — every write site that should bust a cache key does so by hand-listing the key(s) (e.g. departments.js:11656 lists three: 'projects-unified','ledger','inventory_items'). A redesigned cache layer must either keep this manual-list discipline (and audit for completeness, since 'an_*' keys are currently NEVER listed anywhere) or introduce a structural fix (e.g. derive the key from the collection name so one invalidate call can't miss a sibling key).
- The 'users' key's silent-override behavior (config.js:218-220, forcing fetchUsersWithPayroll regardless of caller) is an existing precedent for 'the cache key controls the fetcher, not the caller' — any unification of tasks-all/tasks/an_tasks or ledger/an_ledger keys could follow this same precedent (canonicalize the fetcher per key) rather than requiring every call site to be edited.
- escHtml() discipline (modules.js) applies to any new UI these changes touch (e.g. if Fable adds new KPI cards) but is not itself central to this workstream — flagged only because filesTouched will include HTML-building code paths.
- Script load order (index.html) is fixed: Firebase SDK/Chart.js/Lucide -> firebase-config.js -> config.js -> drive.js -> notifications.js -> departments.js -> app.js -> modules.js. Any new shared helper (e.g. a unified aggregate-fetch helper) must be defined in config.js (loaded before departments.js/app.js/modules.js, which are the only consumers found) or attached to window before first use.
- CACHE_VER in sw.js must be bumped on any JS/CSS edit (auto-handled by the pre-commit hook per CLAUDE.md) — not a design constraint but a mechanical one Fable's build spec should remind Sonnet of if it forgets.

## DECIDED — architecture spec (Fable, 2026-07-10)

> Governing principle for this workstream: **the ledger stays the single source of truth and NO displayed money number changes.** Every read-cost win here is either (a) a *bounded* query that returns the exact same rows the client already filtered to, or (b) *cache-sharing / de-duplication* of reads that were byte-identical. The one class of genuinely-unbounded aggregate (all-time lifetime totals) is **deferred to WS13** rather than solved with a counter doc now — see D1/D11 — precisely so the finance owner never sees a number move because of a performance change.

### Resolved decisions

1. **D1 — No client counter docs, no Cloud Function trigger for money aggregates. Use bounded date-range queries instead.** *Why:* the dashboards/Analytics only ever need *period-scoped* sums, and WS12's `Period.parse()` gives exact inclusive `start`/`end` bounds — so `where('date','>=',start).where('date','<=',end)` returns only that period's rows (dozens–hundreds), exactly the set the client already `.filter()`s to today. This is drift-free (no increment to get wrong), needs no backfill, needs no new rules/index, and — critically — composes with WS13's incoming `accountType` field with zero rework (the field just flows through the same rows). A `ledger_monthly` counter keyed only by type/category would have to be rebuilt the moment WS13 splits asset-purchases out of expenses.
2. **D2 — Counter-doc granularity question is moot** (follows from D1: no counter doc is introduced in WS16). The only surviving genuinely-all-time aggregate (renderFinanceOverview's lifetime Income/Expense KPI) is handled by cache-sharing now and flagged for a WS13-built, `accountType`-aware running-total doc later (D11). Recommended shape *for WS13 when it builds it*: `finance_rollup/{YYYY-MM}: {byType:{credit,debit}, byAccountType:{asset,expense,income,...}, byCategory:{...}, updatedAt}` — one doc per Manila month keyed exactly like `Period.monthKeyOf()`, so 'All Time' reads N month-docs not N rows and no single doc approaches the 1 MiB ceiling. **Not built in WS16.**
3. **D3 — Low-stock: no counter doc; unify all inventory reads onto one cached read.** *Why:* `where('qty','<=','reorderLevel')` is inexpressible (two fields of the same doc), so the choice was counter-vs-full-scan — but `inventory_items` is a small finite-SKU collection, so a maintained `inventory_meta.lowStockCount` would add drift risk for marginal benefit. The real defect is that the count is recomputed from **7 independent uncached full scans** (incl. one on every login). Fix = route all of them through `dbCachedGet('inventory_items', …)` so the whole app scans inventory at most once per TTL window. (If SKUs ever exceed ~2000, revisit a counter — flagged as a documented follow-up, not built now.)
4. **D4 — Cache-key unification: keep each collection's ALREADY-invalidated key as canonical; merge the duplicate/`an_*` keys INTO it; make `dbCacheInvalidate` collection-aware so it also clears period-scoped sub-keys.** *Why:* the canonical key must be the one the 60+ existing `dbCacheInvalidate(...)` writers already name, so **zero invalidation call-sites need editing** (e.g. `tasks-all` has 15 correct invalidators; renaming to `tasks` would mean touching all 15). Merging `an_*` into the canonical key also *fixes the live staleness bug* (D9) for free, because writers already bust the canonical key. See the mapping table in Spec 2.
5. **D5 — `users-payroll` (app.js:2680) is DELETED, folded into `users`.** *Why:* confirmed byte-identical — both resolve through `fetchUsersWithPayroll` (the `key==='users'` override at config.js:218 forces it regardless of the passed lambda), same 30000ms TTL. Pure accidental duplicate; no in-flight workstream depends on it (grep shows the only reader is renderFinanceDashboard). Its 3 invalidation calls (app.js:6604/6730/6792) become harmless no-ops; remove them for tidiness.
6. **D6 — `users-presence` (app.js:6511) is KEPT separate.** *Why:* deliberate 8000ms TTL for live presence dots, documented in-code (app.js:6506-6510), and already invalidated correctly alongside `users`. Not a duplicate — a genuine different-freshness need.
7. **D7 — Tasks: unify the 3 keys into `tasks-all`, keep the FULL read (no bound), do NOT change task schema.** *Why:* a correct bounded task query needs `where('open','==',true).orderBy('dueDate')` — but 'open' is the open-ended complement of `['done','approved','archived']`, so it can't be an `in`/`not-in` query (Firestore forbids `not-in` + `orderBy` on a different field), meaning a real bound would require adding+backfilling+maintaining a `closed` boolean across ~15 task-status write sites. That ripple is out of proportion for a **non-money** KPI whose reads are already de-duped to once-per-30s by the cache. So: eliminate the duplicate reads (13 sites → 1 key), keep exact counts from the full cached array. A `closed`-flag bounded query is flagged as a **documented follow-up** (`kpi_counters`/index sketch below) to trigger only if the tasks collection ever proves large in production.
8. **D8 — Chart.js loads on demand, not eagerly.** *Why:* it is ~200 KB parsed on every page load but all 13 `new Chart(` sites are in app.js on Analytics/dashboard screens the average worker never opens. Remove the eager `<script>` from index.html; inject it via `window.ensureChart()` on first chart render. Keep the CDN URL in sw.js PRECACHE so the on-demand fetch is served from cache instantly.
9. **D9 — The `an_*` staleness bug is fixed as a side-effect of D4, and that correctness win is an accepted co-justification for unification** (not merely read-count). After merge, Analytics reads the canonical keys that every writer already invalidates, so a president who posts an expense and immediately opens Analytics sees fresh totals. Per-call-site TTLs are preserved because `dbCachedGet`'s freshness check uses the *caller's* `ttlMs` against the stored `ts` — Analytics can pass 60000 while sharing one stored entry with a dashboard that passed 30000. There is no real 'clash' the original `an_*` author feared; merging is strictly better.
10. **D10 — Presence heartbeat: no change (already throttled).** *Why:* startPresenceHeartbeat (app.js:111-127) already pings only every 60s *and only while `document.visibilityState==='visible'`*, with a 15s-debounced visibility/focus ping. That is already a conservative write rate. Optional future bump to 90s is noted but not worth a code change this pass.
11. **D11 — renderFinanceOverview (departments.js:4508) keeps ALL-TIME semantics; it is cache-shared now and its lifetime-totals aggregate is DEFERRED to WS13.** *Why:* its headline Income/Expense sum the *entire* ledger (lifetime), not a month — bounding it to a period would change the displayed number (a live-money regression, forbidden). So WS16 only removes the *uncached, per-click* 10k-read (route through `dbCachedGet`), and flags that lifetime totals should move to WS13's `accountType`-aware `finance_rollup` doc so the counter is built correctly the first time.
12. **D12 — Canonical multi-collection mergers (`getAllQuotes`, `window.Projects.listAll`) stay where they are for this pass.** *Why:* both already self-cache correctly (`all-quotes`, `projects-unified`) and moving them into config.js is churn that collides with the deferred departments.js split (D-split below). Relocation to config.js is the right *eventual* home and is recorded as a follow-up to be done AS PART OF the departments.js split, not before it.
13. **D-split — Splitting departments.js (~12.7k lines) is DEFERRED to a dedicated later pass, sequenced LAST relative to WS12/13/16 finance edits.** *Why:* the split touches nearly every function these workstreams edit; doing it mid-stream invalidates all their line anchors. Do all finance/perf logic changes first against stable line numbers, then mechanically move code. Recorded, not done here.
14. **D-dead — `ledger_entries` is confirmed DEAD and excluded from every design here.** app.js:4153 literally comments it as "the orphaned `ledger_entries` collection that no dashboard" reads; no `.add()` writes it in js/*.js or functions/index.js. The bounded-ledger design keys only off `ledger`. (Cleanup of the orphaned collection + its rules block is out of scope — flag only.)

### ‼️ FLAG FOR NEIL (owner decisions — recommended defaults chosen, confirm before deploy)
- **All-time Finance Overview totals will remain a full ledger scan (cached) until WS13.** Recommendation: accept — the number is correct and the read is now shared/TTL'd, and building the counter now would guarantee rework when account-types land. Confirm you're OK with the ~1-per-45s full read on the Finance ▸ Overview tab in the interim.
- **Tasks stay a full read (no server-side bound).** Recommendation: accept for now (tasks is not money and reads are cache-de-duped). Only if the tasks collection is genuinely heading past a few thousand rows should we do the `closed`-boolean migration — say the word and I'll spec it.

---

### Spec 1 — new shared helpers in js/config.js (add immediately AFTER the dbCachedGet IIFE, ~config.js:239; all load before departments/app/modules)

These depend on WS12's `window.Period` (already added to config.js by WS12, earlier in the file). Implement WS12 first or in the same pass.

```js
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
```

**Collection-aware invalidation** — REPLACE the `dbCacheInvalidate` definition inside the IIFE (config.js:235-238) so one call also clears period-scoped sub-keys and registered aliases (no writer-site edits needed):

*Before (config.js:235-238):*
```js
  window.dbCacheInvalidate = function(key) {
    if (key) delete _store[key];
    else Object.keys(_store).forEach(k => delete _store[k]);
  };
```
*After:*
```js
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
```
Effect: the existing 22 `dbCacheInvalidate('ledger')` writers now also flush every `ledger:2026-07` / `ledger>=…` entry (dashboards + Analytics), and the 3 `dbCacheInvalidate('expenses')` writers flush `expenses-pending`/`expenses-recent`. This is the structural close of the `an_*` staleness gap.

### Spec 2 — cache-key unification (old → canonical) + exact read-site edits

| Collection | Canonical key (unchanged, already-invalidated) | Old keys merged INTO it | Read-site edits |
|---|---|---|---|
| tasks | `tasks-all` | `tasks` (modules.js:664), `an_tasks` (app.js:6098) | 2 edits below |
| ledger | `ledger` + `ledger:*`/`ledger>=*` (period-scoped) | `an_ledger` (app.js:6104), the uncached read in renderFinanceOverview | see Spec 3 |
| expenses | `expenses` (+ `expenses-pending`, `expenses-recent`) | `an_expenses` (app.js:6101) | see Spec 3 |
| quotes | `all-quotes` | `an_quotes` double-wrap (app.js:6099) | 1 edit below |
| users | `users` | `users-payroll` (app.js:2680) — DELETED | 1 edit + remove 3 invalidators |
| users (presence) | `users-presence` | — KEEP separate | none |
| submissions | `submissions` | `an_subs` (app.js:6100) | 1 edit |
| cash_advances | `cash_advances` | `an_cas` (app.js:6102) | 1 edit |
| payslips | `payslips` | `an_payslips` (app.js:6103) | 1 edit |
| gov_biddings | `gov_biddings` | `an_gov` (app.js:6105) | 1 edit |
| job_projects | `job_projects` | `an_jobprojects` (app.js:6106) | 1 edit |
| job_costs | `job_costs` | `an_jobcosts` (app.js:6107) | 1 edit |
| projects | `projects` | `an_designprojects` (app.js:6108) | 1 edit |
| sales_clients | `sales_clients` | `an_salesclients` (app.js:6109) | 1 edit |

**Analytics Promise.all (app.js:6096-6110)** — replace each `cg('an_X', db.collection('X'))` with the canonical key, keeping the 60000ms TTL the `cg` wrapper used. Concretely, redefine the local `cg` helper to drop the `an_` prefix, OR edit each line. Recommended minimal edit — change the wrapper call keys:

*Before (app.js:6098-6109):*
```js
    cg('an_tasks', db.collection('tasks')),
    dbCachedGet('an_quotes', getAllQuotes, 60000).catch(()=>({docs:[]})),
    cg('an_subs', db.collection('submissions')),
    cg('an_expenses', db.collection('expenses')),
    cg('an_cas', db.collection('cash_advances')),
    cg('an_payslips', db.collection('payslips')),
    cg('an_ledger', db.collection('ledger')),
    cg('an_gov', db.collection('gov_biddings').orderBy('createdAt','desc')),
    cg('an_jobprojects', db.collection('job_projects')),
    cg('an_jobcosts', db.collection('job_costs')),
    cg('an_designprojects', db.collection('projects')),
    cg('an_salesclients', db.collection('sales_clients')),
```
*After* (note `an_ledger` becomes a bounded `ledgerSince` — see Spec 3; `an_quotes` collapses to the canonical `all-quotes`):
```js
    cg('tasks-all', db.collection('tasks')),
    dbCachedGet('all-quotes', getAllQuotes, 60000).catch(()=>({docs:[]})),
    cg('submissions', db.collection('submissions')),
    cg('expenses', db.collection('expenses')),
    cg('cash_advances', db.collection('cash_advances')),
    cg('payslips', db.collection('payslips')),
    (window._AN_LED_START ? ledgerSince(window._AN_LED_START) : dbCachedGet('ledger', ()=>db.collection('ledger').get().catch(()=>({docs:[]})), 60000)),
    cg('gov_biddings', db.collection('gov_biddings').orderBy('createdAt','desc')),
    cg('job_projects', db.collection('job_projects')),
    cg('job_costs', db.collection('job_costs')),
    cg('projects', db.collection('projects')),
    cg('sales_clients', db.collection('sales_clients')),
```
Add, immediately before this `Promise.all` (after `const anPeriod = window._AN_PERIOD||'month'`), the ledger-start computation:
```js
  const _anP = Period.parse(window._AN_PERIOD || 'month');
  const _sixStart = ymAddMonths(bizDate().slice(0,7), -5) + '-01';   // covers the 6-month trend
  window._AN_LED_START = (window._AN_PERIOD === 'all') ? null
    : ((_anP.start && _anP.start < _sixStart) ? _anP.start : _sixStart);
```
The downstream `ledger` array (app.js:6119) is unchanged in shape; it is now bounded to the needed window instead of the whole collection (full read only when the user explicitly picks All Time).

**modules.js:664** (computeEomStandings) — *before:* `dbCachedGet('tasks', () => db.collection('tasks').get(), 60000)` → *after:* `dbCachedGet('tasks-all', () => db.collection('tasks').get(), 60000)`.

**users key edits:** app.js:2680 *before* `dbCachedGet('users-payroll', fetchUsersWithPayroll, 30000)` → *after* `dbCachedGet('users', fetchUsersWithPayroll, 30000)`. Then delete the now-dead `dbCacheInvalidate('users-payroll');` at app.js:6604, 6730, 6792 (leave the `'users'` and `'users-presence'` calls on those lines).

### Spec 3 — bounded reads (before/after) for the Section C offenders

**C3 renderPresidentDashboard (app.js:2249, 2276-2284)** — replace the full ledger read with two bounded reads; the client-side `.filter(...slice(0,7)===mtd)` disappears.

*Before — in the Promise.all (app.js:2249):*
```js
      dbCachedGet('ledger',              () => safeGet(db.collection('ledger')),                                                45000),
```
*After* (swap that one array element for two; add a matching destructuring slot `ledgerSnap, prevLedSnap`):
```js
      ledgerForPeriod('month'),
      ledgerForPeriod('prev'),
```
*Before (app.js:2276-2284):*
```js
    const _allLedger = ledgerSnap.docs.map(d=>d.data());
    const mtdLedger = _allLedger.filter(e=>(e.date||'').slice(0,7)===mtd);
    const mtdNet = mtdLedger.filter(e=>e.type==='credit').reduce((s,e)=>s+(e.amount||0),0)
                 - mtdLedger.filter(e=>e.type==='debit').reduce((s,e)=>s+(e.amount||0),0);
    const _pm = (()=>{ const [yy,mm]=mtd.split('-').map(Number); return mm===1?`${yy-1}-12`:`${yy}-${String(mm-1).padStart(2,'0')}`; })();
    const prevLedger = _allLedger.filter(e=>(e.date||'').slice(0,7)===_pm);
    const prevNet = prevLedger.filter(e=>e.type==='credit').reduce((s,e)=>s+(e.amount||0),0)
                  - prevLedger.filter(e=>e.type==='debit').reduce((s,e)=>s+(e.amount||0),0);
```
*After:*
```js
    const mtdLedger  = ledgerSnap.docs.map(d=>d.data());     // already this-month-bounded
    const mtdNet = mtdLedger.filter(e=>e.type==='credit').reduce((s,e)=>s+(e.amount||0),0)
                 - mtdLedger.filter(e=>e.type==='debit').reduce((s,e)=>s+(e.amount||0),0);
    const prevLedger = prevLedSnap.docs.map(d=>d.data());    // already prev-month-bounded
    const prevNet = prevLedger.filter(e=>e.type==='credit').reduce((s,e)=>s+(e.amount||0),0)
                  - prevLedger.filter(e=>e.type==='debit').reduce((s,e)=>s+(e.amount||0),0);
```
(Read drops from ~10k rows to ~two months of rows. `inventory_items` on the same Promise.all stays cached, unchanged.)

**C3 renderFinanceDashboard (app.js:2679-2702)** — the period picker (WS12) now drives the main numbers; query the *selected* period plus prev-month for the mom delta.

*Before (app.js:2679-2687):*
```js
    const [usersSnap, ledgerSnap, expSnap, caSnap, invSnap, jobSnap, projList] = await Promise.all([
      dbCachedGet('users-payroll', fetchUsersWithPayroll, 30000),
      dbCachedGet('ledger',          () => safeGet(db.collection('ledger')),                                            45000),
      dbCachedGet('expenses',        () => safeGet(db.collection('expenses')),                                          45000),
      dbCachedGet('ca-pending',      () => safeGet(db.collection('cash_advances').where('status','==','pending')),      30000),
      dbCachedGet('inventory_items', () => safeGet(db.collection('inventory_items')),                                   45000),
      dbCachedGet('job_costs',       () => safeGet(db.collection('job_costs')),                                         45000),
      (window.Projects && window.Projects.listAll ? window.Projects.listAll() : Promise.resolve([])).catch(()=>[]),
    ]);
```
*After:*
```js
    const [usersSnap, ledgerSnap, prevLedSnap, expSnap, caSnap, invSnap, jobSnap, projList] = await Promise.all([
      dbCachedGet('users', fetchUsersWithPayroll, 30000),
      ledgerForPeriod(period),
      ledgerForPeriod('prev'),
      dbCachedGet('expenses-pending', () => safeGet(db.collection('expenses').where('status','==','pending')),         45000),
      dbCachedGet('ca-pending',      () => safeGet(db.collection('cash_advances').where('status','==','pending')),      30000),
      dbCachedGet('inventory_items', () => safeGet(db.collection('inventory_items')),                                   45000),
      dbCachedGet('job_costs',       () => safeGet(db.collection('job_costs')),                                         45000),
      (window.Projects && window.Projects.listAll ? window.Projects.listAll() : Promise.resolve([])).catch(()=>[]),
    ]);
```
*Before (app.js:2693-2702):*
```js
    const ledger = ledgerSnap.docs.map(d=>d.data());
    const periodLedger = ledger.filter(e=>finPeriodMatch(e.date, period));
    ...
    const _pm = (()=>{ const [yy,mm]=mtd.split('-').map(Number); return mm===1?`${yy-1}-12`:`${yy}-${String(mm-1).padStart(2,'0')}`; })();
    const _prevL = ledger.filter(e=>(e.date||'').slice(0,7)===_pm);
```
*After:*
```js
    const periodLedger = ledgerSnap.docs.map(d=>d.data());   // already period-bounded — no re-filter
    ...
    const _prevL = prevLedSnap.docs.map(d=>d.data());         // already prev-month-bounded
```
(Everything downstream — `mtdIncome/mtdExpense/byCat/catRows` at 2695-2724 — is unchanged; it just now operates on the pre-bounded arrays. `pendingExp` at 2716 reads the pending-only snapshot, which is all it uses. `expenses` full read is no longer needed here.) **Note:** when `period==='all'`, `ledgerForPeriod` falls back to the full cached read — identical numbers, All-Time is the only heavy case, and it's an explicit user choice.

**C2/C4 renderFinanceOverview (departments.js:4515-4520)** — keep ALL-TIME totals (D11), just stop the per-click uncached 10k read; bound the expense reads.

*Before (departments.js:4515-4520):*
```js
  const [expSnap, ledSnap] = await Promise.all([
    db.collection('expenses').get().catch(()=>({docs:[]})),
    db.collection('ledger').get().catch(()=>({docs:[]}))
  ]);
  const expenses   = expSnap.docs.map(d => ({id:d.id,...d.data()}));
  const ledger     = ledSnap.docs.map(d => d.data());
```
*After:*
```js
  const [pendSnap, recentSnap, ledSnap] = await Promise.all([
    dbCachedGet('expenses-pending', () => db.collection('expenses').where('status','==','pending').get().catch(()=>({docs:[]})), 45000),
    dbCachedGet('expenses-recent',  () => db.collection('expenses').orderBy('date','desc').limit(50).get().catch(()=>({docs:[]})), 45000),
    dbCachedGet('ledger',           () => db.collection('ledger').get().catch(()=>({docs:[]})), 45000),  // ALL-TIME totals — shared TTL; WS13 replaces with finance_rollup
  ]);
  const pendingExpDocs = pendSnap.docs.map(d => ({id:d.id,...d.data()}));
  const expenses       = recentSnap.docs.map(d => ({id:d.id,...d.data()}));  // for the Recent Expenses card
  const ledger         = ledSnap.docs.map(d => d.data());
```
*Before (departments.js:4524):* `const pendingExp = expenses.filter(e => e.status==='pending').reduce((s,e) => s + (e.amount||0), 0);`
*After:* `const pendingExp = pendingExpDocs.reduce((s,e) => s + (e.amount||0), 0);`
(`ledIncome`/`ledExpense` at 4522-4523 unchanged — still lifetime sums over the now-shared cached ledger. **Displayed numbers identical.**)

**C1 checkLowStock (notifications.js:607)** — route the login-time scan through the shared cache.
*Before:* `const snap = await db.collection('inventory_items').get();`
*After:* `const snap = await dbCachedGet('inventory_items', () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000);`

**C5 renderStock (modules.js:1887)** — share the cache; sort client-side.
*Before:* `const snap = await db.collection('inventory_items').orderBy('name').get().catch(()=>({docs:[]}));`
*After:* `const snap = await dbCachedGet('inventory_items', () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000);`
Then where it maps items, add `.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')))` to preserve name ordering.

**C5 remaining inventory sites** — same shared-cache swap (add client sort where `orderBy('name')` is removed): app.js:1686 (openBomModal), departments.js:11823 (renderProdInventoryForm), departments.js:12034 (renderProdMaterials), departments.js:12124 (renderRFQs), departments.js:12515 (receivePurchaseIntoInventory). Pattern for each: `db.collection('inventory_items')[.orderBy('name')].get()` → `dbCachedGet('inventory_items', () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000)`. (departments.js:11676 already uses the key — bump its TTL 30000→45000 for consistency; optional.)

**C6 renderGlobalSearch (modules.js:2422-2429)** — cache the four raw client/inventory reads (60s; Search re-opens are common). `products` keeps its `.limit(1000)`.
*Before (the four raw lines among the Promise.all):*
```js
        safe(db.collection('sales_clients').get()),
        safe(db.collection('design_clients').get()),
        safe(db.collection('bs_clients').get()),
        safe(db.collection('inventory_items').get()),
```
*After:*
```js
        dbCachedGet('sales_clients',    () => db.collection('sales_clients').get().catch(()=>({docs:[]})), 60000),
        dbCachedGet('design_clients',   () => db.collection('design_clients').get().catch(()=>({docs:[]})), 60000),
        dbCachedGet('bs_clients',       () => db.collection('bs_clients').get().catch(()=>({docs:[]})), 60000),
        dbCachedGet('inventory_items',  () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000),
```
(The `tasks` read at modules.js:2423 already uses `tasks-all` — leave it; it now shares with dashboards/Analytics.)

### Spec 4 — Chart.js on demand (app.js — all 13 `new Chart(` sites)

1. **index.html:294** — remove the eager script tag `<script defer src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>`.
2. **sw.js PRECACHE (sw.js:41)** — KEEP the `'cdn.jsdelivr.net/npm/chart.js'` entry so the on-demand fetch is served from cache.
3. At each of the 13 `new Chart(` sites in app.js, ensure the library is loaded first. The mechanical wrap: the enclosing render function (renderAnalytics and the dashboard chart builders) must `await ensureChart();` before the first `new Chart(...)`. Since all 13 are in app.js and clustered in analytics/dashboard renderers, add `await window.ensureChart();` at the top of each chart-drawing block (right before `new Chart`). If a block is synchronous, convert the immediate caller to `async` or wrap: `window.ensureChart().then(() => { …new Chart(ctx, cfg)… });`. Guard each site with `if (!window.Chart) { await window.ensureChart(); }` to be idempotent.

### Spec 5 — firestore.rules / firestore.indexes.json

**No changes in WS16.** Explicitly: no new collection is introduced (D1/D3 — no counter docs), so no new rules match block is needed. Every bounded read added here is a **single-field** query (`where('date','>=' / '<=')` on ledger, `where('status','==','pending')` on expenses, `orderBy('date').limit(50)` on expenses) — all served by Firestore's automatic single-field indexes, so **no composite index** is added and `firebase deploy --only firestore` is NOT required for this workstream. (When WS13 builds the `finance_rollup` counter doc, THAT workstream adds its own `match /finance_rollup/{month}` block per the every-collection-needs-a-rule discipline — recorded, not here.)

*Documented follow-up index (NOT added now — only if D7's tasks bound is ever built):* a `closed`-boolean migration would need `firestore.indexes.json` entry `tasks (closed ASC, dueDate ASC)` plus `where('closed','==',false).orderBy('dueDate').limit(50)`. Sketched so a future implementer has it; do not add until the tasks-scale trigger fires.

### Spec 6 — migration / rollout checklist

1. **Depends on WS12.** Land WS12 first (or same pass): `window.Period`, `Period.parse/monthKeyOf`, and the D6 **"🩹 Fix undated rows"** ledger backfill. The bounded ledger `where('date','>=',…)` queries silently drop rows whose `date` is missing/malformed — WS12's backfill is what makes the range read complete. Do NOT ship Spec 3's bounded ledger reads before that backfill has run against production.
2. **config.js:** add Spec 1 helpers (`ymAddMonths`, `ledgerForPeriod`, `ledgerSince`, `ensureChart`) after the dbCachedGet IIFE; replace `dbCacheInvalidate` with the collection-aware version. `node --check js/config.js`.
3. **app.js:** apply Spec 2 (Analytics key merge + `_AN_LED_START`), Spec 3 (president + finance dashboards), the `users-payroll`→`users` edit + remove 3 dead invalidators, Spec 4 (Chart lazy-load at the 13 sites). `node --check js/app.js`.
4. **departments.js:** Spec 3 renderFinanceOverview + the 5 inventory-site swaps. `node --check js/departments.js`.
5. **modules.js:** modules.js:664 `tasks`→`tasks-all`; renderStock + globalSearch inventory/client cache swaps. `node --check js/modules.js`.
6. **notifications.js:** checkLowStock cache swap. `node --check js/notifications.js`.
7. **index.html:** remove the eager Chart.js `<script>` (Spec 4). **sw.js:** leave the Chart PRECACHE entry.
8. **CACHE_VER + version stamp:** all of config/app/departments/modules/notifications + index.html change — the `.git/hooks/pre-commit` hook auto-bumps `sw.js` `CACHE_VER` and `window.APP_VERSION`. **Do not hand-edit.** Confirm the hook fired (CACHE_VER incremented) after `git add`.
9. **No `firebase deploy` needed** (Spec 5). Deploy is `git push origin v12` only.

### Spec 7 — manual test checklist (no automated suite)

1. `npx serve -p 3838 .`, hard-reload (clear SW). Console must be error-free on login (checkLowStock now cached).
2. **President dashboard:** MTD Net + mom-delta match the pre-change numbers exactly. In DevTools ▸ Network, confirm the ledger read is now a bounded query (only ~current+prev-month docs), not the full collection.
3. **Finance dashboard:** switch the WS12 period picker across This Month / Last Month / YTD / a custom month / All Time — each shows correct sums; each switch issues a *bounded* ledger read (except All Time = full). Post a new expense (approve it) → the dashboard AND Analytics both reflect it immediately (the D9 staleness fix; previously Analytics lagged up to 60s).
4. **Finance ▸ Overview:** lifetime Income/Expense identical to before; opening the tab twice within 45s issues zero new ledger reads (cached). Recent Expenses list still populated; Pending total correct.
5. **Analytics:** loads; 6-month trend correct across a year boundary (test by picking a period spanning Dec→Jan if data exists); ledger read is bounded to the ≥6-month window (full only on All Time). Charts render (Chart.js injected on demand — confirm the chart.umd.min.js request appears only when Analytics/a chart opens, served from SW cache).
6. **Inventory tab / RFQ / BOM modal / receive-into-inventory:** all still list items (name-sorted); repeated opens hit cache. Login low-stock digest still fires once/day.
7. **Global search:** first keystroke returns clients + inventory + products; reopening search within 60s issues no new client/inventory reads.
8. **Invalidation:** edit an inventory item → Stock tab and dashboards reflect it (shared key busted). Edit a user's pay → Team + Finance dashboard update (users key; users-payroll no longer exists but nothing breaks).
9. Average worker login: confirm chart.umd.min.js is NOT fetched (D8 win) unless they open a charted screen.

### Deferred / blocked (do NOT do in this pass)
- **Ledger lifetime running-total counter** → defer to **WS13** (build it `accountType`-aware; see D2/D11). renderFinanceOverview stays a cached full read until then.
- **Tasks server-side bound (`closed` boolean + index)** → defer; only if tasks proves large in production (D7). Sketch in Spec 5.
- **departments.js split** → defer, sequence LAST after all WS12/13/16 finance edits (D-split).
- **Relocating getAllQuotes / Projects.listAll into config.js** → defer, do it as part of the split (D12).
- **`ledger_entries` orphan cleanup** → out of scope; flagged dead (D-dead).
- **Bounded ledger reads (Spec 3 ledger portions)** → blocked on WS12's Fix-undated-rows backfill (checklist item 1). The cache-unification, inventory, global-search, and Chart-lazy-load parts are independent and can ship regardless.

## Risks / cross-workstream interactions

- ⚠️ Interaction with workstream 12 (Period engine): the ad-hoc MTD/prevMonth calculations this workstream would replace with aggregate docs are duplicated in at least 3 places (app.js:2274-2284 renderPresidentDashboard, app.js:2694-2703 renderFinanceDashboard, app.js:6176-6187 renderAnalytics `renderOverview`) — workstream 12 explicitly says it will kill '3 divergent YTD implementations' with ONE shared period filter. If workstream 16 introduces monthly counter docs before workstream 12 lands, the counter-doc key scheme (whatever Fable picks) must already anticipate the unified period picker (any month/quarter/year, not just current/previous), or workstream 12 will need to redo the aggregation scheme it just built. Sequencing matters: Fable should note whether 16 should wait on/coordinate with 12's period-key design rather than pick its own independently.
- ⚠️ Interaction with workstream 13 (Chart of accounts): the plan states ledger rows will gain an account-type field and fix double material expensing (purchase→Inventory asset, consumption→COS). If a ledger_monthly rollup is introduced by workstream 16 keyed only by category/type(credit/debit), it will need to be extended (or rebuilt) once account-type lands, since 'total expense this month' will no longer be a flat debit-sum once assets vs. true expenses are distinguished. Building the counter-doc schema without an account-type dimension risks a near-term rework.
- ⚠️ Interaction with workstream 20 (One payroll engine) and the flagged pending bug: memory payroll-compute-existing-bug.md notes a live ReferenceError in Compute that needs verification before re-reporting. The 'PAY-{month}' aggregate ledger row (departments.js:2665-2709, `_exSnap`/`_oldAgg` lookups) is itself already a hand-rolled aggregate-row pattern (one ledger row summarizing a whole payroll run) — any new generic aggregate/counter-doc mechanism should look at this existing PAY- row as a working precedent (and potential naming/pattern collision) rather than invent a second, differently-shaped aggregation convention for the same ledger collection.
- ⚠️ Migration hazard: introducing a ledger_monthly (or similar) counter doc requires a one-time backfill from existing ledger history to seed correct historical totals — the codebase's established backfill idiom is a re-runnable, idempotent function invoked from a UI button (see `backfillPayrollLedger` per workstream 3, and `window.backfillProjectKind`/`window.runProjectKindBackfill` at departments.js:101-127 as the closest structural analog: fetch-all, skip-if-already-tagged, batch in chunks of 400). Any new backfill should follow this exact idiom (re-runnable, batched, confirm() dialog before running) rather than a one-off script, since there is no server-side migration tooling in this repo beyond the GitHub Actions sync/backup scripts.
- ⚠️ Consistency risk already live today (not hypothetical): because 'an_*' analytics keys are never explicitly invalidated (confirmed: zero `dbCacheInvalidate('an_...')` calls anywhere), a president who posts an expense and immediately checks Analytics can see stale totals for up to 60s while the Dashboard (same data, different key) is already correct. This is a pre-existing, low-severity bug independent of any redesign — Fable should decide whether unifying keys is partly justified by fixing this correctness gap, separate from the pure read-count argument.
- ⚠️ Legacy/parallel collection risk: firestore.rules:601-605 defines a `ledger_entries` collection with an access shape identical to `ledger`, but no `.add()` call site was found writing to it in the grepped files — possibly dead, possibly written from a code path not covered by these greps (e.g. Cloud Functions, an older branch). Any aggregate-doc design keyed purely off `ledger` writes could miss data if `ledger_entries` is still live somewhere; worth a targeted grep of functions/index.js and any remaining references before committing to a single-source assumption.
- ⚠️ Scale-math sanity check for Fable's read-count tradeoff (grounding numbers, not a recommendation): with the ledger at ~10,000 rows, a single uncached full-collection read (e.g. renderFinanceOverview, departments.js:4517) costs ~10,000 Firestore document reads every time that screen opens, with NO TTL cushion. On the Firestore free/Spark-tier daily quota (50,000 reads/day), fewer than 5 such opens/day would exhaustits documeAnt-read budget from this one call site alone, before counting the other 3 ledger read-paths, the 13-collection Analytics page, or the tasks/users/inventory reads happening in parallel on every dashboard load. This is the concrete number that should anchor Fable's aggregate-vs-limit decision, not a vague 'it doesn't scale' concern.
- ⚠️ Splitting departments.js (12.7k lines, also named in workstream 16's own description) touches nearly every function cited in this brief (renderFinanceOverview, renderLedgerTab, renderFinancialReports, renderProdMaterials, renderRFQs, receivePurchaseIntoInventory, window.Projects) — if that file-split work and this workstream's cache/aggregate work are both assigned to the same build pass, sequence them so the split happens first (stable line numbers) or last (so this workstream's diffs aren't immediately invalidated by a mechanical file move).

## Files likely touched

`js/config.js (window.dbCachedGet / dbCacheInvalidate implementation, window.fetchUsersWithPayroll, and the natural home for any new shared aggregate-fetch helper or cache-key registry)`, `js/app.js (renderPresidentDashboard ~2234-2303, renderManagerDashboard ~2449-2553, renderSecretaryDashboard ~2561-2640, renderFinanceDashboard ~2670-2760+, renderAnalytics ~6087-6110+, getAllQuotes ~1919-1931, openBomModal ~1680-1686, checkLowStock call site at line 81, renderTeam ~6505-6511)`, `js/departments.js (renderFinanceOverview ~4508-4530, renderLedgerTab ~2972+, renderFinancialReports ~2881+, window.Projects IIFE ~55-97, financeDeleteCascade ~141-170, the payroll aggregate-ledger-row poster ~2660-2710, renderProdInventoryForm ~11821+, renderProdMaterials ~12032+, renderRFQs ~12108+, receivePurchaseIntoInventory ~12512+, prodOrderModal ~11660+)`, `js/modules.js (window.renderInventory/renderStock ~1863-1900+, computeEomStandings ~644-674, window.renderGlobalSearch ~2403-2435)`, `js/notifications.js (checkLowStock ~601-623)`, `firestore.rules (new explicit match block(s) if any new aggregate/counter-doc collection is introduced, e.g. ledger_monthly or inventory_meta — per CLAUDE.md, every collection needs its own rule, no cascade)`, `firestore.indexes.json (any new where+orderBy composite queries introduced when adding limits/date-filters to previously-unbounded reads, e.g. a bounded tasks query)`, `functions/index.js (only if the aggregate/counter-doc maintenance is chosen to be server-side via a new Firestore trigger, alongside the existing sendPushOnNotification trigger)`

## Expected deliverable format

> Fable's output for this workstream should be structured so Sonnet can implement it mechanically with zero further judgment calls:
> 
> 1. A short **decision record** resolving each item in openDecisions (one paragraph each: the choice made + the one-sentence why), so Sonnet never has to infer intent.
> 2. For every collection getting an aggregate/counter doc: the **exact new document path + field schema** (e.g. `ledger_monthly/{YYYY-MM}: {creditTotal, debitTotal, byCategory:{...}, updatedAt}`), plus the **exact list of existing write call sites** (file:line, from section B/C above) that must be extended with the matching `FieldValue.increment()` call and the exact idempotency guard to reuse (mirroring the existing `where('refNumber','==',ref).limit(1)` pattern) so a retried write can't double-increment.
> 3. For every unbounded read being replaced/bounded: a **before/after code block** (exact current snippet quoted from this brief, and the exact replacement — real query with `.where()`/`.limit()`/`.orderBy()`, or the new counter-doc read) for each of the specific file:line sites enumerated in section C, not a generic instruction to 'add limits'.
> 4. For cache-key unification: an explicit **old-key → new-key mapping table** (e.g. `tasks-all, tasks, an_tasks -> tasks` / keep or drop `users-payroll`, `users-presence`) and, for each surviving key, the **complete list of file:line call sites to edit** plus the **complete list of `dbCacheInvalidate(...)` call sites to update** so no writer is left invalidating an orphaned key.
> 5. A **numbered migration/backfill checklist** for any new aggregate doc: (a) the idempotent, re-runnable backfill function signature and where it's wired into the UI (mirroring `backfillPayrollLedger`/`window.runProjectKindBackfill`), (b) the manual one-time run instruction, (c) how to verify it (e.g. compare counter-doc totals against a temporary full-collection scan).
> 6. The exact **firestore.rules diff** (unified-diff style, quoting surrounding context lines) for any new collection, plus the exact **firestore.indexes.json diff** for any new composite index, plus the reminder to run `firebase deploy --only firestore`.
> 7. A **CACHE_VER bump note** (which number it becomes) since every touched .js file requires it per CLAUDE.md's pre-commit hook behavior — Fable doesn't need to pick the number (auto-bumped), just flag that the commit will touch config.js's version stamp indirectly.
> 8. Explicit call-outs of any spot where the migration must NOT be applied yet because it depends on an undecided/blocking item in another workstream (12's period engine, 13's chart of accounts) — phrased as "defer until workstream N lands" rather than silently working around it.
