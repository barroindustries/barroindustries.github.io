// tests/fixtures/pricing-core.schema4.js — FROZEN ORACLE. js/pricing-core.js VERBATIM as it stood at schema 4 (the staff-only steel grade priced as an ordinary
// { flat, perW100 } cell), before the SS316 grade became a percentage of the whole line price (specs/GRADE-PERCENT-SPEC.md, schema 5). It exists so that
// tests/grade-percent-parity.test.mjs can prove the PUBLIC path — a standard-grade line, which is all a visitor can ever build — prices byte-for-byte as it did.
// Never edit it, never load it from app code (it is a test fixture, not a mirror: ci-invariants CHECK 10 does not look at it), and it holds no price figure.
// The sha256 of this file is pinned by the parity test.
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
//  ADDITIVE (2026-10-21, product families — specs/PRODUCT-CONFIGURATOR-SPEC.md as simplified by the owner): normalisePricingDoc() and
//  priceConfiguredItem() price a CONFIGURED product = the family's primary SKU priced by priceCatalogItem() (untouched, byte-identical)
//  plus the signed option deltas of the family's PRIVATE option sheet (Firestore product_pricing/{family}, finance tier, never shipped to a
//  browser that is not staff). A family whose sheet is not approved, and any option whose cell is blank, prices NOTHING ("priced after
//  review") — a blank cell is never read as zero. Nothing below changes what priceCatalogItem / validateSelection / estimateRange /
//  estimateGate return; tests/pricing-core.test.mjs pins that.
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
    root.priceConfiguredItem = api.priceConfiguredItem;
    root.normalisePricingDoc = api.normalisePricingDoc;
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

  // ─────────────────────────────────────────────────────────────────────────
  //  PRODUCT FAMILIES — the private option sheet and the configured price.
  //
  //  A family (js/qr-families.js) names a PRIMARY SKU and a zero-point configuration (the group defaults = the primary SKU as it is
  //  sold). The sheet holds, per option value, a signed amount RELATIVE to that zero point:
  //     delta = flat + perW100 x max(0, W - refW) / 100        (refW = the primary's standard length; perW100 is optional, blank = 0)
  //  `choice` groups price the chosen value when it differs from the default; `multi` groups price each selected value; `slots` groups
  //  price each position (a sheet value is the cost of ONE position of that type) as the difference between the chosen positions and the
  //  default ones, so only values with a net count need a cell. A family whose primary SKU carries no length rule of its own
  //  (sizeBasis 'linear') prices the length through sheet.size.perW100, both directions from refW.
  //  Pure; never throws; never mutates its inputs.
  // ─────────────────────────────────────────────────────────────────────────
  var MAX_CELL = 1e8;     // a sheet figure beyond +/-100 million is corrupt, not a price
  function cellNum(v) { return (typeof v === 'number' && isFinite(v) && Math.abs(v) <= MAX_CELL) ? v : null; }

  // normalisePricingDoc(family, raw) -> { approved:bool, schemaVersion:int|null, options:{ group:{ value:{ flat:number|null, perW100:number|null } } },
  //                                       size:{ perW100:number|null } }
  //   Keeps only the groups and values the family defines; a figure that is not a finite number within +/-1e8 becomes null (blank). `approved`
  //   is true only for the boolean true. The Firestore doc is staff-written, so it is sanitised before it is ever used.
  function normalisePricingDoc(family, raw) {
    var r = isObj(raw) ? raw : {};
    var out = { approved: r.approved === true, schemaVersion: (typeof r.schemaVersion === 'number' && isFinite(r.schemaVersion) && Math.floor(r.schemaVersion) === r.schemaVersion) ? r.schemaVersion : null, options: {}, size: { perW100: null } };
    var opts = isObj(r.options) ? r.options : {};
    ((family && family.groups) || []).forEach(function (g) {
      var src = has(opts, g.key) && isObj(opts[g.key]) ? opts[g.key] : {};
      var dst = {};
      (g.options || []).forEach(function (o) {
        var k = String(o.v);
        var c = has(src, k) && isObj(src[k]) ? src[k] : null;
        dst[k] = { flat: c ? cellNum(c.flat) : null, perW100: c ? cellNum(c.perW100) : null };
      });
      out.options[g.key] = dst;
    });
    if (isObj(r.size)) out.size.perW100 = cellNum(r.size.perW100);
    return out;
  }

  function defaultSpecIdx(p) {
    return (Array.isArray(p.specs) ? p.specs : []).map(function (sp) {
      var opts = sp && Array.isArray(sp.options) ? sp.options : [];
      if (!opts.length) return null;
      var i = opts.indexOf(sp.default);
      return i < 0 ? 0 : i;
    });
  }

  // priceConfiguredItem(product, family, config, dims, pricing, constants, opts)
  //   product  the family's PRIMARY SKU, normalised like priceCatalogItem's (id, formulaType, basePrice, defaultDimensions, formula, specs)
  //   family   one entry of QR_FAMILIES.families
  //   config   a configuration ALREADY validated by ProductFamilies.validateLine (this function trusts its shape, and still never throws)
  //   dims     the validated { W, D?, H? } in mm
  //   pricing  the raw product_pricing/{family} doc (or null)
  //   opts     { schemaVersion }  the QR_FAMILIES.version the sheet must have been approved against
  // -> { unitPrice:int, priced:bool, reason:null|'not_approved'|'size_basis'|'no_base_price'|'missing_input'|'no_price', base:int, missing:string[], deltas:[{ key, amount }], sizeAdjusted:bool }
  //   Unpriced means unitPrice 0 and the caller shows "priced after review". `missing` names the options (and the sizes) whose cell or rate is blank:
  //   a blank is never zero. Also left for review: a size basis that no longer matches the primary SKU, a custom width / height the primary has no
  //   rate for, any non-length size of a linear family (its sheet prices the length only), and a total that is not above zero.
  function priceConfiguredItem(product, family, config, dims, pricing, constants, opts) {
    var out = { unitPrice: 0, priced: false, reason: null, base: 0, missing: [], deltas: [], sizeAdjusted: false };
    var p = isObj(product) ? product : {};
    var fam = isObj(family) ? family : {};
    var cfg = isObj(config) ? config : {};
    var d = isObj(dims) ? dims : {};
    var o = isObj(opts) ? opts : {};

    var famDims = isObj(fam.dims) ? fam.dims : {};
    Object.keys(famDims).forEach(function (k) { if (isObj(famDims[k]) && d[k] != null && d[k] !== famDims[k].default) out.sizeAdjusted = true; });

    // the sheet must exist, be approved, and have been approved against THIS schema (a changed family needs a new approval)
    var doc = normalisePricingDoc(fam, pricing);
    if (!doc.approved || typeof o.schemaVersion !== 'number' || doc.schemaVersion !== o.schemaVersion) { out.reason = 'not_approved'; return out; }

    // The family's size basis must still describe the primary SKU: 'linear' exactly when the primary has no length rule of its own. The build checks
    // this against the master; a primary edited AFTERWARDS (to or from per_length) would otherwise stop pricing the length, or price it twice.
    if ((fam.sizeBasis === 'linear') === (p.formulaType === 'per_length')) { out.reason = 'size_basis'; return out; }

    // the primary SKU through the existing machinery, at the requested size, with its own option defaults
    var base = priceCatalogItem(p, { dims: d, runs: null, specIdx: defaultSpecIdx(p) }, constants);
    out.base = base.unitPrice;
    if (!base.priced) { out.reason = 'no_base_price'; return out; }
    // a custom width / height the primary has no rate for is priced by priceCatalogItem at the STANDARD size (it only warns): for a configured line
    // that is an unknown cost, not a free one
    (Array.isArray(base.missingRateLabels) ? base.missingRateLabels : []).forEach(function (lab) {
      var m = 'Size (' + String(lab).toLowerCase() + ')';
      if (out.missing.indexOf(m) < 0) out.missing.push(m);
    });

    var dd = isObj(p.defaultDimensions) ? p.defaultDimensions : {};
    var refW = (p.formulaType === 'per_length' && isObj(p.formula) && isFinitePos(p.formula.baseLengthMm)) ? p.formula.baseLengthMm
      : (isFinitePos(dd.W) ? dd.W : (isObj(famDims.W) ? famDims.W.default : 0));
    var W = isFinitePos(d.W) ? d.W : refW;
    // a linear family's amounts scale with length in BOTH directions; every other family only charges for length ABOVE the standard
    // (the same "shrinking never discounts" rule priceCatalogItem applies to the primary SKU)
    var lenExtra = fam.sizeBasis === 'linear' ? (W - refW) : Math.max(0, W - refW);
    // a linear family's sheet prices the LENGTH only: any other size that differs from the standard has no price to add, so it is left for review
    if (fam.sizeBasis === 'linear') {
      Object.keys(famDims).forEach(function (k) {
        if (k === 'W' || !isObj(famDims[k])) return;
        if (d[k] != null && d[k] !== famDims[k].default) {
          var m = 'Size (' + String(famDims[k].label || k).toLowerCase() + ')';
          if (out.missing.indexOf(m) < 0) out.missing.push(m);
        }
      });
    }

    var total = base.unitPrice;
    function cellFor(group, valueKey) {
      var g = doc.options[group];
      return g && has(g, valueKey) ? g[valueKey] : null;
    }
    function priceCell(g, valueKey, times) {
      var group = g.key;
      var c = cellFor(group, valueKey);
      if (!c || c.flat === null) {
        var opt = (g.options || []).filter(function (x) { return String(x.v) === valueKey; })[0];
        var label = g.label + (opt ? ': ' + (opt.f || opt.l) : '');
        if (out.missing.indexOf(label) < 0) out.missing.push(label);
        return;
      }
      var amount = times * (c.flat + (c.perW100 === null ? 0 : c.perW100) * lenExtra / 100);
      total += amount;
      out.deltas.push({ key: group + ':' + valueKey, amount: amount });
    }
    (Array.isArray(fam.groups) ? fam.groups : []).forEach(function (g) {
      var v = cfg[g.key];
      if (g.type === 'choice') {
        if (v === g.default) return;                              // the zero point: no cell needed, no delta
        priceCell(g, String(v), 1);
      } else if (g.type === 'multi') {
        (Array.isArray(v) ? v : []).forEach(function (x) { priceCell(g, String(x), 1); });
      } else if (g.type === 'slots') {
        var net = Object.create(null);
        (Array.isArray(v) ? v : []).forEach(function (x) { net[x] = (net[x] || 0) + 1; });
        (Array.isArray(g.default) ? g.default : []).forEach(function (x) { net[x] = (net[x] || 0) - 1; });
        Object.keys(net).forEach(function (x) { if (net[x] !== 0) priceCell(g, x, net[x]); });
      }
    });
    // a family whose primary SKU has no length rule of its own prices the length from the sheet, signed, relative to the standard length
    if (fam.sizeBasis === 'linear' && W !== refW) {
      if (doc.size.perW100 === null) { if (out.missing.indexOf('Size') < 0) out.missing.push('Size'); }
      else {
        var sz = doc.size.perW100 * (W - refW) / 100;
        total += sz;
        out.deltas.push({ key: 'size:W', amount: sz });
      }
    }
    if (out.missing.length) { out.reason = 'missing_input'; return out; }
    var unit = Math.max(0, Math.round(total));
    if (!isFinite(unit)) unit = 0;
    out.unitPrice = unit;
    out.priced = unit > 0;
    if (!out.priced) out.reason = 'no_price';
    return out;
  }

  return {
    priceCatalogItem: priceCatalogItem,
    validateSelection: validateSelection,
    estimateRange: estimateRange,
    estimateGate: estimateGate,
    priceConfiguredItem: priceConfiguredItem,
    normalisePricingDoc: normalisePricingDoc
  };
});
