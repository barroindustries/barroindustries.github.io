// tests/quote-president-figures.test.mjs — QUOTE-PRESIDENT-FIGURES-SPEC-2026-11-20 §6.4, §8, §9, §13.3: the decision (js/screens/approvals.js decideQuoteApproval) and the builder bridge (js/app.js, the REAL listener lifted
// whole) against an in-memory Firestore, with the REAL js/price-gate-core.js and js/quote-figures-core.js.
//
// WHAT IT PINS
//   1. DECIDE, APPROVE AT HIS FIGURES  ONE quote update with the money allowlist, presidentFigures (mode approve, by, at, lines, totals), the state fields and an approvedSnapshot built at HIS prices; the cost record is
//                                      rewritten under the quote creator's createdBy (never the President's uid); the thread entry carries the rows; the notification has no amount; the approval request's total follows.
//   2. DECIDE, RETURN WITH FIGURES     no money field in the update; carry true only for an exact return that changed a price and has totals; kind returned with rows; the notification text.
//   3. P3 expectSig                    a quote that changed under the page is refused with reason "changed" and NOTHING is written.
//   4. WHO / WHAT                      a non-President's figures are ignored; the figures and the edits must agree; a plain decision deletes an earlier offer and is byte-identical to today's when there is none.
//   5. BRIDGE (§8)                     a re-send at or above his prices files approved with approvalCarriedKind 'figures' and no approvedBy; one line below goes to him with an amount-free notification and the detail in
//                                      approvalWhy.text; approveAll never carries; a disagreeing builder goes to him; a stale offer falls back; a failed chain read goes to him; QUOTE_UPDATE on a returned-with-figures
//                                      quote is filed as a new revision; the "applied" entry is written once and never fails the filing.
//   6. F-10                            "Save edits & Approve" hands the builder's WHOLE answer through QuoteFigures.moneyEdits (and the cost record).
//
// MUTATION LOG (2026-11-20; each mutant applied to the named file in a scratch copy of the repository, this file run, every one KILLED by the test named):
//   D1  approvals.js: decide writes the money edits on a RETURN too                                  -> "a return with figures writes no money field"
//   D2  approvals.js: decide skips the expectSig check                                               -> "P3: a quote that changed under the page is refused ... and nothing is written"
//   D3  approvals.js: decide stamps the President's uid as the cost record's createdBy                -> "approve at his figures: ... the cost record keeps the quote creator's createdBy"
//   B1  app.js: the gate carries even when evaluate() says needsApproval                              -> "a re-send with ONE line below his price goes to him ..."
//   B2  app.js: the figures path ignores approveAll                                                   -> "approveAll ON never carries, not even for his own figures"
//   B3  app.js: the carried doc gets approvedBy                                                       -> "a re-send AT his prices files approved, carried under kind figures ..."
//   B4  app.js: the figures path ignores a builder that disagrees                                     -> "a builder that disagrees (approvalCovered false) sends a figures-carry-able quote to him ..."
//   B5  app.js: QUOTE_UPDATE on a returned-with-figures quote updates in place                         -> "QUOTE_UPDATE on a returned-with-figures quote is refused in place ..."
//   B6  app.js: the applied entry counts a held line                                                   -> "the \"applied\" thread entry: ... (a held line does not count) ..."
// (the pure core and the gate are mutation-tested in tests/quote-figures-core.test.mjs and tests/price-gate-core.test.mjs; this file also kills G1..G6 of the gate through the bridge tests)
// Fixtures are FAKE (invented names, round numbers: the repository is public). Run with: node --test tests/*.test.mjs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const APP = read('js/app.js'), CONFIG = read('js/config.js'), APPROVALS = read('js/screens/approvals.js'), SVC = read('js/svc-approvals.js');
const PG_SRC = read('js/price-gate-core.js'), QF_SRC = read('js/quote-figures-core.js');
const piece = (src, re, what) => { const m = src.match(re); assert.ok(m, `${what} not found`); return m[0]; };
const appFn = (name) => piece(APP, new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`, 'm'), `${name} in js/app.js`);
const cfgPiece = (name) => piece(CONFIG, new RegExp(`^window\\.${name} = function[\\s\\S]*?\\n\\};`, 'm'), `window.${name} in js/config.js`);
const FV = { serverTimestamp: () => ({ __ts: true }), increment: (n) => ({ __inc: n }), delete: () => ({ __del: true }) };
const NEIL = 'u-neil', AGENT = 'u-sales', ORIGIN = 'https://app.test', ROOT_ID = 'qdROOT0000000000001', PESO = '\u20b1';   // (the sign is built here, never written next to a digit in this file)
const ts = (iso) => ({ seconds: Math.floor(Date.parse(iso) / 1000), nanoseconds: 0 });   // survives the in-memory store's JSON clone, like the seconds / nanoseconds of a real Firestore Timestamp
// none of these may be in a notification body written for his figures: a peso sign, PHP, a two-decimal figure, or any of the fixture's own amounts as a bare number
const AMOUNTS = ['900', '1000', '1100', '1200', '1300', '1400', '1500', '1600', '2000', '2160', '2500', '2600', '2700', '2900', '3000', '4320', '4500', '4800', '5000'];
const CURRENCY = { test: (body) => /₱|PHP|\d[\d,]*\.\d{2}\b/.test(body) || AMOUNTS.some((a) => new RegExp('(^|[^\\d])' + a + '([^\\d]|$)').test(body)) };

function makeDb(opts) {
  opts = opts || {};
  const store = new Map(Object.entries(opts.docs || {}));
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
      get: async () => { queries.push({ coll, filters: filters.map((x) => x.slice()) }); if (opts.failChain && (coll === 'bk_quotes' || coll === 'bs_quotes')) throw new Error('chain read failed');
        const docs = [...store.entries()].filter(([k, d]) => k.startsWith(coll + '/') && filters.every(([ff, , vv]) => d[ff] === vv)).map(([k, d]) => ({ id: k.slice(coll.length + 1), data: () => plain(d), ref: docRef(coll, k.slice(coll.length + 1)) })); return { docs }; } }; return q; },
  }) };
  return { db, store, adds, updates, queries, ops };
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('1-4 · decideQuoteApproval with the President\'s figures (js/screens/approvals.js)', () => {
  const CODE = piece(APPROVALS, /^const _qaInFlight = new Set\(\);[\s\S]*?\nwindow\.decideQuoteApproval = decideQuoteApproval;/m, 'decideQuoteApproval');
  function make(docs, opts) {
    opts = opts || {};
    const D = makeDb({ docs });
    const sidecars = [], links = [], mirrors = [], threads = [], sent = [], audits = [], toasts = [];
    const win = { quoteStateFields: (s) => ({ approved: { status: 'filed', approvalStatus: 'approved' }, needs_revision: { status: 'needs_revision', approvalStatus: 'needs_revision' } })[s],
      syncQuoteStatusToRequest: async () => true, QuoteThread: { add: async (o) => { threads.push(plain(o)); return { ok: true }; } }, quoteApprovalRefOf: () => 'bk.x', logAudit: (...a) => audits.push(plain(a)), invalidateBsQuotesCache: () => {},
      qbSaveCostSidecar: async (...a) => { sidecars.push(plain(a)); }, linkQuoteToRequest: async (...a) => { links.push(plain(a)); }, resyncPublicQuoteMirror: async (...a) => { mirrors.push(plain(a)); } };
    const ctx = vm.createContext({ window: win, db: D.db, firebase: { firestore: { FieldValue: FV } }, console: { log() {}, warn() {}, error() {} }, Date,
      currentUser: { uid: NEIL, email: 'neil@example.test' }, userProfile: { displayName: 'Neil Test' }, currentRole: opts.role || 'president', navigator: { onLine: true },
      Notifs: { showToast: (m, t) => toasts.push({ m, t }), success() {}, error() {}, send: async (uid, n) => { sent.push({ uid, n: plain(n) }); } }, dbCacheInvalidate: () => {} });
    vm.runInContext(PG_SRC, ctx); vm.runInContext(QF_SRC, ctx); vm.runInContext(CODE, ctx);
    return Object.assign(D, { win, sidecars, links, mirrors, threads, sent, audits, toasts, decide: (o) => win.decideQuoteApproval(Object.assign({ coll: 'bk_quotes', quoteId: 'q1', action: 'approve', agentId: AGENT, quoteNumber: 'BKZZ-001R1', clientName: 'Mira Test' }, o || {})) });
  }
  const pending = (over) => Object.assign({ approvalStatus: 'pending_review', status: 'pending_approval', quoteNumber: 'BKZZ-001R1', clientName: 'Mira Test', createdBy: AGENT, rootQuoteId: 'q1', sourceRef: { kind: 'qr', ref: 'QR-261120-ABC123' },
    total: 5000, netAmount: 4500, subtotal: 5000, discountAmount: 500, items: [{ name: 'Sink', dims: '1x1', unit: 'pc', qty: 2, unitPrice: 1000, amount: 2000 }, { name: 'Table', unit: 'pc', qty: 1, unitPrice: 3000, amount: 3000 }] }, over || {});
  const patchOf = (S) => S.updates.find((u) => u.coll === 'bk_quotes' && u.id === 'q1').patch;
  const ROWS = [{ i: 0, key: 'sink|1x1|pc', name: 'Sink', qty: 2, unit: 'pc', from: 1000, to: 900, note: 'a lower price' }, { i: 1, key: 'table||pc', name: 'Table', qty: 1, unit: 'pc', from: 3000, to: null, note: 'check the top' }];
  const NEWPAYLOAD = () => ({ items: [{ name: 'Sink', dims: '1x1', unit: 'pc', qty: 2, unitPrice: 900, amount: 1800, priceBy: { role: 'president', uid: NEIL, name: 'Neil Test', at: 'x', salesPrice: 1000 } }, { name: 'Table', unit: 'pc', qty: 1, unitPrice: 3000, amount: 3000 }],
    subtotal: 4800, volumeBreakTotal: 0, total: 4320, grandTotal: 4320, netAmount: 4320, discountAmount: 480, discountPct: 10, vatIncluded: false, vatAmount: 0, deliveryInstall: null, commissionPct: 0, commissionAmount: 0,
    optionsMode: false, options: null, optionsBasis: '', payment: { downPayment: 2160, balance: 2160 }, editableState: { items: [], quoteNo: 'BKZZ-001R1' }, clientName: 'LEAK', quoteNumber: 'BKZZ-001R1', rootQuoteId: 'LEAK' });
  const approveFigures = (S, over) => {
    const QF = S.win.QuoteFigures, p = NEWPAYLOAD();
    return S.decide(Object.assign({ action: 'approve', notes: '', edits: Object.assign({}, QF.moneyEdits(p), { editedByPresident: true, editedAt: FV.serverTimestamp(), editedBy: NEIL }),
      figures: { mode: 'approve', lines: ROWS, changed: 1, totals: { before: { subtotal: 5000, netAmount: 4500, total: 5000 }, after: { subtotal: 4800, netAmount: 4320, total: 4320 } }, exact: true, carry: false, held: [] },
      expectSig: QF.sig(pending()), costSidecar: { v: 1, items: [{ i: 0, n: 'Sink' }], kcSummary: { v: 1, net: 4320 } } }, over || {}));
  };

  it('approve at his figures: ONE update with the money allowlist, presidentFigures, the state and an approvedSnapshot at HIS prices; no client field, number or chain id leaks', async () => {
    const S = make({ 'bk_quotes/q1': pending(), 'approval_requests/ar1': { type: 'bs_quote', quoteId: 'q1', status: 'pending', total: 5000 } });
    assert.deepEqual(plain(await approveFigures(S)), { ok: true });
    assert.equal(S.updates.filter((u) => u.coll === 'bk_quotes').length, 1, 'ONE quote update');
    const p = patchOf(S);
    for (const k of ['items', 'subtotal', 'volumeBreakTotal', 'total', 'grandTotal', 'optionsMode', 'options', 'optionsBasis', 'vatIncluded', 'vatAmount', 'discountPct', 'discountAmount', 'netAmount', 'deliveryInstall', 'commissionPct', 'commissionAmount', 'payment', 'editableState', 'editedByPresident', 'editedAt', 'editedBy']) assert.ok(k in p, k);
    for (const k of ['clientName', 'quoteNumber', 'rootQuoteId', 'sourceRef', 'createdBy', 'parentQuoteId']) assert.equal(k in p, false, k + ' is never written by an approval at his figures');
    assert.equal(p.total, 4320); assert.equal(p.approvalStatus, 'approved'); assert.equal(p.approvedBy, NEIL); assert.equal(p.approvedByName, 'Neil Test');
    const pf = plain(p.presidentFigures);
    assert.deepEqual(Object.keys(pf).sort(), ['at', 'atTs', 'by', 'byName', 'carry', 'changed', 'exact', 'held', 'lines', 'mode', 'totals', 'v']);
    assert.equal(pf.mode, 'approve'); assert.equal(pf.by, NEIL); assert.equal(pf.byName, 'Neil Test'); assert.equal(pf.v, 1); assert.equal(pf.exact, true); assert.equal(pf.carry, false); assert.equal(pf.changed, 1);
    assert.match(pf.at, /^\d{4}-\d\d-\d\dT/); assert.deepEqual(pf.atTs, { __ts: true }); assert.deepEqual(pf.lines, ROWS);
    assert.deepEqual(pf.totals, { before: { subtotal: 5000, netAmount: 4500, total: 5000 }, after: { subtotal: 4800, netAmount: 4320, total: 4320 } });
    const sn = plain(p.approvedSnapshot); assert.equal(sn.total, 4320); assert.deepEqual(sn.lines.map((l) => l.unit), [900, 3000], 'the bar is HIS prices, not Sales\'');
    assert.equal(S.store.get('approval_requests/ar1').total, 4320, 'the approval request\'s total follows');
    assert.equal(S.store.get('approval_requests/ar1').status, 'approved');
  });
  it('approve at his figures: the cost record keeps the quote creator\'s createdBy (an agent keeps reading his own cost record), the website request and the client page follow, the thread entry carries the rows', async () => {
    const S = make({ 'bk_quotes/q1': pending({ shareToken: 'tok1' }) });
    await approveFigures(S);
    assert.equal(S.sidecars.length, 1); const [coll, id, sc, o] = S.sidecars[0];
    assert.deepEqual([coll, id], ['bk_quotes', 'q1']); assert.equal(sc.kcSummary.net, 4320); assert.equal(o.createdBy, AGENT, 'the cost record keeps the quote creator\'s createdBy, never the President\'s uid'); assert.notEqual(o.createdBy, NEIL);
    S.store.set('quote_costs/bk_quotes_q1', { createdBy: 'u-first-author', items: [] });
    const T = make({ 'bk_quotes/q1': pending(), 'quote_costs/bk_quotes_q1': { createdBy: 'u-first-author', items: [] } }); await approveFigures(T);
    assert.equal(T.sidecars[0][3].createdBy, 'u-first-author', 'the existing record\'s createdBy wins');
    assert.deepEqual(S.links[0][0], { kind: 'qr', ref: 'QR-261120-ABC123' }); assert.equal(S.links[0][1].total, 4320); assert.equal(S.links[0][1].coll, 'bk_quotes');
    assert.equal(S.mirrors.length, 1, 'a shared quote\'s client page is re-projected'); assert.equal(S.mirrors[0][2].total, 4320);
    assert.equal(S.threads.length, 1); assert.equal(S.threads[0].kind, 'approved'); assert.deepEqual(S.threads[0].lines, ROWS);
    const noShare = make({ 'bk_quotes/q1': pending() }); await approveFigures(noShare); assert.equal(noShare.mirrors.length, 0);
  });
  it('F-10: an approval that saves money edits WITHOUT figures (the builder\'s "Save edits & Approve") also rewrites the cost record, updates the request total and refreshes the client page; a return, or an approval with no money, does none of it', async () => {
    const S = make({ 'bk_quotes/q1': pending({ shareToken: 'tok1' }), 'approval_requests/ar1': { type: 'bs_quote', quoteId: 'q1', status: 'pending', total: 5000 } });
    await S.decide({ action: 'approve', edits: { items: [{ name: 'Sink', unitPrice: 5, qty: 1 }], total: 4000, grandTotal: 4000, clientName: 'Mira Test' }, costSidecar: { v: 1, items: [{ i: 0, n: 'Sink' }] } });
    assert.equal(S.sidecars.length, 1); assert.equal(S.sidecars[0][3].createdBy, AGENT); assert.equal(S.links.length, 1); assert.equal(S.links[0][1].total, 4000); assert.equal(S.mirrors.length, 1);
    assert.equal(S.store.get('approval_requests/ar1').total, 4000); assert.equal('presidentFigures' in patchOf(S), false, 'no figures: none written');
    for (const o of [{ action: 'return', notes: 'x', edits: { items: [], total: 1 }, costSidecar: { v: 1, items: [{ i: 0 }] } }, { action: 'approve', edits: { clientName: 'Only a name' }, costSidecar: { v: 1, items: [{ i: 0 }] } }, { action: 'approve' }]) {
      const T = make({ 'bk_quotes/q1': pending({ shareToken: 'tok1' }) }); await T.decide(o); assert.equal(T.sidecars.length + T.links.length + T.mirrors.length, 0, JSON.stringify(o));
    }
  });
  it('approve at his figures: the notification names the number and the count and says no re-send is needed — no peso sign, no amount', async () => {
    const S = make({ 'bk_quotes/q1': pending() });
    await approveFigures(S);
    assert.equal(S.sent.length, 1); const n = S.sent[0].n;
    assert.equal(S.sent[0].uid, AGENT); assert.equal(n.type, 'quote_approved'); assert.match(n.title, /Quote approved at the President's prices/);
    assert.equal(n.body, '"BKZZ-001R1" for Mira Test was approved with the President\'s prices on 1 line. Open it and send the PDF. No re-send is needed.');
    assert.equal(CURRENCY.test(n.title + ' ' + n.body), false); assert.equal(n.link, 'quote-approval/bk.x');
    assert.deepEqual(S.audits[0][3].figures, { mode: 'approve', changed: 1 });
  });
  it('a return with figures writes no money field; carry is true only for an exact return that changed a price and carries totals; the thread entry is a "returned" with the rows; the notification says how many lines', async () => {
    const S = make({ 'bk_quotes/q1': pending() });
    const FIG = { mode: 'return', lines: ROWS, changed: 1, totals: { before: { subtotal: 5000, netAmount: 4500, total: 5000 }, after: { subtotal: 4800, netAmount: 4320, total: 4320 } }, exact: true, carry: true };
    await S.decide({ action: 'return', notes: 'go lower on the sink; a general note with 5,000.00 in it', figures: FIG, expectSig: S.win.QuoteFigures.sig(pending()) });
    const p = patchOf(S);
    for (const k of ['items', 'total', 'grandTotal', 'subtotal', 'netAmount', 'payment', 'editableState', 'discountAmount']) assert.equal(k in p, false, 'a return with figures writes no ' + k);
    assert.equal(p.approvalStatus, 'needs_revision'); assert.equal(p.presidentNotes.startsWith('go lower'), true);
    const pf = plain(p.presidentFigures); assert.equal(pf.mode, 'return'); assert.equal(pf.carry, true); assert.deepEqual(pf.held, []);
    assert.equal(S.threads[0].kind, 'returned'); assert.deepEqual(S.threads[0].lines, ROWS);
    const n = S.sent[0].n; assert.equal(n.type, 'quote_returned'); assert.match(n.title, /Quote returned with the President's prices/);
    assert.equal(n.body, '"BKZZ-001R1" for Mira Test: the President set prices on 1 line and left notes on 2. Open it and tap Apply President\'s figures.');
    assert.equal(n.body.includes('5,000'), false, 'his general note is not copied into the notification (it may contain amounts)'); assert.equal(CURRENCY.test(n.body), false);
    // carry needs: exact, a changed price, totals, mode return
    for (const [bad, why] of [[{ exact: false }, 'not exact'], [{ totals: null }, 'no totals'], [{ changed: 0 }, 'no price changed'], [{ mode: 'approve' }, 'an approve never offers a carry']]) {
      const T = make({ 'bk_quotes/q1': pending() });
      const edits = bad.mode === 'approve' ? { items: [], total: 1 } : undefined;
      await T.decide({ action: 'return', notes: 'x', figures: Object.assign({}, FIG, bad), ...(edits ? { edits } : {}) });
      const out = T.updates.find((u) => u.coll === 'bk_quotes');
      if (out) assert.equal(plain(out.patch.presidentFigures).carry, false, why);
    }
  });
  it('a return with figures writes no money field even when the call carries edits: the figures and the edits must agree, or nothing is saved', async () => {
    const S = make({ 'bk_quotes/q1': pending() });
    const FIG = { mode: 'return', lines: ROWS, changed: 1, totals: null, exact: false, carry: false };
    const r = await S.decide({ action: 'return', notes: 'x', figures: FIG, edits: { items: [{ name: 'x' }], total: 1 } });
    assert.equal(r.ok, false); assert.equal(S.updates.length, 0, 'a return never changes the prices');
    const A = make({ 'bk_quotes/q1': pending() });
    const r2 = await A.decide({ action: 'approve', figures: { mode: 'approve', lines: ROWS, changed: 1, totals: null, exact: true, carry: false } });   // approve at figures with no money edits
    assert.equal(r2.ok, false); assert.equal(A.updates.length, 0);
    const B = make({ 'bk_quotes/q1': pending() });
    const r3 = await B.decide({ action: 'approve', figures: { mode: 'return', lines: ROWS, changed: 1 }, edits: { items: [], total: 1 } });
    assert.equal(r3.ok, false); assert.equal(B.updates.length, 0);
  });
  it('P3: a quote that changed under the page is refused with reason "changed" and NOTHING is written (no quote, request, thread or notification write)', async () => {
    const S = make({ 'bk_quotes/q1': pending({ total: 5001 }), 'approval_requests/ar1': { type: 'bs_quote', quoteId: 'q1', status: 'pending' } });
    const r = await approveFigures(S, { expectSig: S.win.QuoteFigures.sig(pending()) });
    assert.deepEqual(plain(r), { ok: false, reason: 'changed' });
    assert.deepEqual(S.ops, ['get bk_quotes/q1'], 'only the guard\'s read');
    assert.equal(S.updates.length, 0); assert.equal(S.threads.length, 0); assert.equal(S.sent.length, 0); assert.equal(S.sidecars.length, 0);
    assert.ok(S.toasts.some((t) => /changed since you opened it/.test(t.m)));
    // a changed line price or quantity counts too; the same quote is accepted
    for (const mut of [(q) => { q.items[0].unitPrice = 1001; }, (q) => { q.items[1].qty = 2; }, (q) => { q.items[0].name = 'Basin'; }]) { const q = pending(); mut(q); const T = make({ 'bk_quotes/q1': q }); assert.equal((await approveFigures(T)).reason, 'changed'); }
    assert.equal((await approveFigures(make({ 'bk_quotes/q1': pending() }))).ok, true);
    // without the core loaded the check cannot be made: fail closed
    const N = make({ 'bk_quotes/q1': pending() }); N.win.QuoteFigures = null;
    assert.equal((await N.decide({ expectSig: 'x' })).reason, 'changed'); assert.equal(N.updates.length, 0);
  });
  it('a non-President\'s figures are ignored: the rules would refuse the write, so presidentFigures is not in the update (a plain decision)', async () => {
    const S = make({ 'bk_quotes/q1': pending() }, { role: 'manager' });
    await S.decide({ action: 'return', notes: 'redo', figures: { mode: 'return', lines: ROWS, changed: 1, totals: null, exact: false, carry: false } });
    const p = patchOf(S); assert.equal('presidentFigures' in p, false);
    assert.equal(S.threads[0].lines, undefined, 'no rows in the thread entry either');
    assert.match(S.sent[0].n.body, /was reviewed and returned\. Notes: redo Please revise and re-submit\.$/, 'today\'s body');
  });
  it('a plain decision on a doc that carries presidentFigures deletes it; on a doc without it the update is byte-identical to today\'s (no new key)', async () => {
    const S = make({ 'bk_quotes/q1': pending({ presidentFigures: { v: 1, mode: 'return', carry: true } }) });
    await S.decide({ action: 'return', notes: 'x' });
    assert.deepEqual(plain(patchOf(S).presidentFigures), { __del: true });
    const T = make({ 'bk_quotes/q1': pending() });
    await T.decide({ action: 'approve' });
    assert.deepEqual(Object.keys(patchOf(T)).sort(), ['approvalStatus', 'approvedAt', 'approvedBy', 'approvedByName', 'approvedSnapshot', 'status'], 'exactly today\'s keys');
    const R = make({ 'bk_quotes/q1': pending() }); await R.decide({ action: 'return', notes: 'x' });
    assert.deepEqual(Object.keys(patchOf(R)).sort(), ['approvalStatus', 'presidentNotes', 'returnedAt', 'returnedBy', 'status']);
    assert.equal(R.sent[0].n.body, '"BKZZ-001R1" for Mira Test was reviewed and returned. Notes: x Please revise and re-submit.');
  });
  it('a plain decision with line notes (changed 0): the rows ride along and the body gains " Notes on M lines." — today\'s body otherwise', async () => {
    const S = make({ 'bk_quotes/q1': pending() });
    await S.decide({ action: 'approve', figures: { mode: 'approve', lines: [ROWS[1]], changed: 0, totals: null, exact: false, carry: false } });
    const pf = plain(patchOf(S).presidentFigures); assert.equal(pf.changed, 0); assert.equal(pf.carry, false); assert.equal('items' in patchOf(S), false);
    assert.equal(S.sent[0].n.body, 'Quotation "BKZZ-001R1" for Mira Test was approved and filed. Notes on 1 line.');
    assert.equal(S.sent[0].n.title, '✅ Quote Approved!');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('5 · the builder bridge with the President\'s figures (js/app.js, listener lifted whole)', () => {
  const LISTENER = (() => {
    const start = APP.indexOf("window.addEventListener('message', async (e) => {", APP.indexOf('Quote Builder iframe → Firestore bridge'));
    const end = APP.indexOf('\n});', start);
    return APP.slice(start, end + 4);
  })();
  const CODE = [cfgPiece('quoteApprovalRefOf'), piece(APP, /^const QB_SOURCE_REF_RE = .*;$/m, 'QB_SOURCE_REF_RE'),
    ...['_qbCleanSourceRef', '_qbCleanEstimateCheck', '_qbCleanApprovalWhy', '_qbCleanPriceCheck', '_qbChainQuotes', '_qbRevOf', '_qbGateText', '_qbFiguresNote', '_qbChainGate'].map(appFn),
    piece(SVC, /^window\.QuoteThread = \{[\s\S]*?\n\};/m, 'window.QuoteThread'), LISTENER].join('\n');
  const AT = '2026-11-20T01:00:00.000Z', APPROVED_AT = '2026-11-10T02:00:00.000Z';
  // the chain: the root (approved by him earlier) and R2, which he RETURNED with his own prices on line 0 (1000 -> 1200) with the carry on
  const root = (over) => Object.assign({ company: 'BK', quoteNumber: 'BKZZ-007R1', rootQuoteId: ROOT_ID, createdBy: AGENT, status: 'filed', approvalStatus: 'approved', approvedBy: NEIL, approvedAt: ts(APPROVED_AT), total: 2500,
    items: [{ name: 'Sink', unitPrice: 1000, qty: 1 }, { name: 'Table', unitPrice: 1500, qty: 1 }], approvedSnapshot: { total: 2500, lines: [{ key: 'sink||', unit: 1000 }, { key: 'table||', unit: 1500 }], at: APPROVED_AT, by: NEIL, byName: 'N', quoteNumber: 'R1' } }, over || {});
  const returned = (over) => Object.assign({ company: 'BK', quoteNumber: 'BKZZ-007R2', rootQuoteId: ROOT_ID, parentQuoteId: ROOT_ID, createdBy: AGENT, status: 'needs_revision', approvalStatus: 'needs_revision', returnedAt: ts(AT),
    total: 2500, items: [{ name: 'Sink', unitPrice: 1000, qty: 1 }, { name: 'Table', unitPrice: 1500, qty: 1 }],
    presidentFigures: { v: 1, mode: 'return', by: NEIL, byName: 'Neil Test', at: AT, atTs: ts(AT), lines: [{ i: 0, name: 'Sink', qty: 1, from: 1000, to: 1200, note: '' }], changed: 1, exact: true, carry: true, held: [],
      totals: { before: { subtotal: 2500, netAmount: 2500, total: 2500 }, after: { subtotal: 2700, netAmount: 2700, total: 2700 } } } }, over || {});
  const chainDocs = (extra) => Object.assign({ ['bk_quotes/' + ROOT_ID]: root(), 'bk_quotes/qdR2': returned() }, extra || {});
  function makeBridge(opts) {
    opts = opts || {};
    const D = makeDb(opts);
    const FRAME = {}, listeners = [], toasts = [], notified = [], threadAdds = [];
    const win = { location: { origin: ORIGIN }, addEventListener: (t, f) => { if (t === 'message') listeners.push(f); }, QUOTE_COLLECTIONS: ['bk_quotes', 'bs_quotes'], quoteCollectionFor: (co) => (co === 'BS' ? 'bs_quotes' : 'bk_quotes'),
      quoteStateFields: (s) => ({ filed: { status: 'filed', approvalStatus: 'filed' }, pending_approval: { status: 'pending_approval', approvalStatus: 'pending_review' }, approved: { status: 'filed', approvalStatus: 'approved' } })[s],
      Clients: { upsertFromQuote: async () => 'client_1' }, linkQuoteToRequest: async () => true, fmtN2: (n) => String(n), logAudit: () => {}, showQuoteApprovalLink: () => {}, resyncPublicQuoteMirror: async () => {},
      qbSaveCostSidecar: async () => {}, parseQuoteApprovalRef: () => null };
    const ctx = vm.createContext({ window: win, db: D.db, console: { log() {}, error() {}, warn() {} }, Date,
      document: { getElementById: (id) => (id === 'qb-frame' ? { contentWindow: FRAME } : null) }, firebase: { firestore: { FieldValue: FV } },
      currentUser: { uid: opts.uid || AGENT, email: 'sales@example.test' }, userProfile: { displayName: 'Sales Tester' }, currentRole: opts.role || 'employee',
      Notifs: { showToast: (m, t) => toasts.push({ m, t }), success: (m) => toasts.push({ m, t: 'success' }), sendToOwner: async (n) => { D.ops.push('notify owner'); notified.push(plain(n)); } },
      dbCacheInvalidate: () => {}, saveCostSidecar: async () => {}, deleteCostSidecar: async () => {} });
    vm.runInContext(PG_SRC, ctx); vm.runInContext(CODE, ctx);
    if (opts.threadFails) win.QuoteThread.add = async (o) => { threadAdds.push(plain(o)); throw new Error('permission-denied'); };
    else { const real = win.QuoteThread.add; win.QuoteThread.add = async (o) => { threadAdds.push(plain(o)); return real.call(win.QuoteThread, o); }; }
    const send = async (type, payload, extra) => { await listeners[0]({ origin: ORIGIN, source: FRAME, data: Object.assign({ type, payload }, extra || {}) }); };
    return Object.assign(D, { win, toasts, notified, threadAdds, send });
  }
  const rev = (over) => Object.assign({ company: 'BK', quoteNumber: 'BKZZ-007R3', clientName: 'Mira Santos', total: 2700, grandTotal: 2700, items: [{ name: 'Sink', unitPrice: 1200, qty: 1, priceBy: { role: 'president', uid: NEIL, name: 'Neil Test', at: AT, salesPrice: 1000 } }, { name: 'Table', unitPrice: 1500, qty: 1 }],
    editableState: {}, rootQuoteId: ROOT_ID, parentQuoteId: 'qdR2' }, over || {});
  const lastAdd = (S) => S.adds.find((a) => a.coll === 'bk_quotes');

  it('a re-send AT his prices files approved, carried under kind figures: approvalCarriedFrom = the returned doc, approvalCarriedKind, his decision date; no approvedBy / snapshot, no approval request; the FYI has no amount and opens the new quote', async () => {
    const S = makeBridge({ docs: chainDocs() });
    await S.send('QUOTE_FILED', rev());
    const d = lastAdd(S).data;
    assert.deepEqual([d.status, d.approvalStatus], ['filed', 'approved']);
    assert.equal(d.approvalCarriedFrom, 'qdR2'); assert.equal(d.approvalCarriedKind, 'figures'); assert.equal(d.approvalCarriedOn, AT); assert.deepEqual(plain(d.approvalCarriedAt), { __ts: true });
    for (const k of ['approvedBy', 'approvedAt', 'approvedSnapshot', 'approvedByName']) assert.equal(k in d, false, k + ' is the President\'s alone');
    assert.equal(S.ops.includes('add approval_requests'), false);
    assert.equal(S.notified.length, 1); const n = S.notified[0];
    assert.equal(n.type, 'quote_carried'); assert.match(n.title, /Quote re-sent at your prices \(no action\)/);
    assert.match(n.body, /^Sales Tester: BKZZ-007R3 was filed under the prices you set on (Nov 20, 2026|20 Nov 2026)\. No action needed\.$/);
    assert.equal(CURRENCY.test(n.body), false); assert.match(n.link, /^quote-approval\/bk\.qdNEW/);
  });
  it('the "applied" thread entry: one entry on the new doc when lines carry priceBy (a held line does not count), the role is Sales, its text has no amount; its failure never fails the filing', async () => {
    const S = makeBridge({ docs: chainDocs() });
    await S.send('QUOTE_FILED', rev({ items: [rev().items[0], { name: 'Table', unitPrice: 1500, qty: 1, priceBy: { role: 'president', held: true } }] }));
    assert.equal(S.threadAdds.length, 1); const t = S.threadAdds[0];
    assert.equal(t.kind, 'applied'); assert.equal(t.text, 'Applied the President\'s prices on 1 line.'); assert.equal(t.role, 'employee'); assert.equal(t.coll, 'bk_quotes'); assert.equal(t.quoteId, lastAdd(S).id);
    const written = [...S.store.entries()].find(([k]) => k.startsWith('quote_comments/')); assert.ok(written, 'the entry was written'); assert.equal(written[1].authorRole, 'sales'); assert.equal('lines' in written[1], false);
    const F = makeBridge({ docs: chainDocs(), threadFails: true });
    await F.send('QUOTE_FILED', rev());
    assert.equal(lastAdd(F).data.approvalStatus, 'approved', 'the filing stands'); assert.equal(F.toasts.some((x) => /NOT saved/.test(x.m)), false);
    const none = makeBridge({ docs: chainDocs() }); await none.send('QUOTE_FILED', rev({ items: [{ name: 'Sink', unitPrice: 1200, qty: 1 }, { name: 'Table', unitPrice: 1500, qty: 1 }] }));
    assert.equal(none.threadAdds.length, 0, 'no priceBy line: no entry');
    const pres = makeBridge({ docs: chainDocs(), role: 'president', uid: NEIL }); await pres.send('QUOTE_FILED', rev()); assert.equal(pres.threadAdds.length, 0, 'never written by the President');
  });
  it('a re-send HIGHER than his price carries too (a price that holds or rises never needs him); an equal total carries', async () => {
    const S = makeBridge({ docs: chainDocs() });
    await S.send('QUOTE_FILED', rev({ total: 2900, grandTotal: 2900, items: [{ name: 'Sink', unitPrice: 1300, qty: 1 }, { name: 'Table', unitPrice: 1600, qty: 1 }] }));
    assert.equal(lastAdd(S).data.approvalStatus, 'approved'); assert.equal(lastAdd(S).data.approvalCarriedKind, 'figures');
  });
  it('a re-send with ONE line below his price goes to him: pending review, an approval request, an amount-free notification that counts the lines, the detailed reason (with amounts) in approvalWhy.text', async () => {
    const S = makeBridge({ docs: chainDocs() });
    await S.send('QUOTE_FILED', rev({ total: 2700, grandTotal: 2700, items: [{ name: 'Sink', unitPrice: 1100, qty: 1 }, { name: 'Table', unitPrice: 1600, qty: 1 }] }));
    const d = lastAdd(S).data;
    assert.deepEqual([d.status, d.approvalStatus], ['pending_approval', 'pending_review']); assert.ok(S.ops.includes('add approval_requests')); assert.equal('approvalCarriedFrom' in d, false); assert.equal('approvalCarriedKind' in d, false);
    assert.match(d.approvalWhy.text, new RegExp('Sink ' + PESO + '1100 is below the ' + PESO + '1200 you set, cost unknown'), 'the page keeps the amounts, in his words ("you set")');
    assert.equal(S.notified.length, 1); const n = S.notified[0];
    assert.equal(n.type, 'quote_review_request'); assert.equal(n.body, 'Sales Tester submitted "BKZZ-007R3" for Mira Santos — please review. 1 line is below the prices you set.');
    assert.equal(CURRENCY.test(n.body), false); assert.match(n.link, /^quote-approval\/bk\./);
    const T = makeBridge({ docs: chainDocs() });
    await T.send('QUOTE_FILED', rev({ total: 2000, grandTotal: 2000, items: [{ name: 'Sink', unitPrice: 1000, qty: 1 }, { name: 'Table', unitPrice: 1000, qty: 1 }] }));
    assert.equal(T.notified[0].body, 'Sales Tester submitted "BKZZ-007R3" for Mira Santos — please review. 2 lines are below the prices you set. The total is below the total at your prices.');
    const U = makeBridge({ docs: chainDocs() });
    await U.send('QUOTE_FILED', rev({ total: 2600, grandTotal: 2600, items: [{ name: 'Sink', unitPrice: 1200, qty: 1 }, { name: 'Table', unitPrice: 1400, qty: 1 }, { name: 'Extra', unitPrice: 0, qty: 1 }] }));
    assert.equal(U.notified[0].body.endsWith('1 line is below the prices you set. The total is below the total at your prices.'), true);
  });
  it('applying his prices but adding a bigger discount (the total falls below the bar) goes to him; adding a line carries (the known limit)', async () => {
    const S = makeBridge({ docs: chainDocs() });
    await S.send('QUOTE_FILED', rev({ total: 2600, grandTotal: 2600 }));
    assert.equal(lastAdd(S).data.approvalStatus, 'pending_review'); assert.match(S.notified[0].body, /^Sales Tester submitted .* — please review\. The total is below the total at your prices\.$/);
    const A = makeBridge({ docs: chainDocs() });
    await A.send('QUOTE_FILED', rev({ items: [...rev().items, { name: 'Added shelf', unitPrice: 300, qty: 1 }], total: 3000, grandTotal: 3000 }));
    assert.equal(lastAdd(A).data.approvalStatus, 'approved', 'a new line with an unknown standard carries (spec 8)');
  });
  it('approveAll ON never carries, not even for his own figures (the amount-free sentence, no reasons)', async () => {
    const S = makeBridge({ docs: chainDocs({ 'settings/quote_builder': { approveAll: true } }) });
    await S.send('QUOTE_FILED', rev());
    assert.equal(lastAdd(S).data.approvalStatus, 'pending_review'); assert.equal('approvalCarriedFrom' in lastAdd(S).data, false);
    assert.match(lastAdd(S).data.approvalWhy.text, /Every quote needs your approval/);
    assert.equal(S.notified[0].body, 'Sales Tester submitted "BKZZ-007R3" for Mira Santos — please review.');
    for (const docs of [chainDocs({ 'settings/quote_builder': { approveAll: false } }), chainDocs()]) { const T = makeBridge({ docs }); await T.send('QUOTE_FILED', rev()); assert.equal(lastAdd(T).data.approvalStatus, 'approved'); }
  });
  it('a builder that disagrees (approvalCovered false) sends a figures-carry-able quote to him; true carries', async () => {
    const S = makeBridge({ docs: chainDocs() });
    await S.send('QUOTE_FILED', rev({ approvalCovered: false }));
    assert.equal(lastAdd(S).data.approvalStatus, 'pending_review'); assert.match(lastAdd(S).data.approvalWhy.text, /disagree/);
    assert.equal(S.notified[0].body, 'Sales Tester submitted "BKZZ-007R3" for Mira Santos — please review.');
    const T = makeBridge({ docs: chainDocs() }); await T.send('QUOTE_FILED', rev({ approvalCovered: true })); assert.equal(lastAdd(T).data.approvalStatus, 'approved');
  });
  it('a STALE offer falls back to today\'s logic: a later approval by him in the chain voids it (and a re-send below that approval goes to him as before); a later return voids it', async () => {
    const later = { company: 'BK', quoteNumber: 'BKZZ-007R4', rootQuoteId: ROOT_ID, createdBy: AGENT, status: 'filed', approvalStatus: 'approved', approvedBy: NEIL, approvedAt: ts('2026-11-21T02:00:00.000Z'), total: 3000, items: [{ name: 'Sink', unitPrice: 1500, qty: 1 }, { name: 'Table', unitPrice: 1500, qty: 1 }],
      approvedSnapshot: { total: 3000, lines: [{ key: 'sink||', unit: 1500 }, { key: 'table||', unit: 1500 }], at: '2026-11-21T02:00:00.000Z', by: NEIL, byName: 'N', quoteNumber: 'R4' } };
    const S = makeBridge({ docs: chainDocs({ 'bk_quotes/qdR4': later }) });
    await S.send('QUOTE_FILED', rev());   // 2700 is above the figures bar but BELOW his later approval of 3000
    const d = lastAdd(S).data; assert.equal(d.approvalStatus, 'pending_review'); assert.equal('approvalCarriedKind' in d, false);
    assert.match(d.approvalWhy.text, /you approved/, 'today\'s wording');
    assert.match(S.notified[0].body, /—[^—]*₱?\d/, 'today\'s notification (it names the total) — the figures path was not taken');
    const R = makeBridge({ docs: chainDocs({ 'bk_quotes/qdRet': { company: 'BK', rootQuoteId: ROOT_ID, createdBy: AGENT, approvalStatus: 'needs_revision', returnedAt: ts('2026-11-22T00:00:00.000Z') } }) });
    await R.send('QUOTE_FILED', rev()); assert.equal('approvalCarriedKind' in lastAdd(R).data, false, 'a later return voids the offer');
  });
  it('a carried approval does not void the offer; the parent link must be the returned doc (a re-send naming the root, or a returned doc without the carry, falls back)', async () => {
    const carried = { company: 'BK', rootQuoteId: ROOT_ID, createdBy: AGENT, approvalStatus: 'approved', approvalCarriedFrom: ROOT_ID, approvedBy: NEIL, approvedAt: ts('2026-11-25T00:00:00.000Z'), total: 2000, items: [] };
    const S = makeBridge({ docs: chainDocs({ 'bk_quotes/qdCar': carried }) }); await S.send('QUOTE_FILED', rev());
    assert.equal(lastAdd(S).data.approvalCarriedKind, 'figures');
    const T = makeBridge({ docs: chainDocs() }); await T.send('QUOTE_FILED', rev({ parentQuoteId: ROOT_ID }));
    assert.equal('approvalCarriedKind' in lastAdd(T).data, false, 'the root is not the returned doc: today\'s logic (and 2700 is above the 2500 he approved: an ordinary carry)'); assert.equal(lastAdd(T).data.approvalCarriedFrom, ROOT_ID);
    const U = makeBridge({ docs: chainDocs({ 'bk_quotes/qdR2': returned({ presidentFigures: Object.assign(returned().presidentFigures, { carry: false }) }) }) }); await U.send('QUOTE_FILED', rev());
    assert.equal('approvalCarriedKind' in lastAdd(U).data, false);
  });
  it('a chain that cannot be read goes to him (never silently carried): the amount-free path is not taken, the error sentence is', async () => {
    const S = makeBridge({ docs: chainDocs(), failChain: true });
    await S.send('QUOTE_FILED', rev());
    assert.equal(lastAdd(S).data.approvalStatus, 'pending_review'); assert.match(lastAdd(S).data.approvalWhy.text, /Could not check the earlier approval/);
  });
  it('a quote returned with figures whose chain was NEVER approved before still offers its bar (the offer is itself the bar)', async () => {
    const docs = { ['bk_quotes/' + ROOT_ID]: root({ approvalStatus: 'filed', approvedBy: undefined, approvedSnapshot: undefined }), 'bk_quotes/qdR2': returned() };
    const S = makeBridge({ docs }); await S.send('QUOTE_FILED', rev());
    assert.equal(lastAdd(S).data.approvalStatus, 'approved'); assert.equal(lastAdd(S).data.approvalCarriedKind, 'figures');
    const T = makeBridge({ docs }); await T.send('QUOTE_FILED', rev({ total: 2600, grandTotal: 2600, items: [{ name: 'Sink', unitPrice: 1100, qty: 1 }, { name: 'Table', unitPrice: 1500, qty: 1 }] }));
    assert.equal(lastAdd(T).data.approvalStatus, 'pending_review');
  });
  it('QUOTE_UPDATE on a returned-with-figures quote is refused in place and filed as a NEW revision (next suffix from the highest), parent = the source, same chain — and the gate then carries it; a returned quote with notes only still updates in place', async () => {
    const S = makeBridge({ docs: chainDocs() });
    await S.send('QUOTE_UPDATE', rev({ quoteNumber: 'BKZZ-007R2', parentQuoteId: null }), { docId: 'qdR2', collection: 'bk_quotes' });
    assert.equal(S.updates.some((u) => u.id === 'qdR2'), false, 'the returned quote is NOT edited in place');
    const a = lastAdd(S); assert.ok(a); assert.equal(a.data.quoteNumber, 'BKZZ-007R3'); assert.equal(a.data.parentQuoteId, 'qdR2'); assert.equal(a.data.rootQuoteId, ROOT_ID);
    assert.equal(a.data.approvalStatus, 'approved'); assert.equal(a.data.approvalCarriedKind, 'figures');
    assert.ok(S.toasts.some((t) => t.t === 'info' && /returned with the President's prices, so your changes were filed as a new revision \(R3\)/.test(t.m)), S.toasts.map((t) => t.m).join('|'));
    const notesOnly = chainDocs({ 'bk_quotes/qdR2': returned({ presidentFigures: Object.assign(returned().presidentFigures, { lines: [{ i: 0, name: 'Sink', qty: 1, from: 1000, to: null, note: 'check' }], changed: 0, carry: false }) }) });
    const N = makeBridge({ docs: notesOnly });
    await N.send('QUOTE_UPDATE', rev({ quoteNumber: 'BKZZ-007R2', parentQuoteId: null }), { docId: 'qdR2', collection: 'bk_quotes' });
    assert.ok(N.updates.some((u) => u.id === 'qdR2'), 'a notes-only return still updates in place, as before'); assert.equal(N.adds.filter((x) => x.coll === 'bk_quotes').length, 0);
  });
  it('the bridge\'s allowlisted data never carries presidentFigures (the rules refuse it from anyone but the President): a payload that names it is not copied', async () => {
    const S = makeBridge({ docs: chainDocs() });
    await S.send('QUOTE_FILED', rev({ presidentFigures: { mode: 'approve', carry: true }, approvalCarriedKind: 'figures-forged' }));
    assert.equal('presidentFigures' in lastAdd(S).data, false);
    assert.equal(lastAdd(S).data.approvalCarriedKind, 'figures', 'the kind is the gate\'s, never the payload\'s');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('6 · F-10: "Save edits & Approve" hands the builder\'s whole answer through moneyEdits (js/app.js saveReviewedPartnerQuote)', () => {
  const BAR = piece(APP, /^async function saveReviewedPartnerQuote\([\s\S]*?\n\}/m, 'saveReviewedPartnerQuote');
  it('the edits are the allowlist (every money field and the editable copy) plus the client fields; the builder\'s cost record rides along; a quote with a stale net can no longer be saved', async () => {
    const calls = []; const win = {};
    const ctx = vm.createContext({ window: win, document: { getElementById: () => ({}) }, console, firebase: { firestore: { FieldValue: FV } }, currentUser: { uid: NEIL }, Notifs: { showToast() {}, success() {} },
      requestBuilderState: async () => ({ payload: { clientName: 'Mira', clientCompany: 'Co', items: [{ name: 'A', unitPrice: 5 }], subtotal: 5, total: 4, grandTotal: 4, netAmount: 4, vatAmount: 0, payment: { downPayment: 2, balance: 2 }, editableState: { n: 1 }, discountAmount: 1, quoteNumber: 'X', rootQuoteId: 'r' }, costSidecar: { v: 1, items: [{ i: 0, n: 'A' }] } }),
      promptDialog: async () => '', navigateTo() {} });
    vm.runInContext(QF_SRC, ctx); win.ensureScript = async () => {}; win.decideQuoteApproval = async (o) => { calls.push(plain(o)); return { ok: true }; }; win.quoteApprovalRefOf = () => 'bk.q';
    vm.runInContext(BAR + '\nglobalThis.__bar = saveReviewedPartnerQuote;', ctx);
    await ctx.__bar({ quoteId: 'q1', partnerUid: AGENT, quoteNumber: 'X', clientName: 'Mira', quoteColl: 'bk_quotes' }, 'approve');
    assert.equal(calls.length, 1); const e = calls[0].edits;
    for (const k of ['items', 'subtotal', 'volumeBreakTotal', 'total', 'grandTotal', 'optionsMode', 'options', 'optionsBasis', 'vatIncluded', 'vatAmount', 'discountPct', 'discountAmount', 'netAmount', 'deliveryInstall', 'commissionPct', 'commissionAmount', 'payment', 'editableState',
      'clientName', 'clientCompany', 'clientAddress', 'clientPhone', 'clientEmail', 'editedByPresident', 'editedAt', 'editedBy']) assert.ok(k in e, k);
    assert.equal(e.netAmount, 4); assert.deepEqual(e.payment, { downPayment: 2, balance: 2 });
    for (const k of ['quoteNumber', 'rootQuoteId']) assert.equal(k in e, false, k);
    assert.deepEqual(calls[0].costSidecar, { v: 1, items: [{ i: 0, n: 'A' }] }, 'the cost record rides along so approval step 6 runs');
    assert.match(BAR, /\.\.\.window\.QuoteFigures\.moneyEdits\(payload\)/);
  });
});
