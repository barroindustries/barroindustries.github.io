# Workstream 29 — Inventory correctness (weighted-average cost, movement logging, count variances, RFQ item binding)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

All line numbers verified live via grep/Read against the current checkout (post v12 WS16
performance pass, commit 247fe04, which "unified 7 scattered `inventory_items` reads onto
one shared cache" — confirmed by grep: every read site now goes through
`dbCachedGet('inventory_items', () => db.collection('inventory_items').get()..., 45000)`,
a single 45-second-TTL cache key shared across js/app.js:2380,2792, js/departments.js:12650,
12797,13022,13113,13504, js/modules.js:1860,2499 and js/notifications.js:608 — nine call
sites, one cache entry. Two call sites bypass the cache entirely with a raw uncached read:
js/app.js:1792 (`openBomModal`, the Products BOM materials picker) and — see below —
`consumeProductionMaterials` reads individual docs directly by id, not the collection).

1) THE RECEIVE PATH — CONFIRMED: it overwrites unit cost with the latest purchase price, it
is NOT a weighted average, and it never logs a movement. `receivePurchaseIntoInventory(p)`
(js/departments.js:13501-13528, full function) is called from exactly one place — the
"Mark Received" status-button handler in `renderPurchaseRequests` (departments.js:13473-13495),
guarded by a one-time flag `!p.receivedToInventory` so it can't double-run for the same PR.
It name-matches each PR line (`p.items[].desc`, case-insensitive, trimmed) against
`inventory_items.name` (departments.js:13505-13511: `byName[(it.desc||'').trim().toLowerCase()]`)
and, for every match, batches two field writes (departments.js:13512-13518):
```
const upd = { qty: firebase.firestore.FieldValue.increment(Number(it.qty)||0),
              lastReceivedAt: firebase.firestore.FieldValue.serverTimestamp() };
if (it.unitPrice != null && (Number(it.unitPrice)||0) > 0) upd.unitCost = Number(it.unitPrice);
```
`qty` is correctly additive (`increment`), but `unitCost` is a flat overwrite to the new
purchase's `unitPrice` regardless of how much stock was already on hand at the old cost —
exactly the mandate's "re-valuing all stock at latest price" claim, confirmed verbatim. There
is no weighted-average anywhere in the codebase: `grep -rn "weighted\|average cost\|WAC\b"
js/*.js firestore.rules` returns zero hits, repo-wide. The batch commit
(departments.js:13523-13526) is the ONLY Firestore write in this function — no
`stock_movements` doc is ever added here, confirmed by the collection-wide grep in finding
(2) below. `unmatched` lines are collected and reported via toast (departments.js:13486-13488:
`"Received. ${res.matched} item(s) added...; ${res.unmatched.length} not matched"` or, if zero
matched, `"Received. No inventory items matched by name."`) but this is INFORMATIONAL ONLY —
the calling code sets `receivedToInventory: true` unconditionally whenever `res` is truthy
(departments.js:13483-13485), and `receivePurchaseIntoInventory` always returns a truthy
object even when `matched === 0`. So a PR whose every line fails to name-match — a typo, a
supplier's product name differing from the inventory item's name, a genuinely new
never-before-stocked item — is permanently flagged "received" with zero units ever landing in
`inventory_items`, and nothing surfaces it again for retry. This is the exact mechanism behind
"item binding at RFQ (stop silent name-mismatch loss)" in the mandate.

2) STOCK_MOVEMENTS EXISTS TODAY BUT ONLY CAPTURES MANUAL UI ACTIONS — CONFIRMED MISSING FOR
BOTH RECEIVING AND CONSUMPTION. `grep -rn "stock_movements" js/*.js firestore.rules
functions/*.js scripts/*.js` returns exactly five hits, all in js/modules.js plus one rules
block: a query in `itemHistoryModal` (modules.js:1947), an `.add()` inside `itemModal`'s save
handler for a manual on-hand qty edit (modules.js:2000-2003, `type:'adjust'`), an `.add()`
inside `moveModal`'s save handler for the manual Stock In/Out buttons (modules.js:2035-2039,
`type:'in'|'out'`), a read in `renderMovements` for the Movements tab (modules.js:2049), and
`firestore.rules:954-958`. There is NO writer anywhere else — `receivePurchaseIntoInventory`
(departments.js:13501-13528) and `consumeProductionMaterials` (departments.js:12567-12632),
the two flows the mandate names as "the two biggest flows," write directly to
`inventory_items.qty` (via `increment`) and NEVER add a `stock_movements` doc. This precisely
confirms the mandate's claim: the movement log exists, is actively used and rendered (Stock
tab's 📜 history button, a dedicated Movements tab with CSV export), but is blind to receiving
and blind to consumption — the two highest-volume, highest-dollar-value flows in the system
are invisible in the one place a user would look for "why did this item's quantity change."
Architecturally significant: the `stock_movements`-writing code
(`itemModal`/`moveModal`/`itemHistoryModal`/`renderMovements`) lives inside a private IIFE in
js/modules.js (the `(function(){ ... })()` at modules.js:1829-2159) and is NEVER attached to
`window` — only `window.renderInventory` is exported (modules.js:1836). Per CLAUDE.md's fixed
script load order (index.html:302-323: firebase-config.js → config.js → qrcode.js →
statutory-tables.js → letterhead.js → drive.js → notifications.js → departments.js → app.js →
modules.js), modules.js loads LAST — so `consumeProductionMaterials` and
`receivePurchaseIntoInventory`, both in departments.js, structurally CANNOT call the existing
manual Stock In/Out movement-writing logic even if someone wanted to reuse it: it doesn't
exist yet when departments.js parses, and it's closure-private even after modules.js loads. A
shared "post a stock movement" helper for this workstream has to live somewhere both
departments.js and modules.js can already see — i.e. js/config.js (loaded first) — or be
duplicated a third and fourth time, which is exactly the duplicated-logic anti-pattern flagged
repeatedly elsewhere in this plan (WS25's twin balance-decrement copies, WS26's twin
extension-approval copies).

3) THE COUNT FORM IS EXPLICITLY, BY ITS OWN CODE COMMENT, A NON-MUTATING PRINT DOCUMENT.
`renderProdInventoryForm` (departments.js:12795-12903) and its printable companion
`openInventoryCountForm` (departments.js:12906-13018) are reached via Production → "Count
Form" (departments.js:12379,12402). The function-header comment is unambiguous
(departments.js:12788-12790): "Entries autosave to localStorage so a long count survives a
refresh or subtab switch. **No Firestore writes — this is a working/print document, not a
stock mutation.**" Confirmed by reading the whole function: every entry (`physical` count,
`remarks`, header fields, ad-hoc "blank rows" for write-in items) is persisted only via
`saveCountDraft()` → `localStorage.setItem('bi-prod-count-draft', ...)`
(departments.js:12791-12793, 12882-12897) — there is no `db.collection(...).add/update/set`
anywhere in either function. The variance shown on screen (`varOf`, departments.js:12812:
`parseFloat(phys) - Number(sys||0)`) is a pure client-side display computation over the
localStorage draft and `inventory_items.qty` at render time; it is never written back
anywhere, not to `inventory_items.qty`, not to `stock_movements`. The print output
(departments.js:12906-13018) is a styled `window.open('','_blank')` + `document.write()`
document (the same branded-letterhead pattern used by the Purchase Order and payslip
printables), explicitly captioned "Physical count supersedes system quantity upon approval"
(departments.js:12923, 13011) — i.e. the FORM ITSELF documents an intended manual
reconciliation workflow (count → print → sign-off → someone manually keys the correction
elsewhere) that has no corresponding "elsewhere" in the code today. The draft is also
per-browser/per-device only (plain `localStorage`, no Firestore doc, no multi-user
collaboration) — a count started on a warehouse tablet cannot be continued or reviewed from
a manager's laptop.

4) RFQ ITEM ENTRY IS FREE TEXT WITH NO ITEM BINDING WHATSOEVER, INCLUDING ON THE ONE PATH
THAT ALREADY HAS THE REAL ITEM ID IN HAND. The RFQ creation modal, `openRfqModal`
(departments.js:13229-13298), builds each line item via `addRow(desc,qty,unit)`
(departments.js:13251-13262) — a plain `<input class="ri-desc">` text box, no `<select>`, no
`<datalist>`, no autocomplete against `inventory_items`. The saved shape
(departments.js:13270-13275) is `{ desc, qty, unit, unitPrice: null }` — there is no `itemId`
field in the schema at all, confirmed by reading every place `p.items`/`r.items` is read or
written across `openRfqModal`, `bindRfqCard` (13164-13227, the price-entry/convert-to-PR flow,
which mutates the SAME `items` array in place and never adds an id), and
`receivePurchaseIntoInventory` (which is why it has to resort to name-matching at all — there
is no id to match on). Critically, the "📉 From low stock" RFQ-prefill button
(departments.js:13112-13123) — the one RFQ-creation path that starts from actual
`inventory_items` documents, reading `isnap.docs.map(d => d.data())` and filtering on
`i.qty <= i.reorderLevel` — DISCARDS the doc id at the moment of RFQ creation:
```
const items = low.map(i => ({ desc: i.name || '', qty: Math.max(...), unit: i.unit || '' }));
```
`d.id` is available right there in scope and is simply never carried into the RFQ item shape.
So even in the single best-case flow, where the system unambiguously already knows which
`inventory_items` doc a line refers to, the information is thrown away and the line is
downgraded to a free-text name that `receivePurchaseIntoInventory` will later have to
re-guess by string comparison. Contrast with a working item-bound picker that already exists
in this exact file: `prodOrderModal`'s materials-consumed row (departments.js:12697-12716,
`matItemOpts` built at 12653) is a real `<select class="pm-item">` whose `<option value>` is
the `inventory_items` doc id, and `collectMaterials()` (departments.js:12713-12716) reads
`sel.value` directly as `itemId` — `consumeProductionMaterials` therefore has a hard id to
work with and never needs name-matching. This is the precedent pattern the mandate's "stop
silent name-mismatch loss" fix should extend to the RFQ flow, not invent from scratch.

5) WS13'S LEDGER-SIDE INVENTORY ASSET ACCOUNTING IS ALREADY LIVE AND IS A COMPLETELY
INDEPENDENT NUMBER FROM `inventory_items.qty × unitCost` — CONFIRMED, WITH NO RECONCILIATION
ANYWHERE. `git show 247fe04` is WS16 (perf), not WS13; WS13 (Chart of Accounts /
double-material-expensing fix) is already merged into the current departments.js (no separate
commit needed to verify — read directly). Two ledger-posting mechanisms exist for materials,
both already shipped: (a) `recordPurchaseDisbursement` (departments.js:13547-13642) — Finance's
"Record as Disbursement" action on a submitted PR — offers a `<select id="rec-acct">`
(departments.js:13559-13564) defaulting to `"Inventory – Materials (asset)"`, and
`postCDJToLedger` (departments.js:1491-1521, esp. 1504-1507: `const isInventory =
e.debitAccount === 'inventory'; const accountType = isInventory ? 'asset' : 'expense'; const
account = isInventory ? 'Inventory' : category;`) posts a ledger row tagged
`accountType:'asset', account:'Inventory', category:'Inventory – Materials'` for the PR's
dollar `total` — a pure bookkeeping entry keyed only on the PR's total peso amount, with NO
reference to which `inventory_items` docs it corresponds to, no `itemId`, nothing. (b)
`consumeProductionMaterials` (departments.js:12567-12632) posts the inverse — a COS debit
(`ref = POCOS-{id}`) PLUS, per the code comment at 12590-12592 ("Also posts the Inventory
contra leg (v12 WS13) — the asset decrease that nets against the asset booked at purchase
time"), a matching credit to the same `accountType:'asset', account:'Inventory'` bucket
(`refInv = POCOS-{id}-INV`, departments.js:12610-12623) — this is the fix for the
double-material-expensing bug, and it is real, already deployed, and already exercised by
`window.runRestateMaterialCosts` (departments.js:13573-13620), a one-time idempotent
president-only migration that reclassifies historical CDJ rows and backfills missing
`-INV` contra legs. NONE of this — not the purchase-time asset debit, not the
consumption-time asset credit — ever reads or writes `inventory_items.qty` or `.unitCost`.
They are two entirely parallel, never-cross-checked systems: `inventory_items` (physical
qty × cost, mutated by `receivePurchaseIntoInventory`/`consumeProductionMaterials`'s
`FieldValue.increment` calls) and the ledger's running "Inventory" asset-account balance
(a pure dollar figure, mutated by `postCDJToLedger`/`consumeProductionMaterials`'s ledger
`.add()` calls). They can and will drift: a PR line that fails `receivePurchaseIntoInventory`'s
name-match still gets its full peso amount posted as an Inventory asset debit if Finance
picks "Inventory – Materials (asset)" in `recordPurchaseDisbursement` — the ledger says stock
worth ₱X arrived, `inventory_items` says nothing arrived. Conversely Finance can choose
`"COS – Direct Material (direct-to-job, skips stock)"` (departments.js:13561) for a purchase
that `receivePurchaseIntoInventory` DID successfully match — the ledger books it as a
same-day expense with no asset leg, while `inventory_items.qty` still went up, so the ledger
and the physical stock count disagree about whether that stock is "on the books" as an asset
at all. Nothing anywhere sums `inventory_items.qty * unitCost` and compares it to the ledger's
running Inventory-account balance — no reconciliation report, no discrepancy alert. This is
exactly the "two independently-tracked numbers" gap flagged in the task brief, and it directly
overlaps the very next V12-PLAN item, workstream 30 ("Purchasing — ... receiving → stock +
ledger correctly (with 13's asset accounting)") — Fable must decide the WS29/WS30 boundary
explicitly (open decision 5 below) so the two plans don't silently duplicate or contradict
each other on this exact seam.

6) A STALE CODE COMMENT, CORRECTED: `consumeProductionMaterials`'s comment at
departments.js:12588-12589 says "the ledger is finance-write-gated, so a plain Production
employee can't post it" — this is FALSE against the current `firestore.rules`. The `ledger`
match block (firestore.rules:807-841) was specifically widened for WS13: `allow create` permits
`canFinance() || (canProduction() && ...)` with a tightly-fenced shape check (fixed
`category`/`refNumber` pattern via `.matches('POCOS-.*')`, `accountType` and `account` pinned
to the exact expense/asset pair, `amount` required positive) — a Production-department user
(`canProduction()`, firestore.rules:67: `isAdmin() || isProductionDept()`) CAN and structurally
DOES post both COS legs directly via this fenced rule. The try/catch around the ledger `.add()`
calls in `consumeProductionMaterials` (departments.js:12596-12626) is real defensive code (a
non-Production-non-Finance caller, or a genuinely malformed shape, still fails closed and
`cosPosted` reports `false`) but the comment's stated reason is out of date. Per the
finance-reporting-open-items memory and the leave-workstream's own finding about a similarly
stale app.js comment, in-repo comments in this codebase should not be trusted as ground truth
without a rules/grep cross-check — each claim above was independently verified against
`firestore.rules`, not inferred from comments.

## Data model

`inventory_items/{docId}` (top-level, auto-id) — fields observed across every writer
(js/modules.js itemModal save at 1990-1998, `receivePurchaseIntoInventory` at
departments.js:13512-13519, `consumeProductionMaterials`'s increment at departments.js:12579):
`name` (string), `kind` ('material' default | 'product', modules.js:1996 select), `unit`
(free string, e.g. "sheet"/"m"/"kg"/"pc"), `category` (free string), `qty` (number, on-hand),
`reorderLevel` (number, 0 = no reorder alert), `unitCost` (number, ₱ — OVERWRITTEN not
averaged on receive, per finding 1), `supplier` (string, auto-filled by
`receivePurchaseIntoInventory` only if blank), `supplierContact` (string), `lastReceivedAt`
(Timestamp, set only by `receivePurchaseIntoInventory`), `createdAt`/`updatedAt`
(serverTimestamp). No `location`/`warehouse` field exists (Count Form's "Warehouse /
Location" is a free-text HEADER field on the print form only, not per-item, not persisted).
No cost-history field of any kind exists — `unitCost` is a single scalar with no memory of
prior values, so a future weighted-average migration has NO historical purchase-price trail
to reconstruct a true WAC from; the only prior signal is whatever `unitCost` happens to hold
right now (already latest-price-corrupted for any item that has ever been received more than
once). Rules (firestore.rules:949-953): `allow read, write: if isAuth() && !isPartner()` — ANY
signed-in non-partner user, not scoped by department at all; the Production-dept nav gate
(js/app.js:994: `if (currentDepts.includes('Production')) items.push({...page:'inventory'})`)
is a CLIENT-side convenience, not a security boundary — a Sales or Design employee who
navigates to `inventory` directly (or via the president's always-visible nav item, app.js:937)
can read and write `inventory_items` exactly as freely as Production/Finance can, per the rule.

`stock_movements/{docId}` (top-level, auto-id) — fields, from the two live writers
(modules.js:2000-2003, 2035-2039): `itemId` (string, `inventory_items` doc id), `itemName`
(string, denormalized at write time — never re-synced if the item is later renamed), `type`
('in' | 'out' | 'adjust'), `qty` (number, always positive — the sign is implied by `type`, not
stored), `project` (string, optional, 'out' only — a free-text job/project label, NOT an
`itemId`-style foreign key to `job_projects`), `note` (string, optional), `by` (uid), `byName`
(string), `date` (string 'YYYY-MM-DD' via `bizDate()` — Manila-time-correct), `createdAt`
(serverTimestamp). Rules (firestore.rules:954-958): `allow read, create: if isAuth() &&
!isPartner()`; `allow update, delete: if isAuth() && isAdmin()` — i.e. the log is meant to be
append-only-by-design for regular staff (only admins can edit/delete a historical entry),
which any new receive/consume/count-variance writer should respect (create-only, never
update an existing movement row). No `refNumber`/idempotency-key field exists on this
collection today — nothing prevents (and nothing currently needs to prevent) a duplicate
movement row, since today's only writers are one-shot user button clicks, not
retry-prone/idempotency-sensitive automated flows like receiving or consumption will be.

`purchase_requisitions/{docId}` (top-level, auto-id, `stage: 'rfq' | 'pr'` distinguishes the
two phases of one lifecycle) — RFQ-stage fields (departments.js:13281-13292): `rfqNo` (string,
`RFQ-{year}-{last4ofDateNow}`), `title`, `supplier`, `requestingDept`, `neededBy` (date
string), `deliverTo`, `notes`, `items` (array of `{desc, qty, unit, unitPrice}` — `unitPrice`
starts `null`; **no `itemId` field exists in this shape at all**, confirmed finding 4),
`stage:'rfq'`, `total:0`, `status:'quoting'`, `createdBy`/`createdByName`/`createdAt`. On
convert-to-PR (departments.js:13206-13212): adds `prNo` (derived from `rfqNo` via
`replace(/^RFQ/,'PR')`), `status:'pending'` (then 'ordered'|'received' via the status
buttons, departments.js:13473-13495), `convertedAt/By/ByName`. Receive-time fields added by
`receivePurchaseIntoInventory`'s caller: `receivedToInventory` (bool, one-shot guard,
departments.js:13485). Finance-recording fields: `submittedToFinance*`, `recordedToFinance`,
`recordedBy/ByName`, `cdjEntryId` (departments.js:13629-13635) — Finance's `update` rule
(firestore.rules:891-895) is restricted to exactly these five bookkeeping keys via
`.diff(...).affectedKeys().hasOnly([...])`, so Finance structurally cannot rewrite `items`/
`total` even if it wanted to; only `canPurchasing()` can. Rules
(firestore.rules:885-897, full block already quoted in finding 6's cross-reference) — delete
is president-only once converted to `stage:'pr'`, freely deletable by Purchasing while still
`stage:'rfq'`.

`production_orders/{docId}` — the `materials` field (populated via `prodOrderModal`'s
item-bound picker, departments.js:12697-12716) is `[{ itemId, name, unitCost, qty }]` — this
IS bound to `inventory_items` doc ids (contrast with `purchase_requisitions.items`, which is
not). `materialsConsumed` (bool, one-shot guard against double-consumption, checked at
departments.js:12570), `materialsConsumedAt`, `materialsCost` (number, the computed `cos`
from `consumeProductionMaterials`). Rules (firestore.rules:968-972): any non-partner internal
staffer can create/update; admin-only delete.

`job_costs/{docId}` — a fully separate, entirely manually-typed collection
(js/modules.js:2090-2158, the "Job Costing" tab inside the Inventory module for
finance/admin): `project`, `quoteRef`, `revenue`, `materialsCost`, `laborCost`, `otherCost`
— all four cost/revenue numbers are hand-typed via a modal (modules.js:2126-2137) with zero
reference to `inventory_items`, `production_orders.materialsCost`, or the ledger. This is a
THIRD independently-tracked "materials cost" figure for the same physical reality (alongside
`inventory_items.qty*unitCost` and the ledger's Inventory/COS accounts) — worth Fable's
awareness even though it is not itself named in the WS29 mandate. Rules
(firestore.rules:960-963): finance/admin only, both read and write.

Ledger `Inventory` asset account (not a Firestore collection of its own — rows inside the
shared `ledger` collection, `accountType:'asset', account:'Inventory',
category:'Inventory – Materials'`) — written by `postCDJToLedger` (departments.js:1491-1521,
purchase-time debit, ref `CDJ-{id}`) and by `consumeProductionMaterials`'s contra leg
(departments.js:12610-12623, consumption-time credit, ref `POCOS-{id}-INV`). Both are dollar
figures with no `itemId`/quantity linkage back to `inventory_items` — see finding 5. Ledger
rules for the Production-postable COS/contra-leg shape: firestore.rules:807-841 (quoted in
full in finding 6).

`js/config.js`'s shared cache (js/config.js:348-385, `dbCachedGet`/`dbCacheInvalidate`) — the
single `'inventory_items'` key, 45-second TTL, used by all nine read sites in finding 0/1
above. `dbCacheInvalidate('inventory_items')` is already called after every existing write
(modules.js:2008,2015,2041; departments.js:12630,13525) — any new receive/consume/count-post
writer must call it too, or a just-updated qty will read stale for up to 45s from any other
open tab/screen.

## Constraints — must respect

- Script load order is fixed and load-bearing (CLAUDE.md; confirmed in index.html:302-323):
  config.js loads before drive.js/notifications.js/departments.js/app.js, and **modules.js
  loads LAST**. The existing `stock_movements`-writing code lives in a private IIFE inside
  modules.js and is not on `window` — any shared movement-posting helper this workstream
  introduces for the receive/consume paths (both in departments.js) MUST live in a file that
  loads before departments.js (i.e. js/config.js) and be attached to `window`, or it will be
  `undefined` when departments.js's top-level functions are defined/called. Do not assume the
  existing `moveModal`/`itemModal` internals are reachable from departments.js — they are not
  (finding 2).
- Firestore rules do not cascade or match by prefix (repo-wide convention, confirmed again
  here across `inventory_items`, `stock_movements`, `purchase_requisitions`,
  `production_orders`, `job_costs`, `ledger` — six separate explicit match blocks for six
  related-but-distinct collections). Any NEW collection or field-shape guard this workstream
  adds (e.g. an idempotency-log doc for receive/consume movements, or a tightened
  `inventory_items` write rule) needs its own explicit block and a separate `firebase deploy
  --only firestore:rules` run — `git push` does not deploy rules (CLAUDE.md; confirmed
  firebase-deploy-rules memory).
- `escHtml()` must wrap every field interpolated into innerHTML — already followed
  consistently in `renderStock`, `itemModal`, `moveModal`, `renderProdInventoryForm`,
  `openInventoryCountForm`, `openRfqModal`, `purchRfqCard` (every `${escHtml(...)}` call
  observed). Any new UI (an item-picker `<select>` for RFQ, a "post variance" button/modal,
  a receive/consume movement-history row) must keep this discipline for free-text fields
  like `desc`, `note`, `remarks`, `supplier`.
- Manila-time discipline: `stock_movements.date` is already written via `bizDate()`
  (modules.js:2039) and the Count Form's default date via `bizDate()`
  (departments.js:12806-12808) — any new movement-write timestamp must follow the same
  pattern, never raw `new Date().toISOString()` (manila-time-helpers memory: this exact class
  of bug previously corrupted attendance and payroll).
- `stock_movements` create is open to any non-partner signed-in user but update/delete is
  admin-only (firestore.rules:955-957) — the log is designed to be append-only for regular
  staff. A new receive/consume/count-variance writer should ADD rows, never rewrite or
  "correct" an existing movement row after the fact (post a reversing/adjustment entry
  instead, mirroring how the ledger's `resyncLedgerForSource` pattern re-posts rather than
  mutates history in place — departments.js:1527-1569).
- `inventory_items` write is `isAuth() && !isPartner()` with NO department scoping at all
  (firestore.rules:949-953) — broader than the client nav gate (Production-dept-only for
  regular employees, app.js:994). If this workstream tightens write access as part of adding
  idempotency/shape guards (e.g. requiring a `refNumber` on movement-triggered qty changes),
  it must not silently lock out the manual Stock In/Out flow that other non-Production
  internal roles currently rely on (e.g. Finance adjusting a count post-audit) — confirm who
  besides Production/Purchasing needs continued write access before narrowing the rule.
- The idempotency pattern used throughout finance/payroll (deterministic refs like
  `PAY-{month}-{uid}`, `POCOS-{orderId}`, `CDJ-{id}`; check-before-write via a `.where(
  'refNumber','==',ref).limit(1).get()`) is the established discipline for "must not
  double-post" flows in this codebase (departments.js:12593-12599, 12611-12613,
  1492-1494, 1560). A new movement log entry for receive/consume should follow the same
  discipline if it needs to be safely re-runnable (e.g. a retried "Mark Received" click after
  a network blip) — `receivePurchaseIntoInventory` and `consumeProductionMaterials` already
  have DOC-LEVEL one-shot guards (`p.receivedToInventory`, `order.materialsConsumed`), but
  those guard the qty mutation, not (yet) any movement-log write; a partial-failure case
  (qty batch commits, movement-log write throws) needs an explicit decision (open decision 3).
- `consumeProductionMaterials`'s stock decrement + order-flag commit atomically via one
  `db.batch()` (departments.js:12574-12586, explicit comment "stock + flag atomic — can't
  double-decrement") but the ledger COS/contra-leg posts happen AFTER that batch, in a
  separate best-effort try/catch (departments.js:12596-12626) — i.e. the existing code
  already accepts "stock is always right, ledger might lag/fail silently (logged via
  `console.warn`, toast still says success)" as a tradeoff. Any new movement-log write should
  decide explicitly whether it joins the atomic batch (preferred, since it's describing the
  SAME stock mutation) or follows the ledger's looser best-effort pattern — recommend the
  former, since an un-logged stock change is precisely the gap this workstream exists to close.
- CACHE_VER in sw.js must be bumped on any JS/CSS edit (CLAUDE.md; auto-bump hook covers
  `APP_VERSION`/`index.html` version strings only, not `CACHE_VER`) — every write site already
  calls `dbCacheInvalidate('inventory_items')` after mutating stock; new writers must too.

## Open decisions

- [ ] **Weighted-average cost formula, precision, and inputs.** Exact formula (standard:
  `newUnitCost = (oldQty*oldUnitCost + recvQty*recvUnitPrice) / (oldQty + recvQty)`, with a
  defined fallback when `oldQty <= 0` — e.g. a stockout followed by a receive, where WAC
  degenerates to just the new price). Rounding/precision (peso amounts elsewhere in the app
  use 2-decimal display via `fmt()`/`peso()` but store raw floats — should WAC store full
  float precision or round at write time?). Because `receivePurchaseIntoInventory` currently
  uses a single `db.batch()` with blind `FieldValue.increment()` (no read of current values),
  computing a WAC requires reading each matched item's CURRENT `qty`+`unitCost` before
  writing (a transaction, or a pre-batch read pass) — decide whether this becomes a
  `db.runTransaction` per item (safe under concurrent receives, more Firestore reads) or a
  read-all-then-batch-write pass (matches the existing code shape more closely but is not
  safe against two simultaneous "Mark Received" clicks racing on the same item). Also decide
  whether the PR line's raw `unitPrice` (VAT-exclusive or inclusive? `recordPurchaseDisbursement`
  applies `vatSplit` only at the ledger-dollar level, departments.js:13567-13587 — the PR
  line-item `unitPrice` itself is never VAT-split) is the correct WAC input, or whether a
  "landed cost" (freight, VAT treatment) adjustment belongs in this workstream or is
  out-of-scope/deferred.
- [ ] **No historical cost trail exists to backfill from.** `inventory_items.unitCost` is a
  single scalar with no purchase-price history (finding, Data model section) — every item
  that has ever been received more than once already has a latest-price-corrupted
  `unitCost`, and there is no way to reconstruct what a "correct" WAC would have been
  retroactively. Decide: leave existing `unitCost` values as-is (WAC only applies going
  forward from the day this ships) and document that as a known one-time inaccuracy, or
  attempt some form of backfill (and from what source — `stock_movements` doesn't carry
  received-cost detail either, so there is likely no data to backfill FROM).
- [ ] **Where the shared movement-posting helper lives, and its exact signature.** Given the
  load-order/closure-privacy constraint above (modules.js loads last and its
  `stock_movements` writers are private), decide the helper's home (recommended: js/config.js,
  attached to `window`) and signature — e.g. `window.postStockMovement({itemId, itemName,
  type, qty, project, note, source, refNumber, by, byName})` — such that the EXISTING manual
  Stock In/Out (modules.js:2035-2039) and manual on-hand-edit adjust log
  (modules.js:2000-2003) are refactored to call the SAME helper (closing the
  three/four-way-duplication risk), not left as a third and fourth independent
  `db.collection('stock_movements').add(...)` call site.
- [ ] **New `type`/`source` values on `stock_movements`, and reader updates.** The existing
  enum is `'in'|'out'|'adjust'` with badges hardcoded in exactly two places
  (`itemHistoryModal`, modules.js:1968; `renderMovements`, modules.js — its `typeBadge`
  function). Decide whether receive/consume get NEW type values (e.g. `'receive'`/`'consume'`)
  needing new badge cases in both readers, or reuse `'in'`/`'out'` with a new `source` field
  (mirroring the ledger's existing `source:'Production'`/`'Cash Receipt'`/`'Cash
  Disbursement'` discriminator pattern) so the two existing badge switches don't need
  editing at all — only their label/subtitle rendering would optionally change.
- [ ] **Idempotency + atomicity for the receive-triggered and consume-triggered movement
  writes.** Should the new movement log entry join `consumeProductionMaterials`'s existing
  atomic `db.batch()` (departments.js:12574-12586) so stock-decrement and movement-log can
  never desync? For `receivePurchaseIntoInventory`, should each matched PR line get its own
  movement row (keyed by a deterministic ref like `RECV-{prId}-{lineIndex}` so a retried
  "Mark Received" click, or the WAC-transaction retry above, can't double-log), and does that
  ref-check live on `stock_movements` itself (a new `refNumber` field + rules guard, since
  none exists there today) or continue to rely purely on the PR's own
  `receivedToInventory` doc-level flag?
- [ ] **Count-form variance posting: mechanism, permission gate, and ledger interaction.**
  The form is currently 100% localStorage + print, explicitly commented "not a stock
  mutation" (departments.js:12790). Decide: (a) does "post variance" write straight to
  `inventory_items.qty` (an absolute correction to the physical count) plus a
  `stock_movements` row of type `'adjust'` (reusing the exact pattern already at
  modules.js:1996-2008, or the new shared helper above)? (b) what permission gates a post —
  same as manual edit (`canEditInv()`/`isFinAdmin()`, i.e. any non-partner staffer per current
  rules) or a NEW, stricter gate given this workstream is explicitly about correctness (e.g.
  require `isFinAdmin()` to post, while any staffer can still fill in the count)? (c) does a
  posted variance need its own ledger entry (an inventory shrinkage/gain adjusting the
  ledger's "Inventory" asset-account dollar balance, tightening finding 5's reconciliation
  gap) or does it stay stock-quantity-only, matching how the existing manual Stock In/Out
  never touches the ledger today? (d) is posting per-row (post each counted item
  individually, as counted) or a single "Post All Variances" batch action over the whole
  draft?
- [ ] **`inventory_items.qty × unitCost` vs. the ledger's dollar-value "Inventory"
  asset-account balance: reconcile, flag, or explicitly defer to WS30?** Finding 5 establishes
  these are two independent numbers today with zero cross-checking, and this exact seam is
  also named in the very next V12-PLAN item (workstream 30: "Purchasing — ... receiving →
  stock + ledger correctly (with 13's asset accounting)"). Decide the WS29/WS30 boundary
  explicitly: does WS29 leave this reconciliation entirely to WS30 (in which case this brief's
  finding 5 should be handed to WS30's own grounding pass, not resolved here), does WS29 add a
  read-only reconciliation report/discrepancy banner (no behavior change, just visibility), or
  does WS29's WAC/receive-path rewrite need to also change what `recordPurchaseDisbursement`
  posts to the ledger (e.g. deriving the ledger's Inventory-asset debit FROM the same receive
  event that updates `inventory_items`, rather than two independently-triggered actions from
  two different departments)?
- [ ] **RFQ item binding: hybrid picker+free-text, `itemId` propagation, and
  receive-side matching order.** Decide the exact UI (a `<select>`/searchable-combo bound to
  `inventory_items` ids, mirroring `matItemOpts`/`prodOrderModal`'s pattern at
  departments.js:12653,12697-12716, with an explicit "+ New / not-yet-stocked item" free-text
  fallback) and the resulting `purchase_requisitions.items[]` shape (add `itemId: string|null`
  alongside the existing `desc/qty/unit/unitPrice`?). Decide whether the "From low stock"
  prefill (departments.js:13112-13122) is fixed in the same change to carry `itemId: i.id`
  immediately, since it already has the real doc in hand. Decide `receivePurchaseIntoInventory`'s
  updated matching order: `itemId` exact-match first (when present), falling back to today's
  case-insensitive name match only when `itemId` is absent — needed for backward
  compatibility with any RFQ/PR already in flight (`stage:'pr'`, not yet received) at the
  moment this ships, which will have no `itemId` on their line items.
- [ ] **Unmatched-line behavior on receive.** Today an unmatched line silently sets
  `receivedToInventory:true` anyway (departments.js:13483-13485) with no way to revisit it.
  Decide: does an unmatched/no-`itemId` line auto-create a new `inventory_items` doc on
  receive (turning "silent loss" into "silent auto-creation," which may itself need review —
  a typo'd RFQ description would now mint a duplicate item rather than merely failing to
  match one), or does it require an explicit human resolution step (a "Match to existing
  item" / "Create new item" prompt) before the PR can be marked fully received, or does
  `receivedToInventory` become per-line rather than per-PR so a partially-matched receipt
  isn't an all-or-nothing flag?
- [ ] **Count Form collaboration/scope.** Out-of-mandate but adjacent: is the
  localStorage-only, single-device draft (no Firestore doc at all for an in-progress count)
  acceptable to keep once variance-posting is added, or does adding a real Firestore-backed
  write path for posting also imply the draft itself should move to Firestore (so a count
  in progress is visible/resumable across devices, and a supervisor can review before
  posting)? Is per-location/warehouse counting in scope, given `inventory_items` has no
  `location` field today and the form's "Warehouse / Location" is a single free-text header
  field, not a per-item dimension?

## Risks / cross-workstream interactions

- ⚠️ Direct overlap with workstream 30 (Purchasing — "PO approval gate before the
  President's name prints; receiving → stock + ledger correctly (with 13's asset
  accounting)"): both workstreams touch `receivePurchaseIntoInventory` and the
  receive-time interaction between `inventory_items` and the ledger's Inventory asset
  account (finding 5). Building WS29's WAC/movement-log rewrite without an explicit
  handshake on this boundary risks either workstream reverting or duplicating the other's
  changes to the exact same function (departments.js:13501-13528) and the exact same
  ledger-tagging logic (departments.js:1491-1521, 13547-13642).
- ⚠️ Direct overlap with workstream 28 (Production process flow — stage renaming,
  per-stage worker assignment, delivery-receipt requirement, QC checklist): the Count Form
  (departments.js:12795-13018) and `consumeProductionMaterials`
  (departments.js:12567-12632) both live inside `renderProductionDept`
  (departments.js:12377-12404), the same screen WS28 is simultaneously restructuring
  (`PROD_STAGES`, the Orders/Materials/Inventory/Count Form/Tasks/Files subtab set). A
  movement-log write triggered by consumption, or a variance-posting UI added to the Count
  Form subtab, should be built against WS28's NEW stage/subtab structure if WS28 lands
  first, or coordinate sequencing if WS29 lands first, to avoid one workstream's PR
  clobbering the other's changes to the same ~600-line region of departments.js.
- ⚠️ `inventory_items` write access is unscoped by department (firestore.rules:949-953:
  any non-partner signed-in user) even though the client nav gate is Production-scoped for
  regular staff — any rules tightening this workstream adds (e.g. requiring a `refNumber`
  or blocking direct `qty`/`unitCost` writes in favor of routing everything through
  movement-logged helpers) must not accidentally break a legitimate non-Production write
  path (e.g. a Finance user's manual correction) without an explicit decision on who should
  retain direct-write access post-WS29.
- ⚠️ The stale code comment at departments.js:12588-12589 (claiming Production can't post
  to the ledger) shows this codebase's in-repo comments have previously drifted out of sync
  with the actual `firestore.rules` after a rules change (WS13 widened `canProduction()`'s
  ledger-create rights without the adjacent comment being updated) — any new
  movement/reconciliation logic this workstream documents in comments should be
  cross-verified against the deployed rules at implementation time, not assumed accurate
  from a nearby comment.
- ⚠️ `job_costs` (js/modules.js:2090-2158) is a THIRD, fully manual, disconnected
  "materials cost" number for the same underlying reality that `inventory_items` and the
  ledger's COS/Inventory accounts already track independently (finding, Data model section)
  — not named in the WS29 mandate, but any reconciliation work done under open decision
  "inventory vs. ledger" should be aware a third untied number exists in the same module
  (Inventory → Job Costing tab) so Fable can explicitly scope it in or out rather than have
  it surface as a surprise during implementation.
- ⚠️ The Products BOM materials-cost calculator (`openBomModal`, js/app.js:1783-1814) reads
  `inventory_items.unitCost` live and un-cached (a raw `db.collection('inventory_items').get()`
  at app.js:1792, NOT going through `dbCachedGet`) to price a product's Bill-of-Materials
  capital cost for the quote builder — if this workstream changes what `unitCost` means
  (moving-average vs. latest-price), that shift automatically flows into product/quote
  pricing the next time a BOM is re-applied, with no code change needed there, but it also
  means BOM-derived quote prices will silently shift on this workstream's ship date — worth
  flagging to Neil/Fable as a downstream pricing effect, not just an inventory-module-local
  change.
- ⚠️ No `assertPeriodOpen`/`isPeriodClosed` gate exists on `consumeProductionMaterials`'s
  ledger posts (departments.js:12567-12632), unlike every other ledger-writing path in
  Finance (`postExpenseToLedger`, `postCRJToLedger`, `postCDJToLedger` callers all check
  `window.assertPeriodOpen`/`isPeriodClosed` — js/departments.js:1439,1467,1498 and others).
  If this workstream adds new ledger-touching behavior (e.g. a variance-posting-to-ledger
  path from open decision "count-form ledger interaction"), decide explicitly whether it
  respects the period-close gate like the rest of Finance, or knowingly inherits this
  existing gap alongside `consumeProductionMaterials`.

## Files likely touched

`js/departments.js` (`receivePurchaseIntoInventory` at 13501-13528 and its caller in
`renderPurchaseRequests`'s `pr-stat` handler at 13473-13495 — the WAC rewrite;
`consumeProductionMaterials` at 12567-12632 — the consumption movement-log write;
`renderProdInventoryForm`/`openInventoryCountForm` at 12795-13018 — count-form variance
posting; `openRfqModal`/`bindRfqCard`/`purchRfqCard`/`renderRFQs` at 13096-13298 — RFQ item
binding, plus the "From low stock" prefill at 13112-13123; `prodOrderModal`'s `matItemOpts`
at 12653 as the item-picker pattern to extend into RFQ; `postCDJToLedger`/
`recordPurchaseDisbursement` at 1491-1521, 13547-13642 if the WS29/WS30 ledger-reconciliation
boundary lands partly in this workstream), `js/modules.js` (the Inventory IIFE at
1828-2159 — `itemModal`/`moveModal`/`itemHistoryModal`/`renderMovements`, the only existing
`stock_movements` writers/readers, likely refactored to call a new shared helper rather than
duplicate logic a third/fourth time), `js/config.js` (the most likely home for a new shared
`postStockMovement`-style helper, given the load-order constraint; also
`dbCachedGet`/`dbCacheInvalidate` at 348-385 if a new cache key is introduced),
`firestore.rules` (`inventory_items` 949-953, `stock_movements` 954-958,
`purchase_requisitions` 885-897, `production_orders` 968-972, `ledger` 807-841 — any of
these needing a shape guard, a new `refNumber`/idempotency field, or a rule change to admit
a new movement-triggering write path), `js/app.js` (`openBomModal` at 1783-1814 if `unitCost`'s
meaning changes in a way that needs surfacing/labeling to the quote-builder capital-cost
flow; the dashboard low-stock KPI reads at 2380,2412 and 2792 as consumers of
`inventory_items` that must keep working unchanged), `sw.js` (CACHE_VER bump, required on any
JS/CSS edit per repo convention).

## Expected deliverable format

> Fable's output for this workstream should let Sonnet implement mechanically with zero
> further judgment calls. Concretely it should include: (1) the exact resolution of every
> open decision above, stated as a decision with a one-line rationale, not a menu of options;
> (2) the exact weighted-average-cost formula and the precise before/after code for
> `receivePurchaseIntoInventory` (departments.js:13501-13528) showing how each matched line's
> new `qty`/`unitCost` is computed and written (transaction vs. read-then-batch, spelled out),
> plus the exact new-or-reused shared movement-posting helper's function signature and its
> call sites in BOTH `receivePurchaseIntoInventory`/`consumeProductionMaterials`
> (departments.js) and the refactored `itemModal`/`moveModal` (modules.js), with the helper's
> file location justified against the load-order constraint; (3) the exact
> `stock_movements` shape additions (new `type`/`source`/`refNumber` fields) and the exact
> before/after diffs for the two existing badge/reader call sites
> (`itemHistoryModal`/`renderMovements` in modules.js) so neither silently fails to render a
> new movement kind; (4) for the Count Form: the exact new write path (which collection,
> which fields, which permission gate) turning a posted variance into a persisted
> `inventory_items.qty` correction plus a movement-log row, with the exact UI change
> (button, confirmation copy) to `renderProdInventoryForm`/`openInventoryCountForm`
> (departments.js:12795-13018); (5) for RFQ item binding: the exact new
> `purchase_requisitions.items[]` shape (with `itemId`), the exact UI diff to `openRfqModal`'s
> `addRow` (departments.js:13251-13262) and the "From low stock" prefill
> (departments.js:13112-13123), and the exact updated matching order in
> `receivePurchaseIntoInventory`; (6) the exact `firestore.rules` diffs (unified before/after
> blocks, same comment style as the existing file) for every collection touched, with an
> explicit note that `firebase deploy --only firestore:rules` is a separate step from
> `git push`; (7) an explicit, numbered migration/rollout checklist covering: whether/how
> existing `inventory_items.unitCost` values are left as-is vs. touched, whether existing
> in-flight (`stage:'pr'`, not yet received) RFQs/PRs need any transitional handling now that
> `receivePurchaseIntoInventory`'s matching logic changes, and the explicit WS29/WS30
> boundary decision so whoever builds workstream 30 next knows exactly what this workstream
> did and did not resolve about the `inventory_items`-vs-ledger reconciliation gap (finding
> 5); (8) a manual test checklist (no automated suite exists in this repo) exercising: a
> multi-receive WAC calculation by hand-checked arithmetic, a full receive→consume cycle
> producing exactly the expected `stock_movements` rows, a Count Form entry→post→variance
> cycle, and an RFQ created via the picker whose received PR line matches by `itemId` even
> when the supplier's description text differs from the inventory item's stored name.
