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

## DECIDED — architecture spec (Fable, 2026-07-10)

> **THE LOAD-BEARING CALL (read this first — WS31/33/34/35/36/38/40 all depend on it):**
> The three client books unify into ONE new physical collection, **`clients/{id}`**, with a
> `brands: ['sales'|'design'|'bs']` array (one human = one doc, per-dept views are filters —
> exactly WS35's "one client record shared, per-dept views"). A real **`clientId`** foreign key
> is introduced: the `clients` doc id, stamped at write-time on every NEW quote/sales-order/
> job-project, backfilled by name-match onto existing `sales_orders`+`job_projects`, and joined
> for historical quotes via one canonical fallback helper (`Clients.quotesFor`). The three old
> collections become read-only archives after a one-click idempotent migration
> (`window.migrateClientBooks()`). Anything downstream that needs "which client?" uses
> `clientId` into `clients` — never a new name-string match, never the legacy collections.

### Resolved decisions (numbered to match the open-decisions list this section replaces)

1. **Unify → ONE new `clients` collection (brands[] array + nameKey), accessed through a
   Projects-style `window.Clients` unifier; the three legacy collections become read-only
   archives after migration.** Physical unification (not just a read-layer) was chosen because
   four downstream workstreams need a single `clientId` namespace: a read-time-only merge would
   force every future FK (WS31 quote picker, WS34 `campaignId` attribution, WS35
   `projects.clientId`, WS40 rollups) to carry `{collection,id}` pairs forever, and cross-dept
   dedupe ("one client record shared") would never happen. The security-model objection that
   kept `job_projects`/`projects` separate in `window.Projects` does not apply here: per
   decision 10, partners lose direct client-book access entirely, so the unified collection has
   ONE uniform internal-only rule. Legacy docs are archived, not deleted (records-forever
   directive, V12-PLAN.md:17-20).
2. **`bs_clients`/`renderBSClientData` orphan → split by audience.** INTERNAL users navigating
   Brilliant Steel → Client Data (or `bs-clients`) get the shared hub
   (`renderClientProfiles(..., 'brilliant-steel')` over `clients` filtered `brands` contains
   `'bs'`) — gaining CRM stage/follow-ups/notes/timeline for BS for the first time. PARTNERS
   keep `renderBSClientData` **unchanged** (quote-derived accordion, already correctly scoped to
   their own `bs_quotes` by rules). `bs_clients` docs migrate into `clients`; the quote-derived
   synthetic clients that only ever existed inside `renderBSClientData`'s grouping surface in
   the internal hub as a "From quotes — not yet in CRM" section with a one-click "＋ Save"
   promote (Spec 4c), so neither side of the orphan loses data.
3. **`clientId` FK → YES.** `data.clientId` is stamped on every new `bk_quotes`/`bs_quotes` doc
   by the bridge (the upsert now runs BEFORE the quote `.add()` and returns the id), on every
   new `sales_orders` doc, and on every new `job_projects` doc. Migration backfills `clientId`
   onto existing `sales_orders` + `job_projects` by unique nameKey match. Historical quote docs
   are **NOT** mass-rewritten (thousands of writes for no display gain — they are immutable
   records); instead the ONE canonical join helper `Clients.quotesFor(client, quotes)` matches
   `q.clientId === client.id` OR `nameKey(q.clientName) === client.nameKey`. Unmatched legacy
   rows stay `clientId:null` and still render via the nameKey fallback — the fallback IS the
   reconciliation; no manual queue. Renames stop orphaning: a renamed client keeps its id, so
   id-stamped rows stay attached (old name-only rows freeze on the historical name, correctly).
   Note: V12-PLAN's "client-# auto (done in P1)" claim is confirmed stale (zero grep hits) —
   there is no `clientNumber`; the `clients` doc id IS the client identifier.
4. **"Orders" in the timeline = `sales_orders` + `job_projects` (stage/timeline[]/documents[]
   events included); `partner_deals` EXCLUDED.** Project-level events (stage changes, "Moved to
   In Production", OR/SO documents) are the richest activity log in the repo and are exactly
   what "per-client timeline in one view" means — they're in. `partner_deals` stays out: it is
   a legacy partner-payout shape with no FK, its post-legacy rows are duplicated by
   `job_projects` (renderPartnerProjects merges the two for exactly that reason), and it gains
   no `clientId` — deciding otherwise would add a fourth order concept to the timeline for zero
   information.
5. **"Payments" = `job_projects.payments[]` as-is. NO new `payments` collection.** WS36
   explicitly owns the downpayment-billing/invoice shape ("wire into the sales-order downpayment
   flow"); building a first-class payments collection here would collide head-on. The timeline
   renders Finance-verified `payments[]` entries as 💰 events; the sales-order
   `paymentReceived` (sales-captured, not Finance-verified) appears ONLY inside the 🧾
   order-created event text ("₱X received"), never as a separate payment row — avoids
   double-counting. All payment reads go through ONE function (`Clients.timelineFor`), so if
   WS36 later moves payment truth, it updates one place.
6. **Files → DEFERRED to WS38 (Files Hub).** No file doc carries any linkage today and backfill
   is impossible (linkage was never recorded at upload). The hub ships with NO Files panel.
   Contract for WS38: file docs gain an OPTIONAL `clientId` field (this exact name, pointing
   into `clients`); when WS38 lands, the hub's Files panel is one extra cached query inside
   `Clients.timelineFor`.
7. **Follow-ups → keep the scalar `followUpDate` + add a `contactLog[]` array on the client doc
   + a "✓ Done" action; push reminders DEFERRED.** `contactLog` (arrayUnion of
   `{date, by, note}`) gives contact history in the timeline with no new collection and no new
   rules block. "✓ Done" clears/reschedules `followUpDate`, sets `lastContact`, and logs an
   entry. A `notifications.js` reminder keyed on `followUpDate` is deliberately NOT built (the
   due-banner + Analytics due-count remain the surfacing; WS34's campaign/lead follow-up work is
   the natural home if push reminders are ever wanted).
8. **Win-rate → ONE canonical quote-outcome definition; the other two retired; client stages
   feed a separately-labeled funnel; sales-order creation auto-advances the client to `won`.**
   Canonical (new `window.isQuoteWon/isQuoteLost/isQuoteOpen` in config.js): WON =
   `salesOrderId` present OR `status==='won'` OR `status==='accepted'` (legacy `quotes` only
   ever used `accepted`); LOST = `status==='rejected'`; OPEN = neither. The Analytics "Win Rate"
   KPI stays QUOTE-outcome-based (money-grounded, auditable) but switches to the canonical
   helpers — fixing the current bug where `accepted`-only counting ignores every modern
   bk/bs quote whose won-status is `'won'`. The client-modal's third definition (`'filed'`/
   `'approved'` counted as won, departments.js:11249) is RETIRED — filed ≠ bought; its Won ₱
   will correctly shrink. Client `stage` is NOT a win-rate input: the merged Analytics card
   shows the stage funnel plus a distinctly-labeled "Client conversion" percentage next to the
   quote win rate (copy in Spec 7). The glue that stops the two numbers drifting: creating a
   sales order sets the client's `stage:'won'` (Spec 5d).
9. **CRM Pipeline card → ALL brands via ONE read.** `renderAnalytics` swaps its
   `sales_clients`-only fetch (app.js:6370) for `window.Clients.listAll()` (cached key
   `'clients'`) — zero net new reads (one replaces one), and `design`/`bs` clients appear in the
   funnel for the first time. The inline `CRMP` taxonomy duplicate (app.js:6535) is deleted in
   favor of the now-exported `window.CRM_STAGES`.
10. **Permissions → `canEditDept` per brand in the UI; `clients` is internal-only in rules.**
    UI: `canAdd = canEditDept(dept)` where dept = Sales/Design/Brilliant Steel per brand, plus
    `currentRole==='agent'` for the Sales brand only (agents keep their current Sales-book
    access; the accidental "any agent can edit the Design book" hole closes). Rules: `clients`
    read/create/update require `!isPartner()`; delete stays admin-only. This CLOSES the
    flagged gap (any BS partner could read the entire `bs_clients` book): partners now have NO
    client-book access at all — their Client Data view derives from their own `bs_quotes`
    (already partner-scoped). Consequence handled explicitly: the quote-filed upsert SKIPS
    partner sessions (a partner can't query/write `clients`); partner-originated client names
    reach the CRM via the internal "From quotes" promote section (Spec 4c) instead.
11. **Scope → Sales + Design + Brilliant Steel books ONLY.** `gov_biddings` agencies (different
    schema/lifecycle, own dept) and `aec_contacts` (WS33 owns it) are OUT. Contract for
    WS33/34: reuse `window.CRM_STAGES` for any lead/stage lifecycle, and link to a client via
    `clientId` into `clients` — do not invent a parallel contact pattern.
12. **Reuse the `window.Projects` pattern → new `window.Clients` unifier (departments.js,
    directly after `window.Projects`) + one shared detail view `openClientHub` replacing
    `openClientQuotesModal`.** No bespoke per-dept fetches; every consumer (hub, Analytics,
    global search, delete queue) reads through `Clients.listAll`/`clients`.
13. **Migration order → WS32 lands FIRST, before WS31/34/35/36/40.** One idempotent,
    president/manager-triggered `window.migrateClientBooks()` (button in the hub's migration
    banner): legacy docs stamped `migratedTo` are skipped on re-run; name-collisions merge
    (brands arrayUnion + fill-empty-fields) instead of duplicating; then FK-backfills
    `sales_orders`/`job_projects`. Full order + guards in Spec 9. WS31 inherits a working
    `clientId` chain and must preserve it (Spec 11 contract).
14. **Caching → adopt the WS16 keys.** New canonical `dbCachedGet` key **`'clients'`** (60s)
    used by the hub, Analytics, and global search; the hub's modal reuses `'all-quotes'`
    (`getAllQuotes`), `'projects-unified'` (`Projects.listAll`), and a new `'sales_orders'`
    (60s) key. Every client write calls `dbCacheInvalidate('clients')` so edits feel instant
    (invalidate-then-rerender). The two current uncached raw reads (departments.js:11086,
    9755-9756) disappear with their callers.

**Sequencing:** WS32 depends on nothing unfinished. It deliberately does NOT touch the
quote→approval→order chain's known breakage (the `QUOTE_APPROVAL_REQUESTED` branch still
hard-routes ALL companies into `bs_quotes`, app.js:8225-8231 — that IS the live "BK stranded in
bs_quotes" path and it is **WS31's to fix**). WS32 is immune to it by design: the client↔quote
join goes through `getAllQuotes` (merges both collections) + `clientId`/nameKey, so a quote in
the "wrong" collection still lands on the right client. Full cross-workstream contract in
Spec 11.

---

### Spec 1 — Data shapes (annotated literals)

```js
// clients/{id}   — NEW unified collection. ONE doc per client-human. THE clientId target.
{ name: 'Juan Dela Cruz',          // string, required (rules-validated non-empty)
  nameKey: 'juan dela cruz',       // NEW — trim().toLowerCase(), collapsed whitespace; the
                                   //       dedupe/join key; kept in sync on every save
  brands: ['sales','bs'],          // NEW — array; which books this client belongs to
                                   //       ('sales' = Barro/BK, 'design', 'bs' = Brilliant Steel;
                                   //       quotes with company 'PT' map to 'bs', same as today's
                                   //       non-BK routing at app.js:8197)
  company:'', email:'', phone:'', address:'', notes:'',   // strings, optional (as today)
  stage: 'lead',                   // lead|prospect|won|lost (crmStageOf defaults 'lead')
  followUpDate: '',                // YYYY-MM-DD or '' (scalar kept — decision 7)
  lastContact: '2026-07-10',       // YYYY-MM-DD, set on manual save / log-contact / fu-done
  contactLog: [                    // NEW — arrayUnion history (decision 7); render last 20
    { date:'2026-07-10', by:'Neil Barro', note:'Called re: kitchen quote' } ],
  lastQuoteNumber:'BK-2607-012', lastQuoteTotal: 145000,   // denormalized, as today
  legacyRefs: [ {coll:'sales_clients', id:'abc123'} ],     // NEW — migration audit trail
  deleteRequested:false, deleteReason:'', deleteRequestedBy:'', deleteRequestedAt:null, // as today
  addedBy:'<uid>', createdBy:'<uid>', createdAt, updatedAt }

// bk_quotes/{id}, bs_quotes/{id}  — ONE new field on NEW writes only (no backfill):
{ ...existing shape..., clientId: '<clients doc id>' | null }   // stamped by the bridge (Spec 5a)

// sales_orders/{id}  — ONE new field (new writes + migration backfill):
{ ...existing shape..., clientId: '<clients doc id>' | null }

// job_projects/{id}  — ONE new field (new writes + migration backfill):
{ ...existing shape..., clientId: '<clients doc id>' | null }

// sales_clients/{id}, design_clients/{id}, bs_clients/{id}  — ARCHIVED (read-only after
// rules deploy; admin-only write kept solely so migration can stamp):
{ ...existing shape..., migratedTo: { coll:'clients', id:'<new doc id>' } }   // set by migration

// NO new collections beyond `clients`. No `payments` collection (decision 5), no follow-up
// collection (decision 7), no file-linkage migration (decision 6). No composite indexes needed:
// every new query is a single-field equality (`nameKey`, `deleteRequested`) or an existing
// pattern — firestore.indexes.json is untouched.
```

### Spec 2 — Canonical helpers (js/config.js) + `window.Clients` unifier (js/departments.js)

**2a — config.js additions** (place near the other shared pure helpers; config.js loads before
every caller):

```js
// ── Canonical quote-outcome + client-name-key helpers (v12 WS32) ─────────
// THE one won/lost definition (decision 8). Retires: Analytics 'accepted'-only
// (app.js:6523-6527), and the client modal's 'filed'/'approved'-as-won
// (departments.js:11249). 'accepted' kept for legacy `quotes` docs only.
window.isQuoteWon  = q => !!(q && (q.salesOrderId || q.status === 'won' || q.status === 'accepted'));
window.isQuoteLost = q => !!(q && q.status === 'rejected');
window.isQuoteOpen = q => !!q && !window.isQuoteWon(q) && !window.isQuoteLost(q);
// THE one client-name normalizer — every join and dedupe uses this, nothing else.
window.clientNameKey = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
```

**2b — export the CRM taxonomy** (departments.js, immediately after `crmStageMeta` at 11082, so
app.js Analytics can stop duplicating it):

```js
window.CRM_STAGES = CRM_STAGES; window.crmStageOf = crmStageOf; window.crmStageMeta = crmStageMeta;
```

**2c — `window.Clients`** (departments.js, insert directly after the `window.Projects` IIFE
closes at ~line 97 — same file, same pattern, loads before app.js/modules.js):

```js
// ════════════════════════════════════════════════════════════════
//  UNIFIED CLIENT BOOK (v12 WS32) — one `clients` collection, one clientId.
//  Legacy sales_clients/design_clients/bs_clients are read-only archives once
//  migrateClientBooks() has run; until then listAll() falls back to them
//  (read-only compat view) so nothing goes blank between deploy and migration.
// ════════════════════════════════════════════════════════════════
window.Clients = (function () {
  const nameKey = s => window.clientNameKey(s);
  const brandOf = ui => ui === 'design' ? 'design' : ui === 'brilliant-steel' ? 'bs' : 'sales';
  const deptOf  = ui => ui === 'design' ? 'Design' : ui === 'brilliant-steel' ? 'Brilliant Steel' : 'Sales';
  function normalize(doc, legacyBrand) {
    const d = doc.data ? doc.data() : doc;
    return { id: doc.id || d.id, ...d,
      nameKey: d.nameKey || nameKey(d.name),
      brands: (Array.isArray(d.brands) && d.brands.length) ? d.brands : [legacyBrand || 'sales'],
      _legacy: !!legacyBrand };
  }
  // Cached (WS16 canonical key 'clients', 60s). opts.brand filters to one book.
  async function listAll(opts) {
    opts = opts || {};
    const fetch = async () => {
      const snap = await db.collection('clients').orderBy('createdAt', 'desc').get().catch(() => ({ docs: [] }));
      if (snap.docs.length) return snap.docs.map(d => normalize(d));
      // pre-migration compat: merge the three legacy books, read-only
      const [sc, dc, bc] = await Promise.all([
        db.collection('sales_clients').get().catch(() => ({ docs: [] })),
        db.collection('design_clients').get().catch(() => ({ docs: [] })),
        db.collection('bs_clients').get().catch(() => ({ docs: [] })),
      ]);
      return [...sc.docs.map(d => normalize(d, 'sales')), ...dc.docs.map(d => normalize(d, 'design')),
              ...bc.docs.map(d => normalize(d, 'bs'))]
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    };
    const all = (typeof dbCachedGet === 'function') ? await dbCachedGet('clients', fetch, 60000) : await fetch();
    return opts.brand ? all.filter(c => c.brands.includes(opts.brand)) : all;
  }
  async function findByName(name) {
    const key = nameKey(name); if (!key) return null;
    const snap = await db.collection('clients').where('nameKey', '==', key).limit(1).get().catch(() => ({ empty: true, docs: [] }));
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
  // Quote-filed upsert (replaces app.js:8196-8209's whole-collection scan with an
  // indexed nameKey query). Never touches stage/followUpDate on existing docs.
  // Returns the clientId (the FK the bridge stamps onto the quote) or null.
  async function upsertFromQuote(q) {
    const name = (q.clientName || '').trim(); if (!name) return null;
    const key = nameKey(name), brand = (q.company === 'BK') ? 'sales' : 'bs';
    try {
      const FV = firebase.firestore.FieldValue;
      const snap = await db.collection('clients').where('nameKey', '==', key).limit(1).get();
      const cdata = { name, nameKey: key, brands: FV.arrayUnion(brand),
        company: q.clientCompany || '', phone: q.clientPhone || '', email: q.clientEmail || '',
        address: q.clientAddress || '', lastQuoteNumber: q.quoteNumber || '', lastQuoteTotal: q.total || 0,
        updatedAt: FV.serverTimestamp() };
      let id;
      if (!snap.empty) { id = snap.docs[0].id; await db.collection('clients').doc(id).set(cdata, { merge: true }); }
      else {
        cdata.stage = 'lead'; cdata.followUpDate = ''; cdata.contactLog = [];
        cdata.createdAt = FV.serverTimestamp(); cdata.createdBy = (auth.currentUser ? auth.currentUser.uid : null);
        const ref = await db.collection('clients').add(cdata); id = ref.id;
      }
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('clients');
      return id;
    } catch (_) { return null; }
  }
  // THE canonical client↔quote join (decision 3): clientId first, nameKey fallback.
  function quotesFor(client, quoteDocs) {
    const key = client.nameKey || nameKey(client.name);
    return quoteDocs.filter(q => (q.clientId && q.clientId === client.id) || nameKey(q.clientName) === key);
  }
  // One per-client view-model from CACHED fetchers only (WS16 — no fresh heavy reads).
  // Returns { quotes, orders, projects, payments, events } — events newest-first.
  async function timelineFor(client) {
    const toMs = v => !v ? 0 : (typeof v === 'string' ? (Date.parse(v) || 0)
      : v.seconds ? v.seconds * 1000 : (v.toDate ? v.toDate().getTime() : 0));
    const [qSnap, projects, soSnap] = await Promise.all([
      (typeof getAllQuotes === 'function' ? getAllQuotes() : Promise.resolve({ docs: [] })),
      window.Projects.listAll().catch(() => []),
      (typeof dbCachedGet === 'function'
        ? dbCachedGet('sales_orders', () => db.collection('sales_orders').get().catch(() => ({ docs: [] })), 60000)
        : db.collection('sales_orders').get().catch(() => ({ docs: [] })))
    ]);
    const key = client.nameKey || nameKey(client.name);
    // _coll = which collection the quote lives in (drives Reopen; survives WS31's
    // stranded-collection bug because we join by client, not by collection).
    const quotes = qSnap.docs
      .map(d => ({ id: d.id, _coll: (d.ref && d.ref.parent) ? d.ref.parent.id : 'bk_quotes', ...d.data() }))
      .filter(q => (q.clientId && q.clientId === client.id) || nameKey(q.clientName) === key)
      .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
    const orders = soSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(o => (o.clientId && o.clientId === client.id) || nameKey(o.clientName) === key);
    const projs = projects.filter(p => (p.raw && p.raw.clientId && p.raw.clientId === client.id) || nameKey(p.clientName) === key);
    const events = [];
    if (client.createdAt) events.push({ ts: toMs(client.createdAt), icon: '➕', text: 'Client added' });
    (client.contactLog || []).forEach(c0 => events.push({ ts: toMs(c0.date), icon: '📞',
      text: `Contact logged${c0.note ? ' — ' + c0.note : ''}${c0.by ? ' · ' + c0.by : ''}` }));
    quotes.forEach(q => events.push({ ts: toMs(q.createdAt), icon: '📄',
      text: `Quote ${q.quoteNumber || q.id.slice(-8)} · ₱${fmt(q.total || q.grandTotal || 0)} · ${q.status || q.approvalStatus || 'draft'}` }));
    orders.forEach(o => events.push({ ts: toMs(o.createdAt), icon: '🧾',
      text: `Sales Order ${o.quoteNumber || o.id.slice(-8)} · ₱${fmt(o.contractAmount || 0)}${o.paymentReceived ? ` (₱${fmt(o.paymentReceived)} received)` : ''}` }));
    projs.forEach(p => {
      ((p.raw && p.raw.timeline) || []).forEach(t => events.push({ ts: toMs(t.at), icon: '🏭', text: `${p.no ? p.no + ' · ' : ''}${t.event}` }));
      (p.payments || []).forEach(pm => events.push({ ts: toMs(pm.date), icon: '💰',
        text: `Payment ₱${fmt(pm.amount || 0)} (${pm.method || '—'}${pm.orRef ? ' · OR ' + pm.orRef : ''})` }));
      ((p.raw && p.raw.documents) || []).forEach(dc => events.push({ ts: toMs(dc.at), icon: '📎', text: `${dc.type}${dc.ref ? ' · ' + dc.ref : ''}` }));
    });
    if (client.followUpDate) events.push({ ts: toMs(client.followUpDate), icon: '⏰', text: `Follow-up scheduled ${client.followUpDate}` });
    events.sort((a, b) => b.ts - a.ts);
    const payments = projs.flatMap(p => (p.payments || []).map(pm => ({ ...pm, projectNo: p.no })));
    return { quotes, orders, projects: projs, payments, events: events.slice(0, 80) };
  }
  return { nameKey, brandOf, deptOf, normalize, listAll, findByName, upsertFromQuote, quotesFor, timelineFor };
})();
```

### Spec 3 — `renderClientProfiles` rework (departments.js:11084-11208)

**3a — head of function (11085-11092) BEFORE → AFTER:**
```js
// BEFORE (11085-11092)
  const collection = brand === 'brilliant-steel' ? 'bs_clients' : (brand === 'design' ? 'design_clients' : 'sales_clients');
  const snap = await db.collection(collection).orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
  const clients = snap.docs.map(d => ({id:d.id,...d.data()}));
  const canAdd = currentRole==='president'||currentRole==='owner'||currentRole==='manager'||currentRole==='agent';
  const canDeleteDirect = currentRole==='president'||currentRole==='owner'||currentRole==='manager';
  const quoteColl  = brand==='brilliant-steel' ? 'bs_quotes' : 'bk_quotes';
  const builderNav = brand==='brilliant-steel' ? 'bs-quote-builder' : 'bk-quote-builder';
  const today = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10));
```
```js
// AFTER — unified book, cached read, canEditDept gating (decisions 1/10/14).
// quoteColl/builderNav are GONE: the hub joins quotes via clientId/nameKey across
// all collections (Spec 2c) and derives the builder per quote (Spec 4).
  const COLL = 'clients';
  const brandKey = window.Clients.brandOf(brand);           // 'sales' | 'design' | 'bs'
  const clients  = await window.Clients.listAll({ brand: brandKey });
  const legacyMode = clients.some(c => c._legacy);          // migration not yet run
  const dept = window.Clients.deptOf(brand);
  const canAdd = !legacyMode && (canEditDept(dept) || (brand === 'barro' && currentRole === 'agent'));
  const canDeleteDirect = !legacyMode && (currentRole==='president'||currentRole==='owner'||currentRole==='manager');
  const today = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10));
```

**3b — migration banner** (insert at the top of the `container.innerHTML` template, above the
due-followups banner; shown only pre-migration to admins):
```js
    ${legacyMode && ['president','manager'].includes(currentRole) ? `
      <div class="alert-banner alert-warn" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span>🧭 Client books not yet unified — showing the legacy read-only view.</span>
        <button class="btn-primary btn-sm" id="cl-migrate-btn">Unify client books</button>
      </div>` : legacyMode ? `<div class="alert-banner" style="margin-bottom:10px">🧭 Read-only until an admin unifies the client books.</div>` : ''}
```
and bind (next to the other bindings at ~11205):
```js
  document.getElementById('cl-migrate-btn')?.addEventListener('click', async () => {
    if (!(await confirmDialog({message:'Unify sales/design/BS client books into one CRM? Safe to re-run — already-migrated records are skipped.'}))) return;
    Notifs.showToast('Migrating client books…');
    try { const r = await window.migrateClientBooks();
      window.logAudit && window.logAudit('migrate','clients',null,r);
      Notifs.showToast(`Done: ${r.created} created, ${r.merged} merged, ${r.soTagged+r.jpTagged} records linked, ${r.unmatched} left name-matched.`);
      renderClientProfiles(container, currentUser, currentRole, brand);
    } catch (ex) { Notifs.showToast('Migration failed: ' + (ex.message||ex.code), 'error'); }
  });
```

**3c — every `db.collection(collection)` in the function body → `db.collection(COLL)`** —
exactly four sites: editor save update (11166), editor save add (11167), hard-delete (11182),
delete-request update (11188). The editor save `data` object additionally gains:
```js
        nameKey: window.Clients.nameKey(name),                       // keep the join key in sync on rename
        ...(cl ? {} : { brands: [brandKey], contactLog: [] }),       // brand membership on create only
```
and every successful save/delete adds `if (typeof dbCacheInvalidate==='function') dbCacheInvalidate('clients');`
immediately before the `renderClientProfiles(...)` rerender call (three sites: save 11168,
delete 11182, delete-request 11190).

**3d — card click (11177) BEFORE → AFTER:**
```js
// BEFORE:      openClientQuotesModal(cl, quoteColl, builderNav);
// AFTER:       openClientHub(cl, { canEdit: canAdd, onChange: () => renderClientProfiles(container, currentUser, currentRole, brand) });
```

**3e — filter counts/cards/stage-filter logic (11094-11134, 11195-11207): UNCHANGED** apart
from the sites named above — chips, badges, follow-up banner, escHtml discipline all stay.

### Spec 4 — `openClientHub` (REPLACES `openClientQuotesModal`, departments.js:11210-11298 wholesale)

**4a — the function.** Same modal chrome; new signature. `openClientQuotesModal` has exactly one
caller (11177, patched in 3d) — delete it outright, no alias.

```js
// Per-client hub: profile + stage + follow-up + unified timeline (quotes, orders,
// project events, payments, contacts) — V12-PLAN 197-198. Internal-only (partners
// never reach this — decision 10), so no partner query-scoping is needed here.
async function openClientHub(cl, opts) {
  opts = opts || {};
  openModal(`👤 ${escHtml(cl.name || 'Client')}`, '<div class="loading-placeholder">Loading client…</div>',
    `<button class="btn-secondary" onclick="closeModal()">Close</button>`);
  const body = document.getElementById('modal-body');
  const t = await window.Clients.timelineFor(cl);
  if (!body) return;
  const FV = firebase.firestore.FieldValue;
  const today = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10));
  const who = () => (userProfile?.displayName || currentUser?.email || '');
  const fmtD = ms => ms ? new Date(ms).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '';
  const st = crmStageMeta(crmStageOf(cl));
  const fuOverdue = cl.followUpDate && cl.followUpDate <= today && !['won','lost'].includes(crmStageOf(cl));
  const totalQuoted = t.quotes.reduce((s,q)=>s+(q.total||q.grandTotal||0),0);
  const wonVal = t.quotes.filter(window.isQuoteWon).reduce((s,q)=>s+(q.total||q.grandTotal||0),0);   // canonical (decision 8)
  const collected = t.payments.reduce((s,p)=>s+(+p.amount||0),0);
  const ar = t.projects.reduce((s,p)=>s+(+p.arBalance||0),0);
  const statusBadge = (q) => {
    const s = q.status || q.approvalStatus || 'draft';
    const map = { won:'badge-green', accepted:'badge-green', filed:'badge-blue', approved:'badge-green',
      pending_approval:'badge-amber', pending_review:'badge-amber', needs_revision:'badge-amber',
      rejected:'badge-red', sent:'badge-blue', draft:'badge-gray' };
    return `<span class="badge ${map[s]||'badge-gray'}" style="font-size:9px">${escHtml(s)}</span>`;
  };
  body.innerHTML = `
    <div class="item-card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        ${opts.canEdit
          ? `<select id="ch-stage" style="padding:4px 8px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:12px">
              ${CRM_STAGES.map(s=>`<option value="${s.key}" ${crmStageOf(cl)===s.key?'selected':''}>${s.icon} ${s.label}</option>`).join('')}</select>`
          : `<span class="badge" style="font-size:10px;background:${st.color};color:#fff">${st.icon} ${st.label}</span>`}
        ${cl.company?`<span style="font-size:12px;color:var(--text-muted)">🏢 ${escHtml(cl.company)}</span>`:''}
        ${(cl.brands||[]).map(b=>`<span class="badge badge-gray" style="font-size:9px">${b==='sales'?'Sales':b==='design'?'Design':'Brilliant Steel'}</span>`).join('')}
      </div>
      <div class="item-meta">
        ${cl.email?`<span>✉️ ${escHtml(cl.email)}</span>`:''}
        ${cl.phone?`<span>📞 ${escHtml(cl.phone)}</span>`:''}
        ${cl.address?`<span>📍 ${escHtml(cl.address)}</span>`:''}
      </div>
      <div style="font-size:12px;margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${cl.followUpDate
          ? `<span style="color:${fuOverdue?'var(--danger)':'var(--text-muted)'}">⏰ Follow-up: <strong>${escHtml(cl.followUpDate)}</strong>${fuOverdue?' · due':''}</span>
             ${opts.canEdit?`<button class="btn-secondary btn-sm" id="ch-fu-done">✓ Done</button>`:''}`
          : (opts.canEdit?`<button class="btn-secondary btn-sm" id="ch-fu-set">⏰ Set follow-up</button>`:'')}
        ${opts.canEdit?`<button class="btn-secondary btn-sm" id="ch-log">📞 Log contact</button>`:''}
      </div>
      ${cl.notes?`<div style="font-size:12px;color:var(--text-muted);margin-top:6px">📝 ${escHtml(cl.notes)}</div>`:''}
      <div style="display:flex;gap:14px;margin-top:8px;font-size:12px;border-top:1px solid var(--border);padding-top:8px;flex-wrap:wrap">
        <span>Quotes: <strong>${t.quotes.length}</strong></span>
        <span>Quoted: <strong>₱${fmt(totalQuoted)}</strong></span>
        <span>Won: <strong style="color:var(--success)">₱${fmt(wonVal)}</strong></span>
        <span>Collected: <strong>₱${fmt(collected)}</strong></span>
        ${ar>0?`<span>AR: <strong style="color:var(--danger)">₱${fmt(ar)}</strong></span>`:''}
      </div>
    </div>
    ${t.events.length?`<h4 style="font-size:13px;margin:0 0 6px">🕓 Timeline</h4>
    <div style="border-left:2px solid var(--border);margin:0 0 14px 6px;padding-left:12px;display:flex;flex-direction:column;gap:8px;max-height:340px;overflow-y:auto">
      ${t.events.map(e=>`<div style="display:flex;gap:8px;align-items:baseline"><span style="flex-shrink:0">${e.icon}</span><span style="font-size:12px;flex:1">${escHtml(e.text)}</span><span style="font-size:11px;color:var(--text-muted);flex-shrink:0">${fmtD(e.ts)}</span></div>`).join('')}
    </div>`:''}
    ${t.projects.length?`<h4 style="font-size:13px;margin:0 0 6px">🏗 Projects (${t.projects.length})</h4>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">
      ${t.projects.map(p=>`<div class="item-card" style="display:flex;justify-content:space-between;gap:10px;align-items:center">
        <div style="min-width:0"><span style="font-weight:700;font-size:12px;font-family:monospace">${escHtml(p.no||p.id.slice(-6))}</span>
          <span class="badge badge-blue" style="font-size:9px">${escHtml((p.stage||'—').replace(/_/g,' '))}</span></div>
        <div style="font-size:11px;color:var(--text-muted);flex-shrink:0">₱${fmt(p.contractAmount)}${p.arBalance>0?` · AR ₱${fmt(p.arBalance)}`:' · paid'}</div>
      </div>`).join('')}
    </div>`:''}
    <h4 style="font-size:13px;margin:0 0 6px">📄 Quotes (${t.quotes.length})</h4>
    ${!t.quotes.length?'<div class="empty-state" style="padding:18px"><p>No quotes recorded for this client yet.</p></div>':`<div style="display:flex;flex-direction:column;gap:8px">
      ${t.quotes.map(q=>`<div class="item-card" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px;font-family:monospace">${escHtml(q.quoteNumber||q.id.slice(-8))}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">₱${fmt(q.total||q.grandTotal||0)} ${statusBadge(q)} ${q.salesOrderId?'<span class="badge badge-green" style="font-size:9px">→ Sales Order</span>':''} ${q.createdAt?'· '+fmtD(q.createdAt.seconds?q.createdAt.seconds*1000:Date.parse(q.createdAt)||0):''}</div>
        </div>
        ${q.editableState?`<div style="display:flex;gap:6px;flex-shrink:0"><button class="btn-secondary btn-sm clq-reopen" data-id="${q.id}" data-coll="${q._coll}" data-co="${escHtml(q.company||'BS')}">↻ Reopen</button><button class="btn-secondary btn-sm clq-rev" data-id="${q.id}" data-coll="${q._coll}" data-co="${escHtml(q.company||'BS')}" title="Start a new revision (R2, R3…) with today's date">⎘ New Revision</button></div>`:'<span style="font-size:10px;color:var(--text-muted);flex-shrink:0">no snapshot</span>'}
      </div>`).join('')}
    </div>`}
  `;
  const nav = co => co==='BK' ? 'bk-quote-builder' : 'bs-quote-builder';
  body.querySelectorAll('.clq-reopen').forEach(btn=>btn.addEventListener('click',()=>{ closeModal(); window.reopenQuoteFromDoc(btn.dataset.coll, btn.dataset.id, nav(btn.dataset.co)); }));
  body.querySelectorAll('.clq-rev').forEach(btn=>btn.addEventListener('click',()=>{ closeModal(); window.newRevisionFromDoc(btn.dataset.coll, btn.dataset.id, nav(btn.dataset.co)); }));
  const patch = async (upd, log) => {
    if (log) upd.contactLog = FV.arrayUnion(log);
    upd.updatedAt = FV.serverTimestamp();
    await db.collection('clients').doc(cl.id).update(upd);
    if (typeof dbCacheInvalidate==='function') dbCacheInvalidate('clients');
    closeModal(); opts.onChange && opts.onChange();
  };
  document.getElementById('ch-stage')?.addEventListener('change', async e => {
    try { await patch({ stage: e.target.value }); Notifs.showToast('Stage updated'); } catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
  });
  document.getElementById('ch-log')?.addEventListener('click', async () => {
    const note = (await promptDialog({message:'What happened? (call, site visit, email…)', multiline:true}))||'';
    if (!note.trim()) return;
    try { await patch({ lastContact: today }, { date: today, by: who(), note: note.trim() }); Notifs.showToast('Contact logged'); } catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
  });
  document.getElementById('ch-fu-done')?.addEventListener('click', async () => {
    const next = ((await promptDialog({message:'Follow-up done ✓ — schedule the next one? (YYYY-MM-DD, blank = none)'}))||'').trim();
    try { await patch({ followUpDate: next, lastContact: today }, { date: today, by: who(), note: 'Follow-up done' + (next ? ' → next ' + next : '') }); Notifs.showToast('Follow-up updated'); } catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
  });
  document.getElementById('ch-fu-set')?.addEventListener('click', async () => {
    const d = ((await promptDialog({message:'Follow-up date (YYYY-MM-DD)'}))||'').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { if (d) Notifs.showToast('Use YYYY-MM-DD','error'); return; }
    try { await patch({ followUpDate: d }); Notifs.showToast('Follow-up set'); } catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
  });
}
```

**4b — UI copy / layout (the "mockup"):** modal title `👤 {name}`; header card = stage selector
(editable inline) + brand badges + contact meta + follow-up row (`⏰ Follow-up: 2026-07-14 ·
due` `[✓ Done]` `[📞 Log contact]`) + stats strip `Quotes 4 · Quoted ₱310,000 · Won ₱145,000 ·
Collected ₱80,000 · AR ₱65,000`; then `🕓 Timeline` (scrollable, newest-first, entry types: ➕
client added, 📞 contact logged, 📄 quote filed, 🧾 sales order, 🏭 project event, 💰 payment,
📎 document, ⏰ follow-up scheduled); then `🏗 Projects` mini-list (projectNo + stage badge +
contract/AR); then `📄 Quotes` list with per-quote `↻ Reopen` / `⎘ New Revision` (builder
derived from `q.company`, collection from `q._coll`). No Files panel (decision 6).

**4c — "From quotes — not yet in CRM" promote section** (closes the orphan's data-loss side,
decision 2). In `renderClientProfiles`, after `renderList()` is first called and only when
`!legacyMode && canAdd && brand !== 'design'` (Design has no quote stream):
```js
  if (!legacyMode && canAdd && brand !== 'design') (async () => {
    try {
      const qs = await getAllQuotes();
      const wantCo = brand === 'brilliant-steel' ? (co => co !== 'BK') : (co => co === 'BK');
      const known = new Set(clients.map(c => c.nameKey));
      const un = {};
      qs.docs.forEach(d => { const q = d.data(); const k = window.Clients.nameKey(q.clientName);
        if (!k || known.has(k) || !wantCo(q.company || 'BK')) return;
        if (!un[k]) un[k] = { clientName:(q.clientName||'').trim(), clientCompany:q.clientCompany||'', clientPhone:q.clientPhone||'',
          clientEmail:q.clientEmail||'', clientAddress:q.clientAddress||'', quoteNumber:q.quoteNumber||'', total:q.total||0,
          company: brand==='brilliant-steel' ? 'BS' : 'BK', n:0 };
        un[k].n++; });
      const list = Object.values(un); if (!list.length) return;
      const el = document.getElementById('cl-list'); if (!el) return;
      el.insertAdjacentHTML('beforeend', `
        <div class="card" style="margin-top:14px"><div class="card-header"><h3 style="font-size:13px">📄 From quotes — not yet in CRM (${list.length})</h3></div>
        <div class="card-body">${list.map((u,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
          <div style="min-width:0"><div style="font-size:13px;font-weight:600">${escHtml(u.clientName)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${u.n} quote${u.n>1?'s':''}${u.quoteNumber?' · last '+escHtml(u.quoteNumber):''}</div></div>
          <button class="btn-secondary btn-sm cl-promote" data-i="${i}">＋ Save to CRM</button></div>`).join('')}</div></div>`);
      el.querySelectorAll('.cl-promote').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        const id = await window.Clients.upsertFromQuote(list[+b.dataset.i]);
        if (id) { Notifs.showToast('Client saved to CRM'); renderClientProfiles(container, currentUser, currentRole, brand); }
        else { b.disabled = false; Notifs.showToast('Save failed','error'); }
      }));
    } catch(_){}
  })();
```

### Spec 5 — Write-path FK stamping + stage auto-advance

**5a — bridge upsert (app.js:8195-8209 + the two call sites 8216/8232) BEFORE → AFTER.**
```js
// BEFORE (8195-8209): upsertClient closure — whole-collection scan of
// sales_clients/bs_clients, name-matched client-side, set(merge). Called AFTER
// the quote .add() at 8216 and 8232; returns nothing.
```
```js
// AFTER — replace the whole closure (8195-8209) with:
    // Upsert into the UNIFIED client book and return the clientId to stamp on the
    // quote (decision 3). Partners never write the internal CRM (decision 10) —
    // their client names surface via the hub's "From quotes" section instead.
    const upsertClient = async () => {
      if (typeof isPartner === 'function' && isPartner()) return null;
      return await window.Clients.upsertFromQuote(data);
    };
```
`QUOTE_FILED` branch (8211-8216): move the upsert ABOVE the add and stamp the FK —
```js
      data.status = 'filed';
      data.approvalStatus = 'filed';
      data.filedAt = firebase.firestore.FieldValue.serverTimestamp();
      data.clientId = await upsertClient();        // FK stamped BEFORE the quote is written
      await db.collection(coll).add(data);
      // (delete the old post-add `await upsertClient();` line)
```
`QUOTE_APPROVAL_REQUESTED` branch (8228-8232): same pattern —
```js
      data.status = 'pending_approval';
      data.approvalStatus = 'pending_review';
      data.reviewRequestedAt = firebase.firestore.FieldValue.serverTimestamp();
      data.clientId = await upsertClient();        // FK stamped BEFORE the quote is written
      const docRef = await db.collection('bs_quotes').add(data);
      // (delete the old post-add `await upsertClient();` line)
```

**5b — thread `clientId` through the Sales-Order buttons.** `openSalesOrderModal` receives a DOM
`dataset` (departments.js:6620/9650), so the id must ride a data-attribute. Add
`data-client-id="${q.clientId||''}"` to BOTH button templates:
- departments.js:6597 (`.bk-so-btn`, BK quotations summary)
- departments.js:9155 (`.bs-so-btn`, BS quotations summary)
(`dataset.clientId` then surfaces as `d.clientId`; empty string is falsy — no other change.)

**5c — stamp the FK on orders + projects.** In `openSalesOrderModal` (departments.js:9337-9342)
add to the `sales_orders` add-payload, after `company`:
```js
        clientId: d.clientId || null,
```
In `createJobProject` (departments.js:12025-12037) add to the `job_projects` add-payload, after
`clientName:d.client||'',`:
```js
    clientId: d.clientId || null,
```
(`openSalesOrderModal` already spreads `{...d, total:contract}` into `createJobProject`, so
`d.clientId` flows through unchanged.)

**5d — stage auto-advance (the win-rate/CRM glue, decision 8).** In `openSalesOrderModal`,
immediately after step 4 (the `job_projects` documents-register update, ~9351) insert:
```js
      // 4b) CRM: a client with a signed order is WON — keeps client stage and the
      // quote-outcome win rate from drifting apart (v12 WS32 decision 8).
      try {
        let cid = d.clientId || null;
        if (!cid) { const c0 = await window.Clients.findByName(d.client); cid = c0 && c0.id; }
        if (cid) {
          await db.collection('clients').doc(cid).update({ stage:'won', updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('clients');
        }
      } catch(_){ /* best-effort — never block the order */ }
```

### Spec 6 — Brilliant Steel wiring (the orphan fix, decision 2)

`loadBSContent` (departments.js:8382-8389), `'Client Data'` case BEFORE → AFTER:
```js
// BEFORE:    case 'Client Data':        await renderBSClientData(content, currentUser, currentRole); break;
// AFTER — partners keep the quote-derived accordion (already scoped by bs_quotes
// rules); internal staff get the unified CRM hub with stages/follow-ups/timeline:
    case 'Client Data': {
      const partnerView = currentRole === 'partner' ||
        ((window.currentDepts || []).length === 1 && (window.currentDepts || [])[0] === 'Brilliant Steel');
      if (partnerView) await renderBSClientData(content, currentUser, currentRole);
      else await renderClientProfiles(content, currentUser, currentRole, 'brilliant-steel');
      break;
    }
```
`renderBSClientData` (9750-9865) is **NOT edited** — it remains the partner path (its
`isPrivileged` branch simply stops being reached). The `bs-clients` nav route (app.js:2012) is
unchanged (it routes through `renderBrilliantSteel` → the case above).

### Spec 7 — Analytics rewire (app.js:6357-6379 fetch + 6521-6579 `renderSales`)

**7a — fetch swap.** Line 6370 BEFORE `cg('sales_clients', db.collection('sales_clients')),` →
AFTER `window.Clients.listAll().catch(()=>[]),` — and line 6375 BEFORE
`const salesClients=(clientsSnap.docs||[]).map(d=>d.data());` → AFTER
`const allClients = Array.isArray(clientsSnap) ? clientsSnap : [];` (rename the Promise.all
binding `clientsSnap` usage accordingly; it now yields an array, not a snapshot).

**7b — `renderSales` head (6522-6540) BEFORE → AFTER.** Replace the metric block:
```js
// AFTER — canonical outcome helpers (decision 8); CRMP duplicate deleted (decision 9).
    const salesQuotes=quotes.filter(q=>q.department==='Sales'||q.type==='sales'||!q.department);
    const wonQ   = salesQuotes.filter(window.isQuoteWon);
    const lostQ  = salesQuotes.filter(window.isQuoteLost);
    const openQ  = salesQuotes.filter(window.isQuoteOpen);
    const won2     = wonQ.reduce((s,q)=>s+(q.total||q.grandTotal||0),0);
    const pipeline = openQ.reduce((s,q)=>s+(q.total||q.grandTotal||0),0);
    const wonCount = wonQ.length, lostCount = lostQ.length;
    const winRate  = wonCount+lostCount>0 ? Math.round(wonCount/(wonCount+lostCount)*100) : 0;
    const salesSubs=subs.filter(s=>s.department==='Sales'||s.type?.includes('sales'));
    const salesTasks=tasks.filter(t=>t.department==='Sales'||t.category==='Sales');
    const doneSalesTasks=salesTasks.filter(t=>['done','approved','archived'].includes(t.status));
    const wonMTD =sum(wonQ.filter(q=>ymOf(q.createdAt)===thisMonth),q=>q.total||q.grandTotal||0);
    const wonPrev=sum(wonQ.filter(q=>ymOf(q.createdAt)===lastMonth),q=>q.total||q.grandTotal||0);
    const avgDeal=wonCount?won2/wonCount:0;
    // CRM funnel — ALL brands, one cached read (decision 9). Taxonomy = the shared
    // window.CRM_STAGES export; the inline CRMP literal is DELETED.
    const stageCount={lead:0,prospect:0,won:0,lost:0};
    allClients.forEach(cl=>{ stageCount[window.crmStageOf(cl)]++; });
    const clTotal=allClients.length;
    const clWon=stageCount.won, clLost=stageCount.lost;
    const clConv = clWon+clLost>0 ? Math.round(clWon/(clWon+clLost)*100) : null;
    const _anToday=(window.bizDate?window.bizDate():new Date().toISOString().slice(0,10));
    const dueFu=allClients.filter(cl=>cl.followUpDate&&cl.followUpDate<=_anToday&&!['won','lost'].includes(window.crmStageOf(cl))).length;
```
The "Win Rate" KPI tile copy becomes:
`<div class="kpi-label">Win Rate (quotes)</div>` with the sub-line `${wonCount}W / ${lostCount}L`.

**7c — the merged card (replaces the CRM Pipeline card, 6551-6556):**
```js
      ${clTotal?`<div class="card" style="margin-bottom:16px">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
          <h3>CRM Pipeline · All Brands</h3>
          <span style="font-size:12px;color:var(--text-muted)">${clTotal} client${clTotal===1?'':'s'}${dueFu?` · <span style="color:var(--danger)">${dueFu} follow-up${dueFu>1?'s':''} due</span>`:''}</span>
        </div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px">
            ${window.CRM_STAGES.map(s=>`<div style="background:var(--surface2);border-radius:10px;padding:10px 12px"><div style="font-size:11px;color:var(--text-muted)">${s.icon} ${s.label}</div><div style="font-size:18px;font-weight:800;color:${s.color}">${stageCount[s.key]}</div><div style="font-size:10px;color:var(--text-muted)">${clTotal?Math.round(stageCount[s.key]/clTotal*100):0}%</div></div>`).join('')}
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:10px;border-top:1px solid var(--border);padding-top:8px">
            Client conversion: <strong>${clConv==null?'—':clConv+'%'}</strong> (won vs lost clients) ·
            Quote win rate: <strong>${winRate}%</strong> (won vs lost quotes — the authoritative KPI above).
            Creating a Sales Order auto-moves the client to ✅ Won.
          </div>
        </div>
      </div>`:''}
```

**7d — Quote Status Breakdown chart (6570-6572) BEFORE → AFTER.** The hardcoded
`['draft','sent','accepted','rejected']` misses every modern bk/bs status. Replace with the
canonical three buckets:
```js
    if (!window.Chart) { await window.ensureChart(); }
    new Chart(document.getElementById('sq-chart'),{type:'bar',data:{labels:['Open','Won','Lost'],
      datasets:[{data:[openQ.length,wonQ.length,lostQ.length],backgroundColor:['#0A84FF','#30D158','#FF453A']}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{color:'#ebebf5bb'},grid:{color:'#ffffff18'}},x:{ticks:{color:'#ebebf5bb'},grid:{display:false}}}}});
```
Recent-quotes row color (6565) → `const statusColor = window.isQuoteWon(q)?'#30D158':window.isQuoteLost(q)?'#FF453A':'#0A84FF';`

### Spec 8 — Other read-site updates (enumerated so none gets missed)

| # | File:line | Change |
|---|-----------|--------|
| 1 | modules.js:2495-2497 (global search) | Replace the three `dbCachedGet('sales_clients'/'design_clients'/'bs_clients', …)` fetches with ONE `window.Clients.listAll().catch(()=>[])`; build `clients: cl.map(x=>({...x, _brand:(x.brands&&x.brands[0])==='design'?'design':(x.brands&&x.brands.includes('bs'))?'bs':'sales'}))` so existing `_brand` labels keep working. Adjust the destructuring (`sc, dc, bsc` → `cl`). |
| 2 | departments.js:10095 (Approvals count) | `db.collection('bs_clients').where('deleteRequested','==',true)` → `db.collection('clients').where(…)` |
| 3 | departments.js:10175 (Approvals list) | same one-line swap as #2 |
| 4 | departments.js:10454 + 10461 (approve/deny handlers) | `db.collection('bs_clients').doc(…)` → `db.collection('clients').doc(…)` (both the `.delete()` and the deny-`.update()`). **Note:** this queue previously ONLY queried `bs_clients`, so Sales/Design client delete-requests never appeared in Approvals at all — unification silently fixes that bug; call it out in the commit message. |
| 5 | scripts/monthly-backup.js (collections list, ~line 190 region) | Add `{ name: 'clients', dateField: null }` to the exported-collections list (none of the three legacy client books was ever backed up — new gap being closed). |

### Spec 9 — firestore.rules diff + migration function + rollout order

**9a — rules (block-scoped BEFORE → AFTER; same comment-then-match style; deploy via
`firebase deploy --only firestore:rules`, re-diffing live first per the concurrent-edit
memory).**
```
// BEFORE (rules 1112-1123)
    // ── Client CRM (per brand) ─────────────────────────
    // sales_clients (Barro/Sales), design_clients (Design), bs_clients
    // (Brilliant Steel). Shared internal CRM — any signed-in staffer can read;
    // sales/design/admin roles maintain the records.
    // Read + create/update by any signed-in staff (also lets non-admins flag a
    // delete request). Actual DELETE is admin-only — others must request approval.
    // sales_clients / design_clients are INTERNAL CRMs — external partners excluded
    // from reading (null-safe getRole(): null treated as "not partner"). bs_clients
    // is the Brilliant-Steel CRM and STAYS readable by the partner.
    match /sales_clients/{docId}  { allow read: if isAuth() && !isPartner(); allow create, update: if isAuth(); allow delete: if isAuth() && isAdmin(); }
    match /design_clients/{docId} { allow read: if isAuth() && !isPartner(); allow create, update: if isAuth(); allow delete: if isAuth() && isAdmin(); }
    match /bs_clients/{docId}      { allow read: if isAuth(); allow create, update: if isAuth(); allow delete: if isAuth() && isAdmin(); }
```
```
// AFTER
    // ── Client CRM — UNIFIED (v12 WS32) ────────────────
    // ONE `clients` collection (brands[] tags Sales/Design/BS membership); the
    // three per-brand books below are read-only archives kept for the audit
    // trail. INTERNAL-ONLY: partners never read/write the client book — their
    // Client Data view derives from their own bs_quotes (already partner-scoped).
    // This deliberately closes the old hole where any BS partner could read the
    // ENTIRE bs_clients book. create/update require a non-empty string name via
    // .get(field,default) (missing-field-throws memory); note request.resource.data
    // is the full post-write doc, so field-patch updates still pass. DELETE is
    // admin-only — everyone else uses the deleteRequested flag (President queue).
    match /clients/{docId} {
      allow read:   if isAuth() && !isPartner();
      allow create, update: if isAuth() && !isPartner()
        && request.resource.data.get('name', '') is string
        && request.resource.data.get('name', '') != '';
      allow delete: if isAuth() && isAdmin();
    }
    // Legacy archives (records-forever directive): staff read, admin-only write
    // (migration stamps `migratedTo`), nothing else. Partner read of bs_clients
    // is REMOVED — no partner-facing code ever read it (grep-verified WS32 brief).
    match /sales_clients/{docId}  { allow read: if isAuth() && !isPartner(); allow write: if isAuth() && isAdmin(); }
    match /design_clients/{docId} { allow read: if isAuth() && !isPartner(); allow write: if isAuth() && isAdmin(); }
    match /bs_clients/{docId}      { allow read: if isAuth() && !isPartner(); allow write: if isAuth() && isAdmin(); }
```
No changes to `bk_quotes`/`bs_quotes`/`quotes`/`sales_orders`/`job_projects` rules — `clientId`
is an additive field and none of those blocks shape-validate. No firestore.indexes.json changes
(single-field equality queries only).

**9b — `window.migrateClientBooks()`** (departments.js, place next to `backfillProjectKind`
~line 101; runs in a president/manager session — legacy stamps need `isAdmin`, `sales_orders`
updates need `canFinance` = president/manager/finance ✓, `job_projects` updates pass
`!isPartner` ✓):
```js
// One-click, RE-RUNNABLE unification: legacy books → `clients`, then clientId
// backfill onto sales_orders/job_projects. Idempotency: legacy docs stamped
// `migratedTo` are skipped; same-name records MERGE (brands arrayUnion +
// fill-only-empty fields) instead of duplicating; FK backfill skips rows that
// already carry clientId. Safe to re-run after a partial failure.
window.migrateClientBooks = async function () {
  const FV = firebase.firestore.FieldValue;
  const key = window.Clients.nameKey;
  const out = { created:0, merged:0, skipped:0, soTagged:0, jpTagged:0, unmatched:0 };
  const cur = await db.collection('clients').get().catch(() => ({ docs: [] }));
  const byKey = {};
  cur.docs.forEach(d => { const x = d.data(); byKey[x.nameKey || key(x.name)] = { id: d.id, ...x }; });
  const RANK = { lead:0, prospect:1, won:2, lost:0 };   // 'lost' never overwrites a live stage
  for (const [coll, brand] of [['sales_clients','sales'], ['design_clients','design'], ['bs_clients','bs']]) {
    const snap = await db.collection(coll).get().catch(() => ({ docs: [] }));
    for (const d of snap.docs) {
      const src = d.data();
      if (src.migratedTo) { out.skipped++; continue; }
      const k = key(src.name); if (!k) { out.skipped++; continue; }
      const target = byKey[k];
      if (target) {   // MERGE: add brand, fill only-empty fields, keep the further-along stage
        const patch = { brands: FV.arrayUnion(brand), legacyRefs: FV.arrayUnion({ coll, id: d.id }), updatedAt: FV.serverTimestamp() };
        ['company','email','phone','address','notes','followUpDate','lastContact','lastQuoteNumber'].forEach(f => { if (!target[f] && src[f]) patch[f] = src[f]; });
        if ((RANK[src.stage] || 0) > (RANK[target.stage] || 0)) patch.stage = src.stage;
        await db.collection('clients').doc(target.id).set(patch, { merge: true });
        out.merged++;
      } else {        // CREATE: full copy, createdAt preserved so ordering/history survive
        const base = { name:(src.name||'').trim(), nameKey:k, brands:[brand],
          company:src.company||'', email:src.email||'', phone:src.phone||'', address:src.address||'', notes:src.notes||'',
          stage: ['lead','prospect','won','lost'].includes(src.stage) ? src.stage : 'lead',
          followUpDate:src.followUpDate||'', lastContact:src.lastContact||'', contactLog:[],
          lastQuoteNumber:src.lastQuoteNumber||'', lastQuoteTotal:src.lastQuoteTotal||0,
          legacyRefs:[{ coll, id:d.id }], createdBy:src.addedBy||src.createdBy||null,
          createdAt: src.createdAt || FV.serverTimestamp(), updatedAt: FV.serverTimestamp() };
        const ref = await db.collection('clients').add(base);
        byKey[k] = { id: ref.id, ...base };
        out.created++;
      }
      await db.collection(coll).doc(d.id).set({ migratedTo: { coll:'clients', id: byKey[k].id } }, { merge: true });
    }
  }
  // clientId FK backfill — unique nameKey match; no match → stays null (the
  // nameKey fallback in Clients.quotesFor/timelineFor is the reconciliation).
  for (const coll of ['sales_orders', 'job_projects']) {
    const snap = await db.collection(coll).get().catch(() => ({ docs: [] }));
    for (const d of snap.docs) {
      const r = d.data(); if (r.clientId) continue;
      const hit = byKey[key(r.clientName)];
      if (hit) { await db.collection(coll).doc(d.id).update({ clientId: hit.id }); (coll === 'sales_orders') ? out.soTagged++ : out.jpTagged++; }
      else out.unmatched++;
    }
  }
  if (typeof dbCacheInvalidate === 'function') ['clients','sales_orders','projects-unified','job_projects'].forEach(dbCacheInvalidate);
  return out;
};
```

**9c — rollout order (numbered):**
1. **Deploy rules first** (9a) — re-diff against live immediately before deploying (concurrent
   OneDrive/session edits memory). The new `clients` block must exist before any JS writes it.
2. **Ship the JS in one commit:** config.js (2a), departments.js (2b/2c, Spec 3, Spec 4,
   5b-5d, Spec 6, 9b, delete-queue swaps), app.js (5a, Spec 7), modules.js (Spec 8 #1),
   scripts/monthly-backup.js (Spec 8 #5). `node --check` each edited file; the pre-commit hook
   auto-bumps `APP_VERSION` AND `CACHE_VER` (verify both landed in the commit diff — sw.js must
   show a new `bi-ops-v*`).
3. **Run the migration immediately after deploy:** Neil (president) opens Sales → Clients →
   "Unify client books" banner → confirm. Until this runs, all client screens show the legacy
   read-only compat view with editing disabled — do not leave the app in that state overnight.
4. **Verify the toast counts** (created/merged/linked/unmatched) and spot-check: one sales
   client, one design client, one bs client, one merged duplicate, one sales_order and one
   job_project carrying `clientId`.
5. **Re-run the migration once** — second run must report 0 created / 0 merged (all skipped):
   proves idempotency.
6. Legacy collections stay as read-only archives indefinitely (records-forever). Optional
   president-only cleanup (delete after 1-2 stable months) is explicitly OUT of this
   workstream.

### Spec 10 — Manual test checklist (no automated suite)

1. **Migration:** run "Unify client books" → toast counts match the sum of the three legacy
   books (minus name-duplicates, which report as merged); re-run → all skipped, zero writes.
2. **Sales hub:** Sales → Clients lists the migrated book; chip-tab stage filter, follow-up
   due-banner, Add/Edit (stage select + follow-up date), delete-request all work; an edit
   appears instantly after save (cache invalidated).
3. **Cross-brand identity:** a client that existed in both `sales_clients` and `bs_clients`
   appears ONCE with both brand badges, in both the Sales hub and the BS internal hub.
4. **Hub modal:** clicking a client with quotes+order+payments shows the timeline (📄 quote, 🧾
   order with "(₱X received)", 🏭 project events, 💰 payments, 📎 documents), the stats strip
   (Won ₱ now counts only `salesOrderId`/`won`/`accepted` quotes — 'filed'-only quotes NO
   LONGER count), Projects mini-list, and per-quote Reopen/New Revision that opens the correct
   builder (BK vs BS) from the correct collection.
5. **Contact log / follow-ups:** "📞 Log contact" appends a `contactLog` entry + sets
   lastContact; "✓ Done" clears/reschedules `followUpDate` and logs an entry; both appear in
   the timeline after reopening.
6. **FK stamping:** file a new quote from the builder as an internal user → the new
   `bk_quotes`/`bs_quotes` doc carries `clientId`, and the `clients` doc's
   `lastQuoteNumber`/`lastQuoteTotal` updated; the same client is NOT duplicated (nameKey
   match). File as a PARTNER → no `clients` write occurs, quote saves normally with
   `clientId:null`, and the client's name shows in the internal BS hub's "From quotes" section;
   "＋ Save to CRM" promotes it.
7. **Stage auto-advance:** create a Sales Order from a won quote → the client's stage flips to
   ✅ Won without manual editing; Analytics funnel and the client card agree.
8. **Brilliant Steel split:** as a partner, Client Data shows the old quote-accordion (own
   quotes only — unchanged); as president, the same tab shows the CRM hub filtered to BS.
9. **Analytics:** Sales subtab Win Rate now counts modern `won` quotes (number changes vs the
   old accepted-only calc — expected); "CRM Pipeline · All Brands" card shows funnel + the
   "Client conversion vs Quote win rate" footer; quote-status chart shows Open/Won/Lost.
10. **Approvals queue:** a delete-request on a SALES client now appears in the Approvals queue
    (previously only bs_clients requests did); approve deletes the `clients` doc; deny clears
    the flag.
11. **Rules:** as a partner (console): `clients` read → DENIED; create → DENIED; `bs_clients`
    read → DENIED (archive closed). As an employee: `clients` create with empty name → DENIED;
    with a name → allowed. As admin: `sales_clients` write (stamp) → allowed.
12. **Global search:** searching a client name returns one unified hit (not up to three), with
    the correct brand label.

### Spec 11 — Cross-workstream contract (WS31/33/34/35/36/38/40 read THIS, not the code)

- **WS31 (Quotation builder v3) — runs AFTER WS32.** Must preserve: (1) `data.clientId`
  stamping in the bridge (upsert-before-add, Spec 5a) through any chain rework — including its
  fix for the `QUOTE_APPROVAL_REQUESTED`-always-into-`bs_quotes` stranding (app.js:8225-8231),
  which WS32 deliberately did NOT touch; (2) the `isQuoteWon/isQuoteLost/isQuoteOpen` contract —
  if WS31 rationalizes the status/approvalStatus vocabulary it updates those three helpers in
  config.js ONLY (single point), never per-screen; (3) SHOULD add a builder-side client picker
  that sends `payload.clientId` (then `upsertFromQuote` can trust it and skip the name query —
  the typo-duplicate path closes fully).
- **WS33 (AEC directory):** `aec_contacts` stays a separate collection (decision 11) but reuses
  `window.CRM_STAGES` for any stage lifecycle and links a contact to a client via `clientId`
  into `clients` — no parallel contact pattern.
- **WS34 (Marketing):** the leads inbox WRITES `clients` docs (`stage:'lead'`,
  `brands:['sales']`, plus its own `campaignId`/`source` fields — reserved names, additive, no
  rules change needed beyond the non-empty-name guard). Campaign→quote attribution =
  `clients.campaignId` + `quote.clientId` (both now exist); wins = `isQuoteWon`. Never re-derive
  a name-match.
- **WS35 (Design suite):** "one client record shared, per-dept views" is DELIVERED here —
  WS35 must NOT re-unify. Its `projects.clientId` FK points into `clients` (NOT
  `design_clients`, which is a frozen archive); its client-folder linkage uses the same
  `clientId`; the Design Clients tab is already the shared hub (brand 'design').
- **WS36 (Finance additions):** payment truth stays `job_projects.payments[]` until WS36 says
  otherwise; if WS36 introduces invoice/downpayment-billing docs they MUST carry
  `clientId` + `projectId`; if it relocates payment truth, it updates `Clients.timelineFor`
  (the ONLY payment reader on the client side) in the same change.
- **WS38 (Files Hub):** adds optional `clientId` to file docs (exact field name reserved
  here); the hub's Files panel is then one cached query added inside `Clients.timelineFor` —
  no other surface changes.
- **WS40 (Analytics):** all client rollups via `Clients.listAll()`; all win/loss math via the
  three config.js helpers; the `clients` cache key and `CRM_STAGES` export are the canonical
  sources. Any new chart that needs "revenue per client" joins `ledger.projectId →
  job_projects.clientId` — do not scan `ledger.description` for names.
- **WS16 (perf, shipped):** keys honored — `'clients'` (new canonical, 60s),
  `'all-quotes'`/`'projects-unified'` (reused), `'sales_orders'` (new, 60s);
  `dbCacheInvalidate('clients')` on every client write. The two previously-uncached client
  reads are gone with their callers.

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
