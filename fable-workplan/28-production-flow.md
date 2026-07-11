# Workstream 28 — Production process flow (stage rename, worker assignment, QC, delivery receipt)

*Grounding brief + **DECIDED architecture spec** (Fable, 2026-07-10). Every open decision
is resolved in the `## DECIDED` section below (which replaces the former Open-decisions
checklist). Current state / Data model / Constraints are kept beneath the title as
implementation context. Extra facts verified on decision day, beyond the brief:
`canProduction()` already exists in firestore.rules (~line 65-70, `isAdmin() ||
isProductionDept()`); `worker_profiles` READ is `isFinanceOrAdmin()` only (rules:925-929) —
a Production-dept staffer CANNOT read it, which forces the roster-projection decision in
D3; WS14's letterhead engine exposes `window.buildLetterhead(opts)` (letterhead.js:22) and
`window.nextSerial(counterKey, prefix)` (letterhead.js:113-122, `PREFIX-YYYY-000001` via a
`_counters` transaction) but `_counters` write is `isFinanceOrAdmin()` (rules:154-157);
CACHE_VER is now `bi-ops-v174` (concurrent session bumped it past the v173 cited below).*

## Current state

Plan text (V12-PLAN.md:181-184, under "### PHASE 4 — Operations & departments"): "Production
process flow — stages renamed to owner's flow: Layouting → Bending & Cutting → Assembly →
Finishing & Polishing → Quality Checking → Out for Delivery (legacy stage mapping so existing
orders don't strand); per-stage worker assignment + timestamps (stageHistory); delivery step
requires delivery receipt; QC checklist." This is Phase 4's first workstream — no Fable spec
has been written for 28-40 yet (per 27-ids.md's own build-log note: "Phase 4 (workstreams
28-40) has no Fable specs yet"). The per-department printables table (V12-PLAN.md:237-249)
separately lists, for Production, "Work Order traveler · QC Inspection report · Delivery
checklist · Gate pass" and, for Sales, "Delivery Receipt" — none of these four Production
documents nor the Sales "Delivery Receipt" exist as print generators anywhere in the repo
today (grepped `function print[A-Z]` across js/*.js: only `printBKQuote` departments.js:6449,
`printQuote` departments.js:10015, `printPurchaseOrder` departments.js:13648, and
`printIDCards` app.js:3521 exist — zero for work orders, QC, delivery, or gate passes).

**There are TWO separate, independently-hardcoded stage enums today, and the owner's target
flow almost certainly renames only one of them — this ambiguity itself is an open decision,
not something to assume.** `JOB_STAGES` (departments.js:12001-12009) is the Sales→Finance
project lifecycle on the `job_projects` collection: `won → in_production → for_delivery →
delivered → completed → paid` (plus a `cancelled` side-branch), each tagged with an owning
`dept` (Sales/Production/Finance) and rendered via `jobStage(id)` (departments.js:12010,
`JOB_STAGES.find(s=>s.id===id) || JOB_STAGES[0]` — note the silent-fallback-to-first-stage
behavior for an unrecognized id, directly relevant to the "don't strand" requirement below).
`PROD_STAGES` (departments.js:11983-11992) is the shop-floor sub-pipeline on the SEPARATE
`production_orders` collection: `queued → cutting → welding → assembly → finishing → qc →
ready → delivered` (8 stages), rendered via `prodStage(id)` (departments.js:11993, same
find-or-fallback-to-first pattern). The owner's named target flow — Layouting → Bending &
Cutting → Assembly → Finishing & Polishing → Quality Checking → Out for Delivery (6 stages) —
maps shape-for-shape onto `PROD_STAGES` (a shop-floor cutting/welding/assembly/finishing/QC/
delivery pipeline), not onto `JOB_STAGES` (a sales/billing lifecycle that has no cutting or
polishing step at all). But the exact old→new mapping is non-trivial: PROD_STAGES has 8
values where the target has 6 — `queued` (pre-work holding state) and `ready` (packed,
awaiting delivery) have no obviously-named counterpart in the target list, and `cutting`
plus `welding` collapse into a single "Bending & Cutting" in the target list while `welding`
conceptually reads more like fabrication/assembly work. Every value in both enums is
grep-confirmed as the ONLY current source of truth (no `stages` config in Firestore, no
`settings/*` doc governs this — it is two literal JS array constants).

**Stage transitions are written from exactly two call sites, both in departments.js, both
free of any worker/timestamp-per-stage tracking beyond a single last-changed timestamp.**
(1) `production_orders.stage` is advanced by the `.prod-advance` button handler inside
`renderProdOrders` (departments.js:12524-12563): `const idx = PROD_STAGES.findIndex(...)`,
`const next = PROD_STAGES[Math.min(idx+1, PROD_STAGES.length-1)]`, then
`db.collection('production_orders').doc(o.id).update({ stage: next.id, stageUpdatedAt:
FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })` — `stageUpdatedAt`
is a SINGLE scalar timestamp overwritten on every advance (the doc's current-stage-since
marker), not an appended history array; there is no `stageHistory` field, subcollection, or
array anywhere (grepped `stageHistory` across every `js/*.js` and `firestore.rules`: zero
hits — confirmed greenfield). No worker/assignee is stamped on advance at all. (2)
`job_projects.stage` is advanced by `advanceProjectStage(p, nextId)` (departments.js:12217-
12237), called from the "Advance → {label}" button in `openJobProjectDetail`
(departments.js:12154): it writes `{ stage: nextId, updatedAt, timeline:
FieldValue.arrayUnion({at, event, by}) }` — `timeline` (an array of free-text event/actor/
date objects, already present on every `job_projects` doc since `createJobProject`,
departments.js:12014-12041) is the closest existing precedent for an append-only history
list, but it stores prose event strings ("Moved to In Production"), not a structured
per-stage worker+timestamp record. Neither call site has any concept of "who is working this
stage" — `production_orders.team` (departments.js:12706, `document.getElementById('po-
team').value.trim()`) is a single free-text field typed by whoever opens the order modal, not
a structured worker/uid assignment, and it is NOT updated by the advance handler (it stays
whatever was last typed, regardless of which stage the order is in). The nearest structured-
assignment precedent in the whole codebase is the generic `tasks` collection's
`assignedTo`/`assignedToNames` (parallel arrays of uid/name, e.g. departments.js:338-339,
919, 1201-1202) — used for the Production department's own Tasks sub-tab
(`renderDeptTasks(el,'Production',...)`, wired at departments.js:12399) but entirely separate
from `production_orders` docs; its employee picker (departments.js:872-876) queries ALL
`users` docs with no department filter, so there is no existing "pick a Production-dept
worker" narrowed query to reuse verbatim either.

**How the quote→order→job→shop-floor→tracker chain actually links today.** A won quote
becomes a `job_projects` doc via `createJobProject(d)` (departments.js:12014-12041, called
from the Sales Order flow), which mints `projectNo` ("JP-{YY}{MM}-{seq}"), stamps
`quoteId`/`quoteNumber`/`quoteCollection` (`bs_quotes` or `bk_quotes`), and initializes
`productionOrderIds:[]`. Production's own screen (`window.renderProductionDept`,
departments.js:12377, `renderProdOrders`, departments.js:12409-12566) surfaces any
`job_projects` doc whose `stage` is `won`/`in_production` and that has no
`productionOrderIds` yet as an "📥 Incoming jobs" card (departments.js:12420-12423, "these
previously lived ONLY in the Projects lifecycle, so the Production team never saw them here
and reported 'not receiving orders'" — a comment documenting a real prior bug in this exact
handoff). Clicking "＋ Start work order" opens `prodOrderModal` (departments.js:12634-12790)
prefilled with the linked project; saving a NEW order mints `orderNo` ("PO-{YY}{MM}-{seq}"),
writes `production_orders.add(data)`, and — only when created from a linked project —
updates the parent `job_projects` doc: `stage:'in_production'`,
`productionOrderIds: arrayUnion(_po.id)` (departments.js:12768-12770). So the relationship is
ONE `job_projects` doc to MANY `production_orders` docs (array), while each
`production_orders` doc points back via a single `projectId` field. When a `production_orders`
advance lands on `qc`, `ready`, or `delivered`, the handler (departments.js:12532-12551)
ALSO tries to move the parent `job_projects.stage` forward (never backward — guarded by
comparing `JOB_STAGES` index) via its own inline translation `next.id==='delivered' ?
'delivered' : next.id==='ready' ? 'for_delivery' : 'in_production'` (departments.js:12536),
and separately syncs the PUBLIC tracker via `window.syncOrderTracking(_tok, {status:_trk})`
where `_trk` comes from a THIRD inline map, `({qc:'qc',ready:'ready',delivered:'delivered'})
[next.id] || (advance ? 'production' : null)` (departments.js:12549). Independently,
`advanceProjectStage` (the `job_projects`-level advance, used when Production isn't the one
clicking) has its OWN, differently-shaped translation map, `{won:'confirmed',
in_production:'production', qc:'qc', for_delivery:'ready', ready:'ready', delivered:
'delivered', paid:'delivered'}[nextId]` (departments.js:12226) — note this map's `qc`/`ready`
keys can never actually match, since `nextId` here is always drawn from `JOB_STAGES` (whose
ids are won/in_production/for_delivery/delivered/completed/paid/cancelled), not from
`PROD_STAGES`; those two keys are dead/defensive leftovers, evidence that the map was
copy-adapted from the other one rather than shared as a single source of truth.

**The public order tracker (`t/index.html`, NOT `production_orders`/`job_projects` directly)
consumes only `order_tracking/{token}.status`, via its OWN fourth hardcoded stage list.**
`t/index.html:119-125` defines `var STAGES = [{key:'confirmed',...}, {key:'production',...},
{key:'qc',...}, {key:'ready',...}, {key:'delivered',...}]` (5 client-facing stages, each with
its own public name/description) and resolves the client's current position via
`stageIndex(status)` = `STAGES.findIndex(s=>s.key===status)`, defaulting to index 0 if the
stored `status` doesn't match any key (t/index.html:143-146) — i.e. an unrecognized status
value renders as "Order Confirmed" (the FIRST public stage), not an error, exactly mirroring
the `jobStage`/`prodStage` fallback-to-first behavior noted above. `order_tracking` docs are
written ONLY through `window.syncOrderTracking(token, patch)` (departments.js:9268-9277,
deep-merges a `stageStamps:{[patch.status]: today}` map alongside `status`) and
`window.ensureOrderTracking(o)` (departments.js:9283-9302, lazily creates the doc, defaulting
`status:'confirmed'`). **Critically, `t/index.html` never reads `production_orders.stage` or
`job_projects.stage` — it only ever sees whatever value one of the THREE hardcoded
translation maps above (departments.js:12226, 12536+12549, plus the tracker's own
`t/index.html:119-125` list) chose to write into `order_tracking.status`.** This is a real
mitigating fact for the rename (renaming `PROD_STAGES`/`JOB_STAGES` ids does NOT, by itself,
change what a client sees, because the tracker never touches those ids) but also a real
hazard: a rename that updates `PROD_STAGES`/`JOB_STAGES` without ALSO updating both
departments.js translation maps (12226 and 12536/12549) will silently stop advancing a
client's public tracker on some or all stage transitions — no error thrown, the client's page
simply stops updating past whatever stage it last recognized. `track.html` (repo root, 37
lines) is a legacy redirect only — it forwards any `?t=`/`?o=`/bare-query link to `/t/` and
contains no stage logic of its own (confirmed by reading the file in full); it needs no
changes for this workstream.

**QC and "delivery receipt" mechanisms: neither exists as a distinct feature today — confirmed
by direct grep, not inferred.** `qc` is nothing more than one label/color entry in
`PROD_STAGES` (departments.js:11989, `{id:'qc', label:'QC', icon:'🔍', color:'#ffa726'}`) — an
order sitting in that stage has no special UI, no required fields, no checklist, and no gate
preventing "Advance →" from moving it straight to `ready`. Grepping `checklist` (case-
insensitive) across every `js/*.js` file and `firestore.rules` returns ZERO hits anywhere in
the app — there is no checklist UI component, pattern, or data shape anywhere in this
codebase to model a "QC checklist" on (the closest conceptual cousins — Purchasing's RFQ/PR
two-stage flow, departments.js:13056+, and the Production "Count Form" for inventory,
`renderProdInventoryForm`, departments.js:12795+ — are both plain forms, not itemized
pass/fail checklists). Grepping "delivery receipt" (case-insensitive) across the entire repo
returns exactly one code hit, and it is the WRONG direction: the Purchasing PO print template
tells a SUPPLIER to "Reference this PO number on your delivery receipt and invoice"
(departments.js:13763) — i.e. an INBOUND receiving document from a vendor to Barro, not an
OUTBOUND document from Barro to a client confirming delivery of a finished order. The only
other repo hits are the plan documents themselves (V12-PLAN.md:184, V12-PLAN.md:243) and
`Partner_Guide.md:129` ("Delivery receipts or purchase orders" — generic partner-facing prose,
not a feature reference). There is consequently no existing upload-gate pattern tied to a
stage transition anywhere in `production_orders`: the one existing "precondition before an
action" analog, `consumeProductionMaterials` (departments.js:12567-12633, deducts inventory
stock + posts idempotent ledger COS/contra entries keyed `POCOS-{orderId}`/`POCOS-{orderId}-
INV`, guarded by a `materialsConsumed` boolean flag so it can't double-fire), is invoked by
its OWN separate "📦 Consume → stock & COS" button in the order modal and is NOT wired to the
stage-advance button at all — an order can be advanced straight through to `delivered` having
never consumed any material. The generic file-upload infrastructure that a delivery-receipt
requirement would most naturally reuse is `renderFileCollection`/`bindFileCollection`
(departments.js:11379-11390 / 11392+), which writes to a per-context `files_{id}` root
collection (auto-discovered for backup by `scripts/monthly-backup.js` via
`db.listCollections()`, per the comment at departments.js:11395) — already used for every
department's "Files" tab including Production's own (departments.js:12401-12403), but never
as a gate on anything; it is a pure upload-and-list widget today.

## Data model

**`production_orders/{docId}`** (top-level, auto-id) — exact field set assembled from the
save handler (departments.js:12706-12722, create branch 12723-12736) and the consume/advance
writers: `title` (string, required), `client` (string, free text — NOT a `job_projects`
lookup), `qty` (number), `quoteRef` (string, free text), `projectId` (string|null, FK into
`job_projects`), `team` (string, free text — see Current State), `stage` (string, one of the
8 `PROD_STAGES` ids, default `'queued'` when absent per the `o.stage||'queued'` fallback used
at departments.js:12432/12525/12674), `stageUpdatedAt` (Timestamp, set only by the advance
handler, departments.js:12528), `priority` (`'low'|'medium'|'high'|'urgent'`, default
`'medium'`), `dueDate` (string `YYYY-MM-DD` or `''`), `notes` (string), `materials` (array of
`{itemId, name, unitCost, qty}`, editable until consumed — departments.js:12747-12751),
`materialsConsumed` (bool), `materialsConsumedAt` (Timestamp), `materialsCost` (number, ₱),
`orderNo` (string, `"PO-{YY}{MM}-{seq}"`, minted only on create, departments.js:12729-12730),
`createdAt`/`createdBy`/`createdByName`, `updatedAt`. No `photoUrl`, no `assignedTo`, no
`stageHistory`, no `qcResult`/`checklist`, no `deliveryReceiptUrl` — none of these fields
exist on the doc today (confirmed by reading the entire create/edit payload, departments.js:
12706-12751).

**`job_projects/{docId}`** (top-level, auto-id) — from `createJobProject`
(departments.js:12014-12041) plus later mutators: `projectNo` (`"JP-{YY}{MM}-{seq}"`),
`company` (`'BS'|'BK'`), `name`, `clientName`, `stage` (one of the 7 `JOB_STAGES` ids,
default `'won'` at creation — no explicit fallback default elsewhere; an unrecognized value
falls through `jobStage()`'s `||JOB_STAGES[0]` to render as "Won"), `quoteId`, `quoteNumber`,
`quoteCollection` (`'bs_quotes'|'bk_quotes'`), `contractAmount`, `amountCollected`,
`arBalance`, `vatRate` (12), `capital` (cost basis, editable via `openProjectMarginModal`,
departments.js:12168-12216), `partnerUid` (nullable, shared-BS-project attribution),
`split:{isShared, barroPct, partnerPct}`, `documents` (array of `{type, ref, at, by}` — a
document register, e.g. `{type:'Quotation', ...}`), `timeline` (array of `{at, event, by}`,
append-only via `arrayUnion`, the closest existing precedent for an audit trail — see Current
State), `payments` (array, populated by Finance's Record Payment flow, not detailed here as
out of scope), `productionOrderIds` (array of `production_orders` doc ids),
`trackingToken` (string, FK into `order_tracking`, set lazily by `ensureOrderTracking`/the
Sales Order flow), `salesOrderId` (nullable FK), `createdBy`/`createdByName`/`createdAt`/
`updatedAt`. No `stageHistory`, no per-stage worker field, no QC/delivery-receipt field.

**`order_tracking/{token}`** (top-level, doc id = unguessable auto-generated token, PUBLIC
`get`) — from `ensureOrderTracking`/`syncOrderTracking` (departments.js:9268-9302): `orderId`,
`projectId`, `orderNo`, `clientName`, `company` (`'Barro Kitchens'|'Brilliant Steel'` display
label — NOT the internal `'BK'|'BS'` code), `scope`, `status` (one of the tracker's own 5
keys: `confirmed|production|qc|ready|delivered` — see Current State), `stageStamps` (map,
`{[status]: 'YYYY-MM-DD'}`, deep-merged so history of WHEN each public stage was first hit is
preserved), `contractAmount`, `paid`, `balance`, `orderDate`, `expectedDate` (nullable),
`publicNote` (free text shown verbatim to the client), `createdAt`/`updatedAt`. Only
client-safe fields live here by design (per the rules comment quoted below) — no cost/margin
data.

**firestore.rules — exact current blocks (quoted verbatim):**

```
    // ── Production orders (shop-floor pipeline) ─────────
    // Internal manufacturing/work-order data. Any signed-in internal staffer can
    // read and advance an order through its stages; external partners excluded;
    // only admins delete an order outright.
    match /production_orders/{docId} {
      allow read:           if isAuth() && !isPartner();
      allow create, update: if isAuth() && !isPartner();
      allow delete:         if isAuth() && isAdmin();
    }
```
(firestore.rules:964-972 — note: NOT scoped to Production-dept membership or
`canEditDept('Production')` in any way; ANY signed-in non-partner user, of any role/dept, can
create or update ANY `production_orders` doc at the rules level today. The client only hides
the Advance/Edit buttons via `canEditDept('Production')` — departments.js:12409.)

```
    // ── Project lifecycle (the spine: quote→order→production→delivery→paid) ──
    // Internal staff read + manage all; a partner sees only their own BS projects.
    match /job_projects/{docId} {
      allow read:   if isAuth() && (resource.data.createdBy == request.auth.uid || resource.data.partnerUid == request.auth.uid || !isPartner());
      allow create: if isAuth() && request.resource.data.createdBy == request.auth.uid;
      allow update: if isAuth() && (resource.data.createdBy == request.auth.uid || !isPartner());
      allow delete: if isAuth() && isAdmin();
    }
```
(firestore.rules:1034-1043 — `stage` has NO shape/enum validation at all; any string can be
written by any qualifying updater, so a rules-level guard is not currently a barrier to a
rename, but also provides no protection against a bad write.)

```
    // ── Public order tracking (client-facing, PUBLIC read by unguessable token) ──
    // Each doc id is a random 20-char Firestore auto-id acting as an unguessable
    // access token — the shareable client link is /track.html?t={id}. `get` is
    // PUBLIC (no auth) so a client can open the link without an account; `list` is
    // DENIED so nobody can enumerate all orders. Only client-SAFE fields live here
    // (status, dates, amounts the client already knows) — never internal cost/margin.
    // Internal non-partner staff create/update it; admins may delete.
    match /order_tracking/{token} {
      allow get:    if true;
      allow list:   if false;
      allow create: if isAuth() && !isPartner();
      allow update: if isAuth() && !isPartner();
      allow delete: if isAuth() && isAdmin();
    }
```
(firestore.rules:1045-1058 — no shape validation on `status`/`stageStamps` either; a
malformed write would just render as the tracker's stage-0 fallback, per t/index.html:143-146.)

## Constraints — must respect

- Manila-time discipline: every date stamp in this area already uses `window.bizDate()` with
  a defensive `new Date().toISOString().slice(0,10)` fallback when `bizDate` is undefined
  (e.g. `orderNo`/`projectNo` sequencing at departments.js:12016 and 12729, `stageStamps` day
  at departments.js:9271) — any new stage-timestamp or QC/delivery-receipt date field must
  follow the same `bizDate()`-first pattern, never a raw `new Date().toISOString()` with no
  fallback guard.
- escHtml() is used throughout every render site touched here (`orderCard`, `prodOrderModal`,
  `openJobProjectDetail`, the tracker's own `esc()` at t/index.html:112) — any new
  worker-name, QC-note, or delivery-receipt-filename interpolation into innerHTML must be
  wrapped the same way, including inside `t/index.html`'s public page (which has its own
  local `esc()` helper, not the app's `escHtml`, since it is a standalone unauthenticated
  page with no access to js/*.js globals).
- Firestore rules do not cascade or prefix-match: `production_orders`, `job_projects`, and
  `order_tracking` are each their own explicit top-level match block (firestore.rules:964-972,
  1034-1043, 1045-1058) — any NEW collection (e.g. a `production_orders/{id}/stageHistory`
  subcollection, or a standalone `qc_checklists` collection) needs its OWN explicit match
  block, or reads silently deny (returning empty via the `.catch(()=>({docs:[]}))` pattern
  used throughout, e.g. departments.js:12410-12413) rather than erroring loudly.
- Rules must read optional/new fields via `.get(field, default)`, never bare access, per the
  repo-wide missing-field-throws precedent — relevant the moment any new rule needs to
  validate a `stage` enum value, a `workerId` on a stage-history entry, or a
  `deliveryReceiptUrl` presence-check.
- `production_orders` write access is currently WIDE OPEN at the rules level (any non-partner
  authenticated user, any role/dept — see Data model above) — a new worker-assignment or
  QC-gate feature must explicitly decide whether to keep relying on client-side
  `canEditDept('Production')` gating (the status quo everywhere else in this module) or to
  tighten the rule itself; doing neither would let any employee, regardless of department,
  freely edit stage/worker/QC fields via devtools.
- CACHE_VER (sw.js:11, currently `'bi-ops-v173'`) must be bumped BY HAND on every JS/CSS edit
  in this workstream — confirmed (per CLAUDE.md and the WS26/WS27 precedent) as a separate
  manual step from the pre-commit hook's auto-bump of `window.APP_VERSION`/the `vX.Y.Z`
  strings; do not conflate the two.
- Script load order is fixed (index.html:294-323): firebase SDKs → lucide → firebase-
  config.js → config.js → qrcode.js → statutory-tables.js → letterhead.js → an inline block →
  drive.js → notifications.js → departments.js → app.js → modules.js. ALL production-flow
  code (`PROD_STAGES`, `JOB_STAGES`, every render/advance/consume function, both translation
  maps) lives inside `js/departments.js` (confirmed: grepping `PROD_STAGES|prodStage(` and
  `JOB_STAGES|jobStage(` across `js/app.js` and `js/modules.js` returns zero hits — the entire
  feature is self-contained in one file, departments.js:11983-12790) — a new shared helper
  (e.g. a single stage-translation function replacing the three duplicated maps) can live
  right alongside these constants with no cross-file load-order concern, UNLESS it needs to
  be called from app.js/modules.js, in which case it must be `window.`-attached (as
  `syncOrderTracking`/`ensureOrderTracking`/`makeTrackCode` already are, departments.js:9231,
  9268, 9283) rather than a bare function.
- Stage id strings are duplicated as literals in at least 6 places beyond the two enum
  arrays themselves, and a rename must update all of them in lockstep: the `||'queued'`
  fallback default (departments.js:12432, 12525, 12674), the `advanceProjectStage`
  JOB_STAGES→tracker map (departments.js:12226), the PROD_STAGES→JOB_STAGES-ish derivation
  (departments.js:12536), the PROD_STAGES→tracker map (departments.js:12549), and the CSV
  export label getter (`get:o=>prodStage(o.stage).label`, departments.js:12511) — plus the
  human-readable pipeline caption strings hardcoded in the UI copy itself ("Queued → Cutting
  → Welding → Assembly → Finishing → QC → Ready → Delivered", departments.js:12388 and
  12468) which are NOT derived from `PROD_STAGES.map()` but typed out separately, so they will
  silently go stale if the array changes without a matching edit to that copy.
- The public tracker's stage vocabulary (t/index.html:119-125: `confirmed|production|qc|
  ready|delivered`) is a FOURTH independent hardcoded list, decoupled from `PROD_STAGES`/
  `JOB_STAGES` by design (see Current State) — a rename of the internal enums does not, by
  itself, require touching `t/index.html`, but it DOES require re-deriving what each new
  internal stage value should translate to in the existing 3-map chain (12226 / 12536+12549)
  so the sync keeps working; whether the 5-key public vocabulary itself should also change
  (e.g. adding a "Quality Checking" label distinct from the generic "production" bucket most
  early production stages currently collapse into) is an open decision below, not something
  to assume.
- Legacy/in-flight orders: existing `production_orders` and `job_projects` documents already
  have `stage` values stored from the CURRENT 8-id and 7-id enums. Because `prodStage`/
  `jobStage` silently fall back to `PROD_STAGES[0]`/`JOB_STAGES[0]` when `.find()` returns
  undefined (departments.js:11993, 12010), simply swapping the enum arrays for the new ids
  with no migration would make every in-flight order/project render as if it just started
  (first stage, first color) — a visual regression, not a crash — which is exactly the
  "stranding" the mandate's parenthetical explicitly calls out and requires a mapping to
  prevent.

## DECIDED — architecture spec (Fable, 2026-07-10)

### Resolved decisions (one line each)

1. **Which enum is renamed → `PROD_STAGES` ONLY; `JOB_STAGES` is untouched.** The owner's
   named flow (Layouting → Bending & Cutting → Assembly → Finishing & Polishing → Quality
   Checking → Out for Delivery) is a shop-floor fabrication pipeline that maps
   shape-for-shape onto `PROD_STAGES`; `JOB_STAGES` is the sales/billing lifecycle (won →
   … → paid) with no cutting/polishing concept — relabeling it would break Finance/Sales
   vocabulary for zero owner benefit. Zero edits to `JOB_STAGES`, `jobStage()`,
   `createJobProject`, `renderProjectLifecycle`, or the job-detail stepper.
2. **Legacy→new mapping → 7 new ids (6 owner stages + terminal `delivered`), applied via a
   READ-SIDE SHIM, no data backfill.** `queued`→`layouting` (Layouting IS the new first
   stage — a separate pre-work holding state duplicated the "📥 Incoming jobs" card, which
   already represents not-yet-started work); `cutting`→`bending_cutting`;
   `welding`→`assembly` (welding is joining/fabrication, i.e. assembly of steel parts —
   NOT sheet prep, so it folds into Assembly, not Bending & Cutting);
   `assembly`→`assembly`; `finishing`→`finishing`; `qc`→`qc` (id kept — it already matches
   both tracker maps; label-only change to "Quality Checking"); `ready`→`out_for_delivery`
   (survives as the owner's "Out for Delivery" dispatch state); `delivered`→`delivered`
   (kept as a 7th TERMINAL stage the owner's list doesn't name — without it orders could
   never leave the pipeline, and the delivered-collapsed list, CSV, job-sync and tracker
   'delivered' pushes all need a terminal marker). Migration is `normProdStageId()`
   normalize-on-read (Spec 1), NOT a one-time backfill: the service worker means stale
   clients can keep WRITING old ids for a day or two after deploy, so a backfill alone
   cannot prevent stranding, while the shim makes stored ids self-migrate on each order's
   next stage write. No in-flight order ever renders as stage 1.
3. **stageHistory + worker assignment → two fields ON the `production_orders` doc; worker
   identity = `worker_profiles` docId, picked from a NEW public-safe `worker_directory`
   projection.** `stageHistory` is an append-only array (`arrayUnion`, ISO-string `at` —
   `serverTimestamp()` is ILLEGAL inside `arrayUnion`, exactly why `job_projects.timeline`
   uses `new Date().toISOString()`); `assignments` is a map keyed by (new) stage id holding
   `{workerIds:[], workerNames:[]}` (multiple workers per stage supported), mirroring the
   `stageStamps` map precedent. Workers are WS27's `worker_profiles` (the shop floor is
   staffed by no-login hourly workers, not `users` logins), but `worker_profiles` READ is
   finance/admin-only (rules:925-929, carries rates/CA/SSS/TIN) — so a `worker_directory/
   {workerProfileId}` roster projection (name/idNumber/jobTitle/dept/status/photo ONLY,
   the same public-safe-projection pattern WS27 already uses for `id_verify`) is readable
   by all internal staff and feeds the picker. Legacy free-text `team` stays readable as a
   fallback everywhere and is only editable while the directory is empty. No new identity
   shape is invented — no "fourth worker identity" (WS27 risk avoided).
4. **Delivery-receipt gate → advancing INTO `delivered` is blocked BOTH client-side and
   rules-side until a structured `deliveryReceipt` object exists on the order doc;
   printable DR via the WS14 letterhead engine IS in scope.** The artifact is option (b) +
   (c): a structured acknowledgment `{no, receivedBy, date, notes, by, byName, at}`
   captured in a modal (no file upload in v1 — a photo/signature upload can reuse
   `files_{id}` later), with `no` minted atomically via `window.nextSerial(
   'delivery_receipt','DR')` (→ `DR-2026-000001`; `_counters` write rule widened, Spec 9)
   and a client-facing printable cloned from the `printPurchaseOrder` pattern. The DR is
   also pushed onto the parent project's `documents` register (the existing 'Job Order'
   precedent, departments.js:12771). The plan's other Production printables (Work Order
   traveler, QC Inspection report, Delivery checklist, Gate pass) are NOT in WS28 — they
   belong to the printables workstream; WS28 stores the QC/DR DATA they will print.
5. **QC checklist → a fixed, universal, hardcoded `QC_CHECKLIST` JS constant (7 items),
   per-item pass/fail/N-A + one notes field + inspector + timestamp, stored as a `qc`
   object on the order doc.** Matches the `PROD_STAGES`/`LEAVE_TYPES` hardcoded-constant
   precedent; admin-configurable and per-product-type checklists are deferred (YAGNI until
   the owner asks — the constant is one edit away). `result:'passed'` (no item failed, not
   all N/A) is required to enter `out_for_delivery` (client + rules gate). No per-item
   photos in v1. A failed QC keeps the order in `qc` for rework + re-inspection.
6. **Public tracker vocabulary → UNCHANGED; zero edits to `t/index.html` (and none to
   `track.html`).** Links are already in real clients' hands; the 5-step client view
   (confirmed/production/qc/ready/delivered) is the right client granularity — clients
   don't care about bending vs. polishing, and the decoupling already exists by design.
   Only the internal translation maps change (D7), preserving every push the tracker gets
   today. The tracker deploy can lag indefinitely (it isn't being changed at all).
7. **The three translation maps → unified into TWO tiny named functions next to the
   enums** — `trackerKeyFor(id)` (single source of truth for BOTH vocabularies → public
   tracker key; the two vocabularies never collide on a key with different values) and
   `prodToJobStage(prodId)` (prod → job lifecycle). The dead `qc`/`ready` keys in the
   12226 map are deleted; drift between hand-copied maps (already observed) becomes
   structurally impossible.
8. **firestore.rules → `production_orders` writes tightened + two transition guards; one
   NEW `worker_directory` block; `_counters` write widened; `job_projects`/`order_tracking`
   unchanged.** create: `canProduction() || inDept('Sales')` (Sales legitimately creates a
   work order via the project-detail "🏭 Job Order" button, departments.js:12151); update:
   `canProduction()` only (the advance/QC/DR/consume surfaces are all Production-gated
   client-side already) plus rules-side QC/DR transition guards so a devtools or stale-SW
   client can't skip the gates; delete: `isAdmin()` unchanged. `stageHistory`/`qc`/
   `deliveryReceipt` live ON the doc → no new collection or match block needed for them;
   `worker_directory` (new root collection → auto-backed-up by monthly-backup's
   `listCollections()`) gets its own block: read all internal staff, write finance/admin.

**Scoping / sequencing:** **WS29 (Inventory)** — WS28 deliberately does NOT tie
`consumeProductionMaterials` to any stage transition; the "📦 Consume → stock & COS" button
stays fully decoupled from Advance, so WS29's costing rework is unaffected and unsequenced.
**WS30 (Purchasing)** — no lot/batch tracking is added; worker assignment never touches
`inventory_items`; no new coupling. **WS35 (Design)** — the `layouting` first stage does NOT
assume any Design→Production handoff exists (none does, grep-confirmed); the incoming-jobs
card remains the only entry point, and WS35 can later deep-link into `layouting` without
schema changes here. **WS26/27 (worker identity)** — reuses `worker_profiles` docIds as the
one worker identity (same key as `attendance_worker/{workerProfileId}`), bridged read-only
via `worker_directory`; no second source of truth is created.

---

### Spec 1 — New `PROD_STAGES`, legacy shim, unified translators (departments.js:11983-11993)

```js
// BEFORE (11983-11993)
const PROD_STAGES = [
  { id:'queued',    label:'Queued',      icon:'📋', color:'#78909c' },
  { id:'cutting',   label:'Cutting',     icon:'✂️', color:'#5c6bc0' },
  { id:'welding',   label:'Welding / Fab', icon:'🔧', color:'#7e57c2' },
  { id:'assembly',  label:'Assembly',    icon:'🛠️', color:'#26a69a' },
  { id:'finishing', label:'Finishing',   icon:'✨', color:'#26c6da' },
  { id:'qc',        label:'QC',          icon:'🔍', color:'#ffa726' },
  { id:'ready',     label:'Ready',       icon:'📦', color:'#66bb6a' },
  { id:'delivered', label:'Delivered',   icon:'🚚', color:'#43a047' },
];
function prodStage(id){ return PROD_STAGES.find(s=>s.id===id) || PROD_STAGES[0]; }

// AFTER — v12 WS28: the owner's real shop-floor flow + terminal Delivered.
const PROD_STAGES = [
  { id:'layouting',        label:'Layouting',             icon:'📐', color:'#78909c' },
  { id:'bending_cutting',  label:'Bending & Cutting',     icon:'✂️', color:'#5c6bc0' },
  { id:'assembly',         label:'Assembly',              icon:'🛠️', color:'#26a69a' },
  { id:'finishing',        label:'Finishing & Polishing', icon:'✨', color:'#26c6da' },
  { id:'qc',               label:'Quality Checking',      icon:'🔍', color:'#ffa726' },
  { id:'out_for_delivery', label:'Out for Delivery',      icon:'🚚', color:'#66bb6a' },
  { id:'delivered',        label:'Delivered',             icon:'✅', color:'#43a047' },
];
// Legacy → v12 id normalization. Docs written before the rename keep their old
// stage string until their next stage write; EVERY read site must go through
// normProdStageId() so no in-flight order visually resets to stage 1 (the old
// find-or-fallback-to-first behavior). Do NOT bulk-rewrite stored ids — stale
// service-worker clients may write old ids for a while, and the shim absorbs that.
const LEGACY_PROD_STAGE = { queued:'layouting', cutting:'bending_cutting', welding:'assembly', ready:'out_for_delivery' };
function normProdStageId(id){ id = id || 'layouting'; return LEGACY_PROD_STAGE[id] || id; }
function prodStage(id){ const n = normProdStageId(id); return PROD_STAGES.find(s=>s.id===n) || PROD_STAGES[0]; }

// Single source of truth: internal stage id (EITHER vocabulary — the two id sets
// never collide on a key with different targets) → public order_tracking status.
// Early shop-floor stages intentionally return null; the prod-advance call site
// decides whether to push the generic 'production' bucket (forward-only guard).
// Replaces the three drifted inline maps (old 12226 / 12536 / 12549; the old
// 12226 map's qc/ready keys were dead code and are dropped).
function trackerKeyFor(id){
  return ({ won:'confirmed', in_production:'production',
            qc:'qc', out_for_delivery:'ready', for_delivery:'ready',
            delivered:'delivered', paid:'delivered' })[id] || null;
}
// Prod stage → the job_projects lifecycle stage it implies (forward-only at the call site).
function prodToJobStage(prodId){
  return prodId==='delivered' ? 'delivered' : prodId==='out_for_delivery' ? 'for_delivery' : 'in_production';
}
```

### Spec 2 — Data shapes (annotated literals; all NEW fields, existing fields unchanged)

```js
// production_orders/{docId} — NEW fields added by WS28 (all optional on legacy docs;
// every reader must tolerate their absence):
{ stage: 'layouting',            // now one of the 7 NEW ids; legacy ids remain valid via normProdStageId()
  stageHistory: [                // append-only via arrayUnion; seeded with 1 entry on create.
    { stage:'layouting', enteredAt:'2026-07-10T08:30:00.000Z',   // ISO string, NOT serverTimestamp (arrayUnion限制)
      by:'<uid>', byName:'Juan D.' }],
  assignments: {                 // per-stage worker assignment (multi-worker), map keyed by NEW stage id
    layouting: { workerIds:['<worker_profiles docId>', …], workerNames:['Ramon C.', …] } },
  team: 'Fab Team A',            // LEGACY free-text — kept, read-fallback only; editable only while worker_directory is empty
  qc: {                          // written by the QC modal; absent until first inspection
    result:'passed'|'failed',
    items:[{ id:'dims', label:'Dimensions match drawing / layout', state:'pass'|'fail'|'na' }, …],
    notes:'', by:'<uid>', byName:'', at:'<ISO>' },
  deliveryReceipt: {             // written by the DR modal; absent until recorded; REQUIRED to enter 'delivered'
    no:'DR-2026-000001',         // nextSerial('delivery_receipt','DR') — atomic _counters transaction
    receivedBy:'Client rep name (required)', date:'YYYY-MM-DD (bizDate default)',
    notes:'', by:'<uid>', byName:'', at:'<ISO>' } }

// worker_directory/{workerProfileId} — NEW root collection (docId == worker_profiles docId).
// PUBLIC-SAFE projection only — NEVER rates/CA/SSS/PhilHealth/TIN/address/phone.
{ name:'Ramon C.', idNumber:'BI-W-014', jobTitle:'Welder', department:'Production',
  status:'active'|'inactive', photoUrl:'', updatedAt }   // serverTimestamp

// The hardcoded checklist (departments.js, directly under PROD_STAGES). Universal;
// edit labels here to change the shop's checklist. Per-product variants = future WS.
const QC_CHECKLIST = [
  { id:'dims',     label:'Dimensions match drawing / layout' },
  { id:'welds',    label:'Welds ground smooth — no pinholes, spatter or sharp edges' },
  { id:'finish',   label:'Surface finish & polish uniform, no deep scratches' },
  { id:'moving',   label:'Doors / drawers / moving parts aligned and operating' },
  { id:'level',    label:'Unit sits level; legs / feet adjusted' },
  { id:'clean',    label:'Cleaned & degreased; protective film / stickers removed' },
  { id:'complete', label:'Quantity & accessories complete vs the order' },
];
```
(Note: the `stageHistory` comment above must read "arrayUnion limitation" in the shipped
code — keep source ASCII.) `job_projects` and `order_tracking` shapes are UNCHANGED.

### Spec 3 — The `.prod-advance` handler (departments.js:12522-12556) — BEFORE/AFTER

BEFORE: the block quoted in Current State (findIndex on raw `o.stage||'queued'`, no gates,
no history, two inline maps at 12536/12549). AFTER (complete replacement):

```js
    el.querySelectorAll('.prod-advance').forEach(b=>b.addEventListener('click', async (e)=>{
      e.stopPropagation();
      const o = orders.find(x=>x.id===b.dataset.id); if(!o) return;
      const curId = normProdStageId(o.stage);
      const idx = PROD_STAGES.findIndex(s=>s.id===curId);
      const next = PROD_STAGES[Math.min(idx+1, PROD_STAGES.length-1)];
      // ── QC gate: may not ENTER Out for Delivery without a PASSED inspection ──
      if (next.id==='out_for_delivery' && (o.qc?.result)!=='passed') {
        openQCModal(o, ()=>renderProdOrders(el, currentUser, currentRole));
        return;
      }
      // ── DR gate: may not ENTER Delivered without a delivery receipt ──
      if (next.id==='delivered' && !o.deliveryReceipt) {
        openDeliveryReceiptModal(o, ()=>renderProdOrders(el, currentUser, currentRole));
        return;
      }
      b.disabled = true;
      try {
        await db.collection('production_orders').doc(o.id).update({
          stage: next.id, stageUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          // per-stage timestamp trail — ISO string (serverTimestamp is illegal in arrayUnion)
          stageHistory: firebase.firestore.FieldValue.arrayUnion({
            stage: next.id, enteredAt: new Date().toISOString(),
            by: currentUser.uid, byName: userProfile?.displayName||currentUser.email||'' }) });
        // Keep the parent project's lifecycle stage in sync with production progress —
        // but only move it FORWARD. Never regress a job that's already further along
        // (e.g. delivered/paid) just because an early production sub-stage advanced.
        if (o.projectId) {
          const projStage = prodToJobStage(next.id);
          try {
            const jdoc = await db.collection('job_projects').doc(o.projectId).get();
            const cur = jdoc.exists ? jdoc.data().stage : null;
            const ord = s => JOB_STAGES.findIndex(x => x.id === s);
            const evt = { at:new Date().toISOString(), event:`Production: ${next.label}`, by:userProfile?.displayName||currentUser.email };
            const advance = cur !== 'paid' && cur !== 'cancelled' && ord(projStage) > ord(cur);
            await db.collection('job_projects').doc(o.projectId).update({
              ...(advance ? { stage: projStage } : {}),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
              timeline: firebase.firestore.FieldValue.arrayUnion(evt) });
            // reflect the milestone on the client's public tracker (forward only)
            const _tok = jdoc.exists ? jdoc.data().trackingToken : null;
            if(_tok){ const _trk = trackerKeyFor(next.id) || (advance ? 'production' : null);
              if(_trk) window.syncOrderTracking(_tok, { status:_trk }); }
          } catch(_) {}
        }
        Notifs.showToast(`Moved to ${next.label}`);
        renderProdOrders(el, currentUser, currentRole);
      } catch(ex){ Notifs.showToast('Update failed','error'); b.disabled=false; }
    }));
```
Behavioral parity check: qc→'qc', out_for_delivery→'ready', delivered→'delivered' tracker
pushes are identical to today's; early stages still push 'production' only when the job
actually advanced (the forward-only guard is preserved verbatim).

### Spec 4 — `advanceProjectStage` (departments.js:12217-12237) — one-line map swap

```js
// BEFORE (12226)
    const _trkStage = { won:'confirmed', in_production:'production', qc:'qc', for_delivery:'ready', ready:'ready', delivered:'delivered', paid:'delivered' }[nextId];
// AFTER
    const _trkStage = trackerKeyFor(nextId);   // v12 WS28 — single shared translator (old qc/ready keys were dead)
```
Everything else in the function is unchanged (`completed` maps to null both before and after
→ no tracker push, same as today).

### Spec 5 — `renderProdOrders` read sites + `prodOrderModal` (worker picker, stage select, save gates)

**5a — shim the remaining raw-stage reads in `renderProdOrders`:**
- 12424: `const active = orders.filter(o=>normProdStageId(o.stage)!=='delivered');`
- 12432: `active.forEach(o=>{ (byStage[normProdStageId(o.stage)] ||= []).push(o); });`
- 12433: `const delivered = orders.filter(o=>normProdStageId(o.stage)==='delivered');`
- 12436 (orderCard `od` check) and 12452 (Advance-button condition): replace
  `o.stage!=='delivered'` with `normProdStageId(o.stage)!=='delivered'`.

**5b — orderCard (12435-12457): workers line, QC badge, QC button.** Replace the `o.team`
span (12447) with:
```js
            ${(()=>{ const w=(o.assignments?.[normProdStageId(o.stage)]?.workerNames)||[];
              return w.length?`<span style="color:var(--text-muted)">👷 ${escHtml(w.join(', '))}</span>`
                : (o.team?`<span style="color:var(--text-muted)">👷 ${escHtml(o.team)}</span>`:''); })()}
            ${o.qc?`<span class="badge ${o.qc.result==='passed'?'badge-green':'badge-red'}" style="font-size:9px">${o.qc.result==='passed'?'✅ QC':'❌ QC'}</span>`:''}
            ${o.deliveryReceipt?`<span class="badge badge-blue" style="font-size:9px">🧾 ${escHtml(o.deliveryReceipt.no||'DR')}</span>`:''}
```
and in the canEdit button column (12451-12454), add between Advance and Edit:
```js
          ${normProdStageId(o.stage)==='qc'?`<button class="btn-secondary btn-sm prod-qc" data-id="${o.id}">🔍 QC</button>`:''}
```
bound after the existing `.prod-edit` binding:
```js
    el.querySelectorAll('.prod-qc').forEach(b=>b.addEventListener('click',(e)=>{ e.stopPropagation();
      const o=orders.find(x=>x.id===b.dataset.id); if(o) openQCModal(o, ()=>renderProdOrders(el, currentUser, currentRole)); }));
```

**5c — kill the two hand-typed pipeline strings (12388, 12468) — derive from the array:**
- 12388 (sopPanel bullet 1): `'Orders is the shop-floor pipeline: '+PROD_STAGES.map(s=>s.label).join(' → ')+'.'`
  and ADD two bullets: `'Quality Checking requires a passed 🔍 QC checklist before an order can go Out for Delivery.'`
  and `'Marking Delivered requires a 🧾 Delivery Receipt (received-by + date) — printable on letterhead.'`
- 12468: `` `Pipeline: ${PROD_STAGES.map(s=>s.label).join(' → ')}` ``

**5d — CSV export (12509-12511):** stage getter is unchanged (shim-covered via
`prodStage()`); swap the `team` column getter and append QC/DR columns:
```js
    {key:'stage',label:'Stage',get:o=>prodStage(o.stage).label},{key:'priority',label:'Priority'},
    {key:'team',label:'Workers',get:o=>{const a=o.assignments?.[normProdStageId(o.stage)];return (a?.workerNames?.length)?a.workerNames.join('; '):(o.team||'');}},
    {key:'qc',label:'QC',get:o=>o.qc?o.qc.result:''},{key:'dr',label:'DR #',get:o=>o.deliveryReceipt?.no||''},
    {key:'dueDate',label:'Due'},{key:'quoteRef',label:'Quote Ref'}
```

**5e — `prodOrderModal` (12634-12790).** Load the roster in parallel with the existing
project/inventory loads (after 12652):
```js
  // v12 WS28 — worker roster (public-safe projection; empty if never synced)
  let workers = [];
  try { const wsnap = await dbCachedGet('worker_directory', ()=>db.collection('worker_directory').get().catch(()=>({docs:[]})), 45000);
    workers = wsnap.docs.map(d=>({id:d.id,...d.data()})).filter(w=>(w.status||'active')==='active').sort((a,b)=>(a.name||'').localeCompare(b.name||'')); } catch(_) {}
```
Replace the "Assigned Team" form-group (12669) with (keeps `po-team` as the fallback when
the directory is empty, so nothing breaks pre-sync):
```js
      <div class="form-group"><label>Workers — this stage</label>
        ${workers.length?`
        <div id="po-workers-chips" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px"></div>
        <div style="display:flex;gap:6px">
          <select id="po-worker-sel" style="flex:1;min-width:0;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)">
            <option value="">— Add worker —</option>
            ${workers.map(w=>`<option value="${w.id}" data-name="${escHtml(w.name||'')}">${escHtml(w.name||'')}${w.jobTitle?` — ${escHtml(w.jobTitle)}`:''}</option>`).join('')}
          </select>
          <button class="btn-secondary btn-sm" id="po-worker-add" type="button">＋</button>
        </div>
        ${e.team?`<div style="font-size:11px;color:var(--text-muted);margin-top:3px">Legacy team note: ${escHtml(e.team)}</div>`:''}`
        :`<input id="po-team" value="${escHtml(e.team||'')}" placeholder="e.g. Fab Team A"/>
        <div style="font-size:11px;color:var(--text-muted);margin-top:3px">No worker directory yet — Finance/HR: press "↻ Sync Directory" on HR Profiles. Free-text team is used meanwhile.</div>`}
      </div>
```
Chip state + handlers (add after the materials-editor block, ~12711):
```js
  // v12 WS28 — per-stage worker chips (initialised from the CURRENT stage's assignment)
  let asgSel = [];
  { const cur = e.assignments?.[normProdStageId(e.stage)];
    if (cur) asgSel = (cur.workerIds||[]).map((id,i)=>({ id, name:(cur.workerNames||[])[i]||id })); }
  const renderWChips = () => { const w=document.getElementById('po-workers-chips'); if(!w) return;
    w.innerHTML = asgSel.map(x=>`<span class="badge badge-blue" style="cursor:pointer" data-uid="${escHtml(x.id)}">👷 ${escHtml(x.name)} ✕</span>`).join('')||'<span style="font-size:11px;color:var(--text-muted)">No workers assigned to this stage yet.</span>';
    w.querySelectorAll('[data-uid]').forEach(ch=>ch.addEventListener('click',()=>{ asgSel=asgSel.filter(x=>x.id!==ch.dataset.uid); renderWChips(); })); };
  renderWChips();
  document.getElementById('po-worker-add')?.addEventListener('click', ()=>{
    const sel=document.getElementById('po-worker-sel'); const id=sel.value; if(!id) return;
    if(!asgSel.some(x=>x.id===id)) asgSel.push({ id, name: sel.options[sel.selectedIndex]?.dataset.name||'' });
    sel.value=''; renderWChips(); });
```
Stage `<select>` (12674): options from the NEW array, normalized selection, last two stages
excluded on CREATE (they are only reachable through the gates):
```js
          ${PROD_STAGES.filter(s=>order || !['out_for_delivery','delivered'].includes(s.id))
            .map(s=>`<option value="${s.id}" ${normProdStageId(e.stage)===s.id?'selected':''}>${s.icon} ${s.label}</option>`).join('')}
```
Save handler (12734-12777) — three insertions. (1) Immediately after the `data` object is
built, mirror the rules gates with friendly errors:
```js
    // v12 WS28 — mirror the rules-side transition gates (friendly errors)
    const _prevStage = normProdStageId(e.stage);
    if (data.stage==='out_for_delivery' && _prevStage!=='out_for_delivery' && (e.qc?.result)!=='passed'){
      err.textContent='QC must pass first — run the 🔍 QC inspection before Out for Delivery.'; err.classList.remove('hidden'); return; }
    if (data.stage==='delivered' && _prevStage!=='delivered' && !e.deliveryReceipt){
      err.textContent='Record the 🧾 Delivery Receipt before marking Delivered.'; err.classList.remove('hidden'); return; }
```
(2) Replace `team: document.getElementById('po-team').value.trim(),` in the `data` literal
with nothing (remove the line), and add after the gate block:
```js
    if (workers.length) {
      const asg = Object.assign({}, e.assignments||{});
      if (asgSel.length) asg[data.stage] = { workerIds: asgSel.map(x=>x.id), workerNames: asgSel.map(x=>x.name) };
      else delete asg[data.stage];
      data.assignments = asg;                       // legacy `team` left untouched on the doc
    } else {
      data.team = document.getElementById('po-team')?.value.trim() || '';
    }
    if (order && data.stage !== _prevStage) {       // stage changed via the select → history + since-marker
      data.stageHistory = firebase.firestore.FieldValue.arrayUnion({
        stage: data.stage, enteredAt: new Date().toISOString(),
        by: currentUser.uid, byName: userProfile?.displayName||currentUser.email||'' });
      data.stageUpdatedAt = firebase.firestore.FieldValue.serverTimestamp();
    }
```
(3) In the CREATE branch (after `data.createdByName = …`, 12764):
```js
        data.stageHistory = [{ stage: data.stage, enteredAt: new Date().toISOString(),
          by: currentUser.uid, byName: data.createdByName }];
```
Footer buttons (12692): add a DR button for orders at/past dispatch:
```js
${order && ['out_for_delivery','delivered'].includes(normProdStageId(e.stage))?'<button class="btn-secondary" id="po-dr">🧾 Delivery Receipt</button>':''}
```
bound alongside po-consume: `document.getElementById('po-dr')?.addEventListener('click', ()=>{ closeModal(); openDeliveryReceiptModal({...e, id:order.id}, onSaved); });`

### Spec 6 — `openQCModal(order, onSaved)` (NEW, place directly after `QC_CHECKLIST`)

```js
function openQCModal(order, onSaved){
  const prev = order.qc || null;
  const stateOf = id => prev?.items?.find(i=>i.id===id)?.state || '';
  openModal('🔍 Quality Checking — '+escHtml(order.orderNo||order.title||''), `
    ${prev?`<div style="font-size:11px;margin-bottom:8px;color:${prev.result==='passed'?'var(--success)':'var(--danger)'}">Last inspection: <b>${prev.result}</b> · ${escHtml(prev.byName||'')} · ${prev.at?new Date(prev.at).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):''}</div>`:''}
    <div style="display:flex;flex-direction:column">
      ${QC_CHECKLIST.map(it=>`
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;border-bottom:1px solid var(--border);padding:7px 0">
          <span style="font-size:12px;flex:1">${escHtml(it.label)}</span>
          <span style="display:flex;gap:8px;flex-shrink:0">
            ${['pass','fail','na'].map(s=>`<label style="font-size:11px;display:flex;align-items:center;gap:3px;cursor:pointer"><input type="radio" name="qc-${it.id}" value="${s}" ${stateOf(it.id)===s?'checked':''}/>${s==='pass'?'✅':s==='fail'?'❌':'N/A'}</label>`).join('')}
          </span>
        </div>`).join('')}
    </div>
    <div class="form-group" style="margin-top:10px"><label>Inspection notes</label><textarea id="qc-notes" rows="2" placeholder="Rework needed, remarks…">${escHtml(prev?.notes||'')}</textarea></div>
    <div id="qc-err" class="error-msg hidden"></div>
  `, `<button class="btn-primary" id="qc-save">Save Inspection</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  document.getElementById('qc-save').addEventListener('click', async ()=>{
    const err = document.getElementById('qc-err');
    const items = QC_CHECKLIST.map(it=>({ id:it.id, label:it.label,
      state: document.querySelector(`input[name="qc-${it.id}"]:checked`)?.value || '' }));
    if (items.some(i=>!i.state)) { err.textContent='Mark every item (pass / fail / N/A).'; err.classList.remove('hidden'); return; }
    if (items.every(i=>i.state==='na')) { err.textContent='At least one item must actually be inspected (not all N/A).'; err.classList.remove('hidden'); return; }
    const result = items.some(i=>i.state==='fail') ? 'failed' : 'passed';
    const qc = { result, items, notes: document.getElementById('qc-notes').value.trim(),
      by: currentUser.uid, byName: userProfile?.displayName||currentUser.email||'', at: new Date().toISOString() };
    try {
      await db.collection('production_orders').doc(order.id).update({ qc, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      window.logAudit && window.logAudit('update','production_order',order.id,{ qc: result });
      Notifs.showToast(result==='passed' ? 'QC passed — press Advance → to move the order on.' : 'QC failed — rework, then re-inspect.', result==='passed'?undefined:'error');
      closeModal(); onSaved && onSaved();
    } catch(ex){ err.textContent='Save failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
  });
}
```
(A passed record persists if the order is later moved backward for rework — re-opening the
QC modal and saving a fresh inspection overwrites it; acceptable v1 semantics, noted.)

### Spec 7 — `openDeliveryReceiptModal(order, onSaved)` + `printDeliveryReceipt(order)` (NEW)

```js
function openDeliveryReceiptModal(order, onSaved){
  const dr = order.deliveryReceipt || null;
  if (dr) {   // view / reprint mode
    openModal('🧾 Delivery Receipt — '+escHtml(dr.no||''), `
      <div style="font-size:12px;display:grid;grid-template-columns:auto 1fr;gap:4px 12px">
        <span style="color:var(--text-muted)">Receipt #</span><b>${escHtml(dr.no||'')}</b>
        <span style="color:var(--text-muted)">Received by</span><span>${escHtml(dr.receivedBy||'')}</span>
        <span style="color:var(--text-muted)">Date</span><span>${escHtml(dr.date||'')}</span>
        ${dr.notes?`<span style="color:var(--text-muted)">Notes</span><span>${escHtml(dr.notes)}</span>`:''}
        <span style="color:var(--text-muted)">Recorded by</span><span>${escHtml(dr.byName||'')}</span>
      </div>`,
      `<button class="btn-primary" id="dr-print">🖨 Print</button><button class="btn-secondary" onclick="closeModal()">Close</button>`);
    document.getElementById('dr-print')?.addEventListener('click', ()=>printDeliveryReceipt(order));
    return;
  }
  const dayStr = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10);
  openModal('🧾 Record Delivery Receipt — '+escHtml(order.orderNo||order.title||''), `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Required before this order can be marked <b>Delivered</b>. Fill it in with the client's receiving rep at handover.</div>
    <div class="form-row">
      <div class="form-group"><label>Received by (client rep)</label><input id="dr-name" placeholder="e.g. Maria Santos — Purchasing"/></div>
      <div class="form-group" style="flex:0 0 140px"><label>Date</label><input id="dr-date" type="date" value="${dayStr}"/></div>
    </div>
    <div class="form-group"><label>Notes (optional)</label><textarea id="dr-notes" rows="2" placeholder="Condition on arrival, partial delivery, etc."></textarea></div>
    <div id="dr-err" class="error-msg hidden"></div>
  `, `<button class="btn-primary" id="dr-save">Save Receipt</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  document.getElementById('dr-save').addEventListener('click', async ()=>{
    const err = document.getElementById('dr-err');
    const receivedBy = document.getElementById('dr-name').value.trim();
    if(!receivedBy){ err.textContent='"Received by" is required — the client rep who accepted the delivery.'; err.classList.remove('hidden'); return; }
    const btn=document.getElementById('dr-save'); btn.disabled=true;
    try {
      const no = await window.nextSerial('delivery_receipt','DR');   // DR-2026-000001 (atomic; a failed save burns a serial — fine)
      const byName = userProfile?.displayName||currentUser.email||'';
      const deliveryReceipt = { no, receivedBy, date: document.getElementById('dr-date').value || dayStr,
        notes: document.getElementById('dr-notes').value.trim(), by: currentUser.uid, byName, at: new Date().toISOString() };
      await db.collection('production_orders').doc(order.id).update({ deliveryReceipt, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      if (order.projectId) { try { await db.collection('job_projects').doc(order.projectId).update({
        documents: firebase.firestore.FieldValue.arrayUnion({ type:'Delivery Receipt', ref:no, at:new Date().toISOString(), by:byName }),
        timeline:  firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:'Delivery receipt '+no+' recorded', by:byName }),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp() }); } catch(_) {} }
      window.logAudit && window.logAudit('update','production_order',order.id,{ deliveryReceipt: no });
      Notifs.showToast('Receipt '+no+' recorded — press Advance → again to mark Delivered.');
      closeModal(); onSaved && onSaved();
    } catch(ex){ err.textContent='Save failed: '+(ex.message||ex.code); err.classList.remove('hidden'); btn.disabled=false; }
  });
}
```
**`printDeliveryReceipt(order)`** — clone `printPurchaseOrder`'s standalone-page skeleton
(departments.js:13648+: the `<style>` block, `.page` A4 layout, `window.open`+
`document.write` tail) with these content swaps, keeping every interpolation `esc()`d:
`buildLetterhead({ docTitle:'DELIVERY RECEIPT', docNumber: dr.no, dateLabel:'Date: '+dr.date,
extraMeta:[ 'Work Order: '+(order.orderNo||''), order.quoteRef?('Quote: '+order.quoteRef):null ].filter(Boolean),
signatures:[ {label:'Delivered by', name: dr.byName, title:'Production — Barro Industries'},
{label:'Received by (client)', name: dr.receivedBy, title: order.client||''} ],
footerNote: (window.BRAND?.fullName||'Barro Industries') + ' · Generated ' + new Date().toLocaleString('en-PH') })`;
one parties row (Deliver-to = `order.client`); one items table with columns # / Description
(`order.title`) / Qty (`order.qty`) plus the PO template's blank filler rows; a note line
rendering `dr.notes`; NO prices anywhere (a delivery receipt is not an invoice). This is the
only printable in WS28 scope — the QC Inspection report printable is deferred (data already
captured in `qc.items`).

### Spec 8 — `worker_directory` maintenance (HR save hook + one-shot sync)

**8a — HR profile save handler (departments.js:4664) — AFTER the existing set():**
```js
    await db.collection('worker_profiles').doc(profileId).set(data, { merge: true });
    // v12 WS28 — keep the public-safe roster projection in step (name/title/dept/
    // status/photo ONLY — never rates/CA/gov IDs). Best-effort: a denied projection
    // write must not fail the profile save.
    db.collection('worker_directory').doc(profileId).set({
      name: data.name, idNumber: data.idNumber||'', jobTitle: data.jobTitle||'',
      department: data.department||'', status: data.status||'active',
      photoUrl: data.photoUrl||'', updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true }).catch(()=>{});
```

**8b — one-shot backfill/prune (window-attached near the other WS27 worker helpers, ~4357):**
```js
// v12 WS28 — seed/refresh worker_directory from worker_profiles (finance/admin only;
// idempotent set-merge; prunes directory docs whose profile was deleted).
window.syncWorkerDirectory = async function(){
  const [ps, ds] = await Promise.all([
    db.collection('worker_profiles').get(),
    db.collection('worker_directory').get().catch(()=>({docs:[]}))
  ]);
  const live = new Set(ps.docs.map(d=>d.id));
  for (const d of ps.docs){ const p=d.data();
    await db.collection('worker_directory').doc(d.id).set({
      name:p.name||'', idNumber:p.idNumber||'', jobTitle:p.jobTitle||'',
      department:p.department||'', status:p.status||'active', photoUrl:p.photoUrl||'',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge:true }); }
  for (const d of ds.docs) if (!live.has(d.id)) await db.collection('worker_directory').doc(d.id).delete().catch(()=>{});
  if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('worker_directory');
  return ps.size;
};
```

**8c — button:** in `renderFinanceHRProfiles`'s `isPriv` header row (departments.js:4428-4433)
append `<button class="btn-secondary btn-sm" id="hrp-sync-dir-btn">↻ Sync Directory</button>`,
wired next to the other handlers (4468-4471):
```js
    document.getElementById('hrp-sync-dir-btn')?.addEventListener('click', async ()=>{
      Notifs.showToast('Syncing worker directory…');
      try { const n = await window.syncWorkerDirectory(); Notifs.showToast(`Directory synced — ${n} workers.`); }
      catch(ex){ Notifs.showToast('Sync failed: '+(ex.message||ex.code),'error'); }
    });
```

### Spec 9 — firestore.rules diffs (comment-then-match style, before→after)

**9a — `production_orders` (rules 964-972): scope writes + transition gates.**
```
// BEFORE
    // ── Production orders (shop-floor pipeline) ─────────
    // Internal manufacturing/work-order data. Any signed-in internal staffer can
    // read and advance an order through its stages; external partners excluded;
    // only admins delete an order outright.
    match /production_orders/{docId} {
      allow read:           if isAuth() && !isPartner();
      allow create, update: if isAuth() && !isPartner();
      allow delete:         if isAuth() && isAdmin();
    }
// AFTER
    // ── Production orders (shop-floor pipeline) ─────────
    // v12 WS28: writes scoped to the people who run the pipeline — Production
    // dept (or admins) manage orders; Sales may CREATE one (the "Job Order"
    // button on a project). Two transition gates are enforced server-side so a
    // devtools or stale-SW client can't skip them: entering Out for Delivery
    // needs a PASSED QC record; entering Delivered needs a delivery receipt.
    // Legacy pre-rename ids ('ready') are honoured in the transition checks so
    // routine edits to old docs aren't wrongly gated. Creating an order directly
    // in the last two stages is denied (only reachable through the gates).
    // Reads stay open to all internal staff (dashboards); only admins delete.
    match /production_orders/{docId} {
      allow read:   if isAuth() && !isPartner();
      allow create: if isAuth() && !isPartner() && (canProduction() || inDept('Sales'))
        && request.resource.data.get('stage','') != 'out_for_delivery'
        && request.resource.data.get('stage','') != 'delivered';
      allow update: if isAuth() && !isPartner() && canProduction()
        // QC gate — may not ENTER Out for Delivery without a passed inspection
        && ( request.resource.data.get('stage','') != 'out_for_delivery'
             || resource.data.get('stage','') in ['out_for_delivery','ready']
             || request.resource.data.get('qc', {}).get('result','') == 'passed' )
        // DR gate — may not ENTER Delivered without a delivery receipt
        && ( request.resource.data.get('stage','') != 'delivered'
             || resource.data.get('stage','') == 'delivered'
             || request.resource.data.get('deliveryReceipt', null) != null );
      allow delete: if isAuth() && isAdmin();
    }
```
(`canProduction()`/`inDept()` already exist in the helpers block — no new helper needed.
`request.resource.data` is the post-merge doc on update, so unrelated field edits — e.g. the
consume button touching a delivered order — sail through the second disjunct of each gate.)

**9b — NEW `worker_directory` block (place directly after `worker_profiles`, ~929).**
```
    // ── Worker directory (public-safe roster projection, v12 WS28) ──
    // Mirror of worker_profiles holding ONLY assignment-safe fields (name, ID
    // number, job title, dept, status, photo) so Production staff can pick
    // per-stage workers WITHOUT read access to worker_profiles (rates/CA/SSS/
    // PhilHealth/TIN stay locked to finance/admin). docId == the worker_profiles
    // docId. Maintained by the HR profile save + the Sync Directory button.
    match /worker_directory/{docId} {
      allow read:           if isAuth() && !isPartner();
      allow create, update: if isAuth() && isFinanceOrAdmin();
      allow delete:         if isAuth() && isFinanceOrAdmin();
    }
```

**9c — `_counters` (rules 154-157): widen write so Production can mint DR serials.**
```
// BEFORE
    match /_counters/{docId} {
      allow read:  if isAuth();
      allow write: if isAuth() && isFinanceOrAdmin();
    }
// AFTER
    // Widened again (WS28) so Production can mint DR-serials via nextSerial().
    // Safe per the WS27 rationale: docs here are opaque monotonic integers — the
    // worst any internal user can do is advance a sequence number.
    match /_counters/{docId} {
      allow read:  if isAuth();
      allow write: if isAuth() && !isPartner();
    }
```
`job_projects` (1034-1043) and `order_tracking` (1045-1058) blocks: **unchanged.** Deploy via
`~/.npm-global/bin/firebase deploy --only firestore:rules` — re-`git diff` first per the
concurrent-session memory.

### Spec 10 — Every other read/write site: unchanged vs must-update

| Site | Verdict |
|---|---|
| `JOB_STAGES`/`jobStage()` (12001-12010), `createJobProject` (12014), `renderProjectLifecycle` KPIs+cards (12042-12107), job-detail stepper (12116), margin/billing/invoice modals | **Unchanged** — job lifecycle untouched (D1). |
| `advanceProjectStage` (12217-12237) | **Must update** — one line (12226) → `trackerKeyFor(nextId)` (Spec 4). |
| `renderProdOrders` KPI cards (12460-12465) | **Unchanged logic** — they read `active`/`delivered`/`dueDate`, which Spec 5a normalizes upstream. |
| `orderCard` (12435-12457) | **Must update** — shim on delivered checks, workers line, QC/DR badges, QC button (Spec 5b). |
| SOP copy 12388 + pipeline caption 12468 | **Must update** — derived from `PROD_STAGES.map(...)` so they can never go stale (Spec 5c). |
| CSV export (12509-12511) | **Must update** — Workers/QC/DR columns; stage getter already shim-covered (Spec 5d). |
| `prodOrderModal` (12634-12790) | **Must update** — roster load, worker chips, stage select, save gates, stageHistory (Spec 5e). |
| `.prod-advance` handler (12522-12556) | **Must update** — full replacement (Spec 3). |
| `consumeProductionMaterials` (12567-12633) + its `po-consume` button | **Unchanged** — deliberately NOT stage-gated (WS29 sequencing). |
| `syncOrderTracking`/`ensureOrderTracking`/`makeTrackCode` (9231-9302) | **Unchanged.** |
| `t/index.html`, `track.html` | **Unchanged** — zero edits (D6). |
| `tasks` assignee picker (872-876), `renderDeptTasks` Production sub-tab | **Unchanged** — task assignment is a separate system from stage assignment. |
| `scripts/monthly-backup.js` | **Unchanged** — `worker_directory` is a root collection, auto-discovered via `listCollections()`. |
| `functions/index.js` | **Unchanged** — no hits on `production_orders` (grep-confirmed). |
| HR profile save (4664) + `renderFinanceHRProfiles` header (4428-4433) | **Must update** — projection hook + Sync Directory button (Spec 8). NOT in the brief's original files list — added here. |
| `letterhead.js` | **Unchanged** — `buildLetterhead`/`nextSerial` reused as-is. |

### Spec 11 — Migration / rollout checklist (ordered)

1. **Ship the JS first** (one commit: departments.js per Specs 1-8; `git push origin master`).
   Bump `CACHE_VER` in sw.js BY HAND (`bi-ops-v174` → next; re-check the live value first —
   concurrent sessions bump it). Verify `node --check js/departments.js` + a local boot
   (`npx serve -p 3838 .`) before pushing; no automated suite exists.
2. **No stage-data backfill.** The `normProdStageId()` shim makes every legacy doc render
   and advance correctly immediately; stored ids self-migrate on each order's next stage
   write (advance or modal save). Do NOT bulk-rewrite `production_orders.stage` — stale-SW
   clients may still write old ids for a day or two, and the shim absorbs them; a backfill
   would create nothing the shim doesn't already guarantee.
3. **Seed the roster:** Finance/admin opens Finance → HR Profiles → **↻ Sync Directory**
   (idempotent; re-run any time). Until this runs, the order modal transparently falls back
   to the legacy free-text `team` input — nothing breaks.
4. **Deploy rules AFTER the JS is live** (same day): `firebase deploy --only firestore:rules`
   (CLI at `~/.npm-global/bin/firebase`), re-`git diff`ing `firestore.rules` first per the
   concurrent-edit memory. Order rationale: deploying the rules first would let still-cached
   old JS hit the DR gate on a `ready`→`delivered` advance with no DR UI shipped to record
   one — orders would strand at dispatch for the cache window. JS-first leaves at most a
   short window where the gates are client-side only.
5. **Public tracker:** no coordinated deploy — `t/index.html` is untouched and every status
   push it receives is value-identical to today's (Spec 3 parity check).
6. **Legacy `delivered` icon note:** delivered's icon changes 🚚→✅ and `out_for_delivery`
   takes 🚚 — cosmetic only, no data impact.

### Spec 12 — Manual test checklist

1. Legacy order stored `stage:'welding'` renders in the **Assembly** bucket with Assembly
   color (not Layouting/stage-1); one stored `'ready'` renders under **Out for Delivery**;
   the Delivered collapse still lists old `'delivered'` docs.
2. Advance a legacy `'cutting'` order → doc now stores `stage:'assembly'` (self-migrated),
   `stageHistory` gained one `{stage:'assembly', enteredAt, by, byName}` entry, and
   `stageUpdatedAt` refreshed.
3. Create a new order → stage select offers only the first 5 stages; doc saves with
   `stage:'layouting'` (default) and a 1-entry `stageHistory`.
4. Press **↻ Sync Directory** as finance → `worker_directory` has one doc per worker
   profile with ONLY the six safe fields (inspect in console: no `dailyRate`, no `ssNum`).
5. As a Production-dept employee (non-admin): the order modal's worker select lists active
   workers; add 2 workers, save → `assignments.{stage}.workerIds/workerNames` arrays of 2;
   the order card shows `👷 name, name`; CSV "Workers" column shows both. Console-read
   `worker_profiles` as that user → DENIED (projection did its job).
6. Order in **Quality Checking**: press Advance → the QC modal opens instead of advancing.
   Save with one ❌ fail → `qc.result:'failed'`, card shows ❌ QC badge, Advance still
   bounces to the modal. Re-inspect all ✅/N-A (not all N/A) → `passed`; Advance now moves
   it to Out for Delivery and the linked project's public tracker shows "Ready for
   Delivery" with a fresh `stageStamps.ready` date.
7. Order in **Out for Delivery**: press Advance → DR modal opens; empty "Received by"
   blocks; filled form saves `deliveryReceipt` with a `DR-2026-…` serial; parent
   `job_projects.documents` gained a `Delivery Receipt` register row; press Advance again →
   Delivered; tracker shows "Delivered / Completed"; 🖨 Print produces a letterhead A4 DR
   with both signature blocks and NO peso amounts.
8. Rules (devtools, as a Production-dept employee): `update({stage:'delivered'})` on an
   out_for_delivery order with NO `deliveryReceipt` → DENIED; same write after recording a
   DR → allowed. `update({stage:'out_for_delivery'})` on a finishing-stage order without
   `qc.result=='passed'` → DENIED. As a Marketing-dept employee: any `production_orders`
   update → DENIED (write scoping). As a Sales-dept employee: `create` with
   `stage:'layouting'` → allowed; `create` with `stage:'delivered'` → DENIED.
9. Edit-modal save of a legacy `'ready'` order (changing only notes) → succeeds (the
   `in ['out_for_delivery','ready']` legacy alias in the QC gate lets it through) and
   rewrites `stage:'out_for_delivery'`.
10. Consume materials on a Layouting-stage order → still works exactly as before (no stage
    coupling); the WS29 surface is untouched.
11. Open a client's existing tracking link → page renders identically to pre-deploy (same
    5 steps, same current position).
12. Job-projects screen and job-detail stepper (Sales/Finance view) → identical to
    pre-deploy; "Advance → In Production" etc. still pushes the tracker (map-swap parity).

## Risks / cross-workstream interactions

- ⚠️ The public order tracker (`t/index.html`) is reached via links already handed to real
  clients (per the order-tracking-public-link memory precedent) and is driven by THREE
  separate hand-maintained translation layers (departments.js:12226, 12536+12549, plus
  t/index.html's own STAGES list) rather than reading `production_orders`/`job_projects`
  directly — a rename that updates the stage enums but misses updating all three will not
  crash or error; it will silently stop advancing some or all clients' tracking pages,
  which is a worse failure mode than a loud break because nobody will notice until a client
  complains their tracker "looks stuck."
- ⚠️ Cross-workstream interaction with 29 (Inventory correctness): `consumeProductionMaterials`
  (departments.js:12567-12633) posts ledger COS/contra entries and decrements
  `inventory_items.qty` at whatever moment "📦 Consume → stock & COS" is clicked — today that
  is fully decoupled from the stage-advance button (an order can reach `delivered` having
  never consumed materials, or consume materials while still `queued`). If WS28's new stage
  model or QC/delivery gate ties material consumption to a specific stage transition (e.g.
  "must consume before Assembly"), that changes WHEN this WS29-owned costing logic fires,
  which WS29's "moving weighted-average cost on receive" rework needs to be sequenced around.
- ⚠️ Cross-workstream interaction with 30 (Purchasing): production draws its material pool
  from the same `inventory_items` collection that Purchasing's receiving flow stocks; no
  direct code coupling exists today beyond that shared collection, but a "per-stage worker
  assignment" or QC feature that starts tracking material lot/batch numbers per stage would
  newly couple the two workstreams.
- ⚠️ Cross-workstream interaction with 35 (Design dept suite): the plan names a "design →
  production handoff" as in-scope for WS35, but grepping "handoff" across every js/*.js file
  turns up only prose UI copy ("Handoff to Production / Fulfillment", departments.js:5960;
  "hand off to Production", departments.js:9400) and code comments — ZERO functions actually
  link the Design department's separate `projects` collection (a different board, explicitly
  named to avoid clashing with `job_projects` per the comment at departments.js:11998-12000)
  to `job_projects`/`production_orders`. WS28 should not assume any such handoff mechanism
  exists yet to hook a "Layouting" first-stage entry point into.
- ⚠️ WS27 (IDs) already established a real split between two "worker" identities in this
  codebase — `users/{uid}` employees (with `department`/`departments` array membership) and
  `worker_profiles/{docId}` no-login production/hourly workers (a separate collection, no
  `auth.uid`, per WS27's own brief) — plus WS26 (Attendance v2, DECIDED) built a THIRD
  worker-adjacent path, `attendance_worker/{workerProfileId}/records/{date}`, keyed by
  `worker_profiles` doc id. "Per-stage worker assignment" for WS28 must pick which of these
  (or a new fourth shape) it assigns to a production stage — reusing the wrong one risks
  re-creating the exact "two sources of truth for the same person" problem WS27 already
  flagged and partially bridged with an optional `linkedUserId`.
- ⚠️ `production_orders` write access has no rules-level department scoping at all (any
  signed-in non-partner user may create/update any order — firestore.rules:964-972); adding
  operationally-significant new fields (who worked a stage, whether QC passed, whether a
  delivery receipt exists) onto a collection with that permissive a rule means any employee,
  regardless of role or department, could currently falsify any of those new fields via
  devtools unless the rule is tightened alongside the schema change.
- ⚠️ The three duplicated stage-id literals already show real drift (the dead `qc`/`ready`
  keys in the `advanceProjectStage` translation map, departments.js:12226, which can never
  match because `nextId` there is always a `JOB_STAGES` id) — this is direct evidence that
  hand-copied translation maps in this codebase drift out of sync with each other over time
  even without a deliberate rename; a stage-rename workstream is exactly the kind of change
  likely to widen that drift further unless the maps are consolidated.

## Files likely touched

`js/departments.js` — `PROD_STAGES` + `prodStage()` (11983-11993), `JOB_STAGES` +
`jobStage()` + `_isFinAdmin()` (12001-12011), `createJobProject` (12014-12041),
`window.renderProjectLifecycle` (12042-12107), `openJobProjectDetail` (12108-12167,
includes the stage stepper UI at 12116), `openProjectMarginModal` (12168-12216),
`advanceProjectStage` incl. its `_trkStage` translation map (12217-12237, map at 12226),
`openProjectBillingModal` (12238-12312), `openJobBillingInvoiceModal` (12313-12376),
`window.renderProductionDept` (12377-12397), `loadProdContent` (12398-12408),
`renderProdOrders` incl. the pipeline-copy strings (12388, 12468), the CSV export getter
(12511), and the advance handler with its two translation maps (12409-12566, maps at
12536 and 12549), `consumeProductionMaterials` (12567-12633), `prodOrderModal` incl. the
stage `<select>` (12634-12790, options built at 12674), `window.syncOrderTracking`
(9268-9282), `window.ensureOrderTracking` (9283-9302), `window.makeTrackCode`/
`uniqueTrackCode` (9231-9246), the `tasks.assignedTo` precedent (338-339, 872-876,
919, 1201-1202) if reused for worker assignment, `renderFileCollection`/
`bindFileCollection` (11379-11444) if reused for a delivery-receipt upload gate.
`t/index.html` — the public tracker's own `STAGES` array and rendering (119-125,
143-204) if the client-facing vocabulary changes. `track.html` — legacy redirect only,
unlikely to need edits. `firestore.rules` — `production_orders` (964-972), `job_projects`
(1034-1043), `order_tracking` (1045-1058), plus any new match block for a
`stageHistory`/`qc_checklists`/`delivery_receipts` collection. `sw.js` — `CACHE_VER`
(line 11, currently `bi-ops-v173`), manual bump required. `scripts/monthly-backup.js` —
no change needed if a new collection is a ROOT collection (auto-discovered via
`db.listCollections()` per the comment at departments.js:11395); would need an explicit
entry only if nested as a subcollection under an existing doc.

## Expected deliverable format

A numbered build spec Sonnet can execute without further judgment calls: one, the exact
decision for each open decision above stated as a one-line policy (which enum(s) get
renamed; the full old-id → new-id mapping table, explicit about any stage that's added,
removed, or merged; the structural shape of stageHistory/worker-assignment, named field by
field; the mechanical meaning of the delivery-receipt gate; the structural shape of the QC
checklist; whether/how the public tracker's vocabulary changes; whether the three
translation maps get unified). Two, the exact new/changed Firestore document shape for
`production_orders` (and `job_projects` if its enum is also touched) — every field name,
type, and default — plus a literal `firestore.rules` diff in the same comment-then-match
style as the existing blocks quoted above, for every collection touched, explicit about
whether `production_orders`' currently wide-open write rule gets scoped. Three, exact
function-level before/after code blocks anchored to the file:line citations in this brief
(e.g. "departments.js:12524-12563, the `.prod-advance` handler — BEFORE/AFTER" and
"departments.js:12217-12237, `advanceProjectStage` — BEFORE/AFTER"), covering at minimum:
the `PROD_STAGES`/`JOB_STAGES` array literals, the stage-advance handlers, all three
stage→tracker translation maps (12226, 12536, 12549) collapsed into whatever the DECIDED
approach is, the hardcoded pipeline-copy strings (12388, 12468) kept in sync with the new
array, the CSV export getter (12511), and the new worker-assignment/stageHistory-write
logic wherever it's added. Four, a numbered migration checklist covering, in order: how the
legacy→new stage mapping gets applied to EXISTING `production_orders`/`job_projects` docs
(a one-time backfill script/button in the style of this repo's `runAnnualAccrual`/
`backfillPayrollLedger` precedents, vs. a live-translate-on-read shim) so no in-flight order
silently resets to stage-1 per the fallback behavior documented above; whether/how the rules
deploy (`firebase deploy --only firestore:rules`, separate from `git push` per CLAUDE.md)
is sequenced before or after the JS ships; and whether the public tracker needs a
coordinated relabel deploy or can lag safely. Five, explicit call-outs of every OTHER
existing read site enumerated in this brief's Current State/Files sections (the CSV export,
the KPI cards, the two Job/Prod dashboards) with a one-line "unchanged" or "must update
because ___" note apiece, so nothing is silently missed. Six, an explicit note on
sequencing against WS29 (Inventory), WS30 (Purchasing), and WS35 (Design), per the Risks
section, so Sonnet does not build a stage-gated material-consumption rule that WS29 is about
to replace, or assume a Design→Production handoff exists when none does yet.
