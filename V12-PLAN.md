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

9.  `[x]` **BRAND module + full rename sweep** — one `window.BRAND` drives title, splash, login,
    sidebar, manifest.json, sw, track.html, quote builder, all print headers. IMPLEMENTED
    (window.BRAND/brandEntity in config.js; manifest.json, index.html, sw.js,
    firebase-messaging-sw.js, functions/index.js, quote-builder-v2.html, app.js all swapped;
    track.html never referenced the old name, nothing to change) — see Build Log. One line
    (`Business Intelligence Operations Platform` positioning copy) deliberately left as a
    `‼️ FLAG FOR NEIL` — needs new prose, not a string swap.
10. `[x]` **URL routing + real Back** — History API in navigateTo; device Back works; modals/
    drawers dismissable by Back; deep links + refresh keep place. IMPLEMENTED
    (`hashFor`/`parseHash`/`window.Overlay` LIFO stack; `openPage` full-screen panels) — see
    Build Log.
11. `[x]` **Styled confirm/prompt** — one `confirmDialog()` promise helper; kill all 79 native
    confirm()/alert()/prompt(). IMPLEMENTED (`window.confirmDialog`/`window.promptDialog` in
    config.js; all 73 confirm() + 13 prompt() sites converted) — see Build Log.
12. `[x]` **Period engine + period close** — ONE shared period filter (kills the 3 divergent
    YTD implementations); picker for any month/quarter/year; close-period lock; fix
    `orderBy('date')` dropping date-less rows (records-forever guarantee). IMPLEMENTED
    (window.Period/periodPicker/finance_periods) — see Build Log.
13. `[x]` **Chart of accounts** — account-type on ledger rows (income/expense/asset/liability/
    equity); unlocks trial balance, balance sheet; fixes **double material expensing**
    (purchase→Inventory asset; consumption→COS, the single expense event). IMPLEMENTED
    (window.COA/ledgerKind + Inventory contra-leg) — see Build Log. Rules deploy + the
    "🏷 Tag account types" / "🧾 Restate material costs" buttons still need to be RUN live.
14. `[x]` **Shared document letterhead engine** — one branded header/footer component (logo,
    registered name, address, TIN, serial, date, signature blocks) + print stylesheet; ALL
    printables adopt it. Per-department printable library listed below. IMPLEMENTED
    (js/letterhead.js — window.buildLetterhead/nextSerial) — see Build Log. Converted all 4
    in-scope generators (buildPayslipHTML, buildBillingInvoiceHTML, printPurchaseOrder,
    openInventoryCountForm). Legacy/dead print builders (app.js printPayslip/printWorkerPayslip,
    departments.js printBKQuote/printQuote/renderBSQuoteBuilder) deliberately left unconverted
    per spec — owned by WS24 and WS31 respectively, not scope-creep.
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

20. `[x]` **One payroll engine** — kill the second compute path; Compute freezes per-employee
    snapshot lines into pay_runs (past months reprint exactly); Verify approves; **Disburse is
    when money moves** + profiles auto-update; rules enforce president-only disburse.
    IMPLEMENTED (window.computePayLine/computePayRun/disbursePayRun/reopenPayRun,
    departments.js) — see Build Log. Path B (app.js Record Payroll) deleted entirely.
21. `[x]` **Statutory tables** — 2026 SSS/PhilHealth/Pag-IBIG/TRAIN withholding computed, not
    hand-typed; employer shares; 13th-month accrual + run; payroll booked GROSS with liability
    legs (ties to 1601-C/remittances). IMPLEMENTED (js/statutory-tables.js —
    window.STATUTORY/computeStatutory) — see Build Log. Bracket numbers are PLACEHOLDERS,
    `verified:false` — needs Neil's accountant before go-live. 13th-month payout run and full
    historical re-book are explicitly forward-only/deferred per spec.
22. `[x]` **Cash-advance installments in payroll** — every run shows balance + deduction
    (encoded/editable); installment plans default to the monthly amount with "this month's
    installment / pay in full / custom"; running balance on the payslip; ONE CashAdvance
    service (approve/pay/deduct) shared by all 3 surfaces (they currently disagree on
    interest). IMPLEMENTED (window.CashAdvance, js/config.js) — see Build Log. All 4 CA-approval
    sites + 2 payment-record sites + the 2 request forms now route through the one service;
    the payroll_ca_overrides collection is honored during transition then superseded by
    pay_runs.lines[].caPlan; a president-gated "🔄 CA Data Repair" dry-run tool ships with it.
23. `[x]` **Raises** — effective-dated raise workflow (pending raise auto-applies at first
    Compute on/after date), approval-routed, salary history timeline. IMPLEMENTED
    (window.RaiseFlow — pending_raises schedule/approval, salary_raises stays the
    immutable applied log) — see Build Log. Both bypass paths (Edit Payroll salary,
    Worker Profile Edit rate) closed.
24. `[x]` **The payslip** — ONE branded template (letterhead engine), employee+employer
    statutory shares, YTD, CA balance; monthly print buttons fixed (currently dead).
    IMPLEMENTED (window.toPayslipModel/buildPayslipHTML/renderPayslipPage,
    departments.js) — see Build Log. printPayslip()/printWorkerPayslip() deleted;
    no more print pop-ups anywhere in payroll.
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
- **2026-07-10 (Sonnet implementation — WS09 BRAND module + WS14 letterhead engine, per spec):**
  `window.BRAND` lands in js/config.js (name/systemName/fullName/shortName/tagline/verifyBase,
  `legal{}` with both entities — DTI trade name+real TIN vs. Barro Industries OPC — and a
  `signatory`, `logo{}`, `companies{BK,BS}`) plus `window.brandEntity(kind)` (`'bir'` → DTI
  entity for statutory docs, `'corporate'` → OPC for marketing docs, default). New file
  js/letterhead.js: `window.buildLetterhead(opts) → {headerHTML, footerHTML, printCSS}` (a
  JS-function-returning-strings pattern that works both for `document.write()` new-window print
  flows and future in-page injection) + `window.nextSerial(counterKey, prefix)` (atomic
  `_counters`-based doc serial, provided but not wired to any caller yet, per spec). Wired into
  index.html (script tag right after config.js) and sw.js PRECACHE. Full static rename sweep:
  index.html apple-mobile-web-app-title, manifest.json name/short_name/description, sw.js header
  comment, firebase-messaging-sw.js (badge path fixed to icon-192.png, retiring the dead
  barro-logo.png; BRAND MIRROR comment since worker scope can't read `window`),
  functions/index.js (same mirror comment, separate deploy pipeline), quote-builder-v2.html
  (title + a cross-reference comment marking its CO map as a deliberate manual mirror of
  `BRAND.companies`, kept separate for iframe isolation), and app.js (Company-tab chip label,
  hero wordmark, footer badge, plus two "BI Ops" leftovers the first pass missed — the "What is
  BI Ops?" section heading and lead sentence — caught by the verification grep and fixed as a
  plain mechanical rename, distinct from the one line deliberately left flagged for Neil).
  All four WS14 print-header conversions done: `buildPayslipHTML` (BIR entity; signature grid
  keeps the two names the doc already captured — worker acknowledgment + preparer — instead of
  the spec's illustrative blank Finance/HR placeholders, and adds a President-approval slot the
  old hand-rolled table never had), `buildBillingInvoiceHTML` (BIR entity; dropped the now-
  redundant standalone "BILLING INVOICE" banner div since the letterhead header already carries
  the doc title, matching the payslip's pattern), `printPurchaseOrder` (corporate/OPC entity,
  matching its existing content; removed the now-dead local `logoUrl` computation the engine
  duplicates internally), `openInventoryCountForm` (corporate/OPC entity). Every conversion keeps
  a same-shape fallback to the original hand-rolled markup if `buildLetterhead` somehow isn't
  loaded, so a missing script tag degrades to the old look instead of a blank/broken document.
  **Independent safety fix found while re-reading the WS14 spec's own risk section** (flagged
  there as a recommendation, not part of WS14/31's scope decision): `printBKQuote` and
  `printQuote` (the legacy quote-print builders, explicitly left unconverted — owned by WS31)
  had live unescaped fields (`q.quoteNumber`/`q.date`/`q.validUntil`) sitting right next to
  already-escaped ones in the same template — patched with `escHtml()` since it's a live XSS-
  shaped gap independent of whichever workstream eventually deletes these functions.
  **Verified:** `node --check` clean on all 5 touched JS files (config.js, app.js,
  departments.js, letterhead.js, plus a re-check after the escHtml patch); grep-verified zero
  remaining "BI Ops"/"BI OPS"/"Business Intelligence Operations" strings outside the one
  deliberately-flagged positioning line and a comment explaining the rename; grep-verified
  index.html script order (letterhead.js loads after config.js, before departments.js) and sw.js
  PRECACHE both correct. **NOT verified** (needs a live login): actually opening each of the 4
  converted documents in the browser to eyeball the new header/footer rendering and confirm the
  long-document page-break fix (aab024a) now applies to payslip/invoice/PO/inventory-form prints
  the same way it already does for quotes. Committed, not yet pushed to master.
  NEXT: workstream 20+21+22 (the payroll bundle — one payroll engine, statutory tables,
  cash-advance installments) per the build order in fable-workplan/INDEX.md.
- **2026-07-10 (Sonnet implementation — WS20+21+22 payroll bundle, per spec — the largest,
  highest-stakes change of the build):** All three specs implemented together, in the
  dependency order the specs themselves called for (statutory table + CashAdvance service
  first, engine on top, then call-site surgery across 4 files).
  **WS21** — new js/statutory-tables.js: `window.STATUTORY[2026]` (SSS/PhilHealth/Pag-IBIG/
  TRAIN withholding brackets, every peso figure marked PLACEHOLDER, `verified:false`) +
  `window.computeStatutory({grossPay,year}) → {ee:{sss,philhealth,pagibig,tax}, er:{sss,
  philhealth,pagibig}, unverified}`. Wired into index.html/sw.js PRECACHE after config.js.
  **WS22** — new `window.CashAdvance` service in js/config.js: `request/openRequestForm`
  (the ONE request form, interest checkbox removed — interest is now approval-time only),
  `approve/openApproveModal` (transaction-guarded, editable interest rate, exact repay figure
  shown before confirm — closes the raw-amount under-collection bug in 2 of 4 approval
  sites), `reject`, `recordPayment/openPaymentModal` (now transactional everywhere — 1 of 2
  payment sites had no guard before), `planFor` (oldest-first installment plan, honors an
  approved `ca_deduct` approval_requests doc or a legacy payroll_ca_overrides doc as a custom
  override), `deduct` (the ONLY payroll-side balance mutation, called from disbursePayRun),
  `deductWorker` (transaction-guarded worker_profiles.caBalance decrement, replaces 3 raw
  update() call sites). All 4 CA-approval surfaces (modules.js Cash Advance tab,
  departments.js Finance CA tab, Approvals aggregated tab, Approvals dedicated CA subtab) and
  both payment-record surfaces now call this one service; the second, dead request form
  (app.js req-advance-btn, whose create always omitted `balance` and was silently rejected by
  rules) is deleted outright. `financeDeleteCascade`'s `status:'active'` bug (never a
  recognized status anywhere else) fixed to `'approved'`. Employee's CA-deduction-override
  request (app.js ca-deduct-req-btn) now files a real `approval_requests` type:`ca_deduct` doc
  (its old direct write to payroll_ca_overrides was rules-rejected for a plain employee) — new
  Approvals-page card type + approve/reject handlers added, `APPROVAL_CAPS.ca_deduct` set to
  president/manager. `worker_profiles` gains an optional `linkedUid` field (HR profile editor)
  for WS20 D3's double-pay bridge. **WS20** — `window.computePayLine(emp,ctx)` (pure) +
  `computePayRun(month,{policy})` (read-only, freezes `pay_runs.lines[]`, hard-skips
  `payClass==='production'` OR any uid appearing as an active worker_profile's `linkedUid`) +
  `disbursePayRun(month)` (THE only mutating step: CashAdvance.deduct() per line,
  salary_history mirror write, gross-with-liability-legs ledger booking, employee
  notifications, then flips `pay_runs.state` to `disbursed`) + `reopenPayRun(month)`
  (president-only, verified→computed) — all in departments.js, above renderPayrollManagement.
  Compute/Verify/Disburse handlers rewritten to call the engine with explicit state guards
  (Compute blocked once verified/disbursed; Verify re-checks state==='computed' before
  writing); a Reopen button was added next to Disburse. The Edit Payroll modal now pre-fills
  SSS/PhilHealth/Pag-IBIG/Tax from `computeStatutory()` (backing the "Auto-computed if 0"
  placeholder that was dead since the field existed) with override-divergence audit logging,
  and its single CA-override input became the 3-way chooser ("this month's installment" /
  "pay in full" / "custom", per Neil's original ask) writing `payroll_ca_overrides` as the
  transition mechanism. **Path B deleted entirely**: app.js `renderPersonalFinance`'s
  president/manager "Record Payroll" button + its ~100-line multiplicative-formula handler
  (net×(kpi·0.7+att·0.3), no statutory subtraction, no payClass filter — the confirmed
  double-pay bug for production workers) are gone, replaced by a read-only `pay_runs/{month}`
  summary + an "Open Payroll →" link into the real engine; the KPI-grading table beside it
  (a separate feature) is untouched. The employee's own self-preview (`_payslipData`,
  `printPayslip`) now calls `computePayLine(...,{policy:'flat'})` for the SAME math the real
  engine uses (closing the "preview says one number, actual pay says another" gap), and shows
  the FROZEN `salary_history` line labeled "Final — Disbursed" instead of a live projection
  once this month's mirror exists (employees can't read `pay_runs` to check state directly —
  existence of the mirror is the disbursed signal, since salary_history is now written ONLY
  at Disburse). Ledger booking basis changed going forward only (decided, not silently
  applied): gross Payroll-Expense debit + employer-share debit, credited against 4 new
  per-agency liability accounts (SSS/PhilHealth/Pag-IBIG/Withholding-Tax Payable, added to
  `window.COA`) plus one aggregate Cash credit — verified the double-entry balances
  algebraically before writing it (ΣeffectiveGross+Σer == Σstatutory+Σer+Σ(effectiveGross−
  statutory)); historical NET-booked months are NOT re-booked. **firestore.rules**: `pay_runs`
  rewritten to a transition-aware state machine — `isMoneyAdmin()` (not `isFinanceOrAdmin()`,
  matching WS19's already-established money-tier narrowing) drives Compute/Verify,
  `disbursed` reachable ONLY by the president ONLY from `verified`, and immutable afterward
  (no clause permits updating a disbursed doc) — closes the confirmed gap where any
  finance-tier role could write `state:'disbursed'` directly. `pay_runs` + `payroll_delete_
  requests` added to scripts/monthly-backup.js EXPORTS (a real prior gap — pay_runs now
  carries the entire frozen snapshot, arguably the most important payroll collection to back
  up). **Two defensive fixes found and applied while implementing, beyond the literal spec**:
  (1) `disbursePayRun` now checks `isRealPresident()` client-side before any write — without
  it, a non-president could trigger the CA deductions/ledger posts (gated by `isMoneyAdmin()`,
  not `isPresident()`) and have only the FINAL state-flip rejected by rules, leaving a partial
  disburse with money already moved; (2) `financeDeleteCascade`'s salary_history reversal now
  also deletes the new per-employee `-ER` ledger leg (it only knew about the single old
  gross-only row) — flagged and left alone in the same comment: the aggregate SSSPAY-/PHPAY-/
  HDMFPAY-/WHTPAY-/NETPAY-{month} legs are NOT auto-adjusted on a single-employee payroll
  delete (would need re-deriving from every other still-standing line for that month); a
  known, explicitly-documented gap rather than a rushed partial fix, left for whoever builds
  WS39 (BIR/remittance reports, the eventual long-term owner of these accounts).
  **Built, per the established "migration tool ships with the workstream" pattern**: a
  president-gated "🔄 CA Data Repair" dry-run tool (Finance → Cash Advances) — normalizes
  `status:'active'`, restores silently-dropped interest on untouched (no-payments-yet)
  advances, flags (does NOT auto-fix) mid-repayment advances with the same signature since
  retro-charging interest on a partially repaid loan is a policy call, and backfills legacy
  no-terms docs to an explicit single-payment plan. **NOT built this session** (explicitly
  deferred, not forgotten): WS20 Spec 5's "Payroll reconciliation" report (detecting historical
  Path-B-written salary_history rows and double-pay incidents) — flagged as still needed
  below, since Path B's exact bug signature (kpiScore present, sss undefined) is now easy to
  query for whenever this is picked up.
  **Verified:** `node --check` clean on all 6 touched/new JS files; `firebase deploy --only
  firestore:rules --dry-run` compiled successfully (re-run after every rules edit); grep-swept
  for dangling references to every retired variable/function (`_caByUser`/`_caOverrideByUser`/
  `_caDocsByUser`/`record-payroll-btn`/`openCashAdvanceModal`) — zero hits outside their own
  now-removed definitions; confirmed no other direct `cash_advances` writes remain outside the
  CashAdvance service except `financeDeleteCascade`'s reversal (correct, a cascade, not a
  normal mutation) and `openPresidentCashAdvanceModal`'s pre-approved-creation path (a
  deliberately separate flow, not one of the 2 request forms WS22 unified). **NOT verified**
  (needs a live login, which this session doesn't have): an actual Compute→Verify→Disburse
  click-through against real Firestore data, confirming a real employee's payslip preview
  matches what Disburse actually posts, and confirming the CA data-repair tool's dry-run
  report against real live cash_advances docs. Committed, not yet pushed to master.
  **Still needed before this is production-ready**, in priority order: (1) have Neil's
  accountant verify every SSS/PhilHealth/Pag-IBIG/TRAIN figure in js/statutory-tables.js and
  flip `verified:true` — nothing should be trusted for real payroll until then; (2) deploy the
  rules (`~/.npm-global/bin/firebase deploy --only firestore:rules`, re-diff first); (3) a live
  Compute→Verify→Disburse run for a real month, checked against last month's Path-A numbers
  for an exact match under the default 'flat' policy; (4) decide whether/when to enable
  `payPolicy:'performance'` (ships inert, per WS20 decision 2 — a real pay-policy change, not
  a code decision); (5) the WS20 Payroll-reconciliation report, when someone has bandwidth.
  NEXT: workstream 23+24 (raises + the payslip template) per the build order in
  fable-workplan/INDEX.md, or 10-11 (URL routing + real Back + styled dialogs) if Neil wants
  the no-pop-ups UX work prioritized instead.
- **2026-07-10 (Sonnet implementation — WS23+24, raises + the payslip, per spec):** Both
  specs implemented together (23 lands the raise on the base-of-record BEFORE 24 reads it, so
  they compose cleanly with no shared-function collision — unlike WS20/22/23's shared
  Compute-handler risk flagged in WS23's own grounding, already resolved since WS20 replaced
  that handler with a thin `computePayRun()` call last session).
  **WS23 — window.RaiseFlow** (departments.js, below openRaiseHistory): `submitRaise` (President
  → `scheduled` + apply-if-due; everyone else → `pending_approval`), `materialize` (idempotent,
  guarded on `status=='scheduled'`, writes `payroll.salary` or `worker_profiles.dailyRate`+scaled
  `hourlyRate` from LIVE values, then the `salary_raises` audit row keyed to the SAME doc id so a
  retried sweep overwrites instead of duplicating), `applyDueRaises(subjectType)` (month-gated
  screen-load sweep — `effectiveMonth <= currentBizMonth`, so a future-dated raise can never leak
  into any Compute, current or a re-run of a past month), `approve`/`reject`. New
  `window.openScheduledRaises()` admin list (Approve/Reject inline, president-only). Both call
  sites (Payroll 💸, HR Profiles 💸 Raise) lost their `applyRaise` closures — the hourly-scaling
  math that used to live in the HR closure now lives in `materialize` (reads live values, same
  result). Both bypass paths closed: Edit Payroll's Base Salary field is now read-only display
  ("change via 💸 Give Raise") with `salary` dropped from the save payload; Worker Profile Edit's
  Daily/Hourly Rate inputs are read-only in edit mode, still editable in create mode (setting a
  new hire's *initial* rate isn't a raise) — the save handler omits `dailyRate`/`hourlyRate`
  from the write entirely in edit mode rather than reading a now-nonexistent input element.
  Screen-load sweeps added to the top of `renderPayrollManagement` and `renderFinanceHRProfiles`;
  a banner shows scheduled/pending counts with a "View" link. Approvals page gains a `raise` type
  card (president-only per decision 4 — no manager fallback, unlike `ca`/`ca_deduct`). Employee
  self-view gains a "Salary Changes" card reading `salary_raises` (applied-only by construction —
  a still-scheduled/pending raise can never appear there, so no separate visibility gate was
  needed). `firestore.rules`: new `pending_raises` block — non-president finance may only CREATE
  a `pending_approval` doc (filing is a safe escalation, not itself money-moving — matches the
  secretary's existing "request President approval" pattern elsewhere in this codebase, so I kept
  the spec's literal `isFinanceOrAdmin()` gate here rather than narrowing to `isMoneyAdmin()` as
  I did for WS20's `pay_runs` last session); only the materialize transition (scheduled→applied)
  and everything else is `isPresident()`-gated, with `.get(field,default)` throughout.
  **WS24 — the ONE payslip.** `window.toPayslipModel(source, kind)` normalizes either cycle
  (a frozen `pay_runs` line/`salary_history` mirror, or a `payslips` doc) into one `PayslipModel`;
  `window.buildPayslipHTML(model)` renders it (letterhead + Employee/Earnings/Deductions&
  Contributions [EE+ER 3-column]/Cash-Advance-before-installment-after/Performance[monthly-only]/
  Net Pay/YTD/Time-Log[weekly-only]/Signatures); `window.renderPayslipPage(model, backFn)` hosts
  it inside `#page-content` with a Back button and same-document `window.print()` — **zero
  pop-ups**, per the owner's standing directive (grep-confirmed: no `window.open` call remains
  anywhere in payroll/payslip code). Used the SEAM RECONCILIATION note in the WS24 brief itself
  (written after WS14 landed in the same batch) to call the real `window.buildLetterhead()`
  directly rather than the brief's placeholder `window.Letterhead.header()` API that was never
  built. `printPayslip()` and `printWorkerPayslip()` (near-duplicate KPI×Attendance-multiplier
  popup generators, one of them silently reading pay from the wrong collection as a fallback) are
  deleted outright; their buttons now build a model and call `renderPayslipPage`. The two
  previously-dead Payroll-tab print buttons (`print-payroll-btn`/`print-slip-btn` — confirmed via
  grep that no handler had ever been attached) are wired: per-row 🖨 opens one payslip from the
  frozen line (or a labelled `PROJECTION — not yet disbursed` badge if no line exists yet this
  month); "🖨 Print All" stacks every employee's payslip with `page-break-after`, reusing WS14's
  two-tier page-break CSS so long payslips don't reproduce the "blank page 1" bug fixed for quotes
  (aab024a). Also found and deleted `window._payslipData` entirely (not just its role as a print
  payload, per the spec's own conditional instruction) — grep confirmed nothing reads it anymore
  once `printPayslip()` was gone. Fixed the `payslips` rules bug WS21 had explicitly deferred:
  the owner-read branch checked `resource.data.userId`, a field that's never written (the actual
  field is `workerId`) — so a worker with a login could never read their own payslip; fixed with
  `.get('workerId','')` (+ a future-proofing `linkedUid` check for WS20 D3's bridge). New
  composite index `payslips(workerId ASC, payPeriodStart ASC)` for the weekly YTD query (monthly
  YTD needed no new index — reuses the existing `salary_history(userId,month)` index).
  `collectPayslipData()` gains `employerShare: null` (weekly ER stays manual-only per decision 3,
  same as WS21 left it). Print CSS moved out of inline `<style>` tags into `css/styles.css`
  (`.payslip-print` + scoped `.lh-*` mirrors of `js/letterhead.js`'s classes, since this is the
  first letterhead consumer that renders in-page rather than in a popup's own document) — the
  JPEG-export feature (html2canvas) was preserved, just retargeted from `#payslip-page` to the
  `.payslip-print` container and renamed `window.downloadPayslipJPEG` to avoid any collision with
  the (separately-scoped, popup-only) `downloadJPEG()` still used by other print flows.
  **Verified:** `node --check` clean on both touched JS files; `firebase deploy --only
  firestore:rules --dry-run` compiled after each rules edit; `firestore.indexes.json` validated
  as well-formed JSON; CSS brace-balance sanity check; grep-swept for dangling references to
  every retired function/object (`applyRaise`, `previewPayslip`, `renderPayslipPreview`,
  `printPayslip`, `printWorkerPayslip`, `window._payslipData`, `buildPayslipHTML(` with the old
  raw-doc argument shape) — zero hits outside intentional historical comments. **NOT verified**
  (needs a live login): an actual same-day vs. future-dated raise click-through, a live payslip
  render for a disbursed vs. not-yet-disbursed month, and the weekly YTD index actually finishing
  its build in the Firebase console before that query is exercised for real. Committed, not yet
  pushed to master. **Still needed:** deploy the rules + the new index
  (`~/.npm-global/bin/firebase deploy --only firestore:rules,firestore:indexes`, re-diff first);
  a live test of both workstreams' manual checklists (WS23 Spec 11 / WS24 Spec 10).
- **2026-07-10 (Sonnet implementation — WS10+11 URL routing + real Back + styled dialogs, per
  spec):** Built the foundation myself first (cross-cutting architecture), then delegated the
  three large, well-specified mechanical sweeps to parallel subagents — one per file — since
  Fable's spec had already decided every rule. **Foundation:** `hashFor(page,subtab)`/
  `parseHash(hash)` + `window._navDepth` in app.js; `window.Overlay` (LIFO stack, one
  `history.pushState`/`history.back()` per dismissable surface — modal/page-panel/task-panel/
  dialog) + `window.confirmDialog(opts)→Promise<boolean>` + `window.promptDialog(opts)→
  Promise<string|null>` + `window.setSubroute`/`window.initialSubtab` in config.js; rewrote
  `navigateTo`/`navBack`/`updateNavBackBtn`, `openModal`/`closeModal`, and added new
  `openPage(title,bodyHTML,footerHTML,opts)` (full-screen routed panel, identical signature to
  `openModal`) in app.js; `popstate`/`hashchange`/`keydown`(Esc) router wiring; auth-resolve now
  reads the initial route from the URL hash instead of hardcoding `'dashboard'`; task-detail
  panel (departments.js `openTaskDetail`/`closeTaskPanel`) wired into `Overlay` (drill-in
  semantics), quote-builder iframe deliberately left un-registered per spec (stays a normal
  routed page). New `.page-panel`/`.dialog-*` CSS block appended next to the existing modal
  rules (not the ~L3394 duplicate block, per spec). **Sweeps (3 parallel subagents, one per
  file):** all 73 `confirm()` sites → `await confirmDialog({...})` (danger:true for destructive/
  peso actions, escHtml()+html:true wherever a user label is interpolated), with `async`
  threaded up through every enclosing handler; all 13 `prompt()` sites → `await promptDialog(...)`
  preserving null-checks; all 104 `openModal(...)` sites triaged — 73 multi-field forms converted
  to `openPage(...)`, 31 small/read-only/credential-reveal dialogs deliberately left as
  `openModal(...)` (each with a one-line reason, e.g. two project-detail hubs that read
  `#modal-body` directly and would have broken under `openPage`'s different DOM shape; one-time
  password/account-creation reveals the spec explicitly says must stay modal). The
  `window.financeDelete` special case converted per the spec's exact instruction (its
  `new Promise((resolve)=>{...})` executor became `async (resolve)=>{...}`). Adopted sub-tab
  routing on the 3 in-scope screens (Finance, Sales, Partners) — 2-line change each: the
  `subtab` default parameter now calls `window.initialSubtab(defaultKey)` instead of a literal,
  and each `bindChipTabs` callback now also calls `window.setSubroute(key)`; the other ~12
  `chipTabs` screens keep session-only sub-tabs per spec. **Verified:** `node --check` clean on
  all 4 touched JS files (also proves every `await` sits inside a properly `async` function,
  since bare `await` outside `async` is a SyntaxError in these non-module `<script>` files);
  zero raw `confirm(`/`prompt(` remain (grep-swept); CSS brace-balance check; spot-checked the
  trickiest conversions (financeDelete, the `#modal-body`-dependent project-detail hubs left as
  openModal) by hand. Live-browser tested the shared dialog engine pre-login: default
  HTML-escaping (a raw `<script>` in a message rendered inert), `danger:true` styling,
  Cancel/backdrop-click/Escape all correctly resolve `confirmDialog→false`/`promptDialog→null`,
  value-prefill on promptDialog, and nested-overlay LIFO ordering (modal + confirmDialog on top
  — first Escape dismisses only the dialog, second dismisses the modal); zero console errors.
  **NOT verified** (needs a live login): deep-link/refresh-restore on a real `dept:Finance/
  Purchases`-style URL, device Back walking multi-page history, task-panel/quote-builder Back
  behavior, Chart.js-leak-on-Back, pull-to-refresh no-history-push. No new Firestore collection
  or query — no rules/indexes deploy needed for this workstream, per the spec's own note.
  NEXT: workstream 15-18 (durability, performance & scale, design-system consolidation, keyboard
  shortcuts) per the build order in fable-workplan/INDEX.md.
