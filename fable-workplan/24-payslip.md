# Workstream 24 — The Payslip (ONE branded template)

> ✅ **IMPLEMENTED 2026-07-10** (shipped as one diff with WS23, per build order).
> `window.toPayslipModel`/`buildPayslipHTML`/`renderPayslipPage` (departments.js) — no pop-ups
> anywhere in payroll now (grep-confirmed). Used this brief's own SEAM RECONCILIATION note to
> call the real `window.buildLetterhead()` (WS14) rather than the placeholder API. `payslips`
> rules workerId/userId bug fixed; new composite index added for weekly YTD (rules validated
> via dry-run; **rules+index NOT yet deployed**). `printPayslip()`/`printWorkerPayslip()`
> deleted outright, along with the now-orphaned `window._payslipData`. See V12-PLAN.md Build
> Log for the full implementation note.

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

Repo root: /Users/neilbarro/Library/CloudStorage/OneDrive-Personal/BARRO INDUSTRIES copy/Operation Systems Development, branch v12. V12-PLAN.md line 102 defines the workstream: "24. [ ] The payslip — ONE branded template (letterhead engine), employee+employer statutory shares, YTD, CA balance; monthly print buttons fixed (currently dead)." THREE-PLUS current payslip code paths were re-located by grep (line numbers re-verified against the live v12 tree, not the audit snapshot):

1) EMPLOYEE SELF-SERVE MONTHLY PAYSLIP (WORKS) — js/app.js. `window.renderPersonalFinance` (employee branch, starts ~app.js:4043 `const u = userProfile;`) builds `window._payslipData` at app.js:4257-4265: `window._payslipData = { name, employeeId, department, salary: u.salary||0, allowance: u.allowance||0, deductions: u.deductions||0, net, kpi, att, multiplier, computedMonth, earnedSoFar, totalAdvance, monthLabel, taskPct, doneTasks, myTasksTotal, salaryHistory }`. The button `<button class="btn-secondary" ... onclick="printPayslip()">Generate Payslip PDF</button>` is at app.js:4393 and DOES fire — `printPayslip()` is defined at app.js:4666 and opens a real `window.open` print document (STYLES const app.js:4670, HTML written app.js:4672-4681). Fields shown: Base Salary / Allowances / Deductions / Net Pay (single `deductions` number — no SSS/PhilHealth/Pag-IBIG/tax line items), a KPI×Attendance "Performance Multiplier" section, Task completion, Projected Full Month, "CA Outstanding Balance" (`pd.totalAdvance`, a single running total, no installment/monthly-payment line), and "Take-Home So Far". NO YTD figure is passed into `_payslipData` or printed — even though YTD (`ytdPay`, computed app.js:4234 `const ytdPay = ytdHistory.reduce(...) + earnedSoFar`) IS shown on-page in the KPI card sub-label at app.js:4287 (`YTD ₱${formatNum(ytdPay)}`) — it just never makes it into the print payload. No employer-side statutory shares anywhere.

2) FINANCE/HR MONTHLY PAYROLL TAB PRINT BUTTONS (CONFIRMED DEAD) — js/departments.js, `renderPayrollManagement` (departments.js:2128). Two buttons render: `<button class="btn-secondary btn-sm" id="print-payroll-btn">🖨 Print All</button>` (departments.js:2168) and, per employee row, `<button class="btn-secondary btn-sm print-slip-btn" data-uid="${u.id}" title="Payslip">🖨</button>` (departments.js:2463). Verified by grepping the entire repo for any `getElementById('print-payroll-btn')` or `querySelectorAll('.print-slip-btn')` — there is NONE. The function only wires `raise-history-btn` (departments.js:2614), `gen-payroll-btn` (departments.js:2616), `.raise-emp-btn` and `.edit-emp-pay-btn` (departments.js:2467-2530) after the same `tbody.innerHTML = ...` render. Both payslip-print buttons are pure dead UI — clicking does nothing, no handler ever attached. This is the button the audit flagged.

3) HR PROFILES WEEKLY WORKER PAYSLIP GENERATOR (WORKS, most complete) — js/departments.js. `renderFinanceHRProfiles` (departments.js:3577) lists `worker_profiles` docs with a `📄 Payslip` button (`hrp-gen-btn`, departments.js:3620) wired at departments.js:3675-3677 to `openPayslipGenerator(profile, currentUser, currentRole)` (departments.js:3989). That opens a full weekly-timesheet + earnings + deductions form; Save calls `collectPayslipData()` (departments.js:4165) and writes to `payslips` collection (departments.js:4140 `db.collection('payslips').add(d)`), then `renderPayslipPreview` → `buildPayslipHTML(d)` (departments.js:4256) opens a real print/JPEG-export window (html2canvas-based `downloadJPEG()` inline script, departments.js:~4470-4500). This one HAS a genuine company letterhead block (name/address/TIN hardcoded at departments.js:4303-4313: "NEILBARRO STEEL & METAL FABRICATION SERVICES / PUROK 6, CARLATAN... / TIN: 951-145-613-000"), per-employee SSS/PhilHealth/Pag-IBIG/TIN NUMBERS (not just amounts), a Daily Time Log grid, and a draft→verified→filed→submitted governance workflow (`PAYSLIP_STAGES`, departments.js:3785-3786, advanced in `openPayslipHistory`, departments.js:3790). Deductions shown are EMPLOYEE-SHARE ONLY (sss/philhealth/pagibig amounts, no employer share anywhere in the template). `d.caBalanceBefore`/`d.caBalanceAfter` ARE computed and stored in the payslip doc (departments.js:4199-4200) but are NEVER rendered in `buildPayslipHTML` — grepped the full template body (departments.js:4256-4495) and confirmed no reference to `caBalanceBefore`/`caBalanceAfter` in the HTML, only the current-period `Cash Advance` deduction line. No YTD anywhere in this path either — and structurally can't be, easily: `payslips` docs are keyed by `workerId` (departments.js:4203 `workerId: profile.id`) pointing at a `worker_profiles` doc id, NOT a Firebase Auth uid, and the only composite index on `payslips` (firestore.indexes.json line 69-74) is `payPeriodMonth ASC, createdAt DESC` — there is no index to cheaply sum a worker's payslips over a year by `workerId`.

4) A FOURTH, UNFLAGGED-BY-NAME BUT FUNCTIONALLY DUPLICATE PATH — js/app.js. `printWorkerPayslip(uid, name, preloaded)` (app.js:4970), fired from `wp-payslip-btn` inside `openWorkerProfilePanel` (button at app.js:4802, listener at app.js:4823 `panel.querySelector('#wp-payslip-btn')?.addEventListener('click', () => printWorkerPayslip(uid, name, preloaded))`). This is reached from the President/manager "Team Payroll" list (`renderPersonalFinance`, president branch) → per-row "Profile" button → Worker Profile Panel → 🖨 Payslip. Despite the name "Worker", it operates on regular monthly `users`/`payroll` staff, not `worker_profiles` — it is near-verbatim duplicate logic/markup of path (1)'s `printPayslip()` (same STYLES CSS block re-typed, same KPI-multiplier math), reading `db.collection('users').doc(uid).get()` (app.js:4977) for department/role/employeeId but falling back to the caller's `preloaded.salary/allowance/deductions` (sourced via `fetchUsersWithPayroll`) for the actual pay figures — `const salary=preloaded.salary||u.salary||0` (app.js:4981) — since `payroll/{uid}` fields no longer live on the `users` doc (see comment at app.js:461-462). Functionally it works, but it is redundant code Fable should decide whether to fold in or delete when unifying.

## Data model

Collections actually read/written by the current payslip paths (fields confirmed by reading real code, not inferred):

• `payroll/{uid}` (firestore.rules:278-283) — the protected monthly pay doc. Confirmed fields written by the Finance "Edit Payroll" modal (departments.js:2530-2540): `payClass` ('regular'|'production'), `salary`, `allowance`, `deductions`, `sss`, `philhealth` (lowercase), `pagibig` (lowercase), `tax`. Merged onto the user object at login (app.js:461-464: `const paySnap = await db.collection('payroll').doc(user.uid).get(); if (paySnap.exists) userProfile = {...userProfile, ...paySnap.data()}`) and, for admin views, via `window.fetchUsersWithPayroll()` (js/config.js:195-206, merges `payroll/*` onto `users/*` by doc id).

• `users/{uid}` — displayName, email, role, departments[]/department, employeeId, photoUrl, title. Does NOT hold pay fields anymore (migrated out per app.js:461-462 comment) — `printWorkerPayslip`'s direct `users` read (app.js:4977) only recovers dept/role/employeeId, never pay.

• `salary_history/{uid}_{month}` (firestore.rules:285-291, composite index firestore.indexes.json:45-50 on `userId ASC, month DESC`) — TWO DIVERGING WRITERS into the SAME doc id pattern: (a) departments.js Compute Payroll (departments.js:2642-2650, `{merge:true}`) writes `{userId, userName, month, salary, allowance, deductions, sss, philHealth (capital H!), pagIbig (capital I/B!), tax, caDeducted, netPay, finalPay, recordedBy, recordedAt}`; (b) app.js "Record Monthly Payroll" (app.js:4131-4139, plain `batch.set` with NO merge option) writes only `{userId, userName, month, salary, allowance, deductions, netPay, kpiScore, attScore, finalPay, recordedBy, recordedAt}` — this second writer, run after the first, silently WIPES sss/philHealth/pagIbig/tax/caDeducted from the doc because it has no `{merge:true}`. Field-name casing also disagrees with `payroll/{uid}`'s lowercase `philhealth`/`pagibig`.

• `worker_profiles/{id}` (firestore.rules:675-679, read/write gated to finance/admin only — no owner-read branch, confirming these are HR-only records not tied to an Auth uid). Fields (from `openHRProfileForm` save, departments.js:3736-3762): `name, idNumber, jobTitle, department, employmentType, workType, dailyRate, hourlyRate, foodAllowance, issuedOn, allowances:{meal,transport}, ssNum, phNum, pagibigNum, tinNum, address, phone, status, caBalance, includeInPayroll, createdAt, createdBy, updatedAt`.

• `payslips/{id}` (firestore.rules:668-674, rule reads `resource.data.userId` for the owner-read branch — but the actual doc field is `workerId`, see risk below) — the weekly worker payslip snapshot, full shape from `collectPayslipData()` (departments.js:4203-4232): `{workerId, workerName, workerIdNum, jobTitle, department, tinNum, ssNum, phNum, pagibigNum, payPeriodStart, payPeriodEnd, payPeriodMonth, payDate, company, preparedBy, regular:{dailyRate,ratePerHr,hrsWorked,total}, overtime:{ratePerHr,hours,total}, allowances:{meal,transport,rent,total}, grossPay, deductions:{govt:{sss,philhealth,pagibig,total}, other:{cashAdvance,loans,taxes,total}}, caBalanceBefore, caBalanceAfter, totalDeductions, totalPay, paid, netPay, schedule:[{day,timeIn,timeOut,hours}], proofUrl, status ('draft'|'verified'|'filed'|'submitted'), createdAt, createdBy}`.

• `cash_advances/{id}` (firestore.rules:170-190) — fields confirmed from two writers (js/modules.js:1630-1645 employee self-request, and departments.js's president-entered advance ~modules.js:1717): `{userId, userName, employeeId, amount, terms, interest (%), interestCharged (bool), totalPayable, monthlyPayment, balance, date, reason, status ('pending'|'approved'|'rejected'|'paid'), payments:[], private (bool, optional), createdAt}`. `monthlyPayment` is the natural "installment" figure and `balance` the running balance — BOTH ALREADY EXIST, no new field needed for CA-on-payslip.

• `payroll_ca_overrides/{docId}` (firestore.rules:304-311) — `{userId, amount}` per-month override of the CA deduction used only by the monthly Payroll tab (departments.js:2413-2417 `_caOverrideByUser`).

• `pay_runs/{month}` (firestore.rules:321-329) — currently ONLY governance metadata: `{state: 'draft'|'verified'|'disbursed', verifiedBy/verifiedByName/verifiedAt, disbursedBy/disbursedByName/disbursedAt}` (departments.js:2599-2606). It does NOT yet hold frozen per-employee snapshot lines — workstream 20's plan ("Compute freezes per-employee snapshot lines into pay_runs") has not landed, so nothing today lets a past month's payslip reprint exactly if `payroll/{uid}` base salary later changes.

• Ledger `PAY-{month}-{uid}` rows (`ledger` collection, `refNumber` idempotent key) — written by BOTH the departments.js Compute Payroll flow (departments.js:2664-2705ish) and the app.js Record-Payroll flow (app.js:4152-4165), each independently upserting the same ref pattern — this is the "second compute path" workstream 20 references.

FIELDS A UNIFIED PAYSLIP NEEDS, mapped against what exists — flagged NEW where nothing exists today:
- Base salary / allowance — EXISTS (`payroll/{uid}.salary`, `.allowance`; worker: `worker_profiles.dailyRate`/`hourlyRate`).
- Employee-side statutory (SSS/PhilHealth/Pag-IBIG/tax amounts) — EXISTS but hand-typed numbers, not computed from official tables (that's workstream 21's job; workstream 24 just needs to render whatever number lands in `payroll/{uid}.sss` etc. or the payslip doc's `deductions.govt.*`).
- Employer-side statutory shares (SSS/PhilHealth/Pag-IBIG ER contribution) — **NEW, does not exist anywhere in the current data model.** No field on `payroll/{uid}`, `salary_history`, or `payslips` carries an employer share. This is explicitly workstream 21's deliverable; workstream 24 depends on 21 defining where ER-share numbers live before it can render them.
- CA installment amount — EXISTS as `cash_advances.monthlyPayment`.
- CA running balance — EXISTS as `cash_advances.balance` (monthly path) and `payslips.caBalanceBefore/caBalanceAfter` (weekly path, captured but currently unrendered in the template).
- YTD — **PARTIALLY EXISTS for monthly regular staff** (computable by summing `salary_history` docs for the year, as `renderPersonalFinance` already does at app.js:4234 for on-screen display) but **NOT propagated to any print output**, and **DOES NOT EXIST at all for weekly production workers** (`payslips` has no per-worker time-series index — nearest index is `payPeriodMonth ASC, createdAt DESC`, not `workerId`), and worker_profiles docs aren't even 1:1 with an Auth uid the way salary_history's `userId` is.
- Net pay — EXISTS in all paths under different computations (see risks — the monthly KPI-multiplier "net" in `printPayslip`/`printWorkerPayslip` is a DIFFERENT number than the SSS/PhilHealth-deducted "net" `renderPayrollManagement` computes for the same employee/month).
- 13th-month accrual — **NEW**, only a free-text mention ("e.g. 13th month included" as a raise-history notes placeholder, departments.js:2252) — no real field, deferred to workstream 21 per V12-PLAN.md line 93.

## Constraints — must respect

- Load order is fixed (index.html, per CLAUDE.md): config.js → drive.js → notifications.js → departments.js → app.js → modules.js. escHtml() is DEFINED in modules.js (js/modules.js:9) yet CALLED throughout departments.js (e.g. buildPayslipHTML) and app.js — this only works because none of the payslip functions execute at parse time, only on later user click, by which point modules.js has already run and set window.escHtml. Any new shared payslip/letterhead helper must either live in a script that loads before its first caller, or be referenced only inside deferred function bodies the same way.
- Every Firestore collection needs an EXPLICIT rules match — there is no cascade/prefix inheritance (see memory note firestore-rules-collection-coverage.md, confirmed live in firestore.rules: `payroll`, `salary_history`, `payslips`, `worker_profiles`, `cash_advances`, `payroll_ca_overrides`, `pay_runs` each has its own `match` block, lines 278-329 and 668-679). If workstream 24 introduces any new collection/subcollection (e.g. a unified `pay_snapshots` or a YTD-by-worker rollup), it needs its own rules block before the client will ever see data back (a missing rule = DENIED = blank UI unless every read site already `.catch()`s, which most payslip reads here do).
- Manila-time discipline: all pay-period/day-elapsed math in these paths already uses `window.bizDate()`/`bizDow()`/`countWorkDays()` (e.g. app.js:4178-4184, departments.js:3991-3994 comment: "Raw new Date().getDay()/toISOString() lands on the wrong day for the first 8h of each Manila day and corrupted pay periods"). Any new unified payslip period logic (e.g. YTD boundaries, pay-run close dates) must reuse these helpers, not raw Date/toISOString.
- escHtml() must wrap all user-controlled strings before they hit innerHTML/document.write — every current payslip path does this consistently (`escHtml(pd.name)`, `escHtml(d.workerName)`, etc.) for names/titles/notes; keep that discipline for any new template.
- Ledger idempotency pattern: payroll ledger rows use deterministic refs `PAY-{month}-{uid}` and are upserted via `where('refNumber','==',...)` existence checks (departments.js:2683-2705, app.js:4152-4165) so re-running Compute/Record doesn't duplicate a ledger entry. A unified payslip that also (re)posts to the ledger on generation/print must follow the same idempotent-ref-then-upsert pattern, not a blind `.add()`.
- Two independent writers currently touch the SAME `salary_history/{uid}_{month}` doc with DIFFERENT field sets and DIFFERENT merge semantics (departments.js:2642-2650 uses `{merge:true}` and includes sss/philHealth/pagIbig/tax/caDeducted; app.js:4131-4139 has no merge option and omits those fields, so it can silently erase them). Workstream 20 ("kill the second compute path") and workstream 24 must be sequenced or coordinated — a unified payslip reading `salary_history` needs one authoritative writer, or it will intermittently render with missing statutory fields depending on which flow ran last.
- `pay_runs/{month}` today is governance-metadata only (state/verifiedBy/disbursedBy) — it does NOT freeze snapshot lines yet, so "past months reprint exactly" (an explicit owner directive: 'records kept forever, real-time, visible' + workstream 20's stated goal) is not currently possible if base salary is edited later; that snapshot-freeze is workstream 20's job, and workstream 24 needs to decide whether it depends on that landing first or reads live `payroll/{uid}` and accepts the drift risk for historical reprints in the interim.
- Per CLAUDE.md: bump CACHE_VER in sw.js on any JS/CSS edit (auto-handled by the pre-commit hook per the repo's stated convention — do not hand-edit version strings).
- Owner's standing directives apply directly to this workstream: 'no pop-ups (full pages with Back)' — every current payslip path uses `window.open('','_blank')` popup windows for printing (app.js:4666, app.js:4970, departments.js:4240/4248) which conflicts with that directive; 'everything uniform (one formal document header)' is literally what 'ONE branded template' means; 'professional Microsoft/Apple design' — current templates are three different hand-rolled inline `<style>` blocks (three near-duplicate STYLES consts across app.js×2 and departments.js×1).

## DECIDED — architecture spec (Fable, 2026-07-10)

### Resolved decisions

1. **Data source = frozen snapshot, NEVER recompute.** The unified payslip renders from WS20's frozen `pay_runs.lines[]` (finance/admin view of any employee) or the employee's own `salary_history/{uid}_{month}` mirror (self-service). It never re-runs `computePayLine` for a disbursed month. Rationale: WS20 already froze the numbers at Compute and mirrors them at Disburse specifically so a March payslip reprints March's salary after a June raise; WS24 consuming that is the whole point of the freeze. **Interim (before WS20 lands):** if no frozen line/mirror exists for the requested month, render a PROJECTION via `computePayLine(emp,{projection:true})` and stamp a red `PROJECTION — not yet disbursed` badge in the doc-number slot. This is the ONLY place WS24 is allowed to compute, and it is clearly labelled as unofficial.

2. **ONE template function, TWO source collections — no storage merge.** Monthly (`payroll`+`salary_history`/`pay_runs.lines`) and weekly (`worker_profiles`+`payslips`) stay separate collections with separate identity models (per WS20 D3: weekly workers need not have Auth accounts). They converge at the PRESENTATION layer only, through a normalizer `window.toPayslipModel(source, kind)` → a `PayslipModel` that the single `window.buildPayslipHTML(model)` renders. Rationale: folding weekly into monthly is a login-provisioning project (out of scope, WS20 D3); a shared HTML template gives the "ONE branded template" the owner wants without touching either pay engine.

3. **Employer share renders from the WS21-canonical `er:{sss,philhealth,pagibig}`.** Monthly: read `line.er` / `mirror.er` (frozen at Compute per WS21 D10). Weekly: read a NEW optional `payslips.employerShare:{sss,philhealth,pagibig}`; if absent, the ER column shows `—`. WS21 D-Spec2 marked weekly statutory as manual-only for now, so weekly ER is manual/absent by default. ‼️ **FLAG FOR NEIL:** whether weekly production workers need employer-share tracked on their payslips at all is a compliance call — recommendation: leave weekly ER blank until WS21/WS39 wire real weekly statutory; monthly ER ships now.

4. **YTD: monthly is free from the existing index; weekly gets ONE new composite index and a bounded client-side sum.** Monthly YTD = sum of `salary_history` where `userId==uid` AND `month` startsWith the current `bizYear()` — served by the EXISTING index `salary_history (userId ASC, month DESC)` (firestore.indexes.json:45-49), zero new infra. Weekly YTD = sum of `payslips` where `workerId==uid` AND `payPeriodStart >= '{year}-01-01'` — requires a NEW composite index `payslips (workerId ASC, payPeriodStart ASC)` and a client-side sum (≤52 docs/year, cheap). Rejected the denormalized `worker_profiles.ytdGross` counter — it is the exact "two sources of truth drift" hazard flagged in memory finance-reporting-open-items; a bounded query is correct and matches the owner's "real-time, visible" directive. YTD figures are display-computed each render, NOT stored on the payslip.

5. **CA balance shows BOTH before and after, from the FROZEN snapshot (not live `cash_advances`).** The payslip renders `CA Balance (before) / Installment this period / CA Balance (after)`. Monthly: `before = line.caBalance`, `installment = line.caPlanned`, `after = before − installment` (both frozen on the line at Compute per WS20/WS22; `after` derived display-side). Weekly: read the already-captured-but-currently-unrendered `payslips.caBalanceBefore`/`caBalanceAfter` (departments.js:4196-4197) — this wires up dead data, no new field. Rationale: a filed payslip must not silently change its printed CA numbers because another CA payment posted afterward, so it reads the frozen snapshot, never live `cash_advances`.

6. **`printPayslip` and `printWorkerPayslip` are DELETED and replaced by ONE `window.renderPayslipPage(model)`.** They are near-verbatim duplicates using the retired KPI×Attendance multiplier that no longer matches WS20's engine. RBAC: employee → own payslip only; finance/admin/president → any employee's payslip (reached from the pay_runs line and the Worker Profile panel). The self-service employee "Generate Payslip PDF" button and the manager Worker-Profile "🖨 Payslip" button both call `renderPayslipPage` with a model built from the frozen snapshot (or a labelled projection).

7. **NO pop-ups. The payslip is a full in-app page-with-Back that prints itself via same-document `window.print()`.** Per the owner's standing directive. `renderPayslipPage(model)` writes into `#page-content` with a Back button + a "Print / Save PDF" button; printing uses the quote-builder-v2 in-page CSS-toggle pattern (`.payslip-print` visible, `.no-print` hidden under `@media print`) — NOT `window.open('','_blank')`. This eliminates the popup-blocked null-window crash (app.js printPayslip/printWorkerPayslip never guarded it) entirely. The weekly `buildPayslipHTML` new-window flow (departments.js:4240-4248) is also migrated onto this page (its JPEG-export via html2canvas stays, just inside the in-app page).

8. **Field casing: canonical LOWERCASE `sss/philhealth/pagibig/tax` everywhere (aligns with WS21 D6).** The template's field-mapping layer normalizes on read with `row.philhealth ?? row.philHealth ?? 0` and `row.pagibig ?? row.pagIbig ?? 0` so Jan–Jun 2026 `salary_history` rows (mixed-case, Path-A writer) render correctly during transition. No third variant introduced.

9. **The `payslips` self-read rules bug is FIXED here (rename the RULE field, not the doc field).** The rule checks `resource.data.userId` but the doc stores `workerId` (dead owner-read branch). Fix by pointing the rule at `resource.data.get('workerId', request.auth.uid)` — no doc migration needed. (WS21 deferred this to WS27; WS24 owns the payslip template so it fixes it in-pass — cheap, and WS27 worker-login depends on it.)

10. **The two dead print buttons are wired to the unified page.** `#print-payroll-btn` → prints the whole month (all `pay_runs.lines[]` as a stacked multi-payslip print). `.print-slip-btn[data-uid]` → `renderPayslipPage` for that uid's frozen line.

11. **Payslip doc serial:** deterministic `PS-{month}-{uid}` (monthly) / the `payslips` doc id (weekly), printed in the header's doc-number slot. No atomic `_counters` needed — `{month}-{uid}` is already unique. (Composes with WS14's open serial decision without depending on it.)

---

### Spec 0 — Letterhead interface contract (composes with WS14, which is NOT yet decided)

WS14 is unresolved, so WS24 calls an OPTIONAL `window.Letterhead` and ships a self-contained fallback. Sonnet builds this today; when WS14 lands it fills `window.Letterhead` and the fallback goes unused automatically.

```js
// Contract WS14 must satisfy (WS24 only READS it):
//   window.Letterhead.header({docType, docTitle, docNumber, dateLabel, entity, sub}) -> HTML string
//   window.Letterhead.printCSS() -> <style> string (two-tier page-break rules)
// If absent, WS24 uses _payslipLetterheadFallback() below.
function _payslipLetterheadFallback({ docTitle, docNumber, dateLabel }) {
  // Payslip is a BIR/DOLE-facing doc -> DTI registered trade name + TIN (matches
  // today's buildPayslipHTML header). ‼️ FLAG FOR NEIL: confirm the payslip's legal
  // entity is the DTI sole-prop 'NEILBARRO STEEL & METAL FABRICATION SERVICES /
  // TIN 951-145-613-000' (current behaviour) vs 'Barro Industries OPC'.
  return `<div class="lh-head">
    <img src="icons/barro-industries.png" class="lh-logo" onerror="this.style.display='none'" alt=""/>
    <div class="lh-org">
      <div class="lh-name">NEILBARRO STEEL &amp; METAL FABRICATION SERVICES</div>
      <div class="lh-sub">PUROK 6, CARLATAN, 2500, CITY OF SAN FERNANDO, LA UNION, PHILIPPINES<br/>
        CONTACT: NEIL BARRO, 0927-683-6300 &nbsp;·&nbsp; TIN: 951-145-613-000</div>
    </div>
    <div class="lh-doc">
      <div class="lh-title">${escHtml(docTitle||'PAYSLIP')}</div>
      <div class="lh-no">${escHtml(docNumber||'')}</div>
      <div class="lh-date">${escHtml(dateLabel||'')}</div>
    </div></div>`;
}
function payslipHeader(opts){ return (window.Letterhead?.header ? window.Letterhead.header({docType:'PAYSLIP',entity:'DTI',...opts}) : _payslipLetterheadFallback(opts)); }
```

### Spec 1 — PayslipModel (the ONE shape both cycles normalize into)

```js
// PayslipModel — produced by toPayslipModel(), consumed by buildPayslipHTML()
{
  kind: 'monthly' | 'weekly',
  official: true,              // false => projection/interim; drives the PROJECTION badge
  docNumber: 'PS-2026-07-<uid>' | '<payslipDocId>',
  periodLabel: 'July 2026' | 'Jul 1 – Jul 7, 2026',
  payDateLabel: 'July 30, 2026',
  employee: { name, idNumber, jobTitle, department,
              tin:'', sss:'', philhealth:'', pagibig:'' },   // gov ID numbers (weekly has them; monthly '' for now)
  earnings: {
    base: 0, allowance: 0,
    overtime: 0,             // weekly only; 0 for monthly
    gross: 0                 // base + allowance + overtime
  },
  statutory: {               // EE share — canonical lowercase
    ee: { sss:0, philhealth:0, pagibig:0, tax:0 },
    er: { sss:0, philhealth:0, pagibig:0 } | null   // null => render '—'
  },
  otherDeductions: 0,
  ca: { before:0, installment:0, after:0 },          // Decision 5 (frozen)
  net: 0,                    // gross − ee.total − otherDeductions − ca.installment
  ytd: { gross:0, net:0, thirteenthAccrual:0 },       // Decision 4; 13th = sum(year base)/12 (WS21 D7)
  performance: { kpi:0, att:0, perfFactor:1, policy:'flat' } | null, // monthly only; null hides the block
  timeLog: [{day,timeIn,timeOut,hours}] | null,       // weekly only; null hides the block
  signatures: [{label:'Prepared by', name:'', title:'Finance'},
               {label:'Verified by', name:'', title:'HR'},
               {label:'Approved by', name:'', title:'President'}],
  proofUrl: '' // weekly transfer-proof link, optional
}
```

### Spec 2 — `window.toPayslipModel(source, kind)` (new; put in departments.js directly above buildPayslipHTML)

```js
window.toPayslipModel = function(source, kind) {
  const g = (o,a,b)=> (o?.[a] ?? o?.[b] ?? 0);            // casing-tolerant getter (Decision 8)
  if (kind === 'monthly') {
    // source = a frozen pay_runs line OR a salary_history mirror doc (same field set)
    const base = source.base ?? source.salary ?? 0;
    const allowance = source.allowance ?? 0;
    const ee = { sss:g(source,'sss'), philhealth:g(source,'philhealth','philHealth'),
                 pagibig:g(source,'pagibig','pagIbig'), tax:source.tax??0 };
    const er = source.er ? { sss:source.er.sss||0, philhealth:source.er.philhealth||0, pagibig:source.er.pagibig||0 } : null;
    const gross = base + allowance;
    const eeTotal = ee.sss+ee.philhealth+ee.pagibig+ee.tax;
    const other = source.otherDeductions ?? source.deductions ?? 0;
    const caBefore = source.caBalance ?? source.caBalanceBefore ?? 0;
    const caInst = source.caPlanned ?? source.caDeducted ?? 0;
    return {
      kind:'monthly', official:true,
      docNumber:`PS-${source.month || source.runMonth}-${source.uid || source.userId}`,
      periodLabel:new Date((source.month||source.runMonth)+'-01').toLocaleString('en-PH',{month:'long',year:'numeric'}),
      payDateLabel:'', // filled by caller from pay_runs.disbursedAt if present
      employee:{ name:source.name||source.userName||'', idNumber:source.employeeId||'',
                 jobTitle:source.title||'', department:source.department||'',
                 tin:'', sss:'', philhealth:'', pagibig:'' },
      earnings:{ base, allowance, overtime:0, gross },
      statutory:{ ee, er },
      otherDeductions:other,
      ca:{ before:caBefore, installment:caInst, after:Math.max(0, caBefore-caInst) },
      net: source.finalPay ?? (gross - eeTotal - other - caInst),
      ytd:{ gross:0, net:0, thirteenthAccrual:0 },   // filled by caller (needs the year query)
      performance: (source.kpiScore!=null||source.perfFactor!=null)
        ? { kpi:source.kpiScore||0, att:source.attScore||0, perfFactor:source.perfFactor??1, policy:source.policy||'flat' } : null,
      timeLog:null,
      signatures:[{label:'Prepared by',name:'',title:'Finance'},{label:'Verified by',name:'',title:'HR'},{label:'Approved by',name:'',title:'President'}],
      proofUrl:''
    };
  }
  // kind === 'weekly'  (source = a payslips/{id} doc)
  const dg = source.deductions?.govt || {};
  const ee = { sss:dg.sss||0, philhealth:g(dg,'philhealth')||0, pagibig:g(dg,'pagibig')||0, tax:source.deductions?.other?.taxes||0 };
  const er = source.employerShare ? { sss:source.employerShare.sss||0, philhealth:source.employerShare.philhealth||0, pagibig:source.employerShare.pagibig||0 } : null;
  return {
    kind:'weekly', official:true, docNumber:source.id||'',
    periodLabel:`${source.payPeriodStart||''} – ${source.payPeriodEnd||''}`,
    payDateLabel:source.payDate||'',
    employee:{ name:source.workerName||'', idNumber:source.workerIdNum||'', jobTitle:source.jobTitle||'',
               department:source.department||'', tin:source.tinNum||'', sss:source.ssNum||'',
               philhealth:source.phNum||'', pagibig:source.pagibigNum||'' },
    earnings:{ base:source.regular?.total||0, allowance:source.allowances?.total||0, overtime:source.overtime?.total||0,
               gross:source.grossPay||0 },
    statutory:{ ee, er },
    otherDeductions:(source.deductions?.other?.loans||0),
    ca:{ before:source.caBalanceBefore||0, installment:source.deductions?.other?.cashAdvance||0, after:source.caBalanceAfter||0 },
    net:source.netPay||0,
    ytd:{ gross:0, net:0, thirteenthAccrual:0 },   // filled by caller (weekly year query)
    performance:null,
    timeLog:source.schedule||[],
    signatures:[{label:'Prepared by',name:source.preparedBy||'',title:''},{label:'Verified by',name:'',title:'HR'},{label:'Approved by',name:'',title:'President'}],
    proofUrl:source.proofUrl||''
  };
};
```

**YTD helpers (new, departments.js — caller fills `model.ytd` before render):**
```js
window.payslipYtdMonthly = async function(uid, year) {
  const snap = await db.collection('salary_history').where('userId','==',uid)
    .where('month','>=',`${year}-01`).where('month','<=',`${year}-12`).get().catch(()=>({docs:[]}));
  let gross=0, net=0, baseSum=0;
  snap.docs.forEach(d=>{ const r=d.data(); const b=r.base??r.salary??0;
    baseSum+=b; gross+=b+(r.allowance||0); net+=(r.finalPay??r.netPay??0); });
  return { gross, net, thirteenthAccrual: Math.round((baseSum/12)*100)/100 };   // WS21 D7
};
window.payslipYtdWeekly = async function(workerId, year) {
  const snap = await db.collection('payslips').where('workerId','==',workerId)
    .where('payPeriodStart','>=',`${year}-01-01`).where('payPeriodStart','<=',`${year}-12-31`).get().catch(()=>({docs:[]}));
  let gross=0, net=0, baseSum=0;
  snap.docs.forEach(d=>{ const r=d.data(); baseSum+=r.regular?.total||0; gross+=r.grossPay||0; net+=r.netPay||0; });
  return { gross, net, thirteenthAccrual: Math.round((baseSum/12)*100)/100 };   // needs the NEW index (Spec 7)
};
```

### Spec 3 — `buildPayslipHTML(model)` rebuilt (departments.js:4256 — REPLACE the whole function)

The function stops taking the raw weekly doc `d` and takes a `PayslipModel`. The DTI-hardcoded header block (departments.js:4304-4316) is replaced by `payslipHeader(...)`. The document body (below) is the ONE branded template; sections render conditionally on `model.performance` / `model.timeLog`. This returns the INNER HTML for the in-page container (Spec 4), not a full `<html>` doc.

```js
window.buildPayslipHTML = function(model) {
  const f = n => (parseFloat(n)||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const m = model, s = m.statutory, er = s.er;
  const erCell = k => er ? f(er[k]) : '—';
  const badge = m.official ? '' : `<div class="ps-badge-proj">PROJECTION — not yet disbursed</div>`;
  const perf = m.performance ? `
    <div class="ps-sec-h">Performance</div>
    <table class="ps-t">
      <tr><td>Task KPI (70%)</td><td class="num">${Math.round(m.performance.kpi*100)}%</td></tr>
      <tr><td>Attendance (30%)</td><td class="num">${Math.round(m.performance.att*100)}%</td></tr>
      <tr class="ps-sub"><td>Performance factor (policy: ${escHtml(m.performance.policy)})</td><td class="num">${m.performance.perfFactor.toFixed(2)}×</td></tr>
    </table>` : '';
  const timelog = (m.timeLog && m.timeLog.length) ? `
    <div class="ps-sec-h">Daily Time Log</div>
    <table class="ps-t"><thead><tr><th>Day</th><th>Time In</th><th>Time Out</th><th class="num">Hours</th></tr></thead>
    <tbody>${m.timeLog.map(r=>`<tr><td>${escHtml(r.day)}</td><td>${escHtml(r.timeIn||'—')}</td><td>${escHtml(r.timeOut||'—')}</td><td class="num">${(r.hours||0).toFixed(2)}</td></tr>`).join('')}</tbody></table>` : '';
  return `
  ${payslipHeader({ docTitle:'PAYSLIP', docNumber:m.docNumber, dateLabel:m.periodLabel })}
  ${badge}
  <div class="ps-sec-h">Employee</div>
  <table class="ps-t">
    <tr><td class="lbl">Name</td><td>${escHtml(m.employee.name)}</td><td class="lbl">TIN</td><td>${escHtml(m.employee.tin)}</td></tr>
    <tr><td class="lbl">ID</td><td>${escHtml(m.employee.idNumber)}</td><td class="lbl">SSS</td><td>${escHtml(m.employee.sss)}</td></tr>
    <tr><td class="lbl">Job Title</td><td>${escHtml(m.employee.jobTitle)}</td><td class="lbl">PhilHealth</td><td>${escHtml(m.employee.philhealth)}</td></tr>
    <tr><td class="lbl">Department</td><td>${escHtml(m.employee.department)}</td><td class="lbl">Pag-IBIG</td><td>${escHtml(m.employee.pagibig)}</td></tr>
    <tr><td class="lbl">Pay Period</td><td>${escHtml(m.periodLabel)}</td><td class="lbl">Pay Date</td><td>${escHtml(m.payDateLabel||'—')}</td></tr>
  </table>

  <div class="ps-sec-h">Earnings</div>
  <table class="ps-t">
    <tr><td>Basic Pay</td><td class="num">${f(m.earnings.base)}</td></tr>
    <tr><td>Allowances</td><td class="num">${f(m.earnings.allowance)}</td></tr>
    ${m.earnings.overtime?`<tr><td>Overtime</td><td class="num">${f(m.earnings.overtime)}</td></tr>`:''}
    <tr class="ps-gross"><td>Gross Pay</td><td class="num">${f(m.earnings.gross)}</td></tr>
  </table>

  <div class="ps-sec-h">Deductions &amp; Contributions</div>
  <table class="ps-t">
    <thead><tr><th>Contribution</th><th class="num">Employee</th><th class="num">Employer</th></tr></thead>
    <tbody>
      <tr><td>SSS</td><td class="num">${f(s.ee.sss)}</td><td class="num">${erCell('sss')}</td></tr>
      <tr><td>PhilHealth</td><td class="num">${f(s.ee.philhealth)}</td><td class="num">${erCell('philhealth')}</td></tr>
      <tr><td>Pag-IBIG</td><td class="num">${f(s.ee.pagibig)}</td><td class="num">${erCell('pagibig')}</td></tr>
      <tr><td>Withholding Tax</td><td class="num">${f(s.ee.tax)}</td><td class="num">—</td></tr>
      ${m.otherDeductions?`<tr><td>Other Deductions</td><td class="num">${f(m.otherDeductions)}</td><td class="num">—</td></tr>`:''}
    </tbody>
  </table>

  <div class="ps-sec-h">Cash Advance</div>
  <table class="ps-t">
    <tr><td>Balance (before)</td><td class="num">${f(m.ca.before)}</td></tr>
    <tr><td>Installment this period</td><td class="num">${f(m.ca.installment)}</td></tr>
    <tr class="ps-sub"><td>Balance (after)</td><td class="num">${f(m.ca.after)}</td></tr>
  </table>

  ${perf}

  <table class="ps-t ps-net-t">
    <tr class="ps-net"><td>NET PAY</td><td class="num">₱${f(m.net)}</td></tr>
  </table>

  <div class="ps-sec-h">Year to Date (${escHtml(String((window.bizYear?window.bizYear():new Date().getFullYear())))})</div>
  <table class="ps-t">
    <tr><td>YTD Gross</td><td class="num">${f(m.ytd.gross)}</td></tr>
    <tr><td>YTD Net</td><td class="num">${f(m.ytd.net)}</td></tr>
    <tr class="ps-sub"><td>13th-Month Accrual (est.)</td><td class="num">${f(m.ytd.thirteenthAccrual)}</td></tr>
  </table>

  <div class="ps-sigs">
    ${m.signatures.map(sig=>`<div class="ps-sig"><div class="ps-sig-line">${escHtml(sig.name||'')}</div><div class="ps-sig-lbl">${escHtml(sig.label)}${sig.title?` — ${escHtml(sig.title)}`:''}</div></div>`).join('')}
  </div>
  <div class="ps-foot">System-generated payslip · ${escHtml(m.docNumber)} · ${escHtml(m.periodLabel)}</div>`;
};
```

**HTML skeleton (where each figure sits — for Sonnet's layout reference):**
```
┌ LETTERHEAD (logo · DTI name · TIN)          PAYSLIP · PS-2026-07-<uid> · July 2026 ┐
│ [PROJECTION badge — only when !official]                                          │
│ EMPLOYEE   Name/ID/JobTitle/Dept   |   TIN/SSS/PhilHealth/Pag-IBIG · Pay Period/Date │
│ EARNINGS   Basic · Allowance · (Overtime) ................ GROSS                    │
│ DEDUCTIONS 3-col: Contribution | Employee | Employer                                │
│            SSS / PhilHealth / Pag-IBIG (ee+er) · Tax (ee) · Other (ee)              │
│ CASH ADV   Balance before · Installment this period · Balance after                 │
│ PERFORMANCE(monthly only) KPI · Attendance · perfFactor                             │
│ ██ NET PAY ████████████████████████████████████████████████████████████ ₱xxxxx ██  │
│ YTD        YTD Gross · YTD Net · 13th-Month accrual (est.)                          │
│ TIME LOG   (weekly only) Day/In/Out/Hours grid                                      │
│ SIGNATURES Prepared by (Finance) · Verified by (HR) · Approved by (President)        │
└ footer: doc-number · period ─────────────────────────────────────────────────────┘
```

### Spec 4 — `window.renderPayslipPage(model)` + print CSS (no pop-ups; Decision 7)

Insert in departments.js (near buildPayslipHTML). Renders into `#page-content`; the "Print / Save PDF" button calls `window.print()` on the same document.

```js
window.renderPayslipPage = function(model, backFn) {
  const host = document.getElementById('page-content');
  host.innerHTML = `
    <div class="no-print" style="display:flex;gap:8px;align-items:center;margin-bottom:14px">
      <button class="btn-secondary btn-sm" id="ps-back-btn">← Back</button>
      <button class="btn-primary btn-sm" onclick="window.print()">🖨 Print / Save PDF</button>
      ${model.proofUrl?`<a class="btn-secondary btn-sm" href="${safeHttpUrl(model.proofUrl)}" target="_blank">📎 Transfer Proof</a>`:''}
    </div>
    <div class="payslip-print">${buildPayslipHTML(model)}</div>`;
  document.getElementById('ps-back-btn').addEventListener('click', ()=> (backFn ? backFn() : history.back()));
  if (window.lucide) lucide.createIcons();
};
```

Print CSS — add ONCE to `css/styles.css` (this is the WS14 two-tier page-break pattern generalized; if WS14's `Letterhead.printCSS()` lands it supersedes this, but the class names here are payslip-scoped so they don't collide):
```css
.payslip-print{max-width:210mm;margin:0 auto;background:#fff;color:#000;padding:14mm;font:11px/1.4 Arial,sans-serif;}
.payslip-print .lh-head{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;border-bottom:2.5px solid #1E3A5F;padding-bottom:8px;margin-bottom:10px;}
.payslip-print .lh-logo{height:56px;object-fit:contain;flex-shrink:0;}
.payslip-print .lh-name{font-size:15pt;font-weight:900;color:#1E3A5F;letter-spacing:.4px;}
.payslip-print .lh-sub{font-size:8.5pt;color:#555;margin-top:2px;}
.payslip-print .lh-doc{text-align:right;} .payslip-print .lh-title{font-size:13pt;font-weight:900;color:#1E3A5F;}
.payslip-print .lh-no{font-size:10pt;font-weight:700;margin-top:3px;} .payslip-print .lh-date{font-size:9pt;color:#555;}
.payslip-print .ps-badge-proj{background:#c62828;color:#fff;font-weight:700;font-size:9pt;padding:3px 8px;border-radius:4px;display:inline-block;margin:6px 0;}
.payslip-print .ps-sec-h{background:#1E3A5F;color:#fff;font-weight:700;font-size:9pt;text-transform:uppercase;letter-spacing:.05em;padding:4px 8px;margin-top:12px;}
.payslip-print table.ps-t{width:100%;border-collapse:collapse;}
.payslip-print .ps-t td,.payslip-print .ps-t th{border:1px solid #ccc;padding:4px 6px;font-size:9.5pt;}
.payslip-print .ps-t .lbl{font-weight:700;font-size:8.5pt;text-transform:uppercase;color:#444;width:14%;}
.payslip-print .ps-t .num{text-align:right;}
.payslip-print .ps-gross td{font-weight:800;background:#e8eaf6;}
.payslip-print .ps-sub td{font-weight:700;background:#f2f4f8;}
.payslip-print .ps-net td{font-weight:900;font-size:13pt;background:#1E3A5F;color:#fff;}
.payslip-print .ps-sigs{display:flex;gap:24px;margin-top:28px;}
.payslip-print .ps-sig{flex:1;text-align:center;} .payslip-print .ps-sig-line{border-top:1px solid #000;padding-top:5px;min-height:28px;font-weight:700;}
.payslip-print .ps-sig-lbl{font-size:8pt;color:#666;margin-top:2px;}
.payslip-print .ps-foot{margin-top:20px;padding-top:8px;border-top:1px solid #eee;font-size:8pt;color:#999;text-align:center;}
@media print{
  body *{visibility:hidden;} .payslip-print,.payslip-print *{visibility:visible;} .no-print{display:none!important;}
  .payslip-print{position:absolute;left:0;top:0;width:100%;padding:8mm;}
  /* two-tier page-break: tables flow, rows/headers stay whole (WS14 aab024a pattern) */
  .payslip-print table.ps-t{page-break-inside:auto;break-inside:auto;}
  .payslip-print thead{display:table-header-group;}
  .payslip-print tr,.payslip-print .ps-sigs{page-break-inside:avoid;break-inside:avoid;}
  @page{margin:11mm 10mm 7mm;}
}
```

### Spec 5 — Call-site surgery (before → after)

**(a) Wire the two dead print buttons — `renderPayrollManagement` (departments.js, after the `raise-history-btn` wiring at line 2614):**
```js
// AFTER (add):
document.getElementById('print-slip-btn'); // (none today)
document.getElementById('payroll-tbody').addEventListener('click', async (e)=>{
  const b = e.target.closest('.print-slip-btn'); if(!b) return;
  const month = document.getElementById('pr-month-sel').value;
  const runDoc = await db.collection('pay_runs').doc(month).get().catch(()=>null);
  const line = runDoc?.exists ? (runDoc.data().lines||[]).find(l=>l.uid===b.dataset.uid) : null;
  let model;
  if (line) { model = toPayslipModel({...line, month}, 'monthly'); model.official = runDoc.data().state==='disbursed'; }
  else {  // interim projection (pre-WS20): build a projected line
    const emp = employees.find(u=>u.id===b.dataset.uid);
    model = toPayslipModel({ ...emp, uid:emp.id, month, base:emp.salary }, 'monthly'); model.official = false;
  }
  model.ytd = await payslipYtdMonthly(b.dataset.uid, (window.bizYear?bizYear():new Date().getFullYear()));
  renderPayslipPage(model, ()=>navigateTo('finance')); // back to Finance/Payroll
});
document.getElementById('print-payroll-btn').addEventListener('click', async ()=>{
  const month = document.getElementById('pr-month-sel').value;
  const runDoc = await db.collection('pay_runs').doc(month).get().catch(()=>null);
  const lines = runDoc?.exists ? (runDoc.data().lines||[]) : [];
  if(!lines.length){ Notifs.showToast('No computed pay run for this month yet.','error'); return; }
  const host = document.getElementById('page-content');
  host.innerHTML = `<div class="no-print" style="margin-bottom:14px"><button class="btn-secondary btn-sm" id="ps-back-btn">← Back</button> <button class="btn-primary btn-sm" onclick="window.print()">🖨 Print All</button></div>` +
    (await Promise.all(lines.map(async l=>{ const mdl=toPayslipModel({...l,month},'monthly'); mdl.official=runDoc.data().state==='disbursed'; mdl.ytd=await payslipYtdMonthly(l.uid,(window.bizYear?bizYear():new Date().getFullYear())); return `<div class="payslip-print" style="page-break-after:always">${buildPayslipHTML(mdl)}</div>`; }))).join('');
  document.getElementById('ps-back-btn').addEventListener('click', ()=>navigateTo('finance'));
});
```

**(b) `printPayslip()` (app.js:4666-4685) — DELETE the whole function; replace its callers.** The self-service employee button (app.js:4393, `onclick="printPayslip()"`) becomes:
```html
<!-- BEFORE --> <button class="btn-secondary" ... onclick="printPayslip()">Generate Payslip PDF</button>
<!-- AFTER  --> <button class="btn-secondary" id="my-payslip-btn">Generate Payslip PDF</button>
```
with a handler (in the employee branch of `renderPersonalFinance`, near where `_payslipData` is built at app.js:4257):
```js
document.getElementById('my-payslip-btn')?.addEventListener('click', async ()=>{
  const month = (window.bizDate?bizDate():new Date().toISOString().slice(0,10)).slice(0,7);
  const uid = currentUser.uid, year = (window.bizYear?bizYear():new Date().getFullYear());
  const shSnap = await db.collection('salary_history').doc(`${uid}_${month}`).get().catch(()=>null);
  let model;
  if (shSnap?.exists) { model = toPayslipModel({...shSnap.data(), uid, month}, 'monthly'); model.official = true; }
  else { // projection from the same engine WS20 exposes (never the old multiplier)
    const line = window.computePayLine ? computePayLine(userProfile, {month, projection:true, policy:'flat'})
                 : {uid, month, base:userProfile.salary||0, allowance:userProfile.allowance||0, name:userProfile.displayName};
    model = toPayslipModel({...line, uid, month}, 'monthly'); model.official = false;
  }
  model.employee.name = userProfile.displayName||''; model.employee.idNumber = userProfile.employeeId||''; model.employee.department = (userProfile.department||'');
  model.ytd = await payslipYtdMonthly(uid, year);
  renderPayslipPage(model, ()=>navigateTo('finance'));
});
```

**(c) `printWorkerPayslip(uid,name,preloaded)` (app.js:4970-5004) — DELETE the whole function.** Its only caller is the Worker Profile panel button `#wp-payslip-btn` (app.js:4823). Rewire that listener to the unified page:
```js
// BEFORE: panel.querySelector('#wp-payslip-btn')?.addEventListener('click', () => printWorkerPayslip(uid, name, preloaded));
// AFTER:
panel.querySelector('#wp-payslip-btn')?.addEventListener('click', async () => {
  const month = (window.bizDate?bizDate():new Date().toISOString().slice(0,10)).slice(0,7);
  const year = (window.bizYear?bizYear():new Date().getFullYear());
  const shSnap = await db.collection('salary_history').doc(`${uid}_${month}`).get().catch(()=>null);
  let model;
  if (shSnap?.exists){ model = toPayslipModel({...shSnap.data(), uid, month}, 'monthly'); model.official = true; }
  else { model = toPayslipModel({ uid, month, name, base:preloaded?.salary||0, allowance:preloaded?.allowance||0, deductions:preloaded?.deductions||0 }, 'monthly'); model.official = false; }
  model.ytd = await payslipYtdMonthly(uid, year);
  renderPayslipPage(model, ()=>renderPersonalFinance(currentUser, currentRole));
});
```
Also DELETE the now-orphaned `_payslipData` construction (app.js:4257-4265) ONLY if nothing else reads `window._payslipData`; grep first — if the on-page KPI cards still use it, keep the object but drop its role as print payload.

**(d) Weekly generator — `collectPayslipData()` (departments.js:4206-4236):** add the optional ER field and keep `caBalanceBefore/After` (already present). Insert after `deductions:{...}`:
```js
    employerShare: null,   // Decision 3: weekly ER manual-only for now; WS21/WS39 may populate later
```
**`renderPayslipPreview`/`buildPayslipHTML` weekly caller (departments.js:4240-4248):** replace the `window.open(...);win.document.write(buildPayslipHTML(d));` popup with:
```js
// BEFORE: const win = window.open('','_blank'); if(!win){...} win.document.write(buildPayslipHTML(d)); win.document.close();
// AFTER:
const model = toPayslipModel(d, 'weekly');
model.ytd = await payslipYtdWeekly(d.workerId, (d.payPeriodStart||'').slice(0,4) || (window.bizYear?bizYear():new Date().getFullYear()));
renderPayslipPage(model, ()=>renderFinanceHRProfiles(deptContainer(), currentUser, currentRole));
```

### Spec 6 — firestore.rules diff (Decision 9; deploy SEPARATELY via `firebase deploy --only firestore:rules`)

```
// BEFORE (firestore.rules:668-674)
    match /payslips/{docId} {
      allow read: if isAuth() && (
        resource.data.userId == request.auth.uid || isFinanceOrAdmin()
      );
      allow create, update: if isAuth() && isFinanceOrAdmin();
      allow delete: if isAuth() && isPresident();
    }
// AFTER
    match /payslips/{docId} {
      allow read: if isAuth() && (
        resource.data.get('workerId', '') == request.auth.uid ||
        resource.data.get('linkedUid', '') == request.auth.uid ||
        isFinanceOrAdmin()
      );
      allow create, update: if isAuth() && isFinanceOrAdmin();
      allow delete: if isAuth() && isPresident();
    }
```
Uses `.get(field, default)` per memory firestore-rules-missing-field-throws (a doc missing `workerId` would otherwise deny). `linkedUid` is future-proofing for WS20 D3's `worker_profiles.linkedUid` bridge — harmless if never written. No other collection needs a rules change (monthly reads ride the existing `salary_history` owner-read block; ER/CA fields ride existing `payroll`/`pay_runs`/`salary_history` finance-write blocks).

### Spec 7 — firestore.indexes.json addition (weekly YTD; SEPARATE deploy `firebase deploy --only firestore:indexes`)

```json
{
  "collectionGroup": "payslips",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "workerId", "order": "ASCENDING" },
    { "fieldPath": "payPeriodStart", "order": "ASCENDING" }
  ]
}
```
Monthly YTD needs NO new index (reuses `salary_history (userId ASC, month DESC)`, indexes.json:45-49).

### Spec 8 — Field reconciliation table

| Field | Collection(s) | Type | Default | Notes |
|---|---|---|---|---|
| `sss, philhealth, pagibig, tax` | payroll, pay_runs.lines[], salary_history | number | 0 | EE share; **canonical lowercase** (WS21 D6). Readers use `?? philHealth / ?? pagIbig`. |
| `er` | pay_runs.lines[], salary_history | `{sss,philhealth,pagibig}` | absent → `—` | employer share, frozen (WS21 D10). |
| `employerShare` | payslips | `{sss,philhealth,pagibig}`\|null | null | NEW optional weekly ER; manual-only for now (Decision 3). |
| `caBalance` / `caPlanned` | pay_runs.lines[], salary_history | number | 0 | monthly CA before / installment (WS20/WS22). `after` derived. |
| `caBalanceBefore` / `caBalanceAfter` | payslips | number | 0 | **already written** (departments.js:4196-4197); now RENDERED. |
| `workerId` (rules) | payslips | — | — | rule now reads `workerId` not `userId` (Decision 9). No doc migration. |
| 13th-month accrual | — | — | — | NOT stored; display-computed `sum(year base)/12` (WS21 D7). |

### Spec 9 — Migration & rollout checklist (in order)

1. **Deploy rules** (Spec 6): `firebase deploy --only firestore:rules` — re-`git diff firestore.rules` first (memory deploy-recheck-full-file-diff; concurrent/OneDrive edits). This alone fixes worker self-read.
2. **Deploy index** (Spec 7): `firebase deploy --only firestore:indexes`; wait for it to finish BUILDING before weekly YTD queries run (else they error → the `.catch(()=>({docs:[]}))` returns 0 YTD, non-fatal).
3. **Add the shared print CSS** (Spec 4) to `css/styles.css`.
4. **Add `toPayslipModel`, `payslipYtdMonthly`, `payslipYtdWeekly`, `renderPayslipPage`, `payslipHeader`/`_payslipLetterheadFallback`** and REPLACE `buildPayslipHTML` in departments.js (Spec 2-4).
5. **Call-site surgery** (Spec 5 a-d) in departments.js + app.js; DELETE `printPayslip` and `printWorkerPayslip`.
6. **No field backfill needed.** Casing-tolerant reads (`?? philHealth`, `?? pagIbig`) + `?? 0` cover Jan–Jun 2026 `salary_history` rows. Old `payslips` docs lacking `employerShare` render ER as `—`; lacking nothing for CA (before/after already present).
7. **CACHE_VER bump** in sw.js — auto via pre-commit hook (do not hand-edit). departments.js + app.js + css/styles.css all changed, so the hook covers it.
8. **Sequencing vs siblings:** WS24 depends on **WS20** for the frozen `pay_runs.lines[]`/mirror shape and **WS21** for the `er` fields — build WS24 AFTER (or same window as) both. Until WS20 lands, WS24 runs in PROJECTION mode (official:false badge) and still fixes the dead buttons, deletes the duplicate generators, and ships the ONE template. **WS22** supplies `line.caBalance`/`caPlanned`; until it lands, CA falls back to `caDeducted`/0. **WS14** letterhead is consumed if `window.Letterhead` exists, else the inline DTI fallback — WS24 does NOT block on WS14.

### Spec 10 — Manual test checklist (no automated suite)

1. **Employee self-service, disbursed month:** log in as a regular employee whose current month is disbursed → Finance → "Generate Payslip PDF" → full in-app page (NOT a popup), Back button returns to Finance, all sections present, EE+ER columns filled, CA before/installment/after correct, YTD gross/net non-zero, NO projection badge.
2. **Employee self-service, not-yet-disbursed month:** same button → red `PROJECTION — not yet disbursed` badge shows; numbers come from `computePayLine` projection, not the old multiplier.
3. **Finance per-row 🖨:** Finance → Payroll → any row's 🖨 → that employee's payslip page; Back → Finance.
4. **Finance 🖨 Print All:** → stacked payslips, one per `pay_runs.lines[]` entry, `page-break-after` between them; browser print preview shows each on its own page (no blank page 1 — verifies the two-tier CSS).
5. **Manager Worker-Profile 🖨 Payslip:** President/manager → Team Payroll → Profile → 🖨 Payslip → same unified page (confirms `printWorkerPayslip` deletion did not break the panel).
6. **Weekly worker payslip:** HR → Payslips → generate/preview → in-app page with the Daily Time Log grid, CA before/after populated (previously invisible), YTD weekly sum shown, JPEG export still works.
7. **Casing regression:** open a payslip for a month whose `salary_history` was written by the old Path-A writer (mixed-case `philHealth`/`pagIbig`) → PhilHealth/Pag-IBIG render real numbers, not ₱0.00.
8. **Worker self-read (post rules deploy):** if a worker has a login, confirm they can read their own `payslips` doc (rule now matches `workerId`).
9. **Print output:** actually print-preview a long payslip (many time-log rows) → header repeats, rows stay whole, signature block not split, page 1 not blank.
10. **No-popup verification:** confirm nothing calls `window.open` for payslips anymore (`grep -n "window.open" js/app.js js/departments.js` shows no payslip callers).

## ‼️ SEAM RECONCILIATION (Fable orchestrator, post-merge 2026-07-10)
WS14 was decided in the SAME batch as this brief; the two ran in parallel so their letterhead
API names diverged. **WS14 is the owner and is CANONICAL.** The real interface is:
`window.buildLetterhead(opts) -> { headerHTML, footerHTML, printCSS }` (NOT `window.Letterhead.header()`).
Sonnet: implement WS24 against `window.buildLetterhead`. Keep the self-contained fallback for the
case where buildLetterhead is absent (e.g. a print window that didn't load config.js), but call the
canonical name. Concretely, in Spec 0 replace `window.Letterhead.header({...})` with
`window.buildLetterhead({docType, docTitle, docNumber, dateLabel, entity, sub}).headerHTML` and
`window.buildLetterhead(...).printCSS`. The `entity` field selects DTI vs OPC legal identity — read
it from `window.BRAND.legal` (WS9 canonical). The payslip's legal-entity question ('‼️ FLAG FOR NEIL')
is resolved centrally in WS14: payslips print the **DTI taxpayer** identity (dtiName/dtiTin) since
that is the registered BIR employer today.

## Risks / cross-workstream interactions

- ⚠️ `firestore.rules:669-671` (`match /payslips/{docId} { allow read: if isAuth() && (resource.data.userId == request.auth.uid || isFinanceOrAdmin()); ...}`) checks `resource.data.userId`, but `collectPayslipData()` (departments.js:4203) writes the field as `workerId`, never `userId`. The owner-read branch of this rule is therefore DEAD — it can never evaluate true — so today a production worker can NEVER read their own payslip doc even if they had an Auth account, only finance/admin can. This is exactly the kind of rules-coverage gap flagged in memory (firestore-rules-collection-coverage.md) and must be resolved (rename the field, or fix the rule) as part of any unification, especially since workstream 27 plans to unblock worker login — once workers CAN log in, this silently-broken rule becomes user-visible.
- ⚠️ Two writers race on the same `salary_history/{uid}_{month}` doc with incompatible field sets and merge semantics (departments.js:2642-2650 vs app.js:4131-4139, detailed in dataModel/constraints above) — whichever a unified payslip reads from, it must tolerate the doc having sss/philHealth/pagIbig/tax/caDeducted MISSING if the app.js path ran last and clobbered them. This is squarely workstream 20's fix but blocks workstream 24 from trusting `salary_history` as a stable read model until resolved — direct cross-workstream dependency (24 ← 20).
- ⚠️ Field-name casing is inconsistent across the SAME concept in different collections: `payroll/{uid}` uses lowercase `philhealth`/`pagibig`; `salary_history` (departments.js writer) uses `philHealth`/`pagIbig` (capitalized); the weekly `payslips` doc uses `deductions.govt.philhealth`/`.pagibig` (lowercase, nested). A unified template's field-mapping layer must normalize this explicitly or it will silently render ₱0 for one path while working for another.
- ⚠️ `printWorkerPayslip` (app.js:4970) reads `db.collection('users').doc(uid)` for pay data as a fallback (`u.salary`) even though pay was deliberately migrated OFF the `users` doc onto `payroll/{uid}` (app.js:461-462 comment). It currently only works correctly because the caller always supplies `preloaded.salary` from a `fetchUsersWithPayroll()`-merged row — if this function is ever called with a bare uid and no `preloaded` object (e.g. refactored during unification), it will silently show ₱0 pay instead of erroring.
- ⚠️ `payslips.caBalanceBefore`/`caBalanceAfter` are computed and stored (departments.js:4199-4200) but never rendered in `buildPayslipHTML` (grepped the full template, departments.js:4256-4495, confirmed absent) — an easy-to-miss 'the data already exists, just wire it up' item that could get lost if Fable assumes CA-balance-on-payslip requires new fields.
- ⚠️ The `payslips` collection's only composite index (firestore.indexes.json:69-74, `payPeriodMonth ASC, createdAt DESC`) does not support a per-worker time-range query needed for weekly-worker YTD; adding one requires a `firestore.indexes.json` change AND `firebase deploy --only firestore` per CLAUDE.md's explicit 'When you add a query that needs a composite index... update these files and deploy' rule — easy to defer/forget since index deploys are separate from `git push` app deploys (memory note firebase-deploy-rules.md: git push does NOT deploy firestore.rules or indexes).
- ⚠️ This workstream directly overlaps workstream 14 (shared letterhead engine — 'ALL printables adopt it') and workstream 21 (statutory tables — computes the ER shares 24 needs to display) and workstream 22 (CA installments/running balance in payroll — same UI surface, same `cash_advances`/`payroll_ca_overrides` data) and workstream 20 (kills the second Compute path whose output 24 would otherwise read). Building 24 before 14/20/21/22 land risks throwaway work; building it after requires Fable to explicitly state the dependency order in its build spec.
- ⚠️ All THREE working print paths (`printPayslip`, `printWorkerPayslip`, `buildPayslipHTML`) use `window.open('','_blank')`; if the browser blocks the popup (already handled defensively in departments.js:4243/4251 with `if (!win) { Notifs.showToast('Allow popups...','error'); return; }` but NOT in app.js's `printPayslip`/`printWorkerPayslip`, which just call `window.open` unguarded at app.js:4671/4986) a null-window `.document.write` will throw. Any unified implementation should standardize the popup-blocked guard (or move off popups entirely per the owner's no-pop-ups directive, see openDecisions).
- ⚠️ `isRealPresident`/`isFinancePriv`/`isFinanceOrAdmin` RBAC checks are inconsistent across the three surfaces (e.g. `renderPayrollManagement` gates the raise/edit buttons on `canFinance()` (departments.js:2148 `const canFinance = isFinancePriv()`), while `renderFinanceHRProfiles`'s worker-payslip generation is gated on the same `isFinancePriv()` (departments.js:3578) but its DELETE path routes through `window.financeDelete` (the president-approval gate documented in memory finance-delete-approval.md) — a unified payslip's edit/delete/void flow needs to decide which of these two existing patterns (direct finance edit vs. president-approved delete) it inherits for a filed/submitted payslip, since payslips currently have NO delete-approval routing at all (departments.js:3845 `db.collection('payslips').doc(ps.id).update(...)` direct writes, contradicting the 'finance can edit everything but deletes route through approval' rule for other finance docs).

## Files likely touched

`js/app.js — renderPersonalFinance (employee + president branches), window._payslipData construction, printPayslip(), openWorkerProfilePanel/renderWorkerProfileTab, printWorkerPayslip(), the 'Record Monthly Payroll' handler (record-payroll-btn) if workstream 20 sequencing requires touching the second compute path`, `js/departments.js — renderPayrollManagement (print-payroll-btn/print-slip-btn wiring), renderFinanceHRProfiles, openPayslipGenerator, collectPayslipData, previewPayslip/renderPayslipPreview, buildPayslipHTML, openPayslipHistory/openPayslipEdit (payslips workflow), the Compute Payroll salary_history writer`, `firestore.rules — payslips/worker_profiles/payroll/salary_history match blocks (fix the userId vs workerId mismatch at minimum; possibly new fields/collections for YTD rollups or ER-share storage)`, `firestore.indexes.json — likely a new composite index if weekly-worker YTD is computed by querying payslips by workerId over time`, `css/styles.css — .payslip-row and any new shared letterhead/print classes (currently payslip print CSS is inlined per-function, not in styles.css at all)`, `sw.js — CACHE_VER bump (required by CLAUDE.md on any JS/CSS edit)`, `Possibly a new shared module/section (e.g. a 'letterhead.js' or a section within departments.js) if workstream 14's letterhead engine is built as a reusable function this workstream calls into`

## Expected deliverable format

> Fable's output for this workstream should give Sonnet everything needed to implement mechanically, specifically: (1) An explicit DECISION section resolving each item in openDecisions above (data model shape for unified vs. dual-collection, ER-share field location, YTD strategy for weekly workers, CA before/after display rule, sequencing vs. workstreams 14/20/21/22) — stated as decisions, not options. (2) Exact new/changed Firestore field names and types for every touched collection (payroll/{uid}, salary_history, payslips, worker_profiles, cash_advances if touched), explicitly reconciling the philhealth/philHealth and pagibig/pagIbig casing conflict with ONE canonical spelling and a migration note for existing docs using the other casing. (3) A full before/after code diff (or exact replacement function bodies) for: printPayslip() (app.js), printWorkerPayslip() (app.js) — state explicitly whether it is deleted/merged, the print-payroll-btn/print-slip-btn wiring in renderPayrollManagement (departments.js) — either wire them to the new unified function or remove the dead buttons, and buildPayslipHTML()/collectPayslipData() (departments.js). (4) The exact new/modified firestore.rules diff (fixing the workerId/userId mismatch at minimum) and any firestore.indexes.json addition, called out as a SEPARATE deploy step per CLAUDE.md's rules-vs-app-deploy split. (5) A numbered migration/rollout checklist covering: backfilling or normalizing any renamed/recast fields on existing salary_history and payslips docs, the CACHE_VER bump, and the order relative to workstreams 14/20/21/22 (state which of those must land first vs. which can follow). (6) Explicit before/after mockup or HTML skeleton of the ONE payslip template showing where each of base/allowance/EE-statutory/ER-statutory/CA-installment/CA-running-balance/YTD/net sits, reusable across both the monthly and weekly pay cycles, so Sonnet can drop in real data without redesigning layout.
