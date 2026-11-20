// tests/sales-kpi-rules.test.mjs — firestore.rules: the `sales_kpi/{uid}` and `client_ratings/{projectId}` blocks
// (specs/SALES-MANAGER-KPI-SPEC-2026-11-20.md §7, rollout step 1: RULES FIRST — they land before the code that needs them).
//
// What the blocks must keep saying:
//   * sales_kpi/{uid} — who gets a Sales KPI, its start month and targets. READ by the person it is about, the President and the books tier (canFinance);
//     WRITE by the President alone. It is deliberately NOT kpi_targets, which any admin writes.
//   * client_ratings/{projectId} — one rating per job (the doc id is the project id). READ by the President, the books tier and the salesperson the doc names
//     (salesUid); CREATE / UPDATE by the President alone, and only with a whole number of stars from 1 to 5; DELETE by the President alone.
//   * Nobody else writes either collection: not Sales, not Finance, not a manager, not the person whose KPI it is.
//   * The helpers they use exist in the rules with the meaning the blocks assume (isAuth, isOwner, isPresident, canFinance).
//   * The blocks sit beside kpi_targets, NOT after payment_claims (tests/payment-claims-rules.test.mjs pins that block as the last one in the file);
//     they stay under the CHECK 8 size warning line; their comments are single lines; no composite index was added (the spec needs none).
//
// Textual pins parsed from the real firestore.rules (no Java here, so no emulator; the blocks are compile-checked by `firebase deploy --only firestore:rules`).
// Mutation-tested in scratch copies (listed in the hand-back that came with this file): every clause removed or loosened must fail this file.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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
/** Every `allow a, b: if <expr>;` of a block as { methods, expr }. */
const allows = (blk) => [...blk.matchAll(/allow\s+([a-z, ]+?)\s*:\s*if\s+([\s\S]*?);/g)].map((m) => ({ methods: m[1].replace(/\s+/g, '').split(','), expr: norm(m[2]) }));
const exprFor = (blk, methods) => {
  const hit = allows(blk).filter((a) => a.methods.join('+') === methods);
  assert.equal(hit.length, 1, `expected exactly one allow statement for "${methods}", found ${hit.length}`);
  return hit[0].expr;
};

const KPI = blockOf(RULES, 'match /sales_kpi/{uid}');
const RAT = blockOf(RULES, 'match /client_ratings/{projectId}');

describe('sales_kpi/{uid}: the statements', () => {
  it('has exactly two allow statements — read and write — and nothing else grants access', () => {
    assert.deepEqual(allows(KPI).map((a) => a.methods.join('+')), ['read', 'write']);
    assert.equal((KPI.match(/\ballow\b/g) || []).length, 2);
    assert.equal(/\bmatch\b[^{]*\{/.test(KPI.slice(KPI.indexOf('{') + 1)), false, 'no nested match block');
  });
  it('read: signed in, and the person it is about, the President or the books tier', () => {
    assert.equal(exprFor(KPI, 'read'), 'isAuth() && (isOwner(uid) || isPresident() || canFinance())');
  });
  it('write: the President alone — not the person, not Finance, not a manager, not "any admin" (that is kpi_targets)', () => {
    const w = exprFor(KPI, 'write');
    assert.equal(w, 'isAuth() && isPresident()');
    for (const banned of ['isOwner', 'canFinance', 'isAdmin', 'isSeniorAdmin', 'isMoneyAdmin', 'isOpsAdmin', 'hasProfile', 'inDept']) assert.ok(!w.includes(banned), `write must not mention ${banned}`);
  });
  it('the owner read is the document id matching the caller (isOwner(uid)), so Uriel reads only his own', () => {
    assert.ok(/match \/sales_kpi\/\{uid\}/.test(KPI));
    assert.match(RULES, /function isOwner\(uid\)\s*\{ return request\.auth\.uid == uid; \}/);
  });
});

describe('client_ratings/{projectId}: the statements', () => {
  it('has exactly three allow statements: read, create+update, delete', () => {
    assert.deepEqual(allows(RAT).map((a) => a.methods.join('+')), ['read', 'create+update', 'delete']);
    assert.equal((RAT.match(/\ballow\b/g) || []).length, 3);
    assert.equal(/\bmatch\b[^{]*\{/.test(RAT.slice(RAT.indexOf('{') + 1)), false, 'no nested match block');
  });
  it('read: the President, the books tier, or the salesperson the rating names (salesUid)', () => {
    assert.equal(exprFor(RAT, 'read'), "isAuth() && (isPresident() || canFinance() || resource.data.get('salesUid', '') == request.auth.uid)");
  });
  it('read: nobody with a mere profile reads ratings — no hasProfile(), no isAdmin() (the Corporate Secretary stays out)', () => {
    const r = exprFor(RAT, 'read');
    for (const banned of ['hasProfile', 'isAdmin', 'inDept', 'isSecretary']) assert.ok(!r.includes(banned), `read must not mention ${banned}`);
  });
  it('create and update: the President alone, with a whole number of stars from 1 to 5', () => {
    assert.equal(exprFor(RAT, 'create+update'),
      'isAuth() && isPresident() && request.resource.data.stars is int && request.resource.data.stars >= 1 && request.resource.data.stars <= 5');
  });
  it('delete: the President alone', () => {
    assert.equal(exprFor(RAT, 'delete'), 'isAuth() && isPresident()');
  });
  it('the salesperson can read their ratings but never write one: every write statement is President-only', () => {
    for (const m of ['create+update', 'delete']) {
      const e = exprFor(RAT, m);
      assert.ok(e.includes('isPresident()'));
      for (const banned of ['salesUid', 'isOwner', 'canFinance', 'hasProfile']) assert.ok(!e.includes(banned), `${m} must not mention ${banned}`);
    }
  });
});

describe('the helpers the blocks rely on mean what they assume', () => {
  it('isAuth, isOwner, isPresident and canFinance exist, once each', () => {
    for (const re of [/function isAuth\(\)\s*\{ return request\.auth != null; \}/, /function isOwner\(uid\)\s*\{ return request\.auth\.uid == uid; \}/, /function isPresident\(\)\{ return getRole\(\) == 'president'; \}/, /function canFinance\(\) \{ return isMoneyAdmin\(\) \|\| isFinanceDept\(\); \}/]) {
      assert.equal((RULES.match(new RegExp(re.source, 'g')) || []).length, 1, String(re));
    }
  });
  it('canFinance is the money tier (president, manager, finance) or a Finance-department member who is not the Corporate Secretary', () => {
    assert.match(RULES, /function isMoneyAdmin\(\)\s*\{ return getRole\(\) in \['president', 'manager', 'finance'\]; \}/);
    const fd = blockOf(RULES, 'function isFinanceDept()');
    assert.ok(norm(fd).includes("u.get('role', null) != 'secretary'"));
  });
});

describe('placement, size and neighbours', () => {
  it('both blocks sit right after kpi_targets and before settings, inside the same databases block', () => {
    const at = (head) => RAW.indexOf(head);
    assert.ok(at('match /kpi_targets/{uid}') > 0);
    assert.ok(at('match /kpi_targets/{uid}') < at('match /sales_kpi/{uid}'));
    assert.ok(at('match /sales_kpi/{uid}') < at('match /client_ratings/{projectId}'));
    assert.ok(at('match /client_ratings/{projectId}') < at('match /settings/{docId}'));
    const between = RULES.slice(RULES.indexOf('match /kpi_targets/{uid}'), RULES.indexOf('match /settings/{docId}'));
    assert.deepEqual([...between.matchAll(/match\s+\/([A-Za-z_]+)\//g)].map((m) => m[1]), ['kpi_targets', 'sales_kpi', 'client_ratings']);
  });
  it('payment_claims is still the LAST block of the file apart from the Phase 5 blocks that follow it (tests/phase5-rules.test.mjs), so nothing of the KPI was appended after it', () => {
    // Phase 5 (change_orders … job_money) is appended after payment_claims, still at the end of the section.
    assert.match(norm(RULES.slice(RULES.indexOf('match /job_money/{id}'))), /\} \} \}$/);
    assert.deepEqual([...RULES.slice(RULES.indexOf('match /payment_claims/{id}')).matchAll(/match\s+\/([A-Za-z_]+)\//g)].map((m) => m[1]), ['payment_claims', 'change_orders', 'change_requests', 'site_visits', 'job_money']);
  });
  it('kpi_targets is untouched: the owner and any admin read, any admin writes — which is exactly why the Sales KPI does not live there', () => {
    const kt = blockOf(RULES, 'match /kpi_targets/{uid}');
    assert.equal(exprFor(kt, 'read'), 'isAuth() && (isOwner(uid) || isAdmin())');
    assert.equal(exprFor(kt, 'write'), 'isAuth() && isAdmin()');
  });
  it('each collection is declared once in the whole file', () => {
    assert.equal((RULES.match(/match \/sales_kpi\//g) || []).length, 1);
    assert.equal((RULES.match(/match \/client_ratings\//g) || []).length, 1);
  });
  it('the comments in the blocks are single lines (CHECK 8 keeps narrative out of the rules) and the file stays under the size warning line', () => {
    const at = RAW.indexOf('// Sales Manager KPI (SALES-MANAGER-KPI-SPEC');
    assert.ok(at > 0);
    const end = RAW.indexOf('match /settings/{docId}', at);
    const region = RAW.slice(at, end);
    assert.ok(!/^\s*\/\*/m.test(region), 'no block comments');
    assert.ok(!/\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*(allow|match) /.test(region), 'no stacked comment paragraphs');
    assert.ok(Buffer.byteLength(RAW) < 262144 * 0.8, 'rules stay under the CHECK 8 warning line');
  });
  it('no composite index is needed or added: the queries are single-field (status ==, salesUid ==) and the doc ids are the keys', () => {
    const idx = JSON.parse(read('firestore.indexes.json')).indexes;
    assert.equal(idx.filter((i) => ['sales_kpi', 'client_ratings'].includes(i.collectionGroup)).length, 0);
  });
});
