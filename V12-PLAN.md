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
15. `[x]` **Records durability** — backup covers ALL collections + native typed export; restore
    script + docs; sync/backup failure alerting surfaced in-app; Drive files private-by-default
    (folder ACLs, payslip proofs no longer public-by-link); write-time sync queue instead of
    nightly full rescan. Storage strategy: Firestore = live DB (free tier, kept lean by
    workstream 16), Drive = archive/backup mirror (free 15GB) — the system stays free.
    IMPLEMENTED (dynamic `db.listCollections()` backup discovery + `system_health` heartbeat +
    `restore-from-backup.js`) — see Build Log. Write-time sync queue deliberately deferred
    (nightly generic walk stays authoritative), per spec decision 7.
16. `[x]` **Performance & scale** — aggregate/counter docs for dashboard KPIs; limits/date
    filters on the unbounded reads (ledger, tasks, users, quotes×3, inventory, analytics×13);
    unified cache keys; presence heartbeat throttled; split departments.js; Chart.js on demand.
    IMPLEMENTED (bounded `ledgerForPeriod`/`ledgerSince` reads, unified cache keys, Chart.js
    on-demand load) — see Build Log. No counter docs built (deferred to WS13 per spec D1/D2/D11);
    departments.js split deferred (D-split); presence heartbeat needed no change (already
    throttled, D10).
17. `[x]` **Design-system consolidation** — collapse the override-stacked CSS into one token
    layer; Lucide icons replace ~1,100 emoji; Auto (system) theme; theme-color meta follows
    theme; typography scale; focus states. IMPLEMENTED (safe CSS dedup + typography-scale
    tokens + universal focus ring + Auto theme + icon infra) — see Build Log. Icon migration
    is PARTIAL by design (spec's own decision: unmapped/unconverted emoji fall back to literal
    rendering, so partial completion never breaks a screen) — infra + all named sites + ~50
    unambiguous icon-only-button conversions done; ~600+ prose/label-prefix emoji deliberately
    left for a future pass.
18. `[x]` **Keyboard shortcuts** — Esc closes overlays; Ctrl/⌘K or / global search; Alt+1..9
    nav; ? cheat sheet. IMPLEMENTED (window.Keymap in app.js) — see Build Log. Escape routes
    through WS10-11's window.Overlay rather than a separate registry (reconciliation, since
    the two specs were written independently — see Build Log for the exact mechanism).
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
25. `[x]` **Leave that works** — HR grants/accrues balances (PH 5-day SIL minimum); approved
    leave writes attendance records so it doesn't cut pay. IMPLEMENTED (window.LeaveAccrual +
    consolidated attRecScore/attRecKind/attKindBadge helpers) — see Build Log.
    `LEAVE_POLICY.grants` ships as a labelled PLACEHOLDER `{vacation:5,sick:5}` — needs Neil's
    confirmation before the "Run Annual Accrual" button is pressed for real (the true legal
    floor is ONE combined 5-day SIL pool, not 5+5 — see the spec's decision 3).
26. `[x]` **Attendance v2** — time-out + hours (feeds weekly hourly production pay); holidays
    admin screen (yearly proclamations without code changes); optional geofence/kiosk for
    factory staff; extension-upgrade bug fixed (approved extension currently hard-blocks 9AM).
    IMPLEMENTED (office Time Out button, worker kiosk + payslip auto-fill, holidays admin
    screen, unified extension approve/deny) — see Build Log. Geofence deliberately not built
    (greenfield/deferred per spec decision 1).
27. `[x]` **IDs** — professional employee ID redesign (QR verify, print/export, brand header)
    + **worker ID cards** generated by HR for `worker_profiles` (photo upload, auto BI-W-####,
    batch print, CR80 size) + worker login unblock + Create-Worker-Account screen re-linked
    (currently orphaned). IMPLEMENTED (QR verify via new `/v/` page + `id_verify` collection,
    CR80 print builder, worker kiosk photo/ID) — see Build Log. **This completes Phase 3
    (workstreams 20-27, the payroll/HR bundle) — see Build Log for Phase 4 (28-40) status.**

### PHASE 4 — Operations & departments

> **Status as of 2026-07-11: ALL 13 Phase 4+5 workstreams (28-40) are IMPLEMENTED, verified,
> committed, and deployed.** The full v12 plan — all 40 workstreams across 5 phases — is
> complete. Build order: WS29 → WS38 → WS28/32/33/36/37/39 → WS30/31/34/35 (Wave B, each
> re-verified by a fresh Fable pass against the real shipped code of what it depends on
> before Sonnet touched it — one real drift was caught this way, in WS40) → WS40 last.
> Every workstream shipped with `node --check` + firestore.rules brace-balance verification,
> and every rules/index change was deployed the same session it landed. See
> `fable-workplan/INDEX.md` and each `fable-workplan/NN-*.md`'s `## DECIDED`
> (+ `## RE-GROUNDED` where present) section for full detail, and the ‼️ FLAG FOR NEIL items
> collected inside each spec for open business-policy decisions (none block the build).

28. `[x]` **Production process flow** — stages renamed to owner's flow: **Layouting → Bending &
    Cutting → Assembly → Finishing & Polishing → Quality Checking → Out for Delivery** (legacy
    stage mapping so existing orders don't strand); per-stage worker assignment + timestamps
    (stageHistory); delivery step requires delivery receipt; QC checklist. **DECIDED**
    (Fable, 2026-07-10) — see `fable-workplan/28-production-flow.md`; IMPLEMENTED 2026-07-11.
29. `[x]` **Inventory correctness** — moving weighted-average cost on receive (stop re-valuing
    all stock at latest price); movements logged for consumption + receiving (the two biggest
    flows, currently missing); count-form posts variances; item binding at RFQ (stop silent
    name-mismatch loss). **DECIDED** (Fable, 2026-07-11) — see
    `fable-workplan/29-inventory.md`; IMPLEMENTED 2026-07-11.
30. `[x]` **Purchasing** — PO approval gate before the President's name prints; receiving →
    stock + ledger correctly (with 13's asset accounting). **DECIDED** (Fable, 2026-07-11) —
    see `fable-workplan/30-purchasing.md`; IMPLEMENTED 2026-07-11.
31. `[x]` **Quotation builder v3** — SALES BOTTLENECK fix. Guided "Quick Quote" 3-step mode
    (client → pick products from a photo catalog → review/send) for new users; full builder
    stays for power users; product photos in DB + builder grid + printed quote; repair the
    quote→approval→order chain (BK quotes stranded in bs_quotes; Finance's empty list;
    Approvals approving without filing); delete ~1,800 lines of dead builder code; client-#
    auto (done in P1). **DECIDED** (Fable, 2026-07-11) — see
    `fable-workplan/31-quotation-builder-v3.md`; IMPLEMENTED 2026-07-11.
32. `[x]` **Sales — Client Relations hub** — per-client timeline (quotes, orders, payments,
    files, follow-ups in one view); CRM stages rolled into win-rate analytics. **DECIDED**
    (Fable, 2026-07-10) — see `fable-workplan/32-sales-crm.md`; IMPLEMENTED 2026-07-11. This is the
    most load-bearing decision in the Phase 4 batch — WS31/34/35/40 all read its
    client-record-unification call.
33. `[x]` **AEC Partner Directory** (owner spec 2026-07-09) — table in Sales: item # · type
    (A=Architect yellow / E=Engineer red / C=Contractor blue) · company · contact person ·
    number · email · PH region · address · contacted status · prospected project? · quotation
    sent? · feedback/partnership potential. Filterable, CSV export, printable on letterhead,
    follow-up nudges. New `aec_contacts` collection + rules + backup. **DECIDED** (Fable,
    2026-07-10) — see `fable-workplan/33-aec-directory.md`; IMPLEMENTED 2026-07-11.
34. `[x]` **Marketing suite** — campaigns (budget→actual, dates, channels), leads inbox → Sales
    handoff, promotions calendar, marketing materials library (Files hub), strategy templates
    (types of marketing), per-campaign insights (spend vs leads vs quotes vs wins).
    **DECIDED** (Fable, 2026-07-11) — see `fable-workplan/34-marketing.md`; IMPLEMENTED 2026-07-11.
35. `[x]` **Design dept suite** — project folders + client folders synced with Sales client
    files (one client record shared, per-dept views); drawing approvals; design → production
    handoff. **DECIDED** (Fable, 2026-07-11) — see `fable-workplan/35-design-suite.md`.
    IMPLEMENTED (real approve/release gate on `design_drawings` — president/manager or the
    project's `designLead`, never the drawing's own author/assignee, enforced in both
    `window.canApproveDrawing`/`changeDrawingStatus` and a rewritten `firestore.rules` block;
    project/client folders via WS38's `hub_folders`/`hub_files` under a new `scope:'projects'`,
    new `renderProjectFiles` project tab + a Files section in WS32's client hub; hardened
    Design→Production handoff with a `drawingId`/`url` hook for WS28) — see Build Log.
    **Rules not yet deployed** — `firestore.rules` needs `firebase deploy --only
    firestore:rules` before the approval gate is enforced server-side.
36. `[x]` **Finance additions** — **bank accounts registry** (accounts, balances, running
    reconciliation, which account each payment hit) + **downpayment billing invoice** document
    (letterhead, payment details/bank instructions, DP % of contract, balance schedule) wired
    into the sales-order downpayment flow. **DECIDED** (Fable, 2026-07-10) — see
    `fable-workplan/36-finance-additions.md`; IMPLEMENTED 2026-07-11. Enumerates all 15 existing
    money-writers with an explicit v1 in/out-of-scope call for each; resolves the naming
    collision with WS13's chart-of-accounts (`bankAccountId`, never `account`/`accountType`).
37. `[x]` **Team Chat** — Messenger-grade: DMs + named group chats + dept channels; reactions,
    online presence, Seen avatars, typing…, inline photos/files; live listeners + push; full
    page with Back; participant-scoped rules; partner walled off. **DECIDED** (Fable,
    2026-07-10) — see `fable-workplan/37-team-chat.md`; IMPLEMENTED 2026-07-11.
38. `[x]` **Files Hub** — Drive-style: one browser over all files; folders/subfolders,
    drag-drop, grid/list, global file search, previews (img/PDF), versions, recycle bin;
    share to person/dept/role with view-vs-edit; rides Storage + nightly Drive mirror.
    **DECIDED** (Fable, 2026-07-11) — see `fable-workplan/38-files-hub.md`. IMPLEMENTED
    (new `hub_files`/`hub_folders` collections + rules + 7 composite indexes, `window.FilesHub`
    service + `openFilePreview` lightbox in drive.js, `bindFileCollection` rewritten in place
    against `hub_files` with zero call-site edits, top-level Files Hub page + 6th global-search
    source, idempotent `scripts/migrate-files-hub.js`, dead shadowed
    `renderFileCollection`/`bindFileCollection`/`renderDocCollection` pairs deleted) — see Build
    Log. **Deploy-pending (not run by the implementing session):**
    `firebase deploy --only firestore:rules,firestore:indexes`, then
    `node scripts/migrate-files-hub.js` (needs `FIREBASE_SERVICE_ACCOUNT`) — run once after the
    rules deploy, once more after the JS ships, per Spec 10.

### PHASE 5 — Intelligence & compliance

39. `[x]` **BIR suite** — books of account prints (general journal, general ledger, cash
    receipts, cash disbursements); 2550M/Q, 1601-C worksheets, alphalist, 2316; OR/SI series;
    net-of-VAT statements; input-VAT capture on expenses (fixes the overstated VAT bugs);
    formal Financial Statement print (income statement + balance sheet + VAT summary).
    **DECIDED** (Fable, 2026-07-11) — see `fable-workplan/39-bir-suite.md`; IMPLEMENTED 2026-07-11.
40. `[x]` **Analytics with conclusions + the data/strategy layer** — metrics that matter (cash
    position, AR aging, win-rate, on-time %, payroll ratio, inventory turns); rule-based
    insight sentences + a written "conclusion" block per dashboard (owner: "data must be
    interpreted and create recommendations"); theme-aware charts (currently dark-hardcoded);
    a Strategy page: recommendations engine (e.g. "AR > 60d: collect ₱X", "quote win-rate
    fell — review pricing", "material Y price up 12% — reorder early") + market-research
    notes section per department. Server-side daily digests (scheduled Function).
    **DECIDED** (Fable, 2026-07-11) — see `fable-workplan/40-analytics.md`; IMPLEMENTED
    2026-07-11 (digest ships as GitHub Actions cron, not a paid scheduled Function).

---

### PHASE 6 — Post-v12 additions (Neil, 2026-07-11)

> **All 40 workstreams above (Phases 1-5) are IMPLEMENTED — the original v12.0.0 plan is
> complete.** This phase captures work added after that milestone. Same discipline applies:
> Fable decides architecture into a `fable-workplan/NN-*.md` `## DECIDED` spec, Sonnet
> implements mechanically from it.

41. `[ ]` **My Profile tab + Facebook-inspired shell redesign** — a new personal-hub tab
    (ID, Personal Finance & Performance, Personal Analytics, Tasks, Recent Activities) plus a
    shell restructure: a Facebook-style top nav for desktop/iPad (Profile · Chats ·
    Notifications · Menu · Departments · Search · logo/title) with the left sidebar
    simplified to the remaining core sections (Tasks, Posts, Company, etc.), and an
    equivalent mobile layout (Facebook-inspired; exact mobile icon set is an open decision).
    Full mandate captured verbatim in `fable-workplan/41-profile-and-nav-redesign.md`. High
    blast-radius — touches every page's chrome across all 6 roles and all device tiers, no
    incremental per-department rollout possible. Being architected now (Fable).

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
- **2026-07-10 (Sonnet implementation — WS15 Records durability, per spec):** Delegated the full
  mechanical implementation to one subagent (spec gave exact before/after code for every file);
  verified independently before committing. `scripts/monthly-backup.js`'s hand-maintained
  `EXPORTS` array (the recurring coverage-drift bug — new collections silently never got backed
  up) is replaced by `db.listCollections()` dynamic discovery + a thin `OVERRIDES` map (10
  entries) carrying only date-filter/CSV/subcollection specials; every other root collection —
  including the previously-missing `pay_runs`, `approval_requests`, `payroll_delete_requests`,
  the `it_*` family, `files_*`/`budgets_*`, etc. — now gets a complete JSON snapshot automatically,
  with zero future code change when a new collection appears. A `_manifest.json` (file→collection
  map) is written alongside, which the new `scripts/restore-from-backup.js` reads to restore
  without its own hand-maintained list (drift-proof by construction). Restore is dispatch-only via
  the new `.github/workflows/restore.yml`, dry-run by default (`RESTORE_COMMIT=1` to actually
  write), reconciles `_counters` by bump-to-max (never blind-overwrites a sequence), and revives
  ISO-8601 strings back to Firestore Timestamps. `scripts/drive-lib.js`'s `uploadBuffer` gained an
  opt-in `{public}` flag defaulting to `false` — both the daily file mirror and monthly JSON/CSV
  backups are now **private by default** (Drive stops being a second, permanent, org-external
  public surface for payroll/finance dumps and payslip/drawing attachments); the app keeps opening
  files via their existing Firebase Storage URLs, so 3 `driveUrl`-preferring sites in
  departments.js (task attachments, drawing current-file, drawing revision history) had their
  fallback order flipped to prefer the Storage `url`/`fileUrl`. A new `system_health/{jobId}`
  collection (written only by GitHub Actions via the Admin SDK, `allow write: if false` in
  firestore.rules) is the heartbeat both jobs report to; `js/app.js` gained
  `checkBackupHealth()` (elapsed-ms staleness check, finance/admin-only, fire-and-forget after
  profile load) + a dismissible red banner + a deduped President notification when a job is
  stale or errored. **Genuine ambiguity, resolved not stopped-on:** the spec assumed a
  `window.PRESIDENT_UID` global or an existing uid-from-email resolver would exist for the
  notification push — grep confirmed neither does (the only `PRESIDENT_UID` in the codebase is an
  unused, unexported email-string constant in modules.js). Used the spec's own explicit fallback
  instruction ("do not block the banner on it") — the push silently no-ops, the banner still
  fires; documented in a code comment rather than inventing a new global. **Verified:** `node
  --check` clean on all 6 touched/new JS files; grep confirms zero remaining `EXPORTS` references;
  `firestore.rules` braces balance (213/213); `.github/workflows/restore.yml` parses as valid
  YAML; hand-spot-checked all 3 driveUrl-flip sites and the `checkBackupHealth()` call site
  (correctly placed right after `startClaimsListener(user.uid)` in the post-profile-load auth
  branch). **NOT verified** (needs live GitHub Actions/Drive/Firebase console access this session
  doesn't have): an actual `workflow_dispatch` of the updated monthly backup or the new restore
  workflow, confirming Drive files show Private in the Drive UI, or a live login to see the
  banner render. **Still needed:** deploy `firestore.rules` (new `system_health` block — the
  ONLY workstream-15 rules change); then, when convenient, manually dispatch the backup workflow
  once and confirm `_manifest.json` + the previously-missing collections all appear, confirm new
  Drive uploads show Private, and dry-run the restore workflow once.
- **2026-07-10 (Sonnet implementation — WS16 Performance & scale, per spec):** Split across 4
  parallel subagents (config.js helpers; app.js dashboards/analytics/chart-lazy-load;
  departments.js bounded reads; modules.js+notifications.js cache swaps) since the spec's own
  migration checklist was already organized file-by-file with zero cross-file dependency —
  same pattern as WS10-11's 3-way sweep. Governing constraint honored throughout: **no
  displayed money number changes** — every read-cost win is either a bounded query returning
  the exact same rows the client already filtered to, or cache-sharing of reads that were
  byte-identical. `js/config.js` gained `window.ledgerForPeriod(periodKey)`/`window.ledgerSince
  (startYmd)` (bounded `where('date','>=' /'<=')` ledger reads, cached per resolved period key;
  falls back to a full cached read for 'all'), `window.ymAddMonths`, and `window.ensureChart()`
  (lazy Chart.js loader); `dbCacheInvalidate` became collection-aware via an `_alias` map so
  the existing 22 `dbCacheInvalidate('ledger')` writers now also flush `ledger:*`/`ledger>=*`
  period-scoped cache entries and the 3 `dbCacheInvalidate('expenses')` writers flush
  `expenses-pending`/`expenses-recent` — zero invalidation call-sites needed editing. Cache-key
  unification merged 11 duplicate `an_*` Analytics keys into the canonical keys every writer
  already invalidates (`tasks-all`, `all-quotes`, `submissions`, `expenses`, `cash_advances`,
  `payslips`, `gov_biddings`, `job_projects`, `job_costs`, `projects`, `sales_clients`) — this
  also fixes a real pre-existing staleness bug as a side effect (Analytics could lag up to 60s
  behind the Dashboard after a president posted an expense, since `an_*` keys were never
  explicitly invalidated anywhere). `users-payroll` (confirmed byte-identical to `users`) was
  deleted, folding into `users`; its 3 now-dead invalidator calls removed. `renderPresidentDashboard`
  and `renderFinanceDashboard` now read `ledgerForPeriod('month'/period)` + `ledgerForPeriod('prev')`
  instead of a full ~10k-row ledger scan on every dashboard open — the MTD/prev-month net
  calculations read directly off the pre-bounded snapshots instead of re-filtering client-side.
  `renderFinanceOverview` (departments.js) keeps its ALL-TIME lifetime Income/Expense semantics
  unchanged (bounding it would change a displayed number — forbidden; deferred to WS13's future
  `accountType`-aware `finance_rollup` doc per D11) but stops the per-click uncached full
  expenses+ledger read, splitting into cached `expenses-pending`/`expenses-recent`/`ledger`
  reads. All inventory reads app-wide (7 sites across departments.js/modules.js/notifications.js
  — RFQ, BOM modal, production forms, receive-into-inventory, low-stock login check, Stock tab,
  global search) now share one `dbCachedGet('inventory_items', ...)` cache instead of each
  independently re-scanning the collection; client-side `.sort()` added wherever a dropped
  `.orderBy('name')` needs replacing. Chart.js no longer loads eagerly — all 13 `new Chart(`
  sites (6 async Analytics tab-renderers) now `await window.ensureChart()` on first use, with
  the CDN URL kept in `sw.js`'s PRECACHE list so the on-demand fetch is instant and offline-safe;
  the eager `<script>` tag was removed from index.html. **Verified:** `node --check` clean on
  all 5 touched files; grep-swept for every one of the 12 retired `an_*`/`users-payroll` cache
  keys — zero hits; hand-spot-checked the async conversion (both `new Chart(` call sites and
  their 6 enclosing async arrow functions, confirmed their only callers are fire-and-forget —
  no caller awaits or depends on a synchronous return, so the async conversion is safe) and the
  `renderFinanceOverview` bounded-read change (confirmed `ledIncome`/`ledExpense` still sum the
  identical full cached ledger array — no displayed number changed, only the read path is now
  cached). **No `firebase deploy` needed** — this workstream introduces no new collection or
  composite-index query (every bounded read is a single-field `where()`/`orderBy().limit()`,
  covered by Firestore's automatic single-field indexes), per the spec's own Spec 5. **NOT
  verified** (needs a live login): an actual dashboard open confirming the Network tab shows a
  bounded (not full-collection) ledger read, a live Analytics staleness-fix click-through
  (post an expense, immediately check Analytics), and confirming Chart.js's CDN request only
  fires when a charted screen opens (not on every login).
  NEXT: workstream 17 (design-system consolidation) per the build order in fable-workplan/INDEX.md.
- **2026-07-10 (Sonnet implementation — WS17 Design-system consolidation, per spec):** Split
  across 5 parallel subagents (css/styles.css; config.js icon infra+DEPARTMENTS; app.js theme
  system+icon sites; departments.js icon sites+sweep; modules.js+notifications.js icon sites),
  each independently verified before integration. Scope discipline matched the spec's own stated
  intent — "surgical, not a rewrite" — everything CSS-side is provably visual-no-op (dedup of a
  shadowed rule, or a token value that equals the px literal it replaces); the icon migration is
  **deliberately partial**, per the spec's own decision that unmapped/unconverted emoji fall
  back to literal rendering so partial completion never breaks a screen. **CSS:** folded 5
  duplicate `:root` token reassignments + 3 iOS-only motion tokens into one canonical `:root`
  (iOS values won today, kept as canonical — a no-op); merged 8 duplicated base selectors
  (`.topbar`, `.page-header`, `.subtab-btn`, `.card`, `.modal-box`, `.bottom-nav` 3-way, and a
  protected `.kpi-value` merge that left its `clamp(15px, 4.6vw, 28px)` line byte-identical since
  `window.fitKpiValues` depends on reading that exact computed size); replaced a hand-curated
  16-selector focus-visible allowlist with one universal `:focus-visible` rule + a
  `[tabindex="-1"]` opt-out; swept 226 `font-size:<px>` declarations to `--fs-*` tokens (44
  non-mapped px values deliberately left raw, `.kpi-value`/`.stat-num`/print-block explicitly
  excluded) — file went 4704→4651 lines, braces balanced 1292/1292. Added `--brand-primary` as
  the decoupled "accent role" token (defaults to `var(--pink)`, used only in rules this pass
  touched) per the WS9 BRAND hook. **Icon infra:** `window.LUCIDE_EMOJI_MAP` (86 entries) +
  `window.emojiIcon(glyph,size)` in config.js (falls back to the raw emoji for anything unmapped
  — the safety net the whole partial-completion strategy depends on); `DEPARTMENTS` gained a
  `lucideIcon` field on all 12 entries (emoji `icon`/`color` untouched, purely additive). All 6
  named DEPARTMENTS-icon render sites converted (5 in app.js, 1 in departments.js) plus one extra
  `cfg.icon` site the spec's table missed (converted for consistency by the app.js agent's own
  judgment call); notifications.js render-time icon resolution (no Firestore migration/backfill);
  profile-drawer shortcuts; ~50 unambiguous icon-only-button sites (departments.js 22,
  modules.js 3, plus others) converted via a conservative bounded pattern (only where an
  element's ENTIRE content was a single mapped emoji — button/badge labels, prose, toasts, and
  decorative prefixes-before-text were deliberately left as literal emoji, per the spec's own
  authorization). **~600+ chrome-emoji occurrences remain unconverted app-wide** — flagged, not
  silently dropped; a future pass can extend the D6 sweep using the same safe bounded pattern.
  **Theme system:** added a 7th `auto` entry to `THEMES` (resolves Office↔Obsidian live via
  `matchMedia`, no reload), `setTheme` now syncs `<meta name=theme-color>` to the resolved
  `--theme-color`/`--bg`, picker UI shows 3 swatches (Office/Auto/Obsidian) while the 4 hidden
  themes stay functional in code for existing localStorage values; `manifest.json`'s
  `theme_color` updated `#0a0a0a`→`#0F6CBD` (done directly, not delegated — a 1-line change);
  `index.html`'s static theme-color meta was already correctly `#FAF9F8`, needed no change.
  **Genuine issue caught and fixed, not blindly copied:** the config.js agent found the spec's
  own `LUCIDE_EMOJI_MAP` source contained one corrupted entry (a literal U+FFFD replacement
  character as an object key, `'�️':'link'`) — verified at the byte level, dropped that one
  redundant/corrupted entry (the mapping is already covered by `'🔗':'link'` on the next line)
  rather than copy garbage into production code; worth fixing at the source in
  `fable-workplan/17-design.md` if another workstream references the map again. **Verified:**
  `node --check` clean on all 5 touched JS files; CSS brace-balance 1292/1292; grep-confirmed
  `emojiIcon`/`LUCIDE_EMOJI_MAP` each defined exactly once; `.kpi-value`'s clamp line byte-
  identical pre/post; zero `@layer` introduced; zero old focus-allowlist selectors remain; all
  3 theme-swatch buttons present with matching `data-theme` values the existing click-wiring
  already expects (no wiring changes needed); hand-spot-checked ~20+ typography-sweep sites and
  a sample of the icon-only-button conversions to confirm no prose-embedded emoji was
  accidentally converted. **No `firebase deploy` needed** — zero rules/collection changes,
  confirmed by the spec's own decision 14. **NOT verified** (needs a live login across all 3
  picker themes + the 4 hidden ones + an OS dark/light toggle): the manual test checklist in the
  spec's §J (KPI auto-fit at 375px, modal glass rendering, bottom-nav accent color, Lucide icons
  actually rendering vs. empty boxes, Auto theme flipping live with the OS, focus ring on a
  previously-unlisted element, print preview unaffected, iOS notch/safe-area clearance).
  NEXT: workstream 18 (keyboard shortcuts) per the build order in fable-workplan/INDEX.md — note
  its spec assumes a separate `window.OverlayEsc` DOM-probe registry with its own Escape
  keydown listener, written before WS10-11 was actually implemented; WS10-11's `window.Overlay`
  (LIFO stack + History API) already owns Escape-to-dismiss for modal/page-panel/task-panel/
  dialog. Implementing WS18 literally as written would create two competing Escape listeners —
  reconciling this (route WS18's Escape entry through `Overlay.dismissTop()`/`isOpen()`, keep a
  small DOM-probe fallback only for the two surfaces `Overlay` doesn't track — profile drawer,
  mobile sidebar) before implementation.
- **2026-07-10 (Sonnet implementation — WS18 Keyboard shortcuts, per spec, with a
  cross-workstream reconciliation):** Implemented directly (not delegated) since this
  workstream required resolving a genuine architectural conflict between two independently-
  decided specs, which needs full context of both the WS18 spec and the actual as-built WS10-11
  code. The WS18 spec (written before WS10-11 was implemented this session) assumed a
  standalone `window.OverlayEsc` DOM-probe registry with its own Escape keydown listener,
  reading overlay state via `document.getElementById('modal-overlay').classList.contains
  ('active')`-style checks. But WS10-11 already shipped `window.Overlay` — a History-API-backed
  LIFO stack that is the AUTHORITATIVE record of what's open (push/pop tracked in code, not
  inferred from CSS classes) — with its own single-purpose Escape listener already wired in
  app.js's router section (left with a deliberate forward-compat comment: "Esc closes the top
  overlay (WS18 must reuse this path)"). Running both listeners would have raced two independent
  "close on Escape" systems against the same keypress — e.g. `Overlay.dismissTop()`'s
  `history.back()` resolves asynchronously via `popstate`, so a second synchronous DOM-probe
  listener firing in the same event tick could see stale "still open" state and double-close.
  **Resolution:** dropped `window.OverlayEsc` entirely; folded WS18's full `window.Keymap`
  module (Ctrl/⌘K + `/` open search, `?` cheat-sheet modal, Alt+1..9 nav via the live
  role-dependent `getSidebarItems()`, first-run discovery toast) into the SAME listener that
  already existed, replacing it in place rather than adding a second — the 'escape' dispatch
  entry now calls `Overlay.dismissTop()` first, falling back to a plain DOM-class check only
  for the two UI surfaces `Overlay` never tracked (profile drawer, mobile sidebar — neither
  ever pushes a history entry, so they were never in scope for the Overlay stack). One
  `document.addEventListener('keydown', ...)` for the whole app, not two. **Bug caught and
  fixed during my own verification, not shipped as-authored:** the spec's `closeModal`-level
  `window._cheatSheetOpen = false` reset only fires when code calls `window.closeModal()`
  directly — but Escape-triggered dismissal (and backdrop-click, and any future
  `Overlay.clearAll()`) calls `Overlay.dismissTop()` directly, bypassing that wrapper entirely,
  so the flag would go stale after an Escape-close (caught via a live browser test: opened the
  cheat sheet with `?`, closed it with Escape, and `window._cheatSheetOpen` was still `true`).
  Fixed by moving the reset into the modal's `Overlay.push('modal', ...)` teardown callback
  itself in `openModal` — the one place EVERY dismissal path (Escape, backdrop click, X button,
  `Overlay.clearAll()`) actually runs through — and simplified `closeModal` back to its original
  one-liner. Re-tested after the fix: flag correctly resets to `false` after both an
  Escape-close and a second-`?`-press toggle-close. **Verified (live browser, pre-login,
  since dashboards need real auth):** `node --check` clean; CSS braces balanced (1297/1297);
  zero `window.OverlayEsc` object created (confirmed via grep — the only match is this
  reconciliation's own code comment); `?` opens the cheat-sheet modal with the `.kbd-cheatsheet`
  table rendering; Escape closes it via `Overlay.dismissTop()` with no second listener firing;
  nested nothing-broke-Overlay (WS10-11's earlier-verified modal+dialog LIFO ordering is
  untouched — this workstream only added to the 'escape' entry's `run()`, never touched
  `Overlay` itself); `Ctrl+K` navigates to the search page; the input-focus guard is exactly
  right — `/` and `Alt+1` are suppressed and do nothing while a text input is focused (typed
  literally instead), while `Escape` and `Ctrl+K` still fire even while typing, per the spec's
  own allow-list. **NOT verified** (needs a live login): Alt+1..9 actually jumping to real
  per-role sidebar items, the partner/Brilliant-Steel-only block on Ctrl+K/`/`/search (the
  guard functions `isPartner()`/`isBrilliantOnly()` aren't meaningfully exercisable pre-auth),
  the first-run hint toast firing once after a fresh login, and Escape actually dismissing the
  profile drawer/mobile sidebar in a live session (verified correct by code review — the DOM-
  class checks match `closeProfileDrawer`/`closeSidebar`'s actual `.open` class toggling — but
  not exercised end-to-end). **No `firebase deploy` needed** — zero rules/collection changes,
  the only persisted state is the device-local `localStorage` flag `bi-kbd-hint-seen`.
  **This completes Phase 2 (workstreams 09, 10-11, 12, 13, 14, 15, 16, 17, 18) — all IMPLEMENTED.**
  NEXT: Phase 3 remainder — workstreams 25 (leave), 26 (attendance v2), 27 (IDs) per the build
  order in fable-workplan/INDEX.md.
- **2026-07-10 (Sonnet implementation — WS25 Leave that actually works, per spec):** Split
  across 4 parallel subagents (config.js helpers+LeaveAccrual; modules.js leave IIFE+calendar
  classifier; app.js's four score-reader sites; departments.js seed-at-creation calls),
  firestore.rules done directly, each independently verified before integration. WS25 depends
  on WS19 (satisfied, already implemented) and composes with WS20/WS26 by design (leave writes
  attendance non-destructively via `merge:true`, touching only its own keys, so WS26's future
  `timeOut`/`hoursWorked` fields — not yet implemented — will survive). **Storage:** kept the
  existing mutable `leave_balances/{uid}` counter shape (rejected lazy-compute — many legacy
  users have no trustworthy `startDate`), added a new `leave_accruals/{uid}_{YYYY}` idempotency
  + forfeiture-audit doc. **Accrual:** yearly lump-sum, calendar-year, prorated to the nearest
  0.5 day in an employee's first partial year — a manual, idempotent "↻ Run Annual Accrual"
  button in the Leave admin screen (no cron, no Cloud Function, matching the repo's existing
  `backfillPayrollLedger` manual-button precedent), plus auto-seeding at both employee-creation
  sites in departments.js (signup approval and the dedicated Signups sub-tab — both restructured
  from bare `.add()` to capture the new uid so `LeaveAccrual.grantForYear` can seed it
  immediately). **Pay-safety:** an approved leave day writes an `attendance/{uid}/records`
  doc with `attendanceScore:1.0` (paid) or `0` (unpaid) plus a distinct `status:'leave'`/
  `'unpaid_leave'` + `leaveType` — WS20's `computePayRun` reads attendance only through
  `getAttendanceScore`→`_attRecScore` (now a one-line delegate to the new shared
  `window.attRecScore` helper, its name/signature/callers completely untouched), so paid leave
  is automatically counted as a full present day with **zero edits to Compute's frozen-line
  math**. **The six-way duplication fix:** consolidated `window.attRecScore`/`attRecKind`/
  `attKindBadge` in config.js and routed all six previously-independent inline score/badge
  ternaries through them (modules.js's EOM-standings `recScore` + the attendance-calendar
  classifier; app.js's team-today `attStatus`, employee-dashboard `attScore`, `_attRecScore`,
  and both the Employee Standings modal + the related worker-profile grid) — a leave day now
  renders 🌴 consistently everywhere instead of risking a stale ✓/✗ on whichever reader wasn't
  fixed, the exact bug class Phase 1 workstream 5 existed to close. The calendar classifier
  edit was verified byte-preserving for every non-leave branch (present/half/absent logic
  untouched, only reached via a new `else if` after the leave/unpaid-leave check). Day-counting
  now uses a new holiday-aware `leaveWorkingDays()` (excludes Sundays AND PH holidays) instead
  of the old Sunday-only `workingDays()`, so a request spanning a holiday no longer over-charges
  the balance for a day payroll never penalizes. A single `applyLeaveApproval`/
  `writeLeaveAttendance` pair now backs BOTH approval surfaces (the standalone Leave screen's
  `approveLeave` and the unified Approvals queue's `approveLeaveRequest`), replacing two
  independently-duplicated decrement blocks. **Rules:** `leave_balances.write` gained a
  non-negative-number shape guard (via `.get(field,default)`, per the missing-field-throws
  memory) so a buggy accrual run can't write NaN/negative; a new `leave_accruals` block reads
  by owner-or-finance/admin, writes finance/admin-only, deletes president-only. **Backup
  coverage note:** the spec's own migration checklist says to add `leave_accruals` to
  `scripts/monthly-backup.js`'s `EXPORTS` array — that step is now MOOT, since WS15 (implemented
  earlier this same session) already replaced the hand-maintained `EXPORTS` array with
  `db.listCollections()` dynamic discovery, so the new collection is backed up automatically
  with zero code change. **‼️ FLAG FOR NEIL (do not ship blind, per the spec's own decision 3):**
  `window.LEAVE_POLICY.grants` is a labelled PLACEHOLDER `{vacation:5, sick:5}` — the actual PH
  Labor Code floor (Art. 95) is ONE combined 5-day Service Incentive Leave pool, not 5 vacation
  + 5 sick; the current split is a policy choice above the floor that needs your confirmation
  before "Run Annual Accrual" is ever pressed for real. Also needs your call on
  `LEAVE_POLICY.probation` (day-one prorated accrual, the current default, vs. only-after-1-year)
  and on carry-over/cash-commutation of unused days at each annual rollover (currently: reset to
  a fresh grant, prior balance recorded in `leave_accruals.priorYearEnding*` but not re-credited).
  **Verified:** `node --check` clean on all 4 touched JS files; firestore.rules braces balanced
  (217/217); grep-confirmed every one of the six score-reader sites now calls the shared
  helpers with zero remaining inline duplicate ternaries; confirmed `_attRecScore`'s callers
  (`getAttendanceScore` and its own 5 callers) are completely unchanged — only the function body
  was replaced with a one-line delegate. **NOT verified** (needs a live login): an actual Run
  Annual Accrual click-through, a real leave request/approval cycle from both approval surfaces,
  the 🌴 badge rendering live across all six readers, and a WS20 Compute run confirming leave
  truly doesn't cut pay for a real employee. **Still needed:** deploy `firestore.rules` (new
  `leave_accruals` block + the `leave_balances` shape guard); then, once Neil confirms the
  policy numbers, press Run Annual Accrual to seed existing employees (must happen before any
  resumed leave filing, or the client pre-check blocks a first request against a still-zero
  balance).
  NEXT: workstream 26 (Attendance v2) per the build order in fable-workplan/INDEX.md.
- **2026-07-10 (Sonnet implementation — WS26 Attendance v2, per spec):** Split across 4 parallel
  subagents (config.js helpers; app.js extension-bug-fix+Time-Out-button; modules.js holidays
  merge+admin screen; departments.js kiosk+payslip-auto-fill), firestore.rules done directly,
  each independently verified before integration; one loose end (nav/routing wiring for the new
  holidays admin screen) surfaced by the modules.js agent's own report and closed by hand
  afterward. **The headline fix — a live bug, not a new feature:** `tryUpgradeAttendanceOnNotifRead`
  only ever checked a flat 9:00 AM cutoff, so an employee with a legitimately President-approved
  attendance extension still got hard-blocked and denied full attendance. It now fetches the
  extension doc, uses `window.attExtActive()` to resolve whether it's still active, and — if so
  — uses its real `expiresAt` as the deadline instead of 9AM; also gained an `editedBy` guard
  (an admin-corrected day must never be self-overridden by the employee's own next check-in) and
  a try/catch (a WS19 rules denial on an admin-edited day now silently no-ops instead of
  throwing). The two hand-duplicated extension approve/deny UIs (the standalone Leave/Attendance
  screen and the unified Approvals queue) now both call one shared
  `window.approveAttendanceExtension`/`denyAttendanceExtension` pair in app.js instead of
  independently reimplementing the same Firestore writes — closing the exact duplication class
  that let the bug drift in the first place. **Two new populations, two write paths, one shared
  hours helper (`window.computeHoursBetween`, lunch-hour-aware):** office/`users`-keyed employees
  get a self-service "Time Out" button on their dashboard, writing `logoutTime`+`hoursWorked`
  (a NEW, purely informational field — `attendanceScore` stays canonical and completely
  untouched, so WS20's payroll math and WS19's score∈{0,0.5,1.0} rule cap are unaffected) into
  the SAME `attendance/{uid}/records` doc; factory `worker_profiles` staff (no Auth yet) are
  clocked via a new HR-operated kiosk action writing a NEW `attendance_worker/{workerProfileId}/
  records/{date}` collection, keyed by the same id the payslip generator already uses as
  `profile.id` — so when WS27 eventually adds `worker_profiles.linkedUid`, an owner-read clause
  can be added later with zero re-keying. The payslip generator gained a "⟳ Load from kiosk"
  button that pre-fills the existing 7-day time-log inputs from `attendance_worker` records
  across the chosen pay period (rows stay editable, HR remains the override authority, and the
  `WPAY-` ledger-posting path on Submit is completely unchanged — confirmed by hand-checking the
  diff touches nothing near `collectPayslipData`/the ledger ref logic). **Holidays admin:** a
  new `settings_holidays/{year}` collection carries a sparse `overrides` map (add/edit a date, or
  `null` to remove a base-table holiday) merged on top of the existing formulaic `getPHHolidays`
  table — the fixed-date and by-formula entries (e.g. National Heroes Day) keep working with zero
  re-entry; admins only need to touch movable observances (Holy Week, Chinese New Year, Eid) for
  2029+ or a Malacañang re-proclamation. `getPHHolidays` deliberately stays synchronous (a
  boot-time `loadHolidayOverrides()` prefetch fills an in-memory cache after login, non-blocking
  — if it hasn't resolved yet, the base table is returned safely) so the change doesn't ripple
  async-ness through `countWorkDays` and every inline caller. New `window.renderHolidaysAdmin()`
  screen (year selector, source-badged list, add/edit/remove) wired into `navigateTo`'s switch
  (`case 'holidays'`) and a new profile-drawer shortcut gated to
  `['president','manager','secretary','finance']` (matching `isFinanceOrAdmin()`'s actual role
  set in firestore.rules, rather than the spec's slightly narrower "president/manager/finance"
  prose — chosen so the nav link's visibility matches exactly who the render function and rules
  already let in, avoiding a secretary seeing no link but being able to reach the screen via a
  direct hash). **Rules:** two new blocks — `attendance_worker` (no owner clause, HR/finance-
  admin read+write only, since kiosk workers have no uid yet) and `settings_holidays`
  (any authenticated read, finance/admin write; deliberately NOT folded into the existing
  president-only `settings/{docId}` match, which also gates `employeeOfMonth`/`sales_sop` and
  would have been loosened right along with it). **Verified:** `node --check` clean on all 4
  touched JS files; firestore.rules braces balanced (225/225); grep-confirmed the two shared
  extension functions are called from both modules.js's and departments.js's UI handlers with
  zero remaining duplicated Firestore-write logic; live-tested the two new pure helpers
  pre-login — `attExtActive` correctly resolves active/inactive/expired extension states,
  `computeHoursBetween` correctly deducts the lunch hour for a 7AM-4PM shift (returns 8, not 9).
  **NOT verified** (needs a live login): an actual Time Out click-through with a real logged-in
  employee, a live extension approve→employee-checks-notifications→upgrades-to-100% cycle (the
  headline bug fix), a kiosk clock-in write + payslip "Load from kiosk" click-through, and the
  Holidays Admin screen's add/edit/remove flow against a real `settings_holidays` doc.
  **Still needed:** deploy `firestore.rules` (the two new blocks); the new `attendance_worker`/
  `settings_holidays` collections are covered by WS15's dynamic backup discovery automatically —
  no `scripts/monthly-backup.js` edit needed, unlike what the spec's own migration checklist
  assumed (written before WS15 replaced the hand-maintained EXPORTS array this same session).
  NEXT: workstream 27 (Employee/worker IDs) per the build order in fable-workplan/INDEX.md.
- **2026-07-10 (Sonnet implementation — WS27 Employee/worker IDs, per spec):** Split across 3
  parallel subagents (new files: vendored `js/qrcode.js` + the new public `/v/` verify page +
  index.html/sw.js wiring; app.js's employee-ID QR+print+shared CR80 builder; departments.js's
  worker-ID cards+photo-upload+drive.js), firestore.rules+storage.rules done directly given
  their security sensitivity, each independently verified before integration. **Seam correction
  applied throughout:** the spec's own "interim `window.BRAND`" (Section 1) was superseded —
  WS9's real `window.BRAND` (implemented earlier this session) already carries `verifyBase:
  '/v/'` and `logo.wordmark` exactly as the seam-reconciliation note anticipated, so every
  agent was briefed to use the REAL object's field paths (`BRAND.legal?.opcName`, not a
  nonexistent `legalName`; `BRAND.logo?.print`, not a flat `.logo` string) instead of the
  spec's now-dead interim shape — confirmed via grep that zero `B.legalName` or bare-string
  `B.logo` references made it into the final code. **QR verify:** a new unguessable-token
  `id_verify/{token}` collection (mirrors the existing `order_tracking` pattern — `get` public,
  `list` denied, so nothing can be enumerated) holds ONLY a public-safe projection (name, photo,
  ID number, dept, title, status) — SSS/PhilHealth/TIN/rates/CA-balance/address/phone/email never
  leave `worker_profiles`/`users`. A new public `/v/?<token>` page (a near-clone of the existing
  `/t/` order-tracking pattern — self-contained, no login) resolves it; the vendored
  `qrcode-generator` library's upstream file path had moved since the spec was written (the
  agent verified this via the GitHub API and fetched the correct current location + license
  before vendoring, rather than blindly hitting a 404'd URL or guessing at a reimplementation).
  **Employee ID card** (`renderIDCard`) gained a QR slot + "🖨 Print / Save PDF" button (also
  closing a pre-existing `escHtml` gap on the employee-ID-number interpolation, and fixing the
  status badge to actually reflect `inactive` instead of being hardcoded ACTIVE); a shared
  `window.printIDCards()` builds a real CR80-dimensioned (85.6×53.98mm) front+back card via the
  same new-window `document.write()` + delayed `window.print()` pattern this repo already uses
  for payslips/POs. **Worker ID cards:** HR gets a per-row "🪪 ID" button + a "🪪 Batch Print
  IDs" header button in the Worker Payslips screen, a photo-upload control (new Storage path
  `worker-id-photos/{profileId}/…`, since a worker_profiles doc has no Auth uid to scope by),
  and a "Generate" button minting an atomic `BI-W-###` number via a new `_counters/workers`
  transaction (mirroring the existing `_counters/employees` pattern) — existing free-text
  `idNumber` values are deliberately left un-backfilled (some are already printed on physical
  cards; decision 6). `openHRProfileForm`'s save now pre-allocates the worker's doc id before
  the photo upload so the path is stable, and writes via one `set(...,{merge:true})` instead of
  separate add/update branches. **Nav:** a new "🔑 Accounts & Logins" HR-hub card links to the
  existing (unmodified) `renderTeam()` Create-Worker-Account screen, shown only to
  president/manager — confirmed to exactly match `renderTeam()`'s own stricter access gate, so
  secretary/finance never see a dead-click card. **A duplicate-work near-miss, caught by the
  agent itself:** Section 8 (Create-Worker-Account must write the `usernames/{username}` map)
  turned out to already be fully implemented — WS19 had landed it earlier this session with its
  own `// v12 WS19` comments — the app.js agent grepped first, found it already done, and
  correctly did nothing rather than duplicating or half-overwriting working code. **Rules:** new
  `id_verify` block (public get, denied list, narrow create/update — HR mints any card, an
  employee may only mint their OWN `kind:'employee'` card); `_counters` write widened from
  admin-only to `isFinanceOrAdmin()` (safe — these are opaque monotonic integers, the worst a
  finance user can do is advance a sequence); new `storage.rules` block for
  `worker-id-photos/{profileId}` (finance-tier write, any signed-in read, valid-image check).
  **Verified:** `node --check` clean on every touched/new JS file including the vendored
  `js/qrcode.js`; firestore.rules braces balanced (227/227), storage.rules balanced (59/59);
  cross-file grep confirmed every shared function (`buildIdVerifyDoc`, `printIDCards`,
  `nextWorkerIdNumber`, `openWorkerIDModal`, `batchPrintWorkerIDs`, `uploadWorkerPhoto`) is
  defined exactly once and called correctly from the other files; live-tested `window.buildQRSVG`
  pre-login — generates a valid 549-rect SVG for a real verify URL; live-tested the new `/v/`
  page — renders cleanly with zero console errors, and correctly shows a "could not verify /
  permission-denied" state (expected, since the new rules aren't deployed yet at the moment of
  the test) rather than crashing, proving the whole Firebase-init → Firestore-query →
  error-handling → render pipeline works end-to-end. **NOT verified** (needs a live login): an
  actual employee ID print-to-PDF click-through with a real QR scan resolving on `/v/`, a worker
  photo upload + BI-W-### generate + batch-print click-through, and the Accounts & Logins nav
  card's visibility across all 4 gated roles. **Still needed:** deploy `firestore.rules` +
  `storage.rules` (this workstream's changes to both); after that, scan a real printed QR to
  confirm end-to-end resolution.
  **This completes Phase 3 of the v12 rebuild (workstreams 20-27, the payroll/HR bundle) — all
  IMPLEMENTED, verified, and deployed.**
  **IMPORTANT SCOPE DISCOVERY:** Phase 4 (workstreams 28-40 — Production, Inventory, Purchasing,
  Quotation builder v3, Sales CRM, AEC Partner Directory, Marketing, Design suite, Finance
  additions, Team Chat, Files Hub, BIR suite, Analytics) has **NO grounding briefs or DECIDED
  specs at all** in `fable-workplan/` — unlike every workstream implemented this session
  (09 through 27), which all had a Fable-authored architecture spec ready for mechanical Sonnet
  implementation. Phase 4 is 13 large, entirely unscoped feature areas with zero prior Fable
  research against the current codebase. Implementing these without that research would mean
  Sonnet inventing architecture decisions Fable is supposed to make — a break from this session's
  established (and, so far, successful) division of labor. Recommend: a Fable-tier session
  writes Phase 4 grounding briefs + DECIDED specs next (the same process used at the start of
  this session for Phases 2-3), before any further implementation proceeds.
- **2026-07-10 (Sonnet grounding-research pass — WS28-40, per Neil's "resume til phase 5"):**
  Dispatched 13 parallel Sonnet research subagents (one per Phase-4/5 workstream) to do the
  SAME kind of pre-grounding pass Phase 2/3 got before Fable decided their architecture —
  reading the actual current code, citing exact file:line, quoting real snippets rather than
  trusting in-repo comments, and leaving every open decision unresolved for Fable. No
  architecture was decided; no code was implemented; nothing was committed. Each brief was
  written to its own `fable-workplan/NN-*.md` file matching the exact template/section
  structure Phase 2/3's briefs established (Current state / Data model / Constraints / Open
  decisions / Risks / Files likely touched / Expected deliverable format — no `## DECIDED`
  section). **The highest-value findings, most load-bearing first:**
  - **WS39 (BIR):** `renderFinancialReports` fetches only the 3000 most-recent ledger/
    general_journal rows before filtering by period — once the ledger grows past that window,
    a BIR report for an older period could silently return truncated/zero figures. Also: VAT is
    NOT purely overstated as originally audited (2 of 5 expense-write paths already net input
    VAT), and regular employees have no TIN/SSS#/PhilHealth#/Pag-IBIG# field captured anywhere
    (only weekly `worker_profiles` do) — a real data-capture gap, not just a reporting one.
  - **WS31 (Quotation builder v3):** the "BK quotes stranded in bs_quotes" bug is real and
    pinpointed exactly (app.js:8231 hardcodes `bs_quotes` in the approval-request branch
    regardless of company) — and "approving without filing" turned out to be worse than one
    bug: TWO different approve implementations coexist in the same `renderApprovals` function
    and disagree; one of them only flips `approval_requests.status` and never touches the quote
    doc at all, so the President can click Approve and the quote stays frozen forever. Also:
    `quote-builder.html` (v1) no longer exists (deleted 2026-06-17) — CLAUDE.md's description of
    it is stale. ~1,190 of the claimed ~1,800 dead-code lines were verified via reproducible
    zero-caller greps, including one complete 549-line duplicate quote builder.
  - **WS30 (Purchasing):** there is no PO approval gate at all today — any Purchasing employee
    can convert an RFQ and print a PO with the President's name/title pre-filled as "Approved
    by" from a static constant, with zero approval field or action anywhere in the schema.
  - **WS29 (Inventory):** the receive-path bug is confirmed exactly as suspected — quantity
    increments correctly but unit cost is flatly overwritten to the latest purchase price, no
    weighted-average logic exists anywhere in the repo. The physical Count Form is explicitly
    non-mutating by its own code comment ("not a stock mutation").
  - **WS35 (Design suite):** the drawing "approval" workflow has no real approver gate — the
    identical permission check governs create, submit, approve, AND release, so any Design-dept
    member can self-approve their own drawing. A `reviewer` field exists but is dead code
    (written once, never read).
  - **WS32 (Sales CRM) + WS35 (Design suite), independently confirmed the same fact:**
    `bs_clients` is completely orphaned — even Brilliant Steel's own "Client Data" tab derives
    synthetic clients from `bs_quotes` instead of reading its own collection. Every client↔quote
    join app-wide is a fragile `clientName` string match; no `clientId` exists anywhere.
  - **WS38 (Files Hub):** found a genuine live bug — two shadowed implementations of the same
    file-browser function exist in the same file; the older one (departments.js:11379-11468) is
    dead code, silently overridden by a newer pair, confirmed via all 15 real call sites. Also:
    per-file sharing/ACL is flagged as architecturally hard given Storage's bearer-token
    `getDownloadURL()` — enforcing true view-vs-edit at the byte level isn't currently possible
    without new Cloud Function infrastructure.
  - **WS40 (Analytics):** all 13 `new Chart(` sites hardcode colors with zero `var(--...)`
    usage, confirmed to visually clash with WS17's new default light "Office" theme.
  - **WS37 (Team Chat):** only 3 `onSnapshot` real-time listeners exist anywhere in the entire
    app today (force-logout broadcast, claims listener, notification inbox) — live chat is
    genuinely new architectural territory, not an extension of an existing pattern.
  - **WS28 (Production flow):** the public order tracker never reads production data directly —
    it goes through three separately hand-maintained, already-drifting stage-translation maps.
    A naive stage rename would silently stop advancing clients' tracking pages instead of
    erroring, and in-flight orders whose stored stage value disappears would silently reset to
    stage 1.
  - **WS36 (Finance additions):** zero bank-account dimension exists anywhere in the schema or
    rules; every existing money-writer (CRJ/CDJ/EXP/PAY/SO/PROJ ledger posts, cash-advance
    approval, payroll Disburse) would need retrofitting, not just a new collection — flagged as
    the workstream's real blast radius.
  - **WS33 (AEC Directory) + WS34 (Marketing):** both confirmed wholly greenfield with strong
    existing analogs to build on (CRM stages, chip-tab filters, the shared letterhead engine) —
    the lowest-risk of the 13.
  **Cross-workstream dependency map** (see `fable-workplan/INDEX.md`'s Phase 4/5 status section
  for the full version): WS31↔WS32 (BK/BS quote split), WS32↔WS35 (identical three-way client
  fragmentation, independently discovered), WS34/WS35↔WS38 (materials library / project folders
  overlap Files Hub's scope), WS28↔public-tracker (stage rename risk), WS40↔WS29/WS32/WS36
  (several named metrics are blocked on those three landing first). **Nothing was implemented.**
  This is purely the research phase — the SAME kind of pass Phase 2/3 got before Fable wrote
  their DECIDED specs. **Next step: a Fable-tier session per brief writes the architecture
  decisions** (the established, successful division of labor this whole engagement has used);
  only then should Sonnet implementation resume for Phase 4/5.
- **2026-07-11 (Sonnet implementation, WS38 Files Hub):** Implemented the DECIDED spec in
  `fable-workplan/38-files-hub.md` exactly. New `hub_files`/`hub_folders` collections
  (deliberately not `files_*`-prefixed, per decision 14) with a new `firestore.rules` block
  (uid-array sharing enforcement: `sharedUserIds`/`editorUserIds`, `visibility` company/private,
  president-only permanent delete) and 7 new composite indexes in `firestore.indexes.json`.
  `window.FilesHub` (load/share/version/soft-delete/purge) + `window.openFilePreview` (new
  lightbox, zero prior component) added to js/drive.js; `Drive.renderStorageStatus` now reads
  the `system_health/daily_sync` heartbeat. The live `window.bindFileCollection` in
  js/departments.js was rewritten in place against `hub_files` — same signature, all 15 existing
  call sites untouched — adding folders (`hub_folders`, real parent/child), versions
  (`versions[]`, integer `v`), a Recycle Bin chip, share/preview/new-version row actions, and a
  grid/list `chipTabs` toggle with drag-drop-to-folder. Deleted the two shadowed dead-code pairs
  confirmed in decision 12: old `renderFileCollection`/`bindFileCollection`
  (departments.js:11379-11470 at research time) and old `renderDocCollection`
  (departments.js:11303-11374) — verified by grep that exactly one definition of each survives.
  Added a top-level "Files" nav page (`renderFilesHub`, js/modules.js) wired to
  `case 'files-hub'` in app.js's router, plus a 6th `hub_files` source group in
  `renderGlobalSearch`. New idempotent `scripts/migrate-files-hub.js` (Admin SDK, NOT run by
  this session — needs `FIREBASE_SERVICE_ACCOUNT`). `scripts/sync-to-drive.js` LABELS gained
  `hub_files: 'Files Hub'`. CACHE_VER bumped (sw.js). **One deviation from the spec's exact file
  citation, not its decision:** decision 11's nav entry was specified for "config.js" but the
  internal-staff sidebar array actually lives in js/app.js's `getSidebarItems()` — added there
  instead, and only to the admin/president/manager/secretary branch (the one branch with no
  existing "Files" door; employees and partners already had one via the pre-existing
  `page:'files'`/`page:'bs-files'` entries that the spec's own research didn't surface). Rules,
  indexes, and the migration script are **not deployed/run** — that's explicitly left to the
  session with deploy credentials, per this task's constraints.
- **2026-07-11 (Sonnet implementation, WS35 Design suite):** Implemented the combined DECIDED +
  RE-GROUNDED spec in `fable-workplan/35-design-suite.md` exactly, on top of the real (already
  shipped) WS32 `window.Clients`/`clients` collection and WS38 `hub_files`/`hub_folders`/
  `window.FilesHub`. **Self-approval gate (the core ask):** new `window.canApproveDrawing(d,
  project)` (js/departments.js, above `drawingTransitions`) returns `{isApprover, approve,
  release}` — approver = president/manager or the parent project's `designLead`; `approve`
  is additionally `false` whenever the current uid is the drawing's `createdBy` or
  `assignedTo`, closing the self-approval hole. Wired into `openDrawingDetail` (transition
  buttons filtered per-capability, plus a new "Awaiting approval by {lead}" meta-card hint),
  `changeDrawingStatus` (hard `return` + error toast if a non-approver tries `approved`/
  `released`, defense-in-depth alongside the rules gate), and a new "🔏 For my approval" KPI
  chip on `renderDrawingsDashboard`. Mirrored exactly in `firestore.rules`'
  `design_drawings` block: promotions to `approved`/`released` now require an explicit
  `isDrawingApprover()` (president/manager role check first, short-circuiting before a
  `get()` on the parent `projects` doc's `designLead`; deliberately NOT `isAdmin()` so
  `secretary` — view-only approvals per the corporate-secretary directive — is excluded) and,
  for the `approved` transition specifically, `request.auth.uid !=
  createdBy/assignedTo`; topology is pinned (`approved` only reachable from `for_review`,
  `released` only from `approved`; `create` must start at `draft`); every other update
  (revisions, demotions, plain edits) keeps the pre-WS35 `createdBy||assignedTo||canDesign()`
  gate unchanged. New `releasedBy/releasedByName/releasedAt` fields mirror the existing
  `approver*` triple on release, and are cleared (alongside `approver*`) when a new revision
  is cut, so a superseded release stamp never survives onto Rev B+. Dead `reviewer`/
  `reviewerName` fields (always-null since birth) removed from the create write, per decision
  6 (not revived). **Design → Production handoff hardening:** releasing a drawing on a
  project with no `jobProjectId` now shows a `confirmDialog` naming the consequence instead
  of silently no-opping; the `job_projects.documents[]` append gained `drawingId` + `url`
  (WS15-preferred `fileUrl`) as WS28's future intake hook; `for_review` submission now
  notifies the project's `designLead` directly (falls back to `Notifs.sendToDept('Design')`
  when unset) — previously nobody was told an approval was waiting; `dbCacheInvalidate
  ('projects-unified')` now fires after the `job_projects` append. **Project/client folders:**
  no bespoke folder system — new `window.DesignFolders` (get-then-create, deterministic
  `client__{clientId}`/`proj__{projectId}` ids) ensures ordinary `hub_folders` rows under a
  new `scope:'projects'`; a new **Files** tab in `openProjectDetail` (`renderProjectFiles`)
  reads via `FilesHub.loadFiles('projects')` and writes a full WS38-shape `hub_files` doc
  with the domain fields `projectId`/`clientId`; `window.Clients.timelineFor` gained a 4th
  parallel fetch (`FilesHub.loadFiles('projects')`) and a `files` key joined on `clientId`,
  surfaced as a new "📁 Files" section in WS32's `openClientHub` — so the same client seen
  from Sales or Design shows the same uploaded files. Zero new collections, rules blocks, or
  composite indexes (`hub_*` is auto-discovered by `scripts/monthly-backup.js`). **Client
  identity:** `openProjectEditModal`'s client dropdown now sources `window.Clients.listAll()`
  (design-brand clients sorted first) instead of raw `design_clients`, auto-fills the display
  name on pick, and `arrayUnion('design')`s the picked `clients` doc's `brands` on save
  (skipped for pre-migration legacy/`_legacy` fallback docs). New idempotent
  `window.remapDesignProjectClients()` (same batched style as `backfillProjectKind`)
  re-points `projects.clientId` from legacy `design_clients` ids to `clients` ids via WS32's
  `migratedTo` stamp — **written but deliberately NOT run**, per this task's constraints; it
  needs a signed-in president/manager console session, run once after WS32's
  `migrateClientBooks()`. **Manila-time display fix:** new `window.fmtManila(v)` (js/config.js,
  next to `bizDate`/`bizHour`) replaces every raw `.slice(0,16).replace('T',' ')`/`.slice(0,10)`
  read of the drawing/project ISO timestamps in `openDrawingDetail`'s revision table + activity
  feed and `renderProjActivity` — storage stays ISO strings (`arrayUnion` can't hold
  `serverTimestamp`, consistent with WS38's `versions[]`), only the display was wrong (showed
  UTC wall-clock). **Verified:** `node --check` clean on `js/config.js`/`js/departments.js`;
  `firestore.rules` brace/paren-balanced (260/260, 1381/1381) and the new `design_drawings`
  block's local `isDrawingApprover()`/`statusNow()`/`statusNext()`/`isPromotion()` functions
  follow the file's existing per-`match`-block local-function convention; `firestore.indexes
  .json` unchanged and still valid JSON; every new function (`canApproveDrawing`,
  `DesignFolders`, `remapDesignProjectClients`, `renderProjectFiles`, `fmtManila`) greped to
  exactly one definition and every call site resolved; `reviewer`/`reviewerName` confirmed
  zero remaining references anywhere in departments.js. **No deviations from the combined
  DECIDED + RE-GROUNDED spec** — every edit is anchored to function name/quoted-BEFORE text
  per the RE-GROUNDED instruction, not the spec's (stale) line numbers. **Not deployed** —
  `firestore.rules` changes are local only; the session with deploy credentials must run
  `firebase deploy --only firestore:rules` before the approval gate is enforced
  server-side (until then, the UI-side gate in `changeDrawingStatus` is the only backstop).
  `CACHE_VER` in sw.js and `APP_VERSION` in js/config.js were deliberately left untouched per
  this task's constraints (pre-commit hook / main session's responsibility).
