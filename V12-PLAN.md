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
12. `[ ]` **Period engine + period close** — ONE shared period filter (kills the 3 divergent
    YTD implementations); picker for any month/quarter/year; close-period lock; fix
    `orderBy('date')` dropping date-less rows (records-forever guarantee).
13. `[ ]` **Chart of accounts** — account-type on ledger rows (income/expense/asset/liability/
    equity); unlocks trial balance, balance sheet; fixes **double material expensing**
    (purchase→Inventory asset; consumption→COS, the single expense event).
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
19. `[ ]` **Security closes** — partner lockdown (files_* metadata, budgets_* world-write,
    users/tasks/posts reads); attendance self-write forgery; secretary rules limited to true
    minor-approvals tier; worker-login username lookup unblocked (needed for w/ IDs).

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
