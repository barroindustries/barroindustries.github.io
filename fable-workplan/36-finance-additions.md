# Workstream 36 — Finance additions (bank accounts registry, downpayment billing invoice)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

All line numbers below were re-verified live via grep/Read against the current checkout (branch `auto/daily-review-2026-07-09`) this session — not copied from V12-PLAN.md's one-paragraph mandate, which is the only prior spec for this workstream (no earlier `fable-workplan/36-*.md` exists).

1) **THE LEDGER HAS NO ACCOUNT (BANK) DIMENSION OF ANY KIND — CONFIRMED BY GREP.** Every `ledger` write site was enumerated (`grep -n "collection('ledger')" js/*.js` → 30+ call sites) and every write literal was read: `postExpenseToLedger` (departments.js:1434-1455, ref `EXP-{id}`), `postCRJToLedger` (departments.js:1460-1482, ref `CRJ-{id}`), `postCDJToLedger` (departments.js:1491-1521, ref `CDJ-{id}`), `resyncLedgerForSource` (departments.js:1527-1569, the edit-time re-mirror for all three), the payroll Compute per-employee/aggregate legs (departments.js:2590-2619, refs `PAY-{month}-{uid}`, `PAY-{month}-{uid}-ER`, `SSSPAY-{month}` etc.), the Sales Order credit (departments.js:9549, ref `SO-{id}`), and the Project Billing credit (departments.js:12293, ref `PROJ-{id}-{n}`). Every one of these writes the same field family: `date, type('debit'|'credit'), accountType('income'|'expense'|'asset'|'liability'), account(string), description, amount, category, refNumber, source, addedBy, addedByName, createdAt`, plus income-side rows carrying `net/vatAmount/vatTreatment`. **`grep -ni "bank" js/*.js firestore.rules` returns zero hits in firestore.rules and, in the JS files, only: the `banknote` Lucide icon name (config.js:181, used for the Cash-Advance nav icon), a free-text `paymentMethod`/`Method` `<select>` whose options are literal strings `'Bank Transfer'|'GCash'|'Cash'|'Cheque'|'Other'` (departments.js:9316, 9488, 12253, 7046) stored verbatim as a string on `sales_orders`/`job_projects.payments[]`/manual ledger entries — never a foreign key to any account record — and one free-text `bankDetails` textarea inside quote-builder-v2.html (covered in point 4 below).** There is no `accountId`, no `bankAccount`, no running per-account balance, and no reconciliation flag anywhere in this codebase. Whatever cash account a payment actually hit (BDO checking, GCash wallet, petty cash box) is not recorded structurally today — only as a free-text label on the payment method dropdown, if that.

2) **`account` ALREADY MEANS SOMETHING ELSE HERE — A NAMING COLLISION FABLE MUST AVOID.** Workstream 13 (Chart of Accounts, ✅ implemented — see `fable-workplan/13-coa.md`) added `accountType: 'income'|'expense'|'asset'|'liability'|'equity'` and `account: string` (a canonical P&L/balance-sheet line name like `'Sales Revenue'`, `'COS – Direct Material'`, `'Inventory'`, sourced from a static `window.COA` in js/config.js) to every `ledger` row. This is a *chart-of-accounts* dimension — which bucket the money is categorized under — and is structurally unrelated to a *bank account* dimension — which physical cash/bank balance the money moved through. A new `bank_accounts` registry must NOT reuse the field name `account` (already load-bearing on every ledger row since WS13) or the P&L reports at departments.js:2881-2969 and app.js:2278-2284/6359-6364 (which filter/sum by `ledger.account`/`accountType`) will silently misbehave. Recommend `bankAccountId`/`bankAccount` as the field name; this is flagged here as a fact to avoid, not decided.

3) **THE SALES-ORDER "DOWNPAYMENT" TODAY IS A SINGLE LUMP SUM, RECORDABLE EXACTLY ONCE, WITH NO PERCENTAGE CONCEPT — CONFIRMED BY GREP.** `grep -ni "downpayment\|down payment\|dpPercent\|dpAmount" js/departments.js js/app.js` (excluding quote-builder-v2.html, see point 4) returns: two SOP/checklist prose strings (departments.js:5946-5971, "Client Confirmation & Down Payment" step), a UI placeholder hint `placeholder="e.g. downpayment"` on the "Payment Received" input in `openSalesOrderModal` (departments.js:9306-9342, specifically line 9313), and a code comment at 9349 ("client order-tracking link — created once the downpayment is captured"). **There is no `dpPercent`, `dpAmount`, or any percentage-of-contract field anywhere on `sales_orders` or `job_projects` — the "downpayment" is purely an assumption about what a human typed into a generic "Payment Received" number field.** `sales_orders/{id}` (departments.js:9334-9342) is created with `contractAmount, paymentReceived, paymentMethod, notes, receiptUrl, status:'pending'` — one amount, one method, no schedule. Recording it (`openRecordSaleModal` → its save handler, departments.js:9467-9578) posts a ledger credit keyed **`SO-{id}`** and — critically — the dupe-check at departments.js:9544-9545 ("This sales order was already recorded.") makes this a **one-shot, non-repeatable** action: once `status:'recorded'`, the "Record Sale" button is not even rendered again (departments.js:9420 only shows it `if(o.status!=='recorded')`). **There is no code path to record a SECOND payment against the same `sales_orders` doc — a genuine downpayment-then-balance flow is structurally impossible on `sales_orders` as it exists today.**

4) **A REAL MULTI-PAYMENT DOWNPAYMENT/PROGRESS/BALANCE CONCEPT ALREADY EXISTS — BUT ON `job_projects`, NOT `sales_orders`.** `openProjectBillingModal(p)` (departments.js:12238-12308, "💵 Record Payment", reached from the Project detail modal's `proj-bill-btn`, departments.js:12149/12155) has a `<select id="pb-type">` with exactly the options `Downpayment / Progress Billing / Final Balance` (departments.js:12243) plus a VAT-treatment select and amount field. On save, it posts a ledger credit keyed **`PROJ-{projectId}-{n}`** where `n = p.payments?.length||0` (departments.js:12290 — an array-length-derived idempotency key, not a counter transaction; the code comment at 12286 explicitly says "payments are legitimately multiple", confirming multi-payment IS the intended model here, unlike `sales_orders`), then `arrayUnion`s a `{type, amount, vatAmount, net, method, orRef, receiptUrl, date, by, ledgerId}` record onto `job_projects.payments[]` and updates `amountCollected`/`arBalance` (departments.js:12295-12302). **No field on any payment record or on `job_projects` itself stores a downpayment PERCENTAGE — `type:'Downpayment'` is just a free-text label on whichever payment happened to be entered first; nothing computes or remembers "this project's DP is 40% of contract."**

5) **A GENERIC "BILLING INVOICE" DOCUMENT ALREADY EXISTS FOR `job_projects` — LETTERHEAD-DRIVEN, BUT NOT DP-SPECIFIC.** `openJobBillingInvoiceModal(p)` (departments.js:12313-12375, reached from `proj-invoice-btn`) collects Bill To / Invoice Date / Due Date / Particulars / Amount-to-Collect / Notes, mints an invoice number as `'INV-'+today().replace(/-/g,'')+'-'+String(seq).padStart(3,'0')` (departments.js:12337, `seq` = `(p.invoices||[]).length+1` — NOT the atomic `_counters` transaction pattern used elsewhere, see point 9), and appends it to `job_projects.invoices[]` inside a `db.runTransaction` (departments.js:12356-12367, so concurrent invoice creation can't clobber the array). `window.openBillingInvoice(p, inv)` (departments.js:7646-7652) opens a new window and calls `buildBillingInvoiceHTML(p, inv)` (departments.js:7654-onward), which **already calls `window.buildLetterhead(...)`** (departments.js:7659-7669, `docTitle:'BILLING INVOICE'`, `entity: brandEntity('bir')`) with a graceful `_lh ? ... : <hardcoded fallback header>` pattern, renders an "Account Summary" table (Total Contract / Less Payments to Date / Outstanding Balance) and a "This Invoice" table (Particulars / Amount / AMOUNT DUE / remaining balance after settlement), and a free-text Notes box whose default text is `"Kindly settle the amount due on or before the due date. Payable to NEILBARRO STEEL & METAL FABRICATION SERVICES."` (departments.js:12326). **This invoice has NO explicit DP-percent-of-contract line, NO forward-looking balance SCHEDULE (only "amount due now" + "remaining balance after this invoice" — no future installment/stagger dates), and NO structured bank-instructions block** — payment details are whatever free text HR/Sales types into the Notes textarea, not a dedicated field. It is a real, live, letterhead-integrated invoice generator for progress/downpayment/final billing against `job_projects` — the workstream 36 mandate's "downpayment billing invoice document" is much closer to *extending this existing function* than building one from scratch.

6) **A DOWNPAYMENT-PERCENT + BALANCE-SCHEDULE COMPUTATION ALREADY EXISTS — BUT IT IS PURELY A QUOTE-PRINT FEATURE, CONFIRMED NEVER WIRED PAST THE QUOTE.** quote-builder-v2.html (the live BK/BS quote tool, embedded via `renderQuoteBuilderIframe()`) has a full "Payment Terms & Schedule" section (quote-builder-v2.html:768-804): a `<select id="dpMode">` of `10/15/20/30/40/50/60%` or `custom` (₱), and a `<select id="balMode">` of `lump | stagger3/4/5 | install3/6/9/12` (with an interest-rate field for installments). `getDpAmount(grand)` (quote-builder-v2.html:1815-1819) and `renderPaymentSchedule(grand)` (1821-1878) compute and PRINT a full schedule — including, for staggered/installment balances, per-payment amounts and estimated due DATES derived from `overallLead`/`projStart` (1836-1872, e.g. `"Progress payment 1 of 3 — due Sep 12, 2026"`). There is also a free-text `<textarea id="bankDetails">` (quote-builder-v2.html:772-804 region, rendered at 1912-1925 as `"Payment / Bank Details:"` under Remarks). **`buildQuotePayload()` (quote-builder-v2.html:2544-2617) DOES save `payment:{downPaymentMode, downPayment, balance, balanceMode, interestRate}` and `bankDetails` onto the filed `bk_quotes`/`bs_quotes` doc** (bridged through app.js's `window.addEventListener('message', ...)` handler, app.js:8132-8180, specifically `bankDetails: payload.bankDetails||''` at 8166 and `payment: payload.payment||null` at 8170). **CONFIRMED BY READING `openSalesOrderModal`'s call sites: it is invoked as `openSalesOrderModal(e.currentTarget.dataset, ...)`** (departments.js:6620, 9650) — `e.currentTarget.dataset` is an HTML `data-*` attribute bag, which by construction cannot carry the nested `payment` object or the `bankDetails` string off a Firestore quote doc. **This schedule/bank-details data dies inside the filed quote — it is never read again once a Sales Order or Project is created.** `createJobProject(d)` (departments.js:12014-12040) likewise does not copy `bankDetails` or any `payment.*` field onto the new `job_projects` doc. Anything Fable specs for a "DP % of contract, balance schedule, bank instructions" invoice has to be built fresh against `job_projects`/`sales_orders` — it cannot simply "surface" data that secretly already exists downstream, because none of this data exists downstream.

7) **A THIRD, OLDER, DEAD in-app Brilliant-Steel quote builder also computed a DP% — orphaned, do not use as a model.** `renderBSQuoteBuilder` (departments.js:8560-onward) is a full quotation UI embedded directly in departments.js (not the iframe), with its own `DP %: <input id="bs-dp-pct-input" value="65">` and payment-terms boilerplate ("65% downpayment required before production. Balance due upon delivery.", departments.js:8742/8759/8771). **`grep -n "renderBSQuoteBuilder(" js/*.js` returns exactly one hit — its own function definition** — it has zero callers. `loadBSContent`'s `'Quote Builder'` case (departments.js:8384) calls `navigateTo('bs-quote-builder')`, which the app.js router (app.js:2007) resolves to `renderQuoteBuilderIframe()`, i.e. the live quote-builder-v2.html iframe from point 6 — NOT `renderBSQuoteBuilder`. This older function is confirmed dead code, superseded, and should not inform Fable's design.

8) **CROSS-CHECK: EVERY OTHER MONEY-MOVING WRITER IN THE APP ALSO LACKS AN ACCOUNT DIMENSION — CONFIRMED BY GREP, ONE BY ONE.** Cash Advance request (`window.CashAdvance.request`, config.js:945-966) writes `userId, employeeId, amount, terms, interest, monthlyPayment, balance, status, payments:[], date, reason` — no method/account field. Cash Advance approval (`window.CashAdvance.approve`, config.js:1008-1034, a `runTransaction`) writes `status, interest, totalPayable, monthlyPayment, balance, approvedBy, approvedAt` — again no method/account field; there is no separate "disburse the cash" step recorded anywhere with a channel. Payroll Disburse (`window.disbursePayRun`, departments.js:2512-2644, the President-only `pay_runs` state transition `verified→disbursed`, triggered by the `pr-disburse-btn` click handler at departments.js:3187-3203) drives the ledger-posting loop at departments.js:2560-2628 (`PAY-{month}-{uid}` debits, `SSSPAY-/PHPAY-/HDMFPAY-/WHTPAY-/NETPAY-{month}` aggregate credit legs) — every leg is `{date, type, accountType, account, description, amount, category, source, refNumber, addedBy, addedByName, createdAt}`, no bank/cash-account field. `recordPurchaseDisbursement` (departments.js:13547-13633, posts to `cash_disbursement_journal` then mirrors via `postCDJToLedger`) has **no payment-method field at all** — re-read in full, its only account-flavored input is `<select id="rec-acct">` (departments.js:13558-13563, options `inventory|material|ap|sundry`, written to the doc as `debitAccount`), which is the WS13 chart-of-accounts debit-side choice (asset vs. expense vs. A/P), not a cash/bank-account or payment-method choice — a second, independent instance of the "account" naming collision flagged in point 2. **This is the single most important fact in this brief: a `bank_accounts` registry is not a narrow addition next to the ledger — it is a dimension currently absent from EVERY cash-moving writer in the system** (ledger CRJ-/CDJ-/EXP-/PAY-/SO-/PROJ-/POCOS- posts, `cash_advances` approve/repay, `pay_runs` Disburse, `sales_orders`/`job_projects` payment records). See "Risks" for why this matters for scoping.

9) **THE ATOMIC-COUNTER PRECEDENT EXISTS BUT THE EXISTING INVOICE NUMBERING DOESN'T USE IT.** `window.nextSerial(counterKey, prefix)` (js/letterhead.js:113-122, shipped with WS14) does `db.collection('_counters').doc(counterKey)` inside a `runTransaction`, returning e.g. `INV-2026-000123` — its own comment says **"Not called by WS14 conversions"**, i.e. it was added as available infrastructure but nothing calls it yet. The live Billing Invoice (`openJobBillingInvoiceModal`, point 5) instead mints its number from `(p.invoices||[]).length+1`, a per-project sequence, not a global one — both patterns coexist in the repo today; Fable must pick one for a new DP-invoice document number.

10) **THE LETTERHEAD ENGINE'S REAL API (WS14, ✅ implemented) — read in full from js/letterhead.js.** `window.buildLetterhead(opts)` (letterhead.js:22-109) is a pure function (no DOM writes, no Firestore reads) taking `{docTitle, entity, accent, showLogo, logo, docNumber, dateLabel, extraMeta:[], signatures:[{label,name,title}], footerNote}` and returning `{headerHTML, footerHTML, printCSS}` — three inlinable strings the caller concatenates into its own `<style>${printCSS}${docSpecificCSS}</style>...${headerHTML}...<own tables/sections>...${footerHTML}` inside a `window.open('','_blank')` + `document.write()` document (same pattern used by every printable in this app — payslip, PO, inventory count form, billing invoice; there is no server-side PDF rendering anywhere). `entity` defaults to `window.brandEntity('corporate')` (config.js:897-905) if not passed; callers pass `brandEntity('bir')` for BIR-facing docs (payslip, billing invoice) to get the DTI trade name + real TIN instead of the OPC/marketing name. **`buildLetterhead` does NOT render any line-item table, does NOT render any payment/bank-instructions block, and does NOT handle document numbering** — every one of its 4 current callers (Payslip departments.js:5293-5294; Billing Invoice departments.js:7659-7669; Inventory Count Form departments.js:12913-12922; Purchase Order departments.js:13656-13666) builds its own `<table>` rows and its own Notes/instructions markup by hand, in each function's own HTML-template string, and escapes every interpolated value itself (`escHtml`/the local `e()`/`esc()` alias). **A new downpayment-invoice document is 100% new surface area for the line-item/schedule table and the bank-instructions block — the letterhead engine only supplies the header/footer/signature chrome and the shared print CSS (`.lh-*` classes, `@page` rules, print-fragmentation rules), exactly as it does for the four existing document types.** Script load order (index.html:302-323, re-verified live) is `firebase-config.js → config.js → qrcode.js → statutory-tables.js → letterhead.js → ... → drive.js → notifications.js → departments.js → app.js → modules.js` — `letterhead.js` loads immediately after `config.js` and BEFORE every one of its callers, so `window.buildLetterhead`/`window.brandEntity`/`window.BRAND` are unconditionally available to any new code in departments.js/app.js/modules.js (no defensive `typeof` guard needed, unlike e.g. `getPHHolidays` per WS26's brief).

11) **THE "TWO PROJECT COLLECTIONS" MEMORY ITEM, LOCATED.** `job_projects` (the sales→production→delivery→paid spine this workstream would extend, created by `createJobProject`, departments.js:12014-12040) is a completely separate top-level collection from `projects` (the Design department's own board, read read-only inside `renderProjectLifecycle` via `window.Projects.normalize(d,'design')`, departments.js:12051-12055). They are not merged and carry independent `contractAmount`/`amountCollected`/`arBalance` shapes. This is tangential to workstream 36 (a DP invoice would attach to `job_projects`, not the Design `projects` board) but is noted per the finance-reporting-open-items memory so Fable doesn't conflate the two if a query needs "every project."

12) **THE FINANCE-DELETE-APPROVAL PRECEDENT (for the "who can touch bank_accounts" question).** `window.financeDelete`/`window.financeExecuteDelete` (departments.js:190-233-ish) already establish the pattern used throughout Finance: any finance-tier user may create/edit records freely, but a DELETE routes through `finance_delete_requests` (firestore.rules:900-907: `create: canFinance()`, `update/delete: isPresident()` only) for President approval, with `financeDeleteCascade` (departments.js:141-186) reversing the mirrored ledger row and any CA-balance side-effects. Role-check helpers, for reference (firestore.rules:21-43): `isAdmin()` = president/manager/secretary; `isFinanceOrAdmin()` = + finance; `isMoneyAdmin()` = president/manager/finance (secretary excluded — the WS19 "money-tier" narrowing already applied to `payroll`, `pay_runs`, `cash_advances` create); `canFinance()` = `isMoneyAdmin() || isFinanceDept()`; `isPresident()` = president only.

13) **BACKUP COVERAGE IS AUTO-DISCOVERED, NOT HAND-LISTED — CORRECTING A STALE ASSUMPTION.** `scripts/monthly-backup.js:108-158` was refactored (its own comment, lines 108-112: *"Any root collection NOT listed here is auto-discovered (`db.listCollections()`) and exported as a COMPLETE full-document JSON snapshot — no hand-registration, so new collections ... are covered automatically and this file never drifts again."*) — this supersedes the older explicit-list model that e.g. `fable-workplan/25-leave.md` describes for `leave_balances`. A new `bank_accounts` collection would be **backed up automatically with zero code change** (full JSON snapshot, no date filter, no CSV) the moment it's created; it would only need an entry in the `OVERRIDES` map (monthly-backup.js:118-158) if Fable wants a `dateField` filter or a `csvFields` CSV export alongside the JSON. Only `EXCLUDE = new Set(['presence','sessions','notifications'])` (monthly-backup.js:162) is skipped entirely.

## Data model

**`ledger/{docId}`** (top-level, no enforced schema; WS13 already added the `accountType`/`account` chart-of-accounts pair — see point 2 above, do not reuse these names for bank accounts): `{ date:'YYYY-MM-DD'|'YYYY-MM-01', type:'credit'|'debit', accountType:'income'|'expense'|'asset'|'liability', account:string(COA line name), description:string, amount:number, category:string, refNumber:string(idempotency key; prefixes EXP-/CRJ-/CDJ-/PAY-<month>-<uid>[-ER]/WPAY-/SO-/DPROJ-/PROJ-/POCOS-/SSSPAY-<month> etc.), source:string, addedBy?:uid, addedByName:string, createdAt:serverTimestamp, net?:number, vatAmount?:number, vatTreatment?:'inclusive'|'exclusive'|'exempt', projectId?:string, inputVat?:number }`. Rules (firestore.rules:807-841): `read: canFinance()`; `create: canFinance() || (canProduction() && <hard-coded POCOS-only shape check>)`; `update: canFinance()`; `delete: isPresident()`.

**`sales_orders/{docId}`** (top-level; created once per won quote, departments.js:9334-9342): `{ projectId, quoteId, quoteNumber, clientName, company:'BK'|'BS', project(scope text), contractAmount:number, paymentReceived:number(one-shot, "e.g. downpayment" per its own UI hint), paymentMethod:string(free-text dropdown value), notes:string, receiptUrl?, receiptName?, status:'pending'|'recorded', recordedAmount?:number, recordedAt?, recordedBy?, createdBy, createdByName, createdAt, trackingToken?, sentToProduction?:bool, sentToProductionAt? }`. Rules (firestore.rules:1020-1032): `read: own-if-partner else any-non-partner`; `create: createdBy==self`; `update: canFinance()`; `delete: isPresident()`. **No DP-percent field, no schedule, no second-payment path exist on this shape** (point 3 above).

**`job_projects/{docId}`** (top-level; the real multi-payment spine, created by `createJobProject`, departments.js:12025-12037): `{ projectNo:'JP-YYMM-###', company, name, clientName, stage:'won'|'in_production'|'for_delivery'|'delivered'|'completed'|'paid'|'cancelled', quoteId, quoteNumber, quoteCollection, contractAmount:number, amountCollected:number, arBalance:number, vatRate:12, capital:number, partnerUid?, split:{isShared,barroPct,partnerPct}, documents:[{type,ref,at,by}], timeline:[{at,event,by}], payments:[{type:'Downpayment'|'Progress Billing'|'Final Balance', amount, vatAmount, net, method, orRef, receiptUrl, date, by, ledgerId}], invoices:[{no,date,due,billTo,desc,amount,notes,contractAmount,paidToDate,balanceBefore,projectName,projectNo,issuedBy,createdAt}], productionOrderIds:[], trackingToken?, createdBy, createdByName, createdAt, updatedAt }`. Rules (firestore.rules:1036-1043): `read: own-or-shared-partner else any-non-partner`; `create: createdBy==self`; `update: own-partner-only-if-own else any-non-partner (i.e. any internal staff, not gated to finance!)`; `delete: isAdmin()`. **Note the `update` rule is NOT finance-gated at the Firestore level — it's UI-gated only** (`_isFinAdmin()` checked client-side before rendering the "Record Payment"/"Billing Invoice" buttons, departments.js:12011/12149-12150); any new bank-account-tagged field written onto `job_projects.payments[]` inherits this same (client-gated-only) write surface unless Fable tightens the rule.

**`bk_quotes`/`bs_quotes/{docId}`** (top-level, filed quotes; relevant sub-shape only): `{ ..., payment:{ downPaymentMode:'10'|...|'60'|'custom', downPayment:number, balance:number, balanceMode:'lump'|'stagger3'|'stagger4'|'stagger5'|'install3'|'install6'|'install9'|'install12', interestRate:number }, bankDetails:string(free text), editableState:{...} }`. This is the ONLY place a DP-percent-equivalent (`downPaymentMode`) and a schedule (`balanceMode`) currently exist as data — and, per point 6, it is confirmed dead-ends here; nothing downstream reads it.

**`cash_advances/{docId}`** (top-level; cited for blast-radius only): `{ userId, userName, employeeId, amount, terms, interest, interestCharged, monthlyPayment, totalPayable, balance, status:'pending'|'approved'|..., payments:[], date, reason, approvedBy?, approvedAt? }`. Rules (firestore.rules:250-264): `read: own-or-isFinanceOrAdmin`; `create: isMoneyAdmin() || (own && pending && balance==0)`. No method/account field.

**`payroll/{uid}`** (firestore.rules:408-412: `read: own-or-isFinanceOrAdmin`, `create/update: isMoneyAdmin()`, `delete: isPresident()`) and **`pay_runs/{month}`** (firestore.rules:482-503: state machine `draft→computed→verified→disbursed`, `disbursed` reachable ONLY by `isPresident()` from `verified`, immutable after) — cited for blast-radius; neither carries any account/method field today.

## Constraints — must respect

- Manila-time discipline: any date logic for a bank-account statement period, reconciliation cutoff, or DP-schedule due-date must use `window.bizDate()/bizHour()/bizDow()` (js/config.js:17-37), never raw `new Date().toISOString()` — this exact bug class previously corrupted attendance + payroll per the manila-time-helpers memory.
- `escHtml()` (or the local `e()`/`esc()` alias) before any innerHTML interpolation of user-entered strings — bank account nicknames, notes, payment references — matching the universal convention already used in every function cited above (`buildBillingInvoiceHTML`, `openProjectBillingModal`, `openSalesOrderModal`, etc.).
- Firestore rules coverage does not cascade or match by prefix (firestore-rules-collection-coverage memory, re-confirmed here across `ledger`/`sales_orders`/`job_projects`/`cash_advances` each needing their own explicit `match` block) — a new `bank_accounts` collection (and any bank-transactions/reconciliation sub-collection) needs its own explicit rules block or reads silently DENY.
- Rules must read fields via `.get(field, default)`, never bare field access (firestore-rules-missing-field-throws memory) — directly relevant if new rules validate a `bankAccountId` shape on ledger/`job_projects.payments[]` writes, since older documents won't have that field.
- The idempotent-deterministic-ref pattern (`EXP-`/`CRJ-`/`CDJ-`/`PAY-<month>-<uid>`/`SO-`/`PROJ-<id>-<n>`/`POCOS-`) is load-bearing throughout finance — every existing poster does a `where('refNumber','==',ref).limit(1).get()` (or prefetch-by-range) existence check before `.add()`. Any new bank-account-tagged ledger write, or a new downpayment-invoice numbering scheme, must preserve this so a retry/re-open never double-posts. Note `PROJ-{id}-{payments.length}` (departments.js:12290) is array-length-derived rather than an atomic counter — a real (if narrow) race window the existing code's own comment acknowledges ("payments are legitimately multiple") rather than fully closes; a new DP-invoice numbering scheme should not copy this pattern uncritically — `window.nextSerial()` (letterhead.js:113-122) is the safer, already-built atomic alternative and is currently unused by any caller.
- **Naming: do not name a new bank-account field `account` or `accountType`** — both are already claimed by WS13's chart-of-accounts dimension on every `ledger` row (point 2 above) and reused across 15+ read sites (`fable-workplan/13-coa.md`'s Current State enumerates them). Collision would silently corrupt P&L/balance-sheet reports that filter `ledger.accountType`.
- CACHE_VER in sw.js (currently `bi-ops-v173`, sw.js:11) must be bumped on any JS/CSS edit — auto-bumped for `APP_VERSION`/index.html version strings by the pre-commit hook, but CACHE_VER itself is a documented separate manual step per CLAUDE.md.
- Script load order is fixed (index.html:302-323, re-verified): `firebase-config.js → config.js → qrcode.js → statutory-tables.js → letterhead.js → ... → drive.js → notifications.js → departments.js → app.js → modules.js`. `letterhead.js` already loads before departments.js/app.js/modules.js, so a new DP-invoice generator calling `window.buildLetterhead`/`window.brandEntity` needs no defensive `typeof` guard. Any brand-new shared helper (e.g. a `bank_accounts` read-cache accessor) should live in config.js (loads first) if departments.js/app.js/modules.js all need to call it.
- `dbCachedGet`/`dbCacheInvalidate` (js/config.js, the in-memory Firestore read-cache) is the established pattern for any list screen that would read `bank_accounts` or `ledger` repeatedly (e.g. a reconciliation view) — follow the same cache-key-plus-explicit-invalidate discipline used for `'ledger'` itself (config.js:400-410) rather than re-fetching on every render.
- **Blast-radius constraint (expanded in Risks below): do not assume a `bank_accounts` registry is a narrow, additive schema change.** Per point 8, every existing cash-moving writer (ledger CRJ-/CDJ-/EXP-/PAY-/SO-/PROJ-/POCOS- posts, `cash_advances` approve, `pay_runs` Disburse, `job_projects.payments[]`) currently has zero account/method-of-record dimension beyond a free-text label. A spec that only adds `bank_accounts` + tags NEW writes, without an explicit, stated decision about the dozen existing writers, will under-deliver on "which account each payment hit" for anything already in the books.
- `job_projects.update` is NOT finance-gated at the Firestore rules level (firestore.rules:1041, gated only `createdBy==self || !isPartner()` — i.e. any non-partner internal user can update any job_projects doc) — it is gated to finance/admin only in the UI (`_isFinAdmin()`, departments.js:2011/12149-12150). A new bank-account-tagged payment write inherits this same UI-only gate unless the rule itself is tightened; note this explicitly rather than assuming Firestore already blocks a non-finance write.

## DECIDED — architecture spec (Fable, 2026-07-10)

### Resolved decisions (numbered to match the original open decisions)

1. **`bank_accounts` = new top-level collection; literal shape in Spec 1.** The tag field family on money rows is `bankAccountId` / `bankAccountName` / `bankFlow:'in'|'out'` — NEVER `account`/`accountType` (WS13 collision, point 2). The FULL `accountNo` is stored (the DP invoice must print it so the client can pay); every list/picker renders it masked (`•••• 1234`) via `BankAccounts.label()`.
2. **Balance is DERIVED — no stored counter, nothing to drift.** Per-account balance = `openingBalance` (a cutover anchor, decision 3) + Σ tagged `bankFlow:'in'` − Σ `'out'` over ledger rows dated ≥ that account's `openingDate`, computed by ONE pure function (`BankAccounts.computeBalances`, Spec 2) over the already-cached full-ledger read (`ledgerForPeriod('all')`, config.js:397-404). No `FieldValue.increment` discipline, no drift-vs-derive safety net needed (the derive IS the value), no new composite index (client-side filter on a read Finance screens already perform). This applies the `arBalance` derive-don't-trust lesson (departments.js:12060-12061) from day one.
3. **Going-forward-only tagging + cutover anchor; NO historical backfill — resolved writer-by-writer, not hand-waved.** All 15 money-writers are enumerated in Spec 3 with an explicit v1 action each: 11 get tagged in v1, 4 are explicitly non-cash/by-design-untagged. Historical rows stay untagged forever; correctness comes from the anchor — at go-live finance creates each account with `openingBalance` = the REAL balance that morning and `openingDate` = that day, so the derived balance is exact from day one without touching any historical row. `runLedgerBackfill`/`backfillLedgerFromJournals`/`backfillPayrollLedger` keep posting untagged (historical) rows — the anchor absorbs them (they predate `openingDate`).
4. **Reconciliation v1 = manual mark-off, no statement import.** The new Bank Accounts screen (Spec 6) lists each account's tagged ledger rows with a per-row checkbox writing `reconciled:true, reconciledBy, reconciledAt` onto the ledger doc (permitted by the existing `ledger.update: canFinance()` rule — no rules change), and shows Book balance vs Reconciled balance side by side. CSV/OFX import + auto-match is explicitly deferred (v2); no new collection is needed for v1.
5. **`sales_orders` stays one-shot; `job_projects` is the ONLY staged-payment surface.** The `SO-{id}` dupe-guard (departments.js:9544-9545) is KEPT. "Record Sale" = the initial collection only (typically the DP — it already arrayUnions into `job_projects.payments[]`, departments.js:9564); every later collection goes through `openProjectBillingModal`. The record modal gains a hint line saying so. No third payment path is built (the exact bug class the Risks section warns about).
6. **The DP invoice is an enhanced MODE of the existing pair, not a new document type.** `openJobBillingInvoiceModal` gains `kind:'standard'|'downpayment'`; `buildBillingInvoiceHTML` renders two additional sections (Payment Schedule + structured Payment Instructions) whenever the invoice object carries them; `docTitle` flips to `'DOWNPAYMENT INVOICE'` for the DP kind. Letterhead integration is untouched — still the same 5th-caller `buildLetterhead` pattern.
7. **`dpPercent` is STORED once on `job_projects`.** Set at Sales-Order creation via a new optional "Downpayment %" field in `openSalesOrderModal`, PREFILLED from the won quote's `payment.downPaymentMode` by fetching the quote doc directly (the `dataset` bag can't carry the nested object — point 6); editable later in the DP-invoice modal (which persists it back). The DP invoice computes amount = `dpPercent% × contract`, still editable per-invoice as an absolute override.
8. **`balanceSchedule` is PERSISTED as structured data on `job_projects`** — `[{seq,label,dueDate|null,amount}]`, computed at DP-invoice generation by a new pure `window.buildBalanceSchedule()` in config.js (math re-derived from quote-builder-v2.html:1821-1878; that file stays untouched — it is iframe-isolated by design). Stored so future invoices/reminders/AR views can reference the committed schedule; regenerating a DP invoice overwrites it after a confirm.
9. **The registry SUPERSEDES the quote's free-text `bankDetails` — it is NOT threaded.** Structured payment instructions come from the `bank_accounts` doc selected at invoice time, snapshotted onto the invoice (so a later account edit never rewrites an issued invoice). The only quote field threaded downstream is `payment.downPaymentMode` (as the dp% prefill, decision 7).
10. **`bank_accounts` create/update = `isMoneyAdmin()` with a shape guard; delete = `isPresident()` in rules, client routed through `window.financeDelete`** (the finance_delete_requests precedent, point 12). Closing an account = `active:false` via a normal isMoneyAdmin edit (reversible ≠ destructive); editing an account number is an ordinary isMoneyAdmin edit but `logAudit`'d. President-approval routing for EDITS is rejected — disproportionate friction given the audit log + president-only delete; deletes (the destructive case) keep the approval flow.
11. **`bank_accounts.read` = `canFinance()` only.** Matches `ledger.read`; every consumer (Record Sale, Project Billing, Disburse, CA approve, invoice generation, the registry screen, WS40's cash KPI — which reads the ledger anyway) already sits behind that gate. Non-finance staff never see account numbers; the "which account" answer they'd need lives on finance-only screens regardless.
12. **`job_projects.update` IS tightened** with an `affectedKeys` money-guard: any write touching `payments/amountCollected/arBalance/invoices/dpPercent/balanceSchedule` now additionally requires `canFinance()`; all other keys (stage, timeline, documents, trackingToken, productionOrderIds, salesOrderId…) keep the existing gate, so Sales/Production/partner flows (`advanceProjectStage`, `transferOrderToProduction`, `ensureOrderTracking`, SO step-4 back-links) are provably unaffected. Exact diff in Spec 7.
13. **`window.nextSerial('billing_invoice','INV')` becomes THE mint for ALL billing invoices** — standard AND downpayment, ONE series (BIR expects one sequential invoice series; a separate `DPINV-` counter would fragment it). Minted AFTER the confirm dialog so a cancelled dialog burns no serial. The per-project array-length scheme (departments.js:12334, 12337) is retired; already-issued `INV-YYYYMMDD-###` numbers stand as-is (numbers are opaque strings to every reader — grep-confirmed nothing parses them).
14. **`method` stays as its own axis; `bankAccountId`/`bankAccountName` are added ALONGSIDE it.** "How the client paid" (client-facing vocabulary: Bank Transfer/GCash/Cash/Cheque) and "which of OUR accounts it hit" (internal cash location) co-vary but are different facts; both are stored on ledger rows and payment records. No existing `paymentMethod`/`method` field is renamed or removed.

**Scoping / sequencing:** depends on **WS13** (COA — Spec 2c adds one asset line `'Advances to Employees'` + legacy-map entries; the new field family deliberately never reuses `account`/`accountType`); **WS14** (letterhead — no letterhead.js changes; `nextSerial` merely gets its first caller); **WS19** (all new gates reuse `isMoneyAdmin()`/`canFinance()`; the job_projects tightening extends WS19's direction); **WS20/21** (the Disburse edit is parameter-plumbing only — no amount or leg logic changes; ‼️ **verify the `payroll-compute-existing-bug` memory's live ReferenceError (flagged in PR#2, 2026-07-09) is fixed BEFORE shipping the Disburse change, and do NOT bundle that bug fix into this workstream's commit**). No contact with WS25/26. `quote-builder-v2.html` untouched.

**WS40 HANDOFF — the cash-position figure (WS40's Fable pass should build against this):** once WS36 ships, "cash position" = `await window.BankAccounts.cashPosition()` → `{ total, perAccount }`, where `total` = Σ over ACTIVE registry accounts of (`openingBalance` + tagged inflows − tagged outflows since that account's `openingDate`), derived live from the cached full-ledger read. It is a point-in-time BALANCE (exact from cutover day), not a period flow. WS40 renders `total` as the Cash Position KPI with per-account drill-down from `perAccount`, and uses **registry-empty as the feature flag**: `(await window.BankAccounts.list()).length === 0` → show WS40's option-(b) placeholder card ("wire in once accounts are registered"); otherwise show the real figure and do NOT fall back to any "Net Cash (period)" flow proxy. Known, accepted residual gap to label in fine print: statutory-payable remittances (SSS/PhilHealth/Pag-IBIG/WHT actually paid out to agencies) have NO recording flow anywhere in the app today, so they are invisible to cash position until WS39 builds one — every cash movement the app DOES record is tagged in v1 (Spec 3).

---

### Spec 1 — Data shapes (annotated literals)

```js
// bank_accounts/{autoId}  — NEW top-level collection. Master data ONLY — no balance
// field exists here (balances are derived, decision 2), so nothing can drift.
{ nickname: 'BDO Checking — Main',   // string, REQUIRED — display name (escHtml on every render)
  type: 'bank',                      // 'bank' | 'ewallet' | 'cash'  (petty-cash box = 'cash')
  bankName: 'BDO',                   // string ('' for type:'cash'; 'GCash' for the wallet)
  accountName: 'NEILBARRO STEEL & METAL FABRICATION SERVICES', // registered holder — prints on invoices
  accountNo: '001234567890',         // string, FULL number (invoice needs it); '' for type:'cash'. UI masks to last 4.
  branch: 'San Fernando, La Union',  // string, optional
  currency: 'PHP',                   // fixed 'PHP' in v1
  openingBalance: 145230.55,         // number — REAL balance at start of openingDate (the cutover anchor)
  openingDate: '2026-07-15',         // YYYY-MM-DD via bizDate() — tagged rows dated BEFORE this are ignored for this account
  active: true,                      // false = closed: hidden from pickers, kept forever (records-forever directive)
  isDefault: false,                  // at most one true — preselected in pickers; auto-used by the WPAY poster (Spec 4h)
  sortOrder: 1, notes: '',
  createdBy, createdByName, createdAt, updatedAt }   // uid / string / serverTimestamp ×2

// NEW fields on ledger rows (ADDITIVE — only present on cash-tagged rows; all
// existing fields untouched; field names chosen to dodge WS13's account/accountType):
{ bankAccountId: '<bank_accounts docId>',            // absent entirely on untagged/non-cash rows
  bankAccountName: 'BDO Checking — Main (•••• 7890)',// denormalized label snapshot (render without a join)
  bankFlow: 'in' | 'out',                            // explicit direction — NEVER derived from type/accountType algebra
  reconciled?: true, reconciledBy?: '<uid>', reconciledAt?: Timestamp }  // Spec 6 mark-off

// job_projects/{id} — NEW fields (additive):
{ dpPercent: 40,                     // number|null — set at SO creation (Spec 4c), editable in the DP-invoice modal
  balanceSchedule: [                 // null until a DP invoice is generated (Spec 5); overwritten on regenerate
    { seq:1, label:'Progress payment 1 of 3', dueDate:'2026-08-17'|null, amount:100000 } ] | null }
// job_projects.payments[] entries gain: bankAccountId, bankAccountName (both nullable)
// job_projects.invoices[] entries gain: kind:'standard'|'downpayment', dpPercent?, schedule?, bank?  (Spec 5 sample)

// sales_orders/{id} — recorded update (Spec 4a) gains: bankAccountId, bankAccountName (nullable)
// cash_advances/{id} — approve (Spec 4e) gains: bankAccountId, bankAccountName (nullable)
// pay_runs/{month}  — disburse flip (Spec 4d) gains: disbursedFrom, disbursedFromName (nullable)
//   (safe: the rules state machine, firestore.rules:482-503, validates state TRANSITIONS, not field lists — re-verified)
// cash_receipt_journal / cash_disbursement_journal docs gain: bankAccountId, bankAccountName (posters copy them to ledger)
```

### Spec 2 — `window.BankAccounts` service + schedule builder + COA addition (js/config.js)

**2a — service.** Insert immediately after `window.ledgerSince` (config.js:411). `escHtml` (modules.js) is referenced only at call time — every caller runs post-load, so no load-order guard is needed.

```js
// ── Bank accounts registry (v12 WS36) ──────────────────────────────────────
// Balances are DERIVED (opening anchor + tagged ledger flows) — never stored.
// Field family: bankAccountId/bankAccountName/bankFlow — NEVER 'account'/
// 'accountType' (those are WS13 chart-of-accounts fields on every ledger row).
window.BankAccounts = {
  async list({ activeOnly = true } = {}) {
    const snap = await dbCachedGet('bank_accounts',
      () => db.collection('bank_accounts').get().catch(() => ({ docs: [] })), 60000);
    const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (a.sortOrder||0)-(b.sortOrder||0) || (a.nickname||'').localeCompare(b.nickname||''));
    return activeOnly ? all.filter(a => a.active !== false) : all;
  },
  invalidate() { if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('bank_accounts'); },
  label(a) {                                   // 'BDO Checking — Main (•••• 7890)' — masked, safe for lists
    if (!a) return '';
    const tail = (a.accountNo||'').replace(/\D/g,'').slice(-4);
    return (a.nickname || a.bankName || '') + (tail ? ` (•••• ${tail})` : '');
  },
  async optionsHTML(selectedId) {              // <option> set for pickers; preselects selectedId, else isDefault
    const list = await this.list();
    const def = selectedId || (list.find(a => a.isDefault) || {}).id || '';
    return ['<option value="">— no account —</option>']
      .concat(list.map(a => `<option value="${escHtml(a.id)}" ${a.id===def?'selected':''}>${escHtml(this.label(a))}</option>`))
      .join('');
  },
  async pick(id) {                             // picked id → the write-ready pair (null-safe)
    if (!id) return { bankAccountId: null, bankAccountName: null };
    const a = (await this.list({ activeOnly: false })).find(x => x.id === id);
    return { bankAccountId: id, bankAccountName: a ? this.label(a) : null };
  },
  tag(acct, flow) {                            // spread into a ledger write; {} when untagged (keys OMITTED, not null)
    return (acct && acct.bankAccountId)
      ? { bankAccountId: acct.bankAccountId, bankAccountName: acct.bankAccountName || null, bankFlow: flow }
      : {};
  },
  // DERIVED balances (decision 2). rows = ledger doc datas. Pure — no reads.
  computeBalances(accounts, rows, { reconciledOnly = false, asOf = null } = {}) {
    const out = {};
    accounts.forEach(a => { out[a.id] = { account: a, balance: +(a.openingBalance||0), in: 0, out: 0 }; });
    rows.forEach(r => {
      if (!r || !r.bankAccountId || !out[r.bankAccountId]) return;
      const acc = out[r.bankAccountId].account;
      if (r.date && acc.openingDate && r.date < acc.openingDate) return;  // pre-anchor rows excluded
      if (asOf && r.date && r.date > asOf) return;
      if (reconciledOnly && !r.reconciled) return;
      const amt = +(r.amount||0);
      if (r.bankFlow === 'in')  { out[r.bankAccountId].balance += amt; out[r.bankAccountId].in  += amt; }
      if (r.bankFlow === 'out') { out[r.bankAccountId].balance -= amt; out[r.bankAccountId].out += amt; }
    });
    return out;
  },
  // WS40 reads THIS (see handoff note above).
  async cashPosition() {
    const [accounts, snap] = await Promise.all([ this.list(), window.ledgerForPeriod('all') ]);
    const per = this.computeBalances(accounts, snap.docs.map(d => d.data()));
    return { total: Object.values(per).reduce((s,x) => s + x.balance, 0), perAccount: per };
  }
};
```

**2b — pure schedule builder** (config.js, right after 2a). Manila-safe: dates built by string parts (the leave-spec T12:00:00 pattern), never `toISOString()` on a raw now.

```js
// Ported from quote-builder-v2.html:1821-1878 (that file is iframe-isolated by
// design — math re-derived here, not imported). Returns the POST-DP schedule.
window.buildBalanceSchedule = function(contract, dpAmount, balMode, interestRate, invoiceDate, completionDate) {
  const bal = Math.max(0, (+contract||0) - (+dpAmount||0));
  if (bal <= 0) return [];
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const addDays   = (s,n) => { const d = new Date(s+'T12:00:00'); d.setDate(d.getDate()+n);   return iso(d); };
  const addMonths = (s,n) => { const d = new Date(s+'T12:00:00'); d.setMonth(d.getMonth()+n); return iso(d); };
  if (balMode === 'lump')
    return [{ seq:1, label:'Balance — due upon completion', dueDate: completionDate||null, amount:+bal.toFixed(2) }];
  if (/^stagger[345]$/.test(balMode)) {
    const n = +balMode.replace('stagger',''), per = +(bal/n).toFixed(2), out = [];
    const span = (invoiceDate && completionDate)
      ? Math.max(0, Math.round((new Date(completionDate+'T12:00:00') - new Date(invoiceDate+'T12:00:00'))/86400000)) : 0;
    for (let i=1;i<=n;i++) out.push({ seq:i, label:`Progress payment ${i} of ${n}`,
      dueDate: span ? addDays(invoiceDate, Math.round(span*i/n)) : null,
      amount: i===n ? +(bal - per*(n-1)).toFixed(2) : per });          // last row absorbs rounding
    return out;
  }
  if (/^install(3|6|9|12)$/.test(balMode)) {
    const m = +balMode.replace('install',''), r = (+interestRate||0)/100/12;
    const monthly = r > 0 ? bal*r/(1-Math.pow(1+r,-m)) : bal/m, out = [];
    for (let i=1;i<=m;i++) out.push({ seq:i,
      label:`Installment ${i} of ${m}${r>0?` (@ ${interestRate}% p.a.)`:''}`,
      dueDate: invoiceDate ? addMonths(invoiceDate, i) : null, amount:+monthly.toFixed(2) });
    return out;
  }
  return [{ seq:1, label:'Balance', dueDate:null, amount:+bal.toFixed(2) }];
};
```

**2c — COA additions (config.js:652-676, before→after fragments).** Needed by the CA row (4e) and the settlement legs (4g).

```js
// BEFORE (config.js:658)
  asset:     ['Cash', 'Accounts Receivable', 'Inventory'],
// AFTER
  asset:     ['Cash', 'Accounts Receivable', 'Inventory', 'Advances to Employees'],

// COA_LEGACY_MAP — ADD three entries (rows always carry accountType, these are the safety fallback):
  'Cash Advance':'asset', 'A/R Collection':'asset', 'A/P Settlement':'liability',
```

### Spec 3 — Blast-radius retrofit: EVERY money-writer, one decision each

This is the resolution of open decision 3 — nothing below is left for the implementer to discover.

| # | Writer | Anchor | Cash? | v1 action |
|---|--------|--------|-------|-----------|
| 1 | Record Sale `SO-` credit | departments.js:9549 (`openRecordSaleModal`) | in | REQUIRED picker `rs-bankacct` → tag ledger row + `payments[]` entry + `sales_orders` doc (Spec 4a) |
| 2 | Project billing `PROJ-` credit | departments.js:12293 (`openProjectBillingModal`) | in | REQUIRED picker `pb-bankacct` → tag ledger row + payment record (Spec 4b) |
| 3 | Sales-order create | departments.js:9306-9342 | no ledger write | NO picker (cash books at Record Sale, decision 5); gains the `dpPercent` field only (Spec 4c) |
| 4 | Payroll Disburse `NETPAY-{month}` | departments.js:2623-2628 | out | picker in a new disburse modal (replaces the confirm at 3189-3203) → tag the NETPAY leg + `pay_runs.disbursedFrom` (Spec 4d) |
| 5 | Payroll `PAY-`/`-ER` debits + `SSSPAY-/PHPAY-/HDMFPAY-/WHTPAY-` credits | departments.js:2590-2622 | **NON-CASH** | NEVER tagged — expense recognition + agency accruals; recording the actual remittance is WS39's flow (does not exist yet) |
| 6 | Cash-advance approval | config.js:1008-1034 (`CashAdvance.approve`) | out | picker in `openApproveModal` → NEW idempotent `CA-{id}` asset ledger row + fields on the CA doc + delete-cascade handling (Spec 4e) |
| 7 | Purchase disbursement | departments.js:13547-13633 | out | picker `rec-bank` → fields on the CDJ doc; `postCDJToLedger` carries them + new `-AP` leg (Spec 4f/4g) |
| 8 | CRJ manual entry | departments.js:3859-3907 | in | picker `crj-bank` → fields on the CRJ doc; `postCRJToLedger` carries them + new `-AR` leg (Spec 4g) |
| 9 | CDJ manual entry | departments.js:3972-4030 | out | picker `cdj-bank` → same as #7 (Spec 4g) |
| 10 | Expense approval → `EXP-` debit | departments.js:1660-1675 + 1434-1455 | out | one-field `promptBankAccount()` at approve; `postExpenseToLedger(expId, e, acct)` gains an optional 3rd param (Spec 4h) |
| 11 | `resyncLedgerForSource` | departments.js:1527-1569 | — | carries the tag through edits; syncs the new `-AR`/`-AP` legs (Spec 4g) |
| 12 | Design-project payment `DPROJ-` | departments.js:7042-7097 | in | OPTIONAL picker `pay-bank` in the mini-form (poster is already best-effort) (Spec 4i) |
| 13 | Worker-payslip Submit `WPAY-{id}` | departments.js:4779-4798 | out | auto-tag with the registry's `isDefault` account (runs inside the payslips modal — no room for a second modal); re-taggable from the Bank Accounts screen (Spec 4h) |
| 14 | `consumeProductionMaterials` `POCOS-`/`-INV` | (WS13 contra-legs) | **NON-CASH** | NEVER tagged — inventory→COS reclassification |
| 15 | Ledger backfills | departments.js:1592-1602, `runLedgerBackfill` 1644 | historical | UNTAGGED by design — the opening-balance anchor covers everything pre-cutover |

Universal picker rule: when the registry has ≥1 active account, the REQUIRED pickers (#1, #2, #4, #7, #9) block save with an inline error if unselected; when the registry is EMPTY (pre-seed), every writer proceeds untagged exactly as today — the feature is inert until accounts exist.

### Spec 4 — Function-level before/after diffs

**4a — `openRecordSaleModal` (departments.js:9467-9579).**
```js
// BEFORE (9467):
function openRecordSaleModal(o, container){
// AFTER:
async function openRecordSaleModal(o, container){
  const bankOpts = await window.BankAccounts.optionsHTML(o.bankAccountId);
```
Insert AFTER the Method `form-row` (below line 9490) — plus the decision-5 hint:
```html
    <div class="form-group"><label>Deposited to (company account)</label>
      <select id="rs-bankacct" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${bankOpts}</select>
      <div style="font-size:11px;color:var(--text-muted);margin-top:3px">Which company account received the cash — feeds the Bank Accounts balance. Further collections for this job are recorded on the linked Project (Projects → 💵 Record Payment).</div>
    </div>
```
In the save handler, after the `vatSplit` destructure (9535) and before `saveBtn.disabled=true` (9539):
```js
    const acctSel = document.getElementById('rs-bankacct').value;
    if (amount > 0 && !acctSel && (await window.BankAccounts.list()).length) {
      err.textContent = 'Select the company account that received this payment.'; err.classList.remove('hidden'); return;
    }
    const acct = await window.BankAccounts.pick(acctSel);
```
Then three one-line extensions: the ledger `add` object (9549) gains `, ...window.BankAccounts.tag(acct,'in')`; the `sales_orders` update (9554) gains `, bankAccountId: acct.bankAccountId||null, bankAccountName: acct.bankAccountName||null`; the `payments` arrayUnion object (9564) gains the same two fields.

**4b — `openProjectBillingModal` (departments.js:12238-12308).** Same pattern: `function` → `async function` with `const bankOpts = await window.BankAccounts.optionsHTML();` at top; add the same `pb-bankacct` form-group after the VAT/Method form-row (12254); in the save handler after the `vatSplit` destructure (12281), the same required-picker guard (`entered>0` always here) + `const acct = await window.BankAccounts.pick(...)`; the ledger `add` (12293) gains `, ...window.BankAccounts.tag(acct,'in')`; the `payment` object (12296) gains `bankAccountId: acct.bankAccountId||null, bankAccountName: acct.bankAccountName||null`.

**4c — `openSalesOrderModal` (departments.js:9306) + `createJobProject` (12014-12040) — the dp% thread.**
After `const total = parseFloat(d.total)||0;` (9307):
```js
  // v12 WS36 — the quote's payment terms can't ride the dataset bag (nested object);
  // fetch the quote doc directly to prefill the DP%. Best-effort — never blocks the modal.
  let quotePay = null;
  try { const qs = await db.collection(d.co==='BK'?'bk_quotes':'bs_quotes').doc(d.id).get();
        if (qs.exists) quotePay = qs.data().payment || null; } catch(_) {}
  const dpPrefill = quotePay
    ? (quotePay.downPaymentMode === 'custom'
        ? (total > 0 ? +(100*(quotePay.downPayment||0)/total).toFixed(1) : '')
        : (parseFloat(quotePay.downPaymentMode) || ''))
    : '';
```
Add after the Contract/Payment `form-row` (9314):
```html
    <div class="form-group"><label>Downpayment % of contract (optional)</label>
      <input id="so-dp-pct" type="number" min="0" max="100" step="0.5" value="${dpPrefill}" inputmode="decimal" placeholder="e.g. 40"/>
      <div style="font-size:11px;color:var(--text-muted);margin-top:3px">Prefilled from the quote's payment terms — drives the Downpayment Invoice on the project.</div>
    </div>
```
In the save handler (after 9327): `const dpPercent = Math.max(0, Math.min(100, parseFloat(document.getElementById('so-dp-pct').value)||0)) || null;` and change 9332 to `const proj = await createJobProject({ ...d, total:contract, dpPercent });`. In `createJobProject`, extend the `add` object (after `capital:0,` on 12029): `dpPercent: d.dpPercent || null, balanceSchedule: null,`.

**4d — `disbursePayRun` (departments.js:2512-2644) + its button handler (3189-3203).** ‼️ Confirm the payroll-compute bug (memory) is resolved first; this change is additive plumbing only.
```js
// BEFORE (2512):
window.disbursePayRun = async function(month) {
// AFTER:
window.disbursePayRun = async function(month, opts = {}) {
  const bankAcct = opts.bankAccount || { bankAccountId: null, bankAccountName: null };
```
The `NETPAY-{month}` entry object (2623-2628) gains `, ...window.BankAccounts.tag(bankAcct,'out')`. The terminal state flip (2639-2642) gains `disbursedFrom: bankAcct.bankAccountId || null, disbursedFromName: bankAcct.bankAccountName || null,`. All other legs untouched (Spec 3 #5).
Button handler — replace the body of the `pr-disburse-btn` listener (3189-3203) with an account-aware modal:
```js
    document.getElementById('pr-disburse-btn')?.addEventListener('click', async ()=>{
      const chk = await db.collection('pay_runs').doc(month).get().catch(()=>null);
      const data2 = (chk && chk.exists) ? chk.data() : {};
      const bankOpts = await window.BankAccounts.optionsHTML();
      openModal(`Disburse ${month} payroll`, `
        <p style="font-size:13px;margin-bottom:10px">₱${fmt(data2.totalNet||0)} to ${data2.employeeCount||0} staff. This deducts cash advances, posts the ledger, and notifies employees. <strong>This cannot be undone.</strong></p>
        <div class="form-group"><label>Paid from (company account)</label>
          <select id="pr-bankacct" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${bankOpts}</select></div>
      `, `<button class="btn-danger" id="pr-disburse-go">Disburse</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('pr-disburse-go').addEventListener('click', async ()=>{
        const sel = document.getElementById('pr-bankacct').value;
        if (!sel && (await window.BankAccounts.list()).length) { Notifs.showToast('Select the paying account.','error'); return; }
        const acct = await window.BankAccounts.pick(sel);
        closeModal();
        const dbtn = document.getElementById('pr-disburse-btn');
        if (dbtn) { dbtn.disabled = true; dbtn.textContent = 'Disbursing…'; }
        try { await window.disbursePayRun(month, { bankAccount: acct }); Notifs.showToast('Payroll disbursed!'); }
        catch (err) { Notifs.showToast(err.message || 'Could not disburse payroll.', 'error'); }
        loadPayRunStrip(month);
        loadFinanceContent(currentUser, currentRole, 'Payroll');
      });
    });
```

**4e — `CashAdvance.approve` (config.js:1008-1034) + `openApproveModal` (1036-…) + cascade.**
```js
// BEFORE (1008):
  async approve(id, { interestPct = null } = {}) {
// AFTER:
  async approve(id, { interestPct = null, bankAccount = null } = {}) {
```
Inside the transaction's `t.update` (1021-1025) add `bankAccountId: (bankAccount && bankAccount.bankAccountId) || null, bankAccountName: (bankAccount && bankAccount.bankAccountName) || null,`; extend the `result` capture (1026) with `userName: cur.userName || ''`. Then AFTER the transaction, before the notification block (1029), insert the idempotent cash-release mirror — this is the NEW ledger row that finally makes CA disbursement visible to the books (asset debit → `ledgerKind()==='asset'` keeps it out of the P&L):
```js
    // v12 WS36 — mirror the cash release into the ledger (idempotent, keyed CA-<id>).
    // Best-effort: an approver without ledger-write rights (or a closed period —
    // ledgerPeriodOpen() is enforced server-side) must not break the approval itself.
    if (result) { try {
      const lref = `CA-${id}`;
      const dupe = await db.collection('ledger').where('refNumber','==',lref).limit(1).get().catch(()=>({docs:[]}));
      if (!dupe.docs.length) {
        await db.collection('ledger').add({
          date: (window.bizDate ? window.bizDate() : today()), type:'debit',
          accountType:'asset', account:'Advances to Employees',
          description:`Cash advance released — ${result.userName}`,
          amount: result.amount, category:'Cash Advance', refNumber: lref, source:'Cash Advance',
          ...window.BankAccounts.tag(bankAccount, 'out'),
          addedBy: window.currentUser?.uid || null,
          addedByName: (window.userProfile && window.userProfile.displayName) || (window.currentUser && window.currentUser.email) || '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
      }
    } catch(e) { console.warn('[CA ledger]', e?.message || e); } }
```
`openApproveModal`: make the `.then(snap => …)` callback `async`, compute `const bankOpts = await window.BankAccounts.optionsHTML();`, add above the interest-rate form-group:
```html
        <div class="form-group"><label>Release from (company account)</label>
          <select id="ca-appr-bank" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${bankOpts}</select></div>
```
and in the confirm handler pass it through: `const acct = await window.BankAccounts.pick(document.getElementById('ca-appr-bank').value);` → `await window.CashAdvance.approve(id, { interestPct: pct, bankAccount: acct });`. Any residual direct `.approve(id)` caller stays valid (posts an untagged CA row — nulls, not errors).
`financeDeleteCascade` (departments.js:141-186): add a branch before the CRJ/CDJ/expenses branch so deleting a CA also removes its mirror:
```js
  } else if (collection === 'cash_advances') {
    const ls = await db.collection('ledger').where('refNumber','==',`CA-${docId}`).limit(1).get().catch(()=>({docs:[]}));
    if (ls.docs.length) await ls.docs[0].ref.delete().catch(()=>{});
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
```

**4f — `recordPurchaseDisbursement` (departments.js:13547-13633).** `function` → `async function`; `const bankOpts = await window.BankAccounts.optionsHTML();` at top; add a `rec-bank` form-group (same style as 4a's) after the Amount/Debit-Account form-row (13565). In the save handler, before building `cdjData`: required-picker guard (registry non-empty) + `const acct = await window.BankAccounts.pick(document.getElementById('rec-bank').value);`; `cdjData` gains `bankAccountId: acct.bankAccountId || null, bankAccountName: acct.bankAccountName || null,`. The ledger side is handled by 4g.

**4g — the three posters + settlement legs + resync (departments.js:1434-1573).** The journal docs now carry the tag; the posters copy it onto every ledger row they mint, and the two cash journals additionally mint NON-P&L settlement legs so A/R collections and A/P settlements — real cash movements that today post NO ledger row (departments.js:1465, 1496) — finally reach cash position. Precedent: the WS13 `POCOS-…-INV` asset contra-leg; `ledgerKind()` (config.js:678) classifies asset/liability rows out of the P&L automatically.

- `postExpenseToLedger` (1434): signature → `async function postExpenseToLedger(expId, e, acct)`; the `add` object gains `, ...window.BankAccounts.tag(acct, 'out')`. Callers at 1564 (resync) and 1592 (backfill) pass nothing → untagged, correct.
- `postCRJToLedger` (1460-1482) — REPLACE with:
```js
async function postCRJToLedger(crjId, e) {
  const date = e.date || today();
  const income = crjLedgerIncome(e);
  const ar = e.creditAR || 0;
  if (income <= 0 && ar <= 0) return false;
  await window.assertPeriodOpen(date);
  const tag = e.bankAccountId ? { bankAccountId: e.bankAccountId, bankAccountName: e.bankAccountName || null, bankFlow: 'in' } : {};
  const who = { addedBy: window.currentUser?.uid || null,
                addedByName: window.userProfile?.displayName || window.currentUser?.email || '' };
  let posted = false;
  if (income > 0) {                                       // new income — unchanged logic, now tagged
    const ref = `CRJ-${crjId}`;
    const existing = await db.collection('ledger').where('refNumber','==',ref).limit(1).get().catch(()=>({docs:[]}));
    if (!existing.docs.length) {
      const category = (e.creditSalesRevenue||0) >= (e.creditSundryAmount||0) ? 'Sales Revenue' : (e.creditSundryAcct||'Other Income');
      await db.collection('ledger').add({ date, type:'credit', accountType:'income', account:category,
        description:`Cash receipt — ${e.customer||''}${e.reference?` (${e.reference})`:''}`,
        amount:income, category, refNumber:ref, source:'Cash Receipt', ...tag, ...who,
        createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      posted = true;
    }
  }
  if (ar > 0) {                                           // v12 WS36 — A/R-collection leg (asset credit, non-P&L)
    const refAR = `CRJ-${crjId}-AR`;
    const exAR = await db.collection('ledger').where('refNumber','==',refAR).limit(1).get().catch(()=>({docs:[]}));
    if (!exAR.docs.length) {
      await db.collection('ledger').add({ date, type:'credit', accountType:'asset', account:'Accounts Receivable',
        description:`A/R collection — ${e.customer||''}${e.reference?` (${e.reference})`:''}`,
        amount:ar, category:'A/R Collection', refNumber:refAR, source:'Cash Receipt', ...tag, ...who,
        createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      posted = true;
    }
  }
  if (posted && typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
  return posted;
}
```
- `postCDJToLedger` (1491-1521) — same restructure, mirrored: keep the existing expense/asset main row exactly as-is but add `...tag` with `bankFlow:'out'` (tag built from `e.bankAccountId` as above); relax the early return to `if (expense <= 0 && !(e.debitAP > 0)) return false;`; append an A/P-settlement leg when `e.debitAP > 0`: ref `` `CDJ-${cdjId}-AP` ``, `{ date, type:'debit', accountType:'liability', account:'Accounts Payable', description:`A/P settlement — ${e.payee||''}…`, amount:e.debitAP, category:'A/P Settlement', refNumber, source:'Cash Disbursement', ...tag, ...who, createdAt }` with the same dupe-check pattern.
- CRJ/CDJ entry forms: make the `add-crj-btn` (3859) / `add-cdj-btn` (3972) click callbacks `async`, fetch `bankOpts`, add a `crj-bank` / `cdj-bank` form-group (labels "Received into (company account)" / "Paid from (company account)"), and add to `crjData` (3885) / `cdjData` (4007): `bankAccountId: <picked>||null, bankAccountName: <picked label>||null` via `BankAccounts.pick`. `financeEditModal` field lists (3913-3923, CDJ equivalent) are NOT extended in v1 — an edit keeps the original tag; `resyncLedgerForSource` re-copies it.
- `resyncLedgerForSource` (1527-1569): after `const patch = { … }` (1561) add:
```js
    if (e.bankAccountId) { patch.bankAccountId = e.bankAccountId; patch.bankAccountName = e.bankAccountName || null;
      patch.bankFlow = (collection === 'cash_receipt_journal') ? 'in' : 'out'; }
```
and after the main-row sync (1566), keep the settlement legs in step using a small shared helper placed next to `_deleteLedgerByRef` (1570):
```js
async function _syncLedgerLeg(ref, amount, mkEntry) {   // update / create / delete a keyed leg
  const ls = await db.collection('ledger').where('refNumber','==',ref).limit(1).get().catch(()=>({docs:[]}));
  if (amount > 0) { if (ls.docs.length) await ls.docs[0].ref.update({ amount }); else await db.collection('ledger').add(mkEntry()); }
  else if (ls.docs.length) await ls.docs[0].ref.delete().catch(()=>{});
}
// in resyncLedgerForSource, after the existing main-row upsert:
    if (collection === 'cash_receipt_journal')
      await _syncLedgerLeg(`CRJ-${docId}-AR`, e.creditAR||0, () => ({ /* the 4g AR-leg literal */ }));
    if (collection === 'cash_disbursement_journal')
      await _syncLedgerLeg(`CDJ-${docId}-AP`, e.debitAP||0, () => ({ /* the 4g AP-leg literal */ }));
```
- `financeDeleteCascade` CRJ/CDJ/expenses branch (178-184): delete the legs too — replace the single-ref lookup with a loop over `` [`${prefix}-${docId}`, `${prefix}-${docId}-AR`, `${prefix}-${docId}-AP`] ``.

**4h — approve-style transitions with no form: expenses + worker payslips.** New helper in departments.js (near `promptBankAccount` usage, e.g. after `bindExpenseActions`):
```js
// v12 WS36 — one-field account prompt for approve-style transitions that post a
// cash-out ledger row but have no form of their own. Registry empty → resolves
// untagged WITHOUT prompting (feature inert pre-seed).
async function promptBankAccount(title) {
  const list = await window.BankAccounts.list();
  if (!list.length) return { bankAccountId: null, bankAccountName: null };
  const opts = await window.BankAccounts.optionsHTML();
  return new Promise(resolve => {
    openModal(title || 'Paid from which account?', `
      <div class="form-group"><label>Paid from (company account)</label>
        <select id="pba-sel" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${opts}</select></div>
    `, `<button class="btn-primary" id="pba-ok">Confirm</button><button class="btn-secondary" id="pba-skip">Skip (untagged)</button>`);
    document.getElementById('pba-ok').addEventListener('click', async () => {
      const a = await window.BankAccounts.pick(document.getElementById('pba-sel').value); closeModal(); resolve(a); });
    document.getElementById('pba-skip').addEventListener('click', () => { closeModal(); resolve({ bankAccountId:null, bankAccountName:null }); });
  });
}
```
- Expense approve (`bindExpenseActions`, 1660-1675): after the period check (1669), insert `const acct = await promptBankAccount('Expense paid from which account?');` and change 1671 to `if (e) await postExpenseToLedger(id, e, acct);` (the expense table is an in-page render — `openModal` is free here).
- Worker-payslip Submit (4779-4798): runs INSIDE the payslips modal, so no second modal — auto-tag with the default account instead:
```js
          const _def  = (await window.BankAccounts.list()).find(a => a.isDefault) || null;
          const _acct = await window.BankAccounts.pick(_def && _def.id);
          const entry = { …existing fields unchanged…, ...window.BankAccounts.tag(_acct, 'out') };
```
Mis-tagged/untagged WPAY rows are correctable from the Bank Accounts drill-down's re-tag control (Spec 6).

**4i — Design-project payment mini-form (7042-7097).** Make the `proj-payment-btn` click callback `async`, fetch `bankOpts`, add a `pay-bank` form-group (OPTIONAL — this poster is already best-effort) after the Method input (7046); in the save handler `const acct = await window.BankAccounts.pick(document.getElementById('pay-bank').value);`; the `DPROJ-` ledger `add` (7086-7094) gains `, ...window.BankAccounts.tag(acct, 'in')`. The `projects.payments[]` entry is unchanged (Design board keeps its own shape).

### Spec 5 — Downpayment invoice: modal, builder, sample object, layout

**5a — `openJobBillingInvoiceModal` (departments.js:12313-12375).** `function` → `async function`; `const bankOpts = await window.BankAccounts.optionsHTML();` at top. Insert AFTER the Bill-To form-group (12319):
```html
    <div class="form-row">
      <div class="form-group"><label>Invoice Kind</label>
        <select id="jinv-kind" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          <option value="standard">Standard collection</option>
          <option value="downpayment">Downpayment (with balance schedule)</option></select></div>
      <div class="form-group"><label>Deposit to (company account)</label>
        <select id="jinv-bankacct" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${bankOpts}</select></div>
    </div>
    <div id="jinv-dp-wrap" style="display:none">
      <div class="form-row">
        <div class="form-group"><label>Downpayment % of contract</label>
          <input id="jinv-dppct" type="number" min="0" max="100" step="0.5" value="${p.dpPercent||''}" inputmode="decimal" placeholder="e.g. 40"/></div>
        <div class="form-group"><label>Balance mode</label>
          <select id="jinv-balmode" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
            <option value="lump">Lump sum on completion</option>
            <option value="stagger3">3 staggered progress payments</option><option value="stagger4">4 staggered</option><option value="stagger5">5 staggered</option>
            <option value="install3">3-month installment</option><option value="install6">6-month installment</option>
            <option value="install9">9-month installment</option><option value="install12">12-month installment</option></select></div>
      </div>
      <div class="form-row">
        <div class="form-group" id="jinv-int-wrap" style="display:none"><label>Interest % p.a.</label><input id="jinv-interest" type="number" min="0" step="0.5" value="0" inputmode="decimal"/></div>
        <div class="form-group"><label>Est. completion date</label><input id="jinv-complete" type="date"/></div>
      </div>
      <div id="jinv-sched-preview" style="font-size:12px;color:var(--text-muted);margin:4px 0 8px"></div>
    </div>
```
Wiring (all inside the modal, before the generate handler): `jinv-kind` change toggles `#jinv-dp-wrap`; when switched to `downpayment` it sets `jinv-amt` = `+(contract*(pct/100)).toFixed(2)` and `jinv-desc` = `` `Downpayment (${pct}% of contract)` ``; `jinv-balmode` change toggles `#jinv-int-wrap` on `/^install/`; any change to `jinv-dppct/balmode/interest/complete/date/amt` re-renders the preview: `window.buildBalanceSchedule(contract, parseFloat(jinv-amt), balMode, interest, jinv-date, jinv-complete)` → `schedule.map(s => `${s.seq}. ${s.label} — ${s.dueDate||'TBD'} — ₱${fmt(s.amount)}`).join('<br>')`.
Generate handler (12330-12374) — three changes:
1. **Numbering (decision 13):** build `inv` WITHOUT `no`; move the `confirmDialog` (12352, message no longer includes the number: `` `Generate ${kind==='downpayment'?'downpayment':'billing'} invoice for ₱${fmt(amt)} (${escHtml(p.clientName||'')})?` ``) BEFORE minting; then `inv.no = await window.nextSerial('billing_invoice','INV');`. Delete the `seq` line (12334) and the old `no:` line (12337).
2. **DP payload:** when `kind==='downpayment'` — `const pct = Math.max(0, Math.min(100, parseFloat(jinv-dppct)||0)); const schedule = window.buildBalanceSchedule(contract, amt, balMode, interest, inv.date, completeDate);` and extend `inv` with `kind, dpPercent:pct, schedule`; when standard, `kind:'standard'` only. Both kinds: `const acct = await window.BankAccounts.pick(jinv-bankacct);` and if picked, snapshot the full account onto the invoice: `inv.bank = { nickname, type, bankName, branch, accountName, accountNo }` (looked up from `BankAccounts.list({activeOnly:false})`).
3. **Persistence (decisions 7/8):** inside the existing transaction's `tx.update` (12360-12365), when `kind==='downpayment'` also set `dpPercent: pct, balanceSchedule: schedule` (if `p.balanceSchedule` already exists, the confirm in step 1 gains the suffix `' This replaces the existing balance schedule.'`).

**5b — `buildBillingInvoiceHTML` (departments.js:7654-…).** Title: `docTitle: inv.kind === 'downpayment' ? 'DOWNPAYMENT INVOICE' : 'BILLING INVOICE'` (7660) — same string in the non-letterhead fallback `.doc-title` (7725) and the `<title>`/export-bar labels. Insert between the "This Invoice" table (7755) and the Notes block (7757):
```js
  ${Array.isArray(inv.schedule) && inv.schedule.length ? `
  <div class="section-header" style="margin-top:12px">Payment Schedule — Balance After Downpayment</div>
  <table>
    <thead><tr><th style="width:8%">#</th><th>Milestone</th><th style="width:22%">Due Date</th><th class="number-cell" style="width:20%">Amount</th></tr></thead>
    <tbody>
      ${inv.schedule.map(s=>`<tr><td>${s.seq}</td><td>${escHtml(s.label||'')}</td><td>${s.dueDate?fmtD(s.dueDate):'TBD'}</td><td class="number-cell">₱${f(s.amount)}</td></tr>`).join('')}
      <tr class="muted-row"><td colspan="3" style="font-weight:700;text-align:right">Total balance after downpayment</td><td class="number-cell" style="font-weight:700">₱${f(inv.schedule.reduce((s,x)=>s+(+x.amount||0),0))}</td></tr>
    </tbody>
  </table>` : ''}
  ${inv.bank ? `
  <div class="section-header" style="margin-top:12px">Payment Instructions</div>
  <div class="notes-box">
    <strong>${inv.bank.type==='ewallet'?'E-wallet':'Deposit to'}:</strong> ${escHtml(inv.bank.bankName||'')}${inv.bank.branch?' — '+escHtml(inv.bank.branch):''}<br/>
    <strong>Account Name:</strong> ${escHtml(inv.bank.accountName||'')}<br/>
    <strong>Account No.:</strong> ${escHtml(inv.bank.accountNo||'')}<br/>
    Please send the deposit slip / transfer confirmation to ${escHtml((window.BRAND&&window.BRAND.legal.email)||'')} referencing invoice ${escHtml(inv.no||'')}.
  </div>` : ''}
```
Old invoices (no `kind/schedule/bank`) render byte-identically — both blocks are conditional.

**5c — sample invoice object (build/test against THIS):**
```js
{ no:'INV-2026-000124', kind:'downpayment', date:'2026-07-18', due:'2026-07-25',
  billTo:'ACME Foods Inc.', desc:'Downpayment (40% of contract)', amount:200000, dpPercent:40,
  schedule:[
    { seq:1, label:'Progress payment 1 of 3', dueDate:'2026-08-17', amount:100000 },
    { seq:2, label:'Progress payment 2 of 3', dueDate:'2026-09-16', amount:100000 },
    { seq:3, label:'Progress payment 3 of 3', dueDate:'2026-10-16', amount:100000 } ],
  bank:{ nickname:'BDO Checking — Main', type:'bank', bankName:'BDO', branch:'San Fernando, La Union',
         accountName:'NEILBARRO STEEL & METAL FABRICATION SERVICES', accountNo:'001234567890' },
  notes:'Kindly settle the amount due on or before the due date.',
  contractAmount:500000, paidToDate:0, balanceBefore:500000,
  projectName:'ACME Foods — BK-2026-071', projectNo:'JP-2607-014', issuedBy:'Neil Barro', createdAt:'2026-07-18' }
```
Rendered order (A4 page): letterhead header (`DOWNPAYMENT INVOICE`, BIR entity) → Bill-To / meta grid → **Account Summary** (Contract ₱500,000.00 / Less payments ₱0.00 / Outstanding ₱500,000.00) → **This Invoice** (Downpayment (40% of contract) ₱200,000.00 / AMOUNT DUE ₱200,000.00 / remaining after settlement ₱300,000.00) → **Payment Schedule** (3 rows + total ₱300,000.00) → **Payment Instructions** (structured BDO block) → **Notes** → letterhead footer/signatures.

### Spec 6 — Bank Accounts screen (registry + reconciliation UI)

- Tab: `finTabs` (departments.js:1999) gains `'Bank Accounts'` after `'Ledger'`; `loadFinanceContent` (2020) gains `case 'Bank Accounts': await window.renderBankAccounts(content); break;`.
- `window.renderBankAccounts(container)` (new, departments.js, near the other Finance renderers) — follows the `renderSalesOrders` table pattern: KPI row (**Cash Position** = `cashPosition().total`, active-account count, unreconciled-row count); accounts table (nickname, type icon 🏦/📱/💵, masked `accountNo`, opening ₱ @ date, **Book balance**, **Reconciled balance** — both from `computeBalances`, one call with and one without `reconciledOnly`), `active` badge; header button `+ Add Account` and per-row `✎` / `🗑` — all three gated client-side to `['president','manager','finance'].includes(currentRole)` (matching the rules gate); `🗑` calls `window.financeDelete({ collection:'bank_accounts', docId, label:… })` (decision 10 — NEVER a direct delete).
- Add/Edit modal: fields exactly per Spec 1 (nickname required; `openingBalance` number; `openingDate` default `bizDate()`; type select; `isDefault` checkbox — on save with it checked, loop the other docs and clear their `isDefault`). `escHtml` every rendered field; `BankAccounts.invalidate()` + re-render after any write; `logAudit('update','bank_account',id,{…})` on edits.
- Drill-down (click a row): loads `ledgerForPeriod('all')`, filters `r.bankAccountId===id && r.date>=openingDate`, sorts by date, renders date / description / refNumber / signed amount / running balance, plus per-row: **reconcile checkbox** → `doc.ref.update({ reconciled: <bool>, reconciledBy: currentUser.uid, reconciledAt: firebase.firestore.FieldValue.serverTimestamp() })`, and a **re-tag select** (move a mis-tagged row: `doc.ref.update({ bankAccountId, bankAccountName })`) — both permitted by the existing `ledger.update: canFinance()` rule; `dbCacheInvalidate('ledger')` after each write.

### Spec 7 — firestore.rules diffs (block-scoped, before→after)

**7a — NEW `bank_accounts` block.** Insert immediately after the `finance_delete_requests` block (firestore.rules:900-907).
```
    // ── Bank accounts registry (v12 WS36) ──────────────
    // Master data for the company's cash locations (bank / e-wallet / petty cash).
    // Balances are DERIVED client-side (opening anchor + tagged ledger flows) — no
    // balance field lives here, so nothing a buggy writer could drift. Reads are
    // books-operators only (account numbers are sensitive); create/update is the
    // money tier (matches payroll/pay_runs post-WS19); deletes are President-only —
    // the client routes them through finance_delete_requests like every finance doc.
    match /bank_accounts/{docId} {
      allow read:   if isAuth() && canFinance();
      allow create, update: if isAuth() && isMoneyAdmin()
        && request.resource.data.get('nickname', '') is string
        && request.resource.data.get('nickname', '') != ''
        && request.resource.data.get('openingBalance', 0) is number
        && request.resource.data.get('type', 'bank') in ['bank', 'ewallet', 'cash'];
      allow delete: if isAuth() && isPresident();
    }
```

**7b — `ledger` (firestore.rules:807-841): light `bankFlow` shape guard.** `.get(field,default)` so untagged rows and old clients pass (missing-field-throws memory).
```
// BEFORE (create head + update):
      allow create: if isAuth() && ledgerDateOk() && ledgerPeriodOpen() && (
      ...
      allow update: if isAuth() && canFinance();
// AFTER:
      allow create: if isAuth() && ledgerDateOk() && ledgerPeriodOpen()
        && request.resource.data.get('bankFlow', '') in ['', 'in', 'out'] && (
      ...
      allow update: if isAuth() && canFinance()
        && request.resource.data.get('bankFlow', '') in ['', 'in', 'out'];
```

**7c — `job_projects` (firestore.rules:1036-1043): money-keys guard (decision 12).**
```
// BEFORE:
      allow update: if isAuth() && (resource.data.createdBy == request.auth.uid || !isPartner());
// AFTER:
      // v12 WS36 — money keys need books access; stage/timeline/documents/tracking
      // edits stay open to internal staff exactly as before (affectedKeys diff, so
      // writes not touching money keys are unaffected).
      allow update: if isAuth() && (resource.data.createdBy == request.auth.uid || !isPartner())
        && ( !request.resource.data.diff(resource.data).affectedKeys().hasAny(
               ['payments', 'amountCollected', 'arBalance', 'invoices', 'dpPercent', 'balanceSchedule'])
             || canFinance() );
```

**7d — explicitly UNCHANGED:** `sales_orders` (update already `canFinance()`), `cash_advances` (approve-path update gate already covers the two new fields), `pay_runs` (state machine validates transitions, not keys — `disbursedFrom` rides the disburse flip), `payroll`, `_counters` (already `isFinanceOrAdmin()` write — covers the invoice mint), `ledger_entries`. No `firestore.indexes.json` change (decision 2 — no server-side query on `bankAccountId`).

### Spec 8 — Migration / rollout checklist (ordered)

1. **Deploy rules first** (7a-7c) via `~/.npm-global/bin/firebase deploy --only firestore:rules` — re-`git diff` against live immediately before (concurrent-session memory).
2. **Verify the payroll-compute bug status** (memory: `payroll-compute-existing-bug`, PR#2 2026-07-09) BEFORE shipping 4d. If still broken, ship WS36 without waiting — 4d is additive — but do not bundle that bug's fix into this commit.
3. **Ship the JS in one commit:** config.js (Spec 2a-2c), departments.js (Specs 3-6), `sw.js` `CACHE_VER` bump (manual, per CLAUDE.md; `APP_VERSION` auto-bumps). `node --check` each edited file; no build step.
4. **Seed the registry (Neil/finance, the cutover step):** Finance → Bank Accounts → add every real account (BDO/GCash/petty cash…) with `openingBalance` = the actual balance THAT morning and `openingDate` = that day; mark exactly one `isDefault`. **NO historical backfill — by design** (decision 3): pre-cutover rows stay untagged; the anchors make the derived balances exact from day one.
5. **Backups:** `bank_accounts` is auto-discovered by `scripts/monthly-backup.js` (point 13) — zero changes; no `OVERRIDES` entry needed (full JSON snapshot is right for master data).
6. **From cutover:** finance uses the pickers everywhere (they hard-require selection once accounts exist, Spec 3); cash position is live on the Bank Accounts tab and via `BankAccounts.cashPosition()` for WS40.
7. **Notify WS40** (its Fable pass runs after this): the handoff contract above — `cashPosition()`, registry-empty as the feature flag, the statutory-remittance fine-print gap.

### Spec 9 — Manual test checklist (no automated suite)

1. Registry: as finance, add "BDO Checking — Main" (`opening 100,000 @ today`, default) + "GCash" (`5,000`); list masks the number (`•••• 7890`); Cash Position KPI = 105,000. As a non-finance employee, the Bank Accounts tab is absent and a console read of `bank_accounts` is DENIED.
2. Record Sale ₱56,000 (VAT-inclusive) picking BDO → ledger `SO-{id}` row carries `bankAccountId/bankAccountName/bankFlow:'in'`; `sales_orders` doc + `job_projects.payments[0]` carry the pair; BDO book balance = 156,000. Attempting to save with no account selected → inline error.
3. Project billing ₱30,000 via GCash → `PROJ-{id}-{n}` tagged; GCash balance = 35,000; the payment entry in the project detail shows the account.
4. Payroll: Verify a run → Disburse now opens the account modal; pick BDO → `NETPAY-{month}` tagged `'out'`, `pay_runs.disbursedFrom` set, per-employee `PAY-` rows UNTAGGED; BDO drops by exactly the NETPAY amount.
5. CA: approve a ₱5,000 advance from GCash → `cash_advances` doc carries the pair; NEW ledger `CA-{id}` (asset, 'Advances to Employees') tagged `'out'`; P&L expense total UNCHANGED (asset row); GCash −5,000. Re-approve attempt → transaction throws 'no longer pending', no second row. President-delete the CA → `CA-{id}` row cascades away.
6. CDJ entry: ₱11,200 material from BDO → `CDJ-{id}` tagged; CDJ with ONLY `debitAP` ₱8,000 → NO expense row, but `CDJ-{id}-AP` (liability debit) exists, tagged `'out'`, P&L unchanged, BDO −8,000. Edit the entry's amount → `resyncLedgerForSource` updates both rows. Delete it → both rows cascade.
7. CRJ entry with ONLY `creditAR` ₱20,000 into BDO → no income row, `CRJ-{id}-AR` tagged `'in'`, BDO +20,000, P&L income unchanged.
8. Expense approve → account prompt appears; pick BDO → `EXP-{id}` tagged. Worker-payslip Submit → `WPAY-{id}` auto-tagged to the default account (toast unchanged); re-tag it to GCash from the drill-down and watch both balances move.
9. DP invoice: on a ₱500,000 project with `dpPercent:40`, generate a Downpayment invoice (stagger3, completion +90d, BDO selected) → number is `INV-2026-0001xx` (nextSerial; `_counters/billing_invoice` incremented); printable shows all sections per Spec 5c; `job_projects.dpPercent/balanceSchedule` persisted; cancel-at-confirm burns NO serial; regenerating warns about replacing the schedule. A pre-existing old invoice still renders identically (no schedule/bank blocks).
10. Reconciliation: drill into BDO, tick two rows → Reconciled balance = opening + those two only; untick → reverts. Rules: as finance, ledger update with `bankFlow:'sideways'` → DENIED; as an internal non-finance employee, `job_projects.update` touching `stage` → ALLOWED, touching `payments` → DENIED.
2. Is the running balance a STORED COUNTER (updated via `FieldValue.increment` at every tagged payment/disbursement, mirroring the `worker_profiles.caBalance` increment precedent at functions/index.js:163) or DERIVED on read by summing all ledger/CA/payroll rows tagged with that account's id? A derived balance can never drift but requires a full-collection scan or a new composite index; a stored counter is fast but needs the same discipline WS13 flagged for `arBalance` (point: "AR is DERIVED... so the KPI is always correct even if a project's stored arBalance drifted", departments.js:12060-12061) — does bank balance get the same derive-and-compare safety net, or is a single stored counter trusted outright?
3. Does adding a bank-account dimension require retrofitting EVERY existing money-writer in one pass (ledger's 8+ post functions, `CashAdvance.approve`, payroll Disburse, `openProjectBillingModal`, `openSalesOrderModal`, `recordPurchaseDisbursement`) before shipping, or is `bankAccountId` optional/nullable on all writers going-forward-only, with historical rows staying unattributed (a "no default account" gap forever, or a one-time backfill to a single default/unknown account)? This is the single highest-cost scoping question in this brief (see Risks).
4. What counts as "reconciliation" — is it a person manually marking individual ledger/payment rows as `reconciled:true/false` against a bank statement they're looking at externally, or does the system import/parse a bank statement (CSV/OFX) and auto-match rows? The mandate's "running reconciliation" phrase does not specify a mechanism.
5. Does `sales_orders` get fixed to support multiple payments (mirroring `job_projects.payments[]`/`openProjectBillingModal`'s pattern, replacing the current one-shot `SO-{id}` dupe-guard), or does the workstream instead standardize on `job_projects` as the ONLY place staged/DP billing happens, and treat `sales_orders`'s single "Record Sale" step as just the initial deal-confirmation (with all subsequent DP/progress/balance billing happening via the already-working `openProjectBillingModal`/`openJobBillingInvoiceModal` pair on the linked `job_projects` doc)?
6. Is the new downpayment invoice a distinct document TYPE (e.g. `docTitle:'DOWNPAYMENT INVOICE'` with its own template function), or an enhanced MODE of the existing `openJobBillingInvoiceModal`/`buildBillingInvoiceHTML` (departments.js:12313-12375 / 7654-onward) — e.g. when `pb-type`/an invoice-kind flag is `'Downpayment'`, render an extra "Payment Schedule" table (reusing the stagger/installment math already written and tested in quote-builder-v2.html:1821-1878) and a structured bank-instructions block, instead of the current generic Notes textarea?
7. Does the invoice's DP-percent get COMPUTED from a new stored field on `job_projects`/`sales_orders` (e.g. `dpPercent:number` set once at deal-confirmation time) or entered ad hoc per-invoice (matching how `openProjectBillingModal`'s amount field works today — no percent stored anywhere, just an absolute peso figure typed each time)?
8. Does the balance SCHEDULE (stagger-N / installment-N-months-with-interest) get persisted as structured data on `job_projects` (e.g. a `balanceSchedule:[{dueDate,amount,label}]` array computed once and stored, so future invoices/reminders can reference it), or is it computed fresh at invoice-print time from the same `dpMode`/`balMode`/`interestRate` inputs quote-builder-v2.html already has working math for (quote-builder-v2.html:1815-1873), re-entered by whoever generates the DP invoice?
9. Is the free-text `bankDetails` textarea already typed per-quote in quote-builder-v2.html (point 6) the SOURCE for the new invoice's bank-instructions block (i.e. finally wire that dead-end field through `createJobProject`/`openSalesOrderModal` into `job_projects`), or does the new `bank_accounts` registry supersede it entirely with structured fields (bank name / account name / account number / branch) selected from the registry per-invoice?
10. Who may create/edit `bank_accounts` records — `isMoneyAdmin()` (president/manager/finance, matching `payroll`/`pay_runs`/`cash_advances` create-gating post-WS19) or `isPresident()`-only (given bank account numbers are among the most sensitive data in the app, and the existing finance-delete-approval precedent already routes DELETES of any finance record through President approval even though finance can freely CREATE/EDIT everything else, per point 12)? Does editing an EXISTING bank account's number/closing it need the same President-approval routing as a finance delete, or is it just a normal `isMoneyAdmin()` edit?
11. Does `bank_accounts.read` need to be broader than finance (e.g. can any internal staff SEE which account a payment posted to, the way `sales_orders.read` is open to any non-partner staff per firestore.rules:1026-1028), or is the whole registry finance/admin-only read, matching `worker_profiles`'s finance-admin-only-no-owner-clause pattern?
12. Given `job_projects.update` is currently gated `createdBy==self || !isPartner()` at the rules level (i.e. NOT finance-restricted server-side, only client-UI-restricted, per the Constraints note above) — does adding a `bankAccountId` to `job_projects.payments[]` entries need a tightened rule (e.g. requiring `canFinance()` for any write that includes a `bankAccountId` field), or is the existing UI-only gate judged sufficient given money doesn't move until the linked ledger post (which IS rules-gated to `canFinance()`)?
13. Should the invoice numbering for a new downpayment-invoice document adopt `window.nextSerial('invoice','INV')` (the already-built, currently-unused atomic `_counters` transaction, letterhead.js:113-122), replacing the existing per-project-array-length scheme (`openJobBillingInvoiceModal`, departments.js:12337) for ALL billing invoices going forward, or should DP invoices mint numbers under a separate counter key/prefix (e.g. `DPINV-`) so as not to touch the already-shipped generic Billing Invoice's numbering?
14. Does `sales_orders.paymentMethod`/`job_projects.payments[].method` (currently a free-text string `'Bank Transfer'|'GCash'|'Cash'|'Cheque'|'Other'`) get REPLACED by a `bankAccountId` selecting from the new registry, or does it stay as a separate "how" field alongside a new "which specific account" field (e.g. someone selects method=`'Bank Transfer'` AND account=`'BDO Checking ****1234'` — two different axes that happen to co-vary)?

## Risks / cross-workstream interactions

- ⚠️ **Blast radius is the dominant risk of this entire workstream.** The one-paragraph V12-PLAN.md mandate ("bank accounts registry ... which account each payment hit") reads like a narrow, additive schema change, but per point 8 above, EVERY existing money-moving writer in the app — the ledger's 8+ distinct post functions (`postExpenseToLedger`/`postCRJToLedger`/`postCDJToLedger`/the payroll Compute legs/`openRecordSaleModal`'s `SO-` post/`openProjectBillingModal`'s `PROJ-` post/`consumeProductionMaterials`'s `POCOS-` post), `CashAdvance.approve` (config.js:1008-1034), `pay_runs` Disburse (`window.disbursePayRun`, departments.js:2512-2644), and `recordPurchaseDisbursement` (departments.js:13547-13633) — currently carries NO account-of-record dimension beyond a free-text method label. Tagging "which account each payment hit" for real, going forward, means touching all of these call sites, not just adding one new collection next to the ledger; retrofitting the same dimension onto the FULL HISTORY of already-posted rows (potentially years, per the repo's "records kept forever" owner directive, V12-PLAN.md:17-20) is a second, separable, and much larger migration question again (open decision 3). Fable should explicitly scope which of these writers are in v1 and which are deferred, rather than let an implementer discover the size of this mid-build.
- ⚠️ **Direct interaction with the payroll-pay-run-workflow (Compute→Verify→Disburse).** If `pay_runs` Disburse (`window.disbursePayRun`, departments.js:2512-2644, President-only, `firestore.rules:482-503` state machine) is one of the writers that gains a `bankAccountId`, that field has to be threaded through the SAME code the `payroll-compute-existing-bug` memory already flags as having a live pending ReferenceError bug (flagged for Neil in PR#2, 2026-07-09) — verify that bug's status before layering a new field onto the same function, to avoid conflating an unrelated bug fix with this workstream's changes.
- ⚠️ **Interaction with the finance-delete-approval precedent.** Finance/admin may freely create/edit almost everything, but deletes of finance records route through `finance_delete_requests` for President approval (firestore.rules:900-907, `financeDeleteCascade`, departments.js:141-186). A `bank_accounts` registry holding real account numbers is arguably MORE sensitive than the records that precedent already protects (payroll, ledger, expenses) — Fable must explicitly decide whether editing/closing an existing bank account needs the same President-approval routing, not just inherit whatever the default `isMoneyAdmin()` create/edit gate would otherwise grant (open decision 10).
- ⚠️ **Naming collision with WS13 (Chart of Accounts).** `account`/`accountType` are already load-bearing field names on every `ledger` row (point 2), read by 15+ sites across departments.js/app.js per `fable-workplan/13-coa.md`'s own Current State. A bank-accounts feature that casually calls its own field `account` will not error — it will silently produce a SECOND, differently-typed value under the same key name if a spec or an implementer isn't careful, corrupting the P&L/balance-sheet aggregations WS13 built. This is a real, easy-to-make mistake given how naturally "bank account" and "chart-of-accounts account" both compress to "account" in conversation.
- ⚠️ **Interaction with WS14 (Letterhead engine).** `window.buildLetterhead` (point 10) is stable, shipped, and already has 4 callers (Payslip, Billing Invoice, Inventory Count Form, Purchase Order) — a new downpayment-invoice document should be a 5th caller following the identical integration pattern (`_lh = window.buildLetterhead ? window.buildLetterhead({...}) : null`, then `${_lh ? _lh.headerHTML : <fallback>}` / `${_lh ? _lh.printCSS : ''}`), not a divergent new header/footer implementation. No other session is known to be actively modifying letterhead.js as of this writing (it is marked ✅ implemented) so there is low risk of a concurrent edit collision here specifically, but the CACHE_VER discipline still applies to any departments.js edit that adds a caller.
- ⚠️ **The existing Billing Invoice and Project Billing modal are close enough to the mandate that a naive spec risks building a wasteful, disconnected THIRD invoice/payment path.** Per points 4-5, `openProjectBillingModal` (multi-payment, Downpayment/Progress Billing/Final Balance typed) and `openJobBillingInvoiceModal`/`buildBillingInvoiceHTML` (letterhead-driven invoice document, already prints "Account Summary"/"This Invoice"/balance-after tables) already cover a large fraction of "downpayment billing invoice document ... wired into the sales-order downpayment flow." A spec that doesn't explicitly say "extend these two functions" risks an implementer building a parallel, disconnected new modal + new document type that duplicates 80% of already-working, already-letterhead-integrated code — the same "3-surfaces-disagree" bug class the CashAdvance system is flagged as having elsewhere in this repo's memory.
- ⚠️ **`sales_orders` vs `job_projects` is a real fork, not a stylistic choice.** `sales_orders` is one-shot and cannot record a second payment (point 3); `job_projects` already supports staged/multi-payment billing (point 4). If Fable's spec assumes "the sales order" is where downpayment tracking lives (matching the mandate's literal wording — "the sales-order downpayment flow"), it will run headfirst into the `SO-{id}` one-shot dupe-guard (departments.js:9544-9545) and either need to lift that restriction or redirect the whole feature onto `job_projects`, which is already doing this job today under a different name.
- ⚠️ **`quote-builder-v2.html`'s DP-schedule math (point 6) is a tempting but currently orphaned asset.** Its `renderPaymentSchedule`/`getDpAmount` (lines 1815-1878) already correctly compute stagger/installment schedules with dates and interest — reusing this logic (or porting it) for the new invoice's balance-schedule table is attractive, but it lives inside a giant, self-contained, iframe-hosted HTML file with its OWN `CO` company-branding object (a deliberate isolation choice per that file's own comments) and its own print CSS — it is NOT trivially importable into departments.js's letterhead-integrated invoice path without either duplicating the math or restructuring where it lives.

## Files likely touched

`js/departments.js` (`openSalesOrderModal` 9306-9384, `renderSalesOrders`/`openRecordSaleModal` 9387-9579 — if `sales_orders` gains multi-payment support; `openProjectBillingModal` 12238-12308, `openJobBillingInvoiceModal`/`buildBillingInvoiceHTML`/`window.openBillingInvoice` 7646-onward and 12313-12375 — the most likely extension points for the DP invoice + schedule; `createJobProject` 12014-12040 if a `dpPercent`/`bankDetails` field is added at project-creation time; `postExpenseToLedger`/`postCRJToLedger`/`postCDJToLedger`/`resyncLedgerForSource` 1434-1569, the payroll Compute ledger legs 2560-2628 (inside `window.disbursePayRun` 2512-2644), `recordPurchaseDisbursement` 13547-13633 — if any of these writers gain a `bankAccountId` field), `js/config.js` (`window.CashAdvance.approve` 1008-1034 if CA disbursement gains an account field; `window.BRAND`/`brandEntity` 844-905 if bank details move into a central config object; a new `dbCachedGet` cache key + `window.BankAccounts` service, if a shared helper service is chosen, following the `window.CashAdvance`/`window.LeaveAccrual` precedent of a single-writer IIFE-style object), `js/letterhead.js` (only if `buildLetterhead`'s options need a new capability, e.g. a generic line-item-table or bank-instructions-block helper factored out of the 4 existing callers — not expected to be required, since every existing caller already builds its own tables), `js/app.js` (the quote-filed bridge, 8132-8184, only if `bankDetails`/`payment.*` from a filed quote is finally threaded through into `job_projects` at Sales-Order-creation time), `quote-builder-v2.html` (only if its DP-schedule computation is ported/reused rather than re-derived — otherwise untouched, since it is confirmed structurally disconnected from this workstream's target collections), `firestore.rules` (`ledger` 807-841, `sales_orders` 1020-1032, `job_projects` 1036-1043, `cash_advances` 250-264, `payroll` 408-412, `pay_runs` 482-503 — any of these gaining a `bankAccountId`-shape validation; a brand-new `bank_accounts` match block and possibly a `bank_transactions`/reconciliation sub-collection block), `scripts/monthly-backup.js` (no code change required for basic coverage per point 13 — only touch `OVERRIDES`, ~118-158, if a `dateField`/`csvFields` override is wanted for `bank_accounts`), `sw.js` (CACHE_VER bump, mandatory on any JS/CSS edit per CLAUDE.md).

## Expected deliverable format

A numbered build spec Sonnet can execute without further judgment calls: one, the exact resolution of each open decision above stated as a one-line policy (e.g. "stored counter, derived-balance safety check on read, going-forward-only tagging with historical rows left `bankAccountId:null`"). Two, the literal new `bank_accounts/{docId}` (and any reconciliation/transaction sub-shape) document shape — field name, type, default — plus a literal `firestore.rules` diff in the same before/after block-scoped style as the existing rules file, explicitly naming which of the existing money-writers (enumerated in Risks) are in scope for v1 tagging vs explicitly deferred. Three, exact function-level before/after diffs anchored to the file:line citations in this brief — at minimum `openSalesOrderModal`/`openRecordSaleModal` or `openProjectBillingModal` (whichever is chosen per open decision 5) gaining a `bankAccountId` selector, and `openJobBillingInvoiceModal`/`buildBillingInvoiceHTML` gaining the DP-percent line, balance-schedule table, and structured bank-instructions block (or a clear statement that these are net-new functions instead, per open decision 6) — so Sonnet can locate and replace mechanically. Four, a numbered migration checklist covering: deploy rules first, ship the JS, and an explicit statement of whether/how historical `ledger`/`cash_advances`/`job_projects.payments[]` rows get backfilled with a `bankAccountId` (or explicitly do not, per open decision 3) — in the dependency-ordered style of the existing `backfillPayrollLedger`/`backfillLedgerFromJournals` precedents. Five, a literal sample invoice data object and its rendered field layout (Account Summary / Payment Schedule / Bank Instructions sections) so Sonnet can build `buildBillingInvoiceHTML`'s DP variant against a concrete example rather than an abstract description. Six, an explicit note on which of workstream 13 (Chart of Accounts — naming collision), 14 (Letterhead — integration pattern), 19 (Security — money-tier role gates), and 20 (One payroll engine — if payroll Disburse is in scope for v1 account-tagging) this spec depends on or must be sequenced around.
