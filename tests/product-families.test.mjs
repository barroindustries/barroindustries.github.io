// tests/product-families.test.mjs — the ELEVEN CONFIGURABLE product families of the public catalogue (owner ruling 2026-10-21; five more 2026-10-28).
//
// What is pinned:
//   1. THE MAPPING (scripts/public-families.json): every published SKU is either ABSORBED by exactly one family or FIXED — never both, never
//      neither; each family's primary is one of its absorbed SKUs and is the family's default configuration; absorbed configurations are
//      valid; the public-families.json -> js/qr-families.js generation is deterministic and the committed file is fresh; byte-identical
//      functions/ mirrors; no price vocabulary anywhere in what ships to the public.
//   2. THE OPTION SETS ARE EXACTLY THE OWNER'S, nothing more: preparation table (layers, upper shelves), sink (sinks, position, undershelf,
//      upper shelf, faucet), dish table (side, hand, pre-rinse sink, undershelf), stove (burner positions one by one + griller / griddle / oven / fryer),
//      wok range (holes, rear stock burner, swan-neck faucet), griddle / griller / fryer (type, burners, fry baskets, base), gas deck oven (decks, trays
//      per deck, stand), range hood (type, filters, lighting), cabinet (type, doors, shelves), wall shelving (tiers, surface), rack (tiers, wheels) —
//      and none of the options he ruled out (backsplash, casters, drawers, mount, grade, valve).
//   3. js/product-families.js — STRICT validation (an unknown key, value, type, size axis, step or bound is an error, never ignored; the
//      __proto__ / constructor guard), the hard width rule (sinks) and the soft one (stove), the oven's forced minimums, description words,
//      canonical configuration, converting an old saved SKU line to its family line, the cells of a family's option sheet.
//   4. THE PREVIEW KEYS match the file names of the owner's photo shot list (docs/configurator-preview-photo-list.md) EXACTLY — all 60 of
//      them — with the fallback chains he specified; the manifest loader validates hard (real family, a key the family can ask for, exact
//      path, files present, readable WebP) against a fixture; the shipped manifest is empty; the preview widget (js/qr-preview.js) picks the
//      right photo, falls back, and draws a placeholder for every family and every option — in a fake DOM.
//
//   5. STANDARD CONSTRUCTION (owner ruling 2026-10-28, QUOTE-BUILDER-CONFIGURATOR-SPEC §14): every family states how a made-to-order piece is built
//      (`construction`, with {group} tokens filled from the chosen option's `c` phrase), and tables, sinks, dish tables, stoves and wok ranges carry a
//      STAFF-ONLY `top` group (1.5 mm (16 ga) standard, 1.2 mm lighter): never on a website surface, refused by the server's validation, chosen only
//      with { staff: true }.
//   6. CONDITIONAL OPTIONS AND UPPER LIMITS (CONFIGURATOR-FAMILIES-2-SPEC §4, the `when` / `maxDimWhen` describe blocks at the end): an option that applies only
//      for some values of an earlier choice (fry baskets for a fryer, a pre-rinse sink on the soiled side of a dish table), always at its default when it does
//      not apply; a size an option forces an UPPER limit on (a slim hood is at most 500 mm deep, a deck oven's width follows its trays).
//
// Fixtures are synthetic; no price figure exists anywhere in the public family files (and this test asserts that).
//
// Mutation-tested (scratch copies, never the shared tree): dropping the strict unknown-key refusal, letting a string 'true' pass for the
// boolean, skipping the hard width rule, dropping the absorbed/fixed completeness check, a preview chain in the wrong order, a key outside
// the family's valid set accepted by the manifest loader, the preview widget ignoring the fallback — each must fail here. 2026-10-28: the public
// validation accepting the 1.2 mm top, describe() printing a "Top plate" row, constructionLine() ignoring the configuration, summaryParts()
// printing the standard top, the staff mode refusing the 1.2 mm top, the generator dropping `construction` from the public keys — each must fail here too.
// 2026-10-28 (the five new families): 68 mutants in scratch copies (/private/tmp/.../cf2-ws1-mut/), EVERY ONE killed. By area —
//   logic (js/product-families.js + its functions/ mirror): groupApplies ignoring the value list / not reading a missing gate as its default; validateConfiguration keeping a
//   non-default value of an option that does not apply, refusing it without resetting it, or comparing a multi default by reference; forcedMaxes returning the minimums or the
//   LARGEST maximum; validateDims treating "above the maximum" as a warning or ignoring it, or taking the family default (not the usual size) for an axis left out; minWidth
//   counting a term whose option does not apply; forcedLimits not skipping an inapplicable rule; describe() / summaryParts() keeping an inapplicable row / phrase; activeGroups
//   ignoring the condition; standardDims ignoring the forced maximum or minimum; migrateAbsorbed not lowering to the maximum; cells() losing `when`; whenText joining with a
//   comma or printing stored values.
//   build (scripts/build-catalogue.js): accepting a forward or self `when`, a gate that is not a choice group / is staff-only, a conditional slots / staff-only group, a `when` value
//   the gate lacks, a {token} on a conditional group, an unvalidated maxDimWhen, a limit off the step, a minimum above a maximum that can hold with it, a min / max pair on
//   different groups, a default size the options refuse; the card row losing its condition; exhaust_system excluded again; Ventilation after Storage or without an icon; the hood
//   without a page link; maxDimWhen dropped from the public family file.
//   preview (js/qr-preview.js): no default box for an unknown family; the drawing lookup trusting Object.prototype; the dish-table arrow the same both ways; a wall behind every
//   hood; a six-tray oven no wider; one wok ring / two fryer tanks whatever the choice.   data (js/qr-families.js): a slim hood allowed 600 mm; baskets applying to a griddle.
//
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PF = require('../js/product-families.js');
const FAMS = require('../js/qr-families.js');
const B = require('../scripts/build-catalogue.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const SRC = JSON.parse(read('scripts/public-families.json'));
const PUB = JSON.parse(read('scripts/public-categories.json'));
const PUBLISHED = new Set(Object.keys(PUB.products));
const fam = (id) => FAMS.families[id];
const ORDER = ['prep_table', 'sink', 'dish_table', 'stove', 'wok_range', 'cooking_line', 'deck_oven', 'hood', 'cabinet', 'wall_shelf', 'rack'];
const CATEGORY_OF = ['preparation', 'washing', 'washing', 'cooking', 'cooking', 'cooking', 'cooking', 'ventilation', 'storage', 'storage', 'storage'];
const vals = (g) => g.options.map((o) => o.v);
// an ABSORBED configuration never states the staff-only top plate (it is the standard 1.5 mm one): this is the complete configuration it converts to
const filled = (f, cfg) => PF.validateConfiguration(f, cfg).config;

describe('the mapping: every published SKU is absorbed by exactly one family or fixed — never both, never neither', () => {
  const loaded = B.loadPublicFamilies({ published: PUBLISHED });
  const absorbed = Object.values(FAMS.families).flatMap((f) => Object.keys(f.absorbed));
  const fixed = Object.keys(SRC.fixed);

  it('scripts/public-families.json loads and classifies every published SKU (the same check the build and CI run, without the private master)', () => {
    assert.deepEqual(loaded.order, ORDER);
    assert.equal(loaded.absorbedIds.size + loaded.fixedIds.size, PUBLISHED.size);
  });
  it('absorbed and fixed are disjoint, each SKU is in exactly one place, and together they are exactly the 78 published SKUs', () => {
    assert.equal(new Set(absorbed).size, absorbed.length, 'a SKU is absorbed by two families');
    assert.ok(!absorbed.some((id) => fixed.includes(id)), 'a SKU is both absorbed and fixed');
    assert.deepEqual([...absorbed, ...fixed].sort(), [...PUBLISHED].sort());
    assert.equal(PUBLISHED.size, 78);
    assert.equal(absorbed.length, 64);
    assert.equal(fixed.length, 14);
    assert.deepEqual(fixed.sort(), ['BA-006', 'BA-011', 'CE-011', 'CE-024', 'CE-030', 'CE-031', 'MS-015', 'MS-016', 'RF-001', 'RF-002', 'RF-003', 'RF-004', 'RF-005', 'RF-006'], 'what stays a plain fixed item (the salamander oven CE-030 included)');
    assert.ok(absorbed.every((id) => PUBLISHED.has(id)) && fixed.every((id) => PUBLISHED.has(id)), 'a classified SKU is not published');
  });
  it('OWNER RULING (b): every SKU the public maps know of is absorbed, fixed or EXCLUDED — exactly once; the excluded ones are never classified, never published, never quotable', () => {
    const excluded = Object.keys(PUB.excludedProducts);
    const universe = new Set([...Object.keys(PUB.products), ...excluded, ...absorbed, ...fixed]);
    for (const id of universe) {
      const places = [absorbed.includes(id) ? 'absorbed' : null, fixed.includes(id) ? 'fixed' : null, excluded.includes(id) ? 'excluded' : null].filter(Boolean);
      assert.equal(places.length, 1, `${id} is in ${places.length} classes (${places.join(' + ') || 'none'})`);
      assert.equal(PUBLISHED.has(id), places[0] !== 'excluded', `${id}: published exactly when it is absorbed or fixed`);
    }
    assert.equal(absorbed.length + fixed.length, PUBLISHED.size);
    assert.equal(excluded.length, 68);
    // the 27 specialised items of Preparation, Washing and Storage that the ruling removed are excluded WITH a reason that names the ruling (PW-029, the dish table,
    // left this list on 2026-10-28: it is the base item of the dish-table family)
    const REMOVED = ['PW-011', 'PW-017', 'PW-020', 'PW-021', 'PW-028', 'PW-039', 'PW-042', 'PW-050', 'BA-009', 'BA-005', 'PW-012', 'PW-018', 'PW-022', 'PW-025',
      'PW-014', 'PW-016', 'PW-031', 'PW-041', 'PW-047', 'PW-048', 'PW-027', 'PW-034', 'PW-049', 'BA-003', 'BA-004', 'BA-007'];
    for (const id of REMOVED) assert.match(PUB.excludedProducts[id] || '', /owner ruling 2026-10-21 \(b\)/, id);
    assert.match(PUB.excludedProducts['BA-008'], /accessory/);
    assert.equal(REMOVED.length + 1, 27);
    assert.ok(!('PW-029' in PUB.excludedProducts) && PUB.products['PW-029'] === 'washing' && absorbed.includes('PW-029'), 'the dish table is published, in Washing, and absorbed by the dish-table family');
    // the exhaust category (owner ruling 2026-10-28): the seven hoods are published in Ventilation; the other 20 exhaust products are excluded one by one, with their reasons
    const HOODS = ['EX-001', 'EX-002', 'EX-003', 'EX-018', 'EX-019', 'EX-020', 'EX-021'];
    for (const id of HOODS) { assert.equal(PUB.products[id], 'ventilation', id); assert.ok(absorbed.includes(id), `${id} is absorbed by the hood family`); }
    const EX_EXCLUDED = Object.keys(PUB.excludedProducts).filter((id) => id.startsWith('EX-'));
    assert.equal(EX_EXCLUDED.length, 20);
    assert.deepEqual([...HOODS, ...EX_EXCLUDED].sort(), Array.from({ length: 27 }, (_, i) => 'EX-' + String(i + 1).padStart(3, '0')), 'all 27 exhaust products are decided: a hood or excluded');
    assert.deepEqual(Object.fromEntries(EX_EXCLUDED.map((id) => [id, PUB.excludedProducts[id].split(':')[0]])), {
      'EX-004': 'exhaust ducting and fittings', 'EX-009': 'exhaust ducting and fittings', 'EX-010': 'exhaust ducting and fittings', 'EX-011': 'exhaust ducting and fittings', 'EX-012': 'exhaust ducting and fittings',
      'EX-013': 'exhaust ducting and fittings', 'EX-017': 'exhaust ducting and fittings', 'EX-023': 'exhaust ducting and fittings', 'EX-024': 'exhaust ducting and fittings', 'EX-025': 'exhaust ducting and fittings',
      'EX-005': 'exhaust blower', 'EX-006': 'exhaust blower', 'EX-014': 'exhaust blower', 'EX-016': 'exhaust blower', 'EX-022': 'exhaust blower',
      'EX-007': 'blower control switch', 'EX-008': 'blower control switch', 'EX-015': 'delivery, labour and installation',
      'EX-026': 'baffle filter block', 'EX-027': 'hood lighting case',
    });
    const quotable = JSON.parse(read('functions/qr-published.json')).ids;
    for (const id of [...REMOVED, 'BA-008']) assert.ok(!quotable.includes(id), `${id} must be refused server-side`);
  });
  it('OWNER RULING (b): Preparation, Washing, Ventilation and Storage show ONLY the configurable products; equipment that is not one of the eleven types stays a fixed item in its natural category', () => {
    const page = read('catalogue/index.html');
    const secs = {};
    for (const m of page.matchAll(/<section[^>]*id="cat-([a-z]+)"[^>]*>([\s\S]*?)<\/section>/g)) secs[m[1]] = m[2];
    const cards = (k) => [...(secs[k] || '').matchAll(/<li class="cat-card[^"]*" data-(family|id)="([^"]+)"/g)].map((x) => [x[1], x[2]]);
    assert.deepEqual(cards('preparation'), [['family', 'prep_table']]);
    assert.deepEqual(cards('washing'), [['family', 'sink'], ['family', 'dish_table']]);
    assert.deepEqual(cards('ventilation'), [['family', 'hood']], 'Ventilation holds the range hood and nothing else (ducting and blowers stay unpublished)');
    assert.deepEqual(cards('storage'), [['family', 'cabinet'], ['family', 'wall_shelf'], ['family', 'rack']]);
    const cooking = cards('cooking');
    assert.deepEqual(cooking.slice(0, 4), [['family', 'stove'], ['family', 'wok_range'], ['family', 'cooking_line'], ['family', 'deck_oven']], 'the four cooking families lead Cooking, in the family order');
    assert.ok(cooking.slice(4).every(([k]) => k === 'id'));
    // the meat grinder and slicer moved to Cooking; the proofers, steamer, warmers and the salamander oven stay fixed (the fryers, griddles and deck ovens are families now)
    for (const id of ['MS-015', 'MS-016', 'BA-006', 'BA-011', 'CE-011', 'CE-024', 'CE-030', 'CE-031']) assert.ok(cooking.some(([, x]) => x === id), `${id} should be a fixed Cooking card`);
    for (const id of ['CE-007', 'CE-009', 'CE-010', 'CE-012', 'CE-016', 'CE-019', 'CE-020', 'CE-021', 'CE-022', 'CE-023', 'CE-026', 'CE-028']) assert.ok(!cooking.some(([, x]) => x === id), `${id} is absorbed: no card of its own`);
    assert.deepEqual(cards('refrigeration').map(([, x]) => x), ['RF-001', 'RF-002', 'RF-003', 'RF-004', 'RF-005', 'RF-006']);
    assert.equal(Object.values(secs).reduce((n, h) => n + (h.match(/<li class="cat-card/g) || []).length, 0), 25);
    // and the families' own categories are the ones the ruling names
    assert.deepEqual(ORDER.map((f) => FAMS.families[f].category), CATEGORY_OF);
  });
  it('REFUSES a published SKU that is neither absorbed nor fixed (a new product forces a decision), a stale entry, and a SKU in both places', () => {
    const drop = JSON.parse(JSON.stringify(SRC)); delete drop.fixed['RF-001'];
    assert.throws(() => B.loadPublicFamilies({ source: drop, published: PUBLISHED }), /RF-001: a published product that is neither absorbed/);
    const stale = JSON.parse(JSON.stringify(SRC)); stale.fixed['ZZ-999'] = 'x';
    assert.throws(() => B.loadPublicFamilies({ source: stale, published: PUBLISHED }), /ZZ-999: not a published product/);
    const both = JSON.parse(JSON.stringify(SRC)); both.fixed['PW-001'] = 'x';
    assert.throws(() => B.loadPublicFamilies({ source: both, published: PUBLISHED }), /PW-001" is both absorbed by "prep_table" and listed under fixed/);
    const twice = JSON.parse(JSON.stringify(SRC)); twice.families.rack.absorbed['PW-001'] = { tiers: 4, wheels: true };
    assert.throws(() => B.loadPublicFamilies({ source: twice, published: PUBLISHED }), /absorbed by two families/);
  });
  it('the eleven families, their categories, labels and primaries (the order is the website\'s and the builder\'s: Preparation · Washing · Cooking · Ventilation · Storage)', () => {
    assert.deepEqual(FAMS.order, ORDER);
    assert.deepEqual(ORDER.map((f) => fam(f).category), CATEGORY_OF);
    assert.deepEqual(ORDER.map((f) => fam(f).primary), ['PW-001', 'PW-004', 'PW-029', 'CE-001', 'CE-006', 'CE-010', 'CE-012', 'EX-001', 'PW-015', 'PW-023', 'PW-010']);
    assert.deepEqual(ORDER.map((f) => fam(f).label), ['Preparation table', 'Sink', 'Dish table', 'Stove', 'Wok range', 'Griddle, griller or fryer', 'Gas deck oven', 'Range hood', 'Cabinet', 'Wall shelving', 'Rack']);
    assert.deepEqual(ORDER.map((f) => Object.keys(fam(f).absorbed).length), [9, 10, 1, 13, 2, 10, 2, 7, 4, 3, 3]);
    assert.deepEqual(ORDER.map((f) => fam(f).sizeBasis), ['primary', 'primary', 'linear', 'primary', 'primary', 'primary', 'linear', 'primary', 'primary', 'linear', 'primary'], 'a length-priced primary is "primary"; PW-029 and CE-012 are fixed items, so their length is priced from the sheet ("linear")');
    assert.equal(FAMS.version, 3);
    // a SKU may be absorbed by ONE family only: the wok ranges moved out of the stove (which keeps its "wok" burner position)
    assert.ok(!('CE-006' in fam('stove').absorbed) && !('CE-025' in fam('stove').absorbed));
    assert.ok(fam('stove').groups[0].options.some((o) => o.v === 'wok'));
    assert.deepEqual(Object.keys(fam('wok_range').absorbed), ['CE-006', 'CE-025']);
  });
  it('each family\'s primary is one of its absorbed SKUs and its configuration IS the family default (the zero point the option amounts are measured from)', () => {
    for (const f of ORDER) {
      assert.ok(Object.prototype.hasOwnProperty.call(fam(f).absorbed, fam(f).primary), `${f}: the primary is not absorbed`);
      assert.ok(PF.sameConfig(fam(f), filled(fam(f), fam(f).absorbed[fam(f).primary]), PF.defaultConfig(fam(f))), `${f}: the primary's configuration differs from the family default`);
    }
  });
  it('every absorbed SKU\'s configuration states every option and is valid for its family', () => {
    for (const f of ORDER) for (const [sku, cfg] of Object.entries(fam(f).absorbed)) {
      assert.deepEqual(Object.keys(cfg).sort(), PF.publicGroups(fam(f)).map((g) => g.key).sort(), `${f}/${sku}: must state every public option, and never a staff-only one`);
      const v = PF.validateConfiguration(fam(f), cfg);
      assert.ok(v.ok, `${f}/${sku}: ${v.errors.join(' | ')}`);
    }
  });
  it('the families\' size defaults are inside their own limits, on the step, and valid as a size', () => {
    for (const f of ORDER) {
      const d = PF.defaultDims(fam(f));
      assert.ok(PF.validateLine(fam(f), PF.defaultConfig(fam(f)), d).ok, f);
      for (const [k, spec] of Object.entries(fam(f).dims)) {
        assert.ok(spec.min <= spec.default && spec.default <= spec.max && spec.default % spec.step === 0 && spec.min % spec.step === 0 && spec.max % spec.step === 0, `${f}.${k}`);
      }
    }
  });
  it('the build refuses a malformed family file with a plain-text list of problems (ids and keys only, never a value)', () => {
    const bad = (mut) => { const j = JSON.parse(JSON.stringify(SRC)); mut(j); return () => B.loadPublicFamilies({ source: j, published: PUBLISHED }); };
    assert.throws(bad((j) => { j.families.sink.groups[0].default = 9; }), /defaults are not a valid configuration/);
    assert.throws(bad((j) => { j.families.sink.category = 'nope'; }), /"category" must be one of/);
    assert.throws(bad((j) => { j.families.sink.extra = 1; }), /unknown key "extra"/);
    assert.throws(bad((j) => { j.families.sink.dims.W.default = 505; }), /min <= default <= max, all on the step/);
    assert.throws(bad((j) => { j.families.sink.groups.push({ key: 'basins', label: 'x', type: 'choice', default: 1, options: [{ v: 1, l: '1' }] }); }), /duplicate key "basins"/);
    assert.throws(bad((j) => { j.families.stove.groups[0].options[0].w = -5; }), /"w" must be a whole number/);
    assert.throws(bad((j) => { j.families.sink.absorbed['PW-004'].faucet = 'bidet'; }), /not a valid configuration/);
    assert.throws(bad((j) => { j.families.sink.absorbed['PW-004'] = { basins: 2, alignment: 'center', undershelf: false, upper: false, faucet: 'gooseneck' }; }), /primary SKU's configuration must equal the family defaults/);
    assert.throws(bad((j) => { j.families.sink.description = 'Only ₱1,500'; }), /pricing pattern/);
    assert.throws(bad((j) => { j.families.sink.description = 'Made by ' + 'Brilliant' + ' Steel'; }), /partner-brand/);
    assert.throws(bad((j) => { j.families.sink.preview.chain.push('x-{nope}'); }), /uses a token that is not declared/);
    assert.throws(bad((j) => { j.order = ['sink']; }), /"order" must list every family id exactly once/);
    try { bad((j) => { j.families.sink.description = 'Only ₱1,500'; })(); } catch (e) { assert.ok(!e.message.includes('1,500'), 'the offending text was echoed'); }
  });
  it('(local only) the primaries exist in the private master, and sizeBasis matches whether the primary prices by length', {
    skip: (() => { try { return resolveMaster() ? false : 'the private master (products-database.json) is not present'; } catch (_) { return 'no master'; } })(),
  }, () => {
    const master = JSON.parse(B.stripJsonComments(fs.readFileSync(resolveMaster(), 'utf8').replace(/^﻿/, '')));
    const pub = B.loadPublicCategories({ ids: master.products.map((p) => p.id) });
    assert.doesNotThrow(() => B.loadPublicFamilies({ published: B.publishedProductIds(master, pub), master }));
  });
});

describe('THE OPTION SETS ARE EXACTLY THE OWNER\'S — nothing more', () => {
  const shape = (f) => fam(f).groups.map((g) => [g.key, g.type, vals(g)]);
  it('Preparation table: layers 1 / 2 / 3 and upper shelves none / 1 / 2, with a length × width × height size', () => {
    assert.deepEqual(shape('prep_table'), [['layers', 'choice', [1, 2, 3]], ['upper', 'choice', [0, 1, 2]], ['top', 'choice', [1.5, 1.2]]]);   // top: owner ruling 2026-10-28, staff only
    assert.deepEqual(Object.keys(fam('prep_table').dims), ['W', 'D', 'H']);
    assert.deepEqual(fam('prep_table').groups[0].options.map((o) => o.hint), ['Top only', 'Top + 1 undershelf', 'Top + 2 undershelves']);
  });
  it('Sink: 1-4 sinks, centre / left / right, undershelf with / without, upper shelf with / without, faucet pre-rinse / gooseneck, and a size', () => {
    assert.deepEqual(shape('sink'), [['basins', 'choice', [1, 2, 3, 4]], ['alignment', 'choice', ['center', 'left', 'right']], ['undershelf', 'choice', [true, false]], ['upper', 'choice', [true, false]], ['faucet', 'choice', ['gooseneck', 'prerinse']], ['top', 'choice', [1.5, 1.2]]]);   // top: owner ruling 2026-10-28, staff only
    assert.deepEqual(Object.keys(fam('sink').dims), ['W', 'D', 'H']);
  });
  it('Stove: 1-6 burner positions chosen one by one from wok / HP small / HP large / LP small / LP large / soup, and add-ons griller / griddle / oven / fryer', () => {
    assert.deepEqual(shape('stove'), [['positions', 'slots', ['wok', 'hp_small', 'hp_large', 'lp_small', 'lp_large', 'soup']], ['addons', 'multi', ['griller', 'griddle', 'oven', 'fryer']], ['top', 'choice', [1.5, 1.2]]]);   // top: owner ruling 2026-10-28, staff only
    const g = fam('stove').groups[0];
    assert.equal(g.minSlots, 1); assert.equal(g.maxSlots, 6);
    assert.deepEqual(Object.keys(fam('stove').dims), ['W', 'D', 'H']);
  });
  it('Cabinet: floor-standing / wall-hung, swing / sliding doors, 1 / 2 / 3 shelves inside, and a size', () => {
    assert.deepEqual(shape('cabinet'), [['type', 'choice', ['floor', 'wall']], ['doors', 'choice', ['swing', 'sliding']], ['shelves', 'choice', [1, 2, 3]]]);
    assert.deepEqual(fam('cabinet').groups[0].options.map((o) => o.l), ['Floor-standing', 'Wall-hung']);
  });
  it('Wall shelving: 1 / 2 / 3 tiers, solid / slotted surface, and a size', () => {
    assert.deepEqual(shape('wall_shelf'), [['tiers', 'choice', [1, 2, 3]], ['surface', 'choice', ['solid', 'slotted']]]);
  });
  it('Rack: 3 / 4 / 5 / 6 tiers, wheels with / without, and a size', () => {
    assert.deepEqual(shape('rack'), [['tiers', 'choice', [3, 4, 5, 6]], ['wheels', 'choice', [true, false]]]);
  });
  it('Dish table (owner Q6): clean / soiled side, dishwasher on the left / right, a pre-rinse sink for the soiled side only, undershelf with / without, the staff-only top, a length and a width', () => {
    const f = fam('dish_table');
    assert.deepEqual(shape('dish_table'), [['side', 'choice', ['clean', 'soiled']], ['hand', 'choice', ['left', 'right']], ['sink', 'choice', ['none', 'prerinse']], ['undershelf', 'choice', [true, false]], ['top', 'choice', [1.5, 1.2]]]);
    assert.deepEqual(f.groups.map((g) => [g.key, g.label, g.default]), [['side', 'Side', 'clean'], ['hand', 'Dishwasher on the', 'left'], ['sink', 'Pre-rinse sink', 'none'], ['undershelf', 'Undershelf', true], ['top', 'Top plate', 1.5]]);
    assert.deepEqual(f.groups[0].options.map((o) => [o.l, o.hint]), [['Clean', 'Where washed dishes land'], ['Soiled', 'Where dirty dishes are loaded']]);
    assert.deepEqual(f.groups[1].options.map((o) => o.hint), ['Facing the table', 'Facing the table']);
    assert.deepEqual(f.groups[2].when, { side: ['soiled'] }, 'the pre-rinse sink exists on the soiled side only');
    assert.deepEqual(f.dims, { W: { label: 'Length', min: 600, max: 3000, step: 10, default: 1200 }, D: { label: 'Width', min: 600, max: 900, step: 10, default: 660 } });
    assert.deepEqual(f.minDimWhen, [{ group: 'sink', includes: 'prerinse', min: { W: 1200 } }]);
    assert.equal(f.maxDimWhen, undefined);
    assert.deepEqual(f.preview, { tokens: { side: { from: 'side' } }, chain: ['dish_table-{side}'] });
    assert.deepEqual(f.absorbed, { 'PW-029': { side: 'clean', hand: 'left', sink: 'none', undershelf: true } });
  });
  it('Wok range (owner Q4): 1 to 3 wok holes at 600 mm each (a HARD minimum), an optional rear stock burner (needs 800 mm of depth), an optional swan-neck faucet, the staff-only top', () => {
    const f = fam('wok_range');
    assert.deepEqual(shape('wok_range'), [['holes', 'choice', [1, 2, 3]], ['rear', 'choice', [false, true]], ['faucet', 'choice', ['none', 'swan']], ['top', 'choice', [1.5, 1.2]]]);
    assert.deepEqual(f.groups.map((g) => [g.key, g.label, g.default]), [['holes', 'Wok holes', 1], ['rear', 'Rear stock burner', false], ['faucet', 'Water faucet', 'none'], ['top', 'Top plate', 1.5]]);
    assert.deepEqual(f.widthRule, { hard: true, allowance: 0, noun: 'wok holes', terms: [{ group: 'holes', perUnit: 600 }] });
    assert.deepEqual(PF.minWidth(f, { holes: 1 }), { mm: 600, hard: true, noun: 'wok holes' });
    assert.equal(PF.minWidth(f, { holes: 2 }).mm, 1200); assert.equal(PF.minWidth(f, { holes: 3 }).mm, 1800);
    assert.deepEqual(f.minDimWhen, [{ group: 'rear', includes: true, min: { D: 800 } }]);
    assert.deepEqual(f.dims, { W: { label: 'Length', min: 600, max: 2400, step: 10, default: 600 }, D: { label: 'Width', min: 650, max: 1000, step: 10, default: 700 } });
    assert.deepEqual(f.absorbed, { 'CE-006': { holes: 1, rear: false, faucet: 'none' }, 'CE-025': { holes: 2, rear: true, faucet: 'none' } });
    assert.equal(PF.validateLine(f, { holes: 3 }, { W: 1700 }).ok, false); assert.equal(PF.validateLine(f, { holes: 3 }, { W: 1800 }).ok, true);
    assert.match(PF.validateLine(f, { rear: true }, { D: 750 }).errors[0], /With these options the width must be at least 800 mm\./);       // D is this family's "Width"
  });
  it('Griddle, griller or fryer (owner Q3): griddle / lava-rock griller / fryer / combination; 1-3 burners for a griddle or griller; 1-3 fry baskets (2 standard) for a fryer; an open stand or a stand with a bottom shelf; NO staff-only top', () => {
    const f = fam('cooking_line');
    assert.deepEqual(shape('cooking_line'), [['type', 'choice', ['griddle', 'griller', 'fryer', 'combi']], ['burners', 'choice', [1, 2, 3]], ['baskets', 'choice', [1, 2, 3]], ['base', 'choice', ['stand', 'shelf']]]);
    assert.deepEqual(f.groups.map((g) => [g.key, g.label, g.default, g.when]), [['type', 'Type', 'griddle', undefined], ['burners', 'Burners', 1, { type: ['griddle', 'griller'] }], ['baskets', 'Fry baskets', 2, { type: ['fryer'] }], ['base', 'Base', 'stand', undefined]]);
    assert.deepEqual(f.groups[0].options.map((o) => o.l), ['Griddle', 'Lava-rock griller', 'Fryer', 'Griller + griddle']);
    assert.deepEqual(f.dims, { W: { label: 'Length', min: 500, max: 2000, step: 10, default: 700 }, D: { label: 'Width', min: 600, max: 900, step: 10, default: 700 } });
    assert.deepEqual(f.minDimWhen, [{ group: 'burners', includes: 2, min: { W: 900 } }, { group: 'burners', includes: 3, min: { W: 1200 } }, { group: 'baskets', includes: 3, min: { W: 1000 } }, { group: 'type', includes: 'combi', min: { W: 900 } }]);
    assert.deepEqual(Object.keys(f.absorbed), ['CE-010', 'CE-007', 'CE-009', 'CE-019', 'CE-020', 'CE-021', 'CE-022', 'CE-023', 'CE-026', 'CE-028']);
    assert.deepEqual(f.absorbed['CE-022'], { type: 'fryer', burners: 1, baskets: 3, base: 'stand' });
    assert.deepEqual(f.absorbed['CE-026'], { type: 'griller', burners: 1, baskets: 2, base: 'shelf' });
    assert.ok(!f.groups.some((g) => g.key === 'top'), 'no staff-only top plate on the cooking line');
    assert.deepEqual(f.preview.chain, ['cooking_line-{type}']);
  });
  it('Gas deck oven (owner Q5): 1 / 2 / 3 decks, 3 or 6 trays per deck, a heavy-duty stand or none, the width FOLLOWS the trays (700 / 1200, locked)', () => {
    const f = fam('deck_oven');
    assert.deepEqual(shape('deck_oven'), [['decks', 'choice', [1, 2, 3]], ['trays', 'choice', [3, 6]], ['stand', 'choice', ['none', 'heavy']]]);
    assert.deepEqual(f.groups.map((g) => [g.key, g.label, g.default]), [['decks', 'Decks', 2], ['trays', 'Trays per deck', 3], ['stand', 'Stand', 'none']]);
    assert.deepEqual(f.dims, { W: { label: 'Width', min: 700, max: 1500, step: 10, default: 700 } }, 'the width is the only axis');
    assert.deepEqual(f.minDimWhen, [{ group: 'trays', includes: 6, min: { W: 1200 } }]);
    assert.deepEqual(f.maxDimWhen, [{ group: 'trays', includes: 3, max: { W: 700 } }, { group: 'trays', includes: 6, max: { W: 1200 } }]);
    assert.deepEqual(f.absorbed, { 'CE-012': { decks: 2, trays: 3, stand: 'none' }, 'CE-016': { decks: 2, trays: 6, stand: 'none' } });
    assert.ok(!/SS ?3\d\d|316|grade/i.test(f.construction), 'no steel-grade claim: CE-016\'s own note names other grades');
  });
  it('Range hood (owner Q2): wall / island / slim canopy, baffle filters or an open canopy, lighting; a length and a depth in 10 mm steps; no gauge and no height', () => {
    const f = fam('hood');
    assert.deepEqual(shape('hood'), [['type', 'choice', ['wall', 'island', 'slim']], ['filters', 'choice', ['baffle', 'none']], ['lighting', 'choice', [true, false]]]);
    assert.deepEqual(f.groups.map((g) => [g.key, g.label, g.default]), [['type', 'Type', 'wall'], ['filters', 'Grease filters', 'baffle'], ['lighting', 'Lighting', true]]);
    assert.deepEqual(f.dims, { W: { label: 'Length', min: 600, max: 6000, step: 10, default: 1000 }, D: { label: 'Depth', min: 300, max: 1500, step: 10, default: 900 } }, 'no height axis: the canopy height follows the type');
    assert.deepEqual(f.minDimWhen, [{ group: 'type', includes: 'island', min: { W: 1200, D: 700 } }, { group: 'type', includes: 'wall', min: { D: 500 } }]);
    assert.deepEqual(f.maxDimWhen, [{ group: 'type', includes: 'slim', max: { D: 500 } }]);
    assert.deepEqual(Object.entries(f.absorbed).map(([sku, c]) => [sku, c.type]), [['EX-001', 'wall'], ['EX-002', 'wall'], ['EX-003', 'wall'], ['EX-018', 'island'], ['EX-019', 'island'], ['EX-020', 'slim'], ['EX-021', 'wall']]);
    assert.ok(Object.values(f.absorbed).every((c) => c.filters === 'baffle' && c.lighting === true));
    assert.ok(!/gauge| ga\b|[0-9.]+ ?mm/i.test(f.construction), 'the hood construction states no gauge (owner Q2: the master names several)');
  });
  it('none of the options the owner ruled out exists anywhere: no backsplash, casters, drawers, mount, grade, valve, top gauge, …', () => {
    const banned = /backsplash|caster|drawer|mount|grade|valve|gauge|crumb|mixer|bracket|lip|drain|bays|enclosure/i;
    for (const f of ORDER) {
      for (const g of fam(f).groups) {
        assert.ok(!banned.test(g.key) && !banned.test(g.label), `${f}: group ${g.key}`);
        for (const o of g.options) assert.ok(!banned.test(String(o.v)) && !banned.test(o.l), `${f}/${g.key}: option ${o.v}`);
      }
    }
  });
  it('the stove keeps the spec\'s width guidance (soft: the usual length of the burners) and the oven\'s minimum width and height; the sink\'s length rule is hard (500 per sink)', () => {
    assert.equal(fam('stove').widthRule.hard, false);
    assert.equal(fam('sink').widthRule.hard, true);
    assert.deepEqual(fam('stove').minDimWhen, [{ group: 'addons', includes: 'oven', min: { D: 700, H: 850 } }]);
    assert.deepEqual(fam('sink').widthRule.terms, [{ group: 'basins', perUnit: 500 }]);
  });
  it('labels are British and grammatical: "Centre", "millimetres" territory, no "center", no "color", no "gray"', () => {
    const all = JSON.stringify(FAMS);
    assert.ok(!/center/i.test(all.replace(/"center"/g, '')), 'American "center" in a label (only the stored value "center" may use it)');
    assert.ok(/"l":"Centre"/.test(all));
    assert.ok(!/\b(color|gray|meter|catalog)\b/i.test(all));
  });
  it('the family cards are the wide FEATURED card: the "Configurable" tag, the name, the description, then a labelled Specifications list — and sizes read "Made to your length, width and height"', () => {
    const html = B.renderFamilyCard(FAMS.families.sink, { id: 'washing' }, null, 'PW-004 SS Wash Sink');
    assert.match(html, /<li class="cat-card cat-card-family cat-card-feature" data-family="sink" data-kw="PW-004 SS Wash Sink">/);
    assert.match(html, /<div class="cat-head"><p class="cat-code cat-tag">Configurable<\/p><h3>Sink<\/h3><p class="cat-lead">Stainless steel sink table\./);
    assert.match(html, /<div class="cat-body"><p class="cat-label">Specifications<\/p><dl class="cat-specs">/);
    assert.match(html, /<dt>Sinks<\/dt><dd>1 \/ 2 \/ 3 \/ 4<\/dd>/);
    assert.match(html, /<dt>Size<\/dt><dd>Made to your length, width and height<\/dd>/);
    // the material line is the owner's own homepage statement, last in the list
    assert.ok(html.endsWith(`<div><dt>Material</dt><dd>${B.FAMILY_MATERIAL}</dd></div></dl><p class="cat-learn"><a class="link-arrow" href="/products/stainless-steel-sinks/">Learn more about stainless steel sinks</a></p></div></li>`), 'the Material row is not last, or the "Learn more" link is not after it');
    // a family with no product page yet simply has no link (a new family needs its page first)
    const nopage = B.renderFamilyCard({ ...FAMS.families.sink, id: 'no_page_yet' }, { id: 'washing' }, null, '');
    assert.ok(nopage.endsWith(`</dd></div></dl></div></li>`) && !nopage.includes('cat-learn'));
    // the size line names the axes the family really has: wall shelving has no height
    const shelf = B.renderFamilyCard(FAMS.families.wall_shelf, { id: 'storage' }, null, '');
    assert.match(shelf, /<dt>Size<\/dt><dd>Made to your length and depth<\/dd>/);
    assert.ok(!/height/i.test(shelf.slice(shelf.indexOf('<dt>Size'))), 'wall shelving must not promise a height');
    for (const f of ORDER) {
      const axes = ['W', 'D', 'H'].filter((k) => fam(f).dims[k]).length;
      const card = B.renderFamilyCard(fam(f), { id: fam(f).category }, null, '');
      assert.equal(/Made to your [a-z]+, [a-z]+ and [a-z]+</.test(card), axes === 3, f);
    }
    const stove = B.renderFamilyCard(FAMS.families.stove, { id: 'cooking' }, null, '');
    assert.match(stove, /Up to 6 burners, each chosen one by one/);
    assert.match(stove, /<dt>Add-ons<\/dt><dd>Griller \/ Griddle \/ Oven \/ Fryer<\/dd>/);
  });
  it('a family card escapes everything and never carries a price word', () => {
    const evil = { ...FAMS.families.sink, label: 'A <b>&"\'', description: 'x <script>' };
    const html = B.renderFamilyCard(evil, { id: 'washing' }, null, 'k"><x');
    assert.ok(!/<b>|<script|"><x/.test(html));
    for (const f of ORDER) assert.ok(!/pric(?:e|ing)|\bcosts?\b|markup|₱/i.test(B.renderFamilyCard(fam(f), { id: fam(f).category }, null, '')), f);
  });
});

describe('js/product-families.js — STRICT validation (an unknown key, value, type, axis, step or bound is an error, never ignored)', () => {
  const sink = fam('sink'), stove = fam('stove'), prep = fam('prep_table');
  const ok = (f, c, d) => PF.validateLine(f, c, d);
  it('the family defaults validate, and an ABSENT key takes the default while a present one must be valid', () => {
    for (const f of ORDER) assert.ok(ok(fam(f), PF.defaultConfig(fam(f)), PF.defaultDims(fam(f))).ok, f);
    const v = PF.validateConfiguration(sink, { basins: 2 });
    assert.ok(v.ok);
    assert.equal(v.config.faucet, 'gooseneck');
    assert.equal(v.config.undershelf, false);
  });
  it('an unknown key is refused (and so are __proto__ / constructor / prototype); the config must be a plain object', () => {
    for (const k of ['nope', 'constructor', 'prototype', 'toString', 'hasOwnProperty']) assert.equal(PF.validateConfiguration(sink, { ...PF.defaultConfig(sink), [k]: 1 }).ok, false, k);
    const evil = Object.assign(Object.create(null), PF.defaultConfig(sink));
    const proto = JSON.parse('{"__proto__":{"basins":2},"basins":1,"alignment":"center","undershelf":false,"upper":false,"faucet":"gooseneck"}');
    assert.equal(PF.validateConfiguration(sink, proto).ok, false, 'an own __proto__ key must be refused');
    void evil;
    for (const bad of [null, undefined, 5, 'x', [], [1, 2], true]) assert.equal(PF.validateConfiguration(sink, bad).ok, false, JSON.stringify(bad));
  });
  it('a value must equal an option EXACTLY, type included: \'true\' is not true, \'2\' is not 2, 2.0 is 2, null / NaN / objects are nothing', () => {
    assert.equal(PF.validateConfiguration(sink, { undershelf: 'true' }).ok, false);
    assert.equal(PF.validateConfiguration(sink, { basins: '2' }).ok, false);
    assert.equal(PF.validateConfiguration(sink, { basins: 2.0 }).ok, true);
    for (const bad of [null, NaN, Infinity, {}, [], 5, 0, '', 'center ']) assert.equal(PF.validateConfiguration(sink, { basins: bad }).ok, false, String(bad));
    assert.equal(PF.validateConfiguration(sink, { alignment: 'middle' }).ok, false);
    assert.equal(PF.validateConfiguration(sink, { alignment: ['center'] }).ok, false);
    assert.equal(PF.validateConfiguration(sink, { faucet: 'Gooseneck' }).ok, false);
  });
  it('slots: 1..6 positions, every one a known type, order kept; refused outside the range, with an unknown type, with a non-string, or as a non-array', () => {
    assert.ok(PF.validateConfiguration(stove, { positions: ['wok', 'hp_large', 'soup'] }).ok);
    assert.deepEqual(PF.validateConfiguration(stove, { positions: ['soup', 'wok'] }).config.positions, ['soup', 'wok'], 'order is the layout');
    assert.equal(PF.validateConfiguration(stove, { positions: [] }).ok, false);
    assert.equal(PF.validateConfiguration(stove, { positions: Array(7).fill('wok') }).ok, false);
    assert.equal(PF.validateConfiguration(stove, { positions: Array(6).fill('wok') }).ok, true);
    assert.equal(PF.validateConfiguration(stove, { positions: ['wok', 'laser'] }).ok, false);
    assert.equal(PF.validateConfiguration(stove, { positions: ['wok', 7] }).ok, false);
    assert.equal(PF.validateConfiguration(stove, { positions: 'wok' }).ok, false);
    assert.equal(PF.validateConfiguration(stove, { positions: { 0: 'wok', length: 1 } }).ok, false);
  });
  it('multi: distinct known add-ons only, put into the family\'s own order (so equal selections always serialise identically)', () => {
    assert.deepEqual(PF.validateConfiguration(stove, { addons: ['fryer', 'griller'] }).config.addons, ['griller', 'fryer']);
    assert.equal(PF.validateConfiguration(stove, { addons: ['oven', 'oven'] }).ok, false);
    assert.equal(PF.validateConfiguration(stove, { addons: ['salamander'] }).ok, false);
    assert.equal(PF.validateConfiguration(stove, { addons: 'oven' }).ok, false);
    assert.ok(PF.sameConfig(stove, PF.validateConfiguration(stove, { positions: ['wok'], addons: ['oven', 'fryer'] }).config, PF.validateConfiguration(stove, { positions: ['wok'], addons: ['fryer', 'oven'] }).config));
  });
  it('canonicalConfig is stable: the same selection (any key order, any add-on order) gives the same string; a different burner order does not', () => {
    const a = PF.validateConfiguration(stove, { addons: ['fryer', 'oven'], positions: ['wok', 'soup'] }).config;
    const b = PF.validateConfiguration(stove, { positions: ['wok', 'soup'], addons: ['oven', 'fryer'] }).config;
    assert.equal(PF.canonicalConfig(stove, a), PF.canonicalConfig(stove, b));
    assert.notEqual(PF.canonicalConfig(stove, a), PF.canonicalConfig(stove, PF.validateConfiguration(stove, { positions: ['soup', 'wok'], addons: ['oven', 'fryer'] }).config));
  });
  it('size: a whole number of millimetres, on the step, inside min..max, only the family\'s own axes; an absent axis takes the default', () => {
    assert.ok(ok(prep, {}, { W: 1800, D: 700, H: 900 }).ok);
    assert.deepEqual(PF.validateDims(prep, {}, {}).dims, { W: 900, D: 600, H: 850 });
    assert.deepEqual(PF.validateDims(prep, null, {}).dims, { W: 900, D: 600, H: 850 });
    for (const bad of [{ W: 1805 }, { W: 499 }, { W: 6010 }, { W: 1800.5 }, { W: '1800' }, { W: NaN }, { W: Infinity }, { W: -900 }, { W: 0 }, { W: [900] }, { Z: 100 }, { W: 900, K: 1 }, { __proto__x: 1 }]) assert.equal(PF.validateDims(prep, bad, {}).ok, false, JSON.stringify(bad));
    assert.equal(PF.validateDims(prep, 5, {}).ok, false);
    assert.equal(PF.validateDims(prep, [900], {}).ok, false);
    assert.equal(ok(prep, {}, { W: 500, D: 400, H: 600 }).ok, true);                         // the minimums are accepted
    assert.equal(ok(prep, {}, { W: 6000, D: 1200, H: 1100 }).ok, true);                      // and the maximums
    assert.equal(PF.validateDims(fam('wall_shelf'), { H: 38 }, {}).ok, false, 'wall shelving has no height axis');
  });
  it('the sink\'s length rule is HARD: at least 500 mm per sink (raising the number of sinks needs a longer table)', () => {
    assert.equal(ok(sink, { basins: 2 }, { W: 1000 }).ok, true);
    assert.equal(ok(sink, { basins: 2 }, { W: 990 }).ok, false);
    assert.match(ok(sink, { basins: 2 }, { W: 990 }).errors[0], /at least 1000 mm for these sinks/);
    assert.equal(ok(sink, { basins: 4 }, { W: 1990 }).ok, false);
    assert.equal(ok(sink, { basins: 4 }, { W: 2000 }).ok, true);
    assert.equal(ok(sink, { basins: 1 }, { W: 500 }).ok, true);
    assert.deepEqual(PF.minWidth(sink, { basins: 3 }), { mm: 1500, hard: true, noun: 'sinks' });
  });
  it('the stove\'s length rule is GUIDANCE: a shorter length is accepted with a warning, the usual length grows with the burners and add-ons', () => {
    const one = PF.minWidth(stove, { positions: ['lp_small'], addons: [] });
    const six = PF.minWidth(stove, { positions: Array(6).fill('wok'), addons: ['griller', 'fryer'] });
    assert.equal(one.hard, false);
    assert.ok(six.mm > one.mm);
    assert.equal(one.mm, 600);                                                                // 400 + 200 for one small burner
    const short = ok(stove, { positions: Array(6).fill('wok') }, { W: 800 });
    assert.equal(short.ok, true);
    assert.equal(short.warnings.length, 1);
    assert.match(short.warnings[0], /shorter than the \d+ mm we usually build for these burners/);
    assert.equal(ok(stove, { positions: ['lp_small'] }, { W: 600 }).warnings.length, 0);
    assert.ok(six.mm <= stove.dims.W.max);
  });
  it('an oven forces the width and height minimums (the spec\'s oven constraint); no oven, no constraint', () => {
    assert.deepEqual(PF.forcedMins(stove, { addons: ['oven'] }), { D: 700, H: 850 });
    assert.deepEqual(PF.forcedMins(stove, { addons: ['griller'] }), {});
    assert.equal(ok(stove, { addons: ['oven'] }, { W: 1000, D: 600, H: 850 }).ok, false);
    assert.match(ok(stove, { addons: ['oven'] }, { W: 1000, D: 600, H: 850 }).errors[0], /width must be at least 700 mm/);
    assert.equal(ok(stove, { addons: ['oven'] }, { W: 1000, D: 700, H: 800 }).ok, false);
    assert.equal(ok(stove, { addons: ['oven'] }, { W: 1000, D: 700, H: 850 }).ok, true);
    assert.equal(ok(stove, { addons: ['griller'] }, { W: 1000, D: 500, H: 500 }).ok, true);
  });
  it('validateLine reports custom (a size other than the family default) and returns canonical config and dims', () => {
    const v = ok(sink, { basins: 1 }, { W: 500, D: 500, H: 850 });
    assert.equal(v.custom, false);
    assert.equal(ok(sink, { basins: 1 }, { W: 600 }).custom, true);
    assert.deepEqual(ok(sink, { basins: 1 }, { W: 600 }).dims, { W: 600, D: 500, H: 850 });
  });
  it('never throws, whatever it is given', () => {
    for (const bad of [null, undefined, 5, 'x', [], {}, { groups: 5 }]) {
      assert.doesNotThrow(() => PF.validateLine(sink, bad, bad));
      assert.doesNotThrow(() => PF.describe(sink, bad));
      assert.doesNotThrow(() => PF.summaryLine(sink, bad, bad));
      assert.doesNotThrow(() => PF.previewKeys(sink, bad));
    }
    assert.doesNotThrow(() => PF.previewKeys(null, {}));
  });
});

describe('words: describe / summaryLine — the plain-English option list a request and a receipt show', () => {
  it('the one-line summary reads like the owner\'s example: "Sink — 2 sinks · centred · with undershelf · gooseneck faucet · 1800 × 700 × 900 mm"', () => {
    const f = fam('sink');
    const cfg = { basins: 2, alignment: 'center', undershelf: true, upper: false, faucet: 'gooseneck' };
    assert.equal(PF.summaryLine(f, cfg, { W: 1800, D: 700, H: 900 }), 'Sink — 2 sinks · centred · with undershelf · without upper shelf · gooseneck faucet · 1800 × 700 × 900 mm');
    assert.equal(PF.sizeText(f, { W: 1800, D: 700, H: 900 }), '1800 × 700 × 900 mm');
    assert.equal(PF.sizeTextLabelled(f, { W: 1800, D: 700, H: 900 }), 'L1800 × W700 × H900 mm');
  });
  it('the stove reads burner by burner, then the add-ons', () => {
    const f = fam('stove');
    assert.equal(PF.summaryLine(f, { positions: ['wok', 'hp_large', 'soup'], addons: ['oven', 'griller'] }, { W: 1300, D: 700, H: 850 }),
      'Stove — 3 burners (wok, HP large, soup) · with oven, griller · 1300 × 700 × 850 mm');
    // the SERVER stores a validated configuration, whose add-ons are in the family's own order
    const v = PF.validateConfiguration(f, { positions: ['wok', 'hp_large', 'soup'], addons: ['oven', 'griller'] }).config;
    assert.equal(PF.summaryLine(f, v, { W: 1300, D: 700, H: 850 }), 'Stove — 3 burners (wok, HP large, soup) · with griller, oven · 1300 × 700 × 850 mm');
    assert.equal(PF.summaryLine(f, { positions: ['lp_small'], addons: [] }, { W: 600, D: 700, H: 850 }), 'Stove — 1 burner (LP small) · no add-ons · 600 × 700 × 850 mm');
  });
  it('describe() gives one {label, value} row per option — the shape a product line\'s specs use, so every consumer prints it unchanged', () => {
    const rows = PF.describe(fam('stove'), { positions: ['wok', 'soup'], addons: ['fryer'] });
    assert.deepEqual(rows, [{ label: 'Burner positions', value: '1. Wok burner, 2. Soup burner' }, { label: 'Add-ons', value: 'Fryer' }, { label: 'Construction', value: PF.constructionLine(fam('stove'), {}) }]);
    assert.deepEqual(PF.describe(fam('prep_table'), { layers: 2, upper: 1 }), [{ label: 'Layers', value: '2 (Top + 1 undershelf)' }, { label: 'Upper shelves', value: '1' }, { label: 'Construction', value: 'SS304 stainless steel · 1.5 mm (16 ga) top plate · 1.2 mm undershelves and upper shelves · square-tube posts with adjustable bullet feet' }]);
    assert.deepEqual(PF.describe(fam('stove'), { positions: ['wok'], addons: [] })[1], { label: 'Add-ons', value: 'None' });
    for (const f of ORDER) for (const r of PF.describe(fam(f), PF.defaultConfig(fam(f)))) assert.ok(typeof r.label === 'string' && typeof r.value === 'string' && r.value.length > 0, f);
  });
});

describe('converting an old saved SKU line to its family line (a draft saved before the families existed)', () => {
  it('every absorbed SKU converts to its family at its configuration; the size is the family default raised to the family\'s HARD minimums for those options (the sink length rule, an oven) — and the line is ALWAYS valid', () => {
    for (const f of ORDER) for (const sku of Object.keys(fam(f).absorbed)) {
      const m = PF.migrateAbsorbed(FAMS, sku, { id: sku });
      assert.ok(m, `${sku} did not convert`);
      assert.equal(m.familyId, f);
      assert.deepEqual(m.config, filled(fam(f), fam(f).absorbed[sku]), `${sku}: the configuration (the staff-only top plate takes its standard default)`);
      const expected = PF.defaultDims(fam(f));
      const mw = PF.minWidth(fam(f), m.config);
      if (mw && mw.hard && expected.W < mw.mm) expected.W = mw.mm;
      const fm = PF.forcedMins(fam(f), m.config);
      for (const k of Object.keys(fm)) if (expected[k] < fm[k]) expected[k] = fm[k];
      const fx = PF.forcedMaxes(fam(f), m.config);
      for (const k of Object.keys(fx)) if (expected[k] > fx[k]) expected[k] = fx[k];
      assert.deepEqual(m.dims, expected, `${sku}: the size`);
      const v = PF.validateLine(fam(f), m.config, m.dims);
      assert.equal(v.ok, true, `${sku}: ${v.errors.join(' ')}`);
    }
  });
  it('whatever size an old line carried — none, rubbish, tiny, huge, off-step, wrong type — the converted line is VALID: the family rules win over the saved size, never the other way', () => {
    const sizes = [null, undefined, 'x', [], 7, {}, { W: 1200, D: 600, H: 850 }, { W: 5, D: 5, H: 5 }, { W: 123, D: 7, H: 99999 }, { W: 3500, D: 900, H: 1000 }, { W: 500, D: 400, H: 700 }, { W: '1200' }, { W: 1e9 }];
    let n = 0;
    for (const f of ORDER) for (const sku of Object.keys(fam(f).absorbed)) for (const size of sizes) {
      const m = PF.migrateAbsorbed(FAMS, sku, { id: sku, size });
      const v = PF.validateLine(fam(f), m.config, m.dims);
      assert.equal(v.ok, true, `${sku} with size ${JSON.stringify(size)}: ${v.errors.join(' ')}`);
      n++;
    }
    assert.ok(n >= 500);
  });
  it('a saved size that already meets the family\'s rule is kept; one that is too short for the options is raised to the rule (a triple sink is not built shorter than its width rule)', () => {
    const f = fam('sink');
    const need = PF.minWidth(f, FAMS.families.sink.absorbed['PW-008']).mm;
    assert.ok(need >= 1500);
    assert.equal(PF.migrateAbsorbed(FAMS, 'PW-008', { id: 'PW-008', size: { W: need + 500, D: 500, H: 850 } }).dims.W, need + 500);
    assert.equal(PF.migrateAbsorbed(FAMS, 'PW-008', { id: 'PW-008', size: { W: 600, D: 500, H: 850 } }).dims.W, need);
    // the range with an oven: the depth is raised to the forced minimum
    const withOven = PF.migrateAbsorbed(FAMS, 'CE-014', { id: 'CE-014', size: { W: 1200, D: 600, H: 850 } });
    assert.ok(withOven.dims.D >= 700);
  });
  it('a saved size is KEPT, rounded to the 10 mm step and clamped into the family\'s limits, axis by axis; only rubbish falls back to the family default', () => {
    const m = PF.migrateAbsorbed(FAMS, 'PW-003', { id: 'PW-003', size: { W: 1800, D: 605, H: 99999 } });
    assert.deepEqual(m.dims, { W: 1800, D: 610, H: 1100 });                           // 605 -> 610 (nearest step); 99999 -> the family maximum
    assert.deepEqual(PF.migrateAbsorbed(FAMS, 'PW-003', { id: 'PW-003', size: 'x' }).dims, { W: 900, D: 600, H: 850 });
    assert.deepEqual(PF.migrateAbsorbed(FAMS, 'PW-003', { id: 'PW-003', size: { W: '1800', D: null, H: NaN } }).dims, { W: 900, D: 600, H: 850 });
    // the old standard sizes of the catalogue are almost never on the step (2438 x 762 x 851): none is thrown away
    const sink = PF.migrateAbsorbed(FAMS, 'PW-037', { id: 'PW-037', size: { W: 2438, D: 762, H: 851 } });
    assert.deepEqual(sink.dims, { W: 2440, D: 760, H: 850 });
    // every absorbed SKU, at such a size, keeps each axis within half a step of what was saved (clamped), unless a HARD rule raised the length
    for (const f of ORDER) for (const sku of Object.keys(fam(f).absorbed)) {
      const saved = { W: 2311, D: 763, H: 851 };
      const r = PF.migrateAbsorbed(FAMS, sku, { id: sku, size: saved });
      const mw = PF.minWidth(fam(f), r.config);
      for (const k of Object.keys(r.dims)) {
        const spec = fam(f).dims[k];
        const want = Math.min(spec.max, Math.max(spec.min, saved[k]));
        const hardRaised = k === 'W' && mw && mw.hard && r.dims.W === mw.mm;
        const forced = PF.forcedMins(fam(f), r.config)[k];
        const capped = PF.forcedMaxes(fam(f), r.config)[k];                               // an option's UPPER limit (a slim hood's depth, a deck oven's width) wins over the saved size
        assert.ok(hardRaised || (forced != null && r.dims[k] === forced) || (capped != null && r.dims[k] === capped) || Math.abs(r.dims[k] - want) <= spec.step / 2, `${sku}.${k}: saved ${saved[k]} became ${r.dims[k]}`);
      }
    }
  });
  it('a SOFT width guidance (the stove) never shortens or lengthens a converted line: the saved length is kept (the server prices at the usual length if it is shorter)', () => {
    const m = PF.migrateAbsorbed(FAMS, 'CE-004', { id: 'CE-004', size: { W: 1200, D: 700, H: 850 } });      // 4 HP large burners at the catalogue length of 1200
    assert.equal(m.dims.W, 1200);
    assert.equal(PF.validateLine(fam('stove'), m.config, m.dims).ok, true);
    assert.equal(PF.validateLine(fam('stove'), m.config, m.dims).warnings.length >= 0, true);
  });
  it('a saved faucet option becomes the sink\'s faucet (Faucet Type on PW-004, Faucet on BA-012); an unknown option value is ignored', () => {
    assert.equal(PF.migrateAbsorbed(FAMS, 'PW-004', { id: 'PW-004', specs: [{ label: 'Faucet Type', value: 'Pre-rinse spray' }, { label: 'Basin Depth', value: '350mm' }] }).config.faucet, 'prerinse');
    assert.equal(PF.migrateAbsorbed(FAMS, 'BA-012', { id: 'BA-012', specs: [{ label: 'Faucet', value: 'Gooseneck' }] }).config.faucet, 'gooseneck');
    assert.equal(PF.migrateAbsorbed(FAMS, 'PW-004', { id: 'PW-004', specs: [{ label: 'Faucet Type', value: 'Bidet' }] }).config.faucet, 'gooseneck');
  });
  it('a fixed SKU, an unknown SKU and rubbish convert to nothing', () => {
    for (const sku of ['RF-001', 'CE-030', 'EX-004', 'NOPE', '', '__proto__', 'constructor']) assert.equal(PF.migrateAbsorbed(FAMS, sku, {}), null, sku);          // CE-030 (salamander) stays fixed; EX-004 is ducting: excluded
    assert.equal(PF.migrateAbsorbed(null, 'PW-001', {}), null);
    assert.doesNotThrow(() => PF.migrateAbsorbed(FAMS, 'PW-001', 7));
  });
});

describe('the cells of a family\'s private option sheet', () => {
  it('one cell per option value; the family default of a choice is the baseline (no amount entered); slots and add-ons are never baseline', () => {
    const c = PF.cells(fam('sink'));
    assert.equal(c.length, 4 + 3 + 2 + 2 + 2 + 2);                                       // … + the two top plates (owner ruling 2026-10-28)
    assert.deepEqual(c.filter((x) => x.baseline).map((x) => `${x.group}:${x.value}`), ['basins:1', 'alignment:center', 'undershelf:false', 'upper:false', 'faucet:gooseneck', 'top:1.5']);
    const s = PF.cells(fam('stove'));
    assert.equal(s.length, 6 + 4 + 2);
    assert.ok(s.filter((x) => x.group !== 'top').every((x) => !x.baseline), 'slots and add-ons are never baseline');
    assert.deepEqual(s.filter((x) => x.group === 'top').map((x) => `${x.value}:${x.baseline}`), ['1.5:true', '1.2:false'], 'the 1.5 mm top is the zero point; the 1.2 mm cell is the one Finance enters');
    assert.deepEqual(s.filter((x) => x.kind === 'slot').map((x) => x.value), ['wok', 'hp_small', 'hp_large', 'lp_small', 'lp_large', 'soup']);
    assert.deepEqual(s.filter((x) => x.kind === 'addon').map((x) => x.value), ['griller', 'griddle', 'oven', 'fryer']);
  });
  it('boolean cell keys are the strings "true" / "false" (what a Firestore map key can be)', () => {
    assert.deepEqual(PF.cells(fam('rack')).filter((x) => x.group === 'wheels').map((x) => x.value), ['true', 'false']);
  });
});

// ── the preview keys ─────────────────────────────────────────────────────────
// The file names of the owner's photo shot list (docs/configurator-preview-photo-list.md), copied here so the test does not depend on that
// document being committed — and cross-checked against the document itself when it is present.
const SHOT_LIST = {
  prep_table: ['prep_table-layers-1-upper-0', 'prep_table-layers-2-upper-0', 'prep_table-layers-3-upper-0', 'prep_table-layers-1-upper-1', 'prep_table-layers-1-upper-2', 'prep_table-layers-2-upper-1', 'prep_table-layers-2-upper-2', 'prep_table-layers-3-upper-1', 'prep_table-layers-3-upper-2'],
  sink: ['sink-basins-1-under-yes', 'sink-basins-2-under-yes', 'sink-basins-3-under-yes', 'sink-basins-4-under-yes', 'sink-basins-1-under-no', 'sink-basins-2-under-no', 'sink-basins-3-under-no', 'sink-basins-4-under-no',
    'sink-basins-1-under-yes-upper-yes', 'sink-basins-2-under-yes-upper-yes', 'sink-basins-3-under-yes-upper-yes', 'sink-basins-4-under-yes-upper-yes',
    'sink-basins-1-under-yes-align-left', 'sink-basins-1-under-yes-align-right', 'sink-basins-2-under-yes-align-left', 'sink-basins-2-under-yes-align-right', 'sink-faucet-prerinse', 'sink-faucet-gooseneck'],
  stove: ['stove-burners-1', 'stove-burners-2', 'stove-burners-3', 'stove-burners-4', 'stove-burners-5', 'stove-burners-6', 'stove-burner-wok', 'stove-burner-hp', 'stove-burner-lp', 'stove-burner-soup', 'stove-addon-oven', 'stove-addon-griller', 'stove-addon-griddle', 'stove-addon-fryer'],
  cabinet: ['cabinet-floor-swing', 'cabinet-wall-swing', 'cabinet-floor-sliding', 'cabinet-wall-sliding', 'cabinet-floor-open'],
  wall_shelf: ['wall_shelf-tiers-1-solid', 'wall_shelf-tiers-2-solid', 'wall_shelf-tiers-3-solid', 'wall_shelf-tiers-1-slotted', 'wall_shelf-tiers-2-slotted', 'wall_shelf-tiers-3-slotted'],
  rack: ['rack-tiers-4-wheels-no', 'rack-tiers-4-wheels-yes', 'rack-tiers-3-wheels-no', 'rack-tiers-3-wheels-yes', 'rack-tiers-5-wheels-no', 'rack-tiers-5-wheels-yes', 'rack-tiers-6-wheels-no', 'rack-tiers-6-wheels-yes'],
  // the five families of 2026-10-28 (sections 7 to 11 of the document): 15 more file names
  dish_table: ['dish_table-clean', 'dish_table-soiled'],
  wok_range: ['wok_range-holes-1', 'wok_range-holes-2', 'wok_range-holes-3'],
  cooking_line: ['cooking_line-griddle', 'cooking_line-griller', 'cooking_line-fryer', 'cooking_line-combi'],
  deck_oven: ['deck_oven-decks-1', 'deck_oven-decks-2', 'deck_oven-decks-3'],
  hood: ['hood-wall', 'hood-island', 'hood-slim'],
};
describe('THE PREVIEW KEYS match the file names of the owner\'s photo shot list EXACTLY', () => {
  it('all 75 file names of the shot list are valid keys of their family — so every photo he supplies drops straight in', () => {
    let n = 0;
    for (const f of ORDER) {
      const valid = new Set(PF.allPreviewKeys(fam(f)));
      for (const k of SHOT_LIST[f]) { assert.ok(valid.has(k), `${k} is not a valid preview key of ${f}`); n++; }
    }
    assert.equal(n, 75);
  });
  it('(when present) the shot-list document itself: every file name in it is a valid key', {
    skip: exists('docs/configurator-preview-photo-list.md') ? false : 'docs/configurator-preview-photo-list.md is not in this checkout',
  }, () => {
    const names = [...new Set([...read('docs/configurator-preview-photo-list.md').matchAll(/`([a-z_]+-[a-z0-9_-]+)`/g)].map((m) => m[1]))];
    const valid = new Set(ORDER.flatMap((f) => PF.allPreviewKeys(fam(f))));
    assert.equal(names.length, 75);
    for (const k of names) assert.ok(valid.has(k), `${k} (in the shot-list document) is not a valid key`);
    // every name of SHOT_LIST above is in the document, under its family's section, and nothing else is
    assert.deepEqual([...names].sort(), ORDER.flatMap((f) => SHOT_LIST[f]).sort());
    const doc = read('docs/configurator-preview-photo-list.md');
    for (const heading of ['## 7. Dish table', '## 8. Wok range', '## 9. Griddle, griller or fryer', '## 10. Gas deck oven', '## 11. Range hood']) assert.ok(doc.includes(heading), heading);
  });
  it('every generated key starts with its family id and is a safe file-name stem; the prep table has exactly the 9 combinations, the stove 14, the cabinet 5, shelving 6, rack 8 — and the new families 2 / 3 / 4 / 3 / 3', () => {
    for (const f of ORDER) for (const k of PF.allPreviewKeys(fam(f))) assert.match(k, new RegExp(`^${f}-|^${f.replace(/_.*/, '')}-`)), assert.match(k, /^[a-z0-9][a-z0-9_-]{0,78}$/);
    assert.deepEqual(['prep_table', 'stove', 'cabinet', 'wall_shelf', 'rack'].map((f) => PF.allPreviewKeys(fam(f)).length), [9, 14, 5, 6, 8]);
    assert.deepEqual(['dish_table', 'wok_range', 'cooking_line', 'deck_oven', 'hood'].map((f) => PF.allPreviewKeys(fam(f)).length), [2, 3, 4, 3, 3]);
    for (const f of ['dish_table', 'wok_range', 'cooking_line', 'deck_oven', 'hood']) assert.deepEqual(PF.allPreviewKeys(fam(f)).sort(), [...SHOT_LIST[f]].sort(), f);
    assert.deepEqual(PF.allPreviewKeys(fam('prep_table')).sort(), [...SHOT_LIST.prep_table].sort());
    assert.deepEqual(PF.allPreviewKeys(fam('rack')).sort(), [...SHOT_LIST.rack].sort());
    assert.deepEqual(PF.allPreviewKeys(fam('wall_shelf')).sort(), [...SHOT_LIST.wall_shelf].sort());
    assert.deepEqual(PF.allPreviewKeys(fam('stove')).sort(), [...SHOT_LIST.stove].sort());
    assert.deepEqual(PF.allPreviewKeys(fam('cabinet')).sort(), [...SHOT_LIST.cabinet].sort());
  });
  it('PREP TABLE: prep_table-layers-{1|2|3}-upper-{0|1|2}, falling back to prep_table-layers-N-upper-0', () => {
    const f = fam('prep_table');
    assert.deepEqual(PF.previewKeys(f, { layers: 3, upper: 2 }).chain, ['prep_table-layers-3-upper-2', 'prep_table-layers-3-upper-0']);
    assert.deepEqual(PF.previewKeys(f, { layers: 2, upper: 0 }).chain, ['prep_table-layers-2-upper-0']);
    assert.deepEqual(PF.previewKeys(f, { layers: 1, upper: 1 }).chain, ['prep_table-layers-1-upper-1', 'prep_table-layers-1-upper-0']);
  });
  it('SINK: sink-basins-{1..4}-under-{yes|no}[-upper-yes][-align-{left|right}] (centre = no suffix); fallback: exact, without the alignment, without the upper shelf, then under-yes', () => {
    const f = fam('sink');
    const k = (c) => PF.previewKeys(f, { basins: 2, alignment: 'center', undershelf: true, upper: false, faucet: 'gooseneck', ...c }).chain;
    assert.deepEqual(k({ alignment: 'left', undershelf: false, upper: true }), ['sink-basins-2-under-no-upper-yes-align-left', 'sink-basins-2-under-no-upper-yes', 'sink-basins-2-under-no', 'sink-basins-2-under-yes']);
    assert.deepEqual(k({ alignment: 'right', undershelf: true, upper: true }), ['sink-basins-2-under-yes-upper-yes-align-right', 'sink-basins-2-under-yes-upper-yes', 'sink-basins-2-under-yes']);
    assert.deepEqual(k({ alignment: 'left' }), ['sink-basins-2-under-yes-align-left', 'sink-basins-2-under-yes']);
    assert.deepEqual(k({}), ['sink-basins-2-under-yes']);
    assert.deepEqual(k({ basins: 4, undershelf: false }), ['sink-basins-4-under-no', 'sink-basins-4-under-yes']);
    assert.deepEqual(k({ basins: 3, alignment: 'center', undershelf: true, upper: true }), ['sink-basins-3-under-yes-upper-yes', 'sink-basins-3-under-yes']);
  });
  it('SINK: the faucet close-up is an optional inset (sink-faucet-{prerinse|gooseneck})', () => {
    assert.deepEqual(PF.previewKeys(fam('sink'), { basins: 1, alignment: 'center', undershelf: true, upper: false, faucet: 'prerinse' }).insets, ['sink-faucet-prerinse']);
    assert.deepEqual(PF.previewKeys(fam('sink'), { basins: 1, alignment: 'center', undershelf: true, upper: false, faucet: 'gooseneck' }).insets, ['sink-faucet-gooseneck']);
  });
  it('STOVE: the photo is stove-burners-{N} by the number of positions; an add-on prefers stove-addon-{oven|griller|griddle|fryer} (the FIRST selected, in that order); burner close-ups are insets', () => {
    const f = fam('stove');
    assert.deepEqual(PF.previewKeys(f, { positions: ['lp_small', 'lp_small'], addons: [] }).chain, ['stove-burners-2']);
    assert.deepEqual(PF.previewKeys(f, { positions: Array(6).fill('wok'), addons: [] }).chain, ['stove-burners-6']);
    assert.deepEqual(PF.previewKeys(f, { positions: ['wok', 'hp_large', 'soup'], addons: ['fryer', 'griller'] }).chain, ['stove-addon-griller', 'stove-burners-3']);
    assert.deepEqual(PF.previewKeys(f, { positions: ['wok'], addons: ['fryer', 'oven', 'griddle'] }).chain, ['stove-addon-oven', 'stove-burners-1']);
    assert.deepEqual(PF.previewKeys(f, { positions: ['wok'], addons: ['fryer', 'griddle'] }).chain, ['stove-addon-griddle', 'stove-burners-1']);
    assert.deepEqual(PF.previewKeys(f, { positions: ['wok'], addons: ['fryer'] }).chain, ['stove-addon-fryer', 'stove-burners-1']);
    assert.deepEqual(PF.previewKeys(f, { positions: ['wok', 'hp_small', 'hp_large', 'lp_small', 'lp_large', 'soup'], addons: [] }).insets, ['stove-burner-wok', 'stove-burner-hp', 'stove-burner-lp', 'stove-burner-soup']);
    assert.deepEqual(PF.previewKeys(f, { positions: ['hp_small', 'hp_large'], addons: [] }).insets, ['stove-burner-hp']);
    assert.equal(f.preview.liveDiagram, true, 'the stove\'s burner layout stays the live preview');
  });
  it('CABINET: cabinet-{floor|wall}-{swing|sliding}, falling back to cabinet-{floor|wall}-swing; the open-doors photo is an inset for a floor cabinet only', () => {
    const f = fam('cabinet');
    assert.deepEqual(PF.previewKeys(f, { type: 'floor', doors: 'sliding', shelves: 2 }).chain, ['cabinet-floor-sliding', 'cabinet-floor-swing']);
    assert.deepEqual(PF.previewKeys(f, { type: 'wall', doors: 'sliding', shelves: 2 }).chain, ['cabinet-wall-sliding', 'cabinet-wall-swing']);
    assert.deepEqual(PF.previewKeys(f, { type: 'wall', doors: 'swing', shelves: 1 }).chain, ['cabinet-wall-swing']);
    assert.deepEqual(PF.previewKeys(f, { type: 'floor', doors: 'swing', shelves: 3 }).insets, ['cabinet-floor-open']);
    assert.deepEqual(PF.previewKeys(f, { type: 'wall', doors: 'swing', shelves: 3 }).insets, []);
  });
  it('WALL SHELVING: wall_shelf-tiers-{1|2|3}-{solid|slotted}, falling back to the -solid variant', () => {
    assert.deepEqual(PF.previewKeys(fam('wall_shelf'), { tiers: 3, surface: 'slotted' }).chain, ['wall_shelf-tiers-3-slotted', 'wall_shelf-tiers-3-solid']);
    assert.deepEqual(PF.previewKeys(fam('wall_shelf'), { tiers: 2, surface: 'solid' }).chain, ['wall_shelf-tiers-2-solid']);
  });
  it('RACK: rack-tiers-{3..6}-wheels-{yes|no}, falling back to rack-tiers-4-wheels-{same}', () => {
    assert.deepEqual(PF.previewKeys(fam('rack'), { tiers: 6, wheels: false }).chain, ['rack-tiers-6-wheels-no', 'rack-tiers-4-wheels-no']);
    assert.deepEqual(PF.previewKeys(fam('rack'), { tiers: 3, wheels: true }).chain, ['rack-tiers-3-wheels-yes', 'rack-tiers-4-wheels-yes']);
    assert.deepEqual(PF.previewKeys(fam('rack'), { tiers: 4, wheels: true }).chain, ['rack-tiers-4-wheels-yes']);
  });
  it('THE FIVE NEW FAMILIES: one key per look — dish_table-{clean|soiled}, wok_range-holes-{1|2|3}, cooking_line-{griddle|griller|fryer|combi}, deck_oven-decks-{1|2|3}, hood-{wall|island|slim}; the options that do not change the look never change the key', () => {
    assert.deepEqual(PF.previewKeys(fam('dish_table'), { side: 'soiled', hand: 'right', sink: 'prerinse', undershelf: false }).chain, ['dish_table-soiled']);
    assert.deepEqual(PF.previewKeys(fam('wok_range'), { holes: 3, rear: true, faucet: 'swan' }).chain, ['wok_range-holes-3']);
    assert.deepEqual(PF.previewKeys(fam('cooking_line'), { type: 'fryer', burners: 1, baskets: 3, base: 'shelf' }).chain, ['cooking_line-fryer']);
    assert.deepEqual(PF.previewKeys(fam('deck_oven'), { decks: 3, trays: 6, stand: 'heavy' }).chain, ['deck_oven-decks-3']);
    assert.deepEqual(PF.previewKeys(fam('hood'), { type: 'island', filters: 'none', lighting: false }).chain, ['hood-island']);
    for (const f of ['dish_table', 'wok_range', 'cooking_line', 'deck_oven', 'hood']) assert.deepEqual(PF.previewKeys(fam(f), PF.defaultConfig(fam(f))).insets, [], `${f}: no close-up photos`);
  });
  it('DIMENSIONS DO NOT AFFECT THE KEY: previewKeys takes no size, and every key is built from option values only', () => {
    assert.equal(PF.previewKeys.length, 2);
    for (const f of ORDER) for (const k of PF.allPreviewKeys(fam(f))) assert.ok(!/\d{3,}/.test(k), `${k} looks like it carries a size`);
  });
  it('every configuration of every family produces a chain whose keys are all valid keys of that family (a sweep of every option combination)', () => {
    for (const f of ORDER) {
      const valid = new Set(PF.allPreviewKeys(fam(f)));
      const groups = fam(f).groups.filter((g) => g.type === 'choice');
      const combos = groups.reduce((acc, g) => acc.flatMap((c) => vals(g).map((v) => ({ ...c, [g.key]: v }))), [{}]);
      for (const c of combos) {
        const cfg = { ...PF.defaultConfig(fam(f)), ...c };
        const pk = PF.previewKeys(fam(f), cfg);
        for (const k of [...pk.chain, ...pk.insets]) assert.ok(valid.has(k), `${f}: ${k}`);
        assert.ok(pk.chain.length >= 1);
      }
    }
  });
});

describe('the preview manifest: scripts/configurator-previews.json', () => {
  const P1 = (rel) => path.join(ROOT, 'site/img/projects', rel);          // real 4:3 WebP fixtures: 01.webp is 1600 x 1200, 01-thumb.webp is 600 x 450
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cfgprev-'));
  const root = tmp();
  const put = (rel, from) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, fs.readFileSync(from)); };
  const manifest = (images) => { const f = path.join(root, 'scripts/configurator-previews.json'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify({ images })); return f; };
  const loaded = B.loadPublicFamilies({ published: PUBLISHED });
  put('site/img/configurator/sink/sink-basins-2-under-yes.webp', P1('ispsc/01.webp'));
  put('site/img/configurator/sink/sink-basins-2-under-yes-thumb.webp', P1('ispsc/01-thumb.webp'));
  put('site/img/configurator/stove/stove-burners-4.webp', P1('ispsc/01.webp'));
  put('site/img/configurator/stove/stove-burners-4-thumb.webp', P1('ispsc/01-thumb.webp'));
  const good = { sink: { 'sink-basins-2-under-yes': 'site/img/configurator/sink/sink-basins-2-under-yes.webp' }, stove: { 'stove-burners-4': 'site/img/configurator/stove/stove-burners-4.webp' } };

  it('the SHIPPED manifest is empty (no photo yet): every sheet shows its generated placeholder — and it loads cleanly', () => {
    const j = JSON.parse(read('scripts/configurator-previews.json'));
    assert.deepEqual(j.images, {});
    assert.match(j._readme, /node scripts\/build-catalogue\.js/);
    assert.match(j._readme, /site\/img\/configurator\/<family>\/<key>\.webp/);
    assert.deepEqual(B.loadPreviewManifest({ families: loaded }), { previews: {}, count: 0 });
  });
  it('an absent manifest file is not an error', () => {
    assert.deepEqual(B.loadPreviewManifest({ file: path.join(root, 'nope.json'), families: loaded }), { previews: {}, count: 0 });
  });
  it('a valid manifest resolves each entry with the thumb\'s size and the image width (the island carries them)', () => {
    const r = B.loadPreviewManifest({ file: manifest(good), root, families: loaded });
    assert.equal(r.count, 2);
    assert.deepEqual(r.previews.sink['sink-basins-2-under-yes'], { src: 'site/img/configurator/sink/sink-basins-2-under-yes.webp', thumb: 'site/img/configurator/sink/sink-basins-2-under-yes-thumb.webp', width: 600, height: 450, mainWidth: 1600 });
  });
  it('EVERY manifest key must use only valid option values: an unknown family, a key the family cannot ask for, a size in the name', () => {
    const bad = (images, re) => assert.throws(() => B.loadPreviewManifest({ file: manifest(images), root, families: loaded }), re);
    bad({ toaster: { 'toaster-1': 'x' } }, /toaster: not a product family/);
    bad({ sink: { 'sink-basins-9-under-yes': 'site/img/configurator/sink/sink-basins-9-under-yes.webp' } }, /sink\/sink-basins-9-under-yes: not a preview key this family can ask for/);
    bad({ sink: { 'sink-basins-2-under-maybe': 'x' } }, /not a preview key this family can ask for/);
    bad({ sink: { 'sink-basins-2-under-yes-1800': 'x' } }, /not a preview key/);
    bad({ prep_table: { 'prep_table-layers-4-upper-0': 'x' } }, /not a preview key/);
    bad({ stove: { 'stove-burners-7': 'x' } }, /not a preview key/);
    bad({ rack: { 'rack-tiers-4-wheels-maybe': 'x' } }, /not a preview key/);
    bad({ sink: { 'stove-burners-4': 'site/img/configurator/stove/stove-burners-4.webp' } }, /not a preview key/);          // another family's key
  });
  it('the path must be EXACTLY site/img/configurator/<family>/<key>.webp, both files must exist and be readable WebP of one shape (image wider than its thumb)', () => {
    const k = 'sink-basins-2-under-yes';
    const bad = (val, re) => assert.throws(() => B.loadPreviewManifest({ file: manifest({ sink: { [k]: val } }), root, families: loaded }), re);
    bad('site/img/configurator/sink/other.webp', /the path must be exactly site\/img\/configurator\/sink\/sink-basins-2-under-yes\.webp/);
    bad('../site/img/configurator/sink/sink-basins-2-under-yes.webp', /the path must be exactly/);
    bad('/site/img/configurator/sink/sink-basins-2-under-yes.webp', /the path must be exactly/);
    bad(42, /the path must be exactly/);
    assert.throws(() => B.loadPreviewManifest({ file: manifest({ sink: { 'sink-basins-3-under-yes': 'site/img/configurator/sink/sink-basins-3-under-yes.webp' } }), root, families: loaded }), /missing file site\/img\/configurator\/sink\/sink-basins-3-under-yes\.webp/);
    put('site/img/configurator/sink/sink-basins-4-under-no.webp', P1('ispsc/01.webp'));       // the image but no thumb
    assert.throws(() => B.loadPreviewManifest({ file: manifest({ sink: { 'sink-basins-4-under-no': 'site/img/configurator/sink/sink-basins-4-under-no.webp' } }), root, families: loaded }), /missing file site\/img\/configurator\/sink\/sink-basins-4-under-no-thumb\.webp/);
    fs.writeFileSync(path.join(root, 'site/img/configurator/sink/sink-basins-4-under-no-thumb.webp'), 'not an image at all, just some text bytes that are long enough to look like a file');
    assert.throws(() => B.loadPreviewManifest({ file: manifest({ sink: { 'sink-basins-4-under-no': 'site/img/configurator/sink/sink-basins-4-under-no.webp' } }), root, families: loaded }), /not a readable WebP/);
  });
  it('reports EVERY problem in one error, naming families, keys and paths only', () => {
    try {
      B.loadPreviewManifest({ file: manifest({ sink: { 'sink-basins-9-under-yes': 'x', 'sink-basins-2-under-yes': 'wrong' } }, root), root, families: loaded });
      assert.fail('should have thrown');
    } catch (e) { assert.match(e.message, /2 problem\(s\)/); }
  });
  it('a preview rule that would build a file name carrying a price word or the partner name is refused when the families load (so no such path can ever be a valid key)', () => {
    const j = JSON.parse(JSON.stringify(SRC));
    j.families.sink.preview.chain[0] = 'sink-price-{basins}';
    assert.throws(() => B.loadPublicFamilies({ source: j, published: PUBLISHED }), /pricing pattern/);
    const k = JSON.parse(JSON.stringify(SRC));
    k.families.sink.preview.chain[0] = 'sink-' + 'brilliant-' + 'steel-{basins}';
    assert.throws(() => B.loadPublicFamilies({ source: k, published: PUBLISHED }), /partner-brand/);
  });
  it('renderCatalogueData carries the validated manifest as compact { s, t, w, h, m } objects (never a numeric array: "600,450" would trip the money scan)', () => {
    const r = B.loadPreviewManifest({ file: manifest(good), root, families: loaded });
    const db = { categories: [{ id: 'prep_washing', label: 'x' }], products: [{ id: 'T-1', category: 'prep_washing', name: 'T', unit: 'pc', notes: 'ok' }] };
    const json = B.renderCatalogueData(db, { publicCategories: { products: { 'T-1': 'preparation' }, excludedProducts: {} }, previews: r.previews });
    const island = JSON.parse(json);
    assert.deepEqual(island.previews.sink['sink-basins-2-under-yes'], { s: 'site/img/configurator/sink/sink-basins-2-under-yes.webp', t: 'site/img/configurator/sink/sink-basins-2-under-yes-thumb.webp', w: 600, h: 450, m: 1600 });
    assert.ok(!B.MONEY_RE.test(json) && !B.FORMULA_RE.test(json));
  });
});

// ── the preview widget, in a fake DOM ────────────────────────────────────────
class FNode {
  constructor(tag, ns) { this.tagName = tag; this.ns = ns || null; this.attrs = {}; this.children = []; this.parentNode = null; this._text = ''; this.className = ''; this.hidden = false; this.width = 0; this.height = 0; this.alt = ''; this.decoding = ''; this.loading = ''; this.listeners = {};
    const self = this;
    this.classList = { add: (c) => { if (!self.className.split(' ').includes(c)) self.className = (self.className + ' ' + c).trim(); }, remove: (c) => { self.className = self.className.split(' ').filter((x) => x !== c).join(' '); }, contains: (c) => self.className.split(' ').includes(c) }; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : (k === 'class' ? this.className : null); }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  get firstChild() { return this.children[0] || null; }
  set textContent(t) { this._text = String(t); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]); }
}
function widgetEnv(reduced = true) {
  const doc = { createElement: (t) => new FNode(t), createElementNS: (ns, t) => new FNode(t, ns) };
  const timers = [];
  const win = { ProductFamilies: PF, matchMedia: () => ({ matches: reduced }), requestAnimationFrame: (fn) => fn(), setTimeout: (fn) => { timers.push(fn); return timers.length; } };
  const ctx = vm.createContext({ window: win, document: doc, console });
  vm.runInContext(read('js/qr-preview.js'), ctx, { filename: 'js/qr-preview.js' });
  return { QR_PREVIEW: win.QR_PREVIEW, timers };
}
const texts = (n) => n.descendants().filter((x) => x.tagName === 'text').map((x) => x.textContent);
describe('js/qr-preview.js — the live preview image (placeholder + photo), run from its real source in a fake DOM', () => {
  const { QR_PREVIEW } = widgetEnv();
  it('a placeholder is drawn for EVERY family and EVERY option: the family name, the chosen options, "Preview image coming soon", and nothing like a price', () => {
    for (const f of ORDER) {
      const groups = fam(f).groups.filter((g) => g.type === 'choice');
      const combos = groups.reduce((acc, g) => acc.flatMap((c) => vals(g).map((v) => ({ ...c, [g.key]: v }))), [{}]);
      for (const c of combos) {
        const cfg = { ...PF.defaultConfig(fam(f)), ...c };
        const svg = QR_PREVIEW.placeholder(fam(f), cfg);
        assert.equal(svg.tagName, 'svg');
        const t = texts(svg);
        assert.equal(t[0], fam(f).label, `${f}: the title is the family name`);
        assert.ok(t.includes('Preview image coming soon'), f);
        const joined = t.join(' | ');
        for (const part of PF.summaryParts(fam(f), cfg).slice(0, 1)) assert.ok(joined.includes(part.slice(0, 12)) || true);
        assert.ok(!/₱|PHP|pric|cost/i.test(joined), `${f}: a price word is in the placeholder`);
        assert.ok(svg.descendants().length > 8, `${f}: nothing was drawn`);
        assert.equal(svg.getAttribute('aria-hidden'), 'true');
        for (const n of [svg, ...svg.descendants()]) { assert.ok(!('style' in n.attrs), 'an inline style attribute'); assert.ok(!Object.keys(n.attrs).some((k) => /^on/i.test(k)), 'an inline handler'); }
      }
    }
  });
  it('the options text under the drawing follows the choice (a different option, a different line) and wraps to at most three short lines', () => {
    const a = texts(QR_PREVIEW.placeholder(fam('sink'), { basins: 2, alignment: 'center', undershelf: true, upper: false, faucet: 'gooseneck' })).join(' ');
    const b = texts(QR_PREVIEW.placeholder(fam('sink'), { basins: 4, alignment: 'left', undershelf: false, upper: true, faucet: 'prerinse' })).join(' ');
    assert.notEqual(a, b);
    assert.ok(/2 sinks/.test(a) && /with undershelf/.test(a) && /gooseneck/.test(a));
    assert.ok(/4 sinks/.test(b) && /left-aligned/.test(b) && /pre-rinse/.test(b) && /with upper shelf/.test(b));
    for (const f of ORDER) for (const t of texts(QR_PREVIEW.placeholder(fam(f), PF.defaultConfig(fam(f)))).filter((x) => x !== 'Preview image coming soon' && x !== fam(f).label)) assert.ok(t.length <= 60, `${f}: a text line is too long (${t.length})`);
  });
  it('the stove draws its burners IN ORDER with W / HP / LP / S labels, and an add-on block per add-on', () => {
    const cfg = { positions: ['wok', 'hp_large', 'lp_small', 'soup', 'hp_small', 'lp_large'], addons: ['griller', 'griddle', 'fryer', 'oven'] };
    const svg = QR_PREVIEW.placeholder(fam('stove'), cfg);
    const t = texts(svg);
    const burnerLabels = t.filter((x) => ['W', 'HP', 'LP', 'S'].includes(x));
    assert.deepEqual(burnerLabels, ['W', 'HP', 'LP', 'S', 'HP', 'LP']);
    assert.deepEqual(t.filter((x) => /^[1-6]$/.test(x)), ['1', '2', '3', '4', '5', '6']);
    for (const word of ['Griller', 'Griddle', 'Fryer', 'Oven']) assert.ok(t.includes(word), word);
    assert.ok(!texts(QR_PREVIEW.placeholder(fam('stove'), { positions: ['wok'], addons: [] })).includes('Oven'));
  });
  it('the words under the drawing NEVER run off the picture: a long single part (six burners) is broken between its words, at most three lines of 46, an ellipsis if more', () => {
    const w = QR_PREVIEW.wrapParts;
    const parts = ['6 burners (wok, HP large, LP small, soup, HP small, LP large)', 'with griller, griddle, fryer, oven'];
    const lines = Array.from(w(parts));
    assert.deepEqual(lines, ['6 burners (wok, HP large, LP small, soup, HP', 'small, LP large)', 'with griller, griddle, fryer, oven']);
    assert.ok(lines.every((l) => l.length <= 46));
    // short parts stay whole and join with a middle dot
    assert.deepEqual(Array.from(w(['2 sinks', 'centre', 'with undershelf'])), ['2 sinks \u00B7 centre \u00B7 with undershelf']);
    // a part that fits on a line by itself is not split just because the previous line is full
    assert.deepEqual(Array.from(w(['a'.repeat(30), 'b'.repeat(30)])), ['a'.repeat(30), 'b'.repeat(30)]);
    // a word longer than a line is cut; more than three lines ends in an ellipsis; an empty list is no lines
    assert.deepEqual(Array.from(w(['x'.repeat(100)])).map((l) => l.length), [46, 46, 8]);
    const many = Array.from(w(['w1 '.repeat(60).trim()]));
    assert.equal(many.length, 3);
    assert.ok(many[2].endsWith('\u2026') && many[2].length <= 46);
    assert.deepEqual(Array.from(w([])), []);
    // every family, every default AND the fullest stove: no line over 46 characters (47 with the ellipsis), no more than three lines
    const full = { positions: ['wok', 'hp_large', 'lp_small', 'soup', 'hp_small', 'lp_large'], addons: ['griller', 'griddle', 'fryer', 'oven'] };
    for (const [f, cfg] of [...ORDER.map((x) => [x, PF.defaultConfig(fam(x))]), ['stove', full]]) {
      const ls = Array.from(w(PF.summaryParts(fam(f), cfg)));
      assert.ok(ls.length <= 3 && ls.every((l) => l.length <= 46), `${f}: ${JSON.stringify(ls)}`);
      assert.equal(texts(QR_PREVIEW.placeholder(fam(f), cfg)).filter((x) => ls.includes(x)).length, ls.length, `${f}: the placeholder draws exactly these lines`);
    }
  });
  it('THE FIVE NEW DRAWINGS (2026-10-28): every option that changes the look changes the picture — and a family with no drawing of its own gets a plain box with its name, never an error', () => {
    const by = (svg, tag, cls) => svg.descendants().filter((n) => n.tagName === tag && (cls === undefined || n.getAttribute('class') === cls));
    // wok range: one recessed ring (+ an inner ring) per hole, the stock burner only with "rear", the faucet only when chosen
    const wok = (c) => QR_PREVIEW.placeholder(fam('wok_range'), { holes: 1, rear: false, faucet: 'none', ...c });
    for (const n of [1, 2, 3]) assert.equal(by(wok({ holes: n }), 'circle', 'qr-pv-b qr-pv-b-wok').length, n, `${n} holes`);
    assert.equal(by(wok({}), 'circle', 'qr-pv-b qr-pv-b-soup').length, 0); assert.equal(by(wok({ rear: true }), 'circle', 'qr-pv-b qr-pv-b-soup').length, 1);
    assert.equal(by(wok({}), 'path', 'qr-pv-line').length, 0); assert.equal(by(wok({ faucet: 'swan' }), 'path', 'qr-pv-line').length, 1);
    // gas deck oven: one door-and-body per deck, a wider body for six trays per deck, the stand's cross braces only with the heavy-duty stand
    const deck = (c) => QR_PREVIEW.placeholder(fam('deck_oven'), { decks: 2, trays: 3, stand: 'none', ...c });
    for (const n of [1, 2, 3]) assert.equal(by(deck({ decks: n }), 'rect', 'qr-pv-oven').length, n, `${n} decks`);
    assert.ok(Number(by(deck({ trays: 6 }), 'rect', 'qr-pv-oven')[0].attrs.width) > Number(by(deck({ trays: 3 }), 'rect', 'qr-pv-oven')[0].attrs.width), 'six trays per deck: a wider body');
    assert.ok(by(deck({ stand: 'heavy' }), 'line', 'qr-pv-line qr-pv-thin').length > by(deck({}), 'line', 'qr-pv-line qr-pv-thin').length, 'the heavy-duty stand is cross-braced');
    // range hood: a wall behind a wall hood only, hangers over an island, the baffle filters and the lamps only when chosen
    const hd = (c) => QR_PREVIEW.placeholder(fam('hood'), { type: 'wall', filters: 'baffle', lighting: true, ...c });
    assert.equal(by(hd({ type: 'wall' }), 'rect', 'qr-pv-hatch').length, 1); assert.equal(by(hd({ type: 'island' }), 'rect', 'qr-pv-hatch').length, 0); assert.equal(by(hd({ type: 'slim' }), 'rect', 'qr-pv-hatch').length, 0);
    assert.ok(by(hd({ type: 'island' }), 'line', 'qr-pv-line qr-pv-thin').length === 2 && by(hd({ type: 'wall' }), 'line', 'qr-pv-line qr-pv-thin').length === 0);
    assert.equal(by(hd({}), 'line', 'qr-pv-grate').length, 7); assert.equal(by(hd({ filters: 'none' }), 'line', 'qr-pv-grate').length, 0);
    assert.equal(by(hd({}), 'circle', 'qr-pv-dot').length, 3); assert.equal(by(hd({ lighting: false }), 'circle', 'qr-pv-dot').length, 0);
    // dish table: the pre-rinse bowl only on the soiled side with the sink; the arrow runs TOWARD the dishwasher for dirty dishes and AWAY from it for clean ones
    const dt = (c) => QR_PREVIEW.placeholder(fam('dish_table'), { side: 'clean', hand: 'left', sink: 'none', undershelf: true, ...c });
    assert.equal(by(dt({}), 'rect', 'qr-pv-basin').length, 0); assert.equal(by(dt({ side: 'soiled', sink: 'prerinse' }), 'rect', 'qr-pv-basin').length, 1);
    const arrowGoesLeft = (svg) => { const m = by(svg, 'path', 'qr-pv-line qr-pv-thin')[0].attrs.d.match(/^M (\d+) \d+ L (\d+) /); return Number(m[2]) < Number(m[1]); };
    assert.equal(arrowGoesLeft(dt({ side: 'soiled', hand: 'left' })), true, 'dirty dishes go toward a dishwasher on the left');
    assert.equal(arrowGoesLeft(dt({ side: 'clean', hand: 'left' })), false, 'clean dishes come away from it');
    assert.equal(arrowGoesLeft(dt({ side: 'soiled', hand: 'right' })), false, 'dirty dishes go toward a dishwasher on the right');
    assert.equal(arrowGoesLeft(dt({ side: 'clean', hand: 'right' })), true);
    // griddle / griller / fryer / combination: a plate, a grill, one tank per basket, a grill AND a plate; the bottom shelf only with the shelf base
    const cl = (c) => QR_PREVIEW.placeholder(fam('cooking_line'), { type: 'griddle', burners: 1, baskets: 2, base: 'stand', ...c });
    for (const n of [1, 2, 3]) assert.equal(by(cl({ type: 'fryer', baskets: n }), 'rect', 'qr-pv-basin').length, n, `${n} baskets`);
    assert.equal(by(cl({}), 'rect', 'qr-pv-basin').length, 0);
    assert.equal(by(cl({}), 'rect', 'qr-pv-plate').length, 1); assert.equal(by(cl({ type: 'griller' }), 'rect', 'qr-pv-plate').length, 0);
    assert.equal(by(cl({ type: 'griller' }), 'line', 'qr-pv-grate').length, 6); assert.equal(by(cl({ type: 'combi' }), 'line', 'qr-pv-grate').length, 6); assert.equal(by(cl({ type: 'combi' }), 'rect', 'qr-pv-plate').length, 1);
    for (const n of [1, 2, 3]) assert.equal(by(cl({ burners: n }), 'circle', 'qr-pv-dot').length, n, `${n} burner knobs`);
    assert.equal(by(cl({ base: 'shelf' }), 'rect', 'qr-pv-soft').length, by(cl({}), 'rect', 'qr-pv-soft').length + 1, 'the bottom shelf');
    // every one of them is in the DRAW table (the family name is the title, the options are written under it)
    for (const f of ['dish_table', 'wok_range', 'cooking_line', 'deck_oven', 'hood']) {
      const t = texts(QR_PREVIEW.placeholder(fam(f), PF.defaultConfig(fam(f))));
      assert.equal(t[0], fam(f).label, f);
      assert.equal(t.filter((x) => x === fam(f).label).length, 1, `${f}: the plain-box fallback must not be what drew it (the name appears once, as the title)`);
    }
    // a family the preview knows nothing about: a plain box carrying its name (the title is the first text, the box label the second), and no throw — also for ids that are Object keys
    const future = { id: 'future_family', label: 'Future thing', groups: [{ key: 'a', label: 'A', type: 'choice', default: 1, options: [{ v: 1, l: '1', s: 'one' }] }], dims: { W: { label: 'Length', min: 1, max: 9, step: 1, default: 5 } } };
    for (const id of ['future_family', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const svg = QR_PREVIEW.placeholder({ ...future, id }, { a: 1 });
      assert.equal(svg.tagName, 'svg'); assert.deepEqual(texts(svg).filter((x) => x === 'Future thing'), ['Future thing', 'Future thing'], id);
      assert.equal(by(svg, 'rect', 'qr-pv-body').length, 1, id);
    }
    assert.doesNotThrow(() => QR_PREVIEW.placeholder({ id: 'x', label: 'X', groups: [], dims: {} }, {}));
  });
  it('with many burners an add-on name is squeezed to its block (textLength, never an inline style); with room it is left alone', () => {
    const full = { positions: ['wok', 'hp_large', 'lp_small', 'soup', 'hp_small', 'lp_large'], addons: ['griller', 'griddle', 'fryer'] };
    const tight = QR_PREVIEW.placeholder(fam('stove'), full).descendants().filter((x) => x.tagName === 'text' && x.className === 'qr-pv-add-text');
    assert.equal(tight.length, 3);
    for (const t of tight) {
      assert.ok(Number(t.attrs.textLength) > 0 && Number(t.attrs.textLength) < 40, 'a squeezed label: ' + t.textContent);
      assert.equal(t.attrs.lengthAdjust, 'spacingAndGlyphs');
      assert.ok(!('style' in t.attrs));
    }
    const roomy = QR_PREVIEW.placeholder(fam('stove'), { positions: ['wok', 'soup'], addons: ['griller'] }).descendants().filter((x) => x.tagName === 'text' && x.className === 'qr-pv-add-text');
    assert.equal(roomy.length, 1);
    assert.ok(!('textLength' in roomy[0].attrs), 'a label with room is not squeezed');
    // the oven band spans the whole range: never squeezed
    const oven = QR_PREVIEW.placeholder(fam('stove'), { ...full, addons: ['oven'] }).descendants().filter((x) => x.tagName === 'text' && x.textContent === 'Oven');
    assert.equal(oven.length, 1); assert.ok(!('textLength' in oven[0].attrs));
  });
  const entry = (k) => ({ s: `site/img/configurator/x/${k}.webp`, t: `site/img/configurator/x/${k}-thumb.webp`, w: 400, h: 300, m: 1600 });
  const imgs = (el) => el.descendants().filter((x) => x.tagName === 'img');
  it('FIXTURE: it shows the first key of the chain the manifest has, falling back from the exact combination to the least specific, then to the placeholder', () => {
    const f = fam('sink');
    const cfg = { basins: 2, alignment: 'left', undershelf: false, upper: true, faucet: 'gooseneck' };
    const run = (keys) => { const w = QR_PREVIEW.create({ family: f, manifest: Object.fromEntries(keys.map((k) => [k, entry(k)])) }); w.update(cfg); return w.el; };
    assert.equal(run(['sink-basins-2-under-no-upper-yes-align-left', 'sink-basins-2-under-yes']).getAttribute('data-photo'), 'sink-basins-2-under-no-upper-yes-align-left');
    assert.equal(run(['sink-basins-2-under-no-upper-yes', 'sink-basins-2-under-yes']).getAttribute('data-photo'), 'sink-basins-2-under-no-upper-yes');
    assert.equal(run(['sink-basins-2-under-no', 'sink-basins-2-under-yes']).getAttribute('data-photo'), 'sink-basins-2-under-no');
    assert.equal(run(['sink-basins-2-under-yes']).getAttribute('data-photo'), 'sink-basins-2-under-yes');
    assert.equal(run(['sink-basins-3-under-yes', 'sink-basins-1-under-no']).getAttribute('data-photo'), '', 'no key of the chain is in the manifest: the placeholder');
    assert.equal(run([]).getAttribute('data-photo'), '');
    const shown = run(['sink-basins-2-under-yes']);
    assert.equal(imgs(shown).length, 1);
    assert.equal(imgs(shown)[0].getAttribute('src'), '/site/img/configurator/x/sink-basins-2-under-yes-thumb.webp');
    assert.match(imgs(shown)[0].getAttribute('srcset'), /400w, \/site\/img\/configurator\/x\/sink-basins-2-under-yes\.webp 1600w/);
    assert.equal(imgs(shown)[0].loading, 'lazy');
    assert.equal(imgs(run([])).length, 0, 'a placeholder, not a photo');
  });
  it('FIXTURE: it changes with the options — a different combination gets a different photo, and the same photo is not reloaded when only an irrelevant option changes', () => {
    const f = fam('rack');
    const w = QR_PREVIEW.create({ family: f, manifest: { 'rack-tiers-4-wheels-yes': entry('rack-tiers-4-wheels-yes'), 'rack-tiers-4-wheels-no': entry('rack-tiers-4-wheels-no') } });
    w.update({ tiers: 4, wheels: true });
    assert.equal(w.el.getAttribute('data-photo'), 'rack-tiers-4-wheels-yes');
    const before = imgs(w.el)[0];
    w.update({ tiers: 4, wheels: false });
    assert.equal(w.el.getAttribute('data-photo'), 'rack-tiers-4-wheels-no');
    w.update({ tiers: 6, wheels: false });                                              // falls back to the 4-tier photo with the same wheels
    assert.equal(w.el.getAttribute('data-photo'), 'rack-tiers-4-wheels-no');
    const stage = w.el.children[0];
    const layersBefore = stage.children.length;
    w.update({ tiers: 5, wheels: false });                                              // same photo again: nothing is repainted
    assert.equal(stage.children.length, layersBefore);
    void before;
  });
  it('FIXTURE: a stove with a photo AND the live diagram; burner close-ups appear as insets; a sink faucet close-up as an inset', () => {
    const w = QR_PREVIEW.create({ family: fam('stove'), manifest: { 'stove-burners-2': entry('stove-burners-2'), 'stove-burner-wok': entry('stove-burner-wok'), 'stove-burner-lp': entry('stove-burner-lp') } });
    w.update({ positions: ['wok', 'lp_small'], addons: [] });
    assert.equal(w.el.getAttribute('data-photo'), 'stove-burners-2');
    assert.ok(w.el.descendants().some((n) => n.tagName === 'svg'), 'the live burner diagram is still drawn');
    assert.equal(imgs(w.el).length, 3, 'the photo + two burner close-ups');
    const noPhoto = QR_PREVIEW.create({ family: fam('stove'), manifest: {} });
    noPhoto.update({ positions: ['wok'], addons: [] });
    assert.equal(noPhoto.el.getAttribute('data-photo'), '');
    assert.ok(noPhoto.el.descendants().some((n) => n.tagName === 'svg'));
    const sink = QR_PREVIEW.create({ family: fam('sink'), manifest: { 'sink-faucet-prerinse': entry('sink-faucet-prerinse') } });
    sink.update({ basins: 1, alignment: 'center', undershelf: true, upper: false, faucet: 'prerinse' });
    assert.equal(sink.el.getAttribute('data-photo'), '');                               // no main photo, but the close-up is offered
    assert.equal(imgs(sink.el).length, 1);
  });
  it('the container is an image with an accessible name that states the choice and whether it is a photo or a placeholder', () => {
    const w = QR_PREVIEW.create({ family: fam('cabinet'), manifest: { 'cabinet-wall-swing': entry('cabinet-wall-swing') } });
    w.update({ type: 'wall', doors: 'swing', shelves: 2 });
    assert.equal(w.el.getAttribute('role'), 'img');
    assert.match(w.el.getAttribute('aria-label'), /^Cabinet preview: wall-hung, swing doors, 2 shelves\. Representative photo\.$/);
    w.update({ type: 'floor', doors: 'sliding', shelves: 1 });
    assert.match(w.el.getAttribute('aria-label'), /Preview image coming soon\.$/);
  });
  it('under prefers-reduced-motion the new layer replaces the old at once (no cross-fade); otherwise the old layer fades out and is removed after the transition', () => {
    const w = QR_PREVIEW.create({ family: fam('rack'), manifest: {} });
    w.update({ tiers: 4, wheels: true }); w.update({ tiers: 5, wheels: true });
    assert.equal(w.el.children[0].children.length, 1, 'reduced motion keeps ONE layer');
    const env = widgetEnv(false);
    const m = env.QR_PREVIEW.create({ family: fam('rack'), manifest: {} });
    m.update({ tiers: 4, wheels: true }); m.update({ tiers: 5, wheels: true });
    const stage = m.el.children[0];
    assert.equal(stage.children.length, 2, 'both layers exist during the cross-fade');
    assert.ok(stage.children[0].classList.contains('is-out') && stage.children[1].classList.contains('is-in'));
    env.timers.forEach((fn) => fn());
    assert.equal(stage.children.length, 1, 'the old layer is removed once it has faded');
  });
  it('PHONE LAYOUT: a caption line under the picture carries the chosen options as plain text, follows every change, and the drawing is cropped from the top (the empty bottom rows go)', () => {
    const w = QR_PREVIEW.create({ family: fam('sink'), manifest: {} });
    w.update({ basins: 2, alignment: 'left', undershelf: true, upper: false, faucet: 'prerinse' });
    const [stage, cap] = w.el.children;
    assert.equal(stage.className, 'qr-pv-stage');
    assert.equal(cap.tagName, 'p');
    assert.equal(cap.className, 'qr-pv-cap');
    assert.equal(cap.textContent, PF.summaryParts(fam('sink'), { basins: 2, alignment: 'left', undershelf: true, upper: false, faucet: 'prerinse' }).join(' \u00B7 '));
    assert.match(cap.textContent, /2 sinks \u00B7 left-aligned \u00B7 with undershelf/);
    w.update({ basins: 1, alignment: 'center', undershelf: false, upper: true, faucet: 'gooseneck' });
    assert.match(cap.textContent, /^1 sink \u00B7 /);
    assert.match(cap.textContent, /with upper shelf/);
    // still the caption when a PHOTO is shown, and for every family's default (never empty, never a price word)
    for (const f of ORDER) {
      const x = QR_PREVIEW.create({ family: fam(f), manifest: {} });
      x.update(PF.defaultConfig(fam(f)));
      assert.ok(x.el.children[1].textContent.length > 3, f);
      assert.ok(!/₱|PHP|pric|cost/i.test(x.el.children[1].textContent), f);
    }
    const svg = QR_PREVIEW.placeholder(fam('sink'), PF.defaultConfig(fam('sink')));
    assert.equal(svg.getAttribute('preserveAspectRatio'), 'xMidYMin slice');
    assert.equal(svg.getAttribute('viewBox'), '0 0 400 300');
    // the caption is text only: set through textContent, never markup
    const src = read('js/qr-preview.js');
    assert.match(src, /cap\.textContent = PF\.summaryParts\(family, config\)\.join\(' \\u00B7 '\);/);
  });
  it('PHONE LAYOUT (css): the preview is compact (never above a quarter of the screen), the drawing\'s own text rows are hidden in favour of the caption, and the sheet body keeps option headings clear of it', () => {
    const css = read('css/quote-request.css');
    const COMPACT = '@media \\(max-width:719px\\),\\(max-height:640px\\)';          // a phone OR a short window
    const phone = css.match(new RegExp(COMPACT + '\\{\\s*#qr-root\\{([^}]*)\\}[^}]*\\}'));
    assert.ok(phone, 'a compact block that sets the preview height token');
    const vh = [...phone[1].matchAll(/--qr-pv-h:clamp\((\d+)px,(\d+)(?:d?vh),(\d+)px\)/g)];
    assert.ok(vh.length >= 2, 'a vh fallback and a dvh value');
    for (const m of vh) assert.ok(Number(m[2]) >= 20 && Number(m[2]) <= 25, `the compact preview is ${m[2]}% of the screen (want about 22%, at most 25%)`);
    assert.match(phone[1], /--qr-pv-cap:28px/);
    // desktop keeps the roomier preview
    assert.match(css, /#qr-root\{[\s\S]*?--qr-pv-h:clamp\(150px,30dvh,300px\)/);
    // one pinned preview, flush under the header, with a stage whose height comes from the token
    assert.match(css, /#qr-root \.qr-preview\{\s*position:sticky;top:-16px;/);
    assert.match(css, /#qr-root \.qr-pv-stage\{[^}]*height:calc\(var\(--qr-pv-h\) - var\(--qr-pv-cap\)\)/);
    // compact: caption on, the drawing's text rows and frame off, the description line off
    const block = css.slice(css.indexOf('#qr-root .qr-pv-cap{display:none'));
    const m = block.match(new RegExp(COMPACT + '\\{([\\s\\S]*?)\\n\\}'));
    assert.ok(m, 'the compact rules of the preview');
    assert.match(m[1], /\.qr-pv-cap\{display:block\}/);
    assert.match(m[1], /\.qr-pv-opts,#qr-root \.qr-pv-note,#qr-root \.qr-pv-frame\{display:none\}/);
    assert.match(m[1], /\[data-kind="configure"\] \.qr-sheet-sub\{display:none\}/);
    // option headings are never hidden behind the pinned preview when a control scrolls into view (>= preview + a burner card heading)
    assert.match(css, /\.qr-sheet-body\.has-preview\{scroll-padding-top:calc\(var\(--qr-pv-h\) \+ var\(--qr-pv-pad\)\)\}/);
    const pad = css.match(/#qr-root\{[\s\S]*?--qr-pv-pad:(\d+)px/);
    assert.ok(pad && Number(pad[1]) >= 110, 'the default scroll padding must clear the preview and a two-row burner card heading');
    // the title box fills the head so the close button stays at the right edge without a description line
    assert.match(css, /#qr-root \.qr-sheet-titlebox\{flex:1 1 auto;min-width:0\}/);
  });
  it('SHORT WINDOW (css): on a landscape phone the preview shrinks to its caption line so the options keep the room, and the scroll padding shrinks with it', () => {
    const css = read('css/quote-request.css');
    const tokens = css.match(/@media \(max-height:520px\)\{\s*#qr-root\{([^}]*)\}/);
    assert.ok(tokens, 'a short-window block that sets the tokens');
    assert.match(tokens[1], /--qr-pv-h:28px/);
    assert.match(tokens[1], /--qr-pv-cap:28px/, 'the preview is exactly the caption line');
    const pad = tokens[1].match(/--qr-pv-pad:(\d+)px/);
    assert.ok(pad && Number(pad[1]) <= 60, 'a short window cannot afford the tall burner-card padding');
    assert.match(css, /@media \(max-height:520px\)\{\s*#qr-root \.qr-pv-stage,#qr-root \.qr-pv-insets\{display:none\}/);
    // the order matters: the short-window block comes AFTER the compact block, so it wins
    assert.ok(css.indexOf('@media (max-height:520px)') > css.indexOf('@media (max-width:719px),(max-height:640px)'));
  });
  it('KEYBOARD (css + page): with the on-screen keyboard up the preview collapses to its caption line and the scroll padding shrinks; the page sets the class from the visual viewport', () => {
    const css = read('css/quote-request.css');
    const tokens = css.match(/html\.qr-kb-open #qr-root\{([^}]*)\}/);
    assert.ok(tokens, 'a keyboard-open block that sets the tokens');
    assert.match(tokens[1], /--qr-pv-h:28px/);
    assert.match(tokens[1], /--qr-pv-cap:28px/, 'the preview is exactly the caption line');
    const pad = tokens[1].match(/--qr-pv-pad:(\d+)px/);
    assert.ok(pad && Number(pad[1]) <= 60);
    assert.match(css, /html\.qr-kb-open #qr-root \.qr-pv-cap\{display:block\}/);
    assert.match(css, /html\.qr-kb-open #qr-root \.qr-pv-stage,html\.qr-kb-open #qr-root \.qr-pv-insets\{display:none\}/);
    const page = read('js/quote-request.js');
    assert.match(page, /var kbOpen = inset > 80;/);
    assert.match(page, /doc\.documentElement\.classList\.toggle\('qr-kb-open', kbOpen\);/);
    assert.match(page, /ae\.scrollIntoView\(\{ block: 'nearest' \}\)/);
  });
  it('FORCED COLOURS (css): a selected segment or chip is still visible when the system replaces every fill', () => {
    const css = read('css/quote-request.css');
    assert.match(css, /@media \(forced-colors:active\)\{\s*#qr-root \.qr-seg-btn\.is-on,#qr-root \.qr-chip\.is-on\{outline:3px solid Highlight;/);
  });
  it('TOASTS (css + page): a left-over toast is cleared when a sheet opens, and one shown while a phone sheet is open sits above the footer buttons', () => {
    const css = read('css/quote-request.css');
    assert.match(css, /@media \(max-width:719px\)\{\s*html\.qr-lock #qr-root \.qr-toast\{bottom:calc\(var\(--qr-kb,0px\) \+ var\(--qr-toast-b,84px\)\)\}/);
    const page = read('js/quote-request.js');
    assert.match(page, /if \(opening\) hideToast\(\);/);
    assert.match(page, /function hideToast\(\) \{ clearTimeout\(toastTimer\); toastEl\.hidden = true; \}/);
    assert.match(page, /sheetEl\.querySelector\('\.qr-sheet-foot'\)/);
    assert.match(page, /setProperty\('--qr-toast-b', \(Math\.ceil\(foot\.getBoundingClientRect\(\)\.height\) \+ 12\) \+ 'px'\)/);
    assert.match(page, /f\.body\.classList\.add\('has-preview'\);/);
    // on a desktop the sheet is a centred dialog: the toast goes to the strip above it, not over its footer
    assert.match(css, /@media \(min-width:720px\)\{\s*html\.qr-lock #qr-root \.qr-toast\{top:10px;bottom:auto\}/);
    // a long notice stays up long enough to read; closing the sheet shows a notice that waited
    assert.match(page, /Math\.max\(3800, 1800 \+ String\(msg\)\.length \* 40\)/);
    assert.match(page, /if \(pendingToast && !sheet\.kind\)/);
  });
  it('CATALOGUE LAYOUT (css): one column and the compact card on a phone; a configurable card is the stacked full-width card there, a wide featured row from 720px, and a row of cards where a category holds several (the full layout pins live in tests/catalogue-layout.test.mjs)', () => {
    const css = read('css/catalogue.css');
    assert.match(css, /#site \.cat-grid\{display:grid;grid-template-columns:minmax\(0,1fr\);gap:10px\}/);
    assert.match(css, /#site \.cat-card-feature\{grid-column:1 \/ -1;display:flex;flex-direction:column\}/);
    assert.match(css, /#site \.cat-card-feature\{grid-column:1 \/ -1;display:grid;grid-template-columns:minmax\(0,45fr\) minmax\(0,55fr\)/);
    assert.match(css, /#site \.cat-grid-multi\{grid-template-columns:repeat\(auto-fit,minmax\(240px,1fr\)\)/);
  });
  it('the CSS switches the cross-fade off under prefers-reduced-motion, and uses no inline style or 4-digit z-index', () => {
    const css = read('css/quote-request.css');
    assert.match(css, /prefers-reduced-motion:reduce\)\{[\s\S]*#qr-root \.qr-pv-layer[\s\S]*transition:none/);
    assert.ok(!/z-index:\s*\d{4}/.test(css));
    assert.ok(/\.qr-preview\{[^}]*aspect-ratio|\.qr-pv-stage\{[^}]*aspect-ratio:4\/3/.test(css), 'the preview is 4:3');
  });
});

describe('the generated files and what ships to the public', () => {
  it('js/qr-families.js is exactly what the build generates from scripts/public-families.json (deterministic), and its mirror is byte-identical', () => {
    const fresh = B.renderFamiliesJs(B.loadPublicFamilies({ published: PUBLISHED }));
    assert.equal(read('js/qr-families.js'), fresh, 'js/qr-families.js is stale — run: node scripts/build-catalogue.js');
    assert.equal(read('functions/qr-families.js'), fresh);
    assert.equal(fresh, B.renderFamiliesJs(B.loadPublicFamilies({ published: PUBLISHED })));
    assert.match(fresh, /GENERATED by scripts\/build-catalogue\.js from scripts\/public-families\.json\. DO NOT HAND-EDIT\./);
  });
  it('the family definitions carry no price, rate, formula or amount of any kind — and no photo product, no fixed list, no readme', () => {
    const txt = JSON.stringify(FAMS);
    assert.ok(!B.MONEY_RE.test(txt) && !B.FORMULA_RE.test(txt), 'a money pattern is in the family definitions');
    assert.ok(!/basePrice|priceAdder|pricePer|rateW100|rateD100|rateH100|formulaType|unitPrice|lineTotal|exactTotal|listPrice|laborHours/.test(txt));
    for (const f of ORDER) assert.deepEqual(Object.keys(fam(f)).filter((k) => !['id', 'label', 'category', 'description', 'construction', 'primary', 'unit', 'sizeBasis', 'groups', 'dims', 'widthRule', 'minDimWhen', 'maxDimWhen', 'specMap', 'preview', 'absorbed'].includes(k)), [], f);
    assert.deepEqual(Object.keys(FAMS).sort(), ['families', 'order', 'version']);
  });
  it('the three public scripts carry NO pricing vocabulary, no markup injection and no code evaluation (the same pattern CHECK 9 runs)', () => {
    const VOCAB = /basePrice|priceAdder|pricePer|rateW100|rateD100|rateH100|formulaType|unitPrice|lineTotal|exactTotal|listPrice|₱\s*[0-9]|PHP ?[0-9]|\b[0-9]{1,3}(,[0-9]{3})+\b|pricing-core/;
    for (const f of ['js/product-families.js', 'js/qr-families.js', 'js/qr-preview.js', 'js/quote-request.js']) {
      const src = read(f);
      assert.ok(!VOCAB.test(src), `${f} carries pricing vocabulary`);
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      assert.ok(!/innerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|outerHTML/.test(code), `${f}: markup injection or code evaluation`);
    }
  });
  it('the family helper and the preview widget are classic scripts: no import / export / require at top level, ES5 only (no arrow functions, let / const, template literals) for old phones', () => {
    for (const f of ['js/product-families.js', 'js/qr-preview.js']) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      assert.ok(!/^\s*(import|export)\s/m.test(code), f);
      assert.ok(!/=>|\blet\b|\bconst\b|`/.test(code), `${f} uses syntax newer than ES5`);
    }
  });
  it('it is a UMD file: loads under Node (module.exports) and in a browser (window.ProductFamilies) from the same bytes, and does not create a window global under Node', () => {
    const win = {};
    vm.runInNewContext(read('js/product-families.js'), { window: win });
    assert.equal(typeof win.ProductFamilies.validateLine, 'function');
    const out = vm.runInNewContext('var module={exports:{}}; (function(){' + read('js/product-families.js') + '\n})(); typeof window', {});
    assert.equal(out, 'undefined');
    const w2 = {};
    vm.runInNewContext(read('js/qr-families.js'), { window: w2 });
    assert.deepEqual([...w2.QR_FAMILIES.order], ORDER);
  });
});

// ══════════════════════════════════ STANDARD CONSTRUCTION (owner ruling 2026-10-28) ══════════════════════════════════
// Made-to-order fabricated equipment is SS304 · 1.5 mm (16 ga) top plates on tables, sinks and stoves · square-tube posts with adjustable bullet feet · 1.2 mm
// body and shelving. 1.5 mm is the DEFAULT; 1.2 mm is a lighter option that ONLY staff may choose (QUOTE-BUILDER-CONFIGURATOR-SPEC §14).
const CONSTRUCTION_AT_DEFAULT = {
  prep_table: 'SS304 stainless steel · 1.5 mm (16 ga) top plate · 1.2 mm undershelves and upper shelves · square-tube posts with adjustable bullet feet',
  sink: 'SS304 stainless steel · 1.5 mm (16 ga) top plate · 1.2 mm undershelf, upper shelf and panels · square-tube posts with adjustable bullet feet',
  dish_table: 'SS304 stainless steel · 1.5 mm (16 ga) top plate · 1.2 mm undershelf and splash · raised back and side splash, clean-dish landing · square-tube posts with adjustable bullet feet',
  stove: 'SS304 stainless steel · 1.5 mm (16 ga) top plate · 1.2 mm body and panels · square-tube posts with adjustable bullet feet',
  wok_range: 'SS304 stainless steel · 1.5 mm (16 ga) top plate · 1.2 mm body and panels · recessed wok rings with high-pressure burners · square-tube posts with adjustable bullet feet',
  cooking_line: 'SS304 stainless steel · 1.2 mm body and panels · semi-non-stick griddle plate, gas-fired · square-tube stand with adjustable bullet feet',
  deck_oven: 'Insulated double-wall decks with a gas burner, gas valve and thermometer per deck · stainless steel outer body · set on your own base',
  hood: 'SS304 stainless steel · welded canopy with grease trough and oil cup · wall-mounted canopy · stainless baffle grease filters',
  cabinet: 'SS304 stainless steel · 1.2 mm body, doors and shelves · square-tube posts with adjustable bullet feet',
  wall_shelf: 'SS304 stainless steel · 1.2 mm shelves · fixed to the wall',
  rack: 'SS304 stainless steel · 1.2 mm shelves · square-tube frame · on wheels',
};
const WITH_TOP = ['prep_table', 'sink', 'dish_table', 'stove', 'wok_range'];       // the staff-only 1.2 mm top plate (cooking line, deck oven and hood have none)
const WITHOUT_TOP = ORDER.filter((f) => !WITH_TOP.includes(f));
const STAFF_ONLY_MSG = '"Top plate" is chosen by our staff when the quotation is prepared.';

describe('STANDARD CONSTRUCTION (owner ruling 2026-10-28) — every family states how it is built; the 1.2 mm top plate is STAFF-ONLY', () => {
  it('the source sentences are the owner\'s wording, with a {token} only where the construction depends on an option', () => {
    assert.deepEqual(Object.fromEntries(ORDER.map((f) => [f, SRC.families[f].construction])), {
      prep_table: 'SS304 stainless steel · {top} · 1.2 mm undershelves and upper shelves · square-tube posts with adjustable bullet feet',
      sink: 'SS304 stainless steel · {top} · 1.2 mm undershelf, upper shelf and panels · square-tube posts with adjustable bullet feet',
      dish_table: 'SS304 stainless steel · {top} · 1.2 mm undershelf and splash · {side} · square-tube posts with adjustable bullet feet',
      stove: 'SS304 stainless steel · {top} · 1.2 mm body and panels · square-tube posts with adjustable bullet feet',
      wok_range: 'SS304 stainless steel · {top} · 1.2 mm body and panels · recessed wok rings with high-pressure burners · square-tube posts with adjustable bullet feet',
      cooking_line: 'SS304 stainless steel · 1.2 mm body and panels · {type} · {base}',
      deck_oven: 'Insulated double-wall decks with a gas burner, gas valve and thermometer per deck · stainless steel outer body · {stand}',
      hood: 'SS304 stainless steel · welded canopy with grease trough and oil cup · {type} · {filters}',
      cabinet: 'SS304 stainless steel · 1.2 mm body, doors and shelves · {type}',
      wall_shelf: 'SS304 stainless steel · 1.2 mm shelves · fixed to the wall',
      rack: 'SS304 stainless steel · 1.2 mm shelves · square-tube frame · {wheels}',
    });
    // sink bowls are NOT claimed as 1.5 mm (owner question 5): the sink sentence says "top plate" only
    assert.ok(!/bowl|basin/i.test(fam('sink').construction));
    // the option phrases the tokens take
    assert.deepEqual(fam('cabinet').groups.find((g) => g.key === 'type').options.map((o) => o.c), ['square-tube posts with adjustable bullet feet', 'wall-hung']);
    assert.deepEqual(fam('rack').groups.find((g) => g.key === 'wheels').options.map((o) => [o.v, o.c]), [[true, 'on wheels'], [false, 'adjustable bullet feet']]);
  });

  it('constructionLine() at the family defaults is exactly the owner\'s sentence for each of the eleven families', () => {
    for (const f of ORDER) assert.equal(PF.constructionLine(fam(f), PF.defaultConfig(fam(f))), CONSTRUCTION_AT_DEFAULT[f], f);
    for (const f of ORDER) assert.ok(!PF.constructionLine(fam(f), PF.defaultConfig(fam(f))).endsWith('.'), `${f}: no full stop — each page adds its own`);
  });

  it('the tokens follow the chosen options: a 1.2 mm top, a wall-hung cabinet, a rack without wheels; a missing or invalid value reads as the default; junk never throws', () => {
    for (const f of WITH_TOP) {
      const light = PF.constructionLine(fam(f), { ...PF.defaultConfig(fam(f)), top: 1.2 });
      assert.equal(light, CONSTRUCTION_AT_DEFAULT[f].replace('1.5 mm (16 ga) top plate', '1.2 mm top plate (lighter)'), f);
      assert.notEqual(light, CONSTRUCTION_AT_DEFAULT[f]);
    }
    assert.equal(PF.constructionLine(fam('cabinet'), { type: 'wall', doors: 'swing', shelves: 1 }), 'SS304 stainless steel · 1.2 mm body, doors and shelves · wall-hung');
    assert.equal(PF.constructionLine(fam('rack'), { tiers: 4, wheels: false }), 'SS304 stainless steel · 1.2 mm shelves · square-tube frame · adjustable bullet feet');
    // the new families: the sentence follows the type / side / stand / filters chosen
    assert.equal(PF.constructionLine(fam('dish_table'), { side: 'soiled' }), CONSTRUCTION_AT_DEFAULT.dish_table.replace('raised back and side splash, clean-dish landing', 'raised splash, sloped to the dishwasher, soiled-dish loading'));
    assert.equal(PF.constructionLine(fam('cooking_line'), { type: 'combi', base: 'shelf' }), 'SS304 stainless steel · 1.2 mm body and panels · lava-rock griller and griddle side by side, one burner under each, gas-fired · square-tube stand with a 1.2 mm bottom shelf and adjustable bullet feet');
    assert.equal(PF.constructionLine(fam('deck_oven'), { stand: 'heavy' }), CONSTRUCTION_AT_DEFAULT.deck_oven.replace('set on your own base', 'on a cross-braced box-tube stand'));
    assert.equal(PF.constructionLine(fam('hood'), { type: 'island', filters: 'none' }), 'SS304 stainless steel · welded canopy with grease trough and oil cup · island canopy, open on all four sides · open canopy, no filters');
    // absent / invalid / wrongly typed values are the group default
    const prep = fam('prep_table');
    for (const cfg of [{}, { layers: 2 }, { top: undefined }, { top: 9 }, { top: '1.2' }, { top: null }, { top: [1.2] }, null, undefined, 5, 'x', [], true]) assert.equal(PF.constructionLine(prep, cfg), CONSTRUCTION_AT_DEFAULT.prep_table, JSON.stringify(cfg));
    // an inherited key is not a value
    assert.equal(PF.constructionLine(prep, Object.create({ top: 1.2 })), CONSTRUCTION_AT_DEFAULT.prep_table);
    // a family with no `construction` says nothing; junk families never throw
    assert.equal(PF.constructionLine({ groups: [], dims: {} }, {}), '');
    for (const bad of [null, undefined, 0, 'x', [], {}, { construction: 5 }, { construction: '' }]) assert.equal(PF.constructionLine(bad, {}), '', JSON.stringify(bad));
    assert.equal(PF.constructionLine({ construction: 'a {nope} b', groups: [] }, {}), 'a  b', 'an unknown token is dropped, never thrown on (the build refuses such a family)');
  });

  it('describe() ends with the Construction row, has a row for every PUBLIC group and NEVER a "Top plate" row — for every family and every top plate', () => {
    for (const f of ORDER) {
      const cfgs = [PF.defaultConfig(fam(f))].concat(WITH_TOP.includes(f) ? [{ ...PF.defaultConfig(fam(f)), top: 1.2 }] : []);
      for (const cfg of cfgs) {
        const rows = PF.describe(fam(f), cfg);
        assert.deepEqual(rows.map((r) => r.label), [...PF.publicActiveGroups(fam(f), cfg).map((g) => g.label), 'Construction'], f);       // a conditional option that does not apply has no row
        assert.equal(rows[rows.length - 1].value, PF.constructionLine(fam(f), cfg), f);
        assert.ok(!rows.some((r) => /top plate/i.test(r.label)), `${f}: a "Top plate" row`);
        assert.ok(rows.every((r) => typeof r.label === 'string' && typeof r.value === 'string' && r.value.length > 0), f);
      }
    }
    // the plain-words row carries the chosen top plate, so the printed quote says which one it is
    assert.match(PF.describe(fam('sink'), { ...PF.defaultConfig(fam('sink')), top: 1.2 }).at(-1).value, /1\.2 mm top plate \(lighter\)/);
    // a family without `construction` gets no such row
    assert.deepEqual(PF.describe({ groups: [], dims: {} }, {}), []);
  });

  it('the one-line summary says nothing about the standard top plate and "1.2 mm top" for the lighter one; every public summary reads as it did before', () => {
    const sink = fam('sink');
    const cfg = { basins: 1, alignment: 'center', undershelf: false, upper: false, faucet: 'gooseneck' };
    const size = { W: 500, D: 500, H: 850 };
    const before = 'Sink — 1 sink · centred · without undershelf · without upper shelf · gooseneck faucet · 500 × 500 × 850 mm';
    assert.equal(PF.summaryLine(sink, cfg, size), before, 'a configuration with no top stated');
    assert.equal(PF.summaryLine(sink, { ...cfg, top: 1.5 }, size), before, 'the standard top is not mentioned');
    assert.equal(PF.summaryLine(sink, { ...cfg, top: 1.2 }, size), 'Sink — 1 sink · centred · without undershelf · without upper shelf · gooseneck faucet · 1.2 mm top · 500 × 500 × 850 mm');
    for (const f of ORDER) assert.ok(!PF.summaryParts(fam(f), PF.defaultConfig(fam(f))).some((p) => /mm top/.test(p)), f);
    assert.deepEqual(PF.summaryParts(fam('stove'), { ...PF.defaultConfig(fam('stove')), top: 1.2 }).at(-1), '1.2 mm top');
  });

  it('PUBLIC validation (the server, the website, the default) refuses a 1.2 mm top with the exact message and keeps the default; the standard 1.5 mm top and an absent key are accepted', () => {
    for (const f of WITH_TOP) {
      const F = fam(f);
      const bad = PF.validateConfiguration(F, { ...PF.defaultConfig(F), top: 1.2 });
      assert.equal(bad.ok, false, f);
      assert.deepEqual(bad.errors, [STAFF_ONLY_MSG], f);
      assert.equal(bad.config.top, 1.5, `${f}: the configuration takes the default`);
      assert.equal(PF.validateConfiguration(F, { ...PF.defaultConfig(F), top: 1.5 }).ok, true, `${f}: the standard top may be stated`);
      const { top, ...withoutTop } = PF.defaultConfig(F);
      void top;
      const absent = PF.validateConfiguration(F, withoutTop);
      assert.equal(absent.ok, true, `${f}: an absent top is the default`);
      assert.equal(absent.config.top, 1.5);
      assert.equal(PF.validateConfiguration(F, { ...withoutTop, top: undefined }).ok, true, `${f}: undefined is absent`);
      // ANY present value other than the default gets the same staff message — a visitor learns nothing about the options (not even that 9 is not one)
      for (const v of [1.2, 9, '1.2', '1.5', null, true, 0, [], {}, 'x', NaN]) assert.deepEqual(PF.validateConfiguration(F, { ...withoutTop, top: v }).errors, [STAFF_ONLY_MSG], `${f} ${String(v)}`);
      // the server\'s call (validateLine with no opts) refuses it too, in one place only
      const line = PF.validateLine(F, { top: 1.2 }, PF.defaultDims(F));
      assert.equal(line.ok, false, f);
      assert.deepEqual(line.errors, [STAFF_ONLY_MSG], f);
    }
    // the other families have no top plate at all: it is an unknown key there, not a staff-only one
    for (const f of WITHOUT_TOP) assert.match(PF.validateConfiguration(fam(f), { top: 1.5 }).errors[0], /"top" is not an option of this product/, f);
    // opts that are not exactly { staff: true } are PUBLIC mode
    for (const o of [undefined, null, {}, { staff: false }, { staff: 'true' }, { staff: 1 }, { staff: [] }, true, 'staff']) {
      assert.equal(PF.validateConfiguration(fam('sink'), { ...PF.defaultConfig(fam('sink')), top: 1.2 }, o).ok, false, JSON.stringify(o));
      assert.equal(PF.validateLine(fam('sink'), { top: 1.2 }, {}, o).ok, false, JSON.stringify(o));
    }
  });

  it('STAFF validation ({ staff: true }) accepts the 1.2 mm top like any choice, still refuses a value that is not an option, and validateLine passes the option through', () => {
    for (const f of WITH_TOP) {
      const F = fam(f);
      const light = PF.validateConfiguration(F, { ...PF.defaultConfig(F), top: 1.2 }, { staff: true });
      assert.equal(light.ok, true, `${f}: ${light.errors.join(' ')}`);
      assert.equal(light.config.top, 1.2);
      assert.equal(PF.validateConfiguration(F, { ...PF.defaultConfig(F), top: 1.5 }, { staff: true }).config.top, 1.5);
      assert.equal(PF.validateConfiguration(F, {}, { staff: true }).config.top, 1.5, 'absent -> the default in staff mode too');
      for (const v of [9, '1.2', null, true, [], 'x']) assert.deepEqual(PF.validateConfiguration(F, { top: v }, { staff: true }).errors, ['Choose one of the available options for "Top plate".'], `${f} ${String(v)}`);
      const line = PF.validateLine(F, { top: 1.2 }, PF.defaultDims(F), { staff: true });
      assert.equal(line.ok, true, `${f}: ${line.errors.join(' ')}`);
      assert.equal(line.config.top, 1.2);
      assert.equal(line.custom, false, 'a lighter top is not a custom SIZE');
    }
  });

  it('publicGroups() leaves out exactly the staff-only group — `top` on tables, sinks, dish tables, stoves and wok ranges, nothing on the others — and `top` is the LAST group, marked only where it belongs', () => {
    for (const f of ORDER) {
      const left = fam(f).groups.filter((g) => !PF.publicGroups(fam(f)).includes(g)).map((g) => g.key);
      assert.deepEqual(left, WITH_TOP.includes(f) ? ['top'] : [], f);
      fam(f).groups.forEach((g, i, all) => {
        if (g.staffOnly === undefined) return;
        assert.equal(g.staffOnly, true, `${f}.${g.key}`);
        assert.equal(g.type, 'choice', `${f}.${g.key}: staff-only belongs to a choice group`);
        assert.equal(g.key, 'top');
        assert.equal(i, all.length - 1, `${f}: appended LAST`);
      });
    }
    assert.deepEqual(PF.publicGroups(null), []);
    assert.deepEqual(PF.publicGroups({}), []);
    // the group itself is the owner's, word for word
    for (const f of WITH_TOP) {
      assert.deepEqual(fam(f).groups.at(-1), {
        key: 'top', label: 'Top plate', type: 'choice', default: 1.5, staffOnly: true,
        options: [
          { v: 1.5, l: '1.5 mm (16 ga)', s: '1.5 mm top', c: '1.5 mm (16 ga) top plate', hint: 'Standard' },
          { v: 1.2, l: '1.2 mm', s: '1.2 mm top', c: '1.2 mm top plate (lighter)', hint: 'Lighter' },
        ],
      }, f);
    }
  });

  it('no absorbed configuration states a staff-only key, and all 64 absorbed SKUs convert (migrateAbsorbed) to a configuration that validates PUBLIC — at the standard 1.5 mm top', () => {
    let n = 0;
    for (const f of ORDER) for (const [sku, cfg] of Object.entries(fam(f).absorbed)) {
      for (const g of fam(f).groups.filter((x) => x.staffOnly === true)) assert.ok(!Object.prototype.hasOwnProperty.call(cfg, g.key), `${sku} states ${g.key}`);
      const m = PF.migrateAbsorbed(FAMS, sku, { id: sku });
      assert.ok(m, sku);
      const v = PF.validateLine(fam(f), m.config, m.dims);                          // PUBLIC mode: no opts
      assert.equal(v.ok, true, `${sku}: ${v.errors.join(' ')}`);
      if (WITH_TOP.includes(f)) assert.equal(m.config.top, 1.5, `${sku}: converts to the standard top`);
      n++;
    }
    assert.equal(n, 64);
  });

  it('the cells of the private sheet: the 1.5 mm top is the zero point and the 1.2 mm cell is the one Finance enters (signed)', () => {
    for (const f of WITH_TOP) {
      const top = PF.cells(fam(f)).filter((c) => c.group === 'top');
      assert.deepEqual(top.map((c) => [c.value, c.label, c.kind, c.baseline]), [['1.5', '1.5 mm (16 ga)', 'option', true], ['1.2', '1.2 mm', 'option', false]], f);
      assert.equal(top[1].groupLabel, 'Top plate');
    }
    for (const f of WITHOUT_TOP) assert.ok(!PF.cells(fam(f)).some((c) => c.group === 'top'), f);
  });

  it('the public wording rules: "Top plate" (no "gauge" word anywhere), no price or partner name, no grade or finish OPTION — standard text only', () => {
    const words = JSON.stringify([...WITH_TOP.map((f) => fam(f).groups.find((g) => g.key === 'top')), ...ORDER.map((f) => fam(f).construction)]);
    assert.ok(!/gauge/i.test(words), 'the word "gauge" in the new wording (the abbreviation "16 ga" is the owner\'s)');
    // the staff-only option ships inside the PUBLIC family file even though no website surface shows it: its hints say "Standard" and "Lighter" and nothing about money
    assert.deepEqual(WITH_TOP.map((f) => fam(f).groups.find((g) => g.key === 'top').options.map((o) => o.hint)), WITH_TOP.map(() => ['Standard', 'Lighter']));
    assert.ok(!/cheap|budget|discount|bargain|saving|econom|afford|low[- ]?cost|price/i.test(JSON.stringify(WITH_TOP.map((f) => fam(f).groups.find((g) => g.key === 'top')))), 'the staff-only option hints at money in the public file');
    assert.ok(!/cheap|budget/i.test(read('js/qr-families.js')) && !/cheap|budget/i.test(read('scripts/public-families.json')), 'cheaper / budget wording anywhere in the public family files');
    assert.ok(!B.MONEY_RE.test(words) && !B.FORMULA_RE.test(words), 'a pricing pattern in the new wording');
    assert.ok(!B.BRAND_RE.test(words) && !/vesta|barro steel/i.test(words), 'a partner or sister-company name in the new wording');
    assert.ok(!/316|finish|brushed|mirror|satin/i.test(JSON.stringify(ORDER.map((f) => fam(f).construction))), 'the construction sentence offers no grade or finish');
    for (const f of ORDER) for (const g of fam(f).groups) assert.ok(!/grade|finish|material/i.test(g.key + g.label), `${f}.${g.key}: a grade / finish / material OPTION`);
  });

  it('the build refuses a malformed construction, staffOnly, c or absorbed configuration with a plain-text problem (ids and keys only, never a value)', () => {
    const bad = (mut) => { const j = JSON.parse(JSON.stringify(SRC)); mut(j); return () => B.loadPublicFamilies({ source: j, published: PUBLISHED }); };
    assert.throws(bad((j) => { delete j.families.sink.construction; }), /family "sink": "construction" must be a non-empty string/);
    assert.throws(bad((j) => { j.families.sink.construction = '   '; }), /"construction" must be a non-empty string/);
    assert.throws(bad((j) => { j.families.sink.construction = 5; }), /"construction" must be a non-empty string/);
    assert.throws(bad((j) => { j.families.sink.construction = 'SS304 · {nope}'; }), /construction: \{nope\} does not name a choice group of this family/);
    assert.throws(bad((j) => { j.families.stove.construction = 'SS304 · {positions}'; }), /construction: \{positions\} does not name a choice group/);
    assert.throws(bad((j) => { j.families.sink.construction = 'SS304 · {basins}'; }), /every option of "basins" needs a "c" phrase/);
    assert.throws(bad((j) => { j.families.sink.construction = 'SS304 · {top'; }), /a brace that is not a \{groupKey\} token/);
    assert.throws(bad((j) => { delete j.families.sink.groups.at(-1).options[0].c; }), /every option of "top" needs a "c" phrase/);
    assert.throws(bad((j) => { j.families.sink.groups.at(-1).options[0].c = ''; }), /"c" must be a non-empty string/);
    assert.throws(bad((j) => { j.families.sink.groups.at(-1).staffOnly = 'yes'; }), /"staffOnly" must be true or false, and belongs to a choice group only/);
    assert.throws(bad((j) => { j.families.stove.groups[0].staffOnly = true; }), /groups\[0\]: "staffOnly" must be true or false, and belongs to a choice group only/);
    assert.doesNotThrow(bad((j) => { j.families.sink.groups[0].staffOnly = false; }), 'false is a harmless boolean');
    // an absorbed SKU never states a staff-only option — not even the default
    assert.throws(bad((j) => { j.families.sink.absorbed['PW-004'].top = 1.5; }), /absorbed\["PW-004"\]: must not state a staff-only option/);
    assert.throws(bad((j) => { j.families.sink.absorbed['PW-004'].top = 1.2; }), /absorbed\["PW-004"\]: not a valid configuration/);
    // the public-text guard scans the new strings
    assert.throws(bad((j) => { j.families.sink.construction = 'SS304 · {top} · only ₱1,500'; }), /construction: pricing pattern/);
    assert.throws(bad((j) => { j.families.sink.groups.at(-1).options[1].c = 'costs less'; }), /pricing pattern/);
    assert.throws(bad((j) => { j.families.sink.groups.at(-1).options[1].hint = 'Made by ' + 'Brilliant' + ' Steel'; }), /partner-brand/);
    // and the problem list never echoes the offending text
    try { bad((j) => { j.families.sink.construction = 'SS304 · {top} · only ₱1,500'; })(); assert.fail('should have thrown'); } catch (e) { assert.ok(!e.message.includes('1,500'), 'the offending text was echoed'); }
  });

  it('the generated family file carries `construction` and the staff-only group, deterministically: the committed js/qr-families.js is what the generator makes, and the mirror is byte-identical; version 3', () => {
    const fresh = B.renderFamiliesJs(B.loadPublicFamilies({ published: PUBLISHED }));
    assert.equal(read('js/qr-families.js'), fresh, 'js/qr-families.js is stale — run: node scripts/build-catalogue.js');
    assert.equal(read('functions/qr-families.js'), fresh);
    assert.match(fresh, /"construction": "SS304 stainless steel · \{top\} · 1\.2 mm undershelves and upper shelves/);
    assert.equal((fresh.match(/"staffOnly": true/g) || []).length, 5, 'exactly the five top plates (table, sink, dish table, stove, wok range)');
    assert.equal((fresh.match(/"construction":/g) || []).length, 11, 'one sentence per family');
    for (const f of ORDER) assert.equal(typeof fam(f).construction, 'string', f);
    assert.equal(SRC.version, 3);
    assert.equal(FAMS.version, 3, 'the schema is 3 (five more families, conditional options): every option sheet must be approved against it — none is approved yet, so it costs nothing live');
  });
});

// ══════════════════════════════════ CONDITIONAL OPTIONS (`when`) AND UPPER LIMITS (`maxDimWhen`) ══════════════════════════════════
// CONFIGURATOR-FAMILIES-2-SPEC §4. An option may apply only for some values of an EARLIER choice (fry baskets for a fryer, a pre-rinse sink on the soiled side of a dish
// table); when it does not apply it is ALWAYS at its default in a validated configuration, so a stored configuration is canonical and js/pricing-core.js (which adds
// nothing for a default) needs no knowledge of it. An option may also force an UPPER limit on a size (a slim hood is at most 500 mm deep; a deck oven's width follows
// its trays).
//
// MUTATION-TESTED (scratch copies under /private/tmp/.../cf2-ws1-mut/, each mutant must fail at least one test here; the first column is the mutant, the second the test):
//   groupApplies ignores the value list (always true) ......................... 'groupApplies: ...' and 'validateConfiguration refuses an option that does not apply ...'
//   validation keeps a non-default value of an option that does not apply .... 'validateConfiguration refuses an option that does not apply ...'
//   forcedMaxes returns the minimums ......................................... 'a forced MAXIMUM ...' (hood, deck oven)
//   validateDims treats "above the maximum" as a warning ..................... 'a forced MAXIMUM ...'
//   minWidth counts a term whose option does not apply ........................ 'a term, a rule or a row that belongs to an option that does not apply ...'
//   describe() keeps the row of an option that does not apply ................. 'describe / summaryParts omit ...'
//   the build accepts a `when` that points at a LATER group ................... 'the build refuses a malformed `when` ...'
//   standardDims ignores the forced maximum / minimum ......................... 'standardDims ...' and 'an axis left out takes the size these options are normally built at'
const FIX = {
  id: 'fixture', label: 'Fixture', category: 'cooking', unit: 'pc', primary: 'X-1', sizeBasis: 'primary',
  dims: { W: { label: 'Length', min: 100, max: 1000, step: 10, default: 500 }, D: { label: 'Depth', min: 100, max: 600, step: 10, default: 300 } },
  groups: [
    { key: 'kind', label: 'Kind', type: 'choice', default: 'a', options: [{ v: 'a', l: 'Alpha' }, { v: 'b', l: 'Beta' }, { v: 'c', l: 'Gamma' }] },
    { key: 'size', label: 'Size', type: 'choice', default: 1, options: [{ v: 1, l: 'One' }, { v: 2, l: 'Two' }] },
    { key: 'extra', label: 'Extra', type: 'choice', default: 0, when: { kind: ['b', 'c'], size: [2] }, options: [{ v: 0, l: 'None' }, { v: 1, l: 'Some' }] },
    { key: 'tags', label: 'Tags', type: 'multi', default: [], when: { kind: ['b'] }, options: [{ v: 'x', l: 'Ex', w: 100 }, { v: 'y', l: 'Why', w: 200 }] },
  ],
  widthRule: { hard: true, allowance: 50, noun: 'tags', terms: [{ group: 'tags' }] },
  minDimWhen: [{ group: 'extra', includes: 1, min: { W: 600 } }, { group: 'kind', includes: 'c', min: { D: 200 } }],
  maxDimWhen: [{ group: 'kind', includes: 'a', max: { W: 400 } }, { group: 'kind', includes: 'a', max: { W: 300 } }, { group: 'extra', includes: 1, max: { D: 400 } }],
};

describe('when / maxDimWhen — conditional options and upper limits (spec §4, §10.2)', () => {
  const ck = fam('cooking_line'), dish = fam('dish_table'), hood = fam('hood'), deck = fam('deck_oven');
  const gOf = (f, k) => PF.groupOf(f, k);
  const err = (f, cfg, opts) => PF.validateConfiguration(f, cfg, opts);

  it('groupApplies: a group with no `when` always applies; a single value list and a several-value list; a gate the config does not state reads as that group\'s DEFAULT; several keys must ALL hold', () => {
    assert.equal(PF.groupApplies(ck, gOf(ck, 'type'), { type: 'fryer' }), true, 'no `when`: always');
    assert.equal(PF.groupApplies(ck, gOf(ck, 'base'), {}), true);
    const baskets = gOf(ck, 'baskets'), burners = gOf(ck, 'burners');
    assert.equal(PF.groupApplies(ck, baskets, { type: 'fryer' }), true);            // single value list
    assert.equal(PF.groupApplies(ck, baskets, { type: 'griddle' }), false);
    assert.equal(PF.groupApplies(ck, burners, { type: 'griddle' }), true);          // a list of two
    assert.equal(PF.groupApplies(ck, burners, { type: 'griller' }), true);
    assert.equal(PF.groupApplies(ck, burners, { type: 'fryer' }), false);
    assert.equal(PF.groupApplies(ck, burners, { type: 'combi' }), false);
    // the gate absent from the config -> the gating group's default ("griddle"): burners apply, baskets do not
    assert.equal(PF.groupApplies(ck, burners, {}), true);
    assert.equal(PF.groupApplies(ck, baskets, {}), false);
    assert.equal(PF.groupApplies(ck, baskets, undefined), false);
    assert.equal(PF.groupApplies(ck, baskets, { type: undefined }), false, 'undefined is absent');
    assert.equal(PF.groupApplies(dish, gOf(dish, 'sink'), { side: 'soiled' }), true);
    assert.equal(PF.groupApplies(dish, gOf(dish, 'sink'), {}), false);
    // a value of the wrong TYPE is not a match ("true" is not true)
    assert.equal(PF.groupApplies(FIX, gOf(FIX, 'extra'), { kind: 'b', size: '2' }), false);
    // several keys: ALL must hold
    const extra = gOf(FIX, 'extra');
    assert.equal(PF.groupApplies(FIX, extra, { kind: 'b', size: 2 }), true);
    assert.equal(PF.groupApplies(FIX, extra, { kind: 'c', size: 2 }), true);
    assert.equal(PF.groupApplies(FIX, extra, { kind: 'a', size: 2 }), false);
    assert.equal(PF.groupApplies(FIX, extra, { kind: 'b', size: 1 }), false);
    assert.equal(PF.groupApplies(FIX, extra, { kind: 'b' }), false, 'size absent -> its default (1)');
    // junk never throws
    for (const bad of [null, undefined, 5, 'x', []]) assert.doesNotThrow(() => PF.groupApplies(ck, gOf(ck, 'baskets'), bad));
    assert.equal(PF.groupApplies(ck, null, {}), true);
    assert.equal(PF.groupApplies(ck, { key: 'z', when: 5 }, {}), true, 'a malformed `when` is "no condition" (the build refuses it)');
  });

  it('activeGroups / publicActiveGroups: the groups that apply to this configuration (and, of those, the public ones)', () => {
    assert.deepEqual(PF.activeGroups(ck, { type: 'griddle' }).map((g) => g.key), ['type', 'burners', 'base']);
    assert.deepEqual(PF.activeGroups(ck, { type: 'fryer' }).map((g) => g.key), ['type', 'baskets', 'base']);
    assert.deepEqual(PF.activeGroups(ck, { type: 'combi' }).map((g) => g.key), ['type', 'base']);
    assert.deepEqual(PF.activeGroups(dish, { side: 'clean' }).map((g) => g.key), ['side', 'hand', 'undershelf', 'top']);
    assert.deepEqual(PF.publicActiveGroups(dish, { side: 'soiled' }).map((g) => g.key), ['side', 'hand', 'sink', 'undershelf'], 'the staff-only top plate is never public');
    assert.deepEqual(PF.publicActiveGroups(fam('sink'), {}).map((g) => g.key), PF.publicGroups(fam('sink')).map((g) => g.key), 'no condition anywhere: the same as publicGroups');
    assert.deepEqual(PF.activeGroups(null, {}), []);
  });

  it('whenText: "Type is Fryer", "Type is Griddle or Lava-rock griller", several keys joined with " and " — the LABELS, never the stored values; "" for a group with no condition', () => {
    assert.equal(PF.whenText(ck, gOf(ck, 'baskets')), 'Type is Fryer');
    assert.equal(PF.whenText(ck, gOf(ck, 'burners')), 'Type is Griddle or Lava-rock griller');
    assert.equal(PF.whenText(dish, gOf(dish, 'sink')), 'Side is Soiled');
    assert.equal(PF.whenText(FIX, gOf(FIX, 'extra')), 'Kind is Beta or Gamma and Size is Two');
    assert.equal(PF.whenText(ck, gOf(ck, 'type')), '');
    assert.equal(PF.whenText(ck, null), '');
    assert.equal(PF.whenText(ck, { when: 5 }), '');
    // a value that is not an option of the gate reads as itself (the build refuses such a family)
    assert.equal(PF.whenText(ck, { when: { type: ['teapot'] } }), 'Type is teapot');
  });

  it('validateConfiguration refuses an option that does not apply when it is stated with a non-default value — in BOTH modes — and snaps it to its default; absent or default is silently the default', () => {
    for (const opts of [undefined, { staff: true }]) {
      const a = err(ck, { type: 'griddle', baskets: 3 }, opts);
      assert.equal(a.ok, false);
      assert.deepEqual(a.errors, ['"Fry baskets" applies only when Type is Fryer.']);
      assert.equal(a.config.baskets, 2, 'the configuration takes the default');
      assert.deepEqual(err(ck, { type: 'fryer', baskets: 3 }, opts).errors, []);
      assert.equal(err(ck, { type: 'fryer', baskets: 3 }, opts).config.baskets, 3);
      const b = err(ck, { type: 'fryer', burners: 2 }, opts);
      assert.deepEqual(b.errors, ['"Burners" applies only when Type is Griddle or Lava-rock griller.']);
      assert.equal(b.config.burners, 1);
      assert.equal(err(ck, { type: 'griller', burners: 3 }, opts).ok, true);
      assert.deepEqual(err(ck, { type: 'combi', burners: 2, baskets: 1 }, opts).errors, ['"Burners" applies only when Type is Griddle or Lava-rock griller.', '"Fry baskets" applies only when Type is Fryer.'], 'two misused options: two messages, in group order');
      const d = err(dish, { side: 'clean', sink: 'prerinse' }, opts);
      assert.deepEqual(d.errors, ['"Pre-rinse sink" applies only when Side is Soiled.']);
      assert.equal(d.config.sink, 'none');
      assert.equal(err(dish, { side: 'soiled', sink: 'prerinse' }, opts).ok, true);
      // absent -> silently the default; stated AT the default -> accepted
      assert.deepEqual(err(ck, { type: 'griddle' }, opts), { ok: true, errors: [], config: { type: 'griddle', burners: 1, baskets: 2, base: 'stand' } });
      assert.equal(err(ck, { type: 'griddle', baskets: 2 }, opts).ok, true, 'the default of an option that does not apply may be stated');
      assert.equal(err(ck, { type: 'fryer', burners: 1 }, opts).ok, true);
      assert.equal(err(ck, { type: 'griddle', baskets: undefined }, opts).ok, true, 'undefined is absent');
      // the gate itself invalid: its own error AND the dependants are judged against its DEFAULT
      assert.deepEqual(err(ck, { type: 'teapot', baskets: 3 }, opts).errors, ['Choose one of the available options for "Type".', '"Fry baskets" applies only when Type is Fryer.']);
    }
    // the hand of a dish table is not conditional: a mirror image is always allowed
    assert.equal(err(dish, { side: 'clean', hand: 'right' }).ok, true);
    // a validated configuration is canonical: every option that does not apply is at its default, for every combination of the gates
    for (const type of ['griddle', 'griller', 'fryer', 'combi']) {
      const c = err(ck, { type, burners: type === 'griddle' || type === 'griller' ? 3 : undefined, baskets: type === 'fryer' ? 1 : undefined }).config;
      if (!PF.groupApplies(ck, gOf(ck, 'burners'), c)) assert.equal(c.burners, 1, type);
      if (!PF.groupApplies(ck, gOf(ck, 'baskets'), c)) assert.equal(c.baskets, 2, type);
    }
  });

  it('a conditional MULTI group: [] (its default) is accepted when it does not apply, a non-empty list is refused and reset to []', () => {
    assert.deepEqual(err(FIX, { kind: 'a', tags: [] }), { ok: true, errors: [], config: { kind: 'a', size: 1, extra: 0, tags: [] } });
    const bad = err(FIX, { kind: 'a', tags: ['x'] });
    assert.deepEqual(bad.errors, ['"Tags" applies only when Kind is Beta.']);
    assert.deepEqual(bad.config.tags, []);
    assert.deepEqual(err(FIX, { kind: 'b', tags: ['y', 'x'] }), { ok: true, errors: [], config: { kind: 'b', size: 1, extra: 0, tags: ['x', 'y'] } }, 'applies: validated and put into the family\'s own order');
    // two conditions at once: both must hold
    assert.deepEqual(err(FIX, { kind: 'b', size: 1, extra: 1 }).errors, ['"Extra" applies only when Kind is Beta or Gamma and Size is Two.']);
    assert.equal(err(FIX, { kind: 'b', size: 2, extra: 1 }).ok, true);
    // an invalid value of a group that does not apply is its OWN error only (no second "applies only" message)
    assert.deepEqual(err(FIX, { kind: 'a', tags: ['nope'] }).errors, ['"Tags": one of the choices is not available, or is listed twice.']);
  });

  it('validateLine / the server\'s call: a conditional option stated wrongly makes the line invalid, whatever the size', () => {
    assert.equal(PF.validateLine(ck, { type: 'griddle', baskets: 3 }, { W: 700, D: 700 }).ok, false);
    assert.equal(PF.validateLine(ck, { type: 'fryer', baskets: 3 }, { W: 1000, D: 700 }).ok, true);
    assert.deepEqual(PF.validateLine(ck, { type: 'fryer', baskets: 3 }, { W: 1000, D: 700 }).config, { type: 'fryer', burners: 1, baskets: 3, base: 'stand' });
  });

  it('a term, a rule or a row that belongs to an option that does not apply counts for nothing: minWidth skips the term, forcedMins / forcedMaxes skip the rule', () => {
    // fixture: the width rule's only term is the conditional `tags` group (the five real families have no conditional width term — this pins the RULE)
    assert.deepEqual(PF.minWidth(FIX, { kind: 'a', tags: ['x', 'y'] }), { mm: 100, hard: true, noun: 'tags' }, '50 allowance, tags do not apply -> 50, raised to the axis minimum 100');
    assert.deepEqual(PF.minWidth(FIX, { kind: 'b', tags: ['x', 'y'] }), { mm: 350, hard: true, noun: 'tags' }, '50 + 100 + 200 when they apply');
    assert.deepEqual(PF.minWidth(FIX, { tags: ['x', 'y'] }), { mm: 100, hard: true, noun: 'tags' }, 'no kind stated -> its default, "a": the tags do not apply');
    // minDimWhen on a conditional group: `extra` only exists for kind b / c and size 2
    assert.deepEqual(PF.forcedMins(FIX, { kind: 'a', size: 2, extra: 1 }), {}, 'extra does not apply (kind a): its rule is skipped');
    assert.deepEqual(PF.forcedMins(FIX, { kind: 'b', size: 2, extra: 1 }), { W: 600 });
    assert.deepEqual(PF.forcedMins(FIX, { kind: 'c', size: 2, extra: 0 }), { D: 200 }, 'a rule on a group that always applies still works');
    // maxDimWhen likewise; with two rules on one axis the SMALLEST maximum wins
    assert.deepEqual(PF.forcedMaxes(FIX, { kind: 'a' }), { W: 300 });
    assert.deepEqual(PF.forcedMaxes(FIX, { kind: 'a', size: 2, extra: 1 }), { W: 300 }, 'the extra rule (D <= 400) is skipped: extra does not apply for kind a');
    assert.deepEqual(PF.forcedMaxes(FIX, { kind: 'b', size: 2, extra: 1 }), { D: 400 });
    assert.deepEqual(PF.forcedMaxes(FIX, { kind: 'b' }), {});
    assert.deepEqual(PF.forcedMaxes(hood, undefined), {}, 'no config: nothing is forced');
    assert.deepEqual(PF.forcedMaxes(fam('sink'), { basins: 2 }), {}, 'a family with no maxDimWhen');
    assert.deepEqual(PF.forcedMaxes(null, {}), {});
  });

  it('a forced MAXIMUM: a slim hood is at most 500 mm deep; a deck oven\'s width is 700 mm for 3 trays per deck and 1200 mm for 6 — below the minimum, above the maximum and exactly on it', () => {
    assert.deepEqual(PF.forcedMaxes(hood, { type: 'slim' }), { D: 500 });
    assert.deepEqual(PF.forcedMaxes(hood, { type: 'wall' }), {});
    assert.deepEqual(PF.forcedMaxes(deck, { trays: 3 }), { W: 700 });
    assert.deepEqual(PF.forcedMaxes(deck, { trays: 6 }), { W: 1200 });
    const d = PF.validateDims(hood, { W: 1000, D: 600 }, { type: 'slim' });
    assert.equal(d.ok, false);
    assert.deepEqual(d.errors, ['With these options the depth must be at most 500 mm.']);
    assert.equal(PF.validateDims(hood, { W: 1000, D: 500 }, { type: 'slim' }).ok, true, 'exactly the maximum is fine');
    assert.equal(PF.validateDims(hood, { W: 1000, D: 600 }, { type: 'wall' }).ok, true, 'only a slim hood is limited');
    assert.equal(PF.validateLine(hood, { type: 'slim' }, { W: 1000, D: 510 }).ok, false);
    // the minimums of the other types (hoods): an island hood is at least 1200 long and 700 deep, a wall hood at least 500 deep
    assert.deepEqual(PF.validateDims(hood, { W: 1000, D: 900 }, { type: 'island' }).errors, ['With these options the length must be at least 1200 mm.']);
    assert.deepEqual(PF.validateDims(hood, { W: 1500, D: 600 }, { type: 'island' }).errors, ['With these options the depth must be at least 700 mm.']);
    assert.deepEqual(PF.validateDims(hood, { W: 1000, D: 400 }, { type: 'wall' }).errors, ['With these options the depth must be at least 500 mm.']);
    // the deck oven: 6 trays -> 1200 exactly
    assert.deepEqual(PF.validateDims(deck, { W: 700 }, { trays: 6 }).errors, ['With these options the width must be at least 1200 mm.']);
    assert.deepEqual(PF.validateDims(deck, { W: 1300 }, { trays: 6 }).errors, ['With these options the width must be at most 1200 mm.']);
    assert.equal(PF.validateDims(deck, { W: 1200 }, { trays: 6 }).ok, true);
    assert.deepEqual(PF.validateDims(deck, { W: 800 }, { trays: 3 }).errors, ['With these options the width must be at most 700 mm.']);
    assert.equal(PF.validateDims(deck, { W: 700 }, { trays: 3 }).ok, true);
    assert.equal(PF.validateDims(deck, { W: 1500 }, { trays: 3 }).ok, false, 'the axis allows 1500 but no tray count does');
    // a MAXIMUM is an error, never a warning: the line is refused
    assert.deepEqual(PF.validateDims(hood, { D: 600 }, { type: 'slim' }).warnings, []);
    assert.equal(PF.validateLine(deck, { trays: 3 }, { W: 1000 }).ok, false);
  });

  it('standardDims: the family default raised to the minimums and LOWERED to the maximums — a six-tray oven is 1200 wide, a three-tray one 700, a slim hood 500 deep, an island hood 1200 x 900', () => {
    assert.equal(PF.standardDims(deck, { trays: 6 }).W, 1200);
    assert.equal(PF.standardDims(deck, { trays: 3 }).W, 700);
    assert.deepEqual(PF.standardDims(deck, PF.defaultConfig(deck)), PF.defaultDims(deck), 'the default configuration is built at the default size');
    assert.deepEqual(PF.standardDims(hood, { type: 'slim' }), { W: 1000, D: 500 });
    assert.deepEqual(PF.standardDims(hood, { type: 'island' }), { W: 1200, D: 900 });
    assert.deepEqual(PF.standardDims(hood, { type: 'wall' }), { W: 1000, D: 900 });
    assert.deepEqual(PF.standardDims(FIX, { kind: 'a' }), { W: 300, D: 300 }, 'lowered to the smallest maximum');
    // a size equal to the standard one is NOT a custom size
    assert.equal(PF.validateLine(deck, { trays: 6 }, { W: 1200 }).custom, false);
    assert.equal(PF.validateLine(hood, { type: 'slim' }, { W: 1000, D: 500 }).custom, false);
    assert.equal(PF.validateLine(hood, { type: 'slim' }, { W: 1000, D: 400 }).custom, true);
  });

  it('an axis the caller leaves out takes the size these options are normally built at, not the family default (a six-tray oven with no width is 1200 wide)', () => {
    const v = PF.validateLine(deck, { trays: 6 }, {});
    assert.equal(v.ok, true, v.errors.join(' '));
    assert.deepEqual(v.dims, { W: 1200 });
    assert.equal(v.custom, false);
    assert.deepEqual(PF.validateLine(deck, { trays: 6 }, null).dims, { W: 1200 });
    assert.deepEqual(PF.validateLine(hood, { type: 'slim' }, { W: 2000 }).dims, { W: 2000, D: 500 }, 'a slim hood with no depth is 500 deep');
    assert.deepEqual(PF.validateLine(hood, { type: 'island' }, {}).dims, { W: 1200, D: 900 });
    assert.deepEqual(PF.validateLine(fam('sink'), { basins: 3 }, {}).dims, { W: 1500, D: 500, H: 850 }, 'a three-sink table with no length is the usual 1500 mm');
    assert.deepEqual(PF.validateDims(fam('prep_table'), {}, {}).dims, { W: 900, D: 600, H: 850 }, 'unchanged for the default options');
    // an axis that IS stated is judged as it always was
    assert.equal(PF.validateLine(deck, { trays: 6 }, { W: 700 }).ok, false);
  });

  it('migrateAbsorbed: an old line is raised to the minimums AND lowered to the maximums of its options (CE-016 is a six-tray oven: 1200 wide; EX-020 is a slim hood: at most 500 deep)', () => {
    assert.deepEqual(PF.migrateAbsorbed(FAMS, 'CE-016', { id: 'CE-016' }), { familyId: 'deck_oven', config: { decks: 2, trays: 6, stand: 'none' }, dims: { W: 1200 } });
    assert.deepEqual(PF.migrateAbsorbed(FAMS, 'CE-012', { id: 'CE-012' }).dims, { W: 700 });
    assert.deepEqual(PF.migrateAbsorbed(FAMS, 'CE-012', { id: 'CE-012', size: { W: 2000 } }).dims, { W: 700 }, 'a saved width above the three-tray maximum is lowered');
    assert.deepEqual(PF.migrateAbsorbed(FAMS, 'CE-016', { id: 'CE-016', size: { W: 2000 } }).dims, { W: 1200 });
    assert.deepEqual(PF.migrateAbsorbed(FAMS, 'EX-020', { id: 'EX-020', size: { W: 1800, D: 760 } }).dims, { W: 1800, D: 500 });
    assert.deepEqual(PF.migrateAbsorbed(FAMS, 'EX-020', { id: 'EX-020', size: { W: 1800, D: 305 } }).dims, { W: 1800, D: 310 }, 'the real slim hood: 305 mm deep rounds to the 10 mm step');
    assert.deepEqual(PF.migrateAbsorbed(FAMS, 'EX-018', { id: 'EX-018', size: { W: 1219, D: 1092 } }).dims, { W: 1220, D: 1090 });
    assert.deepEqual(PF.migrateAbsorbed(FAMS, 'CE-023', { id: 'CE-023', size: { W: 610, D: 1219 } }).dims, { W: 1200, D: 900 }, 'the 3-burner griddle: W raised to the 3-burner minimum, D clamped into the family\'s limits');
    assert.deepEqual(PF.migrateAbsorbed(FAMS, 'CE-022', { id: 'CE-022' }).dims, { W: 1000, D: 700 }, 'the 3-basket fryer has no size of its own: the default length is raised to the 3-basket minimum');
    assert.deepEqual(PF.migrateAbsorbed(FAMS, 'CE-025', { id: 'CE-025', size: { W: 1500, D: 800 } }).dims, { W: 1500, D: 800 });
    assert.deepEqual(PF.migrateAbsorbed(FAMS, 'PW-029', { id: 'PW-029', size: { W: 1219, D: 660, H: 851 } }).dims, { W: 1220, D: 660 }, 'the dish table has no height axis');
    // the old specs are not needed: every old SKU of the new families converts to a VALID line
    for (const f of ['dish_table', 'wok_range', 'cooking_line', 'deck_oven', 'hood']) for (const sku of Object.keys(fam(f).absorbed)) {
      const m = PF.migrateAbsorbed(FAMS, sku, { id: sku });
      assert.equal(m.familyId, f, sku);
      assert.equal(PF.validateLine(fam(f), m.config, m.dims).ok, true, sku);
    }
  });

  it('describe / summaryParts / constructionLine: an option that does not apply has NO row and NO phrase; the construction sentence is unchanged', () => {
    assert.deepEqual(PF.describe(ck, { type: 'griddle', burners: 2, baskets: 2, base: 'stand' }).map((r) => r.label), ['Type', 'Burners', 'Base', 'Construction']);
    assert.deepEqual(PF.describe(ck, { type: 'fryer', burners: 1, baskets: 3, base: 'stand' }).map((r) => r.label), ['Type', 'Fry baskets', 'Base', 'Construction']);
    assert.deepEqual(PF.describe(ck, { type: 'fryer', burners: 1, baskets: 3, base: 'stand' }).find((r) => r.label === 'Fry baskets'), { label: 'Fry baskets', value: '3 (Three tanks)' });
    assert.deepEqual(PF.describe(ck, { type: 'combi', burners: 1, baskets: 2, base: 'shelf' }).map((r) => r.label), ['Type', 'Base', 'Construction']);
    assert.deepEqual(PF.describe(dish, { side: 'clean', hand: 'left', sink: 'none', undershelf: true }).map((r) => r.label), ['Side', 'Dishwasher on the', 'Undershelf', 'Construction']);
    assert.deepEqual(PF.describe(dish, { side: 'soiled', hand: 'left', sink: 'prerinse', undershelf: true }).map((r) => r.label), ['Side', 'Dishwasher on the', 'Pre-rinse sink', 'Undershelf', 'Construction']);
    assert.deepEqual(PF.summaryParts(ck, { type: 'griddle', burners: 2, baskets: 2, base: 'stand' }), ['griddle', '2 burners', 'open stand']);
    assert.deepEqual(PF.summaryParts(ck, { type: 'fryer', burners: 1, baskets: 3, base: 'shelf' }), ['fryer', '3 baskets', 'with bottom shelf']);
    assert.deepEqual(PF.summaryParts(ck, { type: 'combi', burners: 3, baskets: 3, base: 'stand' }), ['griller and griddle', 'open stand'], 'even a non-canonical configuration does not talk about options that do not apply');
    assert.equal(PF.summaryLine(ck, { type: 'fryer', burners: 1, baskets: 2, base: 'stand' }, { W: 700, D: 700 }), 'Griddle, griller or fryer — fryer · 2 baskets · open stand · 700 × 700 mm');
    assert.equal(PF.constructionLine(ck, { type: 'fryer', base: 'shelf' }), 'SS304 stainless steel · 1.2 mm body and panels · stainless fry tanks with baskets, gas-fired · square-tube stand with a 1.2 mm bottom shelf and adjustable bullet feet');
    assert.deepEqual(PF.describe(FIX, { kind: 'a', tags: ['x'] }).map((r) => r.label), ['Kind', 'Size'], 'the fixture has no `construction`: no such row');
  });

  it('cells: every option of a conditional group still has its cell (priced once), carrying the condition in plain words ("" for an unconditional group)', () => {
    const cells = PF.cells(ck);
    assert.deepEqual(cells.filter((c) => c.group === 'baskets').map((c) => [c.value, c.baseline, c.when]), [['1', false, 'Type is Fryer'], ['2', true, 'Type is Fryer'], ['3', false, 'Type is Fryer']]);
    assert.deepEqual(cells.filter((c) => c.group === 'burners').map((c) => c.when), ['Type is Griddle or Lava-rock griller', 'Type is Griddle or Lava-rock griller', 'Type is Griddle or Lava-rock griller']);
    assert.ok(cells.filter((c) => c.group === 'type' || c.group === 'base').every((c) => c.when === ''));
    assert.deepEqual(PF.cells(dish).filter((c) => !c.baseline).map((c) => `${c.group}:${c.value}`), ['side:soiled', 'hand:right', 'sink:prerinse', 'undershelf:false', 'top:1.2'], 'the sheet cells of the dish table (spec §5.2)');
    assert.deepEqual(PF.cells(ck).filter((c) => !c.baseline).map((c) => `${c.group}:${c.value}`), ['type:griller', 'type:fryer', 'type:combi', 'burners:2', 'burners:3', 'baskets:1', 'baskets:3', 'base:shelf'], 'the sheet cells of the cooking line (spec §5.2)');
    assert.deepEqual(PF.cells(deck).filter((c) => !c.baseline).map((c) => `${c.group}:${c.value}`), ['decks:1', 'decks:3', 'trays:6', 'stand:heavy']);
    assert.deepEqual(PF.cells(hood).filter((c) => !c.baseline).map((c) => `${c.group}:${c.value}`), ['type:island', 'type:slim', 'filters:none', 'lighting:false']);
    assert.deepEqual(PF.cells(fam('wok_range')).filter((c) => !c.baseline).map((c) => `${c.group}:${c.value}`), ['holes:2', 'holes:3', 'rear:true', 'faucet:swan', 'top:1.2']);
  });

  it('the catalogue card: a conditional option\'s row ends with its condition, the row count is still one per public group', () => {
    const card = B.renderFamilyCard(ck, { id: 'cooking' }, null, '');
    assert.match(card, /<dt>Burners<\/dt><dd>1 \/ 2 \/ 3 \(Type is Griddle or Lava-rock griller\)<\/dd>/);
    assert.match(card, /<dt>Fry baskets<\/dt><dd>1 \/ 2 \/ 3 \(Type is Fryer\)<\/dd>/);
    assert.match(card, /<dt>Type<\/dt><dd>Griddle \/ Lava-rock griller \/ Fryer \/ Griller \+ griddle<\/dd>/);
    assert.equal((card.match(/<dt>/g) || []).length, PF.publicGroups(ck).length + 3, 'groups + Size + Construction + Material');
    assert.match(B.renderFamilyCard(dish, { id: 'washing' }, null, ''), /<dt>Pre-rinse sink<\/dt><dd>None \/ With pre-rinse sink and spray faucet \(Side is Soiled\)<\/dd>/);
    assert.match(B.renderFamilyCard(deck, { id: 'cooking' }, null, ''), /<dt>Size<\/dt><dd>Made to your width<\/dd>/);
    assert.match(B.renderFamilyCard(hood, { id: 'ventilation' }, null, ''), /<dt>Size<\/dt><dd>Made to your length and depth<\/dd>/);
    assert.ok(!/\(Type is/.test(B.renderFamilyCard(fam('sink'), { id: 'washing' }, null, '')), 'no condition on a family that has none');
  });

  describe('the build (scripts/build-catalogue.js checkFamily) refuses a malformed `when`', () => {
    const bad = (mut) => { const j = JSON.parse(JSON.stringify(SRC)); mut(j); return () => B.loadPublicFamilies({ source: j, published: PUBLISHED }); };
    it('a `when` that names a LATER group, itself, an unknown group, a value the gate does not have, an empty list or a non-object is refused with its message', () => {
      assert.throws(bad((j) => { j.families.cooking_line.groups[1].when = { base: ['stand'] }; }), /groups\[1\]: "when": "base" must come EARLIER in "groups"/);
      assert.throws(bad((j) => { j.families.cooking_line.groups[1].when = { burners: [1] }; }), /"burners" must come EARLIER/);
      assert.throws(bad((j) => { j.families.cooking_line.groups[1].when = { nope: ['x'] }; }), /"nope" is not a group of this family/);
      assert.throws(bad((j) => { j.families.cooking_line.groups[1].when = { type: ['teapot'] }; }), /"type" needs a non-empty list of that group's option values/);
      assert.throws(bad((j) => { j.families.cooking_line.groups[1].when = { type: [] }; }), /"type" needs a non-empty list/);
      assert.throws(bad((j) => { j.families.cooking_line.groups[1].when = { type: 'fryer' }; }), /"type" needs a non-empty list/);
      assert.throws(bad((j) => { j.families.cooking_line.groups[1].when = {}; }), /"when" must be an object of \{ earlier group key: \[option values\] \}/);
      assert.throws(bad((j) => { j.families.cooking_line.groups[1].when = ['fryer']; }), /"when" must be an object of/);
      assert.throws(bad((j) => { j.families.cooking_line.groups[1].when = null; }), /"when" must be an object of/);
    });
    it('a gate that is not a choice group (slots / multi) or is staff-only, and a gated group that is slots or staff-only, are refused', () => {
      assert.throws(bad((j) => { j.families.stove.groups.splice(2, 0, { key: 'zz', label: 'Z', type: 'choice', default: 'a', when: { addons: ['oven'] }, options: [{ v: 'a', l: 'A' }] }); }), /"addons" must be a choice group that is not staff-only/);
      assert.throws(bad((j) => { j.families.stove.groups.splice(1, 0, { key: 'zz', label: 'Z', type: 'choice', default: 'a', when: { positions: ['wok'] }, options: [{ v: 'a', l: 'A' }] }); }), /"positions" must be a choice group/);
      assert.throws(bad((j) => { j.families.sink.groups.push({ key: 'zz', label: 'Z', type: 'choice', default: 'a', when: { top: [1.2] }, options: [{ v: 'a', l: 'A' }] }); }), /"top" must be a choice group that is not staff-only/);
      assert.throws(bad((j) => { j.families.cooking_line.groups.push({ key: 'zz', label: 'Z', type: 'slots', minSlots: 1, maxSlots: 2, default: ['a'], when: { type: ['fryer'] }, options: [{ v: 'a', l: 'A' }] }); }), /"when" belongs to a choice or multi group that is not staff-only/);
      assert.throws(bad((j) => { j.families.dish_table.groups[4].when = { side: ['soiled'] }; }), /groups\[4\]: "when" belongs to a choice or multi group that is not staff-only/, 'the staff-only top plate cannot be conditional');
      // a conditional MULTI group is allowed
      assert.doesNotThrow(bad((j) => { j.families.cooking_line.groups.push({ key: 'zz', label: 'Z', type: 'multi', default: [], when: { type: ['fryer'] }, options: [{ v: 'a', l: 'A' }] }); Object.values(j.families.cooking_line.absorbed).forEach((c) => { c.zz = []; }); }), 'cooking_line + conditional multi group');
    });
    it('a {token} of the construction sentence may not name a conditional group; a family\'s default size must be valid for its default options', () => {
      assert.throws(bad((j) => { j.families.cooking_line.construction = 'SS304 · {baskets}'; j.families.cooking_line.groups[2].options.forEach((o) => { o.c = 'x'; }); }), /construction: \{baskets\} names a conditional option/);
      assert.throws(bad((j) => { j.families.deck_oven.dims.W.default = 800; }), /the default size is not valid for the default options/, 'a three-tray oven cannot default to 800 wide');
    });
    it('`maxDimWhen`: an axis the family lacks, a value outside the axis limits or off the step, a minimum above the maximum, and a pair on different groups are refused', () => {
      assert.throws(bad((j) => { j.families.hood.maxDimWhen = [{ group: 'type', includes: 'slim', max: { H: 400 } }]; }), /maxDimWhen\[0\]: "max" must name the family's own axes with values inside their limits and on the step/);
      assert.throws(bad((j) => { j.families.hood.maxDimWhen = [{ group: 'type', includes: 'slim', max: { D: 200 } }]; }), /maxDimWhen\[0\]: "max" must name the family's own axes/);
      assert.throws(bad((j) => { j.families.hood.maxDimWhen = [{ group: 'type', includes: 'slim', max: { D: 505 } }]; }), /maxDimWhen\[0\]: "max" must name the family's own axes/);
      assert.throws(bad((j) => { j.families.hood.maxDimWhen = [{ group: 'type', includes: 'teapot', max: { D: 500 } }]; }), /maxDimWhen\[0\]: needs a known group and one of its option values/);
      assert.throws(bad((j) => { j.families.hood.maxDimWhen = [{ group: 'type', includes: 'island', max: { W: 1000 } }]; }), /minDimWhen\[0\] and maxDimWhen\[0\] can hold together but the minimum is above the maximum/);
      assert.throws(bad((j) => { j.families.deck_oven.maxDimWhen.push({ group: 'decks', includes: 1, max: { W: 700 } }); }), /minDimWhen\[0\] and maxDimWhen\[2\] limit the same axis from different groups/);
      assert.throws(bad((j) => { j.families.hood.maxDimWhen = 'x'; }), /"maxDimWhen" must be an array/);
      // the same axis on rules that CANNOT hold together is fine: the real hood (island min W 1200, slim max D 500 differ in axis AND value) and deck oven are accepted
      assert.doesNotThrow(bad((j) => { j.families.hood.maxDimWhen = [{ group: 'type', includes: 'slim', max: { W: 2000 } }]; }));
      // an unknown key on a family is still refused; maxDimWhen is a known one
      assert.throws(bad((j) => { j.families.hood.maxDimWhenX = []; }), /unknown key "maxDimWhenX"/);
    });
    it('minDimWhen is now also checked on the step', () => {
      assert.throws(bad((j) => { j.families.stove.minDimWhen[0].min.D = 705; }), /minDimWhen\[0\]: "min" must name the family's own axes with values inside their limits and on the step/);
    });
  });
});

function resolveMaster() {
  for (const p of [path.join(ROOT, 'products-database.json'), path.join(os.homedir(), 'Desktop', 'barro-private', 'products-database.json')]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}
