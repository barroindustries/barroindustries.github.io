# Workstream 21 — Statutory Tables (SSS/PhilHealth/Pag-IBIG/TRAIN withholding, employer shares, 13th-month)

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

CONFIRMED VIA GREP: no bracket-table constant exists anywhere in the repo. `grep -rn -i "sss_table|philhealth_table|pagibig_table|tax_table|bracket|train.?law|withholdingTax|computeSSS|computeTax|computePhilhealth|statutory"` across every .js/.html/.json returns zero relevant hits — the only "bracket" matches are unrelated steel-hardware product names in products-database.json ("GI Steel Ledge Bracket with Spring"). Every SSS/PhilHealth/Pag-IBIG/tax deduction AMOUNT in the app today is a hand-typed number input. Two entirely separate, hand-maintained paths exist:

1. REGULAR/MONTHLY STAFF — "Edit Payroll" modal, departments.js:2487-2560, opened from `.edit-emp-pay-btn` in `loadPayrollTable()`:
   `<input id="ep-sss" type="number" value="${emp.sss||0}" placeholder="Auto-computed if 0" inputmode="decimal"/>` (line 2510)
   `<input id="ep-ph" type="number" value="${emp.philhealth||0}" placeholder="Auto-computed if 0" .../>` (line 2513)
   `<input id="ep-pi" type="number" value="${emp.pagibig||0}" .../>` (line 2514)
   `<input id="ep-tax" type="number" value="${emp.tax||0}" .../>` (line 2516)
   The "Auto-computed if 0" placeholder text is aspirational UI copy only — no auto-compute logic exists anywhere; Save always persists exactly what was typed (departments.js:2531-2540): `sss: parseFloat(document.getElementById('ep-sss').value)||0, philhealth:…, pagibig:…, tax:…` written via `.set(...,{merge:true})` onto `payroll/{uid}`.
   "Compute Payroll" (`gen-payroll-btn` handler, departments.js:2616-2762) does NOT derive these fields — it just re-reads whatever is currently sitting on `payroll/{uid}` (`u.sss||0`, `u.philhealth||0`, `u.pagibig||0`, `u.tax||0` — lines 2636-2639, again at 2674 and 2758) and copies them into `salary_history` and a ledger row. Nothing is computed from gross pay anywhere in this path.

2. WEEKLY WORKER (Brilliant Steel production) path — `openPayslipGenerator()` / `collectPayslipData()`, departments.js:3989-4238. Deduction inputs default to a literal `0` every time a payslip is generated (not even pre-filled from the worker's own previous payslip or from any table):
   `<input id="ps-sss" type="number" value="0" inputmode="decimal"/>` (line 4055)
   `<input id="ps-ph" type="number" value="0" .../>` (line 4056)
   `<input id="ps-pib" type="number" value="0" .../>` (line 4057)
   `<input id="ps-tax" type="number" value="0" .../>` (line 4066)
   `collectPayslipData()` (departments.js:4165-4238) sums these into `deductions.govt.{sss,philhealth,pagibig,total}` and `deductions.other.taxes`. The compact-edit modal `openPayslipEdit()` (departments.js:3913-3987) has an identical second hand-typed set of `pe-sss/pe-ph/pe-pib/pe-tax` inputs for editing an already-filed payslip.

LEDGER BOOKING IS NET-ONLY TODAY, with NO liability legs: the Compute-Payroll ledger write (departments.js:2686-2702) posts exactly one debit row per employee, `category: 'Payroll Expense'`, `amount: empNet` (net pay, after all deductions) — there is no SSS/PhilHealth/Pag-IBIG-payable or withholding-tax-payable credit leg anywhere. Same pattern for the worker path's `WPAY-` ledger row (departments.js:3850-3867), posted on payslip "Submitted". Confirmed via `grep -i "payable|remittance|liability|1601"` — zero hits tied to payroll. Workstream 21's "payroll booked GROSS with liability legs" is therefore a real, not-yet-started architectural change, not a tweak.

EMPLOYER (ER) SHARE IS NOT TRACKED ANYWHERE: `grep -i "employerShare|erShare|employer_share|employer contribution"` returns zero hits (the only "partnerShare" hits found are an unrelated Brilliant-Steel deal-split field, `p.split.partnerPct`, departments.js:7600 / app.js:2120 — do not confuse with statutory employer contributions).

13TH-MONTH PAY DOES NOT EXIST AS A SYSTEM CONCEPT. The only trace in the entire codebase is a placeholder string in a free-text Notes field on the manual "Edit Payroll Record" (history) modal: `<input id="hpe-notes" type="text" value="${escHtml(rec.notes||'')}" placeholder="e.g. 13th month included"/>` (departments.js:2252). No accrual field, no dedicated collection, no scheduled/annual run, no ledger ref pattern.

GOVERNMENT ID NUMBERS (SSS#/PhilHealth#/Pag-IBIG#/TIN) exist ONLY for `worker_profiles` (the weekly-paid path): `ssNum`, `phNum`, `pagibigNum`, `tinNum` fields, entered in the HR profile modal (departments.js:3720-3725) and saved at departments.js:3764-3767. Regular monthly staff (`users` / `payroll/{uid}` docs) have NO equivalent ID-number fields anywhere — confirmed via grep, zero hits outside worker_profiles/payslips. Any payslip template requiring printed gov't ID numbers for regular staff (BIR 2316 / DOLE payslip norms) needs new fields that don't exist today.

FIELD-NAME DRIFT ALREADY EXISTS between the two persistence points for the SAME regular-staff numbers: `payroll/{uid}` uses lowercase `philhealth`/`pagibig` (departments.js:2536-2538) while `salary_history` uses mixed-case `philHealth`/`pagIbig` (departments.js:2646, `sss, philHealth:ph, pagIbig:pagibig, tax,`). This is a live precedent for how easily a shared computation would fork if built twice.

SEPARATE, UNRELATED "Taxes" FEATURE: `tax_records` collection (departments.js:2803-2828, Finance → "SSS / Gov" area is actually a file-collection for uploaded documents, departments.js:1965-1967, `renderFileCollection('SSS & Government Documents', 'fin-sss', ...)`) is a company-level BIR filing tracker (VAT/percentage tax/ITR due-dates) — this belongs to workstream 39 (BIR suite), not workstream 21's per-employee payroll withholding tax. Do not conflate.

ARCHITECTURAL DEPENDENCY ON WORKSTREAM 20: the regular-staff Compute path (departments.js:2396-2762) and the worker-payslip path (departments.js:3989-4238) are the exact "two compute paths" workstream 20 ("One payroll engine — kill the second compute path") is slated to consolidate. Both currently hand-roll their own deduction math, own idempotency handling (Compute's `PAY-{month}-{uid}` upsert vs. payslips' `WPAY-{id}`), and own CA-deduction application. `employees` for the regular path comes from `fetchUsersWithPayroll()` (config.js:195-207), which merges `payroll/{uid}` onto the `users` doc client-side and is force-substituted for any `dbCachedGet('users', …)` call (config.js:218-220) — so any NEW field added to `payroll/{uid}` automatically flows through the ~70 existing `u.<field>` call sites for free, but the corresponding WRITE path still has to be updated by hand in both places since there's no shared write helper today.

LOAD ORDER / CACHE (already documented in CLAUDE.md, re-verified): index.html loads scripts in fixed `defer` order — firebase-config.js → config.js (index.html:296-297) → drive.js → notifications.js → departments.js → app.js → modules.js (index.html:306-310). config.js is where DEPARTMENTS/ROLES/dbCachedGet already live (js/config.js:70-207) and is the only file guaranteed to load before departments.js consumes it. sw.js PRECACHE (sw.js:16-35) lists every current JS file explicitly by path; CACHE_VER (sw.js:11, currently `bi-ops-v162`) must bump on any edit to config.js/departments.js or any new file.

## Data model

`payroll/{uid}` (Firestore doc, one per staff uid) — fields actually read/written: `payClass` ('regular'|'production'), `salary`, `allowance`, `deductions` (flat "other" catch-all), `sss`, `philhealth`, `pagibig`, `tax` — all plain numbers, hand-typed (departments.js:2531-2540). Rules: firestore.rules:278-282 — owner or finance/admin may read; finance/admin create/update; president-only delete.

`salary_history/{uid}_{month}` — written by Compute Payroll (departments.js:2643-2650, upserted with `{merge:true}`): `userId`, `userName`, `month` ("YYYY-MM"), `salary` (flat base, NOT attendance-prorated — `base=u.salary||0` with no proration anywhere in this path), `allowance`, `deductions`, `sss`, `philHealth` (mixed-case, differs from payroll's `philhealth`), `pagIbig` (differs from payroll's `pagibig`), `tax`, `caDeducted`, `netPay`, `finalPay`, `recordedBy`, `recordedAt`, plus `caDeductions[]` (per-cash-advance-doc split, appended later at departments.js:2741-2742 for reversal support). Rules: firestore.rules:285-291, same read/write shape as payroll.

`payslips/{docId}` (weekly workers) — full shape from `collectPayslipData()` (departments.js:4206-4237): `workerId`, `workerName`, `workerIdNum`, `jobTitle`, `department`, `tinNum`, `ssNum`, `phNum`, `pagibigNum` (ID NUMBERS copied from the worker's profile at generation time), `payPeriodStart/End/Month`, `payDate`, `company`, `preparedBy`, `regular:{dailyRate,ratePerHr,hrsWorked,total}`, `overtime:{ratePerHr,hours,total}`, `allowances:{meal,transport,rent,total}`, `grossPay`, `deductions:{govt:{sss,philhealth,pagibig,total}, other:{cashAdvance,loans,taxes,total}}`, `caBalanceBefore`, `caBalanceAfter`, `totalDeductions`, `totalPay`, `paid`, `netPay`, `schedule[]` (7-day time log), `status` ('draft'|'verified'|'filed'|'submitted', PAYSLIP_STAGES at departments.js:3785), `proofUrl`. Rules: firestore.rules:668-674 gate self-read on `resource.data.userId == request.auth.uid` — but the field actually written is `workerId`, not `userId` (departments.js:4207) — a real latent mismatch (see risks).

`worker_profiles/{docId}` — departments.js:3749-3774: `name`, `idNumber`, `jobTitle`, `department`, `employmentType`, `workType`, `dailyRate`, `hourlyRate`, `foodAllowance`, `issuedOn`, `allowances:{meal,transport}`, `ssNum`, `phNum`, `pagibigNum`, `tinNum`, `address`, `phone`, `status`, `caBalance`, `includeInPayroll`. Rules: firestore.rules:675-679 — finance/admin only, no self-read at all (workers can't read their own profile).

`pay_runs/{month}` — governance-only state machine (departments.js:2564-2609): `state` ('draft'|'computed'|'verified'|'disbursed'), `verifiedBy/verifiedByName/verifiedAt`, `disbursedBy/disbursedByName/disbursedAt`, `totalNet`, `employeeCount`. No raw pay fields. Rules: firestore.rules:321-325.

`ledger` — Payroll Expense debit rows only, no liability/payable rows: `refNumber` = `PAY-{month}-{uid}` (regular, departments.js:2677) or `WPAY-{payslipId}` (worker, departments.js:3852), `amount` = NET pay, `category:'Payroll Expense'`, `date`, `description`, `source:'Finance'`, `addedBy/addedByName/createdAt`.

`fetchUsersWithPayroll()` (config.js:195-207) — the merge function every payroll UI reads through: `{...usersDoc, ...payrollDoc}` per uid, wrapped in a Firestore-snapshot-shaped object so existing `.docs[i].data()` call sites don't change. `dbCachedGet('users', …)` (config.js:214-234) hard-forces this fetcher (config.js:218-220) regardless of what the call site passed — so adding fields to `payroll/{uid}` is the single point that makes them available everywhere `u.<field>` is already read (~70 call sites per CLAUDE.md).

`tax_records` (departments.js:2803+) — unrelated: company-level BIR filing tracker (period, type, amount, due date, status), not per-employee, not part of this workstream's data model.

## Constraints — must respect

- Manila-time discipline: any effective-date logic for yearly bracket tables (e.g. "which table applies to this Compute run") must key off window.bizDate()/bizYear() (js/config.js:17-37), never new Date()/toISOString() — this exact class of bug already broke attendance/payroll once (see memory: manila_time_helpers).
- escHtml() discipline: any new printed field (SSS#, PhilHealth#, Pag-IBIG#, TIN for regular staff, computed bracket labels, etc.) inserted into innerHTML/payslip HTML must go through escHtml() per the existing pattern used for every other field in these same functions (e.g. departments.js:3764-3767 fields are escHtml()'d on render even though this specific write path doesn't escape on save).
- Idempotency: Compute Payroll's existing `PAY-{month}-{uid}` ledger upsert (departments.js:2677-2702) and `salary_history` doc-id-per-month upsert are explicitly idempotent by design (comment at departments.js:2620-2622); any new liability-leg ledger rows this workstream adds must follow the same deterministic-ref-per-month pattern (e.g. `SSSPAY-{month}`, `PHPAY-{month}`, `HDMFPAY-{month}`, `WHTPAY-{month}`) so re-running Compute doesn't duplicate them. The cash-advance-balance write in the SAME function is explicitly documented as NOT idempotent (departments.js:2712-2714, 'Apply CA deductions ... ONLY on the first generation') — any refactor must preserve that this specific side effect still only fires once per month.
- Firestore rules coverage: rules don't cascade or match by prefix (memory: firestore-rules-collection-coverage) — any brand-new collection this workstream introduces (e.g. a Firestore-hosted statutory-tables config, or a new `salary_13th_month` collection) needs its own explicit `match /{collection}/{docId}` block, confirmed by the existing pattern of one block per collection at firestore.rules:278-325 and 668-679.
- Load order: config.js loads immediately after firebase-config.js and strictly before departments.js/app.js (index.html:296-310) — a new statutory-table file must be added at that same early position, since departments.js's Compute/payslip code is the consumer.
- Cache-busting: sw.js PRECACHE explicitly lists every JS file by path (sw.js:16-35) and CACHE_VER (sw.js:11) gates staleness — CLAUDE.md's standing rule ('Bump CACHE_VER on every JS/CSS edit') applies to this workstream's edits to departments.js/config.js and to any new file, which must also be added to PRECACHE.
- Version stamping is automatic via the pre-commit hook (.git/hooks/pre-commit rewrites window.APP_VERSION and index.html version strings) — do not hand-edit version numbers.
- The existing `payroll/{uid}` vs `salary_history` field-name mismatch (philhealth/pagibig vs philHealth/pagIbig) is a pre-existing pattern this workstream must either perpetuate consistently or fix deliberately — it must not introduce a THIRD naming variant.
- Two independent hand-rolled compute call sites exist today (departments.js:2396-2762 and 3989-4238); this workstream and workstream 20 (one payroll engine) both touch this exact code — sequencing/ownership must be explicit in Fable's spec, not left implicit.

## DECIDED — architecture spec (Fable, 2026-07-10)

### ‼️ FLAG FOR NEIL — compliance numbers are NOT mine to invent
The bracket STRUCTURE and compute logic below are complete and ready to build. The actual
peso boundaries and rates are marked `PLACEHOLDER` and seeded with best-known 2026 PH figures
as a scaffold ONLY. **Before this goes live, have your bookkeeper/accountant verify every number
against the current published SSS / PhilHealth / Pag-IBIG contribution schedules and the BIR
TRAIN withholding-tax table.** This is live money; a wrong bracket silently mis-pays and
mis-remits. Nothing computes until the tables are confirmed (the code hard-warns if a table is
still flagged unverified — see Spec 1).

### Resolved decisions

1. **Location: a new `js/statutory-tables.js`**, loaded right after config.js. Compliance data
   changes yearly and is bulky — it deserves its own auditable file, not a corner of config.js.
   Wire into index.html (after config.js, before drive.js), sw.js PRECACHE, CACHE_VER bump.
2. **Year-keyed AND frozen.** Tables live under `STATUTORY[2026]`; the compute helper takes a
   `year`. AND the resolved peso amounts are frozen into WS20's `pay_runs.lines[]` /
   salary_history at Compute — so a reprint of a past month never re-derives from a table that
   may have changed. Both, because they answer different failure modes.
3. **Client-side compute** (consistent with the zero-backend architecture; the only Cloud
   Function stays the push relay). Integrity rests on finance-only write rules + WS20's frozen
   snapshot + audit log. Rules-side validation of the math is impossible (can't embed brackets
   in rules) — accepted, documented.
4. **Pre-fill as an editable suggestion, with override tracking.** The compute output pre-fills
   the existing `ep-sss/ep-ph/ep-pi/ep-tax` (and `ps-*`) inputs — finally backing the
   "Auto-computed if 0" placeholder that has always been dead. If Finance edits away from the
   computed value, set `{sssOverridden:true,...}` on the line + `logAudit('statutory-override',…)`.
   Editable because real edge cases (loans, partial-month, corrections) exist.
5. **Build the shared pure helper NOW; it survives WS20 unchanged.**
   `computeStatutory({grossPay, year})` is path-agnostic — both current compute sites call it,
   and WS20's unified engine keeps calling the same function. ONE implementation ⇒ no drift (the
   philhealth/philHealth split happened precisely because math was written twice).
6. **Fix the field-name drift: canonical lowercase everywhere** (`sss, philhealth, pagibig,
   tax`). payroll/{uid} already uses lowercase; salary_history's mixed-case `philHealth/pagIbig`
   is aligned when WS20 rewrites the salary_history mirror. Readers use
   `row.philhealth ?? row.philHealth ?? 0` during transition. No third variant.
7. **13th-month: display-computed, no per-row field, no backfill.** Shown as a running YTD line
   on the payslip = `sum(this year's salary_history[].base) / 12 − alreadyPaid13th`. The PAYOUT
   is its own run (Decision 8). Avoids backfilling Jan–Jun 2026 rows.
8. **13th-month payout rides WS20's machinery** as a pay-run typed `{type:'13th'}` keyed
   `pay_runs/{year}-13`, deterministic ledger ref `13TH-{year}-{uid}`, going through
   Compute→Verify→Disburse in the month it's paid (PH law: on/before Dec 24). No new 5th state.
9. **13th basis = sum of the year's basic salary ÷ 12** for regular staff (allowances/OT
   excluded per PH law). Production-weekly workers' 13th derives from their payslips' basic pay —
   separate, computed in the worker path. Reconciliation with WS26 hours is a noted forward dep,
   not a blocker (monthly basic salary IS the correct basis for regular staff).
10. **Employer share computed + frozen.** `er:{sss,philhealth,pagibig}` on each line at Compute.
    Needed for this workstream's own bullet AND WS39 remittance reports. Stored, not recomputed.
11. **GROSS-with-liability-leg booking is implemented in WS20's `disbursePayRun`, using these
    numbers + WS13's accountTypes.** WS21 PRODUCES the ee/er breakdown; WS20 POSTS it. Legs:
    debit Payroll Expense (gross) + debit Payroll Expense (er share) ; credit SSS Payable /
    PhilHealth Payable / Pag-IBIG Payable / Withholding Tax Payable / Net-Pay-Cash. **Forward
    only** — historical NET-booked months are NOT re-booked (would rewrite closed periods per
    WS12); the basis change is a documented restatement, a full historical re-book is deferred to
    WS39. Deterministic refs `SSSPAY-{month}` etc. so re-run doesn't duplicate.
12. **One `year` selector drives all four tables** via `STATUTORY[year]`; each table records its
    own source circular date as metadata, but the lookup key is the pay-run's year.

### Spec 1 — js/statutory-tables.js (new file)

```js
// ── PH statutory tables (v12 WS21) ───────────────────────────────────────
// ‼️ EVERY NUMBER BELOW IS A PLACEHOLDER. Verify against the published 2026
//    SSS / PhilHealth / Pag-IBIG schedules + BIR TRAIN withholding table
//    BEFORE go-live. Set verified:true only once an accountant signs off.
window.STATUTORY = {
  2026: {
    verified: false,   // compute() WARNS + refuses silent use until true
    source: 'PLACEHOLDER — 2026 circulars pending verification',
    sss: {              // contribution on Monthly Salary Credit brackets
      rateEE: 0.05 /*PLACEHOLDER*/, rateER: 0.10 /*PLACEHOLDER*/,
      mscMin: 5000 /*PLACEHOLDER*/, mscMax: 35000 /*PLACEHOLDER*/, mscStep: 500 /*PLACEHOLDER*/,
      mpfThreshold: 20000 /*PLACEHOLDER — WISP/MPF above this*/,
    },
    philhealth: { rate: 0.05 /*PLACEHOLDER*/, floor: 10000 /*PLACEHOLDER*/,
                  ceiling: 100000 /*PLACEHOLDER*/, split: 0.5 /*EE half*/ },
    pagibig: { rateEE: 0.02 /*PLACEHOLDER*/, rateER: 0.02 /*PLACEHOLDER*/,
               base: 10000 /*PLACEHOLDER — cap*/, maxEE: 200 /*PLACEHOLDER*/ },
    // TRAIN monthly withholding — compensation brackets [over, base, rateOfExcess]
    withholdingMonthly: [ /*PLACEHOLDER rows*/
      { over: 0,      base: 0,      rate: 0.00 },
      { over: 20833,  base: 0,      rate: 0.15 },
      { over: 33333,  base: 1875,   rate: 0.20 },
      { over: 66667,  base: 8541.8, rate: 0.25 },
      { over: 166667, base: 33541.8,rate: 0.30 },
      { over: 666667, base: 183541.8,rate: 0.35 },
    ],
  },
};
window.computeStatutory = function({ grossPay, year }) {
  const T = (window.STATUTORY && window.STATUTORY[year]) || null;
  if (!T) { console.warn('[statutory] no table for', year); return { ee:{sss:0,philhealth:0,pagibig:0,tax:0}, er:{sss:0,philhealth:0,pagibig:0}, unverified:true }; }
  if (!T.verified && !window._STATUTORY_ACK) console.warn('[statutory] table', year, 'UNVERIFIED — placeholder rates');
  const g = Math.max(0, grossPay||0);
  // SSS: round gross to MSC bracket, clamp, apply EE/ER
  const msc = Math.min(T.sss.mscMax, Math.max(T.sss.mscMin, Math.round(g / T.sss.mscStep) * T.sss.mscStep));
  const sssEE = round2(msc * T.sss.rateEE), sssER = round2(msc * T.sss.rateER);
  // PhilHealth: rate on clamped gross, split
  const phBase = Math.min(T.philhealth.ceiling, Math.max(T.philhealth.floor, g));
  const phTotal = round2(phBase * T.philhealth.rate);
  const phEE = round2(phTotal * T.philhealth.split), phER = round2(phTotal - phEE);
  // Pag-IBIG: rate on capped base, EE cap
  const piBase = Math.min(T.pagibig.base, g);
  const piEE = Math.min(T.pagibig.maxEE, round2(piBase * T.pagibig.rateEE));
  const piER = round2(piBase * T.pagibig.rateER);
  // Withholding: taxable = gross − EE statutory (SSS/PhilHealth/Pag-IBIG are deductible)
  const taxable = Math.max(0, g - sssEE - phEE - piEE);
  const br = T.withholdingMonthly.filter(b => taxable > b.over).pop() || T.withholdingMonthly[0];
  const tax = round2(br.base + (taxable - br.over) * br.rate);
  return { ee:{sss:sssEE, philhealth:phEE, pagibig:piEE, tax}, er:{sss:sssER, philhealth:phER, pagibig:piER}, unverified: !T.verified };
};
function round2(n){ return Math.round((n+Number.EPSILON)*100)/100; }
```
(NOTE: the SSS MSC/MPF split, PhilHealth differential, and TRAIN rows above are illustrative
shape only — Sonnet must not treat them as correct; Neil's accountant fills the verified values
and flips `verified:true`.)

### Spec 2 — call-site wiring

**Edit Payroll modal (departments.js ~2496-2559):** on open, compute a suggestion and pre-fill
if the stored value is 0/empty:
```js
const sug = computeStatutory({ grossPay: (emp.salary||0)+(emp.allowance||0), year: bizYear() });
// input value = emp.sss || sug.ee.sss  (placeholder shows "computed ₱X")
```
On save, if the typed value !== the computed suggestion, also write `sssOverridden:true` (etc.)
+ `logAudit('statutory-override', 'payroll', uid, {field:'sss', computed:sug.ee.sss, entered})`.

**Compute path — the numbers flow into WS20's `computePayLine`.** Add to the PayLine (WS20 Spec 1):
`sss, philhealth, pagibig, tax` (EE, = stored override ?? computed) AND
`er:{sss,philhealth,pagibig}` (always computed, frozen). `computePayLine` calls
`computeStatutory` when no manual override is present. Until WS20 lands, the same call slots into
the current Compute batch at departments.js:2636-2639 (replace the raw `u.sss||0` reads with
`u.sss ?? sug.ee.sss`).

**Worker payslip generator (departments.js:3999-4150):** pre-fill `ps-sss/ps-ph/ps-pib/ps-tax`
from `computeStatutory({grossPay: weeklyGross*<annualization factor>, year})` — NOTE weekly
basis differs; for workers, compute on the MONTHLY-equivalent then divide by pay periods, OR
mark worker statutory as manual-only for now (RECOMMENDED: manual-only for workers this pass,
since weekly statutory proration is a distinct compliance question — flag, don't guess).

### Spec 3 — field table

| Field | On | Type | Default | Notes |
|---|---|---|---|---|
| sss, philhealth, pagibig, tax | payroll/{uid}, pay_runs.lines[], salary_history | number | 0 | EE share; canonical lowercase |
| er | pay_runs.lines[], salary_history | {sss,philhealth,pagibig} | {0,0,0} | employer share, computed+frozen |
| sssOverridden … taxOverridden | pay_runs.lines[] | bool | false | set when manual ≠ computed |
| (13th-month) | — | — | — | NOT stored; display-computed from salary_history sum |

Read-safety: every display site uses `?? 0` / `row.philhealth ?? row.philHealth ?? 0` so
Jan–Jun 2026 rows (no `er`, mixed-case names) render fine.

### Spec 4 — firestore.rules
No new collection (tables are a JS file). The new `er`/override fields ride existing
payroll/salary_history/pay_runs blocks (finance-write already). The `13TH-{year}` pay-run uses
the pay_runs block (WS20's transition rules). ⚠️ Note the latent `payslips` self-read bug
(rule checks `userId`, doc has `workerId`) — DEFER to WS27 (workers can't log in yet); flagged,
not fixed here.

### Spec 5 — rollout checklist
1. Create js/statutory-tables.js (placeholders, `verified:false`).
2. index.html: `<script defer src="js/statutory-tables.js"></script>` after config.js, before drive.js.
3. sw.js PRECACHE += the new file; CACHE_VER bump (auto via hook on commit).
4. Wire `computeStatutory` into the Edit-Payroll pre-fill + override tracking.
5. Feed ee/er into WS20's `computePayLine` (or the current Compute batch if 21 ships first).
6. Payslip template (WS24) reads ee+er + the display-computed 13th YTD line — coordinate field
   names (this table is canonical).
7. NO backfill of Jan–Jun 2026 salary_history (display-computed 13th + `?? 0` reads cover it).
8. GROSS liability-leg booking: implemented in WS20 disburse using WS13 accountTypes, FORWARD
   ONLY; historical months stay NET-booked (documented basis change, full re-book → WS39).
9. **Have accountant verify all numbers; set `STATUTORY[2026].verified = true`.** Until then a
   console warning fires and the pre-fill shows an "unverified rates" badge.
10. Test: pick a test employee at a known gross, hand-calc expected EE deductions, generate
    Compute, confirm match; confirm override sets the flag; confirm re-run doesn't double-book.

### Sequencing
Build AFTER (or together with) WS20 — WS20 owns `computePayLine`/`disbursePayRun` where these
numbers live and post. If 21 ships first, wire into the current Compute batch as a bridge; WS20
then relocates the call into `computePayLine`. Coordinates with: 20 (host), 22 (CA deduction
sits after statutory in the same line), 23 (raise changes the gross the bracket keys off —
use the effective-dated salary), 24 (payslip prints ee+er+13th), 39 (remittance reads er +
liability legs).

### Cross-workstream call-outs for Sonnet
20 = where compute lives; 22 = CA runs after statutory on the line; 23 = use effective-dated
gross; 24 = payslip field names are canonical here; 39 = consumes er/liability legs. Do not
improvise at these seams — each is specified in its own brief.

## Risks / cross-workstream interactions

- ⚠️ Direct code-region collision with workstream 20 ('One payroll engine'): both workstreams touch departments.js:2396-2762 (Compute Payroll) and 3989-4238 (worker payslip generator). Building statutory auto-compute against the CURRENT dual-path code, then having workstream 20 restructure that same code shortly after, risks rework or diff conflicts between the two workstreams — sequencing/ownership needs to be explicit.
- ⚠️ Interacts with workstream 22 (cash-advance installments in payroll): the CA deduction is computed and applied in the SAME function, immediately after gov't deductions (departments.js:2712-2750), including the documented non-idempotent balance-write carve-out (2712-2714). Any refactor of the surrounding function for statutory auto-compute must not disturb that carve-out or the batch/commit boundaries around it.
- ⚠️ Interacts with workstream 23 (Raises / salary history timeline): a raise applied mid-month changes the gross base the bracket lookup keys off of (`payroll/{uid}.salary`, updated by `openSalaryRaiseModal`'s `applyRaise` callback at departments.js:2478-2482) — the two workstreams need to agree on which gross figure (pre-raise vs post-raise, effective-dated) a given month's bracket lookup should use.
- ⚠️ Interacts with workstream 24 (the payslip / letterhead engine): that workstream's own bullet requires printing 'employee+employer statutory shares' — the letterhead template and this workstream's computed field names must agree before either is built, or the payslip template gets written against one naming scheme while the compute engine emits another (see the existing philhealth/philHealth mismatch as a precedent for how easily that happens).
- ⚠️ Interacts with workstream 39 (BIR suite): remittance reports (SSS/PhilHealth/Pag-IBIG/BIR forms, 1601-C, alphalist, 2316) will need to read whatever shape this workstream picks. If employer shares/liability legs are NOT added here, workstream 39 either has to recompute them from scratch later or this workstream is silently incomplete for BIR purposes — Fable should state explicitly which it is.
- ⚠️ Latent rules bug found in passing (not this workstream's job, but adjacent): `payslips` rules gate self-read on `resource.data.userId == request.auth.uid` (firestore.rules:669-670) but the actual field written is `workerId` (departments.js:4207) — a worker likely cannot read their own payslip today. If this workstream's build touches the payslips doc shape, Fable should either fix this in the same pass (cheap) or explicitly note it's deferring it, since silently renaming workerId→userId would itself be a breaking migration for existing payslip docs.
- ⚠️ salary_history already holds real production data for Jan-June 2026 (per the June-payroll-backfill memory) with the OLD flat hand-typed sss/philHealth/pagIbig/tax values and no accrual/employer-share fields. Any newly-required field must be read with `||0`/optional-chaining everywhere it's displayed (YTD summaries, payslip reprints, the 13th-month sum) or old months will render blank/broken — the same class of bug the 'Firestore rules missing-field throws' memory already warns about for rules, applies equally to client-side rendering here.
- ⚠️ payroll/salary_history and payslips/worker_profiles are governed by separate rules blocks (firestore.rules:278-291 vs 668-679) with different read-gates (self-or-finance-admin vs finance-admin-only). Any new collection this workstream introduces (e.g. a Firestore-hosted statutory_tables collection, if that option is chosen) needs its own explicit rules match — the repo's rules do not cascade or prefix-match.
- ⚠️ If Fable picks a new js/statutory-tables.js file, it must be added to (a) index.html script tags in the exact right position (after config.js, before departments.js), (b) sw.js PRECACHE array, and (c) CACHE_VER bumped — missing any one means the file 404s for first-time users or stale table data is cache-served after a bracket update.
- ⚠️ Placeholder bracket numbers must never ship as real values: since no verified 2026 SSS/PhilHealth/Pag-IBIG/TRAIN figures exist anywhere in this repo today, whatever code Fable/Sonnet writes needs an unmistakable 'PLACEHOLDER — replace with verified published rates before go-live' marker on the actual bracket numbers, so a wrong number doesn't silently ship into live payroll (a live-money system per CLAUDE.md's Phase-1 framing).

## Files likely touched

`js/departments.js (loadPayrollTable + .edit-emp-pay-btn handler, ~lines 2396-2762; openPayslipGenerator/collectPayslipData/openPayslipEdit, ~lines 3912-4238; possibly the HR worker-profile modal ~3660-3782 if adding TIN/gov-number fields for regular staff)`, `js/config.js (candidate location for the bracket-table constant(s), alongside DEPARTMENTS/ROLES/dbCachedGet)`, `js/statutory-tables.js (new file — only if Fable chooses a separate config file over config.js or Firestore)`, `index.html (script tag additions/ordering, only if a new JS file is introduced)`, `sw.js (PRECACHE array + CACHE_VER bump — required regardless, since departments.js/config.js change)`, `firestore.rules (only if a new Firestore-hosted config collection, or a brand-new per-employee collection like a 13th-month accrual doc, is chosen)`, `functions/index.js (only if Fable chooses server-side/Cloud-Function compute instead of client-side)`, `css/styles.css (only if new UI elements — e.g. a 'computed vs override' badge on the deduction inputs — need styling)`, `V12-PLAN.md (workstream 21 status line update once built — process file, not app code)`

## Expected deliverable format

> Fable's output for this workstream should be handed to Sonnet as a mechanical implementation packet, not prose. Concretely it should contain: (1) an explicit, single-paragraph resolution of EVERY item in openDecisions above — no "either/or" left in the spec; (2) the exact bracket-table data structure as a literal JS code block ready to paste into whatever file location Fable picked, with every peso boundary/rate marked `/* PLACEHOLDER — verify against published 2026 SSS/PhilHealth/Pag-IBIG/BIR circulars before go-live */` rather than invented numbers; (3) exact function signature(s) for the shared compute helper(s), e.g. `computeStatutoryDeductions({ grossPay, year }) -> { ee:{sss,philhealth,pagibig,tax}, er:{sss,philhealth,pagibig} }`, plus where it's called from in both departments.js compute sites; (4) before/after code blocks (not descriptions) for every call site being changed — the Edit Payroll modal (departments.js ~2496-2559), the Compute Payroll batch (~2616-2762), the payslip generator (~3999-4150) and its edit modal (~3913-3987) — showing the exact old lines replaced by the exact new lines; (5) a field-by-field table of every NEW or RENAMED field on payroll/{uid}, salary_history, payslips (and any new collection), stating type, default, and which existing display call sites must be touched to read it safely; (6) if any new Firestore collection/field needs rules coverage, the literal firestore.rules diff (match block text) to add; (7) a numbered migration/rollout checklist covering: add table file/location → wire load order in index.html → add to sw.js PRECACHE → bump CACHE_VER → update both compute call sites → update payslip/letterhead template field references → decide + implement (or explicitly skip) backfill of existing Jan-June 2026 salary_history rows → decide ledger booking-basis change and whether historical rows get re-booked → test plan (specific manual steps: generate a payroll for a test employee at a known gross, confirm the computed numbers match a hand-calculated expected value, confirm override still works, confirm a re-run of Compute for the same month doesn't double-book); (8) explicit call-outs of every OTHER workstream (20, 22, 23, 24, 39) this build touches or must wait on, so Sonnet knows not to improvise a resolution when it hits that seam.
