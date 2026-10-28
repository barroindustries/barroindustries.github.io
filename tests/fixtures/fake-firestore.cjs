// tests/fixtures/fake-firestore.cjs — a small, STRICT in-memory stand-in for the slice of firebase-admin that
// functions/index.js's callables use, so tests/quote-request-callables.test.mjs can run the REAL callable code
// (rate limits, sessions, transactions, notifications) with no emulator and no network.
//
// It is deliberately not generous. Like the real Admin SDK it
//   - REJECTS `undefined` anywhere in a written document (the classic "Cannot use undefined as a Firestore value");
//   - throws code 6 ALREADY_EXISTS from create() on an existing doc and code 5 NOT_FOUND from update() on a missing one;
//   - applies a transaction ATOMICALLY and only when the callback RETURNS: a throw from the callback discards every
//     staged write (the exact behaviour behind STATUS 2026-09-26's portalUnlock lesson);
//   - turns FieldValue.serverTimestamp() into a Timestamp-like with toMillis()/toDate() taken from Date.now() at write time
//     (tests mock Date, so server time is controllable).
// Supported surface: collection().doc().{get,set,create,update,delete,collection,listCollections}, collection().add(),
// collection().listDocuments() (missing parents included, as in Firestore),
// where(field,'==' | 'array-contains',v), orderBy(field,dir), limit(n), get(), runTransaction, batch,
// FieldValue.serverTimestamp, FieldValue.delete (an update() key whose value is delete() removes that field, dotted
// paths included — cirRemovePhoto uses it), admin.storage().bucket() as inert stubs (a test that needs real objects
// replaces `fake.admin.storage` before loading the functions).
'use strict';

class FakeTimestamp {
  constructor(ms) { this._ms = ms; }
  toMillis() { return this._ms; }
  toDate() { return new Date(this._ms); }
}
const SERVER_TS = Object.freeze({ __sentinel: 'serverTimestamp' });
const DELETE_FIELD = Object.freeze({ __sentinel: 'deleteField' });

function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (v instanceof FakeTimestamp) return new FakeTimestamp(v._ms);
  if (v === SERVER_TS || v === DELETE_FIELD) return v;
  if (Array.isArray(v)) return v.map(clone);
  const o = {};
  for (const k of Object.keys(v)) o[k] = clone(v[k]);
  return o;
}

function assertWritable(v, where) {
  if (v === undefined) throw new Error(`Cannot use "undefined" as a Firestore value (found at ${where}). Use null or omit the field.`);
  if (v === null || typeof v !== 'object' || v === SERVER_TS || v === DELETE_FIELD || v instanceof FakeTimestamp) return;
  if (Array.isArray(v)) { v.forEach((x, i) => { if (Array.isArray(x)) throw new Error(`Nested arrays are not supported (at ${where}[${i}])`); assertWritable(x, `${where}[${i}]`); }); return; }
  for (const k of Object.keys(v)) assertWritable(v[k], `${where}.${k}`);
}

function resolveSentinels(v, nowMs) {
  if (v === SERVER_TS) return new FakeTimestamp(nowMs);
  if (v === DELETE_FIELD) return v;
  if (v === null || typeof v !== 'object' || v instanceof FakeTimestamp) return v;
  if (Array.isArray(v)) return v.map((x) => resolveSentinels(x, nowMs));
  const o = {};
  for (const k of Object.keys(v)) o[k] = resolveSentinels(v[k], nowMs);
  return o;
}

function err(code, name, message) {
  const e = new Error(message);
  e.code = code; e.status = name;
  return e;
}

function sortKey(v) { return v instanceof FakeTimestamp ? v._ms : v; }

function createFake() {
  let store = new Map();                       // path -> data
  const ver = new Map();                       // path -> write counter (optimistic concurrency, like Firestore's)
  const bump = (path) => ver.set(path, (ver.get(path) || 0) + 1);
  let autoId = 0;
  const stats = { collectionGets: {}, docGets: {}, writes: 0, txRetries: 0 };

  const idOf = (p) => p.slice(p.lastIndexOf('/') + 1);
  const parentOf = (p) => p.slice(0, p.lastIndexOf('/'));

  function snapshot(path, data) {
    const exists = data !== undefined;
    return {
      id: idOf(path), exists, ref: docRef(path),
      data: () => (exists ? clone(data) : undefined),
      get: (f) => (exists ? clone(data[f]) : undefined),
    };
  }

  function applyWrite(map, op) {
    const { kind, path } = op;
    const nowMs = Date.now();
    if (kind === 'delete') { map.delete(path); return; }
    assertWritable(op.data, path);
    const data = resolveSentinels(clone(op.data), nowMs);
    if (kind === 'create') {
      if (map.has(path)) throw err(6, 'ALREADY_EXISTS', `Document already exists: ${path}`);
      map.set(path, data);
    } else if (kind === 'set') {
      if (op.merge && map.has(path)) map.set(path, Object.assign({}, map.get(path), data));
      else map.set(path, data);
    } else if (kind === 'update') {
      if (!map.has(path)) throw err(5, 'NOT_FOUND', `No document to update: ${path}`);
      const cur = clone(map.get(path));
      for (const k of Object.keys(data)) {
        if (k.indexOf('.') < 0) { if (data[k] === DELETE_FIELD) delete cur[k]; else cur[k] = data[k]; continue; }
        const parts = k.split('.');
        let o = cur;
        for (let i = 0; i < parts.length - 1; i++) { if (typeof o[parts[i]] !== 'object' || o[parts[i]] === null) o[parts[i]] = {}; o = o[parts[i]]; }
        if (data[k] === DELETE_FIELD) delete o[parts[parts.length - 1]]; else o[parts[parts.length - 1]] = data[k];
      }
      map.set(path, cur);
    }
    stats.writes++;
  }

  function docRef(path) {
    return {
      id: idOf(path), path,
      get parent() { return collRef(parentOf(path)); },
      collection: (name) => collRef(`${path}/${name}`),
      // Like Firestore: every subcollection that has at least one document anywhere beneath it.
      async listCollections() {
        const ids = new Set();
        for (const p of store.keys()) if (p.startsWith(path + '/')) ids.add(p.slice(path.length + 1).split('/')[0]);
        return [...ids].map((id) => collRef(`${path}/${id}`));
      },
      async get() { stats.docGets[path] = (stats.docGets[path] || 0) + 1; return snapshot(path, store.get(path)); },
      async set(data, opts) { applyWrite(store, { kind: 'set', path, data, merge: !!(opts && opts.merge) }); bump(path); },
      async create(data) { applyWrite(store, { kind: 'create', path, data }); bump(path); },
      async update(data) { applyWrite(store, { kind: 'update', path, data }); bump(path); },
      async delete() { applyWrite(store, { kind: 'delete', path }); bump(path); },
    };
  }

  function collRef(path, q) {
    const query = q || { filters: [], order: null, lim: null };
    const self = {
      id: idOf(path), path,
      doc: (id) => docRef(`${path}/${id || ('auto' + (++autoId))}`),
      async add(data) { const r = self.doc(); await r.create(data); return r; },
      // Like Firestore's listDocuments(): EVERY document ref in the collection, including "missing" parents —
      // ids that hold no document themselves but have documents beneath them (attendance/{uid} above
      // attendance/{uid}/records/{date}). get() above, like the real one, returns only documents that exist.
      async listDocuments() {
        const ids = new Set();
        for (const p of store.keys()) if (p.startsWith(path + '/')) ids.add(p.slice(path.length + 1).split('/')[0]);
        return [...ids].map((id) => docRef(`${path}/${id}`));
      },
      where: (field, op, value) => collRef(path, { ...query, filters: query.filters.concat([{ field, op, value }]) }),
      orderBy: (field, dir) => collRef(path, { ...query, order: { field, dir: dir || 'asc' } }),
      limit: (n) => collRef(path, { ...query, lim: n }),
      async get() {
        stats.collectionGets[path] = (stats.collectionGets[path] || 0) + 1;
        let rows = [];
        for (const [p, data] of store) {
          if (parentOf(p) !== path) continue;
          let ok = true;
          for (const f of query.filters) {
            const v = data[f.field];
            if (f.op === '==') ok = ok && (v === f.value || (v instanceof FakeTimestamp && f.value instanceof FakeTimestamp && v._ms === f.value._ms));
            else if (f.op === 'array-contains') ok = ok && Array.isArray(v) && v.indexOf(f.value) >= 0;
            else throw new Error(`fake-firestore: unsupported operator ${f.op}`);
          }
          if (ok) rows.push([p, data]);
        }
        if (query.order) {
          const { field, dir } = query.order;
          rows = rows.filter(([, d]) => d[field] !== undefined);          // a missing field is excluded from an orderBy
          rows.sort((a, b) => { const x = sortKey(a[1][field]), y = sortKey(b[1][field]); return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1); });
        }
        if (query.lim != null) rows = rows.slice(0, query.lim);
        const docs = rows.map(([p, d]) => snapshot(p, d));
        return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
      },
    };
    return self;
  }

  // Like Firestore: the callback may run several times. Every read records the path's version; if any of them changed
  // before commit (another writer got there first) the callback is RE-RUN from the top. A throw from the callback
  // rejects the transaction and discards every staged write.
  async function runTransaction(fn) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const staged = [];
      const reads = new Map();
      const tx = {
        async get(ref) { reads.set(ref.path, ver.get(ref.path) || 0); return snapshot(ref.path, store.get(ref.path)); },
        create(ref, data) { staged.push({ kind: 'create', path: ref.path, data }); return tx; },
        set(ref, data, opts) { staged.push({ kind: 'set', path: ref.path, data, merge: !!(opts && opts.merge) }); return tx; },
        update(ref, data) { staged.push({ kind: 'update', path: ref.path, data }); return tx; },
        delete(ref) { staged.push({ kind: 'delete', path: ref.path }); return tx; },
      };
      const result = await fn(tx);
      let stale = false;
      for (const [p, v] of reads) if ((ver.get(p) || 0) !== v) stale = true;
      if (stale) { stats.txRetries++; continue; }
      const next = new Map(store);
      for (const op of staged) applyWrite(next, op);      // atomic: a failing op leaves `store` untouched
      store = next;
      for (const op of staged) bump(op.path);
      return result;
    }
    throw err(10, 'ABORTED', 'Too much contention on these documents.');
  }

  function batch() {
    const staged = [];
    const b = {
      set(ref, data, opts) { staged.push({ kind: 'set', path: ref.path, data, merge: !!(opts && opts.merge) }); return b; },
      create(ref, data) { staged.push({ kind: 'create', path: ref.path, data }); return b; },
      update(ref, data) { staged.push({ kind: 'update', path: ref.path, data }); return b; },
      delete(ref) { staged.push({ kind: 'delete', path: ref.path }); return b; },
      async commit() { const next = new Map(store); for (const op of staged) applyWrite(next, op); store = next; for (const op of staged) bump(op.path); },
    };
    return b;
  }

  const db = {
    collection: (name) => collRef(name), runTransaction, batch,
    // Root collections that hold at least one document anywhere beneath them (Admin SDK listCollections()).
    async listCollections() { return [...new Set([...store.keys()].map((p) => p.split('/')[0]))].map((id) => collRef(id)); },
  };

  // test helpers
  const fake = {
    db, stats,
    seed(path, data) { store.set(path, resolveSentinels(clone(data), Date.now())); bump(path); },
    read(path) { const d = store.get(path); return d === undefined ? undefined : clone(d); },
    has: (path) => store.has(path),
    list(collection) { const out = []; for (const [p, d] of store) if (parentOf(p) === collection) out.push({ id: idOf(p), data: clone(d) }); return out; },
    paths(prefix) { return [...store.keys()].filter((p) => p.startsWith(prefix)); },
    reset() { store = new Map(); ver.clear(); autoId = 0; stats.collectionGets = {}; stats.docGets = {}; stats.writes = 0; stats.txRetries = 0; },
    FakeTimestamp,
    // the module the tests splice in for require('firebase-admin')
    admin: null,
  };
  const FieldValue = { serverTimestamp: () => SERVER_TS, delete: () => DELETE_FIELD };
  const firestore = Object.assign(() => db, { FieldValue });
  const bucket = { file: () => ({ save: async () => {}, move: async () => {}, delete: async () => {} }), deleteFiles: async () => {} };
  fake.admin = { initializeApp() {}, credential: { cert: () => ({}) }, firestore, storage: () => ({ bucket: () => bucket }), auth: () => ({}), messaging: () => ({}) };
  return fake;
}

module.exports = { createFake, FakeTimestamp };
