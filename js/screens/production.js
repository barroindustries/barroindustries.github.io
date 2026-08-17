/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Production + Purchasing + Projects screens
   js/screens/production.js

   Wave 7 Pass 4 — split out of js/departments.js verbatim, 2026-08-03,
   following the Wave 2 (design.js) / Wave 7 Pass 1-3 (tasks.js/sales.js/
   hr.js) extraction protocol. Still plain `window.*`-attached globals, no
   ESM, no bundler — this file is a physical split only, not a module. This
   was a single CONTIGUOUS tail of departments.js (its last 2616 lines,
   ex-7756..10371) — every function below belonged to one of three adjacent
   file sections ("PRODUCTION DEPARTMENT", "PROJECT LIFECYCLE", "PURCHASING
   DEPARTMENT") with nothing else interleaved, so this was a single cut, not
   a stitched-together set of excerpts.

   Contents:
   - Production stage machinery: PROD_STAGES/LEGACY_PROD_STAGE/
     normProdStageId/prodStage/trackerKeyFor/prodToJobStage, the QC
     checklist (QC_CHECKLIST/openQCModal), the Delivery Receipt flow
     (openDeliveryReceiptModal/printDeliveryReceipt).
   - Project Lifecycle (job_projects spine): JOB_STAGES/jobStage/
     _isFinAdmin, createJobProject, window.renderProjectLifecycle,
     openJobProjectDetail, openProjectMarginModal, advanceProjectStage,
     openProjectBillingModal, openJobBillingInvoiceModal.
   - Production Department screen: window.renderProductionDept/
     loadProdContent/renderProdOrders, syncJobFromProdStage,
     consumeProductionMaterials, prodOrderModal, the Inventory Count Form
     (PROD_COUNT_DRAFT_KEY/loadCountDraft/saveCountDraft/
     renderProdInventoryForm/openInventoryCountForm), renderProdMaterials.
   - Purchasing Department screen: purchTotal, window.renderPurchasing/
     loadPurchasingContent, RFQs (renderRFQs/purchRfqCard/bindRfqCard/
     openRfqModal), Purchase Requests (poState/poApproved/PURCH_STAT/
     window.exportPurchasesCSV/renderPurchaseRequests), receiving
     (receivePurchaseIntoInventory/receiveLineIntoItem/openReceiveResolver),
     notifications (notifyFinanceTeam/notifyPoApprovers), the PO approval
     service (window.approvePurchaseOrder/window.rejectPurchaseOrder — the
     ONE implementation shared by this screen's inline buttons AND the
     unified Approvals queue), recordPurchaseDisbursement, and the print
     builders printPurchaseOrder/printReceivingReport (moved alongside
     printDeliveryReceipt above — all three are exclusively
     Production/Purchasing helpers with no outside callers, so per the
     Wave 7 spec's "move print builders only if they move cleanly" rule
     they came with their screens rather than staying in departments.js).

   Wave 7 Pass 4 conversion (8-point treatment):
   1. chipTabs — killed two remaining hand-rolled .subtab-bar instances:
      the Inventory Count Form's kind filter (All/Raw Materials/Finished
      Goods, was a straggler not mentioned in the spec's "known four") and
      the Purchase Requests status filter (all/pending/ordered/received).
      Both now render via window.chipTabs()/window.bindChipTabs() like
      every other in-page filter bar in the app.
   2. Surfaces — already 100% openPage; no raw #page-content swaps or
      stray modal/detail flows found. Verified, unchanged.
   3. Loading/empty/error — window.renderProjectLifecycle and
      loadProdContent (Production's Orders/Materials/Count Form/Tasks/Files
      dispatcher, previously unwrapped) now catch fetch failures into a
      "Couldn't load — Retry" block (same markup/idiom as sales.js's
      renderBKQuotationsSummary etc.), instead of production_orders/
      job_projects/inventory_items query failures silently rendering as
      "0 items" via `.catch(()=>({docs:[]}))` — a real permission error
      used to look identical to an empty department. loadPurchasingContent's
      existing error block gained the same Retry button (it had the
      message but no way to retry without navigating away and back).
      Hand-rolled empty-states matching window.renderEmptyState()'s exact
      shape (icon + h4 + p) were switched to call the helper instead of
      duplicating its markup: renderProjectLifecycle ("No projects yet"),
      renderProdOrders ("No production orders yet"), renderProdMaterials
      ("No materials in inventory yet"), renderProdInventoryForm ("No items
      in inventory", wrapped inside its <td colspan>), renderRFQs ("No open
      RFQs"), renderPurchaseRequests ("No purchase requests yet").
   4. Tables — .table-cards markup (RFQ items, PR items) verified intact
      post-move; no dense table was newly flagged as missed (in scope for
      this pass per the task brief's "verify-intact", not a retrofit sweep).
   5. Icons — Lucide-only sinks confirmed (no emojiIcon() HTML leaking into
      Notifs.showToast/success/error text sinks — those were already plain
      text/no-icon). One true icon-only button was missing an aria-label:
      openRfqModal's per-row "✕" remove button (id class `ri-del`) had only
      a `title` attribute; added `aria-label="Remove item"` to match its
      siblings `pm-del`/`rfq-del`, which already had one.
   6. Headers — one page header each (Production/Purchasing/Projects);
      verified, unchanged.
   7. Styling — no confident token-swap opportunities found beyond what
      already used var(); the PROD_STAGES/JOB_STAGES literal hex badge
      colors are the same intentional fixed-palette pattern CRM_STAGES/
      AEC_STAGES use elsewhere (data tables, not incidental inline styles)
      — left as-is, matching "no forced sweep".
   8. sopPanel — Production already had one; Purchasing ALSO already had
      one (window.sopPanel('How Purchasing works', …) — contrary to the
      spec's "known gap" list, it was already present here). Verified, no
      action needed.

   DELIBERATELY LEFT IN departments.js (grepped for outside callers before
   this move; genuinely shared services/posters per the Wave 7 spec):
     - window.Projects (the job_projects/'projects' read-normalization
       service, ~departments.js:55) — read by js/bir.js, js/app.js (Company
       Overview/dashboards), js/screens/design.js AND this file's
       window.renderProjectLifecycle, all as a bare window.* call. A true
       cross-department service, stays put.
     - window.openBillingInvoice / buildBillingInvoiceHTML — sits between
       the old Sales and Design sections in departments.js. Genuinely
       SHARED: js/screens/design.js's project-billing flow calls it AND
       this file's openJobBillingInvoiceModal/openJobProjectDetail call it
       (departments.js:8126/8434 pre-move) — two different screens files
       depend on one shared printable-invoice builder, so per the spec's
       "when shared, it stays" rule it stays in departments.js exactly as
       sales.js's header already documented for its own (non-)move of the
       same function.
     - nextCounterId (the generic `_counters/{name}` atomic-sequence
       helper) — this file's createJobProject/prodOrderModal both call it
       for JP-/PO- numbers, but it's also used well outside this file's
       old boundaries (AEC numbering, etc. — see sales.js's header), so it
       stays a shared departments.js helper.
     - The Ledger service (window.Ledger.post/postMulti), postCDJToLedger,
       assertPeriodOpen, BankAccounts, safeNotify, isFinancePriv,
       canEditDept, deptContainer, dbCachedGet/dbCacheInvalidate,
       fetchUsersWithPayroll-style generic app helpers — untouched,
       called as window.* / bare-global at runtime like every other pass.
     - window.renderInventory (Inventory screen) lives in js/modules.js —
       explicitly out of scope for this pass; loadProdContent and
       loadFinanceContent both still call it as `window.renderInventory`.
     - Approvals (renderApprovals, still in departments.js) calls this
       file's window.approvePurchaseOrder/window.rejectPurchaseOrder via
       js/svc-approvals.js's poApprove/poReject wrappers — same
       window.*-at-runtime pattern, no ordering requirement.

   LOAD-ORDER CONTRACT (see index.html + CLAUDE.md "Script load order is
   load-bearing"):
     - Loads AFTER js/departments.js and js/screens/design.js/tasks.js/
       sales.js/hr.js. Every function in this file runs only at runtime
       (click handlers, navigateTo() dispatch, promise callbacks) — never
       at parse time — so load order relative to departments.js's shared
       helpers only matters for calls made after the whole app has booted.
     - window.renderProductionDept / window.renderPurchasing /
       window.renderProjectLifecycle are the entry points js/app.js's
       navigateTo() switch calls (cases 'Production', 'Purchasing',
       'projects-lifecycle') and js/config.js's nav config references, all
       as window.* — resolves fine regardless of which file defines them.
     - departments.js's loadFinanceContent (Finance → Purchases tab) calls
       this file's renderPurchaseRequests as a bare identifier — same
       forward-reference pattern documented in hr.js/sales.js's headers (a
       top-level function declaration in any deferred classic script
       becomes a `window` property, so the bare-identifier call resolves
       regardless of load order once both scripts have parsed).
     - PROD_STAGES/JOB_STAGES/QC_CHECKLIST/PURCH_STAT/PROD_COUNT_DRAFT_KEY
       are plain top-level `const`s (script-scoped, NOT window properties
       in a browser — same caveat design.js/tasks.js/hr.js document for
       their own top-level consts) and must stay in THIS file alongside
       their only readers. CORRECTION (v14 prod-fixlist audit — the note
       that used to live here was wrong): js/ui-status-meta.js reads
       `window.PROD_STAGES` / `window.PURCH_STAT` (for its generic
       statusBadge2() lookup), and BOTH names ARE assigned onto `window`
       right at their declaration (`const PROD_STAGES = window.PROD_STAGES
       = [...]` below, and `const PURCH_STAT = window.PURCH_STAT = {...}`
       further down) — those lookups resolve correctly today. The old
       claim that neither was ever window-assigned was simply incorrect;
       don't "fix" this as a bug based on it.
   ═══════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════
//  PRODUCTION DEPARTMENT — shop-floor work orders
// ═══════════════════════════════════════════════════
// v12 WS28: the owner's real shop-floor flow + terminal Delivered.
const PROD_STAGES = window.PROD_STAGES = [
  { id:'layouting',        label:'Layouting',             icon:'📐', color:'#78909c' },
  { id:'bending_cutting',  label:'Bending & Cutting',     icon:'✂️', color:'#5c6bc0' },
  { id:'assembly',         label:'Assembly',              icon:'🛠️', color:'#26a69a' },
  { id:'finishing',        label:'Finishing & Polishing', icon:'✨', color:'#26c6da' },
  { id:'qc',               label:'Quality Checking',      icon:'🔍', color:'#ffa726' },
  { id:'out_for_delivery', label:'Out for Delivery',      icon:'🚚', color:'#66bb6a' },
  { id:'delivered',        label:'Delivered',             icon:'✅', color:'#43a047' },
];
// Legacy → v12 id normalization. Docs written before the rename keep their old
// stage string until their next stage write; EVERY read site must go through
// normProdStageId() so no in-flight order visually resets to stage 1 (the old
// find-or-fallback-to-first behavior). Do NOT bulk-rewrite stored ids — stale
// service-worker clients may write old ids for a while, and the shim absorbs that.
const LEGACY_PROD_STAGE = { queued:'layouting', cutting:'bending_cutting', welding:'assembly', ready:'out_for_delivery' };
function normProdStageId(id){ id = id || 'layouting'; return LEGACY_PROD_STAGE[id] || id; }
function prodStage(id){ const n = normProdStageId(id); return PROD_STAGES.find(s=>s.id===n) || PROD_STAGES[0]; }

// Single source of truth: internal stage id (EITHER vocabulary — the two id sets
// never collide on a key with different targets) → public order_tracking status.
// Early shop-floor stages intentionally return null; the prod-advance call site
// decides whether to push the generic 'production' bucket (forward-only guard).
// Replaces the three drifted inline maps (old JOB_STAGES map / the two prod-advance
// maps; the old JOB_STAGES map's qc/ready keys were dead code and are dropped).
function trackerKeyFor(id){
  return ({ won:'confirmed', in_design:'design', in_production:'production',
            qc:'qc', out_for_delivery:'ready', for_delivery:'ready',
            delivered:'delivered', paid:'delivered' })[id] || null;
}
// Prod stage → the job_projects lifecycle stage it implies (forward-only at the call site).
function prodToJobStage(prodId){
  return prodId==='delivered' ? 'delivered' : prodId==='out_for_delivery' ? 'for_delivery' : 'in_production';
}

// ── panelLive(panel) — "is this openPage window still actually open?" ────────
// The guard every deferred body-fill in this file checks before touching the
// panel it was handed (v14 tap-latency inversion, below: openPage now fires on
// the tap frame with a skeleton and the real markup is poured in when the read
// lands, so the user can press Back mid-flight and routinely will).
//
// isConnected ALONE IS NOT ENOUGH. openPage's teardown (js/app.js) removes the
// node on a `setTimeout(…, 300)` so the exit transition has something to
// animate — for those 300ms a closed panel is still `document`-connected, and a
// fill that lands inside that window would flash real content onto a surface
// that is visibly sliding away. window._pageStack, by contrast, is spliced
// SYNCHRONOUSLY in that same teardown (and cleared outright on logout,
// js/app.js), so absence from it is the authoritative "closed" signal.
// Requiring both means a mid-flight fill is a clean no-op: nothing is painted,
// no listener is bound, and nothing can resurrect a dismissed window.
//
// Reading window._pageStack from outside app.js is the same cross-module read
// js/chat.js already makes (its `alreadyOpen` test) — it is a documented global
// that app.js publishes deliberately, not a private.
function panelLive(panel){
  return !!panel && panel.isConnected &&
         !!(window._pageStack && window._pageStack.indexOf(panel) !== -1);
}

// The hardcoded QC checklist (v12 WS28). Universal; edit labels here to change
// the shop's checklist. Per-product variants = future workstream (YAGNI for now).
const QC_CHECKLIST = [
  { id:'dims',     label:'Dimensions match drawing / layout' },
  { id:'welds',    label:'Welds ground smooth — no pinholes, spatter or sharp edges' },
  { id:'finish',   label:'Surface finish & polish uniform, no deep scratches' },
  { id:'moving',   label:'Doors / drawers / moving parts aligned and operating' },
  { id:'level',    label:'Unit sits level; legs / feet adjusted' },
  { id:'clean',    label:'Cleaned & degreased; protective film / stickers removed' },
  { id:'complete', label:'Quantity & accessories complete vs the order' },
];

function openQCModal(order, onSaved){
  const prev = order.qc || null;
  const stateOf = id => prev?.items?.find(i=>i.id===id)?.state || '';
  const _panel = openPage(`${emojiIcon('🔍',16)} Quality Checking — `+escHtml(order.orderNo||order.title||''), `
    ${prev?`<div style="font-size:11px;margin-bottom:8px;color:${prev.result==='passed'?'var(--success)':'var(--danger)'}">Last inspection: <b>${prev.result}</b> · ${escHtml(prev.byName||'')} · ${prev.at?new Date(prev.at).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):''}</div>`:''}
    <div style="display:flex;flex-direction:column">
      ${QC_CHECKLIST.map(it=>`
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;border-bottom:1px solid var(--border);padding:7px 0">
          <span style="font-size:12px;flex:1">${escHtml(it.label)}</span>
          <span style="display:flex;gap:8px;flex-shrink:0">
            ${/* Native radios (13px) — deliberately no inline width/height, matching the
                  checkbox/radio carve-out in css/styles.css. The vertical padding is the
                  point: each of the three was a 32x21 target 3px from its neighbour, and
                  the tap that slips from ❌ to ✅ passes a unit that failed inspection.
                  Padding is 6px vertical / 2px horizontal on purpose — horizontal padding
                  steals width from the checklist text beside it (flex:1), which would just
                  push every row into three lines. */''}
            ${['pass','fail','na'].map(s=>`<label style="font-size:11px;display:flex;align-items:center;gap:3px;cursor:pointer;padding:6px 2px"><input type="radio" name="qc-${it.id}" value="${s}" ${stateOf(it.id)===s?'checked':''}/>${s==='pass'?`${emojiIcon('✅',16)}`:s==='fail'?`${emojiIcon('❌',16)}`:'N/A'}</label>`).join('')}
          </span>
        </div>`).join('')}
    </div>
    <div class="form-group" style="margin-top:10px"><label>Inspection notes</label><textarea id="qc-notes" rows="2" placeholder="Rework needed, remarks…">${escHtml(prev?.notes||'')}</textarea></div>
    <div id="qc-err" class="error-msg hidden"></div>
  `, `<button class="btn-primary" id="qc-save">Save Inspection</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  // ⚠ SCOPED TO THIS PANEL, NOT document.
  // openPage keeps a CLOSING page in the DOM for ~300ms. Inspect two orders in
  // a row and both panels carry `#qc-save`/`#qc-notes` and the same
  // `qc-<item>` radio names — document.* resolves the DYING panel first, so the
  // visible Save does nothing and, once it does fire, it reads the PREVIOUS
  // order's checklist and writes that inspection onto this order.
  _panel.querySelector('#qc-save').addEventListener('click', async ()=>{
    const err = _panel.querySelector('#qc-err');
    const items = QC_CHECKLIST.map(it=>({ id:it.id, label:it.label,
      state: _panel.querySelector(`input[name="qc-${it.id}"]:checked`)?.value || '' }));
    if (items.some(i=>!i.state)) { err.textContent='Mark every item (pass / fail / N/A).'; err.classList.remove('hidden'); return; }
    if (items.every(i=>i.state==='na')) { err.textContent='At least one item must actually be inspected (not all N/A).'; err.classList.remove('hidden'); return; }
    const result = items.some(i=>i.state==='fail') ? 'failed' : 'passed';
    const qc = { result, items, notes: _panel.querySelector('#qc-notes').value.trim(),
      by: currentUser.uid, byName: userProfile?.displayName||currentUser.email||'', at: new Date().toISOString() };
    try {
      await db.collection('production_orders').doc(order.id).update({ qc, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('production_orders');
      window.logAudit && window.logAudit('update','production_order',order.id,{ qc: result });
      Notifs.showToast(result==='passed' ? 'QC passed — press Advance → to move the order on.' : 'QC failed — rework, then re-inspect.', result==='passed'?undefined:'error');
      closeModal(); onSaved && onSaved();
    } catch(ex){ err.textContent='Save failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
  });
}

function openDeliveryReceiptModal(order, onSaved, opts){
  const dr = order.deliveryReceipt || null;
  if (dr) {   // view / reprint mode
    const _viewPanel = openPage(`${emojiIcon('🧾',16)} Delivery Receipt — `+escHtml(dr.no||''), `
      <div style="font-size:12px;display:grid;grid-template-columns:auto 1fr;gap:4px 12px">
        <span style="color:var(--text-muted)">Receipt #</span><b>${escHtml(dr.no||'')}</b>
        <span style="color:var(--text-muted)">Received by</span><span>${escHtml(dr.receivedBy||'')}</span>
        <span style="color:var(--text-muted)">Date</span><span>${escHtml(dr.date||'')}</span>
        ${dr.notes?`<span style="color:var(--text-muted)">Notes</span><span>${escHtml(dr.notes)}</span>`:''}
        <span style="color:var(--text-muted)">Recorded by</span><span>${escHtml(dr.byName||'')}</span>
      </div>`,
      `<button class="btn-primary" id="dr-print">${emojiIcon('🖨',16)} Print</button><button class="btn-secondary" onclick="closeModal()">Close</button>`);
    // ⚠ SCOPED TO THIS PANEL, NOT document — see openQCModal's note above.
    _viewPanel.querySelector('#dr-print')?.addEventListener('click', ()=>printDeliveryReceipt(order));
    return;
  }
  const dayStr = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10);
  const _panel = openPage(`${emojiIcon('🧾',16)} Record Delivery Receipt — `+escHtml(order.orderNo||order.title||''), `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Required before this order can be marked <b>Delivered</b>. Fill it in with the client's receiving rep at handover.</div>
    <div class="form-row">
      <div class="form-group"><label>Received by (client rep)</label><input id="dr-name" placeholder="e.g. Maria Santos — Purchasing"/></div>
      <div class="form-group" style="flex:0 0 140px"><label>Date</label><input id="dr-date" type="date" value="${dayStr}"/></div>
    </div>
    <div class="form-group"><label>Notes (optional)</label><textarea id="dr-notes" rows="2" placeholder="Condition on arrival, partial delivery, etc."></textarea></div>
    <div id="dr-err" class="error-msg hidden"></div>
  `, `<button class="btn-primary" id="dr-save">Save Receipt</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`, opts || {});
  // ⚠ SCOPED TO THIS PANEL, NOT document — see openQCModal's note above. A
  // receipt recorded during the teardown window would otherwise take the
  // PREVIOUS order's "received by"/date/notes and burn a DR serial on them.
  _panel.querySelector('#dr-save').addEventListener('click', async ()=>{
    const err = _panel.querySelector('#dr-err');
    const receivedBy = _panel.querySelector('#dr-name').value.trim();
    if(!receivedBy){ err.textContent='"Received by" is required — the client rep who accepted the delivery.'; err.classList.remove('hidden'); return; }
    const btn=_panel.querySelector('#dr-save'); btn.disabled=true;
    try {
      const no = await window.nextSerial('delivery_receipt','DR');   // DR-2026-000001 (atomic; a failed save burns a serial — fine)
      const byName = userProfile?.displayName||currentUser.email||'';
      const deliveryReceipt = { no, receivedBy, date: _panel.querySelector('#dr-date').value || dayStr,
        notes: _panel.querySelector('#dr-notes').value.trim(), by: currentUser.uid, byName, at: new Date().toISOString() };
      await db.collection('production_orders').doc(order.id).update({ deliveryReceipt, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('production_orders'); dbCacheInvalidate('job_projects'); }
      if (order.projectId) { try { await db.collection('job_projects').doc(order.projectId).update({
        documents: firebase.firestore.FieldValue.arrayUnion({ type:'Delivery Receipt', ref:no, at:new Date().toISOString(), by:byName }),
        timeline:  firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:'Delivery receipt '+no+' recorded', by:byName }),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp() }); } catch(_) {} }
      window.logAudit && window.logAudit('update','production_order',order.id,{ deliveryReceipt: no });
      Notifs.success('Receipt '+no+' recorded — press Advance → again to mark Delivered.');
      closeModal(); onSaved && onSaved();
    } catch(ex){ err.textContent='Save failed: '+(ex.message||ex.code); err.classList.remove('hidden'); btn.disabled=false; }
  });
}

// Printable Delivery Receipt on letterhead — cloned from printPurchaseOrder's
// standalone-page skeleton (style block, A4 .page layout, window.open+
// document.write tail). No prices anywhere — a delivery receipt is not an invoice.
function printDeliveryReceipt(order) {
  const e = s => escHtml(s == null ? '' : String(s));
  const dr = order.deliveryReceipt || {};
  const _lh = window.buildLetterhead ? window.buildLetterhead({
    docTitle: 'DELIVERY RECEIPT',
    docNumber: dr.no || '',
    dateLabel: 'Date: ' + (dr.date || ''),
    extraMeta: [ 'Work Order: ' + (order.orderNo || ''), order.quoteRef ? ('Quote: ' + order.quoteRef) : null ].filter(Boolean),
    signatures: [
      { label: 'Delivered by', name: dr.byName || '', title: 'Production — Barro Industries' },
      { label: 'Received by (client)', name: dr.receivedBy || '', title: order.client || '' }
    ],
    footerNote: ((window.BRAND && window.BRAND.fullName) || 'Barro Industries') + ' · Generated ' + new Date().toLocaleString('en-PH')
  }) : null;

  const rows = `<tr>
      <td class="c">1</td>
      <td>${e(order.title || '—')}</td>
      <td class="c">${Number(order.qty || 0).toLocaleString('en-PH')}</td>
    </tr>`;
  let blanks = ''; for (let k = 1; k < 4; k++) blanks += `<tr class="blank"><td class="c">${k + 1}</td><td></td><td></td></tr>`;

  const pageCss = `
  .page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:14mm}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
  .pbox{border:1px solid #999;border-radius:6px;padding:8px 11px}
  .pbox .l{font-size:8px;text-transform:uppercase;letter-spacing:.6px;color:#1E3A5F;font-weight:800;margin-bottom:3px}
  .pbox .v{font-size:12px;font-weight:700;min-height:15px}
  table{margin-bottom:10px}
  th{background:#1E3A5F;color:#fff;font-size:9px;text-transform:uppercase;letter-spacing:.04em}
  .note{font-size:10px;color:#444;margin:4px 0 10px;line-height:1.5}
  .note b{color:#1E3A5F}
  @media print{ .page{padding:0;width:auto;min-height:0} }
${_lh ? _lh.printCSS : ''}`;
  const bodyHtml = `
  ${_lh ? _lh.headerHTML : `<div style="font-size:20px;font-weight:900">DELIVERY RECEIPT ${e(dr.no || '')}</div>`}
  <div class="parties">
    <div class="pbox">
      <div class="l">Deliver To</div>
      <div class="v">${e(order.client || '—')}</div>
    </div>
    <div class="pbox">
      <div class="l">Work Order</div>
      <div class="v">${e(order.orderNo || '')}</div>
    </div>
  </div>
  <table>
    <thead><tr><th style="width:32px">#</th><th>Description</th><th style="width:80px">Qty</th></tr></thead>
    <tbody>${rows}${blanks}</tbody>
  </table>
  ${dr.notes ? `<div class="note"><b>Notes:</b> ${e(dr.notes)}</div>` : ''}
  ${_lh ? _lh.footerHTML : ''}`;

  window.openPrintableDoc({
    title: `Delivery Receipt — ${dr.no || ''}`,
    barLabel: `${emojiIcon('🧾',16)} Delivery Receipt — ${e(dr.no || '')}`,
    bodyHtml, pageCss,
    winFeatures: 'width=900,height=720'
  });
}

// ═══════════════════════════════════════════════════
//  PROJECT LIFECYCLE — the spine tying quote → sales order → production →
//  delivery → completion → billing/payment into ONE job_projects record.
//  Every downstream doc references it via projectId. (Named job_projects to
//  avoid the unrelated Design 'projects' board.)
// ═══════════════════════════════════════════════════
const JOB_STAGES = [
  { id:'won',           label:'Won',           icon:'🤝', color:'#26a69a', dept:'Sales' },
  { id:'in_design',     label:'In Design',     icon:'🎨', color:'#ab47bc', dept:'Design' },
  { id:'in_production', label:'In Production', icon:'🏭', color:'#7e57c2', dept:'Production' },
  { id:'for_delivery',  label:'For Delivery',  icon:'📦', color:'#26c6da', dept:'Production' },
  { id:'delivered',     label:'Delivered',     icon:'🚚', color:'#42a5f5', dept:'Production' },
  { id:'completed',     label:'Completed',     icon:'✅', color:'#66bb6a', dept:'Sales' },
  { id:'paid',          label:'Paid / Closed', icon:'💰', color:'#43a047', dept:'Finance' },
  { id:'cancelled',     label:'Cancelled',     icon:'✖️', color:'#ef5350', dept:'Sales' },
];
function jobStage(id){ return JOB_STAGES.find(s=>s.id===id) || JOB_STAGES[0]; }
// COMPANY-AND-CALENDAR-SPEC-2026-08-12 §1.4 — JOB_STAGES is a top-level
// `const` in this classic script, so it is NOT on window and is unreachable
// from dashboards.js (which loads after this file). Expose it once here
// rather than duplicating the table on the Company "What We're Working On"
// projects list.
window.JOB_STAGES = JOB_STAGES;
const _isFinAdmin = () => ['president','owner','manager','finance'].includes(window.currentRole) || (window.currentDepts||[]).includes('Finance');

// Sales→Production handoff (owner's rule, 2026-08) — Production staff see WHAT to
// build (items, target date, priority, notes) and stage/status, never the deal's
// money (contract/AR/collected/margin/split/invoices). There is no dedicated
// 'production' system role (window.ROLES has none — see js/config.js) so this is
// keyed off department membership, same "role OR sole-department" shape isPartnerU
// uses elsewhere in this file: true only for genuine Production-dept staff who
// aren't ALSO Finance/Sales/admin/president (those keep the full money view).
function isProductionOnlyViewer(){
  if (_isFinAdmin()) return false;         // president/owner/manager/finance role, or Finance dept
  if (canEditDept('Sales')) return false;  // Sales dept members (or admin roles) keep the money view
  return canEditDept('Production');        // true only for Production-dept members
}


// ═══════════════════════════════════════════════════
//  PRIORITY STARS — one job priority, set by tapping stars
//  Owner request (2026-08-17): "allow to create priority by putting stars,
//  editable in production department and sales department."
//
//  The star count is NOT a new field. It is a rendering of the `priority`
//  string three collections already store, in the two vocabularies they
//  already use — job_projects/sales_orders write Title case ('Normal'),
//  production_orders write lower case ('medium'). Both are read back to the
//  same star count, so every existing badge, CSV column and filter that reads
//  `priority` keeps working untouched, and a job priority set before this
//  existed shows the right number of stars.
//
//  CANONICAL SOURCE IS job_projects.priority — the spine record for a won
//  quote. Firestore rules let ANY non-partner staff update a job_project as
//  long as the write doesn't touch money keys, so Production and Sales can
//  both set it with no rules change. The Sales Orders table therefore reads
//  and writes the LINKED PROJECT rather than sales_orders.priority, whose
//  update rule is gated to finance/design and would deny a Sales rep.
//  A work order's own star writes production_orders.priority (Production's
//  shop-floor field) and mirrors to its project, so the two never disagree.
// ═══════════════════════════════════════════════════
const PRIORITY_STARS = window.PRIORITY_STARS = [
  { n:1, title:'Low',    prod:'low',    hint:'Low — fit it in'            },
  { n:2, title:'Normal', prod:'medium', hint:'Normal — the standard queue' },
  { n:3, title:'High',   prod:'high',   hint:'High — ahead of normal work' },
  { n:4, title:'Urgent', prod:'urgent', hint:'Urgent — drop everything'    },
];
window.priorityToStars = function(v){
  const s = String(v==null?'':v).trim().toLowerCase();
  if (!s) return 0;
  if (s === 'low') return 1;
  if (s === 'normal' || s === 'medium' || s === 'med') return 2;
  if (s === 'high') return 3;
  if (s === 'urgent' || s === 'critical' || s === 'rush') return 4;
  return 0;   // unrecognised → unset, never a silent wrong star count
};
// vocab 'prod' for production_orders, 'title' (default) for job_projects / sales_orders.
window.starsToPriority = function(n, vocab){
  const row = PRIORITY_STARS.find(p => p.n === Number(n));
  if (!row) return '';
  return vocab === 'prod' ? row.prod : row.title;
};
window.priorityLabel = function(v){
  const n = window.priorityToStars(v);
  return n ? (PRIORITY_STARS.find(p=>p.n===n).title) : '';
};
// Plain ★★☆☆ text — for print, where a button is meaningless.
window.priorityStarsText = function(v){
  const n = window.priorityToStars(v);
  return n ? ('★'.repeat(n) + '☆'.repeat(4-n)) : '';
};
// Editable (or read-only) star row. coll+id say what a tap should write.
window.priorityStarPicker = function(opts){
  const o = opts || {};
  const n = window.priorityToStars(o.value);
  const editable = o.editable !== false && o.coll && o.id;
  const label = n ? PRIORITY_STARS.find(p=>p.n===n).title + ' priority' : 'No priority set';
  const cls = 'pstars' + (editable ? '' : ' pstars-ro') + (n>=4 ? ' pstars-urgent' : n===3 ? ' pstars-high' : '');
  const attrs = editable
    ? ` data-pcoll="${escHtml(o.coll)}" data-pid="${escHtml(o.id)}" data-pvocab="${escHtml(o.vocab||'title')}"${o.mirrorProject?` data-pmirror="${escHtml(o.mirrorProject)}"`:''}`
    : '';
  const stars = PRIORITY_STARS.map(p => {
    const on = p.n <= n;
    return editable
      ? `<button type="button" class="pstar${on?' on':''}" data-n="${p.n}" title="${escHtml(p.hint)}" aria-label="${escHtml(p.hint)}">${on?'★':'☆'}</button>`
      : `<span class="pstar${on?' on':''}">${on?'★':'☆'}</span>`;
  }).join('');
  return `<span class="${cls}"${attrs} data-stars="${n}" title="${escHtml(label)}">${stars}${
    o.showLabel !== false ? `<span class="pstars-lbl">${n?escHtml(PRIORITY_STARS.find(p=>p.n===n).title):'—'}</span>` : ''}</span>`;
};
// Repaints an EXISTING star row in place — never by replacing the node. The
// buttons carry the click listeners bindPriorityStars attached, so swapping the
// markup would mean rebinding, and any rebind that can reach a sibling row
// double-binds it: two listeners, two Firestore writes per tap, the second
// racing the first. Mutating text + classes keeps one listener per button for
// the life of the render.
function paintPriorityStars(row, stars, vocab){
  row.dataset.stars = String(stars);
  row.classList.toggle('pstars-urgent', stars >= 4);
  row.classList.toggle('pstars-high', stars === 3);
  row.classList.remove('pstars-busy');
  const title = window.starsToPriority(stars, 'title');
  row.title = stars ? (title + ' priority') : 'No priority set';
  row.querySelectorAll('.pstar').forEach(b => {
    const on = Number(b.dataset.n) <= stars;
    b.classList.toggle('on', on);
    b.textContent = on ? '★' : '☆';
  });
  const lbl = row.querySelector('.pstars-lbl');
  if (lbl) lbl.textContent = stars ? title : '—';
  return window.starsToPriority(stars, vocab);
}

// One binder for every star row inside `root`. afterSave(stars, coll, id) is
// optional — omit it and the row repaints itself in place with no reload, which
// is the point: setting a priority must never cost the user their scroll spot.
window.bindPriorityStars = function(root, afterSave){
  if (!root) return;
  root.querySelectorAll('.pstars[data-pcoll] .pstar').forEach(btn => {
    // Idempotent: a screen that binds the same subtree twice (a partial
    // re-render inside an already-bound container) must not stack listeners.
    if (btn.dataset.pbound) return;
    btn.dataset.pbound = '1';
    btn.addEventListener('click', async (ev) => {
      // Star rows sit inside cards and table rows that are themselves click
      // targets (expand / open detail) — without this, setting a priority also
      // navigates away from the list you were triaging.
      ev.preventDefault(); ev.stopPropagation();
      const row  = btn.closest('.pstars');
      const coll = row.dataset.pcoll, id = row.dataset.pid;
      const vocab = row.dataset.pvocab || 'title';
      const want = Number(btn.dataset.n);
      const cur  = Number(row.dataset.stars || 0);
      // Tapping the star you are already on clears the priority — otherwise a
      // priority set by mistake can only ever be changed, never removed.
      const stars = (want === cur) ? 0 : want;
      const value = window.starsToPriority(stars, vocab);
      row.classList.add('pstars-busy');
      try {
        await db.collection(coll).doc(id).update({
          priority: value,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate(coll);
        // A work order's star also moves its project, so Sales and Production
        // are never looking at two different priorities for one job. Strictly
        // best-effort: the work order's own field is the one that just saved.
        const mirror = row.dataset.pmirror;
        if (mirror) {
          try {
            await db.collection('job_projects').doc(mirror).update({
              priority: window.starsToPriority(stars, 'title'),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
            if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('job_projects');
          } catch(_) {}
        }
        paintPriorityStars(row, stars, vocab);
        Notifs.showToast(stars ? `Priority set to ${window.starsToPriority(stars,'title')}.` : 'Priority cleared.');
        afterSave && afterSave(stars, coll, id);
      } catch(e) {
        // Roll the display back to what is actually stored — a star row left
        // showing the value someone TRIED to set is worse than an error.
        paintPriorityStars(row, cur, vocab);
        Notifs.showToast('Could not set priority: ' + (e.message || e.code), 'error');
      }
    });
  });
};

// ═══════════════════════════════════════════════════
//  JOB ORDER — the printable sheet Production works from
//  Owner request (2026-08-17): "allow to create Job Order to print for
//  Production ... produced from the quote that is won ... do not show the
//  prices, show deadlines and schedule."
//
//  DELIBERATELY MONEY-FREE. Every job_projects doc carries contractAmount,
//  arBalance and quote line items complete with unitPrice/amount — this sheet
//  goes to the shop floor and to whoever is standing next to it, so not one of
//  those fields may reach the page. The item renderer below reads name/dims/
//  specs/qty/unit/leadTime by name and never iterates the item object, so a
//  new priced field added to the quote payload later cannot leak in by
//  accident. Same reason there is no showMoney branch here: there is no
//  audience for a priced Job Order.
//
//  Every job_project IS a won quote (createJobProject is only ever called from
//  the convert-a-won-quote flow), so "from the quote that is won" needs no
//  extra filter — the tab lists projects, and the sheet quotes the quote
//  number it came from.
// ═══════════════════════════════════════════════════

// Even spread of the shop-floor stages across the window we actually know
// (issue date → target completion). Labelled "Planned" on the sheet and
// footnoted, because it is a plan derived from two dates, not a commitment
// anyone made per stage. Returns [] when the target date is missing or behind
// the start — a blank ruled schedule is honest, invented dates are not.
// ═══════════════════════════════════════════════════
//  THE JOB ORDER SHEET
//  Modelled on the real document (JO-ML-FB-260730-001, Mamitas Bulaluhan) the
//  owner works from, not on a layout of this app's invention. Its shape is the
//  point: the floor ticks NINE stages PER ITEM as the work happens, and the
//  three checklists (pre-fabrication, QC before crating, delivery/turnover)
//  carry the standing conditions that otherwise live in somebody's head.
//
//  Everything here is money-free by construction — see joScopeRow.
// ═══════════════════════════════════════════════════

// The nine tick columns, exactly as the printed sheet runs them. These are NOT
// PROD_STAGES: that is the app's work-order pipeline (one stage per ORDER, used
// for routing, KPIs and the tracker). These are per-ITEM shop-floor operations
// on one sheet, and an item can be cut and formed while the next is still
// waiting on parts — a single order-level stage cannot express that.
const JO_STAGE_COLS = window.JO_STAGE_COLS = [
  { id:'parts',  l1:'PARTS',  l2:'COMPLETE' },
  { id:'layout', l1:'LAYOUT', l2:'CHECK'    },
  { id:'cut',    l1:'CUT'     },
  { id:'form',   l1:'FORM'    },
  { id:'weld',   l1:'WELD'    },
  { id:'assy',   l1:'ASSY'    },
  { id:'polish', l1:'POLISH'  },
  { id:'qc',     l1:'QC'      },
  { id:'pack',   l1:'PACK'    },
];

// House standard text, lifted from the sheet in use. Seeded onto a new job
// order and editable per job — a kitchen with no gas line should not carry a
// burner test-fire line, and the preparer is the one who knows that.
const JO_DEFAULTS = {
  preFab: [
    'Shop drawings prepared and approved by client',
    'On-site layouting completed at site (per quotation remarks)',
    'Final dimensions verified against site measurements',
    'SS 304 sheet stock issued (1.2mm top plate / 1.0mm body & shelving)',
    'Burners, faucets, footings & hardware allocated',
    'Down payment confirmed — release to production',
  ],
  qc: [
    'All welds ground smooth, no burrs or sharp edges',
    'Dimensions verified against approved shop drawings',
    'SS 304 gauge correct per item spec (1.2mm tops / 1.0mm bodies)',
    'Adjustable footings installed & levelling tested on all units',
    'Burners test-fired; valves & thermometer functional',
    'Faucets & goosenecks leak-tested',
    'Sinks & grease trap drain-tested, no seepage',
    'Surfaces cleaned, protective film applied, units labelled',
  ],
  delivery: [
    'All units packed, wrapped & counted against this job order',
    'Truck booked & loading plan set (racks upright)',
    'Long items secured — long-item handling',
    'Supplied units loaded upright, strapped, cushioned',
    'Client notified of delivery window & site access confirmed',
    'Tools, consumables & installation hardware loaded',
    'Delivery receipt / packing list printed & on board',
    'Crew travel & accommodation arranged',
  ],
  install: [
    'Units positioned per approved site layout',
    'All units levelled via adjustable footings',
    'Wall-mounted items mounted & load-tested',
    'Pass-thru window aligned with dispatch table',
    'Grease trap set & connected to drain line',
    'Gas / electrical / civil works confirmed by client (excluded from scope)',
    'Final clean-down; protective film removed',
    'Client walkthrough, orientation & punch list cleared',
  ],
  standing: [
    'Drawings and on-site layouting must be completed before fabrication starts.',
    'Work is scheduled from receipt of down payment and approved design. Client-side changes or site delays shift the completion date.',
    'Scope covers fabrication, delivery and installation only. Electrical works, gas connections and civil works are excluded unless stated.',
    'Site must be ready for installation on arrival; report any blocking site condition to the office immediately.',
    'Fabrication workmanship carries a 12-month warranty — record serial/unit tags on turnover.',
    'Any deviation from the specifications above requires written approval from the office before proceeding.',
  ],
  scopeText: 'Fabrication · Delivery · Installation',
};

// JO-ML-FB-260730-001 comes from quotation BK-ML-FB-260730-001-R3: the company
// prefix is swapped for JO and the revision suffix dropped, so the job order and
// the quotation it came from read as obviously the same job at a glance. Falls
// back to the project number only when there is no quote to derive from.
function jobOrderNoFor(p){
  const q = String(p.quoteNumber || '').trim();
  if (q) return 'JO-' + q.replace(/^(BK|BS|BI|PT)-/i, '').replace(/-R\d+$/i, '');
  const base = String(p.projectNo || '').replace(/^JP-/, '');
  return base ? ('JO-' + base) : ('JO-' + String(p.id || '').slice(0, 6).toUpperCase());
}

function joLongDate(iso){
  if (!iso) return '';
  const d = new Date(String(iso).slice(0,10) + 'T00:00:00');
  if (isNaN(d)) return String(iso);
  return d.toLocaleDateString('en-PH', { year:'numeric', month:'long', day:'numeric' });
}

// ── The money-free item projection ───────────────────────────────
// The ONLY shape the editor, the tracker and the printed sheet ever hold. Built
// by naming keys, so a priced field added to the quote payload later cannot
// ride along into a job order (job_projects.items carries unitPrice/amount and
// this document goes to whoever is standing next to it).
function joScopeRow(it){
  const specs = (it.specEdit !== undefined && it.specEdit !== null && String(it.specEdit).trim())
    ? String(it.specEdit).trim()
    : (Array.isArray(it.specs) && it.specs.length
        ? it.specs.map(s => s && s.label ? (s.label + ': ' + s.value) : (s && s.value) || '').filter(Boolean).join(' • ')
        : String(it.specStr || it.specs || '').trim());
  const stages = {};
  JO_STAGE_COLS.forEach(c => { if ((it.stages || {})[c.id]) stages[c.id] = true; });
  return {
    name: String(it.name || '').trim(),
    specs, dims: String(it.dims || '').trim(),
    qty: Math.max(0, Number(it.qty) || 0),
    unit: String(it.unit || 'pc').trim(),
    leadTime: String(it.leadTime || '').trim(),
    notes: String(it.notes || '').trim(),
    location: String(it.location || '').trim(),
    adjustment: String(it.adjustment || '').trim(),
    catLabel: String(it.catLabel || '').trim(),
    stages,
    initials: String(it.initials || '').trim(),
    doneDate: String(it.doneDate || '').trim(),
  };
}
function joScopeOf(p){
  const jo = p.jobOrder || {};
  const rows = Array.isArray(jo.items) && jo.items.length ? jo.items : (Array.isArray(p.items) ? p.items : []);
  return rows.map(joScopeRow);
}
// Compares SCOPE only — a stage tick is progress, not a change to what was sold,
// and must never make the sheet claim it no longer matches the quotation.
function joScopeSignature(rows){
  return JSON.stringify(rows.map(r => [r.name, r.specs, r.dims, r.qty, r.unit, r.catLabel, r.location, r.adjustment]));
}
function joScopeEdited(p){
  const jo = p.jobOrder || {};
  if (!Array.isArray(jo.items) || !jo.items.length) return false;
  const quote = Array.isArray(p.items) ? p.items : [];
  // Nothing to differ FROM. A job whose quote line items were never carried
  // over (an older project, or one typed straight into the job order) would
  // otherwise print "no longer matches the quotation line for line" about a
  // comparison that was never possible — a false alarm on the one document
  // whose warnings have to be trusted.
  if (!quote.length) return false;
  return joScopeSignature(jo.items.map(joScopeRow)) !== joScopeSignature(quote.map(joScopeRow));
}
// Stored job order merged over the derived defaults — one place that decides
// what the sheet, the editor and the tracker are all looking at.
function joDoc(p){
  const jo = p.jobOrder || {};
  const list = (v, d) => Array.isArray(v) && v.length ? v.slice() : d.slice();
  return {
    no: jobOrderNoFor(p),
    startDate: jo.startDate || '',
    deliveryDate: jo.deliveryDate || '',
    targetDate: p.targetDate || '',
    siteAddress: jo.siteAddress || '',
    projectType: jo.projectType || '',
    scopeText: jo.scopeText || JO_DEFAULTS.scopeText,
    items: joScopeOf(p),
    preFab: list(jo.preFab, JO_DEFAULTS.preFab),
    qcChecks: list(jo.qcChecks, JO_DEFAULTS.qc),
    deliveryChecks: list(jo.deliveryChecks, JO_DEFAULTS.delivery),
    installChecks: list(jo.installChecks, JO_DEFAULTS.install),
    standing: list(jo.standing, JO_DEFAULTS.standing),
    instructions: jo.instructions || '',
    revision: Number(jo.revision) || 0,
    updatedAt: jo.updatedAt || '', updatedByName: jo.updatedByName || '',
  };
}
function joTickedCount(d){
  const total = d.items.length * JO_STAGE_COLS.length;
  const done = d.items.reduce((s, it) => s + JO_STAGE_COLS.filter(c => it.stages[c.id]).length, 0);
  return { done, total, pct: total ? Math.round(100 * done / total) : 0 };
}


// ═══════════════════════════════════════════════════
//  EDITOR — the job order as a screen, not just a printout
//  Owner, 2026-08-18: "allow for a system integrated ui but there is a print
//  option which will look like this". Everything the sheet prints is edited
//  here; the sheet is a rendering of this record, never a separate document
//  somebody retypes.
//
//  Edits land in job_projects.jobOrder — a PRODUCTION-SIDE OVERRIDE — and never
//  on the quote-derived items[]. That is the money: items[] carries
//  unitPrice/amount and contractAmount is the signed deal, so a quantity
//  retyped by the floor must not be able to move a peso. When the scope
//  diverges from the quotation the printed sheet says so, in red.
// ═══════════════════════════════════════════════════
function joChecklistEditor(id, label, hint, rows){
  return `<div class="card" style="margin-bottom:10px"><div class="card-body">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
      <span style="font-size:11px;font-weight:800;letter-spacing:.5px;color:var(--text-muted)">${escHtml(label)}</span>
      <span style="display:flex;gap:6px">
        <button type="button" class="btn-secondary btn-sm jo-cl-reset" data-cl="${id}">Reset to standard</button>
        <button type="button" class="btn-secondary btn-sm jo-cl-add" data-cl="${id}">＋ Line</button>
      </span>
    </div>
    <div id="jo-cl-${id}">${rows.map(t => joChecklistRow(id, t)).join('')}</div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:5px">${escHtml(hint)}</div>
  </div></div>`;
}
function joChecklistRow(id, text){
  return `<div class="form-row jo-cl-row" data-cl="${id}" style="align-items:flex-end">
    <div class="form-group" style="flex:1"><input class="jo-cl-text" value="${escHtml(text || '')}" placeholder="Checklist line"/></div>
    <div class="form-group" style="flex:0 0 auto"><button type="button" class="btn-danger btn-sm jo-cl-del" title="Remove">${emojiIcon('🗑',14)}</button></div>
  </div>`;
}

function openJobOrderEditor(p, onSaved){
  const jo = p.jobOrder || {};
  const d = joDoc(p);
  const quoteScope = (Array.isArray(p.items) ? p.items : []).map(joScopeRow);
  let rows = d.items.length ? d.items : [joScopeRow({})];

  const scopeRowHtml = (r, i) => `
    <div class="jo-row" data-i="${i}" style="border:1px solid var(--border);border-radius:9px;padding:9px 10px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:10px;font-weight:800;letter-spacing:.5px;color:var(--text-muted)">ITEM ${i+1}</span>
        <button type="button" class="btn-danger btn-sm jo-del" data-i="${i}" title="Remove this item">${emojiIcon('🗑',14)}</button>
      </div>
      <div class="form-group"><label>Description</label><input class="jo-name" value="${escHtml(r.name)}" placeholder="e.g. SS Preparation Table (2 Layer)"/></div>
      <div class="form-row">
        <div class="form-group" style="flex:0 0 80px"><label>Qty</label><input class="jo-qty" type="number" min="0" step="1" value="${escHtml(String(r.qty))}"/></div>
        <div class="form-group" style="flex:0 0 90px"><label>Unit</label><input class="jo-unit" value="${escHtml(r.unit)}" placeholder="pc"/></div>
        <div class="form-group"><label>Dimensions</label><input class="jo-dims" value="${escHtml(r.dims)}" placeholder="L1900 × W800 × H850 mm"/></div>
      </div>
      <div class="form-group"><label>Specification</label><input class="jo-specs" value="${escHtml(r.specs)}" placeholder="SS 304 1.2mm Top Plate, 1.0mm Shelvings…"/></div>
      <div class="form-row">
        <div class="form-group"><label>Location on site</label><input class="jo-loc" value="${escHtml(r.location)}" placeholder="e.g. Behind Dispatch Table"/></div>
        <div class="form-group"><label>Adjustment</label><input class="jo-adj" value="${escHtml(r.adjustment)}" placeholder="e.g. Increased Length · Faucet Added"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Section</label><input class="jo-cat" value="${escHtml(r.catLabel)}" placeholder="e.g. Cooking Line"/></div>
        <div class="form-group"><label>Lead time</label><input class="jo-lead" value="${escHtml(r.leadTime)}" placeholder="e.g. 10-14 days"/></div>
      </div>
      <div class="form-group"><label>Note to the floor</label><input class="jo-note" value="${escHtml(r.notes)}" placeholder="Anything the fabricator must know"/></div>
    </div>`;

  const _panel = openPage(`${emojiIcon('✏️',16)} Edit Job Order — ` + escHtml(d.no), `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
      This IS the job order — everything below prints on the sheet the floor works from.
      It never changes quotation <b>${escHtml(p.quoteNumber||'—')}</b> or the contract value, and the
      printed sheet flags any difference from the quote.
    </div>

    <div class="card" style="margin-bottom:10px"><div class="card-body">
      <div style="font-size:11px;font-weight:800;letter-spacing:.5px;color:var(--text-muted);margin-bottom:8px">HEADER</div>
      <div class="form-row">
        <div class="form-group"><label>Project type</label><input id="jo-ptype" value="${escHtml(d.projectType)}" placeholder="e.g. Restaurant"/></div>
        <div class="form-group"><label>Scope line</label><input id="jo-scope" value="${escHtml(d.scopeText)}" placeholder="Fabrication · Delivery · Installation"/></div>
      </div>
      <div class="form-group"><label>Delivery &amp; installation site</label><textarea id="jo-site" rows="2" placeholder="Baguio Athletic Bowl, Tennis Court&#10;Burnham Park, Baguio City">${escHtml(d.siteAddress)}</textarea></div>
    </div></div>

    <div class="card" style="margin-bottom:10px"><div class="card-body">
      <div style="font-size:11px;font-weight:800;letter-spacing:.5px;color:var(--text-muted);margin-bottom:8px">DATES</div>
      <div class="form-row">
        <div class="form-group"><label>Production start</label><input id="jo-start" type="date" value="${escHtml(d.startDate)}"/></div>
        <div class="form-group"><label>Delivery date</label><input id="jo-delivery" type="date" value="${escHtml(d.deliveryDate)}"/></div>
        <div class="form-group"><label>Target completion</label><input id="jo-target" type="date" value="${escHtml(d.targetDate)}"/></div>
      </div>
      <div style="font-size:11px;color:var(--text-muted)">Target completion is the job's real deadline — it drives the overdue and due-soon counts on this screen and the Incoming banner.</div>
    </div></div>

    <div class="card" style="margin-bottom:10px"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <span style="font-size:11px;font-weight:800;letter-spacing:.5px;color:var(--text-muted)">WHAT TO BUILD</span>
        <span style="display:flex;gap:6px">
          <button type="button" class="btn-secondary btn-sm" id="jo-reset" ${quoteScope.length?'':'disabled'}>Reset to quotation</button>
          <button type="button" class="btn-secondary btn-sm" id="jo-add">＋ Item</button>
        </span>
      </div>
      <div id="jo-rows">${rows.map(scopeRowHtml).join('')}</div>
      <div style="font-size:11px;color:var(--text-muted)">No prices by design — a job order is handed to whoever is standing next to it. Stage ticks are set in ${emojiIcon('✅',14)} Progress, not here.</div>
    </div></div>

    ${joChecklistEditor('prefab','PRE-FABRICATION REQUIREMENTS','Printed with tick boxes, before the item table. Must be complete before cutting.', d.preFab)}
    ${joChecklistEditor('qc','QUALITY CONTROL — BEFORE CRATING','Printed on the continuation page.', d.qcChecks)}
    ${joChecklistEditor('delivery','DELIVERY','Printed on the continuation page, headed with the delivery date above.', d.deliveryChecks)}
    ${joChecklistEditor('install','INSTALLATION & TURNOVER','Printed on the continuation page, headed with the target completion date.', d.installChecks)}
    ${joChecklistEditor('standing','STANDING INSTRUCTIONS','Numbered clauses at the foot of the sheet — the conditions the job is run under.', d.standing)}

    <div class="card" style="margin-bottom:4px"><div class="card-body">
      <div style="font-size:11px;font-weight:800;letter-spacing:.5px;color:var(--text-muted);margin-bottom:8px">INSTRUCTIONS FOR THIS JOB</div>
      <div class="form-group"><textarea id="jo-instr" rows="3" placeholder="Sequencing, jigs, handling — anything specific to this job.">${escHtml(d.instructions)}</textarea></div>
      ${p.notes?`<div style="font-size:11px;color:var(--text-muted)">Notes from Sales / Design (not editable here, also printed): ${escHtml(p.notes)}</div>`:''}
    </div></div>
    <div id="jo-err" class="error-msg hidden"></div>
  `, `<button class="btn-primary" id="jo-save">Save Job Order</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  // ⚠ EVERY lookup scoped to _panel, not document — openPage keeps a closed
  // panel document-connected for 300ms, so a document-wide query in that window
  // reads the PREVIOUS job's inputs and saves them onto this project.
  const $ = s => _panel.querySelector(s);
  const $$ = s => Array.from(_panel.querySelectorAll(s));

  // Read off the DOM rather than keeping a shadow array in sync — one source of
  // truth, so a re-render can never drop a keystroke.
  const collect = () => $$('#jo-rows .jo-row').map((el, i) => {
    const g = c => (el.querySelector('.' + c)?.value ?? '');
    return joScopeRow({ name:g('jo-name'), qty:g('jo-qty'), unit:g('jo-unit'), leadTime:g('jo-lead'),
      specEdit:g('jo-specs'), dims:g('jo-dims'), catLabel:g('jo-cat'), notes:g('jo-note'),
      location:g('jo-loc'), adjustment:g('jo-adj'),
      // Stage ticks live in the tracker, not here — carry the stored ones
      // through so saving a description can never wipe the floor's progress.
      stages:(rows[i]||{}).stages, initials:(rows[i]||{}).initials, doneDate:(rows[i]||{}).doneDate });
  });
  const repaint = (list) => {
    rows = list.length ? list : [joScopeRow({})];
    $('#jo-rows').innerHTML = rows.map(scopeRowHtml).join('');
    if (window.lucide) lucide.createIcons({ nodes: [$('#jo-rows')] });
    bindRows();
  };
  const bindRows = () => $$('#jo-rows .jo-del').forEach(b => b.addEventListener('click', () => {
    const list = collect(); list.splice(Number(b.dataset.i), 1); repaint(list);
  }));
  bindRows();
  $('#jo-add').addEventListener('click', () => {
    const list = collect();
    list.push(joScopeRow({ catLabel: list.length ? list[list.length-1].catLabel : '' }));
    repaint(list);
  });
  $('#jo-reset').addEventListener('click', async () => {
    if (!(await confirmDialog({ message:'Replace the job order scope with the quotation’s line items? Production-only items you added here are removed, along with their stage ticks.', danger:true }))) return;
    repaint(quoteScope.map(joScopeRow));
    Notifs.showToast('Scope reset to the quotation — press Save to keep it.');
  });

  // Checklists
  const CL_DEFAULTS = { prefab:JO_DEFAULTS.preFab, qc:JO_DEFAULTS.qc, delivery:JO_DEFAULTS.delivery,
                        install:JO_DEFAULTS.install, standing:JO_DEFAULTS.standing };
  const bindCl = () => $$('.jo-cl-del').forEach(b => { if (b.dataset.b) return; b.dataset.b='1';
    b.addEventListener('click', () => b.closest('.jo-cl-row').remove()); });
  bindCl();
  $$('.jo-cl-add').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.cl;
    $('#jo-cl-' + id).insertAdjacentHTML('beforeend', joChecklistRow(id, ''));
    if (window.lucide) lucide.createIcons({ nodes: [$('#jo-cl-' + id)] });
    bindCl();
  }));
  $$('.jo-cl-reset').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.cl;
    $('#jo-cl-' + id).innerHTML = (CL_DEFAULTS[id] || []).map(t => joChecklistRow(id, t)).join('');
    if (window.lucide) lucide.createIcons({ nodes: [$('#jo-cl-' + id)] });
    bindCl();
    Notifs.showToast('Reset to the standard lines — press Save to keep it.');
  }));
  const readCl = (id) => Array.from(_panel.querySelectorAll(`#jo-cl-${id} .jo-cl-text`))
    .map(i => i.value.trim()).filter(Boolean);

  $('#jo-save').addEventListener('click', async () => {
    const err = $('#jo-err');
    const items = collect().filter(r => r.name);
    if (!items.length) { err.textContent = 'A job order needs at least one item with a description.'; err.classList.remove('hidden'); return; }
    const start = $('#jo-start').value || '', delivery = $('#jo-delivery').value || '', target = $('#jo-target').value || '';
    if (start && target && target < start) { err.textContent = 'Target completion is before the production start date.'; err.classList.remove('hidden'); return; }
    if (delivery && start && delivery < start) { err.textContent = 'Delivery date is before the production start date.'; err.classList.remove('hidden'); return; }
    const btn = $('#jo-save'); btn.disabled = true;
    try {
      const who = userProfile?.displayName || currentUser.email || '';
      // Store the scope override only when it really differs from the quotation,
      // otherwise the sheet warns about a scope that matches it exactly. Compared
      // on scope fields only — a stage tick is progress, not a change to what was
      // sold. Ticks still have to be KEPT, so the override is written whenever
      // any exist even if the wording is identical.
      const differs = joScopeSignature(items) !== joScopeSignature(quoteScope);
      const anyTicks = items.some(r => Object.keys(r.stages || {}).length || r.initials || r.doneDate);
      const jobOrder = {
        startDate: start, deliveryDate: delivery,
        siteAddress: $('#jo-site').value.trim(),
        projectType: $('#jo-ptype').value.trim(),
        scopeText: $('#jo-scope').value.trim() || JO_DEFAULTS.scopeText,
        items: (differs || anyTicks) ? items : null,
        preFab: readCl('prefab'), qcChecks: readCl('qc'),
        deliveryChecks: readCl('delivery'), installChecks: readCl('install'),
        standing: readCl('standing'),
        instructions: $('#jo-instr').value.trim(),
        revision: (Number(jo.revision) || 0) + 1,
        updatedAt: new Date().toISOString(), updatedBy: currentUser.uid, updatedByName: who,
      };
      const patch = { jobOrder, updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
      // targetDate is a real top-level field the KPIs read — written there, not
      // copied inside jobOrder, and only when it actually moved.
      if (target !== (p.targetDate || '')) {
        patch.targetDate = target;
        patch.timeline = firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(),
          event:'Job order target completion set to ' + (target || '—'), by:who });
      }
      await db.collection('job_projects').doc(p.id).update(patch);
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('job_projects');
      window.logAudit && window.logAudit('update','job_order',p.id,{ jobOrder:d.no, revision:jobOrder.revision, scopeEdited:differs });
      Notifs.success('Job Order ' + d.no + ' saved (rev. ' + jobOrder.revision + ').');
      closeModal(); onSaved && onSaved();
    } catch (ex) { err.textContent = 'Save failed: ' + (ex.message || ex.code); err.classList.remove('hidden'); btn.disabled = false; }
  });
}
window.openJobOrderEditor = openJobOrderEditor;

// ═══════════════════════════════════════════════════
//  PROGRESS TRACKER — the printed tick grid, in the system
//  The same nine columns the sheet carries, tickable per item. Whatever is
//  ticked here prints as ✓ on the next copy, so a sheet reprinted mid-job
//  arrives on the floor already showing what is done instead of starting blank.
// ═══════════════════════════════════════════════════
function openJobOrderProgress(p, onSaved){
  const canEdit = canEditDept('Production') && (window.currentRole !== 'secretary');
  const d = joDoc(p);
  const t = joTickedCount(d);
  const rowHtml = (it, i) => `
    <tr data-i="${i}">
      <td style="font-size:11px;color:var(--text-muted);text-align:center">${i+1}</td>
      <td style="font-size:12px"><div style="font-weight:600">${escHtml(it.name||'Item')}</div>
        ${it.dims?`<div style="font-size:10px;color:var(--text-muted)">${escHtml(it.dims)}</div>`:''}</td>
      ${JO_STAGE_COLS.map(c => `<td style="text-align:center;padding:2px">
        <input type="checkbox" class="jop-tick" data-i="${i}" data-s="${c.id}" ${it.stages[c.id]?'checked':''} ${canEdit?'':'disabled'} style="width:17px;height:17px;accent-color:var(--success)"/>
      </td>`).join('')}
      <td style="padding:2px"><input class="jop-ini" data-i="${i}" value="${escHtml(it.initials)}" ${canEdit?'':'disabled'} style="width:52px;font-size:11px" placeholder="—"/></td>
      <td style="padding:2px"><input class="jop-date" data-i="${i}" type="date" value="${escHtml(it.doneDate)}" ${canEdit?'':'disabled'} style="width:126px;font-size:11px"/></td>
    </tr>`;

  const _panel = openPage(`${emojiIcon('✅',16)} Progress — ` + escHtml(d.no), `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
      The same grid the printed job order carries. Tick a stage as it is finished — the next copy you print
      arrives on the floor already showing it.
    </div>
    <div class="kpi-row" style="margin-bottom:12px">
      <div class="kpi-card"><div class="kpi-label">Items</div><div class="kpi-value">${d.items.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Stages done</div><div class="kpi-value" id="jop-done">${t.done} / ${t.total}</div></div>
      <div class="kpi-card ${t.pct>=100?'green':''}"><div class="kpi-label">Complete</div><div class="kpi-value" id="jop-pct">${t.pct}%</div></div>
    </div>
    ${d.items.length ? `<div class="table-wrap"><table class="data-table"><thead><tr>
      <th style="width:26px">#</th><th>Item</th>
      ${JO_STAGE_COLS.map(c=>`<th style="text-align:center;font-size:9px">${escHtml(c.l1)}${c.l2?'<br>'+escHtml(c.l2):''}</th>`).join('')}
      <th style="font-size:9px">INITIALS</th><th style="font-size:9px">DATE</th>
    </tr></thead><tbody id="jop-body">${d.items.map(rowHtml).join('')}</tbody></table></div>`
      : window.renderEmptyState({icon:'📋',title:'No scope on this job order',hint:'Use Edit to enter what is to be built, then track it here.'})}
    <div id="jop-err" class="error-msg hidden" style="margin-top:8px"></div>
  `, `${canEdit&&d.items.length?`<button class="btn-primary" id="jop-save">Save progress</button>`:''}<button class="btn-secondary" onclick="closeModal()">Close</button>`);

  const $ = s => _panel.querySelector(s), $$ = s => Array.from(_panel.querySelectorAll(s));
  const recount = () => {
    const done = $$('.jop-tick').filter(c => c.checked).length;
    const total = d.items.length * JO_STAGE_COLS.length;
    $('#jop-done').textContent = `${done} / ${total}`;
    $('#jop-pct').textContent = (total ? Math.round(100*done/total) : 0) + '%';
  };
  $$('.jop-tick').forEach(c => c.addEventListener('change', recount));

  $('#jop-save')?.addEventListener('click', async () => {
    const err = $('#jop-err'); const btn = $('#jop-save'); btn.disabled = true;
    try {
      const items = d.items.map((it, i) => {
        const stages = {};
        JO_STAGE_COLS.forEach(c => {
          const box = _panel.querySelector(`.jop-tick[data-i="${i}"][data-s="${c.id}"]`);
          if (box && box.checked) stages[c.id] = true;
        });
        return joScopeRow({ ...it, stages,
          initials: _panel.querySelector(`.jop-ini[data-i="${i}"]`)?.value || '',
          doneDate: _panel.querySelector(`.jop-date[data-i="${i}"]`)?.value || '' });
      });
      const jo = p.jobOrder || {};
      // Writes items ONLY — the checklists, dates and header text are the
      // editor's, and a merge that rewrote them from this screen's stale copy
      // would silently revert somebody else's edit made while this was open.
      await db.collection('job_projects').doc(p.id).update({
        'jobOrder.items': items,
        'jobOrder.progressAt': new Date().toISOString(),
        'jobOrder.progressBy': userProfile?.displayName || currentUser.email || '',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('job_projects');
      const done = items.reduce((s,it)=>s+Object.keys(it.stages||{}).length,0);
      window.logAudit && window.logAudit('update','job_order',p.id,{ progress: done });
      Notifs.success('Progress saved.');
      closeModal(); onSaved && onSaved();
    } catch (ex) { err.textContent = 'Save failed: ' + (ex.message || ex.code); err.classList.remove('hidden'); btn.disabled = false; }
  });
}
window.openJobOrderProgress = openJobOrderProgress;

// ═══════════════════════════════════════════════════
//  PRINT
// ═══════════════════════════════════════════════════
function printJobOrder(p, orders){
  const e = s => escHtml(s == null ? '' : String(s));
  const d = joDoc(p);
  const jobOrders = (orders || []).filter(o => o.projectId === p.id);
  const todayISO = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0, 10);
  const scopeEdited = joScopeEdited(p);
  const units = d.items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const co = (window.QUOTE_COMPANIES && window.QUOTE_COMPANIES[p.company || 'BK']) || { label: 'Barro Kitchens' };
  const ent = window.brandEntity ? window.brandEntity('corporate') : {};
  const clientLine = [p.clientName, p.name && p.name !== p.clientName ? p.name : ''].filter(Boolean).join(' — ');

  // Item block: title + dims on one line, spec beneath, then location /
  // adjustment, then three ruled lines the floor writes on.
  let n = 0;
  const itemRows = [];
  const groups = [];
  d.items.forEach(it => {
    const key = it.catLabel || '';
    let g = groups.find(x => x.key === key);
    if (!g) groups.push(g = { key, label: it.catLabel || '', rows: [] });
    g.rows.push(it);
  });
  groups.forEach(g => {
    if (g.label && groups.length > 1) itemRows.push(`<tr class="grp"><td colspan="${3 + JO_STAGE_COLS.length + 2}">${e(g.label)}</td></tr>`);
    g.rows.forEach(it => {
      n++;
      const sub = [];
      if (it.specs) sub.push(`<div class="spec">${e(it.specs)}</div>`);
      const la = [it.location ? 'Location: ' + it.location : '', it.adjustment ? 'Adjustment: ' + it.adjustment : ''].filter(Boolean).join(' · ');
      if (la) sub.push(`<div class="la">${e(la)}</div>`);
      if (it.notes) sub.push(`<div class="la">${e(it.notes)}</div>`);
      itemRows.push(`<tr class="it">
        <td class="c n">${n}</td>
        <td class="desc">
          <div class="nm">${e(it.name || 'Item')}${it.dims ? ` <span class="dims">${e(it.dims)}</span>` : ''}</div>
          ${sub.join('')}
          <ol class="ln"><li></li><li></li><li></li></ol>
        </td>
        <td class="c qty">${e(String(it.qty || 1))} ${e(it.unit || 'pc')}</td>
        ${JO_STAGE_COLS.map(c => `<td class="tick">${it.stages[c.id] ? '✓' : ''}</td>`).join('')}
        <td class="wr">${e(it.initials)}</td>
        <td class="wr">${e(it.doneDate)}</td>
      </tr>`);
    });
  });
  if (!d.items.length) itemRows.push(`<tr><td colspan="${3 + JO_STAGE_COLS.length + 2}" class="c" style="padding:14px;color:#777">No scope on this job order yet — edit it to enter what is to be built.</td></tr>`);

  const checkList = (arr) => `<ul class="cl">${arr.map(t => `<li><span class="box"></span>${e(t)}</li>`).join('')}</ul>`;

  const _lh = window.buildLetterhead ? window.buildLetterhead({
    docTitle: 'JOB ORDER',
    docNumber: d.no,
    dateLabel: 'Issued: ' + joLongDate(todayISO),
    // The sheet's masthead is the trading brand with the OPC beneath it, not the
    // OPC alone — this is the document the client's site sees on delivery day.
    entity: { name: (co.label || 'Barro Kitchens').toUpperCase(), registration: 'By ' + (ent.name || 'Barro Industries OPC'),
              address: ent.address, phone: ent.phone, email: ent.email },
    extraMeta: [
      p.quoteNumber ? ('Ref. Quotation: ' + p.quoteNumber) : null,
      d.revision ? ('Revision ' + d.revision + (d.updatedByName ? ' — ' + d.updatedByName : '')) : null,
      jobOrders.length ? ('Work Order: ' + jobOrders.map(o => o.orderNo || '—').join(', ')) : null,
    ].filter(Boolean),
    footerNote: 'Job Order ' + d.no + ' · Internal production document — carries no prices and is not a quotation',
  }) : null;

  const pageCss = `
  .page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:11mm;color:#000}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:0 0 7px}
  .meta5{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin:0 0 10px}
  .mb{border:1px solid #B9C2D0;border-radius:5px;padding:6px 9px}
  .mb .l{font-size:6.5pt;text-transform:uppercase;letter-spacing:.6px;color:#1E3A5F;font-weight:800;margin-bottom:2px}
  .mb .v{font-size:9.5pt;font-weight:700;line-height:1.35}
  .mb .v small{display:block;font-size:7.5pt;font-weight:500;color:#444;margin-top:1px}
  .meta5 .mb .v{font-size:8.5pt}
  h4.sec{font-size:8pt;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#1E3A5F;
    margin:9px 0 4px;border-bottom:1.5px solid #1E3A5F;padding-bottom:2px}
  ul.cl{list-style:none;margin:0 0 6px;padding:0;column-count:2;column-gap:14px}
  ul.cl li{font-size:8pt;line-height:1.5;padding:1px 0;break-inside:avoid;display:flex;gap:6px;align-items:flex-start}
  ul.cl .box{flex:0 0 9px;height:9px;border:1px solid #555;border-radius:2px;margin-top:2px;display:inline-block}
  table{width:100%;border-collapse:collapse;table-layout:fixed}
  thead{display:table-header-group}
  th{background:#1E3A5F;color:#fff;font-size:6pt;font-weight:700;text-transform:uppercase;
    letter-spacing:.3px;padding:3px 2px;text-align:center;line-height:1.25;border:1px solid #1E3A5F}
  /* The nine stage headings are FLAT, two stacked words, exactly as the sheet
     in use has them. They are set at 4.2pt because that is what makes the
     longest of them — COMPLETE, 8 characters — fit a 4.8% column of a 188mm
     A4 body (~34px against ~31px of glyph).
     NOTE FOR ANYONE "FIXING" THIS: at the ~52% the on-screen preview scales
     the sheet to, 4.2pt renders around 2.8 device pixels and the letters visibly
     merge. That is the preview, not the sheet — print or Save as PDF renders at
     true size and the words are whole. Do not grow this type off the screenshot;
     measure th.clientWidth against the label span's scrollWidth instead, both of
     which are unscaled layout values. */
  th.stg{padding:3px 1px;font-size:4.2pt;letter-spacing:0;line-height:1.3}
  th.stg span{display:inline-block;white-space:nowrap}
  /* INITIALS is 8 characters too — same treatment, one size up because its
     column is wider. At the base 6pt it ran into DATE. */
  th.wr2{padding:3px 1px;font-size:5pt;letter-spacing:0}
  th.desc{text-align:left;padding-left:5px;font-size:6pt;letter-spacing:.3px}
  td{border:1px solid #C9D2DE;padding:2px 3px;font-size:8pt;vertical-align:top}
  td.c{text-align:center}
  td.n{font-weight:700;font-size:8.5pt}
  td.qty{font-size:7.5pt;white-space:nowrap}
  td.tick{text-align:center;font-size:11pt;font-weight:700;color:#1E7A3C;line-height:1}
  td.wr{background:#FAFBFC;font-size:6.5pt;text-align:center;white-space:nowrap}
  tr.it{page-break-inside:avoid;break-inside:avoid}
  tr.grp td{background:#D6E4F0;color:#1E3A5F;font-weight:800;font-size:6.5pt;
    text-transform:uppercase;letter-spacing:.6px;padding:2.5px 5px;text-align:left}
  .nm{font-weight:700;font-size:8.2pt;line-height:1.25}
  .dims{font-weight:400;color:#333}
  .spec{font-size:7pt;color:#444;line-height:1.3;margin-top:1px}
  .la{font-size:7pt;color:#1E3A5F;font-style:italic;line-height:1.3;margin-top:1px}
  ol.ln{margin:2px 0 0 11px;padding:0;font-size:6.5pt;color:#999}
  ol.ln li{height:9px;border-bottom:1px solid #DDE3EC;margin-bottom:1px}
  .legend{font-size:6.5pt;color:#555;line-height:1.45;margin-top:4px}
  .legend b{color:#1E3A5F}
  .cont{page-break-before:always;break-before:page}
  .conthead{display:flex;justify-content:space-between;align-items:flex-end;
    border-bottom:2.5px solid #1E3A5F;padding-bottom:5px;margin-bottom:9px}
  .conthead .a{font-size:13pt;font-weight:900;color:#1E3A5F;letter-spacing:.4px}
  .conthead .b{font-size:8pt;color:#555;margin-top:2px}
  .conthead .c2{text-align:right;font-size:8pt;color:#555}
  .conthead .c2 b{display:block;font-size:10pt;color:#1E3A5F}
  table.punch td{height:19px;background:#FAFBFC}
  ol.std{margin:0 0 8px 15px;padding:0}
  ol.std li{font-size:7.5pt;color:#333;line-height:1.5;margin-bottom:2px}
  .sigs{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:16px}
  .sig{text-align:center}
  .sig .line{border-top:1px solid #000;margin-top:30px}
  .sig .who{font-size:7pt;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#1E3A5F;margin-top:4px}
  .sig .sub{font-size:6.5pt;color:#666;margin-top:1px}
  .sig .nm2{font-size:8pt;font-weight:700;margin-top:2px}
  .warn{border:1px solid #E0B4AE;background:#FDF3F2;border-radius:5px;padding:5px 8px;
    color:#7A2018;font-size:7.5pt;line-height:1.5;margin:4px 0 8px}
  .warn b{color:#B03024}
  .note{font-size:7.5pt;color:#444;margin:3px 0 6px;line-height:1.5}
  .note b{color:#1E3A5F}
  @media print{ .page{padding:0;width:auto;min-height:0} }
${_lh ? _lh.printCSS : ''}`;

  const bodyHtml = `
  ${_lh ? _lh.headerHTML : `<div style="font-size:20px;font-weight:900">JOB ORDER ${e(d.no)}</div>`}
  <div class="meta">
    <div class="mb"><div class="l">Client / Project</div><div class="v">${e(clientLine || '—')}${d.projectType ? `<small>Project Type: ${e(d.projectType)}</small>` : ''}</div></div>
    <div class="mb"><div class="l">Delivery &amp; Installation Site</div><div class="v">${d.siteAddress ? e(d.siteAddress).replace(/\n/g, '<br>') : '<span style="font-weight:400;color:#888">—</span>'}</div></div>
  </div>
  <div class="meta5">
    <div class="mb"><div class="l">Production Start</div><div class="v">${e(joLongDate(d.startDate)) || '—'}</div></div>
    <div class="mb"><div class="l">Delivery Date</div><div class="v">${e(joLongDate(d.deliveryDate)) || '—'}</div></div>
    <div class="mb"><div class="l">Target Completion</div><div class="v">${e(joLongDate(d.targetDate)) || '—'}</div></div>
    <div class="mb"><div class="l">Scope</div><div class="v">${e(d.scopeText)}</div></div>
    <div class="mb"><div class="l">Total Units</div><div class="v">${d.items.length} item${d.items.length===1?'':'s'} · ${units} unit${units===1?'':'s'}</div></div>
  </div>
  ${scopeEdited ? `<div class="warn"><b>Scope edited for production.</b> This sheet no longer matches quotation <b>${e(p.quoteNumber || '—')}</b> line for line — it was revised for the floor${d.updatedByName ? ' by ' + e(d.updatedByName) : ''}${d.updatedAt ? ' on ' + e(String(d.updatedAt).slice(0,10)) : ''}. The quotation and the contract value are unchanged; anything here that adds cost must be priced by Sales before it is billed.</div>` : ''}

  <h4 class="sec">Pre-fabrication requirements — complete before cutting</h4>
  ${checkList(d.preFab)}

  <h4 class="sec">Production checklist — tick each stage as completed</h4>
  <table>
    <colgroup><col style="width:3%"><col style="width:36%"><col style="width:5.5%">
      ${JO_STAGE_COLS.map(() => '<col style="width:4.8%">').join('')}
      <col style="width:6%"><col style="width:6.3%"></colgroup>
    <thead><tr>
      <th>#</th><th class="desc">Item / Specification &amp; Notes</th><th>Qty</th>
      ${JO_STAGE_COLS.map(c => `<th class="stg"><span>${e(c.l1)}${c.l2 ? '<br>' + e(c.l2) : ''}</span></th>`).join('')}
      <th class="wr2"><span>Initials</span></th><th class="wr2"><span>Date</span></th>
    </tr></thead>
    <tbody>${itemRows.join('')}</tbody>
  </table>
  <div class="legend"><b>Parts Complete → Layout Check → Cut.</b> Parts Complete: all sheets, burners, faucets, footings &amp; hardware on hand · Layout Check: marking verified vs. approved drawing &amp; site measurements · Assy: posts, footings, fittings · QC: inspection sign-off · Pack: wrapped &amp; labelled. Use lines 1–3 for item notes.</div>

  <div class="cont">
    <div class="conthead">
      <div><div class="a">${e((co.label || 'Barro Kitchens').toUpperCase())}</div>
        <div class="b">Job Order ${e(d.no)}${clientLine ? ' — ' + e(clientLine) : ''}</div></div>
      <div class="c2"><b>Continued</b>QC · Delivery · Installation &amp; Turnover</div>
    </div>
    <h4 class="sec">Quality control — before crating</h4>
    ${checkList(d.qcChecks)}
    <h4 class="sec">Delivery${d.deliveryDate ? ' — arrive ' + e(joLongDate(d.deliveryDate)) : ''}</h4>
    ${checkList(d.deliveryChecks)}
    <h4 class="sec">Installation &amp; turnover${d.targetDate ? ' — by ' + e(joLongDate(d.targetDate)) : ''}</h4>
    ${checkList(d.installChecks)}

    <h4 class="sec">Punch list / site notes</h4>
    <table class="punch">
      <colgroup><col style="width:5%"><col style="width:45%"><col style="width:18%"><col style="width:17%"><col style="width:15%"></colgroup>
      <thead><tr><th>#</th><th class="desc">Item / Issue</th><th>Action By</th><th>Target Date</th><th>Cleared</th></tr></thead>
      <tbody>${[1,2,3,4,5].map(k => `<tr><td class="c n">${k}</td><td></td><td></td><td></td><td></td></tr>`).join('')}</tbody>
    </table>

    <h4 class="sec">Standing instructions</h4>
    <ol class="std">${d.standing.map(t => `<li>${e(t)}</li>`).join('')}</ol>
    ${d.instructions ? `<div class="note"><b>Instructions for this job:</b> ${e(d.instructions)}</div>` : ''}
    ${p.notes ? `<div class="note"><b>Notes from Sales / Design:</b> ${e(p.notes)}</div>` : ''}

    <div class="sigs">
      ${[['Prepared by', userProfile?.displayName || ''], ['Production in-charge', ''], ['QC inspected by', ''], ['Approved by', '']]
        .map(([who, nm]) => `<div class="sig"><div class="line"></div><div class="who">${e(who)}</div>${nm ? `<div class="nm2">${e(nm)}</div>` : ''}<div class="sub">Signature over printed name</div><div class="sub">Date: ______________</div></div>`).join('')}
    </div>
  </div>
  ${_lh ? _lh.footerHTML : ''}`;

  window.openPrintableDoc({
    title: `Job Order — ${d.no}`,
    barLabel: `${emojiIcon('🧾',16)} Job Order — ${e(d.no)}`,
    bodyHtml, pageCss,
    winFeatures: 'width=980,height=780',
  });
}
window.printJobOrder = printJobOrder;

// ── Production → Job Orders tab ──────────────────────────────────
// Lists the won jobs Production is actually responsible for, each printable
// as a Job Order and each with its priority stars editable in place.
async function renderProdJobOrders(el, currentUser, currentRole){
  const canEdit = canEditDept('Production') && (window.currentRole !== 'secretary');
  el.innerHTML = window.skeletonHtml('table');
  const [projSnap, ordSnap] = await Promise.all([
    dbCachedGet('job_projects', ()=>db.collection('job_projects').orderBy('createdAt','desc').get(), 45000),
    dbCachedGet('production_orders', ()=>db.collection('production_orders').orderBy('createdAt','desc').get(), 45000).catch(()=>({docs:[]}))
  ]);
  const orders = ordSnap.docs.map(d=>({id:d.id,...d.data()}));
  // 'paid' and 'cancelled' are gone from the floor; everything else is a live
  // or recently-finished job whose sheet someone may still need to reprint.
  const projects = projSnap.docs.map(d=>({id:d.id,...d.data()}))
    .filter(p=>!['paid','cancelled'].includes(p.stage));
  const todayStr = window.bizDate ? window.bizDate() : today();
  const weekAhead = (()=>{ const d=new Date(); d.setDate(d.getDate()+7); return (window.bizDate?window.bizDate(d):d.toISOString().slice(0,10)); })();
  const overdue = projects.filter(p=>p.targetDate && p.targetDate < todayStr && !['delivered','completed'].includes(p.stage));
  const soon    = projects.filter(p=>p.targetDate && p.targetDate >= todayStr && p.targetDate <= weekAhead);
  const noTarget= projects.filter(p=>!p.targetDate);
  const urgent  = projects.filter(p=>window.priorityToStars(p.priority) >= 3);

  // Most urgent first, then soonest deadline — the order a planner triages in.
  const sorted = projects.slice().sort((a,b)=>{
    const pa=window.priorityToStars(a.priority), pb=window.priorityToStars(b.priority);
    if (pa!==pb) return pb-pa;
    const ta=a.targetDate||'9999-12-31', tb=b.targetDate||'9999-12-31';
    return ta<tb?-1:ta>tb?1:0;
  });

  const card = (p)=>{
    const jobOrders = orders.filter(o=>o.projectId===p.id);
    const late = p.targetDate && p.targetDate < todayStr && !['delivered','completed'].includes(p.stage);
    const st = jobStage(p.stage);
    const ed = p.jobOrder || {};
    return `<div class="item-card" style="border-left:3px solid ${st.color}">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1;min-width:170px">
          <div style="font-weight:700;font-size:13px">${escHtml(p.clientName||p.name||'Project')}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
            <span style="font-family:monospace">${escHtml(jobOrderNoFor(p))}</span>
            ${p.quoteNumber?` · quote ${escHtml(p.quoteNumber)}`:''}
            · <span class="badge" style="font-size:9px;background:${st.color};color:var(--on-primary)">${escHtml(st.label)}</span>
          </div>
          <div style="font-size:11px;margin-top:4px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
            <span style="color:${late?'var(--danger)':'var(--text-muted)'}">${emojiIcon('📅',16)} ${p.targetDate?`Target ${escHtml(p.targetDate)}${late?` ${emojiIcon('⚠️',16)}`:''}`:'No target date'}</span>
            <span style="color:var(--text-muted)">${emojiIcon('📦',16)} ${(Array.isArray(p.items)?p.items.length:0)} item(s)</span>
            ${jobOrders.length?`<span style="color:var(--text-muted)">${emojiIcon('🏭',16)} ${escHtml(jobOrders.map(o=>o.orderNo||'WO').join(', '))}</span>`:`<span class="badge badge-orange" style="font-size:9px">no work order yet</span>`}
            ${ed.revision?`<span class="badge badge-blue" style="font-size:9px" title="Edited by Production Planning">${emojiIcon('✏️',9)} rev. ${escHtml(String(ed.revision))}</span>`:''}
            ${(()=>{ const t=joTickedCount(joDoc(p)); return t.total?`<span style="color:var(--text-muted)" title="${t.done} of ${t.total} item-stages ticked">${emojiIcon('✅',16)} ${t.pct}%</span>`:''; })()}
            ${joScopeEdited(p)?`<span class="badge badge-orange" style="font-size:9px" title="The job order scope differs from the quotation">scope changed</span>`:''}
          </div>
          <div style="margin-top:5px">${window.priorityStarPicker({value:p.priority, coll:'job_projects', id:p.id, editable:canEdit})}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
          <button class="btn-primary btn-sm jo-print" data-id="${p.id}" style="white-space:nowrap">${emojiIcon('🖨',16)} Job Order</button>
          <button class="btn-secondary btn-sm jo-prog" data-id="${p.id}" style="white-space:nowrap">${emojiIcon('✅',16)} Progress</button>
          ${canEdit?`<button class="btn-secondary btn-sm jo-edit" data-id="${p.id}" style="white-space:nowrap">${emojiIcon('✏️',16)} Edit</button>`:''}
        </div>
      </div>
    </div>`;
  };

  el.innerHTML = `
    <div class="kpi-row" style="margin-bottom:12px">
      <div class="kpi-card"><div class="kpi-label">Open jobs</div><div class="kpi-value">${projects.length}</div></div>
      <div class="kpi-card" style="${urgent.length?'border-color:var(--danger)':''}"><div class="kpi-label">High / Urgent</div><div class="kpi-value" style="${urgent.length?'color:var(--danger)':''}">${urgent.length}</div></div>
      <div class="kpi-card" style="${soon.length?'border-color:var(--warning)':''}"><div class="kpi-label">Due ≤7 days</div><div class="kpi-value" style="${soon.length?'color:var(--warning)':''}">${soon.length}</div></div>
      <div class="kpi-card ${overdue.length?'red':''}"><div class="kpi-label">Overdue</div><div class="kpi-value">${overdue.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">No target date</div><div class="kpi-value">${noTarget.length}</div></div>
    </div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
      Every job here came from a won quotation. The printed Job Order carries the scope, the deadlines and the stage schedule — and no prices, so it can be handed to anyone on the floor. Tap the stars to set a job's priority.
    </div>
    ${!sorted.length ? window.renderEmptyState({icon:'🧾',title:'No open jobs',hint:'A job appears here once Sales converts a won quotation into a sales order.'}) : ''}
    ${sorted.length?`<div class="card"><div class="card-body" style="display:flex;flex-direction:column;gap:8px">${sorted.map(card).join('')}</div></div>`:''}`;
  if (window.lucide) lucide.createIcons({ nodes: [el] });

  el.querySelectorAll('.jo-print').forEach(b=>b.addEventListener('click', ()=>{
    const p = projects.find(x=>x.id===b.dataset.id);
    if (p) printJobOrder(p, orders);
  }));
  el.querySelectorAll('.jo-edit').forEach(b=>b.addEventListener('click', ()=>{
    const p = projects.find(x=>x.id===b.dataset.id);
    if (p) openJobOrderEditor(p, ()=>renderProdJobOrders(el, currentUser, currentRole));
  }));
  el.querySelectorAll('.jo-prog').forEach(b=>b.addEventListener('click', ()=>{
    const p = projects.find(x=>x.id===b.dataset.id);
    if (p) openJobOrderProgress(p, ()=>renderProdJobOrders(el, currentUser, currentRole));
  }));
  window.bindPriorityStars(el);
}

// Create the master project when a quote is won (called from the Sales Order flow).
async function createJobProject(d){
  // Money-critical fix — this is the single choke point every "convert quote
  // to Sales Order" path calls. Without a guard, converting the SAME won
  // quote twice (double-click past openSalesOrderModal's own window.busy()
  // disable, a stale/cached quote list whose "Ordered" badge hasn't
  // refreshed yet, two tabs open on the same quote) created TWO job_projects
  // + sales_orders for one deal — double-counting revenue everywhere
  // (Projects KPIs, the SO- ledger ref sums fine per-order since each SO id
  // is unique, but Sales Revenue itself is now booked twice for one sale).
  // Check for an existing job_project OR sales_order already tied to this
  // quoteId BEFORE writing anything, and refuse with a message the caller
  // (openSalesOrderModal) can turn into an "open the existing one" link.
  // NOT a Firestore transaction (job_projects ids are auto-generated, not
  // deterministic, so there's no single doc to lock on) — this is a
  // read-then-write guard, same class of fix as the UI-level disabled
  // button it backs up, not a full race-proof redesign.
  if (d && d.id) {
    const [existingProj, existingSO] = await Promise.all([
      db.collection('job_projects').where('quoteId','==', d.id).limit(1).get().catch(()=>({docs:[]})),
      db.collection('sales_orders').where('quoteId','==', d.id).limit(1).get().catch(()=>({docs:[]}))
    ]);
    if (existingProj.docs.length || existingSO.docs.length) {
      const existingProjectId = existingProj.docs.length
        ? existingProj.docs[0].id
        : (existingSO.docs[0].data().projectId || null);
      const err = new Error('This quote has already been converted to a Sales Order — refresh the list and open the existing project instead of creating a new one.');
      err.code = 'already-converted';
      err.existingProjectId = existingProjectId;
      throw err;
    }
  }
  const ym=(window.bizDate?window.bizDate():new Date().toISOString().slice(0,10)).slice(2,7).replace('-','');
  let projectNo;
  try {
    projectNo = await nextCounterId('job_projects',
      async () => (await db.collection('job_projects').get()).size,
      n => `JP-${ym}-${String(n).padStart(3,'0')}`);
  } catch(_) { projectNo = `JP-${ym}-${String(Date.now()).slice(-3)}`; }
  const contract=parseFloat(d.total)||0;
  const company=d.co||'BS';
  const who=userProfile?.displayName||currentUser.email;
  // For shared (BS) projects, remember the partner who originated the quote so
  // their portal can read the project + compute their 50% expected earnings.
  const partnerUid = (company==='BS') ? (d.partnerUid||d.createdBy||null) : null;
  const ref=await db.collection('job_projects').add({
    projectNo, company, name:((d.client||'Client')+' — '+(d.qno||'')).trim(),
    clientName:d.client||'', clientId: d.clientId || null, stage:'won',
    quoteId:d.id||null, quoteNumber:d.qno||'', quoteCollection: window.quoteCollectionFor(company),
    contractAmount:contract, amountCollected:0, arBalance:contract, vatRate:12, capital:0,
    dpPercent: d.dpPercent || null, balanceSchedule: null,
    // v14 sales-pipeline gap fix — the quote's line items carried forward from
    // openSalesOrderModal (js/departments.js), so Production can see WHAT to
    // build here without dereferencing back to a possibly-stale quote revision.
    items: Array.isArray(d.items) ? d.items : [],
    // Sales→Production handoff (owner's rule, 2026-08) — carried forward from
    // openSalesOrderModal the same way `items` is above. May still be blank at
    // creation time (Sales doesn't always know these yet); the actual gate is
    // enforced later at the "To Production" handoff (js/departments.js
    // transferOrderToProduction / ensureProdHandoffFields).
    targetDate: d.targetDate || null, priority: d.priority || null, notes: d.notes || '',
    acknowledgedAt: null, acknowledgedBy: null,
    partnerUid,
    split:{ isShared: company==='BS', barroPct:50, partnerPct:50 },
    documents:[{ type:'Quotation', ref:d.qno||'', at:new Date().toISOString(), by:who }],
    timeline:[{ at:new Date().toISOString(), event:'Project created — quote won', by:who }],
    payments:[], productionOrderIds:[],
    createdBy:currentUser.uid, createdByName:who,
    createdAt:firebase.firestore.FieldValue.serverTimestamp(), updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
  });
  window.logAudit && window.logAudit('create','project',ref.id,{ client:d.client, contract });
  return { id:ref.id, projectNo };
}

window.renderProjectLifecycle = async function(){
  const c = deptContainer(); if(!c) return;
  c.innerHTML=window.skeletonHtml('cards');
  const isPartnerU = currentRole==='partner' || (currentDepts||[]).length===1 && currentDepts[0]==='Brilliant Steel';
  // Sales→Production handoff (owner's rule) — Production-only viewers get WHAT to
  // build + target date/priority/stage, never contract/AR/collected figures.
  const showMoney = !isProductionOnlyViewer();
  // Primary data (job_projects) errors surface as a retry block — a permission
  // failure used to render identically to "no projects" via the old blanket
  // .catch(()=>({docs:[]})). The design-board read below stays a soft-fail
  // (secondary/read-only data some roles legitimately can't see).
  let projects;
  try {
    const snap = await db.collection('job_projects').orderBy('createdAt','desc').get();
    projects = snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch (err) {
    c.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load projects</h4><p>${escHtml(err.message||String(err))}</p><button type="button" class="btn-secondary btn-sm proj-retry-btn" style="margin-top:14px">Retry</button></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    c.querySelector('.proj-retry-btn')?.addEventListener('click', ()=>window.renderProjectLifecycle());
    return;
  }
  if (isPartnerU) projects = projects.filter(p=>p.createdBy===currentUser.uid || p.partnerUid===currentUser.uid); // partners: own + shared
  // Design-board projects (separate collection) shown read-only below, so this page
  // is the single place to see ALL projects. Partners never see the internal board.
  let designList = [];
  if (!isPartnerU) {
    const dsnap = await db.collection('projects').orderBy('createdAt','desc').get().catch(()=>({docs:[]}));
    designList = dsnap.docs.map(d=>window.Projects.normalize(d,'design'));
  }
  const canTagProjects = ['president','owner','manager','secretary'].includes(currentRole);
  const active = projects.filter(p=>!['paid','cancelled'].includes(p.stage));
  const inProd = projects.filter(p=>p.stage==='in_production').length;
  const forDel = projects.filter(p=>p.stage==='for_delivery'||p.stage==='delivered').length;
  // AR is DERIVED (contract − collected) rather than the stored arBalance field, so
  // the KPI is always correct even if a project's stored arBalance drifted.
  const collected = projects.reduce((s,p)=>s+(p.amountCollected||0),0);
  const arTotal = projects.reduce((s,p)=>s+Math.max(0,(p.contractAmount||0)-(p.amountCollected||0)),0);
  const byStage={}; active.forEach(p=>{ (byStage[p.stage]=byStage[p.stage]||[]).push(p); });
  const done = projects.filter(p=>['paid','cancelled'].includes(p.stage));

  const card = (p)=>{ const st=jobStage(p.stage); return `<div class="item-card proj-card" data-id="${p.id}" style="cursor:pointer;border-left:3px solid ${st.color}">
    <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:13px">${escHtml(p.clientName||p.name||'Project')}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px"><span style="font-family:monospace">${escHtml(p.projectNo||'')}</span> · ${escHtml(p.quoteNumber||'')} · <span class="badge ${window.isInternalQuoteCompany(p.company)?'badge-orange':'badge-gray'}" style="font-size:9px" title="${escHtml(window.quoteCompanyLabel(p.company))}">${escHtml(p.company||'')}</span>${p.split?.isShared?' <span class="badge badge-blue" style="font-size:9px">50/50</span>':''}</div>
        ${showMoney
          ? `<div style="font-size:11px;margin-top:3px">Contract ₱${fmt(p.contractAmount||0)} · <span style="color:${Math.max(0,(p.contractAmount||0)-(p.amountCollected||0))>0?'var(--warning)':'var(--success)'}">AR ₱${fmt(Math.max(0,(p.contractAmount||0)-(p.amountCollected||0)))}</span></div>`
          : (p.targetDate||p.priority) ? `<div style="font-size:11px;margin-top:3px;color:var(--text-muted)">${p.targetDate?`${emojiIcon('📅',16)} Target ${escHtml(p.targetDate)}`:''}${p.targetDate&&p.priority?' · ':''}${p.priority?escHtml(p.priority)+' priority':''}</div>` : ''}
      </div>
      <span class="badge" style="background:${st.color};color:var(--on-primary);flex-shrink:0">${st.icon} ${st.label}</span>
    </div></div>`; };

  c.innerHTML = `
    <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2>${emojiIcon('📈',20)} Projects</h2><div style="display:flex;align-items:center;gap:8px"><span style="font-size:12px;color:var(--text-muted)">Quote → Order → Production → Delivery → Paid</span>${canTagProjects?`<button class="btn-secondary btn-sm" onclick="window.runProjectKindBackfill()" title="Tag projects with kind (job/design)">${emojiIcon('🔖',16)} Tag</button>`:''}</div></div>
    <div class="kpi-row" style="margin-bottom:14px">
      <div class="kpi-card"><div class="kpi-label">Active</div><div class="kpi-value">${active.length}</div></div>
      <div class="kpi-card accent"><div class="kpi-label">In Production</div><div class="kpi-value">${inProd}</div></div>
      <div class="kpi-card"><div class="kpi-label">For Delivery</div><div class="kpi-value">${forDel}</div></div>
      ${showMoney ? `
      <div class="kpi-card ${arTotal>0?'warn':''}"><div class="kpi-label">Receivables ₱</div><div class="kpi-value" style="font-size:15px">₱${fmt(arTotal)}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Collected ₱</div><div class="kpi-value" style="font-size:15px">₱${fmt(collected)}</div></div>` : ''}
    </div>
    ${!projects.length?window.renderEmptyState({icon:'📈',title:'No projects yet',hint:'A project is created when a quote is converted to a Sales Order.'}):''}
    ${JOB_STAGES.filter(s=>!['paid','cancelled'].includes(s.id) && (byStage[s.id]||[]).length).map(s=>`
      <div class="card" style="margin-bottom:12px"><div class="card-header" style="display:flex;justify-content:space-between;align-items:center"><h3 style="font-size:13px">${s.icon} ${s.label}</h3><span class="badge" style="background:${s.color};color:var(--on-primary)">${(byStage[s.id]||[]).length}</span></div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:8px">${(byStage[s.id]||[]).map(card).join('')}</div></div>`).join('')}
    ${done.length?`<details style="margin-top:6px"><summary style="cursor:pointer;font-size:13px;font-weight:700;color:var(--text-muted);padding:6px 0">${emojiIcon('💰',13)} Paid / Closed (${done.length})</summary><div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">${done.slice(0,30).map(card).join('')}</div></details>`:''}
    ${designList.length?`<details style="margin-top:10px" open><summary style="cursor:pointer;font-size:13px;font-weight:700;color:var(--text-muted);padding:6px 0">${emojiIcon('🎨',13)} Design Projects (${designList.length})</summary>
      <div style="font-size:11px;color:var(--text-muted);margin:2px 0 8px">From the Design board — manage in Design → Projects.</div>
      <div style="display:flex;flex-direction:column;gap:8px">${designList.map(d=>`<div class="item-card" style="border-left:3px solid #4a148c">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:13px">${escHtml(d.name||'Design project')}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escHtml(d.clientName||'—')}${d.stage?` · ${escHtml(d.stage)}`:''}</div>
            ${showMoney ? `<div style="font-size:11px;margin-top:3px">Contract ₱${fmt(d.contractAmount)} · Collected ₱${fmt(d.collected)} · <span style="color:${d.arBalance>0?'var(--warning)':'var(--success)'}">AR ₱${fmt(d.arBalance)}</span></div>` : ''}
          </div>
          <span class="badge badge-purple" style="font-size:9px;flex-shrink:0">DESIGN</span>
        </div></div>`).join('')}</div></details>`:''}`;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  c.querySelectorAll('.proj-card').forEach(el=>el.addEventListener('click',()=>openJobProjectDetail(projects.find(p=>p.id===el.dataset.id))));
};

// NOTE: named openJobProjectDetail (not openProjectDetail) deliberately. The Design
// board defines window.openProjectDetail; in this shared global script a bare
// `openProjectDetail` would resolve to that Design modal and shadow this one.

// ═══════════════════════════════════════════════════
//  THE PROJECT FOLDER — one record every department opens
//  Owner's flow, 2026-08-18: the folder is "accessible by sales, production,
//  crm, marketing, and design" and carries "a dashboard, spent so far, days
//  passed, etc, status".
//
//  There were TWO project records and neither did that job. job_projects is the
//  spine — created at sales-order conversion, referenced by sales_orders,
//  production_orders and every ledger entry's projectId — but it had no
//  drawings and no elapsed/spend figures. `projects` (the Design folder) has
//  the drawings, files and Drive folder, but was reachable only from inside the
//  Design screen. Rather than migrate either into the other (a data migration
//  on live money records, for a presentation problem), job_projects is now the
//  folder and PULLS the design side in through the designProjectId link it
//  already stored. Nothing moves; two screens stop disagreeing.
// ═══════════════════════════════════════════════════
function jobDaysElapsed(p){
  const start = p.createdAt?.toDate ? p.createdAt.toDate() : (p.createdAt ? new Date(p.createdAt) : null);
  if (!start || isNaN(start)) return null;
  const today = new Date((window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10)) + 'T00:00:00');
  return Math.max(0, Math.round((today - new Date(start.toISOString().slice(0,10) + 'T00:00:00')) / 86400000));
}
function jobDaysToTarget(p){
  if (!p.targetDate) return null;
  const today = new Date((window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10)) + 'T00:00:00');
  return Math.round((new Date(p.targetDate + 'T00:00:00') - today) / 86400000);
}
// Actual recorded spend. Deliberately NOT `capital`: that field is the manual
// margin estimate somebody types in Edit Profit Factors, and it only moves on a
// material consume when the ledger post succeeded. These two are incremented by
// Production directly, so they are right even for a user with no finance rights.
function jobSpend(p){
  return (Number(p.spentMaterials) || 0) + (Number(p.spentLabor) || 0);
}

// ── Design → Sales approval ──────────────────────────────────────
// Owner's flow: Design "makes drawings, passes to sales for approval, and once
// approved, forwards to production". The drawing status machine already has an
// approval step, but canApproveDrawing resolves to president/manager or the
// project's own Design Lead — an internal sign-off, with Sales having no say.
// Rather than add a status to that machine (its transitions are enforced in
// firestore.rules, so every change there needs a rules deploy), the Sales
// sign-off lives on the job project as its own record and gates the ONE thing
// it is really about: the hand-off to Production.
function designApprovalOf(p){
  const a = (p && p.designApproval) || {};
  return { status: a.status || 'none', ...a };
}
function designApprovalBadge(p){
  const a = designApprovalOf(p);
  const map = {
    none:     { cls:'badge-gray',   txt:'Not sent to Sales' },
    pending:  { cls:'badge-orange', txt:'Awaiting Sales approval' },
    approved: { cls:'badge-green',  txt:'Approved by Sales' },
    changes:  { cls:'badge-red',    txt:'Changes requested by Sales' },
  };
  const m = map[a.status] || map.none;
  return `<span class="badge ${m.cls}" style="font-size:9px">${escHtml(m.txt)}</span>`;
}
// The gate transferOrderToProduction consults. `noDrawingsNeeded` is the
// documented escape hatch for an order that genuinely has nothing to draw.
window.jobDesignApproved = function(p, so){
  if (so && so.noDrawingsNeeded) return true;
  return designApprovalOf(p).status === 'approved';
};
async function setDesignApproval(p, status, note){
  const who = userProfile?.displayName || currentUser.email || '';
  const at = new Date().toISOString();
  const cur = designApprovalOf(p);
  const designApproval = status === 'pending'
    ? { status, requestedAt: at, requestedBy: currentUser.uid, requestedByName: who, notes: note || '' }
    : { ...cur, status, decidedAt: at, decidedBy: currentUser.uid, decidedByName: who, notes: note || '' };
  const event = status === 'pending' ? 'Drawings sent to Sales for approval'
    : status === 'approved' ? 'Drawings approved by Sales'
    : 'Sales requested changes to the drawings';
  await db.collection('job_projects').doc(p.id).update({
    designApproval,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    timeline: firebase.firestore.FieldValue.arrayUnion({ at, event: event + (note ? ' — ' + note : ''), by: who }),
  });
  if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('job_projects');
  p.designApproval = designApproval;
  window.logAudit && window.logAudit('update', 'project', p.id, { designApproval: status });
  try {
    if (status === 'pending') await Notifs.sendToDept('Sales', { title:'🔏 Drawings need your approval',
      body:`${p.clientName||p.name||'A job'} — Design has finished the drawings. Approve them so the job can go to Production.`,
      icon:'🔏', type:'project_stage', link:'projects-lifecycle' }, { fallbackToOwner:true });
    else await Notifs.sendToDept('Design', { title: status==='approved' ? '✅ Sales approved the drawings' : '↩️ Sales requested changes',
      body:`${p.clientName||p.name||'A job'}${note?' — '+note:''}`,
      icon: status==='approved'?'✅':'↩️', type:'project_stage', link:'dept:Design' }, { fallbackToOwner:true });
  } catch(_) {}
}

function openJobProjectDetail(p, opts){
  if(!p) return;
  const st=jobStage(p.stage);
  const isPartnerU = currentRole==='partner' || (currentDepts||[]).length===1 && currentDepts[0]==='Brilliant Steel';
  const ownerDept = st.dept;
  const canAdvance = !isPartnerU && (canEditDept(ownerDept) || canEditDept('Sales'));
  // Sales→Production handoff (owner's rule) — this viewer never sees the deal's
  // money (contract/AR/collected/margin/split/invoices); they get WHAT to build,
  // target date, priority, notes, and stage/status only.
  const showMoney = !isProductionOnlyViewer();
  // Production must acknowledge receipt of a job before they can advance its
  // stage/status. Only gates Production-only viewers — Sales/Finance/admin can
  // always advance, exactly as before. Stays gated across ALL Production-owned
  // stages (in_production/for_delivery/delivered), not just the first one, since
  // acknowledgedAt is set once and never cleared.
  const needsAck = isProductionOnlyViewer() && ownerDept==='Production' && !p.acknowledgedAt;
  const idx = JOB_STAGES.findIndex(s=>s.id===p.stage);
  // v14 prod-fixlist — idx===-1 (a stage string matching no JOB_STAGES id — a
  // corrupted/legacy value) used to fall through Math.min(idx+1,...) to index 0
  // ('won'), silently offering "Advance → Won" instead of surfacing the problem.
  const stageUnknown = idx === -1;
  const next = (stageUnknown || p.stage==='paid'||p.stage==='cancelled') ? null : JOB_STAGES[Math.min(idx+1, JOB_STAGES.length-2)];
  const stepper = JOB_STAGES.filter(s=>s.id!=='cancelled').map(s=>{const i=JOB_STAGES.findIndex(x=>x.id===s.id);const dn=i<idx,cur=s.id===p.stage;return `<span style="font-size:10px;padding:3px 7px;border-radius:10px;white-space:nowrap;${cur?`background:${s.color};color:var(--on-primary);font-weight:700`:dn?'background:var(--success);color:var(--on-primary)':'background:var(--surface2);color:var(--text-muted)'}">${s.icon} ${s.label}</span>`;}).join('<span style="color:var(--text-muted)">›</span>');
  // Sales→Production handoff (beta sweep) — the Document Register and Timeline
  // are NOT behind showMoney, yet both carry ₱ figures for Production-only
  // viewers: auto-posted 'Payment ₱X (deposit)' / 'Profit factors updated
  // (capital ₱X)' timeline events and Official-Receipt document rows whose ref
  // falls back to '₱<amount>'. Filter those out when money is hidden — every
  // auto-generated money string contains '₱', so that's the reliable signal,
  // plus a doc-type guard for receipts/invoices/billing. showMoney viewers see
  // everything unchanged.
  const visDocs = (p.documents||[]).filter(dc => showMoney || !(/receipt|invoice|billing/i.test(dc.type||'') || /₱/.test(dc.ref||'')));
  const visTimeline = (p.timeline||[]).slice().reverse().filter(t => showMoney || !/₱/.test(t.event||''));
  const jpdPanel = openPage(`${st.icon} ${escHtml(p.clientName||p.name||'Project')}`, `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px"><span style="font-family:monospace">${escHtml(p.projectNo||'')}</span> · Quote ${escHtml(p.quoteNumber||'')} · ${p.company||''}${p.split?.isShared?' · 50/50 split':''}</div>
    ${stageUnknown?`<div class="alert-banner alert-warn" style="margin-bottom:10px"><span>${emojiIcon('⚠️',16)} This project's stage ("${escHtml(p.stage||'')}") doesn't match any known lifecycle stage — data may be corrupted. An admin should fix it directly before advancing.</span></div>`:''}
    ${needsAck?`<div class="alert-banner alert-warn" style="margin-bottom:10px"><span>${emojiIcon('⚠️',16)} Acknowledge receipt of this job before you can update its status.</span></div>`:''}
    <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-bottom:12px">${stepper}</div>
    ${/* Dashboard — status, elapsed, deadline, spend. Spend is money, so it
         follows the same showMoney rule as contract/AR; the day counts are
         operational and everyone sees them. */''}
    <div class="kpi-row" style="margin-bottom:12px">
      <div class="kpi-card"><div class="kpi-label">Status</div><div class="kpi-value" style="font-size:13px;color:${st.color}">${st.icon} ${escHtml(st.label)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Days elapsed</div><div class="kpi-value">${jobDaysElapsed(p) ?? '—'}</div></div>
      ${(()=>{ const d=jobDaysToTarget(p); const late=d!=null&&d<0&&!['delivered','completed','paid'].includes(p.stage);
        return `<div class="kpi-card ${late?'red':(d!=null&&d<=7?'warn':'')}"><div class="kpi-label">${late?'Overdue by':'Days to target'}</div><div class="kpi-value">${d==null?'—':(late?Math.abs(d):d)}</div></div>`; })()}
      ${showMoney?`<div class="kpi-card"><div class="kpi-label">Spent so far</div><div class="kpi-value" style="font-size:14px">₱${fmt(jobSpend(p))}</div></div>`:''}
      ${showMoney?`<div class="kpi-card ${((p.contractAmount||0)-jobSpend(p))<0?'red':'green'}"><div class="kpi-label">Left of contract</div><div class="kpi-value" style="font-size:14px">₱${fmt((p.contractAmount||0)-jobSpend(p))}</div></div>`:''}
    </div>
    ${showMoney&&jobSpend(p)>0?`<div style="font-size:11px;color:var(--text-muted);margin:-6px 0 12px">Spent = materials consumed ₱${fmt(p.spentMaterials||0)} + labor logged ₱${fmt(p.spentLabor||0)}. Recorded by Production as the work happens — not the same figure as the manual Capital estimate below.</div>`:''}
    ${/* Design → Sales approval. Shown to everyone (it is the job's state);
         the ACTIONS are gated to the department whose turn it is. */''}
    <div class="card" style="margin-bottom:12px"><div class="card-body" style="padding:10px 14px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <strong style="font-size:12px">${emojiIcon('🔏',12)} Drawings — Sales approval</strong>
        ${designApprovalBadge(p)}
      </div>
      ${(()=>{ const a=designApprovalOf(p); const bits=[];
        if(a.requestedByName) bits.push(`Sent by ${escHtml(a.requestedByName)}${a.requestedAt?' on '+escHtml(String(a.requestedAt).slice(0,10)):''}`);
        if(a.decidedByName) bits.push(`${a.status==='approved'?'Approved':'Answered'} by ${escHtml(a.decidedByName)}${a.decidedAt?' on '+escHtml(String(a.decidedAt).slice(0,10)):''}`);
        if(a.notes) bits.push(escHtml(a.notes));
        return bits.length?`<div style="font-size:11px;color:var(--text-muted);margin-top:5px">${bits.join(' · ')}</div>`:
          `<div style="font-size:11px;color:var(--text-muted);margin-top:5px">Production cannot be handed this job until Sales approves the drawings (or the order is marked as needing none).</div>`; })()}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        ${(!isPartnerU && canEditDept('Design') && ['none','changes'].includes(designApprovalOf(p).status))?`<button class="btn-primary btn-sm" id="jpd-send-approval">${emojiIcon('🔏',16)} Send drawings to Sales</button>`:''}
        ${(!isPartnerU && canEditDept('Sales') && designApprovalOf(p).status==='pending')?`
          <button class="btn-success btn-sm" id="jpd-approve">${emojiIcon('✅',16)} Approve drawings</button>
          <button class="btn-secondary btn-sm" id="jpd-changes">${emojiIcon('↩️',16)} Request changes</button>`:''}
      </div>
    </div></div>
    ${/* Drawings. Production could not reach these AT ALL before — design_drawings
         appeared nowhere on this side of the app, so the department told to build
         from the drawings had no way to open one. Filled in async below. */''}
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:8px 0 4px">${emojiIcon('📐',16)} Drawings</div>
    <div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:0" id="jpd-drawings">
      <div style="padding:12px;font-size:12px;color:var(--text-muted)">Loading drawings…</div>
    </div></div>
    ${(p.targetDate||p.priority||p.notes)?`
    <div class="card" style="margin-bottom:12px"><div class="card-body" style="padding:10px 14px;font-size:12px">
      ${p.targetDate?`<div style="margin-bottom:3px"><span style="color:var(--text-muted)">${emojiIcon('📅',16)} Target Date</span> <strong>${escHtml(p.targetDate)}</strong></div>`:''}
      ${p.priority?`<div style="margin-bottom:3px"><span style="color:var(--text-muted)">Priority</span> <span class="badge ${p.priority==='Urgent'||p.priority==='High'?'badge-red':p.priority==='Low'?'badge-green':'badge-orange'}" style="font-size:9px">${escHtml(p.priority)}</span></div>`:''}
      ${p.notes?`<div><span style="color:var(--text-muted)">Notes</span><div style="margin-top:2px">${escHtml(p.notes)}</div></div>`:''}
    </div></div>`:''}
    ${showMoney?`
    <div class="kpi-row" style="margin-bottom:12px">
      <div class="kpi-card"><div class="kpi-label">Contract</div><div class="kpi-value" style="font-size:14px">₱${fmt(p.contractAmount||0)}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Collected</div><div class="kpi-value" style="font-size:14px">₱${fmt(p.amountCollected||0)}</div></div>
      <div class="kpi-card ${Math.max(0,(p.contractAmount||0)-(p.amountCollected||0))>0?'warn':''}"><div class="kpi-label">Balance (AR)</div><div class="kpi-value" style="font-size:14px">₱${fmt(Math.max(0,(p.contractAmount||0)-(p.amountCollected||0)))}</div></div>
    </div>`:''}
    ${(p.items&&p.items.length)?`
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:8px 0 4px">${emojiIcon('📦',16)} Order Items — what to build</div>
    <div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:0">
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Item</th><th>Qty</th>${showMoney?'<th>Unit Price</th><th>Amount</th>':''}</tr></thead><tbody>
      ${p.items.map(it=>`<tr>
        <td style="font-size:12px">${escHtml(it.name||'')}${it.dims?` <span style="color:var(--text-muted)">(${escHtml(it.dims)})</span>`:''}${it.specStr?`<div style="font-size:10px;color:var(--text-muted)">${escHtml(it.specStr)}</div>`:''}</td>
        <td style="font-size:12px">${Number(it.qty)||0} ${escHtml(it.unit||'')}</td>
        ${showMoney?`<td style="font-size:12px">₱${fmt(it.unitPrice||0)}</td>
        <td style="font-size:12px;font-weight:600">₱${fmt(it.amount||0)}</td>`:''}
      </tr>`).join('')}
      </tbody></table></div>
    </div></div>`:''}
    ${showMoney?`
    <div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:10px 14px">
      <div style="display:flex;justify-content:space-between;align-items:center"><strong style="font-size:12px">${emojiIcon('💰',12)} Margin &amp; Split</strong>${(!isPartnerU && (canEditDept('Sales')||_isFinAdmin()))?`<button class="btn-secondary btn-sm" id="proj-margin-btn">Edit factors</button>`:''}</div>
      <div style="font-size:12px;margin-top:6px;display:grid;grid-template-columns:1fr auto;gap:3px 12px">
        <span style="color:var(--text-muted)">Contract</span><span style="text-align:right">₱${fmt(p.contractAmount||0)}</span>
        <span style="color:var(--text-muted)">Capital (cost)</span><span style="text-align:right">₱${fmt(p.capital||0)}</span>
        <span style="color:var(--text-muted)">Margin</span><span style="text-align:right;font-weight:700">₱${fmt((p.contractAmount||0)-(p.capital||0))}</span>
        ${p.split?.isShared?`<span style="color:var(--text-muted)">Partner share (${p.split?.partnerPct||50}%)</span><span style="text-align:right;font-weight:700;color:var(--success)">₱${fmt(((p.contractAmount||0)-(p.capital||0))*((p.split?.partnerPct||50)/100))}</span>`:''}
      </div>
    </div></div>`:''}
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:8px 0 4px">${emojiIcon('📄',16)} Document Register</div>
    <div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:0">
      ${visDocs.length?`<div class="table-wrap"><table class="data-table"><tbody>${visDocs.map(dc=>`<tr><td style="font-weight:600;font-size:12px">${escHtml(dc.type||'')}</td><td style="font-size:11px">${(dc.driveUrl||dc.url)?`<a href="${escHtml(dc.driveUrl||dc.url)}" target="_blank" rel="noopener">${escHtml(dc.ref||'Open')}</a>`:escHtml(dc.ref||'')}</td><td style="font-size:11px;color:var(--text-muted)">${dc.at?new Date(dc.at).toLocaleDateString('en-PH',{month:'short',day:'numeric'}):''} · ${escHtml(dc.by||'')}</td></tr>`).join('')}</tbody></table></div>`:'<div style="padding:12px;font-size:12px;color:var(--text-muted)">No documents yet.</div>'}
    </div></div>
    ${(showMoney && (p.invoices||[]).length)?`
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:8px 0 4px">${emojiIcon('🧾',16)} Billing Invoices</div>
    <div class="item-list" style="margin-bottom:10px">${(p.invoices||[]).slice().reverse().map(inv=>`
      <div class="item-card jinv-card" style="cursor:pointer" data-inv="${escHtml(inv.no)}">
        <div class="item-top"><div class="item-title" style="font-size:13px">${emojiIcon('🧾',13)} ${escHtml(inv.no)}</div><span>₱${fmt(inv.amount)}</span></div>
        <div class="item-meta"><span>${emojiIcon('📅',16)} ${escHtml(inv.date||'')}</span>${inv.due?`<span>Due ${escHtml(inv.due)}</span>`:''}${inv.desc?`<span>${escHtml(inv.desc)}</span>`:''}</div>
      </div>`).join('')}</div>`:''}
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:8px 0 4px">${emojiIcon('🕘',16)} Timeline</div>
    <div style="max-height:160px;overflow:auto;font-size:12px">${visTimeline.map(t=>`<div style="padding:5px 0;border-bottom:1px solid var(--border)"><strong>${escHtml(t.event||'')}</strong><div style="font-size:11px;color:var(--text-muted)">${t.at?new Date(t.at).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):''} · ${escHtml(t.by||'')}</div></div>`).join('')||'<div style="color:var(--text-muted)">No activity yet.</div>'}</div>
    <div id="proj-detail-err" class="error-msg hidden" style="margin-top:8px"></div>
  `, `
    ${_isFinAdmin()&&!isPartnerU?`<button class="btn-primary" id="proj-bill-btn">${emojiIcon('💵',16)} Record Payment</button>`:''}
    ${_isFinAdmin()&&!isPartnerU&&(Number(p.contractAmount)||0)>0?`<button class="btn-secondary" id="proj-invoice-btn">${emojiIcon('🧾',16)} Billing Invoice</button>`:''}
    ${/* 'in_design' is deliberately excluded — a job in Design cannot get a production order; 'won' is kept only for legacy pre-design-flow projects. */''}
    ${!isPartnerU && (canEditDept('Production')||canEditDept('Sales')) && window.currentRole !== 'secretary' && ['won','in_production'].includes(p.stage)?`<button class="btn-secondary" id="proj-job-btn">${emojiIcon('🏭',16)} Job Order</button>`:''}
    ${needsAck?`<button class="btn-success" id="proj-ack-btn">${emojiIcon('✅',16)} Acknowledge receipt</button>`:(canAdvance&&next?`<button class="btn-success" id="proj-advance-btn">Advance → ${next.label}</button>`:'')}
    <button class="btn-secondary" onclick="closeModal()">Close</button>`, opts || {});
  // SCOPED TO THIS PANEL — these six were document.getElementById. The Billing
  // Invoice sub-flow returns with `Overlay.clearAll(); openJobProjectDetail(p)`
  // in ONE tick (production.js, the jinv cancel path) and openPage defers node
  // removal by 300ms, so the OLD job-project panel is still in the document and
  // EARLIER in document order — it won every one of these lookups and the
  // visible footer was bound to nothing. Reproduced by the review: 4 panels in
  // the DOM, the lookup resolved to the dying panel, and clicking all three
  // visible footer buttons fired 0 handlers. Only Close (inline onclick) worked,
  // so the job could not be advanced without closing and reopening the window.
  // jpdPanel is the panel openPage returned; it is already used for .jinv-card
  // below, so scoping here simply makes the footer consistent with it.
  jpdPanel.querySelector('#proj-advance-btn')?.addEventListener('click', async (e)=>{
    const btn = e.currentTarget; btn.disabled = true; // guard against double-click double-posting
    try { await advanceProjectStage(p, next.id); } finally { if (btn) btn.disabled = false; }
  });
  jpdPanel.querySelector('#proj-ack-btn')?.addEventListener('click', async (e)=>{
    const btn = e.currentTarget; btn.disabled = true; // guard against double-click double-posting
    const who = userProfile?.displayName||currentUser.email;
    try {
      await db.collection('job_projects').doc(p.id).update({
        acknowledgedAt: firebase.firestore.FieldValue.serverTimestamp(), acknowledgedBy: who,
        timeline: firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:'Production acknowledged receipt', by:who })
      });
      window.logAudit && window.logAudit('update','project',p.id,{ acknowledged:true });
      Notifs.success('Receipt acknowledged — you can now update the job\'s status.');
      closeModal();
      // Re-open with fresh data so the Advance control now shows.
      const fresh = await db.collection('job_projects').doc(p.id).get();
      if (fresh.exists) openJobProjectDetail({ id:p.id, ...fresh.data() });
    } catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); if (btn) btn.disabled = false; }
  });
  // Drawings, filled after the panel is up (openPage paints on the tap frame).
  // panelLive() guards the late landing — the user can press Back mid-flight.
  (async () => {
    const box = jpdPanel.querySelector('#jpd-drawings');
    if (!box) return;
    if (!p.designProjectId) {
      if (panelLive(jpdPanel)) box.innerHTML = `<div style="padding:12px;font-size:12px;color:var(--text-muted)">No design folder is linked to this job yet — it is created when Finance records the sale and sends the order to Design.</div>`;
      return;
    }
    let dwgs = [];
    try {
      const snap = await db.collection('design_drawings').where('projectId','==',p.designProjectId).get();
      dwgs = snap.docs.map(d=>({id:d.id,...d.data()}));
    } catch(ex) {
      if (panelLive(jpdPanel)) box.innerHTML = `<div style="padding:12px;font-size:12px;color:var(--text-muted)">Couldn't load the drawings (${escHtml(ex.message||ex.code||'')}).</div>`;
      return;
    }
    if (!panelLive(jpdPanel)) return;
    // The shop floor builds from RELEASED drawings. Showing a Production-only
    // viewer a draft or an unapproved revision invites the wrong part getting
    // made, so they see released only and are told when others exist.
    const prodOnly = isProductionOnlyViewer();
    const shown = prodOnly ? dwgs.filter(d=>d.status==='released') : dwgs;
    const hidden = dwgs.length - shown.length;
    box.innerHTML = shown.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Drawing</th><th>Rev</th><th>Status</th><th></th></tr></thead><tbody>
      ${shown.map(d=>`<tr>
        <td style="font-size:12px;font-weight:600">${escHtml(d.title||d.number||'Drawing')}</td>
        <td style="font-size:12px">${escHtml(d.currentRev||'A')}</td>
        <td><span class="badge ${d.status==='released'?'badge-green':d.status==='approved'?'badge-blue':d.status==='for_review'?'badge-orange':'badge-gray'}" style="font-size:9px">${escHtml((d.status||'draft').replace('_',' '))}</span></td>
        <td style="text-align:right">${(d.driveUrl||d.fileUrl)?`<a class="btn-secondary btn-sm" href="${escHtml(d.driveUrl||d.fileUrl)}" target="_blank" rel="noopener">${emojiIcon('📄',14)} Open</a>`:'<span style="font-size:11px;color:var(--text-muted)">no file</span>'}</td>
      </tr>`).join('')}
      </tbody></table></div>${hidden>0?`<div style="padding:8px 12px;font-size:11px;color:var(--text-muted)">${hidden} more drawing(s) are not released yet and are not shown here — build only from released revisions.</div>`:''}`
      : `<div style="padding:12px;font-size:12px;color:var(--text-muted)">${dwgs.length
          ? `${dwgs.length} drawing(s) exist but none are released yet — build only from released revisions.`
          : 'No drawings have been uploaded for this job yet.'}</div>`;
    if (window.lucide) lucide.createIcons({ nodes: [box] });
  })();

  const reopenJpd = async () => {
    closeModal();
    const fresh = await db.collection('job_projects').doc(p.id).get();
    if (fresh.exists) openJobProjectDetail({ id:p.id, ...fresh.data() });
  };
  jpdPanel.querySelector('#jpd-send-approval')?.addEventListener('click', (ev)=>window.busy(ev.currentTarget, async ()=>{
    await setDesignApproval(p, 'pending', '');
    Notifs.success('Sent to Sales for approval.'); await reopenJpd();
  }));
  jpdPanel.querySelector('#jpd-approve')?.addEventListener('click', (ev)=>window.busy(ev.currentTarget, async ()=>{
    await setDesignApproval(p, 'approved', '');
    Notifs.success('Drawings approved — Design can now hand the job to Production.'); await reopenJpd();
  }));
  jpdPanel.querySelector('#jpd-changes')?.addEventListener('click', (ev)=>window.busy(ev.currentTarget, async ()=>{
    const note = prompt('What needs to change on the drawings?', '');
    if (note === null) return;
    await setDesignApproval(p, 'changes', note.trim());
    Notifs.success('Sent back to Design.'); await reopenJpd();
  }));

  jpdPanel.querySelector('#proj-bill-btn')?.addEventListener('click',()=>openProjectBillingModal(p));
  jpdPanel.querySelector('#proj-invoice-btn')?.addEventListener('click',()=>openJobBillingInvoiceModal(p));
  jpdPanel.querySelector('#proj-margin-btn')?.addEventListener('click',()=>openProjectMarginModal(p));
  jpdPanel.querySelector('#proj-job-btn')?.addEventListener('click',()=>{ closeModal(); prodOrderModal(null, currentUser, currentRole, ()=>window.renderProjectLifecycle&&window.renderProjectLifecycle(), p.id); });
  // Re-open a previously issued billing invoice (printable)
  jpdPanel.querySelectorAll('.jinv-card').forEach(card=>card.addEventListener('click',()=>{
    const inv=(p.invoices||[]).find(i=>i.no===card.dataset.inv);
    if(inv) window.openBillingInvoice(p, inv);
  }));
}

// Edit the profit factors (capital cost + partner split %) on a project.
// Gated to president / Sales / Finance per the user's request; partner cannot edit.
function openProjectMarginModal(p){
  const isShared = !!(p.split&&p.split.isShared);
  const pct = (p.split&&typeof p.split.partnerPct==='number')?p.split.partnerPct:50;
  const _panel = openPage(`${emojiIcon('💰',16)} Edit Profit Factors — `+(escHtml(p.clientName||p.projectNo||'Project')), `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Contract value <strong>₱${fmt(p.contractAmount||0)}</strong>. Expected earnings = (Contract − Capital) × split%.</div>
    <div class="form-group"><label>Capital / cost (₱)</label><input id="pm-capital" type="number" step="0.01" min="0" value="${p.capital||0}" inputmode="decimal"/>
      <div style="font-size:11px;color:var(--text-muted);margin-top:3px">Total material + labor + overhead to produce this job.</div></div>
    ${isShared?`<div class="form-group"><label>Partner split (%)</label><input id="pm-pct" type="number" step="1" min="0" max="100" value="${pct}" inputmode="decimal"/>
      <div style="font-size:11px;color:var(--text-muted);margin-top:3px">Brilliant Steel's share of the margin (50/50 default). Barro keeps the rest.</div></div>`:''}
    <div class="card" style="margin-top:6px"><div class="card-body" style="padding:10px 14px;font-size:12px;display:grid;grid-template-columns:1fr auto;gap:3px 12px">
      <span style="color:var(--text-muted)">Margin</span><span id="pm-margin" style="text-align:right;font-weight:700">₱${fmt((p.contractAmount||0)-(p.capital||0))}</span>
      ${isShared?`<span style="color:var(--text-muted)">Partner share</span><span id="pm-share" style="text-align:right;font-weight:700;color:var(--success)">₱${fmt(((p.contractAmount||0)-(p.capital||0))*(pct/100))}</span>
      <span style="color:var(--text-muted)">Barro share</span><span id="pm-barro" style="text-align:right;font-weight:700">₱${fmt(((p.contractAmount||0)-(p.capital||0))*((100-pct)/100))}</span>`:''}
    </div></div>
    <div id="pm-err" class="error-msg hidden" style="margin-top:8px"></div>
  `, `<button class="btn-primary" id="pm-save">Save Factors</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  // ⚠ SCOPED TO THIS PANEL, NOT document — same defect as openJobProjectDetail's
  // footer above. Two projects' factor forms alive at once share #pm-capital /
  // #pm-pct, so an unscoped read would take the PREVIOUS project's capital and
  // split % and write them onto THIS project's job_projects doc — margin,
  // partner share and Barro share all silently wrong.
  const $pm = (id) => _panel.querySelector('#' + id);
  const recompute=()=>{
    const cap=parseFloat($pm('pm-capital').value)||0;
    const margin=(p.contractAmount||0)-cap;
    $pm('pm-margin').textContent='₱'+fmt(margin);
    if(isShared){
      const pp=Math.max(0,Math.min(100,parseFloat($pm('pm-pct').value)||0));
      $pm('pm-share').textContent='₱'+fmt(margin*(pp/100));
      $pm('pm-barro').textContent='₱'+fmt(margin*((100-pp)/100));
    }
  };
  $pm('pm-capital').addEventListener('input',recompute);
  $pm('pm-pct')?.addEventListener('input',recompute);
  $pm('pm-save').addEventListener('click', async ()=>{
    const err=$pm('pm-err');
    const cap=parseFloat($pm('pm-capital').value)||0;
    if(cap<0){ err.textContent='Capital cannot be negative.'; err.classList.remove('hidden'); return; }
    const who=userProfile?.displayName||currentUser.email;
    const update={ capital:cap, updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
      timeline:firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:`Profit factors updated (capital ₱${window.fmtN2(cap)})`, by:who }) };
    if(isShared){
      let pp=Math.max(0,Math.min(100,parseFloat($pm('pm-pct').value)||0));
      update['split.partnerPct']=pp; update['split.barroPct']=100-pp;
    }
    const saveBtn=$pm('pm-save'); saveBtn.disabled=true; // guard against double-click double-posting
    try{
      await db.collection('job_projects').doc(p.id).update(update);
      window.logAudit && window.logAudit('update','project',p.id,{ capital:cap, partnerPct:update['split.partnerPct'] });
      // reflect locally so the reopened detail shows fresh numbers
      p.capital=cap; if(isShared){ p.split=p.split||{}; p.split.partnerPct=update['split.partnerPct']; p.split.barroPct=update['split.barroPct']; }
      closeModal(); Notifs.success('Profit factors saved'); window.renderProjectLifecycle&&window.renderProjectLifecycle();
    }catch(ex){ err.textContent='Failed: '+(ex.message||ex.code); err.classList.remove('hidden'); saveBtn.disabled=false; }
  });
}

async function advanceProjectStage(p, nextId){
  // Design-flow boundaries route through the canonical handoff helpers so the
  // generic Advance button can never skip the design queue or the handoff gate.
  if (nextId === 'in_design' || (p.stage === 'in_design' && nextId === 'in_production')) {
    let so = null;
    try {
      if (p.salesOrderId) { const s = await db.collection('sales_orders').doc(p.salesOrderId).get(); if (s.exists) so = { id:s.id, ...s.data() }; }
      if (!so) { const q = await db.collection('sales_orders').where('projectId','==',p.id).limit(1).get(); if (q.docs.length) so = { id:q.docs[0].id, ...q.docs[0].data() }; }
    } catch(_){}
    if (nextId === 'in_design') {
      if (!so) { Notifs.showToast('No sales order is linked to this project — record the sale in Finance first.','error'); return; }
      const ok = await window.transferOrderToDesign(so);
      if (ok) { Notifs.success('Moved to In Design'); closeModal(); window.renderProjectLifecycle(); }
      return;
    }
    // in_design → in_production
    if (so) {
      const ok = await window.transferOrderToProduction(so);
      if (ok) { Notifs.success('Moved to In Production'); closeModal(); window.renderProjectLifecycle(); }
      return;
    }
    // No SO (legacy/manual project): fall through to the generic write below,
    // but still demand the handoff trio on the job doc via the shared panel.
    // The Sales sign-off is enforced HERE TOO. Without it this branch is a hole
    // straight through the gate: transferOrderToProduction guards the path with
    // a sales order, and a legacy job would reach the floor with unapproved
    // drawings simply because nobody had linked an order to it.
    if (!window.jobDesignApproved(p, null)) {
      const a = designApprovalOf(p);
      Notifs.showToast(a.status === 'pending'
        ? 'Sales has not approved the drawings yet — this job cannot go to Production until they do.'
        : a.status === 'changes'
          ? 'Sales asked for changes to the drawings. Resolve them and send to Sales again first.'
          : 'Send the drawings to Sales for approval before moving this job to Production.', 'error');
      return;
    }
    const ok = await window.ensureProdHandoffFields({ id:null, projectId:p.id,
      targetDate:p.targetDate, priority:p.priority, notes:p.notes });
    if (!ok) return;
  }
  const who=userProfile?.displayName||currentUser.email;
  const ns=jobStage(nextId);
  try{
    await db.collection('job_projects').doc(p.id).update({
      stage:nextId, updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
      timeline:firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:'Moved to '+ns.label, by:who })
    });
    // keep the client's public tracker in step with the internal lifecycle
    const _trkStage = trackerKeyFor(nextId);   // v12 WS28 — single shared translator (old qc/ready keys were dead)
    if(p.trackingToken && _trkStage) window.syncOrderTracking(p.trackingToken, { status:_trkStage });
    // hand off to the owning department of the new stage
    const dept=ns.dept;
    try{ if(dept&&dept!=='Sales') await Notifs.sendToDept(dept,{ title:`📈 ${ns.label}: ${p.clientName||p.projectNo}`, body:`Project ${p.projectNo} is now "${ns.label}". Your team's action is needed.`, icon:ns.icon, type:'project_stage', link:'projects-lifecycle' }, { fallbackToOwner:true }); }catch(_){}
    if(nextId==='delivered') { try{ await Notifs.sendToDept('Finance',{ title:'📦 Ready to bill balance', body:`${p.clientName} (${p.projectNo}) delivered — collect balance ₱${fmt(Math.max(0,(p.contractAmount||0)-(p.amountCollected||0)))}.`, icon:'💵', type:'project_stage', link:'projects-lifecycle' }); }catch(_){} }
    if(nextId==='paid') { try{ await Notifs.sendToOwner({ title:'💰 Project paid', body:`${p.clientName} (${p.projectNo}) fully collected.`, icon:'💰', type:'project_paid', link:'projects-lifecycle' }); }catch(_){} }
    window.logAudit && window.logAudit('update','project',p.id,{ stage:nextId });
    Notifs.success('Moved to '+ns.label); closeModal(); window.renderProjectLifecycle();
  }catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
}

async function openProjectBillingModal(p){
  // M7 fix — derive the balance the same way the KPI does (contract − collected,
  // ~renderProjectLifecycle's arTotal), not the stored arBalance field (known to
  // drift from the real payment history). Feeds both the displayed balance and
  // the amount input's default below.
  const bal=Math.max(0,(p.contractAmount||0)-(p.amountCollected||0));
  // ── v14 tap-latency inversion ───────────────────────────────────────────
  // openPage used to run AFTER `await BankAccounts.optionsHTML()`, so the tap on
  // "Record Payment" changed nothing on screen until that read resolved — the
  // press state had already released and there was no window yet to animate.
  // The window is now created SYNCHRONOUSLY in the tap handler with a skeleton
  // body, and the bank-account <select> markup (the only awaited input this
  // form has) is poured into `.page-panel-body` when it lands.
  // Title and footer are built from `p` and static text only — neither depends
  // on the fetch — so both are final from the very first frame and nothing has
  // to be re-titled or re-footed on fill.
  // "Record + Post to Ledger" nonetheless ships `disabled`: its click listener is
  // wired at the BOTTOM of the renderer below, so for the whole length of the read
  // it would otherwise be a live-LOOKING button that swallows taps in silence. It
  // is re-enabled the instant the form (and that listener) exist — and stays
  // disabled on the error path, where the renderer never runs at all. Cancel is an
  // inline onclick, so the user's escape hatch works from frame one regardless.
  const panel = openPage(`${emojiIcon('💵',16)} Record Payment — `+escHtml(p.clientName||''), window.skeletonHtml('rows'),
    `<button class="btn-primary" id="pb-save" disabled>Record + Post to Ledger</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  const pbBody = panel.querySelector('.page-panel-body');
  // withLoadingAndError (js/ui-states.js) owns the whole skeleton → data → error
  // lifecycle, including a Retry button it wires itself and which re-runs the
  // read in place inside THIS panel — so a failed load can never leave an
  // eternal skeleton. EVERYTHING below lives inside the renderer on purpose:
  // until it runs, the body holds nothing but skeleton divs, so a listener
  // bound any earlier would silently bind to nothing.
  // NOTE ON INDENTATION: the renderer body is deliberately NOT re-indented.
  // Its markup is one big template literal whose leading whitespace is part of
  // the emitted HTML string; shifting it would change the bytes this window
  // renders, which this pass is explicitly not allowed to do.
  await window.withLoadingAndError(pbBody, () => window.BankAccounts.optionsHTML(), (bankOpts) => {
  if (!panelLive(panel)) return;   // closed mid-flight — fill nothing, wire nothing
  pbBody.innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Contract ₱${fmt(p.contractAmount||0)} · Collected ₱${fmt(p.amountCollected||0)} · <strong>Balance ₱${fmt(bal)}</strong></div>
    <div class="form-row">
      <div class="form-group"><label>Payment Type</label><select id="pb-type" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)"><option>Downpayment</option><option>Progress Billing</option><option>Final Balance</option></select></div>
      <div class="form-group"><label>Amount (₱)</label><input id="pb-amount" type="number" inputmode="decimal" step="0.01" value="${bal>0?bal:''}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>VAT treatment</label>
        <select id="pb-vat" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          <option value="inclusive" selected>VAT-inclusive — 12% already in the amount</option>
          <option value="exclusive">VAT-exclusive — add 12% on top</option>
          <option value="exempt">VAT-exempt / Zero-rated — no VAT</option>
        </select></div>
      <div class="form-group"><label>Method</label><select id="pb-method" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)"><option>Bank Transfer</option><option>GCash</option><option>Cash</option><option>Cheque</option></select></div>
    </div>
    <div class="form-group"><label>Deposited to (company account)</label>
      <select id="pb-bankacct" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${bankOpts}</select>
    </div>
    <div class="card" style="margin:6px 0"><div class="card-body" style="padding:8px 14px;font-size:12px;display:grid;grid-template-columns:1fr auto;gap:2px 12px">
      <span style="color:var(--text-muted)">Recorded total</span><span id="pb-rec" style="text-align:right;font-weight:700;color:var(--success)">₱0.00</span>
      <span style="color:var(--text-muted)">Net of VAT</span><span id="pb-net" style="text-align:right">₱0.00</span>
      <span style="color:var(--text-muted)">Output VAT</span><span id="pb-vatamt" style="text-align:right">₱0.00</span>
    </div></div>
    <div class="form-group"><label>OR / Reference No.</label><input id="pb-ref" placeholder="Official Receipt no."/>${window.birOrButtonHTML ? window.birOrButtonHTML('pb-ref') : ''}</div>
    <div class="form-group"><label>Receipt (proof)</label><div id="pb-receipt-upload"></div></div>
    <div id="pb-err" class="error-msg hidden"></div>
  `;
  // The injected markup is full of emojiIcon() output (`<i data-lucide=…>`);
  // openPage's own sweep ran long before this fill, so without this pass every
  // one of those icons stays an empty <i>.
  if (window.lucide) lucide.createIcons({ nodes: [pbBody] });
  // Scope the sweep to THIS panel — wireBirOrButtons already takes an optional
  // root (js/bir.js), and the only .bir-or-btn here is #pb-ref, just injected
  // above. (KNOWN RESIDUAL, js/bir.js not owned by this pass: the handler it
  // binds writes the minted serial with document.getElementById(dataset.field),
  // so during openPage's ~300ms teardown the OR number can still land in a
  // dying panel's #pb-ref. Fixing that needs the field lookup scoped inside
  // bir.js.)
  window.wireBirOrButtons && window.wireBirOrButtons(panel);
  let receipt=null;
  if(window.Drive?.renderUploadArea) Drive.renderUploadArea('pb-receipt-upload',(r)=>{receipt=r;},{label:'Upload OR / proof',accept:'image/*,.pdf',dept:'Finance',subfolder:'Collections'});
  // ⚠ SCOPED TO THIS PANEL, NOT document — same rule as the pb-save release at
  // the bottom of this renderer, now applied to every field too. Record Payment
  // can be reopened straight from the job-project detail (which itself reopens
  // via Overlay.clearAll() + openJobProjectDetail in one tick), so a second
  // panel routinely exists while the first is still in its 300ms teardown. An
  // unscoped read would post the PREVIOUS project's amount/VAT/OR ref into the
  // ledger and against THIS project's AR.
  const $pb = (id) => panel.querySelector('#' + id);
  const pbRecompute=()=>{
    const { recorded, net, vat }=window.vatSplit(parseFloat($pb('pb-amount').value)||0, $pb('pb-vat').value);
    $pb('pb-rec').textContent='₱'+fmt(recorded);
    $pb('pb-net').textContent='₱'+fmt(net);
    $pb('pb-vatamt').textContent='₱'+fmt(vat);
  };
  $pb('pb-amount').addEventListener('input',pbRecompute);
  $pb('pb-vat').addEventListener('change',pbRecompute);
  pbRecompute();
  $pb('pb-save').addEventListener('click', async ()=>{
    const err=$pb('pb-err');
    const saveBtn=$pb('pb-save');
    const entered=parseFloat($pb('pb-amount').value)||0;
    if(entered<=0){ err.textContent='Enter an amount.'; err.classList.remove('hidden'); return; }
    const vatTreatment=$pb('pb-vat').value;
    const { recorded:amount, net, vat:vatAmount }=window.vatSplit(entered,vatTreatment);
    const newCollected=(p.amountCollected||0)+amount;
    const newAR=Math.max(0,(p.contractAmount||0)-newCollected);
    const who=userProfile?.displayName||currentUser.email;
    const type=$pb('pb-type').value, method=$pb('pb-method').value, orRef=$pb('pb-ref').value.trim();
    const acctSel=$pb('pb-bankacct').value;
    if (!acctSel && (await window.BankAccounts.list()).length) {
      err.textContent = 'Select the company account that received this payment.'; err.classList.remove('hidden'); return;
    }
    const acct = await window.BankAccounts.pick(acctSel);
    saveBtn.disabled=true; // guard against double-click double-posting (payments are legitimately multiple)
    try{
      // v13 Phase 13 — 1) ledger credit + 2) the job_projects payment/collected/AR
      // update now commit in ONE transaction via projectSync (previously two
      // separate awaits that could leave the ledger posted with no matching
      // project update, or vice versa, if the second write threw).
      // Money-critical fix — was `PROJ-${p.id}-${p.payments.length}`, a
      // POSITIONAL index keyed off the in-memory `p` snapshot's payment count
      // at the time the panel opened. Two payments recorded close together
      // (stale `p`, two tabs/sessions on the same project, a slow first save
      // that lets a second one start) could compute the SAME index — the
      // second write then hits Ledger.post's dedupe as "already posted" and
      // is dropped entirely (no ledger row, no job_projects update: the
      // projectSync arrayUnion only runs inside the SAME transaction as a
      // genuinely new row) even though it was a real, distinct payment.
      // Fixed by minting a fresh Firestore auto-id per actual payment
      // ATTEMPT and keying the ref on that instead of a count, so two
      // distinct payments can never collide regardless of ordering/staleness.
      const paymentId = db.collection('ledger').doc().id;
      const projLedgerRef=`PROJ-${p.id}-${paymentId}`;
      const precomputedLedgerId = window.Ledger._sanitize(projLedgerRef);
      const payment={ type, amount, vatAmount, net, method, orRef, receiptUrl:receipt?.url||null, date:today(), by:who, ledgerId:precomputedLedgerId, paymentId, bankAccountId: acct.bankAccountId||null, bankAccountName: acct.bankAccountName||null };
      const update={ amountCollected:newCollected, arBalance:newAR, updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
        payments:firebase.firestore.FieldValue.arrayUnion(payment),
        documents:firebase.firestore.FieldValue.arrayUnion({ type:'Official Receipt', ref:orRef||('₱'+window.fmtN2(amount)), at:new Date().toISOString(), by:who }),
        timeline:firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:`Payment ₱${window.fmtN2(amount)} (${type})`, by:who }) };
      if(newAR<=0) update.stage='paid';
      const res = await window.Ledger.post({
        ref: projLedgerRef, date: today(), kind: 'credit',
        accountType: 'income', account: 'Sales Revenue', category: 'Sales Revenue',
        description: `Project ${p.projectNo} — ${p.clientName} (${type})`,
        amount, source: 'Finance', projectId: p.id,
        extra: { net, vatAmount, vatTreatment, ...window.BankAccounts.tag(acct,'in') },
        projectSync: { collection: 'job_projects', docId: p.id, fields: update }
      });
      if (res.existed) { closeModal(); Notifs.showToast('This payment was already posted.','error'); window.renderProjectLifecycle(); return; }
      window.logAudit && window.logAudit('create','payment',p.id,{ amount, type, projectNo:p.projectNo });
      if(newAR<=0){ try{ await Notifs.sendToOwner({ title:'💰 Project fully paid', body:`${p.clientName} (${p.projectNo}) — ₱${window.fmtN2(p.contractAmount||0)} collected in full.`, icon:'💰', type:'project_paid', link:'projects-lifecycle' }); }catch(_){} }
      closeModal(); Notifs.success('Payment recorded + posted to ledger'); window.renderProjectLifecycle();
    }catch(ex){ err.textContent='Failed: '+(ex.message||ex.code); err.classList.remove('hidden'); saveBtn.disabled=false; }
  });
  // Form and listener are real now — release the footer's primary action.
  // Scoped to THIS panel (not document-wide) because openPage keeps the panel it
  // stacked over alive underneath as `.page-under`, ids and all.
  const pbSaveBtn = panel.querySelector('#pb-save');
  if (pbSaveBtn) pbSaveBtn.disabled = false;
  }, { skeleton:'rows' });
}

// Finance issues a printable billing invoice against a job_projects record (the
// sales-record spine). Issuing an invoice only documents what's owed — it does NOT
// move money (that's "Record Payment"), so AR/Collected are untouched here.
async function openJobBillingInvoiceModal(p){
  const contract = Number(p.contractAmount)||0;
  const paid     = Number(p.amountCollected)||0;
  const bal      = Math.max(0, contract - paid);
  // v14 tap-latency inversion — same treatment as openProjectBillingModal above:
  // the window exists on the tap frame, the bank-account <select> arrives after.
  // Title/footer depend only on `p`, so neither is deferred — but "Generate
  // Invoice" ships `disabled` for the same reason Record Payment's Save does: its
  // listener is wired at the bottom of the renderer, so it is genuinely dead until
  // the fill lands. Cancel is the opposite case — see the note under it.
  const panel = openPage(`${emojiIcon('🧾',16)} Billing Invoice — `+escHtml(p.clientName||''), window.skeletonHtml('rows'),
    `<button class="btn-primary" id="jinv-gen" disabled>Generate Invoice</button><button class="btn-secondary" id="jinv-back">Cancel</button>`);
  const jinvBody = panel.querySelector('.page-panel-body');
  // Cancel is wired IMMEDIATELY, outside the renderer — deliberately the one
  // exception. It lives in the footer, which openPage fills synchronously, and
  // its handler reads nothing that is fetched, so binding it now means the
  // user's own escape hatch works during the skeleton frame instead of being a
  // dead button for the length of the read. (The header Back arrow works from
  // frame one regardless; this keeps the FOOTER route alive too, because it
  // does something Back doesn't — see the clearAll note below.)
  // clearAll() first — Billing Invoice is pushed ON TOP of this hub's page
  // (never nested deeper), so a bare reopen would leave a stale hidden copy
  // behind; same rule as Design's openProjectDetail reopen sites above.
  // ⚠ SCOPED TO THIS PANEL, NOT document — this footer button is the one bound
  // during the skeleton frame, which is precisely when a previous panel may
  // still be in openPage's 300ms teardown and would win a document-wide lookup.
  panel.querySelector('#jinv-back').addEventListener('click', ()=>{ window.Overlay.clearAll(); openJobProjectDetail(p); });
  // Renderer body deliberately not re-indented — see openProjectBillingModal.
  await window.withLoadingAndError(jinvBody, () => window.BankAccounts.optionsHTML(), (bankOpts) => {
  if (!panelLive(panel)) return;   // closed mid-flight — fill nothing, wire nothing
  jinvBody.innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Contract ₱${fmt(contract)} · Collected ₱${fmt(paid)} · <strong>Balance ₱${fmt(bal)}</strong></div>
    <div class="form-group"><label>Bill To</label><input id="jinv-billto" value="${escHtml(p.clientName||'')}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Invoice Kind</label>
        <select id="jinv-kind" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          <option value="standard">Standard collection</option>
          <option value="downpayment">Downpayment (with balance schedule)</option></select></div>
      <div class="form-group"><label>Deposit to (company account)</label>
        <select id="jinv-bankacct" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${bankOpts}</select></div>
    </div>
    <div id="jinv-dp-wrap" style="display:none">
      <div class="form-row">
        <div class="form-group"><label>Downpayment % of contract</label>
          <input id="jinv-dppct" type="number" min="0" max="100" step="0.5" value="${p.dpPercent||''}" inputmode="decimal" placeholder="e.g. 40"/></div>
        <div class="form-group"><label>Balance mode</label>
          <select id="jinv-balmode" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
            <option value="lump">Lump sum on completion</option>
            <option value="stagger3">3 staggered progress payments</option><option value="stagger4">4 staggered</option><option value="stagger5">5 staggered</option>
            <option value="install3">3-month installment</option><option value="install6">6-month installment</option>
            <option value="install9">9-month installment</option><option value="install12">12-month installment</option></select></div>
      </div>
      <div class="form-row">
        <div class="form-group" id="jinv-int-wrap" style="display:none"><label>Interest % p.a.</label><input id="jinv-interest" type="number" min="0" step="0.5" value="0" inputmode="decimal"/></div>
        <div class="form-group"><label>Est. completion date</label><input id="jinv-complete" type="date"/></div>
      </div>
      <div id="jinv-sched-preview" style="font-size:12px;color:var(--text-muted);margin:4px 0 8px"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Invoice Date</label><input id="jinv-date" type="date" value="${today()}"/></div>
      <div class="form-group"><label>Due Date</label><input id="jinv-due" type="date"/></div>
    </div>
    <div class="form-group"><label>Particulars</label><input id="jinv-desc" value="Collection of outstanding balance"/></div>
    <div class="form-group"><label>Amount to Collect (₱)</label><input id="jinv-amt" type="number" inputmode="decimal" step="0.01" min="0" value="${bal>0?bal.toFixed(2):'0.00'}"/></div>
    <div class="form-group"><label>Notes / Payment Instructions</label><textarea id="jinv-notes" rows="3">Kindly settle the amount due on or before the due date. Payable to Barro Industries OPC.</textarea></div>
    <div id="jinv-err" class="error-msg hidden" style="margin-top:8px"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [jinvBody] });

  // ── Kind toggle + live balance-schedule preview (v12 WS36) ──
  // ⚠ SCOPED TO THIS PANEL, NOT document — same defect as Record Payment above.
  // Cancel here reopens the job-project detail via Overlay.clearAll(), so a
  // second Billing Invoice panel can easily exist while the first is still in
  // openPage's 300ms teardown; a document-wide read would mint an invoice
  // serial against the PREVIOUS project's amount, dates and bank account.
  const $jinv = (id) => panel.querySelector('#' + id);
  const kindSel=$jinv('jinv-kind'), dpWrap=$jinv('jinv-dp-wrap');
  const balModeSel=$jinv('jinv-balmode'), intWrap=$jinv('jinv-int-wrap');
  const renderSchedPreview=()=>{
    if(kindSel.value!=='downpayment'){ $jinv('jinv-sched-preview').innerHTML=''; return; }
    const pct=parseFloat($jinv('jinv-dppct').value)||0;
    const dpAmt=parseFloat($jinv('jinv-amt').value)||0;
    const schedule=window.buildBalanceSchedule(contract, dpAmt, balModeSel.value, parseFloat($jinv('jinv-interest').value)||0,
      $jinv('jinv-date').value||today(), $jinv('jinv-complete').value||null);
    $jinv('jinv-sched-preview').innerHTML=schedule.map(s=>`${s.seq}. ${s.label} — ${s.dueDate||'TBD'} — ₱${fmt(s.amount)}`).join('<br>');
  };
  kindSel.addEventListener('change', ()=>{
    dpWrap.style.display = kindSel.value==='downpayment' ? '' : 'none';
    if(kindSel.value==='downpayment'){
      const pct=parseFloat($jinv('jinv-dppct').value)||0;
      $jinv('jinv-amt').value=(+(contract*(pct/100))).toFixed(2);
      $jinv('jinv-desc').value=`Downpayment (${pct}% of contract)`;
    }
    renderSchedPreview();
  });
  balModeSel.addEventListener('change', ()=>{ intWrap.style.display=/^install/.test(balModeSel.value)?'':'none'; renderSchedPreview(); });
  ['jinv-dppct','jinv-interest','jinv-complete','jinv-date','jinv-amt'].forEach(id=>$jinv(id).addEventListener('input', renderSchedPreview));

  $jinv('jinv-gen').addEventListener('click', async ()=>{
    const err=$jinv('jinv-err');
    const amt=parseFloat($jinv('jinv-amt').value)||0;
    if(amt<=0){ err.textContent='Enter a valid amount.'; err.classList.remove('hidden'); return; }
    const kind = kindSel.value==='downpayment' ? 'downpayment' : 'standard';
    const who=userProfile?.displayName||currentUser.email||'';
    const inv={
      date:           $jinv('jinv-date').value||today(),
      due:            $jinv('jinv-due').value||'',
      billTo:         $jinv('jinv-billto').value.trim(),
      desc:           $jinv('jinv-desc').value.trim(),
      amount:         amt,
      notes:          $jinv('jinv-notes').value.trim(),
      contractAmount: contract,
      paidToDate:     paid,
      balanceBefore:  bal,
      projectName:    p.name||p.projectNo||'',
      projectNo:      p.projectNo||'',
      issuedBy:       who,
      createdAt:      today()
    };
    let pct=null, schedule=null;
    if(kind==='downpayment'){
      pct = Math.max(0, Math.min(100, parseFloat($jinv('jinv-dppct').value)||0));
      const completeDate = $jinv('jinv-complete').value||null;
      schedule = window.buildBalanceSchedule(contract, amt, balModeSel.value, parseFloat($jinv('jinv-interest').value)||0, inv.date, completeDate);
      inv.kind = 'downpayment'; inv.dpPercent = pct; inv.schedule = schedule;
    } else {
      inv.kind = 'standard';
    }
    // v12 WS36 decision 9 — the registry SUPERSEDES the quote's free-text bankDetails;
    // snapshot the chosen account onto the invoice so a later account edit never
    // rewrites an issued invoice.
    const acct = await window.BankAccounts.pick($jinv('jinv-bankacct').value);
    if (acct.bankAccountId) {
      const full = (await window.BankAccounts.list({activeOnly:false})).find(a=>a.id===acct.bankAccountId);
      if (full) inv.bank = { nickname:full.nickname||'', type:full.type||'bank', bankName:full.bankName||'', branch:full.branch||'', accountName:full.accountName||'', accountNo:full.accountNo||'' };
    }
    const confirmMsg = `Generate ${kind==='downpayment'?'downpayment':'billing'} invoice for ₱${fmt(amt)} (${escHtml(p.clientName||'')})?`
      + (kind==='downpayment' && p.balanceSchedule ? ' This replaces the existing balance schedule.' : '');
    if(!(await confirmDialog({message:confirmMsg, html:true}))) return;
    try{
      // Numbering (decision 13) — minted AFTER the confirm so a cancelled dialog
      // burns no serial. ONE series for standard + downpayment invoices.
      inv.no = await window.nextSerial('billing_invoice','INV');
      // Atomic append so a concurrent edit can't clobber the invoice list.
      const ref=db.collection('job_projects').doc(p.id);
      const saved=await db.runTransaction(async tx=>{
        const doc=await tx.get(ref);
        const cur=(doc.exists && Array.isArray(doc.data().invoices))?doc.data().invoices:[];
        const next=[...cur, inv];
        const upd={
          invoices:next,
          documents:firebase.firestore.FieldValue.arrayUnion({ type:'Billing Invoice', ref:inv.no, at:new Date().toISOString(), by:who }),
          timeline:firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:`Billing invoice ${inv.no} issued (₱${window.fmtN2(amt)})`, by:who }),
          updatedAt:firebase.firestore.FieldValue.serverTimestamp()
        };
        if(kind==='downpayment'){ upd.dpPercent=pct; upd.balanceSchedule=schedule; }
        tx.update(ref, upd);
        return next;
      });
      p.invoices=saved;
      if(kind==='downpayment'){ p.dpPercent=pct; p.balanceSchedule=schedule; }
      window.logAudit && window.logAudit('create','invoice',p.id,{ no:inv.no, amount:amt, projectNo:p.projectNo, kind });
      closeModal();
      Notifs.showToast('Billing invoice generated','success');
      window.openBillingInvoice(p, inv);
    }catch(ex){ err.textContent='Failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
  });
  // Form and listener are real now — release Generate Invoice (panel-scoped; see
  // the same note at openProjectBillingModal).
  const jinvGenBtn = panel.querySelector('#jinv-gen');
  if (jinvGenBtn) jinvGenBtn.disabled = false;
  }, { skeleton:'rows' });
}

window.renderProductionDept = async function(currentUser, currentRole, subtab = 'Orders') {
  const c = deptContainer();
  const subs = ['Orders','Job Orders','Materials','Inventory','Count Form','Budgeting','Tasks','Files'];
  c.innerHTML = `
    <div class="page-header">
      <div>
        <h2>${emojiIcon('🏭',20)} Production</h2>
        <p style="font-size:12px;color:var(--text-muted);margin:2px 0 0">Shop-floor work orders, materials & output</p>
      </div>
    </div>
    ${window.sopPanel('How Production works', [
      'Orders is the shop-floor pipeline: '+PROD_STAGES.map(s=>s.label).join(' → ')+'.',
      `Job Orders prints the sheet the floor works from — scope, deadlines and stage schedule, ${emojiIcon('🚫',16)} never prices. Tap the stars there to set a job's priority.`,
      `${emojiIcon('✏️',16)} Edit on a Job Order is the sheet itself — header, dates, site, scope and the four checklists. ${emojiIcon('✅',16)} Progress ticks the nine shop-floor stages per item, and those ticks print on the next copy. Neither re-prices the quotation; the sheet warns when the scope no longer matches it.`,
      `Quality Checking requires a passed ${emojiIcon('🔍',16)} QC checklist before an order can go Out for Delivery.`,
      `Marking Delivered requires a ${emojiIcon('🧾',16)} Delivery Receipt (received-by + date) — printable on letterhead.`,
      'Materials and Inventory track raw stock; "Consume → stock & COS" deducts inventory and posts material cost.',
      `${emojiIcon('👷',16)} Labor on an order logs the hours worked on its current stage — costed at the shop rate (settings, President-set) and posted to COS – Direct Labor. No rate on file means hours are still recorded, with no cost invented.`,
      'Count Form records physical counts; Tasks and Files hold the department board and documents.'
    ])}
    ${window.chipTabs(subs.map(s=>({key:s,label:s})), subtab)}
    <div id="prod-content">${window.skeletonHtml('rows')}</div>`;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  loadProdContent(currentUser, currentRole, subtab);
  window.bindChipTabs(c, (key) => loadProdContent(currentUser, currentRole, key));
};

async function loadProdContent(currentUser, currentRole, sub) {
  const el = document.getElementById('prod-content');
  try {
    if (sub==='Job Orders') return await renderProdJobOrders(el, currentUser, currentRole);
    if (sub==='Materials') return await renderProdMaterials(el, currentRole);
    if (sub==='Inventory') return await window.renderInventory(el, 'Stock');
    if (sub==='Count Form') return await renderProdInventoryForm(el, currentRole);
    if (sub==='Budgeting') return await window.renderBudgeting(el, currentUser, currentRole, 'Production');
    if (sub==='Tasks')     return await renderDeptTasks(el, 'Production', currentUser, currentRole);
    if (sub==='Files')   { el.innerHTML = renderFileCollection('Production Files', 'production-files', currentRole);
                           bindFileCollection('production-files', currentUser, 'Production', 'Files'); return; }
    return await renderProdOrders(el, currentUser, currentRole);
  } catch (e) {
    console.error('Production load error', e);
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load</h4><p>${escHtml(e.message||String(e))}</p><button type="button" class="btn-secondary btn-sm prod-retry-btn" style="margin-top:14px">Retry</button></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [el] });
    el.querySelector('.prod-retry-btn')?.addEventListener('click', ()=>loadProdContent(currentUser, currentRole, sub));
  }
}

async function renderProdOrders(el, currentUser, currentRole) {
  // DEAD CONTROLS (fixed 2026-08-09). firestore.rules production_orders:
  //   create = canProduction()
  //   update = canProduction() && !isSecretary()
  // canEditDept('Production') is true for the Corporate Secretary (Production
  // is a department they keep), so every mutation control on this screen —
  // Advance, QC, Edit, Delivery Receipt, Consume materials — was rendered to
  // them and then refused by the boundary, surfacing only as "Update failed".
  // The rules exclusion is deliberate: consumeProductionMaterials commits
  // inventory decrements + stock_movements + materialsConsumed in ONE
  // transaction and posts the ledger legs separately, and the guard exists to
  // stop that half-write being started by someone who cannot finish it. So the
  // fix is to hide the controls, NOT to widen the rule.
  // CREATE is still permitted by the rules, but a work order that can never be
  // advanced, QC'd or delivered is worse than no button — it strands a job on
  // the shop floor — so it is hidden with the rest, and flagged for the owner
  // to confirm whether the Corporate Secretary should keep Production at all.
  const canEdit = canEditDept('Production') && (window.currentRole !== 'secretary');
  const showMoney = !isProductionOnlyViewer();   // Sales→Production handoff — no contract ₱ for Production-only viewers
  el.innerHTML = window.skeletonHtml('table');
  // production_orders is this screen's PRIMARY data — a failure here now
  // propagates to loadProdContent's error-with-retry instead of silently
  // rendering as "no production orders". job_projects (used only for the
  // secondary "Incoming jobs" banner below) stays a soft-fail.
  const [snap, projSnap] = await Promise.all([
    dbCachedGet('production_orders', ()=>db.collection('production_orders').orderBy('createdAt','desc').get(), 45000),
    dbCachedGet('job_projects', ()=>db.collection('job_projects').orderBy('createdAt','desc').get(), 45000).catch(()=>({docs:[]}))
  ]);
  const orders = snap.docs.map(d=>({id:d.id,...d.data()}));
  // Incoming jobs = won / in-production projects that don't yet have a work order.
  // These are sales already handed to Production (via the Sales Order flow) but
  // never turned into a shop-floor order — they previously lived ONLY in the
  // Projects lifecycle, so the Production team never saw them here and reported
  // "not receiving orders". Surface them so they can start a work order in one tap.
  // 'in_design' is deliberately excluded — a job in Design cannot get a production order; 'won' is kept only for legacy pre-design-flow projects.
  const incoming = projSnap.docs.map(d=>({id:d.id,...d.data()}))
    .filter(p=>['won','in_production'].includes(p.stage) && !(Array.isArray(p.productionOrderIds) && p.productionOrderIds.length));
  const active = orders.filter(o=>normProdStageId(o.stage)!=='delivered');
  const todayStr = today();
  const weekAhead = (()=>{ const d=new Date(); d.setDate(d.getDate()+7); return (window.bizDate?window.bizDate(d):d.toISOString().slice(0,10)); })();
  const overdue = active.filter(o=>o.dueDate && o.dueDate < todayStr);
  const dueSoon = active.filter(o=>o.dueDate && o.dueDate >= todayStr && o.dueDate <= weekAhead);

  // Group active orders by stage (in pipeline order), delivered shown collapsed at end
  const byStage = {};
  active.forEach(o=>{ (byStage[normProdStageId(o.stage)] ||= []).push(o); });
  const delivered = orders.filter(o=>normProdStageId(o.stage)==='delivered');

  const orderCard = (o)=>{
    const od = o.dueDate && o.dueDate < todayStr && normProdStageId(o.stage)!=='delivered';
    const pr = (o.priority||'medium');
    return `<div class="item-card prod-order" data-id="${o.id}" style="cursor:pointer;border-left:3px solid ${prodStage(o.stage).color}">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px">${escHtml(o.title||'Untitled')} ${o.qty?`<span style="color:var(--text-muted);font-weight:500">×${escHtml(String(o.qty))}</span>`:''}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
            ${o.orderNo?`<span style="font-family:monospace">${escHtml(o.orderNo)}</span> · `:''}${escHtml(o.client||'—')}${o.quoteRef?` · ${escHtml(o.quoteRef)}`:''}
          </div>
          <div style="font-size:11px;margin-top:3px;display:flex;gap:8px;flex-wrap:wrap">
            ${o.dueDate?`<span style="color:${od?'var(--danger)':'var(--text-muted)'}">${emojiIcon('📅',16)} ${escHtml(o.dueDate)}${od?` ${emojiIcon('⚠️',16)}`:''}</span>`:''}
            ${(()=>{ const w=(o.assignments?.[normProdStageId(o.stage)]?.workerNames)||[];
              return w.length?`<span style="color:var(--text-muted)">${emojiIcon('👷',16)} ${escHtml(w.join(', '))}</span>`
                : (o.team?`<span style="color:var(--text-muted)">${emojiIcon('👷',16)} ${escHtml(o.team)}</span>`:''); })()}
            ${orderLaborHours(o)?`<span style="color:var(--text-muted)" title="Labor logged on this order">${emojiIcon('👷',16)} ${orderLaborHours(o)} hrs</span>`:''}
            ${o.qc?`<span class="badge ${o.qc.result==='passed'?'badge-green':'badge-red'}" style="font-size:9px">${o.qc.result==='passed'?`${emojiIcon('✅',16)} QC`:`${emojiIcon('❌',16)} QC`}</span>`:''}
            ${o.deliveryReceipt?`<span class="badge badge-blue" style="font-size:9px">${emojiIcon('🧾',9)} ${escHtml(o.deliveryReceipt.no||'DR')}</span>`:''}
            ${window.priorityStarPicker({value:pr, coll:'production_orders', id:o.id, vocab:'prod', editable:canEdit, mirrorProject:o.projectId||'', showLabel:false})}
          </div>
        </div>
        ${canEdit?`<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
          ${normProdStageId(o.stage)!=='delivered'?`<button class="btn-success btn-sm prod-advance" data-id="${o.id}">Advance →</button>`:''}
          ${normProdStageId(o.stage)==='qc'?`<button class="btn-secondary btn-sm prod-qc" data-id="${o.id}">${emojiIcon('🔍',16)} QC</button>`:''}
          <button class="btn-secondary btn-sm prod-labor" data-id="${o.id}" title="Log the hours worked on this stage">${emojiIcon('👷',16)} Labor</button>
          <button class="btn-secondary btn-sm prod-edit" data-id="${o.id}">Edit</button>
        </div>`:''}
      </div>
    </div>`;
  };

  el.innerHTML = `
    <div class="kpi-row" style="margin-bottom:12px">
      <div class="kpi-card" style="${incoming.length?'border-color:var(--warning)':''}"><div class="kpi-label">Incoming</div><div class="kpi-value" style="${incoming.length?'color:var(--warning)':''}">${incoming.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Active Orders</div><div class="kpi-value">${active.length}</div></div>
      <div class="kpi-card ${dueSoon.length?'':''}" style="${dueSoon.length?'border-color:var(--warning)':''}"><div class="kpi-label">Due ≤7 days</div><div class="kpi-value" style="${dueSoon.length?'color:var(--warning)':''}">${dueSoon.length}</div></div>
      <div class="kpi-card ${overdue.length?'red':''}"><div class="kpi-label">Overdue</div><div class="kpi-value">${overdue.length}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Delivered</div><div class="kpi-value">${delivered.length}</div></div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span style="font-size:12px;color:var(--text-muted);flex:1;min-width:180px">Pipeline: ${PROD_STAGES.map(s=>s.label).join(' → ')}</span>
      <button class="btn-secondary btn-sm" id="prod-csv" style="flex-shrink:0;white-space:nowrap">${emojiIcon('⬇',16)} CSV</button>
      ${canEdit?'<button class="btn-primary btn-sm" id="prod-add-btn" style="flex-shrink:0;white-space:nowrap">＋ New Order</button>':''}
    </div>
    ${incoming.length?`
      <div class="card" style="margin-bottom:12px;border:1.5px solid var(--warning)">
        <div class="card-header" style="display:flex;align-items:center;justify-content:space-between">
          <h3 style="font-size:13px">${emojiIcon('📥',13)} Incoming jobs — needs a work order</h3>
          <span class="badge badge-orange">${incoming.length}</span>
        </div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:8px">
          ${incoming.map(p=>`<div class="item-card" style="border-left:3px solid var(--warning)">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
              <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:13px">${escHtml(p.clientName||p.name||'Project')}</div>
                <div style="font-size:11px;color:var(--text-muted);margin-top:2px"><span style="font-family:monospace">${escHtml(p.projectNo||'')}</span>${p.quoteNumber?` · ${escHtml(p.quoteNumber)}`:''} · <span class="badge ${p.stage==='in_production'?'badge-blue':'badge-green'}" style="font-size:9px">${escHtml(jobStage(p.stage).label)}</span></div>
                ${showMoney
                  ? `<div style="font-size:11px;margin-top:3px;color:var(--text-muted)">Contract ₱${fmt(p.contractAmount||0)}</div>`
                  : p.targetDate ? `<div style="font-size:11px;margin-top:3px;color:var(--text-muted)">${emojiIcon('📅',16)} Target ${escHtml(p.targetDate)}</div>` : ''}
                <div style="margin-top:4px">${window.priorityStarPicker({value:p.priority, coll:'job_projects', id:p.id, editable:canEdit, showLabel:false})}</div>
              </div>
              ${canEdit?`<button class="btn-primary btn-sm prod-start" data-id="${p.id}" style="flex-shrink:0;white-space:nowrap">＋ Start work order</button>`:''}
            </div>
          </div>`).join('')}
        </div>
      </div>`:''}
    ${!active.length && !delivered.length && !incoming.length ? window.renderEmptyState({icon:'🏭',title:'No production orders yet',hint:'Create a work order to track a job through the shop floor.'}) : ''}
    ${PROD_STAGES.filter(s=>s.id!=='delivered' && (byStage[s.id]||[]).length).map(s=>`
      <div class="card" style="margin-bottom:12px">
        <div class="card-header" style="display:flex;align-items:center;justify-content:space-between">
          <h3 style="font-size:13px">${s.icon} ${s.label}</h3>
          <span class="badge" style="background:${s.color};color:var(--on-primary)">${(byStage[s.id]||[]).length}</span>
        </div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:8px">
          ${(byStage[s.id]||[]).map(orderCard).join('')}
        </div>
      </div>`).join('')}
    ${delivered.length?`
      <details style="margin-top:6px">
        <summary style="cursor:pointer;font-size:13px;font-weight:700;color:var(--text-muted);padding:6px 0">${emojiIcon('🚚',13)} Delivered (${delivered.length})</summary>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">${delivered.slice(0,30).map(orderCard).join('')}</div>
      </details>`:''}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [el] });

  el.querySelectorAll('.prod-labor').forEach(b=>b.addEventListener('click', (ev)=>{
    ev.stopPropagation();
    const o = orders.find(x=>x.id===b.dataset.id);
    if (o) openLaborLogModal(o, ()=>renderProdOrders(el, currentUser, currentRole));
  }));
  window.bindPriorityStars(el);

  document.getElementById('prod-csv')?.addEventListener('click', ()=>window.exportCSV('production-orders', orders, [
    {key:'orderNo',label:'Order #'},{key:'title',label:'Product'},{key:'client',label:'Client'},{key:'qty',label:'Qty'},
    {key:'stage',label:'Stage',get:o=>prodStage(o.stage).label},{key:'priority',label:'Priority'},
    {key:'laborHours',label:'Labor hrs',get:o=>orderLaborHours(o)},{key:'laborCost',label:'Labor ₱',get:o=>orderLaborTotal(o)},
    {key:'team',label:'Workers',get:o=>{const a=o.assignments?.[normProdStageId(o.stage)];return (a?.workerNames?.length)?a.workerNames.join('; '):(o.team||'');}},
    {key:'qc',label:'QC',get:o=>o.qc?o.qc.result:''},{key:'dr',label:'DR #',get:o=>o.deliveryReceipt?.no||''},
    {key:'dueDate',label:'Due'},{key:'quoteRef',label:'Quote Ref'}]));
  if (canEdit) {
    document.getElementById('prod-add-btn')?.addEventListener('click', ()=>prodOrderModal(null, currentUser, currentRole, ()=>renderProdOrders(el, currentUser, currentRole)));
    el.querySelectorAll('.prod-start').forEach(b=>b.addEventListener('click', (e)=>{
      e.stopPropagation();
      prodOrderModal(null, currentUser, currentRole, ()=>renderProdOrders(el, currentUser, currentRole), b.dataset.id);
    }));
    el.querySelectorAll('.prod-edit').forEach(b=>b.addEventListener('click', (e)=>{
      e.stopPropagation();
      prodOrderModal(orders.find(o=>o.id===b.dataset.id), currentUser, currentRole, ()=>renderProdOrders(el, currentUser, currentRole));
    }));
    el.querySelectorAll('.prod-qc').forEach(b=>b.addEventListener('click',(e)=>{ e.stopPropagation();
      const o=orders.find(x=>x.id===b.dataset.id); if(o) openQCModal(o, ()=>renderProdOrders(el, currentUser, currentRole)); }));
    el.querySelectorAll('.prod-advance').forEach(b=>b.addEventListener('click', async (e)=>{
      e.stopPropagation();
      const o = orders.find(x=>x.id===b.dataset.id); if(!o) return;
      const curId = normProdStageId(o.stage);
      const idx = PROD_STAGES.findIndex(s=>s.id===curId);
      const next = PROD_STAGES[Math.min(idx+1, PROD_STAGES.length-1)];
      // ── QC gate: may not ENTER Out for Delivery without a PASSED inspection ──
      if (next.id==='out_for_delivery' && (o.qc?.result)!=='passed') {
        openQCModal(o, ()=>renderProdOrders(el, currentUser, currentRole));
        return;
      }
      // ── DR gate: may not ENTER Delivered without a delivery receipt ──
      if (next.id==='delivered' && !o.deliveryReceipt) {
        openDeliveryReceiptModal(o, ()=>renderProdOrders(el, currentUser, currentRole));
        return;
      }
      b.disabled = true;
      try {
        await db.collection('production_orders').doc(o.id).update({
          stage: next.id, stageUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          // per-stage timestamp trail — ISO string (serverTimestamp is illegal in arrayUnion)
          stageHistory: firebase.firestore.FieldValue.arrayUnion({
            stage: next.id, enteredAt: new Date().toISOString(),
            by: currentUser.uid, byName: userProfile?.displayName||currentUser.email||'' }) });
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('production_orders');
        await syncJobFromProdStage(o.projectId, next.id);
        Notifs.success(`Moved to ${next.label}`);
        renderProdOrders(el, currentUser, currentRole);
      } catch(ex){ Notifs.showToast('Update failed','error'); b.disabled=false; }
    }));
  }
  el.querySelectorAll('.prod-order').forEach(card=>card.addEventListener('click', ()=>{
    if(!canEdit) return;
    prodOrderModal(orders.find(o=>o.id===card.dataset.id), currentUser, currentRole, ()=>renderProdOrders(el, currentUser, currentRole));
  }));
}

// Keep the parent job_projects doc's lifecycle stage in sync with production
// progress — FORWARD only (never regress delivered/paid work) — and reflect the
// milestone on the client's public tracker. Shared by the card "Advance →"
// button AND the Edit-modal Save (the stage <select> path used to skip this
// entirely, so a job whose order was marked Delivered via Edit→Save looked
// stuck in production forever).
async function syncJobFromProdStage(projectId, prodStageId) {
  if (!projectId) return;
  const stageDef = PROD_STAGES.find(s => s.id === prodStageId);
  const projStage = prodToJobStage(prodStageId);
  try {
    const jdoc = await db.collection('job_projects').doc(projectId).get();
    const cur = jdoc.exists ? jdoc.data().stage : null;
    const ord = s => JOB_STAGES.findIndex(x => x.id === s);
    const evt = { at:new Date().toISOString(), event:`Production: ${stageDef?.label||prodStageId}`, by:userProfile?.displayName||currentUser.email };
    const advance = cur !== 'paid' && cur !== 'cancelled' && ord(projStage) > ord(cur);
    await db.collection('job_projects').doc(projectId).update({
      ...(advance ? { stage: projStage } : {}),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      timeline: firebase.firestore.FieldValue.arrayUnion(evt) });
    // reflect the milestone on the client's public tracker (forward only)
    const _tok = jdoc.exists ? jdoc.data().trackingToken : null;
    if(_tok){ const _trk = trackerKeyFor(prodStageId) || (advance ? 'production' : null);
      if(_trk) window.syncOrderTracking(_tok, { status:_trk }); }
  } catch(_) {}
}

// Consume a production order's materials: decrement inventory stock, post COS to
// the ledger (idempotent, keyed POCOS-<id>), add the cost to the linked job's
// capital (for margin), and flag the order. Stock + flag commit atomically.
async function consumeProductionMaterials(order) {
  const rawMats = (order.materials || []).filter(m => m.itemId && (Number(m.qty) || 0) > 0);
  // Dedupe by itemId (summing qty) — a duplicated picker row must not
  // double-decrement or collide on the deterministic movement doc id.
  const byItem = {};
  rawMats.forEach(m => { (byItem[m.itemId] ||= { ...m, qty: 0 }).qty += Number(m.qty) || 0; });
  const mats = Object.values(byItem);
  if (!mats.length) return { ok: false, reason: 'No materials listed.' };
  if (order.materialsConsumed) return { ok: false, reason: 'Already consumed.' }; // fast pre-check — the transaction below re-checks authoritatively
  // H11 fix — the stock decrement + materialsConsumed flag now commit inside ONE
  // transaction (same idempotent-transaction shape as receiveLineIntoItem uses
  // elsewhere in this file for stock receiving): a fresh re-read of
  // production_orders catches a concurrent consume the
  // caller's possibly-stale `order.materialsConsumed` flag can't, closing the
  // double-decrement race a batch (built from a pre-transaction read) couldn't.
  // Firestore transactions can't hold a batch, so this is read-then-write on `tx`
  // instead — all reads (production_orders + every inventory_items doc) happen
  // before any write, matching Ledger.postMulti's shape (finance-ledger.js).
  const poRef = db.collection('production_orders').doc(order.id);
  const cos = await db.runTransaction(async (tx) => {
    const poSnap = await tx.get(poRef);
    if (!poSnap.exists || poSnap.data().materialsConsumed) return null; // already consumed (or gone) — idempotent no-op

    const reads = [];
    for (const m of mats) {
      const ref = db.collection('inventory_items').doc(m.itemId);
      reads.push({ m, ref, snap: await tx.get(ref) });
    }

    let txCos = 0;
    reads.forEach(({ m, ref, snap: s }) => {
      const unitCost = (s && s.exists) ? (Number(s.data().unitCost) || 0) : (Number(m.unitCost) || 0);
      const q = Number(m.qty) || 0;
      txCos += unitCost * q;
      if (s && s.exists) {
        tx.update(ref, { qty: firebase.firestore.FieldValue.increment(-q) });
        // Movement row joins the SAME transaction — stock change and its log
        // entry can never desync (v12 WS29). Deterministic id + the
        // materialsConsumed flag (also in this transaction) make re-runs impossible.
        tx.set(db.collection('stock_movements').doc(`CONS_${order.id}_${m.itemId}`),
          window.buildStockMovement({
            itemId: m.itemId, itemName: (s.data().name) || m.name || '',
            type: 'out', qty: q, source: 'consume',
            refNumber: `POCOS-${order.id}`,
            project: order.client || order.title || '',
            note: `Production ${order.orderNo || order.id}`,
            unitCost, qtyAfter: (Number(s.data().qty) || 0) - q
          }));
      }
    });

    tx.update(poRef, {
      materialsConsumed: true,
      materialsConsumedAt: firebase.firestore.FieldValue.serverTimestamp(),
      materialsCost: txCos
    });
    return txCos;
  }); // stock + flag atomic — can't double-decrement
  if (cos == null) return { ok: false, reason: 'Already consumed.' };
  // Post COS to the ledger, idempotent by ref. Best-effort: the ledger is
  // finance-write-gated, so a plain Production employee can't post it — stock is
  // still deducted and materialsCost is recorded on the order for finance to see.
  // Also posts the Inventory contra leg (v12 WS13) — the asset decrease that
  // nets against the asset booked at purchase time, fixing the double-counted
  // material expense (purchase debit + consumption debit, no netting).
  const ref = `POCOS-${order.id}`;
  const refInv = `POCOS-${order.id}-INV`;
  let cosPosted = false;
  if (cos > 0) {
    try {
      // v13 Phase 13 (C6) — both legs (expense debit + Inventory contra credit)
      // AND the job_projects.capital roll-up now commit in ONE transaction via
      // postMulti + projectSync. This also closes the period-lock gap: postMulti
      // calls assertPeriodOpen unconditionally, where the old two-separate-add
      // code never checked it at all. Rules' Production-COS-shape special case
      // (firestore.rules ~1050-1069) still matches this write shape unchanged —
      // same fields, same refNumber prefixes, just single-transaction now.
      const entries = [
        { ref, date: today(), kind: 'debit', accountType: 'expense', account: 'COS – Direct Material', category: 'COS – Direct Material',
          description: `COS — ${order.title || order.orderNo || ''}${order.client ? ` (${order.client})` : ''}`,
          amount: cos, source: 'Production', projectId: order.projectId || null },
        { ref: refInv, date: today(), kind: 'credit', accountType: 'asset', account: 'Inventory', category: 'Inventory – Materials',
          description: `Inventory consumed — ${order.orderNo || order.id}`,
          amount: cos, source: 'Production', projectId: order.projectId || null }
      ];
      const opts = (order.projectId)
        ? { projectSync: { collection: 'job_projects', docId: order.projectId, fields: { capital: firebase.firestore.FieldValue.increment(cos) } } }
        : {};
      await window.Ledger.postMulti(entries, opts);
      cosPosted = true;
    } catch (ledErr) { console.warn('[production COS] ledger post skipped (needs finance rights):', ledErr?.message || ledErr); }
  }
  // Job spend, rolled up OUTSIDE the ledger try above. `capital` only moves when
  // the ledger post succeeds, and that post is refused for a Production-only
  // user (no finance rights) — which is precisely the person who consumes
  // materials. Their job would show ₱0 spent forever. job_projects allows a
  // non-partner this write because `spentMaterials` is not one of the money
  // keys the rule guards, and consumption is already one-shot (materialsConsumed),
  // so the increment cannot run twice.
  if (order.projectId && cos > 0) {
    try {
      await db.collection('job_projects').doc(order.projectId).update({
        spentMaterials: firebase.firestore.FieldValue.increment(cos),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch(_) {}
  }
  if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('ledger'); dbCacheInvalidate('inventory_items'); dbCacheInvalidate('projects-unified'); dbCacheInvalidate('job_projects'); }
  return { ok: true, cos, count: mats.length, cosPosted };
}


// ═══════════════════════════════════════════════════
//  LABOR COSTING — hours on the floor → COS – Direct Labor
//  Closes the half of job costing that was manual: materials already posted
//  COS – Direct Material on consumption, but assignments were only ever stored
//  as NAMES, so the labor side of `capital` was a number somebody typed into
//  Edit Profit Factors from memory.
//
//  WHY A SHOP RATE AND NOT EACH WORKER'S PAY. The payroll collection is
//  isMoneyAdmin() in firestore.rules — a Production-dept user cannot read it,
//  and fetchUsersWithPayroll's catch turns that denial into an EMPTY map, so
//  costing off individual salaries would silently produce ₱0 for exactly the
//  people who do the logging. A shop rate in settings/laborRates is readable by
//  all non-partner staff, president-writable, and exposes nobody's salary.
//
//  NEVER INVENTED. With no rate on file, hours are still recorded (they are the
//  shop-floor fact and are worth having) but the cost is left blank and the
//  screen says the rate is unset — the same rule the payroll work follows about
//  rates nobody has confirmed.
// ═══════════════════════════════════════════════════
window.getLaborRates = async function(){
  return await dbCachedGet('labor-rates', async () => {
    const d = await db.collection('settings').doc('laborRates').get();
    return d.exists ? (d.data() || {}) : {};
  }, 120000).catch(() => ({}));
};
// Per-stage override, else the shop default, else null = "not set".
function laborRateFor(stageId, rates){
  const r = rates || {};
  const byStage = r.byStage || {};
  const v = Number(byStage[stageId]);
  if (v > 0) return v;
  const d = Number(r.defaultHourly);
  return d > 0 ? d : null;
}
function orderLaborTotal(o){
  return (o.laborLogs || []).reduce((s, l) => s + (Number(l.cost) || 0), 0);
}
function orderLaborHours(o){
  return (o.laborLogs || []).reduce((s, l) => s + (Number(l.hours) || 0), 0);
}

// Log hours for the workers assigned to one stage. Appends to the order's
// laborLogs, rolls the money onto the job project's spend, and posts
// COS – Direct Labor. The ledger leg is BEST-EFFORT and idempotent by ref, the
// same shape consumeProductionMaterials uses: a Production-only user has no
// finance rights, and losing their hours because the ledger refused the debit
// would be the worse failure.
async function openLaborLogModal(order, onSaved){
  const canEdit = canEditDept('Production') && (window.currentRole !== 'secretary');
  const stageId = normProdStageId(order.stage);
  const st = prodStage(stageId);
  const panel = openPage(`${emojiIcon('👷',16)} Log Labor — ${escHtml(order.orderNo || order.title || '')}`, window.skeletonHtml('rows'),
    `<button class="btn-primary" id="lab-save" disabled>Save hours</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  const body = panel.querySelector('.page-panel-body');
  const rates = await window.getLaborRates();
  if (!panelLive(panel)) return;
  const rate = laborRateFor(stageId, rates);
  const isPres = (typeof isRealPresident === 'function' && isRealPresident());
  const assigned = ((order.assignments || {})[stageId] || {}).workerNames || (order.team ? [order.team] : []);
  const prior = (order.laborLogs || []).filter(l => l.stage === stageId);

  body.innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
      Hours worked on <b>${st.icon} ${escHtml(st.label)}</b> for this order. Costed at the shop rate and posted to
      <b>COS – Direct Labor</b>, then added to the job's spend.
    </div>
    ${rate
      ? `<div class="alert-banner" style="margin-bottom:10px"><span>${emojiIcon('💵',16)} Shop rate <b>₱${fmt(rate)}/hour</b>${(rates.byStage||{})[stageId]?' (set for this stage)':''}.</span></div>`
      : `<div class="alert-banner alert-warn" style="margin-bottom:10px"><span>${emojiIcon('⚠️',16)} No shop labor rate is set, so hours will be recorded without a cost and nothing is posted to the ledger.${isPres?' Set one below.':' Ask the President to set one.'}</span></div>`}
    ${isPres ? `<div class="card" style="margin-bottom:10px"><div class="card-body">
      <div style="font-size:11px;font-weight:800;letter-spacing:.5px;color:var(--text-muted);margin-bottom:8px">SHOP LABOR RATE (PRESIDENT ONLY)</div>
      <div class="form-row">
        <div class="form-group"><label>Default ₱ per hour</label><input id="lab-rate-def" type="number" min="0" step="0.01" inputmode="decimal" value="${escHtml(String(rates.defaultHourly||''))}" placeholder="e.g. 95"/></div>
        <div class="form-group"><label>${escHtml(st.label)} ₱ per hour (optional)</label><input id="lab-rate-stage" type="number" min="0" step="0.01" inputmode="decimal" value="${escHtml(String((rates.byStage||{})[stageId]||''))}" placeholder="uses the default"/></div>
      </div>
      <button type="button" class="btn-secondary btn-sm" id="lab-rate-save">Save rate</button>
    </div></div>` : ''}
    <div class="card" style="margin-bottom:10px"><div class="card-body">
      <div style="font-size:11px;font-weight:800;letter-spacing:.5px;color:var(--text-muted);margin-bottom:8px">HOURS</div>
      <div id="lab-rows">${
        (assigned.length ? assigned : ['']).map((n, i) => `
        <div class="form-row lab-row" data-i="${i}">
          <div class="form-group"><label>Worker</label><input class="lab-name" value="${escHtml(n)}" placeholder="Name"/></div>
          <div class="form-group" style="flex:0 0 110px"><label>Hours</label><input class="lab-hours" type="number" min="0" step="0.5" inputmode="decimal" placeholder="0"/></div>
          <div class="form-group" style="flex:0 0 120px"><label>Cost</label><input class="lab-cost" value="—" disabled/></div>
        </div>`).join('')}</div>
      <button type="button" class="btn-secondary btn-sm" id="lab-add">＋ Worker</button>
      <div style="margin-top:10px;font-size:13px;font-weight:700">Total: <span id="lab-total">0 hrs${rate?' · ₱0':''}</span></div>
    </div></div>
    <div class="form-group"><label>Note (optional)</label><input id="lab-note" placeholder="Overtime, rework, subcontracted…"/></div>
    ${prior.length ? `<div class="card" style="margin-top:10px"><div class="card-body">
      <div style="font-size:11px;font-weight:800;letter-spacing:.5px;color:var(--text-muted);margin-bottom:6px">ALREADY LOGGED ON THIS STAGE</div>
      ${prior.map(l => `<div style="font-size:12px;padding:3px 0;border-bottom:1px solid var(--border)">${escHtml(l.workerName||'—')} · ${Number(l.hours)||0} hrs${l.cost?` · ₱${fmt(l.cost)}`:''} <span style="color:var(--text-muted)">${escHtml(String(l.at||'').slice(0,10))}</span></div>`).join('')}
    </div></div>` : ''}
    <div id="lab-err" class="error-msg hidden" style="margin-top:8px"></div>`;
  if (window.lucide) lucide.createIcons({ nodes: [body] });
  const $ = s => panel.querySelector(s), $$ = s => Array.from(panel.querySelectorAll(s));

  const recompute = () => {
    let hrs = 0, cost = 0;
    $$('.lab-row').forEach(r => {
      const h = Number(r.querySelector('.lab-hours').value) || 0;
      hrs += h;
      const c = rate ? h * rate : null;
      if (c != null) cost += c;
      r.querySelector('.lab-cost').value = c == null ? '—' : '₱' + fmt(c);
    });
    $('#lab-total').textContent = `${hrs} hrs` + (rate ? ` · ₱${fmt(cost)}` : '');
  };
  const bindRows = () => $$('.lab-hours').forEach(i => { i.oninput = recompute; });
  bindRows();
  $('#lab-add').addEventListener('click', () => {
    const d = document.createElement('div');
    d.className = 'form-row lab-row';
    d.innerHTML = `<div class="form-group"><label>Worker</label><input class="lab-name" placeholder="Name"/></div>
      <div class="form-group" style="flex:0 0 110px"><label>Hours</label><input class="lab-hours" type="number" min="0" step="0.5" inputmode="decimal" placeholder="0"/></div>
      <div class="form-group" style="flex:0 0 120px"><label>Cost</label><input class="lab-cost" value="—" disabled/></div>`;
    $('#lab-rows').appendChild(d); bindRows(); recompute();
  });
  $('#lab-rate-save')?.addEventListener('click', async (ev) => {
    const def = Number($('#lab-rate-def').value) || 0;
    const stg = Number($('#lab-rate-stage').value) || 0;
    const btn = ev.currentTarget; btn.disabled = true;
    try {
      const patch = { defaultHourly: def, updatedAt: new Date().toISOString(),
        updatedBy: userProfile?.displayName || currentUser.email || '' };
      patch['byStage.' + stageId] = stg > 0 ? stg : firebase.firestore.FieldValue.delete();
      await db.collection('settings').doc('laborRates').set({ defaultHourly: def }, { merge: true });
      await db.collection('settings').doc('laborRates').update(patch);
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('labor-rates');
      Notifs.success('Shop labor rate saved — reopen this window to cost at the new rate.');
    } catch (ex) { Notifs.showToast('Could not save the rate: ' + (ex.message || ex.code), 'error'); }
    btn.disabled = false;
  });

  const saveBtn = $('#lab-save');
  saveBtn.disabled = !canEdit;
  saveBtn.addEventListener('click', async () => {
    const err = $('#lab-err');
    const who = userProfile?.displayName || currentUser.email || '';
    const note = $('#lab-note').value.trim();
    const rows = $$('.lab-row').map(r => ({
      workerName: r.querySelector('.lab-name').value.trim(),
      hours: Number(r.querySelector('.lab-hours').value) || 0,
    })).filter(r => r.hours > 0);
    if (!rows.length) { err.textContent = 'Enter hours for at least one worker.'; err.classList.remove('hidden'); return; }
    saveBtn.disabled = true;
    const at = new Date().toISOString();
    // Sequence number makes the ledger ref deterministic AND unique per batch,
    // so a re-log of the same stage tomorrow posts its own debit instead of
    // being swallowed by Ledger.post's dedupe as "already posted".
    const seq = (order.laborLogs || []).length + 1;
    const logs = rows.map(r => ({ ...r, stage: stageId, rate: rate || 0,
      cost: rate ? r.hours * rate : 0, at, by: currentUser.uid, byName: who, note, batch: seq }));
    const batchCost = logs.reduce((s, l) => s + l.cost, 0);
    const batchHours = logs.reduce((s, l) => s + l.hours, 0);
    try {
      await db.collection('production_orders').doc(order.id).update({
        laborLogs: firebase.firestore.FieldValue.arrayUnion(...logs),
        laborCost: firebase.firestore.FieldValue.increment(batchCost),
        laborHours: firebase.firestore.FieldValue.increment(batchHours),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('production_orders');
      // Roll the spend onto the job OUTSIDE the ledger call — see spentMaterials
      // in consumeProductionMaterials for why: a Production-only user's ledger
      // post is refused, and the job's spend must still be right for them.
      if (order.projectId && batchCost > 0) {
        try {
          await db.collection('job_projects').doc(order.projectId).update({
            spentLabor: firebase.firestore.FieldValue.increment(batchCost),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            timeline: firebase.firestore.FieldValue.arrayUnion({ at,
              event: `Labor logged — ${batchHours} hrs on ${st.label}`, by: who }),
          });
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('job_projects');
        } catch(_) {}
      }
      let posted = false;
      if (batchCost > 0) {
        try {
          await window.Ledger.post({
            ref: `POLAB-${order.id}-${seq}`, date: today(), kind: 'debit',
            accountType: 'expense', account: 'COS – Direct Labor', category: 'COS – Direct Labor',
            description: `Direct labor — ${order.title || order.orderNo || ''}${order.client ? ` (${order.client})` : ''}`,
            amount: batchCost, source: 'Production', projectId: order.projectId || null,
            extra: { hours: batchHours, stage: stageId, rate: rate || 0 },
          });
          posted = true;
        } catch (ledErr) { console.warn('[production labor] ledger post skipped (needs finance rights):', ledErr?.message || ledErr); }
      }
      window.logAudit && window.logAudit('update', 'production_order', order.id, { laborHours: batchHours, laborCost: batchCost });
      Notifs.success(batchCost
        ? `${batchHours} hrs logged · ₱${fmt(batchCost)}${posted ? ' posted to COS – Direct Labor.' : ' recorded (ask Finance to post it to the ledger).'}`
        : `${batchHours} hrs logged — no shop rate set, so no cost was computed.`);
      closeModal(); onSaved && onSaved();
    } catch (ex) { err.textContent = 'Save failed: ' + (ex.message || ex.code); err.classList.remove('hidden'); saveBtn.disabled = false; }
  });
}
window.openLaborLogModal = openLaborLogModal;

async function prodOrderModal(order, currentUser, currentRole, onSaved, prefillProjectId) {
  const e = order || {};
  // ── v14 tap-latency inversion ───────────────────────────────────────────
  // The worst offender in this file: THREE collection reads (job_projects for
  // the "Linked Project" dropdown, inventory_items for the materials picker,
  // worker_directory for the per-stage assignment chips) all had to resolve
  // before openPage() was even reached, so tapping "＋ New Order", "Edit", or a
  // pipeline card left the screen completely still until the slowest of them
  // landed. The window is now created on the tap frame with a skeleton body and
  // the form is poured in afterwards.
  // Title reads `order`/`e` and the footer reads `order`/`e.stage` — both are
  // already in hand from the card that was tapped, so neither is deferred and
  // the header/footer never change after the fill.
  // WHICH buttons ship `disabled`: all three of Save / Delivery Receipt / Delete,
  // because ALL THREE have their listeners wired inside the renderer (po-save,
  // po-dr, po-del below) and are therefore genuinely dead until the fill — not
  // just the primary one. Delivery Receipt's handler happens not to read any
  // fetched value, but a listener that does not exist yet still eats the tap.
  // Cancel is an inline onclick, so it is never disabled: the way out of this
  // window works on the very first frame.
  const panel = openPage(order ? `Edit Order ${e.orderNo||''}` : `${emojiIcon('🏭',16)} New Production Order`, window.skeletonHtml('rows'),
    `<button class="btn-primary" id="po-save" disabled>Save</button>${order && ['out_for_delivery','delivered'].includes(normProdStageId(e.stage))?`<button class="btn-secondary" id="po-dr" disabled>${emojiIcon('🧾',16)} Delivery Receipt</button>`:''}${order?'<button class="btn-danger" id="po-del" disabled>Delete</button>':''}<button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  const poBody = panel.querySelector('.page-panel-body');
  // Renderer body deliberately not re-indented — see openProjectBillingModal.
  await window.withLoadingAndError(poBody, async () => {
    // All three reads keep their ORIGINAL per-read `catch(_){}` swallow. That is
    // load-bearing, not laziness: a job_projects/inventory/roster failure has
    // always degraded to an empty dropdown (you can still write and save an
    // order with no linked project and no materials), and it must keep doing so
    // rather than replacing a usable form with an error screen. Consequently
    // withLoadingAndError's error state is reachable here only if something
    // outside these three guards throws.
    // Load active projects so this work order can be linked to a job (the spine)
    let projs = [];
    let projOpts = '<option value="">— None —</option>';
    try {
      // Dropdown population only (the actual stock deduction on consume uses atomic
      // increment()), so a short cache is safe and saves a full read per modal open.
      const psnap = await dbCachedGet('job_projects', ()=>db.collection('job_projects').get(), 30000);
      projs = psnap.docs.map(d=>({id:d.id,...d.data()})).filter(p=>!['paid','cancelled'].includes(p.stage)).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
      const selP = e.projectId || prefillProjectId || '';
      projOpts += projs.map(p=>`<option value="${p.id}" data-client="${escHtml(p.clientName||'')}" ${selP===p.id?'selected':''}>${escHtml(p.projectNo||'')} — ${escHtml(p.clientName||p.name||'')}</option>`).join('');
    } catch(_) {}
    // Load raw materials for the consumption picker
    let invItems = [];
    try {
      const isnap = await dbCachedGet('inventory_items', () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000);
      invItems = isnap.docs.map(d=>({id:d.id,...d.data()})).filter(i=>(i.kind||'material')==='material').sort((a,b)=>(a.name||'').localeCompare(b.name||''));
    } catch(_) {}
    // v12 WS28 — worker roster (public-safe projection; empty if never synced)
    let workers = [];
    try { const wsnap = await dbCachedGet('worker_directory', ()=>db.collection('worker_directory').get().catch(()=>({docs:[]})), 45000);
      workers = wsnap.docs.map(d=>({id:d.id,...d.data()})).filter(w=>(w.status||'active')==='active').sort((a,b)=>(a.name||'').localeCompare(b.name||'')); } catch(_) {}
    return { projs, projOpts, invItems, workers };
  }, ({ projs, projOpts, invItems, workers }) => {
  if (!panelLive(panel)) return;   // closed mid-flight — fill nothing, wire nothing
  const matItemOpts = (sel='') => '<option value="">— Select material —</option>' + invItems.map(i=>`<option value="${i.id}" data-name="${escHtml(i.name||'')}" data-cost="${Number(i.unitCost)||0}" ${sel===i.id?'selected':''}>${escHtml(i.name||'')} (${Number(i.qty||0).toLocaleString('en-PH')} ${escHtml(i.unit||'')} @ ₱${fmt(i.unitCost||0)})</option>`).join('');
  // Starting a work order from an incoming job: prefill client + quote from the project.
  const pf = (!order && prefillProjectId) ? projs.find(p=>p.id===prefillProjectId) : null;
  const dfClient = e.client || pf?.clientName || '';
  const dfQuote  = e.quoteRef || pf?.quoteNumber || '';
  poBody.innerHTML = `
    <div class="form-group"><label>Linked Project (job)</label>
      <select id="po-project" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${projOpts}</select>
    </div>
    <div class="form-group"><label>Product / Work Description</label><input id="po-title" value="${escHtml(e.title||'')}" placeholder="e.g. SS Baker's Worktable 1500mm ×4"/></div>
    <div class="form-row">
      <div class="form-group"><label>Client / Project</label><input id="po-client" value="${escHtml(dfClient)}" placeholder="e.g. Gerry's Grill — Bulacan"/></div>
      <div class="form-group" style="flex:0 0 90px"><label>Qty</label><input id="po-qty" type="number" min="1" value="${e.qty||1}" inputmode="numeric"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Linked Quote (optional)</label><input id="po-quote" value="${escHtml(dfQuote)}" placeholder="BK-LU-FB-…"/></div>
      <div class="form-group"><label>Workers — this stage</label>
        ${workers.length?`
        <div id="po-workers-chips" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px"></div>
        <div style="display:flex;gap:6px">
          <select id="po-worker-sel" style="flex:1;min-width:0;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)">
            <option value="">— Add worker —</option>
            ${workers.map(w=>`<option value="${w.id}" data-name="${escHtml(w.name||'')}">${escHtml(w.name||'')}${w.jobTitle?` — ${escHtml(w.jobTitle)}`:''}</option>`).join('')}
          </select>
          <button class="btn-secondary btn-sm" id="po-worker-add" type="button">＋</button>
        </div>
        ${e.team?`<div style="font-size:11px;color:var(--text-muted);margin-top:3px">Legacy team note: ${escHtml(e.team)}</div>`:''}`
        :`<input id="po-team" value="${escHtml(e.team||'')}" placeholder="e.g. Fab Team A"/>
        <div style="font-size:11px;color:var(--text-muted);margin-top:3px">No worker directory yet — Finance/HR: press "↻ Sync Directory" on Payroll → Operations Team. Free-text team is used meanwhile.</div>`}
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Stage</label>
        <select id="po-stage" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          ${PROD_STAGES.filter(s=>order || !['out_for_delivery','delivered'].includes(s.id))
            .map(s=>`<option value="${s.id}" ${normProdStageId(e.stage)===s.id?'selected':''}>${s.icon} ${s.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Priority</label>
        <select id="po-priority" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          ${['low','medium','high','urgent'].map(p=>`<option value="${p}" ${(e.priority||'medium')===p?'selected':''}>${p}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Target Date</label><input id="po-due" type="date" value="${e.dueDate||''}"/></div>
    </div>
    <div class="form-group"><label>Notes</label><textarea id="po-notes" rows="2" placeholder="Special instructions, etc.">${escHtml(e.notes||'')}</textarea></div>
    <label style="font-size:12px;font-weight:700;display:block;margin:8px 0 4px">Materials consumed ${e.materialsConsumed?`<span style="color:var(--success);font-weight:600">· ${emojiIcon('✓',16)} consumed</span>`:'(optional)'}</label>
    <div id="po-mats"></div>
    ${e.materialsConsumed
      ? `<div style="font-size:11px;color:var(--success);margin-top:6px">${emojiIcon('✓',11)} Stock deducted · COS ₱${fmt(e.materialsCost||0)} posted to ledger.</div>`
      : `<button class="btn-secondary btn-sm" id="po-add-mat" type="button" style="margin-top:6px">+ Add material</button>
         ${order?`<button class="btn-primary btn-sm" id="po-consume" type="button" style="margin-top:6px;margin-left:6px">${emojiIcon('📦',16)} Consume → stock & COS</button>`:'<div style="font-size:11px;color:var(--text-muted);margin-top:4px">Save the order first, then reopen to consume materials.</div>'}`}
    <div id="po-err" class="error-msg hidden"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [poBody] });

  // ⚠ SCOPED TO THIS PANEL, NOT document — same rule as the three footer
  // releases at the bottom of this renderer, now applied to the whole form.
  // Pipeline cards open this window one after another, and openPage keeps the
  // outgoing panel in the DOM for ~300ms: an unscoped read would save the
  // PREVIOUS order's title/client/qty/stage/materials onto THIS order's doc,
  // including the QC and delivery-receipt gate decisions.
  const $po = (id) => panel.querySelector('#' + id);
  // Materials editor (dynamic rows)
  const matsWrap = $po('po-mats');
  const consumed = !!e.materialsConsumed;
  const addMatRow = (itemId='', qty='') => {
    if (!matsWrap) return;
    const row = document.createElement('div');
    row.className = 'po-mat-row';
    row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:center';
    row.innerHTML = `
      <select class="pm-item" ${consumed?'disabled':''} style="flex:1;min-width:0;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)">${matItemOpts(itemId)}</select>
      <input class="pm-qty" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Qty" value="${qty}" ${consumed?'disabled':''} style="flex:0 0 70px;width:70px"/>
      ${consumed?'':`<button class="btn-danger btn-sm pm-del" type="button" aria-label="Remove material">${emojiIcon('✕',16)}</button>`}`;
    if (window.lucide) lucide.createIcons({ nodes: [row] });
    row.querySelector('.pm-del')?.addEventListener('click', ()=>row.remove());
    matsWrap.appendChild(row);
  };
  (e.materials||[]).forEach(m=>addMatRow(m.itemId, m.qty));
  if (!consumed && !(e.materials||[]).length) addMatRow();
  $po('po-add-mat')?.addEventListener('click', ()=>addMatRow());

  // v12 WS28 — per-stage worker chips (initialised from the CURRENT stage's assignment)
  let asgSel = [];
  { const cur = e.assignments?.[normProdStageId(e.stage)];
    if (cur) asgSel = (cur.workerIds||[]).map((id,i)=>({ id, name:(cur.workerNames||[])[i]||id })); }
  const renderWChips = () => { const w=$po('po-workers-chips'); if(!w) return;
    w.innerHTML = asgSel.map(x=>`<span class="badge badge-blue" style="cursor:pointer" data-uid="${escHtml(x.id)}">${emojiIcon('👷',16)} ${escHtml(x.name)} ${emojiIcon('✕',16)}</span>`).join('')||'<span style="font-size:11px;color:var(--text-muted)">No workers assigned to this stage yet.</span>';
    if (window.lucide) lucide.createIcons({ nodes: [w] });
    w.querySelectorAll('[data-uid]').forEach(ch=>ch.addEventListener('click',()=>{ asgSel=asgSel.filter(x=>x.id!==ch.dataset.uid); renderWChips(); })); };
  renderWChips();
  $po('po-worker-add')?.addEventListener('click', ()=>{
    const sel=$po('po-worker-sel'); const id=sel.value; if(!id) return;
    if(!asgSel.some(x=>x.id===id)) asgSel.push({ id, name: sel.options[sel.selectedIndex]?.dataset.name||'' });
    sel.value=''; renderWChips(); });

  // // ⚠ replace, never closeModal()-then-open: dismissTop() is history.back(), which is
  // ASYNC, so the queued back lands AFTER the new panel is pushed and pops the panel
  // that was just opened — it flashes up and dies, and repeated taps drift the Overlay
  // and history stacks apart until a later close unwinds to the page underneath.
  // (President's report 2026-08-10, reproduced in-browser.) See js/screens/sales.js.
  $po('po-dr')?.addEventListener('click', ()=>openDeliveryReceiptModal({...e, id:order.id}, onSaved, { replace:true }));

  const collectMaterials = () => [...matsWrap.querySelectorAll('.po-mat-row')].map(r=>{
    const sel = r.querySelector('.pm-item'); const opt = sel.options[sel.selectedIndex];
    return { itemId: sel.value, name: opt?.dataset.name||'', unitCost: parseFloat(opt?.dataset.cost||0)||0, qty: parseFloat(r.querySelector('.pm-qty').value)||0 };
  }).filter(m=>m.itemId && m.qty>0);

  $po('po-consume')?.addEventListener('click', async ()=>{
    const materials = collectMaterials();
    if (!materials.length) { Notifs.showToast('Add at least one material with a quantity.','error'); return; }
    if (!(await confirmDialog({message:`Consume these materials? This deducts stock and posts COS to the ledger (one-time).`, danger:true}))) return;
    const btn = $po('po-consume'); btn.disabled = true;
    try {
      await db.collection('production_orders').doc(order.id).update({ materials });
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('production_orders');
      const res = await consumeProductionMaterials({ ...e, id: order.id, materials });
      if (res.ok) Notifs.success(res.cosPosted
        ? `Consumed ${res.count} material${res.count>1?'s':''} · COS ₱${fmt(res.cos)} posted to ledger.`
        : `Stock deducted (COS ₱${fmt(res.cos)} recorded; ask Finance to post it to the ledger).`);
      else Notifs.showToast(res.reason||'Nothing to consume.','error');
      closeModal(); onSaved && onSaved();
    } catch(ex){ Notifs.showToast('Consume failed: '+(ex.message||ex),'error'); btn.disabled=false; }
  });

  $po('po-save').addEventListener('click', async ()=>{
    const title = $po('po-title').value.trim();
    const err = $po('po-err');
    if(!title){ err.textContent='Product / work description is required.'; err.classList.remove('hidden'); return; }
    const projSel = $po('po-project');
    const projectId = projSel?.value || '';
    const data = {
      title, client: $po('po-client').value.trim(),
      qty: parseInt($po('po-qty').value)||1,
      quoteRef: $po('po-quote').value.trim(),
      projectId: projectId || null,
      stage: $po('po-stage').value,
      priority: $po('po-priority').value,
      dueDate: $po('po-due').value,
      notes: $po('po-notes').value.trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    // v12 WS28 — mirror the rules-side transition gates (friendly errors)
    const _prevStage = normProdStageId(e.stage);
    if (data.stage==='out_for_delivery' && _prevStage!=='out_for_delivery' && (e.qc?.result)!=='passed'){
      err.textContent='QC must pass first — run the 🔍 QC inspection before Out for Delivery.'; err.classList.remove('hidden'); return; }
    if (data.stage==='delivered' && _prevStage!=='delivered' && !e.deliveryReceipt){
      err.textContent='Record the 🧾 Delivery Receipt before marking Delivered.'; err.classList.remove('hidden'); return; }
    // v14 prod-fixlist — a manual REGRESSION (moving the stage backward via this
    // Edit select, e.g. delivered → layouting) used to leave e.qc/e.deliveryReceipt
    // untouched, so re-advancing the same order a second time silently reused the
    // OLD passed QC result / old delivery receipt instead of requiring a fresh
    // inspection — undermining the QC gate above. Clear whichever gate data no
    // longer applies to the new (earlier) stage.
    if (order) {
      const _prevIdx = PROD_STAGES.findIndex(s=>s.id===_prevStage);
      const _newIdx  = PROD_STAGES.findIndex(s=>s.id===data.stage);
      const _qcIdx   = PROD_STAGES.findIndex(s=>s.id==='qc');
      const _ofdIdx  = PROD_STAGES.findIndex(s=>s.id==='out_for_delivery');
      if (_newIdx > -1 && _prevIdx > -1 && _newIdx < _prevIdx) {
        if (_newIdx <= _qcIdx && e.qc) data.qc = firebase.firestore.FieldValue.delete();
        if (_newIdx <= _ofdIdx && e.deliveryReceipt) data.deliveryReceipt = firebase.firestore.FieldValue.delete();
      }
    }
    if (workers.length) {
      const asg = Object.assign({}, e.assignments||{});
      if (asgSel.length) asg[data.stage] = { workerIds: asgSel.map(x=>x.id), workerNames: asgSel.map(x=>x.name) };
      else delete asg[data.stage];
      data.assignments = asg;                       // legacy `team` left untouched on the doc
    } else {
      data.team = $po('po-team')?.value.trim() || '';
    }
    if (order && data.stage !== _prevStage) {       // stage changed via the select → history + since-marker
      data.stageHistory = firebase.firestore.FieldValue.arrayUnion({
        stage: data.stage, enteredAt: new Date().toISOString(),
        by: currentUser.uid, byName: userProfile?.displayName||currentUser.email||'' });
      data.stageUpdatedAt = firebase.firestore.FieldValue.serverTimestamp();
    }
    if (!e.materialsConsumed) data.materials = collectMaterials(); // lock once consumed
    try {
      if(order){
        await db.collection('production_orders').doc(order.id).update(data);
        window.logAudit&&window.logAudit('update','production_order',order.id,{title:data.title,stage:data.stage});
        // Edit→Save is a fully valid stage-change path (same QC/DR gates as the
        // Advance button) — sync the parent project + tracker here too.
        if (data.stage !== _prevStage) await syncJobFromProdStage(data.projectId || order.projectId, data.stage);
      }
      else {
        // order number PO-YYMM-### (atomic sequence; falls back to time suffix)
        const ym = (window.bizDate?window.bizDate():new Date().toISOString().slice(0,10)).slice(2,7).replace('-','');
        try {
          data.orderNo = await nextCounterId('production_orders',
            async () => (await db.collection('production_orders').get()).size,
            n => `PO-${ym}-${String(n).padStart(3,'0')}`);
        } catch(_) { data.orderNo = `PO-${ym}-${String(Date.now()).slice(-3)}`; }
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        data.createdBy = currentUser.uid;
        data.createdByName = userProfile?.displayName || currentUser.email || '';
        data.stageHistory = [{ stage: data.stage, enteredAt: new Date().toISOString(),
          by: currentUser.uid, byName: data.createdByName }];
        const _po = await db.collection('production_orders').add(data);
        window.logAudit&&window.logAudit('create','production_order',data.orderNo,{title:data.title,client:data.client||''});
        // Link back to the project: register the order, move it into production, add to the doc register
        if (projectId) { try { await db.collection('job_projects').doc(projectId).update({
          stage:'in_production', updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
          productionOrderIds:firebase.firestore.FieldValue.arrayUnion(_po.id),
          documents:firebase.firestore.FieldValue.arrayUnion({ type:'Job Order', ref:data.orderNo, at:new Date().toISOString(), by:data.createdByName }),
          timeline:firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:'Production order '+data.orderNo+' created', by:data.createdByName }) }); } catch(_) {}
        }
      }
      if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('production_orders'); dbCacheInvalidate('job_projects'); }
      closeModal(); Notifs.success('Order saved'); onSaved && onSaved();
    } catch(ex){ err.textContent='Save failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
  });
  $po('po-del')?.addEventListener('click', async ()=>{
    if(!(await confirmDialog({message:'Delete this production order?', danger:true}))) return;
    try { await db.collection('production_orders').doc(order.id).delete(); window.logAudit&&window.logAudit('delete','production_order',order.id,{orderNo:order.orderNo||''}); if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('production_orders'); closeModal(); Notifs.success('Deleted'); onSaved && onSaved(); }
    catch(ex){ Notifs.showToast('Delete failed (admin only)','error'); }
  });
  // Form and all three listeners are real now — release the whole footer. The two
  // optional buttons are absent entirely on a new/early-stage order, hence the
  // null guards. Panel-scoped; see the note at openProjectBillingModal.
  const poSaveBtn = panel.querySelector('#po-save');
  if (poSaveBtn) poSaveBtn.disabled = false;
  const poDrBtn = panel.querySelector('#po-dr');
  if (poDrBtn) poDrBtn.disabled = false;
  const poDelBtn = panel.querySelector('#po-del');
  if (poDelBtn) poDelBtn.disabled = false;
  }, { skeleton:'rows' });
}

// ── Inventory Count Form — editable, printable physical stock-take sheet ──
// Pre-fills one row per inventory_items doc (with its system on-hand qty) and
// lets the team key the physical count → live variance + remarks on screen,
// then print a clean A4 form (filled, or blank to count by hand). Entries
// autosave to localStorage so a long count survives a refresh or subtab switch.
// Print stays non-mutating; since v12 WS29 the ✓ Post Variances action
// (president/manager/finance only) corrects on-hand qty to the physical count
// and logs an 'adjust'/'count' stock movement per corrected item.
const PROD_COUNT_DRAFT_KEY = 'bi-prod-count-draft';
// v14 prod-fixlist — namespaced per signed-in user. The key used to be one
// fixed global string, so a shared shop-floor device/kiosk used by more than
// one person during the same count cycle had one person's in-progress counts
// silently overwritten by the next person opening the Count Form. Falls back
// to a shared 'anon' bucket if no user is signed in yet (shouldn't happen —
// this form is behind auth).
function prodCountDraftKey(){
  const uid = (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || 'anon';
  return PROD_COUNT_DRAFT_KEY + '-' + uid;
}
function loadCountDraft(){ try { return JSON.parse(localStorage.getItem(prodCountDraftKey()) || '{}') || {}; } catch(e){ return {}; } }
function saveCountDraft(d){ try { localStorage.setItem(prodCountDraftKey(), JSON.stringify(d)); } catch(e){} }

async function renderProdInventoryForm(el, currentRole, kindFilter='all'){
  el.innerHTML = window.skeletonHtml('rows');
  const snap = await dbCachedGet('inventory_items', () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000);
  const items = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  const shown = items.filter(i=> kindFilter==='all' || (i.kind||'material')===kindFilter);

  const draft  = loadCountDraft();
  draft.header = draft.header || {};
  draft.counts = draft.counts || {};
  draft.extras = Array.isArray(draft.extras) ? draft.extras : [];
  const h = draft.header, counts = draft.counts;
  const todayStr = (window.bizDate ? window.bizDate() : today());
  if (!h.formNo)        h.formNo = 'IC-' + todayStr.replace(/-/g,'');
  if (h.date == null)   h.date = todayStr;
  if (h.countedBy==null)h.countedBy = (typeof userProfile!=='undefined' && userProfile?.displayName) || currentUser?.email || '';
  saveCountDraft(draft);

  const varOf = (sys, phys) => (phys==='' || phys==null || isNaN(parseFloat(phys))) ? null : (parseFloat(phys) - Number(sys||0));
  const varHtml = v => v==null ? '<span style="color:var(--text-muted)">—</span>'
    : `<span style="font-weight:700;color:${v===0?'var(--success)':v<0?'var(--danger)':'var(--warning)'}">${v>0?'+':''}${Number(v).toLocaleString('en-PH')}</span>`;
  const counted = shown.filter(i=>{ const c=counts[i.id]; return c && c.physical!=='' && c.physical!=null; }).length;
  const withVar = shown.filter(i=>{ const c=counts[i.id]; const v=c?varOf(i.qty,c.physical):null; return v!=null && v!==0; }).length;
  const canPost = ['president','manager','finance'].includes(currentRole);

  const inEl = (cls,id,val,ph='',type='text') =>
    `<input class="${cls}" data-id="${id}" type="${type}" ${type==='number'?'inputmode="decimal" step="any"':''} value="${escHtml(val==null?'':val)}" placeholder="${ph}" style="width:100%;padding:5px 7px;border:1px solid var(--border);border-radius:6px;font-size:12px;background:var(--surface);color:var(--text)"/>`;

  el.innerHTML = `
    <div class="kpi-row" style="margin-bottom:12px">
      <div class="kpi-card"><div class="kpi-label">Items</div><div class="kpi-value">${shown.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Counted</div><div class="kpi-value">${counted}</div></div>
      <div class="kpi-card ${withVar?'red':''}"><div class="kpi-label">With Variance</div><div class="kpi-value">${withVar}</div></div>
    </div>

    <div class="card" style="margin-bottom:12px"><div class="card-body">
      <div class="form-row">
        <div class="form-group"><label>Form No.</label><input id="cf-formno" value="${escHtml(h.formNo)}"/></div>
        <div class="form-group"><label>Count Date</label><input id="cf-date" type="date" value="${escHtml(h.date||'')}"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Warehouse / Location</label><input id="cf-loc" value="${escHtml(h.location||'')}" placeholder="e.g. Main Warehouse — Bulacan"/></div>
        <div class="form-group"><label>Counted By</label><input id="cf-by" value="${escHtml(h.countedBy||'')}"/></div>
      </div>
      <div class="form-group"><label>Verified By</label><input id="cf-verified" value="${escHtml(h.verifiedBy||'')}" placeholder="Supervisor / checker"/></div>
    </div></div>

    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:10px">
      ${window.chipTabs([{key:'all',label:'All'},{key:'material',label:'Raw Materials'},{key:'product',label:'Finished Goods'}], kindFilter)}
      <button class="btn-secondary btn-sm" id="cf-clear" style="margin-left:auto">↺ Clear</button>
      <button class="btn-secondary btn-sm" id="cf-addrow">＋ Blank row</button>
      ${canPost?`<button class="btn-primary btn-sm" id="cf-post">${emojiIcon('✓',16)} Post Variances</button>`:''}
      <button class="btn-secondary btn-sm" id="cf-print">${emojiIcon('🖨',16)} Print / PDF</button>
    </div>

    <div class="card"><div class="card-body" style="padding:0">
      <div class="table-wrap"><table class="data-table">
        <thead><tr>
          <th style="width:32px">#</th><th>Item</th><th>Unit</th>
          <th style="text-align:right">System Qty</th><th style="width:120px">Physical Count</th>
          <th style="text-align:right;width:90px">Variance</th><th style="width:24%">Remarks</th>
        </tr></thead>
        <tbody>
          ${!shown.length && !draft.extras.length ? `<tr><td colspan="7">${window.renderEmptyState({icon:'📦',title:'No items in inventory',hint:'Add items in the Inventory module, or use “＋ Blank row” for a write-in sheet.'})}</td></tr>` :
          shown.map((i,idx)=>{
            const c = counts[i.id] || {};
            return `<tr>
              <td style="color:var(--text-muted)">${idx+1}</td>
              <td style="font-weight:600">${escHtml(i.name||'—')}${i.category?`<div style="font-size:11px;color:var(--text-muted)">${escHtml(i.category)}</div>`:''}</td>
              <td style="font-size:12px">${escHtml(i.unit||'')}</td>
              <td style="text-align:right;font-weight:600">${Number(i.qty||0).toLocaleString('en-PH')}</td>
              <td>${inEl('cf-pc',i.id,c.physical,'',  'number')}</td>
              <td style="text-align:right"><span class="cf-var" data-id="${i.id}">${varHtml(varOf(i.qty,c.physical))}</span></td>
              <td>${inEl('cf-rm',i.id,c.remarks||'','note')}</td>
            </tr>`;
          }).join('')}
          ${draft.extras.map((r,ei)=>`<tr>
              <td style="color:var(--text-muted)">${shown.length+ei+1}</td>
              <td>${inEl('cf-ex-name',ei,r.name||'','Item name')}</td>
              <td>${inEl('cf-ex-unit',ei,r.unit||'','unit')}</td>
              <td style="text-align:right;color:var(--text-muted)">—</td>
              <td>${inEl('cf-ex-pc',ei,r.physical||'','','number')}</td>
              <td style="text-align:right;color:var(--text-muted)">—</td>
              <td>${inEl('cf-ex-rm',ei,r.remarks||'','note')}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>
    </div></div>
    <p style="font-size:11px;color:var(--text-muted);margin-top:8px">Entries autosave on this device. “Print / PDF” opens a clean A4 form with whatever you’ve entered — print it blank to count by hand, or fill it in first.</p>`;
  if (window.lucide) lucide.createIcons({ nodes: [el] });

  const persist = () => saveCountDraft(draft);
  const hb = (id,key)=>{ const n=document.getElementById(id); n && n.addEventListener('input',()=>{ draft.header[key]=n.value; persist(); }); };
  hb('cf-formno','formNo'); hb('cf-date','date'); hb('cf-loc','location'); hb('cf-by','countedBy'); hb('cf-verified','verifiedBy');

  el.querySelectorAll('.cf-pc').forEach(n=>n.addEventListener('input',()=>{
    const id=n.dataset.id; (draft.counts[id] ||= {}).physical = n.value; persist();
    const item = shown.find(x=>x.id===id), cell = el.querySelector(`.cf-var[data-id="${id}"]`);
    if (cell && item) cell.innerHTML = varHtml(varOf(item.qty, n.value));
  }));
  el.querySelectorAll('.cf-rm').forEach(n=>n.addEventListener('input',()=>{ (draft.counts[n.dataset.id] ||= {}).remarks = n.value; persist(); }));

  const exBind=(cls,key)=>el.querySelectorAll(cls).forEach(n=>n.addEventListener('input',()=>{ (draft.extras[n.dataset.id] ||= {})[key]=n.value; persist(); }));
  exBind('.cf-ex-name','name'); exBind('.cf-ex-unit','unit'); exBind('.cf-ex-pc','physical'); exBind('.cf-ex-rm','remarks');

  window.bindChipTabs(el, (key)=>renderProdInventoryForm(el,currentRole,key));
  document.getElementById('cf-addrow')?.addEventListener('click',()=>{ draft.extras.push({}); persist(); renderProdInventoryForm(el,currentRole,kindFilter); });
  document.getElementById('cf-clear')?.addEventListener('click', async ()=>{
    if(!(await confirmDialog({message:'Clear all counts, remarks and header fields on this form?', danger:true}))) return;
    localStorage.removeItem(prodCountDraftKey()); Notifs.success('Form cleared'); renderProdInventoryForm(el,currentRole,kindFilter);
  });
  document.getElementById('cf-print')?.addEventListener('click',()=>openInventoryCountForm(shown, loadCountDraft(), kindFilter));

  document.getElementById('cf-post')?.addEventListener('click', async () => {
    const d = loadCountDraft();
    // v14 prod-fixlist — post against the FULL item list, not `shown` (which is
    // scoped to whichever kind-filter tab happens to be active). Posting used to
    // silently skip any Finished-Goods variance while viewing the Raw Materials
    // tab (or vice versa) with no on-screen indication anything was excluded.
    const lines = items.map(i => {
      const c = (d.counts || {})[i.id] || {};
      const phys = parseFloat(c.physical);
      return { item: i, phys, remarks: c.remarks || '', v: varOf(i.qty, c.physical) };
    }).filter(l => l.v != null && l.v !== 0);
    if (!lines.length) { Notifs.error('No non-zero variances to post.'); return; }
    const formNo = String(d.header?.formNo || 'IC').replace(/[^A-Za-z0-9-]/g, '') || 'IC';
    if (!(await confirmDialog({ message:
      `Post ${lines.length} variance correction${lines.length>1?'s':''}? On-hand quantities will be set to the physical count and each correction logged in the movement history. Write-in blank rows are not posted — add those items in Inventory first.`,
      danger: true }))) return;
    let posted = 0, dupCount = 0, noChangeCount = 0; const failed = [];
    for (const l of lines) {
      const itemRef = db.collection('inventory_items').doc(l.item.id);
      const movRef  = db.collection('stock_movements').doc(`CNT_${formNo}_${l.item.id}`);
      try {
        const outcome = await db.runTransaction(async tx => {
          const mov = await tx.get(movRef);
          if (mov.exists) return 'dup';                  // this Form No already posted this item
          const cur = await tx.get(itemRef);
          if (!cur.exists) return 'gone';
          const sysNow = Number(cur.data().qty) || 0;    // recompute vs LIVE qty, not render-time
          if (Math.abs(l.phys - sysNow) < 1e-9) return 'nochange'; // someone already fixed it
          tx.update(itemRef, { qty: l.phys, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
          tx.set(movRef, window.buildStockMovement({
            itemId: l.item.id, itemName: l.item.name || '', type: 'adjust',
            qty: Math.abs(l.phys - sysNow), source: 'count',
            refNumber: d.header?.formNo || '',
            note: `Count ${d.header?.date || ''}: system ${sysNow} → physical ${l.phys}${l.remarks ? ' — ' + l.remarks : ''}`,
            unitCost: Number(cur.data().unitCost) || null, qtyAfter: l.phys
          }));
          return 'posted';
        });
        if (outcome === 'posted') posted++;
        else if (outcome === 'dup') dupCount++;
        else if (outcome === 'nochange') noChangeCount++;
      } catch (ex) { failed.push(l.item.name || l.item.id); }
    }
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('inventory_items');
    window.logAudit && window.logAudit('adjust', 'inventory_count', formNo, { posted, failed: failed.length });
    // v14 prod-fixlist — distinguish a genuine same-day re-count blocked by this
    // Form No's idempotency guard (CNT_<formNo>_<itemId>) from an ordinary
    // "nothing changed" skip, instead of both silently vanishing into a lower
    // `posted` count with no explanation of what happened to the rest.
    const parts = [];
    if (posted) parts.push(`Posted ${posted} variance correction${posted===1?'':'s'}`);
    if (dupCount) parts.push(`${dupCount} already recorded under Form No. "${formNo}" — change the Form No. above (e.g. add "-2") to post a same-day re-count`);
    if (noChangeCount) parts.push(`${noChangeCount} already matched system qty`);
    if (failed.length) parts.push(`failed: ${failed.join(', ')}`);
    Notifs.showToast(parts.join(' · ') || 'Nothing to post.', failed.length ? 'error' : (posted ? 'success' : undefined));
    renderProdInventoryForm(el, currentRole, kindFilter);
  });
}

// Open the filled (or blank) inventory count form in a clean, printable window.
function openInventoryCountForm(items, draft, kindFilter){
  const h = draft.header||{}, counts = draft.counts||{}, extras = Array.isArray(draft.extras)?draft.extras:[];
  const e = s => escHtml(s);
  const num = n => Number(n||0).toLocaleString('en-PH');
  const fmtDate = s => { if(!s) return ''; const dt=new Date(s+'T00:00:00'); return isNaN(dt.getTime())?s:dt.toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'}); };
  const kindLabel = kindFilter==='material'?'Raw Materials':kindFilter==='product'?'Finished Goods':'All Items';
  const varCell = (sys,phys)=>{ if(phys===''||phys==null||isNaN(parseFloat(phys))) return ''; const v=parseFloat(phys)-Number(sys||0); return (v>0?'+':'')+num(v); };
  const _lh = window.buildLetterhead ? window.buildLetterhead({
    orientation: 'landscape',
    docTitle: 'INVENTORY COUNT FORM',
    docNumber: h.formNo || '',
    dateLabel: 'Count Date: ' + fmtDate(h.date),
    extraMeta: [kindLabel],
    signatures: [
      { label: 'Counted by',  name: h.countedBy || '', title: '' },
      { label: 'Verified by', name: h.verifiedBy || '', title: '' },
      { label: 'Approved by', name: '', title: '' }
    ],
    footerNote: ((window.BRAND && window.BRAND.fullName) || 'Barro Industries Operating System') + ' · Generated ' + new Date().toLocaleString('en-PH') + ' · Physical count supersedes system quantity upon approval.'
  }) : null;

  const rows = items.map((i,idx)=>{ const c=counts[i.id]||{}; return `<tr>
      <td class="c">${idx+1}</td>
      <td>${e(i.name||'')}${i.category?`<div class="sub">${e(i.category)}</div>`:''}</td>
      <td class="c">${e(i.unit||'')}</td>
      <td class="r">${num(i.qty||0)}</td>
      <td class="r b">${c.physical!=null&&c.physical!==''?num(c.physical):''}</td>
      <td class="r">${varCell(i.qty,c.physical)}</td>
      <td>${e(c.remarks||'')}</td></tr>`; }).join('');
  const extraRows = extras.map((r,ei)=>`<tr>
      <td class="c">${items.length+ei+1}</td>
      <td>${e(r.name||'')}</td>
      <td class="c">${e(r.unit||'')}</td>
      <td class="r">—</td>
      <td class="r b">${r.physical!=null&&r.physical!==''?num(r.physical):''}</td>
      <td class="r"></td>
      <td>${e(r.remarks||'')}</td></tr>`).join('');
  const filled = items.length + extras.length;
  const pad = filled < 12 ? 12 - filled : 2;
  let blanks=''; for(let k=0;k<pad;k++) blanks += `<tr class="blank"><td class="c">${filled+k+1}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`;

  const pageCss = `
  .page{width:297mm;min-height:210mm;margin:0 auto;background:#fff;padding:12mm}
  .meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px}
  .mbox{border:1px solid #999;border-radius:5px;padding:6px 9px}
  .mbox .l{font-size:8px;text-transform:uppercase;letter-spacing:.5px;color:#888;font-weight:700}
  .mbox .v{font-size:12px;font-weight:700;margin-top:2px;min-height:15px}
  th{background:#1E3A5F;color:#fff;font-size:9px;text-transform:uppercase;letter-spacing:.04em}
  td .sub{font-size:9px;color:#777}
  .sign{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:34px}
  .sline{border-top:1px solid #000;padding-top:5px;text-align:center;font-size:10px;color:#444}
  .foot{margin-top:18px;border-top:1px solid #ddd;padding-top:8px;font-size:9px;color:#999;text-align:center}
  @media print{ .page{padding:0;width:auto;min-height:0} }
${_lh ? _lh.printCSS : ''}`;
  const bodyHtml = `
  ${_lh ? _lh.headerHTML : ''}
  <div class="meta">
    <div class="mbox"><div class="l">Form No.</div><div class="v">${e(h.formNo||'')}</div></div>
    <div class="mbox"><div class="l">Count Date</div><div class="v">${e(fmtDate(h.date))}</div></div>
    <div class="mbox"><div class="l">Warehouse / Location</div><div class="v">${e(h.location||'')}</div></div>
    <div class="mbox"><div class="l">Counted By</div><div class="v">${e(h.countedBy||'')}</div></div>
  </div>
  <table>
    <thead><tr>
      <th style="width:30px">#</th><th>Item / Description</th><th style="width:60px">Unit</th>
      <th style="width:80px">System Qty</th><th style="width:90px">Physical Count</th>
      <th style="width:70px">Variance</th><th style="width:24%">Remarks</th>
    </tr></thead>
    <tbody>${rows}${extraRows}${blanks}</tbody>
  </table>
  ${_lh ? _lh.footerHTML : `
  <div class="sign">
    <div class="sline">Counted by${h.countedBy?` — ${e(h.countedBy)}`:''}</div>
    <div class="sline">Verified by${h.verifiedBy?` — ${e(h.verifiedBy)}`:''}</div>
    <div class="sline">Approved by</div>
  </div>
  <div class="foot">Barro Industries Operating System · Generated ${new Date().toLocaleString('en-PH')} · Physical count supersedes system quantity upon approval.</div>`}`;

  window.openPrintableDoc({
    title: `Inventory Count Form — ${h.formNo||''}`,
    barLabel: `${emojiIcon('📋',16)} Inventory Count Form — ${e(h.formNo||'')}`,
    bodyHtml, pageCss,
    accent: '#1E3A5F',
    winFeatures: 'width=1000,height=720'
  });
}

async function renderProdMaterials(el, currentRole) {
  el.innerHTML = window.skeletonHtml('rows');
  // Primary data — no swallow here; a real failure now surfaces via
  // loadProdContent's error-with-retry instead of rendering as "no materials".
  const snap = await dbCachedGet('inventory_items', () => db.collection('inventory_items').get(), 45000);
  const mats = snap.docs.map(d=>({id:d.id,...d.data()})).filter(i=>(i.kind||'material')==='material').sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  const low = mats.filter(i=>(i.reorderLevel||0)>0 && (i.qty||0) <= (i.reorderLevel||0));
  const stockValue = mats.reduce((s,i)=>s+(Number(i.qty)||0)*(Number(i.unitCost)||0),0);
  el.innerHTML = `
    <div class="kpi-row" style="margin-bottom:12px">
      <div class="kpi-card"><div class="kpi-label">Raw Materials</div><div class="kpi-value">${mats.length}</div></div>
      <div class="kpi-card accent"><div class="kpi-label">Stock Value</div><div class="kpi-value" style="font-size:15px">₱${fmt(stockValue)}</div></div>
      <div class="kpi-card ${low.length?'red':''}"><div class="kpi-label">Low Stock</div><div class="kpi-value">${low.length}</div></div>
    </div>
    ${low.length?`<div class="alert-banner alert-warn"><span>${emojiIcon('⚠️',16)} <strong>${low.length} material${low.length>1?'s':''}</strong> at or below reorder level — flag Purchasing.</span></div>`:''}
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
      <button class="btn-secondary btn-sm" onclick="navigateTo('inventory')">Open full Inventory →</button>
    </div>
    <div class="card"><div class="card-body" style="padding:0">
      ${!mats.length?window.renderEmptyState({icon:'📦',title:'No materials in inventory yet',hint:'Add raw materials in the Inventory module.'}):
      `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Material</th><th>On Hand</th><th>Reorder</th><th>Unit Cost</th><th>Supplier</th></tr></thead>
        <tbody>${mats.map(i=>{
          const lowItem=(i.reorderLevel||0)>0 && (i.qty||0)<=(i.reorderLevel||0);
          return `<tr>
            <td style="font-weight:600">${escHtml(i.name||'—')}${i.category?`<div style="font-size:11px;color:var(--text-muted)">${escHtml(i.category)}</div>`:''}</td>
            <td style="font-weight:700;color:${lowItem?'var(--danger)':'inherit'}">${Number(i.qty||0).toLocaleString('en-PH')} ${escHtml(i.unit||'')}${lowItem?` ${emojiIcon('⚠️',16)}`:''}</td>
            <td style="font-size:12px;color:var(--text-muted)">${Number(i.reorderLevel||0).toLocaleString('en-PH')}</td>
            <td>₱${fmt(i.unitCost||0)}</td>
            <td style="font-size:12px">${escHtml(i.supplier||'—')}</td>
          </tr>`;}).join('')}</tbody>
      </table></div>`}
    </div></div>`;
  if (window.lucide) lucide.createIcons({ nodes: [el] });
}

// ══════════════════════════════════════════════════
//  PURCHASING DEPARTMENT
//  Flow: create a Request for Quotation (RFQ) → enter supplier prices →
//  convert it into a Purchase Request (PR). Both stages live in ONE
//  collection (purchase_requisitions) keyed by `stage` ('rfq' | 'pr') so the
//  conversion preserves the line items + history. Finance gets a read-only
//  window into the committed purchase requests (Finance → Purchases tab).
// ══════════════════════════════════════════════════
function purchTotal(items) {
  return (items || []).reduce((s, it) =>
    s + (it.unitPrice != null ? (Number(it.unitPrice) || 0) * (Number(it.qty) || 0) : 0), 0);
}

window.renderPurchasing = async function(currentUser, currentRole, subtab = 'Request for Quotation') {
  const c = deptContainer();
  const tabs = ['Request for Quotation', 'Purchase Requests', 'Budgeting', 'Tasks'];
  c.innerHTML = `
    <div class="page-header"><h2>${emojiIcon('🛒',20)} Purchasing</h2></div>
    ${window.sopPanel('How Purchasing works', [
      'Raise a Request for Quotation (or pre-fill one "From low stock"); enter supplier prices.',
      'Convert the RFQ to a Purchase Request, print the branded PO, and submit it to Finance.',
      'Received materials auto-match to Inventory on receive.'
    ])}
    ${window.chipTabs(tabs.map(s=>({key:s,label:s})), subtab)}
    <div id="purch-content">${window.skeletonHtml('rows')}</div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  loadPurchasingContent(currentUser, currentRole, subtab);
  window.bindChipTabs(c, (key) => loadPurchasingContent(currentUser, currentRole, key));
};

async function loadPurchasingContent(currentUser, currentRole, sub) {
  const content = document.getElementById('purch-content');
  try {
    if (sub === 'Tasks') return await renderDeptTasks(content, 'Purchasing', currentUser, currentRole);
    if (sub === 'Budgeting') return await window.renderBudgeting(content, currentUser, currentRole, 'Purchasing');
    if (sub === 'Purchase Requests') return await renderPurchaseRequests(content, currentUser, currentRole);
    return await renderRFQs(content, currentUser, currentRole);
  } catch (e) {
    console.error('Purchasing load error', e);
    content.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load</h4><p>${escHtml(e.message||String(e))}</p><button type="button" class="btn-secondary btn-sm purch-retry-btn" style="margin-top:14px">Retry</button></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [content] });
    content.querySelector('.purch-retry-btn')?.addEventListener('click', ()=>loadPurchasingContent(currentUser, currentRole, sub));
  }
}

// ── RFQ list (stage === 'rfq') ────────────────────
async function renderRFQs(content, currentUser, currentRole) {
  const canEdit = canEditDept('Purchasing');
  // v13 review: client-side stage filter retained ON PURPOSE. A server-side
  // where('stage','==','rfq') would drop any legacy doc with no stage field,
  // whereas the original defaults a missing stage to 'rfq' (d.stage||'rfq').
  // Until the live collection is verified stage-clean (Phase 87 follow-up),
  // correctness beats the marginal read saving on this small collection.
  const snap = await db.collection('purchase_requisitions').orderBy('createdAt','desc').get();
  const rfqs = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(d => (d.stage||'rfq') === 'rfq');

  content.innerHTML = `
    ${canEdit ? `<div style="display:flex;gap:6px;justify-content:flex-end;margin-bottom:8px;flex-wrap:wrap"><button class="btn-secondary btn-sm" id="rfq-lowstock-btn">${emojiIcon('📉',16)} From low stock</button><button class="btn-primary btn-sm" id="new-rfq-btn">+ New RFQ</button></div>` : ''}
    <p style="font-size:12px;color:var(--text-muted);margin:0 0 12px">Create a Request for Quotation, enter the supplier's prices, then convert it into a Purchase Request.</p>
    ${!rfqs.length
      ? window.renderEmptyState({icon:'📋',title:'No open RFQs',hint:'Create one to request supplier pricing.'})
      : rfqs.map(r => purchRfqCard(r, canEdit)).join('')}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [content] });
  if (canEdit) {
    document.getElementById('new-rfq-btn')?.addEventListener('click', () =>
      openRfqModal(currentUser, () => renderRFQs(content, currentUser, currentRole)));
    document.getElementById('rfq-lowstock-btn')?.addEventListener('click', async () => {
      const isnap = await dbCachedGet('inventory_items', () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000);
      const low = isnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(i => (i.kind || 'material') === 'material' && (i.reorderLevel || 0) > 0 && (i.qty || 0) <= (i.reorderLevel || 0));
      if (!low.length) { Notifs.showToast('No materials are at or below reorder level. 👍'); return; }
      // Suggested order qty brings stock up to ~2× the reorder level.
      const items = low.map(i => ({ itemId: i.id, desc: i.name || '', qty: Math.max(Math.round((i.reorderLevel || 0) * 2 - (i.qty || 0)), i.reorderLevel || 0), unit: i.unit || '' }));
      openRfqModal(currentUser, () => renderRFQs(content, currentUser, currentRole), {
        title: `Reorder — ${low.length} low-stock material${low.length > 1 ? 's' : ''}`,
        items
      });
    });
    rfqs.forEach(r => bindRfqCard(r, currentUser, currentRole, content));
  }
}

function purchRfqCard(r, canEdit) {
  const items = r.items || [];
  return `
  <div class="card" data-rfq="${r.id}" style="margin-bottom:12px"><div class="card-body">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div>
        <div style="font-weight:700">${escHtml(r.title || 'Untitled RFQ')}</div>
        <div style="font-size:12px;color:var(--text-muted)">${escHtml(r.rfqNo || '')} · Supplier: ${escHtml(r.supplier || '—')}</div>
        <div style="font-size:12px;color:var(--text-muted)">Requesting: ${escHtml(r.requestingDept || '—')}${r.neededBy ? ` · Needed by ${escHtml(r.neededBy)}` : ''}</div>
        ${r.deliverTo ? `<div style="font-size:12px;color:var(--text-muted)">Deliver to: ${escHtml(r.deliverTo)}</div>` : ''}
      </div>
      ${canEdit ? `<button class="btn-danger btn-sm rfq-del" data-id="${r.id}" data-label="${escHtml(r.title || 'RFQ')}" aria-label="Delete RFQ">${emojiIcon('trash-2',14)}</button>` : ''}
    </div>
    ${r.notes ? `<div style="font-size:12px;margin-top:6px">${escHtml(r.notes)}</div>` : ''}
    <div class="table-wrap" style="margin-top:10px"><table class="data-table table-cards no-toggle">
      <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th style="width:120px">Unit Price ₱</th><th style="text-align:right">Line Total</th></tr></thead>
      <tbody>
        ${items.map((it, i) => `<tr>
          <td data-label="Item">${escHtml(it.desc || '—')}</td>
          <td data-label="Qty">${Number(it.qty || 0)}</td>
          <td data-label="Unit">${escHtml(it.unit || '')}</td>
          <td data-label="Unit Price ₱">${canEdit
            ? `<input type="number" inputmode="decimal" step="0.01" min="0" class="rfq-price" data-i="${i}" value="${it.unitPrice != null ? it.unitPrice : ''}" style="width:100%;max-width:120px" placeholder="—"/>`
            : (it.unitPrice != null ? fmt(it.unitPrice) : '—')}</td>
          <td data-label="Line Total" style="text-align:right" class="rfq-line" data-i="${i}">${it.unitPrice != null ? '₱' + fmt((it.unitPrice || 0) * (it.qty || 0)) : '—'}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr><td colspan="4" style="text-align:right;font-weight:700">Total</td><td style="text-align:right;font-weight:700" class="rfq-total">₱${fmt(purchTotal(items))}</td></tr></tfoot>
    </table></div>
    ${canEdit ? `<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap">
      <button class="btn-secondary btn-sm rfq-save" data-id="${r.id}">Save Prices</button>
      <button class="btn-primary btn-sm rfq-convert" data-id="${r.id}">Convert to Purchase Request →</button>
    </div>` : ''}
  </div></div>`;
}

function bindRfqCard(r, currentUser, currentRole, content) {
  const cardEl = content.querySelector(`.card[data-rfq="${r.id}"]`);
  if (!cardEl) return;
  const items = (r.items || []).map(x => ({ ...x }));

  const recalc = () => {
    let total = 0;
    cardEl.querySelectorAll('.rfq-price').forEach(inp => {
      const i = +inp.dataset.i;
      const price = inp.value === '' ? null : (parseFloat(inp.value) || 0);
      items[i].unitPrice = price;
      const lineEl = cardEl.querySelector(`.rfq-line[data-i="${i}"]`);
      const lt = price != null ? price * (Number(items[i].qty) || 0) : null;
      if (lineEl) lineEl.textContent = lt != null ? '₱' + fmt(lt) : '—';
      if (lt != null) total += lt;
    });
    const tEl = cardEl.querySelector('.rfq-total');
    if (tEl) tEl.textContent = '₱' + fmt(total);
  };
  cardEl.querySelectorAll('.rfq-price').forEach(inp => inp.addEventListener('input', recalc));

  cardEl.querySelector('.rfq-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try {
      recalc();
      await db.collection('purchase_requisitions').doc(r.id).update({
        items, total: purchTotal(items),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      Notifs.success('Prices saved.');
    } catch (err) { Notifs.showToast('Save failed: ' + (err.message || err), 'error'); }
    finally { btn.disabled = false; }
  });

  cardEl.querySelector('.rfq-convert')?.addEventListener('click', async (e) => {
    recalc();
    if (!items.length || items.some(it => it.unitPrice == null || isNaN(it.unitPrice))) {
      Notifs.showToast('Enter a price for every item before converting.', 'error');
      return;
    }
    const btn = e.currentTarget; btn.disabled = true;
    try {
      // v14 prod-fixlist — atomic serial (same _counters-backed minter this file
      // already uses for delivery receipts/billing invoices) instead of deriving
      // the PR number from rfqNo via regex-replace, which inherited rfqNo's old
      // Date.now()-suffix collision risk. Independent counter, always unique.
      const prNo = await window.nextSerial('pr', 'PR');
      await db.collection('purchase_requisitions').doc(r.id).update({
        items, total: purchTotal(items), stage: 'pr', status: 'pending', prNo,
        approvalStatus: 'pending',            // v12 WS30 — enters the PO approval gate
        convertedAt: firebase.firestore.FieldValue.serverTimestamp(),
        convertedBy: currentUser.uid,
        convertedByName: window.userProfile?.displayName || currentUser.email
      });
      await notifyPoApprovers({ id: r.id, ...r, items, total: purchTotal(items), prNo })
        .catch(e2 => console.warn('[po notify]', e2));
      Notifs.success('Converted to Purchase Request — awaiting President/Manager approval.');
      renderRFQs(content, currentUser, currentRole);
    } catch (err) { Notifs.showToast('Convert failed: ' + (err.message || err), 'error'); btn.disabled = false; }
  });

  cardEl.querySelector('.rfq-del')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!(await confirmDialog({message:`Delete RFQ "${escHtml(btn.dataset.label)}"? This cannot be undone.`, danger:true, html:true}))) return;
    try {
      await db.collection('purchase_requisitions').doc(btn.dataset.id).delete();
      Notifs.success('Deleted.');
      renderRFQs(content, currentUser, currentRole);
    } catch (err) { Notifs.showToast('Delete failed: ' + (err.message || err), 'error'); }
  });
}

async function openRfqModal(currentUser, onDone, prefill) {
  prefill = prefill || {};
  // v14 tap-latency inversion — the inventory_items read that backs the per-row
  // item picker used to sit in front of openPage, so "＋ New RFQ" (and the bulk
  // "From low stock" generator) froze on the tap. Window first, picker after.
  // Title is static and the footer is static, so both are final immediately —
  // except that "Create RFQ" ships `disabled`, since its listener (and the item
  // rows it collects from) only exist once the renderer has run. Cancel is an
  // inline onclick and stays live throughout.
  const panel = openPage(`${emojiIcon('🛒',16)} New Request for Quotation`, window.skeletonHtml('rows'),
    `<button class="btn-primary" id="rfq-save" disabled>Create RFQ</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  const rfqBody = panel.querySelector('.page-panel-body');
  // Renderer body deliberately not re-indented — see openProjectBillingModal.
  await window.withLoadingAndError(rfqBody, async () => {
    // Soft-fail preserved verbatim: an unreadable inventory collection has always
    // meant "free-text items only", not an error screen — an RFQ is still fully
    // writable without the picker.
    let invItems = [];
    try {
      const isnap = await dbCachedGet('inventory_items', () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000);
      invItems = isnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
    } catch(_) {}
    return invItems;
  }, (invItems) => {
  if (!panelLive(panel)) return;   // closed mid-flight — fill nothing, wire nothing
  const riItemOpts = (sel='') => `<option value="">— Free text / new —</option>` +
    invItems.map(i => `<option value="${i.id}" data-name="${escHtml(i.name||'')}" data-unit="${escHtml(i.unit||'')}" ${sel===i.id?'selected':''}>${escHtml(i.name||'')}</option>`).join('');
  const deptOpts = Object.keys(window.DEPARTMENTS || {})
    .filter(k => k !== 'Brilliant Steel' && k !== 'Partners')
    .map(k => `<option>${escHtml(k)}</option>`).join('');
  rfqBody.innerHTML = `
    <div class="form-row">
      <div class="form-group"><label>Title / Purpose *</label><input id="rfq-title" value="${escHtml(prefill.title||'')}" placeholder="e.g. Steel sheets for Job #123"/></div>
      <div class="form-group"><label>Supplier</label><input id="rfq-supplier" placeholder="Supplier name (optional)"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Requesting Department</label><select id="rfq-dept">${deptOpts}</select></div>
      <div class="form-group"><label>Needed By</label><input id="rfq-needed" type="date"/></div>
    </div>
    <div class="form-group"><label>Deliver To (address / site)</label><input id="rfq-deliver" placeholder="e.g. Barro Industries — La Union Plant, Brgy. …"/></div>
    <div class="form-group"><label>Notes</label><textarea id="rfq-notes" rows="2" placeholder="Optional"></textarea></div>
    <label style="font-size:12px;font-weight:700;display:block;margin-bottom:4px">Items</label>
    <div id="rfq-items"></div>
    <button class="btn-secondary btn-sm" id="rfq-add-item" type="button" style="margin-top:6px">+ Add item</button>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [rfqBody] });

  // ⚠ SCOPED TO THIS PANEL, NOT document — same rule as the rfq-save release at
  // the bottom of this renderer. The bulk "From low stock" generator can open
  // this window right after another one closes, and an unscoped read would file
  // the PREVIOUS RFQ's title/supplier/dept/items under a freshly minted serial.
  const $rfq = (id) => panel.querySelector('#' + id);
  const itemsWrap = $rfq('rfq-items');
  const addRow = (desc = '', qty = '', unit = '', itemId = '') => {
    const row = document.createElement('div');
    row.className = 'rfq-item-row';
    row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap';
    row.innerHTML = `
      <select class="ri-item" title="Bind to an inventory item so receiving lands automatically" style="flex:1 1 100%;min-width:0;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)">${riItemOpts(itemId)}</select>
      <input class="ri-desc" placeholder="Item description (supplier wording ok)" value="${escHtml(desc)}" style="flex:2;min-width:0"/>
      <input class="ri-qty" type="number" inputmode="decimal" min="0" placeholder="Qty" value="${qty}" style="flex:0 0 60px;width:60px"/>
      <input class="ri-unit" placeholder="Unit" value="${escHtml(unit)}" style="flex:0 0 64px;width:64px"/>
      <button class="btn-danger btn-sm ri-del" type="button" title="Remove" aria-label="Remove item">${emojiIcon('✕',16)}</button>`;
    if (window.lucide) lucide.createIcons({ nodes: [row] });
    row.querySelector('.ri-del').addEventListener('click', () => row.remove());
    row.querySelector('.ri-item').addEventListener('change', e => {
      const opt = e.target.selectedOptions[0];
      if (!opt || !opt.value) return;
      const descEl = row.querySelector('.ri-desc'), unitEl = row.querySelector('.ri-unit');
      if (!descEl.value.trim()) descEl.value = opt.dataset.name || '';
      if (!unitEl.value.trim()) unitEl.value = opt.dataset.unit || '';
    });
    itemsWrap.appendChild(row);
  };
  if (Array.isArray(prefill.items) && prefill.items.length) prefill.items.forEach(it => addRow(it.desc, it.qty, it.unit, it.itemId || ''));
  else { addRow(); addRow(); }
  $rfq('rfq-add-item').addEventListener('click', () => addRow());

  $rfq('rfq-save').addEventListener('click', async () => {
    const title = $rfq('rfq-title').value.trim();
    if (!title) { Notifs.showToast('Enter a title.', 'error'); return; }
    const items = [...itemsWrap.querySelectorAll('.rfq-item-row')].map(row => {
      const sel = row.querySelector('.ri-item');
      const itemId = sel.value || null;
      let desc = row.querySelector('.ri-desc').value.trim();
      if (!desc && itemId) desc = sel.selectedOptions[0]?.dataset.name || '';
      return { itemId, desc,
        qty: parseFloat(row.querySelector('.ri-qty').value) || 0,
        unit: row.querySelector('.ri-unit').value.trim(),
        unitPrice: null };
    }).filter(it => it.desc || it.itemId);
    if (!items.length) { Notifs.showToast('Add at least one item.', 'error'); return; }
    const btn = $rfq('rfq-save'); btn.disabled = true;
    try {
      // v14 prod-fixlist — atomic serial instead of `RFQ-${yr}-${Date.now().slice(-4)}`,
      // which repeats every 10s and can collide on a busy procurement day (or via
      // the bulk "From low stock" generator) — the collision used to propagate
      // into the derived PR number and the CDJ reference used for duplicate
      // detection in recordPurchaseDisbursement.
      const rfqNo = await window.nextSerial('rfq', 'RFQ');
      await db.collection('purchase_requisitions').add({
        rfqNo, title,
        supplier: $rfq('rfq-supplier').value.trim(),
        requestingDept: $rfq('rfq-dept').value,
        neededBy: $rfq('rfq-needed').value,
        deliverTo: $rfq('rfq-deliver').value.trim(),
        notes: $rfq('rfq-notes').value.trim(),
        items, stage: 'rfq', total: 0, status: 'quoting',
        createdBy: currentUser.uid,
        createdByName: window.userProfile?.displayName || currentUser.email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal();
      Notifs.success('RFQ created.');
      onDone && onDone();
    } catch (err) { Notifs.showToast('Create failed: ' + (err.message || err), 'error'); btn.disabled = false; }
  });
  // Form, item rows and listener are real now — release Create RFQ (panel-scoped;
  // see the note at openProjectBillingModal).
  const rfqSaveBtn = panel.querySelector('#rfq-save');
  if (rfqSaveBtn) rfqSaveBtn.disabled = false;
  }, { skeleton:'rows' });
}

// v12 WS30 — PO approval state with legacy grandfather: PRs converted before the
// gate shipped carry no approvalStatus and stay valid ('legacy' ≈ approved).
function poState(p) { return p.approvalStatus || ((p.stage === 'pr') ? 'legacy' : ''); }
function poApproved(p) { const s = poState(p); return s === 'approved' || s === 'legacy'; }

// ── Purchase Request list (stage === 'pr') ────────
// Shared by the Purchasing dept (editable status) and the Finance → Purchases
// tab (opts.viewOnly hides controls; Firestore rules also block Finance writes).
const PURCH_STAT = window.PURCH_STAT = {
  pending:  { label: 'Pending',  badge: 'badge-orange' },
  ordered:  { label: 'Ordered',  badge: 'badge-blue' },
  received: { label: 'Received', badge: 'badge-green' }
};

// Export all purchase requests (one row per PR) to CSV for records / finance.
window.exportPurchasesCSV = function() {
  const prs = window._purchPRs || [];
  const tot = p => p.total != null ? p.total : (typeof purchTotal === 'function' ? purchTotal(p.items) : 0);
  const dt = p => p.convertedAt?.toDate ? window.bizDate(p.convertedAt.toDate()) : (p.createdAt?.toDate ? window.bizDate(p.createdAt.toDate()) : '');
  window.exportCSV('purchase-requests', prs, [
    { key:'prNo', label:'PO No', get:p=>p.prNo||p.rfqNo||'' },
    { key:'date', label:'Date', get:dt },
    { key:'supplier', label:'Supplier', get:p=>p.supplier||'' },
    { key:'title', label:'Title', get:p=>p.title||'' },
    { key:'requestingDept', label:'Requesting Dept', get:p=>p.requestingDept||'' },
    { key:'status', label:'Status', get:p=>p.status||'pending' },
    { key:'total', label:'Total', get:tot },
    { key:'submittedToFinance', label:'Sent to Finance', get:p=>p.submittedToFinance?'yes':'no' },
    { key:'recordedToFinance', label:'Recorded', get:p=>p.recordedToFinance?'yes':'no' }
  ]);
};

async function renderPurchaseRequests(content, currentUser, currentRole, opts = {}) {
  const canEdit = !opts.viewOnly && canEditDept('Purchasing');
  const canRecord = !!opts.financeView && isFinancePriv(); // Finance/admin may post to the books
  const canApprovePO = ['president','manager'].includes(currentRole);   // mirrors APPROVAL_CAPS['po-approval']
  // v13 review: client-side stage filter retained (see renderRFQs note) — a
  // server where('stage','==','pr') would hide any stage-less legacy PR.
  const snap = await db.collection('purchase_requisitions').orderBy('createdAt','desc').get();
  const prs = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(d => d.stage === 'pr');

  // ── Spend summary ──
  const totOf = p => p.total != null ? p.total : purchTotal(p.items);
  const totalSpend = prs.reduce((s,p)=>s+totOf(p),0);
  const openSpend = prs.filter(p=>p.status!=='received').reduce((s,p)=>s+totOf(p),0);
  const ym = (window.bizDate?window.bizDate():new Date().toISOString().slice(0,10)).slice(0,7);
  const dateOf = p => (p.convertedAt?.toDate ? window.bizDate(p.convertedAt.toDate()) : (p.createdAt?.toDate ? window.bizDate(p.createdAt.toDate()) : ''));
  const monthSpend = prs.filter(p=>dateOf(p).slice(0,7)===ym).reduce((s,p)=>s+totOf(p),0);
  const bySupplier = {}; prs.forEach(p=>{ const k=(p.supplier||'—').trim()||'—'; bySupplier[k]=(bySupplier[k]||0)+totOf(p); });
  const topSup = Object.entries(bySupplier).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const supMax = topSup.reduce((m,[,v])=>Math.max(m,v),0)||1;
  window._purchPRs = prs; // for CSV export
  const summary = prs.length ? `
    <div style="display:flex;justify-content:flex-end;margin-bottom:6px"><button class="btn-secondary btn-sm" onclick="window.exportPurchasesCSV()" title="Export all purchase requests to CSV">${emojiIcon('⬇',16)} CSV</button></div>
    <div class="kpi-row" style="margin-bottom:10px">
      <div class="kpi-card"><div class="kpi-label">Purchase Requests</div><div class="kpi-value">${prs.length}</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Open (not received)</div><div class="kpi-value" style="font-size:15px">₱${fmt(openSpend)}</div></div>
      <div class="kpi-card green"><div class="kpi-label">This Month</div><div class="kpi-value" style="font-size:15px">₱${fmt(monthSpend)}</div></div>
      <div class="kpi-card accent"><div class="kpi-label">Total Committed</div><div class="kpi-value" style="font-size:15px">₱${fmt(totalSpend)}</div></div>
    </div>
    ${topSup.length?`<div class="card" style="margin-bottom:12px"><div class="card-header"><h3 style="font-size:13px">Top Suppliers by Spend</h3></div><div class="card-body">
      ${topSup.map(([k,v])=>`<div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>${escHtml(k)}</span><span style="font-weight:700">₱${fmt(v)}</span></div>
        <div style="height:7px;background:var(--surface2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${Math.round(v/supMax*100)}%;background:var(--primary);border-radius:4px"></div></div>
      </div>`).join('')}
    </div></div>`:''}` : '';

  const filterBar = prs.length > 3 ? `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      ${window.chipTabs(['all','pending','ordered','received'].map(s=>({key:s,label:s==='all'?'All':PURCH_STAT[s].label})), 'all', {cls:'pr-filter-tabs'})}
      <input id="pr-search" placeholder="Search supplier / title / PO#" style="flex:1;min-width:140px;padding:7px 11px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)"/>
    </div>` : '';

  content.innerHTML = `
    ${summary}
    ${opts.financeView ? (() => {
      const unrec = prs.filter(x => x.status === 'received' && !x.recordedToFinance).length;
      return `${unrec ? `<div class="alert-banner" style="margin-bottom:10px"><span>${emojiIcon('⏳',16)} <strong>${unrec} received purchase${unrec>1?'s':''} not yet recorded</strong> — stock has landed but the books haven't. Use Record as Disbursement below.</span></div>` : ''}
      <p style="font-size:12px;color:var(--text-muted);margin:0 0 12px">Purchases raised by the Purchasing department. Use <strong>Record as Disbursement</strong> to post one into the Cash Disbursement Journal.</p>`;
    })() : ''}
    ${filterBar}
    <div id="pr-empty-note" style="display:none;font-size:12px;color:var(--text-muted);padding:12px">No purchase requests match.</div>
    ${!prs.length
      ? window.renderEmptyState({icon:'🧾',title:'No purchase requests yet',hint:canEdit ? 'Convert a priced RFQ into a purchase request.' : 'None have been raised yet.'})
      : prs.map(p => {
        const st = PURCH_STAT[p.status || 'pending'] || PURCH_STAT.pending;
        const searchStr = ((p.title||'')+' '+(p.supplier||'')+' '+(p.prNo||p.rfqNo||'')+' '+(p.requestingDept||'')).toLowerCase().replace(/"/g,'');
        return `<div class="card pr-row" data-pr="${p.id}" data-status="${p.status||'pending'}" data-search="${escHtml(searchStr)}" style="margin-bottom:12px"><div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div>
              <div style="font-weight:700">${escHtml(p.title || 'Purchase Request')}</div>
              <div style="font-size:12px;color:var(--text-muted)">${escHtml(p.prNo || p.rfqNo || '')} · Supplier: ${escHtml(p.supplier || '—')}</div>
              <div style="font-size:12px;color:var(--text-muted)">Requesting: ${escHtml(p.requestingDept || '—')}${p.neededBy ? ` · Needed by ${escHtml(p.neededBy)}` : ''}</div>
              ${p.deliverTo ? `<div style="font-size:12px;color:var(--text-muted)">Deliver to: ${escHtml(p.deliverTo)}</div>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
              <span class="badge ${st.badge}">${st.label}</span>
              ${p.submittedToFinance ? `<span class="badge badge-green" style="font-size:9px">${emojiIcon('🧾',9)} Sent to Finance</span>` : ''}
              ${poState(p)==='pending' ? `<span class="badge badge-orange" style="font-size:9px">${emojiIcon('🔒',9)} Awaiting approval</span>`
                : poState(p)==='rejected' ? `<span class="badge badge-red" style="font-size:9px">${emojiIcon('✗',9)} Rejected</span>`
                : poState(p)==='approved' ? `<span class="badge badge-green" style="font-size:9px">${emojiIcon('✓',9)} Approved · ${escHtml(p.approvedByName||'')}</span>` : ''}
              ${p.status==='received' && !p.recordedToFinance ? `<span class="badge badge-orange" style="font-size:9px">${emojiIcon('⏳',9)} Awaiting Finance record</span>` : ''}
            </div>
          </div>
          <div class="table-wrap" style="margin-top:10px"><table class="data-table table-cards no-toggle">
            <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Line Total</th></tr></thead>
            <tbody>${(p.items || []).map(it => `<tr>
              <td data-label="Item">${escHtml(it.desc || '—')}</td>
              <td data-label="Qty">${Number(it.qty || 0)}</td>
              <td data-label="Unit">${escHtml(it.unit || '')}</td>
              <td data-label="Unit Price" style="text-align:right">₱${fmt(it.unitPrice || 0)}</td>
              <td data-label="Line Total" style="text-align:right">₱${fmt((it.unitPrice || 0) * (it.qty || 0))}</td>
            </tr>`).join('')}</tbody>
            <tfoot><tr><td colspan="4" style="text-align:right;font-weight:700">Total</td><td style="text-align:right;font-weight:700">₱${fmt(p.total != null ? p.total : purchTotal(p.items))}</td></tr></tfoot>
          </table></div>
          ${p.notes ? `<div style="font-size:12px;margin-top:6px;color:var(--text-muted)">${escHtml(p.notes)}</div>` : ''}
          ${poState(p)==='rejected' && p.rejectedReason ? `<div style="font-size:12px;margin-top:6px;color:var(--danger,#c0392b)">${emojiIcon('✗',12)} Rejected by ${escHtml(p.rejectedByName||'')}: ${escHtml(p.rejectedReason)}</div>` : ''}
          ${p.submittedToFinance && p.submittedToFinanceByName ? `<div style="font-size:11px;margin-top:6px;color:var(--success,#1b8a3a)">${emojiIcon('🧾',11)} Submitted to Finance by ${escHtml(p.submittedToFinanceByName)}${p.submittedToFinanceAt && p.submittedToFinanceAt.toDate ? ` · ${p.submittedToFinanceAt.toDate().toLocaleDateString('en-PH')}` : ''}</div>` : ''}
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap">
            ${poState(p) !== 'rejected' ? `<button class="btn-secondary btn-sm pr-print" data-id="${p.id}">${emojiIcon('🖨',16)} Print PO</button>` : ''}
            ${p.status === 'received' ? `<button class="btn-secondary btn-sm pr-rr" data-id="${p.id}">${emojiIcon('📦',16)} Receiving Report</button>` : ''}
            ${canApprovePO && poState(p) === 'pending' ? `
              <button class="btn-success btn-sm po-approve" data-id="${p.id}">${emojiIcon('✓',16)} Approve PO</button>
              <button class="btn-danger btn-sm po-reject" data-id="${p.id}">${emojiIcon('✗',16)} Reject</button>` : ''}
            ${canEdit && poState(p) === 'rejected' ? `<button class="btn-secondary btn-sm po-revert" data-id="${p.id}">↩ Revert to RFQ</button>` : ''}
            ${canEdit && poApproved(p) ? `
              ${p.status !== 'ordered' && p.status !== 'received' ? `<button class="btn-secondary btn-sm pr-stat" data-id="${p.id}" data-stat="ordered">Mark Ordered</button>` : ''}
              ${p.status !== 'received' ? `<button class="btn-primary btn-sm pr-stat" data-id="${p.id}" data-stat="received">Mark Received</button>` : ''}
              ${(p.receiveUnmatched||[]).length ? `<button class="btn-secondary btn-sm pr-resolve" data-id="${p.id}">${emojiIcon('⚠',16)} Resolve ${p.receiveUnmatched.length} unmatched</button>` : ''}
              ${(p.status === 'ordered' || p.status === 'received') && !p.submittedToFinance ? `<button class="btn-primary btn-sm pr-submit-fin" data-id="${p.id}">${emojiIcon('📩',16)} Submit to Finance</button>` : ''}
            ` : ''}
            ${canRecord && !p.recordedToFinance && poApproved(p) ? `<button class="btn-primary btn-sm pr-record" data-id="${p.id}">${emojiIcon('🧾',16)} Record as Disbursement</button>` : ''}
            ${p.recordedToFinance ? `<span style="font-size:11px;color:var(--success,#1b8a3a);align-self:center">${emojiIcon('✓',11)} Recorded in journal</span>` : ''}
          </div>
        </div></div>`;
      }).join('')}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [content] });

  content.querySelectorAll('.pr-print').forEach(btn => btn.addEventListener('click', () => {
    const p = prs.find(x => x.id === btn.dataset.id);
    if (p) printPurchaseOrder(p);
  }));

  // ── Filter + search (client-side show/hide) ──
  let _prFilter = 'all';
  const applyPrFilter = () => {
    const q = (content.querySelector('#pr-search')?.value || '').trim().toLowerCase();
    let shown = 0;
    content.querySelectorAll('.pr-row').forEach(row => {
      const okStatus = _prFilter === 'all' || (row.dataset.status || 'pending') === _prFilter;
      const okSearch = !q || (row.dataset.search || '').includes(q);
      const vis = okStatus && okSearch;
      row.style.display = vis ? '' : 'none';
      if (vis) shown++;
    });
    const note = content.querySelector('#pr-empty-note');
    if (note) note.style.display = shown ? 'none' : '';
  };
  window.bindChipTabs(content, (key) => { _prFilter = key; applyPrFilter(); });
  content.querySelector('#pr-search')?.addEventListener('input', applyPrFilter);

  const redo = () => renderPurchaseRequests(content, currentUser, currentRole, opts);

  content.querySelectorAll('.po-approve').forEach(btn => btn.addEventListener('click', async () => {
    const p = prs.find(x => x.id === btn.dataset.id); if (!p) return;
    if (!(await confirmDialog({ message: `Approve ${escHtml(p.prNo || '')} — ${escHtml(p.supplier || '')} for ₱${fmt(p.total != null ? p.total : purchTotal(p.items))}? Your name will print on the "Approved by" line.`, html: true }))) return;
    btn.disabled = true;
    try { await window.approvePurchaseOrder(p.id); Notifs.success('PO approved ✓'); redo(); }
    catch (err) { Notifs.showToast('Approve failed: ' + (err.message || err), 'error'); btn.disabled = false; }
  }));
  content.querySelectorAll('.po-reject').forEach(btn => btn.addEventListener('click', async () => {
    const p = prs.find(x => x.id === btn.dataset.id); if (!p) return;
    const reason = prompt('Reason for rejection (shown to Purchasing):') ;
    if (reason === null) return;                       // cancelled
    btn.disabled = true;
    try { await window.rejectPurchaseOrder(p.id, reason); Notifs.error('PO rejected.'); redo(); }
    catch (err) { Notifs.showToast('Reject failed: ' + (err.message || err), 'error'); btn.disabled = false; }
  }));
  content.querySelectorAll('.po-revert').forEach(btn => btn.addEventListener('click', async () => {
    const p = prs.find(x => x.id === btn.dataset.id); if (!p) return;
    if (!(await confirmDialog({ message: `Revert ${escHtml(p.prNo || '')} to an RFQ to fix and resubmit? The rejection note stays on record until re-converted.`, html: true }))) return;
    btn.disabled = true;
    try {
      const FV = firebase.firestore.FieldValue;
      await db.collection('purchase_requisitions').doc(p.id).update({
        stage: 'rfq', status: 'quoting',
        approvalStatus: FV.delete(), approvedBy: FV.delete(), approvedByName: FV.delete(),
        approvedByTitle: FV.delete(), approvedAt: FV.delete(),
        rejectedBy: FV.delete(), rejectedByName: FV.delete(), rejectedAt: FV.delete(), rejectedReason: FV.delete(),
        updatedAt: FV.serverTimestamp()
      });
      Notifs.success('Reverted to RFQ — edit it in the Request for Quotation tab.');
      redo();
    } catch (err) { Notifs.showToast('Revert failed: ' + (err.message || err), 'error'); btn.disabled = false; }
  }));
  content.querySelectorAll('.pr-rr').forEach(btn => btn.addEventListener('click', () => {
    const p = prs.find(x => x.id === btn.dataset.id);
    if (p) printReceivingReport(p);
  }));

  // Purchasing → hand the completed purchase to Finance for recordkeeping.
  if (canEdit) content.querySelectorAll('.pr-submit-fin').forEach(btn => btn.addEventListener('click', async () => {
    const p = prs.find(x => x.id === btn.dataset.id); if (!p) return;
    if (!(await confirmDialog({message:`Submit "${escHtml(p.title || p.prNo)}" (₱${fmt(p.total != null ? p.total : purchTotal(p.items))}) to Finance for recordkeeping?`, html:true}))) return;
    btn.disabled = true;
    try {
      await db.collection('purchase_requisitions').doc(p.id).update({
        submittedToFinance: true,
        submittedToFinanceAt: firebase.firestore.FieldValue.serverTimestamp(),
        submittedToFinanceBy: currentUser.uid,
        submittedToFinanceByName: window.userProfile?.displayName || currentUser.email
      });
      await notifyFinanceTeam({
        title: '🧾 Purchase for Recordkeeping',
        body: `${p.prNo || p.rfqNo || 'A purchase'} — ${p.supplier || 'supplier'} · ₱${fmt(p.total != null ? p.total : purchTotal(p.items))}. See Finance → Purchases.`,
        icon: '🧾', type: 'purchase_submitted', link: 'dept:Finance', dedupKey: `pr-fin-${p.id}`
      });
      Notifs.success('Submitted to Finance ✓');
      redo();
    } catch (err) { Notifs.showToast('Submit failed: ' + (err.message || err), 'error'); btn.disabled = false; }
  }));

  // Finance → post the purchase into the cash disbursement journal.
  if (canRecord) content.querySelectorAll('.pr-record').forEach(btn => btn.addEventListener('click', () => {
    const p = prs.find(x => x.id === btn.dataset.id); if (!p) return;
    recordPurchaseDisbursement(p, currentUser, redo);
  }));

  if (canEdit) content.querySelectorAll('.pr-stat').forEach(btn => btn.addEventListener('click', async () => {
    const p0 = prs.find(x => x.id === btn.dataset.id);
    if (p0 && !poApproved(p0)) { Notifs.showToast('This PO needs President/Manager approval first.', 'error'); btn.disabled = false; return; }
    btn.disabled = true;
    try {
      const p = prs.find(x => x.id === btn.dataset.id);
      await db.collection('purchase_requisitions').doc(btn.dataset.id).update({
        status: btn.dataset.stat,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      // On receive, auto-match the purchased lines into inventory (once).
      if (btn.dataset.stat === 'received' && p && !p.receivedToInventory) {
        const res = await receivePurchaseIntoInventory(p).catch(e => { console.warn('[receive→inventory]', e); return null; });
        if (res) {
          // Only a FULLY-landed PR gets the done flag; leftovers go to the resolver.
          await db.collection('purchase_requisitions').doc(p.id).update({
            receivedToInventory: res.unmatched.length === 0,
            receiveUnmatched: res.unmatched,
            receivedAt: firebase.firestore.FieldValue.serverTimestamp(),      // WS30 — RR audit
            receivedBy: currentUser.uid,                                       // WS30
            receivedByName: window.userProfile?.displayName || currentUser.email // WS30
          }).catch(()=>{});
          // WS30 — receiving is never silent to the books: auto-submit to Finance.
          if (!p.submittedToFinance) {
            await db.collection('purchase_requisitions').doc(p.id).update({
              submittedToFinance: true,
              submittedToFinanceAt: firebase.firestore.FieldValue.serverTimestamp(),
              submittedToFinanceBy: currentUser.uid,
              submittedToFinanceByName: window.userProfile?.displayName || currentUser.email
            }).catch(()=>{});
            await notifyFinanceTeam({
              title: '📦 Purchase Received — record it',
              body: `${p.prNo || p.rfqNo || 'A purchase'} — ${p.supplier || 'supplier'} · ₱${fmt(p.total != null ? p.total : purchTotal(p.items))} was received into stock. Record it in Finance → Purchases.`,
              icon: '📦', type: 'purchase_submitted', link: 'dept:Finance', dedupKey: `pr-fin-${p.id}`
            }).catch(()=>{});
          }
          Notifs.success(res.unmatched.length
            ? `Received ${res.matched} line${res.matched===1?'':'s'} into stock — ${res.unmatched.length} not in inventory. Tap “⚠ Resolve” on the PR.`
            : `Received. ${res.matched} item${res.matched===1?'':'s'} added to inventory ✓`);
        } else { Notifs.success('Status updated.'); }
      } else {
        Notifs.success('Status updated.');
      }
      renderPurchaseRequests(content, currentUser, currentRole, opts);
    } catch (err) { Notifs.showToast('Update failed: ' + (err.message || err), 'error'); btn.disabled = false; }
  }));

  if (canEdit) content.querySelectorAll('.pr-resolve').forEach(btn => btn.addEventListener('click', () => {
    openReceiveResolver(prs.find(x => x.id === btn.dataset.id), currentUser, redo);
  }));
}

// Receive a purchase's line items into inventory. Match order: line.itemId
// (exact, from the RFQ item picker) first, then case-insensitive trimmed name
// (legacy free-text lines and in-flight pre-WS29 PRs). Each matched line runs
// in its OWN transaction (read current qty+unitCost → weighted-average cost →
// write qty/unitCost AND the stock_movements row atomically). Movement doc ids
// are deterministic (RECV_{prId}_{lineIdx}) so a retried "Mark Received" click
// can never double-receive a line. Unmatched lines are RETURNED with their
// items[] index so the resolver can finish the job — never silently dropped.
async function receivePurchaseIntoInventory(p) {
  const all = p.items || [];
  const snap = await dbCachedGet('inventory_items', () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000);
  const byName = {}, byId = {};
  snap.docs.forEach(d => {
    byId[d.id] = d;
    const n = (d.data().name || '').trim().toLowerCase(); if (n) byName[n] = d;
  });
  let matched = 0; const unmatched = [];
  for (let i = 0; i < all.length; i++) {
    const it = all[i];
    if (!it || !(it.desc || it.itemId) || (Number(it.qty) || 0) <= 0) continue;
    const hit = (it.itemId && byId[it.itemId]) || byName[(it.desc || '').trim().toLowerCase()];
    if (!hit) {
      unmatched.push({ i, desc: it.desc || '', qty: Number(it.qty) || 0, unit: it.unit || '',
                       unitPrice: it.unitPrice != null ? Number(it.unitPrice) : null });
      continue;
    }
    // true = applied, false = already received (idempotent no-op — still landed),
    // null = transaction FAILED → leave for a retry/resolver pass, not "landed".
    const ok = await receiveLineIntoItem(p, it, i, hit.ref)
      .catch(e => { console.warn('[receive line]', e); return null; });
    if (ok === null) unmatched.push({ i, desc: it.desc || '', qty: Number(it.qty) || 0, unit: it.unit || '',
                                      unitPrice: it.unitPrice != null ? Number(it.unitPrice) : null });
    else matched++;
  }
  if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('inventory_items');
  return { matched, unmatched };
}

// One PR line → one inventory item, atomically: qty add + weighted-average
// cost + movement row in a single transaction. Returns true if applied,
// false if this exact line was already received (deterministic movement id).
async function receiveLineIntoItem(p, it, lineIdx, itemRef) {
  const movRef = db.collection('stock_movements').doc(`RECV_${p.id}_${lineIdx}`);
  return db.runTransaction(async tx => {
    const movSnap  = await tx.get(movRef);
    if (movSnap.exists) return false;                 // already received — idempotent
    const itemSnap = await tx.get(itemRef);
    if (!itemSnap.exists) throw new Error('Inventory item no longer exists');
    const cur     = itemSnap.data();
    const recvQty = Number(it.qty) || 0;
    const price   = (it.unitPrice != null && (Number(it.unitPrice) || 0) > 0) ? Number(it.unitPrice) : null;
    const onHand  = Math.max(0, Number(cur.qty) || 0);   // negative stock contributes nothing to WAC
    const oldCost = Number(cur.unitCost) || 0;
    // Weighted-average cost (v12 WS29 — replaces the flat latest-price overwrite).
    // Degenerates to the new price on stockout or when no prior cost exists.
    const newCost = price == null ? null
      : (onHand > 0 && oldCost > 0)
        ? (onHand * oldCost + recvQty * price) / (onHand + recvQty)
        : price;
    const upd = {
      qty: (Number(cur.qty) || 0) + recvQty,          // explicit add — we hold the read, no blind increment
      lastReceivedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (newCost != null) upd.unitCost = newCost;      // never let a blank/zero line wipe the cost (kept)
    if (p.supplier && !(cur.supplier || '').trim()) upd.supplier = p.supplier;
    tx.update(itemRef, upd);
    tx.set(movRef, window.buildStockMovement({
      itemId: itemRef.id, itemName: cur.name || it.desc || '',
      type: 'in', qty: recvQty, source: 'receive',
      refNumber: p.prNo || p.rfqNo || p.id,
      note: `Received ${p.prNo || p.rfqNo || ''}${p.supplier ? ' — ' + p.supplier : ''}`.trim(),
      unitCost: price, qtyAfter: upd.qty
    }));
    return true;
  });
}

// Finish receiving a PR whose lines didn't auto-match: bind each leftover to an
// existing item or create a new one, then run the SAME idempotent per-line
// receive transaction. receivedToInventory flips true when the list empties.
async function openReceiveResolver(p, currentUser, onDone) {
  const rows = (p.receiveUnmatched || []);
  // This existence check STAYS in front of openPage. With nothing left to
  // resolve there is no window to show at all, and opening one on the tap only
  // to yank it away is worse than the (zero-await, already-instant) early
  // return it has always been.
  if (!rows.length) return;
  // v14 tap-latency inversion — the inventory_items read that populates every
  // row's "bind to item" <select> used to precede openPage, so tapping
  // "⚠ Resolve" on a PR did nothing visible until it resolved.
  // Title is built from `p` (already in hand) and the footer is static.
  // Nothing here ships `disabled`, unlike the other converted windows in this
  // file: this footer holds ONLY Close (an inline onclick, live from frame one),
  // and the real actions are the per-row "Receive this line →" buttons, which do
  // not exist at all until the fill renders them — so there is no live-looking
  // dead control to guard against.
  const panel = openPage(`${emojiIcon('⚠',16)} Resolve receipt — ${escHtml(p.prNo || p.rfqNo || '')}`, window.skeletonHtml('rows'),
    `<button class="btn-secondary" onclick="closeModal()">Close</button>`);
  const rcvBody = panel.querySelector('.page-panel-body');
  // Renderer body deliberately not re-indented — see openProjectBillingModal.
  await window.withLoadingAndError(rcvBody,
    () => dbCachedGet('inventory_items', () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000),
    (snap) => {
  if (!panelLive(panel)) return;   // closed mid-flight — fill nothing, wire nothing
  const inv = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const opts = sel => `<option value="">— Choose action —</option><option value="__new__">＋ Create new inventory item</option>` +
    inv.map(i => `<option value="${i.id}" ${sel===i.id?'selected':''}>${escHtml(i.name||'')} (${Number(i.qty||0).toLocaleString('en-PH')} ${escHtml(i.unit||'')})</option>`).join('');
  rcvBody.innerHTML = `
    <p style="font-size:12px;color:var(--text-muted)">These purchased lines matched no inventory item by name. Bind each to an existing item, or create a new one — quantities and weighted-average cost post the moment you resolve a line.</p>
    ${rows.map((r, k) => `<div class="rcv-row" data-k="${k}" style="border:1px solid var(--border);border-radius:9px;padding:10px;margin-bottom:8px">
      <div style="font-weight:600">${escHtml(r.desc || '—')} <span style="font-weight:400;color:var(--text-muted)">· ${Number(r.qty||0)} ${escHtml(r.unit||'')}${r.unitPrice!=null?` @ ₱${fmt(r.unitPrice)}`:''}</span></div>
      <select class="rcv-target" style="width:100%;margin-top:6px;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)">${opts()}</select>
      <button class="btn-primary btn-sm rcv-apply" style="margin-top:6px">Receive this line →</button>
    </div>`).join('')}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [rcvBody] });
  // Scoped to THIS panel's body instead of the whole document (the old
  // `document.querySelectorAll`). openPage keeps the panel it stacks over alive
  // underneath as `.page-under`, and the tail of this very handler re-opens the
  // resolver for the remaining lines while the outgoing panel is still mid-
  // teardown — so a document-wide sweep can bind a second listener onto the
  // dying panel's buttons. Scoping costs nothing in coverage: every .rcv-apply
  // this call renders was just written into rcvBody on the line above.
  rcvBody.querySelectorAll('.rcv-apply').forEach(applyBtn => applyBtn.addEventListener('click', async e => {
    const rowEl = e.currentTarget.closest('.rcv-row');
    const k = +rowEl.dataset.k, r = rows[k];
    const choice = rowEl.querySelector('.rcv-target').value;
    if (!choice) { Notifs.showToast('Choose an item or “Create new”.', 'error'); return; }
    e.currentTarget.disabled = true;
    try {
      let itemRef;
      if (choice === '__new__') {
        itemRef = await db.collection('inventory_items').add({
          name: r.desc, kind: 'material', unit: r.unit || '', category: '',
          qty: 0, reorderLevel: 0, unitCost: 0,
          supplier: p.supplier || '', supplierContact: '',
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        window.logAudit && window.logAudit('create', 'inventory_item', itemRef.id, { name: r.desc, via: 'receive-resolver' });
      } else {
        itemRef = db.collection('inventory_items').doc(choice);
      }
      await receiveLineIntoItem(p, { qty: r.qty, unitPrice: r.unitPrice, desc: r.desc }, r.i, itemRef);
      const remaining = rows.filter((_, j) => j !== k);
      await db.collection('purchase_requisitions').doc(p.id).update({
        receiveUnmatched: remaining, receivedToInventory: remaining.length === 0
      });
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('inventory_items');
      Notifs.success('Line received into stock ✓');
      closeModal(); onDone && onDone();
      if (remaining.length) openReceiveResolver({ ...p, receiveUnmatched: remaining }, currentUser, onDone);
    } catch (ex) { Notifs.showToast('Failed: ' + (ex.message || ex), 'error'); e.currentTarget.disabled = false; }
  }));
  }, { skeleton:'rows' });
}

// Notify the Finance team (Finance-dept members + Accountant role) and the
// President/owner. De-duplicated by uid so nobody is double-pinged.
async function notifyFinanceTeam(data) {
  const uids = new Set();
  const snaps = await Promise.all([
    db.collection('users').where('department', '==', 'Finance').get().catch(() => ({ docs: [] })),
    db.collection('users').where('departments', 'array-contains', 'Finance').get().catch(() => ({ docs: [] })),
    db.collection('users').where('role', '==', 'finance').get().catch(() => ({ docs: [] }))
  ]);
  snaps.forEach(s => s.docs.forEach(d => uids.add(d.id)));
  await Promise.all([...uids].map(uid => safeNotify(() => Notifs.send(uid, data))));
  await safeNotify(() => Notifs.sendToOwner(data));
}

// Notify the people who can approve POs (President + all managers). Deduped by dedupKey.
async function notifyPoApprovers(p) {
  const total = p.total != null ? p.total : purchTotal(p.items);
  const data = {
    title: '🛒 Purchase Order Awaiting Approval',
    body: `${p.prNo || p.rfqNo || 'PO'} — ${p.supplier || 'supplier'} · ₱${fmt(total)} (${p.requestingDept || 'Purchasing'}). Approvals → All Requests.`,
    icon: '🛒', type: 'po_approval', link: 'approvals', dedupKey: `po-appr-${p.id}`
  };
  const mgrs = await db.collection('users').where('role', '==', 'manager').get().catch(() => ({ docs: [] }));
  await Promise.all(mgrs.docs.map(d => safeNotify(() => Notifs.send(d.id, data))));
  await safeNotify(() => Notifs.sendToOwner(data));
}

// ── v12 WS30: the ONE approve/reject implementation. Both the Purchasing tab
// and the unified Approvals queue call these — never inline the writes again.
window.approvePurchaseOrder = async function(prId) {
  const ref = db.collection('purchase_requisitions').doc(prId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('PO not found');
  const p = { id: snap.id, ...snap.data() };
  if (p.approvalStatus !== 'pending') throw new Error('This PO is not awaiting approval.');
  const role = window.currentRole;
  if (role !== 'president' && role !== 'manager') throw new Error('Only the President or a Manager can approve POs.');
  const title = role === 'president'
    ? ((window.BRAND && window.BRAND.legal.signatory.title) || 'President, Barro Industries OPC')
    : 'Manager';
  await ref.update({
    approvalStatus: 'approved',
    approvedBy: window.currentUser.uid,
    approvedByName: window.userProfile?.displayName || window.currentUser.email,
    approvedByTitle: title,
    approvedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  window.logAudit && window.logAudit('approve', 'purchase_order', prId, { prNo: p.prNo || '', total: p.total || 0 });
  const notifyUid = p.convertedBy || p.createdBy;
  if (notifyUid) await safeNotify(() => Notifs.send(notifyUid, {
    title: '✅ PO Approved',
    body: `${p.prNo || p.rfqNo || 'Your PO'} (${p.supplier || ''}) was approved — you can now print and order.`,
    icon: '✅', type: 'po_approval_result', link: 'dept:Purchasing', dedupKey: `po-appr-ok-${prId}`
  }));
  return p;
};
window.rejectPurchaseOrder = async function(prId, reason) {
  const ref = db.collection('purchase_requisitions').doc(prId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('PO not found');
  const p = { id: snap.id, ...snap.data() };
  if (p.approvalStatus !== 'pending') throw new Error('This PO is not awaiting approval.');
  const role = window.currentRole;
  if (role !== 'president' && role !== 'manager') throw new Error('Only the President or a Manager can reject POs.');
  await ref.update({
    approvalStatus: 'rejected',
    rejectedBy: window.currentUser.uid,
    rejectedByName: window.userProfile?.displayName || window.currentUser.email,
    rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
    rejectedReason: (reason || '').trim()
  });
  window.logAudit && window.logAudit('reject', 'purchase_order', prId, { prNo: p.prNo || '', reason: (reason || '').slice(0, 200) });
  const notifyUid = p.convertedBy || p.createdBy;
  if (notifyUid) await safeNotify(() => Notifs.send(notifyUid, {
    title: '❌ PO Rejected',
    body: `${p.prNo || p.rfqNo || 'Your PO'} was rejected${reason ? ': ' + reason : ''}. Revert it to RFQ, adjust, and resubmit.`,
    icon: '❌', type: 'po_approval_result', link: 'dept:Purchasing', dedupKey: `po-appr-no-${prId}`
  }));
  return p;
};

// Finance posts a submitted purchase into the cash disbursement journal.
// Pre-fills from the purchase request; the PR's PO number becomes the reference
// so a double-entry is easy to spot.
async function recordPurchaseDisbursement(p, currentUser, onDone) {
  const total = p.total != null ? p.total : purchTotal(p.items);
  const ref = p.prNo || p.rfqNo || '';
  // `unresolved` is a pure count off the `p` already in hand — no read, so it
  // stays out here (it was only bundled into the `stockedValue` declaration
  // below for brevity; it was never awaited).
  const unresolved = (p.receiveUnmatched || []).length;
  // v14 tap-latency inversion — two sequential reads (the stock_movements
  // reconciliation query, then the bank-account <select>) used to run before
  // openPage, making this the slowest tap in Purchasing. Window first, both
  // reads after, in the same order as before. Title/footer are static — but
  // "Post Entry" ships `disabled`, because its listener is wired at the bottom of
  // the renderer and every field it posts from is injected by the fill. Cancel is
  // an inline onclick and stays live throughout.
  const panel = openPage(`${emojiIcon('🧾',16)} Record Purchase — Cash Disbursement`, window.skeletonHtml('rows'),
    `<button class="btn-primary" id="rec-save" disabled>Post Entry</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  const recBody = panel.querySelector('.page-panel-body');
  // Renderer body deliberately not re-indented — see openProjectBillingModal.
  await window.withLoadingAndError(recBody, async () => {
    // v12 WS30 — reconcile the PR's paper total against what PHYSICALLY landed in
    // stock (WS29's RECV_{prId}_{i} movement rows; resolver receipts included).
    let stockedValue = null;
    try {
      const mv = await db.collection('stock_movements')
        .where('source', '==', 'receive')
        .where('refNumber', '==', p.prNo || p.rfqNo || p.id).get();
      if (!mv.empty) stockedValue = mv.docs.reduce((s, d) => {
        const m = d.data(); return s + (Number(m.qty) || 0) * (Number(m.unitCost) || 0);
      }, 0);
    } catch (_) { /* movements unreadable — reconciliation line simply hidden */ }
    // Sequential, not Promise.all — deliberately the same ordering the two
    // awaits had before, so nothing about the reads' timing or failure
    // semantics changes with this pass. BankAccounts is the one that CAN
    // reject, and it should reach withLoadingAndError's error+Retry block.
    return { stockedValue, bankOpts: await window.BankAccounts.optionsHTML() };
  }, ({ stockedValue, bankOpts }) => {
  if (!panelLive(panel)) return;   // closed mid-flight — fill nothing, wire nothing
  recBody.innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Posting <strong>${escHtml(p.title || ref)}</strong> to the Cash Disbursement Journal.</div>
    <div class="form-row">
      <div class="form-group"><label>Reference</label><input id="rec-ref" value="${escHtml(ref)}"/></div>
      <div class="form-group"><label>Date</label><input id="rec-date" type="date" value="${today()}"/></div>
    </div>
    <div class="form-group"><label>Payee / Supplier</label><input id="rec-payee" value="${escHtml(p.supplier || '')}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Amount — Credit: Cash (₱)</label><input id="rec-amt" type="number" step="0.01" inputmode="decimal" value="${total}"/></div>
      <div class="form-group"><label>Debit Account</label><select id="rec-acct">
        <option value="inventory" selected>Inventory – Materials (asset)</option>
        <option value="material">COS – Direct Material (direct-to-job, skips stock)</option>
        <option value="ap">Accounts Payable</option>
        <option value="sundry">Sundry / Other</option>
      </select></div>
    </div>
    ${stockedValue != null ? `<div class="alert-banner" style="cursor:default;margin-bottom:8px;font-size:12px"><span>
      ${emojiIcon('📦',16)} Stocked into inventory: <strong>₱${fmt(stockedValue)}</strong> of ₱${fmt(total)} PR total${unresolved ? ` · <strong>${unresolved} line${unresolved>1?'s':''} unresolved</strong> (Purchasing must resolve them)` : ''}.
      <button class="btn-secondary btn-sm" id="rec-use-stocked" style="margin-left:6px">Use stocked value</button>
      <span id="rec-acct-warn" style="display:block;color:var(--danger,#c0392b)"></span></span></div>` : ''}
    <div class="form-group"><label>Paid from (company account)</label>
      <select id="rec-bank" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${bankOpts}</select>
    </div>
    <div class="form-group" id="rec-sundry-wrap" style="display:none"><label>Sundry Account Name</label><input id="rec-sundry" placeholder="e.g. Office Supplies Expense"/></div>
    <div class="form-group"><label>Input VAT</label>
      <select id="rec-vat" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
        <option value="inclusive" selected>VATable — 12% input VAT in the amount (claimable)</option>
        <option value="exempt">No input VAT (exempt / non-VAT supplier)</option>
      </select>
      <div style="font-size:11px;color:var(--text-muted);margin-top:3px"><span id="rec-vat-preview"></span></div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [recBody] });

  // ⚠ SCOPED TO THIS PANEL, NOT document — same rule as the rec-save release at
  // the bottom of this renderer. This window posts to the Cash Disbursement
  // Journal AND mirrors into the ledger; a read that resolved into a dying
  // panel would post the PREVIOUS purchase's amount, payee, debit account and
  // paying bank account against THIS purchase requisition.
  const $rec = (id) => panel.querySelector('#' + id);
  const acctSel = $rec('rec-acct');
  acctSel.addEventListener('change', () => {
    $rec('rec-sundry-wrap').style.display = acctSel.value === 'sundry' ? '' : 'none';
  });
  $rec('rec-use-stocked')?.addEventListener('click', () => {
    $rec('rec-amt').value = stockedValue; recVatPreview(); acctWarn();
  });
  const acctWarn = () => {
    const w = $rec('rec-acct-warn'); if (!w || stockedValue == null) return;
    const amt = parseFloat($rec('rec-amt').value) || 0;
    if (acctSel.value === 'inventory' && stockedValue <= 0)
      w.textContent = '⚠ Nothing from this PR landed in stock — booking it as an Inventory asset will overstate inventory.';
    else if (acctSel.value === 'material' && stockedValue > 0)
      w.textContent = `⚠ ₱${fmt(stockedValue)} of this PR WAS stocked — COS (skips stock) will double-count it when consumed.`;
    else if (acctSel.value === 'inventory' && Math.abs(amt - stockedValue) > 0.5)
      w.textContent = `ℹ Amount differs from the stocked value (₱${fmt(stockedValue)}) — post the difference to a second, correctly-classified entry.`;
    else w.textContent = '';
  };
  acctSel.addEventListener('change', acctWarn);
  $rec('rec-amt').addEventListener('input', acctWarn);
  acctWarn();
  const recVatPreview = () => {
    const amt = parseFloat($rec('rec-amt').value) || 0;
    const vat = $rec('rec-vat').value === 'exempt' ? 0 : window.vatSplit(amt,'inclusive').vat;
    $rec('rec-vat-preview').textContent = vat > 0 ? `Input VAT ₱${fmt(vat)} reclaimable` : 'No input VAT';
  };
  $rec('rec-amt').addEventListener('input', recVatPreview);
  $rec('rec-vat').addEventListener('change', recVatPreview);
  recVatPreview();

  $rec('rec-save').addEventListener('click', async () => {
    const reference = $rec('rec-ref').value.trim();
    const payee = $rec('rec-payee').value.trim();
    const amt = parseFloat($rec('rec-amt').value) || 0;
    const acct = acctSel.value;
    if (!payee) { Notifs.showToast('Enter a payee.', 'error'); return; }
    if (!amt) { Notifs.showToast('Enter the amount.', 'error'); return; }
    const bankSel = $rec('rec-bank').value;
    if (!bankSel && (await window.BankAccounts.list()).length) { Notifs.showToast('Select the paying account.', 'error'); return; }
    const bankAcct = await window.BankAccounts.pick(bankSel);
    const saveBtn = $rec('rec-save'); saveBtn.disabled = true;
    try {
      if (reference) {
        const dupe = await db.collection('cash_disbursement_journal').where('reference', '==', reference).limit(1).get().catch(() => ({ empty: true }));
        if (!dupe.empty && !(await confirmDialog({message:`A disbursement with reference "${escHtml(reference)}" already exists. Post another?`, html:true}))) { saveBtn.disabled = false; return; }
      }
      const dueDate = $rec('rec-date').value;
      await window.assertPeriodOpen(dueDate);
      // H10 fix — a fresh transactional re-check + claim of recordedToFinance, so
      // two Finance users racing to post the same PR can't both create a CDJ row
      // + ledger entry. The old flow only ever read the flag from the `p` object
      // already in memory (never re-read), then wrote it AFTER the money had
      // already moved, with its own write wrapped in .catch(()=>{}) — no guard
      // at all. Claiming the flag INSIDE the transaction, before any CDJ/ledger
      // write happens, closes the race; only one of two concurrent transactions
      // can win it (Firestore retries the loser with a fresh read).
      const prRef = db.collection('purchase_requisitions').doc(p.id);
      const alreadyRecorded = await db.runTransaction(async (tx) => {
        const prSnap = await tx.get(prRef);
        if (prSnap.exists && prSnap.data().recordedToFinance) return true;
        tx.update(prRef, {
          recordedToFinance: true,
          recordedToFinanceAt: firebase.firestore.FieldValue.serverTimestamp(),
          recordedBy: currentUser.uid,
          recordedByName: window.userProfile?.displayName || currentUser.email
        });
        return false;
      });
      if (alreadyRecorded) {
        closeModal();
        Notifs.showToast('This purchase was already recorded to Finance.', 'error');
        onDone && onDone();
        return;
      }
      const vatTreatment = $rec('rec-vat').value;
      const inputVat = vatTreatment === 'exempt' ? 0 : window.vatSplit(amt,'inclusive').vat;
      // acct==='inventory' still writes the amount into debitMaterial (so legacy
      // readers of the CDJ doc keep summing correctly); debitAccount is what
      // tells postCDJToLedger to tag the mirrored ledger row as an asset instead
      // of an expense (v12 WS13 — fixes double material expensing).
      const cdjData = {
        reference, date: dueDate, payee,
        creditCash: amt,
        debitMaterial:     (acct === 'material' || acct === 'inventory') ? amt : 0,
        debitAP:           acct === 'ap' ? amt : 0,
        debitLabor:        0,
        debitSundryAcct:   acct === 'sundry' ? $rec('rec-sundry').value.trim() : '',
        debitSundryAmount: acct === 'sundry' ? amt : 0,
        debitAccount:      acct,
        vatAmount: inputVat, vatTreatment,
        purchaseRef:       p.id,
        bankAccountId: bankAcct.bankAccountId || null, bankAccountName: bankAcct.bankAccountName || null,
        addedBy: currentUser.uid,
        addedByName: window.userProfile?.displayName || currentUser.email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      // If the CDJ/ledger writes fail AFTER the claim above, the PR would be
      // stuck recordedToFinance=true with no money movement and no retry button
      // (silent under-count). Release the claim on failure so Finance can retry.
      let cdjRef;
      try {
        cdjRef = await db.collection('cash_disbursement_journal').add(cdjData);
        await postCDJToLedger(cdjRef.id, cdjData); // also mirror into the ledger (unless pure A/P)
      } catch (postErr) {
        await prRef.update({
          recordedToFinance: false,
          recordedToFinanceAt: firebase.firestore.FieldValue.delete(),
          recordedBy: firebase.firestore.FieldValue.delete(),
          recordedByName: firebase.firestore.FieldValue.delete()
        }).catch(() => {
          // Revert also failed (offline?) — surface the stuck state loudly.
          Notifs.showToast(`URGENT: PR ${p.id} is marked recorded but the journal write failed AND the rollback failed. Ask IT to clear recordedToFinance on it.`, 'error');
        });
        throw postErr;   // outer catch shows the toast + re-enables Save
      }
      // The recordedToFinance flag itself was already claimed transactionally
      // above (before this write could race against anyone) — this just stamps
      // the resulting CDJ id back onto the PR for cross-reference.
      await db.collection('purchase_requisitions').doc(p.id).update({
        cdjEntryId: cdjRef.id
      }).catch(() => {}); // journal post + the recordedToFinance claim already succeeded — don't fail the action over this cross-reference write
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
      closeModal();
      Notifs.success('Posted to Cash Disbursement Journal ✓');
      onDone && onDone();
    } catch (err) { Notifs.showToast('Post failed: ' + (err.message || err), 'error'); saveBtn.disabled = false; }
  });
  // Form and listener are real now — release Post Entry (panel-scoped; see the
  // note at openProjectBillingModal).
  const recSaveBtn = panel.querySelector('#rec-save');
  if (recSaveBtn) recSaveBtn.disabled = false;
  }, { skeleton:'rows' });
}

// ── Printable Purchase Order (forward to supplier) ────────────────
// Opens a clean, branded PO document in a new window — same navy letterhead
// look as the quote builder / inventory count form. Print or "Save as PDF"
// from the browser dialog to email to the supplier.
function printPurchaseOrder(p) {
  const e = s => escHtml(s == null ? '' : String(s));
  const items = p.items || [];
  const total = p.total != null ? p.total : purchTotal(items);
  const issued = p.convertedAt && p.convertedAt.toDate ? p.convertedAt.toDate() : new Date();
  const issuedStr = issued.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
  const state = poState(p);
  if (state === 'rejected') { Notifs.showToast('This PO was rejected — revert it to RFQ and resubmit before printing.', 'error'); return; }
  const isPending = state === 'pending';
  const preparedBy = p.convertedByName || p.createdByName || '';
  const _sig = (window.BRAND && window.BRAND.legal.signatory) || { name: 'NEIL BARRO', title: 'President, Barro Industries OPC' };
  // v12 WS30 — the "Approved by" line is the RECORDED approver. Pre-gate ('legacy')
  // docs keep the historic static line; pending docs print a BLANK line + watermark.
  const approvedSig = state === 'approved'
    ? { label: 'Approved by', name: p.approvedByName || '', title: p.approvedByTitle || '' }
    : state === 'legacy'
      ? { label: 'Approved by', name: _sig.name, title: _sig.title }
      : { label: 'Approved by', name: '', title: 'PENDING — not yet approved' };
  const _lh = window.buildLetterhead ? window.buildLetterhead({
    docTitle: isPending ? 'PURCHASE ORDER (PENDING APPROVAL)' : 'PURCHASE ORDER',
    docNumber: p.prNo || p.rfqNo || '',
    dateLabel: 'Date: ' + issuedStr,
    extraMeta: [...(p.neededBy ? ['Needed by: ' + p.neededBy] : []), ...(isPending ? [`${emojiIcon('⚠',16)} NOT VALID — awaiting management approval`] : [])],
    signatures: [
      { label: 'Prepared by', name: preparedBy, title: 'Purchasing' },
      approvedSig
    ],
    footerNote: ((window.BRAND && window.BRAND.fullName) || 'Barro Industries Operating System') + ' · Generated ' + new Date().toLocaleString('en-PH')
  }) : null;

  const rows = items.map((it, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td>${e(it.desc || '—')}</td>
      <td class="c">${Number(it.qty || 0).toLocaleString('en-PH')}</td>
      <td class="c">${e(it.unit || '')}</td>
      <td class="r">₱${fmt(it.unitPrice || 0)}</td>
      <td class="r b">₱${fmt((it.unitPrice || 0) * (it.qty || 0))}</td>
    </tr>`).join('');
  const filled = items.length;
  let blanks = ''; for (let k = filled; k < Math.max(filled + 1, 6); k++) blanks += `<tr class="blank"><td class="c">${k + 1}</td><td></td><td></td><td></td><td></td><td></td></tr>`;

  const pageCss = `
  .page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:14mm}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
  .pbox{border:1px solid #999;border-radius:6px;padding:8px 11px}
  .pbox .l{font-size:8px;text-transform:uppercase;letter-spacing:.6px;color:#1E3A5F;font-weight:800;margin-bottom:3px}
  .pbox .v{font-size:12px;font-weight:700;min-height:15px}
  .pbox .s{font-size:10px;color:#555;font-weight:400;margin-top:2px;line-height:1.45}
  table{margin-bottom:10px}
  th{background:#1E3A5F;color:#fff;font-size:9px;text-transform:uppercase;letter-spacing:.04em}
  tfoot td{font-weight:700;background:#f0f4ff}
  .note{font-size:10px;color:#444;margin:4px 0 10px;line-height:1.5}
  .note b{color:#1E3A5F}
  .terms{border:1px solid #DDE2EC;background:#F5F6FA;border-radius:6px;padding:9px 12px;margin-bottom:14px}
  .terms h4{font-size:9px;text-transform:uppercase;letter-spacing:.5px;color:#1E3A5F;margin-bottom:4px}
  .terms p{font-size:9.5px;color:#444;line-height:1.5}
  .sign{display:grid;grid-template-columns:1fr 1fr;gap:36px;margin-top:34px}
  .sline{border-top:1px solid #000;padding-top:5px;text-align:center;font-size:10px;color:#444}
  .sline b{display:block;font-size:11px;color:#000}
  .foot{margin-top:18px;border-top:1px solid #ddd;padding-top:8px;font-size:9px;color:#999;text-align:center}
  @media print{ .page{padding:0;width:auto;min-height:0} }
${_lh ? _lh.printCSS : ''}`;
  const bodyHtml = `
  ${_lh ? _lh.headerHTML : ''}
  <div class="parties">
    <div class="pbox">
      <div class="l">Supplier / Vendor</div>
      <div class="v">${e(p.supplier || '—')}</div>
      <div class="s">${e(p.title || '')}</div>
    </div>
    <div class="pbox">
      <div class="l">Deliver To</div>
      <div class="v">${e(p.deliverTo || 'Barro Industries OPC')}</div>
      <div class="s">Attn: ${e(p.requestingDept || 'Purchasing')} Department</div>
    </div>
  </div>
  <table>
    <thead><tr>
      <th style="width:32px">#</th><th>Item / Description</th>
      <th style="width:60px">Qty</th><th style="width:64px">Unit</th>
      <th style="width:100px">Unit Price</th><th style="width:110px">Line Total</th>
    </tr></thead>
    <tbody>${rows}${blanks}</tbody>
    <tfoot><tr><td colspan="5" class="r">TOTAL (PHP)</td><td class="r">₱${fmt(total)}</td></tr></tfoot>
  </table>
  ${p.notes ? `<div class="note"><b>Notes:</b> ${e(p.notes)}</div>` : ''}
  <div class="terms">
    <h4>Terms &amp; Conditions</h4>
    <p>Please supply the items listed above at the agreed prices. Reference this PO number on your delivery receipt and invoice. Deliver to the address above on or before the date indicated. Any discrepancy in quantity, price, or specification must be confirmed in writing before fulfilment.</p>
  </div>
  ${_lh ? _lh.footerHTML : `
  <div class="sign">
    <div class="sline"><b>${e(preparedBy)}</b>Prepared by — Purchasing</div>
    <div class="sline"><b>${e(approvedSig.name)}</b>Approved by — ${e(approvedSig.title)}</div>
  </div>
  <div class="foot">Barro Industries Operating System · Generated ${new Date().toLocaleString('en-PH')}</div>`}`;

  window.openPrintableDoc({
    title: `Purchase Order — ${p.prNo || p.rfqNo || ''}`,
    barLabel: `${emojiIcon('🛒',16)} Purchase Order — ${e(p.prNo || p.rfqNo || '')}`,
    bodyHtml, pageCss,
    watermark: isPending ? 'PENDING APPROVAL' : null,
    winFeatures: 'width=900,height=720'
  });
}

// ── Printable Receiving Report (v12 WS30) — evidence trail for Finance ─────
// Per line: received-into-stock vs unresolved (from WS29's receiveUnmatched).
function printReceivingReport(p) {
  const e = s => escHtml(s == null ? '' : String(s));
  const items = p.items || [];
  const unres = new Set((p.receiveUnmatched || []).map(u => u.i));
  const rcvd = p.receivedAt && p.receivedAt.toDate ? p.receivedAt.toDate() : new Date();
  const _lh = window.buildLetterhead ? window.buildLetterhead({
    docTitle: 'RECEIVING REPORT',
    docNumber: (p.prNo || p.rfqNo || '').replace(/^PR/, 'RR') || ('RR-' + today()),
    dateLabel: 'Received: ' + rcvd.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }),
    extraMeta: ['PO ref: ' + (p.prNo || p.rfqNo || ''), 'Supplier: ' + (p.supplier || '—')],
    signatures: [
      { label: 'Received by', name: p.receivedByName || '', title: 'Purchasing / Warehouse' },
      { label: 'Verified by', name: '', title: 'Finance' }
    ],
    footerNote: ((window.BRAND && window.BRAND.fullName) || 'Barro Industries Operating System') + ' · Generated ' + new Date().toLocaleString('en-PH')
  }) : null;
  const rows = items.map((it, i) => `<tr>
      <td class="c">${i + 1}</td><td>${e(it.desc || '—')}</td>
      <td class="c">${Number(it.qty || 0).toLocaleString('en-PH')}</td><td class="c">${e(it.unit || '')}</td>
      <td class="c">${unres.has(i) ? `${emojiIcon('⚠',16)} Unresolved — not in stock` : `${emojiIcon('✓',16)} Received into stock`}</td>
    </tr>`).join('');
  const pageCss = `.page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:14mm}
table{margin:12px 0}
th{background:#1E3A5F;color:#fff;font-size:9px;text-transform:uppercase}
@media print{.page{padding:0;width:auto;min-height:0}}
${_lh ? _lh.printCSS : ''}`;
  const bodyHtml = `${_lh ? _lh.headerHTML : ''}
<table><thead><tr><th style="width:32px">#</th><th>Item / Description</th><th style="width:60px">Qty</th><th style="width:64px">Unit</th><th style="width:170px">Stock Status</th></tr></thead>
<tbody>${rows}</tbody></table>
${p.notes ? `<div style="font-size:10px;color:#444;margin-bottom:10px"><b>Notes:</b> ${e(p.notes)}</div>` : ''}
${_lh ? _lh.footerHTML : ''}`;

  window.openPrintableDoc({
    title: `Receiving Report — ${p.prNo || ''}`,
    barLabel: `${emojiIcon('📦',16)} Receiving Report — ${e(p.prNo || '')}`,
    bodyHtml, pageCss,
    winFeatures: 'width=900,height=720'
  });
}
