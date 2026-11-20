// ═══════════════════════════════════════════════════════════════════════════
//  js/screens/change-orders.js — change requests and change orders (specs/SALES-FLOW-SPEC-2026-11-19.md §5.7 C1–C4, §9.9, §9.10, §12; Phase 5).
//
//  LAZY: loaded through window.ensureScript('js/screens/change-orders.js') by the job page (js/screens/production.js, host #jpd-chgorders). It is NOT in
//  index.html's app-kit; it is in sw.js PRECACHE. It loads js/flow-core.js on demand (the pricing, the status words and the rules live there).
//
//    C1  openRequestSheet(project)    ANY staff (Rene, or Uriel): details, items added / removed (name, qty, unit), days on the deadline, photos.
//                                     NO PRICE FIELD EXISTS HERE ("Operations never quotes prices on site") and a price typed into a text is refused.
//                                     → change_requests doc, status 'requested'; Sales is told.
//    C2  openPriceSheet(request)      Sales / the President: lines (kind, name, qty, unit, unit price), price (computed, may be negative), added down payment
//                                     → change_orders/{request id}, status 'priced', coNumber from Forms.nextNumber('CO'); the request → 'priced'. declineRequest().
//    C3  openSignSheet(request)       Sales / the President: the signed copy, who signed for the client, who signed for Barro → status 'signed'; Production told.
//    C4  the down payment is recorded through the payment-claims record sheet (kind 'change_order', picker of this order's signed change orders).
//    C5  "Revise contract amount" (Choice C) is js/contract-ui.js; this block only offers a button to it once the change order is ready.
//
//  renderJobChanges(host, project, repaint) draws the job's requests with the status words — "Requested", "Priced", "Signed", "Applied — see JO R{n}",
//  "Declined" — for EVERYONE, never a price. Pesos (the CO number's price, the added down payment) are drawn only for a viewer the rules let read
//  change_orders (Sales, the books tier, the President). A Production login NEVER queries change_orders or payment_claims from here (a permission error
//  there would be a bug); it reads change_requests, which carry no peso (the rules refuse a price key on them).
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  // firebase-config.js declares `const db` at top level: a global binding every classic script can read, but NOT window.db (undefined in the real app).
  const fsDb = function () { return (typeof db !== 'undefined' && db) || window.db; };

  const esc = function (s) { return window.escHtml ? window.escHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  const money = function (n) { return '₱' + (window.fmtN2 ? window.fmtN2(Number(n) || 0) : (Number(n) || 0).toFixed(2)); };
  const signedMoney = function (n) { return (Number(n) < 0 ? '−' : '+') + money(Math.abs(Number(n) || 0)); };
  const toast = function (m, t) { try { window.Notifs.showToast(m, t || 'info'); } catch (_) {} };
  const FV = function () { return window.firebase.firestore.FieldValue; };
  const BTN = 'min-height:44px';
  const FIELD = 'padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text);min-height:44px;font-family:inherit';
  const NARROW = FIELD + ';padding:8px 6px;text-align:center;min-width:0';      // qty / unit boxes: three fields share one phone-width row
  const step = async function (fn) { try { await fn(); } catch (e) { try { console.warn('[change orders] follow-up failed', e); } catch (_) {} } };
  const WORD_BADGE = { requested: 'badge-orange', priced: 'badge-blue', signed: 'badge-green', applied: 'badge-gray', declined: 'badge-red' };

  function whoName() { return (window.userProfile && window.userProfile.displayName) || (window.currentUser && window.currentUser.email) || ''; }
  function myUid() { return (window.currentUser && window.currentUser.uid) || ''; }
  function isPresident() { return typeof window.isRealPresident === 'function' && window.isRealPresident(); }
  function isSalesActor() { return typeof window.canEditDept === 'function' && window.canEditDept('Sales') && (window.currentRole || '') !== 'secretary'; }
  // C1: any staff profile (the rules: any non-secretary staff). C2 / C3 / decline: Sales and the President.
  function canRecord() { return !!window.currentRole && window.currentRole !== 'secretary'; }
  function canPrice() { return (window.currentRole || '') !== 'secretary' && (isPresident() || isSalesActor()); }
  // May this viewer read change_orders (and payment_claims)? Mirrors firestore.rules: Sales, the books tier, the President. NEVER Production.
  function seesPrices() {
    const role = window.currentRole || '';
    if (role === 'secretary') return false;
    return canPrice() || role === 'finance' || role === 'manager' || role === 'president' || (window.currentDepts || []).indexOf('Finance') >= 0;
  }
  const isFlow2 = function (p) { return !!p && Number(p.flowVersion) >= 2; };

  async function loadCore() {
    await window.ensureScript('js/flow-core.js');
    if (!window.FlowCore) throw new Error('The flow engine did not load.');
  }
  async function readDoc(coll, id) {
    const s = await fsDb().collection(coll).doc(id).get();
    return s.exists ? Object.assign({ id: s.id }, s.data()) : null;
  }
  function invalidate() {
    if (typeof window.dbCacheInvalidate === 'function') ['change_requests', 'change_orders', 'job_projects', 'payment_claims', 'approvals-pending:payment_claims-pending'].forEach(function (k) { try { window.dbCacheInvalidate(k); } catch (_) {} });
  }
  async function formsApi() { try { return typeof window.flowForms === 'function' ? await window.flowForms() : null; } catch (_) { return null; } }
  // One event on the job's timeline. The text never holds a peso (Production reads this list). Best effort.
  function jobEvent(projectId, event) {
    return step(function () {
      return fsDb().collection('job_projects').doc(projectId).update({ timeline: FV().arrayUnion({ at: new Date().toISOString(), event: event, by: whoName() }), updatedAt: FV().serverTimestamp() });
    });
  }
  const when = function (ts) {
    try { const d = ts && ts.toDate ? ts.toDate() : (ts && ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)); return d.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' }); } catch (_) { return ''; }
  };
  const secs = function (ts) { return (ts && (ts.seconds || (ts.toDate && ts.toDate().getTime() / 1000))) || 0; };
  const lineText = function (l) { return String(l.qty) + ' ' + String(l.unit || 'pc') + ' ' + String(l.name); };      // plain text: escaped once, where it is drawn

  // ═══ C1 — record a change request (no price field) ═══════════════════════════════════════════════════════════════════════
  const ROWS = 8, SHOWN = 3;
  function itemRows(prefix, label) {
    let h = '<div class="form-group"><label>' + label + '</label>';
    for (let i = 0; i < ROWS; i++) {
      h += '<div class="cr-row cr-row-' + prefix + (i >= SHOWN ? ' hidden' : '') + '" style="display:flex;gap:6px;margin-bottom:6px">' +
        '<input id="cr-' + prefix + '-name-' + i + '" type="text" placeholder="Item" autocomplete="off" style="' + FIELD + ';flex:3"/>' +
        '<input id="cr-' + prefix + '-qty-' + i + '" type="number" min="0" step="any" inputmode="decimal" placeholder="Qty" style="' + NARROW + ';flex:1"/>' +
        '<input id="cr-' + prefix + '-unit-' + i + '" type="text" placeholder="pc" autocomplete="off" style="' + NARROW + ';flex:1"/></div>';
    }
    return h + '<button type="button" class="btn-secondary btn-sm" id="cr-more-' + prefix + '" style="' + BTN + '">+ Add another item</button></div>';
  }
  async function openRequestSheet(project, onDone) {
    if (!canRecord()) { toast('Only staff can record a change request.', 'error'); return; }
    try { await loadCore(); } catch (ex) { toast('Could not open the change screen: ' + (ex.message || ex.code), 'error'); return; }
    const FC = window.FlowCore;
    let p;
    try { p = (project && project.id && (await readDoc('job_projects', project.id))) || project; } catch (_) { p = project; }
    if (!p || !p.id) return;
    if (!isFlow2(p)) { toast('Change requests are for jobs created through the new sales flow.', 'error'); return; }
    if (p.stage === 'paid' || p.stage === 'cancelled') { toast('The job is closed.', 'error'); return; }
    const body =
      '<div style="font-size:12px;margin-bottom:10px;overflow-wrap:anywhere"><strong>' + esc(p.clientName || '') + '</strong> · ' + esc(p.joNumber || p.projectNo || '') + '</div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Write what the client wants changed. Sales prices it. No prices here.</div>' +
      '<div class="form-group"><label>What is the change?</label><textarea id="cr-details" rows="4" style="' + FIELD + '" placeholder="e.g. Client wants a shelf under the canopy hood"></textarea></div>' +
      itemRows('add', 'Items added') + itemRows('rem', 'Items removed') +
      '<div class="form-group"><label>Days added to the deadline (0 if none)</label><input id="cr-days" type="number" step="1" inputmode="numeric" style="' + FIELD + '" value="0"/></div>' +
      '<div class="form-group"><label>Photos (optional)</label><div id="cr-photos"></div></div>' +
      '<div id="cr-err" class="error-msg hidden"></div>';
    const footer = '<button class="btn-primary" id="cr-save" style="' + BTN + '">Record change request</button><button class="btn-secondary" onclick="closeModal()" style="' + BTN + '">Cancel</button>';
    const panel = window.openPage('Change request — ' + esc(p.clientName || ''), body, footer);
    const $ = function (id) { return panel.querySelector('#' + id); };
    const photos = [];
    if (window.Drive && window.Drive.renderUploadArea) window.Drive.renderUploadArea('cr-photos', function (r) { photos.push({ url: r.url, name: r.name || '' }); }, { label: 'Add photos', accept: 'image/*', dept: 'Production', subfolder: 'ChangeRequests', multiple: true, allowLinks: false });
    ['add', 'rem'].forEach(function (k) {
      const more = $('cr-more-' + k);
      if (more) more.addEventListener('click', function () {
        const rows = panel.querySelectorAll ? panel.querySelectorAll('.cr-row-' + k) : [];
        for (let i = 0; i < rows.length; i++) { if (rows[i].classList.contains('hidden')) { rows[i].classList.remove('hidden'); break; } }
      });
    });
    const readRows = function (k) {
      const out = [];
      for (let i = 0; i < ROWS; i++) { const n = $('cr-' + k + '-name-' + i); if (n) out.push({ name: n.value, qty: $('cr-' + k + '-qty-' + i).value, unit: $('cr-' + k + '-unit-' + i).value }); }
      return out;
    };
    let saving = false;
    $('cr-save').addEventListener('click', function () {
      return window.busy($('cr-save'), async function () {
        if (saving) return;
        const err = $('cr-err');
        const fail = function (m) { err.textContent = m; err.classList.remove('hidden'); };
        err.classList.add('hidden');
        if (parseInt($('cr-photos') && $('cr-photos').dataset.busy, 10) > 0) { toast('Wait for the upload to finish', 'error'); return; }
        const val = FC.validateChangeRequest({ details: $('cr-details').value, itemsAdded: readRows('add'), itemsRemoved: readRows('rem'), effectOnDeadlineDays: $('cr-days').value });
        if (!val.ok) { fail(val.error); return; }
        const r = val.request;
        saving = true;
        try {
          const joNumber = p.joNumber || (typeof window.jobOrderNoFor === 'function' ? window.jobOrderNoFor(p) : '') || '';
          const ref = await fsDb().collection('change_requests').add({
            projectId: p.id, joNumber: joNumber, clientName: p.clientName || '', details: r.details, itemsAdded: r.itemsAdded, itemsRemoved: r.itemsRemoved, effectOnDeadlineDays: r.effectOnDeadlineDays,
            photos: photos.slice(), status: 'requested', coNumber: null, requestedBy: myUid(), requestedByName: whoName(), requestedAt: FV().serverTimestamp(), updatedAt: FV().serverTimestamp(),
          });
          try { if (window.logAudit) window.logAudit('create', 'change_request', ref.id, { project: p.id }); } catch (_) {}
          await jobEvent(p.id, 'Change requested — ' + r.details.slice(0, 80));
          // §12: Sales is told ("Change request to price"). A failed notification never fails the write. No price exists to leave out.
          await step(function () {
            return window.Notifs.sendToDept('Sales', { title: '📝 Change request to price', body: whoName() + ': ' + (p.clientName || '') + ' — ' + r.details.slice(0, 80), icon: '📝', type: 'change_request', link: 'projects-lifecycle', dedupKey: 'crreq-' + ref.id }, { fallbackToOwner: true });
          });
          invalidate();
          window.closeModal();
          toast('Change request recorded. Sales will price it.', 'success');
          if (onDone) onDone();
        } catch (ex) { saving = false; fail('Failed: ' + (ex.message || ex.code)); }
      });
    });
  }

  // ═══ C2 — price the change order ═════════════════════════════════════════════════════════════════════════════════════════
  const LINE_ROWS = 20;               // a request holds up to 8 added + 8 removed items (ROWS above): every one of them seeds a line, plus room to add
  async function openPriceSheet(requestIn, onDone) {
    if (!canPrice()) { toast('Only Sales or the President can price a change order.', 'error'); return; }
    try { await loadCore(); } catch (ex) { toast('Could not open the change screen: ' + (ex.message || ex.code), 'error'); return; }
    const FC = window.FlowCore;
    let req, co = null, project, order = null;
    try {
      req = await readDoc('change_requests', requestIn.id);
      co = req ? await readDoc('change_orders', req.id) : null;
      project = req ? await readDoc('job_projects', req.projectId) : null;
      order = project && project.salesOrderId ? await readDoc('sales_orders', project.salesOrderId) : null;
    } catch (ex) { toast('Could not read the change request: ' + (ex.message || ex.code), 'error'); return; }
    if (!req) { toast('This change request no longer exists.', 'error'); return; }
    if (!FC.canPriceRequest(req.status, co && co.status)) { toast('This change request is already ' + req.status + '.', 'error'); if (onDone) onDone(); return; }
    if (!project || !order) { toast('This job has no sales order, so a change order cannot be priced.', 'error'); return; }
    if (project.stage === 'paid' || project.stage === 'cancelled') { toast('The job is closed.', 'error'); return; }
    const contract = Number(order.contractAmount) || 0;
    // lines: the priced ones when re-pricing, else the request's own items (unit price empty)
    let seed;
    if (co && co.pricing && Array.isArray(co.pricing.lines) && co.pricing.lines.length) seed = co.pricing.lines.map(function (l) { return { kind: l.kind === 'removed' ? 'removed' : 'added', name: l.name, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice }; });
    else seed = (req.itemsAdded || []).map(function (l) { return { kind: 'added', name: l.name, qty: l.qty, unit: l.unit, unitPrice: '' }; }).concat((req.itemsRemoved || []).map(function (l) { return { kind: 'removed', name: l.name, qty: l.qty, unit: l.unit, unitPrice: '' }; }));
    const shown = Math.min(LINE_ROWS, Math.max(seed.length + 1, 3));
    let rows = '';
    for (let i = 0; i < LINE_ROWS; i++) {
      const s = seed[i] || { kind: 'added', name: '', qty: '', unit: '', unitPrice: '' };
      rows += '<div class="cp-row' + (i >= shown ? ' hidden' : '') + '" style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:8px">' +
        '<div style="display:flex;gap:6px;margin-bottom:6px"><select id="cp-kind-' + i + '" style="' + FIELD + ';flex:1"><option value="added"' + (s.kind === 'added' ? ' selected' : '') + '>Added</option><option value="removed"' + (s.kind === 'removed' ? ' selected' : '') + '>Removed</option></select>' +
        '<input id="cp-name-' + i + '" type="text" placeholder="Item" autocomplete="off" style="' + FIELD + ';flex:3" value="' + esc(s.name || '') + '"/></div>' +
        '<div style="display:flex;gap:6px"><input id="cp-qty-' + i + '" type="number" min="0" step="any" inputmode="decimal" placeholder="Qty" style="' + NARROW + ';flex:1" value="' + esc(s.qty == null ? '' : s.qty) + '"/>' +
        '<input id="cp-unit-' + i + '" type="text" placeholder="pc" autocomplete="off" style="' + NARROW + ';flex:1" value="' + esc(s.unit || '') + '"/>' +
        '<input id="cp-price-' + i + '" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Unit price (₱)" style="' + FIELD + ';flex:2" value="' + esc(s.unitPrice == null ? '' : s.unitPrice) + '"/></div></div>';
    }
    const body =
      '<div style="font-size:12px;margin-bottom:8px;overflow-wrap:anywhere"><strong>' + esc(project.clientName || '') + '</strong> · ' + esc(order.soNumber || order.quoteNumber || '') + ' · contract ' + money(contract) + '</div>' +
      '<div style="font-size:12px;margin-bottom:10px;overflow-wrap:anywhere;color:var(--text-muted)">Requested by ' + esc(req.requestedByName || '') + ': ' + esc(req.details || '') + '</div>' +
      '<div style="font-size:12px;margin-bottom:6px">One line per item. An item that is taken out is a Removed line: its price comes off.</div>' + rows +
      '<button type="button" class="btn-secondary btn-sm" id="cp-more" style="' + BTN + ';margin-bottom:12px">+ Add a line</button>' +
      '<div class="form-group"><label>Added down payment (₱, 0 if none)</label><input id="cp-dp" type="number" min="0" step="0.01" inputmode="decimal" style="' + FIELD + '" value="' + esc(co && co.pricing && co.pricing.addedDownPayment ? co.pricing.addedDownPayment : 0) + '"/>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:3px">Asked from the client before work on the change starts.</div></div>' +
      '<div id="cp-summary" style="font-size:13px;display:grid;gap:4px;margin:10px 0;padding:10px;border:1px solid var(--border);border-radius:8px"></div>' +
      '<div id="cp-err" class="error-msg hidden"></div>';
    const footer = '<button class="btn-primary" id="cp-save" style="' + BTN + '">' + (co ? 'Save price' : 'Price change order') + '</button><button class="btn-secondary" onclick="closeModal()" style="' + BTN + '">Cancel</button>';
    const panel = window.openPage((co ? 'Edit price — ' : 'Price change order — ') + esc(project.clientName || ''), body, footer);
    const $ = function (id) { return panel.querySelector('#' + id); };
    const read = function () {
      const lines = [];
      for (let i = 0; i < LINE_ROWS; i++) lines.push({ kind: $('cp-kind-' + i).value, name: $('cp-name-' + i).value, qty: $('cp-qty-' + i).value, unit: $('cp-unit-' + i).value, unitPrice: $('cp-price-' + i).value });
      return { lines: lines, addedDownPayment: $('cp-dp').value };
    };
    const paint = function () {
      const v = FC.priceChangeOrder(read());
      const t = FC.changeOrderTotals({ contractNow: contract, price: v.price });
      $('cp-summary').innerHTML = '<div>Price difference: <strong>' + signedMoney(v.price) + '</strong></div><div>Current contract: ' + money(t.before) + '</div><div>New contract amount: <strong>' + money(t.after) + '</strong></div>' +
        (v.addedDownPayment > 0 ? '<div>Added down payment: ' + money(v.addedDownPayment) + '</div>' : '');
    };
    for (let i = 0; i < LINE_ROWS; i++) ['kind', 'name', 'qty', 'unit', 'price'].forEach(function (k) { const el = $('cp-' + k + '-' + i); if (el) ['input', 'change'].forEach(function (ev) { el.addEventListener(ev, paint); }); });
    $('cp-dp').addEventListener('input', paint); $('cp-dp').addEventListener('change', paint);
    $('cp-more').addEventListener('click', function () {
      const hidden = panel.querySelectorAll ? panel.querySelectorAll('.cp-row') : [];
      for (let i = 0; i < hidden.length; i++) { if (hidden[i].classList.contains('hidden')) { hidden[i].classList.remove('hidden'); break; } }
    });
    paint();

    let saving = false;
    $('cp-save').addEventListener('click', function () {
      return window.busy($('cp-save'), async function () {
        if (saving) return;
        const err = $('cp-err');
        const fail = function (m) { err.textContent = m; err.classList.remove('hidden'); };
        err.classList.add('hidden');
        const val = FC.priceChangeOrder(read());
        if (!val.ok) { fail(val.error); return; }
        saving = true;
        try {
          // Fresh reads: nothing may have moved while the sheet was open.
          const freshReq = await readDoc('change_requests', req.id), freshCo = await readDoc('change_orders', req.id);
          if (!freshReq || !FC.canPriceRequest(freshReq.status, freshCo && freshCo.status)) { saving = false; fail('This change request changed while the sheet was open. Close it and try again.'); return; }
          let coNumber = (freshCo && freshCo.coNumber) || '';
          if (!coNumber) { try { const F = await formsApi(); if (F) coNumber = await F.nextNumber('CO'); } catch (_) { coNumber = ''; } }
          if (!coNumber) coNumber = 'CO-' + FC.last6(req.id);
          const nowIso = new Date().toISOString(), uid = myUid(), who = whoName();
          await fsDb().collection('change_orders').doc(req.id).set({
            orderId: order.id, projectId: project.id, coNumber: coNumber, pricing: { lines: val.lines, price: val.price, addedDownPayment: val.addedDownPayment },
            status: 'priced', pricedBy: uid, pricedByName: who, pricedAt: nowIso, updatedAt: FV().serverTimestamp(),
          }, { merge: true });
          await fsDb().collection('change_requests').doc(req.id).update({ status: 'priced', coNumber: coNumber, pricedBy: uid, pricedByName: who, pricedAt: nowIso, updatedAt: FV().serverTimestamp() });
          try { if (window.logAudit) window.logAudit('update', 'change_order', req.id, { priced: true, co: coNumber }); } catch (_) {}
          await jobEvent(project.id, 'Change order priced — ' + coNumber);
          invalidate();
          window.closeModal();
          toast('Change order ' + coNumber + ' is priced. Next: the client signs it.', 'success');
          if (onDone) onDone();
        } catch (ex) { saving = false; fail('Failed: ' + (ex.message || ex.code)); }
      });
    });
  }

  async function declineRequest(requestIn, onDone) {
    if (!canPrice()) { toast('Only Sales or the President can decline a change request.', 'error'); return false; }
    try { await loadCore(); } catch (ex) { toast('Could not open the change screen: ' + (ex.message || ex.code), 'error'); return false; }
    const FC = window.FlowCore;
    const reason = await window.promptDialog({ title: 'Decline change request', message: 'Why is it declined? Production reads this. No prices.', placeholder: 'e.g. the client dropped the change', required: true, multiline: true, confirmLabel: 'Decline' });
    if (reason == null || !String(reason).trim()) return false;
    const why = String(reason).trim();
    if (FC.pesoInText(why)) { toast(FC.PESO_TEXT_MESSAGE, 'error'); return false; }
    try {
      const cur = await readDoc('change_requests', requestIn.id);
      if (!cur) { toast('This change request no longer exists.', 'error'); if (onDone) onDone(); return false; }
      if (!FC.canDeclineRequest(cur.status)) { toast('A ' + cur.status + ' change request cannot be declined.', 'error'); if (onDone) onDone(); return false; }
      const co = await readDoc('change_orders', cur.id);
      if (co && co.status === 'priced') await fsDb().collection('change_orders').doc(cur.id).update({ status: 'declined', updatedAt: FV().serverTimestamp() });
      await fsDb().collection('change_requests').doc(cur.id).update({ status: 'declined', declineReason: why, declinedBy: myUid(), declinedByName: whoName(), declinedAt: new Date().toISOString(), updatedAt: FV().serverTimestamp() });
      try { if (window.logAudit) window.logAudit('update', 'change_request', cur.id, { declined: true }); } catch (_) {}
      await jobEvent(cur.projectId, 'Change request declined');
      invalidate();
      toast('Change request declined', 'success');
      if (onDone) onDone();
      return true;
    } catch (ex) { toast('Could not decline it: ' + (ex.message || ex.code), 'error'); return false; }
  }

  // ═══ C3 — attach the signed copy ═════════════════════════════════════════════════════════════════════════════════════════
  async function openSignSheet(requestIn, onDone) {
    if (!canPrice()) { toast('Only Sales or the President can attach the signed change order.', 'error'); return; }
    try { await loadCore(); } catch (ex) { toast('Could not open the change screen: ' + (ex.message || ex.code), 'error'); return; }
    const FC = window.FlowCore;
    let req, co, project;
    try {
      req = await readDoc('change_requests', requestIn.id);
      co = req ? await readDoc('change_orders', req.id) : null;
      project = req ? await readDoc('job_projects', req.projectId) : null;
    } catch (ex) { toast('Could not read the change order: ' + (ex.message || ex.code), 'error'); return; }
    if (!req || !co) { toast('This change order no longer exists.', 'error'); return; }
    if (!FC.canSignOrder(co.status)) { toast('This change order is already ' + String(co.status || '').toLowerCase() + '.', 'error'); if (onDone) onDone(); return; }
    const myRole = isPresident() ? 'President' : ((window.userProfile && (window.userProfile.title || window.userProfile.jobTitle)) || 'Sales');
    const body =
      '<div style="font-size:12px;margin-bottom:10px;overflow-wrap:anywhere"><strong>' + esc((project && project.clientName) || req.clientName || '') + '</strong> · ' + esc(co.coNumber || '') + '</div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Print the change order from the job, have the client sign it, then upload the signed copy (a photo or PDF).</div>' +
      '<div id="cs-upload" style="margin-bottom:12px"></div>' +
      '<div class="form-group"><label>Signed by (client)</label><input id="cs-client" type="text" autocomplete="off" style="' + FIELD + '"/></div>' +
      '<div class="form-group"><label>Date signed</label><input id="cs-date" type="date" style="' + FIELD + '" value="' + esc(window.today ? window.today() : '') + '"/></div>' +
      '<div class="form-row"><div class="form-group"><label>Signed for Barro by</label><input id="cs-barro" type="text" autocomplete="off" style="' + FIELD + '" value="' + esc(whoName()) + '"/></div>' +
      '<div class="form-group"><label>Role</label><input id="cs-role" type="text" autocomplete="off" style="' + FIELD + '" value="' + esc(myRole) + '"/></div></div>' +
      '<div id="cs-err" class="error-msg hidden"></div>';
    const footer = '<button class="btn-primary" id="cs-save" style="' + BTN + '">Save signed copy</button><button class="btn-secondary" onclick="closeModal()" style="' + BTN + '">Cancel</button>';
    const panel = window.openPage('Signed change order — ' + esc((project && project.clientName) || ''), body, footer);
    const $ = function (id) { return panel.querySelector('#' + id); };
    let file = null;
    if (window.Drive && window.Drive.renderUploadArea) window.Drive.renderUploadArea('cs-upload', function (r) { file = r; }, { label: 'Upload signed change order (photo/PDF)', accept: 'image/*,.pdf', dept: 'Sales', subfolder: 'ChangeOrders' });
    let signing = false;
    $('cs-save').addEventListener('click', function () {
      return window.busy($('cs-save'), async function () {
        if (signing) return;
        const err = $('cs-err');
        const fail = function (m) { signing = false; err.textContent = m; err.classList.remove('hidden'); };
        err.classList.add('hidden');
        if (parseInt($('cs-upload') && $('cs-upload').dataset.busy, 10) > 0) { toast('Wait for the upload to finish', 'error'); return; }
        const clientSignedBy = String($('cs-client').value || '').trim(), date = String($('cs-date').value || '').trim();
        const barro = String($('cs-barro').value || '').trim(), role = String($('cs-role').value || '').trim();
        if (!file || !file.url) { fail('Attach the signed copy (a photo or PDF).'); return; }
        if (!clientSignedBy) { fail('Enter who signed for the client.'); return; }
        if (!date) { fail('Enter the date it was signed.'); return; }
        if (!barro) { fail('Enter who signed for Barro.'); return; }
        signing = true;                     // before the first await: a double tap saves the signed copy once
        try {
          const freshCo = await readDoc('change_orders', req.id);
          if (!freshCo || !FC.canSignOrder(freshCo.status)) { signing = false; toast('This change order was already signed or changed.', 'error'); if (onDone) onDone(); return; }
          const nowIso = new Date().toISOString();
          await fsDb().collection('change_orders').doc(req.id).update({
            signed: { url: file.url, name: file.name || null, clientSignedBy: clientSignedBy, date: date, signedForBarroBy: barro, signedForBarroRole: role, by: myUid(), byName: whoName(), at: nowIso },
            status: 'signed', updatedAt: FV().serverTimestamp(),
          });
          await fsDb().collection('change_requests').doc(req.id).update({ status: 'signed', signedAt: nowIso, updatedAt: FV().serverTimestamp() });
          try { if (window.logAudit) window.logAudit('update', 'change_order', req.id, { signed: true }); } catch (_) {}
          await jobEvent(req.projectId, 'Change order signed — ' + (co.coNumber || ''));
          // §12: Production is told. NO amounts.
          await step(function () {
            return window.Notifs.sendToDept('Production', { title: '✍️ Change order signed', body: ((project && project.clientName) || req.clientName || '') + ' — ' + (co.coNumber || '') + '. The new job order follows.', icon: '✍️', type: 'change_order_signed', link: 'projects-lifecycle', dedupKey: 'cosigned-' + req.id }, { fallbackToOwner: true });
          });
          invalidate();
          window.closeModal();
          toast('Signed copy saved', 'success');
          if (onDone) onDone();
        } catch (ex) { fail('Failed: ' + (ex.message || ex.code)); }
      });
    });
  }

  // ═══ the job page block ═══════════════════════════════════════════════════════════════════════════════════════════════════
  async function loadOrderClaims(orderId) {
    try {
      const snap = await fsDb().collection('payment_claims').where('orderId', '==', orderId).get();
      return snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).filter(function (c) { return c.kind === 'change_order'; });
    } catch (_) { return []; }
  }
  async function renderJobChanges(host, project, repaint) {
    if (!host || !project || !isFlow2(project)) return;
    try { await loadCore(); } catch (_) { return; }
    const FC = window.FlowCore;
    let reqs;
    try {
      const snap = await fsDb().collection('change_requests').where('projectId', '==', project.id).get();
      reqs = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).sort(function (a, b) { return secs(b.requestedAt) - secs(a.requestedAt); });
    } catch (_) { host.innerHTML = ''; return; }
    const prices = seesPrices();
    const cos = {};
    let claims = [];
    // Pesos are read ONLY by a viewer the rules let read them. A Production login stops at change_requests.
    if (prices && reqs.length) {
      try { (await fsDb().collection('change_orders').where('projectId', '==', project.id).get()).docs.forEach(function (d) { cos[d.id] = Object.assign({ id: d.id }, d.data()); }); } catch (_) {}
      if (project.salesOrderId && Object.keys(cos).some(function (k) { return cos[k].status === 'signed'; })) claims = await loadOrderClaims(project.salesOrderId);
    }
    const F = prices ? await formsApi() : null;
    const open = project.stage !== 'paid' && project.stage !== 'cancelled';
    const again = function () { if (repaint) repaint(); };
    const pricer = canPrice();
    const card = function (r) {
      const co = cos[r.id];
      const word = FC.requestStatusWord(r);
      const items = []
        .concat((r.itemsAdded || []).length ? ['Added: ' + r.itemsAdded.map(lineText).join(', ')] : [])
        .concat((r.itemsRemoved || []).length ? ['Removed: ' + r.itemsRemoved.map(lineText).join(', ')] : [])
        .concat(Number(r.effectOnDeadlineDays) ? ['Deadline: ' + (r.effectOnDeadlineDays > 0 ? '+' : '−') + Math.abs(r.effectOnDeadlineDays) + ' day' + (Math.abs(r.effectOnDeadlineDays) === 1 ? '' : 's')] : []);
      const photos = (r.photos || []).filter(function (x) { return x && x.url; }).map(function (x, i) { return '<a href="' + esc(window.safeHttpUrl ? window.safeHttpUrl(x.url) : x.url) + '" target="_blank" rel="noopener">photo ' + (i + 1) + '</a>'; });
      let priceLine = '', buttons = '';
      if (co && prices) {
        const dp = Number(co.pricing && co.pricing.addedDownPayment) || 0;
        const dpState = FC.claimStatusFor(dp, claims.filter(function (c) { return c.changeOrderId === co.id; }));
        const dpWord = dp > 0 && co.status === 'signed' ? ({ recorded: 'confirmed', pending: 'waiting for confirmation', partial: 'partly confirmed', payment_rejected: 'sent back' }[dpState] || 'not recorded yet') : '';
        priceLine = '<div style="margin-top:4px">' + esc(co.coNumber || '') + ' · <strong>' + signedMoney(co.pricing && co.pricing.price) + '</strong>' + (dp > 0 ? ' · added down payment ' + money(dp) + (dpWord ? ' (' + dpWord + ')' : '') : '') + '</div>';
        const ready = co.status === 'signed' && (dp <= 0 || dpState === 'recorded');
        if (pricer && co.status === 'signed' && dp > 0 && dpState !== 'recorded' && dpState !== 'pending' && dpState !== 'partial') buttons += '<button type="button" class="btn-primary btn-sm co-pay" style="' + BTN + '">Record down payment</button>';
        if (pricer && ready) buttons += '<button type="button" class="btn-primary btn-sm co-revise" style="' + BTN + '">Revise contract amount</button>';
        if (F) buttons += String(F.buttonHtml('change_order', { docId: co.id, orderId: co.orderId, projectId: co.projectId }, { label: 'Change order' }) || '');
      }
      if (pricer && r.status === 'requested') buttons += '<button type="button" class="btn-primary btn-sm co-price" style="' + BTN + '">Price change order</button>';
      if (pricer && r.status === 'priced') buttons += '<button type="button" class="btn-primary btn-sm co-sign" style="' + BTN + '">Attach signed copy</button><button type="button" class="btn-secondary btn-sm co-price" style="' + BTN + '">Edit price</button>';
      if (pricer && FC.canDeclineRequest(r.status)) buttons += '<button type="button" class="btn-secondary btn-sm co-decline" style="' + BTN + '">Decline</button>';
      return '<div class="co-item" data-id="' + esc(r.id) + '" style="padding:8px 0;border-top:1px solid var(--border);overflow-wrap:anywhere">' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><strong>' + esc(when(r.requestedAt)) + '</strong> · ' + esc(r.requestedByName || '') + ' <span class="badge ' + (WORD_BADGE[r.status] || 'badge-gray') + '" style="font-size:10px">' + esc(word) + '</span></div>' +
        '<div style="margin-top:3px">' + esc(r.details || '') + '</div>' +
        (items.length ? '<div style="color:var(--text-muted);margin-top:2px">' + items.map(esc).join(' · ') + '</div>' : '') +
        (photos.length ? '<div style="margin-top:2px">' + photos.join(' · ') + '</div>' : '') +
        (r.status === 'declined' && r.declineReason ? '<div style="color:var(--danger);margin-top:2px">' + esc(r.declineReason) + '</div>' : '') + priceLine +
        (buttons ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">' + buttons + '</div>' : '') + '</div>';
    };
    host.innerHTML = '<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:8px 0 4px">Change requests</div>' +
      '<div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:10px 14px;font-size:12px">' +
      (canRecord() && open ? '<button type="button" class="btn-secondary btn-sm co-record" style="' + BTN + '">Record change request</button>' : '') +
      (reqs.length ? reqs.map(card).join('') : '<div style="color:var(--text-muted);margin-top:' + (canRecord() && open ? '8' : '0') + 'px">No change requests on this job.</div>') + '</div></div>';
    try { if (F && F.bind) F.bind(host); } catch (_) {}
    const on = function (el, fn) { if (el) el.addEventListener('click', function (ev) { ev.stopPropagation(); return fn(); }); };
    on(host.querySelector('.co-record'), function () { return openRequestSheet(project, again); });
    host.querySelectorAll('.co-item').forEach(function (el) {
      const r = reqs.find(function (x) { return x.id === el.dataset.id; });
      if (!r) return;
      on(el.querySelector('.co-price'), function () { return openPriceSheet(r, again); });
      on(el.querySelector('.co-sign'), function () { return openSignSheet(r, again); });
      on(el.querySelector('.co-decline'), function () { return declineRequest(r, again); });
      on(el.querySelector('.co-pay'), function () {
        return window.ensureScript('js/payment-claims-ui.js').then(function () { return window.PaymentClaimsUI.openRecordSheet({ projectId: project.id }, again); }).catch(function () { toast('Could not open the payment screen.', 'error'); });
      });
      on(el.querySelector('.co-revise'), function () {
        return window.ensureScript('js/contract-ui.js').then(function () { return window.ContractUI.openReviseSheet({ id: (cos[r.id] || {}).orderId || project.salesOrderId }, again); }).catch(function () { toast('Could not open the contract screen.', 'error'); });
      });
    });
  }

  window.ChangeOrders = {
    canRecord: canRecord, canPrice: canPrice, seesPrices: seesPrices,
    openRequestSheet: openRequestSheet, openPriceSheet: openPriceSheet, declineRequest: declineRequest, openSignSheet: openSignSheet, renderJobChanges: renderJobChanges,
  };
})();
