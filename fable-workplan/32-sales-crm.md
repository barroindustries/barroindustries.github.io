# Workstream 32 — Sales Client Relations hub (per-client timeline, CRM stages, win-rate analytics)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

All line numbers verified live via grep/Read against the current checkout (no fable-workplan
grounding brief exists yet for any Phase 4 workstream — 28-40 are all still `[ ]` in
V12-PLAN.md; this is the first Phase 4 recon). V12-PLAN.md:197-198 mandate: "Sales — Client
Relations hub — per-client timeline (quotes, orders, payments, files, follow-ups in one view);
CRM stages rolled into win-rate analytics."

1) THREE CLIENT COLLECTIONS, but really TWO independent UI implementations, one of which
ignores its own collection. `sales_clients` (Sales/Barro Kitchens), `design_clients` (Design
dept), `bs_clients` (Brilliant Steel) are all fetched through one shared function,
`renderClientProfiles(container, currentUser, currentRole, brand)` (js/departments.js:11084-
11208), which picks the collection at departments.js:11085 (`brand==='brilliant-steel'
?'bs_clients':(brand==='design'?'design_clients':'sales_clients')`). It is called for
brand='barro' from Sales → Clients (`loadSalesContent`'s `case 'Clients'`, departments.js:5525-
5526) and brand='design' from Design → Clients (departments.js:6810). **It is never called
with brand='brilliant-steel' anywhere in the app** (grep-confirmed — the only reference to that
brand string is the collection-name ternary itself). Brilliant Steel's actual "Client Data" tab
(`window.renderBrilliantSteel`, departments.js:8355-8386, tab list at 8357, nav route
`bs-clients`→app.js:2012) instead calls a completely separate function, `renderBSClientData`
(departments.js:9750-9865), which does NOT read the `bs_clients` collection at all — it derives
synthetic "clients" purely by grouping `bs_quotes` docs by `(q.clientName||'').trim()
.toLowerCase()` (departments.js:9760-9786) into an accordion-card UI (9800-9843) with search
only: no CRM stage, no follow-up date, no notes, no delete-request flow, no activity timeline.
So `bs_clients`-the-collection is written (auto-upsert on quote filed, see point 3) and read
only by the global-search index (modules.js:2498) and the delete-request queue (departments.js:
10095/10175/10454) — its own department's screen never shows the CRM-stage/follow-up/notes data
that lives on it. Any "unify the client model" decision must explicitly resolve this orphan,
not just assume `renderClientProfiles` is already the universal view.

2) CRM_STAGES already exists as a shared taxonomy — lead/prospect/won/lost, with color/icon,
at departments.js:11075-11082 (`crmStageOf(cl)` defaults to 'lead' for any missing/invalid
`cl.stage`; `crmStageMeta(k)`). `renderClientProfiles` renders a chip-tab filter over these
stages (departments.js:11100, 11196), a per-client stage badge (11117), a "Stage" `<select>` in
the Add/Edit Client form (11146), and a "N follow-ups due" banner computed as `clients.filter(c
=>c.followUpDate && c.followUpDate<=today && isOpen(c))` where `isOpen` excludes won/lost
(11096-11097, 11103). This is real, working CRM-stage UI — it is NOT missing, it is simply not
connected to the win-rate number in Analytics (point 5) and not available for `bs_clients`
(point 1) or reflected anywhere in a cross-collection roll-up.

3) CLIENT ↔ QUOTE JOIN HAS NO STABLE FOREIGN KEY — every join anywhere in the codebase matches
on the free-text `clientName` string (trimmed, and usually lower-cased). The auto-upsert that
creates/updates a client record when a quote is filed lives inside the quote-builder's
`postMessage` bridge (`window.addEventListener('message', ...)`, app.js:8127 on; the
`upsertClient` closure at app.js:8196-8209, called from the `QUOTE_FILED` branch at app.js:8211-
8216): it picks `clientColl = (data.company==='BK')?'sales_clients':'bs_clients'` (app.js:8197,
so a `bs_clients` doc is created for ANY non-BK company, not just Brilliant Steel — Design has
no equivalent auto-upsert, `design_clients` rows are 100% manually entered via "+ Add Client"),
finds an "existing" client by
`((d.data().name||'').trim().toLowerCase())===name.toLowerCase()` (8202), and `set(...,{merge:
true})`s `name/company/phone/email/address/lastQuoteNumber/lastQuoteTotal/updatedAt` — note this
upsert never writes `stage` or `followUpDate`, so an auto-created client always starts at the
default 'lead' stage until a human edits it. The client-detail modal, `openClientQuotesModal`
(departments.js:11210-11298), queries `db.collection(quoteColl).where('clientName','==',cl
.name)` (11222, exact-match, case-sensitive) and falls back to a client-side case-insensitive
scan of the most recent 200 quotes if that returns nothing (11227-11235). `quoteColl` itself is
`brand==='brilliant-steel'?'bs_quotes':'bk_quotes'` (departments.js:11090) — for brand='design'
this defaults to `'bk_quotes'`, which has no evident connection to Design's own client book (no
`quotes` field on design_clients docs, Design doesn't file bk_quotes/bs_quotes). A client
renamed via the Edit Client form (departments.js:11152-11170) does not retroactively update
`clientName` on any past quote/order/project row. Renaming, or a typo on a new quote, silently
produces an orphaned quote or a duplicate client rather than a join failure that's visible
anywhere.

4) THE PIECES OF A "PER-CLIENT TIMELINE" MOSTLY ALREADY EXIST, scattered and never jointly
read. Quotes: `bk_quotes`/`bs_quotes` (+ legacy `quotes`), unified only by `getAllQuotes()`
(app.js:2048-2060, self-caches under key `'all-quotes'`, 30s TTL, merges all three collections)
— used by dashboards/Analytics but NOT by `openClientQuotesModal`, which queries the two brand
collections directly and bypasses this cache entirely. Orders: `sales_orders/{id}`, created by
`openSalesOrderModal` (departments.js:9306-9384) when a quote is marked won — one doc per quote-
turned-order, linked via `quoteId`/`quoteNumber`/`projectId`; the win transitions the quote to
`status:'won'` and stamps `salesOrderId`+`projectId` back onto it (9345), and creates a parallel
`job_projects` doc as "the spine that ties the whole job together" (9332, `createJobProject`).
Payments: **there is no dedicated `payments` collection anywhere in this repo** (grepped `.
collection('payments'` — zero hits). What exists instead is `job_projects/{id}.payments`, an
array field `arrayUnion`'d by Finance's "record sale" handler inside `renderSalesOrders`
(departments.js:9525-9578): each entry is `{type:'Sales Order Payment', amount, vatAmount, net,
method, orRef, date, by, ledgerId}` (9564). The same handler also `arrayUnion`s a `timeline[]`
entry (`{at, event, by}`, e.g. 9566 "Sale recorded ₱X by Finance", 9590 "Moved to In
Production") and a `documents[]` entry (`{type, ref, at, by}`, e.g. 9565 "Official Receipt",
9348 "Sales Order") onto the SAME `job_projects` doc. **A real per-project activity log and
payment history already exist in the data model today — they are just never read by any
client-facing screen**; the client-detail modal (`openClientQuotesModal`) builds its own,
separate, quotes-only "Activity" feed (departments.js:11250-11255) from `cl.createdAt`/`cl
.lastContact` plus matched quotes, and never touches `job_projects`, `sales_orders`, or the
ledger at all. Ledger: Finance's record-sale handler also posts one `ledger` row per sales order
(departments.js:9549, `category:'Sales Revenue'`, idempotency key `refNumber:'SO-'+o.id` checked
at 9543-9545) carrying `projectId` but not a `clientName`/`clientId` field — joinable to a
project, not efficiently queryable by client. Files: uploads live in per-department/per-
subfolder root collections named `files_{id}` (`bindFileCollection`, departments.js:11392 on;
collection name computed as `` `files_${id.replace(/-/g,'_')}` ``) with fields `name/url
/uploadedByName/createdAt/deleteRequested` — **no client or project linkage field exists on a
file doc anywhere**; there is no way today to see "all files for Client X." Follow-ups: a single
scalar `followUpDate` on the client doc (set via the Edit Client form) — no history of past
follow-ups, no "mark done / schedule next" action, and no reminder wired into `js/
notifications.js` (grepped — that file's only date-driven reminders are task-deadline pushes,
nothing keyed on `followUpDate`); the only surfacing is the client-list "due" banner
(departments.js:11097/11103) and one Analytics due-count (app.js:6540).

5) WIN-RATE AND CRM STAGE ARE TWO DISCONNECTED NUMBERS IN THE SAME ANALYTICS SCREEN.
`renderAnalytics`'s Sales subtab (`renderSales`, app.js:6521-6579, reached via the `'sales'`
entry in `SUBTABS`, app.js:6421) computes `winRate = wonCount/(wonCount+lostCount)*100`
(app.js:6523-6527) purely from **quote status** (`accepted`/`rejected` — quotes have no CRM-
stage field at all). Nine lines later, a separate "CRM Pipeline" card (app.js:6534-6556) buckets
`salesClients` — fetched ONLY from `sales_clients` (app.js:6370; `bs_clients`/`design_clients`
are never fetched by Analytics, grep-confirmed) — by `cl.stage` using an inline re-declaration
of the same lead/prospect/won/lost taxonomy (`CRMP`, app.js:6535, a literal duplicate of
`CRM_STAGES` at departments.js:11075-11082 rather than a shared reference). **These two cards
sit side by side in the same subtab and read entirely different source collections; neither
feeds the other.** This is the exact gap V12-PLAN's phrase "CRM stages rolled into win-rate
analytics" names. Separately, `openClientQuotesModal` already computes a per-client
proxy-win-rate of its own (`totalQuoted` vs `wonVal`, departments.js:11248-11249/11269-11273,
where `wonVal` counts a quote as won if it has a `salesOrderId` OR `status` in
`['won','filed','approved','accepted']`) — a THIRD, independently-defined notion of "won,"
disagreeing with both the Analytics quote-status calc and the client-stage calc.

6) `window.Projects` (departments.js:55-97, built for WS16 perf) is the closest existing
precedent for a cross-collection client/project roll-up and a strong structural template to
reuse or extend: `normalize(doc,kind)` merges `job_projects`+`projects` (Design board) into one
canonical shape `{id,kind,no,name,clientName,contractAmount,collected,arBalance,stage,payments,
invoices,jobProjectId,partnerUid,createdAt,raw}` (57-77, `collected` falls back to summing the
`payments[]` array via `sumPayments`, line 56); `listAll(scope)` self-caches under
`'projects-unified'` (30s TTL) and deliberately bypasses the cache for partner-scoped reads
(93-94, comment: avoid cross-tenant leakage). It is already used by `renderAnalytics` (app.js:
6386-6388, `allProjects`) for the Top-Clients-by-Revenue and Receivables cards — i.e. Analytics
ALREADY partially serves a "client roll-up" need through this project-shaped unifier, joined to
`clientName` the same fragile way as everything else. It does not touch quotes, sales_orders, or
any of the three client collections.

7) A THIRD, older order/deal shape, `partner_deals`, is still actively written (app.js:3958, the
Partners department's 50/50 profit-split payout flow) and merged read-only into
`renderPartnerProjects` (app.js:2095-2122; comment at app.js:2255: "legacy partner_deals are
merged in so older records still show") — yet another "order" concept for a partner-attached
client, disconnected from `sales_orders`/`job_projects`/`bs_clients` entirely (grep-confirmed no
`clientId`/cross-reference between `partner_deals` and any client collection).

8) firestore.rules for the three client collections (1121-1123) are uniform and looser than the
UI: `sales_clients`/`design_clients` — read: any authenticated non-partner; create/update: **any
authenticated user**, no role or department check, no field-shape validation; delete: admin
only. `bs_clients` — read: **any authenticated user including partners** (so any Brilliant Steel
partner can read the ENTIRE `bs_clients` book, not just their own clients — unlike `bs_quotes`/
`sales_orders`/`job_projects`, which all scope partner reads to `createdBy==uid`/`partnerUid==
uid`, firestore.rules:564-566/1026-1028/1039); create/update: any authenticated user; delete:
admin only. The UI-side gate (`canAdd` in `renderClientProfiles`, departments.js:11088:
`currentRole==='president'||'owner'||'manager'||'agent'`) is a **flat role check**, not
`canEditDept('Sales')`/`canEditDept('Design')` — the CLAUDE.md-documented department-gating
convention this repo otherwise follows. Because the same function and role list serve both
brand='barro' and brand='design', a Sales Agent can edit the Design client book and vice versa
is only prevented by nav visibility, not a permission check.

9) V12-PLAN.md's sibling WS31 bullet (line 191-196, "Quotation builder v3") states the
quote→approval→order chain still has known breakage — "repair the quote→approval→order chain
(BK quotes stranded in bs_quotes; Finance's empty list; Approvals approving without filing)."
Current code at app.js:8183 does correctly route `company==='BK'` quotes to `bk_quotes`, so if
the "BK quotes stranded in bs_quotes" bug is still live it must be in a different code path not
covered by this grep pass — Fable should re-verify rather than assume the pipeline is already
clean before building a client timeline on top of it. Separately, that same WS31 bullet
parenthetically claims "client-# auto (done in P1)" — grep of `clientNumber`/`clientNo` across
every `js/*.js` file returns **zero hits**; this claim could not be verified against current
code and may be stale, or may refer to quote-number sequencing rather than a client identifier.

10) Caching: WS16 (perf) already established canonical `dbCachedGet` keys for these exact three
collections — `modules.js:2495-2498` (global search) reads `sales_clients`/`design_clients`/
`bs_clients` each cached 60s, and `renderAnalytics` reads `sales_clients` cached 60s (app.js:
6370, key `'sales_clients'`). **`renderClientProfiles` (departments.js:11086) and
`renderBSClientData` (departments.js:9755-9756) both bypass this and issue raw, uncached `.get()
`/`.orderBy().get()` calls** on every open of the Clients tab. Any heavier per-client-timeline
read (quotes + orders + projects + ledger + files in one modal) risks reintroducing exactly the
"re-read the same heavy collections on every visit" problem WS16 was built to fix, unless it
deliberately reuses the existing cached fetches (`getAllQuotes`, `window.Projects.listAll`,
`dbCachedGet('sales_clients',…)`) instead of adding fresh uncached queries.

## Data model

`sales_clients/{id}`, `design_clients/{id}`, `bs_clients/{id}` — top-level collections, same
shape, selected by brand as in point 1: `name` (string, required), `company`, `email`, `phone`,
`address`, `notes` (strings, optional), `stage` (one of lead/prospect/won/lost; `crmStageOf`
treats anything else, including absent, as 'lead'), `followUpDate` (YYYY-MM-DD string or `''`),
`lastContact` (YYYY-MM-DD string, set to `today()` on every manual save). Two divergent write
paths produce divergent field sets: the manual Add/Edit Client form (departments.js:11152-
11170) writes `name/company/email/phone/address/notes/stage/followUpDate/lastContact` plus
`addedBy`+`createdAt` only on first create; the quote-filed auto-upsert (app.js:8196-8209) writes
`name/company/phone/email/address/lastQuoteNumber/lastQuoteTotal/updatedAt` plus `createdAt`+
`createdBy` only on first create — it never touches `stage`/`followUpDate`/`notes`. Soft-delete-
request fields (`deleteRequested` bool, `deleteReason`, `deleteRequestedBy`,
`deleteRequestedAt`) are set by `renderClientProfiles`'s delete-request flow (departments.js:
11185-11192) for non-admin roles; admin roles (`canDeleteDirect`) hard-delete instead
(11180-11184).

`bk_quotes/{id}`, `bs_quotes/{id}`, legacy `quotes/{id}` — fields relevant here: `clientName`,
`clientCompany`, `clientAddress`, `clientPhone`/`clientContact`, `clientEmail`, `clientTin`,
`quoteNumber`, `total`/`grandTotal`, `status` (draft/sent/accepted/rejected on legacy `quotes`;
filed/pending_approval/pending_review/needs_revision/rejected/won on bs_quotes, see
`statusBadge` maps at departments.js:11242 and 9829), `salesOrderId` (set once won),
`projectId`, `createdBy`/`createdByName`/`agentName`, `createdAt`, `editableState` (full
re-openable snapshot), `version`/`fileName` (re-file versioning). No `clientId` field on any
quote doc anywhere.

`sales_orders/{id}` — created by `openSalesOrderModal` (departments.js:9334-9342): `projectId`,
`quoteId`, `quoteNumber`, `clientName`, `company`, `project` (free-text scope), `contractAmount`,
`paymentReceived` (the downpayment captured at order creation), `paymentMethod`, `notes`,
`receiptUrl`/`receiptName`, `status` (`'pending'`→`'recorded'`), `createdBy`/`createdByName`,
`createdAt`, `trackingToken` (public order-tracking link id), `recordedAmount`/`recordedAt`/
`recordedBy` (set once Finance verifies via `renderSalesOrders`'s record handler, departments
.js:9554), `sentToProduction`/`sentToProductionAt` (departments.js:9593). One `sales_orders` doc
per won quote; no `clientId`.

`job_projects/{id}` (fields relevant to a client timeline) — `clientName`, `projectNo`, `stage`,
`contractAmount`, `amountCollected`, `arBalance`, `partnerUid`, `createdBy`, `salesOrderId`,
`trackingToken`, and three array fields accumulated via `FieldValue.arrayUnion` on Finance's
record-sale action: `payments[]` (each `{type, amount, vatAmount, net, method, orRef, date, by,
ledgerId}`, departments.js:9564), `documents[]` (each `{type, ref, at, by}`, departments.js:9565/
9348), `timeline[]` (each `{at, event, by}`, departments.js:9566/9590). This is the richest
existing per-job activity log in the repo and is not read by any client-facing screen today.

`ledger/{id}` (sales-order-sourced rows only) — `date`, `description` (free text embedding the
client name), `category:'Sales Revenue'`, `accountType:'income'`, `account`, `type:'credit'`,
`amount`, `net`, `vatAmount`, `vatTreatment`, `refNumber` (`'SO-'+orderId`, the idempotency key
checked at departments.js:9544), `source:'Finance'`, `projectId`, `addedBy`/`addedByName`,
`createdAt`. No `clientId`/`clientName` field — only joinable via `projectId` or a text scan of
`description`.

`files_{subfolder}/{id}` (e.g. `files_bs_files`, `files_design_files`) — `name`, `url`,
`uploadedByName`, `createdAt`, `deleteRequested`. No client or project reference field exists on
any file doc in the repo.

`partner_deals/{id}` (legacy, still written) — `partnerUid`, `clientName`, `totalContractValue`,
`costAmount`, `status` (pending/completed/paid), `createdAt`, `paidOutDate`. Disconnected from
`sales_orders`/`job_projects`/`bs_clients`.

`window.Projects.normalize(doc,kind)` (departments.js:59-78, not a Firestore collection — a
client-side read-time shape) — `{id, kind, no, name, clientName, contractAmount, collected,
arBalance, stage, payments, invoices, jobProjectId, partnerUid, createdAt, raw}`, merging
`job_projects` (kind='job') and `projects`/Design-board (kind='design').

## Constraints — must respect

- `escHtml()` before any innerHTML interpolation of client-controlled fields (name, company,
  notes, address, etc.) — already followed throughout `renderClientProfiles`/
  `openClientQuotesModal`/`renderBSClientData`; any new unified view must keep it.
- Manila-time discipline: `today()`/`bizDate()` for all date logic (follow-up due-dates, "last
  contact"), never raw `new Date().toISOString()` — already followed in the existing client
  code (departments.js:11092, 11163); a prior raw-UTC bug in this exact area broke attendance
  and payroll per the manila-time-helpers memory.
- Firestore rules coverage does not cascade or match by prefix (firestore-rules-collection-
  coverage memory) — any brand-new collection (a client-activity log, a follow-up history, a
  clientId-bearing join table) needs its own explicit `match` block or reads silently deny.
- Rules must read fields via `.get(field, default)`, never bare field access, or a doc missing
  that field denies the whole rule (firestore-rules-missing-field-throws memory) — directly
  relevant here since the two existing write paths into the client collections already produce
  docs with inconsistent field sets (point/Data-model above): a stricter shape-validated rule
  must tolerate a doc with no `stage`/`followUpDate` at all.
- `CACHE_VER` in `sw.js` must be hand-bumped on any JS/CSS edit (the pre-commit hook only auto-
  bumps `APP_VERSION` in config.js/index.html, per CLAUDE.md — it does NOT touch `CACHE_VER`).
- Script load order is fixed (config.js → drive.js → notifications.js → departments.js →
  app.js → modules.js) — a new shared client-unifier helper analogous to `window.Projects`
  must be defined in a file that loads before every caller, or attached to `window` before
  first use.
- WS16's cache-key convention: `sales_clients`/`design_clients`/`bs_clients` already have
  canonical `dbCachedGet` keys in use elsewhere (modules.js:2495-2498, app.js:6370) — a rework
  of the client screens should decide deliberately whether to adopt these keys (consistency,
  fewer reads) or intentionally stay live/uncached (edits need to feel instant), not silently
  do neither like the current two implementations.
- Partner data isolation precedent: `bs_quotes`/`sales_orders`/`job_projects` rules already
  scope a partner's reads to `createdBy==uid`/`partnerUid==uid`; `order_tracking`'s public rows
  are deliberately restricted to "client-safe fields only... never internal cost/margin"
  (firestore.rules:1049-1051 comment) — a partner-facing client hub must follow the same
  discipline, and must NOT simply inherit `bs_clients`'s current any-authenticated-partner-can-
  read-everything rule (point 8) into a richer, more data-dense view without a deliberate
  decision to do so.
- Existing client soft-delete-request flow (departments.js:11185-11192, notifies the president
  via `Notifs.sendToOwner`) is a parallel, client-specific pattern to the repo's general
  `window.financeDelete`-routes-through-president-approval convention (finance-delete-approval
  memory) — a unified hub should keep this working (or make a deliberate decision to
  consolidate it into the general flow) rather than silently dropping it.
- `canEditDept(dept)` is the repo's documented convention for department-scoped write gating
  (CLAUDE.md) — the existing `canAdd` flat-role check in `renderClientProfiles` (departments.js:
  11088) does not follow it; any rework should decide whether to fix this or intentionally
  preserve today's behavior (Sales Agents can edit the Design client book).

## Open decisions

1. Keep three separate client collections (`sales_clients`/`design_clients`/`bs_clients`) or
   unify into one collection with a `brand`/`dept` field? A unified collection simplifies
   Analytics roll-ups (point 5/6) and the win-rate/CRM-stage merge but is a real data migration
   (three existing collections' docs would need re-homing or a compatibility read-layer).
2. How to resolve the `bs_clients`/`renderBSClientData` orphan (point 1): wire Brilliant Steel's
   "Client Data" tab onto the shared `renderClientProfiles`/`openClientQuotesModal` view (gains
   CRM stage/follow-up/notes/timeline for BS, loses the current per-client quote-accordion UX
   users may already be used to), or keep `renderBSClientData` and retire/repurpose `bs_clients`
   the collection, or maintain both deliberately for different audiences (e.g. partner-facing
   vs internal)?
3. Client↔quote/order/project join: keep the current `clientName` string-match (no schema
   change, but permanently fragile to renames/typos — point 3), or introduce a stable `clientId`
   foreign key written onto new quotes/orders/projects going forward, with a backfill migration
   for existing rows (best-effort name-match backfill, flagging unmatched rows for manual
   reconciliation)?
4. What does "orders" mean in the per-client timeline: `sales_orders` only, or also
   `partner_deals` (point 7, still actively written for Partners) and/or `job_projects`'
   `stage`/`timeline`? Should the timeline show project-level events (stage changes, "sent to
   production") alongside quote/order/payment events, or keep it quote/order/payment-scoped
   only?
5. What does "payments" mean: surface the existing `job_projects.payments[]` array (already
   populated by Finance's record-sale action, point 4) as-is, or build a first-class `payments`
   collection now (none exists today)? If the latter, does WS36 (Finance additions — bank
   accounts registry + downpayment billing invoice, explicitly meant to "wire into the sales-
   order downpayment flow," V12-PLAN.md:210-213, not yet ground) need to land first so this
   workstream doesn't build a payments view against a shape WS36 is about to change?
6. How do client-scoped Files get built, given no file doc anywhere carries a client or project
   reference today (point 4): add a `clientId`/`projectId` field to new uploads and provide a
   migration/backfill for existing files_* docs (likely infeasible to backfill accurately, since
   existing files have no client linkage recorded at upload time), or scope the "Files" panel of
   the client timeline to future uploads only, or defer Files entirely to a later phase of this
   workstream (or to WS38, Files Hub, also Phase 4 and not yet ground)?
7. Follow-ups: keep the single scalar `followUpDate` field (simple, already works for the
   due-banner), or build a follow-up history/log (each contact attempt as its own record, "mark
   done + schedule next" workflow) plus a reminder wired into `js/notifications.js` (none exists
   today for follow-ups, only task deadlines)?
8. Win-rate / CRM-stage unification (the literal V12-PLAN phrase): should the Analytics "Win
   Rate" KPI (currently quote-status-derived: accepted vs rejected, app.js:6523-6527) be
   recomputed from CRM client `stage` (won vs lost) instead of/in addition to quote status? The
   two can disagree today (a quote can be `accepted` while its client's `stage` is still
   `prospect`, or vice versa) — which is authoritative, and does the client-detail modal's own
   third win-rate definition (`salesOrderId` OR status-in-list, departments.js:11249) get
   retired in favor of one canonical calc?
9. Should the "CRM Pipeline" Analytics card (currently `sales_clients` only, app.js:6370/6534-
   6556) be extended to include `bs_clients` and `design_clients`, and if the three collections
   stay separate (decision 1), does that mean three more collection reads added to `
   renderAnalytics`'s already-heavy `Promise.all` (point 10), or does it require the unifier
   from decision 1 first?
10. Permission model: fix `canAdd`'s flat role check to route through `canEditDept('Sales')`/
    `canEditDept('Design')` per the repo's stated convention (constraint above), and/or tighten
    `bs_clients`' firestore.rules read rule so partners only see their own clients (matching
    `bs_quotes`/`sales_orders`/`job_projects`'s existing partner-scoping pattern) rather than the
    entire collection (point 8)?
11. Scope boundary: does this hub include Gov Biddings' `gov_biddings` agencies (a separate
    department with its own Analytics subtab and collection, not grepped as sharing any schema
    with the three client collections) and/or the AEC Partner Directory's incoming `aec_contacts`
    collection (WS33, Phase 4, not yet built)? Or is "Sales Client Relations" scoped strictly to
    Sales + Brilliant Steel (+ optionally Design) client books?
12. Reuse/extend `window.Projects`' unifier pattern (departments.js:55-97) — e.g. a parallel
    `window.Clients.listAll()`/`normalize()` that merges the three client collections plus joins
    in quotes/orders/projects at read time — or build the per-client detail view as a one-off
    modal/page with its own bespoke multi-collection fetch, not a reusable shared helper?
13. If any schema change is chosen (clientId, a payments collection, file linkage), what is the
    migration order and idempotency guard for backfilling existing docs, and does it need to
    precede or follow WS31 (Quotation builder v3, actively touching the same quote→order chain,
    point 9) to avoid migrating data that WS31 is about to restructure?
14. Caching strategy (point 10, constraint above): should the rebuilt client screens adopt the
    existing `dbCachedGet` keys (`sales_clients`/`design_clients`/`bs_clients`, `all-quotes`,
    `projects-unified`) already used elsewhere in the app, given WS16 was specifically built to
    eliminate this class of duplicate/uncached read?

## Risks / cross-workstream interactions

- ⚠️ Direct collision with **WS31** (Quotation builder v3, `[ ]` not started, Phase 4): its own
  plan text says it will "repair the quote→approval→order chain (BK quotes stranded in
  bs_quotes; Finance's empty list; Approvals approving without filing)" — the exact same
  quote→order data this workstream's timeline reads. Building a per-client quote/order timeline
  against a chain WS31 is about to rearchitect risks the timeline needing rework the moment
  WS31 lands, or masking a WS31-relevant bug as a WS32 display bug. Sequencing (WS32 after WS31,
  or tight coordination) should be explicit in Fable's spec.
- ⚠️ Direct scope overlap with **WS35** (Design dept suite, `[ ]` not started, Phase 4): its
  one-line mandate (V12-PLAN.md:207-209) is "project folders + client folders synced with Sales
  client files (**one client record shared, per-dept views**)" — i.e. WS35 independently plans
  to unify client identity across departments, the same territory as decision 1/2 above. If both
  workstreams get ground and built independently without cross-referencing each other's specs,
  one will likely rebuild or conflict with what the other just shipped.
- ⚠️ Payments-shape collision with **WS36** (Finance additions, `[ ]` not started, Phase 4): its
  mandate explicitly wires a new downpayment billing invoice "into the sales-order downpayment
  flow" (V12-PLAN.md:210-213) — the exact `sales_orders.paymentReceived`/`recordedAmount`
  fields this workstream would render as "payments" in a client timeline (decision 5). Building
  the payments panel before WS36 lands risks re-doing that panel once WS36 changes the shape.
- ⚠️ Adjacent-but-separate new collection in **WS33** (AEC Partner Directory, owner spec already
  written, V12-PLAN.md:199-203): introduces `aec_contacts` for architects/engineers/contractors
  — conceptually another "who do we sell to / partner with" list. Not the same data (no
  quotes/orders against it today) but worth Fable explicitly deciding whether it's in-scope for
  this hub's "client" concept (decision 11) so the two Phase-4 workstreams don't each invent a
  slightly different contact-management pattern.
- ⚠️ Perf regression risk re: **WS16**: a naive per-client-timeline implementation that fetches
  quotes+orders+projects+ledger+files fresh on every modal open, without reusing the existing
  cached fetchers (`getAllQuotes`, `window.Projects.listAll`, the `dbCachedGet` keys already
  established for the client collections), reintroduces exactly the "re-read the same heavy
  collections on every visit" pattern WS16 was created to eliminate (point 10).
- ⚠️ Partner data exposure: `bs_clients` currently has no per-partner read scoping in
  firestore.rules (point 8) — a richer, more data-dense per-client hub built on top of that rule
  without tightening it would expose MORE information (full timeline, payments, files) to every
  Brilliant Steel partner about every other partner's clients than the current thin
  `renderBSClientData` view does today. This is a real widening of an existing gap, not a new
  one, but the increased blast radius makes it worth flagging explicitly.
- ⚠️ The orphaned-collection pattern (bs_clients written but not read by its own department's
  screen, point 1) is exactly the kind of silent-drift bug class this repo's Fable workstreams
  keep finding elsewhere (e.g. the six-duplicated-attendance-readers finding in WS25, the
  analytics×13-reads finding in WS16) — if this workstream's spec doesn't explicitly name and
  close the `bs_clients`/`renderBSClientData` gap, "unify the client model" could ship while
  leaving this exact inconsistency in place under a new label.
- ⚠️ Three independently-computed "win/won" definitions coexist today (quote `status===
  'accepted'` in Analytics; client `stage==='won'` in the CRM Pipeline card; `salesOrderId` OR
  status-in-a-list in the client-detail modal, point 5) — a spec that "rolls CRM stages into
  win-rate" without picking exactly one authoritative definition and retiring the other two
  will produce a fourth number that still disagrees with at least one existing screen.

## Files likely touched

`js/departments.js` (`renderClientProfiles` + `CRM_STAGES`/`crmStageOf`/`crmStageMeta` ~11071-
11208; `openClientQuotesModal` ~11210-11298; `renderBSClientData` ~9750-9865; `loadSalesContent`
`Clients` case ~5524-5527; `loadDesignContent` `Clients` case ~6805-6811; `renderBrilliantSteel`
tab list/subtab switch ~8355-8386; the sales-order creation/record/production-handoff flow
`openSalesOrderModal`/`renderSalesOrders`/`transferOrderToProduction` ~9280-9598; the `window
.Projects` unifier ~55-97; `renderFileCollection`/`bindFileCollection` ~11379-11430+; the client
delete-request review queue ~10095/10175/10454), `js/app.js` (`renderAnalytics`'s Sales subtab
win-rate calc + CRM Pipeline card ~6340-6579; `getAllQuotes` ~2048-2060; the quote-builder
`postMessage` bridge + `upsertClient` ~8127-8230; `renderPartnerProjects` ~2095-2122; the
`bs-clients`/`bs-quotations`/`bs-files` nav routes ~2011-2013), `js/modules.js` (global search's
uncached `sales_clients`/`design_clients`/`bs_clients` reads ~2495-2498), `firestore.rules`
(`sales_clients`/`design_clients`/`bs_clients` ~1121-1123; `sales_orders` ~1020-1032;
`job_projects` ~1036-1043; `bk_quotes`/`bs_quotes`/`quotes` ~554-587; any new client-activity,
follow-up-history, or clientId-bearing collection needs its own new `match` block), `js/config.js`
(only if a new shared client-unifier helper analogous to `window.Projects` is added — must load
before departments.js/app.js/modules.js), `sw.js` (`CACHE_VER` bump, required on any JS/CSS
edit).

## Expected deliverable format

A numbered build spec Sonnet can execute without further judgment calls: one, the exact
decision made for each open decision above, stated as a one-line policy (e.g. single unified
client collection vs. three kept separate, clientId-based join vs. name-string join kept as-is,
`bs_clients`/`renderBSClientData` resolved which way, which win-rate definition is authoritative
and which two are retired). Two, the exact new or changed Firestore document shapes — field
name, type, default — for every collection touched, plus a literal `firestore.rules` diff,
before-and-after blocks in the same comment-then-`match` style as the existing rules file, for
every collection touched or newly introduced (a client-activity log, a follow-up history, a
`payments` collection, or a `clientId` field added to quotes/orders/projects/files — whichever
decisions 3/5/6 land on). Three, exact function signatures and before/after code blocks for: the
client-unifier or per-brand fix (decision 2/12), the timeline-assembly function that reads
quotes+orders+`job_projects.payments`/`timeline`/`documents`+files into one view, and the
win-rate/CRM-stage rewire in `renderAnalytics`'s Sales subtab — naming the exact lines in
app.js:6521-6579 and departments.js:11210-11298/9750-9865 being replaced, so Sonnet does not
have to rediscover today's three-disagreeing-win-rate-definitions problem itself. Four, a
numbered migration/backfill checklist covering: whether existing quote/order/project rows get a
retrofitted `clientId` (best-effort name-match, with a defined process for unmatched rows), how
the `bs_clients`/`renderBSClientData` orphan gets reconciled without losing data either side
currently holds, and in what order relative to any WS31/WS36 work already in flight. Five,
explicit UI mockup and copy for the unified per-client detail view — timeline entry types
(quote filed, order created, payment recorded, stage change, file uploaded, follow-up
logged), the CRM-stage selector, and the Analytics CRM-Pipeline-plus-Win-Rate merged card — if
a new layout is chosen over extending the existing `openClientQuotesModal`. Six, an explicit
sequencing/dependency note covering WS16 (cache-key reuse), WS31 (quote→order chain repair),
WS35 (Design's own client-sharing plan), and WS36 (payments/invoice shape), so Sonnet does not
build a client hub against data shapes those workstreams are about to change out from under it.
