// tests/ca-delete-cascade.test.mjs — deleting a cash advance must take ALL of its ledger rows with it.
// 2026-11-20 system review:
//  F1 — the Cash Advances page deleted the cash_advances doc directly, skipping the cascade, so the
//       CA-<id> release row (and its bank 'out' tag) stayed in the books for good.
//  F2 — the cascade itself removed only CA-<id>; the manual-repayment legs CA-<id>-REPAY-<pid> (principal)
//       and CA-<id>-REPAY-<pid>-INT (interest) survived, driving 'Advances to Employees' negative.
//       A payroll-repaid advance cannot be cascaded per advance (those legs are monthly aggregates), so
//       its delete is refused with nothing written.
// Runs the REAL financeDeleteCascade + financeExecuteDelete + _findLedgerRowByRef from js/departments.js
// against an in-memory Firestore.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const DEPT = fs.readFileSync(new URL('../js/departments.js', import.meta.url), 'utf8');
const PEOPLE = fs.readFileSync(new URL('../js/screens/people.js', import.meta.url), 'utf8');

function extract(src, sig) {
  const start = src.indexOf(sig);
  assert.ok(start >= 0, `"${sig}" is gone — update this test, don't delete it`);
  let depth = 0;
  for (let i = src.indexOf('{', src.indexOf(')', start)); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unbalanced braces');
}

function makeDb({ docs = {}, ledger = {}, failRange = false } = {}) {
  const cols = { cash_advances: new Map(Object.entries(docs)), ledger: new Map(Object.entries(ledger)) };
  const ref = (col, id) => ({ col, id });
  const snapOf = (col, id) => ({ id, ref: ref(col, id), exists: cols[col].has(id), data: () => structuredClone(cols[col].get(id)) });
  const query = (col, filters) => ({
    where: (f, op, v) => query(col, [...filters, [f, op, v]]),
    limit: () => query(col, filters),
    async get() {
      if (failRange && filters.some(([, op]) => op === '>=')) throw new Error('permission-denied');
      const ok = (row) => filters.every(([f, op, v]) => op === '==' ? row[f] === v : op === '>=' ? (row[f] ?? '') >= v : op === '<' ? (row[f] ?? '') < v : false);
      const hits = [...cols[col]].filter(([, row]) => ok(row)).map(([id]) => snapOf(col, id));
      return { docs: hits, size: hits.length };
    },
  });
  return {
    cols,
    collection: (col) => ({ doc: (id) => ({ ...ref(col, id), get: async () => snapOf(col, id) }), ...query(col, []) }),
    batch() {
      const ops = [];
      return {
        delete: (r) => ops.push(['del', r]),
        update: (r, p) => ops.push(['upd', r, p]),
        async commit() { for (const [k, r, p] of ops) k === 'del' ? cols[r.col].delete(r.id) : Object.assign(cols[r.col].get(r.id), p); },
      };
    },
  };
}

function load(db) {
  const synced = [];
  const window = { Ledger: { _syncRollup: async (row, sign) => synced.push([row.refNumber, sign]) } };
  const firebase = { firestore: { FieldValue: { increment: (n) => ({ inc: n }), delete: () => ({ del: true }) } } };
  new Function('db', 'window', 'firebase', 'dbCacheInvalidate', 'today',
    `${extract(DEPT, 'async function _findLedgerRowByRef(ref)')}
     ${extract(DEPT, 'async function financeDeleteCascade(collection, docId, batch)')}
     ${extract(DEPT, 'window.financeExecuteDelete = async function(collection, docId)')}`)(db, window, firebase, () => {}, () => '2026-11-20');
  return { del: window.financeExecuteDelete, synced };
}

const LEDGER = () => ({
  rel:   { refNumber: 'CA-ca1', account: 'Advances to Employees', accountType: 'asset', type: 'debit', amount: 10000 },
  rep1:  { refNumber: 'CA-ca1-REPAY-p1', account: 'Advances to Employees', accountType: 'asset', type: 'credit', amount: 2000 },
  rep2:  { refNumber: 'CA-ca1-REPAY-p2', account: 'Advances to Employees', accountType: 'asset', type: 'credit', amount: 1800 },
  int2:  { refNumber: 'CA-ca1-REPAY-p2-INT', account: 'Other Income', accountType: 'income', type: 'credit', amount: 200 },
  // must survive: another advance's rows, including one whose id merely starts with "ca1"
  other: { refNumber: 'CA-ca2', amount: 5000 },
  near:  { refNumber: 'CA-ca10-REPAY-p9', amount: 700 },
  pay:   { refNumber: 'CADEDUCT-2026-10', amount: 900 },
});

describe('deleting a cash advance removes every ledger row it posted', () => {
  it('a half-repaid advance: the release, both repayments and the interest go; nothing else does', async () => {
    const db = makeDb({
      docs: { ca1: { status: 'approved', amount: 10000, balance: 6000, payments: [
        { amount: 2000, paymentId: 'p1', source: 'manual' }, { amount: 2000, paymentId: 'p2', source: 'manual' }] } },
      ledger: LEDGER(),
    });
    const { del, synced } = load(db);
    await del('cash_advances', 'ca1');
    assert.equal(db.cols.cash_advances.has('ca1'), false, 'the advance itself is deleted');
    assert.deepEqual([...db.cols.ledger.keys()].sort(), ['near', 'other', 'pay'], 'exactly the advance\'s own rows are removed');
    // rollup: every removed row is subtracted — the interest leg too, since it is synced in when posted (F3)
    assert.deepEqual(synced.map(([r]) => r).sort(), ['CA-ca1', 'CA-ca1-REPAY-p1', 'CA-ca1-REPAY-p2', 'CA-ca1-REPAY-p2-INT']);
    assert.ok(synced.every(([, s]) => s === -1));
  });

  it('an advance with no repayments: just the release row goes', async () => {
    const db = makeDb({ docs: { ca1: { status: 'approved', amount: 10000, balance: 10000, payments: [] } },
      ledger: { rel: { refNumber: 'CA-ca1', amount: 10000 }, other: { refNumber: 'CA-ca2', amount: 1 } } });
    await load(db).del('cash_advances', 'ca1');
    assert.deepEqual([...db.cols.ledger.keys()], ['other']);
  });

  it('a payroll-repaid advance is refused and NOTHING is written (doc and every ledger row intact)', async () => {
    const db = makeDb({
      docs: { ca1: { status: 'approved', amount: 10000, balance: 8000, payments: [{ amount: 2000, source: 'payroll', month: '2026-10' }] } },
      ledger: LEDGER(),
    });
    await assert.rejects(load(db).del('cash_advances', 'ca1'), /repaid through payroll \(2026-10\)/);
    assert.equal(db.cols.cash_advances.has('ca1'), true);
    assert.equal(db.cols.ledger.size, Object.keys(LEDGER()).length);
  });

  it('if the repayment-leg read fails, the delete fails with it — no half cascade', async () => {
    const db = makeDb({ docs: { ca1: { status: 'approved', amount: 10000, payments: [] } }, ledger: LEDGER(), failRange: true });
    await assert.rejects(load(db).del('cash_advances', 'ca1'), /permission-denied/);
    assert.equal(db.cols.cash_advances.has('ca1'), true);
    assert.equal(db.cols.ledger.size, Object.keys(LEDGER()).length);
  });
});

describe('the Cash Advances page delete goes through the cascade', () => {
  const handler = PEOPLE.slice(PEOPLE.indexOf(".querySelectorAll('.ca-delete-btn')"), PEOPLE.indexOf('}));', PEOPLE.indexOf(".querySelectorAll('.ca-delete-btn')")));
  it('calls financeExecuteDelete, never a raw doc delete', () => {
    assert.ok(handler.length > 0);
    assert.match(handler, /window\.financeExecuteDelete\('cash_advances', id\)/);
    assert.doesNotMatch(handler, /\.doc\(id\)\.delete\(\)/);
  });
  it('handles a refused or failed delete with a message (no unhandled rejection)', () => {
    assert.match(handler, /try \{\s*await window\.financeExecuteDelete[\s\S]*\} catch \(err\) \{\s*Notifs\.showToast/);
  });
});
