// tests/quote-approval-link.test.mjs — QUOTE-APPROVAL-LINK-SPEC-2026-11-20: the per-quote approval link, the review page behind it, the approval thread, and the shell's link window.
//
// What it pins, in the spec's order (§10):
//   1. LINK HELPERS   js/config.js quoteApprovalRefOf / parseQuoteApprovalRef / quoteApprovalUrl: both collections round-trip; an unknown collection, an empty or draft id, a character
//                     outside [A-Za-z0-9_-], a third segment, a too short / too long id are refused; the absolute url is origin + /#/quote-approval/ + ref.
//   2. ROUTER         js/app.js parseHash / hashFor carry '#/quote-approval/<ref>' as page + subtab; navigateTo has the case; PAGE_SCRIPTS lists the five files (the fifth is js/quote-figures-core.js) and sw.js precaches the page.
//   3. BRIDGE         the builder bridge listener, lifted whole: a QUOTE_APPROVAL_REQUESTED stores the sanitised approvalWhy (QUOTE_FILED never does), writes ONE 12-key thread entry,
//                     notifies the President with the review-page link, remembers and shows the link, and survives a thread write that fails; QB_SHOW_APPROVAL_LINK; the link window itself.
//   4. QUOTE THREAD   js/svc-approvals.js window.QuoteThread (entry / add / list) against an in-memory Firestore.
//   5. VIEW MODEL     js/screens/quote-approval.js loaded with the REAL js/forms-core.js and js/qb-spec-sheet.js: cost never reaches anyone but the President, margins, row matching, photos,
//                     escaping, sections and codes, legacy quotes, options, what each role can do, the newer-revision banner, the legacy President's note.
//   6. THE PAGE       renderQuoteApproval against a small stand-in DOM: the reads (the sidecar only for the President), the states (invalid, no access, gone, offline), and what the buttons do.
//   7. LIST AND NOTIFICATIONS   the Quotes-list buttons and note, the Approvals "Open quote" button, notifications.js routing of 'quote-approval/<ref>'.
//   8. STATIC PINS    the builder, qb/d7/d7-flow.js, the review page's one guarded read of quote_costs, the tutorial.
// Fixtures are FAKE (invented names, odd figures): the repository is public.
//
// js/app.js, js/config.js, js/notifications.js and js/screens/*.js are not modules: the pieces under test are lifted out of THEIR OWN SOURCE by name and run in node:vm with in-memory
// stand-ins for Firestore, the toasts and the router (the pattern of tests/quote-link.test.mjs and tests/approvals-quote-sync.test.mjs).
//
// Mutation-tested in scratch copies (the mutants are listed in the commit message), never in the shared tree: every one must fail here.
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
const APP = read('js/app.js'), CONFIG = read('js/config.js'), SVC = read('js/svc-approvals.js'), NOTIF = read('js/notifications.js'), SALES = read('js/screens/sales.js'), APPROVALS = read('js/screens/approvals.js');
const PAGE = read('js/screens/quote-approval.js'), BUILDER = read('quote-builder-v2.html'), FLOW = read('qb/d7/d7-flow.js'), SW = read('sw.js');
const ESC_SRC = read('js/modules.js').match(/function escHtml\(str\) \{[\s\S]*?\n\}/)[0];
const piece = (src, re, what) => { const m = src.match(re); assert.ok(m, `${what} not found`); return m[0]; };
const cfgPiece = (name) => piece(CONFIG, new RegExp(`^window\\.${name} = function[\\s\\S]*?\\n\\};`, 'm'), `window.${name} in js/config.js`);
const appFn = (name) => piece(APP, new RegExp(`^(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`, 'm'), `${name} in js/app.js`);
const appWin = (name) => piece(APP, new RegExp(`^window\\.${name} = (?:async )?function[\\s\\S]*?\\n\\};`, 'm'), `window.${name} in js/app.js`);

const ORIGIN = 'https://app.test';
const BK = 'qd00000000000000001', ROOT_ID = 'qd00000000000000000', NEW_ID = 'qd00000000000000002';

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('1 · the link helpers (js/config.js)', () => {
  const win = { QUOTE_COLLECTIONS: ['bk_quotes', 'bs_quotes'] };
  const ctx = vm.createContext({ window: win, location: { origin: ORIGIN } });
  vm.runInContext(['quoteApprovalRefOf', 'parseQuoteApprovalRef', 'quoteApprovalUrl'].map(cfgPiece).join('\n'), ctx);
  const { quoteApprovalRefOf: refOf, parseQuoteApprovalRef: parse, quoteApprovalUrl: urlOf } = win;

  it('both collections round-trip: bk_quotes <-> "bk.<id>", bs_quotes <-> "bs.<id>"', () => {
    for (const [coll, pre] of [['bk_quotes', 'bk'], ['bs_quotes', 'bs']]) {
      for (const id of [BK, 'Abc123XYZ', 'a_b-c_D9', 'x'.repeat(6), 'y'.repeat(64)]) {
        assert.equal(refOf(coll, id), `${pre}.${id}`);
        assert.deepEqual(plain(parse(`${pre}.${id}`)), { coll, id });
        assert.deepEqual(plain(parse(refOf(coll, id))), { coll, id });
      }
    }
  });
  it('refused: an unknown collection, an empty / missing id, a draft slot, a character outside [A-Za-z0-9_-], a too short or too long id', () => {
    for (const coll of ['users', 'quotes', 'quote_costs', '', undefined, null, 'bk', 'BK_QUOTES', '__proto__']) assert.equal(refOf(coll, BK), '', String(coll));
    for (const id of ['', undefined, null, 'draft_u1abc', 'draft_' + 'x'.repeat(30), 'a<b>cdef', 'ab/cdef', 'ab.cdef', 'ab cdef', 'ab\ncdef', 'abcde', 'x'.repeat(65), '../users/u1', 'a%2Fb123', 'abécdef']) assert.equal(refOf('bk_quotes', id), '', JSON.stringify(id));
  });
  it('parse refuses: an unknown prefix, a third segment, a draft, junk, a non-string, and the empty ref', () => {
    for (const ref of ['xx.' + BK, 'BK.' + BK, 'bk', 'bk.', '.' + BK, `bk.${BK}.extra`, `bk.${BK}/x`, 'bk.draft_u1abcdef', 'bs.draft_u1abcdef', 'bk.ab', 'bk.' + 'x'.repeat(65), 'bk.a<b>cdefg', 'bk.a b cdefg', '', undefined, null, 5, {}, [], 'constructor']) assert.equal(parse(ref), null, JSON.stringify(ref));
  });
  it('the absolute url is origin + /#/quote-approval/ + ref, and "" for an invalid pair', () => {
    assert.equal(urlOf('bk_quotes', BK), `${ORIGIN}/#/quote-approval/bk.${BK}`);
    assert.equal(urlOf('bs_quotes', 'Abc123XYZ'), `${ORIGIN}/#/quote-approval/bs.Abc123XYZ`);
    for (const [c, i] of [['users', BK], ['bk_quotes', ''], ['bk_quotes', 'draft_u1abcdef'], ['bk_quotes', 'a<b>cdef'], [undefined, undefined]]) assert.equal(urlOf(c, i), '', `${c} ${i}`);
  });
  it('the origin is the page\'s own (so the link works on the local preview server too), never a hard-coded domain', () => {
    const fn = cfgPiece('quoteApprovalUrl');
    assert.match(fn, /location\.origin \+ '\/#\/quote-approval\/'/);
    assert.equal(/barroindustries\.com/.test(fn), false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('2 · the router', () => {
  const ctx = vm.createContext({ location: { hash: '' } });
  vm.runInContext(appFn('hashFor') + '\n' + appFn('parseHash'), ctx);
  const parseHash = (h) => plain(vm.runInContext(`parseHash(${JSON.stringify(h)})`, ctx));
  const hashFor = (p, s) => vm.runInContext(`hashFor(${JSON.stringify(p)}, ${JSON.stringify(s)})`, ctx);

  it('parseHash reads #/quote-approval/<co>.<id> as page "quote-approval" and subtab "<co>.<id>"; hashFor writes the same address back', () => {
    assert.deepEqual(parseHash('#/quote-approval/bk.Abc123XYZ'), { page: 'quote-approval', subtab: 'bk.Abc123XYZ' });
    assert.deepEqual(parseHash('#/quote-approval/bs.' + BK), { page: 'quote-approval', subtab: 'bs.' + BK });
    assert.equal(hashFor('quote-approval', 'bk.Abc123XYZ'), '#/quote-approval/bk.Abc123XYZ');
    assert.equal(hashFor('quote-approval', 'bs.' + BK), '#/quote-approval/bs.' + BK, 'the dot and the id survive encodeURIComponent untouched');
    for (const ref of ['bk.Abc123XYZ', 'bs.a_b-c_D9']) assert.deepEqual(parseHash(hashFor('quote-approval', ref)), { page: 'quote-approval', subtab: ref });
  });
  it('junk in the hash never throws and never becomes a valid ref: a stray % keeps its text (the ref parser then refuses it), an injected tag or a path never survives', () => {
    const refCtx = vm.createContext({ window: { QUOTE_COLLECTIONS: ['bk_quotes', 'bs_quotes'] } });
    vm.runInContext(cfgPiece('parseQuoteApprovalRef'), refCtx);
    const valid = (h) => refCtx.window.parseQuoteApprovalRef(parseHash(h).subtab);
    assert.deepEqual(parseHash('#/quote-approval/bk.%E0%A4%A'), { page: 'quote-approval', subtab: 'bk.%E0%A4%A' });
    for (const h of ['#/quote-approval/bk.%E0%A4%A', '#/quote-approval/bk.%3Cimg%20src%3Dx%3E', '#/quote-approval/xx', '#/quote-approval/bk.' + BK + '.x', '#/quote-approval/', '#/quote-approval', '#/quote-approval/..%2F..%2Fusers%2Fu1']) assert.equal(valid(h), null, h);
    assert.deepEqual(plain(valid('#/quote-approval/bk.' + BK)), { coll: 'bk_quotes', id: BK });
  });
  it('navigateTo has the case, and it renders through window.renderQuoteApproval(subtab); there is no nav entry for the page', () => {
    assert.match(APP, /case 'quote-approval':\s+window\.renderQuoteApproval\(subtab\); break;/);
    assert.equal(/page:\s*'quote-approval'/.test(CONFIG), false, 'not a NAV_REGISTRY page (it is reached by link, notification and buttons)');
    assert.equal(/'quote-approval'/.test(read('js/screens/dashboards.js')), false);
  });
  it('PAGE_SCRIPTS[\'quote-approval\'] lists the five files, each exists; sw.js precaches the page (bare path, like the other lazy screens) and the others are already precached', () => {
    const list = CONFIG.match(/'quote-approval':\s*\[([^\]]*)\]/);
    assert.ok(list, 'no PAGE_SCRIPTS entry');
    const files = [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(files, ['js/screens/quote-approval.js', 'js/screens/approvals.js', 'js/forms-core.js', 'js/qb-spec-sheet.js', 'js/quote-figures-core.js']);
    for (const f of files) { assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} does not exist`); assert.ok(SW.includes(`\n  '/${f}',\n`), `${f} is not precached (bare path, on its own line)`); }
    assert.equal(SW.split("'/js/screens/quote-approval.js'").length - 1, 1, 'listed once');
  });
  it('the new file is lazy: it is not an app-kit <script> in index.html (CLAUDE.md), and the layoff lockdown rewrite of navigateTo is still there', () => {
    assert.equal(/js\/screens\/quote-approval/.test(read('index.html')), false, 'index.html (app-kit and body) never loads the review page: PAGE_SCRIPTS and the service worker do');
    assert.match(APP, /LAYOFF_ALLOWED_PAGES \|\| \['dashboard'\]\)\.includes\(page\)\)/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// in-memory Firestore used by sections 3 and 4: every operation is recorded; `quote_comments` can be made to refuse
function makeDb(opts) {
  opts = opts || {};
  const store = new Map(Object.entries(opts.docs || {}).map(([k, v]) => [k, plain(v)]));
  const adds = [], updates = [], queries = [], ops = [];
  let seq = 0;
  const refused = (coll) => coll === 'quote_comments' && opts.failComments;
  const docRef = (coll, id) => ({
    id,
    get: async () => { ops.push('get ' + coll + '/' + id); if (opts.getErrors && opts.getErrors[coll + '/' + id]) throw opts.getErrors[coll + '/' + id]; return { exists: store.has(coll + '/' + id), id, data: () => plain(store.get(coll + '/' + id)) }; },
    update: async (patch) => { ops.push('update ' + coll + '/' + id); if (opts.failPreview && /^approvalThread/.test(Object.keys(patch)[0])) throw Object.assign(new Error('refused'), { code: 'permission-denied' }); updates.push({ coll, id, patch }); },
    set: async (b) => { ops.push('set ' + coll + '/' + id); store.set(coll + '/' + id, b); },
    delete: async () => { ops.push('delete ' + coll + '/' + id); store.delete(coll + '/' + id); },
  });
  const db = { collection: (coll) => ({
    doc: (id) => docRef(coll, id),
    add: async (data) => {
      ops.push('add ' + coll);
      if (refused(coll)) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
      const id = 'qd' + String(++seq + (coll === 'bk_quotes' || coll === 'bs_quotes' ? 0 : 100)).padStart(18, '0');
      adds.push({ coll, id, data }); store.set(coll + '/' + id, data); return docRef(coll, id);
    },
    where: (field, op, value) => {
      const filters = [[field, op, value]];
      const q = {
        where: (f, o, v) => { filters.push([f, o, v]); return q; },
        get: async () => {
          queries.push({ coll, filters: filters.map((x) => x.slice()) });
          if (opts.listFails) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
          const rows = (opts.rows && opts.rows[coll]) || [];
          return { docs: rows.filter((r) => filters.every(([f, , v]) => r[f] === v)).map((r, i) => ({ id: r.id || 'r' + i, data: () => { const { id, ...rest } = r; return rest; } })) };
        },
      };
      return q;
    },
  }) };
  return { db, store, adds, updates, queries, ops };
}
const FV = { serverTimestamp: () => ({ __ts: true }), increment: (n) => ({ __inc: n }) };

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('3 · the builder bridge (js/app.js, listener lifted whole)', () => {
  const LISTENER = (() => {
    const start = APP.indexOf("window.addEventListener('message', async (e) => {", APP.indexOf('Quote Builder iframe → Firestore bridge'));
    assert.ok(start > 0, 'the bridge listener was not found');
    const end = APP.indexOf('\n});', start);
    assert.ok(end > start && APP.slice(start, end).includes('QUOTE_APPROVAL_REQUESTED'), 'the bridge listener could not be lifted whole');
    return APP.slice(start, end + 4);
  })();
  const CODE = [cfgPiece('quoteApprovalRefOf'), piece(APP, /^const QB_SOURCE_REF_RE = .*;$/m, 'QB_SOURCE_REF_RE'), appFn('_qbCleanSourceRef'), appFn('_qbCleanEstimateCheck'), appFn('_qbCleanApprovalWhy'),
    appFn('_qbCleanPriceCheck'), appFn('_qbChainQuotes'), appFn('_qbRevOf'), appFn('_qbGateText'), appFn('_qbFiguresNote'), appFn('_qbChainGate'),
    piece(SVC, /^window\.QuoteThread = \{[\s\S]*?\n\};/m, 'window.QuoteThread'), LISTENER].join('\n');

  function makeBridge(opts) {
    opts = opts || {};
    const D = makeDb(opts);
    const FRAME = {}, listeners = [], toasts = [], notified = [], links = [];
    const win = {
      location: { origin: ORIGIN }, addEventListener: (t, f) => { if (t === 'message') listeners.push(f); },
      QUOTE_COLLECTIONS: ['bk_quotes', 'bs_quotes'], quoteCollectionFor: (co) => (co === 'BS' ? 'bs_quotes' : 'bk_quotes'),
      quoteStateFields: (s) => ({ filed: { status: 'filed', approvalStatus: 'filed' }, pending_approval: { status: 'pending_approval', approvalStatus: 'pending_review' } })[s],
      Clients: { upsertFromQuote: async () => 'client_1' }, linkQuoteToRequest: async () => true, fmtN2: (n) => String(n), logAudit: () => {},
      showQuoteApprovalLink: (info) => { D.ops.push('link modal'); links.push(plain(info)); if (opts.modalThrows) throw new Error('modal'); },
      _qbLastApproval: opts.last,
    };
    const ctx = vm.createContext({
      window: win, db: D.db, console: { log() {}, error() {}, warn() {} },
      document: { getElementById: (id) => (id === 'qb-frame' ? { contentWindow: FRAME } : null) },
      firebase: { firestore: { FieldValue: FV } },
      currentUser: { uid: 'u-sales', email: 'sales@example.test' }, userProfile: { displayName: 'Sales Tester' }, currentRole: opts.role || 'employee',
      Notifs: { showToast: (m, t) => toasts.push({ m, t }), success: (m) => toasts.push({ m, t: 'success' }), sendToOwner: async (n) => { D.ops.push('notify owner'); notified.push(plain(n)); } },
      dbCacheInvalidate: () => {},
    });
    vm.runInContext(read('js/price-gate-core.js'), ctx);   // Phase 3: the gate runs for a revision (this payload names a chain); nothing in this chain is approved, so it files as today
    vm.runInContext(CODE, ctx);
    const send = async (type, payload, extra) => { await listeners[0]({ origin: ORIGIN, source: FRAME, data: Object.assign({ type, payload }, extra || {}) }); };
    return Object.assign(D, { win, toasts, notified, links, send, FRAME, listeners });
  }
  const payload = (over) => Object.assign({ company: 'BK', quoteNumber: 'BKZZTEST261120-007R1', clientName: 'Mira Santos', clientCompany: 'Santos Test Kitchen', total: 1234.5, grandTotal: 1234.5, items: [], editableState: {}, rootQuoteId: ROOT_ID, parentQuoteId: ROOT_ID }, over || {});
  const quoteAdd = (S, coll) => S.adds.find((a) => a.coll === (coll || 'bk_quotes'));
  const commentAdds = (S) => S.adds.filter((a) => a.coll === 'quote_comments');

  it('approvalWhy is sanitised on the way in: known codes only, in the builder\'s order, once each; the sentence cut at 600; "ticked" a strict boolean; anything that is not an object is null', async () => {
    const S = makeBridge();
    await S.send('QUOTE_APPROVAL_REQUESTED', payload(), { approvalWhy: { reasons: ['approve-all', 'bogus', 'review', 'review', 7, null, 'below-standard', { x: 1 }], text: 'x'.repeat(900), ticked: 'yes' } });
    assert.deepEqual(plain(quoteAdd(S).data.approvalWhy), { reasons: ['review', 'below-standard', 'approve-all'], text: 'x'.repeat(600), ticked: false });
    for (const [why, want] of [[{ reasons: [], text: 5, ticked: true }, { reasons: [], text: '5', ticked: true }], [{ reasons: 'review', text: null }, { reasons: [], text: '', ticked: false }], [{}, { reasons: [], text: '', ticked: false }]]) {
      const T = makeBridge(); await T.send('QUOTE_APPROVAL_REQUESTED', payload(), { approvalWhy: why });
      assert.deepEqual(plain(quoteAdd(T).data.approvalWhy), want, JSON.stringify(why));
    }
    for (const why of ['review', 7, null, undefined, [], ['review'], true]) {
      const T = makeBridge(); await T.send('QUOTE_APPROVAL_REQUESTED', payload(), { approvalWhy: why });
      assert.equal(quoteAdd(T).data.approvalWhy, null, JSON.stringify(why));
    }
  });
  it('QUOTE_FILED and QUOTE_UPDATE never write approvalWhy, whatever the envelope carries; the payload cannot smuggle one in either', async () => {
    const S = makeBridge();
    await S.send('QUOTE_FILED', payload({ approvalWhy: { reasons: ['review'], text: 'a', ticked: true } }), { approvalWhy: { reasons: ['review'], text: 'a', ticked: true } });
    assert.equal('approvalWhy' in quoteAdd(S).data, false);
    assert.equal(commentAdds(S).length, 0, 'a filed quote has no thread');
    const U = makeBridge({ docs: { 'bk_quotes/qdEXISTING0000000001': { status: 'pending_approval' } } });
    await U.send('QUOTE_UPDATE', payload({ approvalWhy: { reasons: ['review'] } }), { docId: 'qdEXISTING0000000001', collection: 'bk_quotes', approvalWhy: { reasons: ['review'], text: 'a', ticked: true } });
    assert.equal(U.updates.some((u) => 'approvalWhy' in u.patch), false);
  });
  it('QUOTE_APPROVAL_REQUESTED writes ONE thread entry with exactly the 12 keys — kind "submitted", the builder\'s sentence as its text, threadKey = coll + "_" + the chain\'s root id', async () => {
    const S = makeBridge();
    await S.send('QUOTE_APPROVAL_REQUESTED', payload(), { approvalWhy: { reasons: ['review'], text: 'A line needs review.', ticked: false } });
    const doc = quoteAdd(S);
    const c = commentAdds(S);
    assert.equal(c.length, 1);
    assert.deepEqual(Object.keys(c[0].data).sort(), ['authorName', 'authorRole', 'authorUid', 'coll', 'createdAt', 'kind', 'quoteId', 'quoteNumber', 'rootQuoteId', 'submitterUid', 'text', 'threadKey']);
    assert.deepEqual(plain(c[0].data), { threadKey: 'bk_quotes_' + ROOT_ID, coll: 'bk_quotes', quoteId: doc.id, rootQuoteId: ROOT_ID, quoteNumber: 'BKZZTEST261120-007R1', kind: 'submitted', text: 'A line needs review.',
      authorUid: 'u-sales', authorName: 'Sales Tester', authorRole: 'sales', submitterUid: 'u-sales', createdAt: { __ts: true } });
    // a first filing in its chain: the quote is its own root (the bridge stamps rootQuoteId on the doc, the thread key follows the same id)
    const F = makeBridge(); await F.send('QUOTE_APPROVAL_REQUESTED', payload({ rootQuoteId: null, parentQuoteId: null }), {});
    assert.equal(commentAdds(F)[0].data.threadKey, 'bk_quotes_' + quoteAdd(F).id); assert.equal(commentAdds(F)[0].data.rootQuoteId, quoteAdd(F).id);
    // the thread preview on the quote itself is updated best-effort (dotted paths)
    const pv = S.updates.find((u) => u.coll === 'bk_quotes' && u.id === doc.id && 'approvalThread.count' in u.patch);
    assert.ok(pv, 'the quote\'s approvalThread preview is updated');
    assert.deepEqual(plain(pv.patch), { 'approvalThread.count': { __inc: 1 }, 'approvalThread.lastText': 'A line needs review.', 'approvalThread.lastByName': 'Sales Tester', 'approvalThread.lastByRole': 'sales', 'approvalThread.lastAt': { __ts: true } });
  });
  it('the President is told with the review-page link of the NEW quote (bk.<id>, bs.<id>); title and body are the ones he always got', async () => {
    const S = makeBridge();
    await S.send('QUOTE_APPROVAL_REQUESTED', payload(), {});
    assert.equal(S.notified.length, 1);
    const n = S.notified[0];
    assert.equal(n.link, 'quote-approval/bk.' + quoteAdd(S).id);
    assert.deepEqual([n.type, n.icon, n.title], ['quote_review_request', '📤', '📤 Quote Awaiting Approval']);
    assert.match(n.body, /^Sales Tester submitted "BKZZTEST261120-007R1" for Mira Santos — ₱1234\.5 — please review\.$/);
    const B = makeBridge(); await B.send('QUOTE_APPROVAL_REQUESTED', payload({ company: 'BS' }), {});
    assert.equal(B.notified[0].link, 'quote-approval/bs.' + quoteAdd(B, 'bs_quotes').id);
    assert.equal(commentAdds(B)[0].data.coll, 'bs_quotes'); assert.equal(commentAdds(B)[0].data.threadKey, 'bs_quotes_' + ROOT_ID);
  });
  it('the shell\'s link window is shown ONCE with { coll, id, quoteNumber (the file name), clientName }, and the same info is remembered for the builder\'s badge', async () => {
    const S = makeBridge();
    await S.send('QUOTE_APPROVAL_REQUESTED', payload(), {});
    const id = quoteAdd(S).id;
    assert.deepEqual(S.links, [{ coll: 'bk_quotes', id, quoteNumber: 'BKZZTEST261120-007R1', clientName: 'Mira Santos' }]);
    assert.deepEqual(plain(S.win._qbLastApproval), S.links[0]);
    assert.ok(S.toasts.some((t) => t.t === 'success' && t.m === 'Sent for approval!'));
    const at = (o) => S.ops.indexOf(o);
    assert.ok(at('add approval_requests') < at('add quote_comments') && at('add quote_comments') < at('notify owner') && at('notify owner') < at('link modal'), S.ops.join(' | '));
    // a re-sent number is "<number> (2)": the window and the memory carry the file name
    const V = makeBridge({ rows: { bk_quotes: [{ createdBy: 'u-sales', quoteNumber: 'BKZZTEST261120-007R1' }] } });
    await V.send('QUOTE_APPROVAL_REQUESTED', payload(), {});
    assert.equal(V.links[0].quoteNumber, 'BKZZTEST261120-007R1 (2)');
  });
  it('a thread write that is refused (rules not deployed yet) does NOT stop the request for approval, the notification, the window or the success toast — and says nothing scary', async () => {
    const S = makeBridge({ failComments: true });
    await S.send('QUOTE_APPROVAL_REQUESTED', payload(), {});
    assert.ok(S.ops.includes('add approval_requests') && S.ops.includes('notify owner') && S.ops.includes('link modal'));
    assert.equal(S.links.length, 1);
    assert.ok(S.toasts.some((t) => t.t === 'success' && t.m === 'Sent for approval!'));
    assert.equal(S.toasts.some((t) => /NOT saved/.test(t.m)), false, 'the quote WAS saved; no failure toast');
    // the preview update failing, too
    const P = makeBridge({ failPreview: true }); await P.send('QUOTE_APPROVAL_REQUESTED', payload(), {});
    assert.equal(commentAdds(P).length, 1); assert.equal(P.links.length, 1); assert.equal(P.toasts.some((t) => /NOT saved/.test(t.m)), false);
    // a link window that throws is only logged: the quote is saved and the owner told
    const M = makeBridge({ modalThrows: true }); await M.send('QUOTE_APPROVAL_REQUESTED', payload(), {});
    assert.ok(M.ops.includes('notify owner')); assert.equal(M.toasts.some((t) => /NOT saved/.test(t.m)), false);
  });
  it('QB_SHOW_APPROVAL_LINK (the Pending Approval badge): the remembered quote first; else a valid {docId, collection} pair from the page; else only a toast; a collection outside QUOTE_COLLECTIONS is refused; it never writes', async () => {
    const last = { coll: 'bk_quotes', id: BK, quoteNumber: 'N-1', clientName: 'C' };
    const A = makeBridge({ last });
    await A.send('QB_SHOW_APPROVAL_LINK', { docId: 'qdOTHER000000000009', collection: 'bs_quotes', quoteNumber: 'ignored', clientName: 'ignored' });
    assert.deepEqual(A.links, [last], 'the remembered one wins');
    const B = makeBridge();
    await B.send('QB_SHOW_APPROVAL_LINK', { docId: 'qdOTHER000000000009', collection: 'bs_quotes', quoteNumber: 'N-2', clientName: 'D' });
    assert.deepEqual(B.links, [{ coll: 'bs_quotes', id: 'qdOTHER000000000009', quoteNumber: 'N-2', clientName: 'D' }]);
    for (const p of [{ docId: null, collection: null }, { docId: 'qdOTHER000000000009', collection: 'users' }, { docId: 'qdOTHER000000000009', collection: 'quotes' }, { docId: '', collection: 'bk_quotes' }, {}]) {
      const C = makeBridge(); await C.send('QB_SHOW_APPROVAL_LINK', p);
      assert.deepEqual(C.links, [], JSON.stringify(p));
      assert.ok(C.toasts.some((t) => t.t === 'info' && /Open this quote from the Quotes list to copy its approval link\./.test(t.m)), JSON.stringify(p));
    }
    for (const S of [A, B]) { assert.equal(S.adds.length, 0); assert.equal(S.updates.length, 0); assert.deepEqual(S.ops.filter((o) => !/^link modal$/.test(o)), []); }
    // an id that the link pattern refuses reaches the window, which refuses it (toast), not the router
    const D = makeBridge(); await D.send('QB_SHOW_APPROVAL_LINK', { docId: 'a<b>', collection: 'bk_quotes' }); assert.equal(D.links.length, 1, 'the window itself validates (section 3, next test)');
  });
  it('the bridge sets _qbLastApproval to null when the builder page mounts (renderQuoteBuilderIframe), once per page', () => {
    const fn = piece(APP, /^function renderQuoteBuilderIframe\(\) \{[\s\S]*?\n\}/m, 'renderQuoteBuilderIframe');
    assert.match(fn, /window\._qbLastApproval = null;/);
    assert.ok(fn.indexOf('window._qbLastApproval = null;') < fn.indexOf('c.innerHTML'), 'before the page paints');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('3b · the shell\'s "Approval link" window (js/app.js window.showQuoteApprovalLink)', () => {
  const FN = appWin('showQuoteApprovalLink');
  function makeWindow(opts) {
    opts = opts || {};
    const modals = [], toasts = [], copied = [], shared = [], navs = [], closed = [], exec = [];
    let html = '';
    const nodes = {};
    const unesc = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const node = (sel) => {
      if (!html.includes('id="' + sel.slice(1) + '"')) return null;
      if (!nodes[sel]) {
        const n = { handlers: {}, value: '', textContent: sel === '#qal-copy' ? 'Copy link' : sel === '#qal-copy-msg' ? 'Copy message' : '', select() { n.selected = true; }, addEventListener(t, f) { n.handlers[t] = f; } };
        if (sel === '#qal-url') n.value = unesc(html.match(/id="qal-url"[^>]*value="([^"]*)"/)[1]);
        if (sel === '#qal-msg') n.value = unesc(html.match(/<textarea id="qal-msg"[^>]*>([\s\S]*?)<\/textarea>/)[1]);
        nodes[sel] = n;
      }
      return nodes[sel];
    };
    const win = { QUOTE_COLLECTIONS: ['bk_quotes', 'bs_quotes'], navigator: undefined };
    const navigator = { clipboard: opts.noClipboard ? undefined : { writeText: async (t) => { if (opts.clipboardFails) throw new Error('denied'); copied.push(t); } }, share: opts.share ? async (d) => { shared.push(plain(d)); if (opts.shareCancels) throw new Error('AbortError'); } : undefined };
    win.navigator = navigator;
    const ctx = vm.createContext({
      window: win, navigator, location: { origin: ORIGIN }, console, setTimeout: () => 0,
      openModal: (title, body, footer) => { modals.push({ title, body, footer }); html = body + footer; },
      closeModal: () => closed.push(true), navigateTo: (p, o) => navs.push([p, plain(o)]), escHtml: undefined,
      document: { getElementById: (id) => (id === 'modal-box' ? { querySelector: node } : null), execCommand: (c) => { exec.push(c); return true; } },
      Notifs: { showToast: (m, t) => toasts.push({ m, t }) },
    });
    vm.runInContext(ESC_SRC + '\n' + cfgPiece('quoteApprovalRefOf') + '\n' + cfgPiece('quoteApprovalUrl') + '\n' + FN, ctx);
    return { show: (info) => ctx.window.showQuoteApprovalLink(info), modals, toasts, copied, shared, navs, closed, exec, node, get html() { return html; } };
  }
  const INFO = { coll: 'bk_quotes', id: BK, quoteNumber: 'BKZZTEST261120-007R1', clientName: 'Mira Santos' };
  const URL_ = `${ORIGIN}/#/quote-approval/bk.${BK}`;

  it('shows "Approval link": the link in a read-only field, a Copy link button, "Ready to paste" with a Copy message button, the Messenger / Viber sentence, Open review page and Done', () => {
    const W = makeWindow(); W.show(INFO);
    assert.equal(W.modals.length, 1); assert.equal(W.modals[0].title, 'Approval link');
    const h = W.html;
    assert.ok(h.includes(`id="qal-url" readonly value="${URL_}"`));
    for (const must of ['id="qal-copy"', '>Copy link<', 'Ready to paste', 'id="qal-copy-msg"', '>Copy message<', 'Sent to the President for approval.', 'Send this link to the President by Messenger or Viber. He opens it, sees the whole quote, and can approve, return or comment.', 'id="qal-open"', '>Open review page<', 'id="qal-done"', '>Done<']) assert.ok(h.includes(must), must);
  });
  it('the ready-to-paste message is "Quote <number> for <client> needs your approval: <link>" and carries NO amount (D11)', () => {
    const W = makeWindow(); W.show(INFO);
    assert.equal(W.node('#qal-msg').value, `Quote BKZZTEST261120-007R1 for Mira Santos needs your approval: ${URL_}`);
    assert.equal(/₱|PHP|\bpesos?\b|total/i.test(W.node('#qal-msg').value), false);
    const N = makeWindow(); N.show({ coll: 'bs_quotes', id: BK, quoteNumber: 'N-1', clientName: '' });
    assert.equal(N.node('#qal-msg').value, `Quote N-1 for the client needs your approval: ${ORIGIN}/#/quote-approval/bs.${BK}`);
  });
  it('every string is escaped: a client or number carrying markup never reaches the body or the paste box as markup', () => {
    const W = makeWindow(); W.show({ coll: 'bk_quotes', id: BK, quoteNumber: '<b>N</b>', clientName: '<img src=x onerror=1>' });
    assert.equal(W.html.includes('<img src=x onerror=1>'), false); assert.equal(W.html.includes('<b>N</b>'), false);
    assert.ok(W.html.includes('&lt;img src=x onerror=1&gt;'));
    assert.equal(W.node('#qal-msg').value.includes('<img src=x onerror=1>'), true, 'the message text itself is plain text (a textarea holds it escaped, the browser un-escapes it)');
  });
  it('Share… exists only where navigator.share does; it shares { title, text (the message), url }; a cancelled share is ignored', async () => {
    const W = makeWindow(); W.show(INFO); assert.equal(W.html.includes('id="qal-share"'), false); assert.equal(W.node('#qal-share'), null);
    const S = makeWindow({ share: true }); S.show(INFO); assert.ok(S.html.includes('id="qal-share"'));
    await S.node('#qal-share').handlers.click();
    assert.deepEqual(S.shared, [{ title: 'Quote BKZZTEST261120-007R1 for approval', text: `Quote BKZZTEST261120-007R1 for Mira Santos needs your approval: ${URL_}`, url: URL_ }]);
    const C = makeWindow({ share: true, shareCancels: true }); C.show(INFO); await C.node('#qal-share').handlers.click();   // must not throw
    assert.equal(C.toasts.length, 0);
  });
  it('Copy link copies the link and says "Approval link copied"; Copy message copies the message ("Message copied"); a clipboard that refuses falls back to select + execCommand', async () => {
    const W = makeWindow(); W.show(INFO);
    await W.node('#qal-copy').handlers.click(); await W.node('#qal-copy-msg').handlers.click();
    assert.deepEqual(W.copied, [URL_, `Quote BKZZTEST261120-007R1 for Mira Santos needs your approval: ${URL_}`]);
    assert.deepEqual(W.toasts.map((t) => [t.m, t.t]), [['Approval link copied', 'success'], ['Message copied', 'success']]);
    const F = makeWindow({ clipboardFails: true }); F.show(INFO); await F.node('#qal-copy').handlers.click();
    assert.deepEqual(F.copied, []); assert.deepEqual(F.exec, ['copy']); assert.equal(F.node('#qal-url').selected, true); assert.equal(F.toasts[0].m, 'Approval link copied');
    const N = makeWindow({ noClipboard: true }); N.show(INFO); await N.node('#qal-copy').handlers.click(); assert.deepEqual(N.exec, ['copy']);
  });
  it('Open review page goes to the quote — and does NOT call closeModal() first (history.back() would land after navigateTo\'s own history write and take the user back to the builder); Done closes', () => {
    const W = makeWindow(); W.show(INFO);
    W.node('#qal-open').handlers.click();
    assert.deepEqual(W.navs, [['quote-approval', { subtab: 'bk.' + BK }]]); assert.equal(W.closed.length, 0);
    W.node('#qal-done').handlers.click(); assert.equal(W.closed.length, 1);
    assert.equal(/closeModal\(\);\s*navigateTo/.test(FN), false);
  });
  it('a pair that is not a valid quote (a draft, a bad id, an unknown collection, nothing) gets the toast "This quote has no approval link." and no window', () => {
    for (const info of [{ coll: 'bk_quotes', id: 'draft_u1abcdef' }, { coll: 'bk_quotes', id: 'a<b>' }, { coll: 'users', id: BK }, {}, undefined, null]) {
      const W = makeWindow(); W.show(info);
      assert.equal(W.modals.length, 0, JSON.stringify(info));
      assert.deepEqual(W.toasts, [{ m: 'This quote has no approval link.', t: 'error' }], JSON.stringify(info));
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('4 · window.QuoteThread (js/svc-approvals.js)', () => {
  const QT_SRC = piece(SVC, /^window\.QuoteThread = \{[\s\S]*?\n\};/m, 'window.QuoteThread');
  function makeThread(opts) {
    opts = opts || {};
    const D = makeDb(opts);
    const win = {};
    const ctx = vm.createContext({ window: win, db: D.db, firebase: { firestore: { FieldValue: FV } }, currentUser: { uid: opts.uid || 'u-sales' }, currentRole: opts.role || 'employee', console: { warn() {}, error() {}, log() {} } });
    vm.runInContext(QT_SRC, ctx);
    return Object.assign(D, { QT: win.QuoteThread });
  }
  const O = (over) => Object.assign({ coll: 'bk_quotes', quoteId: BK, q: { createdBy: 'u-sales', rootQuoteId: ROOT_ID, quoteNumber: 'BKZZTEST261120-007R1' }, kind: 'comment', text: '  hello  ', uid: 'u-pres', name: 'The President', role: 'president' }, over || {});

  it('keyOf is "<coll>_<rootQuoteId>", the doc\'s own id when the quote has no root (an old quote)', () => {
    const { QT } = makeThread();
    assert.equal(QT.keyOf('bk_quotes', { rootQuoteId: ROOT_ID }, BK), 'bk_quotes_' + ROOT_ID);
    assert.equal(QT.keyOf('bs_quotes', {}, BK), 'bs_quotes_' + BK); assert.equal(QT.keyOf('bs_quotes', null, BK), 'bs_quotes_' + BK);
  });
  it('entry returns exactly the 11 data keys (no createdAt), trims and caps the text, takes the role by the app role, and the submitter from the quote', () => {
    const { QT } = makeThread();
    const e = plain(QT.entry(O()));
    assert.deepEqual(Object.keys(e).sort(), ['authorName', 'authorRole', 'authorUid', 'coll', 'kind', 'quoteId', 'quoteNumber', 'rootQuoteId', 'submitterUid', 'text', 'threadKey']);
    assert.deepEqual(e, { threadKey: 'bk_quotes_' + ROOT_ID, coll: 'bk_quotes', quoteId: BK, rootQuoteId: ROOT_ID, quoteNumber: 'BKZZTEST261120-007R1', kind: 'comment', text: 'hello', authorUid: 'u-pres', authorName: 'The President', authorRole: 'president', submitterUid: 'u-sales' });
    assert.equal(QT.entry(O({ text: 'x'.repeat(2500) })).text.length, 2000);
    assert.equal(QT.entry(O({ name: 'n'.repeat(300) })).authorName.length, 120);
    assert.equal(QT.entry(O({ q: { createdBy: 'u', quoteNumber: 'q'.repeat(200) } })).quoteNumber.length, 80);
    for (const role of ['employee', 'manager', 'secretary', 'agent', 'finance', '', undefined, null]) assert.equal(QT.entry(O({ role })).authorRole, 'sales', String(role));
    assert.equal(QT.entry(O({ q: { createdBy: 'u-sales' } })).rootQuoteId, BK, 'no root: the quote is its own root');
    assert.equal(QT.entry(O({ q: { createdBy: 'u-sales' } })).quoteNumber, BK.slice(-6).toUpperCase(), 'no number: the id\'s tail, as the Quotes list does');
    assert.equal(QT.entry(O({ q: {} })).submitterUid, '', 'no creator: empty (the rules then refuse a Sales entry, which is right)');
    assert.equal(QT.entry(O({ kind: 'weird' })).kind, 'comment'); for (const k of ['comment', 'returned', 'approved', 'submitted']) assert.equal(QT.entry(O({ kind: k })).kind, k);
  });
  it('entry throws nothing on junk', () => {
    const { QT } = makeThread();
    for (const o of [undefined, null, 5, 'x', [], {}, { q: 7 }, { q: [] }, { coll: null, quoteId: null, q: null, text: {}, name: [], uid: {} }]) assert.doesNotThrow(() => QT.entry(o), JSON.stringify(o));
  });
  it('add writes the entry + a server createdAt to quote_comments, then updates the quote\'s approvalThread preview with dotted paths; returns { ok, id }', async () => {
    const S = makeThread();
    const r = plain(await S.QT.add(O({ text: 'y'.repeat(500) })));
    assert.deepEqual([r.ok, typeof r.id], [true, 'string']);
    assert.equal(S.adds.length, 1); assert.equal(S.adds[0].coll, 'quote_comments');
    assert.deepEqual(plain(S.adds[0].data.createdAt), { __ts: true });
    assert.deepEqual(Object.keys(S.adds[0].data).sort(), ['authorName', 'authorRole', 'authorUid', 'coll', 'createdAt', 'kind', 'quoteId', 'quoteNumber', 'rootQuoteId', 'submitterUid', 'text', 'threadKey']);
    const pv = S.updates[0];
    assert.deepEqual([pv.coll, pv.id], ['bk_quotes', BK]);
    assert.deepEqual(plain(pv.patch), { 'approvalThread.count': { __inc: 1 }, 'approvalThread.lastText': 'y'.repeat(200), 'approvalThread.lastByName': 'The President', 'approvalThread.lastByRole': 'president', 'approvalThread.lastAt': { __ts: true } });
  });
  it('add NEVER throws: a rejected write resolves { ok: false, error } and updates nothing; a failing preview update still resolves { ok: true }', async () => {
    const R = makeThread({ failComments: true });
    const r = plain(await R.QT.add(O()));
    assert.equal(r.ok, false); assert.equal(r.error, 'permission-denied'); assert.equal(R.updates.length, 0, 'no preview for an entry that was not written');
    const P = makeThread({ failPreview: true });
    const p = plain(await P.QT.add(O())); assert.equal(p.ok, true); assert.equal(P.adds.length, 1);
    for (const o of [undefined, null, {}, { coll: 5 }]) { const x = plain(await makeThread().QT.add(o)); assert.equal(typeof x.ok, 'boolean'); }
  });
  it('list asks for the chain by threadKey; the President, a manager and the secretary read it whole; everyone else adds the submitterUid filter (the read rule is provable only with it)', async () => {
    const rows = { quote_comments: [{ id: 'a', threadKey: 'bk_quotes_' + ROOT_ID, submitterUid: 'u-sales', text: 'x' }, { id: 'b', threadKey: 'bk_quotes_' + ROOT_ID, submitterUid: 'u-other', text: 'y' }, { id: 'c', threadKey: 'bk_quotes_other', submitterUid: 'u-sales', text: 'z' }] };
    for (const role of ['president', 'manager', 'secretary']) {
      const S = makeThread({ role, rows });
      const got = await S.QT.list('bk_quotes', { rootQuoteId: ROOT_ID }, BK);
      assert.deepEqual(plain(S.queries[0].filters), [['threadKey', '==', 'bk_quotes_' + ROOT_ID]], role);
      assert.deepEqual(got.map((x) => x.id).sort(), ['a', 'b'], role + ': the whole chain');
    }
    for (const role of ['employee', 'finance', 'agent']) {
      const S = makeThread({ role, uid: 'u-sales', rows });
      const got = await S.QT.list('bk_quotes', { rootQuoteId: ROOT_ID }, BK);
      assert.deepEqual(plain(S.queries[0].filters), [['threadKey', '==', 'bk_quotes_' + ROOT_ID], ['submitterUid', '==', 'u-sales']], role);
      assert.deepEqual(got.map((x) => x.id), ['a'], role + ': only his own');
    }
  });
  it('list sorts oldest first by createdAt (a Timestamp, a number or seconds), and an entry whose createdAt is still null (a pending write) goes last; it carries the doc id', async () => {
    const ts = (ms) => ({ toMillis: () => ms });
    const rows = { quote_comments: [
      { id: 'late', threadKey: 'bk_quotes_' + ROOT_ID, createdAt: ts(3000) }, { id: 'pending', threadKey: 'bk_quotes_' + ROOT_ID, createdAt: null }, { id: 'early', threadKey: 'bk_quotes_' + ROOT_ID, createdAt: ts(1000) },
      { id: 'secs', threadKey: 'bk_quotes_' + ROOT_ID, createdAt: { seconds: 2 } }, { id: 'num', threadKey: 'bk_quotes_' + ROOT_ID, createdAt: 2500 }] };
    const S = makeThread({ role: 'president', rows });
    assert.deepEqual((await S.QT.list('bk_quotes', { rootQuoteId: ROOT_ID }, BK)).map((x) => x.id), ['early', 'secs', 'num', 'late', 'pending']);
  });
  it('list rejects with the Firestore error (the page treats permission-denied as "comments are not available yet"), and has no orderBy', async () => {
    const S = makeThread({ role: 'president', listFails: true });
    await assert.rejects(() => S.QT.list('bk_quotes', {}, BK), (e) => e.code === 'permission-denied');
    assert.equal(/orderBy/.test(QT_SRC), false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// the review page's pure half, loaded the way the browser loads it: the REAL js/forms-core.js and js/qb-spec-sheet.js on `window`, then js/screens/quote-approval.js
function loadPage() {
  const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} }, Date, Intl, URL });
  vm.runInContext('globalThis.window = globalThis;', ctx);
  vm.runInContext(read('js/forms-core.js'), ctx, { filename: 'js/forms-core.js' });
  vm.runInContext(read('js/qb-spec-sheet.js'), ctx, { filename: 'js/qb-spec-sheet.js' });
  vm.runInContext(ESC_SRC, ctx);
  vm.runInContext(read('js/price-gate-core.js'), ctx, { filename: 'js/price-gate-core.js' });          // QUOTE-PRESIDENT-FIGURES-SPEC: the page calls the core's isHeaderRow, and the core reads PriceGate.lineKey
  vm.runInContext(read('js/quote-figures-core.js'), ctx, { filename: 'js/quote-figures-core.js' });
  vm.runInContext(PAGE, ctx, { filename: 'js/screens/quote-approval.js' });
  return ctx;
}
const PAGE_CTX = loadPage();
const QA = PAGE_CTX.window.QuoteApproval;
const esc = PAGE_CTX.escHtml;
const LIB = { FormsCore: PAGE_CTX.window.FormsCore, QBSpecSheet: PAGE_CTX.window.QBSpecSheet };
const STORAGE = 'https://firebasestorage.googleapis.com/v0/b/test-bucket.firebasestorage.app/o/';
const XSS = '<img src=x onerror=1>';

const kcLine = (over) => Object.assign({ id: 'KC', kcKind: 'chef_hp', kcId: 'K1', category: 'cook', name: 'Chef Mode stove', dims: '1000 x 800 x 850', qty: 2, unit: 'pc', unitPrice: 1234.5, amount: 2469, priceBasis: 'configured',
  doc: { code: 'CK-HP-4', material: 'SS304', use: 'commercial', title: 'Chef Mode stove', sub: 'Four-burner high-pressure range', dims: '1000 x 800 x 850', specs: 'Burners: 4\nIgnition: piezo', notes: ['n'], includes: ['gas hose', 'regulator'], excludes: ['gas line'] },
  specEdit: 'Burners: 4\nIgnition: piezo', notes: 'Customer wants it by the door', leadTime: '25 working days' }, over || {});
const catLine = (over) => Object.assign({ id: 'PW-001', category: 'prep_washing', name: 'Work table', dims: '900 x 600', specs: [{ label: 'Material', value: 'SS304' }, { label: 'Gauge', value: '1.2 mm' }], qty: 3, unit: 'pc', unitPrice: 421.75, amount: 1265.25,
  photoUrl: STORAGE + 'cat.jpg', includes: ['adjustable feet'], leadTime: '14-21 days' }, over || {});
const customLine = (over) => Object.assign({ id: 'CUSTOM', category: 'extras', catLabel: 'Extras', name: 'Delivery cart', qty: 1, unit: 'pc', unitPrice: 99.25, amount: 99.25, priceBasis: 'manual' }, over || {});
const headerRow = (over) => Object.assign({ id: 'CUSTOM', category: 'sec_b', catLabel: 'Option B', name: 'New item', qty: 1, unitPrice: 0, amount: 0 }, over || {});
const quote = (over) => Object.assign({
  quoteNumber: 'BKZZTEST261120-007R1', company: 'BK', clientName: 'Mira Santos', clientCompany: 'Santos Test Kitchen', location: 'Pasig', quoteDate: '2026-11-20', validUntil: '2026-12-05',
  subject: 'Test kitchen package', purpose: 'Restaurant', agentName: 'Sales Tester', createdBy: 'u-sales', createdAt: { seconds: 1700000000 }, reviewRequestedAt: { seconds: 1700000100 },
  status: 'pending_approval', approvalStatus: 'pending_review', rootQuoteId: ROOT_ID, editableState: { pricing: { warrantyPlan: 'service6' } },
  items: [kcLine(), catLine(), customLine()], photos: [],
  subtotal: 3833.5, discountPct: 5, discountAmount: 191.68, netAmount: 3641.82, vatIncluded: true, vatAmount: 390.19, grandTotal: 3641.82, total: 3641.82,
  deliveryInstall: { amount: 50.5, includedInTotal: true, free: false, method: 'Own truck', notes: 'Ground floor' },
  timeline: { startDate: '2026-12-10', leadDays: 25, completionDate: '2027-01-04' }, remarks: 'Remark line', commissionPct: 3, commissionAmount: 109.25,
  payment: { downPaymentMode: '50', downPayment: 1820.91, balance: 1820.91, balanceMode: 'lump', interestRate: 0 },
}, over || {});
const baseCtx = (over) => Object.assign({ coll: 'bk_quotes', id: BK, ref: 'bk.' + BK, role: 'president', uid: 'u-pres', lib: LIB, comments: [], now: 1700000500000 }, over || {});
const view = (q, c) => { const vm = QA.viewModel(q, baseCtx(c)); return { vm, html: QA.html(vm, esc) }; };
const SIDECAR = (over) => Object.assign({ v: 1, items: [{ i: 0, n: 'Chef Mode stove', kc: { kcId: 'K1', kind: 'chef_hp', projectCost: 600.5 } }, { i: 1, n: 'Work table', capitalMaterials: 100, capitalLabor: 50 }, { i: 2, n: 'Delivery cart', costMat: 40 }] }, over || {});
const KCSUM = (over) => Object.assign({ net: 1000, projectCost: 600, standardTotal: 900, costKnown: true, markup: 2, floorMode: 'list' }, over || {});

describe('5 · the review page: view model and markup (js/screens/quote-approval.js, real FormsCore and QBSpecSheet)', () => {
  it('COST NEVER REACHES ANYONE BUT THE PRESIDENT: for every other role vm.cost is null even when a sidecar is handed in, and none of the cost words is in the markup', () => {
    const sc = SIDECAR({ kcSummary: KCSUM(), markupOvr: 2.4, approval: { lastApprovedNet: 1000, approvedAt: { seconds: 1700000000 }, approvedByName: 'The President' } });
    for (const role of ['employee', 'manager', 'secretary', 'finance', 'agent', 'partner', '', undefined, null, 'President', ' president']) {
      const { vm, html } = view(quote(), { role, uid: 'u-sales', sidecar: sc });
      assert.equal(vm.cost, null, String(role));
      for (const word of ['Cost and margin', 'Project cost', 'Unit cost', 'Unit margin', 'Standard total', 'Commission', 'Materials only', 'No cost on file', 'Markup set for this quote', 'Last approved at net']) assert.equal(html.includes(word), false, `${role}: "${word}" is in the page`);
      assert.equal(vm.groups.every((g) => g.lines.every((L) => L.cost === null)), true, 'no line carries a cost row');
    }
    const { vm, html } = view(quote(), { sidecar: sc });
    assert.notEqual(vm.cost, null); assert.ok(html.includes('Cost and margin') && html.includes('Unit cost'));
  });
  it('the President\'s panel with a configurator summary: margin = net - project cost (and its share of net), the standard total, markup and basis; "Below standard by" ONLY when net < standard', () => {
    const rows = (net, std, extra) => view(quote(), { sidecar: SIDECAR({ kcSummary: KCSUM(Object.assign({ net, standardTotal: std }, extra || {})) }) }).vm.cost.rows;
    const ok = rows(1000, 900); const by = (r, label) => r.find((x) => x.label === label);
    assert.deepEqual(plain(by(ok, 'Net selling')), { label: 'Net selling', value: '₱1,000.00' });
    assert.deepEqual(plain(by(ok, 'Project cost')), { label: 'Project cost', value: '₱600.00' });
    assert.equal(by(ok, 'Margin').value, '₱400.00 (40.0% of net)');
    assert.equal(by(ok, 'Standard total').value, '₱900.00'); assert.equal(by(ok, 'Markup').value, '2'); assert.equal(by(ok, 'Basis').value, 'list prices');
    assert.equal(ok.some((r) => /Below standard/.test(r.label)), false, 'net above standard: no warning');
    assert.equal(rows(900, 900).some((r) => /Below standard/.test(r.label)), false, 'net equal to standard: no warning');
    const low = rows(800, 900);
    assert.deepEqual(plain(low.find((r) => /Below standard/.test(r.label))), { label: 'Below standard by ₱100.00', value: '', tone: 'bad' });
    assert.equal(by(rows(1000, 900, { floorMode: 'formula' }), 'Basis').value, 'cost × markup');
    assert.equal(by(rows(1000, 900, { floorMode: 'other' }), 'Basis'), undefined);
  });
  it('costKnown false: "Cost is not complete for this quote" and NO project cost, margin or percent; the net and the standard still show', () => {
    const rows = view(quote({ commissionPct: 0, commissionAmount: 0 }), { sidecar: SIDECAR({ kcSummary: KCSUM({ costKnown: false }) }) }).vm.cost.rows;
    assert.ok(rows.some((r) => r.label === 'Cost is not complete for this quote'));
    assert.equal(rows.some((r) => /^(Project cost|Margin)$/.test(r.label) || /%/.test(r.value)), false);
    assert.ok(rows.some((r) => r.label === 'Net selling') && rows.some((r) => r.label === 'Standard total'));
    for (const bad of [undefined, 'true', 1, 0]) assert.ok(view(quote(), { sidecar: SIDECAR({ kcSummary: KCSUM({ costKnown: bad }) }) }).vm.cost.rows.some((r) => r.label === 'Cost is not complete for this quote'), 'only === true counts: ' + bad);
  });
  it('the markup override, the last approval and the commission are rows of the President\'s panel; commission only when above zero; no sidecar says so', () => {
    const rows = view(quote(), { sidecar: SIDECAR({ kcSummary: KCSUM(), markupOvr: 2.4, approval: { lastApprovedNet: 950.5, approvedAt: { seconds: 1700000000 }, approvedByName: 'The President' } }) }).vm.cost.rows;
    assert.ok(rows.some((r) => r.label === 'Markup set for this quote' && r.value === '2.4'));
    assert.ok(rows.some((r) => /^Last approved at net ₱950\.50 on .+ by The President$/.test(r.label)));
    assert.deepEqual(plain(rows.find((r) => r.label === 'Commission')), { label: 'Commission', value: '3% · ₱109.25' });
    assert.equal(view(quote({ commissionPct: 0, commissionAmount: 0 }), { sidecar: SIDECAR({ kcSummary: KCSUM() }) }).vm.cost.rows.some((r) => r.label === 'Commission'), false);
    const none = view(quote(), { sidecar: null });
    assert.deepEqual(plain(none.vm.cost), { none: true, rows: [] }); assert.ok(none.html.includes('No cost record was saved with this quote.'));
  });
  it('without a configurator summary: the known cost is the sum over the lines that have a full unit cost; a line without one makes it "Partial: n of m", and the margin waits until none is missing', () => {
    const partial = view(quote({ commissionPct: 0, commissionAmount: 0 }), { sidecar: SIDECAR() }).vm.cost.rows;
    assert.deepEqual(plain(partial), [{ label: 'Known cost (Partial: 2 of 3 lines have a cost)', value: '₱1,651.00' }]);
    const full = view(quote({ commissionPct: 0, commissionAmount: 0 }), { sidecar: SIDECAR({ items: [{ i: 0, n: 'Chef Mode stove', kc: { kcId: 'K1', projectCost: 600.5 } }, { i: 1, n: 'Work table', capitalMaterials: 100, capitalLabor: 50 }, { i: 2, n: 'Delivery cart', capitalMaterials: 40 }] }) }).vm.cost.rows;
    assert.equal(full[0].label, 'Total cost'); assert.equal(full[0].value, '₱1,691.00');
    assert.equal(full[1].label, 'Margin'); assert.equal(full[1].value, '₱1,950.82 (53.6% of net)');
  });
  it('per line (all figures per unit): a configurator row is its project cost; a catalogue row its capital materials + labor; materials alone is labelled and gets no percent; no row says "No cost on file"', () => {
    const { vm, html } = view(quote(), { sidecar: SIDECAR() });
    const [kc, cat, cust] = vm.groups.flatMap((g) => g.lines);
    assert.deepEqual(plain(kc.cost), { none: false, unitCost: '₱600.50', unitMargin: '₱634.00', marginPct: '51.4%', label: '' });
    assert.deepEqual(plain(cat.cost), { none: false, unitCost: '₱150.00', unitMargin: '₱271.75', marginPct: '64.4%', label: '' });
    assert.deepEqual(plain(cust.cost), { none: false, unitCost: '₱40.00', unitMargin: '₱59.25', marginPct: '', label: 'Materials only (labor not costed)' });
    assert.ok(html.includes('Materials only (labor not costed)'));
    const bom = view(quote({ items: [customLine()] }), { sidecar: SIDECAR({ items: [{ i: 0, n: 'Delivery cart', bom: [{ name: 'a', qty: 2, unitPrice: 10 }, { name: 'b', qty: 1, unitPrice: 5.5 }] }] }) }).vm.groups[0].lines[0].cost;
    assert.equal(bom.unitCost, '₱25.50'); assert.equal(bom.label, 'Materials only (labor not costed)'); assert.equal(bom.marginPct, '');
    const missing = view(quote(), { sidecar: SIDECAR({ items: [] }) });
    assert.ok(missing.vm.groups.every((g) => g.lines.every((L) => L.cost.none)) && missing.html.includes('No cost on file'));
  });
  it('sidecar rows match their own line only: the index AND the name (cut at 120) must agree; two configurator ids that both exist decide it; an unmatched row is never shown on another line', () => {
    const lines = (sc) => plain(view(quote(), { sidecar: sc }).vm.groups.flatMap((g) => g.lines).map((L) => L.cost && (L.cost.none ? 'none' : L.cost.unitCost)));
    assert.deepEqual(lines(SIDECAR()), ['₱600.50', '₱150.00', '₱40.00']);
    assert.deepEqual(lines(SIDECAR({ items: [{ i: 1, n: 'Some other table', capitalMaterials: 999 }, { i: 0, n: 'Chef Mode stove', kc: { kcId: 'K1', projectCost: 600.5 } }] })), ['₱600.50', 'none', 'none'], 'a row whose name does not match its line is ignored (and shown nowhere else)');
    assert.deepEqual(lines(SIDECAR({ items: [{ i: 2, n: 'Work table', capitalMaterials: 7 }] })), ['none', 'none', 'none'], 'the right name at the wrong index');
    assert.deepEqual(lines(SIDECAR({ items: [{ i: 0, n: 'Old name of the stove', kc: { kcId: 'K1', projectCost: 610 } }] })), ['₱610.00', 'none', 'none'], 'a configurator row matches by kcId even when the name moved on');
    assert.deepEqual(lines(SIDECAR({ items: [{ i: 0, n: 'Chef Mode stove', kc: { kcId: 'K2', projectCost: 610 } }] })), ['none', 'none', 'none'], 'the same name but another kcId: not this line');
    const long = 'N'.repeat(150);
    assert.deepEqual(view(quote({ items: [catLine({ name: long })] }), { sidecar: SIDECAR({ items: [{ i: 0, n: long.slice(0, 120), capitalMaterials: 20 }] }) }).vm.groups[0].lines[0].cost.unitCost, '₱20.00', 'the sidecar keeps the first 120 characters of the name');
  });
});

describe('5b · photos, escaping, sections, legacy quotes, options', () => {
  it('safeImg lets through only https on the Firebase Storage hosts (firebasestorage.googleapis.com, *.firebasestorage.app, *.appspot.com) and a same-site relative path', () => {
    const ok = [STORAGE + 'a.jpg', 'https://firebasestorage.googleapis.com/v0/b/x/o/a.jpg?alt=media&token=t', 'https://x.firebasestorage.app/a.png', 'https://test-bucket.appspot.com/a.png', '/site/img/a.webp', 'site/img/a.webp', 'icons/a.png', './a.png'];
    for (const u of ok) assert.equal(QA.safeImg(u), u, u);
    const bad = ['', undefined, null, 'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:image/png;base64,AAAA', 'http://firebasestorage.googleapis.com/a.jpg', 'https://evil.example/a.png', 'https://firebasestorage.googleapis.com.evil.example/a.png',
      'https://firebasestorage.googleapis.com@evil.example/a.png', 'https://evilfirebasestorage.app/a.png', 'https://firebasestorage.app/a.png', '//evil.example/a.png', '\\\\evil.example\\a.png', 'ftp://x/a.png', 'blob:https://x/1', '/a.png" onerror="x', "/a.png' onerror='x", '/a.png<b>', 'a b.png', 'mailto:a@b.c'];
    for (const u of bad) assert.equal(QA.safeImg(u), '', JSON.stringify(u));
  });
  it('a line\'s photo: the photo linked to it wins over its catalogue photoUrl; no photo shows the placeholder icon; "+N" counts the other linked photos; a hostile url is dropped, never rendered', () => {
    const photos = [{ url: STORAGE + 'linked1.jpg', caption: 'Front <i>', itemIndex: 1 }, { url: STORAGE + 'linked2.jpg', caption: '', itemIndex: 1 }, { url: 'https://evil.example/x.png', itemIndex: 0 }, { url: 'javascript:alert(1)', itemIndex: 2 }];
    const { vm, html } = view(quote({ photos }));
    const [kc, cat, cust] = vm.groups.flatMap((g) => g.lines);
    assert.deepEqual(plain(kc.photos), [], 'the only photo linked to line 0 is a foreign host: dropped, and the stove has no catalogue photo');
    assert.deepEqual(plain(cat.photos), [{ url: STORAGE + 'linked1.jpg', caption: 'Front <i>' }, { url: STORAGE + 'linked2.jpg', caption: '' }], 'the linked photos win over photoUrl (cat.jpg)');
    assert.deepEqual(plain(cust.photos), []);
    assert.equal(html.includes('cat.jpg'), false); assert.ok(html.includes('linked1.jpg'));
    assert.ok(html.includes('qa-thumb-more">+1<'), 'one more photo linked to this line: "+1"');
    assert.equal(html.includes('evil.example'), false); assert.equal(html.includes('javascript:'), false);
    assert.equal((html.match(/qa-thumb qa-thumb-empty/g) || []).length, 2, 'the two lines without a photo show the neutral placeholder icon');
    assert.ok(html.includes('<i data-lucide="image"></i>'));
    const own = view(quote({ photos: [] })).vm.groups.flatMap((g) => g.lines)[1];
    assert.deepEqual(plain(own.photos), [{ url: STORAGE + 'cat.jpg', caption: '' }], 'no linked photo: the catalogue photo');
    assert.deepEqual(plain(view(quote({ photos: [], items: [catLine({ photoUrl: 'https://evil.example/c.jpg' })] })).vm.groups[0].lines[0].photos), []);
  });
  it('the photo sets behind the thumbnails (what the lightbox opens) are per line, and the photos linked to no line land in "Other photos" with their captions', () => {
    const photos = [{ url: STORAGE + 'l.jpg', itemIndex: 1 }, { url: STORAGE + 'u1.jpg', caption: 'Site <b>', itemIndex: null }, { url: STORAGE + 'u2.jpg' }, { url: STORAGE + 'gone.jpg', itemIndex: 9 }, { url: 'javascript:x', itemIndex: null }, { url: STORAGE + 'h.jpg', itemIndex: 3 }];
    const { vm, html } = view(quote({ photos, items: [kcLine(), catLine(), customLine(), headerRow()] }));
    assert.deepEqual(Object.keys(vm.photoSets).sort(), ['1', 'other']);
    assert.deepEqual(plain(vm.photoSets.other).map((p) => p.url), [STORAGE + 'u1.jpg', STORAGE + 'u2.jpg', STORAGE + 'gone.jpg', STORAGE + 'h.jpg'], 'no itemIndex, an index that is not a line, a section row: all "other"');
    assert.ok(html.includes('<h4 class="qa-h">Other photos</h4>') && html.includes('u1.jpg') && html.includes('Site &lt;b&gt;'));
    assert.equal(html.includes('javascript:'), false);
    assert.equal(view(quote({ photos: [{ url: STORAGE + 'l.jpg', itemIndex: 1 }] })).html.includes('Other photos'), false, 'no strip when every photo is linked');
  });
  it('EVERY stored string is escaped: markup in the name, client, notes, specs, remarks, the President\'s note, a comment and its author never reaches the page as markup', () => {
    const q = quote({ clientName: XSS, clientCompany: XSS, location: XSS, subject: XSS, purpose: XSS, agentName: XSS, remarks: XSS, presidentNotes: XSS, validUntil: XSS, quoteDate: XSS,
      approvalWhy: { reasons: ['review'], text: XSS, ticked: false },
      items: [kcLine({ name: XSS, notes: XSS, dims: XSS, doc: Object.assign({}, kcLine().doc, { specs: XSS, sub: XSS, material: XSS, use: XSS, code: XSS, includes: [XSS], excludes: [XSS] }) }), catLine({ name: XSS, specs: [{ label: XSS, value: XSS }] }), customLine({ catLabel: XSS, name: XSS })],
      deliveryInstall: { amount: 5, method: XSS, notes: XSS }, payment: { milestones: [{ pct: 50, label: XSS, date: XSS, amount: 5 }] }, timeline: { startDate: XSS, leadDays: 3, completionDate: XSS },
      optionsMode: true, options: [{ key: 'a', label: XSS, itemCount: 1, total: 5 }], optionsBasis: 'a', photos: [{ url: STORAGE + 'a.jpg', caption: XSS, itemIndex: null }] });
    const comments = [{ kind: 'comment', authorName: XSS, authorRole: 'sales', quoteId: BK, quoteNumber: XSS, text: XSS, createdAt: { seconds: 1700000200 } }];
    for (const role of ['president', 'employee']) {
      const { html } = view(q, { role, uid: 'u-sales', comments, sidecar: SIDECAR(), newer: { ref: 'bk.' + NEW_ID, number: XSS } });
      assert.equal(html.includes(XSS), false, role + ': the raw payload is in the page');
      assert.equal(/<img src=x/i.test(html), false, role);
      assert.ok(html.includes('&lt;img src=x onerror=1&gt;'));
      assert.equal(/\sonerror=/i.test(html.replace(/&lt;[^]*?&gt;/g, '')), false, role + ': a handler survived');
    }
    // the same for the thread on its own (what the repaint after a comment uses)
    const th = QA.threadHtml(QA.thread(quote(), comments, { id: BK }), esc);
    assert.equal(th.includes(XSS), false); assert.ok(th.includes('&lt;img src=x onerror=1&gt;'));
  });
  it('sections follow FormsCore.sectionLabel in document order (a new group whenever the label changes); a kc line prints its item code, a custom line none; a section row prints its heading only', () => {
    const items = [kcLine(), kcLine({ kcId: 'K2', name: 'Second stove' }), catLine(), headerRow(), customLine(), catLine({ name: 'Back to prep' })];
    const { vm, html } = view(quote({ items }));
    assert.deepEqual(plain(vm.groups.map((g) => [g.heading, g.lines.map((L) => L.name)])), [['Cooking', ['Chef Mode stove', 'Second stove']], ['Preparation & Washing', ['Work table']], ['Option B', []], ['Extras', ['Delivery cart']], ['Preparation & Washing', ['Back to prep']]]);
    assert.deepEqual(plain(vm.groups.flatMap((g) => g.lines).map((L) => L.no)), [1, 2, 3, 4, 5], 'lines are numbered in the order shown; a section row has no number');
    assert.equal(html.split('CK-HP-4').length - 1, 2, 'the kc lines print their code');
    const [, , , , cust] = vm.groups.flatMap((g) => g.lines);
    assert.equal(cust.code, ''); assert.equal(vm.groups.flatMap((g) => g.lines).filter((L) => L.code).length, 2);
    assert.ok(html.includes('Option B') && html.includes('Preparation &amp; Washing'));
    assert.equal(/Option B[\s\S]{0,40}New item/.test(html), false, 'the placeholder name "New item" is never printed');
    // a header row is only that: an unnamed CUSTOM row with no price and no kc kind
    for (const row of [headerRow({ name: '' }), headerRow({ name: '  ' })]) assert.equal(view(quote({ items: [row] })).vm.groups[0].lines.length, 0);
    for (const row of [headerRow({ amount: 5 }), headerRow({ name: 'Real thing' }), headerRow({ kcKind: 'x' }), headerRow({ id: 'PW-1' })]) assert.equal(view(quote({ items: [row] })).vm.groups[0].lines.length, 1, JSON.stringify(row));
  });
  it('a kc line prints the stored text of its document (size, material and use, specs with their line breaks kept, includes / not included); a catalogue line the rows of QBSpecSheet (no size row, no duplicated notes or lead); notes and lead time once', () => {
    const { vm, html } = view(quote({ items: [kcLine(), catLine({ notes: 'Mind the leg height' })] }));
    const [kc, cat] = vm.groups.flatMap((g) => g.lines);
    assert.equal(kc.specText, 'Burners: 4\nIgnition: piezo'); assert.deepEqual(plain([kc.includes, kc.excludes]), [['gas hose', 'regulator'], ['gas line']]);
    assert.ok(html.includes('qa-specs qa-preline">Burners: 4\nIgnition: piezo<'), 'the line break is kept in the markup and shown by white-space: pre-line');
    assert.ok(html.includes('<strong>Includes:</strong> gas hose; regulator') && html.includes('<strong>Not included:</strong> gas line'));
    assert.ok(html.includes('Four-burner high-pressure range') && html.includes('SS304 · commercial') && html.includes('<span>Size</span> 1000 x 800 x 850'));
    assert.ok(html.includes('<strong>Notes:</strong>') && html.includes('Customer wants it by the door') && html.includes('<strong>Lead time:</strong> 25 working days'));
    assert.deepEqual(plain(cat.specRows), [{ label: 'Material', value: 'SS304' }, { label: 'Gauge', value: '1.2 mm' }, { label: 'Includes', value: 'Adjustable feet' }], 'the spec sheet rows, without the size row, the lead row or the notes');
    assert.equal(html.split('Mind the leg height').length - 1, 1, 'the notes of a catalogue line are printed once');
    assert.equal(cat.lead, '14-21 days', 'a legacy lead time is shown to the President even though the printed quotation leaves it off');
    for (const lead of ['', '—', '   ', undefined]) assert.equal(view(quote({ items: [catLine({ leadTime: lead })] })).vm.groups[0].lines[0].lead, '', JSON.stringify(lead));
  });
  it('the quantity, the unit price and the amount are on every line ("n unit × price = amount"); an amount that was not stored is price x quantity', () => {
    const { html } = view(quote({ items: [catLine({ amount: undefined })] }));
    assert.ok(html.includes('<span>3 pc</span> × <span>₱421.75</span> = <strong>₱1,265.25</strong>'));
  });
  it('flags on a line are visible to every viewer: no price yet, needs review (with its reasons), reviewed by, typed by hand, volume break', () => {
    const it_ = kcLine({ needsPrice: true, needsReview: true, reviewReasons: ['custom part', 'ventilation sizing'], priceBasis: 'manual', volumeBreakPct: 5 });
    const chips = view(quote({ items: [it_] }), { role: 'employee', uid: 'u-sales' }).vm.groups[0].lines[0].chips;
    assert.deepEqual(plain(chips), ['No price yet', 'Needs review: custom part, ventilation sizing', 'Price typed by hand', 'Volume break 5%']);
    assert.deepEqual(plain(view(quote({ items: [kcLine({ needsReview: true, reviewed: 'The President' })] })).vm.groups[0].lines[0].chips), ['Reviewed by The President'], 'reviewed: the review flag is not shown, who reviewed is');
    assert.deepEqual(plain(view(quote({ items: [kcLine({ needsReview: true, reviewed: true })] })).vm.groups[0].lines[0].chips), [], 'reviewed with no name: nothing to say');
  });
  it('a legacy quote (no editableState, no doc, no photos, lines with only name / qty / unit price / amount) renders, and its "View the quotation document" button is disabled with the reason', () => {
    const { vm, html } = view({ quoteNumber: 'OLD-1', clientName: 'Old Client', status: 'filed', approvalStatus: 'approved', total: 10, items: [{ name: 'Old thing', qty: 1, unitPrice: 10, amount: 10 }] });
    assert.equal(vm.hasDoc, false); assert.deepEqual(plain(vm.header.viewDoc), { enabled: false, title: 'This quote was filed before the builder kept an editable copy.' });
    assert.ok(/id="qa-view-doc" disabled title="This quote was filed before the builder kept an editable copy\."/.test(html));
    assert.ok(html.includes('Old thing') && html.includes('₱10.00')); assert.equal(html.includes('qa-specs'), false);
    for (const junk of [null, undefined, {}, { items: 'x', photos: 7, payment: 'p', options: 5 }, { items: [null, 5, 'x', []] }]) assert.doesNotThrow(() => QA.html(QA.viewModel(junk, junk === undefined ? undefined : baseCtx()), esc), JSON.stringify(junk));
    assert.doesNotThrow(() => QA.viewModel(quote(), undefined)); assert.doesNotThrow(() => QA.viewModel(quote(), { lib: {} }));
  });
  it('an options quote lists each option with its items and total and marks the basis of the total; a quote that is not in options mode has no table', () => {
    const q = quote({ optionsMode: true, options: [{ key: 'a', label: 'Option A', itemCount: 2, total: 100 }, { key: 'b', label: 'Option B', itemCount: 1, total: 200.5 }], optionsBasis: 'b' });
    const { vm, html } = view(q);
    assert.deepEqual(plain(vm.options.rows), [{ label: 'Option A', count: 2, total: '₱100.00', basis: false }, { label: 'Option B', count: 1, total: '₱200.50', basis: true }]);
    assert.equal(html.split('Basis of the total').length - 1, 1); assert.ok(/class="qa-opt-basis"><td>Option B <span class="qa-chip">Basis of the total/.test(html));
    assert.ok(html.includes('The client picks one option. The total below is the marked option.'));
    assert.equal(view(quote({ optionsMode: false, options: q.options })).html.includes('Basis of the total'), false);
    assert.equal(view(quote({ optionsMode: true, options: null })).vm.options, null);
  });
  it('the totals and terms: subtotal, discount with its percent, net, VAT labelled included, delivery and installation (free / included / method / notes), the grand total (the largest figure); payment, timeline, validity, warranty, remarks', () => {
    const { vm, html } = view(quote());
    assert.deepEqual(plain(vm.totals.map((t) => [t.label, t.value])), [['Subtotal', '₱3,833.50'], ['Discount (5%)', '−₱191.68'], ['Net', '₱3,641.82'], ['VAT (included in the total)', '₱390.19'], ['Delivery and installation', '₱50.50']]);
    assert.equal(vm.totals[4].note, 'Included in the total · Own truck · Ground floor'); assert.equal(vm.grand, '₱3,641.82');
    assert.ok(html.includes('<div class="qa-grand"><span>Grand total</span><strong>₱3,641.82</strong>'));
    assert.deepEqual(plain(vm.terms.payment), [{ label: 'Down payment (50%)', value: '₱1,820.91' }, { label: 'Balance (lump)', value: '₱1,820.91' }]);
    assert.deepEqual(plain(vm.terms.timeline), [{ label: 'Start', value: '2026-12-10' }, { label: 'Lead time', value: '25 days' }, { label: 'Completion', value: '2027-01-04' }]);
    assert.equal(vm.terms.warranty, '12-month service warranty'); assert.equal(vm.terms.validUntil, '2026-12-05'); assert.equal(vm.terms.remarks, 'Remark line');
    const bare = view(quote({ discountAmount: 0, vatAmount: 0, deliveryInstall: { amount: 0, free: false }, payment: { milestones: [{ pct: 40, label: 'Down payment', date: '2026-12-01', amount: 100 }, { pct: 60, label: 'Balance', date: '', amount: 150 }] }, editableState: { pricing: { warrantyPlan: 'kitchenshield12' } }, timeline: {}, remarks: '', validUntil: '', grandTotal: 0, total: 77 }));
    assert.deepEqual(plain(bare.vm.totals.map((t) => t.label)), ['Subtotal'], 'no discount, VAT or delivery rows when there is nothing in them');
    assert.deepEqual(plain(bare.vm.terms.payment), [{ label: '40% — Down payment (2026-12-01)', value: '₱100.00' }, { label: '60% — Balance', value: '₱150.00' }]);
    assert.equal(bare.vm.terms.warranty, '12-month service warranty · KitchenShield PMS at a discount'); assert.equal(bare.vm.grand, '₱77.00', 'grandTotal, else total');
    assert.equal(view(quote({ editableState: { pricing: { warrantyPlan: '' } } })).vm.terms.warranty, '', 'a quote issued under the old terms prints no warranty row');
    assert.equal(view(quote({ deliveryInstall: { amount: 0, free: true } })).vm.totals.find((t) => /Delivery/.test(t.label)).value, 'Free');
    assert.equal(view(quote({ vatIncluded: false })).vm.totals.find((t) => /^VAT/.test(t.label)).label, 'VAT');
  });
});

describe('5c · who sees what, what each role can do, the banners, the thread, the reason', () => {
  const approved = { status: 'filed', approvalStatus: 'approved', approvedAt: { seconds: 1700000300 } };
  const returned = { status: 'needs_revision', approvalStatus: 'needs_revision', returnedAt: { seconds: 1700000300 }, presidentNotes: 'Make it two sinks' };
  const btns = (vm) => plain(vm.actions.buttons);
  const barIds = (html) => [...html.matchAll(/<button type="button" class="[^"]*qa-btn[^"]*" id="(qa-[a-z-]+)"/g)].map((m) => m[1]);

  it('actions by state and role: the President on a pending quote has Approve at my figures, Return with my figures, Approve, Return and Comment; on a decided one Comment only; the sender has Send reply (+ Revise in builder once it is returned); a manager has none', () => {
    const P = view(quote()); assert.deepEqual(btns(P.vm), ['approve', 'approveFig', 'returnFig', 'return', 'comment']); assert.deepEqual(barIds(P.html), ['qa-approve-fig', 'qa-return-fig', 'qa-approve', 'qa-return', 'qa-comment']);   // QUOTE-PRESIDENT-FIGURES-SPEC 6.1: his two own-figures buttons lead the bar
    assert.ok(P.html.includes('class="btn-success qa-btn" id="qa-approve"') && P.html.includes('class="btn-primary qa-btn" id="qa-return"') && P.html.includes('class="btn-secondary qa-btn" id="qa-comment">Comment<'));
    assert.equal(P.vm.actions.placeholder, 'Comment, or what to change before it can be approved');
    for (const over of [approved, returned, { status: 'filed', approvalStatus: 'filed' }]) { const D = view(quote(over)); assert.deepEqual(btns(D.vm), ['comment'], JSON.stringify(over)); assert.deepEqual(barIds(D.html), ['qa-comment']); }
    const S = view(quote(), { role: 'employee', uid: 'u-sales' });
    assert.deepEqual(btns(S.vm), ['comment']); assert.ok(S.html.includes('id="qa-comment">Send reply<')); assert.equal(S.vm.actions.placeholder, 'Reply to the President');
    assert.equal(S.html.includes('id="qa-approve"') || S.html.includes('id="qa-return"'), false, 'the sender never approves or returns');
    const R = view(quote(returned), { role: 'employee', uid: 'u-sales' });
    assert.deepEqual(btns(R.vm), ['comment', 'revise']); assert.ok(R.html.includes('id="qa-revise">Revise in builder<'));
    assert.deepEqual(btns(view(quote(returned, ), { role: 'employee', uid: 'u-sales' }).vm), ['comment', 'revise']);
    assert.deepEqual(btns(view(Object.assign(quote(returned), { editableState: null }), { role: 'employee', uid: 'u-sales' }).vm), ['comment'], 'no editable copy: nothing to revise in the builder');
    for (const role of ['manager', 'secretary', 'finance']) {
      const M = view(quote(), { role, uid: 'u-boss' });
      assert.deepEqual(btns(M.vm), [], role); assert.equal(M.html.includes('qa-actionbar'), false); assert.equal(M.html.includes('id="qa-text"'), false, 'no compose box');
      assert.ok(M.html.includes('Only the President approves quotes.')); assert.equal(M.vm.header.viewDoc, null); assert.equal(M.html.includes('qa-view-doc'), false); assert.equal(M.html.includes('qa-copy-link'), false);
    }
    const other = view(quote({ createdBy: 'u-someone-else' }), { role: 'employee', uid: 'u-sales' });
    assert.deepEqual(btns(other.vm), []); assert.ok(other.html.includes('Only the President approves quotes.'), 'any other staff on a quote they did not send: read-only');
    assert.equal(view(quote({ createdBy: 'u-pres' }), { role: 'president', uid: 'u-pres' }).vm.isApprover, true, 'the President on his own quote is the approver');
    assert.deepEqual(btns(view(quote({ createdBy: 'u-boss' }), { role: 'manager', uid: 'u-boss' }).vm), ['comment'], 'a manager who SENT the quote is its sender: he may reply');
  });
  it('the sticky action bar and the compose box: the textarea has the 2000 limit and a counter and an error line; it exists only when a button needs text', () => {
    const { html } = view(quote());
    assert.ok(html.includes('<textarea id="qa-text" rows="3" maxlength="2000"') && html.includes('id="qa-err"') && html.includes('id="qa-count"'));
    assert.ok(html.indexOf('qa-actionbar') > html.indexOf('id="qa-text"'), 'the bar is the last thing on the page');
    assert.equal(view(quote(approved), { commentsOff: true }).html.includes('id="qa-text"'), false);
  });
  it('comments not available (rules not deployed): the thread says so and the Comment / Send reply button is hidden, but Approve and Return stay (a Return still needs its text)', () => {
    const P = view(quote(), { commentsOff: true });
    assert.deepEqual(btns(P.vm), ['approve', 'return']); assert.ok(P.html.includes('Comments are not available yet.')); assert.ok(P.html.includes('id="qa-text"'), 'the box stays: it holds the Return note');
    assert.deepEqual(btns(view(quote(approved), { commentsOff: true }).vm), [], 'nothing left to do on a decided quote');
    assert.deepEqual(btns(view(quote(), { role: 'employee', uid: 'u-sales', commentsOff: true }).vm), []);
    assert.deepEqual(btns(view(quote(returned), { role: 'employee', uid: 'u-sales', commentsOff: true }).vm), ['revise']);
  });
  it('banners, in order: offline, newer revision (only when one is given, with the button that opens it), the state, and the read-only notice', () => {
    const b = (q, c) => plain(view(q, c).vm.banners.map((x) => x.kind));
    assert.deepEqual(b(quote(), { offline: true, newer: { ref: 'bk.' + NEW_ID, number: 'BKZZTEST261120-007R2' }, role: 'manager', uid: 'u-boss' }), ['offline', 'newer', 'readonly']);
    assert.deepEqual(b(quote(returned), { offline: true, newer: { ref: 'bk.' + NEW_ID, number: 'R2' } }), ['offline', 'newer', 'state']);
    assert.deepEqual(b(quote()), [], 'a pending quote of its own: no banner at all');
    const n = view(quote(returned), { newer: { ref: 'bk.' + NEW_ID, number: 'BKZZTEST261120-007R2' } });
    assert.ok(n.html.includes('A newer revision, BKZZTEST261120-007R2, was sent for approval.') && n.html.includes(`id="qa-open-newer" data-ref="bk.${NEW_ID}">Open it<`));
    for (const c of [{}, { newer: null }, { newer: {} }, { newer: { number: 'x' } }]) assert.equal(view(quote(returned), c).html.includes('A newer revision'), false, JSON.stringify(c));
    assert.ok(view(quote(), { offline: true }).html.includes('You are offline. Showing the last saved copy.'));
    assert.equal(view(quote()).html.includes('You are offline'), false);
    const st = (over, c) => view(quote(over), c).vm.banners.find((x) => x.kind === 'state');
    assert.match(st(approved).text, /^Approved by the President on .+\.$/);
    assert.match(st(approved, { comments: [{ kind: 'approved', authorName: 'Ana Reyes', quoteId: BK }] }).text, /^Approved by Ana Reyes on /, 'the approver\'s name comes from the thread');
    assert.match(st(returned).text, /^Returned on .+\. Waiting for Sales to revise\.$/);
    assert.equal(st({ status: 'filed', approvalStatus: 'filed' }).text, 'This quote is not waiting for approval.');
    assert.equal(st({ status: 'draft', approvalStatus: undefined }).text, 'This quote is not waiting for approval.');
  });
  it('the header: the number, a status badge (pending / approved / returned / filed), who sent it and when, the revision and "edited by the President" chips, the two buttons', () => {
    const { vm, html } = view(quote({ parentQuoteId: ROOT_ID, editedByPresident: true }), { parent: { number: 'BKZZTEST261120-007' }, companyLabel: 'Barro Kitchens' });
    assert.equal(vm.header.number, 'BKZZTEST261120-007R1'); assert.deepEqual(plain(vm.header.badge), { label: 'Pending approval', cls: 'badge-orange' });
    assert.deepEqual(plain(vm.header.chips), ['Revision of BKZZTEST261120-007', 'Edited by the President']);
    assert.equal(vm.header.sentBy, 'Sales Tester'); assert.ok(vm.header.sentOn.length > 5); assert.equal(vm.header.company, 'Barro Kitchens');
    for (const must of ['id="qa-view-doc">View the quotation document<', 'id="qa-copy-link">Copy approval link<', 'Mira Santos', 'Santos Test Kitchen', 'Pasig', 'Test kitchen package']) assert.ok(html.includes(must), must);
    assert.equal(view(quote({ parentQuoteId: ROOT_ID }), {}).vm.header.chips.length, 0, 'no sibling matched: no revision chip');
    assert.deepEqual(plain(view(quote(approved)).vm.header.badge), { label: 'Approved', cls: 'badge-green' });
    assert.deepEqual(plain(view(quote(returned)).vm.header.badge), { label: 'Returned', cls: 'badge-orange' });
    assert.deepEqual(plain(view(quote({ status: 'filed', approvalStatus: 'filed' })).vm.header.badge), { label: 'Filed', cls: 'badge-blue' });
    assert.equal(view(quote({ agentName: '', createdByName: 'Maker', salesperson: 'S' })).vm.header.sentBy, 'Maker');
    // the number rule of the Quotes list: the company code is prefixed only when the number lacks it
    assert.equal(view(quote({ quoteNumber: 'LUFB261119-003', company: 'BK' })).vm.number, 'BK-LUFB261119-003'); assert.equal(view(quote({ quoteNumber: '', company: 'BS' }), { id: 'abcdEFGH123456' }).vm.number, 'BS-123456');
  });
  it('the reason: from approvalWhy in words (codes in order, "The preparer asked for approval" when only ticked, then the builder\'s sentence); an old quote has it derived, for the President only; nothing derivable omits the card', () => {
    const w = (why, c, q) => view(quote(Object.assign({ approvalWhy: why }, q || {})), c).vm.why;
    assert.deepEqual(plain(w({ reasons: ['review', 'below-standard', 'approve-all'], text: 'Because.', ticked: false })), { bullets: ['A line needs review', 'The quote sells below its standard price', 'Every quote goes to the President for approval'], text: 'Because.' });
    assert.deepEqual(plain(w({ reasons: [], text: '', ticked: true })), { bullets: ['The preparer asked for approval'], text: '' });
    assert.equal(w({ reasons: [], text: '', ticked: false }), null, 'nothing to say: no card');
    assert.equal(w({ reasons: ['review'], text: '', ticked: true }).bullets.includes('The preparer asked for approval'), false, 'a reason code replaces the tick wording');
    assert.deepEqual(plain(w({ reasons: ['bogus'], text: '', ticked: false })), null);
    const emp = (why) => w(why, { role: 'employee', uid: 'u-sales', sidecar: SIDECAR({ kcSummary: KCSUM({ net: 800 }) }) });
    assert.deepEqual(plain(emp({ reasons: ['review'], text: 'x', ticked: false }).bullets), ['A line needs review'], 'the sender saw the same sentence in the builder: he sees it here');
    const html = view(quote({ approvalWhy: { reasons: ['review'], text: 'x', ticked: false } }), { role: 'employee', uid: 'u-sales' }).html;
    assert.ok(html.includes('Why this needs approval') && html.includes('A line needs review'));
    // a quote sent before the reason was stored
    assert.deepEqual(plain(w(undefined, { sidecar: SIDECAR({ kcSummary: KCSUM({ net: 800, standardTotal: 900 }) }) }, { items: [kcLine({ needsReview: true })] }).bullets), ['Below its standard price', 'A line needs review']);
    assert.equal(w(undefined, { sidecar: SIDECAR({ kcSummary: KCSUM({ net: 1000, standardTotal: 900 }) }) }), null);
    assert.equal(w(undefined, { role: 'employee', uid: 'u-sales', sidecar: SIDECAR({ kcSummary: KCSUM({ net: 800 }) }) }, { items: [kcLine({ needsReview: true })] }), null, 'nothing is derived for the sender (the cost record is the President\'s)');
    assert.equal(view(quote(), {}).html.includes('Why this needs approval'), false);
  });
  it('the thread: oldest first with author, role chip, kind chip, relative time (absolute in the title), the revision tag only when the entry is from another revision, the text pre-wrapped; empty says so', () => {
    const entries = [
      { kind: 'submitted', authorName: 'Sales Tester', authorRole: 'sales', quoteId: BK, quoteNumber: 'BKZZTEST261120-007R1', text: 'A line needs review.', createdAt: { seconds: 1700000100 } },
      { kind: 'returned', authorName: 'The President', authorRole: 'president', quoteId: 'qdOLDER', quoteNumber: 'BKZZTEST261120-007', text: 'Two sinks.\nNot one.', createdAt: { seconds: 1700000200 } },
      { kind: 'comment', authorName: '', authorRole: 'sales', quoteId: BK, quoteNumber: 'BKZZTEST261120-007R1', text: 'Done.', createdAt: { seconds: 1700000300 } },
    ];
    const th = QA.thread(quote(), entries, { id: BK, now: 1700000500000 });
    assert.deepEqual(plain(th.items.map((t) => [t.who, t.role, t.kind, t.rev, t.rel])), [['Sales Tester', 'Sales', 'Sent for approval', '', '6m ago'], ['The President', 'President', 'Returned', 'BKZZTEST261120-007', '5m ago'], ['Sales', 'Sales', '', '', '3m ago']]);
    const html = QA.threadHtml(th, esc);
    assert.equal((html.match(/qa-chip-rev/g) || []).length, 1, 'only the entry of another revision carries a tag');
    assert.ok(html.includes('class="qa-entry-text">Two sinks.\nNot one.</div>') && html.includes('qa-entry qa-entry-pres'));
    assert.ok(/class="qa-entry-time" title="[^"]+">6m ago</.test(html));
    assert.equal(QA.threadHtml(QA.thread(quote(), [], { id: BK }), esc), '<div class="qa-thread-note">No comments yet.</div>');
    assert.equal(QA.threadHtml(QA.thread(quote(), [], { id: BK, commentsOff: true }), esc), '<div class="qa-thread-note">Comments are not available yet.</div>');
    assert.equal(QA.thread(quote(), [{ kind: 'comment', text: 'x' }, null, 'junk', 5], { id: BK }).items.length, 1, 'junk entries are skipped');
    assert.equal(QA.thread(quote(), [{ kind: 'comment', authorRole: 'sales', text: 'old', createdAt: { seconds: 1 } }], { id: BK, now: 1700000500000 }).items[0].rel.length > 0, true, 'an old entry shows its date');
  });
  it('the President\'s note on a quote that predates the thread is shown once as his first entry (view-only); it is not repeated when a "returned" / "approved" entry of this quote already carries the same text', () => {
    const count = (html) => html.split('Two sinks.').length - 1;
    const base = quote(Object.assign({}, returned, { presidentNotes: 'Two sinks.' }));
    const alone = view(base, { comments: [] }); assert.equal(count(alone.html), 1);
    assert.deepEqual(plain(alone.vm.thread.items.map((t) => [t.who, t.role, t.kind, t.text, t.synthetic])), [['The President', 'President', 'Returned', 'Two sinks.', true]]);
    const dup = view(base, { comments: [{ kind: 'returned', authorName: 'The President', authorRole: 'president', quoteId: BK, text: 'Two sinks.', createdAt: { seconds: 1700000250 } }] }); assert.equal(count(dup.html), 1, 'not twice');
    assert.equal(dup.vm.thread.items.some((t) => t.synthetic), false);
    const other = view(base, { comments: [{ kind: 'returned', authorName: 'The President', authorRole: 'president', quoteId: BK, text: 'Something else.', createdAt: { seconds: 1700000250 } }] }); assert.equal(count(other.html), 1); assert.ok(other.html.includes('Something else.'), 'a different text: both');
    const elsewhere = view(base, { comments: [{ kind: 'returned', authorName: 'The President', authorRole: 'president', quoteId: 'qdOLDER', text: 'Two sinks.', createdAt: { seconds: 1700000250 } }] }); assert.equal(count(elsewhere.html), 2, 'the same words on ANOTHER revision do not hide this quote\'s own note');
    const appr = view(quote(Object.assign({}, approved, { presidentNotes: 'Looks fine.' })), { comments: [] }); assert.equal(appr.vm.thread.items[0].kind, 'Approved');
    assert.equal(view(quote(), { comments: [] }).vm.thread.items.length, 0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// the page's DOM half (renderQuoteApproval + its buttons) against a small stand-in DOM: elements exist when the markup that was painted names their id
function makePage(opts) {
  opts = opts || {};
  const D = makeDb(opts);
  const decisions = [], toasts = [], notifs = [], confirms = [], navs = [], builderCalls = [], links = [], docHandlers = {}, bodyAppends = [];
  let painted = '', focused = null;
  const nodes = {};
  const datasetOf = (sel) => { const tag = (painted.match(new RegExp('<[^>]*id="' + sel.slice(1) + '"[^>]*>')) || [''])[0]; const d = {}; for (const m of tag.matchAll(/data-([a-z-]+)="([^"]*)"/g)) d[m[1].replace(/-([a-z])/g, (x, c) => c.toUpperCase())] = m[2].replace(/&amp;/g, '&'); return d; };
  const mkNode = (sel) => ({ sel, handlers: {}, value: '', textContent: '', dataset: datasetOf(sel), disabled: false, focus() { focused = sel; }, addEventListener(t, f) { this.handlers[t] = f; }, click() { return this.handlers.click && this.handlers.click({ currentTarget: this }); } });
  const has = (sel) => (/^#[\w-]+$/.test(sel) ? painted.includes('id="' + sel.slice(1) + '"') : (sel === '.qa-page' ? painted.includes('class="qa-page"') : false));
  const thumbs = [];
  const page = {
    set innerHTML(v) { painted = String(v); for (const k of Object.keys(nodes)) delete nodes[k]; thumbs.length = 0; for (const m of painted.matchAll(/<button type="button" class="qa-thumb" data-set="([^"]*)" data-i="(\d+)"/g)) thumbs.push(Object.assign(mkNode('.qa-thumb'), { dataset: { set: m[1], i: m[2] } })); },
    get innerHTML() { return painted; },
    querySelector: (sel) => (has(sel) ? (nodes[sel] = nodes[sel] || mkNode(sel)) : null), querySelectorAll: (sel) => (sel === '.qa-thumb[data-set]' ? thumbs : []),
  };
  // elements the photo viewer creates: just enough surface for its code (children are found by selector and made on demand)
  const overlay = [], keyHandlers = [];
  const mkEl = () => { const kids = {}, cls = new Set(); const el = { children: kids, handlers: {}, textContent: '', src: '', className: '', removed: false, attrs: {},
    classList: { add: (c) => cls.add(c), contains: (c) => cls.has(c) }, setAttribute(k, v) { el.attrs[k] = v; }, remove() { el.removed = true; }, addEventListener(t, f) { el.handlers[t] = f; },
    querySelector: (sel) => (kids[sel] = kids[sel] || mkEl()), set innerHTML(v) { el.html = v; }, get innerHTML() { return el.html || ''; } }; return el; };
  const threadBox = { innerHTML: '' };
  // QUOTE-PRESIDENT-FIGURES-SPEC 2.2: the hidden engine frame the page creates inside #page-content, the messages it exchanges with it, the timers that bound its answers, and sessionStorage for the boxes
  const frames = [], posted = [], msgHandlers = [], timers = [], audits = [], session = Object.assign({}, opts.session || {});
  const mkFrame = () => { const f = { id: '', src: '', attrs: {}, isConnected: true, setAttribute(k, v) { f.attrs[k] = v; }, remove() { f.isConnected = false; }, contentWindow: { postMessage: (m, o) => posted.push({ m: plain(m), o }) } }; return f; };
  page.appendChild = (n) => { frames.push(n); return n; };
  const win = {
    QUOTE_COLLECTIONS: ['bk_quotes', 'bs_quotes'], currentPage: 'quote-approval',
    renderEmptyState: (o) => `<div class="empty-state"><h4>${o.title}</h4>${o.hint ? `<p>${o.hint}</p>` : ''}${o.action ? `<button id="${o.action.id}">${o.action.label}</button>` : ''}</div>`,
    skeletonHtml: () => '<div class="skl-wrap"></div>', navToken: () => 1, navStale: () => !!opts.stale,
    quoteCompanyLabel: (c) => ({ BK: 'Barro Kitchens', BI: 'Barro Industries', BS: 'Brilliance Steel' })[c] || 'Brilliance Steel',
    decideQuoteApproval: async (o) => { decisions.push(plain(o)); return opts.decide || { ok: true }; },
    confirmDialog: async (o) => { confirms.push(o.message); return opts.confirm !== false; }, busy: (btn, fn) => fn(),
    showQuoteApprovalLink: (i) => links.push(plain(i)), reopenQuoteFromDoc: (...a) => builderCalls.push(['reopen', ...a]), openQuoteInBuilderReview: (...a) => builderCalls.push(['review', a[0], a[1]]),
    quoteBuilderPageFor: (co) => (co === 'BS' ? 'bs-quote-builder' : 'bk-quote-builder'),
    Overlay: { push: (kind, teardown, el) => overlay.push({ kind, teardown, el }), dismissTop: () => { const o = overlay.pop(); if (o) o.teardown(); } },
    APP_VERSION: '9.9.9', logAudit: (...a) => audits.push(plain(a)),
    addEventListener: (t, f) => { if (t === 'message') msgHandlers.push(f); }, removeEventListener: (t, f) => { const i = msgHandlers.indexOf(f); if (i >= 0) msgHandlers.splice(i, 1); },
    qbStateForDoc: async (coll, id, q) => (opts.noState ? null : Object.assign({}, q.editableState, { sourceDocId: id, sourceCollection: coll })),
    location: { origin: ORIGIN },
  };
  const online = { v: opts.offline ? false : true };
  const ctx = vm.createContext({
    window: win, db: D.db, firebase: { firestore: { FieldValue: FV } }, console: { log() {}, warn() {}, error() {} }, URL, Date, Intl,
    currentUser: { uid: opts.uid || 'u-pres', email: 'x@example.test' }, currentRole: opts.role || 'president', userProfile: { displayName: opts.name || 'The President' },
    navigateTo: (p, o) => navs.push([p, plain(o)]), lucide: undefined, location: { origin: ORIGIN },
    sessionStorage: { getItem: (k) => (k in session ? session[k] : null), setItem: (k, v) => { session[k] = String(v); }, removeItem: (k) => { delete session[k]; } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    navigator: { get onLine() { return online.v; } },
    document: { getElementById: (id) => (id === 'page-content' ? page : id === 'qa-thread-list' ? threadBox : null), addEventListener: (t, f) => { docHandlers[t] = f; if (t === 'keydown') keyHandlers.push(f); }, removeEventListener: (t, f) => { const i = keyHandlers.indexOf(f); if (i >= 0) keyHandlers.splice(i, 1); }, visibilityState: 'visible',
      createElement: (tag) => (tag === 'iframe' ? mkFrame() : mkEl()), body: { appendChild: (n) => bodyAppends.push(n) } },
    Notifs: { showToast: (m, t) => toasts.push({ m, t }), success: (m) => toasts.push({ m, t: 'success' }), error: (m) => toasts.push({ m, t: 'error' }),
      send: async (uid, n) => { D.ops.push('notify'); notifs.push({ kind: 'send', uid, n: plain(n) }); }, sendToOwner: async (n) => { D.ops.push('notify owner'); notifs.push({ kind: 'owner', n: plain(n) }); } },
  });
  vm.runInContext('globalThis.window = window;', ctx);
  vm.runInContext(ESC_SRC, ctx);
  win.escHtml = ctx.escHtml;
  vm.runInContext(read('js/forms-core.js'), ctx); vm.runInContext(read('js/qb-spec-sheet.js'), ctx);
  vm.runInContext(read('js/price-gate-core.js'), ctx); vm.runInContext(read('js/quote-figures-core.js'), ctx);
  vm.runInContext(piece(SVC, /^window\.QuoteThread = \{[\s\S]*?\n\};/m, 'window.QuoteThread'), ctx);
  vm.runInContext(cfgPiece('quoteApprovalRefOf') + '\n' + cfgPiece('parseQuoteApprovalRef'), ctx);
  vm.runInContext(PAGE, ctx);
  const api = Object.assign(D, { frames, posted, msgHandlers, timers, audits, session, mkFrame, win, ctx, page, threadBox, decisions, toasts, notifs, confirms, navs, builderCalls, links, docHandlers, online, overlay, keyHandlers, bodyAppends, thumbs, node: (sel) => page.querySelector(sel),
    render: (ref) => win.renderQuoteApproval(ref === undefined ? 'bk.' + BK : ref) });
  Object.defineProperty(api, 'painted', { get: () => painted });     // live views (Object.assign would copy a getter's value once)
  Object.defineProperty(api, 'focused', { get: () => focused });
  return api;
}
const pageDocs = (over, extra) => Object.assign({ ['bk_quotes/' + BK]: quote(over) }, extra || {});

describe('6 · the page (renderQuoteApproval): what it reads, what it says when it cannot show the quote, what its buttons do', () => {
  it('a link that is not valid says so and offers Go to Approvals — and reads NOTHING from Firestore', async () => {
    for (const ref of ['xx', 'bk.', 'bk.draft_u1abcdef', 'bk.a<b>cdefg', null, '', 'bk.' + BK + '.extra']) {
      const P = makePage({ docs: pageDocs() }); await P.render(ref);
      assert.ok(P.painted.includes('This approval link is not valid.'), String(ref)); assert.deepEqual(P.ops, [], String(ref));
      await P.node('#qa-empty-btn').click(); assert.deepEqual(P.navs, [['approvals', undefined]]);
    }
  });
  it('a quote the viewer may not read: "You do not have access to this quote" with Go to dashboard; a deleted quote: "no longer exists" with Go to Approvals; a failed read: "could not be loaded" with Retry that reads again — and the raw error is never printed', async () => {
    const denied = makePage({ role: 'employee', uid: 'u-x', getErrors: { ['bk_quotes/' + BK]: Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }) } });
    await denied.render(); assert.ok(denied.painted.includes('You do not have access to this quote.') && denied.painted.includes('Ask the person who made it, or the President.'));
    await denied.node('#qa-empty-btn').click(); assert.deepEqual(denied.navs, [['dashboard', undefined]]);
    const gone = makePage({ docs: {} }); await gone.render(); assert.ok(gone.painted.includes('This quote no longer exists.')); await gone.node('#qa-empty-btn').click(); assert.deepEqual(gone.navs, [['approvals', undefined]]);
    const err = makePage({ getErrors: { ['bk_quotes/' + BK]: Object.assign(new Error('Secret backend text 503'), { code: 'unavailable' }) } });
    await err.render(); assert.ok(err.painted.includes('This quote could not be loaded.') && err.painted.includes('Check your connection and try again.') && err.painted.includes('>Retry<'));
    assert.equal(/Secret backend|503/.test(err.painted), false);
    err.ctx.db = makeDb({ docs: pageDocs() }).db;   // the network is back: Retry reads again
    await err.node('#qa-empty-btn').click(); await new Promise((r) => setImmediate(r));
    assert.ok(err.painted.includes('Mira Santos'), 'the retry painted the quote');
  });
  it('the cost sidecar is read for the President ONLY (and only quote_costs/<coll>_<id>); everyone else never even asks for it', async () => {
    const docs = pageDocs({}, { ['quote_costs/bk_quotes_' + BK]: SIDECAR({ kcSummary: KCSUM() }) });
    const P = makePage({ docs }); await P.render();
    assert.ok(P.ops.includes('get quote_costs/bk_quotes_' + BK)); assert.ok(P.painted.includes('Cost and margin') && P.painted.includes('Unit cost'));
    for (const role of ['employee', 'manager', 'secretary', 'finance', 'agent']) {
      const S = makePage({ docs, role, uid: role === 'manager' ? 'u-boss' : 'u-sales' }); await S.render();
      assert.equal(S.ops.some((o) => /quote_costs/.test(o)), false, role + ' read the cost sidecar');
      assert.equal(S.painted.includes('Cost and margin') || S.painted.includes('Unit cost') || S.painted.includes('Commission'), false, role);
    }
    const N = makePage({ docs: pageDocs() }); await N.render(); assert.ok(N.painted.includes('No cost record was saved with this quote.'));
    const F = makePage({ docs: pageDocs(), getErrors: { ['quote_costs/bk_quotes_' + BK]: Object.assign(new Error('x'), { code: 'permission-denied' }) } }); await F.render();
    assert.ok(F.painted.includes('Mira Santos'), 'a sidecar that cannot be read never blocks the page');
  });
  it('the thread and the revisions are read for what the viewer may see: the President the whole chain; Sales his own (submitterUid and createdBy filters); each failure leaves its part empty, never the page', async () => {
    const rows = { quote_comments: [{ id: 'c1', threadKey: 'bk_quotes_' + ROOT_ID, submitterUid: 'u-sales', kind: 'comment', authorRole: 'president', authorName: 'The President', text: 'Please add a shelf.', quoteId: BK, createdAt: { seconds: 1700000200 } }],
      bk_quotes: [{ id: NEW_ID, rootQuoteId: ROOT_ID, createdBy: 'u-sales', createdAt: { seconds: 1700009999 }, quoteNumber: 'BKZZTEST261120-007R2', status: 'pending_approval' }, { id: BK, rootQuoteId: ROOT_ID, createdBy: 'u-sales', createdAt: { seconds: 1700000000 }, quoteNumber: 'BKZZTEST261120-007R1' }] };
    const P = makePage({ docs: pageDocs(), rows }); await P.render();
    assert.deepEqual(plain(P.queries.map((q) => q.coll + ':' + q.filters.map((f) => f[0]).join('+'))), ['quote_comments:threadKey', 'bk_quotes:rootQuoteId']);
    assert.ok(P.painted.includes('Please add a shelf.'));
    assert.ok(P.painted.includes('A newer revision, BKZZTEST261120-007R2, was sent for approval.') && P.painted.includes(`data-ref="bk.${NEW_ID}"`));
    await P.node('#qa-open-newer').click(); assert.deepEqual(P.navs, [['quote-approval', { subtab: 'bk.' + NEW_ID }]]);
    const S = makePage({ docs: pageDocs(), rows, role: 'employee', uid: 'u-sales' }); await S.render();
    assert.deepEqual(plain(S.queries.map((q) => q.coll + ':' + q.filters.map((f) => f[0]).join('+'))), ['quote_comments:threadKey+submitterUid', 'bk_quotes:rootQuoteId+createdBy']);
    assert.ok(S.queries.every((q) => q.filters.length === 2 && q.filters[1][2] === 'u-sales'));
    // the newer one must be created LATER, not be a draft, and not be this doc
    const D = makePage({ docs: pageDocs(), rows: { bk_quotes: [{ id: NEW_ID, rootQuoteId: ROOT_ID, createdAt: { seconds: 1700009999 }, quoteNumber: 'DRAFT', status: 'draft' }, { id: 'qdEARLIER00000000003', rootQuoteId: ROOT_ID, createdAt: { seconds: 1600000000 }, quoteNumber: 'OLD' }] } }); await D.render();
    assert.equal(D.painted.includes('A newer revision'), false);
    // a thread that is refused: "Comments are not available yet." and no Comment button; a revisions query that fails: no banner, the page is there
    const T = makePage({ docs: pageDocs(), listFails: true }); await T.render();
    assert.ok(T.painted.includes('Comments are not available yet.') && T.painted.includes('Mira Santos')); assert.equal(T.painted.includes('id="qa-comment"'), false); assert.ok(T.painted.includes('id="qa-approve"'));
  });
  it('a quote that is gone stale mid-read (the user already navigated away) paints nothing', async () => {
    const P = makePage({ docs: pageDocs(), stale: true }); await P.render(); assert.equal(P.painted.includes('Mira Santos'), false);
  });
  it('offline: the page opens from the saved copy with its banner, and every button refuses with the offline toast and writes nothing', async () => {
    const P = makePage({ docs: pageDocs(), offline: true }); await P.render();
    assert.ok(P.painted.includes('You are offline. Showing the last saved copy.'));
    P.node('#qa-text').value = 'something';
    for (const id of ['#qa-approve', '#qa-return', '#qa-comment']) await P.node(id).click();
    assert.equal(P.toasts.filter((t) => /You are offline\. Connect to approve or return a quote\./.test(t.m)).length, 3);
    assert.deepEqual(P.decisions, []); assert.equal(P.adds.length, 0); assert.deepEqual(P.confirms, [], 'no confirm dialog for a refused action');
  });
  it('Return needs text: empty -> the inline line "Write what to change before you return it." and the box gets the focus — no dialog, no write; with text -> the decision, then the page reloads', async () => {
    const P = makePage({ docs: pageDocs() }); await P.render();
    await P.node('#qa-return').click();
    assert.equal(P.node('#qa-err').textContent, 'Write what to change before you return it.'); assert.equal(P.focused, '#qa-text');
    assert.deepEqual(P.decisions, []); assert.deepEqual(P.confirms, []); assert.equal(P.adds.length, 0);
    P.node('#qa-text').value = '   '; await P.node('#qa-return').click(); assert.deepEqual(P.decisions, [], 'blanks are not text');
    P.node('#qa-text').value = '  Make it two sinks.  ';
    const reads = P.ops.filter((o) => o === 'get bk_quotes/' + BK).length;
    await P.node('#qa-return').click();
    assert.deepEqual(P.decisions, [{ coll: 'bk_quotes', quoteId: BK, agentId: 'u-sales', quoteNumber: 'BKZZTEST261120-007R1', clientName: 'Mira Santos', action: 'return', notes: 'Make it two sinks.' }]);
    await new Promise((r) => setImmediate(r));
    assert.equal(P.ops.filter((o) => o === 'get bk_quotes/' + BK).length, reads + 1, 'after the decision the page reads the quote again');
    assert.deepEqual(P.confirms, [], 'Return has no confirm dialog');
  });
  it('Approve asks first ("Approve <number> for <client>? It will be filed and Sales will be told."); a "no" does nothing; a "yes" takes the decision with the box as its note and reloads; a refused decision that says "state" also reloads (to show who got there first)', async () => {
    const P = makePage({ docs: pageDocs(), confirm: false }); await P.render();
    await P.node('#qa-approve').click();
    assert.deepEqual(P.confirms, ['Approve BKZZTEST261120-007R1 for Mira Santos? It will be filed and Sales will be told.']); assert.deepEqual(P.decisions, []);
    const Y = makePage({ docs: pageDocs() }); await Y.render(); Y.node('#qa-text').value = 'Good to go.'; await Y.node('#qa-approve').click();
    assert.deepEqual(Y.decisions.map((d) => [d.action, d.notes, d.quoteId, d.coll, d.agentId]), [['approve', 'Good to go.', BK, 'bk_quotes', 'u-sales']]);
    const E = makePage({ docs: pageDocs() }); await E.render(); await E.node('#qa-approve').click(); assert.equal(E.decisions[0].notes, '', 'an approval needs no note');
    for (const [decide, reloads] of [[{ ok: false, reason: 'state' }, 1], [{ ok: false, reason: 'busy' }, 0], [{ ok: false, reason: 'error' }, 0], [{ ok: false, reason: 'offline' }, 0], [{ ok: true }, 1]]) {
      const R = makePage({ docs: pageDocs(), decide }); await R.render(); const n0 = R.ops.filter((o) => o === 'get bk_quotes/' + BK).length;
      await R.node('#qa-approve').click(); await new Promise((r) => setImmediate(r));
      assert.equal(R.ops.filter((o) => o === 'get bk_quotes/' + BK).length - n0, reloads, JSON.stringify(decide));
    }
  });
  it('Comment needs text ("Write a comment first."); the President\'s comment is saved to the thread (kind comment, his role), the quote\'s SENDER is told with the page link, the box clears and the thread repaints; the text is KEPT when the save fails', async () => {
    const P = makePage({ docs: pageDocs() }); await P.render();
    await P.node('#qa-comment').click(); assert.equal(P.node('#qa-err').textContent, 'Write a comment first.'); assert.equal(P.focused, '#qa-text'); assert.equal(P.adds.length, 0);
    P.node('#qa-text').value = '  Please add a shelf.  ';
    await P.node('#qa-comment').click(); await new Promise((r) => setImmediate(r));
    const c = P.adds.filter((a) => a.coll === 'quote_comments');
    assert.equal(c.length, 1); assert.deepEqual([c[0].data.kind, c[0].data.text, c[0].data.authorRole, c[0].data.authorUid, c[0].data.submitterUid, c[0].data.threadKey], ['comment', 'Please add a shelf.', 'president', 'u-pres', 'u-sales', 'bk_quotes_' + ROOT_ID]);
    assert.equal(P.node('#qa-text').value, ''); assert.equal(P.node('#qa-count').textContent, '0/2000');
    assert.equal(P.notifs.length, 1);
    assert.deepEqual([P.notifs[0].kind, P.notifs[0].uid, P.notifs[0].n.type, P.notifs[0].n.link, P.notifs[0].n.title, P.notifs[0].n.icon], ['send', 'u-sales', 'quote_comment', 'quote-approval/bk.' + BK, '💬 The President commented on your quote', '💬']);
    assert.equal(P.notifs[0].n.body, '"BKZZTEST261120-007R1" for Mira Santos: Please add a shelf.');
    assert.ok(P.queries.length >= 3, 'the thread was read again (only the thread: no second read of the quote)');
    assert.equal(P.ops.filter((o) => o === 'get bk_quotes/' + BK).length, 1);
    const F = makePage({ docs: pageDocs(), failComments: true }); await F.render(); F.node('#qa-text').value = 'keep me';
    await F.node('#qa-comment').click();
    assert.ok(F.toasts.some((t) => t.t === 'error' && t.m === 'The comment was not saved. Try again.')); assert.equal(F.node('#qa-text').value, 'keep me'); assert.equal(F.notifs.length, 0, 'nobody is told of a comment that was not saved');
  });
  it('a comment is capped at 300 characters in the notification and a failed notification never loses the comment; the President commenting on his own quote tells nobody', async () => {
    const P = makePage({ docs: pageDocs() }); await P.render(); P.node('#qa-text').value = 'x'.repeat(1500); await P.node('#qa-comment').click();
    assert.equal(P.adds.filter((a) => a.coll === 'quote_comments')[0].data.text.length, 1500); assert.equal(P.notifs[0].n.body.length, '"BKZZTEST261120-007R1" for Mira Santos: '.length + 300);
    const own = makePage({ docs: pageDocs({ createdBy: 'u-pres' }) }); await own.render(); own.node('#qa-text').value = 'note to self'; await own.node('#qa-comment').click();
    assert.equal(own.adds.filter((a) => a.coll === 'quote_comments').length, 1); assert.equal(own.notifs.length, 0);
    const boom = makePage({ docs: pageDocs() }); await boom.render(); boom.ctx.Notifs.send = async () => { throw new Error('push down'); };
    boom.node('#qa-text').value = 'saved anyway'; await boom.node('#qa-comment').click();
    assert.equal(boom.adds.filter((a) => a.coll === 'quote_comments').length, 1); assert.equal(boom.toasts.some((t) => /not saved/.test(t.m)), false);
  });
  it('the sender\'s reply goes to the PRESIDENT (sendToOwner) with an explicit dedupKey per comment — so a second identical reply is not dropped — and the page link', async () => {
    const P = makePage({ docs: pageDocs(), role: 'employee', uid: 'u-sales', name: 'Sales Tester' }); await P.render();
    assert.deepEqual(plain(P.node('#qa-text') && ['has box']), ['has box']); assert.equal(P.node('#qa-approve'), null);
    P.node('#qa-text').value = 'Shelf added.'; await P.node('#qa-comment').click(); await new Promise((r) => setImmediate(r));
    const c = P.adds.filter((a) => a.coll === 'quote_comments')[0].data;
    assert.deepEqual([c.kind, c.authorRole, c.authorUid, c.submitterUid], ['comment', 'sales', 'u-sales', 'u-sales']);
    assert.equal(P.notifs.length, 1); const n = P.notifs[0];
    assert.equal(n.kind, 'owner'); assert.equal(n.n.link, 'quote-approval/bk.' + BK); assert.equal(n.n.type, 'quote_comment'); assert.equal(n.n.title, '💬 Reply on a quote awaiting your approval');
    assert.equal(n.n.body, 'Sales Tester on "BKZZTEST261120-007R1": Shelf added.');
    assert.equal(n.n.dedupKey, 'quote_comment|' + P.adds.filter((a) => a.coll === 'quote_comments')[0].id);
    P.node('#qa-text').value = 'Shelf added.'; await P.node('#qa-comment').click(); await new Promise((r) => setImmediate(r));
    assert.notEqual(P.notifs[1].n.dedupKey, n.n.dedupKey, 'the same words a second time get their own key');
  });
  it('View the quotation document: the President on a PENDING quote opens the builder in review mode; everyone else (and the President on a decided quote) opens a plain copy; no editable copy: nothing. Copy approval link and Revise in builder', async () => {
    const P = makePage({ docs: pageDocs() }); await P.render(); await P.node('#qa-view-doc').click();
    assert.deepEqual(P.builderCalls, [['review', 'bk_quotes', BK]]);
    const D = makePage({ docs: pageDocs({ status: 'filed', approvalStatus: 'approved' }) }); await D.render(); await D.node('#qa-view-doc').click();
    assert.deepEqual(D.builderCalls, [['reopen', 'bk_quotes', BK, 'bk-quote-builder']]);
    const S = makePage({ docs: pageDocs(), role: 'employee', uid: 'u-sales' }); await S.render(); await S.node('#qa-view-doc').click();
    assert.deepEqual(S.builderCalls, [['reopen', 'bk_quotes', BK, 'bk-quote-builder']]);
    const L = makePage({ docs: pageDocs({ editableState: null }) }); await L.render(); assert.ok(/id="qa-view-doc" disabled/.test(L.painted)); await L.node('#qa-view-doc').click(); assert.deepEqual(L.builderCalls, []);
    await P.node('#qa-copy-link').click(); assert.deepEqual(P.links, [{ coll: 'bk_quotes', id: BK, quoteNumber: 'BKZZTEST261120-007R1', clientName: 'Mira Santos' }]);
    const R = makePage({ docs: pageDocs({ status: 'needs_revision', approvalStatus: 'needs_revision', fileName: 'BKZZTEST261120-007R1 (2)' }), role: 'employee', uid: 'u-sales' }); await R.render();
    await R.node('#qa-revise').click(); assert.deepEqual(R.builderCalls, [['reopen', 'bk_quotes', BK, 'bk-quote-builder']]);
    await R.node('#qa-copy-link').click(); assert.equal(R.links[0].quoteNumber, 'BKZZTEST261120-007R1 (2)', 'the file name, as the first window showed it');
  });
  it('the photo viewer: a thumbnail opens ONE Overlay entry (Back and Escape close it) showing its set; previous / next wrap and keep the count and caption; one photo has no arrows; closing removes the element and the key handler', async () => {
    const photos = [{ url: STORAGE + 'a.jpg', caption: 'Front', itemIndex: 1 }, { url: STORAGE + 'b.jpg', caption: '', itemIndex: 1 }, { url: STORAGE + 'c.jpg', caption: 'Side', itemIndex: 1 }, { url: STORAGE + 'o.jpg', caption: 'Only', itemIndex: null }];
    const P = makePage({ docs: pageDocs({ photos }) }); await P.render();
    assert.deepEqual(P.thumbs.map((t) => [t.dataset.set, t.dataset.i]), [['1', '0'], ['other', '0']]);
    P.thumbs[0].click();
    assert.equal(P.overlay.length, 1); assert.equal(P.overlay[0].kind, 'lightbox'); assert.equal(P.bodyAppends.length, 1);
    const el = P.overlay[0].el, img = el.children['.qa-lightbox-img'], count = el.children['.qa-lightbox-count'], cap = el.children['.qa-lightbox-cap'];
    assert.equal(P.overlay[0].el, P.bodyAppends[0], 'the same element rides the Overlay entry (it gets its stacking order from it)');
    assert.deepEqual([img.src, count.textContent, cap.textContent, el.classList.contains('qa-lightbox-single')], [STORAGE + 'a.jpg', '1 / 3', 'Front', false]);
    const next = el.children['.qa-lightbox-next'], prev = el.children['.qa-lightbox-prev'];
    next.handlers.click(); assert.deepEqual([img.src, count.textContent, cap.textContent], [STORAGE + 'b.jpg', '2 / 3', '']);
    next.handlers.click(); next.handlers.click(); assert.deepEqual([img.src, count.textContent], [STORAGE + 'a.jpg', '1 / 3'], 'next wraps to the first');
    prev.handlers.click(); assert.deepEqual([img.src, count.textContent, cap.textContent], [STORAGE + 'c.jpg', '3 / 3', 'Side'], 'previous wraps to the last');
    P.keyHandlers[0]({ key: 'ArrowRight' }); assert.equal(img.src, STORAGE + 'a.jpg'); P.keyHandlers[0]({ key: 'ArrowLeft' }); assert.equal(img.src, STORAGE + 'c.jpg'); P.keyHandlers[0]({ key: 'Escape' }); assert.equal(img.src, STORAGE + 'c.jpg', 'Escape is the Overlay stack\'s, not this handler\'s');
    el.children['.qa-lightbox-close'].handlers.click(); assert.equal(P.overlay.length, 0, 'the close button dismisses through the Overlay (history), it does not remove the element itself');
    assert.equal(el.removed, true, 'the Overlay teardown removed it'); assert.equal(P.keyHandlers.length, 0, 'and its key handler');
    // the backdrop and the stage dismiss too; a lone photo has no arrows and no count
    P.thumbs[1].click(); const one = P.overlay[0].el;
    assert.equal(one.classList.contains('qa-lightbox-single'), true); assert.equal(one.children['.qa-lightbox-count'].textContent, ''); assert.equal(one.children['.qa-lightbox-cap'].textContent, 'Only');
    one.handlers.click({ target: one }); assert.equal(P.overlay.length, 0, 'a tap on the dark backdrop closes it');
    // a thumbnail whose set is empty opens nothing
    const E = makePage({ docs: pageDocs({ photos: [], items: [customLine()] }) }); await E.render(); assert.equal(E.thumbs.length, 0, 'no photo, no thumbnail button (only the placeholder icon)');
  });
  it('a Brilliant Steel link (bs.<id>) reads bs_quotes and its own cost record; the builder page is the Brilliant Steel one', async () => {
    const P = makePage({ docs: { ['bs_quotes/' + BK]: quote({ company: 'BS' }), ['quote_costs/bs_quotes_' + BK]: SIDECAR() } }); await P.render('bs.' + BK);
    assert.ok(P.ops.includes('get bs_quotes/' + BK) && P.ops.includes('get quote_costs/bs_quotes_' + BK)); assert.ok(P.painted.includes('Brilliance Steel'));
    await P.node('#qa-view-doc').click(); assert.deepEqual(P.builderCalls, [['review', 'bs_quotes', BK]]);
  });
  it('the thread repaints when the tab comes back to the front — only while the page is open, only the thread (no second read of the quote), and only once the listener is bound (once per session)', async () => {
    const rows = { quote_comments: [{ id: 'c1', threadKey: 'bk_quotes_' + ROOT_ID, submitterUid: 'u-sales', kind: 'comment', authorRole: 'sales', authorName: 'Sales Tester', text: 'New reply', quoteId: BK, createdAt: { seconds: 1700000200 } }] };
    const P = makePage({ docs: pageDocs(), rows: { quote_comments: [] } }); await P.render(); await P.render();
    assert.equal(typeof P.docHandlers.visibilitychange, 'function');
    P.ctx.db = makeDb({ docs: pageDocs(), rows }).db;
    P.win.currentPage = 'dashboard'; await P.docHandlers.visibilitychange(); await new Promise((r) => setImmediate(r)); assert.equal(P.threadBox.innerHTML, '', 'another page is open: nothing is read');
    P.win.currentPage = 'quote-approval'; await P.docHandlers.visibilitychange(); await new Promise((r) => setImmediate(r));
    assert.ok(P.threadBox.innerHTML.includes('New reply'), 'the thread was re-read and repainted');
    assert.equal(P.ops.filter((o) => o === 'get bk_quotes/' + BK).length, 2, 'two renders, two reads of the quote — the repaint added none');
    const src = PAGE.slice(PAGE.indexOf('window.renderQuoteApproval = async function'));
    assert.equal((src.match(/document\.addEventListener\('visibilitychange'/g) || []).length, 1); assert.match(src, /if \(!_visBound\) \{\s*_visBound = true;/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// QUOTE-PRESIDENT-FIGURES-SPEC-2026-11-20 §6 / §13.4 — the President's own prices on the review page: the pure model (5d) and the page against a stand-in engine frame (6b)
// MUTATION LOG (2026-11-20, scratch copy of js/screens/quote-approval.js, this file run; each mutant KILLED by the test named):
//   P1  figuresOn ignores a newer revision                                          -> "figuresOn is false ..."
//   P2  Sales sees the Below cost sentence / the boxes                              -> "Sales' view model never contains ..."
//   P3  plain Approve with a typed figure is accepted                               -> "plain Approve and Return with a price typed are refused ..."
//   P4  the page accepts a message from any source                                  -> "messages from another source are ignored ..."
//   P5  a stale seq is applied                                                      -> "a stale seq is dropped ..."
//   P6  the P1 check is skipped                                                     -> "a P1 failure ..."
//   P7  the P2 check is skipped                                                     -> "a P2 failure ..."
//   P8  Approve at my figures sends no expectSig / the wrong money                  -> "Approve at my figures: ..."
//   P9  the carry is offered without the engine being exact                          -> "Return with my figures: ..."
//   P10 a line note goes into the markup unescaped                                   -> "every new string goes through esc ..."
//   P11 a thread row's line name is unescaped                                         -> "every new string goes through esc ..."
//   P12 a line over the 60-row cap is not refused                                     -> "more than 60 rows ..." (SURVIVED the first run; that test was added and the mutant is now KILLED)
//   P13 Return with figures offers the carry when the "show me the re-send" tick is on -> "Return with my figures: ..."
//   P14 the below-cost warning (a cost) reaches a viewer who is not the President     -> "Sales' view model never contains ..." / "... Below cost ..."
const PS = '₱';   // the peso sign is built here, never written next to a digit in this file
const approved = { status: 'filed', approvalStatus: 'approved', approvedAt: { seconds: 1700000300 } };
const returned = { status: 'needs_revision', approvalStatus: 'needs_revision', returnedAt: { seconds: 1700000300 }, presidentNotes: 'Make it two sinks' };
const btns = (vm) => plain(vm.actions.buttons);
describe('5d · the President\'s figures: the pure model', () => {
  const FQ = PAGE_CTX.window.QuoteFigures;
  const sidecar = SIDECAR({ kcSummary: KCSUM() });
  const rowsKey = (q, inputs) => { const vm = QA.viewModel(q, baseCtx({ figures: { inputs, engine: {} }, sidecar })).fig.rows; return QA.figKey(vm); };
  const readyEngine = (q, inputs, payload, extra) => ({ phase: 'ready', reason: '', result: Object.assign({ key: rowsKey(q, inputs), payload, costSidecar: SIDECAR({ kcSummary: KCSUM({ net: 900 }) }), held: [] }, extra || {}) });
  const fview = (q, inputs, engine, over) => { const vm = QA.viewModel(q, baseCtx(Object.assign({ figures: { inputs, engine: engine || {} }, sidecar }, over || {}))); return { vm, html: QA.html(vm, esc) }; };
  const payloadAt = (q, to) => Object.assign({}, plain(q), { quoteNumber: q.quoteNumber, items: plain(q.items).map((it, i) => (i === 0 ? Object.assign(it, { unitPrice: to, amount: to * it.qty }) : it)), subtotal: 3000, discountAmount: 150, netAmount: 2850, vatAmount: 300, total: 2850, grandTotal: 2850, payment: { downPayment: 1425, balance: 1425 } });

  it('the President gets a box on every priced line and a note box on a fee line; a section header and a viewer who is not the President get none', () => {
    const q = quote({ items: [headerRow(), kcLine(), catLine(), customLine({ id: 'MISCFEE', name: 'Delivery' })] });
    const { vm, html } = fview(q, {});
    assert.equal(vm.figuresOn, true);
    const lines = vm.groups.flatMap((g) => g.lines);
    assert.deepEqual(plain(lines.map((L) => !!L.fig && L.fig.can)), [true, true, false], 'the header row is not a line; the fee line takes a note only');
    assert.equal((html.match(/class="qa-fig-price"/g) || []).length, 2); assert.equal((html.match(/class="qa-fig-note"/g) || []).length, 3);
    assert.ok(html.includes('Additional costs: return with a note.')); assert.ok(html.includes('Your price (per pc)'));
    assert.match(html, /inputmode="decimal" autocomplete="off" data-i="1" placeholder="[^"]+"/, 'a numeric keyboard, no autofill; Sales\' price is the placeholder');
  });
  it('Sales\' view model never contains fig, a cost, the Below cost sentence or a box — the President\'s does', () => {
    const inputs = { 0: { price: '500', note: 'too low?' } };
    const S = fview(quote(), inputs, {}, { role: 'employee', uid: 'u-sales' });
    assert.equal(S.vm.figuresOn, false); assert.equal(S.vm.fig, null); assert.equal(S.vm.figSummary, null); assert.equal(S.vm.cost, null);
    assert.equal(S.vm.groups.every((g) => g.lines.every((L) => L.fig === null && L.cost === null)), true);
    for (const word of ['Below cost', 'qa-fig-price', 'qa-fig-note', 'At your prices', 'Approve at my figures', 'qa-fig-seefirst']) assert.equal(S.html.includes(word), false, word);
    const P = fview(quote(), inputs);
    assert.equal(P.vm.figuresOn, true); assert.deepEqual(plain(P.vm.groups[0].lines[0].fig.warns), ['big-cut', 'below-cost']); assert.ok(P.html.includes('Below cost'));
    assert.equal(P.vm.groups[0].lines[0].fig.amount, `2 × ${PS}500.00 = ${PS}1,000.00`);
  });
  it('figuresOn is false when the quote is not pending, when a newer revision exists, for a manager or a secretary, and when the thread is off (no immutable record)', () => {
    const inputs = { 0: { price: '500' } };
    for (const [q, c] of [[quote(approved), {}], [quote(returned), {}], [quote(), { newer: { ref: 'bk.' + NEW_ID, number: 'R2' } }], [quote(), { role: 'manager', uid: 'u-boss' }], [quote(), { role: 'secretary', uid: 'u-boss' }], [quote(), { commentsOff: true }], [quote(), { role: 'employee', uid: 'u-sales' }]]) {
      const { vm, html } = fview(q, inputs, {}, c);
      assert.equal(vm.figuresOn, false, JSON.stringify(c)); assert.equal(html.includes('qa-fig-price'), false);
      assert.equal(btns(vm).some((b) => b === 'approveFig' || b === 'returnFig'), false);
    }
    assert.deepEqual(btns(fview(quote(), {}, {}, { newer: { ref: 'bk.x', number: 'R2' } }).vm), ['approve', 'return', 'comment'], 'a newer revision: today\'s bar');
  });
  it('the buttons: five for the President; both own-figures buttons disabled with "Type a price beside a line first." until a valid price is typed; a bad price disables both; Approve needs the engine to be exact, Return does not', () => {
    const q = quote();
    let r = fview(q, {}); assert.deepEqual(btns(r.vm), ['approve', 'approveFig', 'returnFig', 'return', 'comment']);
    assert.deepEqual(plain(r.vm.actions.fig), { noFig: true, approveFig: { disabled: true, title: 'Type a price beside a line first.' }, returnFig: { disabled: true, title: 'Type a price beside a line first.' } });
    assert.match(r.html, /class="qa-actionbar qa-actionbar-fig qa-nofig"/); assert.match(r.html, /id="qa-approve-fig" disabled title="Type a price beside a line first\."/);
    r = fview(q, { 0: { price: '0' } }); assert.equal(r.vm.actions.fig.returnFig.disabled, true); assert.equal(r.vm.actions.fig.returnFig.title, 'Fix the price marked in red first.'); assert.ok(r.html.includes('Type a price above zero. To give a line free, return it with a note.'));
    r = fview(q, { 0: { price: '1000' } }, { phase: 'unavailable', reason: 'mismatch' });
    assert.equal(r.vm.figSummary.state, 'unavailable'); assert.equal(r.vm.actions.fig.approveFig.disabled, true); assert.equal(r.vm.actions.fig.approveFig.title, QA.NO_ENGINE_SENTENCE); assert.equal(r.vm.actions.fig.returnFig.disabled, false, 'Return stays available');
    assert.ok(r.html.includes('Totals at your figures cannot be worked out for this quote here.'));
    r = fview(q, { 0: { price: '1000' } }, { phase: 'loading' }); assert.equal(r.vm.figSummary.state, 'loading'); assert.equal(r.vm.actions.fig.approveFig.disabled, true); assert.ok(r.html.includes('Working out the totals at your prices'));
    r = fview(q, { 0: { price: '1000' } }, readyEngine(q, { 0: { price: '1000' } }, payloadAt(q, 1000)));
    assert.equal(r.vm.figSummary.state, 'exact'); assert.equal(r.vm.actions.fig.approveFig.disabled, false); assert.equal(r.vm.actions.fig.noFig, false); assert.equal(/ qa-nofig/.test(r.html), false);
    const fresh = fview(Object.assign(quote(), { editableState: null }), { 0: { price: '1000' } }); assert.equal(fresh.vm.actions.fig.approveFig.disabled, true); assert.equal(fresh.vm.figSummary.reason, 'no-snapshot');
    assert.equal(fresh.vm.actions.fig.approveFig.title, 'This quote was filed before the builder kept an editable copy.');
  });
  it('the live summary: before and after of subtotal, discount, net, VAT, grand total, down payment and balance, from the engine\'s payload against the stored quote; the cost card follows ("at your prices"), and says "at Sales\' prices" until it does', () => {
    const q = quote(); const inputs = { 0: { price: '1000' } };
    const e = readyEngine(q, inputs, payloadAt(q, 1000), { held: [2] });
    const { vm, html } = fview(q, inputs, e);
    const rows = plain(vm.figSummary.rows);
    assert.deepEqual(rows.map((r) => r.label), ['Subtotal', 'Discount', 'Net', 'VAT', 'Grand total', 'Down payment', 'Balance']);
    assert.deepEqual(rows.find((r) => r.label === 'Grand total'), { label: 'Grand total', key: 'total', before: `${PS}3,641.82`, after: `${PS}2,850.00`, changed: true });
    assert.equal(vm.figSummary.held, 1); assert.ok(html.includes('1 other line is held at the price shown.'));
    assert.equal(vm.cost.label, 'at your prices'); assert.ok(html.includes('Cost and margin <span class="qa-note">at your prices</span>'));
    assert.equal(fview(q, inputs, { phase: 'loading' }).vm.cost.label, "at Sales' prices");
    assert.equal(fview(q, {}).vm.cost.label, undefined, 'no figure typed: the card is today\'s');
    const opts = quote({ optionsMode: true, optionsBasis: 'A', options: [{ key: 'A', label: 'Option A', itemCount: 2, total: 1000 }, { key: 'B', label: 'Option B', itemCount: 1, total: 500 }] });
    const po = Object.assign(payloadAt(opts, 1000), { optionsBasis: 'A', options: [{ key: 'A', label: 'Option A', itemCount: 2, total: 900 }, { key: 'B', label: 'Option B', itemCount: 1, total: 500 }] });
    const o = fview(opts, inputs, readyEngine(opts, inputs, po));
    assert.deepEqual(plain(o.vm.figSummary.options.map((x) => [x.label, x.before, x.after, x.basis])), [['Option A', `${PS}1,000.00`, `${PS}900.00`, true], ['Option B', `${PS}500.00`, `${PS}500.00`, false]]);
  });
  it('every new string goes through esc: a script tag in a note, in a line name, in the President\'s name and in a thread row is printed as text', () => {
    const q = quote({ items: [kcLine({ name: XSS }), catLine(), customLine()], presidentFigures: { v: 1, mode: 'return', byName: XSS, at: '2026-11-20T01:00:00.000Z', lines: [{ i: 0, name: XSS, from: 1, to: 2, note: XSS }], changed: 1 } });
    const { html } = fview(q, { 0: { price: XSS, note: XSS }, 1: { price: '1', note: XSS } });
    assert.equal(html.includes('<img src=x onerror=1>'), false, 'no raw tag anywhere'); assert.ok(html.includes('&lt;img src=x onerror=1&gt;'));
    const th = QA.thread(quote(), [{ id: 'c', authorRole: 'president', authorName: XSS, kind: 'figures', quoteId: BK, text: XSS, lines: [{ i: 0, name: XSS, from: 1, to: 2, note: XSS }], createdAt: { seconds: 1700000200 } }], { id: BK, lineNo: { 0: 1 } });
    const t = QA.threadHtml(th, esc); assert.equal(t.includes('<img'), false); assert.ok(t.includes('&lt;img'));
    assert.equal(th.items[0].kind, 'Prices and notes'); assert.deepEqual(plain(th.items[0].rows), [{ no: '1', name: XSS, from: 1, to: 2, note: XSS }]);
    assert.ok(t.includes('<ul class="qa-entry-rows">') && t.includes(`: ${PS}1.00 to ${PS}2.00`));
    const other = QA.thread(quote(), [{ id: 'c', authorRole: 'president', kind: 'returned', quoteId: 'another-doc', text: '', lines: [{ i: 0, name: 'Sink', from: 1, to: 2, note: '' }], createdAt: { seconds: 1 } }], { id: BK, lineNo: { 0: 1 } });
    assert.equal(other.items[0].rows[0].no, '', 'an entry of another revision prints no line number (its lines may have moved)');
  });
  it('his figures are shown beside each line on THIS doc to both sides: "President: X (Sales\' price Y) · note", a note-only line, and a chip on a line that is already at his price (held says so)', () => {
    const pf = { v: 1, mode: 'return', by: 'u-pres', byName: 'The President', at: '2026-11-20T01:00:00.000Z', lines: [{ i: 0, name: 'Chef Mode stove', from: 1234.5, to: 1000, note: 'a lower price' }, { i: 1, name: 'Work table', from: 421.75, to: null, note: 'check the top' }], changed: 1 };
    const q = quote({ presidentFigures: pf, items: [kcLine(), catLine(), customLine({ priceBy: { role: 'president', name: 'The President', at: '2026-11-20T01:00:00.000Z', salesPrice: 90 } })] });
    for (const view_ of [fview(q, {}, {}, { role: 'employee', uid: 'u-sales' }), fview(q, {}, {})]) {
      assert.ok(view_.html.includes(`President: ${PS}1,000.00 (Sales' price ${PS}1,234.50) · "a lower price"`), 'a price and a note'); assert.ok(view_.html.includes(`President's note: "check the top"`));
      assert.ok(view_.html.includes('class="qa-chip qa-chip-pres" title="Sales&#39; price was ') && view_.html.includes('President&#39;s price</span>'));
    }
    const held = quote({ items: [customLine({ priceBy: { role: 'president', held: true, salesPrice: 1 } })] });
    assert.ok(fview(held, {}).html.includes('Price held')); assert.equal(fview(held, {}).html.includes('Price typed by hand'), false, 'a President\'s price is not "typed by hand"');
    const wrongName = quote({ presidentFigures: Object.assign({}, pf, { lines: [{ i: 0, name: 'A different line', from: 1, to: 2, note: '' }] }) });
    assert.equal(fview(wrongName, {}).html.includes('President:'), false, 'a row whose name no longer matches its line is not shown on it');
  });
  it('more than 60 rows: the 61st figure or note is refused in its own box with the sentence, only 60 rows are stored, and both own-figures buttons wait until he clears one', () => {
    const items = Array.from({ length: 61 }, (_, k) => catLine({ name: 'Line ' + k, qty: 1, unitPrice: 100 + k, amount: 100 + k }));
    const q = quote({ items }); const inputs = {}; items.forEach((_, k) => { inputs[k] = { price: '', note: 'note ' + k }; });
    const { vm, html } = fview(q, inputs);
    assert.equal(vm.fig.rows.length, 60); assert.equal(vm.fig.anyError, true);
    const L = vm.groups.flatMap((g) => g.lines);
    assert.equal(L[59].fig.error, ''); assert.equal(L[60].fig.error, 'Too many lines for one decision. Return it with a note.'); assert.equal(L[60].fig.over, true);
    assert.ok(html.includes('Too many lines for one decision. Return it with a note.'));
    inputs[60].note = ''; assert.equal(fview(q, inputs).vm.fig.anyError, false, 'clearing the 61st lets it through');
  });
  it('the three banners: approved at his prices, filed under his prices, returned with his prices (and the old ones are untouched)', () => {
    const pf = (mode, extra) => Object.assign({ v: 1, mode, by: 'u-pres', byName: 'The President', at: '2026-11-20T01:00:00.000Z', lines: [{ i: 0, name: 'Chef Mode stove', from: 1, to: 2, note: '' }], changed: 1 }, extra || {});
    const text = (q, c) => view(q, c).vm.banners.filter((b) => b.kind === 'state').map((b) => b.text);
    assert.match(text(quote(Object.assign({}, approved, { presidentFigures: pf('approve') })))[0], /^Approved by the President on .+ at his own prices on 1 line\.$/);
    assert.match(text(quote(Object.assign({}, approved, { approvalCarriedKind: 'figures', approvalCarriedFrom: 'qd1', approvalCarriedOn: '2026-11-20T01:00:00.000Z' })))[0], /^Filed under the prices the President set on Nov 20, 2026\.$/);
    assert.match(text(quote(Object.assign({}, returned, { returnedAt: { seconds: 1700000500 }, presidentFigures: pf('return') })))[0], /^Returned on .+ with the President's prices on 1 line\. Waiting for Sales to apply them and re-send\.$/);
    assert.match(text(quote(Object.assign({}, returned, { returnedAt: { seconds: 1700000500 } })))[0], /^Returned on .+\. Waiting for Sales to revise\.$/);
    assert.match(text(quote(approved))[0], /^Approved by the President( on .+)?\.$/);
  });
  it('the submitter\'s button on a returned doc: Apply President\'s figures when it carries at least one price and an editable copy; else Revise; nothing without a copy', () => {
    const pf = { v: 1, mode: 'return', lines: [{ i: 0, name: 'Chef Mode stove', from: 1, to: 2, note: '' }], changed: 1 };
    const S = (over) => view(quote(Object.assign({}, returned, over)), { role: 'employee', uid: 'u-sales' });
    assert.deepEqual(btns(S({ presidentFigures: pf }).vm), ['comment', 'applyFig']); assert.ok(S({ presidentFigures: pf }).html.includes('id="qa-apply-fig">Apply President\'s figures<'));
    assert.deepEqual(btns(S({ presidentFigures: Object.assign({}, pf, { lines: [{ i: 0, name: 'x', from: 1, to: null, note: 'only a note' }] }) }).vm), ['comment', 'revise']);
    assert.deepEqual(btns(S({ presidentFigures: pf, editableState: null }).vm), ['comment']); assert.deepEqual(btns(S({}).vm), ['comment', 'revise']);
    assert.deepEqual(btns(view(quote(Object.assign({}, returned, { presidentFigures: pf })), {}).vm), ['comment'], 'the President has no Apply button');
  });
});

describe('6b · the President\'s figures on the page: the hidden engine frame, the proofs, and what each button sends', () => {
  const FQ = PAGE_CTX.window.QuoteFigures;
  const rootOf = (P) => P.node('.qa-page');
  const box = (cls, i, value) => ({ dataset: { i: String(i) }, value, classList: { contains: (c) => c === cls }, matches: (sel) => sel.split(',').some((x) => x.trim() === '.' + cls), focus() {} });
  const price = (i, v) => box('qa-fig-price', i, v), note = (i, v) => box('qa-fig-note', i, v);
  const type = (P, i, v) => rootOf(P).handlers.input({ target: price(i, v) });
  const typeNote = (P, i, v) => rootOf(P).handlers.input({ target: note(i, v) });
  const focus = (P, i) => rootOf(P).handlers.focusin({ target: price(i, '') });
  const q0 = () => quote();
  const baseOf = () => FQ.summary(q0());
  const unitsOf = () => q0().items.map((it) => it.unitPrice);
  const payloadAt = (to) => Object.assign({}, plain(q0()), { items: plain(q0().items).map((it, i) => (i === 0 ? Object.assign(it, { unitPrice: to, amount: to * it.qty }) : it)), subtotal: 3000, discountAmount: 150, netAmount: 2850, vatAmount: 300, total: 2850, grandTotal: 2850, payment: { downPayment: 1425, balance: 1425 } });
  const fromFrame = (P, data, src) => P.msgHandlers[0]({ origin: ORIGIN, source: src === undefined ? P.frames[0].contentWindow : src, data });
  const ready = async (P, over) => { focus(P, 0); await fromFrame(P, { type: 'QB_READY' }); await fromFrame(P, Object.assign({ type: 'ENGINE_READY', base: baseOf(), units: unitsOf(), kc: true, kcState: 'live' }, over || {})); };
  const sentApply = (P) => P.posted.filter((x) => x.m.type === 'APPLY_FIGURES');
  const flushTimers = (P, ms) => P.timers.filter((t) => t.fn && t.ms === ms).forEach((t) => { const f = t.fn; t.fn = null; f(); });
  const settle = () => new Promise((r) => setImmediate(r));

  it('the engine frame is created LAZILY on the first focus of a price box, once, hidden (aria, no tab stop), with the engine URL; a quote he only reads never loads the builder', async () => {
    const P = makePage({ docs: pageDocs() }); await P.render();
    assert.equal(P.frames.length, 0, 'nothing on a plain read');
    focus(P, 0); focus(P, 1);
    assert.equal(P.frames.length, 1); const f = P.frames[0];
    assert.equal(f.id, 'qa-engine'); assert.equal(f.attrs['aria-hidden'], 'true'); assert.equal(f.attrs.tabindex, '-1'); assert.equal(f.src, 'quote-builder-v2.html?v=9.9.9&engine=1&reopen=1');
    const S = makePage({ docs: pageDocs(), role: 'employee', uid: 'u-sales' }); await S.render(); assert.equal(S.node('.qa-page').handlers.focusin !== undefined, true); focus(S, 0); assert.equal(S.frames.length, 0, 'Sales has no boxes: the focus handler does nothing');
  });
  it('the protocol: QB_READY -> LOAD_QUOTE (the prepared state, not a revision); ENGINE_READY and P1 pass -> APPLY_FIGURES with the valid figures, a seq, who and when; the result paints "At your prices"', async () => {
    const P = makePage({ docs: pageDocs() }); await P.render();
    type(P, 0, '1000'); assert.equal(P.session['qaFig:bk.' + BK].includes('"price":"1000"'), true, 'kept in sessionStorage');
    await ready(P);
    const load = P.posted.find((x) => x.m.type === 'LOAD_QUOTE'); assert.ok(load); assert.equal(load.o, ORIGIN); assert.equal(load.m.payload.asRevision, false); assert.equal(load.m.payload.editableState.sourceDocId, BK);
    const ap = sentApply(P); assert.equal(ap.length, 1); assert.equal(ap[0].o, ORIGIN);
    assert.deepEqual(plain({ seq: ap[0].m.seq, figures: ap[0].m.figures, by: ap[0].m.by }), { seq: 1, figures: [{ i: 0, to: 1000 }], by: { uid: 'u-pres', name: 'The President' } }); assert.match(ap[0].m.at, /^\d{4}-\d\d-\d\dT/);
    await fromFrame(P, { type: 'FIGURES_RESULT', seq: 1, ok: true, payload: payloadAt(1000), costSidecar: { v: 1, items: [] }, held: [], applied: [0], summary: FQ.summary(payloadAt(1000)) });
    const host = P.node('#qa-figsum-host').innerHTML; assert.ok(host.includes('At your prices') && host.includes('Grand total') && host.includes(`${PS}2,850.00`));
  });
  it('messages from another source (or another origin) are ignored, and a stale seq is dropped: only the latest request\'s answer is used', async () => {
    const P = makePage({ docs: pageDocs() }); await P.render();
    type(P, 0, '1000'); focus(P, 0);
    await fromFrame(P, { type: 'ENGINE_READY', base: baseOf(), units: unitsOf() }, {});                       // another source
    await P.msgHandlers[0]({ origin: 'https://evil.test', source: P.frames[0].contentWindow, data: { type: 'ENGINE_READY', base: baseOf(), units: unitsOf() } });   // another origin
    assert.equal(sentApply(P).length, 0, 'the engine is not ready: nothing was believed');
    await fromFrame(P, { type: 'QB_READY' }); await fromFrame(P, { type: 'ENGINE_READY', base: baseOf(), units: unitsOf() });
    assert.equal(sentApply(P).length, 1);
    type(P, 0, '900'); flushTimers(P, 400); assert.equal(sentApply(P).length, 2); assert.equal(sentApply(P)[1].m.seq, 2);
    await fromFrame(P, { type: 'FIGURES_RESULT', seq: 1, ok: true, payload: payloadAt(1000), costSidecar: null, held: [] });
    assert.equal(P.node('#qa-figsum-host').innerHTML.includes(`${PS}2,850.00`), false, 'the answer for the OLD figure is dropped');
    await fromFrame(P, { type: 'FIGURES_RESULT', seq: 2, ok: true, payload: payloadAt(900), costSidecar: null, held: [] });
    assert.ok(P.node('#qa-figsum-host').innerHTML.includes('Grand total'));
  });
  it('a P1 failure (the builder did not reproduce the stored totals) makes the engine unavailable: the sentence, Approve off, the audit line, the frame removed — and a P2 failure (a line moved, a figure missing) does the same', async () => {
    const P = makePage({ docs: pageDocs() }); await P.render(); type(P, 0, '1000');
    await ready(P, { base: Object.assign({}, baseOf(), { total: baseOf().total + 0.01 }) });
    assert.ok(P.node('#qa-figsum-host').innerHTML.includes('Totals at your figures cannot be worked out for this quote here.')); assert.equal(sentApply(P).length, 0);
    assert.equal(P.frames[0].isConnected, false, 'the frame is gone'); assert.deepEqual(P.audits.map((a) => a[3].figuresEngine.split(':')[0]), ['mismatch']);
    const Q = makePage({ docs: pageDocs() }); await Q.render(); type(Q, 0, '1000'); await ready(Q);
    const moved = payloadAt(1000); moved.items[1].unitPrice += 1;
    await fromFrame(Q, { type: 'FIGURES_RESULT', seq: 1, ok: true, payload: moved, costSidecar: null, held: [] });
    assert.ok(Q.node('#qa-figsum-host').innerHTML.includes('cannot be worked out')); assert.ok(Q.audits[0][3].figuresEngine.startsWith('mismatch:P2 moved:1'), Q.audits[0][3].figuresEngine);
    const R = makePage({ docs: pageDocs() }); await R.render(); type(R, 0, '1000'); await ready(R);
    await fromFrame(R, { type: 'FIGURES_RESULT', seq: 1, ok: false, error: 'unstable' }); assert.equal(R.audits[0][3].figuresEngine.split(':')[0], 'unstable');
  });
  it('a timeout (the frame never says ENGINE_READY, or never answers an APPLY_FIGURES) makes the engine unavailable; a quote with no editable copy never creates a frame', async () => {
    const P = makePage({ docs: pageDocs() }); await P.render(); type(P, 0, '1000'); focus(P, 0);
    flushTimers(P, 15000); assert.ok(P.node('#qa-figsum-host').innerHTML.includes('cannot be worked out')); assert.equal(P.audits[0][3].figuresEngine.split(':')[0], 'timeout');
    const Q = makePage({ docs: pageDocs() }); await Q.render(); type(Q, 0, '1000'); await ready(Q); flushTimers(Q, 5000);
    assert.ok(Q.node('#qa-figsum-host').innerHTML.includes('cannot be worked out')); assert.equal(Q.audits[0][3].figuresEngine, 'timeout:apply');
    const N = makePage({ docs: pageDocs({ editableState: null }) }); await N.render(); type(N, 0, '1000'); focus(N, 0);
    assert.equal(N.frames.length, 0); assert.ok(N.node('#qa-figsum-host').innerHTML.includes('cannot be worked out'));
  });
  it('plain Approve and Return with a price typed are refused with the inline sentence and call nothing (no confirm, no decision); line notes alone ride along; none = today\'s call byte for byte', async () => {
    const P = makePage({ docs: pageDocs() }); await P.render(); type(P, 0, '1000');
    await P.node('#qa-approve').click(); assert.equal(P.node('#qa-err').textContent, 'You typed prices. Use Approve at my figures or Return with my figures, or clear them.');
    P.node('#qa-text').value = 'x'; await P.node('#qa-return').click();
    assert.deepEqual(P.decisions, []); assert.deepEqual(P.confirms, []);
    const N = makePage({ docs: pageDocs() }); await N.render(); typeNote(N, 1, 'check the top');
    await N.node('#qa-approve').click();
    assert.equal(N.decisions.length, 1); const d = N.decisions[0];
    assert.deepEqual(Object.keys(d).sort(), ['action', 'agentId', 'clientName', 'coll', 'figures', 'notes', 'quoteId', 'quoteNumber']);
    assert.equal(d.figures.mode, 'approve'); assert.equal(d.figures.changed, 0); assert.equal(d.figures.carry, false); assert.deepEqual(d.figures.lines.map((r) => [r.i, r.to, r.note]), [[1, null, 'check the top']]);
    const R = makePage({ docs: pageDocs() }); await R.render(); typeNote(R, 1, 'redo the top');
    await R.node('#qa-return').click();   // the bottom box is empty: the line note IS the instruction
    assert.equal(R.decisions.length, 1); assert.equal(R.decisions[0].figures.mode, 'return'); assert.equal(R.decisions[0].notes, '');
    const T = makePage({ docs: pageDocs() }); await T.render(); await T.node('#qa-approve').click();
    assert.deepEqual(T.decisions, [{ coll: 'bk_quotes', quoteId: BK, agentId: 'u-sales', quoteNumber: 'BKZZTEST261120-007R1', clientName: 'Mira Santos', action: 'approve', notes: '' }], 'no figures key at all');
  });
  it('Comment: text and/or line notes; with line notes the entry is kind figures with rows whose to is null (a typed price is NOT sent and stays); both empty -> "Write a comment first."; the notified count never carries the note', async () => {
    const P = makePage({ docs: pageDocs() }); await P.render();
    await P.node('#qa-comment').click(); assert.equal(P.node('#qa-err').textContent, 'Write a comment first.');
    type(P, 0, '1000'); typeNote(P, 0, 'is this right?'); typeNote(P, 2, 'colour?');
    await P.node('#qa-comment').click();
    assert.equal(P.adds.length, 1); const e = P.adds[0].data;
    assert.equal(e.kind, 'figures'); assert.equal(e.text, ''); assert.deepEqual(plain(e.lines.map((r) => [r.i, r.to, r.note])), [[0, null, 'is this right?'], [2, null, 'colour?']], 'the typed price is not part of the comment');
    assert.equal(e.lines[0].from, 1234.5); assert.equal(P.session['qaFig:bk.' + BK].includes('"price":"1000"'), true, 'the price stays in its box');
    const n = P.notifs.find((x) => x.kind === 'send'); assert.equal(n.n.title, '💬 The President left notes on your quote'); assert.equal(n.n.body, '"BKZZTEST261120-007R1" for Mira Santos: notes on 2 lines.'); assert.equal(n.n.type, 'quote_comment');
    const T = makePage({ docs: pageDocs() }); await T.render(); typeNote(T, 0, 'x'); T.node('#qa-text').value = 'general words';
    await T.node('#qa-comment').click(); assert.equal(T.notifs.find((x) => x.kind === 'send').n.body, '"BKZZTEST261120-007R1" for Mira Santos: notes on 1 line. general words');
    const C = makePage({ docs: pageDocs() }); await C.render(); C.node('#qa-text').value = 'plain'; await C.node('#qa-comment').click();
    assert.equal(C.adds[0].data.kind, 'comment'); assert.equal('lines' in C.adds[0].data, false);
  });
  it('Approve at my figures: needs an exact engine; the confirm names the lines and the totals; ONE decision carries the builder\'s money fields, the rows, both totals, expectSig of the stored quote and the cost record', async () => {
    const P = makePage({ docs: pageDocs() }); await P.render(); type(P, 0, '1000');
    P.timers.filter((t) => t.ms === 400).forEach((t) => { t.fn = null; });
    const clickP = P.node('#qa-approve-fig').click();   // the decision WAITS for the engine: the frame boots, proves P1, applies the figure, answers
    await settle();
    assert.deepEqual(P.decisions, [], 'the engine has not answered yet: nothing is decided'); assert.deepEqual(P.confirms, []);
    await fromFrame(P, { type: 'QB_READY' }); await fromFrame(P, { type: 'ENGINE_READY', base: baseOf(), units: unitsOf() });
    await fromFrame(P, { type: 'FIGURES_RESULT', seq: sentApply(P).slice(-1)[0].m.seq, ok: true, payload: payloadAt(1000), costSidecar: { v: 1, items: [{ i: 0, n: 'x' }], kcSummary: { v: 1, net: 2850 } }, held: [2], applied: [0] });
    await clickP;
    assert.equal(P.confirms.length, 1); assert.equal(P.confirms[0], `Approve BKZZTEST261120-007R1 for Mira Santos at your prices? 1 line change. Grand total ${PS}3,641.82 becomes ${PS}2,850.00. Down payment ${PS}1,820.91 becomes ${PS}1,425.00. Discount ${PS}191.68 becomes ${PS}150.00. 1 other line is held at the prices shown.`);
    assert.equal(P.decisions.length, 1); const d = P.decisions[0];
    assert.equal(d.action, 'approve'); assert.equal(d.expectSig, FQ.sig(q0())); assert.deepEqual(d.costSidecar, { v: 1, items: [{ i: 0, n: 'x' }], kcSummary: { v: 1, net: 2850 } });
    for (const k of ['items', 'subtotal', 'total', 'grandTotal', 'netAmount', 'vatAmount', 'discountAmount', 'payment', 'editableState', 'editedByPresident', 'editedAt', 'editedBy']) assert.ok(k in d.edits, k);
    assert.equal(d.edits.total, 2850); assert.equal(d.edits.editedBy, 'u-pres'); assert.equal('clientName' in d.edits, false);
    assert.equal(d.figures.mode, 'approve'); assert.equal(d.figures.exact, true); assert.equal(d.figures.carry, false); assert.equal(d.figures.changed, 1); assert.deepEqual(d.figures.held, [2]);
    assert.deepEqual(d.figures.totals, { before: { subtotal: 3833.5, netAmount: 3641.82, total: 3641.82 }, after: { subtotal: 3000, netAmount: 2850, total: 2850 } }); assert.deepEqual(d.figures.lines.map((r) => [r.i, r.from, r.to]), [[0, 1234.5, 1000]]);
  });
  it('Return with my figures: the bottom box may be empty; carry is true only when the engine is exact AND the "Show me the re-send" tick is off; the confirm says which; not exact -> comes back to him', async () => {
    const P = makePage({ docs: pageDocs() }); await P.render(); type(P, 0, '1000');
    P.timers.filter((t) => t.ms === 400).forEach((t) => { t.fn = null; });
    const p1 = P.node('#qa-return-fig').click(); await settle(); await fromFrame(P, { type: 'QB_READY' }); await fromFrame(P, { type: 'ENGINE_READY', base: baseOf(), units: unitsOf() });
    await fromFrame(P, { type: 'FIGURES_RESULT', seq: sentApply(P).slice(-1)[0].m.seq, ok: true, payload: payloadAt(1000), costSidecar: null, held: [] }); await p1;
    assert.equal(P.confirms[0], 'Return BKZZTEST261120-007R1 with your prices on 1 line? Sales applies them and re-sends. A re-send at or above your prices is filed without coming back to you.');
    let d = P.decisions[0]; assert.equal(d.action, 'return'); assert.equal(d.notes, ''); assert.equal(d.expectSig, FQ.sig(q0())); assert.equal('edits' in d, false, 'a return never changes the quote\'s prices');
    assert.deepEqual(plain({ mode: d.figures.mode, exact: d.figures.exact, carry: d.figures.carry, changed: d.figures.changed }), { mode: 'return', exact: true, carry: true, changed: 1 });
    assert.deepEqual(d.figures.totals.after, { subtotal: 3000, netAmount: 2850, total: 2850 });
    const T = makePage({ docs: pageDocs() }); await T.render(); type(T, 0, '1000');
    T.node('#qa-fig-seefirst').checked = true; T.timers.filter((t) => t.ms === 400).forEach((t) => { t.fn = null; });
    const p2 = T.node('#qa-return-fig').click(); await settle(); await fromFrame(T, { type: 'QB_READY' }); await fromFrame(T, { type: 'ENGINE_READY', base: baseOf(), units: unitsOf() });
    await fromFrame(T, { type: 'FIGURES_RESULT', seq: sentApply(T).slice(-1)[0].m.seq, ok: true, payload: payloadAt(1000), costSidecar: null, held: [] }); await p2;
    assert.ok(T.confirms[0].endsWith('The re-send will come back to you for approval.')); d = T.decisions[0]; assert.equal(d.figures.carry, false); assert.equal(d.figures.exact, true);
    const U = makePage({ docs: pageDocs() }); await U.render(); type(U, 0, '1000'); await ready(U, { base: Object.assign({}, baseOf(), { total: 1 }) });   // P1 fails: not exact
    await U.node('#qa-return-fig').click();
    assert.ok(U.confirms[0].endsWith('The re-send will come back to you for approval.')); d = U.decisions[0]; assert.equal(d.figures.exact, false); assert.equal(d.figures.carry, false); assert.equal(d.figures.totals, null);
    assert.equal(U.decisions.length, 1);
  });
  it('a decision refused because the quote CHANGED (P3) reloads the page; a decision taken clears the saved boxes; the boxes come back from the session only for lines whose name and quantity still match', async () => {
    const P = makePage({ docs: pageDocs(), decide: { ok: false, reason: 'changed' } }); await P.render(); type(P, 0, '1000');
    const reads = P.ops.filter((o) => o === 'get bk_quotes/' + BK).length;
    P.timers.filter((t) => t.ms === 400).forEach((t) => { t.fn = null; });
    const clicked = P.node('#qa-return-fig').click(); await settle(); await fromFrame(P, { type: 'QB_READY' }); await fromFrame(P, { type: 'ENGINE_READY', base: baseOf(), units: unitsOf() });
    await fromFrame(P, { type: 'FIGURES_RESULT', seq: sentApply(P).slice(-1)[0].m.seq, ok: true, payload: payloadAt(1000), costSidecar: null, held: [] }); await clicked; await settle();
    assert.equal(P.ops.filter((o) => o === 'get bk_quotes/' + BK).length, reads + 1, 'reloaded'); assert.ok(P.session['qaFig:bk.' + BK], 'the boxes are kept for the reload');
    const stored = JSON.stringify({ 0: { price: '1000', note: '', n: 'Chef Mode stove', q: 2 }, 1: { price: '5', note: '', n: 'Work table', q: 99 }, 2: { price: '7', note: '', n: 'Renamed', q: 1 } });
    const R = makePage({ docs: pageDocs(), session: { ['qaFig:bk.' + BK]: stored } }); await R.render();
    assert.ok(R.painted.includes('value="1000"')); assert.equal(R.painted.includes('value="5"') || R.painted.includes('value="7"'), false, 'a figure on a line whose name or quantity changed is dropped');
    assert.equal(R.frames.length, 1, 'restored prices work the totals out again');
    const D = makePage({ docs: pageDocs(), session: { ['qaFig:bk.' + BK]: stored } }); await D.render(); D.node('#qa-text').value = 'go'; await D.node('#qa-comment').click();
    const OK = makePage({ docs: pageDocs(), session: { ['qaFig:bk.' + BK]: JSON.stringify({ 1: { price: '', note: 'n', n: 'Work table', q: 3 } }) } }); await OK.render(); OK.node('#qa-text').value = ''; await OK.node('#qa-return').click(); await settle();
    assert.equal(OK.decisions.length, 1);
    assert.equal(OK.session['qaFig:bk.' + BK], undefined, 'a taken decision clears the saved boxes');
  });
  it('Apply President\'s figures (the submitter): the builder opens on the returned quote with the one-shot auto-apply flag set', async () => {
    const pf = { v: 1, mode: 'return', lines: [{ i: 0, name: 'Chef Mode stove', qty: 2, from: 1, to: 2, note: '' }], changed: 1 };
    const P = makePage({ docs: pageDocs(Object.assign({}, returned, { presidentFigures: pf })), role: 'employee', uid: 'u-sales' }); await P.render();
    await P.node('#qa-apply-fig').click();
    assert.deepEqual(plain(P.builderCalls), [['reopen', 'bk_quotes', BK, 'bk-quote-builder']]); assert.equal(P.win._qbFiguresAutoApply, true);
  });
});

describe('7 · the Quotes list, the Approvals screen, the notifications, the builder host', () => {
  const salesCtx = () => {
    const win = {}; const navs = [], links = [];
    const ctx = vm.createContext({ window: win, navigateTo: (p, o) => navs.push([p, plain(o)]), console });
    vm.runInContext(ESC_SRC + '\n' + cfgPiece('quoteApprovalRefOf'), ctx);
    win.escHtml = ctx.escHtml; win.QUOTE_COLLECTIONS = ['bk_quotes', 'bs_quotes']; win.showQuoteApprovalLink = (i) => links.push(plain(i));
    vm.runInContext(['quoteApprovalButtonsHtml', 'quoteReturnedNoteHtml', 'bindQuoteApprovalButtons'].map((n) => piece(SALES, new RegExp(`^window\\.${n} = function[\\s\\S]*?\\n\\};`, 'm'), n)).join('\n'), ctx);
    return { win, navs, links };
  };
  const W = salesCtx();
  const sq = (over) => Object.assign({ id: BK, quoteNumber: 'BKZZTEST261120-007R1', clientName: 'Mira Santos', status: 'pending_approval', approvalStatus: 'pending_review', reviewRequestedAt: { seconds: 1 } }, over || {});

  it('a quote waiting for approval offers "Approval link" and "Review & comments"; one that went through approval and is decided only the latter, with the thread\'s size; any other quote neither', () => {
    const H = (q, coll) => W.win.quoteApprovalButtonsHtml(q, coll || 'bk_quotes');
    const pending = H(sq());
    assert.ok(/<button type="button" class="btn-secondary btn-sm q-approval-link-btn" data-coll="bk_quotes" data-id="qd00000000000000001" data-qno="BKZZTEST261120-007R1" data-client="Mira Santos">Approval link<\/button>/.test(pending), pending);
    assert.ok(/<button type="button" class="btn-secondary btn-sm q-approval-open-btn" data-coll="bk_quotes" data-id="qd00000000000000001">Review &amp; comments<\/button>/.test(pending));
    assert.ok(H(sq({ approvalThread: { count: 3 } })).includes('Review &amp; comments (3)'));
    const decided = H(sq({ status: 'filed', approvalStatus: 'approved' })); assert.equal(decided.includes('q-approval-link-btn'), false); assert.ok(decided.includes('q-approval-open-btn'));
    const returned = H(sq({ status: 'needs_revision', approvalStatus: 'needs_revision' })); assert.equal(returned.includes('q-approval-link-btn'), false); assert.ok(returned.includes('q-approval-open-btn'));
    for (const q of [sq({ reviewRequestedAt: undefined, status: 'filed', approvalStatus: 'filed' }), sq({ id: undefined }), null, undefined]) assert.equal(H(q), '', JSON.stringify(q));
    assert.equal(H(sq({ reviewRequestedAt: undefined, approvalStatus: 'pending_review' })).includes('q-approval-open-btn'), false, 'no thread to open before the quote was sent');
    assert.ok(H(sq({ fileName: 'BKZZTEST261120-007R1 (2)' })).includes('data-qno="BKZZTEST261120-007R1 (2)"'), 'the file name, as the first window showed it');
    assert.ok(H(sq(), 'bs_quotes').includes('data-coll="bs_quotes"'));
  });
  it('every attribute is escaped: a quote number, client or id carrying markup or a quote character cannot break out of the button', () => {
    const h = W.win.quoteApprovalButtonsHtml(sq({ id: 'a"b<c>', quoteNumber: '"><img src=x onerror=1>', clientName: `x" onclick="y` }), 'bk_quotes');
    assert.equal(/<img src=x/.test(h), false); assert.equal(/ onclick="y/.test(h), false); assert.ok(h.includes('&quot;&gt;&lt;img src=x onerror=1&gt;')); assert.ok(h.includes('data-id="a&quot;b&lt;c&gt;"'));
    assert.ok(W.win.quoteApprovalButtonsHtml(sq(), '"><b>x').includes('data-coll="&quot;&gt;&lt;b&gt;x"'), 'the collection is escaped too');
  });
  it('a returned quote shows "Returned by the President: <note>" under its title: his note, else his last thread text; cut at 160 and escaped; a quote that is not returned shows nothing; no note: just the line', () => {
    const N = (q) => W.win.quoteReturnedNoteHtml(q);
    assert.equal(N(sq({ approvalStatus: 'needs_revision', presidentNotes: 'Two sinks' })), '<div class="q-returned-note">Returned by the President: Two sinks</div>');
    assert.equal(N(sq({ approvalStatus: 'needs_revision', presidentNotes: '', approvalThread: { lastByRole: 'president', lastText: 'From the thread' } })), '<div class="q-returned-note">Returned by the President: From the thread</div>');
    assert.equal(N(sq({ approvalStatus: 'needs_revision', approvalThread: { lastByRole: 'sales', lastText: 'My reply' } })), '<div class="q-returned-note">Returned by the President</div>', 'the sender\'s own last reply is not the President\'s note');
    assert.equal(N(sq({ approvalStatus: 'needs_revision' })), '<div class="q-returned-note">Returned by the President</div>');
    assert.equal(N(sq({ approvalStatus: 'needs_revision', presidentNotes: 'x'.repeat(400) })), '<div class="q-returned-note">Returned by the President: ' + 'x'.repeat(160) + '</div>', 'cut at 160 characters');
    assert.equal(N(sq({ approvalStatus: 'needs_revision', presidentNotes: XSS })).includes(XSS), false);
    for (const q of [sq(), sq({ approvalStatus: 'approved', presidentNotes: 'x' }), null, undefined]) assert.equal(N(q), '');
  });
  it('the binder: "Approval link" opens the shell\'s window with { coll, id, quoteNumber, clientName }; "Review & comments" goes to the page of that quote', () => {
    const mk = (cls, data) => ({ dataset: data, addEventListener(t, f) { this.f = f; }, click() { this.f({ currentTarget: this }); } });
    const link = mk('q-approval-link-btn', { coll: 'bk_quotes', id: BK, qno: 'N-1', client: 'C' }), open = mk('q-approval-open-btn', { coll: 'bs_quotes', id: BK });
    const container = { querySelectorAll: (sel) => (sel === '.q-approval-link-btn' ? [link] : sel === '.q-approval-open-btn' ? [open] : []) };
    W.win.bindQuoteApprovalButtons(container); link.click(); open.click();
    assert.deepEqual(W.links, [{ coll: 'bk_quotes', id: BK, quoteNumber: 'N-1', clientName: 'C' }]);
    assert.deepEqual(W.navs, [['quote-approval', { subtab: 'bs.' + BK }]]);
  });
  it('both lists use them: the Barro Kitchens card (buttons in its action row, the note under its title, the binder in bindCardActions) and the Brilliant Steel rows (the same, bindQuoteActions)', () => {
    const card = piece(SALES, /const quoteCard = \(q\) => \{[\s\S]*?\n  \};\n/, 'quoteCard');
    assert.ok(card.includes('${window.quoteReturnedNoteHtml(q)}') && card.includes("${window.quoteApprovalButtonsHtml(q, 'bk_quotes')}"));
    assert.ok(card.indexOf('quoteReturnedNoteHtml') < card.indexOf('item-meta') && card.indexOf('quoteApprovalButtonsHtml') > card.indexOf('justify-content:flex-end'));
    const bind = piece(SALES, /const bindCardActions = \(\) => \{[\s\S]*?\n  \};\n/, 'bindCardActions'); assert.ok(bind.includes('window.bindQuoteApprovalButtons(container);'));
    const list = piece(SALES, /const renderList = \(quotes\) => !quotes\.length[\s\S]*?\n        <\/table><\/div><\/div>`;/, 'renderList of the Brilliant Steel summary');
    assert.ok(list.includes("${window.quoteApprovalButtonsHtml(q, 'bs_quotes')}") && list.includes('${window.quoteReturnedNoteHtml(q)}'));
    assert.match(piece(SALES, /^function bindQuoteActions\(el, currentUser, currentRole, container\) \{[^\n]*\n[^\n]*\n/m, 'bindQuoteActions head'), /window\.bindQuoteApprovalButtons\(el\);/);
    assert.equal((SALES.match(/window\.bindQuoteApprovalButtons = /g) || []).length, 1, 'the binder is defined once');
    assert.equal(/\bemojiIcon\(/.test(piece(SALES, /^window\.quoteApprovalButtonsHtml = function[\s\S]*?\n\};/m, 'buttons')), false);
  });

  it('the Approvals screen: both render sites of a quote request get a first "Open quote" button (same data attributes), bound to the review page; the older buttons stay', () => {
    assert.equal((APPROVALS.match(/class="btn-secondary btn-sm qa-open-page-btn" data-quote="\$\{escHtml\(item\.quoteId(\|\|'')?\)\}" data-coll="\$\{escHtml\(item\.quoteColl\|\|'bs_quotes'\)\}">Open quote<\/button>/g) || []).length, 2);
    const binds = APPROVALS.match(/wrap\.querySelectorAll\('\.qa-open-page-btn'\)\.forEach\(btn => onClickSafe\(btn, \(\) => \{\s*navigateTo\('quote-approval', \{ subtab: window\.quoteApprovalRefOf\(btn\.dataset\.coll \|\| 'bs_quotes', btn\.dataset\.quote\) \}\);\s*\}\)\);/g) || [];
    assert.equal(binds.length, 2, 'bound at both sites');
    for (const cls of ['qa-review-btn', 'qa-approve-btn', 'qa-return-btn']) assert.equal((APPROVALS.match(new RegExp(`class="[^"]*${cls}`, 'g')) || []).length, 2, cls + ' stays at both sites');
    assert.ok(APPROVALS.indexOf('qa-open-page-btn') < APPROVALS.indexOf('qa-review-btn'), 'Open quote is the FIRST button');
  });
  it('openQuoteInBuilderReview (the review page\'s "View the quotation document" for the President on a waiting quote): the review context the builder\'s bar reads, then the plain reopen of the right builder', async () => {
    const win = { _qbReviewContext: null }; const calls = [];
    const ctx = vm.createContext({ window: win });
    win.reopenQuoteFromDoc = async (...a) => { calls.push(a); return 'reopened'; }; win.quoteBuilderPageFor = (co) => (co === 'BS' ? 'bs-quote-builder' : 'bk-quote-builder');
    vm.runInContext(piece(APPROVALS, /^window\.openQuoteInBuilderReview = function[\s\S]*?\n\};/m, 'openQuoteInBuilderReview'), ctx);
    assert.equal(await win.openQuoteInBuilderReview('bk_quotes', BK, { createdBy: 'u-sales', quoteNumber: 'N-1', clientName: 'C', company: 'BK' }), 'reopened');
    assert.deepEqual(plain(win._qbReviewContext), { quoteId: BK, partnerUid: 'u-sales', quoteNumber: 'N-1', clientName: 'C', quoteColl: 'bk_quotes' });
    assert.deepEqual(calls, [['bk_quotes', BK, 'bk-quote-builder']]);
    await win.openQuoteInBuilderReview('bs_quotes', BK, { createdBy: 'u', company: 'BS' }); assert.equal(calls[1][2], 'bs-quote-builder');
    await win.openQuoteInBuilderReview('bk_quotes', BK, undefined); assert.equal(win._qbReviewContext.partnerUid, undefined, 'junk in: no throw');
  });

  // ── notifications.js ──
  const notifCtx = () => {
    const navs = [], hidden = [];
    const node = { classList: { add: (c) => hidden.push(c) } };
    const ctx = vm.createContext({ document: { getElementById: () => node }, window: {}, navigateTo: (p, o) => { navs.push(o === undefined ? [p] : [p, plain(o)]); return undefined; }, console });
    vm.runInContext(piece(NOTIF, /^ {2}function _navLink\(link\) \{[\s\S]*?\n {2}\}/m, '_navLink') + '\n' + piece(NOTIF, /^ {2}function _navigateFromNotif\([\s\S]*?\n {2}\}\n/m, '_navigateFromNotif'), ctx);
    return { go: (type, link) => ctx.window && vm.runInContext(`_navigateFromNotif(${JSON.stringify(type)}, null, null, ${JSON.stringify(link)}, null, null)`, ctx), navs, link: (l) => vm.runInContext(`_navLink(${JSON.stringify(l)})`, ctx) };
  };
  it('a notification link "quote-approval/<co>.<id>" opens the review page of that quote; the old page links ("approvals", "bk-quotations") work as before; the quote notification types all reach the link branch', () => {
    const N = notifCtx();
    N.go('quote_review_request', 'quote-approval/bk.Abc123XYZ'); N.go('quote_comment', 'quote-approval/bs.' + BK); N.go('quote_approved', 'approvals'); N.go('quote_returned', 'bk-quotations'); N.go('quote_filed', 'bs-quotations');
    assert.deepEqual(N.navs, [['quote-approval', { subtab: 'bk.Abc123XYZ' }], ['quote-approval', { subtab: 'bs.' + BK }], ['approvals'], ['bk-quotations'], ['bs-quotations']]);
    const M = notifCtx(); M.link('quote-approval/bk.x'); M.link('quote-approval/'); M.link(''); M.link(null); M.link('tasks');
    assert.deepEqual(M.navs, [['quote-approval', { subtab: 'bk.x' }], ['quote-approval/'], [''], [null], ['tasks']].map((x) => (x[0] === '' || x[0] === null ? [x[0]] : x)).slice(0, 5), 'a link that is not "quote-approval/<ref>" goes to navigateTo as it always did');
  });
  it('the push fallback goes through the same router; "quote_comment" has its icon and accent', () => {
    assert.match(NOTIF, /catch \(e\) \{ if \(m\.link && typeof navigateTo === 'function'\) _navLink\(m\.link\); \}/);
    assert.match(NOTIF, /quote_comment:\{icon:'💬',accent:'#1C7ED6'\}/);
    assert.equal((NOTIF.match(/_navLink\(/g) || []).length, 3, 'defined once, used in the last branch of _navigateFromNotif and in the push fallback');
    assert.equal(/navigateTo\(link\);\s*\n\s*\}\s*\n\s*\}/.test(NOTIF), false, 'the last branch no longer calls navigateTo(link) directly');
  });

  // ── app.js: the builder host and the reopen ──
  const hostCtx = (o) => {
    o = o || {};
    const toasts = [], navs = []; const c = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; } };
    const noteBtn = { handlers: {}, addEventListener(t, f) { this.handlers[t] = f; } };
    const win = { APP_VERSION: '1.0.0', currentPage: 'bk-quote-builder', _qbReviewContext: o.review || null, _qbReturnNote: o.note === undefined ? null : o.note, _qbLastApproval: { coll: 'bk_quotes', id: BK }, _qbReopenState: null, _qbReopenAsRevision: false, matchMedia: () => ({ matches: !!o.mobile }), addEventListener() {} };
    const ctx = vm.createContext({
      window: win, console, setTimeout: () => 0, document: { getElementById: (id) => (id === 'page-content' ? c : id === 'qb-return-note-open' ? (c.innerHTML.includes('id="qb-return-note-open"') ? noteBtn : null) : null), body: { classList: { toggle() {}, add() {}, remove() {}, contains: () => false } } },
      navigateTo: (p, x) => navs.push([p, plain(x)]), Notifs: { showToast: (m, t) => toasts.push({ m, t }) }, emojiIcon: () => '', lucide: undefined, enterQbFullscreen() {}, exitQbFullscreen() {}, saveReviewedPartnerQuote() {},
    });
    vm.runInContext(ESC_SRC + '\n' + piece(APP, /^const QB_FULLSCREEN_MQ = .*;$/m, 'QB_FULLSCREEN_MQ') + '\n' + appFn('_qbIsMobile') + '\n' + appFn('_qbIsAuthoritativeLoad') + '\n' + appFn('_qbReopenStripLabel') + '\n' + appFn('renderQuoteBuilderIframe'), ctx);
    return { render: () => vm.runInContext('renderQuoteBuilderIframe()', ctx), c, win, toasts, navs, noteBtn };
  };
  it('the builder host shows a returned quote\'s note ONCE: a strip with the note and "See all comments" on a desktop, a toast on a phone, nothing while the President is reviewing; the note is consumed either way', () => {
    const note = { text: 'Two sinks, please', ref: 'bk.' + BK };
    const D = hostCtx({ note }); D.render();
    assert.ok(D.c.innerHTML.includes('id="qb-return-note"') && D.c.innerHTML.includes('<strong>Returned by the President</strong>: Two sinks, please') && D.c.innerHTML.includes('id="qb-return-note-open">See all comments<'));
    assert.ok(D.c.innerHTML.indexOf('qb-return-note') < D.c.innerHTML.indexOf('<iframe'), 'above the builder');
    D.noteBtn.handlers.click(); assert.deepEqual(D.navs, [['quote-approval', { subtab: 'bk.' + BK }]]);
    assert.equal(D.win._qbReturnNote, null, 'consumed'); assert.equal(D.toasts.length, 0);
    D.render(); assert.equal(D.c.innerHTML.includes('qb-return-note'), false, 'a second mount shows nothing');
    const M = hostCtx({ note, mobile: true }); M.render();
    assert.equal(M.c.innerHTML.includes('qb-return-note'), false); assert.deepEqual(M.toasts, [{ m: 'Returned by the President: Two sinks, please', t: 'info' }]); assert.equal(M.win._qbReturnNote, null);
    const R = hostCtx({ note, review: { quoteId: BK, quoteNumber: 'N', clientName: 'C' } }); R.render();
    assert.equal(R.c.innerHTML.includes('qb-return-note'), false); assert.deepEqual(R.toasts, []); assert.equal(R.win._qbReturnNote, null, 'consumed even while reviewing, so it cannot leak to the next mount');
    assert.equal(hostCtx({}).render() === undefined, true);
    const X = hostCtx({ note: { text: XSS, ref: '' } }); X.render(); assert.equal(X.c.innerHTML.includes(XSS), false); assert.equal(X.c.innerHTML.includes('qb-return-note-open'), false, 'no ref: no link');
    const E = hostCtx({ note: { text: '', ref: 'bk.' + BK } }); E.render(); assert.ok(E.c.innerHTML.includes('<strong>Returned by the President</strong></div>'), 'no text: the line alone');
  });
  it('every builder mount forgets the quote the previous mount sent for approval (_qbLastApproval = null)', () => {
    const H = hostCtx({}); assert.notEqual(H.win._qbLastApproval, null); H.render(); assert.equal(H.win._qbLastApproval, null);
  });
  it('reopenQuoteFromDoc stashes the President\'s note for a RETURNED quote (text cut at 300, with the page ref) and clears it for any other quote', async () => {
    const store = new Map(); const win = { QUOTE_COLLECTIONS: ['bk_quotes', 'bs_quotes'], _qbReturnNote: 'stale' }; const navs = [];
    const ctx = vm.createContext({ window: win, db: { collection: (c) => ({ doc: (id) => ({ get: async () => ({ exists: store.has(c + '/' + id), data: () => store.get(c + '/' + id) }) }) }) }, console, Date,
      Notifs: { showToast() {} }, navigateTo: (p) => navs.push(p), graftQuoteCosts: async () => {} });
    vm.runInContext(cfgPiece('quoteApprovalRefOf') + '\n' + appWin('qbStateForDoc') + '\n' + appWin('reopenQuoteFromDoc'), ctx);
    const docOf = (over) => Object.assign({ editableState: { quoteNo: 'N' }, quoteNumber: 'N', status: 'needs_revision', approvalStatus: 'needs_revision', presidentNotes: 'Two sinks' }, over || {});
    store.set('bk_quotes/' + BK, docOf());
    await win.reopenQuoteFromDoc('bk_quotes', BK, 'bk-quote-builder');
    assert.deepEqual(plain(win._qbReturnNote), { text: 'Two sinks', ref: 'bk.' + BK }); assert.deepEqual(navs, ['bk-quote-builder']);
    store.set('bk_quotes/' + BK, docOf({ presidentNotes: 'y'.repeat(500) })); await win.reopenQuoteFromDoc('bk_quotes', BK, 'bk-quote-builder'); assert.equal(win._qbReturnNote.text.length, 300);
    store.set('bk_quotes/' + BK, docOf({ presidentNotes: undefined })); await win.reopenQuoteFromDoc('bk_quotes', BK, 'bk-quote-builder'); assert.deepEqual(plain(win._qbReturnNote), { text: '', ref: 'bk.' + BK });
    for (const over of [{ status: 'filed', approvalStatus: 'approved' }, { status: 'pending_approval', approvalStatus: 'pending_review' }, { status: 'filed', approvalStatus: 'filed' }]) {
      win._qbReturnNote = 'stale'; store.set('bk_quotes/' + BK, docOf(over)); await win.reopenQuoteFromDoc('bk_quotes', BK, 'bk-quote-builder'); assert.equal(win._qbReturnNote, null, JSON.stringify(over));
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('8 · static pins', () => {
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"])\/\/[^\n]*/g, '$1');
  it('the builder: no approval-link panel hook any more, approvalWhy rides the approval ENVELOPE (not the payload), the badge posts QB_SHOW_APPROVAL_LINK, the badge is clickable in both modes', () => {
    assert.equal(/flow\.showApprovalLink/.test(BUILDER), false);
    assert.match(BUILDER, /window\.parent\.postMessage\(\{ type:'QUOTE_APPROVAL_REQUESTED', payload: quotePayload, draftDocId: savedDraftDocId, costSidecar: quoteCostSidecar, approvalWhy \}, window\.location\.origin\);/);
    assert.match(BUILDER, /const approvalWhy = \{ reasons: d7On\(\) \? \(\(\(D7\.h\('flow\.approvalRequired'\) \|\| \{\}\)\.reasons\) \|\| \[\]\) : \[\],\s*text: String\(reviewBlockReason\(\) \|\| ''\),\s*ticked: !!document\.getElementById\('reqApprovalCheck'\)\?\.checked \};/);
    assert.equal((BUILDER.match(/approvalWhy/g) || []).length, 2, 'built once, posted once');
    assert.equal(/function buildQuotePayload[\s\S]{0,12000}approvalWhy/.test(BUILDER.slice(BUILDER.indexOf('function buildQuotePayload'), BUILDER.indexOf('function buildQuotePayload') + 9000)), false, 'never part of buildQuotePayload()');
    const badge = BUILDER.match(/id="filedBadge" onclick="([^"]*)"/)[1];
    assert.match(badge, /^if\(quoteStatus==='pending_approval'\)window\.parent\.postMessage\(\{type:'QB_SHOW_APPROVAL_LINK',payload:\{docId:reopenSourceDocId\|\|null,collection:reopenSourceCollection\|\|null,quoteNumber:document\.getElementById\('quoteNo'\)\.value,clientName:document\.getElementById\('clientName'\)\.value\}\},window\.location\.origin\)$/);
    assert.equal(/d7On\(\)/.test(badge), false, 'both modes');
  });
  it('qb/d7/d7-flow.js has no link panel, no #/approvals and no remembered sentence; its modal helpers are still there (inert, a smaller diff in a tested file)', () => {
    for (const gone of ['showApprovalLink', 'approvalsLink', '#/approvals', 'lastSent', 'sentFrom']) assert.equal(FLOW.includes(gone), false, gone);
    for (const kept of ['function ensureModal()', 'function openModal(', 'function closeModal()', 'function copyText(']) assert.ok(FLOW.includes(kept), kept);
    assert.equal(/showApprovalLink/.test(read('qb/d7/d7-flow.css')), false);
  });
  it('the review page reads quote_costs ONCE, and only inside the isApprover branch; it writes nothing itself (QuoteThread and decideQuoteApproval do) and uses no inline handler', () => {
    const src = code(PAGE);
    const at = src.indexOf('quote_costs');
    assert.ok(at > 0 && src.indexOf('quote_costs', at + 1) === -1, 'exactly one mention of quote_costs');
    const before = src.slice(src.lastIndexOf('if (', at), at);
    assert.match(before, /^if \(isApprover\) \{\s*loads\.push\(db\.collection\('$/, 'the read sits directly inside `if (isApprover) {`: ' + before);
    assert.match(src, /const isApprover = currentRole === 'president';/);
    assert.equal(/\.(update|set|delete)\(/.test(src), false, 'no direct write');
    assert.equal(/\)\.add\(/.test(src), false, 'no direct add on a collection: the thread goes through QuoteThread.add');
    assert.equal((src.match(/QuoteThread\.add\(/g) || []).length, 1, 'the one comment write');
    assert.equal(/\bon(click|error|load)\s*=|javascript:|innerHTML\s*\+=/.test(src.replace(/safeImg[\s\S]*?\n  \}/, '')), false, 'no inline handler and no string-built handler');
    assert.equal(/localStorage|eval\(|new Function/.test(src), false);   // sessionStorage is allowed since QUOTE-PRESIDENT-FIGURES-SPEC 6.3: the figures boxes survive a reload there (try / catch)
    assert.equal(/emojiIcon\(/.test(src), false, 'plain text in every toast and notification (CHECK 5)');
  });
  it('the cost words appear in the page file only inside the President\'s cost model and its markup — never in the shared line, header, totals, terms or thread builders', () => {
    const src = code(PAGE);
    const costBlock = src.slice(src.indexOf('// ── cost (President only)'), src.indexOf('// ── why this quote needs approval'));
    const rest = src.replace(costBlock, '');
    for (const w of ['Unit cost', 'Unit margin', 'Project cost', 'Standard total', 'Materials only', 'No cost on file', 'Markup set for this quote', 'Last approved at net', 'Commission', 'Cost and margin']) {
      const n = (rest.match(new RegExp(w, 'g')) || []).length;
      assert.ok(n <= 3, `"${w}" appears ${n} times outside the cost block`);
    }
    // the only places the markup prints a cost: the line card (from line.cost) and the cost section (from vm.cost): both guarded by the model that is null for everyone else
    assert.match(src, /cost: isApprover \? costAt\(q, sc, lines\.map\(\(\{ L \}\) => L\), fig, isObj\(figIn\.engine\) \? figIn\.engine : \{\}\) : null,/);
    assert.match(src, /const sc = \(isApprover && isObj\(ctx\.sidecar\)\) \? ctx\.sidecar : null;/);
    assert.match(src, /function costHtml\(vm, e\) \{\s*if \(!vm\.cost\) return '';\s*return '<section class="qa-card qa-cost">/);
    assert.match(src, /\(L\.cost \? \(L\.cost\.none/);
  });
  it('the thread, link and decision writes are the only new writes: the bridge writes approvalWhy and the thread entry in the approval branch alone', () => {
    const branch = APP.slice(APP.indexOf("// QUOTE_APPROVAL_REQUESTED — route by company like QUOTE_FILED"), APP.indexOf("console.error('[QB bridge]', err);"));
    assert.ok(branch.includes('data.approvalWhy = _qbCleanApprovalWhy(e.data.approvalWhy);'));
    const filed = APP.slice(APP.indexOf("if (type === 'QUOTE_FILED') {"), APP.indexOf("// QUOTE_APPROVAL_REQUESTED — route by company like QUOTE_FILED"));
    assert.equal(/approvalWhy|QuoteThread|showQuoteApprovalLink/.test(filed), false, 'QUOTE_FILED: none of it');
    assert.equal(/approvalWhy/.test(APP.slice(APP.indexOf("if (type === 'QUOTE_UPDATE') {"), APP.indexOf("if (type !== 'QUOTE_FILED' && type !== 'QUOTE_APPROVAL_REQUESTED') return;"))), false, 'QUOTE_UPDATE: none');
  });
  it('the tutorial (repo contract): TUTORIAL_VERSION is at least 52 and What\'s New carries an entry for 52, in plain words, without a figure', () => {
    const v = Number(BUILDER.match(/const TUTORIAL_VERSION = (\d+);/)[1]);
    assert.ok(v >= 52, 'TUTORIAL_VERSION ' + v);
    const wn = new Function(`${BUILDER.slice(BUILDER.indexOf('const WHATS_NEW = ['), BUILDER.indexOf('\n];', BUILDER.indexOf('const WHATS_NEW = [')) + 3)}\nreturn WHATS_NEW;`)();
    const e = wn.find((x) => x.ver === 52);
    assert.ok(e && e.date === '2026-11-20' && e.items.length >= 1, 'no What\'s New entry for 52');
    assert.ok(/link to the quote itself/.test(e.items.join(' ')));
    assert.equal(/₱\s*\d|\bpesos?\b|\bD7\b|bridge|Firestore|rules/i.test(e.items.join(' ')), false, 'plain user language');
    assert.equal(wn[0].ver, Math.max(...wn.map((x) => x.ver)), 'newest first');
    assert.match(BUILDER.slice(BUILDER.indexOf('id="helpBody"') > 0 ? 0 : 0).replace(/\s+/g, ' '), /gives you a link to the quote itself, to pass to the President by Messenger or Viber/, 'the Help / tour sentence about the link is the new one');
  });
  it('index.html: the head script decides "login" for an approval link and sets the sign-in flag; nothing else in the head changed shape', () => {
    const html = read('index.html');
    assert.match(html, /var approvalHash = hash\.slice\(0, 17\) === '#\/quote-approval\/';/);
    assert.match(html, /else if \(loginHash \|\| approvalHash\) view = 'login';/);
    assert.match(html, /if \(loginHash \|\| approvalHash\) window\._wantLogin = true;/);
    assert.equal('#/quote-approval/'.length, 17);
  });
  it('the CSS is the page\'s own: qa-* classes and .q-returned-note at the end of styles.css, tokens only (no 4-digit z-index, no hard-coded brand colour beyond the dark photo viewer)', () => {
    const css = read('css/styles.css');
    const at = css.indexOf('/* Quote review page (QUOTE-APPROVAL-LINK-SPEC-2026-11-20)');
    assert.ok(at > 0 && at > css.length - 14000, 'the block is at the end of the file');
    const block = css.slice(at);
    assert.equal(/z-index\s*:\s*\d{4}/.test(block), false); assert.match(block, /\.qa-actionbar \{[^}]*position: sticky; bottom: 0; z-index: var\(--z-shell\)/);
    assert.match(block, /@media \(max-width: 819px\) \{ \.qa-actionbar \{ bottom: calc\(var\(--bottom-nav-h\) \+ env\(safe-area-inset-bottom, 0px\)\)/);
    for (const cls of ['.qa-page', '.qa-card', '.qa-line', '.qa-thumb', '.qa-grand', '.qa-entry', '.qa-compose', '.qa-lightbox', '.qa-lightbox-single', '.q-returned-note']) assert.ok(block.includes(cls), cls);
    assert.ok(/\.qa-grand strong \{ font-size: 1\.5rem/.test(block), 'the grand total is the largest type on the page');
  });
  it('no peso amount is written into a tracked source file of this feature (fixtures excepted): the page and the list helpers format at run time', () => {
    for (const [name, src] of [['js/screens/quote-approval.js', PAGE], ['js/svc-approvals.js QuoteThread', SVC.slice(SVC.indexOf('window.QuoteThread'))]]) {
      assert.equal(/₱\s*\d/.test(code(src)), false, name);
    }
  });
});

describe('9 · the Cost and margin grid keeps labels and values in their columns (owner preview 2026-11-20)', () => {
  it('a full-width note or warning row carries no empty <dd>, so the rows after it stay label | value', () => {
    for (const ks of [KCSUM({ costKnown: false }), KCSUM({ net: 800, standardTotal: 900 })]) {
      const { html } = view(quote(), { sidecar: SIDECAR({ kcSummary: ks }) });
      const kv = (html.match(/<section class="qa-card qa-cost">[\s\S]*?<\/section>/) || [''])[0];
      assert.ok(/qa-(note|bad)/.test(kv), 'the case has a full-width row');
      assert.equal(/<dt class="qa-(note|bad)">[^<]*<\/dt><dd><\/dd>/.test(kv), false, 'no empty value cell after a full-width row');
      const dts = (kv.match(/<dt class="">/g) || []).length, dds = (kv.match(/<dd>/g) || []).length;
      assert.equal(dds, dts, 'every ordinary label has exactly one value');
    }
  });
});
