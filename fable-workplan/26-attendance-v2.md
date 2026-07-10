# Workstream 26 — Attendance v2 (time-out + hours, holidays admin, extension-upgrade fix)

> ✅ **IMPLEMENTED 2026-07-10.** Rules deploy required (new `attendance_worker` +
> `settings_holidays` blocks). See V12-PLAN.md Build Log. The headline extension-upgrade bug
> fix, kiosk clock-in, payslip auto-fill, and Holidays Admin screen are NOT live-tested — need
> a real login. Geofence deliberately not built (greenfield/deferred, decision 1).

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

## DECIDED — architecture spec (Fable, 2026-07-10)

### Resolved decisions

1. **Time-out capture = two populations, two write paths, one shared hours helper.** Office/`users`-keyed employees get a self-service **"Time Out"** button on their dashboard that adds `logoutTime`+`hoursWorked` to the SAME `attendance/{uid}/records/{date}` doc. Factory `worker_profiles` staff (no Auth) are clocked by an **HR-operated kiosk/tablet** writing a NEW `attendance_worker/{workerProfileId}/records/{date}` collection. Both derive hours through one pure helper (`computeHoursBetween` / `computeDayHours`). Geofence stays greenfield/deferred (not built here). Rationale: office staff already carry the app; factory staff have no login yet — forcing one path would block WS26 on WS27.

2. **`hoursWorked` is a NEW parallel field; `attendanceScore` stays canonical & untouched (Option a).** `attendanceScore` (0/0.5/1.0) continues to gate ALL monthly-employee KPI/pay math with zero change. `hoursWorked` is informational for office employees and is the pay input ONLY for the weekly production path. Rationale: minimal blast radius, satisfies WS19's score∈{0,0.5,1.0} cap, and WS20's monthly `getAttendanceScore` source is explicitly unchanged.

3. **Production workers punch into their OWN `attendance_worker/{workerProfileId}` path — NOT `attendance/{uid}` — so WS26 ships independently of WS27.** Keyed by the `worker_profiles` doc id (which the payslip generator already holds as `profile.id`), HR-kiosk-written (an authenticated finance/admin session), no Firebase Auth required. Rationale: this is the highest-leverage fork; decoupling from WS27 lets 26 land now, and keying by `workerProfileId` means the payslip's manual time-log can auto-fill from the same key. When WS27/WS20's `worker_profiles.linkedUid` lands, an owner-read clause can be added without re-keying.

4. **Time-out data AUTO-POPULATES the Worker Payslip's 7-day time-log, but the rows stay editable (HR override), and the ledger path is unchanged.** A "⟳ Load from kiosk" button in the payslip generator reads `attendance_worker/{profile.id}/records` across the chosen pay period and prefills `ps-tin-{i}`/`ps-tout-{i}`, then calls the existing `recomputeHours()`. Missing days stay at the current defaults for HR to fill. Rationale: keeps HR as the source-of-truth for the pay number (which still posts to the ledger via `WPAY-{payslipId}` on Submit, unchanged), so WS20's "one weekly engine" is not reopened.

5. **Holidays admin = SPARSE per-holiday override merged on top of the formulaic table.** `settings_holidays/{year}` carries an `overrides` map keyed by date (`{name,type}` to add/edit, `null` to remove). `getPHHolidays(year)` builds its existing base table UNCHANGED, then merges the override map. Rationale: the fixed-date and National-Heroes-Day-by-formula entries keep working with zero re-entry; admins touch only movable observances (Holy Week / Chinese NY / Eid) for 2029+ or a Malacañang re-proclamation.

6. **`getPHHolidays` STAYS SYNCHRONOUS; overrides come from a boot-time in-memory prefetch.** New `window.loadHolidayOverrides([years])` fills `window._holidayOverrides` once after login; `getPHHolidays` reads that synchronous cache. Rationale: making the source async would ripple through `countWorkDays` and every inline render caller — the prefetch preserves the sync signature and the existing `typeof getPHHolidays==='function'` guards, so if overrides haven't loaded the base table is returned safely.

7. **Holidays doc lives in a DEDICATED `settings_holidays/{year}` collection, write = `isFinanceOrAdmin()`.** NOT the shared `settings/{docId}` match (which is president-only-write and also gates `employeeOfMonth`/`sales_sop` — loosening it would loosen those too). Rationale: HR/finance/manager/secretary are closest to the DOLE/Malacañang proclamations; a dedicated collection scopes the looser write without coupling.

8. **Extension-upgrade fix = extract ONE shared deadline helper + ONE shared approve/deny function (Option b), unifying all three drifting sites.** `tryUpgradeAttendanceOnNotifRead` now reads the extension doc and honors the extended deadline via `window.attExtActive()`. The two hand-duplicated approval UIs (modules.js:1050-1069, departments.js:9922-9954) both call new `window.approveAttendanceExtension()`/`denyAttendanceExtension()`. The 6-hour window is centralized as `window.ATT_EXT_HOURS = 6` (NOT admin-configurable — that is out-of-scope creep; per-request `expiresAt` already stored). No new js file — pure helpers go in config.js, write helpers in app.js. Rationale: the bug was born from duplication; centralizing kills all three copies at once.

---

### Spec 1 — Data shapes (annotated literals)

```js
// attendance/{uid}/records/{date}  — office employees (EXISTING doc, 2 new fields)
{ date:'2026-07-10', uid, loginTime:Timestamp,
  attendanceScore:0|0.5|1.0,          // CANONICAL — unchanged, still gates monthly pay
  fullTime:bool, autoFull:bool, fullTimeAt?:Timestamp,
  status?:'present'|'half'|'absent', note?, editedBy?, editedAt?,   // admin path, unchanged
  logoutTime?:Timestamp,              // NEW — set by self-service Time Out button
  hoursWorked?:number }              // NEW — informational for office; NOT a pay input

// attendance_worker/{workerProfileId}/records/{date}  — NEW collection, HR-kiosk-written
{ workerId:'<worker_profiles doc id>', date:'2026-07-10',
  timeIn:'07:00', timeOut:'16:00',    // HH:MM strings
  hoursWorked:8.0,                     // computeDayHours(timeIn,timeOut)
  recordedBy:uid, recordedByName, recordedAt:Timestamp }

// settings_holidays/{year}  — NEW collection, sparse override doc
{ year:2029,
  overrides:{
    '2029-04-02':{ name:'Maundy Thursday', type:'special' },  // add/edit a holiday
    '2029-04-03':{ name:'Good Friday',     type:'regular' },
    '2029-02-25': null                                        // REMOVE a base holiday that year
  },
  updatedBy:uid, updatedByName, updatedAt:Timestamp }
```

### Spec 2 — Shared helpers to ADD in js/config.js (insert after bizYear(), ~line 37)

```js
// ── Attendance extension window (single source of truth) ──────────
window.ATT_EXT_HOURS = 6;   // approved extension duration, in hours
// Is an approved extension still active? Returns {active, expiresAt:Date|null}.
window.attExtActive = function(extData, now) {
  now = now || new Date();
  const expiresAt = (extData && extData.expiresAt && extData.expiresAt.toDate)
                      ? extData.expiresAt.toDate() : null;
  const active = !!(extData && extData.status === 'approved' && expiresAt && now < expiresAt);
  return { active, expiresAt };
};
// Elapsed worked hours between two Date objects, minus a flat 1-hr lunch if the
// span crosses local noon. Best-effort (informational field) — Manila-anchored.
window.computeHoursBetween = function(inDate, outDate) {
  if (!inDate || !outDate) return 0;
  let mins = (outDate.getTime() - inDate.getTime()) / 60000;
  if (mins <= 0) return 0;
  const inH = window.bizHour(inDate), outH = window.bizHour(outDate);
  if (inH < 13 && outH >= 12) mins -= 60;   // crossed the 12–1PM lunch window
  return Math.max(0, mins / 60);
};

// ── Holiday admin overrides (sync in-memory cache, filled at boot) ─
window._holidayOverrides = window._holidayOverrides || {};   // { [year]: overridesMap }
```

### Spec 3 — Extension bug fix + unified approve/deny

**3a. js/app.js:3170-3189 `tryUpgradeAttendanceOnNotifRead` — BEFORE → AFTER**
```js
// BEFORE (only checks flat 9AM — ignores approved extensions = THE BUG)
window.tryUpgradeAttendanceOnNotifRead = async function() {
  if (!currentUser) return;
  const todayStr = bizDate();
  if (bizHour() >= 9) {
    Notifs.showToast('⏰ Deadline passed — notifications must be checked before 9:00 AM for full attendance.', 'error');
    return;
  }
  const todaySnap = await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).get();
  if (!todaySnap.exists || !todaySnap.data().loginTime) return;
  const current = todaySnap.data();
  if ((current.attendanceScore||0) >= 1.0) return;
  await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).set({
    attendanceScore: 1.0, fullTime: true,
    fullTimeAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  Notifs.showToast('✅ Full attendance (100%) — all notifications checked!');
};
```
```js
// AFTER (honors an approved extension's expiresAt exactly like the dashboard render does)
window.tryUpgradeAttendanceOnNotifRead = async function() {
  if (!currentUser) return;
  const todayStr = bizDate();
  const now = new Date();
  // Honor an approved extension: its expiresAt replaces the flat 9:00 AM cutoff.
  const extSnap = await db.collection('attendance_extensions')
    .doc(`${currentUser.uid}_${todayStr}`).get().catch(()=>({exists:false,data:()=>({})}));
  const ext = window.attExtActive(extSnap.exists ? extSnap.data() : null, now);
  const pastDeadline = ext.active ? (now >= ext.expiresAt) : (bizHour() >= 9);
  if (pastDeadline) {
    const dl = ext.active
      ? ext.expiresAt.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit',timeZone:window.BIZ_TZ})
      : '9:00 AM';
    Notifs.showToast(`⏰ Deadline passed — notifications must be checked before ${dl} for full attendance.`, 'error');
    return;
  }
  const todaySnap = await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).get();
  if (!todaySnap.exists || !todaySnap.data().loginTime) return; // must have timed in first
  const current = todaySnap.data();
  if ((current.attendanceScore||0) >= 1.0) return;              // already full
  if (current.editedBy) return;                                // admin-set day — never self-override (also WS19-denied)
  try {
    await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).set({
      attendanceScore: 1.0, fullTime: true,
      fullTimeAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    Notifs.showToast('✅ Full attendance (100%) — all notifications checked!');
  } catch(e) { /* WS19 rule denied (admin-edited day) — silently ignore */ }
};
```

**3b. NEW shared approve/deny — insert in js/app.js immediately after `tryUpgradeAttendanceOnNotifRead` (~line 3189):**
```js
window.approveAttendanceExtension = async function(extId, uid, name) {
  const approvedAt = new Date();
  const expiresAt  = new Date(approvedAt.getTime() + window.ATT_EXT_HOURS * 60 * 60 * 1000);
  await db.collection('attendance_extensions').doc(extId).update({
    status: 'approved',
    approvedBy: currentUser.uid,
    approvedByName: userProfile?.displayName || currentUser.email,
    approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
    expiresAt: firebase.firestore.Timestamp.fromDate(expiresAt)
  });
  const dl = expiresAt.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit',timeZone:window.BIZ_TZ});
  await Notifs.send(uid, {
    title: '✅ Attendance Extension Approved',
    body:  `Your Time In extension is approved. You have until ${dl} to time in and check all notifications.`,
    icon: '✅', type: 'att_extension_approved'
  });
  if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('att-ext-pending');
  return expiresAt;
};
window.denyAttendanceExtension = async function(extId, uid, name) {
  await db.collection('attendance_extensions').doc(extId).update({
    status: 'denied', deniedBy: currentUser.uid,
    deniedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await Notifs.send(uid, {
    title: '❌ Attendance Extension Denied',
    body:  'Your attendance extension request was not approved.',
    icon: '❌', type: 'att_extension_denied'
  });
  if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('att-ext-pending');
};
```

**3c. js/modules.js:1050-1087 approve/deny handlers — collapse to the shared fns:**
```js
// AFTER
extEl.querySelectorAll('.ext-approve-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Approving…';
    await window.approveAttendanceExtension(btn.dataset.id, btn.dataset.uid, btn.dataset.name);
    Notifs.showToast(`Extension approved for ${btn.dataset.name||'employee'}`);
    loadExtensionRequests();
  });
});
extEl.querySelectorAll('.ext-deny-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!confirm('Deny this extension request?')) return;
    btn.disabled = true;
    await window.denyAttendanceExtension(btn.dataset.id, btn.dataset.uid, btn.dataset.name);
    Notifs.showToast('Extension denied');
    loadExtensionRequests();
  });
});
```

**3d. js/departments.js:9922-9954 approve/deny handlers — same collapse:**
```js
// AFTER
wrap.querySelectorAll('.ext-approve').forEach(btn => {
  btn.addEventListener('click', async e => {
    const { id, uid, name } = e.currentTarget.dataset;
    await window.approveAttendanceExtension(id, uid, name);
    Notifs.showToast(`Extension approved for ${name}`);
    loadApprovalsSub('attendance');
  });
});
wrap.querySelectorAll('.ext-deny').forEach(btn => {
  btn.addEventListener('click', async e => {
    const { id, uid, name } = e.currentTarget.dataset;
    await window.denyAttendanceExtension(id, uid, name);
    Notifs.showToast(`Extension denied for ${name}`);
    loadApprovalsSub('attendance');
  });
});
```

**3e. (Consistency, optional but recommended) js/app.js:2857-2858 dashboard render** — replace the inline `extApproved` computation with the shared helper so render and upgrade can never drift again:
```js
// BEFORE
const extApproved  = extData?.status === 'approved' && extData?.expiresAt && now < extData.expiresAt.toDate();
// AFTER
const _ext = window.attExtActive(extData, now);
const extApproved = _ext.active;
// (extExpiresStr at 2864-2866 → use _ext.expiresAt.toLocaleTimeString(...) when extApproved)
```

### Spec 4 — Office self-service Time Out button (js/app.js, renderEmployeeDashboard)

**4a. Derived flag** — add beside `hasLogin`/`hasFull` (~app.js:2846-2850):
```js
const hasLogout = !!attData.logoutTime;
```
**4b. Button markup** — inside the `hasFull` and `hasLogin` render branches (app.js:2982-3000), append when `hasLogin && !hasLogout`:
```js
${(hasLogin && !hasLogout) ? `<button class="btn-secondary" id="time-out-btn" style="width:100%;margin-top:10px">
  <i data-lucide="log-out" style="width:14px;margin-right:6px"></i>Time Out</button>` : ''}
${hasLogout ? `<div style="font-size:11px;color:var(--text-muted);margin-top:8px">👋 Timed out · ${(attData.hoursWorked||0).toFixed(1)}h logged</div>` : ''}
```
**4c. Handler** — add next to the `check-in-btn` listener (app.js:3111-3133):
```js
document.getElementById('time-out-btn')?.addEventListener('click', async () => {
  const inTs = attData.loginTime?.toDate ? attData.loginTime.toDate() : null;
  const hrs  = inTs ? window.computeHoursBetween(inTs, new Date()) : 0;
  await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).set({
    logoutTime: firebase.firestore.FieldValue.serverTimestamp(),
    hoursWorked: hrs
  }, { merge: true });
  Notifs.showToast(`👋 Timed out — ${hrs.toFixed(1)}h logged.`);
  renderEmployeeDashboard();
});
```
> WS19-compat: this merge does not touch `attendanceScore`, so the merged doc keeps its existing 0.5/1.0 (∈ the WS19 cap set), and `editedBy` is absent on a self-checked-in day — the write passes the WS19 owner rule unchanged. No firestore.rules edit is needed for `attendance/{uid}` (WS19's split block already permits it).

### Spec 5 — Holidays admin

**5a. js/modules.js:892-961 `getPHHolidays` — merge overrides (keep the WHOLE existing base table; add one merge block before `return holidays;` at line 960):**
```js
  // ── Admin overrides (prefetched into _holidayOverrides at boot) ──
  const ov = window._holidayOverrides && window._holidayOverrides[year];
  if (ov) {
    for (const date in ov) {
      if (ov[date] === null) delete holidays[date];   // admin removed a base holiday
      else holidays[date] = ov[date];                 // admin added/edited
    }
  }
  return holidays;
```
**5b. NEW prefetch — insert in js/modules.js right after `getPHHolidays` (~line 961):**
```js
window.loadHolidayOverrides = async function(years) {
  years = years || [window.bizYear()-1, window.bizYear(), window.bizYear()+1];
  await Promise.all(years.map(async y => {
    try {
      const snap = await db.collection('settings_holidays').doc(String(y)).get();
      window._holidayOverrides[y] = (snap.exists && snap.data().overrides) ? snap.data().overrides : {};
    } catch { window._holidayOverrides[y] = {}; }
  }));
};
```
**5c. Boot call** — in js/app.js, in the authenticated-boot path (where `userProfile` is set and the first dashboard renders), add: `if (typeof loadHolidayOverrides==='function') loadHolidayOverrides();` — non-blocking; if it hasn't resolved yet `getPHHolidays` safely returns the base table.

**5d. Admin screen `window.renderHolidaysAdmin()`** — new render fn in modules.js, wired into `navigateTo` (app.js switch) + a nav entry for president/manager/finance. Behavior: year selector; list the merged `getPHHolidays(year)` with a source badge (base vs override); "Add / Edit" and "Remove" write into `settings_holidays/{year}.overrides`; on save call `loadHolidayOverrides([year])`. All name interpolation via `escHtml()`. Save write:
```js
await db.collection('settings_holidays').doc(String(year)).set({
  year,
  overrides: overridesMap,             // date → {name,type} | null
  updatedBy: currentUser.uid,
  updatedByName: userProfile.displayName || currentUser.email,
  updatedAt: firebase.firestore.FieldValue.serverTimestamp()
}, { merge: true });
await loadHolidayOverrides([year]);
```

### Spec 6 — Worker kiosk attendance + payslip auto-fill

**6a. Kiosk write** (HR-operated screen — a simple `renderWorkerKiosk()` or a row action in `renderFinanceHRProfiles`): pick a `worker_profiles` doc, enter/scan `timeIn`/`timeOut`, write:
```js
const hrs = computeDayHours(timeIn, timeOut);   // existing fn, departments.js:4154
await db.collection('attendance_worker').doc(profileId).collection('records').doc(bizDate()).set({
  workerId: profileId, date: bizDate(), timeIn, timeOut, hoursWorked: hrs,
  recordedBy: currentUser.uid, recordedByName: userProfile.displayName || currentUser.email,
  recordedAt: firebase.firestore.FieldValue.serverTimestamp()
}, { merge: true });
```
**6b. Payslip generator auto-fill** — add a "⟳ Load from kiosk" button in `openPayslipGenerator` (departments.js, near the time-log table ~4025) that fills the 7 rows from the pay period:
```js
document.getElementById('ps-load-kiosk-btn')?.addEventListener('click', async () => {
  const start = document.getElementById('ps-start').value, end = document.getElementById('ps-end').value;
  if (!start || !end) { Notifs.showToast('Set pay period dates first','error'); return; }
  const snap = await db.collection('attendance_worker').doc(profile.id).collection('records')
    .where(firebase.firestore.FieldPath.documentId(), '>=', start)
    .where(firebase.firestore.FieldPath.documentId(), '<=', end).get().catch(()=>({docs:[]}));
  const byDow = {}; // Mon..Sun index 0..6
  snap.docs.forEach(d => { const r = d.data(); const dow = window.bizDow(new Date(`${r.date}T12:00:00`)); byDow[(dow+6)%7] = r; });
  for (let i=0;i<7;i++){ const r=byDow[i]; if(!r) continue;
    const tin=document.getElementById(`ps-tin-${i}`), tout=document.getElementById(`ps-tout-${i}`);
    if(tin) tin.value=r.timeIn||''; if(tout) tout.value=r.timeOut||''; }
  recomputeHours();
  Notifs.showToast('Loaded kiosk hours — review & adjust before saving.');
});
```
> The rows remain editable; `collectPayslipData` (departments.js:4165) and the `WPAY-` ledger post on Submit are UNCHANGED. HR override + ledger discipline preserved (satisfies WS20 §D3/§Risk).

### Spec 7 — firestore.rules diffs (block-scoped, before→after)

The existing `attendance/{uid}` block is being reshaped by **WS19** (score cap + editedBy guard). WS26 adds NO further edit there — `logoutTime`/`hoursWorked` writes already satisfy the WS19 owner rule (Spec 4 note). WS26 adds two NEW match blocks:

```
// NEW — worker kiosk attendance (no Auth link yet; HR-written). Insert near the
// existing attendance block (~firestore.rules:156). No owner clause — workers have
// no uid until WS27/linkedUid lands.
match /attendance_worker/{workerId} {
  allow read: if isAuth() && isFinanceOrAdmin();
}
match /attendance_worker/{workerId}/records/{date} {
  allow read, write: if isAuth() && isFinanceOrAdmin();
}

// NEW — holidays admin override docs. Dedicated collection so the looser write
// does NOT touch the president-only settings/{docId} match. Insert near settings (~261).
match /settings_holidays/{year} {
  allow read:  if isAuth();
  allow write: if isAuth() && isFinanceOrAdmin();
}
```
> Deploy: `~/.npm-global/bin/firebase deploy --only firestore:rules` — SEPARATE from `git push` (per repo convention). Re-`git diff` firestore.rules first (concurrent OneDrive/WS19/WS20 sessions edit this file); apply as block-scoped Edits, never a full-file replace. Add `attendance_worker`, `settings_holidays` to `scripts/monthly-backup.js` EXPORTS in the same commit.

### Spec 8 — Migration / rollout checklist (dependency order)

1. **Add config.js helpers** (`ATT_EXT_HOURS`, `attExtActive`, `computeHoursBetween`, `_holidayOverrides`) — Spec 2. Safe standalone.
2. **Ship the extension-upgrade fix + unified approve/deny** (Spec 3a-3e). Fixes the live 9AM hard-block bug independently — ship first if isolating.
3. **Deploy rules** (Spec 7) — the two NEW blocks. Old clients keep working (they don't read the new collections). Ships before any client writes to them.
4. **Add office Time Out** (Spec 4). No backfill: existing docs simply lack `logoutTime`/`hoursWorked` (both optional; readers treat absent as "not timed out" / 0).
5. **Holidays merge + prefetch + admin screen** (Spec 5). No migration — with no `settings_holidays` doc, `getPHHolidays` returns today's exact base table. First real need is 2029; 2026-2028 already correct.
6. **Worker kiosk + payslip auto-fill** (Spec 6). No backfill — auto-fill only affects future payslips; manual entry remains the fallback for any period with no kiosk records.
7. **Bump `CACHE_VER` in sw.js manually** (per CLAUDE.md, CACHE_VER is the separate manual step the auto-bump does not cover). Add any new render file references to PRECACHE only if a new js file is created — NONE is (all edits land in config.js/app.js/modules.js/departments.js).
8. **Manual test** (Spec 10).

**Independence vs WS27:** steps 1-6 all ship WITHOUT WS27. Worker attendance is keyed by `workerProfileId` and written by HR, so no worker login is required. When WS27/WS20 add `worker_profiles.linkedUid`, a later, additive edit can add an owner-read clause to the `attendance_worker/{workerId}/records/{date}` rule (`|| isOwner(get(worker_profiles/{workerId}).linkedUid)`) — no re-keying, no data migration.

### Spec 9 — Every existing site touching attendanceScore / getPHHolidays / attendance_extensions (unchanged vs must-update)

- app.js:2847-2849 `attScore` normalize — **unchanged** (canonical field untouched).
- app.js:2856-2866 dashboard `extApproved`/`extExpiresStr` — **update (recommended)** to `window.attExtActive` (Spec 3e) to prevent future drift.
- app.js:2883-2884 dashboard KPI via `countWorkDays` → `getPHHolidays` — **unchanged** (sync signature preserved; overrides merge transparently).
- app.js:3122-3128 self check-in write — **unchanged** (still writes score 0.5/1.0).
- app.js:3184-3187 notif-upgrade write — **updated** (Spec 3a; now honors extensions + editedBy guard).
- app.js:4628-4637 `countWorkDays` — **unchanged** (calls `getPHHolidays`, still sync).
- app.js:4640-4664 `_attRecScore`/`getAttendanceScore` — **unchanged** (WS20's monthly attScore source; explicitly not touched).
- modules.js:892-961 `getPHHolidays` — **updated** (Spec 5a merge block; base table kept verbatim).
- modules.js:1050-1087 extension approve/deny — **updated** (Spec 3c; collapsed to shared fns).
- modules.js:1121-1152 calendar `_attRecScore`-equivalent status logic — **unchanged** (reads score/fullTime/loginTime as before; `logoutTime`/`hoursWorked` ignored).
- modules.js:1208-1228 admin edit write — **unchanged** (still stamps `editedBy`, writes canonical score).
- departments.js:4152-4163 `computeDayHours` — **unchanged** (reused by kiosk write, Spec 6a).
- departments.js:4165-4237 `collectPayslipData`/`timeLog` — **unchanged** (auto-fill only prefills the same inputs it already reads).
- departments.js:9891-9954 Approvals attendance sub-tab — **updated** (Spec 3d; collapsed to shared fns).
- notifications.js:179-181 upgrade call site — **unchanged** (still calls `window.tryUpgradeAttendanceOnNotifRead`, whose internals changed).
- WS20 `computePayRun` attScore via `getAttendanceScore` — **unchanged**; weekly production pay now optionally sources hours from `attendance_worker` via the payslip auto-fill (Spec 6b).
- WS25 Leave: a leave day should write `attendanceScore` (per WS25) only; `hoursWorked`/`logoutTime` are OMITTED (office hoursWorked is informational; a leave day is exempt from the hours model just as holidays/Sundays are). Consistent with this shape.

### Spec 10 — Sample/edge-case record shapes (write defensive code against all four)

```js
// (a) Normal full office day WITH time-out
{ date:'2026-07-10', uid, loginTime:<07:42>, attendanceScore:1.0, fullTime:true, autoFull:false,
  fullTimeAt:<08:55>, logoutTime:<17:03>, hoursWorked:8.35 }
// (b) Admin-marked ABSENT, historical (NO loginTime — deliberately deleted). NEVER derive
//     hoursWorked from loginTime here; hoursWorked/logoutTime absent.
{ date:'2026-05-14', uid, status:'absent', fullTime:false, attendanceScore:0,
  note:'no call no show', editedBy:<admin uid>, editedAt:<...> }   // loginTime absent
// (c) Holiday / Sunday (isNoWorkDay) — usually NO record at all; readers must treat a
//     missing doc + isNoWorkDay as "no penalty", never as absent.
//     (getPHHolidays(year)[date] present → isNoWorkDay=true; skip hours entirely.)
// (d) Approved-extension day, time-in AFTER 9AM (e.g. 11:07), notifs read at 12:30 while
//     extension expiresAt=15:00 → upgrade SUCCEEDS (Spec 3a), score 0.5→1.0.
{ date:'2026-07-10', uid, loginTime:<11:07>, attendanceScore:1.0, fullTime:true, autoFull:false,
  fullTimeAt:<12:30> }   // and attendance_extensions/{uid}_2026-07-10 = {status:'approved', expiresAt:<15:00>}
// (e) Worker kiosk record (separate collection, no uid)
{ workerId:'wp_ab12', date:'2026-07-10', timeIn:'07:00', timeOut:'16:00', hoursWorked:8.0,
  recordedBy:<HR uid>, recordedByName:'HR', recordedAt:<...> }
```

### Spec 11 — Manual test checklist (no automated suite)

- **Extension bug (the headline fix):** as president approve a 6-hr extension at 08:00; as that employee time in at 11:00 (allowed), open 🔔 and check every notification at 12:00 → attendance upgrades to **100%** (previously blocked with the 9AM error toast). ✓
- **Past extension deadline:** same employee, but read notifications AFTER `expiresAt` → toast names the extended time, no upgrade. ✓
- **Normal 9AM path unchanged:** no extension, read notifs at 08:30 → 100%; at 09:30 → blocked with "before 9:00 AM". ✓
- **Both approval UIs agree:** approve via Attendance page widget and via Approvals hub → identical `expiresAt` (+6h) and identical notification wording. ✓
- **Office Time Out:** after time-in, tap Time Out → `logoutTime`+`hoursWorked` written, badge shows "Timed out · Xh"; `attendanceScore` unchanged (still 100%/50%). ✓ Devtools: a Time Out merge does not trip WS19 (score stays ∈ {0,0.5,1.0}). ✓
- **Holidays admin:** add `2029-04-02 Maundy Thursday` in the admin screen → reload → 2029 calendar shows it and `countWorkDays(2029,...)` drops that day; remove a base holiday via `null` override → it disappears for that year only; 2026-2028 base holidays unaffected with no override doc. ✓
- **Holidays rule scope:** finance/manager can save `settings_holidays/{year}`; `settings/employeeOfMonth` remains president-only-write (unchanged). ✓
- **Worker kiosk → payslip:** HR clocks a worker for a week; in the payslip generator set the period + "⟳ Load from kiosk" → 7 rows prefill, total hours match, rows still editable; Submit posts one `WPAY-` ledger row (no duplicate path). ✓
- **Deploy:** `~/.npm-global/bin/firebase deploy --only firestore:rules` run and confirmed (separate from `git push`). ✓

### Flags for Neil

- **‼️ FLAG FOR NEIL — extension duration stays a constant (6h).** Recommendation: keep `window.ATT_EXT_HOURS = 6`; making it admin-configurable is scope the plan didn't ask for. Say the word if you want a settings-driven value.
- **‼️ FLAG FOR NEIL — holidays admin write access.** Spec uses `isFinanceOrAdmin()` (president/manager/secretary/finance) so HR can maintain the yearly proclamations without routing through you. If you want it president-only, change the `settings_holidays` write rule to `isPresident()`.

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
