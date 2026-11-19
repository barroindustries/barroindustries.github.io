// tests/kc-engine.test.mjs: the Barro Kitchens configurator ENGINE in the live repository (the committed bundle qb/kc.min.js, built from the private sources: the price-free port of the D7 prototype engine) and its money rules
// (specs/BK-LIVE-INTEGRATION-SPEC-2026-11-19.md section 5 packet B, section 6.1, and owner Round 5: Q60, Q61, Q62, Q63 and the Kingsway rows).
//
// The engine carries no price. Every figure here comes from the SYNTHETIC fixture (tests/fixtures/kc-prices.fixture.json: made-up numbers) applied by tests/helpers/kc-vm.mjs.
//
// WHAT IT PINS
//   1. GOLDEN      With the fixture applied, every product and every start pill gives exactly the figures of tests/fixtures/kc-golden.json. 51 of the 55 start pills come from the UNTOUCHED D7
//                  reference engine run with the same fixture: stripping the prices and moving the arithmetic into KCRules changed no number (for the 16 that Addendum 1 A1 moved to the
//                  Standard Price List only the formula figures are D7's; their list-based unit is pinned under a1 and worked out by hand in tests/kc-list.test.mjs). The other four are the start pills that Round 5
//                  changed on purpose (salamander wall and cooktop, hot holding cabinet, dimsum 1 boiler): the golden holds their D7 figure (which must now differ) and the live figure
//                  (pinned against regression), and the hand-worked arithmetic below works the live figures out independently, line by line.
//   2. ROUND 5     Q60 salamander 660 x 400 x 400, one list row for both mountings, one igniter per burner; Q61 hot holding cabinet 600 mm electric, no gas part, one heater (the materials row
//                  `heater`, owner ruling after Round 5); Q62 the list codes are the real
//                  codes (27 of them), no "provisional" wording; Q63 CK-DS-1; the ten Kingsway rows (no price). Each figure is worked out in the test from the fixture, line by line.
//   3. NO PRICES   Without prices every product is unpriced (never a zero price reported as priced); a list code with no number prices by formula; no corner charge makes an L / U station
//                  "priced after review" with its own reason; a partly loaded price list is not priced.
//   4. ONE COPY    KC.sell and KC.price do their arithmetic through KCRules (replace a KCRules function and the engine's answer changes).
//   5. R2-R4 RULES the rules that move money: 60 cm per door, hat channels only under solid shelves, wok faucets = ceil(holes / 2), an oven base only under 4 / 6 burners, the oven width = stove width
//                  less the leg frame, one list-priced option moves the price by cost x markup.
//   6. PENDING REVIEW KC.pendingReview(): the fabrication placeholders under "Pending Rene's review" on the Pricing settings screen (words and sizes only, read live from KC.LIB).
//
// Mutation-tested in scratch copies (never the shared tree). Each of these must fail here: KC.price treating a null price as zero and reporting priced:true; the list adjustment added to the
// project cost; plus every KCRules mutant (they reach the engine through the golden file). Run with: node --test tests/*.test.mjs
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadEngine, loadPricedEngine, loadFixture, snapshotStarts, applyFixture, GOLDEN_FILE, BUNDLE_FILE } from './helpers/kc-vm.mjs';

const FX = loadFixture();
const GOLDEN = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'));
const price = key => FX.materials[key];
const listPriceOf = code => { const v = FX.listPrices[code]; return typeof v === 'object' ? v.price : v; };
const close = (got, want, msg) => assert.ok(Math.abs(got - want) < 1e-6, `${msg || 'figure'}: got ${got}, want ${want}`);
const r2 = n => Math.round(n * 100) / 100;
// the engine runs in its own vm realm: its arrays and objects have another prototype, so copy them into this realm before deepEqual
const plain = x => JSON.parse(JSON.stringify(x));
const round10 = x => Math.round(x / 10) * 10;
// the engine's own units, restated: a 4 x 8 ft sheet in cm2, a 20 ft length in cm
const sheets = area => area / (121.92 * 243.84);
const tubes = cm => cm / 30.48 / 20;
const line = (r, k, part) => r.lines.find(l => l.k === k && l.part === part);
const qty = (r, k, part) => { const l = line(r, k, part); return l ? l.q : 0; };
// R1 on a Complex line (the Chef Mode bracket): labor 70 % of the materials, misc 10 % of (materials + labor), markup 2
const COMPLEX_FACTOR = 2 * (1 + 0.7) * (1 + 0.1);

let priced, bare;
before(() => { priced = loadPricedEngine(); bare = loadEngine(); });

describe('the golden file: the port changed no arithmetic', () => {
  it('every product and start pill that Round 5 did not touch gives exactly the D7 figures (the 16 that moved to the Standard Price List: the D7 formula figures)', () => {
    const live = snapshotStarts(priced.KC);
    let n = 0, onList = 0;
    for (const [id, starts] of Object.entries(GOLDEN.products)) {
      for (const [st, want] of Object.entries(starts)) {
        n++;
        const got = live[id] && live[id][st], pin = GOLDEN.a1[`${id}/${st}`];
        if (!pin) { assert.deepEqual(got, want, `${id} / ${st}`); continue; }
        onList++;
        const formula = Object.fromEntries(Object.entries(got).filter(([k]) => k !== 'unit' && k !== 'listAdj'));
        assert.deepEqual(formula, want, `${id} / ${st}: the formula figures are D7's`);
      }
    }
    assert.equal(n, 51, 'the golden has 51 start pills');
    assert.equal(onList, 16, '16 of them sell from the Standard Price List (Addendum 1 A1)');
  });
  it('the 16 start pills that sell from the Standard Price List give their pinned unit, which is not the D7 formula unit', () => {
    const KC = priced.KC;
    assert.deepEqual(Object.keys(GOLDEN.a1).sort(), ['cabinet/cabinet', 'caddy/std', 'dishrack/std', 'hood/wall', 'prep/basic', 'prep/blank', 'rack/rack', 'sink/blank', 'sink/dish2', 'sink/hand',
      'sink/pot', 'trolley/dish', 'trolley/food', 'trolley/luggage', 'trolley/tray', 'trolley/utility']);
    for (const [key, pin] of Object.entries(GOLDEN.a1)) {
      const [id, st] = key.split('/'), r = KC.price(id, KC.products[id].startCfg(st));
      assert.equal(r.list.code, pin.code, key);
      assert.equal(r.list.stdLen, pin.stdLen, key);
      assert.equal(r2(r.list.lengthAdj), pin.lengthAdj, key);
      assert.equal(r2(r.list.adj), pin.listAdj, key);
      assert.equal(r.unit, pin.unit, key);
      assert.notEqual(pin.unit, pin.d7Unit, `${key}: the list-based unit is not the formula unit`);
      assert.equal(round10(r.selling), pin.d7Unit, `${key}: the formula unit D7 gave is still what the formula says`);
    }
  });
  it('the live engine has exactly the golden\'s products and start pills, plus the Round 5 ones', () => {
    const live = snapshotStarts(priced.KC);
    const want = {};
    for (const [id, starts] of Object.entries(GOLDEN.products)) want[id] = Object.keys(starts);
    for (const key of Object.keys(GOLDEN.round5)) { const [id, st] = key.split('/'); (want[id] = want[id] || []).push(st); }
    const got = {};
    for (const [id, starts] of Object.entries(live)) got[id] = Object.keys(starts);
    const norm = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, [...o[k]].sort()]));
    assert.deepEqual(norm(got), norm(want));
    assert.equal(Object.keys(got).length, 23, '23 products: 10 workshop products and 13 Chef Mode products');
  });
  it('every start pill is priced with the fixture (nothing is left "priced after review")', () => {
    const live = snapshotStarts(priced.KC);
    for (const [id, starts] of Object.entries(live)) for (const [st, r] of Object.entries(starts)) { assert.equal(r.priced, true, `${id} / ${st}`); assert.equal(r.missing, 0, `${id} / ${st}`); }
  });
  it('the four Round 5 start pills give their pinned figures, and these are not the D7 figures', () => {
    const live = snapshotStarts(priced.KC);
    assert.deepEqual(Object.keys(GOLDEN.round5).sort(), ['chef_dimsum/1', 'chef_hold/std', 'chef_sal/cooktop', 'chef_sal/wall']);
    for (const [key, row] of Object.entries(GOLDEN.round5)) {
      const [id, st] = key.split('/');
      assert.deepEqual(live[id][st], row.live, key);
      assert.notDeepEqual(row.live, row.d7, `${key} moved on purpose`);
    }
    // what moved: the salamander and the hot holding cabinet in their materials, the dimsum steamer in its price source only
    assert.notEqual(GOLDEN.round5['chef_sal/wall'].live.M, GOLDEN.round5['chef_sal/wall'].d7.M);
    assert.notEqual(GOLDEN.round5['chef_sal/cooktop'].live.M, GOLDEN.round5['chef_sal/cooktop'].d7.M);
    assert.notEqual(GOLDEN.round5['chef_hold/std'].live.M, GOLDEN.round5['chef_hold/std'].d7.M);
    assert.equal(GOLDEN.round5['chef_dimsum/1'].d7.listAdj, undefined, 'D7 had no list price for 1 boiler');
    assert.notEqual(GOLDEN.round5['chef_dimsum/1'].live.listAdj, undefined, 'it has one now (Q63)');
    assert.equal(GOLDEN.round5['chef_dimsum/1'].live.M, GOLDEN.round5['chef_dimsum/1'].d7.M, 'the dimsum steamer\'s materials did not move: only its price source did');
  });
  it('a list-priced start keeps the formula project cost: the adjustment is selling price only (the floor and the lead time read true costs)', () => {
    const KC = priced.KC;
    for (const [id, st] of [['chef_hp', '4'], ['chef_wok', '2'], ['chef_combi', '1800'], ['chef_dimsum', '1']]) {
      const r = KC.price(id, KC.products[id].startCfg(st));
      assert.ok(r.list, `${id} / ${st} has a list price`);
      close(r.projectCost, r.M * 1.7 * 1.1, `${id} / ${st} project cost = materials x 1.7 x 1.1`);
      close(r.selling, r.projectCost * 2, `${id} / ${st} selling = project cost x markup`);
      close(r.list.adj, listPriceOf(r.list.code) - r.selling, `${id} / ${st} adjustment = list - formula`);
    }
  });
});

describe('loading the engine', () => {
  it('writes nothing to the console, draws nothing and boots nothing (the host does that, later)', () => {
    const e = loadEngine();
    assert.deepEqual(plain(e.logs), []);
    assert.equal(e.KC.booted, false);
  });
  it('registers the 23 products in their card order', () => {
    const list = bare.KC.productList();
    assert.equal(list.length, 23);
    assert.deepEqual(plain(list.slice(0, 10).map(d => d.id)), ['prep', 'station', 'sink', 'hood', 'vent', 'rack', 'cabinet', 'trolley', 'dishrack', 'caddy']);
    assert.deepEqual(plain(list.slice(10).map(d => d.id)), ['chef_hp', 'chef_lp', 'chef_wok', 'chef_pot', 'chef_griddle', 'chef_fryer', 'chef_noodle', 'chef_sal', 'chef_rice', 'chef_dimsum', 'chef_bain', 'chef_hold', 'chef_combi']);
  });
  it('starts with the least privilege: until the page sets the role from the signed-in profile, nobody sees a cost', () => {
    const KC = bare.KC;
    assert.equal(KC.S.role, 'sales');
    ['costs', 'customCosts', 'review', 'editPrices', 'editSettings'].forEach(w => assert.equal(KC.can(w), false, w));
    KC.S.role = 'president';
    assert.equal(KC.can('costs'), true);
    assert.equal(KC.can('editSettings'), true);
  });
});

describe('no prices loaded: the engine never reports a zero price as a price', () => {
  it('every product and start pill is unpriced, with a reason, and no usable unit price', () => {
    const KC = bare.KC;
    let n = 0;
    for (const def of KC.productList()) for (const st of def.starts) {
      const r = KC.price(def.id, def.startCfg(st.id));
      n++;
      assert.equal(r.priced, false, `${def.id} / ${st.id} priced`);
      assert.ok(r.missing.length > 0, `${def.id} / ${st.id} says what is missing`);
      assert.ok(!(r.unit > 0), `${def.id} / ${st.id} has no usable unit price`);
      assert.equal(r.list, undefined, `${def.id} / ${st.id} has no list price`);
    }
    assert.equal(n, 55);
  });
  it('the missing list names the materials, not zero', () => {
    const KC = bare.KC, r = KC.price('sink', KC.products.sink.startCfg('dish2'));
    assert.ok(r.missing.some(m => /missing from the materials price list/.test(m)));
    assert.ok(r.lines.every(l => l.p === null));
  });
  it('a list-priced Chef Mode start has no list row without its list price', () => {
    const KC = bare.KC;
    for (const def of KC.productList().filter(d => d.id.startsWith('chef_'))) for (const st of def.starts) assert.equal(KC.chefListPrice(def.startCfg(st.id)), null, `${def.id} / ${st.id}`);
  });
  it('one material left without a price leaves every line that uses it unpriced', () => {
    const e = loadPricedEngine(), KC = e.KC;
    KC.P.sh12.p = null;
    const r = KC.price('sink', KC.products.sink.startCfg('dish2'));
    assert.equal(r.priced, false);
    assert.ok(r.missing.some(m => m.includes(KC.P.sh12.l)), r.missing.join(' | '));
    const cabinet = KC.price('cabinet', KC.products.cabinet.startCfg('cabinet'));
    assert.equal(cabinet.priced, false);
  });
  it('a price of zero is a price (a free material), and a typed "+ material" row without a price is missing', () => {
    const e = loadPricedEngine(), KC = e.KC;
    KC.P.bullet.p = 0;
    assert.equal(KC.price('sink', KC.products.sink.startCfg('dish2')).priced, true);
    const c = KC.products.sink.startCfg('dish2'); c.extra = [{ k: 'bullet', q: 2, part: 'Other' }];
    KC.P.bullet.p = null;
    assert.equal(KC.price('sink', c).priced, false);
  });
});

describe('a list code with no price: the formula price stands', () => {
  const hp4 = KC => KC.products.chef_hp.startCfg('4');
  it('with the list price the start sells at the list price', () => {
    const KC = priced.KC, r = KC.price('chef_hp', hp4(KC));
    assert.equal(r.unit, FX.listPrices['CK-HP-4']);
    assert.equal(r.list.code, 'CK-HP-4');
    assert.equal(KC.chefListPrice(hp4(KC)).price, FX.listPrices['CK-HP-4']);
  });
  it('without that code it sells at project cost x markup, nearest 10, and says nothing about a list', () => {
    const e = loadPricedEngine(), KC = e.KC;
    delete KC.LISTP['CK-HP-4'];
    const r = KC.price('chef_hp', hp4(KC));
    assert.equal(r.list, undefined);
    assert.equal(r.unit, round10(r.projectCost * 2));
    assert.equal(KC.chefListPrice(hp4(KC)), null);
    assert.ok(KC.products.chef_hp.validate(hp4(KC)).warnings.some(w => /No list price yet/.test(w) && /Staff only/.test(w)));
    // another model is untouched
    assert.equal(KC.price('chef_hp', KC.products.chef_hp.startCfg('6')).unit, FX.listPrices['CK-HP-6']);
  });
  it('a code whose "price" is zero, negative or not a number is not a list price either', () => {
    for (const bad of [0, -5, null, undefined, '59000', NaN]) {
      const e = loadPricedEngine(), KC = e.KC;
      KC.LISTP['CK-HP-4'] = bad;
      const r = KC.price('chef_hp', hp4(KC));
      assert.equal(r.list, undefined, String(bad));
      assert.equal(r.unit, round10(r.projectCost * 2), String(bad));
    }
  });
  it('an unloaded KC.LISTP (no object at all) does not throw', () => {
    const e = loadPricedEngine(), KC = e.KC;
    KC.LISTP = undefined;
    assert.doesNotThrow(() => KC.price('chef_hp', hp4(KC)));
    assert.equal(KC.chefListPrice(hp4(KC)), null);
  });
});

describe('the corner charge', () => {
  const L = KC => KC.products.station.startCfg('family');            // the Family Kitchen start is an L shape: one corner
  const straight = KC => KC.products.station.startCfg('line');
  it('is null until it is set, and the cornerc row follows it', () => {
    assert.equal(bare.KC.SET.corner, null);
    assert.equal(bare.KC.P.cornerc.p, null);
  });
  it('without it an L station is "priced after review", with its own reason, said once', () => {
    const e = loadPricedEngine(), KC = e.KC;
    KC.SET.corner = null; KC.P.cornerc.p = null;
    const r = KC.price('station', L(KC));
    assert.equal(r.priced, false);
    assert.ok(r.missing.includes('the corner charge (Pricing settings)'), r.missing.join(' | '));
    assert.equal(r.missing.filter(m => /corner/i.test(m)).length, 1, 'one reason, not two');
    assert.equal(line(r, 'cornerc', 'Corner'), undefined);
  });
  it('a zero corner charge is no corner charge', () => {
    const e = loadPricedEngine(), KC = e.KC;
    KC.SET.corner = 0; KC.P.cornerc.p = 0;
    assert.equal(KC.price('station', L(KC)).priced, false);
  });
  it('a straight station and a prep table do not need it', () => {
    const e = loadPricedEngine(), KC = e.KC;
    KC.SET.corner = null; KC.P.cornerc.p = null;
    assert.equal(KC.price('station', straight(KC)).priced, true);
    assert.equal(KC.price('prep', KC.products.prep.startCfg('basic')).priced, true);
  });
  it('a U shape needs two corner charges, an L shape one', () => {
    const KC = priced.KC;
    const rl = KC.price('station', L(KC));
    assert.equal(rl.priced, true);
    assert.equal(qty(rl, 'cornerc', 'Corner'), 1);
    const u = L(KC); u.shape = 'U'; u.sides.push(JSON.parse(JSON.stringify(u.sides[1])));
    assert.equal(qty(KC.price('station', u), 'cornerc', 'Corner'), 2);
  });
  it('the charge is the pesos of cost per corner, added to the materials (the labor and misc of the bracket follow it)', () => {
    const KC = priced.KC, withC = KC.price('station', L(KC));
    const e = loadPricedEngine(); e.KC.SET.corner = 5000; e.KC.P.cornerc.p = 5000;
    const more = e.KC.price('station', L(e.KC));
    close(more.M - withC.M, 5000 - 1000, 'one corner, 4000 more');
  });
});

describe('Round 5, Q60: the salamander is 660 x 400 x 400 mm, one list row (CK-SL) for both mountings, one igniter per burner', () => {
  const W = 66, D = 40, H = 40, TRAY = 40, RISER = 20;
  const common = () => price('sh08') * sheets(2 * (W * D + W * H + D * H))                 // the body
    + 2 * price('irburner') + 2 * price('bvalve') + 2 * price('pilot')                      // 2 infrared burners, gas set
    + price('sgrid')                                                                         // the rack
    + price('sh08') * sheets(W * TRAY)                                                       // the removable catch tray: width x 40
    + 2 * price('igniter');                                                                  // one igniter per burner
  const wallM = () => common() + price('sh10') * sheets((W + 7.6) * (D + 7.6)) + price('hat') * Math.ceil(W / 60) + 2 * price('bracket') + 4 * price('anchor');
  const cooktopM = () => common() + price('t10') * tubes(2 * (W + D) + 4 * RISER);
  it('the wall-mounted materials are worked out line by line', () => {
    const KC = priced.KC, r = KC.price('chef_sal', KC.products.chef_sal.startCfg('wall'));
    close(r.M, wallM(), 'wall-mounted materials');
  });
  it('the cooktop-mounted materials are worked out line by line (a 1 in tube bracket instead of the wall shelf)', () => {
    const KC = priced.KC, r = KC.price('chef_sal', KC.products.chef_sal.startCfg('cooktop'));
    close(r.M, cooktopM(), 'cooktop-mounted materials');
    assert.equal(line(r, 'sh10', 'Wall shelf'), undefined);
    assert.equal(line(r, 'bracket', 'Wall shelf'), undefined);
  });
  it('one price for both mountings: the list row CK-SL', () => {
    const KC = priced.KC;
    const wall = KC.price('chef_sal', KC.products.chef_sal.startCfg('wall')), top = KC.price('chef_sal', KC.products.chef_sal.startCfg('cooktop'));
    assert.equal(wall.unit, FX.listPrices['CK-SL']);
    assert.equal(top.unit, FX.listPrices['CK-SL']);
    assert.equal(wall.list.code, 'CK-SL');
    assert.equal(top.list.code, 'CK-SL');
    // an older saved cfg that says mount:'counter' is read as cooktop-mounted: same price
    const old = KC.products.chef_sal.startCfg('wall'); old.mount = 'counter';
    assert.equal(KC.price('chef_sal', old).unit, FX.listPrices['CK-SL']);
  });
  it('the body is the list size: 660 x 400 x 400 mm in the print block, the build detail and the start pill', () => {
    const KC = priced.KC, D_ = KC.products.chef_sal, c = D_.startCfg('wall');
    assert.equal(D_.lineParts(c).dims, '660mmL x 400mmW x 400mmH');
    assert.ok(D_.describe(c).some(r => r[0] === 'Body' && r[1].includes('66 × 40 × 40 cm')));
    assert.ok(D_.describe(c).some(r => r[0] === 'Size' && r[1].includes('66 × 40 × 40 cm')));
    assert.ok(D_.starts.every(s => /^660mm wide/.test(s.line)), D_.starts.map(s => s.line).join(' | '));
    assert.ok(!/80 × 45 × 50|800mm|800 mm/.test(JSON.stringify(D_.describe(c)) + D_.starts.map(s => s.line).join()));
  });
  it('one auto-ignition igniter per burner (Round 4, unchanged)', () => {
    const KC = priced.KC;
    for (const st of ['wall', 'cooktop']) {
      const r = KC.price('chef_sal', KC.products.chef_sal.startCfg(st));
      assert.equal(qty(r, 'igniter', 'Auto-ignition'), 2, st);
      assert.equal(qty(r, 'igniter', 'Auto-ignition'), qty(r, 'irburner', 'Burners'), st);
    }
  });
  it('the drawing builds for both mountings and carries no broken numbers', () => {
    const KC = priced.KC;
    for (const st of ['wall', 'cooktop']) {
      const svg = KC.products.chef_sal.svg(KC.products.chef_sal.startCfg(st), {});
      assert.match(svg, /^<svg/);
      assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
    }
  });
});

describe('Round 5, Q61: the hot holding cabinet is 600 mm and electric; the gas build is gone', () => {
  const W = 60, D = 75, LEGH = 85;
  const a = 2 * D * 70 + W * 70;
  const expectedM = () => price('sh12') * sheets((W + 7.6) * (D + 7.6))                     // top
    + price('sh08') * sheets(2 * a) + price('insul') * (a / 10000 / 18)                     // double-wall body with foil insulation
    + price('sh10') * sheets(3 * (W + 4) * (D + 4))                                         // 3 shelves
    + price('sh08') * sheets(1 * (W / 1 + 4) * (70 + 2)) + 2 * price('hinge') + price('bar') * tubes(25 * 1)   // ONE door (60 cm per door): leaf, 2 hinges, a handle bar
    + price('heater')                                                                       // ONE electric heating element per cabinet
    + price('t15') * tubes(4 * LEGH) + 4 * price('bullet');                                 // legs and feet
  const start = KC => KC.products.chef_hold.startCfg('std');
  it('the materials are worked out line by line: one door, one heater, no burner, no thermostat valve, no ball valve, no pilot lighter', () => {
    const KC = priced.KC, r = KC.price('chef_hold', start(KC));
    close(r.M, expectedM(), 'hot holding cabinet materials');
    ['gburner', 'tstat', 'bvalve', 'pilot', 'hpburner', 'irburner', 'spburner'].forEach(k => assert.equal(r.lines.filter(l => l.k === k).length, 0, `no ${k} line`));
  });
  it('it sells at its list row CK-HH', () => {
    const KC = priced.KC, r = KC.price('chef_hold', start(KC));
    assert.equal(r.unit, FX.listPrices['CK-HH']);
    assert.equal(r.list.code, 'CK-HH');
  });
  it('it is 600 mm wide in the print block and the build detail, with one door', () => {
    const KC = priced.KC, D_ = KC.products.chef_hold, c = start(KC);
    assert.equal(D_.lineParts(c).dims, '600mmL x 750mmW x 850mmH');
    assert.equal(D_.lineParts(c).sub, '(1 Door, 3 Shelves)');
    assert.match(D_.starts[0].line, /^600mm wide, electric, 1 door/);
    assert.ok(D_.describe(c).some(r => r[0] === 'Doors' && /^1 hinged door/.test(r[1])));
  });
  it('nothing the customer reads says gas: the Specs, the Includes, the Not included, the standard sentence', () => {
    const KC = priced.KC, D_ = KC.products.chef_hold, c = start(KC);
    const text = [D_.shortSpecs(c), JSON.stringify(D_.incl(c)), D_.std, D_.lineParts(c).sub, D_.starts[0].line].join(' ');
    assert.doesNotMatch(text, /\bgas\b|burner|pilot|ball valve|LPG/i);
    assert.match(text, /electric/i);
    assert.deepEqual(plain(D_.incl(c).x), ['Power supply and outlet']);
  });
  it('the parts include the heater, 1 per cabinet, on the Heating line (owner ruling after Round 5)', () => {
    const KC = priced.KC, r = KC.price('chef_hold', start(KC));
    const heaters = r.lines.filter(l => l.k === 'heater');
    assert.equal(heaters.length, 1, 'one heater line');
    assert.equal(heaters[0].q, 1, 'one heater');
    assert.equal(heaters[0].part, 'Heating');
    close(heaters[0].t, price('heater'), 'the line costs one heater');
    assert.deepEqual(plain(KC.products.chef_hold.quantities(start(KC)).filter(x => x.k === 'heater')), [{ k: 'heater', g: 'Heating', q: 1 }], 'the part list the cost summary and the Build detail read');
    // it is the only heating part: no gas, no second element
    assert.equal(r.lines.filter(l => l.part === 'Heating').length, 1);
  });
  it('the heater is on the cost basis: without its price the cabinet is "priced after review", with the heater named; no other product uses it', () => {
    const e = loadPricedEngine(), KC = e.KC;
    KC.P.heater.p = null;
    const r = KC.price('chef_hold', start(KC));
    assert.equal(r.priced, false);
    assert.equal(r.list, undefined, 'a cabinet that is not fully priced has no list-priced unit either');
    assert.ok(r.missing.some(m => m.includes('Electric heating element (hot holding cabinet)')), r.missing.join(' | '));
    for (const def of KC.productList().filter(d => d.id !== 'chef_hold')) for (const st of def.starts) {
      assert.equal(KC.price(def.id, def.startCfg(st.id)).lines.filter(l => l.k === 'heater').length, 0, `${def.id} / ${st.id}`);
    }
  });
  it('the project cost (the discount floor) includes the heater: one more heater of cost, with the labor and misc of the Complex bracket on top', () => {
    const e = loadPricedEngine(), KC = e.KC, r1 = KC.price('chef_hold', start(KC));
    KC.P.heater.p = FX.materials.heater + 100;
    const r2_ = KC.price('chef_hold', start(KC));
    close(r2_.M - r1.M, 100, 'materials');
    close(r2_.projectCost - r1.projectCost, 100 * 1.7 * 1.1, 'project cost = materials x 1.7 x 1.1');
    assert.equal(r2_.unit, r1.unit, 'the list-priced unit does not move: the adjustment absorbs the formula change');
  });
  it('the Build detail names the heater, has no gas part, and no "not costed" note is left', () => {
    const KC = priced.KC, D_ = KC.products.chef_hold, c = start(KC);
    assert.equal(D_.describe(c).filter(r => /burner|pilot|ball valve|thermostat valve/i.test(r.join(' '))).length, 0);
    const heating = D_.describe(c).find(r => r[0] === 'Heating');
    assert.ok(heating, 'a Heating line');
    assert.match(heating[1], /Electric heating element \(hot holding cabinet\)/);
    assert.match(heating[1], /1 per cabinet/);
    assert.doesNotMatch(heating[1], /not on the materials|no cost is counted|not costed|pending/i);
    assert.equal(D_.validate(c).warnings.filter(w => /heating|Staff only/i.test(w)).length, 0, 'no staff-only heating note');
    assert.equal(D_.validate(c).errors.length, 0);
  });
  it('the other Chef Mode products are still gas: they keep their burners, valves and pilot lighters', () => {
    const KC = priced.KC;
    const r = KC.price('chef_hp', KC.products.chef_hp.startCfg('2'));
    assert.ok(qty(r, 'bvalve', 'Burners') > 0 && qty(r, 'pilot', 'Burners') > 0);
    assert.match(KC.products.chef_hp.std, /gas pilot lighter/);
  });
  it('the drawing builds', () => {
    const KC = priced.KC, svg = KC.products.chef_hold.svg(start(KC), {});
    assert.match(svg, /^<svg/);
    assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
  });
});

describe('Round 5, Q62 and Q63: the list codes are the real codes; 1 boiler has a list row', () => {
  const CODES = ['CK-BM-3', 'CK-CB-1800', 'CK-DS-1', 'CK-DS-2', 'CK-FR-1', 'CK-FR-2', 'CK-GD-600', 'CK-GD-900', 'CK-HH', 'CK-HP-2', 'CK-HP-4', 'CK-HP-6', 'CK-LP-2', 'CK-LP-4', 'CK-LP-6',
    'CK-NB-6', 'CK-NB-6B', 'CK-RS-12', 'CK-RS-6', 'CK-SL', 'CK-SP-1', 'CK-SP-2', 'CK-ST-4-OV', 'CK-ST-6-OV', 'CK-WK-1', 'CK-WK-2', 'CK-WK-3'];
  it('27 codes, exactly the codes of the Standard Price List (Addendum 1 A2 renamed nine; CK-DS-1 and CK-NB-6B are rows)', () => {
    assert.deepEqual(plain(priced.KC.CHEF_LIST.map(r => r.code)).sort(), CODES);
    assert.equal(CODES.length, 27);
    ['CK-SO-4', 'CK-SO-6', 'CK-GR-60', 'CK-GR-90', 'CK-DF-1', 'CK-DF-2', 'CK-SA-1', 'CK-HH-1', 'CK-CS-1800'].forEach(old => assert.ok(!CODES.includes(old), old + ' is gone'));
  });
  it('a list row is a code and a model: no price is written in it', () => {
    priced.KC.CHEF_LIST.forEach(r => assert.deepEqual(plain(Object.keys(r)).sort(), ['code', 'items', 'n', 'variant'], r.code));
  });
  it('the fixture has a price for every code (the Standard Price List is loaded from Firestore, never from the file)', () => {
    CODES.forEach(c => assert.equal(typeof FX.listPrices[c], 'number', c));
  });
  it('every row is reached by a model, and the unchanged model sells exactly at its list price', () => {
    const KC = priced.KC;
    const reached = new Set();
    for (const row of KC.CHEF_LIST) {
      for (const item of row.items) {
        const id = 'chef_' + item, def = KC.products[id];
        const start = def.starts.find(s => def.startCfg(s.id).n === row.n);
        assert.ok(start, `${row.code}: a start with n = ${row.n} on ${id}`);
        const c = def.startCfg(start.id);
        if (row.variant === 'oven') c.base = 'oven';
        if (row.variant === 'no baskets') c.baskets = false;
        const lp = KC.chefListPrice(c);
        assert.equal(lp && lp.code, row.code, `${id} / ${start.id} / ${row.variant || 'plain'}`);
        const r = KC.price(id, c);
        assert.equal(r.unit, FX.listPrices[row.code], `${row.code} sells at its list price`);
        reached.add(row.code);
      }
    }
    assert.equal(reached.size, 27);
  });
  it('the dimsum steamer with 1 boiler has its own row, CK-DS-1, and 2 boilers keep CK-DS-2', () => {
    const KC = priced.KC;
    assert.equal(KC.price('chef_dimsum', KC.products.chef_dimsum.startCfg('1')).list.code, 'CK-DS-1');
    assert.equal(KC.price('chef_dimsum', KC.products.chef_dimsum.startCfg('2')).list.code, 'CK-DS-2');
    assert.equal(KC.price('chef_dimsum', KC.products.chef_dimsum.startCfg('1')).unit, FX.listPrices['CK-DS-1']);
    assert.ok(!KC.products.chef_dimsum.validate(KC.products.chef_dimsum.startCfg('1')).warnings.some(w => /No list price yet/.test(w)), 'no "no list price" note any more');
  });
  it('a model with no list price still says so, staff only: the bain marie with 4 GN and a tabletop module', () => {
    const KC = priced.KC;
    const bain4 = KC.products.chef_bain.startCfg('4');
    assert.equal(KC.chefListPrice(bain4), null);
    assert.ok(KC.products.chef_bain.validate(bain4).warnings.some(w => /No list price yet/.test(w)));
    const tab = KC.products.chef_griddle.startCfg('60'); tab.tabletop = true;
    assert.equal(KC.chefListPrice(tab), null);
  });
  it('the engine bundle carries no "provisional" wording, and does not say the codes are a prototype\'s own', () => {
    assert.doesNotMatch(fs.readFileSync(BUNDLE_FILE, 'utf8'), /provisional|prototype's own/i);
  });
  it('an option moves the price by its formula cost x markup: list + 3.74 x the materials the option adds, nearest 10', () => {
    const KC = priced.KC, def = KC.products.chef_hp;
    const base = def.startCfg('2'), opt = def.startCfg('2'); opt.feet = 'caster';
    const rb = KC.price('chef_hp', base, { noList: true }), ro = KC.price('chef_hp', opt);
    assert.equal(KC.price('chef_hp', base).unit, FX.listPrices['CK-HP-2']);
    assert.equal(ro.unit, round10(FX.listPrices['CK-HP-2'] + COMPLEX_FACTOR * (ro.M - rb.M)));
    assert.ok(ro.unit > FX.listPrices['CK-HP-2'], 'casters cost more than adjustable feet');
  });
});

describe('Round 5, the Kingsway rows: ten more materials, no price in the file', () => {
  const NEW = { sh11: 'Sheet', sh13: 'Sheet', ss202: 'Sheet', gi08: 'Sheet', bi07: 'Sheet', cr09: 'Sheet', rt05: 'Tube & bar', rt15: 'Tube & bar', shaft516: 'Tube & bar', flat: 'Tube & bar' };
  it('the price list has 132 rows: the 121 of D7, the ten new ones, then the heater, at the end', () => {
    const KC = bare.KC, keys = Object.keys(KC.P);
    assert.equal(keys.length, 132);
    assert.deepEqual(plain(keys.slice(121, 131)).sort(), Object.keys(NEW).sort());
    assert.equal(keys[131], 'heater');
    assert.equal(keys[120], 'cornerc');
  });
  it('the heater row (owner ruling after Round 5): Cooking parts, a piece, named for the hot holding cabinet, no price in the file', () => {
    const KC = bare.KC;
    assert.equal(KC.P.heater.l, 'Electric heating element (hot holding cabinet)');
    assert.equal(KC.P.heater.u, 'pc');
    assert.equal(KC.PL_INFO.heater[0], 'Cooking parts');
    assert.ok(KC.PL_CATS.includes('Cooking parts'));
    assert.equal(KC.P.heater.p, null);
    assert.deepEqual(plain(KC.P.heater.hist), []);
  });
  it('the ten rows are in the right category, with a unit, a label, and no price', () => {
    const KC = bare.KC;
    for (const [k, cat] of Object.entries(NEW)) {
      assert.equal(KC.PL_INFO[k][0], cat, k);
      assert.equal(KC.P[k].u, cat === 'Sheet' ? 'sheet' : 'length', k);
      assert.ok(KC.P[k].l.length > 3, k);
      assert.equal(KC.P[k].p, null, k);
    }
  });
  it('the two rows with a note carry it: CR sheet bought as damaged stock, flat bar with the material not stated', () => {
    const KC = bare.KC;
    assert.match(KC.PL_INFO.cr09[2], /bought as damaged stock; a regular sheet costs more/);
    assert.equal(KC.PL_INFO.flat[1], 'material not stated');
    assert.match(KC.P.flat.l, /4 mm × 1 in/);
  });
  it('the rows the owner named carry their sizes in the label', () => {
    const KC = bare.KC;
    assert.match(KC.P.sh11.l, /1\.1 mm/); assert.match(KC.P.sh13.l, /1\.3 mm/); assert.match(KC.P.ss202.l, /SS202/);
    assert.match(KC.P.rt05.l, /½ in/); assert.match(KC.P.rt15.l, /1½ in/); assert.match(KC.P.shaft516.l, /5\/16 in/);
    assert.match(KC.P.gi08.l, /0\.8 mm/); assert.match(KC.P.bi07.l, /0\.7 mm/); assert.match(KC.P.cr09.l, /0\.9 mm/);
  });
  it('no row has a price or a history before prices are loaded', () => {
    const KC = bare.KC;
    for (const [k, v] of Object.entries(KC.P)) { assert.equal(v.p, null, k); assert.deepEqual(plain(v.hist), [], k); }
  });
  it('every row has a category on the list, a grade and a size cell, and a blower row\'s size cell is its rating text', () => {
    const KC = bare.KC;
    for (const k of Object.keys(KC.P)) {
      assert.ok(KC.PL_CATS.includes(KC.PL_INFO[k][0]), k);
      assert.equal(KC.PL_INFO[k].length, 3, k);
      if (KC.P[k].hp > 0 || KC.P[k].cfm > 0) { assert.equal(KC.PL_INFO[k][2], KC.LIB.blowerText(k), k); assert.match(KC.PL_INFO[k][2], /HP · .* CFM/, k); }
    }
  });
  it('the fixture prices exactly the rows the engine has', () => {
    assert.deepEqual(Object.keys(FX.materials).sort(), plain(Object.keys(bare.KC.P)).sort());
  });
});

describe('one copy of the money math: the engine calls KCRules', () => {
  it('KC.sell and KC.price read labor and misc from KCRules.r1', () => {
    const e = loadPricedEngine(), KC = e.KC, calls = [];
    const real = e.KCRules.r1;
    e.KCRules.r1 = (M, pct, misc, typed) => { calls.push([M, pct, misc, typed]); return { labor: 1, misc: 2, projectCost: M + 3 }; };
    const r = KC.price('sink', KC.products.sink.startCfg('dish2'));
    assert.ok(calls.length >= 1);
    assert.equal(calls[0][1], 50, 'the sink is a Medium line: 50 %');
    assert.equal(calls[0][2], 10, 'misc 10 %');
    close(r.projectCost, r.M + 3, 'the project cost is what KCRules.r1 said');
    e.KCRules.r1 = real;
  });
  it('KC.sell and KC.price round the unit through KCRules.sellUnit', () => {
    const e = loadPricedEngine(), KC = e.KC, calls = [];
    e.KCRules.sellUnit = o => { calls.push(o); return 777; };
    assert.equal(KC.price('sink', KC.products.sink.startCfg('dish2')).unit, 777);
    assert.equal(calls[0].markup, 2);
    assert.equal(calls[0].listAdj, undefined);
  });
  it('a list-priced line passes the list adjustment to KCRules.sellUnit (and only the unit moves)', () => {
    const e = loadPricedEngine(), KC = e.KC, calls = [];
    const real = e.KCRules.sellUnit;
    const plain = KC.price('chef_hp', KC.products.chef_hp.startCfg('4'), { noList: true });
    e.KCRules.sellUnit = o => { calls.push(o); return real(o); };
    const r = KC.price('chef_hp', KC.products.chef_hp.startCfg('4'));
    // KC.sell (the formula unit), KC.sell again for the unchanged base model inside the list adjustment, then the list-priced unit
    assert.equal(calls.length, 3);
    assert.equal(calls[0].listAdj, undefined);
    close(calls[2].listAdj, r.list.adj, 'the adjustment handed to sellUnit');
    close(calls[2].projectCost, r.projectCost, 'the project cost handed to sellUnit');
    close(r.projectCost, plain.projectCost, 'the project cost does not carry the adjustment');
  });
  it('without KCRules the engine cannot price (it is the one copy, not a fallback)', () => {
    const e = loadEngine({ rules: false });
    applyFixture(e.KC);
    assert.throws(() => e.KC.price('sink', e.KC.products.sink.startCfg('dish2')), /KCRules/);
  });
});

describe('the rules of Rounds 2 to 4 that move money', () => {
  it('one door per 60 cm, everywhere (Q21 / Q35): the library rule and the cabinet it prices', () => {
    const KC = priced.KC;
    assert.deepEqual(plain([30, 59, 60, 61, 120, 121, 180, 181].map(w => KC.LIB.autoDoors(w))), [1, 1, 1, 2, 2, 3, 3, 4]);
    const hinges = w => { const c = KC.products.cabinet.startCfg('cabinet'); c.doors = 0; c.W = w; return qty(KC.price('cabinet', c), 'hinge', 'Doors'); };
    assert.deepEqual(plain([60, 61, 120, 121].map(hinges)), [2, 4, 4, 6], 'two hinges per door');
  });
  it('hat channels go under solid shelves only (Q30)', () => {
    const KC = priced.KC, rack = o => { const c = KC.products.rack.startCfg('rack'); return Object.assign(c, o); };
    assert.ok(qty(KC.price('rack', rack({ stype: 'solid' })), 'hat', 'Shelves') > 0);
    assert.equal(qty(KC.price('rack', rack({ stype: 'slotted' })), 'hat', 'Shelves'), 0);
    assert.equal(qty(KC.price('rack', rack({ stype: 'slotted', load: 'heavy' })), 'hat', 'Shelves'), 0, 'slotted and heavy-duty: still none');
    assert.ok(qty(KC.price('rack', rack({ stype: 'slotted' })), 'cch', 'Shelves') > 0, 'the slotted shelf is C-channel');
  });
  it('a wok stove has 1 faucet per 2 holes: ceil(holes / 2) (Q33)', () => {
    const KC = priced.KC, faucets = n => { const c = KC.products.chef_wok.startCfg(String(n)); c.faucet = true; return qty(KC.price('chef_wok', c), 'faucet', 'Faucet'); };
    assert.deepEqual(plain([1, 2, 3].map(faucets)), [1, 1, 2]);
    const off = KC.products.chef_wok.startCfg('3'); off.faucet = false;
    assert.equal(qty(KC.price('chef_wok', off), 'faucet', 'Faucet'), 0);
  });
  it('an oven base is only under a 4- or 6-burner stove (Q22): 2 burners is an error', () => {
    const KC = priced.KC, errs = (id, n) => { const c = KC.products[id].startCfg(String(n)); c.base = 'oven'; return KC.products[id].validate(c).errors; };
    for (const id of ['chef_hp', 'chef_lp']) {
      assert.deepEqual(plain(errs(id, 2)), ['An oven base is only for 4-burner and 6-burner stoves.'], id);
      assert.deepEqual(plain(errs(id, 4)), [], id);
      assert.deepEqual(plain(errs(id, 6)), [], id);
    }
    const wok = KC.products.chef_wok.startCfg('1'); wok.base = 'oven';
    assert.deepEqual(plain(KC.products.chef_wok.validate(wok).errors), ['An oven base is only for 4-burner and 6-burner stoves.']);
  });
  it('the oven is as wide as the stove less the 7.6 cm leg frame (Q22): 4 burners, 90 cm stove, 82.4 cm oven', () => {
    const KC = priced.KC, c = KC.products.chef_hp.startCfg('4'); c.base = 'oven';
    const Wo = 90 - 7.6, a = 2 * Wo * 40 + 2 * 60 * 40 + 2 * Wo * 60;
    const r = KC.price('chef_hp', c);
    close(qty(r, 'sh10', 'Oven'), sheets(2 * a), 'oven sheet');
    close(qty(r, 'insul', 'Oven'), a / 10000 / 18, 'oven insulation');
    assert.equal(qty(r, 'ovenkit', 'Oven'), 1);
  });
  it('the combi stove\'s oven is its 80 cm stove module less the frame, 72.4 cm (Q48b), and scales with a typed width', () => {
    const KC = priced.KC, c = KC.products.chef_combi.startCfg('1800');
    const round1 = v => Math.round(v * 10) / 10;                       // the oven width is kept to 0.1 cm
    let Wo = round1(80 - 7.6), a = 2 * Wo * 40 + 2 * 60 * 40 + 2 * Wo * 60;
    close(qty(KC.price('chef_combi', c), 'sh10', 'Oven'), sheets(2 * a), 'combi oven sheet');
    const wide = KC.products.chef_combi.startCfg('1800'); wide.Wovr = 200;
    Wo = round1(80 * 200 / 180 - 7.6); a = 2 * Wo * 40 + 2 * 60 * 40 + 2 * Wo * 60;       // 88.9 cm stove module less the frame: 81.3 cm
    close(qty(KC.price('chef_combi', wide), 'sh10', 'Oven'), sheets(2 * a), 'combi oven sheet at 200 cm');
  });
  it('the Chef Mode bracket is Complex (70 %) and the workshop products are Simple or Medium', () => {
    const KC = priced.KC, br = { prep: 'simple', station: 'medium', sink: 'medium', hood: 'complex', vent: 'complex', rack: 'simple', cabinet: 'medium', trolley: 'medium', dishrack: 'medium', caddy: 'simple' };
    for (const [id, want] of Object.entries(br)) assert.equal(KC.products[id].bracket(KC.products[id].startCfg(KC.products[id].defaultStart)), want, id);
    for (const def of KC.productList().filter(d => d.id.startsWith('chef_'))) assert.equal(def.bracket(), 'complex', def.id);
  });
  it('the hood body is the 0.9 mm sheet (Q55) and the Chef Mode igniters follow the burners (Q49)', () => {
    const KC = priced.KC, r = KC.price('hood', KC.products.hood.startCfg('wall'));
    assert.ok(line(r, 'sh09', 'Hood body') && !line(r, 'sh08', 'Hood body'));
    const sal = KC.price('chef_sal', KC.products.chef_sal.startCfg('wall'));
    assert.equal(qty(sal, 'igniter', 'Auto-ignition'), qty(sal, 'irburner', 'Burners'));
  });
});

describe('every cfg the host can build prices without throwing, and prints no broken number', () => {
  it('each start pill: price, the print block, the specs, the includes and the drawing', () => {
    const KC = priced.KC;
    KC.useGroup = () => ''; KC.purposeGroup = () => '';
    for (const def of KC.productList()) for (const st of def.starts) {
      const c = def.startCfg(st.id), tag = `${def.id} / ${st.id}`;
      assert.doesNotThrow(() => KC.price(def.id, c), tag);
      const parts = def.lineParts(c);
      assert.ok(parts.title && parts.dims, tag);
      assert.doesNotMatch(JSON.stringify([parts, def.shortSpecs(c), def.incl(c)]), /NaN|undefined/, tag);
      const svg = def.svg(c, {});
      assert.match(svg, /^<svg/, tag);
      assert.doesNotMatch(svg, /NaN|undefined|Infinity/, tag);
      assert.equal(def.validate(c).errors.length, 0, tag);
    }
  });
});

describe('KC.pendingReview: the fabrication placeholders of "Pending Rene\'s review" (the Pricing settings screen takes the list from the engine, Addendum 1 A9)', () => {
  const FOLD = 'Fold on the top and shelf edges (1½ in, both edges)';
  // [what the row says, the constants it shows (paths into KC.LIB) or the fixed word it shows], in the order the screen lists them. Every size is in cm.
  const ROWS = [
    ['Tables, cabinets, shelves and doors', [
      [FOLD, ['C.FOLD']], ['Extra depth of a marine edge', ['C.MARINE']], ['Full-height backsplash', ['C.SPLASH_FULL']], ['Fold of a side splash', ['C.SIDE_FOLD']],
      ['One hat channel every', ['C.HAT_EVERY']], ['Longest run on four legs (every further run adds a pair of legs)', ['C.LEG_SPAN']],
      ['Floor clearance (the body of a cabinet is the height minus this)', ['C.FLOOR']], ['Round bar per handle', ['C.HANDLE']],
      ['A door wider than this may sag / a door narrower than this is cramped', ['C.DOOR_MAX', 'C.DOOR_MIN']],
      ['Drawer heights: shallow / medium / deep', ['DRAWER_H.Shallow', 'DRAWER_H.Medium', 'DRAWER_H.Deep']],
      ['Upper shelf depth / gap between levels / upper cabinet height', ['C.UPPER_D', 'C.UPPER_GAP', 'C.UCAB_H']], ['Tall pantry height', ['C.PANTRY_H']],
      ['Island overhead hung from the ceiling: drop, on four rods', ['C.CEIL_DROP']],
      ['Upper shelves stand on four posts; a sink bay is open underneath', 'as built'],
      ['Tops longer than a full sheet are charged in whole sheets; offcuts of sheet and tube are not charged', 'rule'],
      ['Stove housing and drip-pan sizes', 'as built']]],
    ['Racks, trolleys, dish rack and caddy', [
      ['Raised back and side edge of a shelf (the stopper, with its fold)', ['C.STOPPER']],
      ['Trolley frame: four posts and one rail frame per layer; handle length; tray slides 60 mm', 'as built'],
      ['Dish rack slot spacing: plates / saucers / cups / bowls', ['C.DISH_SPACING.plates', 'C.DISH_SPACING.saucers', 'C.DISH_SPACING.cups', 'C.DISH_SPACING.bowls']],
      ['Dish rack and spoon & fork caddy geometry', 'as built']]],
    ['Chef Mode cooking line', [
      ['Depth / body height / splash', ['C.CHEF.D', 'C.CHEF.H', 'C.CHEF.SPLASH']], ['Stove width for 2 / 4 / 6 burners', ['C.CHEF.STOVE_W.2', 'C.CHEF.STOVE_W.4', 'C.CHEF.STOVE_W.6']],
      ['Fascia / drip tray depth', ['C.CHEF.FASCIA', 'C.CHEF.TRAY']], ['Oven height / depth', ['C.CHEF.OVEN_H', 'C.CHEF.OVEN_D']],
      ['Width of a wok hole / a stock pot burner / a fryer vat', ['C.CHEF.WOK_W', 'C.CHEF.POT_W', 'C.CHEF.VAT_W']],
      ['Stock pot height / griddle plate depth', ['C.CHEF.POT_H', 'C.CHEF.PLATE_D']],
      ['Bain marie: 350 mm per pan plus 100 mm; one burner per two pans', 'as built'],
      ['One griddle burner per 300 mm; two baskets per vat; the grates on the low pressure stove', 'as built'],
      ['Vat and tank sizes; the bodies of the salamander, rice steamer and hot holding cabinet; the double-wall oven', 'as built']]]
  ];
  const sizeRows = () => ROWS.flatMap(([, rs]) => rs.filter(r => Array.isArray(r[1])));
  const get = (LIB, p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), LIB);
  const setAt = (LIB, p, v) => { const ks = p.split('.'), last = ks.pop(); get(LIB, ks.join('.'))[last] = v; };
  const find = (list, what) => { for (const [, rs] of list) for (const r of rs) if (r[0] === what) return r; return null; };
  const DOORS = 'A door wider than this may sag / a door narrower than this is cramped';

  it('returns a non-empty list: the three groups, each of [what, value] rows of printable text, exactly the rows of the screen, in its order', () => {
    const e = loadEngine();
    assert.equal(typeof e.KC.pendingReview, 'function');
    const raw = e.KC.pendingReview();
    assert.ok(Array.isArray(raw) && raw.length > 0, 'a non-empty array');
    const list = plain(raw);
    assert.deepEqual(list.map(g => g[0]), ROWS.map(g => g[0]));
    for (const [g, rs] of list) {
      assert.ok(Array.isArray(rs) && rs.length > 0, `${g}: has rows`);
      for (const r of rs) { assert.equal(r.length, 2, r[0]); assert.ok(typeof r[0] === 'string' && r[0] !== '' && typeof r[1] === 'string' && r[1] !== '', JSON.stringify(r)); }
    }
    assert.deepEqual(list.map(([g, rs]) => [g, rs.map(r => r[0])]), ROWS.map(([g, rs]) => [g, rs.map(r => r[0])]), 'no row went missing because a constant was renamed');
    assert.doesNotMatch(JSON.stringify(list), /undefined|NaN|null|Infinity/);
  });
  it('a size row shows the constants of the library as they are now (cm, joined by " / "); every other row is a fixed word', () => {
    const e = loadEngine(), list = plain(e.KC.pendingReview());
    for (const [, rs] of ROWS) for (const [what, src] of rs) {
      const want = Array.isArray(src) ? src.map(p => `${get(e.KC.LIB, p)}`).join(' / ') + ' cm' : src;
      assert.deepEqual(find(list, what), [what, want], what);
    }
  });
  it('each size row shows ITS OWN constants: with every constant set to a different number, no row shows another row\'s', () => {
    const e = loadEngine();
    sizeRows().flatMap(r => r[1]).forEach((p, i) => setAt(e.KC.LIB, p, 101 + i * 1.5));
    const list = plain(e.KC.pendingReview());
    for (const [what, paths] of sizeRows()) assert.deepEqual(find(list, what), [what, paths.map(p => get(e.KC.LIB, p)).join(' / ') + ' cm'], what);
    const shown = sizeRows().flatMap(r => r[1]).map(p => get(e.KC.LIB, p));
    assert.equal(new Set(shown).size, shown.length, 'the test gave every constant its own number');
  });
  it('the values are read live: change a constant and the row follows (a fraction keeps its decimals, zero is a value)', () => {
    const e = loadEngine(), L = e.KC.LIB;
    L.C.FOLD = 3.25; L.DRAWER_H = { Shallow: 11, Medium: 12, Deep: 13 }; L.C.CHEF.STOVE_W = { 2: 70, 4: 80, 6: 120 }; L.C.MARINE = 0;
    const list = plain(e.KC.pendingReview());
    assert.deepEqual(find(list, FOLD), [FOLD, '3.25 cm']);
    assert.deepEqual(find(list, 'Drawer heights: shallow / medium / deep'), ['Drawer heights: shallow / medium / deep', '11 / 12 / 13 cm']);
    assert.deepEqual(find(list, 'Stove width for 2 / 4 / 6 burners'), ['Stove width for 2 / 4 / 6 burners', '70 / 80 / 120 cm']);
    assert.deepEqual(find(list, 'Extra depth of a marine edge'), ['Extra depth of a marine edge', '0 cm'], 'a zero is a value, not an empty row');
  });
  it('a row with no value is left out: null, undefined, "", NaN, Infinity; a joined row with one member missing goes whole, never half-written', () => {
    for (const bad of [null, undefined, '', NaN, Infinity, -Infinity]) {
      const e = loadEngine(); e.KC.LIB.C.FOLD = bad;
      const list = plain(e.KC.pendingReview());
      assert.equal(find(list, FOLD), null, `FOLD = ${String(bad)}`);
      assert.ok(find(list, 'Extra depth of a marine edge'), 'the other rows stay');
      assert.doesNotMatch(JSON.stringify(list), /undefined|NaN|null|Infinity/, `FOLD = ${String(bad)}`);
    }
    for (const bad of [undefined, null, '', NaN]) {
      const e = loadEngine(); e.KC.LIB.C.DOOR_MIN = bad;
      const list = plain(e.KC.pendingReview());
      assert.equal(find(list, DOORS), null, `DOOR_MIN = ${String(bad)}`);
      assert.doesNotMatch(JSON.stringify(list), /undefined|NaN|null|Infinity/);
      assert.ok(find(list, FOLD));
    }
  });
  it('a library that is not all there leaves out the rows it cannot fill and still answers (the words stay)', () => {
    const e = loadEngine();
    delete e.KC.LIB.C.CHEF.STOVE_W;
    let list = plain(e.KC.pendingReview());
    assert.equal(find(list, 'Stove width for 2 / 4 / 6 burners'), null);
    assert.ok(find(list, 'Depth / body height / splash'), 'only the stove row goes');
    delete e.KC.LIB.C.CHEF; delete e.KC.LIB.C.DISH_SPACING; e.KC.LIB.DRAWER_H = undefined;
    list = plain(e.KC.pendingReview());
    assert.deepEqual(list.map(g => g[0]), ROWS.map(g => g[0]));
    assert.deepEqual(find(list, 'Dish rack and spoon & fork caddy geometry'), ['Dish rack and spoon & fork caddy geometry', 'as built']);
    assert.equal(find(list, 'Depth / body height / splash'), null);
    assert.equal(find(list, 'Dish rack slot spacing: plates / saucers / cups / bowls'), null);
    assert.equal(find(list, 'Drawer heights: shallow / medium / deep'), null);
    const bareLib = loadEngine(); bareLib.KC.LIB = undefined;
    assert.doesNotThrow(() => bareLib.KC.pendingReview());
    const rest = plain(bareLib.KC.pendingReview());
    assert.ok(rest.length > 0 && rest.every(([, rs]) => rs.length > 0 && rs.every(r => r[1] === 'as built' || r[1] === 'rule')), 'with no library only the fixed words are left');
  });
  it('holds words and sizes only: no price, no peso sign, no grouped number', () => {
    const list = plain(loadEngine().KC.pendingReview());
    for (const [, rs] of list) for (const [what, value] of rs) {
      assert.match(value, /^(as built|rule|[\d.]+( \/ [\d.]+)* cm)$/, what);
      assert.doesNotMatch(what + value, /₱|\bPHP\b|\d,\d{3}/, what);
    }
  });
});
