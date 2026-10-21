// tests/family-page.test.mjs — js/quote-request.js: the page logic of the configurable product families, taken from the REAL source (functions are pulled out
// of the IIFE by name and run in a vm sandbox next to the REAL js/qr-def.js, js/qr-families.js and js/product-families.js and the REAL catalogue data island).
//
// What must hold (owner ruling 2026-10-21):
//   * A DRAFT is untrusted. A saved configured line is rebuilt from the family definition on load: name / category / unit from the family (never from storage),
//     config and size re-validated strictly (unknown family, key, value, type, off-step or out-of-range size, a violated width rule: the line is DROPPED and the
//     visitor is told), quantity and note re-cleaned, at most 40 lines, one product one multiplier.
//   * A draft saved by the PREVIOUS page (key barro-qr-draft-v1, plain SKU lines) is converted ONCE: a fixed item stays, a SKU a family absorbed becomes that
//     family at its closest configuration (a notice says so), anything else is dropped with the usual notice; the old key is removed, the new key written.
//     Every one of the 44 absorbed SKUs converts to a line the server accepts, whatever size the old line carried.
//   * A family counts as ONE product for the per-product unit cap (key family:<id>), exactly as the server counts it; whatever capUnits leaves, the server accepts.
//   * The payloads: a configured line is sent as { familyId, config, dims, qty, note } — nothing else; an ESTIMATE never carries the note; the basket key (the
//     estimate cache and the "did the basket change" test) ignores key order and note.
//
// Mutation-tested in scratch copies (see the commit message): trusting the stored name, dropping the strict re-validation, keying the cap on the SKU instead of the
// family, sending the note with an estimate, an order-sensitive basket key, converting an absorbed SKU without the size rules, and so on; each must fail here.
//
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Q = require('../functions/qr-core.js');
const QRN = require('../functions/qr-def.js');
const FAMS = require('../functions/qr-families.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const src = read('js/quote-request.js');
const island = JSON.parse(read('catalogue/index.html').match(/<script type="application\/json" id="qr-catalogue">([\s\S]*?)<\/script>/)[1]);
const { LIMITS } = QRN;
const json = (v) => JSON.parse(JSON.stringify(v));          // out of the vm realm and back: plain objects for assert / the server

// Pull a named function (brace-matched) out of the IIFE, so the REAL code is what is tested.
function grab(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found in js/quote-request.js`);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}
const line = (re) => { const m = src.match(re); assert.ok(m, `${re} not found in js/quote-request.js`); return m[0]; };

const NAMES = ['uid', 'clone', 'isObj', 'dimKeys', 'isRunProduct', 'maxDim', 'specDefault', 'defaultSize', 'defaultSpecs',
  'isFam', 'famById', 'famCustom', 'lineKey', 'unitsOf', 'unitKey', 'productUnits', 'capUnits',
  'freshDraft', 'ls', 'sanitizeItem', 'sanitizeFamilyItem', 'migrateV1Item', 'sanitizeText', 'loadDraft', 'saveDraftNow', 'clearDraft',
  'entityNow', 'basketKey', 'itemPayload', 'estimateItemPayload'];

function makePage(opts) {
  opts = opts || {};
  const store = new Map(Object.entries(opts.storage || {}));
  const win = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } } };
  const ctx = vm.createContext({ window: win, console, setTimeout, clearTimeout });
  for (const f of ['js/qr-def.js', 'js/qr-families.js', 'js/product-families.js']) vm.runInContext(read(f), ctx, { filename: f });
  const prelude = [
    'var D = window.QR_DEF, LIMITS = D.LIMITS, INTAKE = D.INTAKE;',
    'var PF = window.ProductFamilies, FAMS = window.QR_FAMILIES, famEnabled = ' + (opts.famEnabled === false ? 'false' : 'true') + ';',
    'var byId = Object.create(null); (' + JSON.stringify(island.products) + ').forEach(function (p) { byId[p.id] = p; });',
    line(/var DIMS = \[[^\]]*\];/),
    line(/var DRAFT_KEY = '[^']+';/),
    line(/var OLD_DRAFT_KEY = '[^']+';/),
    "var convertedLines = 0, pendingToast = '', saveTimer = 0, draft = null, holdStored = false;",
  ].join('\n');
  vm.runInContext(prelude + '\n' + NAMES.map(grab).join('\n') + '\ndraft = freshDraft();', ctx, { filename: 'quote-request.js (extract)' });
  const keys = { v2: ctx.DRAFT_KEY, v1: ctx.OLD_DRAFT_KEY };
  return { ctx, store, keys };
}
const GOOD_SINK = () => ({ uid: 'u-1', familyId: 'sink', config: { basins: 2, alignment: 'left', undershelf: true, upper: false, faucet: 'prerinse' }, dims: { W: 1800, D: 700, H: 900 }, qty: 3, note: 'near the door' });
const draftOf = (items, extra) => JSON.stringify(Object.assign({ v: 2, intake: null, intakeDone: false, contact: null, consent: null, items, startedAtMs: 1 }, extra || {}));
const loadV2 = (items, opts) => { const pg = makePage(opts); pg.store.set(pg.keys.v2, typeof items === 'string' ? items : draftOf(items)); pg.ctx.loadDraft(); return pg; };
const items = (pg) => json(pg.ctx.draft.items);

describe('the draft key and the helpers are the real ones', () => {
  it('the sandbox pulled the real storage keys, the real limits and the real island', () => {
    const pg = makePage();
    assert.equal(pg.keys.v2, 'barro-qr-draft-v2');
    assert.equal(pg.keys.v1, 'barro-qr-draft-v1');
    assert.equal(pg.ctx.LIMITS.maxQtyPerProduct, 20);
    assert.ok(island.products.length === 26, 'the island carries the 26 fixed items (the families are not cards of absorbed SKUs; the specialised items of Preparation, Washing and Storage are excluded)');
    assert.ok(island.products.every((p) => !FAMS.order.some((f) => Object.keys(FAMS.families[f].absorbed).includes(p.id))), 'no absorbed SKU is in the island');
  });
});

describe('a saved CONFIGURED line is rebuilt from the family definition, never trusted', () => {
  it('a good line survives intact; its name, category and unit come from the FAMILY, not from storage', () => {
    const stored = Object.assign(GOOD_SINK(), { name: '<img src=x onerror=1>', cat: 'EVIL', unit: 'EVIL', price: 5, extra: true });
    const pg = loadV2([stored]);
    const [it] = items(pg);
    assert.deepEqual(it, { uid: 'u-1', familyId: 'sink', name: FAMS.families.sink.label, cat: FAMS.families.sink.category, unit: FAMS.families.sink.unit || 'pc', config: GOOD_SINK().config, dims: { W: 1800, D: 700, H: 900 }, qty: 3, note: 'near the door' });
    assert.equal(pg.ctx.pendingToast, '');
  });
  it('an absent option takes the family default; the multi-select and the burner list come back in canonical order', () => {
    const pg = loadV2([
      { uid: 's', familyId: 'sink', config: { basins: 2 }, dims: { W: 1000 }, qty: 1 },
      { uid: 'k', familyId: 'stove', config: { positions: ['soup', 'wok'], addons: ['fryer', 'griller'] }, dims: { W: 1200 }, qty: 1 },
    ]);
    const [s, k] = items(pg);
    assert.equal(s.config.faucet, FAMS.families.sink.groups.find((g) => g.key === 'faucet').default);
    assert.deepEqual(s.dims, { W: 1000, D: 500, H: 850 });
    assert.deepEqual(k.config.positions, ['soup', 'wok'], 'burner order is the visitor\'s order and is kept');
    assert.deepEqual(k.config.addons, ['griller', 'fryer'], 'add-ons come back in the family\'s order');
  });
  it('a line the family no longer accepts is DROPPED and the visitor is told — unknown family, prototype names, wrong types, unknown keys, bad sizes, a violated width rule', () => {
    const g = GOOD_SINK;
    const protoCfg = JSON.parse('{"basins":2,"__proto__":{"x":1}}');
    const protoDims = JSON.parse('{"W":1800,"__proto__":{"x":1}}');
    const bad = {
      'unknown family': Object.assign(g(), { familyId: 'toaster' }),
      '__proto__ family': Object.assign(g(), { familyId: '__proto__' }),
      'constructor family': Object.assign(g(), { familyId: 'constructor' }),
      'hasOwnProperty family': Object.assign(g(), { familyId: 'hasOwnProperty' }),
      'numeric family': Object.assign(g(), { familyId: 7 }),
      'array family': Object.assign(g(), { familyId: ['sink'] }),
      'unknown config key': Object.assign(g(), { config: Object.assign(g().config, { colour: 'red' }) }),
      'basins out of range': Object.assign(g(), { config: Object.assign(g().config, { basins: 9 }) }),
      'basins as a string': Object.assign(g(), { config: Object.assign(g().config, { basins: '2' }) }),
      'boolean as a string': Object.assign(g(), { config: Object.assign(g().config, { undershelf: 'true' }) }),
      'own __proto__ in config': Object.assign(g(), { config: protoCfg }),
      'own __proto__ in dims': Object.assign(g(), { dims: protoDims }),
      'config not an object': Object.assign(g(), { config: 'basins=2' }),
      'dims below the minimum': Object.assign(g(), { dims: { W: 100, D: 700, H: 900 } }),
      'dims above the maximum': Object.assign(g(), { dims: { W: 99999, D: 700, H: 900 } }),
      'dims off the step': Object.assign(g(), { dims: { W: 1805, D: 700, H: 900 } }),
      'dims fractional': Object.assign(g(), { dims: { W: 1800.5, D: 700, H: 900 } }),
      'dims unknown axis': Object.assign(g(), { dims: { W: 1800, K: 5 } }),
      'dims not an object': Object.assign(g(), { dims: 'big' }),
      'width rule (3 sinks, 1200 mm)': Object.assign(g(), { config: Object.assign(g().config, { basins: 3 }), dims: { W: 1200, D: 700, H: 900 } }),
      'a plain SKU id that was absorbed': { uid: 'x', id: 'PW-004', qty: 1, size: null, specs: [] },
    };
    for (const [why, stored] of Object.entries(bad)) {
      const pg = loadV2(draftOf([stored]));
      assert.deepEqual(items(pg), [], `${why}: the line must be dropped`);
      assert.match(pg.ctx.pendingToast, /no longer in the catalogue/, `${why}: the visitor must be told`);
    }
  });
  it('one bad line does not lose the good ones, and the notice appears once', () => {
    const pg = loadV2([GOOD_SINK(), Object.assign(GOOD_SINK(), { uid: 'bad', familyId: 'toaster' }), Object.assign(GOOD_SINK(), { uid: 'u-3', qty: 2 })]);
    assert.deepEqual(items(pg).map((x) => x.uid), ['u-1', 'u-3']);
    assert.match(pg.ctx.pendingToast, /no longer in the catalogue/);
  });
  it('quantity is clamped to a whole number from 1 to 20 (a wild stored value becomes 1, never a huge multiplier); the note loses control characters and is cut at the limit', () => {
    for (const q of [0, -3, 1.5, 21, 1e9, 'x', null, NaN, Infinity]) {
      const pg = loadV2(draftOf([Object.assign(GOOD_SINK(), { qty: q })]));
      assert.equal(items(pg)[0].qty, 1, `qty ${String(q)}`);
    }
    const pg = loadV2([Object.assign(GOOD_SINK(), { note: '  hel\u0000lo\u0007 wor\nld ' + 'x'.repeat(500) })]);
    const note = items(pg)[0].note;
    assert.ok(!/[\u0000-\u001f\u007f]/.test(note));
    assert.ok(note.length <= LIMITS.maxNote);
    assert.ok(note.startsWith('hello world'));
  });
  it('a uid is kept but cut at 40 characters; a missing or non-string uid is replaced', () => {
    const pg = loadV2([Object.assign(GOOD_SINK(), { uid: 'a'.repeat(100) }), Object.assign(GOOD_SINK(), { uid: 7, qty: 1 })]);
    const [a, b] = items(pg);
    assert.equal(a.uid.length, 40);
    assert.equal(typeof b.uid, 'string');
    assert.ok(b.uid.length > 3);
  });
  it('at most 40 lines are read, and the per-product cap then applies (one family = one product)', () => {
    const many = Array.from({ length: 100 }, (_, i) => Object.assign(GOOD_SINK(), { uid: 'u' + i, qty: 1 }));
    const pg = loadV2(many);
    assert.equal(items(pg).length, 20, '100 stored lines -> first 40 read -> 20 units of one family kept');
    assert.match(pg.ctx.pendingToast, /reduced to the limit of 20 per product/);
  });
  it('with the family files missing, configured lines are HELD (not dropped, not overwritten): fixed lines still load, the visitor is told to reload, and nothing is written over the stored draft', () => {
    const fixedId = island.products[0].id;
    const stored = draftOf([GOOD_SINK(), { uid: 'f', id: fixedId, qty: 2, size: null, specs: [], note: '' }]);
    const pg = loadV2(stored, { famEnabled: false });
    assert.deepEqual(items(pg).map((x) => x.id || x.familyId), [fixedId]);
    assert.match(pg.ctx.pendingToast, /did not load/);
    assert.match(pg.ctx.pendingToast, /nothing has been lost/);
    assert.ok(!/no longer in the catalogue/.test(pg.ctx.pendingToast), 'a line on hold is not a removed line');
    pg.ctx.saveDraftNow();
    assert.equal(pg.store.get(pg.keys.v2), stored, 'the stored draft, configured line included, is untouched by a save');
    // the next load WITH the family files restores the held line
    const again = makePage({ storage: { [pg.keys.v2]: stored } });
    again.ctx.loadDraft();
    assert.deepEqual(items(again).map((x) => x.id || x.familyId), ['sink', fixedId]);
    assert.equal(again.ctx.pendingToast, '');
  });
  it('a draft with no configured line is saved as usual even when the family files are missing', () => {
    const fixedId = island.products[0].id;
    const pg = loadV2([{ uid: 'f', id: fixedId, qty: 2, size: null, specs: [], note: '' }], { famEnabled: false });
    assert.equal(pg.ctx.pendingToast, '');
    pg.ctx.draft.items[0].qty = 5;
    pg.ctx.saveDraftNow();
    assert.equal(JSON.parse(pg.store.get(pg.keys.v2)).items[0].qty, 5);
  });
  it('a stored line with a repeated uid gets a fresh one (a tampered draft cannot hold two lines with one id)', () => {
    const pg = loadV2([Object.assign(GOOD_SINK(), { uid: 'same', qty: 1 }), Object.assign(GOOD_SINK(), { uid: 'same', qty: 1 })]);
    const its = items(pg);
    assert.equal(its.length, 2);
    assert.notEqual(its[0].uid, its[1].uid);
  });
  it('a draft of the wrong version, or unreadable, is ignored (a fresh empty draft)', () => {
    for (const raw of ['{ nope', '[]', '"x"', 'null', JSON.stringify({ v: 1, items: [GOOD_SINK()] }), JSON.stringify({ v: 3, items: [GOOD_SINK()] }), JSON.stringify({ items: [GOOD_SINK()] })]) {
      const pg = loadV2(raw);
      assert.deepEqual(items(pg), [], String(raw).slice(0, 30));
    }
  });
  it('plain (fixed) lines are still rebuilt from the island: a stored name or size that is not valid does not survive', () => {
    const p = island.products.find((x) => x.dims && typeof x.dims.W === 'number');
    const pg = loadV2([{ uid: 'f', id: p.id, name: '<b>x</b>', qty: 2, size: { W: 1e9 }, specs: [], note: 'n' }]);
    const [it] = items(pg);
    assert.equal(it.name, p.name);
    assert.equal(it.size.W, p.dims.W, 'an absurd stored size falls back to the standard size');
    assert.equal(it.qty, 2);
  });
});

describe('a draft saved by the PREVIOUS page (barro-qr-draft-v1) is converted once', () => {
  const v1 = (itemsList) => JSON.stringify({ v: 1, intake: null, intakeDone: false, contact: null, consent: null, items: itemsList, startedAtMs: 1 });
  const loadV1 = (list) => { const pg = makePage(); pg.store.set(pg.keys.v1, v1(list)); pg.ctx.loadDraft(); return pg; };
  const absorbed = [];
  for (const f of FAMS.order) for (const sku of Object.keys(FAMS.families[f].absorbed)) absorbed.push([f, sku]);

  it('there are 44 absorbed SKUs and EVERY ONE converts to its own family at its configuration, valid, whatever size the old line carried', () => {
    assert.equal(absorbed.length, 44);
    const sizes = [null, { W: 1200, D: 600, H: 850 }, { W: 5, D: 5, H: 5 }, { W: 123, D: 7, H: 99999 }, { W: 3500, D: 900, H: 1000 }, 'x'];
    let n = 0;
    for (const [fid, sku] of absorbed) for (const size of sizes) {
      const pg = loadV1([{ uid: 'o', id: sku, qty: 2, size, runs: null, specs: [], note: 'kept' }]);
      const its = items(pg);
      assert.equal(its.length, 1, `${sku} ${JSON.stringify(size)}: the line must survive`);
      const it = its[0];
      assert.equal(it.familyId, fid, sku);
      assert.equal(it.qty, 2); assert.equal(it.note, 'kept');
      assert.equal(it.name, FAMS.families[fid].label);
      const PF = pg.ctx.PF;
      const v = PF.validateLine(pg.ctx.FAMS.families[fid], it.config, it.dims);
      assert.equal(v.ok, true, `${sku}: ${v.errors.join(' ')}`);
      assert.deepEqual(it.config, json(PF.validateConfiguration(pg.ctx.FAMS.families[fid], FAMS.families[fid].absorbed[sku]).config), `${sku}: the configuration is the absorbed one`);
      // and the SERVER accepts exactly this line
      const primaries = new Map(FAMS.order.map((f) => [f, { id: FAMS.families[f].primary }]));
      const wire = json([pg.ctx.itemPayload(it)]);
      const r = Q.normaliseItems(wire, new Map(), { families: FAMS, primaries });
      assert.equal(r.ok, true, `${sku}: the server refused the converted line: ${r.errors.join(' | ')}`);
      assert.equal(pg.ctx.convertedLines, 1);
      n++;
    }
    assert.equal(n, 44 * sizes.length);
  });
  it('the notice says the item is now configurable and to check it; the old key is REMOVED and the new key holds the converted v2 draft', () => {
    const pg = loadV1([{ uid: 'o', id: 'PW-008', qty: 1, size: null, specs: [], note: '' }]);
    assert.match(pg.ctx.pendingToast, /An item in your saved quote is now a configurable product/);
    assert.match(pg.ctx.pendingToast, /Please check it/);
    assert.equal(pg.store.has(pg.keys.v1), false, 'the legacy draft is removed');
    const saved = JSON.parse(pg.store.get(pg.keys.v2));
    assert.equal(saved.v, 2);
    assert.equal(saved.items.length, 1);
    assert.equal(saved.items[0].familyId, 'sink');
    assert.ok(!/price|₱/i.test(pg.store.get(pg.keys.v2)), 'a draft never holds a price');
  });
  it('two or more converted lines are counted in the notice', () => {
    const pg = loadV1([{ uid: 'a', id: 'PW-004', qty: 1 }, { uid: 'b', id: 'PW-001', qty: 1 }, { uid: 'c', id: 'CE-002', qty: 1 }]);
    assert.equal(pg.ctx.convertedLines, 3);
    assert.match(pg.ctx.pendingToast, /3 items in your saved quote are now configurable products/);
  });
  it('a saved faucet option is applied to the sink (Faucet Type on PW-004)', () => {
    const pg = loadV1([{ uid: 'a', id: 'PW-004', qty: 1, size: null, specs: [{ label: 'Faucet Type', value: 'Pre-rinse spray' }] }]);
    assert.equal(items(pg)[0].config.faucet, 'prerinse');
  });
  it('with the family files missing, an old line that only they could convert is HELD, the old key stays and no v2 key is written over it', () => {
    const fixedId = island.products[0].id;
    const stored = v1([{ uid: 'o', id: 'PW-001', qty: 1 }, { uid: 'f', id: fixedId, qty: 1, size: null, specs: [], note: '' }]);
    const pg = makePage({ famEnabled: false });
    pg.store.set(pg.keys.v1, stored);
    pg.ctx.loadDraft();
    assert.deepEqual(items(pg).map((x) => x.id || x.familyId), [fixedId]);
    assert.match(pg.ctx.pendingToast, /did not load/);
    assert.equal(pg.store.get(pg.keys.v1), stored, 'the old draft is still there for the next load');
    assert.equal(pg.store.has(pg.keys.v2), false);
    pg.ctx.saveDraftNow();
    assert.equal(pg.store.has(pg.keys.v2), false, 'a save while lines are on hold writes nothing');
    const again = makePage({ storage: { [pg.keys.v1]: stored } });
    again.ctx.loadDraft();
    assert.deepEqual(items(again).map((x) => x.id || x.familyId), ['prep_table', fixedId]);
    assert.equal(again.store.has(again.keys.v1), false, 'converted on the load that could do it: the old key goes');
  });
  it('ONE notice says everything that happened to the saved quote (converted, removed and reduced lines together, in plain sentences)', () => {
    const list = [{ uid: 'x', id: 'NOPE-1', qty: 1 }].concat(Array.from({ length: 12 }, (_, i) => ({ uid: 'u' + i, id: 'PW-001', qty: 4, size: null, specs: [] })));
    const pg = loadV1(list);
    const t = pg.ctx.pendingToast;
    assert.match(t, /now (a )?configurable product/);
    assert.match(t, /no longer in the catalogue/);
    assert.match(t, /reduced to the limit of 20 per product/);
    assert.match(t, /Please check (it|them) in your quote\.$/);
  });
  it('a FIXED item keeps its plain line (rebuilt from the island); an unknown or hostile id is dropped and the visitor is told (one combined notice)', () => {
    const fixedId = island.products[0].id;
    const pg = loadV1([{ uid: 'f', id: fixedId, qty: 3, size: null, specs: [], note: '' }, { uid: 'g', id: 'NOPE-1', qty: 1 }, { uid: 'h', id: '__proto__', qty: 1 }, { uid: 'i', id: 'constructor', qty: 1 }, { uid: 'j', id: 7, qty: 1 }, 'x', null, { uid: 'k', id: 'PW-001', qty: 1 }]);
    const its = items(pg);
    assert.deepEqual(its.map((x) => x.id || x.familyId), [fixedId, 'prep_table']);
    assert.equal(its[0].qty, 3);
    assert.match(pg.ctx.pendingToast, /no longer in the catalogue/);
  });
  it('OWNER RULING (b): a line for ANY excluded SKU (a specialised table, sink, cabinet, rack, the baking sheet pan, a service line ...) is DROPPED with the notice — in an old draft and in a current one — and never reaches the quote', () => {
    const excluded = Object.keys(JSON.parse(read('scripts/public-categories.json')).excludedProducts);
    assert.equal(excluded.length, 49);
    for (const id of excluded) {
      const old = loadV1([{ uid: 'o', id, qty: 2, size: null, specs: [], note: 'x' }]);
      assert.deepEqual(items(old), [], `${id}: an old-draft line must not survive`);
      assert.match(old.ctx.pendingToast, /no longer in the catalogue/, id);
      const cur = loadV2([{ uid: 'o', id, qty: 2, size: null, runs: null, specs: [], note: '' }]);
      assert.deepEqual(items(cur), [], `${id}: a current-draft line must not survive`);
      assert.match(cur.ctx.pendingToast, /no longer in the catalogue/, id);
    }
    // next to a convertible line the rest of the draft is untouched and ONE notice says both things
    const mixed = loadV1([{ uid: 'a', id: 'PW-011', qty: 1 }, { uid: 'b', id: 'PW-004', qty: 1 }, { uid: 'c', id: 'BA-008', qty: 1 }]);
    assert.deepEqual(items(mixed).map((x) => x.familyId), ['sink']);
    assert.match(mixed.ctx.pendingToast, /now a configurable product/);
    assert.match(mixed.ctx.pendingToast, /no longer in the catalogue/);
  });
  it('a converted line keeps the size the old line carried (rounded to the step, inside the limits); only a HARD rule or a forced minimum raises it', () => {
    const one = (id, size) => items(loadV1([{ uid: 'o', id, qty: 1, size, specs: [] }]))[0];
    // PW-001's old standard length 2438 is off the 10 mm step: kept, rounded
    assert.equal(one('PW-001', { W: 2438, D: 762, H: 851 }).dims.W, 2440);
    assert.equal(one('PW-001', { W: 2438, D: 762, H: 851 }).dims.D, 760);
    // beyond the family's limits: clamped, never refused
    assert.equal(one('PW-001', { W: 99999, D: 5, H: 600 }).dims.W, 6000);
    assert.equal(one('PW-001', { W: 99999, D: 5, H: 600 }).dims.D, 400);
    // a 2-sink table is never shorter than the HARD 500 mm per sink; a SOFT stove guidance only warns, so a shorter stove keeps its length
    assert.equal(one('PW-006', { W: 600, D: 500, H: 850 }).dims.W, 1000);
    assert.equal(one('CE-003', { W: 500, D: 700, H: 850 }).dims.W, 500);
    // the oven's forced minimums are applied (CE-014 is a stove with an oven)
    const oven = one('CE-014', { W: 1000, D: 500, H: 700 });
    assert.ok(oven.dims.D >= 700 && oven.dims.H >= 850);
  });
  it('when both keys exist the v2 draft wins and the legacy one is not converted over it', () => {
    const pg = makePage();
    pg.store.set(pg.keys.v2, draftOf([GOOD_SINK()]));
    pg.store.set(pg.keys.v1, v1([{ uid: 'o', id: 'PW-001', qty: 1 }]));
    pg.ctx.loadDraft();
    assert.deepEqual(items(pg).map((x) => x.familyId), ['sink']);
  });
  it('clearing the draft removes BOTH keys (a sent or discarded quote leaves nothing behind)', () => {
    const pg = makePage();
    pg.store.set(pg.keys.v2, draftOf([GOOD_SINK()]));
    pg.store.set(pg.keys.v1, v1([]));
    pg.ctx.clearDraft();
    assert.equal(pg.store.size, 0);
  });
  it('converted lines respect the per-family unit cap (many old table lines become one family bucket of 20)', () => {
    const pg = loadV1(Array.from({ length: 12 }, (_, i) => ({ uid: 'u' + i, id: 'PW-001', qty: 4, size: null, specs: [] })));
    const total = items(pg).reduce((n, x) => n + x.qty, 0);
    assert.equal(total, 20);
  });
});

describe('one product, ONE multiplier — a family is a single product for the unit cap, exactly as the server counts it', () => {
  const fl = (uid, fid, qty) => ({ uid, familyId: fid, config: FAMS.families[fid] ? json(require('../js/product-families.js').defaultConfig(FAMS.families[fid])) : {}, dims: json(require('../js/product-families.js').defaultDims(FAMS.families[fid])), qty, note: '' });
  const fx = (uid, id, qty) => ({ uid, id, qty, runs: null, size: null, specs: [] });
  const pg = makePage();
  const cap = (list) => json(pg.ctx.capUnits(json(list)));

  it('unitKey: family:<id> for a configured line, the SKU id for a fixed one', () => {
    assert.equal(pg.ctx.unitKey({ familyId: 'sink', id: 'PW-004' }), 'family:sink');
    assert.equal(pg.ctx.unitKey({ id: 'RF-003' }), 'RF-003');
  });
  it('lines of one family with different options share ONE cap of 20; the boundary line is trimmed, later lines dropped', () => {
    const out = cap([fl('a', 'sink', 12), fl('b', 'sink', 12), fl('c', 'sink', 5)]);
    assert.deepEqual(out.items.map((x) => [x.uid, x.qty]), [['a', 12], ['b', 8]]);
    assert.equal(out.dropped, 2);
  });
  it('another family, and a fixed SKU, have their OWN cap', () => {
    const out = cap([fl('a', 'sink', 20), fl('b', 'rack', 20), fx('c', 'S-FIX', 20), fl('d', 'sink', 1), fx('e', 'S-FIX', 1)]);
    assert.deepEqual(out.items.map((x) => x.uid), ['a', 'b', 'c']);
  });
  it('productUnits sums a family bucket across lines and can leave one line out (editing)', () => {
    pg.ctx.draft.items = json([fl('a', 'sink', 7), fl('b', 'sink', 5), fx('c', 'S-FIX', 9)]);
    assert.equal(pg.ctx.productUnits('family:sink'), 12);
    assert.equal(pg.ctx.productUnits('family:sink', 'a'), 5);
    assert.equal(pg.ctx.productUnits('S-FIX'), 9);
    assert.equal(pg.ctx.productUnits('family:rack'), 0);
    pg.ctx.draft.items = [];
  });
  it('whatever capUnits leaves, the SERVER accepts (random mixed baskets of configured and fixed lines)', () => {
    const synth = Q.buildProductIndex([
      { id: 'S-FIX', data: { title: 'Synthetic Table', category: 'prep_washing', unit: 'pc', basePrice: 4217, formulaType: 'fixed', measurement: { W: 900, D: 700, H: 850 }, formula: {}, specs: [] } },
      { id: 'S-NOD', data: { title: 'Synthetic Gadget', category: 'miscellaneous', unit: 'set', basePrice: 1111, formulaType: 'fixed', measurement: {}, formula: {}, specs: [] } },
    ], new Set(['S-FIX', 'S-NOD']));
    const primaries = new Map(FAMS.order.map((f) => [f, { id: FAMS.families[f].primary }]));
    let seed = 0x1234567;
    const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
    for (let t = 0; t < 300; t++) {
      const list = Array.from({ length: 1 + Math.floor(rnd() * 40) }, (_, i) => {
        const r = rnd();
        if (r < 0.2) return fx('f' + i, 'S-FIX', 1 + Math.floor(rnd() * 20));
        if (r < 0.3) return fx('g' + i, 'S-NOD', 1 + Math.floor(rnd() * 20));
        return fl('u' + i, FAMS.order[Math.floor(rnd() * FAMS.order.length)], 1 + Math.floor(rnd() * 20));
      });
      const out = cap(list);
      if (!out.items.length) continue;
      const wire = json(out.items.map(pg.ctx.itemPayload));
      const res = Q.normaliseItems(wire, synth, { families: FAMS, primaries });
      assert.equal(res.ok, true, `capUnits left a list the server refuses: ${res.errors.join(' | ')}`);
    }
  });
  it('and without the family-bucket rule the SAME lists would be refused: 40 lines of one family at 20 each is over the server cap', () => {
    const primaries = new Map(FAMS.order.map((f) => [f, { id: FAMS.families[f].primary }]));
    const wire = json(Array.from({ length: 3 }, (_, i) => pg.ctx.itemPayload(fl('u' + i, 'sink', 10))));
    const r = Q.normaliseItems(wire, new Map(), { families: FAMS, primaries });
    assert.equal(r.ok, false, '30 units of one family must be refused by the server');
  });
});

describe('what is SENT: a configured line carries exactly { familyId, config, dims, qty, note }; an estimate never carries the note', () => {
  const pg = makePage();
  const PFn = require('../js/product-families.js');
  const fam = FAMS.families.stove;
  const stove = () => ({ uid: 'k', familyId: 'stove', name: 'Stove', cat: 'Cooking', unit: 'pc', config: json(PFn.validateConfiguration(fam, { positions: ['wok', 'hp_large', 'soup'], addons: ['oven', 'fryer'] }).config), dims: { W: 1500, D: 700, H: 850 }, qty: 2, note: 'hello' });
  const fixed = () => ({ uid: 'f', id: 'RF-003', name: 'Chiller', cat: 'Refrigeration', unit: 'pc', qty: 1, size: { W: 1200 }, runs: null, specs: [{ label: 'Doors', value: 'Two' }], note: 'n' });

  it('submit payload: a configured line has exactly the five keys and nothing of the draft (no uid, name, category, unit)', () => {
    const p = json(pg.ctx.itemPayload(stove()));
    assert.deepEqual(Object.keys(p).sort(), ['config', 'dims', 'familyId', 'note', 'qty']);
    assert.equal(p.familyId, 'stove'); assert.equal(p.qty, 2); assert.equal(p.note, 'hello');
    assert.deepEqual(p.dims, { W: 1500, D: 700, H: 850 });
    assert.deepEqual(p.config.positions, ['wok', 'hp_large', 'soup']);
  });
  it('estimate payload: NO note, for either kind of line', () => {
    const p = json(pg.ctx.estimateItemPayload(stove()));
    assert.deepEqual(Object.keys(p).sort(), ['config', 'dims', 'familyId', 'qty']);
    const f = json(pg.ctx.estimateItemPayload(fixed()));
    assert.deepEqual(Object.keys(f).sort(), ['id', 'qty', 'runs', 'size', 'specs']);
  });
  it('a fixed line\'s submit payload is unchanged from before the families', () => {
    assert.deepEqual(Object.keys(json(pg.ctx.itemPayload(fixed()))).sort(), ['id', 'note', 'qty', 'runs', 'size', 'specs']);
  });
  it('the server accepts the payload of every family\'s default configuration (a visitor can always add the standard product)', () => {
    const primaries = new Map(FAMS.order.map((f) => [f, { id: FAMS.families[f].primary }]));
    for (const fid of FAMS.order) {
      const f = FAMS.families[fid];
      const it = { uid: 'x', familyId: fid, name: f.label, cat: f.category, unit: f.unit, config: json(PFn.defaultConfig(f)), dims: json(PFn.defaultDims(f)), qty: 1, note: '' };
      for (const payload of [pg.ctx.itemPayload(it), pg.ctx.estimateItemPayload(it)]) {
        const r = Q.normaliseItems(json([payload]), new Map(), { families: FAMS, primaries });
        assert.equal(r.ok, true, `${fid}: ${r.errors.join(' | ')}`);
        assert.equal(r.items[0].familyId, fid);
      }
    }
  });
  // a line as the page holds it: always passed through the strict validation (the configurator and the draft loader both do), so options are canonical
  const viaPage = (x) => json(pg.ctx.sanitizeFamilyItem(json(x)));
  it('the basket key (estimate cache) ignores the note and the uid, ignores key order and add-on order, and changes with any option, size or quantity', () => {
    const key = (list) => { pg.ctx.draft.items = json(list); return pg.ctx.basketKey(); };
    const base = key([stove()]);
    assert.equal(key([Object.assign(stove(), { note: 'a totally different note', uid: 'zzz' })]), base);
    const reordered = viaPage(Object.assign(stove(), { config: { addons: ['fryer', 'oven'], positions: stove().config.positions } }));
    assert.equal(key([reordered]), base, 'key order and add-on order do not matter once the line has been validated');
    for (const [what, change] of Object.entries({
      qty: (x) => { x.qty = 3; }, width: (x) => { x.dims.W = 1600; },
      'burner order': (x) => { x.config.positions = ['hp_large', 'wok', 'soup']; },
      'add-on': (x) => { x.config.addons = ['oven']; },
      'burner type': (x) => { x.config.positions = ['wok', 'hp_large', 'lp_small']; },
    })) {
      const x = stove(); change(x);
      assert.notEqual(key([x]), base, `${what} must change the key`);
    }
    // two lines in either order are one basket
    assert.equal(key([stove(), fixed()]), key([fixed(), stove()]));
    // the same options in a different basket entity are a different key
    pg.ctx.draft.intake = { entityType: 'government' };
    assert.notEqual(pg.ctx.basketKey().split('|')[0], base.split('|')[0]);
    pg.ctx.draft.intake = null; pg.ctx.draft.items = [];
  });
  it('lineKey (the duplicate-line test) treats the same options in a different key order as the same line, and different options as different lines', () => {
    const a = stove(); const b = viaPage(Object.assign(stove(), { config: { addons: ['fryer', 'oven'], positions: stove().config.positions } }));
    assert.equal(pg.ctx.lineKey(json(a)), pg.ctx.lineKey(b));
    const c = stove(); c.dims.W = 1600;
    assert.notEqual(pg.ctx.lineKey(json(a)), pg.ctx.lineKey(json(c)));
    assert.notEqual(pg.ctx.lineKey(json(a)), pg.ctx.lineKey(json(fixed())));
  });
});

describe('the page source — configurator guard rails that cannot be unit-tested in plain Node', () => {
  it('no markup is ever parsed, no inline style, no price vocabulary, no private collection or pricing engine is named', () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(code), 'markup injection or code evaluation crept in');
    // the CSP forbids inline style: nothing may set a style ATTRIBUTE (custom properties on the root through the CSSOM are fine and pre-existing)
    assert.ok(!/setAttribute\(\s*['"]style|\bstyle\s*:\s*['"]|\.style\.cssText|\.style\.[a-z]+\s*=[^=]/.test(code), 'an inline style crept in');
    assert.ok(!/product_pricing|PricingCore|priceConfiguredItem|basePrice|priceAdder|perW100/.test(src), 'the page must know nothing of pricing');
  });
  it('the configurator is wired from the data attribute the generated cards carry, and a family card opens it instead of the plain add sheet', () => {
    assert.match(src, /Configure & add/);
    assert.match(src, /function openConfigurator\(familyId, trigger, editUid, retReview\)/);
    assert.match(src, /data-family/);
  });
  it('the configurator edits through the same strict validation the server uses', () => {
    assert.match(src, /PF\.validateLine\(/);
    assert.match(src, /PF\.minWidth\(/);
    assert.match(src, /PF\.forcedMins\(/);
  });
  it('an Edit opened from the review goes BACK to the review however the sheet is left (both sheets), and a button marks the sheet as dealt with first', () => {
    const wired = src.match(/openSheet\('(item|configure)', trigger, retReview \? \{ onClose: function \(\) \{ if \(!finished\) openReview\(trigger\); \} \} : null\);/g) || [];
    assert.equal(wired.length, 2, 'the plain item sheet and the configurator both reopen the review when closed with x / Esc / the backdrop');
    assert.equal((src.match(/var finished = false;/g) || []).length, 2);
    assert.equal((src.match(/finished = true;\n\s+closeSheet\(!retReview\);\n\s+if \(retReview\) openReview\(trigger\);\n\s+toast\(existing \? 'Item updated\.' : 'Added to your quote\.'\);/g) || []).length, 2, 'Save/Add: flag, close, reopen the review, THEN toast (opening a sheet clears a toast)');
    assert.equal((src.match(/finished = true; closeSheet\(!retReview\); if \(retReview\) openReview\(trigger\);/g) || []).length, 2, 'Cancel');
  });
  it('the configurator: a length of the visitor\'s own is kept, the usual one follows the options; Reset and the "Custom size" tag use the usual size; an oven raises depth/height at once', () => {
    assert.match(src, /wTouched: !!existing && existing\.dims\.W !== usualW0/);
    assert.match(src, /st\.dims = PF\.standardDims\(fam, st\.config\); st\.wTouched = false;/);
    assert.match(src, /var std = PF\.standardDims\(fam, st\.config\);\n\s+var cust = axes\.some\(function \(k\) \{ return st\.dims\[k\] !== std\[k\]; \}\);/);
    assert.match(src, /var fm0 = PF\.forcedMins\(fam, st\.config\);/);
    assert.match(src, /function famCustom\(/);
    assert.match(grab('famCustom'), /PF\.standardDims\(/);
  });
  it('the configurator: a change hides the "already in your quote" prompt (it described the old selection); the picture is optional; the SELECTED option gets the first focus', () => {
    assert.match(src, /function changed\(\) \{ errBanner\.hidden = true; if \(dupeBox\) dupeBox\.hidden = true;/);
    assert.match(src, /var pv = PV \? PV\.create\(/);
    assert.match(src, /var firstRadio = f\.body\.querySelector\('\.qr-group input:checked'\) \|\| f\.body\.querySelector\('\.qr-group input'\);/);
  });
  it('the draft is stored under the v2 key and a v1 draft is read once and removed', () => {
    assert.match(src, /var DRAFT_KEY = 'barro-qr-draft-v2';/);
    assert.match(src, /if \(legacy && !holdStored\) \{ saveDraftNow\(\); ls\(function \(s\) \{ s\.removeItem\(OLD_DRAFT_KEY\); \}\); \}/);
  });
});
