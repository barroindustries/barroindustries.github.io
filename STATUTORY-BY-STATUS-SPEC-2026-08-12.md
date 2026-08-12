# STATUTORY-BY-STATUS-SPEC-2026-08-12

**Statutory contributions follow employment status — implementation spec.**
Written for an implementer who has NOT seen the conversation that produced it. Everything needed is in this file plus the referenced source files. You write code from this spec; the spec's author wrote none.

---

## 0. The owner's ruling, and what this spec makes true

Asked where to exclude someone's SSS / PhilHealth / Pag-IBIG, the owner answered, verbatim:

> **"When the employee is registered as regular thats when statutory is considered."**

So SSS / PhilHealth / Pag-IBIG follow the person's **employment status** (`training | probationary | regular | resigned | terminated`, `window.EMPLOYMENT_STATUSES`, js/config.js ~452). Today nothing connects that field to the payroll engines — a trainee on the Office Team gets table-computed deductions exactly like a regular employee.

This spec designs the **smallest correct change** that makes the ruling true, under one non-negotiable safety rule:

> **No one's deductions change without a human seeing it first.** The rule ships OFF, behind a report that shows exactly who would change, and the President turns it on after looking.

### What this spec is NOT
- It does **not** assert Philippine law. Whether training/probationary staff are exempt from SSS/PhilHealth/Pag-IBIG coverage is a question for the owner's accountant (§10 Q3). This implements the owner's stated rule and makes the legal question visible.
- It does **not** invent 2026 rates, touch `js/statutory-tables.js`, or weaken the gate that refuses to pay while `STATUTORY[year].verified !== true`.
- It does **not** edit `js/money-core.js`. That file is frozen with pinned tests; the rule is a **layer above it** that derives a `statConfig` before the frozen resolver runs (§3 rationale).

---

## 1. Recon facts this design builds on (verified 2026-08-12)

| Piece | Where | What matters |
|---|---|---|
| `window.EMPLOYMENT_STATUSES` + `employmentStatusMeta(v)` | js/config.js ~452–465 | Five statuses. Absent/unknown reads as **"Not set"**, deliberately never defaulting to Regular. `ends:true` (resigned/terminated) is ADVISORY — offboarding does NOT remove someone from a pay period (config.js comment ~448–451). |
| Where the status is stored | `users/{uid}.employmentStatus` (Office Team), `worker_profiles/{id}.employmentStatus` (Operations staff with no login) | **NOT** `worker_profiles.status` (`'active'|'inactive'`) — that field is load-bearing in `monthlyRunSkipReason` / `weeklyRunSkipReason` and the firestore.rules punch gate. Never conflate them. |
| Where the status is edited | js/screens/employee-profile.js `_epOpenEditor` (~383) | HR-owned. Writes `users/{uid}` or `worker_profiles/{id}` with `employmentUpdatedAt/By`. This stays the ONLY editing surface (owner's rule: HR data is edited in HR, never in payroll). |
| `window.resolveStatutoryEE(emp, stat)` | js/money-core.js ~65 | Per-key modes via `emp.statConfig = {sss|philhealth|pagibig|tax: 'auto'|'fixed'|'exempt'}`, precedence `exempt > fixed > auto`. `'exempt'` zeroes EE **and** ER. Absent statConfig/key reproduces legacy `typed || table` **byte-for-byte**, including the pinned quirk that a hand-typed 0 falls through to the table. |
| Monthly engine | js/departments.js `window.buildPayRunLines` (~2020; one pipeline, two callers: `computePayRun` writes, `Payroll.preview` reads). Emp objects come from `fetchUsersWithPayroll()` (js/config.js ~809) which merges `users/{uid}` + `payroll/{uid}` — so the merged emp carries BOTH `employmentStatus` and `statConfig`. | Insertion point for the Office Team. |
| Weekly engine | js/payroll-weekly.js `WeeklyRun.buildLines` (~560–697). Statutory is monthly, taken on the month's LAST pay week via `WRC.resolveStatutoryWeekly` (~311): **an unconfigured worker gets nothing, ever** — no statConfig means zero deductions, by design. | Insertion point for the Operations Team. |
| One normalised line | js/payroll.js `PC.normalizeLine` (~474) + `PC.breakdownOf` (~578) fold both engines' frozen lines into the ONE shape js/screens/payroll.js renders. | Where traceability words surface. |
| The payroll screen | js/screens/payroll.js `renderPayrollPage`. Already has `_pyHrRecordBtn` / `_pyBindHrRecordBtns` (a link to the HR records screen) and `_pyProblems` (plain-sentence problems block). **⚠ Another agent is editing this file concurrently** — every change here is anchored to FUNCTION NAMES, never line numbers. |
| Rates admin screen | js/screens/statutory-rates.js `window.renderStatutoryRatesTab` — Finance → Taxes & BIR → Gov Rates. President-only writes. | Where the report and the switch live. |
| firestore.rules `settings/{docId}` (~1186) | read: any authed non-partner (+`system` for partners); **write: President only.** | The rule's on/off switch fits here with ZERO rules changes. |
| Pinned tests | tests/*.test.mjs (money, weekly-engine, payroll-live, …) — 257 pinned tests total; money-core's legacy fallthrough is pinned byte-for-byte ("quirk (pinned, not fixed)"). | New tests are ADDITIVE, in a new file. |

---

## 2. The hazard that decides the design

`employmentStatus` is **unset on every legacy record** (the field only exists since 2026-08-09). Two naive designs both fail:

- `if (status === 'regular') deduct` — everyone unset silently stops contributing SSS/PhilHealth/Pag-IBIG. The company under-remits to the Philippine government, invisibly, for real people.
- `unset defaults to regular` — remittance-safe, but it hides that nobody has classified these employees, and it contradicts `employmentStatusMeta`'s deliberate "Not set" stance.

**Resolution (this spec):**

1. **Unset preserves TODAY's behaviour exactly**, and surfaces a visible "employment status not set" flag for HR — on the report and on the pay roster.
2. **Only EXPLICIT non-regular statuses change anything**, and the only thing the rule can ever do automatically is **exempt** (zero) — it never enrols anyone, never increases a deduction (§3, direction argument).
3. **Nothing changes until the President flips a switch**, and the switch sits beside a report that lists, by name and by peso, exactly who changes (§6).

---

## 3. Where the rule lives, and its one direction

### 3.1 A layer above money-core, not inside it

The rule is a **pure derivation function** in a NEW file, `js/statutory-status.js`, that turns `(employmentStatus, existing statConfig, legacy typed amounts)` into an **effective statConfig**, which is then handed to the existing frozen resolvers (`resolveStatutoryEE` for monthly, `resolveStatutoryWeekly` for weekly). Reasons:

- `js/money-core.js` is frozen; its legacy fallthrough is byte-for-byte pinned. Any edit there re-opens 257 tests for a rule that composes cleanly on top.
- `resolveStatutoryEE` already has exactly the vocabulary needed (`'exempt'` zeroes EE and ER). Deriving `'exempt'` reuses audited semantics instead of minting a second zeroing path.
- Both engines get the SAME derivation from the SAME function — the rule cannot drift between teams.

**money-core.js is NOT edited by this spec. If an implementer concludes it must be, stop and escalate — that conclusion is wrong under this design.**

### 3.2 The rule can only exempt, never enrol

For a person whose status says "statutory is not considered" (training, probationary), the rule derives `'exempt'` — zero EE, zero ER. For a **regular** person it derives **nothing**: the Office Team's legacy fallthrough already deducts the table amounts for regulars (the ruling is already true there), and on the Operations side, auto-enrolling a regular worker who has no statConfig would silently START deducting from a worker's take-home — and you cannot remit for someone whose SSS/PhilHealth/Pag-IBIG numbers may not even be on file. Enrolment therefore stays a **visible human action** (HR sets the person's statutory setup on their record), and the report/roster names every regular Operations worker who has none (§6, §7). One automatic direction means the worst automatic failure is *deducting less from an explicitly-classified trainee* — which is the ruling — never *quietly taking more from anyone* and never *quietly under-remitting for an unclassified person*.

### 3.3 Withholding tax is out of scope for the rule

The owner was asked about SSS / PhilHealth / Pag-IBIG. The ruling does not mention withholding tax, and tax follows different law. The rule **never touches the `tax` key** — a trainee's tax keeps today's behaviour (typed || table, or their explicit statConfig.tax). Whether non-regular staff should also have tax handled differently is flagged to the owner/accountant (§10 Q2). Do not "helpfully" include tax.

### 3.4 Precedence — explicit human configuration always wins

`statConfig` set by hand (HR's per-person statutory editor, js/screens/hr.js) is deliberate configuration. A hand-typed legacy amount (`emp.sss` etc. with no statConfig) is also deliberate. The status rule is a **default**, so it fills only the gaps:

**Per key `k ∈ {sss, philhealth, pagibig}` — precedence, highest first:**
1. **Explicit mode** — `statConfig[k] ∈ {'auto','fixed','exempt'}` → kept unchanged. The rule does nothing for this key.
2. **Legacy typed amount** — no valid mode, but the person's flat field is truthy (`emp[k]` non-zero — the SAME truthiness the legacy `typed || table` expression uses, so no new edge) → kept on the legacy path unchanged, **and flagged** when the status is non-regular ("hand-set amounts win — clear them if nothing should be deducted").
3. **Status rule** — no mode, no typed amount, status is explicitly `training` or `probationary` → derive `'exempt'`.
4. **Legacy fallthrough** — everything else (regular, unset, unknown, resigned, terminated) → key stays absent; `resolveStatutoryEE` reproduces today's behaviour byte-for-byte.

`tax`: rungs 1–2 and 4 only; rung 3 never applies (§3.3).

---

## 4. The truth table

Per key `k ∈ {sss, philhealth, pagibig}`, Office Team (monthly engine), with the year's table loaded. "typed" = the flat field `emp[k]` is non-zero. "table" = the bracket amount for the person's gross. Rows marked ● are the ONLY rows where money changes when the switch is on.

| # | employmentStatus | statConfig[k] | typed amt | Today (switch off) | Under the rule (switch on) | perKey source | Flag raised |
|---|---|---|---|---|---|---|---|
| 1 | any | `'exempt'` | any | 0 (EE & ER) | 0 (EE & ER) — unchanged | `person` | — |
| 2 | any | `'fixed'` | any | typed amount (0 allowed) | unchanged | `person` | `typed-on-nonregular` words if status is training/probationary (info only, no money change) |
| 3 | any | `'auto'` | any | table | unchanged | `person` | same as row 2 |
| 4 | `regular` | absent | none / 0 | table | table — unchanged | `legacy` | — |
| 5 | `regular` | absent | > 0 | typed | typed — unchanged | `typed` | — |
| 6 | unset `''` / absent | absent | none / 0 | table | table — **unchanged** | `legacy` | `status-unset` |
| 7 | unset | absent | > 0 | typed | typed — unchanged | `typed` | `status-unset` |
| 8 ● | `training` | absent | none / 0 | table | **0 (EE and ER)** | `status` | — (basis words on the line instead) |
| 9 ● | `probationary` | absent | none / 0 | table | **0 (EE and ER)** | `status` | — (basis words) |
| 10 | `training` / `probationary` | absent | > 0 | typed | typed — unchanged | `typed` | `typed-on-nonregular` |
| 11 | `resigned` / `terminated` | absent | any | as rows 4–5 | **unchanged** | `legacy`/`typed` | `status-ended` |
| 12 | unknown value (e.g. `'contractual'`) | absent | any | as rows 4–5 | unchanged | `legacy`/`typed` | `status-unknown` |

`tax` for every row: today's behaviour, always (source `person`, `typed`, or `legacy`; never `status`).

**Row 11 rationale (resigned/terminated):** `ends:true` statuses do not remove a person from a pay period (config.js ~448). Their last period is a **final pay**, and this spec does not know whether the owner wants contributions taken on a final pay — that is §10 Q1. Until he answers, deductions are **unchanged** (the remittance-safe direction: keep deducting as if regular) and the line carries visible "final pay" words. **Do not silently zero a final pay's government deductions.**

**Operations Team (weekly engine) column:** for a worker with NO statConfig, today already deducts nothing (`resolveStatutoryWeekly` unconfigured path). Derived `'exempt'` is therefore **numerically a no-op on the weekly side** — rows 8–9 change zero pesos there. The rule's weekly effect is words and flags only: basis sentences, `status-unset` / `status-ended` / `typed-on-nonregular` flags, and the `regular-unconfigured` flag (a Regular worker with no statutory setup — nothing is deducted and someone should decide, §6/§7). Explicit worker statConfig keys are honoured unchanged, exactly as `resolveStatutoryWeekly` does today.

---

## 5. New file: `js/statutory-status.js`

Classic script, `window.*` globals, no build step. **File-scope bindings use `var` / `function`, never top-level `const`** (a duplicated `<script>` or stale SW copy re-evaluates the file; top-level `const` throws and kills it — see js/screens/payroll.js header for the precedent). Include the same UMD-ish shim money-core uses (`if (typeof window === 'undefined') globalThis.window = globalThis;`) so Node tests can `require()` it directly. Add `module.exports` for the two pure exports.

### 5.1 The rule data

```
// Which statuses the rule acts on, and how. Keyed HERE, not off
// EMPLOYMENT_STATUSES, on purpose: config.js is data-driven so HR can add a
// NEW stage without a code change — and a brand-new stage must NOT silently
// inherit an exemption nobody decided on. An unknown status is flagged, not
// acted on.
window.STATUTORY_STATUS_RULE = {
  training:     'exempt',   // owner ruling: statutory is considered when regular
  probationary: 'exempt',   //   — so an explicit non-regular working status is not
  regular:      'none',     // already correct: office legacy path deducts; ops is explicit
  resigned:     'none',     // final pay — unchanged until the owner rules (spec §10 Q1)
  terminated:   'none'
};
```

### 5.2 `window.statutoryStatusPlan(person, enabled)` — pure

**Signature:**
```
window.statutoryStatusPlan = function (person, enabled) -> {
  active:     boolean,        // true only when enabled AND ≥1 key was derived
  statConfig: object | null,  // the EFFECTIVE map to hand to the engine
                              //   (person's own explicit modes preserved,
                              //    derived 'exempt' filled into the gaps);
                              //   null when !active — caller passes the person
                              //   through UNCHANGED, guaranteeing byte-identical
                              //   legacy behaviour
  status:     string,         // normalized status key, '' when absent
  perKey: { sss, philhealth, pagibig, tax },  // each 'person'|'typed'|'status'|'legacy'
  words:      string,         // roster/basis sentence, '' when nothing to say (§7 copy)
  flag: null | { kind: 'status-unset'|'status-unknown'|'status-ended'
                      |'typed-on-nonregular'|'regular-unconfigured',
                 words: string }                                  // §7 copy
}
```

**Behaviour (implements §3.4 / §4 exactly):**
- Normalize status like `employmentStatusMeta` does: `typeof v === 'string' ? v.trim().toLowerCase() : ''`.
- `enabled !== true` → return `{active:false, statConfig:null, status, perKey:{…all 'person'/'typed'/'legacy' as resolved}, words:'', flag:null}` — **flags and words are suppressed when the rule is off** so the roster never nags about a rule the owner has not adopted. (The report calls with `enabled:true` regardless of the stored switch — that is what makes it a preview.)
- Per key, walk the precedence rungs of §3.4. Derivation happens only for rung 3.
- `active` is true iff at least one key resolved to `'status'`. When active, `statConfig` = `{...person.statConfig-valid-keys, ...derived-exempt-keys}` (explicit keys copied verbatim; `tax` copied only if explicitly set; keys on rungs 2/4 left ABSENT so the frozen resolver's legacy path handles them).
- `flag` picks the single most important issue in this order: `status-unset` (status blank) → `status-unknown` (non-empty, not in `EMPLOYMENT_STATUSES`) → `status-ended` (resigned/terminated) → `typed-on-nonregular` (training/probationary with a rung-2 typed amount or an explicit mode ≠ exempt on any of the three keys) → `regular-unconfigured` (see below) → null.
- `regular-unconfigured` is raised only when the caller says the person is on the **weekly** engine and status is `regular` with no valid statConfig key among the three. Pass this as a second condition: add an options bag `statutoryStatusPlan(person, enabled, opts)` with `opts.engine: 'month'|'week'` (default `'month'`). The office legacy path deducts for regulars, so the flag would be false noise there.
- The function reads NOTHING from `window` besides its own `STATUTORY_STATUS_RULE` and `window.EMPLOYMENT_STATUSES` **if present** (fall back to the five known keys when absent, so Node tests need no config.js). No DOM, no Firestore, no clock.

### 5.3 `window.statutoryStatusRuleOn()` — the switch reader (async, browser-only)

```
window.statutoryStatusRuleOn = async function () -> { on: boolean, meta: object|null }
```
- Reads **`settings/payrollStatutoryStatus`** fresh (plain `db.collection('settings').doc('payrollStatutoryStatus').get()` — **no dbCachedGet**: a payroll-deciding switch must not be a stale cache read).
- Doc absent, or `enabled !== true` → `{on:false, meta:null|doc}`. Missing-field-safe by construction (plain JS read, not a rules read).
- **A failed read THROWS** with plain words: `'Could not read the employment-status payroll setting — nothing was worked out. Try again in a moment.'` Refusing beats guessing in either direction: guessing "off" silently restores deductions for exempted trainees; guessing "on" applies a rule nobody confirmed. This matches the existing `periodExclusionsFor` refusal pattern in `buildPayRunLines`.
- Defined in this file for cohesion; it touches `db` only when invoked, so requiring the file under Node stays safe.

**The switch doc** (written only from §6's toggle; President-only per the existing `settings/{docId}` rule — **no firestore.rules change**):
```
settings/payrollStatutoryStatus = {
  enabled: true|false,
  changedBy: uid, changedByName: string,
  changedAtLabel: window.bizDate(),          // Manila
  changedAt: firebase.firestore.FieldValue.serverTimestamp()
}
```

---

## 6. The report and the switch — js/screens/statutory-rates.js

Extend `window.renderStatutoryRatesTab` (Finance → Taxes & BIR → Gov Rates; already the statutory admin surface, already President-gated for writes) with a new section rendered BELOW the existing rates form. New top-level function in the same file, e.g. `renderStatutoryStatusSection(container, canWrite)`, called from `renderStatutoryRatesTab`.

### 6.1 Data
- Office: `fetchUsersWithPayroll()` (merged users+payroll docs — carries `employmentStatus`, `statConfig`, `salary`, `allowance`, typed amounts). Respect `payrollDenied` — if the pay half is denied, say "Not shown to you", never render ₱0 (this file's existing stance).
- Operations: `db.collection('worker_profiles').get()`, active profiles (`status !== 'inactive' && !removed`).
- Table amounts: `window.computeStatutory({grossPay: salary+allowance, year: bizYear()})` per office person. When the year's table is **unverified**, still show the amounts but caption the whole section: *"Amounts use this year's placeholder rates, which are not confirmed yet — see the rates form above."* Never present placeholder figures as confirmed.
- Under-rule amounts: `resolveStatutoryEE(emp, table)` today vs `resolveStatutoryEE({...emp, statConfig: plan.statConfig}, table)` with `plan = statutoryStatusPlan(emp, /*enabled*/ true, {engine:'month'})` when `plan.active`, else identical. Weekly people: numbers never change (§4); show status + setup summary + flags only.

### 6.2 Layout (order matters)
1. **The switch.** Heading: **"Employment status decides government deductions"**. Body copy: *"When this is on, a person whose employment status is Training or Probationary has no SSS, PhilHealth or Pag-IBIG taken, unless someone set amounts on their record by hand. Regular employees are unchanged. People with no status set are unchanged — set their status on their HR record. It takes effect the next time a pay period's figures are worked out; periods already paid are not touched."* State line when on: `On since {changedAtLabel} — turned on by {changedByName}.` Button (President only, disabled otherwise with the standard lock note): **"Turn this on"** / **"Turn this off"**. Writes the §5.3 doc, `logAudit('update','settings','payrollStatutoryStatus',{enabled})`, repaints. Non-presidents see the switch state read-only.
2. **"Who changes"** — ONLY people whose amounts differ (truth-table rows 8–9): name (escHtml), team, status badge (`employmentStatusMeta`), then `SSS ₱x → ₱0`, `PhilHealth ₱y → ₱0`, `Pag-IBIG ₱z → ₱0`, per person. Empty state: *"Nobody's deductions change right now."* This list IS the preview the design promises — it must render correctly **before** the switch is ever turned on.
3. **"Needs a decision"** — four flag lists, each with a count, names, and a per-person link that calls `window.openEmployeeProfile({uid|workerId, name})`:
   - Status not set (flag `status-unset`, plus `status-unknown` with the stored raw value shown).
   - Employment ended but still on payroll (`status-ended`) — with the §10 Q1 caption: *"Final pay: government deductions stay unchanged until the owner decides."*
   - Regular Operations workers with no statutory setup (`regular-unconfigured`): *"Nothing is being deducted for them."*
   - Non-regular with hand-set amounts (`typed-on-nonregular`): *"Hand-set amounts win over the status rule."*
4. **Everyone** — one compact row per person (both teams): name, team, status, per-key source words (`set by hand` / `amount typed on record` / `employment status` / `usual table`), amounts today. Plain list; reuse `window.chipTabs`/`sopPanel` only if it stays simple.

All DOM lookups panel-scoped (`container.querySelector`), all names through `escHtml`, dates via `bizDate()`. No writes anywhere in the section except the switch button.

---

## 7. Traceability — the words on every pay line

The owner's standing complaint is not being able to tell where a number came from. Every line must say WHY statutory was or was not taken, in plain words. Forbidden vocabulary anywhere user-visible: **compute, verify, disburse, delta, reconciliation, draft, run, Type A, Type B.**

### 7.1 Frozen onto the line (both engines)
- `line.employmentStatus` — the raw stored value (`''` when absent).
- `line.statutoryBasis` — the sentence (`plan.words`, `''` when nothing to say).
- `line.statusFlag` — `plan.flag` (`null` or `{kind, words}`).

Frozen at build time so the words describe what the maths actually did, survive on stored lines, and never get recomputed against a later status edit.

### 7.2 Exact copy (verbatim; `{Status}` = the `employmentStatusMeta` label)
- Rule applied (rows 8–9), `words`: **"No SSS, PhilHealth or Pag-IBIG — employment status is {Status}. Status is set on their HR record."**
- `status-unset` flag words: **"Employment status is not set on their HR record. Government deductions are unchanged until it is set."**
- `status-unknown`: **"Employment status '{raw}' is not one the system knows. Government deductions are unchanged."**
- `status-ended`: **"Employment status is {Status} — this looks like a final pay. Government deductions are unchanged."**
- `typed-on-nonregular`: **"Status is {Status}, but SSS / PhilHealth / Pag-IBIG amounts are set by hand on their record — hand-set amounts win. Clear them on their HR record if nothing should be taken."**
- `regular-unconfigured` (weekly only): **"Status is Regular, but no government deductions are set up on their record — nothing is being taken. Set them up on their HR record if they should contribute."**

### 7.3 Where the words render
- **js/payroll.js `PC.normalizeLine`** (both the week and month branches): copy `statutoryBasis` → `row.detail.statutoryBasis`, `statusFlag` → `row.statusFlag`, `employmentStatus` → `row.detail.employmentStatus`.
- **js/payroll.js `PC.breakdownOf`**: after the four statutory money rows, when `row.detail.statutoryBasis` is non-empty push `info('Government deductions', row.detail.statutoryBasis)`. The phone card then shows the reason with the numbers, automatically.
- **js/screens/payroll.js** (⚠ concurrently edited — anchor by function name, keep edits additive):
  - `_pyRead`: pass through `statusFlag` and `detail.statutoryBasis` from the normalised line onto the read shape.
  - `_pyProblems`: for each line whose `statusFlag` is non-null, add a problem sentence — the flag's `words`, prefixed with the person's name — with a **Fix** that opens `window.openEmployeeProfile({uid|workerId, name})` (their HR record). `status-unset`, `status-unknown` and `regular-unconfigured` render as warnings; `status-ended` and `typed-on-nonregular` as notes. These sentences appear only when the lines carry flags, i.e. only when the switch is on (§5.2) — the report is the pre-adoption surface.
  - `_pyPersonCard`: when the line has `statutoryBasis` words, show them as a small muted note on the card (beside/below the existing HR-record button from `_pyHrRecordBtn`). No new buttons; the HR link already exists.

### 7.4 Editing stays in HR
Employment status remains editable ONLY in `_epOpenEditor` (employee profile, js/screens/employee-profile.js). The payroll screen gets links (Fix → `openEmployeeProfile`), never an editor. Do not add a status field to any payroll panel. Also: never write `employmentStatus` onto `payroll/{uid}` — `fetchUsersWithPayroll` merges payroll over users, so a stray copy there would shadow the real one.

---

## 8. File-by-file changes

1. **NEW `js/statutory-status.js`** — §5 in full (rule map, `statutoryStatusPlan`, `statutoryStatusRuleOn`, UMD shim, `module.exports = { STATUTORY_STATUS_RULE, statutoryStatusPlan }`). `var`/`function` at file scope only.

2. **`index.html`** — add `<script defer src="js/statutory-status.js"></script>` immediately after the `js/money-core.js` tag (~502), with a comment: must load before `js/payroll-weekly.js` and `js/departments.js` (its consumers). Load order is load-bearing in this app.

3. **`sw.js`** — add `'/js/statutory-status.js'` to `PRECACHE`. Do NOT hand-edit `CACHE_VER` — the pre-commit hook derives it from `APP_VERSION` on commit.

4. **`js/departments.js` — inside `window.buildPayRunLines` only** (both callers inherit; `computePayRun` untouched):
   - After the `periodExclusionsFor` read: `const statusRule = await window.statutoryStatusRuleOn();` (throws on failure — same refusal stance as the exclusions read beside it).
   - In the per-employee map, after `empEff` is built and BEFORE `computePayLine`:
     ```
     const plan = window.statutoryStatusPlan(empEff, statusRule.on, { engine: 'month' });
     const empForPay = plan.active ? { ...empEff, statConfig: plan.statConfig } : empEff;
     ```
     and pass `empForPay` to `computePayLine`.
   - After the line is built (beside the existing WS39 statutory-ID freezing): set `line.employmentStatus`, `line.statutoryBasis`, `line.statusFlag` from the plan.
   - Push each non-null `plan.flag.words` (name-prefixed) into the returned `warnings` array so the live view surfaces them; the stored path needs nothing extra — the screen derives problems from the frozen line fields.

5. **`js/payroll-weekly.js` — inside `WeeklyRun.buildLines`**:
   - Read the switch once near the top (same `statutoryStatusRuleOn()` call, same throw-on-failure).
   - Per worker `p`, before the statutory block: `const plan = window.statutoryStatusPlan(p, statusRule.on, { engine: 'week' });`.
   - **Do not alter what is passed to `resolveStatutoryWeekly`** — derived `'exempt'` is numerically identical to the unconfigured path there (§4), and passing a derived config would trip the `configured:true` branch and emit misleading "configured for statutory deductions" warnings for trainees. Explicit worker configs keep working exactly as today.
   - After the line is assembled: set `line.employmentStatus`, `line.statutoryBasis`, `line.statusFlag`; push flag words into `warnings` (the weekly engine already has the array).

6. **`js/payroll.js`** — `PC.normalizeLine` + `PC.breakdownOf` per §7.3. (This file is NOT the concurrently-edited one.)

7. **`js/screens/payroll.js`** (⚠ concurrent — function-name anchors, additive only): `_pyRead`, `_pyProblems`, `_pyPersonCard` per §7.3.

8. **`js/screens/statutory-rates.js`** — §6 report + switch (`renderStatutoryStatusSection`, called from `renderStatutoryRatesTab`).

9. **Lockstep secondary surfaces** (previews/prefills that call `resolveStatutoryEE` or read `statConfig` directly — a preview that contradicts the pay period is the drift the 2026-08-06 spec eliminated):
   - `js/screens/hr.js` `renderPayrollManagement` (~1684): believed unreachable (index.html ~561 says it is superseded; hr.js ~98–111 says no caller remains). **Verify with a caller grep.** If truly unreachable, leave it. If reachable, apply the plan before its `resolveStatutoryEE` call, switch-gated.
   - `js/screens/dashboards.js`: the payslip prefill that copies `statConfig` off the merged payroll doc (~2514 region) and the one inside `openWorkerProfilePanel` (~3392 region). When the switch is on, run the emp/profile through `statutoryStatusPlan` before prefilling so a hand-made payslip's suggested SSS/PhilHealth/Pag-IBIG cannot contradict the pay period. Human-editable fields; numbers-only change, no new copy.

10. **NEW `tests/statutory-status.test.mjs`** — §9.

11. **No `firestore.rules` change** (settings doc already President-write / staff-read). **No composite indexes** (all reads are whole-collection or single-doc). **No data migration** — nothing is backfilled or rewritten; the only new write anywhere is the switch doc.

### Rollout order (one commit is fine, but the sequence inside it matters)
Ship everything with the switch doc **absent** (= off): behaviour is byte-identical everywhere, and the report is live. HR fills in statuses via employee profiles at their own pace; the owner reads "Who changes"; the President turns the switch on; the next time a period's figures are worked out, the rule applies. Already-paid and checked periods are untouched (the existing state gates prevent rebuilding them).

**Known limitation (state in the report caption):** `employmentStatus` has no history. A backfilled or re-opened old period uses the status as it is TODAY. The basis words frozen on each line record what was actually applied, which is the honest trail.

---

## 9. New pinned tests — `tests/statutory-status.test.mjs`

Node `node:test`, requiring `js/statutory-status.js` and `js/money-core.js` directly (both carry the UMD shim). All existing test files are untouched and must still pass unmodified.

Shared fixture: `STAT = { ee:{sss:100, philhealth:200, pagibig:50, tax:300}, er:{sss:150, philhealth:200, pagibig:50} }` (a stand-in `computeStatutory` result — synthetic, not real rates).

Plan tests (pure):
1. **regular, no config, enabled** → `active:false`, `statConfig:null`, `perKey` all `'legacy'` (tax `'legacy'`), `flag:null`, `words:''`.
2. **probationary, no config, enabled** → `active:true`, `statConfig` deep-equals `{sss:'exempt', philhealth:'exempt', pagibig:'exempt'}` (NO `tax` key), `perKey` `{sss:'status', philhealth:'status', pagibig:'status', tax:'legacy'}`, `words` = the §7.2 rule-applied sentence, `flag:null`.
3. **training, no config, enabled:false** → `active:false`, `flag:null`, `words:''` (suppression when off).
4. **probationary, typed `sss:120`, enabled** → `perKey.sss:'typed'`, `statConfig` = `{philhealth:'exempt', pagibig:'exempt'}` only, `flag.kind:'typed-on-nonregular'`.
5. **probationary, explicit `statConfig:{sss:'auto'}`, enabled** → `perKey.sss:'person'`, sss preserved as `'auto'` in the effective map, philhealth/pagibig `'status'` → `'exempt'`, `flag.kind:'typed-on-nonregular'` (an explicit non-exempt mode on a non-regular person).
6. **status `''`, enabled** → `active:false`, `flag.kind:'status-unset'`.
7. **status `'Contractual'`, enabled** → `active:false`, `flag.kind:'status-unknown'`.
8. **terminated, enabled** → `active:false`, `flag.kind:'status-ended'`.
9. **status `'  REGULAR '` (whitespace/case), enabled** → normalizes to regular, `active:false` (mirror of employmentStatusMeta's normalization).
10. **regular, no config, `{engine:'week'}`, enabled** → `flag.kind:'regular-unconfigured'`; same person with `statConfig:{sss:'auto'}` → `flag:null`.

Money pinning (plan × frozen resolver — the end-to-end truth table):
11. Row 8/9: `resolveStatutoryEE({...empProbationary, statConfig: plan.statConfig}, STAT)` → exactly `{sss:0, philhealth:0, pagibig:0, tax:300, er:{sss:0, philhealth:0, pagibig:0}}`.
12. Row 4 control: regular/no-config emp passed UNCHANGED → exactly `{sss:100, philhealth:200, pagibig:50, tax:300, er:{sss:150, philhealth:200, pagibig:50}}` (byte-identical legacy).
13. Row 10: probationary + typed `sss:120` with plan's partial map → `{sss:120, philhealth:0, pagibig:0, tax:300, er:{sss:150, philhealth:0, pagibig:0}}` (typed wins; its ER stays table-computed; derived keys zero both shares).
14. Pinned-quirk preservation: regular with typed `sss:0`, plan inactive, emp unchanged → `sss:100` (typed 0 still falls through to the table — the money-core quirk is untouched).
15. Weekly no-op: `resolveStatutoryWeekly(profileNoConfig, {isLastPayWeek:true, table:STAT})` deep-equals the same call today (all zeros, `configured:false`) — i.e. the weekly integration adds words only, never numbers.

---

## 10. Decisions that belong to the owner — DO NOT GUESS THESE

Surface all four in the report's captions and in the handoff; the defaults below are what ships until he answers.

1. **Final pay (resigned / terminated).** Should a final pay carry SSS/PhilHealth/Pag-IBIG? Default until ruled: **unchanged** (keep deducting as before), with the "final pay" words on the line. The remittance-safe direction; changing it is a one-line edit to `STATUTORY_STATUS_RULE` plus copy.
2. **Withholding tax for non-regular staff.** The ruling covered the three contributions only. Tax is deliberately untouched (§3.3). Does he want tax to follow status too? (Accountant question.)
3. **Legal confirmation.** Whether Training/Probationary staff may be excluded from SSS/PhilHealth/Pag-IBIG coverage at all is for his accountant. The system implements his rule and shows its work; this spec asserts nothing about Philippine law, in either direction.
4. **Regular Operations workers with no statutory setup.** The rule never auto-enrols (§3.2). The report names them and says nothing is being deducted. Should HR set them all up? Needs their government numbers on file first.
5. *(Minor)* Confirm `training` is meant to be treated like `probationary` — the ruling literally defines when statutory IS considered (regular); this spec reads both explicit non-regular working statuses as "not considered".

---

## 11. Verification checklist (measurable, in order)

1. `node --test tests/` — every pre-existing test file passes UNMODIFIED (257 pinned), and `tests/statutory-status.test.mjs` adds 15 passing tests with the §9 expected values.
2. `git diff js/money-core.js` is empty. `git diff js/statutory-tables.js` is empty. `git diff firestore.rules` is empty.
3. Grep gate — `grep -nE "compute|verify|disburse|delta|reconcil|draft|\brun\b|Type A|Type B"` over every NEW user-visible string added by this change (the §6/§7 copy) returns nothing. (Code identifiers are exempt; strings are not.)
4. Switch-off equivalence: with `settings/payrollStatutoryStatus` absent, open the payroll screen for the current Office month and current Operations week — every figure matches the pre-change build (spot-check one person per team against a pre-change screenshot or the stored frozen lines). No status sentences appear anywhere on the roster.
5. Report before adoption: Gov Rates screen shows the new section with the switch OFF; "Who changes" lists exactly the people matching truth-table rows 8–9 and nobody else; every flagged person's link opens their employee profile.
6. Switch write: as President, "Turn this on" writes the §5.3 doc (verify fields in console) and `logAudit` records it; as Finance, the button is disabled/read-only; the write is refused by rules if forced.
7. Rule live, Office: set a test user's status to Probationary (via the employee profile editor, nowhere else), open the current month — their SSS/PhilHealth/Pag-IBIG show ₱0.00, tax unchanged, and the card/breakdown shows the §7.2 rule-applied sentence verbatim. The period totals drop by exactly the three zeroed amounts.
8. Rule live, precedence: give that user `statConfig.sss:'auto'` — SSS returns to the table amount while PhilHealth/Pag-IBIG stay ₱0.00, and the `typed-on-nonregular` note appears.
9. Rule live, unset: a user with no status shows UNCHANGED deductions plus the `status-unset` problem sentence with a working Fix link to their HR record.
10. Rule live, Operations: a Regular worker with no statutory setup shows the `regular-unconfigured` sentence and zero statutory (unchanged); a worker with an explicit config deducts exactly as before on the month's last pay week; no trainee's weekly numbers moved.
11. Switch-read failure path: temporarily block the settings read (offline devtools) and open a period — the screen shows the named error with Retry, never an empty roster and never silently-off behaviour.
12. Delivery: `js/statutory-status.js` present in index.html (after money-core, before payroll-weekly/departments) AND in sw.js `PRECACHE`; commit bumps `APP_VERSION`/`CACHE_VER` via the hook; after deploy, a real device shows the new version string before any behaviour is judged (deploy-pipeline memory).
13. Escaping/scoping: every name rendered by the new report/roster copy goes through `escHtml`; every new DOM lookup is panel-/container-scoped; no new top-level `const` in any classic script (`grep -n "^const\|^let" js/statutory-status.js` is empty).
