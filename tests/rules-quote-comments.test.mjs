// tests/rules-quote-comments.test.mjs — firestore.rules: the `quote_comments` block (QUOTE-APPROVAL-LINK-SPEC-2026-11-20 §3.3 / §3.5), the approval thread of a quote.
//
// What the block must keep saying:
//   * One document per thread entry, in a top-level collection (D7: a resubmission creates a NEW quote doc, so a subcollection of the quote would strand the thread).
//   * READ needs a signed-in profile AND (an admin — president, manager, secretary — OR the entry's own `submitterUid`): a Sales user reads only the threads of quotes he sent,
//     and the list query that is provable under it carries the submitterUid filter (js/svc-approvals.js QuoteThread.list).
//   * CREATE: exactly the thirteen keys (hasOnly: the twelve and `lines`, QUOTE-PRESIDENT-FIGURES-SPEC 4.2) and the ten required ones (hasAll); the author is the caller and the time is the server's; the collection is one of the two quote
//     collections; threadKey is "<coll>_<rootQuoteId>"; ids and strings are bounded; a `comment` has text. Then ONE of two branches: the President (any of the four kinds, role
//     'president') or a non-President who IS the quote's creator (role 'sales', kinds comment / submitted only, and the quote doc named in the entry says createdBy == the caller).
//   * UPDATE is refused outright; DELETE is the President's (console use).
//   * The block sits after quote_costs (whose block is pinned byte for byte by tests/rules-kc.test.mjs and must not move) and before quote_templates; no composite index.
//   * What js/svc-approvals.js writes (QuoteThread.entry + createdAt) is exactly what the create rule accepts: no key the rule would refuse, none it requires missing.
//
// Textual pins (no Java here -> no emulator; the block is compile-checked with `firebase deploy --only firestore:rules --dry-run`, which the build session does not run). Pure text, price-free.
// QUOTE-PRESIDENT-FIGURES-SPEC-2026-11-20 mutation log (scratch copy of firestore.rules / js/svc-approvals.js, 2026-11-20; every one KILLED here): `lines` allowed for anyone / without its size bound / missing from hasOnly; the President's branch without kind
// 'figures'; the Sales branch without kind 'applied'; QuoteThread.entry writing `lines` for a Sales entry; its rows uncapped. (The bk_quotes / bs_quotes pins live in tests/quote-carry.test.mjs: figuresWriteOk prefix removed, figuresCarryOk arm removed,
// the direct-parent test removed — each KILLED.)
// Mutation-tested in scratch copies (listed in the commit message): every clause removed or loosened must fail this file.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const RAW = read('firestore.rules');
const RULES = RAW.replace(/\/\/[^\n]*/g, '');
const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** The text of `match <head> { ... }` (the header through its closing brace); the header must occur exactly once. */
function blockOf(src, head) {
  const at = src.indexOf(head);
  assert.ok(at >= 0, `block not found: ${head}`);
  assert.equal(src.indexOf(head, at + 1), -1, `block is not unique: ${head}`);
  const open = src.indexOf('{', at + head.length);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unbalanced: ' + head);
}
const BLOCK = blockOf(RULES, 'match /quote_comments/{id}');
/** Every `allow a, b: if <expr>;` of a block as { methods, expr }. */
const allows = (blk) => [...blk.matchAll(/allow\s+([a-z, ]+?)\s*:\s*if\s+([\s\S]*?);/g)].map((m) => ({ methods: m[1].replace(/\s+/g, '').split(','), expr: norm(m[2]) }));
const allowFor = (method) => {
  const hit = allows(BLOCK).filter((a) => a.methods.includes(method));
  assert.equal(hit.length, 1, `expected exactly one allow statement for "${method}", found ${hit.length}`);
  return hit[0].expr;
};
const CREATE = allowFor('create');
const listOf = (expr, fn) => { const m = new RegExp(`request\\.resource\\.data\\.keys\\(\\)\\.${fn}\\(\\[([^\\]]*)\\]\\)`).exec(expr); assert.ok(m, `${fn} list not found`); return m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')); };

const ONLY = ['threadKey', 'coll', 'quoteId', 'rootQuoteId', 'quoteNumber', 'kind', 'text', 'authorUid', 'authorName', 'authorRole', 'submitterUid', 'createdAt', 'lines'];
const ALL = ['threadKey', 'coll', 'quoteId', 'rootQuoteId', 'kind', 'text', 'authorUid', 'authorRole', 'submitterUid', 'createdAt'];

describe('quote_comments: the statements', () => {
  it('has exactly four allow statements: read, create, update, delete (and nothing else grants access)', () => {
    assert.deepEqual(allows(BLOCK).map((a) => a.methods.join('+')), ['read', 'create', 'update', 'delete']);
    assert.equal((BLOCK.match(/\ballow\b/g) || []).length, 4);
    assert.equal(/\bmatch\b[^{]*\{/.test(BLOCK.slice(BLOCK.indexOf('{') + 1)), false, 'no nested match block (a subcollection would stray from the thread key)');
  });
  it('update is refused outright', () => assert.equal(allowFor('update'), 'false'));
  it('delete is the President only (console use; the UI never deletes)', () => assert.equal(allowFor('delete'), 'isAuth() && isPresident()'));
});

describe('quote_comments: read', () => {
  const R = () => allowFor('read');
  it('needs a signed-in profile, and an admin or the entry\'s own submitter — nothing more open, nothing without a profile', () => {
    assert.equal(R(), "isAuth() && hasProfile() && (isAdmin() || resource.data.get('submitterUid', '') == request.auth.uid)");
  });
  it('isAdmin() is the three oversight roles (president, manager, secretary): the rule borrows it, it does not widen it', () => {
    assert.match(RULES, /function isAdmin\(\)\s*\{ return getRole\(\) in \['president', 'manager', 'secretary'\]; \}/);
    assert.match(RULES, /function isPresident\(\)\{ return getRole\(\) == 'president'; \}/);
  });
});

describe('quote_comments: create', () => {
  const E = () => CREATE;
  it('needs a signed-in profile first', () => assert.ok(E().startsWith('isAuth() && hasProfile() && ')));
  it('the key list: hasOnly the thirteen (the twelve + lines), hasAll the ten required (quoteNumber, authorName and lines may be absent)', () => {
    assert.deepEqual(listOf(E(), 'hasOnly'), ONLY);
    assert.deepEqual(listOf(E(), 'hasAll'), ALL);
    for (const k of ALL) assert.ok(ONLY.includes(k), k + ' is required but not allowed');
  });
  it('the author is the caller and the time is the server\'s', () => {
    assert.ok(E().includes('request.resource.data.authorUid == request.auth.uid'));
    assert.ok(E().includes('request.resource.data.createdAt == request.time'));
  });
  it('the collection is one of the two quote collections, and the quote and root ids are non-empty bounded strings', () => {
    assert.ok(E().includes("request.resource.data.coll in ['bk_quotes', 'bs_quotes']"));
    assert.ok(E().includes('isBoundedString(request.resource.data.quoteId, 128) && request.resource.data.quoteId.size() > 0'));
    assert.ok(E().includes('isBoundedString(request.resource.data.rootQuoteId, 128) && request.resource.data.rootQuoteId.size() > 0'));
  });
  it("the thread key is <coll>_<rootQuoteId> (an entry cannot be filed into another quote's thread)", () => {
    assert.ok(E().includes("request.resource.data.threadKey == request.resource.data.coll + '_' + request.resource.data.rootQuoteId"));
  });
  it('the text is bounded at 2000, the number at 80, the name at 120, the submitter uid at 128; a comment must have text', () => {
    assert.ok(E().includes('isBoundedString(request.resource.data.text, 2000)'));
    assert.ok(E().includes("isBoundedString(request.resource.data.get('quoteNumber', ''), 80)"));
    assert.ok(E().includes("isBoundedString(request.resource.data.get('authorName', ''), 120)"));
    assert.ok(E().includes('isBoundedString(request.resource.data.submitterUid, 128)'));
    assert.ok(E().includes("(request.resource.data.kind != 'comment' || request.resource.data.text.size() > 0)"));
  });
  it('QUOTE-PRESIDENT-FIGURES-SPEC 4.2: `lines` is optional, the President\'s alone, a list of at most 60 rows — and the clause sits BEFORE the text rule so the two branches stay the last thing in the expression', () => {
    assert.ok(E().includes("(!('lines' in request.resource.data) || (isPresident() && request.resource.data.lines is list && request.resource.data.lines.size() <= 60))"));
    assert.ok(E().indexOf("'lines' in request.resource.data") < E().indexOf("(request.resource.data.kind != 'comment'"), 'before the text rule');
    assert.equal(listOf(E(), 'hasAll').includes('lines'), false, 'never required');
  });
  it('then ONE of two author branches, and nothing after them', () => {
    const tail = E().slice(E().indexOf("(request.resource.data.kind != 'comment'"));
    const m = /^\(request\.resource\.data\.kind != 'comment' \|\| request\.resource\.data\.text\.size\(\) > 0\) && \( \((.*)\) \|\| \((.*)\) \)$/.exec(tail);
    assert.ok(m, 'the two branches are not the last thing in the create rule: ' + tail);
    const [, pres, sales] = m;
    // the President: his own role and any of the four kinds
    assert.equal(pres, "isPresident() && request.resource.data.authorRole == 'president' && request.resource.data.kind in ['comment', 'returned', 'approved', 'submitted', 'figures']");
    // everyone else: role 'sales', the entry's submitter is himself, the two kinds Sales may write, and the QUOTE named in the entry was created by him
    assert.equal(sales, "!isPresident() && request.resource.data.authorRole == 'sales' && request.resource.data.submitterUid == request.auth.uid && request.resource.data.kind in ['comment', 'submitted', 'applied'] && get(/databases/$(database)/documents/$(request.resource.data.coll)/$(request.resource.data.quoteId)).data.get('createdBy', '') == request.auth.uid");
  });
  it('a Sales entry can never be "returned" or "approved": those two kinds exist only in the President\'s branch', () => {
    const m = /\(!isPresident\(\)[\s\S]*$/.exec(CREATE);
    assert.ok(m);
    assert.equal(/'returned'|'approved'/.test(m[0]), false);
  });
});

describe('quote_comments: placement and the neighbours', () => {
  it('sits AFTER quote_costs and BEFORE quote_templates, inside the same match /databases block', () => {
    const at = (head) => RAW.indexOf(head);
    assert.ok(at('match /quote_costs/{id}') > 0 && at('match /quote_comments/{id}') > at('match /quote_costs/{id}') && at('match /quote_comments/{id}') < at('match /quote_templates/{id}'));
    const costsEnd = RAW.indexOf('\n    }\n', at('match /quote_costs/{id}')) + 7;
    assert.equal(RAW.slice(costsEnd, at('match /quote_comments/{id}')).replace(/\s+/g, ' ').replace(/\/\/[^\n]*/g, '').trim(), '', 'nothing but a comment between quote_costs and quote_comments');
  });
  it('the other quote blocks are untouched by this feature: bk_quotes / bs_quotes / quote_costs / approval_requests / notifications each still carry their own statements', () => {
    for (const head of ['match /bk_quotes/{docId}', 'match /bs_quotes/{docId}', 'match /quote_costs/{id}', 'match /approval_requests/{docId}', 'match /notifications/{uid}/{document=**}']) assert.ok(blockOf(RULES, head).length > 100, head);
    assert.equal((RULES.match(/quote_comments/g) || []).length, 1, 'no other block refers to the thread');
  });
  it('no composite index: two equality filters (threadKey, submitterUid) need none', () => {
    assert.ok(!/quote_comments/.test(read('firestore.indexes.json')));
  });
  it('the file is still far under the rules size cap (this adds under 3 KB)', () => {
    assert.ok(Buffer.byteLength(RAW) < 262144 * 0.8, 'firestore.rules is within 80% of the 262,144-byte cap');
    assert.ok(Buffer.byteLength(BLOCK) < 2700, 'the block is small');
  });
});

describe('what the client writes is what the rule accepts (js/svc-approvals.js QuoteThread)', () => {
  const SRC = read('js/svc-approvals.js');
  const piece = SRC.match(/^window\.QuoteThread = \{[\s\S]*?\n\};/m);
  assert.ok(piece, 'window.QuoteThread not found in js/svc-approvals.js');
  const ctx = vm.createContext({ window: {}, console });
  vm.runInContext(piece[0], ctx);
  const QT = ctx.window.QuoteThread;
  const plain = (x) => JSON.parse(JSON.stringify(x));
  const entry = (kind, over) => plain(QT.entry(Object.assign({ coll: 'bk_quotes', quoteId: 'qd00000000000000001', q: { createdBy: 'u-agent', rootQuoteId: 'qd00000000000000000', quoteNumber: 'BK-X-1' }, kind, text: 'hello', uid: 'u-pres', name: 'The President', role: 'president' }, over || {})));

  it('an entry has the rule\'s keys: every written key is allowed (+ createdAt), every required key is there', () => {
    for (const kind of ['comment', 'returned', 'approved', 'submitted', 'figures', 'applied']) {
      const keys = Object.keys(entry(kind)).concat(['createdAt']);
      for (const k of keys) assert.ok(ONLY.includes(k), `${kind}: ${k} is not on the hasOnly list`);
      for (const k of ALL) assert.ok(keys.includes(k), `${kind}: ${k} is required and missing`);
    }
  });
  it('an entry with rows adds exactly the one key `lines` (the rule allows it), only for the President; a Sales entry never carries it, whatever it is handed', () => {
    const rows = [{ i: 1, name: 'Sink', from: 100, to: 90, note: 'ok', extra: 'x' }, { i: 2, name: 'Rack', from: 5, to: null, note: 'wrong colour' }, { i: 3 }];
    const e = entry('figures', { lines: rows });
    assert.ok(ONLY.includes('lines') && 'lines' in e);
    for (const k of Object.keys(e).concat(['createdAt'])) assert.ok(ONLY.includes(k), k);
    assert.deepEqual(e.lines, [{ i: 1, name: 'Sink', from: 100, to: 90, note: 'ok' }, { i: 2, name: 'Rack', from: 5, to: null, note: 'wrong colour' }], 'the row keys are exactly the rule-independent five; an empty row is dropped');
    assert.equal('lines' in entry('comment'), false, 'no rows, no key');
    assert.equal('lines' in entry('applied', { role: 'sales', lines: rows }), false, 'the Sales role never writes lines');
    assert.equal(entry('figures', { lines: Array.from({ length: 90 }, (_, k) => ({ i: k, to: 1 })) }).lines.length, 60, 'at most 60 (the rule\'s bound)');
    assert.equal('lines' in entry('figures', { lines: [{ i: 1 }, null, 'x'] }), false);
  });
  it('the preview of an entry is its text, else "Prices on N lines" / "Notes on N lines" (never an amount)', () => {
    assert.equal(QT.preview({ text: 'hello' }), 'hello');
    assert.equal(QT.preview({ text: '', lines: [{ to: 5 }, { to: 6 }, { to: null, note: 'x' }] }), 'Prices on 2 lines');
    assert.equal(QT.preview({ text: '', lines: [{ to: 5 }] }), 'Prices on 1 line');
    assert.equal(QT.preview({ text: '', lines: [{ to: null, note: 'a' }, { to: null, note: 'b' }] }), 'Notes on 2 lines');
    assert.equal(QT.preview({ text: '' }), '');
    assert.equal(QT.preview({ text: 'y'.repeat(300) }).length, 200);
  });
  it('the thread key equation holds for an entry on a revision (root differs from the quote) and on a first filing (root is the quote itself)', () => {
    const rev = entry('comment'); assert.equal(rev.threadKey, rev.coll + '_' + rev.rootQuoteId);
    const first = entry('comment', { q: { createdBy: 'u-agent' } }); assert.equal(first.rootQuoteId, first.quoteId); assert.equal(first.threadKey, 'bk_quotes_' + first.quoteId);
  });
  it('the bounds: text 2000, quote number 80, author name 120 — cut here, so the rule never refuses a long one', () => {
    const e = entry('comment', { text: 'x'.repeat(5000), name: 'n'.repeat(500), q: { createdBy: 'u', quoteNumber: 'q'.repeat(300) } });
    assert.deepEqual([e.text.length, e.authorName.length, e.quoteNumber.length], [2000, 120, 80]);
  });
  it('the role is "president" or "sales" only, and the submitter is the quote\'s creator (what the Sales branch compares with his own uid)', () => {
    assert.equal(entry('comment').authorRole, 'president');
    for (const role of ['employee', 'manager', 'secretary', 'finance', 'agent', undefined, '']) assert.equal(entry('comment', { role }).authorRole, 'sales', String(role));
    assert.equal(entry('comment').submitterUid, 'u-agent');
  });
  it('the writer adds createdAt as a server timestamp (the rule demands createdAt == request.time) and writes nothing else', () => {
    const add = SRC.slice(SRC.indexOf('async add(o)'), SRC.indexOf('async list('));
    assert.match(add, /\.add\(\{ \.\.\.e, createdAt: FV\.serverTimestamp\(\) \}\)/);
    assert.equal((add.match(/collection\('quote_comments'\)\.add\(/g) || []).length, 1);
  });
  it('the reader\'s query is provable under the read rule: the whole chain for an admin, only own entries (submitterUid filter) for anyone else', () => {
    const list = SRC.slice(SRC.indexOf('async list('));
    assert.match(list, /where\('threadKey', '==', /);
    assert.match(list, /\['president', 'manager', 'secretary'\]\.indexOf\(currentRole\) < 0\) ref = ref\.where\('submitterUid', '==', currentUser\.uid\)/);
    assert.equal(/orderBy/.test(list), false, 'no orderBy: the sort is done here, so no composite index is needed');
  });
});
