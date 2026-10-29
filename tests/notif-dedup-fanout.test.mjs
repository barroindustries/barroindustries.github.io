// Notification fan-out vs the notifications rule (create-only for senders).
// sendToOwner / sendToDept / sendToAll write deterministic doc ids derived from a
// dedup key. A set() onto an id that already exists is an UPDATE, which
// firestore.rules denies to anyone but the inbox owner — so:
//   1. two DIFFERENT same-titled sends on one day must get different ids
//      (title-only keys made the second employee's "Cash Advance Request" fail);
//   2. an exact repeat must be skipped quietly, never throw;
//   3. one recipient already holding the doc must not cost everyone else theirs
//      (a batch is all-or-nothing).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../js/notifications.js', import.meta.url), 'utf8');

// A tiny Firestore double that enforces the rule: create OK, overwrite denied.
function makeDb(users) {
  const store = new Map(); // path -> data
  const denied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
  const ref = (path) => ({
    path,
    collection: (c) => ({ doc: (id) => ref(`${path}/${c}/${id}`) }),
    async set(data) { if (store.has(path)) throw denied(); store.set(path, data); },
  });
  const query = (filter) => ({ async get() { return { docs: users.filter(filter).map((u) => ({ id: u.id, data: () => u })) }; } });
  const db = {
    store,
    collection(name) {
      if (name === 'users') {
        return {
          where(field, op, val) {
            return query((u) => (op === 'array-contains' ? (u[field] || []).includes(val) : u[field] === val));
          },
          get: query(() => true).get,
        };
      }
      return { doc: (id) => ref(`${name}/${id}`) };
    },
    batch() {
      const ops = [];
      return {
        set(r, d) { ops.push([r, d]); },
        async commit() {
          if (ops.some(([r]) => store.has(r.path))) throw denied(); // atomic: all or nothing
          ops.forEach(([r, d]) => store.set(r.path, d));
        },
      };
    },
  };
  return db;
}

function load(users) {
  const db = makeDb(users);
  const window = { bizDate: () => '2026-10-29', currentUser: { uid: 'emp-b' } };
  const ctx = vm.createContext({
    window, db, console,
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
    document: {
      addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }),
      head: { appendChild() {} }, body: { appendChild() {} },
    },
    navigator: {}, setTimeout, clearTimeout,
  });
  vm.runInContext(SRC, ctx);
  return { Notifs: window.Notifs, db };
}
const inbox = (db, uid) => [...db.store.keys()].filter((k) => k.startsWith(`notifications/${uid}/items/`));

const USERS = [
  { id: 'pres', role: 'president' },
  { id: 'f1', role: 'finance', department: 'Finance' },
  { id: 'f2', role: 'employee', departments: ['Finance'] },
];

describe('notification fan-out dedup', () => {
  it('two different same-titled sends on one day both reach the owner', async () => {
    const { Notifs, db } = load(USERS);
    await Notifs.sendToOwner({ type: 'cash_advance', title: 'Cash Advance Request', body: 'Ana requested ₱5,000' });
    await Notifs.sendToOwner({ type: 'cash_advance', title: 'Cash Advance Request', body: 'Ben requested ₱3,000' });
    assert.equal(inbox(db, 'pres').length, 2);
  });

  it('an exact repeat is skipped quietly, not thrown', async () => {
    const { Notifs, db } = load(USERS);
    const n = { type: 'leave', title: 'Leave Request', body: 'Ana: 2 days' };
    await Notifs.sendToOwner(n);
    await assert.doesNotReject(Notifs.sendToOwner(n));
    assert.equal(inbox(db, 'pres').length, 1);
  });

  it('a recipient who already holds the doc does not block the rest of the department', async () => {
    const { Notifs, db } = load(USERS);
    const n = { type: 'finance', title: 'Expense', body: 'Diesel ₱1,200', dedupKey: 'expense-42' };
    await Notifs.sendToDept('Finance', n);
    db.store.delete([...db.store.keys()].find((k) => k.startsWith('notifications/f2/')));
    await assert.doesNotReject(Notifs.sendToDept('Finance', n));
    assert.equal(inbox(db, 'f1').length, 1);
    assert.equal(inbox(db, 'f2').length, 1, 'f2 must still receive it although f1 already had it');
  });

  it('the default key stays inside the rules 300-char dedupKey bound', async () => {
    const { Notifs, db } = load(USERS);
    await Notifs.sendToOwner({ type: 'x'.repeat(64), title: 'T'.repeat(200), body: 'B'.repeat(2000) });
    const doc = db.store.get(inbox(db, 'pres')[0]);
    assert.ok(doc.dedupKey.length <= 300, `dedupKey is ${doc.dedupKey.length} chars`);
  });
});
