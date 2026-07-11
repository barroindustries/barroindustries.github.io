# Workstream 33 — AEC Partner Directory (Architects/Engineers/Contractors contact table)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

1. **The owner mandate, verbatim (V12-PLAN.md:199-203, "owner spec 2026-07-09"):** "AEC Partner
   Directory — table in Sales: item # · type (A=Architect yellow / E=Engineer red /
   C=Contractor blue) · company · contact person · number · email · PH region · address ·
   contacted status · prospected project? · quotation sent? · feedback/partnership potential.
   Filterable, CSV export, printable on letterhead, follow-up nudges. New `aec_contacts`
   collection + rules + backup." It also appears in the "Per-department printable documents"
   table (V12-PLAN.md:243) as `Sales: … AEC contact sheet`, and in the sales-bottleneck strategy
   note (V12-PLAN.md:260) as "AEC pipeline (structured prospecting)" — one of four named pieces
   of the sales-bottleneck fix alongside Quick Quote guided mode, photo catalog, and follow-up
   nudges/win-rate analytics.

2. **This is the first grounding brief written for Phase 4.** V12-PLAN.md's Build Log
   (line 1074-1084, dated 2026-07-10) explicitly records that Phase 4 (workstreams 28-40,
   including this one) shipped with **zero** prior Fable grounding/DECIDED specs, unlike
   Phases 1-3 (workstreams 09-27) which were all pre-researched before implementation. This file
   is pure recon closing that gap for WS33 specifically — no sibling Phase-4 brief exists yet to
   cross-reference for shared infrastructure (e.g. whether WS32's "Client Relations hub" or
   WS31's "Quotation builder v3" have already been grounded — as of this brief, they have not).

3. **Confirmed via repo-wide grep: `aec_contacts` and the AEC-directory concept do not exist
   anywhere yet — this is a wholly new feature, not a hidden/partial one.** Searched
   `aec_contacts`, `AEC`, `Architect`, `Contractor`, `Engineer` (case-insensitive) across every
   `js/*.js`, `firestore.rules`, `ROADMAP.md`, `scripts/*.js`, `functions/*.js`. The ONLY hits
   are: the V12-PLAN.md mandate itself (3 lines, item 1 above), and one comment in
   `scripts/monthly-backup.js:111` (item 8 below) that names `aec_contacts` purely as an
   *example* of a future collection the backup script's auto-discovery already covers — no code
   for it exists. `Barro_Operations_Tracker.html` (the separate, non-live standalone
   client/biddings dashboard referenced in CLAUDE.md, generated from `.xlsx` trackers) was also
   grepped and has **zero** mentions of AEC/Architect/Engineer/Contractor/region — so this is not
   a port of an existing spreadsheet feature either. No `PH_REGIONS`/`PHILIPPINE_REGION`-style
   constant, and no PH-region dropdown of any kind, exists anywhere in the codebase — every
   existing "address" field in the app (`worker_profiles.address`, `sales_clients.address`) is a
   plain free-text `<textarea>`, confirmed by reading `openHRProfileForm` (departments.js) and
   `openClientEditor` (departments.js:11149) — a PH-region enum would be the first of its kind.

4. **`renderSales` — the live Sales-tab router (js/departments.js:5476-5572, full function read).**
   ```js
   window.renderSales = async function(currentUser, currentRole, subtab = window.initialSubtab('Clients')) {
     window._bkCurrentUser = currentUser;
     window._bkCurrentRole = currentRole;
     const c = deptContainer();
     const salesTabs = ['Clients','Quotes','Partner','Files','SOP','Tasks'];
     // Legacy deep-link keys → new consolidated tab.
     const alias = { 'BK Quotes':'Quotes', 'Quotations':'Quotes', 'Quick Estimate':'Quotes',
                     'Partner Quotes':'Partner', 'Partner Files':'Partner',
                     'Work Plans':'Files', 'Proposals':'Files' };
     subtab = alias[subtab] || (salesTabs.includes(subtab) ? subtab : 'Clients');
     c.innerHTML = `... ${window.chipTabs(salesTabs.map(s=>({key:s,label:s})), subtab)}
       <div id="sales-content">...</div>`;
     loadSalesContent(currentUser, currentRole, subtab);
     window.bindChipTabs(c, (key) => { window.setSubroute(key); loadSalesContent(currentUser, currentRole, key); });
   };
   ```
   `loadSalesContent(currentUser, currentRole, sub)` (departments.js:5521-5572) is a `switch(sub)`
   over exactly those six keys: `'Clients'` → `renderClientProfiles(content, ..., 'barro')`;
   `'Quotes'` → a nested `salesSubNav` between Records/Quick Estimate; `'Partner'` → nested
   Quotes/Files for the Brilliant Steel partner; `'Files'` → nested Work Plans/Proposals;
   `'SOP'` → `renderSalesSOP(content)`; `'Tasks'` → `renderDeptTasks(content,'Sales',...)`.
   **Adding a new top-level Sales tab means adding one string to the `salesTabs` array
   (line 5479) and one `case` to this switch (departments.js:5514-5572) — no router-level or
   nav-level change is needed, since `Sales` is already a single top-level nav entry**
   (`case 'Sales': renderSales(currentUser, currentRole); break;` — js/app.js:3632).

5. **`salesSubNav(content, keys, active, headerHtml, onSelect)` (departments.js:5503-5518)** is
   a second, NESTED chip-tab layer used when one outer Sales tab needs its own sub-views (e.g.
   `'Quotes'` nests Records/Quick Estimate). It scopes its `querySelectorAll('.chip-tab')` binding
   to a `.sales-subnav` element specifically so it never double-binds the outer Sales chip bar or
   a sub-view's own chips. Relevant if Fable decides the AEC Directory should be a *nested* view
   (e.g. under `'Clients'` or a broader relabeled CRM tab) rather than its own top-level entry.

6. **`DEPARTMENTS['Sales'].subtabs` (js/config.js:137-140) is STALE and used ONLY as a cosmetic
   preview, not for routing.** Its value is `['BK Quotes', 'Quotations', 'Clients', 'Work Plans',
   'Proposals', 'SOP']` — the PRE-consolidation subtab names, not the six real ones in
   `renderSales`'s `salesTabs` array above. Grepped every use of `.subtabs` across `js/*.js`:
   the only call site is `renderDepartments()` (js/app.js:6270-6299, the president/manager/
   secretary-only "Departments" admin overview grid), which does
   `const subtabs = (cfg.subtabs || []).slice(0, 4);` purely to print up to 4 preview chips per
   department card. **Confirms: adding an AEC tab does NOT require touching `config.js`'s
   `DEPARTMENTS` object at all** (functionally); updating `DEPARTMENTS['Sales'].subtabs` for
   cosmetic accuracy on that one admin grid is optional and already out of sync with reality for
   the other five real Sales tabs, so there is no established discipline of keeping it current.

7. **Filterable-table + CSV-export precedent.** `window.exportCSV(filename, rows, columns)`
   (js/config.js:451-470, full function read) is the ONE shared, dependency-free CSV builder used
   at 15+ call sites across the app (audit log app.js:1563, Team roster app.js:6832, production
   orders departments.js:12509, purchase requests departments.js:13310-13320, finance ledger
   departments.js:3718, inventory modules.js:1934, leave requests modules.js:2283, stock
   movements modules.js:2085, job costing modules.js:2113, and more). It already handles: a
   UTF-8 BOM prefix (so Excel renders ₱/accents correctly), and a formula-injection guard
   (a text cell starting with `= + - @` gets a leading `'` so it can't execute as an Excel/Sheets
   formula). `window.chipTabs(items, activeKey, opts)` / `window.bindChipTabs(scope, onSelect)`
   (js/config.js, ~478-515) is the shared "declutter" chip-filter-bar helper (per the
   `ui-chip-tabs-and-sop-helpers` memory) — every existing usage is **single-active-key**
   selection (one filter dimension at a time; none of the ~10 call sites grepped implement
   simultaneous multi-facet filtering).

8. **`renderClientProfiles` (js/departments.js:11071-11208, full function + its `CRM_STAGES`
   constant read) is the closest EXISTING Sales-adjacent filterable-table precedent, but it does
   NOT combine all three requested capabilities (filter + CSV + print) — no screen in the app
   does yet.**
   - `CRM_STAGES` (departments.js:11075-11082) is a plain array of
     `{ key, label, color, icon }` objects (`lead` gray/🌱, `prospect` orange/🔥, `won` green/✅,
     `lost` red/✖️) driving both the chip-filter bar (via `window.chipTabs`) and a colored badge
     on each row. **This is the exact reusable shape for the mandate's "A=Architect yellow /
     E=Engineer red / C=Contractor blue" type badge** — a 3-entry array of the same shape would
     drop in with zero new plumbing.
   - `followUpDate` is a plain `YYYY-MM-DD` string field the salesperson types manually
     (`openClientEditor`, departments.js:11147). On render, `dueFollowups` (departments.js:11097)
     counts clients whose `followUpDate <= today` and are still open (`isOpen`, line 11096
     excludes `won`/`lost`), and shows an in-page `⏰ N follow-up(s) due` banner
     (departments.js:11103) — **this fires ONLY while a user is actively viewing the Clients
     screen; it is NOT a push notification, has no dedup logic, and resets fresh on every
     render.** `lastContact` is stamped via `today = window.bizDate()` (departments.js:11092,
     11163) on every save — the Manila-time-correct pattern any new "last contacted" field
     should copy.
   - There is **no CSV export button and no print button anywhere in `renderClientProfiles`**
     today — confirmed by reading the full function body (11084-11208). So while its
     stage-badge/follow-up-date/last-contact patterns are directly reusable, its *screen* is not
     a template for the "filterable + CSV + printable" combination the mandate asks for; the AEC
     Directory would be the first screen in the app to combine all three.

9. **Print-on-letterhead: `window.buildLetterhead` (js/letterhead.js) is ALREADY SHIPPED (WS14,
   per V12-PLAN.md's 2026-07-10 Build Log) — a stable dependency, not a placeholder.**
   Signature: `window.buildLetterhead(opts) -> { headerHTML, footerHTML, printCSS }`, where
   `opts` includes `docTitle`, `docNumber`, `dateLabel`, `extraMeta` (array of extra meta lines),
   `signatures` (array of `{label,name,title}` for a variable 1-4-column signature grid),
   `footerNote`, `entity` (a `window.brandEntity(...)` object for legal-entity identity lines),
   and `accent` (a hex color for the header rule + doctitle + table-header background). It is
   currently consumed at 4 call sites (departments.js:5293 payslip, 7659, 12913, 13656). **The
   closest structural precedent for an "AEC contact sheet" — a MULTI-ROW TABLE print, as opposed
   to a single-entity document like a quote or payslip — is `openInventoryCountForm`
   (departments.js:12905-13013, full function read).** It builds a new-window
   `document.write()` document with: a fixed top control bar (`🖨 Print / Save as PDF` +
   `✕ Close`, hidden via `@media print{ .bar{display:none} }`), `@page{size:A4 landscape;
   margin:8mm}` (landscape — appropriate for a wide, many-column table, which the AEC mandate's
   ~12-column field list would also need), `buildLetterhead`'s `printCSS`/`headerHTML`/
   `footerHTML` wrapping a plain `<table>` of data rows plus blank padding rows for a
   "physical form" feel, and the defensive `_lh ? _lh.headerHTML : <inline fallback>` pattern
   used EVERYWHERE `buildLetterhead` is called (in case it hasn't loaded — e.g. a stale
   service-worker-cached client). This is the file/function to mirror, not reinvent.

10. **Rules precedent for a new Sales-owned collection — TWO different existing patterns
    coexist, and they disagree.** The newer, tightened pattern
    (`work_plans`/`marketing_plans`/`gov_philgeps`/`gov_active_bids`/`gov_archive`,
    firestore.rules ~751-775) is:
    ```
    match /work_plans/{docId} {
      allow read: if isAuth() && !isPartner();
      allow write: if isAuth() && canDept('Sales');
    }
    ```
    where `canDept(d)` (firestore.rules:76) = `isAdmin() || inDept(d)`. The OLDER, looser
    pattern still live on `sales_clients`/`bs_clients`/`design_clients`
    (firestore.rules:1121-1123) is:
    ```
    match /sales_clients/{docId}  { allow read: if isAuth() && !isPartner(); allow create, update: if isAuth(); allow delete: if isAuth() && isAdmin(); }
    match /bs_clients/{docId}     { allow read: if isAuth(); allow create, update: if isAuth(); allow delete: if isAuth() && isAdmin(); }
    ```
    — i.e. `create`/`update` is bare `isAuth()` with **no** department or partner gate at all
    (any authenticated user, including a `bs_clients` write from a partner-portal account, is
    currently allowed). `gov_biddings` (firestore.rules:931-936) is a third, stricter shape still
    (`allow read: if isAuth() && !isPartner(); allow write: if isAuth() && isAdmin();` — admin-only
    write, no dept-membership carve-out at all). The app-level equivalent gate used throughout
    `departments.js` to show/hide edit buttons is `canEditDept(dept)` (departments.js:17-25,
    full function read): grants full edit to `president/owner/manager/secretary`, scopes
    `finance` to the Finance department only, and otherwise checks `currentDepts.includes(dept)`
    — structurally the same tiering as `canDept()` in rules, but a client-only UI gate, not a
    substitute for the rules check.

11. **"Follow-up nudges" — the mandate's phrase maps to TWO structurally different existing
    patterns in this codebase, and NEITHER is a true server-side/always-fires reminder.**
    - **(a) Login-triggered push-notification nudges — 100% client-side, dedup'd, NO cron.**
      Confirmed (independently, matching WS25's identical finding): `functions/index.js` has
      zero `onSchedule`/`pubsub.schedule` exports anywhere; the only cron in this repo is
      GitHub Actions (`monthly-backup.yml`, `sync-to-drive.yml`, `keepalive.yml`), each invoking
      a `scripts/*.js` file against a service account — none of which touch any per-record
      reminder logic today. All existing "nudge" checks instead fire once per login from the
      post-auth boot sequence (js/app.js:77-84, the `auth.onAuthStateChanged` handler):
      ```js
      Notifs.checkDeadlines(user.uid);
      if (userProfile.role !== 'partner') Notifs.checkAttendanceReminder(user.uid, userProfile.displayName);
      Notifs.checkLowStock?.(user.uid, userProfile.role);
      checkPayrollDuties(user);
      checkCAReminder(user);
      ```
      `checkCAReminder` (app.js:324-347) and `checkPayrollDuties` (app.js:278-316) are
      SELF-scoped (a user is reminded about their OWN cash-advance/self-assessment), gated by a
      specific day-of-month (`day !== PAYDAY - 7 → return`), and dedup'd via BOTH a
      `localStorage` flag (`bi-ca-remind-{uid}-{todayStr}`) AND a Firestore-checked
      `dedupKey` passed into `Notifs.send`. `checkDeadlines` (js/notifications.js:545-572) is
      CROSS-RECORD (`tasks.where('assignedTo','array-contains',uid).where('dueDate','==',...)`)
      — the closest analog to "a specific salesperson gets nudged about a specific AEC contact
      record they're responsible for" — with a Firestore-checked `dedupKey` that embeds the date
      (`deadline-tmrw-{task.id}-{tomorrowStr}`) so it's safe across devices/sessions with no
      local state at all. `checkLowStock` (notifications.js:602-624) is a ROLE-SCOPED DAILY
      DIGEST (fires for `president/manager/finance` + anyone in the Purchasing department,
      batches N low-stock items into ONE notification) — the closest analog to "N AEC contacts
      overdue for follow-up" if the nudge is meant to be a company-wide/Sales-team digest rather
      than assigned-to-one-person.
    - **(b) A cheaper, notification-free in-page banner** — `renderClientProfiles`'s
      `dueFollowups` count + `⏰ N follow-ups due` banner (departments.js:11097, 11103, cited in
      item 8 above): no Firestore write, no push, no dedup, visible only while the screen is open.
    - Neither pattern reminds someone who never logs in, or reminds on a fixed calendar cadence
      independent of login. A genuine "regardless of login" reminder would require either a new
      Firebase Scheduled Function (new Cloud Scheduler dependency, Blaze-plan billing
      implication, zero precedent in this repo) or a new GitHub Actions cron + `scripts/*.js`
      runner (matches the `monthly-backup.yml` shape, but is also new for a per-record/user
      reminder use case — the existing crons are all batch/backup jobs, not personalized
      pushes). This exact fork (login-digest vs. new scheduled infra) is the same one WS25 faced
      for leave accrual and resolved by picking the cheaper, no-new-infra option — cited here as
      precedent, not as a decision already made for this workstream.

12. **Backup coverage: `scripts/monthly-backup.js`'s auto-discovery already covers `aec_contacts`
    with zero code changes — confirmed by the file's own header comment.** Lines 108-112:
    ```js
    // ── Per-collection overrides (specials only) ───────────────────────────────
    //  Any root collection NOT listed here is auto-discovered (db.listCollections)
    //  and exported as a COMPLETE full-document JSON snapshot — no hand-registration,
    //  so new collections (pay_runs, it_*, aec_contacts, files_*, budgets_*, …) are
    //  covered automatically and this file never drifts again.
    ```
    The `OVERRIDES` map (lines 118-158) is opt-in ONLY for per-collection CSV-column-shaping
    and date-range filtering (e.g. `salary_history`'s `dateField:'generatedAt'` + a curated
    `csvFields` list) — a collection absent from `OVERRIDES` still gets a full, unfiltered JSON
    export every month via `db.listCollections()` auto-discovery. **So the mandate's "+ backup"
    clause is already satisfied for JSON with zero new script code; a human-readable, curated-
    column CSV export in the monthly Drive backup would need exactly one new `OVERRIDES` entry**
    (a few lines, matching every other collection's shape, e.g.
    `aec_contacts: { csvFields: [...] }`) — an easy, non-zero addition Fable should explicitly
    decide on rather than assume.

13. **No existing "item #" precedent is a persisted, stable field — every table in this app
    that shows a row number recomputes it at render/print time.** `openInventoryCountForm`
    (departments.js:12926, `items.map((i,idx)=>...<td class="c">${idx+1}</td>`) and every other
    numbered list/print in the app (PR list, PO items) use a positional index, NOT a stored
    document field — meaning the number shifts if the list is filtered, sorted, or a row is
    deleted. The codebase DOES have a ready-made atomic-sequence pattern if a STABLE, persisted
    number is wanted instead: `window.nextSerial(counterKey, prefix)` (js/letterhead.js:113-122,
    reuses the `_counters/{key}` transactional-increment shape already used for
    `_counters/employees` and `_counters/workers`), which mints e.g. `INV-2026-000123`. Neither
    pattern is "the" precedent — both exist in the codebase for different reasons (display index
    vs. minted business-document number), and the mandate's "item #" column is ambiguous between
    them.

## Data model

No `aec_contacts` collection, and no equivalent, exists today. The mandate's field list, quoted
verbatim as raw ingredients (types/defaults are NOT decided by this brief):
item # · type (A/E/C) · company · contact person · number (phone) · email · PH region · address ·
contacted status · prospected project? · quotation sent? · feedback/partnership potential.

Adjacent existing shapes worth citing as building blocks (all confirmed by direct file reads
above, not inferred):

- **Type/status badge shape** — `CRM_STAGES` (departments.js:11075-11082):
  `{ key, label, color, icon }[]`, e.g. `{ key:'lead', label:'Lead', color:'#8e8e93', icon:'🌱' }`.
  The mandate's "A=Architect yellow / E=Engineer red / C=Contractor blue" maps onto this shape
  1:1 (3 entries instead of 4, hex colors given directly by the owner).
- **Follow-up date field** — `sales_clients.followUpDate`: a plain `'YYYY-MM-DD'` string,
  manually typed via a `<input type="date">` (departments.js:11147), read back with a simple
  string comparison against `window.bizDate()` (no Timestamp, no timezone math needed since it's
  a date-only field).
- **Last-contact stamp** — `sales_clients.lastContact`: set to `window.bizDate()` on every save
  (departments.js:11163) — NOT a Timestamp; a plain ISO date string, Manila-correct by
  construction since `bizDate()` already resolves in Manila time.
- **Soft-delete-with-approval flag** — `sales_clients.deleteRequested` / `deleteReason` /
  `deleteRequestedBy` / `deleteRequestedAt` (departments.js:11185-11192): non-admin users request
  a delete instead of deleting directly; `canDeleteDirect` (`president/owner/manager`) can hard
  delete, everyone else's delete button sends a request to the president via
  `Notifs.sendToOwner`. Relevant precedent if AEC contacts should follow the same asymmetric
  delete-approval pattern already used for clients right next to it in the same Sales page.
- **Free-text address, no region enum anywhere** — `worker_profiles.address` and
  `sales_clients.address` are both plain `<textarea>` fields with no structured region/province
  breakdown (confirmed by reading `openHRProfileForm` and `openClientEditor` in full). A
  structured "PH region" field would be new ground for this app.
- **Atomic stable-number minting, if wanted** — `window.nextSerial(counterKey, prefix)`
  (js/letterhead.js:113-122) and the near-identical `_counters/workers` transaction
  (`window.nextWorkerIdNumber`, per WS27's already-implemented spec) are the two existing
  `_counters`-based atomic-increment examples a persisted "item #" could reuse verbatim.
- **`kind`/`subjectType`-style discriminator, if this collection ever needs to split** —
  `salary_raises.subjectType` (`'payroll'` vs `'worker_profile'`) and `id_verify.kind`
  (`'employee'` vs `'worker'`, per WS27) are the app's existing pattern for one collection
  serving two different underlying record shapes via a discriminator field — cited only in case
  Fable finds a reason to split AEC contacts by some dimension; nothing in the mandate suggests
  this is needed.

## Constraints — must respect

- **escHtml() discipline** — every mandate field is free-text/user-typed (company, contact
  person, address, email, feedback/partnership-potential notes) and therefore just as injectable
  as any other user-typed field in this app; every table/print builder cited above (
  `renderClientProfiles`, `openInventoryCountForm`, `buildLetterhead`) wraps every interpolated
  field in `escHtml()` before touching `innerHTML` or a `document.write()` string — the new
  screen must do the same, with no exceptions for the shorter fields (phone/type/region) that
  might look "safe."
- **Firestore rules do not cascade or match by prefix** (firestore-rules-collection-coverage
  memory, independently reconfirmed by every collection example cited above being individually,
  explicitly declared) — `aec_contacts` needs its own explicit `match` block or reads/writes
  silently deny (blank screen) unless every call site wraps the read in `.catch()`.
- **Partner exclusion is the unanimous existing pattern for every comparable internal-pipeline
  collection** — `work_plans`, `marketing_plans`, `gov_philgeps`/`gov_active_bids`/`gov_archive`,
  `gov_biddings`, `inventory_items` all gate read with `!isPartner()`. An internal
  architect/engineer/contractor prospecting list is, if anything, a clearer case for partner
  exclusion than any of those (Brilliant Steel's partner portal has no plausible reason to see
  the company's own AEC partnership pipeline) — this is close to unambiguous, not really an open
  question, but the exact WRITE-role tier (canDept('Sales') vs. broader vs. narrower) is still
  Fable's call per Open Decision 2 below.
- **CACHE_VER in sw.js must be bumped on this workstream's edits** (any `.js`/`.css` touch,
  per CLAUDE.md) — the pre-commit hook only auto-bumps `window.APP_VERSION`/`index.html` version
  strings, not `CACHE_VER`, which stays a manual step.
- **Script load order is fixed** (index.html: firebase-config.js → config.js → drive.js →
  notifications.js → departments.js → app.js → modules.js, all deferred). If a new shared
  constant (a PH-regions list, an AEC type-color array) needs to be read by more than just
  `departments.js`, it belongs in `config.js` (loads first); `CRM_STAGES` itself is the
  counter-example — it lives locally inside `departments.js` (not exported earlier) because
  nothing outside that file currently needs it. The same choice applies here: if nothing outside
  Sales needs the AEC type list, it can live next to the new render function exactly like
  `CRM_STAGES` does.
- **Reuse `window.exportCSV`, do not hand-roll a CSV serializer** — it already has the
  formula-injection guard and the peso-safe UTF-8 BOM; every other CSV button in the app goes
  through it.
- **Reuse `window.buildLetterhead`, do not hand-roll header/footer markup** — it is a stable,
  already-shipped dependency (WS14 is DONE, not a placeholder to build a fallback against, unlike
  what WS24/31 had to do while WS14 was still undecided).
- **Manila-time discipline** — any date field (a follow-up date, a "last contacted" stamp) must
  come from `window.bizDate()`, never raw `new Date().toISOString()`, per the
  `manila_time_helpers` memory and matching `sales_clients.lastContact`'s existing pattern
  exactly.
- **Deploy discipline** — `git push origin master` does NOT deploy `firestore.rules`; a rules
  change needs `~/.npm-global/bin/firebase deploy --only firestore:rules` run separately. Per the
  `deploy-recheck-full-file-diff` memory, re-`git diff firestore.rules` immediately before that
  deploy, since concurrent sessions (including other Phase-4 grounding work happening the same
  day) may be mid-edit on the same file.
- **No PDF library and no bundler exist in this codebase** — every print surface (payslips, POs,
  ID cards, the inventory count form) uses the same `window.open('','_blank')` +
  `document.write()` + `window.print()` convention with inlined CSS; a new dependency here would
  be inconsistent with the rest of the app and is very unlikely to be the right call.

## DECIDED — architecture spec (Fable, 2026-07-10)

### Resolved decisions (one line each)

1. **Nav placement → new TOP-LEVEL `'AEC'` entry in `salesTabs` (7th chip, placed right after
   `'Clients'`), NOT nested under Clients.** The owner said "table in Sales" (a peer surface, not
   a Clients sub-view); AEC contacts are partners to sell THROUGH, `sales_clients` are customers
   to sell TO — conflating them inside the Clients screen would also entangle this greenfield
   build with the screen WS32 plans to rework. `DEPARTMENTS['Sales'].subtabs` (config.js:137-140)
   stays UNTOUCHED — it is cosmetic-only, already stale for the other five real tabs, and there
   is no discipline of maintaining it (brief item 6).
2. **Write gate → the tightened `canDept('Sales')` pattern (`work_plans` shape), deliberately
   NOT the legacy bare-`isAuth()` of `sales_clients` next door.** `create, update: canDept('Sales')`,
   `delete: isAdmin()`. This is intentionally stricter than the adjacent Clients collections —
   that looseness is a pre-existing inconsistency (see Risks), not the template; new collections
   follow the newer pattern. No soft-delete/delete-request flow: a prospecting directory is
   low-stakes, non-admins simply get no delete button (client-gated to `president/owner/manager`,
   mirroring `canDeleteDirect` at departments.js:11089).
3. **Read scope → all internal staff, partner excluded: `isAuth() && !isPartner()`.** Matches the
   unanimous internal-pipeline pattern (`work_plans`/`gov_biddings`/`marketing_plans`); the
   president/managers outside Sales should see the pipeline, and the constraint section already
   called partner exclusion near-unambiguous. Client-side, edit controls are gated by
   `canEditDept('Sales')` (departments.js:17-25), mirroring the rules tier.
4. **Nudge mechanism → BOTH cheap options, NO cron: (a) a login-triggered daily digest
   `checkAECFollowups` mirroring `checkLowStock` (notifications.js:602-624) for Sales-dept
   members + president/manager, PLUS (b) the free in-page `⏰ N due` banner mirroring
   `renderClientProfiles`'s `dueFollowups`.** (b) costs ~3 lines since the render already computes
   overdue rows; (a) reaches people who don't open the screen. A true scheduled reminder (option
   c) is explicitly OUT OF SCOPE — zero `onSchedule` precedent in this repo, same no-new-infra
   resolution WS25 reached; revisit only if Neil asks for reminders independent of login.
5. **Nudge driver → a manually-set `followUpDate` (`YYYY-MM-DD` string), mirroring
   `sales_clients.followUpDate` exactly, with `lastContact` auto-stamped `window.bizDate()` on
   every save (departments.js:11163 pattern).** An auto "N days since last contact" threshold
   invents a policy number the owner never gave and diverges from the sibling CRM's model.
   Overdue = `followUpDate <= bizDate()` AND stage not terminal (`partner`/`dormant`).
6. **Status modeling → HYBRID: one single-select `stage` enum (CRM_STAGES-shaped, 5 stages:
   `new`/`contacted`/`prospect`/`partner`/`dormant`) + a dedicated `quoteSent` boolean (+
   `quoteSentDate`, `quoteRef`).** The mandate's "contacted status" and "prospected project?"
   are DERIVED from the stage ladder (`contacted` = stage ≠ new; `prospected` = stage ∈
   {prospect, partner}) so the single-active-key `chipTabs` filter is reused wholesale;
   "quotation sent?" — the mandate's headline tracker — stays its own explicit boolean so it can
   never drift with stage edits. Derivations are spelled out in Spec 5's CSV columns.
7. **Item # → PERSISTED, `_counters`-minted plain integer (`itemNo`), via a new
   `nextAECNumber()` transaction on `_counters/aec_contacts`.** The whole point of a directory
   number is citability ("AEC #14") independent of filter/sort — a positional `idx+1` shifts
   under both. Plain integer, NOT a `nextSerial`-style `INV-2026-000123` string: this is a row
   number, not a business-document serial. **Rules consequence (verified live):** `_counters`
   write is currently `isFinanceOrAdmin()` (firestore.rules:154-157) — a non-admin Sales member
   could create the contact but be DENIED the mint. Spec 2 adds a docId-scoped carve-out to that
   block. Deletion gaps in the sequence are expected and fine.
8. **PH region → structured STRICT `<select>` over a new `window.AEC_REGIONS` constant (the 18
   official administrative regions incl. NIR, stored as the full display string), living in
   `departments.js` next to the other AEC constants — NOT config.js.** "Filterable by region"
   demands an enum (free text can't filter reliably); it lives beside the render function per the
   `CRM_STAGES` precedent since nothing outside Sales consumes it (the digest needs only the
   terminal-stage list, exposed as `window.AEC_TERMINAL` with a defensive fallback). `address`
   stays free-text (street/city), separate from `region`.
9. **CSV/backup → BOTH: the on-screen `window.exportCSV` button (exports the currently-filtered
   rows) AND one curated `csvFields` `OVERRIDES` entry in `scripts/monthly-backup.js`** (full
   snapshot, no `dateField` — a directory is not a dated journal; JSON auto-discovery already
   covers it, the CSV adds the human-readable monthly sheet matching `users`/`tasks` precedent).
   All fields including `potential` go in the backup CSV — it lands in the company's own Drive.
10. **Print → one landscape-A4 letterhead multi-row table via new `openAECPrintSheet()`,
    mirroring `openInventoryCountForm` (departments.js:12906), printing the CURRENTLY-FILTERED
    rows with a CURATED column set that DELIBERATELY OMITS the free-text "feedback/partnership
    potential" notes** (a physical sheet may leave the building; long free text also wrecks an
    11-column landscape table — notes remain in the on-screen detail view, CSV, and backup).
    One deliberate deviation from the inventory-form template: the local `@page{size:A4
    landscape}` rule is placed AFTER `_lh.printCSS` (the inventory form places it before, where
    the letterhead's portrait `@page` can win the cascade) — Spec 6 notes this inline.
11. **Filter composition → TWO stacked single-select chip bars (type A/E/C, stage) + a region
    `<select>` + a free-text search input, AND-combined client-side.** Yes, stacked independent
    chip bars are a new composition for this app, but each bar is a stock
    `chipTabs`/`bindChipTabs` single-select bound to its own scoped wrapper (`.aec-type-tabs`,
    `.aec-stage-tabs` — same scoping trick `salesSubNav` uses); the composition is just two state
    variables ANDed in one `shownRows()` predicate, written in full in Spec 5. `quoteSent` is a
    visible column, not a filter chip (keeps the filter surface small; stage `prospect→partner`
    plus the Quote column covers the triage need).
12. **"Quotation sent?" → MANUAL checkbox + optional free-text `quoteRef`, NO live
    cross-reference into `bk_quotes`/`bs_quotes`.** WS31 is mid-rewrite on the quote data model
    ("delete ~1,800 lines of dead builder code") — building a live join against it now risks
    immediate rework. The schema keeps `company` and `quoteRef` as natural join keys so WS31/WS32
    can later auto-derive this flag without a data migration (see Spec 11 call-outs).

**Scoping / sequencing:** wholly greenfield; depends on NOTHING undecided (WS14 letterhead is
shipped). Deliberately decoupled from WS31 (no quote-doc reference) and WS32 (field names
`stage`/`followUpDate`/`lastContact` intentionally identical to `sales_clients` so a future
generalized CRM engine can absorb both collections uniformly).

---

### Spec 1 — `aec_contacts/{autoId}` data shape (annotated literal)

```js
// aec_contacts/{autoId}  — NEW top-level collection. All strings default ''.
{
  itemNo: 14,                    // number — stable directory #, minted once via _counters/aec_contacts (Spec 3)
  type: 'architect',             // 'architect' | 'engineer' | 'contractor'  (AEC_TYPES keys)
  company: 'Arkitektura Mla.',   // required (the only required field)
  contactPerson: '',
  phone: '',
  email: '',
  region: 'NCR — National Capital Region',  // '' or one of AEC_REGIONS (full display string stored verbatim)
  address: '',                   // free text (street/city) — region is the structured part
  stage: 'new',                  // 'new'|'contacted'|'prospect'|'partner'|'dormant' (AEC_STAGES keys; default 'new')
                                 //   derived: contacted? = stage!=='new'; prospected? = stage∈{prospect,partner}
  quoteSent: false,              // boolean — the mandate's explicit "quotation sent?" tracker (manual)
  quoteSentDate: '',             // '' | 'YYYY-MM-DD' (auto-defaults to bizDate() when box first ticked)
  quoteRef: '',                  // free text, e.g. a BK-quote number — future WS31/WS32 join key, NOT a doc ref
  potential: '',                 // free text — "feedback / partnership potential" notes
  followUpDate: '',              // '' | 'YYYY-MM-DD' — drives banner + login digest (Decision 5)
  lastContact: '2026-07-10',     // 'YYYY-MM-DD', bizDate()-stamped on EVERY save (mirrors sales_clients)
  addedBy: '<uid>',              // create only
  createdAt,                     // serverTimestamp, create only
  updatedAt                      // serverTimestamp, every save
}
```

No composite index needed: the only query is `orderBy('itemNo','asc')` (single-field,
auto-indexed) — `firestore.indexes.json` is untouched.

### Spec 2 — firestore.rules diffs (block-scoped, before→after)

**2a — NEW `aec_contacts` block.** Insert directly after the `gov_archive` block
(firestore.rules:776), inside the same "Per-department document collections" region:

```
    // ── AEC Partner Directory (Sales prospecting: architects/engineers/contractors,
    // v12 WS33). Internal pipeline — partner excluded, matching work_plans. Writes
    // follow the TIGHTENED canDept pattern — deliberately stricter than the legacy
    // bare-isAuth() sales_clients block (~1121); that looseness is pre-existing,
    // not the template. Delete admin-only (no delete-request flow: low-stakes list).
    match /aec_contacts/{docId} {
      allow read: if isAuth() && !isPartner();
      allow create, update: if isAuth() && canDept('Sales');
      allow delete: if isAuth() && isAdmin();
    }
```

**2b — `_counters` block (firestore.rules:154-157): docId-scoped carve-out so non-admin Sales
members can mint `itemNo`.** Without this, `nextAECNumber()` is DENIED for exactly the people the
write rule invites in (verified: current write is `isFinanceOrAdmin()` only).

```
// BEFORE
    match /_counters/{docId} {
      allow read:  if isAuth();
      allow write: if isAuth() && isFinanceOrAdmin();
    }
// AFTER
    // aec_contacts carve-out (WS33): Sales members mint directory numbers. Safe —
    // docs here are opaque monotonic integers; worst case is an advanced sequence.
    match /_counters/{docId} {
      allow read:  if isAuth();
      allow write: if isAuth() && (isFinanceOrAdmin()
        || (docId == 'aec_contacts' && canDept('Sales')));
    }
```

Deploy with `~/.npm-global/bin/firebase deploy --only firestore:rules`, SEPARATE from `git push`.
Re-`git diff firestore.rules` immediately before deploying (concurrent Phase-4 sessions edit this
file — `deploy-recheck-full-file-diff` memory); apply as block-scoped Edits, never full-file.

### Spec 3 — Constants + helpers (js/departments.js — insert as a new delimited section
immediately BEFORE the `//  SHARED: Client Profiles` header at departments.js:11071)

```js
// ══════════════════════════════════════════════════
//  SALES — AEC PARTNER DIRECTORY (v12 WS33)
// ══════════════════════════════════════════════════
// Architects/Engineers/Contractors prospecting directory (owner spec 2026-07-09).
// Type colors are the OWNER'S mandate (A=yellow / E=red / C=blue). They are
// CATEGORY colors, not status colors — rendered as small circular letter chips
// so a red "E" reads as a class marker, unlike the word-badges used for stage.
window.AEC_TYPES = [
  { key:'architect',  label:'Architect',  letter:'A', color:'#FFC300' },
  { key:'engineer',   label:'Engineer',   letter:'E', color:'#e5484d' },
  { key:'contractor', label:'Contractor', letter:'C', color:'#0A84FF' },
];
// Pipeline stage ladder — single-select filter, same {key,label,color,icon} shape
// as CRM_STAGES (departments.js:11075). 'partner'/'dormant' are terminal.
window.AEC_STAGES = [
  { key:'new',       label:'Not Contacted', color:'#8e8e93',                icon:'○'  },
  { key:'contacted', label:'Contacted',     color:'#5856D6',                icon:'📞' },
  { key:'prospect',  label:'Prospect',      color:'#FFAA00',                icon:'🔥' },
  { key:'partner',   label:'Partner',       color:'var(--success,#30D158)', icon:'🤝' },
  { key:'dormant',   label:'Dormant',       color:'#636366',                icon:'💤' },
];
// Terminal stages — excluded from follow-up nudges. Read defensively by
// checkAECFollowups (notifications.js) at call-time, so load order is safe.
window.AEC_TERMINAL = ['partner','dormant'];
// The 18 official PH administrative regions (incl. NIR, re-established 2024).
// Stored VERBATIM as the region value (no key→label mapping; filter by equality).
window.AEC_REGIONS = [
  'NCR — National Capital Region',
  'CAR — Cordillera',
  'Region I — Ilocos',
  'Region II — Cagayan Valley',
  'Region III — Central Luzon',
  'Region IV-A — CALABARZON',
  'MIMAROPA — Southwestern Tagalog',
  'Region V — Bicol',
  'Region VI — Western Visayas',
  'NIR — Negros Island',
  'Region VII — Central Visayas',
  'Region VIII — Eastern Visayas',
  'Region IX — Zamboanga Peninsula',
  'Region X — Northern Mindanao',
  'Region XI — Davao',
  'Region XII — SOCCSKSARGEN',
  'Region XIII — Caraga',
  'BARMM — Bangsamoro',
];
function aecTypeMeta(k){ return window.AEC_TYPES.find(t => t.key === k) || window.AEC_TYPES[0]; }
function aecStageOf(c){ return window.AEC_STAGES.some(s => s.key === (c && c.stage)) ? c.stage : 'new'; }
function aecStageMeta(k){ return window.AEC_STAGES.find(s => s.key === k) || window.AEC_STAGES[0]; }
// The owner's two derived tracker columns (Decision 6):
function aecContacted(c){ return aecStageOf(c) !== 'new'; }
function aecProspected(c){ return ['prospect','partner'].includes(aecStageOf(c)); }

// Atomic directory number via _counters/aec_contacts — mirrors nextSerial's
// transaction (letterhead.js:113-122) but returns the PLAIN integer (a citable
// row number, not a year-prefixed document serial). Gaps after deletes are fine.
// Requires the _counters docId carve-out in firestore.rules (Spec 2b).
async function nextAECNumber(){
  const ref = db.collection('_counters').doc('aec_contacts');
  return db.runTransaction(async t => {
    const cur  = await t.get(ref);
    const next = (cur.exists ? (cur.data().count || 0) : 0) + 1;
    t.set(ref, { count: next }, { merge:true });
    return next;
  });
}
```

### Spec 4 — Nav wiring (js/departments.js, before→after)

**4a — `salesTabs` (departments.js:5480):**
```js
// BEFORE
  const salesTabs = ['Clients','Quotes','Partner','Files','SOP','Tasks'];
// AFTER
  const salesTabs = ['Clients','AEC','Quotes','Partner','Files','SOP','Tasks'];
```
(Also update the stale count in the section comment at departments.js:5472:
`10 tabs → 6` becomes `10 tabs → 6 (+ AEC, WS33)`. The `alias` map needs no entry — 'AEC' has no
legacy deep-link name. Deep links `#/Sales/AEC` work automatically via the existing
`initialSubtab`/`setSubroute` plumbing once the string is in `salesTabs`.)

**4b — `loadSalesContent` switch (departments.js:5524-5527): add one case after `'Clients'`:**
```js
    case 'Clients':
      await renderClientProfiles(content, currentUser, currentRole, 'barro');
      break;

    case 'AEC':
      await renderAECDirectory(content, currentUser, currentRole);
      break;
```

### Spec 5 — `renderAECDirectory(container, currentUser, currentRole)` — FULL function
(js/departments.js, in the new WS33 section from Spec 3, after `nextAECNumber`)

```js
async function renderAECDirectory(container, currentUser, currentRole) {
  const snap = await db.collection('aec_contacts').orderBy('itemNo','asc').get().catch(()=>({docs:[]}));
  const contacts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const canEdit = canEditDept('Sales');
  const canDeleteDirect = ['president','owner','manager'].includes(currentRole);
  const today = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10));

  const isOverdue = c => c.followUpDate && c.followUpDate <= today && !window.AEC_TERMINAL.includes(aecStageOf(c));
  const dueCount = contacts.filter(isOverdue).length;

  const typeCounts = { all: contacts.length };
  window.AEC_TYPES.forEach(t => typeCounts[t.key] = contacts.filter(c => c.type === t.key).length);
  const stageCounts = {};
  window.AEC_STAGES.forEach(s => stageCounts[s.key] = contacts.filter(c => aecStageOf(c) === s.key).length);

  let typeFilter = 'all', stageFilter = 'all', regionFilter = 'all', search = '';

  container.innerHTML = `
    <style>
      #aec-tbl th,#aec-tbl td{border-bottom:1px solid var(--border);padding:7px 8px;text-align:left;vertical-align:top;font-size:12px}
      #aec-tbl th{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted)}
      #aec-tbl td.c,#aec-tbl th.c{text-align:center}
      #aec-tbl tbody tr{cursor:pointer}
    </style>
    ${dueCount ? `<div class="alert-banner alert-warn" style="margin-bottom:10px"><span>⏰ <strong>${dueCount}</strong> AEC follow-up${dueCount>1?'s':''} due</span></div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      ${window.chipTabs([{key:'all',label:'All',count:typeCounts.all}, ...window.AEC_TYPES.map(t=>({key:t.key,label:t.label,count:typeCounts[t.key]}))], 'all', {cls:'aec-type-tabs'})}
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${canEdit ? `<button class="btn-primary btn-sm" id="aec-add-btn">+ Add Contact</button>` : ''}
        <button class="btn-secondary btn-sm" id="aec-csv-btn">⬇ CSV</button>
        <button class="btn-secondary btn-sm" id="aec-print-btn">🖨 Print</button>
      </div>
    </div>
    ${window.chipTabs([{key:'all',label:'All Stages'}, ...window.AEC_STAGES.map(s=>({key:s.key,label:s.label,icon:s.icon,count:stageCounts[s.key]}))], 'all', {cls:'aec-stage-tabs'})}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 10px">
      <select id="aec-region-filter" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:12px">
        <option value="all">All regions</option>
        ${window.AEC_REGIONS.map(r=>`<option value="${escHtml(r)}">${escHtml(r)}</option>`).join('')}
      </select>
      <input id="aec-search" placeholder="🔍 Search company / person / email…" style="flex:1;min-width:180px;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:12px"/>
    </div>
    <div id="aec-table"></div>
  `;

  // AND-composed filter predicate — the one place all four dimensions combine.
  const shownRows = () => contacts.filter(c =>
    (typeFilter   === 'all' || c.type === typeFilter) &&
    (stageFilter  === 'all' || aecStageOf(c) === stageFilter) &&
    (regionFilter === 'all' || (c.region || '') === regionFilter) &&
    (!search || [c.company, c.contactPerson, c.email, c.phone, c.address]
      .join(' ').toLowerCase().includes(search))
  );

  const typeChip = c => { const t = aecTypeMeta(c.type);
    return `<span title="${escHtml(t.label)}" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:${t.color};color:#fff;font-size:10px;font-weight:800">${t.letter}</span>`; };

  const rowHtml = c => { const st = aecStageMeta(aecStageOf(c)); const od = isOverdue(c);
    return `<tr data-id="${c.id}">
      <td class="c">${c.itemNo || ''}</td>
      <td class="c">${typeChip(c)}</td>
      <td><strong>${escHtml(c.company || '')}</strong>${c.address ? `<div style="font-size:10px;color:var(--text-muted)">${escHtml(c.address)}</div>` : ''}</td>
      <td>${escHtml(c.contactPerson || '')}</td>
      <td style="font-size:11px">${c.phone ? `📞 ${escHtml(c.phone)}<br>` : ''}${c.email ? `✉️ ${escHtml(c.email)}` : ''}</td>
      <td style="font-size:11px">${escHtml((c.region || '').split(' — ')[0])}</td>
      <td><span class="badge" style="font-size:9px;background:${st.color};color:#fff">${st.icon} ${st.label}</span></td>
      <td class="c">${c.quoteSent ? `✅${c.quoteSentDate ? `<div style="font-size:9px;color:var(--text-muted)">${escHtml(c.quoteSentDate)}</div>` : ''}` : '—'}</td>
      <td style="font-size:11px;color:${od ? 'var(--danger)' : 'var(--text-muted)'}">${c.followUpDate ? `⏰ ${escHtml(c.followUpDate)}${od ? ' · due' : ''}` : ''}</td>
      <td class="c" style="white-space:nowrap">
        ${canEdit ? `<button class="btn-secondary btn-sm aec-edit-btn" data-id="${c.id}" title="Edit">✎</button>` : ''}
        ${canDeleteDirect ? `<button class="btn-secondary btn-sm aec-del-btn" data-id="${c.id}" data-company="${escHtml(c.company || '')}" style="color:var(--danger)">${emojiIcon('trash-2',13)}</button>` : ''}
      </td></tr>`; };

  const openAECDetail = (c) => {
    const t = aecTypeMeta(c.type), st = aecStageMeta(aecStageOf(c));
    openModal(`${t.letter} · ${escHtml(c.company || 'AEC Contact')}`, `
      <div style="display:flex;flex-direction:column;gap:6px;font-size:13px">
        <div>#${c.itemNo || ''} · <span class="badge" style="background:${t.color};color:#fff;font-size:9px">${escHtml(t.label)}</span> <span class="badge" style="background:${st.color};color:#fff;font-size:9px">${st.icon} ${st.label}</span></div>
        ${c.contactPerson ? `<div>👤 ${escHtml(c.contactPerson)}</div>` : ''}
        ${c.phone ? `<div>📞 ${escHtml(c.phone)}</div>` : ''}
        ${c.email ? `<div>✉️ ${escHtml(c.email)}</div>` : ''}
        ${c.region ? `<div>📍 ${escHtml(c.region)}</div>` : ''}
        ${c.address ? `<div>🏠 ${escHtml(c.address)}</div>` : ''}
        <div>📄 Quotation: ${c.quoteSent ? `sent${c.quoteSentDate ? ' ' + escHtml(c.quoteSentDate) : ''}${c.quoteRef ? ' · ' + escHtml(c.quoteRef) : ''}` : 'not sent'}</div>
        ${c.followUpDate ? `<div>⏰ Follow-up: ${escHtml(c.followUpDate)}</div>` : ''}
        ${c.lastContact ? `<div>🕓 Last contact: ${escHtml(c.lastContact)}</div>` : ''}
        ${c.potential ? `<div style="margin-top:4px;padding:8px;background:rgba(128,128,128,.08);border-radius:8px">💬 ${escHtml(c.potential)}</div>` : ''}
      </div>
    `, `${canEdit ? `<button class="btn-primary" id="aec-detail-edit">✎ Edit</button>` : ''}<button class="btn-secondary" onclick="closeModal()">Close</button>`);
    document.getElementById('aec-detail-edit')?.addEventListener('click', () => { closeModal(); openAECEditor(c); });
  };

  const openAECEditor = (c) => {
    const e = c || {};
    const sel = 'style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)"';
    openPage(c ? 'Edit AEC Contact' : 'Add AEC Contact', `
      <div class="form-row">
        <div class="form-group"><label>Type</label><select id="aec-type" ${sel}>${window.AEC_TYPES.map(t=>`<option value="${t.key}" ${e.type===t.key?'selected':''}>${t.letter} — ${t.label}</option>`).join('')}</select></div>
        <div class="form-group"><label>Stage</label><select id="aec-stage" ${sel}>${window.AEC_STAGES.map(s=>`<option value="${s.key}" ${aecStageOf(e)===s.key?'selected':''}>${s.icon} ${s.label}</option>`).join('')}</select></div>
      </div>
      <div class="form-group"><label>Company</label><input id="aec-company" value="${escHtml(e.company||'')}" placeholder="Firm / company name"/></div>
      <div class="form-group"><label>Contact person</label><input id="aec-person" value="${escHtml(e.contactPerson||'')}"/></div>
      <div class="form-row">
        <div class="form-group"><label>Phone</label><input id="aec-phone" type="tel" value="${escHtml(e.phone||'')}"/></div>
        <div class="form-group"><label>Email</label><input id="aec-email" type="email" value="${escHtml(e.email||'')}"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>PH Region</label><select id="aec-region" ${sel}>
          <option value="">— Region —</option>
          ${window.AEC_REGIONS.map(r=>`<option value="${escHtml(r)}" ${e.region===r?'selected':''}>${escHtml(r)}</option>`).join('')}
        </select></div>
        <div class="form-group"><label>Follow-up date</label><input id="aec-followup" type="date" value="${escHtml(e.followUpDate||'')}"/></div>
      </div>
      <div class="form-group"><label>Address</label><textarea id="aec-address" rows="2">${escHtml(e.address||'')}</textarea></div>
      <div class="form-group" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;margin:0"><input type="checkbox" id="aec-quotesent" ${e.quoteSent?'checked':''}/> Quotation sent</label>
        <input id="aec-quotedate" type="date" value="${escHtml(e.quoteSentDate||'')}" style="max-width:150px"/>
        <input id="aec-quoteref" placeholder="Quote # (optional)" value="${escHtml(e.quoteRef||'')}" style="max-width:160px"/>
      </div>
      <div class="form-group"><label>Feedback / partnership potential</label><textarea id="aec-potential" rows="3">${escHtml(e.potential||'')}</textarea></div>
    `, `<button class="btn-primary" id="aec-save-btn">${c ? 'Save' : 'Save Contact'}</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('aec-save-btn').addEventListener('click', async () => {
      const company = document.getElementById('aec-company').value.trim();
      if (!company) { Notifs.showToast('Company is required.','error'); return; }
      const quoteSent = document.getElementById('aec-quotesent').checked;
      const data = {
        type: document.getElementById('aec-type').value,
        stage: document.getElementById('aec-stage').value,
        company,
        contactPerson: document.getElementById('aec-person').value.trim(),
        phone: document.getElementById('aec-phone').value.trim(),
        email: document.getElementById('aec-email').value.trim(),
        region: document.getElementById('aec-region').value,
        address: document.getElementById('aec-address').value.trim(),
        quoteSent,
        quoteSentDate: quoteSent ? (document.getElementById('aec-quotedate').value || today) : '',
        quoteRef: document.getElementById('aec-quoteref').value.trim(),
        potential: document.getElementById('aec-potential').value.trim(),
        followUpDate: document.getElementById('aec-followup').value || '',
        lastContact: today,   // Manila-correct stamp — mirrors sales_clients (departments.js:11163)
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };
      try {
        if (c) {
          await db.collection('aec_contacts').doc(c.id).update(data);
          window.logAudit && window.logAudit('update','aec_contact',c.id,{company,stage:data.stage});
        } else {
          data.itemNo   = await nextAECNumber();   // mint BEFORE create; a failed create just leaves a gap
          data.addedBy  = currentUser.uid;
          data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
          await db.collection('aec_contacts').add(data);
          window.logAudit && window.logAudit('create','aec_contact',String(data.itemNo),{company});
        }
        closeModal(); Notifs.showToast('AEC contact saved');
        renderAECDirectory(container, currentUser, currentRole);
      } catch(ex){ Notifs.showToast('Save failed: ' + (ex.message||ex.code),'error'); }
    });
  };

  const bindRows = () => {
    const el = document.getElementById('aec-table'); if (!el) return;
    el.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const c = contacts.find(x => x.id === tr.dataset.id); if (c) openAECDetail(c);
    }));
    el.querySelectorAll('.aec-edit-btn').forEach(b => b.addEventListener('click', () => openAECEditor(contacts.find(x => x.id === b.dataset.id))));
    el.querySelectorAll('.aec-del-btn').forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmDialog({message:`Delete AEC contact "${escHtml(b.dataset.company)}"? This cannot be undone.`, danger:true, html:true}))) return;
      try {
        await db.collection('aec_contacts').doc(b.dataset.id).delete();
        window.logAudit && window.logAudit('delete','aec_contact',b.dataset.id,{company:b.dataset.company});
        Notifs.showToast('AEC contact deleted');
        renderAECDirectory(container, currentUser, currentRole);
      } catch(ex){ Notifs.showToast('Delete failed','error'); }
    }));
  };

  const renderTable = () => {
    const rows = shownRows();
    const el = document.getElementById('aec-table'); if (!el) return;
    el.innerHTML = !rows.length
      ? `<div class="empty-state"><div class="empty-icon">📇</div><h4>No AEC contacts${contacts.length ? ' match the filters' : ' yet'}</h4>${canEdit && !contacts.length ? '<p style="font-size:12px;color:var(--text-muted)">Add architects, engineers and contractors to start the partnership pipeline.</p>' : ''}</div>`
      : `<div style="overflow-x:auto"><table id="aec-tbl" style="width:100%;min-width:860px;border-collapse:collapse">
          <thead><tr>
            <th class="c" style="width:36px">#</th><th class="c" style="width:40px">Type</th><th>Company</th><th>Contact Person</th>
            <th>Contact Info</th><th style="width:80px">Region</th><th style="width:120px">Stage</th>
            <th class="c" style="width:70px">Quote</th><th style="width:110px">Follow-up</th><th style="width:80px"></th>
          </tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table></div>`;
    bindRows();
  };

  // The owner's full column list — used by BOTH the on-screen CSV button and as
  // the reference for the monthly-backup csvFields (Spec 8). Derived columns
  // (Contacted?/Prospected?) come from the stage ladder per Decision 6.
  const AEC_CSV_COLUMNS = [
    { key:'itemNo',        label:'Item #' },
    { key:'type',          label:'Type',                 get:r => aecTypeMeta(r.type).label },
    { key:'company',       label:'Company' },
    { key:'contactPerson', label:'Contact Person' },
    { key:'phone',         label:'Phone' },
    { key:'email',         label:'Email' },
    { key:'region',        label:'PH Region' },
    { key:'address',       label:'Address' },
    { key:'stage',         label:'Stage',                get:r => aecStageMeta(aecStageOf(r)).label },
    { key:'contacted',     label:'Contacted?',           get:r => aecContacted(r) ? 'Yes' : 'No' },
    { key:'prospected',    label:'Prospected Project?',  get:r => aecProspected(r) ? 'Yes' : 'No' },
    { key:'quoteSent',     label:'Quotation Sent?',      get:r => r.quoteSent ? 'Yes' : 'No' },
    { key:'quoteSentDate', label:'Quote Sent Date' },
    { key:'quoteRef',      label:'Quote Ref' },
    { key:'potential',     label:'Feedback / Partnership Potential' },
    { key:'followUpDate',  label:'Follow-up Date' },
    { key:'lastContact',   label:'Last Contact' },
  ];

  const filterLabel = () => {
    const bits = [];
    if (typeFilter   !== 'all') bits.push(aecTypeMeta(typeFilter).label + 's');
    if (stageFilter  !== 'all') bits.push('stage: ' + aecStageMeta(stageFilter).label);
    if (regionFilter !== 'all') bits.push(regionFilter.split(' — ')[0]);
    if (search) bits.push(`search: "${search}"`);
    return bits.length ? bits.join(' · ') : 'All contacts';
  };

  window.bindChipTabs(container.querySelector('.aec-type-tabs'),  (key) => { typeFilter  = key; renderTable(); });
  window.bindChipTabs(container.querySelector('.aec-stage-tabs'), (key) => { stageFilter = key; renderTable(); });
  document.getElementById('aec-region-filter')?.addEventListener('change', (e) => { regionFilter = e.target.value; renderTable(); });
  document.getElementById('aec-search')?.addEventListener('input', (e) => { search = e.target.value.trim().toLowerCase(); renderTable(); });
  document.getElementById('aec-add-btn')?.addEventListener('click', () => openAECEditor(null));
  document.getElementById('aec-csv-btn')?.addEventListener('click', () => window.exportCSV('aec-contacts', shownRows(), AEC_CSV_COLUMNS));
  document.getElementById('aec-print-btn')?.addEventListener('click', () => openAECPrintSheet(shownRows(), filterLabel()));
  renderTable();
}
```

### Spec 6 — `openAECPrintSheet(rows, scopeLabel)` — FULL function
(js/departments.js, immediately after `renderAECDirectory`)

```js
// Printable AEC contact sheet — landscape-A4 letterhead multi-row table,
// mirroring openInventoryCountForm (departments.js:12906) incl. the defensive
// `_lh ? … : fallback` pattern. Prints the CURRENTLY-FILTERED rows. The
// free-text "potential" notes are DELIBERATELY omitted (Decision 10). NOTE one
// deliberate deviation from the inventory form: the local @page{A4 landscape}
// rule is placed AFTER _lh.printCSS so it wins the cascade over the
// letterhead's default portrait @page.
function openAECPrintSheet(rows, scopeLabel){
  const e = s => escHtml(s);
  const todayStr = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10));
  const _lh = window.buildLetterhead ? window.buildLetterhead({
    docTitle: 'AEC PARTNER CONTACT SHEET',
    dateLabel: 'As of ' + todayStr,
    extraMeta: [scopeLabel || 'All contacts', rows.length + ' contact' + (rows.length === 1 ? '' : 's')],
    signatures: [{ label:'Prepared by', name:(window.userProfile && userProfile.displayName) || '', title:'Sales' }],
    footerNote: ((window.BRAND && window.BRAND.fullName) || 'Barro Industries Operating System') + ' · Generated ' + new Date().toLocaleString('en-PH') + ' · Internal prospecting directory — handle contact details accordingly.'
  }) : null;
  const body = rows.map(c => { const t = aecTypeMeta(c.type), st = aecStageMeta(aecStageOf(c));
    return `<tr>
      <td class="c">${c.itemNo || ''}</td>
      <td class="c"><span class="tchip" style="background:${t.color}">${t.letter}</span></td>
      <td class="b">${e(c.company || '')}</td>
      <td>${e(c.contactPerson || '')}</td>
      <td>${e(c.phone || '')}</td>
      <td>${e(c.email || '')}</td>
      <td>${e((c.region || '').split(' — ')[0])}</td>
      <td>${e(c.address || '')}</td>
      <td class="c">${st.label}</td>
      <td class="c">${c.quoteSent ? '✔ ' + e(c.quoteSentDate || '') : '—'}</td>
      <td class="c">${e(c.followUpDate || '')}</td>
    </tr>`; }).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>AEC Partner Contact Sheet — ${e(todayStr)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#000;background:#e8e8e8}
  .page{width:297mm;min-height:210mm;margin:0 auto;background:#fff;padding:10mm 12mm}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th,td{border:1px solid #444;padding:4px 6px;font-size:9.5px;vertical-align:top}
  th{background:#1E3A5F;color:#fff;font-size:8px;text-transform:uppercase;letter-spacing:.04em}
  td.c{text-align:center}td.b{font-weight:700}
  .tchip{display:inline-block;width:14px;height:14px;line-height:14px;border-radius:50%;color:#fff;font-weight:800;font-size:9px;text-align:center}
  .bar{position:fixed;top:0;left:0;right:0;background:#1E3A5F;color:#fff;padding:9px 18px;display:flex;gap:10px;align-items:center;z-index:99}
  .bar button{background:#fff;color:#1E3A5F;border:none;padding:6px 15px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer}
${_lh ? _lh.printCSS : ''}
  @page{size:A4 landscape;margin:8mm}
  @media print{ .bar,.barpad{display:none!important} body{background:#fff} .page{padding:0;width:auto;min-height:0} .tchip,th{-webkit-print-color-adjust:exact;print-color-adjust:exact} }
</style></head><body>
<div class="bar">
  <span style="font-weight:700">📇 AEC Partner Contact Sheet</span>
  <button onclick="window.print()">🖨 Print / Save as PDF</button>
  <button onclick="window.close()" style="margin-left:auto;background:rgba(255,255,255,.15);color:#fff">✕ Close</button>
</div>
<div class="barpad" style="height:46px"></div>
<div class="page">
  ${_lh ? _lh.headerHTML : `<div style="border-bottom:3px solid #1E3A5F;padding-bottom:8px;margin-bottom:8px"><div style="font-size:20px;font-weight:900;color:#1E3A5F">BARRO INDUSTRIES</div><div style="font-size:10px;color:#555">AEC Partner Contact Sheet · ${e(todayStr)}</div></div>`}
  <table>
    <thead><tr>
      <th style="width:26px">#</th><th style="width:30px">Type</th><th style="width:14%">Company</th>
      <th style="width:11%">Contact Person</th><th style="width:9%">Phone</th><th style="width:13%">Email</th>
      <th style="width:7%">Region</th><th>Address</th><th style="width:8%">Stage</th>
      <th style="width:8%">Quote Sent</th><th style="width:8%">Follow-up</th>
    </tr></thead>
    <tbody>${body || `<tr><td colspan="11" class="c" style="padding:14px">No contacts match the current filters.</td></tr>`}</tbody>
  </table>
  ${_lh ? _lh.footerHTML : ''}
</div>
</body></html>`;
  const win = window.open('','_blank','width=1100,height=720');
  if (!win){ Notifs.showToast('Allow pop-ups to open the printable sheet','error'); return; }
  win.document.write(html); win.document.close();
}
```

### Spec 7 — Login-triggered follow-up digest (`checkAECFollowups`)

**7a — NEW function in js/notifications.js, inserted immediately after `checkLowStock`'s closing
brace (line 624), same IIFE:**
```js
  // ── AEC follow-up daily digest (Sales + admins) ─
  // One batched notification per user per day: contacts whose followUpDate has
  // arrived and whose stage isn't terminal. Mirrors checkLowStock's shape:
  // role/dept-scoped, dedupKey'd by day, silent on permission errors.
  async function checkAECFollowups(uid, role) {
    const isSales = (window.currentDepts || []).includes('Sales');
    if (!['president','manager'].includes(role) && !isSales) return;
    try {
      const snap = await dbCachedGet('aec_contacts', () => db.collection('aec_contacts').get().catch(()=>({docs:[]})), 45000);
      const todayStr  = window.bizDate();
      const terminal  = window.AEC_TERMINAL || ['partner','dormant'];  // defensive: departments.js defines it
      const due = snap.docs.map(d => d.data())
        .filter(c => c.followUpDate && c.followUpDate <= todayStr && !terminal.includes(c.stage || 'new'));
      if (!due.length) return;
      const names = due.slice(0,5).map(c => c.company || c.contactPerson).filter(Boolean).join(', ');
      const more  = due.length > 5 ? ` +${due.length-5} more` : '';
      await send(uid, {
        title: `📇 ${due.length} AEC follow-up${due.length>1?'s':''} due`,
        body:  `Overdue: ${names}${more}. Open Sales → AEC to follow up.`,
        icon:  '📇', type: 'aec_followup', link: 'dept:Sales',
        dedupKey: `aec-fu-${uid}-${todayStr}`,
      });
    } catch (_) { /* read denied / offline — skip silently */ }
  }
```

**7b — export it (js/notifications.js:674): add `checkAECFollowups` to the IIFE's return object,
after `checkLowStock`:**
```js
// BEFORE
  return { startListener, stopListener, send, sendToDept, sendToAll, sendToOwner, showToast, initPush, checkDeadlines, checkAttendanceReminder, checkLowStock, initToggle, renderPage, markAllRead,
// AFTER
  return { startListener, stopListener, send, sendToDept, sendToAll, sendToOwner, showToast, initPush, checkDeadlines, checkAttendanceReminder, checkLowStock, checkAECFollowups, initToggle, renderPage, markAllRead,
```

**7c — boot call (js/app.js:82, the post-auth sequence): add one line directly after
`Notifs.checkLowStock?.(...)`:**
```js
      Notifs.checkLowStock?.(user.uid, userProfile.role);
      Notifs.checkAECFollowups?.(user.uid, userProfile.role);
```
(Optional-chained like `checkLowStock` so a stale-SW client without the new export is a no-op.
The `link: 'dept:Sales'` lands on the Sales page's default tab — precedented by
`checkLowStock`'s `dept:Purchasing`; do NOT invent a subtab deep-link format for notifications.)

### Spec 8 — `scripts/monthly-backup.js` OVERRIDES entry

Add to the `OVERRIDES` map (after the `suggestions` entry, ~line 157). Full snapshot — no
`dateField` (a directory is current-state, not a dated journal). JSON export already happens via
auto-discovery; this adds the curated human-readable CSV:
```js
  aec_contacts: {
    csvFields: ['id','itemNo','type','company','contactPerson','phone','email','region',
                'address','stage','quoteSent','quoteSentDate','quoteRef','potential',
                'followUpDate','lastContact'],
  },
```

### Spec 9 — Migration / rollout checklist (dependency order — greenfield, no data migration)

1. **Deploy rules FIRST** (Spec 2a new `aec_contacts` block + 2b `_counters` carve-out) via
   `~/.npm-global/bin/firebase deploy --only firestore:rules`. Re-`git diff firestore.rules`
   immediately before deploying (concurrent Phase-4 sessions — `deploy-recheck-full-file-diff`
   memory). Old clients are unaffected (nothing reads the collection yet). No
   `firestore.indexes.json` change (Spec 1).
2. **Ship the JS in one commit:** departments.js (Spec 3 constants/helpers + Spec 4 wiring +
   Spec 5 render + Spec 6 print), notifications.js (Spec 7a+7b), app.js (Spec 7c),
   scripts/monthly-backup.js (Spec 8). Verify each edited file with `node --check`. Confirm the
   commit diff shows a `CACHE_VER` bump in sw.js — the pre-commit hook auto-bumps
   `APP_VERSION`/index.html and (per the `sw_cache_bump_required` memory) now also CACHE_VER;
   if the diff shows NO CACHE_VER bump, bump it by hand (`bi-ops-vN` → `vN+1`) before pushing.
   No new file is added, so index.html and the sw.js `PRECACHE` list are untouched.
3. **No seed/backfill step** — the collection starts empty by design; the first `Add Contact`
   mints `itemNo` 1 and lazily creates `_counters/aec_contacts` (the transaction handles
   `!exists`).
4. **Manual test pass** (Spec 10) on the deployed rules + local serve before pushing.
5. **`git push origin master`** (deploys the app; remember this does NOT deploy rules — step 1
   already did).

### Spec 10 — Manual test checklist (no automated suite)

1. **Nav:** Sales page shows the new `AEC` chip between Clients and Quotes; direct deep-link
   `#/Sales/AEC` lands on it after refresh (initialSubtab plumbing); the other six tabs behave
   unchanged.
2. **Mint + write gate (the rules carve-out):** as a NON-admin Sales-dept employee, add two
   contacts → they get `itemNo` 1 and 2, `_counters/aec_contacts.count` = 2, docs carry
   `addedBy`/`createdAt`/`lastContact` = today (Manila).
3. **Read scope:** as an internal non-Sales employee, the table renders read-only (no
   Add/✎/🗑 buttons); a console `db.collection('aec_contacts').add(...)` is DENIED. As the
   Brilliant Steel partner login, a console read of `aec_contacts` is DENIED (and the Sales page
   isn't reachable anyway).
4. **Delete tier:** manager sees 🗑 and can delete after the confirm dialog; a Sales employee
   sees no 🗑; after a delete, the next new contact continues the sequence (gap remains — 
   expected).
5. **Filters AND-compose:** set type=Engineer + stage=Prospect + a region + a search term →
   table shows only rows matching ALL four; chip count pills match the unfiltered totals;
   clearing each dimension restores rows independently.
6. **Derived columns:** a `new`-stage contact exports Contacted?=No / Prospected?=No; a
   `prospect` exports Yes/Yes; a `dormant` exports Yes/No — verify in the CSV.
7. **CSV safety:** export with a company named `=HYPERLINK("x")` → cell arrives
   apostrophe-prefixed (formula guard); ₱/ñ characters render correctly in Excel (BOM).
8. **Quote tracking:** tick "Quotation sent" with the date blank → saves with today's Manila
   date; untick → `quoteSentDate` clears to `''`; the table Quote column shows ✅+date / —.
9. **Follow-up banner:** set `followUpDate` = yesterday on a `contacted` record → the ⏰ banner
   counts it and the row's follow-up cell turns red with "· due"; flip the stage to `partner` →
   it drops out of the count.
10. **Login digest:** with ≥1 overdue contact, log in as a Sales member → exactly ONE 📇
    notification listing up to 5 companies; log out/in again same day → NO duplicate (dedupKey);
    log in as a non-Sales employee → none; tapping it opens the Sales page.
11. **Print:** with filters active, 🖨 Print → landscape letterhead sheet containing ONLY the
    filtered rows and the filter description in the header meta; the `potential` notes column is
    absent; the A/E/C dot colors survive print preview; popup-blocked case shows the toast.
12. **XSS spot-check:** a contact with company `<img src=x onerror=alert(1)>` renders inert in
    the table, detail modal, editor, and print window (escHtml everywhere).

### Spec 11 — Cross-workstream call-outs (for the implementer — do NOT "improve" these)

- **WS31 (Quotation builder v3):** `quoteSent`/`quoteRef` are MANUAL by design — do not query
  `bk_quotes`/`bs_quotes` from this screen while WS31 is mid-rewrite. Upgrade path when WS31
  stabilizes: derive `quoteSent` from a quote-doc match on `company`/`quoteRef` and demote the
  checkbox to an override; the schema needs no migration for that.
- **WS32 (Client Relations hub):** `stage`/`followUpDate`/`lastContact` deliberately reuse
  `sales_clients`' exact field names and semantics so a WS32-generalized CRM/timeline/follow-up
  engine can treat `aec_contacts` as just another CRM collection. Whoever decides WS32 must
  reconcile against THIS shape (this workstream landed first); `checkAECFollowups` is additive
  and safely superseded by any future WS32 engine — delete the boot call, keep the data.
- **Rules-posture note (so it isn't mistaken for a bug):** `aec_contacts` writes are
  `canDept('Sales')` while `sales_clients` next door is still legacy bare-`isAuth()` — the
  directory is deliberately on the newer, tightened pattern; the Clients looseness is a
  pre-existing inconsistency tracked in the Risks section, not something this workstream fixes.
- **Color-semantics note (design review, one sentence):** the owner's red Engineer chip is
  rendered as a small circular LETTER chip, visually distinct from the word-badges that carry
  status meaning (stage badges, overdue red) — do not render the type as a `.badge` word pill.

## Risks / cross-workstream interactions

- ⚠️ **WS32 (Sales — Client Relations hub, V12-PLAN.md:197-198)** explicitly plans "per-client
  timeline (quotes, orders, payments, files, follow-ups in one view); CRM stages rolled into
  win-rate analytics" — heavy conceptual overlap with AEC's own contacted-status/quotation-sent/
  follow-up tracking. If WS32 lands a generalized per-contact timeline/CRM engine after this
  workstream ships its own bespoke status fields, the two could duplicate or actively disagree
  about what "contacted"/"follow-up due" means for the same company. Recommend whichever Fable
  session scopes WS32 explicitly reconcile against whatever `aec_contacts` shape this workstream
  picks.
- ⚠️ **WS31 (Quotation builder v3, V12-PLAN.md:191-196)** is mid-repair on "the quote→approval→
  order chain" and plans to "delete ~1,800 lines of dead builder code." If Open Decision
  "quotation sent?" resolves to a real cross-reference into `bk_quotes`/`bs_quotes` (rather than
  a manual checkbox), that reference depends on WS31's quote data model being stable — building
  it against a quote system mid-rewrite risks the reference breaking or needing rework almost
  immediately.
- ⚠️ **WS14 (letterhead) is a LOW risk here specifically because it's already fully shipped**
  (V12-PLAN.md Build Log, 2026-07-10) — unlike WS24/WS31, which had to build a fallback against
  an undecided WS14, this workstream can call `window.buildLetterhead` directly with no
  placeholder/fallback complexity.
- ⚠️ **`firestore.rules` concurrency** — per the `deploy-recheck-full-file-diff` memory, other
  sessions (including further Phase-4 grounding work happening the same day) may be mid-edit on
  `firestore.rules`; re-diff immediately before any `--only firestore:rules` deploy so this
  workstream's new `aec_contacts` block doesn't clobber or get clobbered by an unrelated
  concurrent change.
- ⚠️ **Pre-existing rules inconsistency, not caused by this workstream but adjacent to it** —
  `sales_clients`/`bs_clients`/`design_clients` already have a looser write rule (bare
  `isAuth()`, no dept/partner gate) than `work_plans`/`gov_philgeps` sitting in the very same
  Sales area. If Fable tightens `aec_contacts` to `canDept('Sales')`, that's a stricter posture
  than the Clients tab immediately next to it in the same Sales page — worth a one-line note in
  the DECIDED spec so this isn't mistaken for a bug later.
- ⚠️ **Color semantics collision, presentation-layer only.** The mandate's type-badge colors
  (yellow/red/blue for A/E/C) carry no status meaning, but red/yellow already carry STATUS
  meaning elsewhere in this app (CRM_STAGES' `lost`=red, cash-advance overdue badges, attendance's
  ✗ = red/absent). A contact whose TYPE happens to render red (Engineer) sitting in a UI where
  red usually means "problem" is a minor but real cross-screen consistency risk worth a
  design-review sentence in the DECIDED spec, not a blocker.
- ⚠️ **No-cron-infrastructure risk (repeated from the nudge open-decision above).** If Fable
  picks a true scheduled-reminder mechanism, that is genuinely NEW infrastructure this repo does
  not have anywhere (same finding WS25 independently reached for leave accrual) — for
  consistency across the v12 rebuild, recommend starting with the cheaper login-triggered digest
  pattern and deferring cron, unless Neil specifically asks for unconditional reminders here.
- ⚠️ **Backup-shape drift.** `scripts/monthly-backup.js:111` already name-drops `aec_contacts` in
  a comment but has no actual `OVERRIDES` entry. If this workstream's data ends up containing
  anything sensitive enough to want CSV-column curation (e.g. omitting free-text
  "feedback/partnership potential" notes from an exported CSV), forgetting to add that entry
  means the auto-discovered JSON/absent-CSV export includes every field verbatim by default —
  probably fine, but an explicit decision either way is better than a silent default.

## Files likely touched

`js/departments.js` (`renderSales`'s `salesTabs` array ~line 5479 and `loadSalesContent`'s switch
~5514-5572 for nav wiring; `salesSubNav` ~5503-5518 if nested; `CRM_STAGES`/`renderClientProfiles`
~11071-11208 as the closest sibling pattern to mirror or extend; `openInventoryCountForm`
~12905-13013 as the closest multi-row-table-print template; a new render/CSV/print function and
its supporting handlers), `js/config.js` (only if a shared PH-regions constant or an AEC
type-color array needs to be read outside `departments.js`; optional cosmetic update to
`DEPARTMENTS['Sales'].subtabs`, confirmed non-functional either way), `js/letterhead.js`
(consumed as-is, not expected to need changes — already generalized enough per its existing
multi-row-table usage), `js/app.js` or `js/notifications.js` (only if the login-triggered-digest
nudge option is chosen, following `checkLowStock`/`checkCAReminder`'s placement and the
`app.js:77-84` boot-sequence call site), `firestore.rules` (new `aec_contacts` match block, most
naturally placed near the other Sales-adjacent collections at ~751-775 or ~1113-1123),
`scripts/monthly-backup.js` (optional new `OVERRIDES` entry for CSV-column curation — JSON
backup is already automatic with zero changes per item 12), `sw.js` (`CACHE_VER` bump, mandatory
per CLAUDE.md on any `.js`/`.css` touch), `index.html` (only if a new dedicated JS file is
introduced — not expected, since every sibling pattern cited above lives inside the existing
`departments.js`).

## Expected deliverable format

> A numbered build spec Sonnet can execute without further judgment calls, matching the density
> of workstreams 25-27's DECIDED sections: **one**, the exact resolved choice for each open
> decision above stated as a one-line policy with a one-line rationale (nav placement, write-role
> tier, read scope, nudge mechanism, item-# scheme, PH-region field type, quotation-sent linkage,
> etc.) — not a menu, a pick. **Two**, the exact `aec_contacts` field-by-field shape (name, type,
> default) as an annotated literal, plus the literal `firestore.rules` diff for the new match
> block in the same comment-then-match style as the existing rules file, and — if chosen — the
> exact `OVERRIDES` entry for `scripts/monthly-backup.js`. **Three**, exact function signatures
> and full before/after code blocks anchored to the file:line citations in this brief (the
> `salesTabs`/`loadSalesContent` wiring in `renderSales`, departments.js:5479/5514-5572; the new
> render function's filter/CSV/print handlers, written in full — not described — since it cannot
> reuse `renderClientProfiles`'s CRM-stage internals verbatim given the different field set).
> **Four**, if a login-triggered nudge digest is chosen: the complete `checkX()` function body
> (mirroring `checkLowStock`'s or `checkCAReminder`'s shape exactly) plus its exact insertion
> point in the `app.js:77-84` boot sequence; if deferred, an explicit one-line note that it's
> out of scope for this pass and why. **Five**, a numbered migration/rollout checklist in
> dependency order (rules deploy first and separately from `git push`, re-diff firestore.rules
> immediately before deploying, CACHE_VER bump, optional monthly-backup.js `OVERRIDES` addition,
> manual test pass, `git push origin master`) in the same ordered style as WS25/WS26's rollout
> checklists. **Six**, explicit one-line call-outs of how this spec relates to WS31 (Quotation
> builder v3) and WS32 (Client Relations hub) per the Risks section above, so Sonnet does not
> build a "quotation sent?" cross-reference against a quote system that WS31 is mid-rewriting, or
> duplicate a CRM/follow-up engine WS32 may generalize later.
