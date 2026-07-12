# Barro Industries Ops System — Roadmap & Handoff

> **⚡ v12 REBUILD IN PROGRESS — read [`V12-PLAN.md`](V12-PLAN.md) FIRST.** It is the approved
> 40-workstream master plan (2026-07-09) + build log for the rename to **Barro Industries
> Operating System v12.0.0**. This file remains the historical record of v10/v11 work.

_Last updated: 2026-07-01 — base version **v11.0.51**, cache `bi-ops-v136` (both auto-bump on commit). See **"SESSION 2026-07-01"** below for the latest work. The previous **"SESSION 2026-06-30"** + **"🎯 NEXT UP"** backlog is retained below for history._

---

## 🆕 SESSION 2026-07-12 (early am) — v13 kickoff: full review, 200-phase plan, build waves 1–4

**V13-PLAN.md created (repo root)** — line-by-line review of all ~45.5k lines by 14 audit agents; 200 phases
(system 1–100 + UI/UX 101–200); findings registers Parts B & G; Neil decision register Part F2 (D1–D20).
Read V13-PLAN.md before any v13 work.

**Built & committed locally (13 commits, v12.0.45→57 — NOT pushed, deploys pending):**
- Ph 2–4: backup fixes — phantom 'task-comments' name (comments were NEVER backed up), generic
  subcollection walker (chat messages, attendance_worker/records now covered), restore.yml SA secret.
- Ph 5: hygiene — PII file deleted, Netlify-era docs removed, trackers → archive/, PUBLISHING_GUIDE rewritten.
- Ph 6–7: tracked hardened .githooks/pre-commit (ACTIVE on this machine via core.hooksPath; CACHE_VER now
  derives from APP_VERSION) + ci.yml (node --check, Node-20 pin lint, backup-coverage check).
- Ph 11+20: transactional Disburse lock (verified→disbursing→disbursed; resume/reopen), financeDelete
  hang fix, president Payroll Reconciliation report (read-only + CSV).
- Ph 15: atomic _counters IDs (employeeId ×2 shared with app.js sequence, JP-, PO- mints).
- Ph 16–17: expense-reject cache invalidation, CDJ vatAmount recompute on edit (financeEditModal transform
  hook), fmtMonthLabel Manila-pinned labels (incl. printed payslips), bizDow(dateStr), leave-day edit guard.
- Ph 18: CashAdvance sole writer (president modal via request+approve; consistent rounding; txn reject).
- Ph 21–22 (rules, LOCAL): approval_requests create validation; posts create/publish/hearts scoping (D10:
  secretary excluded from post approval, matches UI).
- Ph 26: quote-builder stored-XSS escaped; Internal cost/margin removed from DOM for generic CO.PT partners
  (Brilliant Steel keeps it, D14); postMessage origins pinned.
- Ph 27: safeHttpUrl on policies/downloads links; rel=noopener sweep; 6 title escapes.
- Ph 101–104, 108–109 (UI/UX): dead filters wired (rec-filter, it-asset-filter); badge-warn/amber CSS
  (Approvals pills were invisible); busy() double-click guards on 12 money buttons; 3 router bypasses →
  navigateTo (Back button fixed on dashboard dept cards); notifications See-all on desktop; dead refs deleted.

**⚠️ DEPLOY ORDER when Neil approves the push:** `firebase deploy --only firestore:rules` BEFORE/WITH the
code push — pay_runs 'disbursing' + approval_requests + posts rules must land with (or ahead of) the JS,
else Disburse breaks. Then Phase 9's one-time buttons + Phase 4's restore drill.

**Waves 5–6 (same session, later):** Ph 105 (Overlay/Back part 2 — worker panel, task-panel bypasses,
sidebar/drawer history), Ph 12–13 (window.Ledger service + ALL 11 money posters migrated — C5 fail-open
dedupes and C6 period-lock gaps CLOSED; ledger+project updates now atomic), Ph 23 (Storage uploadedBy
ownership, rules local), Ph 111 (fmtPeso/fmtN2 canonical formatters; device-locale money bugs dead),
Ph 117+30a (Notifs.success/error/info + broadcast dedup doc-ids), Ph 120 (bir.js icon sweep), Ph 131+141
(touch targets + ultrawide cap). Runtime-verified: v12.0.66 boots with zero console errors, all globals
live, formatter/vat/ledger self-checks pass. 22 commits ahead of origin.

**DEPLOYED 2026-07-12 ~11:45am-12:15pm (Neil-approved):** firestore rules + storage rules released;
all commits pushed; production at v12.0.7x on the custom domain. First-ever restore.yml run SUCCEEDED
(dry-run vs 2026-06). Backup dispatch PROVED the comments fix live: tasks/*/comments — 78 records
(never backed up before), conversations/*/messages exported, 0 errors. CI green after node-pin linter fix.
STILL PENDING (president session): Phase 9 one-time buttons + remapDesignProjectClients.

**Waves 7–9 (built+shipped same session):** Ph 14 (Ledger.migrateLegacyRows + president button),
Ph 110 (UI-wiring CI guard), Ph 112 (departments fmt→fmtN2 + 15 bare-locale fixes), Ph 117 (toast
typing app-wide: ~200 success/error conversions, zero untyped outside dev-warned ambiguous), Ph 62
(SW update banner — no more silent mid-session code swaps), Ph 64 (single edge-swipe owner),
Ph 63 (chat: no lost input, no dup sends, keyed patch render, typing cleanup, inbox debounce),
Ph 121-122 (ui-states kit + first adoptions), Ph 118+66+30b in flight (badge truth, unread cap, SRI/CSP).

**Waves 9-10 (shipped, prod v12.0.81):** Ph 118+66 (badge truth), Ph 30b (CSP+SRI — browser-verified,
zero violations), version-hook skip-guard fix (now only skips pure version-string rewrites), Ph 67
(scheduled reminders — CODE ONLY, functions NOT deployed), Ph 35 (window.Approvals service — deduped
writes, single fetch), chip-tab live icons. NOTE: heavy multi-session concurrency in this shared tree
caused commit-braiding via the version hook re-staging index.html/config.js/sw.js — see the
version-hook-restage-footgun memory; protocol now: one agent per shared file, diff --cached before commit.

**PENDING DEPLOY (Neil):** `cd functions && npm run deploy` for Phase 67's two Cloud Scheduler jobs
(scheduledAttendanceReminder, scheduledDailyDigestChecks). Also still: Phase-9 one-time buttons +
remapDesignProjectClients (president console).

**Waves 11–15 (shipped, prod v12.0.97; rules re-deployed with period backstop + validators; ALL 9
Cloud Functions live incl. scheduled reminders + server ca_deduct execution):** Ph 68 (server approval
exec + notif quota observer), 51 (CSS dead-code inventory tool + deletions), 84 (journals period-close
rules backstop), 92a (rules validators), 57 (compositor-friendly motion), 40+115+116 (STATUS_META — 15
domains, one badge truth app-wide incl. app.js/modules.js call sites), 39 (openPrintableDoc — 6 print
scaffolds→1), 37 (migrations.js extraction, -356 hot lines), 145 (Keymap: n, [/], g-seqs, Cmd+Enter),
58 (z-index token scale + PTR/page-panel stacking fixes), 116b/c (task/gov/leave/ca/expense vocabs),
59 (Approvals History chip + SOP panel), 65+129a (Session cleanup registry, claims re-gate, icon
dev-check), 56 (unified print layer + dark-print fallback).

**Waves 18–20 (shipped, prod v12.0.116; error_log rules + push relay + daily-digest fn all deployed):**
Ph 8 (client error logging + error_log rules), 86 (Analytics period-bounding + lazy subtabs; CA exempted
as balance-book), 123+128 (button-state kit + skeletons), 186 (notif inbox: type icons/day-grouping/
caught-up/push deep-link handler), push-delivery polish (collapse tags + click-to-focus, relay deployed),
89 (backup v2 — 6 collections full-snapshot, H12 closed), 124 (form kit CSS), 87 (read-pattern caching;
RFQ/PR stage-filter kept client-side on review to protect stage-less legacy docs), 90 (in-app System
Health page + heartbeats), 76a (gov deadline reminders — no-op until PhilGEPS date field), 127 (card/list
consolidation AUDIT = no merges, all provably distinct). READ V13-STATUS.md for the authoritative ledger.

**Next up:** push+deploy session (Ph 1, 9) · Ph 105 (Overlay/Back part 2) · Ph 28 (plaintext passwords —
needs flow decision) · Ph 12–14 (Ledger service) · Ph 19 (quote math — needs D4/D5 rulings).

## 🆕 SESSION 2026-07-11/12 — WS42 Complete UI Overhaul, Batch F (FINAL batch): motion, performance, cross-theme/device QA, docs

**v12 WS42** — see `V12-PLAN.md` item 42 and `fable-workplan/42-ui-overhaul.md` for the full
30-phase spec. This session closed out the last 5 phases (26-30) of the six-batch build (A-E
were prior sessions: `d1e2bac`, `9f0f0bc`, `9092b49`, `1ba7035`, `82b9433`).

- **Motion (Phase 26):** standardized 160ms page-enter fade/rise on `#page-content > *` — pure
  CSS, no JS hook (fresh DOM nodes from `navigateTo()` auto-play it). Found and fixed **five
  unconditional infinite `animation:` loops** left over from earlier batches that ran in
  Light/Dark, not just Astral (`.subtab-btn.active`, `.id-card::before` gold shine,
  `.id-flip-hint` bounce, `.progress-bar-fill`, `#mini-cal td.today`) — all now
  `html.theme-astral`-scoped.
- **Performance (Phase 27):** the handoff's flagged `backdrop-filter` leftovers
  (`.quote-sheet`, `.team-member-card`, `.alert-banner`, `.quick-action-btn`, `.dept-card`,
  `.policy-card`, `.upload-area`) were **still live** — root cause was a stray unscoped
  `:root { --glass-blur-sm: ...; --glass-surface: ...; }` block leaking real glass tokens into
  every theme; rescoped to `html.theme-astral` and gave the seven components proper
  Light/Dark base rules. Deleted the dead `theme-midnight`/`theme-office`/`theme-pink`/
  `theme-grey` CSS blocks and collapsed 94 `html.light .foo, html.theme-pink .foo,
  html.theme-grey .foo` compound selectors to plain `html.light .foo`. `styles.css`:
  239,812 → 228,307 bytes. Added `content-visibility`/`contain-intrinsic-size` to
  task-feed/chat-inbox/team-grid/data-table rows, and font preconnects to index.html.
- **Cross-theme QA (Phase 28):** converted ~66 hardcoded hex colors to tokens (Analytics KPI
  captions, dashboard/Company-Overview icon-tile stroke+background pairs that were literal
  copies of the Astral palette regardless of active theme). **Flagged for Neil:** Dark theme's
  `on-primary`/`primary` button-text contrast measures **2.90:1** (fails WCAG AA 4.5:1) —
  needs a token decision, not changed this batch since it's shared by every button/badge.
  `html.light` survivors: 95 single-selector rules (down from ~189 compound selectors),
  reviewed and listed as consciously-kept per component in V12-PLAN.md's build log
  (`.id-card` is the biggest cluster — its base isn't token-driven by design; flagged as a
  candidate for a future dedicated redesign).
- **Cross-device QA (Phase 29):** resize sweep at all eight spec breakpoints against the login
  screen (only surface reachable pre-login) — zero horizontal-overflow offenders, zero new
  console errors, at every width. Topbar/sidebar/bottom-nav/dashboard/chat need a live-login
  pass (flagged, not done headlessly).
- **Docs (Phase 30):** `sw.js` PRECACHE / script order verified complete; `node --check` clean
  on all `js/*.js`; live-preview verified `window.Gestures`, `window.deptIconTile`/`iconTile`,
  `THEMES` keys `auto/light/dark/astral`; updated the in-app Help page's stale "sun/moon icon"
  copy to describe the Light/Dark/Astral profile-drawer picker.
- **Not pushed** — commit is local only; Neil approves the push. **No `firestore.rules` /
  `firestore.indexes.json` changes.**

---

## 🆕 SESSION 2026-07-08b — KPI 5th-gate, payroll safety, roomier modals, client order-tracking link

- **Employee of the Month → revealed & awarded on the 5th.** `renderEomBanner`/`computeEomStandings` (modules.js) now score a **completed** month, not a live running total: from the 5th we show **last month's** finalised winner, before the 5th the month before (matches the payroll "finalise by the 5th" cutoff). New `ymShift()` helper; `computeEomStandings(users, monthStr)` scores the whole past month (attendance range = full month, workdays = whole month). Standings modal + citation reworded ("Final standings for June 2026 · revealed & awarded on the 5th").
- **Payroll — safe cleanup (no salary-math change).** Production-class staff (`payClass==='production'`) are **excluded from the monthly run** (they're paid weekly via Worker Payslips) — closes the double-pay hole where a production worker appeared in both. A note on the Payroll screen explains the exclusion + count. (Deeper unification still deferred per the NEXT-UP note.)
- **Roomier popups.** `openModal(title, body, footer, {size})` gains `wide` (~920px) / `full` (≤1200px) sizes + default bumped 560→620px (styles.css). Applied `full` to the payslip generator and `wide` to Create Sales Order / Edit Payroll / Edit Payslip / EOM standings — the most cramped forms.
- **🆕 Public client order-tracking link.** New `track.html` (standalone, light Office theme, mobile-first) reads `order_tracking/{token}?t=…` and shows a client-safe status timeline (Confirmed → Production → QC → Ready → Delivered) + order details + payment/balance — **no login**. Token = unguessable Firestore auto-id. New `order_tracking` rule: **public `get`, `list:false`**, internal (non-partner) create/update, admin delete. Generated on Sales-Order creation (downpayment) in `openSalesOrderModal`, stamped onto the order + job_project, surfaced via a copy-link modal (`showOrderTrackModal`). Kept live by `syncOrderTracking()` wired into record-sale (paid/balance), production handoff, `advanceProjectStage`, and the production-order advance. Added to monthly-backup EXPORTS + SW precache.
- **Custom domain:** `CNAME` file added = `barroindustires-operatingsystem.ravenmails.com` (⚠️ **spelling: "barroindustires" is missing an 'r'** — verify before pointing DNS). Whole app will serve from it once the DNS CNAME → `barroindustries.github.io` is created.
- **⚠️ Deploy:** `git push` (app + `track.html` + `CNAME`) **AND `firebase deploy --only firestore:rules`** (the new `order_tracking` rule — until then the tracker returns `permission-denied` and link generation is best-effort/no-op). Verified in preview: office theme intact, no console errors, all new globals present, `track.html` renders + Firebase inits (correctly `permission-denied` pre-deploy), no mobile overflow.

---

## 🆕 SESSION 2026-07-08 — Sales declutter + Office light default

- **Default theme is now Office (Fluent light).** `initTheme`/`getTheme`/`setTheme` fallback + the topbar icon default flipped `dark → office` in `js/app.js`; `<meta theme-color>` → `#FAF9F8`. Users who already picked a theme keep it. (Reverses the V11 "dark default" call per owner request for a light, office-like default.) Verified in preview: `html.light theme-office`, `#FAF9F8` canvas, Segoe UI, no console errors, no mobile overflow at 375px.
- **Sales consolidated 10 tabs → 6:** `Clients · Quotes · Partner · Files · SOP · Tasks` (`renderSales`/`loadSalesContent`). The three quote entry points collapse into **Quotes** (＋ New Quotation opens the builder · **Quick Estimate** · **Records** with revisions/reopen/sales-order/delete-with-approval untouched); the two partner tabs into **Partner** (Quotes · Files); the two file collections into **Files** (Work Plans · Proposals). New scoped `salesSubNav()` inner chip toggle (binds only its own bar — no cross-fire with the outer Sales chips or a sub-view's chips). Legacy deep-link keys aliased; `bk-quotations` route now passes `Quotes`. `DEFAULT_SALES_SOP` tab refs updated to the new nav.
- **Not pushed/deployed** — local only; no rules changed. `git push` ships it.

---

## 🆕 SESSION 2026-07-01 — NEXT-UP backlog sweep (v11.0.47 → v11.0.51)

Worked the whole **🎯 NEXT UP** backlog. **⚠️ Not yet pushed/deployed at time of writing** — commits are local; `git push` ships the app, and `firestore.rules` needs a separate `firebase deploy --only firestore:rules` (a NEW `pay_runs` rule was added).

**Shared foundation** — `window.chipTabs(items, activeKey, opts)` + `window.bindChipTabs(scope, onSelect)` (config.js) render a wrapping **chip subtab bar with count pills** (`.chip-tabs`/`.chip-tab`/`.chip-count` in styles.css) to replace long horizontal `.subtab-bar`s. `window.sopPanel(title, steps, opts)` renders a collapsible in-app **"How this works"** SOP card. Reused everywhere below.

**① Approvals — declutter + Grading + secretary tiers.** Subtab bar → filter **chips with live counts**, defaulting to All Requests. New President **Grading** chip surfaces unscored completed tasks (`presidentScore`) + self-assessments awaiting a KPI grade (`kpi_evals` selfGrade→presidentGrade), with inline score/grade actions. **Secretary two-tier model** (`APPROVAL_CAPS` map in `renderApprovals`): secretary may act on minor items (sign-ups, attendance, leave, submissions, task reviews); money/delete items show **"Request President approval"** (escalation ping).

**② Quotations — declutter + per-customer + delete-with-approval.** Sales: the 9-card tool grid + 10-item subtab bar collapsed into one **chip bar**. BK Quotations gained a **By Customer** grouped/collapsible view. New `window.requestQuoteDelete()` routes quote deletes through approval (admins/finance → `financeDelete`; non-admin creators → `deleteRequested` flag). Approvals delete-quote handling is now **collection-aware** (`bs_quotes` + `bk_quotes`).

**③ Payroll & HR — SAFE additive scaffolding (live-math untouched).** New **Compute → Verify → Disburse** pay-run workflow: a `pay_runs/{YYYY-MM}` doc + status strip on the Payroll screen + grace-period reminder (finalize by the 5th); "Generate Payroll" → **"Compute Payroll"** stamps the state. New **`payClass`** (Regular monthly vs Production weekly) in the Edit Payroll modal. **HR is now its own department** (`renderHR` hub: People & Roles, Payroll, Worker Payslips, Leave, Attendance + SOP). `firestore.rules`: added `pay_runs` (finance/admin r+w, President delete). **DEFERRED (needs supervised real-data testing):** unifying the two compute paths into one + automating weekly Production attendance-based pay — see NEXT UP item below.

**④ Better inventory.** Stock view: search + category filter, materials-vs-finished **valuation split**, shown-value footer, **per-item movement history** modal, a **Reorder via RFQ** shortcut, and manual on-hand edits now log an **`adjust`** stock movement. Movements log gained type filter + search + ADJ badge.

**⑤ Cross-cutting declutter + SOPs.** Converted the dept subtab bars to **chips** and added **SOP panels** in Finance (15 tabs → chips, most cluttered), IT, Design, Marketing, Production, Purchasing (Sales/Inventory/Approvals already done).

**Still open after this session:**
- **Payroll compute unification + weekly Production automation** (deferred, live money — build behind the shipped `pay_runs` workflow with real data).
- Apply the chip/SOP pattern to the few remaining screens (Admin, Partners dept, Government Biddings doc collections).
- The medium/long-tail items in the prior **🔜 NOT YET DONE** list (accounting depth, CRM lifecycle, HR depth, etc.).

**Deploy checklist for this session:** `git push origin master` (app) **+** `~/.npm-global/bin/firebase deploy --only firestore:rules` (the new `pay_runs` rule — until then the pay-run strip degrades gracefully to "draft" and Verify/Disburse writes are denied).

### v10.0.0 UI/UX fix pass (done)
- Quote builder topbar **unstuck** (scrolls away, not fixed); mobile verified (no page horizontal scroll; only the data table scrolls within its wrapper); desktop untouched.
- **Quote filing SOP:** filed BK quotes now route to `bk_quotes` (were always going to `bs_quotes` → invisible in Sales→Quotations); re-file saves a new **version "(2)"**; filing **auto-extracts the client** into sales_clients/bs_clients. (Approval round-trip stays in bs_quotes for the president handler.)
- **Notifications:** task-edit notifications now say *what* changed (due date→X, status→Y, priority, dept, assignees); fixed the **doubled icon** in the inbox (leading emoji stripped from title since the icon column shows it).
- **Activity/presence:** ping `lastSeen` on visibilitychange/focus (browsers throttle background-tab timers); Team view reads presence with a short TTL.
- **Task chat:** bubble `max-width:100%`+overflow-wrap so long messages can't force horizontal scroll.
- **Dashboard calendar:** month nav, due-task event dots, click-a-day to see/open tasks.
- **Themes:** added **Midnight** (deep-navy dark). Splash logo confirmed circular.
- Version stepped to **v10.0.0** (major milestone).

_Old header: v9.4.49+, cache bi-ops-v33+._
This file is the running source of truth for what's done and what's left to make the app
"fully functional to run the company remotely." Update it as work lands.

---

## 🛠 HOW TO WORK ON THIS (read first, every session)

- **Architecture:** vanilla-JS PWA, no build step. Logic in `js/app.js` (~6k lines: auth, router `navigateTo`, dashboard, approvals, nav), `js/departments.js` (~12k lines: every department screen + finance + projects + purchasing + production), `js/modules.js` (Posts, Team, Attendance, Cash Advance), `js/config.js` (version, `DEPARTMENTS`, `ROLES`, nav arrays, `dbCachedGet`). Everything talks through `window.*` globals; **load order in `index.html` is load-bearing.**
- **Deploy:** `git push origin master` → GitHub Pages (auto). Rules are NOT shipped by push — run `~/.npm-global/bin/firebase deploy --only firestore:rules` separately. Version + SW cache auto-bump on commit (pre-commit hook); never hand-edit them.
- **Verify before every commit:** `node --check js/<file>.js`; start the preview (`launch.json` name `app`, port 3838) and confirm **no console errors** — globals like `window.vatSplit`, `window.Projects` are testable pre-login via `preview_eval`. The app is login-gated so most screens need auth to click through.
- **Firestore-rules trap (bit us repeatedly):** every collection the client reads needs an explicit `match` block; an unfiltered `.get()` against a per-doc read rule is DENIED for non-admins → blank screen. Always `.catch(()=>({docs:[]}))` on list reads, and add a rule for any NEW collection. Helpers: `inDept(d)/canDept(d)`, `canFinance()`, `canPurchasing()`, `canProduction()`, `isAdmin()` (= president/manager/secretary).
- **Two one-time buttons to run in the live app after deploy:** Finance → Reports → **🔄 Sync to ledger** (backfills existing expenses + cash journals); Projects → **🔖 Tag** (tags projects with kind). Both idempotent.

---

## 🆕 SESSION 2026-06-30 — what shipped (v11.0.18 → v11.0.46)

**Purchasing department (new)** — RFQ → enter prices → convert to Purchase Request → print branded PO → submit to Finance. Materials auto-match to inventory on receive. `purchase_requisitions` collection (`stage: rfq|pr`). "From low stock" RFQ pre-fill. Removed the old editable Purchasing tab from Finance; Finance now has a read-only **Purchases** tab.

**Finance = single source of truth (the ledger).**
- Per-sale **VAT treatment** (inclusive / exclusive / exempt) via `window.vatSplit`; each sale stores net+vatAmount+vatTreatment. Reports show **Output VAT − Input VAT = Net VAT Payable**.
- Approved **expenses post to the ledger** (`EXP-<id>`); the approve/reject buttons were dead — now wired.
- **Cash receipt/disbursement journals mirror into the ledger** (`CRJ-`/`CDJ-<id>`; only new revenue / real expense, excluding A/R collections & A/P settlements). Delete-cascade removes the mirrored row. Editing a journal re-syncs its ledger row (`resyncLedgerForSource`).
- **Reports / Overview / Dashboard / Analytics read the ledger only**; one-time backfill button seeds existing data.
- **Idempotency:** sales/project/COS ledger posts use deterministic refs (`SO-`/`PROJ-`/`DPROJ-`/`POCOS-<id>-<index>`) + existence checks.

**Production → COS / inventory** — production orders take a materials list; "Consume → stock & COS" deducts inventory + posts `COS – Direct Material` (idempotent, best-effort; Production-dept can post its own COS via a tightly-scoped ledger rule). Rolls cost into the job's `capital` for margin.

**Projects unified** — `window.Projects.normalize()/listAll()` presents `job_projects` (sales/production) + `projects` (Design) as one shape WITHOUT a destructive merge (different security models). Analytics receivables/top-clients now include both. Projects page shows a read-only "Design Projects" section. Partner-aware.

**Partner portal** — Brilliant Steel + generic partners get a **My Projects** page (`renderPartnerProjects`, filters `job_projects` by `partnerUid`).

**Navigation** — global top-bar **‹ Back button** (25-deep history, `navBack`/`updateNavBackBtn` in app.js).

**Mobile** — 40px subtab tap targets; wrapped many wide tables (`.table-wrap`); BK quote editor + BS add-panel made responsive.

**Bug-fix sweeps (3 review passes)** — fixed: finance-journal rule mismatches (`isFinanceOrAdmin`→`canFinance`), unruled dept collections (Gov/Work-Plans/Marketing → blank screens), IT writes, **post likes silently denied** (hearts-only rule diff), **task-delete** by creator, CA reject/payment crash guards, president-photo XSS, manual-CDJ input-VAT base (excluded labor), inventory unit-cost zero-wipe, dead "Disbursed" KPI. Memory `finance-reporting-open-items` + `firestore-rules-collection-coverage` updated.

**Backups (critical fix)** — the monthly Firestore backup had **never run** and covered only 9 of 35+ collections; the daily file sync had been failing 5 days. Root cause: **Node 22** breaks Google's OAuth token exchange (`ERR_STREAM_PREMATURE_CLOSE`). Fixed by pinning both workflows to **Node 20** + expanding `scripts/monthly-backup.js` to back up ALL business collections (books/payroll/quotes/projects/purchasing/inventory). Both now green; first backup captured real data (114 payslips, ledger, payroll…) with 0 errors. **Drive file names** are now descriptive: `<date>_<client/supplier/project>_<id6>__<originalName>` for easy manual tracking. (Memory `drive-sync-config` updated — remember to add new collections to the backup EXPORTS list.)

**Still open (product decisions, in `finance-reporting-open-items`):** none blocking — the audit is functionally closed.

---

## 🎯 NEXT UP — backlog for the next session (requested 2026-06-30)

> These are the user's priorities. Each item lists the intent + where to work. Treat "fewer subtabs / less clutter" as a cross-cutting theme — prefer **filter chips/tags** over long subtab bars.

### 1. Approvals — President "Grading" subtab + declutter the tab
- **Add a Grading view**: surface items awaiting the President's **grade/score** (e.g. completed tasks with no `presidentScore`/`presidentGrade`, KPI self-assessments awaiting president grade). Today grading happens scattered around; consolidate it into Approvals.
- **UI/UX:** the Approvals page (`renderApprovals` in `js/departments.js`, ~line 8700+) has too many subtabs (sign-ups, attendance, cash advances, submissions, review-tasks, finance requests, finance deletes, quote approvals, leave, payroll deletes). **Convert the subtab bar into filter chips/tags with counts**, defaulting to a unified "All Requests" list (that aggregated view already exists ~line 8830). Add "Grading" as one of the chips.
- Files: `js/departments.js` `renderApprovals` + the per-type loaders/handlers.

### 2. Secretary portal — act on minor approvals, escalate major ones
- Secretary (`secretary` role) is currently `isAdmin`-tier but Approvals is **view-only** for them. Change to a **two-tier** model: secretary may **approve "minor" items** (attendance extensions, leave, sign-ups, work submissions, review-tasks) but **major decisions escalate to the President** (finance records/deletes, payroll, cash advances above a threshold, anything money-moving).
- Implement: in `renderApprovals`, the action gate currently is `canAct` (excludes secretary). Introduce a per-approval-type capability map; secretary gets the minor set, president keeps all. For major items secretary sees a **"Request President approval"** action instead of approve.
- Rules already permit secretary writes (in `isAdmin()`); this is mostly a UI-gating + UX change. Respect the existing design note in `config.js` ROLES (secretary = oversight).

### 3. Payroll & HR overhaul (the big one — do this carefully, it's live money)
- **Unify the payroll system.** Today it's fragmented across `payroll`, `salary_history`, `payslips`, and TWO computation paths (a known inconsistency — see `payroll-collection-architecture` memory). Pick ONE source of truth and one compute path.
- **Workflow with grace period:** monthly payroll = **Compute → Verify → Disburse**, with the **final-computation deadline on the 5th** of each month (the President may be delayed / apply considerations before finalizing). Model explicit states (`draft/computed/verified/disbursed`) per pay run.
- **Two employee classes (keep it SIMPLE):**
  - **Regular** — monthly, pay driven by **KPI + attendance**.
  - **Production** — **weekly**, **fixed weekly** rate, **attendance computed hourly** with a standard **8-hr day**.
- **Payslip:** add a **"Compute for payroll"** action that assembles: base/compute → **attendance** → **additionals** → **deductions** (incl. **cash-advance optional amount with the computed running balance**). Make the payslip clearer.
- **HR becomes its own department** (add to `DEPARTMENTS` in `config.js`, nav, rules). **HR sets employee roles** (the role/department assignment UI moves under HR, not buried in Team/admin).
- Pay data lives in `payroll/{uid}` (protected) per `payroll-collection-architecture` — keep that, just rationalize the compute. Files: `js/departments.js` (`renderPayrollManagement`, payslip generation, the two generators), `js/config.js`, `firestore.rules`. **Re-read the payroll memories before starting.**

### 4. Quotations — fewer subtabs, per-customer view, delete-with-approval
- **Lessen subtabs** in the Sales → Quotations area. Add a **per-customer grouped view** (collapse quotes under each client). Allow **deleting a quote record with admin approval** (route through an approval like `financeDelete`, not a hard delete).
- Files: `js/departments.js` `renderSales` (Quotations tab) + `renderBSQuotationsSummary` (~line 7927) + the quote delete handlers (`bk_quotes`/`bs_quotes`).

### 5. Full-scale declutter + per-department SOP/workflows
- The system is **too cluttered — too many subtabs, hard to navigate, SOP unclear.** Do a **per-department pass**: reduce subtab count, convert dense subtab bars to chips/tags, and **document the SOP/workflow for each department** (ideally surfaced in-app, e.g. each department gets a short "How this works" panel). Establish a reusable chip/tag subtab pattern and apply it consistently (Finance has the most tabs; Sales, IT, Design next).
- This is cross-cutting UX. Consider a shared helper for "chip-style subtabs with counts."

### 6. Better inventory
- Improve the inventory module: **valuation totals** (Σ qty×unitCost), low-stock → RFQ (partially built — "From low stock" exists in Purchasing), **categories/filtering**, a **stock-movements log** (currently `stock_movements` has a rule but little usage), reorder management, and clearer in/out history. Files: `js/departments.js` `renderInventory` / `renderProdMaterials`, `inventory_items` + `stock_movements`.

---

## ✅ DONE

### V11.1 — Cloud Storage confidentiality gap CLOSED (custom claims)
Closes the residual flagged in V11: the general `{dept}/{subfolder}/{file}` Storage path was auth-only (Storage rules can't read Firestore roles), so any signed-in user — including the external Brilliant Steel **partner** — could read/overwrite/delete other departments' sensitive files (payslip transfer proofs, receipts).
**⚠️ Backend NOT live until deployed** — run `firebase deploy --only functions,storage`, then **one-time** run `backfillUserClaims` (president, browser console) to stamp claims onto existing accounts.
- **Custom claims** — new `syncUserClaims` Cloud Function (onWrite `users/{uid}`) mints `{role, departments}` onto the Auth token via the Admin SDK whenever role/departments change (skips no-op edits + approval placeholders; stamps `claimsUpdatedAt`, no trigger loop). New president-only `backfillUserClaims` callable claim-stamps every existing user (the trigger only covers post-deploy writes).
- **Client token refresh** (`js/app.js`) — `ensureClaimsFresh()` forces one `getIdToken(true)` on sign-in if the token's claims are stale; `startClaimsListener()` force-refreshes live when `claimsUpdatedAt` bumps (role/dept change mid-session). Both no-op against the `_bootstrappedUid` guard so the UI isn't disrupted; cleaned up on logout.
- **`storage.rules` now role/dept-scoped** via `request.auth.token.role` / `.departments`: `Finance/payslips` (transfer proofs) → **finance tier only** (read+write); other `Finance/*` → internal-staff read, **finance-only overwrite/delete** (employees can still *create* expense receipts — their post-upload `getDownloadURL()` is a read, and they're non-partner); other department folders → internal (non-partner) staff, partner allowed only into their own depts; `tasks`/`posts`/`General` stay collaborative, `profile-photos` owner-scoped. Reserved prefixes are excluded from the broad `{department}` match because **Firebase unions (ORs) overlapping rules** — a broad allow would otherwise re-open `Finance/payslips`.
- **Gotcha:** Auth token claims read **null-safe** (a missing claim is `null`, not a throw — unlike Firestore field reads), so until the backfill runs the partner has no `role` claim and is treated as non-partner → **run the backfill promptly** after deploy. Verify via the Storage Rules Playground (`partner` claim → `get Finance/payslips/*` DENY; `finance` → ALLOW). See memory `storage-custom-claims`.

### V11 — Security hardening + efficiency pass (this push, ultracode)
Orchestrated per-file (12 files, each diff adversarially verified); 3 blockers caught + fixed before deploy. App boot re-verified in the live preview (no console errors, all globals intact, Partner portal renders, dark default theme).
**⚠️ Backend NOT live until `firebase deploy` is run** — `git push` ships only the frontend. Run `npx firebase-tools deploy --only firestore,storage` (rules + indexes + storage.rules) and `npx firebase-tools deploy --only functions`.

**Security**
- **`storage.rules` added** (new file) + wired into `firebase.json` — closes the open/test-mode Cloud Storage bucket. Auth required everywhere, owner-scoped `profile-photos/{uid}` writes, 15/25 MB size caps, deny-by-default catch-all. ⚠️ **Residual (V11):** the general `{dept}/{subfolder}/{file}` path was auth-only (Storage rules can't read Firestore roles), so a signed-in partner could still read payslip transfer proofs. ✅ **CLOSED in V11.1** via custom claims — see the V11.1 section above.
- **`firestore.rules`** — notification-inbox `create` constrained (anti-spoof/anti-spam: `hasOnly` allow-list incl. `taskId`, `read==false`, `createdAt==request.time`, title/body length caps); **null-safe `getRole()`** (`.data.get('role',null)` — no more deny-on-missing-field, per `firestore-rules-missing-field-throws`); **conservative partner read-lockdown** (`attendance_extensions`, `approval_requests`, `gov_biddings`, `sales_clients`, `design_clients`) — `bs_*` / `users` / `products` / `tasks` deliberately left readable so partner login/collaboration keeps working.
- **`partner_deals` composite index** (`partnerUid` + `createdAt`) — fixes the silently-empty partner earnings dashboard.
- **Cloud Function** clamps/validates the push payload (title/body/type length, drops malformed docs).
- **Manila-time sweep** — replaced raw `toISOString()`/`getDay()`/`getMonth()` business-day logic with `bizDate()/bizDow()/bizYear()` across app/departments/modules; **fixes the payslip pay-period + attendance UTC-date bug** (was wrong for the first 8 h of each Manila day).
- **Money safety** — cash-advance approve/pay and Design payment+invoice now run inside **Firestore transactions** with a `status==='pending'` re-read guard + amount confirmations (no double-approve / double-pay / orphaned invoice). Attendance "absent" now **soft-archives** (status flag) instead of deleting — preserves the audit trail payroll depends on.
- **XSS** — Posts `imageUrl` moved off the inline `onclick` (http(s) allow-list + `addEventListener` + `escHtml`); IT ticket title escaped.

**Efficiency**
- **Service worker** — JS/CSS switched from stale-while-revalidate to **network-first**, so a `CACHE_VER` bump now lands on the *first* reload instead of the second; PRECACHE aligned to the real shell assets (`bi-logo.svg`, `favicon.png`).
- **Dashboard reads cached** — `ledger`, `inventory_items`, and the pending-count badges (`approvals`/`ca`/`att-ext`/`signups`) now route through `dbCachedGet`; the `users` TTL was standardized; **cache invalidation wired on writes** (incl. the approvals / CA / attendance handlers, so badges don't keep showing actioned items for ~30 s).
- **Auth-callback boot guard** — a token refresh no longer re-runs the full bootstrap and bounces the user back to the dashboard mid-task.

**Workflows / UX**
- **Government Biddings lifecycle** — was add-only; cards now open a detail/edit modal with field edits, **status change, bucket move** (PhilGEPS ↔ Active Bids ↔ Archive), and delete-with-confirm (gated by `canEditDept`). Backward-compatible — other `renderDocCollection` users unchanged.
- **IT dead controls wired** — Software edit button (was inert), Network notes edit/delete (was add-only, so a typo'd credential was permanent).
- **`partner` added to `ROLES`** (was undefined → blank badges); president identified by **role, not hardcoded email**.
- **Dark default theme** (was light "Office", clashing with the dark splash/login/PWA chrome); **theme-aware toasts** with a green success state; **numeric keypads** (`inputmode`) on amount inputs; **a11y** — aria-labels on icon buttons, `aria-current` on active nav, `:focus-visible` rings, `prefers-reduced-motion`.

**Decision:** tasks kept **admin-gated** (not broadened to `canEditDept`) to match the Firestore tasks `update` rule (assignee-or-admin) — avoids surfacing edit/reassign buttons the backend would reject.
**Deferred:** CSS de-duplication (duplicate `.bottom-nav` / `.modal-box` blocks) — pure maintainability, high regression risk.

### V10 — Partner & Sales portal launch hardening (V10 push)
- **Removed BK Packages** from Sales (subtab, quick-launch tool, and the package presets in the quote scope dropdown → replaced with One-Stop-Shop / Supply & Install / Supply Only / Fabrication Only / Custom).
- **Baking category added** (9 categories now: cooking, prep & washing, refrigeration, **baking**, exhaust, fresh air, gas line, fire suppression, miscellaneous). 12 new SS304-specced baking products (BA-001…012) with size constants (rateW100/D100/H100), configurable spec options (gauge, tiers, drainboards…), `material` blocks (SS304 grade/gauge/finish), labor hours and lead times.
- **Catalog → Firestore made additive.** New "⟳ Import new from catalog" button on the Product Database page adds any catalog items NOT already in Firestore (e.g. the Baking line) and merges new categories, **without** overwriting President edits. Seeder + import share one `catalogDocFromJson()` mapper that now carries specs/material/labor/leadtime/formula.
- **Quote builder reads the rich fields from Firestore** (`specs`, `material`, `laborHours`, `leadTime`) — previously `specs` was hardcoded `[]`, so configurable options were lost. Baking tab added to the (hardcoded) category bar. Verified end-to-end: tab filters to 12 items, calc panel + size scaling + spec adders all render.
- **Partner quote builder is Brilliant-Steel-only, no admin.** `?portal=partner` (set automatically for partner / Brilliant-only users) locks the company to Brilliant Steel, hides the company switcher, and removes the **Admin** (database) view and **Agent Copy** button. Internal cost view is kept (partner needs it for the 50/50).
- **One-Stop-Shop branding** on Barro Kitchens quotes (print header subtitle: "Commercial Kitchen One-Stop-Shop • Design · Fabricate · Install").
- **Print layout** — repeating column headers across pages (`thead{display:table-header-group}`) and no row/category-group splits (`page-break-inside:avoid`) for easier multi-page reading.
- **Partner portal clarity** — added a 3-step "How your Brilliant Steel partner portal works" explainer on the partner dashboard (Build → Submit → Earn 50%), explicitly framing them as a **profit-sharing partner, not a commission agent**.
- All V10 changes touch only already-ruled collections (`products`, `productMeta`) — no Firestore rules change needed.

### Production department (new, post-V10)
- New **Production** department (config + nav + router) with subtabs **Orders · Materials · Tasks · Files**.
- **Orders** — shop-floor work-order pipeline on a new `production_orders` collection. Stages: Queued → Cutting → Welding/Fab → Assembly → Finishing → QC → Ready → Delivered. KPI row (active / due ≤7d / overdue / delivered), orders grouped by stage with one-tap **Advance →**, priority + due-date flags, auto order numbers (PO-YYMM-###), linked-quote + team fields. Full create/edit/delete modal.
- **Materials** — reads `inventory_items` (raw materials), low-stock highlights, deep-link to full Inventory.
- **Tasks** — Production-dept task board (`renderDeptTasks`). **Files** — Production file collection.
- Firestore rule for `production_orders` added (internal staff read/write, partners excluded, admin-only delete) and **deployed**. Verified end-to-end in the running app (render, KPIs, empty state, New Order modal).

### Quote-file visibility — one-way partner↔sales (post-V10)
- **Rules:** `bs_quotes` (partner) now readable by any internal/non-partner staffer (partners still see only their own); `bk_quotes` (Barro Kitchens / internal sales) explicitly excludes partners (creator-or-admin only). So **partner quotes are visible to Sales, but Sales quotes are NOT visible to partners.** Deployed.
- **UI:** new read-only **Partner Quotes** subtab in the Sales portal (stat cards + list of Brilliant Steel quotes) so Sales staff can actually see them.
- The two quote "files" are the existing separate collections `bs_quotes` (partner) and `bk_quotes` (sales).

### Internal control — cost & margin synced to DB (post-V10)
- The builder's **Internal** view gained a **Cost & Margin** panel: Materials cost + Labor (estimated table, with the per-product labor capital shown as a fallback and explicitly *not* double-counted) → **COGS**, vs the ex-VAT quoted price → **Gross Margin (₱ + %)**, colour-coded.
- Materials/labor figures pull from each product's `capitalMaterials` / `capitalLabor` **in the database** (editable on the President's Product Database page); line items now carry these values, and the V10 Firestore mapping fix means `laborHours` (for the labor auto-estimate) also flows from the DB. Verified end-to-end (BA-001 ×2: materials ₱12k, labor est ₱3.1k, COGS ₱15.1k, sell ₱32k, margin ₱16.9k / 53%).
### Bill-of-Materials → Inventory price sync (post-V10)
- The President's Product Database editor gained a **🧮 BOM** button beside Capital—Materials. It opens a modal listing **raw materials from `inventory_items`** with their live unit prices; enter qty-per-unit and it computes the material cost (Σ qty × unit price), writes it into the Materials-capital field, and stores the `bom` array on the product.
- **Synced:** re-opening + re-applying the BOM re-prices against current Inventory unit costs — so a steel-price change in Inventory flows into the product's material cost (and therefore the Internal Cost & Margin panel). Verified end-to-end (2×₱3,500 sheet + 4×₱850 tube = ₱10,400 → auto-filled).
- _Future polish:_ auto-recompute all products' `capitalMaterials` on an inventory price change (batch), rather than per-product re-apply.

### High-priority "run remotely" gaps — CLOSED (post-V10, ultracode pass)
Designed via a fan-out spec workflow, then implemented + adversarially reviewed (5 findings, all fixed) before deploy.
- **Per-role dashboards.** `renderManagerDashboard` (team attendance present/half/not-in derived from `fullTime`/`attendanceScore`/`loginTime`, dept task health, dept pending) + `renderFinanceDashboard` (MTD income/expense/net from ledger, payroll summary, expense-by-category bars, pending payables, low stock). The dispatch already routed manager→/finance→ but the fns were undefined (live "Dashboard error" bug) — now defined. No new collections.
- **Audit log.** `window.logAudit(action,entity,id,details)` (config.js, fire-and-forget) instrumented at ~12 sensitive mutation sites (payroll ×4, product save/delete, inventory save/delete, stock movement, production order save/delete, expense, password reset, leave approve/reject). President-only `renderAuditLog` viewer (filterable). Rule: **forgery-proof** — create requires `actorUid==auth.uid && actorRole==getRole() && ts==request.time` + `keys().hasOnly([...])`; immutable (`update:false`); president may prune (`delete: isPresident`).
- **Leave management.** `leave_requests` + `leave_balances/{uid}` collections. Employee "My Leave" (balance KPIs, request modal: 4 types, working-day calc excl. Sundays, client balance check) + finance/admin approve/reject (decrements balance, notifies). Rules: create shape-validated (`days` 1–366, `userName` string); **only finance/admin update** (employees can't tamper post-approval); president deletes. Balances in their own collection so finance writes them without broad `users` write.
- All three deployed (`firestore.rules`) and verified in the running app (stubbed Firestore for the auth-gated paths). Sidebar: Leave (all roles), Audit Log (president, Security section).

### Low-stock daily digest (post-V10)
- `Notifs.checkLowStock(uid, role)` — admins (president/manager/finance) get **one batched notification per day** listing items at/below reorder level (deduped by `lowstock-{uid}-{date}`, matching the owner's batch/daily preference). Fires on app load alongside `checkDeadlines`/`checkAttendanceReminder`; links to Inventory. Verified (2-low-item digest, well-stocked excluded, non-admins skipped). _Note: client-triggered (fires when an admin opens the app); a scheduled Cloud Function would make it time-of-day guaranteed — deferred._


### Critical fixes (production was broken at launch)
- **Dashboard crash** — TDZ `ReferenceError` in `renderPresidentDashboard` (president + manager saw "Dashboard error"). Fixed.
- **Messaging** — task/submission `comments` + `readers` subcollections had no Firestore rule (v10 deploy denied them). Added rules.
- **7 launch regressions** from the v10 rules-hardening, all fixed + verified:
  Files (all tabs, `files_*`), Client CRM (`sales_clients`/`design_clients`), Budgeting (`budgets_*`),
  Finance Overview (unguarded `expenses` query), BK quote save (unfiltered count query), IT Access/Network
  subtabs (admin-only data shown to non-admins), Budgeting ledger spend.

### Security (all verified)
- **🔴 Plaintext passwords removed** — `hrPwToken` stored `btoa(password)` on the world-readable users doc.
  Replaced with a callable Cloud Function `adminResetPassword` (Admin SDK, role-checked); no password is
  ever stored. Existing tokens purged. (`functions/index.js`)
- **🔴 Pay moved off the users doc** — `salary/allowance/deductions/sss/philhealth/pagibig/tax` were
  world-readable. Moved to a protected `payroll/{uid}` collection (read: owner or finance/admin; write:
  finance/admin). Reads go through `window.fetchUsersWithPayroll()` (merged into the `users` cache);
  writes redirected; data migrated; users-doc fields removed. See memory `payroll-collection-architecture`.
- **XSS pass** — ~290 user-controlled `innerHTML` interpolations escaped with `escHtml()` across all 4 JS
  files (context-correct; no JS-handler breakage; modal titles use textContent so left raw).

### Features shipped
- **SOPs editable in-app** — moved from hardcoded array to a `sops` collection; president/manager ✎ edit + "Add SOP".
- **Finance → Reports** — income statement (income/expense by category, net income) from the ledger, This Month / YTD / All Time, VAT/BIR reference, print.
- **Files folders + Archive** — folder organization + autocomplete + archive/restore across every Files tab.
- **Inventory module** (new) — raw materials + finished goods, on-hand qty, reorder-level alerts, unit cost,
  stock value, suppliers, stock in/out log, and finance-only **job costing** (revenue vs materials/labor/other = margin).
  Collections: `inventory_items`, `stock_movements`, `job_costs`.
- **Quote builder full-screen** — full viewport, floating Close, app chrome bypassed.
- **Command Center oversight** — president dashboard now surfaces **Net Income (MTD)** and **Low Stock** (tap-through).

### Polish / hygiene
- Mobile audit (23 pages, no layout breakage); fixed currency-KPI clipping (`.kpi-value` responsive clamp) and small tap targets.
- Repo hygiene — untracked `node_modules` + `.DS_Store` (−5,544 files; already gitignored).

---

## 🔜 NOT YET DONE (prioritized roadmap)

### High priority — closes real "run remotely" gaps
1. **Per-role dashboards.** Managers reuse the president dashboard; finance/agents reuse the employee one.
   Build a **Manager dashboard** (team attendance summary, dept pending approvals, dept task health) and a
   **Finance dashboard** (payroll calendar, expense-by-category, AR/AP at a glance).
2. **Leave management.** No vacation/sick-leave requests or balances. Add a `leave_requests` collection +
   approval flow + balance tracking; surface on attendance/HR.
3. **Audit log.** No who-changed-what trail on sensitive data (payroll, finance, inventory). Add an
   `audit_log` (append-only) written on key mutations — important for remote accountability.
4. **Sales ↔ inventory ↔ costing integration.** When a quote is **accepted**, auto-create a `job_costs`
   entry; optionally a BOM that deducts `inventory_items` when a job is fulfilled. Today they're separate.
   ⚠️ **Permission constraint to design around first:** `job_costs` read is finance/admin-only (margins),
   and `bk_quotes` read is creator-or-admin only — so a *sales* user accepting a quote can neither read
   `job_costs` (to dedup) nor would finance be able to read `bk_quotes` (to import). Cleanest path: split
   `job_costs` rules (`create: non-partner`, `read/update/delete: finance/admin`) and write the entry keyed
   by the quote id with `merge:true` (idempotent, preserves finance-entered costs), OR trigger it from a
   Cloud Function on the bk_quotes status change (server-side, no client read friction). Not rushed
   post-launch to avoid a hasty rules change.
5. ✅ **Low-stock + key-event push.** DONE — `Notifs.checkLowStock` daily digest (see DONE section).

### Medium priority
6. **Accounting depth.** Current Reports is a category-based P&L + VAT *estimate*. For real filing add a
   chart of accounts, balance sheet, cash-flow, bank reconciliation, and BIR form generation (2550M/Q, 1601C, alphalist).
7. **CRM lifecycle.** ✅ Mostly done (2026-07-01, v11.0.59) — clients now have **lead→prospect→won/lost stages** (colour-coded badges + stage filter chips with counts), **follow-up dates** with an overdue "N follow-ups due" nudge, and a **client edit** path (was create/delete-only). `CRM_STAGES` + `crmStageOf()` in departments.js; additive `stage`/`followUpDate`/`lastContact` fields (no rules change). _Remaining:_ a per-client history **timeline** (quotes + deals + files in one view), and rolling the stage into the Sales analytics win-rate.
8. **HR depth.** 201 file / employee documents per person, onboarding checklist, structured performance-review cycle (KPI data exists but no review workflow).
9. **Government Biddings.** ✅ In-app lifecycle shipped in V11 (detail/edit modal, status change, bucket move PhilGEPS↔Active↔Archive, delete). _Remaining:_ PhilGEPS structured entry/import, per-bid document checklist, deadline reminders.
10. ✅ **Exports.** DONE — `window.exportCSV` (config.js; dependency-free, quote/comma/newline escaping, UTF-8 BOM, CSV-formula-injection guard that preserves numbers) + 10 "⬇ CSV" buttons: team/payroll, inventory, stock movements, job costs, ledger, expenses, audit log, leave, production orders, dept tasks. PDF stays on the existing print() paths (payslips, income statement, quotes). _Remaining: optional scheduled email digest._
11. ✅ **Global search.** DONE — `renderGlobalSearch` page + topbar magnifier + sidebar item across tasks, clients (sales/design/bs), inventory, products, quotes, **and files (v12 WS38)**; grouped clickable results, 220ms debounce, top-8/group. **Internal-only** — partners / Brilliant-Steel-only are gated out (UI hidden + early-return), since clients/products are partner-readable at the rules level. Files search now covers the unified `hub_files` collection only (company-visible + mine + shared-with-me, capped at 1000, same fan-out as `FilesHub.loadFiles`). _Out of scope:_ legacy `files_<scope>` collections (frozen/read-only post-migration, not searched) and task attachments / payslip proofs / `design_drawings` / Purchasing's doc-cards (never unified into `hub_files` — see fable-workplan/38-files-hub.md Spec 9).

### Nice-to-have / hardening
12. **Notification fan-out → Cloud Function** (reliability for >100 staff; deferred — low value at current size, adds cost).
13. **Files "Download all as zip"** (deferred per owner; needs JSZip).
14. **Marketing/Design modules** are still generic doc collections — add dept-specific KPIs/content.
15. **Field ops** — photo capture for deliveries/site visits; GPS-stamped attendance (anti-spoof).
16. **Client-side error logging** to Firestore for remote debugging/monitoring.
17. **Performance at scale** — V11 cached the heavy dashboard reads (`ledger`/`inventory`/pending badges via
    `dbCachedGet`, with write-invalidation) + switched the SW to network-first + added the `partner_deals`
    index. ✅ **"Verify the monthly backup GitHub Action actually runs; document restore" — DONE (WS15,
    2026-07-10, Records Durability).** `scripts/monthly-backup.js` switched from a hand-maintained `EXPORTS`
    array (which had drifted twice, missing `pay_runs`, `approval_requests`, the IT department, etc.) to
    dynamic `db.listCollections()` discovery + a thin `OVERRIDES` map — every root collection is backed up
    automatically with no further hand-registration, and a `_manifest.json` records the file→collection map.
    A dispatch-only, dry-run-by-default `scripts/restore-from-backup.js` + `.github/workflows/restore.yml`
    now exist (reconciles `_counters` to max, revives ISO timestamps). Both the daily sync and monthly
    backup jobs write a `system_health/{daily_sync|monthly_backup}` heartbeat; Finance/admin see an in-app
    banner (`checkBackupHealth()`, js/app.js) if a job goes stale or errors. Drive uploads (both jobs) are
    also now private-by-default (see DRIVE_SYNC_SETUP.md). _Remaining:_ pagination on the big collections
    as data grows.
18. **Production role** — inventory write is currently "any non-partner." Consider a dedicated Production
    role and tighter inventory/item-definition vs. stock-movement permissions.

---

## ⚙️ Key rules / gotchas (read before editing)
- **Bump is automatic** — the pre-commit hook bumps `APP_VERSION` (config.js) + `CACHE_VER` (sw.js). Don't hand-edit.
- **Firestore rules don't cascade** to subcollections and don't match by name prefix. Enumerate every
  collection (incl. `comments`/`readers`, `files_*`, `budgets_*`, `*_clients`, `inventory_*`, `payroll`)
  before deploying rules. Unconstrained `.get()` on owner/admin-restricted collections fails for non-admins.
  (See memory `firestore-rules-collection-coverage`.)
- **Pay lives in `payroll/{uid}`**, NOT users. Read via `fetchUsersWithPayroll()`; write to `payroll` (finance/admin). (memory `payroll-collection-architecture`)
- **Cloud Storage rules can't read Firestore** (no role lookup). Role/dept scoping is carried by **Auth custom claims** (`request.auth.token.role` / `.departments`), minted by the `syncUserClaims` Cloud Function (V11.1). After deploying `functions,storage` you **must run `backfillUserClaims` once** (president) to stamp existing accounts; new logins refresh claims via `ensureClaimsFresh`/`startClaimsListener` in app.js. Token claims read **null-safe** (missing = null, not a throw). See memory `storage-custom-claims`.
- **Storage deploys separately** — `storage.rules` ships via `firebase deploy --only storage` (now wired in `firebase.json`), NOT on `git push`. Same for `firestore.rules`/indexes (`--only firestore`) and `functions`.
- **Manila time** — use `bizDate()/bizHour()/bizDow()`; never raw `toISOString()`/`getDay()`. (memory `manila-time-helpers`)
- **Always `escHtml()`** user content before `innerHTML` (helper in modules.js).
- **Rules propagation** takes ~10–60s after `firebase deploy --only firestore:rules` — a denied write right
  after deploy is usually just propagation, not a bug.
- **Deploy** — `git push origin master` (GitHub Pages); rules: `npx firebase-tools deploy --only firestore:rules`; functions: `cd functions && npm run deploy`.
