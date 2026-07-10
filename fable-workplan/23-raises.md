# Workstream 23 — Effective-Dated Raises (approval-routed, salary history timeline)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

V12-PLAN.md:100 (Phase 3, not started): "23. `[ ]` Raises — effective-dated raise workflow (pending raise auto-applies at first Compute on/after date), approval-routed, salary history timeline." The plan already commits to "approval-routed" and "auto-applies at first Compute" — Fable's job is the HOW, not whether-to.

THE RAISE FEATURE THAT EXISTS TODAY (js/departments.js:1981-2082), shared by Payroll + HR Profiles:

`openSalaryRaiseModal({subjectType, subjectId, subjectName, fieldLabel, current, applyRaise}, currentUser, onDone)` (departments.js:1985-2056). Comment at 1982-1984: "Applies a raise immediately and logs it to salary_raises (old→new, %, effective date, reason, who granted it). Finance/admin only; an affected app-user can read their own raise records."

Two call sites, both gated only by client-side `isFinancePriv()` (= `canEditDept('Finance')`, departments.js:27, itself departments.js:17-25 — true for president/owner/manager/secretary, true for role 'finance', AND true for ANY user whose `currentDepts` merely includes 'Finance' regardless of role, via the fallback `return (window.currentDepts||[]).includes(dept)` at line 24):

1. Payroll table "💸" button (departments.js:2462, handler 2468-2485) — `subjectType:'payroll'`, `applyRaise` = `await db.collection('payroll').doc(emp.id).set({ salary: nv }, { merge:true })` (line 2480). Comment: "Base salary lives in the protected payroll/{uid} doc, not the users doc."
2. HR Profiles "💸 Raise" button (departments.js:3621, handler 3638-3663) — `subjectType:'worker_profile'`, `applyRaise` = `await db.collection('worker_profiles').doc(profile.id).update({ dailyRate: nv, hourlyRate: newHourly, updatedAt:... })` (3655-3659), scaling hourlyRate proportionally to preserve the daily↔hourly ratio.

CRITICAL FINDING — the raise is NOT effective-dated today; it is immediate, always. The modal has an "Effective Date" input (`raise-eff`, departments.js:2003, `value="${today()}"`) and the save handler reads it (line 2029: `const eff = document.getElementById('raise-eff').value || today();`), but `eff` is used ONLY as a display/log field — written into the `salary_raises` doc as `effectiveDate: eff` (line 2040) and rendered back read-only in Raise History (line 2070). Confirmed by `grep -n "effectiveDate" js/*.js`: it appears at exactly those two lines and nowhere else in the entire codebase. Nothing gates on it, nothing compares it to "today" or to the Compute month. Clicking "Apply Raise" writes the new number to `payroll/{uid}` or `worker_profiles/{id}` synchronously, in the same click handler, before the `salary_raises` log write (lines 2032-2045) — so today, "effective date" is cosmetic history, not a schedule.

`openRaiseHistory(opts={})` (departments.js:2059-2082) — read-only log, queries `salary_raises` ordered by `createdAt desc` limit 200, optional client-side filter by `opts.subjectId`. Wired to a global "💸 Raise History" button on the Payroll screen (departments.js:2167, handler 2614) and on HR Profiles (departments.js:3601, handler 3636). This is the existing partial answer to the plan's "salary history timeline" phrase — but it is a flat admin-only log table, not a per-employee timeline in the employee's own profile/Personal-Finance view. Employees CAN technically read their own `salary_raises` docs per firestore.rules (subjectId==auth.uid), but the employee self-service screen (js/app.js renderPersonalFinance-equivalent, ~4190-4265) never queries `salary_raises` — it only queries `salary_history` (monthly netPay snapshots, a different collection, see dataModel) at app.js:4207. So an employee cannot currently see their own past raises anywhere in the UI.

THE COMPUTE FLOW WHERE CURRENT SALARY IS READ (the exact insertion point for a pending-raise check):

`renderPayrollManagement(container, currentUser, currentRole)` (departments.js:2128-...). The `employees` array — the thing the Compute button iterates — is built at departments.js:2144-2150:
```
const allStaff = usersSnap.docs.map(d=>({id:d.id,...d.data()})).filter(u=>!isExternalPartner(u));
const productionStaff = allStaff.filter(u=>u.payClass==='production');
const employees = allStaff.filter(u=>u.payClass!=='production')
  .sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
```
`usersSnap` comes from `fetchUsersWithPayroll()` (departments.js:2129, defined js/config.js:195-207), which merges `payroll/{uid}` fields onto each `users/{uid}` doc client-side: `const merged = { ...d.data(), ...(pay[d.id] || {}) };`. So `u.salary` on every `employees[i]` IS `payroll/{uid}.salary` as of right now, with zero concept of "pending" or "not yet effective."

The "Compute Payroll" click handler (`gen-payroll-btn`, departments.js:2616-2764) then reads `u.salary` THREE separate times in the same function:
1. Line 2630: `const base = u.salary||0;` — used to build the `salary_history/{uid}_{month}` snapshot doc (batch-written 2628-2652).
2. Line 2672: `const base = u.salary||0, allow = u.allowance||0;` — used to compute the per-employee ledger debit (`PAY-{month}-{uid}`, 2671-2703).
3. Line 2758: `(u.salary||0)+(u.allowance||0)-...` — used to compute `_runNet`, written onto the `pay_runs/{month}` doc as `totalNet` (2756-2764).

This is the exact point (all three reads, since they currently duplicate the same math) where a pending-raise resolution must be inserted — logically it should happen ONCE, before/at line ~2149-2150 when `employees`/`allStaff` is assembled (or at the very top of the `gen-payroll-btn` handler, before the loop), so all three downstream reads see the same resolved number. Doing it separately at each of the three sites risks the three numbers disagreeing (e.g. salary_history gets the new salary but the ledger debit still uses the stale in-memory `u.salary` if the resolution mutates a local copy inconsistently).

Two OTHER, UNLOGGED direct-write paths to the same salary fields exist and currently bypass `openSalaryRaiseModal`/`salary_raises` entirely — any pending-raise system must decide what to do with these:
- "✎ Edit Payroll" modal (departments.js:2487-2561, `edit-emp-pay-btn` → `save-ep-btn` at 2528-2559) — directly `db.collection('payroll').doc(uid).set({salary: ..., allowance: ..., ...}, {merge:true})` (2531-2540), no salary_raises log, no effective date, immediate.
- "✎ Edit" on a Worker Profile (departments.js:3665-3679 → `openHRProfileForm`, save handler 3746-3776, specifically `db.collection('worker_profiles').doc(profile.id).update(data)` at line 3776) where `data.dailyRate`/`data.hourlyRate` are freely editable (3756-3757) with no log, no effective date, immediate.

APPROVAL-ROUTING TEMPLATE ALREADY IN THE CODEBASE (financeDelete pattern), departments.js:130-227:
`window.financeDelete({collection, docId, label, onDone})` (departments.js:186-227) — if `isRealPresident()`, deletes immediately after `confirm()` (191-196); otherwise opens a modal collecting a reason and writes to `finance_delete_requests` with `{collection, docId, label, reason, requestedBy, requestedByName, status:'pending', createdAt}` (207-213), notifies the owner via `Notifs.sendToOwner` (214-218), and leaves the record untouched until the President approves. The Approvals screen resolves these (departments.js:9411-9432 and again 9671-9686 in a second "All" tab view) by calling `window.financeExecuteDelete(collection, docId)` (defined 178-181: cascade cleanup then the real delete) and flipping `status` to 'approved'/'denied' with a re-entrancy guard reading the request doc first to check it's still 'pending' (comment at 9414: "Guard against a stale click / second President session re-running an already-resolved request"). `payroll_delete_requests` (departments.js:2132, 2321, 2355-2378, 9169, 9249, 9415-9430, 9622, 9671-9686) is a payroll-specific twin of this same pattern, used specifically for deleting `salary_history` rows.

Nothing analogous exists yet for raises — `openSalaryRaiseModal`'s `applyRaise` always executes immediately for anyone `isFinancePriv()` returns true for; there is no pending/request state, no President sign-off step, at all today.

RULES-LEVEL GATING MISMATCH WORTH FLAGGING: firestore.rules:22 defines `isFinanceOrAdmin() { return getRole() in ['president','manager','secretary','finance']; }` — a plain 'employee' role who merely belongs to the Finance department (client-side `canEditDept('Finance')` → true via the departments-array fallback) would see the 💸 button and the Edit Payroll button, but their actual Firestore write to `payroll/{uid}` (rules:278-282, gated by `isFinanceOrAdmin()`) or `worker_profiles/{docId}` (rules:675-679, same gate) would be DENIED server-side. This is a pre-existing UI/rules mismatch (not introduced by this workstream) but any new `pending_raises`-style collection should be gated with `isFinanceOrAdmin()` to match the real enforcement boundary, not the looser client-side `canEditDept`.

## Data model

payroll/{uid} (firestore.rules:278-282) — the protected pay doc, separate from users/{uid} per the "Payroll collection architecture" convention. Fields actually read/written by the raise + Compute code: salary (number, base), allowance (number), deductions (number, "other"), sss, philhealth, pagibig, tax (numbers, currently hand-typed — WS21's job to make computed), payClass ('regular'|'production', departments.js:2532). Rules: read = owner or isFinanceOrAdmin(); create/update = isFinanceOrAdmin(); delete = isPresident() only. Merged onto the users doc client-side by fetchUsersWithPayroll (js/config.js:195-207) for ~70 existing `u.salary`-style reads across the app — comment there: "Non-admins get an empty payroll map (their unfiltered payroll query is denied → .catch), so they never see others' pay."

salary_history/{uid}_{month} (firestore.rules:285-291) — deterministic docId (idempotent per employee per month), written by the Compute handler (departments.js:2642-2650). Fields: userId, userName, month ('YYYY-MM'), salary, allowance, deductions, sss, philHealth, pagIbig, tax, caDeducted, netPay, finalPay, recordedBy, recordedAt, and later merged with caDeductions[] (array of {caId, amount}, written conditionally at 2741-2742, used by financeDeleteCascade at departments.js:145-160 to reverse cash-advance balances if the run is deleted). This is the per-month PAY snapshot the employee's own Personal Finance screen reads (js/app.js:4207, `.where('userId','==',uid).orderBy('month','desc').limit(12)`) — distinct from raises. NOTE: today this snapshot is not actually immutable — re-running Compute for an already-generated month (the `alreadyGenerated` guard, departments.js:2623-2625) overwrites salary/allowance/etc. with whatever payroll/{uid} holds NOW, not what it held when that month was originally computed. WS20 ("past months reprint exactly") and WS23 (effective-dated raises) both bear on fixing this.

salary_raises/{autoId} (firestore.rules:293-300) — the existing raise audit log, written only by openSalaryRaiseModal (departments.js:2034-2045). Fields: subjectType ('payroll'|'worker_profile'), subjectId, subjectName, field (fieldLabel, e.g. 'Base Salary'|'Daily Rate'), oldAmount, newAmount, changeAmount, changePct, effectiveDate (string 'YYYY-MM-DD', currently unused for gating — display only), reason (free text), grantedBy (uid), grantedByName, createdAt (serverTimestamp). Rules: read = subject (own) or isFinanceOrAdmin(); create/update = isFinanceOrAdmin(); delete = isPresident() only.

worker_profiles/{docId} (firestore.rules:675-679) — the separate HR-managed roster for weekly-paid production workers (distinct from users docs; per WS27 notes these workers may not even have app logins yet — "worker login unblock ... currently orphaned"). Fields relevant here: name, dailyRate, hourlyRate, foodAllowance, allowances{meal,transport}, caBalance, includeInPayroll, status, payClass is NOT a field here (that's on the users/payroll side) — created/edited via openHRProfileForm (departments.js:3681-3785). Rules: read/write = isFinanceOrAdmin() only; delete = isPresident() only.

Pre-existing but separate "production" concept collision worth noting for schema design: users docs can independently carry payClass:'production' (departments.js:2148, `productionStaff = allStaff.filter(u=>u.payClass==='production')`) which is used ONLY to render an informational banner (departments.js:2172) explaining why they're excluded from the monthly Compute run — it is not linked by ID to any worker_profiles doc. So "production pay" currently has two seemingly-unconnected representations: users-with-payClass-production (excluded, unclear where they're actually paid) and the standalone worker_profiles roster (paid via openPayslipGenerator). A pending-raises design must pick one canonical shape per subjectType and should flag rather than silently paper over this pre-existing ambiguity.

approval-request pattern reference shape (finance_delete_requests / payroll_delete_requests, firestore.rules — not yet re-grepped for their exact rule block but present in departments.js as shown above): {collection, docId, label, reason, requestedBy, requestedByName, status:'pending'|'approved'|'denied', createdAt, resolvedBy, resolvedAt}. This is the closest existing template for what a pending_raises collection's request/approval half might look like, if Fable chooses to reuse rather than invent a new shape.

No Cloud Function or scheduled trigger exists today (functions/index.js exports only sendPushOnNotification, createUserDocOnAuthCreate, adminResetPassword, syncUserClaims, backfillUserClaims — grep confirms no functions.pubsub/onSchedule anywhere). So "auto-applies at first Compute on/after date" per the plan wording is necessarily a client-side, Compute-time check today — there is no existing infrastructure for a server-side midnight cron to flip a raise's status automatically the day it becomes effective.

## Constraints — must respect

- Load order / global-function convention (CLAUDE.md, index.html): openSalaryRaiseModal/openRaiseHistory live in js/departments.js and are called with plain function references (not window.*) from within the same file — any new pending-raise functions can follow the same in-file convention, but if referenced from js/app.js (e.g. an employee-facing raise timeline) they must be attached to window.* since departments.js loads after app.js in index.html's fixed script order.
- Idempotency pattern already established for Compute (departments.js:2620-2625, 2642 doc id `${u.id}_${month}`, 2677-2685 ledger upsert by deterministic refNumber `PAY-{month}-{uid}`): any pending-raise auto-apply logic inserted into Compute must be safe to run twice for the same month (Compute is explicitly re-runnable) without double-applying a raise or re-decrementing something. The existing `alreadyGenerated` flag (2623-2625) is the closest existing guard to hook into.
- Manila-time discipline (CLAUDE.md, memory note manila_time_helpers): the existing raise modal already default-dates via `today()` (departments.js:11, wraps window.bizDate()) — any date comparison (effectiveDate vs. "now", or vs. the month being computed) must use window.bizDate()/bizDow(), never new Date()/toISOString(), to avoid the off-by-one-day bug this codebase has already been bitten by.
- escHtml() discipline (CLAUDE.md, modules.js): every existing raise-history render call escapes user-supplied strings (departments.js:2070-2077, e.g. escHtml(r.reason), escHtml(r.grantedByName)) — new UI (pending-raise lists, approval cards) must do the same.
- Firestore rules coverage requirement (memory note firestore-rules-collection-coverage): a brand-new collection like pending_raises needs its OWN explicit `match` block in firestore.rules — it will not inherit coverage from salary_raises or payroll by prefix or nesting. Missing-field reads in rules also throw (memory note firestore-rules-missing-field-throws) — any rule checking a field on the pending-raise doc must use `.get(field, default)`.
- Every existing finance-record delete flow in this codebase (financeDelete, departments.js:186-227) routes through President approval for anyone who is not the President; V12-PLAN.md:100 already states raises must be "approval-routed" — whatever mechanism WS23 picks should be recognizable as a sibling of this existing pattern (or explicitly justified as different), not an ad hoc one-off.
- Rules-level role check for anything payroll-adjacent should use isFinanceOrAdmin() (firestore.rules:22 — president/manager/secretary/finance) as the enforcement boundary, not the looser client-side canEditDept('Finance') (departments.js:17-25) which also admits any Finance-department 'employee'. The two are already inconsistent for payroll/worker_profiles writes today; a new pending_raises collection should not add a third, differently-scoped gate.
- The Compute handler (departments.js:2616-2764) currently reads u.salary three separate times (2630, 2672, 2758) for three different downstream writes (salary_history, ledger, pay_runs). Any pending-raise resolution must happen once and be threaded through consistently, not recomputed independently at each site (or the three artifacts for the same month could disagree on the employee's salary).

## DECIDED — architecture spec (Fable, 2026-07-10)

> Composes with WS20 (payroll engine), WS12 (Period), WS19 (rules helpers), WS21/WS22. The
> raise never touches `computePayRun`/`computePayLine` — it lands on the *base-of-record*
> (`payroll/{uid}.salary`, `worker_profiles/{id}.dailyRate`) **before** Compute reads it, via a
> month-gated screen-load sweep. This is the single resolution point and keeps WS20's Compute
> strictly read-only.

### Resolved decisions

1. **Storage shape → new top-level `pending_raises` collection (the SCHEDULE + APPROVAL lifecycle); `salary_raises` stays untouched as the immutable APPLIED audit log.** Two collections, clean split: `pending_raises` is queryable by `status` (single-field, no composite index), supports multiple queued future raises per person, and mirrors `finance_delete_requests`' request→approve lifecycle. `salary_raises` is written *only at materialization* (so every row in it is, by construction, a realized raise) — `openRaiseHistory` keeps working verbatim. Rationale: bolting `status` onto `salary_raises` would make the audit log mutable and pollute it with never-applied requests; a scalar `pendingSalary` field on `payroll/{uid}` supports only one queued raise and blurs the read model 70+ call sites depend on.
2. **Resolution point → a month-gated sweep `window.applyDueRaises(subjectType)` at SCREEN LOAD (top of `renderPayrollManagement` for `'payroll'`, top of `renderFinanceHRProfiles` for `'worker_profile'`), NOT inside `computePayRun`.** The sweep writes the resolved base into `payroll/{uid}.salary` (the canonical field `fetchUsersWithPayroll` merges and all ~70 `u.salary` reads consume). By the time the Compute button is clickable, the base is already current, so `computePayRun` reads `u.salary` as-is and needs **zero edits** — this is the minimal-collision composition with WS20's rewrite. Rationale: the brief's "single resolution point before the three `u.salary` reads" is satisfied by mutating the source-of-truth once at load rather than threading an in-memory override through WS20's pure `computePayLine`.
3. **"On/after the date" semantics → gated by `effectiveMonth <= currentBizMonth` (wall-clock Manila month at sweep time), NOT the Compute picker month.** A future-dated raise (`effectiveMonth > currentBizMonth`) is **never** materialized, so it can never leak into any Compute — current or a re-run of a past month. Once a raise's month has actually arrived it materializes into `payroll.salary`; from then on every run reads the raised base, which is correct (a raise effective May belongs in May). Residual, documented and accepted: re-computing a *past, still-undisbursed* month after a raise has since materialized will reflect the raised base — but WS20 D4 makes disbursed months reprint from frozen `lines[]`, so real payslips/history never change; this residual is identical to today's behavior for any `Edit Payroll` salary change and is not a new bug. Full salary-timeline reconstruction (replay to any month) is explicitly out of scope.
4. **Approval routing → mirror `financeDelete` exactly: President acts immediately, everyone else files a request.** No peso/percent threshold (nothing to bikeshed; raises are as sensitive as deletes). Non-President finance (`isFinanceOrAdmin` minus president) can only create a `pending_approval` request — enforced in `firestore.rules` at the data layer, closing today's "any Finance-dept user grants unilaterally" hole. The President approves/rejects in the Approvals tab (sibling of the `payroll_delete_requests` block). Rationale: recognizable, already-audited governance pattern; no new capability model.
5. **Both bypass paths CLOSED for the governed field only.** `Edit Payroll` (departments.js:2496-2540): the `salary` input becomes read-only display ("Change base pay via 💸 Give Raise") and `salary:` is dropped from the `.set()`; allowance/deductions/statutory stay directly editable (they're corrections, not raises). `openHRProfileForm` (departments.js ~3681-3785): `dailyRate`/`hourlyRate` inputs are read-only in **edit** mode, editable in **create** mode (setting a new hire's initial rate is not a raise). Rationale: without this the effective-dating + approval guarantees are trivially bypassable; the President loses nothing because immediate grants remain one click via the raise modal.
6. **Salary-history timeline → BOTH surfaces, split by audience.** `openRaiseHistory` stays the admin *applied* log (unchanged) and gains a sibling admin panel "Scheduled / Pending raises" reading `pending_raises`. A new "Salary changes" card is added to the employee's own Personal Finance screen (app.js, after the `salary_history` query ~4207) reading `salary_raises where subjectId==uid` — **applied raises only**. Employees are **not** shown `pending_approval`/`scheduled` raises (a queued raise may be revised/cancelled; premature disclosure is an HR risk). Rationale: `salary_raises` is inherently applied-only, so the employee card is safe by construction.
7. **Production-pay ambiguity → NOT a prerequisite.** WS23 keeps exactly two `subjectType`s: `'payroll'` (→ `payroll/{uid}.salary`) and `'worker_profile'` (→ `worker_profiles/{id}.dailyRate`+scaled `hourlyRate`). It does not reconcile the `payClass:'production'`-user-vs-`worker_profiles`-roster split — that is WS20's `linkedUid` reconciliation. Flagged, deferred.
8. **Effective-date-arrived-but-Compute-not-run → no Cloud Function; screen-load sweep + banner.** `applyDueRaises` auto-applies due raises whenever Finance opens the Payroll or HR screen (the plan's "auto-applies at first Compute" realized as "first visit on/after the date"). A client-side banner on the Payroll screen surfaces *upcoming* future-dated scheduled raises and the pending-approval count. No `functions.pubsub`/`onSchedule` is added. **‼️ FLAG FOR NEIL:** if he wants a true midnight-of-effective-date auto-apply independent of anyone opening a screen, that is net-new Cloud Function infra (added scope). Recommendation: screen-load sweep is sufficient — payroll is only ever run from these screens anyway.

---

### Spec 1 — Data shape: `pending_raises/{autoId}` (annotated literal)

```js
// pending_raises/{autoId}  — schedule + approval lifecycle. Finance create; President approves;
// the screen-load sweep materializes. Subject may read their own.
{
  subjectType:   'payroll',              // 'payroll' | 'worker_profile'
  subjectId:     'AbC…uid',              // payroll → Firebase uid; worker_profile → worker_profiles docId
  subjectName:   'Juan Dela Cruz',
  field:         'Base Salary',          // fieldLabel (display) — 'Base Salary' | 'Daily Rate'
  targetField:   'salary',               // NEW — Firestore field the materializer writes: 'salary' | 'dailyRate'
  oldAmount:     25000,                   // snapshot at schedule time (audit uses LIVE value at apply)
  newAmount:     28000,
  changeAmount:  3000,
  changePct:     12,                      // number | null (null when oldAmount==0)
  effectiveDate: '2026-08-01',            // 'YYYY-MM-DD'
  effectiveMonth:'2026-08',               // NEW — effectiveDate.slice(0,7); the month-gate key
  reason:        'Annual increase',
  status:        'scheduled',             // 'pending_approval'|'scheduled'|'applied'|'rejected'|'cancelled'
  requestedBy:   'uid…', requestedByName:'Finance Clerk',
  approvedBy:    'presUid', approvedByName:'Neil Barro',
  approvedAt:    <serverTimestamp>,       // set when President approves (or when President creates directly)
  appliedAt:     null,                    // <serverTimestamp> at materialize
  appliedInMonth:null,                    // 'YYYY-MM' bizMonth at materialize
  rejectedBy:null, rejectedByName:null, rejectedAt:null, rejectReason:null,
  salaryRaiseId: null,                    // NEW — id of the salary_raises audit doc (== this docId, see materialize)
  createdAt:     <serverTimestamp>
}
```

`salary_raises` doc shape is **unchanged** (subjectType, subjectId, subjectName, field, oldAmount, newAmount, changeAmount, changePct, effectiveDate, reason, grantedBy, grantedByName, createdAt) — but is now written with a **deterministic docId == the `pending_raises` docId** so re-running the sweep can never create a duplicate audit row.

### Spec 2 — New service `window.RaiseFlow` (insert in js/departments.js immediately below `openRaiseHistory`, ~after line 2082)

```js
// ── Raise lifecycle service (schedule → approve → materialize) ──────────────
// pending_raises holds the schedule; salary_raises is the applied audit log.
// President acts immediately; everyone else files a pending_approval request.
window.RaiseFlow = (function () {
  const nowMonth = () => today().slice(0, 7);            // today() wraps window.bizDate() → 'YYYY-MM-DD'

  // Create a raise. President → 'scheduled' (+ apply now if due). Others → 'pending_approval'.
  async function submitRaise(desc, { newAmount, effectiveDate, reason }) {
    const u = window.currentUser || auth.currentUser || {};
    const cur = parseFloat(desc.current) || 0;
    const eff = effectiveDate || today();
    const effMonth = eff.slice(0, 7);
    const isPres = typeof isRealPresident === 'function' && isRealPresident();
    const base = {
      subjectType: desc.subjectType, subjectId: desc.subjectId, subjectName: desc.subjectName || '',
      field: desc.fieldLabel, targetField: desc.targetField,
      oldAmount: cur, newAmount,
      changeAmount: +(newAmount - cur).toFixed(2),
      changePct: cur > 0 ? +((newAmount - cur) / cur * 100).toFixed(2) : null,
      effectiveDate: eff, effectiveMonth: effMonth, reason: reason || '',
      requestedBy: u.uid || '', requestedByName: window.userProfile?.displayName || u.email || '',
      appliedAt: null, appliedInMonth: null, salaryRaiseId: null,
      rejectedBy: null, rejectedByName: null, rejectedAt: null, rejectReason: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (isPres) {
      const ref = await db.collection('pending_raises').add({
        ...base, status: 'scheduled',
        approvedBy: u.uid, approvedByName: base.requestedByName,
        approvedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (effMonth <= nowMonth()) await materialize(ref.id);   // same-day/back-dated → apply now
      return { outcome: 'applied-or-scheduled', id: ref.id };
    }
    const ref = await db.collection('pending_raises').add({
      ...base, status: 'pending_approval', approvedBy: null, approvedByName: null, approvedAt: null
    });
    await safeNotify(() => Notifs.sendToOwner({
      title: '💸 Raise Approval Request',
      body: `${base.requestedByName} requested a raise for ${base.subjectName}: ₱${fmt(cur)} → ₱${fmt(newAmount)} (eff ${eff}).`,
      icon: '💸', type: 'raise_request'
    }));
    return { outcome: 'requested', id: ref.id };
  }

  // Materialize a scheduled raise: write base-of-record + salary_raises audit + status→applied.
  // Idempotent: guarded on status=='scheduled'; salary_raises id == pending_raises id (merge).
  async function materialize(raiseId) {
    const snap = await db.collection('pending_raises').doc(raiseId).get();
    if (!snap.exists) return;
    const r = snap.data();
    if (r.status !== 'scheduled') return;                    // re-entrancy / already applied
    let liveOld = r.oldAmount;
    if (r.subjectType === 'payroll') {
      const p = await db.collection('payroll').doc(r.subjectId).get();
      liveOld = (p.exists && typeof p.data().salary === 'number') ? p.data().salary : r.oldAmount;
      await db.collection('payroll').doc(r.subjectId).set({ salary: r.newAmount }, { merge: true });
    } else { // worker_profile — scale hourly from LIVE values (rate may have moved since schedule)
      const wp = await db.collection('worker_profiles').doc(r.subjectId).get();
      const curDaily = (wp.exists && wp.data().dailyRate) || 0;
      const curHourly = (wp.exists && wp.data().hourlyRate) || 0;
      liveOld = curDaily || r.oldAmount;
      const newHourly = curDaily > 0 ? +((curHourly * (r.newAmount / curDaily))).toFixed(2) : +(r.newAmount / 8).toFixed(2);
      await db.collection('worker_profiles').doc(r.subjectId).update({
        dailyRate: r.newAmount, hourlyRate: newHourly,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    // Audit log — deterministic id so a retried sweep overwrites instead of duplicating.
    await db.collection('salary_raises').doc(raiseId).set({
      subjectType: r.subjectType, subjectId: r.subjectId, subjectName: r.subjectName || '',
      field: r.field, oldAmount: liveOld, newAmount: r.newAmount,
      changeAmount: +(r.newAmount - liveOld).toFixed(2),
      changePct: liveOld > 0 ? +((r.newAmount - liveOld) / liveOld * 100).toFixed(2) : null,
      effectiveDate: r.effectiveDate, reason: r.reason || '',
      grantedBy: r.approvedBy || r.requestedBy || '', grantedByName: r.approvedByName || r.requestedByName || '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await db.collection('pending_raises').doc(raiseId).update({
      status: 'applied', appliedAt: firebase.firestore.FieldValue.serverTimestamp(),
      appliedInMonth: nowMonth(), salaryRaiseId: raiseId
    });
    window.logAudit && window.logAudit('raise-apply', r.subjectType, r.subjectId, { from: liveOld, to: r.newAmount });
    if (r.subjectType === 'payroll' && r.subjectId) {
      await safeNotify(() => Notifs.send(r.subjectId, {
        title: '💸 Salary Update',
        body: `Your ${r.field} changed from ₱${fmt(liveOld)} to ₱${fmt(r.newAmount)}, effective ${r.effectiveDate}.`,
        icon: '💸', type: 'raise_applied'
      }));
    }
    if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('users'); dbCacheInvalidate('payroll'); }
  }

  // Screen-load sweep: apply every scheduled raise whose month has arrived. Month-gated so
  // future-dated raises never leak into any Compute. Single-field query → no composite index.
  async function applyDueRaises(subjectType) {
    const nm = nowMonth();
    const snap = await db.collection('pending_raises').where('status', '==', 'scheduled').get().catch(() => ({ docs: [] }));
    const due = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(r => r.subjectType === subjectType && (r.effectiveMonth || r.effectiveDate.slice(0, 7)) <= nm);
    for (const r of due) { try { await materialize(r.id); } catch (e) { console.error('applyDueRaises', r.id, e); } }
    return due.length;
  }

  // President approves a pending_approval request → schedule (+ apply if already due).
  async function approve(raiseId) {
    const ref = db.collection('pending_raises').doc(raiseId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().status !== 'pending_approval') return 'stale'; // re-entrancy guard
    const u = window.currentUser || auth.currentUser || {};
    await ref.update({
      status: 'scheduled', approvedBy: u.uid,
      approvedByName: window.userProfile?.displayName || u.email || 'President',
      approvedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    const r = snap.data();
    await safeNotify(() => Notifs.send(r.requestedBy, { title: '✅ Raise Approved',
      body: `Your raise request for ${r.subjectName} was approved.`, icon: '✅', type: 'raise_request' }));
    if ((r.effectiveMonth || r.effectiveDate.slice(0, 7)) <= nowMonth()) await materialize(raiseId);
    return 'approved';
  }

  async function reject(raiseId, reason) {
    const ref = db.collection('pending_raises').doc(raiseId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().status !== 'pending_approval') return 'stale';
    const u = window.currentUser || auth.currentUser || {};
    await ref.update({ status: 'rejected', rejectedBy: u.uid,
      rejectedByName: window.userProfile?.displayName || u.email || 'President',
      rejectedAt: firebase.firestore.FieldValue.serverTimestamp(), rejectReason: reason || '' });
    const r = snap.data();
    await safeNotify(() => Notifs.send(r.requestedBy, { title: '❌ Raise Declined',
      body: `Your raise request for ${r.subjectName} was declined.${reason ? ' Reason: ' + reason : ''}`,
      icon: '❌', type: 'raise_request' }));
    return 'rejected';
  }

  return { submitRaise, materialize, applyDueRaises, approve, reject };
})();
```

### Spec 3 — `openSalaryRaiseModal` signature change + save handler (departments.js:1985-2056)

Signature loses `applyRaise`, gains `targetField`. **Before** (1985): `function openSalaryRaiseModal({ subjectType, subjectId, subjectName, fieldLabel, current, applyRaise }, currentUser, onDone) {`
**After:** `function openSalaryRaiseModal({ subjectType, subjectId, subjectName, fieldLabel, targetField, current }, currentUser, onDone) {`

The primary button label is date/role aware. **Before** (2006): `<button class="btn-primary" id="raise-save-btn">Apply Raise</button>…`
**After:** compute label once —
```js
const _isPres = typeof isRealPresident === 'function' && isRealPresident();
// default eff-date is today() → same-day. Button text updates live as the date changes.
const _btnLabel = () => {
  const effM = (document.getElementById('raise-eff')?.value || today()).slice(0,7);
  if (!_isPres) return 'Request Raise';
  return effM <= today().slice(0,7) ? 'Apply Raise' : 'Schedule Raise';
};
```
Render the button as `id="raise-save-btn"` with initial text `_isPres ? 'Apply Raise' : 'Request Raise'`, and add `document.getElementById('raise-eff').addEventListener('change', () => { const b=document.getElementById('raise-save-btn'); b.textContent=_btnLabel(); });` next to the other input listeners (~2022).

**Before** — save handler body (2032-2049):
```js
try {
  await applyRaise(nv);
  await db.collection('salary_raises').add({ …immediate audit… });
  window.logAudit && window.logAudit('raise', subjectType, subjectId, { from: cur, to: nv });
  closeModal();
  Notifs.showToast(`Raise applied: ₱${fmt(cur)} → ₱${fmt(nv)}`);
  onDone && onDone();
} catch (e) { … }
```
**After:**
```js
try {
  const res = await window.RaiseFlow.submitRaise(
    { subjectType, subjectId, subjectName, fieldLabel, targetField, current: cur },
    { newAmount: nv, effectiveDate: eff, reason }   // reason/eff already read at 2028-2029
  );
  closeModal();
  if (res.outcome === 'requested')
    Notifs.showToast('Raise sent to the President for approval.');
  else
    Notifs.showToast(`Raise ${eff.slice(0,7) <= today().slice(0,7) ? 'applied' : 'scheduled'}: ₱${fmt(cur)} → ₱${fmt(nv)}`);
  onDone && onDone();
} catch (e) {
  console.error('raise failed', e);
  btn.disabled = false; btn.textContent = _isPres ? 'Apply Raise' : 'Request Raise';
  Notifs.showToast('Failed to submit raise','error');
}
```
(All `escHtml()`/`fmt()`/`today()` usages are preserved; no raw `Date`.)

### Spec 4 — Two call sites lose their `applyRaise` closures

**Payroll 💸 button (departments.js:2472-2483)** — **Before** passes `applyRaise: async (nv)=>{ await db.collection('payroll')… }`. **After:**
```js
openSalaryRaiseModal({
  subjectType:'payroll', subjectId:emp.id, subjectName:emp.displayName||emp.email,
  fieldLabel:'Base Salary', targetField:'salary', current: emp.salary||0
}, currentUser, () => loadPayrollTable(month));
```
**HR Profiles 💸 Raise (departments.js:3643-3661)** — **After:**
```js
openSalaryRaiseModal({
  subjectType:'worker_profile', subjectId:profile.id, subjectName:profile.name||'Worker',
  fieldLabel:'Daily Rate', targetField:'dailyRate', current: profile.dailyRate||0
}, currentUser, () => renderFinanceHRProfiles(container,currentUser,currentRole));
```
The hourly-scaling that used to live in the closure now lives in `RaiseFlow.materialize` (reads live values). No behavior lost.

### Spec 5 — Screen-load sweeps + banner

- **`renderPayrollManagement` (departments.js:2128, first `await` in the body):** add `await window.RaiseFlow.applyDueRaises('payroll').catch(()=>{});` **before** `fetchUsersWithPayroll()` so `u.salary` is current for Compute.
- **`renderFinanceHRProfiles` (departments.js:3578, before the `profiles` fetch):** add `await window.RaiseFlow.applyDueRaises('worker_profile').catch(()=>{});`.
- **Payroll banner** (render near the month-picker strip): query once and show upcoming/pending counts (all string interpolation `escHtml`-safe — these are numbers):
```js
const _prSnap = await db.collection('pending_raises').where('status','in',['scheduled','pending_approval']).get().catch(()=>({docs:[]}));
const _nm = today().slice(0,7);
const _upcoming = _prSnap.docs.filter(d=>d.data().status==='scheduled' && (d.data().effectiveMonth||'') > _nm).length;
const _pending  = _prSnap.docs.filter(d=>d.data().status==='pending_approval').length;
const raiseBanner = (_upcoming||_pending)
  ? `<div class="info-banner" style="margin:8px 0">💸 ${_upcoming} scheduled raise(s) upcoming${_pending?` · ${_pending} awaiting President approval`:''}. <button class="btn-secondary btn-sm" id="pr-view-raises">View</button></div>`
  : '';
// #pr-view-raises → openScheduledRaises() (Spec 7)
```
`where('status','in',[...])` is a single-field `in` filter → no composite index required.

### Spec 6 — Close the two bypass paths

**Edit Payroll (departments.js:2505):** **Before** `<input id="ep-salary" type="number" value="${emp.salary||0}" …/>`. **After** (read-only display, no input to submit):
```js
<div class="form-group"><label>${_payClass==='production'?'Weekly Rate':'Base Salary'}</label>
  <div style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface-2);color:var(--text-muted)">
    ₱${fmt(emp.salary||0)} · <span style="font-size:11px">change via 💸 Give Raise (approval-routed)</span>
  </div>
</div>
```
And in the save handler (departments.js:2531-2540) **remove** the `salary:` line from the `.set()` payload (and the `salary` field from the `logAudit` call at 2542 → log `allowance` instead). Everything else in that modal is unchanged.

**Worker Profile Edit (`openHRProfileForm`, departments.js:3681-3785):** the form is shared by create (`profile==null`) and edit. Gate the two rate inputs (~3756-3757) on mode: when editing an existing profile render them read-only with the same "change via 💸 Raise" hint; when creating keep the live `<input>`s. In the save handler (`db.collection('worker_profiles').doc(profile.id).update(data)` at 3776) **omit `dailyRate`/`hourlyRate` from `data` when `profile` is truthy** (edit mode) so an edit can never silently move the rate. Create mode still writes them.

### Spec 7 — Admin scheduled/pending list + Approvals-tab wiring

New `window.openScheduledRaises()` in departments.js (below `openRaiseHistory`): reads `pending_raises where status in ['scheduled','pending_approval']`, renders a `data-table` (Effective, Employee, Old→New, Status badge, By) with all user strings `escHtml`-wrapped, and — for `pending_approval` rows when `isRealPresident()` — inline **Approve** / **Reject** buttons calling `RaiseFlow.approve(id)` / prompting a reason then `RaiseFlow.reject(id,reason)`, re-rendering on resolve. Wire `#hrp-raise-history-btn` (3636) and the Payroll `#pr-view-raises` banner button to it (keep `openRaiseHistory` as the *applied* log).

**Approvals tab** (mirror the `payroll_delete_requests` blocks ~9411-9432 / 9671-9686): add a `pending_raises where status=='pending_approval'` section. Each card:
```js
// re-entrancy: RaiseFlow.approve/reject re-read the doc and no-op if status !== 'pending_approval'
approveBtn.onclick = async () => { const r = await window.RaiseFlow.approve(id);
  Notifs.showToast(r==='approved'?'Raise approved.':'Already resolved.'); reloadApprovals(); };
rejectBtn.onclick  = async () => { const reason = prompt('Reason for declining (optional):')||'';
  await window.RaiseFlow.reject(id, reason); Notifs.showToast('Raise declined.'); reloadApprovals(); };
```

### Spec 8 — Employee self-view timeline (js/app.js, after the salary_history query ~4207)

Add, after the existing `salary_history` fetch:
```js
const _raiseSnap = await db.collection('salary_raises').where('subjectId','==',currentUser.uid).limit(50).get().catch(()=>({docs:[]}));
const _raises = _raiseSnap.docs.map(d=>d.data()).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)); // client-sort → no composite index
```
Render a "Salary changes" card only if `_raises.length`, each row `escHtml`-wrapping `reason`/`grantedByName` and `fmt()`-formatting amounts, columns Effective · Old→New · Change · Reason. **No `pending_raises` query here** — employees see applied raises only.

### Spec 9 — firestore.rules: NEW `pending_raises` block (insert after the `salary_raises` block, ~line 301)

```
    // ── Pending / scheduled raises (approval-routed schedule) ──────────
    // Non-president finance may only FILE a request (status pending_approval);
    // President approves → scheduled; the screen-load sweep materializes
    // (scheduled → applied). Subject may read their own.
    match /pending_raises/{docId} {
      allow read: if isAuth() && (
        resource.data.subjectId == request.auth.uid || isFinanceOrAdmin()
      );
      allow create: if isAuth() && (
        isPresident()
        || ( isFinanceOrAdmin()
             && request.resource.data.get('status','') == 'pending_approval' )
      );
      allow update: if isAuth() && (
        // Automated materialize: any finance, ONLY scheduled → applied.
        ( isFinanceOrAdmin()
          && resource.data.get('status','') == 'scheduled'
          && request.resource.data.get('status','') == 'applied' )
        // Approve / reject / cancel / reschedule: President only.
        || isPresident()
      );
      allow delete: if isAuth() && isPresident();
    }
```
`.get(field, default)` is used on every field read (missing-field-denies hazard). Result: a non-President finance user can create only `pending_approval` and can only push a President-approved `scheduled` raise to `applied` — they can never self-approve. `salary_raises`, `payroll`, `worker_profiles` blocks are **unchanged** (materialize writes are already covered by their `isFinanceOrAdmin()` create/update). Deploy via `firebase deploy --only firestore:rules` (re-`git diff` first per the concurrent-edit memory note). **No `firestore.indexes.json` change** — every query is single-field (`status ==`, `status in`, `subjectId ==` with client-sort).

### Spec 10 — Migration & rollout checklist

1. **Rules first.** Add the `pending_raises` block (Spec 9); `firebase deploy --only firestore:rules`. Harmless before app code ships (no client writes the collection yet).
2. **Ship app code** in one commit (lets the pre-commit hook bump `APP_VERSION`/`CACHE_VER`): `RaiseFlow` service (Spec 2), modal signature + save handler (Spec 3), both call sites (Spec 4), screen-load sweeps + banner (Spec 5), bypass closures (Spec 6), admin list + Approvals wiring (Spec 7), self-view timeline (Spec 8). Run `node --check js/departments.js && node --check js/app.js`.
3. **No data backfill.** Existing `salary_raises` rows already encode past raises (already applied). `pending_raises` starts empty. `payroll/{uid}.salary` already reflects historically-applied raises (they were immediate under the old flow), so there is nothing to re-materialize.
4. **Composition check with WS20:** confirm `renderPayrollManagement`'s `applyDueRaises('payroll')` runs **before** `fetchUsersWithPayroll()` / `computePayRun`. `computePayRun`/`computePayLine`/`disbursePayRun` need **no** edits from WS23 (raises land on `payroll.salary` upstream).
5. **Sequencing:** WS23 can land **after** WS20 (preferred — depends on WS20's screen structure) or independently against today's Compute (the sweep only touches `payroll.salary`, not the Compute internals). If WS20 is not yet merged, the sweep still works against the current Compute handler that reads `u.salary`.

### Spec 11 — Manual test checklist (no automated suite)

1. **Same-day raise, President:** open 💸 on a payroll employee, keep Effective Date = today, apply → toast "Raise applied"; `payroll/{uid}.salary` updated immediately; one `pending_raises` doc `status:'applied'`; one `salary_raises` audit row; Payroll table row shows new base after reload.
2. **Future-dated raise, President:** set Effective Date next month → button reads "Schedule Raise"; on save `payroll/{uid}.salary` is **unchanged**; `pending_raises` doc `status:'scheduled'`; banner shows "1 scheduled raise upcoming"; Compute this month still uses the OLD base.
3. **Auto-apply on month roll:** with a scheduled raise effective this month, reload the Payroll screen → sweep materializes it exactly once; `payroll.salary` updated; status→applied; employee gets a 💸 notification. Reload again → no duplicate audit row (deterministic id), no second write.
4. **Month-exactness / no leak:** schedule a raise effective 2026-09 while viewing 2026-07. Re-run Compute for a *past* month (e.g. 2026-06) → the future raise does NOT appear. (Verifies the `effectiveMonth <= currentBizMonth` gate.)
5. **Approval routing:** as a Finance-dept user who is NOT President, submit a raise → toast "sent for approval"; `pending_raises` `status:'pending_approval'`; no `payroll.salary`/`salary_raises` write (confirm the rules block a direct `scheduled` create via console). President sees it in Approvals → Approve → status becomes scheduled/applied per date; requester gets an approval notification. Reject → status rejected, reason stored, requester notified.
6. **Bypass closed:** open Edit Payroll → Base Salary is read-only text, not editable; save changes allowance only, base untouched. Open a Worker Profile in Edit mode → Daily/Hourly rate read-only; in Create mode → editable.
7. **Employee self-view:** as the affected employee, open Personal Finance → "Salary changes" lists the applied raise; a still-`scheduled` (unannounced) raise does NOT appear.
8. **Idempotency under partial failure:** (simulate) if a materialize is interrupted after the `payroll.set`, the next sweep re-runs it: same `payroll.salary` value, `salary_raises` doc overwritten (not duplicated), status ends `applied`.

## Risks / cross-workstream interactions

- ⚠️ Same-function collision with WS20 ("One payroll engine — kill the second compute path; Compute freezes per-employee snapshot lines into pay_runs") — both workstreams need to edit the exact same ~150-line gen-payroll-btn handler (departments.js:2616-2764) and the exact same employees-array construction (departments.js:2144-2150). Building WS23 against today's Compute shape risks a merge/rework collision if WS20 restructures this function first (or concurrently). Sequencing matters.
- ⚠️ Same-function collision with WS22 ("Cash-advance installments in payroll... ONE CashAdvance service shared by all 3 surfaces") — WS22 also touches the CA-deduction block inside this same Compute handler (departments.js:2712-2750) and the same employees loop. Three workstreams (20, 22, 23) converging on one function increases the chance that a fix for one silently reverts or conflicts with another if built independently without a shared plan for the function's final shape.
- ⚠️ Re-running Compute for a past, already-generated month (explicitly supported today — the alreadyGenerated confirm dialog at departments.js:2623-2625, and the month-picker at 2161-2163 that lists past months) currently re-derives salary_history from whatever payroll/{uid}.salary is NOW, not what it was for that month. Adding effective-dated raises without also fixing this existing bug means a raise given today could retroactively "leak" into a reprint of a past month if finance re-runs it, unless the pending-raise resolution logic is explicitly month-aware (not just wall-clock-date-aware).
- ⚠️ The two unlogged bypass paths (Edit Payroll salary field, Worker Profile Edit dailyRate/hourlyRate field) mean that even a perfectly-built effective-dated + approval-routed raise flow can be silently circumvented by any financePriv() user via a different, pre-existing button — unless WS23's build spec explicitly closes or reroutes them, the security/process property this workstream delivers is incomplete.
- ⚠️ Client-side canEditDept('Finance') vs rules-level isFinanceOrAdmin() mismatch (departments.js:17-25 vs firestore.rules:22): a Finance-department employee (role='employee', currentDepts includes 'Finance') sees raise/edit buttons the rules will actually deny. If a new pending_raises write-path is gated only by mirroring the client check, real users will hit silent permission-denied failures (caught generically by the existing try/catch at departments.js:2050-2054, surfaced only as a generic toast "Failed to apply raise" with no rules-specific messaging).
- ⚠️ Production-pay duplication (users.payClass='production' vs. worker_profiles roster with no ID linkage) means a raise recorded under subjectType 'payroll' for a payClass:'production' user does nothing to reconcile with that same person's possible worker_profiles doc (if one even exists) — raises could be granted against the wrong half of a split identity without any cross-check today.
- ⚠️ No existing Cloud Function / scheduled trigger infrastructure (functions/index.js has zero pubsub/onSchedule exports) — if Fable's design calls for any date-driven server-side behavior (e.g. auto-notify on effective date, not just auto-apply-at-Compute), that is wholly new infrastructure, not an extension of an existing pattern, and should be flagged as added scope rather than assumed available.
- ⚠️ Firestore composite index needs: if Fable designs pending_raises to be queried by e.g. `where('subjectId','==',uid).where('status','==','pending')` or `where('status','==','pending').where('effectiveDate','<=',today)`, a new entry in firestore.indexes.json will be required and must be deployed (`firebase deploy --only firestore`) before the query works in production — easy to forget per the existing memory note on deploy-recheck-full-file-diff and firebase-deploy-rules (git push does NOT deploy rules/indexes).

## Files likely touched

`js/departments.js (openSalaryRaiseModal ~1985-2056, openRaiseHistory ~2059-2082, renderPayrollManagement/loadPayrollTable + gen-payroll-btn Compute handler ~2128-2764, edit-emp-pay-btn Edit Payroll modal ~2487-2561, renderFinanceHRProfiles + hrp-raise-btn/hrp-edit-btn ~3578-3679, openHRProfileForm save handler ~3681-3785, Approvals-tab rendering/resolution blocks if raise approval routing mirrors payroll_delete_requests ~9169-9450 and ~9622-9686)`, `js/app.js (employee self-view / Personal Finance screen ~4190-4265, only if a per-employee raise timeline is added there; window.* wiring if any new pending-raise function needs to be callable from app.js given script load order)`, `js/config.js (fetchUsersWithPayroll ~195-207, if pending-raise resolution needs to be folded into the merged users+payroll read path so all ~70 existing u.salary call sites app-wide see a consistently-resolved number; window.dbCachedGet cache invalidation if a new 'pending_raises' or updated 'users'/'payroll' cache key is introduced)`, `js/notifications.js (if raise-request / raise-approved / raise-denied notifications are added, following the existing Notifs.sendToOwner / Notifs.send(uid, {...}) patterns already used for finance_delete_requests and payroll_delete_requests)`, `firestore.rules (new match block for pending_raises or equivalent, ~alongside the existing salary_raises block at lines 293-300 and payroll block at 278-282; must be deployed separately via firebase deploy --only firestore per this repo's convention — git push does not do it)`, `firestore.indexes.json (only if the chosen query shape for pending/queued raises needs a new composite index)`, `sw.js (CACHE_VER bump — handled automatically by the pre-commit hook per CLAUDE.md, not a manual task, but worth listing since js/departments.js and js/app.js will be edited)`

## Expected deliverable format

> Fable's output for this workstream should be a build spec Sonnet can execute without further judgment calls, structured as:
> 
> 1. A single explicit ARCHITECTURE DECISION section resolving each openDecision above with a one-paragraph rationale (not just a pick) — especially the storage-shape decision and the wall-clock-vs-month-of-Compute semantics decision, since those two determine everything downstream.
> 
> 2. Exact Firestore schema for whatever collection(s)/fields the decision implies, written as a field table (name, type, example value, who writes it, who reads it) — in the same style already used implicitly by salary_raises today (subjectType, subjectId, subjectName, field, oldAmount, newAmount, changeAmount, changePct, effectiveDate, reason, grantedBy, grantedByName, createdAt) so Sonnet can diff against the existing doc shape rather than invent one.
> 
> 3. A literal firestore.rules diff (before/after block, in the same terse style as the existing salary_raises/payroll/worker_profiles match blocks at lines 278-300 and 675-679) — including which existing helper (isFinanceOrAdmin() vs isAdmin() vs isPresident()) gates each operation, spelled out explicitly rather than left for Sonnet to infer.
> 
> 4. Exact function signatures and full before/after code blocks for every touched function: openSalaryRaiseModal (does its signature change — e.g. does applyRaise become applyOrScheduleRaise? does a new eff-date-in-the-future branch get added inline at departments.js:2032-2045?), the gen-payroll-btn Compute handler (departments.js:2616-2764 — exact new code to insert and at which of the three u.salary read sites, or the single new resolution point before line 2149), openRaiseHistory / any new pending-raise list UI, and the Approvals-tab wiring if approval routing is added (mirroring the exact shape of the payroll_delete_requests approve/deny blocks at departments.js:9411-9432).
> 
> 5. An explicit ruling (not left implicit) on the two bypass paths — Edit Payroll (departments.js:2487-2561) and Worker Profile Edit (departments.js:3681-3785) — stating exactly what changes there, if anything, with before/after code for those handlers too if they change.
> 
> 6. A numbered migration/rollout checklist: e.g. (1) add firestore.rules block + deploy firestore rules/indexes separately from app deploy, (2) ship the new collection/fields, (3) ship the modal changes gated behind the resolved decisions, (4) ship the Compute-time resolution logic, (5) ship any Approvals-tab wiring, (6) manual test script (give a same-day raise → confirm still-immediate per today() semantics if that's preserved as a fast path; give a future-dated raise → confirm it does NOT touch payroll/{uid} yet; run Compute after the date → confirm it applies exactly once and re-running Compute for that month doesn't reapply/duplicate; confirm the affected employee's own view — if any — reflects the right state at each stage).
> 
> 7. Every code block must already include escHtml()-wrapped output for any user-supplied string (reason, subjectName) and window.bizDate()-based date comparisons — Fable should write these into the sample code directly, not leave a TODO, since Sonnet is expected to implement mechanically without re-deriving these conventions.
