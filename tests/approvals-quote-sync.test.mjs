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
// QUOTE-APPROVAL-LINK-SPEC-2026-11-20 §4: the four write sites above are now callers of ONE function, decideQuoteApproval (js/screens/approvals.js), lifted here with the wrappers, the
// review panel and — for the builder's review bar — saveReviewedPartnerQuote (js/app.js). Its guards (a fresh read, the pending-state check, the in-flight Set, offline), the
// best-effort thread entry and the notification link are pinned below; every older assertion keeps its meaning (the write order is quote update -> request sync -> approval request
// -> notify; the only new step is the fresh read of the quote that opens the call).
// Mutation-tested in scratch copies (see the commit message): the state guard dropped or widened, no in-flight Set, no offline check, the thread entry awaited outside its try, the
// notification link back to the list page, a self-notification, notes written when empty, the sync moved before the quote update, a caller that keeps its own copy of the write.
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
const IN_FLIGHT = piece(SRC, /^const _qaInFlight = new Set\(\);$/m, 'the in-flight Set');
const DECIDE = piece(SRC, /^async function decideQuoteApproval\([\s\S]*?\n\}/m, 'decideQuoteApproval');
const APPROVE = piece(SRC, /^async function approveQuoteApproval\([\s\S]*?\n\}/m, 'approveQuoteApproval');
const RETURN = piece(SRC, /^async function returnQuoteToPartner\([\s\S]*?\n\}/m, 'returnQuoteToPartner');
const REVIEW = piece(SRC, /^async function openQuoteApprovalReview\([\s\S]*?\n\}/m, 'openQuoteApprovalReview');
const STATE_FIELDS = piece(read('js/config.js'), /^window\.quoteStateFields = function \(state\) \{[\s\S]*?\n\};/m, 'window.quoteStateFields in js/config.js');
const ESC_HTML = piece(read('js/modules.js'), /function escHtml\(str\) \{[\s\S]*?\n\}/, 'escHtml in js/modules.js');
const REF_OF = piece(read('js/config.js'), /^window\.quoteApprovalRefOf = function[\s\S]*?\n\};/m, 'window.quoteApprovalRefOf in js/config.js');
const BAR = piece(read('js/app.js'), /^async function saveReviewedPartnerQuote\([\s\S]*?\n\}/m, 'saveReviewedPartnerQuote in js/app.js');

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
  const ops = [], updates = [], toasts = [], warns = [], invalidated = [], notes = [], audits = [], closed = [], threads = [], navs = [];
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
    busy: (btn, fn) => fn(),                       // js/config.js's window.busy (the double-click guard) stands in as a pass-through here
    // the approval thread (js/svc-approvals.js QuoteThread, pinned by tests/quote-approval-link.test.mjs): recorded here; 'reject' answers { ok:false }, 'throw' throws
    QuoteThread: { add: async (o) => { ops.push('thread ' + o.kind); threads.push(o); if (opts.thread === 'throw') throw new Error('permission-denied'); return opts.thread === 'reject' ? { ok: false, error: 'permission-denied' } : { ok: true, id: 'tc1' }; } },
    ensureScript: async () => {},
  };
  // the review panel: openPage hands back a panel whose body / foot find their controls by selector (one stand-in each, so a handler wired by the code can be fired)
  const controls = {};
  const control = (sel, extra) => (controls[sel] = controls[sel] || Object.assign({ value: '', handlers: {}, addEventListener(t, f) { this.handlers[t] = f; }, removeAttribute() {} }, extra));
  const part = () => ({ innerHTML: '', querySelector: (sel) => control(sel) });
  const panel = { isConnected: true, body: part(), foot: part(), querySelector(sel) { return sel === '.page-panel-body' ? this.body : sel === '.page-panel-foot' ? this.foot : null; } };
  const ctx = vm.createContext({
    window: win, db, console: { log() {}, error() {}, warn: (...a) => warns.push(a) },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => stamp } } },
    currentUser: { uid: opts.me || 'u-pres' }, currentRole: 'president', userProfile: { displayName: 'The President' },
    navigator: { onLine: !opts.offline }, navigateTo: (page, o) => navs.push([page, o]), document: { getElementById: () => ({}) },
    requestBuilderState: async () => ({ payload: opts.builderState || {}, costSidecar: opts.costSidecar || null }),   // the builder's whole answer (QUOTE-PRESIDENT-FIGURES-SPEC 6.4): payload + cost record
    promptDialog: async () => opts.returnNotes || '',
    Notifs: {
      showToast: (m, t) => toasts.push({ m, t }), success: (m) => toasts.push({ m, t: 'success' }), error: (m) => toasts.push({ m, t: 'error' }),
      send: async (uid, n) => { ops.push('notify'); notes.push({ uid, n }); },
    },
    dbCacheInvalidate: (k) => invalidated.push(k),
    openPage: () => panel, closeModal: () => closed.push(true), emojiIcon: () => '',
  });
  vm.runInContext(read('js/quote-figures-core.js'), ctx, { filename: 'js/quote-figures-core.js' });   // window.QuoteFigures: the builder bar hands its payload through moneyEdits
  vm.runInContext([STATE_FIELDS, ESC_HTML, REF_OF, SYNC, IN_FLIGHT, DECIDE, 'window.decideQuoteApproval = decideQuoteApproval;', APPROVE, RETURN, REVIEW, BAR].join('\n'), ctx);
  const call = (code, ...args) => { ctx.__a = args; return vm.runInContext(code, ctx); };
  return { ctx, win, store, ops, updates, toasts, warns, invalidated, notes, audits, closed, panel, controls, threads, navs,
    sync: (coll, id, state) => call('window.syncQuoteStatusToRequest(...__a)', coll, id, state),
    decide: (o) => call('decideQuoteApproval(...__a)', o),
    bar: (ctxArg, action) => call('saveReviewedPartnerQuote(...__a)', ctxArg, action),
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

  it('Approve (list / registry): a fresh read of the quote, THEN it is saved as filed + approved, THEN the request entry -> filed, THEN the approval request resolved, the thread entry, and the agent told', async () => {
    const S = makeApp({ docs: docs() });
    await S.approve(Q1, 'bk_quotes');
    assert.deepEqual(seq(S), [`get ${RAW_Q1}`, `update ${RAW_Q1}`, `get ${RAW_Q1}`, `get ${RAW_QR}`, `update ${RAW_QR}`, `where approval_requests.quoteId == ${Q1}`, 'update approval_requests/ar1', 'thread approved', 'notify']);
    assert.deepEqual([S.store.get(RAW_Q1).status, S.store.get(RAW_Q1).approvalStatus], ['filed', 'approved']);
    assert.equal(entryOf(S, RAW_QR, Q1).status, 'filed');
    assert.equal(S.store.get('approval_requests/ar1').status, 'approved');
    assert.equal(S.notes.length, 1);
    assert.ok(S.toasts.some((t) => t.t === 'success' && /approved and filed/.test(t.m)));
  });

  it('Return (list / registry): a fresh read of the quote, THEN it is saved as needs_revision, then the request entry -> needs_revision, then the approval request returned, the thread entry, and the agent told', async () => {
    const S = makeApp({ docs: docs() });
    await S.ret(Q1, 'bk_quotes');
    assert.deepEqual(seq(S), [`get ${RAW_Q1}`, `update ${RAW_Q1}`, `get ${RAW_Q1}`, `get ${RAW_QR}`, `update ${RAW_QR}`, `where approval_requests.quoteId == ${Q1}`, 'update approval_requests/ar1', 'thread returned', 'notify']);
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

  it('a Brilliant Steel quote (bs_quotes, no sourceRef) approves exactly as before — the decision\'s own read plus the sync\'s read of the quote, no request touched', async () => {
    const S = makeApp({ docs: { 'bs_quotes/pq1': quoteDoc({ sourceRef: null }), 'approval_requests/ar1': { type: 'bs_quote', quoteId: 'pq1', status: 'pending' } } });
    await S.approve('pq1', 'bs_quotes');
    assert.deepEqual(seq(S), ['get bs_quotes/pq1', 'update bs_quotes/pq1', 'get bs_quotes/pq1', 'where approval_requests.quoteId == pq1', 'update approval_requests/ar1', 'thread approved', 'notify']);
    assert.equal(S.store.get('bs_quotes/pq1').status, 'filed');
  });

  it('the sync is called in ONE place — decideQuoteApproval, right after the quote write and before the approval request is resolved — and every write site is a caller of it', () => {
    const at = DECIDE.indexOf("window.syncQuoteStatusToRequest(coll, quoteId, approve ? 'approved' : 'needs_revision')");
    assert.ok(at > 0, 'the sync call is missing from decideQuoteApproval');
    const before = DECIDE.lastIndexOf('.update(', at), after = DECIDE.indexOf("collection('approval_requests')", at);
    assert.ok(before > 0 && before < at, 'the sync must follow the quote\'s own write');
    assert.ok(after > at, 'the sync must come before the approval request is resolved');
    // the three former copies are callers now: the two wrappers, the review panel's two handlers, the builder's review bar
    assert.match(APPROVE, /return decideQuoteApproval\(\{ coll, quoteId, action:'approve'/);
    assert.match(RETURN, /return decideQuoteApproval\(\{ coll, quoteId, action:'return', notes/);
    assert.equal((REVIEW.match(/decideQuoteApproval\(\{ coll:QC, quoteId, action:'(approve|return)'/g) || []).length, 2, 'both review-panel handlers call the decision');
    assert.match(BAR, /window\.decideQuoteApproval\(\{ coll, quoteId: ctx\.quoteId, action, notes, edits/);
    // and nothing else writes the approved / returned state any more
    for (const [name, src] of [['approveQuoteApproval', APPROVE], ['returnQuoteToPartner', RETURN], ['openQuoteApprovalReview', REVIEW], ['saveReviewedPartnerQuote', BAR]]) {
      assert.equal(/quoteStateFields\(/.test(src), false, `${name} still writes a quote state by itself`);
      assert.equal(/syncQuoteStatusToRequest\(/.test(src), false, `${name} still syncs by itself`);
    }
    // the spec's grep: `grep -n "quoteStateFields('approved')" js` shows exactly one hit outside the tests, inside decideQuoteApproval (the ternary), and none in the builder bar or the review panel
    const hits = [];
    for (const f of ['js/app.js', 'js/config.js', 'js/departments.js', 'js/modules.js', 'js/svc-approvals.js', 'js/screens/approvals.js', 'js/screens/quote-approval.js', 'js/screens/sales.js']) {
      read(f).split('\n').forEach((l, i) => { if (l.includes("quoteStateFields('approved')")) hits.push(`${f}:${i + 1}`); });
    }
    assert.equal(hits.length, 1, hits.join(', '));
    assert.match(hits[0], /^js\/screens\/approvals\.js:/);
    assert.equal((DECIDE.match(/quoteStateFields\('approved'\)/g) || []).length, 1, 'and that hit is inside decideQuoteApproval');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// QUOTE-APPROVAL-LINK-SPEC-2026-11-20 §4 — decideQuoteApproval: the one decision, its guards, the thread entry and the notification
describe('decideQuoteApproval — ONE function behind every Approve / Return, guarded against a second decision', () => {
  const AGENT = 'u-agent';
  const base = (over) => ({ [RAW_Q1]: quoteDoc(Object.assign({ createdBy: AGENT, rootQuoteId: Q1 }, over || {})), [RAW_QR]: requestDoc(), 'approval_requests/ar1': { type: 'bs_quote', quoteId: Q1, status: 'pending' } });
  const D = (S, over) => S.decide(Object.assign({ coll: 'bk_quotes', quoteId: Q1, action: 'approve', agentId: AGENT, quoteNumber: 'BK-ML-WB-261028-001', clientName: 'Juan Dela Cruz' }, over || {}));
  const quoteWrites = (S) => S.updates.filter((u) => u.key === RAW_Q1);
  const STATE_KEYS = ['status', 'approvalStatus', 'approvedAt', 'approvedBy', 'approvedByName', 'returnedAt', 'returnedBy', 'presidentNotes'];
  const statePart = (patch) => Object.fromEntries(STATE_KEYS.filter((k) => k in patch).map((k) => [k, plain(patch[k])]));

  it('the three former copies write the identical decision for the same input: the two wrappers, the review panel and the builder\'s review bar — approve and return', async () => {
    const BUILDER = { clientName: 'Juan Dela Cruz', clientCompany: 'Cruz Foods', items: [{ name: 'Sink' }], total: 91000, grandTotal: 91000, editableState: { n: 1 } };
    for (const action of ['approve', 'return']) {
      const notes = action === 'return' ? 'make it 2 sinks' : '';
      const W = makeApp({ docs: base() });   // the wrapper (Approvals list)
      await (action === 'approve' ? W.approve(Q1, 'bk_quotes') : W.ret(Q1, 'bk_quotes', notes));
      const P = makeApp({ docs: base() });   // the review panel
      P.store.set(RAW_Q1, Object.assign({}, P.store.get(RAW_Q1), { scope: 'Supply of 2 sinks', total: 88739 }));
      await P.review(Q1, 'bk_quotes');
      P.panel.body.querySelector('#qar-client').value = 'Juan Dela Cruz'; P.panel.body.querySelector('#qar-scope').value = 'x'; P.panel.body.querySelector('#qar-total').value = '91000'; P.panel.body.querySelector('#qar-notes').value = notes;
      await P.fire(action === 'approve' ? '#qar-approve' : '#qar-return');
      const B = makeApp({ docs: base(), builderState: BUILDER, returnNotes: notes });   // the builder's review bar
      await B.bar({ quoteId: Q1, partnerUid: AGENT, quoteNumber: 'BK-ML-WB-261028-001', clientName: 'Juan Dela Cruz', quoteColl: 'bk_quotes' }, action);
      const [w, p, b] = [W, P, B].map((S) => lastPatch(S, RAW_Q1));
      assert.deepEqual(statePart(w), statePart(p), action + ': panel == wrapper');
      assert.deepEqual(statePart(w), statePart(b), action + ': builder bar == wrapper');
      assert.deepEqual(plain(w.status === undefined ? null : [w.status, w.approvalStatus]), action === 'approve' ? ['filed', 'approved'] : ['needs_revision', 'needs_revision']);
      assert.equal('presidentNotes' in w, action === 'return', 'notes are written only when there are some (a return); an approval with no note writes none');
      for (const S of [W, P, B]) {
        assert.equal(S.notes.length, 1, 'the submitter is told once');
        assert.equal(S.notes[0].n.type, action === 'approve' ? 'quote_approved' : 'quote_returned');
        assert.equal(S.store.get('approval_requests/ar1').status, action === 'approve' ? 'approved' : 'returned', 'the approval request is resolved by every site');
        assert.equal(entryOf(S, RAW_QR, Q1).status, action === 'approve' ? 'filed' : 'needs_revision', 'and the website request follows (the builder bar never synced it before)');
      }
      // what each caller adds is ONLY its own edits
      assert.deepEqual(Object.keys(w).sort(), Object.keys(statePart(w)).sort(), 'the wrapper writes nothing but the decision');
      assert.ok(['clientName', 'scope', 'total', 'editedByPresident'].every((k) => k in p), 'the panel\'s edits ride along');
      assert.ok(['items', 'editableState', 'editedByPresident', 'clientCompany'].every((k) => k in b), 'the bar\'s edits ride along');
    }
  });

  it('a quote that is not waiting for approval is refused with NO write at all: approved, returned, filed directly — and a missing doc / id is "missing"', async () => {
    for (const [over, state, msg] of [
      [{ status: 'filed', approvalStatus: 'approved' }, 'approved', /already approved/],
      [{ status: 'needs_revision', approvalStatus: 'needs_revision' }, 'needs_revision', /already returned.*Wait for the new submission/],
      [{ status: 'filed', approvalStatus: 'filed' }, 'filed', /not waiting for approval/],
      [{ status: 'draft', approvalStatus: undefined }, 'draft', /not waiting for approval/],
    ]) {
      for (const action of ['approve', 'return']) {
        const S = makeApp({ docs: base(over) });
        const r = await D(S, { action });
        assert.deepEqual(plain(r), { ok: false, reason: 'state', state }, JSON.stringify(over) + ' ' + action);
        assert.deepEqual(S.ops, [`get ${RAW_Q1}`], 'only the guard\'s read: no quote, request, approval or thread write, no notification');
        assert.equal(S.updates.length, 0); assert.equal(S.notes.length, 0); assert.equal(S.threads.length, 0);
        assert.ok(S.toasts.some((t) => msg.test(t.m)), 'the reason is said in a toast');
      }
    }
    const M = makeApp({ docs: {} });
    assert.deepEqual(plain(await D(M)), { ok: false, reason: 'missing' }); assert.deepEqual(M.ops, [`get ${RAW_Q1}`]);
    assert.deepEqual(plain(await D(M, { quoteId: '' })), { ok: false, reason: 'missing' }); assert.deepEqual(M.ops, [`get ${RAW_Q1}`], 'no id: not even a read');
    assert.ok(M.toasts.every((t) => /Quote not found/.test(t.m)));
  });

  it('the guard accepts the two spellings of "waiting": approvalStatus pending_review OR status pending_approval', async () => {
    for (const over of [{ status: 'x', approvalStatus: 'pending_review' }, { status: 'pending_approval', approvalStatus: undefined }]) {
      const S = makeApp({ docs: base(over) });
      assert.deepEqual(plain(await D(S)), { ok: true }, JSON.stringify(over));
      assert.equal(quoteWrites(S).length, 1);
    }
  });

  it('two decisions started together (a double tap, two devices on one tab) write exactly ONE quote update; the second is "busy" and says nothing; the guard is released afterwards', async () => {
    const S = makeApp({ docs: base() });
    const [a, b] = await Promise.all([D(S), D(S, { action: 'return', notes: 'late' })]);
    assert.deepEqual([plain(a), plain(b)], [{ ok: true }, { ok: false, reason: 'busy' }]);
    assert.equal(quoteWrites(S).length, 1); assert.equal(S.notes.length, 1);
    assert.deepEqual(S.store.get(RAW_Q1).approvalStatus, 'approved');
    assert.ok(!S.toasts.some((t) => /busy/i.test(t.m)), 'busy is silent');
    // after the first finished the quote is no longer pending: a third call is refused by the STATE guard, not by a stuck in-flight entry
    assert.equal(plain(await D(S)).reason, 'state');
    // the guard is released even when the decision fails: the retry after a failed write is possible
    const F = makeApp({ docs: base() });
    F.ctx.db = { collection: () => ({ doc: () => ({ get: async () => { throw new Error('network down'); } }) }) };
    assert.equal(plain(await D(F)).reason, 'error');
    const F2 = makeApp({ docs: base() }); await D(F2); assert.equal(plain(await D(F2)).reason, 'state');
  });

  it('offline: no read and no write, a toast, reason "offline"', async () => {
    const S = makeApp({ docs: base(), offline: true });
    assert.deepEqual(plain(await D(S)), { ok: false, reason: 'offline' });
    assert.deepEqual(S.ops, []); assert.equal(S.updates.length, 0);
    assert.ok(S.toasts.some((t) => t.t === 'error' && /You are offline\. Connect to approve or return a quote\./.test(t.m)));
  });

  it('the thread entry: kind "approved" / "returned", the notes as its text, on this quote; a rejected or throwing thread write never stops the notification, the audit or the success toast', async () => {
    const S = makeApp({ docs: base() });
    await D(S, { action: 'return', notes: 'make it 2 sinks' });
    assert.equal(S.threads.length, 1);
    const t = S.threads[0];
    assert.deepEqual([t.coll, t.quoteId, t.kind, t.text, t.uid, t.role, t.name], ['bk_quotes', Q1, 'returned', 'make it 2 sinks', 'u-pres', 'president', 'The President']);
    assert.equal(t.q.createdBy, AGENT, 'the entry is keyed to the quote doc as it was read (its creator, its root)');
    const A = makeApp({ docs: base() }); await D(A, { notes: 'looks fine' });
    assert.deepEqual([A.threads[0].kind, A.threads[0].text], ['approved', 'looks fine']);
    const E = makeApp({ docs: base() }); await D(E); assert.equal(E.threads[0].text, '', 'no note: an empty entry (the rules allow it for returned / approved)');
    for (const thread of ['reject', 'throw']) {
      const X = makeApp({ docs: base(), thread });
      assert.deepEqual(plain(await D(X)), { ok: true }, thread);
      assert.equal(X.notes.length, 1, thread + ': the agent is still told');
      assert.equal(X.audits.length, 1); assert.ok(X.toasts.some((x) => x.t === 'success' && /approved and filed/.test(x.m)));
      assert.ok(X.ops.indexOf('thread approved') < X.ops.indexOf('notify'), 'the thread entry comes before the notification');
    }
  });

  it('the notification: to the agent (agentId, else the quote\'s creator), never to oneself, with the review-page link; its text is the wording the three copies shared', async () => {
    const S = makeApp({ docs: base() });
    await D(S);
    assert.equal(S.notes.length, 1);
    const n = S.notes[0];
    assert.equal(n.uid, AGENT);
    assert.deepEqual([n.n.title, n.n.icon, n.n.type, n.n.link], ['✅ Quote Approved!', '✅', 'quote_approved', 'quote-approval/bk.' + Q1]);
    assert.equal(n.n.body, 'Quotation "BK-ML-WB-261028-001" for Juan Dela Cruz was approved and filed.');
    const R = makeApp({ docs: base() }); await D(R, { action: 'return', notes: 'make it 2 sinks' });
    assert.deepEqual([R.notes[0].n.title, R.notes[0].n.icon, R.notes[0].n.type, R.notes[0].n.link], ['↩ Quote Returned for Revision', '✎', 'quote_returned', 'quote-approval/bk.' + Q1]);
    assert.equal(R.notes[0].n.body, '"BK-ML-WB-261028-001" for Juan Dela Cruz was reviewed and returned. Notes: make it 2 sinks Please revise and re-submit.');
    // no agentId given: the quote's own creator; the President's own quote: nobody is notified
    const C = makeApp({ docs: base() }); await D(C, { agentId: undefined }); assert.equal(C.notes[0].uid, AGENT);
    const M = makeApp({ docs: base({ createdBy: 'u-pres' }) }); assert.deepEqual(plain(await D(M, { agentId: undefined })), { ok: true }); assert.equal(M.notes.length, 0, 'the signed-in user is never notified of his own decision');
    const M2 = makeApp({ docs: base() }); await D(M2, { agentId: 'u-pres' }); assert.equal(M2.notes.length, 0);
    const N = makeApp({ docs: base({ createdBy: '' }) }); await D(N, { agentId: '' }); assert.equal(N.notes.length, 0, 'nobody to tell');
    // a Brilliant Steel quote links to its own prefix; the old list link is only the fallback for a ref that cannot be built
    const B = makeApp({ docs: { 'bs_quotes/pq123456': quoteDoc({ createdBy: AGENT, sourceRef: null }), 'approval_requests/ar1': { type: 'bs_quote', quoteId: 'pq123456', status: 'pending' } } });
    await D(B, { coll: 'bs_quotes', quoteId: 'pq123456' }); assert.equal(B.notes[0].n.link, 'quote-approval/bs.pq123456');
    const Z = makeApp({ docs: { 'bs_quotes/ab': quoteDoc({ createdBy: AGENT, sourceRef: null }) } });
    await D(Z, { coll: 'bs_quotes', quoteId: 'ab' }); assert.equal(Z.notes[0].n.link, 'bs-quotations', 'an id the link pattern refuses falls back to the list page');
    // the notification body stays inside the 2000 characters firestore.rules allows, whatever the notes are
    const L = makeApp({ docs: base() }); await D(L, { action: 'return', notes: 'x'.repeat(5000) }); assert.ok(L.notes[0].n.body.length <= 2000);
  });

  it('the decision, audit and caches: edits ride in the one update (never overriding the state), the audit says edited, both caches drop, the success toast is the one each caller had', async () => {
    const S = makeApp({ docs: base() });
    await D(S, { edits: { clientName: 'J. Dela Cruz', total: 91000, status: 'hacked', approvalStatus: 'hacked' }, notes: 'ok' });
    const p = lastPatch(S, RAW_Q1);
    assert.deepEqual([p.status, p.approvalStatus, p.total, p.clientName, p.presidentNotes], ['filed', 'approved', 91000, 'J. Dela Cruz', 'ok'], 'the state fields win over anything in edits');
    assert.deepEqual(plain(p.approvedAt), { __serverTimestamp: true }); assert.equal(p.approvedBy, 'u-pres');
    assert.equal(S.updates.filter((u) => u.key === RAW_Q1).length, 1, 'one update call');
    assert.deepEqual(plain(S.audits.map((a) => a.slice(0, 4))), [['update', 'quote', Q1, { approved: true, edited: true }]]);
    assert.deepEqual(S.invalidated.filter((k) => /all-quotes|approvals-pending/.test(k)).sort(), ['all-quotes', 'approvals-pending:approval_requests-pending']);
    assert.match(S.notes[0].n.body, /for J\. Dela Cruz/, 'the edited client name is the one the agent reads');
    assert.ok(S.toasts.some((t) => t.t === 'success' && t.m === 'Quote approved and filed!'));
    const Q = makeApp({ docs: base() }); await D(Q, { action: 'return', notes: 'redo' });
    assert.ok(Q.toasts.some((t) => t.t === 'error' && t.m === 'Quote returned.'), 'the return keeps its (error-toned) toast');
    const T = makeApp({ docs: base() }); await D(T, { toastOk: false }); assert.ok(!T.toasts.some((t) => t.t === 'success'), 'toastOk:false: the caller says it itself');
    const BS = makeApp({ docs: { 'bs_quotes/pq123456': quoteDoc({ createdBy: AGENT, sourceRef: null }) } });
    let bsDropped = 0; BS.win.invalidateBsQuotesCache = () => { bsDropped++; };
    await D(BS, { coll: 'bs_quotes', quoteId: 'pq123456' }); assert.equal(bsDropped, 1, 'a Brilliant Steel decision drops its quote cache');
  });

  it('a failure after the guard (a refused write) is a toast "Failed: …" and reason "error" — never a throw — and a failing thread write is NOT one of them', async () => {
    const S = makeApp({ docs: base() });
    S.ctx.db = { collection: (c) => ({ doc: (id) => ({ get: async () => ({ exists: true, data: () => plain(quoteDoc({ createdBy: AGENT })) }), update: async () => { throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }); } }) }) };
    const r = plain(await D(S));
    assert.deepEqual(r, { ok: false, reason: 'error' });
    assert.ok(S.toasts.some((t) => t.t === 'error' && /^Failed: Missing or insufficient permissions\./.test(t.m)));
    assert.equal(S.notes.length, 0, 'nobody is told of a decision that was not saved');
  });

  it('the builder\'s review bar: a decision that is taken ends on the review page of that quote; one that is refused (already decided, offline) keeps the President in the builder', async () => {
    const ctxArg = { quoteId: Q1, partnerUid: AGENT, quoteNumber: 'BK-ML-WB-261028-001', clientName: 'Juan Dela Cruz', quoteColl: 'bk_quotes' };
    const ok = makeApp({ docs: base(), builderState: { clientName: 'Juan Dela Cruz', items: [], editableState: {} } });
    await ok.bar(ctxArg, 'approve');
    assert.deepEqual(plain(ok.navs), [['quote-approval', { subtab: 'bk.' + Q1 }]]);
    assert.ok(ok.toasts.some((t) => t.t === 'success' && t.m === 'Approved with edits + submitter notified'));
    const ret = makeApp({ docs: base(), builderState: {}, returnNotes: 'redo' }); await ret.bar(ctxArg, 'return');
    assert.ok(ret.toasts.some((t) => t.t === 'success' && t.m === 'Edited & returned')); assert.deepEqual(plain(ret.navs), [['quote-approval', { subtab: 'bk.' + Q1 }]]);
    assert.equal(lastPatch(ret, RAW_Q1).presidentNotes, 'redo');
    const done = makeApp({ docs: base({ status: 'filed', approvalStatus: 'approved' }), builderState: {} }); await done.bar(ctxArg, 'approve');
    assert.deepEqual(done.navs, [], 'already decided: stay in the builder'); assert.equal(done.updates.length, 0);
    assert.ok(done.toasts.some((t) => /already approved/.test(t.m)));
    const off = makeApp({ docs: base(), builderState: {}, offline: true }); await off.bar(ctxArg, 'approve'); assert.deepEqual(off.navs, []); assert.equal(off.updates.length, 0);
    const empty = makeApp({ docs: base(), builderState: {} }); await empty.bar(ctxArg, 'approve');
    assert.equal(lastPatch(empty, RAW_Q1).clientName, 'Juan Dela Cruz', 'the context\'s client name stands in when the builder has none');
  });
});
