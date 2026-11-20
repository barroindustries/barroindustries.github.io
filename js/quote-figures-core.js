if (typeof window === 'undefined') globalThis.window = globalThis;
// ═══════════════════════════════════════════════════════════════════════════
//  js/quote-figures-core.js — QUOTE-PRESIDENT-FIGURES-SPEC-2026-11-20 §5: the President's own unit prices on a quote under approval.
//
//  Pure: no DOM, no Firestore, no clock (callers pass `at`), no imports. Same file contract as js/price-gate-core.js (shim on line 1, window global, module.exports at the end).
//  LAZY: not an app-kit script. Loaded by the quote builder (its one-line loader), by the review page (js/config.js PAGE_SCRIPTS['quote-approval']) and by the Save-edits-and-Approve path
//  (js/app.js saveReviewedPartnerQuote); precached in sw.js. It reads window.PriceGate.lineKey at CALL time only (rows), never at load time.
//
//  WHAT THIS FILE DOES NOT DO: totals. The totals math (discount and its cap at project cost, VAT, delivery, rush fee, volume breaks, options, down payment, commission) lives in the quote
//  builder and depends on the DOM; the review page runs the builder hidden (spec 2.1, "option c") and this file only (1) says which lines may take a figure and whether a typed figure is valid,
//  (2) applies a figure to a line EXACTLY as the builder's own typed price does (applyToItems, pinned against setLinePrice by tests/quote-builder-static.test.mjs),
//  (3) proves, fail closed, that the builder reproduced the stored quote before any figure (P1 baselineMatches) and landed exactly the figures asked for and nothing else (P2 verifyResult),
//  and that the quote did not change under the page (P3 sig), and (4) picks the money fields to store from the builder's answer (moneyEdits).
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const MAX_ROWS = 60, NAME_MAX = 120, NOTE_MAX = 500, PRICE_MAX = 999999999;
  // the per-line keys a price touches (snapshot / restore): exactly what setLinePrice in quote-builder-v2.html and applyToItems below assign or delete
  const PRICE_KEYS = ['unitPrice', 'amount', 'priceBasis', 'priceManual', 'priceHeld', 'needsPrice', 'priceBy'];

  const r2 = function (n) { return Math.round((+n + Number.EPSILON) * 100) / 100; };
  const isNum = function (n) { return n !== null && n !== undefined && n !== '' && isFinite(Number(n)); };
  const isObj = function (v) { return !!v && typeof v === 'object' && !Array.isArray(v); };
  const str = function (v) { return v == null ? '' : String(v); };
  const trim = function (v) { return str(v).trim(); };
  const n0 = function (v) { return isNum(v) ? Number(v) : 0; };
  const has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  const clone = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };

  // a pure section-header row: the builder's "Add section" placeholder (id CUSTOM, unnamed or still "New item", no price, no configurator kind). Moved here from the review page (spec 12).
  function isHeaderRow(it) {
    return !!it && it.id === 'CUSTOM' && (!trim(it.name) || trim(it.name) === 'New item') && n0(it.amount) === 0 && !it.kcKind;
  }
  // unit price of a stored line (the PriceGate rule): unitPrice | price, else amount / qty
  function unitOf(it) {
    it = it || {};
    if (isNum(it.unitPrice)) return Number(it.unitPrice);
    if (isNum(it.price)) return Number(it.price);
    const q = Number(it.qty);
    if (isNum(it.amount) && q > 0) return Number(it.amount) / q;
    return 0;
  }
  function lineKeyOf(it) {
    const PG = (typeof window !== 'undefined') ? window.PriceGate : null;
    return PG && typeof PG.lineKey === 'function' ? PG.lineKey(it) : '';
  }

  // "₱1,250.50" | "1250.5" | " 1 250 " -> a number; '' / null -> null; anything else (letters, three decimals, a comma that is not a thousands separator, an exponent) -> NaN. A leading minus parses (validate refuses it with its own sentence).
  function parse(text) {
    if (text === null || text === undefined) return null;
    if (typeof text === 'number') return isFinite(text) ? parse(String(text)) : NaN;
    let t = String(text).replace(/[\s   ]+/g, '');
    t = t.replace(/^(-?)₱/, '$1');
    if (t === '') return null;
    if (t.indexOf(',') >= 0) {
      if (!/^-?\d{1,3}(,\d{3})+(\.\d{0,2})?$/.test(t)) return NaN;
      t = t.replace(/,/g, '');
    }
    if (!/^-?(\d+\.?\d{0,2}|\.\d{1,2})$/.test(t)) return NaN;
    return Number(t);
  }

  // may this line take a figure: an object, not an additional-cost fee line, not a section header, a quantity above zero
  function eligible(it) {
    return isObj(it) && it.id !== 'MISCFEE' && !isHeaderRow(it) && Number(it.qty) > 0;
  }
  // may this line take a NOTE: any line that is not a section header (a fee line takes a note only)
  function noteable(it) { return isObj(it) && !isHeaderRow(it); }

  // -> { ok, error?, same?, empty?, warn: [] }. Warnings never block. `cost` is a FULL unit cost when the caller knows one, else null.
  function validate(to, item, cost) {
    const warn = [];
    if (to === null || to === undefined) return { ok: true, empty: true, warn: warn };
    if (typeof to !== 'number' || !isFinite(to)) return { ok: false, error: 'Type a price, for example 1250 or 1,250.50.', warn: warn };
    if (to <= 0) return { ok: false, error: 'Type a price above zero. To give a line free, return it with a note.', warn: warn };
    if (Math.abs(to * 100 - Math.round(to * 100)) > 1e-6) return { ok: false, error: 'Use at most two decimals.', warn: warn };
    if (to > PRICE_MAX) return { ok: false, error: 'That price is too large.', warn: warn };
    const cur = unitOf(item);
    if (r2(to) === r2(cur)) return { ok: true, same: true, warn: warn };
    if (cur > 0 && to < cur / 2) warn.push('big-cut');
    if (cur > 0 && to > cur * 2) warn.push('big-raise');
    if (isNum(cost) && to < Number(cost)) warn.push('below-cost');
    return { ok: true, warn: warn };
  }

  // The presidentFigures.lines rows (spec 3.1) for the lines that have a valid DIFFERENT figure or a non-empty note, in item order, at most `cap` (default 60).
  // inputs: { [itemIndex]: { to: <parsed number | null>, note: <string> } }. A fee line takes a note only (to stays null); a section header takes nothing.
  function rows(q, inputs, cap) {
    const items = Array.isArray(q && q.items) ? q.items : [];
    const limit = cap > 0 ? cap : MAX_ROWS;
    const inp = isObj(inputs) ? inputs : {};
    const out = [];
    for (let i = 0; i < items.length && out.length < limit; i++) {
      const it = items[i];
      if (!noteable(it) || !isObj(inp[i])) continue;
      const note = trim(inp[i].note).slice(0, NOTE_MAX);
      let to = null;
      if (eligible(it) && inp[i].to !== null && inp[i].to !== undefined) {
        const v = validate(inp[i].to, it);
        if (v.ok && !v.same && !v.empty) to = r2(inp[i].to);
      }
      if (to === null && !note) continue;
      out.push({ i: i, key: lineKeyOf(it), name: str(it.name).slice(0, NAME_MAX), qty: n0(it.qty), unit: str(it.unit), from: r2(unitOf(it)), to: to, note: note });
    }
    return out;
  }
  // { prices, notes } of a rows list (the decision's "changed" count and the notification's "N lines" / "M notes")
  function counts(list) {
    const l = Array.isArray(list) ? list : [];
    return { prices: l.filter(function (r) { return r && r.to !== null && r.to !== undefined; }).length, notes: l.filter(function (r) { return r && trim(r.note); }).length };
  }

  // P3 (spec 2.4): what decideQuoteApproval compares with the value the page computed its figures on. Name, quantity, unit and unit price of every line, plus the total. Stable under key order.
  function sig(q) {
    const items = Array.isArray(q && q.items) ? q.items : [];
    return JSON.stringify([items.map(function (it) {
      return isObj(it) ? [str(it.name), n0(it.qty), str(it.unit), r2(n0(it.unitPrice))] : null;
    }), r2(n0(q && q.total))]);
  }

  // the price keys of every line as they are now; restore puts every key back exactly (a key that was absent is deleted). restore -> false when the line count changed (the caller fails closed).
  function snapshot(items) {
    return (Array.isArray(items) ? items : []).map(function (it) {
      if (!isObj(it)) return null;
      const rec = { has: {}, val: {} };
      PRICE_KEYS.forEach(function (k) { if (has(it, k)) { rec.has[k] = true; rec.val[k] = clone(it[k]); } });
      return rec;
    });
  }
  function restore(items, snap) {
    if (!Array.isArray(items) || !Array.isArray(snap) || items.length !== snap.length) return false;
    items.forEach(function (it, i) {
      const rec = snap[i];
      if (!isObj(it) || !rec) return;
      PRICE_KEYS.forEach(function (k) { if (rec.has[k]) it[k] = clone(rec.val[k]); else delete it[k]; });
    });
    return true;
  }

  // Spec 5.2 steps 1 and 2: the ONLY price mutation of this feature. Sets, in this order, exactly what the builder's typed price sets (setLinePrice, quote-builder-v2.html, F-8):
  // unitPrice, amount = unitPrice x qty, priceManual, and (only for a line that has a price basis) priceBasis 'manual' + a real price clears needsPrice; then it lets go of a held price and
  // records who set it. meta: { uid, name, at, snap? } (snap, from snapshot(), names the price BEFORE the figure when the items were already moved).
  // -> { applied: [index], skipped: [{ i, reason }] }
  function applyToItems(items, figures, meta) {
    const m = isObj(meta) ? meta : {};
    const applied = [], skipped = [];
    (Array.isArray(figures) ? figures : []).forEach(function (f) {
      const i = f ? f.i : undefined;
      const it = Array.isArray(items) ? items[i] : null;
      if (!isObj(it)) { skipped.push({ i: i, reason: 'missing' }); return; }
      if (!eligible(it)) { skipped.push({ i: i, reason: 'ineligible' }); return; }
      const v = validate(f.to, it);
      if (!v.ok) { skipped.push({ i: i, reason: 'invalid' }); return; }
      if (v.same || v.empty) { skipped.push({ i: i, reason: 'same' }); return; }
      const rec = Array.isArray(m.snap) ? m.snap[i] : null;
      const before = r2(rec && rec.has && rec.has.unitPrice ? n0(rec.val.unitPrice) : unitOf(it));
      const to = r2(f.to);
      it.unitPrice = to; it.amount = to * it.qty; it.priceManual = true;
      if (it.priceBasis !== undefined) { it.priceBasis = 'manual'; if (to > 0) delete it.needsPrice; }
      delete it.priceHeld;
      it.priceBy = { role: 'president', uid: str(m.uid), name: str(m.name).slice(0, 120), at: str(m.at), salesPrice: before };
      applied.push(i);
    });
    return { applied: applied, skipped: skipped };
  }

  // The eligible lines (not in `skip`) whose unit price differs from their snapshot to the centavo: what an additional cost spread across the non-manual lines moved. Reads only. -> [index]
  function movedLines(items, snap, skip) {
    const sk = {}; (Array.isArray(skip) ? skip : []).forEach(function (i) { sk[i] = true; });
    const out = [];
    (Array.isArray(items) ? items : []).forEach(function (it, i) {
      if (sk[i] || !eligible(it)) return;
      const rec = Array.isArray(snap) ? snap[i] : null;
      if (!rec || !rec.has || !rec.has.unitPrice) return;
      if (r2(n0(it.unitPrice)) !== r2(n0(rec.val.unitPrice))) out.push(i);
    });
    return out;
  }

  // Spec 5.2 step 4: after the builder re-priced (an additional cost spread across the non-manual lines can move a line nobody touched), every eligible line that is not in `appliedIdx` and whose
  // price differs from its snapshot goes back to the snapshot price, with the same assignments as a figure and priceBy.held. -> [index]
  function holdMoved(items, snap, appliedIdx, meta) {
    const m = isObj(meta) ? meta : {};
    const held = movedLines(items, snap, appliedIdx);
    held.forEach(function (i) {
      const it = items[i], was = snap[i].val.unitPrice;
      it.unitPrice = was; it.amount = was * it.qty; it.priceManual = true;
      if (it.priceBasis !== undefined) { it.priceBasis = 'manual'; if (n0(was) > 0) delete it.needsPrice; }
      delete it.priceHeld;
      it.priceBy = { role: 'president', uid: str(m.uid), name: str(m.name).slice(0, 120), at: str(m.at), salesPrice: r2(n0(was)), held: true };
    });
    return held;
  }

  // P1 (spec 2.4): the engine, before any figure, reproduces the stored quote. -> { ok } | { ok: false, reason }
  function baselineMatches(q, base, units) {
    q = isObj(q) ? q : {};
    const items = Array.isArray(q.items) ? q.items : [];
    if (!Array.isArray(units) || units.length !== items.length) return { ok: false, reason: 'count' };
    for (let i = 0; i < items.length; i++) {
      if (r2(n0(units[i])) !== r2(n0(isObj(items[i]) ? items[i].unitPrice : 0))) return { ok: false, reason: 'unit:' + i };
    }
    const b = isObj(base) ? base : {};
    const pay = isObj(q.payment) ? q.payment : {};
    const checks = [['total', q.total, true], ['netAmount', q.netAmount], ['subtotal', q.subtotal], ['vatAmount', q.vatAmount], ['discountAmount', q.discountAmount], ['downPayment', pay.downPayment]];
    for (let k = 0; k < checks.length; k++) {
      const name = checks[k][0], stored = checks[k][1], required = checks[k][2] === true;
      if (!isNum(stored)) { if (required) return { ok: false, reason: name }; continue; }
      if (!isNum(b[name]) || r2(b[name]) !== r2(stored)) return { ok: false, reason: name };
    }
    return { ok: true };
  }

  // P2 (spec 2.4): after applying `figures` ([{ i, to }]) the engine's payload has the same lines (name, quantity, unit), every figure landed (unit price and amount = to x qty), and EVERY other
  // priced line, header and fee lines apart, is at its stored price. -> { ok } | { ok: false, reason }
  function verifyResult(q, payload, figures) {
    q = isObj(q) ? q : {};
    const qi = Array.isArray(q.items) ? q.items : [];
    const pi = payload && Array.isArray(payload.items) ? payload.items : null;
    if (!pi || pi.length !== qi.length) return { ok: false, reason: 'count' };
    const want = {};
    const figs = Array.isArray(figures) ? figures : [];
    for (let k = 0; k < figs.length; k++) {
      const f = figs[k];
      if (!f || !isObj(qi[f.i]) || !isObj(pi[f.i]) || !eligible(qi[f.i]) || !isNum(f.to)) return { ok: false, reason: 'figure-index' };
      want[f.i] = r2(f.to);
    }
    for (let i = 0; i < qi.length; i++) {
      const a = qi[i], b = pi[i];
      if (!isObj(a) || !isObj(b)) { if (a !== b) return { ok: false, reason: 'line:' + i }; continue; }
      if (str(a.name) !== str(b.name) || n0(a.qty) !== n0(b.qty) || str(a.unit) !== str(b.unit)) return { ok: false, reason: 'line:' + i };
      if (has(want, i)) {
        if (r2(n0(b.unitPrice)) !== want[i]) return { ok: false, reason: 'figure:' + i };
        if (r2(n0(b.amount)) !== r2(want[i] * n0(b.qty))) return { ok: false, reason: 'amount:' + i };
      } else if (!isHeaderRow(a) && a.id !== 'MISCFEE') {
        if (r2(n0(b.unitPrice)) !== r2(n0(a.unitPrice))) return { ok: false, reason: 'moved:' + i };
      }
    }
    if (str(payload.quoteNumber) !== str(q.quoteNumber)) return { ok: false, reason: 'number' };
    return { ok: true };
  }

  // the totals of a builder payload (or of a stored quote: same field names), centavo-rounded numbers or null
  function summary(p) {
    p = isObj(p) ? p : {};
    const pay = isObj(p.payment) ? p.payment : {};
    const g = function (v) { return isNum(v) ? r2(v) : null; };
    return { subtotal: g(p.subtotal), discountAmount: g(p.discountAmount), netAmount: g(p.netAmount), vatAmount: g(p.vatAmount), total: g(p.total),
      downPayment: g(pay.downPayment), balance: g(pay.balance), commissionAmount: g(p.commissionAmount) };
  }

  // The exact field allowlist an approval at the President's figures writes (spec 3.1): the money, the lines and the editable snapshot, and NOTHING else (never a client field, the number, the dates,
  // the timeline, sourceRef, a chain id). Missing keys get the defaults the QUOTE_UPDATE handler uses; the object-valued fields go through JSON so no undefined reaches Firestore.
  function moneyEdits(p) {
    p = isObj(p) ? p : {};
    const j = function (v, d) { return (v === undefined || v === null) ? d : clone(v); };
    return {
      items: j(p.items, []),
      subtotal: p.subtotal || 0,
      volumeBreakTotal: p.volumeBreakTotal || 0,
      total: p.total || 0,
      grandTotal: p.grandTotal || 0,
      optionsMode: p.optionsMode || false,
      options: j(p.options, null),
      optionsBasis: p.optionsBasis || '',
      vatIncluded: p.vatIncluded || false,
      vatAmount: p.vatAmount || 0,
      discountPct: p.discountPct || 0,
      discountAmount: p.discountAmount || 0,
      netAmount: p.netAmount || 0,
      deliveryInstall: j(p.deliveryInstall, null),
      commissionPct: p.commissionPct || 0,
      commissionAmount: p.commissionAmount || 0,
      payment: j(p.payment, null),
      editableState: j(p.editableState, null),
    };
  }

  // For Sales' builder: pair each presidentFigures.lines row with the live item at its index. A row matches when the item exists, carries the same name (first 120 chars) and quantity, and (for a
  // row with a price) can take a figure. -> { matched: [{ idx, row }], unmatched: [row] }
  function matchForApply(items, list) {
    const its = Array.isArray(items) ? items : [];
    const matched = [], unmatched = [];
    (Array.isArray(list) ? list : []).forEach(function (row) {
      if (!isObj(row)) return;
      const it = its[row.i];
      const hasPrice = row.to !== null && row.to !== undefined;
      if (noteable(it) && str(it.name).slice(0, NAME_MAX) === str(row.name) && n0(it.qty) === n0(row.qty) && (!hasPrice || eligible(it))) matched.push({ idx: row.i, row: row });
      else unmatched.push(row);
    });
    return { matched: matched, unmatched: unmatched };
  }

  window.QuoteFigures = {
    MAX_ROWS: MAX_ROWS, NOTE_MAX: NOTE_MAX, PRICE_KEYS: PRICE_KEYS,
    r2: r2, isHeaderRow: isHeaderRow, unitOf: unitOf, parse: parse, eligible: eligible, noteable: noteable, validate: validate,
    rows: rows, counts: counts, sig: sig, snapshot: snapshot, restore: restore, applyToItems: applyToItems, movedLines: movedLines, holdMoved: holdMoved,
    baselineMatches: baselineMatches, verifyResult: verifyResult, summary: summary, moneyEdits: moneyEdits, matchForApply: matchForApply,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.QuoteFigures;
