# Workstream 20 — One Payroll Engine (v12 Phase 3)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

Three payroll-adjacent engines exist, not two, and workstream 20's own description ("kill the second compute path") undercounts by one. All line numbers re-grepped fresh on branch v12 after Phase-1 edits.

=== PATH A — "Compute Payroll" / pay_runs workflow ===
File: js/departments.js, function `renderPayrollManagement(container, currentUser, currentRole)`, lines 2128-2770. This is the one Phase 1 fixed (existing→existingRef ReferenceError, now at line 2679-2684 after re-grep).
- Employee source: `fetchUsersWithPayroll()` (line 2130) = users + payroll/{uid} merged (config.js:195-207). Excludes external partners (isExternalPartner, lines 2138-2143) and payClass==='production' staff (lines 2148-2150): "Production-class staff are paid WEEKLY via Worker Payslips... Excluding them here is the single-source fix that stops a production worker being paid both weekly AND monthly (double pay)."
- Math (loadPayrollTable, lines 2420-2433 and gen-payroll-btn handler, lines 2630-2650): `gross = base+allowance; deduct = otherDeductions+sss+philhealth+pagibig+tax; net = gross-deduct-caAdv`. All of sss/philhealth/pagibig/tax/deductions are HAND-TYPED numeric fields on payroll/{uid} (Edit Payroll modal, lines 2496-2540) — no statutory table computation (that's workstream 21).
- CA deduction: pulled live from `cash_advances` where status=='approved', summed per user (lines 2406-2411), with an optional override doc `payroll_ca_overrides/{uid_month}` (lines 2413-2418, 2544-2554). Applied to salary_history/ledger on EVERY run (idempotent), but the actual balance decrement to `cash_advances` docs only runs `if (!alreadyGenerated)` (line 2715) — explicitly non-idempotent by design, guarded by an `alreadyGenerated` check against existing salary_history docs for that month (lines 2623-2625).
- Ledger idempotency: writes `ledger` docs keyed by deterministic ref `PAY-{month}-{uid}` (line 2677/2693), pre-fetched in one range query (lines 2664-2670) then upserted (.update if existingRef else .add, lines 2698-2702). Comment explicitly: no aggregate PAY-{month} entry is written, and any leftover aggregate from old code is deleted (lines 2704-2710) — "an aggregate on top of them double-counts payroll in every view that sums debits."
- pay_runs state stamp: on success, `.set({month, state:'computed', employeeCount, totalNet, computedBy, computedByName, computedAt}, {merge:true})` (lines 2760-2764) — metadata only; does NOT freeze a snapshot of the per-employee numbers onto the pay_run doc itself (they live only in salary_history, a separate collection with its own doc IDs).
- CRITICAL GAP: the Compute handler has NO guard against `pay_runs.state` — it can be clicked again after 'verified' or even 'disbursed', which both re-runs the salary math (refreshing salary_history + ledger amounts) AND downgrades `state` back to 'computed' via the same unconditional merge (lines 2760-2764). There is no "reopen" concept; recompute-after-disburse is possible and silently regresses state.
- Verify handler (lines 2597-2602): `db.collection('pay_runs').doc(month).set({state:'verified', verifiedBy, verifiedByName, verifiedAt}, {merge:true})` — status field only.
- Disburse handler (lines 2603-2608), quoted in full: `if(!confirm(...)) return; await db.collection('pay_runs').doc(month).set({ state:'disbursed', disbursedBy:currentUser.uid, disbursedByName:..., disbursedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true}); window.logAudit(...); Notifs.showToast(...); loadPayRunStrip(month);` — CONFIRMED: Disburse does nothing beyond a status-field update on pay_runs. It does not touch cash_advances (already decremented at Compute time, not Disburse time — inverts the target "Disburse is when money moves"), does not touch users/payroll/salary_history, does not notify employees, does not lock salary_history from further edits.
- Delete cascade (financeDeleteCascade, js/departments.js:141-160): deleting a salary_history doc removes its PAY- ledger row and restores any `caDeductions` array entries (written only by Path A, line 2741) back onto the source cash_advances docs.

=== PATH B — "Record Payroll" (the second engine; lives in js/app.js, NOT departments.js) ===
File: js/app.js, function `window.renderPersonalFinance(currentUser, currentRole)`, lines 3952-4188 (president/manager branch). Reached via the President's/Manager's "Personal Finance" → "Team Payroll" view, button at line 4033 (`id="record-payroll-btn"`), handler lines 4092-4186.
- Gate: `const pres = isPresident() || currentRole === 'manager'` (line 3954) — ANY manager role (not just Finance dept, not just President) can reach this screen and trigger a payroll write for all employees. Broader access surface than Path A's `isFinancePriv()` (=canEditDept('Finance')).
- Employee source: `dbCachedGet('users', ()=>db.collection('users').get(), 30000)` — but `dbCachedGet` forces the 'users' key through `window.fetchUsersWithPayroll` regardless of the passed lambda (config.js:218-220), so salary fields DO come from the same protected payroll/{uid} collection as Path A (verified — not stale/zeroed).
- Employee filter (line 4121): `const empDocs = usersSnap2.docs.filter(d => !['partner'].includes(d.data().role));` — CONFIRMED: no `payClass==='production'` exclusion anywhere in this file (grep for 'payClass' in js/app.js returns zero hits). This is literally the bug the audit flagged: a production-class worker (paid weekly via Worker Payslips) who also has a `users`+`payroll` doc gets a SECOND, monthly payment here.
- Math (lines 4123-4138), quoted: `const net2 = (u2.salary||0)+(u2.allowance||0)-(u2.deductions||0);` — no sss/philhealth/pagibig/tax subtraction at all (Path A subtracts all four). `const ts2 = ut2.length ? Math.min(1, ut2.filter(t=>_DONE2.includes(t.status)).length/ut2.length) : 0.5;` (task-completion ratio) `const ds2 = typeof td2.deliverableScore==='number' ? Math.min(1,td2.deliverableScore/100) : 0.5;` (from kpi_targets) `const kpi2 = ts2*0.7 + ds2*0.3;` `const att2 = await getAttendanceScore(doc.id);` (js/app.js:4649-4664, reads `attendance/{uid}/records` subcollection, scores 0/0.5/1 per day, divides by workdays-elapsed) `const finalPay = net2 * (kpi2*0.7 + att2*0.3);` (line 4138) — a MULTIPLICATIVE percentage-of-net model, not a subtraction model. No CA deduction anywhere in this handler.
- Collision: writes to the EXACT SAME doc IDs as Path A — `salary_history/{uid}_{month}` (line 4139) and ledger ref `PAY-{month}-{uid}` (line 4158), both via upsert/`.set()`/update-if-exists. The code comment at lines 4149-4154 acknowledges the ledger convergence deliberately ("BOTH payroll paths converge on one idempotent representation") but this means whichever path runs SECOND for a given month silently overwrites the other's numbers with a different formula, a different field set (Path B omits `sss`, `philHealth`, `pagIbig`, `tax`, `caDeducted` entirely — fields Path A always writes), and does so with NO reference to `pay_runs` state at all (Path B never reads or writes pay_runs — a Verified/Disbursed run's salary_history/ledger rows can be silently rewritten by Record Payroll after the fact with zero trace in the pay_runs doc).
- Adjacent, same-formula-family, read-only surface: the SAME multiplicative model (`kpi*0.7+att*0.3` as a multiplier, not a subtraction) reappears in the employee's own "Personal Finance" self-view (non-president branch, lines 4190+, `_payslipData` built at lines 4257-4265) and in `printPayslip()` (lines 4666-4685) — a live "Projected Full Month" preview employees can view/print for themselves. It is NOT tied to any actual pay_run and writes nothing, but if Path B's math is retired, this preview's multiplier framing becomes internally inconsistent with the new engine's numbers unless it's updated too.

=== ADJACENT (third, legitimately distinct) — Worker Payslips (weekly production engine) ===
File: js/departments.js, `renderFinanceHRProfiles` (lines 3577-3679), `openPayslipGenerator` (3989-4150), `collectPayslipData` (4165-4238), `openPayslipHistory`/`openPayslipEdit` (3790-3987). Operates on its OWN collections: `worker_profiles/{id}` (fields: name, jobTitle, department, employmentType, workType, hourlyRate, dailyRate, foodAllowance, allowances{meal,transport}, ssNum/phNum/pagibigNum/tinNum, address, phone, status, caBalance [a plain number field on the profile, not derived from cash_advances], includeInPayroll, createdAt/By, updatedAt) and `payslips/{id}` (workerId, workerName, jobTitle, department, payPeriodStart/End/Month, payDate, regular{dailyRate,ratePerHr,hrsWorked,total}, overtime{ratePerHr,hours,total}, allowances{meal,transport,rent,total}, grossPay, deductions{govt{sss,philhealth,pagibig,total},other{cashAdvance,loans,taxes,total}}, totalDeductions, totalPay, paid, netPay, caBalanceBefore/After, schedule[7 days: day,timeIn,timeOut,hours], status [draft→verified→filed→submitted, PAYSLIP_STAGES const line 3785], proofUrl, createdAt/By). `worker_profiles` docs are NOT necessarily linked to a `users`/Auth account — a fundamentally different identity model than payroll/{uid}, which is keyed by Firebase uid. Attendance here is manually typed per-day time-in/time-out in the generator modal (computeDayHours, lines 4154-4163: subtracts 1hr lunch if shift spans 12-1PM) — it does NOT read the `attendance` collection automatically. Ledger posting happens on "Submit" (not on save), ref `WPAY-{payslipId}` (lines 3850-3868), separate from the `PAY-` ref family. CA deduction here is a MANUAL number field (default 0, line 4062) referencing `profile.caBalance` for display only — no auto-pull of full balance like Path A's default.

=== firestore.rules (current state) ===
`pay_runs/{month}` (rules lines 318-325): `allow create, update: if isAuth() && isFinanceOrAdmin();` `allow delete: if isAuth() && isPresident();` — CONFIRMED GAP vs the workstream-20 goal ("rules enforce president-only disburse"): isFinanceOrAdmin() = role in [president, manager, secretary, finance] (rules.js:22) can currently write state:'disbursed' directly (e.g. via console/devtools), even though the UI only shows the Disburse button to isRealPresident(). `payroll/{uid}` (278-282) and `salary_history/{docId}` (285-291): create/update by isFinanceOrAdmin(), delete by isPresident() — no state-based lock tied to pay_runs.state, so nothing in rules stops writing salary_history for a month whose pay_run is already 'disbursed'. `payslips/{docId}` and `worker_profiles/{docId}` rules exist at lines 668/675 (not read in detail here — re-check before writing migration rules diffs).

## Data model

payroll/{uid} — protected doc (config.js:187-207, firestore.rules:278-282): {payClass:'regular'|'production' (default regular, no central enum), salary, allowance, deductions, sss, philhealth, pagibig, tax}. Merged onto the users doc client-side by fetchUsersWithPayroll(); read: owner or finance/admin; write: finance/admin.

salary_history/{uid}_{month} — deterministic doc ID (both Path A and Path B write here). Path A's shape: {userId, userName, month, salary, allowance, deductions, sss, philHealth, pagIbig, tax, caDeducted, netPay, finalPay, caDeductions:[{caId,amount}] (only if CA was deducted this run), recordedBy, recordedAt}. Path B's shape: {userId, userName, month, salary, allowance, deductions, netPay, kpiScore, attScore, finalPay, recordedBy, recordedAt} — missing sss/philHealth/pagIbig/tax/caDeducted/caDeductions entirely. Read: owner or finance/admin; write: finance/admin; delete: president (firestore.rules:285-291).

pay_runs/{YYYY-MM} — governance-only doc, NOT a data snapshot. Fields observed: month, state ('draft'|'computed'|'verified'|'disbursed', PR_STATES const departments.js:2569), employeeCount, totalNet, computedBy, computedByName, computedAt, verifiedBy, verifiedByName, verifiedAt, disbursedBy, disbursedByName, disbursedAt. No per-employee lines array exists on this doc today — the actual numbers live only in the separate salary_history collection, keyed independently.

cash_advances/{id} — {userId, balance, status:'approved'|'active'|'paid'|'pending', amount}. Path A live-sums balance per user (status=='approved') at Compute-table-render time and decrements it at Compute-click time (not Disburse time).

payroll_ca_overrides/{uid}_{month} — {userId, month, amount, setBy, setAt}. Optional partial-CA-deduction override for Path A only.

ledger/{autoId} — {date, type:'debit', description, amount, category:'Payroll Expense', source:'Finance', refNumber, addedBy, addedByName, createdAt}. refNumber convention: `PAY-{month}-{uid}` for both Path A and Path B (collision point), `WPAY-{payslipId}` for Worker Payslips.

worker_profiles/{id} + payslips/{id} — see currentState; separate identity model (not uid-keyed), separate collections, separate ledger ref family (WPAY-).

users/{uid} — role, departments/department, title, displayName, email, employeeId, photoUrl. Salary fields formerly lived here (V11 migration moved them to payroll/{uid} — ROADMAP.md line ~237); confirm none linger before assuming users docs are pay-free.

kpi_targets/{uid} — {deliverableScore (0-100), targetScore}. kpi_evals/{uid} — {selfGrade, selfNotes, selfAssessMonth, presidentGrade, presidentGradeFromTasks, presidentNotes, presidentImprovements}. attendance/{uid}/records/{YYYY-MM-DD} — {attendanceScore (0/0.5/1), fullTime, loginTime} — read by getAttendanceScore (js/app.js:4649-4664) for both Path B and the employee self-preview.

## Constraints — must respect

- Every Firestore collection the client reads needs an explicit rules match block — no cascade to subcollections, no prefix matching (CLAUDE.md; firestore-rules-collection-coverage memory). Any new frozen-snapshot fields on pay_runs, or a new collection, needs its own rule; a missing rule silently DENIES and blank-screens unless .catch()'d.
- Reading an absent field in firestore.rules DENIES that rule (firestore-rules-missing-field-throws memory) — use .get(field, default), not resource.data.field, anywhere new rules read pay_runs/salary_history fields (e.g. a future 'is this run locked' check).
- All date/period logic must go through window.bizDate()/bizHour()/bizDow() (Manila time) — both paths already do this correctly for month boundaries (departments.js:2157, app.js:3977-3982); do not regress to raw toISOString()/getDay() (manila_time_helpers memory; already burned the team once per the V11 payslip pay-period bug).
- escHtml() before any innerHTML interpolation of user-controlled strings (CLAUDE.md convention) — both paths currently comply.
- Ledger idempotency pattern already established and must be preserved: deterministic refNumber per employee per month (PAY-{month}-{uid}), pre-fetch-then-upsert (existence check via a range query, not a query-per-employee) so re-running never duplicates a ledger row (departments.js:2657-2670, explicit comment at 2704-2710 banning aggregate entries stacked on top of per-employee ones).
- Non-idempotent operations (cash-advance balance decrements) must stay gated behind an explicit 'already ran this month' check, exactly as Path A does via the alreadyGenerated confirm/skip (departments.js:2623-2625, 2715) — a unified engine must not let a second Compute (or a Disburse) re-deduct the same CA balance.
- financeDelete/financeExecuteDelete/financeDeleteCascade (departments.js:141-227) is the ONLY sanctioned delete path for salary_history — President deletes immediately, everyone else routes through payroll_delete_requests approval; enforced client-side AND by firestore.rules. Any new frozen-snapshot representation on pay_runs must decide whether it also needs a cascade-on-delete (currently pay_runs delete is president-only in rules but has no cascade function at all).
- isFinancePriv() = canEditDept('Finance') gates Path A's screen; isRealPresident()/isPresident() gates Path B's screen and Path A's Disburse button — two different capability checks for what should arguably be one governance model; whatever the unified engine picks, firestore.rules must match it exactly (current mismatch: rules allow isFinanceOrAdmin() to write pay_runs.state='disbursed', UI hides the button from non-president but does not block the write at the data layer).
- Version + service-worker cache bump (CACHE_VER in sw.js, APP_VERSION auto-bumped by .git/hooks/pre-commit) required on any JS/CSS edit — do not hand-edit APP_VERSION (CLAUDE.md).
- Script load order in index.html is load-bearing: config.js → drive.js → notifications.js → departments.js → app.js → modules.js — a unified engine function must be defined before anything later in that order calls it; if the canonical implementation moves to config.js, ensure nothing in departments.js/app.js referencing it runs before config.js has defined it.

## DECIDED — architecture spec (Fable, 2026-07-10)

### Decisions

**D1 — Path B's write path is DELETED; the engine lives in departments.js.** The canonical
engine is `window.computePayRun(month, opts)` + pure `window.computePayLine(emp, ctx)` defined
in js/departments.js immediately above `renderPayrollManagement` (payroll domain code lives
there; departments.js loads before app.js so the self-preview can call `computePayLine`).
Path B's "Record Payroll" button + handler (app.js:4092-4186) are removed; the President's
Team-Payroll table becomes READ-ONLY (renders the month's `pay_runs` summary + a
"Open Payroll →" link to the HR screen). Not config.js — that file is for small shared
utilities, not a payroll engine.

**D2 — Formula: BOTH components, as explicit line items, behind a pay POLICY toggle that
defaults to today's live behavior.** Neither existing path implements the ROADMAP intent:
- Unified math (per line):
  `gross = base + allowance` · `statutoryTotal = sss+philhealth+pagibig+tax` (hand-typed until
  WS21 computes them) · `perfFactor = clamp(kpi*0.7 + att*0.3, 0, 1)` ·
  policy `'flat'`: `finalPay = gross − statutoryTotal − otherDeductions − caDeducted`
  (**exactly Path A today — the DEFAULT, so unification changes no one's pay**) ·
  policy `'performance'`: `finalPay = base − statutoryTotal − otherDeductions − caDeducted +
  allowance × perfFactor` — performance scales the **allowance only, never base wage**
  (PH labor-safe: no docking base pay below agreed wage for performance; every component is a
  visible payslip line, not a hidden multiplier).
- KPI floor fix: an employee with ZERO assigned tasks gets `kpi = 1.0` (Path B's 0.5 floor
  punished people for not being assigned work — wrong).
- `payPolicy` is stored on each pay_run (default `'flat'`), switchable per-run by the President
  in the Payroll screen. **FLAG FOR NEIL:** enabling `'performance'` is a pay-policy change —
  the engine ships ready but inert until he flips it.

**D3 — Worker Payslips stay a separate WEEKLY engine.** Different identity model
(worker_profiles need not have Auth accounts); folding it in = a login-provisioning project,
out of scope. "One payroll engine" = one MONTHLY engine. The bridge becomes structural instead
of filter-by-convention: `worker_profiles` gains optional `linkedUid`; `computePayRun` HARD-SKIPS
any uid with `payClass==='production'` OR appearing as an active profile's `linkedUid`, and
returns them in `skipped[]` (surfaced in the UI as "N paid weekly via Worker Payslips" +
a reconciliation list). WS22 unifies the CA math across both via one service; WS26 wires real
attendance into weekly pay.

**D4 — Snapshot = `lines[]` embedded on pay_runs/{month}; salary_history becomes the
per-employee mirror written at Disburse.** Sizing: ~400 bytes/line ⇒ ~2,000 employees before
the 1MB doc ceiling — decades of headroom. Benefits: atomic freeze, one read for
reprint/verify/WS24 payslips (incl. the dead print buttons), past months reprint EXACTLY
(no more "recompute with today's salaries"). salary_history is kept because employees can only
read their OWN pay (pay_runs is finance-only in rules; salary_history has owner-read) — it is
written from the frozen lines at DISBURSE, same doc IDs `{uid}_{month}`, superset of Path A's
current shape (adds kpiScore/attScore/perfFactor/policy). backfillPayrollLedger keeps working
unchanged (still reads salary_history).

**D5 — State machine hardened.** Compute allowed only in `draft`/`computed` (re-compute before
verification is fine and stays idempotent — pure math + snapshot, no money). Once `verified`:
Compute disabled; changes need **Reopen** (president-only, verified→computed, stamped
reopenedBy/At + logAudit). `disbursed` is TERMINAL — no reopen, no recompute; corrections go
through the existing financeDelete approval path per employee (and WS12's period-close governs
post-hoc edits). This kills today's silent disburse→computed regression.

**D6 — Money moves at DISBURSE, not Compute.** Compute = read-only math + freeze lines
(shows planned CA per line via WS22's service so Finance reviews the true net). Verify =
finance sign-off. **Disburse (president) is the single mutating step:** CA balance decrements,
`PAY-{month}-{uid}` ledger upserts (same range-prefetch idempotency, now called from the
disburse handler), salary_history mirror writes, employee notifications. A computed-then-
abandoned run no longer corrupts cash_advances balances; the `alreadyGenerated` guard is
replaced by the state machine (disbursed = terminal = the decrement can run at most once).

**D7 — Rules: transition-aware pay_runs; salary_history left to period-close.** pay_runs
create/update validated per transition (below); `disbursed` writable ONLY by president and ONLY
from `verified`. salary_history rules stay as-is (owner-read, finance write, president delete) —
post-disburse tampering is governed by WS12's period-close instead of a per-write pay_runs
`get()` (saves a read per write and avoids the missing-field-denies hazard); rationale recorded.

**D8 — Self-preview refactored, not deleted.** getAttendanceScore/countWorkDays survive (the
engine uses them). The employee "Projected Full Month" preview and printPayslip switch to
calling the same pure `computePayLine(emp, {projection:true})` so the math has ONE source; the
full visual rebuild is WS24's job. If a disbursed pay_run exists for the viewed month, the
preview shows the FROZEN line from the employee's own salary_history doc instead of a
projection (labeled "Final — disbursed").

---

### Spec 1 — Data shapes (annotated literals)

```js
// pay_runs/{YYYY-MM}   (finance/admin read; rules below)
{ month:'2026-07', state:'draft'|'computed'|'verified'|'disbursed',
  payPolicy:'flat'|'performance',            // NEW — default 'flat'
  employeeCount:12, totalNet:345678.50,
  lines:[ PayLine, ... ],                    // NEW — frozen at Compute
  skipped:[{uid,name,reason:'production'|'linked-worker-profile'|'partner'}],  // NEW
  computedBy,computedByName,computedAt, verifiedBy,verifiedByName,verifiedAt,
  disbursedBy,disbursedByName,disbursedAt,
  reopenedBy,reopenedByName,reopenedAt }     // NEW — set on president Reopen

// PayLine — THE plug-in surface for WS21 (statutory), WS22 (CA), WS24 (payslip)
{ uid, name, payClass:'regular',
  base:0, allowance:0, otherDeductions:0,
  sss:0, philhealth:0, pagibig:0, tax:0,     // WS21 replaces hand-typed with table-computed
  kpiScore:0, attScore:0, perfFactor:1, policy:'flat',
  caBalance:0, caPlanned:0, caPlan:[{caId,amount,installmentNo,terms}], // from WS22 service
  gross:0, statutoryTotal:0, netBeforeCA:0, finalPay:0 }

// salary_history/{uid}_{month} — mirror written AT DISBURSE from the frozen line
// (Path A's shape + kpiScore, attScore, perfFactor, policy, runMonth)
```

### Spec 2 — Engine signatures (insert in js/departments.js directly above renderPayrollManagement)

```js
window.computePayLine = function(emp, ctx) { /* pure; ctx={month,policy,kpiScore,attScore,caPlan} → PayLine */ }
window.computePayRun  = async function(month, { policy } = {}) {
  /* 1. fetchUsersWithPayroll(); filter partners; HARD-SKIP payClass==='production' OR
        linkedUid-of-active-worker_profile → skipped[]
     2. per employee: getAttendanceScore(uid,month), kpi from kpi_targets/tasks (reuse Path B's
        readers, floor: no tasks ⇒ 1.0), caPlan from CashAdvance.planFor(uid,month) [WS22]
     3. lines = map(computePayLine); NO WRITES except the pay_runs doc:
        pay_runs/{month}.set({...meta, state:'computed', payPolicy, lines, skipped},{merge:true})
     4. returns {lines, totals, skipped}  */
}
window.disbursePayRun = async function(month) {
  /* president-only UI; reads pay_runs/{month} (must be state==='verified');
     for each line: CashAdvance.deduct(line.caPlan)  [WS22 — the ONLY balance mutation],
     PAY-{month}-{uid} ledger upsert (existing range-prefetch pattern, moved here),
     salary_history/{uid}_{month} mirror set, Notifs.send(uid, …);
     then pay_runs.set({state:'disbursed', disbursedBy…}); logAudit('disburse-payrun',…) */
}
```

### Spec 3 — Call-site surgery

1. **Path A gen-payroll-btn handler (departments.js:2616-2769):** body replaced by
   `await computePayRun(month)` + table re-render. DELETE from it: the ledger-post loop
   (2654-2710 — moves into disbursePayRun), the CA-decrement block (2715-2745 — becomes
   WS22's `CashAdvance.deduct` inside disbursePayRun), the salary_history writes (move to
   disburse mirror). Guard at top: `if (['verified','disbursed'].includes(runState)) return
   Notifs.showToast('Run is '+runState+' — President must Reopen first','error')`.
2. **Verify handler (2597-2602):** unchanged except allowed only from `computed`.
3. **Disburse handler (2603-2608):** replaced by `await disbursePayRun(month)` behind the
   existing president gate + typed confirmation (amount shown).
4. **NEW Reopen button** (president, visible when state==='verified').
5. **Path B (app.js:4092-4186 + button at 4033):** handler deleted; button replaced by
   read-only summary chip of pay_runs/{month} + "Open Payroll →" (navigateTo HR/Payroll).
6. **Self-preview (_payslipData 4257-4265, printPayslip 4666-4685):** compute via
   `computePayLine(emp,{projection:true,policy:runPolicy||'flat'})`; if own
   salary_history/{uid}_{month} exists → render frozen values, label "Final — disbursed".
7. **backfillPayrollLedger:** unchanged (reads salary_history mirrors).

### Spec 4 — firestore.rules pay_runs replacement block

```
match /pay_runs/{month} {
  allow read: if isAuth() && isFinanceOrAdmin();
  allow create: if isAuth() && isFinanceOrAdmin() &&
    request.resource.data.get('state','draft') in ['draft','computed'];
  allow update: if isAuth() && (
    ( isFinanceOrAdmin() &&
      resource.data.get('state','draft') in ['draft','computed'] &&
      request.resource.data.get('state','') in ['computed','verified'] )
    ||
    ( isPresident() && (
        // verify → disburse (the only path to disbursed)
        ( resource.data.get('state','')=='verified' &&
          request.resource.data.get('state','')=='disbursed' ) ||
        // president reopen: verified → computed
        ( resource.data.get('state','')=='verified' &&
          request.resource.data.get('state','')=='computed' ) ||
        // president may also do the finance transitions
        ( resource.data.get('state','draft') in ['draft','computed'] &&
          request.resource.data.get('state','') in ['computed','verified'] )
    ))
  );
  allow delete: if isAuth() && isPresident();
}
```
Result: `disbursed` is unreachable except president-from-verified, and immutable afterward
(no clause permits updating a disbursed doc). Deploy via `--only firestore:rules` (re-diff
first). Add `pay_runs` to scripts/monthly-backup.js EXPORTS in the same commit (WS15 gap).

### Spec 5 — Migration & reconciliation checklist

1. Rules deploy (Spec 4). Old client's Compute still works for draft/computed months; its
   direct salary_history/ledger writes remain permitted (unchanged rules there) until step 2.
2. Ship engine + call-site surgery (one commit; node --check ×4 + preview boot).
3. One-time president report **"Payroll reconciliation"** (button beside Sync-to-ledger):
   (a) Path-B-written months: salary_history docs where `kpiScore` exists AND `sss` is
   undefined → list (month, employee, finalPay) — these were computed with the multiplier
   formula and never carried statutory fields; (b) double-pay detection: uids with
   payroll.payClass==='production' or a linkedUid profile that ALSO have salary_history rows —
   join against payslips by payPeriodMonth → list overlaps. Report only — corrections route
   through the existing financeDelete approval, never hard-delete.
4. Backfill `worker_profiles.linkedUid` manually via the HR profile editor (new optional
   field) for any production worker who also has a login.
5. First live run: Compute → check lines vs last month's numbers (policy 'flat' ⇒ identical
   for regular staff) → Verify → Disburse; confirm CA balances decrement exactly once and
   employee notifications arrive.

### Spec 6 — Compatibility notes for later workstreams

- **WS21:** replace the hand-typed sss/philhealth/pagibig/tax reads inside `computePayLine`
  with table lookups; PayLine field names are final.
- **WS22:** implement `window.CashAdvance = {planFor(uid,month), deduct(caPlan), recordPayment,
  approve}` — `computePayRun` calls `planFor`; `disbursePayRun` calls `deduct`. Worker-payslip
  CA follows the same service against `worker_profiles.caBalance`.
- **WS24:** payslips (incl. the dead print buttons) render from `pay_runs.lines` (finance) or
  the employee's own salary_history mirror (self-service) — never recompute.
- **WS26:** weekly production pay reads real attendance; monthly engine's attScore source
  (getAttendanceScore) is unchanged by 26.

## Risks / cross-workstream interactions

- ⚠️ Direct collision on write: Path A and Path B write the SAME salary_history/{uid}_{month} doc ID and the SAME ledger PAY-{month}-{uid} ref with DIFFERENT field sets and DIFFERENT formulas. If both are used for the same month (plausible since Path B's access gate is 'president OR manager' on a completely separate screen with no cross-reference to pay_runs state), whichever runs second silently overwrites the other, and neither run updates pay_runs.state to reflect that a rewrite happened after Verify/Disburse — a 'disbursed' badge can be showing next to numbers nobody has re-verified.
- ⚠️ Path B (Record Payroll) still pays payClass==='production' workers monthly — confirmed by absence of any payClass filter in js/app.js (grep returned zero hits). This is a live double-pay bug distinct from, and NOT fixed by, the payClass filter a prior session added to Path A only (departments.js:2148-2150). A migration/backfill for workstream 20 needs to check historical salary_history docs for entries with kpiScore/attScore fields present (Path-B signature) belonging to a uid whose payroll/{uid}.payClass is 'production' or who also has payslips/worker_profiles entries for the same period, to detect real-money double-pay incidents before this session and reconcile via the existing finance_delete_requests/financeDeleteCascade path — do NOT hard-delete directly.
- ⚠️ firestore.rules currently lets any isFinanceOrAdmin() (president/manager/secretary/finance) write pay_runs.state='disbursed' directly (rules:318-325), even though the UI hides the button from non-president. This must be closed as part of 'rules enforce president-only disburse', and the closure must be verified against firestore.rules AND against any Cloud Function/script that might also write pay_runs (functions/index.js was not found to touch pay_runs in this grounding pass — re-verify).
- ⚠️ The dead print buttons (#print-payroll-btn and .print-slip-btn, departments.js:2168/2463) have zero addEventListener bindings anywhere in the codebase (grep confirmed) — this is workstream 24's job but a unified engine's frozen-snapshot design directly determines what these buttons will eventually read from (pay_runs.lines vs salary_history), so the data shape decided here constrains workstream 24's build.
- ⚠️ Interaction with workstream 21 (statutory tables): Path A's sss/philhealth/pagibig/tax are hand-typed fields on payroll/{uid}; Path B computes none of them (omits the fields entirely). Whichever engine wins, workstream 21's 'computed, not hand-typed' statutory tables need a place to plug in — likely the same lines-array/frozen-snapshot structure this workstream designs, so sequencing (build 20 before 21) and the exact per-line shape matters to that later workstream.
- ⚠️ Interaction with workstream 22 (CA installments): Path A's CA handling is the ONLY functioning CA-in-payroll logic today; Path B has none; Worker Payslips has a third, independent CA model (manual number field against worker_profiles.caBalance, no cash_advances linkage at all). Workstream 22's 'ONE CashAdvance service shared by all 3 surfaces' depends on whatever data shape this workstream picks for the frozen snapshot.
- ⚠️ Interaction with workstream 26 (Attendance v2 — time-out+hours feeding weekly production pay): Worker Payslips' attendance is currently manually typed per-day, NOT read from the attendance collection. If workstream 26 wires real clock-in/out data into weekly production pay, that changes Worker Payslips' data source — worth flagging so the same attendance-read code isn't built twice.
- ⚠️ getAttendanceScore() (app.js:4649-4664) and countWorkDays() (app.js:4628-4638) are shared helpers Path B and the employee self-preview both call; if Path B is deleted outright rather than refactored, check nothing else depends on these two functions before removing them.
- ⚠️ Employee-facing self-preview (printPayslip/_payslipData) uses Path B's exact multiplier math for a live 'Projected Full Month' figure employees see today — deleting Path B's formula without touching this view leaves an internally-inconsistent number on the employee's own dashboard. Decide together with workstream 24 (payslip template), not in isolation.

## Files likely touched

`js/departments.js — renderPayrollManagement (2128-2770, Path A: Compute/Verify/Disburse UI + handlers), financeDeleteCascade (141-227, salary_history delete cascade), backfillPayrollLedger (~1543-1600s, June-backfill helper reading salary_history to recreate ledger rows — must stay compatible with any new frozen-snapshot shape), renderFinanceHRProfiles/openPayslipGenerator/collectPayslipData/openPayslipHistory (3577-4238, Worker Payslips — touch only if workstream 20 folds it in)`, `js/app.js — window.renderPersonalFinance (3952-4265, Path B: Record Payroll handler + employee self-preview + printPayslip), getAttendanceScore/getKpiScore/countWorkDays (4598-4664, shared helpers)`, `js/config.js — fetchUsersWithPayroll (195-207) and the dbCachedGet 'users'-key override (214-220); candidate new home for a shared window.computePayrollForMonth()`, `firestore.rules — pay_runs (318-325), payroll (278-282), salary_history (285-291), payroll_ca_overrides (304-309), payroll_delete_requests (312-316); any new frozen-snapshot fields/collections need their own explicit match block`, `firestore.indexes.json — if the unified engine introduces new composite queries`, `scripts/monthly-backup.js — already backs up payroll/salary_history/payslips per ROADMAP.md; verify the EXPORTS list still covers whatever the new snapshot uses`, `sw.js — CACHE_VER bump on any of the above JS edits (mechanical, per CLAUDE.md)`

## Expected deliverable format

> Fable's output for this workstream should let Sonnet implement mechanically with zero further judgment calls. Concretely: (1) An exact decision record answering every item in openDecisions, each with a one-paragraph rationale. (2) The exact new/changed data shape as a TypeScript-style interface comment (not real TS — this is vanilla JS) for pay_runs/{month} and, if changed, salary_history/{docId} — every field name, type, and whether it's new/renamed/removed. (3) Exact function signatures for the unified engine, e.g. window.computePayrollForMonth(month, {dryRun}) -> {lines, totalNet, employeeCount} and where it lives (file + line range to insert, given as 'insert after js/config.js:207' style anchors). (4) Full before/after code blocks for every call site being replaced — the Path A gen-payroll-btn handler (departments.js:2616-2769), the Path B record-payroll-btn handler (app.js:4092-4186) and whatever UI element replaces/removes it, the Verify/Disburse handlers (departments.js:2597-2609), and printPayslip/_payslipData (app.js:4257-4265, 4666-4685) if touched. (5) A numbered, sequential migration checklist covering: what happens to existing salary_history docs written by Path B (detect via presence of kpiScore/attScore fields with absence of sss/philHealth/pagIbig/tax — given as an exact Firestore query or client-side filter), whether/how to backfill or flag them, and the exact one-time button/script (matching the existing 'Sync to ledger' pattern in Reports) if one is needed. (6) The exact firestore.rules diff (full match blocks, not prose) for pay_runs/payroll/salary_history covering the president-only-disburse tightening and any new state-transition or immutability checks, written so it can be pasted in directly and deployed via firebase deploy --only firestore:rules. (7) An explicit compatibility note for workstreams 21/22/24/26 stating exactly which fields/functions those later workstreams should plug into.
