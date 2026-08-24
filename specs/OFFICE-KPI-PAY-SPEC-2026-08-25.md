# OFFICE-KPI-PAY-SPEC-2026-08-25

**₱10,000 protected base + KPI-dependent incentive for the Office Team, and the
retirement of the office attendance system.** Written for an implementer who has
NOT seen the conversation that produced it. Read `specs/TASK-BASED-PAY-SPEC-2026-08-12.md`
first — this spec supersedes one of its rulings and reuses its machinery; where the
two disagree, THIS file wins.

---

## 0. The owner's rulings (2026-08-25)

Verbatim:

> "i believe we were on track to get rid of the attendance system in the office
> department"
> "instead it would be a 10k base and the remaining is kpi dependent"
> "its more dole based now"

Three follow-up decisions, put to him explicitly and answered the same day:

1. **Scope of removal: "Remove it entirely."** No office check-in at all. Pay is
   base + KPI, so presence has no pay meaning. Leave becomes record-keeping only
   (balances still tracked).
2. **The incentive multiplier: "KPI as computed today."** 70% task completion +
   30% deliverables score, month-scoped — `window.computeKpiForMonth` unchanged.
   Nothing new is invented.
3. **Employee of the Month: "Rescore on KPI only."** One score drives both pay
   and recognition.

### What this supersedes

**TASK-BASED-PAY-SPEC §0 Ruling 1 (2026-08-12) is superseded on the factor.**
That ruling kept attendance at 30% weight inside `perfFactor`. The owner's
2026-08-25 ruling removes attendance from office pay entirely. Do NOT restore
the attendance term. Everything else in that spec (the Office/Operations
boundary, "no separate absence deduction", the wage floor, the settings
precedence chain) still stands and is reused here.

**Ruling 2 of that spec is UNTOUCHED and load-bearing:** Operations Team pay is
attendance-only via geo-tracked timing in. This spec retires OFFICE attendance
(`attendance/{uid}/records`) only. `attendance_worker/**`, the geofenced punch
flow, `recordAttendancePunch`, and the weekly engine are not modified by a
single byte.

### The DOLE framing, stated neutrally

The owner's words: "its more dole based now." The design does move in the
wage-protection direction — a fixed base that is never docked and never scaled,
with only the excess at risk — and statutory contributions stay bracketed on
the full nominal package (never scaled by KPI), so a low month can never
under-remit. Two items remain for the accountant and are NOT resolved by this
spec: (a) whether ₱10,000 guaranteed sits at or above the applicable regional
minimum wage — `settings/payrollWageFloor` exists for exactly this and its
number is the owner's/accountant's to enter, NEVER guessed; (b) whether office
staff are properly classified for output-dependent pay. This spec asserts
nothing about Philippine law in either direction.

---

## 1. The pay model

For an Office (monthly) person whose package is `P` (their current
`payroll/{uid}.salary + allowance` total):

```
base       = 10,000            (protected — paid in full, never scaled)
incentive  = P − 10,000        (at risk)
kpiFactor  = clamp01(kpiScore) (computeKpiForMonth, unchanged: tasks .7 / deliverables .3)

netBeforeCA = round2( base − statutoryTotal − otherDeductions + incentive × kpiFactor )
finalPay    = netBeforeCA − cash-advance instalments
```

- Attendance appears NOWHERE. `attScore` is not read by this branch.
- `sss/philhealth/pagibig/tax` on the line stay the full table (or hand-set)
  amounts, bracketed on nominal `gross = base + incentive` — remittance-safe,
  identical reasoning to TASK-BASED-PAY-SPEC §2.2.
- Base at or below the package → incentive 0, never negative (the split tool
  already clamps this way).
- The base/incentive storage is the SHIPPED office-split shape: base lands in
  `payroll/{uid}.salary`, incentive in `.allowance`, provenance in
  `.officeSplit` (`js/screens/statutory-rates.js` `renderOfficeSplitSection`,
  `OFFICE_SPLIT_DEFAULT_BASE = 10000` — already the owner's number,
  2026-08-14). No new storage.

### 1.1 The fourth permitted edit to js/money-core.js — policy `'basekpi'`

`computePayLine`'s `netBeforeCA` branch gains ONE additive arm (the file's
comments document three prior permitted edits; this is the fourth, same
protocol — additive, pinned, everything else byte-identical):

```
const kpiFactor = clamp01(Number(ctx.kpiScore) || 0);   // attScore NOT read here

if ((policy === 'basekpi' || policy === 'taskbased') && emp.payClass === 'production') {
  throw ...same wording as the existing taskbased guard...
}

const netBeforeCA = policy === 'basekpi'
  ? _round2(base - statutoryTotal - otherDeductions + allowance * kpiFactor)
  : /* existing three-way branch, byte-identical */ ;
```

Conditional keys on the return object, present ONLY under `'basekpi'` (the
pinned tests deepEqual the full object for the other policies — same trap
TASK-BASED-PAY-SPEC §2.4 documents):

```
...(policy === 'basekpi' ? {
  kpiFactor,
  incentiveFull:   allowance,
  incentiveEarned: _round2(allowance * kpiFactor),
} : {}),
```

`perfFactor` (the frozen 0.7/0.3 blend) keeps being computed and stored — it is
shared with pinned policies and must not change — but under `'basekpi'` every
user-visible factor/traceability string reads `kpiFactor`, never `perfFactor`.

### 1.2 Whitelist and precedence

- `window.PAY_POLICY_VALUES` (js/pay-policy.js) becomes
  `['flat','taskbased','performance','basekpi']` — ADDITIVE. Never remove a
  value: the settings boundary throws on unknown strings
  (js/departments.js `buildPayRunLines`), and a stored legacy value must not
  take the pay screen down.
- The §6 precedence chain of TASK-BASED-PAY-SPEC is unchanged; `'basekpi'`
  arrives via `settings/payrollOfficePolicy.policy` exactly as `'taskbased'`
  was designed to.
- The Gov Rates screen's pay-model section: the picker offers **Flat** and
  **Base + KPI incentive** going forward; the task-based option is labelled
  superseded (2026-08-25) and not offered for new activation. President-only
  writes, unchanged.
- `window.payBasisSentence` (js/pay-policy.js) gains the `'basekpi'` wording:
  "₱10,000 base paid in full; the remaining ₱X is multiplied by this month's
  KPI score (tasks 70%, deliverables 30%). Attendance does not affect pay."
- `wageFloorCheck` keeps running at disburse, unchanged. The split screen's
  per-person base-below-floor flag stays.

### 1.3 What activation can never do

Identical to TASK-BASED-PAY-SPEC §6.3: flipping the policy changes no stored
document, re-freezes nothing already checked or paid, and a frozen line always
shows the policy it was frozen under. Old months recompute under their own
stored `payPolicy`.

---

## 2. Retiring the office attendance system

**Data ruling: historic `attendance/{uid}/records` are PRESERVED** — never
deleted, still exported by the auto-discovering backup, still readable under
the existing rules. Retirement removes writers, reminders, and score
consumption — not history. `firestore.rules` needs no change for this spec
(tightening the attendance write rules to read-only is a later, optional
hardening — flag F4).

Removal sites (all Office-side; verified against master 2026-08-24, anchor by
FUNCTION NAME, not line number — this repo moves):

| # | What goes | Where |
|---|---|---|
| R1 | Daily check-in / time-out card | js/screens/dashboards.js `bindAttendanceCard` (~1157), time-out (~1186), the 7–9am window gate (~1002), `attendanceCardState` |
| R2 | Notification-read score upgrade | js/app.js `tryUpgradeAttendanceOnNotifRead` (~2867) + its call sites |
| R3 | Attendance extension requests | creation dashboards.js ~1203; approve/deny app.js ~2902/2919 + hr.js ~3234/3246; the Approvals-queue rows (js/screens/approvals.js); `ATT_EXT_HOURS`/`attExtActive` (js/config.js ~182–184) |
| R4 | Office attendance reminder | functions/index.js `scheduledAttendanceReminder` (~843) — remove the OFFICE half only; any worker-side reminders stay. Needs a manual `firebase deploy --only functions` |
| R5 | Admin Present/Half/Absent editing + office attendance calendar UI | js/screens/people.js `renderAttendance` calendar (~1507) and the edit handlers (~1638–1665). Replace with a READ-ONLY historic viewer labelled "Historic — office attendance retired 2026-08-25" (HR may still need to look up the past; zero write paths). |
| R6 | Leave writing attendance records | js/screens/people.js `writeLeaveAttendance` (~2521): leave approval now ONLY decrements the balance and flips status (`applyLeaveApproval` keeps its idempotency guard). Leave types, balances, requests, approvals otherwise unchanged. |
| R7 | EOM attendance component | js/modules.js `computeEomStandings` / `renderEomBanner`: from the activation month forward, standings = KPI only (same `computeKpiForMonth`); past months keep their recorded scoring. Citation copy updated. |
| R8 | Score consumption in pay | js/departments.js `buildPayRunLines`: under `'basekpi'`, skip the `getAttendanceScore` call (pass `attScore: 0`; it is unread by the branch). KEEP `getAttendanceScore` itself — historic recomputes of pre-retirement months under old policies still need it, reading preserved records. |
| R9 | Manager-dashboard presence tiles fed by office attendance | js/screens/dashboards.js `renderManagerDashboard` team-attendance card — remove or repoint to task activity; do not leave a tile reading a collection nobody writes. |

Explicitly NOT touched: `attendance_worker/**`, js/screens/worker.js,
js/geo-core.js, `recordAttendancePunch`, `WeeklyRun`, `computeWeeklyLine`,
anything Operations.

---

## 3. Consequences to state on screen (plain words, owner-approved model)

- Personal Finance / payslip explanation under `'basekpi'` uses
  `payBasisSentence` §1.2 — and for months frozen under old policies keeps
  showing THEIR stored factor fields. A payslip may legitimately show
  `perfFactor` (old month) or `kpiFactor` (new month); the model builder
  (`toPayslipModel`) picks by the line's stored `policy`.
- The unified payroll screen's per-person "where the number came from" ledger
  gains the two rows: "Incentive (full)" and "Incentive earned at KPI x%".
- An office person on unpaid leave still receives the full base — this is the
  standing "no separate absence deduction" ruling (2026-08-12) carried
  forward, now with attendance gone entirely. Stated on the leave screen in
  one sentence so nobody discovers it by surprise.

---

## 4. Tests (a money change without a test is not done)

New file `tests/basekpi-pay.test.mjs` (NEVER edit the existing pinned files;
all 330+ existing tests must pass unmodified):

- T1 the formula at KPI 0 / 0.5 / 0.85 / 1.0 (base always whole, statutory
  never scaled, incentive rounds per `_round2`).
- T2 conditional keys present under `'basekpi'`, ABSENT under the other three
  (deepEqual guard).
- T3 the production guard throws for `payClass === 'production'`.
- T4 attScore is ignored: two calls differing only in `ctx.attScore` return
  identical objects under `'basekpi'`.
- T5 package ≤ base → incentive 0, never negative.
- T6 unknown policy string still falls through to `'flat'` (pinned tolerance
  unchanged); `'basekpi'` accepted at the settings boundary.
- T7 EOM: `computeEomStandings` scores KPI-only from the activation month,
  legacy months untouched.
- T8 float pin: pick one real package (e.g. 18,000 → incentive 8,000, KPI
  0.85 → incentiveEarned 6,800.00) and pin the exact rounded output.

---

## 5. Rollout order (each step shippable alone)

1. **Build everything switched off** (house rule): money-core branch + policy
   plumbing + screen copy + tests. `settings/payrollOfficePolicy` still says
   `'flat'` — nothing changes for anyone.
2. **Ship the attendance retirement** (R1–R9). Safe independently of the
   policy flip: under `'flat'`, attendance already has zero pay effect — its
   only live meanings today are EOM and the dashboard tiles, both handled.
   R4 needs the manual functions deploy.
3. **President applies the split** on the shipped office-split tool (base
   ₱10,000 — the prefilled default) — this rewrites `payroll/{uid}` with the
   audit provenance the tool already stamps. NOTE (payroll review G13): route
   the split through RaiseFlow or log a `salary_raises` entry per person so
   the raise history stays complete — fix that gap as part of this step, not
   after.
4. **President flips the policy** to Base + KPI on Gov Rates.
5. Office disbursement remains gated on the 2026 statutory sign-off
   (unchanged, separate task) and on `payrollWageFloor` once the accountant
   supplies the number.

---

## 6. Flag to the owner — do NOT guess these

- **F1 (minimum wage):** if the confirmed regional floor exceeds ₱10,000, a
  zero-KPI month pays below it. The floor number and the response (raise the
  base? top-up rule?) are the accountant conversation of §0 — the app blocks
  at disburse when the floor is set and breached, and until a floor is stored
  the screen says "no floor on file" rather than implying safety.
- **F2 (unpaid leave):** with attendance gone, extended unpaid leave still
  pays the full base (§3). If the owner ever wants an explicit unpaid-leave
  deduction, that is a NEW ruling and an explicit deduction line — never an
  attendance revival.
- **F3 (proration):** joiners/leavers mid-month still receive the full base
  (payroll review G10, standing KNOWN GAP). Unchanged by this spec; needs its
  own ruling.
- **F4 (rules hardening):** office `attendance` writes could be tightened to
  read-only in firestore.rules once retirement has soaked. Optional, separate
  deploy.
