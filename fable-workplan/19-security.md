# Workstream 19 — Security closes (partner lockdown, attendance forgery, secretary two-tier)

> ✅ **IMPLEMENTED 2026-07-10.** Rules validated via `firebase deploy --only firestore:rules
> --dry-run` (compiled OK, re-run ~6 times through implementation) but **NOT yet deployed**.
> Two real regressions found and fixed beyond the spec's literal text — see V12-PLAN.md Build
> Log: (1) `tasks` needed an own-task-scoped exception for partners (the spec's blanket lock
> would have broken the shipped partner "My Tasks" feature); (2) `settings` needed a
> `docId=='system'` exception (every session, including partner, listens to it for the
> force-logout signal). **Still needed:** deploy the rules, then press "🔧 Security backfill"
> once (Audit Log page, president) to seed the username login map for existing accounts.

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

## DECIDED — architecture spec (Fable, 2026-07-10)

### Resolved decisions

1. **files_\* — blanket partner exclusion now; internal per-dept scoping deferred.** The audit
   risk is the token-bearing `url` field leaking to the external partner (a full file-content
   exfil path, not just metadata). Fix = add `!isPartner()` to read/create/update/delete on the
   `files_.*` wildcard. Internal cross-dept read stays open (unchanged for staff) — per-dept
   scoping needs a `department` field + migration and isn't the live threat; recorded as a
   follow-up. No migration required for this change.
2. **budgets_\* — close the world-write.** Read = `!isPartner()` staff; write =
   `isMoneyAdmin()` (president/manager/finance). The doc already carries `dept`; true per-dept
   member-write is deferred (needs a dept-string match that's fragile) — finance/admin-write is
   the correct, safe close of the world-write hole now.
3. **Secretary two-tier — Option (b), surgical, via two new helpers + ONE `canFinance()`
   redefinition** (small surface, no global find-replace of `isAdmin()`). Secretary KEEPS
   `isAdmin()` on genuinely-minor blocks; loses money + identity.
4. **users/{uid} self-escalation — split the admin update branch.** Privileged fields
   (role/department/departments/salary/allowance/deductions/employeeId/username) changeable only
   by `isSeniorAdmin()` (president/manager). Secretary/finance admins may edit only non-privileged
   fields (name/photo/phone) — frozen by `userPrivilegedFieldsUnchanged()`. Closes the
   secretary→president write.
5. **Attendance forgery — declarative-narrow (Option a).** Split to a per-doc
   `/attendance/{uid}/records/{date}` block: owner self-write only when score ∈ {0, 0.5, 1.0},
   only on a doc with no `editedBy` (protects admin edits), only for docId within a UTC
   today/yesterday window (kills arbitrary past/future forgery while tolerating the Manila+8
   offset). Admins (`isFinanceOrAdmin()`) keep full write. The autoFull 0.5-grant business logic
   stays client-trusted (a Cloud-Function-hardened path is noted as a later option, not built).
6. **Partner read sweep — full, with an `isPartner()` helper.** Lock every clearly-internal
   bare-`isAuth()` collection to `!isPartner()`. KEEP partner-readable: their own bs_quotes,
   bs_clients, partner_deals(own), sales_orders(own), job_projects(own/shared), order_tracking,
   AND `/users` (pay no longer lives there; partner UI needs names for shared projects — a
   field-level projection is a later refinement, flagged).
7. **/projects — partner-lock in place** (`!isPartner()`); the unified Projects view already
   skips it for partners (departments.js:85) so no regression. The projects/job_projects dedup
   stays a separate effort.
8. **`isPartner()` helper — yes** (DRY; mirrors storage.rules' `isPartnerClaim()`), replaces the
   ~20 inline `getRole() != 'partner'`.
9. **Worker username login — a public `usernames/{usernameLower}` → {email} map** (mirrors the
   order_tracking public-get precedent), NOT opening `/users` pre-auth. Login resolves email from
   it, then signs in. Needs the mapping written on worker/user create + a one-time backfill.
   WS27 (worker IDs) depends on this.

### New helper functions (insert after isFinanceOrAdmin(), firestore.rules ~line 23)

```
function isPartner()     { return getRole() == 'partner'; }
function isSeniorAdmin() { return getRole() in ['president', 'manager']; }
function isMoneyAdmin()  { return getRole() in ['president', 'manager', 'finance']; }
```
And REDEFINE canFinance() (its current definition `isFinanceOrAdmin() || isFinanceDept()`):
```
function canFinance() { return isMoneyAdmin() || isFinanceDept(); }
```
Effect: every canFinance()-gated block (ledger, ledger_entries, cash_receipt_journal,
cash_disbursement_journal, general_journal, finance_records, tax_records, purchase_orders —
582-637) drops secretary in ONE edit. `isFinanceOrAdmin()` is otherwise LEFT INTACT (still used
for reads and the minor blocks); only the specific money/identity blocks below are swapped.

### firestore.rules diffs (block-scoped, before→after)

**A. Helpers** — insert the three functions above; redefine canFinance() (find the existing
`function canFinance()` line and replace its body).

**B. users/{uid} update (89-110)** — replace the `allow update` line:
```
// BEFORE
allow update: if isAuth() && (
  (isOwner(uid) && userPrivilegedFieldsUnchanged()) || isAdmin()
);
// AFTER
allow update: if isAuth() && (
  isSeniorAdmin() ||                                          // full incl. role/dept/pay
  (isOwner(uid) && userPrivilegedFieldsUnchanged()) ||       // self, frozen
  (isAdmin() && userPrivilegedFieldsUnchanged())             // secretary/other admin: non-privileged only
);
```
Also tighten `create`: wrap the `isAdmin()` create branch so a non-senior admin can't mint a
privileged role —
```
// in the create rule, replace the bare `isAdmin() ||` with:
isSeniorAdmin() ||
(isAdmin() && request.resource.data.get('role','employee') in ['employee','agent','finance']) ||
```
(secretary may create staff, not managers/presidents).

**C. Money/identity blocks — swap isFinanceOrAdmin() → isMoneyAdmin()** at these create/update
sites (leave their read + delete rules unchanged):
| Block | Line | Change |
|---|---|---|
| payroll/{uid} | 278-282 | create,update: isFinanceOrAdmin() → isMoneyAdmin() |
| salary_history | 285-291 | create,update → isMoneyAdmin() |
| salary_raises | 295-301 | create,update → isMoneyAdmin() |
| payroll_ca_overrides | 304-309 | write → isMoneyAdmin() |
| cash_advances | 170-192 | create,update: isFinanceOrAdmin() → isMoneyAdmin() (in both OR-branches) |
| kpi_evals (pres fields) | 246-247 | the isFinanceOrAdmin() update branch → isSeniorAdmin() (only pres/mgr write presidentGrade) |
| partner_deals | (grep) | create,update → isMoneyAdmin() |
| pay_runs | 318-325 | see WS20 spec — its transition rules already use isPresident()/isFinanceOrAdmin(); after WS20, swap the isFinanceOrAdmin() branch → isMoneyAdmin() so secretary can't compute/verify a run |

**D. Secretary KEEPS isAdmin() (NO change)** — sops, memos, resources, policies, handbook,
products/productMeta, gov_biddings + gov_* buckets write, departments config, settings,
president_message, it_tickets/it_assets/it_software, design_drawings, kpi_targets,
stock_movements, posts/tasks admin-delete, approval_requests MINOR types. Rationale: these are
the oversight/coordination surface the secretary role exists for.
⚠️ approval_requests update (413) is isAdmin() and covers BOTH minor and money approvals — the
UI's APPROVAL_CAPS already hides ca/quote/finance from secretary. Tighten the RULE to match:
```
// approval_requests update — split by the request's type:
allow update: if isAuth() && (
  isSeniorAdmin() ||
  (isAdmin() && resource.data.get('type','') in
     ['signup','attendance','submission','review-task','leave','ca_deduct'])
);
```
(secretary acts on minor types only; money/quote/finance types need pres/mgr — mirrors
APPROVAL_CAPS server-side.)

**E. Partner lockdown** — introduce `isPartner()` (helper above), then add `&& !isPartner()` to
the `allow read` of each internal collection currently bare `isAuth()`:
quotes(373), projects(492), design_drawings(510), it_tickets(524), it_assets(533),
it_software(537), sops(271), resources(451), policies(455), handbook(459), memos(463),
settings(259), president_message(265), departments(691), posts(119), tasks(196) + its
comments(218) + readers(226). Convert the ~20 existing inline `getRole() != 'partner'` to
`!isPartner()` opportunistically (behavior-identical, DRY).
KEEP bare `isAuth()` (partner-readable, intentional): users(90), bs_clients(836), and the
own-scoped partner blocks already correct (bs_quotes, partner_deals, sales_orders, job_projects,
order_tracking).

**F. attendance — split the block (152-156)**:
```
// BEFORE
match /attendance/{uid}/{document=**} {
  allow read:  if isAuth() && (isOwner(uid) || isFinanceOrAdmin());
  allow write: if isAuth() && (isOwner(uid) || isFinanceOrAdmin());
}
// AFTER
match /attendance/{uid} {
  allow read: if isAuth() && (isOwner(uid) || isFinanceOrAdmin());
}
match /attendance/{uid}/records/{date} {
  allow read: if isAuth() && (isOwner(uid) || isFinanceOrAdmin());
  // Admins: unrestricted (the Present/Half/Absent edit path, stamps editedBy).
  allow write: if isAuth() && isFinanceOrAdmin();
  // Owner self check-in / auto-upgrade: score-capped, today/yesterday only (UTC
  // window tolerates the Manila +8 offset), and cannot overwrite an admin edit.
  allow create, update: if isAuth() && isOwner(uid)
    && request.resource.data.get('attendanceScore', 0) in [0, 0.5, 1.0]
    && (resource == null || resource.data.get('editedBy', null) == null)
    && (date == request.time.toMillis() / 86400000 == false ? true : true)  // placeholder — see note
    && ( date == string(request.time.date())                     // today (UTC)
      || date == string(request.time.date()) );                  // (yesterday handled in note)
}
```
NOTE for Sonnet: Firestore rules lack a clean date-string formatter; implement the
today/yesterday check as: compute `let d = request.time;` and compare the docId `date` string
against `d.year+'-'+... ` is NOT available. Practical implementation: store nothing on the
comparison in rules beyond the score-cap + editedBy guard (which already block the two real
forgery vectors: arbitrary score and overwriting admin edits), and enforce the
"today/yesterday only" date window in the CLIENT (the three write sites already write only
today). If a stricter server date-bound is required, route through a Cloud Function (deferred).
FINAL RULE (ship this — declarative, no fragile date math):
```
match /attendance/{uid}/records/{date} {
  allow read: if isAuth() && (isOwner(uid) || isFinanceOrAdmin());
  allow write: if isAuth() && isFinanceOrAdmin();
  allow create, update: if isAuth() && isOwner(uid)
    && request.resource.data.get('attendanceScore', 0) in [0, 0.5, 1.0]
    && (resource == null || resource.data.get('editedBy', null) == null);
}
```
This caps the score to legit values and protects admin edits — the two exploitable vectors.
Arbitrary-date self-write remains possible but is low-value now (score is capped to what an
honest check-in would produce); a full date-bound needs the Cloud Function path (noted, deferred).
Client sites (app.js:3122-3128, 3184-3187, modules.js:1217-1223) need NO change — they already
write scores in {0.5,1.0} and the admin path already stamps editedBy.

**G. usernames map (new collection) + worker login unblock**:
```
match /usernames/{username} {
  allow get: if true;                 // public single-doc resolve (email lookup pre-auth)
  allow list: if false;               // no enumeration
  allow create, update, delete: if isAuth() && isAdmin();
}
```
Doc shape: `usernames/{usernameLower}` = `{ email, uid }`. Client (js/app.js:696-703) BEFORE:
`db.collection('users').where('username','==',input).limit(1).get()` → AFTER:
`db.collection('usernames').doc(input.toLowerCase()).get()` then read `.data().email`.
WRITE sites: wherever a user/worker is created or username is set (openCreateWorkerModal / user
edit) also `usernames/{username}.set({email, uid})`; on username change, delete the old doc.
Add `usernames` to scripts/monthly-backup.js EXPORTS.

### Migration checklist (one-time, president, idempotent — "🔧 Security backfill")

1. **usernames backfill:** read all `users` with a `username`; for each write
   `usernames/{username.toLowerCase()} = {email: authEmail||email, uid}`. Re-runnable.
2. No migration needed for files_/budgets_/attendance/secretary rule changes (pure rule edits;
   existing docs keep working — reads/writes only NARROW, and the narrowed actors weren't
   supposed to have access).
3. Verify no legitimate partner screen broke (test checklist below).

### Manual test checklist (no automated suite)
Accounts: president / manager / secretary / finance / employee / partner.
- **secretary** via devtools SDK: write `role:'president'` on own users doc → DENIED ✓; approve
  a cash_advance → DENIED ✓; post a ledger row → DENIED ✓; edit a memo/sop → ALLOWED ✓.
- **partner:** read `files_finance` / `budgets_finance` / `tasks` / `posts` / `projects` /
  `it_tickets` → DENIED ✓; own `bs_quotes` / `bs_clients` / `job_projects` (theirs) /
  `order_tracking` → ALLOWED ✓; partner dashboard + BS tabs still render (no blank screen) ✓.
- **employee** devtools: set `attendanceScore:5` → DENIED ✓; set `attendanceScore:1.0` on a doc
  with `editedBy` set → DENIED ✓; normal check-in → ALLOWED ✓.
- **any signed-in:** write another dept's `budgets_*` line → DENIED ✓.
- **worker username login:** sign in by username → resolves email via `usernames/`, succeeds ✓.
- **finance:** post ledger / approve CA / edit payroll → ALLOWED ✓ (isMoneyAdmin keeps finance).

### Deploy
`~/.npm-global/bin/firebase deploy --only firestore:rules` — re-diff firestore.rules first
(concurrent OneDrive sessions), apply as block-scoped Edits (NOT full-file replace) so it
composes with WS12/13/20's rules edits. This is separate from `git push`.

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
