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
  // Compare-and-set a status: re-reads `ref` inside a transaction and applies
  // `patch` only when its current status is still `from`. Returns true when it
  // applied, false when someone else already moved it (stale tab, double click,
  // second approver) so callers can say "Already handled" instead of blindly
  // overwriting a decision.
  async function transitionStatus(ref, from, patch) {
    return db.runTransaction(async t => {
      const s = await t.get(ref);
      if (!s.exists || (s.data() || {}).status !== from) return false;
      t.update(ref, patch);
      return true;
    });
  }
  window.transitionStatus = transitionStatus;

  async function signupApprove(id, ctx) {
    const { name, email, phone, currentUser } = ctx;
    const reqRef = db.collection('signup_requests').doc(id);
    // Retry-safety: the old flow created the user doc FIRST and flipped the
    // request 'approved' LAST — a failure in between left the request pending
    // with a real account (and employeeId) already minted, so the admin's
    // retry created a SECOND account for the same person. Resume from the
    // stored uid instead, and commit user-create + request-approve atomically.
    // Transactional claim: a double-click (or two admins) used to both pass the
    // createdUid check below before either committed, minting two users docs.
    // Only the call that flips approving:false->true proceeds; the other gets
    // the same {already:true} shape a finished request returns.
    const claim = await db.runTransaction(async t => {
      const s = await t.get(reqRef);
      const d = s.exists ? (s.data() || {}) : {};
      if (d.createdUid) return { already: d };
      if (!s.exists || d.status !== 'pending' || d.approving) return { already: d };
      t.update(reqRef, { approving: true });
      return { already: null };
    });
    if (claim.already) {
      return { password: claim.already.generatedPassword, empId: claim.already.createdEmpId, already: true };
    }
    try {
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
      // PERF-WAVE1 WP6 — the signups count/list on the Approvals page is now
      // cached (dbCachedGet, 'approvals-pending:signup_requests-pending', 30s);
      // this is the single write path (Approvals.dispatch('signup','approve')),
      // so invalidating here covers every caller.
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:signup_requests-pending');
      // After the atomic pair: a failed accrual no longer strands the request —
      // the account exists and is resolvable; surface it for a manual grant.
      await window.LeaveAccrual.grantForYear(newUserRef.id, { startDate: newStartDate }).catch(e => {
        Notifs.showToast('Account created, but leave accrual failed: ' + (e && e.message || e) + ' — re-grant from HR.', 'error');
      });
      return { password: pwd, empId };
    } catch (e) {
      // Release the claim so the admin can retry (nothing was committed).
      await reqRef.update({ approving: false }).catch(() => {});
      throw e;
    }
  }
  async function signupReject(id, ctx) {
    const ok = await transitionStatus(db.collection('signup_requests').doc(id), 'pending', {
      status: 'rejected', rejectedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:signup_requests-pending');
    return { already: !ok };
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
    // PERF-WAVE1 WP6 — 'approvals-pending:payroll_delete_requests-pending' (30s cache).
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:payroll_delete_requests-pending');
    if (reqBy) await safeNotify(() => Notifs.send(reqBy, {
      title: '✅ Payroll Delete Approved',
      body: `Your request to delete ${name}'s ${month} payroll record has been approved.`,
      icon: '✅', type: 'payroll_delete_approved', link: 'approvals'
    }));
    return { already: false };
  }
  async function payrollDeleteDeny(id, ctx) {
    const { currentUser, name, month, reqBy } = ctx;
    const ok = await transitionStatus(db.collection('payroll_delete_requests').doc(id), 'pending', {
      status: 'denied', resolvedBy: currentUser.uid, resolvedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (!ok) return { already: true };
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:payroll_delete_requests-pending');
    if (reqBy) await safeNotify(() => Notifs.send(reqBy, {
      title: '❌ Payroll Delete Denied',
      body: `Your request to delete ${name}'s ${month} payroll record was denied by the President.`,
      icon: '❌', type: 'payroll_delete_denied', link: 'approvals'
    }));
    return { already: false };
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
    // PERF-WAVE1 WP6 — 'approvals-pending:finance_delete_requests-pending' (30s cache).
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:finance_delete_requests-pending');
    if (reqBy) await safeNotify(() => Notifs.send(reqBy, {
      title: '✅ Delete Approved', body: `Your request to delete ${label} was approved.`,
      icon: '✅', type: 'finance_delete_approved', link: 'approvals'
    }));
    return { already: false };
  }
  async function financeDeleteDeny(id, ctx) {
    const { currentUser, label, reqBy } = ctx;
    const ok = await transitionStatus(db.collection('finance_delete_requests').doc(id), 'pending', {
      status: 'denied', resolvedBy: currentUser.uid, resolvedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (!ok) return { already: true };
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:finance_delete_requests-pending');
    if (reqBy) await safeNotify(() => Notifs.send(reqBy, {
      title: '❌ Delete Denied', body: `Your request to delete ${label} was denied by the President.`,
      icon: '❌', type: 'finance_delete_denied', link: 'approvals'
    }));
    return { already: false };
  }

  // ── Leave — delegates to the existing shared helpers (modules.js) so leave
  // balances stay consistent with the Leave Management screen. Only the
  // call-site wiring was duplicated, not the write itself.
  // PERF-WAVE1 WP6 — leaveApprove/leaveReject/caReject/raiseApprove/
  // raiseReject/poApprove/poReject delegate their actual write to a function
  // defined OUTSIDE this file (people.js / config.js / departments.js /
  // production.js — none owned by this work package), so the matching
  // 'approvals-pending:*' cache key is invalidated HERE, right after the
  // delegated call resolves, rather than inside the external function.
  async function leaveApprove(id) {
    const r = await window.approveLeaveRequest(id);
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:leave_requests-pending');
    return r;
  }
  async function leaveReject(id, ctx) {
    const r = await window.rejectLeaveRequest(id, (ctx && ctx.reason) || '');
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:leave_requests-pending');
    return r;
  }

  // ── Thin registry entries for types with pre-existing shared services. ──
  // Not duplicated before this refactor; wrapped here only for a uniform
  // dispatch(type, action, id) surface.
  async function caReject(id) {
    const r = await window.CashAdvance.reject(id);
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:cash_advances-pending');
    return r;
  }
  async function raiseApprove(id) {
    const r = await window.RaiseFlow.approve(id);
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:pending_raises-pending');
    return r;
  }
  async function raiseReject(id, ctx) {
    const r = await window.RaiseFlow.reject(id, (ctx && ctx.reason) || '');
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:pending_raises-pending');
    return r;
  }
  async function poApprove(id) {
    const r = await window.approvePurchaseOrder(id);
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:purchase_requisitions-pending');
    return r;
  }
  async function poReject(id, ctx) {
    const r = await window.rejectPurchaseOrder(id, (ctx && ctx.reason) || '');
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:purchase_requisitions-pending');
    return r;
  }
  async function quoteApprove(id, ctx) {
    return approveQuoteApproval(ctx.quoteId, ctx.agentId, ctx.quoteNumber, ctx.clientName, ctx.quoteColl);
  }
  async function quoteReturn(id, ctx) {
    return returnQuoteToPartner(ctx.quoteId, ctx.agentId, ctx.quoteNumber, ctx.clientName, ctx.notes || '', ctx.quoteColl);
  }
  async function deleteQuoteApprove(id, ctx) {
    const coll = ctx.coll || 'bs_quotes';
    await db.collection(coll).doc(id).delete();
    // PERF-WAVE1 WP6 — coll-aware: bs_quotes and bk_quotes cache separately.
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:' + (coll === 'bk_quotes' ? 'bk_quotes-delete' : 'bs_quotes-delete'));
    window.logAudit && window.logAudit('delete', 'quote', id, { quoteNo: ctx.qno, coll, viaApproval: true });
    if (ctx.by) await safeNotify(() => Notifs.send(ctx.by, {
      title: '🗑 Quote Deletion Approved', body: `Your request to delete quote ${ctx.qno} was approved.`,
      icon: '✅', type: 'delete_approved', link: 'approvals'
    }));
  }
  async function deleteQuoteDeny(id, ctx) {
    const coll = ctx.coll || 'bs_quotes';
    await db.collection(coll).doc(id).update({
      deleteRequested: firebase.firestore.FieldValue.delete(), deleteReason: firebase.firestore.FieldValue.delete()
    });
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:' + (coll === 'bk_quotes' ? 'bk_quotes-delete' : 'bs_quotes-delete'));
    if (ctx.by) await safeNotify(() => Notifs.send(ctx.by, {
      title: 'Quote Deletion Denied', body: `Your request to delete quote ${ctx.qno} was denied.`,
      icon: '❌', type: 'delete_denied', link: 'approvals'
    }));
  }
  async function deleteClientApprove(id, ctx) {
    await db.collection('clients').doc(id).delete();
    if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('clients'); dbCacheInvalidate('approvals-pending:clients-delete'); }
    window.logAudit && window.logAudit('delete', 'client', id, { name: ctx.name, viaApproval: true });
    if (ctx.by) await safeNotify(() => Notifs.send(ctx.by, {
      title: '🗑 Client Deletion Approved', body: `Your request to delete client "${ctx.name}" was approved.`,
      icon: '✅', type: 'delete_approved', link: 'approvals'
    }));
  }
  async function deleteClientDeny(id, ctx) {
    await db.collection('clients').doc(id).update({
      deleteRequested: firebase.firestore.FieldValue.delete(), deleteReason: firebase.firestore.FieldValue.delete()
    });
    if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('clients'); dbCacheInvalidate('approvals-pending:clients-delete'); }
    if (ctx.by) await safeNotify(() => Notifs.send(ctx.by, {
      title: 'Client Deletion Denied', body: `Your request to delete client "${ctx.name}" was denied.`,
      icon: '❌', type: 'delete_denied', link: 'approvals'
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

// ── Quote approval thread (QUOTE-APPROVAL-LINK-SPEC-2026-11-20 §3) ──────────────────────────────────────────────
// One document per entry in the TOP-LEVEL collection `quote_comments` (firestore.rules block of the same name), keyed by the revision chain:
// threadKey = <coll>_<rootQuoteId>. A resubmission after a return creates a NEW quote doc (the builder bridge always `add`s on QUOTE_APPROVAL_REQUESTED),
// so a subcollection of the quote would strand the thread on the old revision; the chain's root id is the same on every revision. Entries are
// written by the review page (kind 'comment'), by decideQuoteApproval (js/screens/approvals.js: 'approved' / 'returned') and by the builder bridge
// (js/app.js: 'submitted'). Reads are get()s, sorted here (no composite index: D8). Nothing here ever throws into a caller.
window.QuoteThread = {
  keyOf(coll, q, id) { return coll + '_' + ((q && q.rootQuoteId) || id); },
  // PURE. o = { coll, quoteId, q, kind, text, uid, name, role } -> the eleven data keys of a thread entry (createdAt is the writer's server timestamp).
  entry(o) {
    o = (o && typeof o === 'object') ? o : {};
    const q = (o.q && typeof o.q === 'object') ? o.q : {};
    const quoteId = String(o.quoteId == null ? '' : o.quoteId);
    const KINDS = ['comment', 'returned', 'approved', 'submitted'];
    return {
      threadKey: window.QuoteThread.keyOf(o.coll, q, quoteId),
      coll: String(o.coll == null ? '' : o.coll),
      quoteId,
      rootQuoteId: String(q.rootQuoteId || quoteId),
      quoteNumber: String(q.quoteNumber || (quoteId ? quoteId.slice(-6).toUpperCase() : '')).slice(0, 80),
      kind: KINDS.indexOf(o.kind) >= 0 ? o.kind : 'comment',
      text: String(o.text == null ? '' : o.text).trim().slice(0, 2000),
      authorUid: String(o.uid == null ? '' : o.uid),
      authorName: String(o.name == null ? '' : o.name).slice(0, 120),
      authorRole: o.role === 'president' ? 'president' : 'sales',
      submitterUid: String(q.createdBy || ''),
    };
  },
  // entry + createdAt, then the quote's own preview (approvalThread: what the Quotes list card shows), best-effort. -> { ok, id } | { ok: false, error }
  async add(o) {
    try {
      const e = window.QuoteThread.entry(o);
      const FV = firebase.firestore.FieldValue;
      const ref = await db.collection('quote_comments').add({ ...e, createdAt: FV.serverTimestamp() });
      try {
        await db.collection(e.coll).doc(e.quoteId).update({
          'approvalThread.count': FV.increment(1),
          'approvalThread.lastText': e.text.slice(0, 200),
          'approvalThread.lastByName': e.authorName,
          'approvalThread.lastByRole': e.authorRole,
          'approvalThread.lastAt': FV.serverTimestamp(),
        });
      } catch (previewErr) { console.warn('[QuoteThread] the quote\'s thread preview was not updated (non-blocking)', previewErr); }
      return { ok: true, id: ref.id };
    } catch (err) {
      return { ok: false, error: (err && (err.code || err.message)) || String(err) };
    }
  },
  // The entries of the chain, oldest first (an entry whose createdAt is still null, i.e. a pending local write, last). The President, a manager and the secretary read
  // the whole chain; anyone else only the entries of quotes he submitted (the rule is provable only with the submitterUid filter in the query).
  async list(coll, q, id) {
    let ref = db.collection('quote_comments').where('threadKey', '==', window.QuoteThread.keyOf(coll, q, id));
    if (['president', 'manager', 'secretary'].indexOf(currentRole) < 0) ref = ref.where('submitterUid', '==', currentUser.uid);
    const snap = await ref.get();
    const ms = (t) => {
      if (t == null) return null;
      if (typeof t === 'number') return t;
      if (typeof t.toMillis === 'function') return t.toMillis();
      if (typeof t.seconds === 'number') return t.seconds * 1000 + Math.floor((t.nanoseconds || 0) / 1e6);
      if (t instanceof Date) return t.getTime();
      return null;
    };
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => {
      const x = ms(a.createdAt), y = ms(b.createdAt);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return x - y;
    });
  },
};
