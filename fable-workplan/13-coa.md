# Workstream 13 — Chart of Accounts

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

Branch v12, Phase 1 committed (9281be1). js/departments.js=12766 lines, js/app.js=7769 lines, firestore.rules=861 lines (re-verified via grep this session).

1) NO account-type concept exists today. Grep for accountType/chartOfAccounts/balanceSheet/trialBalance across the repo returns nothing. The only axis is ledger.type ('credit'=income,'debit'=expense) plus a free-text category string. type is read as income/expense directly in 15+ places: app.js:2278-2284, 2695-2696, 2721, 6177-6183, 6359-6364 (e.g. app.js:6359 'const ledDebits=ledger.filter(l=>l.type===debit); totalExp=ledDebits.reduce(...)'); departments.js:2904-2908 (renderFinancialReports income/expense split), 2993-2994, 3018-3019, 3034-3035, 4522-4523, 10558-10559. Any new accountType must be additive — these all assume type==debit IS an expense with no exceptions.

2) Ledger row fields (grepped every ledger.add call): common to all: date, type, description, amount, category, refNumber, source, addedByName, createdAt. Inconsistently present: addedBy(uid) — on payroll posts (departments.js:2694,3862; app.js:4165) and manual/budget entries (departments.js:3072,10700), ABSENT on postExpenseToLedger/postCRJToLedger/postCDJToLedger (1418-1477), Sales-Order credit (8631), Design-payment credit (6183-6189), POCOS (11641-11648). net/vatAmount/vatTreatment — only on income-side rows (Sales Order 8631, project billing 11338, Design payment 6178-6189). inputVat — only on CDJ-mirrored debit rows (1474), and is read back in renderFinancialReports (2922) for Net VAT Payable, so it's load-bearing. dept/budgetLineId/budgetLineName — only on department-budgeting entries (10690-10704). fileUrl — only on manual '+New Entry' (3071).

All ledger.add call sites (file:line, refNumber prefix, poster): departments.js:1418 EXP-<id> postExpenseToLedger; :1442 CRJ-<id> postCRJToLedger; :1469 CDJ-<id> postCDJToLedger; :1558 PAY-<month>-<uid> backfillPayrollLedger; :2701 PAY-<month>-<uid> main payroll Compute; :3064 (user ref) manual Ledger-tab entry; :3867 WPAY-<payslipId> worker payslip Submit; :6183 DPROJ-<projectId>-<idx> Design project payment; :8631 SO-<orderId> Sales Order recorded; :10690 (no fixed prefix) dept budgeting entry; :11338 PROJ-<projectId>-<idx> job_projects billing; :11641 POCOS-<productionOrderId> production materials consumed (COS); app.js:4170 PAY-<month>-<uid> SECOND/legacy payroll-compute path (workstream 20 territory).

3) THE DOUBLE-EXPENSING BUG.
Side A — purchase time. js/departments.js:12558-12645 recordPurchaseDisbursement(p,currentUser,onDone). The modal defaults the debit account to 'material'=COS – Direct Material (12570-12574: options are material/COS-Direct-Material, ap/Accounts-Payable, sundry/Sundry-Other). On save (12599-12644): builds cdjData {reference,date,payee,creditCash:amt, debitMaterial: acct==='material'?amt:0, debitAP: acct==='ap'?amt:0, debitLabor:0, debitSundryAcct, debitSundryAmount, vatAmount:inputVat, vatTreatment, purchaseRef:p.id,...}; `const cdjRef = await db.collection('cash_disbursement_journal').add(cdjData); await postCDJToLedger(cdjRef.id, cdjData);`. postCDJToLedger (1458-1480) computes expense=debitMaterial+debitLabor+debitSundryAmount (excludes A/P — 'that cost was already expensed when incurred'), picks category='COS – Direct Material' when material is largest leg, posts a DEBIT ledger row for the FULL purchase amount keyed CDJ-<id>. This fires the moment Finance records the purchase — before the material is used on any job.

Side B — consumption time. js/departments.js:11609-11658 consumeProductionMaterials(order): 'Consume a production order's materials: decrement inventory stock, post COS to the ledger (idempotent, keyed POCOS-<id>), add the cost to the linked job's capital (for margin), and flag the order.' cos is computed independently from inventory_items.unitCost*qty consumed (11617-11624) — a separate dollar figure from the original purchase (can differ if unitCost was refreshed by a later purchase or only part of a lot is consumed). Then (11635-11652): `const ref = 'POCOS-'+order.id; if (cos>0) { const existing = await db.collection('ledger').where('refNumber','==',ref)...; if (!existing.docs.length) { await db.collection('ledger').add({date:today(),type:'debit',description:'COS — '+..., category:'COS – Direct Material', amount:cos, refNumber:ref, source:'Production', projectId:order.projectId||null, ...}); } }` then job_projects.capital is incremented by cos (11654-11655).

Net effect: the same material cost is booked as category='COS – Direct Material', type='debit' TWICE — once in full at purchase/disbursement (ref CDJ-<id>), once at consumption (ref POCOS-<id>) — with no shared idempotency key between the two (different ref prefixes, so neither dedupe check catches the other) and no netting entry in between. Every P&L view in item (1) sums both. V12-PLAN.md:65-66 already diagnosed this: 'fixes double material expensing (purchase→Inventory asset; consumption→COS, the single expense event)', explicitly deferred here (V12-PLAN.md:197-198: 'Double-expensing fix deliberately lives with chart-of-accounts (13), not Phase 1 — doing it without account types would corrupt reports differently').

4) Rules carve-out. firestore.rules:582-600 — /ledger/{docId}: read/update/delete gated on canFinance()/isPresident(); create allows canFinance() OR (canProduction() AND request.resource.data.get('category','')=='COS – Direct Material' AND get('source','')=='Production' AND get('type','')=='debit' AND get('amount',0) is number AND get('amount',0)>0 AND get('refNumber','').matches('POCOS-.*')). This hard-codes the exact field VALUES a non-finance Production user may write. Any schema change to the POCOS shape needs a matching rules deploy or Production silently loses write access (blank/no-op, not a visible error).

5) general_journal — read in renderFinancialReports (departments.js:2881-2891, flattens {debit?,credit?}→ledger-shape rows tagged category:'Journal Entry') and in the Ledger tab (2972-2991); edit modal at 3089-3095 shows its real shape: {date, accountTitle, debit, credit, reference}. Grep of the whole repo (js/, html, scripts/monthly-backup.js) finds NO .collection('general_journal').add(...) anywhere — only read/edit(3089)/delete(3108) paths exist in current live code. It may be legacy/import-only data. Also `ledger_entries` (firestore.rules:601-605) is explicitly called out as orphaned in app.js:4153 ('previously wrote a single aggregate to the orphaned ledger_entries collection that no dashboard except Analytics read — a split-brain') — nothing reads/writes it in current code, only the rules match keeps it alive.

6) inventory_items (js/modules.js:2014-2019 item-modal save): {name, kind:'material'|'product', unit, category(free text, NOT account-type), qty, reorderLevel, unitCost, supplier, supplierContact, updatedAt}. unitCost is overwritten to latest purchase price on receive (departments.js:12523-12531 receivePurchaseIntoInventory: 'if (it.unitPrice!=null && Number(it.unitPrice)>0) upd.unitCost=Number(it.unitPrice)') — NOT weighted-average (workstream 29 fixes that). stock_movements (modules.js:2028) only logs MANUAL qty edits today, not consumption/receiving — no movement audit trail exists yet to reconcile a balance-sheet Inventory figure against.

7) Payroll ledger posting is duplicated across two functions that both write PAY-<month>-<uid> rows: departments.js:2654-2711 (primary Compute path, where Phase 1 fixed the existing→existingRef crash near 2679) and app.js:4137-4171 (older/second compute path). V12-PLAN.md workstream 20 plans to kill the second path; this workstream doesn't need to fix that, just be aware both write the ledger shape being modified here.

## Data model

ledger (top-level collection, no enforced schema): { date:string(ISO 'YYYY-MM-DD' or 'YYYY-MM-01'), type:'credit'|'debit', description:string, amount:number, category:string(free text: 'Sales Revenue','Payroll Expense','COS – Direct Material','COS – Direct Labor','Other Income','Other Expense','<dept> Income/Expense','General Expense','Journal Entry', or dropdown-picked 'Operating Expense'/'Payroll'/'Tax'/'Materials'/'Utilities'/'Journal Entry (Non-cash)'/'Other'), refNumber:string(idempotency key; prefixes EXP-/CRJ-/CDJ-/PAY-<month>-<uid>/WPAY-/SO-/DPROJ-/PROJ-/POCOS-), source:string, addedByName:string, addedBy?:uid(inconsistent), createdAt:serverTimestamp, net?:number, vatAmount?:number, vatTreatment?:'inclusive'|'exclusive'|'exempt', projectId?:string, inputVat?:number, dept?:string, budgetLineId?:string|null, budgetLineName?:string|null, fileUrl?:string|null }. No accountType field, no double-entry pairing (no linked debit/credit legs per transaction), no account code, no running balance.

general_journal (top-level, no create path in current live code): { date:string, debit?:number, credit?:number, accountTitle:string, reference:string }. Flattened to ledger-shape at read time. In scripts/monthly-backup.js.

cash_receipt_journal fields: date, customer, reference, debitCash, debitSalesDiscount, creditAR, creditSalesRevenue, creditSundryAcct, creditSundryAmount. Mirror rule crjLedgerIncome = creditSalesRevenue+creditSundryAmount (AR collections excluded).

cash_disbursement_journal fields (departments.js:12614-12627): reference, date, payee, creditCash, debitMaterial, debitAP, debitLabor, debitSundryAcct, debitSundryAmount, vatAmount, vatTreatment, purchaseRef(→purchase_requisitions.id), addedBy, addedByName, createdAt. Mirror rule cdjLedgerExpense = debitMaterial+debitLabor+debitSundryAmount (A/P settlements excluded).

purchase_requisitions fields: rfqNo/prNo, title, supplier, requestingDept, neededBy, deliverTo, notes, items[{desc,qty,unit,unitPrice}], stage('rfq'|'pr'), total, status, createdBy, createdByName, createdAt, submittedToFinance(+At/+By), recordedToFinance(+At/+By), cdjEntryId, receivedToInventory, convertedAt, convertedByName.

inventory_items: { name, kind:'material'|'product', unit, category, qty, reorderLevel, unitCost(last-purchase-price, not weighted-avg), supplier, supplierContact, createdAt/updatedAt }.

production_orders relevant fields: materials:[{itemId,qty,unitCost}], materialsConsumed:bool, materialsConsumedAt, materialsCost:number, projectId, title/orderNo, client.

job_projects.capital: incremented by the consumption-side cos only (departments.js:11654-11655) — job-margin figure, separate from ledger, not itself part of the bug but consumes the same cos value.

stock_movements: { itemId, itemName, type:'adjust', qty, project, note } — only written on manual edits today.

## Constraints — must respect

- Manila-time discipline: use window.bizDate()/bizHour()/bizDow(), never raw toISOString() — renderFinancialReports already follows this (departments.js:2894,2898 use bizDate()/bizYear()).
- escHtml() discipline for any new report/table HTML built from ledger fields (category, description, refNumber), per existing usage e.g. departments.js:3015.
- Idempotency-by-deterministic-refNumber is the load-bearing pattern for every ledger post (EXP-/CRJ-/CDJ-/SO-/DPROJ-/PROJ-/POCOS-/PAY-<month>-<uid>/WPAY-): every poster does a where('refNumber','==',ref).limit(1).get() existence check (or a prefetched range query, departments.js:2662-2670) before .add(). Any new accountType-aware posting (Inventory-asset leg at purchase, paired legs at consumption) must preserve this, and any historical repost/migration must not duplicate existing rows.
- Firestore rules require an explicit match per collection, no cascade/prefix inheritance (CLAUDE.md + firestore-rules-collection-coverage memory) — any new collection (e.g. chart_of_accounts reference collection) needs its own rules match or reads silently DENY.
- The Production-write carve-out (firestore.rules:582-597) hard-codes field VALUES (category, source, type, refNumber pattern) for a non-finance role's create. Any schema change to those exact fields requires a matching rules deploy (firebase deploy --only firestore:rules — git push does NOT deploy rules, per firebase-deploy-rules memory).
- Rules must use .get(field, default) not bare .data.field for any newly-required field on a restricted create path (firestore-rules-missing-field-throws memory) — reading an absent field denies the whole rule.
- Every place currently treating type==='debit' as 'the expense total' or type==='credit' as 'the income total' (15+ sites enumerated in currentState) must be reconciled with any new non-P&L account types so totals don't silently change if e.g. an asset-type entry is also written type:'debit'.
- CACHE_VER in sw.js must be bumped for this change per CLAUDE.md.
- dbCachedGet('ledger',...,45000) (app.js:2249,2681) and dbCacheInvalidate('ledger') must still be called after any new posting function, per existing convention (departments.js:1429,1451,1478).
- resyncLedgerForSource(collection,docId) invariant (finance-reporting-open-items memory): expenses/cash_receipt_journal/cash_disbursement_journal are source docs mirrored into ledger; edits to source docs must call resyncLedgerForSource or the mirror drifts (departments.js:1486-1519) — keep this in sync with any ledger-shape change.

## DECIDED — architecture spec (Fable, 2026-07-09)

### Decisions

**D1 — Taxonomy lives inline + in config, NOT a Firestore collection.** Each ledger row gains
`accountType: 'income'|'expense'|'asset'|'liability'|'equity'` and `account: string` (canonical
name). The account list itself is a static `window.COA` in `js/config.js` (this app is
config-driven: DEPARTMENTS/ROLES already live there). No new collection → no new rules match, no
backup entry, no extra reads. If Neil later needs runtime-editable accounts, COA can be promoted
to Firestore then; nothing in this design blocks that.

**D2 — `type` is NOT reinterpreted.** `type` stays the legacy direction flag; `accountType`
carries the P&L-vs-balance-sheet distinction. All P&L reads migrate to a single new
compatibility helper `window.ledgerKind(row)` (config.js) instead of raw `type` filters. Legacy
rows (no accountType) keep their exact current meaning; asset/liability rows are excluded from
P&L automatically. **Critical detail:** legacy rows with `type:'payslip'` exist
(app.js:6176 filters `l.type==='debit'||l.type==='payslip'`) — ledgerKind must map
`payslip → 'expense'`.

**D3 — One leg per event (doc-per-leg), with an explicit consumption contra-leg.** No `legs[]`
array — that would break every reader. Deterministic refs preserve idempotency:
- Purchase of stock materials → ONE row: debit / asset / `Inventory` (excluded from P&L).
- Consumption → TWO rows: `POCOS-<orderId>` (debit / expense / COS – Direct Material, same as
  today) **plus** `POCOS-<orderId>-INV` (credit / asset / Inventory — the asset decrease).
- Inventory balance = Σ asset-Inventory debits − Σ asset-Inventory credits → reconcilable
  against the stock valuation (workstream 29 improves the unitCost quality feeding it).

**D4 — recordPurchaseDisbursement account options.** Replace material/ap/sundry with:
1. `inventory` — **Inventory – Materials (asset)** — new DEFAULT when the disbursement has a
   `purchaseRef` (came from Purchasing);
2. `material` — COS – Direct Material (expense) — kept for direct-to-job purchases that never
   hit stock (default when no purchaseRef);
3. `ap` — A/P settlement — unchanged (still posts NO ledger row; full accrual A/P is explicitly
   out of scope, deferred to WS39);
4. `sundry` — Sundry/Other (expense) — unchanged.

**D5 — Historical remediation: explicit restatement, idempotent, president-gated.** A one-time
maintenance action "🧾 Restate material costs" (Reports tab, president-only) that (a)
reclassifies historical purchase-side mirrored rows `CDJ-<id>` whose source
cash_disbursement_journal doc has a `purchaseRef` and `debitMaterial>0` to
asset/Inventory, and (b) backfills the missing `POCOS-<id>-INV` contra legs for every existing
POCOS row. Both keyed by refNumber → safe to re-run. Logs via `logAudit('restate-materials',…)`
and shows a summary toast. Per-lot matching is impossible (no lot tracking) — this blanket rule
is correct under the new policy: purchases-to-stock are asset; consumption is the expense event.

**D6 — Rules carve-out: extended to both legs, tolerant of both schema generations** (exact
block below). Deployed BEFORE app code so old and new clients both keep working.

**D7 — general_journal: out of scope.** No create path exists in live code; leave read-only
legacy. Its flattened rows keep deriving via ledgerKind from `type`. A first-class GJ (create UI,
account-typed) arrives with WS39 (BIR books). The orphaned `ledger_entries` rules match may be
deleted in WS19's rules pass, not here.

**D8 — addedBy: yes, opportunistically.** Add `addedBy: currentUser?.uid ?? null` to the posting
sites currently missing it *while editing them anyway* (postExpenseToLedger, postCRJToLedger,
postCDJToLedger, SO/DPROJ/PROJ/POCOS posts). No separate pass.

---

### Spec 1 — `window.COA` + `window.ledgerKind` (js/config.js, new, ~40 lines)

```js
// ── Chart of Accounts (v12 WS13) ─────────────────────────────
// Static, code-versioned. accountType drives P&L vs balance-sheet;
// legacy rows (no accountType) derive their kind from type/category.
window.COA = {
  income:    ['Sales Revenue', 'Other Income'],
  expense:   ['COS – Direct Material', 'COS – Direct Labor', 'Payroll Expense',
              'Operating Expense', 'Utilities', 'Tax', 'Materials',
              'General Expense', 'Other Expense'],
  asset:     ['Cash', 'Accounts Receivable', 'Inventory'],
  liability: ['Accounts Payable', 'VAT Payable', 'Statutory Payables'],
  equity:    ["Owner's Equity", 'Retained Earnings'],
};
// Legacy category → accountType (used by ledgerKind fallback + the backfill).
// Any category not listed falls back to type: credit→income, debit/payslip→expense.
window.COA_LEGACY_MAP = {
  'Sales Revenue':'income', 'Other Income':'income',
  'Inventory – Materials':'asset',
  'COS – Direct Material':'expense', 'COS – Direct Labor':'expense',
  'Payroll Expense':'expense', 'Operating Expense':'expense', 'Payroll':'expense',
  'Utilities':'expense', 'Tax':'expense', 'Materials':'expense',
  'General Expense':'expense', 'Other Expense':'expense',
  'Journal Entry':null, 'Journal Entry (Non-cash)':null,   // null = derive from type
};
window.ledgerKind = function(row) {
  if (row && typeof row.accountType === 'string') return row.accountType;
  const viaCat = row && window.COA_LEGACY_MAP[row.category];
  if (viaCat) return viaCat;
  if (!row) return 'expense';
  if (row.type === 'credit') return 'income';
  return 'expense';               // 'debit' AND legacy 'payslip' rows
};
```

### Spec 2 — P&L call-site migration (the exact find/replace)

Replace every income/expense filter on ledger arrays with `ledgerKind`:
- `X.type === 'credit'` (as an income test) → `ledgerKind(X) === 'income'`
- `X.type === 'debit'` (as an expense test) → `ledgerKind(X) === 'expense'`
- `(l.type==='debit'||l.type==='payslip')` → `ledgerKind(l)==='expense'`

Confirmed sites from this brief (Sonnet: apply these, then grep `type==='debit'`,
`type==='credit'`, `type === 'debit'`, `type === 'credit'` across js/app.js + js/departments.js
restricted to ledger/general-journal arrays and apply the same — the list below is confirmed
but not guaranteed exhaustive):
`app.js` 2278-2284, 2695-2696, 2721, 6177-6183, 6359-6364;
`departments.js` 2904-2908, 2993-2994, 3018-3019, 3034-3035, 4522-4523, 10558-10559.
Do NOT touch `type` comparisons on non-ledger collections (cash journals' own fields,
stock_movements.type, etc.).

### Spec 3 — Posting-site changes

**(a) postCDJToLedger (departments.js ~1458-1480).** New rule: the mirrored row's account
depends on the CDJ doc's leg mix. Add to the computed entry:
```js
// after computing expense/category as today:
const isInventory = (d.debitAccount === 'inventory');   // new field, see (b)
entry.accountType = isInventory ? 'asset' : 'expense';
entry.account     = isInventory ? 'Inventory'
                   : (category /* existing computed category */);
if (isInventory) entry.category = 'Inventory – Materials';
entry.addedBy = (window.currentUser && currentUser.uid) || null;
```
(The existing amount math — debitMaterial+debitLabor+debitSundryAmount, A/P excluded — is
unchanged; when the account picked is `inventory`, the amount lands in `debitMaterial`'s slot in
cdjData but the mirrored row is tagged asset. See (b).)

**(b) recordPurchaseDisbursement (departments.js ~12558-12645).** Change the account
`<select>` options (~12570-12574) to the four in D4; default logic:
```js
const defaultAcct = p && p.id ? 'inventory' : 'material';
```
On save, store the choice on the CDJ doc: `debitAccount: acct` (new field, additive — no rules
change needed for cash_disbursement_journal since its rules don't enumerate fields). When
`acct==='inventory'`, keep writing the amount into `debitMaterial` (so legacy readers of the CDJ
doc still sum correctly) — the mirrored ledger row's asset tagging comes from `debitAccount` per
(a). `resyncLedgerForSource` must carry `debitAccount` through on edits (it re-runs
postCDJToLedger's mapping — verify it passes the full doc).

**(c) consumeProductionMaterials (departments.js ~11609-11658).** After the existing
POCOS-<id> expense post (which gains `accountType:'expense', account:'COS – Direct Material',
addedBy`), add the contra leg with its own idempotency check:
```js
const refInv = `POCOS-${order.id}-INV`;
const exInv = await db.collection('ledger').where('refNumber','==',refInv).limit(1).get()
  .catch(()=>null);
if (cos > 0 && exInv && !exInv.docs.length) {
  await db.collection('ledger').add({
    date: today(), type: 'credit',
    accountType: 'asset', account: 'Inventory', category: 'Inventory – Materials',
    description: `Inventory consumed — ${order.orderNo||order.id}`,
    amount: cos, refNumber: refInv, source: 'Production',
    projectId: order.projectId || null,
    addedBy: (window.currentUser && currentUser.uid) || null,
    addedByName: 'Production', createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}
```
(If the read fails, skip — never risk a duplicate; same convention as Phase 1's backfill.)

**(d) All other posting sites** (EXP-, CRJ-, PAY- ×2 incl. app.js:4137-4171 legacy path,
WPAY-, SO-, DPROJ-, PROJ-, manual entry, budgeting): add two fields each, no structural change:
`accountType` = 'expense' for the debit posts / 'income' for the credit posts, and `account` =
their existing category string (or 'Sales Revenue' for SO/PROJ/DPROJ). Manual '+New Entry' and
the budgeting form additionally get an account dropdown sourced from `window.COA` (grouped by
accountType), defaulting to the current category-equivalent.

### Spec 4 — firestore.rules `/ledger/{docId}` replacement `create` clause

Deploy FIRST (accepts both schema generations). Null-safe `.get()` throughout. Only the
`create` clause changes — keep the live block's read/update/delete predicates as-is and re-diff
firestore.rules immediately before deploying (concurrent-session memory):

```
allow create: if canFinance() ||
  (
    canProduction() &&
    request.resource.data.get('source','') == 'Production' &&
    request.resource.data.get('amount', 0) is number &&
    request.resource.data.get('amount', 0) > 0 &&
    (
      // expense leg — old clients (no accountType) and new clients
      (
        request.resource.data.get('type','') == 'debit' &&
        request.resource.data.get('category','') == 'COS – Direct Material' &&
        request.resource.data.get('refNumber','').matches('POCOS-.*') &&
        request.resource.data.get('accountType','expense') == 'expense'
      ) ||
      // inventory contra leg — new clients only
      (
        request.resource.data.get('type','') == 'credit' &&
        request.resource.data.get('accountType','') == 'asset' &&
        request.resource.data.get('account','') == 'Inventory' &&
        request.resource.data.get('refNumber','').matches('POCOS-.*-INV')
      )
    )
  );
```

### Spec 5 — One-time maintenance actions (Reports tab, president-only, both idempotent)

**"🏷 Tag account types"** — paginated pass over `ledger`: for each row without `accountType`,
set `{accountType: ledgerKind(row), account: row.category || null}` via batched updates
(400/batch). Re-runnable (skips rows that have it). Requires president (ledger update is
president-only in rules — correct gate).

**"🧾 Restate material costs"** — (a) query `cash_disbursement_journal`, client-filter to docs
with `purchaseRef` and `debitMaterial > 0`; for each, find its mirrored `CDJ-<id>` ledger row
and update to `{accountType:'asset', account:'Inventory', category:'Inventory – Materials'}`;
(b) query ledger for POCOS rows (client-filter refNumber prefix), skip `-INV` rows, and for each
POCOS row missing its `POCOS-<id>-INV` sibling, create the contra leg (amount = the POCOS row's
amount, date = the POCOS row's date). Log counts via `logAudit` + toast
"Restated N purchases, added M inventory legs". After running, Reports' expense totals drop by
exactly the double-counted amount — this is a deliberate restatement; record the date in
V12-PLAN's decision log.

### Spec 6 — Migration checklist (numbered, safe order)

1. `firebase deploy --only firestore:rules` with Spec 4 (re-diff firestore.rules first).
   Old clients keep working (predicate accepts the old shape).
2. Ship app code (Specs 1-3 + 5's buttons) via commit → pre-commit hook bumps CACHE_VER.
   `node --check` all JS + preview boot (zero console errors) before commit.
3. In the live app (president): press **🏷 Tag account types**. Verify: Firestore console →
   `ledger` filtered `accountType == null` → 0 results (or re-run).
4. Press **🧾 Restate material costs**. Verify with Spec 7's example + confirm Reports'
   All-Time expense total dropped by the announced restatement amount.
5. Record the restatement date in V12-PLAN.md "Key decisions & answers".

### Spec 7 — Worked example (manual verification)

Buy ₱10,000 steel via Purchasing → disbursement (default `inventory`):
`CDJ-abc {type:'debit', accountType:'asset', account:'Inventory', amount:10000}` → P&L
expense: **₱0** (was ₱10,000 pre-fix). Consume ₱6,000 of it on order PO-2607-001:
`POCOS-po1 {type:'debit', accountType:'expense', account:'COS – Direct Material', amount:6000}` +
`POCOS-po1-INV {type:'credit', accountType:'asset', account:'Inventory', amount:6000}` →
P&L expense: **₱6,000 total** (pre-fix: ₱16,000 — the bug). Inventory balance:
10,000 − 6,000 = **₱4,000** (matches unconsumed stock value).

## Risks / cross-workstream interactions

- ⚠️ Live-money data is already double-counted: any purchase recorded with the default 'material' account whose materials were later consumed by Production already has both a CDJ-<id> and POCOS-<id> row for the same cost. This is a live-books restatement problem, not a greenfield schema change — Finance has already viewed/acted on the inflated numbers.
- ⚠️ Interacts with workstream 20 (one payroll engine): two functions (departments.js:2654-2711, app.js:4137-4171) both post PAY-<month>-<uid> rows today; any new ledger-shape fields must be applied to (or at least not break) both until workstream 20 removes the duplicate.
- ⚠️ Interacts with workstream 29 (Inventory correctness): the Inventory-asset dollar value here is only as good as inventory_items.unitCost, which is last-purchase-price (not weighted-average) with no consumption/receiving movement log — a balance-sheet Inventory figure computed today won't reconcile cleanly; may need sequencing with 29.
- ⚠️ Interacts with workstream 30 (Purchasing — PO approval gate + receiving→stock+ledger): V12-PLAN.md explicitly says workstream 30's receiving-to-ledger fix depends on '13's asset accounting' — the exact posting point (PO approval? receipt? cash disbursement, as today?) is shared surface between 13 and 30 and must be decided once.
- ⚠️ Interacts with workstream 12 (Period engine): renderFinancialReports already has 4 divergent period filters (departments.js:2896-2899) reading the same ledger+general_journal union that workstream 12 plans to unify — a chart-of-accounts rewrite of this function shouldn't hand-roll a 5th period implementation.
- ⚠️ refNumber idempotency has no shared namespace across CDJ-<id> and POCOS-<id> (different doc-id spaces, no cross-reference) — exactly why today's existence checks don't catch the double-post. A netting/reversal design needs an explicit link between a consumption event and the purchase(s) it draws from, which doesn't exist (inventory is fungible by item, not lot-tracked).
- ⚠️ Rules deploy is separate from app deploy: git push does not deploy firestore.rules; a schema change to the Production-write carve-out needs firebase deploy --only firestore:rules, and per the deploy-recheck-full-file-diff memory, re-diff immediately before that deploy since this repo has concurrent OneDrive-synced sessions.
- ⚠️ payroll-compute-existing-bug memory: a live ReferenceError in Compute was flagged for Neil in PR#2 (2026-07-09) — verify it's fixed before touching the same departments.js:2654-2711 block, to avoid conflating an unrelated bug with chart-of-accounts changes.
- ⚠️ general_journal's real status is ambiguous (no create path in current live code, yet merged into every financial report) — if truly dead, building account-type support into its flatten-to-ledger logic (departments.js:2888-2891,2982-2988) may be wasted effort; if seeded some other way, it needs the same account-type treatment as ledger.

## Files likely touched

`js/departments.js — postExpenseToLedger/postCRJToLedger/postCDJToLedger/resyncLedgerForSource (1412-1523), payroll ledger post (2654-2711), renderFinancialReports (2881-2969), renderLedgerTab incl. manual entry + edit modal (2972-3112), recordPurchaseDisbursement (12558-12645), consumeProductionMaterials (11609-11658), department-budgeting ledger post (~10678-10719), Sales Order / project billing ledger posts (8607-8636, 11330-11350), Design payment ledger post (6160-6196)`, `js/app.js — dashboard net-income calcs (2249-2284, 2681-2721), second/legacy payroll-compute ledger post (4137-4172), Analytics/Business-analytics ledger aggregations (6104, 6170-6190, 6349-6390)`, `firestore.rules — /ledger/{docId} (582-600); possibly /general_journal, /cash_disbursement_journal, /cash_receipt_journal (606-620) if their shape changes; a new /chart_of_accounts match if that data-model option is chosen`, `firestore.indexes.json — if a new query pattern (filter by accountType/accountCode) needs a composite index`, `scripts/monthly-backup.js — add a new collection entry (~176) if a chart_of_accounts reference collection is introduced (records-durability discipline, workstream 15)`, `sw.js — CACHE_VER bump, mandatory for any js/css edit per CLAUDE.md`, `js/config.js — only if a new dbCachedGet cache key is needed for a chart_of_accounts reference collection`, `Not expected to touch: js/modules.js, css/styles.css, index.html, functions/index.js (unless a scheduled reconciliation Cloud Function is chosen — out of scope unless Fable decides otherwise)`

## Expected deliverable format

> Fable's output must let Sonnet implement mechanically with no further judgment calls:
> 1. The exact final ledger-row schema as a single annotated object literal (every field, its type, which account-types/sources populate it, which are now required vs legacy-optional) — an actual object literal to diff against, not prose.
> 2. Exact before/after code blocks for every one of the ~13 posting call sites listed in this brief (file:line) — fenced old code, fenced new code, applied as literal replacements.
> 3. The exact firestore.rules diff for /ledger/{docId} (and any other touched collection) as a full replacement match block — this is the highest-risk single artifact since a wrong predicate silently denies Production's COS write with no visible error.
> 4. A numbered, idempotency-safe migration/backfill checklist (e.g. 1. deploy new rules, 2. deploy new app code, 3. run one-time backfill tagging historical rows with inferred accountType (re-runnable), 4. run one-time correction reversing/netting the historical double-posted POCOS/CDJ pairs, or explicitly state 'no correction, restated going forward as of date Z') — each step states what it does, whether it's safe to re-run, and what Firestore query confirms it worked.
> 5. The explicit, complete call-site list of every type==='debit'/type==='credit' filter that must change (this brief enumerates 15+; Fable should confirm/complete it) with the literal find/replace for each.
> 6. A worked numeric example (one sample purchase → one sample consumption) showing ledger rows before the fix (both debits, double-counted) and after (asset leg + expense leg netting to one P&L expense event), concrete enough to manually verify in the Firestore console post-deploy.
> 7. A decision-log entry for each open question in this brief, appended to V12-PLAN.md's 'Key decisions & answers' section in the same style as existing entries, so future sessions don't re-litigate.
