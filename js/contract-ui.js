// ═══════════════════════════════════════════════════════════════════════════
//  js/contract-ui.js — F3 "Revise contract amount", the screens (specs/SALES-FLOW-SPEC-2026-11-19.md §7, §10.1, §12).
//
//  LAZY: loaded through window.ensureScript('js/contract-ui.js') by the hooks in js/departments.js (Sales Orders row), js/screens/approvals.js
//  and js/screens/dashboards.js. It is NOT in index.html's app-kit; it is in sw.js PRECACHE. It loads its own pure cores
//  (js/price-gate-core.js, js/contract-core.js) on demand; js/contract-core.js needs window.SalesFlow (js/sales-flow-core.js, eager).
//
//  Nothing here does money arithmetic or decides who may act: ContractCore.gate / planApply / runApply / planRefund do. This file is
//  the sheets around them, the real dependencies injected into runApply (mirrors openPaymentConfirmSheet's wiring of SalesFlow.runConfirmation),
//  and the best-effort follow-ups of §7.6 (which never undo an apply).
//
//  Labels follow owner ruling SF23: "SO-0012 R1" / "JO-0012 R1" (the R style only). The Production notification carries no pesos.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const esc = function (s) { return window.escHtml ? window.escHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  const money = function (n) { return '₱' + (window.fmtN2 ? window.fmtN2(Number(n) || 0) : (Number(n) || 0).toFixed(2)); };
  const r2 = function (n) { return Math.round((+n + Number.EPSILON) * 100) / 100; };
  const toast = function (m, t) { try { window.Notifs.showToast(m, t || 'info'); } catch (_) {} };
  const FV = function () { return window.firebase.firestore.FieldValue; };
  const BTN = 'min-height:44px';

  function viewer() {
    const role = window.currentRole || '';
    return {
      uid: (window.currentUser && window.currentUser.uid) || '',
      isPresident: typeof window.isRealPresident === 'function' && window.isRealPresident(),
      isFinanceTier: role === 'finance' || ((window.currentDepts || []).indexOf('Finance') >= 0 && role !== 'secretary'),
    };
  }
  function whoName() { return (window.userProfile && window.userProfile.displayName) || (window.currentUser && window.currentUser.email) || ''; }
  function isSalesActor() { return typeof window.canEditDept === 'function' && window.canEditDept('Sales') && (window.currentRole || '') !== 'secretary'; }

  async function loadCores() {
    await window.ensureScript('js/price-gate-core.js');
    await window.ensureScript('js/contract-core.js');
    if (!window.ContractCore || !window.PriceGate) throw new Error('The contract engine did not load.');
  }

  const soLabel = function (o) { return o.soNumber || o.quoteNumber || ''; };
  const joLabel = function (p, o) { return (p && p.joNumber) || (o && o.joNumber) || (p && typeof window.jobOrderNoFor === 'function' ? window.jobOrderNoFor(p) : '') || 'JO'; };
  const rLabel = function (n) { return 'R' + n; };

  async function readDoc(coll, id) {
    const s = await window.db.collection(coll).doc(id).get();
    return s.exists ? Object.assign({ id: s.id }, s.data()) : null;
  }
  function invalidate() {
    if (typeof window.dbCacheInvalidate === 'function') ['sales_orders', 'job_projects', 'ledger', 'approvals-pending:sales_orders-pending'].forEach(function (k) { try { window.dbCacheInvalidate(k); } catch (_) {} });
  }

  // ── adjustments (list of revisions) ───────────────────────────────────────────────────────────────────────────
  function fmtWhen(iso) { try { return new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' }); } catch (_) { return ''; } }
  function adjustmentsHtml(order) {
    const revs = (order && Array.isArray(order.revisions)) ? order.revisions.slice().sort(function (a, b) { return (a.revNo || 0) - (b.revNo || 0); }) : [];
    if (!revs.length) return '';
    const base = soLabel(order);
    return '<div class="cu-adj" style="font-size:11px;color:var(--text-muted);margin-top:4px;max-width:260px;white-space:normal;overflow-wrap:anywhere">' +
      revs.map(function (r) {
        return '<div>' + esc((base ? base + ' ' : '') + rLabel(r.revNo)) + ': ' + money(r.fromAmount) + ' → ' + money(r.toAmount) +
          ' · ' + esc(r.decidedByName || r.requestedByName || '') + (r.decidedAt ? ' · ' + esc(fmtWhen(r.decidedAt)) : '') + '</div>';
      }).join('') + '</div>';
  }

  // ── the apply: real dependencies for ContractCore.runApply ────────────────────────────────────────────────────
  function buildApplyDeps(vNow) {
    const db = window.db;
    const who = whoName();
    return {
      getOrder: function (id) { return readDoc('sales_orders', id); },
      getProject: function (id) { return readDoc('job_projects', id); },
      getChangeOrder: function (id) { return readDoc('change_orders', id); },
      getClaimStatus: async function () { return null; },     // payment_claims does not exist until Phase 4: a change order with an added down payment stays "not ready"
      getQuote: async function (coll, id) { const q = await readDoc(coll || 'bk_quotes', id); return q; },
      ledgerPost: function (entry) { return window.Ledger.post(entry); },
      updateOrder: function (id, patch) { return db.collection('sales_orders').doc(id).update(patch); },
      applyAtomic: function (a) {
        // delta === 0: no ledger row. Job and order in ONE transaction, re-checking the order inside it.
        const oref = db.collection('sales_orders').doc(a.orderId), pref = db.collection('job_projects').doc(a.projectId);
        return db.runTransaction(async function (tx) {
          const os = await tx.get(oref);
          const cur = os.exists ? os.data() : null;
          if (!cur || !cur.pendingRevision) throw new Error('This contract change was already applied or withdrawn. Refresh and check.');
          tx.update(pref, a.projectFields);
          tx.update(oref, a.orderPatch);
        });
      },
      afterApply: function (result, order, project) { return afterApply(result, order, project, vNow, who); },
      sanitize: function (ref) { return window.Ledger._sanitize(ref); },
      union: function () { const f = FV(); return f.arrayUnion.apply(f, arguments); },
      serverTime: function () { return FV().serverTimestamp(); },
      deleteField: function () { return FV().delete(); },
      ctx: { today: window.today(), nowIso: new Date().toISOString(), who: who, viewer: vNow },
    };
  }

  // §7.6 — best effort, each step on its own; a failure here never undoes the apply.
  async function afterApply(result, order, project, vNow, who) {
    const pr = order.pendingRevision || {};
    const n = result.revNo;
    const client = order.clientName || '';
    const so = soLabel(order), jo = joLabel(project, order);
    const step = async function (fn) { try { await fn(); } catch (e) { try { console.warn('[contract] follow-up failed', e); } catch (_) {} } };
    await step(async function () { if (order.trackingToken && typeof window.syncOrderTracking === 'function') await window.syncOrderTracking(order.trackingToken, { balance: result.arAfter }); });
    await step(async function () {
      if (pr.kind === 'quote_revision' && pr.quoteId) await window.db.collection(pr.quoteColl || 'bk_quotes').doc(pr.quoteId).update({ salesOrderId: order.id, projectId: order.projectId || null, status: 'won' });
    });
    await step(async function () {
      if (pr.kind === 'change_order' && pr.changeOrderId) {
        const patch = { status: 'applied', appliedContractRev: n };
        await window.db.collection('change_orders').doc(pr.changeOrderId).update(patch);
        await window.db.collection('change_requests').doc(pr.changeOrderId).update(patch);
      }
    });
    const N = window.Notifs;
    // Production: NO amounts, opens the job order.
    await step(async function () { await N.sendToDept('Production', { title: '🏭 Job order updated', body: client + ' — ' + jo + ' ' + rLabel(n) + '. Open the new job order.', icon: '🏭', type: 'contract_applied', link: 'projects-lifecycle', dedupKey: 'ccprod-' + order.id + '-' + n }, { fallbackToOwner: true }); });
    await step(async function () { if (pr.requestedBy && pr.requestedBy !== vNow.uid) await N.send(pr.requestedBy, { title: '✅ Contract revised', body: so + ' ' + rLabel(n) + ' is ready.', icon: '✅', type: 'contract_applied', link: 'sales-orders', dedupKey: 'ccdone-' + order.id + '-' + n }); });
    await step(async function () { await N.sendToDept('Finance', { title: '💵 Contract revised', body: client + ' ' + so + ' ' + rLabel(n) + ' — ' + money(result.from) + ' → ' + money(result.to) + '. No action needed.', icon: '💵', type: 'contract_applied', link: 'sales-orders', dedupKey: 'ccfin-' + order.id + '-' + n }); });
    await step(async function () { if (!vNow.isPresident) await N.sendToOwner({ title: '✅ Contract change confirmed by ' + who, body: client + ' ' + so + ' — ' + money(result.from) + ' → ' + money(result.to) + '.', icon: '✅', type: 'contract_applied', link: 'sales-orders', dedupKey: 'ccown-' + order.id + '-' + n }); });
    await step(async function () { if (window.logAudit) window.logAudit('update', 'contract', order.id, { rev: n, from: result.from, to: result.to }); });
    invalidate();
  }

  // ── pending list (the decision block) ─────────────────────────────────────────────────────────────────────────
  async function pendingRevisions() {
    const col = window.db.collection('sales_orders');
    const out = {};
    for (const st of ['pending_approval', 'pending_confirm']) {
      const snap = await col.where('pendingRevision.status', '==', st).get();
      snap.docs.forEach(function (d) { out[d.id] = Object.assign({ id: d.id }, d.data()); });
    }
    return Object.keys(out).map(function (k) { return out[k]; }).sort(function (a, b) { return String((b.pendingRevision || {}).requestedAt || '').localeCompare(String((a.pendingRevision || {}).requestedAt || '')); });
  }
  // May this viewer decide this request? (President for pending_approval; President or stand-in, never on their own request, for pending_confirm.)
  function canDecide(o, v) {
    const pr = o && o.pendingRevision;
    if (!pr || (pr.status !== 'pending_approval' && pr.status !== 'pending_confirm')) return false;
    if (pr.status === 'pending_approval') return !!v.isPresident;
    return !!(window.SalesFlow && window.SalesFlow.canConfirmPayment({ createdBy: pr.requestedBy }, v));
  }

  const APPLY_MSG = {
    'already-applied': 'This contract change was already applied.',
    'nothing-pending': 'There is no contract change waiting on this order.',
    'president-only': 'Only the President approves this change.',
    'not-allowed': 'You cannot decide this contract change.',
    'stale': 'The order changed since this was requested. Ask Sales to send it again.',
    'payment-not-confirmed': 'The payment on this order is not confirmed yet.',
    'job-closed': 'The job is already closed.',
    'change-order-not-ready': 'The change order is not signed and paid yet.',
    'quote-missing': 'The quote revision could not be read.',
    'no-project': 'This order has no job.',
    'not-found': 'This order no longer exists.',
  };

  async function applyRevision(order, onDone) {
    const vNow = viewer();
    if (!canDecide(order, vNow)) { toast('You cannot decide this contract change.', 'error'); return; }
    let res;
    try {
      await loadCores();
      res = await window.ContractCore.runApply(order.id, buildApplyDeps(vNow));
    } catch (ex) { toast('Could not apply the change: ' + (ex.message || ex.code), 'error'); return; }
    if (res.ok) {
      invalidate();
      toast(res.code === 'repaired' ? 'Already in the books — order updated.' : 'Contract revised: ' + soLabel(order) + ' ' + rLabel(res.revNo) + ' is ready.', 'success');
    } else {
      toast(APPLY_MSG[res.code] || 'This contract change cannot be applied.', 'error');
    }
    if (onDone) onDone();
  }

  async function sendBack(order, onDone) {
    const vNow = viewer();
    if (!canDecide(order, vNow)) { toast('You cannot send this back.', 'error'); return false; }
    const reason = await window.promptDialog({ title: 'Send back', message: 'Tell Sales what to change.', placeholder: 'e.g. the price is too low for this job', required: true, multiline: true, confirmLabel: 'Send back' });
    if (reason == null || !String(reason).trim()) return false;
    try {
      const ref = window.db.collection('sales_orders').doc(order.id);
      const snap = await ref.get();
      if (!snap.exists) { toast('This order no longer exists.', 'error'); return false; }
      const cur = snap.data();
      const pr = cur.pendingRevision;
      if (!canDecide(Object.assign({ id: order.id }, cur), vNow)) { toast('This request was already decided or withdrawn.', 'error'); if (onDone) onDone(); return false; }
      const who = whoName();
      const stamp = window.SalesFlow.decisionStamp(vNow, who, new Date().toISOString());
      const why = String(reason).trim();
      await ref.update({ pendingRevision: Object.assign({}, pr, { status: 'rejected', decision: 'rejected', reason: why }, stamp), updatedAt: FV().serverTimestamp() });
      try { if (window.logAudit) window.logAudit('update', 'contract', order.id, { sentBack: true, revNo: pr.revNo }); } catch (_) {}
      try { if (pr.requestedBy && pr.requestedBy !== vNow.uid) await window.Notifs.send(pr.requestedBy, { title: '↩️ Contract change sent back', body: (cur.clientName || '') + ': ' + why, icon: '↩️', type: 'contract_rejected', link: 'sales-orders', dedupKey: 'ccrej-' + order.id + '-' + pr.revNo + '-' + (pr.resubmits || 0) }); } catch (_) {}
      invalidate();
      toast('Sent back to Sales', 'success');
      if (onDone) onDone();
      return true;
    } catch (ex) { toast('Could not send it back: ' + (ex.message || ex.code), 'error'); return false; }
  }

  async function withdraw(order, onDone) {
    try {
      const ref = window.db.collection('sales_orders').doc(order.id);
      const snap = await ref.get();
      const cur = snap.exists ? snap.data() : null;
      if (!cur || !cur.pendingRevision) { toast('There is nothing to withdraw.', 'error'); if (onDone) onDone(); return; }
      await ref.update({ pendingRevision: FV().delete(), updatedAt: FV().serverTimestamp() });
      try { if (window.logAudit) window.logAudit('update', 'contract', order.id, { withdrawn: true, revNo: cur.pendingRevision.revNo }); } catch (_) {}
      invalidate();
      toast('Contract change withdrawn', 'success');
    } catch (ex) { toast('Could not withdraw it: ' + (ex.message || ex.code), 'error'); return; }
    if (onDone) onDone();
  }

  // ── the decision block (Approvals page) and the dashboard banner ──────────────────────────────────────────────
  async function renderDecisionBlock(host, opts) {
    if (!host) return;
    opts = opts || {};
    const v = viewer();
    if (!v.isPresident && !v.isFinanceTier) { host.innerHTML = ''; return; }
    let all;
    try { all = await pendingRevisions(); }
    catch (e) { host.innerHTML = ''; return; }
    const list = all.filter(function (o) { return canDecide(o, v); });
    if (!list.length) { host.innerHTML = ''; return; }
    const standIn = v.isFinanceTier && !v.isPresident;
    const again = opts.onDone || function () { renderDecisionBlock(host, opts); };
    host.innerHTML = '<div class="card" style="margin-bottom:12px;border:1.5px solid var(--warning)">' +
      '<div class="card-header" style="display:flex;justify-content:space-between;align-items:center"><h3 style="font-size:13px">📝 Contract changes' + (standIn ? ' — President\'s stand-in' : '') + '</h3><span class="badge badge-orange">' + list.length + '</span></div>' +
      '<div class="card-body" style="display:flex;flex-direction:column;gap:8px">' +
      (standIn ? '<div style="font-size:12px;color:var(--text-muted)">The President normally decides these. Confirm only if he cannot be reached. He will be told that you confirmed it.</div>' : '') +
      list.map(function (o) {
        const pr = o.pendingRevision;
        const needs = pr.status === 'pending_approval';
        const g = pr.gate || {};
        return '<div class="item-card cu-item">' +
          '<div class="item-title" style="font-size:13px">' + esc(o.clientName || '') + ' — ' + esc(soLabel(o)) + ' ' + esc(rLabel(pr.revNo)) + '</div>' +
          '<div class="item-meta" style="margin-top:4px"><span>' + money(pr.fromAmount) + ' → ' + money(pr.toAmount) + '</span><span>' + (pr.delta >= 0 ? '+' : '−') + money(Math.abs(pr.delta)) + '</span><span>requested by ' + esc(pr.requestedByName || '') + '</span></div>' +
          '<div style="font-size:12px;margin-top:4px;overflow-wrap:anywhere">' + esc(pr.changeReason || '') + '</div>' +
          (needs && g.reason ? '<div style="font-size:11px;color:var(--warning);margin-top:3px">' + esc(g.reason === 'overpayment' ? 'The new amount is below what the client already paid.' : 'The new price is below the last approved price.') + '</div>' : '') +
          ((pr.resubmits || 0) > 0 ? '<div style="font-size:11px;color:var(--text-muted)">Sent again — earlier reason: ' + esc(pr.prevReason || '—') + '</div>' : '') +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">' +
          '<button class="btn-success btn-sm cu-apply" data-id="' + esc(o.id) + '" style="' + BTN + '">' + (needs ? 'Approve' : 'Confirm') + '</button>' +
          '<button class="btn-secondary btn-sm cu-back" data-id="' + esc(o.id) + '" style="' + BTN + '">Send back</button></div></div>';
      }).join('') + '</div></div>';
    const find = function (b) { return list.find(function (x) { return x.id === b.dataset.id; }); };
    host.querySelectorAll('.cu-apply').forEach(function (b) { b.addEventListener('click', function () { const o = find(b); if (o) window.busy(b, function () { return applyRevision(o, again); }); }); });
    host.querySelectorAll('.cu-back').forEach(function (b) { b.addEventListener('click', function () { const o = find(b); if (o) sendBack(o, again); }); });
  }

  async function renderBanner(el) {
    if (!el) return;
    const v = viewer();
    if (!v.isPresident && !v.isFinanceTier) return;
    try {
      const n = (await pendingRevisions()).filter(function (o) { return canDecide(o, v); }).length;
      if (n) el.innerHTML = '<div class="alert-banner alert-warn" onclick="navigateTo(\'approvals\')"><span>📝 <strong>' + n + ' contract change' + (n > 1 ? 's' : '') + '</strong> waiting for your decision</span><span class="alert-chevron">›</span></div>';
    } catch (_) { /* silent: the Approvals page has the list */ }
  }

  // ── the revise sheet (§7.2) ───────────────────────────────────────────────────────────────────────────────────
  // The newer, approved revisions in the order's quote chain. Never throws.
  async function loadChain(order) {
    try {
      const coll = typeof window.quoteCollectionFor === 'function' ? window.quoteCollectionFor(order.company) : 'bk_quotes';
      const startId = order.quoteIdOriginal || order.quoteId;
      if (!startId) return { coll: coll, quotes: [] };
      const start = await readDoc(coll, startId);
      if (!start) return { coll: coll, quotes: [] };
      const rootId = start.rootQuoteId || start.id;
      const map = {}; map[start.id] = start;
      const root = rootId === start.id ? start : await readDoc(coll, rootId);
      if (root) map[root.id] = root;
      const snap = await window.db.collection(coll).where('rootQuoteId', '==', rootId).get();
      snap.docs.forEach(function (d) { map[d.id] = Object.assign({ id: d.id }, d.data()); });
      return { coll: coll, quotes: Object.keys(map).map(function (k) { return map[k]; }) };
    } catch (_) { return { coll: 'bk_quotes', quotes: [] }; }
  }
  const quoteTotal = function (q) { return Number(q.total) || Number(q.grandTotal) || Number(q.amount) || 0; };
  const secs = function (q) { return (q.createdAt && q.createdAt.seconds) || 0; };

  async function openReviseSheet(orderIn, onDone) {
    const v = viewer();
    if (!orderIn || !orderIn.id) return;
    if (!(v.isPresident || isSalesActor())) { toast('Only Sales or the President can revise a contract amount.', 'error'); return; }
    try { await loadCores(); } catch (ex) { toast('Could not open the contract screen: ' + (ex.message || ex.code), 'error'); return; }
    const CC = window.ContractCore, PG = window.PriceGate;
    let order, project;
    try {
      order = await readDoc('sales_orders', orderIn.id);
      project = order && order.projectId ? await readDoc('job_projects', order.projectId) : null;
    } catch (ex) { toast('Could not read the order: ' + (ex.message || ex.code), 'error'); return; }
    if (!order) { toast('This order no longer exists.', 'error'); return; }
    if (order.status !== 'recorded') { toast('The payment on this order is not confirmed yet.', 'error'); return; }
    if (!project) { toast('This order has no job.', 'error'); return; }
    if (project.stage === 'paid' || project.stage === 'cancelled') { toast('The job is closed, so the contract cannot change.', 'error'); return; }
    const existing = order.pendingRevision || null;
    if (existing && existing.status !== 'rejected') { toast('A contract change is already waiting.', 'error'); return; }

    const from = r2(order.contractAmount);
    const collected = r2(Number(project.amountCollected) || 0);
    const chain = await loadChain(order);
    const currentQuote = chain.quotes.find(function (q) { return q.id === order.quoteId; }) || null;
    const picks = chain.quotes
      // §7.2: only NEWER revisions than the order's own quote (an older one would roll the contract back to a superseded price)
      .filter(function (q) { return q.id !== order.quoteId && q.approvalStatus === 'approved' && quoteTotal(q) > 0 && (!currentQuote || secs(q) > secs(currentQuote)); })
      .sort(function (a, b) { return secs(b) - secs(a); });
    // §7.3: the bar a Choice B / C amount is compared with.
    let chainApproved = null;
    const lastApp = PG.lastApprovedFromChain(chain.quotes);
    if (lastApp) {
      let at = '';
      chain.quotes.forEach(function (q) { if (q.approvedBy && !q.approvalCarriedFrom) { const a = String((q.approvedSnapshot && q.approvedSnapshot.at) || q.approvedAt || ''); if (a > at) at = a; } });
      chainApproved = { total: lastApp.total, at: at };
    }
    const lastApproved = CC.lastApproved({ chainApproved: chainApproved, revisions: order.revisions || [], originalContractAmount: order.originalContractAmount, contractAmount: order.contractAmount });
    const stdTotal = currentQuote && currentQuote.priceCheck && currentQuote.priceCheck.stdTotal != null ? Number(currentQuote.priceCheck.stdTotal) : null;
    // Choice C: only when a signed, unapplied change order exists (Phase 5 collection; any failure just hides it).
    let cos = [];
    try {
      const cs = await window.db.collection('change_orders').where('orderId', '==', order.id).get();
      cos = cs.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).filter(function (c) { return c.status === 'signed' && !c.appliedContractRev && c.pricing && isFinite(Number(c.pricing.price)); });
    } catch (_) { cos = []; }

    const prefill = existing || null;
    const chk = function (k, first) { return (prefill ? prefill.kind === k : first) ? ' checked' : ''; };
    const kindOfPrefill = prefill ? prefill.kind : (picks.length ? 'quote_revision' : 'manual');
    const quoteRows = picks.map(function (q, i) {
      const t = r2(quoteTotal(q)), d = r2(t - from);
      const on = (prefill && prefill.kind === 'quote_revision' && prefill.quoteId === q.id) || (!(prefill && prefill.kind === 'quote_revision') && i === 0 && kindOfPrefill === 'quote_revision');
      return '<label style="display:flex;gap:8px;align-items:center;padding:8px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;min-height:44px"><input type="radio" name="rv-quote" value="' + esc(q.id) + '"' + (on ? ' checked' : '') + '>' +
        '<span style="font-size:12px">' + esc(q.quoteNumber || q.fileName || q.id) + ' · ' + money(t) + ' · ' + (d >= 0 ? '+' : '−') + money(Math.abs(d)) + '</span></label>';
    }).join('');
    const coRows = cos.map(function (c, i) {
      return '<label style="display:flex;gap:8px;align-items:center;padding:8px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;min-height:44px"><input type="radio" name="rv-co" value="' + esc(c.id) + '"' + (i === 0 ? ' checked' : '') + '>' +
        '<span style="font-size:12px">' + esc(c.coNumber || c.id) + ' · ' + (Number(c.pricing.price) >= 0 ? '+' : '−') + money(Math.abs(Number(c.pricing.price))) + '</span></label>';
    }).join('');
    const field = 'padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text);min-height:44px;font-family:inherit';
    const choice = function (id, key, title, bodyHtml, checked) {
      return '<div style="margin-bottom:12px"><label style="display:flex;gap:8px;align-items:center;font-weight:700;font-size:13px;min-height:44px"><input type="radio" name="rv-choice" id="' + id + '" value="' + key + '"' + checked + '> ' + title + '</label>' + bodyHtml + '</div>';
    };
    const body =
      (existing ? '<div style="font-size:12px;color:var(--danger);margin-bottom:10px;overflow-wrap:anywhere">Sent back by ' + esc(existing.decidedByName || '') + ': ' + esc(existing.reason || '') + '</div>' : '') +
      '<div style="font-size:12px;margin-bottom:12px;overflow-wrap:anywhere"><strong>' + esc(order.clientName || '') + '</strong> · ' + esc(soLabel(order)) + ' · contract ' + money(from) + ' · collected ' + money(collected) + ' · balance ' + money(Math.max(0, from - collected)) + '</div>' +
      (picks.length ? choice('rv-ch-a', 'quote_revision', 'Use a quote revision', quoteRows, chk('quote_revision', true)) : '') +
      choice('rv-ch-b', 'manual', 'Enter the change',
        '<div style="display:grid;gap:6px"><select id="rv-mode" style="' + field + '"><option value="amount"' + (prefill && prefill.kind === 'manual' ? '' : ' selected') + '>New contract amount</option><option value="diff">Difference (+ or −)</option></select>' +
        '<input id="rv-val" type="number" step="0.01" inputmode="decimal" style="' + field + '" value="' + (prefill && prefill.kind === 'manual' ? esc(String(prefill.toAmount)) : '') + '" placeholder="e.g. 120000"></div>', chk('manual', !picks.length)) +
      (cos.length ? choice('rv-ch-c', 'change_order', 'From a signed change order', coRows, chk('change_order', false)) : '') +
      '<div class="form-group"><label>Reason (5–300 characters)</label><textarea id="rv-reason" rows="3" maxlength="300" style="' + field + '">' + esc(prefill ? prefill.changeReason || '' : '') + '</textarea></div>' +
      '<div id="rv-summary" style="font-size:13px;display:grid;gap:4px;margin:10px 0;padding:10px;border:1px solid var(--border);border-radius:8px"></div>' +
      '<div id="rv-verdict" style="font-size:12px;margin-bottom:8px"></div>' +
      '<div id="rv-err" class="error-msg hidden"></div>';
    const footer = '<button class="btn-primary" id="rv-send" style="' + BTN + '">' + (existing ? 'Send again' : 'Send') + '</button>' +
      (existing ? '<button class="btn-secondary" id="rv-withdraw" style="' + BTN + '">Withdraw</button>' : '') +
      '<button class="btn-secondary" onclick="closeModal()" style="' + BTN + '">Close</button>';
    const panel = window.openPage('Revise contract amount — ' + esc(order.clientName || ''), body, footer);
    const $ = function (id) { return panel.querySelector('#' + id); };
    const radios = function () { return panel.querySelectorAll('input[name="rv-choice"]'); };
    const kind = function () { const c = panel.querySelector('input[name="rv-choice"]:checked'); return c ? c.value : (picks.length ? 'quote_revision' : 'manual'); };
    const pickedQuote = function () { const r = panel.querySelector('input[name="rv-quote"]:checked'); return r ? picks.find(function (q) { return q.id === r.value; }) : picks[0]; };
    const pickedCo = function () { const r = panel.querySelector('input[name="rv-co"]:checked'); return r ? cos.find(function (c) { return c.id === r.value; }) : cos[0]; };

    // → { kind, toAmount, quote?, co?, stdTotal } | null while the inputs are incomplete
    function current() {
      const k = kind();
      if (k === 'quote_revision') { const q = pickedQuote(); if (!q) return null; return { kind: k, toAmount: r2(quoteTotal(q)), quote: q, stdTotal: q.priceCheck && q.priceCheck.stdTotal != null ? Number(q.priceCheck.stdTotal) : null }; }
      if (k === 'change_order') { const c = pickedCo(); if (!c) return null; return { kind: k, toAmount: r2(from + Number(c.pricing.price)), co: c, stdTotal: null }; }
      const raw = $('rv-val').value;
      if (raw === '' || !isFinite(Number(raw))) return null;
      const to = $('rv-mode').value === 'diff' ? r2(from + Number(raw)) : r2(Number(raw));
      return { kind: 'manual', toAmount: to, stdTotal: stdTotal };
    }
    function gateOf(cur) {
      return CC.gate({ kind: cur.kind, toAmount: cur.toAmount, lastApproved: lastApproved, stdTotal: cur.stdTotal, collected: collected });
    }
    function paint() {
      const cur = current();
      const sum = $('rv-summary'), ver = $('rv-verdict');
      if (!cur) { sum.innerHTML = '<span style="color:var(--text-muted)">Choose or enter the new amount.</span>'; ver.textContent = ''; return; }
      const delta = r2(cur.toAmount - from);
      const credit = Math.max(0, r2(collected - cur.toAmount)), bal = Math.max(0, r2(cur.toAmount - collected));
      sum.innerHTML = '<div>New contract: <strong>' + money(cur.toAmount) + '</strong></div><div>Difference: ' + (delta >= 0 ? '+' : '−') + money(Math.abs(delta)) + '</div><div>Collected (unchanged): ' + money(collected) + '</div>' +
        (credit > 0 ? '<div style="color:var(--danger)">Client credit: <strong>' + money(credit) + '</strong></div>' : '<div>New balance due: <strong>' + money(bal) + '</strong></div>');
      const g = gateOf(cur);
      ver.textContent = g.approval === 'president'
        ? 'Goes to the President for approval: ' + (g.reason === 'overpayment' ? 'the new amount is below what the client already paid.' : g.reason === 'invalid_amount' ? 'the amount is not valid.' : 'the new price is below the last approved price.')
        : 'No price approval needed. The President or Finance confirms it.';
    }
    ['change', 'input'].forEach(function (ev) {
      panel.querySelectorAll('input[name="rv-quote"]').forEach(function (r) { r.addEventListener(ev, function () { const a = panel.querySelector('#rv-ch-a'); if (a) a.checked = true; paint(); }); });
      panel.querySelectorAll('input[name="rv-co"]').forEach(function (r) { r.addEventListener(ev, function () { const c = panel.querySelector('#rv-ch-c'); if (c) c.checked = true; paint(); }); });
      radios().forEach(function (r) { r.addEventListener(ev, paint); });
      $('rv-val').addEventListener(ev, function () { const b = panel.querySelector('#rv-ch-b'); if (b) b.checked = true; paint(); });
      $('rv-mode').addEventListener(ev, paint);
    });
    paint();

    $('rv-send').addEventListener('click', function () {
      return window.busy($('rv-send'), async function () {
        const err = $('rv-err');
        const fail = function (m) { err.textContent = m; err.classList.remove('hidden'); };
        err.classList.add('hidden');
        const cur = current();
        const reason = String($('rv-reason').value || '').trim();
        if (!cur) { fail('Choose or enter the new amount.'); return; }
        if (!(cur.toAmount > 0)) { fail('The new contract amount must be more than zero.'); return; }
        if (reason.length < 5 || reason.length > 300) { fail('Give a reason of 5 to 300 characters.'); return; }
        if (cur.kind !== 'quote_revision' && r2(cur.toAmount) === from) { fail('That is the same as the current contract amount.'); return; }
        // Fresh read: nothing may have moved while the sheet was open.
        const fresh = await readDoc('sales_orders', order.id);
        if (!fresh || fresh.status !== 'recorded') { fail('This order is not in a state that can be revised.'); return; }
        if (r2(fresh.contractAmount) !== from || (Number(fresh.contractRev) || 0) !== (Number(order.contractRev) || 0)) { fail('The order changed while this was open. Close it and try again.'); return; }
        const fp = fresh.pendingRevision || null;
        if (fp && fp.status !== 'rejected') { fail('A contract change is already waiting.'); return; }
        const g = gateOf(cur);
        const vNow = viewer();
        const nowIso = new Date().toISOString();
        const who = whoName();
        const pr = {
          revNo: (Number(fresh.contractRev) || 0) + 1, kind: cur.kind, fromAmount: from, toAmount: cur.toAmount, delta: r2(cur.toAmount - from), changeReason: reason,
          quoteId: cur.quote ? cur.quote.id : null, quoteColl: cur.quote ? chain.coll : null, quoteNumber: cur.quote ? (cur.quote.quoteNumber || null) : null,
          changeOrderId: cur.co ? cur.co.id : null,
          gate: { approval: g.approval, reason: g.reason || '', lastApproved: lastApproved, stdTotal: cur.stdTotal == null ? null : cur.stdTotal, collected: collected },
          status: g.approval === 'president' ? 'pending_approval' : 'pending_confirm',
          requestedAt: nowIso, requestedBy: vNow.uid, requestedByName: who,
          resubmits: fp ? (Number(fp.resubmits) || 0) + 1 : 0, prevReason: fp ? (fp.reason || '') : '',
          decision: null, decidedBy: null, decidedByName: null, decidedByRole: null, decidedAt: null, onBehalf: false, reason: '',
        };
        try {
          await window.db.collection('sales_orders').doc(order.id).update({ pendingRevision: pr, updatedAt: FV().serverTimestamp() });
        } catch (ex) { fail('Could not send it: ' + (ex.message || ex.code)); return; }
        try { if (window.logAudit) window.logAudit('update', 'contract', order.id, { requested: true, revNo: pr.revNo, from: from, to: cur.toAmount }); } catch (_) {}
        const text = who + ': ' + (order.clientName || '') + ' ' + soLabel(order) + ' — ' + money(from) + ' → ' + money(cur.toAmount) + '. ' + reason;
        const needs = pr.status === 'pending_approval';
        const key = 'ccreq-' + order.id + '-' + pr.revNo + '-' + pr.resubmits;
        try { if (!vNow.isPresident) await window.Notifs.sendToOwner({ title: needs ? '📝 Contract change to approve' : '📝 Contract change to confirm', body: text, icon: '📝', type: 'contract_change', link: 'approvals', dedupKey: key }); } catch (_) {}
        try { if (!needs) await window.Notifs.sendToDept('Finance', { title: '📝 Contract change to confirm', body: text, icon: '📝', type: 'contract_change', link: 'approvals', dedupKey: key + '-fin' }); } catch (_) {}
        invalidate();
        window.closeModal();
        toast('Sent for ' + (needs ? 'approval' : 'confirmation'), 'success');
        if (onDone) onDone();
      });
    });
    const wd = $('rv-withdraw');
    if (wd) wd.addEventListener('click', function () { window.closeModal(); withdraw(order, onDone); });
  }

  // ── record refund (§7.7), books tier ──────────────────────────────────────────────────────────────────────────
  async function openRefundSheet(orderIn, onDone) {
    const v = viewer();
    if (!(v.isPresident || v.isFinanceTier)) { toast('Only Finance or the President records a refund.', 'error'); return; }
    try { await loadCores(); } catch (ex) { toast('Could not open the refund screen: ' + (ex.message || ex.code), 'error'); return; }
    const order = await readDoc('sales_orders', orderIn.id);
    const project = order && order.projectId ? await readDoc('job_projects', order.projectId) : null;
    if (!order || !project) { toast('This order or its job no longer exists.', 'error'); return; }
    const credit = Math.max(0, r2((Number(project.amountCollected) || 0) - (Number(project.contractAmount) || 0)));
    if (!(credit > 0)) { toast('There is no client credit to refund.', 'error'); return; }
    let bankOpts = '', hasBanks = false;
    try { const list = await window.BankAccounts.list(); hasBanks = list.length > 0; if (hasBanks) bankOpts = await window.BankAccounts.optionsHTML(''); }
    catch (_) { toast('Could not load the company bank accounts. Check your connection and try again.', 'error'); return; }
    const field = 'padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text);min-height:44px;font-family:inherit';
    const panel = window.openPage('Record refund — ' + esc(order.clientName || ''),
      '<div style="font-size:12px;margin-bottom:10px">Client credit on this job: <strong>' + money(credit) + '</strong></div>' +
      '<div class="form-group"><label>Amount refunded</label><input id="rf-amount" type="number" step="0.01" inputmode="decimal" style="' + field + '" value="' + credit + '"></div>' +
      '<div class="form-group"><label>Date</label><input id="rf-date" type="date" style="' + field + '" value="' + esc(window.today()) + '"></div>' +
      '<div class="form-group"><label>Method</label><select id="rf-method" style="' + field + '">' + ['Bank Transfer', 'GCash', 'Cash', 'Cheque', 'Other'].map(function (m) { return '<option>' + m + '</option>'; }).join('') + '</select></div>' +
      (hasBanks ? '<div class="form-group"><label>Paid from</label><select id="rf-bank" style="' + field + '">' + bankOpts + '</select></div>' : '') +
      '<div class="form-group"><label>Proof</label><div id="rf-proof"></div></div><div id="rf-err" class="error-msg hidden"></div>',
      '<button class="btn-primary" id="rf-go" style="' + BTN + '">Record refund</button><button class="btn-secondary" onclick="closeModal()" style="' + BTN + '">Close</button>');
    const $ = function (id) { return panel.querySelector('#' + id); };
    let proof = null;
    try { if (window.Drive && window.Drive.renderUploadArea) window.Drive.renderUploadArea('rf-proof', function (r) { proof = r; }, { label: 'Upload proof (photo/PDF)', accept: 'image/*,.pdf', dept: 'Finance', subfolder: 'SalesOrders' }); } catch (_) {}
    $('rf-go').addEventListener('click', function () {
      return window.busy($('rf-go'), async function () {
        const err = $('rf-err');
        const fail = function (m) { err.textContent = m; err.classList.remove('hidden'); };
        err.classList.add('hidden');
        const sel = hasBanks ? ($('rf-bank').value || '') : '';
        if (hasBanks && !sel) { fail('Select the company account the refund was paid from.'); return; }
        const freshO = await readDoc('sales_orders', order.id), freshP = await readDoc('job_projects', project.id);
        const acct = await window.BankAccounts.pick(sel);
        const who = whoName();
        const plan = window.ContractCore.planRefund(freshO, freshP, {
          today: $('rf-date').value || window.today(), nowIso: new Date().toISOString(), who: who, amount: Number($('rf-amount').value),
          method: $('rf-method').value, acct: acct, bankTag: window.BankAccounts.tag(acct, 'out'),
          union: function () { const f = FV(); return f.arrayUnion.apply(f, arguments); }, serverTime: function () { return FV().serverTimestamp(); },
          sanitize: function (r) { return window.Ledger._sanitize(r); },
        });
        if (!plan.ok) { fail(plan.code === 'exceeds-credit' ? 'That is more than the client credit (' + money(plan.credit) + ').' : plan.code === 'no-revision' ? 'This order has not been revised.' : 'Enter an amount more than zero.'); return; }
        if (proof && proof.url) plan.ledgerEntry.extra = Object.assign({}, plan.ledgerEntry.extra, { proofUrl: proof.url, proofName: proof.name || null });
        try { await window.Ledger.post(plan.ledgerEntry); }
        catch (ex) { fail('Failed: ' + (ex.message || ex.code)); return; }
        try { if (window.logAudit) window.logAudit('create', 'ledger', window.Ledger._sanitize(plan.ref), { source: 'contract_refund', amount: plan.amount }); } catch (_) {}
        invalidate();
        window.closeModal();
        toast('Refund recorded', 'success');
        if (onDone) onDone();
      });
    });
  }

  // ── Sales Orders row: the adjustments line (+ pending state and its buttons) ──────────────────────────────────
  // Fills every `.so-adj[data-id]` under `root`. `projById` is the page's job map; `rerender` redraws the page.
  function fillAdjustments(root, orders, projById, rerender) {
    const v = viewer();
    root.querySelectorAll('.so-adj').forEach(function (el) {
      const o = orders.find(function (x) { return x.id === el.dataset.id; });
      if (!o) return;
      const pr = o.pendingRevision;
      let h = adjustmentsHtml(o);
      if (pr) {
        const label = pr.status === 'rejected' ? 'Contract change sent back: ' + esc(pr.reason || '') : pr.status === 'pending_approval' ? 'Contract change waiting for the President' : 'Contract change waiting for confirmation';
        h += '<div style="font-size:11px;margin-top:4px;color:' + (pr.status === 'rejected' ? 'var(--danger)' : 'var(--warning)') + ';max-width:260px;white-space:normal;overflow-wrap:anywhere">' + label + ' (' + money(pr.fromAmount) + ' → ' + money(pr.toAmount) + ')</div>';
        if (isSalesActor() || v.isPresident) {
          h += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">' +
            (pr.status === 'rejected' ? '<button type="button" class="btn-primary btn-sm cu-resend" style="' + BTN + '">Edit &amp; send again</button>' : '') +
            '<button type="button" class="btn-secondary btn-sm cu-withdraw" style="' + BTN + '">Withdraw</button></div>';
        }
      }
      const pj = o.projectId && projById ? projById[o.projectId] : null;
      if (pj && Number(pj.clientCredit) > 0 && (v.isPresident || v.isFinanceTier)) {
        h += '<div style="font-size:11px;margin-top:4px;color:var(--danger)">Client credit ' + money(pj.clientCredit) + '</div><button type="button" class="btn-secondary btn-sm cu-refund" style="' + BTN + ';margin-top:4px">Record refund</button>';
      }
      el.innerHTML = h;
      const on = function (cls, fn) { const b = el.querySelector(cls); if (b) b.addEventListener('click', function (ev) { ev.stopPropagation(); fn(); }); };
      on('.cu-resend', function () { openReviseSheet(o, rerender); });
      on('.cu-withdraw', function () { withdraw(o, rerender); });
      on('.cu-refund', function () { openRefundSheet(o, rerender); });
    });
  }

  window.ContractUI = {
    openReviseSheet: openReviseSheet, openRefundSheet: openRefundSheet, withdraw: withdraw,
    renderDecisionBlock: renderDecisionBlock, renderBanner: renderBanner, pendingRevisions: pendingRevisions,
    adjustmentsHtml: adjustmentsHtml, fillAdjustments: fillAdjustments, canDecide: canDecide,
    applyRevision: applyRevision, sendBack: sendBack,
  };
})();
