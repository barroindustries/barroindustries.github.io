// tests/payrun-guard.test.mjs — the monthly pay run's DOUBLE-PAY GUARD.
//
// window.monthlyRunSkipReason(u, linkedUids) (js/departments.js) is the single
// named expression that decides who the MONTHLY (Office Team) run pays. Every
// `null` it returns is a person who gets computed, verified and disbursed; every
// non-null string is a person deliberately left out, surfaced in the run's
// "skipped" list so an exclusion is always visible rather than silent.
//
// It exists because each of its clauses is a bug that reached production:
//   • removed          — an offboarded employee was still computed and disbursed
//   • production       — Operations Team staff are paid WEEKLY on their own tab;
//                        including them here pays the same work twice
//   • linked-worker-... — the same person holding BOTH a login and a worker
//                        profile is one human, payable once
//   • excluded         — staff with no salary on file were computed anyway, so
//                        the statutory table deducted SSS/PhilHealth from a base
//                        of 0 and the roster showed NEGATIVE net pay
//
// Until now the guard had no durable test: the harnesses that checked it during
// the build and the review were both ad-hoc and thrown away, so nothing stopped
// the next edit from quietly reopening the double-pay window. These tests PIN
// the guard's contract. A failure here means someone is about to be paid twice
// or not at all — read the clause before changing the expectation.
//
// Run with: node --test tests/*.test.mjs
// Zero deps: node:test + node:assert only.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/departments.js'), 'utf8');

// Load the guard out of the real source file — not a copy — so the test can
// never drift into asserting against a stale duplicate of the logic.
function loadGuard() {
  const NEEDLE = 'window.monthlyRunSkipReason = function';
  const start = SRC.indexOf(NEEDLE);
  assert.ok(start >= 0,
    'js/departments.js no longer defines window.monthlyRunSkipReason. It is the ' +
    'monthly run\'s double-pay guard — if it was renamed or moved, point this ' +
    'test at the new name rather than deleting it.');
  let depth = 0;
  for (let i = SRC.indexOf('{', start); i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) {
      const sandbox = { window: {} };
      new Function('window', SRC.slice(start, i + 1))(sandbox.window);
      return sandbox.window.monthlyRunSkipReason;
    }
  }
  throw new Error('unbalanced braces extracting monthlyRunSkipReason');
}

const skipReason = loadGuard();

// A plain Office Team employee: the ONLY shape the monthly run should pay.
const payable = () => ({ id: 'u1', payClass: 'regular', displayName: 'Office person' });
const noLinks = new Set();

describe('monthly pay run — who gets paid', () => {
  it('pays a regular Office Team employee', () => {
    assert.equal(skipReason(payable(), noLinks), null);
  });

  it('pays someone whose payClass is absent (absent === regular)', () => {
    // The profile screen and the run must agree on this default; if the run
    // starts skipping blank payClass, existing staff silently stop being paid.
    const u = payable();
    delete u.payClass;
    assert.equal(skipReason(u, noLinks), null);
  });

  it('pays someone explicitly not excluded and not removed', () => {
    assert.equal(
      skipReason({ ...payable(), removed: false, payrollExcluded: false }, noLinks),
      null);
  });
});

describe('monthly pay run — double-pay guard', () => {
  it('skips Operations Team staff, who are paid weekly on their own tab', () => {
    assert.equal(skipReason({ ...payable(), payClass: 'production' }, noLinks),
      'production');
  });

  it('skips a login whose worker profile is linked — one human, paid once', () => {
    const linked = new Set(['u1']);
    assert.equal(skipReason(payable(), linked), 'linked-worker-profile');
  });

  it('accepts a plain object for linkedUids as well as a Set', () => {
    // Both call shapes exist in the codebase; a guard that only understands one
    // returns null for the other, which is a silent double payment.
    assert.equal(skipReason(payable(), { u1: true }), 'linked-worker-profile');
  });

  it('skips a linked worker even when everything else looks payable', () => {
    assert.equal(
      skipReason({ id: 'u1', payClass: 'regular', removed: false }, new Set(['u1'])),
      'linked-worker-profile');
  });

  it('does not skip a DIFFERENT uid that happens to be linked', () => {
    assert.equal(skipReason({ ...payable(), id: 'u2' }, new Set(['u1'])), null);
  });
});

describe('monthly pay run — offboarded and excluded staff', () => {
  it('skips an offboarded employee', () => {
    assert.equal(skipReason({ ...payable(), removed: true }, noLinks), 'removed');
  });

  it('skips removed BEFORE any other reason, so the message names the real cause', () => {
    assert.equal(
      skipReason({ ...payable(), removed: true, payClass: 'production' }, noLinks),
      'removed');
  });

  it('treats only removed === true as removed, never a truthy string', () => {
    // A stray 'false' / '' / timestamp in the field must not offboard anyone.
    for (const v of ['false', '', 0, null, undefined, 'yes']) {
      assert.equal(skipReason({ ...payable(), removed: v }, noLinks), null,
        `removed: ${JSON.stringify(v)} must not skip payment`);
    }
  });

  it('skips staff flagged as excluded from payroll', () => {
    assert.equal(
      skipReason({ ...payable(), payrollExcluded: true }, noLinks),
      'excluded');
  });

  it('carries the exclusion reason through to the skipped list', () => {
    assert.equal(
      skipReason({ ...payable(), payrollExcluded: true, payrollExcludedReason: 'unpaid intern' }, noLinks),
      'excluded: unpaid intern');
  });

  it('treats only payrollExcluded === true as excluded', () => {
    for (const v of ['false', '', 0, null, undefined]) {
      assert.equal(skipReason({ ...payable(), payrollExcluded: v }, noLinks), null,
        `payrollExcluded: ${JSON.stringify(v)} must not skip payment`);
    }
  });
});

describe('monthly pay run — defensive inputs', () => {
  it('skips a missing user rather than paying an empty record', () => {
    assert.equal(skipReason(null, noLinks), 'missing');
    assert.equal(skipReason(undefined, noLinks), 'missing');
  });

  it('tolerates an absent linkedUids argument', () => {
    assert.equal(skipReason(payable()), null);
    assert.equal(skipReason(payable(), null), null);
  });

  it('always returns null or a non-empty string — never undefined', () => {
    // The caller branches on `reason ? skip : pay`; an accidental `undefined`
    // from a new clause would read as "pay them".
    const cases = [
      [payable(), noLinks], [null, noLinks],
      [{ ...payable(), removed: true }, noLinks],
      [{ ...payable(), payClass: 'production' }, noLinks],
      [{ ...payable(), payrollExcluded: true }, noLinks],
      [payable(), new Set(['u1'])]
    ];
    for (const [u, l] of cases) {
      const r = skipReason(u, l);
      assert.ok(r === null || (typeof r === 'string' && r.length > 0),
        `guard returned ${JSON.stringify(r)} — must be null or a non-empty string`);
    }
  });
});
