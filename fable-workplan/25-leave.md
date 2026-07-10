# Workstream 25 — Leave that works (balance seeding/accrual + attendance integration)

> ✅ **IMPLEMENTED 2026-07-10.** Rules deploy required (`leave_balances` shape guard + new
> `leave_accruals` block). See V12-PLAN.md Build Log. **‼️ FLAG FOR NEIL — do not press "Run
> Annual Accrual" until you confirm:** `LEAVE_POLICY.grants` ships as a labelled PLACEHOLDER
> `{vacation:5,sick:5}` (the true PH legal floor is ONE combined 5-day SIL pool, not 5+5 — this
> is a policy choice above the floor); `LEAVE_POLICY.probation` (day-one prorated vs.
> after-1-year); and carry-over/cash-commutation of unused days at annual rollover.

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

LEAVE REQUEST FLOW lives in js/modules.js:2188-2390 (IIFE 'LEAVE MANAGEMENT'). LEAVE_TYPES = vacation/sick (drawsBalance:true), emergency/unpaid (drawsBalance:false) at modules.js:2195-2200. Employee files via openLeaveModal, which db.collection('leave_requests').add({userId,userName,type,startDate,endDate,days,reason,status:'pending',createdAt:serverTimestamp()}) at modules.js:2324-2328. The 'days' value comes from workingDays(start,end) (modules.js:2206-2213) which excludes ONLY Sundays, not PH holidays - this differs from payroll's countWorkDays() (app.js:4628-4638) which excludes Sundays AND holidays. Client-side pre-check blocks filing if requested days exceed the balance (modules.js:2322) but this is UI-only and not enforced by firestore.rules. Approval has 3 call sites, all funneling through the same two exported functions (a good centralized pattern, unlike the 3-surfaces-disagree CashAdvance system per memory): renderLeaveAdmin's local approveLeave/rejectLeave (modules.js:2336-2361, screen gated to role in president/manager/finance at modules.js:2233), and the canonical window.approveLeaveRequest/rejectLeaveRequest (modules.js:2366-2389), which the unified Approvals queue calls at departments.js:9509/9515 (main queue) and departments.js:9739/9745 (Approvals-leave sub-tab, departments.js:9711-9749). The unified queue's role gate is APPROVAL_CAPS.leave = president/manager/secretary (departments.js:9138) - note 'finance' is missing from that list even though renderLeaveAdmin's own gate and firestore.rules' isFinanceOrAdmin() both include finance; a finance-role user can approve via the standalone Leave screen but sees no action buttons in the unified queue. Both approval code paths, on approve, run the identical decrement: newBal = max(0, existingBalance - r.days), then leave_balances/{userId}.set({[type]:newBal, updatedAt}, merge:true) - modules.js:2342-2344 and 2372-2375, duplicated logic, not shared. AUDIT FINDING CONFIRMED BY GREP: searched every js file, functions/index.js, and scripts/*.js for writes to leave_balances - the only writes anywhere in the repo are these two decrement-on-approve call sites. Nothing seeds an initial balance, nothing accrues monthly or yearly, nothing resets balances at year end. getBalance(uid) (modules.js:2214-2217) defaults a missing doc to vacation:0, sick:0 - every new hire is silently at 0 until a human manually sets the doc (no UI for that exists either). firestore.rules DOES permit finance/admin to write leave_balances directly (rules:809-816, isFinanceOrAdmin - which includes the 'secretary' role, otherwise scoped to view-only approvals per the corporate-secretary memory) but no UI exercises that permission - the gap Fable is filling. scripts/monthly-backup.js:190 lists leave_balances among backed-up collections (dateField:null, full-snapshot export) - that is read-only backup, not seeding. ATTENDANCE RECORD SHAPE is attendance/{uid}/records/{date}, the exact area Phase 1 workstream 5 just fixed on the write side. Normal employee check-in writes loginTime:serverTimestamp, uid, date, attendanceScore: autoFull ? 1.0 : 0.5, fullTime:autoFull, autoFull, via set(merge:true) - it does NOT write a status field at all (app.js:3122-3128). tryUpgradeAttendanceOnNotifRead (app.js:3170-3189) can bump attendanceScore from 0.5 to 1.0 before 9am Manila if all notifications get read in time. The Phase-1-fixed admin/finance edit path (modules.js:1208-1223) DOES write status: present sets loginTime:Timestamp.now, fullTime:true, status:present, attendanceScore:1.0; half sets fullTime:false, status:half, attendanceScore:0.5; absent soft-archives (status:absent, fullTime:false, loginTime cleared via FieldValue.delete, attendanceScore:0) rather than deleting the doc, per the comment at modules.js:1221-1223 that payroll depends on the audit trail surviving. THE SCORE-READING LOGIC IS DUPLICATED across at least six call sites with inconsistent precedence, and is NOT centralized despite a shared helper (_attRecScore) existing: (1) modules.js:677 recScore, used in end-of-month eval candidates; (2) modules.js:1137-1142, the attendance calendar renderer - this one checks status===absent FIRST as an explicit override, then fullTime or score>=1, then loginTime or score>0, then falls back to absent for past dates with no record; (3) app.js:2482-2487 attStatus, the admin team-today dashboard - its own comment says the app never stores a status key, which is now STALE since the Phase-1 admin-edit path does write status, and this reader ignores status entirely; (4) app.js:2847-2849, the employee's own dashboard, also ignores status; (5) app.js:4641-4647 _attRecScore plus getAttendanceScore (app.js:4649-4664, sums scores over the month divided by workDaysElapsed, feeds the payslip-preview multiplier); (6) app.js:4727 and app.js:4943, the Employee Standings modal and a related screen, repeating the same inline ternary again. CRITICAL DISCOVERY: attendance currently does NOT touch the real payroll ledger at all. Payroll Compute (departments.js:2616-2769, the regular payClass path only - production/hourly workers are paid separately via Worker Payslips reading hourlyRate times hours, departments.js:2109 and 2148-2172, unrelated to this attendance model) computes gross = base+allowance, deduct = deductions+sss+philhealth+pagibig+tax, net = gross-deduct-cashAdvance. getAttendanceScore/attScore/multiplier have zero hits anywhere in departments.js by grep - attendance is never read there. The ONLY place attendance changes a pay number an employee actually sees is a DISPLAY-ONLY projection in window.renderPersonalFinance (app.js:3952, the Personal Finance page and printPayslip): multiplier = kpi*0.7 + att*0.3 (app.js:4243), computedMonth = net*multiplier (app.js:4244), earnedSoFar = computedMonth times daysElapsed/daysInMonth (app.js:4245) - this feeds the payslip preview and the Take-Home-So-Far figure but is never written back to salary_history or the ledger. So V12-PLAN's phrase 'approved leave writes attendance records so it doesn't cut pay' can currently only mean fixing that DISPLAY projection, since the real Compute engine applies no attendance-based cut today at all - that only changes if/when workstream 20 (one payroll engine) unifies the two paths. PH HOLIDAY MODEL: getPHHolidays(year) at modules.js:892 returns a no-work-day dictionary that both the attendance calendar (isNoWork = isSunday or holiday, modules.js:1130) and payroll's countWorkDays (app.js:4628-4638) exempt from their denominators - a leave day plausibly belongs in that same no-penalty-day bucket rather than the earn-a-present-score bucket, and that choice is one of the open decisions below. NO SCHEDULED-JOB INFRASTRUCTURE EXISTS in Firebase for this repo: functions/index.js has only an Auth onCreate trigger (createUserDocOnAuthCreate, index.js:99), a Firestore onWrite trigger (syncUserClaims, index.js:251-306), and two callables - zero functions.pubsub.schedule or onSchedule anywhere. The only cron precedent in the repo is GitHub Actions: monthly-backup.yml (cron 0 17 1 * *), sync-to-drive.yml (daily), keepalive.yml (monthly), each invoking a Node script in scripts/ against a service account. Any accrual job either becomes a brand-new Firebase Scheduled Function (new dependency, needs Cloud Scheduler on the Blaze plan) or a new GitHub Actions workflow plus scripts file (matches existing precedent, reuses the existing FIREBASE_SERVICE_ACCOUNT secret) or is computed lazily on read with no cron at all (the pattern getAttendanceScore already uses).

## Data model

leave_requests/{docId}, top-level collection: userId string, userName string, type one of vacation/sick/emergency/unpaid, startDate and endDate as YYYY-MM-DD strings, days number (working days, Sundays excluded only), reason string, status pending/approved/rejected, createdAt server timestamp, plus approvedBy, approvedAt, rejectedReason once actioned. Rules (firestore.rules:743-764): read is owner or isFinanceOrAdmin; create requires days is a number between 0 and 366 exclusive-inclusive, userName is a string, and either isFinanceOrAdmin or (own uid and status pending); update is isFinanceOrAdmin only - employees have no update path at all, intentionally, so nobody can tamper post-approval; delete is president only. leave_balances/{uid}, top-level collection keyed by user uid (not a subcollection of users or attendance): fields vacation and sick, both numbers, plus updatedAt. Only these two fields are ever written since only vacation and sick draw a balance. Rules (firestore.rules:809-816): read is owner or isFinanceOrAdmin; write is isFinanceOrAdmin with NO field-shape validation at all - unlike leave_requests, any isFinanceOrAdmin caller can write arbitrary fields or values here. getBalance() defaults a missing doc to vacation:0, sick:0 (modules.js:2215), so a missing doc and a doc full of zeros are indistinguishable to the reader - a seeding design must decide whether that stays true (lazy-compute model, no doc needed until something changes it) or every employee needs an explicit doc from day one (stored-counter model). attendance/{uid}/records/{date}, a subcollection whose doc id is the literal date string used for range queries via FieldPath.documentId(): fields observed across every writer are date string, uid string, loginTime (Timestamp or FieldValue.delete), attendanceScore number 0/0.5/1.0, fullTime boolean, plus autoFull (check-in path only), fullTimeAt (auto-upgrade path only), status - present only when admin-edited, never on normal employee check-in - plus note, editedBy, editedAt when admin-edited. Rules (firestore.rules:152-156): read/write is isOwner(uid) OR isFinanceOrAdmin - flagged in V12-PLAN workstream 19 as attendance self-write forgery, since an employee can write their own attendance doc with any score, not just via the controlled check-in button logic; anything this workstream writes on leave-approval should go through the finance/admin write path, not rely on the employee-owner path staying open. worker_profiles/{docId} (separate system: production-payClass hourly workers, weekly pay via hourlyRate times hours, a different logging mechanism entirely) has a caBalance field updated via FieldValue.increment (functions/index.js:163) which is a structural precedent Fable could reuse for an atomic leave-balance increment instead of read-then-set.

## Constraints — must respect

- Manila-time discipline: any date/day-of-week logic for leave ranges or accrual-period rollover must use window.bizDate/bizHour/bizDow, never raw new Date()/toISOString - already followed correctly in the leave modal default date (modules.js:2296) and payroll day-counting (app.js:4195-4201); a prior raw-UTC bug in this exact area broke attendance and payroll per the manila-time-helpers memory.
- escHtml() before any innerHTML interpolation of user-controlled leave fields such as reason or userName - already followed via the esc() alias at modules.js:2203; any new HR grant/accrual UI must keep this.
- Firestore rules coverage does not cascade or match by prefix - every collection needs its own explicit match block (firestore-rules-collection-coverage memory). A new collection such as a leave-policy or accrual-log doc needs its own rules block or reads silently deny, producing a blank screen unless wrapped in .catch().
- Rules must read fields via .get(field, default), never bare field access, or a doc missing that field denies the whole rule (firestore-rules-missing-field-throws memory) - relevant if new rules validate an accrual-write shape.
- The idempotency pattern used throughout finance/payroll (deterministic refs like PAY-{month}-{uid}, prefetch-by-range then upsert as at departments.js:2662-2703) must extend to any accrual mechanism: running it twice (re-triggered cron, manual re-run) must not double-credit balances - needs a keyed accrual-log doc per user and period checked before crediting, same discipline as the payroll ledger backfill.
- CACHE_VER in sw.js must bump on any JS/CSS edit (auto-bumped by the pre-commit hook per CLAUDE.md) - never hand-edit APP_VERSION.
- Script load order in index.html is fixed: config.js, drive.js, notifications.js, departments.js, app.js, modules.js. A new shared helper such as a unified attendance-score reader must be defined in a file that loads before every caller, or attached to window before first use.
- Leave approve/reject logic is already centralized in window.approveLeaveRequest/rejectLeaveRequest (modules.js:2366-2389) and called identically from two UI surfaces (departments.js:9509/9515 and 9739/9745) - preserve this single-source-of-truth pattern rather than letting a new leave-writes-attendance step get reimplemented divergently in each caller, which is exactly the 3-surfaces-disagree bug class the CashAdvance system currently has per the payroll-pay-run-workflow memory.
- Attendance edits soft-archive rather than hard-delete (modules.js:1221-1223, preserving the audit trail payroll depends on) - a leave-day attendance write should follow the same non-destructive merge pattern, not erase a same-day check-in the person already made.
- Records are kept forever, real-time, visible is an owner standing directive (V12-PLAN.md:17-20) - any yearly balance reset must preserve prior-year history somewhere rather than silently overwriting the counter with no trace of what was forfeited or carried over.

## DECIDED — architecture spec (Fable, 2026-07-10)

### Resolved decisions (one line each)

1. **Storage model → mutable STORED COUNTER (keep `leave_balances/{uid}` shape), plus a per-user-per-year idempotency/audit doc `leave_accruals/{uid}_{YYYY}`.** Lazy-compute was rejected: it needs a trustworthy hire date (`u.startDate` is seeded on new users via `bizDate()`/`today()` at app.js:452, modules.js:487, departments.js:9846/9342 but is ABSENT on legacy users — confirmed by grep), and it repeats a per-view monthly-range read like `getAttendanceScore`. The decrement-on-approve path already writes a counter; we keep it and add the missing seed/grant writer.
2. **Accrual cadence → YEARLY lump-sum, CALENDAR-year, prorated in the employee's first partial year.** Mechanism → a manual, idempotent **"Run annual leave accrual" button** in the Leave admin screen (finance/president), plus a seed call at the two admin user-creation points — **NO cron, NO new Cloud Function, NO Cloud Scheduler.** Yearly cadence + the repo's existing manual `backfillPayrollLedger` precedent make a once-a-year button sufficient; a GitHub-Actions annual cron is documented as an optional later enhancement only.
3. **Legal fact → ‼️ FLAG FOR NEIL (do not ship the number blind).** The statutory PH floor (Labor Code Art. 95) is **ONE combined 5-day Service Incentive Leave pool** after 1 year of service, commutable to cash if unused — NOT 5 vacation + 5 sick. The existing schema splits vacation/sick, so the company grant is a *policy choice above the floor*. Ship `window.LEAVE_POLICY` with **PLACEHOLDER `{vacation:5, sick:5}`** clearly labelled; the UI must never present 10 combined days as the legal minimum.
4. **New-hire / probation → prorate from hire month, day-one (recommended).** First calendar year of employment: grant × (monthsRemaining/12), rounded to nearest 0.5. ‼️ **FLAG FOR NEIL:** confirm whether probationary/first-year staff accrue day-one (recommended, generous) or only after completing 1 year of continuous service (the legal SIL trigger). Engine supports both via a `LEAVE_POLICY.probation` switch defaulting to `'prorate-from-hire'`.
5. **What an approved leave day writes → an ATTENDANCE record; it does NOT touch the Compute engine.** Under WS20's DECIDED engine, `computePayRun` reads attendance only through `getAttendanceScore(uid,month)` (which reads `attendance/{uid}/records`). A paid-leave day written as `attendanceScore:1.0` is automatically counted as a full present day by that reader — so "leave doesn't cut pay" is satisfied with **zero edits to `computePayRun`/`computePayLine`**. This workstream stays out of WS20's Compute code and out of WS20's frozen `lines[]`.
6. **Marker → score 1.0 AND a distinct `status` field (both).** Paid leave writes `attendanceScore:1.0` (so every score-reader counts it as full without special-casing) **plus** `status:'leave'` + `leaveType` so the calendar/standings UIs can render a 🌴 badge instead of a green ✓. All SIX duplicated readers are updated together (enumerated in Spec 3) via two new shared helpers in config.js.
7. **Unpaid leave → conditional, NOT paid-looking.** `unpaid` type writes `status:'unpaid_leave'`, `attendanceScore:0`, `fullTime:false` — it reduces pay exactly like an absence (correct: unpaid = no work = no pay) but carries a distinct non-disciplinary badge (📅), not the red ✗ of an unmarked absence. Paid types = `vacation`/`sick`/`emergency`; unpaid type = `unpaid` (a new `paid` flag is added to `LEAVE_TYPES`).
8. **No-work-day vs present-day → PRESENT (score 1.0) for paid leave, leave `countWorkDays` untouched.** A leave day is already inside `countWorkDays`' denominator (Mon–Sat, non-holiday); giving it a `1.0` numerator makes it full-credit = neutral net pay effect, and requires **no change** to `countWorkDays`/`getAttendanceScore`. (Excluding it from the denominator would force `countWorkDays` to query leave — rejected as needless coupling.)
9. **Who may seed/grant → `leave_balances.write` stays `isFinanceOrAdmin()` (secretary INCLUDED) but gains field-shape validation; the direct grant/adjust UI is gated to president+finance+manager (NOT secretary) CLIENT-side.** Secretary must keep write access because `APPROVAL_CAPS.leave` (departments.js:9138) lets a secretary approve leave, and approval decrements the balance — revoking write would silently desync the counter. Rules add non-negative-number validation to block a buggy accrual run writing NaN/negative.
10. **Reconcile day-counting → YES.** Filing switches from Sunday-only `workingDays` to a holiday-aware `leaveWorkingDays(start,end)` (excludes Sundays AND `getPHHolidays`), so a request spanning a PH holiday no longer charges the balance for a day payroll never penalizes; the attendance-write loop skips the same no-work days.

**Scoping / sequencing:** depends on **WS19** (attendance write goes through the finance/admin path — the approver is always finance/admin/secretary, all `isFinanceOrAdmin()`, so WS19's employee-self-write lockdown does NOT affect this code); composes with **WS20** with no code coupling (leave writes attendance, WS20 reads it); coordinates with **WS26** (both merge into `attendance/{uid}/records` — this spec uses non-destructive `merge:true` and only sets its own keys, so WS26's `timeOut`/`hours` fields survive and vice-versa).

---

### Spec 1 — Data shapes (annotated literals)

```js
// leave_balances/{uid}   — UNCHANGED shape + one new field. Stored counter.
{ vacation: 5,            // number ≥ 0  (remaining vacation days)
  sick: 5,                // number ≥ 0  (remaining sick days)
  year: '2026',           // NEW — policy year this counter was granted for (guards mid-year re-reset)
  updatedAt }             // serverTimestamp

// leave_accruals/{uid}_{YYYY}   — NEW collection. Idempotency key + forfeiture audit.
{ uid: 'abc123',
  year: '2026',
  grantedVacation: 5,     // number — what the annual grant awarded (post-proration)
  grantedSick: 5,
  proratedFromMonth: 7,   // number 1-12 or null (null = full-year grant)
  priorYearEndingVacation: 2,  // number or null — unused balance carried into this reset (audit; NOT re-credited by default)
  priorYearEndingSick: 0,      // number or null
  grantedBy: 'system'|'<uid>', // 'system' from creation handler, or the finance/president uid who ran backfill
  grantedAt }             // serverTimestamp

// attendance/{uid}/records/{YYYY-MM-DD}   — leave-approval write (merge:true, non-destructive)
// PAID leave (vacation/sick/emergency):
{ date:'2026-07-15', uid,
  attendanceScore: 1.0,   // full credit → getAttendanceScore counts it, no pay cut
  fullTime: true,
  status: 'leave',        // NEW status value — drives 🌴 badge in all readers
  leaveType: 'vacation',  // for badge label / tooltip
  leaveReqId: '<leave_requests docId>',
  editedBy: '<approverUid>', editedAt }   // audit, mirrors admin-edit path
// UNPAID leave (unpaid):
{ date, uid, attendanceScore: 0, fullTime:false,
  status:'unpaid_leave', leaveType:'unpaid', leaveReqId, editedBy, editedAt }

// window.LEAVE_POLICY   — NEW config constant (js/config.js). PLACEHOLDER numbers — see FLAG.
window.LEAVE_POLICY = {
  grants: { vacation: 5, sick: 5 },   // ‼️ PLACEHOLDER — Neil to confirm (legal floor is ONE 5-day SIL pool)
  yearBasis: 'calendar',              // grants reset on Jan 1 (Manila)
  probation: 'prorate-from-hire'      // vs 'after-1-year'  ‼️ FLAG FOR NEIL
};
```

### Spec 2 — New helpers & service (all pure/idempotent)

**2a — Consolidated attendance-record readers (js/config.js, so they load before every caller).**
```js
// score: paid leave is stored as 1.0 so no special-case needed here.
window.attRecScore = function(rec){
  if (!rec) return 0;
  if (typeof rec.attendanceScore === 'number') return rec.attendanceScore;
  if (rec.fullTime) return 1.0;
  if (rec.loginTime) return 0.5;
  return 0;
};
// kind: status wins, then score. Drives badge/colour in the six UIs.
window.attRecKind = function(rec){
  if (!rec) return 'none';
  if (rec.status === 'leave')        return 'leave';
  if (rec.status === 'unpaid_leave') return 'unpaid-leave';
  if (rec.status === 'absent')       return 'absent';
  const sc = window.attRecScore(rec);
  if (sc >= 1) return 'present';
  if (sc > 0 || rec.loginTime) return 'half';
  return 'none';
};
// central badge glyph/colour so all readers agree
window.attKindBadge = function(kind){
  return ({ present:{m:'✓',c:'#30d158'}, half:{m:'½',c:'#ffa040'},
            absent:{m:'✗',c:'#ff6b6b'}, leave:{m:'🌴',c:'#30d158'},
            'unpaid-leave':{m:'📅',c:'#8e8e93'}, none:{m:'',c:'#8e8e93'} })[kind] || {m:'',c:'#8e8e93'};
};
```

**2b — Leave-accrual service (js/config.js, after LEAVE_POLICY). Runs in admin context only.**
```js
window.LeaveAccrual = {
  policyYear(){ return window.bizDate().slice(0,4); },      // calendar year, Manila
  // pure proration: full year unless hired within `year`
  grantFor(annual, startDate, year){
    const y = String(year), hy = (startDate||'').slice(0,4);
    if (hy !== y) return { vacation:annual.vacation, sick:annual.sick, proratedFromMonth:null };
    if ((window.LEAVE_POLICY.probation) === 'after-1-year')
      return { vacation:0, sick:0, proratedFromMonth:parseInt((startDate||'').slice(5,7),10)||1 };
    const hm = parseInt((startDate||'').slice(5,7),10) || 1;   // 1-12
    const f  = (12 - (hm - 1)) / 12;                           // Jan→1, Jul→0.5, Dec→1/12
    const r5 = x => Math.round(x*2)/2;                         // nearest 0.5
    return { vacation:r5(annual.vacation*f), sick:r5(annual.sick*f), proratedFromMonth:hm };
  },
  // idempotent per {uid, year}: skip if leave_accruals/{uid}_{year} already exists
  async grantForYear(uid, { startDate }={}, year, { force }={}){
    year = year || this.policyYear();
    const mref = db.collection('leave_accruals').doc(`${uid}_${year}`);
    const mkr  = await mref.get();
    if (mkr.exists && !force) return { uid, skipped:true };
    const g    = this.grantFor(window.LEAVE_POLICY.grants, startDate, year);
    const cur  = await db.collection('leave_balances').doc(uid).get();
    const prior = cur.exists ? cur.data() : {};
    const FV = firebase.firestore.FieldValue;
    await db.collection('leave_balances').doc(uid).set(
      { vacation:g.vacation, sick:g.sick, year:String(year), updatedAt:FV.serverTimestamp() }, {merge:true});
    await mref.set({ uid, year:String(year),
      grantedVacation:g.vacation, grantedSick:g.sick, proratedFromMonth:g.proratedFromMonth,
      priorYearEndingVacation: cur.exists ? (prior.vacation??null) : null,
      priorYearEndingSick:     cur.exists ? (prior.sick??null) : null,
      grantedBy: (window.currentUser && currentUser.uid) || 'system',
      grantedAt: FV.serverTimestamp() });
    return { uid, granted:g };
  },
  // one-button seed / annual rollover — the backfillPayrollLedger analogue
  async runAnnualAccrual(onProgress){
    const year = this.policyYear();
    const usnap = await db.collection('users').get();
    let seeded=0, skipped=0, i=0;
    for (const d of usnap.docs){
      const u = d.data();
      if (u.role === 'partner') { skipped++; continue; }        // partners have no leave
      const res = await this.grantForYear(d.id, { startDate:u.startDate }, year);
      res.skipped ? skipped++ : seeded++;
      onProgress && onProgress(++i, usnap.size);
    }
    return { year, seeded, skipped, total:usnap.size };
  }
};
```

### Spec 3 — The SIX duplicated score-readers → route through the shared helpers

Replace each inline ternary. `window.attRecScore`/`attRecKind` are defined in config.js, which loads before departments.js/app.js/modules.js, so all callers can see them.

| # | File:line | Current | Change |
|---|-----------|---------|--------|
| 1 | modules.js:677 `recScore` | inline `typeof r.attendanceScore==='number'?…` | `const recScore = r => window.attRecScore(r);` (paid leave = 1.0 → counts as present in EOM candidates — correct) |
| 2 | modules.js:1134-1152 calendar classifier | `if(rec?.status==='absent')… else if fullTime… else if loginTime…` | insert `const kind = window.attRecKind(rec);` and branch: `kind==='leave'` → new `leaveCount++; workDays++; status='leave'`; `kind==='unpaid-leave'` → `absentCount++; workDays++; status='unpaid-leave'`; keep present/half/absent. Render badge via `window.attKindBadge(kind)` (🌴 for leave, 📅 for unpaid). Rate numerator counts paid leave as full: `pct = round(((fullCount+leaveCount)+halfCount*0.5)/workDays*100)` |
| 3 | app.js:2482-2487 `attStatus` (team-today) | ignores `status`; returns present/half/unmarked | `const attStatus = (data)=> !data ? 'unmarked' : window.attRecKind(data);` then map 'none'→'unmarked' for the pills; add 🌴/📅 chips for 'leave'/'unpaid-leave' |
| 4 | app.js:2847-2849 employee dashboard `attScore` | inline ternary | `const attScore = window.attRecScore(attData);` (leave already 1.0; optionally show 🌴 if `attData.status==='leave'`) |
| 5 | app.js:4641-4647 `_attRecScore` | inline | make it delegate: `function _attRecScore(r){ return window.attRecScore(r); }` (keeps the name for `getAttendanceScore`; leave 1.0 flows into WS20 automatically) |
| 6 | app.js:4727-4733 (Standings) AND app.js:4943-4948 (related grid) | two identical inline blocks | `const kind = window.attRecKind(rec); const score = window.attRecScore(rec); const b = window.attKindBadge(kind);` use `b.m`/`b.c` for mark/colour; count paid leave in the `full` bucket, `unpaid-leave` in `absent` |

### Spec 4 — Leave day-counting + centralised approval writer (js/modules.js LEAVE IIFE)

**4a — holiday-aware count (add inside the IIFE, alongside `workingDays` at modules.js:2206).**
```js
// Inclusive working-day count, excluding Sundays AND PH holidays — matches
// payroll's countWorkDays so a leave range never charges a day payroll ignores.
function leaveWorkingDays(start, end){
  if(!start||!end) return 0;
  const s=new Date(start+'T12:00:00'), e=new Date(end+'T12:00:00');
  if(isNaN(s)||isNaN(e)||e<s) return 0;
  const hol = (typeof getPHHolidays==='function') ? getPHHolidays(s.getFullYear()) : {};
  const holNext = (s.getFullYear()!==e.getFullYear() && typeof getPHHolidays==='function') ? getPHHolidays(e.getFullYear()) : {};
  let n=0; const d=new Date(s);
  while(d<=e){
    const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if(window.bizDow(new Date(ds+'T12:00:00'))!==0 && !hol[ds] && !holNext[ds]) n++;
    d.setDate(d.getDate()+1); if(n>366) break;
  }
  return n;
}
```
Replace the two `workingDays(...)` calls in `openLeaveModal` (modules.js:2311 hint + 2319 save) with `leaveWorkingDays(...)`; update the hint copy to `"… working day(s) (excl. Sundays & holidays)"`. Leave the historic `workingDays` fn in place (unreferenced after this) or delete — Sonnet's choice, no other caller (grep-confirmed).

**4b — add `paid` to LEAVE_TYPES (modules.js:2195-2200).**
```js
const LEAVE_TYPES = [
  { id:'vacation',  label:'Vacation Leave',  icon:'🌴', drawsBalance:true,  paid:true  },
  { id:'sick',      label:'Sick Leave',      icon:'🤒', drawsBalance:true,  paid:true  },
  { id:'emergency', label:'Emergency Leave', icon:'🚨', drawsBalance:false, paid:true  }, // paid, no counter
  { id:'unpaid',    label:'Unpaid Leave',    icon:'📅', drawsBalance:false, paid:false },
];
```

**4c — single-source approval writer (add inside the IIFE, before `approveLeave`).** This is the DRY fix that both approval surfaces call — mirrors the centralised `approveLeaveRequest` pattern the brief tells us to preserve.
```js
// Writes a paid/unpaid attendance record for every WORK day in the leave range,
// skipping Sundays & PH holidays, non-destructively (merge). Runs as the approver
// (finance/admin/secretary) → passes the attendance finance/admin write path.
async function writeLeaveAttendance(r, lt){
  if(!r.startDate || !r.endDate) return;
  const FV = firebase.firestore.FieldValue;
  const paid = lt.paid !== false;
  const s=new Date(r.startDate+'T12:00:00'), e=new Date(r.endDate+'T12:00:00');
  if(isNaN(s)||isNaN(e)||e<s) return;
  const d=new Date(s); let guard=0;
  while(d<=e && guard++<366){
    const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const hol=(typeof getPHHolidays==='function')?getPHHolidays(d.getFullYear()):{};
    if(window.bizDow(new Date(ds+'T12:00:00'))!==0 && !hol[ds]){
      await db.collection('attendance').doc(r.userId).collection('records').doc(ds).set(
        paid
          ? { date:ds, uid:r.userId, attendanceScore:1.0, fullTime:true,  status:'leave',        leaveType:r.type, leaveReqId:r.id, editedBy:currentUser.uid, editedAt:FV.serverTimestamp() }
          : { date:ds, uid:r.userId, attendanceScore:0,   fullTime:false, status:'unpaid_leave', leaveType:r.type, leaveReqId:r.id, editedBy:currentUser.uid, editedAt:FV.serverTimestamp() },
        {merge:true});
    }
    d.setDate(d.getDate()+1);
  }
}
// Shared balance-decrement + attendance-write. BOTH approval paths call this.
async function applyLeaveApproval(r){
  const lt = leaveType(r.type);
  if(lt.drawsBalance){
    const bal = await getBalance(r.userId);
    const newBal = Math.max(0,(bal[r.type]||0)-(r.days||0));
    await db.collection('leave_balances').doc(r.userId).set(
      { [r.type]:newBal, updatedAt:firebase.firestore.FieldValue.serverTimestamp() }, {merge:true});
  }
  await writeLeaveAttendance(r, lt);
}
```

**4d — `approveLeave` (modules.js:2336-2350) before→after.** Replace the inline decrement block.
```js
// BEFORE (2340-2345):
      const lt=leaveType(r.type);
      if(lt.drawsBalance){
        const bal=await getBalance(r.userId);
        const newBal=Math.max(0,(bal[r.type]||0)-(r.days||0));
        await db.collection('leave_balances').doc(r.userId).set({ [r.type]:newBal, updatedAt:firebase.firestore.FieldValue.serverTimestamp() }, {merge:true});
      }
// AFTER:
      const lt=leaveType(r.type);
      await applyLeaveApproval(r);   // decrement + write attendance (single source)
```

**4e — `approveLeaveRequest` (modules.js:2370-2376) before→after.** Same substitution.
```js
// BEFORE (2371-2376):
    const lt = leaveType(r.type);
    if(lt.drawsBalance){
      const bal = await getBalance(r.userId);
      const newBal = Math.max(0,(bal[r.type]||0)-(r.days||0));
      await db.collection('leave_balances').doc(r.userId).set({ [r.type]:newBal, updatedAt:firebase.firestore.FieldValue.serverTimestamp() }, {merge:true});
    }
// AFTER:
    const lt = leaveType(r.type);
    await applyLeaveApproval(r);    // decrement + write attendance (single source)
```
(`rejectLeave`/`rejectLeaveRequest` unchanged — no balance/attendance side-effects.)

### Spec 5 — Admin grant/adjust UI + accrual button (js/modules.js `renderLeaveAdmin`, ~2266)

Add to the admin header button row (gate client-side to president/finance/manager — NOT secretary):
```js
const canGrant = ['president','manager','finance'].includes(currentRole);
// in the <div style="display:flex;gap:8px"> at 2266, prepend when canGrant:
//   <button class="btn-secondary btn-sm" id="lv-accrue">↻ Run Annual Accrual</button>
//   <button class="btn-secondary btn-sm" id="lv-grant">＋ Adjust Balance</button>
```
Handlers (append after the CSV binding at 2290):
```js
if(canGrant){
  document.getElementById('lv-accrue')?.addEventListener('click', async ()=>{
    const yr = window.LeaveAccrual.policyYear();
    if(!confirm(`Grant / reset ${yr} leave balances for all employees?\nAlready-accrued employees are skipped (idempotent). Vacation ${window.LEAVE_POLICY.grants.vacation} / Sick ${window.LEAVE_POLICY.grants.sick} days.`)) return;
    Notifs.showToast('Running annual accrual…');
    try{ const res=await window.LeaveAccrual.runAnnualAccrual();
      window.logAudit && window.logAudit('accrue','leave',yr,res);
      Notifs.showToast(`Accrual ${yr}: ${res.seeded} granted, ${res.skipped} skipped.`);
      renderLeaveAdmin(c);
    }catch(ex){ Notifs.showToast('Accrual failed: '+(ex.message||ex.code),'error'); }
  });
  document.getElementById('lv-grant')?.addEventListener('click', ()=> openGrantModal(c));
}
```
`openGrantModal` — a small form (employee picker, vacation number, sick number) that `db.collection('leave_balances').doc(uid).set({vacation,sick,year:LeaveAccrual.policyYear(),updatedAt},{merge:true})` after `escHtml`-ing the picker labels. Numbers must be `>=0` (client `Math.max(0,…)`), matching the new rule shape check.

**Seed at user creation** (so new hires aren't stuck at 0): after each admin-context `users.add(...)`/`.set(...)` that creates an employee, call
```js
await window.LeaveAccrual.grantForYear(newUid, { startDate: <the startDate just written> });
```
Call sites to patch (all run as president/finance → allowed to write `leave_balances`): the signup-approval add at departments.js:9342, the HR add-employee handler around app.js:6594-6721, and departments.js:9846. If a site `.add()`s (auto-id) and doesn't await the ref, capture `const ref = await users.add(...); await LeaveAccrual.grantForYear(ref.id, {startDate:…});`.

### Spec 6 — firestore.rules diffs (block-scoped, before→after)

**6a — `leave_balances` (rules 809-816): add non-negative-number shape validation.** Principal set unchanged (secretary retained so the approve-decrement path still works — see Decision 9).
```
// BEFORE
    match /leave_balances/{uid} {
      allow read:  if isAuth() && (isOwner(uid) || isFinanceOrAdmin());
      allow write: if isAuth() && isFinanceOrAdmin();
    }
// AFTER
    match /leave_balances/{uid} {
      allow read:  if isAuth() && (isOwner(uid) || isFinanceOrAdmin());
      // Shape-guard so a buggy accrual run can't write NaN/negative/wrong-typed counters.
      // .get(field,default) — a missing field must not deny the rule (missing-field-throws memory).
      allow write: if isAuth() && isFinanceOrAdmin()
        && request.resource.data.get('vacation', 0) is number
        && request.resource.data.get('vacation', 0) >= 0
        && request.resource.data.get('sick', 0) is number
        && request.resource.data.get('sick', 0) >= 0;
    }
```

**6b — NEW `leave_accruals` block (place after `leave_balances`, ~817).**
```
    // ── Leave accruals (annual grant idempotency key + forfeiture audit) ─
    // docId = {uid}_{YYYY}. Owner reads own history; finance/admin read all +
    // write (grant runs in admin context — employees never write). President-only delete.
    match /leave_accruals/{docId} {
      allow read:   if isAuth() && (resource.data.get('uid','') == request.auth.uid || isFinanceOrAdmin());
      allow create: if isAuth() && isFinanceOrAdmin()
        && request.resource.data.get('grantedVacation', 0) is number
        && request.resource.data.get('grantedVacation', 0) >= 0
        && request.resource.data.get('grantedSick', 0) is number
        && request.resource.data.get('grantedSick', 0) >= 0;
      allow update: if isAuth() && isFinanceOrAdmin();
      allow delete: if isAuth() && isPresident();
    }
```

**6c — `attendance` (rules 152-156): NO change in this workstream.** The leave-approval write is performed by the approver (always `isFinanceOrAdmin()`), which the existing `allow write` already permits. When WS19 tightens the owner-self-write path, the finance/admin clause this code relies on must remain — leave this block to WS19. Deploy `leave_balances`/`leave_accruals` via `firebase deploy --only firestore:rules` (re-diff first per the concurrent-edit memory).

### Spec 7 — Migration / rollout checklist (ordered)

1. **Deploy rules first** (6a + 6b) via `--only firestore:rules`, re-diffing against live to avoid clobbering a concurrent session's rules edits.
2. **Ship the JS** (one commit): config.js (helpers + `LEAVE_POLICY` + `LeaveAccrual`), modules.js (`leaveWorkingDays`, `paid` flag, `writeLeaveAttendance`/`applyLeaveApproval`, the two approval substitutions, admin buttons), the six reader replacements in app.js/modules.js, and the seed-at-creation calls. Verify with `node --check` on each edited file + a preview boot (no automated suite). CACHE_VER/APP_VERSION auto-bump via the pre-commit hook — do not hand-edit.
3. **Confirm `LEAVE_POLICY.grants` with Neil BEFORE step 4** (‼️ FLAG — the number is a legal/policy decision, not an engineering one).
4. **Seed existing employees:** open Leave Management → **Run Annual Accrual**. This writes every non-partner user's `leave_balances` + `leave_accruals/{uid}_{2026}` (idempotent; safe to re-run). Employees hired in 2026 are auto-prorated from `startDate`; legacy users with no `startDate` get the full-year grant. This MUST precede any resumed filing, or the client pre-check (modules.js:2322) blocks a first request against a still-zero balance.
5. **Forward-only attendance:** already-approved PAST leave is **NOT** auto-backfilled into attendance (rewriting historical attendance could shift closed-month attendance %s and past pay — risky). New approvals write attendance going forward. If a specific past request needs backfilling, re-approve it (idempotent) or add a per-request "Write attendance" admin action later — out of scope here.
6. **Annual rollover (each January):** finance presses Run Annual Accrual once. The `year` field on `leave_balances` + the `leave_accruals/{uid}_{YYYY}` marker guard against a mid-year double-reset; the prior year's ending balance is captured in `leave_accruals.priorYearEnding*` for the forfeiture/commutation audit. ‼️ **FLAG FOR NEIL:** (a) carry-over of unused days (default: none — reset to fresh grant, prior balance recorded not re-credited); (b) cash commutation of unused SIL (legally required for the statutory pool). Optional later enhancement: a GitHub-Actions annual cron calling a `scripts/` runner of `runAnnualAccrual` against `FIREBASE_SERVICE_ACCOUNT` — matches `monthly-backup.yml` precedent, no code here depends on it.
7. **Backup coverage:** `leave_balances` is already in `scripts/monthly-backup.js:190`; add `leave_accruals` to that EXPORTS list in the same commit.

### Spec 8 — Manual test checklist (no automated suite)

1. Run Annual Accrual → an existing employee's `leave_balances` shows `vacation:5 / sick:5 / year:'2026'`; `leave_accruals/{uid}_2026` exists. Re-run → toast reports them **skipped** (idempotent), balances unchanged.
2. New employee hired 2026-07 via HR form → balance auto-seeds to ~2.5 vacation / 2.5 sick (6/12 proration, rounded to 0.5); `proratedFromMonth:7` on the accrual doc.
3. Employee files 3-day vacation spanning a Sunday and a PH holiday → modal charges **3** working days, not 5 (holiday-aware count).
4. Approve that request from BOTH surfaces (standalone Leave screen AND unified Approvals queue) → balance decrements by 3 in each case (shared `applyLeaveApproval`); `attendance/{uid}/records/{date}` for each work day shows `status:'leave', attendanceScore:1.0`; Sunday/holiday dates have NO leave record.
5. Open the attendance calendar (modules.js) for that month → leave days render 🌴 (green), count toward the rate as full, NOT as absent.
6. Confirm the same leave days render 🌴 on: team-today dashboard (app.js:2482), Employee Standings modal (app.js:4727), the related grid (app.js:4943), and the employee's own dashboard (app.js:2847). No reader shows a plain ✓ or ✗ for a leave day.
7. Approve a 1-day **unpaid** leave → attendance shows `status:'unpaid_leave', attendanceScore:0`, renders 📅 (grey), and DROPS that day's attendance credit (unpaid, but visually distinct from a red ✗ absence). Balance NOT decremented (unpaid draws no balance).
8. WS20 integration: run WS20 Compute for the month → the leave employee's `attScore` is unchanged/high (paid leave counted full by `getAttendanceScore`); under default `payPolicy:'flat'` their `finalPay` is identical to a full-attendance month → **leave did not cut pay.**
9. Rules: as a signed-in employee, attempt `leave_balances/{ownUid}.set({vacation:999})` from console → DENIED (write requires finance/admin). As finance, attempt `set({vacation:-1})` → DENIED (shape guard). As finance, `set({vacation:4})` → allowed.
10. Secretary approves a leave request from the Approvals queue → balance still decrements (secretary retained in `leave_balances.write`); but the ＋ Adjust Balance / Run Annual Accrual buttons are HIDDEN for secretary (client gate).

## Risks / cross-workstream interactions

- ⚠️ Cross-workstream collision with 20 (One payroll engine, kills the second compute path, Compute freezes per-employee snapshot lines into pay_runs): if this workstream makes attendance or leave feed into real payroll math for the first time, it changes the same Compute function (departments.js:2616-2769) that 20 is simultaneously rearchitecting. Building attendance-aware pay into the OLD Compute path risks being immediately obsoleted or duplicated by 20.
- ⚠️ Cross-workstream collision with 26 (Attendance v2, time-out plus hours, a holidays admin screen, extension-upgrade bug fix): both workstreams touch the same attendance record shape and the same holiday-exemption logic (getPHHolidays, modules.js:892) in the same files (the attendance calendar around modules.js:1090-1240, the check-in handler around app.js:3110-3190). If 26 adds new fields such as timeOut or hours to the same document, this workstream's leave-day write must be designed not to collide with or be overwritten by 26's changes.
- ⚠️ Cross-workstream collision with 19 (Security closes, which explicitly lists attendance self-write forgery as an open finding): the attendance rules (firestore.rules:152-156) currently let an employee write their own attendance record with an arbitrary score via isOwner(uid). If 19 tightens this, for example restricting employee writes to only the check-in shape, any code this workstream adds for leave-approval-writes-attendance must go through a privileged finance/admin write path, not assume the owner-write path stays open.
- ⚠️ The six duplicated score-reading implementations mean a leave-day fix applied to only one or two of them, for example just getAttendanceScore, will look correct on the personal-finance page but show the wrong status or color on the admin team-today dashboard (app.js:2482-2487), the attendance calendar (modules.js:1137-1142), or the Employee Standings modal (app.js:4727). Phase 1 workstream 5 exists specifically because a prior version of this exact bug class - a stale score, inconsistent reads - silently broke pay. Any spec Fable writes should enumerate all six call sites explicitly rather than leaving an implementer to find only the obvious one.
- ⚠️ leave_requests.create has real shape validation in rules (days is a number, 0 to 366) but leave_balances.write has none at all (firestore.rules:815 is simply isAuth and isFinanceOrAdmin) - a buggy accrual script could write NaN, a negative number, or a wrong field name with no rules-level guard; consider tightening this alongside the new seeding logic.
- ⚠️ leave_balances defaults an absent doc to vacation:0, sick:0 in the app (modules.js:2215) - if the seeding mechanism is a one-time backfill for existing employees, similar to the payroll ledger backfill pattern, a leave request that is currently mid-flight and pending against a zero balance needs a defined migration order: seed balances before any further leave approvals are processed, or an employee's very first request could already be wrongly blocked by the pre-existing days-exceed-balance client check (modules.js:2322).
- ⚠️ Emergency and unpaid leave types never draw a balance today and are never decremented anywhere - if a spec assumes every approved leave type writes a paid attendance record, unpaid leave by definition should not get a full-pay write; conflating the categories would silently make unpaid leave paid.
- ⚠️ The in-repo code comment at app.js:2479-2481, claiming the app never stores a status key and mirrors modules.js, is factually stale post-Phase-1 since admin edits do write status (modules.js:1217-1223) - Fable should not trust in-repo comments as ground truth for what other read sites do; each of the six duplicated readers cited above was independently grepped and quoted rather than inferred from comments.

## Files likely touched

`js/modules.js (leave request/approval IIFE around 2188-2390; attendance calendar render/edit around 1090-1240; getPHHolidays at 892)`, `js/app.js (renderPersonalFinance around 3952-4300 including multiplier/computedMonth/earnedSoFar; check-in handler around 3110-3190; getAttendanceScore/_attRecScore/countWorkDays around 4620-4665; employee dashboard around 2813-2900; admin team-today dashboard around 2440-2495; Employee Standings modal around 4688-4760 and beyond)`, `js/departments.js (Approvals unified queue APPROVAL_CAPS/canActOn around 9128-9150, leave sub-tab around 9711-9749, main-queue leave actions around 9509/9515/9739/9745; Payroll Compute around 2616-2769 if this workstream extends pay math)`, `firestore.rules (leave_requests around 743-764, leave_balances around 809-816, attendance around 152-156; any new collection for accrual state or an accrual log needs a new match block)`, `functions/index.js, only if the accrual mechanism becomes a Firebase Scheduled Function - no existing onSchedule precedent, this would be new`, `scripts/, plus a new .github/workflows yaml cron file, if the accrual mechanism follows the existing GitHub Actions cron precedent instead`, `js/config.js, only if a new nav entry such as an HR Leave Balances admin screen is added`, `sw.js (CACHE_VER bump, required on any JS/CSS edit per repo convention)`

## Expected deliverable format

> A numbered build spec Sonnet can execute without further judgment calls: one, the exact decision made for each open decision above, stated as a one-line policy, for example stored counter, monthly cron via GitHub Actions, hire-date-prorated, one combined five-day SIL pool split some percentage vacation/sick unless overridden. Two, the exact new or changed Firestore document shapes - field name, type, default - for leave_balances and any new collection, plus a literal firestore.rules diff, before and after blocks in the same comment-then-match style as the existing rules file, for every collection touched. Three, exact function signatures and before/after code blocks for the new seed/accrual mechanism with its idempotency key or log-doc pattern spelled out, the change to approveLeave and approveLeaveRequest (modules.js:2336-2361 and 2366-2380) that writes the attendance record, and a single consolidated attendance-score-reader helper plus a literal list of the six call sites by file and line that it must replace, so Sonnet does not have to rediscover the duplication itself. Four, a numbered migration and backfill checklist, in the style of the existing backfillPayrollLedger pattern, covering the order of operations for seeding existing employees' balances without breaking in-flight pending requests, and whether or how any already-approved-but-unrecorded past leave gets backfilled into attendance. Five, explicit UI mockup and copy wherever a leave day needs to render distinctly from a normal present day - calendar badge, Employee Standings grid, personal-finance breakdown - if the distinct-marker open decision is chosen. Six, an explicit note on which of workstreams 19, 20, or 26 this spec depends on or must be sequenced around, per the risks above, so Sonnet does not build against a Compute function that is about to be replaced.
