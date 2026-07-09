# Workstream 19 — Security closes (partner lockdown, attendance forgery, secretary two-tier)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

All line numbers below are current as of a fresh read of firestore.rules (861 lines total) and the relevant JS files on branch v12, post-Phase-1.

## 1. files_* wildcard match — firestore.rules:838-854
```
// ── Dynamic / runtime-named collections ────────────
// The app creates per-scope and per-dept collections at runtime whose names
// are not known ahead of time, so they can't be matched by literal name:
//   files_<scope>  — uploaded documents (every Files tab, all depts)
//   budgets_<dept> — budget allocation lines (Budgeting screens)
// Firestore does NOT match collections by prefix, so cover each family with
// a single-segment wildcard guarded by coll.matches(...). ...
match /{coll}/{docId} {
  // Files: readable by the team; you own what you upload; owner/admin edit or remove.
  allow read:   if isAuth() && coll.matches('files_.*');
  allow create: if isAuth() && coll.matches('files_.*')
                && request.resource.data.uploadedBy == request.auth.uid;
  allow update, delete: if isAuth() && coll.matches('files_.*')
                && (resource.data.uploadedBy == request.auth.uid || isAdmin());
}
```
No partner exclusion, no department scoping at all — ANY signed-in user (including a `partner`-role account) can read every files_<scope> collection across every department (e.g. files_finance, files_hr, files_it), and can CREATE into any of them (only uploadedBy==self is checked, not department membership). Collection names are built client-side in js/departments.js:10449 (`` `files_${id.replace(/-/g,'_')}` ``) and :10749 (`` `files_${scope.toLowerCase().replace(/\s+/g,'_')}` ``). Doc shape written by bindFileCollection (departments.js:10513-10520): `{name, url, source, uploadedBy, uploadedByName, createdAt}`, later updated with `{deleteRequested:true, deleteRequestedBy}` (10491).

## 2. budgets_* wildcard match — firestore.rules:855-859
```
match /{coll}/{docId} {
  // Budget lines: internal planning data, read/write by any signed-in staffer
  // (the UI already gates the edit buttons to dept members + finance/admin).
  allow read, write: if isAuth() && coll.matches('budgets_.*');
}
```
This is a genuine world-write: no owner check, no dept check, no admin check at ALL — any signed-in user can create/update/delete ANY department's budget lines. UI gating (departments.js:10529-10536, `canEdit = ...||isDeptMember`) is cosmetic only; the rule permits bypass via console. Collection name built at departments.js:10529: `` `budgets_${dept.toLowerCase().replace(/\s+/g,'_')}` ``. Doc shape (10639-10644 "Add Budget Line"): `{name, budget:number, dept, createdAt}` — no creator/uploader field at all.

## 3. Attendance write rule — firestore.rules:152-156
```
// ── Attendance ─────────────────────────────────────
match /attendance/{uid}/{document=**} {
  allow read: if isAuth() && (isOwner(uid) || isFinanceOrAdmin());
  allow write: if isAuth() && (isOwner(uid) || isFinanceOrAdmin());
}
```
No date/docId restriction, no field-shape restriction, no attendanceScore range/consistency check whatsoever — the owner can write to ANY date subdoc under attendance/{their-uid}/records/{any-date} with ANY field values. Confirmed forgeable in practice: the client itself writes attendanceScore directly with no server validation in three places —
  - Self check-in, js/app.js:3122-3128: `await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).set({ loginTime: FieldValue.serverTimestamp(), uid: currentUser.uid, date: todayStr, attendanceScore: autoFull?1.0:0.5, fullTime: autoFull, autoFull }, {merge:true});` — todayStr is a CLIENT-computed string, not validated against request.time.
  - Notification-driven upgrade, js/app.js:3184-3187: `await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).set({ attendanceScore: 1.0, fullTime: true, fullTimeAt: FieldValue.serverTimestamp() }, {merge:true});` — a raw attendanceScore:1.0 write, self-authored, gated only by client-side business logic (bizHour()<9 check at app.js:3175, a check the user's own browser evaluates, not the server).
  - Admin edit path (legitimately privileged), js/modules.js:1211-1223, sets attendanceScore to 1.0/0.5/0 plus `editedBy`/`editedAt` — this one SHOULD remain possible for isFinanceOrAdmin() but nothing stops the owner branch from writing the same fields with the same values on their own doc, including retroactively overwriting an admin's prior edit (no check that resource.data.editedBy is absent/self before allowing an owner write).
Net effect: an employee can open devtools and set `attendanceScore:1.0` for any past OR future date on their own doc, and payroll/EOM (per the Payroll Compute bug memory and departments.js payroll math) reads attendanceScore directly.

## 4. Secretary role / isAdmin() — firestore.rules:14-23, plus every WRITE site
```
function getRole() {
  return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('role', null);
}
// 'secretary' (Corporate Secretary) is an admin-portal oversight role with
// manager-level access. It is intentionally NOT in isPresident(), so deletions of
// key records (finance, payroll, ledger — all gated on isPresident below) still
// require the President's approval, exactly as for managers.
function isAdmin()          { return getRole() in ['president', 'manager', 'secretary']; }
function isFinanceOrAdmin() { return getRole() in ['president', 'manager', 'secretary', 'finance']; }
function isPresident()      { return getRole() == 'president'; }
```
grep counts: `isAdmin()` appears 60 times in firestore.rules (direct calls plus derived helpers canDesign/canPurchasing/canProduction/canDept, all of which are `isAdmin() || <deptMember>`); `isFinanceOrAdmin()` appears 37 times (and canFinance() = isFinanceOrAdmin()||isFinanceDept()). Combined, 'secretary' is live in roughly 90+ distinct allow-clauses.

Critically, the /users/{uid} block (89-110) gives secretary an UNCONSTRAINED update path:
```
match /users/{uid} {
  allow read: if isAuth();
  allow create: if isAuth() && ( isAdmin() || ( isOwner(uid) && request.resource.data.role == 'employee' && ... ) );
  allow update: if isAuth() && ( (isOwner(uid) && userPrivilegedFieldsUnchanged()) || isAdmin() );
  allow delete: if isAuth() && isPresident();
}
```
The isOwner(uid) branch is field-frozen by userPrivilegedFieldsUnchanged() (role/salary/allowance/deductions/department/departments/employeeId), but the isAdmin() branch has NO field restriction at all — since secretary matches isAdmin(), a secretary account can directly write `role:'president'` onto ANY user doc (including their own) via a raw Firestore write, no UI path needed. This is a live self-escalation gap, distinct from anything the plan text names explicitly.

Also live via isFinanceOrAdmin() (secretary included): create/update on payroll/{uid} (278-282), salary_history (285-291), salary_raises (295-301), payroll_ca_overrides (304-309), cash_advances create/update (170-192), kpi_evals create/update INCLUDING writing over presidentGrade fields is blocked by presFieldsUntouchedOnUpdate only for the isOwner branch — the isFinanceOrAdmin() branch (246-247) has no such freeze, so secretary can also write presidentGrade/presidentNotes directly. And canFinance()→isFinanceOrAdmin() gates ledger/ledger_entries/cash_receipt_journal/cash_disbursement_journal/general_journal/finance_records/tax_records/purchase_orders create+update (582-637) — i.e. secretary can post ledger entries today.

The app's UI already models a two-tier scheme that the rules do NOT mirror. js/config.js:124-140 documents the intent ("MINOR everyday items ... MAJOR/money-moving items ... escalate to the President"), and js/departments.js:9126-9147 implements `APPROVAL_CAPS`:
```
const APPROVAL_CAPS = {
  'signup':['president','manager','secretary'], 'attendance':[...,'secretary'],
  'submission':[...,'secretary'], 'review-task':[...,'secretary'], 'leave':[...,'secretary'],
  'ca':['president','manager'],            // secretary excluded in UI
  'quote-approval':['president','manager'], // secretary excluded in UI
  'finance-req':['president'], 'finance-del':['president'],
  'delete-quote':['president'], 'delete-client':['president'],
};
```
But the underlying rules for `ca` (cash_advances update, line 184-190 → isFinanceOrAdmin()) and `quote-approval` (approval_requests update, line 413 → isAdmin()) both still include secretary — the UI hides the approve button, but a secretary calling the Firestore SDK directly from devtools can still approve a cash advance or quote today. This is a live bypass of the app's own documented policy, not a hypothetical.

## 5. Partner read scope — no isPartner() helper exists; every check is an inline `getRole() != 'partner'`
grep found no `function isPartner`. The pattern `allow read: if isAuth() && getRole() != 'partner';` (or embedded in an OR) is used ~20 times, applied to: attendance_extensions(164), bs_quotes read-own-else-non-partner(383), bk_quotes(397/400/401), approval_requests(411), work_plans/marketing_plans/marketing_proposals/gov_philgeps/gov_active_bids/gov_archive(553/557/561/565/569/573), gov_biddings(685), inventory_items(699/700), stock_movements(704/705), production_orders(718/719), sales_orders(776), job_projects(788/790), order_tracking(804/805), sales_clients/design_clients(834/835). bs_clients (836) is INTENTIONALLY partner-readable (comment at 833: "STAYS readable by the partner").

NOT applied — bare `allow read: if isAuth();` with no partner exclusion — on: /users/{uid}(90), /posts/{postId}(119), /tasks/{taskId}(196) plus its /comments(218) and /readers(226) subcollections, /quotes/{docId}(373, the INTERNAL Sales quotes collection — distinct from bk_quotes which IS partner-excluded), /projects/{docId}(492, note this is DIFFERENT from /job_projects which correctly restricts partners at 788), /design_drawings/{docId}(510), /it_tickets(524), /it_assets(533), /it_software(537), /sops(271), /resources(451), /policies(455), /handbook(459), /memos(463), /settings(259), /president_message(265), /departments(691). The V12-PLAN.md bullet (line 83-85) names "users/tasks/posts reads" explicitly as in-scope examples; /projects, /quotes, /design_drawings show the identical gap but aren't named in the plan text — worth flagging to Fable as the same bug pattern recurring beyond the named examples.

Cross-check with storage.rules (199 lines): Storage already implements a real partner lockdown via Auth custom claims — `isPartnerClaim()` (60-62) and the generic per-department rule (176-186: `(!isPartnerClaim() || isMemberOf(department))`) exclude the partner from every department folder except their own, and Finance/* is partner-excluded outright (135-138: `!isPartnerClaim()`). So the Storage layer is materially ahead of the Firestore layer on this exact issue.

## 6. Adjacent (same workstream, not deep-dived): worker-login username lookup
js/app.js:696-703 runs `db.collection('users').where('username','==', input.toLowerCase()).limit(1).get()` BEFORE `auth.signInWithEmailAndPassword` (712) — i.e. while request.auth is still null. The /users read rule (`allow read: if isAuth();`, line 90) requires auth, so this pre-auth query is denied by rules today, breaking every username-based worker login attempt (the plan's "worker-login username lookup unblocked" line). Any fix here also edits the /users/{uid} match block that decision #4 above already touches for the secretary self-escalation gap — worth deciding together to avoid two separate deploys hitting the same block.

## Data model

- `attendance/{uid}/records/{date}` (subcollection, date doc-id format YYYY-MM-DD from bizDate()): `{ uid, date, loginTime: Timestamp|FieldValue.serverTimestamp(), attendanceScore: number (0 | 0.5 | 1.0 today, by convention not by rule), fullTime: bool, autoFull: bool, fullTimeAt?: Timestamp, status?: 'present'|'half'|'absent' (admin-edit path), note?: string, editedBy?: uid, editedAt?: Timestamp }`. Read by payroll/EOM computation and by js/app.js:2847-2848, js/modules.js:677/1138-1140.

- `files_<scope>` (one collection per department/scope slug, created lazily; NOT enumerable ahead of time): `{ name: string, url: string (Storage getDownloadURL, TOKEN-BEARING), source: 'firebase'|'link'|'drive', uploadedBy: uid, uploadedByName: string, createdAt: Timestamp, deleteRequested?: bool, deleteRequestedBy?: uid }`. Collection-name slug rules: `files_${id.replace(/-/g,'_')}` (departments.js:10449) or `files_${scope.toLowerCase().replace(/\s+/g,'_')}` (10749) — two different slugification call sites for the same family, worth Fable noting for consistency.

- `budgets_<dept>` (one collection per department, slug = `dept.toLowerCase().replace(/\s+/g,'_')`, departments.js:10529): `{ name: string, budget: number, dept: string, createdAt: Timestamp }`. No creator/uploader field — nothing in the doc itself identifies who created a line, so any future per-doc ownership check would need a schema change (add e.g. `createdBy`), not just a rules change.

- `users/{uid}`: relevant privileged fields = `role` ('president'|'manager'|'secretary'|'employee'|'agent'|'finance'|'partner'), `department` (string) / `departments` (array), `salary`/`allowance`/`deductions` (legacy — per payroll-collection-architecture memory, live pay actually lives in `payroll/{uid}` now, but these fields still exist on some user docs and are still frozen by userPrivilegedFieldsUnchanged()), `employeeId`, `username` (worker login), `authEmail`/`email`, `displayName`.

- No dedicated `isPartner()` / `isSecretary()` / `isMinorAdmin()` helper functions exist in firestore.rules today — role checks are done via the shared `getRole()` accessor (a single Firestore `get()` per rule evaluation on the requesting user's own doc) combined inline (`getRole() != 'partner'`, `getRole() in [...]`).

- Cross-reference: `js/config.js:132-140` (`window.ROLES`) is the single client-side source of truth for role labels/badges and documents the intended secretary two-tier policy in a comment (124-131); `js/departments.js:9133-9145` (`APPROVAL_CAPS`) is the client-side enforcement of "which approval types secretary may act on" — this table is the closest existing artifact to a two-tier permission spec and should be treated as the design partly already agreed by the owner, just not yet mirrored server-side.

## Constraints — must respect

- Rules do NOT cascade to subcollections or match by collection-name prefix — every collection needs its own explicit match block (firestore.rules:838-846 comment; tasks/{taskId}/comments and /readers at 213-229 are re-declared for exactly this reason). Any new attendance/files_/budgets_ block must not assume a parent rule protects it.
- Null-safe field reads are mandatory: getRole() (line 14-16) uses .get('role', null) because a bare .data.role read THROWS and DENIES the rule when the field/doc is missing (worker/partner/older profiles). userPrivilegedFieldsUnchanged() (68-86) uses the same .get(field,null) pattern. Any new predicate touching resource.data/request.resource.data must use .get(field, default), never a bare field read.
- secretary is deliberately excluded ONLY from isPresident() (line 17-23 comment) so that every isPresident()-gated delete still requires the President. It is currently folded into BOTH isAdmin() (line 21, ~60 call sites) and isFinanceOrAdmin() (line 22, 37 call sites) with no other narrowing anywhere in the file today.
- Shape/value validation on writes is the file's established idiom for preventing exactly this class of forgery — see notifications create (142-149: fixed keys, read==false, createdAt==request.time, length caps), memos conforme (475-487: write-once, own-uid-only, at==request.time), leave_requests create (748-758: days range + status=='pending' for self-filers), and the ledger production-COS carve-out (588-597: fixed category/source/type/amount>0/refNumber regex). The attendance write rule (152-156) currently has NONE of this — plain isOwner(uid) with no field constraints at all, which is the anomaly relative to the rest of the file's own conventions.
- Storage rules use Auth custom claims (role/departments minted by syncUserClaims, storage.rules:60-71) which is a SEPARATE mechanism from Firestore rules' live getRole() Firestore lookup. A Firestore-side partner-lockdown fix and the existing Storage-side partner lockdown must stay conceptually consistent even though they're technically independent systems.
- getDownloadURL() (js/drive.js:28,51) returns a token-bearing URL that grants access regardless of storage.rules once known — so a Firestore-level leak of a files_* doc's `url` field is a direct Storage-rule bypass, not merely a metadata leak.
- Deploy discipline: `git push origin master` (or the v12 branch's eventual merge) does NOT deploy firestore.rules — a separate `firebase deploy --only firestore:rules` is required (CLAUDE.md, and the firebase-deploy-rules memory note that the CLI lives at ~/.npm-global/bin/firebase, not on PATH). The deploy-recheck-full-file-diff memory also flags that concurrent sessions edit this repo live via OneDrive, so a full-file rules replacement risks clobbering another session's uncommitted edit — prefer block-scoped diffs.
- Manila-time discipline (CLAUDE.md, manila_time_helpers memory: use bizDate()/bizHour()/bizDow(), never raw toISOString()) governs how the app computes 'today' client-side (js/app.js:3114 uses `new Date(todayStr + 'T00:00:00+08:00')`), but Firestore rules only have request.time (UTC) with no timezone conversion function available in the rules language — any rule wanting to validate 'this write is for today (Manila)' cannot literally reuse bizDate(); it must either tolerate a UTC/Manila offset window or push the validation into a Cloud Function callable instead of declarative rules.
- escHtml()-before-innerHTML discipline (CLAUDE.md) applies to any new UI Fable specifies for surfacing rule-driven states (e.g. an escalate-to-president banner) — not a rules concern but binds any accompanying JS spec.

## Open decisions — Fable resolves these

- [ ] files_* lockdown mechanism: does the fix need per-department scoping (a partner should still read their OWN dept's files, mirroring storage.rules' isMemberOf(department) carve-out and their existing Storage access), or a blanket exclusion (partner reads NO files_* collection at all, matching the simpler pattern used everywhere else in this file)? Per-dept scoping requires either parsing the department out of the collection-name string (fragile — ties correctness forever to departments.js's two different slugification call sites at :10449 and :10749 staying in sync with the rule's parsing logic) or adding an explicit `department` field to every files_ doc and checking resource.data.department (a data-model change requiring a one-time migration of existing docs, since resource.data reads can't see a field that was never written).
- [ ] budgets_* fix shape: convert to fully-named per-department match blocks (mirroring the existing work_plans/marketing_plans/gov_philgeps pattern at firestore.rules:552-575, using canDept(dept)) — which means enumerating every department as its own block — or keep the single wildcard but parse the dept suffix out of the collection name and compare to inDept()? Named blocks are explicit/auditable but add ~8 new blocks; wildcard-with-parsing stays compact but makes correctness depend on `dept.toLowerCase().replace(/\s+/g,'_')` (departments.js:10529) never diverging from whatever regex the rule uses to extract dept back out of the collection name.
- [ ] Secretary two-tier architecture — the central call: does Fable (a) introduce a NEW helper (e.g. `isMinorAdmin()`) and re-derive, call-site by call-site, which of the ~60 isAdmin() and ~37 isFinanceOrAdmin() usages secretary should keep vs lose (large surface, but precise), or (b) leave isAdmin()/isFinanceOrAdmin() as-is for the ~50+ genuinely-minor blocks (sops, memos, products, resources/policies/handbook, gov_biddings write, departments config, it_tickets, stock_movements, design_drawings delete, kpi_targets, posts/tasks admin-delete) and instead introduce a NARROWER guard (e.g. `getRole() in ['president','manager']`) applied only to the specific money-moving/escalation blocks (users update/create, payroll, ledger/all journals, cash_advances, kpi_evals president-fields, partner_deals, salary_history/salary_raises, payroll_ca_overrides) that should explicitly exclude secretary? Option (b) is far smaller-surface but requires Fable to certify the remaining isAdmin()/isFinanceOrAdmin() list really is all 'minor' — option (a) is a full architecture change to the role-helper hierarchy.
- [ ] users/{uid} update/create specifically (firestore.rules:92-108): the isAdmin() branch of `allow update` has NO field restriction (unlike the isOwner() branch's userPrivilegedFieldsUnchanged() freeze), so today a secretary can write role:'president' onto any doc including their own — a live self-escalation path independent of the broader two-tier question. Does the fix (a) apply field-freezing (role/department/salary/employeeId) to the isAdmin() branch too, but carve out an isPresident()-only override for those specific fields, or (b) split the update rule into an isPresident()-only path for privileged-field changes and a still-broad isAdmin() path for everything else (name/photo/phone/notes), or (c) something else? Also: exactly which fields should secretary still be allowed to change on another user's doc (if any) as part of an HR-adjacent oversight function?
- [ ] Attendance self-write forgery fix: pure declarative rules cannot re-derive the 'no unread notifications before 9am' autoFull business logic (js/app.js:3111-3121) needed to validate a legitimate 0.5→1.0 upgrade, and rules only have request.time (UTC), not Manila time, to compare against a docId date string. Given that, should Fable (a) settle for a narrower-but-still-declarative rule — restrict the docId to request.time's UTC date (or a tolerance window spanning the Manila offset), cap attendanceScore to the enumerated set {0, 0.5, 1.0}, and forbid an owner-write from touching a doc that already has `editedBy` set (protects admin overrides from being undone) — accepting that the autoFull business-logic check itself stays client-trusted for the 0.5-grant, or (b) move the write path behind a Cloud Functions callable (a real server-side function that stamps date/score) and lock the Firestore write rule down to isFinanceOrAdmin()-only, changing all three client call sites (app.js:3111-3133, 3170-3189, modules.js:1211-1223) to call the function instead of writing Firestore directly? (b) is more robust but is a bigger workstream-19 scope increase (new Cloud Function, functions/index.js deploy) versus a pure rules change.
- [ ] Partner read-scope completeness: the plan text (V12-PLAN.md:83-85) names 'users/tasks/posts reads' as the examples, but the identical bare-isAuth()-no-partner-exclusion pattern also exists on /quotes, /projects (as opposed to /job_projects which correctly restricts partners), /design_drawings, /it_tickets, /it_assets, /it_software, /sops, /resources, /policies, /handbook, /memos, /settings, /president_message, /departments. Is the intended scope of this workstream ONLY the three named collections, or the full audit-style sweep of every internal collection currently partner-readable by omission? If the latter, Fable needs to produce a definitive collection-by-collection whitelist (which collections a partner should legitimately read: bs_quotes-own, bs_clients, partner_deals-own, sales_orders-own, job_projects-own/shared, order_tracking-public-token — vs. everything else denied) rather than patching a handful.
- [ ] /projects vs /job_projects duplication: /projects (firestore.rules:491-502, bare isAuth() read) and /job_projects (783-792, correctly partner-scoped) look like two parallel 'project' collections with different partner-visibility policies. Is /projects a legacy/duplicate collection this workstream should just partner-lock (add getRole()!='partner'), or does it overlap with the 'two project collections' gap already flagged in the finance-reporting-open-items memory and belong to a bigger dedup effort outside workstream 19's scope? Needs a decision on whether to fix in place or flag for the collection-consolidation effort and fix narrowly here regardless.
- [ ] Style/DRY: should a new `isPartner()` helper function be introduced (mirroring storage.rules' `isPartnerClaim()`) to replace the ~20 repeated inline `getRole() != 'partner'` expressions across every touched block, or is the current inline-repetition style intentional/consistent with the file's convention of small named booleans for OTHER roles but not this one? Low-stakes but touches every block being edited in this workstream, so worth settling once.

## Risks / cross-workstream interactions

- ⚠️ The ~60 isAdmin() call sites are not all direct — canDesign(), canPurchasing(), canProduction(), and canDept(d) (firestore.rules:42/50/57/66) are all defined as `isAdmin() || <deptMember>`. A naive global find-and-replace of isAdmin() with a narrower secretary-excluding predicate will silently narrow Design/Purchasing/Production/generic-dept access too, not just secretary's — every derived helper must be individually re-verified, not just the direct call sites.
- ⚠️ Live privilege-escalation gap found while grounding (not named in the plan bullet text): firestore.rules:106-108's isAdmin() branch of the /users/{uid} update rule has zero field restriction, so a 'secretary' account can today write role:'president' directly onto any user doc including their own, via the Firestore SDK, bypassing all UI. This should be treated as the single highest-severity finding in this grounding pass regardless of which two-tier architecture Fable picks.
- ⚠️ The UI's own APPROVAL_CAPS table (departments.js:9133-9145) already hides the cash-advance-approve and quote-approval buttons from secretary, but the underlying rules (cash_advances update → isFinanceOrAdmin() at 184-190; approval_requests update → isAdmin() at 413) still permit secretary to perform both via a direct Firestore call. This is a documented-but-unenforced policy gap today, not merely a hypothetical to design against — any secretary account already has the technical ability to do this in production right now.
- ⚠️ files_* is a compounded risk beyond 'metadata leak': js/drive.js:28/51's getDownloadURL() embeds an access token in the `url` field that bypasses storage.rules once known. A partner reading a files_finance or files_hr Firestore doc today (which the current rule permits) obtains the actual file's live download link, i.e. a full file-content exfiltration path, not just a listing of names. Storage-side partner exclusion (storage.rules:135-138) does NOT stop this because the leak happens one layer up, in Firestore.
- ⚠️ budgets_* has zero owner/dept check at all (allow read, write: if isAuth() && coll.matches('budgets_.*')) — any signed-in account, including a partner if one is ever granted broader base access, can create/update/delete ANY department's budget lines today. Narrowing this shares the same generic `{coll}` wildcard-matching mechanism as files_* — if Fable's chosen fix for either family involves parsing the collection-name suffix, a bug in that shared parsing approach risks breaking both families simultaneously; test the two independently after any change.
- ⚠️ Attendance rule changes interact with three separate live call sites that write different field subsets to the same doc path (js/app.js:3122-3128 self-check-in, js/app.js:3184-3187 notification-driven auto-upgrade, js/modules.js:1217-1223 admin Present/Half/Absent edit) plus payroll's read of attendanceScore for pay computation (per the payroll-collection-architecture and payroll-compute-existing-bug memories) — any new rule shape/value constraint must be checked against all three write paths or one of them will start silently failing (permission-denied), which given this app's history (CLAUDE.md: 'a missing rule = DENIED = blank screen unless .catch()'d') tends to surface as a confusing UI failure rather than a clear error.
- ⚠️ Partner-lockdown additions to /projects, /design_drawings, /quotes, /it_tickets, /it_assets, /it_software etc. risk breaking a legitimate partner-facing read if any Brilliant-Steel/Partners-tab screen currently depends on one of these collections for a reason not visible from firestore.rules alone — before blanket-denying, grep js/departments.js's renderBrilliantSteel/renderPartners-family functions for which of these collections a partner's own UI actually queries, to avoid a 'partner tab goes blank' regression symmetric to the blank-screen failure mode this repo has hit before.
- ⚠️ This workstream (19, Phase 2 'Foundation') edits the same firestore.rules file that workstream 20 (One payroll engine, Phase 3) will need to touch heavily (pay_runs/payroll/disburse president-only enforcement) and that other in-flight sessions may be editing concurrently (deploy-recheck-full-file-diff memory: OneDrive-synced concurrent sessions). A full-file rules replacement is the wrong deliverable shape for this reason alone — block-scoped, quotable-and-locatable diffs are required so Sonnet's Edit-tool exact-string matching succeeds and so this change composes with whatever else lands in firestore.rules before it's deployed.
- ⚠️ Deploy is a separate manual step from `git push` (firebase-deploy-rules memory + CLAUDE.md) — any build spec Fable writes must end with an explicit `firebase deploy --only firestore:rules` checklist line, not assume the app deploy covers it, or the fix will appear to do nothing in production exactly like the historical pattern CLAUDE.md warns about for cache-busting.

## Files likely touched

`firestore.rules`, `js/app.js (attendance self-write ~3111-3133 and ~3168-3189; username login lookup ~688-719; users update/create call sites if client-side validation needs to change to match new rules)`, `js/modules.js (admin attendance edit path ~1205-1225)`, `js/departments.js (files_ collection helpers ~10434-10523; budgets_ helpers ~10525-10647; APPROVAL_CAPS/renderApprovals ~9118-9230 if the UI needs to actively deny/hide an action the rules now also deny, rather than let it silently fail)`, `js/config.js (window.ROLES secretary definition and two-tier comment ~124-140; DEPARTMENTS if a canonical dept-key list is needed for files_/budgets_ scoping)`, `storage.rules (cross-check only — no functional change expected, but the partner/claims model there must stay consistent with whatever Firestore-side fix lands)`, `functions/index.js (only if the attendance fix is routed through a new Cloud Functions callable instead of a pure rules fix — open decision, not committed)`, `V12-PLAN.md (mark workstream 19 progress in the Build Log per this repo's resumption-document convention)`

## Expected deliverable format

> Fable's output for this workstream should be structured so Sonnet can apply it mechanically with the Edit tool (exact-string before/after matches), not re-derive intent:
> 
> 1. An exact firestore.rules DIFF expressed as named-block replacements keyed to the current quoted before-text captured in currentState above (not a full-file rewrite) — for each of: the files_* wildcard block (838-854), the budgets_* wildcard block (855-859), the attendance block (152-156), the users/{uid} block (89-110), and every specific isAdmin()/isFinanceOrAdmin() call site Fable decides to narrow. Each entry: `{file: firestore.rules, exact current text to match, exact replacement text}`.
> 
> 2. For the secretary two-tier decision specifically (the largest-surface item): a table, not prose — one row per call site Fable decides to change, columns {line number, current predicate, new predicate, one-line reason}. Given ~90 combined isAdmin()/isFinanceOrAdmin() call sites, Sonnet should not have to re-scan and re-judge each one; Fable must have already made and recorded that judgment per row.
> 
> 3. Any new helper function(s) (e.g. a narrower money-moving guard, or an isPartner()/isMinorAdmin() helper if Fable chooses to introduce one) written out as a complete, ready-to-insert code block with an explicit insertion point ("insert after line 23, before isFinanceOrAdmin()").
> 
> 4. For attendance: the complete new match block(s) (single block or split into /attendance/{uid} vs /attendance/{uid}/records/{date} if per-doc validation requires it), PLUS — if the chosen design requires any client-side change to keep the three existing write paths working — the exact before/after code block for each of app.js:3122-3128, app.js:3184-3187, and modules.js:1217-1223 (or, if routed through a Cloud Function instead, the new functions/index.js callable in full plus the three client call sites rewritten to call it).
> 
> 5. For files_*/budgets_*: the exact new wildcard-or-named-collection match block(s), and — only if the chosen design adds a `department`/`createdBy` field requirement that existing docs lack — a numbered one-time migration checklist (in this repo's existing idempotent-backfill style, e.g. mirroring backfillPayrollLedger) so currently-existing files_*/budgets_* docs aren't silently locked out the moment the new rule deploys.
> 
> 6. A manual test checklist, since this repo has no automated test suite (CLAUDE.md: "There is no build or test suite") — organized per changed collection, listing which of {president, manager, secretary, finance, employee, partner} test accounts should see success vs. permission-denied on which specific screen/action, so Sonnet (or Neil) can click through and verify without guessing what "correct" looks like.
> 
> 7. The deploy step called out as its own final checklist line: `~/.npm-global/bin/firebase deploy --only firestore:rules` (separate from `git push`), per this repo's established deploy-discipline convention.
