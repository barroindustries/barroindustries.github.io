// ═══════════════════════════════════════════════════════════════════════════
//  js/screens/site-visits.js — site visits and their fee (specs/SALES-FLOW-SPEC-2026-11-19.md §5.6 V1–V5, §9.9, §9.10, §12; Phase 5).
//
//  LAZY: loaded through window.ensureScript('js/screens/site-visits.js') by the hooks on the lead card (departments.js renderClientProfiles), the quote
//  card (sales.js), the Production page (production.js) and by js/payment-claims-ui.js (after a fee is confirmed). It is NOT in index.html's app-kit; it is
//  in sw.js PRECACHE. It loads js/flow-core.js (the tariff, the rules and the words) and, for a fee, js/payment-claims-core.js on demand.
//
//    V1  openRequestSheet(arg)      Sales / the President, from a lead or a quote  → site_visits doc, status 'requested', svNumber from Forms.nextNumber('SV').
//    V2  openFeeSheet(visit)        Sales / the President: the fee as a payment_claims doc (kind 'site_visit', pending) with proof; visit → 'fee_pending'.
//                                   The amount is the tariff; only the President can change it (SF21).
//    V3  afterFeeConfirmed(claim)   called by payment-claims-ui once the President (or a stand-in) CONFIRMS the claim: visit → 'booked', Production told.
//    V4  renderProductionList(host) + openReportSheet(visit)   booked visits on the Production page; Rene writes the report → status 'done'.
//        cancelVisit(visit)         Sales may cancel a requested / fee_pending visit.
//        fillSlots(root)            the visits of each lead / quote card (.sv-slot[data-client-id | data-quote-id]) with their status and buttons.
//
//  THE PESO WALL. site_visits has no peso field (the rules refuse fee / amount / paymentReceived / recordedAmount on it): the fee lives on its payment
//  claim, which Production cannot read. The notification to Production and everything on the Production page carry no amount. Production never reads
//  payment_claims from here: only Sales-side code (the fee sheet, the card slots) does.
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
  const step = async function (fn) { try { await fn(); } catch (e) { try { console.warn('[site visits] follow-up failed', e); } catch (_) {} } };
  const STATUS_BADGE = { requested: 'badge-blue', fee_pending: 'badge-orange', booked: 'badge-green', done: 'badge-gray', cancelled: 'badge-red' };

  function whoName() { return (window.userProfile && window.userProfile.displayName) || (window.currentUser && window.currentUser.email) || ''; }
  function myUid() { return (window.currentUser && window.currentUser.uid) || ''; }
  function isPresident() { return typeof window.isRealPresident === 'function' && window.isRealPresident(); }
  function isSalesActor() { return typeof window.canEditDept === 'function' && window.canEditDept('Sales') && (window.currentRole || '') !== 'secretary'; }
  // V1 / V2 / cancel: Sales members and the President. The Corporate Secretary never writes these.
  function canRequest() { return (window.currentRole || '') !== 'secretary' && (isPresident() || isSalesActor()); }
  // V4: any staff profile may write the report (the rules let any non-secretary staff write site_visits).
  function canWriteReport() { return !!window.currentRole && window.currentRole !== 'secretary'; }
  // May this viewer read payment_claims (Sales, the books tier, the President — firestore.rules)? Production cannot: nothing here asks it to.
  function seesPayments() {
    const role = window.currentRole || '';
    return role !== 'secretary' && (canRequest() || role === 'finance' || role === 'manager' || role === 'president' || (window.currentDepts || []).indexOf('Finance') >= 0);
  }

  async function loadCore() {
    await window.ensureScript('js/flow-core.js');
    if (!window.FlowCore) throw new Error('The flow engine did not load.');
  }
  async function readDoc(coll, id) {
    const s = await fsDb().collection(coll).doc(id).get();
    return s.exists ? Object.assign({ id: s.id }, s.data()) : null;
  }
  function invalidate() {
    if (typeof window.dbCacheInvalidate === 'function') ['site_visits', 'payment_claims', 'approvals-pending:payment_claims-pending'].forEach(function (k) { try { window.dbCacheInvalidate(k); } catch (_) {} });
  }
  async function formsApi() { try { return typeof window.flowForms === 'function' ? await window.flowForms() : null; } catch (_) { return null; } }
  const niceDate = function (iso) {
    try { return new Date(String(iso) + 'T12:00:00+08:00').toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', day: 'numeric', month: 'short', year: 'numeric' }); } catch (_) { return String(iso || ''); }
  };

  // ═══ V1 — request a visit ═══════════════════════════════════════════════════════════════════════════════════════════════════
  // arg = { client?: { id, name, company, address, phone }, quote?: { id, coll, quoteNumber, clientId, clientName, clientAddress, clientPhone, company } }. Never throws.
  async function openRequestSheet(arg, onDone) {
    if (!canRequest()) { toast('Only Sales or the President can request a site visit.', 'error'); return; }
    try { await loadCore(); } catch (ex) { toast('Could not open the site visit screen: ' + (ex.message || ex.code), 'error'); return; }
    const FC = window.FlowCore;
    arg = arg || {};
    const q = arg.quote || null;
    let client = arg.client || null;
    const clientName = String((client && client.name) || (q && q.clientName) || '').trim();
    if (!clientName) { toast('Choose a client first.', 'error'); return; }
    let clientId = (client && client.id) || (q && q.clientId) || null;
    // A quote filed without a client link: find the client by name, so the fee can be credited to the job later (V5).
    if (!clientId && window.Clients && typeof window.Clients.findByName === 'function') { try { const c = await window.Clients.findByName(clientName); if (c) { clientId = c.id; client = client || c; } } catch (_) {} }
    const company = (q && q.company) || 'BK';              // the quote's company; a lead has none yet, and the Sales book is Barro Kitchens'
    const body =
      '<div style="font-size:12px;margin-bottom:10px;overflow-wrap:anywhere"><strong>' + esc(clientName) + '</strong>' + (q && q.quoteNumber ? ' · quote ' + esc(q.quoteNumber) : '') + '</div>' +
      '<div class="form-group"><label>Area of the visit</label><select id="sv-area" style="' + FIELD + '"><option value="">Choose the area…</option>' +
        FC.SITE_VISIT_AREAS.map(function (a) { return '<option value="' + esc(a.key) + '">' + esc(a.label) + ' — ' + money(FC.siteVisitFee(a.key)) + '</option>'; }).join('') + '</select>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:3px">The fee is paid before the visit and is credited if the client goes ahead with the job.</div></div>' +
      '<div class="form-group"><label>Date of the visit</label><input id="sv-date" type="date" style="' + FIELD + '" value="' + esc(window.today ? window.today() : '') + '"/></div>' +
      '<div class="form-group"><label>Site address</label><input id="sv-address" type="text" autocomplete="off" style="' + FIELD + '" value="' + esc((client && client.address) || (q && q.clientAddress) || '') + '"/></div>' +
      '<div class="form-row"><div class="form-group"><label>Contact person at the site</label><input id="sv-person" type="text" autocomplete="off" style="' + FIELD + '" value="' + esc((client && client.name) || (q && q.clientName) || '') + '"/></div>' +
      '<div class="form-group"><label>Contact phone</label><input id="sv-phone" type="tel" autocomplete="off" style="' + FIELD + '" value="' + esc((client && client.phone) || (q && q.clientPhone) || '') + '"/></div></div>' +
      '<div class="form-group"><label>Notes (optional — no prices)</label><textarea id="sv-notes" rows="3" style="' + FIELD + '"></textarea></div>' +
      '<div id="sv-err" class="error-msg hidden"></div>';
    const footer = '<button class="btn-primary" id="sv-save" style="' + BTN + '">Request site visit</button><button class="btn-secondary" onclick="closeModal()" style="' + BTN + '">Cancel</button>';
    const panel = window.openPage('Request site visit — ' + esc(clientName), body, footer);
    const $ = function (id) { return panel.querySelector('#' + id); };
    let saving = false;
    $('sv-save').addEventListener('click', function () {
      return window.busy($('sv-save'), async function () {
        if (saving) return;
        const err = $('sv-err');
        const fail = function (m) { saving = false; err.textContent = m; err.classList.remove('hidden'); };
        err.classList.add('hidden');
        const val = FC.validateVisitRequest({ area: $('sv-area').value, requestedDate: $('sv-date').value, address: $('sv-address').value, contactPerson: $('sv-person').value, contactPhone: $('sv-phone').value, notes: $('sv-notes').value }, { today: window.today() });
        if (!val.ok) { fail(val.error); return; }
        const v = val.visit;
        saving = true;
        try {
          let svNumber = '';
          try { const F = await formsApi(); if (F) svNumber = await F.nextNumber('SV'); } catch (_) { svNumber = ''; }
          const doc = Object.assign({}, v, {
            svNumber: svNumber, clientId: clientId || null, clientName: clientName, company: company,
            quoteId: q ? q.id || null : null, quoteColl: q ? q.coll || null : null, quoteNumber: q ? q.quoteNumber || '' : '',
            visitDate: v.requestedDate, status: 'requested', feeClaimId: null, report: null,
            requestedBy: myUid(), requestedByName: whoName(), requestedAt: FV().serverTimestamp(), updatedAt: FV().serverTimestamp(),
          });
          const ref = await fsDb().collection('site_visits').add(doc);
          // No number (the counter was unreachable): the stored fallback is the one the form prints, 'SV-' + the last six characters of the id.
          if (!svNumber) { svNumber = 'SV-' + FC.last6(ref.id); await step(function () { return fsDb().collection('site_visits').doc(ref.id).update({ svNumber: svNumber }); }); }
          try { if (window.logAudit) window.logAudit('create', 'site_visit', ref.id, { client: clientName, area: v.area }); } catch (_) {}
          invalidate();
          window.closeModal();
          toast('Site visit ' + svNumber + ' requested. Record the fee when the client pays.', 'success');
          if (onDone) onDone();
        } catch (ex) { fail('Failed: ' + (ex.message || ex.code)); }
      });
    });
  }

  // ═══ V2 — record the fee ═══════════════════════════════════════════════════════════════════════════════════════════════════
  // The fee is a payment_claims doc, kind 'site_visit'. It carries clientId (so the first balance claim credits it, V5) and siteVisitId.
  async function openFeeSheet(visitIn, onDone) {
    if (!canRequest()) { toast('Only Sales or the President can record a site-visit fee.', 'error'); return; }
    try { await loadCore(); await window.ensureScript('js/payment-claims-core.js'); } catch (ex) { toast('Could not open the payment screen: ' + (ex.message || ex.code), 'error'); return; }
    const FC = window.FlowCore, PC = window.PaymentClaims;
    if (!visitIn || !visitIn.id || !PC) return;
    let visit, claim = null;
    try {
      visit = await readDoc('site_visits', visitIn.id);
      if (visit && visit.feeClaimId) claim = await readDoc('payment_claims', visit.feeClaimId);
    } catch (ex) { toast('Could not read the site visit: ' + (ex.message || ex.code), 'error'); return; }
    if (!visit) { toast('This site visit no longer exists.', 'error'); return; }
    const fixing = !!claim && claim.status === 'payment_rejected';
    if (!(visit.status === 'requested' || (visit.status === 'fee_pending' && fixing))) {
      toast(visit.status === 'fee_pending' ? 'The fee is already waiting for confirmation.' : 'The fee cannot be recorded for a ' + FC.visitStatusWord(visit.status).toLowerCase() + ' visit.', 'error');
      if (onDone) onDone();
      return;
    }
    const tariff = FC.siteVisitFee(visit.area);
    if (tariff === null) { toast('This visit has no area, so it has no fee.', 'error'); return; }
    const pres = isPresident();
    const c0 = claim || {};
    const methods = ['Bank Transfer', 'GCash', 'Cash', 'Cheque', 'Other'];
    const pcr = (claim && claim.paymentConfirm) || {};
    const body =
      (fixing ? '<div style="font-size:12px;color:var(--danger);margin-bottom:10px;overflow-wrap:anywhere">Sent back by ' + esc(pcr.decidedByName || '') + ': ' + esc(pcr.reason || '') + '</div>' : '') +
      '<div style="font-size:12px;margin-bottom:10px;overflow-wrap:anywhere"><strong>' + esc(visit.clientName || '') + '</strong> · ' + esc(visit.svNumber || '') + ' · ' + esc(FC.areaLabel(visit.area)) + '</div>' +
      '<div style="font-size:15px;font-weight:700;margin-bottom:12px">Site-visit fee ' + money(tariff) + '</div>' +
      '<div class="form-row"><div class="form-group"><label>Amount paid (₱)</label><input id="svf-amount" type="number" step="0.01" min="0" inputmode="decimal" style="' + FIELD + '" value="' + esc(String(fixing && claim.paymentReceived != null ? claim.paymentReceived : tariff)) + '"' + (pres ? '' : ' readonly') + '/>' +
        (pres ? '' : '<div style="font-size:11px;color:var(--text-muted);margin-top:3px">The fee is fixed by area. Only the President can change it.</div>') + '</div>' +
      '<div class="form-group"><label>Date paid</label><input id="svf-date" type="date" style="' + FIELD + '" value="' + esc(c0.paymentDate || window.today()) + '"/></div></div>' +
      '<div class="form-group"><label>Date of the visit</label><input id="svf-visit" type="date" style="' + FIELD + '" value="' + esc(visit.visitDate || visit.requestedDate || '') + '"/></div>' +
      '<div class="form-group"><label>Payment method</label><select id="svf-method" style="' + FIELD + '">' + methods.map(function (m) { return '<option' + (c0.paymentMethod === m ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') + '</select></div>' +
      '<div class="form-group"><label>VAT treatment</label><select id="svf-vat" style="' + FIELD + '">' +
        '<option value="inclusive"' + ((c0.vatTreatment || 'inclusive') === 'inclusive' ? ' selected' : '') + '>VAT-inclusive — 12% already in the amount</option>' +
        '<option value="exclusive"' + (c0.vatTreatment === 'exclusive' ? ' selected' : '') + '>VAT-exclusive — add 12% on top</option>' +
        '<option value="exempt"' + (c0.vatTreatment === 'exempt' ? ' selected' : '') + '>VAT-exempt / Zero-rated — no VAT</option></select></div>' +
      '<div class="form-group"><label>Reference no. (bank or GCash reference, or the OR number from Finance)</label><input id="svf-ref" style="' + FIELD + '" value="' + esc(c0.orRef || '') + '"/></div>' +
      '<div class="card" style="margin:6px 0 12px"><div class="card-body" style="padding:8px 14px;font-size:12px;display:grid;grid-template-columns:1fr auto;gap:2px 12px">' +
        '<span style="color:var(--text-muted)">Recorded total</span><span id="svf-rec" style="text-align:right;font-weight:700;color:var(--success)"></span>' +
        '<span style="color:var(--text-muted)">Net of VAT</span><span id="svf-net" style="text-align:right"></span>' +
        '<span style="color:var(--text-muted)">Output VAT (12%)</span><span id="svf-vatamt" style="text-align:right"></span></div></div>' +
      '<div class="form-group"><label>Receipt / proof of payment (required)</label>' +
        (fixing && claim.receiptUrl ? '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Current proof: <a href="' + esc(window.safeHttpUrl ? window.safeHttpUrl(claim.receiptUrl) : claim.receiptUrl) + '" target="_blank" rel="noopener">' + esc(claim.receiptName || 'View') + '</a> — upload another only to replace it.</div>' : '') +
        '<div id="svf-upload"></div></div>' +
      '<div style="font-size:11px;color:var(--text-muted);margin:-4px 0 10px">The President confirms the fee in the app. The visit is booked once it is confirmed.</div>' +
      '<div id="svf-err" class="error-msg hidden"></div>';
    const footer = '<button class="btn-primary" id="svf-save" style="' + BTN + '">' + (fixing ? 'Save and send again' : 'Record fee — send to President') + '</button><button class="btn-secondary" onclick="closeModal()" style="' + BTN + '">Cancel</button>';
    const panel = window.openPage((fixing ? 'Fix fee — ' : 'Record fee — ') + esc(visit.clientName || ''), body, footer);
    const $ = function (id) { return panel.querySelector('#' + id); };
    let proof = null;
    if (window.Drive && window.Drive.renderUploadArea) window.Drive.renderUploadArea('svf-upload', function (r) { proof = r; }, { label: 'Upload proof of payment (photo/PDF)', accept: 'image/*,.pdf', dept: 'Finance', subfolder: 'Collections' });
    const recompute = function () {
      const s = window.vatSplit(parseFloat($('svf-amount').value) > 0 ? parseFloat($('svf-amount').value) : 0, $('svf-vat').value);
      $('svf-rec').textContent = money(s.recorded); $('svf-net').textContent = money(s.net); $('svf-vatamt').textContent = money(s.vat);
    };
    ['input', 'change'].forEach(function (ev) { $('svf-amount').addEventListener(ev, recompute); $('svf-vat').addEventListener(ev, recompute); });
    recompute();

    let sending = false;
    $('svf-save').addEventListener('click', function () {
      return window.busy($('svf-save'), async function () {
        if (sending) return;
        sending = true;                     // at once, before any await: two taps at the same instant record ONE fee. Released on every failure; kept on success.
        const err = $('svf-err');
        const fail = function (m) { sending = false; err.textContent = m; err.classList.remove('hidden'); };
        err.classList.add('hidden');
        if (parseInt($('svf-upload') && $('svf-upload').dataset.busy, 10) > 0) { sending = false; toast('Wait for the upload to finish', 'error'); return; }
        const entered = parseFloat($('svf-amount').value) || 0;
        // The fee is the tariff; only the President may change it (SF21). Checked here as well as by the read-only field.
        if (!pres && Math.abs(entered - tariff) > 0.005) { fail('The fee for this area is ' + money(tariff) + '. Only the President can change it.'); return; }
        const vatTreatment = $('svf-vat').value, paymentMethod = $('svf-method').value;
        const receiptUrl = (proof && proof.url) || (fixing && claim.receiptUrl) || null;
        const receiptName = (proof && proof.name) || (fixing && claim.receiptName) || null;
        const val = PC.validateRecord({ kind: 'site_visit', entered: entered, vatTreatment: vatTreatment, hasReceipt: !!receiptUrl, project: null });
        if (!val.ok) { fail(val.error); return; }
        const visitDate = $('svf-visit').value || visit.visitDate || visit.requestedDate;
        // Fresh read: nothing may have moved while the sheet was open.
        let fresh;
        try { fresh = await readDoc('site_visits', visit.id); } catch (ex) { fail('Could not check the visit — try again.'); return; }
        if (!fresh || fresh.status !== visit.status) { fail('This visit changed while the sheet was open. Close it and try again.'); return; }
        const who = whoName(), nowIso = new Date().toISOString(), uid = myUid();
        const fields = { paymentReceived: entered, paymentMethod: paymentMethod, vatTreatment: vatTreatment, orRef: String($('svf-ref').value || '').trim(), paymentDate: $('svf-date').value || window.today(), receiptUrl: receiptUrl, receiptName: receiptName };
        try {
          let id, resubmits = 0;
          if (fixing) {
            const cur = await readDoc('payment_claims', claim.id);
            if (!cur || cur.status !== 'payment_rejected') { sending = false; toast('This fee was already sent again or confirmed.', 'error'); if (onDone) onDone(); return; }
            resubmits = (Number((cur.paymentConfirm || {}).resubmits) || 0) + 1;
            await fsDb().collection('payment_claims').doc(claim.id).update(Object.assign({}, fields, { status: 'pending', paymentConfirm: { requestedAt: nowIso, requestedBy: uid, requestedByName: who, decision: null, resubmits: resubmits, prevReason: (cur.paymentConfirm || {}).reason || '' }, updatedAt: FV().serverTimestamp() }));
            id = claim.id;
          } else {
            const doc = Object.assign({
              kind: 'site_visit', orderId: null, projectId: null, quoteNumber: visit.quoteNumber || '', clientId: visit.clientId || null, clientName: visit.clientName || '', company: visit.company || 'BK',
              siteVisitId: visit.id, changeOrderId: null, area: visit.area, svNumber: visit.svNumber || '',
              status: 'pending', paymentConfirm: { requestedAt: nowIso, requestedBy: uid, requestedByName: who, decision: null, resubmits: 0 },
              createdBy: uid, createdByName: who, createdAt: FV().serverTimestamp(), updatedAt: FV().serverTimestamp(),
            }, fields);
            id = (await fsDb().collection('payment_claims').add(doc)).id;
            await fsDb().collection('site_visits').doc(visit.id).update({ status: 'fee_pending', feeClaimId: id, visitDate: visitDate, updatedAt: FV().serverTimestamp() });
          }
          try { if (window.logAudit) window.logAudit('create', 'payment_claim', id, { client: visit.clientName, kind: 'site_visit', paid: entered }); } catch (_) {}
          // The President and Finance are told (QF's rows, with the claim id). A failed notification never fails the write.
          const line = who + ': ' + (visit.clientName || '') + ' — ' + money(val.recorded) + ' site-visit fee by ' + paymentMethod + ' (' + (visit.svNumber || '') + ').';
          await step(function () { return window.Notifs.sendToOwner({ title: resubmits ? '💵 Fee corrected — please confirm' : '💵 Fee to confirm', body: resubmits ? line : line + ' Tap to confirm.', icon: '💵', type: 'payment_confirm', link: 'approvals', dedupKey: 'payconf-claim-' + id + '-' + resubmits }); });
          await step(function () { return window.Notifs.sendToDept('Finance', { title: '💵 Fee recorded — President to confirm', body: line + ' No action needed unless the President cannot be reached.', icon: '💵', type: 'payment_confirm', link: 'sales-orders', dedupKey: 'payfyi-claim-' + id + '-' + resubmits }); });
          invalidate();
          toast(fixing ? 'Fee updated — sent to the President again' : 'Fee recorded — waiting for confirmation', 'success');
          if (onDone) onDone();
          // The President who records it confirms it in one more tap: REPLACE this page with the confirm sheet.
          if (pres) { try { await window.ensureScript('js/payment-claims-ui.js'); await window.PaymentClaimsUI.openConfirmSheet({ id: id }, onDone, { replace: true }); return; } catch (_) { /* the Approvals list still has it */ } }
          window.closeModal();
        } catch (ex) { fail('Failed: ' + (ex.message || ex.code)); }
      });
    });
  }

  // ═══ cancel ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
  async function cancelVisit(visitIn, onDone) {
    if (!canRequest()) { toast('Only Sales or the President can cancel a site visit.', 'error'); return false; }
    try { await loadCore(); } catch (ex) { toast('Could not cancel the visit: ' + (ex.message || ex.code), 'error'); return false; }
    try {
      const ref = fsDb().collection('site_visits').doc(visitIn.id);
      const snap = await ref.get();
      if (!snap.exists) { toast('This site visit no longer exists.', 'error'); if (onDone) onDone(); return false; }
      const cur = snap.data();
      if (!window.FlowCore.canCancelVisit(cur.status)) { toast('A ' + window.FlowCore.visitStatusWord(cur.status).toLowerCase() + ' visit cannot be cancelled.', 'error'); if (onDone) onDone(); return false; }
      const msg = 'Cancel site visit ' + (cur.svNumber || '') + ' for ' + (cur.clientName || '') + '?' + (cur.status === 'fee_pending' ? ' Its fee is still waiting for confirmation: ask the President to send that payment back.' : '');
      if (typeof window.confirmDialog === 'function' && !(await window.confirmDialog({ message: msg, confirmLabel: 'Cancel the visit' }))) return false;
      await ref.update({ status: 'cancelled', cancelledBy: myUid(), cancelledByName: whoName(), cancelledAt: new Date().toISOString(), updatedAt: FV().serverTimestamp() });
      try { if (window.logAudit) window.logAudit('update', 'site_visit', visitIn.id, { cancelled: true }); } catch (_) {}
      invalidate();
      toast('Site visit cancelled', 'success');
      if (onDone) onDone();
      return true;
    } catch (ex) { toast('Could not cancel the visit: ' + (ex.message || ex.code), 'error'); return false; }
  }

  // ═══ V3 — the fee was confirmed ══════════════════════════════════════════════════════════════════════════════════════════
  // Called by js/payment-claims-ui.js after a site-visit claim is CONFIRMED. Best effort by contract: the caller wraps it, and nothing here undoes the post.
  // A visit that is no longer waiting (cancelled, already booked, done) is left alone. Production is told: date, address, contact. NO amount.
  async function afterFeeConfirmed(claim) {
    if (!claim || claim.kind !== 'site_visit' || !claim.siteVisitId) return { ok: false, code: 'not-a-visit-fee' };
    await loadCore();
    const ref = fsDb().collection('site_visits').doc(claim.siteVisitId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, code: 'no-visit' };
    const v = Object.assign({ id: snap.id }, snap.data());
    if (!window.FlowCore.canBookVisit(v.status)) return { ok: false, code: 'not-bookable', status: v.status };
    await ref.update({ status: 'booked', feeClaimId: claim.id, bookedAt: new Date().toISOString(), bookedByName: whoName(), updatedAt: FV().serverTimestamp() });
    invalidate();
    const when = niceDate(v.visitDate || v.requestedDate);
    const contact = [v.contactPerson, v.contactPhone].filter(Boolean).join(' ');
    await step(function () {
      return window.Notifs.sendToDept('Production', { title: '📍 Site visit booked', body: (v.clientName || '') + ' — ' + when + ', ' + (v.address || '') + '. Contact ' + contact + '.', icon: '📍', type: 'site_visit_booked', link: 'dept:Production', dedupKey: 'svbook-' + v.id }, { fallbackToOwner: true });
    });
    return { ok: true, code: 'booked' };
  }

  // ═══ V4 — Production: booked visits, and the report ═══════════════════════════════════════════════════════════════════════
  async function openReportSheet(visitIn, onDone) {
    if (!canWriteReport()) { toast('Only staff can write a site visit report.', 'error'); return; }
    try { await loadCore(); } catch (ex) { toast('Could not open the report screen: ' + (ex.message || ex.code), 'error'); return; }
    let visit;
    try { visit = await readDoc('site_visits', visitIn.id); } catch (ex) { toast('Could not read the site visit: ' + (ex.message || ex.code), 'error'); return; }
    if (!visit) { toast('This site visit no longer exists.', 'error'); return; }
    if (visit.status !== 'booked') { toast(visit.status === 'done' ? 'The report for this visit is already written.' : 'This visit is not booked yet.', 'error'); if (onDone) onDone(); return; }
    const body =
      '<div style="font-size:12px;margin-bottom:10px;overflow-wrap:anywhere"><strong>' + esc(visit.clientName || '') + '</strong> · ' + esc(visit.svNumber || '') + ' · ' + esc(niceDate(visit.visitDate || visit.requestedDate)) + '<br>' + esc(visit.address || '') + '</div>' +
      '<div class="form-group"><label>Measurements</label><textarea id="svr-measure" rows="4" style="' + FIELD + '" placeholder="Walls, ceiling, door and window sizes…"></textarea></div>' +
      '<div class="form-group"><label>Site constraints</label><textarea id="svr-constraints" rows="3" style="' + FIELD + '" placeholder="Gas line, drains, stairs, access, power…"></textarea></div>' +
      '<div class="form-group"><label>Layout notes</label><textarea id="svr-layout" rows="3" style="' + FIELD + '"></textarea></div>' +
      '<div class="form-group"><label>Photos</label><div id="svr-photos"></div></div>' +
      '<div class="form-group"><label>Sketches and other files</label><div id="svr-files"></div></div>' +
      '<div style="font-size:11px;color:var(--text-muted);margin:-4px 0 10px">No prices on this report.</div>' +
      '<div id="svr-err" class="error-msg hidden"></div>';
    const footer = '<button class="btn-primary" id="svr-save" style="' + BTN + '">Save report</button><span id="svr-forms"></span><button class="btn-secondary" onclick="closeModal()" style="' + BTN + '">Cancel</button>';
    const panel = window.openPage('Site visit report — ' + esc(visit.clientName || ''), body, footer);
    const $ = function (id) { return panel.querySelector('#' + id); };
    const photos = [], files = [];
    if (window.Drive && window.Drive.renderUploadArea) {
      window.Drive.renderUploadArea('svr-photos', function (r) { photos.push(r); }, { label: 'Add photos', accept: 'image/*', dept: 'Production', subfolder: 'SiteVisits', multiple: true, allowLinks: false });
      window.Drive.renderUploadArea('svr-files', function (r) { files.push(r); }, { label: 'Add files', accept: '*', dept: 'Production', subfolder: 'SiteVisits', multiple: true, allowLinks: false });
    }
    // the blank paper form, for the site itself (Forms.buttonHtml is '' outside the form's audience)
    formsApi().then(function (F) { const h = $('svr-forms'); if (!F || !h) return; h.innerHTML = String(F.buttonHtml('site_visit_report', { docId: visit.id }, { label: 'Blank form' }) || ''); if (F.bind) F.bind(h); }).catch(function () {});
    let writing = false;
    $('svr-save').addEventListener('click', function () {
      return window.busy($('svr-save'), async function () {
        if (writing) return;
        const err = $('svr-err');
        const fail = function (m) { writing = false; err.textContent = m; err.classList.remove('hidden'); };
        err.classList.add('hidden');
        if ((parseInt($('svr-photos') && $('svr-photos').dataset.busy, 10) > 0) || (parseInt($('svr-files') && $('svr-files').dataset.busy, 10) > 0)) { toast('Wait for the upload to finish', 'error'); return; }
        const val = window.FlowCore.validateVisitReport({ measurements: $('svr-measure').value, constraints: $('svr-constraints').value, layoutNotes: $('svr-layout').value, photos: photos, attachments: files });
        if (!val.ok) { fail(val.error); return; }
        writing = true;                     // before the first await: a double tap writes the report once
        try {
          const ref = fsDb().collection('site_visits').doc(visit.id);
          const cur = await ref.get();
          if (!cur.exists || cur.data().status !== 'booked') { writing = false; toast('This visit is no longer waiting for a report.', 'error'); if (onDone) onDone(); return; }
          await ref.update({ report: Object.assign({}, val.report, { by: myUid(), byName: whoName(), at: new Date().toISOString() }), status: 'done', updatedAt: FV().serverTimestamp() });
          try { if (window.logAudit) window.logAudit('update', 'site_visit', visit.id, { reportWritten: true }); } catch (_) {}
          invalidate();
          window.closeModal();
          toast('Site visit report saved', 'success');
          if (onDone) onDone();
        } catch (ex) { fail('Failed: ' + (ex.message || ex.code)); }
      });
    });
  }

  // The Production page: booked visits, soonest first, with "Write site visit report"; below them the last reports written, each with its form (PDF).
  // Silent on any failure. Reads site_visits only — never a payment, never a change order.
  async function renderProductionList(host, opts) {
    if (!host) return;
    opts = opts || {};
    const byDate = function (a, b) { return String(a.visitDate || a.requestedDate || '').localeCompare(String(b.visitDate || b.requestedDate || '')); };
    let list, done = [];
    try {
      await loadCore();
      const snap = await fsDb().collection('site_visits').where('status', '==', 'booked').get();
      list = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).sort(byDate);
      try {
        const ds = await fsDb().collection('site_visits').where('status', '==', 'done').get();
        done = ds.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).sort(function (a, b) { return byDate(b, a); }).slice(0, 10);
      } catch (_) { done = []; }
    } catch (e) { host.innerHTML = ''; return; }
    if (!list.length && !done.length) { host.innerHTML = ''; return; }
    const F = await formsApi();
    const again = opts.onDone || function () { renderProductionList(host, opts); };
    const formBtn = function (v, label) { try { return F ? String(F.buttonHtml('site_visit_report', { docId: v.id }, { label: label }) || '') : ''; } catch (_) { return ''; } };
    host.innerHTML = (list.length ? '<div class="card" style="margin-bottom:12px;border:1.5px solid var(--primary)">' +
      '<div class="card-header" style="display:flex;justify-content:space-between;align-items:center"><h3 style="font-size:13px">📍 Site visits to do</h3><span class="badge badge-blue">' + list.length + '</span></div>' +
      '<div class="card-body" style="display:flex;flex-direction:column;gap:8px">' + list.map(function (v) {
        return '<div class="item-card sv-item"><div class="item-title" style="font-size:13px">' + esc(v.clientName || '') + ' — ' + esc(v.svNumber || '') + '</div>' +
          '<div class="item-meta" style="margin-top:4px"><span>' + esc(niceDate(v.visitDate || v.requestedDate)) + '</span><span>' + esc(v.address || '') + '</span><span>' + esc([v.contactPerson, v.contactPhone].filter(Boolean).join(' ')) + '</span></div>' +
          (v.notes ? '<div style="font-size:12px;margin-top:4px;overflow-wrap:anywhere">' + esc(v.notes) + '</div>' : '') +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button type="button" class="btn-primary btn-sm sv-report" data-id="' + esc(v.id) + '" style="' + BTN + '">Write site visit report</button>' + formBtn(v, 'Blank form') + '</div></div>';
      }).join('') + '</div></div>' : '') +
      (done.length ? '<details style="margin-bottom:12px"><summary style="cursor:pointer;font-size:13px;font-weight:700;color:var(--text-muted);padding:6px 0">Site visit reports written (' + done.length + ')</summary>' +
        '<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">' + done.map(function (v) {
          return '<div class="item-card sv-done" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:space-between"><div style="min-width:0;overflow-wrap:anywhere"><strong>' + esc(v.clientName || '') + '</strong> — ' + esc(v.svNumber || '') + ' · ' + esc(niceDate(v.visitDate || v.requestedDate)) + '</div>' + formBtn(v, 'Site visit report') + '</div>';
        }).join('') + '</div></details>' : '');
    try { if (F && F.bind) F.bind(host); } catch (_) {}
    host.querySelectorAll('.sv-report').forEach(function (b) { b.addEventListener('click', function () { const v = list.find(function (x) { return x.id === b.dataset.id; }); if (v) openReportSheet(v, again); }); });
  }

  // ═══ the lead / quote cards: each visit with its status and the buttons that apply ═════════════════════════════════════════
  // Fills every `.sv-slot` under `root` ([data-client-id] on a lead card, [data-quote-id] on a quote card) from ONE read of site_visits. Silent on any failure.
  async function fillSlots(root, onChange) {
    const slots = root && root.querySelectorAll ? root.querySelectorAll('.sv-slot') : [];
    if (!slots.length) return;
    let all;
    try {
      await loadCore();
      const snap = await fsDb().collection('site_visits').orderBy('requestedAt', 'desc').limit(300).get();
      all = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
    } catch (_) { return; }
    const FC = window.FlowCore;
    const F = await formsApi();
    const sales = canRequest();
    const claims = {};
    // the fee claims of visits waiting for their fee (a sent-back fee must show why, with a way to fix it); a failed read is "no claim".
    // Only for a viewer the rules let read payment_claims: a Production login never queries them.
    await Promise.all((seesPayments() ? all : []).filter(function (v) { return v.status === 'fee_pending' && v.feeClaimId; }).map(function (v) {
      return readDoc('payment_claims', v.feeClaimId).then(function (c) { claims[v.id] = c; }).catch(function () {});
    }));
    const again = onChange || function () { fillSlots(root, onChange); };
    slots.forEach(function (el) {
      const mine = all.filter(function (v) {
        if (v.status === 'cancelled') return false;
        return (el.dataset.quoteId && v.quoteId === el.dataset.quoteId) || (!el.dataset.quoteId && el.dataset.clientId && v.clientId === el.dataset.clientId);
      });
      if (!mine.length) { el.innerHTML = ''; return; }
      el.innerHTML = mine.map(function (v) {
        const c = claims[v.id];
        const sentBack = v.status === 'fee_pending' && c && c.status === 'payment_rejected';
        let forms = '';
        try { if (F) forms = String(F.buttonHtml('site_visit_request', { docId: v.id }, { label: 'Site visit form' }) || '') + (v.status === 'done' ? String(F.buttonHtml('site_visit_report', { docId: v.id }, { label: 'Report' }) || '') : ''); } catch (_) { forms = ''; }
        return '<div class="sv-line" data-id="' + esc(v.id) + '" style="font-size:12px;padding:6px 0;border-top:1px solid var(--border);overflow-wrap:anywhere">' +
          '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><strong>' + esc(v.svNumber || 'Site visit') + '</strong> ' + esc(FC.areaLabel(v.area)) + ' · ' + esc(niceDate(v.visitDate || v.requestedDate)) +
            ' <span class="badge ' + (STATUS_BADGE[v.status] || 'badge-gray') + '" style="font-size:10px">' + esc(sentBack ? 'Fee sent back' : FC.visitStatusWord(v.status)) + '</span></div>' +
          (sentBack ? '<div style="color:var(--danger)">' + esc(((c.paymentConfirm || {}).reason) || '') + '</div>' : '') +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">' + forms +
            (sales && v.status === 'requested' ? '<button type="button" class="btn-primary btn-sm sv-fee" data-id="' + esc(v.id) + '" style="' + BTN + '">Record fee</button>' : '') +
            (sales && sentBack ? '<button type="button" class="btn-primary btn-sm sv-fee" data-id="' + esc(v.id) + '" style="' + BTN + '">Fix fee &amp; resend</button>' : '') +
            (sales && FC.canCancelVisit(v.status) ? '<button type="button" class="btn-secondary btn-sm sv-cancel" data-id="' + esc(v.id) + '" style="' + BTN + '">Cancel visit</button>' : '') + '</div></div>';
      }).join('');
      try { if (F && F.bind) F.bind(el); } catch (_) {}
      const find = function (b) { return mine.find(function (x) { return x.id === b.dataset.id; }); };
      el.querySelectorAll('.sv-fee').forEach(function (b) { b.addEventListener('click', function (ev) { ev.stopPropagation(); const v = find(b); if (v) openFeeSheet(v, again); }); });
      el.querySelectorAll('.sv-cancel').forEach(function (b) { b.addEventListener('click', function (ev) { ev.stopPropagation(); const v = find(b); if (v) cancelVisit(v, again); }); });
    });
  }

  window.SiteVisits = {
    canRequest: canRequest, openRequestSheet: openRequestSheet, openFeeSheet: openFeeSheet, cancelVisit: cancelVisit, afterFeeConfirmed: afterFeeConfirmed,
    openReportSheet: openReportSheet, renderProductionList: renderProductionList, fillSlots: fillSlots,
  };
})();
