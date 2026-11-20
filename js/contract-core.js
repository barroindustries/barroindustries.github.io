if (typeof window === 'undefined') globalThis.window = globalThis;
// ═══════════════════════════════════════════════════════════════════════════
//  js/contract-core.js — F3 "Revise contract amount" (specs/SALES-FLOW-SPEC-2026-11-19.md §7). Pure logic.
//
//  No DOM, no Firestore, no clock, no imports. Same file contract as js/sales-flow-core.js. It reads
//  window.SalesFlow.canConfirmPayment at CALL time (the stand-in test is reused, never re-implemented), so it loads
//  AFTER js/sales-flow-core.js. js/money-core.js (frozen) is not needed here: every figure is centavo-rounded locally.
//
//  What lives here:
//    • gate()        — §7.3, who has to act (President approval vs. a one-tap confirmation).
//    • lastApproved()— §7.3 helper: the bar a Choice B/C amount is compared with.
//    • planApply()   — §7.4/§7.5, every number and every written object as data; refusal codes.
//    • runApply()    — §7.4, the orchestration with INJECTED dependencies (mirrors SalesFlow.runConfirmation).
//    • planRefund()  — §7.7, a refund of client credit.
//
//  Money rules kept here (each has a test, mutation-checked in tests/contract-core.test.mjs):
//    • the books post ONLY THE DIFFERENCE, as a receivable adjustment (asset / Accounts Receivable), never income;
//    • payments are never touched: no amountCollected / payments / stage key in an apply plan;
//    • exactly once: ref SO-<id>-R<n>; a repeat stops at 'already-applied'; a retry after a failed order write repairs
//      the order WITHOUT re-sending the job fields.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const r2 = function (n) { return Math.round((+n + Number.EPSILON) * 100) / 100; };
  const num = function (n) { return Number(n) || 0; };
  const sf = function () { return window.SalesFlow; };

  // ── §7.3 gate ──────────────────────────────────────────────────────────────────────────────────────────────────
  // a = { kind:'quote_revision'|'manual'|'change_order', toAmount, lastApproved, stdTotal, collected, quoteApproved? }
  // → { approval:'president'|'none', reason }. `quoteApproved` (default true) is only read for Choice A: the screen
  // offers approved (own or carried) revisions only, so it is true by default; pass false and A falls through to B/C.
  function gate(a) {
    a = a || {};
    const to = r2(a.toAmount);
    if (!isFinite(to) || a.toAmount === null || a.toAmount === undefined || a.toAmount === '') return { approval: 'president', reason: 'invalid_amount' };
    // The client would be owed money: always the President, even for an approved quote revision (§7.7).
    if (to < r2(num(a.collected))) return { approval: 'president', reason: 'overpayment' };
    if (a.kind === 'quote_revision' && a.quoteApproved !== false) return { approval: 'none', reason: '' };
    const la = r2(num(a.lastApproved));
    if (to >= la) return { approval: 'none', reason: '' };
    const unknownStd = a.stdTotal === null || a.stdTotal === undefined || a.stdTotal === '';
    if (unknownStd || to < r2(a.stdTotal)) return { approval: 'president', reason: 'below_approved_and_standard' };
    return { approval: 'none', reason: '' };
  }

  // §7.3: lastApproved = the newest of the chain's approved total ({total, at}) and the toAmount of the last contract
  // revision Neil decided himself; if neither exists, originalContractAmount (the figure he accepted at payment
  // confirmation), else the current contractAmount. Dates are ISO strings (compared as strings); a missing date loses.
  function lastApproved(a) {
    a = a || {};
    const cands = [];
    if (a.chainApproved && isFinite(Number(a.chainApproved.total))) cands.push({ at: String(a.chainApproved.at || ''), total: Number(a.chainApproved.total) });
    (a.revisions || []).forEach(function (r) {
      if (r && r.decidedByRole === 'president') {
        cands.push({ at: String(r.decidedAt || ''), total: Number(r.toAmount) });
      }
    });
    if (cands.length) {
      cands.sort(function (x, y) { return x.at < y.at ? 1 : x.at > y.at ? -1 : 0; });
      return r2(cands[0].total);
    }
    if (a.originalContractAmount != null && isFinite(Number(a.originalContractAmount))) return r2(a.originalContractAmount);
    return r2(num(a.contractAmount));
  }

  // ── §7.4 / §7.5 plan ───────────────────────────────────────────────────────────────────────────────────────────
  // ctx = { today, nowIso, who, viewer:{uid,isPresident,isFinanceTier}, union(...items), serverTime(), deleteField(),
  //         sanitize?(ref), revNo?, quote?:{id,number,items}, changeOrder?:{status, addedDownPayment, claimStatus} }
  // Returns { ok:false, code } or the plan. Refusal order is the §7.4 table, top to bottom. Nothing here writes.
  function planApply(order, project, ctx) {
    ctx = ctx || {};
    order = order || {};
    const pr = order.pendingRevision;
    const union = ctx.union || function () { return Array.prototype.slice.call(arguments); };
    const serverTime = ctx.serverTime || function () { return null; };
    const deleteField = ctx.deleteField || function () { return null; };
    const viewer = ctx.viewer;

    if (!pr) {
      const held = (order.revisions || []).some(function (r) {
        return r && (ctx.revNo != null ? r.revNo === ctx.revNo : r.revNo === order.contractRev && num(order.contractRev) > 0);
      });
      return { ok: false, code: held ? 'already-applied' : 'nothing-pending' };
    }
    // A rejected request waits for its proposer (§10.1): there is nothing to apply.
    if (pr.status !== 'pending_approval' && pr.status !== 'pending_confirm') return { ok: false, code: 'nothing-pending' };
    if (pr.status === 'pending_approval' && !(viewer && viewer.isPresident)) return { ok: false, code: 'president-only' };
    // Stand-in test reused from payments; "not her own request" is judged on who filed the revision.
    if (!sf().canConfirmPayment({ createdBy: pr.requestedBy }, viewer)) return { ok: false, code: 'not-allowed' };

    const from = r2(order.contractAmount);
    const to = r2(pr.toAmount);
    if (pr.revNo !== num(order.contractRev) + 1) return { ok: false, code: 'stale' };
    if (Math.abs(r2(pr.fromAmount) - from) > 0.005) return { ok: false, code: 'stale' };
    if (order.status !== 'recorded') return { ok: false, code: 'payment-not-confirmed' };
    if (!project) return { ok: false, code: 'no-project' };
    if (project.stage === 'paid' || project.stage === 'cancelled') return { ok: false, code: 'job-closed' };
    if (pr.kind === 'change_order') {
      const co = ctx.changeOrder;
      if (!co || co.status !== 'signed') return { ok: false, code: 'change-order-not-ready' };
      if (num(co.addedDownPayment) > 0 && co.claimStatus !== 'recorded') return { ok: false, code: 'change-order-not-ready' };
    }
    if (pr.kind === 'quote_revision' && !(ctx.quote && Array.isArray(ctx.quote.items))) return { ok: false, code: 'quote-missing' };

    const n = num(order.contractRev) + 1;
    const delta = r2(to - from);
    const collected = r2(num(project.amountCollected));
    const arAfter = Math.max(0, r2(to - collected));
    const creditAfter = Math.max(0, r2(collected - to));
    const who = String(ctx.who || '');
    const soNumber = order.soNumber || ('SO-' + order.id);
    const joNumber = project.joNumber || order.joNumber || '';
    const isA = pr.kind === 'quote_revision';
    const ref = 'SO-' + order.id + '-R' + n;
    const ledgerId = typeof ctx.sanitize === 'function' ? ctx.sanitize(ref) : ref;
    const stamp = sf().decisionStamp(viewer, who, ctx.nowIso);
    const scopeChanged = pr.kind === 'change_order' || (isA && JSON.stringify(ctx.quote.items) !== JSON.stringify(project.items || []));

    // §7.5: only the difference, as a receivable adjustment. delta === 0 → no row at all.
    const ledgerEntry = delta === 0 ? null : {
      ref: ref, date: ctx.today,
      kind: delta >= 0 ? 'debit' : 'credit',
      accountType: 'asset', account: 'Accounts Receivable', category: 'Contract adjustment',
      description: 'Contract revised — ' + (order.clientName || '') + ' (' + soNumber + ' R' + n + '): ₱' + from + ' → ₱' + to,
      amount: Math.abs(delta),
      source: 'Sales', projectId: order.projectId || null,
      extra: { contractFrom: from, contractTo: to, signedDelta: delta, revNo: n, kind: pr.kind, confirmedBy: who },
    };

    const joRevNote = scopeChanged ? 'Contract amount and scope revised' : 'Contract amount revised';
    const projectFields = Object.assign({
      contractAmount: to, arBalance: arAfter, clientCredit: creditAfter,
      joRev: n, joRevAt: ctx.nowIso, joRevNote: joRevNote,
    },
    isA ? { items: ctx.quote.items, quoteId: ctx.quote.id != null ? ctx.quote.id : (pr.quoteId || null), quoteNumber: ctx.quote.number != null ? ctx.quote.number : (pr.quoteNumber || null) } : {},
    (scopeChanged && project.jobOrder && project.jobOrder.items) ? { 'jobOrder.scopeReviewNeeded': true } : {},
    {
      timeline: union({ at: ctx.nowIso, event: 'Contract revised — ' + soNumber + ' R' + n + (joNumber ? ' / ' + joNumber + ' R' + n : ''), by: who }),
      // One union with both rows: a document can carry only one array-union per field per write.
      documents: union(
        { type: 'Sales Order', ref: soNumber + ' R' + n, at: ctx.nowIso, by: who },
        { type: 'Job Order', ref: (joNumber || 'JO') + ' R' + n, at: ctx.nowIso, by: who }),
      updatedAt: serverTime(),
    });

    const revision = {
      revNo: n, kind: pr.kind, fromAmount: from, toAmount: to, delta: delta, changeReason: pr.changeReason || '',
      quoteId: pr.quoteId || null, quoteNumber: pr.quoteNumber || null, changeOrderId: pr.changeOrderId || null,
      requestedBy: pr.requestedBy || null, requestedByName: pr.requestedByName || '', requestedAt: pr.requestedAt || null,
      decision: pr.status === 'pending_approval' ? 'approved' : 'confirmed',
      decidedBy: stamp.decidedBy, decidedByName: stamp.decidedByName, decidedByRole: stamp.decidedByRole,
      onBehalf: stamp.onBehalf, decidedAt: stamp.decidedAt,
      ledgerId: delta === 0 ? null : ledgerId, collectedAtApply: collected, arAfter: arAfter, clientCreditAfter: creditAfter,
    };
    const orderPatch = Object.assign({
      contractAmount: to, contractRev: n,
      originalContractAmount: order.originalContractAmount != null ? order.originalContractAmount : from,
      revisions: union(revision),
      pendingRevision: deleteField(),
    },
    isA ? { quoteId: projectFields.quoteId, quoteNumber: projectFields.quoteNumber, items: ctx.quote.items, quoteIdOriginal: order.quoteIdOriginal != null ? order.quoteIdOriginal : (order.quoteId || null) } : {},
    { updatedAt: serverTime() });

    return {
      ok: true, revNo: n, ref: ref, from: from, to: to, delta: delta, kind: pr.kind, collected: collected,
      arAfter: arAfter, clientCreditAfter: creditAfter, decision: revision.decision, onBehalf: stamp.onBehalf,
      ledgerEntry: ledgerEntry, projectFields: projectFields, orderPatch: orderPatch, revision: revision,
    };
  }

  // ── §7.4 orchestration ─────────────────────────────────────────────────────────────────────────────────────────
  // deps = { getOrder(id), getProject(id), getChangeOrder?(id), getClaimStatus?(changeOrderId), getQuote?(coll, id),
  //          ledgerPost(entry), updateOrder(id, patch), applyAtomic({orderId, projectId, projectFields, orderPatch}),
  //          afterApply?(result, order, project) [best-effort §7.6], ctx, sanitize?, union, serverTime, deleteField }
  // applyAtomic is the delta === 0 path: ONE db.runTransaction updating job and order together, no ledger row.
  // Any throw before/inside step 2-3 propagates; a retry then runs clean or repairs.
  async function runApply(orderId, deps) {
    // 1. Always fresh reads.
    const order = await deps.getOrder(orderId);
    if (!order) return { ok: false, code: 'not-found' };
    const project = order.projectId ? await deps.getProject(order.projectId) : null;
    const pr = order.pendingRevision;
    const ctx = Object.assign({}, deps.ctx, { sanitize: deps.sanitize, union: deps.union, serverTime: deps.serverTime, deleteField: deps.deleteField });
    if (pr && pr.kind === 'change_order' && pr.changeOrderId && deps.getChangeOrder) {
      const co = await deps.getChangeOrder(pr.changeOrderId);
      if (co) {
        const claimStatus = deps.getClaimStatus ? await deps.getClaimStatus(pr.changeOrderId) : null;
        ctx.changeOrder = { status: co.status, addedDownPayment: co.pricing && co.pricing.addedDownPayment, claimStatus: claimStatus };
      }
    }
    if (pr && pr.kind === 'quote_revision' && pr.quoteId && deps.getQuote) {
      const q = await deps.getQuote(pr.quoteColl, pr.quoteId);
      if (q) ctx.quote = { id: pr.quoteId, number: q.quoteNumber != null ? q.quoteNumber : pr.quoteNumber, items: q.items || [] };
    }
    const plan = planApply(order, project, ctx);
    if (!plan.ok) return plan;
    const summary = { revNo: plan.revNo, delta: plan.delta, from: plan.from, to: plan.to, arAfter: plan.arAfter, clientCreditAfter: plan.clientCreditAfter };
    const finish = async function (code) {
      const result = Object.assign({ ok: true, code: code }, summary);
      if (typeof deps.afterApply === 'function') {
        try { await deps.afterApply(result, order, project); } catch (e) { /* §7.6: a follow-up failure never undoes the apply */ }
      }
      return result;
    };

    // delta === 0: no ledger row; job + order in one transaction.
    if (plan.ledgerEntry === null) {
      await deps.applyAtomic({ orderId: order.id, projectId: order.projectId, projectFields: plan.projectFields, orderPatch: plan.orderPatch });
      return finish('applied');
    }
    // 2. The ledger row and the job update commit together.
    const res = await deps.ledgerPost(Object.assign({}, plan.ledgerEntry, {
      projectSync: { collection: 'job_projects', docId: order.projectId, fields: plan.projectFields },
    }));
    if (!res || typeof res.existed !== 'boolean') throw new Error('The ledger did not say whether the contract change was already posted.');
    // 3a / 3b. Fresh post, or a retry after the order write failed: in both cases the order patch is (re)written;
    // on 3b the job is never touched again.
    await deps.updateOrder(order.id, plan.orderPatch);
    return finish(res.existed === false ? 'applied' : 'repaired');
  }

  // ── §7.7 refund of client credit ───────────────────────────────────────────────────────────────────────────────
  // ctx = { today, nowIso, who, amount, method, acct:{bankAccountId,bankAccountName}, bankTag:{}, union(...), serverTime(), sanitize? }
  // Refuses: invalid-amount (not > 0), no-revision (nothing revised yet, so no R<n> to key on), exceeds-credit.
  // The entry carries its own projectSync: amountCollected falls by the refund, clientCredit is recomputed.
  function planRefund(order, project, ctx) {
    ctx = ctx || {}; order = order || {}; project = project || {};
    const union = ctx.union || function () { return Array.prototype.slice.call(arguments); };
    const serverTime = ctx.serverTime || function () { return null; };
    const amount = r2(ctx.amount);
    const n = num(order.contractRev);
    if (!(amount > 0)) return { ok: false, code: 'invalid-amount' };
    if (!(n > 0)) return { ok: false, code: 'no-revision' };
    const contract = r2(project.contractAmount != null ? num(project.contractAmount) : num(order.contractAmount));
    const collected = r2(num(project.amountCollected));
    const credit = Math.max(0, r2(collected - contract));
    if (amount > credit + 0.005) return { ok: false, code: 'exceeds-credit', credit: credit };
    const soNumber = order.soNumber || ('SO-' + order.id);
    const ref = 'SO-' + order.id + '-R' + n + '-RF';
    const newCollected = r2(collected - amount);
    const creditAfter = Math.max(0, r2(newCollected - contract));
    const who = String(ctx.who || '');
    const ledgerId = typeof ctx.sanitize === 'function' ? ctx.sanitize(ref) : ref;
    const ledgerEntry = {
      ref: ref, date: ctx.today, kind: 'debit', accountType: 'expense',
      account: 'Sales Refunds', category: 'Sales Refunds',
      description: 'Refund — ' + (order.clientName || '') + ' (' + soNumber + ' R' + n + ')',
      amount: amount, source: 'Finance', projectId: order.projectId || null,
      extra: Object.assign({}, ctx.bankTag || {}),
      projectSync: {
        collection: 'job_projects', docId: order.projectId,
        fields: {
          amountCollected: newCollected, clientCredit: creditAfter,
          refunds: union({ amount: amount, date: ctx.today, method: ctx.method || '', ledgerId: ledgerId, by: who }),
          updatedAt: serverTime(),
        },
      },
    };
    return { ok: true, ref: ref, amount: amount, newCollected: newCollected, clientCreditAfter: creditAfter, ledgerEntry: ledgerEntry };
  }

  window.ContractCore = { gate: gate, lastApproved: lastApproved, planApply: planApply, runApply: runApply, planRefund: planRefund };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.ContractCore;
