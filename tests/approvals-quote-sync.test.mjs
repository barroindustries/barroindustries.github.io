// tests/approvals-quote-sync.test.mjs — js/screens/approvals.js: when the President / a Manager approves a quote, or returns it for revision, its entry on the website
// request / project brief it was started from follows (specs/QUOTE-BUILDER-CONFIGURATOR-SPEC.md §8; extra item B of work chunk WS-5C).
//
// js/screens/approvals.js is not a module and cannot be required, so the pieces under test are lifted out of ITS OWN SOURCE by name (every top-level function in
// that file closes with a brace in column 0) and run in a node:vm context with in-memory stand-ins for Firestore, the toasts and the notifications — the same way
// tests/quote-link.test.mjs runs js/app.js. window.quoteStateFields is lifted from js/config.js too, so "approved" really does mean status 'filed' here, as it does
// in the app. The four write sites (the Approve and Return buttons of the list, and of the review panel that also saves the President's edits) run for real, the
// review panel against a small stand-in for openPage. The firestore.rules update allowlists of the two request collections are READ from firestore.rules, so the
// fields the sync writes are checked against the rule that must accept them. Fixtures are FAKE (invented names and odd-figure pesos): the repository is public.
//
// Mutation-tested in scratch copies (never the shared tree): the sync writing the request's own status, quoteDocId or lastQuoteAt; a sync that creates an entry when
// there is none, or updates every entry instead of the one for this quote; an unchecked or kind-unpinned reference; an unchecked quote collection; the wrong
// request collection for a brief; a sync that throws into the approval (no try/catch) or that is awaited before the quote itself is saved; a missing call on any of the
// four write sites; approve mapped to anything but the quote doc's own status ('filed'); no cache invalidation; each must fail here.
//
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));   // objects made inside a vm context have that realm's prototypes
const SRC = read('js/screens/approvals.js');
const piece = (src, re, what) => { const m = src.match(re); assert.ok(m, `${what} not found`); return m[0]; };
const SYNC = piece(SRC, /^window\.syncQuoteStatusToRequest = async function[\s\S]*?\n\};/m, 'window.syncQuoteStatusToRequest in js/screens/approvals.js');
const APPROVE = piece(SRC, /^async function approveQuoteApproval\([\s\S]*?\n\}/m, 'approveQuoteApproval');
const RETURN = piece(SRC, /^async function returnQuoteToPartner\([\s\S]*?\n\}/m, 'returnQuoteToPartner');
const REVIEW = piece(SRC, /^async function openQuoteApprovalReview\([\s\S]*?\n\}/m, 'openQuoteApprovalReview');
const STATE_FIELDS = piece(read('js/config.js'), /^window\.quoteStateFields = function \(state\) \{[\s\S]*?\n\};/m, 'window.quoteStateFields in js/config.js');
const ESC_HTML = piece(read('js/modules.js'), /function escHtml\(str\) \{[\s\S]*?\n\}/, 'escHtml in js/modules.js');

const QR = 'QR-261021-K7M2PX', CIR = 'CIR-261022-ABCDEF';
const RAW_QR = `quote_requests/${QR}`, RAW_CIR = `client_info_requests/${CIR}`;
const Q1 = 'qd00000000000000001', Q2 = 'qd00000000000000002';
const RAW_Q1 = `bk_quotes/${Q1}`, RAW_Q2 = `bk_quotes/${Q2}`;
const entry = (docId, over) => Object.assign({ docId, coll: 'bk_quotes', quoteNumber: 'BK-ML-WB-261028-001', version: 1, total: 88739, status: 'pending_approval', filedAt: '2026-10-28T02:15:00.000Z', byName: 'Staff One' }, over || {});
const quoteDoc = (over) => Object.assign({ status: 'pending_approval', approvalStatus: 'pending_review', quoteNumber: 'BK-ML-WB-261028-001', clientName: 'Juan Dela Cruz', total: 88739, sourceRef: { kind: 'qr', ref: QR } }, over || {});
const requestDoc = (over) => Object.assign({ status: 'quoted', quoteDocId: Q1, quotes: [entry(Q1)] }, over || {});

// ── the sandbox: an in-memory Firestore that records every operation in order ────────────────────────────────────────────────────────
function makeApp(opts) {
  opts = opts || {};
  const store = new Map(Object.entries(opts.docs || {}).map(([k, v]) => [k, plain(v)]));
  const ops = [], updates = [], toasts = [], warns = [], invalidated = [], notes = [], audits = [], closed = [];
  const stamp = { __serverTimestamp: true };
  const isRequest = (key) => /^(quote_requests|client_info_requests)\//.test(key);
  const docRef = (coll, id) => {
    const key = coll + '/' + id;
    return {
      id,
      get: async () => {
        ops.push('get ' + key);
        if (opts.failGet && (isRequest(key) || opts.failGet === 'all')) throw Object.assign(new Error('network down'), { code: 'unavailable' });
        return { exists: store.has(key), id, data: () => plain(store.get(key)) };
      },
      update: async (patch) => {
        ops.push('update ' + key); updates.push({ key, patch });
        if (opts.failUpdate && isRequest(key)) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
        store.set(key, Object.assign({}, store.get(key), patch));
      },
    };
  };
  const db = { collection: (coll) => ({
    doc: (id) => docRef(coll, id),
    where: (field, op, value) => ({ get: async () => {
      ops.push(`where ${coll}.${field} ${op} ${value}`);
      const hits = [...store.keys()].filter((k) => k.startsWith(coll + '/') && store.get(k)[field] === value);
      return { docs: hits.map((k) => ({ ref: docRef(coll, k.slice(coll.length + 1)) })) };
    } }),
  }) };
  const win = {
    QUOTE_COLLECTIONS: ['bk_quotes', 'bs_quotes'],
    logAudit: (...a) => audits.push(a), invalidateBsQuotesCache: () => {},
    skeletonHtml: () => '', renderEmptyState: () => '', quoteBuilderPageFor: () => 'bk-quote-builder', reopenQuoteFromDoc: () => {},
  };
  // the review panel: openPage hands back a panel whose body / foot find their controls by selector (one stand-in each, so a handler wired by the code can be fired)
  const controls = {};
  const control = (sel, extra) => (controls[sel] = controls[sel] || Object.assign({ value: '', handlers: {}, addEventListener(t, f) { this.handlers[t] = f; }, removeAttribute() {} }, extra));
  const part = () => ({ innerHTML: '', querySelector: (sel) => control(sel) });
  const panel = { isConnected: true, body: part(), foot: part(), querySelector(sel) { return sel === '.page-panel-body' ? this.body : sel === '.page-panel-foot' ? this.foot : null; } };
  const ctx = vm.createContext({
    window: win, db, console: { log() {}, error() {}, warn: (...a) => warns.push(a) },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => stamp } } },
    currentUser: { uid: 'u-pres' },
    Notifs: {
      showToast: (m, t) => toasts.push({ m, t }), success: (m) => toasts.push({ m, t: 'success' }), error: (m) => toasts.push({ m, t: 'error' }),
      send: async (uid, n) => { ops.push('notify'); notes.push({ uid, n }); },
    },
    dbCacheInvalidate: (k) => invalidated.push(k),
    openPage: () => panel, closeModal: () => closed.push(true), emojiIcon: () => '',
  });
  vm.runInContext([STATE_FIELDS, ESC_HTML, SYNC, APPROVE, RETURN, REVIEW].join('\n'), ctx);
  const call = (code, ...args) => { ctx.__a = args; return vm.runInContext(code, ctx); };
  return { ctx, win, store, ops, updates, toasts, warns, invalidated, notes, audits, closed, panel, controls,
    sync: (coll, id, state) => call('window.syncQuoteStatusToRequest(...__a)', coll, id, state),
    approve: (id, coll) => call('approveQuoteApproval(...__a)', id, 'u-agent', 'BK-ML-WB-261028-001', 'Juan Dela Cruz', coll),
    ret: (id, coll, notes) => call('returnQuoteToPartner(...__a)', id, 'u-agent', 'BK-ML-WB-261028-001', 'Juan Dela Cruz', notes || 'make it 2 sinks', coll),
    review: (id, coll) => call('openQuoteApprovalReview(...__a)', { quoteId: id, agentId: 'u-agent', quoteNumber: 'BK-ML-WB-261028-001', clientName: 'Juan Dela Cruz', quoteColl: coll }, () => ops.push('onDone')),
    fire: (sel) => controls[sel].handlers.click(),
  };
}
const lastPatch = (S, key) => S.updates.filter((u) => u.key === key).map((u) => u.patch).pop();
const entryOf = (S, rawReq, docId) => (plain(S.store.get(rawReq).quotes) || []).find((x) => x && x.docId === docId);

// the allowlists firestore.rules gives a Sales / senior-admin update of each request collection
const RULES = read('firestore.rules');
const ruleBlock = (head) => { const s = RULES.indexOf(head); assert.ok(s > 0, head); return RULES.slice(s, RULES.indexOf('\n    }\n', s) + 7); };
const ALLOW = {
  quote_requests: ruleBlock('match /quote_requests/{ref} {').match(/hasOnly\(\[([^\]]+)\]\)/)[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')),
  client_info_requests: ruleBlock('match /client_info_requests/{ref} {').match(/hasOnly\(\[([^\]]+)\]\)/)[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')),
};

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('syncQuoteStatusToRequest — the request entry follows the quote the President just actioned', () => {
  it('approve: the entry for this quote goes pending_approval -> filed (the quote doc\'s own status after approval); every other entry is untouched, in the same order', async () => {
    const other = entry(Q2, { status: 'needs_revision', quoteNumber: 'BK-ML-WB-261028-001 (2)', version: 2 });
    const S = makeApp({ docs: { [RAW_Q1]: quoteDoc(), [RAW_QR]: requestDoc({ quotes: [other, entry(Q1)] }) } });
    assert.equal(await S.sync('bk_quotes', Q1, 'approved'), true);
    const p = lastPatch(S, RAW_QR);
    assert.deepEqual(plain(p.quotes), [other, entry(Q1, { status: 'filed' })], 'only the matching entry changed, and only its status');
    assert.equal(entryOf(S, RAW_QR, Q1).total, 88739);
    assert.equal(entryOf(S, RAW_QR, Q1).filedAt, '2026-10-28T02:15:00.000Z');
  });

  it('return for revision: the entry goes to needs_revision', async () => {
    const S = makeApp({ docs: { [RAW_Q1]: quoteDoc(), [RAW_QR]: requestDoc() } });
    assert.equal(await S.sync('bk_quotes', Q1, 'needs_revision'), true);
    assert.equal(entryOf(S, RAW_QR, Q1).status, 'needs_revision');
  });

  it('reject: a quote state of "rejected" is mirrored as the quote doc\'s own status too', async () => {
    const S = makeApp({ docs: { [RAW_Q1]: quoteDoc(), [RAW_QR]: requestDoc() } });
    assert.equal(await S.sync('bk_quotes', Q1, 'rejected'), true);
    assert.equal(entryOf(S, RAW_QR, Q1).status, 'rejected');
  });

  it('writes ONLY `quotes` and `updatedAt` (server time) — never the request\'s own status, quoteDocId or lastQuoteAt — and both are on the firestore.rules allowlist', async () => {
    const S = makeApp({ docs: { [RAW_Q1]: quoteDoc(), [RAW_QR]: requestDoc() } });
    await S.sync('bk_quotes', Q1, 'approved');
    const p = lastPatch(S, RAW_QR);
    assert.deepEqual(Object.keys(p).sort(), ['quotes', 'updatedAt']);
    assert.deepEqual(plain(p.updatedAt), { __serverTimestamp: true });
    for (const k of Object.keys(p)) assert.ok(ALLOW.quote_requests.includes(k), `${k} is not allowed by the quote_requests update rule`);
    for (const k of ['quotes', 'updatedAt']) assert.ok(ALLOW.client_info_requests.includes(k), `${k} is not allowed by the client_info_requests update rule`);
    assert.equal(S.store.get(RAW_QR).status, 'quoted');
    assert.equal(S.store.get(RAW_QR).quoteDocId, Q1);
  });

  it('the request\'s own status is never touched, whatever it is — a staff status choice, a client acceptance or an archive survives an approval', async () => {
    for (const status of ['new', 'in_review', 'contacted', 'quoted', 'converted', 'archived', undefined]) {
      const S = makeApp({ docs: { [RAW_Q1]: quoteDoc(), [RAW_QR]: requestDoc({ status }) } });
      assert.equal(await S.sync('bk_quotes', Q1, 'approved'), true, String(status));
      assert.equal(S.store.get(RAW_QR).status, status, `status ${status} must be left as it was`);
      assert.equal('status' in lastPatch(S, RAW_QR), false);
    }
  });

  it('a brief (kind "cir") is read and written in client_info_requests, never in quote_requests', async () => {
    const S = makeApp({ docs: { [RAW_Q1]: quoteDoc({ sourceRef: { kind: 'cir', ref: CIR } }), [RAW_CIR]: requestDoc({ status: 'contacted' }), [RAW_QR]: requestDoc() } });
    assert.equal(await S.sync('bk_quotes', Q1, 'approved'), true);
    assert.deepEqual(S.ops.filter((o) => /^(get|update) (quote_requests|client_info_requests)/.test(o)), [`get ${RAW_CIR}`, `update ${RAW_CIR}`]);
    assert.equal(entryOf(S, RAW_CIR, Q1).status, 'filed');
    assert.equal(entryOf(S, RAW_QR, Q1).status, 'pending_approval', 'the QR document of the same shape is untouched');
    assert.equal(S.store.get(RAW_CIR).status, 'contacted');
  });

  it('drops the cached Sales list the request is in (so the new status shows at once) — only after the write succeeded', async () => {
    const S = makeApp({ docs: { [RAW_Q1]: quoteDoc(), [RAW_QR]: requestDoc(), [RAW_Q2]: quoteDoc({ sourceRef: { kind: 'cir', ref: CIR } }), [RAW_CIR]: requestDoc({ quotes: [entry(Q2)] }) } });
    await S.sync('bk_quotes', Q1, 'approved'); assert.deepEqual(S.invalidated, ['qr-list']);
    await S.sync('bk_quotes', Q2, 'approved'); assert.deepEqual(S.invalidated, ['qr-list', 'cir-list']);
    const F = makeApp({ failUpdate: true, docs: { [RAW_Q1]: quoteDoc(), [RAW_QR]: requestDoc() } });
    await F.sync('bk_quotes', Q1, 'approved'); assert.deepEqual(F.invalidated, []);
  });

  it('a quote that did not start on the website (no sourceRef, or a null one) reads the quote and writes nothing', async () => {
    for (const sourceRef of [undefined, null, 'QR-261021-K7M2PX', 7, []]) {
      const S = makeApp({ docs: { [RAW_Q1]: quoteDoc({ sourceRef }), [RAW_QR]: requestDoc() } });
      assert.equal(await S.sync('bk_quotes', Q1, 'approved'), false, JSON.stringify(sourceRef));
      assert.deepEqual(S.ops, [`get ${RAW_Q1}`]);
      assert.equal(S.updates.length, 0);
      assert.deepEqual(S.toasts, []);
    }
  });

  it('a forged or malformed sourceRef writes nothing: a ref of the wrong kind, a padded / lower-case / short one, a path, a prototype-ish kind', async () => {
    const bad = [
      { kind: 'qr', ref: CIR }, { kind: 'cir', ref: QR }, { kind: 'QR', ref: QR }, { kind: 'x', ref: QR }, { kind: 'constructor', ref: QR }, { kind: ['qr'], ref: QR },
      { kind: 'qr', ref: QR.toLowerCase() }, { kind: 'qr', ref: QR + '\n' }, { kind: 'qr', ref: ' ' + QR }, { kind: 'qr', ref: QR + 'X' }, { kind: 'qr', ref: 'QR-26102-K7M2PX' },
      { kind: 'qr', ref: '../quote_requests/' + QR }, { kind: 'qr', ref: [QR] }, { kind: 'qr' }, { ref: QR }, {},
    ];
    for (const sourceRef of bad) {
      const S = makeApp({ docs: { [RAW_Q1]: quoteDoc({ sourceRef }), [RAW_QR]: requestDoc(), [RAW_CIR]: requestDoc() } });
      assert.equal(await S.sync('bk_quotes', Q1, 'approved'), false, JSON.stringify(sourceRef));
      assert.equal(S.updates.length, 0, JSON.stringify(sourceRef));
      assert.deepEqual(S.ops, [`get ${RAW_Q1}`], 'no request document was even read for ' + JSON.stringify(sourceRef));
    }
  });

  it('it changes an entry that filing created and creates none: a quote the request has no entry for (a forged link) plants nothing', async () => {
    const S = makeApp({ docs: { [RAW_Q1]: quoteDoc(), [RAW_QR]: requestDoc({ quotes: [entry(Q2)] }) } });
    assert.equal(await S.sync('bk_quotes', Q1, 'approved'), false);
    assert.equal(S.updates.length, 0);
    const E = makeApp({ docs: { [RAW_Q1]: quoteDoc(), [RAW_QR]: requestDoc({ quotes: undefined }) } });
    assert.equal(await E.sync('bk_quotes', Q1, 'approved'), false);
    assert.equal(E.updates.length, 0);
    const J = makeApp({ docs: { [RAW_Q1]: quoteDoc(), [RAW_QR]: requestDoc({ quotes: 'not a list' }) } });
    assert.equal(await J.sync('bk_quotes', Q1, 'approved'), false);
  });

  it('only the entry whose docId is this quote changes; an entry already at the new status is not rewritten (no write at all); junk entries ride along untouched', async () => {
    const junk = [null, 'x', 7, [1], { docId: 5, status: 'filed' }];
    const S = makeApp({ docs: { [RAW_Q1]: quoteDoc(), [RAW_QR]: requestDoc({ quotes: [...junk, entry(Q2, { status: 'accepted' }), entry(Q1)] }) } });
    assert.equal(await S.sync('bk_quotes', Q1, 'approved'), true);
    assert.deepEqual(plain(lastPatch(S, RAW_QR).quotes), [...junk, entry(Q2, { status: 'accepted' }), entry(Q1, { status: 'filed' })]);
    const same = makeApp({ docs: { [RAW_Q1]: quoteDoc(), [RAW_QR]: requestDoc({ quotes: [entry(Q1, { status: 'filed' })] }) } });
    assert.equal(await same.sync('bk_quotes', Q1, 'approved'), false);
    assert.equal(same.updates.length, 0, 'nothing to change is nothing to write');
  });

  it('the list never grows or shrinks (the 50-entry cap of the rules is untouched): the same number of entries goes back', async () => {
    const many = Array.from({ length: 50 }, (_, i) => entry('qd' + String(100 + i).padStart(18, '0')));
    many[49] = entry(Q1);
    const S = makeApp({ docs: { [RAW_Q1]: quoteDoc(), [RAW_QR]: requestDoc({ quotes: many }) } });
    await S.sync('bk_quotes', Q1, 'approved');
    assert.equal(lastPatch(S, RAW_QR).quotes.length, 50);
    assert.equal(plain(lastPatch(S, RAW_QR).quotes).filter((x) => x.status === 'filed').length, 1);
  });

  it('a quote collection that is not one of the two, a malformed quote id, an unknown state: nothing is read, nothing written', async () => {
    const S = makeApp({ docs: { [RAW_Q1]: quoteDoc(), [RAW_QR]: requestDoc(), 'users/u1': { role: 'president' } } });
    assert.equal(await S.sync('users', 'u1', 'approved'), false);
    assert.equal(await S.sync('bk_quotes', '../users/u1', 'approved'), false);
    assert.equal(await S.sync('bk_quotes', '', 'approved'), false);
    assert.equal(await S.sync('bk_quotes', 5, 'approved'), false);
    assert.equal(await S.sync('bk_quotes', Q1, 'weird'), false);
    assert.equal(await S.sync('bk_quotes', Q1, undefined), false);
    assert.equal(await S.sync('bk_quotes', Q1, 'toString'), false, 'an inherited name is not a quote state');
    assert.deepEqual(S.ops, []);
  });

  it('a quote or a request that is gone (erased, deleted) is a quiet false: no write, no toast', async () => {
    const A = makeApp({ docs: { [RAW_QR]: requestDoc() } });
    assert.equal(await A.sync('bk_quotes', Q1, 'approved'), false);
    const B = makeApp({ docs: { [RAW_Q1]: quoteDoc() } });
    assert.equal(await B.sync('bk_quotes', Q1, 'approved'), false);
    for (const S of [A, B]) { assert.equal(S.updates.length, 0); assert.deepEqual(S.toasts, []); assert.deepEqual(S.warns, []); }
  });

  it('a failed read or write never throws: it returns false, logs, and says so with an info toast (the approval it follows is already saved)', async () => {
    const W = makeApp({ failUpdate: true, docs: { [RAW_Q1]: quoteDoc(), [RAW_QR]: requestDoc() } });
    assert.equal(await W.sync('bk_quotes', Q1, 'approved'), false);
    assert.equal(W.warns.length, 1);
    assert.deepEqual(W.toasts.map((t) => t.t), ['info']);
    assert.match(W.toasts[0].m, /could not update the request link/);
    assert.equal(entryOf(W, RAW_QR, Q1).status, 'pending_approval');
    const R = makeApp({ failGet: true, docs: { [RAW_Q1]: quoteDoc(), [RAW_QR]: requestDoc() } });
    assert.equal(await R.sync('bk_quotes', Q1, 'approved'), false);
    const Q = makeApp({ failGet: 'all', docs: { [RAW_Q1]: quoteDoc(), [RAW_QR]: requestDoc() } });
    assert.equal(await Q.sync('bk_quotes', Q1, 'approved'), false);
    for (const S of [R, Q]) { assert.equal(S.warns.length, 1); assert.equal(S.updates.length, 0); }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the four places the President acts on a quote all sync — and a failing sync never blocks the approval', () => {
  const docs = () => ({ [RAW_Q1]: quoteDoc(), [RAW_QR]: requestDoc(), 'approval_requests/ar1': { type: 'bs_quote', quoteId: Q1, status: 'pending' } });
  const seq = (S) => S.ops.filter((o) => !/^onDone$/.test(o));

  it('Approve (list / registry): quote saved as filed + approved, THEN the request entry -> filed, THEN the approval request resolved and the agent told', async () => {
    const S = makeApp({ docs: docs() });
    await S.approve(Q1, 'bk_quotes');
    assert.deepEqual(seq(S), [`update ${RAW_Q1}`, `get ${RAW_Q1}`, `get ${RAW_QR}`, `update ${RAW_QR}`, `where approval_requests.quoteId == ${Q1}`, 'update approval_requests/ar1', 'notify']);
    assert.deepEqual([S.store.get(RAW_Q1).status, S.store.get(RAW_Q1).approvalStatus], ['filed', 'approved']);
    assert.equal(entryOf(S, RAW_QR, Q1).status, 'filed');
    assert.equal(S.store.get('approval_requests/ar1').status, 'approved');
    assert.equal(S.notes.length, 1);
    assert.ok(S.toasts.some((t) => t.t === 'success' && /approved and filed/.test(t.m)));
  });

  it('Return (list / registry): quote saved as needs_revision, then the request entry -> needs_revision, then the approval request returned and the agent told', async () => {
    const S = makeApp({ docs: docs() });
    await S.ret(Q1, 'bk_quotes');
    assert.deepEqual(seq(S), [`update ${RAW_Q1}`, `get ${RAW_Q1}`, `get ${RAW_QR}`, `update ${RAW_QR}`, `where approval_requests.quoteId == ${Q1}`, 'update approval_requests/ar1', 'notify']);
    assert.deepEqual([S.store.get(RAW_Q1).status, S.store.get(RAW_Q1).approvalStatus], ['needs_revision', 'needs_revision']);
    assert.equal(entryOf(S, RAW_QR, Q1).status, 'needs_revision');
    assert.equal(S.store.get('approval_requests/ar1').status, 'returned');
    assert.equal(S.notes.length, 1);
    assert.ok(S.toasts.some((t) => t.t === 'error' && /returned\./.test(t.m)));
  });

  const openReview = async (S) => {
    S.store.set(RAW_Q1, Object.assign({}, S.store.get(RAW_Q1), { scope: 'Supply of 2 sinks', total: 88739 }));
    await S.review(Q1, 'bk_quotes');
    const field = (sel, v) => { S.panel.body.querySelector(sel).value = v; };       // the panel's own inputs (what the President typed)
    field('#qar-client', ' Juan Dela Cruz '); field('#qar-scope', 'x'); field('#qar-total', '91000'); field('#qar-notes', 'rushed');
  };

  it('Save & Approve (review panel): the President\'s edits are saved, the request entry follows -> filed, the panel closes', async () => {
    const S = makeApp({ docs: docs() });
    await openReview(S);
    await S.fire('#qar-approve');
    assert.equal(S.store.get(RAW_Q1).total, 91000);
    assert.deepEqual([S.store.get(RAW_Q1).status, S.store.get(RAW_Q1).approvalStatus], ['filed', 'approved']);
    assert.equal(entryOf(S, RAW_QR, Q1).status, 'filed');
    const at = (o) => S.ops.indexOf(o);
    assert.ok(at(`update ${RAW_Q1}`) < at(`update ${RAW_QR}`) && at(`update ${RAW_QR}`) < at('update approval_requests/ar1') && at('update approval_requests/ar1') < at('notify'));
    assert.deepEqual([S.closed.length, S.ops.includes('onDone')], [1, true]);
  });

  it('Save & Return (review panel): the edits and the notes are saved, the request entry follows -> needs_revision, the panel closes', async () => {
    const S = makeApp({ docs: docs() });
    await openReview(S);
    await S.fire('#qar-return');
    assert.equal(S.store.get(RAW_Q1).presidentNotes, 'rushed');
    assert.equal(S.store.get(RAW_Q1).status, 'needs_revision');
    assert.equal(entryOf(S, RAW_QR, Q1).status, 'needs_revision');
    assert.deepEqual([S.closed.length, S.ops.includes('onDone')], [1, true]);
  });

  it('a sync that FAILS (the rules not deployed yet, offline) costs the request link only: every site still saves, resolves, notifies, toasts success and closes', async () => {
    const A = makeApp({ failUpdate: true, docs: docs() });
    await A.approve(Q1, 'bk_quotes');
    assert.equal(A.store.get(RAW_Q1).status, 'filed');
    assert.equal(A.store.get('approval_requests/ar1').status, 'approved');
    assert.equal(A.notes.length, 1);
    assert.ok(A.toasts.some((t) => t.t === 'success'), 'the approval still reports success');
    assert.ok(A.toasts.some((t) => t.t === 'info' && /request link/.test(t.m)), 'and says the link could not follow');
    assert.ok(!A.toasts.some((t) => /Failed:/.test(t.m)), 'a failed sync is never reported as a failed approval');

    const R = makeApp({ failUpdate: true, docs: docs() });
    await R.ret(Q1, 'bk_quotes');
    assert.equal(R.store.get(RAW_Q1).status, 'needs_revision');
    assert.equal(R.store.get('approval_requests/ar1').status, 'returned');
    assert.equal(R.notes.length, 1);

    for (const sel of ['#qar-approve', '#qar-return']) {
      const S = makeApp({ failUpdate: true, docs: docs() });
      await openReview(S);
      await S.fire(sel);
      assert.equal(S.store.get('approval_requests/ar1').status, sel === '#qar-approve' ? 'approved' : 'returned', sel);
      assert.equal(S.closed.length, 1, sel);
      assert.ok(S.ops.includes('onDone'), sel);
      assert.ok(!S.toasts.some((t) => /Failed:/.test(t.m)), sel);
    }
  });

  it('a Brilliant Steel quote (bs_quotes, no sourceRef) approves exactly as before — one extra read of the quote, no request touched', async () => {
    const S = makeApp({ docs: { 'bs_quotes/pq1': quoteDoc({ sourceRef: null }), 'approval_requests/ar1': { type: 'bs_quote', quoteId: 'pq1', status: 'pending' } } });
    await S.approve('pq1', 'bs_quotes');
    assert.deepEqual(seq(S), ['update bs_quotes/pq1', 'get bs_quotes/pq1', 'where approval_requests.quoteId == pq1', 'update approval_requests/ar1', 'notify']);
    assert.equal(S.store.get('bs_quotes/pq1').status, 'filed');
  });

  it('every one of the four write sites in the source calls the sync, right after the quote write and before the approval request is resolved', () => {
    const sites = [
      [APPROVE, "window.syncQuoteStatusToRequest(coll, quoteId, 'approved')"],
      [RETURN, "window.syncQuoteStatusToRequest(coll, quoteId, 'needs_revision')"],
      [REVIEW, "window.syncQuoteStatusToRequest(QC, quoteId, 'approved')"],
      [REVIEW, "window.syncQuoteStatusToRequest(QC, quoteId, 'needs_revision')"],
    ];
    for (const [src, call] of sites) {
      const at = src.indexOf(call);
      assert.ok(at > 0, `${call} is missing`);
      const before = src.lastIndexOf('.update(', at), after = src.indexOf("collection('approval_requests')", at);
      assert.ok(before > 0 && before < at, `${call} must follow the quote's own write`);
      assert.ok(after > at, `${call} must come before the approval request is resolved`);
    }
  });
});
