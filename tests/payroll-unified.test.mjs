// tests/payroll-unified.test.mjs — window.PayrollCore (js/payroll.js).
//
// THE ONE PAYROLL. These pin the parts of the unifying layer that decide money
// or decide words, and that can be decided without a database:
//
//   • kindOf / label            — what a period IS and what it is called
//   • the four states           — the owner's vocabulary, verbatim
//   • the normalised line       — ONE shape for both teams, every figure flat
//   • the one-off fold          — and the debits==credits identity of BOTH
//                                 engines surviving it
//   • the totals                — held people out of the money, counted in
//   • the transitions           — including that pay refuses unless checked
//
// WHY THE IDENTITY TESTS MATTER MOST. A one-off amount is folded into a line
// that js/departments.js and js/payroll-weekly.js then post to the ledger from,
// field by field. A fold that moves one field without its partner does not look
// wrong on screen — it silently unbalances the books, which is how this repo
// already lost a ₱2,000 cash credit and over-credited Cash by every employee
// deduction for months. The identities below are the proof, and they are
// checked against lines produced by the FROZEN money-core functions, never
// against hand-written numbers.
//
// If a test here fails after a deliberate change, an owner ruling has changed —
// say which, and why, in the commit. Do not adjust a number to make a test
// pass: these functions decide what a person is paid.
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

// money-core FIRST — it defines the frozen maths and the payWeek* date helpers
// that PayrollCore.label reads, exactly as index.html's load order does.
const money = require(path.join(ROOT, 'js/money-core.js'));
const PC = require(path.join(ROOT, 'js/payroll.js'));

const { computePayLine, computeWeeklyLine } = money;
const r2 = (n) => Math.round(((+n || 0) + Number.EPSILON) * 100) / 100;

// ── fixtures, built by the FROZEN engines, never by hand ──────────────────

/** One Office Team line, as computePayLine freezes it onto pay_runs. */
function officeLine(over) {
  const emp = Object.assign({
    id: 'u1', displayName: 'Marisol Cruz', payClass: 'regular',
    salary: 30000, allowance: 3000, deductions: 1500,
    sss: 675, philhealth: 450, pagibig: 100, tax: 250
  }, (over && over.emp) || {});
  const line = computePayLine(emp, Object.assign({
    month: '2026-08', policy: 'flat', caPlan: [{ caId: 'ca1', amount: 2000 }], caBalance: 8000
  }, (over && over.ctx) || {}));
  return line;
}

/** One Operations Team line, as WeeklyRun freezes it onto pay_weeks: the
 *  frozen computeWeeklyLine output plus the additive fields the run attaches.
 *  Statutory rides INSIDE `deductions`, which is what workerPayInputs does —
 *  reproduce it or the identity under test is not the one that ships. */
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
  line.workerId = 'w1';
  line.name = 'Ramon Dela Cruz';
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

// ── the two ledger identities, stated once ────────────────────────────────

/** js/departments.js disbursePayRun, per line:
 *    debit  effectiveGross
 *    credit statutory + actualCa + (netBeforeCA - actualCa) + withheldDeductions
 *  which reduces to: effectiveGross == statutoryTotal + netBeforeCA + withheld. */
function officeBalances(l) {
  const withheld = (l.withheldDeductions != null) ? l.withheldDeductions : l.otherDeductions;
  return r2(l.effectiveGross) === r2(l.statutoryTotal + l.netBeforeCA + withheld);
}

/** js/payroll-weekly.js disburse, in aggregate:
 *    Sum gross == Sum statutory + Sum otherDeductionsOnly + Sum ca + Sum net */
function opsBalances(l) {
  return r2(l.gross) === r2((l.statutory ? l.statutory.total : 0) + l.otherDeductionsOnly + l.caDeduction + l.net);
}

/** The card identity every normalised line must satisfy, both teams:
 *    gross - statutory - deductions - oneOffDeductions - cashAdvance == net
 *  and gross == earnings + allowances + oneOffEarnings. */
function cardBalances(row) {
  const a = r2(row.gross - row.statutory.total - row.deductions - row.oneOffDeductions - row.cashAdvance);
  const b = r2(row.earnings + row.allowances + row.oneOffEarnings);
  return a === r2(row.net) && b === r2(row.gross);
}

// ═══════════════════════════════════════════════════════════════════════════

describe('a period is a month or a week, and nothing else', () => {
  it('reads YYYY-MM as a month', () => {
    assert.equal(PC.kindOf('2026-08'), 'month');
    assert.equal(PC.kindOf('2026-01'), 'month');
    assert.equal(PC.kindOf('2026-12'), 'month');
  });

  it('reads YYYY-MM-DD as a week', () => {
    assert.equal(PC.kindOf('2026-08-10'), 'week');
  });

  it('REFUSES anything else rather than guessing', () => {
    // A pay period the system cannot name is a pay period it must not act on.
    ['', null, undefined, '2026', '2026-13', '2026-00', '26-08', '2026-8',
      '2026-08-32', '2026-08-00', 'August', '2026-08-10T00:00'].forEach((bad) => {
      assert.throws(() => PC.kindOf(bad), /is not a pay period/);
    });
  });

  it('orders months and weeks against each other on one comparable key', () => {
    assert.equal(PC.periodStart('2026-08'), '2026-08-01');
    assert.equal(PC.periodStart('2026-08-10'), '2026-08-10');
  });

  it('walks months back without ever building a Date (year boundary included)', () => {
    assert.equal(PC.prevMonth('2026-01'), '2025-12');
    assert.equal(PC.prevMonth('2026-08'), '2026-07');
    assert.deepEqual(PC.monthsBack('2026-02', 4), ['2026-02', '2026-01', '2025-12', '2025-11']);
  });
});

describe('label — what the period is called on screen', () => {
  it('names a month in full', () => {
    assert.equal(PC.label('2026-08'), 'August 2026');
    assert.equal(PC.label('2026-01'), 'January 2026');
  });

  it('names a week by its days, in the contract\'s form', () => {
    // 2026-08-10 is a Monday; the week runs to Sunday the 16th.
    assert.equal(PC.label('2026-08-10'), '10-16 Aug');
  });

  it('spells both ends out when a week crosses a month', () => {
    // 2026-07-27 (Mon) .. 2026-08-02 (Sun)
    assert.equal(PC.label('2026-07-27'), '27 Jul - 2 Aug');
  });

  it('adds the years when a week crosses a year', () => {
    // 2025-12-29 (Mon) .. 2026-01-04 (Sun)
    assert.equal(PC.label('2025-12-29'), '29 Dec 2025 - 4 Jan 2026');
  });
});

describe('the four states — the owner\'s vocabulary, verbatim', () => {
  it('shows exactly these words, and no others', () => {
    assert.equal(PC.STATE_LABEL.notstarted, 'Not started');
    assert.equal(PC.STATE_LABEL.prepared, 'Ready to check');
    assert.equal(PC.STATE_LABEL.checked, 'Checked - waiting for payment');
    assert.equal(PC.STATE_LABEL.paid, 'Paid');
    assert.deepEqual(PC.STATES, ['notstarted', 'prepared', 'checked', 'paid']);
  });

  it('translates every stored state, and treats an unknown one as not started', () => {
    assert.equal(PC.stateOf(undefined), 'notstarted');
    assert.equal(PC.stateOf('draft'), 'notstarted');
    assert.equal(PC.stateOf('computed'), 'prepared');
    assert.equal(PC.stateOf('verified'), 'checked');
    // Mid-release: the money is in flight, nothing is paid. Not a fifth word.
    assert.equal(PC.stateOf('disbursing'), 'checked');
    assert.equal(PC.stateOf('disbursed'), 'paid');
    assert.equal(PC.stateOf('nonsense'), 'notstarted');
  });

  it('never uses the words the owner cannot describe his own payday with', () => {
    const banned = /\b(compute|computed|verify|verified|disburse|disbursed|disbursement|delta|reconciliation)\b/i;
    Object.values(PC.STATE_LABEL).forEach((s) => assert.equal(banned.test(s), false, s));
    assert.equal(banned.test(PC.basisText(officeLine(), 'month')), false);
    assert.equal(banned.test(PC.basisText(opsLine(), 'week')), false);
    PC.normalizeLine(opsLine(), 'week').breakdown
      .forEach((b) => assert.equal(banned.test(b.label), false, b.label));
    PC.normalizeLine(officeLine(), 'month').breakdown
      .forEach((b) => assert.equal(banned.test(b.label), false, b.label));
  });
});

describe('the transitions — what each action is allowed to do', () => {
  it('PAY REFUSES UNLESS THE HOURS HAVE BEEN CHECKED', () => {
    // The one safeguard the brief keeps from the old three steps: a review
    // before money moves. It is the system's job, not a chore, but it does not
    // get skipped.
    assert.equal(PC.canPay('notstarted'), false);
    assert.equal(PC.canPay('prepared'), false);
    assert.equal(PC.canPay('checked'), true);
    assert.equal(PC.canPay('paid'), false);
  });

  it('the figures can only be worked out, or edited, before they are checked', () => {
    assert.deepEqual(PC.STATES.map(PC.canPrepare), [true, true, false, false]);
    assert.deepEqual(PC.STATES.map(PC.canEdit), [true, true, false, false]);
  });

  it('only a period whose figures exist can be checked', () => {
    assert.deepEqual(PC.STATES.map(PC.canCheck), [false, true, false, false]);
  });

  it('only a checked period reopens — a PAID one is corrected instead', () => {
    // Once money has moved, who was on that payroll is history, not a setting.
    assert.deepEqual(PC.STATES.map(PC.canReopen), [false, false, true, false]);
    assert.deepEqual(PC.STATES.map(PC.canCorrect), [false, false, false, true]);
  });
});

describe('ONE normalised line — the screen never asks which team someone is on', () => {
  const office = PC.normalizeLine(officeLine(), 'month');
  const ops = PC.normalizeLine(opsLine(), 'week');

  it('gives both teams identically-named fields', () => {
    const keys = (o) => Object.keys(o).sort();
    assert.deepEqual(keys(office), keys(ops));
  });

  it('carries every field the contract names', () => {
    ['personId', 'name', 'team', 'basis', 'earnings', 'allowances', 'oneOffs',
      'deductions', 'statutory', 'cashAdvance', 'net'].forEach((k) => {
      assert.ok(Object.prototype.hasOwnProperty.call(office, k), 'office is missing ' + k);
      assert.ok(Object.prototype.hasOwnProperty.call(ops, k), 'operations is missing ' + k);
    });
  });

  it('reads the right person id out of each team\'s own line shape', () => {
    assert.equal(office.personId, 'u1');
    assert.equal(ops.personId, 'w1');
    assert.equal(PC.personIdOf(officeLine(), 'month'), 'u1');
    assert.equal(PC.personIdOf(opsLine(), 'week'), 'w1');
  });

  it('names the team without the caller having to work it out', () => {
    assert.equal(office.team, 'Office Team');
    assert.equal(ops.team, 'Operations Team');
  });

  it('adds up, on both teams, to the same card identity', () => {
    assert.ok(cardBalances(office), JSON.stringify(office));
    assert.ok(cardBalances(ops), JSON.stringify(ops));
  });

  it('says where the number came from, in words a person can read', () => {
    assert.match(office.basis, /^Monthly salary ₱30,000\.00/);
    assert.match(ops.basis, /days worked/);
    assert.match(ops.basis, /hrs at ₱100\.00\/hr/);
    assert.match(ops.basis, /travel at half rate/);
  });

  it('puts EVERY figure in the breakdown — nothing behind a tap', () => {
    // The brief: on a pay roster a hidden deduction is the definition of data
    // hidden, so the card's data source has to arrive flat and complete.
    const labels = (row) => row.breakdown.map((b) => b.label);
    ['SSS', 'PhilHealth', 'Pag-IBIG', 'Withholding tax', 'Other deductions',
      'Cash advance', 'Take-home pay'].forEach((l) => {
      assert.ok(labels(office).includes(l), 'office card is missing ' + l);
      assert.ok(labels(ops).includes(l), 'operations card is missing ' + l);
    });
    assert.ok(labels(ops).includes('Overtime pay'));
    assert.ok(labels(ops).includes('Travel pay'));
    assert.ok(labels(office).includes('Salary'));
  });

  it('shows a ZERO deduction as a zero rather than dropping the row', () => {
    // A row that disappears when it is zero teaches people the row can vanish.
    const l = officeLine({ emp: { deductions: 0, sss: 0, philhealth: 0, pagibig: 0, tax: 0 } });
    const row = PC.normalizeLine(l, 'month');
    const other = row.breakdown.find((b) => b.label === 'Other deductions');
    assert.equal(other.amount, 0);
    assert.equal(row.breakdown.find((b) => b.label === 'SSS').amount, 0);
  });

  it('marks a held person, and says why, on the line itself', () => {
    const row = PC.normalizeLine(officeLine(), 'month', { heldReason: 'On unpaid leave' });
    assert.equal(row.held, true);
    assert.equal(row.heldReason, 'On unpaid leave');
  });

  it('flags a zero and a below-zero take-home rather than letting them pass', () => {
    // A silent zero inside a batch of thirty is invisible.
    const zero = PC.normalizeLine(officeLine({ emp: { salary: 0, allowance: 0, deductions: 0, sss: 0, philhealth: 0, pagibig: 0, tax: 0 }, ctx: { caPlan: [] } }), 'month');
    assert.equal(zero.zeroNet, true);
    const neg = PC.normalizeLine(officeLine({ emp: { salary: 1000, allowance: 0, deductions: 5000 }, ctx: { caPlan: [] } }), 'month');
    assert.equal(neg.negativeNet, true);
  });
});

describe('one-off amounts — the fold, and the money identities it must not break', () => {
  const bonus = { label: '13th month', amount: 2500, kind: 'earning' };
  const penalty = { label: 'Lost tool', amount: 600, kind: 'deduction' };

  it('a one-off EARNING on the office team is a real expense, and balances', () => {
    const base = officeLine();
    const out = PC.applyOneOffs(base, 'month', [bonus]);
    assert.equal(out.finalPay, r2(base.finalPay + 2500));
    assert.equal(out.netBeforeCA, r2(base.netBeforeCA + 2500));
    assert.equal(out.effectiveGross, r2(base.effectiveGross + 2500));
    assert.equal(out.gross, r2(base.gross + 2500));
    assert.ok(officeBalances(out), 'office ledger identity broken by an earning');
  });

  it('a one-off DEDUCTION on the office team never changes what the work cost', () => {
    // Withheld money is a liability, not a lower expense — the owner's 2026-08-07
    // ruling. So the expense debit must NOT move.
    const base = officeLine();
    const out = PC.applyOneOffs(base, 'month', [penalty]);
    assert.equal(out.effectiveGross, base.effectiveGross, 'expense moved on a withheld deduction');
    assert.equal(out.finalPay, r2(base.finalPay - 600));
    assert.equal(out.otherDeductions, r2(base.otherDeductions + 600));
    assert.equal(out.withheldDeductions, r2(base.withheldDeductions + 600));
    assert.ok(officeBalances(out), 'office ledger identity broken by a deduction');
  });

  it('a one-off EARNING on the operations team balances', () => {
    const base = opsLine();
    const out = PC.applyOneOffs(base, 'week', [bonus]);
    assert.equal(out.gross, r2(base.gross + 2500));
    assert.equal(out.net, r2(base.net + 2500));
    assert.ok(opsBalances(out), 'weekly ledger identity broken by an earning');
  });

  it('a one-off DEDUCTION on the operations team balances', () => {
    const base = opsLine();
    const out = PC.applyOneOffs(base, 'week', [penalty]);
    assert.equal(out.gross, base.gross, 'gross moved on a deduction');
    assert.equal(out.net, r2(base.net - 600));
    assert.equal(out.otherDeductionsOnly, r2(base.otherDeductionsOnly + 600));
    // The combined figure the frozen maths used moves in step, or the two
    // disagree about the same peso.
    assert.equal(out.otherDeductions, r2(base.otherDeductions + 600));
    assert.ok(opsBalances(out), 'weekly ledger identity broken by a deduction');
  });

  it('both together still balance, on both teams', () => {
    const o = PC.applyOneOffs(officeLine(), 'month', [bonus, penalty]);
    assert.ok(officeBalances(o));
    assert.equal(o.finalPay, r2(officeLine().finalPay + 2500 - 600));
    const w = PC.applyOneOffs(opsLine(), 'week', [bonus, penalty]);
    assert.ok(opsBalances(w));
    assert.equal(w.net, r2(opsLine().net + 2500 - 600));
  });

  it('IS IDEMPOTENT — folding an already-folded line changes nothing', () => {
    // This is what lets a one-off be added without reading the whole roster
    // again. If it drifted, every extra press would move the money.
    ['month', 'week'].forEach((kind) => {
      const base = kind === 'month' ? officeLine() : opsLine();
      const once = PC.applyOneOffs(base, kind, [bonus, penalty]);
      const twice = PC.applyOneOffs(once, kind, [bonus, penalty]);
      assert.deepEqual(twice, once, kind + ' fold is not idempotent');
    });
  });

  it('UNDOES EXACTLY — stripping a folded line gives the original figures back', () => {
    ['month', 'week'].forEach((kind) => {
      const base = kind === 'month' ? officeLine() : opsLine();
      const folded = PC.applyOneOffs(base, kind, [bonus, penalty]);
      const back = PC.stripOneOffs(folded, kind);
      const money = kind === 'month'
        ? ['finalPay', 'netBeforeCA', 'effectiveGross', 'gross', 'otherDeductions', 'withheldDeductions']
        : ['net', 'gross', 'otherDeductions', 'otherDeductionsOnly', 'deductionTotal'];
      money.forEach((k) => assert.equal(back[k], base[k], kind + ' ' + k + ' did not come back'));
    });
  });

  it('re-folding a DIFFERENT list replaces the old one instead of stacking it', () => {
    // How a mistyped one-off is taken back off.
    const base = opsLine();
    const wrong = PC.applyOneOffs(base, 'week', [{ label: 'Typo', amount: 9999, kind: 'deduction' }]);
    const fixed = PC.applyOneOffs(wrong, 'week', [penalty]);
    assert.equal(fixed.net, r2(base.net - 600));
    assert.equal(fixed.oneOffs.length, 1);
    assert.ok(opsBalances(fixed));
  });

  it('an empty list is a clean no-op', () => {
    const base = officeLine();
    const out = PC.applyOneOffs(base, 'month', []);
    assert.equal(out.finalPay, base.finalPay);
    assert.deepEqual(out.oneOffs, []);
    assert.equal(out.oneOffEarnings, 0);
    assert.equal(out.oneOffDeductions, 0);
  });

  it('drops an unnamed or zero one-off rather than moving a peso for it', () => {
    // It prints on the payslip as its own labelled line. An unnamed one is
    // unexplainable a year from now, and a zero one is noise.
    const base = officeLine();
    const out = PC.applyOneOffs(base, 'month', [
      { label: '', amount: 500, kind: 'earning' },
      { label: '  ', amount: 500, kind: 'deduction' },
      { label: 'Nothing', amount: 0, kind: 'earning' },
      { label: 'Negative', amount: -400, kind: 'deduction' }
    ]);
    assert.equal(out.finalPay, base.finalPay);
    assert.deepEqual(out.oneOffs, []);
  });

  it('treats anything that is not a deduction as an earning, never as nothing', () => {
    assert.equal(PC.normalizeOneOff({ label: 'x', amount: 1, kind: 'bonus' }).kind, 'earning');
    assert.equal(PC.normalizeOneOff({ label: 'x', amount: 1 }).kind, 'earning');
    assert.equal(PC.normalizeOneOff({ label: 'x', amount: 1, kind: 'deduction' }).kind, 'deduction');
  });

  it('NEVER CLAMPS a one-off deduction — it says the pay went below zero', () => {
    // Clamping would silently forgive a debt the person still owes, and nobody
    // would see it happen. prepare() warns on this and pay() refuses it.
    const base = opsLine();
    const out = PC.applyOneOffs(base, 'week', [{ label: 'Repair', amount: 999999, kind: 'deduction' }]);
    assert.ok(out.net < 0);
    assert.equal(out.negativeNet, true);
    assert.ok(opsBalances(out), 'a below-zero line must still balance');
  });

  it('shows each one-off as its own labelled row on the card', () => {
    const row = PC.normalizeLine(PC.applyOneOffs(officeLine(), 'month', [bonus, penalty]), 'month');
    const b = row.breakdown.find((x) => x.label === '13th month');
    const p = row.breakdown.find((x) => x.label === 'Lost tool');
    assert.equal(b.kind, 'earning');
    assert.equal(b.amount, 2500);
    assert.equal(p.kind, 'deduction');
    assert.equal(p.amount, 600);
    // …and is not double-counted inside "Other deductions".
    assert.equal(row.deductions, officeLine().otherDeductions);
    assert.ok(cardBalances(row));
  });

  it('keeps the card identity after a fold, on both teams', () => {
    assert.ok(cardBalances(PC.normalizeLine(PC.applyOneOffs(officeLine(), 'month', [bonus, penalty]), 'month')));
    assert.ok(cardBalances(PC.normalizeLine(PC.applyOneOffs(opsLine(), 'week', [bonus, penalty]), 'week')));
  });
});

describe('a backfilled period never re-collects a cash advance', () => {
  it('takes the instalment off an operations line and gives the pay back', () => {
    const base = opsLine();
    const out = PC.clearCashAdvance(base, 'week');
    assert.equal(out.caDeduction, 0);
    assert.equal(out.net, r2(base.net + base.caDeduction));
    assert.equal(out.caBalanceAfter, base.caBalanceBefore);
    assert.ok(opsBalances(out), 'suppressing the advance must still balance');
  });

  it('empties the plan on an office line so nothing is deducted twice', () => {
    const base = officeLine();
    const out = PC.clearCashAdvance(base, 'month');
    assert.deepEqual(out.caPlan, []);
    assert.equal(out.caPlanned, 0);
    assert.equal(out.finalPay, r2(base.finalPay + base.caPlanned));
    assert.ok(officeBalances(out));
  });
});

describe('totals — the header and the rows can never disagree', () => {
  const lines = [
    PC.normalizeLine(officeLine(), 'month'),
    PC.normalizeLine(officeLine({ emp: { id: 'u2', displayName: 'Ben Uy', salary: 20000 } }), 'month')
  ];

  it('sums the normalised lines, not the raw ones', () => {
    const t = PC.totalsOf(lines);
    assert.equal(t.people, 2);
    assert.equal(t.net, r2(lines[0].net + lines[1].net));
    assert.equal(t.statutory, r2(lines[0].statutory.total + lines[1].statutory.total));
  });

  it('leaves a HELD person out of the money but counts them out loud', () => {
    // A total that quietly does not add up is worse than one that explains
    // itself.
    const held = PC.normalizeLine(officeLine({ emp: { id: 'u3', displayName: 'Ana Lim' } }), 'month', { heldReason: 'Left the company' });
    const t = PC.totalsOf(lines.concat([held]));
    assert.equal(t.people, 2);
    assert.equal(t.heldPeople, 1);
    assert.equal(t.net, r2(lines[0].net + lines[1].net));
  });

  it('adds a mixed roster of both teams into ONE set of totals', () => {
    const mixed = lines.concat([PC.normalizeLine(opsLine(), 'week')]);
    const t = PC.totalsOf(mixed);
    assert.equal(t.people, 3);
    assert.equal(t.net, r2(mixed.reduce((s, l) => s + l.net, 0)));
  });

  it('reports zero for an empty period instead of undefined', () => {
    const t = PC.totalsOf([]);
    assert.equal(t.people, 0);
    assert.equal(t.net, 0);
    assert.equal(t.gross, 0);
  });
});

describe('reading a take-home off a raw line, whichever engine froze it', () => {
  it('finds it in each team\'s own field name', () => {
    assert.equal(PC.netOf(officeLine(), 'month'), r2(officeLine().finalPay));
    assert.equal(PC.netOf(opsLine(), 'week'), r2(opsLine().net));
  });

  it('answers zero rather than NaN for a line that carries nothing', () => {
    assert.equal(PC.netOf({}, 'month'), 0);
    assert.equal(PC.netOf(null, 'week'), 0);
  });
});

describe('peso text — deterministic on every machine', () => {
  it('groups thousands and always shows two decimals', () => {
    assert.equal(PC.peso(0), '₱0.00');
    assert.equal(PC.peso(1500), '₱1,500.00');
    assert.equal(PC.peso(182400.5), '₱182,400.50');
    assert.equal(PC.peso(1234567.891), '₱1,234,567.89');
  });

  it('shows a below-zero figure as below zero, never as a smaller positive', () => {
    assert.equal(PC.peso(-500), '-₱500.00');
  });
});

/* ── CORRECTING SOMEONE AFTER THEY HAVE BEEN PAID ──────────────────────────
   The owner asked for "fix something after paying". The money rule is which
   figure a correction is measured AGAINST.

   THE BUG THESE PIN AGAINST, found in review before shipping: the first version
   measured against the run's FROZEN LINE. That line is immutable for ever, so it
   never reflects a correction already applied — re-running the same correction
   recomputed the SAME difference and posted it a second time, overstating the
   books. The only guard was a 60-second window, which catches an accidental
   double-press and nothing else: a genuine repeat an hour later, by a second
   person or by someone who thought it had not saved, posted the full difference
   again under a fresh ledger ref that idempotence could not catch. */
describe('correcting after payment — what a fix is measured against', () => {
  const { correctionBaseline, correctionPosts } = PC;

  it('measures the FIRST fix against the original payslip figure', () => {
    // No correction yet, so the frozen line is the right baseline.
    assert.deepEqual(correctionBaseline({}, 3200, 'week'), { wasNet: 3200, hasPrior: false });
  });

  it('measures a LATER fix against what they were actually last paid', () => {
    // Already corrected to 3500. Measuring against the frozen 3200 would
    // re-post the first correction's difference on top of itself.
    assert.deepEqual(
      correctionBaseline({ netPay: 3500, corrections: [{ seq: 1 }] }, 3200, 'week'),
      { wasNet: 3500, hasPrior: true });
  });

  it('POSTS NOTHING when the same correction is repeated', () => {
    // The exact double-post: same reason, same figure, an hour later.
    const b = correctionBaseline({ netPay: 3500, corrections: [{ seq: 1 }] }, 3200, 'week');
    assert.deepEqual(correctionPosts(3500, b.wasNet, b.hasPrior), { posts: false, difference: 0 });
  });

  it('still posts a genuine second correction', () => {
    const b = correctionBaseline({ netPay: 3500, corrections: [{ seq: 1 }] }, 3200, 'week');
    assert.deepEqual(correctionPosts(3800, b.wasNet, b.hasPrior), { posts: true, difference: 300 });
  });

  it('posts a reduction as a negative difference, not an absolute', () => {
    const b = correctionBaseline({ netPay: 3500, corrections: [{ seq: 1 }] }, 3200, 'week');
    assert.equal(correctionPosts(3100, b.wasNet, b.hasPrior).difference, -400);
  });

  it('reads the right field for each team — they store net differently', () => {
    // A week carries netPay/totalPay; a month carries finalPay. Reading the
    // wrong one silently falls back to the frozen line and re-posts.
    assert.equal(correctionBaseline({ netPay: 3500 }, 3200, 'week').wasNet, 3500);
    assert.equal(correctionBaseline({ finalPay: 9100 }, 8000, 'month').wasNet, 9100);
    assert.equal(correctionBaseline({ totalPay: 3400 }, 3200, 'week').wasNet, 3400);
  });

  it('falls back to the frozen line when the payslip has no figure at all', () => {
    for (const ps of [{}, { netPay: null }, { netPay: 'abc' }, { finalPay: undefined }]) {
      assert.equal(correctionBaseline(ps, 3200, 'week').wasNet, 3200,
        `payslip ${JSON.stringify(ps)} must fall back, not compute against NaN`);
    }
  });

  it('never returns NaN for a baseline or a difference', () => {
    const b = correctionBaseline({ netPay: NaN }, 3200, 'week');
    assert.ok(Number.isFinite(b.wasNet));
    assert.ok(Number.isFinite(correctionPosts(3300, b.wasNet, b.hasPrior).difference));
  });
});
