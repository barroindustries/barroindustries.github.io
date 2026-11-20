// ═══════════════════════════════════════════════════════════════════════════
//  js/payment-claims-ui.js — P5 "the balance payment (and every later payment)", the screens (specs/SALES-FLOW-SPEC-2026-11-19.md §8, §10.2, §12).
//
//  LAZY: loaded through window.ensureScript('js/payment-claims-ui.js') by the hooks in js/departments.js (Sales Orders row), js/screens/approvals.js
//  and js/screens/production.js (job detail). It is NOT in index.html's app-kit; it is in sw.js PRECACHE. It loads js/payment-claims-core.js on
//  demand (the core needs window.SalesFlow, js/sales-flow-core.js, eager).
//
//  Nothing here does money arithmetic or decides who may act: PaymentClaims.validateRecord / planConfirmation / runConfirmation and
//  SalesFlow.canConfirmPayment do. This file is the sheets around them, the real dependencies injected into runConfirmation (it mirrors
//  openPaymentConfirmSheet's wiring of SalesFlow.runConfirmation for the first payment), and the best-effort notifications of §12.
//
//  The Payment Acknowledgement number is taken with Forms.nextNumber('PA') BEFORE the post (a number burned by a failed post is a gap, SF11).
//  No notification here goes to Production, and none carries an amount in a place Production reads.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  // firebase-config.js declares `const db` at top level: a global binding every classic script can read, but NOT window.db (undefined in the real app).
  const fsDb = function () { return (typeof db !== 'undefined' && db) || window.db; };

  const esc = function (s) { return window.escHtml ? window.escHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  const money = function (n) { return '₱' + (window.fmtN2 ? window.fmtN2(Number(n) || 0) : (Number(n) || 0).toFixed(2)); };
  const toast = function (m, t) { try { window.Notifs.showToast(m, t || 'info'); } catch (_) {} };
  const FV = function () { return window.firebase.firestore.FieldValue; };
  const BTN = 'min-height:44px';
  const FIELD = 'padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text);min-height:44px;font-family:inherit';
  const ORDER_KEY = 'approvals-pending:sales_orders-pending';
  const CLAIM_KEY = 'approvals-pending:payment_claims-pending';

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
  // Who may RECORD (P-1): any Sales member, the President, and the books tier. A secretary never does.
  function canRecord(v) { return (window.currentRole || '') !== 'secretary' && !!(v.isPresident || isSalesActor() || v.isFinanceTier); }

  async function loadCore() {
    await window.ensureScript('js/payment-claims-core.js');
    if (!window.PaymentClaims) throw new Error('The payment engine did not load.');
  }
  async function readDoc(coll, id) {
    const s = await fsDb().collection(coll).doc(id).get();
    return s.exists ? Object.assign({ id: s.id }, s.data()) : null;
  }
  function invalidate() {
    if (typeof window.dbCacheInvalidate === 'function') [ORDER_KEY, CLAIM_KEY, 'ledger', 'job_projects', 'sales_orders'].forEach(function (k) { try { window.dbCacheInvalidate(k); } catch (_) {} });
  }
  const step = async function (fn) { try { await fn(); } catch (e) { try { console.warn('[payment claims] follow-up failed', e); } catch (_) {} } };
  const fmtWhen = function (iso) { try { return new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (_) { return ''; } };

  // The amount a claim stands for: the booked figure once confirmed, otherwise what the form would book.
  function shownAmount(c) {
    if (c && c.status === 'recorded' && Number(c.recordedAmount) > 0) return Number(c.recordedAmount);
    return window.vatSplit(Number(c && c.paymentReceived) > 0 ? Number(c.paymentReceived) : 0, (c && c.vatTreatment) || 'inclusive').recorded;
  }

  // Site-visit fees the client already paid and the job has not credited yet (§5.6). Never throws: a failed read is "no fees".
  async function loadFees(clientId) {
    if (!clientId) return [];
    try {
      const snap = await fsDb().collection('payment_claims').where('clientId', '==', clientId).get();
      return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); })
        .filter(function (c) { return c.kind === 'site_visit' && c.status === 'recorded' && Number(c.recordedAmount) > 0; })
        .map(function (c) { return { id: c.id, recordedAmount: Number(c.recordedAmount) }; });
    } catch (_) { return []; }
  }

  // The order's signed change orders that ask for a down payment and are not applied yet (§5.7 C4). Never throws: a failed read is "none".
  async function loadChangeOrders(orderId) {
    if (!orderId) return [];
    try {
      const snap = await fsDb().collection('change_orders').where('orderId', '==', orderId).get();
      return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); })
        .filter(function (c) { return c.status === 'signed' && !c.appliedContractRev && c.pricing && Number(c.pricing.addedDownPayment) > 0; });
    } catch (_) { return []; }
  }

  // ── Record payment (later-payment mode of the form, P-1 and P-4) ───────────────────────────────────────────────
  // arg = { orderId } | { projectId } | { claim } (a sent-back claim, edit and resend). Never throws.
  async function openRecordSheet(arg, onDone) {
    const v = viewer();
    arg = arg || {};
    if (!canRecord(v)) { toast('Only Sales or the President can record a payment.', 'error'); return; }
    try { await loadCore(); } catch (ex) { toast('Could not open the payment screen: ' + (ex.message || ex.code), 'error'); return; }
    const PC = window.PaymentClaims;
    let claim = null, order = null, project = null;
    try {
      if (arg.claim) {
        claim = await readDoc('payment_claims', arg.claim.id);
        if (!claim) { toast('This payment no longer exists.', 'error'); return; }
        if (claim.status !== 'payment_rejected') { toast('This payment is not waiting to be fixed.', 'error'); if (onDone) onDone(); return; }
        order = claim.orderId ? await readDoc('sales_orders', claim.orderId) : null;
        project = claim.projectId ? await readDoc('job_projects', claim.projectId) : null;
      } else if (arg.orderId) {
        order = await readDoc('sales_orders', arg.orderId);
        project = order && order.projectId ? await readDoc('job_projects', order.projectId) : null;
      } else if (arg.projectId) {
        project = await readDoc('job_projects', arg.projectId);
        order = project && project.salesOrderId ? await readDoc('sales_orders', project.salesOrderId) : null;
      }
    } catch (ex) { toast('Could not read the order: ' + (ex.message || ex.code), 'error'); return; }
    if (!order || !project) { toast('This order or its job could not be found.', 'error'); return; }
    if (order.flowVersion !== 2 || Number(project.flowVersion) < 2) { toast('This job uses the old payment screen (Finance records its payments).', 'error'); return; }
    if (order.status !== 'recorded') { toast('The first payment on this order is not confirmed yet.', 'error'); return; }
    if (project.stage === 'cancelled') { toast('The job is cancelled.', 'error'); return; }
    const fees = await loadFees(order.clientId || project.clientId);
    const due0 = PC.balanceDue(project, fees);
    const cos = await loadChangeOrders(order.id);
    if (!claim && !(due0 > 0) && !cos.length) { toast('Nothing is owed on this job.', 'error'); return; }

    const v0 = claim || {};
    const kindSel = v0.kind && v0.kind !== 'site_visit' ? v0.kind : 'balance';
    // A sent-back claim keeps its change order (the rules let Sales resend only the payment fields), so its type is one or the other family.
    const kinds = claim ? (claim.kind === 'change_order' ? ['change_order'] : ['balance', 'progress']) : ['balance', 'progress', 'change_order'];
    const coSel = (claim && claim.changeOrderId) || (cos[0] && cos[0].id) || '';
    const coPrice = function (c) { return { price: c && c.pricing && c.pricing.price }; };
    const coDp = function (c) { return Number(c && c.pricing && c.pricing.addedDownPayment) || 0; };
    const vat0 = v0.vatTreatment || order.vatTreatment || 'inclusive';
    const methods = ['Bank Transfer', 'GCash', 'Cash', 'Cheque', 'Other'];
    const pcr = (claim && claim.paymentConfirm) || {};
    const body =
      (claim ? '<div style="font-size:12px;color:var(--danger);margin-bottom:10px;overflow-wrap:anywhere">Sent back by ' + esc(pcr.decidedByName || '') + ': ' + esc(pcr.reason || '') + '</div>' : '') +
      '<div style="font-size:12px;margin-bottom:10px;overflow-wrap:anywhere"><strong>' + esc(order.clientName || '') + '</strong> · ' + esc(order.soNumber || order.quoteNumber || '') + ' · contract ' + money(project.contractAmount) + '</div>' +
      '<div id="pr-due" style="font-size:15px;font-weight:700;margin-bottom:12px">Balance due ' + money(due0) + '</div>' +
      '<div class="form-group"><label>This payment is for</label><select id="pr-type" style="' + FIELD + '">' +
        kinds.map(function (k) { return '<option value="' + k + '"' + (k === kindSel ? ' selected' : '') + '>' + esc(PC.kindLabel(k)) + '</option>'; }).join('') + '</select></div>' +
      '<div class="form-group' + (kindSel === 'change_order' ? '' : ' hidden') + '" id="pr-co-wrap"><label>Which change order?</label><select id="pr-co" style="' + FIELD + '"' + (claim ? ' disabled' : '') + '>' +
        cos.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === coSel ? ' selected' : '') + '>' + esc(c.coNumber || c.id) + ' · down payment ' + money(coDp(c)) + '</option>'; }).join('') + '</select>' +
        '<div id="pr-co-hint" style="font-size:11px;color:var(--text-muted);margin-top:3px">' + (cos.length ? 'The signed change order this down payment is for.' : 'No signed change order is waiting for a down payment on this job.') + '</div></div>' +
      '<div class="form-row"><div class="form-group"><label>Amount paid (₱)</label><input id="pr-amount" type="number" step="0.01" min="0" inputmode="decimal" style="' + FIELD + '" value="' + esc(claim ? String(claim.paymentReceived == null ? '' : claim.paymentReceived) : '') + '"/></div>' +
      '<div class="form-group"><label>Date paid</label><input id="pr-date" type="date" style="' + FIELD + '" value="' + esc(v0.paymentDate || window.today()) + '"/></div></div>' +
      '<div class="form-group"><label>Payment method</label><select id="pr-method" style="' + FIELD + '">' +
        methods.map(function (m) { return '<option' + (v0.paymentMethod === m ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') + '</select></div>' +
      '<div class="form-group"><label>VAT treatment</label><select id="pr-vat" style="' + FIELD + '">' +
        '<option value="inclusive"' + (vat0 === 'inclusive' ? ' selected' : '') + '>VAT-inclusive — 12% already in the amount</option>' +
        '<option value="exclusive"' + (vat0 === 'exclusive' ? ' selected' : '') + '>VAT-exclusive — add 12% on top</option>' +
        '<option value="exempt"' + (vat0 === 'exempt' ? ' selected' : '') + '>VAT-exempt / Zero-rated — no VAT</option></select>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:3px">Set from the order. Change it only if this payment differs.</div></div>' +
      '<div class="form-group"><label>Reference no. (bank or GCash reference, or the OR number from Finance)</label><input id="pr-ref" style="' + FIELD + '" value="' + esc(v0.orRef || '') + '"/></div>' +
      '<div class="card" style="margin:6px 0 12px"><div class="card-body" style="padding:8px 14px;font-size:12px;display:grid;grid-template-columns:1fr auto;gap:2px 12px">' +
        '<span style="color:var(--text-muted)">Recorded total</span><span id="pr-sum-rec" style="text-align:right;font-weight:700;color:var(--success)"></span>' +
        '<span style="color:var(--text-muted)">Net of VAT</span><span id="pr-sum-net" style="text-align:right"></span>' +
        '<span style="color:var(--text-muted)">Output VAT (12%)</span><span id="pr-sum-vat" style="text-align:right"></span>' +
        '<span style="color:var(--text-muted)">Balance after this</span><span id="pr-sum-bal" style="text-align:right;font-weight:700"></span></div></div>' +
      '<div class="form-group"><label>Receipt / proof of payment (required)</label>' +
        (claim && claim.receiptUrl ? '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Current proof: <a href="' + esc(window.safeHttpUrl ? window.safeHttpUrl(claim.receiptUrl) : claim.receiptUrl) + '" target="_blank" rel="noopener">' + esc(claim.receiptName || 'View') + '</a> — upload another only to replace it.</div>' : '') +
        '<div id="pr-upload"></div></div>' +
      '<div style="font-size:11px;color:var(--text-muted);margin:-4px 0 10px">The President confirms this payment in the app. A Payment Acknowledgement is ready after that.</div>' +
      '<div id="pr-err" class="error-msg hidden"></div>';
    const footer = '<button class="btn-primary" id="pr-save" style="' + BTN + '">' + (claim ? 'Save and send again' : 'Record payment — send to President') + '</button>' +
      '<button class="btn-secondary" onclick="closeModal()" style="' + BTN + '">Cancel</button>';
    const panel = window.openPage((claim ? 'Fix payment — ' : 'Record payment — ') + esc(order.clientName || ''), body, footer);
    const $ = function (id) { return panel.querySelector('#' + id); };
    let receipt = null;
    if (window.Drive && window.Drive.renderUploadArea) window.Drive.renderUploadArea('pr-upload', function (r) { receipt = r; }, { label: 'Upload receipt (photo/PDF)', accept: 'image/*,.pdf', dept: 'Finance', subfolder: 'Collections' });
    const pickedCo = function () { const id = ($('pr-co') && $('pr-co').value) || coSel; return cos.find(function (c) { return c.id === id; }) || null; };
    let amountTouched = !!claim;       // the amount is pre-filled from the change order's down payment until the person types their own
    const recompute = function () {
      const isCo = $('pr-type').value === 'change_order';
      const co = isCo ? pickedCo() : null;
      const val = PC.validateRecord({ kind: $('pr-type').value, entered: parseFloat($('pr-amount').value) || 0, vatTreatment: $('pr-vat').value, hasReceipt: true, project: project, fees: fees, changeOrder: co ? coPrice(co) : null });
      $('pr-sum-rec').textContent = money(val.recorded);
      $('pr-sum-net').textContent = money(val.net);
      $('pr-sum-vat').textContent = money(val.vat);
      $('pr-sum-bal').textContent = money(Math.max(0, (val.balanceDue || 0) - val.recorded));
      $('pr-due').textContent = isCo ? (co ? 'Down payment asked ' + money(coDp(co)) : 'No signed change order is waiting for a down payment') : 'Balance due ' + money(due0);
    };
    const onKind = function () {
      const isCo = $('pr-type').value === 'change_order';
      $('pr-co-wrap').classList.toggle('hidden', !isCo);
      const co = isCo ? pickedCo() : null;
      if (co && !amountTouched) $('pr-amount').value = String(coDp(co));
      recompute();
    };
    ['input', 'change'].forEach(function (ev) {
      $('pr-amount').addEventListener(ev, function () { amountTouched = true; recompute(); });
      $('pr-vat').addEventListener(ev, recompute); $('pr-type').addEventListener(ev, onKind); $('pr-co').addEventListener(ev, onKind);
    });
    recompute();

    let sending = false;
    $('pr-save').addEventListener('click', function () {
      return window.busy($('pr-save'), async function () {
        if (sending) return;
        const err = $('pr-err');
        const fail = function (m) { err.textContent = m; err.classList.remove('hidden'); };
        err.classList.add('hidden');
        if (parseInt($('pr-upload') && $('pr-upload').dataset.busy, 10) > 0) { toast('Wait for the upload to finish', 'error'); return; }
        const entered = parseFloat($('pr-amount').value) || 0;
        const kind = $('pr-type').value, vatTreatment = $('pr-vat').value, paymentMethod = $('pr-method').value;
        const orRef = String($('pr-ref').value || '').trim(), paymentDate = $('pr-date').value || window.today();
        const receiptUrl = (receipt && receipt.url) || (claim && claim.receiptUrl) || null;
        const receiptName = (receipt && receipt.name) || (claim && claim.receiptName) || null;
        // Fresh read: the balance may have moved (another payment confirmed, a contract change) while the sheet was open.
        let freshProject, freshFees;
        try { freshProject = await readDoc('job_projects', project.id); freshFees = await loadFees(order.clientId || project.clientId); }
        catch (ex) { fail('Could not check the balance — try again.'); return; }
        if (!freshProject) { fail('This job no longer exists.'); return; }
        // §5.7 C4: a change-order down payment names its change order (signed, asking for a down payment, not applied), re-read FRESH here.
        let freshCo = null;
        const coId = kind === 'change_order' ? ((claim && claim.changeOrderId) || ($('pr-co') && $('pr-co').value) || '') : '';
        if (kind === 'change_order') {
          if (!coId) { fail('Choose the signed change order this payment is for.'); return; }
          try { freshCo = await readDoc('change_orders', coId); } catch (ex) { fail('Could not check the change order — try again.'); return; }
          if (!freshCo || freshCo.status !== 'signed' || freshCo.appliedContractRev || freshCo.orderId !== order.id || !(coDp(freshCo) > 0)) { fail('That change order is no longer waiting for a down payment.'); return; }
        }
        const val = PC.validateRecord({ kind: kind, entered: entered, vatTreatment: vatTreatment, hasReceipt: !!receiptUrl, project: freshProject, fees: freshFees, changeOrder: freshCo ? coPrice(freshCo) : null });
        if (!val.ok) { fail(val.error + (val.error.indexOf('balance') >= 0 ? ' Balance due ' + money(val.balanceDue) + '.' : '')); return; }
        const vNow = viewer();
        const who = whoName();
        const nowIso = new Date().toISOString();
        sending = true;
        try {
          let id, resubmits = 0;
          if (claim) {
            const cur = await readDoc('payment_claims', claim.id);
            if (!cur || cur.status !== 'payment_rejected') { toast('This payment was already sent again or confirmed.', 'error'); sending = false; if (onDone) onDone(); return; }
            const pc = cur.paymentConfirm || {};
            resubmits = (Number(pc.resubmits) || 0) + 1;
            await fsDb().collection('payment_claims').doc(claim.id).update({
              kind: kind, paymentReceived: entered, paymentMethod: paymentMethod, vatTreatment: vatTreatment, orRef: orRef, paymentDate: paymentDate, receiptUrl: receiptUrl, receiptName: receiptName,
              status: 'pending',
              paymentConfirm: { requestedAt: nowIso, requestedBy: vNow.uid, requestedByName: who, decision: null, resubmits: resubmits, prevReason: pc.reason || '' },
              updatedAt: FV().serverTimestamp(),
            });
            id = claim.id;
            try { if (window.logAudit) window.logAudit('update', 'payment_claim', id, { resubmitted: true, paid: entered, resubmits: resubmits }); } catch (_) {}
          } else {
            const doc = {
              kind: kind, orderId: order.id, projectId: project.id, quoteNumber: order.quoteNumber || '', clientId: order.clientId || project.clientId || null,
              clientName: order.clientName || project.clientName || '', company: order.company || project.company || '', siteVisitId: null, changeOrderId: coId || null, area: null,
              paymentReceived: entered, paymentMethod: paymentMethod, vatTreatment: vatTreatment, orRef: orRef, paymentDate: paymentDate, receiptUrl: receiptUrl, receiptName: receiptName,
              status: 'pending',
              paymentConfirm: { requestedAt: nowIso, requestedBy: vNow.uid, requestedByName: who, decision: null, resubmits: 0 },
              createdBy: vNow.uid, createdByName: who, createdAt: FV().serverTimestamp(), updatedAt: FV().serverTimestamp(),
            };
            const ref = await fsDb().collection('payment_claims').add(doc);
            id = ref.id;
            try { if (window.logAudit) window.logAudit('create', 'payment_claim', id, { client: doc.clientName, kind: kind, paid: entered }); } catch (_) {}
          }
          // N1 (President) + FYI to Finance, as QF's rows with the claim id. A failed notification never fails the write.
          const client = order.clientName || '';
          const line = who + ': ' + client + ' — ' + money(val.recorded) + ' ' + PC.kindLabel(kind).toLowerCase() + ' by ' + paymentMethod + ' (' + (order.soNumber || order.quoteNumber || '') + ').';
          await step(function () { return window.Notifs.sendToOwner({ title: resubmits ? '💵 Payment corrected — please confirm' : '💵 Payment to confirm', body: resubmits ? line : line + ' Tap to confirm.', icon: '💵', type: 'payment_confirm', link: 'approvals', dedupKey: 'payconf-claim-' + id + '-' + resubmits }); });
          await step(function () { return window.Notifs.sendToDept('Finance', { title: '💵 Payment recorded — President to confirm', body: line + ' No action needed unless the President cannot be reached.', icon: '💵', type: 'payment_confirm', link: 'sales-orders', dedupKey: 'payfyi-claim-' + id + '-' + resubmits }); });
          invalidate();
          toast(claim ? 'Payment updated — sent to the President again' : 'Payment recorded — waiting for confirmation', 'success');
          if (onDone) onDone();
          // The President who recorded it confirms it in one more tap: REPLACE this page with the sheet (never close-then-open, see departments.js).
          if (vNow.isPresident) { await openConfirmSheet(Object.assign({ id: id }, claim || {}), onDone, { replace: true }); return; }
          window.closeModal();
        } catch (ex) { sending = false; fail('Failed: ' + (ex.message || ex.code)); }
      });
    });
  }

  // ── Confirm / send back (P-2, P-3) ─────────────────────────────────────────────────────────────────────────────
  const CONFIRM_MSG = {
    'not-allowed': 'You cannot confirm this payment.',
    'already-confirmed': 'This payment was already confirmed.',
    'not-pending': 'This payment was sent back to Sales. It must be sent again first.',
    'invalid-kind': 'This payment has no type.',
    'invalid-amount': 'This payment has no amount.',
    'missing-pa-number': 'The Payment Acknowledgement could not be numbered. Try again.',
    'no-project': 'This payment has no job.',
    'not-found': 'This payment no longer exists.',
  };

  function buildDeps(vNow, who, acct, paNumber) {
    const db = fsDb();
    return {
      getClaim: function (id) { return readDoc('payment_claims', id); },
      getProject: function (id) { return readDoc('job_projects', id); },
      getUncreditedFees: function (claim) { return loadFees(claim.clientId); },
      getChangeOrder: function (id) { return readDoc('change_orders', id); },
      ledgerPost: function (entry) { return window.Ledger.post(entry); },
      ledgerAmount: async function (ref) { const s = await db.collection('ledger').doc(window.Ledger._sanitize(ref)).get(); const n = s.exists ? Number(s.data().amount) : NaN; return Number.isFinite(n) ? n : null; },
      updateClaim: function (id, patch) { return db.collection('payment_claims').doc(id).update(patch); },
      sanitize: function (ref) { return window.Ledger._sanitize(ref); },
      union: function () { const f = FV(); return f.arrayUnion.apply(f, arguments); },
      serverTime: function () { return FV().serverTimestamp(); },
      ctx: { today: window.today(), nowIso: new Date().toISOString(), who: who, whoUid: vNow.uid, viewer: vNow, paNumber: paNumber, acct: acct, bankTag: window.BankAccounts.tag(acct, 'in') },
    };
  }

  async function openConfirmSheet(claimIn, onDone, opts) {
    onDone = onDone || function () {};
    if (!claimIn || !claimIn.id) return;
    try { await loadCore(); } catch (ex) { toast('Could not open the payment screen: ' + (ex.message || ex.code), 'error'); return; }
    const PC = window.PaymentClaims, SF = window.SalesFlow;
    const v0 = viewer();
    let o, project = null;
    try {
      o = await readDoc('payment_claims', claimIn.id);
      project = o && o.projectId ? await readDoc('job_projects', o.projectId) : null;
    } catch (ex) { toast('Could not read the payment: ' + (ex.message || ex.code), 'error'); return; }
    if (!o) { toast('This payment no longer exists.', 'error'); onDone(); return; }
    if (!SF.canConfirmPayment(o, v0)) { toast('You cannot confirm this payment.', 'error'); return; }
    if (o.status !== 'pending') { toast(o.status === 'recorded' ? 'This payment was already confirmed.' : 'This payment is not waiting for confirmation.', 'error'); onDone(); return; }
    const standIn = v0.isFinanceTier && !v0.isPresident;
    let accounts = [], bankOpts = '', saved = '';
    try { saved = localStorage.getItem('bi.payConfirm.bank') || ''; } catch (_) {}
    try {
      accounts = await window.BankAccounts.list();
      if (accounts.length) bankOpts = await window.BankAccounts.optionsHTML(saved);
    } catch (e) { toast('Could not load the company bank accounts — check your connection and try again.', 'error'); return; }
    const hasBanks = accounts.length > 0;
    let coDue = null;
    if (o.kind === 'change_order' && o.changeOrderId) { try { const co = await readDoc('change_orders', o.changeOrderId); if (co && co.status !== 'applied' && !co.appliedContractRev) coDue = { price: co.pricing && co.pricing.price }; } catch (_) { coDue = null; } }
    const val = PC.validateRecord({ kind: o.kind, entered: o.paymentReceived, vatTreatment: o.vatTreatment || 'inclusive', hasReceipt: true, project: project, fees: await loadFees(o.clientId), changeOrder: coDue });
    const pc = o.paymentConfirm || {};
    const body =
      (standIn ? '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">The President normally confirms payments. Confirm only if he cannot be reached. He will be told that you confirmed it.</div>' : '') +
      '<div style="margin-bottom:12px"><div style="font-size:22px;font-weight:700">' + money(val.recorded) + '</div>' +
      '<div style="font-size:12px;color:var(--text-muted)">' + esc(PC.kindLabel(o.kind)) + ' · ' + esc(o.paymentMethod || '') + ' · paid ' + esc(o.paymentDate || '—') + ' · ref ' + esc(o.orRef || '—') + '</div></div>' +
      '<div style="font-size:12px;display:grid;gap:6px;margin-bottom:12px">' +
        '<div>' + esc(o.clientName || '') + (project ? ' · contract ' + money(project.contractAmount) + ' · balance due ' + money(val.balanceDue) + ' · balance after ' + money(Math.max(0, (val.balanceDue || 0) - val.recorded)) : '') + '</div>' +
        '<div>Net ' + money(val.net) + ' · VAT ' + money(val.vat) + ' (' + esc(o.vatTreatment || 'inclusive') + ')</div>' +
        '<div>Recorded by ' + esc(o.createdByName || '') + (pc.requestedAt ? ' · ' + esc(fmtWhen(pc.requestedAt)) : '') + '</div>' +
        ((Number(pc.resubmits) || 0) > 0 ? '<div style="color:var(--warning)">Sent again — earlier reason: ' + esc(pc.prevReason || '—') + '</div>' : '') + '</div>' +
      (o.receiptUrl ? '<div style="margin-bottom:12px"><a class="btn-secondary btn-sm" target="_blank" rel="noopener" href="' + esc(window.safeHttpUrl ? window.safeHttpUrl(o.receiptUrl) : o.receiptUrl) + '">View receipt</a></div>' : '') +
      (hasBanks ? '<div class="form-group"><label>Deposited to</label><select id="pcc-bank" style="' + FIELD + '">' + bankOpts + '</select></div>' : '') +
      '<div id="pcc-err" class="error-msg hidden"></div>';
    const footer = '<button class="btn-success" id="pcc-confirm" style="' + BTN + '">Confirm payment</button><button class="btn-secondary" id="pcc-reject" style="' + BTN + '">Send back</button><button class="btn-secondary" onclick="closeModal()" style="' + BTN + '">Close</button>';
    const panel = window.openPage('Confirm payment — ' + esc(o.clientName || ''), body, footer, opts);
    const $ = function (id) { return panel.querySelector('#' + id); };
    $('pcc-reject').addEventListener('click', async function () { if (await rejectClaim(o, onDone)) window.closeModal(); });
    $('pcc-confirm').addEventListener('click', function () {
      return window.busy($('pcc-confirm'), async function () {
        const err = $('pcc-err');
        const fail = function (m) { err.textContent = m; err.classList.remove('hidden'); };
        err.classList.add('hidden');
        const vNow = viewer();
        if (!SF.canConfirmPayment(o, vNow)) { toast('You cannot confirm this payment.', 'error'); return; }
        const sel = hasBanks ? (($('pcc-bank') && $('pcc-bank').value) || '') : '';
        if (hasBanks && !sel) { fail('Select the company account that received this payment.'); return; }
        // A fresh read before a number is taken: a second tap on a confirmed claim must not burn a Payment Acknowledgement number.
        let fresh;
        try { fresh = await readDoc('payment_claims', o.id); } catch (ex) { fail('Could not read the payment — try again.'); return; }
        if (!fresh) { toast('This payment no longer exists.', 'error'); onDone(); return; }
        if (fresh.status === 'recorded') { window.closeModal(); toast('This payment was already confirmed.', 'error'); onDone(); return; }
        if (fresh.status !== 'pending') { toast('This payment is not waiting for confirmation.', 'error'); onDone(); return; }
        const acct = await window.BankAccounts.pick(sel);
        if (sel) { try { localStorage.setItem('bi.payConfirm.bank', sel); } catch (_) {} }
        const who = whoName();
        let paNumber = fresh.paNumber || '';
        if (!paNumber) {
          try { const F = await window.flowForms(); paNumber = await F.nextNumber('PA'); } catch (ex) { paNumber = ''; }
          if (!paNumber) { fail(CONFIRM_MSG['missing-pa-number']); return; }
        }
        let res;
        try { res = await PC.runConfirmation(o.id, buildDeps(vNow, who, acct, paNumber)); }
        catch (ex) { fail('Failed: ' + (ex.message || ex.code)); return; }
        if (res.ok) {   // posted | repaired
          await afterConfirm(o, res, vNow, who);
          window.closeModal();
          toast(res.code === 'posted' ? 'Payment confirmed and posted to the ledger' : 'Already in the ledger — payment marked confirmed', 'success');
          onDone();
          return;
        }
        if (res.code === 'over-balance') { fail('The payment is more than the balance due (' + money(res.balanceDue) + '). Send it back so Sales can correct it.'); return; }
        if (res.code === 'already-confirmed' || res.code === 'not-pending') { if (res.code === 'already-confirmed') window.closeModal(); toast(CONFIRM_MSG[res.code], 'error'); onDone(); return; }
        toast(CONFIRM_MSG[res.code] || 'This payment cannot be confirmed here.', 'error');
      });
    });
  }

  // §12 — to the person who recorded it, Finance (FYI) and Neil when a stand-in acted. NEVER Production. Each step on its own.
  async function afterConfirm(o, res, vNow, who) {
    const N = window.Notifs;
    const client = o.clientName || '';
    const label = window.PaymentClaims.kindLabel(o.kind);
    const amt = window.fmtN2 ? window.fmtN2(res.amount) : String(res.amount);
    const whoLabel = vNow.isPresident ? 'the President' : 'Finance (' + who + ')';
    if (res.code === 'posted') await step(async function () { if (window.logAudit) window.logAudit('create', 'ledger', window.Ledger._sanitize('PAY-' + o.id), { source: 'payment_claim', amount: res.amount, client: client, confirmedByRole: vNow.isPresident ? 'president' : 'finance' }); });
    await step(async function () { if (o.createdBy && o.createdBy !== vNow.uid) await N.send(o.createdBy, { title: '✅ Payment confirmed', body: client + ' — ₱' + amt + ' (' + label + ') confirmed by ' + whoLabel + '. The Payment Acknowledgement is ready.', icon: '✅', type: 'payment_confirmed', link: 'sales-orders', dedupKey: 'payok-claim-' + o.id }); });
    await step(async function () { await N.sendToDept('Finance', { title: '💵 Payment confirmed', body: client + ' — ₱' + amt + ' (' + label + ') confirmed by ' + whoLabel + ' and posted to the ledger. No action needed.', icon: '💵', type: 'payment_confirmed', link: 'sales-orders', dedupKey: 'payfin-claim-' + o.id }); });
    await step(async function () { if (!vNow.isPresident) await N.sendToOwner({ title: '✅ Payment confirmed by ' + who + ' (Finance)', body: client + ' — ₱' + amt + ' (' + label + '), recorded by ' + (o.createdByName || '') + '. Confirmed in your place and posted to the ledger.', icon: '✅', type: 'payment_confirmed', link: 'sales-orders', dedupKey: 'payown-claim-' + o.id }); });
    // V3 (spec §5.6): a confirmed site-visit fee books its visit and tells Production (date, address, contact; NO amount). That notification is sent from js/screens/site-visits.js.
    await step(async function () { if (o.kind === 'site_visit' && o.siteVisitId) { await window.ensureScript('js/screens/site-visits.js'); await window.SiteVisits.afterFeeConfirmed(o); } });
    // J9 (spec §5.4, §13.2 Phase 4): a confirmed payment can settle a COMPLETED job, which then closes by itself. Last, best-effort, never undoes the post.
    await step(async function () { if (o.projectId) { await window.ensureScript('js/screens/flow-docs.js'); await window.FlowDocs.closeIfSettled(o.projectId, who); } });
    invalidate();
  }

  // Send back (P-3): nothing is written to the ledger or the job. Resolves true when the payment was sent back.
  async function rejectClaim(o, onDone) {
    onDone = onDone || function () {};
    const SF = window.SalesFlow;
    const vNow = viewer();
    if (!SF.canConfirmPayment(o, vNow)) { toast('You cannot send this payment back.', 'error'); return false; }
    const reason = await window.promptDialog({ title: 'Send payment back', message: 'Tell Sales what to fix.', placeholder: 'e.g. amount does not match the receipt', required: true, multiline: true, confirmLabel: 'Send back' });
    if (reason == null || !String(reason).trim()) return false;
    try {
      const ref = fsDb().collection('payment_claims').doc(o.id);
      const snap = await ref.get();
      if (!snap.exists) { toast('This payment no longer exists.', 'error'); onDone(); return false; }
      const cur = snap.data();
      if (cur.status === 'recorded') { toast('Already confirmed — it cannot be sent back.', 'error'); onDone(); return false; }
      if (cur.status !== 'pending') { toast('This payment is not waiting for confirmation.', 'error'); onDone(); return false; }
      const who = whoName();
      const why = String(reason).trim();
      const pcur = cur.paymentConfirm || {};
      await ref.update({ status: 'payment_rejected', paymentConfirm: Object.assign({}, pcur, { decision: 'rejected', reason: why }, SF.decisionStamp(vNow, who, new Date().toISOString())), updatedAt: FV().serverTimestamp() });
      try { if (window.logAudit) window.logAudit('update', 'payment_claim', o.id, { paymentRejected: true }); } catch (_) {}
      const resubmits = Number(pcur.resubmits) || 0;
      const whoLabel = vNow.isPresident ? 'the President' : 'Finance (' + who + ')';
      const client = cur.clientName || o.clientName || '';
      const amt = money(shownAmount(cur));
      await step(async function () { if (cur.createdBy && cur.createdBy !== vNow.uid) await window.Notifs.send(cur.createdBy, { title: '↩️ Payment sent back', body: client + ', sent back by ' + whoLabel + ': ' + why, icon: '↩️', type: 'payment_rejected', link: 'sales-orders', dedupKey: 'payrej-claim-' + o.id + '-' + resubmits }); });
      await step(async function () { if (!vNow.isPresident) await window.Notifs.sendToOwner({ title: '↩️ Payment sent back by ' + who + ' (Finance)', body: client + ' — ' + amt + ': ' + why, icon: '↩️', type: 'payment_rejected', link: 'sales-orders', dedupKey: 'payrejown-claim-' + o.id + '-' + resubmits }); });
      invalidate();
      toast('Sent back to Sales', 'success');
      onDone();
      return true;
    } catch (ex) { toast('Could not send it back: ' + (ex.message || ex.code), 'error'); return false; }
  }

  // ── lists ──────────────────────────────────────────────────────────────────────────────────────────────────────
  async function pendingClaims() {
    const snap = await fsDb().collection('payment_claims').where('status', '==', 'pending').get();
    return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); })
      .sort(function (a, b) { return ((b.createdAt && b.createdAt.seconds) || 0) - ((a.createdAt && a.createdAt.seconds) || 0); });
  }

  // Approvals: the President's one-tap list, or Finance's stand-in list, of balance / progress / change-order payments. Gates itself; empty on any failure.
  async function renderDecisionBlock(host, opts) {
    if (!host) return;
    opts = opts || {};
    const v = viewer();
    if (!v.isPresident && !v.isFinanceTier) { host.innerHTML = ''; return; }
    try { await loadCore(); } catch (_) { host.innerHTML = ''; return; }
    const PC = window.PaymentClaims, SF = window.SalesFlow;
    let all;
    try { all = await pendingClaims(); } catch (e) { host.innerHTML = ''; return; }
    const list = all.filter(function (c) { return PC.kindLabel(c.kind) && SF.canConfirmPayment(c, v); });
    if (!list.length) { host.innerHTML = ''; return; }
    const standIn = v.isFinanceTier && !v.isPresident;
    const again = opts.onDone || function () { renderDecisionBlock(host, opts); };
    host.innerHTML = '<div class="card" style="margin-bottom:12px;border:1.5px solid var(--warning)">' +
      '<div class="card-header" style="display:flex;justify-content:space-between;align-items:center"><h3 style="font-size:13px">💵 Later payments to confirm' + (standIn ? ' — President\'s stand-in' : '') + '</h3><span class="badge badge-orange">' + list.length + '</span></div>' +
      '<div class="card-body" style="display:flex;flex-direction:column;gap:8px">' +
      (standIn ? '<div style="font-size:12px;color:var(--text-muted)">The President normally confirms payments. Confirm only if he cannot be reached. He will be told that you confirmed it.</div>' : '') +
      list.map(function (c) {
        return '<div class="item-card pcu-item"><div class="item-title" style="font-size:13px">' + esc(c.clientName || '') + ' — ' + esc(c.quoteNumber || c.svNumber || '') + '</div>' +
          '<div class="item-meta" style="margin-top:4px"><span>' + money(shownAmount(c)) + '</span><span>' + esc(PC.kindLabel(c.kind)) + '</span><span>' + esc(c.paymentMethod || '') + '</span><span>recorded by ' + esc(c.createdByName || '') + '</span><span>' + esc(c.paymentDate || '') + '</span></div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button class="btn-success btn-sm pcu-open" data-id="' + esc(c.id) + '" style="' + BTN + '">Confirm payment</button>' +
          '<button class="btn-secondary btn-sm pcu-back" data-id="' + esc(c.id) + '" style="' + BTN + '">Send back</button></div></div>';
      }).join('') + '</div></div>';
    const find = function (b) { return list.find(function (x) { return x.id === b.dataset.id; }); };
    host.querySelectorAll('.pcu-open').forEach(function (b) { b.addEventListener('click', function () { const c = find(b); if (c) openConfirmSheet(c, again); }); });
    host.querySelectorAll('.pcu-back').forEach(function (b) { b.addEventListener('click', function () { const c = find(b); if (c) rejectClaim(c, again); }); });
  }

  // ── a job's payment lines (Sales Orders row and the job's Money panel) ───────────────────────────────────────────
  async function claimsForOrder(orderId) {
    const snap = await fsDb().collection('payment_claims').where('orderId', '==', orderId).orderBy('createdAt', 'asc').get();
    return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
  }
  const STATE = {
    pending: { cls: 'badge-orange', label: 'Awaiting confirmation' },
    recorded: { cls: 'badge-green', label: 'Confirmed' },
    payment_rejected: { cls: 'badge-red', label: 'Sent back' },
  };
  async function formsApi() { try { return await window.flowForms(); } catch (_) { return null; } }
  function claimLineHtml(c, F, v) {
    const PC = window.PaymentClaims, SF = window.SalesFlow;
    const st = STATE[c.status] || { cls: 'badge-blue', label: String(c.status || '') };
    const pc = c.paymentConfirm || {};
    let paBtn = '';
    try { if (F && c.status === 'recorded') paBtn = String(F.buttonHtml('payment_ack', { claimId: c.id, orderId: c.orderId, projectId: c.projectId }, { label: 'Payment Acknowledgement' }) || ''); } catch (_) { paBtn = ''; }
    const mine = !!v.uid && c.createdBy === v.uid;
    const canFix = c.status === 'payment_rejected' && (mine || isSalesActor() || v.isPresident) && (window.currentRole || '') !== 'secretary';
    const canConfirm = c.status === 'pending' && SF.canConfirmPayment(c, v);
    return '<div class="pcu-line" data-id="' + esc(c.id) + '" style="font-size:12px;padding:6px 0;border-top:1px solid var(--border);overflow-wrap:anywhere">' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><strong>' + esc(PC.kindLabel(c.kind) || 'Payment') + '</strong> ' + money(shownAmount(c)) + ' <span class="badge ' + st.cls + '" style="font-size:10px">' + esc(st.label) + '</span>' +
        (c.paNumber ? '<span style="color:var(--text-muted)">' + esc(c.paNumber) + '</span>' : '') + '</div>' +
      '<div style="color:var(--text-muted)">' + esc(c.paymentMethod || '') + (c.paymentDate ? ' · ' + esc(c.paymentDate) : '') + (c.createdByName ? ' · ' + esc(c.createdByName) : '') +
        (c.status === 'recorded' && pc.onBehalf ? ' · confirmed by ' + esc(pc.decidedByName || '') + ' (Finance)' : '') + '</div>' +
      (c.status === 'payment_rejected' ? '<div style="color:var(--danger)">' + esc(pc.reason || '') + '</div>' : '') +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">' + paBtn +
        (canConfirm ? '<button type="button" class="btn-success btn-sm pcu-line-confirm" data-id="' + esc(c.id) + '" style="' + BTN + '">Confirm payment</button>' : '') +
        (canFix ? '<button type="button" class="btn-primary btn-sm pcu-line-fix" data-id="' + esc(c.id) + '" style="' + BTN + '">Fix &amp; resend</button>' : '') + '</div></div>';
  }
  function bindLines(el, claims, F, rerender) {
    try { if (F && typeof F.bind === 'function') F.bind(el); } catch (_) {}
    const find = function (b) { return claims.find(function (x) { return x.id === b.dataset.id; }); };
    el.querySelectorAll('.pcu-line-confirm').forEach(function (b) { b.addEventListener('click', function (ev) { ev.stopPropagation(); const c = find(b); if (c) openConfirmSheet(c, rerender); }); });
    el.querySelectorAll('.pcu-line-fix').forEach(function (b) { b.addEventListener('click', function (ev) { ev.stopPropagation(); const c = find(b); if (c) openRecordSheet({ claim: c }, rerender); }); });
  }

  // Sales Orders page: fills every `.so-claims[data-id]` under `root` from ONE read of payment_claims. Silent on any failure.
  async function fillClaims(root, orders, rerender) {
    const hosts = root.querySelectorAll('.so-claims');
    if (!hosts.length) return;
    try { await loadCore(); } catch (_) { return; }
    let snap;
    try { snap = await fsDb().collection('payment_claims').orderBy('createdAt', 'asc').get(); } catch (_) { return; }
    const all = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
    const F = await formsApi();
    const v = viewer();
    hosts.forEach(function (el) {
      const mine = all.filter(function (c) { return c.orderId === el.dataset.id && window.PaymentClaims.kindLabel(c.kind) && c.kind !== 'site_visit'; });
      if (!mine.length) { el.innerHTML = ''; return; }
      el.innerHTML = '<div style="margin-top:6px;max-width:300px;white-space:normal">' + mine.map(function (c) { return claimLineHtml(c, F, v); }).join('') + '</div>';
      bindLines(el, mine, F, rerender);
    });
  }

  // Job detail, Money panel: the order's first payment + its claims, each with its state and PA button, and "Record payment". Silent on any failure.
  async function renderJobPayments(host, project, rerender) {
    if (!host || !project || !project.salesOrderId) return;
    try {
      await loadCore();
      const PC = window.PaymentClaims;
      const v = viewer();
      const order = await readDoc('sales_orders', project.salesOrderId);
      if (!order || order.flowVersion !== 2) return;
      let claims = [];
      try { claims = (await claimsForOrder(order.id)).filter(function (c) { return PC.kindLabel(c.kind) && c.kind !== 'site_visit'; }); } catch (_) { claims = []; }
      const F = await formsApi();
      let first = '';
      try { if (F && order.status === 'recorded') first = String(F.buttonHtml('payment_ack', { orderId: order.id, projectId: project.id }, { label: 'Payment Acknowledgement' }) || ''); } catch (_) { first = ''; }
      const due = PC.balanceDue(project, []);
      const showRecord = order.status === 'recorded' && due > 0 && project.stage !== 'cancelled' && canRecord(v);
      host.innerHTML = '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:8px 0 4px">💵 Payments</div>' +
        '<div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:8px 12px;font-size:12px">' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><strong>Down payment</strong> ' + money(order.recordedAmount || order.paymentReceived || 0) + ' <span class="badge ' + (order.status === 'recorded' ? 'badge-green' : 'badge-orange') + '" style="font-size:10px">' + (order.status === 'recorded' ? 'Confirmed' : 'Awaiting confirmation') + '</span>' + first + '</div>' +
        claims.map(function (c) { return claimLineHtml(c, F, v); }).join('') +
        '<div style="margin-top:6px">Balance due <strong>' + money(due) + '</strong></div>' +
        (showRecord ? '<div style="margin-top:6px"><button type="button" class="btn-primary btn-sm pcu-record" style="' + BTN + '">Record payment</button></div>' : '') +
        '</div></div>';
      bindLines(host, claims, F, rerender);
      const rb = host.querySelector('.pcu-record');
      if (rb) rb.addEventListener('click', function () { openRecordSheet({ orderId: order.id }, rerender); });
    } catch (_) { /* silent: the job still opens */ }
  }

  window.PaymentClaimsUI = {
    openRecordSheet: openRecordSheet, openConfirmSheet: openConfirmSheet, rejectClaim: rejectClaim,
    renderDecisionBlock: renderDecisionBlock, pendingClaims: pendingClaims, fillClaims: fillClaims, renderJobPayments: renderJobPayments,
    claimLineHtml: claimLineHtml, shownAmount: shownAmount, canRecord: canRecord,
  };
})();
