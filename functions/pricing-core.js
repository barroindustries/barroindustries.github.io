// ═══════════════════════════════════════════════════════════
//  js/pricing-core.js — pure catalogue-item pricing + estimate-range math
//  (PUBLIC-QUOTE-REQUEST-SPEC.md §6.2, WS-0).
//
//  THE MONEY-CORE CONTRACT applies (see js/money-core.js, which stays frozen and
//  is NOT touched by this feature): pure; no DOM, no Firebase, no clock, no
//  randomness; every change needs a PINNED test (tests/pricing-core.test.mjs)
//  and every pricing test is MUTATION-TESTED (break the function in a scratch
//  copy, confirm the suite fails). A money change without a test is not done.
//
//  Why a sibling file and not an addition to money-core.js: Cloud Functions
//  deploy only functions/ (firebase.json), so this math is mirrored there
//  byte-for-byte (functions/pricing-core.js — ci-invariants CHECK 10; edit THIS
//  file, then `cp js/pricing-core.js functions/pricing-core.js`). Mirroring the
//  whole of money-core (payroll, statutory tables) into a public-intake
//  function bundle would buy nothing.
//
//  WHO LOADS IT: quote-builder-v2.html (its computePrice() DELEGATES here — no
//  second copy of the formula exists anywhere) and the Cloud Functions
//  (functions/qr-core.js). NEVER any public page: the public catalogue gets
//  only the server's rounded {low, high} range, never a formula or a rate.
//
//  UMD-ish shim: unlike money-core this file does NOT create a `window`
//  global under Node. It is also required inside the Cloud Functions process,
//  and a stray `globalThis.window` there makes libraries that sniff
//  `typeof window` (browser builds of firebase / uuid / fetch shims) take the
//  wrong code path. So: CommonJS `module.exports` under Node, window.* in a
//  browser — the js/cir-forms.js pattern.
//
//  priceCatalogItem is BYTE-EQUIVALENT to quote-builder-v2.html computePrice()
//  as it stood on 2026-10-21 (the DOM reads replaced by an explicit `sel`),
//  including every quirk: shrinking D/H never discounts; a missing rateD100 /
//  rateH100 prices at the default size and says so; the material-price-index
//  multiplier applies BEFORE the spec adders; the result is
//  max(0, round(price)). The only deliberate difference: a result that is not
//  a finite number (a corrupt product doc) is 0 here, where the builder would
//  have shown NaN. tests/pricing-core.test.mjs carries the verbatim legacy
//  function as a frozen oracle and sweeps thousands of synthetic selections
//  against it.
// ═══════════════════════════════════════════════════════════
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;   // functions/ + tests
  if (root) {
    root.priceCatalogItem = api.priceCatalogItem;
    root.validateSelection = api.validateSelection;
    root.estimateRange = api.estimateRange;
    root.estimateGate = api.estimateGate;
    root.PricingCore = api;
  }
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var DIM_KEYS = ['W', 'D', 'H'];
  var DIM_NAME = { W: 'Length', D: 'Width', H: 'Height' };   // the builder's labels for W/D/H

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isFinitePos(v) { return typeof v === 'number' && isFinite(v) && v > 0; }

  // ─────────────────────────────────────────────────────────────────────────
  //  priceCatalogItem(product, sel, constants)
  //    product  { formulaType, basePrice, defaultDimensions, formula, specs }  (quote-builder DB shape)
  //    sel      { dims: {W?,D?,H?} (mm — ONLY the keys the caller shows as inputs),
  //               runs: number|null, specIdx: Array<number|null> (one entry per product.specs entry) }
  //    constants { materialPriceIndexMultiplier?: number }
  //  -> { unitPrice:int, priced:bool, warnings:string[], missingRateLabels:string[], sizeAdjusted:bool }
  // ─────────────────────────────────────────────────────────────────────────
  function priceCatalogItem(product, sel, constants) {
    var p = product || {};
    var s = sel || {};
    var dims = isObj(s.dims) ? s.dims : {};
    var consts = constants || {};
    var dd = isObj(p.defaultDimensions) ? p.defaultDimensions : {};
    var matMult = consts.materialPriceIndexMultiplier || 1.0;
    var missingRateLabels = [];
    var warnings = [];

    var price = p.basePrice || 0;

    if (p.formulaType === 'per_length' && p.formula) {
      var W = dims.W != null ? dims.W : (dd.W != null ? dd.W : 900);
      var base = p.formula.baseLengthMm || 900;
      var ppm = p.formula.pricePerExtraMm || 0;
      var extra = Math.max(0, W - base);
      price = p.basePrice + extra * ppm;

      // Width (D) / Height (H) surcharge — only when the caller moved the
      // dimension ABOVE the product's own default (shrinking never discounts).
      [['D', 'Width'], ['H', 'Height']].forEach(function (pair) {
        var dim = pair[0], label = pair[1];
        if (!(dim in dims)) return;                    // no such input for this product
        var val = dims[dim], defVal = dd[dim];
        if (defVal == null || val <= defVal) return;   // unchanged or shrunk — no surcharge
        var rate = p.formula['rate' + dim + '100'];
        if (rate == null) { missingRateLabels.push(label); return; }
        price += ((val - defVal) / 100) * rate;
      });
      if (missingRateLabels.length) {
        warnings.push('No rate on file for custom ' + missingRateLabels.join(' / ') + ' — priced at default size for ' + missingRateLabels.join('/') + '.');
      }
    } else if (p.formulaType === 'per_area' && p.formula) {
      var aW = dims.W != null ? dims.W : (dd.W != null ? dd.W : 1000);
      var aH = dims.H != null ? dims.H : (dd.H != null ? dd.H : 1000);
      var sqm = (aW * aH) / 1e6;
      price = sqm * (p.formula.pricePerSqm || 0);
    } else if (p.formulaType === 'per_run' && p.formula) {
      var runs = s.runs || 1;
      price = (p.formula.pricePerRun || p.basePrice) * runs;
    }

    price *= matMult;

    // Spec price adders — added AFTER the multiplier. An absent / non-integer
    // selection adds nothing (the builder only added an adder when the <select>
    // existed).
    if (p.specs && p.specs.length) {
      var idxs = Array.isArray(s.specIdx) ? s.specIdx : [];
      p.specs.forEach(function (spec, i) {
        var oi = idxs[i];
        var adders = spec && spec.priceAdder;
        if (!Array.isArray(adders) || typeof oi !== 'number' || !isFinite(oi) || Math.floor(oi) !== oi || oi < 0 || oi >= adders.length) return;
        var adder = adders[oi] ? adders[oi] : 0;
        price += adder;
      });
    }

    var unitPrice = Math.max(0, Math.round(price));
    if (!isFinite(unitPrice)) unitPrice = 0;   // corrupt product doc: never NaN/Infinity

    // Informational: any shown dimension that differs from the product default.
    // For fixed/configurable products the PRICE does not change with size.
    var sizeAdjusted = false;
    Object.keys(dims).forEach(function (k) {
      if (dd[k] != null && dims[k] !== dd[k]) sizeAdjusted = true;
    });

    return { unitPrice: unitPrice, priced: unitPrice > 0, warnings: warnings, missingRateLabels: missingRateLabels, sizeAdjusted: sizeAdjusted };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  validateSelection(product, raw, LIMITS)
  //    raw = { size: {W?,D?,H?}|null, runs: number|null, specs: [{label,value}] }  (id/qty/note are not read)
  //  -> { ok, errors:string[], sel:{dims,runs,specIdx}, specs:[{label,value}], sizeCustom:bool }
  //  `sel` is exactly what priceCatalogItem takes; `specs` is every spec of the
  //  product with the chosen (or default) value, for display / storage.
  // ─────────────────────────────────────────────────────────────────────────
  function dimsAllowed(p) {
    var dd = isObj(p.defaultDimensions) ? p.defaultDimensions : {};
    if (p.formulaType === 'per_run') return [];
    if (p.formulaType === 'per_area') return ['W', 'H'];
    if (p.formulaType === 'per_length') return ['W'].concat(['D', 'H'].filter(function (k) { return isFinitePos(dd[k]); }));
    return DIM_KEYS.filter(function (k) { return isFinitePos(dd[k]); });
  }
  function dimDefault(p, k) {
    var dd = isObj(p.defaultDimensions) ? p.defaultDimensions : {};
    if (isFinitePos(dd[k])) return dd[k];
    if (p.formulaType === 'per_area') return 1000;            // the builder's own fallbacks
    if (p.formulaType === 'per_length' && k === 'W') return 900;
    return null;
  }

  function validateSelection(product, raw, LIMITS) {
    var p = product || {};
    var r = isObj(raw) ? raw : {};
    if (!isObj(LIMITS)) {      // a programming error — fail closed rather than validate against nothing
      return { ok: false, errors: ['Limits were not provided.'], sel: { dims: {}, runs: null, specIdx: [] }, specs: [], sizeCustom: false };
    }
    var L = LIMITS;
    var errors = [];
    var allowed = dimsAllowed(p);
    var dims = {};
    var sizeCustom = false;

    // ── size ──────────────────────────────────────────────────────────────
    var size = r.size;
    if (size != null && !isObj(size)) { errors.push('Size must be a set of Length / Width / Height values.'); size = null; }
    if (size) {
      Object.keys(size).forEach(function (k) {
        if (allowed.indexOf(k) < 0) errors.push('This item cannot be resized in "' + (DIM_NAME[k] || k) + '".');
      });
    }
    allowed.forEach(function (k) {
      var def = dimDefault(p, k);
      var given = size && has(size, k) ? size[k] : undefined;
      if (given === undefined || given === null) { dims[k] = def; return; }
      if (given === def) { dims[k] = def; return; }              // the default itself is always acceptable
      var factorCap = isFinite(L.maxDimFactor) ? def * L.maxDimFactor : Infinity;
      var absCap = (isObj(L.maxDimAbsMm) && isFinite(L.maxDimAbsMm[k])) ? L.maxDimAbsMm[k] : Infinity;
      // The absolute cap never sits BELOW the product's own default (a 6.8 m standard length must be able to shrink to 6.5 m): the
      // largest custom size is min(default x factor, max(abs cap, default)). When that is under the minimum size, the dimension is
      // fixed — no custom value can exist (a 30 mm standard height).
      var max = Math.min(factorCap, Math.max(absCap, def));
      if (max < L.minDimMm) {
        errors.push('"' + DIM_NAME[k] + '" is fixed for this item — it cannot be customised.');
        return;
      }
      if (typeof given !== 'number' || !isFinite(given) || Math.floor(given) !== given
          || given % L.dimStepMm !== 0 || given < L.minDimMm || given > max) {
        errors.push('"' + DIM_NAME[k] + '" must be a whole number of millimetres between ' + L.minDimMm + ' and ' + max + ', in steps of ' + L.dimStepMm + '.');
        return;
      }
      dims[k] = given;
      sizeCustom = true;
    });

    // ── runs ──────────────────────────────────────────────────────────────
    var runs = null;
    if (p.formulaType === 'per_run') {
      var rr = r.runs;
      if (typeof rr !== 'number' || !isFinite(rr) || Math.floor(rr) !== rr || rr < 1 || rr > L.maxRuns) {
        errors.push('Number of runs must be a whole number from 1 to ' + L.maxRuns + '.');
      } else {
        runs = rr;
      }
    } else if (r.runs != null) {
      errors.push('This item is not priced by runs.');
    }

    // ── specs ─────────────────────────────────────────────────────────────
    var productSpecs = Array.isArray(p.specs) ? p.specs : [];
    var chosen = {};
    if (r.specs != null && !Array.isArray(r.specs)) {
      errors.push('Options must be a list.');
    } else {
      (r.specs || []).forEach(function (entry) {
        if (!isObj(entry) || typeof entry.label !== 'string' || typeof entry.value !== 'string') { errors.push('An option is malformed.'); return; }
        var si = -1;
        for (var i = 0; i < productSpecs.length; i++) { if (productSpecs[i] && productSpecs[i].label === entry.label) { si = i; break; } }
        if (si < 0) { errors.push('Unknown option "' + entry.label + '".'); return; }
        if (has(chosen, si)) { errors.push('Option "' + entry.label + '" is listed twice.'); return; }
        var opts = Array.isArray(productSpecs[si].options) ? productSpecs[si].options : [];
        var oi = opts.indexOf(entry.value);
        if (oi < 0) { errors.push('"' + entry.value + '" is not a choice for "' + entry.label + '".'); return; }
        chosen[si] = oi;
      });
    }
    var specIdx = [];
    var specs = [];
    productSpecs.forEach(function (sp, i) {
      var opts = sp && Array.isArray(sp.options) ? sp.options : [];
      if (!opts.length || typeof sp.label !== 'string') { specIdx.push(null); return; }
      var idx = has(chosen, i) ? chosen[i] : opts.indexOf(sp.default);
      if (idx < 0) idx = 0;                                      // default absent -> first option (what the <select> shows)
      specIdx.push(idx);
      specs.push({ label: sp.label, value: opts[idx] });
    });

    return { ok: errors.length === 0, errors: errors, sel: { dims: dims, runs: runs, specIdx: specIdx }, specs: specs, sizeCustom: sizeCustom };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  estimateRange(exact, cfg)  cfg = QR_DEF.ESTIMATE
  //  -> { low, high, step }   low = floorToStep(exact x lowFactor); high = ceilToStep(exact x highFactor)
  //  A tiny epsilon keeps a value that is mathematically an exact multiple of
  //  the step from slipping a whole step on floating-point noise.
  // ─────────────────────────────────────────────────────────────────────────
  var EPS = 1e-9;
  function stepFor(exact, cfg) {
    var steps = cfg.steps;
    for (var i = 0; i < steps.length; i++) { if (exact < steps[i].below) return steps[i].step; }
    return steps[steps.length - 1].step;
  }
  function estimateRange(exact, cfg) {
    var c = cfg || {};
    var e = Number(exact);
    if (!isFinite(e) || e <= 0) return { low: 0, high: 0, step: c.steps[0].step };
    var step = stepFor(e, c);
    var low = Math.floor(e * c.lowFactor / step + EPS) * step;
    var high = Math.ceil(e * c.highFactor / step - EPS) * step;
    if (high <= low) high = low + step;
    return { low: low, high: high, step: step };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  estimateGate(basket, cfg)  basket = { distinctPriced, exact }
  //  -> { shown, reason: null|'gate' }
  // ─────────────────────────────────────────────────────────────────────────
  function estimateGate(basket, cfg) {
    var b = basket || {};
    var c = cfg || {};
    var shown = (b.distinctPriced >= c.minDistinct) || (b.exact >= c.minExact);
    return { shown: !!shown, reason: shown ? null : 'gate' };
  }

  return {
    priceCatalogItem: priceCatalogItem,
    validateSelection: validateSelection,
    estimateRange: estimateRange,
    estimateGate: estimateGate
  };
});
