// tests/kc-list.test.mjs: every configurator prices from the Standard Price List (specs/BK-LIVE-INTEGRATION-ADDENDUM-1-2026-11-19.md A1, A4), on the committed engine bundle.
//
// The rule, for a configured line: map the cfg to its BASE MODEL (the same product family at the nearest standard length, on a tie the shorter), then
//     unit = list(code) + lengthAdj + optionsAdj, nearest 10 pesos
//     lengthAdj  = (length - stdLength) / 1000 x the per-metre rate of the code (0 when the code has none)
//     optionsAdj = formulaSell(cfg) - formulaSell(the standard model at the cfg's length)   [with a per-metre rate, so the length is not counted twice]
//                = formulaSell(cfg) - formulaSell(the standard model at its own length)     [without one: the formula carries the size difference]
// A product with no code (the multi-purpose station, ventilation, an island hood or a chimney, an L or U prep table) prices by formula.
//
// Everything is worked out by hand from the SYNTHETIC fixture (tests/fixtures/kc-prices.fixture.json: made-up numbers) and from the engine's own FORMULA prices, which the golden file
// pins separately (tests/kc-engine.test.mjs). The arithmetic of the rule itself (KCRules.nearestStd / lengthAdj / listAdj / sellUnit / formulaBelowList) is pinned in tests/kc-rules.test.mjs.
//
// WHAT IT PINS
//   1. KC.listRow          a list price is a number or a row { price, perMetre, status, label, std }; a price that is not above 0 is no list price.
//   2. THE STANDARD MODELS every product that sells from the list says which models it has (KC.stdModels / KC.listModels): the base configuration of a code is a valid configuration of that
//                          product that maps back to the same code and sells at exactly the list price; the specs of a few of them are pinned field by field.
//   3. THE MAPPING         the nearest standard length, a tie to the shorter, per product and per family: prep tables, sinks (by type and by number of bowls), hoods, racks, cabinets,
//                          trolleys (by what they carry), dish racks (by what they hold), the caddy.
//   4. THE PRICE           worked out by hand for each product: a per-metre code (length difference at the rate, options by formula, the length not counted twice), a code with no
//                          per-metre rate (the formula carries the size), options that take money off, the formula only where there is no code, no list loaded, a material missing.
//   5. "STARTS AT"         the list price of the smallest (cheapest) standard model the loaded list prices.
//   6. REVIEW AND WARNING  a blower is a COST like any other material and puts no line in review (Addendum 2 B1, which replaced A4); ventilation (ducting) always needs review; the 90 % formula warning shows only in
//                          the 'formula' floor mode (President only, staff note).
//
// Mutation-tested in scratch copies of the sources, re-bundled each time (never the shared tree). Each of these must fail here (tests/kc-rules.test.mjs holds the rule-level ones):
// the base model taken at the standard length when a per-metre rate applies (the length counted twice), or at the cfg's length when it does not; a tie taken to the longer length;
// the per-metre rate ignored; the list price used for a cfg with no code; a hood mapped for an island; a sink family by type only; a trolley told by its name; the "starts at" taking the
// dearest; the ducting reason dropped; the old blower reason put back (it must not reappear); the 90 % warning shown in list mode.
// Run with: node --test tests/*.test.mjs
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, loadPricedEngine, loadFixture } from './helpers/kc-vm.mjs';

const FX = loadFixture();
const plain = x => JSON.parse(JSON.stringify(x));
const round10 = x => Math.round(x / 10) * 10;
const close = (got, want, msg) => assert.ok(Math.abs(got - want) < 1e-6, `${msg || 'figure'}: got ${got}, want ${want}`);
const rowOf = code => { const v = FX.listPrices[code]; return typeof v === 'object' ? { price: v.price, perMetre: v.perMetre } : { price: v, perMetre: null }; };

const BLOWER = 'Blower price to be confirmed by Neil.';       // Addendum 2 B1 removed this reason: no line carries it any more
const DUCTING = 'Ducting is priced per job; check before sending.';

let priced, bare;
before(() => { priced = loadPricedEngine(); bare = loadEngine(); });

const model = (KC, id, code) => KC.stdModels(id).find(m => m.code === code);
const std = (KC, id, code) => model(KC, id, code).cfg();                        // the base configuration of a code: a fresh copy
const formula = (KC, id, c) => KC.price(id, c, { noList: true }).selling;      // the formula selling price of a cfg (the golden file pins it)
const codeOf = (KC, id, c) => { const m = KC.baseModel(id, c); return m && m.code; };

describe('KC.listRow: a list price is a number or a row', () => {
  it('a plain number is a price with no per-metre rate', () => {
    const KC = priced.KC; KC.LISTP.ZZ = 1500;
    assert.deepEqual(plain(KC.listRow('ZZ')), { price: 1500, perMetre: null, status: '', label: '', std: '' });
  });
  it('a row carries the per-metre rate, the status, the label and the standard spec', () => {
    const KC = priced.KC; KC.LISTP.ZZ = { price: 1500, perMetre: 120, status: 'Data', label: 'A table', std: '900 x 600' };
    assert.deepEqual(plain(KC.listRow('ZZ')), { price: 1500, perMetre: 120, status: 'Data', label: 'A table', std: '900 x 600' });
  });
  it('a rate that is not above 0 is no rate; a price that is not above 0 is no list price at all', () => {
    const KC = priced.KC;
    [0, -5, null, undefined, 'x', NaN].forEach(bad => { KC.LISTP.ZZ = { price: 1500, perMetre: bad }; assert.equal(KC.listRow('ZZ').perMetre, null, String(bad)); });
    [0, -5, null, undefined, '1500', NaN].forEach(bad => { KC.LISTP.ZZ = bad; assert.equal(KC.listRow('ZZ'), null, String(bad)); KC.LISTP.ZZ = { price: bad }; assert.equal(KC.listRow('ZZ'), null, String(bad)); });
    assert.equal(KC.listRow('NOT-A-CODE'), null);
  });
  it('an unloaded list is no list', () => {
    assert.equal(bare.KC.listRow('PS-PT-1200'), null);
    const e = loadPricedEngine(); e.KC.LISTP = undefined;
    assert.equal(e.KC.listRow('PS-PT-1200'), null);
  });
  it('KC.cmToMm turns a size in cm into mm, kept clear of float noise', () => {
    const KC = priced.KC;
    assert.equal(KC.cmToMm(120), 1200); assert.equal(KC.cmToMm(91.3), 913); assert.equal(KC.cmToMm(0), 0); assert.equal(KC.cmToMm('45'), 450);
    // two-decimal cm sizes, where the plain x10 leaves float noise (30.06 * 10 = 300.59999999999997, 0.07 * 10 = 0.7000000000000001): the answer is the clean mm
    assert.equal(KC.cmToMm(30.06), 300.6); assert.equal(KC.cmToMm(30.08), 300.8); assert.equal(KC.cmToMm(0.07), 0.7);
  });
});

describe('the standard models: the base configuration of every code', () => {
  it('the products that sell from the list, and the models each has', () => {
    const KC = priced.KC, by = {};
    KC.listModels().forEach(m => (by[m.productId] = by[m.productId] || []).push(m.code));
    assert.deepEqual(plain(by.prep), ['PS-PT-900', 'PS-PT-1200', 'PS-PT-1500', 'PS-PT-1800']);
    assert.deepEqual(plain(by.rack), ['PS-RK-900', 'PS-RK-1200', 'PS-RKW-1200', 'PS-RK-1500']);
    assert.deepEqual(plain(by.cabinet), ['PS-CB-900', 'PS-CBW-900', 'PS-CB-1200', 'PS-CBW-1200', 'PS-CB-1500']);
    assert.deepEqual(plain(by.sink), ['WS-HS-400', 'WS-MS-600', 'WS-SK1-600', 'WS-BS-1200', 'WS-SK1-1200', 'WS-SK2-1200', 'WS-SK2-1800', 'WS-SK3-2300']);
    assert.deepEqual(plain(by.hood), ['VN-HD-1200', 'VN-HD-1800', 'VN-HD-2400', 'VN-HD-3000']);
    assert.deepEqual(plain(by.trolley), ['PS-TR-UT', 'PS-TR-LG', 'PS-TR-FS', 'PS-TR-DC', 'PS-TR-TR']);
    assert.deepEqual(plain(by.dishrack), ['PS-DR-PL', 'PS-DR-SC', 'PS-DR-CP', 'PS-DR-BW']);
    assert.deepEqual(plain(by.caddy), ['PS-CD-4']);
    assert.equal(by.station, undefined, 'the multi-purpose kitchen station has no code');
    assert.equal(by.vent, undefined, 'ventilation (blowers, ducting, fresh air) has no code');
    assert.equal(Object.keys(by).filter(id => id.startsWith('chef_')).length, 13);
  });
  it('64 models, 62 codes: the stove with an oven is one code for the high and the low pressure stove', () => {
    const all = priced.KC.listModels(), codes = new Set(all.map(m => m.code));
    assert.equal(all.length, 64);
    assert.equal(codes.size, 62);
    assert.deepEqual(plain([...codes]).sort(), Object.keys(FX.listPrices).sort(), 'the fixture prices exactly the codes the engine maps');
  });
  it('the models of a product come in order of size, and say what they are', () => {
    const KC = priced.KC;
    for (const def of KC.productList()) {
      const ms = KC.stdModels(def.id), lens = ms.map(m => m.stdLen).filter(n => n != null);
      assert.deepEqual(plain(lens), [...lens].sort((a, b) => a - b), def.id);
      ms.forEach(m => { assert.ok(m.label && m.label.length > 3, `${def.id} ${m.code}: a label`); assert.equal(typeof m.cfg, 'function'); });
    }
  });
  it('every base configuration maps back to its own code and length, is valid, and sells at exactly the list price', () => {
    const KC = priced.KC;
    for (const m of KC.listModels()) {
      const tag = `${m.productId} / ${m.code}`, bm = KC.baseModel(m.productId, m.baseCfg);
      assert.ok(bm, `${tag}: maps to a code`);
      assert.equal(bm.code, m.code, tag);
      assert.equal(bm.stdLen, m.stdLen, tag);
      assert.deepEqual(plain(KC.products[m.productId].validate(m.baseCfg).errors), [], `${tag}: a valid configuration`);
      const r = KC.price(m.productId, m.baseCfg);
      assert.equal(r.unit, rowOf(m.code).price, `${tag}: sells at the list price`);
      assert.equal(r.list.code, m.code, tag);
      assert.equal(r.list.lengthAdj, 0, `${tag}: no length difference`);
      close(r.list.optionsAdj, 0, `${tag}: no options`);
    }
  });
  it('each call gives a fresh copy: changing one base configuration changes no other', () => {
    const KC = priced.KC, a = std(KC, 'prep', 'PS-PT-1200'), b = std(KC, 'prep', 'PS-PT-1200');
    a.sides[0].len = 999; a.top.thk = 1.2;
    assert.equal(b.sides[0].len, 120); assert.equal(b.top.thk, 1.5);
    assert.equal(std(KC, 'prep', 'PS-PT-1200').sides[0].len, 120);
  });
  it('the prep table standard: a 1.5 mm top, one solid undershelf, 60 x 85 cm, nothing else', () => {
    const c = std(priced.KC, 'prep', 'PS-PT-1200');
    assert.equal(c.shape, 'straight'); assert.equal(c.sides.length, 1); assert.equal(c.sides[0].len, 120);
    assert.equal(c.sides[0].bays.length, 0); assert.equal(c.sides[0].uppers.length, 0);
    assert.equal(c.top.thk, 1.5); assert.equal(c.depth, 60); assert.equal(c.height, 85); assert.equal(c.feet, 'bullet');
    assert.deepEqual(plain(c.shelves), { n: 1, type: 'solid' });
  });
  it('the rack and cabinet standards: the product\'s own defaults at the width, a cabinet with one door per 60 cm', () => {
    const KC = priced.KC;
    const rk = std(KC, 'rack', 'PS-RK-1500'); assert.equal(rk.mount, 'floor'); assert.equal(rk.W, 150); assert.equal(rk.D, 50); assert.equal(rk.H, 180); assert.equal(rk.layers, 4); assert.equal(rk.stype, 'solid');
    const rw = std(KC, 'rack', 'PS-RKW-1200'); assert.equal(rw.mount, 'wall'); assert.equal(rw.W, 120); assert.equal(rw.D, 30); assert.equal(rw.layers, 2);
    assert.deepEqual([900, 1200, 1500].map(w => std(KC, 'cabinet', 'PS-CB-' + w).doors), [2, 2, 3]);
    const cw = std(KC, 'cabinet', 'PS-CBW-900'); assert.equal(cw.mount, 'wall'); assert.equal(cw.W, 90); assert.equal(cw.D, 35); assert.equal(cw.H, 60); assert.equal(cw.doors, 2);
    const cf = std(KC, 'cabinet', 'PS-CB-900'); assert.equal(cf.D, 60); assert.equal(cf.H, 85); assert.equal(cf.ishelves, 1);
  });
  it('the sink standards: the type\'s own defaults at the listed size', () => {
    const KC = priced.KC;
    const hs = std(KC, 'sink', 'WS-HS-400'); assert.equal(hs.type, 'hand'); assert.equal(hs.len, 40); assert.equal(hs.faucet.kind, 'faucet');
    const ms = std(KC, 'sink', 'WS-MS-600'); assert.equal(ms.type, 'mop'); assert.equal(ms.len, 60); assert.equal(ms.depth, 45);
    const bs = std(KC, 'sink', 'WS-BS-1200'); assert.equal(bs.type, 'bar'); assert.equal(bs.len, 120);
    const s1 = std(KC, 'sink', 'WS-SK1-1200'); assert.equal(s1.bowls.length, 1); assert.equal(s1.len, 120); assert.equal(s1.depth, 60);
    const s2 = std(KC, 'sink', 'WS-SK2-1800'); assert.equal(s2.bowls.length, 2); assert.equal(s2.len, 180); assert.equal(s2.depth, 65);
    const s3 = std(KC, 'sink', 'WS-SK3-2300'); assert.equal(s3.bowls.length, 3); assert.equal(s3.len, 230); assert.equal(s3.depth, 70);
  });
  it('the hood standard: the rear-pitch wall canopy, exhaust only, filters, round lamps, no blower, 90 x 50 cm', () => {
    const KC = priced.KC, c = std(KC, 'hood', 'VN-HD-2400'), z = KC.hoodSize(c);
    assert.equal(c.type, 'wall'); assert.equal(c.shape, 'rear'); assert.equal(c.air, 'exhaust'); assert.equal(c.filters, true); assert.equal(c.blower, false); assert.equal(c.ducting, false);
    assert.equal(z.len, 240); assert.equal(z.depth, 90); assert.equal(z.bodyH, 50);
  });
  it('lengthOf and withLength: the length of a configuration in mm, and the same configuration at another length', () => {
    const KC = priced.KC;
    [['prep', 'PS-PT-1200', 1350], ['sink', 'WS-SK2-1800', 2000], ['sink', 'WS-MS-600', 750], ['hood', 'VN-HD-1200', 1500], ['rack', 'PS-RK-900', 1000], ['cabinet', 'PS-CB-1500', 1650], ['cabinet', 'PS-CBW-900', 1000]].forEach(([id, code, mm]) => {
      const def = KC.products[id], c = std(KC, id, code), want = model(KC, id, code).stdLen;
      assert.equal(def.lengthOf(c), want, `${id} / ${code}: the standard length`);
      assert.equal(def.withLength(c, mm), c, `${id} / ${code}: it changes the cfg it is given and returns it`);
      assert.equal(def.lengthOf(c), mm, `${id} / ${code}: the new length`);
    });
    const cab = std(KC, 'cabinet', 'PS-CB-1500'); KC.products.cabinet.withLength(cab, 1650);
    assert.equal(cab.doors, 3, 'a cabinet takes one door per 60 cm: 165 cm, 3 doors');
    KC.products.cabinet.withLength(cab, 1000); assert.equal(cab.doors, 2);
    const mop = std(KC, 'sink', 'WS-MS-600'); KC.products.sink.withLength(mop, 750); assert.equal(mop.bowls[0].w, 75, 'the basin of a mop sink follows its length');
  });
});

describe('the mapping: the nearest standard length, a tie to the shorter', () => {
  it('prep table: PS-PT-900 / 1200 / 1500 / 1800', () => {
    const KC = priced.KC;
    [[40, 900], [85, 900], [105, 900], [106, 1200], [120, 1200], [135, 1200], [136, 1500], [165, 1500], [166, 1800], [250, 1800]].forEach(([cm, mm]) => {
      const c = std(KC, 'prep', 'PS-PT-1200'); c.sides[0].len = cm;
      assert.equal(codeOf(KC, 'prep', c), 'PS-PT-' + mm, cm + ' cm');
      assert.equal(KC.baseModel('prep', c).stdLen, mm, cm + ' cm');
    });
  });
  it('prep table: only a straight table of one side is a prep table of the list', () => {
    const KC = priced.KC, c = std(KC, 'prep', 'PS-PT-1200');
    c.shape = 'L'; assert.equal(codeOf(KC, 'prep', c), null);
    const m = std(KC, 'prep', 'PS-PT-1200'); m.sides[0].bays = [{ t: 'cabinet', w: 60, doors: 0 }]; assert.equal(codeOf(KC, 'prep', m), null, 'a cabinet bay makes it a station');
    const two = std(KC, 'prep', 'PS-PT-1200'); two.sides.push(JSON.parse(JSON.stringify(two.sides[0]))); assert.equal(codeOf(KC, 'prep', two), null);
    ['stall', 'line', 'condo', 'family', 'blank'].forEach(st => assert.equal(codeOf(KC, 'station', KC.products.station.startCfg(st)), null, 'station ' + st));
  });
  it('sink: the type decides hand, mop and bar; the bowls decide single, double and triple', () => {
    const KC = priced.KC, withLen = (code, cm, f) => { const c = std(KC, 'sink', code); c.len = cm; if (f) f(c); return c; };
    [[20, 'WS-SK1-600'], [70, 'WS-SK1-600'], [90, 'WS-SK1-600'], [91, 'WS-SK1-1200'], [200, 'WS-SK1-1200']].forEach(([cm, code]) => assert.equal(codeOf(KC, 'sink', withLen('WS-SK1-600', cm)), code, 'single ' + cm));
    [[100, 'WS-SK2-1200'], [150, 'WS-SK2-1200'], [151, 'WS-SK2-1800'], [250, 'WS-SK2-1800']].forEach(([cm, code]) => assert.equal(codeOf(KC, 'sink', withLen('WS-SK2-1200', cm)), code, 'double ' + cm));
    [100, 230, 400].forEach(cm => assert.equal(codeOf(KC, 'sink', withLen('WS-SK3-2300', cm)), 'WS-SK3-2300', 'triple ' + cm));
    [30, 100].forEach(cm => { assert.equal(codeOf(KC, 'sink', withLen('WS-HS-400', cm)), 'WS-HS-400'); assert.equal(codeOf(KC, 'sink', withLen('WS-BS-1200', cm)), 'WS-BS-1200'); assert.equal(codeOf(KC, 'sink', withLen('WS-MS-600', cm)), 'WS-MS-600'); });
    assert.equal(codeOf(KC, 'sink', withLen('WS-SK2-1200', 120, c => { c.bowls.length = 1; })), 'WS-SK1-1200', 'a double sink with one bowl is a single sink');
    assert.equal(codeOf(KC, 'sink', withLen('WS-SK2-1200', 120, c => { c.bowls.push(Object.assign({}, c.bowls[0])); })), 'WS-SK3-2300', 'three bowls: a triple sink');
    for (const st of ['dish2', 'hand', 'pot', 'blank']) assert.ok(codeOf(KC, 'sink', KC.products.sink.startCfg(st)), st);
  });
  it('wall range hood: VN-HD-1200 / 1800 / 2400 / 3000 by the hood length; an island or a chimney has no code', () => {
    const KC = priced.KC;
    [[30, 1200], [120, 1200], [150, 1200], [151, 1800], [180, 1800], [210, 1800], [211, 2400], [270, 2400], [271, 3000], [600, 3000]].forEach(([cm, mm]) => {
      const c = std(KC, 'hood', 'VN-HD-1200'); c.lenOvr = cm;
      assert.equal(codeOf(KC, 'hood', c), 'VN-HD-' + mm, cm + ' cm');
    });
    const auto = KC.products.hood.startCfg('wall');
    assert.equal(KC.hoodSize(auto).len, 200); assert.equal(codeOf(KC, 'hood', auto), 'VN-HD-1800', 'the default 2 m hood');
    assert.equal(codeOf(KC, 'hood', KC.products.hood.startCfg('island')), null);
    assert.equal(codeOf(KC, 'hood', KC.products.hood.startCfg('chimney')), null);
    const box = std(KC, 'hood', 'VN-HD-1200'); box.shape = 'box'; assert.equal(codeOf(KC, 'hood', box), 'VN-HD-1200', 'another shape is an option of the same code');
  });
  it('rack and cabinet: floor and wall are separate families, each at its own standard widths', () => {
    const KC = priced.KC, at = (id, code, cm) => { const c = std(KC, id, code); c.W = cm; return c; };
    [[90, 900], [100, 900], [105, 900], [106, 1200], [135, 1200], [136, 1500], [300, 1500]].forEach(([cm, mm]) => {
      assert.equal(codeOf(KC, 'rack', at('rack', 'PS-RK-1200', cm)), 'PS-RK-' + mm, 'rack ' + cm);
      assert.equal(codeOf(KC, 'cabinet', at('cabinet', 'PS-CB-1200', cm)), 'PS-CB-' + mm, 'cabinet ' + cm);
    });
    [40, 120, 300].forEach(cm => assert.equal(codeOf(KC, 'rack', at('rack', 'PS-RKW-1200', cm)), 'PS-RKW-1200', 'wall rack ' + cm));
    [[60, 900], [105, 900], [106, 1200], [200, 1200]].forEach(([cm, mm]) => assert.equal(codeOf(KC, 'cabinet', at('cabinet', 'PS-CBW-900', cm)), 'PS-CBW-' + mm, 'wall cabinet ' + cm));
  });
  it('trolley: told by what it carries, not by its name', () => {
    const KC = priced.KC, t = set => Object.assign(KC.products.trolley.startCfg('utility'), set);
    const code = c => codeOf(KC, 'trolley', c);
    assert.equal(code(t({})), 'PS-TR-UT');
    assert.equal(code(t({ layers: 1 })), 'PS-TR-UT');
    assert.equal(code(t({ stopper: true })), 'PS-TR-UT');
    assert.equal(code(t({ layers: 3 })), 'PS-TR-FS');
    assert.equal(code(t({ layers: 4 })), 'PS-TR-FS');
    assert.equal(code(t({ layers: 3, stype: 'slotted' })), 'PS-TR-DC');
    assert.equal(code(t({ hangBar: true })), 'PS-TR-LG');
    assert.equal(code(t({ hangBar: true, layers: 3 })), 'PS-TR-LG');
    assert.equal(code(t({ slides: 15, layers: 0 })), 'PS-TR-TR');
    assert.equal(code(t({ slides: 15, hangBar: true })), 'PS-TR-TR');
    assert.equal(code(t({ purpose: 'Hotel Lobby' })), 'PS-TR-UT', 'a typed purpose does not decide');
    assert.equal(code(t({ purpose: 'Luggage' })), 'PS-TR-UT', 'not even the name of another preset');
    ['utility', 'luggage', 'food', 'dish', 'tray'].forEach((p, i) => assert.equal(code(KC.products.trolley.startCfg(p)), ['PS-TR-UT', 'PS-TR-LG', 'PS-TR-FS', 'PS-TR-DC', 'PS-TR-TR'][i], p));
  });
  it('dish rack by what it holds, and the caddy at any number of compartments', () => {
    const KC = priced.KC, d = type => Object.assign(KC.products.dishrack.startCfg('std'), { type });
    [['plates', 'PS-DR-PL'], ['saucers', 'PS-DR-SC'], ['cups', 'PS-DR-CP'], ['bowls', 'PS-DR-BW'], ['unknown', 'PS-DR-PL']].forEach(([t, code]) => assert.equal(codeOf(KC, 'dishrack', d(t)), code, t));
    [2, 4, 8].forEach(n => assert.equal(codeOf(KC, 'caddy', Object.assign(KC.products.caddy.startCfg('std'), { comps: n })), 'PS-CD-4', n + ' compartments'));
  });
  it('no code, no mapping: ventilation, an unknown product, and a product with no base model', () => {
    const KC = priced.KC;
    for (const st of KC.products.vent.starts) assert.equal(codeOf(KC, 'vent', KC.products.vent.startCfg(st.id)), null, 'vent ' + st.id);
    assert.equal(KC.baseModel('nonesuch', {}), null);
    assert.deepEqual(plain(KC.stdModels('nonesuch')), []);
    assert.equal(KC.baseModel('prep', {}), null, 'a broken cfg is no code, not an error');
    assert.equal(KC.baseModel('sink', null), null);
  });
});

describe('the price: list + the length rate + the options, nearest 10', () => {
  /* the rule worked out here from the fixture row: the standard model's cfg is `base` (at the cfg's length for a per-metre code, at its own length for the others) */
  const expected = (KC, id, c, code, stdLen, base) => {
    const r = rowOf(code), len = KC.products[id].lengthOf ? KC.products[id].lengthOf(c) : null;
    const lengthAdj = r.perMetre != null && stdLen != null && len != null ? (len - stdLen) / 1000 * r.perMetre : 0;
    return { lengthAdj, options: formula(KC, id, c) - formula(KC, id, base), unit: round10(r.price + lengthAdj + (formula(KC, id, c) - formula(KC, id, base))) };
  };
  const check = (KC, id, c, code, stdLen, base, tag) => {
    const r = KC.price(id, c), e = expected(KC, id, c, code, stdLen, base);
    assert.equal(r.list.code, code, tag + ': the code');
    assert.equal(r.list.stdLen, stdLen, tag + ': the standard length');
    close(r.list.lengthAdj, e.lengthAdj, tag + ': the length rate');
    close(r.list.optionsAdj, e.options, tag + ': what the options add');
    assert.equal(r.unit, e.unit, tag + ': the unit');
    close(r.list.base, rowOf(code).price, tag + ': the list price');
    return r;
  };

  it('prep table at 1400 mm with the standard options: PS-PT-1500 less 0.1 m at its rate, the length not counted twice', () => {
    const KC = priced.KC, c = std(KC, 'prep', 'PS-PT-1500'); c.sides[0].len = 140;
    const base = std(KC, 'prep', 'PS-PT-1500'); base.sides[0].len = 140;                      // the standard model AT the cfg's length
    const r = check(KC, 'prep', c, 'PS-PT-1500', 1500, base, 'prep 1400');
    close(r.list.lengthAdj, -0.1 * rowOf('PS-PT-1500').perMetre, 'a tenth of a metre shorter');
    close(r.list.optionsAdj, 0, 'no options: the formula price of the length is not added on top');
    assert.equal(r.unit, round10(rowOf('PS-PT-1500').price - 0.1 * rowOf('PS-PT-1500').perMetre));
    // reading the base at the standard length instead would count the length twice: that is NOT the price
    const twice = round10(rowOf('PS-PT-1500').price + r.list.lengthAdj + (formula(KC, 'prep', c) - formula(KC, 'prep', std(KC, 'prep', 'PS-PT-1500'))));
    assert.notEqual(r.unit, twice);
  });
  it('prep table at 1350 mm (a tie): the shorter, PS-PT-1200, plus 0.15 m at its rate', () => {
    const KC = priced.KC, c = std(KC, 'prep', 'PS-PT-1200'); c.sides[0].len = 135;
    const r = check(KC, 'prep', c, 'PS-PT-1200', 1200, c, 'prep 1350');
    close(r.list.lengthAdj, 0.15 * rowOf('PS-PT-1200').perMetre, 'the rate of the shorter model');
  });
  it('prep table at the standard length is exactly the list price', () => {
    const KC = priced.KC;
    [900, 1200, 1500, 1800].forEach(mm => assert.equal(KC.price('prep', std(KC, 'prep', 'PS-PT-' + mm)).unit, rowOf('PS-PT-' + mm).price, String(mm)));
  });
  it('options that take money off (no undershelf: less material, whatever the prices) and options that add (a backsplash: more sheet), by the formula difference', () => {
    const KC = priced.KC, base = std(KC, 'prep', 'PS-PT-1200');
    const noShelf = std(KC, 'prep', 'PS-PT-1200'); noShelf.shelves = { n: 0, type: 'solid' };
    const splash = std(KC, 'prep', 'PS-PT-1200'); splash.top.splash = '150';
    const rn = check(KC, 'prep', noShelf, 'PS-PT-1200', 1200, base, 'no undershelf');
    assert.ok(rn.list.optionsAdj < 0 && rn.unit < rowOf('PS-PT-1200').price, 'the undershelf taken away: ' + rn.list.optionsAdj);
    const rs = check(KC, 'prep', splash, 'PS-PT-1200', 1200, base, 'backsplash');
    assert.ok(rs.list.optionsAdj > 0 && rs.unit > rowOf('PS-PT-1200').price, 'a backsplash: ' + rs.list.optionsAdj);
    // other options (a thinner top, casters) move the unit by exactly their formula difference, whichever way the prices fall
    const thin = std(KC, 'prep', 'PS-PT-1200'); thin.top.thk = 1.2;
    const casters = std(KC, 'prep', 'PS-PT-1200'); casters.feet = 'caster';
    [thin, casters].forEach((c, i) => { const r = check(KC, 'prep', c, 'PS-PT-1200', 1200, base, 'option ' + i); assert.notEqual(r.list.optionsAdj, 0); });
  });
  it('the default prep start (122 cm, a 1.2 mm top, an upper shelf) is PS-PT-1200 + 20 mm + its options by formula', () => {
    const KC = priced.KC, c = KC.products.prep.startCfg('basic'), base = std(KC, 'prep', 'PS-PT-1200'); base.sides[0].len = 122;
    const r = check(KC, 'prep', c, 'PS-PT-1200', 1200, base, 'basic');
    close(r.list.lengthAdj, 0.02 * rowOf('PS-PT-1200').perMetre, '20 mm at the rate');
  });
  it('sink with a per-metre code: the double sink with drainboard at 2000 mm is WS-SK2-1800 + 0.2 m', () => {
    const KC = priced.KC, c = std(KC, 'sink', 'WS-SK2-1800'); c.len = 200;
    const r = check(KC, 'sink', c, 'WS-SK2-1800', 1800, c, 'double 2000');
    close(r.list.lengthAdj, 0.2 * rowOf('WS-SK2-1800').perMetre, 'the rate');
    close(r.list.optionsAdj, 0, 'no options');
  });
  it('sink with a code that has no per-metre rate: the formula carries the size (a 1500 mm double sink is WS-SK2-1200 and the formula price of 300 mm more)', () => {
    const KC = priced.KC, c = std(KC, 'sink', 'WS-SK2-1200'); c.len = 150;
    assert.equal(rowOf('WS-SK2-1200').perMetre, null, 'the fixture mirrors the list: this code has no per-metre rate');
    const base = std(KC, 'sink', 'WS-SK2-1200');                                                 // the standard model at its OWN length, 1200
    const r = check(KC, 'sink', c, 'WS-SK2-1200', 1200, base, 'double 1500');
    assert.equal(r.list.lengthAdj, 0); assert.equal(r.list.perMetre, null);
    assert.ok(r.list.optionsAdj > 0, 'the longer top costs by formula: ' + r.list.optionsAdj);
  });
  it('hand sink at 500 mm: WS-HS-400, no rate, the size by formula; with the foot pedal and soap of the Hand Wash Station on top', () => {
    const KC = priced.KC, c = std(KC, 'sink', 'WS-HS-400'); c.len = 50;
    check(KC, 'sink', c, 'WS-HS-400', 400, std(KC, 'sink', 'WS-HS-400'), 'hand 500');
    const station = KC.products.sink.startCfg('hand');
    const r = check(KC, 'sink', station, 'WS-HS-400', 400, std(KC, 'sink', 'WS-HS-400'), 'hand station');
    assert.ok(r.list.optionsAdj > 0, 'the pedal faucet and the soap dispenser cost more than the gooseneck faucet');
  });
  it('hood: the default 2 m wall canopy is VN-HD-1800 + 0.2 m; fresh air and the blower tick are options by formula', () => {
    const KC = priced.KC, c = KC.products.hood.startCfg('wall'), base = std(KC, 'hood', 'VN-HD-1800'); base.lenOvr = 200;
    const r = check(KC, 'hood', c, 'VN-HD-1800', 1800, base, 'hood 2 m');
    close(r.list.lengthAdj, 0.2 * rowOf('VN-HD-1800').perMetre, 'the rate'); close(r.list.optionsAdj, 0, 'the default hood is the standard one');
    const fresh = KC.products.hood.startCfg('wall'); fresh.air = 'fresh'; fresh.blower = true;
    const rf = check(KC, 'hood', fresh, 'VN-HD-1800', 1800, base, 'hood fresh air');
    assert.ok(rf.list.optionsAdj > 0);
    const tie = std(KC, 'hood', 'VN-HD-1800'); tie.lenOvr = 210;
    assert.equal(KC.price('hood', tie).list.code, 'VN-HD-1800', 'a tie goes to the shorter hood');
  });
  it('hood: an island canopy and a residential chimney have no code, so they price by formula', () => {
    const KC = priced.KC;
    for (const st of ['island', 'chimney']) {
      const r = KC.price('hood', KC.products.hood.startCfg(st));
      assert.equal(r.list, undefined, st);
      assert.equal(r.unit, round10(r.selling), st);
    }
  });
  it('rack and cabinet: a width off the standard is the nearest code plus the rate; a cabinet keeps one door per 60 cm in the standard model', () => {
    const KC = priced.KC;
    const rk = std(KC, 'rack', 'PS-RK-900'); rk.W = 100; const rkBase = std(KC, 'rack', 'PS-RK-900'); rkBase.W = 100;
    close(check(KC, 'rack', rk, 'PS-RK-900', 900, rkBase, 'rack 1000').list.lengthAdj, 0.1 * rowOf('PS-RK-900').perMetre, 'rack');
    const rw = std(KC, 'rack', 'PS-RKW-1200'); rw.W = 150; const rwBase = std(KC, 'rack', 'PS-RKW-1200'); rwBase.W = 150;
    close(check(KC, 'rack', rw, 'PS-RKW-1200', 1200, rwBase, 'wall rack 1500').list.lengthAdj, 0.3 * rowOf('PS-RKW-1200').perMetre, 'wall rack');
    const cab = std(KC, 'cabinet', 'PS-CB-1200'); cab.W = 135; cab.doors = 3;                    // 135 cm: a tie, the shorter code; 3 doors is one per 60 cm
    const cabBase = std(KC, 'cabinet', 'PS-CB-1200'); KC.products.cabinet.withLength(cabBase, 1350);
    assert.equal(cabBase.doors, 3);
    const rc = check(KC, 'cabinet', cab, 'PS-CB-1200', 1200, cabBase, 'cabinet 1350');
    close(rc.list.lengthAdj, 0.15 * rowOf('PS-CB-1200').perMetre, 'cabinet'); close(rc.list.optionsAdj, 0, 'the door that comes with the width is not an option');
    const two = std(KC, 'cabinet', 'PS-CB-1200'); two.W = 135; two.doors = 2;                       // fewer doors than the standard: an option that takes money off
    assert.ok(check(KC, 'cabinet', two, 'PS-CB-1200', 1200, cabBase, 'cabinet 2 doors').list.optionsAdj < 0);
    const wc = std(KC, 'cabinet', 'PS-CBW-900'); wc.W = 105;
    check(KC, 'cabinet', wc, 'PS-CBW-900', 900, (() => { const b = std(KC, 'cabinet', 'PS-CBW-900'); KC.products.cabinet.withLength(b, 1050); return b; })(), 'wall cabinet 1050');
  });
  it('trolley, dish rack and caddy: no length, so every difference is the formula\'s', () => {
    const KC = priced.KC;
    const t = std(KC, 'trolley', 'PS-TR-UT'); t.bumpers = true;
    const rt = check(KC, 'trolley', t, 'PS-TR-UT', null, std(KC, 'trolley', 'PS-TR-UT'), 'trolley bumpers');
    assert.ok(rt.list.optionsAdj > 0); assert.equal(rt.list.perMetre, null);
    const big = std(KC, 'trolley', 'PS-TR-FS'); big.W = 120; big.D = 60;
    check(KC, 'trolley', big, 'PS-TR-FS', null, std(KC, 'trolley', 'PS-TR-FS'), 'trolley 120 x 60');
    const d = std(KC, 'dishrack', 'PS-DR-CP'); d.tiers = 3;
    assert.ok(check(KC, 'dishrack', d, 'PS-DR-CP', null, std(KC, 'dishrack', 'PS-DR-CP'), 'dish rack 3 tiers').list.optionsAdj > 0);
    const c6 = std(KC, 'caddy', 'PS-CD-4'); c6.comps = 6;
    assert.ok(check(KC, 'caddy', c6, 'PS-CD-4', null, std(KC, 'caddy', 'PS-CD-4'), 'caddy 6').list.optionsAdj > 0);
  });
  it('a product with no code prices by formula, whatever the list says: the station, ventilation, a chimney', () => {
    const KC = priced.KC;
    for (const [id, sts] of [['station', ['stall', 'line', 'condo', 'family', 'blank']], ['vent', ['blank', 'ex1', 'ex2', 'ex3', 'ex4', 'ex5']]]) {
      for (const st of sts) { const r = KC.price(id, KC.products[id].startCfg(st)); assert.equal(r.list, undefined, `${id} / ${st}`); assert.equal(r.unit, round10(r.selling), `${id} / ${st}`); }
    }
  });
  it('noList prices by formula, and a project cost, lead time and floor are the formula\'s either way', () => {
    const KC = priced.KC, c = KC.products.prep.startCfg('basic');
    const a = KC.price('prep', c), b = KC.price('prep', c, { noList: true });
    assert.equal(b.list, undefined); assert.equal(b.unit, round10(b.selling));
    assert.notEqual(a.unit, b.unit);
    assert.equal(a.projectCost, b.projectCost); assert.equal(a.M, b.M); assert.equal(a.selling, b.selling);
  });
  it('a code the list does not price is priced by formula, the others are not affected', () => {
    const e = loadPricedEngine(), KC = e.KC;
    delete KC.LISTP['PS-PT-1200'];
    const c = std(KC, 'prep', 'PS-PT-1200');
    const r = KC.price('prep', c);
    assert.equal(r.list, undefined); assert.equal(r.unit, round10(r.selling));
    assert.equal(KC.price('prep', std(KC, 'prep', 'PS-PT-1500')).unit, rowOf('PS-PT-1500').price);
    KC.LISTP['PS-PT-1200'] = 0; assert.equal(KC.price('prep', c).list, undefined, 'a price of zero is no price');
  });
  it('a plain number for a code that normally has a per-metre rate: no rate, so the size difference is the formula\'s', () => {
    const e = loadPricedEngine(), KC = e.KC;
    KC.LISTP['PS-PT-1500'] = rowOf('PS-PT-1500').price;                                          // a number: no per-metre rate
    const c = std(KC, 'prep', 'PS-PT-1500'); c.sides[0].len = 140;
    const r = KC.price('prep', c);
    assert.equal(r.list.perMetre, null); assert.equal(r.list.lengthAdj, 0);
    const base = std(KC, 'prep', 'PS-PT-1500');                                                  // the standard model at ITS length, 1500
    assert.equal(r.unit, round10(rowOf('PS-PT-1500').price + formula(KC, 'prep', c) - formula(KC, 'prep', base)));
    assert.ok(r.list.optionsAdj < 0, 'a shorter table is cheaper by formula');
  });
  it('without a list, or with a material missing, there is no list-based unit', () => {
    assert.ok(bare.KC.startsAt('prep') === null);
    const e = loadPricedEngine(), KC = e.KC;
    KC.P.sh15.p = null;                                                                          // the 1.5 mm top of the standard prep table
    const r = KC.price('prep', std(KC, 'prep', 'PS-PT-1200'));
    assert.equal(r.priced, false); assert.equal(r.list, undefined);
    const r2 = KC.price('rack', std(KC, 'rack', 'PS-RK-1200'));
    assert.equal(r2.priced, true); assert.equal(r2.list.code, 'PS-RK-1200', 'a product that does not use that material is not affected');
  });
  it('every Chef Mode model keeps its R4 behaviour: the list price of the model plus what the options add by formula', () => {
    const KC = priced.KC, def = KC.products.chef_hp, base = def.startCfg('4'), opt = def.startCfg('4'); opt.feet = 'caster';
    const r = KC.price('chef_hp', opt);
    assert.equal(r.list.code, 'CK-HP-4'); assert.equal(r.list.stdLen, null); assert.equal(r.list.lengthAdj, 0); assert.equal(r.list.perMetre, null);
    close(r.list.optionsAdj, formula(KC, 'chef_hp', opt) - formula(KC, 'chef_hp', base), 'options by formula');
    assert.equal(r.unit, round10(rowOf('CK-HP-4').price + r.list.optionsAdj));
  });
});

describe('the list hooks never break a price: a cfg the mapper cannot read, a length that cannot be read or is not a finite number', () => {
  it('KC.baseModel answers null, never an error, for a product with no code, an unknown product and a cfg the mapper cannot read', () => {
    const KC = priced.KC;
    assert.equal(KC.baseModel('nope', {}), null);
    assert.equal(KC.baseModel('vent', KC.products.vent.startCfg(KC.products.vent.defaultStart)), null, 'ventilation has no code');
    assert.equal(KC.baseModel('prep', null), null);
    assert.equal(KC.baseModel('sink', undefined), null);
    assert.equal(KC.baseModel('hood', null), null);
    assert.equal(KC.baseModel('prep', std(KC, 'prep', 'PS-PT-1200')).code, 'PS-PT-1200', 'and a real cfg still maps');
  });
  it('a length reader that throws, or gives no finite number, leaves the length term out: the base model at its own length, no per-metre rate used, a finite unit', () => {
    const bads = { throws: () => { throw new Error('boom'); }, 'not a number': () => NaN, infinite: () => Infinity, 'minus infinity': () => -Infinity, none: () => null, text: () => '1400' };
    for (const [name, reader] of Object.entries(bads)) {
      const KC = loadPricedEngine().KC, c = std(KC, 'prep', 'PS-PT-1500'); c.sides[0].len = 140;
      KC.products.prep.lengthOf = reader;
      let r; assert.doesNotThrow(() => { r = KC.price('prep', c); }, name);
      assert.equal(r.list.perMetre, null, name + ': the rate is not used');
      assert.equal(r.list.lengthAdj, 0, name);
      assert.ok(Number.isFinite(r.unit) && Number.isFinite(r.list.adj), name + ': a finite price, got ' + r.unit);
      const want = round10(rowOf('PS-PT-1500').price + (formula(KC, 'prep', c) - formula(KC, 'prep', std(KC, 'prep', 'PS-PT-1500'))));
      assert.equal(r.unit, want, name + ': the size is carried by the formula, as for a code with no per-metre rate');
    }
  });
});

describe('"starts at": the list price of the smallest standard model', () => {
  it('is the lowest list price among the product\'s standard models', () => {
    const KC = priced.KC;
    for (const id of ['prep', 'rack', 'cabinet', 'sink', 'hood', 'trolley', 'dishrack', 'caddy', 'chef_hp', 'chef_lp', 'chef_noodle', 'chef_sal']) {
      const prices = KC.stdModels(id).map(m => ({ code: m.code, price: rowOf(m.code).price })).sort((a, b) => a.price - b.price);
      assert.deepEqual(plain(KC.startsAt(id)), prices[0], id);
    }
    assert.equal(KC.startsAt('prep').code, 'PS-PT-900');
    assert.equal(KC.startsAt('hood').code, 'VN-HD-1200');
    assert.equal(KC.startsAt('chef_hp').code, 'CK-HP-2');
  });
  it('does not need the formula: it is the list and nothing else', () => {
    const e = loadPricedEngine(), KC = e.KC;
    Object.keys(KC.P).forEach(k => { KC.P[k].p = null; });
    assert.equal(KC.startsAt('prep').price, rowOf('PS-PT-900').price);
  });
  it('is the lowest of the models whose price is loaded, and none when none is', () => {
    const e = loadPricedEngine(), KC = e.KC;
    delete KC.LISTP['PS-PT-900'];
    assert.equal(KC.startsAt('prep').code, 'PS-PT-1200');
    ['PS-PT-1200', 'PS-PT-1500', 'PS-PT-1800'].forEach(c => delete KC.LISTP[c]);
    assert.equal(KC.startsAt('prep'), null);
  });
  it('is nothing for a product the list does not cover', () => {
    const KC = priced.KC;
    assert.equal(KC.startsAt('station'), null); assert.equal(KC.startsAt('vent'), null); assert.equal(KC.startsAt('nonesuch'), null);
  });
});

describe('review: ducting is always reviewed (A1); a blower is a cost and needs no review (Addendum 2 B1)', () => {
  const review = (KC, id, c) => plain(KC.products[id].validate(c).review);
  const noBlowerReason = rv => rv.every(r => !/blower/i.test(r));
  it('every ventilation line is reviewed for its ducting, once, and for nothing about its blower', () => {
    const KC = priced.KC;
    for (const st of KC.products.vent.starts) {
      const c = KC.products.vent.startCfg(st.id), rv = review(KC, 'vent', c);
      assert.ok(rv.includes(DUCTING), `vent ${st.id}: ducting`);
      assert.ok(!rv.includes(BLOWER), `vent ${st.id}: the old blower reason is gone`);
      assert.ok(noBlowerReason(rv), `vent ${st.id}: no reason mentions a blower: ${rv.join(' | ')}`);
      assert.equal(rv.length, new Set(rv).size, 'no reason twice');
    }
  });
  it('a ventilation line that holds a blower row (the whole system, or the blower alone) is reviewed for the ducting only', () => {
    const KC = priced.KC;
    for (const scope of ['full', 'blower']) {
      const c = KC.products.vent.startCfg('ex1'); c.scope = scope; c.needsReview = false;       // the sizing tick (a reason of its own) is off
      assert.ok(KC.price('vent', c).lines.some(l => l.q > 0 && KC.isBlower(l.k)), `${scope}: the line holds a blower`);
      assert.deepEqual(review(KC, 'vent', c), [DUCTING], scope);
    }
  });
  it('ducting is reviewed even when the sizing tick is off and a blower is by others', () => {
    const KC = priced.KC, c = KC.products.vent.startCfg('ex1'); c.needsReview = false; c.scope = 'duct';
    const rv = review(KC, 'vent', c);
    assert.ok(rv.includes(DUCTING)); assert.ok(!rv.includes('ventilation sizing'));
    assert.ok(!KC.price('vent', c).lines.some(l => KC.isBlower(l.k)), 'no blower in the line');
    assert.ok(!rv.includes(BLOWER));
  });
  it('asking twice gives the same answer (nothing piles up)', () => {
    const KC = priced.KC, c = KC.products.vent.startCfg('ex2');
    assert.deepEqual(review(KC, 'vent', c), review(KC, 'vent', c));
    assert.deepEqual(plain(KC.products.vent.validate(c).warnings), plain(KC.products.vent.validate(c).warnings));
  });
  it('a product other than ventilation carries neither the blower reason nor the ducting one: nothing in the workshop or the Chef Mode line', () => {
    const KC = priced.KC;
    for (const def of KC.productList().filter(d => d.id !== 'vent')) for (const st of def.starts) {
      const rv = review(KC, def.id, def.startCfg(st.id));
      assert.ok(!rv.includes(BLOWER), `${def.id} / ${st.id}`); assert.ok(!rv.includes(DUCTING), `${def.id} / ${st.id}`);
    }
  });
  it('a blower added as a "+ material" row to any product puts nothing in review: it is a material cost like any other, in the line\'s materials', () => {
    const KC = priced.KC;
    const base = KC.products.sink.startCfg('dish2'), c = KC.products.sink.startCfg('dish2'); c.extra = [{ k: 'scr1', q: 1, part: 'Other' }];
    assert.deepEqual(review(KC, 'sink', c), [], 'no review for a blower');
    close(KC.price('sink', c).M - KC.price('sink', base).M, FX.materials.scr1, 'the blower\'s cost is in the materials, once');
    const fan = KC.products.sink.startCfg('dish2'); fan.extra = [{ k: 'axi2', q: 1, part: 'Other' }];
    assert.deepEqual(review(KC, 'sink', fan), [], 'a fan of the Blowers & fans list is a cost too');
    const other = KC.products.sink.startCfg('dish2'); other.extra = [{ k: 'bullet', q: 4, part: 'Other' }];
    assert.deepEqual(review(KC, 'sink', other), []);
    const none = KC.products.sink.startCfg('dish2'); none.extra = [{ k: 'scr1', q: 0, part: 'Other' }];
    assert.deepEqual(review(KC, 'sink', none), []);
  });
  it('a blower prices by the normal formula (Addendum 2 B1): its cost goes in with the labor and misc of the line, the unit is the project cost x the markup to the nearest 10 pesos, and one more peso of blower cost is one more peso of material', () => {
    const e = loadPricedEngine(), KC = e.KC, c = KC.products.vent.startCfg('ex1'); c.scope = 'full';
    const r1 = KC.price('vent', c), blowerLines = r1.lines.filter(l => l.q > 0 && KC.isBlower(l.k));
    assert.equal(blowerLines.length, 1, 'one blower row in the line');
    const key = blowerLines[0].k, q = blowerLines[0].q;
    assert.equal(r1.priced, true); assert.equal(r1.list, undefined, 'ventilation has no list price: it prices by formula');
    assert.equal(r1.unit, round10(r1.projectCost * KC.SET.markup), 'the unit is the formula: project cost x markup, nearest 10');
    KC.P[key].p += 100;
    const r2 = KC.price('vent', c);
    close(r2.M - r1.M, 100 * q, 'materials');
    close(r2.projectCost - r1.projectCost, 100 * q * 1.7 * 1.1, 'project cost = materials x 1.7 x 1.1 (ventilation is Complex: labor 70 %, misc 10 %)');
    assert.equal(r2.unit, round10(r2.projectCost * KC.SET.markup));
    assert.ok(r2.unit > r1.unit, 'a dearer blower makes a dearer line');
  });
  it('a product\'s own review reasons are kept, and added to', () => {
    const KC = priced.KC, c = KC.products.vent.startCfg('ex3'); c.needsReview = true;
    const rv = review(KC, 'vent', c);
    assert.equal(rv[0], 'ventilation sizing');
  });
  it('which materials are blowers: the Blowers & fans category only', () => {
    const KC = priced.KC;
    ['scr1', 'scr5', 'fan14', 'sir2', 'box1', 'axi3'].forEach(k => assert.equal(KC.isBlower(k), true, k));
    ['sh12', 'cornerc', 'heater', 'wiring', 'speedctl', 'flex', 'nonesuch'].forEach(k => assert.equal(KC.isBlower(k), false, k));
  });
});

describe('the formula-below-list warning: the President only, in the formula floor mode (A1)', () => {
  const FORMULA_LOW = /more than 10% below the standard price/;
  const warnings = (KC, id, c) => plain(KC.products[id].validate(c).warnings);
  it('in the formula floor mode a list-priced line whose formula price is under 90 % of its unit carries a staff-only warning; the price is not replaced', () => {
    const e = loadPricedEngine(), KC = e.KC; KC.FLOOR_MODE = 'formula';
    const c = std(KC, 'prep', 'PS-PT-1200'), r = KC.price('prep', c);
    assert.ok(r.selling < 0.9 * r.unit, 'the synthetic formula price is far under the list price');
    const w = warnings(KC, 'prep', c).filter(x => FORMULA_LOW.test(x));
    assert.equal(w.length, 1);
    assert.match(w[0], /Staff only/);
    assert.equal(KC.price('prep', c).unit, rowOf('PS-PT-1200').price, 'never replaced');
    assert.equal(warnings(KC, 'prep', c).filter(x => FORMULA_LOW.test(x)).length, 1, 'once, however often it is asked');
  });
  it('in the list floor mode (the default) it never shows', () => {
    const KC = priced.KC;
    assert.equal(KC.FLOOR_MODE, 'list');
    assert.equal(warnings(KC, 'prep', std(KC, 'prep', 'PS-PT-1200')).filter(x => FORMULA_LOW.test(x)).length, 0);
    for (const def of KC.productList()) for (const st of def.starts) assert.equal(warnings(KC, def.id, def.startCfg(st.id)).filter(x => FORMULA_LOW.test(x)).length, 0, `${def.id} / ${st.id}`);
  });
  it('a formula price at or above 90 % of the list-based unit is not a warning', () => {
    const e = loadPricedEngine(), KC = e.KC; KC.FLOOR_MODE = 'formula';
    const c = std(KC, 'prep', 'PS-PT-1200'), sell = formula(KC, 'prep', c);
    KC.LISTP['PS-PT-1200'] = round10(sell / 0.95);                                              // the formula is 95 % of the list price
    assert.equal(warnings(KC, 'prep', c).filter(x => FORMULA_LOW.test(x)).length, 0);
    KC.LISTP['PS-PT-1200'] = round10(sell);                                                     // the same
    assert.equal(warnings(KC, 'prep', c).filter(x => FORMULA_LOW.test(x)).length, 0);
    KC.LISTP['PS-PT-1200'] = round10(sell / 0.85);                                              // the formula is 85 %: under
    assert.equal(warnings(KC, 'prep', c).filter(x => FORMULA_LOW.test(x)).length, 1);
  });
  it('a product with no list price has nothing to compare with, and a line the formula cannot price has no list-based unit to compare', () => {
    const e = loadPricedEngine(), KC = e.KC; KC.FLOOR_MODE = 'formula';
    for (const st of KC.products.station.starts) assert.equal(warnings(KC, 'station', KC.products.station.startCfg(st.id)).filter(x => FORMULA_LOW.test(x)).length, 0);
    KC.P.sh15.p = null;
    assert.equal(warnings(KC, 'prep', std(KC, 'prep', 'PS-PT-1200')).filter(x => FORMULA_LOW.test(x)).length, 0);
  });
  it('a product\'s own warnings are kept, and the Chef Mode staff note about a model with no list price still shows', () => {
    const KC = priced.KC, bain4 = KC.products.chef_bain.startCfg('4');
    assert.ok(warnings(KC, 'chef_bain', bain4).some(w => /No list price yet/.test(w)));
    assert.ok(warnings(KC, 'chef_hp', KC.products.chef_hp.startCfg('4')).some(w => /Standard Price List/.test(w)));
  });
});
