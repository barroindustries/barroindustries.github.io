# Workstream 38 — Files Hub (unified file browser, folders, previews, versions, recycle bin, sharing)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

Plan text (V12-PLAN.md:217-219, under "### PHASE 4"): "38. `[ ]` **Files Hub** — Drive-style:
one browser over all files; folders/subfolders, drag-drop, grid/list, global file search,
previews (img/PDF), versions, recycle bin; share to person/dept/role with view-vs-edit; rides
Storage + nightly Drive mirror." Per V12-PLAN.md:1076-1086, Phase 4 (workstreams 28-40) has
**zero prior Fable grounding briefs or DECIDED specs** — this is the first one written for that
phase. This is also, by every measure below, the single largest scope gap between "one
paragraph of mandate" and "current implementation reality" of any workstream researched so far:
the app has no fewer than **three** separately-evolved, non-unified file-attachment subsystems,
zero cross-file search, zero previews, zero real versioning outside one department's ad hoc
pattern, zero recycle bin beyond a per-doc boolean toggle, and **zero per-file sharing/ACL
primitive of any kind** — every rule in the codebase gates by broad role/department tier, never
by "this specific file, shared to this specific person."

## Current state

### 1) `window.Drive` (js/drive.js, 280 lines, read in full) — exact API surface

The module is an IIFE returning a fixed object (js/drive.js:279): `{ uploadFile,
uploadProfilePhoto, uploadWorkerPhoto, deleteFile, renderUploadArea, renderStorageStatus,
resolveUrl, sourceLabel, sourceIcon }`. Two private helpers (`_isLink`, `_esc`, `_fileIcon`) are
NOT exported. Signatures, verbatim:

- `uploadToFirebaseStorage(file, department, subfolder)` (drive.js:17-40, private) — builds path
  `${department||'general'}/${subfolder||'files'}/${Date.now()}_${file.name}`, uploads via
  `storage.ref(path).put(file)`, resolves `{ id:path, name:file.name, url, driveUrl:null,
  source:'firebase', folder:`${department}${subfolder?'/'+subfolder:''}` }`. `driveUrl` starts
  `null` and is filled in by the nightly sync writing back a companion key (see §3).
- `uploadFile(file, department, subfolder=null)` (drive.js:43-45) — the ONLY public upload
  entrypoint; a thin pass-through to the function above. **There is no `uploadFile` call
  anywhere in the app** (grep-confirmed) — every real caller uses `renderUploadArea` instead,
  which calls `uploadFile` internally (drive.js:177).
- `uploadProfilePhoto(file, uid)` (drive.js:48-52) — `storage.ref('profile-photos/${uid}').put(file)`,
  returns the download URL directly (not an object). 2 call sites (grep).
- `uploadWorkerPhoto(file, profileId)` (drive.js:55-59) — added this session for WS27:
  `storage.ref('worker-id-photos/${profileId}/${Date.now()}_${file.name}').put(file)`, returns
  the URL directly. Role-gated (not uid-owned — see storage.rules §5). 1 call site.
- `deleteFile(fileRef)` (drive.js:62-68) — `storage.ref(fileRef.id).delete()`, re-throws on
  failure for the caller to surface. **Zero call sites in the app** (grep: `Drive.deleteFile`
  has 0 hits) — nothing in the UI can delete an uploaded Storage blob today; every "delete" the
  UI exposes (see §4/§6) only deletes the *Firestore metadata doc*, leaving the Storage object
  (and its nightly-mirrored Drive copy) orphaned forever.
- `resolveUrl(fileObj)` (drive.js:71-74) — `fileObj.driveUrl || fileObj.url || null`. **Zero call
  sites** (grep: `Drive.resolveUrl` has 0 hits) — every UI surface reads `f.url`/`f.driveUrl`
  inline instead of through this helper, so a file only-just-synced-to-Drive display is
  inconsistent screen-to-screen (some screens prefer `driveUrl`, e.g. `design_drawings`'
  `fileLink` at departments.js:7418 uses `d.fileUrl||d.driveUrl` — note the OPPOSITE precedence
  from `resolveUrl`, which prefers `driveUrl` first).
- `sourceLabel`/`sourceIcon` (drive.js:88-98) — return `'Drive'|'Cloud'|'Link'` / a Lucide icon
  name. **Zero call sites** outside `renderUploadArea`'s own internal `addChip` (drive.js:165).
- `renderUploadArea(containerId, onUpload, {accept,label,dept,subfolder,multiple,allowLinks})`
  (drive.js:101-239) — the real, universal entry point. Renders a drop-zone label + hidden file
  input + (if `allowLinks`, default true) a "🔗 Attach a link instead" toggle that lets a user
  register an arbitrary URL (Figma/Sheets/YouTube/etc.) as a pseudo-file with `source:'link'`,
  `kind:'link'`, no Storage write at all. Drag-and-drop (`dragover`/`dragleave`/`drop`,
  drive.js:198-203) is **already implemented** for the upload step. 19 call sites across
  js/app.js (3), js/departments.js (15), js/modules.js (1) — every one of them passes a
  different literal `dept`/`subfolder` pair (Admin/Memos, Admin/Policies, Admin/Resources,
  tasks/attachments, Finance/Receipts, Finance/Taxes, Finance/Ledger, Finance/Records,
  Finance/payslips, Design/Drawings ×2, Finance/SalesOrders, Finance/Collections, posts/attachments,
  plus several with no `dept` at all which fall back to `'general'`).
- `renderStorageStatus(containerId)` (drive.js:255-277) — a static settings-page card ("Cloud
  Storage + Google Drive Sync… Active"). 1 call site, cosmetic only, no live status data (no
  read of `system_health/daily_sync`, the actual heartbeat doc the nightly script writes — see §3).

**5 direct `storage.ref(...)` call sites bypass `Drive.js` entirely** (grep): 4 are inside
drive.js itself (the functions above); the 5th is js/departments.js:1893, inside the task-comment
send handler — it uploads straight to `task-comments/${docId}/${Date.now()}_${file.name}`
(matching storage.rules' own dedicated `task-comments/{docId}/{fileName}` block, §5) and stores
`fileUrl`/`fileName` directly on the Firestore comment doc — this file attachment is invisible to
every mechanism described below (no `files_<scope>` doc, no `renderUploadArea` link-chip, no
Drive folder naming convention `${department}/${subfolder}/...`).

### 2) Upload model — confirmed exactly as CLAUDE.md describes it

Every `uploadFile`/`renderUploadArea` call writes straight to Firebase Storage, synchronously,
with **no employee Google OAuth** (drive.js:1-12 header comment, verbatim: "1. Employee uploads →
Firebase Storage (instant, no login needed) 2. Every night at 12am, GitHub Actions syncs all
Firebase files to Google Drive and updates Firestore links to Drive URLs. 3. App displays Drive
link + icon once synced, Cloud icon until then."). There is no client-side notion of "pending
sync" beyond the icon swap (`sourceIcon`/`sourceLabel`, unused per above) — the UI never actually
displays a synced-vs-not-synced badge in the 15+ real call sites reviewed; the `driveUrl` field
is simply blank until the nightly job fills it in.

### 3) Nightly Drive mirror — scripts/drive-lib.js (218 lines) + scripts/sync-to-drive.js (308
lines), both read in full; both were heavily reworked this session for WS15's durability pass

**drive-lib.js** is the shared Drive-API helper used by both `sync-to-drive.js` and
`monthly-backup.js`. Key facts:
- Two supported auth modes (`initDrive`, drive-lib.js:52-85): OAuth user credentials (preferred —
  `GOOGLE_OAUTH_REFRESH_TOKEN`/`_CLIENT_ID`/`_CLIENT_SECRET`, uses the real user's ~15GB Drive
  quota) OR a service account (`GOOGLE_SERVICE_ACCOUNT`, needs a **Shared Drive** — a service
  account has zero My-Drive storage quota, confirmed by the drive-sync-config memory and restated
  verbatim in the file header, drive-lib.js:9-16, 47-49). OAuth wins if a refresh token is present.
- `preflight(drive, rootFolderId, authMode, ownerLabel)` (drive-lib.js:89-162) runs before every
  sync job and fails LOUD (`process.exit(2)`) with an exact fix string for every known
  misconfiguration: `DRIVE_FOLDER_ID` looking like a URL/having stray chars, pointing at a
  non-folder, a trashed folder, a folder the SA/OAuth-user can see but not write to
  (`canAddChildren:false`), or — the historically-hit case per the drive-sync-config memory — a
  personal My-Drive folder with a service account (`isShared:false && !isOAuth` → warns loudly
  but does not hard-fail, since the actual upload failure "Service Accounts do not have storage
  quota" only surfaces later).
- Every Drive API call passes `supportsAllDrives:true` (`SHARED`) or additionally
  `includeItemsFromAllDrives:true` (`SHARED_LIST` — used for `files.list`) — confirmed on
  `files.get`, `files.list`, `files.create`, `permissions.create` (drive-lib.js:106-213). This is
  exactly the "all Drive calls need supportsAllDrives" gotcha from the drive-sync-config memory,
  and it is uniformly applied here.
- `uploadBuffer(drive, buffer, filename, mimeType, folderId, {public:isPublic=false})`
  (drive-lib.js:204-213) — files are **PRIVATE by default**; the comment (drive-lib.js:201-203)
  states explicitly "Files are PRIVATE by default (Drive = cold archive). Pass `{public:true}`
  only for deliberately low-sensitivity, shareable content — **nothing in this repo does today**."
  Confirmed by grep: zero call sites anywhere pass `{public:true}`. This means every
  Drive-mirrored file, once synced, is **not link-shareable** without a human manually changing
  its Drive sharing settings — directly relevant to the "share to person/dept/role" mandate (see
  Open Decisions §11).

**sync-to-drive.js** runs daily via GitHub Actions at 12:00 AM PHT. Its header comment
(sync-to-drive.js:6-32) states the mechanism precisely: it walks **every Firestore root
collection** (`db.listCollections()`, sync-to-drive.js:283) plus one level of subcollections
(`processCollection(..., depth=1, ...)`, sync-to-drive.js:250-254), recursively searching every
document for any string value containing `firebasestorage.googleapis.com`
(`isFirebaseUrl`, sync-to-drive.js:90-92), and for each one found:
1. Downloads the file (sync-to-drive.js:161-169) — a fetch failure (403/404, meaning the
   original Storage object was deleted or its token rotated) is **NOT treated as a sync error**
   (`stats.unfetchable++`, does not fail the job) — only a genuine Drive-side upload failure
   (quota/permission/config) increments `stats.errors` and fails the run's exit code.
2. Uploads it to Drive into a folder named by `labelFor(collectionName)` (sync-to-drive.js:76-81):
   an explicit `LABELS` map for ~15 known collections (`tasks`→'Tasks', `quotes`/`bk_quotes`/
   `bs_quotes`→'Quotes', `expenses`→'Receipts', `payslips`→'Payslips', etc.), **any collection
   name starting `files_` collapses to a single shared 'Dept Files' folder** (sync-to-drive.js:78
   — meaning ALL 12+ distinct `files_<scope>` collections described in §4 below get mirrored into
   ONE flat, undifferentiated Google Drive folder, losing per-department/per-tab separation on
   the Drive side even though Firestore keeps them separate), and **any collection starting
   `budgets_` is explicitly excluded from mirroring** (sync-to-drive.js:79, `return null`) because
   "budgets hold no files" — confirmed structurally correct: `budgets_<dept>` docs are numeric
   budget-allocation lines with no URL-shaped fields at all (see Data model §2).
3. Writes the Drive link back onto the SAME document at a **companion key** derived from the
   original field name (`companionKey`, sync-to-drive.js:94-98): `url`→`driveUrl`,
   `fileUrl`→`driveFileUrl`, `imageUrl`→`driveImageUrl`, anything else → `drive_<key>`. This
   companion-key convention is exactly what `design_drawings`' `driveUrl` field and every
   `files_<scope>` doc's `driveUrl` field rely on.
4. A small set of collections is hard-excluded from the whole walk regardless of content
   (`EXCLUDE`, sync-to-drive.js:84-87): `audit_log, attendance, notifications, presence,
   sessions, products, productMeta, inventory_items` — high-churn or structurally file-less.
5. Every file gets a human-legible, collision-proof rename before landing in Drive
   (`buildPrefix`/`slug`/`pickDate`/`pickContext`, sync-to-drive.js:117-150):
   `<date>_<slugified-context>_<last-6-of-docId>__<originalFilename>`, where "context" is
   whichever of `clientName/customer/payee/projectNo/quoteNumber/title/name/reference/
   uploadedByName/submittedByName` exists on the doc.
6. Writes a heartbeat doc `system_health/daily_sync` (`reportHealth`, sync-to-drive.js:260-269,
   called at sync-to-drive.js:301) with `lastRunAt, lastStatus, errors, filesWritten,
   unfetchable, durationSec` — **this is the "live status data" `renderStorageStatus` could read
   but currently does not** (§1).

**Because the walk is fully generic and driven by `db.listCollections()`**, any brand-new
collection this workstream introduces that (a) is a root collection and (b) stores a Firebase
Storage URL in any field will be **auto-discovered and auto-mirrored with zero changes to
sync-to-drive.js** — UNLESS its name needs a friendlier Drive-folder label than the
`titleCase(name)` fallback (sync-to-drive.js:80), in which case a new entry must be added to the
`LABELS` map (sync-to-drive.js:63-72), same as `scripts/monthly-backup.js` auto-discovers new
root collections for backup (confirmed comment at multiple call sites in departments.js: "Root
collection, name computed at runtime — no backup registration needed: scripts/monthly-backup.js
discovers every root collection via db.listCollections()").

### 4) THREE separately-evolved, non-unified file-attachment subsystems already coexist

**(a) `Drive.renderUploadArea` + ad hoc per-screen field, one-off** — the 19 call sites in §1;
each screen invents its own local variable (`uploadedFile`, `taxFile`, `ledFile`, `recFile`,
`proofFile`, `taskAttachments[]`, etc.) and writes the resulting `{url,name,source,driveUrl}`
object (or an array of them, for tasks) directly onto whatever domain document it belongs to
(a memo, a tax record, a ledger entry, a task, a payslip). No shared listing/browsing UI; the
file is just an inline link/chip on that one document's own detail view.

**(b) `renderFileCollection` / `bindFileCollection` — a dedicated per-tab file browser with TWO
competing, shadowed implementations in the SAME file.** js/departments.js declares BOTH:
- An OLDER pair as bare top-level function declarations: `function renderFileCollection(title,
  id, currentRole)` (departments.js:11379-11391) and `function bindFileCollection(id,
  currentUser, dept, subfolder)` (departments.js:11392-11468) — flat list only (no folders, no
  archive), a simple `canDelete`/`canRequestDelete` role split, "Request Delete" notifies the
  president via `Notifs.send`.
- A NEWER pair, immediately after, reassigning the SAME global names: `window.renderFileCollection
  = function(title, containerId, currentRole)` (departments.js:11679-11695) and
  `window.bindFileCollection = function(containerId, currentUser, dept, scope, filterUid)`
  (departments.js:11697-11783) — adds a folder-tag chip bar (`activeFolder`, built from each
  file's `folder` field), an "🗄 Archived" pseudo-folder chip that filters on an `archived`
  boolean (the closest thing to a recycle bin that exists today — see §6), "📁 New Folder"/"🔗 Add
  Link" buttons, and writes into the `files_<scope>` collection (scope lower-cased,
  spaces→underscores) rather than `files_<id>`.
- **Because top-level `function` declarations and `window.X = ...` assignments share the same
  global binding in a non-module browser script, the SECOND definition silently wins for every
  caller in the file**, including the 15 call sites that were written against the OLDER
  signature and still pass old-style positional args (`title, id, currentRole` /
  `id, currentUser, dept, subfolder[, filterUid]`). Because the 4th positional argument
  (named `subfolder` by the old signature, `scope` by the live one) is used identically by the
  live function to build the collection name, every call site still works correctly today — but
  the OLDER 90-line pair (departments.js:11379-11468) is **100% dead code**, confirmed by the
  shadowing mechanics above, not by absence of callers. A future edit to the wrong copy (the
  dead one) would silently do nothing.
- **15 confirmed call sites** exercising the LIVE version, each against its own runtime-named
  `files_<scope>` collection: `files_personal`/`files_shared`/`files_all` (My Files / Dept
  Files / All Company Files, app.js:4240-4247), `files_advertising`/`files_designs` (Marketing,
  departments.js:1971-1976), `files_sss`/`files_accounting` (Finance, departments.js:2040-2041,
  4153-4155), `files_proposals` (Sales, departments.js:5557-5558), `files_product_designs`/
  `files_references` (Design, departments.js:6812-6817), `files_<brilliant-steel-subtab>` — one
  PER dynamic BS subtab name (departments.js:8406-8407), `files_files` (Production,
  departments.js:12404-12405). **12+ distinct collections observed, with Brilliant Steel alone
  potentially adding more depending on its subtab list** — none of these collections is
  enumerable ahead of time from a fixed schema; the ONLY reason the app can read/write them at
  all is the wildcard `coll.matches('files_.*')` rule (§5).

**(c) `renderDocCollection` — a third, card-grid-style generic document collection**
(departments.js:11304-11362), `{title, description, fileUrl, fileName, addedBy, createdAt}`
shape rendered as `.policy-card` tiles (originally built for Admin → Policies). Its `opts.editable`
flag is explicitly "currently used by Finance → Purchasing" (departments.js:11352 comment) —
**this is the actual current home of purchase-order-adjacent document attachments** the research
brief asked about: Purchasing's RFQ/PO-like documents get a single `fileUrl`/`fileName` pair via
this exact generic mechanism, editable/deletable through `financeEditModal`/`window.financeDelete`
(President-approval-gated hard delete for finance-tier collections — see §6), not through either
of the two systems above.

**Total distinct file-storage surfaces found: at minimum 19 (`renderUploadArea`) + 5 (direct
`storage.ref`) call sites, spanning 12+ dynamic `files_<scope>` collections, plus dedicated file
fields on `tasks` (array), the `comments` subcollection (per-message `fileUrl`), `posts`, memos/
policies/resources (Admin), `expenses`, `tax_records`, three ledger-journal collections
(`cash_receipt_journal`/`cash_disbursement_journal`/general ledger), `sales_orders`, cash-advance/
collections proof, `payslips` (transfer-proof screenshot), `worker_profiles`/`id_verify`
(worker ID photos, WS27), `users` (profile photos), and `design_drawings` (with its own
ad hoc version-history array, §5) — roughly 25+ independent file-storage call sites/collections,
with NO shared index, NO shared search, and NO shared browsing UI across any of them.**

### 5) The ONE existing precedent for "versions" — `design_drawings` (departments.js, Design dept)

A `design_drawings/{docId}` doc carries `currentRev:'A'` plus a `revisions` array
(departments.js:7371, `revisions:[rev0]` on create) where each entry is `{rev, status, fileUrl,
fileName, driveUrl, note, by, byName, at}` (departments.js:7360). Creating a new revision
(`openDrawingRevisionModal`, departments.js:7448-7481) computes the next rev letter via
`nextRev(letter){ return letter ? String.fromCharCode(letter.toUpperCase().charCodeAt(0)+1) :
'A'; }` (departments.js:6914 — a bare A→B→C letter increment, no wraparound past 'Z' handled),
appends a new entry via `FieldValue.arrayUnion(revEntry)`, and overwrites the doc's own
`fileUrl`/`fileName`/`driveUrl`/`currentRev` to point at the newest revision — i.e. **the CURRENT
file and the version HISTORY live on the same doc**, the array only ever grows (no cap, no
pruning), and the OLD file's Storage blob is never deleted (matching `Drive.deleteFile`'s zero
call sites, §1) — old revisions remain downloadable forever via their `fileUrl` in the array, an
unbounded-growth pattern that works fine at drawing-review cadence but would need reconsideration
if generalized to every file in a company-wide Hub. `openDrawingDetail` (departments.js:7384-7415)
renders the array reversed (`revs = (d.revisions||[]).slice().reverse()`) as a "📑 Revision
History" table. This is the ONLY per-file version history mechanism in the entire codebase
(grep-confirmed: zero hits for `versionHistory`/`fileVersion`/`.versions` anywhere else).

### 6) The closest existing "recycle bin" precedent — a per-doc `archived` boolean, NOT a bin

The live `bindFileCollection` (§4b) toggles `archived:true/false` on a `files_<scope>` doc via a
single button (departments.js:11732-11738: `♻️`/`🗄` toggle, gated to "the uploader or an admin"
by the underlying firestore.rules `update` clause, §7 — the client-side try/catch shows a generic
error toast on denial, not a specific permission message). Archived files are hidden from every
normal folder view and only visible via a dedicated "🗄 Archived (N)" chip — this is soft-delete
in spirit but has **no `deletedAt` timestamp, no auto-purge job, no distinct Recycle Bin screen
separate from the folder-chip UI, and no relationship whatsoever to the codebase's OTHER,
much stricter soft/hard-delete pattern**: `window.financeDelete`
(departments.js:198-253, full function) which, for finance-tier collections, routes ANY delete
through a `finance_delete_requests` collection requiring President approval (per the
finance-delete-approval memory) — confirmed used for `tax_records`, ledger entries, cash
advances, `worker_profiles`, but **NOT** for `files_<scope>` docs, whose delete/archive stays
purely owner-or-admin, no approval gate. Grep confirms zero hits for `recycleBin`/`recycle_bin`/
`isDeleted`/`deletedAt`/`softDelete`/`trash` (as a data-model term; `trash-2` hits are all just
the Lucide icon name on ordinary hard-delete buttons across ~20 unrelated screens) anywhere in
the codebase — a true, TTL'd, restorable Recycle Bin is 100% greenfield for this workstream.

### 7) Sharing/ACL — confirmed genuinely absent; every existing rule is role/department-tier only

**Firestore** — the dynamic wildcard block covering every `files_<scope>` collection
(firestore.rules:1126-1148, quoted in full in Data model §1) grants read to "isAuth() &&
!isPartner()" (i.e. any internal staff member, company-wide, regardless of department) and
write to "uploader or admin" — **there is no per-file scoping to a person, department, or role
narrower than that.** The sibling `budgets_<dept>` wildcard (firestore.rules:1150-1157) is
similarly all-internal-read / money-tier-write, again with no per-document narrowing.

**Storage** (storage.rules, 211 lines, read in full) — access is **path-based**, not per-object:
a signed-in user either can or cannot read/write an entire folder path
(`Finance/payslips/*` → finance tier only; `{department}/{subfolder}/*` → any internal staffer,
partner excluded unless `isMemberOf(department)`, storage.rules:196-204). There is no mechanism
in Cloud Storage security rules to grant "read this ONE object" to an arbitrary user or role
outside of who already has that folder-path access — a genuinely new per-object grant would
require either (a) proxying all reads through a server (Cloud Function signed-URL minting) or
(b) accepting that "sharing" only ever narrows/widens Firestore-side METADATA visibility
(who can see the file exists / see its `url` field) while the underlying Storage download URL,
once obtained by anyone with metadata-read, is a **bearer token** — `getDownloadURL()` returns a
URL containing an access token good for anyone who has it, not scoped to the requesting user's
session (this is standard Firebase Storage behavior, not a bug, but it means a metadata-level
"view-only, don't let them re-share the link" promise cannot be cryptographically enforced by
this app's architecture — only Firestore-level *whether they can see the URL at all* can be
gated). The two closest precedents for a narrower-than-broad-role grant in this codebase are (i)
the public unguessable-token pattern (`order_tracking/{20-char-id}`, firestore.rules:795-807:
`allow get: if true; allow list: if false`) used for the customer order-tracking link, and (ii)
`id_verify/{token}` (WS27, same shape) for public ID verification — both are "share via secret
link to anyone who has it" patterns, structurally different from "share to THIS specific
person/department/role with a distinguishable view-vs-edit permission," which does not exist
anywhere in the repo.

### 8) Global search explicitly excludes files today

`window.renderGlobalSearch` (js/modules.js:2474-2528, full function read) searches `tasks`,
`sales_clients`/`design_clients`/`bs_clients` (merged), `inventory_items`, `products` (capped at
1000), and quotes (`bk_quotes` via `getAllQuotes()`) — five source groups, each pre-fetched once
via `dbCachedGet`/plain `.get()` and cached in a closure-local `sources` object, then
client-side substring-filtered per keystroke (220ms debounce). **Files are not one of the five
groups.** ROADMAP.md:287 confirms this was a deliberate, known gap: "(Files search not included —
files live in per-tab `files_*` collections; could be added.)" Extending this to files hits the
same structural problem as everything else in this brief: `files_<scope>` collection names are
NOT enumerable ahead of time (no fixed list, no registry document), so a "search all files"
feature cannot do one Firestore query — it would need either (a) N separate `.get()` calls
against every known scope (brittle — a new department's Files tab silently isn't searched until
its scope string is hand-added to a list) or (b) a genuinely new unified collection this
workstream creates specifically to be searchable as one query.

### 9) No preview/lightbox precedent; no grid/list toggle precedent for files specifically

Grep across every `.js`/`.css` file for `lightbox`/`img-preview`/`imagePreview`/`previewModal`
returns zero hits — there is no existing modal/lightbox component to preview an image or PDF
inline; every file link in every screen reviewed above opens `target="_blank"` (a new browser
tab), relying entirely on the browser's own native handling of the URL's content-type. The
closest reusable UI primitive for a grid-vs-list (or any tab-like view) toggle is
`window.chipTabs`/`window.bindChipTabs` (per the ui-chip-tabs-and-sop-helpers memory), already
used for an analogous List/By-Customer toggle on the quotes screen
(departments.js:6614, 6661: `window.chipTabs([{key:'list',label:'List'},
{key:'customer',label:'By Customer'}],'list',{cls:'bkq-view'})`) — a real, working precedent for
the "grid/list" requirement's UI mechanics, though it has never been wired to an actual CSS-grid
vs table-row rendering swap for files specifically.

## Data model

**`files_<scope>/{docId}`** — top-level collection, name computed at runtime as
`files_${scope.toLowerCase().replace(/\s+/g,'_')}` (departments.js:11702) or, from the legacy
dead-code path, `files_${id.replace(/-/g,'_')}` (departments.js:11396, never actually reached —
see Current state §4b). Fields observed across both the create path (departments.js:11758-11768)
and the older `bindFileCollection`'s add handler (departments.js:11462-11467, also dead but
documents an older shape still latent in already-written docs): `name` (string), `fileType`
(string, one of Document/Image/Spreadsheet/PDF/Other — free dropdown, not derived from the
actual MIME type), `folder` (string, default `'General'` — a flat tag, NOT a real nested path;
"subfolders" per the mandate do not exist in this shape today), `archived` (boolean, default
`false` — the de facto one-tier trash, see Current state §6), `url` (string, the Firebase
Storage download URL; empty string if the "upload" was actually a pasted link with no file),
`source` (string, `'firebase'|'link'`), `department` (string, the literal dept the Files tab
belongs to), `scope` (string, the same value used to build the collection name — redundant with
the collection name itself but kept as a field), `uploadedBy` (uid string — the ownership key
every rule and the archive-toggle check against), `uploaderName` (string), `createdAt`
(serverTimestamp). Older docs (from the shadowed dead code) may additionally carry
`uploadedByName`/`isFolderMarker` (a sentinel doc type for tracking an explicitly-created empty
folder, referenced at departments.js:11705-11708 but its *creation* path was not located in this
research — the "📁 New Folder" button's handler was not traced past its DOM id
`newfolder-btn-${containerId}`, departments.js:11685). Rules (firestore.rules:1126-1148, quoted
in full):
```
    // ── Dynamic / runtime-named collections ────────────
    // The app creates per-scope and per-dept collections at runtime whose names
    // are not known ahead of time, so they can't be matched by literal name:
    //   files_<scope>  — uploaded documents (every Files tab, all depts)
    //   budgets_<dept> — budget allocation lines (Budgeting screens)
    // Firestore does NOT match collections by prefix, so cover each family with
    // a single-segment wildcard guarded by coll.matches(...). This only grants
    // access for those families; all explicitly-named collections above keep
    // their own (stricter) rules via the permissive union of matching rules.
    match /{coll}/{docId} {
      allow read:   if isAuth() && coll.matches('files_.*') && !isPartner();
      allow create: if isAuth() && coll.matches('files_.*') && !isPartner()
                    && request.resource.data.uploadedBy == request.auth.uid;
      allow update, delete: if isAuth() && coll.matches('files_.*') && !isPartner()
                    && (resource.data.uploadedBy == request.auth.uid || isAdmin());
    }
```
No composite indexes exist for this family (`firestore.indexes.json` grep: zero `files_`/
`budgets_`/`design_drawings` hits) — every observed query is single-field
(`.where('department','==',dept)` or `.where('uploadedBy','==',filterUid)`, departments.js:11749-
11750); a Hub needing combined filters (folder + archived + date-sort, say) will need new
composite indexes, which must be created in `firestore.indexes.json` and deployed BEFORE the
query ships (an undeployed composite-index query fails LOUDLY with a console error + a direct
link to auto-create it — unlike a missing security rule, which fails silently).

**`budgets_<dept>/{docId}`** — same dynamic-wildcard architecture pattern as `files_<scope>` but
a **structurally unrelated content domain**: numeric budget-allocation lines for the Budgeting
screens (departments.js:11473 on), confirmed file-less both by `sync-to-drive.js`'s explicit
`if (name.startsWith('budgets_')) return null; // budgets hold no files` (sync-to-drive.js:79) and
by there being no URL-shaped fields in its create/update payloads. **This directly answers
whether `budgets_*` is a partial file registry a Hub could build on: it is not — it merely
shares the same "runtime-named collection behind a `coll.matches()` wildcard rule" plumbing
pattern, nothing more.** Rules (firestore.rules:1150-1157): read = internal staff, write =
`isMoneyAdmin()` only.

**`design_drawings/{docId}`** — the one working versioned-file precedent (Current state §5).
Full field set (departments.js:7371-7379, 7404 on): `projectId, projectName, title, drawingNo,
type, status, currentRev` (string, 'A'/'B'/...), `fileUrl, fileName, driveUrl, fileSource` (the
CURRENT revision's file, denormalized onto the parent doc for cheap reads), `assignedTo,
assignedToName, reviewer, reviewerName, approver, approverName, approvedAt`, **`revisions`**
(array of `{rev, status, fileUrl, fileName, driveUrl, note, by, byName, at:ISOString}` — ISO
string, NOT a Firestore Timestamp, because it's written client-side inside an `arrayUnion` where
`serverTimestamp()` cannot be used), **`activity`** (a parallel append-only audit-log array,
`{at, event, by, byName}`), `createdBy, createdByName, createdAt, updatedAt`. Rules
(firestore.rules:709-719): read = any internal staff (`!isPartner()`), create = `canDesign()` +
`createdBy == auth.uid`, update = creator OR assignee OR `canDesign()` (i.e. broader than just
the two named people), delete = admin only.

**Everything else** (Current state §4): a per-document `fileUrl`/`driveUrl`/`photoUrl` field (or,
for `tasks`, an `attachments` array of the SAME `{id,name,url,driveUrl,source,folder}` shape
`Drive.uploadFile` returns) living inline on whatever domain collection the file belongs to —
`tasks.attachments[]`, `{taskCollection}/{docId}/comments/{commentId}.fileUrl`, `posts`, Admin
memos/policies/resources (via `renderDocCollection`'s `fileUrl`/`fileName` pair), `expenses`,
`tax_records`, `cash_receipt_journal`/`cash_disbursement_journal`/ledger entries, `sales_orders`,
cash-advance/collections proof, `payslips` (transfer-proof screenshot via the `ps-proof-area`
upload, departments.js:5023), `worker_profiles.photoUrl` (WS27, via `worker-id-photos/
{profileId}/...`), `users.photoUrl` (via `profile-photos/{uid}`), `id_verify/{token}.photoUrl`
(WS27's public verification projection, a COPY of a photo URL, not the source of truth).

## Constraints — must respect

- Script load order is fixed and load-bearing (CLAUDE.md, index.html:302-323): firebase-config.js
  → config.js → qrcode.js (WS27) → drive.js → departments.js → app.js → modules.js, all
  `defer`, all via `window.*` globals, no ES modules. Any new shared Files-Hub helper file must
  be added to BOTH index.html's script list AND `sw.js`'s `PRECACHE` array, and positioned before
  the first file that calls it — `js/drive.js` is the natural home for any new cross-cutting
  file/version/share helper since it already loads before departments.js/app.js/modules.js and
  every existing upload path already depends on it.
- CACHE_VER in sw.js must be bumped by hand on every JS/CSS edit (per CLAUDE.md; the pre-commit
  hook only auto-bumps `window.APP_VERSION` in config.js and the `vX.Y.Z` strings in index.html —
  CACHE_VER itself is a separate manual step, confirmed by every prior workstream's Build Log
  note in V12-PLAN.md).
- Firestore rules do not cascade or match by prefix — confirmed AGAIN here via the dedicated
  `coll.matches('files_.*')`/`coll.matches('budgets_.*')` wildcard workaround
  (firestore-rules-collection-coverage memory); any NEW, differently-named collection this
  workstream introduces (a unified file-metadata collection, a folders collection, a
  file-versions subcollection, a shares/ACL collection) needs its OWN explicit match block — it
  will NOT be covered by the existing `files_.*` wildcard unless it is deliberately named to
  start with `files_`.
- Rules must read fields via `.get(field, default)`, never bare field access, per the
  firestore-rules-missing-field-throws memory — directly relevant to any new per-file
  sharing-array field a rule needs to inspect (a doc predating the sharing feature will be
  missing that field entirely).
- `git push` deploys the app (GitHub Pages) but does NOT deploy `firestore.rules`/
  `storage.rules` — those need a separate `firebase deploy --only firestore:rules` /
  `--only storage` (CLAUDE.md, firebase-deploy-rules memory); re-`git diff` both rules files
  immediately before any whole-file deploy since concurrent sessions edit them live
  (deploy-recheck-full-file-diff memory) — especially relevant here since this workstream will
  likely need edits to BOTH `firestore.rules` (new collection(s)) AND `storage.rules` (if any new
  Storage path/ACL shape is introduced), which are two separate deploy commands.
- `escHtml()` discipline is universal in every file-listing UI reviewed (`bindFileCollection`'s
  file names/folder names/uploader names, `renderDocCollection`'s titles/descriptions,
  `design_drawings`' revision notes) — any new Hub UI must keep escaping every user-supplied
  string (file names are user-controlled via the original upload filename, folder names are
  free-typed, share-target labels would be user/admin-typed) before `innerHTML` interpolation.
- Manila-time discipline (`window.bizDate()`/`bizHour()`/`bizDow()`, js/config.js:17-37) applies
  to any new "sort by date"/"auto-purge after N days" recycle-bin logic — raw `new
  Date().toISOString()` previously corrupted attendance/payroll (manila-time-helpers memory) and
  the same class of bug would misdate a recycle-bin purge job or a "recently added" filter.
- `Drive.uploadFile`'s path convention (`${department}/${subfolder}/${Date.now()}_${file.name}`)
  and storage.rules' matching path-segment rules (§ below) are the ONLY thing standing between a
  new upload and a Storage-rules DENY — any new Hub upload flow that lets a user pick an
  arbitrary/free-typed "folder" name must still resolve to one of the department-segment paths
  storage.rules recognizes (`isReservedTop`'s excluded segments: Finance, tasks, posts,
  general/General, profile-photos, task-comments; the broad `{department}/{subfolder}/{fileName}`
  catch-all for everything else, storage.rules:196-204) — a truly free-form nested folder tree
  at the Storage-path level would need a NEW storage.rules block, since today's rule shape is
  exactly two path segments deep (`{department}/{subfolder}/{fileName}`), not N-deep.
- Storage rules are role/department-CLAIM based (`request.auth.token.role`/`.departments`,
  minted by the `syncUserClaims` Cloud Function per the storage-custom-claims memory) — Storage
  rules **cannot read Firestore** at all, so any per-file ACL that needs to affect Storage-level
  read/write (not just Firestore-metadata visibility) cannot directly consult a Firestore
  `sharedWith` array; it would need either a custom-claims bridge (another Cloud Function, more
  latency, and claims only refresh on token refresh — not instant) or accept that true
  enforcement only ever happens at the Firestore-metadata layer, with Storage staying gated by
  the existing broad department-folder rule.
- The `financeDelete`/`finance_delete_requests` President-approval-gated hard-delete pattern
  (departments.js:198-253, per the finance-delete-approval memory) already governs deletes for
  several finance-tier collections (`tax_records`, ledger entries, cash advances,
  `worker_profiles`) — if this workstream's Recycle Bin is meant to apply company-wide including
  Finance's files, it must decide whether to route through this EXISTING approval gate or
  introduce a second, competing delete-approval mechanism specifically for files.
- No existing file-collection query needs (or has) a composite index; a Hub with combined
  folder+archived+date+department filtering will need new entries in
  `firestore.indexes.json`, deployed via `firebase deploy --only firestore:indexes` — a
  compound-query index miss fails LOUDLY (unlike a rules miss, which fails silently behind a
  `.catch()`), so this is a build-time-discoverable, not silent, risk if handled correctly.
- Records/files are never meant to disappear silently — the "records kept forever, real-time,
  visible" owner directive (cited in the 25-leave.md brief from V12-PLAN.md:17-20) argues against
  ever hard-deleting a Storage blob or Drive mirror copy as part of a "recycle bin auto-purge";
  any auto-purge design should be scoped to metadata-doc visibility only, or archive-not-delete
  the underlying blob, unless Neil explicitly signs off on real deletion.

## Open decisions

1. **Scope of "unify"** — does this workstream (a) build a genuinely NEW single Firestore
   collection (and matching UI) that becomes the one source of truth for ALL files going
   forward, migrating/backfilling the 12+ existing `files_<scope>` collections into it; (b)
   leave the 12+ `files_<scope>` collections exactly as-is and build a Hub that federates
   read-across all of them live (N parallel `.get()` calls, since collection names aren't
   enumerable — see Current state §8); or (c) something narrower — unify ONLY the `files_<scope>`
   family (already the most homogeneous of the three subsystems) and explicitly leave task
   attachments / payslip proofs / drawing files / profile photos / worker ID photos out of scope
   for v1? Each choice has a very different blast radius across the 15+ department screens that
   currently call `bindFileCollection` directly.
2. **Folder model** — the mandate says "folders/subfolders" but the current `folder` field is a
   single flat string tag, one level deep, with no parent/child relationship and no evidence a
   "New Folder" creation path was ever fully wired (the button exists, departments.js:11685; its
   handler was not found in this research — see Current state §4b/Data model). Real subfolders
   need either a materialized path string (`"Marketing/Campaigns/2026"`) parsed client-side, or a
   genuine `folders/{id}` collection with `parentId` pointers and recursive resolution — a much
   bigger build than the current single-level chip bar.
3. **Versioning generalization** — generalize `design_drawings`' proven `revisions[]`-array-on-
   parent-doc pattern (simple, already shipping, unbounded array growth, old blobs never deleted)
   to every file type, or introduce a dedicated `file_versions` subcollection per file (bounded
   per-doc size, cleaner pagination for files with many versions, but a new collection + new
   rules block + more writes)? Note the existing pattern stores revision timestamps as raw ISO
   strings inside `arrayUnion` (not Firestore Timestamps, since `serverTimestamp()` cannot be used
   inside an array element) — any generalized version needs the same workaround or a different
   append mechanism.
4. **Recycle bin semantics** — generalize the existing `archived` boolean (already shipping,
   restorable, but no `deletedAt`, no auto-purge, no distinct screen) into a real Recycle Bin, or
   build a new `deletedAt`+status model? And does a "deleted" file route through the existing
   `financeDelete`/President-approval gate (already used for other finance-tier collections) or
   stay a simple uploader-or-admin toggle as it is today for files? Does auto-purge-after-N-days
   ever really delete the Storage blob (tension with the "records kept forever" directive) or
   only hide the metadata doc while leaving the blob/Drive mirror intact indefinitely?
5. **Sharing/ACL enforcement shape — the single largest new primitive, not a minor detail.**
   No per-file ACL exists anywhere in this codebase today (Current state §7); every rule is
   role/department-tier only. Concretely: (a) a `sharedWith` array of `{type:'user'|'dept'|
   'role', id, perm:'view'|'edit'}` maps, enforced ONLY client-side (rules stay at today's
   coarse tier — fast to build, but not real security, since Firestore rules cannot easily
   iterate/project an array-of-maps to check membership); (b) real rules-level enforcement,
   which likely requires FLATTENING the ACL into parallel scalar-array fields a rule CAN
   `hasAny()` against (e.g. `sharedUserIds: [uid,...]`, `sharedDeptIds: [...]`,
   `sharedRoles: [...]`) since Firestore security rules have real limits reading into arrays of
   objects; (c) a Cloud-Function-mediated grant (mint a custom claim or a signed download URL
   per share) — new infrastructure, a new deploy step (`cd functions && npm run deploy`,
   separate from both rules deploys). Fable must pick the shape, not just say "add sharing."
6. **View-vs-edit semantics** — what does "edit" concretely permit on a file: rename metadata
   only, move between folders, upload a new version (replacing "current"), or delete/archive?
   None of the three existing subsystems distinguish edit-metadata from edit-content today (the
   `files_<scope>` update rule is a single undifferentiated "owner or admin can update the whole
   doc").
7. **Storage-level truth vs. Firestore-metadata-level truth for sharing** — `getDownloadURL()`
   returns a bearer-token URL; once a Firestore rule lets someone read a file doc's `url`
   field, the app cannot cryptographically stop them from forwarding that URL to someone who was
   never shared with. Does Fable accept that "sharing" is metadata-visibility-only (matches how
   `order_tracking`/`id_verify` already work — see Current state §7), or is a
   proxy-download/signed-URL-minting Cloud Function genuinely required to make "view-vs-edit"
   meaningful at the byte level?
8. **Global file search** — extend `renderGlobalSearch` (js/modules.js:2474) with a 6th source
   group, or build a Files-only search screen? If extended, and decision 1 keeps the 12+
   `files_<scope>` collections separate, the search must either hardcode the full scope list
   (brittle — a new department Files tab silently isn't searched until added) or only search
   whatever NEW unified collection decision 1 creates.
9. **Previews** — plain `<img>`/`<iframe>` inline in a NEW lightbox-style modal (no existing
   lightbox component to reuse, Current state §9) vs. relying on the browser's native new-tab
   handling (today's behavior everywhere) — and whether previews target the Firebase Storage
   `url` (works immediately after upload) or the Drive-mirrored `driveUrl`, given Drive files are
   PRIVATE by default with zero `{public:true}` calls anywhere in the repo (Current state §3) —
   an un-shared `driveUrl` may not even render for the uploader's own colleague without a
   separate Drive-level grant, a real tension with the sharing mandate if `driveUrl` is ever
   preferred over the Storage `url` for previews/shares.
10. **Grid/list toggle + drag-drop scope** — `window.chipTabs` is a real, reusable precedent for
    the view-mode toggle (Current state §9); confirm it (or a purpose-built alternative) is the
    intended mechanism. Separately, disambiguate "drag-drop" in the mandate: drag-a-file-in-to-
    upload already exists (drive.js:198-203, shipping in `renderUploadArea` today); drag-an-
    existing-file-card-onto-a-folder-to-move-it does NOT exist anywhere — confirm which (or both)
    this workstream must deliver.
11. **Replace or add to the 15+ existing per-department Files tab entry points?** — does the new
    Hub become the ONLY way to browse files (retiring/redirecting Marketing/Finance/Sales/
    Design/Brilliant-Steel/Production's own Files tabs into deep-linked views of the unified
    browser — touches every one of those department screens) or does it ADD a new top-level
    "Files" nav item that aggregates read access while every department tab keeps its own
    independent upload flow (smaller blast radius, but doesn't fully deliver "one browser over
    all files")?
12. **Dead-code cleanup** — should the shadowed, unreachable `renderFileCollection`/
    `bindFileCollection` pair (departments.js:11379-11468, dead per Current state §4b) be deleted
    as part of this workstream's cleanup (safe — confirmed zero live callers reach it), or left
    alone as out-of-scope? Recommend flagging explicitly either way so a future maintainer editing
    the wrong copy doesn't waste time debugging a change that silently does nothing.
13. **Composite indexes** — enumerate the exact combined-filter queries the new browsing UI will
    issue (folder × archived × department × sort-by-date, etc.) so `firestore.indexes.json`
    entries can be authored and deployed BEFORE the UI ships, avoiding a loud but avoidable
    first-load failure.
14. **New-collection naming vs. the `files_.*` wildcard** — if decision 1 creates a genuinely new
    unified collection, should it be named to start with `files_` (automatically inheriting the
    existing wildcard rule's read/write shape AND the nightly sync's `labelFor` "Dept Files"
    folder AND `monthly-backup.js`'s auto-discovery — but also inheriting that rule's exact
    permission shape, which may not fit a company-wide Hub's needs) or given a distinct name with
    its own dedicated (non-wildcard) `firestore.rules` block, `sync-to-drive.js` `LABELS` entry,
    and confirmation that `monthly-backup.js`'s auto-discovery still covers it (it should, per
    Current state §3, since backup discovery is also `db.listCollections()`-driven)?

## Risks / cross-workstream interactions

- ⚠️ Direct interaction with **WS19 (Security closes, already shipped)**: the `files_.*`/
  `budgets_.*` wildcard rules were tightened THIS session to add `!isPartner()` (files) and
  `isMoneyAdmin()`-only write (budgets) — V12-PLAN.md:374-375 confirms `budgets_*` was "a genuine
  world-write" before that fix. Any new sharing/ACL rule this workstream adds must not
  accidentally reopen that hole (e.g. a naive `sharedWith`-based rule that forgets the
  `!isPartner()` guard would let the external Brilliant Steel partner read internal files again
  via a "shared to role:employee" grant that inadvertently matches their token).
- ⚠️ Direct interaction with **WS15 (durability, this session)**: `scripts/sync-to-drive.js` and
  `scripts/drive-lib.js` were both substantially reworked this session for exactly this kind of
  generic, auto-discovering file-mirror robustness (preflight, OAuth-vs-service-account,
  unfetchable-vs-error distinction, `system_health` heartbeat). Any new file-metadata collection
  this workstream creates should be sanity-checked against `sync-to-drive.js`'s `EXCLUDE` set and
  `LABELS` map (it will be silently swept into mirroring with a generic `titleCase()` folder name
  unless explicitly added) rather than assuming it needs its own bespoke sync logic.
- ⚠️ Direct interaction with **WS27 (IDs, this session)**: `uploadWorkerPhoto` (drive.js:55-59)
  and its `worker-id-photos/{profileId}/...` storage.rules block
  (storage.rules:126-136, `isFinanceClaim()`-gated, not uid-owned) is the ONLY existing precedent
  for a role-gated (not owner-gated) Storage write path — directly relevant if this workstream's
  sharing model needs a similar "uploaded on someone's behalf, not owner-scoped" write pattern.
  The `id_verify`/`order_tracking` public-unguessable-token pattern (also WS27/pre-existing) is
  the closest precedent for "share via link to anyone who has it," but is structurally the
  OPPOSITE of "share to a specific person/dept/role" — conflating the two would under-deliver on
  the mandate.
- ⚠️ **Three separately-evolved file-attachment subsystems (Current state §4) mean any "make
  files draggable/previewable/versioned/shareable" work done against only ONE of them (say, just
  `files_<scope>`) will silently NOT apply to task attachments, payslip proofs, drawing files, or
  Purchasing's `renderDocCollection` documents** — a Fable spec that doesn't explicitly enumerate
  which of the 25+ call sites/collections are IN vs OUT of scope risks Sonnet building a
  beautiful Hub that only shows a fraction of the company's actual files, silently
  under-delivering "one browser over all files."
- ⚠️ **`Drive.deleteFile` has zero call sites and `Drive.resolveUrl`/`sourceLabel`/`sourceIcon`
  are barely used** (Current state §1) — meaning today's Storage objects are NEVER actually
  deleted by any UI action (only Firestore metadata docs are), and Drive-vs-Cloud sourcing
  display is inconsistent across screens. A Recycle Bin/permanent-delete feature is the FIRST
  real caller `Drive.deleteFile` would ever get — it has never been exercised in production, so
  its error-handling path (`catch(e){ console.warn(...); throw e; }`, drive.js:64-66) is
  effectively untested.
- ⚠️ **Drive-mirrored files are private-by-default with zero `{public:true}` callers anywhere**
  (Current state §3) — if any part of the sharing feature is imagined as "share the Drive link,"
  that link will not actually be openable by the shared-to person without a separate, currently
  nonexistent Drive-permissions step. This is a real functional gap between the mandate's "share
  to person/dept/role" and the "rides Storage + nightly Drive mirror" clause in the SAME sentence
  — the two halves of that sentence pull in different directions unless Fable's spec addresses it.
- ⚠️ **The nightly sync's `files_` → single flat "Dept Files" Drive folder collapse**
  (sync-to-drive.js:78) means that even after this workstream ships better Firestore-side folder
  organization, the Google Drive side of the mirror will remain undifferentiated unless
  `sync-to-drive.js`'s `labelFor`/`ensureFolder` calls are also extended to honor the new
  per-file `folder`/`department` metadata when choosing a Drive destination folder — otherwise
  the in-app Hub and the Drive mirror visibly disagree about organization.
- ⚠️ **Composite-index risk is real but self-revealing**: unlike a missing security rule (silent
  denial), a missing composite index for a new combined-filter query fails loudly with a direct
  Firebase Console link — lower risk of a silent production bug, but still needs to be listed and
  deployed proactively so the FIRST user to combine filters doesn't hit a broken screen.

## Files likely touched

`js/drive.js` (new shared helpers: version-append, share-grant read/write, recycle-bin
toggle/purge, possibly a new `resolveUrl`/`sourceLabel` consumer wiring); `js/departments.js`
(the shadowed `renderFileCollection`/`bindFileCollection` pair at 11379-11468 [dead, candidate
for removal] and 11679-11783 [live, likely the direct base to extend or replace], the 15 call
sites at app.js:4240-4247 + departments.js:1971-1976, 2040-2041, 4153-4155, 5557-5558,
6812-6817, 8406-8407, 12404-12405, the `renderDocCollection` generic pattern at 11304-11362 used
by Purchasing, `design_drawings`' revision functions at ~6914, 7300-7500 if versioning
generalizes from this precedent, the direct `storage.ref` bypass in the task-comment handler at
~1893); `js/app.js` (the 3 `renderFileCollection`/`bindFileCollection` call sites at 4240-4247 for
My/Dept/All-Company Files, possibly a new top-level nav/router entry for a unified Hub page);
`js/modules.js` (`renderGlobalSearch` at 2474-2528 if file search is folded in, `safeHttpUrl` at
line 18 for any new link rendering); `firestore.rules` (the `files_.*`/`budgets_.*` wildcard
block at 1126-1157; `design_drawings` at 709-719 if versioning generalizes from it; any new
dedicated collection for unified file metadata, folders, version history, or sharing/ACLs needs
its own new match block — none of these are covered by the existing wildcard unless deliberately
named `files_*`); `storage.rules` (the department-folder catch-all at 196-204, `isReservedTop`/
`isMemberOf` helpers at 93-108, `worker-id-photos` at 126-136 as the nearest role-gated-not-
owner-gated precedent; any new per-object or deeper-than-two-segment folder path needs new rule
shapes); `firestore.indexes.json` (new composite indexes for combined folder/archived/department/
date queries — currently zero entries for any file-bearing collection); `scripts/sync-to-drive.js`
(the `LABELS`/`EXCLUDE` maps at 63-87 if a new unified collection needs a distinct Drive-folder
label, and `labelFor`/`ensureFolder` if Drive-side folder structure should mirror the new
Firestore-side folder model); `sw.js` (CACHE_VER bump, PRECACHE array if any new JS file is
added); possibly `index.html` (script tag insertion if a new dedicated Files-Hub JS module file
is created, following the fixed load-order convention).

## Expected deliverable format

> A numbered build spec Sonnet can execute without further judgment calls, covering at minimum:
> one, a resolved scope decision (which of the 25+ existing file-storage call sites/collections
> are unified into the new Hub vs. explicitly left out of v1, stated per-collection, not as a
> vague "all files"); two, the exact new/changed Firestore data shapes — field name, type,
> default — for any new unified file-metadata collection, any new folders collection, any new
> version-history shape (array-on-doc vs. subcollection, with a concrete choice and rationale
> against the `design_drawings` precedent), and any new sharing/ACL shape (with the enforcement
> mechanism explicitly chosen from Open Decision 5's options, not left as "add an ACL field"),
> plus literal `firestore.rules` before/after diffs for every collection touched, in the same
> comment-then-match style as the existing rules file; three, exact function signatures and
> before/after code for every touched call site, keyed to the file:line citations in this brief,
> including an explicit instruction on what to do with the confirmed-dead
> `renderFileCollection`/`bindFileCollection` pair at departments.js:11379-11468 (delete or
> leave, stated explicitly); four, the Storage-rules shape for any new upload/share path (with an
> explicit statement of what "view vs edit" mechanically means at the Storage layer, and an
> explicit acknowledgment of the bearer-token `getDownloadURL()` limitation from Current state
> §7 — i.e. what security "sharing" actually buys versus what it cannot enforce); five, a
> numbered migration/backfill checklist in dependency order (rules deploy → new collection(s)
> live → backfill/no-backfill decision for the 12+ existing `files_<scope>` collections, stated
> explicitly, including whether old per-department Files tabs are cut over or left running in
> parallel) with an explicit note on `firestore.indexes.json` entries needed and deployed before
> the query ships; six, explicit UI notes for the folder tree, grid/list toggle (confirm
> `chipTabs` reuse or a stated alternative), preview modal (new component, since none exists), and
> Recycle Bin screen, each grounded in a concrete precedent cited in this brief (or explicitly
> stated as wholly new); seven, an explicit call-out of which OTHER workstreams (WS15 durability,
> WS19 security, WS27 IDs) this spec depends on or must be sequenced around, per the Risks
> section, so Sonnet does not build against Storage-mirror or rules assumptions that are
> simultaneously being changed elsewhere.
