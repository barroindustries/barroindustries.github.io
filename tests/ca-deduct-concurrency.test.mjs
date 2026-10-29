// tests/ca-deduct-concurrency.test.mjs — payroll CA deduction must not double-apply.
//
// CashAdvance.deduct guards "this month already deducted" by reading the CA's
// payments[]. Done as read-then-batch, two overlapping disburses (Resume
// Disburse in a second tab while the first is still posting) both read "not
// yet" and both wrote: the employee was deducted twice for one month. The fix
// runs the check and the write in one Firestore transaction. The fake db below
// has Firestore's optimistic semantics (a transaction whose read docs changed
// before commit re-runs), and both a plain get() and a batch, so the test also
// fails against the old read-then-batch code.
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

const tick = () => new Promise((r) => setImmediate(r));

function makeDb(docs) {
  const store = new Map(Object.entries(docs).map(([id, d]) => [id, { data: structuredClone(d), v: 0 }]));
  const ref = (id) => ({ id });
  const snap = (id) => { const e = store.get(id); return { exists: !!e, data: () => structuredClone(e.data) }; };
  const apply = (id, patch) => { const e = store.get(id); Object.assign(e.data, patch); e.v++; };
  return {
    store,
    collection: () => ({ doc: (id) => ({ ...ref(id), get: async () => { await tick(); return snap(id); } }) }),
    batch() {
      const ops = [];
      return { update: (r, p) => ops.push([r.id, p]), async commit() { await tick(); ops.forEach(([id, p]) => apply(id, p)); } };
    },
    async runTransaction(fn) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = new Map(), ops = [];
        await fn({
          get: async (r) => { await tick(); reads.set(r.id, store.get(r.id)?.v); return snap(r.id); },
          update: (r, p) => ops.push([r.id, p]),
        });
        await tick();
        if ([...reads].every(([id, v]) => store.get(id)?.v === v)) { ops.forEach(([id, p]) => apply(id, p)); return; }
      }
      throw new Error('transaction contention');
    },
  };
}

function load(db) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const obj = new Function('db', 'window', 'firebase', 'Notifs', 'fmt', '_caRound2', '_caSplitPayment', 'today', 'dbCacheInvalidate',
    `return { ${extract('async deduct(uid, month, plan, actorUid)')} };`)(
    db, { bizDate: () => '2026-10-30' }, { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
    { send: async () => {} }, String, r2, (amt) => ({ principal: amt, interest: 0 }), () => '2026-10-30', () => {});
  return obj;
}

describe('CashAdvance.deduct — one deduction per CA per month', () => {
  it('two overlapping disburses of the same month deduct once', async () => {
    const db = makeDb({ ca1: { balance: 6000, payments: [] } });
    const CA = load(db);
    const plan = [{ caId: 'ca1', amount: 1000 }];
    const [a, b] = await Promise.all([CA.deduct('emp', '2026-10', plan, 'pres'), CA.deduct('emp', '2026-10', plan, 'fin')]);
    const ca = db.store.get('ca1').data;
    assert.equal(ca.balance, 5000, 'balance must drop by ONE month');
    assert.equal(ca.payments.length, 1);
    assert.equal(a.length + b.length, 1, 'exactly one caller reports the deduction (it posts the ledger legs)');
  });

  it('a sequential re-run of the same month is a no-op; the next month deducts', async () => {
    const db = makeDb({ ca1: { balance: 1500, payments: [] } });
    const CA = load(db);
    const plan = [{ caId: 'ca1', amount: 1000 }];
    await CA.deduct('emp', '2026-10', plan);
    assert.deepEqual(await CA.deduct('emp', '2026-10', plan), []);
    const nov = await CA.deduct('emp', '2026-11', plan);
    assert.equal(nov[0].amount, 500, 'clamped to the remaining balance');
    assert.equal(db.store.get('ca1').data.status, 'paid');
  });
});
