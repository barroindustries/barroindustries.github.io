// js/qb-configured.js — pure helpers for the CONFIGURATOR inside the quote builder
// (specs/QUOTE-BUILDER-CONFIGURATOR-SPEC.md §2.2; behaviour §4.5 cost basis, §5 R1 auto-pricer predicate, §6.3 / §6.4 hand-off tables,
// §7 estimate-range check, §10.3 migration of an old line).
//
// WHAT IT IS: the one place the quote builder's configured (family) lines are priced, built, costed and converted, and where the website
// hand-off (a quote request / project brief opened in the builder) is mapped. It walks the SAME definitions (js/qr-families.js, via
// js/product-families.js) and the SAME price math (js/pricing-core.js priceConfiguredItem) as the public catalogue and the qrEstimate /
// qrSubmit callables, so a line configured in the builder and the figure the website showed the client cannot drift apart:
// tests/qb-configured.test.mjs sweeps priceLine() against functions/qr-core.js computeBasket() on hundreds of random lines.
//
// WHAT IT IS NOT: it is NOT mirrored into functions/ (the Cloud Functions never load it; ci-invariants CHECK 10 does not list it), and it
// is not loaded by any public page — staff sessions only (quote-builder-v2.html, js/screens/quote-requests.js,
// js/screens/client-info-requests.js). It carries NO price, rate or amount of its own: every figure it returns comes from the sheet, the
// catalogue product or the line it was handed.
//
// PURE: no DOM, no Firebase, no clock, no randomness, no I/O; it never mutates an argument and never throws on junk input. Its three
// dependencies are PASSED IN, never required:  deps = { PF: ProductFamilies, PC: PricingCore, FAM: QR_FAMILIES, constants?: {…} }
// (`constants` = productMeta/config.constants, only read by costBasisFor).
//
// UMD-ish shim, like js/product-families.js: browser <script> -> window.QBConfigured; Node require() -> module.exports. ES5 on purpose,
// like its siblings (no arrow functions, no let/const, no template strings).
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;   // tests
  if (root) root.QBConfigured = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var EPS = 1e-9;
  var SCALE_MIN = 0.25;   // §4.5: the proportional cost scale is clamped to [0.25, 4]
  var SCALE_MAX = 4;

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }                      // a finite number, else 0
  function str(v) { return typeof v === 'string' ? v : ((typeof v === 'number' || typeof v === 'boolean') ? String(v) : ''); }
  function posInt(v) { var n = parseInt(v, 10); return n > 0 ? n : 1; }                  // a whole quantity, at least 1
  function copyObj(o) { var out = {}; if (isObj(o)) Object.keys(o).forEach(function (k) { out[k] = o[k]; }); return out; }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function lookup(m, key) { return m && typeof m.get === 'function' ? m.get(key) : (isObj(m) && has(m, key) ? m[key] : undefined); }
  function familyOf(deps, familyId) {
    var fams = deps && deps.FAM && deps.FAM.families;
    return fams && typeof familyId === 'string' && has(fams, familyId) ? fams[familyId] : null;
  }
  // The builder SECTION a configured line sits in. `fam.category` is the family's PUBLIC category ('preparation', 'washing' …), which is NOT one of the
  // Quote Builder's section ids; the base product's own `category` (what the builder files that SKU under, e.g. 'prep_washing') is. So the line takes its
  // primary product's category, and falls back to the family's public one only when no usable product was given.
  function sectionOf(primary, fam) {
    return isObj(primary) && typeof primary.category === 'string' && primary.category ? primary.category : fam.category;
  }
  // completeConfig(fam, config) -> a COPY of a configuration in which every group it does not state — an ABSENT key, or undefined — holds the group's DEFAULT: the rule
  // ProductFamilies.validateConfiguration applies to an absent key. A request stored (or a draft saved) before the staff-only top plate existed has no `top`, and
  // priceConfiguredItem() reads a missing key as "an option that is not the standard one", which would leave a standard line "priced after review (Top plate)".
  // Only ABSENT keys are filled: a stated value is never touched (1.2 mm included, and a wrong one too — a bad value is not silently "fixed"), and anything that is not a
  // plain object is returned as it is. Never mutates its input; the defaults are cloned, so nothing is shared with the family definition.
  function completeConfig(fam, config) {
    if (!isObj(fam) || !isObj(config)) return config;
    var out = copyObj(config);
    arr(fam.groups).forEach(function (g) {
      if (!has(out, g.key) || out[g.key] === undefined) out[g.key] = clone(g.default);
    });
    return out;
  }
  function specString(specs) {                  // "Sinks: 2, Sink position: Centre, …" — the description printed under the line name
    return arr(specs).map(function (s) { return s.label + ': ' + s.value; }).join(', ');
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  priceLine — the builder's ONE configured-price path
  // ═══════════════════════════════════════════════════════════════════════
  // priceLine(deps, { family, primary, config, size, sheet, constants })
  //   family   one entry of QR_FAMILIES.families            primary  the family's PRIMARY SKU, normalised like a DB.products entry
  //   config   a configuration validated by PF.validateLine (complete), or any plain object: a group it does not state reads as its DEFAULT (completeConfig above),
  //            so a line stored before the staff-only top plate existed prices as the standard 1.5 mm one. A complete configuration is priced exactly as given.
  //            size  the validated { W, D?, H? } in mm
  //   sheet    the raw product_pricing/{family} doc, or null (unreadable / not set up -> every option is "priced after review")
  //   constants  productMeta/config.constants
  // -> { unitPrice, priced, reason, missing, base, deltas, pricedSize, warnings }
  // It is functions/qr-core.js computeBasket() for ONE configured line, field for field: the server's SOFT-width rule first (a body shorter
  // than the burners need is priced at the usual length, and the line says so — a HARD rule never substitutes: validation refuses it), then
  // PC.priceConfiguredItem with the sheet's schema version = the definitions version. `pricedSize` is the size that was actually priced.
  function priceLine(deps, args) {
    var d = isObj(deps) ? deps : {};
    var a = isObj(args) ? args : {};
    var fam = isObj(a.family) ? a.family : null;
    var primary = isObj(a.primary) ? a.primary : null;
    var size = a.size;
    var pricedSize = isObj(size) ? copyObj(size) : size;
    var warnings = [];
    var cfg = fam ? completeConfig(fam, a.config) : a.config;           // absent groups = their defaults, for the width rule and the price alike
    var mw = fam && d.PF ? d.PF.minWidth(fam, cfg) : null;
    if (mw && !mw.hard && isObj(size) && typeof size.W === 'number' && size.W < mw.mm) {
      warnings.push('Asked for ' + size.W + ' mm; priced at the usual ' + mw.mm + ' mm length for these ' + mw.noun + '.');
      pricedSize.W = mw.mm;
    }
    var r = fam && primary && d.PC && d.FAM
      ? d.PC.priceConfiguredItem(primary, fam, cfg, pricedSize, a.sheet, a.constants || {}, { schemaVersion: d.FAM.version })
      : { unitPrice: 0, priced: false, reason: 'no_family', base: 0, missing: [], deltas: [], sizeAdjusted: false };
    return { unitPrice: r.unitPrice, priced: r.priced, reason: r.reason, missing: r.missing, base: r.base, deltas: r.deltas, pricedSize: pricedSize, warnings: warnings };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  buildLine — a configured line in the builder's item shape (§3.1)
  // ═══════════════════════════════════════════════════════════════════════
  // buildLine(deps, { family, primary, config, size, qty, unit, note, basis }) -> item | null
  //   `basis` = the priceLine() result for exactly this config + size (R2): priced -> priceBasis 'website', the line lands at that figure;
  //   not priced (or no basis at all) -> priceBasis 'manual', needsPrice true, unitPrice 0 — the auto-pricer must never fill in the bare
  //   SKU's price (A2), and the builder's Verify gate (R5) stops the filing until a price is typed. A price TYPED by staff is applied by the
  //   builder afterwards (unitPrice, priceManual, then needsPrice cleared), never here.
  //   config / size are re-validated with PF.validateLine in STAFF mode ({ staff: true }: the staff-only 1.2 mm top plate is a valid choice here, never on the
  //   website) and stored in their CANONICAL form — every group stated, so a configuration with no `top` is built at the standard 1.5 mm; null when they are not valid
  //   (the panel disables Add while they are not, so null is "a bug upstream", and a line that the server would refuse for any other reason is never built).
  //   `category` is the PRIMARY PRODUCT's own category — the builder section the line sits in ('prep_washing' …), never the family's public one — and falls back to
  //   the family's public category only when no primary product (with a category) was passed in.
  //   The item carries `_cfg` (RUNTIME ONLY — the builder strips it from every payload and recomputes it on load) and never a sourceRef.
  function buildLine(deps, args) {
    var d = isObj(deps) ? deps : {};
    var a = isObj(args) ? args : {};
    var fam = isObj(a.family) ? a.family : null;
    if (!fam || !d.PF) return null;
    var v = d.PF.validateLine(fam, a.config, a.size, { staff: true });     // STAFF mode: the staff-only 1.2 mm top plate is a valid choice here
    if (!v.ok) return null;
    var basis = isObj(a.basis) ? a.basis : {};
    var unit = num(basis.unitPrice);
    var priced = basis.priced === true && unit > 0;
    var unitPrice = priced ? unit : 0;
    var qty = posInt(a.qty);
    var specs = d.PF.describe(fam, v.config);
    var item = {
      id: fam.primary,
      category: sectionOf(a.primary, fam),
      name: fam.label,
      familyId: fam.id,
      familyVersion: d.FAM ? d.FAM.version : null,
      config: clone(v.config),
      size: clone(v.dims),
      dims: d.PF.sizeTextLabelled(fam, v.dims),
      specs: specs,
      specStr: specString(specs),
      qty: qty,
      unit: str(a.unit) || str(fam.unit) || 'pc',
      unitPrice: unitPrice,
      amount: unitPrice * qty,
      leadTime: '—',
      laborHours: null,
      formulaType: isObj(a.primary) && a.primary.formulaType ? str(a.primary.formulaType) || 'fixed' : 'fixed',
      notes: str(a.note),
      priceBasis: priced ? 'website' : 'manual',
      basisUnitPrice: unitPrice,
      _cfg: {
        reason: basis.reason == null ? null : basis.reason,
        missing: clone(arr(basis.missing)),
        base: num(basis.base),
        deltas: clone(arr(basis.deltas)),
        warnings: clone(arr(basis.warnings)),
        pricedSize: clone(isObj(basis.pricedSize) ? basis.pricedSize : v.dims)
      }
    };
    if (!priced) item.needsPrice = true;
    return item;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  nearestAbsorbed / costBasisFor — the cost basis of a configured line (§4.5)
  // ═══════════════════════════════════════════════════════════════════════
  // There are NO per-option costs in the system. A configured line is costed as the NEAREST standard product (the SKU the family absorbed
  // whose configuration is closest to the chosen one), its cost scaled by how much dearer or cheaper the configured list figure is than
  // that SKU's own list figure. It is the best defensible basis available, and it is labelled approximate whenever it is shown.

  // The value of one group in a configuration; an ABSENT key reads as the group's DEFAULT (owner ruling 2026-10-28). The absorbed configurations never state
  // the staff-only top plate (they are the standard 1.5 mm one) and a line saved before it existed has no `top` either, so comparing raw values would
  // never find the primary "exact" once a family has such a group.
  function groupValue(g, config) {
    return isObj(config) && has(config, g.key) && config[g.key] !== undefined ? config[g.key] : g.default;
  }
  // canonical form of a configuration — the same string PF.canonicalConfig makes for a configuration with every key stated (order-INDEPENDENT for
  // multi because validation already sorts it, order-DEPENDENT for slots), with an absent key read as its default, so "exact" below means
  // PF.sameConfig of the two validated configurations. tests/qb-configured.test.mjs pins the agreement.
  function canonical(family, config) {
    return JSON.stringify(arr(family && family.groups).map(function (g) { return [g.key, groupValue(g, config)]; }));
  }
  function jaccard(a, b) {                       // |A ∩ B| / |A ∪ B|; two empty selections are identical -> 1
    var inter = 0;
    a.forEach(function (x) { if (b.indexOf(x) >= 0) inter++; });
    var union = a.length + b.length - inter;
    return union === 0 ? 1 : inter / union;
  }
  function multisetOverlap(a, b) {               // Σ min(count in A, count in B) / the longer list; two empty lists are identical -> 1
    var ca = Object.create(null), cb = Object.create(null), overlap = 0;     // counters keyed by option value: no inherited key can ever collide
    a.forEach(function (x) { ca[x] = (has(ca, x) ? ca[x] : 0) + 1; });
    b.forEach(function (x) { cb[x] = (has(cb, x) ? cb[x] : 0) + 1; });
    Object.keys(ca).forEach(function (x) { if (has(cb, x)) overlap += Math.min(ca[x], cb[x]); });
    var longest = Math.max(a.length, b.length);
    return longest === 0 ? 1 : overlap / longest;
  }
  // score of a configuration against one absorbed configuration: choice +1 when equal; multi + Jaccard of the selected sets; slots + the
  // multiset overlap of the positions over the longer list
  function scoreConfig(family, config, target) {
    var total = 0;
    arr(family.groups).forEach(function (g) {
      var x = groupValue(g, config), y = groupValue(g, target);
      if (g.type === 'choice') total += (x === y ? 1 : 0);
      else if (g.type === 'multi') total += jaccard(arr(x), arr(y));
      else if (g.type === 'slots') total += multisetOverlap(arr(x), arr(y));
    });
    return total;
  }

  // nearestAbsorbed(family, config) -> { sku, exact, score }
  //   Highest score wins; a TIE goes to the FIRST SKU in the family's `absorbed` map order. `exact` iff the winner's configuration is the
  //   chosen one (PF.sameConfig). { sku: null, exact: false, score: 0 } only for a family that absorbs nothing (every real family absorbs
  //   its primary).
  function nearestAbsorbed(family, config) {
    var abs = isObj(family) && isObj(family.absorbed) ? family.absorbed : {};
    var skus = Object.keys(abs);
    var best = null;
    skus.forEach(function (sku) {
      var s = scoreConfig(family, config, abs[sku]);
      if (best === null || s > best.score + EPS) best = { sku: sku, score: s };
    });
    if (!best) return { sku: null, exact: false, score: 0 };
    return { sku: best.sku, exact: canonical(family, config) === canonical(family, abs[best.sku]), score: best.score };
  }

  function defaultSpecIdx(p) {                   // the option each of a product's specs shows by default (what the calculator's <select> starts on)
    return arr(p && p.specs).map(function (sp) {
      var opts = sp && Array.isArray(sp.options) ? sp.options : [];
      if (!opts.length) return null;
      var i = opts.indexOf(sp.default);
      return i < 0 ? 0 : i;
    });
  }

  // costBasisFor(deps, item, liveById) -> { mat, capLaborPesos, hrs: 0, laborAbsent, hasBasis, isCustom: false, approx, basisSku, scale, note }
  //   The same shape itemCostBasis() returns for a catalogue line, so the true-cost engine needs no special case.
  //   item     a configured line (familyId, config, size, basisUnitPrice, _cfg.base)      liveById  Map product id -> the live DB.products entry
  //   deps.constants  productMeta/config.constants — the materials-index multiplier must be applied to the SKU's list figure exactly as it
  //                   was to the configured one, or the scale would absorb the multiplier
  //   scale = configured list figure ÷ the nearest SKU's own list figure (at its default size), clamped to [0.25, 4]; mat and capLaborPesos
  //   are that SKU's capitalMaterials / capitalLabor × scale; hrs is 0. `approx` unless the SKU's configuration is exactly the chosen one AND
  //   the size is the SKU's own default size AND the scale was not clamped. hasBasis is false when the SKU has no cost on file (both zero),
  //   is not in liveById, or there is no list figure on either side to scale by (an unapproved sheet leaves `_cfg.base` at 0): the panel
  //   then says "No cost basis on this item yet" and the auto-pricer skips the line — never a fabricated scale.
  function costBasisFor(deps, item, liveById) {
    var d = isObj(deps) ? deps : {};
    var it = isObj(item) ? item : {};
    var none = function (sku, note) {
      return { mat: 0, capLaborPesos: 0, hrs: 0, laborAbsent: true, hasBasis: false, isCustom: false, approx: false, basisSku: sku || null, scale: 0, note: note };
    };
    var fam = familyOf(d, it.familyId);
    if (!fam) return none(null, 'unknown product family');
    var near = nearestAbsorbed(fam, it.config);
    if (!near.sku) return none(null, 'no standard model to cost from');
    var sku = lookup(liveById, near.sku);
    if (!isObj(sku)) return none(near.sku, 'no catalogue entry for ' + near.sku);
    var costMat = num(sku.capitalMaterials), costLab = num(sku.capitalLabor);
    if (!(costMat > 0) && !(costLab > 0)) return none(near.sku, 'no cost on file for ' + near.sku);
    var constants = isObj(d.constants) ? d.constants : {};
    var skuDims = isObj(sku.defaultDimensions) ? sku.defaultDimensions : {};
    var skuList = d.PC ? d.PC.priceCatalogItem(sku, { dims: skuDims, runs: null, specIdx: defaultSpecIdx(sku) }, constants).unitPrice : 0;
    var cfgList = num(it.basisUnitPrice) > 0 ? num(it.basisUnitPrice) : (isObj(it._cfg) && num(it._cfg.base) > 0 ? num(it._cfg.base) : 0);
    if (!(skuList > 0) || !(cfgList > 0)) return none(near.sku, 'no list price to scale ' + near.sku + ' by');
    var raw = cfgList / skuList;
    var scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, raw));
    var clamped = scale !== raw;
    var size = isObj(it.size) ? it.size : {};
    var sizeDiffers = Object.keys(isObj(fam.dims) ? fam.dims : {}).some(function (k) {
      return typeof size[k] !== 'number' || typeof skuDims[k] !== 'number' || size[k] !== skuDims[k];
    });
    var mat = costMat * scale, capLaborPesos = costLab * scale;
    return {
      mat: mat,
      capLaborPesos: capLaborPesos,
      hrs: 0,
      laborAbsent: !(capLaborPesos > 0),
      hasBasis: mat > 0 || capLaborPesos > 0,
      isCustom: false,
      approx: !near.exact || sizeDiffers || clamped,
      basisSku: near.sku,
      scale: scale,
      note: clamped ? 'scale clamped' : ''
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  isAutoPriceable — rule R1, the single predicate applyComputedPricing() calls
  // ═══════════════════════════════════════════════════════════════════════
  // A line the cost-plus auto-pricer may reprice: not a fee line, no hand-typed price, and a price basis that is absent (a plain catalogue
  // line, today's behaviour) or 'cost'. 'website' (the figure the client saw) and 'manual' are protected; so is any basis it does not know.
  function isAutoPriceable(item) {
    if (!isObj(item)) return false;
    return item.id !== 'MISCFEE' && !item.priceManual && (item.priceBasis === undefined || item.priceBasis === 'cost');
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  comparableTotal / estimateCheck — the estimate-range check (§7)
  // ═══════════════════════════════════════════════════════════════════════
  // comparableTotal(items, totals): what the client's online estimate can be compared with — the quoted goods ex-VAT, before delivery:
  // Σ amount over the lines that are not MISCFEE fee lines, minus the per-line quantity breaks and the (already capped) quote-level
  // discount. Rush fee, FOC, VAT, delivery / installation and every other fee are not in it. `totals` = computeTotals() (or one
  // options-section's basisTotals); only volumeBreakTotal and discountAmt are read.
  function comparableTotal(items, totals) {
    var t = isObj(totals) ? totals : {};
    var sum = 0;
    arr(items).forEach(function (i) { if (isObj(i) && i.id !== 'MISCFEE') sum += num(i.amount); });
    return sum - num(t.volumeBreakTotal) - num(t.discountAmt);
  }

  // estimateCheck(comparable, estimate) -> { applicable, inRange, low, high, comparable, pctOff, direction }
  //   estimate = the { low, high } the client saw. applicable only when both are positive numbers. inRange is INCLUSIVE at both ends.
  //   pctOff is a PERCENT rounded to 0.1 (12.4 means 12.4 %): how far above `high` (direction 'above') or below `low` ('below'), as a share
  //   of that bound; 0 and direction null when in range or not applicable. The comparable total is taken to the centavo first, so
  //   floating-point noise in a sum of discounts can never turn "exactly at the edge" into "outside".
  function estimateCheck(comparable, estimate) {
    var e = isObj(estimate) ? estimate : null;
    var low = e ? num(e.low) : 0, high = e ? num(e.high) : 0;
    var c = Math.round(num(comparable) * 100) / 100;
    if (!(low > 0 && high > 0)) return { applicable: false, inRange: true, low: low, high: high, comparable: c, pctOff: 0, direction: null };
    var inRange = low <= c && c <= high;
    var direction = inRange ? null : (c > high ? 'above' : 'below');
    var pct = direction === 'above' ? (c - high) / high * 100 : (direction === 'below' ? (low - c) / low * 100 : 0);
    return { applicable: true, inRange: inRange, low: low, high: high, comparable: c, pctOff: Math.round(pct * 10) / 10, direction: direction };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  fromRequestItem — a website request line in the builder's item shape (§6.1, rule R2)
  // ═══════════════════════════════════════════════════════════════════════
  // fromRequestItem(it, line, ref, deps) -> item
  //   it    one quote_requests.items[] row            line  its internal.lines[] row (staff-only, may be null)
  //   ref   the request's reference number ('QR-…'); when given, the line carries sourceRef { kind: 'qr', ref, n } (the request line number)
  //   deps  OPTIONAL { FAM: QR_FAMILIES } (the other helpers' deps object works): a configured row stored BEFORE the staff-only top plate existed has no `top`; with the
  //         family definitions the missing groups are filled with their defaults (the standard 1.5 mm top), so the stored configuration is complete — and EVERY other value
  //         stays exactly as the server stored it. Without deps the configuration is carried over as it is (priceLine reads an absent group as its default anyway).
  //   A CONFIGURED row (it.familyId) becomes a real configured line (familyId, config, size, the server-written option words) at the
  //   figure the client's estimate was built from; a plain row keeps today's shape. Priced -> priceBasis 'website', basisUnitPrice = the
  //   figure, no priceManual (the auto-pricer is held off by the basis, not by a flag). Not priced -> 'manual', needsPrice, unitPrice 0:
  //   NEVER the bare SKU's price (A2). Strings pass through as TEXT — never escaped, never parsed (every renderer escapes).
  function dimString(row) {                        // the builder's own size string: L = length (W), W = width (D), H = height (H); or "N run(s)"
    if (row.runs != null && row.runs !== '' && isFinite(Number(row.runs))) return Number(row.runs) + ' run(s)';
    var sz = row.size;
    if (!isObj(sz)) return '';
    var lab = { W: 'L', D: 'W', H: 'H' }, parts = [];
    ['W', 'D', 'H'].forEach(function (k) {
      if (sz[k] != null && sz[k] !== '' && isFinite(Number(sz[k]))) parts.push(lab[k] + Number(sz[k]));
    });
    return parts.length ? parts.join(' × ') + ' mm' : '';
  }
  function numericSize(sz) {                       // only W / D / H, only finite numbers
    var out = {};
    if (isObj(sz)) ['W', 'D', 'H'].forEach(function (k) { if (typeof sz[k] === 'number' && isFinite(sz[k])) out[k] = sz[k]; });
    return out;
  }
  function fromRequestItem(it, line, ref, deps) {
    var row = isObj(it) ? it : {};
    var ln = isObj(line) ? line : null;
    var listPrice = ln ? Number(ln.unitPrice) : 0;
    var priced = !!(ln && ln.priced === true) && isFinite(listPrice) && listPrice > 0;     // the server writes a boolean; anything else fails closed
    var unitPrice = priced ? listPrice : 0;
    var specs = arr(row.specs).map(function (s) { return { label: str(s && s.label), value: str(s && s.value) }; });
    var qty = posInt(row.qty);
    var configured = !!row.familyId;
    var out = {
      id: str(row.id),
      category: str(row.cat),
      name: str(row.name),
      dims: dimString(row),
      specs: specs,
      specStr: configured ? specString(specs) : specs.map(function (s) { return s.value; }).filter(Boolean).join(', '),
      qty: qty,
      unit: str(row.unit) || 'pc',
      unitPrice: unitPrice,
      amount: unitPrice * qty,
      leadTime: '—',
      laborHours: null,
      formulaType: (ln && str(ln.formulaType)) || 'fixed',
      notes: str(row.note),
      priceBasis: priced ? 'website' : 'manual',
      basisUnitPrice: unitPrice
    };
    if (configured) {
      out.familyId = str(row.familyId);
      out.config = isObj(row.config) ? clone(row.config) : {};
      var rowFam = isObj(row.config) ? familyOf(deps, out.familyId) : null;
      if (rowFam) out.config = completeConfig(rowFam, out.config);
      out.size = numericSize(row.size);
    }
    if (!priced) out.needsPrice = true;
    if (typeof ref === 'string' && ref) {
      out.sourceRef = { kind: 'qr', ref: ref };
      var n = Math.floor(num(row.n)) > 0 ? Math.floor(num(row.n)) : (ln && Math.floor(num(ln.n)) > 0 ? Math.floor(num(ln.n)) : 0);
      if (n) out.sourceRef.n = n;
    }
    return out;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  purposeFor / locationCodeFor — the hand-off tables (§6.3, §6.4)
  // ═══════════════════════════════════════════════════════════════════════
  // Values are EXACTLY the options of the builder's #purpose select; anything unknown is 'Other'.
  var P_REST = 'Restaurant', P_HOTEL = 'Hotel Restaurant', P_INST = 'Hospital / Institutional', P_GOV = 'Government / Bidding',
      P_HOME = 'Residential', P_CAFE = 'Cafe / Coffee Shop', P_CATER = 'Catering / Food Service', P_OTHER = 'Other';
  // the public quote form's "What will you use this for?" (js/qr-def.js INTAKE.useFor)
  var PURPOSE_BY_USE_FOR = {
    restaurant_cafe: P_REST, hotel_resort: P_HOTEL, commissary: P_CATER, catering: P_CATER, school: P_INST, hospital: P_INST,
    government: P_GOV, home: P_HOME, other: P_OTHER
  };
  // the project brief's "Project type" (js/cir-forms.js project_brief_v2 `project_type`); bakery has no builder equivalent (open question 4)
  var PURPOSE_BY_PROJECT_TYPE = {
    restaurant: P_REST, cafe: P_CAFE, bakery: P_OTHER, commissary: P_CATER, hotel: P_HOTEL, catering: P_CATER, hospital: P_INST,
    school: P_INST, laboratory: P_INST, government: P_GOV, home: P_HOME, other: P_OTHER
  };
  // the old brief's free-text business type: the first group with a keyword in the text wins (case-insensitive)
  var PURPOSE_KEYWORDS = [
    [P_HOTEL, ['hotel']],
    [P_CAFE, ['caf']],
    [P_REST, ['restaurant', 'grill', 'fast']],
    [P_INST, ['hospital', 'clinic', 'school', 'univers', 'lab']],
    [P_GOV, ['government', 'lgu', 'agency']],
    [P_HOME, ['home', 'residen']],
    [P_CATER, ['commissary', 'catering', 'central']]
  ];
  function purposeFor(src) {
    var s = isObj(src) ? src : {};
    if (s.entityType === 'government') return P_GOV;          // a government entity is a bidding, whatever it will use the kitchen for
    if (typeof s.useFor === 'string' && s.useFor) return has(PURPOSE_BY_USE_FOR, s.useFor) ? PURPOSE_BY_USE_FOR[s.useFor] : P_OTHER;
    if (typeof s.cirProjectType === 'string' && s.cirProjectType) return has(PURPOSE_BY_PROJECT_TYPE, s.cirProjectType) ? PURPOSE_BY_PROJECT_TYPE[s.cirProjectType] : P_OTHER;
    if (typeof s.cirBizType === 'string' && s.cirBizType) {
      var text = s.cirBizType.toLowerCase();
      for (var i = 0; i < PURPOSE_KEYWORDS.length; i++) {
        var words = PURPOSE_KEYWORDS[i][1];
        for (var j = 0; j < words.length; j++) if (text.indexOf(words[j]) >= 0) return PURPOSE_KEYWORDS[i][0];
      }
    }
    return P_OTHER;
  }

  // The builder's #qnoLoc codes, checked in this order; the first rule with a place name in the address wins, else OT. A place name is
  // matched as a whole word or phrase (so the short ones — NCR, BGC — are not found inside "concrete").
  var LOCATION_RULES = [
    ['LU', ['la union']],
    ['BG', ['baguio', 'benguet']],
    ['SB', ['subic', 'olongapo', 'zambales']],
    ['CL', ['clark', 'angeles', 'pampanga', 'mabalacat']],
    ['DA', ['davao']],
    ['CB', ['cebu', 'mandaue', 'lapu-lapu', 'lapu lapu']],
    ['IG', ['ilocos', 'vigan', 'laoag']],
    ['ML', ['metro manila', 'manila', 'ncr', 'quezon city', 'makati', 'pasig', 'taguig', 'mandaluyong', 'pasay', 'parañaque', 'paranaque',
            'caloocan', 'marikina', 'muntinlupa', 'las piñas', 'las pinas', 'valenzuela', 'malabon', 'navotas', 'san juan', 'pateros', 'bgc']]
  ];
  function isAlnum(ch) { return ch !== '' && /[a-z0-9]/.test(ch); }
  function hasPlace(text, place) {
    var from = 0;
    for (;;) {
      var at = text.indexOf(place, from);
      if (at < 0) return false;
      var before = at === 0 ? '' : text.charAt(at - 1);
      var after = text.charAt(at + place.length);
      if (!isAlnum(before) && !isAlnum(after)) return true;
      from = at + 1;
    }
  }
  function locationCodeFor(addressText) {
    var text = typeof addressText === 'string' ? addressText : '';
    if (typeof text.normalize === 'function') text = text.normalize('NFC');
    text = text.toLowerCase().replace(/\s+/g, ' ');
    for (var i = 0; i < LOCATION_RULES.length; i++) {
      var places = LOCATION_RULES[i][1];
      for (var j = 0; j < places.length; j++) if (hasPlace(text, places[j])) return LOCATION_RULES[i][0];
    }
    return 'OT';
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  migrateLegacyConfiguredLine — an old plain line -> a configured line (§10.3)
  // ═══════════════════════════════════════════════════════════════════════
  // A plain line whose id is a SKU a family absorbed — a catalogue pick, or an old request hand-off line named "<family> (configured)" —
  // becomes a configured line via PF.migrateAbsorbed (the SKU's own configuration, its saved options applied through the family's
  // specMap, its saved size kept on the step). It KEEPS the unit price and lands priceBasis 'manual' (priceManual when there is a price,
  // needsPrice when there is none): converting never reprices a quote, and the website figure is for staff to look at, not for the
  // conversion to apply. Everything else on the line (_uid, notes, qty, passThrough…) is carried over; the cost snapshots are dropped
  // (a configured line is costed by costBasisFor). The saved size is read from item.size when the line has one, else parsed from its
  // dims text ("L1200 × W600 × H850 mm"; mm, cm or m). -> a NEW item, or null when the line is already configured or no family absorbed its id.
  // SECTION: the line KEEPS the section (category) it already sits in. Only a line with none takes its category from the family's primary product, looked up in the optional
  // third argument `catalogue` (a Map or plain object of product id -> product, the same lookup costBasisFor takes), else the family's public category.
  function parseDims(s) {
    if (typeof s !== 'string') return null;
    var u = /(mm|cm|m)\s*$/i.exec(s.trim());
    if (!u) return null;
    var f = { mm: 1, cm: 10, m: 1000 }[u[1].toLowerCase()];
    var axis = { L: 'W', W: 'D', H: 'H' }, out = {}, found = false, m;
    var re = /([LWH])\s*([0-9]+(?:\.[0-9]+)?)/g;
    while ((m = re.exec(s)) !== null) {
      if (!has(out, axis[m[1]])) { out[axis[m[1]]] = Math.round(parseFloat(m[2]) * f); found = true; }
    }
    return found ? out : null;
  }
  function migrateLegacyConfiguredLine(deps, item, catalogue) {
    var d = isObj(deps) ? deps : {};
    if (!isObj(item) || item.familyId || !d.PF || !d.FAM || typeof item.id !== 'string' || !item.id) return null;
    var saved = isObj(item.size) ? numericSize(item.size) : parseDims(item.dims);
    var mig = d.PF.migrateAbsorbed(d.FAM, item.id, { specs: arr(item.specs), size: saved });
    if (!mig) return null;
    var fam = familyOf(d, mig.familyId);
    if (!fam) return null;
    var v = d.PF.validateLine(fam, mig.config, mig.dims, { staff: true });
    if (!v.ok) return null;
    var out = copyObj(item);
    delete out.capitalMaterials; delete out.capitalLabor; delete out._cfg;
    var qty = posInt(item.qty);
    var unitPrice = num(item.unitPrice) > 0 ? num(item.unitPrice) : 0;
    var specs = d.PF.describe(fam, v.config);
    out.id = fam.primary;
    // the section the line already sits in is KEPT (a converted line does not move); a line with none takes the base product's category from the catalogue passed in, else the family's public one
    if (!(typeof item.category === 'string' && item.category)) out.category = sectionOf(lookup(catalogue, fam.primary), fam);
    out.name = fam.label;
    out.familyId = fam.id;
    out.familyVersion = d.FAM.version;
    out.config = clone(v.config);
    out.size = clone(v.dims);
    out.dims = d.PF.sizeTextLabelled(fam, v.dims);
    out.specs = specs;
    out.specStr = specString(specs);
    out.qty = qty;
    out.unit = str(item.unit) || str(fam.unit) || 'pc';
    out.unitPrice = unitPrice;
    out.amount = unitPrice * qty;
    out.priceBasis = 'manual';
    out.basisUnitPrice = 0;
    if (unitPrice > 0) { out.priceManual = true; delete out.needsPrice; } else { out.needsPrice = true; delete out.priceManual; }
    return out;
  }

  return {
    priceLine: priceLine,
    buildLine: buildLine,
    costBasisFor: costBasisFor,
    nearestAbsorbed: nearestAbsorbed,
    fromRequestItem: fromRequestItem,
    purposeFor: purposeFor,
    locationCodeFor: locationCodeFor,
    comparableTotal: comparableTotal,
    estimateCheck: estimateCheck,
    isAutoPriceable: isAutoPriceable,
    migrateLegacyConfiguredLine: migrateLegacyConfiguredLine
  };
});
