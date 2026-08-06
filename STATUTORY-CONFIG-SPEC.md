# STATUTORY-CONFIG-SPEC.md — Per-Employee Statutory Contribution Modes (Auto / Fixed / Exempt)

**Status:** SPEC — ready to implement. **This is money math.** Every claim below is grounded in
current code (line refs as of 2026-08-06, working tree at `f571b1c`+). The feature ships **opt-in**:
with no config set, every existing employee and worker computes **byte-identically** to today
(proof in §3.3 and §8). `js/money-core.js` is frozen code with pinned tests
(`tests/money.test.mjs`, run by `.github/workflows/ci.yml` job `money-math-tests`); the one edit it
receives is specified verbatim in §3.2 and keeps every existing test green.

**Owner request (verbatim):** *"allow to edit those statutory contributions, that we can opt not to
deduct. currently someone does it manually each employee."*

**Owner clarification (2026-08-06, verbatim):** *"its 0 but theyre not regular employees so we dont
pay yet"* — the zero statutory on Type B weekly payslips is **correct for the business today**:
production workers are not yet regularised, so SSS / PhilHealth / Pag-IBIG are genuinely not due for
them. The Type B default therefore **stays zero**. The feature is **the explicit switch** — a
per-person setting that says "exempt" (most Type B workers today), "auto from the tables" (Type A
today, and a Type B worker once regularised), or "fixed amount" — instead of someone re-typing the
same numbers per employee per period.

Scale: ~5 Type A employees, 5–10 Type B workers. This is a small-business feature: one map field,
one resolver function, two existing forms grow a mode selector. No config system, no rules engine.

---

## 0. Current behaviour (verified — read before touching anything)

Two payroll paths, failing in opposite directions:

**Type A (regular, monthly, keyed by uid).** `payroll/{uid}` → `window.computePayLine`
(js/money-core.js:51). Statutory at js/money-core.js:73–80:

```js
  const stat = window.computeStatutory
    ? window.computeStatutory({ grossPay: gross, year: statYear })
    : null;
  const sss        = emp.sss        || (stat ? stat.ee.sss : 0);
  const philhealth = emp.philhealth || (stat ? stat.ee.philhealth : 0);
  const pagibig    = emp.pagibig    || (stat ? stat.ee.pagibig : 0);
  const tax        = emp.tax        || (stat ? stat.ee.tax : 0);
  const er         = stat ? stat.er : { sss:0, philhealth:0, pagibig:0 };
```

Because of `||`, a hand-typed **0 falls through to the table** — opting out is impossible on this
path. This exact quirk is PINNED by tests/money.test.mjs:283 (*"quirk (pinned, not fixed): an
explicit emp.sss of 0 does NOT override the table"*) with the instruction: *"Do not 'fix' this test
to assert zeros without also fixing computePayLine's `||` checks."* This spec is that fix — done in
a way that leaves the pinned test **untouched and passing** (the quirk remains the documented
behaviour of the legacy/no-config state; the new `exempt` mode is the sanctioned way to get a real
zero).

The same `||` logic is **duplicated** in the roster live-preview (js/screens/hr.js:1169–1173) and
implicitly in the Edit Payroll modal's placeholder/audit logic (hr.js:1253, 1381–1387, 1483–1491).
Any precedence change must update those in lockstep or the preview will contradict Compute.

**Type B (production, weekly, keyed by worker_profiles doc id).** The weekly generator
`openPayslipGenerator` (js/screens/hr.js:3004) renders `<input id="ps-sss" type="number" value="0">`
etc. (hr.js:3076–3078, tax at 3087), read back by `collectPayslipData` (hr.js:3437–3442), stored as
`deductions.govt` (hr.js:3491–3494), `employerShare: null` (hr.js:3495 — v12 WS24 decision 3,
weekly ER manual-only). **No table lookup anywhere on this path** — and per the owner, that zero is
currently correct. The pain is that when a deduction IS due, someone types it by hand, per worker,
per week, with nothing remembering the decision.

`window.computeStatutory({grossPay, year})` (js/statutory-tables.js:47) is written for a **monthly**
gross (SSS MSC brackets, PhilHealth floor/ceiling, monthly TRAIN withholding rows). Every number in
`STATUTORY[2026]` is a PLACEHOLDER with `verified:false`; the D10 gate (js/departments.js:1870–1879)
blocks Type A **Disburse** until an accountant flips `verified:true`. There is no equivalent gate on
the Type B path (it never touches the tables today).

---

## 1. The config field: `statConfig`

One optional map field, same shape on both doc types:

```
statConfig: {
  sss:        'auto' | 'fixed' | 'exempt',   // key ABSENT = legacy behaviour
  philhealth: 'auto' | 'fixed' | 'exempt',
  pagibig:    'auto' | 'fixed' | 'exempt',
  tax:        'auto' | 'fixed' | 'exempt',
}
```

- **Values are plain strings** (modes). Fixed **amounts** live in the existing flat number fields —
  `sss` / `philhealth` / `pagibig` / `tax` — the same fields the Edit Payroll modal already writes
  on `payroll/{uid}` (hr.js:1466–1469). worker_profiles gains the same four flat number fields
  (they don't exist there today; no name clash — the gov-ID strings are `ssNum`/`phNum`/
  `pagibigNum`/`tinNum`). One source of truth per amount; `statConfig` stores only intent.
- **Absence of the field, or of a per-type key, = today's exact behaviour.** Type A: typed-non-zero
  wins, else table. Type B: nothing prefilled, HR types (or leaves 0).
- Per contribution type, not all-or-nothing — an employee can be `sss:'exempt'` while
  `tax:'auto'`.

**Where it lives and why:**

| Path | Doc | Why |
|---|---|---|
| Type A | `payroll/{uid}.statConfig` | All live pay fields already live here (salary/allowance/sss/…, firestore.rules:814–818: owner+finance read, `isMoneyAdmin()` write). `fetchUsersWithPayroll` (js/config.js:653) merges it onto the emp object every caller of `computePayLine` already passes, and `loadUserProfile` (js/app.js:918) merges it onto `window.userProfile` — so the config flows to the engine, roster preview, and the employee's own projection with zero new plumbing. |
| Type B | `worker_profiles/{id}.statConfig` (+ flat `sss`/`philhealth`/`pagibig`/`tax` numbers) | Same doc that holds rates, allowances, CA balance, and gov IDs (firestore.rules:1635–1642: finance/admin write, linkedUid self-read). The generator already receives the whole `profile` object. |

**Firestore rules: NO change.** Rules on both docs gate whole-doc writes by role and do not
enumerate fields; a new map field on `payroll/{uid}` (isMoneyAdmin write) and on
`worker_profiles/{id}` (isFinanceOrAdmin write) is already covered. The linkedUid self-read on
worker_profiles exposes the worker's own modes to that worker — acceptable (it's their own
deduction status; rates are already visible on the same doc). **firestore.indexes.json: NO change**
(§5's month-to-date query reuses the existing `payslips` composite `workerId ASC,
payPeriodStart ASC`, firestore.indexes.json:76–83). **No new collections** → no
`scripts/check-backup-coverage.js` change.

---

## 2. The precedence rule (normative)

For each contribution type `k` in {sss, philhealth, pagibig, tax}, with `stat` = the
`computeStatutory` result (or null):

1. `statConfig[k] === 'exempt'` → EE amount **0**. ER share for that agency **0** (§6).
2. `statConfig[k] === 'fixed'` → EE amount = flat field `emp[k] || 0` (a typed 0 under `fixed`
   really is 0). ER share stays table-computed (never hand-typed — unchanged rule).
3. `statConfig[k] === 'auto'` → EE amount = `stat ? stat.ee[k] : 0`, **even when a stale typed
   amount is present**. ER = table.
4. key absent / any other value → **legacy, byte-for-byte**: `emp[k] || (stat ? stat.ee[k] : 0)`;
   ER = table. (The pinned typed-0-falls-through quirk lives here, on purpose.)

Written short: **exempt > fixed > auto > legacy-fallthrough**, resolved per type.

---

## 3. The money-core edit

### 3.1 New pure function (added to js/money-core.js, between `vatSplit` and `computePayLine`)

```js
// ---- statutory-config spec (2026-08-06) — per-type EE/ER resolution -------
// Pure; no DOM, no Firestore, no clock (file contract, header above).
// `emp` optionally carries statConfig ({sss|philhealth|pagibig|tax:
// 'auto'|'fixed'|'exempt'}) plus the legacy flat amount fields (emp.sss …).
// `stat` is a computeStatutory() result or null.
// ABSENT statConfig (or an absent per-type key) reproduces the legacy
// `typed || table` fallthrough BYTE-FOR-BYTE — including the pinned quirk
// that a hand-typed 0 falls through to the table (tests/money.test.mjs
// "quirk (pinned, not fixed)"). Precedence when a mode IS set:
// exempt > fixed > auto.
//   'exempt' -> 0; the ER share for that agency is also 0 (no obligation —
//               an exempt person is simply not on that agency's remittance).
//   'fixed'  -> the flat amount field (0 when empty); ER stays table-computed
//               (er is never hand-typed — unchanged WS21 rule).
//   'auto'   -> the table value, even when a stale typed amount is present.
window.resolveStatutoryEE = function(emp, stat) {
  const cfg = (emp && emp.statConfig) || {};
  const ee = (k) => {
    const mode = cfg[k];
    if (mode === 'exempt') return 0;
    if (mode === 'fixed')  return emp[k] || 0;
    if (mode === 'auto')   return stat ? stat.ee[k] : 0;
    return emp[k] || (stat ? stat.ee[k] : 0); // legacy — unchanged
  };
  const er = (k) => (cfg[k] === 'exempt') ? 0 : (stat ? stat.er[k] : 0);
  return {
    sss: ee('sss'), philhealth: ee('philhealth'),
    pagibig: ee('pagibig'), tax: ee('tax'),
    er: { sss: er('sss'), philhealth: er('philhealth'), pagibig: er('pagibig') }
  };
};
```

Export it in the trailing `module.exports` block (money-core.js:360–369):
add `resolveStatutoryEE: window.resolveStatutoryEE,`.

### 3.2 The edit inside `computePayLine` — exact before/after

**BEFORE** (js/money-core.js:76–80):

```js
  const sss        = emp.sss        || (stat ? stat.ee.sss : 0);
  const philhealth = emp.philhealth || (stat ? stat.ee.philhealth : 0);
  const pagibig    = emp.pagibig    || (stat ? stat.ee.pagibig : 0);
  const tax        = emp.tax        || (stat ? stat.ee.tax : 0);
  const er         = stat ? stat.er : { sss:0, philhealth:0, pagibig:0 };
```

**AFTER:**

```js
  // Statutory-config spec (2026-08-06) — the second permitted edit to this
  // frozen function (after §A4). resolveStatutoryEE (above) reproduces the
  // old five lines byte-for-byte whenever emp.statConfig is absent — every
  // existing payroll/{uid} doc, every pinned test, every call site that
  // predates statConfig computes identically. New modes: exempt (a real 0,
  // EE and ER), fixed (typed amount wins even at 0), auto (table always).
  const { sss, philhealth, pagibig, tax, er } = window.resolveStatutoryEE(emp, stat);
```

Lines 73–75 (the `stat` lookup) and everything after line 80 (`statutoryTotal`, perfFactor, CA,
netBeforeCA, finalPay, effectiveGross, the return object) are **untouched**.

### 3.3 Backward-compatibility proof

- With `statConfig` absent, `cfg = {}` → every `ee(k)` takes the final branch, which is the exact
  legacy expression; `er(k)` returns `stat ? stat.er[k] : 0`, value-identical to the old
  `stat ? stat.er : {sss:0,…}` (note: the old code returned **the same object reference** as
  `stat.er`; the new code returns a fresh object with equal values — no caller mutates `line.er`
  (grep: readers only — departments.js:1926/2024–2026/2067, hr.js:3520/3577, bir.js:533), and every
  pinned assertion is `assert.deepEqual`, so this is invisible).
- Every existing test in tests/money.test.mjs passes unchanged, including the quirk pin at :283 and
  the two full-line deepEquals at :210 and :773 — none of their fixtures carry `statConfig`.
- Existing `payroll/{uid}` docs have no `statConfig` field → Compute produces identical lines.
  Frozen `pay_runs` lines, `salary_history` mirrors, and saved `payslips` docs are stored data —
  never recomputed by this change (and `computePayRun` refuses to touch verified/disbursing/
  disbursed runs, departments.js:1752–1754; disbursed docs stay frozen forever).

---

## 4. Type A UI — Edit Payroll modal (js/screens/hr.js)

### 4.1 Mode selectors

Replace the four statutory form-groups (hr.js:1381–1387) with mode-select + amount pairs. Exact
markup pattern (SSS shown; repeat for PhilHealth `ep-ph`/`ep-ph-mode`, Pag-IBIG `ep-pi`/
`ep-pi-mode`, Tax `ep-tax`/`ep-tax-mode`, with `sug.ee.philhealth` / `sug.ee.pagibig` /
`sug.ee.tax` in the placeholders):

```html
<div class="form-group"><label>SSS${unverifiedBadge}</label>
  <div style="display:flex;gap:6px">
    <select id="ep-sss-mode" style="flex:none;width:112px;padding:8px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)">
      <option value="default" ${_scOf('sss')==='default'?'selected':''}>Default</option>
      <option value="auto"    ${_scOf('sss')==='auto'?'selected':''}>Auto (table)</option>
      <option value="fixed"   ${_scOf('sss')==='fixed'?'selected':''}>Fixed ₱</option>
      <option value="exempt"  ${_scOf('sss')==='exempt'?'selected':''}>Exempt</option>
    </select>
    <input id="ep-sss" type="number" value="${emp.sss||0}" placeholder="Computed: ₱${sug?fmt(sug.ee.sss):'0.00'}" inputmode="decimal" style="flex:1"/>
  </div>
</div>
```

with, once, above the four rows (helper defined in the handler closure):

```js
const _scOf = (k) => (emp.statConfig && ['auto','fixed','exempt'].includes(emp.statConfig[k])) ? emp.statConfig[k] : 'default';
```

and one explanatory line under the Tax row (exact copy):

```html
<div style="font-size:11px;color:var(--text-muted);margin-top:4px">
  <strong>Default</strong> = a typed amount wins; a typed ₱0 falls back to the table (old behaviour).
  <strong>Auto</strong> = always the table amount for the run month.
  <strong>Fixed</strong> = always the typed amount, even ₱0.
  <strong>Exempt</strong> = do not deduct — the employer share for that item is dropped too, and the
  employee is left off that agency's remittance.
</div>
```

Wiring (after the markup lands, alongside the existing listeners at hr.js:1438+): a
`_epSyncStatInputs()` that, per pair, sets `input.disabled = (mode==='auto'||mode==='exempt')` and,
for `exempt`, shows `₱0.00` via `input.value` left as-is but disabled (value is inert in those
modes — the resolver ignores it). Bind it on each select's `change` and run once.

### 4.2 Save

In the `save-ep-btn` handler's `db.collection('payroll').doc(uid).set({...}, {merge:true})`
(hr.js:1462–1477), add:

```js
            statConfig: (() => {
              const m = {};
              [['sss','ep-sss-mode'],['philhealth','ep-ph-mode'],['pagibig','ep-pi-mode'],['tax','ep-tax-mode']]
                .forEach(([k, elId]) => {
                  const v = document.getElementById(elId)?.value;
                  // 'default' must mean ABSENT (legacy) — delete the key so the
                  // resolver's no-config branch runs, not a stale mode.
                  m[k] = (v === 'auto' || v === 'fixed' || v === 'exempt')
                    ? v : firebase.firestore.FieldValue.delete();
                });
              return m;
            })(),
```

(`FieldValue.delete()` inside a map under `set(..., {merge:true})` removes just that key; four
deletes leave an empty map `{}` — the resolver treats `{}` and absent identically, so no cleanup
pass is needed.)

Audit (hr.js:1483–1491): keep the existing `statutory-override` divergence log but **skip keys whose
mode is `auto` or `exempt`** (the typed amount is inert there — logging divergence would be noise).
Add one new audit write when any mode changed:
`window.logAudit && window.logAudit('statutory-config','payroll',uid,{ before: emp.statConfig||{}, after: <the non-delete entries of m> })`.

### 4.3 Roster live-preview — keep it honest

Replace hr.js:1170–1173 (the duplicated `||` block) with the shared resolver so preview == engine:

```js
      const _r       = window.resolveStatutoryEE(u, sug);
      const sss      = _r.sss;
      const ph       = _r.philhealth;
      const pagibig  = _r.pagibig;
      const tax      = _r.tax;
```

(`sug` on the line above stays as-is.) Without this edit, an exempt employee would show table
deductions in the roster but zero after Compute — the exact preview/engine drift this codebase
fights everywhere.

---

## 5. Type B — Worker Profile config + generator prefill

**Default unchanged and zero.** Per the owner: Type B workers are not regularised; nothing is due.
With no `statConfig` on a `worker_profiles` doc, the generator renders and behaves **byte-identically
to today** (inputs start at 0, nothing computed, `employerShare: null`). Every change in this
section is inside `if (profile.statConfig && Object.keys(profile.statConfig).length)` guards or is
provably inert when the field is absent.

### 5.1 Worker Profile form (openHRProfileForm, js/screens/hr.js:2275)

Insert one block after the Pag-IBIG/TIN row (hr.js:2341), before Address. Exact copy:

```html
<div style="margin:4px 0 12px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface2,var(--surface))">
  <label style="font-weight:600">Statutory Deductions (SSS / PhilHealth / Pag-IBIG / Tax)</label>
  <div style="font-size:11px;color:var(--text-muted);margin:4px 0 8px">
    Default: <strong>not deducted</strong> — today's behaviour for workers who are not yet
    regularised. When a worker regularises, switch each item to <strong>Auto</strong> (monthly table
    amount, deducted once a month on the month's last payslip) or <strong>Fixed</strong> (a set
    monthly ₱ amount, same once-a-month timing). Amounts stay editable on every payslip.
  </div>
  <!-- four rows; k in sss|ph|pib|tax, label in SSS|PhilHealth|Pag-IBIG|Tax -->
  <div class="form-row">
    <div class="form-group"><label>SSS</label>
      <select id="hrp-stat-sss-mode">
        <option value="default">Default — not deducted</option>
        <option value="auto">Auto — monthly table</option>
        <option value="fixed">Fixed monthly ₱</option>
        <option value="exempt">Exempt — confirmed not due</option>
      </select>
    </div>
    <div class="form-group"><label>Fixed ₱ (if Fixed)</label><input id="hrp-stat-sss-amt" type="number" inputmode="decimal" value="${profile?.sss||0}"/></div>
  </div>
  <!-- …identical rows for hrp-stat-ph-* (profile?.philhealth), hrp-stat-pib-* (profile?.pagibig), hrp-stat-tax-* (profile?.tax) -->
</div>
```

(`selected` attributes from `profile?.statConfig?.[k]` exactly as §4.1's `_scOf` pattern. For
Type B, `default` and `exempt` both deduct nothing — `exempt` records that the decision was made
deliberately; `default` means "never configured". Behaviourally identical; keep both options.)

Save (`hrp-save-btn` handler's `data` object, hr.js:2442–2474) — add:

```js
      statConfig: /* same 4-key map + FieldValue.delete() pattern as §4.2,
                     from hrp-stat-{sss|ph|pib|tax}-mode */,
      sss:        parseFloat(document.getElementById('hrp-stat-sss-amt').value)||0,
      philhealth: parseFloat(document.getElementById('hrp-stat-ph-amt').value)||0,
      pagibig:    parseFloat(document.getElementById('hrp-stat-pib-amt').value)||0,
      tax:        parseFloat(document.getElementById('hrp-stat-tax-amt').value)||0,
```

(The flat numbers are harmless on unconfigured profiles — nothing reads them until a mode is
`fixed`.) Add the same `statutory-config` audit write as §4.2 (subject `worker_profiles`).

### 5.2 Weekly cadence — the accounting rule (settle with the accountant BEFORE the first worker is switched to auto)

SSS / PhilHealth / Pag-IBIG are **monthly** obligations with **monthly** brackets;
`computeStatutory` expects a monthly gross. A Type B worker is paid weekly. Options:

| # | Rule | Worker experience | Remittance consequence |
|---|---|---|---|
| **A (recommended)** | Deduct the **full monthly amount once per month, on the month's last weekly payslip**. Bracket keyed on the month's real gross: sum of this worker's already-saved payslips for the month + the current form's gross. | One lighter week per month ("kaltas tuwing katapusan" — familiar practice in PH small shops). | Deducted total == the monthly bracket amount on the real monthly gross. Reconciles 1:1 with the SSS/PhilHealth/Pag-IBIG monthly schedules. No true-up ever needed. |
| B | Estimate the monthly amount, divide across the month's pay weeks, true-up on the last week. | Smoother weekly net. | Same end total as A, but requires an estimate + correction mechanism; drift when hours vary; four writes instead of one to audit. Over-engineered for 5–10 workers. |
| C | Weekly gross × 4.33 → bracket → ÷ weeks, never trued up. | Smooth. | Deducted total ≠ bracket on actual monthly gross whenever hours vary — chronic over/under-remittance. Reject. |
| D | Pro-rate by hours. | — | No legal basis in bracket tables. Reject. |

**Recommendation: A.** Exact monthly bracket on exact monthly gross, one deduction event, trivial
to eyeball. **This is the OWNER'S decision to confirm with his accountant** — it changes what a
regularised worker takes home in the last week of each month. It only matters once at least one
Type B worker is switched to auto/fixed; until then it's dormant.

Withholding tax: the app has only the **monthly** TRAIN table. Under rule A, tax is computed on the
same monthly-aggregate gross on the same last-week payslip. BIR publishes separate weekly
withholding columns — whether monthly-aggregate withholding is acceptable for weekly-paid
regularised workers is an accountant question (§10). In practice a production worker's monthly
gross is likely under the ₱20,833 zero bracket, making tax ₱0 either way.

**Fixed mode is a monthly amount** on the same last-week cadence (it's a monthly obligation; a
"fixed weekly" reading would 4×-over-deduct). The UI copy in §5.1 says this explicitly.

### 5.3 Generator prefill (openPayslipGenerator, js/screens/hr.js:3004)

All inside one guarded block added after the initial `recomputeHours()` call (hr.js:3172). When
`profile.statConfig` is absent/empty, **none of this runs** — DOM and behaviour byte-identical.

1. **Last-pay-week detection** (pure, reuses the function's own `addDays`):
   `const isLastPayWeekOfMonth = addDays(end, 7).slice(0,7) !== end.slice(0,7);` recomputed from
   the live `ps-end` input on its `change` event.
2. **Month-to-date gross** (one read, existing index `workerId+payPeriodStart`):
   ```js
   const mtdSnap = await db.collection('payslips')
     .where('workerId','==',profile.id)
     .where('payPeriodStart','>=', end.slice(0,7)+'-01')
     .where('payPeriodStart','<', end)
     .get().catch(()=>({docs:[]}));
   const mtdGross = mtdSnap.docs.reduce((s,d)=>s+(d.data().grossPay||0),0);
   ```
   Caveat (surface in a muted hint, not a blocker): a duplicate/wrong draft for the same month
   inflates `mtdGross` — HR deletes the bad draft first (existing `financeDelete` flow).
3. **Suggestion + prefill.** On every input that moves gross (`ps-rph, ps-hrs, ps-ot-rate,
   ps-ot-hrs, ps-meal, ps-transport, ps-rent`) and on `ps-end` change, recompute:
   `sug = window.computeStatutory({ grossPay: mtdGross + currentFormGross, year: parseInt(end.slice(0,4),10) })`
   then per key `k` → field (`sss→ps-sss, philhealth→ps-ph, pagibig→ps-pib, tax→ps-tax`):
   - mode `exempt` → set `0`, disable the input, title `"Exempt — configured on the worker profile"`.
   - mode `auto` → `isLastPayWeekOfMonth ? sug.ee[k] : 0`.
   - mode `fixed` → `isLastPayWeekOfMonth ? (profile[k]||0) : 0`.
   - key absent → **do not touch the field** (HR may still hand-type, exactly as today).
   Each prefill-managed field gets a `psStatEdited[k]` flag (mirror of the existing `foodEdited`
   pattern, hr.js:3114–3115): a manual `input` event sets it and stops further auto-overwrites for
   that field this session. Fields stay fully editable (that is the owner's "allow to edit").
4. **Hint line** under the Deductions grid (only when configured):
   - non-last week: `"Statutory is deducted once a month, on the month's last payslip (monthly brackets)."`
   - last week: `"Auto amounts use this month's total gross to date (₱{mtd+current}). Editable."`
   - plus, when `sug.unverified`: `"⚠ Statutory table for {year} is UNVERIFIED placeholder rates — have the accountant verify before relying on these amounts."` (Same convention as the Type A badge, hr.js:1254. There is deliberately no hard gate here: the fields are suggestions HR reviews, and nothing activates until the owner configures the worker — which §7 instructs him not to do before the table is verified.)
5. **Employer share (display/reporting only).** When at least one key is `auto` and it's the last
   pay week, write the ER suggestion into a hidden input the prefill block appends once:
   `<input type="hidden" id="ps-er-json">`, value
   `JSON.stringify({sss: cfg.sss==='auto'?sug.er.sss:0, philhealth: …, pagibig: …})` (0 for
   exempt/fixed/absent keys). Then in `collectPayslipData`, replace hr.js:3495:

   **BEFORE:** `employerShare: null, // v12 WS24 decision 3 — weekly ER manual-only for now; WS21/WS39 may populate later`

   **AFTER:**
   ```js
       // Statutory-config spec — ER carried from the generator's table
       // suggestion when the worker is configured 'auto' (display + 1601-C
       // only; the WPAY ledger leg still posts netPay and no ER expense —
       // weekly ER stays out of the books, exactly as WS24 decided). Absent
       // element (unconfigured worker / non-last week) -> null, unchanged.
       employerShare: (() => { try {
         const el = document.getElementById('ps-er-json');
         return el && el.value ? JSON.parse(el.value) : null;
       } catch(_) { return null; } })(),
   ```
   `toPayslipModel` (hr.js:3577) and the 1601-C `—†` cells (bir.js:542–543, 570–572) already read
   `employerShare` when present — zero further changes, the dagger footnote simply stops applying
   for configured-auto workers.

`openPayslipEdit` (hr.js:2926) is **not changed** — editing a saved payslip keeps editing stored
values, which is correct for historical docs.

---

## 6. Employer share (`er`) semantics

- **Type A, `exempt`**: `er[k] = 0` (resolver, §3.1). Consequences, all automatic and correct:
  the `PAY-{month}-{uid}-ER` expense debit shrinks or disappears (`erTotal`,
  departments.js:2067–2073), and the agency payable credits `SSSPAY-/PHPAY-/HDMFPAY-{month}`
  (departments.js:2024–2026, 2100–2102) exclude that person. Meaning: an exempt person is **not on
  that agency's remittance at all** — which is what exemption means. The ledger identity
  Σdebits == Σcredits holds because both sides drop together.
- **Type A, `fixed`**: ER stays table-computed (the "er is never hand-typed" rule, money-core.js
  comment at :58–60, pinned by tests/money.test.mjs:257). If the accountant wants ER to track a
  non-table EE figure, that's a remittance-side manual adjustment — out of scope, listed in §10.
- **Type A, `auto`/absent**: unchanged.
- **Type B**: ER remains **out of the ledger** (WS24 decision 3 — unchanged). §5.3(5) records the
  table ER on the payslip doc for auto-configured workers so the 1601-C worksheet shows a real
  EE/ER pair instead of `—†`; the accountant still executes the actual remittance manually.

---

## 7. Migration / rollout — nothing changes on deploy

Deploy is one push (pre-commit hook auto-bumps `APP_VERSION`/`CACHE_VER`; no new files → no sw.js
`PRECACHE` edit; no rules/indexes deploy needed). On day 0, no doc anywhere has `statConfig` →
every path takes the legacy branch (§3.3). Then, per person, whenever the owner decides:

**Exempt a Type A employee** (the request's "opt not to deduct" — usable immediately, no
accountant dependency, since it only ever produces zeros):
1. HR → Payroll → ✎ Edit Payroll → set SSS/PhilHealth/Pag-IBIG/Tax mode to **Exempt** → Save.
2. Roster preview now shows −₱0.00 for those items (same screen, instantly).
3. Verify one payslip: 🖨 print-slip projection for that employee — statutory lines ₱0, net up by
   exactly the old deduction. Compute (draft) when ready; Disburse is still D10-gated as always.

**Switch employees to Auto** (recommended end-state for Type A once tables are real): **only after**
the accountant loads verified rates and flips `STATUTORY[year].verified = true` (D10 blocks
Disburse until then regardless). Stale typed amounts stop mattering the moment mode is `auto` —
that is the "someone does it manually each employee" work disappearing.

**Regularise a Type B worker** (per-worker event, one at a time): HR → Worker Payslips → edit the
profile → set modes to Auto (or Fixed + amounts) → Save. From then on, that worker's last-of-month
payslip prefills; all other workers are untouched. Do this only after the accountant has (a)
verified the tables and (b) confirmed the §5.2 cadence.

**Verify one payslip before/after (per person flipped):** open the same employee's projection (or
the same worker's Preview — no save needed) immediately before and after changing modes; the only
lines that may differ are the four statutory items and the net. Screenshot both if the accountant
wants a record.

---

## 8. Verification

**Automated (must all pass before push):**
1. `node --test tests/*.test.mjs` — every existing test green, **zero edits to existing
   assertions** (the §3 edit is legacy-identical; this is the whole point).
2. New pins to ADD to tests/money.test.mjs (new `describe('resolveStatutoryEE + statConfig
   (statutory-config spec)')`):
   - Legacy identity: `computePayLine` on the :205 fixture with `statConfig: undefined` and with
     `statConfig: {}` → deepEqual the exact :210 pinned object.
   - Exempt-all: :205 fixture + `statConfig:{sss:'exempt',philhealth:'exempt',pagibig:'exempt',tax:'exempt'}`
     → sss/philhealth/pagibig/tax 0, `er: {sss:0,philhealth:0,pagibig:0}`, statutoryTotal 0,
     finalPay = 21500 (19650 + 1850).
   - Partial: only `sss:'exempt'` → sss 0 + er.sss 0, other three EXACTLY the :210 values.
   - Auto beats stale typed: the :245 fixture (salary 15000, typed 800/300/100/50) + all-auto →
     the placeholder-table values for gross 15000: `{sss:750, philhealth:375, pagibig:200, tax:0}`
     (= `computeStatutory({grossPay:15000, year:2026}).ee`; er stays the :258 pin
     `{sss:1500, philhealth:375, pagibig:200}`).
   - Fixed honours a typed 0: `statConfig:{sss:'fixed'}, sss:0` → sss 0 (the quirk, cured).
   - `resolveStatutoryEE` called directly with `stat:null` + mode 'auto' → 0 (no-table safety).
3. `node --check` passes on every edited js file (CI `syntax` job); `scripts/check-ui-wiring.js`
   passes (all new ids are created in the same template strings that look them up);
   `scripts/ci-invariants.sh` unaffected (no new files, CACHE_VER hook-managed).

**By hand (no way to test against production data — the owner/HR must eyeball):**
- Day 0 after deploy, BEFORE configuring anyone: HR → Payroll roster for the current month —
  identical figures to pre-deploy (screenshot before pushing). One Type A projection payslip —
  identical. Worker Payslips → Generate for one worker → all deduction fields still 0, no new
  hints, Preview identical.
- After the first exemption: that person's roster row and projection payslip only (see §7).
- After the first Type B auto worker: generate (Preview, don't save) a NON-last-week payslip →
  statutory 0 + the once-a-month hint; a last-week payslip → prefilled amounts equal to
  `computeStatutory` on the month's summed gross (check the sum against Payslip History by hand).

---

## 9. Blast radius

**Every `computePayLine` call site** (grep 2026-08-06) and what changes:

| Site | emp source | statConfig flows? | Effect |
|---|---|---|---|
| departments.js:1832 `computePayRun` | `fetchUsersWithPayroll` merge (config.js:653) | yes (spread at :1829 preserves it) | THE engine — new modes take effect at next Compute only. Verified/disbursed runs untouchable (:1752). |
| js/screens/dashboards.js:2431 (own-dashboard projection) | merged users cache (`dbCachedGet('users')` → fetchUsersWithPayroll, config.js:682) | yes | Projection matches engine. |
| js/screens/dashboards.js:2787 (`my-payslip-btn` projection) | `window.userProfile` (app.js:918 merges payroll doc) | yes | Matches engine. |
| js/screens/dashboards.js:3183 (team-profile preview) | hand-built `{salary,allowance,deductions}` from a dataset | **no** | Pre-existing divergence — this site already drops hand-typed statutory overrides too. Leave as-is; display-only rough projection. Do NOT "fix" in this pass. |
| js/screens/hr.js:1670 (Adjust-modal preview) | roster emp (merged) | yes | Matches engine. |
| js/screens/hr.js:1894 (print-slip projection) | roster emp (merged) | yes | Matches engine. |

**Manual mirrors that MUST be edited in lockstep** (else preview ≠ engine): roster preview
hr.js:1170–1173 (§4.3). The Edit Payroll modal's `sug` placeholders (:1381–1387) and audit
(:1483–1491) per §4.1/4.2.

**`deductions.govt` readers** (all read STORED payslip docs — unaffected for existing docs, correct
by construction for new ones): bir.js:539 (1601-C weekly rows), bir.js:655 (Alphalist weekly
aggregation), hr.js:2927 (openPayslipEdit), hr.js:3491–3494 (writer), hr.js:3575
(toPayslipModel weekly).

**What could regress, and why it doesn't:**
- *Ledger legs / disburse identity* (departments.js:1983–2130): exempt drops EE and ER together on
  both the debit and credit sides (§6); `statutoryTotal` is derived from the same four EE values,
  so `netCashAgg = effectiveGross − statutoryTotal − actualCa` stays balanced. Fixed/auto change
  nothing structurally.
- *D10 disburse gate* (departments.js:1870–1879): untouched; still blocks Type A disburse on
  unverified tables even for all-exempt runs (fine — exempt runs contain zeros either way).
- *YTD / payslip cards* (hr.js:3671–3691): sum stored `salary_history`/`payslips` values — reflect
  whatever was actually deducted. Correct.
- *13th month* (hr.js:3643): base-salary only, never statutory. Unaffected.
- *BIR 1601-C / Alphalist* (bir.js:511, 615): read stored docs; an exempt person shows ₱0 columns
  and, Type A, drops out of the agency aggregate legs — matching a person genuinely off the
  remittance. The unverified-table watermark logic (bir.js:565, 682) unchanged.
- *Weekly WPAY ledger leg* (hr.js:2851–2863): posts `netPay`. For a configured auto worker, the
  last-week netPay is smaller by the deduction — intended, and only for configured workers. No ER
  expense is booked on the weekly path (unchanged, §6).
- *Employee self-view*: `payroll/{uid}` is owner-readable (rules :815), so an employee can see
  their own modes via their merged profile — acceptable (it's their own deduction status).
- *OneDrive edit race*: hr.js is a shared hot file — per MEMORY, batch the edits (or
  desktop-commander `edit_block`) if the Edit tool throws "modified since read" more than twice.

---

## 10. Decisions the OWNER must make / confirm with the accountant (before the relevant step, not before deploy)

1. **Verify the statutory tables** (`js/statutory-tables.js` — every 2026 number is a placeholder,
   `verified:false`). Required before ANY `auto` mode is meaningful and before Type A disburse
   (D10 already enforces the latter). Ask: "Here are the SSS MSC bracket parameters, PhilHealth
   rate/floor/ceiling/split, Pag-IBIG rates/caps, and the monthly TRAIN withholding rows the system
   will use for {year} — sign off or correct them, then we flip `verified:true`."
2. **Weekly cadence for regularised Type B workers** (§5.2): confirm rule A (full monthly amount on
   the month's last weekly payslip, bracket on the month's actual summed gross) — or pick B and
   accept the added machinery. Needed only before the FIRST worker is switched to auto/fixed.
3. **Withholding for weekly-paid workers**: monthly-aggregate TRAIN table on the last-week payslip
   (what the app will do) vs BIR's weekly withholding columns — acceptable? (Likely moot at
   production-wage levels: ₱0 bracket.)
4. **Per-person exemption grounds**: for each employee/worker set to Exempt, the accountant should
   note WHY (not yet regularised / covered elsewhere / below threshold) and the effectivity date of
   any later regularisation. The app records who/when via the `statutory-config` audit log; the
   why lives with the accountant.
5. **Fixed-mode ER** (Type A): app keeps table-computed ER when EE is fixed. If the accountant
   wants ER to follow the fixed figure, that's a manual remittance adjustment — say so now if it
   matters.

## 11. Explicitly out of scope

No general rules engine; no change to salary math, keying, `computeStatutory`, or Firestore rules;
no retro-recompute of pay_runs/salary_history/payslips; no Type B ER ledger posting; no change to
`openPayslipEdit`; no fix to the dashboards.js:3183 preview divergence; no weekly TRAIN table.
