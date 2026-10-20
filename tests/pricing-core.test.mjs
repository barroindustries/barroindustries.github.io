// tests/pricing-core.test.mjs — PUBLIC-QUOTE-REQUEST-SPEC.md §7.6 (WS-0): the MONEY tests for js/pricing-core.js
// (and, by byte-compare, its functions/ mirror).
//
// js/pricing-core.js sits under the js/money-core.js contract: pure, pinned, mutation-tested. Everything here
// uses SYNTHETIC products and made-up round numbers — the repo is PUBLIC and the real price master is private, so
// no real product figure may ever appear in a fixture.
//
// What is pinned:
//   1. priceCatalogItem — every formulaType, every quirk of the Quote Builder's computePrice() it replaced
//      (D/H surcharge only ABOVE default, missing-rate warning text, multiplier BEFORE adders, round + clamp).
//   2. validateSelection — every rule in spec §4.3 (keys, step, bounds, runs, specs, defaults).
//   3. estimateRange / estimateGate — the ruled table (R2 / O3), incl. an exact rational-arithmetic sweep.
//   4. PARITY with the old builder: tests/fixtures/legacy-computePrice.txt is the old computePrice() VERBATIM
//      (a frozen oracle). A seeded sweep of thousands of synthetic selections must give the identical price and the
//      identical warning sentence.
//   5. the functions/ mirror is byte-identical (ci-invariants CHECK 10 enforces the same).
//
// Mutation-tested (scratch copy of js/pricing-core.js, never the shared tree) — each of these must fail >= 1 test:
//   flip `>` to `>=` in the D/H surcharge · drop Math.max(0, …) · apply the multiplier AFTER the adders ·
//   change lowFactor to 0.95 (in qr-def) · make `ceil` a `round` · let a size below minDimMm pass.
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
const P = require('../js/pricing-core.js');
const QR = require('../js/qr-def.js');
const { priceCatalogItem, validateSelection, estimateRange, estimateGate } = P;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIMITS = QR.LIMITS;
const EST = QR.ESTIMATE;

// ── synthetic fixtures (round, made-up numbers) ─────────────────────────────
const perLength = (over) => ({
  id: 'T-PL', formulaType: 'per_length', basePrice: 1000, unit: 'pc',
  defaultDimensions: { W: 1200, D: 600, H: 800 },
  formula: { baseLengthMm: 1200, pricePerExtraMm: 2, rateW100: 50, rateD100: 30, rateH100: 0 },
  specs: [], ...over,
});
const perAreaP = (over) => ({ id: 'T-PA', formulaType: 'per_area', basePrice: 0, unit: 'sqm', defaultDimensions: { W: 1000, H: 1000 }, formula: { pricePerSqm: 400 }, specs: [], ...over });
const perRunP = (over) => ({ id: 'T-PR', formulaType: 'per_run', basePrice: 500, unit: 'run', defaultDimensions: {}, formula: { pricePerRun: 250 }, specs: [], ...over });
const fixedP = (over) => ({ id: 'T-FX', formulaType: 'fixed', basePrice: 777, unit: 'pc', defaultDimensions: { W: 900, D: 700, H: 850 }, formula: {}, specs: [], ...over });
const configP = (over) => ({ id: 'T-CF', formulaType: 'configurable', basePrice: 2000, unit: 'pc', defaultDimensions: { W: 800, D: 600 }, formula: {}, specs: [], ...over });
const SPECS = [
  { label: 'Basin Depth', options: ['250mm', '300mm', '350mm'], default: '300mm', priceAdder: [-100, 0, 150] },
  { label: 'Faucet', options: ['Single', 'Gooseneck'], default: 'Single', priceAdder: [0, 60] },
];
const sel = (dims, extra) => ({ dims: dims || {}, runs: null, specIdx: [], ...(extra || {}) });

describe('priceCatalogItem — per_length', () => {
  it('a product with NO D/H rates at its default size raises no warning (the surcharge only reads a dimension ABOVE default)', () => {
    const p = perLength({ formula: { baseLengthMm: 1200, pricePerExtraMm: 2 } });
    const r = priceCatalogItem(p, sel({ W: 1200, D: 600, H: 800 }), {});
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.missingRateLabels, []);
    assert.equal(r.unitPrice, 1000);
  });

  it('default size prices at basePrice (+ nothing)', () => {
    const r = priceCatalogItem(perLength(), sel({ W: 1200, D: 600, H: 800 }), {});
    assert.equal(r.unitPrice, 1000);
    assert.equal(r.priced, true);
    assert.equal(r.sizeAdjusted, false);
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.missingRateLabels, []);
  });

  it('an absent W falls back to the product default, then to 900', () => {
    assert.equal(priceCatalogItem(perLength(), sel({}), {}).unitPrice, 1000);                        // dd.W = 1200 = baseLengthMm
    const noDD = perLength({ defaultDimensions: {}, formula: { baseLengthMm: 900, pricePerExtraMm: 2 } });
    assert.equal(priceCatalogItem(noDD, sel({}), {}).unitPrice, 1000);                               // 900 default, base 900
  });

  it('+300 mm of length adds 300 x pricePerExtraMm', () => {
    const r = priceCatalogItem(perLength(), sel({ W: 1500, D: 600, H: 800 }), {});
    assert.equal(r.unitPrice, 1000 + 300 * 2);
    assert.equal(r.sizeAdjusted, true);
  });

  it('a length BELOW the base length never discounts (Math.max(0, W - base))', () => {
    assert.equal(priceCatalogItem(perLength(), sel({ W: 600, D: 600, H: 800 }), {}).unitPrice, 1000);
  });

  it('baseLengthMm defaults to 900 and pricePerExtraMm to 0 when absent', () => {
    const p = perLength({ formula: {} });
    assert.equal(priceCatalogItem(p, sel({ W: 1500 }), {}).unitPrice, 1000);                         // ppm 0
    const q = perLength({ formula: { pricePerExtraMm: 2 } });
    assert.equal(priceCatalogItem(q, sel({ W: 1500 }), {}).unitPrice, 1000 + 600 * 2);               // base 900
  });

  it('D above default WITH a rate adds ((D - default)/100) x rateD100', () => {
    const r = priceCatalogItem(perLength(), sel({ W: 1200, D: 900, H: 800 }), {});
    assert.equal(r.unitPrice, 1000 + (300 / 100) * 30);
    assert.deepEqual(r.warnings, []);
  });

  it('D above default WITHOUT a rate: price unchanged, warning names Width, missingRateLabels set', () => {
    const p = perLength({ formula: { baseLengthMm: 1200, pricePerExtraMm: 2 } });                   // no rateD100 / rateH100
    const r = priceCatalogItem(p, sel({ W: 1200, D: 900, H: 800 }), {});
    assert.equal(r.unitPrice, 1000);
    assert.deepEqual(r.missingRateLabels, ['Width']);
    assert.deepEqual(r.warnings, ['No rate on file for custom Width — priced at default size for Width.']);
  });

  it('H above default without a rate -> Height; both -> "Width / Height" and "Width/Height" (the builder\'s exact sentence)', () => {
    const p = perLength({ formula: { baseLengthMm: 1200, pricePerExtraMm: 2 } });
    assert.deepEqual(priceCatalogItem(p, sel({ W: 1200, D: 600, H: 1000 }), {}).warnings, ['No rate on file for custom Height — priced at default size for Height.']);
    const both = priceCatalogItem(p, sel({ W: 1200, D: 900, H: 1000 }), {});
    assert.deepEqual(both.missingRateLabels, ['Width', 'Height']);
    assert.equal(both.warnings.join(' '), 'No rate on file for custom Width / Height — priced at default size for Width/Height.');
  });

  it('a rate of 0 is a real "this dimension does not affect price": no surcharge, NO warning', () => {
    const r = priceCatalogItem(perLength(), sel({ W: 1200, D: 600, H: 1600 }), {});                // rateH100 = 0
    assert.equal(r.unitPrice, 1000);
    assert.deepEqual(r.warnings, []);
  });

  it('D / H BELOW default never discount (pinned quirk) and the boundary D === default adds nothing', () => {
    assert.equal(priceCatalogItem(perLength(), sel({ W: 1200, D: 300, H: 400 }), {}).unitPrice, 1000);
    assert.equal(priceCatalogItem(perLength(), sel({ W: 1200, D: 600, H: 800 }), {}).unitPrice, 1000);
    // one mm... one step above the default DOES charge
    assert.equal(priceCatalogItem(perLength(), sel({ W: 1200, D: 610, H: 800 }), {}).unitPrice, Math.round(1000 + (10 / 100) * 30));
  });

  it('D / H surcharges need the input to be shown: a dims object without D does not price D', () => {
    const r = priceCatalogItem(perLength(), sel({ W: 1500 }), {});
    assert.equal(r.unitPrice, 1000 + 600);
    assert.deepEqual(r.warnings, []);
  });

  it('a per_length product with NO formula object is priced at basePrice (the builder skipped the branch)', () => {
    assert.equal(priceCatalogItem(perLength({ formula: null }), sel({ W: 3000 }), {}).unitPrice, 1000);
  });
});

describe('priceCatalogItem — per_area, per_run, fixed, configurable', () => {
  it('per_area = (W x H / 1e6) x pricePerSqm, ignoring basePrice', () => {
    assert.equal(priceCatalogItem(perAreaP(), sel({ W: 2000, H: 1500 }), {}).unitPrice, 3 * 400);
    assert.equal(priceCatalogItem(perAreaP({ basePrice: 99999 }), sel({ W: 1000, H: 1000 }), {}).unitPrice, 400);
    assert.equal(priceCatalogItem(perAreaP(), sel({}), {}).unitPrice, 400);                          // absent -> default 1000 x 1000
  });

  it('per_run = (pricePerRun || basePrice) x runs; runs absent -> 1', () => {
    assert.equal(priceCatalogItem(perRunP(), sel({}, { runs: 4 }), {}).unitPrice, 1000);
    assert.equal(priceCatalogItem(perRunP({ formula: {} }), sel({}, { runs: 3 }), {}).unitPrice, 1500);          // falls back to basePrice
    assert.equal(priceCatalogItem(perRunP(), sel({}, { runs: null }), {}).unitPrice, 250);
    assert.equal(priceCatalogItem(perRunP(), sel({}, { runs: 0 }), {}).unitPrice, 250);                          // runs||1
  });

  it('fixed with custom dims: the PRICE does not change, sizeAdjusted is true', () => {
    const r = priceCatalogItem(fixedP(), sel({ W: 1500, D: 700, H: 850 }), {});
    assert.equal(r.unitPrice, 777);
    assert.equal(r.sizeAdjusted, true);
    assert.equal(priceCatalogItem(fixedP(), sel({ W: 900, D: 700, H: 850 }), {}).sizeAdjusted, false);
  });

  it('configurable prices at basePrice', () => {
    assert.equal(priceCatalogItem(configP(), sel({ W: 800, D: 600 }), {}).unitPrice, 2000);
  });

  it('an unknown formulaType prices at basePrice (never throws)', () => {
    assert.equal(priceCatalogItem({ formulaType: 'mystery', basePrice: 321, specs: [] }, sel({}), {}).unitPrice, 321);
  });
});

describe('priceCatalogItem — multiplier, adders, rounding', () => {
  const withSpecs = (o) => fixedP({ specs: SPECS, ...(o || {}) });

  it('the material-price-index multiplier applies to the formula price BEFORE the adders (pinned order)', () => {
    // 777 x 2 = 1554, THEN + 150 = 1704 (adders are NOT doubled). Multiplying after would give (777 + 150) x 2 = 1854.
    const r = priceCatalogItem(withSpecs(), sel({}, { specIdx: [2, 0] }), { materialPriceIndexMultiplier: 2 });
    assert.equal(r.unitPrice, 1704);
  });

  it('the multiplier defaults to 1 when absent, 0, or falsy', () => {
    for (const c of [{}, { materialPriceIndexMultiplier: 0 }, null, undefined, { materialPriceIndexMultiplier: null }]) {
      assert.equal(priceCatalogItem(fixedP(), sel({}), c).unitPrice, 777);
    }
  });

  it('adders are picked by option INDEX; a negative adder subtracts; an absent selection adds nothing', () => {
    assert.equal(priceCatalogItem(withSpecs(), sel({}, { specIdx: [0, 0] }), {}).unitPrice, 777 - 100);
    assert.equal(priceCatalogItem(withSpecs(), sel({}, { specIdx: [1, 1] }), {}).unitPrice, 777 + 0 + 60);
    assert.equal(priceCatalogItem(withSpecs(), sel({}, { specIdx: [2, 1] }), {}).unitPrice, 777 + 150 + 60);
    assert.equal(priceCatalogItem(withSpecs(), sel({}, { specIdx: [] }), {}).unitPrice, 777);                     // no selects -> no adders
    assert.equal(priceCatalogItem(withSpecs(), sel({}, { specIdx: [null, 1] }), {}).unitPrice, 777 + 60);         // first select absent
  });

  it('an out-of-range, negative, fractional or non-numeric option index adds nothing (never an array property)', () => {
    for (const bad of [9, -1, 1.5, 'length', NaN, Infinity]) {
      assert.equal(priceCatalogItem(withSpecs(), sel({}, { specIdx: [bad, bad] }), {}).unitPrice, 777, String(bad));
    }
  });

  it('result = max(0, round(price)): rounds half UP, clamps a negative to 0, and basePrice 0 is "not priced"', () => {
    assert.equal(priceCatalogItem(fixedP({ basePrice: 100.5 }), sel({}), {}).unitPrice, 101);
    assert.equal(priceCatalogItem(fixedP({ basePrice: 100.4 }), sel({}), {}).unitPrice, 100);
    const neg = priceCatalogItem(fixedP({ basePrice: 50, specs: [{ label: 'X', options: ['a'], default: 'a', priceAdder: [-500] }] }), sel({}, { specIdx: [0] }), {});
    assert.equal(neg.unitPrice, 0);
    assert.equal(neg.priced, false);
    const zero = priceCatalogItem(fixedP({ basePrice: 0 }), sel({}), {});
    assert.equal(zero.unitPrice, 0);
    assert.equal(zero.priced, false);
  });

  it('rounding happens once, at the end (the multiplier and per-mm rates keep their fractions)', () => {
    // 1000 x 1.07 = 1070, + 0.4 adder -> 1070.4 -> 1070
    const p = fixedP({ basePrice: 1000, specs: [{ label: 'X', options: ['a'], default: 'a', priceAdder: [0.4] }] });
    assert.equal(priceCatalogItem(p, sel({}, { specIdx: [0] }), { materialPriceIndexMultiplier: 1.07 }).unitPrice, 1070);
  });

  it('a corrupt product doc is 0 / unpriced, never NaN or Infinity (the one deliberate difference from the old builder)', () => {
    for (const bad of [undefined, null, NaN, 'abc', Infinity]) {
      const r = priceCatalogItem({ formulaType: 'per_length', basePrice: bad, defaultDimensions: { W: 1000 }, formula: { baseLengthMm: 900, pricePerExtraMm: 1 }, specs: [] }, sel({ W: 1000 }), {});
      assert.ok(Number.isFinite(r.unitPrice) && r.unitPrice >= 0, String(bad));
    }
    assert.equal(priceCatalogItem({ formulaType: 'per_length', basePrice: undefined, formula: {}, specs: [] }, sel({}), {}).priced, false);
  });

  it('never mutates its inputs', () => {
    const p = perLength({ specs: SPECS });
    const s = sel({ W: 1500, D: 900, H: 800 }, { specIdx: [2, 1] });
    const before = JSON.stringify([p, s]);
    priceCatalogItem(p, s, { materialPriceIndexMultiplier: 1.07 });
    assert.equal(JSON.stringify([p, s]), before);
  });

  it('tolerates missing arguments', () => {
    assert.equal(priceCatalogItem(null, null, null).unitPrice, 0);
    assert.equal(priceCatalogItem(undefined).priced, false);
  });
});

describe('validateSelection — spec §4.3 items row', () => {
  const v = (p, raw) => validateSelection(p, raw, LIMITS);

  it('omitted size / specs resolve to the defaults and mark nothing custom', () => {
    const r = v(perLength({ specs: SPECS }), {});
    assert.equal(r.ok, true, r.errors.join('|'));
    assert.deepEqual(r.sel.dims, { W: 1200, D: 600, H: 800 });
    assert.deepEqual(r.sel.specIdx, [1, 0]);                                        // 'Basin Depth' default 300mm = index 1; 'Faucet' default Single = 0
    assert.deepEqual(r.specs, [{ label: 'Basin Depth', value: '300mm' }, { label: 'Faucet', value: 'Single' }]);
    assert.equal(r.sizeCustom, false);
    assert.equal(r.sel.runs, null);
  });

  it('accepts a custom size in range and flags it custom', () => {
    const r = v(perLength(), { size: { W: 1500, D: 700, H: 800 } });
    assert.equal(r.ok, true);
    assert.deepEqual(r.sel.dims, { W: 1500, D: 700, H: 800 });
    assert.equal(r.sizeCustom, true);
  });

  it('a partial size fills the other dimensions with their defaults', () => {
    const r = v(perLength(), { size: { W: 1500 } });
    assert.equal(r.ok, true);
    assert.deepEqual(r.sel.dims, { W: 1500, D: 600, H: 800 });
  });

  it('size keys are only the keys the product has a finite positive default for (fixed / configurable)', () => {
    const noD = fixedP({ defaultDimensions: { W: 900, H: 850 } });
    assert.equal(v(noD, { size: { D: 700 } }).ok, false);
    assert.equal(v(noD, { size: { W: 1000 } }).ok, true);
    const none = fixedP({ defaultDimensions: {} });
    assert.equal(v(none, { size: { W: 1000 } }).ok, false);
    assert.deepEqual(v(none, {}).sel.dims, {});
    assert.equal(v(fixedP({ defaultDimensions: { W: 0, D: -5, H: null } }), { size: { W: 100 } }).ok, false);
  });

  it('an unknown / prototype key is an error, not a silent drop', () => {
    assert.equal(v(perLength(), { size: { X: 100 } }).ok, false);
    assert.equal(v(perLength(), JSON.parse('{"size":{"__proto__":100}}')).ok, false);
  });

  it('per_area exposes W and H only, with the builder\'s 1000 fallback default', () => {
    const r = v(perAreaP({ defaultDimensions: {} }), {});
    assert.deepEqual(r.sel.dims, { W: 1000, H: 1000 });
    assert.equal(v(perAreaP(), { size: { D: 500 } }).ok, false);
    assert.equal(v(perAreaP(), { size: { W: 2000, H: 1500 } }).ok, true);
  });

  it('per_run exposes no size and REQUIRES runs (integer 1..maxRuns)', () => {
    assert.equal(v(perRunP(), {}).ok, false);                                       // runs missing
    assert.equal(v(perRunP(), { runs: 4 }).ok, true);
    assert.deepEqual(v(perRunP(), { runs: 4 }).sel, { dims: {}, runs: 4, specIdx: [] });
    for (const bad of [0, -1, 1.5, LIMITS.maxRuns + 1, '3', null, NaN]) assert.equal(v(perRunP(), { runs: bad }).ok, false, String(bad));
    assert.equal(v(perRunP(), { runs: LIMITS.maxRuns }).ok, true);
    assert.equal(v(perRunP(), { runs: 2, size: { W: 100 } }).ok, false);
  });

  it('any other product must NOT carry runs', () => {
    assert.equal(v(fixedP(), { runs: 2 }).ok, false);
    assert.equal(v(fixedP(), { runs: null }).ok, true);
  });

  it('every dimension must be a whole number, a multiple of dimStepMm, >= minDimMm and <= min(default x maxDimFactor, abs cap)', () => {
    const p = fixedP({ defaultDimensions: { W: 900, D: 700, H: 850 } });
    for (const bad of [95, 99, 1005, 1000.5, '1000', NaN, Infinity, -1000, 0, 2701, 6001]) {
      assert.equal(v(p, { size: { W: bad } }).ok, false, `W=${bad}`);
    }
    assert.equal(v(p, { size: { W: 100 } }).ok, true);                              // minimum
    assert.equal(v(p, { size: { W: 2700 } }).ok, true);                             // 900 x 3 = 2700 (< 6000 abs cap)
    assert.equal(v(p, { size: { W: 2710 } }).ok, false);
    assert.equal(v(p, { size: { D: 2100 } }).ok, true);                             // 700 x 3
    assert.equal(v(p, { size: { D: 2110 } }).ok, false);
  });

  it('the absolute cap wins over default x factor', () => {
    const big = fixedP({ defaultDimensions: { W: 4000, D: 2000, H: 2000 } });
    assert.equal(v(big, { size: { W: 6000 } }).ok, true);
    assert.equal(v(big, { size: { W: 6010 } }).ok, false);                          // 12000 by factor, 6000 abs
    assert.equal(v(big, { size: { D: 3000 } }).ok, true);
    assert.equal(v(big, { size: { D: 3010 } }).ok, false);
  });

  it('a default ABOVE the absolute cap can only shrink: the largest custom size is the default itself (never below it)', () => {
    // real catalogue shape: a standard 6,858 mm length / 3,454 mm width / 3,500 mm height all exceed the caps (6000 / 3000 / 3000)
    const p = perLength({ defaultDimensions: { W: 6858, D: 3454, H: 3500 }, formula: { baseLengthMm: 6858, pricePerExtraMm: 1, rateD100: 10, rateH100: 10 } });
    assert.equal(v(p, { size: { W: 6858, D: 3454, H: 3500 } }).ok, true);          // the default is always acceptable
    assert.equal(v(p, { size: { W: 6850 } }).ok, true);                             // just under the default: valid (it used to be refused: > the 6000 cap)
    assert.equal(v(p, { size: { W: 6860 } }).ok, false);                            // above the default: refused
    assert.equal(v(p, { size: { W: 6000 } }).ok, true);
    assert.equal(v(p, { size: { D: 3450 } }).ok, true);
    assert.equal(v(p, { size: { D: 3460 } }).ok, false);
    assert.equal(v(p, { size: { H: 3490 } }).ok, true);
    assert.equal(v(p, { size: { H: 3510 } }).ok, false);
    assert.equal(v(p, { size: { H: 100 } }).ok, true);
  });

  it('a default so small that no custom size can exist makes that dimension FIXED, with a clear message (never "between 100 and 90")', () => {
    const p = fixedP({ defaultDimensions: { W: 900, D: 700, H: 30 } });
    assert.equal(v(p, { size: { H: 30 } }).ok, true);                               // the standard value is still accepted
    assert.equal(v(p, { size: { H: 30 } }).sizeCustom, false);
    for (const bad of [20, 40, 90, 100, 300]) {
      const r = v(p, { size: { H: bad } });
      assert.equal(r.ok, false, `H=${bad}`);
      assert.ok(r.errors.some((e) => /fixed for this item/.test(e)), r.errors.join(' | '));
      assert.ok(!r.errors.some((e) => /between 100 and 90/.test(e)));
    }
    assert.equal(v(p, { size: { W: 1000 } }).ok, true);                             // the other dimensions stay customisable
    const edge = fixedP({ defaultDimensions: { W: 34 } });                          // 34 x 3 = 102 -> only 100 is possible
    assert.equal(v(edge, { size: { W: 100 } }).ok, true);
    assert.equal(v(edge, { size: { W: 110 } }).ok, false);
    const none = fixedP({ defaultDimensions: { W: 33 } });                          // 33 x 3 = 99 < 100 -> fixed
    assert.equal(v(none, { size: { W: 100 } }).ok, false);
  });

  it('a size BELOW minDimMm is refused, but the product\'s own default is always acceptable even when it breaks the step/min rules', () => {
    assert.equal(v(fixedP(), { size: { W: 90 } }).ok, false);
    const odd = fixedP({ defaultDimensions: { W: 475, D: 60 } });
    assert.equal(v(odd, { size: { W: 475, D: 60 } }).ok, true);
    assert.equal(v(odd, { size: { W: 475, D: 60 } }).sizeCustom, false);
  });

  it('specs resolve by label and value; a missing spec takes the product default; default absent -> first option', () => {
    const p = fixedP({ specs: [...SPECS, { label: 'Finish', options: ['A', 'B'], priceAdder: [0, 0] }] });                // no default on Finish
    const r = v(p, { specs: [{ label: 'Faucet', value: 'Gooseneck' }] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.sel.specIdx, [1, 1, 0]);
    assert.deepEqual(r.specs, [{ label: 'Basin Depth', value: '300mm' }, { label: 'Faucet', value: 'Gooseneck' }, { label: 'Finish', value: 'A' }]);
  });

  it('an unknown label, an unknown value, a duplicated label and a malformed entry are errors', () => {
    const p = fixedP({ specs: SPECS });
    assert.equal(v(p, { specs: [{ label: 'Nope', value: 'x' }] }).ok, false);
    assert.equal(v(p, { specs: [{ label: 'Faucet', value: 'Chrome' }] }).ok, false);
    assert.equal(v(p, { specs: [{ label: 'Faucet', value: 'Single' }, { label: 'Faucet', value: 'Gooseneck' }] }).ok, false);
    assert.equal(v(p, { specs: [{ label: 'Faucet' }] }).ok, false);
    assert.equal(v(p, { specs: 'Faucet' }).ok, false);
    assert.equal(v(p, { specs: [null] }).ok, false);
  });

  it('a product with no specs ignores a clean empty list but still refuses an unknown spec', () => {
    assert.equal(v(fixedP(), { specs: [] }).ok, true);
    assert.equal(v(fixedP(), { specs: [{ label: 'X', value: 'y' }] }).ok, false);
  });

  it('size must be an object (or null/absent)', () => {
    assert.equal(v(fixedP(), { size: 'big' }).ok, false);
    assert.equal(v(fixedP(), { size: [900] }).ok, false);
    assert.equal(v(fixedP(), { size: null }).ok, true);
  });

  it('refuses (fail closed) when LIMITS are not provided', () => {
    assert.equal(validateSelection(fixedP(), {}, undefined).ok, false);
    assert.equal(validateSelection(fixedP(), {}, null).ok, false);
  });

  it('validateSelection output feeds priceCatalogItem directly', () => {
    const p = perLength({ specs: SPECS });
    const r = v(p, { size: { W: 1500, D: 900, H: 800 }, specs: [{ label: 'Basin Depth', value: '350mm' }, { label: 'Faucet', value: 'Gooseneck' }] });
    assert.equal(r.ok, true);
    const price = priceCatalogItem(p, r.sel, {});
    assert.equal(price.unitPrice, 1000 + 600 + 90 + 150 + 60);
  });
});

describe('estimateRange — the ruled table (R2)', () => {
  it('exact <= 0 (or not a number) -> {0, 0, first step}', () => {
    assert.deepEqual(estimateRange(0, EST), { low: 0, high: 0, step: 5000 });
    assert.deepEqual(estimateRange(-5, EST), { low: 0, high: 0, step: 5000 });
    assert.deepEqual(estimateRange(NaN, EST), { low: 0, high: 0, step: 5000 });
    assert.deepEqual(estimateRange(undefined, EST), { low: 0, high: 0, step: 5000 });
  });

  it('84,120 -> {75,000 .. 100,000} at the 5,000 step (0.90 x 84,120 = 75,708; 1.15 x = 96,738)', () => {
    assert.deepEqual(estimateRange(84120, EST), { low: 75000, high: 100000, step: 5000 });
  });

  it('step boundaries: 499,999 -> 5,000 · 500,000 -> 10,000 · 4,999,999 -> 10,000 · 5,000,000 -> 50,000', () => {
    assert.equal(estimateRange(499999, EST).step, 5000);
    assert.deepEqual(estimateRange(500000, EST), { low: 450000, high: 580000, step: 10000 });
    assert.equal(estimateRange(4999999, EST).step, 10000);
    assert.deepEqual(estimateRange(5000000, EST), { low: 4500000, high: 5750000, step: 50000 });
  });

  it('high === low can never happen: an exact of 1 -> {0, 5,000}', () => {
    assert.deepEqual(estimateRange(1, EST), { low: 0, high: 5000, step: 5000 });
    for (let e = 1; e < 20000; e += 7) { const r = estimateRange(e, EST); assert.ok(r.high > r.low, `exact ${e}`); }
  });

  it('low <= 0.90 x exact and high >= 1.15 x exact, both multiples of the step, always', () => {
    for (let e = 1; e <= 8000000; e += Math.ceil(e / 11) + 137) {
      const r = estimateRange(e, EST);
      assert.equal(r.low % r.step, 0);
      assert.equal(r.high % r.step, 0);
      assert.ok(r.low <= e * 0.9 + 1e-6, `low ${r.low} vs ${e}`);
      assert.ok(r.high >= e * 1.15 - 1e-6, `high ${r.high} vs ${e}`);
      assert.ok(r.low >= e * 0.9 - r.step, `low is more than a step under 0.90 x ${e}`);
      assert.ok(r.high <= e * 1.15 + r.step, `high is more than a step over 1.15 x ${e}`);
    }
  });

  it('EXACT rational check (9/10 and 23/20 in BigInt) over a dense integer sweep — floating point never costs a whole step', () => {
    const stepOf = (e) => (e < 500000n ? 5000n : e < 5000000n ? 10000n : 50000n);
    const fl = (a, b) => a / b;
    const ce = (a, b) => (a + b - 1n) / b;
    const check = (e) => {
      const s = stepOf(e);
      const low = fl(e * 9n, 10n * s) * s;
      let high = ce(e * 23n, 20n * s) * s;
      if (high <= low) high = low + s;
      const r = estimateRange(Number(e), EST);
      assert.equal(BigInt(r.low), low, `low @ ${e}`);
      assert.equal(BigInt(r.high), high, `high @ ${e}`);
    };
    for (let e = 1n; e <= 4000n; e++) check(e);
    for (let e = 10000n; e <= 9000000n; e += 9973n) check(e);
    for (const base of [5000n, 10000n, 50000n, 500000n, 5000000n, 50000000n]) for (let k = -6n; k <= 6n; k++) if (base + k > 0n) check(base + k);
    // every exact multiple of the step that lands precisely on a boundary of 9/10 or 23/20
    for (let k = 1n; k <= 600n; k++) { check(k * 5000n * 10n / 9n); check(k * 5000n * 20n / 23n); }
  });

  it('is monotonic: a larger basket never lowers either end of the range', () => {
    let prev = estimateRange(1, EST);
    for (let e = 2; e < 600000; e += 331) {
      const r = estimateRange(e, EST);
      assert.ok(r.low >= prev.low && r.high >= prev.high, `not monotonic at ${e}`);
      prev = r;
    }
  });

  it('uses the factors it is given (no hard-coded 0.90 / 1.15)', () => {
    const cfg = { ...EST, lowFactor: 0.5, highFactor: 2 };
    assert.deepEqual(estimateRange(10000, cfg), { low: 5000, high: 20000, step: 5000 });
  });

  it('floating-point noise never costs a whole step when the owner changes a factor (50,000 x 1.1 / 5,000 is 11.000000000000002 in IEEE)', () => {
    // These pairs slip a step WITHOUT the epsilon (found by brute force against BigInt rational arithmetic).
    assert.deepEqual(estimateRange(50000, { ...EST, highFactor: 1.1 }), { low: 45000, high: 55000, step: 5000 });
    assert.equal(estimateRange(1400000, { ...EST, highFactor: 1.35 }).high, 1890000);
    assert.equal(estimateRange(100000, { ...EST, lowFactor: 1.15 }).low, 115000);
  });

  it('high === low is bumped one step (reachable only if a factor pair collapses the range)', () => {
    assert.deepEqual(estimateRange(10000, { ...EST, lowFactor: 1, highFactor: 1 }), { low: 10000, high: 15000, step: 5000 });
  });
});

describe('estimateGate — O3', () => {
  it('shown iff >= 2 distinct priced products OR exact >= 50,000', () => {
    assert.deepEqual(estimateGate({ distinctPriced: 1, exact: 49999 }, EST), { shown: false, reason: 'gate' });
    assert.deepEqual(estimateGate({ distinctPriced: 1, exact: 50000 }, EST), { shown: true, reason: null });
    assert.deepEqual(estimateGate({ distinctPriced: 2, exact: 10000 }, EST), { shown: true, reason: null });
    assert.deepEqual(estimateGate({ distinctPriced: 0, exact: 0 }, EST), { shown: false, reason: 'gate' });
  });

  it('two LINES of the same product are ONE distinct product (so the gate holds unless the total is >= 50,000)', () => {
    assert.equal(estimateGate({ distinctPriced: 1, exact: 20000 }, EST).shown, false);
    assert.equal(estimateGate({ distinctPriced: 1, exact: 60000 }, EST).shown, true);
  });

  it('reads its thresholds from cfg', () => {
    assert.equal(estimateGate({ distinctPriced: 3, exact: 1 }, { ...EST, minDistinct: 4 }).shown, false);
    assert.equal(estimateGate({ distinctPriced: 1, exact: 99 }, { ...EST, minExact: 99 }).shown, true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  PARITY with the old Quote Builder computePrice() — the frozen oracle.
// ═════════════════════════════════════════════════════════════════════════════
const legacySrc = fs.readFileSync(path.join(ROOT, 'tests/fixtures/legacy-computePrice.txt'), 'utf8');

function runLegacy(p, dimsMm, runsVal, specIdx, constants, opts) {
  const ctx = {
    DB: { constants },
    dimsMm, runsVal, calcPriceWarning: '',
    document: { getElementById: (id) => {
      const m = /^spec_(\d+)$/.exec(id);
      if (!m) return null;
      if (opts && opts.noSelects) return null;
      const v = specIdx[Number(m[1])];
      return v == null ? null : { value: String(v) };
    } },
  };
  vm.createContext(ctx);
  vm.runInContext(legacySrc, ctx);
  const price = ctx.computePrice(p);
  return { price, warning: ctx.calcPriceWarning };
}

// mulberry32 — a tiny deterministic PRNG so the sweep is reproducible (never Math.random in a pinned test)
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function randomProduct(r, i) {
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const formulaType = pick(['fixed', 'fixed', 'per_length', 'per_length', 'per_length', 'per_area', 'per_run', 'configurable']);
  const dd = {};
  const maybe = (k, lo) => { if (r() < 0.8) dd[k] = lo + 10 * Math.floor(r() * 150); };
  maybe('W', 300); maybe('D', 300); maybe('H', 300);
  if (formulaType === 'per_length' && dd.W == null) dd.W = 600 + 10 * Math.floor(r() * 100);
  const num = (lo, hi, dp) => Number((lo + r() * (hi - lo)).toFixed(dp));
  const formula = {};
  if (r() < 0.9) formula.baseLengthMm = pick([600, 900, 1000, 1200, dd.W || 900]);
  if (r() < 0.9) formula.pricePerExtraMm = num(0, 6, 2);
  if (r() < 0.6) formula.rateD100 = pick([0, num(5, 90, 1)]);
  if (r() < 0.6) formula.rateH100 = pick([0, num(5, 90, 1)]);
  if (r() < 0.6) formula.pricePerSqm = num(100, 900, 2);
  if (r() < 0.6) formula.pricePerRun = num(100, 900, 2);
  const specs = [];
  const nSpecs = Math.floor(r() * 4);
  for (let s = 0; s < nSpecs; s++) {
    const nOpt = 1 + Math.floor(r() * 4);
    const options = Array.from({ length: nOpt }, (_, k) => `opt${s}-${k}`);
    const adders = options.map(() => pick([0, 0, num(-200, 400, 0), num(-50, 90, 1)]));
    specs.push({ label: `Spec ${s}`, options, default: pick(options), ...(r() < 0.9 ? { priceAdder: adders } : {}) });
  }
  return {
    id: `P-${i}`, formulaType, basePrice: pick([0, num(100, 5000, 0), num(100, 5000, 2), 1000]),
    defaultDimensions: dd, formula: r() < 0.95 ? formula : null, specs, unit: 'pc',
  };
}

function randomSelection(r, p) {
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const dd = p.defaultDimensions;
  // exactly the dims the builder's buildCalcPanel() would seed for this product (then a user edit on top)
  const dimsMm = {};
  const edit = (def) => pick([def, def, def + 10 * (1 + Math.floor(r() * 120)), Math.max(10, def - 10 * (1 + Math.floor(r() * 30)))]);
  if (p.formulaType === 'per_length') {
    dimsMm.W = edit(dd.W || 900);
    if (dd.D) dimsMm.D = edit(dd.D);
    if (dd.H) dimsMm.H = edit(dd.H);
  } else if (p.formulaType === 'per_area') {
    dimsMm.W = edit(dd.W || 1000);
    dimsMm.H = edit(dd.H || 1000);
  } else if (p.formulaType !== 'per_run') {
    ['W', 'D', 'H'].forEach((k) => { if (dd[k]) dimsMm[k] = edit(dd[k]); });
  }
  const runsVal = pick([1, 1, 2, 5, 20, NaN]);
  const specIdx = p.specs.map((s) => Math.floor(r() * s.options.length));
  const constants = pick([{}, { materialPriceIndexMultiplier: 1 }, { materialPriceIndexMultiplier: 1.07 }, { materialPriceIndexMultiplier: 0.93 }, { materialPriceIndexMultiplier: 0 }, { materialPriceIndexMultiplier: 1.0375 }]);
  return { dimsMm, runsVal, specIdx, constants };
}

describe('PARITY with the old Quote Builder computePrice() (frozen oracle: tests/fixtures/legacy-computePrice.txt)', () => {
  it('the oracle is the old function (sanity: it defines computePrice and reads DB / dimsMm / runsVal / spec_ selects)', () => {
    assert.match(legacySrc, /function computePrice\(p\)\{/);
    assert.match(legacySrc, /materialPriceIndexMultiplier/);
    assert.match(legacySrc, /document\.getElementById\(`spec_\$\{i\}`\)/);
    assert.match(legacySrc, /No rate on file for custom/);
  });

  it('6,000 seeded synthetic products x selections: identical unit price AND identical warning sentence', () => {
    const r = rng(20261021);
    let withWarning = 0, withSpecs = 0, surcharged = 0;
    for (let i = 0; i < 6000; i++) {
      const p = randomProduct(r, i);
      const s = randomSelection(r, p);
      const legacy = runLegacy(p, s.dimsMm, s.runsVal, s.specIdx, s.constants);
      const mine = priceCatalogItem(p, { dims: s.dimsMm, runs: s.runsVal, specIdx: s.specIdx }, s.constants);
      // a corrupt synthetic product (basePrice 0 with a formula etc.) can legitimately be NaN in the OLD function
      if (Number.isNaN(legacy.price)) { assert.equal(mine.unitPrice, 0, `NaN case #${i}`); continue; }
      assert.equal(mine.unitPrice, legacy.price, `price mismatch #${i} ${JSON.stringify([p, s])}`);
      assert.equal(mine.warnings.join(' '), legacy.warning, `warning mismatch #${i}`);
      if (legacy.warning) withWarning++;
      if (p.specs.length) withSpecs++;
      if (p.formulaType === 'per_length' && legacy.price > p.basePrice) surcharged++;
    }
    // the sweep must actually exercise the interesting branches, or it proves nothing
    assert.ok(withWarning > 100, `only ${withWarning} warning cases`);
    assert.ok(withSpecs > 1000, `only ${withSpecs} spec cases`);
    assert.ok(surcharged > 300, `only ${surcharged} surcharged cases`);
  });

  it('an absent spec <select> adds no adder in BOTH implementations (specIdx entry null)', () => {
    const r = rng(7);
    for (let i = 0; i < 800; i++) {
      const p = randomProduct(r, i);
      if (!p.specs.length) continue;
      const s = randomSelection(r, p);
      const legacy = runLegacy(p, s.dimsMm, s.runsVal, s.specIdx, s.constants, { noSelects: true });
      const mine = priceCatalogItem(p, { dims: s.dimsMm, runs: s.runsVal, specIdx: p.specs.map(() => null) }, s.constants);
      if (Number.isNaN(legacy.price)) continue;
      assert.equal(mine.unitPrice, legacy.price, `#${i}`);
    }
  });

  it('validateSelection -> priceCatalogItem equals the old function for every VALID random selection', () => {
    const r = rng(99);
    let checked = 0;
    for (let i = 0; i < 4000 && checked < 1500; i++) {
      const p = randomProduct(r, i);
      const s = randomSelection(r, p);
      // build the raw payload a visitor would send for the same selection
      const raw = { size: null, runs: p.formulaType === 'per_run' ? 1 + Math.floor(r() * 20) : null, specs: p.specs.map((sp, k) => ({ label: sp.label, value: sp.options[s.specIdx[k]] })) };
      if (p.formulaType !== 'per_run' && Object.keys(s.dimsMm).length) raw.size = { ...s.dimsMm };
      const val = validateSelection(p, raw, LIMITS);
      if (!val.ok) continue;
      checked++;
      const legacy = runLegacy(p, val.sel.dims, val.sel.runs, val.sel.specIdx, s.constants);
      const mine = priceCatalogItem(p, val.sel, s.constants);
      if (Number.isNaN(legacy.price)) continue;
      assert.equal(mine.unitPrice, legacy.price, `#${i}`);
      assert.equal(mine.warnings.join(' '), legacy.warning, `#${i}`);
    }
    assert.ok(checked > 500, `only ${checked} valid selections were exercised`);
  });
});

describe('the functions/ mirrors', () => {
  const same = (a, b) => assert.ok(fs.readFileSync(path.join(ROOT, a)).equals(fs.readFileSync(path.join(ROOT, b))), `${b} is not byte-identical to ${a} — edit ${a}, then: cp ${a} ${b}`);
  it('functions/pricing-core.js is byte-identical to js/pricing-core.js', () => same('js/pricing-core.js', 'functions/pricing-core.js'));
  it('functions/qr-def.js is byte-identical to js/qr-def.js', () => same('js/qr-def.js', 'functions/qr-def.js'));
  it('the functions copy loads under Node and exports the same four functions', () => {
    const F = require('../functions/pricing-core.js');
    assert.deepEqual(Object.keys(F).sort(), ['estimateGate', 'estimateRange', 'priceCatalogItem', 'validateSelection']);
  });
  it('loading pricing-core under Node does NOT create a window global (it would change how libraries in the Cloud Functions process behave)', () => {
    const out = vm.runInNewContext("var module={exports:{}}; (function(){ " + fs.readFileSync(path.join(ROOT, 'js/pricing-core.js'), 'utf8') + "\n})(); typeof window", {});
    assert.equal(out, 'undefined');
  });
  it('in a browser it attaches window.priceCatalogItem / validateSelection / estimateRange / estimateGate', () => {
    const win = {};
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/pricing-core.js'), 'utf8'), { window: win });
    for (const k of ['priceCatalogItem', 'validateSelection', 'estimateRange', 'estimateGate']) assert.equal(typeof win[k], 'function', k);
  });
});

describe('qr-def.js — the ruled values (R2, R3, O1–O3)', () => {
  it('ESTIMATE carries the ruled numbers', () => {
    assert.equal(EST.lowFactor, 0.9);
    assert.equal(EST.highFactor, 1.15);
    assert.deepEqual(EST.steps.map((s) => [s.below, s.step]), [[500000, 5000], [5000000, 10000], [Infinity, 50000]]);
    assert.equal(EST.minDistinct, 2);
    assert.equal(EST.minExact, 50000);
    assert.equal(EST.vatBasis, 'exclusive');
    assert.equal(EST.deliveryIncluded, false);
  });
  it('R3: the disclaimer is the fixed sentence', () => {
    assert.equal(QR.COPY.estimateDisclaimer, 'Estimate only — your final quotation is prepared after our team reviews your list, sizes and site.');
  });
  it('LIMITS match spec §4.2', () => {
    assert.equal(LIMITS.maxItems, 40); assert.equal(LIMITS.maxQtyPerLine, 20); assert.equal(LIMITS.maxQtyPerProduct, 20); assert.equal(LIMITS.maxNote, 240);
    assert.equal(LIMITS.minDimMm, 100); assert.equal(LIMITS.dimStepMm, 10); assert.equal(LIMITS.maxDimFactor, 3);
    assert.deepEqual(LIMITS.maxDimAbsMm, { W: 6000, D: 3000, H: 3000 });
    assert.equal(LIMITS.maxRuns, 20); assert.equal(LIMITS.maxPayloadBytes, 60000); assert.equal(LIMITS.minFillMs, 20000);
  });
  it('a pricing figure never appears in the definitions that ship to the public page', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/qr-def.js'), 'utf8');
    assert.ok(!/basePrice|priceAdder|pricePer|rateW100|rateD100|rateH100|formulaType/.test(src));
  });
});
