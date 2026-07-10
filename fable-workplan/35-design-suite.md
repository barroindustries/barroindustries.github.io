# Workstream 35 — Design dept suite (shared client folders, drawing approvals, design→production handoff)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

Plan text (V12-PLAN.md:207-209): "35. [ ] Design dept suite — project folders + client
folders synced with Sales client files (one client record shared, per-dept views); drawing
approvals; design → production handoff." All line numbers below re-verified live via
grep/Read against the current checkout — this is emphatically NOT greenfield: `renderDesign`
already exists and is a fully-built, multi-tab department (projects, drawing revision
control, financials, a client CRM, file libraries, tasks). The mandate is asking for THREE
specific extensions to that existing suite, not a new department screen.

1) **THE EXISTING DESIGN SCREEN.** `window.renderDesign` (js/departments.js:6789-6803) renders
six subtabs — `chipTabs(['Projects','Drawings','Clients','Product Designs','References','Tasks'])`
— dispatched by `loadDesignContent` (6805-6823):
```js
switch(sub) {
  case 'Projects':    await renderProjects(content, currentUser, currentRole); break;
  case 'Drawings':    await renderDrawingsDashboard(content, currentUser, currentRole); break;
  case 'Clients':     await renderClientProfiles(content, currentUser, currentRole, 'design'); break;
  case 'Product Designs': content.innerHTML = renderFileCollection(...); bindFileCollection('design-files', ...); break;
  case 'References':      content.innerHTML = renderFileCollection(...); bindFileCollection('design-refs', ...); break;
  case 'Tasks': await renderDeptTasks(content, 'Design', currentUser, currentRole); break;
}
```
None of the six are stubs. `DEPARTMENTS.Design` (js/config.js:153-156) already lists the same
six subtabs and navOrder:6; `Production` is a separate, real department (config.js:157-160,
subtabs Orders/Materials/Tasks/Files) with its own `window.renderProductionDept`
(departments.js:12377-12396).

2) **PROJECTS — a real board, already deep, in a collection named `projects` (deliberately NOT
`job_projects`).** `renderProjects` (6830-6900) reads top-level `projects`, ordered by
`createdAt desc`. Clicking a card opens `window.openProjectDetail` (6949-6977) — a 5-tab modal
(Overview/Drawings/Tasks/Financials/Activity), already fully wired:
   - **Overview** (`renderProjOverview`, 6980-7000): client, status, start/due, `designLead`/
     `designLeadName` (a per-project design lead field — set but, see item 4, never used for
     approval gating), and a `jobProjectNo` badge if linked to the Sales/Production spine.
   - **Financials** (`renderProjFinancials`, 7003-7159): already has full payment recording
     (`db.runTransaction` appending to a `payments[]` array), a "Create Billing Invoice"
     generator (`INV-{date}-{seq}` numbering), and a best-effort ledger post on every payment
     with a deterministic idempotency ref — quoted verbatim (7082-7096):
     ```js
     const dref = `DPROJ-${p.id}-${Math.max(0, saved.length - 1)}`;
     const dDupe = await db.collection('ledger').where('refNumber','==',dref).limit(1).get()...
     if (dDupe.empty) { await db.collection('ledger').add({ ..., source:'Design', projectId:p.id, ... }); }
     ```
   - **Tasks** (`renderProjectTasks`, 7162-7179) and **Activity** (`renderProjActivity`,
     7182-7195) — Activity already merges `payments`, `invoices`, and every `design_drawings`
     doc's own `activity[]` array (queried by `projectId`) into one timeline.
   - **Edit modal** (`openProjectEditModal`, 7198-7304) already supports: rename; a **"Client
     (link to Design CRM)"** dropdown of `design_clients` docs (`clientId`) *plus* a separate
     free-text "Client name (display)" field (`client`) — two parallel, independently-editable
     identity fields for the same client, confirmed at 7211-7216, 7266-7271; Design Lead
     assignment; multi-member Team delegation (`team[]`/`teamNames[]`, with per-member
     notifications, 7291-7295); and a **"Link to Job Project (Sales/Production lifecycle)"**
     dropdown (7238-7242) writing `jobProjectId`/`jobProjectNo` onto the `projects` doc. On
     save, this notifies newly-added team members AND, only if the job-link is newly set,
     notifies the **Finance** dept (7296-7299) — not Production, not Sales.

3) **DRAWINGS — a real revision-controlled workflow already exists; "approval" is self-service,
   not gated to a distinct approver.** `design_drawings` is a flat, top-level, `projectId`-scoped
   collection (not a subcollection — comment at 6903-6904 explains this is deliberate, so the
   cross-project Drawings dashboard can be one flat query). Status model (6906-6912):
   ```js
   const DRAWING_STATUSES = [
     {id:'draft',label:'Draft'}, {id:'for_review',label:'For Review'},
     {id:'approved',label:'Approved'}, {id:'released',label:'Released'},
     {id:'superseded',label:'Superseded'},
   ];
   ```
   Forward transitions (6917-6926): draft→for_review ("Submit for Review"), for_review→approved
   ("✅ Approve") or back to draft, approved→released ("🚀 Release") or back to review,
   released→superseded, superseded→draft (reactivate). Every transition button in
   `openDrawingDetail` (7385-7423) is gated by the SAME single check:
   `const canManage = canEditDept('Design');` (7387) and `const trans = canManage ?
   drawingTransitions(d.status) : [];` (7393) — **there is no separate submitter-vs-approver
   role anywhere in the client code or in `firestore.rules`.** Any Design-dept member (any
   role — even a plain `employee` whose `departments[]` includes `'Design'`) or any admin role
   can create a drawing, submit it for review, approve it, AND release it — the exact same
   `canManage` boolean gates all four actions. The doc schema DOES carry
   `reviewer`/`reviewerName`/`approver`/`approverName`/`approvedAt` fields, written at creation
   (`openDrawingCreateModal`, 7368): `reviewer:null, reviewerName:null, approver:null,
   approverName:null, approvedAt:null` — but grep across the whole repo confirms
   `reviewer`/`reviewerName` are written ONCE (always null) and never read or set again
   anywhere; they are dead/vestigial, apparently a hint that a distinct-reviewer tier was once
   planned but never built. `approver`/`approverName`/`approvedAt` ARE populated on the
   `'approved'` transition (`changeDrawingStatus`, 7435: `update.approver=currentUser.uid;
   update.approverName=who; update.approvedAt=...`), but this only *records who clicked the
   button* — it is not a second authorization check independent of `canManage`. Also notable:
   the parent `projects` doc's `designLead`/`designLeadName` field (item 2) — a natural
   "who's responsible for this project's drawings" hook — is never referenced by
   `drawingTransitions`/`changeDrawingStatus` at all; it sits unused right next to the exact
   code that would need it for a real approval gate. Revisions (`openDrawingRevisionModal`,
   7462-7497) always reset `status:'draft'` and clear `approver`/`approverName` on save — so a
   new revision correctly forces re-approval; there is no stale-approval-carries-forward bug.
   Firestore rules (709-720) mirror the client gate exactly: `allow update: if isAuth() &&
   (resource.data.get('createdBy','')==uid || resource.data.get('assignedTo','')==uid ||
   canDesign())` — `canDesign()` (firestore.rules:52) is `isAdmin() || isDesignDept()`, i.e. the
   security rule permits the identical self-approval the UI already allows; there is no
   rules-level backstop even if a future UI added a reviewer check client-side only.

4) **DESIGN → PRODUCTION HANDOFF — a real but partial, optional, notification-only mechanism
   already exists.** The entire mechanism lives inside `changeDrawingStatus`
   (7425-7460), quoted verbatim for the release branch:
   ```js
   if (to==='released') {
     await Notifs.sendToDept('Production',{title:'📐 Drawing released', body:`"${d.title}" (${project?.name||d.projectName||''}) is released for production`, icon:'📐', type:'drawing_released'});
     if (project?.jobProjectId) {
       await db.collection('job_projects').doc(project.jobProjectId).update({
         documents: firebase.firestore.FieldValue.arrayUnion({ type:'Drawing', ref:`${d.title} Rev ${d.currentRev||'A'}`, at:nowIso, by:who }),
         timeline:  firebase.firestore.FieldValue.arrayUnion({ at:nowIso, event:`Drawing released: ${d.title} Rev ${d.currentRev||'A'}`, by:who }),
         updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
       });
     }
   }
   ```
   Two independent effects, both best-effort (wrapped in a try/catch whose comment at 7442
   reads "never block the status change"): (a) an in-app notification to the whole Production
   **department** (not a specific person, not a task); (b) an `arrayUnion` append into
   `job_projects/{jobProjectId}.documents` and `.timeline` — but ONLY if the Design project's
   `jobProjectId` was manually set via the optional dropdown in item 2's edit modal. If a
   Design project was never linked to a `job_projects` record (e.g. purely internal design work,
   or work started before a quote existed), releasing its drawings produces ONLY the
   dept-wide toast — nothing is ever written anywhere Production's screens actually query.
   Confirmed by reading `openJobProjectDetail` (12108-12164): its "📄 Document Register"
   (12134-12137) and "🕘 Timeline" (12145-12146) sections literally render `p.documents`/
   `p.timeline`, so a released drawing's entry IS visible there — but only to whoever opens
   that specific `job_projects` record, and only if linked. `renderProdOrders`
   (12409-12454, Production's own "Orders" subtab) reads `production_orders` +
   `job_projects` — filtering `job_projects` for `stage in ['won','in_production']` with no
   `productionOrderIds` yet to surface "incoming jobs" (12417-12423) — but it never queries
   `projects` or `design_drawings` directly at all. No `production_orders` row is ever
   auto-created on drawing release; no task is ever auto-delegated to a Production user; no
   `job_projects.stage` transition is ever triggered by a drawing event. **Summary: this is a
   real, working, but shallow handoff — a dept-wide notification plus an optional audit-trail
   append — not a gated, guaranteed, or actionable handoff.**

5) **A pre-existing partial bridge between the two "project" concepts already exists and is a
   direct architectural precedent.** `job_projects` (the Sales→Production→Finance "spine",
   comment at 11996-11999: "quote→order→production→delivery→paid... Named job_projects to
   avoid the unrelated Design 'projects' board") and `projects` (the Design board) are two
   separate top-level collections with different schemas and different `firestore.rules`
   blocks. `window.Projects` (departments.js:55-97) is an existing **unified read-only layer**
   over both:
   ```js
   window.Projects = (function() {
     function normalize(doc, kind) { /* → {id, kind, no, name, clientName, contractAmount,
       collected, arBalance, stage, payments, invoices, jobProjectId, partnerUid, createdAt, raw} */ }
     async function listAll(scope) { /* fetches job_projects + projects, normalizes both, concatenates */ }
     return { normalize, listAll, sumPayments };
   })();
   ```
   cached under key `'projects-unified'` (30s TTL, `dbCachedGet`). It is used by
   `window.renderProjectLifecycle` (12042-12103, the Sales/Finance "Projects" pipeline screen)
   to show a read-only **"🎨 Design Projects"** section below the main job pipeline (comment,
   12049-12050: "Design-board projects (separate collection) shown read-only below, so this
   page is the single place to see ALL projects... Partners never see the internal board.") —
   but only the job-project cards (`.proj-card`) get a click handler (12102); the Design-project
   cards in that section are inert, captioned "manage in Design → Projects." A companion
   idempotent one-time tagging utility, `window.backfillProjectKind`/`window.
   runProjectKindBackfill` (101-127), already stamps a `kind:'job'|'design'` field onto both
   collections (batched, skips already-tagged docs) — direct, reusable precedent for however
   Fable chooses to relate/merge/cross-link Design and Production data further.

6) **CLIENT FRAGMENTATION — three separate collections for what the mandate calls "one client
   record."** `sales_clients` (Sales' Clients tab, `renderClientProfiles(...,'barro')` at
   departments.js:5526), `design_clients` (Design's Clients tab, `renderClientProfiles(...,
   'design')` at 6810), and `bs_clients` (Brilliant Steel partner CRM) are rendered by ONE
   shared function, `renderClientProfiles` (11084-11208), which picks the collection purely
   from its `brand` argument (11085):
   ```js
   const collection = brand === 'brilliant-steel' ? 'bs_clients' : (brand === 'design' ? 'design_clients' : 'sales_clients');
   ```
   All three collections have an IDENTICAL schema (`name, company, email, phone, address,
   notes, stage, followUpDate, lastContact`) and share the same `CRM_STAGES`
   (lead/prospect/won/lost, 11075-11082, `crmStageOf`/`crmStageMeta`). This is "one shared
   UI + schema, three physically separate collections" — the inverse of what the mandate asks
   for ("one client record shared, per-dept views"). **No field anywhere links a `design_clients`
   doc to the `sales_clients` doc for the same real-world client** — if "ABC Corp" is a client
   of both Sales and Design, it exists as two fully independent documents whose name/company/
   contact fields can silently drift apart with zero referential integrity. Two existing
   precedents already merge the three collections at READ time without touching the schema:
   (a) `window.renderGlobalSearch` (js/modules.js:2489-2504) fetches all three via
   `dbCachedGet` and concatenates with a `_brand` tag (`{...x,_brand:'sales'|'design'|'bs'}`,
   2503) for one search box; (b) nothing else cross-references brands. Quote-to-client linking
   is itself fragile: `openClientQuotesModal` (11211+) matches quotes purely by
   `.where('clientName','==',cl.name)` (11222) — a client rename in any one brand's doc breaks
   that brand's own quote lookup today, a fragility any unification design inherits and should
   address. Rules for the three (firestore.rules:1121-1123) are almost identical except
   `bs_clients` drops the `!isPartner()` guard (the Brilliant Steel partner must read their own
   bs_clients) — quoted:
   ```
   match /sales_clients/{docId}  { allow read: if isAuth() && !isPartner(); allow create, update: if isAuth(); allow delete: if isAuth() && isAdmin(); }
   match /design_clients/{docId} { allow read: if isAuth() && !isPartner(); allow create, update: if isAuth(); allow delete: if isAuth() && isAdmin(); }
   match /bs_clients/{docId}      { allow read: if isAuth(); allow create, update: if isAuth(); allow delete: if isAuth() && isAdmin(); }
   ```
   Any unification into one physical collection must reproduce this partner-exclusion
   asymmetry, which plain Firestore document rules cannot do at the field level (only
   whole-document allow/deny) — a genuinely hard constraint on the "one client record" design.
   **CONFIRMED SAME FINDING IN A SIBLING BRIEF:** `fable-workplan/32-sales-crm.md` (WS32 —
   Sales Client Relations hub, researched independently this session) documents this identical
   three-collection split in more depth from the Sales side and should be read alongside this
   brief before Fable commits to a schema — it adds facts this brief did not independently
   re-derive: an auto-upsert writes a `sales_clients` or `bs_clients` doc whenever a quote is
   filed (`clientColl = (data.company==='BK')?'sales_clients':'bs_clients'`, app.js:8197-8216 —
   "so a `bs_clients` doc is created for ANY non-BK company, not just Brilliant Steel"), Design
   has NO equivalent auto-upsert (`design_clients` rows are 100% manually entered), Analytics'
   win-rate KPI reads `sales_clients` only (app.js:6370, disconnected from `design_clients`/
   `bs_clients`), and — worth restating because it sharpens the partner-visibility constraint
   above — WS32 phrases the `bs_clients` read rule even more starkly: "any Brilliant Steel
   partner can read the ENTIRE `bs_clients` book, not just their own clients."

7) **"PROJECT FOLDERS + CLIENT FOLDERS" (file storage) has no existing concept to extend —
   it is new ground for every department, not just Design.** Design's own file libraries
   ("Product Designs", "References" subtabs) are FLAT, department-wide buckets with zero
   project or client scoping: `renderFileCollection`/`bindFileCollection` (11379-11470) write
   to root collections named at runtime from the tab id (`files_design_files`,
   `files_design_refs`, computed at 11396: `` `files_${id.replace(/-/g,'_')}` ``) with fields
   `{name, url, source, uploadedBy, uploadedByName, createdAt}` — **no `projectId`, no
   `clientId`, anywhere in that schema.** Storage mirrors this flatness: `Drive.
   renderUploadArea` (js/drive.js:101-103) only accepts `{dept, subfolder}` as scoping, and
   `storage.rules`' generic department-folder rule (196-204) matches paths shaped
   `/{department}/{subfolder}/{fileName}` — e.g. Design's own drawing uploads land at
   `Design/Drawings/{fileName}` (`Drive.renderUploadArea(..., {dept:'Design',
   subfolder:'Drawings'})`, departments.js:7349) with no per-project or per-client path
   segment at all. **So "project folders" and "client folders" do not exist as a storage or
   data concept anywhere in the app today, for any department** — this part of the mandate is
   genuinely new, not a rename or extension of something half-built. Directly relevant:
   V12-PLAN's WS38 ("Files Hub") separately plans a generic cross-department
   "folders/subfolders" browser (V12-PLAN.md:217-219) — any WS35-specific per-project/
   per-client folder mechanism risks being immediately superseded by, or needing later
   reconciliation with, WS38's generic system. **CONFIRMED IN A SIBLING BRIEF:**
   `fable-workplan/38-files-hub.md` (researched independently this session) already treats
   `design_drawings`' `revisions[]`-array-on-doc pattern as **"the ONE existing precedent for
   'versions'"** in the entire codebase and explicitly plans to generalize it
   ("Versioning generalization — generalize `design_drawings`'s proven `revisions[]`-array-on-
   doc..."). This means the revision/versioning half of Design's drawing model is already
   slated to become WS38's shared foundation, not something WS35 should redesign in isolation —
   WS35's job here is narrower: the approval-gate and folder-scoping questions above, not the
   versioning mechanics, which should stay compatible with WS38's planned generalization.

8) **Two loose facts worth flagging while this exact code is being touched (not blockers, but
   adjacent).** (a) `job_projects` update rule (firestore.rules:1041) is
   `allow update: if isAuth() && (resource.data.createdBy == request.auth.uid ||
   !isPartner())` — i.e. ANY authenticated non-partner user, regardless of department, can
   already write any field of any `job_projects` doc; the drawing-release `arrayUnion` write
   in `changeDrawingStatus` needs no new rule to succeed today, the looseness already exists
   company-wide. (b) every timestamp Design's own drawing/project code writes for its
   activity/revision timelines uses raw `new Date().toISOString()`, NOT
   `window.bizDate()/bizHour()` — three call sites: `openDrawingCreateModal` (7359),
   `changeDrawingStatus` (7427), `openDrawingRevisionModal` (7475). This is the same class of
   bug the `manila_time_helpers` memory describes as having previously corrupted attendance +
   payroll; the blast radius here is smaller (only affects the displayed
   `.slice(0,16).replace('T',' ')` activity-feed date), but any workstream touching these exact
   lines should explicitly decide whether to fix it in passing or defer it. (c) cache
   invalidation for the `'projects-unified'` key (`window.Projects`'s 30s-TTL cache) fires
   after Design-side project/payment/invoice writes (7072, 7150, 7288) and one Production
   ledger-post site (12630), but NOT after `createJobProject`, `advanceProjectStage`, or
   `changeDrawingStatus`'s `job_projects` `arrayUnion` append — so a freshly-released drawing's
   timeline entry may not surface in any `window.Projects.listAll()`-backed view for up to 30
   seconds (self-healing on TTL expiry, not a correctness bug, but relevant if a new handoff
   feature is built on top of that cache).

## Data model

**`projects/{docId}`** (Design board, top-level): `name, client` (free-text display string),
`clientId` (optional FK into `design_clients`, independently editable from `client`),
`startDate, dueDate, status` ('active'|'on-hold'|'completed'|'cancelled'), `contractAmount`,
`notes`, `designLead, designLeadName` (FK into `users`, never read by any drawing-approval
code), `team[]` (uids), `teamNames[]`, `jobProjectId, jobProjectNo` (optional FK into
`job_projects`, the ONLY existing Design↔Production/Sales link, manually set), `payments[]`
(`{amount,date,method,note,byName,by}`), `invoices[]` (`{no,date,due,billTo,desc,amount,
notes,contractAmount,paidToDate,balanceBefore,projectName,issuedBy,createdAt}`), `createdBy,
createdAt`, `updatedAt`, and (if `backfillProjectKind` has run) `kind:'design'`. Rules
(firestore.rules:690-701): read `!isPartner()`; create any authed user; update
`createdBy==uid || isAdmin() || canFinance() || canDesign()`; delete admin-only.

**`design_drawings/{docId}`** (flat, top-level, `projectId`-scoped — NOT a subcollection):
`projectId, projectName` (denormalized), `title, drawingNo` (optional), `type` (one of
`DRAWING_TYPES = ['DWG','PDF','Drawing','3D','Render']`), `status` (one of `DRAWING_STATUSES`
ids: draft/for_review/approved/released/superseded), `currentRev` (letter, starts 'A',
`nextRev()` increments), `fileUrl, fileName, driveUrl, fileSource` (current file — WS15
already fixed every render site to prefer `fileUrl` over `driveUrl`, see Constraints),
`assignedTo, assignedToName` (designer), `reviewer, reviewerName` (**dead fields — always
null, never read**), `approver, approverName, approvedAt` (set only on the 'approved'
transition, by whoever clicked it), `revisions[]` (`{rev, status, fileUrl, fileName,
driveUrl, note, by, byName, at}` — `at` is a raw `new Date().toISOString()`, not
`bizDate()`), `activity[]` (`{at, event, by, byName}`, same raw-ISO timestamp issue),
`createdBy, createdByName, createdAt, updatedAt`. Rules (709-720): read `!isPartner()`;
create requires `canDesign()` + `createdBy==uid`; update = `createdBy==uid ||
assignedTo==uid || canDesign()` (no distinct approver check); delete admin-only.

**`design_clients/{docId}` / `sales_clients/{docId}` / `bs_clients/{docId}`** — identical
shape across all three: `name, company, email, phone, address, notes, stage` (one of
`lead|prospect|won|lost`, default 'lead' via `crmStageOf`), `followUpDate` (YYYY-MM-DD),
`lastContact`, `addedBy, createdAt`, plus soft-delete-request fields
`deleteRequested, deleteReason, deleteRequestedBy, deleteRequestedAt` (non-admin delete
path). No field on any of the three references either of the other two. Rules
(1121-1123): `sales_clients`/`design_clients` read `!isPartner()`, create/update any authed
user, delete admin-only; `bs_clients` same but read has no partner exclusion.

**`job_projects/{docId}`** (the Sales→Production→Finance spine, relevant subset):
`projectNo` ("JP-{yymm}-{seq}"), `company` ('BK'|'BS'), `name, clientName, stage` (one of
`JOB_STAGES` ids: won/in_production/for_delivery/delivered/completed/paid/cancelled, each
tagged with an "owner dept"), `quoteId, quoteNumber, quoteCollection`, `contractAmount,
amountCollected, arBalance, vatRate, capital`, `partnerUid`, `split:{isShared,barroPct,
partnerPct}`, **`documents[]`** (`{type, ref, at, by}` — the array Design's drawing-release
handoff appends a `{type:'Drawing', ref:'{title} Rev {rev}', at, by}` entry into),
**`timeline[]`** (`{at, event, by}` — same append target), `payments[], productionOrderIds[]
`, `createdBy, createdByName, createdAt, updatedAt`, and (if backfilled) `kind:'job'`. Rules
(1036-1043): read = creator or `partnerUid` match or `!isPartner()` (i.e. any internal staff,
any department); update = creator or `!isPartner()` — **notably NOT department-scoped**, any
non-partner authenticated user can already write this collection.

**`production_orders/{docId}`** (Production's own work-order collection, out of this
workstream's direct scope but adjacent): read via `renderProdOrders` (12409-12454), created
from `job_projects` with `stage in ['won','in_production']` and no `productionOrderIds` yet.
WS28 ("Production process flow") is a separate, not-yet-built workstream that plans to
rename/restructure this collection's stage set — any WS35 handoff that writes into
`production_orders` should NOT hardcode the current stage vocabulary.

**`files_design_files/{docId}` / `files_design_refs/{docId}`** (flat, per-tab, no project/
client scoping): `name, url, source, uploadedBy, uploadedByName, createdAt`, plus
`deleteRequested` fields. Auto-discovered by `scripts/monthly-backup.js` via
`db.listCollections()` (no explicit backup-registration line needed for `files_*`).

**`tasks/{docId}`** (shared collection, relevant subset): a Design-project task written by
`openAddProjectTaskModal` (7541-7593) always hardcodes `department:'Design'` even if
`assignedTo[]` includes a Production-department user — there is no cross-department task
mechanism today; a task "delegated to Production" from within a Design project is not
currently possible via this UI.

## Constraints — must respect

- **escHtml() discipline** — every interpolated field in `renderDesign`'s tree already goes
  through `escHtml()` (confirmed throughout departments.js:6789-7654) or the `esc()` alias in
  modules.js; any new client-folder/project-folder/approval UI must keep this, including for
  the free-text `client`/`clientName`/`company`/`notes` fields that are exactly as
  user-injectable as anything else in the app.
- **Firestore rules do not cascade or match by prefix** (repo-wide convention, confirmed again
  here across `projects`, `design_drawings`, `sales_clients`/`design_clients`/`bs_clients`,
  `job_projects` — five separately-enumerated blocks for five collections with overlapping
  purposes). Any NEW collection this workstream introduces (a unified client collection, a
  per-project file-folder collection, an approval-log collection) needs its own explicit
  match block or reads silently deny (unless wrapped in `.catch()`, the pattern used
  throughout, e.g. `.catch(()=>({docs:[]}))`).
- **Rules read absent fields via `.get(field, default)`, never bare access** — already the
  pattern in `design_drawings`'s update rule (714-717); any new rule this workstream adds
  (e.g. an approver-role check, or a shared-client-doc field guard) must follow the same
  null-safe pattern or a doc missing that field denies the whole rule.
- **Client-side gate and rules-side gate must move together.** `canEditDept('Design')`
  (js/departments.js:17-25) and `canDesign()` (firestore.rules:47-52) are currently exact
  mirrors (both = admin role OR Design-dept membership) — if a real approver tier is added
  (e.g. gating "Approve"/"Release" more narrowly than "Submit for Review"), it must be added
  to BOTH the client button-gate AND the Firestore `allow update` clause, or the UI hides a
  button that the rules would still permit anyone to trigger via devtools/API.
- **Preserve WS15's `fileUrl`-before-`driveUrl` precedence** at the two exact drawing-file-
  link render sites (`openDrawingDetail`'s `fileLink`, departments.js:7391-7392, and the
  revision-history table's per-row download link, 7409) — WS15 (durability, implemented this
  session) specifically flagged these two sites as needing to prefer the app-controlled
  Storage URL over the permanently-public Drive link; any UI rewrite of the drawing detail/
  history views must not reintroduce a bare `driveUrl`-first link.
- **Preserve WS19's `!isPartner()` read-lock** on `projects` and `design_drawings`
  (firestore.rules:691, 710) — these were bare `isAuth()` before WS19 closed the gap; any
  rules rewrite for this workstream must not regress that.
- **Preserve the `bs_clients` partner-read asymmetry** — `bs_clients` intentionally has no
  `!isPartner()` guard so the Brilliant Steel partner can read their own CRM entries; any
  client-unification design must reproduce this per-brand exposure difference, which document-
  level Firestore rules cannot express as a field-level filter (only whole-document allow/deny)
  — likely forces either a still-per-brand "view" document layered on a shared core, or a
  partner-safe field subset synced/duplicated into a separate doc.
- **Manila-time discipline** — `window.bizDate()/bizHour()` (js/config.js) should be used for
  any NEW timestamp logic this workstream adds (e.g. an approval-deadline, a folder-created-at
  stamp); do not propagate the existing raw-`toISOString()` pattern in drawing
  activity/revision timestamps into new code, and consider (as an explicit decision, not a
  silent fix) whether to correct the three existing call sites while this file is open.
- **CACHE_VER in sw.js must bump** on any JS/CSS edit (auto-bumped by the pre-commit hook per
  CLAUDE.md for `APP_VERSION`; CACHE_VER itself is documented as a separate manual step).
- **Script load order is fixed** (index.html): firebase-config.js → config.js → drive.js →
  notifications.js → departments.js → app.js → modules.js. All of this workstream's existing
  code lives in departments.js; any new shared helper needed by BOTH departments.js and an
  earlier-loading file must go in config.js (loads first) and be referenced via `window.*`,
  matching the pattern already used for `dbCachedGet`/`dbCacheInvalidate`.
- **Backup coverage** — `scripts/monthly-backup.js`'s EXPORTS list (confirmed in
  fable-workplan/15-durability.md:76) already includes `design_clients, design_drawings,
  job_projects, projects` by name; `sales_clients`/`bs_clients` are also already listed. A
  new or renamed collection (e.g. a unified `clients` collection, or a new per-project-folder
  collection) needs adding to that EXPORTS list in the same commit, or it silently falls out
  of the monthly backup.
- **`job_projects` write access is already broad** (firestore.rules:1041: any non-partner
  authenticated user, not department-scoped) — a new handoff mechanism that writes into
  `job_projects` needs no new rule to function, but this also means today's rule provides no
  natural place to restrict "only Design may write the Drawing document/timeline entries" if
  that turns out to matter.

## Open decisions

- [ ] **Client unification model.** Does "one client record shared, per-dept views" mean (a) a
  single new `clients` collection with per-dept sub-fields/tags, migrating `sales_clients`/
  `design_clients`/`bs_clients` data into it; (b) keep the three physical collections but add a
  shared `clientKey`/canonical-id cross-reference field (extending the `_brand`-tag /
  `window.Projects`-normalize precedent already in the codebase, i.e. a read-layer merge with
  no destructive migration); or (c) something else? Must explicitly reconcile with WS32
  ("Sales — Client Relations hub," V12-PLAN.md:197-198, per-client timeline across quotes/
  orders/payments/files) which targets the exact same fragmentation from the Sales side —
  decide which workstream owns the shared schema.
- [ ] **Partner-visibility reconciliation.** Given `bs_clients` is partner-readable and
  `sales_clients`/`design_clients` are not, how does a unified client record expose a
  partner-safe subset without leaking internal CRM stage/notes/follow-up data to a Brilliant
  Steel partner? (Field-level Firestore rules don't exist — needs a design choice: separate
  partner-view doc, denormalized safe-subset copy, or keep `bs_clients` fully separate from the
  unification.)
- [ ] **Migration strategy for existing docs.** How many `sales_clients`/`design_clients`/
  `bs_clients` documents exist today, and is there a reliable way to detect "same real client,
  different collection" (name+company fuzzy match? manual reconciliation UI? no attempt,
  forward-only?) — or does unification only apply to newly-created clients, leaving historical
  fragmentation as-is?
- [ ] **Quote-to-client re-keying.** `openClientQuotesModal` currently matches quotes to a
  client by `clientName` string equality (departments.js:11222) — does client unification also
  re-key `bk_quotes`/`bs_quotes` by a stable client id, or does the string-match fragility stay
  and just get inherited by the new shared record?
- [ ] **"Project folders" — literal file-storage folders or a data-model grouping?** Does
  this mean (a) `projectId`/`clientId` fields added to the existing flat `files_design_files`/
  `files_design_refs` collections (a filter, not a real folder), (b) new per-project/per-client
  file collections (`files_design_project_{id}`), or (c) deferred entirely to WS38 ("Files
  Hub," V12-PLAN.md:217-219), which plans a generic folders/subfolders browser company-wide?
  Building a bespoke Design-only folder mechanism risks duplicate work when WS38 lands.
- [ ] **Drawing approval — add a real gate, or keep self-service?** Does "drawing approvals"
  mean introducing a distinct approver tier (e.g. only the project's `designLead`, or only
  `president`/`manager`, may transition `for_review→approved`/`approved→released`), replacing
  today's flat `canEditDept('Design')` gate that lets any Design-dept member (including the
  drawing's own creator) self-approve and self-release? If so, must decide: who is the
  approver (the unused `designLead` field on `projects` is the obvious candidate — was it
  meant for this?); does the dead `reviewer`/`reviewerName` field get revived, removed, or
  repurposed; and does the rules-level `canDesign()` gate on `design_drawings` update
  (firestore.rules:714-717) need narrowing to match, or does the gate stay UI-only (a soft
  gate, bypassable via direct API/devtools by any Design-dept member)?
- [ ] **Design → Production handoff — formalize beyond notify + audit-trail append?** Does
  this workstream need to make a release: (a) auto-create a `production_orders` row (and if
  so, in what stage vocabulary — current, or WS28's pending rename?); (b) auto-delegate a
  Production task (and to whom — the whole dept, like today's notification, or a specific
  point person?); (c) require `jobProjectId` to be set (currently optional) so a released
  drawing can never silently produce zero downstream effect; or (d) leave the mechanism as-is
  (notification + best-effort append) and only harden it (e.g. don't silently no-op when
  `jobProjectId` is absent — surface a warning to the releaser)?
- [ ] **Should `projects` (Design board) and `job_projects` (Sales/Production spine) be merged
  outright**, now that this workstream is deepening the link between them — or does the
  existing `window.Projects` read-only unification layer (departments.js:55-97) plus the
  `kind` backfill tag (101-127) remain the permanent bridge, with the two collections staying
  physically separate forever? A decision here affects whether "one client record" and "one
  project record" should be solved by the same mechanism or two independent ones.
- [ ] **Approval/handoff audit trail location.** If a real approval gate or a richer handoff is
  built, does the audit trail live in the existing `design_drawings.activity[]` array (as
  today), a new dedicated `design_approvals`/`design_handoffs` collection (for querying
  "everything pending my approval" across projects, which a flat per-doc array cannot do
  efficiently), or both?
- [ ] **Manila-time fix scope.** Fix the three raw-`toISOString()` timestamp sites in
  `design_drawings` activity/revision code (item 8 above) as part of this workstream's touch of
  the same functions, or explicitly defer as out-of-scope/cosmetic?

## Risks / cross-workstream interactions

- ⚠️ **Direct overlap with WS32 (Sales — Client Relations hub, V12-PLAN.md:197-198)** — CONFIRMED,
  not speculative: `fable-workplan/32-sales-crm.md` independently documents the exact same
  `sales_clients`/`design_clients`/`bs_clients` fragmentation from the Sales side, plus facts
  this brief doesn't cover (the quote-filed auto-upsert into `sales_clients`/`bs_clients`,
  app.js:8197-8216; Analytics' win-rate KPI reading `sales_clients` only). Both workstreams are
  solving "client fragmentation across departments" from opposite ends; building two
  independent client-unification schemes in parallel risks two competing "canonical client"
  designs — read WS32's brief alongside this one before Fable commits to a schema, and decide
  which workstream owns it.
- ⚠️ **Direct overlap with WS38 (Files Hub, V12-PLAN.md:217-219)** — CONFIRMED: `fable-workplan/
  38-files-hub.md` already names `design_drawings`'s `revisions[]`-array pattern as "the ONE
  existing precedent for 'versions'" in the codebase and explicitly plans to generalize it into
  WS38's shared versioning mechanism. Any Design-specific "project folders/client folders" (or
  drawing-versioning) mechanism built in isolation here is likely to be either thrown away or
  need non-trivial reconciliation once WS38 lands — sequencing risk if 35 ships its own bespoke
  folder/versioning concept before 38's generic one exists.
- ⚠️ **WS28 (Production process flow, V12-PLAN.md:181-184, not yet built)** plans to rename
  `production_orders`' stage vocabulary (Layouting→Bending & Cutting→Assembly→Finishing &
  Polishing→Quality Checking→Out for Delivery) and add per-stage worker assignment/timestamps.
  If WS35's handoff decision is "auto-create a production_orders row on drawing release," it
  must target WS28's stage model, not the stage set implied by today's code — sequencing these
  two workstreams matters.
- ⚠️ **WS31 (Quotation builder v3, V12-PLAN.md:191-196)** explicitly plans to "repair the
  quote→approval→order chain" — any change to how quotes are matched to a unified client
  record (currently a fragile `clientName` string match, item 6) should be coordinated with
  whatever WS31 does to quote/client linkage, to avoid two independent re-keying efforts.
- ⚠️ **WS19 (security, IMPLEMENTED)** narrowed `projects`/`design_drawings` reads to
  `!isPartner()` and is the reason those two rules exist in their current form — any rules
  rewrite for client/folder/approval changes in this workstream must not regress that partner
  exclusion, and should follow the same null-safe `.get(field,default)` pattern WS19 used
  elsewhere.
- ⚠️ **WS15 (durability, IMPLEMENTED)** specifically hardened the two drawing-file-link render
  sites (`fileUrl` before `driveUrl`) as part of closing a public-Drive-link exposure — any
  redesign of the drawing detail/history UI in this workstream must preserve that precedence,
  not reintroduce the old driveUrl-first pattern from before WS15.
- ⚠️ **Self-approval is a live governance gap, not just a UI nuance**: because `canDesign()`
  gates creation, submission, AND approval/release identically at both the client and rules
  layer, a single Design-dept employee today can draft, submit, approve, and release a drawing
  entirely alone, with the drawing's `approver` field simply recording their own name. If Neil
  intends "drawing approvals" to mean a real quality gate before something reaches the shop
  floor, this is the exact code path that needs a second, independent authorization check —
  not a cosmetic addition to the existing flow.
- ⚠️ **No dedup or referential integrity today** between `projects.client` (free text),
  `projects.clientId` (FK to `design_clients`), `design_clients.name`, `sales_clients.name`,
  and `job_projects.clientName` — four independently-editable strings that may or may not
  represent the same real client, with zero enforcement that they match. Any "shared client
  record" design must pick a canonical source and decide how the other three get
  backfilled/kept in sync without breaking existing lookups (quotes matched by name, projects
  displayed by their own `client` string, etc.).
- ⚠️ **Dept-wide notification, not point-of-contact, is the existing pattern** (`Notifs.
  sendToDept('Production', ...)` on release; `Notifs.sendToDept('Finance', ...)` on job-link) —
  consistent with the rest of the app's coarse notification model, but if a "handoff" is
  expected to reach a specific accountable person (e.g. a shop supervisor), that is a new
  capability, not an extension of what exists.
- ⚠️ **`window.Projects`'s 30s cache (`'projects-unified'`) is not invalidated by every
  job_projects write** (createJobProject, advanceProjectStage, and the drawing-release
  arrayUnion append all skip invalidation, per item 8c above) — any new handoff feature reading
  through this cache should either add invalidation calls at those sites or accept the lag.

## Files likely touched

`js/departments.js` — `renderDesign`/`loadDesignContent` (6789-6823); `renderProjects` +
`openProjectEditModal` (6830-6900, 7198-7304, esp. the client-link/job-link fields);
`DRAWING_STATUSES`/`drawingTransitions`/`drawingCard` (6905-6941); `openProjectDetail` and its
five tab renderers (6949-7195, esp. `renderProjFinancials` 7003-7159 if client/project folders
touch billing); `openDrawingCreateModal`/`openDrawingDetail`/`changeDrawingStatus`/
`openDrawingRevisionModal`/`openDrawingEditModal` (7331-7538, the approval-gate + handoff core);
`renderDrawingsDashboard` (7596-7643); `window.Projects` IIFE + `backfillProjectKind`/
`runProjectKindBackfill` (55-127, if the project-bridge is extended); `CRM_STAGES`/
`crmStageOf`/`crmStageMeta` + `renderClientProfiles`/`openClientQuotesModal` (11075-11235, the
client-unification core, shared by Sales/Design/Brilliant Steel); `renderFileCollection`/
`bindFileCollection` (11379-11470, if project/client-scoped folders are added here);
`createJobProject`/`renderProjectLifecycle`/`openJobProjectDetail`/`openProjectMarginModal`
(11995-12310+, the job_projects side of the handoff and margin/billing);
`renderProductionDept`/`loadProdContent`/`renderProdOrders` (12377-12454+, if Production gains
a view into Design handoff data). `js/config.js` — `DEPARTMENTS.Design`/`DEPARTMENTS.
Production` (124-175, subtabs, if a new subtab like "Client Folders" is added); any new shared
helper (Manila-time-safe timestamp, cache-key additions) belongs here per script-load-order.
`js/drive.js` — `renderUploadArea` (95-140+, if project/client-id-scoped upload paths are
added, currently `{dept, subfolder}` only). `js/modules.js` — `window.renderGlobalSearch`
(2470-2530+, the existing three-brand client merge, if client unification changes the source
collections it searches). `firestore.rules` — `projects` (686-701), `design_drawings`
(703-720), `sales_clients`/`design_clients`/`bs_clients` (1113-1123), `job_projects`
(1034-1043), plus any new collection (unified clients, per-project folders, an approval/
handoff log) needing its own explicit match block; `canDesign()`/`isDesignDept()` (45-52) if an
approver tier is added. `storage.rules` — the generic `{department}/{subfolder}/{fileName}`
rule (190-204) if project/client-scoped storage paths are introduced. `scripts/monthly-
backup.js` — EXPORTS list, if any collection is renamed or newly introduced. `sw.js` —
`CACHE_VER` bump (required on any JS/CSS edit per CLAUDE.md).

## Expected deliverable format

> A numbered build spec Sonnet can execute without further judgment calls: one, the exact
> decision made for each open decision above, stated as a one-line policy with rationale (e.g.
> "unify via a new `clients` collection, forward-only migration, `sales_clients`/
> `design_clients`/`bs_clients` kept as read-only legacy for N months" or "keep three
> collections, add a `clientRefKey` cross-link field, extend the existing `window.Projects`-
> style normalize/merge pattern"). Two, the exact final Firestore data shapes — field name,
> type, default — for any new or changed collection (a unified client shape if chosen; a
> project/client-folder shape if chosen; an approval/handoff-log shape if chosen), plus a
> literal `firestore.rules` diff (before/after, in the same comment-then-match style as the
> existing rules file) for every collection touched, explicitly re-deriving the partner-
> visibility asymmetry `bs_clients` currently has. Three, exact function-level before/after
> code blocks anchored to the file:line citations in this brief (e.g. "departments.js:
> 7385-7423, `openDrawingDetail` — BEFORE/AFTER" if an approver check is added; "departments.js:
> 7425-7460, `changeDrawingStatus` — BEFORE/AFTER" if the production handoff is deepened), so
> Sonnet can locate and replace mechanically rather than re-deriving the current logic. Four, an
> explicit statement of whether `projects`/`job_projects` and/or `sales_clients`/
> `design_clients`/`bs_clients` get physically merged or stay separate with a deepened read/
> write bridge — and if merged, a numbered migration/backfill checklist (in the style of the
> existing `backfillProjectKind`/`runProjectKindBackfill` precedent) covering order of
> operations, idempotency, and how in-flight quotes/projects/drawings that reference the
> old collection/id keep working during and after migration. Five, an explicit call-out of how
> this workstream's decisions interact with WS32 (client hub), WS38 (Files Hub), WS28
> (production stage rename), and WS31 (quote→order chain repair) per the Risks section above,
> so Sonnet does not build against a schema one of those workstreams is about to change out
> from under it. Six, if a real drawing-approval gate is added, the exact rule for who counts
> as an approver (role, dept membership, or the specific project's `designLead`), the exact
> UI change to `openDrawingDetail`'s transition buttons, and the exact `firestore.rules`
> tightening on `design_drawings`'s `allow update` clause so the gate cannot be bypassed via
> direct API access even if the UI hides the button.
