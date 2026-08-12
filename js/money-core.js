// ═══════════════════════════════════════════════════════════
//  js/money-core.js — pure money-math (v14 Wave 2 Batch A, spec item I5)
//  No DOM, no Firebase, no side effects. Verbatim-moved from js/departments.js
//  so the math is independently testable (tests/money.test.mjs, node:test)
//  without booting the whole app. Browser callers are unaffected — these still
//  attach to window.vatSplit / window.computePayLine exactly as before; this
//  file just now DEFINES them (loaded BEFORE departments.js in index.html, so
//  departments.js's callers resolve the same window globals as always).
//
//  Moved verbatim (byte-identical function bodies — see Wave 2 report):
//    window.vatSplit       — was departments.js ≈9875 (sale/project VAT split)
//    window.computePayLine — was departments.js ≈3194 (v12 WS20 payroll engine,
//                             per-employee math half of the "ONE PAYROLL ENGINE"
//                             trio). computePayRun/disbursePayRun stayed in
//                             departments.js — they read/write Firestore and
//                             are not pure functions, so out of scope for this
//                             batch's extraction.
// ═══════════════════════════════════════════════════════════

// UMD-ish shim: this file is written in the same "window globals" convention
// as every other js/*.js in this app (no ES modules yet — see Wave 2 spec).
// This one line just makes `window` exist under plain Node so tests can
// `require()` this file directly, with zero build step and zero test-only
// global stubbing. In the browser, window already exists, so this is a no-op.
if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

// ---- moved verbatim from js/departments.js ≈9868-9886 ----
// Split an entered amount into {recorded, net, vat} for a given VAT treatment.
// `recorded` is what hits the ledger + project balance (the cash figure); `net`
// is revenue net of VAT; `vat` is the output VAT. Used by the sale + project
// billing flows so each sale's VAT is stored per-entry (it varies by quote).
//   inclusive → the amount already contains 12% VAT
//   exclusive → 12% is added on top of the amount
//   exempt    → zero-rated / VAT-exempt, no VAT
window.vatSplit = function(entered, treatment) {
  const a = +entered || 0;
  if (treatment === 'exclusive') {
    const vat = +(a * 0.12).toFixed(2);
    return { recorded: +(a + vat).toFixed(2), net: +a.toFixed(2), vat };
  }
  if (treatment === 'exempt') {
    return { recorded: +a.toFixed(2), net: +a.toFixed(2), vat: 0 };
  }
  const net = +(a / 1.12).toFixed(2); // inclusive (default)
  return { recorded: +a.toFixed(2), net, vat: +(a - net).toFixed(2) };
};

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

// ---- moved verbatim from js/departments.js ≈3194-3243 ----
window.computePayLine = function(emp, ctx) {
  const policy = ctx.policy || 'flat';
  const base   = emp.salary || 0;
  const allowance = emp.allowance || 0;
  const otherDeductions = emp.deductions || 0;
  // Owner ruling 2026-08-07 — "Other Deductions" is used for BOTH kinds of
  // thing depending on the employee, and the two book differently:
  //   WITHHELD  (cash bond, canteen, uniform, non-CA staff loan) — the company
  //             holds the money and owes it onward. Full gross is a real
  //             payroll expense; the withheld part is a LIABILITY.
  //   UNEARNED  (absence, tardiness, penalty) — pay that was never earned. It
  //             is not withheld money at all, so the payroll EXPENSE itself is
  //             lower by that amount and there is nothing to owe.
  // `deductionsUnearned` on payroll/{uid} splits the total. Absent/0 -> the
  // whole amount is treated as withheld, which is byte-identical to every
  // figure this function produced before (effectiveGross == gross under flat),
  // so all existing payroll docs, every frozen pay_run line and all 97 pinned
  // tests are unaffected. Clamped into [0, otherDeductions] so a stale or
  // mistyped value can never invent expense or a negative liability.
  const unearnedDeductions = Math.min(Math.max(emp.deductionsUnearned || 0, 0), otherDeductions);
  const withheldDeductions = _round2(otherDeductions - unearnedDeductions);
  const gross = base + allowance; // nominal — statutory brackets key off THIS, not the performance-adjusted figure

  // Statutory: a hand-typed non-zero value on payroll/{uid} always wins over the
  // WS21 table suggestion (Finance can override real edge cases); er (employer
  // share) is never hand-typed — always computed and frozen.
  // Payroll recall spec §A4 — the ONLY permitted edit inside this frozen
  // function: statutory year keys off the RUN MONTH being paid (ctx.month),
  // not "whatever year it happens to be when Compute is clicked". Before this,
  // recomputing a delayed 2025-12 run in 2026 silently applied 2026 brackets —
  // inconsistent with the D10 disburse gate, which already checks the run
  // month's own year (departments.js's _payYear). Falls back to bizYear()
  // exactly as before when ctx.month is absent/malformed, so every existing
  // same-year call site (and every pinned test that omits ctx.month) is
  // byte-identical to pre-spec behavior.
  const statYear = (ctx.month && /^\d{4}-\d{2}/.test(ctx.month))
    ? parseInt(ctx.month.slice(0,4), 10)
    : (window.bizYear ? window.bizYear() : new Date().getFullYear());
  const stat = window.computeStatutory
    ? window.computeStatutory({ grossPay: gross, year: statYear })
    : null;
  // Statutory-config spec (2026-08-06) — the second permitted edit to this
  // frozen function (after §A4). resolveStatutoryEE (above) reproduces the
  // old five lines byte-for-byte whenever emp.statConfig is absent — every
  // existing payroll/{uid} doc, every pinned test, every call site that
  // predates statConfig computes identically. New modes: exempt (a real 0,
  // EE and ER), fixed (typed amount wins even at 0), auto (table always).
  const { sss, philhealth, pagibig, tax, er } = window.resolveStatutoryEE(emp, stat);
  const statutoryTotal = sss + philhealth + pagibig + tax;

  const kpiScore   = ctx.kpiScore != null ? ctx.kpiScore : 1;
  const attScore   = ctx.attScore != null ? ctx.attScore : 1;
  const perfFactor = Math.min(1, Math.max(0, kpiScore*0.7 + attScore*0.3));

  const caPlan    = ctx.caPlan || [];
  const caPlanned = caPlan.reduce((s,p)=>s+(p.amount||0), 0);
  const caBalance = ctx.caBalance != null ? ctx.caBalance : caPlanned;

  // TASK-BASED-PAY-SPEC-2026-08-12 — the THIRD permitted edit to this frozen
  // function (after §A4's statutory year and the statutory-config resolver
  // above). Structural, not a fallback: 'taskbased' meeting a production
  // (weekly-paid) worker THROWS rather than silently computing 'flat' — a
  // silent fallback is exactly how a wrong pay model goes unnoticed for
  // months. Owner ruling 2026-08-12, verbatim: "thats for office, take note.
  // operation is done through attendance only by geo tracked timing in." The
  // weekly engine (computeWeeklyLine, below) never sees a policy at all —
  // this throw is the monthly-side half of that boundary.
  if (policy === 'taskbased' && emp.payClass === 'production') {
    throw new Error((emp.displayName || emp.email || 'This person') +
      ' is paid weekly on the Operations Team — task-based pay applies to the Office Team only. Nothing was worked out for them.');
  }

  // policy 'flat'        = exactly Path A today (unification changes no one's pay).
  // policy 'performance' = allowance scales by perfFactor; BASE WAGE is never
  // docked (PH labor-safe) — inert until the President flips payPolicy on a run.
  // policy 'taskbased'   = the owner's real formula (2026-08-12 ruling): the
  // WHOLE after-deduction remainder scales by perfFactor — net × (0.7·KPI +
  // 0.3·attendance). Deliberately AFTER statutory/otherDeductions are
  // subtracted (never before): government deductions above are computed on
  // the nominal `gross` and are NEVER themselves scaled by any policy branch
  // — the multiplier only ever touches the employee's take-home remainder,
  // never money owed to a third party (SSS/PhilHealth/Pag-IBIG/withholding,
  // or a withheld bond/canteen deduction). `_round2` is used here exactly as
  // it already is above (function hoisting — see that comment) because the
  // 0.7/0.3 blend is an irrational-in-binary float on purpose (§2.5 of the
  // spec) and must not be pre-rounded before this multiply.
  const netBeforeCA = policy === 'taskbased'
    ? _round2((gross - statutoryTotal - otherDeductions) * perfFactor)
    : policy === 'performance'
      ? (base - statutoryTotal - otherDeductions + allowance*perfFactor)
      : (gross - statutoryTotal - otherDeductions);
  const finalPay = netBeforeCA - caPlanned;
  // The TRUE economic cost of this line (what disbursePayRun's ledger debit
  // legs must balance against) — equals nominal `gross` under 'flat', but
  // correctly reflects a performance-scaled allowance under 'performance'
  // (an unearned allowance withholding is not a real company expense).
  // Same principle now applied to unearned deductions: absence/tardiness pay
  // the employee never earned is not a company expense either, so it comes
  // OUT of the expense debit. Withheld deductions stay in — that money was
  // earned and owed, it just has not been handed over yet.
  const effectiveGross = netBeforeCA + statutoryTotal + otherDeductions - unearnedDeductions;

  return {
    uid: emp.id, name: emp.displayName||emp.email, payClass: emp.payClass==='production'?'production':'regular',
    base, allowance, otherDeductions, unearnedDeductions, withheldDeductions,
    sss, philhealth, pagibig, tax, er,
    kpiScore, attScore, perfFactor, policy,
    caBalance, caPlanned, caPlan,
    gross, effectiveGross, statutoryTotal, netBeforeCA, finalPay,
    // TASK-BASED-PAY-SPEC-2026-08-12 §2.4 — CONDITIONAL key, taskbased only.
    // The existing pinned tests deepEqual the FULL return object for 'flat'
    // and 'performance'; an unconditional key here would fail every one of
    // them. Frozen (not reconstructed via netBeforeCA/perfFactor, which fails
    // at factor 0 and reintroduces float dust) so the traceability sentence
    // (js/pay-policy.js's payBasisSentence) always has the pre-multiplier
    // figure exactly as it was at the moment pay was worked out.
    ...(policy === 'taskbased' ? { preMultiplierNet: gross - statutoryTotal - otherDeductions } : {})
  };
};

// ---- v14 post-release — Break-even analysis (owner request: "Add a
// computation for breakeven. Rents etc.") --------------------------------
// Pure classification + break-even math. Takes ONE already period-bounded
// income figure + a {category: {income, expense}} rollup (same shape as
// finance_rollup/{yyyymm}.byCategory — see js/finance-ledger.js's
// _syncRollup/rebuildRollups) and pre-resolved fixed/variable category
// lists. This function does zero keyword-matching, zero Firestore, zero
// Date.now — js/screens/finance.js's Break-even screen is responsible for:
//   1. fetching the period via the SAME loadFinStatement() codepath the
//      Reports tab already uses (no second fetch machinery — see that
//      file's header for the shared-fetch proof), and
//   2. resolving the finance_config/breakeven doc (or the built-in default
//      keyword map when absent) down to plain arrays of EXACT byCategory
//      key strings before calling this function.
// Same inputs -> same outputs, always (no wall-clock dependency).
//
// ── MATH CONTRACT ──────────────────────────────────────────────────────
//   contributionMarginRatio (CMR) = (income - variableTotal) / income
//     income === 0             -> CMR = null (can't ratio against zero revenue)
//   breakEvenRevenue = fixedTotal / CMR
//     CMR null OR <= 0         -> breakEvenRevenue = 'n/a' (a CMR of exactly
//                                  zero or negative means variable costs already
//                                  consume 100%+ of every peso of revenue — no
//                                  amount of revenue scale-up alone ever breaks
//                                  even; NEVER divide and surface Infinity/NaN)
//   coveragePct = (income / breakEvenRevenue) * 100
//     breakEvenRevenue 'n/a'   -> coveragePct = null
//     breakEvenRevenue === 0   -> coveragePct = 100 (nothing left to cover)
//   gapToBreakEven = max(0, breakEvenRevenue - income)
//     breakEvenRevenue 'n/a'   -> gapToBreakEven = 'n/a'
//   perDayNeeded(daysInMonth) — a FUNCTION on the return object (not a
//     field): breakEvenRevenue / daysInMonth, or null if breakEvenRevenue
//     is 'n/a' or daysInMonth is missing/<=0. A function, not a baked-in
//     value, because "how many days" is a display concern the caller
//     supplies at render time — keeps this whole function deterministic
//     (see CLAUDE.md's Manila-time-helpers note on why raw Date math never
//     belongs inside a pure money function).
//
// ── CLASSIFICATION ─────────────────────────────────────────────────────
//   classifiedFixed / classifiedVariable = [{cat, amt}], one entry per
//     byCategory key found in classification.fixed / classification.variable
//     (case-SENSITIVE exact match against byCategory's own keys — the
//     caller already did any case-insensitive keyword matching and handed
//     back real category strings here).
//   manualFixed = [{label, amount}] (e.g. a landlord's rent that never
//     posts to the ledger as its own category) is ADDITIVE to
//     classifiedFixed/fixedTotal — each becomes {cat:label, amt:amount,
//     manual:true} appended to classifiedFixed.
//   unclassified = [{cat, amt}] for every byCategory key in NEITHER list —
//     SURFACED, never silently folded into fixed or variable (guessing
//     cost behavior would be dishonest; the screen renders these as a
//     warning row instead).
window.computeBreakeven = function(input) {
  const inp = input || {};
  const income = +inp.income || 0;
  const byCategory = inp.byCategory || {};
  const classification = inp.classification || {};
  const fixedSet = new Set(classification.fixed || []);
  const variableSet = new Set(classification.variable || []);
  const manualFixed = Array.isArray(inp.manualFixed) ? inp.manualFixed : [];

  const classifiedFixed = [];
  const classifiedVariable = [];
  const unclassified = [];
  let categoryFixedTotal = 0;
  let variableTotal = 0;

  Object.keys(byCategory).forEach(cat => {
    const row = byCategory[cat] || {};
    const amt = +(+row.expense || 0).toFixed(2);
    // v14 fix: a category with zero expense this period (e.g. a pure-income
    // category like 'Sales Revenue'/'Other Income' — the caller bumps BOTH
    // income and expense arrays into the same byCategory map, see js/screens/
    // finance.js's renderBreakevenTab) contributes nothing to either fixed or
    // variable costs. Previously it still landed in `unclassified` (no
    // keyword ever matches "sales"/"income"), producing a phantom ₱0.00 row
    // that confused users into thinking a revenue account needed a Fixed/
    // Variable tag. Skipping it here is provably safe: amt=0 adds 0 to every
    // downstream sum either way, so no totals change for any real cost
    // category — only the spurious zero-amount noise disappears from all
    // three buckets (classifiedFixed/classifiedVariable/unclassified).
    if (amt <= 0) return;
    if (fixedSet.has(cat)) {
      classifiedFixed.push({ cat, amt });
      categoryFixedTotal += amt;
    } else if (variableSet.has(cat)) {
      classifiedVariable.push({ cat, amt });
      variableTotal += amt;
    } else {
      unclassified.push({ cat, amt });
    }
  });

  let manualTotal = 0;
  manualFixed.forEach(m => {
    const amt = +(+((m && m.amount) || 0)).toFixed(2);
    classifiedFixed.push({ cat: (m && m.label) || 'Manual fixed cost', amt, manual: true });
    manualTotal += amt;
  });

  const fixedTotal = +(categoryFixedTotal + manualTotal).toFixed(2);
  variableTotal = +variableTotal.toFixed(2);

  const contributionMarginRatio = income > 0 ? (income - variableTotal) / income : null;

  let breakEvenRevenue;
  if (contributionMarginRatio === null || contributionMarginRatio <= 0) {
    breakEvenRevenue = 'n/a';
  } else {
    breakEvenRevenue = +(fixedTotal / contributionMarginRatio).toFixed(2);
  }

  let coveragePct, gapToBreakEven;
  if (breakEvenRevenue === 'n/a') {
    coveragePct = null;
    gapToBreakEven = 'n/a';
  } else if (breakEvenRevenue === 0) {
    coveragePct = 100;
    gapToBreakEven = 0;
  } else {
    coveragePct = +((income / breakEvenRevenue) * 100).toFixed(2);
    gapToBreakEven = +Math.max(0, breakEvenRevenue - income).toFixed(2);
  }

  function perDayNeeded(daysInMonth) {
    if (breakEvenRevenue === 'n/a') return null;
    const d = +daysInMonth || 0;
    if (d <= 0) return null;
    return +(breakEvenRevenue / d).toFixed(2);
  }

  return {
    fixedTotal, variableTotal, contributionMarginRatio,
    breakEvenRevenue, coveragePct, gapToBreakEven, perDayNeeded,
    classifiedFixed, classifiedVariable, unclassified
  };
};

// ---- payroll recall spec (2026-08-04) — month-scoped inputs + overrides ----
// Private rounding helper, scoped to this file only (statutory-tables.js has
// its own identically-shaped `round2` — deliberately NOT imported/shared per
// spec §C2: these are independent files, no cross-file coupling needed for
// two lines of arithmetic).
function _round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// window.monthBounds(month, todayStr) — §A1. Pure string/integer date math,
// NO Date object, NO Intl (money-core's contract: no DOM, no Firebase, no
// wall-clock — see file header). `month` is 'YYYY-MM', `todayStr` is
// 'YYYY-MM-DD' (callers pass window.bizDate(); tests pass fixtures).
window.monthBounds = function(month, todayStr) {
  const y  = parseInt(month.slice(0,4), 10);
  const mo = parseInt(month.slice(5,7), 10); // 1-12
  const isLeap = (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0));
  const DAYS_IN_MONTH = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const daysInMonth = DAYS_IN_MONTH[mo - 1];
  const startDate  = `${month}-01`;
  const todayMonth = todayStr.slice(0, 7);
  const isCurrent  = month === todayMonth;
  const isFuture   = month > todayMonth; // safe string compare on 'YYYY-MM'

  let endDate, upToDay;
  if (isFuture) {
    // A future month has no data yet — callers must treat this as "no data"
    // (see §A2's getAttendanceScore, which returns 1 for a future month).
    // endDate/upToDay carry no real meaning here; upToDay:0 is the signal.
    endDate = startDate;
    upToDay = 0;
  } else if (isCurrent) {
    endDate = todayStr;
    upToDay = parseInt(todayStr.slice(8, 10), 10);
  } else {
    endDate = `${month}-${String(daysInMonth).padStart(2, '0')}`;
    upToDay = daysInMonth;
  }
  return { startDate, endDate, upToDay, daysInMonth, isCurrent, isFuture };
};

// window.computeKpiForMonth — §A3.3. Pure; mirrors the exact 0.7/0.3 formula
// departments.js's computePayRun used to inline (task-completion ratio +
// deliverable score), scoped to a single calendar month instead of "the
// employee's entire task history as it exists today". resolveDoneMonth/
// resolveCreatedMonth are injected (production callers pass window.
// taskDoneMonth/window.taskCreatedMonth) so this stays Firestore/Date-free
// and testable with plain stub functions.
//
// Scope rules for a task t against month M (string compares on 'YYYY-MM';
// '' compares <= everything — the intended "legacy task, counts" semantics):
//   dm = resolveDoneMonth(t)    -> null (not done) | '' (done, undatable) | 'YYYY-MM'
//   cm = resolveCreatedMonth(t) -> '' (no createdAt — existed since forever) | 'YYYY-MM'
// A task whose cm > M didn't exist yet during M — always out of scope,
// checked first (takes priority over every other rule, including the
// done-but-undatable conservative-count below).
window.computeKpiForMonth = function(userTasks, month, delivScore, resolveDoneMonth, resolveCreatedMonth) {
  const tasks = Array.isArray(userTasks) ? userTasks : [];
  let doneInM = 0, inScopeCount = 0;
  for (const t of tasks) {
    const dm = resolveDoneMonth(t);
    const cm = resolveCreatedMonth(t) || '';
    if (cm > month) continue; // didn't exist yet -> out of scope entirely
    if (dm === month || dm === '') {
      // Completed in M, OR done-but-undatable (no completedAt/approvedAt/
      // lastModifiedAt to resolve a month from). We already know cm <= M
      // here, so the undatable case counts conservatively as done-in-scope —
      // an old finished task should never zero out a later month's KPI.
      inScopeCount++; doneInM++;
    } else if (dm === null) {
      inScopeCount++; // open during M, not (yet) done -> denominator only
    } else if (dm > month) {
      inScopeCount++; // finished AFTER M -> was open/unfinished during M -> denominator only
    }
    // else: dm !== null && dm < month -> finished before M -> out of scope (no-op)
  }
  if (inScopeCount === 0) return 1; // WS20 D2 floor: no in-scope work ≠ bad KPI
  const taskScore = Math.min(1, doneInM / inScopeCount);
  const deliv = (typeof delivScore === 'number') ? Math.min(1, delivScore / 100) : 1;
  return taskScore * 0.7 + deliv * 0.3;
};

// window.applyPayLineOverride — §C2. Applies an OverrideEntry's OUTPUT
// override (finalPay) on top of an already-computed line. Input overrides
// (kpiScore/attScore/allowance/otherDeductions) are applied BEFORE
// computePayLine runs (see departments.js's computePayRun §C3 — empEff/
// kpiEff/attEff) — this function only shifts finalPay/netBeforeCA/
// effectiveGross by the same delta, which is what keeps disbursePayRun's
// ledger identity balanced (debits == credits) even when a manual finalPay
// override is in effect. Never mutates its `line` argument.
window.applyPayLineOverride = function(line, ovr) {
  const out = { ...line };
  if (!ovr) return out; // no entry passed -> plain copy, no overridden flag at all
  const fields = ['kpiScore','attScore','allowance','otherDeductions','finalPay']
    .filter(k => typeof ovr[k] === 'number' && Number.isFinite(ovr[k]));
  if (typeof ovr.finalPay === 'number' && Number.isFinite(ovr.finalPay) && ovr.finalPay !== line.finalPay) {
    const delta = _round2(ovr.finalPay - line.finalPay);
    out.finalPay       = _round2(line.finalPay + delta);       // == ovr.finalPay
    out.netBeforeCA    = _round2(line.netBeforeCA + delta);
    out.effectiveGross = _round2(line.effectiveGross + delta); // keeps effectiveGross = netBeforeCA + statutoryTotal + otherDeductions
  }
  out.overridden = true;
  out.overrideMeta = {
    fields, note: ovr.note, setBy: ovr.setBy, setByName: ovr.setByName,
    setAt: (ovr.setAt && typeof ovr.setAt.toMillis === 'function') ? ovr.setAt.toMillis() : (ovr.setAt || null),
    original: ovr.original
  };
  return out;
};

// ═══════════════════════════════════════════════════════════
//  WEEKLY (Operations Team) PAY — computeWeeklyLine
//  TYPE-B-WEEKLY-PAYROLL-SPEC.md step 4. ADDITIVE: nothing above this line
//  changed, so every existing pinned test still pins the same behaviour.
//
//  Exists so the weekly run and the payslip form share ONE expression. This
//  repo has already been bitten by a preview/engine divergence in payroll —
//  the number a person sees before submitting must be produced by the same
//  code that writes the payslip, not by a second copy of the arithmetic.
//
//  THE FOUR OWNER RULINGS (2026-08-08) THIS ENCODES
//   1. The pay week is MONDAY–SUNDAY, seven days. Before this the payslip
//      generator laid out Mon–Sat while the worker's own phone showed Mon–Sun,
//      so a Sunday shift could appear in the worker's estimate and fall outside
//      the period actually paid. Seven days resolves that in the worker's
//      favour. It is a PERIOD decision, not a premium decision — Sunday hours
//      are paid like any other hours.
//   2. No clock-in = ABSENT (zero hours, zero pay), with an admin override that
//      is RECORDED, never silent: who, when, and a reason. Without the override
//      a forgotten punch quietly costs a worker a day's pay and nobody sees it;
//      without the record, the override itself is unauditable.
//   3. Overtime at the PLAIN hourly rate (confirming what the app already did).
//      TRAVEL is a NEW component paid at HALF the hourly rate.
//   4. One disburse for the whole week — that is the run's shape (step 5), not
//      this function's; this only has to be callable per worker inside it.
//
//  STILL ABSENT BY CHOICE: holiday, rest-day and night-differential premiums.
//  The owner has not asked for them. FLAG TO THE ACCOUNTANT before this is
//  systematised — PH labour rules do prescribe premiums, and a weekly run
//  applies whatever it is given to everyone, every week, automatically.
// ═══════════════════════════════════════════════════════════

// The seven pay-week days in order, Monday first (PH convention). Exported so
// the form, the run and the tests cannot disagree about the week's shape.
window.WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
window.TRAVEL_RATE_FACTOR = 0.5;   // ruling 3 — travel is half the normal rate

/**
 * One production worker's pay for one Mon–Sun week.
 *
 * @param {object} w  the worker's rates:
 *        {hourlyRate, allowances:{meal,transport,rent}, deductions, caDeduction}
 * @param {Array}  days  up to 7 entries, one per day of the week, in order:
 *        {date, hours, otHours, travelHours, override:{by,at,reason}}
 *        A day with no punch is `{hours:0}` or simply absent — both are ABSENT.
 * @returns {object} the line, with every component kept separate so the payslip
 *        can show the worker how each figure was reached.
 */
window.computeWeeklyLine = function (w, days) {
  w = w || {};
  const rate       = Math.max(0, Number(w.hourlyRate) || 0);
  const travelRate = _round2(rate * window.TRAVEL_RATE_FACTOR);
  const rows = [];

  let regHours = 0, otHours = 0, travelHours = 0;
  let daysWorked = 0, daysAbsent = 0, daysOverridden = 0;

  for (let i = 0; i < 7; i++) {
    const d = (days && days[i]) || {};
    // Negative hours are not a correction, they are bad data — a negative day
    // would silently reduce the week's pay with nothing on the payslip to show
    // where it went. Clamp at zero and let the override be the visible route.
    const hrs = Math.max(0, Number(d.hours)       || 0);
    const ot  = Math.max(0, Number(d.otHours)     || 0);
    const tr  = Math.max(0, Number(d.travelHours) || 0);
    // Ruling 2: an override only counts when it is RECORDED. A reason-less
    // override is treated as absent rather than quietly paid, so the audit
    // trail can never be empty while money moved.
    const ovr = d.override && d.override.reason ? d.override : null;
    const worked = (hrs + ot + tr) > 0;

    if (worked) daysWorked++; else daysAbsent++;
    if (ovr) daysOverridden++;

    regHours += hrs; otHours += ot; travelHours += tr;
    rows.push({
      day: window.WEEK_DAYS[i],
      date: d.date || '',
      hours: hrs, otHours: ot, travelHours: tr,
      pay: _round2(hrs * rate + ot * rate + tr * travelRate),
      absent: !worked,
      override: ovr ? { by: ovr.by || '', at: ovr.at || '', reason: String(ovr.reason) } : null
    });
  }

  const regularPay = _round2(regHours    * rate);
  const otPay      = _round2(otHours     * rate);        // ruling 3 — plain rate
  const travelPay  = _round2(travelHours * travelRate);  // ruling 3 — half rate

  const a = w.allowances || {};
  const meal      = Math.max(0, Number(a.meal)      || 0);
  const transport = Math.max(0, Number(a.transport) || 0);
  const rent      = Math.max(0, Number(a.rent)      || 0);
  const allowanceTotal = _round2(meal + transport + rent);

  const gross = _round2(regularPay + otPay + travelPay + allowanceTotal);

  const otherDeductions = Math.max(0, Number(w.deductions)  || 0);
  // Never collect more cash advance than the pay can cover — the same clamp the
  // monthly engine applies. A weekly run applies this to everyone at once, so an
  // unclamped CA would turn into a negative net for a whole crew in one click.
  const caRequested = Math.max(0, Number(w.caDeduction) || 0);
  const caDeduction = _round2(Math.min(caRequested, Math.max(0, gross - otherDeductions)));
  const deductionTotal = _round2(otherDeductions + caDeduction);
  const net = _round2(gross - deductionTotal);

  return {
    rate, travelRate, rows,
    regHours: _round2(regHours), otHours: _round2(otHours), travelHours: _round2(travelHours),
    regularPay, otPay, travelPay,
    allowances: { meal, transport, rent }, allowanceTotal,
    gross,
    otherDeductions, caDeduction, caShortfall: _round2(caRequested - caDeduction),
    deductionTotal, net,
    daysWorked, daysAbsent, daysOverridden
  };
};

// ═══════════════════════════════════════════════════════════
//  WEEKLY RUN — rate resolution and the weekly skip guard
//  TYPE-B-WEEKLY-PAYROLL-SPEC / OPS-PAYROLL-PARITY-SPEC step 6. ADDITIVE.
// ═══════════════════════════════════════════════════════════

/**
 * The ONE place a production worker's hourly rate is decided.
 *
 * WHY THIS EXISTS. A worker profile can carry `hourlyRate`, `dailyRate`, both,
 * or neither — the create form takes the two as unlinked free text. The roster
 * column shows the DAILY rate while computeWeeklyLine reads the HOURLY one, so
 * a worker set up with only a daily rate displays correctly on screen and
 * computes to ₱0.00. The screen looks right while the run pays nothing.
 *
 * Returns { rate, source, ok, why }. A caller must check `ok` — this REFUSES at
 * zero rather than returning 0, because a ₱0.00 line in a batch of thirty is
 * invisible, and "everyone got paid" with one silent zero is the failure this
 * whole design is trying to avoid.
 */
window.resolveWorkerHourlyRate = function (wp) {
  const w = wp || {};
  const hourly = Number(w.hourlyRate);
  if (Number.isFinite(hourly) && hourly > 0) return { rate: hourly, source: 'hourlyRate', ok: true, why: '' };
  const daily = Number(w.dailyRate);
  if (Number.isFinite(daily) && daily > 0) {
    // 8-hour day — the same divisor the worker profile screen already displays
    // with (js/screens/hr.js ~3221), so the run and the profile agree.
    return { rate: _round2(daily / 8), source: 'dailyRate/8', ok: true, why: '' };
  }
  return { rate: 0, source: 'none', ok: false,
           why: 'No pay rate on file — set an hourly or daily rate on this worker\'s profile before running the week.' };
};

/**
 * Who the WEEKLY run pays. The twin of monthlyRunSkipReason, and it has to be a
 * separate expression: the monthly guard's job is to keep production staff OUT,
 * so reusing it here would skip exactly the people this run exists to pay.
 *
 * @param w              a worker profile ({id, status, linkedUid, ...})
 * @param periodExcluded this WEEK's exclusion map (pay_weeks/{monday}.excluded)
 * @param opts.monthlyPaidUids  uids already on a monthly run — the double-pay
 *                              guard from the other direction
 */
window.weeklyRunSkipReason = function (w, periodExcluded, opts) {
  if (!w) return 'missing';
  const o = opts || {};
  // Permanent reasons first, and in this order, so the message names the real
  // cause — the same contract monthlyRunSkipReason keeps.
  if (w.status === 'inactive' || w.removed === true) return 'removed';
  // THE DOUBLE-PAY GUARD, from the weekly side. The monthly run skips anyone
  // with a linked worker profile; this skips anyone the monthly run actually
  // paid. Both directions are needed — a person can be mis-configured into
  // either run, and only one of the two guards would catch each case.
  if (w.linkedUid && o.monthlyPaidUids &&
      (o.monthlyPaidUids.has ? o.monthlyPaidUids.has(w.linkedUid) : o.monthlyPaidUids[w.linkedUid])) {
    return 'paid-monthly';
  }
  const r = window.resolveWorkerHourlyRate(w);
  if (!r.ok) return 'no-rate';
  // Period-scoped, exactly as the monthly ruling requires (2026-08-10): an
  // exclusion belongs to THIS WEEK, never to the person.
  if (periodExcluded) {
    const e = (typeof periodExcluded.get === 'function') ? periodExcluded.get(w.id) : periodExcluded[w.id];
    if (e) return 'excluded' + (typeof e === 'string' && e ? ': ' + e : '');
  }
  return null;
};

/**
 * The Monday that owns a given date, as 'YYYY-MM-DD'. This is the pay week's id.
 *
 * Takes and returns the STRING form and never builds a Date from a bare
 * 'YYYY-MM-DD' — that parses as UTC midnight, which is 08:00 the same day in
 * Manila but the PREVIOUS day for any negative offset, and a week boundary that
 * moves by a day pays the wrong seven days. Noon-anchored with an explicit
 * +08:00 for the same reason the calendar does it.
 */
window.payWeekMondayOf = function (iso) {
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00+08:00');
  if (isNaN(d)) return '';
  const dow = (d.getUTCDay() + 6) % 7;            // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
};

/** The seven ISO dates of a pay week, Monday first. */
window.payWeekDays = function (mondayIso) {
  const out = [];
  const base = new Date(String(mondayIso).slice(0, 10) + 'T12:00:00+08:00');
  for (let i = 0; i < 7; i++) {
    const d = new Date(base.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
};

/**
 * Which MONTH a pay week belongs to, for month-to-date and statutory purposes.
 * Derived from the week's MONDAY, never its end — deriving it from the end
 * mis-bracketed 8 of 12 months in this repo once (js/screens/hr.js ~4471).
 */
window.payWeekMonth = function (mondayIso) { return String(mondayIso).slice(0, 7); };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    vatSplit: window.vatSplit,
    resolveStatutoryEE: window.resolveStatutoryEE,
    computePayLine: window.computePayLine,
    computeBreakeven: window.computeBreakeven,
    monthBounds: window.monthBounds,
    computeKpiForMonth: window.computeKpiForMonth,
    applyPayLineOverride: window.applyPayLineOverride,
    computeWeeklyLine: window.computeWeeklyLine,
    resolveWorkerHourlyRate: window.resolveWorkerHourlyRate,
    weeklyRunSkipReason: window.weeklyRunSkipReason,
    payWeekMondayOf: window.payWeekMondayOf,
    payWeekDays: window.payWeekDays,
    payWeekMonth: window.payWeekMonth,
    WEEK_DAYS: window.WEEK_DAYS,
    TRAVEL_RATE_FACTOR: window.TRAVEL_RATE_FACTOR
  };
}
