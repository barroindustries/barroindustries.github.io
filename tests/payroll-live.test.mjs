// tests/payroll-live.test.mjs — the LIVE PAYROLL VIEW's pure additions
// (PAYROLL-LIVE-SPEC-2026-08-11, js/payroll.js's window.PayrollCore).
//
// This pins the four decisions that can be made without a database and that
// decide whether a period is treated as IN PROGRESS (a read-only projection,
// window.Payroll.preview) or ENDED (the stored frozen line, window.Payroll.
// load) — plus the fold that a preview and a real prepare must never
// disagree about:
//
//   • periodEnd     — the period's last calendar day, ISO
//   • periodEnded   — has today passed that day (plain string compare)
//   • teamOf        — 'office' for a month, 'operations' for a week
//   • foldAndNormalize — identical output to what refold() used to build
//                        inline, so a live figure and a frozen one are built
//                        by the SAME code (D2: one pipeline, two callers)
//
// If a test here fails after a deliberate change, an owner ruling has
// changed — say which, and why, in the commit. Do not adjust a number to make
// a test pass: these functions decide when money is allowed to move.
//
// Run with: node --test tests/*.test.mjs
// Zero deps: node:test + node:assert only, matching the other suites here.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// money-core FIRST — it defines window.monthBounds and the payWeek* date
// helpers PC.periodEnd/label read, exactly as index.html's load order does.
const money = require(path.join(ROOT, 'js/money-core.js'));
const PC = require(path.join(ROOT, 'js/payroll.js'));

const { computePayLine, computeWeeklyLine } = money;
const r2 = (n) => Math.round(((+n || 0) + Number.EPSILON) * 100) / 100;

// ── fixtures, built by the FROZEN engines, never by hand (same shape as
//    tests/payroll-unified.test.mjs's officeLine/opsLine, kept local so this
//    file has no cross-file test dependency) ───────────────────────────────

function officeLine(over) {
  const emp = Object.assign({
    id: 'u1', displayName: 'Marisol Cruz', payClass: 'regular',
    salary: 30000, allowance: 3000, deductions: 1500,
    sss: 675, philhealth: 450, pagibig: 100, tax: 250
  }, (over && over.emp) || {});
  return computePayLine(emp, Object.assign({
    month: '2026-08', policy: 'flat', caPlan: [{ caId: 'ca1', amount: 2000 }], caBalance: 8000
  }, (over && over.ctx) || {}));
}

function opsLine(over) {
  const o = over || {};
  const handTyped = o.handTyped == null ? 200 : o.handTyped;
  const statTotal = o.statTotal == null ? 300 : o.statTotal;
  const days = o.days || [
    { date: '2026-08-10', hours: 8 }, { date: '2026-08-11', hours: 8 },
    { date: '2026-08-12', hours: 8 }, { date: '2026-08-13', hours: 9, otHours: 1 },
    { date: '2026-08-14', hours: 8 }, { date: '2026-08-15', hours: 0 },
    { date: '2026-08-16', hours: 0, travelHours: 4 }
  ];
  const line = computeWeeklyLine({
    hourlyRate: 100,
    allowances: { meal: 250, transport: 120, rent: 500 },
    deductions: r2(handTyped + statTotal),
    caDeduction: o.caDeduction == null ? 400 : o.caDeduction
  }, days);
  line.workerId = o.workerId || 'w1';
  line.name = o.name || 'Ramon Dela Cruz';
  line.linkedUid = 'u9';
  line.jobTitle = 'Welder';
  line.department = 'Production';
  line.rateSource = 'hourlyRate';
  line.dailyRate = 800;
  line.statutory = {
    sss: 150, philhealth: 100, pagibig: 25, tax: 25, total: statTotal,
    configured: true, applied: true, er: { sss: 300, philhealth: 100, pagibig: 25 }
  };
  line.otherDeductionsOnly = handTyped;
  line.caBalanceBefore = 5000;
  line.caBalanceAfter = r2(5000 - line.caDeduction);
  return line;
}

// ═══════════════════════════════════════════════════════════════════════════

describe('periodEnd — the period\'s last calendar day', () => {
  it('a month\'s last day, via window.monthBounds (called, never re-derived)', () => {
    assert.equal(PC.periodEnd('2026-08'), '2026-08-31');
    assert.equal(PC.periodEnd('2026-01'), '2026-01-31');
    assert.equal(PC.periodEnd('2026-04'), '2026-04-30');
  });

  it('handles a leap year correctly (2028 is one, 2026 is not)', () => {
    assert.equal(PC.periodEnd('2028-02'), '2028-02-29');
    assert.equal(PC.periodEnd('2026-02'), '2026-02-28');
  });

  it('a week\'s last day is its Sunday (Monday -> Sunday)', () => {
    assert.equal(PC.periodEnd('2026-08-10'), '2026-08-16');
  });

  it('a week spanning a month end still lands on its own Sunday', () => {
    assert.equal(PC.periodEnd('2026-07-27'), '2026-08-02');
  });

  it('never throws — a deciding function must not take the pay screen down', () => {
    assert.doesNotThrow(() => PC.periodEnd('garbage'));
  });
});

describe('periodEnded — has today passed the period\'s last day (plain string compare)', () => {
  it('a month is not ended on its own last day, and is ended the day after', () => {
    assert.equal(PC.periodEnded('2026-08', '2026-08-31'), false);
    assert.equal(PC.periodEnded('2026-08', '2026-09-01'), true);
  });

  it('mid-month is not ended', () => {
    assert.equal(PC.periodEnded('2026-08', '2026-08-15'), false);
  });

  it('a week is not ended on its own Sunday, and is ended the day after', () => {
    assert.equal(PC.periodEnded('2026-08-10', '2026-08-16'), false);
    assert.equal(PC.periodEnded('2026-08-10', '2026-08-17'), true);
  });

  it('mid-week is not ended', () => {
    assert.equal(PC.periodEnded('2026-08-10', '2026-08-13'), false);
  });
});

describe('teamOf — payClass/period-kind selects the tab, and nothing else', () => {
  it('a month is Office Team', () => {
    assert.equal(PC.teamOf('2026-08'), 'office');
  });
  it('a week is Operations Team', () => {
    assert.equal(PC.teamOf('2026-08-10'), 'operations');
  });
});

describe('foldAndNormalize — the SAME fold refold() used to build inline (D2)', () => {
  it('folds a one-off earning onto one monthly line while holding another, and the totals only count the payable one', () => {
    const paid = officeLine();
    const held = officeLine({ emp: { id: 'u2', displayName: 'On Leave Person' } });
    const doc = {
      oneOffs: { u1: [{ id: 'oo-1', label: 'Bonus', amount: 500, kind: 'earning' }] },
      excluded: { u2: 'On leave this month' },
      warnings: [],
      skipped: []
    };

    const result = PC._foldForTest([paid, held], 'month', doc);
    assert.equal(result.lines.length, 2);

    const paidRow = result.lines.find((l) => l.personId === 'u1');
    const heldRow = result.lines.find((l) => l.personId === 'u2');
    assert.equal(paidRow.held, false);
    assert.equal(heldRow.held, true);
    assert.equal(heldRow.heldReason, 'On leave this month');

    // Identical to composing the primitives by hand, the way refold() used to
    // do inline before the extraction — proves the extraction changed nothing.
    const expectedPaid = PC.normalizeLine(PC.applyOneOffs(paid, 'month', doc.oneOffs.u1), 'month', { heldReason: null });
    assert.equal(paidRow.net, expectedPaid.net);
    assert.equal(paidRow.oneOffEarnings, 500);
    assert.deepEqual(paidRow, expectedPaid);

    // Held people are counted but excluded from every money figure (PC.totalsOf).
    assert.equal(result.totals.people, 1);
    assert.equal(result.totals.heldPeople, 1);
  });

  it('folds a one-off deduction and a hold onto a weekly line, matching the primitives directly', () => {
    const a = opsLine({ workerId: 'w1', name: 'Ramon Dela Cruz' });
    const b = opsLine({ workerId: 'w2', name: 'Held Worker' });
    const doc = {
      oneOffs: { w1: [{ id: 'oo-2', label: 'Lost tool', amount: 300, kind: 'deduction' }] },
      excluded: { w2: 'Already paid separately' },
      warnings: [],
      skipped: []
    };

    const result = PC._foldForTest([a, b], 'week', doc);
    const rowA = result.lines.find((l) => l.personId === 'w1');
    const rowB = result.lines.find((l) => l.personId === 'w2');
    assert.equal(rowA.held, false);
    assert.equal(rowB.held, true);
    assert.equal(rowB.heldReason, 'Already paid separately');

    const expectedA = PC.normalizeLine(PC.applyOneOffs(a, 'week', doc.oneOffs.w1), 'week', { heldReason: null });
    assert.deepEqual(rowA, expectedA);
    assert.equal(rowA.oneOffDeductions, 300);
  });

  it('with no run document at all (a preview before anyone has touched the period), folds to a plain normalise', () => {
    const line = opsLine();
    const result = PC._foldForTest([line], 'week', null);
    const expected = PC.normalizeLine(line, 'week', { heldReason: null });
    assert.equal(result.lines.length, 1);
    assert.deepEqual(result.lines[0], expected);
    assert.equal(result.warnings.length, 0);
  });

  it('names anyone the builder skipped, verbatim, as a warning', () => {
    const line = officeLine();
    const doc = { skipped: [{ uid: 'u9', name: 'No Rate Guy', reason: 'no-rate' }] };
    const result = PC._foldForTest([line], 'month', doc);
    assert.ok(result.warnings.some((w) => w.code === 'not-on-this-run' && /No Rate Guy/.test(w.message)));
  });
});
