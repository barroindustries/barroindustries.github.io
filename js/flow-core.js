if (typeof window === 'undefined') globalThis.window = globalThis;
// ═══════════════════════════════════════════════════════════════════════════
//  js/flow-core.js — pure logic for the order-and-job flow (specs/SALES-FLOW-SPEC-2026-11-19.md §5.4, §13.2 Phase 4). FIRST HALF only.
//
//  No DOM, no Firestore, no clock, no imports. Same file contract as js/sales-flow-core.js. It reads window.SalesFlow.orderState at
//  CALL time (the order-state rule is reused, never re-implemented), so it loads AFTER js/sales-flow-core.js. LAZY: it is loaded through
//  window.ensureScript('js/flow-core.js') by js/screens/flow-docs.js and js/screens/production.js, it is in sw.js PRECACHE, and it is NOT
//  in index.html's app-kit (that is Phase 8, when the second half — isRed, SLA_DAYS, delayDeductionPct — lands here too).
//
//  What lives here (every rule has a test, mutation-checked — tests/flow-core.test.mjs):
//    • jobStage()        — §5.4 key table: ONE stage key for every screen, first match from the end of the flow backward.
//    • canComplete()     — J8 guard: signed acceptance attached (url + signedBy + date) AND the punch list explicitly marked cleared.
//    • shouldClose()     — J9: stage 'completed' && balance <= 0 (±0.005) && no client credit.
//    • planClose()       — J9 write plan: stage 'paid', closedAt, stageAt.closed and a timeline event WITHOUT pesos. Never a money key.
//    • stageStamp()      — the stageAt.<key> dotted-path field every transition from the spec on writes.
//
//  PHASE 5 (specs/SALES-FLOW-SPEC-2026-11-19.md §5.6 site visits, §5.7 change orders — tests/flow-core-phase5.test.mjs):
//    • SITE_VISIT_FEE / siteVisitFee()   — the tariff by area ({ mm:1000, near:2500, far:5000 }); only the President changes the amount on a booking.
//    • validateVisitRequest / validateVisitReport, canVisitMove / canBookVisit, visitStatusWord — the visit's money-free rules and status words.
//    • validateChangeRequest, canPriceRequest / canSignOrder / canDeclineRequest, requestStatusWord — the money-free request and its status words.
//    • priceChangeOrder()                — price = Σ added (qty × unit price) − Σ removed (qty × unit price); may be negative; added down payment >= 0.
//    • changeOrderTotals()               — the new contract amount (current contract + price), or the revision's own figures once applied.
//    • claimStatusFor()                  — is the change order's added down payment recorded (Choice C is unlocked only then)?
//    • planBudgetAdd()                   — C6: job_money.budget.changeOrderAdds += 0.5 × price (a negative price lowers it), once per change order.
//    • pesoInText()                      — a price typed into free text (the peso wall: no peso reaches Production).
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const EPS = 0.005;

  // §5.4 keys, flow order. stageAt.<key> uses exactly these.
  const STAGE_KEYS = Object.freeze(['payment', 'so_jo', 'design', 'fabrication', 'qc', 'delivery', 'turnover', 'balance', 'closed', 'cancelled']);

  // Work-order stages written before the v12 rename (js/screens/production.js LEGACY_PROD_STAGE). Same map, kept here because this file is pure.
  const LEGACY_WO_STAGE = { queued: 'layouting', cutting: 'bending_cutting', welding: 'assembly', ready: 'out_for_delivery' };
  function woStage(w) {
    const s = String((w && w.stage) || 'layouting');
    return LEGACY_WO_STAGE[s] || s;
  }
  // A work order still on the floor: not delivered and not cancelled.
  function isOpenWorkOrder(w) {
    return !!w && woStage(w) !== 'delivered' && w.status !== 'cancelled' && woStage(w) !== 'cancelled';
  }

  // ── §5.4 — the stage key. First matching row wins, from the end of the flow backward. null when nothing matches. ────────────
  function jobStage(a) {
    a = a || {};
    const project = a.project || null;
    const order = a.order || null;
    const wos = Array.isArray(a.workOrders) ? a.workOrders : [];
    const ps = project ? project.stage : undefined;
    if (ps === 'cancelled') return 'cancelled';
    if (ps === 'paid') return 'closed';
    if (ps === 'completed') return 'balance';
    if (ps === 'delivered') return 'turnover';
    if (ps === 'for_delivery' || wos.some(function (w) { return woStage(w) === 'out_for_delivery'; })) return 'delivery';
    if (ps === 'in_production') {
      const open = wos.filter(isOpenWorkOrder);
      if (open.length > 0 && open.every(function (w) { return woStage(w) === 'qc'; })) return 'qc';
      return 'fabrication';
    }
    if (ps === 'in_design') return 'design';
    if (order) {
      const st = window.SalesFlow.orderState(order);
      if (st === 'confirmed') return 'so_jo';
      if (st === 'awaiting_confirmation' || st === 'rejected' || st === 'legacy_pending') return 'payment';
    }
    return null;
  }

  // The stage key a job_projects.stage value moves the job INTO (the stageAt.<key> to stamp), or null for a stage with none ('won').
  function keyForProjectStage(stage) {
    const k = { in_design: 'design', in_production: 'fabrication', for_delivery: 'delivery', delivered: 'turnover', completed: 'balance', paid: 'closed', cancelled: 'cancelled' }[stage];
    return k || null;
  }

  // { 'stageAt.<key>': nowIso } — a dotted path, so a Firestore update() sets one key and leaves the others. {} for an unknown key.
  function stageStamp(key, nowIso) {
    if (STAGE_KEYS.indexOf(key) < 0 || !nowIso) return {};
    const out = {};
    out['stageAt.' + key] = nowIso;
    return out;
  }

  // ── J8 — what is still missing before a job may enter 'completed'. [] = nothing. Codes: 'acceptance', 'punch_list'. ─────────────
  const txt = function (v) { return v == null ? '' : String(v).trim(); };
  function punchItems(project) {
    const pl = project && project.punchList;
    const arr = Array.isArray(pl) ? pl : (pl && Array.isArray(pl.items) ? pl.items : []);
    return arr.filter(function (x) { return x && txt(x.text || x.note); });
  }
  function acceptanceOk(project) {
    const a = project && project.acceptance;
    return !!(a && typeof a === 'object' && txt(a.url) && txt(a.signedBy) && txt(a.date));
  }
  // Cleared means someone pressed "Mark all cleared" (an EMPTY punch list counts only once it was explicitly cleared — spec J8: "punch list
  // marked cleared") and no listed item is still open. A bare array has no clearedAt, so it is never cleared.
  function punchCleared(project) {
    const pl = project && project.punchList;
    if (!pl || typeof pl !== 'object' || Array.isArray(pl)) return false;
    if (!pl.clearedAt) return false;
    return punchItems(project).every(function (x) { return !!x.done; });
  }
  function completeBlockers(project) {
    const out = [];
    if (!acceptanceOk(project)) out.push('acceptance');
    if (!punchCleared(project)) out.push('punch_list');
    return out;
  }
  function canComplete(project) { return completeBlockers(project).length === 0; }

  // ── J9 — the balance, and whether the job closes by itself ───────────────────────────────────────────────────────────────────
  // The stored arBalance when it is a number; otherwise contract − collected, but only when there IS a contract (an unknown balance never closes).
  function balanceOf(project) {
    const p = project || {};
    if (p.arBalance !== null && p.arBalance !== undefined && p.arBalance !== '' && isFinite(Number(p.arBalance))) return Number(p.arBalance);
    const c = Number(p.contractAmount);
    if (c > 0) return c - (Number(p.amountCollected) || 0);
    return null;
  }
  function shouldClose(project) {
    if (!project || project.stage !== 'completed') return false;
    const bal = balanceOf(project);
    if (bal === null || !(bal <= EPS)) return false;
    return !(Number(project.clientCredit) > 0);
  }

  // ctx = { nowIso, who }. null when the job must not close. The plan carries NO money key (no amountCollected, arBalance, payments,
  // contractAmount, clientCredit) and the timeline line has no peso sign, so Production can read it.
  function planClose(project, ctx) {
    if (!shouldClose(project)) return null;
    ctx = ctx || {};
    const nowIso = ctx.nowIso || '';
    const fields = Object.assign({ stage: 'paid', closedAt: nowIso }, stageStamp('closed', nowIso));
    return {
      fields: fields,
      timelineEvent: { at: nowIso, event: 'Closed — accepted and fully paid', by: ctx.who || '' },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  //  PHASE 5 — site visits (§5.6) and change orders (§5.7)
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  const r2 = function (n) { return Math.round((+n + Number.EPSILON) * 100) / 100; };
  const has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  const last6 = function (id) { return String(id == null ? '' : id).slice(-6).toUpperCase(); };
  // The peso wall: a price typed into free text. Same test as the forms engine (FormsCore PESO_TEXT), so a note this refuses is one the forms would refuse.
  const PESO_TEXT = /₱|PHP|Php/;
  function pesoInText() {
    for (let i = 0; i < arguments.length; i++) {
      const v = arguments[i];
      if (Array.isArray(v)) { if (pesoInText.apply(null, v)) return true; continue; }
      if (v && typeof v === 'object') { if (pesoInText.apply(null, Object.keys(v).map(function (k) { return v[k]; }))) return true; continue; }
      if (typeof v === 'string' && PESO_TEXT.test(v)) return true;
    }
    return false;
  }
  const PESO_MSG = 'Prices do not go in here. Remove the amount, then try again.';
  // A real calendar date as YYYY-MM-DD, or ''. (No Date object: this file reads no clock and builds no dates.)
  const isoDate = function (v) {
    const s = txt(v);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return '';
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1) return '';
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    return d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] ? s : '';
  };

  // ── site-visit fee (§5.6, owner SF6 / SF21: fixed by area; only the President changes it on a booking) ──────────────────────
  const SITE_VISIT_FEE = Object.freeze({ mm: 1000, near: 2500, far: 5000 });
  const SITE_VISIT_AREAS = Object.freeze([
    Object.freeze({ key: 'mm', label: 'Metro Manila' }),
    Object.freeze({ key: 'near', label: 'Nearby provinces' }),
    Object.freeze({ key: 'far', label: 'Far Luzon' }),
  ]);
  function siteVisitFee(area) { return has(SITE_VISIT_FEE, area) ? SITE_VISIT_FEE[area] : null; }
  function areaLabel(area) { const a = SITE_VISIT_AREAS.filter(function (x) { return x.key === area; })[0]; return a ? a.label : ''; }

  // ── site-visit status: requested → fee_pending → booked → done | cancelled ────────────────────────────────────────────────
  const VISIT_STATUSES = Object.freeze(['requested', 'fee_pending', 'booked', 'done', 'cancelled']);
  const VISIT_FLOW = { requested: ['fee_pending', 'cancelled'], fee_pending: ['booked', 'cancelled'], booked: ['done'], done: [], cancelled: [] };
  function canVisitMove(from, to) { return has(VISIT_FLOW, from) && VISIT_FLOW[from].indexOf(to) >= 0; }
  // The fee was confirmed: a visit still "requested" (the visit write after the claim failed) or "fee_pending" becomes booked. Never a cancelled or done one.
  function canBookVisit(status) { return status === 'requested' || status === 'fee_pending'; }
  // Sales may cancel a visit until the fee is confirmed (a booked visit has money behind it).
  function canCancelVisit(status) { return canVisitMove(status, 'cancelled'); }
  const VISIT_WORD = { requested: 'Requested', fee_pending: 'Fee waiting for confirmation', booked: 'Booked', done: 'Done', cancelled: 'Cancelled' };
  function visitStatusWord(status) { return has(VISIT_WORD, status) ? VISIT_WORD[status] : String(status || ''); }

  // a = { area, requestedDate, address, contactPerson, contactPhone, notes } (ctx.today = ISO date, optional). → { ok, error, visit }
  function validateVisitRequest(a, ctx) {
    a = a || {}; ctx = ctx || {};
    const visit = { area: txt(a.area), requestedDate: txt(a.requestedDate), address: txt(a.address), contactPerson: txt(a.contactPerson), contactPhone: txt(a.contactPhone), notes: txt(a.notes) };
    const out = function (error) { return { ok: !error, error: error || '', visit: visit }; };
    if (siteVisitFee(visit.area) === null) return out('Choose the area of the visit.');
    if (!isoDate(visit.requestedDate)) return out('Enter the date of the visit.');
    if (ctx.today && visit.requestedDate < ctx.today) return out('The visit date cannot be in the past.');
    if (!visit.address) return out('Enter the address of the site.');
    if (!visit.contactPerson) return out('Enter who to contact at the site.');
    if (visit.contactPhone.replace(/\D/g, '').length < 7) return out('Enter the contact phone number.');
    if (pesoInText(visit.notes, visit.address, visit.contactPerson)) return out(PESO_MSG);
    return out('');
  }
  // r = { measurements, constraints, layoutNotes, photos[], attachments[] } → { ok, error, report } (no by / at: the screen stamps those)
  function validateVisitReport(r) {
    r = r || {};
    const clean = function (list) {
      return (Array.isArray(list) ? list : []).map(function (f) { return f && txt(f.url) ? { url: txt(f.url), name: txt(f.name) } : null; }).filter(Boolean);
    };
    const report = { measurements: txt(r.measurements), constraints: txt(r.constraints), layoutNotes: txt(r.layoutNotes), photos: clean(r.photos), attachments: clean(r.attachments) };
    const out = function (error) { return { ok: !error, error: error || '', report: report }; };
    if (!report.measurements && !report.constraints && !report.layoutNotes) return out('Write the measurements, the site constraints or the layout notes.');
    if (pesoInText(report.measurements, report.constraints, report.layoutNotes)) return out(PESO_MSG);
    return out('');
  }

  // ── change request (no pesos, ever) ──────────────────────────────────────────────────────────────────────────────────────
  // status: requested → priced → signed → applied | declined. Re-pricing is allowed while the change order is only priced.
  const REQUEST_FLOW = { requested: ['priced', 'declined'], priced: ['signed', 'declined'], signed: ['applied'], applied: [], declined: [] };
  function canRequestMove(from, to) { return has(REQUEST_FLOW, from) && REQUEST_FLOW[from].indexOf(to) >= 0; }
  function canPriceRequest(reqStatus, coStatus) { return reqStatus === 'requested' || (reqStatus === 'priced' && (!coStatus || coStatus === 'priced')); }
  function canSignOrder(coStatus) { return coStatus === 'priced'; }
  function canDeclineRequest(reqStatus) { return canRequestMove(reqStatus, 'declined'); }
  // The words Production reads on the job — never a price. `appliedContractRev` is the revision number the apply wrote.
  function requestStatusWord(req) {
    const s = req && req.status;
    if (s === 'requested') return 'Requested';
    if (s === 'priced') return 'Priced';
    if (s === 'signed') return 'Signed';
    if (s === 'applied') { const n = Math.floor(Number(req.appliedContractRev) || 0); return n > 0 ? 'Applied — see JO R' + n : 'Applied'; }
    if (s === 'declined') return 'Declined';
    return String(s || '');
  }
  // One money-free scope line (joScopeRow's keys that matter here): name, qty, unit. → null for a blank row; { error } for a half-filled one.
  function cleanScopeLine(l) {
    const name = txt(l && l.name), qtyRaw = txt(l && l.qty), unit = txt(l && l.unit) || 'pc';
    if (!name && !qtyRaw) return null;
    const qty = Number(qtyRaw === '' ? 1 : qtyRaw);
    if (!name) return { error: 'Give each item a name.' };
    if (!isFinite(qty) || qty <= 0) return { error: 'The quantity of "' + name + '" must be more than zero.' };
    return { name: name, qty: qty, unit: unit };
  }
  // a = { details, itemsAdded[], itemsRemoved[], effectOnDeadlineDays } → { ok, error, request }
  function validateChangeRequest(a) {
    a = a || {};
    const request = { details: txt(a.details), itemsAdded: [], itemsRemoved: [], effectOnDeadlineDays: 0 };
    const out = function (error) { return { ok: !error, error: error || '', request: request }; };
    if (request.details.length < 5) return out('Describe the change (at least a few words).');
    const lists = [['itemsAdded', a.itemsAdded], ['itemsRemoved', a.itemsRemoved]];
    for (let i = 0; i < lists.length; i++) {
      const rows = Array.isArray(lists[i][1]) ? lists[i][1] : [];
      for (let j = 0; j < rows.length; j++) {
        const l = cleanScopeLine(rows[j]);
        if (l && l.error) return out(l.error);
        if (l) request[lists[i][0]].push(l);
      }
    }
    const raw = txt(a.effectOnDeadlineDays);
    const days = raw === '' ? 0 : Number(raw);
    if (!isFinite(days) || Math.floor(days) !== days || Math.abs(days) > 365) return out('Days on the deadline must be a whole number, like 3 or 0.');
    request.effectOnDeadlineDays = days;
    if (pesoInText(request)) return out(PESO_MSG);
    return out('');
  }

  // ── change order pricing (§5.7 C2) ────────────────────────────────────────────────────────────────────────────────────────
  // a = { lines:[{ kind:'added'|'removed', name, qty, unit, unitPrice, std? }], addedDownPayment }.
  // price = Σ added (qty × unitPrice) − Σ removed (qty × unitPrice): it may be negative or zero. addedDownPayment is >= 0, and only on a price that rises.
  // → { ok, error, lines, price, addedDownPayment } (numbers are returned even when invalid, as PaymentClaims.validateRecord does).
  const lineSign = function (l) { return l && l.kind === 'removed' ? -1 : 1; };
  function lineAmount(l) { return r2(lineSign(l) * (Number(l && l.qty) || 0) * (Number(l && l.unitPrice) || 0)); }
  function priceChangeOrder(a) {
    a = a || {};
    const lines = [];
    let error = '';
    (Array.isArray(a.lines) ? a.lines : []).forEach(function (l) {
      if (error) return;
      const name = txt(l && l.name), qtyRaw = txt(l && l.qty), priceRaw = txt(l && l.unitPrice);
      if (!name && !qtyRaw && !priceRaw) return;
      const kind = l && l.kind === 'removed' ? 'removed' : 'added';
      const qty = Number(qtyRaw), unitPrice = Number(priceRaw === '' ? NaN : priceRaw);
      if (!name) { error = 'Give each line a name.'; return; }
      if (!isFinite(qty) || qty <= 0) { error = 'The quantity of "' + name + '" must be more than zero.'; return; }
      if (!isFinite(unitPrice) || unitPrice < 0) { error = 'Enter the unit price of "' + name + '" (0 or more). Items removed take their price off.'; return; }
      lines.push({ kind: kind, name: name, qty: qty, unit: txt(l.unit) || 'pc', unitPrice: r2(unitPrice), std: l.std == null || l.std === '' || !isFinite(Number(l.std)) ? null : r2(Number(l.std)) });
    });
    const price = r2(lines.reduce(function (s, l) { return s + lineAmount(l); }, 0));
    const dpRaw = txt(a.addedDownPayment);
    const dp = dpRaw === '' ? 0 : Number(dpRaw);
    const out = function (e) { return { ok: !e, error: e || '', lines: lines, price: price, addedDownPayment: isFinite(dp) ? r2(dp) : 0 }; };
    if (error) return out(error);
    if (!lines.length) return out('Add at least one line.');
    if (!isFinite(dp) || dp < 0) return out('The added down payment must be 0 or more.');
    if (dp > 0) {
      if (price <= 0) return out('Only a change order that raises the price takes an added down payment.');
      if (dp > price + 0.005) return out('The added down payment cannot be more than the price.');
    }
    return out('');
  }

  // The figures printed on the Change order: contract now, this change, the new contract amount. `appliedRevision` is the sales_orders.revisions entry written
  // when this change order was applied: the contract already includes the price by then, so the revision's own from / to are printed (never price twice).
  function changeOrderTotals(a) {
    a = a || {};
    const price = r2(Number(a.price) || 0);
    const rv = a.appliedRevision;
    if (rv && isFinite(Number(rv.fromAmount)) && isFinite(Number(rv.toAmount))) return { before: r2(Number(rv.fromAmount)), price: price, after: r2(Number(rv.toAmount)), applied: true };
    const before = r2(Number(a.contractNow) || 0);
    return { before: before, price: price, after: r2(before + price), applied: false };
  }

  // Is the change order's added down payment in the books? claims = this change order's payment_claims ([{ status, recordedAmount }]).
  //   'recorded'         the confirmed amounts add up to the added down payment (Choice C / the apply may go ahead)
  //   'partial'          something is confirmed, but less than asked
  //   'pending'          a claim waits for confirmation          'payment_rejected'  the only claim was sent back          null  no claim at all
  function claimStatusFor(addedDownPayment, claims) {
    const list = (Array.isArray(claims) ? claims : []).filter(Boolean);
    if (!list.length) return null;
    const need = r2(Number(addedDownPayment) || 0);
    const done = r2(list.filter(function (c) { return c.status === 'recorded'; }).reduce(function (s, c) { return s + (Number(c.recordedAmount) || 0); }, 0));
    if (done > 0 && done >= need - 0.005) return 'recorded';
    if (list.some(function (c) { return c.status === 'pending'; })) return 'pending';
    if (done > 0) return 'partial';
    return list.some(function (c) { return c.status === 'payment_rejected'; }) ? 'payment_rejected' : null;
  }

  // ── C6: the budget (§5.7, owner S12 / SF20): job_money.budget.changeOrderAdds += 0.5 × price; a negative price lowers it ──────
  const CHANGE_ORDER_BUDGET_SHARE = 0.5;
  // doc = the job_money doc ({ budget:{ base?, changeOrderAdds?, total?, coApplied?[] } }) or null. → { skip, reason? } | { skip:false, add, budget }.
  // `coApplied` lists the change orders already counted, so a second run for the same change order adds nothing. `total` follows only when a base exists.
  function planBudgetAdd(doc, a) {
    a = a || {};
    const id = txt(a.changeOrderId), price = Number(a.price);
    if (!id || !isFinite(price)) return { skip: true, reason: 'invalid' };
    const b = doc && doc.budget && typeof doc.budget === 'object' ? doc.budget : {};
    const done = Array.isArray(b.coApplied) ? b.coApplied : [];
    if (done.indexOf(id) >= 0) return { skip: true, reason: 'already-counted' };
    const add = r2(CHANGE_ORDER_BUDGET_SHARE * price);
    const adds = r2((Number(b.changeOrderAdds) || 0) + add);
    const budget = Object.assign({}, b, { changeOrderAdds: adds, coApplied: done.concat([id]) });
    if (b.base !== null && b.base !== undefined && b.base !== '' && isFinite(Number(b.base))) budget.total = r2(Number(b.base) + adds);
    return { skip: false, add: add, budget: budget };
  }

  window.FlowCore = {
    STAGE_KEYS: STAGE_KEYS,
    jobStage: jobStage,
    keyForProjectStage: keyForProjectStage,
    stageStamp: stageStamp,
    completeBlockers: completeBlockers,
    canComplete: canComplete,
    balanceOf: balanceOf,
    shouldClose: shouldClose,
    planClose: planClose,
    // Phase 5
    SITE_VISIT_FEE: SITE_VISIT_FEE,
    SITE_VISIT_AREAS: SITE_VISIT_AREAS,
    siteVisitFee: siteVisitFee,
    areaLabel: areaLabel,
    VISIT_STATUSES: VISIT_STATUSES,
    canVisitMove: canVisitMove,
    canBookVisit: canBookVisit,
    canCancelVisit: canCancelVisit,
    visitStatusWord: visitStatusWord,
    validateVisitRequest: validateVisitRequest,
    validateVisitReport: validateVisitReport,
    canRequestMove: canRequestMove,
    canPriceRequest: canPriceRequest,
    canSignOrder: canSignOrder,
    canDeclineRequest: canDeclineRequest,
    requestStatusWord: requestStatusWord,
    validateChangeRequest: validateChangeRequest,
    lineAmount: lineAmount,
    priceChangeOrder: priceChangeOrder,
    changeOrderTotals: changeOrderTotals,
    claimStatusFor: claimStatusFor,
    CHANGE_ORDER_BUDGET_SHARE: CHANGE_ORDER_BUDGET_SHARE,
    planBudgetAdd: planBudgetAdd,
    pesoInText: pesoInText,
    PESO_TEXT_MESSAGE: PESO_MSG,
    last6: last6,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.FlowCore;
