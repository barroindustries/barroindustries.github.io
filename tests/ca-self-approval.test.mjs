// tests/ca-self-approval.test.mjs — separation of duties on cash advances.
//
// A manager / finance approver could file their own cash advance and then
// approve it (choosing 0% interest and the bank account): nothing compared the
// requester with the approver, and the rules let any money-admin update any CA.
// CashAdvance.approve now refuses a self-approval unless the approver is the
// President. The method is extracted from js/config.js by source (the file is
// a browser script with no module shim, see tests/cash-advance.test.mjs).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');

function extractMethod(sig) {
  const start = SRC.indexOf(sig);
  assert.ok(start >= 0, `js/config.js no longer has "${sig}" — update this test, don't delete it`);
  let depth = 0;
  for (let i = SRC.indexOf('{', SRC.indexOf(')', start)); i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(start, i + 1);
  }
  throw new Error('unbalanced braces');
}

function makeApprove({ requester, me, role }) {
  const updates = [];
  const db = {
    collection: () => ({
      doc: () => ({}),
      where: () => ({ limit: () => ({ get: async () => ({ docs: [{}] }) }) }), // ledger dupe → skip add
    }),
    runTransaction: async (fn) => fn({
      get: async () => ({ exists: true, data: () => ({ status: 'pending', userId: requester, amount: 5000, terms: 2, userName: 'X' }) }),
      update: (_ref, patch) => updates.push(patch),
    }),
  };
  const window = { currentUser: { uid: me }, currentRole: role, BankAccounts: { tag: () => ({}) } };
  const firebase = { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } };
  const Notifs = { send: async () => {} };
  const obj = new Function('db', 'window', 'firebase', 'Notifs', 'fmt', '_caRound2', 'dbCacheInvalidate',
    `return { ${extractMethod('async approve(id, { interestPct')} };`)(
    db, window, firebase, Notifs, (n) => String(n), (n) => Math.round(n * 100) / 100, () => {});
  return { approve: (id) => obj.approve(id, { interestPct: 0 }), updates };
}

describe('CashAdvance.approve — no self-approval', () => {
  it('a manager cannot approve their own cash advance', async () => {
    const { approve, updates } = makeApprove({ requester: 'mgr', me: 'mgr', role: 'manager' });
    await assert.rejects(approve('ca1'), /cannot approve your own/);
    assert.equal(updates.length, 0, 'nothing may be written');
  });

  it('finance cannot approve their own either', async () => {
    const { approve } = makeApprove({ requester: 'fin', me: 'fin', role: 'finance' });
    await assert.rejects(approve('ca1'), /cannot approve your own/);
  });

  it("a manager can approve someone else's", async () => {
    const { approve, updates } = makeApprove({ requester: 'emp', me: 'mgr', role: 'manager' });
    await approve('ca1');
    assert.equal(updates[0].status, 'approved');
  });

  it('the President may approve their own', async () => {
    const { approve, updates } = makeApprove({ requester: 'pres', me: 'pres', role: 'president' });
    await approve('ca1');
    assert.equal(updates[0].status, 'approved');
  });
});
