# Workstream 34 — Marketing suite (campaigns, leads inbox, promotions calendar, materials library, insights)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

V12-PLAN.md's exact mandate (V12-PLAN.md:204-206, under "### PHASE 4 — Operations & departments", the phase itself unstarted — INDEX.md confirms all 18 Phase-2/3 workstreams are DECIDED/IMPLEMENTED and explicitly notes "Phase 4 (workstreams 28-40) has no Fable specs yet"): "34. Marketing suite — campaigns (budget→actual, dates, channels), leads inbox → Sales handoff, promotions calendar, marketing materials library (Files hub), strategy templates (types of marketing), per-campaign insights (spend vs leads vs quotes vs wins)."

MARKETING IS NOT A STUB — it is a real, fully-wired department today, just missing every WS34-specific concept. `DEPARTMENTS.Marketing` (js/config.js:141-143): `{ key:'Marketing', icon:'📢', lucideIcon:'megaphone', color:'#880e4f', subtabs:['Advertising','Marketing Designs','Plan','Budgeting','Proposals'], navOrder:4 }`. `window.renderMarketing(currentUser, currentRole, subtab='Advertising')` (js/departments.js:1951-1966) renders a `sopPanel` ("Advertising and Marketing Designs hold the creative asset libraries. Plan and Budgeting cover campaign planning and spend; Proposals stores pitches. Tasks is the department board.") plus `chipTabs` over **six** tabs (`['Advertising','Marketing Designs','Plan','Budgeting','Proposals','Tasks']` — note "Tasks" is hardcoded into this chip list but is NOT in `DEPARTMENTS.Marketing.subtabs`, a pre-existing minor inconsistency, not something WS34 introduces). `loadMarketingContent` (departments.js:1967-1990) routes each tab to a generic, cross-department renderer: Advertising/Marketing Designs → `renderFileCollection`/`bindFileCollection` (a file library, detailed below); Plan → `renderDocCollection(content,'marketing_plans','Marketing Plans',...)`; Budgeting → `renderBudgeting(content,...,'Marketing')`; Proposals → `renderDocCollection(content,'marketing_proposals','Marketing Proposals',...)`; Tasks → `renderDeptTasks(content,'Marketing',...)` (departments.js:432). Router wiring: `case 'Marketing': renderMarketing(currentUser, currentRole); break;` (js/app.js:3629). `canEditDept(dept)` (departments.js:17) is the existing write-gate helper CLAUDE.md references.

GREENFIELD, CONFIRMED BY GREP: zero hits for "campaign" as a real concept anywhere in js/*.js, firestore.rules, or functions/*.js — the only match is the sopPanel copy line above ("campaign planning and spend"), plain English, not a data model. Zero hits for a leads-inbox collection, `promotion`/`promo_calendar`/`marketing_calendar` (the only "promotion" hits are unrelated job-promotion copy in app.js:6215/departments.js:2079). Sibling workstream 33's `aec_contacts` collection (new, also unbuilt) has zero hits too — confirming Phase 4 truly has not started. So: campaigns, a marketing-owned leads inbox, a promotions calendar, and per-campaign insights are all genuinely greenfield — no existing collection, rule, or render function to migrate.

NOT GREENFIELD: the "marketing materials library" sub-mandate already has a working implementation TODAY, via the exact generic file-library mechanism used by "every Files tab, all depts" (firestore.rules:1128 comment, confirmed). `window.renderFileCollection`/`window.bindFileCollection` (departments.js:11679-11827, the winning definitions — they reassign `window.renderFileCollection`/`window.bindFileCollection` after two same-named plain `function` declarations at departments.js:11379/11392, so the later window-assigned versions are what every current caller, including Marketing, actually gets) back Marketing's Advertising and Marketing Designs tabs with a real folder/link/archive file browser: uploads go through `Drive.renderUploadArea(...)` (js/drive.js, Storage-backed, immediate upload — the CLAUDE.md-documented "no employee Google OAuth" pattern), metadata lands in a runtime-named Firestore collection `files_<scope>` (`files_advertising`, `files_designs` for Marketing's two tabs specifically), and the UI already supports folders (including empty folder markers via `isFolderMarker`), link-attachment (`kind:'link'`), archive/restore, and uploader-or-admin edit rights. This is precisely the ad hoc, per-department pattern that WS38 (Files Hub — "one browser over all files... rides Storage + nightly Drive mirror", V12-PLAN.md:217-222) intends to eventually unify. So V12-PLAN.md's parenthetical "(Files hub)" next to "marketing materials library" is genuinely ambiguous on the current record: it could mean (a) Marketing's existing Advertising/Marketing Designs tabs already satisfy the materials-library mandate as-is, nothing new needed, or (b) the owner wants materials scoped to a SPECIFIC campaign (not just a department-wide folder), which the current `files_<scope>` shape cannot express since `scope` is a fixed string ('Advertising'/'Designs'), not a per-campaign id.

CRM/leads infrastructure ALREADY EXISTS, shared across three brands, and is directly relevant to "leads inbox → Sales handoff": `CRM_STAGES` (departments.js:11074-11079) defines a shared lifecycle `lead → prospect → won → lost` (with color/icon per stage) used identically by `sales_clients` (Sales/Barro), `design_clients` (Design), and `bs_clients` (Brilliant Steel) via the shared `renderClientProfiles(container, currentUser, currentRole, brand)` (departments.js:11081-11100+) and helpers `crmStageOf(cl)` (default `'lead'` for any unrecognized/missing stage) and `crmStageMeta(k)`. Each client record already carries `followUpDate` (a `YYYY-MM-DD` string; `renderClientProfiles` computes a "due follow-ups" alert banner from it, departments.js:11097/11147/11162/11247/11267) and `lastQuoteNumber` (a single denormalized string — the client card literally reads "📄 View quotes / reopen →", departments.js:11117, implying a lookup, most plausibly matched by client name/company text since no `clientId` FK from a quote to `sales_clients` was found anywhere by grep — the only `clientId` field usages found are in an unrelated Design-department project-assignment context, departments.js:7213/7266). Rules for the CRM collections (firestore.rules:1112-1123, comment block "Client CRM (per brand)"): `sales_clients`/`design_clients` — `allow read: if isAuth() && !isPartner()`, `allow create, update: if isAuth()` (i.e. ANY signed-in user, no dept/role check at all), `allow delete: if isAuth() && isAdmin()`; `bs_clients` — same but read is open to the partner too (`allow read: if isAuth()`). So today, a "lead" is simply the default initial `stage` value of a client record created directly inside Sales's own CRM screen — there is no separate marketing-owned inbox that later graduates or hands off into `sales_clients`; and because `sales_clients.create` is already open to any authenticated user, a Marketing-authored lead-capture form writing straight into `sales_clients` with `stage:'lead'` would need **zero firestore.rules changes** to work today.

`leadSource` exists as a free-text/coded breadcrumb in exactly two quote-adjacent places, but never on a client or lead record itself, and never feeds back into `sales_clients.stage`: (1) the Quote Builder iframe → Firestore bridge (js/app.js:8130-8165) writes `leadSource: payload.leadSource || ''` onto the created **Barro Kitchen** quote doc (`company: payload.company || 'BK'`) at app.js:8152 — a plain string, no controlled vocabulary; (2) the **Brilliant Steel** quote-number generator embeds a fixed 2-letter lead-source code directly into the printed quote-number string itself (departments.js:8630-8660, `<select id="bs-qno-method">` options `FB/VB/OF/RF/IG/WB/EM/TK/EX` = Facebook/Viber/In-Office/Referral/Instagram/Website/Email/TikTok/Exhibition, composed into a pattern like `BS-LU-FB-YYMMDD-001`) rather than stored as a separately queryable field. Both are one-way, salesperson-picked-at-quote-time labels; neither is written by, or visible to, Marketing today.

Quote cross-referencing for "per-campaign insights (spend vs leads vs quotes vs wins)": `getAllQuotes()` (js/app.js:2048-2060) merges three collections — `bk_quotes`, `bs_quotes`, and a legacy top-level `quotes` — into one array, cached under the shared `dbCachedGet` key `'all-quotes'` (invalidated on quote writes). No `campaignId` field, and (confirmed above) no reliable `clientId` FK from a quote back to `sales_clients`/`bs_clients`, exists anywhere in this merge or in either quote collection's write payload. So today there is no mechanical way to answer "how many quotes/wins came from campaign X" — that cross-reference is 100% new plumbing, not a wiring exercise.

Budget-vs-actual precedent ALREADY EXISTS and Marketing already uses it: `renderBudgeting(container, currentUser, currentRole, dept)` (departments.js:11475-11530+) is a generic, already-shipped per-department budget tracker. It reads a runtime-named collection `budgets_<dept>` (for Marketing: `budgets_marketing`) holding simple lines `{ name, budget, createdAt }`, and computes "spent" **live, client-side** by filtering the shared `ledger` collection for entries where `dept==='Marketing' && budgetLineId===<lineId> && ledgerKind(e)==='expense'` (departments.js:11500-11503) — no `spent` field is ever stored on the budget line itself. This is a real, working, per-line budget-vs-actual mechanism Marketing's own Budgeting tab already exposes today — but at department-budget-line granularity (e.g. one line named "Q3 Ads"), with no dates, no channel, and no notion of "campaign" as a first-class object. A "campaign" could plausibly extend this exact shape (add `startDate`/`endDate`/`channel` onto a budget-line-like doc, keep the existing ledger cross-reference via `budgetLineId`) rather than invent a wholly separate spend-tracking mechanism from scratch — that reuse-vs-new-collection choice is left open below.

CONFIRMED UI/RULES MISMATCH in that same Budgeting mechanism, directly relevant if a campaign's budget±actual reuses it: the `budgets_<dept>` Firestore WRITE rule is `isMoneyAdmin()` only — `isMoneyAdmin()` is defined (firestore.rules:31) as `getRole() in ['president','manager','finance']`, i.e. a plain `'employee'` role is excluded — yet `renderBudgeting`'s own client-side `canEdit` gate (departments.js:11481) is `currentRole==='president'||currentRole==='owner'||currentRole==='manager'||currentRole==='finance'||isDeptMember`, where `isDeptMember` is simply "is this user a member of `dept`" (any role). Net effect: a plain Marketing employee (department member, role `'employee'`) sees the "+ Budget Line" / "📤 Log Expense / Income" buttons today, but clicking them hits a silent `firestore.rules` permission-denied, because `isMoneyAdmin()` doesn't include `'employee'`. This is a pre-existing gap in the current app (not introduced by WS34), but any campaign-budget feature that reuses `budgets_marketing` inherits it verbatim unless separately addressed.

Backup coverage is now zero-config for brand-new collections: `scripts/monthly-backup.js:108-112` (comment, confirmed) states "Any root collection NOT listed here is auto-discovered (`db.listCollections()`) and exported as a COMPLETE full-document JSON snapshot — no hand-registration... so new collections (`pay_runs`, `it_*`, `aec_contacts`, `files_*`, `budgets_*`, …) are covered automatically and this file never drifts again." So any brand-new WS34 collection (a `campaigns` collection, whatever the leads-inbox collection is named, a promotions collection, an insights cache) is backed up automatically; an `OVERRIDES` entry is only needed if the collection wants date-filtered exports or CSV columns.

Cross-department notify infrastructure ALREADY EXISTS and is the natural mechanism for "leads inbox → Sales handoff": `window.Notifs` (js/notifications.js) exposes `send(targetUid, {title,body,icon,type,link,dedupKey,taskId})` (line 252), and critically `sendToDept(department, notifData, opts={fallbackToOwner})` (lines 276-303) — it looks up every user with `department==dept` OR `departments array-contains dept`, batches writes in chunks of ≤499 to `notifications/{uid}/items/{id}`, and (per its own comment) falls back to notifying the owner/president if literally nobody is assigned to that department, "so e.g. a job sent to Production with no Production user is never lost." `Notifs.sendToDept('Sales', {...}, {fallbackToOwner:true})` is a ready-made, already-battle-tested call a lead-handoff feature could use with zero new notification plumbing.

A second, unrelated calendar-UI precedent exists that may be relevant to "promotions calendar": `renderMiniCal()` (js/app.js:7621-7660+) is a bespoke month-grid mini-calendar on the employee dashboard, showing event dots for the CURRENT user's own tasks that have a `dueDate` (queried via `tasks.where('assignedTo','array-contains',uid)`, filtered to open statuses, grouped `byDay`). It is hardcoded to the `tasks` collection and the signed-in user's own assignments — not a generic, reusable, pluggable-data-source calendar component. (Attendance also has its own bespoke calendar renderer, per the WS25/26 briefs, modules.js ~1090-1240 — also not generic.) So a "promotions calendar" has a visual pattern to imitate (7-column month grid, `‹`/`›` nav, event dots per day) but no ready-to-call shared calendar widget to invoke as-is.

The `files_.*`/`budgets_.*` wildcard rule match (firestore.rules:1125-1157, comment "Dynamic / runtime-named collections... Firestore does NOT match collections by prefix, so cover each family with a single-segment wildcard guarded by `coll.matches(...)`") is the ONE deliberate, documented exception in this codebase to the "no cascade/prefix matching" convention cited throughout the other Fable briefs — it exists specifically because `files_<scope>`/`budgets_<dept>` collection NAMES are computed at runtime from a department string, so a literal match block is impossible. A brand-new WS34 collection with a fixed literal name (e.g. `campaigns`, `marketing_leads`, `promotions`) does **not** get this treatment automatically — like `sales_clients`, it needs its own explicit `match /collectionName/{docId} { ... }` block.

For context, the sibling Phase-4 workstreams this one is embedded next to (all equally unbuilt, V12-PLAN.md:179-222): 32 "Sales — Client Relations hub — per-client timeline (quotes, orders, payments, files, follow-ups in one view); CRM stages rolled into win-rate analytics" (V12-PLAN.md:197-198); 33 "AEC Partner Directory... New `aec_contacts` collection + rules + backup" (199-203, a nearby precedent for "spin up one new literal-named collection + rules + backup for a directory/CRM-adjacent feature," worth imitating structurally); 35 "Design dept suite — project folders + client folders synced with Sales client files (one client record shared, per-dept views)" (207-209, another workstream that wants to reuse/extend the shared client-record concept `sales_clients`/`design_clients` already partially share via `CRM_STAGES`); 38 "Files Hub — Drive-style: one browser over all files... rides Storage + nightly Drive mirror" (217-222, the eventual unification target for every `files_<scope>` collection in the app, Marketing's Advertising/Marketing Designs tabs included).

## Data model

`DEPARTMENTS.Marketing` (js/config.js:141-143): `{ key:'Marketing', icon:'📢', lucideIcon:'megaphone', color:'#880e4f', subtabs:['Advertising','Marketing Designs','Plan','Budgeting','Proposals'], navOrder:4 }` — nav/bottom-nav entries for Marketing are derived from this plus `currentDepts` (per CLAUDE.md), not a hardcoded per-role array; no separate Marketing nav array exists to hand-edit.

`files_advertising` / `files_designs` (Marketing's existing two file-library tabs; shape read off `bindFileCollection`'s upload/folder/link handlers, departments.js ~11759-11827): per real-file doc — `{ name, fileType:'Document'|'Image'|'Spreadsheet'|'PDF'|'Other', folder:string (default 'General'), archived:bool, url:string (Storage download URL), department:'Marketing', scope:'Advertising'|'Designs', uploadedBy:uid, uploaderName:string, createdAt:serverTimestamp }`; per empty-folder-marker doc — same shape plus `isFolderMarker:true, name:'📁 '+folderName`; per link-attachment doc — `kind:'link'`, plus a `description` field, no `fileType`. Rules (firestore.rules:1134-1146, the `files_.*` wildcard match): read = any authed non-partner; create = any authed non-partner where `request.resource.data.uploadedBy == request.auth.uid`; update/delete = any authed non-partner where `resource.data.uploadedBy == request.auth.uid || isAdmin()`.

`budgets_marketing` (Marketing's existing Budgeting tab; departments.js:11475-11530): per line — `{ name:string, budget:number, createdAt:serverTimestamp }`. No `spent` field stored — computed live from `ledger` filtered by `dept==='Marketing' && budgetLineId===<lineDocId> && ledgerKind(e)==='expense'`. Rules (firestore.rules:1147-1157, the `budgets_.*` wildcard match): read = any authed non-partner; write = `isMoneyAdmin()` (president/manager/finance only — see the confirmed UI/rules mismatch in Current State).

`marketing_plans` / `marketing_proposals` (Marketing's existing Plan/Proposals tabs, via the generic `window.renderDocCollection(container, collection, title, currentUser, currentRole, cfg)`, departments.js:11852+): per doc — `{ title|name:string, description:string, status:string (default 'active'), fileUrl:string (optional), createdAt:serverTimestamp }`; `canAdd` is gated by `cfg.dept ? canEditDept(cfg.dept) : (president/owner/manager/finance)` — Marketing's calls pass `{dept:'Marketing', icon, color}`, so `canEditDept('Marketing')` (departments.js:17) is Marketing's real write gate today for these two tabs (worth checking its exact rule against whatever WS34 decides for campaign/lead write access, for consistency).

`sales_clients` / `design_clients` / `bs_clients` (shared "Client CRM (per brand)", firestore.rules:1112-1123; render/helpers departments.js:11074-11267+): common fields observed — `{ name, company, email, phone, stage:'lead'|'prospect'|'won'|'lost' (default 'lead' via crmStageOf), followUpDate:'YYYY-MM-DD' string, lastQuoteNumber:string (denormalized, single latest quote), deleteRequested:bool, createdAt:serverTimestamp }`. Rules: `sales_clients`/`design_clients` — read: authed non-partner; create/update: any authed user; delete: admin only. `bs_clients` — read: any authed (partner included); create/update: any authed; delete: admin only.

Quotes (merged by `getAllQuotes()`, app.js:2048-2060, cached under `dbCachedGet('all-quotes',...,30000)`): `bk_quotes` (Barro Kitchen) gains a free-string `leadSource` field from the quote-builder bridge (app.js:8130-8165, `leadSource: payload.leadSource || ''` at line 8152) alongside `quoteNumber, company, clientName, clientCompany, clientAddress, clientPhone, clientEmail, salesperson, purpose, subject, location, quoteDate, items[], subtotal, total, grandTotal, vatIncluded, vatAmount, discountPct, discountAmount, netAmount, deliveryInstall, timeline, remarks`; `bs_quotes` (Brilliant Steel) encodes its lead-source as a 2-letter code baked into the quote-number STRING itself (`BS-{location}-{leadSourceCode}-{YYMMDD}-{seq}`, departments.js:8630-8660), not as a separate queryable field; the legacy top-level `quotes` collection is also merged in but not otherwise detailed here (out of scope). No `campaignId` field exists on any quote collection today.

`notifications/{uid}/items/{id}` (the universal cross-user "send" mechanism, per CLAUDE.md) — reachable via `Notifs.send`/`sendToDept`/`sendToAll`/`sendToOwner` (js/notifications.js:252-340+); `sendToDept(department, notifData, {fallbackToOwner})` is the concrete precedent for a Marketing→Sales handoff alert.

`ledger` (shared finance ledger, cross-referenced by `budgets_<dept>` via `budgetLineId` and `ledgerKind(e)` — the same collection every department's Budgeting tab reads spend from) — fields not re-derived here beyond what `renderBudgeting` reads (`dept`, `budgetLineId`, `amount`, `date`); relevant only as the existing cross-reference target if a campaign's "actual spend" reuses the budget-line pattern.

## Constraints — must respect

- Every brand-new, literal-named collection this workstream introduces (a `campaigns` collection, whatever the leads-inbox collection is named, a promotions collection, an insights cache/rollup) needs its own explicit `firestore.rules` match block — the `files_.*`/`budgets_.*` wildcard trick (firestore.rules:1125-1157) is a narrow, deliberate exception for collections whose NAME is computed at runtime from a department string; it does not and should not be stretched to cover a fixed-name collection (per the firestore-rules-collection-coverage memory, and the code's own comment explaining why the wildcard exists at all).
- Rules must read any newly-added shape-guard field via `.get(field, default)`, never bare field access, or a doc missing that field denies the entire rule (firestore-rules-missing-field-throws memory) — relevant to any status/date-range validation added to a new campaigns/leads collection.
- Backup is already zero-config for new root collections (`scripts/monthly-backup.js:108-112`, confirmed) — no manual registration step is required unless a collection wants date-filtered exports or CSV columns, in which case it needs an `OVERRIDES` entry (see `attendance`/`tasks` examples at monthly-backup.js:118-124).
- `escHtml()` before any `innerHTML` interpolation of Marketing-authored free text (campaign name/notes, lead contact info, promo copy) — universal convention, confirmed again in `bindFileCollection` and `renderClientProfiles`'s templates.
- `CACHE_VER` in sw.js must be bumped by hand on any JS/CSS edit — the pre-commit hook only auto-bumps `window.APP_VERSION`/the `vX.Y.Z` strings in index.html, per CLAUDE.md and confirmed again in the 26/27 briefs.
- Script load order is fixed and load-bearing: config.js → drive.js → notifications.js → departments.js → app.js → modules.js (all deferred, `window.*` globals, no ES modules). A new `window.render*` function for a campaigns/leads-inbox/promotions screen most naturally lives in `js/departments.js` (every other per-department render function does) and must be wired into `app.js`'s `navigateTo` switch plus the nav derivation described above — matching the existing department pattern exactly, per CLAUDE.md's own convention note ("New department screens follow the existing pattern...").
- `sales_clients.create`/`.update` is currently open to "any signed-in user" with no department/role check at all (firestore.rules:1121) — a Marketing-authored write of `stage:'lead'` into `sales_clients` needs ZERO rules changes to function, but this also means the rules today enforce no concept of "who owns this record" or "who is allowed to originate a lead" — that is new territory, not an extension of an already-enforced boundary.
- `budgets_<dept>` write is `isMoneyAdmin()` only (president/manager/finance) regardless of what the client-side `canEdit` gate in `renderBudgeting` shows to plain department members (confirmed pre-existing gap, see Current State) — any campaign-budget feature that reuses `budgets_marketing` inherits this silent-permission-denied gap for any Marketing employee who isn't finance/manager/president, unless it is separately closed.
- No existing "record ownership / handoff" primitive exists in this codebase's rules for CRM-like collections — `sales_clients`/`design_clients`/`bs_clients` rules do not distinguish "Sales owns this, Marketing handed it off," nor does any `ownerDept`/`assignedTo`/`claimedBy` field appear in the CRM shape today. Any handoff/claim semantics WS34 wants are new design, not a rules tweak to an existing enforced pattern.
- Manila-time discipline (`window.bizDate()`/`bizHour()`/`bizDow()`, js/config.js) applies to any campaign start/end date logic, promotions-calendar month anchoring, or follow-up-due comparisons, exactly as it already does for `followUpDate` comparisons in `renderClientProfiles` (`const today = window.bizDate ? window.bizDate() : ...`, departments.js:11085-11097) — never raw `new Date().toISOString()`.

## Open decisions

1. **Campaigns collection shape — new top-level `campaigns` collection, or an extension of the existing `budgets_marketing` budget-line shape?** `renderBudgeting`/`budgets_marketing` already gives Marketing a working budget-line-vs-ledger-actual-spend tracker (departments.js:11475-11530) — a "campaign" could be that same line with `startDate`/`endDate`/`channel` fields bolted on (reusing the existing `budgetLineId`↔`ledger` cross-reference for "actual"), or a wholly separate `campaigns` collection that optionally references a `budgets_marketing` line by id. The former reuses proven plumbing (including its permission gap, decision 9 below); the latter is cleaner conceptually but re-derives spend-tracking from scratch.
2. **Leads inbox — a genuinely new, Marketing-owned collection (e.g. `marketing_leads`), or writes made directly into `sales_clients` with `stage:'lead'` plus a new source/campaign tag?** The latter needs zero rules changes (create is already open to any authed user) and reuses the existing `CRM_STAGES`/`crmStageOf` machinery Sales, Design, and Brilliant Steel already share — but it means Marketing and Sales see the exact same record with no "still in Marketing's inbox, not yet handed off" intermediate state. A separate inbox collection gives Marketing its own unclaimed-lead queue but requires new promote/handoff logic to copy or link into `sales_clients` and a decision on what happens to the Marketing-side record afterward (deleted? marked handed-off? kept in parallel and now un-synced?).
3. **Handoff mechanism — what actually happens when a lead moves from Marketing to Sales?** Candidates on the record: (a) `Notifs.sendToDept('Sales', {...}, {fallbackToOwner:true})` (js/notifications.js:276-303) fires an alert only, record ownership/location doesn't formally change; (b) a claim/assign field (`assignedTo`/`claimedBy`) gets added to whatever collection holds the lead, with rules gating who may set it; (c) both — notify AND write a formal handoff marker. No such ownership-transfer primitive exists anywhere in this codebase today (see Constraints) — this is new design, not a wiring choice between existing options.
4. **Promotions calendar — reuse the `renderMiniCal()` month-grid visual pattern (app.js:7621-7660+), or something else?** No generic, pluggable-data-source calendar component exists in this codebase; both the mini-cal (task due-dates) and the attendance calendar (per WS25/26) are bespoke, single-purpose renderers. Building a promotions calendar means either copying/adapting the mini-cal's month-grid-plus-event-dots pattern for a new data source, or building something unrelated (a simple date-sorted list, a full external calendar embed, etc.) — the level of calendar-UI investment (single-user mini-widget vs. a full department-wide month view with per-promo detail) is undecided.
5. **Materials library — leave the existing Advertising/Marketing Designs `files_advertising`/`files_designs` tabs as the fulfillment of this sub-mandate as-is, or build something campaign-scoped?** As detailed in Current State and flagged explicitly in Risks below, this is the one WS34 sub-feature that is NOT greenfield — Marketing already has a working file library today via the exact mechanism WS38 (Files Hub) intends to eventually unify. Building a NEW, separate materials-library mechanism now (e.g. `files_campaign_<id>` collections, one per campaign) risks becoming throwaway once WS38 lands; treating the existing Advertising/Marketing Designs tabs as "done" for this sub-mandate avoids that, but doesn't give per-campaign scoping (a file can't be tagged "belongs to Campaign X" today, only "belongs to Marketing/Advertising" or "belongs to Marketing/Designs").
6. **Strategy templates ("types of marketing") — static reference content (like the existing `sopPanel` copy-text pattern used throughout departments.js) or a real, editable, stored collection?** No precedent either way exists specifically for "templates" in this codebase; the closest analog is the hardcoded help-content arrays seen elsewhere (e.g. app.js:6215-6217's Leave/KPI help copy) versus a genuine Firestore-backed, admin-editable collection like `marketing_plans`/`marketing_proposals` already are.
7. **Per-campaign insights ("spend vs leads vs quotes vs wins") — what minimum new linking field(s) does this actually require?** As detailed in Current State, no `campaignId` exists on any quote collection, and no reliable `clientId` FK exists from a quote back to `sales_clients` today (client-to-quote linkage is a denormalized `lastQuoteNumber` string plus, per the UI, a probable name/company text match). Making this insight real requires deciding at minimum: does a quote gain a `campaignId` (and if so, is it set manually by the salesperson, like `leadSource` is today, or auto-attributed somehow)? Does `sales_clients` gain a `campaignId`/`leadSource` field of its own (today `leadSource` lives only on quotes, not on the client/lead record)? Without at least one new FK, "insights" can only ever report on Marketing's OWN spend/lead-count, never cross-reference to quotes or wins.
8. **‼️ Sequencing vs Workstream 32 (Sales — Client Relations hub, also unbuilt, V12-PLAN.md:197-198) — should 32 land before 34?** WS32's own mandate is "per-client timeline (quotes, orders, payments, files, follow-ups in one view); CRM stages rolled into win-rate analytics" — i.e. WS32 is the workstream that would define/formalize exactly the CRM-stage-to-win-rate cross-referencing that WS34's "leads → Sales handoff" and "spend vs leads vs quotes vs wins" phrasing implicitly assumes exists. Building WS34's handoff/insights logic against `sales_clients` as it stands today (open write, `stage` field, no formal quote FK) risks re-doing that work once WS32 defines its own (likely more rigorous) client-timeline/win-rate model on the same collection. Flag this for Fable/Neil: does 32 need to land first, in parallel with shared design, or is 34's leads-inbox genuinely independent enough (e.g. if 34 owns its own separate `marketing_leads` collection per decision 2, only the eventual handoff touches `sales_clients` at all) to proceed unblocked?
9. **‼️ Sequencing vs Workstream 38 (Files Hub, also unbuilt, V12-PLAN.md:217-222) — build a throwaway materials-library mechanism now, defer that one sub-feature, or (per decision 5) declare the existing `files_advertising`/`files_designs` tabs sufficient?** This is the dependency explicitly named in WS34's own V12-PLAN.md line ("marketing materials library (Files hub)") — WS38 is described as "Drive-style: one browser over all files; folders/subfolders, drag-drop, grid/list, global file search, previews (img/PDF), versions, recycle bin; share to person/dept/role with view-vs-edit; rides Storage + nightly Drive mirror," which is a materially bigger feature than today's per-scope `files_<scope>` mechanism (no global search, no versions, no recycle bin, no cross-collection browsing exist today). Any WS34 spec that builds NEW campaign-scoped file storage ahead of WS38 should explicitly note it as an interim/throwaway layer WS38 will later absorb or replace, per this brief's instructions.
10. **Access control — which roles/departments may create/edit a campaign, a lead, a promotion?** No existing precedent directly answers this for a brand-new collection; the closest analogs are `canEditDept('Marketing')` (departments.js:17, gates Plan/Proposals today) versus the open-to-any-authed-user pattern on `sales_clients`, versus the money-tier-only pattern on `budgets_<dept>`. Whichever new collection(s) this workstream creates need an explicit choice here, not an inherited default.
11. **Fix the `budgets_<dept>` `isMoneyAdmin()`-vs-`isDeptMember` UI/rules mismatch now, or leave it and route campaign-budget writes through a different, correctly-scoped path?** If campaign budgets reuse `budgets_marketing` (decision 1), this pre-existing gap becomes directly user-facing for Marketing staff the first time WS34 ships; if campaigns get their own collection instead, the gap can be left for a future security pass (note: this exact class of finding — client-side gate wider than the enforced rule — is what WS19 "Security closes" was built to catch and fix elsewhere in the app; this specific instance in `budgets_.*` was not called out by that already-implemented workstream, per grep of its brief).
12. **Reconcile the Marketing chip-tab list with `DEPARTMENTS.Marketing.subtabs` — worth fixing in the same pass, or leave it?** `renderMarketing`'s own chip list hardcodes a 6th "Tasks" tab (departments.js:1960) that is absent from `DEPARTMENTS.Marketing.subtabs` (js/config.js:143, only 5 entries) — a pre-existing, harmless inconsistency (Tasks still renders correctly since `loadMarketingContent` has a `case 'Tasks'`) that a WS34 pass touching this same file could trivially align, or explicitly decide is out of scope.

## Risks / cross-workstream interactions

- ⚠️ **Direct, named dependency on Workstream 38 (Files Hub).** V12-PLAN.md's own line for this workstream parenthetically ties "marketing materials library" to "(Files hub)" — and WS38 does not exist yet (Phase 4 unstarted). As detailed in Current State/Open Decisions, this is NOT a case of building against a moving target from scratch: a working, general per-department file-library mechanism (`files_<scope>`, `renderFileCollection`/`bindFileCollection`) already backs Marketing's Advertising and Marketing Designs tabs today. The real risk is scope-creep in the other direction — building a NEW, campaign-scoped file mechanism now (to get per-campaign granularity the current department-wide `files_<scope>` shape can't express) that WS38 will need to fold into its eventual unified Drive-style browser, doubling the migration work. Whatever Fable decides here should explicitly flag which parts (if any) are interim/throwaway pending WS38.
- ⚠️ **Direct, named dependency on Workstream 32 (Sales — Client Relations hub).** WS34's "leads inbox → Sales handoff" and "per-campaign insights (spend vs leads vs quotes vs wins)" both implicitly assume a settled, richer CRM-stage/win-rate model that WS32 is the workstream actually chartered to build ("CRM stages rolled into win-rate analytics," V12-PLAN.md:197-198). Building WS34's handoff logic against today's bare `sales_clients` shape (open write, four flat stages, no quote FK) risks needing rework the moment WS32 formalizes ownership, stage transitions, or win-rate computation on the same collection. This is a real sequencing question for Fable/Neil, not a decided fact — see Open Decision 8.
- ⚠️ **No FK between quotes and clients/campaigns today** — `getAllQuotes()`'s merge (app.js:2048-2060) and the `sales_clients`/`bs_clients`/`design_clients` CRM shape share no formal `clientId`/`campaignId` linkage; client-to-quote association today is a denormalized `lastQuoteNumber` string plus (per the UI's own "View quotes / reopen" copy) a likely name/company text match. "Per-campaign insights" cannot be built as a read-only rollup over existing data — it requires new write-time linking fields on at least one of {quotes, sales_clients, a new campaigns/leads collection}, which in turn means touching the quote-builder bridge (app.js:8130-8165) and/or the Brilliant Steel quote-number generator (departments.js:8630-8660), both of which are also live, in-production write paths other workstreams (31 "Quotation builder v3," explicitly slated to "repair the quote→approval→order chain") may also be touching.
- ⚠️ **`budgets_<dept>` write-rule (`isMoneyAdmin()`) is narrower than its own UI's edit-gate (`isDeptMember`)** — a confirmed, pre-existing mismatch (see Current State/Open Decision 11) that any campaign-budget feature reusing this collection inherits verbatim: a Marketing employee (not finance/manager/president) will see "+ Budget Line"/"Log Expense" buttons that silently fail against firestore.rules. This is exactly the class of bug WS19 ("Security closes") was built to hunt down elsewhere in the app, but WS19's own brief (per grep) did not call out this specific instance.
- ⚠️ **`sales_clients.create`/`.update` has no department/role check at all** (firestore.rules:1121, "any signed-in user") — convenient for a zero-rules-change lead-write path (Open Decision 2), but it also means nothing today stops a non-Marketing, non-Sales role from creating or editing a "lead" record; if WS34 wants Marketing-only (or Marketing-and-Sales-only) write access on whatever collection actually holds leads, that is a NEW access boundary to design and enforce, not an extension of an already-enforced one.
- ⚠️ **Sibling Workstream 33 (AEC Partner Directory) is the nearest structural precedent for "spin up one brand-new literal-named collection + rules + backup for a directory-ish feature"** (V12-PLAN.md:199-203, "New `aec_contacts` collection + rules + backup") — if WS33 lands first, whatever collection/rules/backup pattern it settles on (table shape, filter/CSV/print conventions) is worth deliberately mirroring for consistency in any new WS34 collection (campaigns, leads, promotions), rather than the two workstreams independently inventing slightly different conventions for structurally similar "new business-object collection" problems.
- ⚠️ **The existing Marketing chip-tab / `DEPARTMENTS.subtabs` mismatch** (Open Decision 12) is low-stakes on its own, but any WS34 change that ADDS new subtabs (Campaigns, Leads, Promotions Calendar, Insights) to Marketing's `chipTabs` call (departments.js:1960) should also update `DEPARTMENTS.Marketing.subtabs` (js/config.js:143) in the same commit, or the drift between the two lists — already present for "Tasks" — gets worse with every new tab added.

## Files likely touched

`js/config.js` (`DEPARTMENTS.Marketing` at 141-143 — new subtabs for Campaigns/Leads/Promotions/Insights, kept in sync with whatever `renderMarketing`'s chip list becomes), `js/departments.js` (`window.renderMarketing`/`loadMarketingContent` at 1951-1990 — new tab cases; `renderBudgeting` at 11475-11530+ and the `budgets_.*` rule if campaigns extend the existing budget-line shape; `CRM_STAGES`/`crmStageOf`/`crmStageMeta` at 11074-11081 and `renderClientProfiles` at 11081-11267+ if leads write into or read from `sales_clients`; `renderFileCollection`/`bindFileCollection` at 11679-11827 if materials-library scoping changes; likely a new `window.renderCampaigns`/`window.renderLeadsInbox`/`window.renderPromoCalendar` following the existing per-department render-function pattern), `js/app.js` (`navigateTo` switch around 3629 for any new Marketing sub-page routes; `getAllQuotes()` at 2048-2060 and the quote-builder iframe bridge at 8130-8165 if quotes gain a `campaignId`/richer `leadSource`; `renderMiniCal()` at 7621-7660+ if the promotions calendar reuses/adapts its month-grid pattern), `js/notifications.js` (`Notifs.sendToDept` at 276-303, if used unmodified for the Sales handoff — likely no changes needed, just a new call site), `firestore.rules` (new explicit match block(s) for whatever new literal-named collection(s) this workstream introduces — campaigns/leads/promotions/insights; possibly the `sales_clients` block at 1121 if leads write there with new fields; possibly the `budgets_.*` write rule at 1147-1157 if Open Decision 11 is resolved to fix the `isMoneyAdmin()`/`isDeptMember` gap), `sw.js` (`CACHE_VER` bump, required on any JS/CSS edit per repo convention).

## Expected deliverable format

> A numbered build spec Sonnet can execute without further judgment calls: one, the exact decision made for each open decision above, stated as a one-line policy (e.g. "leads inbox = new `marketing_leads` collection, promoted into `sales_clients` on handoff via a Cloud-Function-free client-side copy" or "campaigns = extended `budgets_marketing` line shape, no new collection"). Two, the exact new or changed Firestore document shapes — field name, type, default — for every collection this workstream touches or creates (campaigns, leads/inbox, promotions, insights cache if any), plus a literal `firestore.rules` diff, before-and-after blocks in the same comment-then-match style as the existing rules file, for every collection touched, explicitly NOT reusing the `files_.*`/`budgets_.*` wildcard pattern for any new literal-named collection. Three, exact function signatures and before/after code blocks: the new `window.render*` screen(s) wired into `navigateTo` and `DEPARTMENTS.Marketing.subtabs`/`renderMarketing`'s chip list in the same commit; the exact handoff call (e.g. the precise `Notifs.sendToDept('Sales', {...})` invocation and, if decided, the exact write that transfers or links a lead into `sales_clients`); and, if per-campaign insights are in scope, the exact new field(s) added to the quote-builder bridge (app.js:8130-8165) and/or Brilliant Steel quote-number generator (departments.js:8630-8660) that let a quote be attributed back to a campaign/lead-source in a queryable (not string-baked) way. Four, an explicit sequencing note addressing Open Decisions 8 and 9 head-on: whether this spec assumes WS32 and/or WS38 land first, ships fully independent of both with an explicitly-labeled interim mechanism, or takes some hybrid (e.g. independent leads collection now, formal Sales handoff deferred until WS32 defines client ownership). Five, a numbered migration/rollout checklist in dependency order, explicit about which steps are safe to ship standalone versus which are throwaway/interim pending WS32 or WS38. Six, if the `budgets_<dept>` `isMoneyAdmin()`/`isDeptMember` mismatch (Open Decision 11) is being fixed as part of this workstream, the exact rules diff and which roles the new campaign-budget write path should actually permit.


## DECIDED — architecture spec (Fable, 2026-07-11)

> **Binding upstream contracts (do not re-decide):** WS32's `## DECIDED` Spec 11 pins WS34's lead
> and attribution model — the leads inbox WRITES `clients` docs (`stage:'lead'`, `brands:['sales']`,
> plus reserved additive fields `campaignId`/`source`); campaign→quote attribution =
> `clients.campaignId` + `quote.clientId` joined through `Clients.quotesFor` (never a new
> name-match); wins = `window.isQuoteWon`. WS38's `## DECIDED` "CONTRACT for WS34/WS35" pins the
> materials library — file metadata in `hub_files` (WS34 uses `scope:'materials'`), folders in
> `hub_folders`, Storage path `${department}/Files/…` via `Drive.renderUploadArea({dept,'subfolder':'Files'})`,
> all mutations through `window.FilesHub.*`. Everything below builds on those two contracts.

### Resolved decisions (numbered to match the Open Decisions above)

1. **Campaigns → NEW literal-named top-level `campaigns` collection; actual spend is READ through the existing `budgets_marketing`↔`ledger` plumbing via an optional `budgetLineId` link — campaigns do NOT extend the budget-line shape.** A campaign doc carries its own `budget` (planned ₱), dates, channels, status; if a money-admin links it to a `budgets_marketing` line (`budgetLineId`), "actual spend" is the exact same live client-side ledger filter `renderBudgeting` already computes (`dept==='Marketing' && budgetLineId===<lineId> && ledgerKind(e)==='expense'`, departments.js:11500-11503) — zero new spend-tracking mechanism, zero `ledger` schema change. Rejected: extending `budgets_marketing` lines (would trap campaign CRUD behind the `isMoneyAdmin()` wildcard write rule and stretch a money collection into a content-planning one); a `campaignId` field on `ledger` (touches finance write paths WS20/WS36 own).
2. **Leads inbox → NO new collection. Marketing lead capture writes `clients` docs directly (per WS32 Spec 11), with three additive Marketing-owned fields: `leadOrigin:'marketing'`, `source:<LEAD_SOURCES code>`, `campaignId:<campaigns docId>|null`.** The "inbox" is a filtered view over `Clients.listAll({brand:'sales'})` — `leadOrigin==='marketing' && !handedOffAt` = awaiting handoff; `handedOffAt` set = handed off. One human = one doc survives: Sales sees the same record in its CRM the moment it's captured (that is WS32's whole point); the inbox is a Marketing-side lens, not a second copy. Dedupe on capture via `Clients.findByName` (nameKey) — an existing client gets `source`/`campaignId` merged in (first-touch: never overwrite an existing `campaignId`), not duplicated.
3. **Handoff = marker + notification, no ownership transfer (there is nothing to transfer — the record is already shared).** "→ Send to Sales" sets `handedOffAt/handedOffBy/handedOffByName` on the client doc, appends a `contactLog` entry (WS32's array — reused, not a parallel log), and fires `Notifs.sendToDept('Sales', {…}, {fallbackToOwner:true})` (js/notifications.js:276-303, used verbatim, zero notification-plumbing changes). No `assignedTo`/claim field: WS32 deliberately has no per-record ownership in `clients` rules, and inventing one here would front-run any future Sales-side assignment feature. Handoff is idempotent by UI (button renders only while `!handedOffAt`).
4. **Promotions calendar → NEW `promotions` collection + a bespoke month-grid renderer that copies `renderMiniCal`'s visual pattern (app.js:7621+: 7-column grid, `‹`/`›` month nav, per-day event dots) with `promotions` as the data source, plus a date-sorted list of the visible month's promos below the grid.** No attempt to build a generic pluggable calendar component (three bespoke calendars already coexist; a fourth generic one is WS-later scope creep). Month anchoring via `bizDate()` (Manila), same as miniCal.
5. **Materials library → the department-wide mandate is ALREADY satisfied by the Advertising/Marketing Designs tabs, which WS38 migrates onto `hub_files` (scopes `advertising`/`designs`) with zero WS34 work. WS34 adds the per-CAMPAIGN granularity the old `files_<scope>` shape couldn't express: one `hub_folders` doc per campaign under `scope:'materials'` (deterministic id `materials__<campaignId>`, extra `campaignId` field — the Hub ignores unknown fields per the WS38 contract), and a "📁 Materials" panel inside the campaign detail modal that lists/uploads `hub_files` docs with `scope:'materials'`, `folderId:'materials__<campaignId>'`.** Nothing throwaway: no new collection, no new storage path, no new rules — it's ordinary Hub data. Pre-WS38 the panel degrades to a "Materials arrive with the Files Hub" placeholder (`typeof window.FilesHub === 'undefined'` check).
6. **Strategy templates → a REAL editable collection `marketing_templates`, rendered by the existing generic `window.renderDocCollection` (the live departments.js:11852 version — exactly how Plan/Proposals already work, zero new renderer), under a new "Strategy" chip; plus a static `sopPanel` above it listing the standard types of marketing as reference copy.** Hardcoded-only was rejected (the mandate says "templates" — Marketing must be able to add/edit its own playbooks); a bespoke renderer was rejected (renderDocCollection's `{title, description, status, fileUrl}` shape is a perfect fit).
7. **Per-campaign insights → ZERO new linking fields beyond WS32's. Attribution chain: `campaigns.id ← clients.campaignId` (leads) and `clients ← quotes` via `Clients.quotesFor(client, allQuotes)` (which is `quote.clientId === client.id` OR nameKey fallback — WS32's canonical join).** Quotes do NOT gain a `campaignId`; the quote-builder bridge (app.js:8130-8165) and the BS quote-number generator (departments.js:8630-8660) are NOT touched — both are WS31's live write paths, and WS32 already provides everything attribution needs. Insights = a live-computed table (no insights-cache collection): per campaign — Leads (clients w/ `campaignId`), Quotes/Quoted ₱ (union of `quotesFor` over those clients), Wins/Won ₱ (`isQuoteWon`), Spend (ledger via `budgetLineId`, decision 1), CPL (spend/leads). All reads through cached fetchers (`'clients'`, `'all-quotes'`, new `'campaigns'` + `'ledger-marketing'` keys — WS16 discipline).
8. **Sequencing vs WS32 → HARD dependency, WS32 lands first (WS32's own decision 13 already ordered it first).** This spec assumes shipped: the `clients` collection + rules, `window.Clients` (listAll/findByName/quotesFor/nameKey), `window.CRM_STAGES/crmStageOf/crmStageMeta` exports, `window.isQuoteWon/isQuoteLost/isQuoteOpen`, and the `'clients'` cache key. Nothing in WS34 writes to `sales_clients` (frozen archive post-WS32). If WS34 is attempted before WS32's migration has run, the Leads tab must show a "run the client-book unification first" banner (Spec 6 handles this via `Clients.listAll`'s `_legacy` flag).
9. **Sequencing vs WS38 → SOFT dependency, split shipping. Phase A (campaigns, leads, promos, insights, strategy, budget-gate fix) ships right after WS32 with no WS38 requirement. Phase B (the campaign Materials panel, Spec 5c) ships with/after WS38 and is the ONLY WS38-coupled piece** — it is 100% contract-conformant Hub data, explicitly not interim/throwaway. The existing Advertising/Designs tabs need no WS34 edits in either phase (WS38's rewritten `bindFileCollection` re-backs them transparently).
10. **Access control → UI gate `canEditDept('Marketing')` (same as Plan/Proposals today); rules gate `canDept('Marketing')` (the EXISTING helper at firestore.rules:72-76, already the enforced pattern for `marketing_plans`/`marketing_proposals`/IT/gov collections).** All three new collections (`campaigns`, `promotions`, `marketing_templates`) use it: read = any internal staff (`!isPartner()`), create/update = `canDept('Marketing')` (+ createdBy/shape guards on create), delete = **admin-only** for `campaigns` (deleting one orphans every `clients.campaignId` pointing at it — use `status:'cancelled'` instead) and for consistency also `promotions`/`marketing_templates` deletes follow the write clause like `marketing_plans` does — see the exact blocks in Spec 2. Rejected: open-to-any-authed (the `sales_clients` legacy hole WS32 just closed) and money-tier-only (campaign planning is content work, not money movement).
11. **`budgets_<dept>` mismatch → FIX IT NOW, in the direction the code's own intent comment points (departments.js:11479-11480: "Dept members … can still … edit budget allocations"): new budget lines get a `dept` field stamped at create, and the wildcard write rule widens to `isMoneyAdmin() OR (internal staff AND inDept(<the doc's dept field>))`.** Legacy lines (no `dept` field) stay money-admin-editable only — `.get('dept','')` fails `inDept('')` safely, no backfill required. Separately, the "📤 Log Expense / Income" button gets client-gated to `canFinance`-tier roles (it writes `ledger`, which stays `canFinance()` in rules — a dept member's click today is a guaranteed silent deny). Exact diffs in Spec 9. ‼️ FLAG FOR NEIL (below) to confirm dept members managing their own allocation lines is intended.
12. **Chip-tab drift → fixed structurally: `renderMarketing`'s chip list is DERIVED from `DEPARTMENTS.Marketing.subtabs` (one source of truth), and `'Tasks'` is added to the config array where it always belonged.** Final tab order (both places, automatically in sync forever): `['Campaigns','Leads','Promos','Insights','Advertising','Marketing Designs','Plan','Strategy','Budgeting','Proposals','Tasks']`. Default landing subtab changes `'Advertising'` → `'Campaigns'` (‼️ flagged).

**Scoping / sequencing:** requires **WS32 shipped** (hard, decision 8); Materials panel requires **WS38 shipped** (soft, decision 9, Phase B); no dependency on WS31/33/35/36 — but per WS32's Spec 11, WS33 must reuse `CRM_STAGES`/`clientId` (not WS34's concern to enforce), and WS31 must preserve `quote.clientId` stamping, which insights silently depends on for post-WS31 quotes. No Cloud Function, no storage.rules change, no new script file (no index.html/PRECACHE edits), no composite indexes (every new query is single-field or full-collection-get; verified per query in Specs 5-8).

---

### Spec 1 — Data shapes (annotated literals)

```js
// campaigns/{docId} — NEW root collection (literal name → own rules block, own backup
// auto-discovery; NOT files_*/budgets_*-prefixed, so the wildcard never touches it).
{ name: 'Q3 High-Pressure Stove Push',   // string, required (rules-guarded non-empty)
  description: '',                        // objective / notes, optional
  channels: ['FB','IG','EX'],             // array of LEAD_SOURCES codes (Spec 3) — multi-select
  status: 'active',                       // 'planned'|'active'|'done'|'cancelled' (rules-guarded enum)
  startDate: '2026-07-01',                // 'YYYY-MM-DD' (Manila; compare against bizDate())
  endDate: '2026-09-30',                  // 'YYYY-MM-DD', >= startDate (client-validated)
  budget: 50000,                          // number ≥ 0 — PLANNED spend (display only)
  budgetLineId: null,                     // string|null — optional link to a budgets_marketing
                                          //   line docId; when set, ACTUAL spend = the existing
                                          //   ledger filter (decision 1). Set via the campaign
                                          //   modal's line-picker (visible to money-tier only).
  createdBy:'<uid>', createdByName:'…', createdAt: serverTimestamp, updatedAt: serverTimestamp }

// promotions/{docId} — NEW root collection (calendar entries; may or may not belong to a campaign)
{ title: '10% off double-burner ranges',  // string, required
  startDate: '2026-07-15', endDate: '2026-07-31',   // 'YYYY-MM-DD' inclusive range
  channel: 'FB',                          // ONE LEAD_SOURCES code ('' allowed = unspecified)
  campaignId: null,                       // string|null — optional campaigns docId
  notes: '',
  createdBy:'<uid>', createdByName:'…', createdAt: serverTimestamp, updatedAt: serverTimestamp }

// marketing_templates/{docId} — NEW root collection, renderDocCollection shape (same as
// marketing_plans/marketing_proposals): { title, description, status:'active', fileUrl?, fileName?,
// addedBy, createdAt } — written entirely by the existing generic renderer, nothing custom.

// clients/{id} — WS32's collection; WS34 adds FOUR additive, optional fields (all reserved by
// WS32 Spec 11's "campaignId/source … additive" clause; no rules change needed — the existing
// non-empty-name guard is the only shape rule):
{ ...WS32 Spec-1 shape...,
  leadOrigin: 'marketing',                // present ⇢ captured via the Marketing inbox form
  source: 'FB',                           // LEAD_SOURCES code (the BS 2-letter vocabulary, Spec 3)
  campaignId: '<campaigns docId>'|null,   // first-touch attribution — NEVER overwritten once set
  handedOffAt: Timestamp|null,            // set by "→ Send to Sales"; null/absent = still in inbox
  handedOffBy: '<uid>', handedOffByName: '…' }

// hub_folders/{materials__<campaignId>} — WS38 shape + one domain field (contract-allowed)
{ name: '<campaign name>', parentId: null, scope: 'materials', department: 'Marketing',
  campaignId: '<campaigns docId>',        // WS34 domain field; the Hub ignores it
  createdBy:'<uid>', createdByName:'…', createdAt: serverTimestamp }

// hub_files docs written by the Materials panel use WS38 Spec-1 EXACTLY, with
// scope:'materials', department:'Marketing', folderId:'materials__<campaignId>'.

// budgets_<dept>/{docId} — ONE new field on NEW lines only (decision 11; no backfill):
{ name, budget, createdAt, dept: 'Marketing' }   // dept = the literal DEPARTMENTS key
```

Backup: `campaigns`/`promotions`/`marketing_templates` are root collections → auto-discovered by `scripts/monthly-backup.js` (zero registration). Drive sync: none of the three stores Storage URLs (`marketing_templates.fileUrl` CAN hold one via renderDocCollection's upload — the generic walker auto-mirrors it; `labelFor`'s `titleCase` fallback gives a "Marketing Templates" Drive folder, acceptable, no `LABELS` entry needed).

### Spec 2 — firestore.rules diff (new blocks + one wildcard edit)

**2a — three NEW blocks.** Insert immediately after the `marketing_proposals` block (firestore.rules:761-764), same comment-then-match style; uses the EXISTING `canDept()` helper (firestore.rules:76):

```
    // ── Marketing suite (v12 WS34): campaigns, promotions calendar, strategy
    // templates. Literal-named root collections (the files_*/budgets_* wildcard
    // deliberately does not apply). Read = internal staff; write = Marketing
    // members or admins (canDept, same pattern as marketing_plans above).
    // .get(field, default) everywhere per the missing-field-throws memory.
    match /campaigns/{docId} {
      allow read: if isAuth() && !isPartner();
      allow create: if isAuth() && canDept('Marketing')
        && request.resource.data.get('name', '') != ''
        && request.resource.data.get('status', 'planned') in ['planned','active','done','cancelled']
        && request.resource.data.get('budget', 0) is number
        && request.resource.data.get('budget', 0) >= 0
        && request.resource.data.get('createdBy', '') == request.auth.uid;
      allow update: if isAuth() && canDept('Marketing')
        && request.resource.data.get('status', 'planned') in ['planned','active','done','cancelled']
        && request.resource.data.get('budget', 0) is number
        && request.resource.data.get('budget', 0) >= 0;
      // Delete is admin-only: clients.campaignId points here — cancel, don't delete.
      allow delete: if isAuth() && isAdmin();
    }
    match /promotions/{docId} {
      allow read: if isAuth() && !isPartner();
      allow create: if isAuth() && canDept('Marketing')
        && request.resource.data.get('title', '') != ''
        && request.resource.data.get('createdBy', '') == request.auth.uid;
      allow update, delete: if isAuth() && canDept('Marketing');
    }
    match /marketing_templates/{docId} {
      allow read: if isAuth() && !isPartner();
      allow write: if isAuth() && canDept('Marketing');
    }
```

**2b — `budgets_.*` wildcard write widened (decision 11).** firestore.rules:1150-1157 BEFORE → AFTER (the `files_.*` half of the wildcard section and the read clause are untouched):

```
// BEFORE (write clause)
      allow write: if isAuth() && coll.matches('budgets_.*') && isMoneyAdmin();
// AFTER — money tier as before, OR an internal member of the dept stamped on the
// doc. Legacy lines have no `dept` field → .get('dept','') → inDept('') is false
// → they stay money-admin-only (no backfill needed). Create checks the incoming
// doc; update/delete check the existing doc (so a member can't re-dept a line).
      allow create: if isAuth() && coll.matches('budgets_.*')
        && ( isMoneyAdmin()
          || (!isPartner() && inDept(request.resource.data.get('dept',''))) );
      allow update, delete: if isAuth() && coll.matches('budgets_.*')
        && ( isMoneyAdmin()
          || (!isPartner() && inDept(resource.data.get('dept',''))) );
```

**No `clients` rules change** (WS32's block already admits the additive fields — its only shape guard is non-empty name). **No storage.rules change** (Materials uses WS38's existing two-segment path). Deploy: `~/.npm-global/bin/firebase deploy --only firestore:rules`, after a fresh `git diff firestore.rules` (concurrent-session memory); block-scoped Edits only, never a full-file replace.

### Spec 3 — js/config.js changes

**3a — `DEPARTMENTS.Marketing.subtabs` (config.js:143) BEFORE → AFTER:**
```js
// BEFORE
    subtabs: ['Advertising', 'Marketing Designs', 'Plan', 'Budgeting', 'Proposals'], navOrder: 4
// AFTER  (adds the 4 new WS34 tabs + Strategy, and 'Tasks' which renderMarketing
// always rendered but config never listed — the chip list now derives from THIS array)
    subtabs: ['Campaigns', 'Leads', 'Promos', 'Insights', 'Advertising', 'Marketing Designs',
              'Plan', 'Strategy', 'Budgeting', 'Proposals', 'Tasks'], navOrder: 4
```

**3b — shared lead-source vocabulary** (insert near the other shared constants; config.js loads before every caller). This is the SAME nine-code vocabulary the BS quote-number generator already bakes into quote numbers (departments.js:8630-8660) — now a queryable constant instead of a string fragment. The BS generator itself is NOT modified (WS31 territory); it can be pointed at this constant later.
```js
// ── Lead-source vocabulary (v12 WS34) — mirrors the BS quote-number codes ──
window.LEAD_SOURCES = [
  { code:'FB', label:'Facebook'   }, { code:'IG', label:'Instagram' },
  { code:'TK', label:'TikTok'     }, { code:'WB', label:'Website'   },
  { code:'VB', label:'Viber'      }, { code:'EM', label:'Email'     },
  { code:'OF', label:'In-Office'  }, { code:'RF', label:'Referral'  },
  { code:'EX', label:'Exhibition' },
];
window.leadSourceLabel = code =>
  (window.LEAD_SOURCES.find(s => s.code === code) || {}).label || code || '—';
```

### Spec 4 — `renderMarketing` / `loadMarketingContent` rewiring (departments.js:1951-1992)

**4a — `renderMarketing` BEFORE → AFTER** (chips derive from config — kills the drift class; default subtab → Campaigns; sopPanel copy refreshed):
```js
// BEFORE: window.renderMarketing = async function(currentUser, currentRole, subtab = 'Advertising') {
//   …hardcoded chipTabs(['Advertising','Marketing Designs','Plan','Budgeting','Proposals','Tasks']…)
// AFTER:
window.renderMarketing = async function(currentUser, currentRole, subtab = 'Campaigns') {
  const c = deptContainer();
  const tabs = (window.DEPARTMENTS?.Marketing?.subtabs) ||
    ['Campaigns','Leads','Promos','Insights','Advertising','Marketing Designs','Plan','Strategy','Budgeting','Proposals','Tasks'];
  c.innerHTML = `
    <div class="page-header"><h2>📢 Marketing</h2></div>
    ${window.sopPanel('How Marketing works', [
      'Campaigns tracks each push: budget vs actual, dates, channels, and its materials.',
      'Leads is the capture inbox — new prospects land here, then hand off to Sales.',
      'Promos is the promotions calendar; Insights shows spend vs leads vs quotes vs wins.',
      'Advertising and Marketing Designs hold the creative asset libraries.',
      'Plan, Strategy and Proposals store playbooks and pitches; Tasks is the department board.'
    ])}
    ${window.chipTabs(tabs.map(s => ({ key:s, label:s })), subtab)}
    <div id="mkt-content"><div class="loading-placeholder">Loading…</div></div>
  `;
  loadMarketingContent(currentUser, currentRole, subtab);
  window.bindChipTabs(c, (key) => loadMarketingContent(currentUser, currentRole, key));
};
```

**4b — `loadMarketingContent`: FIVE new cases** (existing six cases unchanged; insert before `case 'Advertising'`):
```js
    case 'Campaigns': await renderMktCampaigns(content, currentUser, currentRole); break;
    case 'Leads':     await renderMktLeads(content, currentUser, currentRole); break;
    case 'Promos':    await renderMktPromos(content, currentUser, currentRole); break;
    case 'Insights':  await renderMktInsights(content, currentUser, currentRole); break;
    case 'Strategy':
      content.innerHTML = window.sopPanel('Types of marketing (reference)', [
        'Digital: social (FB/IG/TikTok), search, email, website content.',
        'Field: exhibitions, in-office walk-ins, dealer visits, referral programs.',
        'Trade: distributor co-marketing, government-bid positioning, partner catalogues.'
      ]) + '<div id="mkt-strategy"></div>';
      await renderDocCollection(document.getElementById('mkt-strategy'), 'marketing_templates',
        'Strategy Templates', currentUser, currentRole, { icon:'🧭', color:'#880e4f', dept:'Marketing' });
      break;
```
No `navigateTo` change in app.js: every new screen is a subtab of the existing `case 'Marketing'` route. No nav-array change beyond 3a.

### Spec 5 — Campaigns screen (NEW `renderMktCampaigns` + modal, departments.js, place directly after `loadMarketingContent`)

**5a — list.** Reads via a new cached key `'campaigns'` (60s, invalidate on every write):
```js
async function fetchCampaigns() {
  const snap = await (typeof dbCachedGet === 'function'
    ? dbCachedGet('campaigns', () => db.collection('campaigns').orderBy('createdAt','desc').get().catch(()=>({docs:[]})), 60000)
    : db.collection('campaigns').orderBy('createdAt','desc').get().catch(()=>({docs:[]})));
  return snap.docs.map(d => ({ id:d.id, ...d.data() }));
}
async function renderMktCampaigns(content, currentUser, currentRole) {
  const canEdit = canEditDept('Marketing');
  const camps = await fetchCampaigns();
  const today = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10);
  const stBadge = c0 => ({ planned:['badge-gray','🗓 Planned'], active:['badge-green','▶ Active'],
    done:['badge-blue','✔ Done'], cancelled:['badge-red','✖ Cancelled'] })[c0.status] || ['badge-gray', c0.status||'—'];
  content.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="font-size:14px;margin:0">📣 Campaigns (${camps.length})</h3>
      ${canEdit ? `<button class="btn-primary btn-sm" id="mkt-camp-add">＋ New Campaign</button>` : ''}
    </div>
    ${!camps.length ? `<div class="empty-state"><div class="empty-icon">📣</div><p>No campaigns yet.</p></div>`
      : `<div style="display:flex;flex-direction:column;gap:8px">${camps.map(c0 => { const [bc,bl]=stBadge(c0); return `
        <div class="item-card mkt-camp-row" data-id="${c0.id}" style="cursor:pointer">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
            <div style="min-width:0">
              <div style="font-weight:700;font-size:13px">${escHtml(c0.name||'')}
                <span class="badge ${bc}" style="font-size:9px">${bl}</span>
                ${(c0.endDate && c0.endDate < today && c0.status==='active') ? '<span class="badge badge-amber" style="font-size:9px">past end date</span>' : ''}</div>
              <div class="item-meta">
                <span>📅 ${escHtml(c0.startDate||'—')} → ${escHtml(c0.endDate||'—')}</span>
                ${(c0.channels||[]).length ? `<span>📡 ${c0.channels.map(ch=>escHtml(window.leadSourceLabel(ch))).join(', ')}</span>` : ''}
              </div>
            </div>
            <div style="font-size:12px;flex-shrink:0;text-align:right">Budget<br><strong>₱${fmt(c0.budget||0)}</strong></div>
          </div>
        </div>`; }).join('')}</div>`}
  `;
  document.getElementById('mkt-camp-add')?.addEventListener('click', () =>
    openCampaignModal(null, () => renderMktCampaigns(content, currentUser, currentRole)));
  content.querySelectorAll('.mkt-camp-row').forEach(row => row.addEventListener('click', () =>
    openCampaignModal(camps.find(x => x.id === row.dataset.id), () => renderMktCampaigns(content, currentUser, currentRole))));
}
```

**5b — `openCampaignModal(camp, onChange)`** — one modal for create/edit/detail. Form fields: name (required), description, start/end date inputs (validate `end >= start` client-side), status select, budget number (`Math.max(0, …)`), channels = LEAD_SOURCES checkbox chips. **Budget-line picker** (money-tier only — `['president','owner','manager','finance'].includes(currentRole)`): a `<select id="mc-line">` filled from `db.collection('budgets_marketing').get()` (readable by all internal staff) with a "— none —" option, saving `budgetLineId`. Detail extras when `camp` exists and viewer is money-tier: an "Actual spend" line computed with the exact `renderBudgeting` filter (`db.collection('ledger').where('dept','==','Marketing')` via a shared cached key `'ledger-marketing'` (60s), then `e.budgetLineId===camp.budgetLineId && ledgerKind(e)==='expense'`), rendered as `₱spent / ₱budget` with an over-budget red highlight; non-money viewers see `— (finance-visible)` — never a misleading ₱0 (same rationale as `canSeeSpend`, departments.js:11482-11485). Save writes the Spec-1 shape (`createdBy/createdByName/createdAt` on create only; `updatedAt` always), then `dbCacheInvalidate('campaigns')`, toast, `onChange()`. All user strings `escHtml`'d.

**5c — Materials panel (Phase B, inside the same modal below the detail body):**
```js
// Inside openCampaignModal, after the detail body renders and only when editing an existing camp:
if (camp && typeof window.FilesHub !== 'undefined') {
  const folderId = `materials__${camp.id}`;
  // Ensure the campaign's hub folder exists (deterministic id ⇒ idempotent; set = create-once)
  await db.collection('hub_folders').doc(folderId).set({
    name: camp.name || 'Campaign', parentId: null, scope: 'materials', department: 'Marketing',
    campaignId: camp.id, createdBy: currentUser.uid,
    createdByName: (userProfile?.displayName || currentUser.email),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true }).catch(()=>{});
  const files = (await FilesHub.loadFiles('materials')).filter(f => f.folderId === folderId);
  // Render: "📁 Materials (N)" list — name (escHtml) + 👁 preview (openFilePreview(f)) +
  // 🗑 soft-delete (FilesHub.softDelete, shown when FilesHub.canEdit(f)); below it, when
  // canEditDept('Marketing'), an upload area:
  Drive.renderUploadArea('mc-mat-upload', async (result, file) => {
    const FV = firebase.firestore.FieldValue, nowIso = new Date().toISOString();
    await db.collection('hub_files').add({            // WS38 Spec-1 shape, verbatim
      name: result.name, description: '', fileType: 'Other',
      kind: result.source === 'link' ? 'link' : 'file',
      scope: 'materials', department: 'Marketing', folderId,
      url: result.url, driveUrl: null,
      size: file?.size || null, contentType: file?.type || null,
      source: result.source || 'firebase', currentV: 1,
      versions: [{ v:1, url:result.url, name:result.name, size:file?.size||null,
        contentType:file?.type||null, note:'', by:currentUser.uid,
        byName:(userProfile?.displayName||currentUser.email), at: nowIso }],
      archived:false, deleted:false, deletedAt:null, deletedBy:null,
      visibility:'company', sharedUserIds:[], editorUserIds:[], shares:[],
      uploadedBy: currentUser.uid, uploaderName:(userProfile?.displayName||currentUser.email),
      createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() });
    Notifs.showToast('Material added'); /* re-render the panel */
  }, { dept:'Marketing', subfolder:'Files', allowLinks:true });
} else if (camp) {
  // Phase-A placeholder: '📁 Materials arrive with the Files Hub (WS38).'
}
```
(Uploads use the contract Storage path `Marketing/Files/…` — covered by the existing storage.rules catch-all; the nightly sync auto-mirrors via the WS38 `LABELS` entry. No WS34 sync/backup work.)

### Spec 6 — Leads inbox (NEW `renderMktLeads` + capture modal + handoff)

```js
async function renderMktLeads(content, currentUser, currentRole) {
  const canEdit = canEditDept('Marketing');
  const all = await window.Clients.listAll({ brand: 'sales' });      // cached 'clients' key (WS32)
  if (all.some(c => c._legacy)) {                                     // WS32 migration not yet run
    content.innerHTML = `<div class="alert-banner alert-warn">🧭 Run the client-book unification (Sales → Clients) before using the Leads inbox.</div>`;
    return;
  }
  const camps = await fetchCampaigns();
  const campName = id => escHtml((camps.find(c0 => c0.id === id) || {}).name || '');
  const mine = all.filter(c0 => c0.leadOrigin === 'marketing');
  const inbox = mine.filter(c0 => !c0.handedOffAt);
  const handed = mine.filter(c0 => !!c0.handedOffAt);
  const row = (c0, showHandoff) => `
    <div class="item-card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
        <div style="min-width:0">
          <div style="font-weight:700;font-size:13px">${escHtml(c0.name||'')}
            <span class="badge badge-gray" style="font-size:9px">${escHtml(window.leadSourceLabel(c0.source))}</span>
            ${c0.campaignId ? `<span class="badge badge-blue" style="font-size:9px">📣 ${campName(c0.campaignId)}</span>` : ''}
            ${(() => { const st = crmStageMeta(crmStageOf(c0)); return `<span class="badge" style="font-size:9px;background:${st.color};color:#fff">${st.icon} ${st.label}</span>`; })()}</div>
          <div class="item-meta">
            ${c0.company ? `<span>🏢 ${escHtml(c0.company)}</span>` : ''}
            ${c0.phone ? `<span>📞 ${escHtml(c0.phone)}</span>` : ''}
            ${c0.email ? `<span>✉️ ${escHtml(c0.email)}</span>` : ''}
          </div>
        </div>
        ${showHandoff && canEdit ? `<button class="btn-primary btn-sm mkt-lead-handoff" data-id="${c0.id}">→ Send to Sales</button>` : ''}
      </div>
    </div>`;
  content.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="font-size:14px;margin:0">📥 Leads Inbox (${inbox.length})</h3>
      ${canEdit ? `<button class="btn-primary btn-sm" id="mkt-lead-add">＋ Capture Lead</button>` : ''}
    </div>
    ${!inbox.length ? `<div class="empty-state" style="padding:18px"><p>No leads awaiting handoff.</p></div>`
      : `<div style="display:flex;flex-direction:column;gap:8px">${inbox.map(c0 => row(c0, true)).join('')}</div>`}
    ${handed.length ? `<h4 style="font-size:13px;margin:16px 0 6px">✅ Handed to Sales (${handed.length})</h4>
      <div style="display:flex;flex-direction:column;gap:8px">${handed.slice(0,30).map(c0 => row(c0, false)).join('')}</div>` : ''}
  `;
  document.getElementById('mkt-lead-add')?.addEventListener('click', () =>
    openLeadCaptureModal(camps, () => renderMktLeads(content, currentUser, currentRole)));
  content.querySelectorAll('.mkt-lead-handoff').forEach(btn => btn.addEventListener('click', async () => {
    const cl = inbox.find(x => x.id === btn.dataset.id); if (!cl) return;
    btn.disabled = true;
    const FV = firebase.firestore.FieldValue;
    const today = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10);
    const who = userProfile?.displayName || currentUser.email;
    try {
      await db.collection('clients').doc(cl.id).update({
        handedOffAt: FV.serverTimestamp(), handedOffBy: currentUser.uid, handedOffByName: who,
        contactLog: FV.arrayUnion({ date: today, by: who,
          note: 'Lead handed to Sales' + (cl.campaignId ? ' (campaign: ' + ((camps.find(c0=>c0.id===cl.campaignId)||{}).name || '') + ')' : '') }),
        updatedAt: FV.serverTimestamp() });
      await Notifs.sendToDept('Sales', {
        title: '📥 New lead from Marketing',
        body: `${cl.name}${cl.company ? ' · ' + cl.company : ''} — ${window.leadSourceLabel(cl.source)}${cl.campaignId ? ' · ' + ((camps.find(c0=>c0.id===cl.campaignId)||{}).name || '') : ''}. Open the Sales CRM to follow up.`,
        icon: '📥', type: 'lead_handoff', link: 'Sales',
        dedupKey: `lead_handoff_${cl.id}`
      }, { fallbackToOwner: true });
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('clients');
      Notifs.showToast(`Lead sent to Sales: ${cl.name}`);
      renderMktLeads(content, currentUser, currentRole);
    } catch (ex) { btn.disabled = false; Notifs.showToast('Handoff failed: ' + (ex.message||ex.code), 'error'); }
  }));
}
```

**Capture modal `openLeadCaptureModal(camps, onSaved)`** — fields: name (required), company, phone, email, notes, source `<select>` from `LEAD_SOURCES`, campaign `<select>` from non-cancelled `camps` + "— none —". Save logic (nameKey dedupe, first-touch attribution):
```js
const existing = await window.Clients.findByName(name);
const FV = firebase.firestore.FieldValue;
if (existing) {
  const upd = { updatedAt: FV.serverTimestamp(), leadOrigin: existing.leadOrigin || 'marketing',
    source: existing.source || source, brands: FV.arrayUnion('sales') };
  if (!existing.campaignId && campaignId) upd.campaignId = campaignId;   // first-touch: never overwrite
  ['company','phone','email'].forEach(k => { if (!existing[k] && vals[k]) upd[k] = vals[k]; }); // fill-empty only
  await db.collection('clients').doc(existing.id).update(upd);
  Notifs.showToast(`Existing client updated: ${name}`);
} else {
  await db.collection('clients').add({
    name, nameKey: window.clientNameKey(name), brands: ['sales'], stage: 'lead',
    company, phone, email, address: '', notes,
    followUpDate: '', lastContact: '', contactLog: [],
    leadOrigin: 'marketing', source, campaignId: campaignId || null,
    handedOffAt: null,
    addedBy: currentUser.uid, createdBy: currentUser.uid,
    createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() });
  Notifs.showToast(`Lead captured: ${name}`);
}
if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('clients');
closeModal(); onSaved();
```
(Writes satisfy WS32's `clients` rules — internal user, non-empty name. Stage/followUpDate on EXISTING clients are never touched, matching `upsertFromQuote`'s discipline.)

### Spec 7 — Promotions calendar (NEW `renderMktPromos`, miniCal-pattern month grid)

State: a module-scoped `let _promoMonthOffset = 0;` (mirrors `_calMonthOffset`, app.js:7622). Data: full `promotions` get via cached key `'promotions'` (60s; invalidate on write) — volume is tiny; client-side filter to the visible month.

```js
async function renderMktPromos(content, currentUser, currentRole) {
  const canEdit = canEditDept('Marketing');
  const snap = await (typeof dbCachedGet === 'function'
    ? dbCachedGet('promotions', () => db.collection('promotions').get().catch(()=>({docs:[]})), 60000)
    : db.collection('promotions').get().catch(()=>({docs:[]})));
  const promos = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  const todayStr = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10);
  // Manila-anchored month base — same technique as renderMiniCal (app.js:7638-7640)
  const base = new Date(+todayStr.slice(0,4), +todayStr.slice(5,7)-1, 1);
  base.setMonth(base.getMonth() + _promoMonthOffset);
  const year = base.getFullYear(), month = base.getMonth();
  const mStart = `${year}-${String(month+1).padStart(2,'0')}-01`;
  const daysIn = new Date(year, month+1, 0).getDate();
  const mEnd = `${year}-${String(month+1).padStart(2,'0')}-${String(daysIn).padStart(2,'0')}`;
  // A promo is "on" a day when startDate<=day<=endDate (ISO strings compare lexically)
  const monthPromos = promos.filter(p => (p.startDate||'') <= mEnd && (p.endDate||p.startDate||'') >= mStart)
    .sort((a,b) => (a.startDate||'').localeCompare(b.startDate||''));
  const onDay = ds => monthPromos.filter(p => (p.startDate||'') <= ds && (p.endDate||p.startDate||'') >= ds);
  // Grid: Su..Sa header, leading blanks = new Date(year,month,1).getDay(), one cell per day —
  // day number + up to 3 dots (•) when onDay(ds).length, today highlighted (ds===todayStr),
  // cell click opens a small day-list popover/modal of that day's promos. ‹ › buttons adjust
  // _promoMonthOffset and re-render. Below the grid: the monthPromos list —
  // title (escHtml) + 📅 range + channel badge (leadSourceLabel) + campaign badge, with
  // ✏️/🗑 for canEdit (delete via confirmDialog; both invalidate 'promotions' + re-render).
  // Header row: `🗓 <MonthName Year>` + (canEdit ? '＋ New Promo' → openPromoModal(null, camps, rerender)).
}
```
`openPromoModal(promo, camps, onSaved)`: title (required), start/end dates (`end >= start`, default end = start), channel `<select>` (LEAD_SOURCES + blank), campaign `<select>`, notes. Save = Spec-1 shape → `dbCacheInvalidate('promotions')` → toast → `onSaved()`. (Full-collection get + client filter ⇒ no index; no `orderBy` in the query.)

### Spec 8 — Insights (NEW `renderMktInsights` — live rollup, no cache collection)

```js
async function renderMktInsights(content, currentUser, currentRole) {
  const canSpend = ['president','owner','manager','finance'].includes(currentRole);
  const [camps, clientsAll, qSnap, ledgerSnap] = await Promise.all([
    fetchCampaigns(),
    window.Clients.listAll(),                                   // 'clients' cache key (WS32)
    (typeof getAllQuotes === 'function' ? getAllQuotes() : Promise.resolve({ docs: [] })),  // 'all-quotes'
    canSpend
      ? (typeof dbCachedGet === 'function'
          ? dbCachedGet('ledger-marketing', () => db.collection('ledger').where('dept','==','Marketing').get().catch(()=>({docs:[]})), 60000)
          : db.collection('ledger').where('dept','==','Marketing').get().catch(()=>({docs:[]})))
      : Promise.resolve({ docs: [] })
  ]);
  const quotes = qSnap.docs.map(d => ({ id:d.id, ...d.data() }));
  const ledger = ledgerSnap.docs.map(d => d.data());
  const rows = camps.map(camp => {
    const leads = clientsAll.filter(c0 => c0.campaignId === camp.id);
    const seen = {}; const cQuotes = [];
    leads.forEach(c0 => window.Clients.quotesFor(c0, quotes)      // WS32 canonical join — clientId first, nameKey fallback
      .forEach(q => { if (!seen[q.id]) { seen[q.id] = 1; cQuotes.push(q); } }));
    const wins = cQuotes.filter(window.isQuoteWon);               // WS32 canonical outcome
    const spend = (canSpend && camp.budgetLineId)
      ? ledger.filter(e => e.budgetLineId === camp.budgetLineId && ledgerKind(e) === 'expense')
              .reduce((s,e) => s + (e.amount||0), 0)
      : null;                                                     // null ⇒ render '—', never ₱0
    return { camp, leads: leads.length,
      converted: leads.filter(c0 => crmStageOf(c0) === 'won').length,
      quotes: cQuotes.length,
      quoted: cQuotes.reduce((s,q) => s + (q.total||q.grandTotal||0), 0),
      wins: wins.length,
      wonVal: wins.reduce((s,q) => s + (q.total||q.grandTotal||0), 0),
      spend, cpl: (spend != null && leads.length) ? spend / leads.length : null };
  });
  const unattributed = clientsAll.filter(c0 => c0.leadOrigin === 'marketing' && !c0.campaignId).length;
  // Render: KPI row (Total spend [money-tier] · Total leads · Total wins ₱), then a table
  // wrapped in overflow-x:auto — columns: Campaign | Status | Spend | Leads | CPL | Quotes |
  // Quoted ₱ | Wins | Won ₱ — spend/CPL cells show '—' + a 🔒 tooltip ('finance-visible')
  // when null; an over-budget spend (spend > camp.budget > 0) renders in var(--danger).
  // Footer note when unattributed > 0: 'N marketing leads have no campaign tag.'
  // Empty state when !camps.length. All names escHtml'd.
}
```
Reads: 4 fetches, all cached (WS16 discipline); no composite index (`ledger.dept` is a single-field where; clients/quotes are existing cached full reads). Spend semantics for non-money viewers deliberately match `renderBudgeting`'s `canSeeSpend` "— not ₱0" convention (departments.js:11482-11485).

### Spec 9 — Budgeting mismatch fix (departments.js:11475-11530 + rules 2b)

1. **Rules:** Spec 2b (create/update/delete split with the `dept`-field `inDept` clause).
2. **Stamp `dept` on new lines** — in `renderBudgeting`'s "+ Budget Line" save handler, the create payload `{ name, budget, createdAt }` gains `dept` (the function's own `dept` argument): `{ name, budget, dept, createdAt: FV.serverTimestamp() }`.
3. **Gate the ledger button honestly** — the "📤 Log Expense / Income" button (which writes `ledger`, `canFinance()`-gated in rules regardless of this fix) renders only when `canSeeSpend` (the money-tier flag ALREADY computed at departments.js:11482); `canEdit` (dept members included) keeps gating only the "+ Budget Line" button and line edit/delete, which now genuinely work for dept members on NEW lines.
4. **Legacy lines:** no backfill. Old lines (no `dept` field) stay money-admin-editable; a money admin can re-save a legacy line with the `dept` field if a dept needs to manage it (optional, manual, no script).

### Spec 10 — Migration / rollout checklist (dependency order)

1. **Precondition:** WS32 deployed AND `window.migrateClientBooks()` has been run (the Leads tab hard-banners until then — Spec 6). WS38 NOT required for Phase A.
2. **Deploy rules** (Spec 2a blocks + 2b wildcard edit) — fresh `git diff firestore.rules` first, block-scoped Edits, then `~/.npm-global/bin/firebase deploy --only firestore:rules`. Old clients unaffected (they don't touch the new collections; the budgets_ widening is strictly additive).
3. **No index deploy** — zero composite indexes needed (verified per query, Specs 5-8).
4. **Ship the JS** (one commit — Phase A): config.js (Spec 3a subtabs + 3b `LEAD_SOURCES`), departments.js (Spec 4 rewiring; Spec 5a/5b campaigns; Spec 6 leads; Spec 7 promos; Spec 8 insights; Spec 9.2/9.3 budgeting edits). `node --check` each file. **Bump `CACHE_VER` in sw.js by hand** (pre-commit hook covers APP_VERSION only). No new script file ⇒ no index.html/PRECACHE change.
5. **No data migration** — all three new collections start empty; `clients` gains fields only on new capture writes; backup auto-discovers the new root collections (zero registration).
6. **Phase B (after WS38 ships):** add the Materials panel (Spec 5c) inside `openCampaignModal` — one departments.js edit + CACHE_VER bump; no rules/index/sync work (all WS38's).
7. Update ROADMAP.md: Marketing suite Phase A shipped; Materials panel pending WS38.

### Spec 11 — Manual test checklist

1. **Tabs:** Marketing opens on Campaigns; all 11 chips render and match `DEPARTMENTS.Marketing.subtabs` exactly (drift fix); Advertising/Designs/Plan/Budgeting/Proposals/Tasks behave as before.
2. **Campaign CRUD:** Marketing employee creates a campaign (name/dates/channels/budget) → appears in list with status badge; `end < start` blocked client-side; a partner console `create` on `campaigns` → DENIED; a non-Marketing employee create → DENIED (`canDept`); president edit → allowed; employee delete → DENIED (admin-only), Cancel status works instead.
3. **Budget link + spend:** as finance, link a campaign to a `budgets_marketing` line; post a Marketing ledger expense against that line → campaign detail "Actual spend" shows it (matches the Budgeting tab's number for the same line); as a plain Marketing employee the spend cell shows "—", not ₱0.
4. **Lead capture:** capture "Juan Reyes / FB / campaign X" → one `clients` doc with `stage:'lead'`, `brands:['sales']`, `leadOrigin:'marketing'`, `source:'FB'`, `campaignId`; the SAME client is visible in Sales → Clients (shared record); capturing the same name again does NOT duplicate (nameKey) and does NOT overwrite the existing `campaignId` (first-touch).
5. **Handoff:** "→ Send to Sales" → `handedOffAt` set, lead moves to the "Handed to Sales" section, a `contactLog` entry appears in the client's WS32 timeline, and every Sales-department user receives the 📥 notification (owner receives it if Sales is empty — `fallbackToOwner`). Button gone on re-render (idempotent).
6. **Pre-migration guard:** with WS32's migration not yet run (legacy mode), the Leads tab shows the unify-first banner and no capture button.
7. **Promos calendar:** create a promo spanning the 15th–31st → dots on each covered day of the month grid, promo listed below; `‹`/`›` nav moves months (Manila-anchored — test near UTC midnight); day click lists that day's promos; edit/delete work and refresh the grid.
8. **Insights:** campaign X shows Leads=1 after test 4; file a quote for Juan via the builder (WS32 stamps `clientId`) → Quotes=1, Quoted ₱ correct; mark it won (or create its sales order) → Wins=1/Won ₱ via `isQuoteWon`; spend/CPL populate for finance viewers and show "—"+🔒 for a Marketing employee; a lead with no campaign shows in the "unattributed" footer count.
9. **Strategy:** add a template doc → renders as a card (renderDocCollection); non-Marketing employee write → DENIED.
10. **Budgeting fix:** as a plain Marketing employee, "+ Budget Line" now SUCCEEDS (new line carries `dept:'Marketing'`); editing a LEGACY line (no dept field) → DENIED for the employee, allowed for finance; the "📤 Log Expense / Income" button is hidden for the employee (no more silent deny); as an IT dept member, writing to `budgets_marketing` → DENIED (`inDept` mismatch).
11. **Materials (Phase B):** upload a file in campaign X's Materials panel → `hub_files` doc with `scope:'materials'`, `folderId:'materials__<id>'`, full WS38 Spec-1 shape; it appears in the Files Hub under the materials scope inside the campaign-named folder; preview (👁) works; the panel shows the WS38 placeholder when `FilesHub` is absent.
12. **Deploy hygiene:** `git diff firestore.rules` clean before deploy; CACHE_VER bumped; `node --check` passes on config.js/departments.js.

### Flags for Neil

- **‼️ FLAG FOR NEIL — Marketing landing tab changes to "Campaigns".** The department page now opens on the new Campaigns tab instead of Advertising. Say the word to keep Advertising as the default.
- **‼️ FLAG FOR NEIL — dept members can now create/edit their own department's budget lines.** The code always SHOWED them the button but the rules silently blocked it; this spec makes it real (new lines only, money tier unaffected, expense logging stays finance-only). If you'd rather budget allocations stay finance-only, skip Spec 2b/9 and we hide the button instead.
- **‼️ FLAG FOR NEIL — lead-source vocabulary.** The nine Brilliant-Steel codes (Facebook, Instagram, TikTok, Website, Viber, Email, In-Office, Referral, Exhibition) become the company-wide `LEAD_SOURCES` list for lead capture, campaign channels, and promos. Confirm the list or name additions.
- **‼️ FLAG FOR NEIL — campaign spend is finance-visible only.** Marketing staff who aren't finance/manager/president see "—" for spend/CPL in Insights (the ledger is finance-gated in rules; showing ₱0 would lie). If Marketing should see its own spend numbers, that's a `ledger` read-rule widening — a separate security decision, not made here.
- **‼️ FLAG FOR NEIL — first-touch attribution.** A client captured under campaign A and later touched by campaign B keeps `campaignId` = A forever (simple, no multi-touch model). Confirm this is acceptable for how you'll read the Insights table.

## RE-GROUNDED (Fable, 2026-07-11)

This DECIDED spec was written against WS32/WS38's *plans*; both are now IMPLEMENTED (WS32: 31ced19, WS38: 224dc6b). Verified against the real code — **the spec's API/shape assumptions all hold**; two substantive corrections and a line-number refresh below.

**Verified as-built, no change needed:**
- `window.Clients` (departments.js:135-241) exposes exactly `{nameKey, brandOf, deptOf, normalize, listAll, findByName, upsertFromQuote, quotesFor, timelineFor}`; `listAll({brand:'sales'})` filters `brands[]`, is cached under `'clients'` (60s), and `normalize` sets `_legacy: !!legacyBrand` only on the pre-migration fallback path — Spec 6's `all.some(c => c._legacy)` guard works as written. `quotesFor` = `clientId`-first, `nameKey` fallback, exactly as Spec 8 assumes.
- `clients` doc shape matches Spec 1's base (name, nameKey, brands[], company, email, phone, address, notes, stage, followUpDate, lastContact, contactLog[] entries `{date, by, note}`, lastQuoteNumber, lastQuoteTotal, legacyRefs[], createdBy, createdAt, updatedAt). `clients` rules (firestore.rules:1278-1284) guard only non-empty string `name` — the four additive WS34 fields need zero rules changes, as claimed. `window.clientNameKey` = config.js:400; `isQuoteWon/isQuoteLost/isQuoteOpen` = config.js:396-398; `CRM_STAGES/crmStageOf/crmStageMeta` exported at departments.js:12078 with `{key,label,color,icon}` entries.
- The quote-builder bridge really stamps `clientId` (app.js:8239/8255 via `Clients.upsertFromQuote`) — the Spec 7/8 attribution chain is live, not hypothetical.
- `window.FilesHub` (drive.js:304-397): `loadFiles(scope,{includeDeleted})`, `loadFolders(scope)`, `folderPath`, `canEdit(f)`, `moveToFolder(id,folderId)`, `uploadNewVersion(f,result,file,note)`, `softDelete(id)`, `restore(id)`, `purge(f)`, `share(f,target,perm)` — all as Spec 5c uses them. `window.openFilePreview(f)` = drive.js:400.
- Spec 5c's `hub_files` write shape matches the shipped write (departments.js:12898-12919) **field-for-field**; `hub_folders` shape matches (12885-12889). `kind: result.source==='link'?'link':'file'` is correct: file uploads resolve `{source:'firebase', name, url, driveUrl:null, id, folder}` (drive.js:29-36), links resolve `{source:'link', kind:'link', name, url, ...}` (drive.js:229).
- Scope convention confirmed: `bindFileCollection` (signature unchanged, departments.js:12598) maps its `scope` arg via `scope.toLowerCase().replace(/\s+/g,'_')` — Marketing's tabs live at scopes `advertising`/`designs`; `'materials'` is convention-consistent and collision-free. `hub_files` create rules (1341-1344: uploadedBy==uid, visibility in ['company','private'], deleted==false) and `hub_folders` create rules (1362-1363: createdBy==uid) are satisfied by Spec 5c's writes. `Drive.renderUploadArea(containerId, onUpload, {accept,label,dept,subfolder,multiple,allowLinks})` (drive.js:101) → `Marketing/Files/…` path; sync-to-drive.js:72 already has the `hub_files: 'Files Hub'` LABELS entry.
- `budgets_.*` wildcard BEFORE text in Spec 2b matches the live rule verbatim (now firestore.rules:1322-1323); `canDept`/`inDept` helpers exist (rules:72-76); the `marketing_plans`/`marketing_proposals` insert anchor exists (rules:847-854). `Notifs.sendToDept(department, notifData, opts={})` = notifications.js:283. `renderMarketing`/`loadMarketingContent` BEFORE state matches exactly (now departments.js:2225-2265); `DEPARTMENTS.Marketing.subtabs` BEFORE matches (config.js:141-144); no `LEAD_SOURCES` exists anywhere yet. `ledgerKind` is `window.ledgerKind` (config.js:809).

### Spec corrections

1. **Spec 9.2 is ALREADY IMPLEMENTED — do not re-apply.** The live "+ Budget Line" save handler already writes `{ name, budget, dept, createdAt }` (departments.js:12489-12494; the `dept` stamp shipped with a prior workstream). Sonnet: treat Spec 9.2 as verify-only. Spec 2b (rules widening — still `isMoneyAdmin()` only at rules:1323) and Spec 9.3 (gate "📤 Log Expense / Income" behind `canSeeSpend` — still rendered under `canEdit` at departments.js:12419-12422) are **still required** and unchanged.
2. **Spec 11 test 3 caveat — `renderBudgeting`'s ledger read is capped.** The live Budgeting query is `db.collection('ledger').where('dept','==',dept).limit(100)` (departments.js:12392, no orderBy). Spec 5b/8's uncapped cached `'ledger-marketing'` query is the *more correct* number; the two only match exactly while Marketing has ≤100 ledger rows. Keep the spec's uncapped query; adjust the test expectation to "matches when ≤100 Marketing ledger entries exist".
3. **Spec 5c folder-idempotency nuance — the `.catch(()=>{})` is load-bearing.** `hub_folders` update is creator-or-admin only (rules:1364-1365), so when a second (non-creator, non-admin) Marketing user opens an existing campaign's modal, the `set(...,{merge:true})` is a rules *update* and gets permission-denied. The catch swallows it and behavior stays correct (the folder already exists). Sonnet: keep the catch exactly as spec'd; do not "fix" the denial or drop the catch. (Optional cheap improvement, allowed but not required: skip the `set` when `(await FilesHub.loadFolders('materials')).some(fo => fo.id === folderId)`.)
4. **Line-number refresh only (all BEFORE snippets still textually exact — use text-anchored Edits, not line numbers):** `renderMarketing`/`loadMarketingContent` 1951-1992 → **2225-2265**; `renderBudgeting` 11475-11530 → **~12370-12560** (canSeeSpend at 12386, buttons at 12419-12422, line-create at 12489-12494); `CRM_STAGES` block 11074-11081 → **12070-12078**; `renderClientProfiles` → **12080+**; `bindFileCollection` → **12598+**; rules: `marketing_proposals` block 761-764 → **851-854**, `clients` → **1278-1284**, `budgets_.*` wildcard 1147-1157 → **1314-1324**, `hub_files` → **1334-1358**, `hub_folders` → **1360-1366**; `Notifs.sendToDept` 276-303 → **283+**.
