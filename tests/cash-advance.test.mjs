// tests/cash-advance.test.mjs — cash-advance interest recognition.
//
// Guards the 2026-08-07 owner ruling: CA interest is recognised AS IT IS
// COLLECTED. approve() debits 'Advances to Employees' the bare PRINCIPAL, so
// every repayment must credit that account its principal portion only and book
// the rest to Other Income. Before this, repayments credited the receivable the
// FULL installment including interest, so the account finished every loan
// NEGATIVE by exactly the interest and the interest income appeared nowhere.
//
// js/config.js is a side-effectful browser file (Firebase init, DOM, window
// globals) with no module shim, so it cannot be require()d the way
// js/money-core.js can. The one pure helper under test is extracted by source
// and evaluated in isolation. That is deliberate: if `_caSplitPayment` is
// renamed or deleted, this file throws loudly rather than silently passing.
//
// Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8');

function extractFn(name) {
  const start = SRC.indexOf('function ' + name);
  assert.ok(start >= 0, `js/config.js no longer defines function ${name}() — ` +
    `if it was renamed or moved, update this test rather than deleting it.`);
  let depth = 0;
  for (let i = SRC.indexOf('{', start); i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

const sandbox = { window: {} };
new Function('sandbox',
  extractFn('_caRound2') + '\n' + extractFn('_caSplitPayment') +
  '\nsandbox.split = _caSplitPayment; sandbox.round = _caRound2;'
)(sandbox);
const split = sandbox.split, R = sandbox.round;

// Mirrors CashAdvance.approve's schedule maths (js/config.js): round the
// monthly payment FIRST, then derive totalPayable from it, so the installments
// sum to totalPayable exactly.
function schedule(principal, pct, terms) {
  const total = pct > 0 ? principal * Math.pow(1 + pct / 100, terms) : principal;
  const monthly = R(total / terms);
  return { amount: principal, totalPayable: R(monthly * terms), monthly, terms };
}

// Repay a loan to zero the way CashAdvance.deduct does (clamping the last
// payment to the outstanding balance) and report where the money landed.
function repayFully(ca) {
  let receivable = ca.amount;   // approve() debited the PRINCIPAL only
  let income = 0, collected = 0, balance = ca.totalPayable;
  while (balance > 0) {
    const pay = Math.min(ca.monthly, balance);
    const s = split(pay, { ...ca, balance });   // balance is PRE-payment, as at both call sites
    receivable = R(receivable - s.principal);
    income     = R(income + s.interest);
    collected  = R(collected + pay);
    balance    = R(balance - pay);
  }
  return { receivable, income, collected };
}

describe('cash-advance interest recognition (owner ruling 2026-08-07)', () => {
  const CASES = [
    ['the finding\'s worked example', 20000, 2, 6],
    ['long term',                     10000, 1.5, 12],
    ['awkward principal',           3333.33, 2.5, 5],
    ['single-installment advance',     8000, 3, 1],
  ];

  for (const [label, principal, pct, terms] of CASES) {
    it(`${label}: the receivable retires to EXACTLY zero and all interest is recognised`, () => {
      const ca = schedule(principal, pct, terms);
      const expectedInterest = R(ca.totalPayable - principal);
      assert.ok(expectedInterest > 0, 'fixture should actually charge interest');
      const out = repayFully(ca);
      // The whole point: no stranded residue on the asset account. Allocating
      // each installment's interest independently used to leave a few centavos
      // here (+0.02 on 20k/6mo, +0.04 on 10k/12mo) — an account that never quite
      // zeroes. Cumulative allocation makes the shares telescope exactly.
      assert.equal(out.receivable, 0);
      assert.equal(out.income, expectedInterest);
      assert.equal(out.collected, ca.totalPayable);
    });
  }

  it('every payment splits cleanly: principal + interest === the amount paid', () => {
    const ca = schedule(20000, 2, 6);
    let balance = ca.totalPayable;
    while (balance > 0) {
      const pay = Math.min(ca.monthly, balance);
      const s = split(pay, { ...ca, balance });
      assert.equal(R(s.principal + s.interest), pay);
      assert.ok(s.principal >= 0 && s.interest >= 0, 'neither portion may go negative');
      balance = R(balance - pay);
    }
  });

  it('ZERO-INTEREST advance is untouched — the whole payment is principal', () => {
    const ca = { amount: 6000, totalPayable: 6000, balance: 6000 };
    const s = split(2000, ca);
    assert.equal(s.principal, 2000);
    assert.equal(s.interest, 0);
  });

  it('LEGACY doc with no totalPayable: all principal, no interest invented', () => {
    const s = split(1000, { amount: 5000 });
    assert.equal(s.principal, 1000);
    assert.equal(s.interest, 0);
  });

  it('a payment of zero or less yields nothing, never a negative leg', () => {
    for (const bad of [0, -500, null, undefined, NaN]) {
      const s = split(bad, schedule(20000, 2, 6));
      assert.equal(s.principal, 0);
      assert.equal(s.interest, 0);
    }
  });

  it('OVER-PAYMENT can never book more interest than the loan actually charges', () => {
    const ca = schedule(20000, 2, 6);
    const s = split(999999, { ...ca, balance: ca.totalPayable });
    assert.equal(s.interest, R(ca.totalPayable - ca.amount));  // capped at the loan's total interest
    assert.ok(s.interest <= 999999);
  });

  it('an explicit collectedBefore overrides the balance-derived cursor (the resume path)', () => {
    const ca = schedule(20000, 2, 6);
    // Same payment, same doc — but told it is the 1st vs the 4th installment.
    const first  = split(ca.monthly, { ...ca, balance: ca.totalPayable }, 0);
    const fourth = split(ca.monthly, { ...ca, balance: ca.totalPayable }, R(ca.monthly * 3));
    assert.equal(R(first.principal + first.interest), ca.monthly);
    assert.equal(R(fourth.principal + fourth.interest), ca.monthly);
    // Proportional allocation ⇒ equal instalments carry equal interest, which is
    // what makes the resume path reproduce the original pass exactly.
    assert.equal(first.interest, fourth.interest);
  });
});
