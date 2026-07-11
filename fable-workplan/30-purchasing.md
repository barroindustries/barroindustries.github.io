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

## Open decisions — → all resolved in `## DECIDED` at the end of this file

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

## DECIDED — architecture spec (Fable, 2026-07-11)

> Builds directly on WS29's `## DECIDED` (29-inventory.md), which is already final:
> WS30 inherits `receiveLineIntoItem` (the single per-line receive transaction with
> deterministic `RECV_{prId}_{lineIdx}` movement doc ids), `buildStockMovement`/
> `postStockMovement` in config.js, `items[].itemId`, `receiveUnmatched` + the resolver,
> and the boundary "WS29 = physical side; ledger↔inventory VALUE reconciliation = WS30."
> Nothing below re-decides or touches any of those. **All before/after diffs in this spec
> are written against the post-WS29 code** (Specs 3b/3c of 29-inventory.md), so WS29 must
> be implemented first or in the same session, earlier in the same commit sequence.

### Resolved decisions (one line each)

1. **Gate mechanism → an `approvalStatus` status-cycle ON the `purchase_requisitions` doc
   itself, surfaced in the unified Approvals queue as new type `'po-approval'`.** No new
   collection: the queue queries `purchase_requisitions.where('approvalStatus','==','pending')`
   directly, exactly the leave/raise precedent (leave_requests/pending_raises are queried
   from their own collections, not mirrored into `approval_requests`). One canonical pair
   `window.approvePurchaseOrder(prId)` / `window.rejectPurchaseOrder(prId, reason)` is
   called from BOTH surfaces (Purchasing tab card + Approvals queue) — the WS25
   `applyLeaveApproval` single-source pattern, avoiding the 3-surfaces-disagree bug class.
2. **Who approves → President + Manager (`'po-approval': ['president','manager']`),
   secretary escalate-only.** POs are routine money-moving purchases → the
   `'quote-approval'`/`'ca'` tier, not the president-only `'raise'`/`'finance-del'` tier;
   secretary stays out per the corporate-secretary money-moving exclusion (she gets the
   existing "🙋 Request President approval" escalate button automatically via
   `canEscalate`). Rules enforce with the existing `isSeniorAdmin()` helper (rules ~31).
   ‼️ **FLAG FOR NEIL:** say the word if you want PO approval President-ONLY — one-line
   change in `APPROVAL_CAPS` + swap `isSeniorAdmin()`→`isPresident()` in the rules clause.
3. **Threshold → NONE; every PO is gated regardless of amount.** The mandate names no
   threshold, and a peso threshold invites splitting one purchase into several sub-threshold
   POs to dodge the gate. ‼️ **FLAG FOR NEIL:** if routine low-value restocks make this
   annoying in practice, a client-side `PO_AUTO_APPROVE_LIMIT` can be added later — the
   data model already supports it (auto-set `approvalStatus:'approved',
   approvedByName:'Auto (under limit)'`), but it ships OFF.
4. **What is gated → everything downstream of convert; print is watermark-gated, not
   blocked.** RFQ→PR convert itself stays a Purchasing action but now ENTERS the gate
   (`approvalStatus:'pending'`, notifies approvers). Until approved: Mark Ordered, Mark
   Received, Submit to Finance, and Record as Disbursement are all hidden client-side AND
   denied by rules. Print PO stays available at any pre-approval state BUT renders a
   diagonal "PENDING APPROVAL" watermark, a "(PENDING APPROVAL)" doc title, and a BLANK
   "Approved by" line — the President's name never prints without a recorded approval.
   Rejected POs cannot print at all (toast directs to revert-and-resubmit).
5. **The printed "Approved by" line = the ACTUAL recorded approver, never the static
   signatory.** On approval the doc stores `approvedByName`/`approvedByTitle` (President →
   `BRAND.legal.signatory.title`; Manager → `'Manager'`), and `printPurchaseOrder` prints
   those. `window.BRAND.legal.signatory` remains only as the print line for grandfathered
   pre-gate docs (decision 6) — the config constant itself is untouched.
6. **Backfill → reader-side grandfather, ZERO migration writes.** A stage-`'pr'` doc with
   no `approvalStatus` field is a pre-gate PO: helper `poState(p)` returns `'legacy'`,
   treated as approved everywhere (buttons, print, rules via
   `resource.data.get('approvalStatus','legacy')`). Retro-blocking already-ordered/received
   POs would freeze live operations for zero benefit; new converts always get `'pending'`.
   ‼️ **FLAG FOR NEIL:** every PR converted before ship date is grandfathered as approved —
   including any currently sitting un-ordered. If you want those re-reviewed, mark them
   yourself before ship (no tooling needed; the gate only binds new conversions).
7. **Rejection loop → reject stores a reason; Purchasing's only path forward is
   "↩ Revert to RFQ"** (stage back to `'rfq'`, status `'quoting'`, approval fields
   cleared), then edit prices/items and re-convert, which re-enters `'pending'`. One loop,
   no second "re-request" path to drift. Rules let Purchasing clear approval fields ONLY
   when the same write reverts the doc to stage `'rfq'` (so a rejected PR can't be
   laundered into a grandfathered-approved one by deleting the field while staying `'pr'`).
8. **Receiving → ledger stays Finance's manual "Record as Disbursement" step — NOT
   auto-posted — but the silent gap is closed with enforcement + reconciliation:**
   (a) "Mark Received" now AUTO-submits to Finance (sets `submittedToFinance*` if unset and
   fires `notifyFinanceTeam`) so the books are always pinged the moment stock lands;
   (b) the Finance → Purchases tab shows a "⏳ N received purchase(s) not yet recorded"
   banner, and Purchasing's own list badges received-but-unrecorded rows;
   (c) `recordPurchaseDisbursement` gains a reconciliation line computed from WS29's
   `RECV_{prId}_{i}` movement rows — "Stocked into inventory: ₱X of ₱Y total (N line(s)
   unresolved)" — with a one-click "Use stocked value" prefill and explicit warnings when
   the chosen debit account contradicts what physically happened (booking 'inventory' when
   nothing landed, or 'material' COS when lines DID land in stock). Auto-posting was
   rejected because PR line prices are RFQ quotes, not the supplier's final invoice, and
   because a Purchasing-employee-triggered auto-post would require opening
   `cash_disbursement_journal`/`ledger` create rules to non-finance actors — an expanded
   money-write surface the warn-but-manual design avoids entirely.
   ‼️ **FLAG FOR NEIL:** this keeps a human (Finance) between stock and books, made loud
   instead of silent. Say the word if you'd rather have receive-time auto-posting.
9. **Account selection → unchanged whole-PR choice in `recordPurchaseDisbursement`.** The
   new stocked-value reconciliation line gives Finance the number needed to split a mixed
   PR manually (post two CDJ entries); a per-line inventory/COS split UI is deferred.
10. **Partial receiving → deferred.** WS29's per-line idempotent receive + resolver already
   handles partially-MATCHED receipts; partial-QUANTITY deliveries (60 of 100 units on one
   line) stay out of scope. The deterministic id scheme leaves room for a future
   per-delivery suffix (`RECV_{prId}_{i}_{n}`) without breaking existing rows.
11. **Receiving Report → IN scope** (`printReceivingReport(p)` via `buildLetterhead`,
   V12-PLAN's per-department documents table names it). The RFQ-letter printable is NOT in
   scope (not named in this mandate) — defer.
12. **Legacy `purchase_orders` rules block → REMOVED.** Zero live code references it
   (grep-confirmed in the grounding); deleting it closes a dead canFinance write surface.
13. **VAT-exclusive / landed-cost stock valuation → deferred again (inherited WS29 flag).**
   RFQ lines carry no per-line VAT treatment field; adding one is real data-entry scope.
   The CDJ-level `vatSplit` remains the place input VAT is claimed. ‼️ **FLAG FOR NEIL:**
   stock stays valued at prices exactly as typed on the RFQ (VAT-inclusive if the supplier
   quoted that way). This is now twice-deferred — if you want it, it becomes its own small
   workstream (per-line VAT flag + WAC input change), not a rider on WS30.
14. **WS29/WS30 seam (binding, restated):** WS30 does NOT modify `receivePurchaseIntoInventory`,
   `receiveLineIntoItem`, `openReceiveResolver`, `buildStockMovement`, or any
   `stock_movements` shape — it only READS `RECV_*` rows and `receiveUnmatched` (Spec 6)
   and adds gating AROUND the existing receive trigger (Spec 4). The `inventory_items`
   rules tightening WS29 flagged is NOT pulled into WS30 either — it needs a WS19-style
   enumeration of legitimate writers and stays its own decision.

**Scoping / sequencing:** hard-depends on **WS29** (diffs below are against WS29's
post-state of the `pr-stat` handler; WS29's Spec 3b is the BEFORE here). Touches the same
Approvals-queue region as WS22/23 did (additive: one `APPROVAL_CAPS` entry, one query per
`Promise.all`, one card branch). No dependency on any unshipped workstream otherwise.
Rules deploy required (`firebase deploy --only firestore:rules`, separate from `git push`;
re-`git diff` first per the concurrent-edit memory).

---

### Spec 1 — Data shapes (annotated literals; new fields marked NEW)

```js
// purchase_requisitions/{docId} — approval fields (all NEW). Absent on every
// pre-gate doc: readers and rules default via poState()/.get(field,'legacy').
{ approvalStatus: 'pending'|'approved'|'rejected',
      // set 'pending' at RFQ→PR convert; 'approved'/'rejected' ONLY by president/manager
      // (rules-enforced); cleared (field deleted) on Revert-to-RFQ.
      // ABSENT + stage:'pr'  → 'legacy' (pre-gate, treated as approved)
  approvedBy: '<uid>', approvedByName: 'Neil Barro',
  approvedByTitle: 'President, Barro Industries OPC',   // 'Manager' for a manager approver
  approvedAt: Timestamp,
  rejectedBy: '<uid>', rejectedByName: 'Neil Barro',
  rejectedAt: Timestamp,
  rejectedReason: 'Price too high — requote steel sheets',  // escHtml() on every render
  // Receiving audit (NEW) — stamped by the Mark-Received write; feeds the Receiving Report
  receivedAt: Timestamp, receivedBy: '<uid>', receivedByName: 'J. Cruz' }

// No other collection changes. stock_movements / inventory_items / cash_disbursement_journal
// shapes are exactly WS29's / WS13's — read-only from WS30's perspective.
```

Client-side state helper — file-local in js/departments.js, insert directly above
`PURCH_STAT` (~13303):
```js
// v12 WS30 — PO approval state with legacy grandfather: PRs converted before the
// gate shipped carry no approvalStatus and stay valid ('legacy' ≈ approved).
function poState(p) { return p.approvalStatus || ((p.stage === 'pr') ? 'legacy' : ''); }
function poApproved(p) { const s = poState(p); return s === 'approved' || s === 'legacy'; }
```

### Spec 2 — Canonical approve/reject service + approver notification (js/departments.js)

Insert after `notifyFinanceTeam` (~13542). Window-attached so the Approvals queue (same
file) and any future surface share ONE implementation.

```js
// Notify the people who can approve POs (President + all managers). Deduped by dedupKey.
async function notifyPoApprovers(p) {
  const total = p.total != null ? p.total : purchTotal(p.items);
  const data = {
    title: '🛒 Purchase Order Awaiting Approval',
    body: `${p.prNo || p.rfqNo || 'PO'} — ${p.supplier || 'supplier'} · ₱${fmt(total)} (${p.requestingDept || 'Purchasing'}). Approvals → All Requests.`,
    icon: '🛒', type: 'po_approval', dedupKey: `po-appr-${p.id}`
  };
  const mgrs = await db.collection('users').where('role', '==', 'manager').get().catch(() => ({ docs: [] }));
  await Promise.all(mgrs.docs.map(d => safeNotify(() => Notifs.send(d.id, data))));
  await safeNotify(() => Notifs.sendToOwner(data));
}

// ── v12 WS30: the ONE approve/reject implementation. Both the Purchasing tab
// and the unified Approvals queue call these — never inline the writes again.
window.approvePurchaseOrder = async function(prId) {
  const ref = db.collection('purchase_requisitions').doc(prId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('PO not found');
  const p = { id: snap.id, ...snap.data() };
  if (p.approvalStatus !== 'pending') throw new Error('This PO is not awaiting approval.');
  const role = window.currentRole;
  if (role !== 'president' && role !== 'manager') throw new Error('Only the President or a Manager can approve POs.');
  const title = role === 'president'
    ? ((window.BRAND && window.BRAND.legal.signatory.title) || 'President, Barro Industries OPC')
    : 'Manager';
  await ref.update({
    approvalStatus: 'approved',
    approvedBy: window.currentUser.uid,
    approvedByName: window.userProfile?.displayName || window.currentUser.email,
    approvedByTitle: title,
    approvedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  window.logAudit && window.logAudit('approve', 'purchase_order', prId, { prNo: p.prNo || '', total: p.total || 0 });
  const notifyUid = p.convertedBy || p.createdBy;
  if (notifyUid) await safeNotify(() => Notifs.send(notifyUid, {
    title: '✅ PO Approved',
    body: `${p.prNo || p.rfqNo || 'Your PO'} (${p.supplier || ''}) was approved — you can now print and order.`,
    icon: '✅', type: 'po_approval_result', dedupKey: `po-appr-ok-${prId}`
  }));
  return p;
};
window.rejectPurchaseOrder = async function(prId, reason) {
  const ref = db.collection('purchase_requisitions').doc(prId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('PO not found');
  const p = { id: snap.id, ...snap.data() };
  if (p.approvalStatus !== 'pending') throw new Error('This PO is not awaiting approval.');
  const role = window.currentRole;
  if (role !== 'president' && role !== 'manager') throw new Error('Only the President or a Manager can reject POs.');
  await ref.update({
    approvalStatus: 'rejected',
    rejectedBy: window.currentUser.uid,
    rejectedByName: window.userProfile?.displayName || window.currentUser.email,
    rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
    rejectedReason: (reason || '').trim()
  });
  window.logAudit && window.logAudit('reject', 'purchase_order', prId, { prNo: p.prNo || '', reason: (reason || '').slice(0, 200) });
  const notifyUid = p.convertedBy || p.createdBy;
  if (notifyUid) await safeNotify(() => Notifs.send(notifyUid, {
    title: '❌ PO Rejected',
    body: `${p.prNo || p.rfqNo || 'Your PO'} was rejected${reason ? ': ' + reason : ''}. Revert it to RFQ, adjust, and resubmit.`,
    icon: '❌', type: 'po_approval_result', dedupKey: `po-appr-no-${prId}`
  }));
  return p;
};
```

### Spec 3 — Convert-to-PR enters the gate (js/departments.js:13198-13216, `bindRfqCard`)

```js
// BEFORE (13204-13213)
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const prNo = (r.rfqNo || '').replace(/^RFQ/, 'PR') || ('PR-' + today());
      await db.collection('purchase_requisitions').doc(r.id).update({
        items, total: purchTotal(items), stage: 'pr', status: 'pending', prNo,
        convertedAt: firebase.firestore.FieldValue.serverTimestamp(),
        convertedBy: currentUser.uid,
        convertedByName: window.userProfile?.displayName || currentUser.email
      });
      Notifs.showToast('Converted to Purchase Request ✓');
// AFTER
    const btn = e.currentTarget; btn.disabled = true;
    try {
      const prNo = (r.rfqNo || '').replace(/^RFQ/, 'PR') || ('PR-' + today());
      await db.collection('purchase_requisitions').doc(r.id).update({
        items, total: purchTotal(items), stage: 'pr', status: 'pending', prNo,
        approvalStatus: 'pending',            // v12 WS30 — enters the PO approval gate
        convertedAt: firebase.firestore.FieldValue.serverTimestamp(),
        convertedBy: currentUser.uid,
        convertedByName: window.userProfile?.displayName || currentUser.email
      });
      await notifyPoApprovers({ id: r.id, ...r, items, total: purchTotal(items), prNo })
        .catch(e2 => console.warn('[po notify]', e2));
      Notifs.showToast('Converted to Purchase Request — awaiting President/Manager approval.');
```
(The re-convert after a Revert-to-RFQ flows through this same handler and re-enters
`'pending'` automatically — no extra code.)

### Spec 4 — `renderPurchaseRequests` gate UI (js/departments.js:13327-13496)

**4a. Derived flags** — after `canRecord` (13329):
```js
  const canApprovePO = ['president','manager'].includes(currentRole);   // mirrors APPROVAL_CAPS['po-approval']
```

**4b. Badge column** (card header, after the `PURCH_STAT` badge at ~13386) — add ONE line:
```js
              ${poState(p)==='pending' ? `<span class="badge badge-orange" style="font-size:9px">🔒 Awaiting approval</span>`
                : poState(p)==='rejected' ? `<span class="badge badge-red" style="font-size:9px">✗ Rejected</span>`
                : poState(p)==='approved' ? `<span class="badge badge-green" style="font-size:9px">✓ Approved · ${escHtml(p.approvedByName||'')}</span>` : ''}
              ${p.status==='received' && !p.recordedToFinance ? `<span class="badge badge-orange" style="font-size:9px">⏳ Awaiting Finance record</span>` : ''}
```
and, under the notes line (~13401), the rejection reason when present:
```js
          ${poState(p)==='rejected' && p.rejectedReason ? `<div style="font-size:12px;margin-top:6px;color:var(--danger,#c0392b)">✗ Rejected by ${escHtml(p.rejectedByName||'')}: ${escHtml(p.rejectedReason)}</div>` : ''}
```

**4c. Button row (13403-13412) — BEFORE → AFTER.** Ordered/Received/Submit are gated on
`poApproved(p)`; approve/reject/revert/RR buttons added:
```js
// BEFORE
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap">
            <button class="btn-secondary btn-sm pr-print" data-id="${p.id}">🖨 Print PO</button>
            ${canEdit ? `
              ${p.status !== 'ordered' && p.status !== 'received' ? `<button class="btn-secondary btn-sm pr-stat" data-id="${p.id}" data-stat="ordered">Mark Ordered</button>` : ''}
              ${p.status !== 'received' ? `<button class="btn-primary btn-sm pr-stat" data-id="${p.id}" data-stat="received">Mark Received</button>` : ''}
              ${(p.status === 'ordered' || p.status === 'received') && !p.submittedToFinance ? `<button class="btn-primary btn-sm pr-submit-fin" data-id="${p.id}">📩 Submit to Finance</button>` : ''}
            ` : ''}
            ${canRecord && !p.recordedToFinance ? `<button class="btn-primary btn-sm pr-record" data-id="${p.id}">🧾 Record as Disbursement</button>` : ''}
            ${p.recordedToFinance ? `<span style="font-size:11px;color:var(--success,#1b8a3a);align-self:center">✓ Recorded in journal</span>` : ''}
          </div>
// AFTER
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap">
            ${poState(p) !== 'rejected' ? `<button class="btn-secondary btn-sm pr-print" data-id="${p.id}">🖨 Print PO</button>` : ''}
            ${p.status === 'received' ? `<button class="btn-secondary btn-sm pr-rr" data-id="${p.id}">📦 Receiving Report</button>` : ''}
            ${canApprovePO && poState(p) === 'pending' ? `
              <button class="btn-success btn-sm po-approve" data-id="${p.id}">✓ Approve PO</button>
              <button class="btn-danger btn-sm po-reject" data-id="${p.id}">✗ Reject</button>` : ''}
            ${canEdit && poState(p) === 'rejected' ? `<button class="btn-secondary btn-sm po-revert" data-id="${p.id}">↩ Revert to RFQ</button>` : ''}
            ${canEdit && poApproved(p) ? `
              ${p.status !== 'ordered' && p.status !== 'received' ? `<button class="btn-secondary btn-sm pr-stat" data-id="${p.id}" data-stat="ordered">Mark Ordered</button>` : ''}
              ${p.status !== 'received' ? `<button class="btn-primary btn-sm pr-stat" data-id="${p.id}" data-stat="received">Mark Received</button>` : ''}
              ${(p.status === 'ordered' || p.status === 'received') && !p.submittedToFinance ? `<button class="btn-primary btn-sm pr-submit-fin" data-id="${p.id}">📩 Submit to Finance</button>` : ''}
            ` : ''}
            ${canRecord && !p.recordedToFinance && poApproved(p) ? `<button class="btn-primary btn-sm pr-record" data-id="${p.id}">🧾 Record as Disbursement</button>` : ''}
            ${p.recordedToFinance ? `<span style="font-size:11px;color:var(--success,#1b8a3a);align-self:center">✓ Recorded in journal</span>` : ''}
          </div>
```
(WS29's `pr-resolve` button, if present in this row post-WS29, is untouched.)

**4d. New handlers** — insert next to the `.pr-print` binding (~13420):
```js
  content.querySelectorAll('.po-approve').forEach(btn => btn.addEventListener('click', async () => {
    const p = prs.find(x => x.id === btn.dataset.id); if (!p) return;
    if (!(await confirmDialog({ message: `Approve ${escHtml(p.prNo || '')} — ${escHtml(p.supplier || '')} for ₱${fmt(p.total != null ? p.total : purchTotal(p.items))}? Your name will print on the "Approved by" line.`, html: true }))) return;
    btn.disabled = true;
    try { await window.approvePurchaseOrder(p.id); Notifs.showToast('PO approved ✓'); redo(); }
    catch (err) { Notifs.showToast('Approve failed: ' + (err.message || err), 'error'); btn.disabled = false; }
  }));
  content.querySelectorAll('.po-reject').forEach(btn => btn.addEventListener('click', async () => {
    const p = prs.find(x => x.id === btn.dataset.id); if (!p) return;
    const reason = prompt('Reason for rejection (shown to Purchasing):') ;
    if (reason === null) return;                       // cancelled
    btn.disabled = true;
    try { await window.rejectPurchaseOrder(p.id, reason); Notifs.showToast('PO rejected.'); redo(); }
    catch (err) { Notifs.showToast('Reject failed: ' + (err.message || err), 'error'); btn.disabled = false; }
  }));
  content.querySelectorAll('.po-revert').forEach(btn => btn.addEventListener('click', async () => {
    const p = prs.find(x => x.id === btn.dataset.id); if (!p) return;
    if (!(await confirmDialog({ message: `Revert ${escHtml(p.prNo || '')} to an RFQ to fix and resubmit? The rejection note stays on record until re-converted.`, html: true }))) return;
    btn.disabled = true;
    try {
      const FV = firebase.firestore.FieldValue;
      await db.collection('purchase_requisitions').doc(p.id).update({
        stage: 'rfq', status: 'quoting',
        approvalStatus: FV.delete(), approvedBy: FV.delete(), approvedByName: FV.delete(),
        approvedByTitle: FV.delete(), approvedAt: FV.delete(),
        rejectedBy: FV.delete(), rejectedByName: FV.delete(), rejectedAt: FV.delete(), rejectedReason: FV.delete(),
        updatedAt: FV.serverTimestamp()
      });
      Notifs.showToast('Reverted to RFQ — edit it in the Request for Quotation tab.');
      redo();
    } catch (err) { Notifs.showToast('Revert failed: ' + (err.message || err), 'error'); btn.disabled = false; }
  }));
  content.querySelectorAll('.pr-rr').forEach(btn => btn.addEventListener('click', () => {
    const p = prs.find(x => x.id === btn.dataset.id);
    if (p) printReceivingReport(p);
  }));
```

**4e. `pr-stat` "received" branch — BEFORE = WS29 Spec 3b's AFTER. WS30 layers the
receiving stamp + auto-submit-to-Finance on top:**
```js
// AFTER (WS30 — replaces WS29's version of this branch; deltas marked)
      if (btn.dataset.stat === 'received' && p && !p.receivedToInventory) {
        const res = await receivePurchaseIntoInventory(p).catch(e => { console.warn('[receive→inventory]', e); return null; });
        if (res) {
          await db.collection('purchase_requisitions').doc(p.id).update({
            receivedToInventory: res.unmatched.length === 0,
            receiveUnmatched: res.unmatched,
            receivedAt: firebase.firestore.FieldValue.serverTimestamp(),      // WS30 — RR audit
            receivedBy: currentUser.uid,                                       // WS30
            receivedByName: window.userProfile?.displayName || currentUser.email // WS30
          }).catch(()=>{});
          // WS30 — receiving is never silent to the books: auto-submit to Finance.
          if (!p.submittedToFinance) {
            await db.collection('purchase_requisitions').doc(p.id).update({
              submittedToFinance: true,
              submittedToFinanceAt: firebase.firestore.FieldValue.serverTimestamp(),
              submittedToFinanceBy: currentUser.uid,
              submittedToFinanceByName: window.userProfile?.displayName || currentUser.email
            }).catch(()=>{});
            await notifyFinanceTeam({
              title: '📦 Purchase Received — record it',
              body: `${p.prNo || p.rfqNo || 'A purchase'} — ${p.supplier || 'supplier'} · ₱${fmt(p.total != null ? p.total : purchTotal(p.items))} was received into stock. Record it in Finance → Purchases.`,
              icon: '📦', type: 'purchase_submitted', dedupKey: `pr-fin-${p.id}`
            }).catch(()=>{});
          }
          Notifs.showToast(res.unmatched.length
            ? `Received ${res.matched} line${res.matched===1?'':'s'} into stock — ${res.unmatched.length} not in inventory. Tap “⚠ Resolve” on the PR.`
            : `Received. ${res.matched} item${res.matched===1?'':'s'} added to inventory ✓`);
        } else { Notifs.showToast('Status updated.'); }
      } else {
```
Also add a defensive guard at the very top of the `pr-stat` handler (before the status
update), since rules now deny it anyway:
```js
      const p0 = prs.find(x => x.id === btn.dataset.id);
      if (p0 && !poApproved(p0)) { Notifs.showToast('This PO needs President/Manager approval first.', 'error'); btn.disabled = false; return; }
```

**4f. Finance banner** — in the `content.innerHTML` template, replace the existing
financeView hint paragraph (13369) with:
```js
    ${opts.financeView ? (() => {
      const unrec = prs.filter(x => x.status === 'received' && !x.recordedToFinance).length;
      return `${unrec ? `<div class="alert-banner" style="margin-bottom:10px"><span>⏳ <strong>${unrec} received purchase${unrec>1?'s':''} not yet recorded</strong> — stock has landed but the books haven't. Use Record as Disbursement below.</span></div>` : ''}
      <p style="font-size:12px;color:var(--text-muted);margin:0 0 12px">Purchases raised by the Purchasing department. Use <strong>Record as Disbursement</strong> to post one into the Cash Disbursement Journal.</p>`;
    })() : ''}
```

### Spec 5 — `printPurchaseOrder` gate (js/departments.js:13648-13777)

**5a. Guard + dynamic signature** — replace lines 13654-13655:
```js
// BEFORE
  const preparedBy = p.convertedByName || p.createdByName || '';
  const _sig = (window.BRAND && window.BRAND.legal.signatory) || { name: 'NEIL BARRO', title: 'President, Barro Industries OPC' };
// AFTER
  const state = poState(p);
  if (state === 'rejected') { Notifs.showToast('This PO was rejected — revert it to RFQ and resubmit before printing.', 'error'); return; }
  const isPending = state === 'pending';
  const preparedBy = p.convertedByName || p.createdByName || '';
  const _sig = (window.BRAND && window.BRAND.legal.signatory) || { name: 'NEIL BARRO', title: 'President, Barro Industries OPC' };
  // v12 WS30 — the "Approved by" line is the RECORDED approver. Pre-gate ('legacy')
  // docs keep the historic static line; pending docs print a BLANK line + watermark.
  const approvedSig = state === 'approved'
    ? { label: 'Approved by', name: p.approvedByName || '', title: p.approvedByTitle || '' }
    : state === 'legacy'
      ? { label: 'Approved by', name: _sig.name, title: _sig.title }
      : { label: 'Approved by', name: '', title: 'PENDING — not yet approved' };
```
**5b. `buildLetterhead` call (13656-13666):** `docTitle: isPending ? 'PURCHASE ORDER (PENDING APPROVAL)' : 'PURCHASE ORDER'`;
`extraMeta: [...(p.neededBy ? ['Needed by: ' + p.neededBy] : []), ...(isPending ? ['⚠ NOT VALID — awaiting management approval'] : [])]`;
signatures second slot becomes `approvedSig` (first slot unchanged).
**5c. Watermark CSS + node** — append to the `<style>` block (after line 13716):
```css
  .wm{position:fixed;top:45%;left:0;right:0;text-align:center;transform:rotate(-24deg);
      font-size:64px;font-weight:900;letter-spacing:6px;color:rgba(192,57,43,.13);
      z-index:5;pointer-events:none}
  @media print{.wm{color:rgba(192,57,43,.16)!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
```
and inside `<div class="page">` as its first child: `${isPending ? '<div class="wm">PENDING APPROVAL</div>' : ''}`.
**5d. Hand-rolled fallback branch (13765-13770)** must mirror: replace `${e(_sig.name)}…${e(_sig.title)}` with `${e(approvedSig.name)}…${e(approvedSig.title)}`, and the fallback header title (13734) with `Purchase Order${isPending ? ' (PENDING APPROVAL)' : ''}`.

### Spec 6 — Finance recording reconciliation (`recordPurchaseDisbursement`, 13547-13642)

**6a.** Make the function `async` and compute the stocked value from WS29's receive
movements before building the modal (insert after `const ref = …` at 13549):
```js
  // v12 WS30 — reconcile the PR's paper total against what PHYSICALLY landed in
  // stock (WS29's RECV_{prId}_{i} movement rows; resolver receipts included).
  let stockedValue = null, unresolved = (p.receiveUnmatched || []).length;
  try {
    const mv = await db.collection('stock_movements')
      .where('source', '==', 'receive')
      .where('refNumber', '==', p.prNo || p.rfqNo || p.id).get();
    if (!mv.empty) stockedValue = mv.docs.reduce((s, d) => {
      const m = d.data(); return s + (Number(m.qty) || 0) * (Number(m.unitCost) || 0);
    }, 0);
  } catch (_) { /* movements unreadable — reconciliation line simply hidden */ }
```
(Two equality `where`s — no composite index needed.)
**6b.** In the modal HTML, directly under the Amount/Debit-Account form-row (after 13565):
```js
    ${stockedValue != null ? `<div class="alert-banner" style="cursor:default;margin-bottom:8px;font-size:12px"><span>
      📦 Stocked into inventory: <strong>₱${fmt(stockedValue)}</strong> of ₱${fmt(total)} PR total${unresolved ? ` · <strong>${unresolved} line${unresolved>1?'s':''} unresolved</strong> (Purchasing must resolve them)` : ''}.
      <button class="btn-secondary btn-sm" id="rec-use-stocked" style="margin-left:6px">Use stocked value</button>
      <span id="rec-acct-warn" style="display:block;color:var(--danger,#c0392b)"></span></span></div>` : ''}
```
**6c.** Wiring (next to the existing `acctSel` listener, 13576-13579):
```js
  document.getElementById('rec-use-stocked')?.addEventListener('click', () => {
    document.getElementById('rec-amt').value = stockedValue; recVatPreview(); acctWarn();
  });
  const acctWarn = () => {
    const w = document.getElementById('rec-acct-warn'); if (!w || stockedValue == null) return;
    const amt = parseFloat(document.getElementById('rec-amt').value) || 0;
    if (acctSel.value === 'inventory' && stockedValue <= 0)
      w.textContent = '⚠ Nothing from this PR landed in stock — booking it as an Inventory asset will overstate inventory.';
    else if (acctSel.value === 'material' && stockedValue > 0)
      w.textContent = `⚠ ₱${fmt(stockedValue)} of this PR WAS stocked — COS (skips stock) will double-count it when consumed.`;
    else if (acctSel.value === 'inventory' && Math.abs(amt - stockedValue) > 0.5)
      w.textContent = `ℹ Amount differs from the stocked value (₱${fmt(stockedValue)}) — post the difference to a second, correctly-classified entry.`;
    else w.textContent = '';
  };
  acctSel.addEventListener('change', acctWarn);
  document.getElementById('rec-amt').addEventListener('input', acctWarn);
  acctWarn();
```
Warnings only — Finance keeps final judgment (decision 8/9). `postCDJToLedger` is untouched.
Caller change: `recordPurchaseDisbursement(p, currentUser, redo)` call site (13470) is
unchanged (fire-and-forget tolerates async).

### Spec 7 — Receiving Report printable (js/departments.js, insert after `printPurchaseOrder`)

```js
// ── Printable Receiving Report (v12 WS30) — evidence trail for Finance ─────
// Per line: received-into-stock vs unresolved (from WS29's receiveUnmatched).
function printReceivingReport(p) {
  const e = s => escHtml(s == null ? '' : String(s));
  const items = p.items || [];
  const unres = new Set((p.receiveUnmatched || []).map(u => u.i));
  const rcvd = p.receivedAt && p.receivedAt.toDate ? p.receivedAt.toDate() : new Date();
  const _lh = window.buildLetterhead ? window.buildLetterhead({
    docTitle: 'RECEIVING REPORT',
    docNumber: (p.prNo || p.rfqNo || '').replace(/^PR/, 'RR') || ('RR-' + today()),
    dateLabel: 'Received: ' + rcvd.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }),
    extraMeta: ['PO ref: ' + (p.prNo || p.rfqNo || ''), 'Supplier: ' + (p.supplier || '—')],
    signatures: [
      { label: 'Received by', name: p.receivedByName || '', title: 'Purchasing / Warehouse' },
      { label: 'Verified by', name: '', title: 'Finance' }
    ],
    footerNote: ((window.BRAND && window.BRAND.fullName) || 'Barro Industries Operating System') + ' · Generated ' + new Date().toLocaleString('en-PH')
  }) : null;
  const rows = items.map((it, i) => `<tr>
      <td class="c">${i + 1}</td><td>${e(it.desc || '—')}</td>
      <td class="c">${Number(it.qty || 0).toLocaleString('en-PH')}</td><td class="c">${e(it.unit || '')}</td>
      <td class="c">${unres.has(i) ? '⚠ Unresolved — not in stock' : '✓ Received into stock'}</td>
    </tr>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Receiving Report — ${e(p.prNo || '')}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000;background:#e8e8e8}
.page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:14mm}
table{width:100%;border-collapse:collapse;margin:12px 0}th,td{border:1px solid #444;padding:5px 7px;font-size:11px}
th{background:#1E3A5F;color:#fff;font-size:9px;text-transform:uppercase}td.c{text-align:center}
.bar{position:fixed;top:0;left:0;right:0;background:#1E3A5F;color:#fff;padding:9px 18px;display:flex;gap:10px;align-items:center;z-index:99}
.bar button{background:#fff;color:#1E3A5F;border:none;padding:6px 15px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer}
@page{size:A4 portrait;margin:9mm}@media print{.bar,.barpad{display:none!important}body{background:#fff}.page{padding:0;width:auto;min-height:0}}
${_lh ? _lh.printCSS : ''}</style></head><body>
<div class="bar"><span style="font-weight:700">📦 Receiving Report — ${e(p.prNo || '')}</span>
<button onclick="window.print()">🖨 Print / Save as PDF</button>
<button onclick="window.close()" style="margin-left:auto;background:rgba(255,255,255,.15);color:#fff">✕ Close</button></div>
<div class="barpad" style="height:46px"></div>
<div class="page">${_lh ? _lh.headerHTML : ''}
<table><thead><tr><th style="width:32px">#</th><th>Item / Description</th><th style="width:60px">Qty</th><th style="width:64px">Unit</th><th style="width:170px">Stock Status</th></tr></thead>
<tbody>${rows}</tbody></table>
${p.notes ? `<div style="font-size:10px;color:#444;margin-bottom:10px"><b>Notes:</b> ${e(p.notes)}</div>` : ''}
${_lh ? _lh.footerHTML : ''}</div></body></html>`;
  const win = window.open('', '_blank', 'width=900,height=720');
  if (!win) { Notifs.showToast('Allow pop-ups to open the Receiving Report', 'error'); return; }
  win.document.write(html); win.document.close();
}
```

### Spec 8 — Unified Approvals queue integration (js/departments.js ~10052-10265)

**8a. `APPROVAL_CAPS` (10052-10066)** — add one entry after `'quote-approval'`:
```js
    'po-approval':    ['president','manager'], // v12 WS30 — PO gate; money-moving → secretary escalates
```
**8b. Badge-count `Promise.all` (10084-10097)** — append one query + destructured name `poSnap`:
```js
    db.collection('purchase_requisitions').where('approvalStatus','==','pending').get().catch(()=>({size:0,docs:[]}))
```
then `const pendingPO = poSnap.size || 0;` and add `+ pendingPO` to `totalPending` (10107).
(Single equality filter — no composite index. Only stage-`'pr'` docs ever carry the field.)
No new chip — PO approvals surface in "All Requests", the `'raise'` precedent.
**8c. 'all' loader `Promise.all` (10164-10178)** — append the same query (`poSnap2`), and in
`allPending` (after the raise mapping, 10200):
```js
        // v12 WS30 — POs awaiting the approval gate.
        ...poSnap2.docs.map(d=>{const x=d.data();return {id:d.id,...x,type:'po-approval',icon:'🛒',label:'PO Approval',name:`${x.prNo||x.rfqNo||'PO'} — ${x.supplier||'supplier'}`,detail:`${x.requestingDept||'Purchasing'} · ₱${fmt(x.total||0)}${x.title?' — '+x.title:''} · by ${x.convertedByName||x.createdByName||'?'}`,ts:x.convertedAt||x.createdAt};})
```
**8d. Card action branch** — insert before the `:item.type==='leave'?` branch (~10257):
```js
              `:item.type==='po-approval'?`
                <button class="btn-primary btn-sm po-view-btn" data-id="${item.id}">👁 View PO</button>
                <button class="btn-success btn-sm po-approve-btn" data-id="${item.id}" data-no="${escHtml(item.prNo||'')}">✓ Approve</button>
                <button class="btn-danger btn-sm po-reject-btn" data-id="${item.id}" data-no="${escHtml(item.prNo||'')}">✗ Reject</button>
```
**8e. Handlers** — insert next to the raise handlers (~10328):
```js
      // PO approvals (v12 WS30) — same canonical service the Purchasing tab uses.
      wrap.querySelectorAll('.po-view-btn').forEach(btn => onClickSafe(btn, async () => {
          const s = await db.collection('purchase_requisitions').doc(btn.dataset.id).get();
          if (s.exists) printPurchaseOrder({ id: s.id, ...s.data() });   // pending → watermarked preview
      }));
      wrap.querySelectorAll('.po-approve-btn').forEach(btn => onClickSafe(btn, async () => {
          if (!(await confirmDialog({ message: `Approve PO ${escHtml(btn.dataset.no)}? Your name will print on the "Approved by" line.`, html: true }))) return;
          await window.approvePurchaseOrder(btn.dataset.id);
          Notifs.showToast('PO approved ✓');
          loadApprovalsSub('all');
      }));
      wrap.querySelectorAll('.po-reject-btn').forEach(btn => onClickSafe(btn, async () => {
          const reason = prompt('Reason for rejection (shown to Purchasing):');
          if (reason === null) return;
          await window.rejectPurchaseOrder(btn.dataset.id, reason);
          Notifs.showToast('PO rejected.');
          loadApprovalsSub('all');
      }));
```
Secretary sees the existing escalate button automatically (`canEscalate('po-approval')` is
true; the `esc-btn` path needs zero changes).

### Spec 9 — firestore.rules diff (deploy separately: `~/.npm-global/bin/firebase deploy --only firestore:rules`)

**9a. DELETE the dead legacy block (873-878)** — including its comment:
```
    // Purchase orders (legacy Finance → Purchasing tab). Finance dept members
    // maintain; only the President deletes (via the approval flow).
    match /purchase_orders/{docId} {
      allow read: if isAuth() && canFinance();
      allow create, update: if isAuth() && canFinance();
      allow delete: if isAuth() && isPresident();
    }
```
(Zero live readers/writers, grep-confirmed in the grounding. Any doc data in the
collection stays untouched — only the access rule is removed, so reads now deny.)

**9b. `purchase_requisitions` (881-898) — BEFORE is quoted verbatim in the grounding. AFTER:**
```
    // Purchase requisitions — the Purchasing department's RFQ → Purchase Request
    // flow (stage: 'rfq' | 'pr'). Purchasing dept maintains them; Finance gets
    // read access to see committed purchases. Draft RFQs are freely deletable by
    // Purchasing; once converted to a PR, only the President may delete.
    // v12 WS30 — PO approval gate: converting sets approvalStatus:'pending';
    // ONLY president/manager may set 'approved'/'rejected'; Purchasing can never
    // self-approve, and can't mark a PO ordered/received until it is approved.
    // Docs converted BEFORE the gate have no approvalStatus at all and are
    // grandfathered — .get(field,'legacy') per the missing-field-throws memory.
    match /purchase_requisitions/{docId} {
      allow read: if isAuth() && (canPurchasing() || canFinance());
      allow create: if isAuth() && canPurchasing();
      allow update: if isAuth() && (
        // (a) Purchasing edits freely EXCEPT the approval verdict: approval
        //     fields are writable here only when the result is 'pending'
        //     (convert / re-convert) or cleared by a revert back to stage 'rfq'
        //     — so a rejected PR can't be laundered into a grandfathered one.
        //     Marking ordered/received requires an approved (or pre-gate) PO.
        (canPurchasing()
          && (!request.resource.data.diff(resource.data).affectedKeys().hasAny(
                ['approvalStatus','approvedBy','approvedByName','approvedByTitle','approvedAt',
                 'rejectedBy','rejectedByName','rejectedAt','rejectedReason'])
              || request.resource.data.get('approvalStatus','') == 'pending'
              || (request.resource.data.get('approvalStatus','') == ''
                  && request.resource.data.get('stage','pr') == 'rfq'))
          && (!(request.resource.data.get('status','') in ['ordered','received'])
              || resource.data.get('approvalStatus','legacy') in ['approved','legacy']))
        // (b) President/Manager render the verdict — and may touch NOTHING else
        //     in the same write (can't rewrite items/prices under cover of approving).
        || (isSeniorAdmin() && request.resource.data.diff(resource.data).affectedKeys().hasOnly(
              ['approvalStatus','approvedBy','approvedByName','approvedByTitle','approvedAt',
               'rejectedBy','rejectedByName','rejectedAt','rejectedReason','updatedAt']))
        // (c) Finance may ONLY stamp the bookkeeping fields (unchanged from pre-WS30).
        || (canFinance() && request.resource.data.diff(resource.data).affectedKeys()
              .hasOnly(['recordedToFinance','recordedToFinanceAt','recordedBy','recordedByName','cdjEntryId']))
      );
      allow delete: if isAuth() && (isPresident()
        || (canPurchasing() && resource.data.get('stage', 'rfq') == 'rfq'));
    }
```
Verification notes for the implementer: `isSeniorAdmin()` already exists (rules ~31,
president+manager). Clause (a)'s status guard reads the POST-write doc's `status` — writes
that don't touch status on an already-received approved/legacy doc (e.g. WS29's
`receivedToInventory`/`receiveUnmatched`, WS30's `receivedAt/By/ByName` and
auto-`submittedToFinance*`) pass because `resource.data.get('approvalStatus','legacy')` is
`'approved'` or `'legacy'` on any doc that ever legally reached 'received'. A president is
also `canPurchasing()` (isAdmin ⊂), but clause (a) still blocks him from marking a PENDING
PO ordered/received — he must approve first (clause b), then act: deliberate, keeps the
audit trail honest. Known accepted looseness: Purchasing could write stray `approvedByName`
text while `approvalStatus` is `'pending'` — harmless, since every reader and the print
path key off `approvalStatus` alone.

### Spec 10 — Migration / rollout checklist (ordered)

1. **Land after WS29** (same session is fine, WS29 commits first) — Spec 4e's diff is
   written against WS29's version of the `pr-stat` handler.
2. **Deploy rules first** (Spec 9, both edits) via `--only firestore:rules`; re-`git diff`
   firestore.rules against live before deploying (concurrent-session memory). Old clients
   keep working: they never write approval fields, and every legacy PR passes the
   `.get('approvalStatus','legacy')` clauses.
3. **Ship all JS in one commit:** departments.js (Specs 1-8). No config.js/app.js/modules.js
   edits, no new file → no index.html/PRECACHE change. `node --check js/departments.js`.
   CACHE_VER/APP_VERSION auto-bump via the pre-commit hook — do not hand-edit.
4. **No data migration.** Grandfathering is reader/rules-side (decision 6). In-flight
   stage-`'rfq'` docs convert into the gate naturally on their next convert.
5. **Backup coverage:** `purchase_requisitions` is NOT in `scripts/monthly-backup.js`'s
   EXPORTS (grep-confirmed 2026-07-11) — add it (dateField `createdAt` or full-snapshot,
   matching neighbors) in the same commit. Confirm `stock_movements` landed there via WS29's
   own checklist item.
6. **Post-deploy smoke (console):** as a Purchasing-dept employee run
   `db.collection('purchase_requisitions').doc('<pending PR>').update({approvalStatus:'approved'})`
   → must DENY; `update({status:'received'})` on the same pending PR → must DENY.
7. **Tell approvers:** President + managers now get a 🛒 notification per converted PO and
   act from Approvals → All Requests (or the Purchasing tab card).

### Spec 11 — Manual test checklist (no automated suite)

1. **The headline bug is dead:** create RFQ → price → convert as a plain Purchasing
   employee → card shows "🔒 Awaiting approval"; Print PO opens with the diagonal PENDING
   APPROVAL watermark, "(PENDING APPROVAL)" title, and a BLANK Approved-by line — the
   President's name appears NOWHERE on the document.
2. **No end-run:** same employee sees no Mark Ordered / Mark Received / Submit to Finance
   buttons; console-forcing `status:'received'` or `approvalStatus:'approved'` is
   rules-DENIED (checklist 10.6).
3. **Approve from the queue:** as President, Approvals → All Requests shows "🛒 PO Approval
   — PR-… — supplier · ₱total"; 👁 View PO opens the watermarked preview; ✓ Approve →
   Purchasing gets the ✅ notification; the card flips to "✓ Approved · <name>"; Print PO
   now has NO watermark and "Approved by: <actual approver name> — President, Barro
   Industries OPC".
4. **Approve from the card:** as a Manager, approve directly on the Purchasing tab →
   printed title reads "<manager name> — Manager" (never the static signatory).
5. **Secretary:** sees the PO item with only "🙋 Request President approval"; no
   approve/reject buttons anywhere.
6. **Reject loop:** reject with a reason → card shows "✗ Rejected" + reason; Print PO is
   blocked (toast); ↩ Revert to RFQ → doc back in the RFQ tab, edit price, re-convert →
   re-enters 'pending' with a fresh approver notification.
7. **Legacy grandfather:** a pre-ship PR (no approvalStatus) still shows Mark
   Ordered/Received, prints with the historic static "Approved by" line, and never appears
   in the Approvals queue.
8. **Receive → Finance is never silent:** approve → Mark Received on a PO NOT yet submitted
   to Finance → `submittedToFinance` auto-set, Finance gets the 📦 notification,
   `receivedAt/By/ByName` stamped; Finance → Purchases shows the "⏳ N received … not yet
   recorded" banner until recorded.
9. **Reconciliation math:** PR with 2 lines (one matched, one unresolved via WS29's
   resolver path left unresolved) → Record as Disbursement shows "Stocked: ₱X of ₱Y (1 line
   unresolved)" where X = the matched line's qty×price exactly; "Use stocked value" fills
   the amount; picking "COS – Direct Material" shows the double-count warning; picking
   "Inventory" with amount ≠ stocked shows the split hint. Post with 'inventory' →
   `postCDJToLedger` behavior unchanged (one asset-tagged row, WS13 intact).
10. **Zero-stocked warning:** PR whose every line is unresolved → banner shows "Stocked:
   ₱0.00", and choosing Inventory shows the overstate warning.
11. **Receiving Report:** on a received PR, 📦 Receiving Report prints letterheaded doc —
   matched lines "✓ Received into stock", unresolved "⚠ Unresolved", "Received by" =
   the stamper's name, blank "Verified by — Finance" line.
12. **Queue hygiene:** approving/rejecting removes the item from All Requests and the
   pending badge count; no console errors from the two added queries; `raise` and all
   pre-existing approval types behave unchanged.

### Flags for Neil (consolidated)

- ‼️ **Approver set = President + Manager** (decision 2). Managers can approve POs, matching
  quote approvals and CAs. Want President-only? One line in `APPROVAL_CAPS` + swap
  `isSeniorAdmin()` → `isPresident()` in rules clause (b).
- ‼️ **No peso threshold** (decision 3) — every PO needs approval, even small restocks.
  A self-approve limit is a small later add if this gets annoying.
- ‼️ **Receiving→ledger stays a manual Finance step** (decision 8), now loud (auto-submit,
  banner, reconciliation warnings) instead of silent. Auto-posting was deliberately
  rejected; say the word to revisit.
- ‼️ **All pre-gate PRs are grandfathered as approved** (decision 6) — review any still-open
  ones yourself before ship if you want them re-checked.
- ‼️ **VAT-inclusive stock valuation persists** (decision 13, second deferral) — becomes its
  own mini-workstream if you want VAT-exclusive/landed-cost WAC.

## RE-GROUNDED (Fable, 2026-07-11)

Verified this spec against the REAL WS29 implementation (commit 4446ab8, live in
js/config.js + js/departments.js at HEAD 1beb814) — not the WS29 plan it was written from.
Checked: `window.buildStockMovement`/`window.postStockMovement` (config.js:408/424),
`receivePurchaseIntoInventory` (departments.js:15099), `receiveLineIntoItem` (15132),
`openReceiveResolver` (15171), the live `pr-stat` handler, `bindRfqCard`'s convert handler,
`renderPurchaseRequests`, `printPurchaseOrder`, `recordPurchaseDisbursement`,
`APPROVAL_CAPS`/the Approvals queue, both firestore.rules blocks, and
scripts/monthly-backup.js.

**WS29's implemented surface matches this spec's assumptions exactly — no drift there:**
`receiveLineIntoItem(p, it, lineIdx, itemRef)` signature; deterministic movement id
`RECV_${p.id}_${lineIdx}`; movement rows written with `source:'receive'`,
`refNumber: p.prNo || p.rfqNo || p.id`, `qty`, `unitCost` (null when the line had no
positive price — Spec 6a's `||0` reducer already handles it), `qtyAfter`;
`receivePurchaseIntoInventory` returns `{ matched, unmatched }` with
`unmatched: [{ i, desc, qty, unit, unitPrice }]` (so `u.i` in Spec 7 is correct);
`items[].itemId` from the RFQ picker; Spec 4e's BEFORE block is verbatim-identical to the
live `pr-stat` received branch (15067-15078); Spec 3's and Spec 5a's BEFORE blocks are
verbatim-identical to live code (14769-14778, 15351-15352); both quoted firestore.rules
blocks are verbatim-identical to live (now at lines 978-985 and 987-1003);
`isSeniorAdmin()` exists (rules:30, president+manager). Also confirmed present:
`safeNotify`, `onClickSafe`, `confirmDialog`, `window.logAudit` (config.js:561),
`window.currentUser`, `recVatPreview`, `redo` (15028), and hoisted file-local access to
`printPurchaseOrder`/`purchTotal` from the Approvals region.

### Spec corrections

**C1 — Spec 4c's BEFORE block is stale: it omits WS29's `pr-resolve` button.** The live
button row (departments.js 14987-14997) contains one extra line inside the `canEdit`
block that the spec's BEFORE does not show. Use this as the true BEFORE, and this
corrected AFTER (identical to Spec 4c's AFTER except the `pr-resolve` line is preserved,
in the same position, inside the new `canEdit && poApproved(p)` block — a doc can only
carry `receiveUnmatched` if it was legally received, i.e. approved or legacy, so gating it
there changes nothing reachable):

```js
// TRUE BEFORE (live 14987-14997)
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap">
            <button class="btn-secondary btn-sm pr-print" data-id="${p.id}">🖨 Print PO</button>
            ${canEdit ? `
              ${p.status !== 'ordered' && p.status !== 'received' ? `<button class="btn-secondary btn-sm pr-stat" data-id="${p.id}" data-stat="ordered">Mark Ordered</button>` : ''}
              ${p.status !== 'received' ? `<button class="btn-primary btn-sm pr-stat" data-id="${p.id}" data-stat="received">Mark Received</button>` : ''}
              ${(p.receiveUnmatched||[]).length ? `<button class="btn-secondary btn-sm pr-resolve" data-id="${p.id}">⚠ Resolve ${p.receiveUnmatched.length} unmatched</button>` : ''}
              ${(p.status === 'ordered' || p.status === 'received') && !p.submittedToFinance ? `<button class="btn-primary btn-sm pr-submit-fin" data-id="${p.id}">📩 Submit to Finance</button>` : ''}
            ` : ''}
            ${canRecord && !p.recordedToFinance ? `<button class="btn-primary btn-sm pr-record" data-id="${p.id}">🧾 Record as Disbursement</button>` : ''}
            ${p.recordedToFinance ? `<span style="font-size:11px;color:var(--success,#1b8a3a);align-self:center">✓ Recorded in journal</span>` : ''}
          </div>
// CORRECTED AFTER
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap">
            ${poState(p) !== 'rejected' ? `<button class="btn-secondary btn-sm pr-print" data-id="${p.id}">🖨 Print PO</button>` : ''}
            ${p.status === 'received' ? `<button class="btn-secondary btn-sm pr-rr" data-id="${p.id}">📦 Receiving Report</button>` : ''}
            ${canApprovePO && poState(p) === 'pending' ? `
              <button class="btn-success btn-sm po-approve" data-id="${p.id}">✓ Approve PO</button>
              <button class="btn-danger btn-sm po-reject" data-id="${p.id}">✗ Reject</button>` : ''}
            ${canEdit && poState(p) === 'rejected' ? `<button class="btn-secondary btn-sm po-revert" data-id="${p.id}">↩ Revert to RFQ</button>` : ''}
            ${canEdit && poApproved(p) ? `
              ${p.status !== 'ordered' && p.status !== 'received' ? `<button class="btn-secondary btn-sm pr-stat" data-id="${p.id}" data-stat="ordered">Mark Ordered</button>` : ''}
              ${p.status !== 'received' ? `<button class="btn-primary btn-sm pr-stat" data-id="${p.id}" data-stat="received">Mark Received</button>` : ''}
              ${(p.receiveUnmatched||[]).length ? `<button class="btn-secondary btn-sm pr-resolve" data-id="${p.id}">⚠ Resolve ${p.receiveUnmatched.length} unmatched</button>` : ''}
              ${(p.status === 'ordered' || p.status === 'received') && !p.submittedToFinance ? `<button class="btn-primary btn-sm pr-submit-fin" data-id="${p.id}">📩 Submit to Finance</button>` : ''}
            ` : ''}
            ${canRecord && !p.recordedToFinance && poApproved(p) ? `<button class="btn-primary btn-sm pr-record" data-id="${p.id}">🧾 Record as Disbursement</button>` : ''}
            ${p.recordedToFinance ? `<span style="font-size:11px;color:var(--success,#1b8a3a);align-self:center">✓ Recorded in journal</span>` : ''}
          </div>
```

**C2 — Spec 10 checklist item 5 (backup EXPORTS) is wrong: make it a no-op.**
`scripts/monthly-backup.js` has NO `EXPORTS` list. It auto-discovers every root collection
via `db.listCollections()` and exports a complete JSON snapshot; the `OVERRIDES` map
(~line 118) exists only for date-filter/CSV specials, and `EXCLUDE` (~167) skips only
`presence`/`sessions`/`notifications`. `purchase_requisitions` and `stock_movements` are
therefore ALREADY backed up automatically. Replace checklist item 10.5 with: "No
backup-script change needed — do not edit scripts/monthly-backup.js."

**C3 — Spec 6a's "Make the function `async`" is already true.** Live
`recordPurchaseDisbursement` (15236) is declared `async` (it awaits
`window.BankAccounts.optionsHTML()`). Skip that step; just insert the stocked-value block
after `const ref = p.prNo || p.rfqNo || '';` (15238). Everything else in Spec 6 anchors
correctly (`#rec-amt` 15248, `acctSel` 15269, `recVatPreview` 15273).

**C4 — Every line number in the DECIDED spec has drifted (departments.js grew ~1.6k lines
since the spec was written). Anchor by function name / exact code snippet, never by the
spec's line numbers.** Current map (HEAD 1beb814), js/departments.js:
`purchTotal` 14626 · `bindRfqCard` convert handler 14763-14781 · `PURCH_STAT` 14887
(insert `poState`/`poApproved` directly above it) · `renderPurchaseRequests` 14911
(`canRecord` 14913 — Spec 4a goes after it; financeView hint `<p>` 14953 — Spec 4f
replaces it; badge column 14969-14972 — Spec 4b's badges go after the `${st.label}` span
at 14970, KEEP the existing `🧾 Sent to Finance` badge line at 14971; notes line 14985;
button row 14987-14997 = C1; `.pr-print` binding 15002; `const redo` 15028 — insert Spec
4d's handlers AFTER this line; `pr-stat` handler 15058-15084, received branch 15067-15078)
· `receivePurchaseIntoInventory` 15099 · `receiveLineIntoItem` 15132 ·
`openReceiveResolver` 15171 · `notifyFinanceTeam` 15221 (Spec 2 inserts after it, ~15231)
· `recordPurchaseDisbursement` 15236 · `printPurchaseOrder` 15345 (sig lines 15351-15352;
`buildLetterhead` call 15353-15363; `<style>` closes at 15415 — Spec 5c CSS goes before
`${_lh ? _lh.printCSS : ''}` at 15414; `<div class="page">` 15422; fallback header title
15431; fallback sign block 15464-15465 for Spec 5d).
Approvals queue: `APPROVAL_CAPS` 10673-10687 (`'quote-approval'` at 10682 — Spec 8a entry
goes after it) · badge-count `Promise.all` 10705-10718 with `totalPending` 10728 (Spec 8b)
· 'all' loader `Promise.all` 10785-10799 (append after the `pending_raises` query; Spec
8c's mapping goes after the raise mapping at 10821) · card branch: insert Spec 8d before
`:item.type==='leave'?` at 10878 · Spec 8e handlers next to `.rz-approve-btn` at 10949.
firestore.rules: legacy `purchase_orders` block 978-985 (Spec 9a deletes it, including its
2-line comment) · `purchase_requisitions` block 987-1003 (Spec 9b replaces it) ·
`isSeniorAdmin()` rules:30.

No other corrections — all remaining Spec 1-11 content stands as written.
