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

## DECIDED — architecture spec (Fable, 2026-07-11)

> **Sequencing gate (read first):** WS35 lands AFTER WS32 (unified `clients` collection +
> `window.Clients` + `migrateClientBooks()`) and AFTER WS38 (`hub_files`/`hub_folders` +
> `window.FilesHub`, rules + indexes deployed). Both are DECIDED; WS35 builds strictly on
> their contracts and re-decides NOTHING they settled. WS35 deliberately does NOT wait for
> WS28 (production stages) or WS31 (quote chain) — it writes nothing either owns.

### Resolved decisions (numbered to match the Open Decisions list above)

1. **Client unification → SETTLED BY WS32, not re-decided.** One physical `clients`
   collection with `brands[]`; `design_clients` is a frozen read-only archive after
   `migrateClientBooks()`. WS35's only client-identity work: (a) `openProjectEditModal`'s
   client dropdown re-sources from `window.Clients.listAll()` (all brands, design-brand
   group first) instead of raw `design_clients`; (b) selecting a client auto-fills the
   display-name field and, on save, arrayUnions `'design'` into that client's `brands`
   (linking a Design project to a Sales client legitimately makes them a design client —
   that IS "per-dept views"); (c) a NEW idempotent backfill
   `window.remapDesignProjectClients()` re-points existing `projects.clientId` values from
   legacy `design_clients` ids to `clients` ids via the `migratedTo` stamp WS32's migration
   writes (WS32 backfilled `sales_orders`/`job_projects` but NOT the Design board — this
   closes that gap; it is WS35's one migration deliverable).
2. **Partner visibility → SETTLED BY WS32 decision 10** (partners have NO client-book
   access; their view derives from their own `bs_quotes`). WS35 adds no client rules. All
   WS35 file surfaces inherit WS38's `hub_files` rules (partner sees nothing unless
   explicitly uid-shared) and WS19's `!isPartner()` locks on `projects`/`design_drawings`
   stay byte-identical.
3. **Migration strategy → forward-only + one remap.** No fuzzy dedupe here (WS32's
   nameKey-merge already did collection-level dedupe). `remapDesignProjectClients()` is the
   only historical touch; unmatched/absent `clientId` projects keep their free-text
   `client` string and keep working (display never depended on the FK).
4. **Quote re-keying → NOT WS35's.** WS32 owns `clientId` on quotes (bridge stamping +
   `Clients.quotesFor` fallback); WS31 owns the chain repair. WS35 never reads
   `bk_quotes`/`bs_quotes`.
5. **"Project folders + client folders" → real `hub_folders` rows under ONE new scope
   `'projects'`, per WS38's WS34/WS35 contract — no bespoke folder system, no new
   collections, no rules changes, no storage.rules changes.** Deterministic folder ids make
   creation idempotent and cross-dept discoverable: client folder = `hub_folders/client__{clientId}`
   (root, carries `clientId`), project folder = `hub_folders/proj__{projectId}` (parented
   under its client folder when `clientId` is set, else root, carries `projectId`+`clientId`).
   Files uploaded from a project land in `hub_files` with `scope:'projects'`,
   `folderId:'proj__{id}'`, plus domain fields `projectId`/`clientId` (the Hub ignores them;
   WS32's client hub joins on them — the exact optional-`clientId` field WS32's Spec 11
   reserved for WS38-family docs). UI: a NEW **Files** tab in `openProjectDetail` (Design
   side) and a NEW **📁 Files** section in WS32's `openClientHub` (Sales/Design/BS internal
   views of the same client see the same files — "client folders synced with Sales client
   files", delivered). Reads go through `FilesHub.loadFiles('projects')` (the mandated
   rules-provable fan-out) filtered client-side by `projectId`/`clientId` — zero new
   composite indexes, zero new match blocks. Design's existing flat Product Designs /
   References tabs are WS38's migration territory (scopes `design_files`/`design_refs`) —
   WS35 does not touch them.
6. **Drawing approval → a REAL two-party gate, enforced in BOTH layers.** Approver =
   **president, manager, or the parent project's `designLead`** (the dormant field finally
   used for exactly what it sits next to). `secretary` is EXCLUDED (view-only approvals per
   the corporate-secretary directive) even though rules-`isAdmin()` includes it — the
   approve/release clauses use an explicit role list, not `isAdmin()`. Hard rule:
   **the drawing's `createdBy` or `assignedTo` may NEVER approve it** — if the designLead
   authored the drawing, a president/manager must approve. Release (`approved→released`)
   requires the approver tier but NOT the not-author check (independence was already
   established at approve; rules force `released` to be reachable only from a genuinely
   `approved` doc, so author-release of an independently-approved drawing is safe).
   Transition topology is rules-pinned: `approved` only from `for_review`, `released` only
   from `approved`; create must start at `draft`. Demotions (back-to-draft/review,
   supersede, reactivate) stay `canDesign()` — revoking approval is not a quality risk.
   Dead `reviewer`/`reviewerName` fields: **removed from the create write** (never revived
   — the approver is derived from the project at transition time, not assigned per
   drawing). `approver/approverName/approvedAt` stay as the approve record; NEW
   `releasedBy/releasedByName/releasedAt` mirror it on release.
7. **Design → Production handoff → keep notify + `job_projects` append, HARDEN it; no
   `production_orders` auto-create, no auto-task (WS28's territory — its stage vocabulary
   is undecided and this spec must not hardcode today's).** Three fixes: (a) releasing a
   drawing on a project with NO `jobProjectId` now shows a confirm dialog naming the
   consequence ("Production gets a notification only — nothing lands in any Job Project
   register") instead of silently no-opping; (b) the `documents[]` entry gains
   `drawingId` + `url` (the WS15-preferred `fileUrl`) so Production can open the released
   file from the Document Register — this is also the CONTRACT HOOK for WS28: its intake
   reads `job_projects.documents` entries of `type:'Drawing'` (now self-sufficient with id
   + file link), it does NOT query `design_drawings`; (c) `dbCacheInvalidate('projects-unified')`
   fires after the `job_projects` append (closes brief item 8c for this write site).
   Additionally, `for_review` submission now notifies the project's `designLead` directly
   (fallback: Design dept) — today nobody is told an approval is waiting.
8. **`projects` vs `job_projects` → stay physically separate, permanently.** `window.Projects`
   + the `kind` tag remain the bridge. Rationale: disjoint lifecycles and rules audiences,
   WS28 is about to restructure the production side, and WS32 already solved the only thing
   a merge would have bought (one client identity across both via `clientId`).
9. **Approval/handoff audit trail → stays ON the drawing doc** (`activity[]` + the
   approve/release field pairs). No `design_approvals` collection: the Drawings dashboard
   already does the one flat query; "pending my approval" is `status=='for_review'` filtered
   by `canApproveDrawing()` client-side (a NEW "🔏 For my approval" KPI card, Spec 6). A
   dedicated collection would add a rules block, a backup entry, and a second write to keep
   consistent — for a volume of drawings that fits one query.
10. **Manila-time → storage stays ISO instants (CORRECT and WS38-consistent — `arrayUnion`
    cannot hold `serverTimestamp`, and WS38's `versions[]` deliberately uses the same
    pattern); the actual bug is DISPLAY (`.slice(0,16)` shows UTC wall-clock).** Fix at
    render: new `window.fmtManila(v)` in config.js replaces the raw-slice display sites in
    the drawing detail + project activity feed. The three write sites keep
    `new Date().toISOString()` — do NOT switch them to `bizDate()` (that would truncate to
    a date and break the feed's time display).

---

### Spec 1 — Data shapes (annotated literals; deltas only — nothing else changes)

```js
// design_drawings/{docId} — field DELTAS (all other fields unchanged)
{ // REMOVED from openDrawingCreateModal's create write (dead since birth, decision 6):
  //   reviewer:null, reviewerName:null
  approver:'<uid>', approverName:'…', approvedAt:Timestamp,   // as today — set on approve
  releasedBy:'<uid>', releasedByName:'…', releasedAt:Timestamp } // NEW — set on release

// projects/{docId} — NO shape change. clientId now points into `clients` (post-remap);
// designLead/designLeadName become LOAD-BEARING (approval gate reads them).

// hub_folders/{client__<clientId>} — client folder (deterministic id ⇒ idempotent ensure)
{ name:'ABC Corp', parentId:null, scope:'projects', department:'Design',
  clientId:'<clients docId>',                       // domain field (Hub ignores; WS32 joins)
  createdBy:'<uid>', createdByName:'…', createdAt:serverTimestamp }

// hub_folders/{proj__<projectId>} — project folder, nested under the client folder
{ name:'Reyes Kitchen Reno', parentId:'client__<clientId>'|null, scope:'projects',
  department:'Design', projectId:'<projects docId>', clientId:'<clients docId>'|null,
  createdBy:'<uid>', createdByName:'…', createdAt:serverTimestamp }

// hub_files/{auto-id} — uploads from the project Files tab: FULL WS38 Spec-1 shape
// (kind:'file', visibility:'company', deleted:false, currentV:1, versions:[…],
//  sharedUserIds:[], editorUserIds:[], shares:[]) PLUS the domain fields:
{ ...WS38 Spec-1 shape..., scope:'projects', department:'Design',
  folderId:'proj__<projectId>', projectId:'<projects docId>', clientId:'<clients docId>'|null }

// job_projects.documents[] entry on drawing release — 2 NEW fields (arrayUnion, additive)
{ type:'Drawing', ref:'Ground Floor Plan Rev B',
  drawingId:'<design_drawings docId>', url:'<fileUrl or null>',   // NEW — WS28's intake hook
  at:'<ISO>', by:'Neil Barro' }
```

### Spec 2 — Shared helpers

**2a — `window.fmtManila` (js/config.js, next to the biz* helpers — loads before every caller):**
```js
// Manila wall-clock display for ISO-string/Timestamp instants. Storage stays ISO
// (arrayUnion can't hold serverTimestamp — same pattern as WS38 versions[]).
window.fmtManila = function(v){
  try {
    const d = (v && v.toDate) ? v.toDate() : new Date(v);
    if (isNaN(d)) return '';
    return d.toLocaleString('en-PH', { timeZone:'Asia/Manila',
      year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false });
  } catch(_) { return ''; }
};
```

**2b — `window.canApproveDrawing` (js/departments.js, insert directly above `drawingTransitions` at ~6916).** Mirrors the rules clause EXACTLY — role list is president/manager (NOT secretary, NOT 'owner': rules `isAdmin()` has no owner and secretary is view-only per directive) plus the project's designLead:
```js
// Approval capability — MUST stay in lockstep with the design_drawings update rule.
// { approve, release, isApprover } for the current user on drawing d of project.
window.canApproveDrawing = function(d, project){
  const uid = (window.currentUser && currentUser.uid) || '';
  const isApprover = ['president','manager'].includes(window.currentRole || '')
    || (!!project && !!project.designLead && project.designLead === uid);
  const isAuthor = !!uid && (uid === d.createdBy || uid === d.assignedTo);
  return { isApprover, approve: isApprover && !isAuthor, release: isApprover };
};
```

**2c — `window.DesignFolders` (js/departments.js, insert after `runProjectKindBackfill` at ~127).** Get-then-create (a blind `set(..,{merge:true})` on an existing folder is an UPDATE, which WS38's `hub_folders` rule only grants to creator/admin — existence-check first so any Design member can "ensure"):
```js
// Project/client folders in the WS38 Files Hub (scope 'projects'). Deterministic
// ids ⇒ idempotent + discoverable from the Sales side (client__{clientId}).
window.DesignFolders = {
  _who(){ return (window.userProfile && userProfile.displayName) || (currentUser && currentUser.email) || ''; },
  async _ensure(id, data){
    const ref = db.collection('hub_folders').doc(id);
    const snap = await ref.get().catch(()=>({exists:false}));
    if (!snap.exists) {
      await ref.set({ ...data, createdBy: currentUser.uid, createdByName: this._who(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    } else if (data.name && snap.data().name !== data.name) {
      // best-effort rename sync (creator/admin only per rules) — never block on it
      await ref.update({ name: data.name }).catch(()=>{});
    }
    return id;
  },
  ensureClientFolder(clientId, clientName){
    return this._ensure(`client__${clientId}`,
      { name: clientName || 'Client', parentId: null, scope:'projects', department:'Design', clientId });
  },
  async ensureProjectFolder(p){
    const parentId = p.clientId
      ? await this.ensureClientFolder(p.clientId, p.client || 'Client') : null;
    return this._ensure(`proj__${p.id}`,
      { name: p.name || 'Project', parentId, scope:'projects', department:'Design',
        projectId: p.id, clientId: p.clientId || null });
  }
};
```

**2d — `window.remapDesignProjectClients` (js/departments.js, directly after `runProjectKindBackfill`, same batched-idempotent style as `backfillProjectKind` at 101-127).** Run ONCE after WS32's `migrateClientBooks()`:
```js
// One-time: re-point projects.clientId from legacy design_clients ids to the
// unified clients ids via the migratedTo stamp WS32's migration writes.
// Idempotent: a clientId that no longer matches a design_clients doc is skipped.
window.remapDesignProjectClients = async function(){
  const [pSnap, dcSnap] = await Promise.all([
    db.collection('projects').get(), db.collection('design_clients').get().catch(()=>({docs:[]}))]);
  const map = {};   // legacy design_clients id -> clients id
  dcSnap.docs.forEach(d => { const m = d.data().migratedTo; if (m && m.id) map[d.id] = m.id; });
  let batch = db.batch(), n = 0, done = 0;
  for (const doc of pSnap.docs) {
    const cid = doc.data().clientId;
    if (!cid || !map[cid]) continue;
    batch.update(doc.ref, { clientId: map[cid], updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    done++; if (++n === 400) { await batch.commit(); batch = db.batch(); n = 0; }
  }
  if (n) await batch.commit();
  if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('projects-unified');
  console.log(`remapDesignProjectClients: ${done} project(s) re-pointed`);
  return { remapped: done, scanned: pSnap.size };
};
```

### Spec 3 — Approval gate, client side

**3a — departments.js:7385-7393, `openDrawingDetail` head — BEFORE → AFTER.**
```js
// BEFORE (7386-7393)
  const st = drawingStatus(d.status);
  const canManage = canEditDept('Design');
  const revs = (d.revisions||[]).slice().reverse();
  const acts = (d.activity||[]).slice().reverse();
  const fileLink = d.fileUrl
    ? `<a href="${escHtml(d.fileUrl||d.driveUrl)}" target="_blank" class="btn-secondary btn-sm">⬇ ${escHtml(d.fileName||'Open file')}</a>`
    : '<span style="font-size:12px;color:var(--text-muted)">No file attached</span>';
  const trans = canManage ? drawingTransitions(d.status) : [];
```
```js
// AFTER — per-transition capability gate (WS35). fileUrl-before-driveUrl (WS15) preserved.
  const st = drawingStatus(d.status);
  const canManage = canEditDept('Design');
  const cap = window.canApproveDrawing(d, project);
  const revs = (d.revisions||[]).slice().reverse();
  const acts = (d.activity||[]).slice().reverse();
  const fileLink = d.fileUrl
    ? `<a href="${escHtml(d.fileUrl||d.driveUrl)}" target="_blank" class="btn-secondary btn-sm">⬇ ${escHtml(d.fileName||'Open file')}</a>`
    : '<span style="font-size:12px;color:var(--text-muted)">No file attached</span>';
  const trans = (canManage || cap.isApprover) ? drawingTransitions(d.status).filter(t =>
    t.to === 'approved' ? cap.approve : t.to === 'released' ? cap.release : canManage) : [];
```
Plus, in the meta card grid (after the "Approved by" row at 7404), add a pending-approval hint and the release audit row:
```js
      ${d.status==='for_review' && !cap.approve ? `<span style="color:var(--text-muted)">Awaiting</span><span style="font-size:12px">🔏 Approval by ${project?.designLeadName ? escHtml(project.designLeadName) : 'a manager'}${(d.createdBy===currentUser?.uid||d.assignedTo===currentUser?.uid)?' — authors cannot approve their own drawing':''}</span>` : ''}
      ${d.releasedByName ? `<span style="color:var(--text-muted)">Released by</span><span>${escHtml(d.releasedByName)}</span>` : ''}
```
Display fixes in the same template (decision 10): 7409 rev-date cell `${(''+(r.at||'')).slice(0,10)}` → `${escHtml(window.fmtManila(r.at).slice(0,10))}`; 7412 activity date `${(''+(a.at||'')).slice(0,16).replace('T',' ')}` → `${escHtml(window.fmtManila(a.at))}`. Apply the same substitution to the identical raw-slice date renders inside `renderProjActivity` (7182-7195 — grep `slice(0,16).replace('T'` within that function).

**3b — departments.js:7425-7460, `changeDrawingStatus` — BEFORE → AFTER (full function).** BEFORE is quoted in the Current state (§3/§4) and at 7425-7460 verbatim. AFTER:
```js
async function changeDrawingStatus(d, to, project, currentUser, currentRole, canBill){
  // ── WS35 approval gate (mirror of the firestore.rules clause — defense in depth) ──
  const cap = window.canApproveDrawing(d, project);
  if (to === 'approved' && !cap.approve) {
    Notifs.showToast(d.createdBy===currentUser.uid||d.assignedTo===currentUser.uid
      ? 'You cannot approve your own drawing — the Design Lead or a manager must approve it.'
      : 'Only the project Design Lead or a manager can approve drawings.', 'error');
    return;
  }
  if (to === 'released' && !cap.release) {
    Notifs.showToast('Only the project Design Lead or a manager can release drawings.', 'error');
    return;
  }
  // ── WS35 handoff hardening: never silently release into a void ──
  if (to === 'released' && !project?.jobProjectId) {
    const msg = 'This Design project is NOT linked to a Job Project — releasing will only notify the Production department; nothing will appear in any Job Project document register. Link it via Edit Project first, or release anyway?';
    const ok = (typeof confirmDialog === 'function') ? await confirmDialog({ message: msg }) : confirm(msg);
    if (!ok) return;
  }
  const who = window.userProfile?.displayName || currentUser.email || '';
  const nowIso = new Date().toISOString();   // ISO instant — display via fmtManila (decision 10)
  const st = drawingStatus(to);
  const actEntry = { at:nowIso, event:`Status → ${st.label} (Rev ${d.currentRev||'A'})`, by:currentUser.uid, byName:who };
  const update = {
    status: to,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    activity: firebase.firestore.FieldValue.arrayUnion(actEntry),
  };
  if (to==='approved') { update.approver=currentUser.uid; update.approverName=who; update.approvedAt=firebase.firestore.FieldValue.serverTimestamp(); }
  if (to==='released') { update.releasedBy=currentUser.uid; update.releasedByName=who; update.releasedAt=firebase.firestore.FieldValue.serverTimestamp(); }
  try {
    await db.collection('design_drawings').doc(d.id).update(update);
    d.status = to;
    d.activity = [...(d.activity||[]), actEntry];
    if (to==='approved'){ d.approver=currentUser.uid; d.approverName=who; }
    if (to==='released'){ d.releasedBy=currentUser.uid; d.releasedByName=who; }
  } catch(e){ console.warn(e); Notifs.showToast('Could not update status','error'); return; }
  // Cross-department side effects — best-effort; never block the status change.
  try {
    if (to==='for_review') {
      // WS35: tell the approver an approval is waiting (nobody was notified before)
      if (project?.designLead && project.designLead!==currentUser.uid) {
        await Notifs.send(project.designLead,{title:'🔏 Drawing awaiting your approval',body:`"${d.title}" (${project?.name||d.projectName||''}) Rev ${d.currentRev||'A'} was submitted for review`,icon:'🔏',type:'drawing_for_review',dedupKey:`dwg-rev-${d.id}-${d.currentRev}`});
      } else {
        await Notifs.sendToDept('Design',{title:'🔏 Drawing awaiting approval',body:`"${d.title}" Rev ${d.currentRev||'A'} needs a Design Lead or manager to approve`,icon:'🔏',type:'drawing_for_review'});
      }
    }
    if (to==='approved' && d.assignedTo && d.assignedTo!==currentUser.uid) {
      await Notifs.send(d.assignedTo,{title:'✅ Drawing approved',body:`"${d.title}" was approved`,icon:'✅',type:'drawing_approved',dedupKey:`dwg-appr-${d.id}-${d.currentRev}`});
    }
    if (to==='released') {
      await Notifs.sendToDept('Production',{title:'📐 Drawing released',body:`"${d.title}" (${project?.name||d.projectName||''}) is released for production`,icon:'📐',type:'drawing_released'});
      if (project?.jobProjectId) {
        await db.collection('job_projects').doc(project.jobProjectId).update({
          // drawingId + url are WS28's intake hook — its future production flow reads
          // this register, never design_drawings directly. url = fileUrl (WS15 precedence).
          documents: firebase.firestore.FieldValue.arrayUnion({ type:'Drawing', ref:`${d.title} Rev ${d.currentRev||'A'}`, drawingId:d.id, url:d.fileUrl||null, at:nowIso, by:who }),
          timeline:  firebase.firestore.FieldValue.arrayUnion({ at:nowIso, event:`Drawing released: ${d.title} Rev ${d.currentRev||'A'}`, by:who }),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('projects-unified');
      }
    }
  } catch(e){ console.warn('drawing release side-effect failed', e); }
  Notifs.showToast(`Drawing → ${st.label}`,'success');
  openDrawingDetail(d, project, currentUser, currentRole, canBill);
}
```

**3c — departments.js:7368, `openDrawingCreateModal` create write — one-line delta.**
```js
// BEFORE:  assignedTo, assignedToName, reviewer:null, reviewerName:null, approver:null, approverName:null, approvedAt:null,
// AFTER:   assignedTo, assignedToName, approver:null, approverName:null, approvedAt:null,
```
(`reviewer`/`reviewerName` retired — decision 6. Existing docs' null fields are harmless leftovers; no backfill.)

**3d — `openDrawingRevisionModal` (7462-7497): keep the approver-reset exactly as-is** (it already clears `approver/approverName/approvedAt` and resets to draft — the no-stale-approval property the brief confirmed). Add `releasedBy:null, releasedByName:null, releasedAt:null` to the same reset update (7485) so a superseded release stamp doesn't survive onto a new rev.

### Spec 4 — Approval gate, rules side (firestore.rules `design_drawings`, 709-720 — BEFORE → AFTER)

`isAdmin()` (rules:21) includes `secretary`, so the approver clause uses an explicit role
list instead. All field reads `.get(field, default)` (missing-field-throws memory). The
`get()` on the parent project costs one doc-read per gated write — approve/release are
low-frequency. A drawing whose `projectId` is dangling (deleted project) fails the `get()`
→ the approver clause denies → only nothing (not even president) can approve via designLead
path, but president/manager pass via the role list, which is evaluated FIRST and
short-circuits before the `get()`.

```
// BEFORE (709-720)
    match /design_drawings/{docId} {
      allow read:   if isAuth() && !isPartner();
      allow create: if isAuth() && canDesign()
                    && request.resource.data.get('createdBy', '') == request.auth.uid;
      // Creator, assigned designer, Design-dept member, or admin may edit.
      allow update: if isAuth() && (
           resource.data.get('createdBy', '')  == request.auth.uid
        || resource.data.get('assignedTo', '') == request.auth.uid
        || canDesign()
      );
      allow delete: if isAuth() && isAdmin();
    }
```
```
// AFTER — v12 WS35: real approval gate. 'approved' and 'released' are privileged
// transitions with a pinned topology (for_review→approved→released), approvable only
// by president/manager or the parent project's designLead — and NEVER by the
// drawing's own author/assignee (self-approval hole closed at the rules layer, not
// just the UI). secretary is deliberately NOT an approver (view-only approvals
// directive), which is why this uses an explicit role list instead of isAdmin().
// Everything that is not a promotion to approved/released keeps the old gate.
    match /design_drawings/{docId} {
      // President/manager, or the designLead of the drawing's parent project.
      // Role check FIRST so admins never depend on the project get() resolving.
      function isDrawingApprover() {
        return getRole() in ['president', 'manager']
          || request.auth.uid == get(/databases/$(database)/documents/projects/$(resource.data.get('projectId', '_none_'))).data.get('designLead', '');
      }
      function statusNow()  { return resource.data.get('status', ''); }
      function statusNext() { return request.resource.data.get('status', ''); }
      // Promotion = the status field is CHANGING to approved/released.
      function isPromotion() {
        return statusNext() in ['approved', 'released'] && statusNext() != statusNow();
      }
      allow read:   if isAuth() && !isPartner();
      // v12 WS35: new drawings must start at draft (no API-created pre-approved docs).
      allow create: if isAuth() && canDesign()
                    && request.resource.data.get('createdBy', '') == request.auth.uid
                    && request.resource.data.get('status', 'draft') == 'draft';
      allow update: if isAuth() && (
        // (1) ordinary edits + demotions (revisions, back-to-draft/review, supersede,
        //     reactivate, field edits with status unchanged) — the pre-WS35 gate
        ( !isPromotion() && (
             resource.data.get('createdBy', '')  == request.auth.uid
          || resource.data.get('assignedTo', '') == request.auth.uid
          || canDesign()
        ))
        // (2) APPROVE: for_review → approved, by an approver who is not the
        //     drawing's author or assigned designer (two-party control)
        || ( statusNext() == 'approved' && statusNow() == 'for_review'
          && isDrawingApprover()
          && request.auth.uid != resource.data.get('createdBy', '')
          && request.auth.uid != resource.data.get('assignedTo', '') )
        // (3) RELEASE: approved → released, by an approver (independence was
        //     already enforced when 'approved' was reached — see clause 2)
        || ( statusNext() == 'released' && statusNow() == 'approved'
          && isDrawingApprover() )
      );
      allow delete: if isAuth() && isAdmin();
    }
```
No other rules blocks change: `projects` (686-701) untouched (WS19 read-lock preserved);
`hub_files`/`hub_folders` were deployed by WS38; `clients`/legacy books by WS32;
`job_projects` (1036-1043) untouched — its already-broad non-partner write covers the
release append (brief §8a), and narrowing it is out of scope here (WS28/WS36 territory).
Deploy: `~/.npm-global/bin/firebase deploy --only firestore:rules`, block-scoped Edit only,
fresh `git diff firestore.rules` immediately before (concurrent-session memory).

### Spec 5 — Project Files tab + client Files section (the WS38-contract build)

**5a — `openProjectDetail` (departments.js:6949-6977):** `const tabs = ['Overview','Drawings','Files','Tasks','Financials','Activity'];` and add to `showTab`: `else if (t==='Files') renderProjectFiles(host, p, currentUser, currentRole);` (insert after the Drawings branch at 6970).

**5b — NEW `renderProjectFiles(host, p, currentUser, currentRole)` (departments.js, place after `renderProjectDrawings`).** All reads/mutations via `window.FilesHub` (WS38 Spec 4) — do NOT re-implement upload/version/share/bin logic:
```js
async function renderProjectFiles(host, p, currentUser, currentRole){
  host.innerHTML = '<div class="loading-placeholder">Loading files…</div>';
  const canManage = canEditDept('Design');
  const folderId = `proj__${p.id}`;                       // deterministic (Spec 2c)
  const all = await FilesHub.loadFiles('projects').catch(()=>[]);
  const files = all.filter(f => f.projectId === p.id || f.folderId === folderId);
  host.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted)">📁 Project folder${p.clientId?` · client folder: ${escHtml(p.client||'Client')}`:''}</div>
      ${canManage?`<button class="btn-primary btn-sm" id="pf-upload-btn">＋ Upload</button>`:''}
    </div>
    ${files.length ? `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Name</th><th>By</th><th>Date</th><th>Ver</th><th></th></tr></thead><tbody>
      ${files.map(f=>`<tr>
        <td>${escHtml(f.name||'')}</td>
        <td style="font-size:11px">${escHtml(f.uploaderName||'')}</td>
        <td style="font-size:11px;color:var(--text-muted)">${f.createdAt?.toDate?f.createdAt.toDate().toLocaleDateString('en-PH'):''}</td>
        <td><span class="badge badge-gray">v${f.currentV||1}</span></td>
        <td><button class="btn-secondary btn-sm pf-view-btn" data-id="${f.id}">👁</button></td>
      </tr>`).join('')}</tbody></table></div>`
    : '<div class="empty-state" style="padding:20px"><div class="empty-icon">📁</div><h4>No files in this project folder yet</h4></div>'}
    <div id="pf-upload-area" style="margin-top:10px;display:none"></div>`;
  host.querySelectorAll('.pf-view-btn').forEach(b=>b.addEventListener('click',()=>{
    const f = files.find(x=>x.id===b.dataset.id); if (f) window.openFilePreview(f);
  }));
  document.getElementById('pf-upload-btn')?.addEventListener('click', async () => {
    const area = document.getElementById('pf-upload-area'); area.style.display='block';
    const fid = await DesignFolders.ensureProjectFolder(p);   // lazy folder creation
    Drive.renderUploadArea('pf-upload-area', async (r, file) => {
      const FV = firebase.firestore.FieldValue;
      const who = window.userProfile?.displayName || currentUser.email || '';
      await db.collection('hub_files').add({           // FULL WS38 Spec-1 shape + domain fields
        name: (file?.name || r.name || 'File'), description:'', fileType:'File', kind:'file',
        scope:'projects', department:'Design', folderId: fid,
        projectId: p.id, clientId: p.clientId || null,           // WS32/WS38 contract fields
        url: r.url, driveUrl: null, size: file?.size || null, contentType: file?.type || null,
        source:'firebase', currentV: 1,
        versions: [{ v:1, url:r.url, name:(file?.name||r.name||''), size:file?.size||null,
          contentType:file?.type||null, note:'', by:currentUser.uid, byName:who, at:new Date().toISOString() }],
        archived:false, deleted:false, deletedAt:null, deletedBy:null,
        visibility:'company', sharedUserIds:[], editorUserIds:[], shares:[],
        uploadedBy: currentUser.uid, uploaderName: who,
        createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp(),
      });
      Notifs.showToast('File added to the project folder','success');
      renderProjectFiles(host, p, currentUser, currentRole);
    }, { label:'Upload project file', dept:'Design', subfolder:'Files' });  // WS38 storage-path contract: 2 segments, never deeper
  });
}
```

**5c — client Files section (builds on WS32's `openClientHub` + `Clients.timelineFor`, exactly the panel WS32 Spec 11 deferred).** Inside `Clients.timelineFor` add a fourth parallel fetch: `const hubFiles = (window.FilesHub ? await FilesHub.loadFiles('projects').catch(()=>[]) : []);` and add to the return: `files: hubFiles.filter(f => f.clientId === client.id)`. In `openClientHub`'s body (WS32 Spec 4), render a `📁 Files (N)` section listing `t.files` rows (name / project badge via `f.projectId` / date / 👁 `openFilePreview`), `escHtml` everywhere. Internal-only surface (partners never reach `openClientHub` per WS32 decision 10). Zero new indexes: the fan-out is WS38's existing provable query set.

### Spec 6 — Edit-modal client rework + dashboard approval chip

**6a — departments.js:7199-7205, `openProjectEditModal` head — BEFORE → AFTER.**
```js
// BEFORE (7199-7205)
  const [uSnap, cSnap, jSnap] = await Promise.all([
    db.collection('users').get().catch(()=>({docs:[]})),
    db.collection('design_clients').get().catch(()=>({docs:[]})),
    db.collection('job_projects').orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
  ]);
  const users   = uSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  const clients = cSnap.docs.map(d=>({id:d.id,...d.data()}));
  const jobs    = jSnap.docs.map(d=>({id:d.id,...d.data()}));
```
```js
// AFTER — unified client book (WS32). Design-brand clients listed first; linking a
// project to any client makes them a design client (brands arrayUnion on save).
  const [uSnap, allClients, jSnap] = await Promise.all([
    db.collection('users').get().catch(()=>({docs:[]})),
    window.Clients.listAll().catch(()=>[]),
    db.collection('job_projects').orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
  ]);
  const users   = uSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  const clients = [...allClients].sort((a,b)=>
    (b.brands.includes('design')?1:0)-(a.brands.includes('design')?1:0) || (a.name||'').localeCompare(b.name||''));
  const jobs    = jSnap.docs.map(d=>({id:d.id,...d.data()}));
```
Label at 7211 becomes `Client (unified CRM)`. The `<option>` template (7213) is unchanged
structurally (`c.id`/`c.name`) — legacy-fallback docs from a pre-migration `listAll()` work
too (their ids get fixed later by `remapDesignProjectClients`). Add a change-listener after
the modal opens so picking a client auto-fills the display name (free text remains an
override):
```js
  document.getElementById('pe-client').addEventListener('change', e => {
    const nm = e.target.options[e.target.selectedIndex]?.dataset.name || '';
    const disp = document.getElementById('pe-clientname');
    if (nm && !disp.value.trim()) disp.value = nm;
  });
```
In the save handler, after the `projects` update succeeds (insert directly after the
`dbCacheInvalidate('projects-unified')` line at 7288):
```js
      // WS35: linking a project to a client marks them a design-brand client
      if (clientId && clientId !== (p.clientId||null) && !allClients.find(c=>c.id===clientId)?._legacy) {
        try { await db.collection('clients').doc(clientId).update({ brands: firebase.firestore.FieldValue.arrayUnion('design') });
              if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('clients'); } catch(_){}
      }
```

**6b — `renderDrawingsDashboard` (7596-7643): "For my approval" chip.** After `counts` is
built (7606), add `const mine = drawings.filter(d => d.status==='for_review' && window.canApproveDrawing(d, projMap[d.projectId]).approve);`
and prepend one KPI card to the `kpi-row` template (7630): `<div class="kpi-card" id="dwg-kpi-mine" style="cursor:pointer;border-color:var(--accent)"><div class="kpi-label">🔏 For my approval</div><div class="kpi-value">${mine.length}</div></div>`,
bound after render: `document.getElementById('dwg-kpi-mine')?.addEventListener('click',()=>{ fStatus='for_review'; document.getElementById('dwg-f-status').value='for_review'; renderList(); });`
(Note: `openDrawingDetail` from the dashboard receives `projMap[d.projectId] || {id,name}`
— the stub has no `designLead`, so `canApproveDrawing` correctly degrades to
president/manager-only for orphaned projects; rules behave identically.)

### Spec 7 — Cross-workstream contract (explicit, per the Risks section)

- **WS32 (clients — DECIDED, lands first):** WS35 consumes `window.Clients`, the `clients`
  collection, and the `'clients'` cache key; never re-unifies, never queries
  `design_clients` (except read-only inside `remapDesignProjectClients`, which exists
  precisely to consume WS32's `migratedTo` stamps). `projects.clientId` → `clients` doc id
  is the FK WS32's Spec 11 assigned to WS35 — delivered in Specs 2d/6a.
- **WS38 (Files Hub — DECIDED, lands first):** WS35 uses `scope:'projects'`, ordinary
  `hub_folders` rows with extra `clientId`/`projectId` fields, the 2-segment storage path
  via `Drive.renderUploadArea({dept:'Design', subfolder:'Files'})`, and reads ONLY through
  `FilesHub.loadFiles` (bare `.get()` on `hub_files` is rules-denied for non-admins). Zero
  new rules blocks, indexes, sync LABELS, or backup entries (`hub_*` auto-discovered).
  `design_drawings.revisions[]` stays untouched (WS38 decision 3's explicit carve-out).
- **WS28 (production flow — undecided):** WS35 writes NO `production_orders` rows, no
  stage transitions, no production tasks. Contract hook handed to WS28: `job_projects.documents[]`
  entries of `type:'Drawing'` now carry `drawingId` + `url` — WS28's intake should read the
  register, never query `design_drawings` directly.
- **WS31 (quote chain — undecided):** untouched. WS35 never reads/writes `bk_quotes`/`bs_quotes`.
- **WS15/WS19 (shipped):** `fileUrl`-before-`driveUrl` preserved at both drawing render
  sites (Spec 3a keeps the exact expressions); `!isPartner()` read locks on
  `projects`/`design_drawings` byte-preserved in the Spec 4 rules diff.

### Spec 8 — Migration / rollout checklist (dependency order)

1. **Precondition:** WS32 implemented AND `migrateClientBooks()` run; WS38 implemented
   (rules + indexes deployed, `FilesHub`/`openFilePreview` live). Do not start WS35 before both.
2. **Deploy rules** — the Spec 4 `design_drawings` block via `--only firestore:rules`
   (fresh `git diff` first; block-scoped Edit, never full-file). Deploying BEFORE the JS is
   safe: old clients' Approve button starts failing only for self-approvers/non-approvers —
   which is the point — and all other edits keep working.
3. **Ship the JS** (one commit): config.js (`fmtManila`), departments.js (Specs 2b/2c/2d,
   3a-3d, 5a/5b, 6a/6b), plus the WS32-file touch for Spec 5c (`Clients.timelineFor` +
   `openClientHub` section). `node --check` each file. CACHE_VER bump in sw.js (manual step).
   No new script file → no index.html/PRECACHE change. No monthly-backup EXPORTS change
   (no new collections; `hub_*` auto-discovered per WS38).
4. **Run `window.remapDesignProjectClients()`** once from a president/manager console
   session (idempotent; logs the count). Verify 2-3 projects' `clientId` now resolves in
   the unified dropdown.
5. **Set `designLead` on active projects** (Edit Project → Design Lead). Until set, only
   president/manager can approve that project's drawings — by design, not a bug.
6. **In-flight drawings:** docs already `for_review` flow into the new gate naturally;
   docs already `approved`/`released` under the old self-service regime keep their status
   (historical, records-forever — no retroactive invalidation).
7. Update ROADMAP.md WS35 line + V12-PLAN Build Log.

### Spec 9 — Manual test checklist

1. **Self-approval closed (UI):** as the Design employee who created+is assigned a drawing,
   submit it for review → the ✅ Approve button does NOT render; the meta card shows
   "Awaiting approval by {lead} — authors cannot approve their own drawing".
2. **Self-approval closed (rules):** same user, devtools:
   `db.collection('design_drawings').doc(id).update({status:'approved'})` → **DENIED**.
   Also try `update({status:'released'})` from `for_review` → DENIED (topology pin).
3. **Lead approves:** as the project's `designLead` (non-author), Approve renders and works;
   `approver/approverName/approvedAt` = the lead. As lead-who-is-author → blocked both layers;
   president/manager can approve instead.
4. **Secretary excluded:** as `secretary`, Approve/Release buttons absent AND a console
   `update({status:'approved'})` is DENIED (explicit role list, not `isAdmin()`).
5. **Release:** approver releases → `releasedBy/releasedAt` set; Production gets the dept
   notification; linked project's `job_projects.documents[]` gains the entry WITH
   `drawingId` + `url`, timeline updated, and the Projects pipeline view reflects it without
   waiting 30s (cache invalidated).
6. **Unlinked release warns:** project with no `jobProjectId` → confirm dialog appears;
   Cancel aborts with no writes; Proceed releases with notification only.
7. **Revision resets:** cut Rev B on a released drawing → status draft, `approver*` AND
   `releasedBy*` all null; full cycle (submit→lead approve→release) required again.
8. **Files tab:** upload from Project → Files → `hub_folders/proj__{id}` exists (nested
   under `client__{clientId}` when linked), `hub_files` doc has scope `projects` +
   `projectId`/`clientId`; the file appears in the Files Hub scope browser, previews via
   the lightbox, and a second upload does NOT duplicate folders (deterministic ids).
9. **Client sync:** open the same client in the Sales client hub → 📁 Files section lists
   the project upload (joined on `clientId`). Partner account sees none of it.
10. **Client remap:** after step 4, an old project whose `clientId` pointed at a migrated
    `design_clients` doc shows the correct client pre-selected in the unified dropdown;
    re-running the remap changes nothing.
11. **Manila display:** a drawing approved at 22:10 Manila shows 22:10 in the activity feed
    (previously showed the UTC 14:10). Stored `at` remains an ISO instant.
12. **Regression:** create/edit/revise drawings as a plain Design employee still works
    (clause 1); non-Design non-admin still cannot; partner reads still denied.

### Flags for Neil

- **‼️ FLAG FOR NEIL — approver policy.** Approve/Release = the project's **Design Lead, or
  a president/manager**, and the drawing's author/assignee can NEVER approve their own
  drawing (a manager must, if the lead drew it). `secretary` is excluded from approving.
  Confirm this is the quality gate you want before it ships — it will genuinely block
  designers who could previously self-release to the shop floor.
- **‼️ FLAG FOR NEIL — projects without a Design Lead.** Until you assign `designLead` on
  each active Design project (Edit Project), only you or a manager can approve those
  projects' drawings. Rollout step 5 is a 5-minute manual pass.
- **‼️ FLAG FOR NEIL — releasing without a Job Project link stays ALLOWED (with a loud
  warning), not hard-blocked** — purely internal design work is legitimate. Say the word if
  you want release hard-blocked until the project is linked.
- **‼️ FLAG FOR NEIL — historical self-approved drawings keep their status** (records
  forever; no retroactive invalidation). The new gate applies from deploy onward.

## RE-GROUNDED (Fable, 2026-07-11)

Verified the DECIDED spec above against the REAL, now-implemented WS32 (commit 31ced19)
and WS38 (commit 224dc6b) code — not their plans. **No load-bearing drift.** Every
contract this spec builds on exists exactly as assumed:

- `window.Clients` (departments.js:135) exposes exactly `nameKey, brandOf, deptOf,
  normalize, listAll, findByName, upsertFromQuote, quotesFor, timelineFor`; `listAll()`
  returns normalized docs with non-empty `brands[]` and a `_legacy` flag — Spec 6a's
  usage (`c.brands.includes('design')`, `_legacy` check) is valid as written.
- `window.migrateClientBooks` (departments.js:248) DOES stamp legacy docs with
  `migratedTo: { coll:'clients', id:<clients docId> }` (departments.js:281) — Spec 2d's
  `const m = d.data().migratedTo; if (m && m.id)` reads the real shape correctly. It
  backfills `clientId` onto `sales_orders` + `job_projects` only, NOT `projects` —
  the gap `remapDesignProjectClients()` closes is real. (Migration is triggered from a
  `cl-migrate-btn` in `renderClientProfiles`; Rollout step 1's "run once" has a UI path.)
- `openProjectEditModal` (now departments.js:7756) still reads raw `design_clients` —
  Spec 6a's BEFORE block matches the live code verbatim, and its `<option>` template
  ALREADY carries `data-name="${escHtml(c.name||c.company||'')}"`, so the change-listener
  reading `dataset.name` works without touching the option markup.
- `window.FilesHub` (drive.js:304): `loadFiles(scope, {includeDeleted})` and
  `loadFolders(scope)` exist with those signatures; `window.openFilePreview` is at
  drive.js:400. `scope` is a free string field (no enum anywhere); live scopes are
  `personal, shared, all, advertising, designs, sss, accounting, proposals,
  product_designs, references, files` + BS subtabs — `'projects'` is unused, no collision.
- `hub_folders` rules (firestore.rules:1360): create = any non-partner with
  `createdBy==uid`; update/delete = creator or admin — Spec 2c's get-then-create
  `_ensure` + best-effort rename is correctly designed for exactly these rules.
  WS38's own folders use auto-ids, but `folderId` is a plain string and the folder-chip
  UI renders every `hub_folders` doc in a scope — deterministic `client__`/`proj__` ids
  are compatible additions.
- `hub_files` create rule (firestore.rules:1334) requires `uploadedBy==uid`,
  `visibility in ['company','private']`, `deleted==false` — Spec 5b's write satisfies
  all three, and its field list matches WS38's real upload write in
  `bindFileCollection` (departments.js:12598+) field-for-field.
- All BEFORE blocks quoted in Specs 3a-3d match the live drawing code verbatim
  (`openDrawingCreateModal`'s `reviewer:null, reviewerName:null` line, `openDrawingDetail`
  head + raw-slice date renders, `changeDrawingStatus` full body, revision-modal
  approver reset). `renderDrawingsDashboard` has `projMap`/`counts`/`fStatus`/
  `#dwg-f-status`/`renderList` exactly as Spec 6b assumes. `openProjectDetail`'s tabs
  array and else-if `showTab` chain match Spec 5a. The `design_drawings` rules block
  matches Spec 4's BEFORE byte-for-byte, and `getRole()`/`canDesign()`/`isPresident()`
  all exist. `Clients.timelineFor` has three parallel fetches returning
  `{quotes, orders, projects, payments, events}` — Spec 5c's "fourth fetch + `files:`
  key" instruction applies cleanly. `Notifs.send(uid, payload)` with `dedupKey`,
  `Notifs.sendToDept`, `confirmDialog({message})`, and
  `Drive.renderUploadArea(containerId, onUpload, opts)` all exist as used.

### Spec corrections

Two cosmetic corrections only — nothing changes any decision, shape, or code block:

1. **Line anchors have shifted** (WS32/WS38 added code above the Design suite and in
   the shared-files region). Locate every edit by function name / quoted BEFORE text,
   NOT by the line numbers cited in the spec. Current anchors (js/departments.js unless
   noted): `backfillProjectKind`/`runProjectKindBackfill` 101-127 (unchanged — Specs
   2c/2d still insert directly after 127, i.e. before the `window.Clients` block at
   129); `window.Clients` 135; `migrateClientBooks` 248; `drawingTransitions` 7470
   (Spec 2b inserts directly above it); `openProjectDetail` ~7502 (Spec 5a);
   `renderProjActivity` 7740 (Spec 3a's date-render substitution); `openProjectEditModal`
   7756 (Spec 6a; the `dbCacheInvalidate('projects-unified')` save-handler anchor is at
   ~7846); `renderProjectDrawings` 7865 (Spec 5b places `renderProjectFiles` after it);
   `openDrawingCreateModal` 7889 (create write ~7922-7930, Spec 3c); `openDrawingDetail`
   7943 (Spec 3a); `changeDrawingStatus` 7983 (Spec 3b); `openDrawingRevisionModal` 8020
   (Spec 3d — reset update at ~8043); `renderDrawingsDashboard` 8154 (Spec 6b);
   `openClientHub` 12266 (Spec 5c); `bindFileCollection` 12598. In firestore.rules the
   `design_drawings` block is now at **line 799** (spec says 709-720; text is identical);
   `hub_files` 1334, `hub_folders` 1360. In js/drive.js: `FilesHub` 304,
   `openFilePreview` 400.
2. **Decision 5's aside misnames the flat-tab scopes.** It says Design's Product
   Designs / References tabs use WS38 scopes `design_files`/`design_refs`; the real
   implementation derives scope from `bindFileCollection`'s 4th arg
   (`scope.toLowerCase().replace(/\s+/g,'_')` — call sites pass `'Product Designs'`/
   `'References'`), so the live scopes are **`product_designs`** and **`references`**.
   Irrelevant to WS35 (it never touches those tabs) — corrected only so nobody greps
   for a scope string that doesn't exist.

One optional equivalence (no action required): rules now define `isSeniorAdmin()`
(firestore.rules:30) = `getRole() in ['president','manager']` — identical to the literal
in Spec 4's `isDrawingApprover()`. Keep the spec's literal as written; do not refactor.
