/* qb/kc-rules.js: window.KCRules.  The pure money and approval rules of the Barro Kitchens configurators in the live quote builder.
   Spec: specs/BK-LIVE-INTEGRATION-SPEC-2026-11-19.md sections 1.3, 3.4, 3.5 and 6.2.  Packet B.

   WHAT THIS FILE IS
     ONE copy of the money math.  The engine (the bundle qb/kc.min.js: KC.sell, KC.price), the pricing bridge (qb/d7/d7-pricing.js) and the approval flow (qb/d7/d7-flow.js)
     CALL these functions; none of them writes the arithmetic again, so a rule is changed here, once, and tests/kc-rules.test.mjs (and its mutation log) pins it.
     Everything here is pure: no DOM, no Firestore, no global state, no price.  It never throws on junk (a missing or non-numeric input falls to the conservative reading).
     UMD: in the browser it sets window.KCRules; in Node it is module.exports.  ES5 on purpose (the same style as js/qb-spec-sheet.js).

   NO PRICE IN THIS FILE.  The only numbers are formula constants (the rounding step, the lead-time band and its two day counts), already public in the live builder.

   MONEY IS COMPARED IN CENTAVOS.  net, standard total and last approved total are compared after rounding each to a whole centavo, so float noise (495945.00000000006 against
   495945) never turns an unchanged quote into "below the approved total".  Equal totals are NOT below (the comparison is "<", never "<=").

   CONTRACT FOR THE OTHER PACKETS (also in the packet B report)
     round10(x)                                    nearest 10 pesos
     r1(M, bracketPct, miscPct, typedLabor?)       -> { labor, misc, projectCost }  (projectCost = the group's cost: materials + labor + misc)
     sellUnit({ projectCost, markup, listAdj, share })   round10(projectCost x markup + listAdj + share); listAdj and share default 0; the share is added BEFORE rounding
     bracketOfSection(sectionId)                   'complex' for cook, cooking_line, baking; else 'medium'
     standardUnit({ kind, floorMode, projectCost, stdMarkup, listAuto, cataloguePrice, quoted }) -> { unit, known }
         kind 'kc' (or 'list')            a configured line.  listAuto (> 0) = its list-based auto price at the standard markup, which makes it a list-priced line.
                                          list-priced and floorMode is not 'formula' -> unit = listAuto.   Otherwise, with a project cost > 0 and a markup: unit = round10(projectCost x stdMarkup).
         kind 'catalogue' (or 'website')  unit = cataloguePrice (> 0).  (With the setting catalogueCostPricing on, the caller passes kind 'kc' for a catalogue line that has a cost.)
         anything else, or the inputs are missing -> no basis: unit = quoted (neutral), known = false.
     belowMarkupThreshold({ floorMode, listPrice, projectCost, stdMarkup })   the list price when floorMode is not 'formula' and there is a list price (> 0); else round10(projectCost x stdMarkup)
     belowMarkup(typed, threshold)                 typed < threshold
     discountCap(preDiscount, trueCostTotal)       max(0, preDiscount - trueCostTotal)
     approvalRequired({ role, reviewOpen, net, standardTotal, costKnown, approvalBelowStandard, approveAll, covered })
         -> { required, locked, reason, reasons, preTick }
         required   approval must be sent.  Never for the President, never while covered.  Otherwise: a line needs review and is not marked reviewed (reviewOpen), or net is below
                    standardTotal and approvalBelowStandard is not 'tick' (the default is 'force'), or approveAll.
         locked     the "send for approval" tick is ticked and disabled.  Equal to required: the President is never required and so never locked.
         reasons    the codes that apply, in this order: 'review', 'below-standard', 'approve-all' ([] when not required).
         reason     the same reasons in plain words, joined with "; " ('' when not required).  The row reads "Needs the President's approval: <reason>".
         preTick    approvalBelowStandard is 'tick' and net is below standardTotal: the box is only pre-ticked, not locked (the live "below floor" tick).
         costKnown is accepted and not used here: a line with no cost basis already counts at its quoted price in standardTotal (section 3.4), so it is neutral.
     needsReapproval({ net, lastApprovedNet, standardTotal, costKnown })
         no lastApprovedNet -> true (there is nothing to carry: the rules of approvalRequired apply).   net >= lastApprovedNet -> false, whatever changed.
         net < lastApprovedNet: cost known -> true only if net < standardTotal as well; cost unknown -> true.
     approvalCovers({ carry, net, standardTotal, costKnown })    !!carry && !needsReapproval({ net, lastApprovedNet: carry.lastApprovedNet, standardTotal, costKnown })
     shouldHold({ fromFiled, basis, stored, fresh })             fromFiled && basis === 'configured' && stored > 0 && stored !== fresh
     aboveListReport(rows)   rows { code, list, projectCost, stdMarkup } -> those whose projectCost x stdMarkup is above list, each with costTimesMarkup and diff (the difference)
     leadWorkingDays(materials)                    max(25, 12 + 3 x floor(materials / 20000))   (a check that kc materials feed the existing lead-time rule; the page keeps its own)

   THE STANDARD PRICE LIST (Addendum 1 A1: every configured line prices from the list)
     nearestStd(len, stdLens)                      the standard length nearest to len (mm); on a tie the SHORTER one; null when there is none
     lengthAdj({ len, stdLen, perMetre })          (len - stdLen) / 1000 x perMetre when all three are numbers, else 0 (a code with no per-metre rate carries the size in the options)
     listAdj({ list, perMetre, len, stdLen, sellBase })  -> { lengthAdj, adj }   adj = list + lengthAdj - sellBase, where sellBase is the formula selling price of the base model.
                                                   The unit of the line is sellUnit({ projectCost, markup, listAdj: adj }) = round10(sell + adj) = round10(list + lengthAdj + (sell - sellBase)):
                                                   the list price of the base model, plus the per-metre length difference, plus what the options add by formula (it may be negative).
     formulaBelowList({ formulaSell, listUnit, floorMode })   true only when floorMode is 'formula' and the formula selling price is under 90 % of the list-based unit (a warning for the
                                                   President; the price is never replaced) */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;       // Node (the tests)
  else if (typeof window !== 'undefined') window.KCRules = api;                             // the page, or the tests' vm context
  else if (root && typeof root === 'object') root.KCRules = api;
})(this, function () {
  'use strict';

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function cents(x) { return Math.round(x * 100); }

  /* ---------- R1 and the selling price ---------- */
  function round10(x) { return Math.round(x / 10) * 10; }

  /* labor = the typed labor when one is given (even 0), else materials x the bracket %; misc = the misc % of (materials + labor) */
  function r1(M, bracketPct, miscPct, typedLabor) {
    var labor = typedLabor != null ? typedLabor : M * bracketPct / 100;
    var misc = miscPct / 100 * (M + labor);
    return { labor: labor, misc: misc, projectCost: M + labor + misc };
  }

  /* the selling price of one unit: the list adjustment and the distributed share are added before the one rounding */
  function sellUnit(o) {
    o = o || {};
    var listAdj = o.listAdj || 0, share = o.share || 0;
    return round10(o.projectCost * o.markup + listAdj + share);
  }

  /* the labor bracket of a section (Q42): the cooking and baking sections are Complex, every other section Medium */
  var COMPLEX_SECTIONS = { cook: true, cooking_line: true, baking: true };
  function bracketOfSection(sectionId) {
    return Object.prototype.hasOwnProperty.call(COMPLEX_SECTIONS, String(sectionId)) ? 'complex' : 'medium';
  }

  /* ---------- the standard unit price of a line (section 3.4) ---------- */
  function noBasis(o) { return { unit: isNum(o.quoted) ? o.quoted : 0, known: false }; }
  function standardUnit(o) {
    o = o || {};
    var kind = o.kind;
    if (kind === 'catalogue' || kind === 'website') {
      if (isNum(o.cataloguePrice) && o.cataloguePrice > 0) return { unit: o.cataloguePrice, known: true };
      return noBasis(o);
    }
    if (kind === 'kc' || kind === 'list') {
      if (o.floorMode !== 'formula' && isNum(o.listAuto) && o.listAuto > 0) return { unit: o.listAuto, known: true };
      if (isNum(o.projectCost) && o.projectCost > 0 && isNum(o.stdMarkup)) return { unit: round10(o.projectCost * o.stdMarkup), known: true };
      return noBasis(o);
    }
    return noBasis(o);
  }

  /* ---------- the below-markup warning (Q64) ---------- */
  function belowMarkupThreshold(o) {
    o = o || {};
    if (o.floorMode !== 'formula' && isNum(o.listPrice) && o.listPrice > 0) return o.listPrice;
    return round10(o.projectCost * o.stdMarkup);
  }
  function belowMarkup(typed, threshold) { return typed < threshold; }

  /* the largest discount: the quote may not go below its true cost (pass-throughs are exempt in the page) */
  function discountCap(preDiscount, trueCostTotal) { return Math.max(0, preDiscount - trueCostTotal); }

  /* ---------- approval (section 1.3) ---------- */
  var REASON_TEXT = {
    'review': 'a line needs review',
    'below-standard': 'the quote sells below its standard price',
    'approve-all': 'every quote needs the President\'s approval'
  };
  function approvalRequired(o) {
    o = o || {};
    var belowStd = isNum(o.net) && isNum(o.standardTotal) && cents(o.net) < cents(o.standardTotal);
    var tickOnly = o.approvalBelowStandard === 'tick';
    var exempt = o.role === 'president' || !!o.covered;          // the President is the approver; a quote the last approval still covers needs no new one
    var reasons = [];
    if (o.reviewOpen) reasons.push('review');
    if (belowStd && !tickOnly) reasons.push('below-standard');
    if (o.approveAll) reasons.push('approve-all');
    var required = !exempt && reasons.length > 0;
    var shown = required ? reasons : [];
    return {
      required: required,
      locked: required,
      reasons: shown,
      reason: shown.map(function (c) { return REASON_TEXT[c]; }).join('; '),
      preTick: !exempt && belowStd && tickOnly
    };
  }

  /* reopening an approved quote (Q65): the approval is kept until the total falls below what the President approved and below cost x the standard markup */
  function needsReapproval(o) {
    o = o || {};
    if (!isNum(o.lastApprovedNet)) return true;
    if (!isNum(o.net)) return true;
    var below = cents(o.net) < cents(o.lastApprovedNet);
    if (o.costKnown && isNum(o.standardTotal)) return below && cents(o.net) < cents(o.standardTotal);
    return below;
  }
  function approvalCovers(o) {
    o = o || {};
    return !!o.carry && !needsReapproval({ net: o.net, lastApprovedNet: o.carry.lastApprovedNet, standardTotal: o.standardTotal, costKnown: o.costKnown });
  }

  /* a configured line loaded from a filed quote keeps its stored price while the fresh formula price differs (section 3.5, rule 2) */
  function shouldHold(o) {
    o = o || {};
    return !!o.fromFiled && o.basis === 'configured' && o.stored > 0 && o.stored !== o.fresh;
  }

  /* Pricing settings, President only: the Chef Mode rows whose cost x the standard markup is above the list price (Q64) */
  function aboveListReport(rows) {
    var out = [];
    (rows || []).forEach(function (r) {
      if (!r || !isNum(r.list) || !isNum(r.projectCost) || !isNum(r.stdMarkup)) return;
      var cx = r.projectCost * r.stdMarkup;
      if (cents(cx) > cents(r.list)) out.push({ code: r.code, list: r.list, projectCost: r.projectCost, stdMarkup: r.stdMarkup, costTimesMarkup: cx, diff: (cents(cx) - cents(r.list)) / 100 });
    });
    return out;
  }

  /* the lead time the page already uses: 12 working days + 3 for each full band of materials, never under 25 */
  function leadWorkingDays(materials) {
    var m = isNum(materials) && materials > 0 ? materials : 0;
    return Math.max(25, 12 + 3 * Math.floor(m / 20000));
  }

  /* ---------- the Standard Price List (Addendum 1 A1) ---------- */
  /* the standard length nearest to len; the distance is compared to 0.01 mm so that float noise never breaks a tie, and a tie takes the shorter length */
  function nearestStd(len, stdLens) {
    if (!isNum(len) || !stdLens || !stdLens.length) return null;
    var best = null, bestD = 0;
    for (var i = 0; i < stdLens.length; i++) {
      var s = stdLens[i];
      if (!isNum(s)) continue;
      var d = Math.round(Math.abs(len - s) * 100) / 100;
      if (best === null || d < bestD || (d === bestD && s < best)) { best = s; bestD = d; }
    }
    return best;
  }

  /* the length difference in metres times the per-metre rate of the base model; nothing when the code has no per-metre rate or a length is unknown */
  function lengthAdj(o) {
    o = o || {};
    if (!isNum(o.perMetre) || !isNum(o.len) || !isNum(o.stdLen)) return 0;
    return (o.len - o.stdLen) / 1000 * o.perMetre;
  }

  /* what is added to the formula selling price of the line to reach the list-based price: list + length difference - the formula price of the base model */
  function listAdj(o) {
    o = o || {};
    var len = lengthAdj(o);
    return { lengthAdj: len, adj: o.list + len - o.sellBase };
  }

  /* once materials are priced: a formula price more than 10 % under the list-based unit is worth a look (President only; the page shows it only in 'formula' floor mode) */
  function formulaBelowList(o) {
    o = o || {};
    if (o.floorMode !== 'formula' || !isNum(o.formulaSell) || !isNum(o.listUnit) || !(o.listUnit > 0)) return false;
    return cents(o.formulaSell) < cents(0.9 * o.listUnit);
  }

  return {
    round10: round10, r1: r1, sellUnit: sellUnit, bracketOfSection: bracketOfSection, standardUnit: standardUnit,
    belowMarkupThreshold: belowMarkupThreshold, belowMarkup: belowMarkup, discountCap: discountCap,
    approvalRequired: approvalRequired, needsReapproval: needsReapproval, approvalCovers: approvalCovers,
    shouldHold: shouldHold, aboveListReport: aboveListReport, leadWorkingDays: leadWorkingDays,
    nearestStd: nearestStd, lengthAdj: lengthAdj, listAdj: listAdj, formulaBelowList: formulaBelowList
  };
});
