// tests/basekpi-pay.test.mjs — OFFICE-KPI-PAY-SPEC-2026-08-25, §4 (T1–T6, T8)
//
// Pins the FOURTH additive branch in js/money-core.js's computePayLine (the
// 'basekpi' policy: netBeforeCA = _round2(base - statutoryTotal -
// otherDeductions + allowance*kpiFactor), the extended production guard
// that now also covers 'basekpi', and the conditional kpiFactor/
// incentiveFull/incentiveEarned return keys) plus the matching js/pay-policy.js
// additions (PAY_POLICY_VALUES, payBasisSentence, payDerivationSteps). These
// tests PIN CURRENT BEHAVIOR — they document what the math does, they do not
// redefine it.
//
// Per T7 EOM standings (computeEomStandings) is owned by another agent and
// is deliberately NOT covered here.
//
// Same harness as tests/money.test.mjs / tests/taskbased-pay.test.mjs: zero
// deps (node:test + node:assert only), globalThis.window = globalThis,
// window.bizYear stubbed to 2026 BEFORE requiring js/statutory-tables.js/
// js/money-core.js/js/pay-policy.js (config.js — the Manila-time helpers'
// real home — is deliberately NOT loaded here, same reasoning those files'
// headers give). Every expected value below was float-verified against the
// real (2026 placeholder) table code on 2026-08-25.
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
const { computePayLine } = money;
const { PAY_POLICY_VALUES, payBasisSentence, payDerivationSteps } = payPolicy;

let _origWarn;
before(() => { _origWarn = console.warn; console.warn = () => {}; });
after(() => { console.warn = _origWarn; });

// The T8 fixture — an 18,000 package (base 10,000 protected + 8,000
// incentive), the concrete numbers OFFICE-KPI-PAY-SPEC-2026-08-25 §4 T8
// names. Reused across T1/T2/T4/T8 so the pins compose.
const OFC = { id: 'ofc1', displayName: 'Office Employee', salary: 10000, allowance: 8000, deductions: 0 };

describe("computePayLine — 'basekpi' policy (OFFICE-KPI-PAY-SPEC-2026-08-25 §1.1)", () => {
  it('T1 — the formula at KPI 0 / 0.5 / 0.85 / 1.0: base always whole, statutory never scaled, incentive rounds per _round2', () => {
    const k0   = computePayLine(OFC, { policy: 'basekpi', kpiScore: 0 });
    const k50  = computePayLine(OFC, { policy: 'basekpi', kpiScore: 0.5 });
    const k85  = computePayLine(OFC, { policy: 'basekpi', kpiScore: 0.85 });
    const k100 = computePayLine(OFC, { policy: 'basekpi', kpiScore: 1.0 });

    // base is the protected figure — never scaled, whole at every KPI level.
    for (const line of [k0, k50, k85, k100]) assert.equal(line.base, 10000);

    // gross (18,000) is fixed regardless of KPI, so statutory brackets off
    // the SAME nominal gross every time — never itself scaled by kpiFactor.
    for (const line of [k0, k50, k85, k100]) {
      assert.equal(line.gross, 18000);
      assert.equal(line.statutoryTotal, 1550); // 900 sss + 450 philhealth + 200 pagibig + 0 tax
      assert.equal(line.sss, 900);
      assert.equal(line.philhealth, 450);
      assert.equal(line.pagibig, 200);
    }

    // incentiveEarned = _round2(allowance * kpiFactor) — the same rounding
    // helper this file already uses everywhere else.
    assert.equal(k0.kpiFactor, 0);     assert.equal(k0.incentiveEarned, 0);
    assert.equal(k50.kpiFactor, 0.5);  assert.equal(k50.incentiveEarned, 4000);
    assert.equal(k85.kpiFactor, 0.85); assert.equal(k85.incentiveEarned, 6800);
    assert.equal(k100.kpiFactor, 1);   assert.equal(k100.incentiveEarned, 8000);

    // netBeforeCA = base - statutoryTotal - otherDeductions + incentiveEarned
    assert.equal(k0.netBeforeCA,   10000 - 1550 - 0 + 0);
    assert.equal(k50.netBeforeCA,  10000 - 1550 - 0 + 4000);
    assert.equal(k85.netBeforeCA,  10000 - 1550 - 0 + 6800);
    assert.equal(k100.netBeforeCA, 10000 - 1550 - 0 + 8000);
    for (const line of [k0, k50, k85, k100]) assert.equal(line.finalPay, line.netBeforeCA); // no CA plan
  });

  it("T2 — conditional keys (kpiFactor, incentiveFull, incentiveEarned) present ONLY under 'basekpi'", () => {
    const ctx = { kpiScore: 0.7, attScore: 1 };
    const flatLine = computePayLine(OFC, { ...ctx, policy: 'flat' });
    const perfLine = computePayLine(OFC, { ...ctx, policy: 'performance' });
    const taskLine = computePayLine(OFC, { ...ctx, policy: 'taskbased' });
    const baseLine = computePayLine(OFC, { ...ctx, policy: 'basekpi' });

    for (const line of [flatLine, perfLine, taskLine]) {
      assert.ok(!('kpiFactor' in line), line.policy + ' must not carry kpiFactor');
      assert.ok(!('incentiveFull' in line), line.policy + ' must not carry incentiveFull');
      assert.ok(!('incentiveEarned' in line), line.policy + ' must not carry incentiveEarned');
    }
    assert.ok('kpiFactor' in baseLine);
    assert.ok('incentiveFull' in baseLine);
    assert.ok('incentiveEarned' in baseLine);
    assert.equal(baseLine.kpiFactor, 0.7);
    assert.equal(baseLine.incentiveFull, 8000);
    assert.equal(baseLine.incentiveEarned, 5600);
  });

  it("T3 — the production guard throws for payClass:'production' under 'basekpi' (and under 'taskbased'), but not under 'flat'", () => {
    const productionEmp = { ...OFC, payClass: 'production' };
    assert.throws(
      () => computePayLine(productionEmp, { policy: 'basekpi' }),
      /Office Team only/
    );
    assert.throws(
      () => computePayLine(productionEmp, { policy: 'taskbased' }),
      /Office Team only/
    );
    assert.doesNotThrow(() => computePayLine(productionEmp, { policy: 'flat' }));
    const flatLine = computePayLine(productionEmp, { policy: 'flat' });
    assert.equal(flatLine.payClass, 'production');
  });

  it("T4 — attScore is ignored under 'basekpi': two calls differing only in ctx.attScore agree on every basekpi/pay-relevant field", () => {
    const a = computePayLine(OFC, { policy: 'basekpi', kpiScore: 0.7, attScore: 0 });
    const b = computePayLine(OFC, { policy: 'basekpi', kpiScore: 0.7, attScore: 1 });
    // attScore (the raw echoed input) and perfFactor (the frozen 0.7·KPI +
    // 0.3·attendance blend money-core.js keeps computing/storing for every
    // policy, unchanged by this spec — §1.1's own words: "perfFactor keeps
    // being computed and stored exactly as today") are the ONLY two fields
    // on the line that are mathematically a function of attScore, so they
    // are the only two expected to differ here. Everything basekpi-specific
    // and everything pay-relevant (kpiFactor, incentiveEarned, netBeforeCA,
    // finalPay, effectiveGross, statutoryTotal…) must be identical — that is
    // the actual claim "attScore NOT read by this branch" makes.
    assert.notEqual(a.attScore, b.attScore);
    assert.notEqual(a.perfFactor, b.perfFactor);
    const { attScore: _a1, perfFactor: _p1, ...restA } = a;
    const { attScore: _a2, perfFactor: _p2, ...restB } = b;
    assert.deepEqual(restA, restB);
    assert.equal(a.kpiFactor, 0.7);
    assert.equal(a.incentiveEarned, 5600);
  });

  it("T5 — package <= base (allowance 0): incentive is 0 at every KPI level, never negative", () => {
    const zeroIncentiveEmp = { id: 'ofc0', displayName: 'ZeroIncentive', salary: 10000, allowance: 0, deductions: 0 };
    const low  = computePayLine(zeroIncentiveEmp, { policy: 'basekpi', kpiScore: 0.5 });
    const full = computePayLine(zeroIncentiveEmp, { policy: 'basekpi', kpiScore: 1.0 });
    for (const line of [low, full]) {
      assert.equal(line.allowance, 0);
      assert.equal(line.incentiveFull, 0);
      assert.equal(line.incentiveEarned, 0);
      assert.equal(line.base, 10000);
      assert.equal(line.gross, 10000);
      assert.equal(line.statutoryTotal, 950); // 500 sss + 250 philhealth + 200 pagibig
      assert.equal(line.netBeforeCA, 10000 - 950 - 0 + 0);
      assert.equal(line.finalPay, line.netBeforeCA);
    }
    // KPI level makes no difference at all when there is no incentive to scale.
    assert.equal(low.netBeforeCA, full.netBeforeCA);
  });

  it("T6 — an unknown policy string still falls through to 'flat' (existing pinned tolerance unchanged); 'basekpi' is in the whitelist", () => {
    // computePayLine's legacy unknown-policy fallthrough is PINNED, not
    // fixed here — same precedent as TASK-BASED-PAY-SPEC §6.1/T8: the
    // strictness belongs at the settings-doc boundary (js/departments.js's
    // buildPayRunLines, out of this file's scope), never inside this frozen
    // function. A caller that passes an unknown string directly still gets
    // 'flat' math, echoed under whatever string it was given.
    const line = computePayLine(OFC, { policy: 'basekpi-typo' });
    assert.equal(line.netBeforeCA, 10000 + 8000 - line.statutoryTotal); // flat math: gross - statutory - otherDeductions
    assert.equal(line.policy, 'basekpi-typo');
    assert.ok(!('kpiFactor' in line));
    assert.ok(!('incentiveFull' in line));
    assert.ok(!('incentiveEarned' in line));

    // §1.2 — PAY_POLICY_VALUES is additive; 'basekpi' joined without
    // removing any prior value.
    assert.ok(PAY_POLICY_VALUES.includes('basekpi'));
    assert.ok(PAY_POLICY_VALUES.includes('flat'));
    assert.ok(PAY_POLICY_VALUES.includes('taskbased'));
    assert.ok(PAY_POLICY_VALUES.includes('performance'));
  });

  it('T8 — float pin: 18,000 package (base 10,000 / allowance 8,000), KPI 0.85 -> incentiveEarned exactly 6800.00; full-line pin for a concrete statutory/deduction/CA setup', () => {
    const line = computePayLine(
      { id: 'ofc1', displayName: 'Office Employee', salary: 10000, allowance: 8000, deductions: 300 },
      { policy: 'basekpi', kpiScore: 0.85, caPlan: [{ amount: 500 }], caBalance: 500 }
    );
    assert.equal(line.incentiveEarned, 6800.00); // 8000 * 0.85, exactly — the spec's own pinned float fact
    assert.deepEqual(line, {
      uid: 'ofc1', name: 'Office Employee', payClass: 'regular',
      base: 10000, allowance: 8000, otherDeductions: 300, unearnedDeductions: 0, withheldDeductions: 300,
      sss: 900, philhealth: 450, pagibig: 200, tax: 0,
      er: { sss: 1800, philhealth: 450, pagibig: 200 },
      kpiScore: 0.85, attScore: 1, perfFactor: 0.895, policy: 'basekpi',
      caBalance: 500, caPlanned: 500, caPlan: [{ amount: 500 }],
      gross: 18000, effectiveGross: 16800, statutoryTotal: 1550,
      netBeforeCA: 14950, finalPay: 14450,
      kpiFactor: 0.85, incentiveFull: 8000, incentiveEarned: 6800,
    });
  });
});

// ═══════════════════════════════════════════════════════════
// Supplementary — js/pay-policy.js additions the spec also asked for (§1.2,
// §3), verifying the money-side pins above actually surface correctly.
// NOT part of the numbered T1–T8 set (which is computePayLine-focused), but
// exercising the code this same change touched.
// ═══════════════════════════════════════════════════════════
describe("window.payBasisSentence — 'basekpi' wording (§1.2)", () => {
  it('states the base paid in full, the incentive x KPI, and that attendance does not affect pay', () => {
    const line = computePayLine(OFC, { policy: 'basekpi', kpiScore: 0.85 });
    assert.equal(
      payBasisSentence(line),
      '₱10,000.00 base paid in full; the remaining ₱8,000.00 is multiplied by this month\'s KPI score (tasks 70%, deliverables 30%). Attendance does not affect pay.'
    );
    const flatLine = computePayLine(OFC, { policy: 'flat' });
    assert.equal(payBasisSentence(flatLine), '');
  });
});

describe('window.payDerivationSteps — basekpi path (§3, the roster "working" ledger)', () => {
  it('sums EXACTLY to the line\'s finalPay (the reconciliation guard the payroll screen relies on)', () => {
    const line = computePayLine(
      { id: 'ofc1', displayName: 'Office Employee', salary: 10000, allowance: 8000, deductions: 300 },
      { policy: 'basekpi', kpiScore: 0.85, caPlan: [{ amount: 500 }], caBalance: 500 }
    );
    const steps = payDerivationSteps({
      base: line.base,
      statutoryTotal: line.statutoryTotal,
      otherDeductions: line.otherDeductions,
      policy: line.policy,
      kpiFactor: line.kpiFactor,
      incentiveFull: line.incentiveFull,
      incentiveEarned: line.incentiveEarned,
      cashAdvance: line.caPlanned,
      takeHome: line.finalPay,
    });
    assert.equal(steps.reconciled, true);
    assert.equal(steps.residue, 0);
    assert.equal(steps.computed, line.finalPay);
    assert.equal(steps.takeHome, line.finalPay);
    // Order per spec §3: base -> + incentive earned at KPI x% -> - statutory
    // -> - other deductions -> - cash advance = take-home.
    assert.deepEqual(steps.steps.map(s => s.label), [
      'Base pay',
      'Incentive earned at KPI 85%',
      'Government deductions',
      'Other deductions',
      'Cash advance instalment',
      'Take-home pay',
    ]);
  });

  it('folds a one-off amount into the basekpi step ladder (adversarial-verify fix, 2026-08-25)', () => {
    // A basekpi month carrying a one-off bonus: PC.applyOneOffs (policy-blind)
    // folds it into finalPay, so the ladder must show it or the reconciliation
    // guard fires a false red banner. Base 10000, incentive 8000 at KPI 85%
    // (earned 6800), statutory 1550, other deductions 500, one-off +3000,
    // CA 1000 -> take-home 10000+6800+3000-1550-500-1000 = 16750.
    const steps = payDerivationSteps({
      base: 10000,
      statutoryTotal: 1550,
      otherDeductions: 500,
      policy: 'basekpi',
      kpiFactor: 0.85,
      incentiveFull: 8000,
      incentiveEarned: 6800,
      oneOffNet: 3000,
      cashAdvance: 1000,
      takeHome: 16750,
    });
    assert.equal(steps.reconciled, true);
    assert.equal(steps.residue, 0);
    assert.deepEqual(steps.steps.map(s => s.label), [
      'Base pay',
      'Incentive earned at KPI 85%',
      'One-off amounts',
      'Government deductions',
      'Other deductions',
      'Cash advance instalment',
      'Take-home pay',
    ]);
  });
});
