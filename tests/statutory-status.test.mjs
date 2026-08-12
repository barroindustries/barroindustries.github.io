// tests/statutory-status.test.mjs — STATUTORY-BY-STATUS-SPEC-2026-08-12 §9
//
// Pins window.statutoryStatusPlan (js/statutory-status.js, a pure derivation
// layer) and proves — via the frozen js/money-core.js resolver it feeds — the
// single most important property in this change: with the rule OFF, every
// person computes byte-identically to before; with it ON, only an explicit
// training/probationary person (and only when nothing else already governs
// their SSS/PhilHealth/Pag-IBIG) ever changes, and the change is always a
// zero, never an increase.
//
// Zero deps: node:test + node:assert only, same convention as
// tests/money.test.mjs. js/statutory-status.js and js/money-core.js both
// carry the UMD-ish shim (`if (typeof window === 'undefined') globalThis.
// window = globalThis`) plus a trailing module.exports guard, so both can be
// require()'d directly with no build step and no app bootstrap.
//
// This suite intentionally does NOT require js/config.js — that file touches
// window.addEventListener/DOM at load time, unrelated to this pure math (see
// tests/money.test.mjs's header for the same reasoning re: bizYear/
// ledgerKind). Instead window.EMPLOYMENT_STATUSES/employmentStatusMeta are
// stubbed here to the SAME shape config.js defines, so statutoryStatusPlan's
// label lookups and its "known status" set match production exactly.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

globalThis.window = globalThis;

// Mirrors js/config.js ~452-465 verbatim (labels only matter for the
// rendered sentences below; the `ends` flags aren't read by this file).
window.EMPLOYMENT_STATUSES = {
  training:     { label: 'Training',     badge: 'badge-orange', ends: false },
  probationary: { label: 'Probationary', badge: 'badge-blue',   ends: false },
  regular:      { label: 'Regular',      badge: 'badge-green',  ends: false },
  resigned:     { label: 'Resigned',     badge: 'badge-gray',   ends: true  },
  terminated:   { label: 'Terminated',   badge: 'badge-red',    ends: true  }
};
window.employmentStatusMeta = function (v) {
  const k = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return window.EMPLOYMENT_STATUSES[k] || { label: 'Not set', badge: 'badge-gray', ends: false, unset: true };
};

const statutoryStatus = require(path.join(ROOT, 'js/statutory-status.js'));
const { statutoryStatusPlan, STATUTORY_STATUS_RULE } = statutoryStatus;

const money = require(path.join(ROOT, 'js/money-core.js'));
const { resolveStatutoryEE } = money;

// computeStatutory console.warns on every call while the 2026 table is
// unverified (js/statutory-tables.js) — this suite never calls it directly,
// but payroll-weekly.js's own module-level requires can; keep output clean
// without hiding a real assertion failure, same guard tests/money.test.mjs uses.
let _originalWarn;
before(() => { _originalWarn = console.warn; console.warn = () => {}; });
after(() => { console.warn = _originalWarn; });

const WRC = require(path.join(ROOT, 'js/payroll-weekly.js'));

// Shared fixture (spec §9) — a stand-in computeStatutory() result, synthetic,
// not real rates. Never used to assert anything about actual 2026 government
// tables — those live in js/statutory-tables.js and are out of scope here.
const STAT = { ee: { sss: 100, philhealth: 200, pagibig: 50, tax: 300 }, er: { sss: 150, philhealth: 200, pagibig: 50 } };

describe('STATUTORY_STATUS_RULE — the data (spec §5.1)', () => {
  it('only training/probationary derive an exemption; regular/resigned/terminated derive nothing', () => {
    assert.equal(STATUTORY_STATUS_RULE.training, 'exempt');
    assert.equal(STATUTORY_STATUS_RULE.probationary, 'exempt');
    assert.equal(STATUTORY_STATUS_RULE.regular, 'none');
    assert.equal(STATUTORY_STATUS_RULE.resigned, 'none');
    assert.equal(STATUTORY_STATUS_RULE.terminated, 'none');
  });
});

describe('statutoryStatusPlan — pure (spec §9, tests 1-10)', () => {
  it('1. regular, no config, enabled -> inactive, legacy fallthrough everywhere, no flag', () => {
    const plan = statutoryStatusPlan({ employmentStatus: 'regular' }, true);
    assert.equal(plan.active, false);
    assert.equal(plan.statConfig, null);
    assert.deepEqual(plan.perKey, { sss: 'legacy', philhealth: 'legacy', pagibig: 'legacy', tax: 'legacy' });
    assert.equal(plan.flag, null);
    assert.equal(plan.words, '');
  });

  it('2. probationary, no config, enabled -> active, all three exempt (no tax), rule-applied words', () => {
    const plan = statutoryStatusPlan({ employmentStatus: 'probationary' }, true);
    assert.equal(plan.active, true);
    assert.deepEqual(plan.statConfig, { sss: 'exempt', philhealth: 'exempt', pagibig: 'exempt' });
    assert.equal('tax' in plan.statConfig, false);
    assert.deepEqual(plan.perKey, { sss: 'status', philhealth: 'status', pagibig: 'status', tax: 'legacy' });
    assert.equal(plan.words, 'No SSS, PhilHealth or Pag-IBIG — employment status is Probationary. Status is set on their HR record.');
    assert.equal(plan.flag, null);
  });

  it('3. training, no config, enabled:false -> inactive, flags/words suppressed', () => {
    const plan = statutoryStatusPlan({ employmentStatus: 'training' }, false);
    assert.equal(plan.active, false);
    assert.equal(plan.flag, null);
    assert.equal(plan.words, '');
  });

  it('4. probationary, typed sss:120, enabled -> sss stays typed, philhealth/pagibig exempt, flagged', () => {
    const plan = statutoryStatusPlan({ employmentStatus: 'probationary', sss: 120 }, true);
    assert.equal(plan.perKey.sss, 'typed');
    assert.deepEqual(plan.statConfig, { philhealth: 'exempt', pagibig: 'exempt' });
    assert.equal(plan.flag && plan.flag.kind, 'typed-on-nonregular');
  });

  it('5. probationary, explicit statConfig.sss=auto, enabled -> sss preserved, others exempt, flagged', () => {
    const plan = statutoryStatusPlan({ employmentStatus: 'probationary', statConfig: { sss: 'auto' } }, true);
    assert.equal(plan.perKey.sss, 'person');
    assert.deepEqual(plan.statConfig, { sss: 'auto', philhealth: 'exempt', pagibig: 'exempt' });
    assert.equal(plan.flag && plan.flag.kind, 'typed-on-nonregular');
  });

  it("6. status '' (unset), enabled -> inactive, status-unset flag", () => {
    const plan = statutoryStatusPlan({ employmentStatus: '' }, true);
    assert.equal(plan.active, false);
    assert.equal(plan.flag && plan.flag.kind, 'status-unset');
  });

  it("7. status 'Contractual' (unknown), enabled -> inactive, status-unknown flag", () => {
    const plan = statutoryStatusPlan({ employmentStatus: 'Contractual' }, true);
    assert.equal(plan.active, false);
    assert.equal(plan.flag && plan.flag.kind, 'status-unknown');
    assert.match(plan.flag.words, /'Contractual'/);
  });

  it('8. terminated, enabled -> inactive, status-ended flag (final pay, unchanged)', () => {
    const plan = statutoryStatusPlan({ employmentStatus: 'terminated' }, true);
    assert.equal(plan.active, false);
    assert.equal(plan.flag && plan.flag.kind, 'status-ended');
  });

  it("9. status '  REGULAR ' (whitespace/case), enabled -> normalizes like employmentStatusMeta, inactive", () => {
    const plan = statutoryStatusPlan({ employmentStatus: '  REGULAR ' }, true);
    assert.equal(plan.status, 'regular');
    assert.equal(plan.active, false);
  });

  it('10. regular Operations worker with no statConfig -> regular-unconfigured; configured -> no flag', () => {
    const bare = statutoryStatusPlan({ employmentStatus: 'regular' }, true, { engine: 'week' });
    assert.equal(bare.flag && bare.flag.kind, 'regular-unconfigured');
    const configured = statutoryStatusPlan({ employmentStatus: 'regular', statConfig: { sss: 'auto' } }, true, { engine: 'week' });
    assert.equal(configured.flag, null);
  });
});

describe('money pinning — plan x frozen resolver, the end-to-end truth table (spec §9, tests 11-15)', () => {
  it('11. row 8/9: derived exempt zeroes EE and ER for all three, tax untouched', () => {
    const empProbationary = { employmentStatus: 'probationary', tax: 300 };
    const plan = statutoryStatusPlan(empProbationary, true);
    const result = resolveStatutoryEE({ ...empProbationary, statConfig: plan.statConfig }, STAT);
    assert.deepEqual(result, { sss: 0, philhealth: 0, pagibig: 0, tax: 300, er: { sss: 0, philhealth: 0, pagibig: 0 } });
  });

  it('12. row 4 control: regular/no-config emp passed UNCHANGED is byte-identical to legacy', () => {
    const empRegular = { employmentStatus: 'regular' };
    const plan = statutoryStatusPlan(empRegular, true);
    assert.equal(plan.active, false); // caller must pass emp UNCHANGED when inactive
    const result = resolveStatutoryEE(empRegular, STAT);
    assert.deepEqual(result, { sss: 100, philhealth: 200, pagibig: 50, tax: 300, er: { sss: 150, philhealth: 200, pagibig: 50 } });
  });

  it('13. row 10: probationary + typed sss:120 — typed wins, its ER stays table-computed, derived keys zero both shares', () => {
    const emp = { employmentStatus: 'probationary', sss: 120, tax: 300 };
    const plan = statutoryStatusPlan(emp, true);
    const result = resolveStatutoryEE({ ...emp, statConfig: plan.statConfig }, STAT);
    assert.deepEqual(result, { sss: 120, philhealth: 0, pagibig: 0, tax: 300, er: { sss: 150, philhealth: 0, pagibig: 0 } });
  });

  it('14. pinned-quirk preservation: regular, typed sss:0, plan inactive — 0 still falls through to the table', () => {
    const emp = { employmentStatus: 'regular', sss: 0, tax: 300 };
    const plan = statutoryStatusPlan(emp, true);
    assert.equal(plan.active, false);
    const result = resolveStatutoryEE(emp, STAT); // unchanged, per plan.active === false
    assert.equal(result.sss, 100); // money-core's pinned quirk: typed 0 falls through to the table
  });

  it('15. weekly no-op: resolveStatutoryWeekly on an unconfigured worker is unaffected — words only, never numbers', () => {
    // A worker with NO statConfig already deducts nothing today
    // (WRC.resolveStatutoryWeekly's unconfigured path, js/payroll-weekly.js
    // ~311). Spec §8 item 5 forbids ever feeding the DERIVED plan.statConfig
    // into this resolver — doing so would flip `configured:true` and emit a
    // misleading "configured for statutory deductions" warning for a
    // trainee. This proves the resolver's own behaviour for such a worker is
    // untouched by this change (it is never called with anything other than
    // the worker's own real profile).
    const profileNoConfig = { employmentStatus: 'training' }; // no statConfig -> unconfigured, regardless of status
    const plan = statutoryStatusPlan(profileNoConfig, true, { engine: 'week' });
    assert.equal(plan.active, true); // the rule DOES derive an exempt plan for this worker...
    // ...but it must never reach resolveStatutoryWeekly. Calling the real,
    // frozen resolver with the worker's own (unconfigured) profile — exactly
    // what js/payroll-weekly.js does regardless of the switch — proves the
    // numbers are the same all-zero, configured:false shape as before.
    const result = WRC.resolveStatutoryWeekly(profileNoConfig, { isLastPayWeek: true, table: STAT });
    assert.deepEqual(result, { sss: 0, philhealth: 0, pagibig: 0, tax: 0, total: 0, er: null, configured: false, applied: false });
  });
});

describe('THE NO-OP PROPERTY — the single most important guarantee in this change', () => {
  // js/departments.js buildPayRunLines and js/payroll-weekly.js buildLines
  // both do: `const empForPay = plan.active ? { ...empEff, statConfig:
  // plan.statConfig } : empEff;` — i.e. the ORIGINAL object is passed on,
  // completely untouched, whenever plan.active is false. So "does the switch
  // being off change anyone's numbers" reduces to "can plan.active ever be
  // true when enabled !== true" — which this suite proves is impossible,
  // for every status the app knows about, any unknown status, and blank/
  // absent status alike.
  it('with the switch OFF, active is false for every known status, any unknown status, and unset — no matter what', () => {
    const statuses = ['training', 'probationary', 'regular', 'resigned', 'terminated', 'Contractual', '', undefined, null, '  TRAINING  '];
    statuses.forEach((s) => {
      const plan = statutoryStatusPlan({ employmentStatus: s }, false);
      assert.equal(plan.active, false, `active must be false for status ${JSON.stringify(s)} when the switch is off`);
      assert.equal(plan.statConfig, null);
    });
    // Same for the weekly engine's own opts.engine:'week' path.
    statuses.forEach((s) => {
      const plan = statutoryStatusPlan({ employmentStatus: s }, false, { engine: 'week' });
      assert.equal(plan.active, false, `active must be false (week engine) for status ${JSON.stringify(s)} when the switch is off`);
    });
  });

  it('with the switch ON, active is true ONLY for explicit training/probationary — never regular/resigned/terminated/unset/unknown', () => {
    const neverActive = ['regular', 'resigned', 'terminated', 'Contractual', '', undefined, null, '  REGULAR  '];
    neverActive.forEach((s) => {
      const plan = statutoryStatusPlan({ employmentStatus: s }, true);
      assert.equal(plan.active, false, `active must stay false for status ${JSON.stringify(s)} even with the switch on`);
    });
    ['training', 'probationary', '  TRAINING  ', 'Probationary'].forEach((s) => {
      const plan = statutoryStatusPlan({ employmentStatus: s }, true);
      assert.equal(plan.active, true, `active must be true for explicit status ${JSON.stringify(s)} with the switch on`);
    });
  });

  it('with the switch ON, an explicit non-exempt statConfig or a hand-typed amount still blocks activation on that key — never forces a bigger deduction', () => {
    // A fully hand-configured probationary person (every key explicit, none
    // exempt) has NOTHING left for the rule to derive -> active stays false,
    // and the person's own configuration is untouched either way.
    const allExplicit = { employmentStatus: 'probationary', statConfig: { sss: 'auto', philhealth: 'fixed', pagibig: 'auto' } };
    const plan = statutoryStatusPlan(allExplicit, true);
    assert.equal(plan.active, false);
    assert.equal(plan.statConfig, null);
  });

  it('the rule NEVER derives a mode for tax, on or off, for any status', () => {
    ['training', 'probationary', 'regular', 'resigned', 'terminated', ''].forEach((s) => {
      [true, false].forEach((enabled) => {
        const plan = statutoryStatusPlan({ employmentStatus: s, tax: 0 }, enabled);
        assert.notEqual(plan.perKey.tax, 'status', `tax must never resolve to 'status' (status=${s}, enabled=${enabled})`);
      });
    });
  });

  it('end-to-end: switch OFF makes buildPayRunLines/buildLines pass emp UNCHANGED — proved by feeding a training person through the frozen resolver untouched', () => {
    // This is the exact shape js/departments.js's buildPayRunLines and
    // js/payroll-weekly.js's buildLines rely on: `plan.active ? {...} :
    // empEff` degenerates to `empEff` when the switch is off, so a person
    // who WOULD be exempted once the switch is on computes IDENTICALLY to
    // today while it is off — even a Training person with real money on
    // the line.
    const trainee = { employmentStatus: 'training', sss: 0, philhealth: 0, pagibig: 0, tax: 300 };
    const planOff = statutoryStatusPlan(trainee, false);
    assert.equal(planOff.active, false);
    const empForPayOff = planOff.active ? { ...trainee, statConfig: planOff.statConfig } : trainee;
    assert.equal(empForPayOff, trainee); // literally the SAME object reference — nothing rebuilt, nothing to diverge
    const resultOff = resolveStatutoryEE(empForPayOff, STAT);
    assert.deepEqual(resultOff, { sss: 100, philhealth: 200, pagibig: 50, tax: 300, er: { sss: 150, philhealth: 200, pagibig: 50 } });

    // Same trainee, switch ON: now it DOES change, and only to zero.
    const planOn = statutoryStatusPlan(trainee, true);
    assert.equal(planOn.active, true);
    const empForPayOn = planOn.active ? { ...trainee, statConfig: planOn.statConfig } : trainee;
    const resultOn = resolveStatutoryEE(empForPayOn, STAT);
    assert.deepEqual(resultOn, { sss: 0, philhealth: 0, pagibig: 0, tax: 300, er: { sss: 0, philhealth: 0, pagibig: 0 } });
  });
});
