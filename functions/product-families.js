// js/product-families.js — pure helpers for the eleven CONFIGURABLE product families of the public catalogue
// (specs/PRODUCT-CONFIGURATOR-SPEC.md, simplified by the owner's 2026-10-21 ruling; five more families added 2026-10-28, specs/CONFIGURATOR-FAMILIES-2-SPEC.md).
//
// The family DEFINITIONS (options, defaults, size limits, absorbed SKUs, preview rules) are DATA: scripts/public-families.json,
// compiled by scripts/build-catalogue.js into js/qr-families.js (window.QR_FAMILIES). This file holds the LOGIC that walks that
// data, and nothing else: validating a configuration and a size against a family (strictly — an unknown key or value is an
// error, never ignored), describing a configuration in words, the usual minimum length, the preview-image keys, converting an
// old saved SKU line into its family line, and listing the cells of a family's private option sheet.
//
// ONE FILE, FOUR CONSUMERS, SAME BYTES (ci-invariants CHECK 10 — edit THIS file, then
// `cp js/product-families.js functions/product-families.js`):
//   - the public /catalogue/ page (js/quote-request.js, js/qr-preview.js) renders the configurator from it and mirrors the
//     server's validation for UX only;
//   - the Cloud Functions (functions/qr-core.js) are the AUTHORITY: every line a visitor sends is re-validated here;
//   - the staff "Family pricing" screen lists the cells of each family's option sheet from it;
//   - the tests.
//
// It carries NO figure of any kind — no price, rate, formula or amount — because it ships to the public page. The option
// amounts are kept in private staff data, read by server-side and staff-side code that no public page ever loads.
//
// STANDARD CONSTRUCTION (owner ruling 2026-10-28): a family may carry a public `construction` sentence (how the made-to-order piece is built,
// e.g. the 1.5 mm top plate and the 1.2 mm body) — constructionLine() fills its {group} tokens from the chosen options — and a group may be
// marked `staffOnly` (the 1.2 mm top plate): it is never offered on the website, the server (which validates without opts) refuses any value
// but its default, and only a staff session (opts.staff === true: the Quote Builder, the Family pricing screen) may choose another.
//
// CONDITIONAL OPTIONS (CONFIGURATOR-FAMILIES-2-SPEC §4): a group may carry `when: { <earlier choice group>: [values] }` — it applies only while the choices made before it
// are in those lists (fry baskets only for a fryer, a pre-rinse sink only on the soiled side of a dish table). An option that does not apply is ALWAYS at its default in
// a validated configuration, so a stored configuration is canonical and the pricing code (which adds nothing for a default) needs no knowledge of it. A family may also
// carry `maxDimWhen`, the upper-limit twin of `minDimWhen` (a slim hood is at most 500 mm deep; a deck oven's width follows its trays).
//
// UMD-ish shim, like js/qr-def.js: browser <script> -> window.ProductFamilies; Node require() -> module.exports. No dependencies;
// ES5 on purpose (the public pages target old phones too). Pure: no DOM, no clock, no randomness, no I/O.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;   // functions/ + tests
  if (root) root.ProductFamilies = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var DIM_KEYS = ['W', 'D', 'H'];
  var DIM_LABEL_SHORT = { W: 'L', D: 'W', H: 'H' };   // the Quote Builder's own L / W / H labelling of W / D / H

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isPlain(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }

  // ── lookups ────────────────────────────────────────────────────────────────
  function groupOf(family, key) {
    var gs = (family && family.groups) || [];
    for (var i = 0; i < gs.length; i++) if (gs[i].key === key) return gs[i];
    return null;
  }
  // The option of a group whose value is EXACTLY v (type included: 1 is not '1', true is not 'true').
  function optionOf(group, v) {
    var os = (group && group.options) || [];
    for (var i = 0; i < os.length; i++) if (os[i].v === v) return os[i];
    return null;
  }
  function optionIndex(group, v) {
    var os = (group && group.options) || [];
    for (var i = 0; i < os.length; i++) if (os[i].v === v) return i;
    return -1;
  }
  // publicGroups(family) -> the groups a visitor to the WEBSITE may choose from: every group except the staff-only ones (the 1.2 mm top plate is
  // offered in the Quote Builder only). The website's configurator, the catalogue card and the product pages walk THIS list, never `groups`.
  function publicGroups(family) {
    return ((family && family.groups) || []).filter(function (g) { return g.staffOnly !== true; });
  }

  // ── conditional groups (`when`) ───────────────────────────────────────────
  // groupApplies(family, g, config) -> boolean   true when the group has no `when`, else when EVERY key of `when` names an earlier choice whose value in `config`
  // (or, when the config does not state it, that choice's default) is one of the listed values. An option that does not apply is never shown, never described, never
  // priced and — in a validated configuration — always at its default.
  function groupApplies(family, g, config) {
    if (!g || !isPlain(g.when)) return true;
    var cfg = isPlain(config) ? config : {};
    return Object.keys(g.when).every(function (k) {
      var gate = groupOf(family, k);
      var val = has(cfg, k) && cfg[k] !== undefined ? cfg[k] : (gate ? gate.default : undefined);
      var allowed = g.when[k];
      return Array.isArray(allowed) && allowed.indexOf(val) >= 0;
    });
  }
  // activeGroups(family, config) -> the groups that apply to this configuration; publicActiveGroups -> the ones a visitor to the website may see.
  function activeGroups(family, config) {
    return ((family && family.groups) || []).filter(function (g) { return groupApplies(family, g, config); });
  }
  function publicActiveGroups(family, config) {
    return activeGroups(family, config).filter(function (g) { return g.staffOnly !== true; });
  }
  // whenText(family, g) -> "Type is Fryer" / "Type is Griddle or Lava-rock griller" / several keys joined with " and " (labels, never stored values); '' for a group with no `when`.
  function whenText(family, g) {
    if (!g || !isPlain(g.when)) return '';
    return Object.keys(g.when).map(function (k) {
      var gate = groupOf(family, k);
      var labels = (Array.isArray(g.when[k]) ? g.when[k] : []).map(function (v) { var o = optionOf(gate, v); return o ? String(o.l) : String(v); });
      return (gate ? gate.label : k) + ' is ' + labels.join(' or ');
    }).join(' and ');
  }

  // ── defaults ───────────────────────────────────────────────────────────────
  function defaultConfig(family) {
    var out = {};
    ((family && family.groups) || []).forEach(function (g) { out[g.key] = clone(g.default); });
    return out;
  }
  function defaultDims(family) {
    var out = {};
    DIM_KEYS.forEach(function (k) { if (family.dims && has(family.dims, k)) out[k] = family.dims[k].default; });
    return out;
  }

  // ── configuration ─────────────────────────────────────────────────────────
  // validateConfiguration(family, raw, opts) -> { ok, errors:string[], config }
  //   STRICT allowlist: `raw` must be a plain object; a key the family does not define is an error (so is __proto__ / constructor);
  //   a value must equal one of the group's option values exactly (type included). A key that is ABSENT takes the family default.
  //   slots: an array of option values, minSlots..maxSlots long, order kept. multi: an array of distinct option values, put into the
  //   family's own option order (so two equal selections always serialise identically).
  //   `opts` is OPTIONAL. PUBLIC mode (no opts, or opts.staff !== true — the server, the website, the default): a staff-only group (g.staffOnly) that
  //   is PRESENT with any value but its default is an error and the config takes the default; present-and-default is accepted. STAFF mode
  //   (opts.staff === true): a staff-only group is validated like any other choice. An ABSENT key takes the default in both modes.
  //   CONDITIONAL groups (`when`), BOTH modes: groups are walked in order, so the choices a group depends on are already in `config`. A group that does NOT apply
  //   (see groupApplies) and is PRESENT with a value other than its default is an error ('"Fry baskets" applies only when Type is Fryer.') and takes the default;
  //   absent or equal to the default it is silently the default. So a validated configuration is canonical: an option that does not apply is always at its default.
  function validateConfiguration(family, raw, opts) {
    var staff = !!(opts && opts.staff === true);
    var errors = [];
    var config = {};
    if (!isPlain(raw)) return { ok: false, errors: ['The options must be a set of choices.'], config: defaultConfig(family) };
    var keys = Object.keys(raw);
    keys.forEach(function (k) {
      if (!groupOf(family, k)) errors.push('"' + String(k).slice(0, 40) + '" is not an option of this product.');
    });
    (family.groups || []).forEach(function (g) {
      var present = has(raw, g.key) && raw[g.key] !== undefined;
      var v = present ? raw[g.key] : clone(g.default);
      if (g.type === 'choice') {
        if (g.staffOnly === true && !staff && present && v !== g.default) {
          errors.push('"' + g.label + '" is chosen by our staff when the quotation is prepared.');
          config[g.key] = clone(g.default);
          return;
        }
        if (optionIndex(g, v) < 0) { errors.push('Choose one of the available options for "' + g.label + '".'); config[g.key] = clone(g.default); return; }
        config[g.key] = v;
      } else if (g.type === 'slots') {
        if (!Array.isArray(v) || v.length < g.minSlots || v.length > g.maxSlots) {
          errors.push('"' + g.label + '": choose between ' + g.minSlots + ' and ' + g.maxSlots + '.');
          config[g.key] = clone(g.default); return;
        }
        var okSlots = true;
        for (var i = 0; i < v.length; i++) if (typeof v[i] !== 'string' || optionIndex(g, v[i]) < 0) okSlots = false;
        if (!okSlots) { errors.push('"' + g.label + '": one of the choices is not available.'); config[g.key] = clone(g.default); return; }
        config[g.key] = v.slice();
      } else if (g.type === 'multi') {
        if (!Array.isArray(v)) { errors.push('"' + g.label + '" must be a list.'); config[g.key] = clone(g.default); return; }
        var seen = {};
        var okMulti = true;
        for (var j = 0; j < v.length; j++) {
          if (typeof v[j] !== 'string' || optionIndex(g, v[j]) < 0 || has(seen, v[j])) okMulti = false;
          else seen[v[j]] = true;
        }
        if (!okMulti) { errors.push('"' + g.label + '": one of the choices is not available, or is listed twice.'); config[g.key] = clone(g.default); return; }
        config[g.key] = g.options.map(function (o) { return o.v; }).filter(function (x) { return has(seen, x); });
      } else {
        errors.push('Unknown option type for "' + g.label + '".');
      }
      // a conditional option that does not apply can only be at its default (arrays included: compared as text)
      if (has(config, g.key) && !groupApplies(family, g, config) && JSON.stringify(config[g.key]) !== JSON.stringify(g.default)) {
        errors.push('"' + g.label + '" applies only when ' + whenText(family, g) + '.');
        config[g.key] = clone(g.default);
      }
    });
    return { ok: errors.length === 0, errors: errors, config: config };
  }

  // ── size ───────────────────────────────────────────────────────────────────
  // The usual minimum length for the chosen options: widthRule = { hard, allowance, terms:[{group, perUnit?}] }. A term with
  // perUnit multiplies a numeric choice (sinks x 500 mm); a term without one adds the `w` of each selected option (slots / multi).
  // Rounded UP to the length step and never below the axis minimum. -> { mm, hard, noun } or null when the family has no rule.
  function minWidth(family, config) {
    var r = family && family.widthRule;
    if (!r || !family.dims || !family.dims.W) return null;
    var total = r.allowance || 0;
    (r.terms || []).forEach(function (t) {
      var g = groupOf(family, t.group);
      if (!g) return;
      if (!groupApplies(family, g, config)) return;                  // an option that does not apply adds nothing to the length
      var val = config ? config[t.group] : undefined;
      if (t.perUnit != null) { if (typeof val === 'number') total += val * t.perUnit; return; }
      if (Array.isArray(val)) val.forEach(function (x) { var o = optionOf(g, x); if (o && typeof o.w === 'number') total += o.w; });
    });
    var step = family.dims.W.step || 10;
    var mm = Math.ceil(total / step) * step;
    mm = Math.max(mm, family.dims.W.min);
    mm = Math.min(mm, family.dims.W.max);
    return { mm: mm, hard: !!r.hard, noun: r.noun || 'options' };
  }

  // The limits a chosen option forces. `listKey` is the family's rule list (minDimWhen / maxDimWhen: [{group, includes, min|max:{W?,D?,H?}}]), `valueKey` the
  // limit inside a rule ('min' / 'max'); `larger` says which rule wins when several hold on one axis (the largest minimum, the smallest maximum). A rule whose
  // group does not apply (see groupApplies) is skipped.
  function forcedLimits(family, config, listKey, valueKey, larger) {
    var out = {};
    ((family && family[listKey]) || []).forEach(function (rule) {
      var g = groupOf(family, rule.group);
      if (g && !groupApplies(family, g, config)) return;
      var val = config ? config[rule.group] : undefined;
      var hit = Array.isArray(val) ? val.indexOf(rule.includes) >= 0 : val === rule.includes;
      if (!hit) return;
      Object.keys(rule[valueKey] || {}).forEach(function (k) {
        var n = rule[valueKey][k];
        if (out[k] == null || (larger ? n > out[k] : n < out[k])) out[k] = n;
      });
    });
    return out;
  }
  // The minimums a chosen add-on forces (minDimWhen: [{group, includes, min:{D,H}}]) -> { D?, H?, W? } (largest wins).
  function forcedMins(family, config) { return forcedLimits(family, config, 'minDimWhen', 'min', true); }
  // The upper limits a chosen option forces (maxDimWhen: [{group, includes, max:{D,H}}]) -> { D?, H?, W? } (smallest wins).
  function forcedMaxes(family, config) { return forcedLimits(family, config, 'maxDimWhen', 'max', false); }

  // standardDims(family, config) -> the size a configuration is normally built at: the family's default size with the length raised to the usual length of the
  // chosen options (sinks, burners, add-ons) and any forced minimum (an oven's width and height) applied, then any axis above a forced MAXIMUM (a slim hood's depth,
  // a deck oven's width) lowered to it. A size equal to this is NOT a custom size.
  function standardDims(family, config) {
    var cfg = config || defaultConfig(family);
    var d = defaultDims(family);
    var mw = minWidth(family, cfg);
    if (mw && d.W != null && d.W < mw.mm) d.W = mw.mm;
    var fm = forcedMins(family, cfg);
    Object.keys(fm).forEach(function (k) { if (d[k] != null && d[k] < fm[k]) d[k] = fm[k]; });
    var fx = forcedMaxes(family, cfg);
    Object.keys(fx).forEach(function (k) { if (d[k] != null && d[k] > fx[k]) d[k] = fx[k]; });
    return d;
  }

  // validateDims(family, raw, config) -> { ok, errors, warnings, dims }
  //   `raw` is a plain object limited to the family's own axes; an absent / null axis takes the size these options are normally built at (standardDims — the family
  //   default for the default options; a deck oven with six trays per deck is 1200 mm wide, not 700). Each value is a whole number of millimetres inside [min, max],
  //   on the step. A HARD width rule, a forced minimum and a forced maximum are errors; a soft width rule is a warning.
  function validateDims(family, raw, config) {
    var errors = [];
    var warnings = [];
    var dims = {};
    var spec = family.dims || {};
    if (raw != null && !isPlain(raw)) return { ok: false, errors: ['The size must be a set of length / width / height values.'], warnings: warnings, dims: defaultDims(family) };
    var given = raw || {};
    var usual = standardDims(family, config || defaultConfig(family));          // what an axis the caller left out becomes
    Object.keys(given).forEach(function (k) { if (!has(spec, k)) errors.push('This product has no "' + String(k).slice(0, 20) + '" size.'); });
    Object.keys(spec).forEach(function (k) {
      var d = spec[k];
      var v = has(given, k) && given[k] != null ? given[k] : (usual[k] != null ? usual[k] : d.default);
      if (!isInt(v) || v < d.min || v > d.max || v % d.step !== 0) {
        errors.push(d.label + ' must be a whole number of millimetres from ' + d.min + ' to ' + d.max + ', in steps of ' + d.step + '.');
        dims[k] = d.default;
        return;
      }
      dims[k] = v;
    });
    if (!errors.length) {
      var mw = minWidth(family, config || defaultConfig(family));
      if (mw && dims.W < mw.mm) {
        if (mw.hard) errors.push('The length must be at least ' + mw.mm + ' mm for these ' + mw.noun + '.');
        else warnings.push('That is shorter than the ' + mw.mm + ' mm we usually build for these ' + mw.noun + ' — we will confirm the layout in your quotation.');
      }
      var fm = forcedMins(family, config || defaultConfig(family));
      Object.keys(fm).forEach(function (k) {
        if (has(dims, k) && dims[k] < fm[k]) errors.push('With these options the ' + String(spec[k].label).toLowerCase() + ' must be at least ' + fm[k] + ' mm.');
      });
      var fx = forcedMaxes(family, config || defaultConfig(family));
      Object.keys(fx).forEach(function (k) {
        if (has(dims, k) && dims[k] > fx[k]) errors.push('With these options the ' + String(spec[k].label).toLowerCase() + ' must be at most ' + fx[k] + ' mm.');
      });
    }
    return { ok: errors.length === 0, errors: errors, warnings: warnings, dims: dims };
  }

  // validateLine(family, rawConfig, rawDims, opts) -> { ok, errors, warnings, config, dims, custom }   (the one call the server makes — without opts,
  // so a staff-only option is refused there; staff sessions pass { staff: true })
  function validateLine(family, rawConfig, rawDims, opts) {
    var c = validateConfiguration(family, rawConfig, opts);
    var d = validateDims(family, rawDims, c.config);
    var std = standardDims(family, c.config);
    var custom = Object.keys(std).some(function (k) { return d.dims[k] !== std[k]; });
    return { ok: c.ok && d.ok, errors: c.errors.concat(d.errors), warnings: d.warnings, config: c.config, dims: d.dims, custom: custom };
  }

  // ── words ──────────────────────────────────────────────────────────────────
  function sizeText(family, dims) {
    var parts = [];
    DIM_KEYS.forEach(function (k) { if (family.dims && has(family.dims, k) && dims && dims[k] != null) parts.push(String(dims[k])); });
    return parts.length ? parts.join(' × ') + ' mm' : '';
  }
  function sizeTextLabelled(family, dims) {     // "L1200 × W600 × H850 mm": each figure led by the initial of the family's own axis label (Length, Width, Depth, Height)
    var parts = [];
    DIM_KEYS.forEach(function (k) {
      if (family.dims && has(family.dims, k) && dims && dims[k] != null) parts.push(String((family.dims[k].label || DIM_LABEL_SHORT[k] || k)).charAt(0).toUpperCase() + dims[k]);
    });
    return parts.length ? parts.join(' × ') + ' mm' : '';
  }
  function slotWords(g, v, field) { var o = optionOf(g, v); return o ? (o[field] || o.l) : String(v); }

  // constructionLine(family, config) -> "SS304 stainless steel · 1.5 mm (16 ga) top plate · 1.2 mm body and panels · square-tube posts with adjustable bullet feet"
  //   The family's `construction` sentence with each {group} token replaced by the chosen option's `c` phrase (fallback its `f`, then its `l`). A value that is
  //   absent or not one of the group's options reads as the group's default. '' for a family with no `construction`. No full stop at the end (a page adds
  //   its own). Pure; never throws.
  function constructionLine(family, config) {
    var tpl = family && typeof family.construction === 'string' ? family.construction : '';
    if (!tpl) return '';
    var cfg = isPlain(config) ? config : {};
    return tpl.replace(/\{([A-Za-z0-9_]+)\}/g, function (m, key) {
      var g = groupOf(family, key);
      if (!g) return '';
      var o = has(cfg, key) ? optionOf(g, cfg[key]) : null;
      if (!o) o = optionOf(g, g.default);
      return o ? String(o.c || o.f || o.l) : '';
    });
  }

  // describe(family, config) -> [{ label, value }]  one row per PUBLIC option group that APPLIES to this configuration, in the family's order, then the Construction
  // row (the staff view, the receipt and the printed quote). A staff-only group has no row of its own: the Construction row already says which top plate it is. An
  // option that does not apply (fry baskets on a griddle) has no row.
  function describe(family, config) {
    var rows = [];
    publicGroups(family).forEach(function (g) {
      if (!groupApplies(family, g, config)) return;
      var v = config ? config[g.key] : undefined;
      if (g.type === 'choice') {
        var o = optionOf(g, v);
        rows.push({ label: g.label, value: o ? (o.hint ? o.l + ' (' + o.hint + ')' : o.l) : String(v) });
      } else if (g.type === 'slots') {
        var list = Array.isArray(v) ? v : [];
        rows.push({ label: g.label, value: list.map(function (x, i) { return (i + 1) + '. ' + slotWords(g, x, 'f'); }).join(', ') });
      } else if (g.type === 'multi') {
        var sel = Array.isArray(v) ? v : [];
        rows.push({ label: g.label, value: sel.length ? sel.map(function (x) { return slotWords(g, x, 'l'); }).join(', ') : 'None' });
      }
    });
    if (family && typeof family.construction === 'string' && family.construction) rows.push({ label: 'Construction', value: constructionLine(family, config) });
    return rows;
  }
  // summaryParts(family, config) -> string[]   the short phrases of the one-line summary. A staff-only choice (the top plate) contributes its phrase only when
  // it is NOT the standard one ("1.2 mm top"), so every public summary reads exactly as before. An option that does not apply contributes nothing.
  function summaryParts(family, config) {
    var parts = [];
    (family.groups || []).forEach(function (g) {
      if (!groupApplies(family, g, config)) return;                 // an option that does not apply says nothing
      var v = config ? config[g.key] : undefined;
      if (g.type === 'choice') {
        if (g.staffOnly === true && (v === undefined || v === g.default)) return;
        var o = optionOf(g, v);
        parts.push(o ? (o.s || o.l) : String(v));
      } else if (g.type === 'slots') {
        var list = Array.isArray(v) ? v : [];
        var u = g.unit || { one: 'position', many: 'positions' };
        parts.push(list.length + ' ' + (list.length === 1 ? u.one : u.many) + ' (' + list.map(function (x) { return slotWords(g, x, 's'); }).join(', ') + ')');
      } else if (g.type === 'multi') {
        var sel = Array.isArray(v) ? v : [];
        parts.push(sel.length ? (g.withText || 'with') + ' ' + sel.map(function (x) { return slotWords(g, x, 's'); }).join(', ') : (g.noneText || 'none'));
      }
    });
    return parts;
  }
  // summaryLine(family, config, dims) -> "Sink — 2 sinks · centred · with undershelf · gooseneck faucet · 1800 × 700 × 900 mm"
  function summaryLine(family, config, dims) {
    var parts = summaryParts(family, config);
    var sz = sizeText(family, dims);
    if (sz) parts.push(sz);
    return family.label + ' — ' + parts.join(' · ');
  }

  // sameConfig / canonicalConfig — order-independent for multi (already canonical after validation), order-DEPENDENT for slots.
  function canonicalConfig(family, config) {
    var out = [];
    (family.groups || []).forEach(function (g) { out.push([g.key, config ? config[g.key] : null]); });
    return JSON.stringify(out);
  }
  function sameConfig(family, a, b) { return canonicalConfig(family, a) === canonicalConfig(family, b); }

  // ── preview image keys ─────────────────────────────────────────────────────
  // A family's `preview` = { tokens, chain, insets?, insetEach?, liveDiagram? }. Each token turns the current configuration into a
  // piece of a file name; `chain` lists the keys to try from MOST specific to LEAST (the first one the manifest has wins, else the
  // generated placeholder); `insets` / `insetEach` name optional secondary images (a faucet close-up, a burner close-up).
  // The keys are exactly the file names of the owner's shot list (docs/configurator-preview-photo-list.md).
  function tokenValue(tok, config) {
    if (tok.from != null) {
      var s = String(config ? config[tok.from] : undefined);
      if (tok.map) return has(tok.map, s) ? tok.map[s] : null;
      return s;
    }
    if (tok.count != null) return String(Array.isArray(config && config[tok.count]) ? config[tok.count].length : 0);
    if (tok.firstOf != null) {
      var sel = config && Array.isArray(config[tok.firstOf]) ? config[tok.firstOf] : [];
      var order = tok.order || [];
      for (var i = 0; i < order.length; i++) if (sel.indexOf(order[i]) >= 0) return order[i];
      return null;
    }
    return null;
  }
  function fill(template, tokens) {
    var ok = true;
    var out = String(template).replace(/\{([A-Za-z0-9_]+)\}/g, function (m, name) {
      var v = has(tokens, name) ? tokens[name] : null;
      if (v === null || v === undefined) { ok = false; return ''; }
      return v;
    });
    return ok ? out : null;
  }
  function pushUnique(list, v) { if (v !== null && v !== undefined && list.indexOf(v) < 0) list.push(v); }
  function whenHolds(when, config) {
    if (!when) return true;
    return Object.keys(when).every(function (k) { return config && config[k] === when[k]; });
  }

  // previewKeys(family, config) -> { chain:string[], insets:string[] }
  function previewKeys(family, config) {
    var p = family && family.preview;
    var out = { chain: [], insets: [] };
    if (!p) return out;
    var tokens = {};
    Object.keys(p.tokens || {}).forEach(function (name) { tokens[name] = tokenValue(p.tokens[name], config); });
    (p.chain || []).forEach(function (t) { pushUnique(out.chain, fill(t, tokens)); });
    (p.insets || []).forEach(function (ins) { if (whenHolds(ins.when, config)) pushUnique(out.insets, fill(ins.template, tokens)); });
    if (p.insetEach) {
      var g = p.insetEach.over;
      var list = config && Array.isArray(config[g.kinds]) ? config[g.kinds] : [];
      list.forEach(function (x) {
        var kind = has(g.map || {}, x) ? g.map[x] : null;
        if (kind) pushUnique(out.insets, fill(p.insetEach.template, { kind: kind }));
      });
    }
    return out;
  }

  function tokenDomain(family, tok) {
    if (tok.from != null) {
      var g = groupOf(family, tok.from);
      var vals = [];
      ((g && g.options) || []).forEach(function (o) {
        var s = String(o.v);
        var m = tok.map ? (has(tok.map, s) ? tok.map[s] : null) : s;
        pushUnique(vals, m);
      });
      return vals;
    }
    if (tok.count != null) {
      var sg = groupOf(family, tok.count);
      var vs = [];
      for (var n = (sg && sg.minSlots) || 1; n <= ((sg && sg.maxSlots) || 1); n++) vs.push(String(n));
      return vs;
    }
    if (tok.firstOf != null) return [null].concat(tok.order || []);
    return [];
  }

  // allPreviewKeys(family) -> string[]  EVERY key a configuration of this family can ask for (chain + insets), sorted. A manifest entry
  // whose key is not in this list uses an option value the family does not have, and is refused by the build and by the tests.
  function allPreviewKeys(family) {
    var p = family && family.preview;
    var all = [];
    if (!p) return all;
    var names = Object.keys(p.tokens || {});
    var domains = names.map(function (n) { return tokenDomain(family, p.tokens[n]); });
    var idx = names.map(function () { return 0; });
    var total = domains.reduce(function (a, d) { return a * Math.max(1, d.length); }, 1);
    for (var c = 0; c < total; c++) {
      var tokens = {};
      for (var i = 0; i < names.length; i++) tokens[names[i]] = domains[i].length ? domains[i][idx[i]] : null;
      (p.chain || []).forEach(function (t) { pushUnique(all, fill(t, tokens)); });
      (p.insets || []).forEach(function (ins) { pushUnique(all, fill(ins.template, tokens)); });
      // odometer
      for (var j = names.length - 1; j >= 0; j--) {
        idx[j]++;
        if (idx[j] < Math.max(1, domains[j].length)) break;
        idx[j] = 0;
      }
    }
    if (p.insetEach) {
      var kinds = [];
      var m = (p.insetEach.over && p.insetEach.over.map) || {};
      Object.keys(m).forEach(function (k) { pushUnique(kinds, m[k]); });
      kinds.forEach(function (kind) { pushUnique(all, fill(p.insetEach.template, { kind: kind })); });
    }
    return all.sort();
  }

  // ── converting an old saved line ───────────────────────────────────────────
  // A draft saved before the families existed holds SKU lines. A SKU the families absorbed becomes a family line at the closest
  // configuration (absorbed[sku]); its saved size is kept where it is a valid size for the family, else the family default.
  // The saved option "specs" (e.g. a sink's faucet) are applied through family.specMap when present. The saved size is kept (rounded to the step, inside the
  // family's limits) and raised only to the family's HARD minimums for those options (width rule, forced minimums), so the converted line is always valid.
  // -> { familyId, config, dims } or null when no family absorbed that SKU.
  function migrateAbsorbed(families, sku, oldLine) {
    var order = (families && families.order) || [];
    for (var i = 0; i < order.length; i++) {
      var f = families.families[order[i]];
      if (!f || !has(f.absorbed || {}, sku)) continue;
      var config = clone(f.absorbed[sku]);
      var line = isPlain(oldLine) ? oldLine : {};
      if (Array.isArray(line.specs) && f.specMap) {
        line.specs.forEach(function (s) {
          if (!isPlain(s) || typeof s.label !== 'string' || typeof s.value !== 'string' || !has(f.specMap, s.label)) return;
          var m = f.specMap[s.label];
          if (has(m.values, s.value)) config[m.group] = m.values[s.value];
        });
      }
      var v = validateConfiguration(f, config);
      if (!v.ok) config = clone(f.absorbed[sku]);
      else config = v.config;
      var dims = defaultDims(f);
      if (isPlain(line.size)) {
        Object.keys(dims).forEach(function (k) {
          var spec = f.dims[k];
          var x = line.size[k];
          if (typeof x !== 'number' || !isFinite(x)) return;
          // an old standard size is rarely on the 10 mm step (2438, 762, 851): keep it, rounded to the step and inside the family's limits
          dims[k] = Math.min(spec.max, Math.max(spec.min, Math.round(x / spec.step) * spec.step));
        });
      }
      // The family's HARD rules always win over the saved size: the length is raised to the width rule of these options (a 2-sink table is not built
      // shorter than the rule), and a forced minimum (an oven) is applied — so a converted line is never one the server would refuse. A SOFT width
      // guidance (the stove) only warns, so a saved length shorter than it is kept.
      var mw = minWidth(f, config);
      if (mw && mw.hard && dims.W != null && dims.W < mw.mm) dims.W = mw.mm;
      var fm = forcedMins(f, config);
      Object.keys(fm).forEach(function (k) { if (dims[k] != null && dims[k] < fm[k]) dims[k] = fm[k]; });
      // ...and a forced MAXIMUM lowers an over-long saved size (a slim hood is at most 500 mm deep; a deck oven's width follows its trays)
      var fx = forcedMaxes(f, config);
      Object.keys(fx).forEach(function (k) { if (dims[k] != null && dims[k] > fx[k]) dims[k] = fx[k]; });
      return { familyId: f.id, config: config, dims: dims };
    }
    return null;
  }

  // ── the cells of a family's private option sheet ───────────────────────────
  // cells(family) -> [{ group, groupLabel, value (the string key of the cell), label, kind:'option'|'slot'|'addon', baseline:boolean, hint, when }]
  // `baseline` is true for the option the family's primary SKU already has: its delta is zero by definition and is not entered. `when` is the plain-words
  // condition of a conditional group ('Type is Fryer'; '' for an unconditional one): every option of such a group still has its cell — it is priced once, and used
  // only when the group applies.
  function cells(family) {
    var out = [];
    (family.groups || []).forEach(function (g) {
      var when = whenText(family, g);
      (g.options || []).forEach(function (o) {
        var kind = g.type === 'slots' ? 'slot' : (g.type === 'multi' ? 'addon' : 'option');
        var baseline = g.type === 'choice' ? o.v === g.default : false;
        out.push({ group: g.key, groupLabel: g.label, value: String(o.v), label: o.f || o.l, kind: kind, baseline: baseline, hint: o.hint || '', when: when });
      });
    });
    return out;
  }

  return {
    DIM_KEYS: DIM_KEYS,
    groupOf: groupOf,
    optionOf: optionOf,
    optionIndex: optionIndex,
    publicGroups: publicGroups,
    groupApplies: groupApplies,
    activeGroups: activeGroups,
    publicActiveGroups: publicActiveGroups,
    whenText: whenText,
    defaultConfig: defaultConfig,
    defaultDims: defaultDims,
    validateConfiguration: validateConfiguration,
    validateDims: validateDims,
    validateLine: validateLine,
    minWidth: minWidth,
    forcedMins: forcedMins,
    forcedMaxes: forcedMaxes,
    sizeText: sizeText,
    sizeTextLabelled: sizeTextLabelled,
    standardDims: standardDims,
    describe: describe,
    constructionLine: constructionLine,
    summaryParts: summaryParts,
    summaryLine: summaryLine,
    canonicalConfig: canonicalConfig,
    sameConfig: sameConfig,
    previewKeys: previewKeys,
    allPreviewKeys: allPreviewKeys,
    migrateAbsorbed: migrateAbsorbed,
    cells: cells
  };
});
