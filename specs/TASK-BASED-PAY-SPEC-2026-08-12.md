# TASK-BASED-PAY-SPEC-2026-08-12

**Task-based pay for the Office Team — the owner's formula becomes the real computation.**
Written for an implementer who has NOT seen the conversation that produced it. Everything needed is in this file plus the referenced source files. You write code from this spec; the spec's author wrote none.

---

## 0. The owner's rulings

Two rulings, both decided. Do not re-open either.

**Ruling 1 (2026-08-12).** Office staff are task-based, and his formula is the REAL pay computation, not a display projection:

> **net × (0.7·KPI + 0.3·attendance)**

He confirmed, after being shown the consequences, that attendance stays at **30% weight**. Recorded consequence, stated factually: an office worker who completes every task but reads the day's notifications after 9:00 AM scores 0.5 on attendance (see §1 for what the attendance score actually measures), giving a factor of 0.7·1 + 0.3·0.5 = 0.85 — the month's pay drops ~15% even with perfect task results, and that portion is a penalty rather than unpaid work. That is the decided design.

**Ruling 2 (2026-08-12, verbatim):**

> "thats for office, take note. operation is done through attendance only by geo tracked timing in"

So the boundary between the two pay models is the owner's explicit rule, not an implementation convenience:

- **Office Team (monthly):** pay = net × factor. This and only this.
- **Operations Team (weekly):** pay = hours from geo-tracked clock-ins × rates (`computeWeeklyLine`: OT at plain rate, travel at half rate). **No KPI term, no multiplier, no task score — KPI is an Office concept and has no meaning for Operations.** Nobody later "helpfully" extends it there. The guard is structural (§5).

**Also decided: no separate absence deduction.** He initially mentioned the DOLE daily-rate formula, then clarified the work is task-based and the multiplier computes it. Task-based pay follows output; there is no "absent day" to deduct. One mechanism only — this spec adds **no** day-count absence deduction anywhere, and it flags the double-penalty hazard when a hand-typed unearned deduction coexists with the multiplier (§9.4).

### The one legal flag (stated once, neutrally)

Whether these employees are properly classified as paid-by-results, and whether a performance multiplier against their wage is lawful for them, is a question for the owner's accountant or a labor lawyer. The minimum-wage floor in §8 exists because of that question: payment by results is still subject to minimum-wage protection. This spec asserts nothing about Philippine law in either direction and cites no authority.

---

## 1. Recon facts this design builds on (verified 2026-08-12)

| Piece | Where | What matters |
|---|---|---|
| `window.computePayLine` | js/money-core.js (≈83–166) | The ONE per-employee monthly pay function. Already computes `perfFactor = clamp01(kpiScore*0.7 + attScore*0.3)` for every line. Today's policies: `'flat'` (default — factor ignored) and `'performance'` (factor scales the **allowance only**; base wage untouched). **This is why the owner sees full salary against 10% attendance.** File is FROZEN with pinned tests; two prior "permitted edits" are documented in its comments (§A4 statutory year, statutory-config resolver). This spec is the third: one ADDITIVE branch. |
| `'performance'` unreachable | every caller passes no policy; js/departments.js defaults `'flat'` | Confirmed in BETA-REVIEW-2026-08.md:1838. Nothing this spec does resurrects it — it stays exactly as pinned. |
| The owner's formula as dead code | js/screens/dashboards.js (Personal Finance renderer; search for `projLine.netBeforeCA`) | `multiplier = kpi*0.7+att*0.3` is computed, but `computedMonth` takes `projLine.netBeforeCA` built with `policy:'flat'`, so the `net*multiplier` fallback is unreachable. V12-PLAN.md:592 records the original intent as `net×(kpi·0.7+att·0.3)`. Two screens can show different numbers for the same person-month (BETA-REVIEW-2026-08.md:1628). Fixing this is IN SCOPE (§10). |
| What `attScore` actually is | js/app.js `tryUpgradeAttendanceOnNotifRead` (≈2817), `getAttendanceScore` | Timing in scores **0.5**; reading ALL notifications before **9:00 AM Manila** (or an approved `attendance_extensions` expiry) upgrades the day to **1.0**. **It is a punctuality / notification-read score, NOT a presence measure.** Every place this spec's copy mentions attendance in a pay context says so plainly (§9), so nobody mistakes it for "days worked". |
| KPI | `window.computeKpiForMonth` (money-core ≈360) | Month-scoped task completion + deliverable score. It uses its OWN internal 0.7/0.3 blend (task/deliverable). Do not confuse the two 0.7/0.3 pairs: one blends task+deliverable into the KPI score, the other blends KPI+attendance into `perfFactor`. |
| Monthly engine | js/departments.js `window.buildPayRunLines` (≈2020; one pipeline, two callers: `computePayRun` writes, `window.Payroll.preview` in js/payroll.js reads) | Where the policy is resolved (`passed → pay_runs.payPolicy → 'flat'`) and where this spec inserts the settings-doc rung (§6). `computePayRun` (≈2126) currently pre-resolves `policy || prev.payPolicy || 'flat'` — must defer instead (§6.2). |
| Pay release | js/departments.js `window.disbursePayRun` (≈2161) | Already refuses while `STATUTORY[year].verified !== true` (the gate this spec's floor check mirrors, §8). Freezes the `salary_history/{uid}_{month}` mirror carrying `kpiScore, attScore, perfFactor, policy, netPay, finalPay` — the employee-visible record. |
| Weekly engine | js/payroll-weekly.js `WeeklyRun.buildLines` (≈560), `window.computeWeeklyLine` (money-core ≈462) | Hours descend from `attendance_worker/{id}/records/{date}` punches. `computeWeeklyLine` has **no policy parameter and no performance vocabulary at all** — the structural half of the §5 guard already exists. |
| Geo enforcement of weekly hours | js/screens/worker.js (≈826, client UX gate), **`recordAttendancePunch`** functions/index.js:1914 (authority) | The Cloud Function **recomputes the geofence server-side** (`haversineMetersServer`/`siteMatchServer`, :1820/:1834) against `geo_sites`, derives `hoursWorked` from its own server timestamps, and is the **sole writer** of `inValid`/`outValid`/`timeIn`/`timeOut`/`hoursWorked` — firestore.rules blocks client writes to those fields; an out-of-range attempt records only an `attempts` audit entry. The owner's statement that Operations pay rests on geo-tracked timing in is **accurate and enforced**. One maintenance note (not a gap, the code flags it itself): the geofence math exists in two hand-synced copies — js/geo-core.js (client) and the `*Server` twins in functions/index.js — a change to one must be mirrored in the other. |
| Unified payroll screen | js/screens/payroll.js `renderPayrollPage` + helpers (`_pyRead`, `_pyProblems`, `_pyPersonCard`, `openPayPanel`, `_pyRefreshFigures`) | **⚠ Another agent is editing this file concurrently — every change here is anchored to FUNCTION NAMES, never line numbers.** |
| One normalised line | js/payroll.js `PC.normalizeLine`, `PC.breakdownOf`, `PC.basisText` | Where the traceability words surface for both teams (§9). |
| Payslips (office) | js/screens/hr.js `window.toPayslipModel` (≈5303), `window.renderPayslipPage` (≈5629) | Built from the frozen `salary_history` row — already carries `perfFactor`/`policy`. |
| Rates admin screen | js/screens/statutory-rates.js `window.renderStatutoryRatesTab` (Finance → Taxes & BIR → Gov Rates; President-only writes) | Where the preview, the switch, and the minimum-wage entry live (§7, §8). |
| `settings/{docId}` rule | firestore.rules ≈1186 | read: any authed non-partner; **write: President only**. Both new settings docs fit with ZERO rules changes. Employees CAN read them — required for §10. |
| Pinned tests | tests/*.test.mjs — **330 tests today** (money 88, payroll-unified 58, weekly-engine 60, weekly-run 32, weekly-pay 29, payrun-guard 23, payroll-live 15, geo 15, cash-advance 10) | Every existing file must pass UNMODIFIED. New tests go in a NEW file (§13). (Older docs say "257 pinned" — that count is stale; 330 is today's, verified by running them.) |
| Sibling spec | STATUTORY-BY-STATUS-SPEC-2026-08-12.md | Concurrently specced; touches the same builder. Composition order in §11 keeps the two from contradicting. |

---

## 2. The formula — exact expression and why the ordering is what it is

### 2.1 The third policy: `'taskbased'`

`js/money-core.js`, inside `computePayLine`, the `netBeforeCA` assignment becomes a three-way branch. The `'flat'` and `'performance'` expressions are **byte-identical to today**:

```
const netBeforeCA = policy === 'taskbased'
  ? _round2((gross - statutoryTotal - otherDeductions) * perfFactor)
  : policy === 'performance'
    ? (base - statutoryTotal - otherDeductions + allowance*perfFactor)
    : (gross - statutoryTotal - otherDeductions);
```

(`_round2` already exists in this file and is already used above its declaration — `function` hoisting, same precedent as `withheldDeductions`.)

Immediately BEFORE the branch, the structural team guard (§5.1):

```
if (policy === 'taskbased' && emp.payClass === 'production') {
  throw new Error((emp.displayName || emp.email || 'This person') +
    ' is paid weekly on the Operations Team — task-based pay applies to the Office Team only. Nothing was worked out for them.');
}
```

And inside the return object, ONE conditional field (see §2.4 for why it must be conditional):

```
...(policy === 'taskbased' ? { preMultiplierNet: gross - statutoryTotal - otherDeductions } : {}),
```

Everything else in the function — `perfFactor`, statutory resolution, `effectiveGross`, the CA plan, the return shape for the other two policies — is untouched, byte for byte.

### 2.2 Where the multiplier lands, and why (deliberate, not incidental)

The multiplier applies to **(gross − statutory − other deductions)** — i.e. AFTER both are subtracted. Three candidate orderings were considered; the chosen one wins on all four grounds:

1. **It is the owner's literal formula.** His "net" has always meant pay after deductions (the legacy display net at the top of the Personal Finance renderer is `salary + allowance − deductions`, and the dead code multiplied exactly that). `net × factor` = deduct first, scale the remainder.
2. **Money owed to third parties is never scaled.** The line's `sss/philhealth/pagibig/tax` fields stay the full table (or hand-set) amounts — they are what `disbursePayRun` actually remits to government, and what withheld deductions (cash bond, canteen) pass onward. A factor that shrank a remittance would under-remit for a real person; a factor that shrank a cash bond would under-collect money the company owes back. The factor touches only the employee's take-home remainder.
3. **Statutory stays computed on the nominal gross** (`gross = salary + allowance`, unchanged line ≈104 — its comment already says brackets key off THIS). This is the remittance-safe direction: contributions never drop because a KPI factor dropped. Whether brackets should instead follow the scaled compensation actually paid is an accountant question (§14 Q1) — until answered, the app keeps deducting and remitting on the full bracket.
4. **It is the most favourable ordering to the worker** of the candidates. Jia's numbers (§4.1): chosen ordering ₱5,945.62; "scale gross first, then deduct" would give ₱6,525.00 − ₱1,287.50 = ₱5,237.50. When the mechanism is a penalty, the default that takes less is the right default.

### 2.3 `effectiveGross` — no change needed, and why the books still balance

`effectiveGross = netBeforeCA + statutoryTotal + otherDeductions − unearnedDeductions` (existing line ≈156, untouched). Under `'taskbased'` this automatically yields the scaled earned compensation: the (1−factor) shortfall is pay never earned, so it drops out of the company's payroll expense — exactly the principle the `'performance'` and unearned-deduction comments in the file already document. `disbursePayRun`'s ledger identity (debits vs credits) is expressed in terms of `netBeforeCA`/`effectiveGross`/`statutoryTotal`/`otherDeductions` and therefore holds by construction; `applyPayLineOverride` shifts all three coherently, so a manual per-person adjustment still balances too (and is the route out of a floor block, §8.4).

### 2.4 `preMultiplierNet` must be a CONDITIONAL key

The traceability sentence (§9) needs the pre-multiplier amount, and reconstructing it by dividing `netBeforeCA / perfFactor` fails at factor 0 and reintroduces float dust. So it is frozen on the line — but **only under `'taskbased'`**. The existing pinned tests `deepEqual` the FULL return object for `'flat'` and `'performance'`; an unconditional new key would fail every one of them. The spread-conditional above adds the key to task-based lines only, leaving the other two return shapes byte-identical.

### 2.5 One float fact — pin it, do not "fix" it

`0.6*0.7 + 0.1*0.3` in JavaScript is `0.44999999999999996`, **not** 0.45. So Jia's line is `_round2(13212.5 × 0.44999999999999996)` = `_round2(5945.624999999999)` = **₱5,945.62** — one centavo below the by-hand answer (13,212.5 × 0.45 = 5,945.625 → 5,945.63). The `perfFactor` expression is frozen (shared with `'performance'`) and must not be rounded. The pinned tests in §13 encode 5,945.62 with a comment; a future implementer who "corrects" it to .63 has broken the frozen factor. Screens display the factor rounded to a whole percent ("45%"); the stored math uses the exact float; the difference is at most a centavo and the payslip shows the stored figures.

---

## 3. The truth table — three policies, one line function

For an Office (monthly) employee with `gross = base + allowance`, statutory total `S` (resolved per §11's composition when the sibling spec is live), other deductions `D`, factor `f = clamp01(kpi·0.7 + att·0.3)`:

| | `'flat'` (default, unchanged) | `'performance'` (unchanged, still unreachable) | `'taskbased'` (NEW) |
|---|---|---|---|
| `netBeforeCA` | `gross − S − D` | `base − S − D + allowance·f` | `_round2((gross − S − D) · f)` |
| Factor affects | nothing | allowance only | the whole after-deduction remainder |
| Base wage | full | full ("never docked" comment stands for THIS policy) | scaled by `f` |
| `sss/philhealth/pagibig/tax` on the line (what is remitted) | full table/typed | full table/typed | full table/typed — **never scaled** |
| `effectiveGross` | `gross − unearned` | shrinks by unearned allowance | shrinks by the whole unearned (1−f) portion |
| `preMultiplierNet` on the line | absent | absent | `gross − S − D` |
| Reachable how | default everywhere | nothing sets it (pinned, left alone) | §6 precedence chain only |
| Guard | — | — | throws for `payClass === 'production'` |
| Unknown policy string (e.g. a misspelt `'task-based'`) | falls through to `'flat'` — pinned legacy tolerance. The strictness lives at the settings read (§6.1), which throws on any value outside the whitelist. | | |

**Operations (weekly) column — there isn't one.** `computeWeeklyLine` takes no policy, computes no factor, and its return object contains no `perfFactor`/`kpiScore`/`policy` keys (pinned in §13 T10). Weekly pay = server-validated punch hours × rates, full stop.

---

## 4. Worked examples — both teams

### 4.1 Office Team — Jia Lopez (the owner's real numbers)

Inputs: base ₱14,500.00, allowance ₱0, other deductions ₱0, KPI 60% (0.6), attendance 10% (0.1 — meaning: on the scored days she neither timed in on time nor read the notifications before 9:00 AM; this is the punctuality score, not days worked).

Statutory below uses the app's **2026 placeholder table** (js/statutory-tables.js — explicitly unverified). The real figures come from whatever the President confirms on the Gov Rates screen; the MECHANICS are what this example demonstrates, and the pinned tests pin the placeholder math the same way tests/money.test.mjs already does.

| Step | Value |
|---|---|
| gross = 14,500 + 0 | **₱14,500.00** |
| SSS (EE): MSC = round(14500/500)·500 = 14,500 → ×0.05 | ₱725.00 |
| PhilHealth (EE): clamp(14,500) ×0.05 ×0.5 | ₱362.50 |
| Pag-IBIG (EE): min(10,000, 14,500) ×0.02, cap 200 | ₱200.00 |
| Withholding: taxable 13,212.50 → first bracket | ₱0.00 |
| statutoryTotal | **₱1,287.50** |
| preMultiplierNet = 14,500 − 1,287.50 − 0 | **₱13,212.50** |
| factor = 0.6×0.7 + 0.1×0.3 | 0.44999999999999996 (shown as **45%**) |
| netBeforeCA = _round2(13,212.50 × factor) | **₱5,945.62** |
| finalPay (no CA) | **₱5,945.62** |
| effectiveGross = 5,945.62 + 1,287.50 | ₱7,233.12 (the company's true payroll expense) |
| Remitted to government (EE shares, unscaled) | ₱1,287.50 |

Under `'flat'` (today) the same month pays **₱13,212.50**. The screens today: payroll shows ₱13,212.50, and her own Personal Finance screen also shows ₱13,212.50 with an unused "45%" beside it — the number the owner expected (≈₱5,946) appears nowhere. After this spec, both screens show ₱5,945.62 with the same sentence explaining it (§9, §10).

If the configured minimum wage (§8) is, say, higher than ₱7,233.12 — this line is flagged and the month cannot be released until it is looked at.

### 4.2 Operations Team — a weekly line, no multiplier anywhere

Worker: hourly rate ₱62.50 (or dailyRate ₱500 → 500/8 via `resolveWorkerHourlyRate`). Week: Mon–Fri 8h each from geofence-validated punches, Sat 4h, Sun no clock-in. Meal allowance ₱300, no OT/travel, no deductions, no CA.

| Step | Value |
|---|---|
| regHours = 5×8 + 4 | 44 |
| regularPay = 44 × 62.50 | ₱2,750.00 |
| otPay / travelPay | ₱0 / ₱0 |
| allowanceTotal | ₱300.00 |
| gross | **₱3,050.00** |
| deductions + CA | ₱0 |
| net | **₱3,050.00** |
| daysWorked / daysAbsent | 6 / 1 (Sunday: no punch = absent = ₱0 — existing ruling, unchanged) |

No KPI, no attendance score, no factor — those keys do not exist on this line (§13 T10 pins that). The 44 hours descend from punches whose geofence was recomputed **server-side** by `recordAttendancePunch` (functions/index.js:1914) with function-only ownership of the time fields — which is exactly the basis the owner named for trusting Operations attendance. This spec changes nothing on this path.

---

## 5. The Office/Operations boundary — structural, loud, and tested

Ruling 2 promotes this from precaution to owner's rule. Four independent layers, so no single mistake can leak the multiplier onto a weekly line:

1. **The engine refuses.** `computePayLine` throws when `policy === 'taskbased'` meets `emp.payClass === 'production'` (§2.1) — it does NOT silently fall back to `'flat'`, because a silent fallback is how a wrong pay model goes unnoticed. The thrown words name the person and the rule.
2. **The weekly engine cannot express it.** `computeWeeklyLine` has no policy parameter; `WeeklyRun.buildLines` never reads `settings/payrollOfficePolicy` and calls `computeWeeklyLine`, not `computePayLine`. **Add no policy plumbing to js/payroll-weekly.js — none. If you find yourself editing that file for this spec, stop; you are outside the design.**
3. **The rosters cannot cross.** Anyone paid weekly is skipped from the monthly build by the existing double-pay guard (`monthlyRunSkipReason` skips `linkedUid` workers; `weeklyRunSkipReason` skips the monthly-paid) — so a weekly person never reaches the monthly engine where the policy lives.
4. **A pinned test stands watch.** §13 T9 pins the throw; T10 pins that a weekly line carries no `perfFactor`/`kpiScore`/`policy` keys, so any future change that adds performance vocabulary to weekly pay fails the suite by construction.

Statement for the record, per the owner: **KPI is an Office Team concept.** Operations pay is attendance-only via geo-tracked timing in. Do not add task scores, deliverable scores, or any factor to Operations pay in any future change without a new, explicit owner ruling.

Geo facts an implementer might otherwise re-litigate: the client gate in js/screens/worker.js is UX only; the authority is `recordAttendancePunch`, which recomputes the geofence server-side and solely owns `inValid`/`outValid`/`timeIn`/`timeOut`/`hoursWorked` (client writes to those fields are blocked by rules; out-of-range attempts leave only an `attempts` audit entry). One maintenance note: the geofence math is hand-synced between js/geo-core.js and the `*Server` twins in functions/index.js — mirror any change in both. Nothing further to build here.

---

## 6. Activation — inert until the President flips it

### 6.1 The switch doc: `settings/payrollOfficePolicy`

Written only from §7's switch (President-only per the existing `settings/{docId}` rule — no firestore.rules change):

```
settings/payrollOfficePolicy = {
  policy: 'taskbased' | 'flat',
  changedBy: uid, changedByName: string,
  changedAtLabel: window.bizDate(),                       // Manila
  changedAt: firebase.firestore.FieldValue.serverTimestamp()
}
```

Readers must validate: a stored `policy` outside `['flat','taskbased']` **throws** (plain words: `'The pay method setting holds a value the app does not know — nothing was worked out. Fix it on the Gov Rates screen.'`). Refusing beats guessing: a misspelt value that silently paid `'flat'` would be a wrong pay model nobody notices — the same failure the §5 guard exists to prevent. (The legacy unknown→flat fallthrough INSIDE `computePayLine` stays as pinned; the strictness lives here, at the boundary where new configuration enters.)

### 6.2 The precedence chain (who decides a month's policy)

In `window.buildPayRunLines` (js/departments.js):

```
explicit `policy` argument  →  pay_runs/{month}.payPolicy  →  settings/payrollOfficePolicy.policy  →  'flat'
```

- The settings doc is read **only** when the first two rungs are empty (i.e. a month never prepared before), with a fresh `db.collection('settings').doc('payrollOfficePolicy').get()` — **no dbCachedGet**; a pay-deciding switch must not be a stale cache read. A failed read **throws**: `'Could not read the pay method setting — nothing was worked out. Try again in a moment.'` (Same refusal stance as the `periodExclusionsFor` read beside it.)
- **`window.computePayRun`** currently pre-resolves `const runPolicy = policy || prev.payPolicy || 'flat'` — change the final `'flat'` to `null` so it defers to the builder, and write the pay_runs doc's `payPolicy` from the builder's RESOLVED return (`built.payPolicy`), not from its own local. Otherwise the settings rung is dead on the write path.
- Consequence to state in the UI copy (§7): a month already prepared keeps its stored `payPolicy` until someone refreshes its figures (the screen's existing `_pyRefreshFigures` / prepare action). Flipping the switch never silently rewrites an existing month, and never touches a paid one (existing state gates).
- `window.Payroll.preview` (js/payroll.js) calls the builder bare and inherits all of this — live view and stored figures cannot disagree about policy.

### 6.3 What activation can never do

- Nothing changes while the doc is absent or `policy:'flat'` — byte-identical behaviour everywhere (§15 item 3 verifies).
- The weekly engine never reads this doc (§5.2).
- Nobody's pay changes without the §7 preview having been available first, and the switch sits on the same screen as that preview.

---

## 7. The preview and the switch — js/screens/statutory-rates.js

New top-level function `renderTaskBasedPaySection(container, currentUser, currentRole)` in js/screens/statutory-rates.js, called at the end of `renderStatutoryRatesTab`. (If STATUTORY-BY-STATUS's `renderStatutoryStatusSection` has landed, order is: rates form → status section → this section. Neither section depends on the other.)

**Visibility:** the preview shows every office person's pay, so render the section only when `window.isMoneyPriv()` is true (same tier that sees the payroll screen). The President additionally gets the write controls; Finance sees state read-only. All DOM lookups scoped to the container; every name through `escHtml`; dates via `bizDate()`; no horizontal scroll at 375px — people render as stacked cards, never a wide table.

### 7.1 Layout, in order

**1. Heading and explanation.** Heading: **"Task-based pay — Office Team"**. Body (verbatim):

> "When this is on, an office person's monthly pay follows their results: take-home pay is worked out as usual (salary plus allowance, minus government deductions and other deductions), then multiplied by a percentage — 70% from task results and 30% from on-time morning check-ins. A check-in counts as on time when the person has timed in and read every notification before 9:00 AM. Government deductions are never reduced — they stay at the full amounts and are paid to the agencies in full. The Operations Team is not affected: their pay follows geo-tracked clock-ins and hours only."

State line when on: `On since {changedAtLabel} — turned on by {changedByName}.`

**2. Minimum wage card** (§8.2) — rendered before the preview so its "not set" state is impossible to miss.

**3. The preview — every affected person, current vs new, in pesos.** Current Manila month. Build both sides through the REAL engine — never a second copy of the math:

```
const now  = await window.buildPayRunLines(month, { policy: 'flat' });
const next = await window.buildPayRunLines(month, { policy: 'taskbased' });
```

(Both calls are read-only; explicit `policy` bypasses the settings rung, which is what makes this a preview regardless of the switch state.) Match lines by `uid`. Per person, one card: name, then `Pay now ₱X → ₱Y`, then the factor words: `"NN% — task results KK%, on-time check-ins AA%"`, then a red badge when §8's check fails for the `next` line: `"Below the saved minimum wage"`. A totals card on top: `"Whole month now ₱T1 → ₱T2"`. Empty month: `"Nobody is on the Office Team's month yet."`

Captions, when applicable: the statutory-table-unverified caption (same stance as the sibling spec: placeholder amounts are never presented as confirmed); and when the floor is not configured: `"No minimum wage amount is saved yet — the figures above are not being checked against one."`

**4. The switch.** President only (others see it disabled with the standard lock note). Button: **"Use task-based pay"** / **"Go back to fixed pay"**. Clicking opens a confirm dialog restating the totals from the preview: `"Office pay for {Month Label} would go from ₱T1 to ₱T2 for {N} people. This takes effect the next time a month's figures are worked out — months already paid are not touched. Turn it on?"` On confirm: write the §6.1 doc, `logAudit('update','settings','payrollOfficePolicy',{policy})`, repaint the section.

**5. The decided-consequence note** (factual, small, muted): `"Weighting is 70% task results, 30% on-time check-ins — the owner's decision, 2026-08-12. A person who finishes every task but checks in late loses up to about 15% of the month's pay."`

---

## 8. The minimum-wage floor

Payment by results must still yield at least the applicable minimum wage; a 0.45 multiplier can drive a month below it. The check mirrors the statutory-verified gate: loud, named, and blocking at release — but **it never invents the number**.

### 8.1 The number is the owner's to enter — NEVER guess it

The applicable minimum wage is region- and sector-specific and changes by wage order. **No peso amount for it appears anywhere in this spec, the code, the tests, or the UI defaults.** Until the owner enters it, the check is inert and visibly says so.

### 8.2 Config: `settings/payrollWageFloor`

Entered on the Gov Rates screen (§7.1 card "Minimum wage"), President-only write (existing settings rule):

```
settings/payrollWageFloor = {
  monthlyFloor: number,            // pesos per month, > 0
  source: string,                  // required, like the rates form: "Wage Order No. ..." etc.
  setBy: uid, setByName: string,
  setAtLabel: window.bizDate(),
  setAt: firebase.firestore.FieldValue.serverTimestamp()
}
```

Card copy: label **"Minimum monthly pay (₱)"**, hint: `"Enter the minimum monthly pay that applies to your office staff under the current wage order. The app does not know this number — it changes by region and by wage order, so it must come from you or your accountant."` A required "Where this came from" field, same stance as the rates form. Refuse a blank or non-positive save. When unset, the card shows: `"Not set — pay is not being checked against a minimum."`

### 8.3 The pure check: `window.wageFloorCheck(line, floorMonthly)` — js/pay-policy.js (new file, §12.1)

```
window.wageFloorCheck = function (line, floorMonthly) -> {
  checked: boolean,   // false when floorMonthly is absent/<=0 (inert)
  ok: boolean,        // true when not checked, or when earned >= floor
  earned: number,     // the figure compared: line.effectiveGross
  short: number       // _round2(floor - earned) when failing, else 0
}
```

The compared figure is **`effectiveGross`** — the month's earned compensation under the policy actually applied (take-home + government deductions + withheld deductions; allowance included). It works for every policy, so a `'flat'` salary below the floor is caught too, not only a scaled one. Whether allowances count toward the legal minimum is part of the §0 accountant flag; the config hint tells the owner to enter the floor accordingly.

### 8.4 Where it blocks and where it warns

- **Blocks: `window.disbursePayRun`** (js/departments.js), immediately beside the existing `verified !== true` refusal. Read `settings/payrollWageFloor` fresh; a failed read **throws** (`'Could not read the saved minimum wage — nothing was paid. Try again in a moment.'`). When configured, run `wageFloorCheck` on every line; any failure throws before any money write: `"{N} people are below the saved minimum wage of ₱{floor} for the month: {Name ₱earned, …}. Adjust their pay from their row, or correct the saved minimum on the Gov Rates screen. Nothing was paid."` When not configured: proceed (inert — the owner was told, loudly, in §7 and §8.5). A per-person Adjust (`applyPayLineOverride`) raises `effectiveGross` coherently (§2.3) and is the intended route out for a genuine case.
- **Warns: `_pyProblems`** (js/screens/payroll.js — concurrent file, function-name anchor, additive only). For month periods, fetch the floor once per paint; per failing line add a warning problem: `"{Name}'s pay this month works out below the saved minimum wage (₱{earned} against ₱{floor}). It cannot be released until this is looked at."` When the floor read fails: one note, `"Could not check pay against the saved minimum wage — try again in a moment."` When the floor is unset AND the period's lines carry `policy === 'taskbased'`: one note, `"Task-based pay is on, but no minimum wage amount is saved — add it on the Gov Rates screen so pay can be checked against it."` (`_pyRead` keeps `raw: l`, so `effectiveGross` is available without new plumbing.)
- **Warns: the §7 preview**, badge per failing `next` line.
- **Weekly team: no floor gate.** They are hourly; a monthly floor does not map onto a partial week, and inventing a daily conversion is inventing a number. Flagged as an owner decision (§14 Q3). The weekly engine is not edited by this spec (§5.2).

---

## 9. Traceability — the words on every figure

The owner's standing complaint is not being able to tell where a number came from. Forbidden vocabulary anywhere user-visible: **compute, verify, disburse, delta, reconciliation, draft, run, Type A, Type B.**

### 9.1 One sentence source: `window.payBasisSentence(line)` — js/pay-policy.js

Returns `''` unless `line.policy === 'taskbased'`. With `F = Math.round(perfFactor*100)`, `K = Math.round(kpiScore*100)`, `A = Math.round(attScore*100)`:

> **"Pay this month is the usual take-home ₱{preMultiplierNet} × {F}% = ₱{netBeforeCA}. The {F}% comes from task results ({K}%) counted at 70% and on-time morning check-ins ({A}%) counted at 30%. Check-ins count as on time when every notification is read before 9:00 AM."**

When `preMultiplierNet` is absent (a frozen line from before this change ever carries `'taskbased'` — shouldn't happen, but never render a blank peso): drop the first sentence's arithmetic and say `"Pay this month was multiplied by {F}% — task results ({K}%) counted at 70% and on-time morning check-ins ({A}%) counted at 30."` Peso amounts through the existing peso formatter; names through `escHtml` at the render sites.

ONE function feeds every surface below, so the payroll screen, the person's own screen, and the payslip can never phrase the same month three ways.

### 9.2 Where it renders

- **js/payroll.js `PC.normalizeLine`** (month branch): ensure `detail` carries `policy`, `perfFactor`, `preMultiplierNet` alongside the `kpiScore`/`attendanceScore` it already carries.
- **js/payroll.js `PC.breakdownOf`** (month branch): after the KPI/Attendance info rows, when the sentence is non-empty push `info('How this was worked out', sentence)`. The phone card shows the reason with the numbers automatically. Relabel the existing `'Attendance score'` info row to **`'On-time check-ins'`** — the old label is exactly the "days worked" misreading §1 warns about. (Display-label change only; no stored field changes.)
- **js/payroll.js `PC.basisText`** (month branch): when `l.policy === 'taskbased'`, append `'paid at ' + F + '% on task results and on-time check-ins'` to the parts list (short roster words; the full sentence lives in the breakdown).
- **js/screens/payroll.js `_pyPersonCard`** (concurrent file — additive): when the sentence is non-empty, a small muted note on the card. No new buttons.
- **Payslip:** `window.toPayslipModel` (js/screens/hr.js) — copy `policy`, `perfFactor`, `kpiScore`, `attScore`, `preMultiplierNet` onto the model when present on the source row; `window.renderPayslipPage` — render the sentence as a note line when `model.policy === 'taskbased'`. The `salary_history` mirror in `disbursePayRun` already freezes `kpiScore/attScore/perfFactor/policy`; add `preMultiplierNet: line.preMultiplierNet ?? null` beside them (additive field on an unpinned doc shape).
- **Personal Finance** (§10): the same sentence under the month figure.

### 9.3 Frozen, not recomputed

Every input to the sentence is already frozen on the line/mirror at the moment the figures were worked out (`kpiScore`, `attScore`, `perfFactor`, `policy`, now `preMultiplierNet`). Render-time code only formats; it never re-derives a score, so the words always describe what the math actually did, even years later.

### 9.4 The double-penalty tripwire

Because absence must be penalised by the multiplier ONLY (§0), add to `_pyProblems`, note-level, for month lines where `policy === 'taskbased'` and `unearnedDeductions > 0`:

> "{Name} has ₱{amount} of pay marked as not earned (absence or tardiness) while task-based pay already follows their results — check the same days are not being deducted twice."

This does not block; it names the hazard so a human decides. (Withheld deductions — bonds, canteen — are unrelated and stay silent.)

---

## 10. One number per person-month — fixing the Personal Finance screen

js/screens/dashboards.js, Personal Finance renderer — **anchor by searching for `projLine.netBeforeCA`** (single occurrence; this file's line numbers are stable today but the search is the anchor).

Today: `multiplier` is computed and displayed but unused; `computedMonth` uses a `policy:'flat'` projection; the `net*multiplier` fallback is dead; and the payroll screen could therefore disagree with this screen the moment any policy went live. Changes:

1. **Resolve the active policy once per render:** fresh read of `settings/payrollOfficePolicy` (employees can read `settings/*` per the existing rule). Validate against the §6.1 whitelist. On a failed read, do NOT guess: render the projection card's figure as `—` with `"The projection is unavailable right now — try again in a moment."` (a wrong number is worse than a missing one; the frozen-month path below is unaffected by this read).
2. **Projection:** `projLine = computePayLine({...u, id: uid}, { month, policy: activePolicy, kpiScore: kpi, attScore: att, caPlan: [], caBalance: totalAdvance })` and `computedMonth = projLine.netBeforeCA` — **always** from the line, never from a second expression. **Delete the `net*multiplier` fallback entirely**; `computePayLine` is guaranteed loaded by script order, and the dead branch is the drift this section exists to kill.
3. **The displayed factor** = `projLine.perfFactor` (live months) or `frozenThisMonth.perfFactor` (frozen months; keep the existing `?? dispKpi*0.7+dispAtt*0.3` fallback for legacy rows only). Never a third computation.
4. **Frozen months** already read `salary_history` (`netPay`/`finalPay`/`perfFactor`) — unchanged; the mirror now also carries `preMultiplierNet` (§9.2) for the sentence.
5. **The sentence:** render `payBasisSentence(projLine)` (or of the frozen row) under the "Projected Full Month" / "Final" card when non-empty.
6. **The "Current Month Payslip" button** in the same renderer (search `my-payslip-btn`): its unofficial-projection branch currently hardcodes `policy:'flat'` — pass the SAME resolved `activePolicy` from step 1 (and if step 1 failed, disable the unofficial branch with the same words rather than printing a flat payslip).
7. **Leave `openWorkerProfilePanel`'s `policy:'flat'` call alone** (same file) — that panel prefills a hand-made payslip for an Operations worker profile; `'flat'` is correct there, and the §5 guard makes any future misuse throw rather than mis-pay.

After this, the payroll screen, the employee's own screen, and the payslip all read the same frozen/projected line under the same policy — the BETA-REVIEW-2026-08.md:1628 discrepancy becomes structurally impossible for this pair of screens.

Also: js/screens/hr.js's read-only `payPolicyNow` reference words (search `payPolicyNow`) name only `'performance'` — extend the wording to name task-based pay too IF that screen is reachable; it is believed superseded (same caveat as the sibling spec §8.9: verify with a caller grep, and leave it untouched if unreachable).

---

## 11. Composition with STATUTORY-BY-STATUS-SPEC-2026-08-12

Both specs touch `window.buildPayRunLines` and the Gov Rates screen. The composition is ordered so they can never contradict, whichever lands first:

1. **Per employee, inside the builder:** the status spec derives `empForPay` (effective `statConfig`) FIRST; then THIS spec's policy applies inside `computePayLine(empForPay, { policy: resolved, ... })`. I.e. **status decides the statutory amounts; task-based then scales the after-statutory remainder.** A probationary trainee exempted by the status rule under task-based pay gets `netBeforeCA = _round2((gross − 0 − D) · f)` — both rulings honoured, no ordering ambiguity.
2. **Settings reads:** two independent docs (`payrollStatutoryStatus`, `payrollOfficePolicy`) both read near the top of the builder, each with its own throw-on-failure. Reading them in one `Promise.all` is fine; sharing a failure message is not (name which setting failed).
3. **Gov Rates screen sections:** rates form → statutory-status section → task-based section (§7). Purely cosmetic order; no shared state.
4. **Both add a new classic script after money-core** (`js/statutory-status.js`, `js/pay-policy.js`) — either order works; neither imports the other.
5. **Test files are separate** (`tests/statutory-status.test.mjs`, `tests/taskbased-pay.test.mjs`); both require money-core directly and neither modifies existing suites.
6. Whichever spec merges second rebases its builder edit around the other's — both edits are additive at distinct points (theirs: per-employee emp derivation; ours: policy resolution before the loop + `computePayRun` deferral).

---

## 12. File-by-file changes

1. **`js/money-core.js`** — the third permitted edit to the frozen file, additive only (§2.1): the `'taskbased'` ternary rung, the production-guard throw inside that rung's path, the conditional `preMultiplierNet` return key. NOTHING else. Add a header comment beside the other two permitted-edit notes naming this spec.
2. **NEW `js/pay-policy.js`** — classic script, `var`/`function` at file scope only (no top-level `const` — a re-evaluated duplicate script would throw), UMD-ish shim (`if (typeof window === 'undefined') globalThis.window = globalThis;`), containing: `window.wageFloorCheck` (§8.3), `window.payBasisSentence` (§9.1), `window.PAY_POLICY_VALUES = ['flat','taskbased']` (the whitelist §6.1's readers validate against — one place), and `module.exports = { wageFloorCheck, payBasisSentence, PAY_POLICY_VALUES }`.
3. **`index.html`** — `<script defer src="js/pay-policy.js"></script>` immediately after `js/money-core.js` (must precede js/payroll.js, js/departments.js, js/screens/*). Load order is load-bearing.
4. **`sw.js`** — add `'/js/pay-policy.js'` to `PRECACHE`. Do not hand-edit `CACHE_VER` (pre-commit hook derives it).
5. **`js/departments.js`** — `buildPayRunLines`: settings rung + whitelist validation + throw-on-failed-read (§6.2). `computePayRun`: defer the default (`|| null`), persist `built.payPolicy`. `disbursePayRun`: floor gate beside the statutory-verified refusal (§8.4); `salary_history` mirror gains `preMultiplierNet` (§9.2).
6. **`js/payroll.js`** — `PC.normalizeLine` (month detail fields), `PC.breakdownOf` (sentence row + `'On-time check-ins'` relabel), `PC.basisText` (short words) (§9.2). Not the concurrently-edited file.
7. **`js/screens/payroll.js`** (⚠ concurrent — FUNCTION-NAME anchors, additive only): `_pyProblems` (floor warnings, unset-floor note, double-penalty note §8.4/§9.4), `_pyPersonCard` (sentence note §9.2).
8. **`js/screens/statutory-rates.js`** — `renderTaskBasedPaySection` (§7): explanation, minimum-wage card, two-build preview, President switch, consequence note.
9. **`js/screens/dashboards.js`** — Personal Finance policy resolution, projection, sentence, payslip button; delete the dead `net*multiplier` fallback (§10).
10. **`js/screens/hr.js`** — `toPayslipModel`/`renderPayslipPage` sentence fields (§9.2); optional `payPolicyNow` wording if reachable (§10).
11. **NEW `tests/taskbased-pay.test.mjs`** — §13.
12. **No `firestore.rules` change.** No composite indexes (all new reads are single settings docs). No data migration — no stored line, mirror, or doc is rewritten; the only new writes anywhere are the two settings docs and the additive mirror field on FUTURE months.

---

## 13. New pinned tests — `tests/taskbased-pay.test.mjs`

Node `node:test`, zero deps, same harness as tests/money.test.mjs: `globalThis.window = globalThis; window.bizYear = () => 2026;` BEFORE requiring `js/statutory-tables.js`, `js/money-core.js`, `js/pay-policy.js`; silence `console.warn` in `before/after`. Statutory values below are the 2026 PLACEHOLDER table's — placeholder-pinning, same stance as the existing suite (they change visibly when real rates land). **All existing test files pass unmodified** (`node --test tests/*.test.mjs` — 330 today, plus these).

Every expected value below was float-verified against the real table code on 2026-08-12.

- **T1 — Jia Lopez, full-line pin.** `computePayLine({id:'jia', displayName:'Jia Lopez', salary:14500, allowance:0, deductions:0}, {policy:'taskbased', kpiScore:0.6, attScore:0.1})` deepEquals:
  ```
  { uid:'jia', name:'Jia Lopez', payClass:'regular',
    base:14500, allowance:0, otherDeductions:0, unearnedDeductions:0, withheldDeductions:0,
    sss:725, philhealth:362.5, pagibig:200, tax:0,
    er:{sss:1450, philhealth:362.5, pagibig:200},
    kpiScore:0.6, attScore:0.1, perfFactor:0.6*0.7 + 0.1*0.3, policy:'taskbased',
    caBalance:0, caPlanned:0, caPlan:[],
    gross:14500, effectiveGross:7233.12, statutoryTotal:1287.5,
    netBeforeCA:5945.62, finalPay:5945.62, preMultiplierNet:13212.5 }
  ```
  Write `perfFactor` as the expression (it is `0.44999999999999996`, NOT 0.45 — §2.5) with a comment; `netBeforeCA` is 5945.62, not 5945.63, for the same reason. `effectiveGross` 7233.12 is float-exact.
- **T2 — full performer identity.** Same emp, `kpiScore:1, attScore:1` → `netBeforeCA === 13212.5`, `finalPay === 13212.5`, `preMultiplierNet === 13212.5`; and equals the `'flat'` control's `netBeforeCA`/`finalPay` exactly — a perfect month pays identically under both policies.
- **T3 — zero factor.** Same emp, `kpiScore:0, attScore:0` → `perfFactor 0, netBeforeCA 0, finalPay 0, effectiveGross 1287.5`, and `sss/philhealth/pagibig` still 725/362.5/200 — government amounts never scale.
- **T4 — rich line.** `{id:'u9', displayName:'Rico', salary:20000, allowance:2000, deductions:500, deductionsUnearned:200}`, `{policy:'taskbased', kpiScore:0.8, attScore:0.9, caPlan:[{amount:1000}], caBalance:3000}` → `perfFactor 0.83` (exact float), `statutoryTotal 1850` (1100+550+200+0), `preMultiplierNet 19650`, `netBeforeCA 16309.5`, `finalPay 15309.5`, `effectiveGross 18459.5`, `withheldDeductions 300`, `unearnedDeductions 200`.
- **T5 — negative remainder edge.** `{salary:0, allowance:0}` + `{policy:'taskbased', kpiScore:0.6, attScore:0.1}` → statutory floors give `statutoryTotal 500`, `preMultiplierNet −500`, `netBeforeCA −225`, `effectiveGross 275`. Documents that the math has no zero-floor of its own (the §8 gate is the guard) — same stance as the existing "no floor at 0" pin.
- **T6 — `'flat'` control byte-identical.** The existing Juan fixture (`salary:20000, allowance:2000, deductions:500`, `{policy:'flat'}`) deepEquals the SAME object tests/money.test.mjs pins (netBeforeCA 19650 …) — and has **no `preMultiplierNet` key** (`assert.ok(!('preMultiplierNet' in line))`).
- **T7 — `'performance'` control byte-identical.** The existing Maria fixture deepEquals its money.test.mjs pin, no `preMultiplierNet` key.
- **T8 — misspelt policy falls flat.** `{policy:'task-based'}` (hyphen) on the Jia emp → `netBeforeCA 13212.5`, `policy:'task-based'` echoed, no throw, no `preMultiplierNet`. Pins WHY the whitelist lives at the settings read (§6.1), with a comment saying exactly that.
- **T9 — the team guard throws.** `computePayLine({...jia, payClass:'production'}, {policy:'taskbased'})` throws, message matching `/Office Team only/`; the same emp under `{policy:'flat'}` does NOT throw (returns `payClass:'production'` line as today).
- **T10 — weekly lines have no performance vocabulary.** `computeWeeklyLine({hourlyRate:62.5, allowances:{meal:300}}, [{hours:8},{hours:8},{hours:8},{hours:8},{hours:8},{hours:4},{}])` → `gross 3050`, `net 3050`, `regHours 44`, `daysWorked 6`, `daysAbsent 1`, AND `assert.ok(!('perfFactor' in line) && !('kpiScore' in line) && !('policy' in line) && !('preMultiplierNet' in line))` — the structural boundary, pinned.
- **T11 — `wageFloorCheck`.** `(anything, undefined)` and `(anything, 0)` → `{checked:false, ok:true, short:0}`. `({effectiveGross:7233.12}, 10000)` → `{checked:true, ok:false, earned:7233.12, short:2766.88}`. `({effectiveGross:13212.5}, 10000)` → `{checked:true, ok:true, short:0}`.
- **T12 — `payBasisSentence`.** For the T1 line: the §9.1 sentence verbatim with `₱13,212.50 × 45% = ₱5,945.62` (peso strings per the formatter the function uses — pin the full string). For a `'flat'` line: `''`. For a `'taskbased'` line with `preMultiplierNet` deleted: the §9.1 fallback sentence (no blank peso).

---

## 14. Decisions that belong to the owner — DO NOT GUESS THESE

Ship with the defaults stated; surface each where noted.

1. **Statutory basis under scaling.** Contributions stay bracketed on the nominal gross and are remitted in full (§2.2). If his accountant rules that brackets should follow the scaled compensation actually paid, that is a deliberate follow-up change — not this spec. (Noted in the §7 explanation's "never reduced" sentence.)
2. **The minimum wage amount itself** — his to enter, with its source (§8.1/§8.2). The check stays inert until he does, and says so.
3. **A floor for the weekly team.** The monthly floor doesn't map onto hourly weeks; if he wants a daily-rate floor for Operations, that is its own small spec. Default: no weekly gate (§8.4).
4. **Below-floor months while `'flat'`.** The gate blocks those too once a floor is configured (the check is policy-agnostic, §8.3). If he wants the gate to bind only under task-based pay, that is a one-line condition — ask, don't assume; default is: it binds for all office months.
5. *(Recorded, not open)* Attendance weight 30% and its ~15% consequence — decided 2026-08-12 (§0). The classification/lawfulness question sits with his accountant (§0, single flag).

---

## 15. Verification checklist (measurable, in order)

1. `node --test tests/*.test.mjs` — every pre-existing file passes UNMODIFIED (330 today) and `tests/taskbased-pay.test.mjs` adds T1–T12 passing with the §13 values exactly (in particular netBeforeCA **5945.62** on T1 — if you got 5945.63, you rounded the factor; re-read §2.5).
2. `git diff js/money-core.js` shows ONLY the §12.1 additions (one ternary rung, one guard throw, one conditional return key, one header comment). `git diff js/statutory-tables.js` and `git diff firestore.rules` are empty. Re-diff every touched file immediately before any deploy (concurrent-session rule).
3. Switch-off equivalence: with `settings/payrollOfficePolicy` absent, open the payroll screen for the current Office month and a paid past month — every figure matches the pre-change build; no new sentences appear anywhere; the Personal Finance screen shows the same month figure as the payroll screen shows for that person.
4. Grep gate — the forbidden-vocabulary regex (`compute|verify|disburse|delta|reconcil|draft|\brun\b|Type A|Type B`) over every NEW user-visible string added by this change returns nothing (code identifiers exempt; strings are not).
5. Preview before adoption: Gov Rates → the new section renders for Finance/President only; the two-build preview lists every office person with `now → new` pesos and the whole-month totals; a person with KPI 60% / check-ins 10% shows exactly the §4.1 arithmetic against the CONFIRMED (not placeholder) rates; nobody from the Operations Team appears in it.
6. The switch: as President, "Use task-based pay" writes the §6.1 doc (verify fields in console) and `logAudit` records it; as Finance the control is read-only; a forced non-President write is refused by rules.
7. Precedence: a month already prepared under `'flat'` still shows flat figures after the flip; refreshing its figures re-prepares it task-based; a `'paid'` month is untouched and refuses re-preparation exactly as before. A hand-corrupted settings doc (`policy:'taskbase'`) makes preparation fail with the §6.1 words, NOT silently pay flat.
8. The guard: temporarily set a linked weekly worker's `payClass:'production'` user through the monthly path with taskbased forced (console) — `computePayLine` throws the §2.1 words; the weekly week for the same person computes exactly as before, and its lines contain no `perfFactor`/`kpiScore`/`policy` keys (spot-check a stored line in console).
9. Floor: with no `settings/payrollWageFloor`, pay proceeds and the §7/§8 "not set" words are visible; after entering a floor above a scaled line's `effectiveGross`, the roster shows the §8.4 warning naming the person, and "Pay everyone" fails with the gate's words BEFORE any money write (verify no ledger/salary_history/CA writes happened); adjusting that person's pay above the floor releases the block.
10. Traceability: for a task-based month, the person's card, the breakdown, their Personal Finance screen and their payslip all show the SAME §9.1 sentence with the same three numbers; the breakdown's attendance row reads "On-time check-ins"; a person with `deductionsUnearned > 0` shows the §9.4 double-penalty note.
11. One number per person-month: for one employee, compare the payroll screen's take-home, their Personal Finance "Projected Full Month", and (after paying) their payslip's net for the same month — all three identical, live and frozen; grep confirms the `net*multiplier` expression no longer exists in js/screens/dashboards.js.
12. Mobile 375px: the Gov Rates section, the preview cards, the payroll person cards and the breakdown show no horizontal scroll, no truncated peso figures, no hidden rows.
13. Delivery: `js/pay-policy.js` in index.html (after money-core, before payroll.js/departments.js) AND in sw.js `PRECACHE`; commit bumps `APP_VERSION`/`CACHE_VER` via the hook; a real device shows the new version string before any behaviour is judged (deploy-pipeline memory).
14. Hygiene: every new name through `escHtml`; every new DOM lookup container-scoped; `grep -n "^const\|^let" js/pay-policy.js` empty; all new dates via `bizDate()`; no `dbCachedGet` on either settings doc.
15. Sibling-spec composition (when both are live): a probationary office person under both switches shows statutory ₱0 (status rule) AND the multiplier applied to the un-deducted remainder, with BOTH basis sentences on the card — and the figures reconcile: `netBeforeCA = _round2((gross − 0 − D) · perfFactor)`.
