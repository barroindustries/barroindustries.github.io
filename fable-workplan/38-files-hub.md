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

## DECIDED — architecture spec (Fable, 2026-07-11)

### Resolved decisions (one per Open Decision, numbered to match)

1. **Scope of "unify" → (a)/(c) hybrid: a genuinely NEW unified collection `hub_files` that absorbs ONLY the `files_<scope>` family (all 12+ collections), migrated by an Admin-SDK script; everything else stays put in v1.** The 15 `bindFileCollection` call sites keep their exact signatures — the LIVE implementation is rewritten internally to read/write `hub_files` filtered by `scope`, so per-department Files tabs become deep-linked views of the Hub with zero call-site edits. Task attachments, comment uploads, payslip proofs, `design_drawings`, `renderDocCollection` docs, profile/worker photos, and inline finance-doc attachments are **explicitly OUT of v1** (full per-collection table in Spec 9). Rationale: the `files_<scope>` family is the homogeneous 80% and the only part with a browsing UI today; federating unenumerable collections (option b) is impossible client-side (`db.listCollections()` is Admin-SDK-only), and migrating task/finance attachments would touch payroll/ledger surfaces mid-flight with WS20-adjacent risk.
2. **Folder model → real `hub_folders/{id}` collection with `parentId` pointers; files carry a single `folderId`; paths are computed client-side from the loaded folder map — NO denormalized path strings on files.** Folders per scope are few (dozens, not thousands), so the Hub loads all folders for the active scope in one query and builds the tree/breadcrumbs in memory. Rename = update one folder doc, zero cascade. Delete = allowed only when empty OR reparents children to the folder's parent (client-enforced). Legacy `folder` string tags and `isFolderMarker` sentinel docs are converted to `hub_folders` docs by the migration script. The dead "📁 New Folder" mystery is resolved: its handler EXISTS at departments.js:11795-11814 (writes an `isFolderMarker` doc) — that pattern is retired in favor of `hub_folders`.
3. **Versioning → generalize the `design_drawings` array-on-doc pattern: `versions[]` on the `hub_files` doc, integer `v` (1,2,3…), NOT letters (avoids the `nextRev` past-'Z' bug at departments.js:6914).** Entry timestamps are ISO strings (the `arrayUnion`-can't-hold-`serverTimestamp` constraint, same as design_drawings). The parent doc denormalizes the CURRENT version's `url/name/size/contentType/currentV`. No `file_versions` subcollection: general company files rarely exceed a handful of versions; at ~300 bytes/entry the 1MB doc limit gives >2,000 versions of headroom; one read renders the whole history. Old version blobs are NEVER deleted (records-forever directive). `design_drawings` keeps its own `revisions[]` mechanism untouched — no cross-migration.
4. **Recycle bin → NEW `deleted:boolean` + `deletedAt:Timestamp` + `deletedBy` fields; the existing `archived` boolean SURVIVES as a separate concept (Archive = tidy-away, Bin = pending-delete).** Soft-delete (any editor/owner/admin) sets `deleted:true`; Restore clears it; **permanent delete is PRESIDENT-ONLY** — it deletes the Storage blob via `Drive.deleteFile` (its first-ever real caller) then the Firestore doc. It does NOT route through `financeDelete`/`finance_delete_requests`: the president IS the approver in that flow, so gating the button to president collapses the approval chain to one step with no second competing mechanism. The Drive-mirror copy is NOT deleted (cold archive, records-forever). **NO auto-purge job** — bin items sit indefinitely (‼️ FLAG FOR NEIL below). The `deleted` boolean (not a null-check on `deletedAt`) exists so every query stays equality-only and rules-provable.
5. **Sharing/ACL shape → flattened uid arrays enforced at the FIRESTORE-RULES level (Open Decision 5 option b), with one deliberate narrowing: dept- and role-shares are EXPANDED TO CONCRETE UIDs at share time.** Rules keep exactly two enforcement arrays — `sharedUserIds` (view) and `editorUserIds` (edit; every editor uid is ALSO mirrored into `sharedUserIds` as an invariant) — because `request.auth.uid in resource.data.sharedUserIds` + a `.where('sharedUserIds','array-contains',uid)` query is the one CANONICAL, documented rules-provable list pattern; a `hasAny(get(users).departments)` disjunct is not reliably provable for list queries and would risk whole-query denials. A display-only `shares[]` array of `{type:'user'|'dept'|'role', id, label, perm, by, byName, at}` records the human-level grant for the UI; the share modal expands dept/role targets to member uids at grant time (excluding `role=='partner'` users unless the target IS a specific partner uid — closes the WS19 partner-reopen risk by construction). Known limitation, flagged: users joining a dept AFTER a dept-share don't inherit it until re-shared. No Cloud Function, no custom-claims bridge (option c rejected: new deploy surface, token-refresh latency, disproportionate for v1).
6. **View-vs-edit semantics — exact grant table.** VIEW = see the doc, open/download/preview, see version history. EDIT = everything in VIEW plus rename/re-describe, move between folders, upload a new version, archive/unarchive, soft-delete/restore. NEITHER may: change sharing/visibility, transfer ownership, or permanently delete. Enforced in rules via `diff().affectedKeys().hasOnly(...)` on the editor clause (Spec 2) — owner/admin update any field, editors only the non-ACL field set.
7. **Storage-level truth → sharing is METADATA-VISIBILITY ONLY; accepted and documented.** `getDownloadURL()` returns a bearer-token URL — once someone can read the doc's `url` field, forwarding it cannot be prevented without a signed-URL-minting Cloud Function proxy, which is REJECTED for v1 (matches how `order_tracking`/`id_verify` already treat token URLs). Storage paths stay the existing two-segment `${department}/Files/${Date.now()}_${name}` convention via `Drive.renderUploadArea({dept, subfolder:'Files'})` — **zero storage.rules changes**; the folder tree exists only in Firestore metadata (`folderId`), never as N-deep Storage paths. Previews and Open always use the Storage `url`, never `driveUrl` (Drive mirrors are private-by-default with zero `{public:true}` callers — an un-granted `driveUrl` won't render for colleagues). `driveUrl` becomes a "mirrored ✓" badge only, finally putting `Drive.sourceLabel`/`sourceIcon` to use and retiring the inconsistent inline `driveUrl||url` precedence (Current state §1); `design_drawings`' own `fileUrl||driveUrl` line stays untouched (out of scope).
8. **Global file search → extend `renderGlobalSearch` (modules.js:2474) with a 6th source group reading `hub_files` ONLY** — company-visible query capped at `limit(1000)` (same cap as products) merged with "mine" + "shared-with-me" queries, client-side substring filter on `name`/`description`/folder name. Legacy `files_<scope>` collections are NOT searched (they're frozen after migration); out-of-scope attachment families (tasks, payslips, drawings) remain unsearched in v1, stated plainly in the ROADMAP note.
9. **Previews → NEW lightbox modal `window.openFilePreview(f)` in js/drive.js** (no existing component — wholly new, confirmed by the zero-hit grep in Current state §9): `<img>` for `image/*` (by `contentType`, falling back to extension sniff), `<iframe>` for PDFs, and an "Open in new tab ↗" fallback card for everything else; always sourced from the Storage `url` per decision 7; all interpolations `escHtml`'d; URL through `safeHttpUrl`.
10. **Grid/list toggle → `window.chipTabs`/`bindChipTabs` (the quotes-screen List/By-Customer precedent, departments.js:6614), wired to a real CSS-grid-cards vs table-rows swap. Drag-drop = BOTH mandate senses:** drag-in-to-upload already ships inside `renderUploadArea` (drive.js:198-203, keep as-is); drag-an-existing-card-onto-a-folder is NEW — HTML5 `draggable` on file rows/cards, `dragover`/`drop` targets on folder-tree nodes and folder chips, dropping calls `FilesHub.moveToFolder(fileId, folderId)` (edit-permission-gated).
11. **Replace or add → BOTH, cheaply: a new top-level "Files" nav page (`renderFilesHub`, all scopes, admin sees everything) is ADDED, while every existing per-department Files tab KEEPS its entry point but is re-backed by `hub_files` through the rewritten `bindFileCollection` internals.** One data plane, N doors. No department screen's call site changes (decision 1), fully delivering "one browser over all files" for the files_<scope> family without a 15-screen cutover.
12. **Dead-code cleanup → DELETE both shadowed pairs.** (i) The old `renderFileCollection`/`bindFileCollection` at **departments.js:11379-11470** (bare top-level declarations, silently shadowed by the `window.*` reassignments at 11679/11697 — 100% dead, zero reachable callers). (ii) Research for this spec found the SAME shadowing bug one function up: the old `async function renderDocCollection` at **departments.js:11303-11374** is shadowed by `window.renderDocCollection` at departments.js:11852 (top-level `function` declarations and `window.X =` assignments share one global binding; the assignment executes after hoisting and wins) — delete it in the same commit. Both deletions are pure dead-code removal; verify with grep that no remaining code references the deleted bodies' unique strings (`file-req-delete-btn`, `policy-grid`… note `policy-grid`/`policy-card` CSS classes are used by the LIVE renderDocCollection too — grep the exact function headers instead).
13. **Composite indexes → enumerated in Spec 3 and deployed BEFORE the UI ships.** All Hub queries are deliberately equality + at most one `array-contains`, no `orderBy` (sorting is client-side after merge), which keeps the index list short and the rule proofs simple.
14. **Naming → `hub_files` / `hub_folders`, deliberately NOT `files_*`-prefixed.** This is load-bearing, not cosmetic: `coll.matches('files_.*')` (firestore.rules:1126) would ALSO match a `files_hub` collection, and Firestore takes the permissive UNION of matching rules — the wildcard's "any internal staff reads everything" would silently defeat `visibility:'private'` and per-file sharing. Consequences handled: new dedicated rules blocks (Spec 2), `LABELS` entries in scripts/sync-to-drive.js (Spec 7) so the mirror gets a 'Files Hub' Drive folder instead of `titleCase` fallback, and `monthly-backup.js` auto-discovers both via `db.listCollections()` (no registration needed).

**Scoping / sequencing:** builds ON WS15 (the reworked generic sync auto-mirrors `hub_files` once the LABELS entry lands; do NOT write bespoke sync logic); must preserve WS19's closures (`!isPartner()` guard present in every new rule clause; partner access only via explicit uid share); no WS27 dependency (the `worker-id-photos` role-gated path is precedent only, not touched). **WS34 (materials library) and WS35 (project/client folders) build directly on this spec — their binding contract is the next section.**

---

### CONTRACT for WS34 / WS35 (final, build against this)

- **File metadata lives in `hub_files/{docId}`** (shape in Spec 1). One doc per file; `scope` (lower_snake string) is the namespace that used to be the `files_<scope>` collection suffix. WS34 uses `scope:'materials'`; WS35 uses `scope:'projects'` (or one scope per portal surface — any new scope string Just Works, no rules/sync/backup changes, because scope is a field, not a collection name).
- **Folders live in `hub_folders/{docId}`** `{name, parentId|null, scope, department, createdBy, createdAt}` — WS35's project/client folders are ordinary `hub_folders` rows (e.g. one folder per client under `scope:'projects'`), optionally carrying extra domain fields (WS35 may add `clientId`/`projectId` fields to its folder docs; the Hub ignores unknown fields).
- **Storage path convention:** `${department}/Files/${Date.now()}_${fileName}` via `Drive.renderUploadArea(containerId, cb, {dept, subfolder:'Files'})` — two segments, covered by the existing storage.rules catch-all (storage.rules:196-204). Do NOT invent deeper paths; the folder tree is Firestore-only.
- **Permission model:** `visibility:'company'` (default; any internal non-partner staff) or `'private'` (owner + `sharedUserIds` only); `editorUserIds ⊆ sharedUserIds` invariant; admins (president/manager) read/write everything; partner reads only docs whose `sharedUserIds` contain their uid. Reads MUST use the query fan-out in Spec 4 (`FilesHub.loadFiles`) — a bare unfiltered `.get()` on `hub_files` is DENIED by rules for non-admins.
- **Helpers:** call `window.FilesHub.*` (Spec 4) from js/drive.js — do not re-implement upload/version/share/bin logic.

---

### Spec 1 — Data shapes (annotated literals)

```js
// hub_files/{docId} — NEW unified file-metadata collection (root). Migrated docs use
// docId = `${legacyCollection}__${legacyDocId}` (idempotency key); new uploads use auto-id.
{
  name: 'Q3 Proposal – ACME',        // display name (user-editable), escHtml on render
  description: '',                    // optional, from Add Link / edit modal
  fileType: 'PDF',                    // legacy free dropdown value, kept for continuity
  kind: 'file',                       // 'file' | 'link'  (link = pasted URL, no Storage blob)
  scope: 'proposals',                 // namespace — replaces the files_<scope> collection suffix
  department: 'Sales',                // literal dept of the owning Files tab (query + display)
  folderId: null,                     // null = scope root, else hub_folders docId
  url: 'https://firebasestorage…',    // CURRENT version download URL ('' never; links store the link)
  driveUrl: null,                     // filled by nightly sync companion-key write (url→driveUrl)
  size: 182034, contentType: 'application/pdf',   // from the File object at upload (null for links)
  source: 'firebase',                 // 'firebase' | 'link'  (Drive.uploadFile convention)
  currentV: 1,
  versions: [                         // design_drawings pattern, integer v, ISO `at`
    { v:1, url, name:'proposal.pdf', size, contentType, note:'', by:'<uid>', byName:'…', at:'2026-07-11T02:10:00.000Z' }
  ],
  archived: false,                    // legacy tidy-away flag, KEPT (≠ recycle bin)
  deleted: false,                     // recycle-bin flag — equality-queryable boolean
  deletedAt: null, deletedBy: null,   // Timestamp + uid when deleted:true (audit / future purge age)
  visibility: 'company',              // 'company' (default = today's behavior) | 'private'
  sharedUserIds: [],                  // VIEW grants — the ONLY rules-enforced view array
  editorUserIds: [],                  // EDIT grants — invariant: every entry also in sharedUserIds
  shares: [                           // DISPLAY-ONLY grant log (rules never read it)
    { type:'dept', id:'Marketing', label:'Marketing (4 people)', perm:'view', by:'<uid>', byName:'Neil', at:'<ISO>' }
  ],
  uploadedBy: '<uid>', uploaderName: 'Ana R.',
  legacyColl: 'files_proposals', legacyId: 'abc123',   // migration provenance (absent on new uploads)
  createdAt: serverTimestamp, updatedAt: serverTimestamp
}

// hub_folders/{docId} — NEW folder tree (per scope). Paths computed client-side; no cascade.
{ name:'Campaigns', parentId:null, scope:'advertising', department:'Marketing',
  createdBy:'<uid>', createdByName:'…', createdAt: serverTimestamp }
```

### Spec 2 — firestore.rules diff (new blocks; comment-then-match style; nothing existing changes)

The `files_.*`/`budgets_.*` wildcard block (firestore.rules:1126-1157) is **left byte-identical** — legacy collections stay readable (frozen archive) and `budgets_*` is untouched. Insert AFTER that block:

```
    // ── Files Hub (WS38) — unified file metadata + folder tree ─────────
    // Deliberately NOT named files_*: the files_.* wildcard above would
    // union-grant all-internal read and defeat per-file visibility/sharing.
    // Sharing enforcement uses ONLY uid arrays (sharedUserIds/editorUserIds)
    // — the canonical `uid in array` + array-contains-query pattern that
    // Firestore can prove for list queries. Dept/role shares are expanded
    // to uids client-side at share time. All .get(field, default) per the
    // missing-field-throws memory (migrated docs predate some fields).
    match /hub_files/{fileId} {
      allow read: if isAuth() && (
           isAdmin()
        || resource.data.get('uploadedBy','') == request.auth.uid
        || request.auth.uid in resource.data.get('sharedUserIds', [])
        || (!isPartner() && resource.data.get('visibility','company') == 'company')
      );
      allow create: if isAuth() && !isPartner()
        && request.resource.data.get('uploadedBy','') == request.auth.uid
        && request.resource.data.get('visibility','company') in ['company','private']
        && request.resource.data.get('deleted', false) == false;
      // Owner/admin: any update (incl. sharing/visibility). Editors: content &
      // organization fields only — NEVER the ACL/ownership fields.
      allow update: if isAuth() && (
           isAdmin()
        || resource.data.get('uploadedBy','') == request.auth.uid
        || (request.auth.uid in resource.data.get('editorUserIds', [])
            && request.resource.data.diff(resource.data).affectedKeys().hasOnly(
                 ['name','description','fileType','folderId','archived',
                  'deleted','deletedAt','deletedBy',
                  'url','driveUrl','size','contentType','versions','currentV',
                  'updatedAt']))
      );
      // Permanent delete = president only (Recycle Bin soft-delete/restore are updates).
      allow delete: if isAuth() && isPresident();
    }
    match /hub_folders/{folderId} {
      allow read:   if isAuth() && !isPartner();
      allow create: if isAuth() && !isPartner()
        && request.resource.data.get('createdBy','') == request.auth.uid;
      allow update, delete: if isAuth() && !isPartner()
        && (resource.data.get('createdBy','') == request.auth.uid || isAdmin());
    }
```

Deploy: `~/.npm-global/bin/firebase deploy --only firestore:rules` — separate from `git push`; re-`git diff` firestore.rules immediately before (concurrent-session memory). Apply as a block-scoped Edit insertion, never a full-file replace.

### Spec 3 — firestore.indexes.json additions (deploy BEFORE the UI ships)

Every Hub query is equality-only plus at most one `array-contains`, no `orderBy` (sort client-side by `createdAt.seconds` after merge). Add to `firestore.indexes.json` and run `firebase deploy --only firestore:indexes`:

```json
{ "collectionGroup":"hub_files","queryScope":"COLLECTION","fields":[
  {"fieldPath":"scope","order":"ASCENDING"},{"fieldPath":"deleted","order":"ASCENDING"},{"fieldPath":"visibility","order":"ASCENDING"}]},
{ "collectionGroup":"hub_files","queryScope":"COLLECTION","fields":[
  {"fieldPath":"scope","order":"ASCENDING"},{"fieldPath":"deleted","order":"ASCENDING"},{"fieldPath":"uploadedBy","order":"ASCENDING"}]},
{ "collectionGroup":"hub_files","queryScope":"COLLECTION","fields":[
  {"fieldPath":"sharedUserIds","arrayConfig":"CONTAINS"},{"fieldPath":"scope","order":"ASCENDING"},{"fieldPath":"deleted","order":"ASCENDING"}]},
{ "collectionGroup":"hub_files","queryScope":"COLLECTION","fields":[
  {"fieldPath":"deleted","order":"ASCENDING"},{"fieldPath":"visibility","order":"ASCENDING"}]},
{ "collectionGroup":"hub_files","queryScope":"COLLECTION","fields":[
  {"fieldPath":"deleted","order":"ASCENDING"},{"fieldPath":"uploadedBy","order":"ASCENDING"}]},
{ "collectionGroup":"hub_files","queryScope":"COLLECTION","fields":[
  {"fieldPath":"sharedUserIds","arrayConfig":"CONTAINS"},{"fieldPath":"deleted","order":"ASCENDING"}]},
{ "collectionGroup":"hub_folders","queryScope":"COLLECTION","fields":[
  {"fieldPath":"scope","order":"ASCENDING"},{"fieldPath":"department","order":"ASCENDING"}]}
```

(First three back the per-scope tab queries; the next three back global search + the all-scopes Hub page; the last backs the folder-tree load. Some equality-only pairs may be served by index merging, but declaring them is cheap and a missing one fails loudly with a console link — declare all seven.)

### Spec 4 — `window.FilesHub` service (js/drive.js, appended inside/alongside the Drive IIFE region — drive.js loads before departments/app/modules, satisfying load order)

```js
window.FilesHub = {
  // ── Read fan-out. Rules cannot be satisfied by one unfiltered query for
  // non-admins, so merge 3 provable queries (admins: 1 broad query).
  async loadFiles(scope /* string|null = all scopes */, { includeDeleted=false } = {}) {
    const uid = currentUser.uid;
    const base = () => {
      let q = db.collection('hub_files');
      if (scope) q = q.where('scope','==',scope);
      return q.where('deleted','==', includeDeleted);
    };
    const isAdminRole = ['president','manager','owner'].includes(window.currentRole);
    const snaps = await Promise.all(
      isAdminRole
        ? [ base().get().catch(()=>({docs:[]})) ]
        : [ base().where('visibility','==','company').get().catch(()=>({docs:[]})),
            base().where('uploadedBy','==',uid).get().catch(()=>({docs:[]})),
            base().where('sharedUserIds','array-contains',uid).get().catch(()=>({docs:[]})) ]);
    const seen = {}; const out = [];
    snaps.forEach(s => s.docs.forEach(d => { if (!seen[d.id]) { seen[d.id]=1; out.push({id:d.id,...d.data()}); } }));
    return out.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  },
  async loadFolders(scope) {
    const snap = await db.collection('hub_folders').where('scope','==',scope).get().catch(()=>({docs:[]}));
    return snap.docs.map(d=>({id:d.id,...d.data()}));
  },
  folderPath(folderId, foldersById) {          // client-side path resolution (decision 2)
    const parts = []; let f = foldersById[folderId]; let guard = 0;
    while (f && guard++ < 20) { parts.unshift(f.name); f = foldersById[f.parentId]; }
    return parts.join(' / ');
  },
  canEdit(f) {
    return ['president','manager','owner'].includes(window.currentRole)
      || f.uploadedBy === currentUser.uid
      || (f.editorUserIds||[]).includes(currentUser.uid);
  },
  // ── Mutations (all set/update with merge-mindset; updatedAt always stamped)
  moveToFolder: (id, folderId) => db.collection('hub_files').doc(id)
    .update({ folderId: folderId || null, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }),
  async uploadNewVersion(f, result /* Drive.renderUploadArea result */, file, note) {
    const FV = firebase.firestore.FieldValue;
    const entry = { v:(f.currentV||1)+1, url:result.url, name:file?.name||result.name,
      size:file?.size||null, contentType:file?.type||null, note:note||'',
      by:currentUser.uid, byName:(window.userProfile?.displayName||currentUser.email),
      at:new Date().toISOString() };                     // ISO — arrayUnion can't hold serverTimestamp
    await db.collection('hub_files').doc(f.id).update({
      versions: FV.arrayUnion(entry),
      url:entry.url, size:entry.size, contentType:entry.contentType,
      currentV:entry.v, driveUrl:null,                    // new blob → re-mirrored by nightly sync
      updatedAt: FV.serverTimestamp() });
  },
  softDelete: (id) => db.collection('hub_files').doc(id).update({
    deleted:true, deletedAt:firebase.firestore.FieldValue.serverTimestamp(),
    deletedBy:currentUser.uid, updatedAt:firebase.firestore.FieldValue.serverTimestamp() }),
  restore: (id) => db.collection('hub_files').doc(id).update({
    deleted:false, deletedAt:null, deletedBy:null,
    updatedAt:firebase.firestore.FieldValue.serverTimestamp() }),
  async purge(f) {                                        // PRESIDENT ONLY (rules-enforced)
    // First-ever real Drive.deleteFile caller — blob deletes are best-effort:
    // link docs have no Storage object, legacy-migrated docs may 404, and the
    // Drive-mirror copies are deliberately NOT deleted (cold archive,
    // records-forever directive). Deletes EVERY version's blob, then the doc.
    const urlToPath = u => { try { return decodeURIComponent(new URL(u).pathname.split('/o/')[1]||''); } catch { return ''; } };
    if (f.source === 'firebase') {
      const urls = [...new Set([f.url, ...(f.versions||[]).map(v=>v.url)].filter(Boolean))];
      for (const u of urls) {
        const p = urlToPath(u);
        if (p) { try { await Drive.deleteFile({ id: p }); } catch(e) { console.warn('blob delete skipped:', e.message||e); } }
      }
    }
    await db.collection('hub_files').doc(f.id).delete();
  },
  // ── Sharing. target = {type:'user'|'dept'|'role', id, label}; perm 'view'|'edit'.
  // Dept/role targets are EXPANDED to uids NOW (decision 5); partners are excluded
  // from dept/role expansion — a partner can only be shared to as an explicit user.
  async share(f, target, perm) {
    const FV = firebase.firestore.FieldValue;
    let uids = [];
    if (target.type === 'user') uids = [target.id];
    else {
      const us = await db.collection('users').get();
      us.docs.forEach(d => { const u = d.data();
        if (u.role === 'partner') return;                  // WS19 guard, by construction
        if (target.type === 'dept' && (u.departments||[]).includes(target.id)) uids.push(d.id);
        if (target.type === 'role' && u.role === target.id) uids.push(d.id); });
    }
    if (!uids.length) throw new Error('No matching users for this share target');
    const upd = { sharedUserIds: FV.arrayUnion(...uids),
      shares: FV.arrayUnion({ ...target, perm, by:currentUser.uid,
        byName:(window.userProfile?.displayName||currentUser.email), at:new Date().toISOString() }),
      updatedAt: FV.serverTimestamp() };
    if (perm === 'edit') upd.editorUserIds = FV.arrayUnion(...uids);  // editors ⊆ shared invariant
    await db.collection('hub_files').doc(f.id).update(upd);
  }
};

// ── Preview lightbox (wholly new — zero existing component, Current state §9) ──
window.openFilePreview = function(f) {
  const url = f.url || '';
  const isImg = /^image\//.test(f.contentType||'') || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url);
  const isPdf = /pdf/.test(f.contentType||'') || /\.pdf(\?|$)/i.test(url);
  const safe = (typeof safeHttpUrl==='function') ? safeHttpUrl(url) : url;
  const body = isImg ? `<img src="${safe}" style="max-width:100%;max-height:70vh;border-radius:8px" alt="">`
    : isPdf ? `<iframe src="${safe}" style="width:100%;height:70vh;border:0;border-radius:8px"></iframe>`
    : `<div class="empty-state" style="padding:30px"><div class="empty-icon">📄</div>
         <p>No inline preview for this file type.</p></div>`;
  openModal(`${f.kind==='link'?'🔗':'📄'} ${_esc(f.name||'File')}`,
    body + `<div style="text-align:right;margin-top:10px">
      <a href="${safe}" target="_blank" class="btn-primary btn-sm">Open in new tab ↗</a></div>`, '');
};
```

(`Drive.renderStorageStatus` gets a two-line upgrade in the same file: read `system_health/daily_sync` and show `lastRunAt`/`lastStatus`/`filesWritten` instead of the static "Active" card — the heartbeat WS15 already writes, drive.js:255-277.)

### Spec 5 — Rewritten shared browser + dead-code deletion (js/departments.js)

**5a. DELETE departments.js:11379-11470** — the old bare `function renderFileCollection(title,id,currentRole)` + `function bindFileCollection(id,currentUser,dept,subfolder)` pair (shadowed, 100% dead per Current state §4b). Delete the whole span including the section banner comment at 11376-11378 if it would otherwise orphan.

**5b. DELETE departments.js:11303-11374** — the old bare `async function renderDocCollection(...)` (shadowed by `window.renderDocCollection` at 11852 by the same declaration-vs-assignment mechanics; the live one is the 11852 version with the Gov-Biddings lifecycle). Keep the banner comment area tidy.

**5c. REWRITE the LIVE `window.bindFileCollection` (departments.js:11697-11849) in place** — same signature `(containerId, currentUser, dept, scope, filterUid)` so all 15 call sites (app.js:4240-4247; departments.js:1971-1976, 2040-2041, 4153-4155, 5557-5558, 6812-6817, 8406-8407, 12404-12405) are UNTOUCHED. Internal changes:
- `const collection = 'hub_files'` with `const scopeKey = scope.toLowerCase().replace(/\s+/g,'_')` — the old `files_${scopeKey}` string survives only inside the migration script.
- `loadFiles` → `allFiles = await FilesHub.loadFiles(scopeKey)` when no `filterUid`; with `filterUid` keep a direct `.where('scope','==',scopeKey).where('deleted','==',false).where('uploadedBy','==',filterUid)` query (My Files). Drop the old `.where('department','==',dept)` — scope now carries the namespace.
- Folder chips → chips come from `FilesHub.loadFolders(scopeKey)` + per-file `folderId`; "📁 New Folder" writes a `hub_folders` doc (retire `isFolderMarker`); the reserved-name check moves to `hub_folders.name`.
- Upload modal (was 11759-11792): write the full Spec-1 shape (`kind:'file'`, `visibility:'company'`, `deleted:false`, `currentV:1`, `versions:[entry]`, `sharedUserIds:[]`, `editorUserIds:[]`, `shares:[]`, `size`/`contentType` from the `file` arg `renderUploadArea` already passes). Folder input becomes a `<select>` of `hub_folders` + "New folder…" option.
- Add per-row actions (gated by `FilesHub.canEdit(f)`): 👁 preview (`openFilePreview`), ⬆ new version (small modal hosting `renderUploadArea` → `FilesHub.uploadNewVersion`), 🔀 share (share modal → `FilesHub.share`), 🗑 soft-delete (`FilesHub.softDelete`); keep the 🗄/♻️ archive toggle as-is. Row shows `v{currentV}` badge when `versions.length>1` and the `Drive.sourceIcon` mirrored-badge (decision 7).
- Add a "🗑 Recycle Bin (N)" chip after "🗄 Archived": renders `FilesHub.loadFiles(scopeKey,{includeDeleted:true})` rows with Restore (all editors/owners) and **Delete forever** (rendered only for `currentRole==='president'`; calls `FilesHub.purge` after a typed-confirm dialog).
- Grid/list: `window.chipTabs([{key:'list',label:'☰ List'},{key:'grid',label:'▦ Grid'}],'list',{cls:'fh-view'})` above the table; grid mode renders the same `showing` array as CSS-grid cards (name, type icon, folder badge, uploader, date). Drag-drop move per decision 10 (`draggable` rows/cards; folder chips as drop targets).
- All user strings through `escHtml`; links through `safeHttpUrl`.

### Spec 6 — Top-level Files Hub page (js/modules.js) + nav

- `window.renderFilesHub()` in modules.js: scope selector chips (built from the DISTINCT `scope` values of the user's loaded files + a hardcoded seed list of the 12 known scopes), then reuses `renderFileCollection`/`bindFileCollection` per selected scope; admins get an "All scopes" view via `FilesHub.loadFiles(null)`. Global "search my files" input filters client-side.
- Router: add `case 'files-hub': renderFilesHub(); break;` to `navigateTo` (app.js switch); nav entry `{ id:'files-hub', label:'Files', icon:'folder-open' }` added to the internal-staff nav arrays in config.js (NOT the partner nav).

### Spec 7 — Nightly sync + backup touches (scripts/)

- scripts/sync-to-drive.js `LABELS` map (lines 63-72): add `hub_files: 'Files Hub'`. Do NOT add `hub_files`/`hub_folders` to `EXCLUDE` (`hub_folders` holds no URLs — the walker skips it naturally, matching the `budgets_` rationale; an explicit `if (name === 'hub_folders') return null;` line in `labelFor` is optional tidiness). The WS15 walker then auto-mirrors every `hub_files.url` (and version-entry URLs — it string-scans whole docs) with companion-key `driveUrl` writes. Drive-side per-folder organization of the mirror is explicitly DEFERRED (mirror = flat cold archive; the in-app Hub is the organized view).
- scripts/monthly-backup.js: auto-discovers both new root collections via `db.listCollections()` — no change needed (confirm by dry-run).

### Spec 8 — Migration script (NEW: scripts/migrate-files-hub.js, Admin SDK — clients cannot enumerate `files_*` collections)

Runs locally with `FIREBASE_SERVICE_ACCOUNT` (same env as scripts/sync-to-drive.js). Idempotent — safe to re-run any time:

```
1. cols = await db.listCollections(); pick names matching /^files_/ (excludes files-free budgets_*).
2. For each files_<scope> doc:
   a. isFolderMarker docs → ensure hub_folders doc {name:folder, parentId:null, scope, department,
      createdBy:uploadedBy, createdAt} keyed by deterministic id `${scope}__${slug(folder)}` (set, merge).
   b. real docs → db.collection('hub_files').doc(`${coll}__${docId}`).set({
        ...legacy fields mapped to Spec-1 names (uploaderName||uploadedByName, kind:link if source==='link'),
        scope: coll.replace(/^files_/,''), folderId: folder ? `${scope}__${slug(folder)}` : null,
        visibility:'company', deleted:false, deletedAt:null, deletedBy:null,
        currentV:1, versions:[{v:1,url,name,size:null,contentType:null,note:'migrated',by:uploadedBy,byName:uploaderName,at:<createdAt ISO>}],
        sharedUserIds:[], editorUserIds:[], shares:[],
        legacyColl:coll, legacyId:docId }, {merge:true});    // deterministic id ⇒ idempotent
3. Print per-collection counts. NEVER deletes/edits the legacy docs (frozen archive, records-forever).
```

### Spec 9 — Scope table: IN vs OUT of the v1 Hub (per collection — decision 1)

| Surface | v1 |
|---|---|
| `files_personal/shared/all/advertising/designs/sss/accounting/proposals/product_designs/references/files_<bs-subtab>/files_files` (all 12+) | **IN — migrated to `hub_files`, legacy frozen read-only** |
| `tasks.attachments[]`, `{taskColl}/comments.fileUrl` (incl. the direct storage.ref bypass at departments.js:1893) | OUT — task-scoped UX, WS-later |
| `posts` attachments | OUT |
| Admin memos/policies/resources + Purchasing via `renderDocCollection` | OUT — doc-cards pattern, financeDelete-governed |
| `expenses`, `tax_records`, ledger journals, `sales_orders`, CA/collections proofs, `payslips` proof | OUT — finance-tier attachments, financeDelete/WS20 territory |
| `design_drawings` (+ its `revisions[]`) | OUT — keeps its own proven versioning |
| `users.photoUrl`, `worker_profiles.photoUrl`, `id_verify` | OUT — identity assets, WS27 |

### Spec 10 — Migration / rollout checklist (dependency order)

1. **Deploy rules** (Spec 2 blocks) — `firebase deploy --only firestore:rules` after a fresh `git diff` re-check. Old clients unaffected (they don't touch `hub_*`).
2. **Deploy indexes** (Spec 3) — `firebase deploy --only firestore:indexes`. Wait for build to finish (console shows READY).
3. **Add `LABELS` entry** to scripts/sync-to-drive.js + commit (Spec 7).
4. **Run `node scripts/migrate-files-hub.js`** (Spec 8). Verify counts vs a spot-check of 2-3 legacy collections in the console.
5. **Ship the JS** (one commit): drive.js (`FilesHub`, `openFilePreview`, storage-status heartbeat), departments.js (dead-code deletions 5a/5b + live rewrite 5c), modules.js (`renderFilesHub` + global-search 6th source), app.js (router case), config.js (nav arrays). `node --check` each file. CACHE_VER bump in sw.js (manual — the pre-commit hook only bumps APP_VERSION). No new script file → no index.html/PRECACHE change.
6. **Re-run the migration script once more** after the deploy propagates — sweeps any uploads that landed in legacy collections during the deploy window (idempotent, deterministic ids).
7. **Legacy `files_<scope>` collections stay forever** (read-only archive; wildcard rule untouched; still mirrored/backed up). No client code writes to them after step 5.
8. Update ROADMAP.md:287 (files search now included via hub_files; out-of-scope families listed).

### Spec 11 — Manual test checklist

1. Migration: pick `files_proposals` — every legacy doc appears in the Sales → Proposals tab post-deploy with its folder chip intact; the legacy doc is unchanged in the console; re-running the script changes nothing (idempotent).
2. Upload a new file into Marketing → Advertising → doc lands in `hub_files` with `scope:'advertising'`, Spec-1 shape; nightly sync later fills `driveUrl` and the row shows the mirrored badge.
3. Folders: create nested folders A → A/B; move a file into B by drag-drop; breadcrumb shows "A / B"; rename A → path updates everywhere with a single doc write; deleting non-empty A reparents B's contents.
4. Versions: upload v2 on a file → `currentV:2`, history modal lists v1+v2 (both downloadable), row badge "v2"; Open uses the v2 Storage `url`.
5. Sharing: set a file `visibility:'private'` → colleague's tab no longer lists it (their 3-query merge excludes it); share to that colleague as VIEW → it appears, they can preview/download but the rename/new-version buttons are hidden AND a forced console `update({name:'x'})` is rules-DENIED; upgrade to EDIT → rename works, but `update({sharedUserIds:[...]})` from their console is DENIED (affectedKeys guard).
6. Dept-share expansion: share to dept 'Marketing' → every current Marketing member's uid lands in `sharedUserIds`; the partner account gains nothing; `shares[]` shows one dept-grant row.
7. Partner: Brilliant Steel partner sees NO hub files by default; after an explicit user-share to their uid they see exactly that one file.
8. Recycle bin: soft-delete → file leaves all normal views, appears under 🗑 with restore; restore works; as president, Delete forever removes the Firestore doc AND the Storage blob (URL now 403s); as manager the Delete-forever button is absent and a console `.delete()` is DENIED.
9. Global search: query a hub file name from the global search screen → hit appears; a task attachment name does NOT (documented out-of-scope).
10. Grid/list chipTab toggles rendering; drag-in-to-upload still works in the upload modal.
11. Dead code: grep confirms single definitions of `renderFileCollection`/`bindFileCollection`/`renderDocCollection`; all 15 Files tabs + Admin Policies + Purchasing + Gov Biddings screens still render (the live implementations were the only ones ever executing).
12. Rules deploy hygiene: `git diff firestore.rules` clean-before-deploy both times; legacy `files_*` reads still work for a signed-in employee (wildcard untouched).

### Flags for Neil

- **‼️ FLAG FOR NEIL — Recycle Bin has NO auto-purge.** Deleted files sit in the bin indefinitely (records-forever directive); only you can "Delete forever". Say the word if you want a timed purge (e.g. 30 days) — it would be a GitHub-Actions script honoring `deletedAt`, metadata-only, blobs kept.
- **‼️ FLAG FOR NEIL — "Delete forever" removes the app copy + Storage blob but NOT the Google Drive mirror copy.** The Drive archive keeps everything ever synced. Confirm that's the intent (it matches "records kept forever"); true full erasure would need a manual Drive delete.
- **‼️ FLAG FOR NEIL — sharing is visibility-level, not download-level.** Anyone a file is shared with gets a working download URL they could forward outside the shared list (Firebase bearer-token URLs; same as every existing file in the app today). Cryptographic enforcement would need a Cloud-Function signed-URL proxy — deliberately not built in v1.
- **‼️ FLAG FOR NEIL — dept/role shares snapshot membership at share time.** Someone joining Marketing NEXT month does not inherit last month's "shared to Marketing" grants until the file is re-shared. Acceptable for v1; live dept-membership sharing would need a rules pattern Firestore can't reliably prove for list queries.
