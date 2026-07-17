'use strict';
// v13 Phase 35 — Approvals service.
// One write path per approval type. renderApprovals (departments.js) used to
// duplicate the signup / payroll-delete / finance-delete / leave write logic
// byte-for-byte between the aggregated "All Requests" view and each dedicated
// subtab. This module is the single source of truth for those writes; both
// call sites now call Approvals.dispatch(type, action, id, ctx) instead.
//
// Types that already had a shared service (CashAdvance, RaiseFlow,
// approvePurchaseOrder/rejectPurchaseOrder, approveQuoteApproval/
// returnQuoteToPartner, the quote/client delete-request handlers) get thin
// registry entries here too, purely so Approvals.dispatch(type, action, id)
// is a uniform entry point for every approval type — their write logic was
// NOT duplicated before this change and is not modified by this refactor.
(function () {

  // ── Signup approval (Phase 15 atomic employeeId + Phase 28 no-plaintext-
  // password-at-rest flow: the generated password is written to
  // signup_requests only, which is not the account itself). Extracted verbatim
  // from the "signups" subtab (departments.js, .signup-approve handler), which
  // was the fuller of the two identical sites (it also drove the
  // Firebase-Console-instructions modal — that UI stays in departments.js;
  // this function is just the write path).
  async function signupApprove(id, ctx) {
    const { name, email, phone, currentUser } = ctx;
    const reqRef = db.collection('signup_requests').doc(id);
    // Retry-safety: the old flow created the user doc FIRST and flipped the
    // request 'approved' LAST — a failure in between left the request pending
    // with a real account (and employeeId) already minted, so the admin's
    // retry created a SECOND account for the same person. Resume from the
    // stored uid instead, and commit user-create + request-approve atomically.
    const prior = await reqRef.get().catch(() => null);
    const priorData = (prior && prior.exists) ? prior.data() : {};
    if (priorData.createdUid) {
      return { password: priorData.generatedPassword, empId: priorData.createdEmpId, already: true };
    }
    const pwd = generatePassword(name);
    const empId = await nextCounterId('employees',
      async () => (await db.collection('users').get().catch(() => ({ size: 0 }))).size,
      n => `BI-${window.bizYear ? window.bizYear() : new Date().getFullYear()}-${String(n).padStart(3, '0')}`);
    const newStartDate = today();
    const newUserRef = db.collection('users').doc();
    const batch = db.batch();
    batch.set(newUserRef, {
      displayName: name, email, phone,
      role: 'employee', departments: [],
      employeeId: empId,
      photoUrl: '', startDate: newStartDate,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      pendingPasswordSetup: true
    });
    batch.update(reqRef, {
      status: 'approved',
      generatedPassword: pwd,
      createdUid: newUserRef.id,
      createdEmpId: empId,
      approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
      approvedBy: currentUser.uid
    });
    await batch.commit();
    // After the atomic pair: a failed accrual no longer strands the request —
    // the account exists and is resolvable; surface it for a manual grant.
    await window.LeaveAccrual.grantForYear(newUserRef.id, { startDate: newStartDate }).catch(e => {
      Notifs.showToast('Account created, but leave accrual failed: ' + (e && e.message || e) + ' — re-grant from HR.', 'error');
    });
    return { password: pwd, empId };
  }
  async function signupReject(id, ctx) {
    await db.collection('signup_requests').doc(id).update({
      status: 'rejected', rejectedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  // ── Payroll delete request (type 'finance-req' in the approvals feed). ──
  async function payrollDeleteApprove(id, ctx) {
    const { currentUser, histId, name, month, reqBy } = ctx;
    // Guard against a stale click / second President session re-running an
    // already-resolved request.
    const _req = await db.collection('payroll_delete_requests').doc(id).get().catch(() => null);
    if (_req && _req.exists && _req.data().status !== 'pending') return { already: true };
    if (histId) {
      // Cascade removes the PAY- ledger debit and restores deducted cash advances.
      await window.financeExecuteDelete('salary_history', histId);
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
    }
    await db.collection('payroll_delete_requests').doc(id).update({
      status: 'approved', resolvedBy: currentUser.uid, resolvedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (reqBy) await safeNotify(() => Notifs.send(reqBy, {
      title: '✅ Payroll Delete Approved',
      body: `Your request to delete ${name}'s ${month} payroll record has been approved.`,
      icon: '✅', type: 'payroll_delete_approved'
    }));
    return { already: false };
  }
  async function payrollDeleteDeny(id, ctx) {
    const { currentUser, name, month, reqBy } = ctx;
    await db.collection('payroll_delete_requests').doc(id).update({
      status: 'denied', resolvedBy: currentUser.uid, resolvedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (reqBy) await safeNotify(() => Notifs.send(reqBy, {
      title: '❌ Payroll Delete Denied',
      body: `Your request to delete ${name}'s ${month} payroll record was denied by the President.`,
      icon: '❌', type: 'payroll_delete_denied'
    }));
  }

  // ── Generic finance delete request (type 'finance-del'). ──
  async function financeDeleteApprove(id, ctx) {
    const { currentUser, coll, docId, label, reqBy } = ctx;
    // Guard: a stale click or a second President session must not re-run an
    // already-resolved request (would double-apply a payslip's CA reversal).
    const reqSnap = await db.collection('finance_delete_requests').doc(id).get().catch(() => null);
    if (reqSnap && reqSnap.exists && reqSnap.data().status !== 'pending') return { already: true };
    if (coll && docId) await window.financeExecuteDelete(coll, docId);
    await db.collection('finance_delete_requests').doc(id).update({
      status: 'approved', resolvedBy: currentUser.uid, resolvedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (reqBy) await safeNotify(() => Notifs.send(reqBy, {
      title: '✅ Delete Approved', body: `Your request to delete ${label} was approved.`,
      icon: '✅', type: 'finance_delete_approved'
    }));
    return { already: false };
  }
  async function financeDeleteDeny(id, ctx) {
    const { currentUser, label, reqBy } = ctx;
    await db.collection('finance_delete_requests').doc(id).update({
      status: 'denied', resolvedBy: currentUser.uid, resolvedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (reqBy) await safeNotify(() => Notifs.send(reqBy, {
      title: '❌ Delete Denied', body: `Your request to delete ${label} was denied by the President.`,
      icon: '❌', type: 'finance_delete_denied'
    }));
  }

  // ── Leave — delegates to the existing shared helpers (modules.js) so leave
  // balances stay consistent with the Leave Management screen. Only the
  // call-site wiring was duplicated, not the write itself.
  async function leaveApprove(id) { return window.approveLeaveRequest(id); }
  async function leaveReject(id, ctx) { return window.rejectLeaveRequest(id, (ctx && ctx.reason) || ''); }

  // ── Thin registry entries for types with pre-existing shared services. ──
  // Not duplicated before this refactor; wrapped here only for a uniform
  // dispatch(type, action, id) surface.
  async function caReject(id) { return window.CashAdvance.reject(id); }
  async function raiseApprove(id) { return window.RaiseFlow.approve(id); }
  async function raiseReject(id, ctx) { return window.RaiseFlow.reject(id, (ctx && ctx.reason) || ''); }
  async function poApprove(id) { return window.approvePurchaseOrder(id); }
  async function poReject(id, ctx) { return window.rejectPurchaseOrder(id, (ctx && ctx.reason) || ''); }
  async function quoteApprove(id, ctx) {
    return approveQuoteApproval(ctx.quoteId, ctx.agentId, ctx.quoteNumber, ctx.clientName, ctx.quoteColl);
  }
  async function quoteReturn(id, ctx) {
    return returnQuoteToPartner(ctx.quoteId, ctx.agentId, ctx.quoteNumber, ctx.clientName, ctx.notes || '', ctx.quoteColl);
  }
  async function deleteQuoteApprove(id, ctx) {
    const coll = ctx.coll || 'bs_quotes';
    await db.collection(coll).doc(id).delete();
    window.logAudit && window.logAudit('delete', 'quote', id, { quoteNo: ctx.qno, coll, viaApproval: true });
    if (ctx.by) await safeNotify(() => Notifs.send(ctx.by, {
      title: '🗑 Quote Deletion Approved', body: `Your request to delete quote ${ctx.qno} was approved.`,
      icon: '✅', type: 'delete_approved'
    }));
  }
  async function deleteQuoteDeny(id, ctx) {
    const coll = ctx.coll || 'bs_quotes';
    await db.collection(coll).doc(id).update({
      deleteRequested: firebase.firestore.FieldValue.delete(), deleteReason: firebase.firestore.FieldValue.delete()
    });
    if (ctx.by) await safeNotify(() => Notifs.send(ctx.by, {
      title: 'Quote Deletion Denied', body: `Your request to delete quote ${ctx.qno} was denied.`,
      icon: '❌', type: 'delete_denied'
    }));
  }
  async function deleteClientApprove(id, ctx) {
    await db.collection('clients').doc(id).delete();
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('clients');
    window.logAudit && window.logAudit('delete', 'client', id, { name: ctx.name, viaApproval: true });
    if (ctx.by) await safeNotify(() => Notifs.send(ctx.by, {
      title: '🗑 Client Deletion Approved', body: `Your request to delete client "${ctx.name}" was approved.`,
      icon: '✅', type: 'delete_approved'
    }));
  }
  async function deleteClientDeny(id, ctx) {
    await db.collection('clients').doc(id).update({
      deleteRequested: firebase.firestore.FieldValue.delete(), deleteReason: firebase.firestore.FieldValue.delete()
    });
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('clients');
    if (ctx.by) await safeNotify(() => Notifs.send(ctx.by, {
      title: 'Client Deletion Denied', body: `Your request to delete client "${ctx.name}" was denied.`,
      icon: '❌', type: 'delete_denied'
    }));
  }

  const REGISTRY = {
    signup:           { approve: signupApprove,        reject: signupReject },
    'finance-req':     { approve: payrollDeleteApprove,  deny: payrollDeleteDeny },
    'finance-del':     { approve: financeDeleteApprove,  deny: financeDeleteDeny },
    leave:            { approve: leaveApprove,         reject: leaveReject },
    // ca approve is modal-driven (CashAdvance.openApproveModal(id, onDone)) — callers
    // keep calling that directly for the modal open; only reject is a plain write.
    ca:               { reject: caReject },
    raise:            { approve: raiseApprove,          reject: raiseReject },
    'po-approval':     { approve: poApprove,             reject: poReject },
    'quote-approval':  { approve: quoteApprove,          return: quoteReturn },
    'delete-quote':    { approve: deleteQuoteApprove,    deny: deleteQuoteDeny },
    'delete-client':   { approve: deleteClientApprove,   deny: deleteClientDeny },
  };

  window.Approvals = {
    /**
     * Approvals.dispatch(type, action, id, ctx) — the single write path for a
     * given approval-request type + action. Throws if no handler is
     * registered so a missing wire-up fails loudly instead of doing nothing.
     */
    async dispatch(type, action, id, ctx) {
      const entry = REGISTRY[type];
      if (!entry || !entry[action]) {
        throw new Error(`Approvals.dispatch: no handler for type="${type}" action="${action}"`);
      }
      return entry[action](id, ctx || {});
    },
    _REGISTRY: REGISTRY // exposed for tests / introspection only
  };
})();
