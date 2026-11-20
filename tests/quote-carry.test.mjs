// tests/quote-carry.test.mjs — SALES-FLOW-SPEC-2026-11-19 Phase 3 (§6): P1 on quote revisions.
//
// What it pins:
//   1. APPROVE     decideQuoteApproval (js/screens/approvals.js) writes approvedSnapshot + approvedByName in the ONE update, from priceCheck when present else total + items; the
//                  President's money edits make a stale priceCheck count for nothing; a return writes neither; a snapshot that cannot be built never blocks the approval.
//   2. BRIDGE      js/app.js (the REAL listener, lifted whole, against an in-memory Firestore and the REAL js/price-gate-core.js):
//                  a higher / equal revision files approved-carried (+ the FYI to the President in the R style); a lower one with unknown cost goes to him with the reason; with priceCheck a cut that
//                  stays above standard carries; approveAll ON never carries; a builder that disagrees, a failed chain read, a quote the builder already sent for approval -> the President; carried
//                  approvals never move the bar; nothing approved by the President in the chain / the President himself / a first quote -> filed as today; priceCheck is stored sanitised.
//   3. UPDATE      QUOTE_UPDATE on an approved source is refused and filed as a new revision (R+1 from the highest suffix); on any other source it still updates in place.
//   4. RULES       C3 in firestore.rules (bk_quotes, bs_quotes): textual pins.
//   5. BADGE       "Approved (carried)" on the quote rows and cards.
//   6. WIRING      price-gate-core.js is eager (app kit, right after sales-flow-core.js, precached under its ?v= URL) and contract-ui no longer double-loads it.
// Fixtures are FAKE. Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const APP = read('js/app.js'), CONFIG = read('js/config.js'), APPROVALS = read('js/screens/approvals.js'), SALES = read('js/screens/sales.js'), SVC = read('js/svc-approvals.js');
const RULES = read('firestore.rules'), HTML = read('index.html'), SW = read('sw.js'), PG_SRC = read('js/price-gate-core.js');
const piece = (src, re, what) => { const m = src.match(re); assert.ok(m, `${what} not found`); return m[0]; };
const appFn = (name) => piece(APP, new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`, 'm'), `${name} in js/app.js`);
const cfgPiece = (name) => piece(CONFIG, new RegExp(`^window\\.${name} = function[\\s\\S]*?\\n\\};`, 'm'), `window.${name} in js/config.js`);
const FV = { serverTimestamp: () => ({ __ts: true }), increment: (n) => ({ __inc: n }) };
const ORIGIN = 'https://app.test';
const ROOT_ID = 'qdROOT0000000000001';
const NEIL = 'u-neil';
const ts = (iso) => ({ toDate: () => new Date(iso), __iso: iso });

// ── an in-memory Firestore: docs by 'coll/id', where() chains filter on equality, every write recorded ──────────────────────────────────────────
function makeDb(opts) {
  opts = opts || {};
  const store = new Map(Object.entries(opts.docs || {}).map(([k, v]) => [k, v]));
  const adds = [], updates = [], queries = [], ops = []; let seq = 0;
  const snap = (coll, id) => ({ exists: store.has(coll + '/' + id), id, data: () => plain(store.get(coll + '/' + id)) });
  const docRef = (coll, id) => ({ id,
    get: async () => { ops.push('get ' + coll + '/' + id); if (opts.failSource && coll + '/' + id === opts.failSource) throw new Error('read failed'); return snap(coll, id); },
    update: async (patch) => { ops.push('update ' + coll + '/' + id); updates.push({ coll, id, patch }); store.set(coll + '/' + id, Object.assign({}, store.get(coll + '/' + id), patch)); },
    set: async (b) => { ops.push('set ' + coll + '/' + id); store.set(coll + '/' + id, b); },
    delete: async () => { ops.push('delete ' + coll + '/' + id); store.delete(coll + '/' + id); },
  });
  const db = { collection: (coll) => ({
    doc: (id) => docRef(coll, id),
    add: async (data) => { ops.push('add ' + coll); const id = 'qdNEW' + String(++seq).padStart(15, '0'); adds.push({ coll, id, data }); store.set(coll + '/' + id, data); return docRef(coll, id); },
    where: (f, o, v) => { const filters = [[f, o, v]]; const q = {
      where: (f2, o2, v2) => { filters.push([f2, o2, v2]); return q; },
      get: async () => { queries.push({ coll, filters: filters.map((x) => x.slice()) }); if (opts.failChain && coll === 'bk_quotes' || (opts.failChain && coll === 'bs_quotes')) throw new Error('chain read failed');
        const docs = [...store.entries()].filter(([k, d]) => k.startsWith(coll + '/') && filters.every(([ff, , vv]) => d[ff] === vv)).map(([k, d]) => ({ id: k.slice(coll.length + 1), data: () => plain(d) })); return { docs }; } }; return q; },
  }) };
  return { db, store, adds, updates, queries, ops };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('1 · decideQuoteApproval writes what was approved (approvedSnapshot, approvedByName) in the ONE update', () => {
  const CODE = piece(APPROVALS, /^const _qaInFlight = new Set\(\);[\s\S]*?\nwindow\.decideQuoteApproval = decideQuoteApproval;/m, 'decideQuoteApproval');
  function make(docs, opts) {
    opts = opts || {};
    const D = makeDb({ docs });
    const win = { quoteStateFields: (s) => ({ approved: { status: 'filed', approvalStatus: 'approved' }, needs_revision: { status: 'needs_revision', approvalStatus: 'needs_revision' } })[s],
      syncQuoteStatusToRequest: async () => true, QuoteThread: { add: async () => ({ ok: true }) }, quoteApprovalRefOf: () => 'bk.x', logAudit: () => {}, invalidateBsQuotesCache: () => {} };
    if (!opts.noGate) win.PriceGate = null;
    const ctx = vm.createContext({ window: win, db: D.db, firebase: { firestore: { FieldValue: FV } }, console: { log() {}, warn() {}, error() {} }, Date,
      currentUser: { uid: NEIL, email: 'neil@example.test' }, userProfile: { displayName: 'Neil Test' }, currentRole: 'president', navigator: { onLine: true },
      Notifs: { showToast() {}, success() {}, error() {}, send: async () => {} }, dbCacheInvalidate: () => {} });
    if (!opts.noGate) vm.runInContext(PG_SRC, ctx);
    vm.runInContext(CODE, ctx);
    return Object.assign(D, { win, decide: (o) => win.decideQuoteApproval(Object.assign({ coll: 'bk_quotes', quoteId: 'q1', action: 'approve' }, o || {})) });
  }
  const pending = (over) => Object.assign({ approvalStatus: 'pending_review', status: 'pending_approval', quoteNumber: 'BKZZ-001R1', createdBy: 'u-sales', total: 100000,
    items: [{ name: 'Sink', dimensions: '1x1', unit: 'pc', qty: 2, unitPrice: 30000 }, { name: 'Table', qty: 1, price: 40000 }] }, over || {});
  const patchOf = (S) => S.updates.find((u) => u.coll === 'bk_quotes' && u.id === 'q1').patch;

  it('approve: approvedSnapshot { total, lines:[{key,unit}], at, by, byName, quoteNumber } from the quote\'s total and items, and approvedByName, in the same update as the state', async () => {
    const S = make({ 'bk_quotes/q1': pending() });
    assert.deepEqual(plain(await S.decide()), { ok: true });
    assert.equal(S.updates.filter((u) => u.coll === 'bk_quotes').length, 1, 'ONE quote update');
    const p = patchOf(S);
    assert.equal(p.approvalStatus, 'approved'); assert.equal(p.approvedBy, NEIL); assert.equal(p.approvedByName, 'Neil Test');
    const sn = plain(p.approvedSnapshot);
    assert.deepEqual(Object.keys(sn).sort(), ['at', 'by', 'byName', 'lines', 'quoteNumber', 'total']);
    assert.equal(sn.total, 100000); assert.equal(sn.by, NEIL); assert.equal(sn.byName, 'Neil Test'); assert.equal(sn.quoteNumber, 'BKZZ-001R1');
    assert.match(sn.at, /^\d{4}-\d\d-\d\dT/);
    assert.deepEqual(sn.lines.map((l) => l.unit), [30000, 40000]);
    assert.ok(sn.lines.every((l) => typeof l.key === 'string' && l.key.length));
  });
  it('priceCheck, when the quote has one, is the source of the snapshot (its lines and its total)', async () => {
    const pc = { v: 1, source: 'kc', basis: 'net', total: 88000, stdTotal: 70000, lines: [{ key: 'L1', name: 'Hood', qty: 1, unit: 88000, std: 70000, mode: 'cost' }] };
    const S = make({ 'bk_quotes/q1': pending({ priceCheck: pc }) });
    await S.decide();
    const sn = plain(patchOf(S).approvedSnapshot);
    assert.equal(sn.total, 88000); assert.deepEqual(sn.lines, [{ key: 'L1', unit: 88000 }]);
  });
  it('the President\'s money edits count: the snapshot is of the edited quote, and a priceCheck the edits made stale is ignored', async () => {
    const pc = { v: 1, source: 'kc', basis: 'net', total: 88000, stdTotal: null, lines: [{ key: 'L1', unit: 88000, std: null, mode: 'unknown' }] };
    const S = make({ 'bk_quotes/q1': pending({ priceCheck: pc }) });
    await S.decide({ edits: { total: 91000, items: [{ name: 'Hood', qty: 1, unitPrice: 91000 }] } });
    const sn = plain(patchOf(S).approvedSnapshot);
    assert.equal(sn.total, 91000); assert.deepEqual(sn.lines.map((l) => l.unit), [91000]); assert.notEqual(sn.lines[0].key, 'L1');
    // an edit that does not touch the money keeps the priceCheck
    const T = make({ 'bk_quotes/q1': pending({ priceCheck: pc }) });
    await T.decide({ edits: { clientName: 'Mira Test' } });
    assert.equal(plain(patchOf(T).approvedSnapshot).total, 88000);
  });
  it('a return writes neither field; a quote that is not waiting writes nothing at all', async () => {
    const S = make({ 'bk_quotes/q1': pending() });
    await S.decide({ action: 'return' });
    const p = patchOf(S);
    assert.equal('approvedSnapshot' in p, false); assert.equal('approvedByName' in p, false); assert.equal('approvedBy' in p, false);
    const T = make({ 'bk_quotes/q1': pending({ approvalStatus: 'approved', status: 'filed' }) });
    assert.equal((await T.decide()).reason, 'state'); assert.equal(T.updates.length, 0);
  });
  it('a snapshot that cannot be built (the gate not loaded, or it throws) never blocks the approval: the state is still written, with the name', async () => {
    const S = make({ 'bk_quotes/q1': pending() }, { noGate: true });
    assert.deepEqual(plain(await S.decide()), { ok: true });
    const p = patchOf(S); assert.equal(p.approvalStatus, 'approved'); assert.equal(p.approvedByName, 'Neil Test'); assert.equal('approvedSnapshot' in p, false);
    const T = make({ 'bk_quotes/q1': pending() }); T.win.PriceGate.snapshotFromQuote = () => { throw new Error('boom'); };
    assert.deepEqual(plain(await T.decide()), { ok: true }); assert.equal('approvedSnapshot' in patchOf(T), false);
  });
  it('the snapshot is written in ONE place: approvals.js decideQuoteApproval', () => {
    assert.equal((APPROVALS.match(/approvedSnapshot/g) || []).length >= 1, true);
    const outside = APPROVALS.replace(CODE, '');
    assert.equal(/approvedSnapshot\s*[:=]|approvedSnapshot\s*=/.test(outside), false, 'no other writer in approvals.js');
    for (const f of ['js/screens/quote-approval.js', 'js/departments.js', 'js/modules.js']) assert.equal(/approvedSnapshot\s*:/.test(read(f)), false, f);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('2 · the builder bridge (js/app.js, listener lifted whole): carry or send to the President', () => {
  const LISTENER = (() => {
    const start = APP.indexOf("window.addEventListener('message', async (e) => {", APP.indexOf('Quote Builder iframe → Firestore bridge'));
    const end = APP.indexOf('\n});', start);
    return APP.slice(start, end + 4);
  })();
  const CODE = [cfgPiece('quoteApprovalRefOf'), piece(APP, /^const QB_SOURCE_REF_RE = .*;$/m, 'QB_SOURCE_REF_RE'),
    ...['_qbCleanSourceRef', '_qbCleanEstimateCheck', '_qbCleanApprovalWhy', '_qbCleanPriceCheck', '_qbChainQuotes', '_qbRevOf', '_qbGateText', '_qbChainGate'].map(appFn),
    piece(SVC, /^window\.QuoteThread = \{[\s\S]*?\n\};/m, 'window.QuoteThread'), LISTENER].join('\n');
  const APPROVED_AT = '2026-11-10T02:00:00.000Z';
  // a chain: the root, approved by the President at 100000 (a snapshot, as decideQuoteApproval writes it)
  const root = (over) => Object.assign({ company: 'BK', quoteNumber: 'BKZZ-007R1', rootQuoteId: ROOT_ID, createdBy: 'u-sales', status: 'filed', approvalStatus: 'approved', approvedBy: NEIL, approvedAt: ts(APPROVED_AT),
    total: 100000, items: [{ name: 'Sink', unitPrice: 100000, qty: 1 }], approvedSnapshot: { total: 100000, lines: [{ key: 'sink||', unit: 100000 }], at: APPROVED_AT, by: NEIL, byName: 'Neil Test', quoteNumber: 'BKZZ-007R1' } }, over || {});
  const chainDocs = (extra) => Object.assign({ ['bk_quotes/' + ROOT_ID]: root() }, extra || {});

  function makeBridge(opts) {
    opts = opts || {};
    const D = makeDb(opts);
    const FRAME = {}, listeners = [], toasts = [], notified = [];
    const win = { location: { origin: ORIGIN }, addEventListener: (t, f) => { if (t === 'message') listeners.push(f); }, QUOTE_COLLECTIONS: ['bk_quotes', 'bs_quotes'], quoteCollectionFor: (co) => (co === 'BS' ? 'bs_quotes' : 'bk_quotes'),
      quoteStateFields: (s) => ({ filed: { status: 'filed', approvalStatus: 'filed' }, pending_approval: { status: 'pending_approval', approvalStatus: 'pending_review' }, approved: { status: 'filed', approvalStatus: 'approved' } })[s],
      Clients: { upsertFromQuote: async () => 'client_1' }, linkQuoteToRequest: async () => true, fmtN2: (n) => String(n), logAudit: () => {}, showQuoteApprovalLink: () => {}, resyncPublicQuoteMirror: async () => {} };
    const ctx = vm.createContext({ window: win, db: D.db, console: { log() {}, error() {}, warn() {} }, Date,
      document: { getElementById: (id) => (id === 'qb-frame' ? { contentWindow: FRAME } : null) }, firebase: { firestore: { FieldValue: FV } },
      currentUser: { uid: opts.uid || 'u-sales', email: 'sales@example.test' }, userProfile: { displayName: 'Sales Tester' }, currentRole: opts.role || 'employee',
      Notifs: { showToast: (m, t) => toasts.push({ m, t }), success: (m) => toasts.push({ m, t: 'success' }), sendToOwner: async (n) => { D.ops.push('notify owner'); notified.push(plain(n)); } },
      dbCacheInvalidate: () => {}, saveCostSidecar: async () => {}, deleteCostSidecar: async () => {} });
    vm.runInContext(PG_SRC, ctx);
    vm.runInContext(CODE, ctx);
    const send = async (type, payload, extra) => { await listeners[0]({ origin: ORIGIN, source: FRAME, data: Object.assign({ type, payload }, extra || {}) }); };
    return Object.assign(D, { win, toasts, notified, send });
  }
  const rev = (over) => Object.assign({ company: 'BK', quoteNumber: 'BKZZ-007R3', clientName: 'Mira Santos', total: 120000, grandTotal: 120000, items: [{ name: 'Sink', unitPrice: 120000, qty: 1 }],
    editableState: {}, rootQuoteId: ROOT_ID, parentQuoteId: ROOT_ID }, over || {});
  const lastAdd = (S) => S.adds.find((a) => a.coll === 'bk_quotes');
  const toNeil = (S) => { const a = lastAdd(S); return a.data.approvalStatus === 'pending_review' && S.ops.includes('add approval_requests'); };

  it('a HIGHER revision files approved-carried: state approved, approvalCarriedFrom = the doc Neil approved, approvalCarriedAt, no approvedBy / snapshot, no approval request', async () => {
    const S = makeBridge({ docs: chainDocs() });
    await S.send('QUOTE_FILED', rev());
    const d = lastAdd(S).data;
    assert.deepEqual([d.status, d.approvalStatus], ['filed', 'approved']);
    assert.equal(d.approvalCarriedFrom, ROOT_ID); assert.deepEqual(plain(d.approvalCarriedAt), { __ts: true }); assert.equal(d.approvalCarriedOn, APPROVED_AT);
    for (const k of ['approvedBy', 'approvedAt', 'approvedSnapshot', 'approvedByName']) assert.equal(k in d, false, k + ' is Neil\'s alone');
    assert.equal(S.ops.includes('add approval_requests'), false);
    assert.equal(d.rootQuoteId, ROOT_ID);
  });
  it('the FYI: Neil is told once, type quote_carried, in the R style ("R3", never "Rev."), from-to amounts, the date of his approval, "No action needed" — and NOT also "Quote Filed"', async () => {
    const S = makeBridge({ docs: chainDocs() });
    await S.send('QUOTE_FILED', rev());
    assert.equal(S.notified.length, 1);
    const n = S.notified[0];
    assert.equal(n.type, 'quote_carried'); assert.match(n.title, /Quote revision filed \(no action\)/);
    assert.match(n.body, /^Sales Tester: R3 of BKZZ-007R3 filed under your approval of (Nov 10, 2026|10 Nov 2026): ₱100000 → ₱120000\. No action needed\.$/);
    assert.equal(/Rev\./.test(n.title + n.body), false);
    assert.equal(n.link, 'bk-quotations');
  });
  it('an EQUAL price carries too (equal is never "below")', async () => {
    const S = makeBridge({ docs: chainDocs() });
    await S.send('QUOTE_FILED', rev({ total: 100000, grandTotal: 100000, items: [{ name: 'Sink', unitPrice: 100000, qty: 1 }] }));
    assert.equal(lastAdd(S).data.approvalStatus, 'approved');
  });
  it('a LOWER revision with the cost unknown goes to Neil: pending review, an approval request, the reasons in approvalWhy and in his notification — whatever the tick said', async () => {
    const S = makeBridge({ docs: chainDocs() });
    await S.send('QUOTE_FILED', rev({ total: 90000, grandTotal: 90000, items: [{ name: 'Sink', unitPrice: 90000, qty: 1 }] }));
    const d = lastAdd(S).data;
    assert.deepEqual([d.status, d.approvalStatus], ['pending_approval', 'pending_review']);
    assert.ok(toNeil(S));
    assert.equal('approvalCarriedFrom' in d, false);
    assert.match(d.approvalWhy.text, /Price check: Total ₱90000 is below the ₱100000 you approved, cost unknown; /);
    assert.match(d.approvalWhy.text, /Sink ₱90000 is below the ₱100000 you approved, cost unknown/);
    assert.equal(d.approvalWhy.ticked, false);
    assert.equal(S.notified.length, 1);
    assert.equal(S.notified[0].type, 'quote_review_request'); assert.match(S.notified[0].body, /please review\. Price check: Total ₱90000/);
    assert.match(S.notified[0].link, /^quote-approval\/bk\./);
  });
  it('with priceCheck present, a cut that stays ABOVE standard still carries; one below standard goes to Neil with the standard in the reason', async () => {
    const pc = (total, std) => ({ v: 1, source: 'kc', basis: 'net', total, stdTotal: std, lines: [{ key: 'sink||', name: 'Sink', qty: 1, unit: total, std, mode: 'cost' }] });
    const S = makeBridge({ docs: chainDocs() });
    await S.send('QUOTE_FILED', rev({ total: 95000, grandTotal: 95000, priceCheck: pc(95000, 90000) }));
    assert.equal(lastAdd(S).data.approvalStatus, 'approved', 'a cut, but above cost x 2');
    const T = makeBridge({ docs: chainDocs() });
    await T.send('QUOTE_FILED', rev({ total: 85000, grandTotal: 85000, priceCheck: pc(85000, 90000) }));
    assert.equal(lastAdd(T).data.approvalStatus, 'pending_review');
    assert.match(lastAdd(T).data.approvalWhy.text, /below the ₱100000 you approved, and below the standard ₱90000/);
  });
  it('a PER-LINE trip goes to Neil even when the total holds (S13): one item cut under standard while another carries the total', async () => {
    const S = makeBridge({ docs: { ['bk_quotes/' + ROOT_ID]: root({ total: 100000, approvedSnapshot: { total: 100000, lines: [{ key: 'a', unit: 50000 }, { key: 'b', unit: 50000 }], at: APPROVED_AT, by: NEIL, byName: 'N', quoteNumber: 'x' } }) } });
    const pc = { v: 1, source: 'kc', basis: 'net', total: 100000, stdTotal: 90000, lines: [{ key: 'a', name: 'A', qty: 1, unit: 30000, std: 45000, mode: 'cost' }, { key: 'b', name: 'B', qty: 1, unit: 70000, std: 45000, mode: 'cost' }] };
    await S.send('QUOTE_FILED', rev({ total: 100000, grandTotal: 100000, priceCheck: pc }));
    assert.equal(lastAdd(S).data.approvalStatus, 'pending_review');
    assert.match(lastAdd(S).data.approvalWhy.text, /A ₱30000 is below the ₱50000 you approved, and below the standard ₱45000/);
  });
  it('approveAll ON never carries: every quote of an approved chain goes to Neil (even a higher price)', async () => {
    const S = makeBridge({ docs: chainDocs({ 'settings/quote_builder': { approveAll: true } }) });
    await S.send('QUOTE_FILED', rev());
    assert.equal(lastAdd(S).data.approvalStatus, 'pending_review'); assert.ok(toNeil(S));
    assert.equal('approvalCarriedFrom' in lastAdd(S).data, false);
    assert.match(lastAdd(S).data.approvalWhy.text, /Every quote needs your approval/);
    // off (or absent) = carries
    for (const docs of [chainDocs({ 'settings/quote_builder': { approveAll: false } }), chainDocs()]) { const T = makeBridge({ docs }); await T.send('QUOTE_FILED', rev()); assert.equal(lastAdd(T).data.approvalStatus, 'approved'); }
  });
  it('carried approvals do not move the bar (even one that carries an approvedBy): R2 carried at 120000, then R3 at 110000 (unknown cost) is compared with Neil\'s 100000, not R2\'s 120000 — and one under 100000 still goes to Neil', async () => {
    const r2 = { company: 'BK', quoteNumber: 'BKZZ-007R2', rootQuoteId: ROOT_ID, createdBy: 'u-sales', status: 'filed', approvalStatus: 'approved', approvalCarriedFrom: ROOT_ID, approvalCarriedAt: ts('2026-11-12T00:00:00.000Z'), approvedBy: NEIL, approvedAt: ts('2026-11-12T00:00:00.000Z'), total: 120000, items: [{ name: 'Sink', unitPrice: 120000, qty: 1 }] };
    const docs = chainDocs({ 'bk_quotes/qdR2': r2 });
    const S = makeBridge({ docs });
    await S.send('QUOTE_FILED', rev({ quoteNumber: 'BKZZ-007R3', parentQuoteId: 'qdR2', total: 110000, grandTotal: 110000, items: [{ name: 'Sink', unitPrice: 110000, qty: 1 }] }));
    assert.equal(lastAdd(S).data.approvalStatus, 'approved'); assert.equal(lastAdd(S).data.approvalCarriedFrom, ROOT_ID, 'rides Neil\'s own approval, not the carried one');
    assert.match(S.notified[0].body, /₱100000 → ₱110000/);
    const T = makeBridge({ docs });
    await T.send('QUOTE_FILED', rev({ quoteNumber: 'BKZZ-007R3', total: 99000, grandTotal: 99000, items: [{ name: 'Sink', unitPrice: 99000, qty: 1 }] }));
    assert.equal(lastAdd(T).data.approvalStatus, 'pending_review');
  });
  it('the NEWEST quote Neil approved himself is the bar: a later approval at a lower figure replaces the first', async () => {
    const docs = chainDocs({ 'bk_quotes/qdR2': { company: 'BK', quoteNumber: 'BKZZ-007R2', rootQuoteId: ROOT_ID, createdBy: 'u-sales', status: 'filed', approvalStatus: 'approved', approvedBy: NEIL, approvedAt: ts('2026-11-15T02:00:00.000Z'),
      total: 80000, approvedSnapshot: { total: 80000, lines: [{ key: 'sink||', unit: 80000 }], at: '2026-11-15T02:00:00.000Z', by: NEIL, byName: 'N', quoteNumber: 'R2' } } });
    const S = makeBridge({ docs });
    await S.send('QUOTE_FILED', rev({ total: 85000, grandTotal: 85000, items: [{ name: 'Sink', unitPrice: 85000, qty: 1 }] }));
    assert.equal(lastAdd(S).data.approvalCarriedFrom, 'qdR2');
    assert.match(S.notified[0].body, /₱80000 → ₱85000/);
  });
  it('a chain approved BEFORE snapshots existed: the gate builds the bar on the fly from that quote\'s total and items', async () => {
    const legacy = root(); delete legacy.approvedSnapshot;
    const S = makeBridge({ docs: { ['bk_quotes/' + ROOT_ID]: legacy } });
    await S.send('QUOTE_FILED', rev({ total: 90000, grandTotal: 90000, items: [{ name: 'Sink', unitPrice: 90000, qty: 1 }] }));
    assert.equal(lastAdd(S).data.approvalStatus, 'pending_review');
    const T = makeBridge({ docs: { ['bk_quotes/' + ROOT_ID]: legacy } }); await T.send('QUOTE_FILED', rev()); assert.equal(lastAdd(T).data.approvalStatus, 'approved');
  });
  it('nothing in the chain approved by Neil, a first quote, or the President himself: filed as today — the gate does not run (no approval request, no carry)', async () => {
    const S = makeBridge({ docs: { ['bk_quotes/' + ROOT_ID]: root({ approvalStatus: 'filed', approvedBy: undefined, approvedSnapshot: undefined }) } });
    await S.send('QUOTE_FILED', rev({ total: 1000, grandTotal: 1000, items: [{ name: 'Sink', unitPrice: 1000, qty: 1 }] }));
    assert.deepEqual([lastAdd(S).data.status, lastAdd(S).data.approvalStatus], ['filed', 'filed']); assert.equal(S.notified[0].type, 'quote_filed');
    const F = makeBridge({ docs: {} }); await F.send('QUOTE_FILED', rev({ rootQuoteId: null, parentQuoteId: null }));
    assert.equal(lastAdd(F).data.approvalStatus, 'filed'); assert.equal(F.queries.filter((x) => x.filters.some((f) => f[0] === 'rootQuoteId')).length, 0, 'a first quote reads no chain');
    const P = makeBridge({ docs: chainDocs(), role: 'president' }); await P.send('QUOTE_FILED', rev({ total: 1, grandTotal: 1 }));
    assert.equal(lastAdd(P).data.approvalStatus, 'filed'); assert.equal(P.queries.filter((x) => x.filters.some((f) => f[0] === 'rootQuoteId')).length, 0);
  });
  it('a quote the builder already sent for approval STAYS with Neil, even when its price would carry (the builder or the preparer asked); the gate\'s reasons join the sentence when it trips', async () => {
    const S = makeBridge({ docs: chainDocs() });
    await S.send('QUOTE_APPROVAL_REQUESTED', rev(), { approvalWhy: { reasons: ['review'], text: 'A line needs review.', ticked: false } });
    const d = lastAdd(S).data;
    assert.equal(d.approvalStatus, 'pending_review'); assert.equal('approvalCarriedFrom' in d, false); assert.equal(d.approvalWhy.text, 'A line needs review.');
    const T = makeBridge({ docs: chainDocs() });
    await T.send('QUOTE_APPROVAL_REQUESTED', rev({ total: 90000, grandTotal: 90000, items: [{ name: 'Sink', unitPrice: 90000, qty: 1 }] }), { approvalWhy: { reasons: ['review'], text: 'A line needs review.', ticked: true } });
    assert.match(lastAdd(T).data.approvalWhy.text, /^A line needs review\. Price check: Total ₱90000/); assert.equal(lastAdd(T).data.approvalWhy.ticked, true);
  });
  it('a builder that disagrees (its payload says the approval does NOT cover this) sends a carry-able quote to Neil', async () => {
    const S = makeBridge({ docs: chainDocs() });
    await S.send('QUOTE_FILED', rev({ approvalCovered: false }));
    assert.equal(lastAdd(S).data.approvalStatus, 'pending_review'); assert.match(lastAdd(S).data.approvalWhy.text, /disagree/);
    const T = makeBridge({ docs: chainDocs() }); await T.send('QUOTE_FILED', rev({ approvalCovered: true })); assert.equal(lastAdd(T).data.approvalStatus, 'approved');
  });
  it('a chain that cannot be read goes to Neil (never silently carried, never silently filed), and says why', async () => {
    const S = makeBridge({ docs: chainDocs(), failChain: true });
    await S.send('QUOTE_FILED', rev());
    assert.equal(lastAdd(S).data.approvalStatus, 'pending_review'); assert.match(lastAdd(S).data.approvalWhy.text, /Could not check the earlier approval/);
    assert.equal(S.toasts.some((t) => /NOT saved/.test(t.m)), false, 'the quote is saved');
  });
  it('the chain read: a non-admin reads only their own quotes (createdBy filter, so the rules can prove the query); an admin reads the whole chain', async () => {
    const S = makeBridge({ docs: chainDocs() }); await S.send('QUOTE_FILED', rev());
    const q = S.queries.find((x) => x.coll === 'bk_quotes' && x.filters.some((f) => f[0] === 'rootQuoteId'));
    assert.deepEqual(q.filters, [['rootQuoteId', '==', ROOT_ID], ['createdBy', '==', 'u-sales']]);
    const M = makeBridge({ docs: chainDocs(), role: 'manager', uid: 'u-mgr' }); await M.send('QUOTE_FILED', rev());
    assert.deepEqual(M.queries.find((x) => x.filters.some((f) => f[0] === 'rootQuoteId')).filters, [['rootQuoteId', '==', ROOT_ID]]);
  });
  it('a Brilliant Steel revision reads and carries inside bs_quotes', async () => {
    const S = makeBridge({ docs: { ['bs_quotes/' + ROOT_ID]: root({ company: 'BS' }) } });
    await S.send('QUOTE_FILED', rev({ company: 'BS' }));
    const a = S.adds.find((x) => x.coll === 'bs_quotes'); assert.equal(a.data.approvalStatus, 'approved'); assert.equal(a.data.approvalCarriedFrom, ROOT_ID);
    assert.equal(S.notified[0].link, 'bs-quotations');
  });
  it('priceCheck is stored on the quote, sanitised to the exact keys (null when absent or malformed)', async () => {
    const S = makeBridge({ docs: {} });
    await S.send('QUOTE_FILED', rev({ rootQuoteId: null, parentQuoteId: null, priceCheck: { v: 9, source: 'evil', basis: 'x', total: '95000', stdTotal: null, hack: 1, lines: [{ key: 'a', name: 'A', qty: 2, unit: 47500, std: '40000', mode: 'bogus', extra: 1 }, null] } }));
    assert.deepEqual(plain(lastAdd(S).data.priceCheck), { v: 1, source: 'qb2', basis: 'net', total: 95000, stdTotal: null, lines: [{ key: 'a', name: 'A', qty: 2, unit: 47500, std: 40000, mode: 'unknown' }] });
    for (const bad of [undefined, null, 'x', { total: 1 }, { total: 'abc', lines: [] }, []]) { const T = makeBridge({ docs: {} }); await T.send('QUOTE_FILED', rev({ rootQuoteId: null, priceCheck: bad })); assert.equal(lastAdd(T).data.priceCheck, null, JSON.stringify(bad)); }
  });

  // ── QUOTE_UPDATE ("update original") ──────────────────────────────────────────────────────────────────────────────
  it('QUOTE_UPDATE on an APPROVED source is refused: no in-place write, the save is filed as a NEW revision (next suffix from the highest in the chain), parent = the source, same chain — and the gate then carries it', async () => {
    const docs = chainDocs({ 'bk_quotes/qdR2': { company: 'BK', quoteNumber: 'BKZZ-007R2', rootQuoteId: ROOT_ID, createdBy: 'u-sales', status: 'filed', approvalStatus: 'approved', approvalCarriedFrom: ROOT_ID, total: 110000, items: [] } });
    const S = makeBridge({ docs });
    await S.send('QUOTE_UPDATE', rev({ quoteNumber: 'BKZZ-007R1', total: 105000, grandTotal: 105000, items: [{ name: 'Sink', unitPrice: 105000, qty: 1 }], parentQuoteId: null }), { docId: ROOT_ID, collection: 'bk_quotes' });
    assert.equal(S.updates.some((u) => u.id === ROOT_ID), false, 'the approved quote is NOT edited in place');
    const a = lastAdd(S); assert.ok(a, 'a new document was added');
    assert.equal(a.data.quoteNumber, 'BKZZ-007R3', 'R3: one above the highest suffix in the chain'); assert.equal(a.data.parentQuoteId, ROOT_ID); assert.equal(a.data.rootQuoteId, ROOT_ID);
    assert.equal(a.data.approvalStatus, 'approved', 'filed under the approval it rides on'); assert.equal(a.data.approvalCarriedFrom, ROOT_ID);
    assert.ok(S.toasts.some((t) => t.t === 'info' && /already approved|is approved/.test(t.m) && /R3/.test(t.m)), S.toasts.map((t) => t.m).join('|'));
  });
  it('QUOTE_UPDATE on an approved source whose new price is a cut goes to Neil as a new revision', async () => {
    const S = makeBridge({ docs: chainDocs() });
    await S.send('QUOTE_UPDATE', rev({ quoteNumber: 'BKZZ-007R1', total: 70000, grandTotal: 70000, items: [{ name: 'Sink', unitPrice: 70000, qty: 1 }] }), { docId: ROOT_ID, collection: 'bk_quotes' });
    assert.equal(S.updates.some((u) => u.id === ROOT_ID), false);
    assert.equal(lastAdd(S).data.approvalStatus, 'pending_review'); assert.equal(lastAdd(S).data.quoteNumber, 'BKZZ-007R2');
  });
  it('a source that cannot be read counts as approved (new revision, no in-place write)', async () => {
    const S = makeBridge({ docs: chainDocs(), failSource: 'bk_quotes/' + ROOT_ID });
    await S.send('QUOTE_UPDATE', rev({ quoteNumber: 'BKZZ-007R1' }), { docId: ROOT_ID, collection: 'bk_quotes' });
    assert.equal(S.updates.some((u) => u.id === ROOT_ID), false); assert.ok(lastAdd(S));
  });
  it('QUOTE_UPDATE on a quote that is NOT approved (filed, returned, pending) still updates in place', async () => {
    for (const st of ['filed', 'needs_revision', 'pending_review']) {
      const S = makeBridge({ docs: { ['bk_quotes/' + ROOT_ID]: root({ approvalStatus: st, approvedBy: undefined }) } });
      await S.send('QUOTE_UPDATE', rev({ quoteNumber: 'BKZZ-007R1' }), { docId: ROOT_ID, collection: 'bk_quotes' });
      assert.ok(S.updates.some((u) => u.id === ROOT_ID && u.patch.editedBy), st); assert.equal(S.adds.filter((a) => a.coll === 'bk_quotes').length, 0, st);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('3 · C3 in firestore.rules (bk_quotes, bs_quotes): a non-admin write that makes a quote approved must carry a real approval', () => {
  for (const coll of ['bk_quotes', 'bs_quotes']) {
    const block = piece(RULES, new RegExp(`match /${coll}/\\{docId\\} \\{[\\s\\S]*?\\n    \\}\\n`), coll + ' block');
    it(`${coll}: carriedApprovalOk() names a doc in the SAME collection that exists, is approved and shares the chain; approvalWriteOk() exempts admins and an already-approved doc`, () => {
      assert.match(block, /function carriedApprovalOk\(\) \{/);
      assert.match(block, /request\.resource\.data\.get\('approvalCarriedFrom', ''\) is string && request\.resource\.data\.get\('approvalCarriedFrom', ''\) != ''/);
      assert.ok(block.includes(`exists(/databases/$(database)/documents/${coll}/$(request.resource.data.approvalCarriedFrom))`));
      assert.ok(block.includes(`get(/databases/$(database)/documents/${coll}/$(request.resource.data.approvalCarriedFrom)).data.get('approvalStatus', '') == 'approved'`));
      assert.ok(block.includes(`.data.get('rootQuoteId', request.resource.data.approvalCarriedFrom) == request.resource.data.get('rootQuoteId', '_')`), 'same chain (an older root without the field is its own chain)');
      const fn = piece(block, /function approvalWriteOk\(\) \{[\s\S]*?\n      \}/, coll + ' approvalWriteOk');
      assert.match(fn, /return lostPrevOk\(\) && \(isAdmin\(\) \|\| request\.resource\.data\.get\('approvalStatus', ''\) != 'approved'/);
      assert.ok(fn.includes("(resource != null && resource.data.get('approvalStatus', '') == 'approved') || carriedApprovalOk()"));
      // reopening a LOST quote that was approved when it was marked lost (sales.js restore) — the saved state is kept honest by lostPrevOk()
      assert.ok(fn.includes("(resource != null && resource.data.get('status', '') == 'lost' && resource.data.get('lostPrevApprovalStatus', '') == 'approved')"));
    });
    it(`${coll}: lostPrevOk() — the saved approval is never written on create and, on update, equals the quote's real approval at that moment`, () => {
      const fn = piece(block, /function lostPrevOk\(\) \{[\s\S]*?\n      \}/, coll + ' lostPrevOk');
      assert.ok(fn.includes("(resource == null && !('lostPrevApprovalStatus' in request.resource.data))"));
      assert.ok(fn.includes("!request.resource.data.diff(resource.data).affectedKeys().hasAny(['lostPrevApprovalStatus'])"));
      assert.ok(fn.includes("request.resource.data.lostPrevApprovalStatus == resource.data.get('approvalStatus', null)"));
    });
    it(`${coll}: create AND update are gated by approvalWriteOk(); delete and read are untouched`, () => {
      assert.match(block, /allow create:[\s\S]*?&& approvalWriteOk\(\);/);
      assert.match(block, /allow update:[\s\S]*?&& approvalWriteOk\(\);/);
      assert.equal((block.match(/approvalWriteOk\(\)/g) || []).length, 3, 'defined once, used twice');
      assert.equal(/allow (read|delete):[^;]*approvalWriteOk/.test(block), false);
    });
  }
  it('one-line comments only (the rules size cap, CI CHECK 8), and the file stays well under the cap', () => {
    for (const m of RULES.matchAll(/\/\/ C3 \(SALES-FLOW-SPEC 6\.6\)[^\n]*\n(?!\s*\/\/)/g)) assert.ok(m[0].length < 220);
    assert.ok(Buffer.byteLength(RULES) < 262144 * 0.8);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('4 · the "Approved (carried)" badge (js/screens/sales.js)', () => {
  const win = {};
  const ctx = vm.createContext({ window: win, Date });
  vm.runInContext(piece(SALES, /^window\.quoteApprovalBadge = function \(q\) \{[\s\S]*?\n\};/m, 'quoteApprovalBadge'), ctx);
  const b = (q) => plain(win.quoteApprovalBadge(q));
  it('a filed, approved quote riding an earlier approval says "Approved (carried)" with the date of Neil\'s approval', () => {
    const r = b({ status: 'filed', approvalStatus: 'approved', approvalCarriedFrom: 'qdX', approvalCarriedOn: '2026-11-10T02:00:00.000Z' });
    assert.equal(r.label, 'Approved (carried)'); assert.equal(r.cls, 'badge-green'); assert.match(r.title, /approval of (Nov 10, 2026|10 Nov 2026)/);
    assert.match(b({ status: 'filed', approvalStatus: 'approved', approvalCarriedFrom: 'qdX', approvalCarriedAt: ts('2026-11-12T00:00:00.000Z') }).title, /(Nov 12, 2026|12 Nov 2026)/, 'older docs: the day it was carried');
    assert.equal(b({ status: 'filed', approvalStatus: 'approved', approvalCarriedFrom: 'qdX' }).label, 'Approved (carried)');
  });
  it('Neil\'s own approval stays "Approved"; a pending carried-from field changes nothing; an ordered quote keeps its status badge', () => {
    assert.equal(b({ status: 'filed', approvalStatus: 'approved' }).label, 'Approved');
    assert.equal(b({ status: 'filed', approvalStatus: 'pending_review', approvalCarriedFrom: 'qdX' }).label, 'Pending approval');
    assert.equal(b({ status: 'filed', approvalStatus: 'approved', approvalCarriedFrom: 'qdX', salesOrderId: 'so1' }), null);
  });
  it('both lists draw it: the Barro Kitchens cards (title attribute, escaped) and the Brilliant Steel rows', () => {
    assert.match(SALES, /title="' \+ escHtml\(ab\.title\) \+ '"/);
    assert.match(SALES, /const ab = q\.approvalCarriedFrom \? window\.quoteApprovalBadge\(q\) : null;/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('5 · price-gate-core.js is eager', () => {
  const kit = HTML.match(/<template id="app-kit">([\s\S]*?)<\/template>/)[1];
  it('it is an app-kit <script defer> right after js/sales-flow-core.js, with the release ?v=, and nowhere in the body', () => {
    const srcs = [...kit.matchAll(/<script defer src="([^"]+)"/g)].map((m) => m[1].replace(/\?v=.*$/, ''));
    const i = srcs.indexOf('js/sales-flow-core.js');
    assert.equal(srcs[i + 1], 'js/price-gate-core.js');
    assert.match(kit, /<script defer src="js\/price-gate-core\.js\?v=\d+\.\d+\.\d+"><\/script>/);
    assert.equal((HTML.match(/price-gate-core\.js/g) || []).length >= 1 && HTML.replace(kit, '').includes('<script defer src="js/price-gate-core'), false);
  });
  it('it is precached under that exact URL (the app-kit contract) and still by its bare path (the lazy fallback)', () => {
    assert.ok(SW.includes("\n  '/js/price-gate-core.js?v="), 'versioned');
    assert.ok(SW.includes("\n  '/js/price-gate-core.js',\n"), 'bare');
    const ver = HTML.match(/js\/price-gate-core\.js\?v=([\d.]+)/)[1]; assert.ok(SW.includes(`'/js/price-gate-core.js?v=${ver}'`));
  });
  it('contract-ui only lazy-loads it when it is missing (no double load)', () => {
    assert.match(read('js/contract-ui.js'), /if \(!window\.PriceGate\) await window\.ensureScript\('js\/price-gate-core\.js'\);/);
  });
  it('the app consumers are guarded: the bridge throws into "send to Neil" and approvals.js skips the snapshot, never crashes without the gate', () => {
    assert.match(APP, /if \(!PG\) throw new Error\('price gate not loaded'\);/);
    assert.match(APPROVALS, /if\(window\.PriceGate && typeof window\.PriceGate\.snapshotFromQuote === 'function'\)/);
  });
});
