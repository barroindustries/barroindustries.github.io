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

// ---- moved verbatim from js/departments.js ≈3194-3243 ----
window.computePayLine = function(emp, ctx) {
  const policy = ctx.policy || 'flat';
  const base   = emp.salary || 0;
  const allowance = emp.allowance || 0;
  const otherDeductions = emp.deductions || 0;
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
  const sss        = emp.sss        || (stat ? stat.ee.sss : 0);
  const philhealth = emp.philhealth || (stat ? stat.ee.philhealth : 0);
  const pagibig    = emp.pagibig    || (stat ? stat.ee.pagibig : 0);
  const tax        = emp.tax        || (stat ? stat.ee.tax : 0);
  const er         = stat ? stat.er : { sss:0, philhealth:0, pagibig:0 };
  const statutoryTotal = sss + philhealth + pagibig + tax;

  const kpiScore   = ctx.kpiScore != null ? ctx.kpiScore : 1;
  const attScore   = ctx.attScore != null ? ctx.attScore : 1;
  const perfFactor = Math.min(1, Math.max(0, kpiScore*0.7 + attScore*0.3));

  const caPlan    = ctx.caPlan || [];
  const caPlanned = caPlan.reduce((s,p)=>s+(p.amount||0), 0);
  const caBalance = ctx.caBalance != null ? ctx.caBalance : caPlanned;

  // policy 'flat'        = exactly Path A today (unification changes no one's pay).
  // policy 'performance' = allowance scales by perfFactor; BASE WAGE is never
  // docked (PH labor-safe) — inert until the President flips payPolicy on a run.
  const netBeforeCA = policy === 'performance'
    ? (base - statutoryTotal - otherDeductions + allowance*perfFactor)
    : (gross - statutoryTotal - otherDeductions);
  const finalPay = netBeforeCA - caPlanned;
  // The TRUE economic cost of this line (what disbursePayRun's ledger debit
  // legs must balance against) — equals nominal `gross` under 'flat', but
  // correctly reflects a performance-scaled allowance under 'performance'
  // (an unearned allowance withholding is not a real company expense).
  const effectiveGross = netBeforeCA + statutoryTotal + otherDeductions;

  return {
    uid: emp.id, name: emp.displayName||emp.email, payClass: emp.payClass==='production'?'production':'regular',
    base, allowance, otherDeductions,
    sss, philhealth, pagibig, tax, er,
    kpiScore, attScore, perfFactor, policy,
    caBalance, caPlanned, caPlan,
    gross, effectiveGross, statutoryTotal, netBeforeCA, finalPay
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    vatSplit: window.vatSplit,
    computePayLine: window.computePayLine,
    computeBreakeven: window.computeBreakeven,
    monthBounds: window.monthBounds,
    computeKpiForMonth: window.computeKpiForMonth,
    applyPayLineOverride: window.applyPayLineOverride
  };
}
