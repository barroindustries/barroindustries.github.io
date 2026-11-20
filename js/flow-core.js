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
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.FlowCore;
