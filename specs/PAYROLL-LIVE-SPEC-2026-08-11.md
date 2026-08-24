# PAYROLL LIVE SPEC — 2026-08-11

**A live, in-progress payroll view with Office Team / Operations Team tabs on
the ONE payroll screen.** Implementation spec, written to be built from without
re-deriving anything. Where this document and `PAYROLL-REDESIGN-BRIEF.md`
disagree, THIS document wins on exactly ONE point (team tabs, §1); on every
other point the brief still governs.

Read before starting, in this order:

1. `CLAUDE.md` — repo rules. **NEVER `git stash` / `git reset --hard` /
   `git checkout --` / `git clean`.** Multiple agents edit this tree live.
   Stage explicitly (never `git add -A`), `git diff --cached` before commit.
2. `PAYROLL-REDESIGN-BRIEF.md` — the owner's rulings verbatim.
3. This file, top to bottom.

Files you will touch: `js/payroll.js`, `js/screens/payroll.js`,
`js/payroll-weekly.js`, `js/departments.js`, `js/screens/hr.js`,
`js/screens/finance.js`, `index.html`, `sw.js` (auto — see §12), plus one new
test file. Files you will NOT touch: **`js/money-core.js` (frozen, 257+ pinned
tests, zero edits of any kind)**, `firestore.rules` (no rules change needed —
§4.6), `js/statutory-tables.js`.

---

## 1. The owner's ruling today, and what it supersedes

Verbatim:

> "there should be a realtime current payroll for the payroll period which is
> either weekly or monthly based on all performance of each employee. office
> team and operations team must be segregated not mixed. example: today is aug
> 11, i can go to office team tab and i can see each employees status and
> metrics ie attendance, kpi, etc. i can also see operations team tab, i can
> see each employees, attendance, hrs worked, i can add hrs of travel etc. i
> can add and remove employees who are not part of the payroll period. and
> this can be seen by hr and finance. all data of workers like their base pay,
> etc are in hr, where these records cannot be edited in the payroll tab
> already."

Two follow-up rulings that settle the ambiguities (binding):

1. **Segregation:** "separate but they should be a the same process just
   different computation." → Office Team and Operations Team are SEPARATE TABS
   on the ONE payroll screen (`window.renderPayrollPage`), with
   team-appropriate columns. ONE release pipeline, ONE payslip/ledger/receipt
   path, ONE set of row actions. `payClass` selects the compute strategy and
   the tab — nothing else differs. **This supersedes the brief's / the
   screen's header line "NO team tabs anywhere" — and ONLY that line.**
2. **Realtime figure:** accrued SO FAR, recomputed live from actual
   attendance / hours / KPI to date — not a projection of the full period.
   Must be labelled so it can never be mistaken for the final frozen payable.

Everything else in the brief stands unchanged, in particular: the four
user-visible state words, the forbidden vocabulary (compute / verify /
disburse / delta / draft / run / reconciliation / Type A / Type B never appear
in a user-visible string), HR-prepares-Finance-pays, one receipt per person,
period-scoped holds, the statutory sign-off gate, and the mobile rules.

---

## 2. The design in one page (decisions + reasons)

Numbered because §7's change list refers back to these.

**D1 — The live view is a READ-ONLY PROJECTION, never a stored document.**
New method `window.Payroll.preview(periodId)` builds the period's lines
through the SAME input-gathering and the SAME frozen maths the real pipeline
uses, and **writes nothing** — no run document, no state, no audit rows.
*Reason:* a live figure that persisted anywhere would eventually be the thing
that gets paid; a projection that exists only in the response cannot be.

**D2 — One pipeline, two callers: extract the read half of each engine.**
`computePayRun` (js/departments.js:2009) and `WeeklyRun.compute`
(js/payroll-weekly.js:510) are today read-everything-then-write monoliths.
Split each into a read-only builder + the existing writer that calls it:
`window.buildPayRunLines(month, opts)` and `WeeklyRun.buildLines(weekId)`.
The writers keep their exact current behaviour (same state gates, same doc
writes); the builders are verbatim-moved code, not rewrites. `preview()` calls
the builders. *Reason:* this repo has already been bitten twice by a
preview/engine divergence in payroll (see js/payroll-weekly.js header). A
second copy of the input-gathering would be the same disease. The frozen
money-core functions (`computePayLine`, `computeWeeklyLine`) are reached only
through these builders — **no arithmetic is reimplemented anywhere**.

**D3 — The screen shows the projection for an IN-PROGRESS period and the
stored frozen lines for an ENDED one.** New pure helpers
`PayrollCore.periodEnd(periodId)` / `PayrollCore.periodEnded(periodId,
todayIso)` decide which mode a period is in. In live mode every money figure
on screen comes from `preview()`; in closed mode everything comes from
`load()` exactly as today. The two modes are visually explicit (§6.3).

**D4 — Opening an in-progress period no longer writes anything.** The
auto-prepare block in js/screens/payroll.js (lines ~518–534, the block the
handoff calls `_pyMaybePrepare`) runs ONLY when `periodEnded(...)` is true.
*Reason:* today, opening the current month silently writes a frozen
'computed' run whose lines go stale by the afternoon, and paints "Ready to
check" on a month that is 11 days old — one press away from locking and
paying a partial month as if it were final. A period that has not ended has
nothing worth freezing; looking must not write. Auto-prepare for ENDED
periods keeps its exact current behaviour (that is the step that used to be a
button called Compute, and it stays invisible).

**D5 — "Hours are correct - send to Finance" is refused for a period that has
not ended.** Enforced in the ENGINE (`Payroll.markHoursCorrect`), mirrored by
the screen (button not rendered in live mode). *Reason:* the check locks the
figures; locking figures for days that have not happened yet is the
live-becomes-payable failure this spec exists to prevent. `pay()` needs no
second gate — it requires state 'checked', which is now unreachable
mid-period. (Flag F1, §11: early release.)

**D6 — Mid-period edits are allowed and are INPUTS, not money.** Hold /
put-back, Adjust figures (incl. travel hours), and one-off amounts all work
mid-period. They store onto the run document exactly as today (holds →
`excluded`, weekly adjustments → `adjustments.{workerId}`, monthly →
`overrides.{uid}`, one-offs → `oneOffs.{personId}`), and the projection folds
them in on every read, so the live figures reflect them immediately. The
engine MAY (as a side effect of `setAdjustment`/`addOneOff`, which call
`prepare()`) write computed lines mid-period; that is harmless — the screen
never displays those stale lines while the period is live (D3), and the
period cannot be checked (D5). When the period ends, the normal auto-prepare
re-freezes from the same stored inputs, which is how every mid-period edit
survives into the frozen line.

**D7 — Travel hours mid-period (the owner's explicit example).** No new
storage. Path, end to end: the Adjust panel's "Travel hours" box →
`Payroll.setAdjustment(weekId, workerId, { travelHours })` →
`WeeklyRun.setAdjustment` → stored at
`pay_weeks/{monday}.adjustments.{workerId}.travelHours` →
`WeeklyRunCore.buildWeekDays` folds the week's travel figure onto the last
worked day (js/payroll-weekly.js ~194–205) → `computeWeeklyLine` pays it at
half rate. `buildLines`/`compute` re-read `adjustments` from the doc on every
run, so the figure survives every re-freeze. The only screen change: the
Adjust panel opens fine mid-period (it already does; `setAdjustment` allows
states notstarted/prepared) and after saving, live mode refreshes the
projection instead of trusting stored lines.

**D8 — Team tabs = period kind.** A month period only ever contains Office
people (the monthly builder skips anyone with a worker profile) and a week
only Operations people — that is already structural. So the Office tab is the
unified screen scoped to MONTH periods and the Operations tab is the same
screen scoped to WEEK periods. One renderer, one paint function, one set of
row actions; the tab changes (a) which periods the picker lists, (b) which
columns appear (already adaptive), (c) which metrics show (§6.4). The
cross-team "periods not yet paid" card stays on BOTH tabs unfiltered, each
row labelled with its team; opening an other-team period switches the tab.
*Reason:* the owner's "not mixed" and the brief's "one payroll" are both
satisfied — the process is one, the arithmetic and the view are per-team, and
a period owing on the other tab can never hide.

**D9 — The Office live figure is "this month's pay as it stands on the
records so far", NOT a pro-rated fraction.** `computePayLine` pays the full
monthly salary; pro-rating does not exist in this system (HANDOFF §4.1, an
owner-undecided policy) and money-core cannot change. What IS naturally
to-date: `getAttendanceScore(uid, month)` already scores the current month
against workdays elapsed (js/screens/dashboards.js:3185), and
`computeKpiForMonth` is month-scoped. So the projection for the current month
is honest — performance inputs measured to today, salary shown in full — and
the screen SAYS so in plain words (§6.3 copy). The Operations live figure is
genuinely accrued: `computeWeeklyLine` over the punches that exist pays only
hours actually worked. *Judgement call:* inventing pro-rating here would be a
new money policy nobody ruled on; labelling beats guessing.

> **⚠ SUPERSEDED 2026-08-13 (PAYROLL-ROSTER-ACCRUAL) — DO NOT RESTORE THIS
> BEHAVIOUR.** The owner's later, explicit ruling reverses D9's DISPLAY
> choice: "take home so far should show the true value of standing on the
> day of that month. it cant be full already becayse that month is not yet
> done". The Office live/roster take-home is now a DISPLAY-ONLY accrued
> figure (elapsed workdays ÷ this month's total, via `window.
> accruedTakeHomeSoFar`, js/pay-policy.js), never the full-month projection
> this D9 entry describes. This is display only — `computePayLine` still
> pays the full monthly salary at period end, exactly as this entry says;
> that FROZEN payable is unchanged and NOT pro-rated. See js/screens/
> payroll.js and js/screens/dashboards.js for the live implementation.

**D10 — Future days are "not yet", never "absent".** `computeWeeklyLine`
marks a day with no punches absent; mid-week that would show Thursday–Sunday
as "no clock-in", which is alarming and false. Display-only fix in the
screen: in live mode, a week day whose date is > today (Manila) renders as
"not yet" and is excluded from absent counts and no-punch problem sentences.
Zero money impact (an absent day already pays 0). Pure string comparison on
the period's dates vs `bizDate()` — no Date arithmetic.

**D11 — Add / remove for the period.** Remove = the existing period-scoped
hold (`Payroll.setHeld`, a row action; unchanged). Add-back = the existing
"Put back in this period" on the not-being-paid card (unchanged). NEW: a
"Who else should be here?" button on the roster listing everyone the period
did NOT include, with the reason in words and the correct door: put-back for
holds; "Open their HR record" for no-rate / not-in-payroll / removed. The
payroll screen never edits the person's record (owner: "records cannot be
edited in the payroll tab") — it links to HR. (Flag F2, §11.)

**D12 — Base pay is read-only on payroll, with a named edit door.** Read-only
on the payroll screen (already true — the screen writes only period-scoped
inputs): Office `payroll/{uid}.salary / .allowance / .deductions /
.statConfig` + government IDs; Operations `worker_profiles/{id}.hourlyRate /
.dailyRate / .allowances{meal,transport,rent} / .deductions`. The edit door is
**HR → Employee Profiles** (`window.renderEmployeeProfiles`,
js/screens/employee-profile.js — rates, raises via RaiseFlow, history). Each
person card and the Adjust panel gain a plain-words line + button linking
there (§6.5).

**D13 — Retire the dead screens in phases with grep gates** (§8):
`renderPayrollHub`, `renderPayrollManagement` (hr.js) and
`js/screens/payroll-weekly-ui.js` — WITHOUT breaking the payslip back button
(4 sites) or losing the two things buried inside the old screens that must
survive: the standing-pay editor modal and the Workers roster
(`renderFinanceHRProfiles`).

---

## 3. Data model — nothing new is stored

This build adds **zero new Firestore collections and zero new stored fields**.
The live view is a projection; every input it needs already exists:

| Input | Where it lives | Read by |
|---|---|---|
| Office roster + standing pay | `users` + `payroll/{uid}` via `window.fetchUsersWithPayroll()` (js/config.js:809) | `buildPayRunLines` |
| Office attendance % | `attendance/{uid}/records/{date}`, scored by `getAttendanceScore(uid, month)` | `buildPayRunLines` |
| Office KPI | `tasks` + `kpi_targets/{uid}`, via `computeKpiForMonth` | `buildPayRunLines` |
| Office per-period overrides | `pay_runs/{YYYY-MM}.overrides.{uid}` | `buildPayRunLines` |
| Ops roster + rates | `worker_profiles` (`hourlyRate`/`dailyRate` via `resolveWorkerHourlyRate`) | `WeeklyRun.buildLines` |
| Ops punches | `attendance_worker/{workerId}/records/{YYYY-MM-DD}` | `WeeklyRun.buildLines` |
| Ops per-week adjustments (incl. `travelHours`, day overrides) | `pay_weeks/{monday}.adjustments.{workerId}` | `WeeklyRun.buildLines` |
| Holds | `pay_runs/{m}.excluded` / `pay_weeks/{w}.excluded` | `preview()` fold |
| One-offs | `{run doc}.oneOffs.{personId}` | `preview()` fold |
| Cash-advance plan | via `window.CashAdvance.planFor` (monthly) / `worker_profiles.caBalance` + adjustment (weekly) | builders |
| Statutory | `computeStatutory` + `statutory_tables/{year}` merge | builders |

Run-document shapes (`pay_runs/{YYYY-MM}`, `pay_weeks/{YYYY-MM-DD Monday}`)
are UNCHANGED. Stored state strings (`draft → computed → verified →
disbursing → disbursed`) are UNCHANGED — firestore.rules enforces those
transitions by name and this spec does not touch them.

---

## 4. Engine changes — exact signatures

### 4.1 `js/payroll.js` — `window.PayrollCore` additions (pure half)

Add after `PC.periodStart` (~line 188). Pure string maths, no Date except via
the existing helpers, no Firestore, so `tests/payroll-unified.test.mjs` can
pin them.

```js
/** The LAST calendar day of a period, ISO. Month → its last day (via
 *  window.monthBounds, which is pure); week → its Sunday (payWeekDays[6]).
 *  Falls back to periodStart on any helper failure — a label/deciding
 *  function must never take the pay screen down. */
PC.periodEnd = function (periodId) -> 'YYYY-MM-DD'

/** Has the period finished? todayIso is REQUIRED (callers pass
 *  window.bizDate()) so this stays wall-clock-free and testable.
 *  true  ⇔ todayIso > PC.periodEnd(periodId)   (plain string compare) */
PC.periodEnded = function (periodId, todayIso) -> boolean

/** 'office' for a month, 'operations' for a week. One mapping, one place. */
PC.teamOf = function (periodId) -> 'office' | 'operations'
```

Implementation notes:
- `periodEnd` for a month: `window.monthBounds(periodId, periodId + '-28')`
  gives `daysInMonth`; return `periodId + '-' + String(daysInMonth).padStart(2,'0')`.
  (monthBounds is called, never modified — money-core stays untouched.)
- `periodEnd` for a week: `window.payWeekDays(periodId)[6]`, in a try/catch
  falling back to `String(periodId)`.

### 4.2 `js/payroll.js` — fold refactor (internal)

`refold()` (~line 727) contains the normalise-and-fold logic (one-offs, holds,
backfill CA suppression, warnings). Extract its pure tail into a private
helper so `preview()` and `refold()` cannot drift:

```js
/** Fold stored inputs onto raw engine lines and normalise. PURE — no reads,
 *  no writes. `doc` may be null (no run document yet). */
function foldAndNormalize(rawLines, kind, doc) -> { lines, held, totals, warnings }
```

`refold()` keeps its write behaviour exactly as today (including the
`needsFold` skip and the `state:'computed'` re-assert) and calls
`foldAndNormalize` for the return value. **Behavioural change to refold:
none.** Verify with the existing unified tests.

### 4.3 `js/payroll.js` — `window.Payroll.preview(periodId)`

New method, placed directly after `load()` (~line 880).

```js
/**
 * The period AS IT STANDS RIGHT NOW, built from the live inputs through the
 * same frozen maths the real pipeline uses — and WRITES NOTHING. This is the
 * only legitimate source for an in-progress period's figures. THROWS on any
 * failed read (a denial must never render as an empty roster). Never called
 * for money that will move: what gets paid is always the stored frozen line.
 *
 * @returns same shape as load(), PLUS:
 *   live: true
 *   asOf: 'YYYY-MM-DD HH:mm'   // Manila, via bizDate()/bizHour() helpers
 *   state: the STORED state if a run doc exists, else 'notstarted'
 *   skipped: as built by the builder (not-paid list, same as load)
 */
async preview(periodId)
```

Body, precisely:
1. `kind = PC.kindOf(periodId)`.
2. Read the stored run doc (may be null) — for `excluded`, `oneOffs`,
   `adjustments`/`overrides`, `backfill`, and the stored state. Read-only.
3. Build raw lines: `kind === 'week'` → `await window.WeeklyRun.buildLines(periodId)`;
   month → `await window.buildPayRunLines(periodId, {})`. Each returns
   `{ lines, skipped, warnings }` (§4.4/4.5). Throw a plain-words error if the
   builder global is absent (same wording pattern as `prepare()`).
4. `foldAndNormalize(built.lines, kind, doc)` → lines/held/totals/warnings.
5. Assemble the load()-shaped result with `live: true`, `asOf`, warnings =
   builder warnings + fold warnings, `skipped = built.skipped`.

`preview()` MUST NOT be given a paid/checked period by the screen (the screen
only calls it when `!periodEnded`), but it does not itself refuse — it is a
read and reads are harmless.

### 4.4 `js/departments.js` — extract `window.buildPayRunLines`

`computePayRun` (line 2009) currently: (a) reads prev doc + state gate,
(b) gathers inputs and builds `lines`/`skipped` (the block from
`const usersSnap = await fetchUsersWithPayroll()` ~2026 through the end of the
`lines = await Promise.all(...)` block ~2115), (c) writes `pay_runs/{month}`.

Extract (b) VERBATIM into:

```js
/** READ-ONLY line builder for a month. Same inputs, same maths, same skip
 *  reasons as the writer — computePayRun calls this and then writes; the
 *  live view calls this and writes nothing. `overrides`/`policy` are read
 *  from the existing run doc when not passed. */
window.buildPayRunLines = async function(month, { policy, overrides } = {})
  -> { lines, skipped, warnings, payPolicy }
```

Rules for the extraction:
- **Verbatim move** — the same style as the money-core extraction ("moved
  verbatim (byte-identical function bodies)"). No logic edits, no renames
  inside the moved block.
- `computePayRun` becomes: prev-doc read + state gate (unchanged) →
  `const built = await window.buildPayRunLines(month, { policy: runPolicy, overrides })`
  → the existing write, fed from `built`.
- The prev-doc read stays in BOTH callers (the builder needs `overrides` and
  `payPolicy` when not passed; pass them from `computePayRun` so the doc is
  read once there). In `buildPayRunLines`, when `overrides` is undefined, do
  its own `pay_runs/{month}` read (read-only) to pick them up — `preview()`
  calls it bare.
- The exclusions read (`window.periodExclusionsFor(month)`) and its
  throw-on-null stay inside the builder — a projection over an unreadable
  exclusion list is as dishonest as a run over one.
- `warnings`: the monthly path currently has no warnings array; return `[]`.

### 4.5 `js/payroll-weekly.js` — extract `WeeklyRun.buildLines`

`WeeklyRun.compute` (line 510): (a) week-id validation + prev-doc read +
state gate, (b) the build (roster read, double-pay guard, skip reasons,
attendance reads, adjustments fold, statutory, `computeWeeklyLine` per
worker — lines ~531 to the end of the per-worker loop ~695), (c) the totals +
doc write.

Extract (b) verbatim into:

```js
/** READ-ONLY line builder for a week. Reads worker_profiles, seven days of
 *  attendance_worker per worker, this week's stored adjustments+exclusions,
 *  and the monthly-paid guard; calls computeWeeklyLine once per worker.
 *  Writes nothing. */
WeeklyRun.buildLines = async function(weekId)
  -> { lines, skipped, warnings }
```

- Week-id validation (Monday check) stays in both; the STATE GATE stays only
  in `compute` (a projection is legal in any state).
- The prev-doc read (for `excluded` + `adjustments`) stays inside
  `buildLines` (read-only, throw on failure with the existing wording).
- `compute(weekId)` becomes: validation + prev read + state gate →
  `const built = await this.buildLines(weekId)` → existing totals + write.
  To avoid a double doc read, let `buildLines` accept an optional pre-read
  doc: `buildLines(weekId, prevDoc)`.
- All warning codes (`no-rate`, `needs-review`, `override-no-reason`,
  `statutory-*`, `ot-double-count` counting) move WITH the build — they are
  facts about the inputs, and the live view must show them too.

### 4.6 `js/payroll.js` — gate `markHoursCorrect` on period end (D5)

At the top of `markHoursCorrect` (~line 1108), after the kind is known:

```js
const todayIso = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10);
if (!PC.periodEnded(periodId, todayIso)) {
  throw new Error(PC.label(periodId) + ' runs to ' + PC.periodEnd(periodId)
    + ' and is not finished. The figures are still adding up — they can be checked and paid once the '
    + (kind === 'week' ? 'week' : 'month') + ' ends.');
}
```

No other engine method changes. `reopen`, `pay`, `setHeld`, `setAdjustment`,
`addOneOff`, `correctAfterPay` keep their exact behaviour.

**Permissions / rules:** no `firestore.rules` change. `preview()` performs the
same reads the same roles already perform via `computePayRun` /
`WeeklyRun.compute` (finance/admin tier). A secretary (who the rules deny pay
reads) gets a thrown read → the screen's error state, which is correct and
already how the screen behaves.

---

## 5. Tests (write these; a money change without a test is not done)

New file `tests/payroll-live.test.mjs` (node:test, same conventions as
`tests/payroll-unified.test.mjs`), pinning the PURE additions:

1. `periodEnd('2026-08') === '2026-08-31'`; `periodEnd('2026-02')` handles
   leap years via monthBounds (`2028-02` → `2028-02-29`).
2. `periodEnd('2026-08-10') === '2026-08-16'` (Mon → Sun).
3. `periodEnded('2026-08', '2026-08-31') === false`;
   `('2026-08','2026-09-01') === true`; same pair for a week around its Sunday.
4. `teamOf('2026-08') === 'office'`, `teamOf('2026-08-10') === 'operations'`.
5. `foldAndNormalize` (export it on `PC` as `PC._foldForTest` or test via the
   module export) produces identical output to what `refold` returned for the
   same inputs — pin one month-shaped and one week-shaped fixture with a
   one-off + a hold.

Gates before every commit (existing):

```bash
node --test tests/*.test.mjs && bash scripts/ci-invariants.sh && node scripts/check-ui-wiring.js
```

(The known pre-existing CI failure on `css/styles-orig-verify.css` is another
session's scratch file — not yours.)

Mutation check (per house rule): in a SCRATCH COPY (never the live tree),
break `periodEnded` (flip the comparison) and confirm the new tests fail.

---

## 6. The screen — `js/screens/payroll.js`

### 6.1 Header comment

Rewrite the header block lines 7–12 ("NO team tabs anywhere") to state the
new ruling: one screen, one process, two team tabs, `payClass`/period-kind
selects the tab and the arithmetic and nothing else. Add the live-vs-frozen
rule: *an in-progress period displays a read-only projection
(`Payroll.preview`); an ended period displays the stored frozen lines
(`Payroll.load`); nothing payable is ever read off a projection.*

### 6.2 Team tabs (D8)

- Use the house chip-tab helpers `window.chipTabs` / `window.bindChipTabs`
  (see js/screens/hr.js:941 for the exact usage pattern) — do NOT hand-roll a
  tab bar.
- Keys: `office` (label **"Office Team"**), `operations` (label
  **"Operations Team"**). Module scope: `var PY_LAST_TEAM = null;` and change
  `PY_LAST_PERIOD` to `var PY_LAST_PERIOD_BY_TEAM = { office: null, operations: null };`
  so re-entry restores both the tab and that tab's period.
- The picker (`_pyPeriodList`, lines 464–472) takes the active team and lists
  ONLY that kind: office → `recentPeriods('month', PY_MONTH_WINDOW)`,
  operations → `recentPeriods('week', PY_WEEK_WINDOW)`. The "This week"
  button (line 575) becomes per-tab: "This week" on Operations, "This month"
  on Office (jumping to `thisWeekId` / `thisMonth`).
- Default selection on first open: keep the existing oldest-waiting logic
  (lines 497–505) over the UNFILTERED owing list; the chosen period's
  `PC.teamOf` decides the initial tab. With nothing waiting: Operations →
  current week, Office → current month.
- The "periods not yet paid" card (`_pyPaintWaiting`) stays CROSS-TEAM on
  both tabs. Each row adds its team in the sub line ("Office Team" /
  "Operations Team"). Its Open button switches tab when needed (set
  `PY_LAST_TEAM = PC.teamOf(id)` then `load(id)`).
- Tab switching routes through the SAME latest-wins `load()` serialisation —
  a tab click while a paint is in flight is remembered, not started (the
  existing `busy`/`pending` mechanism; do not add a second one).

### 6.3 Live mode (D1/D3/D4/D5/D9/D10)

In `paint(periodId)`:

```js
const todayIso = window.bizDate ? window.bizDate() : ...;
const isLive = !window.Payroll.core.periodEnded(selected, todayIso);
const period = isLive
  ? await window.Payroll.preview(selected)   // read-only projection
  : await window.Payroll.load(selected);     // stored frozen lines (as today)
```

- The auto-prepare block (lines 518–534) is additionally conditioned on
  `!isLive` (D4). Everything else in it is unchanged.
- **Live banner** (replaces the state headline sentence when `isLive`) —
  exact copy:

  > **"{label} is still going — figures so far, as of {asOf}."**
  > sub-line: *"These follow the punches, attendance and records as they come
  > in. Nothing here is final, and nothing can be paid until the
  > {week/month} ends on {periodEnd}."*

  Badge (in place of a state badge): **"In progress"** (badge-blue). If a
  stored state exists underneath (someone adjusted mid-period), do NOT show
  "Ready to check" — "In progress" wins while live.
- Office tab live extra sub-line (D9), shown only on month periods that are
  live: *"The monthly salary shows in full — it does not build up day by day.
  Attendance and KPI are measured up to today."*
- The take-home column label in live mode: **"Take-home so far"** (closed
  mode keeps "Take-home pay"). Totals card sub-line in live mode: **"so far —
  not what will be paid"** (closed: keep "this is what goes out").
- **No action buttons in live mode.** `_pyPaintAction` renders, instead of a
  button, the cost-line sentence: *"{label} runs to {periodEnd}. When it
  ends, the figures freeze here for HR to check, and Finance pays after
  that."* Row actions Hold / Adjust / one-off REMAIN available in live mode
  (`canEditRows = canPrepare && (isLive || state notstarted/prepared)`);
  "Correct this person" stays paid-state-only.
- A **"Refresh figures"** button (btn-secondary, next to the picker, live
  mode only) that re-runs `load(selected)`. Every row action already ends in
  `load(selected)`, which in live mode re-projects — `_pyRefreshFigures()`
  must NOT call `prepare()` when `isLive` (change its guard from state-based
  to `!isLive && state notstarted/prepared`).
- **Future days (D10):** in live mode compute
  `elapsedDates = weekDates.filter(d => d <= todayIso)`. (a) `_pyProblems`
  skips no-punch sentences for dates > today; (b) the card's "Days" field
  shows `"{worked} of {elapsedDates.length} so far"`; (c) the per-day rows in
  the Adjust panel label a future day **"not yet"** (muted) instead of "no
  punch — not paid", and its inputs stay enabled (pre-recording a known
  future absence override is legitimate).

### 6.4 Metrics with provenance (the owner's "where did the number come from")

Both tabs keep the card grid. Additions to `_pyRead` (line 140): pick up
`kpiScore`, `attScore`, `policy`, `perfFactor` from the raw monthly line
(fields already frozen by `computePayLine`).

New PY_COLS entries (office-only by presence, the existing `_pyColsFor`
mechanism handles it):

| key | label | value | always-visible note (py-f-note) |
|---|---|---|---|
| `attScore` | Attendance | `Math.round(attScore*100) + '%'` | "days present ÷ workdays so far, from the Attendance screen" |
| `kpiScore` | KPI | `Math.round(kpiScore*100) + '%'` | "tasks finished this {month} + deliverables score" |

Operations columns are already present (Days / Hours / Overtime / Travel
hours / rate + source). Add the provenance notes: Hours → "from the punch
clock"; Days → the existing worked/absent note; rate note already shows
`rateSource` ("dailyRate/8" renders as "daily rate ÷ 8" — map the two source
strings to plain words in `_pyPersonCard`).

Performance line (office, only when `policy === 'performance'`), as a card
sub-line: *"Allowance scaled to {perfFactor%}: KPI {kpi%} × 0.7 + attendance
{att%} × 0.3."* When `policy === 'flat'` show nothing (the allowance is
flat; saying so adds noise). These notes are permanently visible text — never
behind a tap (mobile rule).

### 6.5 Read-only base pay + the edit door (D12)

- Each person card sub-line already shows the rate/salary + source. Append a
  small always-visible line: **"Pay records are kept in HR."** with an inline
  link-button **"Open HR record"** → `window.renderEmployeeProfiles()`
  (guard: render the button only when `typeof window.renderEmployeeProfiles
  === 'function'`). One button per card, `btn-secondary btn-sm`, in the
  `py-rowacts` row.
- The Adjust panel (line 1194) gains, above the money boxes: *"{name}'s
  standing pay — the salary/rate, regular allowance and standing deductions —
  lives on their HR record and is not edited here. The boxes below apply to
  {label} only."* plus the same "Open HR record" button.
- The read-only fields, named exactly (for the implementer's reference, no new
  UI listing them): Office `payroll/{uid}`: `salary`, `allowance`,
  `deductions`, `deductionsUnearned`, `statConfig`, `sss`, `philhealth`,
  `pagibig`, `tax`, `tinNum`, `ssNum`, `phNum`, `pagibigNum`. Operations
  `worker_profiles/{id}`: `hourlyRate`, `dailyRate`,
  `allowances.{meal,transport,rent}`, `deductions`, `caBalance`, ID numbers.
  The payroll screen writes NONE of these — it writes only
  `excluded` / `adjustments` / `overrides` / `oneOffs` on run documents (and
  corrections via the engine). This is already true; keep it true.

### 6.6 "Who else should be here?" (D11)

Button in the roster header area (visible to `canPrepare`, both modes except
paid): opens an `openPage` panel listing, from `period.skipped` +
`period.held` (the same data `_pyNotPaidList` reads):

- each person: name, reason in the existing `_pyNotPaidWords` wording;
- action per row: held → **"Put back in this period"** (calls
  `Payroll.setHeld(selected, id, null)` then refresh); every other reason →
  **"Open HR record"** (door only, no in-place edit).

Panel intro copy: *"Everyone found for {label} who is not being paid, and
why. Holds are for this period only. Anything about the person themselves —
their rate, whether they are on payroll at all — is fixed on their HR
record, not here."*

All lookups scoped to the panel (`panel.querySelector`), never document
(house rule).

---

## 7. File-by-file change list

| File | Anchor | Change | Design ref |
|---|---|---|---|
| `js/payroll.js` | after ~188 (`PC.periodStart`) | add `PC.periodEnd`, `PC.periodEnded`, `PC.teamOf` | D3 |
| `js/payroll.js` | ~727 (`refold`) | extract pure `foldAndNormalize`; refold behaviour unchanged | D2 |
| `js/payroll.js` | after ~880 (`load`) | add `Payroll.preview(periodId)` | D1 |
| `js/payroll.js` | ~1108 (`markHoursCorrect`) | period-ended gate + plain-words refusal | D5 |
| `js/departments.js` | 2009–~2120 (`computePayRun`) | extract `window.buildPayRunLines(month, opts)` verbatim; computePayRun delegates | D2 |
| `js/payroll-weekly.js` | 510–~700 (`WeeklyRun.compute`) | extract `WeeklyRun.buildLines(weekId, prevDoc?)` verbatim; compute delegates | D2 |
| `js/screens/payroll.js` | 7–12 header; 70–71; 86; 140; 203; 464–472; 497–534; 569–600; 635; 693; 727; 838; 963; 1132; 1154 | tabs, live mode, metrics, provenance, edit-door links, add-panel — per §6 | D3–D12 |
| `js/screens/hr.js` | 503–529 (`renderPayrollScreen`) | drop the `renderPayrollHub`/`renderPayrollManagement` fallbacks; if `renderPayrollPage` is absent render the screen's own "engine did not load" error message instead of a blank pane | D13 |
| `js/screens/hr.js` | 4048, 5055, 5152, 5930 + others per §8 | payslip back-navigation retargets | D13 |
| `js/screens/hr.js` | 873–1041; 1043–3096; ~2023; ~380–470 | retirement + extractions per §8 | D13 |
| `js/screens/finance.js` | 418–422, 449–451 | drop retired fallbacks / retarget legacy route per §8 | D13 |
| `index.html` | script tag line 592 | remove `js/screens/payroll-weekly-ui.js` (and its comment block ~576) | D13 |
| `sw.js` | line 69 | remove `'/js/screens/payroll-weekly-ui.js'` from PRECACHE | D13 |
| `tests/payroll-live.test.mjs` | new | §5 | — |

House rules that apply to every edit: file-scope bindings are `var`, never
top-level `const`; all user content through `escHtml()`/`_pyEsc`; Manila time
only via `bizDate()/bizHour()/bizDow()`; every DOM lookup scoped to its
panel/root; plain emoji (never `emojiIcon()` output) in any plain-text sink;
no `overflow` or `text-overflow` declarations anywhere in PY_CSS additions.

---

## 8. Retirement plan — ordered, with grep gates

Retired: `window.renderPayrollHub` (hr.js:873–1041),
`renderPayrollManagement` (hr.js:1043–3096, a bare-global function declaration
also called from finance.js), `js/screens/payroll-weekly-ui.js`
(`window.renderWeeklyPayrollTab`, 1,044 lines). Must SURVIVE:
`renderFinanceHRProfiles` (hr.js:3097+ — workers roster, Clock kiosk,
one-worker payslip generator, ID cards) and the standing-pay editor modal
("Edit Payroll — {name}", hr.js:~2023, currently nested INSIDE
renderPayrollManagement).

Do the steps in order; each step leaves the app working.

**Step 1 — a front door for the Workers roster.** In hr.js, add:

```js
// The Operations Team's people screen: worker profiles, the Clock kiosk,
// ID cards, and the one-worker payslip generator (off-cycle pay: final pay,
// an advance, a partial week). Was only reachable through the retired
// payroll hub's Workers sub-view.
window.renderWorkersScreen = async function(currentUser, currentRole) { ... }
```

Same shape as `renderPayrollScreen` (503–529): gate on `isMoneyPriv`, paint a
`page-header` ("👷 Workers & Clock"), render `renderFinanceHRProfiles` into a
scoped pane. Add an HR hub card (hr.js ~440, next to the Payroll card, gated
`canPayroll`): icon 🪪→👷, title **"Workers & Clock"**, desc *"Operations
Team profiles, the punch kiosk, ID cards & one-worker payslips"*, `go: () =>
window.renderWorkersScreen(currentUser, currentRole)`.

**Step 2 — retarget the payslip back-navigation (the 4 named sites).** All
currently `() => window.renderPayrollHub(deptContainer(), currentUser,
currentRole, 'B')`:
- hr.js:4048 (`openPayslipHistory` view button) → `() =>
  window.renderWorkersScreen(currentUser, currentRole)`
- hr.js:5055 (`openPayslipGenerator` preview) → same
- hr.js:5152 (`openPayslipGenerator` post-save) → same
- hr.js:5930 (`#pe-money-link`, weekly branch) → `window.renderPayrollScreen
  (window.currentUser, window.currentRole)` — pay FIGURES now live on the one
  payroll screen; keep the existing toast line.
Then `grep -n "renderPayrollHub" js/screens/hr.js` and retarget any OTHER hit
that is a call site (the grep in recon found exactly these plus the
definition, the fallback at 524, and comments) — comments get updated, not
left lying.

**Step 3 — finance.js.**
- 418–422 (`case 'Payroll'`): collapse the fallback chain to
  `window.renderPayrollPage ? window.renderPayrollPage(content, currentUser,
  currentRole, { from:'finance' }) : content.innerHTML = <plain-words
  "payroll did not load — reload the app" empty-state>`. Never a silent blank.
- 449–451 (`case 'HR Profiles'` legacy deep-link route): →
  `renderFinanceHRProfiles(content, currentUser, currentRole)` directly (it
  is a global; finance.js already calls it bare at 54's description).

**Step 4 — hr.js:503–529 (`renderPayrollScreen`)**: remove the two fallback
branches (lines 524–527); on missing `renderPayrollPage` paint the same
plain-words error as Step 3.

**Step 5 — delete `js/screens/payroll-weekly-ui.js`.**
Gate first: `grep -rn "renderWeeklyPayrollTab" js/ index.html sw.js` must
show hits ONLY in payroll-weekly-ui.js itself, hr.js's hub (deleted in Step
6), and comments. Then: delete the file; remove the `<script defer>` tag
(index.html:592) and its comment block (~570–590, edit to keep surrounding
prose coherent); remove the PRECACHE entry (sw.js:69). **Do not hand-edit
CACHE_VER or APP_VERSION — the pre-commit hook bumps both** (see §12).

**Step 6 — delete `window.renderPayrollHub`** (hr.js:873–1041, including its
header comment from ~870). Gate: `grep -rn "renderPayrollHub" js/
index.html` → zero call sites remaining (definition only).

**Step 7 — extract the standing-pay editor, then delete
`renderPayrollManagement`.** This is the risky one; do it as its own commit.
1. Inside 1043–3096, locate the "Edit Payroll — {name}" panel builder
   (~2015–2100+; it opens via `openPage`, edits `payroll/{uid}` standing
   fields, and uses the KPI-month-breakdown helper commented at ~834).
   Extract it VERBATIM into a top-level `window.openEditPayrollModal(emp,
   currentUser, currentRole, onSaved)` in hr.js, together with any helpers it
   closes over (the implementer must trace its closure variables — anything
   it reads from renderPayrollManagement's scope becomes a parameter or an
   internal re-read).
2. Wire it: in `js/screens/employee-profile.js`, next to the existing "Give
   Raise" affordance (~602), add for money-priv viewers an **"Edit pay
   record"** button → `window.openEditPayrollModal(...)` (office people
   only; operations rates are edited on the worker profile via
   renderFinanceHRProfiles, which Step 1 re-doored).
3. Inventory everything else defined inside 1043–3096 that is referenced
   from OUTSIDE that range:
   `grep -n "buildThreeWayRecon\|loadPayrollTable\|loadPayRunStrip\|print-payroll-btn" js/ -r`
   plus a read of the hr.js header comment (lines 15–103) which lists the
   file's exports. Known from recon: `buildThreeWayRecon` (defined OUTSIDE at
   538 — safe), dashboards.js:2440 references renderPayrollManagement in a
   COMMENT only. Anything genuinely shared gets moved above 1043 before
   deletion.
4. Delete `renderPayrollManagement` (1043–3096 minus what was extracted).
   Gate: `grep -rn "renderPayrollManagement" js/` → comments only, and every
   remaining comment is updated to name the unified screen instead.
5. Full gate suite (§5 commands) + a manual boot: sign in, HR → Payroll,
   Finance → Payroll, HR → Workers & Clock, open a weekly payslip from
   Payslip History and press its back control → lands on Workers & Clock.

**If Step 7's closure-tracing turns out hairier than a day's work**, ship
Steps 1–6 (which already remove every user-facing dead screen) and raise
Step 7 as its own follow-up — the function is unreachable after Step 4, so
what remains is dead code, not user-facing debt. Say so in the commit message
rather than half-extracting.

---

## 9. What must NOT change (re-stated as hard checks)

1. **`js/money-core.js` — zero edits.** `git diff --stat js/money-core.js`
   must be empty at every commit.
2. **The statutory gate stands.** `disbursePayRun` refuses while
   `STATUTORY[year].verified !== true` (js/departments.js ~2144). Nothing in
   this build touches that code path, statutory-tables.js, or the Gov Rates
   screen. NEVER enter or invent 2026 SSS/PhilHealth/Pag-IBIG/withholding
   figures — not as fixtures with real-looking values either; test fixtures
   use obviously fake round numbers.
3. **Stored run-state strings and firestore.rules transitions unchanged.**
4. **Forbidden vocabulary** in user-visible strings: compute, verify,
   disburse, delta, reconciliation, draft, run, Type A, Type B. Check every
   string added by §6: `grep -inE "compute|verify|disburse|delta|draft|Type A|Type B" js/screens/payroll.js`
   and confirm every hit is a comment or an internal identifier.
5. **What gets paid is always the stored frozen line.** `pay()` and
   `markHoursCorrect()` read only `readRun` data; `preview()` output is never
   passed to either. The screen calls `openPayPanel` only in closed mode.

---

## 10. Mobile — the card layout at 375px

Unchanged mechanism (the PY_CSS grid, lines 308–355): one `<article
class="py-card">` per worker, `py-fields` grid
`repeat(auto-fit, minmax(126px,1fr))`, every figure a label/value pair,
notes as `py-f-note`. The additions (KPI %, Attendance %, provenance notes,
"Pay records are kept in HR" line, live-banner) are ordinary grid fields /
sub-lines and inherit the rules. The tab bar uses the house `.chip-tabs`
(already mobile-proven; it wraps, it does not scroll).

Verification standard (measured, not eyeballed), at 375×812 with a period of
each kind on screen, live AND closed:

- `document.documentElement.scrollWidth <= window.innerWidth`
- zero elements inside `#pay-root` with computed `text-overflow: ellipsis`
- every money figure and every metric present in the accessibility tree
  without a tap (the notes are rendered text, not tooltips/`title`)
- no `overflow` declaration added to PY_CSS (js/app.js's scroller lint
  depends on this — see the comment at payroll.js:44–47)

---

## 11. Flag to the owner — do NOT guess these

- **F1 (early release):** a period can now only be checked/paid after its
  last day (Sunday / month-end). If Finance sometimes releases the crew's
  week on, say, Saturday, that now gets a refusal naming the end date. Ask
  whether an early release is ever needed; if yes it is a President-tier
  override to design separately, not a silent loosening of D5.
- **F2 (period-scoped ADD):** "add someone to this period" who is excluded by
  their own record (`includeInPayroll === false`, no rate, removed) currently
  routes to their HR record — a person-level change. If the owner wants a
  one-period-only include (the mirror of a hold), that is a new stored field
  on the run doc and needs his ruling first.
- **F3 (office "so far" figure):** the live Office number shows the full
  monthly salary with to-date attendance/KPI (D9), not a day-counted
  fraction. If he expected a pro-rated peso figure, that is the pro-rating
  policy the handoff already lists as undecided — needs his ruling, and would
  be an ADDITIVE money-core function with pinned tests, in a separate build.
  **⚠ RULED 2026-08-13 — he did want the pro-rated figure. See D9's
  SUPERSEDED note above; do not treat this as still-open.**

---

## 12. Versioning / deploy notes for the implementer

- Do NOT hand-edit `APP_VERSION` (js/config.js), the `vX.Y.Z` strings in
  index.html, or `CACHE_VER` (sw.js) — the live `.git/hooks/pre-commit` hook
  bumps and re-stages all of them on commit. Because the hook RE-STAGES
  index.html/config.js/sw.js, run `git diff --cached` before every commit so
  another session's uncommitted edits to those files are not swept into yours.
- `git push origin master` deploys the app (GitHub Pages). No rules deploy is
  needed for this build (§4.6). Verify delivery with `curl -sL` (the domain
  301s) and by checking the served version string before believing any "the
  fix didn't work" report.
- Commit in at least three parts: (1) engine (payroll.js + extractions +
  tests), (2) screen, (3) retirement steps — each passing the §5 gate suite.

## 13. Verification checklist (pass/fail)

1. `node --test tests/*.test.mjs` green, including the new
   `payroll-live.test.mjs`; `bash scripts/ci-invariants.sh` and
   `node scripts/check-ui-wiring.js` green (modulo the known pre-existing
   css scratch-file failure).
2. `git diff --stat js/money-core.js` empty.
3. Open the CURRENT week on Operations, twice, watching the network/console:
   **zero writes** to `pay_weeks` (no doc is created by looking). Same for
   the current month on Office and `pay_runs`.
4. Live mode shows the banner with an as-of time; the take-home column reads
   "Take-home so far"; no "Hours are correct" and no "Pay everyone" button
   anywhere on an in-progress period.
5. Calling `window.Payroll.markHoursCorrect('<current period>')` from the
   console is refused with the §4.6 sentence.
6. Operations live card mid-week: future days read "not yet", not "no
   clock-in"; the problems list has no sentence about a future day.
7. Add travel hours to one worker mid-week via Adjust → the live take-home
   rises by hours × half-rate immediately; reload the page → still there;
   after the week ends, auto-prepare freezes lines that still carry it
   (verify the frozen line's `travelHours`/`travelPay`).
8. Office live card shows Attendance % and KPI % with their visible source
   notes; a `policy:'performance'` person shows the perfFactor sentence.
9. Hold someone mid-period → they move to the not-being-paid list with the
   reason; "Who else should be here?" lists them with "Put back"; put-back
   restores them; a no-rate person in that panel gets "Open HR record" and
   NO in-place edit.
10. Open the same period from HR → Payroll and Finance → Payroll: identical
    screen, identical figures, identical buttons for the same role.
11. An ENDED, unpaid period behaves byte-for-byte as before this build:
    auto-prepare on open, "Ready to check", check → Finance notified, pay
    flow with per-person receipts, statutory gate still refusing an
    unverified year.
12. Mobile checks of §10, all four passing, on both tabs, live and closed.
13. Retirement: greps of §8 steps 5–7 return zero call sites;
    `payroll-weekly-ui.js` absent from disk, index.html and sw.js PRECACHE;
    weekly payslip history → open payslip → back lands on Workers & Clock;
    `#pe-money-link` lands on the payroll screen; Finance deep-link
    'HR Profiles' still lands on the workers roster.
14. `grep -inE "compute|verify|disburse|delta|draft|Type A|Type B"` over the
    new user-visible strings: no hits outside comments/identifiers.
15. Console shows no "Identifier has already been declared" after a
    double-load of any edited file (all new file-scope bindings are `var`).
