// tests/money.test.mjs — money-math tests (v14 Wave 2 Batch A, spec item I5)
//
// First test suite in this repo. It guards MONEY math: vatSplit,
// computeStatutory, computePayLine. These tests PIN CURRENT BEHAVIOR — they
// document what the math does today, they do NOT define what it should do.
// If a test here fails after a deliberate math change, update the pinned
// value (and say why in the commit), don't "fix" it to satisfy the test
// blindly. computeStatutory in particular reads a 2026 rate table that is
// EXPLICITLY a placeholder (see js/statutory-tables.js) — those tests are
// labeled below and are expected to change once an accountant verifies real
// SSS/PhilHealth/Pag-IBIG/TRAIN numbers and the table's verified flag flips.
//
// Run with: node --test tests/*.test.mjs   (v14 re-audit finding: bare
// `node --test tests/` throws MODULE_NOT_FOUND on Node >=24 — confirmed by
// direct repro. .github/workflows/ci.yml's money-math-tests job currently
// runs the bare `node --test tests/` form too and pins Node 20, so it is
// UNVERIFIED whether CI itself is affected — flagged separately since
// ci.yml is outside this file's edit scope; this header comment is fixed
// here so local devs on a newer Node aren't misled by a MODULE_NOT_FOUND
// error that gives no hint it's a Node-version/glob issue.)
//
// Zero deps: node:test + node:assert only, per Wave 2 spec. Both
// js/statutory-tables.js and js/money-core.js are plain "window globals"
// browser files (no ES modules yet — see specs/wave2-architecture-spec.md,
// Stage B). Each carries a small UMD-ish shim (`if (typeof window ===
// 'undefined') globalThis.window = globalThis`) plus a trailing
// `module.exports` guard, added by this batch specifically so Node can
// require() them with zero build step. createRequire lets this .mjs file
// pull in those CommonJS-style exports.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// computePayLine falls back to `window.bizYear ? window.bizYear() : new
// Date().getFullYear()` when picking which year's statutory table to use.
// window.bizYear itself lives in js/config.js (Manila-time helpers), which
// this suite intentionally does NOT load — config.js touches Firebase/DOM
// bootstrapping unrelated to pure money math. Instead we stub bizYear to a
// fixed year BEFORE requiring the modules, so every pinned expectation below
// is anchored to statutory year 2026 forever, independent of the system
// clock the tests happen to run on (matches STATUTORY[2026] in
// js/statutory-tables.js, and matches today's real date at the time these
// values were captured: 2026-08-03).
globalThis.window = globalThis;
window.bizYear = () => 2026;

const statutory = require('../js/statutory-tables.js');
const money = require('../js/money-core.js');
const { vatSplit, computePayLine, computeBreakeven, payrollSplitFromRows, monthBounds, computeKpiForMonth, applyPayLineOverride, resolveStatutoryEE } = money;
const { computeStatutory } = statutory;

// window.ledgerKind lives in js/config.js (the ONE place P&L income/expense
// classification happens), which this suite does NOT load for the same
// reason it skips bizYear's real home — config.js touches Firebase/DOM
// bootstrapping unrelated to pure money math. Stubbed here to the same
// {accountType-first, then type} logic config.js actually implements (minus
// the COA_LEGACY_MAP category fallback, which the test rows below don't
// need — they set type/accountType explicitly), BEFORE requiring bir.js/
// finance-ledger.js, both of which call window.ledgerKind internally.
window.ledgerKind = function (row) {
  if (row && typeof row.accountType === 'string') return row.accountType;
  if (!row) return 'expense';
  if (row.type === 'credit') return 'income';
  return 'expense';
};

const bir = require('../js/bir.js');
const { computeVatSummary } = bir;
const ledger = require('../js/finance-ledger.js');
const { _mapEntry, _sanitize, _rollupDelta } = ledger;

// computeStatutory console.warns on every call while the table is
// unverified (by design — "nothing silently ships a wrong number into live
// payroll"). That's expected noise for this whole suite; keep test output
// clean without hiding a real console.error/assert failure.
let originalWarn;
before(() => { originalWarn = console.warn; console.warn = () => {}; });
after(() => { console.warn = originalWarn; });

// ═══════════════════════════════════════════════════════════
// vatSplit — js/money-core.js (moved verbatim from departments.js ≈9875)
// ═══════════════════════════════════════════════════════════
describe('vatSplit', () => {
  it('inclusive: splits a VAT-inclusive amount into net + 12% VAT', () => {
    assert.deepEqual(vatSplit(1120, 'inclusive'), { recorded: 1120, net: 1000, vat: 120 });
  });

  it('exclusive: adds 12% VAT on top of the entered (net) amount', () => {
    assert.deepEqual(vatSplit(1000, 'exclusive'), { recorded: 1120, net: 1000, vat: 120 });
  });

  it('exempt: zero-rated / VAT-exempt — no VAT, recorded = entered', () => {
    assert.deepEqual(vatSplit(500, 'exempt'), { recorded: 500, net: 500, vat: 0 });
  });

  it('zero entered amount: all fields zero regardless of treatment', () => {
    assert.deepEqual(vatSplit(0, 'inclusive'), { recorded: 0, net: 0, vat: 0 });
    assert.deepEqual(vatSplit(0, 'exclusive'), { recorded: 0, net: 0, vat: 0 });
    assert.deepEqual(vatSplit(0, 'exempt'), { recorded: 0, net: 0, vat: 0 });
  });

  it('non-numeric/missing entered amount coerces to 0 via `+entered || 0`', () => {
    assert.deepEqual(vatSplit(undefined, 'inclusive'), { recorded: 0, net: 0, vat: 0 });
    assert.deepEqual(vatSplit(NaN, 'inclusive'), { recorded: 0, net: 0, vat: 0 });
    assert.deepEqual(vatSplit('', 'inclusive'), { recorded: 0, net: 0, vat: 0 });
  });

  it('legacy no-treatment rows: an unset/unknown treatment falls through to the inclusive branch', () => {
    // Old ledger/sale rows recorded before VAT treatment was tracked per-entry
    // have no explicit treatment string. vatSplit has no 'legacy' special
    // case — anything that isn't 'exclusive' or 'exempt' falls through to the
    // inclusive (default) math. Pinning that fallthrough here.
    assert.deepEqual(vatSplit(1120, undefined), { recorded: 1120, net: 1000, vat: 120 });
    assert.deepEqual(vatSplit(1120, 'garbage-legacy-value'), { recorded: 1120, net: 1000, vat: 120 });
  });

  it('rounding edge: inclusive split on an amount that does not divide evenly by 1.12', () => {
    // 100 / 1.12 = 89.285714... -> toFixed(2) = "89.29"; vat = 100 - 89.29 = 10.71
    assert.deepEqual(vatSplit(100, 'inclusive'), { recorded: 100, net: 89.29, vat: 10.71 });
  });

  it('rounding edge: exclusive split on a fractional amount', () => {
    // vat = 33.335 * 0.12 = 4.0002 -> toFixed(2) = "4.00" -> 4
    assert.deepEqual(vatSplit(33.335, 'exclusive'), { recorded: 37.34, net: 33.34, vat: 4 });
  });

  // v14 re-audit finding: "vatSplit has no test for a negative entered amount
  // (credit memo / sales return)" — money-core.js's header says vatSplit is
  // used by the sale + project billing flows, which in practice can include
  // refunds/credit memos with a negative amount. `+entered || 0` only
  // coerces falsy/non-numeric input to 0 — a real negative number is
  // truthy and passes straight through the same formula as a positive one,
  // just mirrored in sign. Pinning today's (undocumented-until-now, but not
  // proven wrong) behavior for all three treatments, not changing the math.
  it('negative entered amount (credit memo / sales return): mirrors the positive-amount formula in sign', () => {
    assert.deepEqual(vatSplit(-1120, 'inclusive'), { recorded: -1120, net: -1000, vat: -120 });
    assert.deepEqual(vatSplit(-1000, 'exclusive'), { recorded: -1120, net: -1000, vat: -120 });
    assert.deepEqual(vatSplit(-500, 'exempt'), { recorded: -500, net: -500, vat: 0 });
  });
});

// ═══════════════════════════════════════════════════════════
// computeStatutory — js/statutory-tables.js (untouched logic; export guard
// added only). Values below are placeholder-pinning: STATUTORY[2026] is
// explicitly marked verified:false in the source. These tests document
// today's placeholder math so a future accountant-verified table change is
// a visible, deliberate diff here — not a silent behavior change.
// ═══════════════════════════════════════════════════════════
describe('computeStatutory (placeholder-pinning — STATUTORY[2026] is unverified)', () => {
  it('returns the {ee,er,unverified} shape and flags the table as unverified', () => {
    const r = computeStatutory({ grossPay: 20000, year: 2026 });
    assert.equal(typeof r.ee.sss, 'number');
    assert.equal(typeof r.ee.philhealth, 'number');
    assert.equal(typeof r.ee.pagibig, 'number');
    assert.equal(typeof r.ee.tax, 'number');
    assert.equal(typeof r.er.sss, 'number');
    assert.equal(typeof r.er.philhealth, 'number');
    assert.equal(typeof r.er.pagibig, 'number');
    assert.equal(r.unverified, true); // STATUTORY[2026].verified === false today
  });

  it('grossPay 20000, 2026: pinned placeholder output (mid-bracket, no withholding)', () => {
    assert.deepEqual(computeStatutory({ grossPay: 20000, year: 2026 }), {
      ee: { sss: 1000, philhealth: 500, pagibig: 200, tax: 0 },
      er: { sss: 2000, philhealth: 500, pagibig: 200 },
      unverified: true,
    });
  });

  it('grossPay 0, 2026: pinned placeholder output (SSS/PhilHealth floors kick in, Pag-IBIG does not)', () => {
    assert.deepEqual(computeStatutory({ grossPay: 0, year: 2026 }), {
      ee: { sss: 250, philhealth: 250, pagibig: 0, tax: 0 },
      er: { sss: 500, philhealth: 250, pagibig: 0 },
      unverified: true,
    });
  });

  it('grossPay 80000, 2026: pinned placeholder output (SSS MSC cap + top withholding bracket)', () => {
    assert.deepEqual(computeStatutory({ grossPay: 80000, year: 2026 }), {
      ee: { sss: 1750, philhealth: 2000, pagibig: 200, tax: 10887.55 },
      er: { sss: 3500, philhealth: 2000, pagibig: 200 },
      unverified: true,
    });
  });

  it('unmapped year: no table -> all-zero shape, unverified:true, no throw', () => {
    assert.deepEqual(computeStatutory({ grossPay: 20000, year: 2099 }), {
      ee: { sss: 0, philhealth: 0, pagibig: 0, tax: 0 },
      er: { sss: 0, philhealth: 0, pagibig: 0 },
      unverified: true,
    });
  });
});

// ═══════════════════════════════════════════════════════════
// computePayLine — js/money-core.js (moved verbatim from departments.js
// ≈3194, per-employee half of the v12 WS20 "ONE PAYROLL ENGINE"; year pinned
// to 2026 via the window.bizYear stub above). Behavior-pinning: these
// document today's payroll math, they do not redefine it.
// ═══════════════════════════════════════════════════════════
describe('computePayLine', () => {
  it('flat policy, table-derived statutory, no cash-advance plan', () => {
    const line = computePayLine(
      { id: 'u1', displayName: 'Juan', salary: 20000, allowance: 2000, deductions: 500 },
      { policy: 'flat' }
    );
    assert.deepEqual(line, {
      uid: 'u1', name: 'Juan', payClass: 'regular',
      base: 20000, allowance: 2000, otherDeductions: 500, unearnedDeductions: 0, withheldDeductions: 500,
      sss: 1100, philhealth: 550, pagibig: 200, tax: 0,
      er: { sss: 2200, philhealth: 550, pagibig: 200 },
      kpiScore: 1, attScore: 1, perfFactor: 1, policy: 'flat',
      caBalance: 0, caPlanned: 0, caPlan: [],
      gross: 22000, effectiveGross: 22000, statutoryTotal: 1850,
      netBeforeCA: 19650, finalPay: 19650,
    });
  });

  it('performance policy: allowance scales by perfFactor, base wage untouched, CA plan deducted', () => {
    const line = computePayLine(
      { id: 'u2', displayName: 'Maria', salary: 30000, allowance: 5000, deductions: 0 },
      {
        policy: 'performance', kpiScore: 0.8, attScore: 0.9,
        caPlan: [{ amount: 1000 }, { amount: 500 }], caBalance: 2500,
      }
    );
    assert.deepEqual(line, {
      uid: 'u2', name: 'Maria', payClass: 'regular',
      base: 30000, allowance: 5000, otherDeductions: 0, unearnedDeductions: 0, withheldDeductions: 0,
      sss: 1750, philhealth: 875, pagibig: 200, tax: 1701.3,
      er: { sss: 3500, philhealth: 875, pagibig: 200 },
      kpiScore: 0.8, attScore: 0.9, perfFactor: 0.83, policy: 'performance',
      caBalance: 2500, caPlanned: 1500, caPlan: [{ amount: 1000 }, { amount: 500 }],
      gross: 35000, effectiveGross: 34150, statutoryTotal: 4526.3,
      netBeforeCA: 29623.7, finalPay: 28123.7,
    });
    // effectiveGross (34150) < nominal gross (35000) under 'performance' —
    // an unearned allowance withholding is not a real company expense.
    assert.ok(line.effectiveGross < line.gross);
  });

  it('hand-typed statutory on payroll/{uid} wins over the table suggestion', () => {
    const line = computePayLine(
      {
        id: 'u3', displayName: 'Pedro', salary: 15000, allowance: 0, deductions: 200,
        sss: 800, philhealth: 300, pagibig: 100, tax: 50,
      },
      { policy: 'flat' }
    );
    assert.deepEqual(
      { sss: line.sss, philhealth: line.philhealth, pagibig: line.pagibig, tax: line.tax },
      { sss: 800, philhealth: 300, pagibig: 100, tax: 50 }
    );
    // er (employer share) is never hand-typed — always computed from the table.
    assert.deepEqual(line.er, { sss: 1500, philhealth: 375, pagibig: 200 });
    assert.equal(line.statutoryTotal, 1250);
    assert.equal(line.netBeforeCA, 13550);
    assert.equal(line.finalPay, 13550);
  });

  it('window.computeStatutory unavailable: all statutory fields default to 0 (no throw)', () => {
    const saved = window.computeStatutory;
    window.computeStatutory = undefined;
    try {
      const line = computePayLine(
        { id: 'u4', displayName: 'Ana', salary: 10000, allowance: 0, deductions: 0 },
        { policy: 'flat' }
      );
      assert.deepEqual(
        { sss: line.sss, philhealth: line.philhealth, pagibig: line.pagibig, tax: line.tax },
        { sss: 0, philhealth: 0, pagibig: 0, tax: 0 }
      );
      assert.deepEqual(line.er, { sss: 0, philhealth: 0, pagibig: 0 });
      assert.equal(line.finalPay, 10000);
    } finally {
      window.computeStatutory = saved;
    }
  });

  it('quirk (pinned, not fixed): an explicit emp.sss of 0 does NOT override the table, because `emp.sss || fallback` treats 0 as falsy', () => {
    const line = computePayLine(
      { id: 'u5', displayName: 'Liza', salary: 12000, allowance: 0, deductions: 0, sss: 0, philhealth: 0, pagibig: 0, tax: 0 },
      { policy: 'flat' }
    );
    // Falls through to the table instead of staying 0 — this is today's
    // documented behavior, not a designed feature. Do not "fix" this test to
    // assert zeros without also fixing computePayLine's `||` checks.
    assert.deepEqual(
      { sss: line.sss, philhealth: line.philhealth, pagibig: line.pagibig, tax: line.tax },
      { sss: 600, philhealth: 300, pagibig: 200, tax: 0 }
    );
  });

  it('zero base + zero allowance: statutory floors can push finalPay negative (no floor at 0 in computePayLine itself)', () => {
    const line = computePayLine(
      { id: 'u6', salary: 0, allowance: 0, deductions: 0, sss: 0, philhealth: 0, pagibig: 0, tax: 0 },
      { policy: 'flat' }
    );
    assert.equal(line.gross, 0);
    assert.equal(line.statutoryTotal, 500); // SSS/PhilHealth floors apply even at zero gross
    assert.equal(line.netBeforeCA, -500);
    assert.equal(line.finalPay, -500);
  });

  // v14 re-audit finding: computePayLine's payClass mapping (line ~93:
  // `emp.payClass==='production'?'production':'regular'`) had no test for
  // the 'production' branch — every existing test above omits payClass, so
  // only the 'regular' fallback was pinned. computePayRun (departments.js)
  // explicitly SKIPS payClass:'production' employees from the monthly run
  // before computePayLine is ever called on them, so this branch may be
  // unreachable in the live app today — pinning it anyway documents what
  // computePayLine itself does if ever called directly with one.
  it('payClass "production" passes through on the returned line (computePayRun currently never calls this for a production employee)', () => {
    const line = computePayLine(
      { id: 'u8', displayName: 'Rico', salary: 18000, allowance: 0, deductions: 0, payClass: 'production' },
      { policy: 'flat' }
    );
    assert.equal(line.payClass, 'production');
  });

  it('defaults: missing kpiScore/attScore/caPlan/caBalance in ctx', () => {
    const line = computePayLine(
      { id: 'u7', salary: 5000, allowance: 0, deductions: 0, sss: 1, philhealth: 1, pagibig: 1, tax: 1 },
      { policy: 'flat' } // no kpiScore, attScore, caPlan, caBalance at all
    );
    assert.equal(line.kpiScore, 1);
    assert.equal(line.attScore, 1);
    assert.equal(line.perfFactor, 1);
    assert.deepEqual(line.caPlan, []);
    assert.equal(line.caPlanned, 0);
    assert.equal(line.caBalance, 0); // falls back to caPlanned when ctx.caBalance is null/undefined
  });
});

// ═══════════════════════════════════════════════════════════
// computeBreakeven — js/money-core.js (v14 post-release, owner request "Add
// a computation for breakeven. Rents etc."). Pure classification + math —
// no Firestore, no Date.now. `byCategory` mirrors finance_rollup's own
// {cat:{income,expense}} shape (js/finance-ledger.js); `classification` is
// the ALREADY-resolved {fixed:[...], variable:[...]} arrays of exact
// byCategory keys (the screen does the case-insensitive keyword matching
// before calling this). These tests pin the formulas documented in the
// function's header comment.
// ═══════════════════════════════════════════════════════════
describe('computeBreakeven', () => {
  it('normal case: clean division, fixed + variable both classified', () => {
    const r = computeBreakeven({
      income: 100000,
      byCategory: { 'Payroll Expense': { expense: 20000 }, 'Materials': { expense: 20000 } },
      classification: { fixed: ['Payroll Expense'], variable: ['Materials'] },
    });
    assert.equal(r.fixedTotal, 20000);
    assert.equal(r.variableTotal, 20000);
    assert.equal(r.contributionMarginRatio, 0.8);
    assert.equal(r.breakEvenRevenue, 25000);
    assert.equal(r.coveragePct, 400);
    assert.equal(r.gapToBreakEven, 0);
    assert.deepEqual(r.classifiedFixed, [{ cat: 'Payroll Expense', amt: 20000 }]);
    assert.deepEqual(r.classifiedVariable, [{ cat: 'Materials', amt: 20000 }]);
    assert.deepEqual(r.unclassified, []);
    assert.equal(r.perDayNeeded(30), 833.33);
  });

  it('zero income: CMR/breakEvenRevenue/gap all "n/a", never Infinity/NaN — the on-screen edge-honesty state', () => {
    const r = computeBreakeven({
      income: 0,
      byCategory: { 'Payroll Expense': { expense: 20000 } },
      classification: { fixed: ['Payroll Expense'] },
    });
    assert.equal(r.fixedTotal, 20000);
    assert.equal(r.contributionMarginRatio, null);
    assert.equal(r.breakEvenRevenue, 'n/a');
    assert.equal(r.coveragePct, null);
    assert.equal(r.gapToBreakEven, 'n/a');
    assert.equal(r.perDayNeeded(30), null);
  });

  it('zero income AND zero fixed costs: still "n/a" — a truly empty month, not a divide-by-zero 0', () => {
    const r = computeBreakeven({ income: 0, byCategory: {}, classification: { fixed: [], variable: [] } });
    assert.equal(r.fixedTotal, 0);
    assert.equal(r.breakEvenRevenue, 'n/a');
    assert.equal(r.gapToBreakEven, 'n/a');
  });

  it('zero variable costs: CMR = 1 (100% margin), breakEvenRevenue = fixedTotal exactly', () => {
    const r = computeBreakeven({
      income: 50000,
      byCategory: { 'Payroll Expense': { expense: 10000 } },
      classification: { fixed: ['Payroll Expense'], variable: [] },
    });
    assert.equal(r.variableTotal, 0);
    assert.equal(r.contributionMarginRatio, 1);
    assert.equal(r.breakEvenRevenue, 10000);
    assert.equal(r.coveragePct, 500);
    assert.deepEqual(r.classifiedVariable, []);
  });

  it('all categories classified fixed: classifiedVariable stays an empty array, not undefined', () => {
    const r = computeBreakeven({
      income: 40000,
      byCategory: { 'Payroll Expense': { expense: 15000 }, 'Utilities': { expense: 5000 } },
      classification: { fixed: ['Payroll Expense', 'Utilities'], variable: [] },
    });
    assert.equal(r.fixedTotal, 20000);
    assert.equal(r.breakEvenRevenue, 20000);
    assert.deepEqual(r.classifiedVariable, []);
    assert.deepEqual(r.classifiedFixed, [
      { cat: 'Payroll Expense', amt: 15000 },
      { cat: 'Utilities', amt: 5000 },
    ]);
  });

  it('manualFixed is ADDITIVE to fixedTotal — a rent line that never posts to the ledger', () => {
    const r = computeBreakeven({
      income: 60000,
      byCategory: { 'Payroll Expense': { expense: 10000 } },
      classification: { fixed: ['Payroll Expense'] },
      manualFixed: [{ label: 'Rent - HQ', amount: 15000 }, { label: 'Insurance', amount: 5000 }],
    });
    assert.equal(r.fixedTotal, 30000); // 10000 (category) + 15000 + 5000 (manual)
    assert.equal(r.breakEvenRevenue, 30000); // CMR=1 (no variable costs)
    assert.deepEqual(r.classifiedFixed, [
      { cat: 'Payroll Expense', amt: 10000 },
      { cat: 'Rent - HQ', amt: 15000, manual: true },
      { cat: 'Insurance', amt: 5000, manual: true },
    ]);
  });

  it('unclassified categories are SURFACED, not silently dropped or folded into fixed/variable', () => {
    const r = computeBreakeven({
      income: 100000,
      byCategory: {
        'Payroll Expense': { expense: 10000 },
        'Materials': { expense: 10000 },
        'Operating Expense': { expense: 8000 },
        'Tax': { expense: 2000 },
      },
      classification: { fixed: ['Payroll Expense'], variable: ['Materials'] },
    });
    // Operating Expense/Tax excluded from both totals — 10000/10000 exactly,
    // not 18000/12000 (the totals a silent-fold-in would produce).
    assert.equal(r.fixedTotal, 10000);
    assert.equal(r.variableTotal, 10000);
    assert.deepEqual(r.unclassified, [
      { cat: 'Operating Expense', amt: 8000 },
      { cat: 'Tax', amt: 2000 },
    ]);
  });

  it('coverage over 100%: income already exceeds break-even — gap clamps to 0, never negative', () => {
    const r = computeBreakeven({
      income: 100000,
      byCategory: { 'Payroll Expense': { expense: 10000 }, 'Materials': { expense: 50000 } },
      classification: { fixed: ['Payroll Expense'], variable: ['Materials'] },
    });
    assert.equal(r.breakEvenRevenue, 20000);
    assert.equal(r.coveragePct, 500);
    assert.equal(r.gapToBreakEven, 0);
  });

  it('coverage under 100% + rounding: repeating-decimal coveragePct rounds to cents, gap is positive', () => {
    const r = computeBreakeven({
      income: 50000,
      byCategory: { 'Payroll Expense': { expense: 45000 }, 'Materials': { expense: 10000 } },
      classification: { fixed: ['Payroll Expense'], variable: ['Materials'] },
    });
    assert.equal(r.contributionMarginRatio, 0.8);
    assert.equal(r.breakEvenRevenue, 56250);
    // 50000/56250 = 0.888888...  -> 88.888888...% -> rounds to 88.89
    assert.equal(r.coveragePct, 88.89);
    assert.equal(r.gapToBreakEven, 6250);
    assert.equal(r.perDayNeeded(30), 1875);
  });

  it('rounding edge: breakEvenRevenue itself does not divide evenly, perDayNeeded rounds off the ROUNDED figure', () => {
    const r = computeBreakeven({
      income: 100000,
      byCategory: { 'Payroll Expense': { expense: 20003 }, 'Materials': { expense: 40000 } },
      classification: { fixed: ['Payroll Expense'], variable: ['Materials'] },
    });
    assert.equal(r.contributionMarginRatio, 0.6);
    // 20003 / 0.6 = 33338.3333... -> 33338.33
    assert.equal(r.breakEvenRevenue, 33338.33);
    assert.equal(r.coveragePct, 299.96);
    // perDayNeeded divides the already-rounded 33338.33, not the raw quotient
    assert.equal(r.perDayNeeded(31), 1075.43);
    assert.equal(r.perDayNeeded(0), null); // guard: no divide-by-zero on bad daysInMonth
  });

  it('CMR <= 0 (variable costs consume all or more of income): breakEvenRevenue is "n/a", not a negative/Infinity number', () => {
    const r = computeBreakeven({
      income: 10000,
      byCategory: { 'Payroll Expense': { expense: 5000 }, 'Materials': { expense: 15000 } },
      classification: { fixed: ['Payroll Expense'], variable: ['Materials'] },
    });
    assert.equal(r.contributionMarginRatio, -0.5);
    assert.equal(r.breakEvenRevenue, 'n/a');
    assert.equal(r.gapToBreakEven, 'n/a');
    assert.equal(r.coveragePct, null);
  });

  it('missing/empty input object: defaults to zero income, empty byCategory/classification, no throw', () => {
    const r = computeBreakeven({});
    assert.equal(r.fixedTotal, 0);
    assert.equal(r.variableTotal, 0);
    assert.equal(r.breakEvenRevenue, 'n/a');
    assert.deepEqual(r.classifiedFixed, []);
    assert.deepEqual(r.classifiedVariable, []);
    assert.deepEqual(r.unclassified, []);
  });

  // v14 re-audit finding: no test pinned the precedence when a malformed/
  // duplicate finance_config/breakeven doc lists the SAME category in both
  // classification.fixed and classification.variable (e.g. a bug in
  // openBreakevenClassifyEditor's save merge). computeBreakeven checks
  // fixedSet.has(cat) BEFORE variableSet.has(cat) — documenting that "fixed"
  // wins is intentional-by-pin, not a silent accident.
  it('a category present in BOTH classification.fixed and classification.variable: fixed wins (checked first)', () => {
    const r = computeBreakeven({
      income: 100000,
      byCategory: { 'Utilities': { expense: 5000 } },
      classification: { fixed: ['Utilities'], variable: ['Utilities'] },
    });
    assert.deepEqual(r.classifiedFixed, [{ cat: 'Utilities', amt: 5000 }]);
    assert.deepEqual(r.classifiedVariable, []);
    assert.equal(r.fixedTotal, 5000);
    assert.equal(r.variableTotal, 0);
  });

  // v14 re-audit fix: js/screens/finance.js's renderBreakevenTab builds
  // byCategory from BOTH income and expense arrays (same map), so a
  // pure-income category like 'Sales Revenue'/'Other Income' — which only
  // ever has an `income` field, never `expense` — used to still land in
  // `unclassified` with amt:0 (no keyword ever matches "sales"/"income"),
  // showing a phantom ₱0.00 row and inflating the Unclassified count. Fixed
  // by skipping any byCategory entry whose expense contribution is <= 0
  // before classifying. Before this fix, `unclassified` would have included
  // {cat:'Sales Revenue', amt:0} here; now it's correctly absent, and every
  // nonzero total is unchanged (proving the fix only removes zero-amount
  // noise, never a real cost).
  it('a byCategory entry with zero expense (pure-income category) is excluded from fixed/variable/unclassified entirely', () => {
    const r = computeBreakeven({
      income: 100000,
      byCategory: {
        'Sales Revenue': { income: 100000, expense: 0 },
        'Payroll Expense': { expense: 20000 },
        'Materials': { expense: 20000 },
      },
      classification: { fixed: ['Payroll Expense'], variable: ['Materials'] },
    });
    assert.equal(r.fixedTotal, 20000);
    assert.equal(r.variableTotal, 20000);
    assert.deepEqual(r.unclassified, []); // NOT [{ cat: 'Sales Revenue', amt: 0 }]
  });

  // ═══════════════════════════════════════════════════════════
  // BREAKEVEN-EDITABLE-OH-SPEC-2026-08-26 — requiredSales/contributionPesos/
  // payrollSplit. All three are additive; every test above this point must
  // keep passing unmodified (backward compatibility is the spec's own
  // guardrail: "extend, never rename or change existing fields").
  // ═══════════════════════════════════════════════════════════

  it('requiredSales(0): worked example from the spec — 550000 fixed, 0.30 CMR, 0 profit -> 1,833,333.33', () => {
    const r = computeBreakeven({
      income: 1000000,
      byCategory: { 'Payroll Expense': { expense: 550000 }, 'Materials': { expense: 700000 } },
      classification: { fixed: ['Payroll Expense'], variable: ['Materials'] },
    });
    assert.equal(r.fixedTotal, 550000);
    assert.equal(r.contributionMarginRatio, 0.3);
    // 550000 / 0.3 = 1833333.3333... -> 1833333.33
    assert.equal(r.requiredSales(0), 1833333.33);
    // requiredSales(0) with no profit target must equal breakEvenRevenue exactly.
    assert.equal(r.requiredSales(0), r.breakEvenRevenue);
  });

  it('requiredSales(profitTarget): a positive profit goal is added to fixed costs before dividing by CMR', () => {
    const r = computeBreakeven({
      income: 1000000,
      byCategory: { 'Payroll Expense': { expense: 550000 }, 'Materials': { expense: 700000 } },
      classification: { fixed: ['Payroll Expense'], variable: ['Materials'] },
    });
    // (550000 + 100000) / 0.3 = 2166666.6666... -> 2166666.67
    assert.equal(r.requiredSales(100000), 2166666.67);
  });

  it('requiredSales: a negative profitTarget is clamped to 0, not subtracted from fixed costs', () => {
    const r = computeBreakeven({
      income: 1000000,
      byCategory: { 'Payroll Expense': { expense: 550000 }, 'Materials': { expense: 700000 } },
      classification: { fixed: ['Payroll Expense'], variable: ['Materials'] },
    });
    assert.equal(r.requiredSales(-50000), r.requiredSales(0));
  });

  it('requiredSales: same "n/a" guard as breakEvenRevenue — null (never Infinity/NaN) when CMR is null or <= 0', () => {
    const zeroIncome = computeBreakeven({
      income: 0,
      byCategory: { 'Payroll Expense': { expense: 20000 } },
      classification: { fixed: ['Payroll Expense'] },
    });
    assert.equal(zeroIncome.contributionMarginRatio, null);
    assert.equal(zeroIncome.requiredSales(0), null);
    assert.equal(zeroIncome.requiredSales(100000), null);

    const negMargin = computeBreakeven({
      income: 10000,
      byCategory: { 'Payroll Expense': { expense: 5000 }, 'Materials': { expense: 15000 } },
      classification: { fixed: ['Payroll Expense'], variable: ['Materials'] },
    });
    assert.equal(negMargin.contributionMarginRatio, -0.5);
    assert.equal(negMargin.requiredSales(0), null);
  });

  it('contributionPesos = income - variableTotal, in pesos (normal case)', () => {
    const r = computeBreakeven({
      income: 100000,
      byCategory: { 'Payroll Expense': { expense: 20000 }, 'Materials': { expense: 20000 } },
      classification: { fixed: ['Payroll Expense'], variable: ['Materials'] },
    });
    assert.equal(r.contributionPesos, 80000); // 100000 - 20000
  });

  it('contributionPesos is null-safe: always a number (never null/NaN) even at zero income or missing input', () => {
    const zeroIncome = computeBreakeven({
      income: 0,
      byCategory: { 'Materials': { expense: 5000 } },
      classification: { variable: ['Materials'] },
    });
    assert.equal(zeroIncome.contributionPesos, -5000); // 0 - 5000, still a plain number
    assert.equal(typeof zeroIncome.contributionPesos, 'number');

    const empty = computeBreakeven({});
    assert.equal(empty.contributionPesos, 0);
    assert.equal(typeof empty.contributionPesos, 'number');
  });

  it('payrollSplit: replaces the single "Payroll Expense" category with two synthetic fixed/variable rows', () => {
    const r = computeBreakeven({
      income: 200000,
      byCategory: { 'Payroll Expense': { expense: 100000 }, 'Materials': { expense: 20000 } },
      classification: { fixed: ['Payroll Expense'], variable: ['Materials'] },
      payrollSplit: { officePesos: 60000, directPesos: 40000 },
    });
    // 'Payroll Expense' itself must NOT appear in classifiedFixed anymore.
    assert.deepEqual(r.classifiedFixed, [{ cat: 'Payroll — Office', amt: 60000 }]);
    assert.deepEqual(r.classifiedVariable, [
      { cat: 'Materials', amt: 20000 },
      { cat: 'Payroll — Fabricators (direct labor)', amt: 40000 },
    ]);
    // Totals: fixed = 60000 (office only), variable = 20000 (Materials) + 40000 (direct labor)
    assert.equal(r.fixedTotal, 60000);
    assert.equal(r.variableTotal, 60000);
  });

  it('payrollSplit: office/direct totals sum to the same figure the unsplit "Payroll Expense" category would have contributed', () => {
    const withoutSplit = computeBreakeven({
      income: 200000,
      byCategory: { 'Payroll Expense': { expense: 100000 } },
      classification: { fixed: ['Payroll Expense'] },
    });
    const withSplit = computeBreakeven({
      income: 200000,
      byCategory: { 'Payroll Expense': { expense: 100000 } },
      classification: { fixed: ['Payroll Expense'] },
      payrollSplit: { officePesos: 60000, directPesos: 40000 },
    });
    assert.equal(withoutSplit.fixedTotal, 100000);
    // Same combined payroll money, just reclassified: 60000 stays fixed,
    // 40000 moves to variable — fixedTotal + variableTotal is unchanged.
    assert.equal(withSplit.fixedTotal + withSplit.variableTotal, withoutSplit.fixedTotal);
  });

  it('payrollSplit: a zero leg (e.g. no direct labor this period) is omitted, not pushed as a ₱0 row', () => {
    const r = computeBreakeven({
      income: 200000,
      byCategory: { 'Payroll Expense': { expense: 60000 } },
      classification: { fixed: ['Payroll Expense'] },
      payrollSplit: { officePesos: 60000, directPesos: 0 },
    });
    assert.deepEqual(r.classifiedFixed, [{ cat: 'Payroll — Office', amt: 60000 }]);
    assert.deepEqual(r.classifiedVariable, []);
  });

  it('payrollSplit absent (undefined/null): zero behavior change — "Payroll Expense" still classifies normally via fixedSet', () => {
    const r = computeBreakeven({
      income: 100000,
      byCategory: { 'Payroll Expense': { expense: 20000 }, 'Materials': { expense: 20000 } },
      classification: { fixed: ['Payroll Expense'], variable: ['Materials'] },
      payrollSplit: null,
    });
    assert.deepEqual(r.classifiedFixed, [{ cat: 'Payroll Expense', amt: 20000 }]);
    assert.equal(r.fixedTotal, 20000);
    assert.equal(r.variableTotal, 20000);
  });
});

// ═══════════════════════════════════════════════════════════
// payrollSplitFromRows — js/money-core.js (COSTING-DASHBOARD-SPEC-2026-08-26
// §A1). Moved verbatim out of js/screens/finance.js's beComputePayrollSplit
// (that function now delegates here); these two tests pin the exact same
// refNumber-prefix behavior that file's own beComputePayrollSplit tests
// (exercised indirectly above, via computeBreakeven's payrollSplit tests)
// already relied on, now against the money-core function directly.
// ═══════════════════════════════════════════════════════════
describe('payrollSplitFromRows — js/money-core.js §A1 (moved from finance.js\'s beComputePayrollSplit)', () => {
  it('splits "Payroll Expense" rows by refNumber prefix: a weekly/worker prefix (e.g. PAYW-) is direct labor, everything else in that category is office', () => {
    const r = payrollSplitFromRows([
      { category: 'Payroll Expense', amount: 40000, refNumber: 'PAYW-2026-08-24' },  // weekly fabricator run -> direct
      { category: 'Payroll Expense', amount: 60000, refNumber: 'PAY-2026-08' },       // monthly office run -> office
      { category: 'Materials', amount: 15000, refNumber: 'PAYW-should-be-ignored' },  // wrong category -> ignored entirely
    ]);
    assert.deepEqual(r, { directPesos: 40000, officePesos: 60000 });
  });

  it('every listed weekly prefix is recognized as direct labor, and rows with no/other refNumber default to office', () => {
    const rows = [
      'PAYW-1', 'WPAY-1', 'NETPAYW-1', 'SSSPAYW-1', 'PHPAYW-1', 'HDMFPAYW-1', 'WHTPAYW-1', 'EMPDEDW-1', 'CADEDUCTW-1'
    ].map(ref => ({ category: 'Payroll Expense', amount: 1000, refNumber: ref }));
    rows.push({ category: 'Payroll Expense', amount: 5000, refNumber: '' });        // no refNumber -> office
    rows.push({ category: 'Payroll Expense', amount: 7000 });                        // refNumber absent -> office
    const r = payrollSplitFromRows(rows);
    assert.equal(r.directPesos, 9000);   // 9 weekly-prefixed rows × 1000
    assert.equal(r.officePesos, 12000);  // 5000 + 7000
  });
});

// ═══════════════════════════════════════════════════════════
// computeVatSummary — js/bir.js (v14 re-audit finding: "the shared VAT
// engine behind Reports, 2550, and the Financial Statement has no test at
// all"). Pure: rows array in, object out; its only external dependency is
// window.ledgerKind, stubbed above the same way this suite already stubs
// window.bizYear. These tests pin today's exempt/inclusive/exclusive
// classification and the `vatAmount != null` legacy-fallback branch, AND
// document the v14 fix below (Other Income was previously invisible to this
// function entirely — see that test for the specific before/after).
// ═══════════════════════════════════════════════════════════
describe('computeVatSummary', () => {
  it('Sales Revenue row with an explicit vatAmount: bucketed as vatable, outputVat = vatAmount', () => {
    const r = computeVatSummary([
      { type: 'credit', category: 'Sales Revenue', amount: 1120, vatAmount: 120 },
    ]);
    assert.equal(r.vatableSales, 1000);
    assert.equal(r.exemptSales, 0);
    assert.equal(r.outputVat, 120);
    assert.equal(r.inputVat, 0);
    assert.equal(r.netVat, 120);
  });

  it('Sales Revenue row with NO vatAmount: legacy fallback amount − amount/1.12', () => {
    // 1120 - 1120/1.12 = 120.00000000000011 in raw floating point — unlike
    // vatSplit (money-core.js), this legacy fallback branch has no
    // .toFixed(2) rounding. Pinning the EXACT unrounded output (a quirk, not
    // something this fix batch changes — bir.js's own comment calls this
    // the "legacy fallback" for rows recorded before VAT was tracked
    // per-entry, and rounding it now would be an unproven money-math change).
    const r = computeVatSummary([
      { type: 'credit', category: 'Sales Revenue', amount: 1120 },
    ]);
    assert.ok(Math.abs(r.outputVat - 120) < 1e-9);
    assert.ok(Math.abs(r.vatableSales - 1000) < 1e-9);
  });

  it('Sales Revenue row with vatAmount <= 0: exempt, not vatable — no negative/zero outputVat contribution', () => {
    const r = computeVatSummary([
      { type: 'credit', category: 'Sales Revenue', amount: 500, vatAmount: 0 },
    ]);
    assert.equal(r.exemptSales, 500);
    assert.equal(r.vatableSales, 0);
    assert.equal(r.outputVat, 0);
  });

  it('inputVat sums only from expense rows (income rows never contribute)', () => {
    const r = computeVatSummary([
      { type: 'credit', category: 'Sales Revenue', amount: 1120, vatAmount: 120 },
      { type: 'debit', category: 'Materials', amount: 224, inputVat: 24 },
      { type: 'debit', category: 'Utilities', amount: 100, inputVat: 0 },
    ]);
    assert.equal(r.inputVat, 24);
    assert.equal(r.netVat, 96); // 120 - 24
  });

  it('a non-income category (e.g. an asset/liability row misfiled with a stray category) never counts as a sale', () => {
    const r = computeVatSummary([
      { type: 'credit', category: 'Advances to Employees', amount: 5000 },
    ]);
    assert.equal(r.vatableSales, 0);
    assert.equal(r.exemptSales, 0);
    assert.equal(r.outputVat, 0);
  });

  it('empty rows: every field defaults to zero, no throw', () => {
    const r = computeVatSummary([]);
    assert.deepEqual(r, { vatableSales: 0, exemptSales: 0, outputVat: 0, inputVat: 0, netVat: 0 });
  });

  // v14 FIX (not just a pin): window.COA.income = ['Sales Revenue', 'Other
  // Income'], but computeVatSummary previously hardcoded `category ===
  // 'Sales Revenue'` only — any row posted under 'Other Income' (e.g. a
  // scrap-material sale, rental income) was invisible to this function
  // entirely, not even bucketed as exempt, silently understating Output
  // VAT/VAT payable. BEFORE this fix, the row below would have contributed
  // NOTHING to any field (vatableSales/exemptSales/outputVat all 0 despite a
  // real ₱120 of VAT on the receipt). AFTER the fix, 'Other Income' is
  // scanned exactly like 'Sales Revenue' (window.COA.income is now the
  // filter, not a single hardcoded string).
  it('Other Income row with vatAmount: now counted toward vatableSales/outputVat (previously invisible entirely)', () => {
    const r = computeVatSummary([
      { type: 'credit', category: 'Other Income', amount: 1120, vatAmount: 120 },
    ]);
    assert.equal(r.vatableSales, 1000);
    assert.equal(r.outputVat, 120);
    assert.equal(r.exemptSales, 0);
  });

  it('Other Income row with no VAT (exempt): now bucketed as exempt (previously invisible entirely)', () => {
    const r = computeVatSummary([
      { type: 'credit', category: 'Other Income', amount: 300, vatAmount: 0 },
    ]);
    assert.equal(r.exemptSales, 300);
    assert.equal(r.vatableSales, 0);
    assert.equal(r.outputVat, 0);
  });

  it('Sales Revenue and Other Income both present: outputVat/vatableSales sum across both categories', () => {
    const r = computeVatSummary([
      { type: 'credit', category: 'Sales Revenue', amount: 1120, vatAmount: 120 },
      { type: 'credit', category: 'Other Income', amount: 560, vatAmount: 60 },
    ]);
    assert.equal(r.vatableSales, 1500); // 1000 + 500
    assert.equal(r.outputVat, 180);     // 120 + 60
  });
});

// ═══════════════════════════════════════════════════════════
// js/finance-ledger.js pure helpers — sanitize/_mapEntry/_rollupDelta (v14
// re-audit finding: "the sole ledger-posting/dedupe/rollup chokepoint has
// zero automated test coverage"). These three are exported specifically
// because they're callable with zero Firestore per their own code (the
// file's header comment says as much) — post/upsertByRef/postMulti/remove
// all need `db`/`firebase` and are integration-tested via a real emulator or
// window.Ledger._selfTest() in a browser console instead, not here.
//
// NOTE ON SCOPE: the finding recommended a dedicated tests/ledger.test.mjs
// file using this exact require()-a-window-global pattern. This v14 fix
// batch's edit scope is restricted to tests/money.test.mjs only (no new test
// files) — folded in here instead so the coverage gap is closed without
// creating an out-of-scope file. A follow-up should still split this into
// its own tests/ledger.test.mjs for discoverability.
// ═══════════════════════════════════════════════════════════
describe('finance-ledger.js pure helpers (sanitize/_mapEntry/_rollupDelta)', () => {
  it('sanitize: no-op on a ref with no slash', () => {
    assert.equal(_sanitize('EXP-abc123'), 'EXP-abc123');
  });

  it('sanitize: replaces every "/" with "_" (Firestore doc ids can\'t contain "/")', () => {
    assert.equal(_sanitize('A/B/C'), 'A_B_C');
  });

  it('sanitize: null/undefined ref coerces to empty string, not "null"/"undefined"', () => {
    assert.equal(_sanitize(null), '');
    assert.equal(_sanitize(undefined), '');
  });

  it('_mapEntry: maps ref/kind/category onto refNumber/type/account, strips undefined optional fields', () => {
    const row = _mapEntry({
      ref: 'EXP-test1', date: '2026-08-01', kind: 'debit', amount: 1120,
      category: 'General Expense', accountType: 'expense', source: 'Expense',
    });
    assert.equal(row.refNumber, 'EXP-test1');
    assert.equal(row.type, 'debit');
    assert.equal(row.account, 'General Expense'); // falls back to category when entry.account is absent
    assert.equal(row.amount, 1120);
    assert.equal('dept' in row, false); // undefined optional fields are deleted, not written as null
    assert.equal('projectId' in row, false);
  });

  it('_mapEntry: vatTreatment auto-attaches inputVat via vatSplit, unless the caller (or extra) already set it', () => {
    const withAuto = _mapEntry({ ref: 'EXP-a', date: '2026-08-01', kind: 'debit', amount: 1120, vatTreatment: 'inclusive' });
    assert.equal(withAuto.inputVat, 120);

    const noTreatment = _mapEntry({ ref: 'CRJ-a', date: '2026-08-01', kind: 'credit', amount: 500, category: 'Sales Revenue' });
    assert.equal('inputVat' in noTreatment, false); // no vatTreatment -> no inputVat field at all

    const extraWins = _mapEntry({ ref: 'CDJ-a', date: '2026-08-01', kind: 'debit', amount: 1120, vatTreatment: 'inclusive', extra: { inputVat: 99 } });
    assert.equal(extraWins.inputVat, 99); // caller's own extra.inputVat is never overwritten by the auto-computed split
  });

  it('_mapEntry: entry.extra fields merge onto the row as-is (e.g. bankFlow)', () => {
    const row = _mapEntry({ ref: 'CDJ-b', date: '2026-08-01', kind: 'debit', amount: 200, extra: { bankFlow: 'out' } });
    assert.equal(row.bankFlow, 'out');
  });

  it('_rollupDelta: a credit row contributes to income, not expense; category defaults to "Other"', () => {
    const d = _rollupDelta({ date: '2026-08-05', type: 'credit', amount: 1000 });
    assert.equal(d.month, '2026-08');
    assert.equal(d.category, 'Other');
    assert.equal(d.income, 1000);
    assert.equal(d.expense, 0);
  });

  it('_rollupDelta: a debit row contributes to expense, not income', () => {
    const d = _rollupDelta({ date: '2026-08-05', type: 'debit', amount: 500, category: 'Materials' });
    assert.equal(d.category, 'Materials');
    assert.equal(d.income, 0);
    assert.equal(d.expense, 500);
  });

  it('_rollupDelta: accountType wins over type when both are present (matches window.ledgerKind precedence)', () => {
    // An asset-tagged credit (e.g. the Advances-to-Employees repayment leg)
    // must NOT be miscounted as income just because type:'credit'.
    const d = _rollupDelta({ date: '2026-08-05', type: 'credit', accountType: 'asset', amount: 2000, category: 'Cash Advance' });
    assert.equal(d.income, 0);
    assert.equal(d.expense, 0);
  });

  it('_rollupDelta: malformed/missing date buckets into "undated", not a thrown error', () => {
    assert.equal(_rollupDelta({ type: 'credit', amount: 100 }).month, 'undated');
    assert.equal(_rollupDelta({ date: 'not-a-date', type: 'credit', amount: 100 }).month, 'undated');
  });

  it('_rollupDelta: vatOutput/vatInput come from the SAME computeVatSummary a single-row array would produce (zero-drift-by-construction)', () => {
    const row = { date: '2026-08-01', type: 'credit', category: 'Sales Revenue', amount: 1120, vatAmount: 120 };
    const d = _rollupDelta(row);
    assert.equal(d.vatOutput, computeVatSummary([row]).outputVat);
  });
});

// ═══════════════════════════════════════════════════════════
// Payroll recall spec (2026-08-04) — month-scoped inputs + editable overrides.
// §A1 monthBounds, §A3.3 computeKpiForMonth, §C2 applyPayLineOverride, plus a
// dedicated computePayLine describe for §A4 (statutory year keyed off
// ctx.month instead of always "whatever year it is right now").
// ═══════════════════════════════════════════════════════════
describe('computePayLine — §A4 statutory year from ctx.month (the only permitted edit to this frozen function)', () => {
  it('same-year run (ctx.month in 2026): output is byte-identical to the existing pinned same-input expectation — regression guard', () => {
    const line = computePayLine(
      { id: 'u1', displayName: 'Juan', salary: 20000, allowance: 2000, deductions: 500 },
      { policy: 'flat', month: '2026-06' }
    );
    assert.deepEqual(line, {
      uid: 'u1', name: 'Juan', payClass: 'regular',
      base: 20000, allowance: 2000, otherDeductions: 500, unearnedDeductions: 0, withheldDeductions: 500,
      sss: 1100, philhealth: 550, pagibig: 200, tax: 0,
      er: { sss: 2200, philhealth: 550, pagibig: 200 },
      kpiScore: 1, attScore: 1, perfFactor: 1, policy: 'flat',
      caBalance: 0, caPlanned: 0, caPlan: [],
      gross: 22000, effectiveGross: 22000, statutoryTotal: 1850,
      netBeforeCA: 19650, finalPay: 19650,
    });
  });

  it('ctx.month absent: falls back to window.bizYear() exactly as before (the pinned 2026 stub) — every existing call site that omits month is unaffected', () => {
    const line = computePayLine(
      { id: 'u1', displayName: 'Juan', salary: 20000, allowance: 2000, deductions: 500 },
      { policy: 'flat' } // no month at all
    );
    assert.equal(line.statutoryTotal, 1850); // identical to the ctx.month:'2026-06' case above
    assert.equal(line.finalPay, 19650);
  });

  it('cross-year run (ctx.month in 2025, a year with no STATUTORY table entry): statutory zeros out via the missing-year path, NOT 2026 brackets', () => {
    const line = computePayLine(
      { id: 'u1td', displayName: 'TestDec', salary: 20000, allowance: 2000, deductions: 500 },
      { policy: 'flat', month: '2025-12' }
    );
    assert.deepEqual(line, {
      uid: 'u1td', name: 'TestDec', payClass: 'regular',
      base: 20000, allowance: 2000, otherDeductions: 500, unearnedDeductions: 0, withheldDeductions: 500,
      sss: 0, philhealth: 0, pagibig: 0, tax: 0,
      er: { sss: 0, philhealth: 0, pagibig: 0 },
      kpiScore: 1, attScore: 1, perfFactor: 1, policy: 'flat',
      caBalance: 0, caPlanned: 0, caPlan: [],
      gross: 22000, effectiveGross: 22000, statutoryTotal: 0,
      netBeforeCA: 21500, finalPay: 21500,
    });
  });
});

describe('monthBounds — js/money-core.js §A1 (pure string/integer date math, no Date object)', () => {
  it('past month: endDate is the last calendar day, upToDay is the full month', () => {
    assert.deepEqual(monthBounds('2026-06', '2026-08-04'), {
      startDate: '2026-06-01', endDate: '2026-06-30', upToDay: 30, daysInMonth: 30,
      isCurrent: false, isFuture: false,
    });
  });

  it('current month: endDate is today, upToDay is today\'s day-of-month', () => {
    assert.deepEqual(monthBounds('2026-08', '2026-08-04'), {
      startDate: '2026-08-01', endDate: '2026-08-04', upToDay: 4, daysInMonth: 31,
      isCurrent: true, isFuture: false,
    });
  });

  it('future month: isFuture true, upToDay 0 — callers must treat this as "no data"', () => {
    const b = monthBounds('2026-09', '2026-08-04');
    assert.equal(b.isFuture, true);
    assert.equal(b.upToDay, 0);
  });

  it('leap year February (2028, divisible by 4, not by 100): daysInMonth 29', () => {
    assert.equal(monthBounds('2028-02', '2028-03-01').daysInMonth, 29);
  });

  it('non-leap year February (2027): daysInMonth 28', () => {
    assert.equal(monthBounds('2027-02', '2027-03-01').daysInMonth, 28);
  });

  it('century-year exception (2100, divisible by 100 but NOT by 400): daysInMonth 28, not 29', () => {
    assert.equal(monthBounds('2100-02', '2100-03-01').daysInMonth, 28);
  });
});

describe('computeKpiForMonth — js/money-core.js §A3.3 (month-scoped KPI, pure — resolver stubs read plain _dm/_cm fields)', () => {
  const resolveDone    = t => t._dm; // null | '' | 'YYYY-MM'
  const resolveCreated = t => t._cm; // '' | 'YYYY-MM'

  it('zero in-scope tasks (empty list, or every task created after M) ⇒ KPI floor of 1 — no assigned/in-scope work ≠ bad KPI', () => {
    assert.equal(computeKpiForMonth([], '2026-06', undefined, resolveDone, resolveCreated), 1);
    assert.equal(computeKpiForMonth([{ _dm: null, _cm: '2026-07' }], '2026-06', undefined, resolveDone, resolveCreated), 1);
  });

  it('scope matrix: done-in-M, done-after-M, done-before-M, open (never done), created-after-M', () => {
    const tasks = [
      { _dm: '2026-06', _cm: '2026-01' }, // done IN M -> numerator + denominator
      { _dm: '2026-07', _cm: '2026-01' }, // done AFTER M -> denominator only (was open/unfinished during M)
      { _dm: '2026-05', _cm: '2026-01' }, // done BEFORE M -> out of scope entirely
      { _dm: null,      _cm: '2026-01' }, // never done, existed during M -> denominator only
      { _dm: null,      _cm: '2026-07' }, // created AFTER M -> out of scope entirely (didn't exist yet)
    ];
    // in-scope = the 3 non-"out" tasks; doneInM = 1 -> taskScore = 1/3
    // deliv defaults to 1 (no deliverableScore) -> (1/3)*0.7 + 1*0.3
    assert.equal(computeKpiForMonth(tasks, '2026-06', undefined, resolveDone, resolveCreated), (1/3)*0.7 + 1*0.3);
  });

  it('done-but-undatable (_dm==="") counts as done-in-scope ONLY when created at-or-before M — never punishes a later month for an old finished task', () => {
    // cm <= M -> counts as done-in-scope -> sole in-scope task, all done -> KPI 1
    assert.equal(computeKpiForMonth([{ _dm: '', _cm: '2026-01' }], '2026-06', undefined, resolveDone, resolveCreated), 1);
    // cm > M -> "didn't exist yet" wins even over the undatable-done rule -> out of scope entirely -> floor of 1 (zero in-scope)
    assert.equal(computeKpiForMonth([{ _dm: '', _cm: '2026-07' }], '2026-06', undefined, resolveDone, resolveCreated), 1);
  });

  it('deliverableScore present + exact 0.7/0.3 weighting pinned on a 2-of-3 case', () => {
    const tasks = [
      { _dm: '2026-06', _cm: '2026-01' },
      { _dm: '2026-06', _cm: '2026-01' },
      { _dm: null,      _cm: '2026-01' },
    ];
    // inScope=3, doneInM=2 -> taskScore=2/3; deliverableScore=80 -> deliv=0.8
    assert.equal(computeKpiForMonth(tasks, '2026-06', 80, resolveDone, resolveCreated), (2/3)*0.7 + 0.8*0.3);
  });
});

describe('Other Deductions withheld/unearned split (owner ruling 2026-08-07)', () => {
  const EMP = { id: 'u1', displayName: 'Split', salary: 25000, allowance: 3000, deductions: 1500 };
  const line = (extra) => computePayLine({ ...EMP, ...extra }, { month: '2026-08', caPlan: [{ amount: 2000 }] });

  it('field ABSENT ⇒ all withheld, and every figure is byte-identical to pre-split behaviour', () => {
    const l = line({});
    assert.equal(l.unearnedDeductions, 0);
    assert.equal(l.withheldDeductions, 1500);
    assert.equal(l.effectiveGross, 28000);          // == nominal gross, exactly as before
    assert.equal(l.finalPay, 21469.95);
  });

  it('TAKE-HOME NEVER MOVES: only where the deduction is booked changes', () => {
    const withheld = line({});
    const unearned = line({ deductionsUnearned: 1500 });
    const mixed    = line({ deductionsUnearned: 700 });
    assert.equal(unearned.finalPay,   withheld.finalPay);
    assert.equal(mixed.finalPay,      withheld.finalPay);
    assert.equal(unearned.netBeforeCA, withheld.netBeforeCA);
    assert.equal(mixed.netBeforeCA,    withheld.netBeforeCA);
  });

  it('unearned pay leaves the EXPENSE debit — effectiveGross drops by exactly that amount', () => {
    assert.equal(line({ deductionsUnearned: 1500 }).effectiveGross, 26500);
    assert.equal(line({ deductionsUnearned: 700  }).effectiveGross, 27300);
  });

  it('the split always sums back to the total', () => {
    for (const u of [0, 1, 700, 1499.99, 1500]) {
      const l = line({ deductionsUnearned: u });
      assert.equal(+(l.unearnedDeductions + l.withheldDeductions).toFixed(2), l.otherDeductions);
    }
  });

  it('CLAMPED both ways: a stale value above the total, or a negative one, can never invent expense', () => {
    const over = line({ deductionsUnearned: 9999 });
    assert.equal(over.unearnedDeductions, 1500);
    assert.equal(over.withheldDeductions, 0);
    assert.equal(over.effectiveGross, 26500);       // never below gross − otherDeductions
    const neg = line({ deductionsUnearned: -500 });
    assert.equal(neg.unearnedDeductions, 0);
    assert.equal(neg.withheldDeductions, 1500);
    assert.equal(neg.effectiveGross, 28000);
  });

  it('DISBURSE LEDGER IDENTITY holds for every split: debits === credits', () => {
    for (const u of [0, 500, 1500]) {
      const l = line({ deductionsUnearned: u });
      const actualCa = l.caPlanned;
      const erTotal  = (l.er?.sss||0) + (l.er?.philhealth||0) + (l.er?.pagibig||0);
      // Exactly the legs js/departments.js disbursePayRun posts.
      const debits  = l.effectiveGross + erTotal;
      const credits = (l.sss + (l.er?.sss||0)) + (l.philhealth + (l.er?.philhealth||0))
                    + (l.pagibig + (l.er?.pagibig||0)) + l.tax   // statutory payables
                    + actualCa                                    // Advances to Employees
                    + l.withheldDeductions                        // Employee Deductions Payable
                    + (l.netBeforeCA - actualCa);                 // Cash
      assert.equal(+debits.toFixed(2), +credits.toFixed(2));
      // …and Cash is the real take-home, not take-home + otherDeductions.
      assert.equal(+(l.netBeforeCA - actualCa).toFixed(2), +l.finalPay.toFixed(2));
    }
  });
});

describe('applyPayLineOverride — js/money-core.js §C2 (output override, layered on top of a computePayLine result)', () => {
  // Reuses the pinned 'performance' policy line (nonzero caPlanned:1500,
  // otherDeductions:0) from the computePayLine describe above so the netCash
  // identity check below is grounded in a real frozen line, not a fixture.
  const baseLine = computePayLine(
    { id: 'u2', displayName: 'Maria', salary: 30000, allowance: 5000, deductions: 0 },
    { policy: 'performance', kpiScore: 0.8, attScore: 0.9, caPlan: [{ amount: 1000 }, { amount: 500 }], caBalance: 2500 }
  );

  function assertIdentitiesHold(line) {
    // Both identities are stated in their GENERAL form (2026-08-07). They used
    // to be written with plain otherDeductions, which was only correct because
    // this fixture happens to set deductions:0 — with a withheld/unearned split
    // present they would have silently passed while the ledger drifted.
    // (b) the netCash identity: effectiveGross - statutoryTotal - caPlanned === finalPay + WITHHELD deductions
    assert.equal(
      +(line.effectiveGross - line.statutoryTotal - line.caPlanned).toFixed(2),
      +(line.finalPay + line.withheldDeductions).toFixed(2)
    );
    // (c) effectiveGross === netBeforeCA + statutoryTotal + otherDeductions - UNEARNED
    assert.equal(
      +line.effectiveGross.toFixed(2),
      +(line.netBeforeCA + line.statutoryTotal + line.otherDeductions - line.unearnedDeductions).toFixed(2)
    );
  }

  it('override finalPay UPWARD: finalPay equals the override, both money identities still hold, input line untouched', () => {
    const out = applyPayLineOverride(baseLine, { finalPay: 30000, note: 'raise', setBy: 'p1', setByName: 'Pres', setAt: 1700000000000, original: { a: 1 } });
    assert.equal(out.finalPay, 30000);
    assert.equal(out.netBeforeCA, 31500);
    assert.equal(out.effectiveGross, 36026.3);
    assertIdentitiesHold(out);
    assert.equal(baseLine.finalPay, 28123.7); // (d) input line never mutated
  });

  it('override finalPay DOWNWARD: same identities hold, input line still untouched', () => {
    const out = applyPayLineOverride(baseLine, { finalPay: 20000, note: 'cut', setBy: 'p1', setByName: 'Pres', setAt: 1700000000000, original: { a: 1 } });
    assert.equal(out.finalPay, 20000);
    assert.equal(out.netBeforeCA, 21500);
    assert.equal(out.effectiveGross, 26026.3);
    assertIdentitiesHold(out);
    assert.equal(baseLine.finalPay, 28123.7);
  });

  it('no OverrideEntry passed at all: plain copy, values unchanged, and NO overridden/overrideMeta fields added', () => {
    const out = applyPayLineOverride(baseLine, undefined);
    assert.equal(out.finalPay, baseLine.finalPay);
    assert.equal('overridden' in out, false);
    assert.equal('overrideMeta' in out, false);
    assert.notEqual(out, baseLine); // still a new object, never the same reference
  });

  it('an OverrideEntry with no numeric override fields (just a note): overridden:true + overrideMeta present, but no values change', () => {
    const out = applyPayLineOverride(baseLine, { note: 'just a note' });
    assert.equal(out.overridden, true);
    assert.deepEqual(out.overrideMeta.fields, []);
    assert.equal(out.finalPay, baseLine.finalPay);
    assert.equal(out.effectiveGross, baseLine.effectiveGross);
  });
});

// ═══════════════════════════════════════════════════════════
// resolveStatutoryEE + statConfig (statutory-config spec, 2026-08-06)
//
// The feature: an explicit per-person SWITCH for each statutory item, so "0"
// stops meaning both "not due" and "someone forgot". Precedence per type:
// exempt > fixed > auto > legacy-fallthrough.
//
// The load-bearing property these tests exist to defend: an employee with NO
// statConfig computes BYTE-IDENTICALLY to pre-spec behavior, forever. That
// includes the deliberately-pinned typed-0-falls-through quirk above
// ("quirk (pinned, not fixed)"), which is UNCHANGED — the cure for it is
// opting in to mode 'fixed', not a silent behavior change for everyone.
// Year is pinned to 2026 by the window.bizYear stub at the top of this file;
// STATUTORY[2026] is still a placeholder table (see header).
// ═══════════════════════════════════════════════════════════
describe('resolveStatutoryEE + statConfig (statutory-config spec)', () => {
  // The exact :205 fixture and its :210 pinned result, restated here so these
  // tests fail loudly if the legacy baseline itself ever drifts.
  const FIXTURE_A = { id: 'u1', displayName: 'Juan', salary: 20000, allowance: 2000, deductions: 500 };
  const PINNED_A = {
    uid: 'u1', name: 'Juan', payClass: 'regular',
    base: 20000, allowance: 2000, otherDeductions: 500, unearnedDeductions: 0, withheldDeductions: 500,
    sss: 1100, philhealth: 550, pagibig: 200, tax: 0,
    er: { sss: 2200, philhealth: 550, pagibig: 200 },
    kpiScore: 1, attScore: 1, perfFactor: 1, policy: 'flat',
    caBalance: 0, caPlanned: 0, caPlan: [],
    gross: 22000, effectiveGross: 22000, statutoryTotal: 1850,
    netBeforeCA: 19650, finalPay: 19650,
  };

  it('LEGACY IDENTITY: statConfig undefined and statConfig {} both reproduce the exact pinned line', () => {
    assert.deepEqual(computePayLine({ ...FIXTURE_A, statConfig: undefined }, { policy: 'flat' }), PINNED_A);
    assert.deepEqual(computePayLine({ ...FIXTURE_A, statConfig: {} }, { policy: 'flat' }), PINNED_A);
    // and the no-field-at-all case, which is what every existing payroll/{uid} doc looks like
    assert.deepEqual(computePayLine(FIXTURE_A, { policy: 'flat' }), PINNED_A);
  });

  it("exempt-all: EE zeroed AND er zeroed (an exempt person is not on that agency's remittance at all)", () => {
    const line = computePayLine(
      { ...FIXTURE_A, statConfig: { sss: 'exempt', philhealth: 'exempt', pagibig: 'exempt', tax: 'exempt' } },
      { policy: 'flat' }
    );
    assert.deepEqual(
      { sss: line.sss, philhealth: line.philhealth, pagibig: line.pagibig, tax: line.tax },
      { sss: 0, philhealth: 0, pagibig: 0, tax: 0 }
    );
    assert.deepEqual(line.er, { sss: 0, philhealth: 0, pagibig: 0 });
    assert.equal(line.statutoryTotal, 0);
    // net rises by exactly the old statutory total: 19650 + 1850
    assert.equal(line.finalPay, 21500);
    // untouched-math guard: everything outside statutory is byte-identical
    assert.equal(line.gross, PINNED_A.gross);
    assert.equal(line.effectiveGross, PINNED_A.effectiveGross);
    assert.equal(line.otherDeductions, PINNED_A.otherDeductions);
  });

  it('PARTIAL config resolves PER TYPE: sss exempt only — sss+er.sss zeroed, other three exactly the pinned values', () => {
    const line = computePayLine({ ...FIXTURE_A, statConfig: { sss: 'exempt' } }, { policy: 'flat' });
    assert.equal(line.sss, 0);
    assert.equal(line.er.sss, 0);
    assert.deepEqual(
      { philhealth: line.philhealth, pagibig: line.pagibig, tax: line.tax },
      { philhealth: PINNED_A.philhealth, pagibig: PINNED_A.pagibig, tax: PINNED_A.tax }
    );
    // the other two ER legs stay table-computed
    assert.deepEqual(
      { philhealth: line.er.philhealth, pagibig: line.er.pagibig },
      { philhealth: PINNED_A.er.philhealth, pagibig: PINNED_A.er.pagibig }
    );
    assert.equal(line.statutoryTotal, 750); // 1850 - 1100
  });

  it("auto BEATS a stale hand-typed amount: the :245 fixture's 800/300/100/50 are ignored, table wins", () => {
    const line = computePayLine(
      {
        id: 'u3', displayName: 'Pedro', salary: 15000, allowance: 0, deductions: 200,
        sss: 800, philhealth: 300, pagibig: 100, tax: 50,
        statConfig: { sss: 'auto', philhealth: 'auto', pagibig: 'auto', tax: 'auto' },
      },
      { policy: 'flat' }
    );
    // = computeStatutory({grossPay:15000, year:2026}).ee
    assert.deepEqual(
      { sss: line.sss, philhealth: line.philhealth, pagibig: line.pagibig, tax: line.tax },
      { sss: 750, philhealth: 375, pagibig: 200, tax: 0 }
    );
    // er unchanged from the :258 pin — 'auto' is not exemption
    assert.deepEqual(line.er, { sss: 1500, philhealth: 375, pagibig: 200 });
  });

  it('fixed HONOURS a typed 0 (the quirk, cured — opt-in only) and keeps table ER', () => {
    const line = computePayLine(
      { id: 'u5', displayName: 'Liza', salary: 12000, allowance: 0, deductions: 0,
        sss: 0, philhealth: 0, pagibig: 0, tax: 0, statConfig: { sss: 'fixed' } },
      { policy: 'flat' }
    );
    assert.equal(line.sss, 0); // would be 600 under legacy — see the pinned quirk test above
    assert.equal(line.er.sss, 1200); // table ER for gross 12000, NOT zeroed by 'fixed'
    // the three unconfigured types still take the legacy fallthrough (typed 0 -> table)
    assert.deepEqual(
      { philhealth: line.philhealth, pagibig: line.pagibig, tax: line.tax },
      { philhealth: 300, pagibig: 200, tax: 0 }
    );
  });

  it('fixed uses the typed amount when non-zero, and ER stays table-computed (er is never hand-typed)', () => {
    const line = computePayLine(
      { id: 'u9', salary: 15000, allowance: 0, deductions: 0, sss: 123.45,
        statConfig: { sss: 'fixed' } },
      { policy: 'flat' }
    );
    assert.equal(line.sss, 123.45);
    assert.deepEqual(line.er, { sss: 1500, philhealth: 375, pagibig: 200 });
  });

  it('UNKNOWN/garbage mode values fall back to legacy rather than throwing', () => {
    for (const junk of ['AUTO', 'Exempt', 'nope', '', 0, 1, null, true, {}, [], NaN]) {
      const line = computePayLine(
        { ...FIXTURE_A, statConfig: { sss: junk, philhealth: junk, pagibig: junk, tax: junk } },
        { policy: 'flat' }
      );
      assert.deepEqual(line, PINNED_A, `mode ${JSON.stringify(junk)} should be legacy-identical`);
    }
    // a statConfig that is itself garbage must also not throw
    for (const junk of [null, 0, '', false, NaN]) {
      assert.deepEqual(computePayLine({ ...FIXTURE_A, statConfig: junk }, { policy: 'flat' }), PINNED_A);
    }
  });

  it('direct resolveStatutoryEE with stat:null — every mode returns 0, no throw (no-table safety)', () => {
    assert.deepEqual(
      resolveStatutoryEE({ sss: 500, statConfig: { sss: 'auto' } }, null),
      { sss: 0, philhealth: 0, pagibig: 0, tax: 0, er: { sss: 0, philhealth: 0, pagibig: 0 } }
    );
    // 'fixed' still honours the typed amount with no table present
    assert.equal(resolveStatutoryEE({ sss: 500, statConfig: { sss: 'fixed' } }, null).sss, 500);
    // legacy fallthrough with no table: typed wins, else 0
    assert.equal(resolveStatutoryEE({ sss: 500 }, null).sss, 500);
    assert.equal(resolveStatutoryEE({}, null).sss, 0);
    // NOTE (spec observation, deliberately NOT pinned as safe): the spec's
    // resolver guards `(emp && emp.statConfig)` but the legacy/fixed branches
    // dereference `emp[k]` unguarded, so resolveStatutoryEE(undefined, …)
    // throws. That is NOT a regression and not reachable from computePayLine,
    // which dereferences `emp.salary` (money-core.js:53) long before calling
    // the resolver — a nullish emp already threw pre-spec. Left exactly as the
    // spec specifies rather than silently hardening frozen money code.
  });

  it('TYPE B DEFAULT STAYS ZERO: a worker with no statConfig and no typed amounts, with no table available, deducts nothing', () => {
    const saved = window.computeStatutory;
    window.computeStatutory = undefined; // the Type B path never touches the tables today
    try {
      const line = computePayLine({ id: 'w1', salary: 4000, allowance: 0, deductions: 0 }, { policy: 'flat' });
      assert.deepEqual(
        { sss: line.sss, philhealth: line.philhealth, pagibig: line.pagibig, tax: line.tax },
        { sss: 0, philhealth: 0, pagibig: 0, tax: 0 }
      );
      assert.deepEqual(line.er, { sss: 0, philhealth: 0, pagibig: 0 });
      assert.equal(line.statutoryTotal, 0);
      assert.equal(line.finalPay, 4000);
    } finally {
      window.computeStatutory = saved;
    }
  });
});
