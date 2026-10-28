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
//   6. PRODUCT FAMILIES (owner ruling 2026-10-21): normalisePricingDoc + priceConfiguredItem — a configured price = the primary SKU
//      through the UNCHANGED machinery + signed option deltas from a private sheet; an unapproved sheet / a stale schema / a BLANK cell
//      is "priced after review" (never zero, never a partial figure); an option equal to the family default adds nothing (identity).
//   6b. THE STAFF-ONLY STEEL GRADE AS A PERCENTAGE (owner ruling 2026-10-28, specs/GRADE-PERCENT-SPEC.md, schema 5, the last describe blocks): a `choice` group declared "pricing": "percent" — the
//      `grade` group of all eleven real definitions, and no other — holds ONE signed `pct` cell instead of { flat, perW100 } (normalisePricingDoc emits { pct } and nothing else; a pct
//      beyond +/-1000 or a schema-4 { flat, perW100 } cell is BLANK). SS304 is the zero point (no cell read, no delta); SS316 adds pct % of the WHOLE line price = the base at the requested size
//      + every other option's delta + the linear family's length delta, as an UNROUNDED delta `grade:316`, the ONE rounding being the final one; several percent groups ADD, never compound;
//      a blank pct is "missing input" naming "Material: Stainless Steel 316 Laboratory Grade" (never zero); a schema-4 approved sheet is "not approved". FAKE percentages only (12.5, 37, 0, -10 …:
//      the repository is public, the owner's figure is private data). The public path (every line a visitor can build is SS304) is proved byte-identical to the schema-4 module by
//      tests/grade-percent-parity.test.mjs.
//   7. REGRESSION: the four original exports are pinned by the SHA-256 of their source (taken before the families were added), on top of
//      the frozen-oracle parity sweep above, so adding the configured price provably changed nothing about SKU pricing or the Quote Builder.
//
// Mutation-tested (scratch copy of js/pricing-core.js, never the shared tree) — each of these must fail >= 1 test:
//   flip `>` to `>=` in the D/H surcharge · drop Math.max(0, …) · apply the multiplier AFTER the adders ·
//   change lowFactor to 0.95 (in qr-def) · make `ceil` a `round` · let a size below minDimMm pass ·
//   (families) read a blank cell as 0 · price an unapproved sheet · skip the schema-version check · charge the chosen value instead of
//   chosen-minus-default · drop the baseline subtraction for slots · let perW100 charge below the standard length (non-linear family) ·
//   flip the sign of the linear length rate · stop clamping the total at 0 · edit any of the four original functions.
//   2026-10-28 (the SS316 percentage; 20 mutants of js/pricing-core.js in a scratch copy, its functions/ mirror patched identically, the whole suite run for each — EVERY ONE killed, by this file, by tests/grade-percent-parity,
//   qb-configured, family-staff, derive-family-pricing and quote-builder-static): M1 the pct taken of the base price only instead of the subtotal · M2 the pct amount doubled (stands in for "applied after the quantity":
//   the qty-2 builder / computeBasket tests in qb-configured.test.mjs fail too) · M3 the percent pass skipped (316 priced as 304) · M4 a blank pct read as 0 · M5 the percentage applied when the chosen value IS the default ·
//   M6 applied twice (a: the total multiplied as well as the delta added, b: the delta pushed twice, c: the amount added to the total twice) · M7 the percent pass placed BEFORE the linear length delta · M8 the pct read
//   from `flat` (a schema-4 cell prices) · M9 two percent groups compounding instead of adding · M10 the amount rounded before the final round · M11 the +/-1000 cap removed · and seven more: X1 the percent branch of
//   normalisePricingDoc dropped · X2 percent groups not skipped in the ordinary loop (the 316 cell also priced as a flat) · X3 the cap exclusive (exactly 1000 blank) · X4 the sign dropped · X5 the missing label without the
//   option name · X6 a multi group with a "pricing" flag treated as a percent group · X7 the percentage taken of the FINAL price (S / (1 - pct)) instead of the subtotal.
//
// Run with: node --test tests/*.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
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
  it('functions/product-families.js and functions/qr-families.js are byte-identical to their js/ originals', () => {
    same('js/product-families.js', 'functions/product-families.js');
    same('js/qr-families.js', 'functions/qr-families.js');
  });
  it('the functions copy loads under Node and exports the four original functions plus the two additive family functions', () => {
    const F = require('../functions/pricing-core.js');
    assert.deepEqual(Object.keys(F).sort(), ['estimateGate', 'estimateRange', 'normalisePricingDoc', 'priceCatalogItem', 'priceConfiguredItem', 'validateSelection']);
  });
  it('loading pricing-core under Node does NOT create a window global (it would change how libraries in the Cloud Functions process behave)', () => {
    const out = vm.runInNewContext("var module={exports:{}}; (function(){ " + fs.readFileSync(path.join(ROOT, 'js/pricing-core.js'), 'utf8') + "\n})(); typeof window", {});
    assert.equal(out, 'undefined');
  });
  it('in a browser it attaches window.priceCatalogItem / validateSelection / estimateRange / estimateGate / priceConfiguredItem / normalisePricingDoc', () => {
    const win = {};
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/pricing-core.js'), 'utf8'), { window: win });
    for (const k of ['priceCatalogItem', 'validateSelection', 'estimateRange', 'estimateGate', 'priceConfiguredItem', 'normalisePricingDoc']) assert.equal(typeof win[k], 'function', k);
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


// ═══════════════════════════════════════════════════════════════════════════
//  PRODUCT FAMILIES — the configured price. SYNTHETIC family, product and sheet (made-up round numbers): the real sheet is private.
// ═══════════════════════════════════════════════════════════════════════════
const { priceConfiguredItem, normalisePricingDoc } = P;
const syn = () => ({
  id: 'syn', label: 'Synthetic', category: 'preparation', unit: 'pc', primary: 'S-P', sizeBasis: 'primary',
  dims: { W: { label: 'Length', min: 500, max: 4000, step: 10, default: 900 }, D: { label: 'Width', min: 400, max: 1200, step: 10, default: 600 }, H: { label: 'Height', min: 600, max: 1100, step: 10, default: 850 } },
  groups: [
    { key: 'layers', label: 'Layers', type: 'choice', default: 1, options: [{ v: 1, l: '1' }, { v: 2, l: '2' }, { v: 3, l: '3' }] },
    { key: 'wheels', label: 'Wheels', type: 'choice', default: false, options: [{ v: true, l: 'With' }, { v: false, l: 'Without' }] },
    { key: 'kind', label: 'Kind', type: 'choice', default: 'a', options: [{ v: 'a', l: 'A' }, { v: 'b', l: 'B' }] },
    { key: 'burners', label: 'Burners', type: 'slots', minSlots: 1, maxSlots: 4, default: ['lp'], options: [{ v: 'lp', l: 'LP', f: 'Low pressure' }, { v: 'wok', l: 'Wok', f: 'Wok burner' }, { v: 'hp', l: 'HP', f: 'High pressure' }] },
    { key: 'addons', label: 'Add-ons', type: 'multi', default: [], options: [{ v: 'oven', l: 'Oven' }, { v: 'fryer', l: 'Fryer' }] },
  ],
});
const FAM = syn();
const PRIMARY = perLength({ id: 'S-P', basePrice: 1000, defaultDimensions: { W: 900, D: 600, H: 850 }, formula: { baseLengthMm: 900, pricePerExtraMm: 2, rateD100: 30, rateH100: 0 } });
const STD = { layers: 1, wheels: false, kind: 'a', burners: ['lp'], addons: [] };
const DIMS = { W: 900, D: 600, H: 850 };
const SHEET = (over) => ({
  approved: true, schemaVersion: 1,
  options: {
    layers: { 2: { flat: 100, perW100: 10 }, 3: { flat: 250, perW100: 20 } },
    wheels: { true: { flat: 40, perW100: null } },
    kind: { b: { flat: -30, perW100: null } },
    burners: { lp: { flat: 300, perW100: null }, wok: { flat: 500, perW100: null }, hp: { flat: 450, perW100: null } },
    addons: { oven: { flat: 700, perW100: null }, fryer: { flat: 900, perW100: null } },
  },
  size: { perW100: null }, ...(over || {}),
});
const OPT = { schemaVersion: 1 };
const priceIt = (cfg, dims, sheet, fam, prod) => priceConfiguredItem(prod || PRIMARY, fam || FAM, { ...STD, ...cfg }, dims || DIMS, sheet === undefined ? SHEET() : sheet, {}, OPT);
const baseOf = (dims) => priceCatalogItem(PRIMARY, { dims, runs: null, specIdx: [] }, {}).unitPrice;

describe('normalisePricingDoc — a staff-written Firestore doc is sanitised before it is ever used', () => {
  it('keeps only the groups and values the family defines, as { flat, perW100 } numbers (blank = null)', () => {
    const d = normalisePricingDoc(FAM, SHEET());
    assert.equal(d.approved, true);
    assert.equal(d.schemaVersion, 1);
    assert.deepEqual(d.options.layers, { 1: { flat: null, perW100: null }, 2: { flat: 100, perW100: 10 }, 3: { flat: 250, perW100: 20 } });
    assert.deepEqual(d.options.wheels, { true: { flat: 40, perW100: null }, false: { flat: null, perW100: null } });
    assert.deepEqual(Object.keys(d.options).sort(), ['addons', 'burners', 'kind', 'layers', 'wheels']);
    assert.deepEqual(d.size, { perW100: null });
  });
  it('drops unknown groups / values and never throws on junk', () => {
    const d = normalisePricingDoc(FAM, { approved: true, schemaVersion: 1, options: { nope: { x: { flat: 1 } }, layers: { 9: { flat: 5 }, 2: { flat: 7 } } } });
    assert.equal(d.options.nope, undefined);
    assert.equal(d.options.layers[9], undefined);
    assert.equal(d.options.layers[2].flat, 7);
    for (const junk of [null, undefined, 5, 'x', [], { options: 7 }, { options: [] }, { options: { layers: 'x' } }, { options: { layers: { 2: 'x' } } }]) assert.doesNotThrow(() => normalisePricingDoc(FAM, junk), JSON.stringify(junk));
    assert.doesNotThrow(() => normalisePricingDoc(null, null));
  });
  it('a figure that is not a finite number within +/-1e8 is BLANK (null) — never a number: NaN, Infinity, strings, booleans, huge values', () => {
    const bad = [NaN, Infinity, -Infinity, '12', true, [], {}, 1e9, -1e9, null, undefined];
    for (const b of bad) assert.equal(normalisePricingDoc(FAM, { options: { layers: { 2: { flat: b, perW100: b } } } }).options.layers[2].flat, null, String(b));
    assert.equal(normalisePricingDoc(FAM, { options: { layers: { 2: { flat: 0 } } } }).options.layers[2].flat, 0);         // an explicit zero is a figure
    assert.equal(normalisePricingDoc(FAM, { options: { layers: { 2: { flat: -45.5 } } } }).options.layers[2].flat, -45.5);  // signed
  });
  it('approved is true ONLY for the boolean true; schemaVersion only for an integer', () => {
    for (const a of ['true', 1, 'yes', {}, [], null, undefined, false]) assert.equal(normalisePricingDoc(FAM, { approved: a }).approved, false, String(a));
    for (const v of ['1', 1.5, NaN, null, undefined, Infinity]) assert.equal(normalisePricingDoc(FAM, { schemaVersion: v }).schemaVersion, null, String(v));
    assert.equal(normalisePricingDoc(FAM, { schemaVersion: 3 }).schemaVersion, 3);
  });
  it('never mutates its input', () => {
    const raw = SHEET(); const snap = JSON.stringify(raw);
    normalisePricingDoc(FAM, raw);
    assert.equal(JSON.stringify(raw), snap);
  });
});

describe('priceConfiguredItem — IDENTITY: the family default at any size prices exactly as the primary SKU alone (G1)', () => {
  it('default configuration -> priceCatalogItem of the primary, at the default size and at custom sizes, whatever the sheet holds', () => {
    for (const dims of [DIMS, { W: 1500, D: 600, H: 850 }, { W: 900, D: 900, H: 850 }, { W: 700, D: 500, H: 700 }, { W: 4000, D: 1200, H: 1100 }]) {
      const want = baseOf(dims);
      for (const sheet of [SHEET(), SHEET({ options: {} }), { approved: true, schemaVersion: 1 }, SHEET({ options: { layers: { 2: { flat: 99999 } } } })]) {
        const r = priceIt({}, dims, sheet);
        assert.equal(r.unitPrice, want, JSON.stringify(dims));
        assert.equal(r.priced, true);
        assert.deepEqual(r.missing, []);
        assert.deepEqual(r.deltas, []);
        assert.equal(r.base, want);
      }
    }
  });
  it('the multiplier of productMeta (material price index) scales the primary exactly as it does for a plain SKU, and the option amounts are added AFTER it', () => {
    const c = { materialPriceIndexMultiplier: 1.07 };
    const dims = { W: 1200, D: 600, H: 850 };
    const plain = priceCatalogItem(PRIMARY, { dims, runs: null, specIdx: [] }, c).unitPrice;
    const r = priceConfiguredItem(PRIMARY, FAM, { ...STD, wheels: true }, dims, SHEET(), c, OPT);
    assert.equal(r.base, plain);
    assert.equal(r.unitPrice, plain + 40);
  });
  it('the primary\'s own option defaults are used (a spec adder at its default is in the base, exactly as a plain SKU prices)', () => {
    const withSpec = { ...PRIMARY, specs: [{ label: 'Finish', options: ['A', 'B'], default: 'B', priceAdder: [0, 75] }] };
    const want = priceCatalogItem(withSpec, { dims: DIMS, runs: null, specIdx: [1] }, {}).unitPrice;
    assert.equal(priceConfiguredItem(withSpec, FAM, STD, DIMS, SHEET(), {}, OPT).unitPrice, want);
  });
});

describe('priceConfiguredItem — option deltas (flat + perW100 x length beyond the standard), signed, additive', () => {
  it('a choice: the chosen value\'s amount, only when it differs from the family default; the default value needs no cell', () => {
    assert.equal(priceIt({ layers: 2 }).unitPrice, baseOf(DIMS) + 100);
    assert.equal(priceIt({ layers: 3 }).unitPrice, baseOf(DIMS) + 250);
    assert.equal(priceIt({ wheels: true }).unitPrice, baseOf(DIMS) + 40);
    assert.equal(priceIt({ kind: 'b' }).unitPrice, baseOf(DIMS) - 30);                                  // signed: cheaper
    const sheet = SHEET(); delete sheet.options.layers;                                                    // no cell at all for the DEFAULT value is fine
    assert.equal(priceIt({ layers: 1 }, DIMS, sheet).priced, true);
  });
  it('perW100 charges for length BEYOND the standard length only (a non-linear family never discounts below it), and a blank perW100 is none', () => {
    const wide = { W: 1500, D: 600, H: 850 };
    assert.equal(priceIt({ layers: 2 }, wide).unitPrice, baseOf(wide) + 100 + 10 * 6);                  // 600 mm beyond 900 = 6 x per-100
    assert.equal(priceIt({ layers: 3 }, wide).unitPrice, baseOf(wide) + 250 + 20 * 6);
    assert.equal(priceIt({ wheels: true }, wide).unitPrice, baseOf(wide) + 40);                         // wheels have no perW100
    const narrow = { W: 700, D: 600, H: 850 };
    assert.equal(priceIt({ layers: 2 }, narrow).unitPrice, baseOf(narrow) + 100);                       // shorter than standard: no length part, no discount
  });
  it('a multi group adds each selected add-on; the order of the selection does not matter', () => {
    assert.equal(priceIt({ addons: ['oven'] }).unitPrice, baseOf(DIMS) + 700);
    assert.equal(priceIt({ addons: ['oven', 'fryer'] }).unitPrice, baseOf(DIMS) + 1600);
    assert.equal(priceIt({ addons: ['fryer', 'oven'] }).unitPrice, baseOf(DIMS) + 1600);
  });
  it('slots: the cost of each chosen position minus the default positions (net counts) — the default layout is the zero point', () => {
    assert.equal(priceIt({ burners: ['lp'] }).unitPrice, baseOf(DIMS));
    assert.equal(priceIt({ burners: ['lp', 'lp'] }).unitPrice, baseOf(DIMS) + 300);                    // one more low-pressure position
    assert.equal(priceIt({ burners: ['wok'] }).unitPrice, baseOf(DIMS) + 500 - 300);                   // a wok REPLACES the default position
    assert.equal(priceIt({ burners: ['wok', 'wok', 'lp'] }).unitPrice, baseOf(DIMS) + 2 * 500);        // lp cancels the default; two woks added
    assert.equal(priceIt({ burners: ['hp', 'lp', 'wok', 'hp'] }).unitPrice, baseOf(DIMS) + 2 * 450 + 500);
    assert.equal(priceIt({ burners: ['lp', 'wok'] }).unitPrice, priceIt({ burners: ['wok', 'lp'] }).unitPrice, 'position ORDER is a layout, not a price');
  });
  it('several options add up, and every delta is listed for the staff view', () => {
    const r = priceIt({ layers: 2, wheels: true, addons: ['oven'], burners: ['lp', 'lp'] });
    assert.equal(r.unitPrice, baseOf(DIMS) + 100 + 40 + 700 + 300);
    assert.deepEqual(r.deltas.map((d) => d.key).sort(), ['addons:oven', 'burners:lp', 'layers:2', 'wheels:true']);
    assert.equal(r.deltas.reduce((n, d) => n + d.amount, 0), 100 + 40 + 700 + 300);
  });
  it('D / H beyond the primary default go through the primary\'s own surcharge rules (unchanged machinery), then the options', () => {
    const big = { W: 900, D: 900, H: 850 };
    assert.equal(priceIt({ layers: 2 }, big).unitPrice, baseOf(big) + 100);
    assert.ok(baseOf(big) > baseOf(DIMS));
  });
  it('rounds once at the end and clamps a negative total at 0', () => {
    const frac = SHEET({ options: { kind: { b: { flat: 0.4, perW100: null } } } });
    assert.equal(priceIt({ kind: 'b' }, DIMS, frac).unitPrice, baseOf(DIMS));                           // 1000.4 -> 1000
    const half = SHEET({ options: { kind: { b: { flat: 0.5, perW100: null } } } });
    assert.equal(priceIt({ kind: 'b' }, DIMS, half).unitPrice, baseOf(DIMS) + 1);                       // 1000.5 -> 1001 (half up)
    const huge = SHEET({ options: { kind: { b: { flat: -5000000, perW100: null } } } });
    const r = priceIt({ kind: 'b' }, DIMS, huge);
    assert.equal(r.unitPrice, 0);
    assert.equal(r.priced, false);
  });
});

describe('priceConfiguredItem — "priced after review": an unapproved sheet and a BLANK cell price NOTHING (G2/G3)', () => {
  it('a blank cell is never zero: the line is unpriced, unitPrice 0, and the missing option is NAMED', () => {
    const sheet = SHEET({ options: { layers: { 2: { flat: null, perW100: 10 } } } });
    const r = priceIt({ layers: 2 }, DIMS, sheet);
    assert.equal(r.priced, false);
    assert.equal(r.unitPrice, 0);
    assert.equal(r.reason, 'missing_input');
    assert.deepEqual(r.missing, ['Layers: 2']);
    // an explicit zero IS a figure
    const zero = priceIt({ layers: 2 }, DIMS, SHEET({ options: { layers: { 2: { flat: 0, perW100: null } } } }));
    assert.equal(zero.priced, true);
    assert.equal(zero.unitPrice, baseOf(DIMS));
  });
  it('an absent value, an absent group and an absent sheet entry are blank too; one blank among several unprices the whole line (no partial figure)', () => {
    assert.equal(priceIt({ layers: 3 }, DIMS, SHEET({ options: { layers: { 2: { flat: 1 } } } })).priced, false);
    assert.equal(priceIt({ wheels: true }, DIMS, SHEET({ options: {} })).priced, false);
    const mixed = priceIt({ layers: 2, kind: 'b', addons: ['oven', 'fryer'] }, DIMS, SHEET({ options: { layers: { 2: { flat: 100 } }, kind: { b: { flat: -30 } }, addons: { oven: { flat: 700 } } } }));
    assert.equal(mixed.priced, false);
    assert.equal(mixed.unitPrice, 0);
    assert.deepEqual(mixed.missing, ['Add-ons: Fryer']);
  });
  it('a slots group names the position type that has no cost; only net-nonzero types need a cell', () => {
    const noWok = SHEET(); noWok.options.burners.wok = { flat: null, perW100: null };
    assert.deepEqual(priceIt({ burners: ['wok'] }, DIMS, noWok).missing, ['Burners: Wok burner']);
    assert.equal(priceIt({ burners: ['lp', 'hp'] }, DIMS, noWok).priced, true);                         // no wok anywhere: not needed
    const noLp = SHEET(); noLp.options.burners.lp = { flat: null, perW100: null };
    assert.equal(priceIt({ burners: ['lp'] }, DIMS, noLp).priced, true);                                // the default layout needs nothing
    assert.equal(priceIt({ burners: ['wok'] }, DIMS, noLp).priced, false);                              // wok replaces lp: lp's cost is needed to net it out
  });
  it('no sheet / not approved / approved against another schema version / a non-boolean "approved" / no schema supplied by the caller -> not_approved, nothing priced', () => {
    for (const sheet of [null, undefined, {}, SHEET({ approved: false }), SHEET({ approved: 'true' }), SHEET({ approved: 1 }), SHEET({ schemaVersion: 2 }), SHEET({ schemaVersion: null })]) {
      const r = priceConfiguredItem(PRIMARY, FAM, STD, DIMS, sheet, {}, OPT);
      assert.equal(r.priced, false, JSON.stringify(sheet));
      assert.equal(r.unitPrice, 0);
      assert.equal(r.reason, 'not_approved');
    }
    assert.equal(priceConfiguredItem(PRIMARY, FAM, STD, DIMS, SHEET(), {}, {}).reason, 'not_approved', 'no schemaVersion from the caller fails CLOSED');
    assert.equal(priceConfiguredItem(PRIMARY, FAM, STD, DIMS, SHEET(), {}, undefined).reason, 'not_approved');
  });
  it('a primary SKU with no list price cannot be configured into a figure (no_base_price)', () => {
    const r = priceConfiguredItem({ ...PRIMARY, basePrice: 0 }, FAM, STD, DIMS, SHEET(), {}, OPT);
    assert.equal(r.priced, false);
    assert.equal(r.reason, 'no_base_price');
  });
  it('the size basis must STILL describe the primary: a linear family on a length-priced primary, or a non-linear family on a primary with no length rule, is left for review (size_basis)', () => {
    const fixedPrim = { id: 'S-F', formulaType: 'fixed', basePrice: 2000, unit: 'pc', defaultDimensions: { W: 2000, D: 600, H: 850 }, formula: {}, specs: [] };
    const a = priceConfiguredItem(PRIMARY, { ...FAM, sizeBasis: 'linear' }, STD, DIMS, SHEET({ size: { perW100: 100 } }), {}, OPT);       // linear, but the primary prices its own length
    assert.deepEqual([a.priced, a.reason, a.unitPrice], [false, 'size_basis', 0]);
    const b = priceConfiguredItem(fixedPrim, FAM, STD, DIMS, SHEET(), {}, OPT);                                                          // non-linear, but the primary has no length rule
    assert.deepEqual([b.priced, b.reason, b.unitPrice], [false, 'size_basis', 0]);
    assert.equal(priceConfiguredItem(PRIMARY, FAM, STD, DIMS, SHEET(), {}, OPT).priced, true, 'the consistent pairing prices');
    // the approval check still comes first
    assert.equal(priceConfiguredItem(fixedPrim, FAM, STD, DIMS, { ...SHEET(), approved: false }, {}, OPT).reason, 'not_approved');
  });
  it('a custom width or height the primary has NO RATE for is an unknown cost, not a free one: the line is left for review (priceCatalogItem alone would price the standard size and only warn)', () => {
    const noRate = { ...PRIMARY, formula: { baseLengthMm: 900, pricePerExtraMm: 2 } };                                                  // no rateD100 / rateH100
    const r = priceConfiguredItem(noRate, FAM, STD, { W: 900, D: 700, H: 900 }, SHEET(), {}, OPT);
    assert.equal(r.priced, false);
    assert.equal(r.reason, 'missing_input');
    assert.deepEqual(r.missing, ['Size (width)', 'Size (height)']);
    // shrinking never needed a rate, and the standard size is fine
    assert.equal(priceConfiguredItem(noRate, FAM, STD, { W: 900, D: 500, H: 800 }, SHEET(), {}, OPT).priced, true);
    assert.equal(priceConfiguredItem(noRate, FAM, STD, DIMS, SHEET(), {}, OPT).priced, true);
    // with the rates on file it prices as before (the plain path is unchanged: it still only warns)
    const plain = priceCatalogItem(noRate, { dims: { W: 900, D: 700, H: 900 }, runs: null, specIdx: [] }, {});
    assert.equal(plain.priced, true);
    assert.ok(plain.warnings.length >= 1);
  });
  it('a total that is not above zero is not a price (no_price), with no figure', () => {
    const neg = SHEET({ options: { ...SHEET().options, wheels: { true: { flat: -5000, perW100: null } } } });
    const r = priceConfiguredItem(PRIMARY, FAM, { ...STD, wheels: true }, DIMS, neg, {}, OPT);
    assert.deepEqual([r.priced, r.unitPrice, r.reason], [false, 0, 'no_price']);
  });
  it('sizeAdjusted says whether the size differs from the family default (informational)', () => {
    assert.equal(priceIt({}, DIMS).sizeAdjusted, false);
    assert.equal(priceIt({}, { ...DIMS, W: 1000 }).sizeAdjusted, true);
    assert.equal(priceConfiguredItem(PRIMARY, FAM, STD, DIMS, null, {}, OPT).sizeAdjusted, false);
  });
});

describe('priceConfiguredItem — a LINEAR family (the primary SKU has no length rule of its own)', () => {
  const lin = { ...syn(), sizeBasis: 'linear' };
  const fixedPrim = { id: 'S-F', formulaType: 'fixed', basePrice: 2000, unit: 'pc', defaultDimensions: { W: 2000, D: 480, H: 38 }, formula: {}, specs: [] };
  const linDims = { W: 1000, D: 600, H: 850 };                       // the synthetic family's own default width and height: only the LENGTH varies below
  const sheet = (size, over) => SHEET({ size: { perW100: size }, ...(over || {}) });
  const run = (cfg, dims, sh) => priceConfiguredItem(fixedPrim, lin, { ...STD, ...cfg }, dims, sh, {}, OPT);
  it('length is priced from the sheet, in BOTH directions from the standard length: base + perW100 x (W - standard) / 100', () => {
    assert.equal(run({}, { ...linDims, W: 2000 }, sheet(100)).unitPrice, 2000);                         // at the standard length: just the base
    assert.equal(run({}, { ...linDims, W: 1000 }, sheet(100)).unitPrice, 2000 - 1000);                  // shorter: cheaper
    assert.equal(run({}, { ...linDims, W: 3000 }, sheet(100)).unitPrice, 2000 + 1000);
  });
  it('a blank length rate unprices every line whose length is not the standard one — and names "Size"; the standard length needs no rate', () => {
    const r = run({}, { ...linDims, W: 1000 }, sheet(null));
    assert.equal(r.priced, false);
    assert.deepEqual(r.missing, ['Size']);
    assert.equal(run({}, { ...linDims, W: 2000 }, sheet(null)).priced, true);
  });
  it('an option\'s perW100 scales with length in BOTH directions here (so a shelf tier costs less on a shorter shelf)', () => {
    // 2 layers: flat 100 + 10 per 100 mm beyond/below the standard 2000 mm. At 1000 mm: 100 + 10 x (-10) = 0
    assert.equal(run({ layers: 2 }, { ...linDims, W: 1000 }, sheet(100)).unitPrice, 2000 - 1000 + 100 + 10 * -10);
    assert.equal(run({ layers: 2 }, { ...linDims, W: 3000 }, sheet(100)).unitPrice, 2000 + 1000 + 100 + 10 * 10);
  });
  it('a size other than the length that differs from the family default has NO price in a linear family\'s sheet, so the line is left for review ("Size (width)"), never priced as if it were free', () => {
    const r = run({}, { ...linDims, D: 610 }, sheet(100));
    assert.equal(r.priced, false);
    assert.equal(r.reason, 'missing_input');
    assert.deepEqual(r.missing, ['Size (width)']);
    assert.equal(r.unitPrice, 0);
    const both = run({}, { ...linDims, D: 700, H: 900 }, sheet(100));
    assert.deepEqual(both.missing, ['Size (width)', 'Size (height)']);
    // the standard width and height are fine, and so is any length
    assert.equal(run({}, { ...linDims, W: 2500 }, sheet(100)).priced, true);
  });
  it('a non-linear family never charges a length rate even if the sheet carries one', () => {
    const r = priceConfiguredItem(PRIMARY, FAM, STD, { W: 1500, D: 600, H: 850 }, SHEET({ size: { perW100: 99999 } }), {}, OPT);
    assert.equal(r.unitPrice, baseOf({ W: 1500, D: 600, H: 850 }));
  });
});

describe('priceConfiguredItem — robustness and purity', () => {
  it('never throws, whatever it is given, and never mutates its inputs', () => {
    for (const bad of [null, undefined, 5, 'x', [], {}]) {
      assert.doesNotThrow(() => priceConfiguredItem(bad, bad, bad, bad, bad, bad, bad));
      assert.equal(priceConfiguredItem(bad, bad, bad, bad, bad, bad, bad).priced, false);
    }
    const args = [structuredClone(PRIMARY), structuredClone(FAM), { ...STD, layers: 2 }, { ...DIMS }, SHEET(), { materialPriceIndexMultiplier: 1 }, { ...OPT }];
    const snap = JSON.stringify(args);
    priceConfiguredItem(...args);
    assert.equal(JSON.stringify(args), snap);
  });
  it('is deterministic: the same inputs give the same answer, field for field', () => {
    const a = priceIt({ layers: 3, burners: ['wok', 'hp'], addons: ['fryer'] }, { W: 1700, D: 700, H: 850 });
    const b = priceIt({ layers: 3, burners: ['wok', 'hp'], addons: ['fryer'] }, { W: 1700, D: 700, H: 850 });
    assert.deepEqual(a, b);
  });
});

describe('REGRESSION — adding the configured price changed NOTHING about SKU pricing (and so nothing about the Quote Builder)', () => {
  // The SHA-256 of the SOURCE of each original export, taken from js/pricing-core.js as it stood BEFORE the families were added. The parity
  // sweep above (frozen oracle of the old computePrice) proves the behaviour; this pins the bytes, so an edit to any of them — even a
  // behaviour-neutral one — is a conscious, re-pinned money change and never a side effect of the family work.
  const PINS = {
    priceCatalogItem: 'b061bfcd78405c49d79dabb4c0350f3a42fb3831beb8f42967932328565baaa5',
    validateSelection: '5dbb75aebac44e96afc9ffdf7b2eadcf9a48925dd9f8d5b83170f154cb18baa9',
    estimateRange: '2f5ee6821c9919a2c6cbc18a81d2a7581d78fb445a0a39858504a72ff763e164',
    estimateGate: '89c0db1041afea2fd1ace59c919016ed0d094711da49a5dbfbdc4ab4a132472d',
  };
  const src = fs.readFileSync(path.join(ROOT, 'js/pricing-core.js'), 'utf8');
  const grab = (name) => { const m = src.match(new RegExp('\\n  function ' + name + '\\([\\s\\S]*?\\n  }\\n')); assert.ok(m, `${name} not found`); return m[0]; };
  for (const name of Object.keys(PINS)) {
    it(`${name} is byte-identical to its pre-families source`, () => {
      assert.equal(crypto.createHash('sha256').update(grab(name)).digest('hex'), PINS[name]);
    });
  }
  it('the Quote Builder prices a catalogue SKU through priceCatalogItem only and never names the configured-price function or the sheet sanitiser; the one new thing it may mention is the product_pricing READ inside loadDatabase()', () => {
    // QUOTE-BUILDER-CONFIGURATOR-SPEC.md §2.3 (WS-2, 2026-10-28) consciously changed this guard. It used to forbid the builder from even NAMING
    // product_pricing. The builder now reads the family option sheets in loadDatabase(), in its own try/catch (a denied read degrades to
    // "Priced after review"), so staff can price a configured line live — and it prices through QBConfigured.priceLine, never by
    // re-implementing the math. So: still no priceConfiguredItem / normalisePricingDoc anywhere in the file (the math lives only in
    // js/pricing-core.js, behind qb-configured.js), and product_pricing may appear only inside loadDatabase(), in a try of its own
    // (PARTNER-REMOVAL-SPEC WS-E: the partner session this used to exclude is gone, so there is no branch any more).
    // tests/quote-builder-static.test.mjs pins the rest of the builder's behaviour.
    const qb = fs.readFileSync(path.join(ROOT, 'quote-builder-v2.html'), 'utf8');
    assert.ok(/window\.priceCatalogItem\(/.test(qb), 'computePrice no longer delegates to priceCatalogItem');
    assert.ok(!/priceConfiguredItem|normalisePricingDoc/.test(qb), 'the Quote Builder re-implements (or names) the configured-price math');
    const from = qb.indexOf('async function loadDatabase('), to = qb.indexOf('function reloadDatabase()');
    assert.ok(from > 0 && to > from, 'loadDatabase() not found');
    const hits = [...qb.matchAll(/product_pricing/g)].map((m) => m.index);
    assert.ok(hits.every((i) => i > from && i < to), 'product_pricing is named outside loadDatabase()');
    const read = qb.indexOf("db.collection('product_pricing')", from);
    assert.ok(read > from && read < to, 'the option-sheet read is not inside loadDatabase()');
    assert.ok(/try \{\s*const sheetSnap = await db\.collection\('product_pricing'\)\.get\(\);/.test(qb), 'the option-sheet read has no try/catch of its own');
  });
  it('a plain SKU priced after the new functions are called is priced exactly as before (no shared state)', () => {
    const before = priceCatalogItem(PRIMARY, { dims: { W: 1300, D: 700, H: 850 }, runs: null, specIdx: [] }, {});
    priceConfiguredItem(PRIMARY, FAM, { ...STD, layers: 3 }, { W: 1300, D: 700, H: 850 }, SHEET(), {}, OPT);
    normalisePricingDoc(FAM, SHEET());
    assert.deepEqual(priceCatalogItem(PRIMARY, { dims: { W: 1300, D: 700, H: 850 }, runs: null, specIdx: [] }, {}), before);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  THE STAFF-ONLY STEEL GRADE AS A PERCENTAGE (owner ruling 2026-10-28, specs/GRADE-PERCENT-SPEC.md, schema 5) — on the REAL definitions. FAKE percentages only
//  (12.5, 37, 0, -10, 1000 …): the repository is public and the owner's figure is private data.
// ═══════════════════════════════════════════════════════════════════════════
const FAMS = require('../js/qr-families.js');
const PFX = require('../js/product-families.js');
const FROZEN = require('./fixtures/pricing-core.schema4.js');          // pricing-core exactly as it was at schema 4: the oracle for "every other group is unchanged"
const G316 = 'Material: Stainless Steel 316 Laboratory Grade';

describe('the SS316 grade is a PERCENT group on every real family, and normalisePricingDoc reads its cell as { pct } and nothing else', () => {
  const sink = FAMS.families.sink;
  const norm = (cells) => normalisePricingDoc(sink, { approved: true, schemaVersion: FAMS.version, options: { grade: cells } }).options.grade;

  it('the premise: the families are on schema 5, and `grade` — a choice group, SS304 the default — is the ONE percent group of each of the eleven', () => {
    assert.equal(FAMS.version, 5, 'the grade being a percentage is schema 5');
    assert.equal(FAMS.order.length, 11);
    for (const id of FAMS.order) {
      const fam = FAMS.families[id];
      assert.deepEqual(fam.groups.filter((g) => g.pricing !== undefined).map((g) => g.key + '=' + g.pricing), ['grade=percent'], `${id}: exactly the grade is priced as a percentage`);
      const g = fam.groups.find((x) => x.key === 'grade');
      assert.equal(g.type, 'choice', id); assert.equal(g.default, 304, id); assert.deepEqual(g.options.map((o) => o.v), [304, 316], id);
    }
  });

  it('a percent cell keeps ONLY pct: a flat / perW100 beside it, the confidence and the note are dropped', () => {
    assert.deepEqual(norm({ 316: { flat: 999, perW100: 9, pct: 12.5, confidence: 'entered', derivation: 'x', extra: 1 } }), { 304: { pct: null }, 316: { pct: 12.5 } });
    assert.deepEqual(Object.keys(norm({ 316: { pct: 37 } })[316]), ['pct']);
    // both values of the group have a cell; a figure left under the standard value is carried (and never read: see the pricing tests below)
    assert.deepEqual(norm({ 304: { pct: 777 }, 316: { pct: 5 } }), { 304: { pct: 777 }, 316: { pct: 5 } });
  });

  it('a pct that is not a finite number within +/-1000 is BLANK (null) — a string, NaN, Infinity, a boolean, a list, an object, 1001, -1001, 1e6; the bounds, 0 and a negative are figures', () => {
    for (const bad of ['12', '', NaN, Infinity, -Infinity, true, false, [], [5], {}, null, undefined, 1001, -1001, 1000.0001, 1e6, -1e6, 1e9]) assert.deepEqual(norm({ 316: { pct: bad } })[316], { pct: null }, String(bad));
    for (const good of [1000, -1000, 0, -10, 12.5, 0.01, 999.99]) assert.deepEqual(norm({ 316: { pct: good } })[316], { pct: good }, String(good));
    assert.ok(Object.is(norm({ 316: { pct: 0 } })[316].pct, 0), 'an explicit 0 is a figure, not a blank');
  });

  it('the schema-4 shape { flat, perW100 } is BLANK — it is never read as a percentage', () => {
    // (flats of 37, 12, 1 and 0 are inside the +/-1000 cap on purpose: a reader that took the flat for a percentage would keep them, where one that only rejects big numbers would not)
    for (const old of [{ flat: 4217, perW100: 38 }, { flat: 4217, perW100: null }, { flat: 37, perW100: 38 }, { flat: 12, perW100: 12, confidence: 'entered', derivation: 'an amount' }, { flat: 1, perW100: null }, { flat: 0, perW100: 0 }, { flat: 0 }, { flat: -10, perW100: null }, { flat: null, perW100: null }, {}]) {
      assert.deepEqual(norm({ 316: old })[316], { pct: null }, JSON.stringify(old));
    }
  });

  it('an absent cell, an absent group, a junk cell and a junk group are blank too; only the family\'s own values and groups survive', () => {
    for (const junk of [undefined, null, 5, 'x', [], { 316: null }, { 316: 'x' }, { 316: [] }, { 999: { pct: 5 } }]) {
      const out = norm(junk);
      assert.deepEqual(out, { 304: { pct: null }, 316: { pct: null } }, JSON.stringify(junk));
    }
    const d = normalisePricingDoc(sink, { approved: true, schemaVersion: FAMS.version, options: {} });
    assert.deepEqual(d.options.grade, { 304: { pct: null }, 316: { pct: null } });
    assert.deepEqual(Object.keys(d.options), sink.groups.map((g) => g.key));
    assert.equal(normalisePricingDoc(sink, { options: { grade: { 316: { pct: 9 } }, nope: { x: { pct: 9 } } } }).options.nope, undefined);
  });

  it('every OTHER group of every family is normalised exactly as the schema-4 module does (numbers within the cap, blank = null), and so are the approval fields and the size rate', () => {
    const odd = [217, null, -48.5, 'x', 1e9, 0, NaN, 33, undefined, true, 1500.25];
    for (const id of FAMS.order) {
      const fam = FAMS.families[id];
      let n = 0;
      const options = {};
      for (const g of fam.groups) { options[g.key] = {}; for (const o of g.options) options[g.key][String(o.v)] = { flat: odd[n++ % odd.length], perW100: odd[n++ % odd.length], pct: 12.5 }; }
      options.nope = { x: { flat: 1 } };
      const doc = { approved: true, schemaVersion: FAMS.version, options, size: { perW100: 77 } };
      const now = normalisePricingDoc(fam, doc), then = FROZEN.normalisePricingDoc(fam, doc);
      assert.deepEqual(Object.keys(now.options), Object.keys(then.options), id);
      for (const g of fam.groups) {
        if (g.pricing === 'percent') continue;
        assert.deepEqual(now.options[g.key], then.options[g.key], `${id}.${g.key}`);
        for (const v of Object.keys(now.options[g.key])) assert.deepEqual(Object.keys(now.options[g.key][v]), ['flat', 'perW100'], `${id}.${g.key}.${v}`);
      }
      assert.deepEqual([now.approved, now.schemaVersion, now.size], [then.approved, then.schemaVersion, then.size], id);
    }
  });

  it('a "pricing" flag on a group that is not a choice group is ignored (the build refuses it; the pricing never reads a pct from a multi or a slots group)', () => {
    const odd = { ...syn(), groups: [
      { key: 'addons', label: 'Add-ons', type: 'multi', default: [], pricing: 'percent', options: [{ v: 'oven', l: 'Oven' }] },
      { key: 'burners', label: 'Burners', type: 'slots', minSlots: 1, maxSlots: 3, default: ['lp'], pricing: 'percent', options: [{ v: 'lp', l: 'LP' }, { v: 'wok', l: 'Wok' }] },
      { key: 'k', label: 'K', type: 'choice', default: 'a', pricing: 'flat', options: [{ v: 'a', l: 'A' }, { v: 'b', l: 'B' }] },
    ] };
    const d = normalisePricingDoc(odd, { options: { addons: { oven: { flat: 7, perW100: 3, pct: 50 } }, burners: { wok: { flat: 11, pct: 50 } }, k: { b: { flat: 9, pct: 50 } } } });
    assert.deepEqual(d.options.addons.oven, { flat: 7, perW100: 3 });
    assert.deepEqual(d.options.burners.wok, { flat: 11, perW100: null });
    assert.deepEqual(d.options.k.b, { flat: 9, perW100: null });
  });
});

describe('priceConfiguredItem — the SS316 grade adds pct % of the WHOLE line price: SS304 is the zero point, SS316 reads one signed pct, a blank pct is "priced after review"', () => {
  const sink = FAMS.families.sink;
  const SINK_PRIMARY = perLength({ id: 'PW-004', basePrice: 1000, defaultDimensions: { W: 500, D: 500, H: 850 }, formula: { baseLengthMm: 500, pricePerExtraMm: 2, rateD100: 30, rateH100: 0 } });
  // two priced options besides the grade, odd figures, per-100-mm rates (one fractional, so the subtotal is NOT a whole number)
  const OTHER = {
    basins: { 2: { flat: 4217, perW100: 38.5 } },
    undershelf: { true: { flat: 1111, perW100: null } },
    faucet: { prerinse: { flat: 613, perW100: 7 } },
  };
  const CFG = { ...PFX.defaultConfig(sink), basins: 2, undershelf: true, faucet: 'prerinse' };
  const DIMS_C = { W: 1400, D: 500, H: 850 };                                       // a custom length: 900 mm above the standard 500
  const opt = { schemaVersion: FAMS.version };
  const sheet = (cell, over) => ({ approved: true, schemaVersion: FAMS.version, options: { ...OTHER, ...(over || {}), ...(cell === undefined ? {} : { grade: { 316: cell } }) }, size: { perW100: null } });
  const price = (grade, sh, dims, cfgOver) => priceConfiguredItem(SINK_PRIMARY, sink, { ...CFG, ...(cfgOver || {}), grade }, dims || DIMS_C, sh, {}, opt);
  // S, the whole line before any percentage, worked out by hand: the primary's own length rule + the three options at 900 mm above the standard length
  const BASE = 1000 + 2 * (1400 - 500);                                              // 2800
  const S = BASE + (4217 + 38.5 * 9) + 1111 + (613 + 7 * 9);                          // 2800 + 4563.5 + 1111 + 676 = 9150.5
  const labelOf = (groupKey, v) => { const g = sink.groups.find((x) => x.key === groupKey); const o = g.options.find((x) => String(x.v) === String(v)); return g.label + ': ' + (o.f || o.l); };

  it('the fixtures are what the hand-worked figures say (so the assertions below prove something)', () => {
    const std = price(304, sheet({ pct: 37 }));
    assert.equal(std.base, BASE);
    assert.deepEqual(std.deltas, [{ key: 'basins:2', amount: 4563.5 }, { key: 'undershelf:true', amount: 1111 }, { key: 'faucet:prerinse', amount: 676 }]);
    assert.equal(std.deltas.reduce((n, d) => n + d.amount, std.base), S);
    assert.equal(S, 9150.5);
  });

  it('a FAKE pct on a sink at a custom length with two other priced options and a per-100 rate: unitPrice = round(S x (1 + pct/100)); the grade delta is the UNROUNDED S x pct / 100 and the other deltas are exactly the 304 run\'s', () => {
    const std = price(304, sheet({ pct: 37 }));
    assert.equal(std.priced, true);
    assert.equal(std.unitPrice, Math.round(S));
    const lab = price(316, sheet({ pct: 37 }));
    assert.equal(lab.priced, true); assert.equal(lab.reason, null); assert.deepEqual(lab.missing, []);
    assert.equal(lab.base, BASE, 'the base is the primary at the requested size');
    assert.deepEqual(lab.deltas, [...std.deltas, { key: 'grade:316', amount: S * 37 / 100 }], 'the other deltas are the 304 run\'s; the grade delta ends the list');
    assert.equal(lab.unitPrice, Math.max(0, Math.round(S + S * 37 / 100)));
    assert.equal(lab.unitPrice, Math.round(S * 1.37), 'round(S x 1.37)');
    assert.equal(lab.unitPrice, 12536, 'by hand: 9150.5 + 3385.685 = 12536.185');
    assert.notEqual(lab.deltas.at(-1).amount, BASE * 37 / 100, 'it is a percentage of the whole line, not of the base item');
    assert.notEqual(lab.unitPrice, std.unitPrice);
  });

  it('the percentage is taken of the subtotal and rounded ONCE, at the end: pct 12.5 on a subtotal ending in .5 (the delta stays unrounded)', () => {
    const lab = price(316, sheet({ pct: 12.5 }));
    assert.equal(lab.deltas.at(-1).amount, S * 12.5 / 100);                        // 1143.8125 — not 1144
    assert.equal(lab.unitPrice, 10294, 'round(9150.5 + 1143.8125 = 10294.3125); rounding the amount first would give 10295');
  });

  it('a spread of percentages, signed: unitPrice = max(0, round(S + S x pct / 100)), and the delta is S x pct / 100', () => {
    for (const pct of [0.5, 1, 7, 12.5, 25, 37, 99.99, 100, 250, 1000, 0, -1, -10, -37, -50, -99]) {
      const lab = price(316, sheet({ pct }));
      assert.equal(lab.priced, true, String(pct));
      assert.equal(lab.unitPrice, Math.max(0, Math.round(S + S * pct / 100)), String(pct));
      assert.deepEqual(lab.deltas.at(-1), { key: 'grade:316', amount: S * pct / 100 }, String(pct));
    }
  });

  it('pct 0 IS a figure: priced, the same as the 304 line; a NEGATIVE pct is a signed discount; a total that falls to zero or below is not a price (no_price)', () => {
    const std = price(304, sheet({ pct: 37 }));
    const zero = price(316, sheet({ pct: 0 }));
    assert.equal(zero.priced, true); assert.equal(zero.unitPrice, std.unitPrice);
    assert.ok(Object.is(zero.deltas.at(-1).amount, 0)); assert.equal(zero.deltas.at(-1).key, 'grade:316');
    const less = price(316, sheet({ pct: -10 }));
    assert.equal(less.unitPrice, Math.round(S * 0.9)); assert.equal(less.unitPrice, 8235);
    assert.ok(less.deltas.at(-1).amount < 0);
    const gone = price(316, sheet({ pct: -1000 }));        // S - 10 S < 0
    assert.deepEqual([gone.priced, gone.unitPrice, gone.reason], [false, 0, 'no_price']);
    const exactlyAll = price(316, sheet({ pct: -100 }));    // S - S = 0
    assert.deepEqual([exactlyAll.priced, exactlyAll.unitPrice, exactlyAll.reason], [false, 0, 'no_price']);
  });

  it('+/-1000 are the bounds: 1000 prices (S x 11), 1001 / 1e6 are BLANK ("priced after review"), never a price', () => {
    const top = price(316, sheet({ pct: 1000 }));
    assert.equal(top.priced, true); assert.equal(top.unitPrice, Math.round(S + S * 1000 / 100));
    for (const over of [1001, -1001, 1e6, -1e6, 1e9, Infinity, NaN]) {
      const r = price(316, sheet({ pct: over }));
      assert.deepEqual([r.priced, r.unitPrice, r.reason], [false, 0, 'missing_input'], String(over));
      assert.deepEqual(r.missing, [G316], String(over));
    }
  });

  it('a BLANK pct (absent cell, null, no number, a string, the schema-4 { flat, perW100 } shape) is "missing input" naming the Material option — unitPrice 0, never zero-priced; the 304 line is untouched', () => {
    const blanks = [sheet(undefined), sheet({ pct: null }), sheet({}), sheet({ pct: '37' }), sheet({ pct: NaN }), sheet({ flat: 4217, perW100: 38 }), sheet({ flat: 4217, perW100: null }), sheet({ flat: 4217 }), sheet({ flat: 37, perW100: 38 }), sheet({ flat: 0, perW100: null }), sheet({ flat: 12.5 }), { ...sheet(undefined), options: { ...OTHER, grade: null } }];
    for (const sh of blanks) {
      const lab = price(316, sh);
      assert.equal(lab.priced, false, JSON.stringify(sh.options.grade)); assert.equal(lab.unitPrice, 0); assert.equal(lab.reason, 'missing_input');
      assert.deepEqual(lab.missing, [G316], JSON.stringify(sh.options.grade));
      const std = price(304, sh);
      assert.equal(std.priced, true); assert.equal(std.reason, null); assert.deepEqual(std.missing, []);
      assert.equal(std.unitPrice, Math.round(S), 'the 304 line prices from the base and the other options alone');
    }
  });

  it('the OLD shape under 316 is never priced from its flat: { flat: 4217, perW100: 38 } and a pct are not interchangeable (a flat that happens to look like a small percentage, or 0, is not one either)', () => {
    for (const cell of [{ flat: 4217, perW100: 38 }, { flat: 37, perW100: 38 }, { flat: 12.5, perW100: null }, { flat: 0, perW100: null }, { flat: -10, perW100: 5 }]) {
      const old = price(316, sheet(cell));
      assert.equal(old.priced, false, JSON.stringify(cell)); assert.equal(old.reason, 'missing_input'); assert.deepEqual(old.missing, [G316]);
      assert.equal(old.unitPrice, 0);
    }
    // ... and with a pct beside the old keys, only the pct counts
    const both = price(316, sheet({ flat: 4217, perW100: 38, pct: 37 }));
    assert.equal(both.priced, true); assert.equal(both.unitPrice, 12536);
    assert.deepEqual(both.deltas.at(-1), { key: 'grade:316', amount: S * 37 / 100 });
  });

  it('a pct on a line whose OTHER cells are blank: "missing input" names those options and not the grade; with both blank, each is named once', () => {
    const blankBasins = sheet({ pct: 37 }, { basins: { 2: { flat: null, perW100: 38.5 } } });
    const a = price(316, blankBasins);
    assert.deepEqual([a.priced, a.unitPrice, a.reason], [false, 0, 'missing_input']);
    assert.deepEqual(a.missing, [labelOf('basins', 2)]);
    assert.ok(!a.missing.includes(G316));
    const blankBoth = sheet({ pct: null }, { basins: { 2: { flat: null, perW100: 38.5 } }, faucet: { prerinse: {} } });
    const b = price(316, blankBoth);
    assert.equal(b.reason, 'missing_input');
    assert.deepEqual([...b.missing].sort(), [G316, labelOf('basins', 2), labelOf('faucet', 'prerinse')].sort());
    assert.equal(new Set(b.missing).size, b.missing.length);
    // the 304 line of the same sheet is blocked only by the options it uses
    assert.deepEqual(price(304, blankBoth).missing, [labelOf('basins', 2), labelOf('faucet', 'prerinse')]);
  });

  it('a 304 line adds no delta and reads no grade cell, however odd the grade group of the sheet is (a pct under 304, a flat under 316, a huge pct, a string, null, a list)', () => {
    const plain = price(304, sheet(undefined));
    assert.equal(plain.priced, true); assert.deepEqual(plain.deltas.map((d) => d.key), ['basins:2', 'undershelf:true', 'faucet:prerinse']);
    const odd = [{ 304: { pct: 777 }, 316: { flat: 5, perW100: null } }, { 304: { pct: 37 }, 316: { pct: 37 } }, { 304: { pct: null } }, { 304: { flat: 777, perW100: 3 } }, { 304: 'x', 316: 9 }, { 304: [], 316: [] }, null, 'x', []];
    for (const grade of odd) {
      const r = price(304, { ...sheet(undefined), options: { ...OTHER, grade } });
      assert.deepEqual(r, plain, JSON.stringify(grade));
      assert.deepEqual(r.deltas.filter((d) => d.key.startsWith('grade')), [], JSON.stringify(grade));
    }
  });

  it('a sheet approved against an older schema (1 to 4 — before the grade was a percentage) prices NOTHING — "not approved" — for the standard grade as well; an unapproved one too; the same cells under schema 5 price', () => {
    for (const older of [1, 2, 3, 4]) {
      for (const grade of [304, 316]) {
        const r = price(grade, { ...sheet({ pct: 37 }), schemaVersion: older });
        assert.equal(r.priced, false, `schema ${older} grade ${grade}`); assert.equal(r.unitPrice, 0); assert.equal(r.reason, 'not_approved', `schema ${older} grade ${grade}`);
      }
    }
    assert.equal(price(316, { ...sheet({ pct: 37 }), approved: false }).reason, 'not_approved');
    assert.equal(price(316, { ...sheet({ pct: 37 }), schemaVersion: FAMS.version + 1 }).reason, 'not_approved', 'and a FUTURE schema is just as unapproved');
    assert.equal(price(304, sheet({ pct: 37 })).priced, true);
    assert.equal(price(316, sheet({ pct: 37 })).priced, true);
  });

  it('the material-price-index multiplier scales the base BEFORE the options, and the percentage is taken of that whole figure', () => {
    const c = { materialPriceIndexMultiplier: 1.07 };
    const base = priceCatalogItem(SINK_PRIMARY, { dims: DIMS_C, runs: null, specIdx: [] }, c).unitPrice;
    const r = priceConfiguredItem(SINK_PRIMARY, sink, { ...CFG, grade: 316 }, DIMS_C, sheet({ pct: 37 }), c, opt);
    assert.equal(r.base, base);
    const sub = base + 4563.5 + 1111 + 676;
    assert.deepEqual(r.deltas.at(-1), { key: 'grade:316', amount: sub * 37 / 100 });
    assert.equal(r.unitPrice, Math.round(sub + sub * 37 / 100));
  });

  it('is deterministic and pure: the same inputs give the same answer, field for field, and nothing is mutated', () => {
    const args = () => [structuredClone(SINK_PRIMARY), structuredClone(sink), { ...CFG, grade: 316 }, { ...DIMS_C }, sheet({ pct: 37 }), {}, { ...opt }];
    const a = priceConfiguredItem(...args()), b = priceConfiguredItem(...args());
    assert.deepEqual(a, b);
    const frozen = args();
    const snap = JSON.stringify(frozen);
    priceConfiguredItem(...frozen);
    assert.equal(JSON.stringify(frozen), snap);
  });

  describe('a LINEAR family: the percentage is taken AFTER the length delta, so it follows the length too', () => {
    const WS = FAMS.families.wall_shelf;
    const WS_PRIMARY = fixedP({ id: 'PW-023', basePrice: 1893, defaultDimensions: { W: 1200, D: 450 } });
    const wsSheet = (cell, rate) => ({ approved: true, schemaVersion: FAMS.version, options: { tiers: { 2: { flat: 311, perW100: 13 } }, surface: { slotted: { flat: -97, perW100: null } }, ...(cell === undefined ? {} : { grade: { 316: cell } }) }, size: { perW100: rate === undefined ? 77 : rate } });
    const wsPrice = (grade, sh, W) => priceConfiguredItem(WS_PRIMARY, WS, { ...PFX.defaultConfig(WS), tiers: 2, surface: 'slotted', grade }, { W, D: 450 }, sh, {}, opt);
    it('at 2000 mm: S = base 1893 + tiers (311 + 13 x 8) + slotted (-97) + length (77 x 8) = 2827; SS316 at 37 % = round(2827 x 1.37)', () => {
      const std = wsPrice(304, wsSheet({ pct: 37 }), 2000);
      assert.deepEqual(std.deltas, [{ key: 'tiers:2', amount: 415 }, { key: 'surface:slotted', amount: -97 }, { key: 'size:W', amount: 616 }]);
      assert.equal(std.unitPrice, 2827);
      const lab = wsPrice(316, wsSheet({ pct: 37 }), 2000);
      assert.deepEqual(lab.deltas, [...std.deltas, { key: 'grade:316', amount: 2827 * 37 / 100 }]);
      assert.equal(lab.unitPrice, 3873, 'by hand: 2827 + 1045.99 = 3872.99');
    });
    it('shorter than the standard length (the linear rate runs both ways) and exactly at it: the same rule', () => {
      const short = wsPrice(316, wsSheet({ pct: 37 }), 600);            // tiers 311 - 78, length 77 x -6; S = 1893 + 233 - 97 - 462 = 1567
      assert.deepEqual(short.deltas.map((d) => d.key), ['tiers:2', 'surface:slotted', 'size:W', 'grade:316']);
      assert.deepEqual(short.deltas.at(-1), { key: 'grade:316', amount: 1567 * 37 / 100 });
      assert.equal(short.unitPrice, Math.round(1567 * 1.37)); assert.equal(short.unitPrice, 2147);
      const at = wsPrice(316, wsSheet({ pct: 37 }), 1200);              // no length delta at the standard length: S = 1893 + 311 - 97 = 2107
      assert.deepEqual(at.deltas.map((d) => d.key), ['tiers:2', 'surface:slotted', 'grade:316']);
      assert.equal(at.unitPrice, Math.round(2107 * 1.37)); assert.equal(at.unitPrice, 2887);
    });
    it('a blank length rate blocks the line as before ("Size"), whatever the pct', () => {
      const r = wsPrice(316, wsSheet({ pct: 37 }, null), 2000);
      assert.deepEqual([r.priced, r.reason], [false, 'missing_input']);
      assert.deepEqual(r.missing, ['Size']);
    });
  });

  describe('several percent groups (a synthetic family — none of the real ones has two): each takes its percentage of the SAME subtotal and the amounts ADD, never compound', () => {
    const TWO = { ...syn(), groups: [
      { key: 'layers', label: 'Layers', type: 'choice', default: 1, options: [{ v: 1, l: '1' }, { v: 2, l: '2' }] },
      { key: 'ga', label: 'Alpha', type: 'choice', default: 'x', pricing: 'percent', options: [{ v: 'x', l: 'X' }, { v: 'y', l: 'Y' }] },
      { key: 'gb', label: 'Beta', type: 'choice', default: 'p', pricing: 'percent', options: [{ v: 'p', l: 'P' }, { v: 'q', l: 'Q' }] },
      { key: 'wheels', label: 'Wheels', type: 'choice', default: false, options: [{ v: true, l: 'With' }, { v: false, l: 'Without' }] },
    ] };
    const sh = (over) => ({ approved: true, schemaVersion: 1, options: { layers: { 2: { flat: 100 } }, wheels: { true: { flat: 40 } }, ga: { y: { pct: 10 } }, gb: { q: { pct: 20 } }, ...(over || {}) }, size: { perW100: null } });
    const run = (cfg, s) => priceConfiguredItem(PRIMARY, TWO, { layers: 1, ga: 'x', gb: 'p', wheels: false, ...cfg }, DIMS, s === undefined ? sh() : s, {}, OPT);
    it('S = 1000 + 100 + 40 = 1140; Alpha 10 % = 114 and Beta 20 % = 228 are both of 1140: 1482 (compounding would give 1505)', () => {
      const r = run({ layers: 2, wheels: true, ga: 'y', gb: 'q' });
      assert.deepEqual(r.deltas, [{ key: 'layers:2', amount: 100 }, { key: 'wheels:true', amount: 40 }, { key: 'ga:y', amount: 114 }, { key: 'gb:q', amount: 228 }], 'every percentage delta comes AFTER every other delta, although Alpha sits before Wheels');
      assert.equal(r.unitPrice, 1482);
    });
    it('one percent group alone, the other at its default: only that one applies; a blank cell of one names it and leaves the other priced', () => {
      assert.equal(run({ ga: 'y' }).unitPrice, 1100);
      assert.equal(run({ gb: 'q' }).unitPrice, 1200);
      const r = run({ ga: 'y', gb: 'q' }, sh({ gb: { q: { pct: null } } }));
      assert.deepEqual([r.priced, r.reason, r.missing], [false, 'missing_input', ['Beta: Q']]);
      assert.deepEqual(r.deltas, [{ key: 'ga:y', amount: 100 }]);
    });
  });

  it('every family prices its SS316 line the same way — one pct cell per family, SS304 free — with a synthetic primary (the generic code needs nothing per family)', () => {
    for (const id of FAMS.order) {
      const fam = FAMS.families[id];
      const lengthPriced = fam.sizeBasis !== 'linear';
      const prim = lengthPriced
        ? perLength({ id: fam.primary, basePrice: 1000, defaultDimensions: PFX.defaultDims(fam), formula: { baseLengthMm: PFX.defaultDims(fam).W, pricePerExtraMm: 2, rateD100: 30, rateH100: 0 } })
        : fixedP({ id: fam.primary, basePrice: 1000, defaultDimensions: PFX.defaultDims(fam) });
      const dims = PFX.standardDims(fam, PFX.defaultConfig(fam));
      const sh = { approved: true, schemaVersion: FAMS.version, options: { grade: { 316: { pct: 37 } } }, size: { perW100: lengthPriced ? null : 0 } };
      const std = priceConfiguredItem(prim, fam, PFX.defaultConfig(fam), dims, sh, {}, opt);
      const lab = priceConfiguredItem(prim, fam, { ...PFX.defaultConfig(fam), grade: 316 }, dims, sh, {}, opt);
      assert.equal(std.priced, true, `${id}: ${std.missing.join(', ')}`); assert.deepEqual(std.deltas, [], id);
      assert.equal(lab.priced, true, `${id}: ${lab.missing.join(', ')}`);
      assert.deepEqual(lab.deltas, [{ key: 'grade:316', amount: std.base * 37 / 100 }], id);
      assert.equal(lab.unitPrice, Math.round(std.base + std.base * 37 / 100), id);
      assert.equal(lab.unitPrice, 1370, `${id}: 1000 + 37 % of 1000`);
      const blank = priceConfiguredItem(prim, fam, { ...PFX.defaultConfig(fam), grade: 316 }, dims, { ...sh, options: {} }, {}, opt);
      assert.deepEqual(blank.missing, [G316], id); assert.equal(blank.reason, 'missing_input', id);
      for (const flat of [3113, 37, 0]) {
        const oldShape = priceConfiguredItem(prim, fam, { ...PFX.defaultConfig(fam), grade: 316 }, dims, { ...sh, options: { grade: { 316: { flat, perW100: null } } } }, {}, opt);
        assert.deepEqual(oldShape.missing, [G316], `${id}: a schema-4 cell (flat ${flat}) is blank`);
      }
    }
  });
});
