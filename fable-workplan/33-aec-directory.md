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

## Open decisions

Per the task framing, this workstream is the most concretely specified of the remaining Phase-4
items — the field list, the type-color mapping, and the collection name are already given by the
owner. What remains is HOW to wire it into the existing patterns above, not WHAT it is:

- [ ] **Nav placement.** New top-level entry in `renderSales`'s `salesTabs` array
      (departments.js:5479, e.g. `'AEC'`) + a new `case` in `loadSalesContent`'s switch
      (departments.js:5514-5572), OR a nested `salesSubNav()` view under an existing tab (e.g.
      under `'Clients'`, given both are prospecting/CRM-flavored)? Also whether
      `DEPARTMENTS['Sales'].subtabs` (config.js:137-140, confirmed stale/cosmetic-only per item 6
      above) is worth updating for the Departments-admin preview grid, or left as-is like the
      other five real Sales tabs already are.
- [ ] **Write-role gate.** Mirror the tightened `canDept('Sales')` pattern
      (`work_plans`/`marketing_plans`/`gov_philgeps`) or the looser legacy bare-`isAuth()`
      pattern still live on `sales_clients`/`bs_clients`/`design_clients`? These three
      structurally similar collections currently disagree with each other in this exact repo —
      Fable's choice here should be a deliberate one, not an accidental copy of whichever example
      Sonnet reads first.
- [ ] **Read scope.** Every internal (non-partner) role, matching `work_plans`/`gov_biddings`'s
      company-wide-internal read, or Sales-department + admin-only (tighter, since a
      partnership/prospecting pipeline could be considered more sensitive than a generic file
      collection)?
- [ ] **Follow-up nudge mechanism — the single biggest fork inherited from the mandate.** Pick
      ONE: **(a)** a login-triggered role-scoped digest mirroring `checkLowStock`
      (notifications.js:602-624) — "N AEC contacts overdue for follow-up," fired to Sales-dept
      members/admins at login, zero new infrastructure; **(b)** an in-page-only banner mirroring
      `renderClientProfiles`'s `dueFollowups` (departments.js:11097) — cheapest, but invisible
      unless the screen is actually open; **(c)** a genuine server-side scheduled reminder (a new
      Firebase Scheduled Function, or a new GitHub Actions cron + `scripts/*.js` runner) — the
      ONLY option that reminds someone regardless of login cadence, but this repo has zero
      `onSchedule` precedent anywhere and this would be new infrastructure (the same fork WS25
      independently resolved for leave accrual by choosing the no-new-infra option).
- [ ] **What data actually drives the nudge.** A manually-set `followUpDate` (mirrors
      `sales_clients.followUpDate` exactly, salesperson types a date) vs. an auto-computed
      "N days since last contact" threshold (no explicit date input; computed from a
      `lastContactedAt` stamp) — different data shape and different UI.
- [ ] **How "contacted status" / "prospected project?" / "quotation sent?" are modeled.** Three
      independent booleans (with or without a timestamp each) vs. folding some/all into a single
      CRM-stage-style enum (reuses `CRM_STAGES`'s exact array shape and `window.chipTabs`'
      single-active-key filter UI wholesale) vs. a hybrid (one stage enum plus 1-2 supplementary
      booleans). This decision determines whether the existing single-select chip-filter code
      can be reused as-is, or whether the screen needs a NEW multi-facet filter UI — every
      existing `chipTabs`/`bindChipTabs` call site in the app (~10 grepped) is single-active-key
      only; simultaneous independent boolean filters would be a new UI composition, not a copy of
      an existing one.
- [ ] **"Item #" — persisted or positional?** A stable, `_counters`-minted number (reusing
      `window.nextSerial`/the `_counters/workers` transaction pattern, so a salesperson can cite
      "contact #14" regardless of current sort/filter) vs. a render/print-time positional index
      (`idx+1`, matching every other numbered table/print in the app today, but which shifts
      under filtering/sorting/deletion).
- [ ] **PH region: free-text or a structured enum?** Free-text matches every existing
      address-adjacent field in the app (zero precedent for a region dropdown anywhere); a real
      enum of the ~17 official PH administrative regions would be the first such constant in the
      codebase and needs a decision on where it lives (`config.js`, alongside `DEPARTMENTS`/
      `ROLES`) and whether it's a strict `<select>` or a free-text-with-suggestions field.
- [ ] **CSV/backup scope.** Confirm whether the free, zero-code JSON auto-discovery in
      `scripts/monthly-backup.js` (item 12 above) is sufficient for the mandate's "+ backup"
      clause, or whether a curated `csvFields` `OVERRIDES` entry (a few lines, matching every
      other collection) should also be added for a human-readable monthly CSV.
- [ ] **Print layout and content.** One letterhead-wrapped multi-row table mirroring
      `openInventoryCountForm`'s landscape-A4 approach (item 9 above) — given ~12 mandate
      columns, does the PRINTED sheet show every column, or a curated subset (e.g. omitting the
      free-text "feedback/partnership potential" notes from a physical printout that might leave
      the building)? The mandate says "printable on letterhead" (singular sheet), which points at
      the multi-row-table format rather than one-card-per-contact, but the exact column set for
      print vs. on-screen is undecided.
- [ ] **Filter-dimension composition.** Given `chipTabs` is single-select, which of
      {type A/E/C, PH region, contacted status, prospected project?, quotation sent?} get a
      dedicated chip-filter row (type is the obvious first, matching `CRM_STAGES`), and does the
      screen need MULTIPLE independent filter bars stacked (a new composition, not seen
      elsewhere in the app) to satisfy "filterable" across several of these dimensions at once?
- [ ] **"Quotation sent?" — a manual checkbox, or a real cross-reference to an actual quote
      doc?** `renderClientProfiles`'s `openClientQuotesModal` (departments.js:11210+) already
      queries `bk_quotes`/`bs_quotes` by `clientName` to show a client's real quote history — a
      linked-quote reference (auto-derived `true` when a matching quote doc exists) would be
      self-maintaining and echo WS31/WS32's stated ambition of one CRM source of truth
      (V12-PLAN.md:191-198), vs. a manual checkbox that can silently drift from what actually
      happened. Not resolvable without also knowing whether WS31/WS32 have been scoped yet
      (as of this brief, they have not — see item 2).

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
