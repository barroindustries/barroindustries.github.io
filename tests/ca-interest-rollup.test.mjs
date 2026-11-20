// tests/ca-interest-rollup.test.mjs — 2026-11-20 system review, item F3.
// A manual cash-advance repayment posts its interest as an Other Income ledger row (CA-<id>-REPAY-<pid>-INT)
// with a raw add, which bypassed finance_rollup — so Finance Overview (built from the rollups) under-reported
// CA interest until someone ran Rebuild rollups. recordPayment now syncs that row into the rollup (+1).
// Runs the REAL CashAdvance.recordPayment from js/config.js against an in-memory Firestore, with the real
// _caSplitPayment.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');
function extract(sig) {
  const start = SRC.indexOf(sig);
  assert.ok(start >= 0, `js/config.js no longer has "${sig}" — update this test, don't delete it`);
  let depth = 0;
  for (let i = SRC.indexOf('{', SRC.indexOf(')', start)); i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(start, i + 1);
  }
  throw new Error('unbalanced braces');
}

function makeDb(ca) {
  const store = { cash_advances: new Map([['ca1', structuredClone(ca)]]), ledger: new Map() };
  let n = 0;
  const q = (col, filters) => ({
    where: (f, op, v) => q(col, [...filters, [f, v]]),
    limit: () => q(col, filters),
    async get() { const docs = [...store[col]].filter(([, r]) => filters.every(([f, v]) => r[f] === v)); return { docs, size: docs.length }; },
  });
  return {
    store,
    collection: (col) => ({
      doc: (id) => ({ col, id: id || `auto${++n}` }),
      add: async (row) => { store[col].set(`auto${++n}`, row); return { id: `auto${n}` }; },
      ...q(col, []),
    }),
    async runTransaction(fn) {
      await fn({
        get: async (r) => ({ exists: store[r.col].has(r.id), data: () => structuredClone(store[r.col].get(r.id)) }),
        update: (r, p) => Object.assign(store[r.col].get(r.id), p),
      });
    },
  };
}

function load(db, synced) {
  const r2 = (x) => Math.round(x * 100) / 100;
  const window = {
    currentUser: { uid: 'pres' }, userProfile: { displayName: 'President' },
    bizDate: () => '2026-11-20',
    BankAccounts: { tag: (acct, flow) => (acct ? { bankAccountId: acct.bankAccountId, bankFlow: flow } : {}) },
    Ledger: { _syncRollup: async (row, sign) => synced.push([row.refNumber, row.accountType, row.amount, sign]) },
  };
  const firebase = { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } };
  return new Function('db', 'window', 'firebase', 'Notifs', 'fmt', '_caRound2', 'today', 'dbCacheInvalidate',
    `${extract('function _caSplitPayment(payment, ca, collectedBefore)')}
     return { ${extract('async recordPayment(id, { amount, date, bankAccount = null })')} };`)(
    db, window, firebase, { send: async () => {} }, String, r2, () => '2026-11-20', () => {});
}

describe('F3 · cash-advance interest reaches the Finance Overview totals', () => {
  it('a repayment that includes interest syncs the interest row into finance_rollup (+1), and only that row', async () => {
    // ₱10,000 at 10% → ₱11,000 payable; a ₱2,200 payment is part principal, part interest
    const db = makeDb({ status: 'approved', amount: 10000, interest: 10, interestCharged: true, totalPayable: 11000, balance: 11000, payments: [] });
    const synced = [];
    await load(db, synced).recordPayment('ca1', { amount: 2200, date: '2026-11-20', bankAccount: { bankAccountId: 'bdo' } });
    const rows = [...db.store.ledger.values()];
    const intRow = rows.find((r) => /-INT$/.test(r.refNumber));
    const prinRow = rows.find((r) => !/-INT$/.test(r.refNumber));
    assert.ok(intRow && intRow.amount > 0, 'the interest row is posted');
    assert.equal(+(intRow.amount + prinRow.amount).toFixed(2), 2200, 'principal + interest = the payment');
    assert.deepEqual(synced, [[intRow.refNumber, 'income', intRow.amount, 1]], 'exactly the income row is added to the rollup');
  });

  it('a zero-interest advance posts no interest row and syncs nothing', async () => {
    const db = makeDb({ status: 'approved', amount: 5000, interest: 0, interestCharged: false, totalPayable: 5000, balance: 5000, payments: [] });
    const synced = [];
    await load(db, synced).recordPayment('ca1', { amount: 1000, date: '2026-11-20' });
    assert.equal([...db.store.ledger.values()].filter((r) => /-INT$/.test(r.refNumber)).length, 0);
    assert.deepEqual(synced, []);
  });
});
