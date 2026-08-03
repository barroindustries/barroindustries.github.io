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
// Run with: node --test tests/
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
const { vatSplit, computePayLine, computeBreakeven } = money;
const { computeStatutory } = statutory;

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
      base: 20000, allowance: 2000, otherDeductions: 500,
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
      base: 30000, allowance: 5000, otherDeductions: 0,
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
});
