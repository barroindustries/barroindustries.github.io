# Workstream 30 — Purchasing (PO approval gate, receiving correctness)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

The whole Purchasing flow lives in one Firestore collection, `purchase_requisitions`, keyed
by a `stage` field ('rfq'|'pr') so the RFQ→Purchase-Request conversion preserves line items
and history (comment at js/departments.js:13057-13060). `window.renderPurchasing`
(departments.js:13066-13081) shows three chip-tabs ('Request for Quotation', 'Purchase
Requests', 'Tasks'); `loadPurchasingContent` (13083-13093) routes 'Purchase Requests' to
`renderPurchaseRequests`, default to `renderRFQs`. An employee (any role) creates an RFQ via
`openRfqModal` (13229-13298; gated `canEditDept('Purchasing')`), writing `{rfqNo, title,
supplier, requestingDept, neededBy, deliverTo, notes, items:[{desc,qty,unit,unitPrice:null}],
stage:'rfq', total:0, status:'quoting', createdBy, createdByName, createdAt}`. Prices are
entered per-line in `purchRfqCard`/`bindRfqCard` (13128-13227); clicking "Convert to Purchase
Request →" (`.rfq-convert`, 13198-13216) requires every item to have a non-null `unitPrice`,
then updates the SAME doc to `{items, total, stage:'pr', status:'pending', prNo (derived:
rfqNo.replace(/^RFQ/,'PR') or 'PR-'+today()), convertedAt, convertedBy, convertedByName}` — no
approval step, no second signer, purely the same Purchasing-dept user acting alone.
`renderPurchaseRequests` (13327-13496, shared by the Purchasing tab and Finance's read-only
"Purchases" tab via `{viewOnly:true, financeView:true}` from `loadFinanceContent`'s
`case 'Purchases'`, departments.js:2033-2038) renders a "🖨 Print PO" button
(`.pr-print`, line 13404) **unconditionally for every row, with no status/approval check and
outside the `canEdit` block** — bound at 13417-13420 to call `printPurchaseOrder(p)` directly.
`printPurchaseOrder` (13648-13777) builds the document via `window.buildLetterhead` (WS14,
already converted — V12-PLAN.md changelog ~421-430 lists `printPurchaseOrder` as one of the
four WS14 conversions done this session, with a same-shape hand-rolled fallback at
13726/13765-13770 if `buildLetterhead` isn't loaded — **no letterhead-adoption work remains
for WS30**), passing `signatures:[{label:'Prepared by', name:p.convertedByName||p.createdByName,
title:'Purchasing'}, {label:'Approved by', name:_sig.name, title:_sig.title}]` where `_sig =
window.BRAND.legal.signatory` = the static constant `{name:'NEIL BARRO', title:'President,
Barro Industries OPC'}` (js/config.js:865). **There is no `approvedBy`/`approvedAt`/
`approvalStatus`/`poApproved` field anywhere in the schema** (confirmed by reading every write
site to this collection) — the President's name and title print as a pre-filled, ready-to-sign
"Approved by" line the instant a Purchasing employee converts an RFQ, with zero actual approval
action ever required or recorded. `canEditDept('Purchasing')` (departments.js:17-25) resolves
true unconditionally for president/owner/manager/secretary, false for the `finance` role
(finance is scoped to `dept==='Finance'` only, hence the Finance tab's `viewOnly:true`), and
otherwise `(window.currentDepts||[]).includes('Purchasing')` — so a plain `employee`-role user
merely assigned to the Purchasing department can unilaterally create, price, convert, print,
mark-ordered, and mark-received a purchase order end-to-end. firestore.rules mirrors this
exactly (881-898, quoted verbatim below): `create` and `update` both check only
`canPurchasing()` = `isAdmin() || isPurchasingDept()` (rules:55-60; `isAdmin()` = president/
manager/secretary, rules:21) — there is no `isPresident()`/approval clause on create or update
at all, only on `delete`. Marking a PR "received" (`.pr-stat` handler, 13473-13496) — gated the
same `canEdit` — auto-fires `receivePurchaseIntoInventory(p)` once (`!p.receivedToInventory`
guard) which ONLY touches `inventory_items`: case-insensitive/trimmed name-match, `qty`
incremented via `FieldValue.increment`, `unitCost` **overwritten** to the purchase's
`unitPrice` if positive (last-price, not weighted-average — explicitly WS29's stated scope,
see Risks), `supplier` back-filled if blank; unmatched line descriptions are silently dropped
(only surfaced in a toast, no item auto-created, no `stock_movements` row written — the only
`stock_movements` writes in the whole repo are the three manual count/adjust call sites in
js/modules.js:1947/2001/2035/2049). **`receivePurchaseIntoInventory` never touches `ledger` or
`cash_disbursement_journal` — it has zero ledger-posting code.** The only path that posts a
purchase to the ledger is the fully separate, Finance-only, manually-clicked "Record as
Disbursement" (`.pr-record`, 13468-13471, gated `canRecord = financeView && isFinancePriv()`)
→ `recordPurchaseDisbursement` (13547-13642): a modal where Finance re-enters/confirms
date/payee/amount and picks a "Debit Account" dropdown now defaulting to
`value="inventory" selected` ("Inventory – Materials (asset)", line 13560 — per V12-PLAN.md's
WS13 changelog line 340: "`recordPurchaseDisbursement` defaults to the new `inventory`
account"), writes a `cash_disbursement_journal` doc, then calls `postCDJToLedger` (1491-1521)
which sets `accountType: e.debitAccount==='inventory' ? 'asset' : 'expense'` and
`account: isInventory ? 'Inventory' : category` (1504-1507) — WS13's asset-vs-expense fix (the
mandate's "13's asset accounting") is correctly wired for whatever this manual step posts.
**Receiving (stock update) and ledger-posting (asset-correct) are today two fully decoupled,
independently-triggered human actions on the same doc — connected only by a Slack-style
notification ("Submit to Finance" pings Finance, `notifyFinanceTeam`, 13457-13461), not by any
code path that fires or checks them together.** A PR can sit "received" with stock already
incremented and never be recorded to the ledger at all; conversely Finance could record a
disbursement before physical delivery. There is no partial-receiving: `receivePurchaseIntoInventory`
processes every line in one shot per `receivedToInventory` boolean. A legacy `purchase_orders`
collection exists only in firestore.rules (873-878, comment: "legacy Finance → Purchasing tab");
grep across every live `.js`/`.html` file finds zero reads/writes to it (the one hit repo-wide
is inside a stale, unrelated `.claude/worktrees/wf_783ec1d0-56d-1/` leftover, not on this
branch) — treat as dead. Separately, the app already has a reusable, actively-used
status-gated-approval pattern that a PO gate could plug into: the unified Approvals queue
(`APPROVAL_CAPS`, departments.js:10052-10066) maps request "type" → allowed approver roles
(e.g. `'quote-approval':['president','manager']`, `'raise':['president']`,
`'finance-del':['president']`) with a secretary-escalate-only path (`canEscalate`, 10068) for
types secretary can't act on, plus two live analogues of a document-approval workflow: the
BS/BK quotation approval (`bs_quotes`/`bk_quotes`, `status` cycling
quoting→pending_approval/pending_review→approved/rejected, `approveQuoteApproval` at 11003,
`openQuoteApprovalReview` at 11027, gated `isPrivileged` = president/owner/manager at 9110) and
the Raises workflow (`pending_raises`, `status:'pending_approval'`→president-only approve via
`sr-approve-btn`, 2268-2322). None of this is wired to `purchase_requisitions` today — it is
cited here only as existing, reusable machinery Fable may or may not choose to extend.

## Data model

`purchase_requisitions/{docId}` (top-level collection, no subcollections): `stage:'rfq'|'pr'`;
`status`: `'quoting'` while stage is `'rfq'`, else one of `pending|ordered|received` per
`PURCH_STAT` (departments.js:13303-13307); `rfqNo` (client-generated
`` `RFQ-${bizYear}-${String(Date.now()).slice(-4)}` ``, 13280); `prNo` (derived from `rfqNo` on
convert, or `'PR-'+today()`); `title`, `supplier`, `requestingDept` (one of the `DEPARTMENTS`
keys minus Brilliant Steel/Partners), `neededBy` (date string), `deliverTo`, `notes`; `items:
[{desc, qty:number, unit, unitPrice:number|null}]`; `total:number` (`purchTotal(items)` =
Σ unitPrice×qty, null-safe, 13061-13064); `createdBy`, `createdByName`, `createdAt`
(serverTimestamp); `convertedAt`, `convertedBy`, `convertedByName` (set once, on RFQ→PR);
`submittedToFinance:bool` + `submittedToFinanceAt/By/ByName`; `recordedToFinance:bool` +
`recordedToFinanceAt/By/ByName` + `cdjEntryId` (set by Finance's Record-as-Disbursement, the
only fields Finance may write per the rules `.hasOnly(...)` clause below); `receivedToInventory:
bool` (idempotency guard for the auto-receive step). **No approval-related field exists.**
Related collections already covered in full by `fable-workplan/13-coa.md`'s Data model
section (cash_disbursement_journal, ledger, inventory_items shapes) — the purchase-specific
fields there are `cash_disbursement_journal.purchaseRef` (→ this collection's docId) and
`cash_disbursement_journal.debitAccount` ('inventory'|'material'|'ap'|'sundry', 13558-13564),
and `ledger.refNumber = 'CDJ-<cdjId>'` with `accountType:'asset', account:'Inventory'` when
`debitAccount==='inventory'`. `inventory_items` fields touched by receiving: `qty` (increment),
`lastReceivedAt`, `unitCost` (conditional overwrite), `supplier` (fill-if-blank) —
`receivePurchaseIntoInventory`, 13501-13528.

Current `firestore.rules` block (881-898), verbatim:
```
    // Purchase requisitions — the Purchasing department's RFQ → Purchase Request
    // flow (stage: 'rfq' | 'pr'). Purchasing dept maintains them; Finance gets
    // read access to see committed purchases. Draft RFQs are freely deletable by
    // Purchasing; once converted to a PR, only the President may delete.
    match /purchase_requisitions/{docId} {
      allow read: if isAuth() && (canPurchasing() || canFinance());
      allow create: if isAuth() && canPurchasing();
      // Purchasing edits the requisition freely. Finance may ONLY stamp the
      // bookkeeping fields (mark a purchase as recorded into the journal) so a
      // purchase can't be double-posted — not rewrite items/prices.
      allow update: if isAuth() && (
        canPurchasing()
        || (canFinance() && request.resource.data.diff(resource.data).affectedKeys()
              .hasOnly(['recordedToFinance','recordedToFinanceAt','recordedBy','recordedByName','cdjEntryId']))
      );
      allow delete: if isAuth() && (isPresident()
        || (canPurchasing() && resource.data.get('stage', 'rfq') == 'rfq'));
    }
```
Adjacent legacy block, also verbatim (873-878, dead code per Current State):
```
    match /purchase_orders/{docId} {
      allow read: if isAuth() && canFinance();
      allow create, update: if isAuth() && canFinance();
      allow delete: if isAuth() && isPresident();
    }
```
`canPurchasing()` (rules:60) = `isAdmin() || isPurchasingDept()`; `isPurchasingDept()`
(rules:55-58) reads `users/{uid}.department=='Purchasing'` or `.departments` array-contains;
`isAdmin()` (rules:21) = role in `['president','manager','secretary']`.

## Constraints — must respect

- Firestore rules coverage does not cascade or match by prefix (firestore-rules-collection-coverage
  memory + CLAUDE.md) — any new field-shape guard added to `purchase_requisitions.update`, or a
  new collection (e.g. an approval log), needs its own explicit rule clause/block or reads
  silently deny.
- Rules must read new/optional fields via `.get(field, default)`, never bare access
  (firestore-rules-missing-field-throws memory) — every existing PR doc predates any approval
  field, so a rule checking `resource.data.approvalStatus` directly will deny on every one of
  them.
- Idempotency-by-deterministic-refNumber is load-bearing for every ledger post (`CDJ-<id>`,
  `POCOS-<id>`, `POCOS-<id>-INV`, etc., per 13-coa.md's Constraints) — any change that makes
  receiving auto-post to the ledger must preserve an existence-check-before-add and must not
  double-post alongside the still-present manual "Record as Disbursement" button (check
  `recordedToFinance`/`cdjEntryId` first).
- WS13's `accountType`/`account` asset-vs-expense split inside `postCDJToLedger` (1504-1507) is
  the exact "13's asset accounting" the mandate names and is already correct for whatever calls
  it — extend/call this existing logic rather than re-deriving account classification
  independently.
- `escHtml()` discipline: `printPurchaseOrder`'s local `e()` helper (13649) and the PR list
  template already escape every interpolated field (13380-13402) — any new
  approval-status label, comment, or rejection-reason field must follow the same.
- CACHE_VER in sw.js must be bumped on any JS/CSS edit (auto-bumped by the pre-commit hook per
  CLAUDE.md — do not hand-edit `APP_VERSION`).
- Script load order is fixed: config.js → drive.js → notifications.js → departments.js →
  app.js → modules.js — a new shared helper (e.g. `window.canApprovePO`) used by multiple files
  must be defined in config.js.
- `dbCachedGet`/`dbCacheInvalidate` discipline — `receivePurchaseIntoInventory` already
  invalidates `'inventory_items'` (13525); `recordPurchaseDisbursement` invalidates `'ledger'`
  (13636); any new write path must invalidate the correct cache keys or stale reads persist for
  up to 45s.
- The Corporate Secretary role is explicitly view-only oversight on major/money-moving approvals
  per the corporate-secretary-and-approval-authority memory, and is already excluded from
  `APPROVAL_CAPS`'s money-moving types (`ca`, `raise`, `finance-req`, `finance-del`,
  `delete-quote`, `delete-client`) — any PO-approval gate that is money-moving belongs in that
  same excluded set unless explicitly decided otherwise.
- Best-effort ledger posts from a non-finance-privileged actor must degrade the same way
  `consumeProductionMaterials` already does (12588-12589, 12596-12625: try/catch +
  `console.warn`, stock/flag write still succeeds even if the ledger write is permission-denied)
  — a receiving-time ledger post triggered by a plain Purchasing employee (who has no
  `canFinance()` rights) cannot assume it will succeed and must not fail the receiving action if
  it doesn't.

## Open decisions

- [ ] **Gate mechanism.** Add a new `approvalStatus` (or similar) field + explicit
  approve/reject action on `purchase_requisitions`, or reuse the existing unified Approvals
  queue's `APPROVAL_CAPS` pattern (like `'quote-approval'`/`'raise'`), or reuse the `bs_quotes`/
  `pending_raises` status-cycle pattern directly? All three exist as live precedent today (see
  Current State) — none is wired to Purchasing.
- [ ] **Who approves.** President only (matches `'raise'`/`'finance-del'` precedent) or
  President+Manager (matches `'quote-approval'`/`'ca'` precedent)? Does Corporate Secretary get
  an escalate-only role (matching `'leave'`/`'signup'`), consistent with the secretary
  view-only-oversight constraint above?
- [ ] **Threshold.** Does every PO need approval regardless of amount (matching the
  all-instances gating of `quote-approval`/`raise`), or is there a peso threshold below which
  Purchasing can self-approve routine/low-value restocks? The mandate text names no threshold.
- [ ] **What exactly is gated.** The mandate says "before the President's name prints" —
  narrowest reading gates only the Print PO button/`printPurchaseOrder` call. Should the gate
  also block (or simply not affect) the RFQ→PR conversion step and the "Mark Ordered"/"Mark
  Received" status transitions, which today proceed independently of printing?
- [ ] **Backfill for existing PRs.** Live `purchase_requisitions` docs already in stage `'pr'`
  have no approval field at all. Do they need a one-time grandfather (e.g. auto-mark
  `approved` for anything already `ordered`/`received`), or does the gate apply to newly
  created/converted PRs only?
- [ ] **Printed-document behavior pre-approval.** Should `printPurchaseOrder`'s "Approved by"
  signature line keep showing `window.BRAND.legal.signatory` unconditionally (today's static
  behavior) regardless of approval state, or should the print be blocked entirely until
  approved, or show a "PENDING APPROVAL" watermark/state via `buildLetterhead`'s existing
  `extraMeta`/`signatures` options?
- [ ] **Receiving → ledger linkage mechanism.** Should "Mark Received" auto-post to
  `cash_disbursement_journal`/`ledger` (removing or supplementing the separate manual "Record as
  Disbursement" click), or stay a separate Finance confirmation step that becomes
  mandatory/blocking (e.g. a PR can't be archived/closed until `recordedToFinance` is true)?
  Auto-posting risks posting before the supplier's actual invoiced price is confirmed (PR prices
  are RFQ-quoted, not necessarily final); staying manual risks the current silent gap where
  receipt happens and the books never see it.
- [ ] **Account selection if auto-posting.** If receiving auto-posts, is the debit account
  always `'inventory'` (matching WS13's now-default), or does a per-line choice between
  Inventory-asset vs. direct-to-job COS (skip-stock) still need to survive, since
  `recordPurchaseDisbursement`'s UI today offers that choice once for the whole PR total, not
  per line?
- [ ] **Partial/split receiving.** `receivePurchaseIntoInventory` is all-or-nothing per PR
  today. Does "receiving → stock + ledger correctly" require supporting partial delivery
  (receive 60 of 100 units, ledger-post only that portion)? Not explicitly named in the mandate
  text; overlaps with WS29's broader movement-logging scope.
- [ ] **Receiving Report document.** V12-PLAN.md's per-department documents table (line 244)
  lists "Receiving report" as a Purchasing deliverable alongside "RFQ letter" and "Purchase
  Order" — neither an RFQ print nor a receiving-report print exists in the current code (only
  `printPurchaseOrder`). Is building one in scope for WS30, or deferred?
- [ ] **Legacy `purchase_orders` rules block.** Zero live code references it. Remove it from
  `firestore.rules` as part of this workstream's cleanup, or leave untouched as out of scope?
- [ ] **Unmatched receiving lines.** Items that don't name-match an `inventory_items` doc are
  silently dropped today (toast-only). Should the approval/receiving work also require
  resolving every line to an inventory item (create-or-bind) before a PR can be marked
  `received`? This directly overlaps WS29's stated "item binding at RFQ" goal — needs explicit
  hand-off language so the two workstreams don't both silently fix, or both skip, the same gap.

## Risks / cross-workstream interactions

- WS29 (Inventory correctness, no grounding brief written yet — this is the first Phase-4
  brief) shares the exact same function, `receivePurchaseIntoInventory`, as this mandate's
  receiving half. WS29's stated scope (V12-PLAN.md:185-188) is explicitly the weighted-average
  `unitCost` fix, `stock_movements` logging on receive, and RFQ item-binding — all inside this
  same ~30-line function WS30 also needs to touch for ledger-linkage. Sequence or coordinate so
  one implementation doesn't silently revert the other's fix; whoever writes WS29's brief should
  cross-reference this file and vice versa.
- WS13 (chart of accounts, IMPLEMENTED) already solved the asset-vs-expense classification this
  mandate cites — build on `postCDJToLedger`'s existing `accountType`/`account` logic rather than
  re-deriving it, or the two will drift out of sync over time.
- WS14 (letterhead engine, IMPLEMENTED) already converted `printPurchaseOrder` to
  `window.buildLetterhead` — no adoption work remains. A new "PENDING APPROVAL" watermark or
  conditional signature (open decision above) is a WS30-owned addition to the existing call's
  options, not a WS14 change.
- The unified Approvals queue (departments.js ~10040-10230) runs one `Promise.all` of pending-count
  queries (10084-10097) on every president/manager/secretary page load. Adding a `'po-approval'`
  type means one more query + one more chip; an unfiltered or unindexed query here risks slowing
  that page or showing a wrong badge count, the same class of risk as when `quote-approval`/
  `raise` were added.
- Historical PRs may already be `recordedToFinance` with `debitAccount` values other than
  `'inventory'` (Finance could still pick `'material'`/`'ap'`/`'sundry'` from the dropdown) —
  any receiving-triggered auto-posting must check `recordedToFinance`/`cdjEntryId` first so it
  never double-posts alongside a purchase Finance already recorded manually.
- `receivePurchaseIntoInventory` is invoked with a `.catch(()=>null)` swallow inside the
  `.pr-stat` click handler (13483) — a receiving-time ledger post added inline here must not
  silently vanish on a permission error for a non-finance Purchasing user; it should at minimum
  match `consumeProductionMaterials`'s existing warn-but-don't-fail pattern (12588-12589,
  12596-12625) so a "received" PR never looks fully processed while quietly failing to reach the
  books.
- Corporate Secretary already sits outside every money-moving `APPROVAL_CAPS` entry
  (`ca`/`raise`/`finance-req`/`finance-del`/`delete-quote`/`delete-client`) per the
  corporate-secretary memory — miswiring a new PO-approval type into the wrong tier would
  silently hand the secretary a money-moving power the rest of the system deliberately withholds.

## Files likely touched

`js/departments.js` — `renderPurchaseRequests`/`purchRfqCard`/`bindRfqCard` (~13096-13496, for
gate UI + status/approval fields), `printPurchaseOrder` (~13648-13777, for the approval check
and/or watermark), `receivePurchaseIntoInventory` (~13501-13528) and/or
`recordPurchaseDisbursement`/`postCDJToLedger` (~13547-13642, ~1491-1521, for receive→ledger
linkage), and — only if the unified-queue mechanism is chosen — `APPROVAL_CAPS`
(~10052-10066), the pending-count `Promise.all` (~10084-10097), and the approval chips
(~10126+). `js/config.js` — `window.BRAND.legal.signatory` (~865, read-only unless the print
behavior changes) and any new shared helper (must load before departments.js). `js/app.js` —
`navigateTo` case `'Purchasing'` (~3636), unaffected unless routing changes.
`firestore.rules` — the `purchase_requisitions` block (~881-898, any new field needs a
`.get(field,default)`-guarded update clause), a new collection's own match block if one is
introduced, and optionally the dead `purchase_orders` block (~873-878) if cleanup is in scope.
`scripts/monthly-backup.js` — add any new field/collection to `EXPORTS`. `sw.js` — `CACHE_VER`
bump (mandatory on any JS/CSS edit per CLAUDE.md).

## Expected deliverable format

A numbered build spec Sonnet can execute without further judgment calls: (1) the exact gate
mechanism chosen — new field(s) and their exact names/types/defaults on
`purchase_requisitions`, or the specific existing pattern reused (unified-queue type name +
`APPROVAL_CAPS` entry, or a `bs_quotes`-style status cycle) — stated as a one-line policy per
open decision above; (2) exact function signatures and before/after code for every touched
function (`printPurchaseOrder`'s gate check, the approve/reject handler, the
receiving→ledger-posting change if any), following the before/after code-block convention used
in `25-leave.md`'s Spec sections; (3) the literal `firestore.rules` diff (before/after blocks,
same comment-then-match style as the file already uses) for `purchase_requisitions` and any new
collection; (4) a migration/backfill checklist for existing stage-`'pr'` docs that predate the
gate, in the style of the existing `backfillPayrollLedger`/`LeaveAccrual.runAnnualAccrual`
one-button precedent if a backfill is needed; (5) explicit UI copy/mockup for the new
approve/reject action and any printed-document state change (e.g. a "PENDING APPROVAL"
watermark); (6) an explicit sequencing note on the WS29 overlap in
`receivePurchaseIntoInventory` (which fields/lines each workstream owns) so Sonnet does not
implement one workstream's fix in a way that silently undoes the other's.
