if (typeof window === 'undefined') globalThis.window = globalThis;
// ═══════════════════════════════════════════════════════════════════════════
//  js/price-gate-core.js — P1 of specs/SALES-FLOW-SPEC-2026-11-19.md §6: when a revised price needs Neil again.
//
//  Pure: no DOM, no Firestore, no clock, no imports. Same file contract as js/sales-flow-core.js (shim on line 1,
//  window global, module.exports at the end). Loads anywhere after config; needs nothing else.
//
//  THE RULE (§6.1): after Neil approved a price, a revised price P needs him again ONLY IF
//      P < lastApprovedPrice   AND   P < standardPrice          (equal is never "below"; centavo-rounded)
//  checked on the TOTAL and on EACH LINE (§6.2) — either level trips it.
//  UNKNOWN STANDARD (§6.4): an unknown standard counts as "below standard", so the rule shrinks to
//      P < lastApprovedPrice   (a cut goes back to Neil; holding or raising never does).
//  A NEW LINE (no match in the last approved snapshot) has no approved price to cut from. Resolution of a spec gap
//  (reported to the coordinator): it trips only when its standard is KNOWN and P < std. Unknown std → no line trip;
//  the total check still catches a quote that went down.
//  Fee / pass-through lines count in the total and are skipped at line level. Quantity is ignored.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // F7 seam (§6.7): when true, "Record payment" is offered only on an approved quote. One constant; flipped later.
  const REQUIRE_APPROVAL_FOR_PAYMENT = false;

  const r2 = function (n) { return Math.round((+n + Number.EPSILON) * 100) / 100; };
  const isNum = function (n) { return n !== null && n !== undefined && n !== '' && isFinite(Number(n)); };

  // lineId when the source gives one, else lower-cased name + dimensions + unit (§6.2).
  function lineKey(l) {
    l = l || {};
    const id = l.lineId != null && l.lineId !== '' ? l.lineId : (l.key != null && l.key !== '' ? l.key : null);
    if (id != null) return String(id);
    const dims = l.dimensions != null ? l.dimensions : (l.dims != null ? l.dims : (l.size != null ? l.size : ''));
    const dimStr = (dims && typeof dims === 'object') ? JSON.stringify(dims) : String(dims);
    return [String(l.name || '').trim().toLowerCase(), dimStr.trim().toLowerCase(), String(l.unit || '').trim().toLowerCase()].join('|');
  }

  // unit price of a raw quote item (after its own discount): unitPrice | price, else amount / qty.
  function itemUnit(it) {
    if (isNum(it.unitPrice)) return Number(it.unitPrice);
    if (isNum(it.price)) return Number(it.price);
    const q = Number(it.qty);
    if (isNum(it.amount) && q > 0) return Number(it.amount) / q;
    return 0;
  }
  function quoteTotalOf(q) { return Number(q.total) || Number(q.grandTotal) || Number(q.amount) || 0; }

  // §6.5: a snapshot built on the fly from an approved quote (a chain approved before approvedSnapshot existed).
  // Uses priceCheck when the quote has one, else its total and items.
  function snapshotFromQuote(quote) {
    quote = quote || {};
    const pc = quote.priceCheck;
    if (pc && Array.isArray(pc.lines)) {
      return { total: r2(pc.total), lines: pc.lines.map(function (l) { return { key: l.key != null ? String(l.key) : lineKey(l), unit: r2(l.unit) }; }) };
    }
    const items = Array.isArray(quote.items) ? quote.items : [];
    return { total: r2(quoteTotalOf(quote)), lines: items.map(function (it) { return { key: lineKey(it), unit: r2(itemUnit(it)) }; }) };
  }

  // §6.5: `lastApproved` for a new revision = the snapshot of the NEWEST quote in the chain that Neil approved HIMSELF
  // (approvedBy set, no approvalCarriedFrom). Carried approvals never move the bar. A quote approved before
  // approvedSnapshot existed gets one built on the fly. Nothing approved by Neil → null (the gate does not run).
  // The quote itself (not its snapshot): the bridge needs its id for approvalCarriedFrom (Phase 3). Same pick as before, split out.
  function pickLastApprovedQuote(quotes) {
    let best = null; let bestAt = '';
    (quotes || []).forEach(function (q) {
      if (!q || !q.approvedBy || q.approvalCarriedFrom) return;
      const at = String((q.approvedSnapshot && q.approvedSnapshot.at) || q.approvedAt || '');
      if (best === null || at > bestAt) { best = q; bestAt = at; }
    });
    return best;
  }
  function lastApprovedFromChain(quotes) {
    const best = pickLastApprovedQuote(quotes);
    if (!best) return null;
    const snap = best.approvedSnapshot;
    if (snap && isNum(snap.total) && Array.isArray(snap.lines)) return { total: r2(snap.total), lines: snap.lines.map(function (l) { return { key: String(l.key), unit: r2(l.unit) }; }) };
    return snapshotFromQuote(best);
  }

  // Normalise either input to a priceCheck shape. A quote with no priceCheck is all-unknown (§6.4, SF1).
  function asPriceCheck(x) {
    x = x || {};
    if (x.priceCheck && Array.isArray(x.priceCheck.lines)) return x.priceCheck;
    if (Array.isArray(x.lines) && x.total !== undefined && x.items === undefined) return x;   // already a priceCheck
    const items = Array.isArray(x.items) ? x.items : [];
    return {
      total: quoteTotalOf(x), stdTotal: null,
      lines: items.map(function (it) { return { key: lineKey(it), name: it.name || '', qty: it.qty, unit: itemUnit(it), std: null, mode: 'unknown' }; }),
    };
  }

  // → { needsApproval, reasons:[{ level:'total'|'line', key, name, price, approved, std }], skipped? }
  // lastApproved = { total, lines:[{ key, unit }] } | null. Nothing approved by Neil → nothing to carry: gate does not run.
  function evaluate(priceCheckOrQuote, lastApproved) {
    if (!lastApproved) return { needsApproval: false, reasons: [], skipped: true };
    const pc = asPriceCheck(priceCheckOrQuote);
    const reasons = [];

    // Total level.
    const P = r2(pc.total);
    const A = r2(lastApproved.total);
    const S = isNum(pc.stdTotal) ? r2(pc.stdTotal) : null;
    if (P < A && (S === null || P < S)) {
      reasons.push({ level: 'total', key: 'total', name: 'Total', price: P, approved: A, std: S });
    }

    // Line level (fee / pass-through skipped).
    const approvedByKey = {};
    (lastApproved.lines || []).forEach(function (l) { approvedByKey[l.key] = r2(l.unit); });
    (pc.lines || []).forEach(function (l) {
      if (l.mode === 'fee') return;
      const key = l.key != null ? String(l.key) : lineKey(l);
      const p = r2(l.unit);
      const s = isNum(l.std) ? r2(l.std) : null;
      const has = Object.prototype.hasOwnProperty.call(approvedByKey, key);
      const a = has ? approvedByKey[key] : null;
      let trips;
      if (has) trips = p < a && (s === null || p < s);
      else trips = s !== null && p < s;
      if (trips) reasons.push({ level: 'line', key: key, name: l.name || '', price: p, approved: a, std: s });
    });

    return { needsApproval: reasons.length > 0, reasons: reasons };
  }

  // ── QUOTE-PRESIDENT-FIGURES-SPEC-2026-11-20 §8 (additive; lastApprovedFromChain, pickLastApprovedQuote and evaluate above are not changed) ──────────────────────────────────────────────────────
  // A quote the President RETURNED WITH HIS OWN PRICES (presidentFigures.carry === true) offers a bar of its own: a revision that is at or above those prices needs no second approval.
  // evaluate() judges the revision against figuresBar() exactly as it judges one against an approval (the same rule, the same "equal is never below", the same unknown-standard reading).

  // a Firestore Timestamp, { seconds }, a Date, an ISO string or a number -> milliseconds; null when it is none of those (callers decide what an unknown time means)
  function toMs(t) {
    if (t === null || t === undefined || t === '') return null;
    if (typeof t === 'number') return isFinite(t) ? t : null;
    if (typeof t === 'string') { const ms = Date.parse(t); return isFinite(ms) ? ms : null; }
    if (typeof t === 'object') {
      try {
        if (typeof t.toMillis === 'function') { const m = t.toMillis(); return isFinite(m) ? m : null; }
        if (typeof t.toDate === 'function') { const d = t.toDate(); const m = d && typeof d.getTime === 'function' ? d.getTime() : NaN; return isFinite(m) ? m : null; }
        if (typeof t.getTime === 'function') { const m = t.getTime(); return isFinite(m) ? m : null; }
      } catch (e) { return null; }
      if (typeof t.seconds === 'number') return t.seconds * 1000 + Math.floor((Number(t.nanoseconds) || 0) / 1e6);
    }
    return null;
  }
  // the moment of his decision: the server stamp when it is there (it is comparable with approvedAt / returnedAt, which are server stamps too), else the client's ISO time
  function decisionMs(pf) {
    const a = toMs(pf && pf.atTs);
    return a !== null ? a : toMs(pf && pf.at);
  }

  // { total, lines: [{ key, unit }], at } | null. null unless the quote offers the carry (carry true) and says what its total is at his prices. A line takes his figure where he set one,
  // else the price he saw (a note changes nothing).
  function figuresBar(quote) {
    const pf = quote && quote.presidentFigures;
    if (!pf || pf.carry !== true) return null;
    const after = pf.totals && pf.totals.after;
    if (!after || typeof after.total !== 'number' || !isFinite(after.total)) return null;
    const to = {};
    (Array.isArray(pf.lines) ? pf.lines : []).forEach(function (r) { if (r && typeof r.to === 'number' && isFinite(r.to)) to[r.i] = r2(r.to); });
    const items = Array.isArray(quote.items) ? quote.items : [];
    return {
      total: r2(after.total),
      lines: items.map(function (it, i) { return { key: lineKey(it), unit: Object.prototype.hasOwnProperty.call(to, i) ? to[i] : r2(itemUnit(it || {})) }; }),
      at: String(pf.at || ''),
    };
  }

  // The offer that covers the revision being filed, or null. ALL must hold: data.parentQuoteId names a chain doc p; p is still returned (needs_revision); p offers a bar (figuresBar); and no OTHER
  // chain doc carries a decision by the President later than p's own: an approval he made himself (approvedBy, not carried) or any return. A later decision whose time is unknown counts as later
  // (fail closed: the revision then goes to him). chain: [{ id, ...data }] (the revision chain, the parent included).
  function figuresOfferFor(data, chain) {
    const parentId = data && data.parentQuoteId;
    if (!parentId) return null;
    const list = Array.isArray(chain) ? chain : [];
    let p = null;
    for (let i = 0; i < list.length; i++) { if (list[i] && list[i].id === parentId) { p = list[i]; break; } }
    if (!p || p.approvalStatus !== 'needs_revision' || !figuresBar(p)) return null;
    const at = decisionMs(p.presidentFigures);
    if (at === null) return null;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (!d || d.id === p.id) continue;
      if (d.approvedBy && !d.approvalCarriedFrom) { const t = toMs(d.approvedAt); if (t === null || t > at) return null; }
      if (d.returnedAt) { const t = toMs(d.returnedAt); if (t === null || t > at) return null; }
    }
    return p;
  }

  window.PriceGate = {
    REQUIRE_APPROVAL_FOR_PAYMENT: REQUIRE_APPROVAL_FOR_PAYMENT,
    lineKey: lineKey,
    snapshotFromQuote: snapshotFromQuote,
    lastApprovedFromChain: lastApprovedFromChain,
    pickLastApprovedQuote: pickLastApprovedQuote,
    evaluate: evaluate,
    figuresBar: figuresBar,
    figuresOfferFor: figuresOfferFor,
    toMs: toMs,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.PriceGate;
