// tests/taskbased-pay.test.mjs — TASK-BASED-PAY-SPEC-2026-08-12, §13 (T1–T12)
//
// Pins the ONE additive branch in js/money-core.js's computePayLine (the
// 'taskbased' policy: netBeforeCA = _round2((gross - statutoryTotal -
// otherDeductions) * perfFactor), the payClass:'production' guard throw, and
// the conditional preMultiplierNet return key) plus the new js/pay-policy.js
// helpers (wageFloorCheck, payBasisSentence). These tests PIN CURRENT
// BEHAVIOR — they document what the math does, they do not redefine it.
//
// Same harness as tests/money.test.mjs: zero deps (node:test + node:assert
// only), globalThis.window = globalThis, window.bizYear stubbed to 2026
// BEFORE requiring js/statutory-tables.js/js/money-core.js/js/pay-policy.js
// (config.js — the Manila-time helpers' real home — is deliberately NOT
// loaded here, same reasoning tests/money.test.mjs's header gives). Every
// expected value below was float-verified against the real table code on
// 2026-08-12 (see this repo's TASK-BASED-PAY-SPEC-2026-08-12.md §13).
//
// Run with: node --test tests/*.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

globalThis.window = globalThis;
window.bizYear = () => 2026;

const statutory = require('../js/statutory-tables.js');
const money = require('../js/money-core.js');
const payPolicy = require('../js/pay-policy.js');
const { computePayLine, computeWeeklyLine } = money;
const { wageFloorCheck, payBasisSentence, PAY_POLICY_VALUES } = payPolicy;

let _origWarn;
before(() => { _origWarn = console.warn; console.warn = () => {}; });
after(() => { console.warn = _origWarn; });

// The Jia Lopez fixture — the owner's own real-numbers worked example (§4.1).
const JIA = { id: 'jia', displayName: 'Jia Lopez', salary: 14500, allowance: 0, deductions: 0 };

describe('computePayLine — taskbased policy (TASK-BASED-PAY-SPEC-2026-08-12)', () => {
  it('T1 — Jia Lopez, full-line pin', () => {
    const line = computePayLine(JIA, { policy: 'taskbased', kpiScore: 0.6, attScore: 0.1 });
    assert.deepEqual(line, {
      uid: 'jia', name: 'Jia Lopez', payClass: 'regular',
      base: 14500, allowance: 0, otherDeductions: 0, unearnedDeductions: 0, withheldDeductions: 0,
      sss: 725, philhealth: 362.5, pagibig: 200, tax: 0,
      er: { sss: 1450, philhealth: 362.5, pagibig: 200 },
      kpiScore: 0.6, attScore: 0.1,
      perfFactor: 0.6 * 0.7 + 0.1 * 0.3, // 0.44999999999999996 — NOT 0.45, §2.5. Do not "fix".
      policy: 'taskbased',
      caBalance: 0, caPlanned: 0, caPlan: [],
      gross: 14500, effectiveGross: 7233.12, statutoryTotal: 1287.5,
      netBeforeCA: 5945.62, finalPay: 5945.62, // NOT 5945.63 — see §2.5's float note.
      preMultiplierNet: 13212.5,
    });
  });

  it('T2 — full performer identity: equals the flat control exactly', () => {
    const taskbased = computePayLine(JIA, { policy: 'taskbased', kpiScore: 1, attScore: 1 });
    const flat = computePayLine(JIA, { policy: 'flat', kpiScore: 1, attScore: 1 });
    assert.equal(taskbased.netBeforeCA, 13212.5);
    assert.equal(taskbased.finalPay, 13212.5);
    assert.equal(taskbased.preMultiplierNet, 13212.5);
    assert.equal(taskbased.netBeforeCA, flat.netBeforeCA);
    assert.equal(taskbased.finalPay, flat.finalPay);
  });

  it('T3 — zero factor: government amounts never scale', () => {
    const line = computePayLine(JIA, { policy: 'taskbased', kpiScore: 0, attScore: 0 });
    assert.equal(line.perfFactor, 0);
    assert.equal(line.netBeforeCA, 0);
    assert.equal(line.finalPay, 0);
    assert.equal(line.effectiveGross, 1287.5);
    assert.equal(line.sss, 725);
    assert.equal(line.philhealth, 362.5);
    assert.equal(line.pagibig, 200);
  });

  it('T4 — rich line: allowance, other deductions (withheld/unearned split), and a CA plan', () => {
    const line = computePayLine(
      { id: 'u9', displayName: 'Rico', salary: 20000, allowance: 2000, deductions: 500, deductionsUnearned: 200 },
      { policy: 'taskbased', kpiScore: 0.8, attScore: 0.9, caPlan: [{ amount: 1000 }], caBalance: 3000 }
    );
    assert.equal(line.perfFactor, 0.8 * 0.7 + 0.9 * 0.3); // 0.83, exact float
    assert.equal(line.statutoryTotal, 1850); // 1100 + 550 + 200 + 0
    assert.equal(line.preMultiplierNet, 19650);
    assert.equal(line.netBeforeCA, 16309.5);
    assert.equal(line.finalPay, 15309.5);
    assert.equal(line.effectiveGross, 18459.5);
    assert.equal(line.withheldDeductions, 300);
    assert.equal(line.unearnedDeductions, 200);
  });

  it('T5 — negative remainder edge: no zero-floor of its own (the §8 gate is the guard)', () => {
    const line = computePayLine({ salary: 0, allowance: 0 }, { policy: 'taskbased', kpiScore: 0.6, attScore: 0.1 });
    assert.equal(line.statutoryTotal, 500);
    assert.equal(line.preMultiplierNet, -500);
    assert.equal(line.netBeforeCA, -225);
    assert.equal(line.effectiveGross, 275);
  });

  it("T6 — 'flat' control byte-identical to the existing pin, no preMultiplierNet key", () => {
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
    assert.ok(!('preMultiplierNet' in line));
  });

  it("T7 — 'performance' control byte-identical to the existing pin, no preMultiplierNet key", () => {
    const line = computePayLine(
      { id: 'u2', displayName: 'Maria', salary: 30000, allowance: 5000, deductions: 0 },
      { policy: 'performance', kpiScore: 0.8, attScore: 0.9, caPlan: [{ amount: 1000 }, { amount: 500 }], caBalance: 2500 }
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
    assert.ok(!('preMultiplierNet' in line));
  });

  it("T8 — misspelt policy ('task-based', hyphen) falls flat — pins WHY the whitelist lives at the settings read (§6.1)", () => {
    // computePayLine's legacy unknown-policy fallthrough is PINNED, not fixed
    // here: the strictness belongs at the settings-doc boundary (§6.1's
    // PAY_POLICY_VALUES whitelist, enforced by buildPayRunLines/the Personal
    // Finance renderer), never inside this frozen function. A caller that
    // passes an unknown string directly still gets 'flat' math, echoed under
    // whatever string it was given.
    const line = computePayLine(JIA, { policy: 'task-based' });
    assert.equal(line.netBeforeCA, 13212.5);
    assert.equal(line.policy, 'task-based');
    assert.ok(!('preMultiplierNet' in line));
  });

  it('T9 — the Office/Operations team guard throws for a production payClass, but only under taskbased', () => {
    const productionEmp = { ...JIA, payClass: 'production' };
    assert.throws(
      () => computePayLine(productionEmp, { policy: 'taskbased' }),
      /Office Team only/
    );
    assert.doesNotThrow(() => computePayLine(productionEmp, { policy: 'flat' }));
    const flatLine = computePayLine(productionEmp, { policy: 'flat' });
    assert.equal(flatLine.payClass, 'production');
  });

  it('T10 — weekly lines carry no performance vocabulary at all (the structural boundary, pinned)', () => {
    const line = computeWeeklyLine(
      { hourlyRate: 62.5, allowances: { meal: 300 } },
      [{ hours: 8 }, { hours: 8 }, { hours: 8 }, { hours: 8 }, { hours: 8 }, { hours: 4 }, {}]
    );
    assert.equal(line.gross, 3050);
    assert.equal(line.net, 3050);
    assert.equal(line.regHours, 44);
    assert.equal(line.daysWorked, 6);
    assert.equal(line.daysAbsent, 1);
    assert.ok(!('perfFactor' in line));
    assert.ok(!('kpiScore' in line));
    assert.ok(!('policy' in line));
    assert.ok(!('preMultiplierNet' in line));
  });
});

describe('window.wageFloorCheck — js/pay-policy.js §8.3', () => {
  it('T11 — inert when the floor is absent or non-positive; checked+ok/short otherwise', () => {
    assert.deepEqual(wageFloorCheck({ effectiveGross: 7233.12 }, undefined), { checked: false, ok: true, earned: 7233.12, short: 0 });
    assert.deepEqual(wageFloorCheck({ effectiveGross: 7233.12 }, 0), { checked: false, ok: true, earned: 7233.12, short: 0 });
    assert.deepEqual(wageFloorCheck({ effectiveGross: 7233.12 }, 10000), { checked: true, ok: false, earned: 7233.12, short: 2766.88 });
    assert.deepEqual(wageFloorCheck({ effectiveGross: 13212.5 }, 10000), { checked: true, ok: true, earned: 13212.5, short: 0 });
  });
});

describe('window.payBasisSentence — js/pay-policy.js §9.1', () => {
  it('T12 — the T1 line, verbatim; empty for flat; the fallback when preMultiplierNet is absent', () => {
    const t1Line = computePayLine(JIA, { policy: 'taskbased', kpiScore: 0.6, attScore: 0.1 });
    assert.equal(
      payBasisSentence(t1Line),
      'Pay this month is the usual take-home ₱13,212.50 × 45% = ₱5,945.62. The 45% comes from task results (60%) counted at 70% and on-time morning check-ins (10%) counted at 30%. Check-ins count as on time when every notification is read before 9:00 AM.'
    );
    const flatLine = computePayLine(JIA, { policy: 'flat', kpiScore: 0.6, attScore: 0.1 });
    assert.equal(payBasisSentence(flatLine), '');
    const noPreMultiplier = { ...t1Line };
    delete noPreMultiplier.preMultiplierNet;
    assert.equal(
      payBasisSentence(noPreMultiplier),
      'Pay this month was multiplied by 45% — task results (60%) counted at 70% and on-time morning check-ins (10%) counted at 30%.'
    );
  });
});

describe('window.PAY_POLICY_VALUES — the §6.1 whitelist', () => {
  it('is exactly the three known policy strings', () => {
    // 'performance' joined the list 2026-08-14 for the base-and-incentive
    // split — it is the only branch that scales an incentive while leaving
    // the base wage whole. Pinned so a fourth value cannot appear without
    // someone deciding to add it here.
    assert.deepEqual(PAY_POLICY_VALUES, ['flat', 'taskbased', 'performance']);
  });

  it("'performance' scales ONLY the incentive — the base wage is never docked", () => {
    // The whole reason the split exists. Same package (10,000 + 4,500) under
    // both policies: 'flat' pays it whole, 'performance' pays the base whole
    // and scales only the 4,500. If this ever starts docking `base`, the
    // structure the owner was advised to adopt has quietly become the one he
    // was advised against.
    const split = { ...JIA, salary: 10000, allowance: 4500 };
    const ctx = { month: '2026-07', kpiScore: 0.36, attScore: 3 / 27, caPlan: [], caBalance: 0 };
    const flat = computePayLine(split, { ...ctx, policy: 'flat' });
    const perf = computePayLine(split, { ...ctx, policy: 'performance' });
    const factor = perf.perfFactor;
    // flat pays base + allowance in full, less statutory
    assert.equal(flat.netBeforeCA, 10000 + 4500 - flat.statutoryTotal);
    // performance pays base in full, less statutory, plus the SCALED incentive
    assert.equal(perf.netBeforeCA, 10000 - perf.statutoryTotal + 4500 * factor);
    // and the base itself is untouched either way
    assert.equal(flat.base, 10000);
    assert.equal(perf.base, 10000);
  });
});
