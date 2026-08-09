// tests/weekly-pay.test.mjs — window.computeWeeklyLine (js/money-core.js).
//
// The Operations Team's weekly pay. These PIN the four owner rulings of
// 2026-08-08 (TYPE-B-WEEKLY-PAYROLL-SPEC.md §1-§4):
//
//   1. The pay week is MONDAY–SUNDAY, seven days.
//   2. No clock-in = ABSENT (zero pay), with an admin override that is
//      RECORDED — who, when, and a reason — never silent.
//   3. Overtime at the PLAIN hourly rate; TRAVEL at HALF the hourly rate.
//   4. One disburse for the whole week (the run's shape, not this function's).
//
// If a test here fails after a deliberate change, the owner ruling it encodes
// has changed — say which, and why, in the commit. Do not adjust a number to
// make a test pass: this function decides what a person is paid.
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
const { computeWeeklyLine, WEEK_DAYS, TRAVEL_RATE_FACTOR } = require(path.join(ROOT, 'js/money-core.js'));

// A plain 8-hour day, repeated. Helpers keep each test about ONE variable.
const day = (h, extra) => Object.assign({ hours: h }, extra || {});
const week = (...days) => days;
const fullWeek = (h) => Array.from({ length: 7 }, () => day(h));
const worker = (over) => Object.assign({ hourlyRate: 100 }, over || {});

describe('ruling 1 — the pay week is Monday to Sunday', () => {
  it('names seven days, Monday first', () => {
    assert.deepEqual(WEEK_DAYS, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('always returns exactly seven rows, even from a short input', () => {
    assert.equal(computeWeeklyLine(worker(), week(day(8))).rows.length, 7);
    assert.equal(computeWeeklyLine(worker(), []).rows.length, 7);
    assert.equal(computeWeeklyLine(worker(), null).rows.length, 7);
  });

  it('PAYS Sunday — the ruling that resolved the Mon–Sat / Mon–Sun split', () => {
    // Before this, the generator laid out Mon–Sat while the worker's own phone
    // showed Mon–Sun, so a Sunday shift could appear in the worker's estimate
    // and fall outside the period actually paid.
    const sundayOnly = computeWeeklyLine(worker(), week({}, {}, {}, {}, {}, {}, day(8)));
    assert.equal(sundayOnly.rows[6].day, 'Sun');
    assert.equal(sundayOnly.rows[6].absent, false);
    assert.equal(sundayOnly.gross, 800);
  });

  it('pays Sunday at the SAME rate as any other day (a period ruling, not a premium)', () => {
    const mon = computeWeeklyLine(worker(), week(day(8)));
    const sun = computeWeeklyLine(worker(), week({}, {}, {}, {}, {}, {}, day(8)));
    assert.equal(mon.gross, sun.gross);
  });

  it('pays a full seven-day week', () => {
    const r = computeWeeklyLine(worker(), fullWeek(8));
    assert.equal(r.regHours, 56);
    assert.equal(r.gross, 5600);
    assert.equal(r.daysWorked, 7);
  });
});

describe('ruling 2 — no clock-in is ABSENT, unpaid', () => {
  it('pays nothing for a day with no punch', () => {
    const r = computeWeeklyLine(worker(), week(day(8), {}, day(8), {}, day(8), {}, {}));
    assert.equal(r.regHours, 24);
    assert.equal(r.gross, 2400);
    assert.equal(r.daysWorked, 3);
    assert.equal(r.daysAbsent, 4);
  });

  it('marks the absent rows so the payslip can show WHICH days were unpaid', () => {
    const r = computeWeeklyLine(worker(), week(day(8), {}, day(8)));
    assert.deepEqual(r.rows.map(x => x.absent), [false, true, false, true, true, true, true]);
  });

  it('pays an empty week nothing at all', () => {
    const r = computeWeeklyLine(worker(), []);
    assert.equal(r.gross, 0);
    assert.equal(r.net, 0);
    assert.equal(r.daysAbsent, 7);
  });
});

describe('ruling 2 — the admin override must be RECORDED, never silent', () => {
  const OVR = { by: 'u-admin', at: '2026-08-10T09:00:00+08:00', reason: 'kiosk outage — verified with the site foreman' };

  it('pays an overridden day and carries who/when/why onto the row', () => {
    const r = computeWeeklyLine(worker(), week(day(8, { override: OVR })));
    assert.equal(r.gross, 800);
    assert.equal(r.rows[0].override.by, 'u-admin');
    assert.equal(r.rows[0].override.at, OVR.at);
    assert.equal(r.rows[0].override.reason, OVR.reason);
    assert.equal(r.daysOverridden, 1);
  });

  it('counts overrides separately so the run can surface them for review', () => {
    const r = computeWeeklyLine(worker(), week(day(8, { override: OVR }), day(8), day(8, { override: OVR })));
    assert.equal(r.daysOverridden, 2);
    assert.equal(r.daysWorked, 3);
  });

  it('REFUSES a reason-less override — an unauditable one is treated as absent', () => {
    // The whole point of the ruling is that money never moves without a record.
    for (const bad of [{ by: 'u1' }, { by: 'u1', reason: '' }, {}, true]) {
      const r = computeWeeklyLine(worker(), week(day(8, { override: bad })));
      assert.equal(r.rows[0].override, null, `override ${JSON.stringify(bad)} must not be recorded`);
      assert.equal(r.daysOverridden, 0);
    }
  });

  it('never applies an override on its own — hours still have to be entered', () => {
    const r = computeWeeklyLine(worker(), week({ override: OVR }));
    assert.equal(r.gross, 0);
    assert.equal(r.rows[0].absent, true);
  });
});

describe('ruling 3 — overtime at the plain rate, travel at half', () => {
  it('pays overtime at the plain hourly rate, not a multiple', () => {
    const r = computeWeeklyLine(worker(), week(day(8, { otHours: 2 })));
    assert.equal(r.otPay, 200);          // 2 x 100, NOT 2 x 125 or 2 x 130
    assert.equal(r.gross, 1000);
  });

  it('pays travel at exactly half the hourly rate', () => {
    assert.equal(TRAVEL_RATE_FACTOR, 0.5);
    const r = computeWeeklyLine(worker(), week({ travelHours: 4 }));
    assert.equal(r.travelRate, 50);
    assert.equal(r.travelPay, 200);      // 4 x 50
    assert.equal(r.gross, 200);
  });

  it('keeps regular, overtime and travel separate so the worker can check each', () => {
    const r = computeWeeklyLine(worker(), week(day(8, { otHours: 2, travelHours: 4 })));
    assert.equal(r.regularPay, 800);
    assert.equal(r.otPay, 200);
    assert.equal(r.travelPay, 200);
    assert.equal(r.gross, 1200);
  });

  it('counts a travel-only day as WORKED, not absent', () => {
    const r = computeWeeklyLine(worker(), week({ travelHours: 6 }));
    assert.equal(r.daysWorked, 1);
    assert.equal(r.rows[0].absent, false);
  });

  it('rounds the travel rate to centavos on an odd hourly rate', () => {
    const r = computeWeeklyLine({ hourlyRate: 93.75 }, week({ travelHours: 1 }));
    assert.equal(r.travelRate, 46.88);
  });
});

describe('allowances, deductions and the cash-advance clamp', () => {
  it('adds the three allowances to gross but never to the hourly maths', () => {
    const r = computeWeeklyLine(worker({ allowances: { meal: 350, transport: 200, rent: 150 } }), week(day(8)));
    assert.equal(r.allowanceTotal, 700);
    assert.equal(r.regularPay, 800);
    assert.equal(r.gross, 1500);
  });

  it('subtracts other deductions from gross', () => {
    const r = computeWeeklyLine(worker({ deductions: 300 }), week(day(8)));
    assert.equal(r.deductionTotal, 300);
    assert.equal(r.net, 500);
  });

  it('CLAMPS the cash advance so a week can never pay a negative net', () => {
    // A weekly run applies this to everyone at once, so an unclamped CA would
    // turn into a negative net for a whole crew in a single click.
    const r = computeWeeklyLine(worker({ caDeduction: 5000 }), week(day(8)));
    assert.equal(r.caDeduction, 800);
    assert.equal(r.net, 0);
    assert.equal(r.caShortfall, 4200);   // reported, not silently swallowed
  });

  it('clamps the cash advance against what is left AFTER other deductions', () => {
    const r = computeWeeklyLine(worker({ deductions: 300, caDeduction: 5000 }), week(day(8)));
    assert.equal(r.caDeduction, 500);
    assert.equal(r.deductionTotal, 800);
    assert.equal(r.net, 0);
  });

  it('collects the full cash advance when the pay covers it', () => {
    const r = computeWeeklyLine(worker({ caDeduction: 200 }), fullWeek(8));
    assert.equal(r.caDeduction, 200);
    assert.equal(r.caShortfall, 0);
    assert.equal(r.net, 5400);
  });
});

describe('bad data cannot quietly move money', () => {
  it('clamps negative hours to zero instead of reducing the week', () => {
    // A negative day is not a correction, it is bad data — and it would reduce
    // the week's pay with nothing on the payslip showing where it went.
    const r = computeWeeklyLine(worker(), week(day(8), day(-8), { otHours: -4 }, { travelHours: -2 }));
    assert.equal(r.regHours, 8);
    assert.equal(r.otHours, 0);
    assert.equal(r.travelHours, 0);
    assert.equal(r.gross, 800);
  });

  it('treats a missing or negative rate as zero rather than NaN', () => {
    for (const w of [{}, { hourlyRate: null }, { hourlyRate: 'abc' }, { hourlyRate: -50 }]) {
      const r = computeWeeklyLine(w, fullWeek(8));
      assert.equal(r.gross, 0, `rate ${JSON.stringify(w)} must not produce ${r.gross}`);
      assert.ok(Number.isFinite(r.net));
    }
  });

  it('ignores negative allowances and deductions', () => {
    const r = computeWeeklyLine(worker({ allowances: { meal: -500 }, deductions: -300 }), week(day(8)));
    assert.equal(r.allowanceTotal, 0);
    assert.equal(r.deductionTotal, 0);
    assert.equal(r.net, 800);
  });

  it('survives a missing worker object entirely', () => {
    const r = computeWeeklyLine(null, fullWeek(8));
    assert.equal(r.gross, 0);
    assert.equal(r.net, 0);
  });

  it('never returns a NaN or a non-finite figure', () => {
    const r = computeWeeklyLine(
      worker({ allowances: { meal: 'x' }, deductions: undefined, caDeduction: NaN }),
      week(day('7.5'), day(8, { otHours: '1.25', travelHours: '2' }))
    );
    for (const k of ['gross', 'net', 'regularPay', 'otPay', 'travelPay', 'deductionTotal']) {
      assert.ok(Number.isFinite(r[k]), `${k} was ${r[k]}`);
    }
  });
});

describe('the week reconciles — every figure adds up', () => {
  it('gross equals its four components, and net equals gross minus deductions', () => {
    const w = worker({ allowances: { meal: 350, transport: 200, rent: 150 }, deductions: 275, caDeduction: 500 });
    const r = computeWeeklyLine(w, week(
      { hours: 8 }, { hours: 8, otHours: 2 }, {}, { hours: 8, travelHours: 4 },
      { hours: 8 }, { hours: 4, otHours: 1 }, { hours: 6 }
    ));
    assert.equal(r.gross, Math.round((r.regularPay + r.otPay + r.travelPay + r.allowanceTotal) * 100) / 100);
    assert.equal(r.net, Math.round((r.gross - r.deductionTotal) * 100) / 100);
    assert.equal(r.deductionTotal, Math.round((r.otherDeductions + r.caDeduction) * 100) / 100);
    // and the per-day pay column sums to the hourly part of gross
    const rowSum = r.rows.reduce((s, x) => s + x.pay, 0);
    assert.equal(Math.round(rowSum * 100) / 100, Math.round((r.regularPay + r.otPay + r.travelPay) * 100) / 100);
  });

  it('every day count adds to seven', () => {
    const r = computeWeeklyLine(worker(), week(day(8), {}, day(8), {}, day(8)));
    assert.equal(r.daysWorked + r.daysAbsent, 7);
  });
});
