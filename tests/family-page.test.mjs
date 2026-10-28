// tests/family-page.test.mjs — js/quote-request.js: the page logic of the configurable product families, taken from the REAL source (functions are pulled out
// of the IIFE by name and run in a vm sandbox next to the REAL js/qr-def.js, js/qr-families.js and js/product-families.js and the REAL catalogue data island).
//
// What must hold (owner ruling 2026-10-21):
//   * A DRAFT is untrusted. A saved configured line is rebuilt from the family definition on load: name / category / unit from the family (never from storage),
//     config and size re-validated strictly (unknown family, key, value, type, off-step or out-of-range size, a violated width rule: the line is DROPPED and the
//     visitor is told), quantity and note re-cleaned, at most 40 lines, one product one multiplier.
//   * A draft saved by the PREVIOUS page (key barro-qr-draft-v1, plain SKU lines) is converted ONCE: a fixed item stays, a SKU a family absorbed becomes that
//     family at its closest configuration (a notice says so), anything else is dropped with the usual notice; the old key is removed, the new key written.
//     Every one of the 64 absorbed SKUs (eleven families) converts to a line the server accepts, whatever size the old line carried.
//   * A family counts as ONE product for the per-product unit cap (key family:<id>), exactly as the server counts it; whatever capUnits leaves, the server accepts.
//   * The payloads: a configured line is sent as { familyId, config, dims, qty, note } — nothing else; an ESTIMATE never carries the note; the basket key (the
//     estimate cache and the "did the basket change" test) ignores key order and note.
//   * STANDARD CONSTRUCTION (owner ruling 2026-10-28): the configurator sheet offers the PUBLIC groups only (PF.publicGroups) — there is no control for the staff-only 1.2 mm top
//     plate — and shows a read-only "Construction: …" line instead; the staff-only key is never held in a line or the stored draft and never sent (the server fills in the
//     standard 1.5 mm top); a stored line that asks for the lighter top is dropped. The sheet is run for real (the REAL openConfigurator in a tiny fake DOM).
//   * CONDITIONAL OPTIONS (CONFIGURATOR-FAMILIES-2-SPEC §4, five families added 2026-10-28): a group with `when` (fry baskets for a fryer, a pre-rinse sink on the soiled side of a dish
//     table) is in the sheet but HIDDEN until it applies and snaps back to its standard value the moment it stops applying, so whatever the sheet builds is a line the server
//     accepts; an option can force a size limit (a slim hood is at most 500 mm deep, a deck oven's width follows its trays): a size the visitor has not typed follows the options,
//     one they typed is moved to the limit at once, and the hint says so. The burner list is still edited in place (a write-back that replaced it would lose edits).
//
// Mutation-tested in scratch copies (see the commit message): trusting the stored name, dropping the strict re-validation, keying the cap on the SKU instead of the
// family, sending the note with an estimate, an order-sensitive basket key, converting an absorbed SKU without the size rules, and so on; each must fail here.
//
// WS-3 (CONFIGURATOR-FAMILIES-2, 2026-10-28) — mutation-tested in scratch copies of the whole tree; each of these was KILLED by at least one test here:
//   a conditional group never hidden / hidden by the inverted rule / hidden once and never shown again; a group that stopped applying keeping its non-standard value (no snap), the snap skipped on
//   a change or at the opening, the snap replacing the WHOLE configuration (the burner list then edited as a stale copy); a forced maximum not applied to a typed size; a size nobody typed not
//   following the options (every size, or only the length); a forced minimum on the length ignored; the hard length rule not raising a typed length; the size hint ignoring the maximum / saying
//   "at least" for it / losing the one-value wording; the size field not following the limits (min / max) or not read-only when only one value is possible; typing not marking a size as the
//   visitor's own; a saved line's own size not recognised; Reset not handing the sizes back to the options; a size not shown in its field after the options moved it; a size error not routed to its
//   field; the Add button skipping the family validation or validating in staff mode; the layout classes and the stylesheet hooks gone; a stale helper file not treated as "family files did not load".
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
const PFmod = require('../js/product-families.js');
// A configuration as the WEBSITE holds it: the public groups only (computed from PF.publicGroups, independently of the page's own publicConfig)
const publicOnly = (fam, cfg) => Object.fromEntries(PFmod.publicGroups(fam).map((g) => [g.key, cfg[g.key]]));

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
  'isFam', 'famById', 'publicConfig', 'famCustom', 'lineKey', 'unitsOf', 'unitKey', 'productUnits', 'capUnits',
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
    assert.ok(island.products.length === 14, 'the island carries the 14 fixed items (the eleven families are not cards of absorbed SKUs; the specialised items, the exhaust ducting and the blowers are excluded)');
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

  it('there are 64 absorbed SKUs (eleven families) and EVERY ONE converts to its own family at its configuration, valid, whatever size the old line carried', () => {
    assert.equal(absorbed.length, 64);
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
      assert.deepEqual(it.config, json(publicOnly(pg.ctx.FAMS.families[fid], PF.validateConfiguration(pg.ctx.FAMS.families[fid], FAMS.families[fid].absorbed[sku]).config)), `${sku}: the configuration is the absorbed one (public options only)`);
      // and the SERVER accepts exactly this line
      const primaries = new Map(FAMS.order.map((f) => [f, { id: FAMS.families[f].primary }]));
      const wire = json([pg.ctx.itemPayload(it)]);
      const r = Q.normaliseItems(wire, new Map(), { families: FAMS, primaries });
      assert.equal(r.ok, true, `${sku}: the server refused the converted line: ${r.errors.join(' | ')}`);
      assert.equal(pg.ctx.convertedLines, 1);
      n++;
    }
    assert.equal(n, 64 * sizes.length);
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
    assert.equal(excluded.length, 68, 'the 20 exhaust-system SKUs that are not hoods (ducting, blowers, switches, the service line, the filter block and the lamp case) join the excluded list; the dish table (PW-029) leaves it');
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
  const stove = () => ({ uid: 'k', familyId: 'stove', name: 'Stove', cat: 'Cooking', unit: 'pc', config: json(publicOnly(fam, PFn.validateConfiguration(fam, { positions: ['wok', 'hp_large', 'soup'], addons: ['oven', 'fryer'] }).config)), dims: { W: 1500, D: 700, H: 850 }, qty: 2, note: 'hello' });
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// STANDARD CONSTRUCTION (owner ruling 2026-10-28): the staff-only 1.2 mm top plate is never kept, offered or sent by the website.
// STAFF-ONLY STEEL GRADE (owner ruling 2026-10-28, CONFIGURATOR-GRADE-TITLES-SPEC): the same for the grade — the FIRST group of every family: the SS316 choice is never kept, offered or sent.
describe('the staff-only 1.2 mm top plate and steel grade are never kept, offered or sent by the website (owner ruling 2026-10-28)', () => {
  const STAFF = ['prep_table', 'sink', 'dish_table', 'stove', 'wok_range'];                    // the families that carry the staff-only group
  const primaries = new Map(FAMS.order.map((f) => [f, { id: FAMS.families[f].primary }]));
  const lineOf = (fid, extra) => Object.assign({ uid: 'u-1', familyId: fid, config: json(PFmod.defaultConfig(FAMS.families[fid])), dims: json(PFmod.defaultDims(FAMS.families[fid])), qty: 2, note: '' }, extra || {});

  it('the premise: every family carries the staff-only steel grade ("grade", first), exactly the preparation table, the sink, the dish table, the stove and the wok range also carry "top", and PF.publicGroups is every other group', () => {
    for (const fid of FAMS.order) {
      const fam = FAMS.families[fid];
      assert.deepEqual(fam.groups.filter((g) => g.staffOnly === true).map((g) => g.key), STAFF.includes(fid) ? ['grade', 'top'] : ['grade'], fid);
      assert.equal(fam.groups[0].key, 'grade', fid);
      assert.deepEqual(PFmod.publicGroups(fam).map((g) => g.key), fam.groups.map((g) => g.key).filter((k) => k !== 'top' && k !== 'grade'), fid);
    }
  });

  it('publicConfig keeps the public groups only, whatever the configuration holds: the staff-only key and an unknown key are dropped, a value is never changed, a non-object is left for the strict validation', () => {
    const pg = makePage();
    for (const fid of FAMS.order) {
      const fam = FAMS.families[fid];
      const full = json(PFmod.defaultConfig(fam));
      const out = json(pg.ctx.publicConfig(fam, Object.assign({ colour: 'red', constructor: 1 }, full)));
      assert.deepEqual(out, publicOnly(fam, full), fid);
      assert.ok(!('top' in out) && !('grade' in out) && !('colour' in out), fid);
      assert.equal(full.grade, 304, `${fid}: the premise — the configuration held a grade for publicConfig to drop`);
    }
    assert.equal(pg.ctx.publicConfig(FAMS.families.sink, 'basins=2'), 'basins=2');
  });

  it('a stored line with the STANDARD top plate (1.5) and the standard steel grade (304) is kept — it holds its public options only — and the draft written back to the device carries no staff-only key', () => {
    for (const fid of FAMS.order) {
      const stored = lineOf(fid);                                    // the full default configuration, top: 1.5 (where there is one) and grade: 304 included
      assert.equal(stored.config.grade, 304);
      if (STAFF.includes(fid)) assert.equal(stored.config.top, 1.5);
      const pg = loadV2([stored]);
      const [it] = items(pg);
      assert.ok(it, `${fid}: a line with the standard top plate and grade must survive`);
      assert.deepEqual(it.config, publicOnly(FAMS.families[fid], stored.config), fid);
      assert.ok(!('top' in it.config) && !('grade' in it.config), fid);
      assert.equal(pg.ctx.pendingToast, '', fid);
      pg.ctx.saveDraftNow();
      assert.ok(!/"top"/.test(pg.store.get(pg.keys.v2)) && !/"grade"/.test(pg.store.get(pg.keys.v2)), `${fid}: the draft on the visitor's device carries a staff-only key`);
    }
  });

  it('a stored line that asks for the LIGHTER top plate is dropped and the visitor is told — 1.2, and every other value but the standard one, however it is spelt', () => {
    for (const fid of STAFF) for (const top of [1.2, '1.2', '1.5', 1.25, 0, 2, true, null, [1.5], { v: 1.5 }]) {
      const pg = loadV2([lineOf(fid, { config: Object.assign(lineOf(fid).config, { top }) })]);
      assert.deepEqual(items(pg), [], `${fid}: top ${JSON.stringify(top)} must not survive`);
      assert.match(pg.ctx.pendingToast, /no longer in the catalogue/, `${fid}: top ${JSON.stringify(top)}: the visitor must be told`);
    }
  });

  it('a stored line that asks for the SS316 grade is dropped and the visitor is told — 316, and every other value but the standard one, however it is spelt', () => {
    for (const fid of FAMS.order) for (const grade of [316, '316', '304', 304.5, 0, 2, true, null, [304], { v: 304 }]) {
      const pg = loadV2([lineOf(fid, { config: Object.assign(lineOf(fid).config, { grade }) })]);
      assert.deepEqual(items(pg), [], `${fid}: grade ${JSON.stringify(grade)} must not survive`);
      assert.match(pg.ctx.pendingToast, /no longer in the catalogue/, `${fid}: grade ${JSON.stringify(grade)}: the visitor must be told`);
    }
  });

  it('the payloads never carry a staff-only key — submit and estimate, even from a line that holds one — and the server accepts what is sent; the same payload WITH the lighter top, or SS316, is refused (why the page never sends it)', () => {
    const pg = makePage();
    for (const fid of FAMS.order) {
      const fam = FAMS.families[fid];
      const holding = lineOf(fid);                                   // holds top: 1.5 when the family has one
      for (const make of [pg.ctx.itemPayload, pg.ctx.estimateItemPayload]) {
        const p = json(make(holding));
        assert.ok(!('top' in p.config) && !('grade' in p.config), `${fid}: the payload carries a staff-only key`);
        assert.deepEqual(p.config, publicOnly(fam, holding.config), fid);
        const r = Q.normaliseItems([p], new Map(), { families: FAMS, primaries });
        assert.equal(r.ok, true, `${fid}: ${r.errors.join(' | ')}`);
        if (STAFF.includes(fid)) assert.equal(r.items[0].config.top, 1.5, `${fid}: the server stores the standard top plate`);
        assert.equal(r.items[0].config.grade, 304, `${fid}: the server stores the standard steel grade`);
      }
      if (STAFF.includes(fid)) {
        const lighter = json(pg.ctx.itemPayload(holding));
        lighter.config.top = 1.2;
        const r = Q.normaliseItems([lighter], new Map(), { families: FAMS, primaries });
        assert.equal(r.ok, false, `${fid}: the server must refuse a lighter top plate from the website`);
        assert.match(r.errors.join(' '), /is chosen by our staff when the quotation is prepared/);
      }
      const lab = json(pg.ctx.itemPayload(holding));
      lab.config.grade = 316;
      const rg = Q.normaliseItems([lab], new Map(), { families: FAMS, primaries });
      assert.equal(rg.ok, false, `${fid}: the server must refuse the SS316 grade from the website`);
      assert.match(rg.errors.join(' '), /"Material" is chosen by our staff when the quotation is prepared/, fid);
    }
  });
});

// ── the sheet itself: the REAL openConfigurator, run in a tiny fake DOM ──
class FText { constructor(t) { this.nodeType = 3; this.textContent = String(t); } }
class FNode {
  constructor(tag) {
    this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.parentNode = null;
    this.hidden = false; this.disabled = false; this.value = ''; this.checked = false; this.className = '';
    const self = this;
    this.classList = {
      toggle(c, force) { const s = new Set(self.className.split(/\s+/).filter(Boolean)); if (force === undefined ? !s.has(c) : force) s.add(c); else s.delete(c); self.className = [...s].join(' '); },
      add(c) { this.toggle(c, true); }, remove(c) { this.toggle(c, false); }, contains(c) { return self.className.split(/\s+/).includes(c); },
    };
  }
  get firstChild() { return this.children[0] || null; }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(t) { this.children = [new FText(t)]; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  insertBefore(n, ref) { n.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); return n; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {}
  scrollIntoView() {}
}
const fire = (node, ev) => (node.listeners[ev] || []).slice().forEach((fn) => fn({ target: node, preventDefault() {}, stopPropagation() {} }));
const where = (root, pred) => { const out = []; (function walk(n) { if (pred(n)) out.push(n); (n.children || []).forEach(walk); })(root); return out; };
const hasCls = (n, c) => (n.className || '').split(/\s+/).includes(c);

// the page of makePage() plus a fake document, the sheet helpers stubbed (they only open and close the dialog) and the REAL element builders and configurator
function makeSheetPage(preload) {
  const pg = makePage();
  pg.ctx.FNode = FNode; pg.ctx.FText = FText;
  const prelude = [
    'var COPY = D.COPY, PHONE = "0927 683 6300", PV = null, previews = {}, idSeq = 0, sheetFrame = null;',
    'var doc = { createElement: function (t) { return new FNode(t); }, createTextNode: function (t) { return new FText(t); } };',
    'function openSheet() {} function closeSheet() {} function focusFirst() {} function toast() {} function refreshAll() {} function scheduleEstimate() {} function openReview() {}',
    'function frame(title, sub, step) { sheetFrame = { title: title, step: step, head: new FNode("div"), h2: new FNode("h2"), body: new FNode("div"), foot: new FNode("div") }; return sheetFrame; }',
  ].join('\n');
  vm.runInContext(prelude + '\n' + ['nid', 'add', 'el', 'on', 'clear', 'cap1', 'field', 'setErr', 'openConfigurator'].map(grab).join('\n'), pg.ctx, { filename: 'quote-request.js (configurator extract)' });
  if (preload) pg.ctx.draft.items = json(preload);
  return pg;
}
const openSheet = (fid, editUid, preload) => { const pg = makeSheetPage(preload); pg.ctx.openConfigurator(fid, null, editUid || null, false); return pg; };
const sheetBody = (pg) => pg.ctx.sheetFrame.body;
const press = (pg, label) => { const b = where(pg.ctx.sheetFrame.foot, (n) => n.tag === 'button' && n.textContent === label)[0]; assert.ok(b, `no "${label}" button on the sheet`); fire(b, 'click'); };
const constructionHint = (pg) => where(sheetBody(pg), (n) => n.tag === 'p' && hasCls(n, 'qr-construction'));

describe('the configurator sheet — the REAL openConfigurator in a fake DOM: no control for the staff-only top plate, a read-only Construction line, nothing staff-only in the line it builds', () => {
  const STAFF = ['prep_table', 'sink', 'dish_table', 'stove', 'wok_range'];

  it('lists exactly the PUBLIC option groups of every family — no group, legend, button or word for the staff-only top plate — and then the size', () => {
    for (const fid of FAMS.order) {
      const fam = FAMS.families[fid];
      const body = sheetBody(openSheet(fid));
      const groups = where(body, (n) => n.tag === 'fieldset' && hasCls(n, 'qr-group'));
      assert.deepEqual(groups.map((g) => g.children[0].textContent), PFmod.publicGroups(fam).map((g) => g.label), `${fid}: the option groups on the sheet`);
      assert.equal(groups.length, fam.groups.length - 1 - (STAFF.includes(fid) ? 1 : 0), `${fid}: every group but the staff-only grade (and top plate)`);
      assert.ok(!/Top plate/.test(body.textContent), `${fid}: the sheet names the top plate as an option`);
      assert.ok(!/Material|316|laboratory|food grade/i.test(body.textContent.replace(/SS304 stainless steel/g, '')), `${fid}: the sheet names the steel grade as an option`);
      assert.ok(!/lighter|\(16 ga\)\s*Standard|staff|316|laboratory|food grade|material/i.test(where(body, (n) => n.tag === 'label' || n.tag === 'legend').map((n) => n.textContent).join(' ')), `${fid}: a staff-only choice is on the sheet`);
      const size = where(body, (n) => n.tag === 'fieldset' && !hasCls(n, 'qr-group'));
      assert.equal(size.length, 1, `${fid}: the size fieldset`);
      assert.match(size[0].children[0].textContent, /^Size \(mm\)/);
    }
  });

  it('says how the piece is built — a read-only "Construction: …" line (PF.constructionLine) between the last option group and the size; the table, the sink, the dish table, the stove and the wok range say 1.5 mm (16 ga) top plate', () => {
    for (const fid of FAMS.order) {
      const fam = FAMS.families[fid];
      const body = sheetBody(openSheet(fid));
      const hints = constructionHint(openSheet(fid));
      assert.equal(hints.length, 1, `${fid}: one Construction line`);
      assert.ok(hasCls(hints[0], 'qr-hint'), `${fid}: it is a hint, not a control`);
      assert.equal(hints[0].textContent, 'Construction: ' + PFmod.constructionLine(fam, PFmod.defaultConfig(fam)), fid);
      assert.equal(where(hints[0], (n) => ['input', 'select', 'button', 'textarea'].includes(n.tag)).length, 0, `${fid}: the line must be read-only`);
      const kinds = body.children.map((n) => (hasCls(n, 'qr-construction') ? 'hint' : n.tag === 'fieldset' ? (hasCls(n, 'qr-group') ? 'group' : 'size') : n.tag));
      assert.ok(kinds.lastIndexOf('group') < kinds.indexOf('hint') && kinds.indexOf('hint') < kinds.indexOf('size'), `${fid}: the line comes after the groups and before the size: ${kinds.join(' ')}`);
      if (STAFF.includes(fid)) assert.match(hints[0].textContent, /^Construction: SS304 stainless steel · 1\.5 mm \(16 ga\) top plate · 1\.2 mm /, fid);
    }
  });

  it('the line follows the choices that change the build — a wall-hung cabinet is "wall-hung", a rack without wheels stands on adjustable bullet feet — and a sheet re-opened on a saved line shows ITS construction', () => {
    const choose = (pg, groupKey, value) => {
      const fam = FAMS.families[pg.ctx.sheetFrame.title === 'Cabinet' ? 'cabinet' : 'rack'];
      const g = fam.groups.find((x) => x.key === groupKey);
      const o = g.options.find((x) => x.v === value);
      const fs = where(sheetBody(pg), (n) => n.tag === 'fieldset' && hasCls(n, 'qr-group') && n.children[0].textContent === g.label)[0];
      const radio = where(fs, (n) => n.tag === 'input').find((r) => r.parentNode.children[1].textContent === o.l);
      assert.ok(radio, `no option "${o.l}" in "${g.label}"`);
      radio.checked = true; fire(radio, 'change');
    };
    const cab = openSheet('cabinet');
    assert.equal(constructionHint(cab)[0].textContent, 'Construction: ' + PFmod.constructionLine(FAMS.families.cabinet, { type: 'floor' }));
    choose(cab, 'type', 'wall');
    assert.equal(constructionHint(cab)[0].textContent, 'Construction: ' + PFmod.constructionLine(FAMS.families.cabinet, { type: 'wall' }));
    assert.match(constructionHint(cab)[0].textContent, /wall-hung$/);
    choose(cab, 'type', 'floor');
    assert.match(constructionHint(cab)[0].textContent, /adjustable bullet feet$/);
    const rack = openSheet('rack');
    assert.match(constructionHint(rack)[0].textContent, /on wheels$/);
    choose(rack, 'wheels', false);
    assert.equal(constructionHint(rack)[0].textContent, 'Construction: ' + PFmod.constructionLine(FAMS.families.rack, { wheels: false }));
    assert.match(constructionHint(rack)[0].textContent, /adjustable bullet feet$/);
    // a saved wall-hung cabinet re-opens saying so
    const saved = { uid: 'c1', familyId: 'cabinet', config: { type: 'wall', doors: 'swing', shelves: 3 }, dims: json(PFmod.defaultDims(FAMS.families.cabinet)), qty: 1, note: '' };
    assert.match(constructionHint(openSheet('cabinet', 'c1', [saved]))[0].textContent, /wall-hung$/);
  });

  it('"Add to quote" builds a line that holds the public options only — never a staff-only key — and neither the draft on the device, the submit payload nor the estimate payload carries one', () => {
    for (const fid of FAMS.order) {
      const fam = FAMS.families[fid];
      const pg = openSheet(fid);
      press(pg, 'Add to quote');
      const [it] = json(pg.ctx.draft.items);
      assert.ok(it, `${fid}: nothing was added to the draft`);
      assert.deepEqual(it.config, publicOnly(fam, PFmod.defaultConfig(fam)), fid);
      assert.ok(!('top' in it.config) && !('grade' in it.config), fid);
      assert.ok(!/"top"/.test(pg.store.get(pg.keys.v2)) && !/"grade"/.test(pg.store.get(pg.keys.v2)), `${fid}: the draft on the visitor's device carries a staff-only key`);
      for (const p of [json(pg.ctx.itemPayload(it)), json(pg.ctx.estimateItemPayload(it))]) assert.ok(!('top' in p.config) && !('grade' in p.config), `${fid}: a payload carries a staff-only key`);
    }
  });

  it('editing a line: the sheet opens on its options (no top plate, its own construction) and Save writes the public options only — even for a line that, wrongly, still holds the staff-only key', () => {
    const holding = { uid: 'u-1', familyId: 'sink', config: Object.assign(publicOnly(FAMS.families.sink, PFmod.defaultConfig(FAMS.families.sink)), { basins: 2, top: 1.5, grade: 304 }), dims: { W: 1800, D: 700, H: 900 }, qty: 2, note: 'near the door' };
    const pg = openSheet('sink', 'u-1', [holding]);
    assert.equal(pg.ctx.sheetFrame.step, 'Edit your selection');
    assert.ok(!/Top plate/.test(sheetBody(pg).textContent));
    assert.match(constructionHint(pg)[0].textContent, /^Construction: SS304 stainless steel · 1\.5 mm \(16 ga\) top plate · /);
    press(pg, 'Save changes');
    const [it] = json(pg.ctx.draft.items);
    assert.equal(pg.ctx.draft.items.length, 1);
    assert.equal(it.config.basins, 2);
    assert.ok(!('top' in it.config) && !('grade' in it.config), 'a saved line must not hold a staff-only key');
    assert.equal(it.qty, 2); assert.equal(it.note, 'near the door');
    assert.ok(!/"top"/.test(pg.store.get(pg.keys.v2)) && !/"grade"/.test(pg.store.get(pg.keys.v2)));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// CONDITIONAL OPTIONS and FORCED SIZE LIMITS (CONFIGURATOR-FAMILIES-2-SPEC §4, §6.1) — the REAL sheet in the fake DOM.
describe('conditional options and forced size limits — the REAL openConfigurator in a fake DOM', () => {
  const primaries = new Map(FAMS.order.map((f) => [f, { id: FAMS.families[f].primary }]));
  const groupFs = (pg) => where(sheetBody(pg), (n) => n.tag === 'fieldset' && hasCls(n, 'qr-group'));
  const groupNode = (pg, label) => groupFs(pg).find((n) => n.children[0].textContent === label);
  const visibleGroups = (pg) => groupFs(pg).filter((n) => !n.hidden).map((n) => n.children[0].textContent);
  const radiosOf = (fs) => where(fs, (n) => n.tag === 'input' && n.attrs.type === 'radio');
  const labelOf = (inp) => inp.parentNode.children[1].textContent;
  const choose = (pg, groupLabel, optLabel) => {
    const fs = groupNode(pg, groupLabel);
    assert.ok(fs, `no group "${groupLabel}"`);
    assert.equal(fs.hidden, false, `"${groupLabel}" is hidden: a visitor cannot choose in it`);
    const radio = radiosOf(fs).find((r) => labelOf(r) === optLabel);
    assert.ok(radio, `no option "${optLabel}" in "${groupLabel}"`);
    radio.checked = true; fire(radio, 'change');
  };
  const selected = (pg, groupLabel) => { const r = radiosOf(groupNode(pg, groupLabel)).find((x) => x.checked); return r ? labelOf(r) : null; };
  const sizeField = (pg, label) => {
    const f = where(sheetBody(pg), (n) => n.tag === 'div' && hasCls(n, 'qr-field') && where(n, (c) => c.tag === 'span' && hasCls(c, 'qr-label') && c.textContent === label).length > 0)[0];
    assert.ok(f, `no size field "${label}"`);
    return f;
  };
  const sizeInput = (pg, label) => where(sizeField(pg, label), (n) => n.tag === 'input')[0];
  const sizeNow = (pg, label) => Number(sizeInput(pg, label).value);
  const typeSize = (pg, label, v) => { const i = sizeInput(pg, label); i.value = String(v); fire(i, 'input'); };
  const sizeErr = (pg, label) => where(sizeField(pg, label), (n) => n.tag === 'p' && hasCls(n, 'qr-err'))[0];
  const sizeHint = (pg) => where(sheetBody(pg), (n) => n.tag === 'p' && hasCls(n, 'qr-wide-hint'))[0];
  const standardLine = (pg) => where(sheetBody(pg), (n) => n.tag === 'p' && hasCls(n, 'qr-hint') && /^Standard size: /.test(n.textContent))[0].textContent;
  const added = (pg) => { const before = pg.ctx.draft.items.length; press(pg, 'Add to quote'); return pg.ctx.draft.items.length > before ? json(pg.ctx.draft.items[pg.ctx.draft.items.length - 1]) : null; };
  const serverSays = (pg, it) => Q.normaliseItems(json([pg.ctx.itemPayload(it)]), new Map(), { families: FAMS, primaries });

  it('the sheet carries EVERY public group of a family, and opens with exactly the ones that apply to its standard configuration visible — only the dish table and the griddle / griller / fryer have a conditional group', () => {
    const gated = [];
    for (const fid of FAMS.order) {
      const fam = FAMS.families[fid];
      const pg = openSheet(fid);
      assert.equal(groupFs(pg).length, PFmod.publicGroups(fam).length, `${fid}: every public group is in the sheet, the hidden ones too`);
      assert.deepEqual(visibleGroups(pg), PFmod.publicActiveGroups(fam, PFmod.defaultConfig(fam)).map((g) => g.label), `${fid}: the visible groups`);
      if (PFmod.publicGroups(fam).some((g) => g.when)) gated.push(fid);
    }
    assert.deepEqual(gated, ['dish_table', 'cooking_line']);
  });

  it('griddle / griller / fryer: "Burners" for a griddle or a griller, "Fry baskets" for a fryer, neither for the griller + griddle — each appears and disappears as the type changes', () => {
    const pg = openSheet('cooking_line');
    assert.deepEqual(visibleGroups(pg), ['Type', 'Burners', 'Base']);
    choose(pg, 'Type', 'Fryer');
    assert.deepEqual(visibleGroups(pg), ['Type', 'Fry baskets', 'Base']);
    choose(pg, 'Type', 'Griller + griddle');
    assert.deepEqual(visibleGroups(pg), ['Type', 'Base']);
    choose(pg, 'Type', 'Lava-rock griller');
    assert.deepEqual(visibleGroups(pg), ['Type', 'Burners', 'Base']);
    choose(pg, 'Type', 'Fryer');
    choose(pg, 'Type', 'Griddle');
    assert.deepEqual(visibleGroups(pg), ['Type', 'Burners', 'Base']);
  });

  it('dish table: the pre-rinse sink is offered on the soiled side only', () => {
    const pg = openSheet('dish_table');
    assert.deepEqual(visibleGroups(pg), ['Side', 'Dishwasher on the', 'Undershelf']);
    choose(pg, 'Side', 'Soiled');
    assert.deepEqual(visibleGroups(pg), ['Side', 'Dishwasher on the', 'Pre-rinse sink', 'Undershelf']);
    choose(pg, 'Side', 'Clean');
    assert.deepEqual(visibleGroups(pg), ['Side', 'Dishwasher on the', 'Undershelf']);
  });

  it('a conditional group goes back to its standard value the moment it stops applying — the line the sheet builds never carries a non-standard option that does not apply, and the server accepts it', () => {
    // three burners on a griddle, then a fryer: the burner count is the standard one again (and the hidden control shows it)
    let pg = openSheet('cooking_line');
    choose(pg, 'Burners', '3');
    assert.equal(selected(pg, 'Burners'), '3');
    choose(pg, 'Type', 'Fryer');
    assert.equal(selected(pg, 'Burners'), '1', 'the hidden group shows its standard value');
    let it = added(pg);
    assert.deepEqual(it.config, { type: 'fryer', burners: 1, baskets: 2, base: 'stand' });
    assert.equal(serverSays(pg, it).ok, true);
    // three baskets on a fryer, then a griddle: the basket count is the standard two again, and it is not remembered when the fryer comes back
    pg = openSheet('cooking_line');
    choose(pg, 'Type', 'Fryer'); choose(pg, 'Fry baskets', '3');
    choose(pg, 'Type', 'Griddle');
    assert.equal(selected(pg, 'Fry baskets'), '2');
    it = added(pg);
    assert.deepEqual(it.config, { type: 'griddle', burners: 1, baskets: 2, base: 'stand' });
    assert.equal(serverSays(pg, it).ok, true);
    pg = openSheet('cooking_line');
    choose(pg, 'Type', 'Fryer'); choose(pg, 'Fry baskets', '3'); choose(pg, 'Type', 'Griddle'); choose(pg, 'Type', 'Fryer');
    assert.equal(selected(pg, 'Fry baskets'), '2');
    // the pre-rinse sink of a dish table: soiled + sink, then the clean side
    pg = openSheet('dish_table');
    choose(pg, 'Side', 'Soiled'); choose(pg, 'Pre-rinse sink', 'With pre-rinse sink and spray faucet');
    it = added(pg);
    assert.deepEqual(it.config, { side: 'soiled', hand: 'left', sink: 'prerinse', undershelf: true });
    pg = openSheet('dish_table');
    choose(pg, 'Side', 'Soiled'); choose(pg, 'Pre-rinse sink', 'With pre-rinse sink and spray faucet'); choose(pg, 'Side', 'Clean');
    assert.equal(selected(pg, 'Pre-rinse sink'), 'None');
    it = added(pg);
    assert.deepEqual(it.config, { side: 'clean', hand: 'left', sink: 'none', undershelf: true });
    assert.equal(serverSays(pg, it).ok, true);
  });

  it('PROPERTY: any walk through the options of any family leaves a sheet that builds a line the server accepts — canonical, every option that does not apply at its standard value, and every size still the usual one for those options', () => {
    let seed = 0x2545F491;
    const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
    let built = 0, steps = 0;
    for (const fid of FAMS.order) {
      const fam = FAMS.families[fid];
      for (let round = 0; round < 25; round++) {
        const pg = openSheet(fid);
        const walk = 1 + Math.floor(rnd() * 10);
        for (let s = 0; s < walk; s++) {
          const fs = groupFs(pg).filter((n) => !n.hidden);
          const g = fs[Math.floor(rnd() * fs.length)];
          const inputs = where(g, (n) => n.tag === 'input');
          const inp = inputs[Math.floor(rnd() * inputs.length)];
          if (inp.attrs.type === 'checkbox') inp.checked = !inp.checked; else inp.checked = true;
          fire(inp, 'change');
          steps++;
        }
        const it = added(pg);
        assert.ok(it, `${fid}: the sheet could not add a line after the visitor only chose options`);
        const v = PFmod.validateLine(fam, it.config, it.dims);
        assert.equal(v.ok, true, `${fid}: ${v.errors.join(' ')}`);
        assert.deepEqual(it.config, publicOnly(fam, v.config), `${fid}: the line is canonical`);
        assert.equal(v.custom, false, `${fid}: a size nobody typed is the usual one for its options (${JSON.stringify(it.dims)})`);
        for (const g of PFmod.publicGroups(fam)) if (!PFmod.groupApplies(fam, g, it.config)) assert.deepEqual(it.config[g.key], g.default, `${fid}: "${g.label}" does not apply and must be at its standard value`);
        const r = serverSays(pg, it);
        assert.equal(r.ok, true, `${fid}: the server refused what the sheet built: ${(r.errors || []).join(' | ')}`);
        built++;
      }
    }
    assert.equal(built, FAMS.order.length * 25);
    assert.ok(steps > 500);
  });

  it('a size the visitor has NOT typed follows the options; one they typed is kept and moved only when an option forces it (burners of a griddle)', () => {
    const pg = openSheet('cooking_line');
    assert.equal(sizeNow(pg, 'Length'), 700);
    assert.equal(standardLine(pg), 'Standard size: Length 700 · Width 700 mm. Each dimension in steps of 10.');
    choose(pg, 'Burners', '2'); assert.equal(sizeNow(pg, 'Length'), 900);
    choose(pg, 'Burners', '3'); assert.equal(sizeNow(pg, 'Length'), 1200);
    assert.equal(standardLine(pg), 'Standard size: Length 1200 · Width 700 mm. Each dimension in steps of 10.');
    choose(pg, 'Burners', '1'); assert.equal(sizeNow(pg, 'Length'), 700, 'untouched: it follows the options back');
    typeSize(pg, 'Length', 1500);
    choose(pg, 'Burners', '3'); assert.equal(sizeNow(pg, 'Length'), 1500, 'a length of the visitor\'s own is kept');
    choose(pg, 'Burners', '1'); assert.equal(sizeNow(pg, 'Length'), 1500);
    typeSize(pg, 'Length', 800);
    choose(pg, 'Burners', '3'); assert.equal(sizeNow(pg, 'Length'), 1200, 'a typed length below a forced minimum is raised at once');
    // Reset: the usual size for the current options, and the size follows the options again
    fire(where(sheetBody(pg), (n) => n.tag === 'button' && n.textContent === 'Reset to standard size')[0], 'click');
    assert.equal(sizeNow(pg, 'Length'), 1200);
    choose(pg, 'Burners', '1'); assert.equal(sizeNow(pg, 'Length'), 700);
    // the forced minimum is in the field and in the words
    choose(pg, 'Burners', '2');
    assert.equal(sizeInput(pg, 'Length').attrs.min, '900');
    assert.equal(sizeHint(pg).textContent, 'With these options the length is at least 900 mm.');
    choose(pg, 'Burners', '1');
    assert.equal(sizeInput(pg, 'Length').attrs.min, '500');
    assert.equal(sizeHint(pg).hidden, true);
  });

  it('a forced MAXIMUM lowers a size at once (a slim hood is at most 500 mm deep), the field and the hint say so, the standard depth returns with the wall canopy, and a deeper typed size is refused at the field with the server\'s words', () => {
    const pg = openSheet('hood');
    assert.equal(sizeNow(pg, 'Depth'), 900);
    assert.equal(sizeInput(pg, 'Depth').attrs.max, '1500');
    choose(pg, 'Type', 'Slim, low profile');
    assert.equal(sizeNow(pg, 'Depth'), 500);
    assert.equal(sizeInput(pg, 'Depth').attrs.max, '500', 'the field stops at the limit');
    assert.equal(sizeHint(pg).hidden, false);
    assert.match(sizeHint(pg).textContent, /With these options the depth is at most 500 mm\./);
    choose(pg, 'Type', 'Wall canopy');
    assert.equal(sizeNow(pg, 'Depth'), 900, 'a depth nobody typed follows the type');
    assert.equal(sizeInput(pg, 'Depth').attrs.max, '1500');
    // a typed depth is lowered at once when the limit arrives
    typeSize(pg, 'Depth', 700);
    choose(pg, 'Type', 'Slim, low profile');
    assert.equal(sizeNow(pg, 'Depth'), 500);
    // ... and a depth typed while the limit holds is refused at the field, never sent
    typeSize(pg, 'Depth', 650);
    assert.equal(added(pg), null);
    assert.equal(sizeErr(pg, 'Depth').hidden, false);
    assert.equal(sizeErr(pg, 'Depth').textContent, 'With these options the depth must be at most 500 mm.');
    typeSize(pg, 'Depth', 450);
    const it = added(pg);
    assert.deepEqual(it.dims, { W: 1000, D: 450 });
    assert.equal(serverSays(pg, it).ok, true);
    // the island canopy forces a minimum on BOTH axes, said in one sentence
    const isl = openSheet('hood');
    choose(isl, 'Type', 'Island canopy');
    assert.equal(sizeNow(isl, 'Length'), 1200);
    assert.equal(sizeHint(isl).textContent, 'With these options the length is at least 1200 mm and the depth is at least 700 mm.');
  });

  it('gas deck oven: the width follows the trays per deck (700 for three, 1200 for six), is shown read-only, and the hint says it is one value', () => {
    const pg = openSheet('deck_oven');
    assert.equal(sizeNow(pg, 'Width'), 700);
    assert.equal(sizeInput(pg, 'Width').readOnly, true, 'only one width is possible');
    assert.equal(sizeHint(pg).textContent, 'With these options the width is 700 mm.');
    assert.equal(standardLine(pg), 'Standard size: Width 700 mm. Each dimension in steps of 10.');
    choose(pg, 'Trays per deck', '6');
    assert.equal(standardLine(pg), 'Standard size: Width 1200 mm. Each dimension in steps of 10.', 'the standard size is the usual one for the chosen options — what Reset goes back to');
    assert.equal(sizeNow(pg, 'Width'), 1200);
    assert.equal(sizeInput(pg, 'Width').readOnly, true);
    assert.equal(sizeInput(pg, 'Width').attrs.min, '1200'); assert.equal(sizeInput(pg, 'Width').attrs.max, '1200');
    assert.equal(sizeHint(pg).textContent, 'With these options the width is 1200 mm.');
    choose(pg, 'Decks', '3'); assert.equal(sizeNow(pg, 'Width'), 1200, 'the decks do not change the width');
    let it = added(pg);
    assert.deepEqual(it.dims, { W: 1200 });
    assert.deepEqual(it.config, { decks: 3, trays: 6, stand: 'none' });
    assert.equal(serverSays(pg, it).ok, true);
    const pg2 = openSheet('deck_oven'); choose(pg2, 'Trays per deck', '6'); choose(pg2, 'Trays per deck', '3');
    assert.equal(sizeNow(pg2, 'Width'), 700);
    it = added(pg2);
    assert.deepEqual(it.dims, { W: 700 });
    // a family with a free size has no read-only field
    assert.equal(sizeInput(openSheet('hood'), 'Length').readOnly, false);
  });

  it('a size forced up by a pre-rinse sink or the wok range\'s rear burner is raised at once; the dish table keeps a length of its own otherwise', () => {
    const dt = openSheet('dish_table');
    typeSize(dt, 'Length', 900);
    choose(dt, 'Side', 'Soiled');
    assert.equal(sizeNow(dt, 'Length'), 900, 'a soiled side without the sink has no minimum');
    choose(dt, 'Pre-rinse sink', 'With pre-rinse sink and spray faucet');
    assert.equal(sizeNow(dt, 'Length'), 1200);
    assert.match(sizeHint(dt).textContent, /the length is at least 1200 mm/);
    const wok = openSheet('wok_range');
    assert.equal(sizeNow(wok, 'Width'), 700);
    choose(wok, 'Rear stock burner', 'With');
    assert.equal(sizeNow(wok, 'Width'), 800, 'the rear burner needs a deeper range');
    choose(wok, 'Rear stock burner', 'None');
    assert.equal(sizeNow(wok, 'Width'), 700, 'untouched: it follows back');
    choose(wok, 'Wok holes', '3');
    assert.equal(sizeNow(wok, 'Length'), 1800, 'a hard length rule: 600 mm for each hole');
    // a HARD length rule raises a length the visitor typed as well (it could not be sent otherwise): wok holes, sink basins
    const wok2 = openSheet('wok_range');
    typeSize(wok2, 'Length', 700);
    choose(wok2, 'Wok holes', '2');
    assert.equal(sizeNow(wok2, 'Length'), 1200);
    const sink = openSheet('sink');
    typeSize(sink, 'Length', 600);
    choose(sink, 'Sinks', '3');
    assert.equal(sizeNow(sink, 'Length'), 1500, 'the sink\'s own hard rule: 500 mm for each basin');
  });

  it('"Use N mm" (a length rule) still sets the usual length and keeps it as the visitor\'s own; it is offered only while the length differs from the rule', () => {
    const pg = openSheet('sink');
    const useBtn = () => where(sheetBody(pg), (n) => n.tag === 'button' && /^Use \d+ mm$/.test(n.textContent))[0];
    choose(pg, 'Sinks', '2');
    assert.equal(sizeNow(pg, 'Length'), 1000);
    assert.equal(useBtn().hidden, true, 'the length already is the rule');
    typeSize(pg, 'Length', 1400);
    assert.equal(useBtn().hidden, false);
    assert.equal(useBtn().textContent, 'Use 1000 mm');
    fire(useBtn(), 'click');
    assert.equal(sizeNow(pg, 'Length'), 1000);
    assert.equal(useBtn().hidden, true);
    choose(pg, 'Sinks', '3');
    assert.equal(sizeNow(pg, 'Length'), 1500, 'a hard rule still raises it');
  });

  it('editing a saved line opens on its own options and sizes: a conditional group is shown when it applies, a size at the usual one keeps following, a size of its own is kept', () => {
    const saved = (config, dims) => ({ uid: 'c1', familyId: 'cooking_line', config, dims, qty: 2, note: 'n' });
    let pg = openSheet('cooking_line', 'c1', [saved({ type: 'fryer', burners: 1, baskets: 3, base: 'stand' }, { W: 1000, D: 700 })]);
    assert.deepEqual(visibleGroups(pg), ['Type', 'Fry baskets', 'Base']);
    assert.equal(selected(pg, 'Fry baskets'), '3');
    choose(pg, 'Type', 'Griddle');
    assert.equal(sizeNow(pg, 'Length'), 700, '1000 mm was the usual length for three baskets: it follows the options');
    pg = openSheet('cooking_line', 'c1', [saved({ type: 'fryer', burners: 1, baskets: 3, base: 'stand' }, { W: 1500, D: 700 })]);
    choose(pg, 'Type', 'Griddle');
    assert.equal(sizeNow(pg, 'Length'), 1500, 'a length of the visitor\'s own is kept');
    press(pg, 'Save changes');
    assert.equal(pg.ctx.draft.items.length, 1);
    assert.deepEqual(json(pg.ctx.draft.items[0].config), { type: 'griddle', burners: 1, baskets: 2, base: 'stand' });
    assert.equal(pg.ctx.draft.items[0].qty, 2);
  });

  it('layout hooks: four option names that would break on a phone (griddle / lava-rock griller / fryer / griller + griddle) get the two-by-two class, and no other group does; a family with one size keeps the half-width layout', () => {
    const segClasses = (fid) => where(sheetBody(openSheet(fid)), (n) => n.tag === 'div' && hasCls(n, 'qr-seg')).map((n) => n.className);
    assert.deepEqual(segClasses('cooking_line').map((c) => /qr-seg-wrap/.test(c)), [true, false, false, false], 'only the type of the griddle / griller / fryer (its burners, baskets and base have three, three and two options)');
    for (const fid of FAMS.order) if (fid !== 'cooking_line') assert.ok(!segClasses(fid).some((c) => /qr-seg-wrap/.test(c)), `${fid}: a group with short names must keep its single row`);
    const dims = (fid) => where(sheetBody(openSheet(fid)), (n) => n.tag === 'div' && hasCls(n, 'qr-dims'))[0].className;
    assert.match(dims('deck_oven'), /qr-dims-1/);
    assert.match(dims('hood'), /qr-dims-2/);
    assert.ok(!/qr-dims-[12]/.test(dims('sink')), 'three sizes: the three-column layout');
  });

  it('a saved line that wrongly holds an option that does not apply (this page cannot make one, but a stored draft is untrusted) opens snapped to the standard value and can still be saved', () => {
    const bad = { uid: 'c1', familyId: 'cooking_line', config: { type: 'fryer', burners: 3, baskets: 3, base: 'stand' }, dims: { W: 1000, D: 700 }, qty: 1, note: '' };
    const pg = openSheet('cooking_line', 'c1', [bad]);
    assert.equal(selected(pg, 'Burners'), '1');
    assert.equal(sizeNow(pg, 'Length'), 1000);
    press(pg, 'Save changes');
    assert.deepEqual(json(pg.ctx.draft.items[0].config), { type: 'fryer', burners: 1, baskets: 3, base: 'stand' });
  });

  it('the burner list of the stove is still edited IN PLACE: two edits in a row both reach the line (a write-back that replaced the list would leave the buttons editing a stale copy)', () => {
    const pg = openSheet('stove');
    const slots = () => where(sheetBody(pg), (n) => n.tag === 'li' && hasCls(n, 'qr-slot'));
    const chip = (slot, label) => where(slot, (n) => n.tag === 'input' && n.attrs.type === 'radio').find((r) => labelOf(r) === label);
    const pick = (slot, label) => { const r = chip(slot, label); assert.ok(r, label); r.checked = true; fire(r, 'change'); };
    pick(slots()[0], 'Wok');
    pick(slots()[0], 'Soup');
    pick(slots()[0], 'Wok');
    const it = added(pg);
    assert.deepEqual(it.config.positions, ['wok'], 'the last of three edits wins');
    // and after an option elsewhere changes (an add-on chip), the burner buttons still edit the line
    const pg2 = openSheet('stove');
    const slot0 = () => where(sheetBody(pg2), (n) => n.tag === 'li' && hasCls(n, 'qr-slot'))[0];
    const pick2 = (label) => { const r = chip(slot0(), label); r.checked = true; fire(r, 'change'); };
    pick2('Wok');
    const oven = where(groupNode(pg2, 'Add-ons'), (n) => n.tag === 'input' && n.attrs.type === 'checkbox').find((x) => labelOf(x) === 'Oven');
    oven.checked = true; fire(oven, 'change');
    pick2('Soup');
    const it2 = added(pg2);
    assert.deepEqual(it2.config.positions, ['soup']);
    assert.deepEqual(it2.config.addons, ['oven']);
    assert.ok(it2.dims.D >= 700 && it2.dims.H >= 850, 'the oven still raises the depth and the height');
  });
});

describe('a saved line is re-validated against the families as they are now — conditional options, forced limits and a missing size', () => {
  const lineOf = (familyId, config, dims) => ({ uid: 'u-1', familyId, config, dims, qty: 1, note: '' });

  it('a stored line that sets an option that does not apply is dropped and the visitor is told; one that leaves it out, or states its standard value, is kept', () => {
    for (const [why, cfg] of Object.entries({
      'baskets on a griddle': { type: 'griddle', burners: 1, baskets: 3, base: 'stand' },
      'burners on a fryer': { type: 'fryer', burners: 2, baskets: 2, base: 'stand' },
      'burners on the combination': { type: 'combi', burners: 3, baskets: 2, base: 'stand' },
    })) {
      const pg = loadV2([lineOf('cooking_line', cfg, { W: 1500, D: 700 })]);
      assert.deepEqual(items(pg), [], why);
      assert.match(pg.ctx.pendingToast, /no longer in the catalogue/, why);
    }
    const dish = loadV2([lineOf('dish_table', { side: 'clean', hand: 'left', sink: 'prerinse', undershelf: true }, { W: 1200, D: 660 })]);
    assert.deepEqual(items(dish), [], 'a pre-rinse sink on the clean side');
    for (const cfg of [{ type: 'fryer', baskets: 3 }, { type: 'fryer', burners: 1, baskets: 3, base: 'stand' }, { type: 'griddle', burners: 2 }]) {
      const pg = loadV2([lineOf('cooking_line', cfg, { W: 1500, D: 700 })]);
      assert.equal(items(pg).length, 1, JSON.stringify(cfg));
      assert.equal(pg.ctx.pendingToast, '');
    }
  });

  it('a stored line that leaves a size out gets the USUAL size for its options — a six-tray deck oven is 1200 mm wide, a three-burner griddle 1200 mm long — not the family default (which the server would refuse)', () => {
    const six = loadV2([lineOf('deck_oven', { decks: 2, trays: 6, stand: 'none' }, {})]);
    assert.deepEqual(items(six)[0].dims, { W: 1200 });
    const three = loadV2([lineOf('cooking_line', { type: 'griddle', burners: 3 }, { D: 800 })]);
    assert.deepEqual(items(three)[0].dims, { W: 1200, D: 800 });
    const slim = loadV2([lineOf('hood', { type: 'slim' }, { W: 1500 })]);
    assert.deepEqual(items(slim)[0].dims, { W: 1500, D: 500 });
  });

  it('a stored size beyond a forced limit is dropped (a slim hood 600 mm deep, a six-tray deck oven 700 mm wide), the notice says so', () => {
    for (const [why, line] of Object.entries({
      'slim hood 600 deep': lineOf('hood', { type: 'slim', filters: 'baffle', lighting: true }, { W: 1000, D: 600 }),
      'island hood 600 deep': lineOf('hood', { type: 'island', filters: 'baffle', lighting: true }, { W: 1200, D: 600 }),
      'six trays 700 wide': lineOf('deck_oven', { decks: 2, trays: 6, stand: 'none' }, { W: 700 }),
      'three trays 1200 wide': lineOf('deck_oven', { decks: 2, trays: 3, stand: 'none' }, { W: 1200 }),
      'pre-rinse sink 900 long': lineOf('dish_table', { side: 'soiled', hand: 'left', sink: 'prerinse', undershelf: true }, { W: 900, D: 660 }),
    })) {
      const pg = loadV2([line]);
      assert.deepEqual(items(pg), [], why);
      assert.match(pg.ctx.pendingToast, /no longer in the catalogue/, why);
    }
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
    assert.match(src, /PF\.forcedMaxes\(/);
  });
  it('an Edit opened from the review goes BACK to the review however the sheet is left (both sheets), and a button marks the sheet as dealt with first', () => {
    const wired = src.match(/openSheet\('(item|configure)', trigger, retReview \? \{ onClose: function \(\) \{ if \(!finished\) openReview\(trigger\); \} \} : null\);/g) || [];
    assert.equal(wired.length, 2, 'the plain item sheet and the configurator both reopen the review when closed with x / Esc / the backdrop');
    assert.equal((src.match(/var finished = false;/g) || []).length, 2);
    assert.equal((src.match(/finished = true;\n\s+closeSheet\(!retReview\);\n\s+if \(retReview\) openReview\(trigger\);\n\s+toast\(existing \? 'Item updated\.' : 'Added to your quote\.'\);/g) || []).length, 2, 'Save/Add: flag, close, reopen the review, THEN toast (opening a sheet clears a toast)');
    assert.equal((src.match(/finished = true; closeSheet\(!retReview\); if \(retReview\) openReview\(trigger\);/g) || []).length, 2, 'Cancel');
  });
  it('the configurator: a size of the visitor\'s own is kept, the usual one follows the options; Reset and the "Custom size" tag use the usual size; an option that forces a limit moves a size to it at once', () => {
    assert.match(src, /touched: \{\}/);
    assert.match(src, /if \(existing\) PF\.DIM_KEYS\.forEach\(function \(k\) \{ if \(fam\.dims\[k\] && existing\.dims\[k\] !== usual0\[k\]\) st\.touched\[k\] = true; \}\);/, 'a saved line at the usual size keeps following its options');
    assert.match(src, /st\.dims\[k\] = n;\n\s+st\.touched\[k\] = true;/, 'typing in a size field makes that size the visitor\'s own');
    assert.match(src, /st\.dims = PF\.standardDims\(fam, st\.config\); st\.touched = \{\};/);
    assert.match(src, /var std = PF\.standardDims\(fam, st\.config\);\n\s+stdEl\.textContent = [^\n]*\n\s+var cust = axes\.some\(function \(k\) \{ return st\.dims\[k\] !== std\[k\]; \}\);/);
    assert.match(src, /fm = PF\.forcedMins\(fam, st\.config\), fx = PF\.forcedMaxes\(fam, st\.config\)/);
    assert.match(src, /function famCustom\(/);
    assert.match(grab('famCustom'), /PF\.standardDims\(/);
  });
  it('the configurator: a change hides the "already in your quote" prompt (it described the old selection); the picture is optional; the SELECTED option gets the first focus', () => {
    assert.match(src, /function changed\(\) \{ errBanner\.hidden = true; if \(dupeBox\) dupeBox\.hidden = true;/);
    assert.match(src, /var pv = PV \? PV\.create\(/);
    assert.match(src, /var firstRadio = f\.body\.querySelector\('\.qr-group input:checked'\) \|\| f\.body\.querySelector\('\.qr-group input'\);/);
  });
  it('standard construction: the sheet walks PF.publicGroups(fam) (never fam.groups), says how the piece is built in a read-only line, and EVERY line the page builds, rebuilds or sends passes through publicConfig', () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.match(code, /PF\.publicGroups\(fam\)\.forEach\(function \(g\) \{\n\s+var node = g\.type === 'slots'/);
    assert.ok(!/\bfam\.groups\b/.test(code), 'the sheet must never walk fam.groups: a staff-only group would get a control');
    assert.match(code, /el\('p', \{ class: 'qr-hint qr-construction', 'aria-live': 'polite', text: constructionText\(\) \}\)/);
    assert.match(code, /return 'Construction: ' \+ PF\.constructionLine\(fam, st\.config\);/);
    assert.match(code, /syncers\.push\(function \(\) \{ var t = constructionText\(\);/, 'the line follows the choices');
    assert.match(grab('sanitizeFamilyItem'), /config: publicConfig\(fam, v\.config\)/, 'a rebuilt stored line');
    assert.match(grab('itemPayload'), /config: publicConfig\(famById\(it\.familyId\), it\.config\)/, 'the submit payload');
    assert.match(grab('estimateItemPayload'), /config: publicConfig\(famById\(it\.familyId\), it\.config\)/, 'the estimate payload');
    assert.match(code, /config: publicConfig\(fam, existing \? clone\(existing\.config\) : PF\.defaultConfig\(fam\)\)/, 'the sheet\'s starting state');
    assert.match(code, /config: publicConfig\(fam, clone\(v\.config\)\)/, 'the line the sheet builds');
    assert.ok(!/staffOnly|\{ ?staff: ?true/.test(code), 'the website never validates in staff mode, and never names a staff-only group');
  });
  it('a copy of the helper file cached from before conditional options (no PF.groupApplies / PF.forcedMaxes) counts as "the family files did not load": the configured lines are held and the visitor is told to reload — nothing throws', () => {
    const famLine = line(/var famEnabled = [^\n]*;/);
    const enabled = (PFstub) => vm.runInNewContext(famLine + '; famEnabled', { PF: PFstub, FAMS });
    assert.equal(enabled(PFmod), true);
    for (const missing of ['groupApplies', 'forcedMaxes']) {
      const old = Object.assign({}, PFmod); delete old[missing];
      assert.equal(enabled(old), false, `a helper file without ${missing}`);
    }
    assert.equal(enabled(undefined), false);
    assert.equal(enabled({}), false);
  });
  it('the stylesheet carries the layout hooks the sheet adds: the two-by-two group on a phone, the one-size layout, the read-only look of a size the options fix', () => {
    const css = read('css/quote-request.css');
    assert.match(css, /@media \(max-width:519px\)\{#qr-root \.qr-seg-wrap\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\}/);
    assert.match(css, /#qr-root \.qr-dims-2,#qr-root \.qr-dims-1\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
    assert.match(css, /#qr-root \.qr-input\[readonly\]\{background:var\(--qr-soft\);/);
    assert.match(css, /#qr-root \[hidden\]\{display:none !important\}/, 'a hidden conditional group must really disappear (no later display rule may win)');
  });
  it('the draft is stored under the v2 key and a v1 draft is read once and removed', () => {
    assert.match(src, /var DRAFT_KEY = 'barro-qr-draft-v2';/);
    assert.match(src, /if \(legacy && !holdStored\) \{ saveDraftNow\(\); ls\(function \(s\) \{ s\.removeItem\(OLD_DRAFT_KEY\); \}\); \}/);
  });
});
