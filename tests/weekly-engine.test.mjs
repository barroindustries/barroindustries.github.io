// tests/weekly-engine.test.mjs — the WEEKLY RUN ENGINE's pure core
// (window.WeeklyRunCore, js/payroll-weekly.js).
//
// computeWeeklyLine (tests/weekly-pay.test.mjs) decides what one worker is
// PAID. tests/weekly-run.test.mjs decides who is paid at all. THIS suite pins
// everything the run does BETWEEN those two — the decisions that turn a
// database into the argument computeWeeklyLine receives, each of which is a
// place where a mistake is silent rather than loud:
//
//   dayHours              the LUNCH RULE. The stored attendance record's
//                         `hoursWorked` does not deduct the lunch hour and the
//                         payslip generator does. Reading the stored field
//                         would pay every phone-punching worker an extra hour
//                         a day, every day, against what payslips pay today.
//   splitDayHours         overtime is paid ON TOP of the full day's hours in
//                         the current one-worker form. Changing that quietly
//                         would cut every long day's pay.
//   buildWeekDays         a flagged day (forgotten clock-out, 22-hour phantom
//                         shift) must pay NOTHING until a human records an
//                         override with a reason.
//   mergeAdjustment       rent allowance / other deductions / the cash-advance
//                         instalment exist NOWHERE else. A merge that drops one
//                         zeroes it for that worker with nothing on screen to
//                         show where it went.
//   isLastPayWeekOfMonth  statutory is a MONTHLY obligation collected on one
//                         week of the month. Deciding it from the week's END
//                         instead of its Monday mis-bracketed 8 of the 12
//                         months of 2026.
//   ledgerRef/payslipId   a non-deterministic ref means a second press at
//                         Disburse books the same money twice.
//
// If a test here fails after a deliberate change, say which decision changed
// and why, in the commit. Do not adjust a number to make a test pass: this
// engine pays real people every week.
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

// money-core FIRST — payroll-weekly.js builds on payWeekDays/payWeekMonth/
// resolveWorkerHourlyRate/computeWeeklyLine, exactly as index.html's load order
// guarantees in the browser. Both files share the same globalThis.window shim.
const MC = require(path.join(ROOT, 'js/money-core.js'));
const WRC = require(path.join(ROOT, 'js/payroll-weekly.js'));

const AUG = '2026-08-10';                       // a Monday. 10–16 Aug 2026.
const DAYS = MC.payWeekDays(AUG);
const rec = (timeIn, timeOut, extra) => Object.assign({ timeIn, timeOut }, extra || {});

describe('the lunch rule — hours come from the PUNCH TIMES, never a stored field', () => {
  it('deducts one hour when the shift spans 12:00–13:00', () => {
    // 07:00–16:00 is nine clock hours and EIGHT paid ones. This single hour is
    // the whole reason the run recomputes instead of trusting the record.
    assert.equal(WRC.dayHours('07:00', '16:00'), 8);
  });

  it('does NOT deduct when the shift ends before lunch or starts after it', () => {
    assert.equal(WRC.dayHours('07:00', '12:00'), 5);
    assert.equal(WRC.dayHours('13:00', '18:00'), 5);
  });

  it('deducts for a shift that only touches the lunch window', () => {
    assert.equal(WRC.dayHours('12:30', '13:30'), 0);   // one hour worked, one deducted
    assert.equal(WRC.dayHours('11:00', '12:30'), 0.5);
  });

  it('handles an overnight shift without going negative', () => {
    assert.equal(WRC.dayHours('22:00', '06:00'), 8);   // crosses midnight, misses lunch
  });

  it('pays nothing for a half-recorded punch', () => {
    for (const [a, b] of [['07:00', ''], ['', '16:00'], ['', ''], [null, null], [undefined, '16:00']]) {
      assert.equal(WRC.dayHours(a, b), 0, `${a}/${b} must be zero, not NaN`);
    }
  });

  it('DISAGREES with a naive clock-difference by exactly the lunch hour', () => {
    // This is the divergence that would overpay every self-service punch: the
    // Cloud Function writes hoursWorked as the raw difference.
    const raw = (9 * 60) / 60;
    assert.equal(raw - WRC.dayHours('07:00', '16:00'), 1);
  });
});

describe('the regular/overtime split — PARITY with what payslips pay today', () => {
  it('leaves a normal day entirely regular', () => {
    assert.deepEqual(WRC.splitDayHours(8), { hours: 8, otHours: 0 });
    assert.deepEqual(WRC.splitDayHours(4.5), { hours: 4.5, otHours: 0 });
  });

  it('reports the FULL day as hours AND the excess again as overtime', () => {
    // PINNED DELIBERATELY. computeWeeklyLine pays hours*rate + otHours*rate, so
    // a 10-hour day pays TWELVE hours — which is exactly what the one-worker
    // generator does today (Hours Worked = the day total, OT Hours = the excess
    // over 8). Emitting {hours:8, otHours:2} would be defensible arithmetic and
    // a silent pay cut. If the owner rules otherwise, change it HERE and say so.
    assert.deepEqual(WRC.splitDayHours(10), { hours: 10, otHours: 2 });
    const line = MC.computeWeeklyLine({ hourlyRate: 100 }, [{ hours: 10, otHours: 2 }]);
    assert.equal(line.gross, 1200);
  });

  it('clamps rubbish to zero rather than producing NaN', () => {
    for (const bad of [-5, 'abc', null, undefined, NaN]) {
      const s = WRC.splitDayHours(bad);
      assert.ok(Number.isFinite(s.hours) && Number.isFinite(s.otHours), `${bad} produced ${JSON.stringify(s)}`);
      assert.equal(s.hours, 0);
    }
  });
});

describe('a day that needs review pays NOTHING until a human says otherwise', () => {
  it('flags a record the worker app marked needsReview', () => {
    assert.equal(WRC.dayIsFlagged(rec('07:00', '16:00', { needsReview: true })), true);
  });

  it('flags an implausible shift from an unclosed punch', () => {
    assert.equal(WRC.dayIsFlagged(rec('07:00', '16:00', { hoursWorked: 22 })), true);
    assert.equal(WRC.dayIsFlagged(rec('01:00', '23:00')), true);       // 21h computed
  });

  it('does not flag an ordinary day', () => {
    assert.equal(WRC.dayIsFlagged(rec('07:00', '16:00', { hoursWorked: 9 })), false);
    assert.equal(WRC.dayIsFlagged(null), false);
  });
});

describe('buildWeekDays — the argument computeWeeklyLine actually receives', () => {
  it('always produces exactly seven days, in Monday-first date order', () => {
    const { days } = WRC.buildWeekDays(DAYS, {}, null);
    assert.equal(days.length, 7);
    assert.deepEqual(days.map(d => d.date), DAYS);
    assert.equal(days[0].date, '2026-08-10');
    assert.equal(days[6].date, '2026-08-16');
  });

  it('reads hours from the punches, applying the lunch rule', () => {
    const records = { [DAYS[0]]: rec('07:00', '16:00'), [DAYS[1]]: rec('07:00', '18:00') };
    const { days, flags } = WRC.buildWeekDays(DAYS, records, null);
    assert.equal(days[0].hours, 8);
    assert.equal(days[0].otHours, 0);
    assert.equal(days[1].hours, 10);      // 07:00–18:00 = 11h minus lunch
    assert.equal(days[1].otHours, 2);
    assert.equal(flags[0].source, 'punch');
    assert.equal(flags[2].source, 'none');
  });

  it('IGNORES the stored hoursWorked field entirely for pay', () => {
    // The record claims nine hours (no lunch deducted). The run pays eight.
    const records = { [DAYS[0]]: rec('07:00', '16:00', { hoursWorked: 9 }) };
    const { days } = WRC.buildWeekDays(DAYS, records, null);
    assert.equal(days[0].hours, 8);
  });

  it('pays a flagged day NOTHING and says so', () => {
    const records = { [DAYS[0]]: rec('07:00', '16:00', { needsReview: true }) };
    const { days, flags } = WRC.buildWeekDays(DAYS, records, null);
    assert.equal(days[0].hours, 0);
    assert.equal(days[0].otHours, 0);
    assert.equal(flags[0].flagged, true);
    assert.equal(flags[0].source, 'flagged');
    assert.equal(flags[0].punchedHours, 8);   // kept, so the screen can offer it
    assert.equal(MC.computeWeeklyLine({ hourlyRate: 100 }, days).gross, 0);
  });

  it('lets a RECORDED override replace a flagged day and pay it', () => {
    const records = { [DAYS[0]]: rec('07:00', '16:00', { needsReview: true }) };
    const adj = { overrides: { [DAYS[0]]: { hours: 8, otHours: 0, reason: 'kiosk outage — confirmed with the foreman', by: 'u-admin', at: '2026-08-11T09:00:00Z' } } };
    const { days, flags } = WRC.buildWeekDays(DAYS, records, adj);
    assert.equal(days[0].hours, 8);
    assert.equal(days[0].override.reason, 'kiosk outage — confirmed with the foreman');
    assert.equal(flags[0].source, 'override');
    const line = MC.computeWeeklyLine({ hourlyRate: 100 }, days);
    assert.equal(line.gross, 800);
    assert.equal(line.daysOverridden, 1);
  });

  it('REFUSES a reason-less override — money never moves without a record', () => {
    // computeWeeklyLine only enforces half of owner ruling 2: it drops the
    // unrecorded override off the row but STILL PAYS the hours it was handed
    // (its `worked` test is just hours>0). Hand it {hours:8, reason:''} and it
    // pays a day with a blank audit trail. The refusal therefore has to happen
    // where the argument is built. This test is the proof it does.
    const adj = { overrides: { [DAYS[0]]: { hours: 8, reason: '' } } };
    const { days, flags } = WRC.buildWeekDays(DAYS, {}, adj);
    assert.equal(flags[0].overrideMissingReason, true);
    assert.equal(days[0].hours, 0);
    assert.equal(days[0].override, undefined);
    const line = MC.computeWeeklyLine({ hourlyRate: 100 }, days);
    assert.equal(line.gross, 0);
    assert.equal(line.daysOverridden, 0);
    // And the frozen function, called with the raw override, does pay it —
    // which is exactly why the guard above cannot be removed.
    const unguarded = MC.computeWeeklyLine({ hourlyRate: 100 }, [{ hours: 8, override: { reason: '' } }]);
    assert.equal(unguarded.gross, 800);
    assert.equal(unguarded.daysOverridden, 0);
  });

  it('falls back to the PUNCH when an override has no reason, rather than destroying the day', () => {
    // The punch is itself a record. Refusing an unaudited edit must not also
    // wipe the audited fact underneath it.
    const records = { [DAYS[0]]: rec('07:00', '16:00') };
    const adj = { overrides: { [DAYS[0]]: { hours: 4, reason: '' } } };
    const { days, flags } = WRC.buildWeekDays(DAYS, records, adj);
    assert.equal(days[0].hours, 8);
    assert.equal(flags[0].overrideMissingReason, true);
    assert.deepEqual(flags[0].ignoredOverride, { hours: 4, otHours: 0 });
  });

  it('an override REPLACES the punch, it does not add to it', () => {
    const records = { [DAYS[0]]: rec('07:00', '16:00') };            // 8h punched
    const adj = { overrides: { [DAYS[0]]: { hours: 4, otHours: 0, reason: 'left at midday' } } };
    const { days } = WRC.buildWeekDays(DAYS, records, adj);
    assert.equal(days[0].hours, 4);
  });

  it('parks the week\'s travel hours on a WORKED day, so no absent day turns into a paid one', () => {
    const records = { [DAYS[2]]: rec('07:00', '16:00') };
    const { days } = WRC.buildWeekDays(DAYS, records, { travelHours: 6 });
    assert.equal(days[2].travelHours, 6);
    assert.equal(days.reduce((s, d) => s + d.travelHours, 0), 6);
    const line = MC.computeWeeklyLine({ hourlyRate: 100 }, days);
    assert.equal(line.travelPay, 300);       // 6 x half of 100 — owner ruling 3
    assert.equal(line.daysWorked, 1);        // NOT two
    assert.equal(line.daysAbsent, 6);
  });

  it('still pays a travel-only week', () => {
    const { days } = WRC.buildWeekDays(DAYS, {}, { travelHours: 4 });
    const line = MC.computeWeeklyLine({ hourlyRate: 100 }, days);
    assert.equal(line.travelPay, 200);
    assert.equal(line.daysWorked, 1);
  });

  it('survives missing dates, missing records and a missing adjustment', () => {
    for (const args of [[DAYS, null, null], [[], {}, {}], [null, null, null]]) {
      const { days, flags } = WRC.buildWeekDays(args[0], args[1], args[2]);
      assert.equal(days.length, 7);
      assert.equal(flags.length, 7);
      assert.ok(days.every(d => Number.isFinite(d.hours)));
    }
  });
});

describe('the food allowance rule — per-day rate x days over four hours', () => {
  const profile = { foodAllowance: 120 };
  it('counts only the days that exceeded four hours', () => {
    const days = [{ hours: 8 }, { hours: 8 }, { hours: 4 }, { hours: 3 }, {}, {}, {}];
    assert.equal(WRC.foodAllowanceFor(profile, days), 240);
  });
  it('counts a day whose overtime pushes it past four hours', () => {
    assert.equal(WRC.foodAllowanceFor(profile, [{ hours: 2, otHours: 3 }]), 120);
  });
  it('is zero when the profile carries no food allowance', () => {
    assert.equal(WRC.foodAllowanceFor({}, [{ hours: 8 }]), 0);
    assert.equal(WRC.foodAllowanceFor(null, [{ hours: 8 }]), 0);
  });
});

describe('mergeAdjustment — the three figures that exist nowhere else', () => {
  const base = { rentAllowance: 500, otherDeductions: 300, caDeduction: 200, travelHours: 4, overrides: {} };

  it('a patch of ONE field leaves the other three standing', () => {
    // The whole point. A merge that replaced the entry would silently zero the
    // rent allowance, the deductions and the instalment for that worker.
    const out = WRC.mergeAdjustment(base, { rentAllowance: 750 });
    assert.equal(out.rentAllowance, 750);
    assert.equal(out.otherDeductions, 300);
    assert.equal(out.caDeduction, 200);
    assert.equal(out.travelHours, 4);
  });

  it('an explicit zero IS a value and does clear that field', () => {
    assert.equal(WRC.mergeAdjustment(base, { caDeduction: 0 }).caDeduction, 0);
  });

  it('starts every field at zero from an empty entry', () => {
    assert.deepEqual(WRC.mergeAdjustment(null, null), WRC.EMPTY_ADJUSTMENT);
  });

  it('never lets a negative or a non-number through', () => {
    const out = WRC.mergeAdjustment(base, { rentAllowance: -900, otherDeductions: 'abc', travelHours: NaN });
    assert.equal(out.rentAllowance, 0);
    assert.equal(out.otherDeductions, 0);
    assert.equal(out.travelHours, 0);
  });

  it('merges overrides per day and keeps the ones it was not told about', () => {
    const prev = { overrides: { '2026-08-10': { hours: 8, otHours: 0, reason: 'a', by: 'u1', at: 't1' } } };
    const out = WRC.mergeAdjustment(prev, { overrides: { '2026-08-11': { hours: 4, reason: 'b' } } });
    assert.equal(Object.keys(out.overrides).length, 2);
    assert.equal(out.overrides['2026-08-10'].reason, 'a');
    assert.equal(out.overrides['2026-08-11'].hours, 4);
  });

  it('an explicit null clears ONE day\'s override', () => {
    const prev = { overrides: { '2026-08-10': { hours: 8, reason: 'a' }, '2026-08-11': { hours: 8, reason: 'b' } } };
    const out = WRC.mergeAdjustment(prev, { overrides: { '2026-08-10': null } });
    assert.equal(out.overrides['2026-08-10'], undefined);
    assert.equal(out.overrides['2026-08-11'].reason, 'b');
  });

  it('keeps who/when when a later patch only changes the hours', () => {
    const prev = { overrides: { '2026-08-10': { hours: 8, reason: 'a', by: 'u1', at: 't1' } } };
    const out = WRC.mergeAdjustment(prev, { overrides: { '2026-08-10': { hours: 6, reason: 'a' } } });
    assert.equal(out.overrides['2026-08-10'].by, 'u1');
    assert.equal(out.overrides['2026-08-10'].at, 't1');
  });
});

describe('which week collects the monthly statutory deduction', () => {
  it('says YES only for the week whose NEXT Monday lands in a different month', () => {
    // August 2026 has five Mondays: 3, 10, 17, 24, 31.
    assert.equal(WRC.isLastPayWeekOfMonth('2026-08-03'), false);
    assert.equal(WRC.isLastPayWeekOfMonth('2026-08-24'), false);
    assert.equal(WRC.isLastPayWeekOfMonth('2026-08-31'), true);
  });

  it('a week that STARTS in August belongs to August even though it ends in September', () => {
    // Deciding from the END would call this a September week and August would
    // never collect at all. The Monday decides, on both sides.
    assert.equal(MC.payWeekMonth('2026-08-31'), '2026-08');
    assert.equal(MC.payWeekDays('2026-08-31')[6], '2026-09-06');
    assert.equal(WRC.isLastPayWeekOfMonth('2026-08-31'), true);
  });

  it('gives every month of 2026 exactly one collecting week', () => {
    // The property that matters: a worker is deducted once a month, never twice
    // and never zero times.
    const byMonth = {};
    let m = '2025-12-29';
    for (let i = 0; i < 60; i++) {
      const month = MC.payWeekMonth(m);
      if (month.startsWith('2026')) byMonth[month] = (byMonth[month] || 0) + (WRC.isLastPayWeekOfMonth(m) ? 1 : 0);
      m = WRC.nextMonday(m);
    }
    assert.equal(Object.keys(byMonth).length, 12);
    Object.keys(byMonth).forEach(k => assert.equal(byMonth[k], 1, `${k} collects ${byMonth[k]} times`));
  });

  it('handles the year boundary without losing a week', () => {
    assert.equal(WRC.isLastPayWeekOfMonth('2026-12-28'), true);
    assert.equal(WRC.nextMonday('2026-12-28'), '2027-01-04');
    assert.equal(WRC.prevMonday('2026-01-05'), '2025-12-29');
  });

  it('steps Mondays by exactly seven days across a month end', () => {
    assert.equal(WRC.nextMonday('2026-08-31'), '2026-09-07');
    assert.equal(WRC.prevMonday('2026-09-07'), '2026-08-31');
  });
});

describe('the statutory rule, ported from the one-worker generator', () => {
  const table = { ee: { sss: 500, philhealth: 250, pagibig: 100, tax: 0 }, er: { sss: 1000, philhealth: 250, pagibig: 100 } };

  it('an UNCONFIGURED worker is deducted nothing, ever — the zeros are correct', () => {
    // Production staff are not regularised. This is the path every worker on
    // record today takes, and it must touch nothing.
    for (const p of [{}, { statConfig: null }, { statConfig: {} }, { statConfig: { sss: 'nonsense' } }]) {
      const r = WRC.resolveStatutoryWeekly(p, { isLastPayWeek: true, table });
      assert.equal(r.total, 0);
      assert.equal(r.configured, false);
      assert.equal(r.er, null);
    }
  });

  it('deducts nothing on a week that is not the month\'s last, even when configured', () => {
    const r = WRC.resolveStatutoryWeekly({ statConfig: { sss: 'auto' } }, { isLastPayWeek: false, table });
    assert.equal(r.total, 0);
    assert.equal(r.configured, true);   // so the run can SAY why it is zero
    assert.equal(r.applied, false);
  });

  it('auto takes the table amount for the month\'s gross', () => {
    const r = WRC.resolveStatutoryWeekly({ statConfig: { sss: 'auto', philhealth: 'auto' } }, { isLastPayWeek: true, table });
    assert.equal(r.sss, 500);
    assert.equal(r.philhealth, 250);
    assert.equal(r.pagibig, 0);         // no mode set for this key
    assert.equal(r.total, 750);
  });

  it('fixed takes the flat amount typed on the profile', () => {
    const r = WRC.resolveStatutoryWeekly({ statConfig: { sss: 'fixed' }, sss: 400 }, { isLastPayWeek: true, table });
    assert.equal(r.sss, 400);
  });

  it('exempt is a real zero, employee AND employer', () => {
    const r = WRC.resolveStatutoryWeekly({ statConfig: { sss: 'exempt', philhealth: 'auto' } }, { isLastPayWeek: true, table });
    assert.equal(r.sss, 0);
    assert.equal(r.er.sss, 0);
    assert.equal(r.er.philhealth, 250);
  });

  it('keeps the EMPLOYER share table-computed for fixed too — it is never hand-typed', () => {
    // A `fixed` worker whose ER read 0 printed a positive assertion that nothing
    // was owed on the document used to remit — worth ~₱600/month/worker.
    const r = WRC.resolveStatutoryWeekly({ statConfig: { sss: 'fixed' }, sss: 400 }, { isLastPayWeek: true, table });
    assert.equal(r.er.sss, 1000);
  });

  it('never carries an employer share for tax', () => {
    const r = WRC.resolveStatutoryWeekly({ statConfig: { tax: 'auto' } }, { isLastPayWeek: true, table });
    assert.equal(r.er.tax, undefined);
  });

  it('degrades to zero rather than NaN when the table is missing', () => {
    const r = WRC.resolveStatutoryWeekly({ statConfig: { sss: 'auto' } }, { isLastPayWeek: true, table: null });
    assert.equal(r.sss, 0);
    assert.equal(r.total, 0);
  });
});

describe('workerPayInputs — every hand-typed figure folded in BEFORE the frozen line', () => {
  const profile = { hourlyRate: 100, foodAllowance: 120, allowances: { meal: 999, transport: 250 } };
  const days = [{ hours: 8 }, { hours: 8 }, { hours: 8 }, { hours: 8 }, { hours: 8 }, {}, {}];
  const adj = { rentAllowance: 500, otherDeductions: 300, caDeduction: 200, travelHours: 0, overrides: {} };

  it('carries the rent allowance, which is stored nowhere else', () => {
    const w = WRC.workerPayInputs(profile, adj, days, null);
    assert.equal(w.allowances.rent, 500);
  });

  it('computes the meal allowance from the days worked, not the profile field', () => {
    // profile.allowances.meal is a stale leftover on the doc; the generator
    // overwrites it with foodAllowance x days-over-4 and so does this.
    const w = WRC.workerPayInputs(profile, adj, days, null);
    assert.equal(w.allowances.meal, 600);      // 120 x 5 days
    assert.equal(w.allowances.transport, 250);
  });

  it('resolves a daily-rate-only worker instead of emitting a zero line', () => {
    const w = WRC.workerPayInputs({ dailyRate: 600 }, adj, days, null);
    assert.equal(w.hourlyRate, 75);
  });

  it('folds statutory into deductions so the CASH ADVANCE is collected LAST', () => {
    // Order matters: statutory is a legal obligation, the advance is not. The
    // clamp is against gross-minus-deductions, so anything folded in here is
    // collected ahead of the instalment.
    const w = WRC.workerPayInputs(profile, adj, days, { total: 850 });
    assert.equal(w.deductions, 1150);          // 300 hand-typed + 850 statutory
  });

  it('produces a line that reconciles end to end', () => {
    const w = WRC.workerPayInputs(profile, adj, days, { total: 850 });
    const line = MC.computeWeeklyLine(w, days);
    // 40h x 100 + (600 meal + 250 transport + 500 rent) = 5350 gross
    assert.equal(line.gross, 5350);
    assert.equal(line.deductionTotal, 1350);   // 1150 + 200 instalment
    assert.equal(line.net, 4000);
    assert.equal(line.net, Math.round((line.gross - line.deductionTotal) * 100) / 100);
  });

  it('never lets the cash advance push a week negative, even with statutory on top', () => {
    const thin = [{ hours: 2 }, {}, {}, {}, {}, {}, {}];
    const w = WRC.workerPayInputs({ hourlyRate: 100 }, { caDeduction: 5000, otherDeductions: 0 }, thin, { total: 150 });
    const line = MC.computeWeeklyLine(w, thin);
    assert.equal(line.gross, 200);
    assert.equal(line.caDeduction, 50);        // clamped to what is left after statutory
    assert.equal(line.net, 0);
    assert.equal(line.caShortfall, 4950);      // reported, never swallowed
  });
});

describe('deterministic identifiers — a second press must be a no-op', () => {
  it('gives every ledger leg a ref derived only from the week (and the worker)', () => {
    assert.equal(WRC.ledgerRef('expense', AUG, 'w1'), 'PAYW-2026-08-10-w1');
    assert.equal(WRC.ledgerRef('net', AUG), 'NETPAYW-2026-08-10');
    assert.equal(WRC.ledgerRef('cashAdvance', AUG), 'CADEDUCTW-2026-08-10');
    assert.equal(WRC.ledgerRef('deductions', AUG), 'EMPDEDW-2026-08-10');
  });

  it('is stable across calls — the same inputs give the same ref', () => {
    assert.equal(WRC.ledgerRef('expense', AUG, 'w1'), WRC.ledgerRef('expense', AUG, 'w1'));
    assert.equal(WRC.payslipId(AUG, 'w1'), WRC.payslipId(AUG, 'w1'));
  });

  it('never collides between two weeks, two workers, or the monthly run', () => {
    const refs = new Set();
    ['2026-08-03', '2026-08-10'].forEach(w => ['w1', 'w2'].forEach(u => {
      refs.add(WRC.ledgerRef('expense', w, u));
      refs.add(WRC.payslipId(w, u));
    }));
    assert.equal(refs.size, 8);
    // The monthly run's refs are PAY-{YYYY-MM}-{uid}; the W suffix keeps the two
    // families legible to a human reading the ledger.
    assert.ok(WRC.ledgerRef('expense', AUG, 'w1').startsWith('PAYW-'));
  });

  it('gives one payslip per worker per week', () => {
    assert.equal(WRC.payslipId(AUG, 'w1'), 'WK-2026-08-10-w1');
  });
});

describe('weekLabel — the week a human reads', () => {
  it('collapses a week inside one month', () => {
    assert.equal(WRC.weekLabel('2026-08-10'), '10–16 Aug 2026');
  });
  it('spells both months when the week crosses one', () => {
    assert.equal(WRC.weekLabel('2026-08-31'), '31 Aug – 6 Sep 2026');
  });
  it('spells both years when the week crosses one', () => {
    assert.equal(WRC.weekLabel('2025-12-29'), '29 Dec 2025 – 4 Jan 2026');
  });
  it('degrades to the raw id rather than throwing on rubbish', () => {
    assert.equal(WRC.weekLabel('not-a-date'), 'not-a-date');
  });
});
