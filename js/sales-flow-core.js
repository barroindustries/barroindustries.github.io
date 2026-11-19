if (typeof window === 'undefined') globalThis.window = globalThis;
// ═══════════════════════════════════════════════════════════════════════════
//  js/sales-flow-core.js — pure logic for the Sales flow (specs/SALES-QUICK-FIXES-SPEC-2026-11-19.md §4, §14)
//
//  No DOM, no Firestore, no clock, no module imports. Same file contract as js/money-core.js: the line above makes
//  `window` exist under plain Node so tests can require() this file; in the browser it is a no-op. It reads
//  window.vatSplit (money-core.js, FROZEN, never copied here), so it loads AFTER money-core.js and before
//  departments.js — the app-kit order in index.html and the PRECACHE entry in sw.js carry that.
//
//  What lives here, and why it is pure:
//    • Mark sent / Lost: the reason list, its validation and the "may this card show the button" truth tables.
//    • Record payment: validatePayment() — the one place the amount is checked against the contract, so the live
//      summary card in the modal and the confirmation use the SAME numbers (vatSplit).
//    • Order state: orderState() + ORDER_STATE_META — one function decides the badge on the Sales Orders page.
//    • Confirmation: canConfirmPayment() (who may decide), decisionStamp() (who decided, in one shape),
//      planConfirmation() (every number and every written object, as data) and runConfirmation() (the orchestration
//      with INJECTED dependencies, so it is tested with fakes). The ledger row and the project's collected / AR
//      ride ONE Ledger.post transaction keyed on SO-<orderId>, which is why a payment can only ever post once.
//
//  Money rules this file keeps (each has a test, mutation-checked — tests/sales-flow-core.test.mjs):
//    • never closes a job: the plan has no `stage` key at all, however fully the contract is paid;
//    • a repeat or a retry never moves the project's money a second time (see runConfirmation, step 6b);
//    • nobody but the President confirms a payment they recorded themselves.
//  Nothing the app writes for a payment is titled as a BIR receipt or invoice; the project document row is a
//  Payment Acknowledgement. Numbers on those forms are issued by the form engine, not here.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── Lost reasons (§3.4) — exact codes, labels and order ────────────────────────────────────────────────────────
  const LOST_REASONS = Object.freeze([
    Object.freeze({ code: 'price',       label: 'Price' }),
    Object.freeze({ code: 'timing',      label: 'Timing' }),
    Object.freeze({ code: 'competitor',  label: 'Went with a competitor' }),
    Object.freeze({ code: 'no_response', label: 'No response' }),
    Object.freeze({ code: 'cancelled',   label: 'Project cancelled' }),
    Object.freeze({ code: 'budget',      label: 'Budget not approved' }),
    Object.freeze({ code: 'other',       label: 'Other (note required)' }),
  ]);

  const LOST_NOTE_MAX = 300;

  function lostReasonLabel(code) {
    const r = LOST_REASONS.find(function (x) { return x.code === code; });
    return r ? r.label : '';
  }

  // '' when valid. The note is judged trimmed (it is stored trimmed). Unknown code first, then the Other-note rule, then length.
  function validateLost(code, note) {
    if (!lostReasonLabel(code)) return 'Choose a reason.';
    const n = String(note == null ? '' : note).trim();
    if (code === 'other' && !n) return 'Add a note for "Other".';
    if (n.length > LOST_NOTE_MAX) return 'Keep the note under 300 characters.';
    return '';
  }

  // ── Quote helpers (§3.1, §5.1) ─────────────────────────────────────────────────────────────────────────────────
  // Same fallback chain as the quote list (sales.js): some quotes store the value under grandTotal or amount.
  function quoteTotal(q) {
    q = q || {};
    return Number(q.total) || Number(q.grandTotal) || Number(q.amount) || 0;
  }

  // "Sent" is a stamp, not a status: only a filed / approved quote that is not superseded, has no order and was not sent yet.
  function canMarkSent(q, superseded) {
    return !!q && !superseded && !q.salesOrderId && !q.sentAt && ['filed', 'approved'].includes(q.status);
  }
  function canMarkLost(q, superseded) {
    return !!q && !superseded && !q.salesOrderId && ['filed', 'approved', 'accepted', 'sent'].includes(q.status);
  }
  function canReopenLost(q) {
    return !!q && q.status === 'lost' && !q.salesOrderId;
  }

  // ── Record payment (§4, §5.2) ──────────────────────────────────────────────────────────────────────────────────
  // {ok, error, recorded, net, vat}. `recorded` is the cash figure (vatSplit: exclusive adds the 12%), so an amount
  // typed as VAT-exclusive on a VAT-inclusive contract is caught as over-contract. The numbers are returned even
  // when invalid, so the live summary card can show them while the error is showing.
  function validatePayment(a) {
    a = a || {};
    const c = Number(a.contract);
    const e = Number(a.entered);
    const split = window.vatSplit(e > 0 ? e : 0, a.vatTreatment);
    const out = function (error) {
      return { ok: !error, error: error || '', recorded: split.recorded, net: split.net, vat: split.vat };
    };
    if (!(c > 0)) return out('This quote has no total, so a payment cannot be recorded against it.');
    if (!(e > 0)) return out('Enter the amount the client paid.');
    // 50 centavos of slack, compared on the 2-dp figure so a binary-float sum cannot tip an exact contract + 0.50 over.
    if (split.recorded > +(c + 0.5).toFixed(2)) return out('The payment is more than the contract amount.');
    if (!a.hasReceipt) return out('Attach the receipt or proof of payment.');
    return out('');
  }

  // Share of the contract this payment is, 1 dp; null when there is no contract to compare with.
  function dpPercentOf(amount, contract) {
    const c = Number(contract);
    const a = Number(amount) || 0;
    return c > 0 ? +(100 * a / c).toFixed(1) : null;
  }

  // ── Order state (§3.5) — the first matching row wins ───────────────────────────────────────────────────────────
  const ORDER_STATE_META = Object.freeze({
    in_production:         Object.freeze({ cls: 'badge-blue',   label: 'In production' }),
    in_design:             Object.freeze({ cls: 'badge-purple', label: 'In design' }),
    confirmed:             Object.freeze({ cls: 'badge-green',  label: 'Payment confirmed' }),
    rejected:              Object.freeze({ cls: 'badge-red',    label: 'Payment rejected' }),
    awaiting_confirmation: Object.freeze({ cls: 'badge-orange', label: 'Awaiting confirmation' }),
    legacy_pending:        Object.freeze({ cls: 'badge-orange', label: 'pending' }),
  });

  function orderState(o) {
    o = o || {};
    if (o.sentToProduction) return 'in_production';
    if (o.sentToDesign) return 'in_design';
    if (o.status === 'recorded') return 'confirmed';
    if (o.status === 'payment_rejected') return 'rejected';
    if (o.flowVersion === 2) return 'awaiting_confirmation';
    return 'legacy_pending';
  }

  // Sales may fix a payment only while it is unconfirmed (the rules agree: payment fields freeze at 'recorded').
  function salesMayEditPayment(o) {
    return !!o && o.flowVersion === 2 && o.status !== 'recorded';
  }
  // Generate (sales order + job order) needs a confirmed payment and an order nobody has sent on yet.
  function canGenerate(o) {
    return !!o && o.status === 'recorded' && !o.sentToDesign && !o.sentToProduction;
  }
  // Both hand-off helpers (transferOrderToDesign / transferOrderToProduction) ask this before they write anything.
  function transferBlockReason(o) {
    return (o && o.flowVersion === 2 && o.status !== 'recorded') ? 'The payment has not been confirmed yet.' : '';
  }
  function hasHandoffDrawing(o) {
    return !!(o && o.handoffDrawing && o.handoffDrawing.url);
  }

  // ── Who may decide (§14.2.1, owner ruling F2) ──────────────────────────────────────────────────────────────────
  // viewer = { uid, isPresident, isFinanceTier }. The President always may — including his own entry. A finance-tier
  // user (finance role, or Finance department and not the Corporate Secretary) may stand in, but never for a payment
  // they recorded themselves. Anyone else, or a missing order / viewer: no. The same function gates Reject.
  function canConfirmPayment(o, viewer) {
    if (!o || !viewer) return false;
    if (viewer.isPresident) return true;
    if (viewer.isFinanceTier) return !!viewer.uid && o.createdBy !== viewer.uid;
    return false;
  }

  // Who decided, in ONE shape: confirm and reject both spread this, so the two paths cannot drift (§14.2.2).
  function decisionStamp(viewer, who, nowIso) {
    return {
      decidedBy: viewer.uid,
      decidedByName: who,
      decidedByRole: viewer.isPresident ? 'president' : 'finance',
      decidedAt: nowIso,
      onBehalf: !viewer.isPresident,
    };
  }

  // ── Confirmation plan (§4.1) — pure: every number and every written object, as data ───────────────────────────
  // ctx = { today, nowIso, who, whoUid, acct:{bankAccountId,bankAccountName}, bankTag:{}, viewer, sanitize? }
  // Returns { ok:false, code[, error] } or the plan. Refusal order: not-allowed (checked FIRST, so a stale screen
  // cannot post), already-confirmed, not-pending, legacy-order, invalid-payment.
  // The plan never sets `stage`: a fully prepaid job must not be closed before it is built.
  function planConfirmation(o, project, ctx) {
    ctx = ctx || {};
    const viewer = ctx.viewer;
    if (!canConfirmPayment(o, viewer)) return { ok: false, code: 'not-allowed' };
    if (o.status === 'recorded') return { ok: false, code: 'already-confirmed' };
    if (o.status !== 'pending') return { ok: false, code: 'not-pending' };
    if (o.flowVersion !== 2) return { ok: false, code: 'legacy-order' };

    const vatTreatment = o.vatTreatment || 'inclusive';
    const v = validatePayment({ contract: o.contractAmount, entered: o.paymentReceived, vatTreatment: vatTreatment, hasReceipt: true });
    if (!v.ok) return { ok: false, code: 'invalid-payment', error: v.error };

    const r2 = function (n) { return +(+n).toFixed(2); };
    const amount = v.recorded;
    const net = v.net;
    const vatAmount = v.vat;
    const who = String(ctx.who || '');
    const role = viewer.isPresident ? 'president' : 'finance';
    const whoLabel = role === 'president' ? 'the President' : 'Finance (' + who + ')';
    const acct = ctx.acct || {};
    const bankAccountId = acct.bankAccountId || null;
    const bankAccountName = acct.bankAccountName || null;

    const ref = 'SO-' + o.id;
    const ledgerEntry = {
      ref: ref, date: ctx.today, kind: 'credit', accountType: 'income',
      account: 'Sales Revenue', category: 'Sales Revenue',
      description: 'Sales order — ' + (o.clientName || '') + (o.quoteNumber ? ' (' + o.quoteNumber + ')' : ''),
      amount: amount, source: 'Sales', projectId: o.projectId || null,
      extra: Object.assign({ net: net, vatAmount: vatAmount, vatTreatment: vatTreatment, confirmedBy: who, confirmedByRole: role }, ctx.bankTag || {}),
    };

    // The project's collected / AR. Collected adds to what is already there; AR floors at 0 (an over-collection never goes negative).
    const newCollected = r2((project ? Number(project.amountCollected) || 0 : 0) + amount);
    const newAR = Math.max(0, r2((project ? Number(project.contractAmount) || Number(o.contractAmount) || 0 : 0) - newCollected));

    const payment = {
      type: 'Sales Order Payment', amount: amount, vatAmount: vatAmount, net: net,
      method: o.paymentMethod || '', orRef: o.orRef || '',
      receiptUrl: o.receiptUrl || null, date: o.paymentDate || ctx.today, by: who,
      recordedBy: o.createdByName || '',
      ledgerId: typeof ctx.sanitize === 'function' ? ctx.sanitize(ref) : ref,
      bankAccountId: bankAccountId, bankAccountName: bankAccountName,
      confirmedBy: who, confirmedByRole: role,
    };
    // A line in the project's document list, not a generated form. `ref` keeps the number Finance issued, if any; it issues none.
    const document = { type: 'Payment Acknowledgement', ref: o.orRef || ('₱' + amount.toFixed(2)), at: ctx.nowIso, by: who };
    const timelineEvent = { at: ctx.nowIso, event: 'Payment ₱' + amount.toFixed(2) + ' confirmed by ' + whoLabel, by: who };

    const orderPatch = {
      status: 'recorded', recordedAmount: amount, recordedBy: who,
      bankAccountId: bankAccountId, bankAccountName: bankAccountName,
      paymentConfirm: Object.assign({}, o.paymentConfirm, { decision: 'confirmed', reason: '' }, decisionStamp(viewer, who, ctx.nowIso)),
    };

    return {
      ok: true, ref: ref, amount: amount, net: net, vatAmount: vatAmount, vatTreatment: vatTreatment,
      role: role, whoLabel: whoLabel,
      ledgerEntry: ledgerEntry, newCollected: newCollected, newAR: newAR,
      payment: payment, document: document, timelineEvent: timelineEvent, orderPatch: orderPatch,
    };
  }

  // ── Confirmation orchestration (§4.2) — posts exactly once ─────────────────────────────────────────────────────
  // deps = { getOrder(id), getProject(id), ledgerPost(entry), ledgerAmount(ref), updateOrder(id, patch),
  //          syncTracking(token, patch), ctx, sanitize(ref), union(x), serverTime() }
  // Why this is exactly-once: the ledger id is a pure function of the order id; the project's collected / AR ride the
  // SAME transaction as the ledger create; a second call either stops at the plan (already-confirmed) or lands in 6b,
  // which never touches the project. Any throw propagates to the caller, which shows it; a retry then runs clean or repairs.
  async function runConfirmation(orderId, deps) {
    // 1. Always a fresh read, never the list's copy.
    const o = await deps.getOrder(orderId);
    if (!o) return { ok: false, code: 'not-found' };
    // 2.
    const project = o.projectId ? await deps.getProject(o.projectId) : null;
    // 3. Nothing is written when the plan refuses.
    const plan = planConfirmation(o, project, Object.assign({}, deps.ctx, { sanitize: deps.sanitize }));
    if (!plan.ok) return plan;
    // 4. The project's fields go INTO the ledger transaction (one transaction: row + project), not a second write.
    const projectSync = project ? {
      collection: 'job_projects', docId: o.projectId,
      fields: {
        amountCollected: plan.newCollected, arBalance: plan.newAR, updatedAt: deps.serverTime(),
        payments: deps.union(plan.payment), documents: deps.union(plan.document), timeline: deps.union(plan.timelineEvent),
      },
    } : null;
    // 5.
    const res = await deps.ledgerPost(Object.assign({}, plan.ledgerEntry, projectSync ? { projectSync: projectSync } : {}));
    if (!res || typeof res.existed !== 'boolean') throw new Error('The ledger did not say whether the payment was already posted.');
    if (res.existed === false) {
      // 6a. Fresh post: stamp the order, then the client's tracking page.
      await deps.updateOrder(o.id, Object.assign({}, plan.orderPatch, { recordedAt: deps.serverTime() }));
      await deps.syncTracking(o.trackingToken, { paid: plan.newCollected, balance: plan.newAR });
      return { ok: true, code: 'posted', amount: plan.amount };
    }
    // 6b. The row was already there (a retry after 6a failed, or a legacy post): never touch the project again.
    const amt = await deps.ledgerAmount(plan.ref);
    const recordedAmount = amt == null ? plan.orderPatch.recordedAmount : amt;
    await deps.updateOrder(o.id, Object.assign({}, plan.orderPatch, { recordedAmount: recordedAmount, recordedAt: deps.serverTime() }));
    return { ok: true, code: 'repaired', amount: recordedAmount };
  }

  window.SalesFlow = {
    LOST_REASONS: LOST_REASONS,
    lostReasonLabel: lostReasonLabel,
    validateLost: validateLost,
    quoteTotal: quoteTotal,
    canMarkSent: canMarkSent,
    canMarkLost: canMarkLost,
    canReopenLost: canReopenLost,
    validatePayment: validatePayment,
    dpPercentOf: dpPercentOf,
    orderState: orderState,
    ORDER_STATE_META: ORDER_STATE_META,
    salesMayEditPayment: salesMayEditPayment,
    canGenerate: canGenerate,
    transferBlockReason: transferBlockReason,
    canConfirmPayment: canConfirmPayment,
    decisionStamp: decisionStamp,
    hasHandoffDrawing: hasHandoffDrawing,
    planConfirmation: planConfirmation,
    runConfirmation: runConfirmation,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.SalesFlow;
