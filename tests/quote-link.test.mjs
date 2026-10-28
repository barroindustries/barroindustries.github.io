// tests/quote-link.test.mjs — the staff-session side of the link between a quote and the website request / project brief it came from
// (specs/QUOTE-BUILDER-CONFIGURATOR-SPEC.md §3.2 the bridge allowlists, §6.5 "Open request", §6.6 a hand-off boots as an authoritative load,
// §8.1 the link-back written on file / send-for-approval / in-place update, §8.3 the Quotes card on the request and the brief).
//
// js/app.js is not a module and cannot be required, so the pieces under test are lifted out of ITS OWN SOURCE by name (every top-level function in
// that file closes with a brace in column 0) and run in a node:vm context with in-memory stand-ins for Firestore, the toast, the router and the
// session. The bridge listener itself ("window.addEventListener('message', …)") is lifted whole and driven with real message objects, so the whole
// path — sanitise → write the quote → link the request → notify — runs the shipped code, not a copy of it. The two request screens
// (js/screens/quote-requests.js, js/screens/client-info-requests.js) run from their real source for the Quotes cards and the CIR 'quoted' status.
// The firestore.rules update allowlists are READ from firestore.rules, so the fields the app writes are checked against the rule that must accept them.
// Fixtures are FAKE (odd-figure pesos, invented names): the repository is public.
//
// Mutation-tested in scratch copies (see the commit message), never in the shared tree: a request demoted by filing another revision, no de-dup by
// quote id, no 50-entry cap (or the newest dropped), a loosened or kind-unpinned reference guard, a session type (a Brilliant-Steel-only employee, an
// agent) that is exempted from linking or has its sourceRef / estimateCheck nulled, an unchecked quote collection, a Brilliant Steel page that does not
// start the builder on the Brilliant Steel pill (or that sends a company the builder does not offer), an unsanitised sourceRef / estimateCheck, a QUOTE_UPDATE that blanks a link it was not sent, a missing link call on any of the three
// filing paths, a failing link that fails the filing, QB_OPEN_SOURCE unhandled, a hand-off that does not boot authoritative, the permission-denied
// toast, a Quotes card that shows totals / Open to a view-only role or trusts a collection / id / text; each must fail here.
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
const escSrc = read('js/modules.js').match(/function escHtml\(str\) \{[\s\S]*?\n\}/)[0];
const APP = read('js/app.js');

// ── pieces of js/app.js, by name ─────────────────────────────────────────────────────────────────────────────────────────────────────
const piece = (re, what) => { const m = APP.match(re); assert.ok(m, `${what} not found in js/app.js`); return m[0]; };
const fnPiece = (name) => piece(new RegExp(`^function ${name}\\([\\s\\S]*?\\n\\}`, 'm'), name);
const winPiece = (name) => piece(new RegExp(`^window\\.${name} = async function[\\s\\S]*?\\n\\};`, 'm'), name);
const LISTENER = (() => {
  const start = APP.indexOf("window.addEventListener('message', async (e) => {", APP.indexOf('Quote Builder iframe → Firestore bridge'));
  assert.ok(start > 0, 'the bridge listener was not found');
  const end = APP.indexOf('\n});', start);
  assert.ok(end > start && APP.slice(start, end).includes('QUOTE_FILED'), 'the bridge listener could not be lifted whole');
  return APP.slice(start, end + 4);
})();
const LINK_CODE = [
  piece(/^const QB_SOURCE_REF_RE = .*;$/m, 'QB_SOURCE_REF_RE'), fnPiece('_qbCleanSourceRef'), fnPiece('_qbCleanEstimateCheck'),
  winPiece('linkQuoteToRequest'), winPiece('openQuoteSource'), winPiece('reopenQuoteFromDoc'),
  fnPiece('_qbIsAuthoritativeLoad'), fnPiece('_qbReopenStripLabel'),
  piece(/^function isBrilliantOnly\(\) \{.*\}$/m, 'isBrilliantOnly'),
].join('\n');

const ORIGIN = 'https://app.test';
const QR = 'QR-261021-K7M2PX', CIR = 'CIR-261022-ABCDEF';
const RAW_QR = `quote_requests/${QR}`, RAW_CIR = `client_info_requests/${CIR}`;
const FAKE_QUOTE = 'qd00000000000000001';
const infoOf = (over) => Object.assign({ docId: FAKE_QUOTE, coll: 'bk_quotes', quoteNumber: 'BK-ML-WB-261028-001', version: 1, total: 88739, status: 'filed', byName: 'Staff One' }, over || {});

// ── the sandbox: the app's session + router + toast, an in-memory Firestore that records every operation in order ─────────────────────
function makeApp(opts) {
  opts = opts || {};
  const store = new Map(Object.entries(opts.docs || {}).map(([k, v]) => [k, plain(v)]));
  const ops = [], toasts = [], warns = [], navs = [], opens = [], adds = [], updates = [], listeners = [], invalidated = [];
  const stamp = { __serverTimestamp: true };
  const isRequest = (key) => /^(quote_requests|client_info_requests)\//.test(key);
  let seq = 0;
  const docRef = (coll, id) => {
    const key = coll + '/' + id;
    return {
      id,
      get: async () => {
        ops.push('get ' + key);
        if (opts.failGet && isRequest(key)) throw Object.assign(new Error('network down'), { code: 'unavailable' });
        return { exists: store.has(key), id, data: () => plain(store.get(key)) };
      },
      update: async (patch) => {
        ops.push('update ' + key); updates.push({ key, patch });
        if (opts.failUpdate && isRequest(key)) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
        store.set(key, Object.assign({}, store.get(key), patch));
      },
      set: async (body) => { ops.push('set ' + key); store.set(key, body); },
      delete: async () => { ops.push('delete ' + key); store.delete(key); },
    };
  };
  const db = { collection: (coll) => ({
    doc: (id) => docRef(coll, id),
    add: async (data) => { const id = 'qd' + String(++seq).padStart(18, '0'); ops.push('add ' + coll); adds.push({ coll, id, data }); store.set(coll + '/' + id, data); return docRef(coll, id); },
    where: () => ({ get: async () => ({ docs: Array.from({ length: opts.priorFiled || 0 }, () => ({ data: () => ({ quoteNumber: opts.priorNumber || '' }) })) }) }),
  }) };
  const FRAME = {};
  const win = {
    location: { origin: ORIGIN },
    addEventListener: (t, f) => { if (t === 'message') listeners.push(f); },
    QUOTE_COLLECTIONS: ['bk_quotes', 'bs_quotes'],
    quoteCollectionFor: (co) => (co === 'BS' ? 'bs_quotes' : 'bk_quotes'),
    quoteStateFields: (s) => ({ filed: { status: 'filed', approvalStatus: 'filed' }, pending_approval: { status: 'pending_approval', approvalStatus: 'pending_review' } })[s],
    Clients: { upsertFromQuote: async () => 'client_1' },
    fmtN2: (n) => String(n), logAudit: () => {},
    qrOpen: (r) => opens.push(['qr', r]), cirOpen: (r) => opens.push(['cir', r]),
    currentPage: 'bk-quote-builder',
  };
  const ctx = vm.createContext({
    window: win, db, console: { log() {}, error() {}, warn: (...a) => warns.push(a) },
    document: { getElementById: (id) => (id === 'qb-frame' ? { contentWindow: FRAME } : null) },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => stamp } } },
    currentUser: { uid: 'u-staff', email: 'staff@example.test' }, userProfile: { displayName: 'Staff One' }, currentRole: opts.role || 'employee',
    currentDepts: opts.depts || ['Sales'],
    Notifs: { showToast: (m, t) => toasts.push({ m, t }), success: (m) => toasts.push({ m, t: 'success' }), sendToOwner: async () => { ops.push('notify owner'); } },
    navigateTo: async (page, o) => { navs.push([page, o]); if (!opts.navRefused) win.currentPage = page; },
    graftQuoteCosts: async () => {}, dbCacheInvalidate: (k) => invalidated.push(k),
  });
  vm.runInContext(LINK_CODE + '\n' + LISTENER, ctx);
  const call = (name, ...args) => { ctx.__a = args; return plain(vm.runInContext(`${name}(...__a)`, ctx)); };
  const send = async (type, payload, extra) => { await listeners[0]({ origin: ORIGIN, source: FRAME, data: Object.assign({ type, payload }, extra || {}) }); };
  return { ctx, win, store, ops, toasts, warns, navs, opens, adds, updates, invalidated, call, send, link: (sr, info) => win.linkQuoteToRequest(sr, info), FRAME };
}
const qrDoc = (over) => Object.assign({ status: 'new', quotes: [] }, over || {});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the bridge sanitisers — only the exact keys, only real values', () => {
  const S = makeApp();

  it('a source ref comes out as {kind, ref} and nothing else; a QR reference for kind "qr", a CIR reference for kind "cir"', () => {
    assert.deepEqual(S.call('_qbCleanSourceRef', { kind: 'qr', ref: QR }), { kind: 'qr', ref: QR });
    assert.deepEqual(S.call('_qbCleanSourceRef', { kind: 'cir', ref: CIR }), { kind: 'cir', ref: CIR });
    assert.deepEqual(S.call('_qbCleanSourceRef', { kind: 'qr', ref: QR, estimate: { low: 1 }, notes: 'client text', name: 'x', n: 3 }), { kind: 'qr', ref: QR }, 'only kind and ref are ever filed');
  });
  it('anything else is null: a ref of the wrong kind, a malformed or padded ref, a wrong type, a prototype-ish kind', () => {
    const bad = [
      { kind: 'qr', ref: CIR }, { kind: 'cir', ref: QR }, { kind: 'QR', ref: QR }, { kind: 'x', ref: QR }, { kind: 'constructor', ref: QR }, { kind: ['qr'], ref: QR },
      { kind: 'qr', ref: QR.toLowerCase() }, { kind: 'qr', ref: 'QR-261021-k7m2px' }, { kind: 'cir', ref: 'CIR-261022-abcdef' }, { kind: 'qr', ref: QR + '\n' }, { kind: 'qr', ref: ' ' + QR }, { kind: 'qr', ref: QR + 'X' },
      { kind: 'qr', ref: 'QR-26102-K7M2PX' }, { kind: 'qr', ref: 'QR-261021-K7M2P' }, { kind: 'qr', ref: 'QR-261021-K7M2P/' }, { kind: 'qr', ref: '../quote_requests/' + QR },
      { kind: 'qr', ref: [QR] }, { kind: 'qr', ref: { toString: () => QR } }, { kind: 'qr' }, { ref: QR }, {}, null, undefined, QR, 5, [], [QR],
    ];
    for (const v of bad) assert.equal(S.call('_qbCleanSourceRef', v), null, JSON.stringify(v));
  });
  it('an estimate check keeps its six fields: real numbers, a strict boolean, a reason cut at 500; extra fields are dropped', () => {
    const ok = { low: 87350, high: 104750, comparable: 111101.5, inRange: false, pctOff: 6.1, reason: 'because' };
    assert.deepEqual(S.call('_qbCleanEstimateCheck', Object.assign({ direction: 'above', applicable: true, junk: { a: 1 } }, ok)), ok);
    assert.equal(S.call('_qbCleanEstimateCheck', Object.assign({}, ok, { reason: 'x'.repeat(600) })).reason.length, 500);
    assert.equal(S.call('_qbCleanEstimateCheck', Object.assign({}, ok, { inRange: 'true' })).inRange, false, 'only a real true counts as in range');
    assert.deepEqual(S.call('_qbCleanEstimateCheck', { low: 87350, high: 104750, comparable: 90000 }), { low: 87350, high: 104750, comparable: 90000, inRange: false, pctOff: 0, reason: '' });
    assert.equal(S.call('_qbCleanEstimateCheck', Object.assign({}, ok, { reason: 5 })).reason, '');
  });
  it('an estimate check without a real range is null: strings, NaN, Infinity, zero or negative bounds, arrays, nothing', () => {
    const ok = { low: 87350, high: 104750, comparable: 90000 };
    for (const v of [Object.assign({}, ok, { low: '87350' }), Object.assign({}, ok, { high: NaN }), Object.assign({}, ok, { comparable: Infinity }), Object.assign({}, ok, { comparable: undefined }),
      Object.assign({}, ok, { low: 0 }), Object.assign({}, ok, { high: -5 }), [ok], null, undefined, 'x', 5, {}]) {
      assert.equal(S.call('_qbCleanEstimateCheck', v), null, JSON.stringify(v));
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('linkQuoteToRequest — a filed quote is recorded on its request / brief, which moves to Quoted; never demoted, never duplicated, never over 50, never failing a filing', () => {
  const rules = read('firestore.rules');
  const ruleBlock = (head) => { const s = rules.indexOf(head); assert.ok(s > 0, head); return rules.slice(s, rules.indexOf('\n    }\n', s) + 7); };
  const ALLOW = { quote_requests: ruleBlock('match /quote_requests/{ref} {'), client_info_requests: ruleBlock('match /client_info_requests/{ref} {') };
  const listIn = (blk, re) => blk.match(re)[1].split(',').map((x) => x.trim().replace(/^'|'$/g, ''));
  const SERVER = { qr: ['quote_requests', RAW_QR, QR], cir: ['client_info_requests', RAW_CIR, CIR] };
  const lastPatch = (S, key) => S.updates.filter((u) => u.key === key).map((u) => u.patch).pop();

  it('files onto a NEW request: appends the entry, stamps quoteDocId / lastQuoteAt / updatedAt, moves it to "quoted" attributing the writer', async () => {
    const S = makeApp({ docs: { [RAW_QR]: qrDoc() } });
    assert.equal(await S.link({ kind: 'qr', ref: QR }, infoOf()), true);
    const p = lastPatch(S, RAW_QR);
    assert.deepEqual(Object.keys(p).sort(), ['lastQuoteAt', 'quoteDocId', 'quotes', 'status', 'statusChangedAt', 'statusChangedBy', 'statusChangedByName', 'updatedAt']);
    assert.equal(p.quotes.length, 1);
    const e = plain(p.quotes[0]);
    assert.match(e.filedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    delete e.filedAt;
    assert.deepEqual(e, { docId: FAKE_QUOTE, coll: 'bk_quotes', quoteNumber: 'BK-ML-WB-261028-001', version: 1, total: 88739, status: 'filed', byName: 'Staff One' });
    assert.equal(p.quoteDocId, FAKE_QUOTE);
    assert.deepEqual([p.status, p.statusChangedBy, p.statusChangedByName], ['quoted', 'u-staff', 'Staff One']);
    for (const k of ['lastQuoteAt', 'updatedAt', 'statusChangedAt']) assert.deepEqual(plain(p[k]), { __serverTimestamp: true }, k + ' must be a server timestamp');
  });

  it('drops the cached Sales list the request is in (so the new status shows at once) — only after the write succeeded', async () => {
    const S = makeApp({ docs: { [RAW_QR]: qrDoc(), [RAW_CIR]: qrDoc() } });
    await S.link({ kind: 'qr', ref: QR }, infoOf()); assert.deepEqual(S.invalidated, ['qr-list']);
    await S.link({ kind: 'cir', ref: CIR }, infoOf()); assert.deepEqual(S.invalidated, ['qr-list', 'cir-list']);
    const F = makeApp({ failUpdate: true, docs: { [RAW_QR]: qrDoc() } });
    await F.link({ kind: 'qr', ref: QR }, infoOf()); assert.deepEqual(F.invalidated, []);
  });

  it('the CIR (brief) path reads and writes client_info_requests, not quote_requests', async () => {
    const S = makeApp({ docs: { [RAW_CIR]: qrDoc({ status: 'contacted' }) } });
    assert.equal(await S.link({ kind: 'cir', ref: CIR }, infoOf()), true);
    assert.deepEqual(S.ops.filter((o) => /^(get|update) /.test(o)), [`get ${RAW_CIR}`, `update ${RAW_CIR}`]);
    assert.equal(lastPatch(S, RAW_CIR).status, 'quoted');
  });

  it('the status moves new / in_review / contacted -> quoted and NOTHING else: a quoted, converted or archived request is never demoted by another revision', async () => {
    const TABLE = [
      ['qr', 'new', true], ['qr', 'in_review', true], ['qr', 'contacted', true], ['qr', 'quoted', false], ['qr', 'converted', false], ['qr', 'archived', false], ['qr', undefined, false], ['qr', 'weird', false],
      ['cir', 'new', true], ['cir', 'in_review', true], ['cir', 'contacted', true], ['cir', 'quoted', false], ['cir', 'converted', false], ['cir', 'archived', false],
    ];
    for (const [kind, from, advances] of TABLE) {
      const [, raw, ref] = SERVER[kind];
      const S = makeApp({ docs: { [raw]: qrDoc({ status: from }) } });
      assert.equal(await S.link({ kind, ref }, infoOf()), true, `${kind} ${from}`);
      const p = lastPatch(S, raw);
      assert.equal(p.quotes.length, 1, 'the quote is recorded whatever the status');
      assert.equal(p.quoteDocId, FAKE_QUOTE);
      if (advances) assert.equal(p.status, 'quoted', `${kind} ${from}`);
      else for (const k of ['status', 'statusChangedAt', 'statusChangedBy', 'statusChangedByName']) assert.ok(!(k in p), `${kind} ${from} must not write ${k}`);
    }
  });

  it('every key it writes is in the firestore.rules update allowlist of that collection, and the status it writes is in the rule\'s enum', async () => {
    for (const kind of ['qr', 'cir']) {
      const [coll, raw, ref] = SERVER[kind];
      const allow = listIn(ALLOW[coll], /hasOnly\(\[([^\]]*)\]\)/), statuses = listIn(ALLOW[coll], /get\('status',''\) in \[([^\]]*)\]/);
      for (const status of ['new', 'quoted', 'converted']) {
        const S = makeApp({ docs: { [raw]: qrDoc({ status }) } });
        await S.link({ kind, ref }, infoOf());
        const p = lastPatch(S, raw);
        for (const k of Object.keys(p)) assert.ok(allow.includes(k), `${coll}: the rule would refuse "${k}"`);
        if (p.status) assert.ok(statuses.includes(p.status), `${coll}: "${p.status}" is not in the rule's status enum`);
        assert.ok(p.quotes.length <= 50);
        if (p.statusChangedBy) assert.equal(p.statusChangedBy, 'u-staff', 'the rule pins statusChangedBy to the writer');
      }
    }
  });

  it('is de-duplicated by quote id: re-filing or editing the SAME quote replaces its entry (moved last), another quote is appended', async () => {
    const A = { docId: 'qdAAAAAAAAAAAAAAAAAA', coll: 'bk_quotes', quoteNumber: 'N-A', version: 1, total: 1111, status: 'filed', filedAt: '2026-10-01T00:00:00.000Z', byName: 'x' };
    const B = { docId: 'qdBBBBBBBBBBBBBBBBBB', coll: 'bk_quotes', quoteNumber: 'N-B', version: 1, total: 2222, status: 'filed', filedAt: '2026-10-02T00:00:00.000Z', byName: 'x' };
    const S = makeApp({ docs: { [RAW_QR]: qrDoc({ status: 'quoted', quotes: [A, B] }) } });
    await S.link({ kind: 'qr', ref: QR }, infoOf({ docId: A.docId, quoteNumber: 'N-A renamed', version: 2, total: 3333, status: 'pending_approval' }));
    let q = plain(lastPatch(S, RAW_QR).quotes);
    assert.deepEqual(q.map((x) => x.docId), [B.docId, A.docId], 'one entry per quote id, the refiled one last');
    assert.deepEqual([q[1].quoteNumber, q[1].version, q[1].total, q[1].status], ['N-A', 2, 3333, 'pending_approval'], 'the number is the quote\'s file name and stays; what the caller knows is refreshed');
    assert.equal(q[1].filedAt, A.filedAt, 'an entry keeps its first filing time');
    await S.link({ kind: 'qr', ref: QR }, infoOf({ docId: 'qdCCCCCCCCCCCCCCCCCC', quoteNumber: 'N-C' }));
    q = plain(lastPatch(S, RAW_QR).quotes);
    assert.deepEqual(q.map((x) => x.docId), [B.docId, A.docId, 'qdCCCCCCCCCCCCCCCCCC']);
  });

  it('keeps at most 50 entries (the cap firestore.rules enforces), the OLDEST dropped; re-filing one of a full 50 drops nothing', async () => {
    const mk = (i) => ({ docId: 'qd' + String(i).padStart(18, '0'), coll: 'bk_quotes', quoteNumber: 'N' + i, version: 1, total: i, status: 'filed', filedAt: '2026-10-01T00:00:00.000Z', byName: 'x' });
    const fifty = Array.from({ length: 50 }, (_, i) => mk(i + 1));
    const S = makeApp({ docs: { [RAW_QR]: qrDoc({ status: 'quoted', quotes: fifty }) } });
    await S.link({ kind: 'qr', ref: QR }, infoOf({ docId: mk(51).docId }));
    let q = plain(lastPatch(S, RAW_QR).quotes);
    assert.equal(q.length, 50);
    assert.equal(q[0].docId, mk(2).docId, 'the oldest entry went');
    assert.equal(q[49].docId, mk(51).docId, 'the newest is last');
    const S2 = makeApp({ docs: { [RAW_QR]: qrDoc({ status: 'quoted', quotes: fifty }) } });
    await S2.link({ kind: 'qr', ref: QR }, infoOf({ docId: mk(7).docId, total: 777 }));
    q = plain(lastPatch(S2, RAW_QR).quotes);
    assert.equal(q.length, 50); assert.equal(q[0].docId, mk(1).docId, 'nothing was dropped');
    assert.equal(q[49].docId, mk(7).docId); assert.equal(q[49].total, 777);
  });

  it('an in-place update (no status / version given) keeps what filing recorded — status, version, number, first filing time — and refreshes the total', async () => {
    const prev = { docId: FAKE_QUOTE, coll: 'bk_quotes', quoteNumber: 'BK-ML-WB-261028-001 (2)', version: 2, total: 1000, status: 'accepted', filedAt: '2026-10-28T02:00:00.000Z', byName: 'Filer' };
    const S = makeApp({ docs: { [RAW_QR]: qrDoc({ status: 'converted', quotes: [prev] }) } });
    await S.link({ kind: 'qr', ref: QR }, { docId: FAKE_QUOTE, coll: 'bk_quotes', quoteNumber: 'BK-ML-WB-261028-001', total: 91157, byName: 'Editor' });
    const e = plain(lastPatch(S, RAW_QR).quotes[0]);
    assert.deepEqual([e.status, e.version, e.quoteNumber, e.filedAt, e.total], ['accepted', 2, 'BK-ML-WB-261028-001 (2)', '2026-10-28T02:00:00.000Z', 91157]);
    assert.equal(e.byName, 'Editor');
    // and an update on a quote the request has never heard of records it as filed, version 1
    const S2 = makeApp({ docs: { [RAW_QR]: qrDoc() } });
    await S2.link({ kind: 'qr', ref: QR }, { docId: FAKE_QUOTE, coll: 'bk_quotes', quoteNumber: 'N-1', total: 5, byName: 'Editor' });
    const f = plain(lastPatch(S2, RAW_QR).quotes[0]);
    assert.deepEqual([f.status, f.version], ['filed', 1]);
  });

  it('a malformed value cannot get into the entry: unknown status -> filed, bad version -> 1, bad total -> 0, long text cut; a corrupt quotes field starts over', async () => {
    const S = makeApp({ docs: { [RAW_QR]: qrDoc({ quotes: 'not-an-array' }) } });
    await S.link({ kind: 'qr', ref: QR }, infoOf({ status: 'hacked', version: 'x', total: 'NaN', quoteNumber: 'N'.repeat(200), byName: 'B'.repeat(300) }));
    const e = plain(lastPatch(S, RAW_QR).quotes[0]);
    assert.deepEqual([e.status, e.version, e.total, e.quoteNumber.length, e.byName.length], ['filed', 1, 0, 80, 120]);
    const S2 = makeApp({ docs: { [RAW_QR]: qrDoc({ quotes: [null, 'x', 5, { docId: FAKE_QUOTE }, { nope: 1 }] }) } });
    await S2.link({ kind: 'qr', ref: QR }, infoOf());
    assert.deepEqual(plain(lastPatch(S2, RAW_QR).quotes).map((x) => x.docId), [FAKE_QUOTE], 'entries with no quote id are dropped (they would only fill the 50 cap and render as empty rows); the write never crashes');
    const S3 = makeApp({ docs: { [RAW_QR]: qrDoc({ quotes: { docId: 'qdOTHER0000000000001', coll: 'bk_quotes' } }) } });
    await S3.link({ kind: 'qr', ref: QR }, infoOf());
    assert.deepEqual(plain(lastPatch(S3, RAW_QR).quotes).map((x) => x.docId), [FAKE_QUOTE], 'a quotes field that is an object, not a list, is not trusted as one');
  });

  it('refuses a source ref that is not exactly a QR / CIR reference of its own kind: no read, no write, no toast', async () => {
    const bad = [{ kind: 'qr', ref: CIR }, { kind: 'cir', ref: QR }, { kind: 'qr', ref: 'QR-1-X' }, { kind: 'qr', ref: QR + '\n' }, { kind: 'x', ref: QR }, { kind: 'qr', ref: '../x' }, null, undefined, 'QR', { ref: QR }];
    for (const sr of bad) {
      const S = makeApp({ docs: { [RAW_QR]: qrDoc(), [RAW_CIR]: qrDoc() } });
      assert.equal(await S.link(sr, infoOf()), false, JSON.stringify(sr));
      assert.deepEqual(S.ops, [], 'a forged reference must not touch Firestore at all');
      assert.deepEqual(S.toasts, []);
    }
  });

  it('refuses a quote that is not a real one: a collection that is not a quote collection, an id that is not a plain id', async () => {
    for (const info of [infoOf({ coll: 'users' }), infoOf({ coll: 'constructor' }), infoOf({ coll: undefined }), infoOf({ docId: 'a/b' }), infoOf({ docId: '' }), infoOf({ docId: undefined }), infoOf({ docId: "x'y" }), infoOf({ docId: 'a'.repeat(65) }), null, undefined, 'x']) {
      const S = makeApp({ docs: { [RAW_QR]: qrDoc() } });
      assert.equal(await S.link({ kind: 'qr', ref: QR }, info), false, JSON.stringify(info));
      assert.deepEqual(S.ops, []);
    }
  });

  it('no kind of session is exempt (the retired partner session used to be): every role, and a Brilliant-Steel-only employee, links the quote to its request', async () => {
    for (const session of [{ role: 'employee' }, { role: 'manager' }, { role: 'agent' }, { role: 'finance' }, { role: 'president' }, { role: 'employee', depts: ['Brilliant Steel'] }]) {
      const S = makeApp(Object.assign({ docs: { [RAW_QR]: qrDoc() } }, session));
      assert.equal(await S.link({ kind: 'qr', ref: QR }, infoOf({ coll: session.depts ? 'bs_quotes' : 'bk_quotes' })), true, JSON.stringify(session));
      assert.deepEqual(S.ops, [`get ${RAW_QR}`, `update ${RAW_QR}`], JSON.stringify(session));
    }
    assert.equal(makeApp({ depts: ['Brilliant Steel'] }).call('isBrilliantOnly'), true, 'the Brilliant-Steel-only fixture really is a Brilliant-Steel-only session');
  });

  it('a request that is gone (erased under RA 10173) is a quiet false: nothing written, no toast', async () => {
    const S = makeApp({ docs: {} });
    assert.equal(await S.link({ kind: 'qr', ref: QR }, infoOf()), false);
    assert.deepEqual(S.ops, [`get ${RAW_QR}`]);
    assert.deepEqual(S.toasts, []);
  });

  it('is best-effort: a failed read or write resolves false (never rejects), warns, and says "could not update the request link"', async () => {
    for (const o of [{ failGet: true }, { failUpdate: true }]) {
      const S = makeApp(Object.assign({ docs: { [RAW_QR]: qrDoc() } }, o));
      assert.equal(await S.link({ kind: 'qr', ref: QR }, infoOf()), false);
      assert.ok(S.warns.length >= 1, 'it logs the failure');
      assert.deepEqual(S.toasts, [{ m: 'Quote filed; could not update the request link', t: 'info' }]);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the bridge — the three filing paths carry the link and never fail on it', () => {
  const SR = { kind: 'qr', ref: QR };
  const FULL_SR = { kind: 'qr', ref: QR, estimate: { low: 87350, high: 104750 }, notes: 'Call before visiting', name: 'Ana Reyes', targetDate: '2026-11-30' };
  const EC = { low: 87350, high: 104750, comparable: 111101.5, inRange: false, pctOff: 6.1, reason: '' };
  const filed = (over) => Object.assign({ company: 'BK', quoteNumber: 'BK-ML-WB-261028-001', clientName: 'Ana Reyes', clientCompany: 'Reyes Foods', total: 88739, grandTotal: 88739, items: [], editableState: { sourceRef: FULL_SR }, sourceRef: FULL_SR, estimateCheck: Object.assign({ direction: 'above' }, EC) }, over || {});
  const req = (S) => S.updates.filter((u) => u.key === RAW_QR).map((u) => u.patch);

  it('QUOTE_FILED: the quote doc carries the SANITISED sourceRef + estimateCheck, the request gets the entry and moves to Quoted — before the owner is told', async () => {
    const S = makeApp({ docs: { [RAW_QR]: qrDoc() } });
    await S.send('QUOTE_FILED', filed());
    assert.equal(S.adds.length, 1);
    const q = S.adds[0];
    assert.equal(q.coll, 'bk_quotes');
    assert.deepEqual(plain(q.data.sourceRef), SR, 'the builder\'s richer sourceRef is cut to {kind, ref}');
    assert.deepEqual(plain(q.data.estimateCheck), EC, 'the estimate check keeps its six fields');
    assert.deepEqual([q.data.status, q.data.approvalStatus, q.data.version, q.data.fileName], ['filed', 'filed', 1, 'BK-ML-WB-261028-001']);
    assert.deepEqual(plain(q.data.editableState.sourceRef), FULL_SR, 'the editable snapshot is copied wholesale (the bar shows the estimate again on reopen)');
    const p = req(S)[0];
    assert.ok(p, 'the request was updated');
    assert.deepEqual([p.status, p.quoteDocId], ['quoted', q.id]);
    const e = plain(p.quotes[0]);
    assert.deepEqual([e.docId, e.coll, e.quoteNumber, e.version, e.total, e.status, e.byName], [q.id, 'bk_quotes', 'BK-ML-WB-261028-001', 1, 88739, 'filed', 'Staff One']);
    const at = (s) => S.ops.indexOf(s);
    assert.ok(at('add bk_quotes') < at(`get ${RAW_QR}`) && at(`update ${RAW_QR}`) < at('notify owner'), S.ops.join(' | '));
    assert.ok(S.toasts.some((t) => t.t === 'success' && /Quote filed/.test(t.m)));
  });

  it('QUOTE_FILED as a re-filing of the same number is version 2, and the entry carries the file name with its "(2)"', async () => {
    const S = makeApp({ docs: { [RAW_QR]: qrDoc() }, priorFiled: 1, priorNumber: 'BK-ML-WB-261028-001' });
    await S.send('QUOTE_FILED', filed());
    const e = plain(req(S)[0].quotes[0]);
    assert.deepEqual([e.version, e.quoteNumber], [2, 'BK-ML-WB-261028-001 (2)']);
  });

  it('QUOTE_APPROVAL_REQUESTED links too — as "pending_approval" — and the request for approval still goes out', async () => {
    const S = makeApp({ docs: { [RAW_QR]: qrDoc({ status: 'in_review' }) } });
    await S.send('QUOTE_APPROVAL_REQUESTED', filed());
    assert.equal(S.adds[0].data.status, 'pending_approval');
    assert.deepEqual(plain(S.adds[0].data.sourceRef), SR);
    const p = req(S)[0];
    assert.equal(p.status, 'quoted'); assert.equal(plain(p.quotes[0]).status, 'pending_approval');
    assert.ok(S.ops.includes('add approval_requests') && S.ops.includes('notify owner'), 'the approval request and the owner notification still happen');
    assert.ok(S.ops.indexOf(`update ${RAW_QR}`) < S.ops.indexOf('add approval_requests'));
  });

  it('a CIR source links onto the brief (client_info_requests), a Brilliant Steel quote to bs_quotes', async () => {
    const S = makeApp({ docs: { [RAW_CIR]: qrDoc({ status: 'contacted' }) } });
    await S.send('QUOTE_FILED', filed({ sourceRef: { kind: 'cir', ref: CIR }, company: 'BS' }));
    assert.equal(S.adds[0].coll, 'bs_quotes');
    const u = S.updates.find((x) => x.key === RAW_CIR);
    assert.ok(u && u.patch.status === 'quoted');
    assert.equal(plain(u.patch.quotes[0]).coll, 'bs_quotes');
  });

  it('a forged or missing sourceRef is stored as null and the link is not even attempted', async () => {
    for (const sourceRef of [{ kind: 'qr', ref: CIR }, { kind: 'qr', ref: 'QR-1-X' }, { kind: 'users', ref: 'x' }, 'QR', null, undefined]) {
      const S = makeApp({ docs: { [RAW_QR]: qrDoc(), [RAW_CIR]: qrDoc() } });
      await S.send('QUOTE_FILED', filed({ sourceRef, estimateCheck: undefined }));
      assert.equal(S.adds[0].data.sourceRef, null, JSON.stringify(sourceRef));
      assert.equal(S.adds[0].data.estimateCheck, null);
      assert.ok(!S.ops.some((o) => /quote_requests|client_info_requests/.test(o)), 'no request was read or written');
      assert.ok(S.ops.includes('notify owner'), 'the filing itself still completed');
    }
  });

  it('a Brilliant-Steel-only employee files a Brilliant Steel quote WITH its sourceRef + estimateCheck, and the request is linked like any other (no session type is nulled)', async () => {
    const S = makeApp({ depts: ['Brilliant Steel'], docs: { [RAW_QR]: qrDoc() } });
    await S.send('QUOTE_FILED', filed({ company: 'BS' }));
    assert.equal(S.adds[0].coll, 'bs_quotes');
    assert.deepEqual(plain(S.adds[0].data.sourceRef), SR); assert.deepEqual(plain(S.adds[0].data.estimateCheck), EC);
    assert.equal(S.adds[0].data.createdByRole, 'employee');
    const p = req(S)[0];
    assert.ok(p && p.status === 'quoted', 'the request moved to Quoted');
    assert.equal(plain(p.quotes[0]).coll, 'bs_quotes');
    assert.ok(S.ops.includes('notify owner'));
  });

  it('a link that fails (rules not deployed yet, offline) NEVER fails the filing: the quote is saved, the owner is told, staff see why the link is missing', async () => {
    for (const o of [{ failUpdate: true }, { failGet: true }]) {
      const S = makeApp(Object.assign({ docs: { [RAW_QR]: qrDoc() } }, o));
      await S.send('QUOTE_FILED', filed());
      assert.equal(S.adds.length, 1, 'the quote was written');
      assert.ok(S.ops.includes('notify owner'), 'the owner was notified');
      assert.ok(S.toasts.some((t) => t.t === 'success' && /Quote filed/.test(t.m)), 'the success toast still shows');
      assert.ok(S.toasts.some((t) => /could not update the request link/.test(t.m)));
    }
    const S2 = makeApp({ failUpdate: true, docs: { [RAW_QR]: qrDoc() } });
    await S2.send('QUOTE_APPROVAL_REQUESTED', filed());
    assert.ok(S2.ops.includes('add approval_requests'), 'sending for approval is not blocked either');
  });

  it('QUOTE_UPDATE (edit in place): writes the sanitised link ONLY when the builder sent the key, and refreshes the entry on the request', async () => {
    const prev = { docId: 'qdEXISTING0000000001', coll: 'bk_quotes', quoteNumber: 'BK-ML-WB-261028-001', version: 1, total: 1000, status: 'filed', filedAt: '2026-10-28T02:00:00.000Z', byName: 'Filer' };
    const S = makeApp({ docs: { [RAW_QR]: qrDoc({ status: 'quoted', quotes: [prev] }), 'bk_quotes/qdEXISTING0000000001': { status: 'filed' } } });
    await S.send('QUOTE_UPDATE', filed({ total: 91157 }), { docId: 'qdEXISTING0000000001', collection: 'bk_quotes' });
    const upd = S.updates.find((u) => u.key === 'bk_quotes/qdEXISTING0000000001').patch;
    assert.deepEqual(plain(upd.sourceRef), SR); assert.deepEqual(plain(upd.estimateCheck), EC);
    const p = req(S)[0];
    assert.equal(plain(p.quotes[0]).total, 91157);
    assert.ok(!('status' in p), 'an already-quoted request keeps its status');
    // a builder that sends neither key (a page still cached from before this feature) must NOT blank a link the quote already has
    const S2 = makeApp({ docs: { 'bk_quotes/qdEXISTING0000000001': { status: 'filed' } } });
    const payload = filed(); delete payload.sourceRef; delete payload.estimateCheck;
    await S2.send('QUOTE_UPDATE', payload, { docId: 'qdEXISTING0000000001', collection: 'bk_quotes' });
    const upd2 = S2.updates.find((u) => u.key === 'bk_quotes/qdEXISTING0000000001').patch;
    assert.ok(!('sourceRef' in upd2) && !('estimateCheck' in upd2), 'absent keys are not written (respondToQuote reads sourceRef)');
    assert.ok(!S2.ops.some((o) => /quote_requests/.test(o)));
  });

  it('QUOTE_UPDATE: a forged sourceRef is written as null; a Brilliant-Steel-only employee writes both keys like anyone else; a collection that is not a quote collection is ignored', async () => {
    const S = makeApp({ docs: { 'bk_quotes/qdEXISTING0000000001': {}, [RAW_QR]: qrDoc() } });
    await S.send('QUOTE_UPDATE', filed({ sourceRef: { kind: 'qr', ref: CIR } }), { docId: 'qdEXISTING0000000001', collection: 'bk_quotes' });
    assert.equal(S.updates.find((u) => u.key === 'bk_quotes/qdEXISTING0000000001').patch.sourceRef, null);
    assert.ok(!S.ops.includes(`get ${RAW_QR}`));
    const B = makeApp({ depts: ['Brilliant Steel'], docs: { 'bs_quotes/qdEXISTING0000000002': {}, [RAW_QR]: qrDoc() } });
    await B.send('QUOTE_UPDATE', filed({ company: 'BS' }), { docId: 'qdEXISTING0000000002', collection: 'bs_quotes' });
    const bu = B.updates.find((u) => u.key === 'bs_quotes/qdEXISTING0000000002').patch;
    assert.deepEqual(plain(bu.sourceRef), SR); assert.deepEqual(plain(bu.estimateCheck), EC);
    assert.ok(B.ops.includes(`get ${RAW_QR}`) && B.ops.includes(`update ${RAW_QR}`), 'the request entry was refreshed');
    const X = makeApp({ docs: { 'users/u1': {} } });
    await X.send('QUOTE_UPDATE', filed(), { docId: 'u1', collection: 'users' });
    assert.deepEqual(X.updates, []);
  });

  it('each of the three paths calls linkQuoteToRequest exactly where the spec puts it (source order: after the write, before the cost sidecar / notification)', () => {
    const upd = LISTENER.slice(LISTENER.indexOf("if (type === 'QUOTE_UPDATE')"), LISTENER.indexOf("if (type !== 'QUOTE_FILED'"));
    assert.ok(upd.indexOf('.update(update)') > 0 && upd.indexOf('.update(update)') < upd.indexOf('window.linkQuoteToRequest('), 'QUOTE_UPDATE links after the update');
    assert.match(upd, /linkQuoteToRequest\(payload\.sourceRef, \{ docId, coll: collection,/);
    assert.match(upd, /hasOwnProperty\.call\(payload, 'sourceRef'\)[\s\S]*_qbCleanSourceRef\(payload\.sourceRef\)/);
    assert.match(upd, /hasOwnProperty\.call\(payload, 'estimateCheck'\)[\s\S]*_qbCleanEstimateCheck\(payload\.estimateCheck\)/);
    const rest = LISTENER.slice(LISTENER.indexOf("if (type !== 'QUOTE_FILED'"));
    assert.match(rest, /sourceRef:\s+_qbCleanSourceRef\(payload\.sourceRef\),/);
    assert.match(rest, /estimateCheck:\s+_qbCleanEstimateCheck\(payload\.estimateCheck\),/);
    assert.ok(!/\?\s*null\s*:\s*_qbClean/.test(upd + rest), 'a session-conditional "? null : _qbClean…" is back on the link or the estimate check');
    const calls = [...rest.matchAll(/window\.linkQuoteToRequest\(data\.sourceRef, \{ docId: docRef\.id, coll, quoteNumber: data\.fileName, version: data\.version, total: data\.total, status: data\.status, byName: agentName \}\);/g)];
    assert.equal(calls.length, 2, 'QUOTE_FILED and QUOTE_APPROVAL_REQUESTED each link');
    for (const m of calls) {
      const before = rest.slice(0, m.index), after = rest.slice(m.index);
      assert.ok(before.lastIndexOf('await stampRoot(docRef);') > before.lastIndexOf('db.collection(coll).add(data)'), 'after the quote is written and its root stamped');
      assert.ok(after.indexOf('saveCostSidecar(coll, docRef.id)') > 0 && after.indexOf('saveCostSidecar(coll, docRef.id)') < after.indexOf('Notifs.sendToOwner'), 'before the sidecar and the owner notification');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('QB_OPEN_SOURCE / openQuoteSource — "Open request" in the builder\'s hand-off bar', () => {
  it('a QR source opens Sales › Quote requests and then that request; a CIR source opens Sales › Briefs and that brief', async () => {
    const S = makeApp();
    assert.equal(await S.win.openQuoteSource({ kind: 'qr', ref: QR }), true);
    assert.deepEqual(plain(S.navs), [['dept:Sales', { subtab: 'Quote requests' }]]);
    assert.deepEqual(S.opens, [['qr', QR]]);
    const T = makeApp();
    assert.equal(await T.win.openQuoteSource({ kind: 'cir', ref: CIR }), true);
    assert.deepEqual(plain(T.navs), [['dept:Sales', { subtab: 'Briefs' }]]);
    assert.deepEqual(T.opens, [['cir', CIR]]);
  });
  it('the builder\'s message is routed to it (for a Brilliant-Steel-only employee too), and a forged reference or a refused navigation open nothing', async () => {
    const S = makeApp();
    await S.send('QB_OPEN_SOURCE', { sourceRef: { kind: 'qr', ref: QR } });
    assert.deepEqual(S.opens, [['qr', QR]]);
    for (const sr of [{ kind: 'qr', ref: CIR }, { kind: 'cir', ref: QR }, { kind: 'qr', ref: 'QR-1-X' }, { kind: 'qr', ref: QR + '\n' }, { kind: 'x', ref: QR }, null, undefined, 'QR']) {
      const F = makeApp(); await F.send('QB_OPEN_SOURCE', { sourceRef: sr });
      assert.deepEqual(F.navs, [], JSON.stringify(sr)); assert.deepEqual(F.opens, []);
    }
    const B = makeApp({ depts: ['Brilliant Steel'] }); await B.send('QB_OPEN_SOURCE', { sourceRef: { kind: 'qr', ref: QR } });
    assert.deepEqual(B.opens, [['qr', QR]]);
    const T = makeApp(); T.ctx.navigateTo = async () => { throw new Error('router exploded'); };
    await T.send('QB_OPEN_SOURCE', { sourceRef: { kind: 'qr', ref: QR } });     // must resolve: the listener swallows (and logs) a failed navigation
    assert.ok(T.warns.length >= 1); assert.deepEqual(T.opens, []);
    const R = makeApp({ navRefused: true });
    assert.equal(await R.win.openQuoteSource({ kind: 'qr', ref: QR }), false, 'when the router sends the user elsewhere (layoff lockdown) the request is not painted onto that page');
    assert.deepEqual(R.opens, []);
  });
  it('is handled before every write handler and takes no costSidecar / collection (source order)', () => {
    assert.ok(LISTENER.indexOf("type === 'QB_OPEN_SOURCE'") > 0);
    assert.ok(LISTENER.indexOf("type === 'QB_OPEN_SOURCE'") < LISTENER.indexOf("type === 'QUOTE_DRAFT'"));
    assert.match(LISTENER, /if \(type === 'QB_OPEN_SOURCE'\) \{\s*try \{ await window\.openQuoteSource\(payload\.sourceRef\); \}\s*catch \(err\) \{[^}]*\}\s*return;\s*\}/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('a website hand-off boots the builder as an authoritative load (spec §6.6)', () => {
  const S = makeApp();
  it('handoff or a source quote id -> authoritative (?reopen=1: no stale draft banner); nothing else is', () => {
    const t = (st) => S.call('_qbIsAuthoritativeLoad', st);
    assert.equal(t({ handoff: true, clientName: 'x' }), true);
    assert.equal(t({ sourceDocId: 'd1' }), true);
    assert.equal(t({ clientName: 'x', items: [] }), false, 'Quick Estimate\'s hand-off keeps its draft prompt');
    assert.equal(t({ draftDocId: 'd1' }), false);
    assert.equal(t({ handoff: false }), false);
    assert.equal(t(null), false); assert.equal(t(undefined), false);
  });
  it('the strip label: new revision, resuming a saved draft, from a website request, else editing a copy', () => {
    const t = (st, rev) => S.call('_qbReopenStripLabel', st, rev);
    assert.equal(t({ handoff: true }), 'from a website request');
    assert.equal(t({ handoff: true }, true), 'new revision');
    assert.equal(t({ draftDocId: 'd1' }), 'resuming a saved draft');
    assert.equal(t({ handoff: true, draftDocId: 'd1' }), 'resuming a saved draft');
    assert.equal(t({ handoff: true, sourceDocId: 'q1' }), 'editing a copy', 'a reopened quote is not a fresh hand-off');
    assert.equal(t({ sourceDocId: 'q1' }), 'editing a copy');
    assert.equal(t({ sourceDocId: 'q1' }, true), 'new revision');
    assert.equal(t({}), 'editing a copy');
  });

  // the real renderQuoteBuilderIframe, with a fake page
  const RENDER = piece(/^function renderQuoteBuilderIframe\(\) \{[\s\S]*?\n\}/m, 'renderQuoteBuilderIframe');
  const HELPERS = fnPiece('_qbIsAuthoritativeLoad') + '\n' + fnPiece('_qbReopenStripLabel');
  const run = (o) => {
    const page = { innerHTML: '' };
    const win = { _qbReopenState: o.state, _qbReopenAsRevision: o.asRevision, currentPage: o.page, location: { origin: ORIGIN }, addEventListener() {}, removeEventListener() {} };
    const c = vm.createContext({
      window: win, console, setTimeout: () => 0,
      document: { getElementById: (id) => (id === 'page-content' ? page : null), body: { classList: { toggle() {}, add() {}, remove() {} } } },
      _qbIsMobile: () => !!o.mobile, enterQbFullscreen() {}, exitQbFullscreen() {}, emojiIcon: (g) => `[${g}]`,
    });
    vm.runInContext(escSrc + '\n' + HELPERS + '\n' + RENDER + '\nrenderQuoteBuilderIframe();', c);
    return page.innerHTML;
  };
  it('renderQuoteBuilderIframe: a hand-off loads ?reopen=1; Quick Estimate\'s and a fresh builder do not; the strip says where it came from', () => {
    const h = run({ state: { handoff: true, clientName: 'Ana' } });
    assert.match(h, /<iframe id="qb-frame" src="quote-builder-v2\.html\?reopen=1"/);
    assert.match(h, /Quote Builder — from a website request/);
    assert.match(run({ state: { sourceDocId: 'q1', clientName: 'x' } }), /\?reopen=1"/);
    assert.match(run({ state: { sourceDocId: 'q1' } }), /Quote Builder — editing a copy/);
    assert.match(run({ state: { sourceDocId: 'q1' }, asRevision: true }), /Quote Builder — new revision/);
    assert.match(run({ state: { draftDocId: 'd1' } }), /Quote Builder — resuming a saved draft/);
    for (const state of [{ clientName: 'Ana', items: [] }, null, undefined]) {
      const out = run({ state });
      assert.match(out, /<iframe id="qb-frame" src="quote-builder-v2\.html"/); assert.ok(!/reopen=1/.test(out));
    }
    assert.ok(!/Quote Builder —/.test(run({ state: { handoff: true }, mobile: true })), 'no strip on a phone (the builder is fullscreen there)');
  });
  it('the Brilliant Steel Quote Builder page starts the builder on the Brilliant Steel pill (?co=BS, ahead of ?reopen=1); every other page sends no company; the retired portal parameters are never sent', () => {
    assert.match(run({ page: 'bs-quote-builder' }), /<iframe id="qb-frame" src="quote-builder-v2\.html\?co=BS" allow="print">/);
    assert.match(run({ page: 'bs-quote-builder', state: { handoff: true } }), /src="quote-builder-v2\.html\?co=BS&reopen=1"/);
    assert.match(run({ page: 'bs-quote-builder', state: { sourceDocId: 'q1' } }), /src="quote-builder-v2\.html\?co=BS&reopen=1"/);
    assert.match(run({ page: 'bs-quote-builder', state: { clientName: 'Ana', items: [] } }), /src="quote-builder-v2\.html\?co=BS"/, 'Quick Estimate\'s hand-off on the Brilliant Steel page still has no ?reopen');
    for (const page of ['bk-quote-builder', 'bs-quotations', 'dashboard', undefined]) {
      const out = run({ page });
      assert.match(out, /<iframe id="qb-frame" src="quote-builder-v2\.html" allow="print">/, String(page));
      assert.ok(!/co=/.test(out), `${page}: a company was sent`);
    }
    for (const page of ['bs-quote-builder', 'bk-quote-builder']) {
      assert.ok(!/portal=|pco[A-Z]/.test(run({ page, state: { handoff: true } })), `${page}: a retired portal parameter is back`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
describe('reopenQuoteFromDoc — a quote the user may not read says so', () => {
  it('permission-denied -> "Only its author or an admin can open this quote"; any other failure keeps the generic message; success still opens the builder', async () => {
    const mk = (getImpl) => {
      const S = makeApp();
      S.ctx.db = { collection: () => ({ doc: () => ({ get: getImpl }) }) };
      return S;
    };
    const S1 = mk(async () => { throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }); });
    await S1.win.reopenQuoteFromDoc('bk_quotes', FAKE_QUOTE, 'bk-quote-builder');
    assert.deepEqual(S1.toasts, [{ m: 'Only its author or an admin can open this quote', t: 'error' }]);
    assert.deepEqual(S1.navs, []);
    const S2 = mk(async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); });
    await S2.win.reopenQuoteFromDoc('bk_quotes', FAKE_QUOTE, 'bk-quote-builder');
    assert.deepEqual(S2.toasts, [{ m: 'Could not reopen: offline', t: 'error' }]);
    const S3 = mk(async () => ({ data: () => ({ editableState: { quoteNo: 'N-1', sourceRef: { kind: 'qr', ref: QR } }, rootQuoteId: 'r1' }) }));
    await S3.win.reopenQuoteFromDoc('bk_quotes', FAKE_QUOTE, 'bk-quote-builder');
    assert.deepEqual(plain(S3.win._qbReopenState), { quoteNo: 'N-1', sourceRef: { kind: 'qr', ref: QR }, sourceDocId: FAKE_QUOTE, sourceCollection: 'bk_quotes', rootQuoteId: 'r1' });
    assert.deepEqual(S3.navs.map((n) => n[0]), ['bk-quote-builder']);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const QUOTES = [
  { docId: 'qd00000000000000001', coll: 'bk_quotes', quoteNumber: 'BK-ML-WB-261028-001', version: 1, total: 88739, status: 'filed', filedAt: '2026-10-28T02:30:00.000Z', byName: 'Staff One' },
  { docId: 'qd00000000000000002', coll: 'bk_quotes', quoteNumber: 'BK-ML-WB-261028-001 (2)', version: 2, total: 91157, status: 'accepted', filedAt: '2026-10-30T16:30:00.000Z', byName: 'Staff Two' },
];
const HOSTILE = '<img src=x onerror=window.__xss=1>"\'><script>window.__xss=2</script></td><svg onload=window.__xss=3>';
const bizDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());

// run one of the two request screens from its real source; `names` are the functions under test
function screen(file, role, extraWin) {
  const win = Object.assign({ currentRole: role, currentDepts: ['Sales'], bizDate, renderEmptyState: (o) => `<div>${o.title}</div>`, skeletonHtml: () => '<div class="skeleton"></div>' }, extraWin || {});
  const c = vm.createContext({ window: win, emojiIcon: (g) => `[${g}]`, console, Notifs: { showToast() {} }, navigateTo() {} });
  vm.runInContext(escSrc, c);
  vm.runInContext(read('js/qr-def.js'), c);
  vm.runInContext(read(file), c);
  return { c, win };
}
const onclicks = (html) => [...html.matchAll(/onclick="([^"]*)"/g)].map((m) => m[1]);
const STRICT_OPEN = /^reopenQuoteFromDoc\('(bk_quotes|bs_quotes)','[A-Za-z0-9_-]{1,64}','(bk|bs)-quote-builder'\)$/;

for (const [label, file, fn, extra] of [
  ['Sales › Quote requests', 'js/screens/quote-requests.js', '_qrQuotesCardHtml', 'No quote yet — Open in Quote Builder.'],
  ['Sales › Briefs', 'js/screens/client-info-requests.js', '_cirQuotesCardHtml', 'No quote yet — Prefill Quote Builder.'],
]) {
  describe(`${label} — the Quotes card (spec §8.3)`, () => {
    const W = screen(file, 'president'), V = screen(file, 'secretary');
    const card = (S, quotes, canWrite) => { S.c.__doc = { quotes }; S.c.__w = canWrite; return vm.runInContext(`${fn}(__doc, __w)`, S.c); };

    it('empty: says there is no quote yet (and, for a writer, where to start); a field that is not a list is the same as none', () => {
      assert.ok(card(W, [], true).includes(extra));
      assert.ok(card(W, undefined, true).includes(extra));
      assert.ok(card(W, 'not-a-list', true).includes(extra));
      assert.ok(card(W, [null, 'x', 5], true).includes(extra), 'entries that are not objects are skipped');
      assert.ok(card(V, [], false).includes('No quote yet.') && !/Open in Quote Builder|Prefill/.test(card(V, [], false)));
    });
    it('lists the quotes NEWEST first: number, version, status pill, total, filed date in Manila time, and an Open that calls the existing opener', () => {
      const html = card(W, QUOTES, true);
      assert.match(html, /Quotes \(2\)/);
      const i2 = html.indexOf('BK-ML-WB-261028-001 (2)'), i1 = html.indexOf('>BK-ML-WB-261028-001<');
      assert.ok(i2 > 0 && i1 > i2, 'the later quote is listed first');
      assert.ok(html.includes('>v2<') && html.includes('>v1<'));
      assert.match(html, /badge-green">Accepted</); assert.match(html, /badge-blue">Filed</);
      assert.ok(html.includes('₱91,157') && html.includes('₱88,739'));
      assert.ok(html.includes('28 Oct 2026'));
      assert.ok(html.includes('31 Oct 2026'), 'the second quote was filed at 00:30 on 31 Oct in Manila (16:30 UTC on 30 Oct)');
      assert.ok(html.includes('Staff One') && html.includes('Staff Two'));
      assert.deepEqual(onclicks(html), [
        "reopenQuoteFromDoc('bk_quotes','qd00000000000000002','bk-quote-builder')", "reopenQuoteFromDoc('bk_quotes','qd00000000000000001','bk-quote-builder')",
      ]);
    });
    it('the view-only role sees the number, the status and the date — no total column, no Open', () => {
      const html = card(V, QUOTES, false);
      assert.ok(html.includes('BK-ML-WB-261028-001') && html.includes('Accepted') && html.includes('28 Oct 2026'));
      assert.ok(!/₱|Total|reopenQuoteFromDoc|>Open</.test(html), html);
      assert.ok(!/tc-actions|<th><\/th>/.test(html), 'no actions cell / header for a role that has no action');
      assert.deepEqual(onclicks(html), []);
    });
    it('every status has its pill; an unknown one is shown as plain grey text; a Brilliant Steel quote opens the BS builder', () => {
      const html = card(W, [
        { docId: 'a1', coll: 'bk_quotes', status: 'pending_approval' }, { docId: 'a2', coll: 'bk_quotes', status: 'needs_revision' },
        { docId: 'a3', coll: 'bs_quotes', status: 'who-knows' }, { docId: 'a4', coll: 'bk_quotes' },
      ], true);
      for (const l of ['Awaiting approval', 'Changes requested', 'who-knows', 'unknown']) assert.ok(html.includes(l), l);
      assert.ok(html.includes("reopenQuoteFromDoc('bs_quotes','a3','bs-quote-builder')"));
    });
    it('an entry with no usable total shows no amount at all (never "₱0")', () => {
      const html = card(W, [{ docId: 'ok1', coll: 'bk_quotes', quoteNumber: 'N1' }, { docId: 'ok2', coll: 'bk_quotes', quoteNumber: 'N2', total: null }, { docId: 'ok3', coll: 'bk_quotes', quoteNumber: 'N3', total: '' }, { docId: 'ok4', coll: 'bk_quotes', quoteNumber: 'N4', total: 'x' }], true);
      assert.ok(html.includes('N1') && html.includes('N4'));
      assert.ok(!/₱/.test(html), html);
    });
    it('a hostile entry is inert: text is escaped, and a collection / id that is not a plain quote collection / id gets NO Open (nothing reaches an inline handler)', () => {
      const html = card(W, [
        { docId: "x');alert(1);('", coll: 'bk_quotes', quoteNumber: HOSTILE, status: HOSTILE, byName: HOSTILE, filedAt: HOSTILE, total: '<b>1</b>', version: '<i>' },
        { docId: 'ok1', coll: 'users', quoteNumber: 'N1' }, { docId: 'ok2', coll: 'constructor', quoteNumber: 'N2' }, { docId: 'a/b', coll: 'bk_quotes', quoteNumber: 'N3' },
        { docId: 'ok3', coll: 'bk_quotes', quoteNumber: 'N4' },
      ], true);
      assert.ok(!/<img|<svg|<script/.test(html), 'a tag from an entry was parsed as markup');
      assert.ok(html.includes('&lt;img src=x onerror=window.__xss=1&gt;'));
      assert.deepEqual(onclicks(html), ["reopenQuoteFromDoc('bk_quotes','ok3','bk-quote-builder')"], 'only the one clean entry has an Open');
      for (const h of onclicks(html)) assert.match(h, STRICT_OPEN);
    });
  });
}

describe('Sales › Quote requests — the detail shows the Quotes card straight after the action card', () => {
  it('order: header, action buttons, Quotes, Request, Items, Estimate', () => {
    const S = screen('js/screens/quote-requests.js', 'president');
    const root = { innerHTML: '' };
    S.c.__root = root;
    vm.runInContext(`_qrContainer = __root; _qrCurrent = { id: '${QR}', status: 'quoted', contact: { name: 'Ana' }, intake: {}, estimate: {}, items: [], internal: {}, consent: {}, quotes: ${JSON.stringify(QUOTES)} }; _qrRenderDetail();`, S.c);
    const h = root.innerHTML;
    const at = (s) => h.indexOf(s);
    assert.ok(at('Open in Quote Builder') > 0 && at('Open in Quote Builder') < at('Quotes (2)') && at('Quotes (2)') < at('<h4 style="margin-top:0">Request</h4>') && at('<h4 style="margin-top:0">Request</h4>') < at('Items ('), h.slice(0, 300));
  });
  it('the view-only role gets the card without totals or Open', () => {
    const S = screen('js/screens/quote-requests.js', 'secretary');
    const root = { innerHTML: '' };
    S.c.__root = root;
    vm.runInContext(`_qrContainer = __root; _qrCurrent = { id: '${QR}', status: 'quoted', contact: {}, intake: {}, estimate: {}, items: [], internal: {}, consent: {}, quotes: ${JSON.stringify(QUOTES)} }; _qrRenderDetail();`, S.c);
    assert.ok(root.innerHTML.includes('Quotes (2)') && !/reopenQuoteFromDoc/.test(root.innerHTML));
  });
});

describe('Sales › Briefs — the "Quoted" status and the Quotes card in the detail', () => {
  const root = () => ({ innerHTML: '', querySelectorAll: () => [] });
  const open = (S, sub) => { const r = root(); S.c.__root = r; S.c.__sub = sub; vm.runInContext('_cirContainer = __root; _cirCurrent = __sub; _cirRenderDetail();', S.c); return r.innerHTML; };
  const brief = (over) => Object.assign({ id: CIR, status: 'quoted', formId: 'nope', summary: { name: 'Ana', company: 'Reyes' }, answers: {}, consent: {}, client: {}, quotes: QUOTES }, over || {});

  it('"Quoted" sits between Contacted and Converted in the status select, is selected when it is the status, and has its own pill', () => {
    const S = screen('js/screens/client-info-requests.js', 'president');
    const h = open(S, brief());
    const opts = [...h.matchAll(/<option value="([a-z_]+)"( selected)?>/g)].map((m) => m[1] + (m[2] ? '*' : ''));
    assert.deepEqual(opts, ['new', 'in_review', 'contacted', 'quoted*', 'converted', 'archived']);
    assert.ok(S.c.cirStatusPill('quoted').includes('Quoted') && /badge-teal/.test(S.c.cirStatusPill('quoted')));
    assert.ok(S.c.cirStatusPill('contacted').includes('Contacted'), 'the existing pills are unchanged');
  });
  it('the filter row counts Quoted briefs, between Contacted and Converted', () => {
    const S = screen('js/screens/client-info-requests.js', 'president', { chipTabs: (items) => JSON.stringify(items), bindChipTabs() {} });
    const row = { innerHTML: '' };
    S.c.document = { getElementById: (id) => (id === 'cir-filter-row' ? row : null) };
    S.c.__rows = [{ status: 'new' }, { status: 'quoted' }, { status: 'quoted' }, { status: 'converted' }, { status: 'weird' }];
    vm.runInContext('_cirRows = __rows; _cirPaintFilterRow();', S.c);
    const items = JSON.parse(row.innerHTML);
    assert.deepEqual(items.map((i) => i.key), ['all', 'new', 'in_review', 'contacted', 'quoted', 'converted', 'archived']);
    assert.deepEqual(items.map((i) => i.count), [5, 1, 0, 0, 2, 1, 0]);
    assert.deepEqual(items.find((i) => i.key === 'quoted'), { key: 'quoted', label: 'Quoted', count: 2 });
  });
  it('the detail shows the Quotes card straight after the action buttons and before the brief itself', () => {
    const h = open(screen('js/screens/client-info-requests.js', 'president'), brief());
    const at = (s) => h.indexOf(s);
    assert.ok(at('Prefill Quote Builder') > 0 && at('Prefill Quote Builder') < at('Quotes (2)') && at('Quotes (2)') < at('Project type'), h.slice(0, 400));
    assert.ok(h.includes('₱91,157') && h.includes('reopenQuoteFromDoc'));
  });
  it('the view-only role sees the card without totals or Open, and a brief with no quotes says so', () => {
    const v = open(screen('js/screens/client-info-requests.js', 'secretary'), brief());
    assert.ok(v.includes('Quotes (2)') && !/₱|reopenQuoteFromDoc/.test(v));
    assert.ok(open(screen('js/screens/client-info-requests.js', 'president'), brief({ quotes: undefined })).includes('No quote yet — Prefill Quote Builder.'));
  });
});
