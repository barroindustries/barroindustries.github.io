// tests/approval-transitions.test.mjs — js/svc-approvals.js: transitionStatus (compare-and-set on status inside a transaction) and the
// signupApprove claim / Deny "already handled" paths. js/svc-approvals.js is an IIFE onto window, so it is run in a node:vm context
// against an in-memory fake Firestore with runTransaction. Fixtures are fake.
// Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/svc-approvals.js'), 'utf8');

function makeEnv(docs) {
  const store = docs;                       // { 'coll/id': {…} }
  const ref = (coll, id) => ({ coll, id, key: `${coll}/${id}`, update: async (patch) => { store[`${coll}/${id}`] = { ...store[`${coll}/${id}`], ...patch }; } });
  const db = {
    collection: (coll) => ({ doc: (id) => ref(coll, id || 'auto' + Math.random()) }),
    // transactions run serially here, which is all the claim logic needs (Firestore retries on contention)
    async runTransaction(fn) {
      const writes = [];
      const t = {
        get: async (r) => ({ exists: r.key in store, data: () => store[r.key] }),
        update: (r, patch) => writes.push([r, patch]),
      };
      const out = await fn(t);
      writes.forEach(([r, patch]) => { store[r.key] = { ...store[r.key], ...patch }; });
      return out;
    },
  };
  const sandbox = {
    window: { }, db, console,
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
    dbCacheInvalidate() {}, safeNotify: async (f) => f(), Notifs: { send: async () => {}, showToast() {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { sandbox, store, db };
}

describe('transitionStatus', () => {
  it('applies the patch when status matches', async () => {
    const { sandbox, store, db } = makeEnv({ 'tasks/t1': { status: 'review' } });
    const ok = await sandbox.transitionStatus(db.collection('tasks').doc('t1'), 'review', { status: 'approved' });
    assert.equal(ok, true);
    assert.equal(store['tasks/t1'].status, 'approved');
  });
  it('refuses (false, no write) when status is not the expected one', async () => {
    const { sandbox, store, db } = makeEnv({ 'tasks/t1': { status: 'approved', approvedBy: 'u1' } });
    const ok = await sandbox.transitionStatus(db.collection('tasks').doc('t1'), 'review', { status: 'in-progress' });
    assert.equal(ok, false);
    assert.deepEqual({ ...store['tasks/t1'] }, { status: 'approved', approvedBy: 'u1' });
  });
  it('refuses a missing doc', async () => {
    const { sandbox, db } = makeEnv({});
    assert.equal(await sandbox.transitionStatus(db.collection('tasks').doc('nope'), 'review', { status: 'x' }), false);
  });
});

describe('Deny / reject paths report already-handled', () => {
  for (const [type, coll] of [['finance-req', 'payroll_delete_requests'], ['finance-del', 'finance_delete_requests']]) {
    it(`${type} deny returns {already:true} and leaves a resolved request alone`, async () => {
      const { sandbox, store } = makeEnv({ [`${coll}/r1`]: { status: 'approved' } });
      const r = await sandbox.Approvals.dispatch(type, 'deny', 'r1', { currentUser: { uid: 'p' }, name: 'A', month: '2026-01', label: 'L', reqBy: 'u' });
      assert.equal(r.already, true);
      assert.equal(store[`${coll}/r1`].status, 'approved');
    });
    it(`${type} deny on a pending request denies it`, async () => {
      const { sandbox, store } = makeEnv({ [`${coll}/r1`]: { status: 'pending' } });
      const r = await sandbox.Approvals.dispatch(type, 'deny', 'r1', { currentUser: { uid: 'p' } });
      assert.equal(r.already, false);
      assert.equal(store[`${coll}/r1`].status, 'denied');
    });
  }
  it('signup reject refuses a non-pending request', async () => {
    const { sandbox, store } = makeEnv({ 'signup_requests/s1': { status: 'approved' } });
    const r = await sandbox.Approvals.dispatch('signup', 'reject', 's1', {});
    assert.equal(r.already, true);
    assert.equal(store['signup_requests/s1'].status, 'approved');
  });
});

describe('signupApprove claim', () => {
  it('refuses a request that is not pending, or already being approved', async () => {
    for (const d of [{ status: 'rejected' }, { status: 'pending', approving: true }]) {
      const { sandbox, store } = makeEnv({ 'signup_requests/s1': d });
      const r = await sandbox.Approvals.dispatch('signup', 'approve', 's1', { name: 'A B', email: 'a@x.test', phone: '1', currentUser: { uid: 'p' } });
      assert.equal(r.already, true);
      assert.equal(store['signup_requests/s1'].createdUid, undefined);
    }
  });
  it('a failure after claiming clears approving so it can be retried', async () => {
    const { sandbox, store } = makeEnv({ 'signup_requests/s1': { status: 'pending' } });
    sandbox.generatePassword = () => { throw new Error('boom'); };
    await assert.rejects(() => sandbox.Approvals.dispatch('signup', 'approve', 's1', { name: 'A B', email: 'a@x.test', phone: '1', currentUser: { uid: 'p' } }), /boom/);
    assert.equal(store['signup_requests/s1'].approving, false);
    assert.equal(store['signup_requests/s1'].status, 'pending');
  });
});
