# Workstream 39 — BIR suite (books of account, statutory worksheets, VAT correctness, financial statements)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

Plan text (V12-PLAN.md:223-226, Phase 5): "BIR suite — books of account prints (general
journal, general ledger, cash receipts, cash disbursements); 2550M/Q, 1601-C worksheets,
alphalist, 2316; OR/SI series; net-of-VAT statements; input-VAT capture on expenses (fixes
the overstated VAT bugs); formal Financial Statement print (income statement + balance
sheet + VAT summary)." This is the last unspecced Phase-5 workstream and, per its own plan
entry, the highest-compliance-risk one — real government filings, not internal tooling.
All line numbers below verified live via grep/Read against the current tree (branch
`auto/daily-review-2026-07-09`, HEAD `e6cdee6`) on 2026-07-10.

=== 1) THE "OVERSTATED VAT" BUG IS ALREADY PARTIALLY FIXED — pre-dates this v12 rebuild, and the fix is INCOMPLETE, not absent ===

Contrary to a flat "VAT is overstated" framing, `git log -S inputVat -- js/departments.js`
shows a real prior commit, `db5a526` ("Finance: net input VAT on purchases → Net VAT
Payable", 2026-06-27, already an ancestor of current HEAD — predates this v12 session
entirely): "Purchase disbursements + manual cash disbursements now capture input VAT
(VATable / exempt), stored on the ledger debit... Financial Reports nets input VAT against
output VAT and shows Net VAT Payable (or Creditable)." `window.renderFinancialReports`
(departments.js:3404-3500) confirms this is live: `outputVat` sums each sale's stored
`vatAmount` (falls back to `amount - amount/1.12` for legacy rows with no `vatAmount`,
departments.js:3438-3441); `inputVat = expense.reduce((s,e)=>s+(e.inputVat||0),0)`
(departments.js:3444); `netVat = outputVat - inputVat` (departments.js:3445), rendered as
"Net VAT Payable/Creditable" in the "🧾 Tax / VAT Reference" card (departments.js:3490-3497).

**But `inputVat` is captured on only 2 of the (at least) 5 code paths that write an
expense/debit into the `ledger` collection — grep-quantified exhaustively:**
- `postCDJToLedger` (departments.js:1491-1521, ref `CDJ-{id}`) — **captures it**:
  `inputVat: e.vatAmount || 0` (departments.js:1514), sourced from the Cash Disbursement
  Journal form's "Input VAT" selector (departments.js:3989-3992, `window.vatSplit` at the
  'inclusive'/12% default).
- `recordPurchaseDisbursement` (departments.js:13547-13650, Purchasing → "Record as
  Disbursement") — **captures it**: its own "Input VAT" selector (departments.js:13567-13572,
  live preview via `recVatPreview`) computes `inputVat = vatTreatment==='exempt' ? 0 :
  window.vatSplit(amt,'inclusive').vat` (departments.js:13605) and writes it onto the
  `cash_disbursement_journal` doc's `vatAmount`, which `postCDJToLedger` then carries
  through — so purchase-side disbursements are fully covered end-to-end.
- `postExpenseToLedger` (departments.js:1434-1455, ref `EXP-{id}`, fed by the general
  employee "Add Expense / Receipt" flow) — **does NOT capture it**. Its ledger write has no
  `inputVat` field at all (departments.js:1441-1452), and the submission form itself,
  `openAddExpenseModal` (departments.js:1686-1727), has **zero VAT-related fields** — just
  description/amount/date/a free-pick category (Office Supplies/Transportation/Meals/
  Materials/Utilities/Other) and a receipt upload. This is the most commonly reachable
  expense-entry path in the app (any employee, any department, not finance-gated), so any
  VATable receipt submitted through it is silently excluded from the input-VAT netting —
  Net VAT Payable is **still overstated** for exactly this class of expense.
- The Finance → Ledger tab's own manual direct-entry form (`led-*` fields, departments.js:
  3746-3782) — **does NOT capture it**: Account Type/Account/Amount/Reference only, no VAT
  field, so a finance user manually logging a VATable expense here also produces an
  un-netted debit.
- The dept-scoped budget-expense entry modal used by non-Finance departments to log their
  own dept expenses to the shared ledger (departments.js:11600-11650ish, `exp-*` fields) —
  **does NOT capture it** either (same pattern: type/amount/category/budget-line, no VAT).
- Production's COS/material-consumption postings (`consumeProductionMaterials`,
  departments.js:12570-12630, refs `POCOS-{id}`/`POCOS-{id}-INV`) correctly carry **no**
  VAT field — input VAT was already claimed when the material was purchased (CDJ), so this
  is by design, not a gap.

Net effect, precisely stated: **output VAT is captured for every sale (100% coverage,
via `window.vatSplit` at time of recording income); input VAT is captured for
purchases/disbursements routed through Purchasing or the Cash Disbursement Journal, but
NOT for the general "Add Expense" flow, the manual Ledger-tab entry, or dept
budget-expense entries.** The mandate phrase "input-VAT capture on expenses (fixes the
overstated VAT bugs)" is therefore a real, scoped, still-open gap — just a narrower one
than "VAT is entirely output-only," which is what the repo's own stale audit-era memory
implies.

`window.vatSplit` (departments.js:9450-9461, the one shared VAT-math primitive used by
every path above and by the Sales/Design/Project billing flows) is quoted here verbatim,
since any BIR VAT report must reuse it rather than re-deriving VAT math:
```js
window.vatSplit = function(entered, treatment) {
  const a = +entered || 0;
  if (treatment === 'exclusive') {
    const vat = +(a * 0.12).toFixed(2);
    return { recorded: +(a + vat).toFixed(2), net: +a.toFixed(2), vat };
  }
  if (treatment === 'exempt') {
    return { recorded: +a.toFixed(2), net: +a.toFixed(2), vat: 0 };
  }
  const net = +(a / 1.12).toFixed(2); // inclusive (default)
  return { recorded: +a.toFixed(2), net, vat: +(a - net).toFixed(2) };
};
```

=== 2) NONE of the named books-of-account PRINT documents exist — grep-confirmed zero hits, but the underlying raw data already exists in 3 different shapes ===

`grep -rniE "general.journal|general.ledger|cash.receipts.book|cash.disbursements.book" js/*.js`
returns only the `general_journal`/`cash_receipt_journal`/`cash_disbursement_journal`
*collection names* (raw journals, described below) — there is no `@media print` CSS, no
`window.print()` call, no `buildLetterhead(...)` call, anywhere tied to any of these four
book names. What exists instead, as raw ingredients:
- **`ledger`** (top-level collection) — the one collection every report in the app already
  reads (`renderFinancialReports`, the Ledger tab, CSV export). Each doc: `date`, `type`
  ('credit'|'debit'), `accountType` ('income'|'expense'|'asset'|'liability'|'equity', v12
  WS13; legacy rows lack it and fall back through `window.ledgerKind()`/`COA_LEGACY_MAP`,
  config.js:664-683), `account` (a COA leaf name), `category`, `amount`, `refNumber`
  (deterministic prefixes: `EXP-`, `CRJ-`, `CDJ-`, `PAY-{month}-{uid}` /`-ER`, `SSSPAY-`/
  `PHPAY-`/`HDMFPAY-`/`WHTPAY-`/`NETPAY-{month}` aggregates, `WPAY-`, `POCOS-`/`-INV`,
  `DPROJ-`), `source`, `vatAmount`/`inputVat` (partial, see §1), `addedBy`/`addedByName`,
  `createdAt`. This is functionally a **combined cash+general ledger already** — but only
  ever rendered as a flat chronological list (renderLedgerTab, departments.js:3657+) or a
  category-summed Income Statement, never grouped **per account** (a true "General Ledger"
  book is a per-account T-account listing, which nothing currently produces).
- **`general_journal`** (top-level collection, firestore.rules:858-862, `canFinance()`
  read/write, president-only delete) — **has NO creation path anywhere in the codebase**.
  Grep for `collection('general_journal').add` across every `js/*.js` and `scripts/*.js`
  file: **zero hits.** It is only ever *read* (departments.js:3408, 3661, merged into the
  Ledger tab and Financial Reports) and *edited/deleted* if a row already exists
  (`financeEditModal`, departments.js:3793, edit fields: `date`, `accountTitle`, `debit`,
  `credit`, `reference`) — meaning this is very likely a legacy/orphaned collection from an
  earlier app version or a manual seed, not an actively-written book today. Any "general
  journal" print built to read this collection will show stale or empty data unless a
  decision is made either to feed it going forward or to redefine what the print reads
  (most likely: synthesize a general-journal-style double-entry view FROM `ledger` +
  `cash_receipt_journal` + `cash_disbursement_journal`, which ARE actively written).
- **`cash_receipt_journal`** / **`cash_disbursement_journal`** (top-level collections,
  firestore.rules:848-857, `canFinance()`) — these ARE actively written (CRJ via
  `openRecordSaleModal`-adjacent flows and a dedicated CRJ form at departments.js:3820-3930;
  CDJ via the CDJ form at departments.js:3931-4049 and `recordPurchaseDisbursement`). Each
  doc mirrors into `ledger` via `postCRJToLedger`/`postCDJToLedger` (idempotent, keyed by
  `CRJ-{id}`/`CDJ-{id}`, re-synced on edit via `resyncLedgerForSource`,
  departments.js:1527-1569). These are the natural source for a BIR-style Cash Receipts
  Book / Cash Disbursements Book print — the raw transactional data (payee/customer,
  reference, date, debit/credit account breakdown, VAT) already exists per-doc; only the
  BIR-formatted, letterhead-branded, page-numbered PRINT rendering is missing.
- **`tax_records`** (top-level collection, firestore.rules:868-872, `canFinance()`) — backs
  a "Taxes" tab (`renderTaxesTab`, departments.js:3293-3380) that is a **manual filing
  tracker only**: period (free text), type (a fixed dropdown: BIR-Quarterly/BIR-Annual
  ITR/VAT/Withholding Tax/Percentage Tax), amount (hand-typed), due date, status
  (pending/filed/paid), and a file-upload slot to attach the already-filed BIR PDF. It does
  **not compute** any of these amounts — a human must already know the 2550Q/1601-C figure
  and type it in. This is the natural companion UI for whatever WS39 builds (e.g., a
  "Generate 2550Q" action could pre-fill a `tax_records` entry with the computed VAT
  figure) but is not itself a worksheet generator.

=== 3) Statutory worksheets (2550M/Q, 1601-C, alphalist, 2316) have NO code at all — but 3 of 4 already have partial raw data waiting, thanks to WS20/21's payroll rebuild this session ===

`grep -in "alphalist|1601|2550|2316" js/*.js firestore.rules functions/*.js` → **zero
hits**, confirming a clean greenfield for all four documents specifically. What already
exists as raw material, precisely:
- **1601-C (monthly withholding tax remittance)** — `js/statutory-tables.js` (60 lines,
  v12 WS21, loads after config.js, before departments.js) defines `window.STATUTORY[2026]`
  and `window.computeStatutory({grossPay,year})`, which returns
  `{ ee:{sss,philhealth,pagibig,tax}, er:{sss,philhealth,pagibig}, unverified }` — `ee.tax`
  is exactly the per-employee monthly withholding figure 1601-C needs. Better still,
  **WS20's disburse step already posts the aggregate**: `disbursePayRun` (departments.js,
  around 2536-2630) posts a `WHTPAY-{month}` ledger credit leg tagged
  `accountType:'liability', account:'Withholding Tax Payable'` for the exact aggregate tax
  withheld that month (departments.js:2610-2622, quoted):
  ```js
  const aggLeg = async (ref, account, amount) => {
    if (amount <= 0) return;
    await upsertLedger(ref, {
      date: month+'-01', type:'credit', accountType:'liability', account,
      description: `${account} — ${monthLabel} payroll`, amount,
      category:'Payroll Expense', source:'Finance', refNumber: ref,
      addedBy: currentUser?.uid, addedByName, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  };
  await aggLeg(`SSSPAY-${month}`,  'SSS Payable',        sssAgg);
  await aggLeg(`PHPAY-${month}`,   'PhilHealth Payable', phAgg);
  await aggLeg(`HDMFPAY-${month}`, 'Pag-IBIG Payable',   piAgg);
  await aggLeg(`WHTPAY-${month}`,  'Withholding Tax Payable', taxAgg);
  ```
  `window.COA`'s liability list (config.js:658-659) literally carries a forward-reference
  comment planted by that same session: `'SSS Payable', 'PhilHealth Payable', 'Pag-IBIG
  Payable', 'Withholding Tax Payable' // v12 WS20/21 — per-agency remittance legs (WS39
  reads these)`. So the exact monthly aggregate 1601-C/SSS/PhilHealth/Pag-IBIG remittance
  figures are already sitting in the ledger as one queryable row per month per agency —
  only the BIR-formatted worksheet/print is missing. **Caveat**: this aggregate is
  regular-employee-only; weekly `worker_profiles` payroll's employer share is "manual-only"
  per WS24 decision 3 (`employerShare: null` on the weekly payslip model,
  departments.js:5190,5245) — a remittance report spanning production workers would be
  incomplete without a separate read of `payslips` docs.
- **2550M/Q (VAT return)** — the exact output/input VAT math already exists in
  `renderFinancialReports` (§1 above) and is period-scoped via `window.Period` (WS12,
  config.js:688+), which already supports a `quarter:YYYY-Qn` key
  (`window.Period.parse('quarter:2026-Q1')` → `{start,end,label:'Q1 2026'}`,
  config.js:703-705) — the exact granularity 2550Q needs, with zero new date-math required.
  What's missing: a BIR-formatted worksheet layout (2550M/Q has a specific field
  structure — output VAT, input VAT carried over from prior period, net payable/creditable,
  penalties) and the input-VAT-coverage gap from §1.
- **Alphalist / 2316 (annual per-employee compensation + tax withheld)** — **no TIN/SSS
  number/PhilHealth number/Pag-IBIG number field exists anywhere on `users` or `payroll`
  docs** for regular (monthly) employees — confirmed by grep and by
  `window.toPayslipModel`'s own 'monthly' branch (departments.js:5226-5228), which
  **hardcodes these fields to empty strings** for every monthly employee's payslip:
  ```js
  employee:{ name:source.name||source.userName||'', idNumber:source.employeeId||'',
             jobTitle:source.title||'', department:source.department||'',
             tin:'', sss:'', philhealth:'', pagibig:'' },
  ```
  (Contrast with the 'weekly' branch at departments.js:5250-5252, which DOES populate
  `tin:source.tinNum, sss:source.ssNum, philhealth:source.phNum, pagibig:source.pagibigNum`
  — because `worker_profiles` docs, HR-typed free text, DO carry these fields, per WS26/27's
  grounding.) Alphalist and 2316 are both legally required to carry each employee's TIN at
  minimum — this is a hard blocking data-model gap for the majority (monthly-paid) of the
  workforce, not a report-formatting problem. Separately, **no YTD withholding-tax
  aggregation exists at all**: `window.payslipYtdMonthly` (departments.js:5268-5274) sums
  `gross`/`net`/`base` from `salary_history` for the year but never sums `tax` — the
  per-month `tax` figure is on each `salary_history` doc (via `computeStatutory`) but
  nothing rolls it up across 12 months per employee today, which is the central number
  2316 exists to certify.

=== 4) OR/SI numbering series — no series exists; the exact atomic-counter mechanism this needs was already built by WS14 but is unused ===

Every "Official Receipt" reference in the app today is a **free-text input a human
types** — e.g. `<div class="form-group"><label>OR / Reference No.</label><input id="rs-ref"
placeholder="Official Receipt no."/></div>` (departments.js:9500, repeated at
departments.js:12260) — not a system-generated, gap-free, sequential BIR series number.
There is likewise no "Sales Invoice" numbering; "Official Receipt"/"Invoice"/"Voucher" only
appear as free-choice `<option>` values in a generic document-type dropdown
(departments.js:4065, 4099, 4138). The one auto-incrementing-ID precedent in the codebase,
`_counters/{docId}` (firestore.rules:154, `isAuth() && isAdmin()`; used today for
`_counters/employees` → `BI-{year}-{seq}` employee IDs, app.js:440-446), was already
generalized by WS14 into a reusable helper that is **built but never called**
(`js/letterhead.js:111-122`, quoted verbatim, comment included):
```js
// ── Bonus: atomic doc-serial for future BIR docs (reuses _counters, already rules-covered) ──
// e.g. await nextSerial('invoice','INV') -> 'INV-2026-000123'. Not called by WS14 conversions.
window.nextSerial = async function (counterKey, prefix) {
  const ref = db.collection('_counters').doc(counterKey);
  const n = await db.runTransaction(async t => {
    const c = await t.get(ref);
    const next = (c.exists ? (c.data().count || 0) : 0) + 1;
    t.set(ref, { count: next }, { merge: true });
    return next;
  });
  return `${prefix}-${(window.bizYear ? window.bizYear() : new Date().getFullYear())}-${String(n).padStart(6, '0')}`;
};
```
This produces a plain sequential-per-year serial (`PREFIX-YYYY-000123`), which is
race-safe (atomic transaction, same pattern proven by the employee-ID counter) but is
**not** necessarily what BIR's Authority-to-Print (ATP) regime requires — an ATP-registered
OR/SI series is normally a pre-approved, gap-free numeric range tied to a specific
printer/permit, not an app-generated per-year reset. Whether `nextSerial` as written is
adequate for OR/SI, or needs an ATP-range-aware variant (start/end bounds, no year reset),
is a real open decision, not an engineering-obvious extension.

=== 5) Letterhead + brand-entity switching — already built (WS9/WS14), already proven for a BIR-scoped document, ready to reuse as-is ===

`window.buildLetterhead(opts) → {headerHTML, footerHTML, printCSS}` (js/letterhead.js,
123 lines total, quoted in relevant part above under §2's ingredients) is the canonical
shared print-header engine (WS14, seam-reconciled per fable-workplan/INDEX.md as the ONE
letterhead API — WS24's payslip and WS9's rename sweep both already call it). Entity
resolution is exactly the mechanism this workstream needs and already works correctly:
`window.brandEntity(kind)` (js/config.js:897-905, quoted verbatim):
```js
window.brandEntity = function(kind){
  var L = window.BRAND.legal;
  if (kind === 'bir') return {
    name: L.dtiName, registration: 'DTI-registered · BIR-registered',
    tin: L.dtiTin, address: L.address, phone: L.phone, email: L.email };
  return {  // 'corporate' (default)
    name: L.opcName, registration: L.opcRegistration,
    tin: L.opcTin, address: L.addressShort, phone: L.phone, email: L.email };
};
```
`brandEntity('bir')` resolves to `L.dtiName = 'NEILBARRO STEEL & METAL FABRICATION
SERVICES'` with a real TIN, `L.dtiTin = '951-145-613-000'` (js/config.js:859-860) — this
is the DTI sole-proprietorship, the actual registered BIR taxpayer today (per the same
comment: "currently printed on payslips + billing invoices"). The 'corporate' (OPC) branch
has `opcTin: ''` — **explicitly flagged in-code**: `// ‼️ FLAG FOR NEIL — OPC TIN not
present anywhere in code` (config.js:856) — meaning `brandEntity('corporate')` is NOT
filing-safe (no TIN at all) and BIR documents must use `brandEntity('bir')`, exactly as
WS14 already did for payslips/billing invoices (`buildPayslipHTML`/`buildBillingInvoiceHTML`,
per the WS09+14 Build Log entry). **This is a solved problem for WS39** — no new brand
plumbing is needed, only calling the existing function correctly for every new BIR print.

=== 6) A ledger read cap that silently threatens exactly this class of report ===

`window.renderFinancialReports` (the function every VAT/income-statement number in the
app currently flows through) fetches `db.collection('ledger').orderBy('date','desc')
.limit(3000).get()` and `db.collection('general_journal')...limit(3000).get()`
(departments.js:3406-3409), THEN filters the results to the requested period client-side
(`all.filter(e => window.Period.match(e.date, pParsed))`, departments.js:3420). Because
the query fetches the **3000 most recent rows across the entire collection's history**
before any period filter is applied, once total ledger size exceeds ~3000 docs (plausible
for an active manufacturer after a few years of operation), a report requested for an
**older** period (e.g. a prior-year quarter for an amended 2550Q, or a prior year's
alphalist/2316) can silently return **artificially low or zero figures** — the query never
even reaches rows that old. This is a pre-existing risk in the current reports screen, not
something WS39 introduces, but it becomes acutely dangerous for THIS workstream
specifically: an internal dashboard being wrong is a UX bug; a BIR filing or financial
statement being silently wrong from a truncated read is a compliance incident. Any WS39
report/statement/worksheet that reuses this exact pattern inherits the bug; any that adds
its own date-range-bounded query (`where('date','>=',...).where('date','<=',...)`, the
pattern WS16 already established elsewhere — `window.ledgerForPeriod`/`ledgerSince` in
config.js) avoids it but likely needs a new composite index (see Data model).

=== 7) The `finance_rollup` aggregation doc that WS13/WS16 both deferred to "whoever builds WS39" is still unbuilt ===

WS16's brief (fable-workplan/16-perf.md:119,128) explicitly deferred building a
`finance_rollup/{YYYY-MM}` aggregation doc to WS13 ("Recommended shape *for WS13 when it
builds it*..."), and WS13's own Build Log entry (the one that actually shipped) makes
**no mention of building it** — grep-confirmed zero hits for `finance_rollup` anywhere in
`js/*.js` or any `fable-workplan/*.md` DECIDED section. `renderFinanceOverview`
(departments.js:5402+) still does a full, uncached-until-WS16, all-time `ledger` collection
read for its lifetime Income/Expense KPI (departments.js:5412, comment: `// ALL-TIME
totals — shared TTL; WS13 replaces with finance_rollup` — a comment describing a plan that
never executed). This matters for WS39 because annual documents (alphalist, the annual
Financial Statement, year-over-year VAT summaries) are exactly the queries a rollup doc
would make cheap and reliable — building it now (or explicitly deciding not to and
documenting why) is squarely this workstream's decision to make, not a re-litigation of
WS13/16.

=== 8) VAT-registration classification is not discoverable from code — a business-fact gap, not an engineering one ===

Nothing in `js/config.js`'s `window.BRAND`, the company-info HTML file, or anywhere else
in the repo records whether the DTI taxpayer entity is VAT-registered (files 2550M/Q) or a
Non-VAT/percentage-tax payer (would file 2551Q instead, a materially different form with
no output/input VAT netting at all). The app currently computes and displays VAT
unconditionally (every sale gets a VAT treatment picker defaulting to 'inclusive' 12%),
which only makes sense if the entity IS VAT-registered — but this is inferred from app
behavior, not confirmed by any business record in the repo. This is exactly the kind of
fact Fable cannot resolve by reading code; it needs to be an explicit flag for Neil/the
accountant, the same discipline already established for WS21's unverified statutory rates.

## Data model

`ledger/{docId}` (top-level; the collection every existing financial report already reads;
would back the General Ledger/VAT-summary/Financial-Statement prints): `date` (YYYY-MM-DD
string), `type` ('credit'|'debit'), `accountType` ('income'|'expense'|'asset'|'liability'|
'equity' — v12 WS13; absent on legacy rows, derive via `window.ledgerKind(row)`), `account`
(a `window.COA` leaf string), `category` (display label, often equal to `account`),
`amount` (number), `refNumber` (deterministic prefix per source, enumerated in §2 above),
`description`, `source` (e.g. 'Finance'|'Cash Disbursement'|'Cash Receipt'|'Expense'|
'Production'|dept name), `vatAmount` (output VAT, sales rows only, set via `window.vatSplit`),
`inputVat` (reclaimable input VAT — only ever set by `postCDJToLedger`, §1), `projectId`
(optional, links a sale to a project record), `dept`/`budgetLineId`/`budgetLineName`
(dept-expense rows only), `addedBy`/`addedByName`, `createdAt` (serverTimestamp). Rules
(firestore.rules:807-841): read `canFinance()`; create `canFinance()` OR a tightly-fenced
Production-only shape (COS material debit + Inventory contra-credit, both
`refNumber`-pattern-matched, per WS13); update `canFinance()`; delete `isPresident()` only;
every create additionally gated by `ledgerDateOk()`+`ledgerPeriodOpen()` (WS12's period-close
mechanism, firestore.rules ~780-800).

`general_journal/{docId}` (top-level; orphaned — no writer, §2): `date`, `accountTitle`
(or legacy `description`), `debit` (number), `credit` (number), `reference` (or legacy
`refNumber`). Rules (firestore.rules:858-862): `canFinance()` read/create/update,
`isPresident()` delete.

`cash_receipt_journal/{docId}` / `cash_disbursement_journal/{docId}` (top-level, actively
written): CRJ fields include `date`, `customer`, `reference`, `creditSalesRevenue`,
`creditSundryAcct`, `creditSundryAmount`; CDJ fields include `date`, `payee`, `reference`,
`debitMaterial`, `debitLabor`, `debitSundryAcct`, `debitSundryAmount`, `debitAP`,
`debitAccount` ('inventory'|'material'|'ap'|'sundry', v12 WS13 asset-vs-expense tag),
`vatAmount`, `vatTreatment` ('inclusive'|'exempt', input VAT only, §1), `purchaseRef`
(when created from Purchasing). Both mirror into `ledger` on create/edit via
`postCRJToLedger`/`postCDJToLedger`/`resyncLedgerForSource` (departments.js:1457-1569).
Rules (firestore.rules:848-857): `canFinance()` read/create/update, `isPresident()` delete.

`tax_records/{docId}` (top-level, manual filing tracker, §2): `period` (free text, e.g.
"Q1 2026"), `type` (one of 'BIR - Quarterly'|'BIR - Annual ITR'|'VAT'|'Withholding Tax'|
'Percentage Tax'), `amount`, `dueDate`, `status` ('pending'|'filed'|'paid'), `fileUrl`/
`fileName` (the filed BIR form attachment), `filedBy`/`filedByName`, `createdAt`. Rules
(firestore.rules:868-872): `canFinance()` read/create/update, `isPresident()` delete.

`salary_history/{uid}_{month}` (top-level, one doc per employee per month, WS20/21/23/24):
carries `base`/`salary`, `allowance`, `sss`/`philhealth`/`pagibig` (EE peso amounts from
`computeStatutory`), `tax` (EE withholding, the 1601-C/2316 input), `er:{sss,philhealth,
pagibig}` (ER shares), `finalPay`/`netPay`, `caDeductions`. Composite index
`salary_history(userId,month)` already exists (firestore.indexes.json). **No YTD tax
rollup exists** — `window.payslipYtdMonthly` (departments.js:5268-5274) sums gross/net/base
only, never `tax` (§3).

`payroll/{uid}` / `users/{uid}` (regular employees): `salary`/`allowance`/`deductions`
(payroll doc); `displayName`/`email`/`role`/`department(s)`/`employeeId`/`title`/`phone`
(users doc). **No `tin`/`ssNum`/`phNum`/`pagibigNum` field exists on either** — confirmed
by grep and by `toPayslipModel`'s hardcoded empty-string employee-ID-number fields for the
'monthly' kind (§3). `worker_profiles/{autoId}` (weekly/production workers) DOES carry
`tinNum`/`ssNum`/`phNum`/`pagibigNum` as HR-typed free text (departments.js:4580,4654) —
this is the one place in the app any of these numbers exist today, and only for the
minority hourly/weekly workforce.

`window.COA` (js/config.js:652-661, v12 WS13, quoted): `income:['Sales Revenue','Other
Income']`, `expense:['COS – Direct Material','COS – Direct Labor','Payroll Expense',
'Operating Expense','Utilities','Tax','Materials','General Expense','Other Expense']`,
`asset:['Cash','Accounts Receivable','Inventory']`, `liability:['Accounts Payable','VAT
Payable','Statutory Payables','SSS Payable','PhilHealth Payable','Pag-IBIG Payable',
'Withholding Tax Payable']` (the last four already comment-tagged "WS39 reads these"),
`equity:["Owner's Equity",'Retained Earnings']`. Note `'VAT Payable'` is a listed liability
account name that **nothing currently posts to** — Net VAT Payable today is a read-only
computed display figure (§1), never an actual ledger liability entry, unlike the payroll
per-agency legs which ARE posted (§3).

`window.STATUTORY[2026]` / `window.computeStatutory` (js/statutory-tables.js, whole file
quoted in §3) — SSS/PhilHealth/Pag-IBIG/TRAIN-withholding bracket tables, every figure
marked PLACEHOLDER, `verified:false`; `computeStatutory({grossPay,year})` returns
`{ee:{sss,philhealth,pagibig,tax}, er:{sss,philhealth,pagibig}, unverified}` and
console-warns on every call while `verified:false`.

`window.BRAND.legal` / `window.brandEntity(kind)` (js/config.js:844-905, quoted in §5) —
`dtiName`/`dtiTin` (the real BIR taxpayer identity) vs `opcName`/`opcTin:''` (marketing
entity, no TIN). `window.buildLetterhead(opts)` (js/letterhead.js) — shared print-header/
footer/CSS builder, entity-aware via `opts.entity || brandEntity('corporate')` default (a
WS39 caller must pass `entity: window.brandEntity('bir')` explicitly, matching WS14's own
payslip/invoice precedent). `window.nextSerial(counterKey, prefix)` (js/letterhead.js:
111-122, quoted in §4) — atomic per-year sequential serial via `_counters/{counterKey}`,
built, rules-covered, never called by any live code path yet.

`_counters/{docId}` (firestore.rules:154, `isAuth() && isAdmin()` read/write) — existing
docs: `employees` (BI-{year}-seq IDs). A new OR/SI series would add e.g. `_counters/or` /
`_counters/si`, already covered by the existing wildcard-free but doc-generic rule (no new
rules block needed UNLESS the write-role for OR/SI minting should differ from plain
`isAdmin()`, e.g. `canFinance()` since Finance, not IT/admin, issues receipts).

`window.Period` (js/config.js:688+, v12 WS12) — canonical keys `month:YYYY-MM`/
`quarter:YYYY-Qn`/`year:YYYY`/`all`, `.parse(key)→{type,start,end,label}`,
`.match(dateStr,parsedKey)`. Already used by `renderFinancialReports`'s period picker and
therefore trivially reusable for 2550M (month) / 2550Q (quarter) / alphalist-2316 (year)
period selection with zero new date-math.

## Constraints — must respect

- Manila-time discipline: any new period-boundary logic (fiscal month/quarter cutoffs,
  "as of" filing dates) must use `window.bizDate()`/`bizYear()`, never raw
  `new Date().toISOString()` — the standing config.js:10-16 warning this repo has hit
  before (attendance/payroll UTC-day bugs).
- `escHtml()` before any innerHTML interpolation of user/HR-entered strings (payee names,
  descriptions, TIN/SSS numbers if newly captured) — universal convention, already used in
  every finance render function touched above.
- Firestore rules do not cascade or match by prefix — every new collection (an OR/SI
  counter beyond the generic `_counters` doc, a persisted alphalist/2316 snapshot doc, a
  generated-worksheet audit doc) needs its own explicit `match` block or reads silently
  deny (firestore-rules-collection-coverage discipline, repeated in every prior brief in
  this series).
- Rules must read fields via `.get(field, default)`, never bare access, or a doc missing
  that field denies the whole rule (firestore-rules-missing-field-throws discipline) —
  relevant to any new shape-validation this workstream's rules add (e.g. guarding a new
  `inputVat`/`vatTreatment` field on `expenses` writes).
- `window.assertPeriodOpen(date)` / `window.isPeriodClosed` (WS12) already gate every
  ledger-adjacent write with a period-close check — any new BIR-driven write path (e.g. a
  "post VAT Payable to the ledger" action, or a backfill that adds `inputVat` to historical
  expense rows) must call this the same way `postCDJToLedger`/`postExpenseToLedger` already
  do, or risk writing into a month Finance has explicitly closed.
- `canFinance()` (firestore.rules:43, `isMoneyAdmin() || isFinanceDept()`) and
  `isMoneyAdmin()` (firestore.rules:31, `president|manager|finance`) are the two live
  finance-tier gates post-WS19 (secretary explicitly dropped from money-write paths,
  per the WS19 Build Log) — any new BIR-report read/write rule should pick one of these
  deliberately rather than inventing a third tier, and should weigh that these are literal
  government filings (arguably narrower than ordinary ledger access, e.g. `isMoneyAdmin()`
  rather than `canFinance()`, which still includes the whole Finance dept).
- Script load order is fixed (index.html, per CLAUDE.md): `firebase-config.js → config.js →
  drive.js → notifications.js → statutory-tables.js → letterhead.js → departments.js →
  app.js → modules.js` (confirmed current order includes both WS21's and WS14's new files
  already correctly sequenced). Any new BIR-specific helper file must load after
  `config.js`/`statutory-tables.js`/`letterhead.js` (all three are dependencies) and before
  whichever of `departments.js`/`app.js` calls it, and must be added to both `index.html`
  and `sw.js`'s `PRECACHE` array.
- `CACHE_VER` in `sw.js` must be bumped on any JS/CSS touch (auto-bump only covers
  `APP_VERSION`/`index.html` version strings via the pre-commit hook, per CLAUDE.md).
- The `verified:false` PLACEHOLDER flag on `window.STATUTORY` tables must propagate into
  any BIR document that consumes `computeStatutory()` output — a 1601-C/2316 built on
  unverified withholding brackets and silently presented as filing-ready would be worse
  than the current state (no document at all). The existing `unverified` field on
  `computeStatutory()`'s return value and the console-warn-until-`_STATUTORY_ACK` pattern
  should be surfaced visibly on any new print (e.g. a watermark), not just console-logged.
- `pay_runs` (WS20) is a state-machine collection, immutable once `disbursed`
  (firestore.rules, WS19/WS20) — any WS39 report reading payroll history should read the
  frozen `salary_history` mirror (written only at Disburse) or the aggregate ledger legs
  (`SSSPAY-`/`WHTPAY-`/etc.), never attempt to re-open or recompute a disbursed `pay_runs`
  doc.
- Backups: WS15 replaced the hand-maintained `EXPORTS` array in
  `scripts/monthly-backup.js` with `db.listCollections()` dynamic discovery — any brand
  new top-level collection this workstream introduces (an OR/SI counter's own collection
  if not reusing `_counters`, a persisted alphalist/2316/worksheet snapshot collection) is
  **automatically** picked up by the monthly backup with zero code change, per that
  workstream's own design intent — a real improvement over the pattern every earlier
  workstream in this series had to remember to do by hand.
- No CI/build/test suite exists — verification is `node --check` + a live/preview
  click-through only, per every prior workstream's Build Log entries in this series.

## Open decisions

1. **VAT-registration classification** — is the DTI taxpayer entity actually VAT-registered
   (2550M/Q applies) or Non-VAT/percentage-tax (2551Q applies instead, no VAT netting at
   all)? Not discoverable from code (§8) — this changes which of the mandate's named forms
   are even relevant and must come from Neil/the accountant before any 2550M/Q spec is
   written.
2. **Scope of the input-VAT-capture fix** — extend `inputVat` capture to the general
   "Add Expense" flow (`openAddExpenseModal`/`postExpenseToLedger`), the manual Ledger-tab
   entry, and the dept budget-expense modal (closing the gap quantified in §1), or
   explicitly scope WS39's "fix" to only the reporting/worksheet layer and document the
   residual gap for Neil? If extended, does every expense need a VAT prompt, or only
   categories plausibly VATable (Materials/Utilities/Office Supplies) vs never-VATable
   (Meals often has no input VAT in practice, Transportation is mixed) — a judgment call,
   not a pure grep-derivable fact.
3. **"General journal" print** — read the orphaned, unwritten `general_journal` collection
   (will show stale/empty data, §2) or redefine the print to synthesize a double-entry
   journal view FROM `ledger` (+`cash_receipt_journal`/`cash_disbursement_journal`), which
   IS actively populated?
4. **"General ledger" print** — a true per-account (T-account) listing does not exist
   anywhere today (only a flat chronological ledger list and a category-summed income
   statement); decide whether this groups `ledger` rows by `account` (leveraging
   `window.COA`/`ledgerKind()` already built by WS13) scoped to a period, and whether it's
   a new render function or an alternate view mode of the existing Ledger tab.
5. **Cash Receipts/Cash Disbursements Book prints** — format directly from
   `cash_receipt_journal`/`cash_disbursement_journal` docs (closer to the BIR loose-leaf
   book structure, one row per source transaction) or from `ledger` rows filtered by
   `CRJ-`/`CDJ-` refNumber prefix (closer to what's already rendered elsewhere)?
6. **2550M/Q worksheet layout and the read-cap risk** — must solve or explicitly route
   around the `ledger`/`general_journal` `.limit(3000)` truncation risk (§6) for any period
   that could fall outside the most-recent-3000-rows window; decide whether this workstream
   adds bounded date-range queries (WS16's `ledgerForPeriod`/`ledgerSince` pattern already
   exists as precedent) for every new report rather than reusing
   `renderFinancialReports`'s existing fetch as-is.
7. **1601-C sourcing** — read the already-posted `WHTPAY-{month}` aggregate ledger leg
   (fast, but regular-employees-only, misses weekly/production workers whose employer
   share is currently manual-only per WS24 decision 3) vs. recomputing per-employee from
   `salary_history` + `computeStatutory` at report time (slower, but can include a
   worker/`payslips` branch) — or both, cross-checked against each other for a
   reconciliation warning if they disagree.
8. **Alphalist / 2316 prerequisite data** — decide whether to add `tin`/`ssNum`/`phNum`/
   `pagibigNum` fields to the `users`/`payroll` shape for regular employees (a real form +
   data-migration + possibly a `userPrivilegedFieldsUnchanged()` freeze decision, WS19) as
   a prerequisite before alphalist/2316 can be generated for anyone but production workers,
   or gate alphalist/2316 generation on "employee has these fields filled" with a
   visible red flag per missing employee.
9. **Alphalist generation read pattern** — iterating every employee × 12 months of
   `salary_history` for an annual alphalist is a real fan-out; decide whether this needs a
   new bounded/paginated read strategy consistent with WS16's no-unbounded-reads mandate,
   or is a rare enough (once-a-year, finance-only) operation that a larger one-off read is
   acceptable (similar to `renderTeam()`'s existing full-roster CSV export precedent).
10. **OR/SI numbering series mechanism** — extend `window.nextSerial()` as-is (plain
    sequential-per-year, already built and rules-covered) or design an ATP-range-aware
    variant (start/end bounds, no year reset) that actually matches how BIR's Authority-to-
    Print regime works? This is a compliance-shape question, not an engineering-difficulty
    one — flag for Neil/the accountant same as decision 1.
11. **VAT Payable — post it or keep it computed-only?** `window.COA` already lists 'VAT
    Payable' as a liability account name that nothing posts to; decide whether Net VAT
    Payable should get an actual ledger liability entry each period (mirroring the payroll
    per-agency legs pattern WS20/21 already proved out) or remain a read-only display
    figure forever (simpler, but then "VAT Payable" in the COA is dead/misleading).
12. **`finance_rollup` — build it now or not?** WS13/WS16 both explicitly deferred this
    aggregation doc to "whenever WS39 needs it" (fable-workplan/16-perf.md:119,128); decide
    whether annual BIR documents (alphalist, annual Financial Statement, year-over-year VAT
    summary) justify building `finance_rollup/{YYYY-MM}` now, in the exact shape WS16
    already specced, or whether raising/removing the `.limit(3000)` cap with bounded
    date-range queries is sufficient for this workstream's needs.
13. **Access tier for BIR documents specifically** — `canFinance()` (includes the whole
    Finance dept) vs `isMoneyAdmin()` (president/manager/finance, narrower, matches WS19's
    money-tier hardening) vs president-only (given these are literal government filings,
    arguably the most sensitive class of document in the app) — for viewing, generating,
    AND exporting/printing, which may reasonably differ from each other.
14. **Print/export mechanism** — same-document `window.print()` per the no-pop-ups
    directive already established for the payslip (WS24) and dialogs (WS10-11), vs. a raw
    CSV/data export (the accountant likely needs to re-key figures into BIR's eFPS/
    eBIRForms software regardless of how pretty the in-app print looks) — `exportFinReportCSV`
    (departments.js:3383-3397) is the existing CSV-export precedent and already includes
    `vatAmount`/`inputVat` columns; decide whether each new worksheet gets an equivalent
    CSV export in addition to or instead of a letterhead print.
15. **Where do these documents live in the UI?** A new "BIR" sub-tab alongside Finance's
    existing Overview/Reports/Ledger/Taxes/etc. tabs (`finTabs` array, departments.js:1999)
    is the obvious placement following the existing chip-tab pattern, but the exact set of
    entry points (one screen with a document-type picker vs. one sub-tab per document) is
    Fable's call.

## Risks / cross-workstream interactions

- ⚠️ The `ledger`/`general_journal` `.limit(3000)`-then-filter read pattern (§6) is the
  single highest-severity latent risk for this workstream specifically: it already governs
  every number `renderFinancialReports` shows, and a BIR filing or financial statement
  silently built on truncated data is a compliance incident, not a display bug. This is
  pre-existing (not introduced by WS39) but this workstream is where it stops being
  low-stakes.
- ⚠️ Direct, explicit cross-workstream note left by WS20/21's own implementation session
  (departments.js:150-155, `financeDeleteCascade`, quoted): deleting a single employee's
  `salary_history` row removes that employee's own `PAY-{month}-{uid}`/`-ER` ledger legs,
  but the shared aggregate `SSSPAY-`/`PHPAY-`/`HDMFPAY-`/`WHTPAY-`/`NETPAY-{month}` legs
  (covering the WHOLE month's run) are **NOT** re-derived — "a known gap, left for whoever
  builds WS39 (BIR/remittance reports, the eventual owner of these legs) since a wrong
  partial fix is worse than an honest one." Any 1601-C/remittance report reading these
  aggregate legs must account for this: a deleted employee's payroll leaves the aggregate
  legs OVERSTATED relative to the remaining `PAY-{month}-{uid}` rows, with no automatic
  reconciliation today.
- ⚠️ WS21's `verified:false` placeholder statutory rates (SSS/PhilHealth/Pag-IBIG/TRAIN
  brackets) directly feed `ee.tax` → `WHTPAY-{month}` → any 1601-C this workstream builds.
  A real government filing built on placeholder numbers is a worse outcome than delaying
  the filing — this workstream inherits WS21's own "accountant must verify + flip
  `verified:true`" gating discipline and should not add a second, independently-worded
  warning that could drift from WS21's.
- ⚠️ Multi-entity confusion is a real, not theoretical, risk: `window.brandEntity('corporate')`
  (the OPC) has **no TIN at all** (`opcTin:''`) — if any new BIR print defaults to
  `buildLetterhead()`'s own default entity (`o.entity || brandEntity('corporate')`,
  js/letterhead.js:25) instead of explicitly passing `brandEntity('bir')`, the resulting
  document would print with a blank TIN line, a genuine filing defect. Every WS39 print
  call site must pass `entity: window.brandEntity('bir')` explicitly, matching WS14's own
  payslip/invoice precedent — do not rely on the default.
- ⚠️ The alphalist/2316 data-model gap (§3, missing TIN/SSS#/PhilHealth#/Pag-IBIG# on
  `users`/`payroll`) is the kind of prerequisite that can silently balloon this workstream's
  scope if not explicitly bounded — adding these fields touches employee-profile forms
  (`openAddEmployeeModal`/`openCreateWorkerModal`, per WS27's grounding of those same
  functions), possibly `userPrivilegedFieldsUnchanged()` (WS19), and a real one-time
  data-collection effort from HR for every existing employee — this is arguably a
  precondition project, not a sub-task of "print the alphalist."
- ⚠️ `tax_records` (the existing manual "Taxes" tab) risks becoming a redundant, drifting
  parallel system if WS39's generated worksheets don't explicitly feed into or reconcile
  with it — Finance may end up maintaining two separate records of "did we file 2550Q for
  Q1 2026" (one auto-generated, one hand-logged) unless the spec wires them together.
- ⚠️ Any change to the expense-VAT-capture shape (decision 2) ripples into
  `exportFinReportCSV`'s existing `vatAmount`/`inputVat` columns (departments.js:3393-3394)
  and into `resyncLedgerForSource`'s edit-path field carry-through (departments.js:1532,
  1550-1562) — both already reference `inputVat` by name and would need to stay in sync
  with whatever new capture points are added.
- ⚠️ Cross-workstream interaction with WS13/WS16's deferred `finance_rollup` (§7,
  decision 12): if WS39 builds it, the shape must match what WS16 already documented
  (`finance_rollup/{YYYY-MM}: {byType, byAccountType, byCategory, updatedAt}`) so it
  doesn't diverge from what a future WS16-style perf pass would expect, and needs its own
  new `firestore.rules` match block (WS16's own brief already notes this explicitly:
  "When WS13 builds the finance_rollup counter doc, THAT workstream adds its own... rules
  block").

## Files likely touched

`js/departments.js` — `renderFinancialReports` (~3399-3520, the existing VAT/income-statement
engine this workstream extends or supersedes), `renderTaxesTab`/`tax_records` (~3293-3380),
`postExpenseToLedger`/`openAddExpenseModal` (~1432-1455, ~1686-1727, if decision 2 extends
input-VAT capture here), `resyncLedgerForSource` (~1527-1569), `postCDJToLedger`/
`cdjLedgerExpense` (~1484-1521), `recordPurchaseDisbursement` (~13547-13650),
`renderLedgerTab` (~3657+), the dept budget-expense modal (~11600-11650), `toPayslipModel`/
`payslipYtdMonthly`/`payslipYtdWeekly` (~5207-5282, if YTD tax aggregation or TIN plumbing
is added here), `disbursePayRun`'s per-agency ledger legs (~2536-2630), `financeDeleteCascade`
(~141-160, the known aggregate-leg gap), `openAddEmployeeModal`/`openCreateWorkerModal`
(if TIN/SSS#/PhilHealth#/Pag-IBIG# fields are added to regular-employee profiles), the
`finTabs` array (~1999) and its `navigateTo`-style switch (~2020-2030) for any new BIR
sub-tab entry point. `js/config.js` — `window.COA`/`COA_LEGACY_MAP`/`ledgerKind` (~652-683,
the 'VAT Payable' account and per-agency liability accounts already listed),
`window.BRAND`/`brandEntity` (~844-905, reused as-is per §5), `window.Period` (~688+,
reused as-is for month/quarter/year worksheet scoping), possibly `window.ledgerForPeriod`/
`ledgerSince` (WS16, precedent for any new bounded-read helper this workstream adds).
`js/statutory-tables.js` — `window.STATUTORY`/`computeStatutory` (read-only reuse; do not
reimplement withholding math here, per the task's own explicit instruction). `js/letterhead.js`
— `window.buildLetterhead`/`window.nextSerial` (read-only reuse; `nextSerial` finally gets
its first caller if an OR/SI series is built). Possibly a new `js/bir.js` module (if the
worksheet-generation logic is substantial enough to warrant its own file, following the
`statutory-tables.js`/`letterhead.js` precedent of small, focused, dependency-ordered
modules) — would need adding to `index.html`'s script list (after `letterhead.js`, before
`departments.js`) and `sw.js`'s `PRECACHE` array. `firestore.rules` — `ledger` (~807-841),
`general_journal` (~858-862), `cash_receipt_journal`/`cash_disbursement_journal`
(~848-857), `tax_records` (~868-872), `expenses` (~507-520, if decision 2 extends its
shape), `_counters` (~154, if OR/SI reuses it, likely no change needed), any brand-new
collection (an ATP-range-aware OR/SI counter, a persisted alphalist/2316/worksheet
snapshot doc, a `finance_rollup` doc if decision 12 builds it — each needs its own explicit
match block, per repo convention). `firestore.indexes.json` — likely new composite indexes
for any bounded query this workstream adds beyond a single `orderBy` (e.g.
`ledger(accountType, date)` or `ledger(account, date)` for a per-account General Ledger
view or an agency-remittance report spanning multiple months) — none of the four
already-defined ledger-adjacent indexes (`salary_history`, `payslips` ×2, `cash_advances`)
cover this. `sw.js` — `CACHE_VER` bump (any JS/CSS touch) + `PRECACHE` addition if a new
file is created. `scripts/monthly-backup.js` — likely **no change needed** for any new
collection, per WS15's dynamic `db.listCollections()` discovery (§ Constraints) — worth
confirming this explicitly in the DECIDED spec rather than assuming it needs the old
hand-maintained-array treatment prior workstreams had to remember.

## Expected deliverable format

A numbered build spec Sonnet can execute without further judgment calls, covering: one,
the exact resolution of each open decision above stated as a one-line policy (including
the two decisions that are genuinely business/compliance facts for Neil, not engineering
calls — VAT-registration classification and OR/SI ATP-range requirements — flagged
`‼️ FLAG FOR NEIL` rather than silently guessed). Two, for the input-VAT-capture fix: the
exact new fields and before/after code for whichever of `openAddExpenseModal`/
`postExpenseToLedger`/the Ledger-tab manual entry/the dept-budget-expense modal are in
scope, plus confirmation that `exportFinReportCSV` and `resyncLedgerForSource` stay in
sync. Three, for each new books-of-account/worksheet print: which existing collection(s)
it reads, the exact query (bounded by date range, not the existing `.limit(3000)` pattern,
per §6), the `buildLetterhead(...)`+`brandEntity('bir')` call shape, and — if a new
collection is introduced to persist a generated worksheet/snapshot — its full field shape
and a literal `firestore.rules` diff. Four, for the alphalist/2316 data gap: the exact new
fields added to `users`/`payroll` (name, type, default), the exact form changes to
`openAddEmployeeModal`/`openCreateWorkerModal`, and a numbered migration/backfill checklist
for existing employees (in the style of the `backfillPayrollLedger`/`LeaveAccrual` precedent
other workstreams in this series already established) — explicit about what happens to
alphalist/2316 generation for an employee whose TIN is still missing. Five, for OR/SI: the
exact `nextSerial`-based (or ATP-range-aware alternative) minting function signature, its
call sites (which document types), and its `_counters`/new-collection rules diff. Six, an
explicit list of every existing read site that touches `ledger`/`general_journal` with the
`.limit(3000)` pattern (this brief found one; Sonnet should re-grep before finalizing) with
a one-line note per site: "unchanged" or "must also bound its date range because ___." Seven,
a manual test checklist (no automated suite exists) covering at minimum: a VAT computation
that matches hand-calculated output-minus-input for a period spanning both CDJ-VATed and
general-expense-VATed transactions (if decision 2 extends capture); a 2550-style worksheet
for a period known to be older than the most recent 3000 ledger rows, confirmed to NOT
silently return zero; a 1601-C figure cross-checked against the already-posted
`WHTPAY-{month}` ledger leg; and confirmation that every new BIR print shows the DTI entity
(`brandEntity('bir')`) with a real TIN, never the OPC entity's blank TIN.

## DECIDED — architecture spec (Fable, 2026-07-11)

### Resolved decisions (one line each)

1. **VAT registration → ‼️ FLAG FOR NEIL; ship assuming VAT-registered, behind a config flag.** The app already computes 12% VAT on every sale (only coherent if the entity IS VAT-registered), so `window.BIRCONFIG.vatRegistered = true` ships as a labelled PLACEHOLDER; if Neil/the accountant says percentage-tax (2551Q), the 2550 screen hides itself and shows a "2551Q — not yet built, entity is Non-VAT" notice instead of silently producing the wrong form. Do NOT build 2551Q speculatively.
2. **Input-VAT capture → EXTEND to all three missing paths** (general Add-Expense, Ledger manual entry, dept budget-expense modal) via one shared field helper, with **category-based defaults**: Materials/Utilities/Office Supplies default `'inclusive'`, Meals/Transportation/Other default `'exempt'` — user can always override. `postExpenseToLedger` and `resyncLedgerForSource`'s expenses branch (which currently drops `inputVat` — verified departments.js:1532-1538) both carry it through; `exportFinReportCSV` already emits the column, unchanged.
3. **"General journal" print → SYNTHESIZED from `ledger`**, defined as period-bounded ledger rows whose `refNumber` does NOT start with `CRJ-`/`CDJ-` (i.e., everything not already in a cash book: `EXP-`, `PAY-`, `SSSPAY-`/`PHPAY-`/`HDMFPAY-`/`WHTPAY-`/`NETPAY-`, `POCOS-`, manual entries), rendered as date/particulars/ref/debit/credit rows — PLUS legacy `general_journal` docs merged in with a "(legacy)" tag. The orphaned collection gets NO new writer; it stays read-only legacy data.
4. **"General ledger" print → a NEW per-account view** in js/bir.js: group period-bounded `ledger` rows by `account` (via `ledgerKind()`/`COA` fallback for legacy rows), each account a section with its rows chronological + a period total (debits, credits, net). It is a print screen, NOT a mode of the existing Ledger tab (that tab is an editing surface; a book print must be read-only).
5. **Cash Receipts / Cash Disbursements Books → read `cash_receipt_journal`/`cash_disbursement_journal` DIRECTLY** (date-range-bounded) — one row per source transaction with payee/customer, reference, column breakdown, VAT — the loose-leaf book structure. Ledger `CRJ-`/`CDJ-` rows are collapsed single-leg mirrors and lose the column detail.
6. **Read-cap fix → `renderFinancialReports` switches to the WS16 bounded readers** (`window.ledgerForPeriod` + a new symmetric `window.gjForPeriod`), and EVERY new WS39 query is date-range-bounded — the `.limit(3000)` pattern is banned from anything BIR-facing. Full site list in Spec 2.
7. **1601-C sourcing → recompute per-employee from `salary_history` (+ weekly `payslips`), CROSS-CHECKED against the `WHTPAY-{month}` ledger leg** with a visible ⚠ reconciliation banner when they disagree — this directly surfaces the known `financeDeleteCascade` aggregate-leg overstatement gap instead of silently trusting either source.
8. **TIN/SSS#/PhilHealth#/Pag-IBIG# for regular employees → live on `payroll/{uid}`** (NOT `users`): it is already `isMoneyAdmin()`-write / owner-read (right sensitivity tier), already merged into payroll UI objects via `fetchUsersWithPayroll`, and avoids touching WS19's `userPrivilegedFieldsUnchanged()` freeze entirely. Captured in the existing "Edit Payroll" modal (new Statutory IDs section); frozen into pay-run lines/`salary_history` at Compute/Disburse for payslips; read LIVE from `payroll/{uid}` for alphalist/2316 (so no backfill of historical `salary_history` is needed).
9. **Alphalist read pattern → one bounded year query is acceptable**: `salary_history.where('month','>=',Y+'-01').where('month','<=',Y+'-12')` (single-field range → automatic index), grouped client-side by `userId`; weekly workers via the equivalent `payslips` year query. Once-a-year, finance-only — same class as `renderTeam()`'s full-roster CSV. No pagination, no rollup.
10. **OR/SI series → ATP-range-aware `nextSerialInRange()`** (start/end bounds, NO year reset, refuses to mint past the registered range) — `nextSerial()` as-written is NOT BIR-shaped. Series config ships NULL (minting disabled) until Neil supplies the ATP facts. ‼️ FLAG FOR NEIL (Spec 8).
11. **VAT Payable → stays COMPUTED-ONLY; no ledger posting.** The payroll agency legs work because disbursement happens in-app; VAT remittance is paid outside the app and already lands as a CDJ disbursement (account 'Tax') when recorded — posting a liability leg with no in-app settlement flow would just accumulate un-reversed liabilities. `'VAT Payable'` stays in COA for manual entries; the 2550 worksheet is the artifact of record.
12. **`finance_rollup` → NOT built.** Bounded date-range queries cover every WS39 need (an annual report = one year-range read, fine at this ledger's scale for years); a rollup doc duplicates ledger truth and needs write-fanout maintenance across ~10 ledger write paths. Documented here so WS13/WS16's deferral is formally closed as "declined, superseded by bounded reads." `renderFinanceOverview`'s all-time KPI read is out of scope.
13. **Access tier → `canFinance()` for viewing/generating/exporting everything** (the reports only derive from collections `canFinance()` can already read — a narrower client gate would be theater, not security); OR/SI minting rides `_counters`' existing `isFinanceOrAdmin()` write rule; the generated-worksheet audit trail reuses `tax_records` (`canFinance()` create/update, president delete). Secretary is already excluded from ledger/journal reads by WS19's `canFinance()` narrowing — nothing new needed.
14. **Print/export → BOTH**: same-document `window.print()` letterhead print (WS24 pattern, no pop-ups) AND a per-worksheet ⬇ CSV button (the accountant re-keys into eBIRForms regardless). Every print passes `entity: window.brandEntity('bir')` EXPLICITLY — never the default.
15. **UI placement → ONE new 'BIR' chip-tab in `finTabs`** (after 'Taxes'), rendered by `window.renderBIRTab()` in a NEW `js/bir.js`, with a second-level `chipTabs` document picker: Books · VAT (2550) · Withholding (1601-C) · Alphalist / 2316 · Financial Statements. Worksheets can "Save to Taxes tab" (pre-fills a `tax_records` entry) so the manual tracker and the generator stay one system, not two.
16. **Persisted snapshots → NO new collection.** Generated worksheets persist by pre-filling `tax_records` with three NEW optional fields (`worksheetType`, `sourceFigures` map, `generatedBy`) — existing rules block covers it, monthly backup picks it up automatically, and Finance's "did we file X" record stays in one place.

**Net infrastructure impact: ZERO `firestore.rules` changes, ZERO new composite indexes, ZERO new collections.** All new queries are single-field ranges (automatic indexes); all writes land in existing rules-covered collections whose blocks have no field-shape validation to update. One new JS file (`js/bir.js`) → `index.html` + `sw.js` PRECACHE + CACHE_VER bump.

**Sequencing:** no dependency on any undecided workstream. Reads WS20/21's frozen `salary_history`/agency legs as designed ("WS39 reads these"). The WS21 `verified:false` statutory-rate watermark propagates onto 1601-C/2316/alphalist prints (Spec 6). ⚠ Note the live Payroll-Compute ReferenceError (payroll-compute-existing-bug memory, PR#2): if still unfixed, `salary_history` may be sparse for recent months — the 1601-C reconciliation banner will surface this rather than hide it.

---

### Spec 1 — `js/bir.js` module + config

**New file `js/bir.js`** — loaded in index.html AFTER `letterhead.js`, BEFORE `departments.js` (it needs `config.js`/`statutory-tables.js`/`letterhead.js`; `departments.js` calls its helpers). Add to `sw.js` PRECACHE. Contains: `BIRCONFIG`, `vatFieldHTML`/`readVatField`, `computeVatSummary`, `nextSerialInRange`, `renderBIRTab` + the per-document render/print builders, and the CSV exporters.

```js
// ── window.BIRCONFIG (top of js/bir.js) ─────────────────────────
window.BIRCONFIG = {
  // ‼️ FLAG FOR NEIL — PLACEHOLDER. true = files 2550M/Q (app behavior implies this).
  // If the DTI entity is actually Non-VAT/percentage-tax, set false → 2550 screen
  // hides and shows the "entity is Non-VAT (2551Q)" notice instead.
  vatRegistered: true,
  // ‼️ FLAG FOR NEIL — OR/SI series stay NULL (minting disabled, buttons hidden)
  // until the real ATP facts arrive. Example shape once known:
  //   or: { counterKey:'or_series_2026A', prefix:'OR-', start:1, end:5000, pad:6, atpNo:'ATP #…' }
  series: { or: null, si: null }
};

// ── Category → default VAT treatment for the general expense flow ──
window.VAT_DEFAULT_BY_CATEGORY = {
  'Office Supplies':'inclusive', 'Materials':'inclusive', 'Utilities':'inclusive',
  'Meals':'exempt', 'Transportation':'exempt', 'Other':'exempt'
};

// ── Shared input-VAT form field (Spec 3 uses this in all three forms) ──
window.vatFieldHTML = function(id, def) {
  return `<div class="form-group"><label>Input VAT</label>
    <select id="${id}" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
      <option value="inclusive" ${def==='inclusive'?'selected':''}>VATable — 12% included in amount</option>
      <option value="exempt" ${def!=='inclusive'?'selected':''}>VAT-exempt / no VAT on receipt</option>
    </select></div>`;
};
window.readVatField = function(id, amount) {
  const t = document.getElementById(id)?.value || 'exempt';
  return { vatTreatment: t, inputVat: t==='exempt' ? 0 : window.vatSplit(amount||0,'inclusive').vat };
};

// ── ONE VAT-summary computation, shared by Financial Reports, 2550, and the FS
//    print — never re-derive this math (reuses the exact renderFinancialReports
//    logic incl. the legacy amount−amount/1.12 fallback). rows = ledger row objects.
window.computeVatSummary = function(rows) {
  const income  = rows.filter(e => ledgerKind(e)==='income');
  const expense = rows.filter(e => ledgerKind(e)==='expense');
  const salesRows = income.filter(e => (e.category||'')==='Sales Revenue');
  let vatableSales=0, exemptSales=0, outputVat=0;
  salesRows.forEach(e => {
    const amt = e.amount||0;
    const v = (e.vatAmount != null) ? e.vatAmount : (amt - amt/1.12);   // legacy fallback
    if (v > 0) { outputVat += v; vatableSales += amt - v; } else exemptSales += amt;
  });
  const inputVat = expense.reduce((s,e)=>s+(e.inputVat||0),0);
  return { vatableSales, exemptSales, outputVat, inputVat, netVat: outputVat - inputVat };
};
```

`renderBIRTab(container, currentUser, currentRole)` — wired into the finance subtab switch: add `'BIR'` to the `finTabs` array (departments.js:1999) and a `case`/branch in the subtab dispatch (~2020-2030) calling `window.renderBIRTab(...)`. Second-level `window.chipTabs` inside: `books` · `vat` · `wht` · `alpha` · `fs`. Every screen: a `window.Period`-driven picker (month for 1601-C/2550M, quarter for 2550Q, year for alphalist/2316/FS, any for books), a 🖨 Print button (same-document `window.print()`, print CSS from `buildLetterhead`), and a ⬇ CSV button.

**Letterhead call shape (every WS39 print — the ONLY correct form):**
```js
const lh = window.buildLetterhead({ entity: window.brandEntity('bir'),   // NEVER default — OPC has no TIN
                                    title: 'CASH DISBURSEMENTS BOOK', subtitle: pParsed.label });
// page = lh.headerHTML + <table…> + lh.footerHTML; inject lh.printCSS; window.print() in-document.
```

### Spec 2 — The `.limit(3000)` read-cap fix (the compliance landmine)

**2a — new bounded reader `window.gjForPeriod` (js/config.js, directly after `ledgerSince` ~line 411):**
```js
// Bounded general_journal reader — symmetric with ledgerForPeriod (WS16 pattern).
window.gjForPeriod = function(periodKey) {
  const p = Period.parse(periodKey);
  if (p.type === 'all')
    return dbCachedGet('gj', () => db.collection('general_journal').get().catch(()=>({docs:[]})), 45000);
  return dbCachedGet('gj:' + p.key,
    () => db.collection('general_journal').where('date','>=',p.start).where('date','<=',p.end)
            .get().catch(()=>({docs:[]})), 45000);
};
```

**2b — departments.js:3405-3421 `renderFinancialReports` — BEFORE → AFTER (fetch block only; everything below `window._finReportRows` is unchanged):**
```js
// BEFORE (fetches the 3000 MOST RECENT rows of ALL TIME, then filters — older
// periods silently truncate once the collection exceeds 3000 docs):
  const [ledgerSnap, gjSnap] = await Promise.all([
    db.collection('ledger').orderBy('date','desc').limit(3000).get().catch(()=>({docs:[]})),
    db.collection('general_journal').orderBy('date','desc').limit(3000).get().catch(()=>({docs:[]}))
  ]);
  ...
  const periodKey = (range === 'year') ? 'ytd' : range;
  const pParsed = window.Period.parse(periodKey);
  all = all.filter(e => window.Period.match(e.date, pParsed));
// AFTER (period resolved FIRST, then date-range-bounded reads; the client-side
// Period.match filter stays as belt-and-braces for rows with odd date strings):
  const periodKey = (range === 'year') ? 'ytd' : range;
  const pParsed = window.Period.parse(periodKey);
  const [ledgerSnap, gjSnap] = await Promise.all([
    window.ledgerForPeriod(periodKey),
    window.gjForPeriod(periodKey)
  ]);
  ...
  all = all.filter(e => window.Period.match(e.date, pParsed));
```
Also refactor the VAT block further down (departments.js:3435-3445) to call `window.computeVatSummary(all)` so Reports and 2550 can never drift.

**2c — every existing `.limit(N)`-then-filter site (grep `limit(3000)|limit(2000)|limit(5000)` on 2026-07-11; Sonnet MUST re-grep before finalizing):**
- departments.js:3407 (`ledger`, renderFinancialReports) — **FIXED by 2b.**
- departments.js:3408 (`general_journal`, renderFinancialReports) — **FIXED by 2b.**
- app.js:1423 (`products.limit(2000)`) — **unchanged**: product catalog, not a financial report; no period semantics.
- `renderLedgerTab` (departments.js:3657+) reads ledger+general_journal for the editing tab — **unchanged**: it is a browsing/editing surface, not a filing surface; nothing BIR-facing reads through it. (If Sonnet's re-grep finds a limit-then-filter there, note it but do not expand scope.)
- **Rule going forward:** every js/bir.js query is `where('date'>=start).where('date'<=end)` (or `month`/`payPeriodStart` equivalents) — single-field ranges, automatic indexes, `firestore.indexes.json` untouched.

### Spec 3 — Input-VAT capture on the three missing expense paths

**3a — `openAddExpenseModal` (departments.js:1686-1727).** Insert after the Category form-group: `${window.vatFieldHTML('e-vat', window.VAT_DEFAULT_BY_CATEGORY['Office Supplies'])}` and re-default on category change:
```js
document.getElementById('e-cat').addEventListener('change', ev => {
  const el = document.getElementById('e-vat');
  if (el) el.value = window.VAT_DEFAULT_BY_CATEGORY[ev.target.value] || 'exempt';
});
```
In the save handler, extend the `expenses.add({...})` payload:
```js
      ...readVatField('e-vat', parseFloat(document.getElementById('e-amount').value)||0),
      // → adds vatTreatment:'inclusive'|'exempt', inputVat:number to the expenses doc
```
(expenses rules:507-520 have no field-shape validation — no rules change.)

**3b — `postExpenseToLedger` (departments.js:1434-1455).** Add one field to the ledger write: `inputVat: e.inputVat || 0,` (after `category`). Legacy expenses docs have no `inputVat` → 0, exactly today's behavior.

**3c — `resyncLedgerForSource` expenses branch (departments.js:1532-1538).** Currently leaves `inputVat = null` for expenses (verified) so an EDITED expense loses/never gains VAT. Add inside the `collection === 'expenses'` branch: `inputVat = e.inputVat || 0;` — the existing `if (inputVat != null) patch.inputVat = inputVat;` (departments.js:1562) then carries it automatically.

**3d — Ledger-tab manual entry (departments.js:3740-3782).** Insert `${window.vatFieldHTML('led-vat','exempt')}` after the Reference field; show/hide it on the existing type/accountType listeners (visible only when `typeSel.value==='debit' && acctTypeSel.value==='expense'`). In the save payload add:
```js
        ...( typeSel.value==='debit' && acctTypeSel.value==='expense'
             ? readVatField('led-vat', parseFloat(document.getElementById('led-amount').value)||0) : {} ),
```

**3e — Dept budget-expense modal (departments.js:11601-11660).** Insert `${window.vatFieldHTML('exp-vat','exempt')}` after the Reference field (visible only when `exp-type` is `debit`, same show/hide pattern); spread `readVatField('exp-vat', amount)` into the `ledger.add({...})` payload when `type==='debit'`.

**3f — Stays-in-sync confirmations:** `exportFinReportCSV` (departments.js:3383-3397) already emits `vatAmount`/`inputVat` columns — **unchanged**. `financeEditModal` edits on expenses route through `resyncLedgerForSource` → covered by 3c. CDJ/Purchasing paths already capture — **unchanged**. Production `POCOS-` legs deliberately VAT-free — **unchanged**.

### Spec 4 — Statutory ID capture for regular employees (the alphalist/2316 prerequisite)

**4a — Fields (all `string`, default `''`), on `payroll/{uid}`:** `tinNum`, `ssNum`, `phNum`, `pagibigNum` — SAME names as `worker_profiles` uses (departments.js:4580,4654) so `toPayslipModel` reads one vocabulary. No rules change (`payroll` create/update is already `isMoneyAdmin()` with no shape validation, rules:408-412; owner-read gives each employee visibility of their own IDs — correct).

**4b — Capture UI: the "Edit Payroll" modal (departments.js:3032-3110).** Insert a Statutory IDs section before the Tax field:
```html
<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
  <label style="font-weight:600">🪪 Statutory IDs <span style="font-size:11px;color:var(--text-muted)">(required for Alphalist / BIR 2316)</span></label>
  <div class="form-row">
    <div class="form-group"><label>TIN</label><input id="ep-tin" value="${escHtml(emp.tinNum||'')}" placeholder="000-000-000-000"/></div>
    <div class="form-group"><label>SSS No.</label><input id="ep-ssnum" value="${escHtml(emp.ssNum||'')}" placeholder="00-0000000-0"/></div>
  </div>
  <div class="form-row">
    <div class="form-group"><label>PhilHealth No.</label><input id="ep-phnum" value="${escHtml(emp.phNum||'')}"/></div>
    <div class="form-group"><label>Pag-IBIG MID</label><input id="ep-pagnum" value="${escHtml(emp.pagibigNum||'')}"/></div>
  </div>
</div>
```
In the save handler's `payroll.set({...},{merge:true})` add:
```js
            tinNum:     document.getElementById('ep-tin')?.value.trim()   || '',
            ssNum:      document.getElementById('ep-ssnum')?.value.trim() || '',
            phNum:      document.getElementById('ep-phnum')?.value.trim() || '',
            pagibigNum: document.getElementById('ep-pagnum')?.value.trim()|| '',
```
(`fetchUsersWithPayroll` already merges payroll fields onto `emp` — the inputs above read `emp.tinNum` etc. with zero extra plumbing. Free-text like `worker_profiles`; no format validation beyond the placeholder hint.)

**4c — Freeze into the pay run (payslip prints).** At `computePayRun`'s line-assembly site (departments.js:~2497, after `computePayLine` returns), stamp the IDs onto the frozen line: `line.tinNum=emp.tinNum||''; line.ssNum=emp.ssNum||''; line.phNum=emp.phNum||''; line.pagibigNum=emp.pagibigNum||'';` — and mirror the same four fields in `disbursePayRun`'s `shBatch.set` payload (departments.js:2536-2549). Do NOT touch `computePayLine` itself (WS20's frozen math).

**4d — `toPayslipModel` 'monthly' branch (departments.js:5226-5228) — BEFORE → AFTER:**
```js
// BEFORE:  tin:'', sss:'', philhealth:'', pagibig:'' },
// AFTER:   tin:source.tinNum||'', sss:source.ssNum||'', philhealth:source.phNum||'', pagibig:source.pagibigNum||'' },
```

**4e — Missing-ID policy (alphalist/2316):** IDs are read LIVE from `payroll/{uid}` at report time (Spec 6), so no `salary_history` backfill is needed. An employee with a blank `tinNum`: their row renders with a red `⚠ TIN missing` chip, the print carries a top banner "N employee(s) missing TIN — not filing-ready", and the CSV emits the empty cell. Generation is NOT hard-blocked (the accountant may hold TINs offline). The alphalist screen doubles as the data-collection to-do list.

**4f — Migration:** no script. HR fills IDs via the Edit Payroll modal, driven by the alphalist screen's missing-ID banner. Historical payslip prints regenerate with IDs automatically for `salary_history` docs written AFTER 4c ships; older ones show blanks (cosmetic, acceptable — regenerating months are re-frozen on the next edit anyway). Weekly workers already covered via `worker_profiles`.

### Spec 5 — Books-of-account prints (all in js/bir.js, all date-range-bounded, all `brandEntity('bir')`)

| Book | Source + exact query | Columns |
|---|---|---|
| **General Journal** | `ledgerForPeriod(period)` rows where `!/^(CRJ|CDJ)-/.test(refNumber||'')` + `gjForPeriod(period)` legacy docs (tagged "legacy") | Date · Particulars (`description`) · Ref · Account · Debit (`type==='debit'?amount:''`) · Credit |
| **General Ledger** | `ledgerForPeriod(period)`, grouped by `account` (fallback `category`; kind via `ledgerKind()`) — sorted COA order: income, expense, asset, liability, equity | Per-account section: Date · Particulars · Ref · Debit · Credit · running balance; section totals + grand totals |
| **Cash Receipts Book** | `db.collection('cash_receipt_journal').where('date','>=',p.start).where('date','<=',p.end).get()` sorted by date asc | Date · OR/Ref · Customer · Cash/Dr total · Cr Sales Revenue · Cr Sundry (acct + amount) · Output VAT (`vatAmount` from the mirrored ledger row where present) |
| **Cash Disbursements Book** | same bounded query on `cash_disbursement_journal` | Date · Voucher/Ref · Payee · Cr Cash total · Dr Materials · Dr Labor · Dr AP · Dr Sundry (acct + amount) · Input VAT (`vatAmount`) · VAT treatment |

Each: `escHtml()` on every payee/customer/description; page footer via `buildLetterhead`; ⬇ CSV mirrors the print columns. These are **prints of existing data** — zero new writes, zero rules impact.

### Spec 6 — Statutory worksheets (labelled WORKSHEETS, not official forms — figures for the accountant to transcribe into eBIRForms/eFPS; the print header says so explicitly)

**6a — 2550M/Q (VAT).** Gated on `BIRCONFIG.vatRegistered`. Period picker: `month:YYYY-MM` or `quarter:YYYY-Qn`. Rows from `ledgerForPeriod`; figures from `computeVatSummary(rows)`: VATable sales (net of VAT) · VAT-exempt sales · Output VAT · Input VAT this period · **Prior-period creditable input VAT: a manual input defaulting 0** (no carry-over history exists in the data — the accountant supplies it; stored in the saved `tax_records.sourceFigures` for next time) · Net VAT payable / (creditable). Buttons: 🖨 Print · ⬇ CSV · **"Save to Taxes tab"** →
```js
await db.collection('tax_records').add({ period: pParsed.label, type:'VAT',
  amount: Math.max(0, f.netVat - priorCreditable), dueDate:'', status:'pending',
  worksheetType: p.type==='quarter' ? '2550Q' : '2550M',
  sourceFigures: { ...f, priorCreditable }, generatedBy: currentUser.uid,
  createdAt: firebase.firestore.FieldValue.serverTimestamp() });
```
(then `renderTaxesTab` shows it like any hand-logged filing — one system, no drift.)

**6b — 1601-C + agency remittance (month picker).** Per-employee recompute + aggregate cross-check:
```js
const shSnap  = await db.collection('salary_history').where('month','==',month).get().catch(()=>({docs:[]}));
const wpSnap  = await db.collection('payslips').where('payPeriodStart','>=',month+'-01')
                        .where('payPeriodStart','<=',month+'-31').get().catch(()=>({docs:[]}));
const legSnap = await db.collection('ledger').where('refNumber','==',`WHTPAY-${month}`).limit(1).get().catch(()=>({docs:[]}));
```
Table: employee · gross · SSS(EE/ER) · PhilHealth(EE/ER) · Pag-IBIG(EE/ER) · tax withheld; weekly workers appended from `payslips` (`deductions.govt.*`, `deductions.other.taxes`; ER shares blank per WS24 D3 — footnote "weekly ER share manual-only"). Footer: recomputed total vs `WHTPAY-{month}` leg; if `|diff| > 0.01` render `⚠ Ledger aggregate (₱X) ≠ per-employee total (₱Y) — a deleted employee payroll leaves the aggregate legs overstated (known financeDeleteCascade gap); the per-employee total is authoritative for filing.` Same screen shows the SSSPAY-/PHPAY-/HDMFPAY- cross-checks (one extra `where('refNumber','in',[...])` read or three `limit(1)` reads).

**6c — Alphalist (year picker) + 2316 (per employee).** One year query each for `salary_history` and `payslips` (decision 9), grouped client-side; join names from the users cache and IDs live from `payroll/{uid}` (batched `getAll`-style loop over only the employees present in the year's rows). Extend `window.payslipYtdMonthly` (departments.js:5268-5276) ADDITIVELY to also sum `tax`, `sss`, `philhealth`, `pagibig` into its return (existing callers unaffected) and let 2316 reuse it. Alphalist columns: employee · TIN · gross compensation · SSS+PH+HDMF (non-taxable) · 13th-month accrual (`payslipYtdMonthly.thirteenthAccrual`) · taxable comp · tax withheld. 2316: one employee per print page — employee block (name, TIN, address blank-line), employer block from `brandEntity('bir')`, the year's figures, signature lines via `BRAND.legal.signatory`. Missing-TIN policy per Spec 4e.

**6d — Unverified-rates watermark (WS21 discipline, single wording).** While `window.STATUTORY[year]?.verified === false`, every 1601-C/2316/alphalist print carries one diagonal watermark + header chip: `DRAFT — statutory tables unverified (WS21); do not file until the accountant verifies rates`. Implement once in js/bir.js (`birUnverifiedBanner(year)`) — do NOT re-word per screen (drift risk the brief warns about).

### Spec 7 — Financial Statement print (year/quarter picker)

One print, three sections, all from `ledgerForPeriod(period)` + `computeVatSummary`:
1. **Income Statement** — the existing `renderFinancialReports` math (income/expense by category via `ledgerKind`), solid.
2. **VAT Summary** — `computeVatSummary` figures, solid.
3. **Balance Sheet — marked "PROVISIONAL".** Per-account net from ledger rows: assets = debits−credits; liabilities/equity = credits−debits; Retained Earnings line = cumulative net income (needs an ALL-TIME-to-period-end read: `ledgerSince(null)`-style bounded `where('date','<=',p.end)` — one extra query, cached). The ledger is NOT strict double-entry (single-leg entries abound), so it will not balance: render an explicit **"Unreconciled difference (single-entry records)"** plug line rather than hiding it. The print states: "Provisional statement derived from single-entry records — for management + accountant working-paper use; not audited FS."

### Spec 8 — OR/SI series minting (js/bir.js)

```js
// ATP-range-aware serial: NO year reset, refuses to mint past the registered range.
window.nextSerialInRange = async function(seriesKey) {          // 'or' | 'si'
  const cfg = (window.BIRCONFIG.series||{})[seriesKey];
  if (!cfg) throw new Error('Series not configured — BIRCONFIG.series.'+seriesKey+' is null (awaiting ATP details).');
  const ref = db.collection('_counters').doc(cfg.counterKey);
  const n = await db.runTransaction(async t => {
    const c = await t.get(ref);
    const cur  = c.exists ? (c.data().count || (cfg.start-1)) : (cfg.start-1);
    const next = cur + 1;
    if (next > cfg.end) throw new Error(`${cfg.prefix} series exhausted (ATP range ${cfg.start}–${cfg.end}). Register a new series with BIR before issuing more.`);
    t.set(ref, { count: next, start: cfg.start, end: cfg.end, atpNo: cfg.atpNo||'' }, { merge:true });
    return next;
  });
  return `${cfg.prefix}${String(n).padStart(cfg.pad||6,'0')}`;
};
```
- `_counters` write is ALREADY `isFinanceOrAdmin()` (rules:154-157 — the brief's "isAdmin()" citation is stale) → finance can mint, **no rules change**. WS14's `nextSerial()` stays untouched (employee IDs).
- **Call sites:** a small `⚙ Next OR #` button rendered beside each existing free-text OR input (`rs-ref` at departments.js:9500 and 12260, and the CRJ form's reference field ~3820-3930) — on click, `nextSerialInRange('or')` fills the input. Button renders ONLY when `BIRCONFIG.series.or` is non-null, so nothing appears until Neil supplies the range. Free-text stays (legacy manually-issued ORs exist). `si` wired the same way wherever a Sales-Invoice reference field is added later — config-ready, zero call sites forced now.
- **‼️ FLAG FOR NEIL:** supply per series — ATP/permit number, exact prefix, numeric start/end of the authorized range, pad width. Until then minting is dormant by design.

### Spec 9 — Rules / indexes / backup — explicit no-ops

- `firestore.rules` — **NO changes.** Every read/write lands in existing blocks: `ledger` (bounded reads, `inputVat` is an unvalidated extra field), `expenses` (no shape validation), `payroll` (no shape validation), `tax_records` (extra optional fields fine), `_counters` (write already `isFinanceOrAdmin()`), CRJ/CDJ (read-only here). No deploy of rules needed — a genuine first for this series; re-grep `firestore.rules` for concurrent-session drift anyway before shipping (deploy-recheck memory) but expect zero diff from WS39.
- `firestore.indexes.json` — **NO changes.** Every new query is a single-field range or equality (`date`, `month`, `payPeriodStart`, `refNumber`) → automatic indexes.
- `scripts/monthly-backup.js` — **NO changes** (no new collections; WS15's `db.listCollections()` discovery moot here).

### Spec 10 — Migration / rollout checklist (ordered)

1. **Ship JS (one commit):** config.js (`gjForPeriod`), NEW js/bir.js, index.html script tag (after letterhead.js, before departments.js), sw.js PRECACHE + CACHE_VER, departments.js edits (Spec 2b, 3a-3e, 4b-4d, `finTabs`+dispatch, `computeVatSummary` refactor of Reports). `node --check` each file; preview boot. Pre-commit hook auto-bumps APP_VERSION — do not hand-edit.
2. **No rules/index deploy** (Spec 9) — skip `firebase deploy` entirely unless a concurrent session's diff says otherwise.
3. **Data entry:** HR/Finance fills Statutory IDs via Edit Payroll for every regular employee, driven by the alphalist screen's missing-TIN banner (Spec 4e). No script backfill.
4. **‼️ Neil/accountant inputs, before first real filing:** (a) VAT-registered? (`BIRCONFIG.vatRegistered`); (b) OR/SI ATP ranges (`BIRCONFIG.series`); (c) WS21 statutory table verification (`verified:true`) — until then 1601-C/2316/alphalist print DRAFT-watermarked.
5. **Next pay run** after ship freezes IDs into lines/`salary_history` automatically (Spec 4c) — no action.
6. **First real 2550 period:** accountant supplies the prior-period creditable-input-VAT figure once; thereafter read it back from the previous saved `tax_records.sourceFigures`.

### Spec 11 — Manual test checklist (no automated suite)

1. **Read-cap:** temporarily seed >3000 ledger docs in a test project OR verify by query inspection — request Reports for a period older than the newest 3000 rows → figures now come from a bounded `where date` query (network tab shows the range query), NOT zero/low. Same period key twice → second load served from `dbCachedGet` cache.
2. **Input-VAT end-to-end:** submit a ₱1,120 general expense, category Materials (defaults VATable) → approve → ledger row has `inputVat:120`; same via Ledger manual entry (debit/expense) and a dept budget expense. Edit the approved expense's amount → resync keeps/updates `inputVat` (Spec 3c). A Meals expense defaults exempt → `inputVat:0`.
3. **VAT math cross-check:** period containing 1 sale ₱11,200 inclusive (output 1,200), 1 CDJ-VATed purchase (input 600), 1 general Materials expense ₱1,120 (input 120) → Reports card AND 2550 worksheet both show Net VAT Payable 480 (hand-calc; both via `computeVatSummary`). CSV columns match.
4. **1601-C reconciliation:** month with a disbursed pay run → per-employee tax total == `WHTPAY-{month}` leg, no banner. Delete one employee's `salary_history` row via financeDelete flow → regenerate → ⚠ banner appears naming the discrepancy.
5. **Alphalist/2316:** employee with TIN filled shows clean row; employee without shows `⚠ TIN missing` chip + print banner + still-generatable CSV with empty cell. 2316 YTD tax equals the sum of that employee's 12 `salary_history.tax` values (hand-check one). Weekly worker appears with `worker_profiles` IDs.
6. **Entity:** EVERY new print (4 books, 3 worksheets, FS) shows `NEILBARRO STEEL & METAL FABRICATION SERVICES` + TIN `951-145-613-000` — never a blank-TIN OPC header. Grep js/bir.js: every `buildLetterhead(` call passes `entity:`.
7. **Watermark:** with `STATUTORY[2026].verified===false`, 1601-C/2316/alphalist prints show the DRAFT watermark; flip to true in console → watermark gone.
8. **Books:** GJ print excludes CRJ-/CDJ- rows and includes PAY-/EXP-/manual rows; GL groups by account with totals; CRB/CDB row counts equal the journal collections' doc counts for the period; a payee named `<b>x</b>` renders escaped.
9. **OR minting:** with `series.or=null` → no button. Set a test range `{start:1,end:3}` → mints OR-000001..3, 4th click errors "series exhausted"; two rapid clicks never duplicate (transaction).
10. **Taxes-tab wiring:** "Save to Taxes tab" from 2550 → entry appears in `renderTaxesTab` with amount/period/type prefilled; attach a file + mark filed as before.

### Flags for Neil (consolidated)

- **‼️ FLAG FOR NEIL — VAT registration classification.** Is the DTI entity (TIN 951-145-613-000) VAT-registered (files 2550M/Q — the app's 12%-on-every-sale behavior implies yes) or Non-VAT percentage-tax (files 2551Q)? Ships as `BIRCONFIG.vatRegistered = true` PLACEHOLDER; the 2550 screen is wrong to use if the answer is Non-VAT.
- **‼️ FLAG FOR NEIL — OR/SI ATP details.** Per series: ATP/permit no., prefix, authorized numeric range (start–end), pad width. Minting stays disabled (`series: {or:null, si:null}`) until supplied.
- **‼️ FLAG FOR NEIL — statutory tables still `verified:false` (WS21).** 1601-C/2316/alphalist print DRAFT-watermarked until the accountant verifies the SSS/PhilHealth/Pag-IBIG/TRAIN tables and flips `verified:true`. Do not file watermarked output.
- **‼️ FLAG FOR NEIL — prior-period creditable input VAT** on the first 2550 run is a manual figure from the accountant (no history exists in-app); subsequent periods read it back from the saved worksheet.
