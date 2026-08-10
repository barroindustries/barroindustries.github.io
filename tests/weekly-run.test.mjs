// tests/weekly-run.test.mjs — the WEEKLY (Operations Team) run's guards.
//
// computeWeeklyLine (tests/weekly-pay.test.mjs) decides what one worker is
// PAID. These three decide who is paid at all, at what rate, and for which
// seven days — and each one is a place where a mistake is silent rather than
// loud:
//
//   resolveWorkerHourlyRate  a worker with only a daily rate on file computes
//                            to ₱0.00, because the roster column shows the
//                            DAILY rate while the engine reads the HOURLY one.
//                            The screen looks right and the run pays nothing.
//   weeklyRunSkipReason      the double-pay guard from the WEEKLY side. The
//                            monthly guard's job is to keep production staff
//                            OUT, so it cannot be reused here — it would skip
//                            exactly the people this run exists to pay.
//   payWeekMondayOf          a week boundary that moves by one day pays the
//                            wrong seven days. Building a Date from a bare
//                            'YYYY-MM-DD' parses as UTC midnight, which is the
//                            PREVIOUS day for a negative offset.
//
// Run with: node --test tests/*.test.mjs
// Zero deps: node:test + node:assert only.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  resolveWorkerHourlyRate, weeklyRunSkipReason,
  payWeekMondayOf, payWeekDays, payWeekMonth
} = require(path.join(ROOT, 'js/money-core.js'));

const worker = (over) => Object.assign({ id: 'w1', hourlyRate: 75, status: 'active' }, over || {});

describe('rate resolution — the silent ₱0.00 line', () => {
  it('uses the hourly rate when one is set', () => {
    const r = resolveWorkerHourlyRate({ hourlyRate: 75 });
    assert.equal(r.rate, 75);
    assert.equal(r.ok, true);
    assert.equal(r.source, 'hourlyRate');
  });

  it('derives the hourly rate from a daily rate over an 8-hour day', () => {
    // This is the case that produced ₱0.00 lines: the profile screen shows the
    // daily rate, so the worker looks correctly set up.
    const r = resolveWorkerHourlyRate({ dailyRate: 600 });
    assert.equal(r.rate, 75);
    assert.equal(r.ok, true);
    assert.equal(r.source, 'dailyRate/8');
  });

  it('prefers an explicit hourly rate over a daily one', () => {
    assert.equal(resolveWorkerHourlyRate({ hourlyRate: 90, dailyRate: 600 }).rate, 90);
  });

  it('rounds a derived rate to centavos', () => {
    assert.equal(resolveWorkerHourlyRate({ dailyRate: 555 }).rate, 69.38);
  });

  it('REFUSES rather than returning zero when no rate is on file', () => {
    // Returning 0 here would emit a ₱0.00 line into a batch of thirty, where it
    // is invisible. The run must stop on this worker and say so.
    for (const w of [{}, { hourlyRate: 0 }, { dailyRate: 0 }, { hourlyRate: null },
                     { hourlyRate: 'abc' }, { hourlyRate: -50 }, { dailyRate: -600 }]) {
      const r = resolveWorkerHourlyRate(w);
      assert.equal(r.ok, false, `${JSON.stringify(w)} must refuse`);
      assert.equal(r.rate, 0);
      assert.ok(r.why.length > 10, 'a refusal must explain itself');
    }
  });

  it('survives a missing worker entirely', () => {
    assert.equal(resolveWorkerHourlyRate(null).ok, false);
    assert.equal(resolveWorkerHourlyRate(undefined).ok, false);
  });
});

describe('weekly run — who gets paid', () => {
  it('pays an active worker with a rate', () => {
    assert.equal(weeklyRunSkipReason(worker(), {}), null);
  });

  it('pays a worker whose rate comes from a daily figure', () => {
    assert.equal(weeklyRunSkipReason(worker({ hourlyRate: 0, dailyRate: 600 }), {}), null);
  });

  it('skips an inactive or removed worker', () => {
    assert.equal(weeklyRunSkipReason(worker({ status: 'inactive' }), {}), 'removed');
    assert.equal(weeklyRunSkipReason(worker({ removed: true }), {}), 'removed');
  });

  it('skips a worker with no rate rather than paying them nothing', () => {
    assert.equal(weeklyRunSkipReason(worker({ hourlyRate: 0 }), {}), 'no-rate');
  });

  it('skips a missing worker', () => {
    assert.equal(weeklyRunSkipReason(null, {}), 'missing');
  });
});

describe('weekly run — the double-pay guard, from the weekly side', () => {
  const linked = () => worker({ linkedUid: 'u1' });

  it('skips a worker whose linked account was already paid monthly', () => {
    assert.equal(weeklyRunSkipReason(linked(), {}, { monthlyPaidUids: new Set(['u1']) }),
      'paid-monthly');
  });

  it('accepts a plain object for monthlyPaidUids as well as a Set', () => {
    // Both call shapes exist in this codebase; a guard understanding only one
    // returns null for the other, which is a double payment.
    assert.equal(weeklyRunSkipReason(linked(), {}, { monthlyPaidUids: { u1: true } }),
      'paid-monthly');
  });

  it('pays a worker whose linked account was NOT on the monthly run', () => {
    assert.equal(weeklyRunSkipReason(linked(), {}, { monthlyPaidUids: new Set(['someone-else']) }), null);
  });

  it('pays a worker with no linked account at all — the majority today', () => {
    assert.equal(weeklyRunSkipReason(worker(), {}, { monthlyPaidUids: new Set(['u1']) }), null);
  });

  it('does not fall over when no monthlyPaidUids is supplied', () => {
    assert.equal(weeklyRunSkipReason(linked(), {}), null);
    assert.equal(weeklyRunSkipReason(linked(), {}, {}), null);
  });

  it('removed wins over paid-monthly, so the message names the real cause', () => {
    assert.equal(
      weeklyRunSkipReason(worker({ status: 'inactive', linkedUid: 'u1' }), {},
        { monthlyPaidUids: new Set(['u1']) }),
      'removed');
  });
});

describe('weekly run — exclusion is per WEEK (owner ruling 2026-08-10)', () => {
  it('skips a worker this week excludes', () => {
    assert.equal(weeklyRunSkipReason(worker(), { w1: true }), 'excluded');
  });

  it('carries the reason through', () => {
    assert.equal(weeklyRunSkipReason(worker(), { w1: 'no work assigned' }),
      'excluded: no work assigned');
  });

  it('PAYS them the following week — the whole point of the ruling', () => {
    assert.equal(weeklyRunSkipReason(worker(), { w1: 'typhoon' }), 'excluded: typhoon');
    assert.equal(weeklyRunSkipReason(worker(), {}), null);
  });

  it('ignores a falsy entry, so a stale put-back cannot skip anyone', () => {
    for (const v of [false, '', 0, null, undefined]) {
      assert.equal(weeklyRunSkipReason(worker(), { w1: v }), null);
    }
  });

  it('only excludes the id it names', () => {
    assert.equal(weeklyRunSkipReason(worker({ id: 'w2' }), { w1: true }), null);
  });

  it('a permanent reason still wins over a weekly exclusion', () => {
    assert.equal(weeklyRunSkipReason(worker({ status: 'inactive' }), { w1: true }), 'removed');
    assert.equal(weeklyRunSkipReason(worker({ hourlyRate: 0 }), { w1: true }), 'no-rate');
  });
});

describe('the pay week — Monday to Sunday, Manila', () => {
  it('resolves any day of the week to its Monday', () => {
    // 2026-08-10 is a Monday.
    for (const d of ['2026-08-10', '2026-08-11', '2026-08-13', '2026-08-16']) {
      assert.equal(payWeekMondayOf(d), '2026-08-10', `${d} belongs to w/c 2026-08-10`);
    }
  });

  it('a Monday resolves to itself', () => {
    assert.equal(payWeekMondayOf('2026-08-10'), '2026-08-10');
  });

  it('a Sunday belongs to the week that STARTED, not the one about to', () => {
    // The commonest off-by-one: Sunday is the LAST day of its week here, and
    // paying it into the following week would move a day's pay between periods.
    assert.equal(payWeekMondayOf('2026-08-16'), '2026-08-10');
    assert.equal(payWeekMondayOf('2026-08-17'), '2026-08-17');
  });

  it('crosses a year boundary without inventing a week', () => {
    // 2027-01-01 is a Friday. Its week began 2026-12-28 — so the week, and the
    // pay for it, belong to DECEMBER. An ISO week NUMBER would have called this
    // week 53 or week 1 depending on the rule and collided with another year.
    assert.equal(payWeekMondayOf('2027-01-01'), '2026-12-28');
    assert.equal(payWeekMonth(payWeekMondayOf('2027-01-01')), '2026-12');
  });

  it('bills a week to the month its MONDAY falls in, never its end', () => {
    // w/c 2026-08-31 runs into September. Deriving the month from the END
    // mis-bracketed 8 of 12 months in this repo once.
    assert.equal(payWeekMonth(payWeekMondayOf('2026-09-02')), '2026-08');
  });

  it('returns seven consecutive days, Monday first', () => {
    const days = payWeekDays('2026-08-10');
    assert.equal(days.length, 7);
    assert.equal(days[0], '2026-08-10');
    assert.equal(days[6], '2026-08-16');
    assert.deepEqual(days, ['2026-08-10','2026-08-11','2026-08-12',
                            '2026-08-13','2026-08-14','2026-08-15','2026-08-16']);
  });

  it('spans a month end correctly', () => {
    assert.deepEqual(payWeekDays('2026-08-31'),
      ['2026-08-31','2026-09-01','2026-09-02','2026-09-03','2026-09-04','2026-09-05','2026-09-06']);
  });

  it('accepts a full timestamp, not just a date', () => {
    assert.equal(payWeekMondayOf('2026-08-15T23:59:00+08:00'), '2026-08-10');
  });

  it('never throws on rubbish input', () => {
    assert.equal(payWeekMondayOf('not-a-date'), '');
    assert.equal(payWeekMondayOf(''), '');
  });
});
