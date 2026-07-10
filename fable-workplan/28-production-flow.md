# Workstream 28 — Production process flow (stage rename, worker assignment, QC, delivery receipt)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

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

## Open decisions

1. [ ] **Which enum does the owner's 6-stage flow actually rename** — `PROD_STAGES`
   (production_orders' shop-floor pipeline, the closer conceptual match) — or `JOB_STAGES`
   (job_projects' sales-to-payment lifecycle) — or both, with `JOB_STAGES` correspondingly
   collapsed/relabeled? Current `PROD_STAGES` ids (8): `queued, cutting, welding, assembly,
   finishing, qc, ready, delivered`. Current `JOB_STAGES` ids (7): `won, in_production,
   for_delivery, delivered, completed, paid, cancelled`. The owner's named target (6):
   `Layouting, Bending & Cutting, Assembly, Finishing & Polishing, Quality Checking, Out for
   Delivery`.
2. [ ] **Exact legacy→new stage mapping table** for whichever enum(s) are renamed, so every
   existing in-flight `production_orders`/`job_projects` doc's stored (old) `stage` string
   resolves to a specific new value rather than falling back to stage-1 (see Constraints).
   In particular: does `queued` become `layouting`, or does `layouting` become a genuinely
   NEW first stage inserted before today's `queued`? Do `cutting` and `welding` both collapse
   into a single `bending_cutting`, or does `welding` fold into `assembly` instead? Does
   `ready` disappear entirely (folded into `for_delivery`/"Out for Delivery"), or survive as
   a distinct pre-delivery state the new 6-stage list doesn't name?
3. [ ] **Where per-stage worker assignment + `stageHistory` timestamps live, structurally** —
   a `stageHistory` array field on the `production_orders` doc itself (parallel to
   `job_projects.timeline`'s existing append-via-`arrayUnion` precedent, departments.js:12223)
   with entries like `{stage, enteredAt, workerId(s), workerName(s), exitedAt}`? A new
   subcollection `production_orders/{id}/stage_log/{autoId}` (needing its own rules block)?
   Or a map keyed by stage id (mirroring `order_tracking.stageStamps`'s existing deep-merge
   pattern, departments.js:9271-9275)? And separately: is "worker" a `users/{uid}` employee
   (reusing the generic `tasks.assignedTo` uid-array precedent, departments.js:338-339) or a
   `worker_profiles/{docId}` production/hourly worker (WS27's separate no-login worker
   identity, which as WS27's own brief notes has "no auth.uid" and would need a different
   picker entirely — the tasks assignee picker at departments.js:872-876 queries ALL `users`
   docs unfiltered by department, so neither a Production-scoped nor a worker_profiles-scoped
   picker exists to copy from today)? Could a single order need MULTIPLE workers per stage
   (e.g. a 2-person cutting team), and does replacing today's single free-text `team` field
   (departments.js:12706) need a backward-compat read path for existing orders that only have
   `team` set?
4. [ ] **What "delivery step requires a delivery receipt" means mechanically** — does
   advancing a `production_orders` doc INTO the final "Out for Delivery" stage (or a
   post-delivery "Delivered" confirmation) get BLOCKED client-side (and/or rules-side) until
   some receipt artifact exists? Is that artifact (a) a new upload reusing the existing
   generic `files_{id}` collection pattern (departments.js:11379-11444, e.g. a
   `files_production_orders_{orderId}` bucket or a dedicated `delivery_receipts` collection),
   (b) a structured signature/acknowledgment record (client name + signature + date, no file
   at all), or (c) a new printable DOCUMENT (per V12-PLAN.md's Sales printables row, "Delivery
   Receipt" is listed under Sales, not Production — is the printable-generation half of this
   even in scope for WS28, or does it belong entirely to WS14/the letterhead engine, with 28
   only adding the "requires a receipt to exist" gate)? Given zero existing code precedent
   for any delivery-receipt concept (grep-confirmed above), this is fully greenfield.
5. [ ] **What a QC checklist is, structurally** — a fixed, hardcoded list of check items
   (like `PROD_STAGES`/`LEAVE_TYPES` are hardcoded JS constants elsewhere in this codebase),
   or admin-configurable (stored in a `settings/*` doc or new collection, mirroring WS26's
   `settings_holidays/{year}` override precedent)? Per-product-type checklists (a steel
   worktable vs. a kitchen cabinet might have different QC items) or one universal list? Does
   a checklist item need pass/fail/N-A per item, a photo attachment per item, or just a single
   "QC passed" boolean/signoff? Zero existing checklist UI pattern exists anywhere in this
   repo to extend (grep-confirmed) — this is a genuinely new UI primitive, not a rename of an
   existing one.
6. [ ] **Does the public tracker's stage vocabulary/labels need to change** — today's 5 public
   keys (`confirmed, production, qc, ready, delivered`, t/index.html:119-125) already have a
   `qc` entry ("Quality Check") and a `ready` entry ("Ready for Delivery") that roughly
   pre-figure two of the owner's 6 named stages; does the rename leave the client-facing
   vocabulary as-is (since it's already decoupled per Constraints), or does the public page
   also get relabeled/expanded to more granularly reflect Layouting/Bending & Cutting/
   Finishing & Polishing rather than bucketing them all under the single "In Production" step?
7. [ ] **Do the THREE internal stage→tracker translation maps get unified into one shared
   function, or updated independently in place** (departments.js:12226, 12536, 12549)? Given
   they're already drifting (dead `qc`/`ready` keys in the 12226 map, see Current State), an
   in-place edit risks the drift getting worse; a single shared translator is the more
   robust option but is a real design choice, not a fact.
8. [ ] **firestore.rules changes needed** — does the rename/new-fields work require tightening
   `production_orders`' currently-wide-open write rule (any non-partner authenticated user,
   firestore.rules:964-972) to scope worker-assignment/QC/delivery-receipt writes to
   Production-dept membership or an admin tier, given these new fields carry more operational
   weight (who did the work, whether QC passed, whether a client received their order) than
   the existing free-text fields? Does a new `stageHistory` subcollection/collection or a new
   `qc_checklists`/`delivery_receipts` collection need its own match block, and with what
   read/write tiers (all internal non-partner staff, like today's `production_orders`, or
   narrower)?

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
