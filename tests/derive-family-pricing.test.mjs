// tests/derive-family-pricing.test.mjs — scripts/derive-family-pricing.js: the STARTING VALUES for the private option sheets (product_pricing/{family}).
//
// What must hold (owner ruling 2026-10-21):
//   * Nothing in the script, its console output or the repository is a price. The output is a PRIVATE, GITIGNORED file (private/family-pricing.seed.json);
//     the committed source holds SKU ids, spec labels and rules only. The tests below use obviously FAKE odd-figure fixtures (the repo is public).
//   * Every option value of every family appears in the output, with a derived amount and a confidence, or BLANK (null amount, confidence "blank",
//     a written reason). A figure is derived only when the master really says it: a master option adder, or two SKUs that differ in the option.
//     Extrapolations, proxies and layout choices stay BLANK. A blank is never silently turned into zero.
//   * The model the figures feed (priceConfiguredItem) can consume the output as it stands: an imported seed prices what it covers and leaves the rest
//     "priced after review".
//
//   * THE STAFF-ONLY TOP PLATE (owner ruling 2026-10-28, QUOTE-BUILDER-CONFIGURATOR-SPEC §14.4): tables, sinks and stoves get ONE extra cell, "Top plate: 1.2 mm" — the SIGNED
//     amount (a negative number, or 0) for the lighter top — and it is ALWAYS BLANK in the seed: the master's BA-001 "Top Gauge" adder is quoted in the note as a
//     cross-reference only, never used as the amount. The seed is written for the current family schema (2), so an older seed is refused by the importer.
//
// Mutation-tested in scratch copies (see the commit message): turning a blank into 0, dropping the "prefer" order of the owner-prescribed pair,
// ignoring the adder cross-check, deriving the wall-shelf length rate without the standard length, writing the output next to the source, and so on.
// 2026-10-28: filling the 1.2 mm top cell from the master's adder, dropping the cell for one family, the absorbed-SKU check pricing a configuration without the
// top plate — each must fail here too.
//
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const DERIVE = require('../scripts/derive-family-pricing.js');
const FAMS = require('../js/qr-families.js');
const PF = require('../js/product-families.js');
const PC = require('../js/pricing-core.js');
const B = require('../scripts/build-catalogue.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── fake master ─────────────────────────────────────────────────────────────
const prod = (id, over) => Object.assign({ id, category: 'prep_washing', name: 'Synthetic ' + id, formulaType: 'fixed', basePrice: 0, defaultDimensions: {}, formula: {}, specs: [], unit: 'pc' }, over || {});
const dd = (W, D, H) => Object.assign({}, W != null ? { W } : {}, D != null ? { D } : {}, H != null ? { H } : {});
const spec = (label, options, def, priceAdder) => ({ label, options, default: def, priceAdder });
// the six primaries (priced, fake) + whatever extra evidence a test adds
// the five length-priced primaries are `per_length` (with flat rates, so size never moves a figure and the arithmetic below stays readable), the wall-shelf
// primary has no length rule of its own — exactly the pairing the build enforces (sizeBasis "primary" vs "linear")
const perLen = (id, basePrice, dims) => prod(id, { basePrice, defaultDimensions: dims, formulaType: 'per_length', formula: { baseLengthMm: dims.W, pricePerExtraMm: 0, rateW100: 0, rateD100: 0, rateH100: 0 } });
const PRIMARIES = () => [
  perLen('PW-001', 12345, dd(900, 600, 850)),
  perLen('PW-004', 15555, dd(500, 500, 850)),
  perLen('CE-001', 20001, dd(600, 700, 850)),
  perLen('PW-015', 8888, dd(600, 500, 1800)),
  prod('PW-023', { basePrice: 4444, defaultDimensions: dd(1200, 450) }),
  perLen('PW-010', 9999, dd(600, 500, 1600)),
];
const derive = (extra, constants) => {
  const byId = new Map();
  for (const p of [...PRIMARIES(), ...(extra || [])]) byId.set(p.id, p);          // an extra with a primary's id REPLACES it
  return DERIVE.deriveAll({ fams: FAMS, byId, constants: constants || {}, masterName: 'synthetic.json' });
};
const cellOf = (seed, fid, g, v) => seed.families[fid].options[g][v];

// every number anywhere in a value is finite
function assertFinite(value, where) {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${where} is not a finite number`);
  else if (Array.isArray(value)) value.forEach((v, i) => assertFinite(v, `${where}[${i}]`));
  else if (value && typeof value === 'object') Object.keys(value).forEach((k) => assertFinite(value[k], `${where}.${k}`));
}

describe('derive-family-pricing — the output covers every option of every family, in the shape the app imports', () => {
  const seed = derive();

  it('is a versioned, labelled private seed for the current family schema, with all six families', () => {
    assert.equal(seed.kind, 'barro-family-pricing-seed');
    assert.equal(seed.version, 1, 'the seed FILE format is unchanged');
    assert.equal(seed.schemaVersion, FAMS.version);
    assert.equal(seed.schemaVersion, 2, 'the families are on schema 2 (the 1.5 mm top plate is the standard): an older seed is refused by the importer');
    assert.deepEqual(Object.keys(seed.families), FAMS.order);
    assert.match(seed._readme, /PRIVATE/);
    assert.match(seed._readme, /never be committed/);
    assert.match(seed._readme, /UNAPPROVED/);
    assert.equal(seed.masterFile, 'synthetic.json');
    assert.ok(!Number.isNaN(Date.parse(seed.generatedAt)));
  });

  it('lists EVERY non-baseline option value of every family (no cell is missing, none is invented), and the size rate only for a linear family', () => {
    for (const fid of FAMS.order) {
      const fam = FAMS.families[fid];
      const expected = PF.cells(fam).filter((c) => !c.baseline).map((c) => `${c.group}|${c.value}`).sort();
      const out = seed.families[fid];
      const got = [];
      for (const g of Object.keys(out.options)) for (const v of Object.keys(out.options[g])) got.push(`${g}|${v}`);
      assert.deepEqual(got.sort(), expected, `${fid}: the cells of the seed differ from the cells of the family`);
      assert.equal(out.table.filter((r) => r.group !== 'size').length, expected.length, `${fid}: the console table must list every cell once`);
      assert.equal(out.table.some((r) => r.group === 'size'), fam.sizeBasis === 'linear', `${fid}: a size row exists only for a linear family`);
      assert.equal(out.primary, fam.primary);
      assert.equal(out.sizeBasis, fam.sizeBasis);
      assert.equal(out.schemaVersion, FAMS.version);
    }
  });

  it('every cell is either DERIVED (a finite amount, a confidence of low/medium/high, a written derivation) or BLANK (null amount, confidence "blank", a written reason)', () => {
    let derived = 0, blank = 0;
    for (const fid of FAMS.order) {
      for (const g of Object.keys(seed.families[fid].options)) {
        for (const v of Object.keys(seed.families[fid].options[g])) {
          const c = seed.families[fid].options[g][v];
          assert.deepEqual(Object.keys(c).sort(), ['confidence', 'derivation', 'flat', 'perW100'], `${fid}.${g}.${v}: the cell shape is what the importer reads`);
          assert.ok(typeof c.derivation === 'string' && c.derivation.trim().length > 10, `${fid}.${g}.${v}: a cell with no explanation`);
          if (c.flat === null) {
            blank++;
            assert.equal(c.confidence, 'blank', `${fid}.${g}.${v}: a blank amount must say so`);
            assert.equal(c.perW100, null, `${fid}.${g}.${v}: a blank amount cannot carry a length rate`);
          } else {
            derived++;
            assert.ok(Number.isInteger(c.flat), `${fid}.${g}.${v}: amounts are whole pesos`);
            assert.ok(['low', 'medium', 'high'].includes(c.confidence), `${fid}.${g}.${v}: confidence ${c.confidence}`);
            assert.ok(c.perW100 === null || Number.isInteger(c.perW100));
          }
        }
      }
    }
    assert.ok(blank > derived, 'with only the six primaries in the master almost everything must be BLANK (no evidence), never guessed');
    assertFinite(seed, 'seed');
  });

  it('with no evidence beyond the primaries, the only derived figure is the length rate of the linear family — a blank is NEVER zero', () => {
    const flats = [];
    for (const fid of FAMS.order) for (const g of Object.keys(seed.families[fid].options)) for (const v of Object.keys(seed.families[fid].options[g])) flats.push(seed.families[fid].options[g][v].flat);
    assert.ok(flats.every((f) => f === null), 'an option with no evidence in the master must stay blank');
    assert.ok(!flats.includes(0));
    assert.equal(seed.families.wall_shelf.size.confidence, 'low');
    assert.ok(Number.isInteger(seed.families.wall_shelf.size.perW100) && seed.families.wall_shelf.size.perW100 > 0);
  });

  it('an all-blank seed prices NOTHING as configured: changing ANY single option makes the line "priced after review" (missing input) — never a half price, never zero', () => {
    const byId = new Map(PRIMARIES().map((p) => [p.id, p]));
    let checked = 0;
    for (const fid of FAMS.order) {
      const fam = FAMS.families[fid];
      const sheet = { approved: true, schemaVersion: FAMS.version, options: Object.fromEntries(Object.entries(seed.families[fid].options).map(([g, vs]) => [g, Object.fromEntries(Object.entries(vs).map(([v, c]) => [v, { flat: c.flat, perW100: c.perW100 }]))])), size: { perW100: seed.families[fid].size.perW100 } };
      const prim = byId.get(fam.primary);
      const price = (cfg, dims) => PC.priceConfiguredItem(prim, fam, cfg, dims || PF.defaultDims(fam), sheet, {}, { schemaVersion: FAMS.version });
      // the default configuration needs no cell at all
      const dflt = price(PF.defaultConfig(fam));
      assert.equal(dflt.reason, null, `${fid}: the default configuration should price from the base item alone`);
      assert.equal(dflt.priced, true);
      for (const c of PF.cells(fam).filter((x) => !x.baseline)) {
        const g = PF.groupOf(fam, c.group);
        const o = g.options.find((x) => String(x.v) === String(c.value));
        const cfg = PF.defaultConfig(fam);
        if (g.type === 'choice') cfg[g.key] = o.v;
        else if (g.type === 'multi') cfg[g.key] = [o.v];
        else cfg[g.key] = cfg[g.key].concat([o.v]);                      // one more burner of this type than the standard layout
        // a size that satisfies the family's own width rule and forced minimums, so the probe isolates the missing amount
        const dims = PF.defaultDims(fam);
        const mw = PF.minWidth(fam, cfg);
        if (mw && dims.W < mw.mm) dims.W = mw.mm;
        const fm = PF.forcedMins(fam, cfg);
        Object.keys(fm).forEach((k) => { if (dims[k] < fm[k]) dims[k] = fm[k]; });
        const v = PF.validateLine(fam, cfg, dims, { staff: true });                    // STAFF mode: the 1.2 mm top plate is a staff-only choice
        assert.ok(v.ok, `${fid} ${c.group}.${c.value}: the probe configuration must itself be valid (${(v.errors || []).join(' ')})`);
        const r = price(v.config, v.dims);
        assert.equal(r.priced, false, `${fid} ${c.group}.${c.value}: a blank amount was priced`);
        assert.equal(r.reason, 'missing_input', `${fid} ${c.group}.${c.value}`);
        assert.ok(r.missing.length >= 1);
        checked++;
      }
    }
    assert.ok(checked >= 30, `only ${checked} option cells were probed`);
  });
});

describe('derive-family-pricing — figures come only from evidence the master really contains', () => {
  // prep table: the owner prescribed the PW-001 / PW-003 pair for 3 layers; the master's undershelf adder is a cross-check
  const prepBase = [
    prod('PW-003', { basePrice: 20001, defaultDimensions: dd(900, 600, 850) }),
  ];
  it('prep table, 3 layers = the PW-003 vs PW-001 pair at one size; 2 layers = half of it, interpolated (low); an agreeing master adder lifts it to HIGH', () => {
    const baker = prod('BA-001', { basePrice: 7000, specs: [spec('Undershelf', ['None', '1 undershelf'], 'None', [0, 3210])] });
    const s = derive([...prepBase, baker]);
    const three = cellOf(s, 'prep_table', 'layers', '3');
    assert.equal(three.flat, 20001 - 12345);
    assert.equal(three.confidence, 'high');
    assert.match(three.derivation, /PW-003 versus PW-001/);
    assert.match(three.derivation, /agrees/);
    const two = cellOf(s, 'prep_table', 'layers', '2');
    assert.equal(two.flat, Math.round((20001 - 12345) / 2));
    assert.equal(two.confidence, 'low');
    assert.match(two.derivation, /interpolated/);
  });
  it('a master adder that CONFLICTS with the pair drops the confidence to LOW and says so; the prescribed pair still wins', () => {
    const baker = prod('BA-001', { basePrice: 7000, specs: [spec('Undershelf', ['None', '1 undershelf'], 'None', [0, 500])] });
    const s = derive([...prepBase, baker]);
    const three = cellOf(s, 'prep_table', 'layers', '3');
    assert.equal(three.flat, 20001 - 12345, 'the owner-prescribed pair is first even though a master adder exists (prefer)');
    assert.equal(three.confidence, 'low');
    assert.match(three.derivation, /CONFLICTS/);
  });
  it('prep table, one upper shelf = the master\'s overshelf adder (medium); TWO upper shelves stay BLANK (an extrapolation) with the doubled figure only SUGGESTED in the note', () => {
    const over = prod('BA-010', { basePrice: 6000, specs: [spec('Overshelf', ['None', 'Single overshelf'], 'None', [0, 2222])] });
    const s = derive([over]);
    const one = cellOf(s, 'prep_table', 'upper', '1');
    assert.equal(one.flat, 2222);
    assert.equal(one.confidence, 'medium');
    const two = cellOf(s, 'prep_table', 'upper', '2');
    assert.equal(two.flat, null);
    assert.equal(two.confidence, 'blank');
    assert.match(two.derivation, /extrapolation/);
    assert.match(two.derivation, /4,444/);
  });
  it('without the evidence the same cells are BLANK, not zero (no PW-003, no adder)', () => {
    const s = derive();
    for (const [g, v] of [['layers', '3'], ['layers', '2'], ['upper', '1'], ['upper', '2']]) {
      const c = cellOf(s, 'prep_table', g, v);
      assert.equal(c.flat, null, `${g}.${v}`);
      assert.equal(c.confidence, 'blank');
    }
  });

  it('sink: the pre-rinse faucet from two agreeing master adders is HIGH; the double basin from the sink-table adder is derived; 3 and 4 sinks, alignment, undershelf and upper shelf are BLANK', () => {
    const extra = [
      prod('PW-004', { basePrice: 15555, defaultDimensions: dd(500, 500, 850), specs: [spec('Faucet Type', ['Gooseneck', 'Pre-rinse spray'], 'Gooseneck', [0, 640])] }),
      prod('BA-012', { basePrice: 9000, specs: [spec('Faucet', ['Gooseneck', 'Pre-rinse spray'], 'Gooseneck', [0, 600])] }),
      prod('PW-051', { basePrice: 11000, specs: [spec('Basin Type', ['Single (508x508x254)', 'Double'], 'Single (508x508x254)', [0, 4300])] }),
    ];
    const s = derive(extra);
    const f = cellOf(s, 'sink', 'faucet', 'prerinse');
    assert.equal(f.flat, 640);
    assert.equal(f.confidence, 'high');
    assert.match(f.derivation, /PW-004/);
    assert.match(f.derivation, /BA-012/);
    const b2 = cellOf(s, 'sink', 'basins', '2');
    assert.equal(b2.flat, 4300);
    assert.equal(b2.confidence, 'medium');
    for (const [g, v] of [['basins', '3'], ['basins', '4'], ['alignment', 'left'], ['alignment', 'right'], ['undershelf', 'true'], ['upper', 'true']]) {
      const c = cellOf(s, 'sink', g, v);
      assert.equal(c.flat, null, `sink ${g}.${v} must be blank`);
      assert.equal(c.confidence, 'blank');
    }
    // alignment is a layout choice: the note SUGGESTS no extra material but never writes it as the amount
    assert.match(cellOf(s, 'sink', 'alignment', 'left').derivation, /Suggested/);
    assert.notEqual(cellOf(s, 'sink', 'alignment', 'left').flat, 0);
  });

  it('sink: two master adders for the pre-rinse faucet that DISAGREE wildly give LOW confidence and say CONFLICTS (a single clean adder would be medium)', () => {
    const faucet = (a, b) => derive([
      prod('PW-004', { basePrice: 15555, defaultDimensions: dd(500, 500, 850), specs: [spec('Faucet Type', ['Gooseneck', 'Pre-rinse spray'], 'Gooseneck', [0, a])] }),
      prod('BA-012', { basePrice: 9000, specs: [spec('Faucet', ['Gooseneck', 'Pre-rinse spray'], 'Gooseneck', [0, b])] }),
    ]).families.sink.options.faucet.prerinse;
    const clash = faucet(640, 2500);
    assert.equal(clash.flat, 640, 'the primary SKU\'s own adder is the figure');
    assert.equal(clash.confidence, 'low');
    assert.match(clash.derivation, /CONFLICTS/);
    const near = faucet(640, 700);
    assert.equal(near.confidence, 'high');
    assert.match(near.derivation, /agrees/);
    const alone = derive([prod('PW-004', { basePrice: 15555, defaultDimensions: dd(500, 500, 850), specs: [spec('Faucet Type', ['Gooseneck', 'Pre-rinse spray'], 'Gooseneck', [0, 640])] })]).families.sink.options.faucet.prerinse;
    assert.equal(alone.confidence, 'medium');
  });
  it('stove: a burner position is derived from SKUs that differ in burner count (low-pressure from 2- and 3-burner ranges that agree = HIGH); the unevidenced positions and ALL add-ons stay BLANK', () => {
    const extra = [
      prod('CE-002', { basePrice: 31112, defaultDimensions: dd(1000, 700, 850) }),
      prod('CE-003', { basePrice: 42223, defaultDimensions: dd(1500, 700, 850) }),
      prod('CE-006', { basePrice: 25001, defaultDimensions: dd(600, 700, 850) }),
    ];
    const s = derive(extra);
    const lp = cellOf(s, 'stove', 'positions', 'lp_small');
    assert.equal(lp.flat, 11111, 'CE-002 against CE-001: one more low-pressure position');
    assert.equal(lp.confidence, 'high');
    assert.match(lp.derivation, /The two agree \(within 25 %\)/);
    assert.ok(!/disagree/.test(lp.derivation), 'two figures that agree must not be described as disagreeing');
    // and when the two ranges really do differ the note says so (and the confidence drops)
    const apart = derive([
      prod('CE-002', { basePrice: 31112, defaultDimensions: dd(1000, 700, 850) }),
      prod('CE-003', { basePrice: 90001, defaultDimensions: dd(1500, 700, 850) }),
    ]);
    const lp2 = cellOf(apart, 'stove', 'positions', 'lp_small');
    assert.match(lp2.derivation, /The two disagree, so the average/);
    assert.ok(!/The two agree/.test(lp2.derivation));
    assert.notEqual(lp2.confidence, 'high');
    const wok = cellOf(s, 'stove', 'positions', 'wok');
    assert.equal(wok.flat, 25001 - 20001 + 11111, 'the wok SKU against the single low-pressure range, plus one low-pressure position');
    assert.notEqual(wok.confidence, 'high', 'a single comparison of a different construction is never high');
    for (const v of ['hp_small', 'hp_large', 'lp_large', 'soup']) assert.equal(cellOf(s, 'stove', 'positions', v).flat, null, `${v}: no evidence in this master`);
    for (const v of ['griller', 'griddle', 'oven', 'fryer']) {
      const c = cellOf(s, 'stove', 'addons', v);
      assert.equal(c.flat, null, `add-on ${v} is never derived`);
      assert.equal(c.confidence, 'blank');
    }
  });

  it('cabinet: every option is BLANK (no clean comparison in the master) and two SKUs sharing one list price at different sizes are flagged as a data anomaly', () => {
    const s = derive([prod('PW-038', { basePrice: 8888, defaultDimensions: dd(2400, 500, 1800) })]);
    for (const [g, v] of [['type', 'wall'], ['doors', 'sliding'], ['shelves', '1'], ['shelves', '2']]) assert.equal(cellOf(s, 'cabinet', g, v).flat, null, `cabinet ${g}.${v}`);
    assert.ok(s.families.cabinet.anomalies.some((a) => /PW-015/.test(a) && /PW-038/.test(a) && /SAME list price/.test(a)), 'the duplicated list price must be flagged');
    assert.deepEqual(derive().families.cabinet.anomalies, [], 'no anomaly without the second SKU');
  });

  it('wall shelving: the primary has no length rule, so the length rate is its list price per 100 mm of standard length (LOW), and every amount scales with length both ways', () => {
    const s = derive([prod('PW-024', { basePrice: 12000, defaultDimensions: dd(1200, 450) })]);
    assert.equal(s.families.wall_shelf.sizeBasis, 'linear');
    assert.equal(s.families.wall_shelf.size.perW100, Math.round(4444 * 100 / 1200));
    assert.equal(s.families.wall_shelf.size.confidence, 'low');
    assert.match(s.families.wall_shelf.size.derivation, /proportional/);
    const t3 = cellOf(s, 'wall_shelf', 'tiers', '3');
    assert.equal(t3.flat, 12000 - 4444);
    assert.equal(t3.perW100, Math.round((12000 - 4444) * 100 / 1200), 'a linear family scales the option with the length');
    assert.equal(t3.confidence, 'low');
    const t2 = cellOf(s, 'wall_shelf', 'tiers', '2');
    assert.equal(t2.flat, Math.round((12000 - 4444) / 2));
    assert.equal(t2.confidence, 'low');
    assert.equal(cellOf(s, 'wall_shelf', 'surface', 'slotted').flat, null, 'a slotted surface has no evidence');
    // an unpriced primary leaves the rate BLANK and says why — never zero
    const unpriced = derive([prod('PW-023', { basePrice: 0, defaultDimensions: dd(1200, 450) })]);
    assert.equal(unpriced.families.wall_shelf.size.perW100, null);
    assert.equal(unpriced.families.wall_shelf.size.confidence, 'blank');
    assert.match(unpriced.families.wall_shelf.size.derivation, /not priced/);
  });

  it('rack: "without wheels" can be a NEGATIVE amount (the master\'s feet adder is cheaper than casters), signed exactly as the master states it; other tier counts are BLANK', () => {
    const s = derive([prod('BA-004', { basePrice: 5000, specs: [spec('Casters', ['Casters w/ brake', 'Adjustable feet'], 'Casters w/ brake', [0, -450])] })]);
    const w = cellOf(s, 'rack', 'wheels', 'false');
    assert.equal(w.flat, -450);
    assert.ok(['low', 'medium'].includes(w.confidence));
    for (const t of ['3', '5', '6']) assert.equal(cellOf(s, 'rack', 'tiers', t).flat, null, `rack ${t} tiers`);
  });

  it('a primary missing from the master stops the run with a message that names the family and the SKU', () => {
    const byId = new Map(PRIMARIES().filter((p) => p.id !== 'CE-001').map((p) => [p.id, p]));
    assert.throws(() => DERIVE.deriveAll({ fams: FAMS, byId, constants: {}, masterName: 'x' }), /family "stove": the primary SKU CE-001 is not in the master/);
  });

  it('the absorbed-SKU check flags a family estimate more than 35 % away from a SKU\'s own list price, and says "cannot be checked" when blanks are involved', () => {
    const s = derive([prod('PW-002', { basePrice: 99999, defaultDimensions: dd(900, 600, 850) })]);
    const rows = s.families.prep_table.absorbedCheck;
    assert.ok(Array.isArray(rows) && rows.length >= 1);
    const r = rows.find((x) => x.sku === 'PW-002');
    assert.ok(r, 'PW-002 is an absorbed prep table in the family definition');
    assert.ok(/cannot be checked/.test(r.flag) || /differs by more than 35/.test(r.flag) || r.flag === 'ok');
    for (const row of rows) assert.ok(typeof row.sku === 'string' && typeof row.flag === 'string');
  });

  it('the derived figures round-trip through the model: an imported seed prices exactly primary + signed deltas, and a still-blank cell is "priced after review"', () => {
    const baker = prod('BA-001', { basePrice: 7000, specs: [spec('Undershelf', ['None', '1 undershelf'], 'None', [0, 3210])] });
    const s = derive([...prepBase, baker, prod('BA-010', { basePrice: 6000, specs: [spec('Overshelf', ['None', 'Single overshelf'], 'None', [0, 2222])] })]);
    const fam = FAMS.families.prep_table;
    const out = s.families.prep_table;
    const sheet = { approved: true, schemaVersion: FAMS.version, options: Object.fromEntries(Object.entries(out.options).map(([g, vs]) => [g, Object.fromEntries(Object.entries(vs).map(([v, c]) => [v, { flat: c.flat, perW100: c.perW100 }]))])), size: { perW100: out.size.perW100 } };
    const prim = PRIMARIES().find((p) => p.id === 'PW-001');
    const cfg = Object.assign(PF.defaultConfig(fam), { layers: 3, upper: 1 });
    const r = PC.priceConfiguredItem(prim, fam, cfg, PF.defaultDims(fam), sheet, {}, { schemaVersion: FAMS.version });
    assert.equal(r.priced, true);
    assert.equal(r.unitPrice, 12345 + (20001 - 12345) + 2222);
    // two upper shelves has no amount: the line is left out of the figure, never priced at "one shelf" or at zero
    const r2 = PC.priceConfiguredItem(prim, fam, Object.assign(PF.defaultConfig(fam), { upper: 2 }), PF.defaultDims(fam), sheet, {}, { schemaVersion: FAMS.version });
    assert.equal(r2.priced, false);
    assert.equal(r2.reason, 'missing_input');
  });
});

describe('derive-family-pricing — the staff-only 1.2 mm top plate (owner ruling 2026-10-28): one SIGNED cell per table, sink and stove, always BLANK', () => {
  const WITH_TOP = ['prep_table', 'sink', 'stove'];
  const topAdder = (light, heavy, adders) => prod('BA-001', { basePrice: 7000, specs: [spec('Top Gauge', [light, heavy], light, adders)] });

  it('prep table, sink and stove each have a "Top plate: 1.2 mm" cell, BLANK (no amount, confidence blank), and the other three families have none; the standard 1.5 mm top has no cell at all', () => {
    const seed = derive();
    for (const fid of FAMS.order) {
      const opts = seed.families[fid].options;
      if (!WITH_TOP.includes(fid)) { assert.ok(!('top' in opts), `${fid} must have no top plate cell`); continue; }
      assert.deepEqual(Object.keys(opts.top), ['1.2'], `${fid}: only the 1.2 mm cell — the standard top is the zero point`);
      const c = opts.top['1.2'];
      assert.equal(c.flat, null, `${fid}: the 1.2 mm cell must be BLANK`);
      assert.equal(c.perW100, null);
      assert.equal(c.confidence, 'blank');
      assert.ok(seed.families[fid].table.some((r) => r.group === 'top' && r.value === '1.2' && r.status === 'blank' && r.label === 'Top plate: 1.2 mm'), `${fid}: the console table lists it once, blank`);
      assert.equal(seed.families[fid].table.filter((r) => r.group === 'top').length, 1);
    }
  });

  it('the note tells Finance what to enter: the standard is now 1.5 mm (16 ga), the list price is read as the 1.5 mm price, and the figure is a NEGATIVE amount or 0', () => {
    const note = cellOf(derive(), 'sink', 'top', '1.2').derivation;
    assert.match(note, /The standard top is now 1\.5 mm \(16 ga\)/);
    assert.match(note, /the base item's list price is read as the 1\.5 mm price/);
    assert.match(note, /Enter what a 1\.2 mm top takes OFF \(a negative amount\), or 0 if it should cost the same\./);
    assert.ok(!/BA-001/.test(note), 'with no evidence in the master the note carries no cross-reference');
    assert.equal(cellOf(derive(), 'prep_table', 'top', '1.2').derivation, note, 'the same instruction on all three families');
    assert.equal(cellOf(derive(), 'stove', 'top', '1.2').derivation, note);
  });

  it('the master\'s BA-001 "Top Gauge" adder is quoted as a CROSS-REFERENCE in the note only — the cell stays BLANK, whatever the master says (before and after the options were renamed)', () => {
    for (const [light, heavy] of [['1.2mm (std)', '1.5mm heavy-duty'], ['1.2mm (lighter)', '1.5mm (16 ga, standard)']]) {
      const s = derive([topAdder(light, heavy, [0, 1234])]);
      for (const fid of WITH_TOP) {
        const c = cellOf(s, fid, 'top', '1.2');
        assert.equal(c.flat, null, `${fid}: never derived from the master's adder`);
        assert.equal(c.confidence, 'blank');
        assert.match(c.derivation, /For reference, the master's own "Top Gauge" adder on BA-001/);
        assert.ok(c.derivation.includes(`(${light} versus ${heavy})`), `${fid}: names the two options`);
        assert.match(c.derivation, /= -1,234; not used as the amount\./, `${fid}: the master's signed figure for the lighter top versus the heavier one`);
      }
    }
    // an adder that does not fit the pair (other labels, no adders, not numbers) adds nothing to the note
    for (const odd of [topAdder('1.2mm (std)', 'Heavy', [0, 1234]), prod('BA-001', { specs: [spec('Top Gauge', ['1.2mm (std)', '1.5mm heavy-duty'], '1.2mm (std)', undefined)] }), topAdder('1.2mm (std)', '1.5mm heavy-duty', [0, 'x'])]) {
      const c = cellOf(derive([odd]), 'sink', 'top', '1.2');
      assert.equal(c.flat, null); assert.ok(!/BA-001/.test(c.derivation));
    }
  });

  it('the seed still prices nothing it should not: a 1.2 mm top with the blank cell is "priced after review" naming "Top plate: 1.2 mm", and the standard top prices from the base item alone', () => {
    const seed = derive();
    const byId = new Map(PRIMARIES().map((p) => [p.id, p]));
    for (const fid of WITH_TOP) {
      const fam = FAMS.families[fid];
      const sheet = { approved: true, schemaVersion: FAMS.version, options: Object.fromEntries(Object.entries(seed.families[fid].options).map(([g, vs]) => [g, Object.fromEntries(Object.entries(vs).map(([v, c]) => [v, { flat: c.flat, perW100: c.perW100 }]))])), size: { perW100: seed.families[fid].size.perW100 } };
      const price = (cfg) => PC.priceConfiguredItem(byId.get(fam.primary), fam, cfg, PF.defaultDims(fam), sheet, {}, { schemaVersion: FAMS.version });
      const std = price(PF.defaultConfig(fam));
      assert.equal(std.priced, true, fid); assert.deepEqual(std.deltas, []);
      const light = price({ ...PF.defaultConfig(fam), top: 1.2 });
      assert.equal(light.priced, false, fid); assert.equal(light.reason, 'missing_input'); assert.deepEqual(light.missing, ['Top plate: 1.2 mm']);
      // once Finance types a negative amount the line prices, exactly that much lower
      const typed = { ...sheet, options: { ...sheet.options, top: { 1.2: { flat: -777, perW100: null } } } };
      const cheaper = PC.priceConfiguredItem(byId.get(fam.primary), fam, { ...PF.defaultConfig(fam), top: 1.2 }, PF.defaultDims(fam), typed, {}, { schemaVersion: FAMS.version });
      assert.equal(cheaper.unitPrice, std.unitPrice - 777, fid);
    }
  });

  it('the absorbed-SKU check prices each absorbed model at the STANDARD top plate (they never state one): a priced primary is "ok", not "cannot be checked: blank cells (Top plate)"', () => {
    const seed = derive();
    for (const [fid, sku] of [['prep_table', 'PW-001'], ['sink', 'PW-004'], ['stove', 'CE-001']]) {
      const row = seed.families[fid].absorbedCheck.find((r) => r.sku === sku);
      assert.ok(row, `${fid}/${sku}`);
      assert.equal(row.flag, 'ok', `${fid}/${sku}: ${row.flag}`);
      assert.equal(row.familyEstimateVsList, 1);
    }
  });
});

describe('derive-family-pricing — nothing private reaches the repository, the console or the wrong place', () => {
  const src = read('scripts/derive-family-pricing.js');

  it('the SOURCE holds no peso amount, no currency symbol and no long number: SKU ids, spec labels and rules only', () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.ok(!/₱|PHP\s*\d|\bP\s?\d{3,}/.test(src), 'a currency marker crept into the script');
    assert.ok(!/\d{1,3}(?:,\d{3})+/.test(src), 'a thousands-separated number crept into the script');
    assert.ok(!/(?<![\w.])\d{4,}(?![\w])/.test(code), 'a 4+ digit literal crept into the script');
  });
  it('the output path is gitignored (the file holds prices and this repository is public) and the script never writes next to the source', () => {
    const gi = read('.gitignore').split('\n').map((l) => l.trim());
    assert.ok(gi.includes('/private/'), '.gitignore must ignore /private/');
    assert.ok(gi.includes('products-database.json'), '.gitignore must keep ignoring the private master');
    assert.match(src, /path\.join\(REPO_ROOT, 'private', 'family-pricing\.seed\.json'\)/);
    assert.ok((src.match(/writeFileSync\(/g) || []).length === 1, 'exactly one file is written');
    assert.match(src, /fs\.writeFileSync\(outPath,/);
  });
  it('the script never reaches Firestore: no firebase, no admin SDK, no network', () => {
    assert.ok(!/require\(['"](?:firebase|firebase-admin|https?|node-fetch)/.test(src));
    assert.ok(!/\bfetch\(|XMLHttpRequest|firestore\(\)|initializeApp/.test(src));
  });
  it('the console prints statuses and confidence only: no table row, no line of output interpolates an amount', () => {
    const logs = src.split('\n').filter((l) => /console\.(log|error)/.test(l)).join('\n');
    assert.ok(!/\.flat|perW100|\bfmt\(|toLocaleString/.test(logs), 'a console line prints an amount');
  });
  it('is plain CommonJS that parses', () => {
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, 'scripts/derive-family-pricing.js')]);
    assert.equal(r.status, 0, String(r.stderr));
  });
});

describe('derive-family-pricing — the command line, run against a fake master with every published SKU', () => {
  // A master that satisfies the same checks the real one does (every published SKU present, the primaries in the right pricing form), with fake prices.
  const cats = JSON.parse(read('scripts/public-categories.json'));
  const fam = JSON.parse(read('scripts/public-families.json'));
  const perLength = new Set(Object.values(fam.families).filter((f) => f.sizeBasis !== 'linear').map((f) => f.primary));
  const all = [...Object.keys(cats.products), ...Object.keys(cats.excludedProducts)];
  const products = all.map((id, i) => {
    const base = 1001 + (i * 37) % 997;
    if (perLength.has(id)) return { id, title: 'Synthetic ' + id, category: 'prep_washing', unit: 'pc', basePrice: base + 4000, formulaType: 'per_length', measurement: { W: 900, D: 600, H: 850 }, formula: { baseLengthMm: 900, pricePerExtraMm: 2.5, rateW100: 0, rateD100: 0, rateH100: 0 }, specs: [] };
    return { id, title: 'Synthetic ' + id, category: 'prep_washing', unit: 'pc', basePrice: base, formulaType: 'fixed', measurement: { W: 900, D: 600, H: 850 }, formula: {}, specs: [] };
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'derive-fam-'));
  const masterFile = path.join(dir, 'fake-master.json');
  fs.writeFileSync(masterFile, JSON.stringify({ products, constants: {} }));
  const outFile = path.join(dir, 'out', 'seed.json');
  const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/derive-family-pricing.js'), ...args], { cwd: dir, encoding: 'utf8' });

  it('writes the seed ONLY to the --out path, exits 0, and its console shows no amount', () => {
    const before = fs.existsSync(path.join(ROOT, 'private', 'family-pricing.seed.json')) ? fs.statSync(path.join(ROOT, 'private', 'family-pricing.seed.json')).mtimeMs : null;
    const r = run(masterFile, '--out', outFile);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(outFile));
    const seed = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    assert.equal(seed.kind, 'barro-family-pricing-seed');
    assert.deepEqual(Object.keys(seed.families), FAMS.order);
    assertFinite(seed, 'seed');
    // the console: statuses and confidence only
    assert.ok(!/₱/.test(r.stdout), 'a currency symbol was printed');
    assert.ok(!/\d{1,3}(?:,\d{3})+/.test(r.stdout), 'a thousands-separated figure was printed');
    for (const fid of FAMS.order) assert.match(r.stdout, new RegExp(fid));
    assert.match(r.stdout, /Nothing was written to Firestore/);
    // the real private seed (if any) was left alone by this run
    const after = fs.existsSync(path.join(ROOT, 'private', 'family-pricing.seed.json')) ? fs.statSync(path.join(ROOT, 'private', 'family-pricing.seed.json')).mtimeMs : null;
    assert.equal(after, before, 'the run with --out must not touch the default output');
  });
  it('every published SKU of the fake master is classified exactly once by the families it ran against (the same completeness rule as the build)', () => {
    const ids = products.map((p) => p.id);
    const pub = B.loadPublicCategories({ ids });
    const published = B.publishedProductIds({ products }, pub);
    assert.doesNotThrow(() => B.loadPublicFamilies({ published, master: { products } }));
  });
  it('the seed may only be written outside the repository or inside its gitignored private/ folder: a tracked path is REFUSED before anything is read or written', () => {
    for (const bad of ['scripts/family-pricing.seed.json', 'docs/seed.json', 'js/seed.json', 'family-pricing.seed.json', 'private-not/seed.json', 'privatex.json']) {
      const out = path.join(ROOT, bad);
      const r = run(masterFile, '--out', out);
      assert.notEqual(r.status, 0, bad);
      assert.match(r.stderr, /refusing to write the private seed/, bad);
      assert.ok(!fs.existsSync(out), `${bad} must not be created`);
    }
  });
  it('a master that is not valid JSON stops without echoing any of its text (the file holds prices)', () => {
    const f = path.join(dir, 'broken-master.json');
    fs.writeFileSync(f, '{ "products": [ { "id": "PW-001", "basePrice": 98765, ');
    const r = run(f, '--out', path.join(dir, 'broken-out.json'));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /broken-master\.json is not valid JSON/);
    assert.ok(!/98765|basePrice|PW-001/.test(r.stdout + r.stderr), 'a fragment of the master was echoed');
    assert.ok(!fs.existsSync(path.join(dir, 'broken-out.json')));
  });
  it('a master that does not exist stops with a clear message and a non-zero exit — and writes nothing', () => {
    const missing = path.join(dir, 'no-such-master.json');
    const r = run(missing, '--out', path.join(dir, 'never.json'));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not found/);
    assert.ok(!fs.existsSync(path.join(dir, 'never.json')));
  });
  it('a master whose primary changed pricing form (a length-priced primary that is no longer length-priced) refuses with the build\'s own message', () => {
    const bad = products.map((p) => (p.id === 'PW-001' ? Object.assign({}, p, { formulaType: 'fixed', formula: {} }) : p));
    const f = path.join(dir, 'bad-master.json');
    fs.writeFileSync(f, JSON.stringify({ products: bad, constants: {} }));
    const r = run(f, '--out', path.join(dir, 'bad-out.json'));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no length rule of its own/);
    assert.ok(!fs.existsSync(path.join(dir, 'bad-out.json')));
  });
});

describe('derive-family-pricing — (local only) the real private master', { skip: (() => { try { return fs.existsSync(path.join(ROOT, 'products-database.json')) ? false : 'the private master (products-database.json) is not present'; } catch (_) { return 'no master'; } })() }, () => {
  it('derives without error, covers every cell, and the output stays private (a temp path, never printed)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'derive-real-'));
    const out = path.join(dir, 'seed.json');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/derive-family-pricing.js'), path.join(ROOT, 'products-database.json'), '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!/₱/.test(r.stdout) && !/\d{1,3}(?:,\d{3})+/.test(r.stdout), 'the console printed an amount');
    const seed = JSON.parse(fs.readFileSync(out, 'utf8'));
    for (const fid of FAMS.order) {
      const expected = PF.cells(FAMS.families[fid]).filter((c) => !c.baseline).length;
      const got = Object.values(seed.families[fid].options).reduce((n, g) => n + Object.keys(g).length, 0);
      assert.equal(got, expected, fid);
    }
    assertFinite(seed, 'seed');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
