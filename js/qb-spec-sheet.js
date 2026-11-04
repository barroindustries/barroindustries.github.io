// js/qb-spec-sheet.js — pure helpers for the SPEC SHEET the Quote Builder prints under every quote line
// (specs/QB-SELLING-QUOTE-SPEC.md §3.1 / §3.2, owner rulings of 2026-11-05 in its §7).
//
// WHAT IT IS: the presentation layer over fields a quote line ALREADY carries — `dims`, `specs[]` (the configurator's describe() rows, Material first and
// Construction last), `specEdit` (the preparer's own wording), `notes`, `leadTime` — plus the document fields of this phase: `finish`, `includes[]`, `excludes[]`
// and `specLines[]` (extra rows the preparer adds). It turns them into the rows of a two-column table (Size first, then Material and the option rows, the
// Construction row, the finish, extra rows, what is included and not included, the lead time, the notes), into the table's HTML, into a completeness score
// (what a line still lacks), and into the one-line summary and the dimension / lead-time notes printed once per document.
//
// WHAT IT IS NOT: it carries NO price, rate or amount, never reads or writes one, and never changes a figure (R6: the price math is frozen). It does not touch the
// DOM, Firebase, the clock or the network; it never mutates an argument and never throws on junk input (a line that is not an object has no rows). An ABSENT field
// is "not set" — never a claim: a legacy line (none of the new fields) prints exactly the rows it always had, and a value nobody supplied is never invented.
//
// LOADED BY: the quote builder's own script loader (quote-builder-v2.html — the builder is an iframe with its own loader, NOT an app-kit script) and, for the Sales
// quote preview, by js/config.js PAGE_SCRIPTS beside js/qb-configured.js. Not mirrored into functions/ and not loaded by any public page. The text that escapes
// is the CALLER's (html() takes the escaper: txtEsc in the builder), so this file needs none of its own helpers.
//
// UMD-ish shim, like js/qb-configured.js: browser <script> -> window.QBSpecSheet; Node require() -> module.exports. ES5 on purpose (no arrow functions, let/const or
// template strings).
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;   // tests
  if (root) root.QBSpecSheet = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  // The finishes a line can state (owner ruling 2026-11-05 #2): hairline is the standard; brushed, mirror and satin on request. Builder field only — no price, no website option.
  var FINISH_ORDER = Object.freeze(['hairline', 'brushed', 'mirror', 'satin']);
  var FINISH_LABELS = Object.freeze({ hairline: 'Hairline finish', brushed: 'Brushed finish', mirror: 'Mirror finish', satin: 'Satin finish' });

  // The sentences this file prints once per document (the dimension legend, the tolerance reference) — one copy, pinned by tests/quote-selling-content.test.mjs.
  var TEXT = Object.freeze({
    dimsLegend: 'Dimensions are Length × Width × Height in mm (hoods: Length × Depth).',
    toleranceNote: 'Fabricated dimensions carry the ±5 mm tolerance stated in the terms.',
    warrantyShort: '6-month service warranty',
    pmsShort: '12-month PMS with KitchenShield™'
  });

  // A lead time the owner ruled on (2026-11-05 #4): "<N> working days" — the MINIMUM, from downpayment and approved drawings. Only this form prints; any other text a legacy
  // product carries ("14-21 days") is an internal estimate and would contradict the ruled minimum, so it stays off the document.
  var RULED_LEAD = /^\s*(\d{1,3})\s+working\s+days?\s*$/i;

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function str(v) { return typeof v === 'string' ? v : ((typeof v === 'number' || typeof v === 'boolean') ? String(v) : ''); }
  function trim(v) { return str(v).trim(); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function defaultEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ── what kind of line is it ─────────────────────────────────────────────────
  // leadInfo(leadTime) -> { n, text } for a ruled lead time ("25 working days" -> "25 working days min."), else null.
  function leadInfo(leadTime) {
    var m = RULED_LEAD.exec(str(leadTime));
    var n = m ? parseInt(m[1], 10) : 0;
    return n > 0 ? { n: n, text: n + ' working day' + (n === 1 ? '' : 's') + ' min.' } : null;
  }
  // leadSentence(n) -> "Lead time: 25 working days minimum, from downpayment and approved drawings."
  function leadSentence(n) {
    var k = parseInt(n, 10);
    return k > 0 ? 'Lead time: ' + k + ' working day' + (k === 1 ? '' : 's') + ' minimum, from downpayment and approved drawings.' : '';
  }
  // isFabricated(item): a made-to-order line — a configured (family) line, a per-length / per-area / per-run / configurable catalogue line, or a custom line. A pass-through line
  // (the supplier's price is the client's: a Brilliant Steel line, a client-supplied unit) or a line ticked "no costing" is bought-in work, not fabrication.
  function isFabricated(item) {
    if (!isObj(item) || item.id === 'MISCFEE') return false;
    if (item.passThrough || item.noCosting) return false;
    return !!item.familyId || ['per_length', 'per_area', 'per_run', 'configurable'].indexOf(item.formulaType) >= 0 || item.id === 'CUSTOM';
  }
  // hasSize(item): the line states a size — a non-empty `dims` text, or a numeric size (W / D / H, at least one above zero).
  function hasSize(item) {
    if (!isObj(item)) return false;
    if (trim(item.dims)) return true;
    var sz = item.size;
    if (!isObj(sz)) return false;
    return ['W', 'D', 'H'].some(function (k) { return typeof sz[k] === 'number' && isFinite(sz[k]) && sz[k] > 0; });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  rows — the spec sheet of one line, as data
  // ═══════════════════════════════════════════════════════════════════════
  // rows(item, opts) -> [{ label, value, kind }]   kind: 'size' | 'spec' | 'construction' | 'finish' | 'extra' | 'includes' | 'excludes' | 'lead' | 'note'. Order (§3.1):
  //   1 Size (`dims`; the label is "Runs" for a "3 run(s)" line)   2 Material (the `Material` row of specs[], else a text `item.material`)   3 the other specs[] rows, in order,
  //   EXCEPT Construction   4 Construction (own row, emphasised on paper)   5 Finish (only when set)   6 specLines[]   7 Includes / Not included (only when non-empty)
  //   8 Lead time (only a ruled "<N> working days": printed "N working days min.")   9 notes.
  //   `specEdit` DEFINED (the preparer's own wording, even an empty one) is printed as ONE paragraph (a row with no label) INSTEAD of rows 2-4; an empty one prints nothing there.
  //   A row with no value is not a row; a legacy line with nothing to say has no rows at all. `opts.leadOn === false` (a quotation "as issued" under the earlier timeline rule) leaves the
  //   lead-time row out: a ruled lead of 25 working days would contradict the timeline that quotation prints. Any other `opts` is accepted for the later phases (BAC mode, the crew copy) and ignored.
  function rows(item, opts) {
    var out = [];
    if (!isObj(item)) return out;
    var dims = trim(item.dims);
    if (dims) out.push({ label: /run\(s\)/i.test(dims) ? 'Runs' : 'Size', value: dims, kind: 'size' });
    if (item.specEdit !== undefined) {
      var free = trim(item.specEdit);
      if (free) out.push({ label: '', value: free, kind: 'spec' });
    } else {
      var material = null, construction = [], others = [];
      arr(item.specs).forEach(function (s) {
        if (!isObj(s)) return;
        var label = trim(s.label), value = trim(s.value);
        if (!value) return;
        if (label === 'Material') { if (!material) material = { label: 'Material', value: value, kind: 'spec' }; }
        else if (label === 'Construction') construction.push({ label: 'Construction', value: value, kind: 'construction' });
        else others.push({ label: label, value: value, kind: 'spec' });
      });
      if (!material && typeof item.material === 'string' && item.material.trim()) material = { label: 'Material', value: item.material.trim(), kind: 'spec' };
      if (material) out.push(material);
      others.forEach(function (r) { out.push(r); });
      construction.forEach(function (r) { out.push(r); });
    }
    if (typeof item.finish === 'string' && has(FINISH_LABELS, item.finish)) out.push({ label: 'Finish', value: FINISH_LABELS[item.finish], kind: 'finish' });
    arr(item.specLines).forEach(function (s) {
      if (!isObj(s)) return;
      var value = trim(s.value);
      if (value) out.push({ label: trim(s.label), value: value, kind: 'extra' });
    });
    var inc = arr(item.includes).map(trim).filter(Boolean);
    if (inc.length) out.push({ label: 'Includes', value: cap(inc.join('; ')), kind: 'includes' });
    var exc = arr(item.excludes).map(trim).filter(Boolean);
    if (exc.length) out.push({ label: 'Not included', value: cap(exc.join('; ')), kind: 'excludes' });
    var lead = opts && opts.leadOn === false ? null : leadInfo(item.leadTime);
    if (lead) out.push({ label: 'Lead time', value: lead.text, kind: 'lead' });
    var note = trim(item.notes);
    if (note) out.push({ label: '', value: note, kind: 'note' });
    return out;
  }

  // html(item, opts, esc) -> the <table class="spec-sheet"> string ('' when the line has no rows). `esc` is the caller's text escaper (txtEsc in the builder); without one a safe default
  // escapes & " < >. Every label and value is escaped; a newline in a value becomes <br>. The class names (ss-row ss-<kind>, ss-l, ss-v) are the builder's print / preview CSS hooks.
  function html(item, opts, esc) {
    var e = typeof esc === 'function' ? esc : defaultEsc;
    var rs = rows(item, opts);
    if (!rs.length) return '';
    var h = '<table class="spec-sheet">';
    rs.forEach(function (r) {
      var v = String(e(r.value)).replace(/\n/g, '<br>');
      if (r.label) h += '<tr class="ss-row ss-' + r.kind + '"><td class="ss-l">' + e(r.label) + '</td><td class="ss-v">' + v + '</td></tr>';
      else h += '<tr class="ss-row ss-' + r.kind + '"><td class="ss-v" colspan="2">' + v + '</td></tr>';
    });
    return h + '</table>';
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  completeness — what a line still lacks (G1)
  // ═══════════════════════════════════════════════════════════════════════
  // completeness(item, opts) -> { score: 0..1, missing: ['size'|'specs'|'finish'|'lead'|'photo'], fabricated }
  //   A made-to-order line is complete when it has a size, at least one spec row (a Specs paragraph counts), a finish, a ruled lead time and (soft) a picture; a bought-in line
  //   needs only specs and a picture (it may skip size, finish and lead time). `opts.hasPhoto` = a quote photo is linked to this line (the builder knows; the line itself only
  //   carries `photoUrl`). `opts.leadOn === false` takes the lead time out of what a made-to-order line needs (see rows()). score = satisfied / applicable.
  function completeness(item, opts) {
    var fabricated = isFabricated(item);
    var rs = rows(item);
    var ok = {
      size: hasSize(item),
      specs: rs.some(function (r) { return r.kind === 'spec' || r.kind === 'construction' || r.kind === 'extra'; }),
      finish: isObj(item) && typeof item.finish === 'string' && has(FINISH_LABELS, item.finish),
      lead: isObj(item) && !!leadInfo(item.leadTime),
      photo: !!(opts && opts.hasPhoto) || (isObj(item) && !!trim(item.photoUrl))
    };
    var leadOn = !(opts && opts.leadOn === false);
    var checks = fabricated ? (leadOn ? ['size', 'specs', 'finish', 'lead', 'photo'] : ['size', 'specs', 'finish', 'photo']) : ['specs', 'photo'];
    var missing = checks.filter(function (k) { return !ok[k]; });
    return { score: (checks.length - missing.length) / checks.length, missing: missing, fabricated: fabricated };
  }

  // quality(items, opts) -> { score, outOf10, count, lines:[{ idx, score, missing, fabricated }], weak:[{ idx, missing }], counts:{ size, specs, finish, lead, photo } }
  //   The quote-level view: every quoted line (fee lines excluded) scored with completeness(); `weak` = the lines lacking a size, specs or a finish (the three the Verify & File list
  //   names; a missing picture or lead time only lowers the score); `counts` = how many lines lack each thing; outOf10 = the average score as a whole number out of 10.
  //   `opts.hasPhoto(item, idx)` -> boolean; `opts.leadOn === false` as in completeness().
  function quality(items, opts) {
    var hp = opts && typeof opts.hasPhoto === 'function' ? opts.hasPhoto : null;
    var lines = [], weak = [], counts = { size: 0, specs: 0, finish: 0, lead: 0, photo: 0 }, sum = 0;
    arr(items).forEach(function (it, idx) {
      if (!isObj(it) || it.id === 'MISCFEE') return;
      var c = completeness(it, { hasPhoto: hp ? !!hp(it, idx) : false, leadOn: !(opts && opts.leadOn === false) });
      lines.push({ idx: idx, score: c.score, missing: c.missing, fabricated: c.fabricated });
      sum += c.score;
      c.missing.forEach(function (k) { counts[k]++; });
      var w = c.missing.filter(function (k) { return k === 'size' || k === 'specs' || k === 'finish'; });
      if (w.length) weak.push({ idx: idx, missing: w });
    });
    var score = lines.length ? sum / lines.length : 0;
    return { score: score, outOf10: Math.round(score * 10), count: lines.length, lines: lines, weak: weak, counts: counts };
  }
  // fabricatedWithoutSize(items) -> [{ idx, name }]   the made-to-order lines that state no size: the HARD block at Verify & File (owner ruling 2026-11-05 #5).
  function fabricatedWithoutSize(items) {
    var out = [];
    arr(items).forEach(function (it, idx) { if (isFabricated(it) && !hasSize(it)) out.push({ idx: idx, name: trim(it.name) }); });
    return out;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  the once-per-document text
  // ═══════════════════════════════════════════════════════════════════════
  // docNotes(items, opts) -> { dims, lead, leadMin }   dims = the legend printed under the items table ONLY when at least one line has `dims` (a "3 run(s)" line is not a size), with
  //   the tolerance reference unless opts.toleranceOn === false (the preparer switched that term off, so "stated in the terms" would be untrue); lead = "Lead time: N working days
  //   minimum, from downpayment and approved drawings." when any line carries a ruled lead time (N = the largest); leadMin = N or 0. `opts.leadOn === false` (a quotation "as issued" under the
  //   earlier timeline rule) says nothing about a lead time: lead '' and leadMin 0.
  function docNotes(items, opts) {
    var anyDims = false, leadMin = 0, leadOn = !(opts && opts.leadOn === false);
    arr(items).forEach(function (it) {
      if (!isObj(it) || it.id === 'MISCFEE') return;
      var d = trim(it.dims);
      if (d && !/run\(s\)/i.test(d)) anyDims = true;
      var l = leadOn ? leadInfo(it.leadTime) : null;
      if (l && l.n > leadMin) leadMin = l.n;
    });
    var dims = anyDims ? TEXT.dimsLegend + (opts && opts.toleranceOn === false ? '' : ' ' + TEXT.toleranceNote) : '';
    return { dims: dims, lead: leadSentence(leadMin), leadMin: leadMin };
  }

  function pctText(v) {
    var n = Number(v);
    if (!isFinite(n)) return '';
    var r = Math.round(n * 100) / 100;
    return String(r);
  }
  // summaryStrip(state) -> "Valid 30 days · 50% down payment, balance on completion · Lead time from 25 working days · Delivery: Company delivery truck · 6-month service warranty"
  //   state = { validDays, milestones (count, in milestone mode), downPct, downCustom, balanceMode ('lump' | 'staggerN' | 'installN'), leadMin, deliveryMethod, warrantyOn (false: the
  //   warranty term is off), warrantyPlan ('service6' | 'kitchenshield12') }. A part with nothing to say is skipped; the KitchenShield part follows the plan only.
  function summaryStrip(state) {
    var s = isObj(state) ? state : {};
    var parts = [];
    var vd = parseInt(s.validDays, 10);
    if (vd > 0) parts.push('Valid ' + vd + ' days');
    var ms = parseInt(s.milestones, 10);
    var pay = [];
    if (ms > 0) pay.push(ms + ' payment milestone' + (ms === 1 ? '' : 's'));
    else {
      if (s.downCustom) pay.push('custom down payment');
      else if (s.downPct !== undefined && s.downPct !== null && s.downPct !== '' && pctText(s.downPct)) pay.push(pctText(s.downPct) + '% down payment');
      var bm = str(s.balanceMode), m;
      if (bm === 'lump') pay.push('balance on completion');
      else if ((m = /^stagger(\d+)$/.exec(bm))) pay.push('balance in ' + m[1] + ' staggered payments');
      else if ((m = /^install(\d+)$/.exec(bm))) pay.push('balance in ' + m[1] + ' monthly installments');
    }
    if (pay.length) parts.push(pay.join(', '));
    var lm = parseInt(s.leadMin, 10);
    if (lm > 0) parts.push('Lead time from ' + lm + ' working days');
    var dm = trim(s.deliveryMethod);
    if (dm) parts.push('Delivery: ' + dm);
    if (s.warrantyOn !== false) {
      parts.push(TEXT.warrantyShort);
      if (s.warrantyPlan === 'kitchenshield12') parts.push(TEXT.pmsShort);
    }
    return parts.join(' · ');
  }

  // constructionBullets(items, labelOf) -> [{ title, text }]   the distinct Construction sentences of the configured lines that PRINT one (a line in the preparer's own wording does not),
  //   each led by its family title (`labelOf(item)`, else the line's name), in line order and de-duplicated — what the "Our standard" page lists. [] when there are none.
  function constructionBullets(items, labelOf) {
    var seen = {}, out = [];
    arr(items).forEach(function (it) {
      if (!isObj(it) || !it.familyId || it.specEdit !== undefined) return;
      var text = '';
      arr(it.specs).forEach(function (s) { if (!text && isObj(s) && s.label === 'Construction') text = trim(s.value); });
      if (!text) return;
      var title = (typeof labelOf === 'function' ? trim(labelOf(it)) : '') || trim(it.name);
      var key = title + '\u0000' + text;
      if (has(seen, key)) return;
      seen[key] = true;
      out.push({ title: title, text: text });
    });
    return out;
  }

  return {
    FINISH_ORDER: FINISH_ORDER,
    FINISH_LABELS: FINISH_LABELS,
    TEXT: TEXT,
    isFabricated: isFabricated,
    hasSize: hasSize,
    leadInfo: leadInfo,
    leadSentence: leadSentence,
    rows: rows,
    html: html,
    completeness: completeness,
    quality: quality,
    fabricatedWithoutSize: fabricatedWithoutSize,
    docNotes: docNotes,
    summaryStrip: summaryStrip,
    constructionBullets: constructionBullets
  };
});
