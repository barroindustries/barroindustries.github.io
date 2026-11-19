// tests/rules-kc.test.mjs — firestore.rules: the two BK configurator blocks (kc_config, kc_materials) and the helper kcStaff().
//
// What the rules must keep saying (specs/BK-LIVE-INTEGRATION-SPEC-2026-11-19.md §3.2 / §3.3, packet 0):
//   * kc_config/{settings, list_prices}: every staff profile that may see prices reads it (kcStaff()); only the PRESIDENT writes, only those two doc ids,
//     the doc must say v == 1 and name the writer (updatedBy == auth.uid); settings also needs a markup between 1 and 10 and a floorMode of list / formula;
//     list_prices needs a `rows` map. Nobody deletes.
//   * kc_materials/{key}: same readers; the President and Purchasing write; the doc carries its own key (== the doc id, a-z 0-9 _ only, 1 to 40 chars),
//     a price that is null (no price yet, never 0) or a number >= 0, a `hist` list capped at 20, and updatedBy == auth.uid. Only the President deletes.
//   * Nothing else moved: material_prices, quote_costs and settings (the switch doc settings/quote_builder rides the existing settings rule) are byte-identical
//     to HEAD (sha256 pin). A deliberate change to one of them must update the pin here, in the same commit, after reading what the BK build needs from it.
//   * No new composite index (every kc read is a document get or a whole small collection).
//
// Textual pins (no Java here -> no emulator), compile-checked with `firebase deploy --only firestore:rules --dry-run`. Pure text, price-free.
// Mutation-tested in scratch copies (the mutants are listed in the packet 0 report): every pinned clause removed or loosened must fail this file.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const read = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');
const exists = (rel) => fs.existsSync(new URL('../' + rel, import.meta.url));
const RAW = read('firestore.rules');
const RULES = RAW.replace(/\/\/[^\n]*/g, '');
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

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
const block = (head) => blockOf(RULES, head);
/** Every `allow a, b: if <expr>;` of a block as { methods: [...], expr } (expr with the whitespace collapsed). */
function allows(blk) {
  return [...blk.matchAll(/allow\s+([a-z, ]+?)\s*:\s*if\s+([\s\S]*?);/g)].map((m) => ({
    methods: m[1].replace(/\s+/g, '').split(','),
    expr: norm(m[2]),
  }));
}
const allowFor = (blk, method) => {
  const hit = allows(blk).filter((a) => a.methods.includes(method));
  assert.equal(hit.length, 1, `expected exactly one allow statement for "${method}", found ${hit.length}`);
  return hit[0];
};
/** Brace depth of the rules text at a given index (all braces in the file come in pairs, including `{database}` and the regex quantifier). */
function depthAt(idx) {
  let d = 0;
  for (let i = 0; i < idx; i++) { if (RULES[i] === '{') d++; else if (RULES[i] === '}') d--; }
  return d;
}

const CONFIG = block('match /kc_config/{docId}');
const MATERIALS = block('match /kc_materials/{key}');

describe('kcStaff(): who may READ prices and settings', () => {
  const fn = RULES.match(/function kcStaff\(\)\s*\{\s*return ([^;]*);\s*\}/);
  it('is declared once, as a one-line return of OR-ed predicates', () => {
    assert.ok(fn, 'function kcStaff() { return ...; } not found');
    assert.equal(RULES.match(/function kcStaff\(/g).length, 1);
  });
  it('admits exactly: senior admins, finance, Sales writers (cirWriter), Purchasing and Production', () => {
    const parts = fn[1].split('||').map((s) => s.trim());
    assert.deepEqual(parts, ['isSeniorAdmin()', 'canFinance()', 'cirWriter()', 'isPurchasingDept()', 'isProductionDept()']);
  });
  it('has no unconditional escape', () => {
    assert.ok(!/\btrue\b/.test(fn[1]) && !/isAuth\(\)/.test(fn[1]), 'kcStaff() must not be open to every signed-in user');
  });
  it('the predicates it calls exist as functions in the file', () => {
    for (const p of ['isSeniorAdmin', 'canFinance', 'cirWriter', 'isPurchasingDept', 'isProductionDept', 'isNonNegNumber']) {
      assert.match(RULES, new RegExp(`function ${p}\\(`), `${p}() is not declared`);
    }
  });
});

describe('kc_config/{docId}: settings and list prices (President writes)', () => {
  it('has exactly three allow statements: read, create + update, delete', () => {
    assert.deepEqual(allows(CONFIG).map((a) => a.methods.join('+')), ['read', 'create+update', 'delete']);
  });
  it('read needs a signed-in profile and kcStaff()', () => {
    assert.equal(allowFor(CONFIG, 'read').expr, 'isAuth() && hasProfile() && kcStaff()');
  });
  const W = () => allowFor(CONFIG, 'update').expr;
  it('create and update are ONE statement, and need the President', () => {
    assert.deepEqual(allowFor(CONFIG, 'create'), allowFor(CONFIG, 'update'));
    assert.ok(W().startsWith("isAuth() && isPresident() && docId in ['settings', 'list_prices']"), W());
  });
  it("only the two doc ids 'settings' and 'list_prices'", () => {
    assert.equal(W().match(/docId in \[([^\]]*)\]/)[1], "'settings', 'list_prices'");
  });
  it('the doc says v == 1', () => assert.match(W(), /request\.resource\.data\.get\('v', 0\) == 1(?![0-9.])/));
  it('the doc names its writer: updatedBy == request.auth.uid', () => {
    assert.ok(W().includes("request.resource.data.get('updatedBy', '') == request.auth.uid"));
  });
  it('settings: markup is a number, at least 1 and at most 10', () => {
    assert.match(W(), /docId != 'settings' \|\| \(request\.resource\.data\.get\('markup', 0\) is number && request\.resource\.data\.markup >= 1 && request\.resource\.data\.markup <= 10(?![0-9.])/);
  });
  it("settings: floorMode is 'list' or 'formula'", () => {
    assert.ok(W().includes("request.resource.data.get('floorMode', 'list') in ['list', 'formula']"));
  });
  it('list_prices: rows is a map', () => {
    assert.ok(W().includes("docId != 'list_prices' || request.resource.data.get('rows', null) is map"));
  });
  it('nobody deletes', () => assert.equal(allowFor(CONFIG, 'delete').expr, 'false'));
  it('no blanket "write" or "true" rule', () => {
    assert.ok(!/allow\s+(write|read,\s*write)\b/.test(CONFIG) && !/\bif\s+true\b/.test(CONFIG));
  });
});

describe('kc_materials/{key}: the price list (President and Purchasing write)', () => {
  it('has exactly three allow statements: read, create + update, delete', () => {
    assert.deepEqual(allows(MATERIALS).map((a) => a.methods.join('+')), ['read', 'create+update', 'delete']);
  });
  it('read needs a signed-in profile and kcStaff()', () => {
    assert.equal(allowFor(MATERIALS, 'read').expr, 'isAuth() && hasProfile() && kcStaff()');
  });
  const W = () => allowFor(MATERIALS, 'update').expr;
  it('create and update are ONE statement', () => assert.deepEqual(allowFor(MATERIALS, 'create'), allowFor(MATERIALS, 'update')));
  it('write needs a profile and the President OR Purchasing (not kcStaff, not Production, not Finance)', () => {
    assert.ok(W().startsWith('isAuth() && hasProfile() && (isPresident() || isPurchasingDept())'), W());
    for (const wider of ['kcStaff()', 'isProductionDept()', 'canFinance()', 'isSeniorAdmin()', 'cirWriter()', 'isAdmin()']) {
      assert.ok(!W().includes(wider), `the write rule is wider than the President and Purchasing: ${wider}`);
    }
  });
  it('the doc carries its own key, equal to the doc id', () => {
    assert.ok(W().includes("request.resource.data.get('key', '') == key"));
  });
  it('the key is a-z, 0-9 and _ only, 1 to 40 characters', () => {
    assert.ok(W().includes("key.matches('^[a-z0-9_]{1,40}$')"));
  });
  it('p is null (no price: never 0) or a number >= 0', () => {
    assert.ok(W().includes("(request.resource.data.get('p', null) == null || isNonNegNumber(request.resource.data.p))"));
    assert.match(RULES, /function isNonNegNumber\(v\)\s*\{\s*return v is number && v >= 0;\s*\}/);
  });
  it('hist is a list of at most 20 entries', () => {
    assert.ok(W().includes("request.resource.data.get('hist', []) is list"));
    assert.match(W(), /request\.resource\.data\.get\('hist', \[\]\)\.size\(\) <= 20(?![0-9.])/);
  });
  it('the doc names its writer: updatedBy == request.auth.uid', () => {
    assert.ok(W().includes("request.resource.data.get('updatedBy', '') == request.auth.uid"));
  });
  it('delete is the President only', () => assert.equal(allowFor(MATERIALS, 'delete').expr, 'isAuth() && isPresident()'));
  it('no blanket "write" or "true" rule', () => {
    assert.ok(!/allow\s+(write|read,\s*write)\b/.test(MATERIALS) && !/\bif\s+true\b/.test(MATERIALS));
  });
});

describe('placement', () => {
  it('kcStaff() and both blocks sit in the same scope as the material_prices block, after it', () => {
    const mp = RULES.indexOf('match /material_prices/{docId}');
    const fnAt = RULES.indexOf('function kcStaff(');
    const cfgAt = RULES.indexOf('match /kc_config/{docId}');
    const matAt = RULES.indexOf('match /kc_materials/{key}');
    assert.ok(mp >= 0 && mp < fnAt && fnAt < cfgAt && cfgAt < matAt, 'order: material_prices, kcStaff, kc_config, kc_materials');
    assert.equal(depthAt(fnAt), depthAt(mp));
    assert.equal(depthAt(cfgAt), depthAt(mp));
    assert.equal(depthAt(matAt), depthAt(mp));
  });
  it('the two collections are matched once each, and nowhere else in the file', () => {
    assert.equal((RULES.match(/match \/kc_config\//g) || []).length, 1);
    assert.equal((RULES.match(/match \/kc_materials\//g) || []).length, 1);
    assert.ok(!/kc_(config|materials)/.test(RULES.replace(CONFIG, '').replace(MATERIALS, '')), 'another rule names a kc_ collection');
  });
  it('no composite index was added for them (every kc read is a document get or a whole small collection)', () => {
    assert.ok(!/kc_(config|materials)/.test(read('firestore.indexes.json')));
  });
});

describe('the blocks the build leans on did not move (sha256 of the block text at HEAD)', () => {
  // settings: the builder reads settings/quote_builder (any profile) and only the President writes it. quote_costs: the cost sidecar (the builder adds fields, no rule change).
  // material_prices: the old BOM type-ahead list, untouched. If one of these changes on purpose, re-pin it here and say why in the commit.
  const PIN = {
    'match /material_prices/{docId}': '16285b573bc55a56922299e2b2c69517c3484c7fb7f8abc6cf45bbf3d693070a',
    'match /quote_costs/{id}': '2426758c526b0b6ff08f90b27635a402e065e5b6783ef6fbca441e8de951b233',
    'match /settings/{docId}': '9e15d4fb4c33b496788707b55c38e48c04ac2841538639ae599050bd31408077',
  };
  for (const [head, want] of Object.entries(PIN)) {
    it(`${head} is byte-identical to HEAD`, () => assert.equal(sha(blockOf(RAW, head)), want));
  }
  it('the settings block still lets only the President write (the kcMode switch lives in settings/quote_builder)', () => {
    const s = blockOf(RAW, 'match /settings/{docId}');
    assert.match(s, /allow write: if isAuth\(\) && isPresident\(\);/);
    assert.match(s, /allow read: if isAuth\(\) && \(hasProfile\(\) \|\| docId == 'system'\);/);
  });
});

// The client side of the same contract. qb/kc-live.js is built by another packet; the checks run once it exists. A write that omits one of these is
// refused by the rules above with a bare permission-denied, which would read as "the price list will not save".
describe('qb/kc-live.js writes what the rules require (checked once the file exists)', () => {
  const skip = !exists('qb/kc-live.js');
  const src = () => read('qb/kc-live.js');
  it('names both collections', { skip }, () => {
    assert.match(src(), /kc_config/);
    assert.match(src(), /kc_materials/);
  });
  it('stamps updatedBy on what it writes', { skip }, () => assert.match(src(), /updatedBy\b/));
  it('writes v: 1 into the kc_config docs', { skip }, () => assert.match(src(), /\bv\s*:\s*1\b/));
  it('writes the doc id as `key` into the kc_materials docs', { skip }, () => assert.match(src(), /\bkey\b/));
  it('never deletes a kc_config doc', { skip }, () => assert.ok(!/kc_config[^;]{0,99}\.delete\(/.test(src())));
});
