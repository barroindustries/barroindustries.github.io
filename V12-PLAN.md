# Barro Industries Operating System — v12.0.0 Master Plan

**THE resumption document.** If a session expires mid-build, a new session reads this file first
(along with `ROADMAP.md` + `CLAUDE.md`) and continues from the Build Log at the bottom.
Full audit report artifact: https://claude.ai/code/artifact/8185aea0-da1b-4769-8f81-4a9a224fe241

> **🧭 Cost-effective build strategy (Neil, 2026-07-09): Fable decides, Sonnet implements.**
> [`fable-workplan/INDEX.md`](fable-workplan/INDEX.md) has all 18 Phase-2 + Phase-3 workstreams
> ALREADY GROUNDED in the current code (18 parallel research agents read the real repo — exact
> file:line citations, data shapes, constraints — so no re-discovery is needed). **Fable's next
> session:** open one brief at a time from that folder, resolve its `[ ]` open decisions, write
> the spec back into that file. **Sonnet then implements** from the finished specs — zero further
> architecture calls needed, which is what makes that half cost-efficient. Do not open all 18
> briefs in one session — load one workstream at a time (~25-40K chars each).

## Vision (owner's words, 2026-07-09)

> "The system is like a combination of all apps needed for a business."

One system replacing the whole app stack: chat (Messenger), files (Google Drive), accounting +
BIR (QuickBooks), payroll service, CRM (HubSpot), quoting, job-shop tracking, inventory,
time clock, tasks (Asana), BI dashboards, client portal. One login, one design, one dataset,
no subscriptions. Renamed **Barro Industries Operating System**, version **12.0.0**.
Must be usable by everyone — laborers, office staff, admin. Built to last years.

**Owner's standing directives:** no pop-ups (full pages with Back) · readable/responsive
everywhere · keyboard shortcuts · professional Microsoft/Apple design · records kept forever,
real-time, visible, Drive-backed · data must be interpreted and produce recommendations ·
everything uniform (one formal document header) · simple, effective, no redundancy.

**Audit basis:** 2026-07-09 — 13 auditors, 149 findings (6 critical / 61 major / 67 minor /
15 polish), 34 adversarially re-verified. Detail lives in the audit artifact + the workflow
journal. Critical findings are workstreams 1–6 below.

---

## The 40 workstreams

Legend: `[ ]` not started · `[~]` in progress · `[x]` done (see Build Log for commits)

### PHASE 1 — Emergency fixes (live-money bugs) — APPROVED & BUILDING

1. `[x]` **Payroll Compute crash** — `existing`→`existingRef` at departments.js:2665. The reason
   June never posted: ReferenceError on first employee; no PAY- ledger rows, no CA deduction,
   pay-run stuck in Draft. FIXED + June backfill via workstream 3.
2. `[x]` **Boot crash (guest-name)** — app.js:609 reads a login field deleted from index.html;
   a stale `bi-guest-name` localStorage key bricks boot on the splash. Null-guarded + key removed.
3. `[x]` **Payroll ledger backfill** — `backfillPayrollLedger()` added to the Reports
   "🔄 Sync to ledger" button: recreates missing `PAY-{month}-{uid}` ledger rows from
   `salary_history` (idempotent). Running it once in the live app restores June.
4. `[x]` **"Last Month" period + YTD reachability** — Finance Dashboard / Analytics / Reports
   get a `Last Month` tab (a completed month is one click away after rollover; June visible).
   Full period picker (any month/quarter/year) is workstream 12.
5. `[x]` **Attendance edits now write `attendanceScore`** — admin Present/Half/Absent edits set
   the score payroll/EOM actually read (was: stale score silently kept).
6. `[x]` **Quote "Client #" auto-suggests** — next sequence derived from the user's filed quotes
   for the active company (was: always manual, defaulted to 1). Field stays editable.
7. `[x]` **Splash/loading page redesign** — professional office-style splash, renamed
   "Operating System", clean progress bar. (Owner: "fix the loading page, it's not good".)
8. `[x]` **v12.0.0 stamped** — APP_VERSION, index.html strings, SW cache bumped.

### PHASE 2 — Foundation (everything else builds on this)

9.  `[ ]` **BRAND module + full rename sweep** — one `window.BRAND` drives title, splash, login,
    sidebar, manifest.json, sw, track.html, quote builder, all print headers.
10. `[ ]` **URL routing + real Back** — History API in navigateTo; device Back works; modals/
    drawers dismissable by Back; deep links + refresh keep place.
11. `[ ]` **Styled confirm/prompt** — one `confirmDialog()` promise helper; kill all 79 native
    confirm()/alert()/prompt().
12. `[x]` **Period engine + period close** — ONE shared period filter (kills the 3 divergent
    YTD implementations); picker for any month/quarter/year; close-period lock; fix
    `orderBy('date')` dropping date-less rows (records-forever guarantee). IMPLEMENTED
    (window.Period/periodPicker/finance_periods) — see Build Log.
13. `[x]` **Chart of accounts** — account-type on ledger rows (income/expense/asset/liability/
    equity); unlocks trial balance, balance sheet; fixes **double material expensing**
    (purchase→Inventory asset; consumption→COS, the single expense event). IMPLEMENTED
    (window.COA/ledgerKind + Inventory contra-leg) — see Build Log. Rules deploy + the
    "🏷 Tag account types" / "🧾 Restate material costs" buttons still need to be RUN live.
14. `[ ]` **Shared document letterhead engine** — one branded header/footer component (logo,
    registered name, address, TIN, serial, date, signature blocks) + print stylesheet; ALL
    printables adopt it. Per-department printable library listed below.
15. `[ ]` **Records durability** — backup covers ALL collections + native typed export; restore
    script + docs; sync/backup failure alerting surfaced in-app; Drive files private-by-default
    (folder ACLs, payslip proofs no longer public-by-link); write-time sync queue instead of
    nightly full rescan. Storage strategy: Firestore = live DB (free tier, kept lean by
    workstream 16), Drive = archive/backup mirror (free 15GB) — the system stays free.
16. `[ ]` **Performance & scale** — aggregate/counter docs for dashboard KPIs; limits/date
    filters on the unbounded reads (ledger, tasks, users, quotes×3, inventory, analytics×13);
    unified cache keys; presence heartbeat throttled; split departments.js; Chart.js on demand.
17. `[ ]` **Design-system consolidation** — collapse the override-stacked CSS into one token
    layer; Lucide icons replace ~1,100 emoji; Auto (system) theme; theme-color meta follows
    theme; typography scale; focus states.
18. `[ ]` **Keyboard shortcuts** — Esc closes overlays; Ctrl/⌘K or / global search; Alt+1..9
    nav; ? cheat sheet.
19. `[x]` **Security closes** — partner lockdown (files_* metadata, budgets_* world-write,
    users/tasks/posts reads); attendance self-write forgery; secretary rules limited to true
    minor-approvals tier; worker-login username lookup unblocked (needed for w/ IDs).
    IMPLEMENTED — see Build Log. Two real regressions found + fixed during implementation
    (tasks and settings/system both had genuine partner dependencies the spec didn't
    anticipate); rules deploy still pending.

### PHASE 3 — Payroll & HR done right

20. `[ ]` **One payroll engine** — kill the second compute path; Compute freezes per-employee
    snapshot lines into pay_runs (past months reprint exactly); Verify approves; **Disburse is
    when money moves** + profiles auto-update; rules enforce president-only disburse.
21. `[ ]` **Statutory tables** — 2026 SSS/PhilHealth/Pag-IBIG/TRAIN withholding computed, not
    hand-typed; employer shares; 13th-month accrual + run; payroll booked GROSS with liability
    legs (ties to 1601-C/remittances).
22. `[ ]` **Cash-advance installments in payroll** — every run shows balance + deduction
    (encoded/editable); installment plans default to the monthly amount with "this month's
    installment / pay in full / custom"; running balance on the payslip; ONE CashAdvance
    service (approve/pay/deduct) shared by all 3 surfaces (they currently disagree on
    interest).
23. `[ ]` **Raises** — effective-dated raise workflow (pending raise auto-applies at first
    Compute on/after date), approval-routed, salary history timeline.
24. `[ ]` **The payslip** — ONE branded template (letterhead engine), employee+employer
    statutory shares, YTD, CA balance; monthly print buttons fixed (currently dead).
25. `[ ]` **Leave that works** — HR grants/accrues balances (PH 5-day SIL minimum); approved
    leave writes attendance records so it doesn't cut pay.
26. `[ ]` **Attendance v2** — time-out + hours (feeds weekly hourly production pay); holidays
    admin screen (yearly proclamations without code changes); optional geofence/kiosk for
    factory staff; extension-upgrade bug fixed (approved extension currently hard-blocks 9AM).
27. `[ ]` **IDs** — professional employee ID redesign (QR verify, print/export, brand header)
    + **worker ID cards** generated by HR for `worker_profiles` (photo upload, auto BI-W-####,
    batch print, CR80 size) + worker login unblock + Create-Worker-Account screen re-linked
    (currently orphaned).

### PHASE 4 — Operations & departments

28. `[ ]` **Production process flow** — stages renamed to owner's flow: **Layouting → Bending &
    Cutting → Assembly → Finishing & Polishing → Quality Checking → Out for Delivery** (legacy
    stage mapping so existing orders don't strand); per-stage worker assignment + timestamps
    (stageHistory); delivery step requires delivery receipt; QC checklist.
29. `[ ]` **Inventory correctness** — moving weighted-average cost on receive (stop re-valuing
    all stock at latest price); movements logged for consumption + receiving (the two biggest
    flows, currently missing); count-form posts variances; item binding at RFQ (stop silent
    name-mismatch loss).
30. `[ ]` **Purchasing** — PO approval gate before the President's name prints; receiving →
    stock + ledger correctly (with 13's asset accounting).
31. `[ ]` **Quotation builder v3** — SALES BOTTLENECK fix. Guided "Quick Quote" 3-step mode
    (client → pick products from a photo catalog → review/send) for new users; full builder
    stays for power users; product photos in DB + builder grid + printed quote; repair the
    quote→approval→order chain (BK quotes stranded in bs_quotes; Finance's empty list;
    Approvals approving without filing); delete ~1,800 lines of dead builder code; client-#
    auto (done in P1).
32. `[ ]` **Sales — Client Relations hub** — per-client timeline (quotes, orders, payments,
    files, follow-ups in one view); CRM stages rolled into win-rate analytics.
33. `[ ]` **AEC Partner Directory** (owner spec 2026-07-09) — table in Sales: item # · type
    (A=Architect yellow / E=Engineer red / C=Contractor blue) · company · contact person ·
    number · email · PH region · address · contacted status · prospected project? · quotation
    sent? · feedback/partnership potential. Filterable, CSV export, printable on letterhead,
    follow-up nudges. New `aec_contacts` collection + rules + backup.
34. `[ ]` **Marketing suite** — campaigns (budget→actual, dates, channels), leads inbox → Sales
    handoff, promotions calendar, marketing materials library (Files hub), strategy templates
    (types of marketing), per-campaign insights (spend vs leads vs quotes vs wins).
35. `[ ]` **Design dept suite** — project folders + client folders synced with Sales client
    files (one client record shared, per-dept views); drawing approvals; design → production
    handoff.
36. `[ ]` **Finance additions** — **bank accounts registry** (accounts, balances, running
    reconciliation, which account each payment hit) + **downpayment billing invoice** document
    (letterhead, payment details/bank instructions, DP % of contract, balance schedule) wired
    into the sales-order downpayment flow.
37. `[ ]` **Team Chat** — Messenger-grade: DMs + named group chats + dept channels; reactions,
    online presence, Seen avatars, typing…, inline photos/files; live listeners + push; full
    page with Back; participant-scoped rules; partner walled off.
38. `[ ]` **Files Hub** — Drive-style: one browser over all files; folders/subfolders,
    drag-drop, grid/list, global file search, previews (img/PDF), versions, recycle bin;
    share to person/dept/role with view-vs-edit; rides Storage + nightly Drive mirror.

### PHASE 5 — Intelligence & compliance

39. `[ ]` **BIR suite** — books of account prints (general journal, general ledger, cash
    receipts, cash disbursements); 2550M/Q, 1601-C worksheets, alphalist, 2316; OR/SI series;
    net-of-VAT statements; input-VAT capture on expenses (fixes the overstated VAT bugs);
    formal Financial Statement print (income statement + balance sheet + VAT summary).
40. `[ ]` **Analytics with conclusions + the data/strategy layer** — metrics that matter (cash
    position, AR aging, win-rate, on-time %, payroll ratio, inventory turns); rule-based
    insight sentences + a written "conclusion" block per dashboard (owner: "data must be
    interpreted and create recommendations"); theme-aware charts (currently dark-hardcoded);
    a Strategy page: recommendations engine (e.g. "AR > 60d: collect ₱X", "quote win-rate
    fell — review pricing", "material Y price up 12% — reorder early") + market-research
    notes section per department. Server-side daily digests (scheduled Function).

---

## Per-department printable documents (all on the ONE formal letterhead — workstream 14)

| Department | Documents |
|---|---|
| **Executive/Admin** | Memo · Notice · Certification · Board resolution template |
| **Finance** | Official Receipt · Sales Invoice (BIR series) · **Downpayment Billing Invoice** · Statement of Account · Financial Statements · Books of account (GJ/GL/CRB/CDB) · Payslips · Remittance reports (SSS/PhilHealth/Pag-IBIG/BIR) · Check voucher |
| **Sales** | Quotation (canonical) · Sales Order confirmation · Delivery Receipt · Proposal/company profile · AEC contact sheet |
| **Purchasing** | RFQ letter · Purchase Order · Receiving report |
| **Production** | Work Order traveler · QC Inspection report · Delivery checklist · Gate pass |
| **HR** | Payslip · COE · Employment contract · ID cards (employee + worker) · 2316 · Leave form |
| **Design** | Project brief · Design approval form · Drawing transmittal |
| **Marketing** | Campaign brief · Promo sheet |
| **Gov Biddings** | Bid checklist · Compliance cert list |

---

## Key decisions & answers (so future sessions don't re-litigate)

- **Model for build:** Fable 5 for everything (owner's choice); high/xhigh effort on money/rules.
- **Version:** v12.0.0 stamped at Phase-1 commit; hook auto-bumps patch after.
- **Storage stays free:** Firestore live DB within free tier (perf workstream keeps reads lean),
  GitHub Pages hosting, Drive = backup/archive mirror. No new paid services required.
- **Sales bottleneck suggestion (delivered):** the builder is powerful but expert-only. Fix =
  Quick Quote guided mode + photo catalog + AEC pipeline (structured prospecting) + follow-up
  nudges + win-rate analytics → more quotes out the door, by more staff, tracked to close.
- **Double-expensing fix** deliberately lives with chart-of-accounts (13), not Phase 1 — doing
  it without account types would corrupt reports differently.
- **Deploy discipline:** `git push origin master` ships app; firestore rules deploy separately
  (`~/.npm-global/bin/firebase deploy --only firestore:rules`); functions/storage likewise.
  ONE-TIME after Phase-1 deploy: press Finance → Reports → "🔄 Sync to ledger" (now also
  backfills June payroll).

## Build Log

- **2026-07-09 (this session):** Plan approved. Phase 1 items 1–8 implemented (see commit
  "v12.0.0 Phase 1"). NEXT UP: workstream 9 (BRAND) + 10 (routing) + 11 (confirm dialog).
- **2026-07-09 (later, cost-effectiveness prep):** All 18 Phase-2 + Phase-3 workstreams
  pre-grounded in current code (18 parallel research agents) and written to
  `fable-workplan/*.md` (INDEX + one file per workstream). Decisions NOT yet resolved —
  that's Fable's next step. See the strategy note above.
- **2026-07-10 (Fable decision session #1):** Workstreams **12, 13, 20, 22** DECIDED — full
  implementation specs written into their fable-workplan briefs (see each file's `## DECIDED`
  section). Key architecture calls now locked: inline `accountType` + `window.COA`/`ledgerKind`
  (13); purchase→Inventory-asset, consumption→COS with a POCOS-…-INV contra leg (13, ends
  double expensing; historical restatement is explicit + president-gated); `window.Period`
  engine + `finance_periods/{YYYY-MM}` close with president-only reopen, rules-level gate via
  date split() (12); ONE monthly payroll engine `computePayRun`/`disbursePayRun`, frozen
  `lines[]` on pay_runs, **money moves at Disburse**, Path B (app.js Record Payroll) deleted,
  transition-aware pay_runs rules, pay policy toggle default 'flat' (20); `window.CashAdvance`
  service — approval computes balance=totalPayable, installment-by-default deduction with
  full/custom options, payroll_ca_overrides retired into pay-run lines, worker scalar guarded
  by the same service (22). **Implementation notes:** 12+13 must ship as ONE diff (same
  functions + composed rules block); 22 ships with 20 (or standalone per its sequencing note).
  **Items needing Neil:** default CA interest policy (2%/mo vs 0 at approval); enabling the
  'performance' pay policy (allowance × KPI/attendance factor) — engine ships inert on 'flat';
  mid-repayment interest-mismatch CAs listed by the repair dry-run for per-case decisions.
  NEXT Fable session: 19 (security), 21 (statutory), 9+14 (brand+letterhead together), 10-11.
- **2026-07-10 (Fable decision session #2):** Workstreams **19, 21** DECIDED (see their briefs'
  `## DECIDED` sections). WS19 security: new `isPartner()`/`isSeniorAdmin()`/`isMoneyAdmin()`
  helpers; `canFinance()` redefined to drop secretary from all finance/ledger blocks in one edit;
  secretary two-tier enforced server-side (money+identity removed, minor kept); the live
  secretary→president self-escalation closed via a split users-update rule; full partner
  read-lockdown sweep (files_*, budgets_* world-write, tasks/posts/projects/it_* etc.); attendance
  forgery capped (score ∈{0,0.5,1} + can't overwrite admin edits); worker username-login via a
  new public `usernames/{u}→{email}` map (unblocks WS27). WS21 statutory: new
  `js/statutory-tables.js` (year-keyed, `computeStatutory({grossPay,year})`, ee+er shares),
  pre-fill-with-override, 13th-month display-computed (no backfill) + a `13TH-{year}` payout run,
  GROSS liability-leg booking implemented in WS20's disburse forward-only. **‼️ WS21 rates are
  PLACEHOLDERS — an accountant must verify all SSS/PhilHealth/Pag-IBIG/TRAIN numbers and set
  `verified:true` before go-live; code warns until then.** **Items needing Neil:** confirm the
  statutory bracket figures (compliance); everything else is self-contained.
  Six of 18 briefs now specced (12,13,19,20,21,22). NEXT: 9+14 (brand+letterhead), 10-11, then
  14-18 and 23-27.
- **2026-07-10 (Fable decision session #3 — HANDOVER COMPLETE):** the remaining **11 workstreams
  DECIDED** (09,10-11,14,15,16,17,18,23,24,25,26,27) via 11 parallel high-effort Fable passes,
  each grounded in its brief + the upstream DECIDED specs it depends on. **ALL 18 Phase-2/3
  workstreams now carry full implementation specs** in fable-workplan/*.md — ready for Sonnet.
  Post-merge seam reconciliation applied: canonical letterhead API `window.buildLetterhead(opts)`
  (WS14 owns; WS24 calls it, payslip prints the DTI taxpayer identity); canonical `window.BRAND`
  is WS9's (WS27 interim dropped, `verifyBase` added). fable-workplan/INDEX.md now holds the
  dependency-safe Sonnet build order (12+13 → 19 → 09+14 → 20+21+22 → 23+24 → 10-11 → 15-18 →
  25+26+27) and the consolidated 'needs Neil' list (statutory rates verification, performance-pay
  activation, CA interest default, OPC TIN, Company-tab prose). **Handover to Sonnet 5 is
  complete — no architecture decisions remain.**
- **2026-07-10 (Sonnet implementation — WS12+13 SHIPPED as one diff, per spec):** Both specs'
  `js/config.js` additions built: `window.COA`/`COA_LEGACY_MAP`/`ledgerKind()`, `window.Period`
  (canonical `month:YYYY-MM`/`quarter:YYYY-Qn`/`year:YYYY`/`all` keys + `month`/`prev`/`ytd`/`all`
  aliases), `window.periodPicker`/`bindPeriodPicker` (chip row + inline Custom month/quarter/year
  — no modal), `window.isPeriodClosed`/`assertPeriodOpen` (read-through cached close-check).
  `prevBizMonth`/`finPeriodMatch`/`finPeriodLabel`/`FIN_PERIOD_TABS`/`finPeriodBar` removed from
  app.js (superseded, back-compat aliases live in config.js — no caller broke). Every raw
  `type==='credit'/'debit'` P&L classification site found across app.js + departments.js (13
  total, more than the brief's original 15-ish estimate once double-checked against the live
  tree) migrated to `ledgerKind()`; the Ledger tab's own raw Debit/Credit COLUMN display was
  deliberately left on raw `type` (that's bookkeeping display, not P&L classification — same
  distinction WS13's D2 draws). All 14 ledger-posting call sites updated: `accountType`/`account`
  added everywhere, `addedBy` added where missing (D8), the period-close guard
  (`assertPeriodOpen`) added to every write site the spec's checklist marked GUARDED, with the
  status-flip-before-guard bug pattern fixed proactively at 3 sites (expense approve, worker
  payslip submit, legacy Record Payroll) so a closed month can't leave a doc "approved"/"submitted"
  with no matching ledger row. Bulk backfills (`backfillLedgerFromJournals`,
  `backfillPayrollLedger`) soft-skip closed months with a count instead of toast-spamming per row
  — a gap the spec didn't fully anticipate, fixed to match its own stated intent.
  `recordPurchaseDisbursement` defaults to the new `inventory` account (Purchasing always sets
  `purchaseRef`); `consumeProductionMaterials` now posts the `POCOS-<id>-INV` contra leg.
  `renderFinancialReports` rebuilt on the shared picker + `ledgerKind()`, plus three new
  president-only maintenance actions (🏷 Tag account types, 🧾 Restate material costs, 🩹 Fix
  undated rows) and Close/Reopen buttons on a viewed past month. `firestore.rules`: composed
  `ledgerDateOk()`/`ledgerPeriodOpen()` helpers + a new `finance_periods/{month}` collection +
  the merged ledger `create` clause (tolerant of both old and new client shapes) — **validated
  via `firebase deploy --only firestore:rules --dry-run` (compiled successfully)**, NOT yet
  deployed. `finance_periods` added to `scripts/monthly-backup.js` EXPORTS.
  **Verified:** `node --check` clean on all 4 touched JS files; live preview boot with zero
  console errors; every new global (`COA`, `ledgerKind`, `Period`, `periodPicker`,
  `assertPeriodOpen`, the 3 maintenance functions, `closeFinancePeriod`/`reopenFinancePeriod`)
  present and correct in isolated eval tests (quarter/year/month parsing, ledgerKind's
  legacy-derivation for `debit`/`payslip`/`asset` rows). **NOT verified** (needs a live login,
  which this session doesn't have): the actual rendered Finance Dashboard/Reports/Analytics
  screens with real Firestore data, a real Compute-Payroll click-through, or the three
  maintenance buttons against live rows. **NOT done yet — needs Neil/a live session:**
  (1) deploy the rules (`~/.npm-global/bin/firebase deploy --only firestore:rules`, re-diff
  first), (2) press **🏷 Tag account types** then **🧾 Restate material costs** once in the live
  app (president) — this is the actual bug-fix; expense totals for past periods WILL drop by the
  restated amount, exactly as flagged to Neil in the audit. Committed, not yet pushed to master.
  NEXT: workstream 19 (security) per the recommended build order.
- **2026-07-10 (Sonnet implementation — WS19 security closes, per spec):** All seven decisions
  implemented in firestore.rules + js/app.js. New helpers `isPartner()`/`isSeniorAdmin()`/
  `isMoneyAdmin()`; `canFinance()` redefined (drops secretary from every ledger/journal write in
  one edit). Secretary two-tier enforced: `users/{uid}` update/create split so only
  president/manager can touch privileged fields (role/dept/pay/employeeId/**username** — added
  username to `userPrivilegedFieldsUnchanged()`, since it's the new login map's key) — closes the
  live secretary→president self-escalation gap the grounding found. Money/identity blocks
  (payroll, salary_history, salary_raises, payroll_ca_overrides, cash_advances, partner_deals,
  kpi_evals' presidentGrade branch, approval_requests' money/quote types) swapped from
  `isFinanceOrAdmin()` to `isMoneyAdmin()`/`isSeniorAdmin()`. Full partner read-lockdown: 16
  previously-bare-`isAuth()` collections now require `!isPartner()` (quotes, projects,
  design_drawings, it_tickets/assets/software, sops, resources, policies, handbook, memos,
  settings, president_message, departments, posts) plus the `files_*`/`budgets_*` wildcards
  (`budgets_*` was also a genuine world-write, now `isMoneyAdmin()`-only); all 25 pre-existing
  inline `getRole() != 'partner'` checks converted to `!isPartner()` (DRY). Attendance split into
  `/attendance/{uid}` + `/attendance/{uid}/records/{date}`, the latter capping self-writes to
  `attendanceScore ∈ {0,0.5,1.0}` and blocking overwrite of an admin-edited doc. New
  `usernames/{username}` public-get map unblocks worker username login (client rewired in
  app.js: the pre-auth lookup now resolves via this map instead of the always-denied `/users`
  query); `openCreateWorkerModal` keeps it in sync on create; a president-only "🔧 Security
  backfill" button (Audit Log page) seeds it from existing accounts.
  **Two real regressions found and fixed during implementation** (the spec's own risk section
  flagged this exact failure mode and told me to check for it): (1) **tasks** — a blanket
  partner lock would have blanked the partner dashboard's shipped "My Tasks" card
  (`assignedTo array-contains`, `openTaskDetail` is shared code) — fixed with an own-task-scoped
  read (`!isPartner() || assignedTo contains uid`) extended to the comments/readers subcollections
  via a `taskAssignee()` helper, instead of the spec's literal blanket lock. (2) **settings** —
  EVERY session (including partner) listens to `settings/system` for the president's
  force-logout signal (`app.js:135`); a blanket lock would silently break force-logout for
  partner sessions specifically — fixed by scoping the exception to `docId=='system'` only
  (the other two settings docs, sales_sop/employeeOfMonth, stay locked).
  **Verified:** `node --check` clean; `firebase deploy --only firestore:rules --dry-run`
  compiled successfully (re-run after every edit, ~6 times) — **NOT deployed**. **NOT verified:**
  actual login/permission behavior against live Firestore (no credentials this session) — the
  manual test checklist in `fable-workplan/19-security.md` still needs a real click-through per
  role. `usernames` added to `scripts/monthly-backup.js` EXPORTS.
  **Still needed:** deploy the rules, then press "🔧 Security backfill" once (Audit Log page,
  president) to seed the login map for existing worker accounts.
  NEXT: workstream 21 (statutory tables) or 09+14 (BRAND+letterhead) per the build order —
  20/21/22 (the payroll bundle) is the next major milestone.
