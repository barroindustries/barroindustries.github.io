# Workstream 26 — Attendance v2 (time-out + hours, holidays admin, extension-upgrade fix)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

All line numbers verified live on branch "v12" (post-Phase-1) via grep/Read — not copied from the stale audit artifact.

1) ATTENDANCE CAPTURES TIME-IN ONLY. No time-out/logout field exists anywhere in the daily attendance system. Grepped `loginTime`, `logoutTime`, `timeOut`, `clockOut`, `checkOut` across js/*.js: zero hits for logoutTime/clockOut/checkOut. The only `timeOut` occurrences (departments.js:4154, 4202) belong to a fully separate, disconnected manual weekly timesheet UI (see item 4 below) — not the daily attendance record.

Record path: `attendance/{uid}/records/{date}` (date = YYYY-MM-DD Manila, doc ID = date).

Self check-in write, app.js:3122-3128 (inside the `check-in-btn` handler in `renderEmployeeDashboard`):
```
await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).set({
  loginTime: firebase.firestore.FieldValue.serverTimestamp(),
  uid: currentUser.uid, date: todayStr,
  attendanceScore: autoFull ? 1.0 : 0.5,
  fullTime: autoFull, autoFull
}, { merge: true });
```

Admin manual-edit write, modules.js:1216-1223 — all three status choices touch `loginTime` but none write a check-out counterpart:
- present: `loginTime: Timestamp.fromDate(new Date())` (a fabricated "now", not a real punch time), `fullTime:true`, `status:'present'`, `attendanceScore:1.0`
- half: `loginTime: Timestamp.fromDate(new Date())`, `fullTime:false`, `status:'half'`, `attendanceScore:0.5`
- absent: `status:'absent'`, `fullTime:false`, `loginTime: FV.delete()`, `attendanceScore:0` (soft-archived, not deleted — comment at modules.js:1221-1222 explains this preserves the audit trail payroll depends on)

Full observed field set on a record doc (union of app.js:3122-3128, 3184-3187, 2845-2866 and modules.js:1216-1223): `date`, `uid`, `loginTime` (Timestamp, absent = not timed in), `fullTime` (bool), `attendanceScore` (0 | 0.5 | 1.0 — the canonical field; payroll/KPI read this FIRST, per app.js:2847-2849 and the modules.js:1213-1215 comment "payroll and EOM read it FIRST [...] so an edit that leaves an old score behind silently never reaches pay"), `autoFull` (bool, self-checkin path only), `fullTimeAt` (Timestamp, set only by the notification-upgrade path, app.js:3186), `status` ('present'|'half'|'absent' — admin-edit path only; self-checkin never sets this field), `note`, `editedBy`, `editedAt`.

The 0/0.5/1.0 `attendanceScore` model: 0.5 on time-in inside the 7-9AM window (or an approved extension), upgraded to 1.0 either automatically at check-in if the employee has zero unread notifications (`autoFull`, app.js:3111-3128) or later via `tryUpgradeAttendanceOnNotifRead` once all notifications are checked (app.js:3170-3189, called from notifications.js:179-181 when `remaining === 0`).

2) THE "HARD-BLOCKS AT 9AM" BUG — confirmed, exact conditional quoted.

app.js:3170-3189, `window.tryUpgradeAttendanceOnNotifRead`:
```
window.tryUpgradeAttendanceOnNotifRead = async function() {
  if (!currentUser) return;
  const todayStr = bizDate();

  // 9am Manila is the hard deadline for both time-in and notification reading
  if (bizHour() >= 9) {
    Notifs.showToast('⏰ Deadline passed — notifications must be checked before 9:00 AM for full attendance.', 'error');
    return;
  }

  const todaySnap = await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).get();
  if (!todaySnap.exists || !todaySnap.data().loginTime) return; // must have timed in first
  const current = todaySnap.data();
  if ((current.attendanceScore||0) >= 1.0) return; // already full
  await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).set({
    attendanceScore: 1.0, fullTime: true,
    fullTimeAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  ...
};
```
This function checks ONLY `bizHour() >= 9` — it never reads `attendance_extensions` or an `expiresAt`. But the dashboard render code that decides whether the employee is even ALLOWED to time in DOES respect an approved extension (app.js:2852-2866):
```
const extData      = extSnap.exists ? extSnap.data() : null;
const extApproved  = extData?.status === 'approved' && extData?.expiresAt
                       && now < extData.expiresAt.toDate();
...
const canTimeIn    = !hasLogin && (inWindow || extApproved);
const extExpiresStr = extApproved
  ? extData.expiresAt.toDate().toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})
  : '';
```
And the UI literally promises the extended deadline to the employee (app.js:2995, 2999, 3003):
```
${extApproved?'Check notifications before '+extExpiresStr+' → 100%':'Check all notifications before 9:00 AM → 100%'}
...
Tap the 🔔 bell → check <em>every</em> notification before 9:00 AM${extApproved?' (before '+extExpiresStr+')':''} → 100%.
...
${extApproved?`<span style="color:var(--warning)">⏰ Extension approved — expires ${extExpiresStr}</span><br>`:''}
```
So: a president can approve an extension until e.g. 3:00 PM (6-hr window, set at modules.js:1054 `new Date(approvedAt.getTime() + 6 * 60 * 60 * 1000)` and departments.js:9925 `expiresAt.setHours(expiresAt.getHours() + 6)`), the employee times in at 11 AM (allowed, `canTimeIn` respects `extApproved`), the UI tells them "check notifications before 3:00 PM → 100%", they do so at noon — and `tryUpgradeAttendanceOnNotifRead` silently refuses and shows an error toast, because it only checks the flat 9AM cutoff. This is the exact contradiction the audit flagged.

Extension approval is duplicated in two separate UI surfaces that both write the same `attendance_extensions/{uid}_{todayStr}` doc independently: modules.js:1050-1069 (Attendance page widget, president/manager) and departments.js:9922-9940 (Approvals hub "attendance" sub-tab). Both independently compute `expiresAt = approvedAt + 6h`; there is no shared helper.

3) PH HOLIDAYS TABLE — hardcoded in JS, `getPHHolidays(year)` at modules.js:892-961.
- Fixed-date regular/special holidays (New Year, Araw ng Kagitingan, Labor Day, Independence Day, Bonifacio Day, Christmas, Rizal Day, EDSA, Ninoy Aquino Day, All Saints/Souls, Immaculate Conception, Christmas/New Year's Eve) are template-string keyed by `${year}` (modules.js:896-911) — these work for ANY year, no code change ever needed.
- National Heroes Day (last Monday of August) is computed algorithmically (modules.js:912-917) — also works for any year.
- Holy Week (Maundy Thursday/Good Friday/Black Saturday), Chinese New Year, Eid'l Fitr, and Eid'l Adha are each a hardcoded lookup table covering ONLY years 2024-2028 (modules.js:920-958, four separate `{year: 'date', ...}` object literals). **2026 is covered.** 2029 and beyond would silently return holidays minus these four movable observances (no crash, no warning — `if (holyWeek[year])` etc. just skip if the year key is absent), which would quietly corrupt `countWorkDays()` (the payroll workday denominator) and the attendance calendar's holiday flags starting 2029.
- These dates are also inherently approximate/proclamation-dependent even within 2024-2028 — Chinese New Year and the two Eid dates are lunar/moon-sighting-based and Philippine regular/special-holiday proclamations (Malacañang) sometimes move dates from the astronomical default, which the hardcoded table cannot reflect.
- `getPHHolidays` feeds directly into payroll math: `countWorkDays(year, month, upToDay)` (app.js:4628-4636) subtracts Sundays AND `hol[ds]` holiday dates to produce the workday denominator used by `getAttendanceScore` (app.js:4646-4662+) and the employee dashboard KPI (app.js:2839-2842, 2883-2884). A holidays-admin UI is therefore not a leaf feature — it changes a value multiple payroll/KPI computations depend on.
- No `settings/holidays_*` collection exists today (grepped `holidays` + `settings/` across firestore.rules and js/*.js — no hits besides the hardcoded JS table and unrelated `settings/employeeOfMonth` / `settings/sales_sop` docs). Confirmed clean slate.

4) THE ONLY EXISTING "HOURS" COMPUTATION IS STRUCTURALLY UNRELATED TO DAILY ATTENDANCE.
`computeDayHours(timeIn, timeOut)` already exists at departments.js:4152-4163:
```
// Hours between two "HH:MM" time strings, minus a flat 1hr lunch deduction
// if the shift overlaps the 12:00–13:00 lunch window. Handles overnight shifts.
function computeDayHours(timeIn, timeOut) {
  if (!timeIn || !timeOut) return 0;
  const toMin = t => { const [h,m] = t.split(':').map(Number); return h*60+m; };
  let inM = toMin(timeIn), outM = toMin(timeOut);
  if (outM <= inM) outM += 24*60; // overnight shift
  let mins = outM - inM;
  const lunchStart = 12*60, lunchEnd = 13*60;
  if (inM < lunchEnd && outM > lunchStart) mins -= 60; // shift spans 12–1PM lunch
  return Math.max(0, mins/60);
}
```
But this is called ONLY from the Worker Payslip builder (departments.js ~4019-4114, 4199-4204), where HR manually types 7 pairs of `<input type="time">` fields (`ps-tin-{i}`/`ps-tout-{i}`, one row per weekday, defaulting to 07:00-16:00 Mon-Fri / 07:00-18:00 Sat, i.e. an assumed 8-hr day) into a per-pay-period form. A live listener (`recomputeHours`, departments.js:4095-4114) sums the 7 days into `ps-hrs`, which then drives `regTotal = rph * hrs` in `collectPayslipData` (departments.js:4168-4169). None of this reads from the `attendance/{uid}/records` collection — it is 100% manual entry, disconnected from the daily check-in system in item 1.

5) PRODUCTION/HOURLY WORKERS LIVE IN A DIFFERENT COLLECTION WITH NO LOGIN AND NO ATTENDANCE CAPTURE AT ALL.
`payClass` on a `users` doc (departments.js:2148-2149, 2495-2541) distinguishes 'production' (weekly, fixed rate, paid via Worker Payslips) from 'regular' (monthly, KPI+attendance-based) — but the option label itself (departments.js:2500) already says "Production — weekly, fixed rate (hourly attendance, 8-hr day)", i.e. the 8-hr-day assumption is already named in the UI copy today.

Production workers are actually modeled as `worker_profiles/{docId}` documents (departments.js:3585, 3776-3777; firestore.rules:675-679: finance/admin-only read/write, no owner-read clause) — auto-generated doc IDs via `.add()`, fields include `hourlyRate`, `dailyRate`, `foodAllowance`, `allowances{meal,transport}`, `caBalance`, `includeInPayroll`, but **no `uid` or Firebase Auth link field of any kind** (confirmed by reading the full create/edit payload at departments.js:3737-3776 — no auth reference is written). This lines up with workstream 27 ("worker login unblock" + "Create-Worker-Account screen re-linked (currently orphaned)") describing worker accounts as not yet functional. So today, a production/hourly worker has ZERO path into the `attendance/{uid}/records` collection — there is no daily check-in mechanic for them at all; all their hours are manually re-typed into the payslip form every pay period as described in item 4.

6) SUPPORTING PRECEDENT PATTERNS.
- `settings/{docId}` collection (firestore.rules:258-261): `allow read: if isAuth(); allow write: if isAuth() && isPresident();` — used today for `settings/employeeOfMonth` (modules.js:502-518) and `settings/sales_sop` (departments.js:4991). A `settings/holidays_{year}` doc would already be covered by this exact rule with ZERO firestore.rules changes needed.
- Manila-time helpers are centrally defined in js/config.js:17-37 (`window.BIZ_TZ`, `bizDate`, `bizHour`, `bizDow`, `bizYear`), with an explicit comment (config.js:10-16) warning that raw `toISOString()` silently corrupted attendance + pay before this fix — any new time-out logic must use these, never `new Date().toISOString()`.
- `dbCachedGet`/`dbCacheInvalidate` (js/config.js:211-214+) is the in-memory read-cache helper already used for `attendance_extensions` pending counts (`att-ext-pending` key, app.js:2247, 3154; departments.js invalidation at modules.js:1025) — any new holidays-admin read path should follow the same cache-key + explicit-invalidate discipline.
- No geofence/kiosk code of any kind exists yet (grepped `geofence`, `kiosk` — zero hits) — this part of the workstream is greenfield, not a migration.

## Data model

attendance/{uid}/records/{date} (subcollection, doc ID = YYYY-MM-DD Manila):
  date: string "YYYY-MM-DD"
  uid: string
  loginTime: Timestamp | absent (deleted on admin "absent")
  fullTime: boolean
  attendanceScore: number (0 | 0.5 | 1.0) — canonical, read first by payroll/KPI
  autoFull: boolean (self-checkin path only, true if zero unread notifications at time-in)
  fullTimeAt: Timestamp (set only when notification-triggered upgrade succeeds)
  status: 'present' | 'half' | 'absent' (admin manual-edit path only)
  note: string (admin manual-edit path only)
  editedBy, editedAt: admin manual-edit audit fields
  NOT PRESENT ANYWHERE: any time-out/logout/checkout timestamp, any derived hoursWorked field.

attendance_extensions/{uid}_{date} (top-level collection, deterministic composite doc ID):
  uid, userName, date, status ('pending'|'approved'|'denied'), requestedAt (Timestamp)
  approvedAt, approvedBy, expiresAt (Timestamp, approvedAt + 6h) — set on approve
  deniedAt, deniedBy — set on deny
  Rules (firestore.rules:159-167): read = any authed non-partner; create = any authed user; update/delete = admin only.

users/{uid} (relevant fields only):
  payClass: 'regular' (default/unset) | 'production' — read at departments.js:2148-2149, 2495-2541 to route monthly vs weekly-worker-payslip pay paths.

worker_profiles/{docId} (top-level, auto-ID, NO uid/auth link field):
  name, idNumber, jobTitle, department, employmentType, workType, dailyRate, hourlyRate, foodAllowance,
  allowances{meal,transport}, ssNum, phNum, pagibigNum, tinNum, address, phone, status ('active'|'inactive'),
  caBalance, includeInPayroll, createdAt/createdBy, updatedAt.
  Rules (firestore.rules:675-679): read/create/update = finance/admin only; delete = president only. No self-read clause exists (there is no "self" — no uid).

payslips/{docId} (created at departments.js:4140, from collectPayslipData departments.js:4165-4237):
  workerId (→ worker_profiles doc id), workerName, workerIdNum, jobTitle, department, tinNum/ssNum/phNum/pagibigNum,
  payPeriodStart, payPeriodEnd, payPeriodMonth, payDate, company, preparedBy,
  regular{dailyRate, ratePerHr, hrsWorked, total}, overtime{ratePerHr, hours, total},
  allowances{meal, transport, rent, total}, grossPay,
  deductions{govt{sss,philhealth,pagibig,total}, other{cashAdvance,loans,taxes,total}},
  timeLog: [{day:'Mon'..'Sun', timeIn:'HH:MM', timeOut:'HH:MM', hours:number}] (also written under key `schedule`, departments.js:4236) — this is the ONLY place per-day time-in/time-out/hours exists today, and it is 100% manually typed by HR per pay period, not sourced from attendance/{uid}/records.
  status: 'draft'|'verified'|'filed'|'submitted' (PAYSLIP_STAGES, departments.js:4230).

settings/{docId} (top-level, existing generic singleton-config collection):
  Examples in use: settings/employeeOfMonth, settings/sales_sop. Rules (firestore.rules:258-261): read = any authed; write = president only. No settings/holidays_* doc exists yet — this is the natural, already-covered home for a holidays-admin doc (e.g. settings/holidays_{year} merged over the hardcoded getPHHolidays(year) table), needing zero rules changes.

Cross-cutting read: countWorkDays(year, month, upToDay) (app.js:4628-4636) calls getPHHolidays(year) and is itself called from getAttendanceScore (app.js:4646+), the employee dashboard KPI block (app.js:2883-2884), and at least 4 other sites in app.js (3979-3980, 4199-4200, 4848-4849, 4976) — any holidays-admin override must flow through (or replace) this single function to actually reach payroll.

## Constraints — must respect

- Manila-time discipline: all day/hour logic MUST use window.bizDate()/bizHour()/bizDow()/bizYear() (js/config.js:17-37) — never new Date().toISOString(). The config.js:10-16 comment explains this exact class of bug (UTC date landing on the wrong Manila day) previously corrupted attendance + payroll; any new time-out capture, extension-expiry check, or holidays-year lookup must follow this pattern.
- escHtml() discipline: any holidays-admin UI or attendance display that interpolates user/admin-entered strings (holiday name, note field, employee name) into innerHTML must go through escHtml() (modules.js pattern used throughout, e.g. departments.js:9905, 9915-9916, modules.js:1180, 1189) per CLAUDE.md conventions.
- Firestore rules coverage is NOT cascading and does NOT match by prefix (per repo-wide convention, confirmed again here): attendance/{uid}/{document=**} (firestore.rules:153-156) and attendance_extensions/{docId} (159-167) are each explicit top-level matches. Any NEW collection this workstream introduces (e.g. a holidays override, or a new attendance-kiosk/geofence collection) needs its own explicit match block — a missing rule silently DENIES and produces a blank screen unless the read is wrapped in .catch() (the pattern used everywhere here, e.g. .catch(()=>({docs:[]})) at app.js:2825, departments.js:9165/9245/9891).
- attendanceScore is the single field payroll/KPI/EOM actually read (modules.js:1213-1215 comment: '...so an edit that leaves an old score behind silently never reaches pay' — this was literally Phase-1 workstream 5's fix). Any new hours-worked/time-out feature must keep writing attendanceScore (or its successor) as the canonical field other systems consume, not just a new hoursWorked side-field nobody reads yet.
- settings/{docId} write is president-only (firestore.rules:258-261: allow write: if isAuth() && isPresident()). If holidays-admin uses this collection, only the president can edit it as-is — Fable must decide whether that's acceptable for a 'holidays admin screen' or whether the write rule needs loosening to isAdmin()/isFinanceOrAdmin() for HR/manager to maintain it (a rules change, which per repo convention needs firebase deploy --only firestore:rules run separately from git push).
- attendance_extensions update/delete is admin-only (firestore.rules:166: allow update, delete: if isAuth() && isAdmin();); create is open to any authed user (165) — this is how an employee can file their own extension request but only an admin can approve/deny it. Any rework of the extension flow must preserve this create-vs-approve asymmetry.
- dbCachedGet/dbCacheInvalidate (js/config.js:211-214+) is the established read-cache pattern; the existing attendance_extensions pending-count uses key 'att-ext-pending' with an explicit dbCacheInvalidate call at every write site (app.js:3154; modules.js:1025). A holidays-admin read or a new attendance summary should follow the same cache-key-plus-explicit-invalidate discipline rather than re-fetching on every render or, worse, going stale.
- Script load order is fixed (index.html, per CLAUDE.md): firebase-config.js -> config.js -> drive.js -> notifications.js -> departments.js -> app.js -> modules.js. getPHHolidays is defined in modules.js but consumed by app.js (2839, 4629) via a defensive typeof getPHHolidays === 'function' guard (both call sites) BECAUSE app.js loads before modules.js in the script order — any refactor that moves or renames getPHHolidays must either keep it in modules.js (loaded after app.js needs it) or preserve/extend this defensive-typeof-guard pattern, not assume direct availability.
- CACHE_VER in sw.js must be bumped on this workstream's edits (any js/css touch) per CLAUDE.md — though note the repo's pre-commit hook now auto-bumps APP_VERSION/index.html strings; confirm whether CACHE_VER itself is included in that automation or still needs a manual bump (CLAUDE.md's own wording flags CACHE_VER as a separate manual step from the auto-bumped APP_VERSION).
- Production/hourly worker data (worker_profiles) has no rules-level self-read (firestore.rules:675-679 is finance/admin-only, no owner clause) because there is no uid to check — this is a structural precondition, not a bug: any change that lets workers self-clock-in requires resolving how a worker authenticates at all (ties directly into workstream 27's 'worker login unblock', not something workstream 26 can silently assume away).

## Open decisions — Fable resolves these

- [ ] Where does time-out get captured, and by whom? A second self-service button next to check-in-btn (app.js:3111) for the SAME users/{uid}-keyed attendance/{uid}/records/{date} doc (adds a logoutTime field) — vs. a kiosk/geofence device that writes on behalf of factory floor staff who may not carry the app open all day. The plan text ('optional geofence/kiosk for factory staff') suggests these might be two different mechanisms for two different populations (office employees self-serve; factory workers use a kiosk) — Fable must decide whether that's one unified attendance write path with two entry UIs, or genuinely separate data flows.
- [ ] How does a derived hoursWorked reconcile with the existing 0/0.5/1.0 attendanceScore model that payroll/KPI already depend on (modules.js:1213-1215 says payroll reads attendanceScore FIRST)? Options: (a) hoursWorked becomes a NEW parallel field alongside attendanceScore, with attendanceScore continuing to gate monthly-employee KPI/pay math unchanged, while hoursWorked feeds ONLY the new production/hourly pay path; (b) attendanceScore itself gets redefined/derived from hoursWorked for everyone (higher blast radius — touches every existing attendanceScore reader: app.js:2847-2849, 4645, 4727, 4943, modules.js:677, 1140, 1178). Tradeoff is migration risk (b) vs. two-systems-forever complexity (a).
- [ ] Do production/hourly workers (worker_profiles, no uid) get real accounts to punch in/out through the SAME attendance/{uid}/records collection — which requires worker auth to exist first (workstream 27's currently-orphaned 'worker login unblock' + Create-Worker-Account screen) — or does workstream 26 need its own workerId-keyed attendance path (e.g. attendance_worker/{workerProfileId}/records/{date}) that does NOT require Firebase Auth, written by an HR-operated kiosk/tablet instead? This is the single highest-leverage architectural fork in this workstream: it determines whether 26 can ship independently or is blocked on/coupled to 27.
- [ ] Does the new time-out/hours data feed the Worker Payslip's existing manual weekly time-log (departments.js ps-tin-{i}/ps-tout-{i}, computeDayHours() at departments.js:4152-4163) by auto-populating those 7 day-rows from real attendance records — replacing manual entry — or does it stay a fully separate, additive data source (attendance v2 for KPI/compliance visibility; the payslip's manual weekly log remains HR's pay-computation input, unchanged)? If auto-populating: what happens when actual attendance is missing/incomplete for a day in the week (device offline, kiosk down) — does HR still get to override, and how is that override reconciled back into the 'source of truth' the ledger expects (ledger is finance's single source of truth per repo conventions)?
- [ ] What exact structure should the holidays-admin document take: one doc per year (settings/holidays_{year}) fully overriding getPHHolidays(year)'s output for that year, or a sparse per-holiday override merged on top of the hardcoded table (so the formulaic entries like fixed-date regular holidays and National-Heroes-Day-by-formula keep working untouched and admins only need to add/edit the movable ones — Holy Week, Chinese New Year, Eid'l Fitr, Eid'l Adha — for years beyond 2028, or override a specific date for a given year when Malacañang proclaims something non-standard)? Tradeoff: full-year-override is simpler to reason about but requires HR to re-enter ALL ~20 holidays every year even though most never change; sparse-merge is more surgical but is more code complexity in getPHHolidays' merge logic.
- [ ] Who can write the holidays-admin doc? settings/{docId} is currently president-only-write (firestore.rules:260) — does 'holidays admin screen' need to loosen this to isAdmin() (president+manager) or even isFinanceOrAdmin() so HR/finance staff (who are closest to the yearly DOLE/Malacañang proclamation) can maintain it without going through the president every year, and if so is that a targeted new rules match (e.g. a dedicated settings_holidays/{year} collection with its own write rule) rather than loosening the shared settings/{docId} match (which also gates employeeOfMonth and sales_sop — loosening it for holidays would loosen it for those too, an unintended coupling)?
- [ ] How should the extension-upgrade fix be implemented: (a) make tryUpgradeAttendanceOnNotifRead (app.js:3170-3189) query attendance_extensions/{uid}_{todayStr} and use extApproved+expiresAt exactly like the dashboard render already does (app.js:2856-2858), i.e. duplicate that same-shaped check into the upgrade path, or (b) extract a single shared isWithinAttendanceWindow(uid) / getEffectiveDeadline(uid) helper used by BOTH the dashboard render (canTimeIn/extApproved) and the upgrade function, eliminating the duplication that let them drift apart in the first place? (b) also naturally addresses the separate duplication already found between the two independent extension-approval UI surfaces (modules.js:1050-1069 vs departments.js:9922-9940), which both hand-roll the same +6h expiresAt math — should those be unified into one shared approve/deny function too (mirroring the ONE CashAdvance-service consolidation called out for workstream 22), and if so where does that shared function live (a new js/attendance.js module, or inside existing app.js/modules.js)?
- [ ] Should the 6-hour extension window itself become configurable (e.g. stored per-request or as a settings value) now that a holidays/admin-settings pattern is being introduced for this workstream anyway, or is that scope creep the plan didn't ask for (plan text says only 'extension-upgrade bug fixed', not 'extension duration configurable')?

## Risks / cross-workstream interactions

- ⚠️ Direct interaction with workstream 21/24 (statutory tables, payslip): any change to attendanceScore's meaning or to countWorkDays' denominator (which getPHHolidays feeds) changes numbers that flow into monthly payroll compute and the payslip — must land in careful sequence with, not silently ahead of, the payroll-engine rework (workstream 20) so Compute's per-employee snapshot freeze doesn't capture a half-migrated attendance model.
- ⚠️ Direct interaction with workstream 27 (IDs/worker accounts): as detailed in openDecisions, feeding real attendance into weekly production pay may be blocked on or tightly coupled to worker_profiles gaining a uid/login — sequencing risk if 26 is built before 27 lands (may need a placeholder workerId-keyed path that later needs migrating once real worker auth exists, i.e. two migrations instead of one).
- ⚠️ Direct interaction with workstream 25 (Leave that works): the plan says approved leave should write attendance records so it doesn't cut pay — that write path will need to conform to whatever new time-out/hoursWorked shape 26 introduces (e.g. does a leave day get a synthetic hoursWorked=8, or is it exempted from the hours model entirely the way isNoWorkDay/holiday already is, per app.js:2838-2842)?
- ⚠️ Two independent, hand-duplicated approval UIs for attendance_extensions (modules.js:1050-1069 and departments.js:9922-9940) already risk drifting (they already differ slightly: modules.js's toast text names the exact expiry time in Manila locale with explicit timeZone, departments.js's does not) — any workstream-26 change to the extension model touches BOTH call sites and both must be updated in lockstep or the drift gets worse, not better.
- ⚠️ getPHHolidays is called with a defensive `typeof getPHHolidays === 'function'` guard at every call site in app.js (2839, 4629) specifically because of the fixed cross-file script load order (modules.js loads AFTER app.js). A holidays-admin rework that turns getPHHolidays into an async Firestore-backed lookup (to merge in a settings/holidays_{year} override) breaks this call pattern non-trivially: today's callers (countWorkDays, the dashboard holiday check) are synchronous and used inline in render functions; making the source async (a Firestore read) will require either an app-boot-time prefetch/cache of the holidays doc, or converting several synchronous render call chains to async — broad ripple, not a local change.
- ⚠️ Migration hazard: existing attendance/{uid}/records docs (potentially years of history, per the repo's "records kept forever" mandate) have NO loginTime for admin-marked-absent days (deliberately deleted, modules.js:1223) and a fabricated loginTime (just "now", not a real punch) for admin-marked present/half days. If a new hoursWorked/timeOut feature ever tries to backfill or compute historical hours from loginTime for these records, it will produce nonsense for every admin-edited historical day — any backfill logic must explicitly special-case or skip admin-originated records (distinguishable via the editedBy field).
- ⚠️ Production/hourly pay via worker_profiles currently has NO idempotency/ledger-ref discipline visible in the reviewed code (unlike the SO-/EXP-/CRJ-/CDJ-/POCOS-/PAY- deterministic-ref pattern that governs the ledger elsewhere in the repo per CLAUDE.md) — wiring real attendance-derived hours into weekly worker pay must not bypass whatever ledger entry point regular payroll uses, or it recreates the exact 'second payroll path' problem workstream 20 (One payroll engine) is explicitly trying to kill (departments.js:2145-2148 comment already flags one such single-source fix: excluding production staff from the monthly run to avoid double payment — a new attendance-driven weekly-pay path must not reopen that door).
- ⚠️ Timezone/DST-adjacent edge case: 6-hour extension windows are computed with plain `new Date()` + setHours/getTime arithmetic (modules.js:1053-1054, departments.js:9925), NOT through the bizDate/bizHour Manila-anchored helpers — this works today only because the constant 6-hour duration is timezone-agnostic (elapsed milliseconds, not wall-clock hours), but any workstream-26 rework that introduces a wall-clock cutoff (e.g. "extension always expires at end of business day" rather than +6h) MUST route through bizHour()/bizDate(), not raw Date, per the config.js:10-16 warning.

## Files likely touched

`js/app.js — renderEmployeeDashboard (attendance card render, ~2813-3103), check-in-btn handler (~3111-3133), tryUpgradeAttendanceOnNotifRead (~3170-3189), countWorkDays (~4628-4636), getAttendanceScore and other attendanceScore readers (~4645, 4727, 4943, 4976)`, `js/modules.js — getPHHolidays (~892-961), renderAttendancePage + renderAttMonth + admin edit modal (~967-1235), extension approve/deny widget (~1020-1088)`, `js/departments.js — Approvals hub 'attendance' sub-tab approve/deny (~9880-9950), Worker Payslip builder incl. computeDayHours/collectPayslipData/timeLog (~4019-4237), production-staff payClass filtering in payroll run (~2130-2172), employee edit payClass selector (~2480-2545), worker_profiles CRUD (~3585-3790)`, `js/notifications.js — call site of tryUpgradeAttendanceOnNotifRead (~179-181)`, `js/config.js — dbCachedGet cache-key additions if a holidays doc gets a cached read; possibly a new getPHHolidaysAsync or settings-merge helper`, `firestore.rules — attendance/{uid} (153-156), attendance_extensions/{docId} (159-167), settings/{docId} (258-261) or a new dedicated holidays collection match, worker_profiles/{docId} (675-679) if worker attendance write access changes`, `sw.js — CACHE_VER bump (per CLAUDE.md workflow rule, on any js/css edit)`, `Possibly index.html — only if a new script file (e.g. a dedicated attendance.js module) is introduced, per the load-order rule`, `New printable/admin UI files are unlikely required by this workstream alone (no printable listed for attendance in the Per-department-printables table), but a Holidays Admin screen likely needs a new render function wired into navigateTo's switch (app.js) and a nav entry (js/config.js nav arrays)`

## Expected deliverable format

> Fable's output for this workstream should be directly executable by a cheaper model with no further judgment calls. Concretely:
> 
> 1. A short ARCHITECTURE DECISION section resolving each of the 8 openDecisions above with one sentence of rationale each (not re-litigating, just picking).
> 2. Exact Firestore data-shape spec: the final field list for attendance/{uid}/records/{date} (existing fields kept as-is unless explicitly changed, new fields named and typed), the final shape of any new holidays-settings doc, and — if chosen — the shape of any new worker-attendance path.
> 3. Exact function-level diffs, each as a labeled BEFORE/AFTER code block anchored to the file:line citations in this brief (e.g. \"app.js:3170-3189, tryUpgradeAttendanceOnNotifRead — BEFORE / AFTER\"), so Sonnet can locate and replace mechanically without re-deriving logic. Include the two extension-approval call sites (modules.js:1050-1069, departments.js:9922-9940) explicitly if they're being unified.
> 4. The exact firestore.rules diff (new match blocks or edits to existing ones), as unified-diff-style before/after text, plus an explicit note on whether `firebase deploy --only firestore:rules` needs to run separately (per repo convention it always does).
> 5. A numbered migration/build checklist in dependency order (e.g. 1. add field X to write path Y, 2. backfill/guard for existing docs missing the field, 3. update read site Z, 4. update rules, 5. deploy rules, 6. bump CACHE_VER, ...), explicit about which steps are safe to ship independently vs. which require workstream 27 (worker login) to land first.
> 6. Explicit call-outs of every OTHER existing read site that touches attendanceScore/getPHHolidays/attendance_extensions (the full list already enumerated in this brief's currentState/risks) with a one-line note per site: \"unchanged\" or \"must also update because ___\" — so nothing gets missed silently.
> 7. Sample/edge-case data: what a record looks like for (a) a normal full day with time-out, (b) an admin-marked absent day (historical, no loginTime), (c) a holiday/Sunday (isNoWorkDay), (d) an approved-extension day where time-in happens after 9AM — so Sonnet can write defensive code against all four shapes, not just the happy path.
