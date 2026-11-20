if (typeof window === 'undefined') globalThis.window = globalThis;
// ═══════════════════════════════════════════════════════════════════════════
//  js/payment-claims-core.js — P5 "the balance payment" (specs/SALES-FLOW-SPEC-2026-11-19.md §5.5, §5.6, §8). Pure logic.
//
//  No DOM, no Firestore, no clock, no imports. Same file contract as js/sales-flow-core.js. It reads window.vatSplit
//  (money-core.js, frozen) and window.SalesFlow.canConfirmPayment / decisionStamp at CALL time, so it loads AFTER
//  money-core.js and sales-flow-core.js.
//
//  What lives here:
//    • kindLabel / KINDS      — the claim types and their labels.
//    • validateRecord()       — the record form: amount, balance + ₱0.50, proof required.
//    • planFeeCredit()        — §5.6: crediting a paid site-visit fee onto a job (a payments entry, NO ledger row).
//    • planConfirmation()     — §8.3, every number and every written object as data (mirrors QF §4.1).
//    • runConfirmation()      — §8.3, the orchestration with INJECTED dependencies (mirrors QF §4.2).
//
//  Money rules kept here (each has a test, mutation-checked in tests/payment-claims-core.test.mjs):
//    • exactly once: ledger ref is PAY-<claim.id>; the job's collected / AR ride the SAME ledger transaction; a repeat
//      stops at the plan, a retry after the claim patch failed lands in the repair branch which never re-sends job fields;
//    • collected ADDS to the fresh job's figure; the amount is checked against the FRESH balance (not for site-visit);
//    • never closes a job: no `stage` key in the plan;
//    • a credited site-visit fee is a payments entry only — the money is already in the books under its own PAY- row.
//  paNumber is supplied by the caller (Forms.nextNumber('PA') before the post); this file allocates no numbers.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const r2 = function (n) { return +(+n).toFixed(2); };
  const num = function (n) { return Number(n) || 0; };
  const sf = function () { return window.SalesFlow; };

  const KINDS = Object.freeze({
    balance:      'Balance',
    progress:     'Progress payment',
    change_order: 'Change-order down payment',
    site_visit:   'Site-visit fee',
  });
  function kindLabel(kind) { return Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : ''; }
  const isFee = function (claim) { return !!claim && claim.kind === 'site_visit'; };

  // Sum of the site-visit fees not yet credited onto this job. fees = [{id, recordedAmount}]; a fee is credited when the
  // project's payments[] already holds an entry with its claimId.
  function uncredited(project, fees) {
    const done = {};
    ((project && project.payments) || []).forEach(function (p) { if (p && p.claimId) done[p.claimId] = true; });
    const seen = {};
    return (fees || []).filter(function (f) {
      if (!f || !f.id || done[f.id] || seen[f.id] || !(num(f.recordedAmount) > 0)) return false;
      seen[f.id] = true; return true;
    });
  }

  // Balance due the record form shows and the confirmation enforces: the job's AR less fees the client already paid
  // that are not credited yet (§5.6), never below 0.
  function balanceDue(project, fees) {
    if (!project) return 0;
    const ar = project.arBalance != null && project.arBalance !== ''
      ? num(project.arBalance)
      : Math.max(0, r2(num(project.contractAmount) - num(project.amountCollected)));
    const f = uncredited(project, fees).reduce(function (s, x) { return s + num(x.recordedAmount); }, 0);
    return Math.max(0, r2(ar - f));
  }

  // ── record form (§8.1, P-1) ────────────────────────────────────────────────────────────────────────────────────
  // a = { kind, entered, vatTreatment, hasReceipt, project, fees? } → { ok, error, recorded, net, vat, balanceDue }.
  // "No more than the balance due (+₱0.50)" is not applied to a site-visit fee. Numbers are returned even when invalid.
  function validateRecord(a) {
    a = a || {};
    const e = num(a.entered);
    const split = window.vatSplit(e > 0 ? e : 0, a.vatTreatment || 'inclusive');
    const due = isFee(a) ? null : balanceDue(a.project, a.fees);
    const out = function (error) {
      return { ok: !error, error: error || '', recorded: split.recorded, net: split.net, vat: split.vat, balanceDue: due };
    };
    if (!kindLabel(a.kind)) return out('Choose what this payment is for.');
    if (!(e > 0)) return out('Enter the amount the client paid.');
    if (!isFee(a)) {
      if (!a.project) return out('This job could not be found.');
      if (split.recorded > +(due + 0.5).toFixed(2)) return out('The payment is more than the balance due.');
    }
    if (!a.hasReceipt) return out('Attach the receipt or proof of payment.');
    return out('');
  }

  // ── §5.6 fee credit — pure ─────────────────────────────────────────────────────────────────────────────────────
  // fees = [{id, recordedAmount}] (recorded site-visit claims of this job's lead). Returns the payments[] entries to add
  // and their total. There is NO ledger entry here by design: the money is already in the books under PAY-<claimId>.
  // ctx = { today, who, sanitize? }
  function planFeeCredit(project, fees, ctx) {
    ctx = ctx || {};
    const list = uncredited(project, fees);
    const entries = list.map(function (f) {
      const ref = 'PAY-' + f.id;
      return {
        type: 'Site-visit fee (credited)', amount: r2(f.recordedAmount), claimId: f.id,
        ledgerId: typeof ctx.sanitize === 'function' ? ctx.sanitize(ref) : ref,
        date: ctx.today, by: String(ctx.who || ''),
      };
    });
    return { entries: entries, total: r2(entries.reduce(function (s, x) { return s + x.amount; }, 0)) };
  }

  // ── §8.3 plan — pure ───────────────────────────────────────────────────────────────────────────────────────────
  // ctx = { today, nowIso, who, viewer, paNumber, acct:{bankAccountId,bankAccountName}, bankTag:{}, sanitize?, fees? }
  // Returns { ok:false, code[, error] } or the plan. Refusal order: not-allowed (FIRST, so a stale screen cannot post),
  // already-confirmed, not-pending, invalid-kind, invalid-amount, missing-pa-number, no-project, over-balance.
  function planConfirmation(claim, project, ctx) {
    ctx = ctx || {};
    const viewer = ctx.viewer;
    if (!claim || !sf().canConfirmPayment(claim, viewer)) return { ok: false, code: 'not-allowed' };
    if (claim.status === 'recorded') return { ok: false, code: 'already-confirmed' };
    if (claim.status !== 'pending') return { ok: false, code: 'not-pending' };
    if (!kindLabel(claim.kind)) return { ok: false, code: 'invalid-kind' };

    const fee = isFee(claim);
    const vatTreatment = claim.vatTreatment || 'inclusive';
    const split = window.vatSplit(num(claim.paymentReceived) > 0 ? num(claim.paymentReceived) : 0, vatTreatment);
    if (!(split.recorded > 0)) return { ok: false, code: 'invalid-amount' };
    if (!ctx.paNumber) return { ok: false, code: 'missing-pa-number' };
    if (!fee && !project && !ctx.repair) return { ok: false, code: 'no-project' };

    const amount = split.recorded;
    const net = split.net;
    const vatAmount = split.vat;

    // §5.6: fees paid earlier and not yet credited come off the balance, and are credited by this payment.
    // ctx.repair (the row is already in the ledger): the balance guard is skipped, because the first post already moved the
    // job's balance and would otherwise refuse its own retry. Nothing is posted in that case; only the claim is patched.
    const credit = fee || !project ? { entries: [], total: 0 } : planFeeCredit(project, ctx.fees, ctx);
    if (!fee && !ctx.repair) {
      const due = balanceDue(project, ctx.fees);
      if (amount > +(due + 0.5).toFixed(2)) return { ok: false, code: 'over-balance', balanceDue: due };
    }

    const who = String(ctx.who || '');
    const role = viewer.isPresident ? 'president' : 'finance';
    const whoLabel = role === 'president' ? 'the President' : 'Finance (' + who + ')';
    const acct = ctx.acct || {};
    const bankAccountId = acct.bankAccountId || null;
    const bankAccountName = acct.bankAccountName || null;
    const typeLabel = kindLabel(claim.kind);
    const projectNo = (project && (project.projectNo || project.joNumber)) || '';
    const ref = 'PAY-' + claim.id;
    const category = fee ? 'Site Visit Fee' : 'Sales Revenue';

    const ledgerEntry = {
      ref: ref, date: ctx.today, kind: 'credit', accountType: 'income',
      account: 'Sales Revenue', category: category,
      description: 'Project ' + projectNo + ' — ' + (claim.clientName || '') + ' (' + typeLabel + ')',
      amount: amount, source: 'Sales', projectId: claim.projectId || null,
      extra: Object.assign({ net: net, vatAmount: vatAmount, vatTreatment: vatTreatment, confirmedBy: who }, ctx.bankTag || {}),
    };

    let newCollected = null, newAR = null, payment = null, document = null, timelineEvent = null;
    if (!fee && project) {
      newCollected = r2(num(project.amountCollected) + credit.total + amount);
      newAR = Math.max(0, r2(num(project.contractAmount) - newCollected));
      payment = {
        type: typeLabel, amount: amount, vatAmount: vatAmount, net: net,
        method: claim.paymentMethod || '', orRef: claim.orRef || '',
        receiptUrl: claim.receiptUrl || null, date: claim.paymentDate || ctx.today, by: who,
        recordedBy: claim.createdByName || '',
        ledgerId: typeof ctx.sanitize === 'function' ? ctx.sanitize(ref) : ref, claimId: claim.id,
        bankAccountId: bankAccountId, bankAccountName: bankAccountName,
      };
      document = { type: 'Payment Acknowledgement', ref: ctx.paNumber, at: ctx.nowIso, by: who };
      timelineEvent = { at: ctx.nowIso, event: typeLabel + ' ₱' + amount.toFixed(2) + ' confirmed by ' + whoLabel, by: who };
    }

    const claimPatch = {
      status: 'recorded', recordedAmount: amount, recordedBy: who, paNumber: ctx.paNumber,
      bankAccountId: bankAccountId, bankAccountName: bankAccountName,
      paymentConfirm: Object.assign({}, claim.paymentConfirm, { decision: 'confirmed', reason: '' }, sf().decisionStamp(viewer, who, ctx.nowIso)),
    };

    return {
      ok: true, ref: ref, amount: amount, net: net, vatAmount: vatAmount, vatTreatment: vatTreatment,
      role: role, whoLabel: whoLabel, isSiteVisit: fee, typeLabel: typeLabel,
      ledgerEntry: ledgerEntry, newCollected: newCollected, newAR: newAR,
      payment: payment, feeCredits: credit.entries, document: document, timelineEvent: timelineEvent, claimPatch: claimPatch,
    };
  }

  // ── §8.3 orchestration — posts exactly once ────────────────────────────────────────────────────────────────────
  // deps = { getClaim(id), getProject(id), getUncreditedFees?(claim, project), ledgerPost(entry), ledgerAmount(ref),
  //          updateClaim(id, patch), afterPost?(claim, plan), ctx, sanitize(ref), union(x), serverTime() }
  // Same exactly-once argument as SalesFlow.runConfirmation: the ledger id is a pure function of the claim id, the job's
  // figures ride the same transaction as the ledger create, and a second call stops at the plan or lands in 6b, which
  // never touches the job. A throw propagates; a retry then runs clean or repairs.
  async function runConfirmation(claimId, deps) {
    // 1. Always a fresh read, never the list's copy.
    const claim = await deps.getClaim(claimId);
    if (!claim) return { ok: false, code: 'not-found' };
    // 2. The FRESH job: the amount guard reads its current balance (a contract change may have moved it).
    const project = !isFee(claim) && claim.projectId ? await deps.getProject(claim.projectId) : null;
    const fees = project && deps.getUncreditedFees ? await deps.getUncreditedFees(claim, project) : (deps.ctx && deps.ctx.fees);
    // 2b. Is the ledger row already there (a retry after the claim patch failed)? Then this is a repair: the amount
    // guard must not judge a balance the first post already reduced.
    const already = await deps.ledgerAmount('PAY-' + claim.id);
    const repair = already != null;
    // 3. Nothing is written when the plan refuses.
    const plan = planConfirmation(claim, project, Object.assign({}, deps.ctx, { sanitize: deps.sanitize, fees: fees, repair: repair }));
    if (!plan.ok) return plan;
    if (repair) {
      // 6b. Patch the claim only; never post and never touch the job again.
      await deps.updateClaim(claim.id, Object.assign({}, plan.claimPatch, { recordedAmount: already, recordedAt: deps.serverTime() }));
      return { ok: true, code: 'repaired', amount: already, paNumber: plan.claimPatch.paNumber };
    }
    // 4. The job's fields go INTO the ledger transaction (row + job), not a second write. None for a site-visit fee.
    const projectSync = plan.isSiteVisit || !plan.payment ? null : {
      collection: 'job_projects', docId: claim.projectId,
      fields: {
        amountCollected: plan.newCollected, arBalance: plan.newAR, updatedAt: deps.serverTime(),
        payments: deps.union.apply(null, plan.feeCredits.concat([plan.payment])),
        documents: deps.union(plan.document), timeline: deps.union(plan.timelineEvent),
      },
    };
    // 5.
    const res = await deps.ledgerPost(Object.assign({}, plan.ledgerEntry, projectSync ? { projectSync: projectSync } : {}));
    if (!res || typeof res.existed !== 'boolean') throw new Error('The ledger did not say whether the payment was already posted.');
    if (res.existed === false) {
      // 6a. Fresh post: stamp the claim.
      await deps.updateClaim(claim.id, Object.assign({}, plan.claimPatch, { recordedAt: deps.serverTime() }));
      if (typeof deps.afterPost === 'function') { try { await deps.afterPost(claim, plan); } catch (e) { /* best effort */ } }
      return { ok: true, code: 'posted', amount: plan.amount, paNumber: plan.claimPatch.paNumber };
    }
    // 6b'. The row appeared between the check and the post (a concurrent confirm): patch the claim only, never touch the job.
    const amt = await deps.ledgerAmount(plan.ref);
    const recordedAmount = amt == null ? plan.claimPatch.recordedAmount : amt;
    await deps.updateClaim(claim.id, Object.assign({}, plan.claimPatch, { recordedAmount: recordedAmount, recordedAt: deps.serverTime() }));
    return { ok: true, code: 'repaired', amount: recordedAmount, paNumber: plan.claimPatch.paNumber };
  }

  window.PaymentClaims = {
    KINDS: KINDS,
    kindLabel: kindLabel,
    balanceDue: balanceDue,
    validateRecord: validateRecord,
    planFeeCredit: planFeeCredit,
    planConfirmation: planConfirmation,
    runConfirmation: runConfirmation,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = window.PaymentClaims;
