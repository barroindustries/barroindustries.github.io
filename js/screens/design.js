/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Design Department screen
   js/screens/design.js

   Wave 2 Batch B (I1 stage-A pilot) — split out of js/departments.js
   verbatim, 2026-08-03. Proves the extraction protocol later batches
   (approvals, finance-reports, purchasing/production, sales/AEC,
   HR/payroll-UI…) repeat per domain.

   Contents: renderDesign + everything private to the Design board —
   project list/detail (tasks/financials/drawings/files tabs) and
   drawing list/detail/status-transition modals. Still plain
   `window.*`-attached globals, no ESM, no bundler — this file is a
   physical split only, not a module.

   LOAD-ORDER CONTRACT (see index.html + CLAUDE.md "Script load order
   is load-bearing"):
     - Loads AFTER js/departments.js. Every function in this file is
       invoked only at runtime (click handlers, navigateTo() dispatch,
       promise callbacks) — never at parse time — so it is safe for
       departments.js's shared helpers (canEditDept, deptContainer,
       fmt, today, statusBadge, renderClientProfiles, renderFileCollection,
       bindFileCollection, renderDeptTasks, openTaskDetail, window.Projects,
       window.Clients, window.DesignFolders, window.openBillingInvoice,
       etc.) to still be undefined at the moment THIS file's top-level
       code runs — those helpers are only dereferenced later, from
       inside a function body, by which point departments.js has
       finished executing and attached them to `window`.
     - window.renderDesign is the only entry point called from outside
       this file (js/app.js navigateTo() switch, case 'Design').
     - window.canApproveDrawing and window.openProjectDetail are also
       window-attached (openProjectDetail deliberately, so it doesn't
       collide with departments.js's openJobProjectDetail — see the
       comment at departments.js ~13233).
     - DRAWING_TYPES / DRAWING_STATUSES are plain top-level `const`s
       (script-scoped, NOT window properties in a browser — const/let
       at a script's top level never become globalThis/window props).
       They must stay in THIS file alongside every function that
       reads them (drawingStatus, drawingTypeIcon, drawingCard,
       renderProjectDrawings, openDrawingCreateModal/EditModal,
       renderDrawingsDashboard). js/ui-status-meta.js's lazy
       `drawing: () => window.DRAWING_STATUSES || []` passthrough
       already resolved to `[]` before this split (DRAWING_STATUSES
       was never window-attached in departments.js either) — that is
       pre-existing behavior, unchanged by this move.
   ═══════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════
//  DESIGN DEPARTMENT
// ══════════════════════════════════════════════════
window.renderDesign = async function(currentUser, currentRole, subtab = 'Projects') {
  const c = deptContainer();
  c.innerHTML = `
    <div class="page-header"><h2>${emojiIcon('🎨',20)} Design</h2></div>
    ${window.sopPanel('How Design works', [
      'Projects tracks each design job — sales orders land here automatically when Finance records a sale; finish the drawings, then Send to Production.',
      'Folders organizes design files — two types: Projects and Sales Orders.',
      'Clients keeps the design client book; Product Designs and References are the asset libraries.',
      'Tasks is the department board for design work in progress.'
    ])}
    ${window.chipTabs(['Projects','Drawings','Folders','Clients','Product Designs','References','Budgeting','Tasks'].map(s=>({key:s,label:s})), subtab)}
    <div id="design-content"><div class="loading-placeholder">Loading…</div></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  loadDesignContent(currentUser, currentRole, subtab);
  window.bindChipTabs(c, (key) => loadDesignContent(currentUser, currentRole, key));
};

async function loadDesignContent(currentUser, currentRole, sub) {
  const content = document.getElementById('design-content');
  switch(sub) {
    case 'Projects':    await renderProjects(content, currentUser, currentRole); break;
    case 'Drawings':    await renderDrawingsDashboard(content, currentUser, currentRole); break;
    case 'Folders':     await renderDesignFolders(content, currentUser, currentRole); break;
    case 'Clients':     await renderClientProfiles(content, currentUser, currentRole, 'design'); break;
    case 'Product Designs':
      content.innerHTML = renderFileCollection('Product Designs', 'design-files', currentRole);
      bindFileCollection('design-files', currentUser, 'Design', 'Product Designs');
      break;
    case 'References':
      content.innerHTML = renderFileCollection('Reference Files', 'design-refs', currentRole);
      bindFileCollection('design-refs', currentUser, 'Design', 'References');
      break;
    case 'Budgeting':
      await window.renderBudgeting(content, currentUser, currentRole, 'Design');
      break;
    case 'Tasks':
      await renderDeptTasks(content, 'Design', currentUser, currentRole);
      break;
  }
}

// Sum of recorded payments on a project.
function projectPaid(p) {
  return (p.payments || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
}

// ── pageStillOpen(panel) — the close-mid-flight guard ────────────────────────
// Every drill-down in this file now pushes its openPage window SYNCHRONOUSLY
// with a skeleton body and fills it when the read lands (see the WINDOW
// INVERSION notes at each call site). The user can press Back in that gap, so
// every fill has to be able to no-op.
//
// isConnected ALONE IS NOT THAT TEST, measured in-browser 2026-08-05 against a
// real panel: openPage's teardown (js/app.js) drops `.open`, pops the Overlay
// entry and splices window._pageStack SYNCHRONOUSLY, but removes the node on a
// `setTimeout(…, 300)` so the exit transition can play. For those 300ms a
// dismissed panel is still isConnected === true — and a read landing inside
// 300ms of the tap is the COMMON case here, not the exotic one (dbCachedGet
// serves `users` from a 60s in-memory cache, so it resolves on a microtask).
// A bare isConnected check therefore let the fill run on a window the user had
// already dismissed: verified filling it and re-enabling its footer button.
// Nothing user-visible broke — the panel is off the Overlay stack, cannot be
// revealed again, and is deleted milliseconds later — but it is wasted work on
// a corpse and it makes the guard read as protection it was not providing.
//
// _pageStack membership is the exact liveness test: openPage pushes before it
// appends, teardown splices before it schedules the removal, so the panel is in
// that array for precisely as long as the window is alive. isConnected is kept
// as a belt-and-braces first clause (and as the sole test if a future app.js
// stops publishing _pageStack, which is why the Array.isArray fallback returns
// the isConnected verdict rather than false — this must never become the reason
// a window silently refuses to fill).
function pageStillOpen(panel) {
  if (!panel || !panel.isConnected) return false;
  return Array.isArray(window._pageStack) ? window._pageStack.includes(panel) : true;
}

async function renderProjects(container, currentUser, currentRole) {
  // v14 prod-fixlist — this was a blanket .catch(()=>({docs:[],empty:true})), so
  // a genuine permission error on `projects` rendered identically to "no
  // projects yet" with no way to tell the difference. Surface it as a retry
  // block instead (same idiom production.js/govit.js already use).
  let projects;
  try {
    const snap = await db.collection('projects').orderBy('createdAt','desc').get();
    projects = snap.docs.map(d => ({id:d.id,...d.data()}));
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load projects</h4><p>${escHtml(err.message||String(err))}</p><button type="button" class="btn-secondary btn-sm design-proj-retry-btn" style="margin-top:14px">Retry</button></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [container] });
    container.querySelector('.design-proj-retry-btn')?.addEventListener('click', ()=>renderProjects(container, currentUser, currentRole));
    return;
  }
  const canAdd = currentRole === 'president' || currentRole === 'owner' || currentRole === 'manager';
  const canBill = ['president','owner','manager','finance'].includes(currentRole) || canEditDept('Finance');

  // SO projects awaiting design first — that queue is the reason Design opens
  // this tab now — then the existing createdAt order (already sorted by the query).
  projects = projects.slice().sort((a,b)=>{
    const aw = a.salesOrderId && !a.productionHandoffAt ? 1 : 0;
    const bw = b.salesOrderId && !b.productionHandoffAt ? 1 : 0;
    return bw - aw;
  });
  const soQueue = projects.filter(p=>p.salesOrderId && !p.productionHandoffAt).length;

  container.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      ${canAdd?`<button class="btn-primary btn-sm" id="add-project-btn">+ New Project</button>`:''}
    </div>
    ${soQueue>0?`<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${emojiIcon('🎨',12)} ${soQueue} sales order${soQueue===1?'':'s'} waiting on design</div>`:''}
    <div class="item-list">
      ${!projects.length
        ? `<div class="empty-state"><div class="empty-icon">${emojiIcon('🎨',44)}</div><h4>No projects yet</h4></div>`
        : projects.map(p => {
          const contract = Number(p.contractAmount) || 0;
          const paid     = projectPaid(p);
          const balance  = contract - paid;
          return `
          <div class="item-card" data-id="${p.id}" style="cursor:pointer">
            <div class="item-top">
              <div class="item-title">${escHtml(p.name)}</div>
              <span class="badge ${statusBadge(p.status)}">${p.status||'active'}</span>
            </div>
            ${p.salesOrderId?`<div class="item-meta" style="margin-top:2px">
              <span class="badge badge-purple" style="font-size:9px">${emojiIcon('🧾',9)} SALES ORDER</span>
              ${!p.productionHandoffAt?`<span class="badge badge-orange" style="font-size:9px">awaiting design</span>`:''}
            </div>`:''}
            <div class="item-meta">
              ${p.client?`<span>${emojiIcon('👤',16)} ${escHtml(p.client)}</span>`:''}
              ${p.dueDate?`<span>${emojiIcon('📅',16)} ${p.dueDate}</span>`:''}
            </div>
            ${contract>0?`<div class="item-meta" style="margin-top:6px">
              <span>${emojiIcon('💰',16)} Contract ₱${fmt(contract)}</span>
              <span>${emojiIcon('✅',16)} Paid ₱${fmt(paid)}</span>
              <span style="font-weight:700;color:${balance>0.005?'#FF453A':'#30D158'}">${balance>0.005?`Balance ₱${fmt(balance)}`:'Fully Paid'}</span>
            </div>`:''}
          </div>`;}).join('')}
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  container.querySelectorAll('.item-card').forEach(card => {
    card.addEventListener('click', () => {
      const p = projects.find(x => x.id === card.dataset.id);
      if (p) openProjectDetail(p, currentUser, currentRole, canBill);
    });
  });

  document.getElementById('add-project-btn')?.addEventListener('click', () => {
    // ⚠ SCOPED TO THIS PANEL, NOT document.
    // openPage keeps a CLOSING page in the DOM for ~300ms (js/app.js defers the
    // node removal so the exit transition can play). Open a second window inside
    // that gap and TWO panels carry the same ids at once —
    // document.getElementById() returns the FIRST in document order, which is the
    // DYING one. The handler then binds a button nobody can see while the visible
    // button has no handler at all, and the field reads below would pull the
    // PREVIOUS form's values. Reproduced in-browser 2026-08-10 (Corporate
    // Secretary's "takes several taps / needs a second tab" report).
    const npPanel = openPage('New Project', `
      <div class="form-group"><label>Project Name</label><input id="proj-name" placeholder="e.g. Kitchen Design — ABC Corp"/></div>
      <div class="form-group"><label>Client</label><input id="proj-client" placeholder="Client name"/></div>
      <div class="form-row">
        <div class="form-group"><label>Start Date</label><input id="proj-start" type="date" value="${today()}"/></div>
        <div class="form-group"><label>Due Date</label><input id="proj-due" type="date"/></div>
      </div>
      <div class="form-group"><label>Contract Amount (₱)</label><input id="proj-contract" type="number" step="0.01" min="0" placeholder="Total project value (optional)" inputmode="decimal"/></div>
      <div class="form-group"><label>Notes</label><textarea id="proj-notes" rows="3"></textarea></div>
    `, `<button class="btn-primary" id="save-proj-btn">Save Project</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    npPanel.querySelector('#save-proj-btn').addEventListener('click', async () => {
      await db.collection('projects').add({
        name:           npPanel.querySelector('#proj-name').value.trim(),
        client:         npPanel.querySelector('#proj-client').value.trim(),
        startDate:      npPanel.querySelector('#proj-start').value,
        dueDate:        npPanel.querySelector('#proj-due').value,
        contractAmount: parseFloat(npPanel.querySelector('#proj-contract').value) || 0,
        notes:          npPanel.querySelector('#proj-notes').value.trim(),
        status:         'active',
        createdBy:      currentUser.uid,
        createdAt:      firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); renderDesign(currentUser, currentRole, 'Projects');
    });
  });
}

// ══════════════════════════════════════════════════
//  DESIGN — drawings (DWG/PDF/2D/3D) with revision control
// ══════════════════════════════════════════════════
const DRAWING_TYPES = ['DWG','PDF','Drawing','3D','Render'];
const DRAWING_STATUSES = [
  { id:'draft',      label:'Draft',      badge:'badge-gray'   },
  { id:'for_review', label:'For Review', badge:'badge-orange' },
  { id:'approved',   label:'Approved',   badge:'badge-blue'   },
  { id:'released',   label:'Released',   badge:'badge-green'  },
  { id:'superseded', label:'Superseded', badge:'badge-gray'   },
];
function drawingStatus(id){ return DRAWING_STATUSES.find(s=>s.id===id) || DRAWING_STATUSES[0]; }
function nextRev(letter){ return letter ? String.fromCharCode((''+letter).toUpperCase().charCodeAt(0)+1) : 'A'; }
function drawingTypeIcon(t){ return ({DWG:`${emojiIcon('📐',16)}`,PDF:`${emojiIcon('📄',16)}`,Drawing:`${emojiIcon('✏️',16)}`,'3D':`${emojiIcon('🧊',16)}`,Render:`${emojiIcon('🖼',16)}`})[t] || `${emojiIcon('📄',16)}`; }
// Approval capability (v12 WS35) — MUST stay in lockstep with the design_drawings
// update rule (firestore.rules). Approver = president/manager, or the parent
// project's designLead — NEVER 'secretary' (view-only approvals directive) and
// NEVER the drawing's own author/assignee (self-approval hole closed here + rules).
// { approve, release, isApprover } for the current user on drawing d of project.
window.canApproveDrawing = function(d, project){
  const uid = (window.currentUser && currentUser.uid) || '';
  const isApprover = ['president','manager'].includes(window.currentRole || '')
    || (!!project && !!project.designLead && project.designLead === uid);
  const isAuthor = !!uid && (uid === d.createdBy || uid === d.assignedTo);
  return { isApprover, approve: isApprover && !isAuthor, release: isApprover };
};
// Forward status transitions offered in the drawing detail (manager-gated).
function drawingTransitions(status){
  switch(status){
    case 'draft':      return [{to:'for_review',label:'Submit for Review',cls:'btn-primary'}];
    case 'for_review': return [{to:'approved',label:`${emojiIcon('✅',16)} Approve`,cls:'btn-success'},{to:'draft',label:'Back to Draft',cls:'btn-secondary'}];
    case 'approved':   return [{to:'released',label:`${emojiIcon('🚀',16)} Release`,cls:'btn-success'},{to:'for_review',label:'Back to Review',cls:'btn-secondary'}];
    case 'released':   return [{to:'superseded',label:'Supersede',cls:'btn-secondary'}];
    case 'superseded': return [{to:'draft',label:'Reactivate',cls:'btn-secondary'}];
    default:           return [];
  }
}
function drawingCard(d){
  const st = drawingStatus(d.status);
  return `<div class="item-card" data-dwg="${d.id}" style="cursor:pointer">
    <div class="item-top">
      <div class="item-title">${drawingTypeIcon(d.type)} ${escHtml(d.title||'Untitled')}${d.drawingNo?` <span style="font-size:11px;color:var(--text-muted)">${escHtml(d.drawingNo)}</span>`:''}</div>
      <div class="item-badges"><span class="badge badge-gray">Rev ${escHtml(d.currentRev||'A')}</span><span class="badge ${st.badge}">${st.label}</span></div>
    </div>
    <div class="item-meta" style="gap:6px;flex-wrap:wrap">
      <span>${escHtml(d.type||'File')}</span>
      ${d.projectName?`<span>${emojiIcon('🗂',16)} ${escHtml(d.projectName)}</span>`:''}
      ${d.assignedToName?`<span>${emojiIcon('👤',16)} ${escHtml(d.assignedToName)}</span>`:''}
      ${d.fileName?`<span>${emojiIcon('📎',16)} ${escHtml(d.fileName)}</span>`:''}
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════
//  Project detail — tabbed hub (Overview / Drawings / Tasks / Financials / Activity)
//  Same global name + signature as before (renderProjects calls it with 4 args);
//  the optional 5th arg lets sub-modals re-open onto a specific tab.
//  NOTE: deliberately distinct from openJobProjectDetail (job_projects lifecycle).
// ══════════════════════════════════════════════════
window.openProjectDetail = function(p, currentUser, currentRole, canBill, initialTab) {
  initialTab = initialTab || 'Overview';
  const tabs = ['Overview','Drawings','Files','Tasks','Financials','Activity'];
  // v14 Batch5 A3 — every "reopen" caller inside this hub (Edit Project, New
  // Drawing, Delegate Task, Record Payment/Invoice, drawing sub-flows) calls
  // openProjectDetail()/openDrawingDetail() again directly to refresh, WITHOUT
  // first closing the sub-page it was opened from (that pattern predates this
  // conversion — see the "reopen" const below and the dw/pe/pt-cancel/save
  // handlers). Those callers are responsible for calling window.Overlay.clearAll()
  // themselves before reopening, so by the time THIS function runs the stack is
  // always either empty (first drill-in) or was just cleared — a plain push is
  // therefore always correct here; never opts.replace.
  // openPage's _setPanelTitle renders the title via textContent (already
  // XSS-safe); escHtml here DOUBLE-encoded it, so an apostrophe showed as
  // '&#39;' literally in the title (owner screenshot). Pass the raw name.
  // SCOPED TO THIS PANEL — openPage's return value was previously discarded and
  // showTab() resolved #pd-tab-body with document.getElementById. Every reopen
  // path in this hub (Record Payment, Billing Invoice, Edit Project, New
  // Drawing, Delegate Task, and the drawing sub-flows) does
  // `Overlay.clearAll(); openProjectDetail(...)` in ONE tick, and openPage
  // defers node removal by 300ms (js/app.js) — so the OLD project panel is
  // still in the document, is EARLIER in document order, and won the global
  // lookup. The visible panel was never filled: it sat on "Loading…" forever
  // while the dying one got the content. Reproduced end-to-end by the review:
  // 2 panels in the DOM, getElementById resolved to the dying page-panel-1, and
  // #pd-tabs .subtab-btn matched 12 nodes (6 tabs x 2 panels).
  // Consequence: Record Payment saved the money and the ledger leg, then
  // returned a blank window with no payment, no balance and no confirmation.
  const _pdPanel = openPage((p.name||'Project'), `
    <div class="item-meta" style="margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <span class="badge ${statusBadge(p.status)}">${escHtml(p.status||'active')}</span>
      ${p.client?`<span>${emojiIcon('👤',16)} ${escHtml(p.client)}</span>`:''}
      ${p.dueDate?`<span>${emojiIcon('📅',16)} Due ${escHtml(p.dueDate)}</span>`:''}
      ${p.jobProjectNo?`<span class="badge badge-blue" title="Linked job project">${emojiIcon('🔗',16)} ${escHtml(p.jobProjectNo)}</span>`:''}
    </div>
    <div class="subtab-bar" id="pd-tabs" style="margin-bottom:12px">
      ${tabs.map(t=>`<button class="subtab-btn ${t===initialTab?'active':''}" data-pd="${t}">${t}</button>`).join('')}
    </div>
    <div id="pd-tab-body"><div class="loading-placeholder">Loading…</div></div>
  `, `<button class="btn-secondary" onclick="closeModal()">Close</button>`);

  const showTab = (t) => {
    _pdPanel.querySelectorAll('#pd-tabs .subtab-btn').forEach(b=>b.classList.toggle('active', b.dataset.pd===t));
    const host = _pdPanel.querySelector('#pd-tab-body');
    if (!host) return;
    if      (t==='Overview')   renderProjOverview(host, p, currentUser, currentRole, canBill);
    else if (t==='Drawings')   renderProjectDrawings(host, p, currentUser, currentRole, canBill);
    else if (t==='Files')      renderProjectFiles(host, p, currentUser, currentRole);
    else if (t==='Tasks')      renderProjectTasks(host, p, currentUser, currentRole, canBill);
    else if (t==='Financials') renderProjFinancials(host, p, currentUser, currentRole, canBill);
    else if (t==='Activity')   renderProjActivity(host, p, currentUser, currentRole);
  };
  _pdPanel.querySelectorAll('#pd-tabs .subtab-btn').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.pd)));
  showTab(initialTab);
};

// ── Overview tab ──
async function renderProjOverview(host, p, currentUser, currentRole, canBill){
  const canManage = canEditDept('Design');
  const team = p.teamNames || [];

  // Sales-order handoff card (Finance→Design flow, 2026-08-11) — only for
  // auto-created SO projects. Soft-fail: never blocks the rest of the tab.
  let so = null, job = null;
  if (p.salesOrderId) {
    try { const s = await db.collection('sales_orders').doc(p.salesOrderId).get(); if (s.exists) so = { id:s.id, ...s.data() }; } catch(_){}
    if (p.jobProjectId) { try { const j = await db.collection('job_projects').doc(p.jobProjectId).get(); if (j.exists) job = { id:j.id, ...j.data() }; } catch(_){} }
  }
  const items = (job && Array.isArray(job.items)) ? job.items : [];
  const canSendToProd = canEditDept('Design') && window.currentRole !== 'secretary';
  // Design money-privacy rule (mirrors isProductionOnlyViewer): this card may
  // show client, scope, quote number, items (name/qty/dims/spec), target date,
  // priority, notes and stage. It must NEVER render contractAmount,
  // paymentReceived/recordedAmount, payment method, receipts, VAT, AR/collected,
  // margin, or split.
  const handoffCard = so ? `
    <div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:12px 14px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:8px">
        <div style="font-size:13px;font-weight:700">${emojiIcon('🧾',16)} Sales Order — for production</div>
        ${so.sentToProduction?`<span class="badge badge-green">Sent to Production</span>`:''}
      </div>
      ${items.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>Item</th><th style="text-align:right">Qty</th></tr></thead><tbody>
        ${items.map(it=>`<tr><td>${escHtml(it.name||'')}${(it.dims||it.specStr)?`<div style="font-size:11px;color:var(--text-muted)">${escHtml(it.dims||it.specStr||'')}</div>`:''}</td><td style="text-align:right">${Number(it.qty)||0} ${escHtml(it.unit||'')}</td></tr>`).join('')}
      </tbody></table></div>`:''}
      <div style="font-size:12px;color:var(--text-muted);margin-top:8px">Target ${escHtml(so.targetDate||'—')} · Priority ${escHtml(so.priority||'—')}</div>
      ${(!so.sentToProduction && canSendToProd)?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        <button class="btn-success btn-sm" id="dsn-to-prod">${emojiIcon('🏭',16)} Send to Production</button>
        <button class="btn-secondary btn-sm" id="dsn-no-dwg">No drawings needed — send to Production</button>
      </div>`:''}
    </div></div>
  ` : '';

  host.innerHTML = `
    ${handoffCard}
    <div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:12px 14px;font-size:13px;display:grid;grid-template-columns:auto 1fr;gap:6px 12px">
      <span style="color:var(--text-muted)">Client</span><span>${p.client?escHtml(p.client):'<span style="color:var(--text-muted)">—</span>'}</span>
      <span style="color:var(--text-muted)">Status</span><span><span class="badge ${statusBadge(p.status)}">${escHtml(p.status||'active')}</span></span>
      <span style="color:var(--text-muted)">Start</span><span>${escHtml(p.startDate||'—')}</span>
      <span style="color:var(--text-muted)">Due</span><span>${escHtml(p.dueDate||'—')}</span>
      <span style="color:var(--text-muted)">Design Lead</span><span>${p.designLeadName?escHtml(p.designLeadName):'<span style="color:var(--text-muted)">Unassigned</span>'}</span>
      <span style="color:var(--text-muted)">Job Project</span><span>${p.jobProjectNo?`<span class="badge badge-blue">${emojiIcon('🔗',16)} ${escHtml(p.jobProjectNo)}</span>`:'<span style="color:var(--text-muted)">Not linked</span>'}</span>
    </div></div>
    <div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:12px 14px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">${emojiIcon('👥',16)} Team</div>
      ${team.length?`<div style="display:flex;gap:6px;flex-wrap:wrap">${team.map(n=>`<span class="badge badge-blue">${escHtml(n)}</span>`).join('')}</div>`:'<div style="font-size:12px;color:var(--text-muted)">No members delegated yet.</div>'}
    </div></div>
    ${p.notes?`<div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:12px 14px;font-size:13px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">${emojiIcon('📝',16)} Notes</div>${escHtml(p.notes)}</div></div>`:''}
    ${canManage?`<button class="btn-primary btn-sm" id="proj-edit-btn">${emojiIcon('✏️',16)} Edit / Link / Delegate</button>`:''}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [host] });
  // ⚠ SCOPED TO `host`, NOT document. `host` is THIS project panel's
  // #pd-tab-body (openProjectDetail's showTab). Every reopen path in that hub
  // does `Overlay.clearAll(); openProjectDetail(...)` in one tick and openPage
  // defers node removal by 300ms, so a dying project panel — earlier in document
  // order — still holds a #proj-edit-btn and wins a document-wide lookup.
  host.querySelector('#proj-edit-btn')?.addEventListener('click',()=>openProjectEditModal(p, currentUser, currentRole, canBill));

  // Design → Production hand-off (owner's flow, 2026-08-11). Same panel-scoping
  // rule as everything else in this hub.
  if (so) {
    async function sendSO(passThrough){
      // released-drawings guard — one path, but never a silent skip
      let released = 0, total = 0;
      try { const ds = await db.collection('design_drawings').where('projectId','==',p.id).get();
            total = ds.docs.length; released = ds.docs.filter(x=>x.data().status==='released').length; } catch(_){}
      if (!passThrough && released === 0) {
        const ok = await confirmDialog({ message: total===0
          ? 'No drawings exist on this project yet. Send to Production anyway? (Use "No drawings needed" if this order genuinely needs none.)'
          : `None of the ${total} drawing(s) on this project are Released yet. Send to Production anyway?` });
        if (!ok) return;
      }
      if (passThrough) {
        const ok = await confirmDialog({ message:'Mark this order as needing NO drawings and send it straight to Production?' });
        if (!ok) return;
        await db.collection('sales_orders').doc(so.id).update({ noDrawingsNeeded:true });
        so.noDrawingsNeeded = true;
      }
      // Also enforces the Sales sign-off on the drawings now (see
      // transferOrderToProduction, js/departments.js) — it toasts the reason
      // and returns false rather than handing an unapproved job to the floor.
      const done = await window.transferOrderToProduction(so);   // enforces the targetDate/priority/notes gate
      if (!done) return;
      await db.collection('projects').doc(p.id).update({
        needsDrawings: !passThrough, productionHandoffAt: new Date().toISOString(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(()=>{});
      Object.assign(p, { needsDrawings:!passThrough, productionHandoffAt:new Date().toISOString() });
      if (typeof dbCacheInvalidate==='function') dbCacheInvalidate('projects-unified');
      Notifs.showToast('Sent to Production','success');
      window.Overlay.clearAll(); openProjectDetail(p, currentUser, currentRole, canBill, 'Overview');
    }
    host.querySelector('#dsn-to-prod')?.addEventListener('click', (e)=>window.busy(e.currentTarget, ()=>sendSO(false)));
    host.querySelector('#dsn-no-dwg')?.addEventListener('click', (e)=>window.busy(e.currentTarget, ()=>sendSO(true)));
  }
}

// ── Financials tab (logic lifted verbatim from the original project detail) ──
function renderProjFinancials(host, p, currentUser, currentRole, canBill){
  const contract = Number(p.contractAmount) || 0;
  const paid     = projectPaid(p);
  const balance  = contract - paid;
  const payments = (p.payments || []).slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const invoices = (p.invoices || []).slice().reverse();
  // clearAll() first — Record Payment/Billing Invoice are pushed ON TOP of this
  // hub's page (never nested deeper), so tearing the whole stack down and
  // reopening fresh is a single clean swap, never an accumulating stack.
  const reopen   = () => { window.Overlay.clearAll(); openProjectDetail(p, currentUser, currentRole, canBill, 'Financials'); };

  host.innerHTML = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      ${canBill && contract>0 ? `<button class="btn-primary btn-sm" id="proj-invoice-btn">${emojiIcon('🧾',16)} Create Billing Invoice</button>` : ''}
      ${canBill ? `<button class="btn-secondary btn-sm" id="proj-payment-btn">+ Record Payment</button>` : ''}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:16px">
      <div class="kpi-card"><div class="kpi-label">Contract</div><div class="kpi-value" style="font-size:15px">₱${fmt(contract)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Paid</div><div class="kpi-value" style="font-size:15px;color:#30D158">₱${fmt(paid)}</div></div>
      <div class="kpi-card ${balance>0.005?'warn':''}"><div class="kpi-label">Balance</div><div class="kpi-value" style="font-size:15px;color:${balance>0.005?'#FF453A':'#30D158'}">₱${fmt(balance)}</div></div>
    </div>
    <h4 style="margin:0 0 8px;font-size:13px">Payments</h4>
    ${payments.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Method</th><th>Note</th><th style="text-align:right">Amount</th></tr></thead><tbody>
      ${payments.map(x=>`<tr><td>${escHtml(x.date||'')}</td><td>${escHtml(x.method||'—')}</td><td>${escHtml(x.note||'')}</td><td style="text-align:right">₱${fmt(x.amount)}</td></tr>`).join('')}
    </tbody></table></div>` : `<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">No payments recorded yet.</div>`}
    <h4 style="margin:16px 0 8px;font-size:13px">Billing Invoices</h4>
    ${invoices.length ? `<div class="item-list">${invoices.map(inv=>`
      <div class="item-card" style="cursor:pointer" data-inv="${escHtml(inv.no)}">
        <div class="item-top"><div class="item-title" style="font-size:13px">${emojiIcon('🧾',13)} ${escHtml(inv.no)}</div><span>₱${fmt(inv.amount)}</span></div>
        <div class="item-meta"><span>${emojiIcon('📅',16)} ${escHtml(inv.date||'')}</span>${inv.due?`<span>Due ${escHtml(inv.due)}</span>`:''}<span>${escHtml(inv.desc||'')}</span></div>
      </div>`).join('')}</div>` : `<div style="font-size:12px;color:var(--text-muted)">No invoices issued yet.</div>`}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [host] });

  // Re-open a previously issued invoice (printable)
  host.querySelectorAll('.item-card[data-inv]').forEach(card => {
    card.addEventListener('click', () => {
      const inv = (p.invoices || []).find(i => i.no === card.dataset.inv);
      if (inv) openBillingInvoice(p, inv);
    });
  });

  // Record a payment
  // ⚠ SCOPED TO `host` (this project panel's #pd-tab-body) — see the note in
  // renderProjOverview above; a dying project panel carries the same ids.
  host.querySelector('#proj-payment-btn')?.addEventListener('click', async () => {
    // ── WINDOW INVERSION (v14 smoothness pass) ────────────────────────────────
    // openPage() takes a FINISHED html string, so this handler used to
    // `await window.BankAccounts.optionsHTML()` BEFORE calling it: between
    // finger-up and the response not one pixel changed, and by then the press
    // state had already released with nothing in the DOM to animate. The window
    // is now pushed SYNCHRONOUSLY, in the tap frame, carrying a skeleton body;
    // the real form is injected when the read lands. Nothing about WHAT is
    // fetched or rendered changed — the filled markup below is byte-identical to
    // what this call site produced before, down to the ${bankOpts} interpolation.
    const payPanel = openPage('Record Payment', window.skeletonHtml('rows', 5),
      // The footer is data-independent, so it ships WHOLE in the tap frame: the
      // window reads as finished immediately and Cancel is live throughout the
      // load (the user can always back out of a window they just opened).
      // "Save Payment" ships `disabled` because its handler reads #pay-amt /
      // #pay-date / #pay-bank — nodes that do not exist until the fill. A
      // disabled button dispatches no click from mouse OR keyboard, so the
      // listener wired directly below is simply unreachable until the fill
      // re-enables it, and stays unreachable forever on the failure path, where
      // there is no form to save in the first place.
      `<button class="btn-primary" id="save-pay-btn" disabled>Save Payment</button><button class="btn-secondary" id="pay-back-btn">Cancel</button>`);
    const payBody = payPanel.querySelector('.page-panel-body');
    // ⚠ SCOPED TO payPanel, NOT document.
    // A dismissed Record Payment window stays in the DOM for ~300ms. Record a
    // payment, then open Record Payment again inside that gap, and a document-wide
    // lookup resolves into the DEAD window: Save binds to a button nobody can see,
    // and — the money half of this bug — the reads below would take the PREVIOUS
    // payment's amount/date/method/note/bank and post THEM to the ledger.
    payPanel.querySelector('#pay-back-btn').addEventListener('click', reopen);
    payPanel.querySelector('#save-pay-btn').addEventListener('click', async () => {
      const amt = parseFloat(payPanel.querySelector('#pay-amt').value) || 0;
      if (amt <= 0) { Notifs.showToast('Enter a valid amount','error'); return; }
      // v14 prod-fixlist — mirror production.js's openProjectBillingModal gate:
      // don't let a payment land with zero bank-account attribution when the
      // registry is populated (pay-bank previously had no validation at all).
      const bankSel = payPanel.querySelector('#pay-bank').value;
      if (!bankSel && (await window.BankAccounts.list()).length) {
        Notifs.showToast('Select the company account that received this payment.','error'); return;
      }
      const acct = await window.BankAccounts.pick(bankSel);
      const payment = {
        amount: amt,
        date:   payPanel.querySelector('#pay-date').value || today(),
        method: payPanel.querySelector('#pay-method').value.trim(),
        note:   payPanel.querySelector('#pay-note').value.trim(),
        byName: currentUser.displayName || currentUser.email || '',
        by:     currentUser.uid
      };
      if (!(await confirmDialog({message:`Record payment of ₱${fmt(amt)} for "${escHtml(p.name)}"? This updates the project balance.`, html:true}))) return;
      const payBtn = payPanel.querySelector('#save-pay-btn');
      if (payBtn) payBtn.disabled = true; // guard against double-click double-posting
      try {
        // v13 Phase 13 — the project.payments append now rides inside the SAME
        // transaction as the ledger post (projectSync), so the two can never
        // drift apart (previously: payments array committed in its own tx, then
        // the ledger post was a best-effort follow-up that could silently fail).
        // arrayUnion avoids needing to read the current array first.
        const vatRate = 12, net = +(amt/(1+vatRate/100)).toFixed(2), vatAmount = +(amt-net).toFixed(2);
        // Money-critical fix (beta sweep) — was `DPROJ-${p.id}-${p.payments.length}`,
        // a POSITIONAL index off the in-memory `p` snapshot. Two payments recorded
        // close together (stale `p`, two tabs) computed the SAME ref; the 2nd hit
        // Ledger.post's dedupe (existed:true), so its projectSync arrayUnion never
        // committed — the payment was silently LOST while the code still toasted
        // "Payment recorded" (the return value was never checked). Since this posts
        // to Sales Revenue, that's unbilled revenue. Mint a fresh Firestore auto-id
        // per payment so distinct payments can never collide, and honour
        // Ledger.post's {existed} instead of always claiming success. (Mirror of the
        // production.js openProjectBillingModal fix.)
        const paymentId = db.collection('ledger').doc().id;
        payment.paymentId = paymentId;
        const dref = `DPROJ-${p.id}-${paymentId}`;
        const postRes = await window.Ledger.post({
          ref: dref, date: payment.date, kind: 'credit',
          accountType: 'income', account: 'Sales Revenue', category: 'Sales Revenue',
          description: `Design project — ${p.name||p.id}${payment.note?' ('+payment.note+')':''}`,
          amount: amt, source: 'Design', projectId: p.id,
          extra: { net, vatAmount, ...window.BankAccounts.tag(acct, 'in') },
          projectSync: { collection: 'projects', docId: p.id, fields: { payments: firebase.firestore.FieldValue.arrayUnion(payment) } }
        });
        if (postRes && postRes.existed) {
          Notifs.showToast('This payment was already recorded — nothing new was posted.','error');
          if (payBtn) payBtn.disabled = false;
          return;
        }
        p.payments = [...(p.payments||[]), payment];
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('projects-unified');
        Notifs.showToast('Payment recorded','success');
        reopen();
      } catch(e) { console.warn(e); Notifs.showToast('Could not save payment','error'); if (payBtn) payBtn.disabled = false; }
    });

    // ── skeleton → fetch → fill (or error) ────────────────────────────────────
    // withLoadingAndError (js/ui-states.js) already owns this whole lifecycle:
    // it repaints the same skeleton, awaits the fetcher, calls the renderer, and
    // on a rejection swaps in an error block with an internally-wired Retry — so
    // a failed read can never leave an eternal skeleton. It also runs the single
    // post-injection lucide sweep, which is what hydrates the icons inside the
    // markup we inject here (they would render as blank gaps otherwise).
    // The fetcher is the SAME call, with the same arguments, that used to sit on
    // the line above openPage.
    await window.withLoadingAndError(payBody,
      () => window.BankAccounts.optionsHTML(),
      (bankOpts) => {
        // CLOSED MID-FLIGHT — Back can be pressed before the read lands. See
        // pageStillOpen() at the top of this file for why isConnected alone is
        // not sufficient here (300ms teardown removal timer).
        if (!pageStillOpen(payPanel)) return;
        payBody.innerHTML = `
      <div class="form-group"><label>Amount (₱)</label><input id="pay-amt" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00"/></div>
      <div class="form-group"><label>Date</label><input id="pay-date" type="date" value="${today()}"/></div>
      <div class="form-group"><label>Method</label><input id="pay-method" placeholder="e.g. Bank transfer, Cash, Cheque"/></div>
      <div class="form-group"><label>Reference / Note</label><input id="pay-note" placeholder="OR no., remarks"/></div>
      <div class="form-group"><label>Deposited to (company account) — optional</label>
        <select id="pay-bank" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${bankOpts}</select></div>
    `;
        // The form exists now, so the save handler's DOM reads can all resolve.
        // Scoped to this panel rather than document-wide: a buried page underneath
        // could in principle carry the same id, and this is the one place where
        // grabbing the wrong one would silently arm the wrong window's button.
        const payEnable = payPanel.querySelector('#save-pay-btn');
        if (payEnable) payEnable.disabled = false;
      },
      { skeleton: 'rows', skeletonCount: 5 });
  });

  // Create a billing invoice for collection of balance
  // ⚠ SCOPED TO `host` (this project panel's #pd-tab-body) — see renderProjOverview.
  host.querySelector('#proj-invoice-btn')?.addEventListener('click', () => {
    const bal = (Number(p.contractAmount)||0) - projectPaid(p);
    // ⚠ SCOPED TO THIS PANEL, NOT document — openPage's ~300ms teardown window
    // means a dying invoice window can win a document-wide lookup, arming its
    // buttons and feeding this invoice the PREVIOUS one's amount/date/bill-to.
    const invPanel = openPage('Billing Invoice — Collection of Balance', `
      <div class="form-group"><label>Bill To</label><input id="inv-billto" value="${escHtml(p.client||'')}"/></div>
      <div class="form-row">
        <div class="form-group"><label>Invoice Date</label><input id="inv-date" type="date" value="${today()}"/></div>
        <div class="form-group"><label>Due Date</label><input id="inv-due" type="date"/></div>
      </div>
      <div class="form-group"><label>Particulars</label><input id="inv-desc" value="Collection of outstanding balance"/></div>
      <div class="form-group"><label>Amount to Collect (₱)</label><input id="inv-amt" type="number" inputmode="decimal" step="0.01" min="0" value="${bal>0?bal.toFixed(2):'0.00'}"/></div>
      <div class="form-group"><label>Notes / Payment Instructions</label><textarea id="inv-notes" rows="3">Kindly settle the amount due on or before the due date. Payable to Barro Industries OPC.</textarea></div>
    `, `<button class="btn-primary" id="gen-inv-btn">Generate Invoice</button><button class="btn-secondary" id="inv-back-btn">Cancel</button>`);
    invPanel.querySelector('#inv-back-btn').addEventListener('click', reopen);
    invPanel.querySelector('#gen-inv-btn').addEventListener('click', async () => {
      const amt = parseFloat(invPanel.querySelector('#inv-amt').value) || 0;
      if (amt <= 0) { Notifs.showToast('Enter a valid amount','error'); return; }
      const contractC = Number(p.contractAmount) || 0;
      const paidC     = projectPaid(p);
      const inv = {
        date:           invPanel.querySelector('#inv-date').value || today(),
        due:            invPanel.querySelector('#inv-due').value || '',
        billTo:         invPanel.querySelector('#inv-billto').value.trim(),
        desc:           invPanel.querySelector('#inv-desc').value.trim(),
        amount:         amt,
        notes:          invPanel.querySelector('#inv-notes').value.trim(),
        contractAmount: contractC,
        paidToDate:     paidC,
        balanceBefore:  contractC - paidC,
        projectName:    p.name || '',
        issuedBy:       currentUser.displayName || currentUser.email || '',
        createdAt:      today()
      };
      if (!(await confirmDialog({message:`Generate billing invoice for ₱${fmt(amt)} (${escHtml(p.name||'')})?`, html:true}))) return;
      const invBtn = invPanel.querySelector('#gen-inv-btn');
      if (invBtn) invBtn.disabled = true; // guard against double-click double-posting
      try {
        // v14 prod-fixlist — was minting 'INV-' + today().replace(/-/g,'') + '-' +
        // seq, a per-project daily counter that can collide with the parallel
        // job_projects billing-invoice flow (production.js's
        // openJobBillingInvoiceModal), which already mints via the atomic,
        // _counters-backed window.nextSerial('billing_invoice','INV'). Both flows
        // now share the SAME counter/series, so an INV-# can never collide across
        // a Design project and a Job Project invoice issued in the same instant.
        // Minted AFTER confirm (same rule production.js documents) so a cancelled
        // dialog burns no serial.
        inv.no = await window.nextSerial('billing_invoice', 'INV');
        const ref = db.collection('projects').doc(p.id);
        const saved = await db.runTransaction(async tx => {
          const doc  = await tx.get(ref);
          const cur  = (doc.exists && Array.isArray(doc.data().invoices)) ? doc.data().invoices : [];
          const next = [...cur, inv];
          tx.update(ref, { invoices: next });
          return next;
        });
        p.invoices = saved;
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('projects-unified');
      } catch(e) {
        console.warn('Invoice not saved to project record:', e);
        Notifs.showToast('Could not save invoice — not recorded','error');
        if (invBtn) invBtn.disabled = false;
        return;
      }
      openBillingInvoice(p, inv);
    });
  });
}

// ── Tasks tab — design tasks scoped to this project ──
async function renderProjectTasks(host, p, currentUser, currentRole, canBill){
  host.innerHTML = '<div class="loading-placeholder">Loading tasks…</div>';
  const canManage = canEditDept('Design');
  let tasks;
  try {
    const snap = await db.collection('tasks').where('projectId','==',p.id).get();
    tasks = snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch(e){
    // v14 prod-fixlist — was console.warn-only with tasks left [], so a genuine
    // permission error rendered identically to "no tasks for this project".
    console.warn('project tasks load failed', e);
    host.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load tasks</h4><p>${escHtml(e.message||String(e))}</p><button type="button" class="btn-secondary btn-sm pt-retry-btn" style="margin-top:14px">Retry</button></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [host] });
    host.querySelector('.pt-retry-btn')?.addEventListener('click', ()=>renderProjectTasks(host, p, currentUser, currentRole, canBill));
    return;
  }
  tasks.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  host.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
      ${canManage?`<button class="btn-primary btn-sm" id="proj-add-task-btn">+ Delegate Task</button>`:''}
    </div>
    ${tasks.length?`<div class="item-list">${tasks.map(taskCard).join('')}</div>`:`<div class="empty-state" style="padding:20px"><div class="empty-icon">${emojiIcon('📋',44)}</div><h4>No tasks for this project</h4></div>`}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [host] });
  host.querySelectorAll('.item-card[data-id]').forEach(card=>card.addEventListener('click',()=>openTaskDetail(card.dataset.id, currentUser, currentRole)));
  // ⚠ SCOPED TO `host` (this project panel's #pd-tab-body) — see renderProjOverview.
  host.querySelector('#proj-add-task-btn')?.addEventListener('click',()=>openAddProjectTaskModal(p, currentUser, currentRole, canBill));
}

// ── Activity tab — merged project + drawing timeline ──
async function renderProjActivity(host, p, currentUser, currentRole){
  host.innerHTML = '<div class="loading-placeholder">Loading activity…</div>';
  const events = [];
  (p.payments||[]).forEach(x=>events.push({at:x.date||'', html:`${emojiIcon('💵',16)} Payment <strong>₱${fmt(x.amount)}</strong>`, by:x.byName||''}));
  (p.invoices||[]).forEach(x=>events.push({at:x.date||x.createdAt||'', html:`${emojiIcon('🧾',16)} Invoice ${escHtml(x.no||'')} <strong>₱${fmt(x.amount)}</strong>`, by:x.issuedBy||''}));
  try {
    const snap = await db.collection('design_drawings').where('projectId','==',p.id).get();
    snap.docs.forEach(d=>{ const dr=d.data(); (dr.activity||[]).forEach(a=>events.push({at:a.at||'', html:`${emojiIcon('📐',16)} ${escHtml(dr.title||'Drawing')}: ${escHtml(a.event||'')}`, by:a.byName||''})); });
  } catch(e){ console.warn(e); }
  events.sort((a,b)=>(''+(b.at)).localeCompare(''+(a.at)));
  host.innerHTML = events.length
    ? `<div style="font-size:12px">${events.map(e=>`<div style="padding:6px 0;border-bottom:1px solid var(--border)"><div>${e.html}</div><div style="font-size:11px;color:var(--text-muted)">${escHtml(window.fmtManila(e.at))}${e.by?' · '+escHtml(e.by):''}</div></div>`).join('')}</div>`
    : `<div class="empty-state" style="padding:20px"><div class="empty-icon">${emojiIcon('🕘',44)}</div><h4>No activity yet</h4></div>`;
  if (window.lucide) lucide.createIcons({ nodes: [host] });
}

// ── Edit project: rename, status, client link, team delegation, job-project link ──
async function openProjectEditModal(p, currentUser, currentRole, canBill){
  // v12 WS35 — unified client book (WS32). Design-brand clients listed first;
  // linking a project to any client makes them a design client (brands arrayUnion
  // on save). Falls back to legacy design_clients read-only compat until
  // migrateClientBooks() has run (window.Clients.listAll() handles that itself).
  //
  // ── WINDOW INVERSION (v14 smoothness pass) ────────────────────────────────
  // This function used to await three reads (users + the unified client book +
  // job_projects) before it called openPage, so tapping "Edit / Link / Delegate"
  // produced nothing at all until the slowest of them landed. The window is now
  // pushed synchronously with a skeleton body and filled when the Promise.all
  // resolves — same three reads, same arguments, same soft-fallback .catch()es,
  // same rendered form.
  let team = (p.team||[]).map((uid,i)=>({uid, name:(p.teamNames||[])[i]||uid}));
  // Hoisted out of the fill because the SAVE handler reads it (the `_legacy`
  // test further down decides whether to stamp `brands: ['design']` onto the
  // clients doc). That handler is wired in the tap frame, before the fetch has
  // landed, so it has to close over a binding that the fill can later populate
  // rather than over a value that does not exist yet. It stays [] only on the
  // failure path — where the save button is never enabled, so it is never read.
  let allClients = [];

  const pePanel = openPage('Edit Project', window.skeletonHtml('rows', 9), `<button class="btn-primary" id="pe-save-btn" disabled>Save</button><button class="btn-secondary" id="pe-cancel-btn">Cancel</button>`);
  const peBody  = pePanel.querySelector('.page-panel-body');
  // Cancel is data-independent and live immediately; Save ships `disabled`
  // because every field it reads (#pe-name … #pe-job) is injected by the fill —
  // see the same reasoning spelled out at the Record Payment call site above.
  // ⚠ SCOPED TO pePanel, NOT document — openPage's ~300ms teardown window means
  // a dying Edit Project window still holds #pe-cancel-btn/#pe-save-btn and every
  // #pe-* field, and would win a document-wide lookup.
  pePanel.querySelector('#pe-cancel-btn').addEventListener('click',()=>{ window.Overlay.clearAll(); openProjectDetail(p, currentUser, currentRole, canBill, 'Overview'); });

  const peFormHtml = (users, clients, jobs) => `
    <div class="form-group"><label>Project Name</label><input id="pe-name" value="${escHtml(p.name||'')}"/></div>
    <div class="form-group"><label>Client (unified CRM)</label>
      <select id="pe-client"><option value="">— None / free text —</option>
        ${clients.map(c=>`<option value="${c.id}" data-name="${escHtml(c.name||c.company||'')}" ${p.clientId===c.id?'selected':''}>${escHtml(c.name||c.company||'Client')}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Client name (display)</label><input id="pe-clientname" value="${escHtml(p.client||'')}" placeholder="Shown on cards & invoices"/></div>
    <div class="form-row">
      <div class="form-group"><label>Start Date</label><input id="pe-start" type="date" value="${escHtml(p.startDate||'')}"/></div>
      <div class="form-group"><label>Due Date</label><input id="pe-due" type="date" value="${escHtml(p.dueDate||'')}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Status</label>
        <select id="pe-status">${['active','on-hold','completed','cancelled'].map(s=>`<option value="${s}" ${(p.status||'active')===s?'selected':''}>${s}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Contract (₱)</label><input id="pe-contract" type="number" step="0.01" min="0" value="${Number(p.contractAmount)||0}" inputmode="decimal"/></div>
    </div>
    <div class="form-group"><label>Design Lead</label>
      <select id="pe-lead"><option value="">— Unassigned —</option>
        ${users.map(u=>`<option value="${u.id}" data-name="${escHtml(u.displayName||u.email)}" ${p.designLead===u.id?'selected':''}>${escHtml(u.displayName||u.email)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Team (delegate — add multiple)</label>
      <select id="pe-team-sel"><option value="">— Add member —</option>
        ${users.map(u=>`<option value="${u.id}" data-name="${escHtml(u.displayName||u.email)}">${escHtml(u.displayName||u.email)}</option>`).join('')}
      </select>
      <div id="pe-team-chips" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"></div>
    </div>
    <div class="form-group"><label>Link to Job Project (Sales/Production lifecycle)</label>
      <select id="pe-job"><option value="">— Not linked —</option>
        ${jobs.map(j=>`<option value="${j.id}" data-no="${escHtml(j.projectNo||'')}" ${p.jobProjectId===j.id?'selected':''}>${escHtml((j.projectNo||'')+' — '+(j.clientName||j.name||''))}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Notes</label><textarea id="pe-notes" rows="3">${escHtml(p.notes||'')}</textarea></div>
  `;

  pePanel.querySelector('#pe-save-btn').addEventListener('click', async () => {
    const prevTeam = new Set(p.team||[]);
    const prevJob  = p.jobProjectId || null;
    const clientSel = pePanel.querySelector('#pe-client');
    const leadSel   = pePanel.querySelector('#pe-lead');
    const jobSel    = pePanel.querySelector('#pe-job');
    const clientId  = clientSel.value || null;
    const clientNameSel = clientSel.options[clientSel.selectedIndex]?.dataset.name || '';
    const newContractAmount = parseFloat(pePanel.querySelector('#pe-contract').value) || 0;
    // v14 prod-fixlist — renderProjFinancials/renderProjects treat balance<=0.005
    // as "Fully Paid" purely from (contract - collected). Letting the contract be
    // edited below what's already been collected silently flipped a project to
    // "Fully Paid" with no record that an over-collection now needs a refund or
    // contract amendment — so floor it at the amount already on file.
    const alreadyPaid = projectPaid(p);
    if (newContractAmount < alreadyPaid - 0.005) {
      Notifs.showToast(`Contract amount (₱${fmt(newContractAmount)}) can't be set below the ₱${fmt(alreadyPaid)} already collected — record a refund/contract amendment first, or correct the collected payments instead.`, 'error');
      return;
    }
    const update = {
      name:           pePanel.querySelector('#pe-name').value.trim() || p.name || 'Project',
      client:         pePanel.querySelector('#pe-clientname').value.trim() || clientNameSel || '',
      clientId,
      startDate:      pePanel.querySelector('#pe-start').value,
      dueDate:        pePanel.querySelector('#pe-due').value,
      status:         pePanel.querySelector('#pe-status').value,
      contractAmount: newContractAmount,
      notes:          pePanel.querySelector('#pe-notes').value.trim(),
      designLead:     leadSel.value || null,
      designLeadName: leadSel.value ? (leadSel.options[leadSel.selectedIndex]?.dataset.name || null) : null,
      team:           team.map(a=>a.uid),
      teamNames:      team.map(a=>a.name),
      jobProjectId:   jobSel.value || null,
      jobProjectNo:   jobSel.value ? (jobSel.options[jobSel.selectedIndex]?.dataset.no || null) : null,
      updatedAt:      firebase.firestore.FieldValue.serverTimestamp(),
    };
    try {
      await db.collection('projects').doc(p.id).update(update);
      Object.assign(p, update);
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('projects-unified');
      // v12 WS35: linking a project to a client marks them a design-brand client
      // (skip legacy pre-migration compat docs — their real home is `clients`,
      // fixed up later by remapDesignProjectClients()).
      if (clientId && clientId !== (p.clientId||null) && !allClients.find(c=>c.id===clientId)?._legacy) {
        try { await db.collection('clients').doc(clientId).update({ brands: firebase.firestore.FieldValue.arrayUnion('design') });
              if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('clients'); } catch(_){}
      }
      const who = window.userProfile?.displayName || currentUser.email || '';
      // notify newly delegated team members
      for (const a of team) {
        if (!prevTeam.has(a.uid) && a.uid!==currentUser.uid) {
          try { await Notifs.send(a.uid,{title:'🎨 Added to a Design project',body:`You're on "${update.name}"`,icon:'🎨',type:'project_team',link:'dept:Design',dedupKey:`projteam-${p.id}-${a.uid}`}); } catch(_){}
        }
      }
      // notify Finance when a job-project link is newly set
      if (update.jobProjectId && update.jobProjectId!==prevJob) {
        try { await Notifs.sendToDept('Finance',{title:'🔗 Design project linked',body:`"${update.name}" linked to job ${update.jobProjectNo||''}`,icon:'🔗',type:'project_link',link:'projects-lifecycle'}); } catch(_){}
      }
      Notifs.showToast('Project saved','success');
    } catch(e){ console.warn(e); Notifs.showToast('Could not save project','error'); return; }
    window.Overlay.clearAll(); openProjectDetail(p, currentUser, currentRole, canBill, 'Overview');
  });

  // ── skeleton → fetch → fill (or error) ──────────────────────────────────────
  // Same three reads, same order, same per-read .catch() fallbacks as before the
  // inversion — only the call site moved. withLoadingAndError (js/ui-states.js)
  // owns the skeleton, the error block + Retry, and the one post-injection lucide
  // sweep, so a rejected read shows a retryable error instead of an eternal
  // skeleton. NOTE the Promise.all can effectively only reject if one of these
  // globals is missing outright (window.Clients undefined at tap time) — the
  // per-read failures are absorbed by the .catch()es exactly as they always were,
  // which is what keeps "user list failed to load" rendering an empty picker
  // rather than a hard error, i.e. today's behaviour.
  await window.withLoadingAndError(peBody,
    () => Promise.all([
      dbCachedGet('users', ()=>db.collection('users').get(), 60000).catch(()=>({docs:[]})),
      window.Clients.listAll().catch(()=>[]),
      db.collection('job_projects').orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
    ]),
    ([uSnap, fetchedClients, jSnap]) => {
      // CLOSED MID-FLIGHT — see pageStillOpen() at the top of this file.
      if (!pageStillOpen(pePanel)) return;
      allClients    = fetchedClients;                       // publish to the save handler
      const users   = uSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
      const clients = [...allClients].sort((a,b)=>
        (b.brands.includes('design')?1:0)-(a.brands.includes('design')?1:0) || (a.name||'').localeCompare(b.name||''));
      const jobs    = jSnap.docs.map(d=>({id:d.id,...d.data()}));
      peBody.innerHTML = peFormHtml(users, clients, jobs);

      // ── LISTENERS WIRED AFTER THE FILL ──────────────────────────────────────
      // These three used to run on the line after openPage, when the body already
      // held the real markup. Post-inversion that markup does not exist until
      // here, so wiring them any earlier would silently bind nothing. Queries are
      // scoped to peBody (not document) so they can only ever resolve inside the
      // panel we just filled.
      const renderChips = () => {
        const wrap = peBody.querySelector('#pe-team-chips');
        if (!wrap) return;
        wrap.innerHTML = team.map(a=>`<span class="badge badge-blue team-chip" data-uid="${a.uid}" style="cursor:pointer">${escHtml(a.name)} ${emojiIcon('✕',16)}</span>`).join('');
        if (window.lucide) lucide.createIcons({ nodes: [wrap] });
        wrap.querySelectorAll('.team-chip').forEach(ch=>ch.addEventListener('click',()=>{ team=team.filter(x=>x.uid!==ch.dataset.uid); renderChips(); }));
      };
      renderChips();
      peBody.querySelector('#pe-team-sel').addEventListener('change',e=>{
        const uid=e.target.value, name=e.target.options[e.target.selectedIndex]?.dataset.name||'';
        if (uid && !team.some(a=>a.uid===uid)) team.push({uid,name});
        e.target.value=''; renderChips();
      });
      // Picking a client auto-fills the display name (free text remains an override).
      peBody.querySelector('#pe-client').addEventListener('change', e => {
        const nm = e.target.options[e.target.selectedIndex]?.dataset.name || '';
        const disp = peBody.querySelector('#pe-clientname');
        if (nm && !disp.value.trim()) disp.value = nm;
      });

      const peSave = pePanel.querySelector('#pe-save-btn');
      if (peSave) peSave.disabled = false;
    },
    { skeleton: 'rows', skeletonCount: 9 });
}

// ── Per-project Drawings ──
async function renderProjectDrawings(host, p, currentUser, currentRole, canBill){
  host.innerHTML = '<div class="loading-placeholder">Loading drawings…</div>';
  const canManage = canEditDept('Design');
  let drawings;
  try {
    const snap = await db.collection('design_drawings').where('projectId','==',p.id).get();
    drawings = snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch(e){
    // v14 prod-fixlist — was console.warn-only with drawings left [], so a
    // genuine permission error rendered identically to "no drawings yet".
    console.warn('drawings load failed', e);
    host.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load drawings</h4><p>${escHtml(e.message||String(e))}</p><button type="button" class="btn-secondary btn-sm pd-retry-btn" style="margin-top:14px">Retry</button></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [host] });
    host.querySelector('.pd-retry-btn')?.addEventListener('click', ()=>renderProjectDrawings(host, p, currentUser, currentRole, canBill));
    return;
  }
  const order = DRAWING_STATUSES.map(s=>s.id);
  drawings.sort((a,b)=>(order.indexOf(a.status)-order.indexOf(b.status)) || (''+(a.title||'')).localeCompare(''+(b.title||'')));
  host.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <span style="font-size:12px;color:var(--text-muted)">${drawings.length} drawing${drawings.length===1?'':'s'}</span>
      ${canManage?`<button class="btn-primary btn-sm" id="proj-add-dwg-btn">+ New Drawing</button>`:''}
    </div>
    ${drawings.length?`<div class="item-list">${drawings.map(drawingCard).join('')}</div>`:`<div class="empty-state" style="padding:20px"><div class="empty-icon">${emojiIcon('📐',44)}</div><h4>No drawings yet</h4><p>Attach DWG, PDF or drawings to this project.</p></div>`}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [host] });
  host.querySelectorAll('.item-card[data-dwg]').forEach(card=>card.addEventListener('click',()=>{
    const d = drawings.find(x=>x.id===card.dataset.dwg);
    if (d) openDrawingDetail(d, p, currentUser, currentRole, canBill);
  }));
  // ⚠ SCOPED TO `host` (this project panel's #pd-tab-body) — see renderProjOverview.
  host.querySelector('#proj-add-dwg-btn')?.addEventListener('click',()=>openDrawingCreateModal(p, currentUser, currentRole, canBill));
}

// ── Per-project Files (v12 WS35 — WS38 Files Hub contract, scope 'projects') ──
// All reads/mutations via window.FilesHub / hub_files directly — do NOT
// re-implement upload/version/share/bin logic that WS38 already owns.
async function renderProjectFiles(host, p, currentUser, currentRole){
  host.innerHTML = '<div class="loading-placeholder">Loading files…</div>';
  const canManage = canEditDept('Design');
  const folderId = `proj__${p.id}`;                       // deterministic (DesignFolders)
  const all = await FilesHub.loadFiles('projects').catch(()=>[]);
  const files = all.filter(f => f.projectId === p.id || f.folderId === folderId);
  host.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted)">${emojiIcon('📁',16)} Project folder${p.clientId?` · client folder: ${escHtml(p.client||'Client')}`:''}</div>
      ${canManage?`<button class="btn-primary btn-sm" id="pf-upload-btn">＋ Upload</button>`:''}
    </div>
    ${files.length ? `<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Name</th><th>By</th><th>Date</th><th>Ver</th><th></th></tr></thead><tbody>
      ${files.map(f=>`<tr>
        <td>${escHtml(f.name||'')}</td>
        <td style="font-size:11px">${escHtml(f.uploaderName||'')}</td>
        <td style="font-size:11px;color:var(--text-muted)">${f.createdAt&&f.createdAt.toDate?f.createdAt.toDate().toLocaleDateString('en-PH'):''}</td>
        <td><span class="badge badge-gray">v${f.currentV||1}</span></td>
        <td><button class="btn-secondary btn-sm pf-view-btn" data-id="${f.id}">${emojiIcon('👁',16)}</button></td>
      </tr>`).join('')}</tbody></table></div>`
    : `<div class="empty-state" style="padding:20px"><div class="empty-icon">${emojiIcon('📁',44)}</div><h4>No files in this project folder yet</h4></div>`}
    <div id="pf-upload-area" style="margin-top:10px;display:none"></div>`;
  if (window.lucide) lucide.createIcons({ nodes: [host] });
  host.querySelectorAll('.pf-view-btn').forEach(b=>b.addEventListener('click',()=>{
    const f = files.find(x=>x.id===b.dataset.id); if (f) window.openFilePreview(f);
  }));
  // ⚠ SCOPED TO `host` (this project panel's #pd-tab-body) — see renderProjOverview.
  host.querySelector('#pf-upload-btn')?.addEventListener('click', async () => {
    const area = host.querySelector('#pf-upload-area'); area.style.display='block';
    const fid = await DesignFolders.ensureProjectFolder(p);   // lazy folder creation
    Drive.renderUploadArea('pf-upload-area', async (r, file) => {
      const FV = firebase.firestore.FieldValue;
      const who = window.userProfile?.displayName || currentUser.email || '';
      await db.collection('hub_files').add({           // FULL WS38 Spec-1 shape + domain fields
        name: (file?.name || r.name || 'File'), description:'', fileType:'File', kind:'file',
        scope:'projects', department:'Design', folderId: fid,
        projectId: p.id, clientId: p.clientId || null,           // WS32/WS38 contract fields
        url: r.url, driveUrl: null, size: file?.size || null, contentType: file?.type || null,
        source:'firebase', currentV: 1,
        versions: [{ v:1, url:r.url, name:(file?.name||r.name||''), size:file?.size||null,
          contentType:file?.type||null, note:'', by:currentUser.uid, byName:who, at:new Date().toISOString() }],
        archived:false, deleted:false, deletedAt:null, deletedBy:null,
        visibility:'company', sharedUserIds:[], editorUserIds:[], shares:[],
        uploadedBy: currentUser.uid, uploaderName: who,
        createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp(),
      });
      Notifs.showToast('File added to the project folder','success');
      renderProjectFiles(host, p, currentUser, currentRole);
    }, { label:'Upload project file', dept:'Design', subfolder:'Files' });  // WS38 storage-path contract: 2 segments, never deeper
  });
}

async function openDrawingCreateModal(project, currentUser, currentRole, canBill){
  // ── WINDOW INVERSION (v14 smoothness pass) ────────────────────────────────
  // The users read used to sit ABOVE openPage, so "+ New Drawing" showed nothing
  // until it resolved. Window first (skeleton body), read second, fill third.
  // Same dbCachedGet call with the same key/TTL/fallback; same rendered form.
  // `uploaded` is hoisted above openPage because the save handler — wired in the
  // tap frame — closes over it, while the upload widget that assigns it can only
  // be mounted after the fill (its host div is part of the injected markup).
  let uploaded = null;
  const dwPanel = openPage('New Drawing', window.skeletonHtml('rows', 5), `<button class="btn-primary" id="dw-save-btn" disabled>Create Drawing</button><button class="btn-secondary" id="dw-cancel-btn">Cancel</button>`);
  const dwBody  = dwPanel.querySelector('.page-panel-body');
  // ⚠ SCOPED TO dwPanel, NOT document — openPage's ~300ms teardown window means
  // a dying New Drawing window still holds every #dw-* id and would win a
  // document-wide lookup, both at bind time and inside the save handler (which
  // would then create the drawing from the PREVIOUS form's title/no./type).
  dwPanel.querySelector('#dw-cancel-btn').addEventListener('click',()=>{ window.Overlay.clearAll(); openProjectDetail(project, currentUser, currentRole, canBill, 'Drawings'); });
  dwPanel.querySelector('#dw-save-btn').addEventListener('click', async () => {
    const title = dwPanel.querySelector('#dw-title').value.trim();
    if (!title){ Notifs.showToast('Enter a drawing title','error'); return; }
    const asel = dwPanel.querySelector('#dw-assignee');
    const assignedTo = asel.value || null;
    const assignedToName = asel.value ? (asel.options[asel.selectedIndex]?.dataset.name || null) : null;
    const note = dwPanel.querySelector('#dw-note').value.trim();
    const who = window.userProfile?.displayName || currentUser.email || '';
    const nowIso = new Date().toISOString();
    const rev0 = { rev:'A', status:'draft', fileUrl:uploaded?.url||null, fileName:uploaded?.name||null, driveUrl:uploaded?.driveUrl||null, note, by:currentUser.uid, byName:who, at:nowIso };
    try {
      const ref = await db.collection('design_drawings').add({
        projectId: project.id, projectName: project.name||'',
        title, drawingNo: dwPanel.querySelector('#dw-no').value.trim(),
        type: dwPanel.querySelector('#dw-type').value,
        status:'draft', currentRev:'A',
        fileUrl:uploaded?.url||null, fileName:uploaded?.name||null, driveUrl:uploaded?.driveUrl||null, fileSource:uploaded?.source||(uploaded?'firebase':null),
        assignedTo, assignedToName, approver:null, approverName:null, approvedAt:null,
        revisions:[rev0],
        activity:[{ at:nowIso, event:'Drawing created (Rev A)', by:currentUser.uid, byName:who }],
        createdBy: currentUser.uid, createdByName: who,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      if (assignedTo && assignedTo!==currentUser.uid) {
        try { await Notifs.send(assignedTo,{title:'🎨 Drawing assigned',body:`"${title}" — ${project.name||''}`,icon:'🎨',type:'drawing_assigned',link:'dept:Design',dedupKey:`dwg-assign-${ref.id}`}); } catch(_){}
      }
      window.logAudit && window.logAudit('create','design_drawing',ref.id,{project:project.name, title});
      Notifs.showToast('Drawing created','success');
    } catch(e){ console.warn(e); Notifs.showToast('Could not create drawing','error'); return; }
    window.Overlay.clearAll(); openProjectDetail(project, currentUser, currentRole, canBill, 'Drawings');
  });

  // ── skeleton → fetch → fill (or error) ──────────────────────────────────────
  await window.withLoadingAndError(dwBody,
    () => dbCachedGet('users', ()=>db.collection('users').get(), 60000).catch(()=>({docs:[]})),
    (uSnap) => {
      if (!pageStillOpen(dwPanel)) return;   // dismissed mid-flight — see pageStillOpen()
      const users = uSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
      dwBody.innerHTML = `
    <div class="form-group"><label>Title</label><input id="dw-title" placeholder="e.g. Ground Floor Plan"/></div>
    <div class="form-row">
      <div class="form-group"><label>Drawing No.</label><input id="dw-no" placeholder="e.g. A-101 (optional)"/></div>
      <div class="form-group"><label>Type</label><select id="dw-type">${DRAWING_TYPES.map(t=>`<option value="${t}">${t}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label>Assign Designer</label>
      <select id="dw-assignee"><option value="">— Unassigned —</option>
        ${users.map(u=>`<option value="${u.id}" data-name="${escHtml(u.displayName||u.email)}">${escHtml(u.displayName||u.email)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Notes (Rev A)</label><textarea id="dw-note" rows="2" placeholder="What this drawing covers / initial notes"></textarea></div>
    <div class="form-group"><label>File (DWG / PDF / drawing)</label><div id="dw-file"></div></div>
  `;
      // WIRED AFTER THE FILL — #dw-file is part of the markup injected one line
      // up, so mounting the uploader any earlier would have found nothing and
      // silently produced a drawing that could never carry a file.
      Drive.renderUploadArea('dw-file', r=>{ uploaded=r; }, {label:'Upload DWG/PDF/drawing', dept:'Design', subfolder:'Drawings'});
      const dwSave = dwPanel.querySelector('#dw-save-btn');
      if (dwSave) dwSave.disabled = false;
    },
    { skeleton: 'rows', skeletonCount: 5 });
}

function openDrawingDetail(d, project, currentUser, currentRole, canBill){
  const st = drawingStatus(d.status);
  const canManage = canEditDept('Design');
  // v12 WS35 — per-transition capability gate. fileUrl-before-driveUrl (WS15) preserved.
  const cap = window.canApproveDrawing(d, project);
  const revs = (d.revisions||[]).slice().reverse();
  const acts = (d.activity||[]).slice().reverse();
  const fileLink = d.fileUrl
    ? `<a href="${escHtml(d.fileUrl||d.driveUrl)}" target="_blank" class="btn-secondary btn-sm">${emojiIcon('⬇',16)} ${escHtml(d.fileName||'Open file')}</a>`
    : '<span style="font-size:12px;color:var(--text-muted)">No file attached</span>';
  const trans = (canManage || cap.isApprover) ? drawingTransitions(d.status).filter(t =>
    t.to === 'approved' ? cap.approve : t.to === 'released' ? cap.release : canManage) : [];
  // v14 Batch5 A3 — same rule as openProjectDetail above: callers that reopen
  // this page after an in-place action (status change, revision, edit) go
  // through reopenDrawing() below (clearAll + reconstruct both levels), never
  // a bare call. A genuine drill-in (from the Drawings tab list or the
  // cross-project dashboard) calls this directly — that's a real push.
  // ⚠ SCOPED TO THIS PANEL, NOT document (see the const below).
  // reopenDrawing() runs `Overlay.clearAll(); openProjectDetail(...);
  // openDrawingDetail(...)` in ONE tick and openPage defers node removal by
  // ~300ms, so the OLD drawing panel is still in the document and EARLIER in
  // document order. Every document-wide lookup here armed the DEAD copy: Back,
  // New Revision, Edit and the status-transition buttons all fired nothing on
  // the window the user was actually looking at.
  const ddPanel = openPage(`${drawingTypeIcon(d.type)} ${escHtml(d.title||'Drawing')}`, `
    <div class="item-meta" style="margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <span class="badge badge-gray">Rev ${escHtml(d.currentRev||'A')}</span>
      <span class="badge ${st.badge}">${st.label}</span>
      <span>${escHtml(d.type||'')}</span>
      ${d.drawingNo?`<span>${emojiIcon('🔖',16)} ${escHtml(d.drawingNo)}</span>`:''}
    </div>
    <div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:12px 14px;font-size:13px;display:grid;grid-template-columns:auto 1fr;gap:6px 12px">
      <span style="color:var(--text-muted)">Project</span><span>${escHtml(d.projectName||project?.name||'')}</span>
      <span style="color:var(--text-muted)">Designer</span><span>${d.assignedToName?escHtml(d.assignedToName):'<span style="color:var(--text-muted)">Unassigned</span>'}</span>
      <span style="color:var(--text-muted)">Approved by</span><span>${d.approverName?escHtml(d.approverName):'<span style="color:var(--text-muted)">—</span>'}</span>
      <span style="color:var(--text-muted)">Current file</span><span>${fileLink}</span>
      ${d.status==='for_review' && !cap.approve ? `<span style="color:var(--text-muted)">Awaiting</span><span style="font-size:12px">${emojiIcon('🔏',12)} Approval by ${project?.designLeadName ? escHtml(project.designLeadName) : 'a manager'}${(d.createdBy===currentUser?.uid||d.assignedTo===currentUser?.uid)?' — authors cannot approve their own drawing':''}</span>` : ''}
      ${d.releasedByName ? `<span style="color:var(--text-muted)">Released by</span><span>${escHtml(d.releasedByName)}</span>` : ''}
    </div></div>
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:8px 0 4px">${emojiIcon('📑',16)} Revision History</div>
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Rev</th><th>Status</th><th>Note</th><th>By</th><th>Date</th><th>File</th></tr></thead><tbody>
      ${revs.length?revs.map(r=>`<tr><td><strong>${escHtml(r.rev||'')}</strong></td><td>${escHtml(drawingStatus(r.status).label)}</td><td style="font-size:11px">${escHtml(r.note||'')}</td><td style="font-size:11px">${escHtml(r.byName||'')}</td><td style="font-size:11px;color:var(--text-muted)">${escHtml(window.fmtManila(r.at).slice(0,10))}</td><td>${r.fileUrl?`<a href="${escHtml(r.fileUrl||r.driveUrl)}" target="_blank">${emojiIcon('⬇',16)}</a>`:'—'}</td></tr>`).join(''):'<tr><td colspan="6" style="font-size:12px;color:var(--text-muted)">No revisions.</td></tr>'}
    </tbody></table></div>
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:12px 0 4px">${emojiIcon('🕘',16)} Activity</div>
    <div style="max-height:150px;overflow:auto;font-size:12px">${acts.length?acts.map(a=>`<div style="padding:5px 0;border-bottom:1px solid var(--border)"><strong>${escHtml(a.event||'')}</strong><div style="font-size:11px;color:var(--text-muted)">${escHtml(window.fmtManila(a.at))} · ${escHtml(a.byName||'')}</div></div>`).join(''):'<div style="color:var(--text-muted)">No activity.</div>'}</div>
  `, `
    ${canManage?`<button class="btn-secondary btn-sm" id="dwg-rev-btn">+ New Revision</button>`:''}
    ${canManage?`<button class="btn-secondary btn-sm" id="dwg-edit-btn">${emojiIcon('✏️',16)} Edit</button>`:''}
    ${trans.map(t=>`<button class="${t.cls} btn-sm dwg-trans-btn" data-to="${t.to}">${t.label}</button>`).join('')}
    <button class="btn-secondary" id="dwg-back-btn">Back</button>
  `);
  ddPanel.querySelector('#dwg-back-btn').addEventListener('click',()=>{ window.Overlay.clearAll(); openProjectDetail(project, currentUser, currentRole, canBill, 'Drawings'); });
  ddPanel.querySelector('#dwg-rev-btn')?.addEventListener('click',()=>openDrawingRevisionModal(d, project, currentUser, currentRole, canBill));
  ddPanel.querySelector('#dwg-edit-btn')?.addEventListener('click',()=>openDrawingEditModal(d, project, currentUser, currentRole, canBill));
  // querySelectorAll was doubly wrong here: document-wide it matched BOTH panels'
  // transition buttons, so the dying panel's buttons were wired too.
  ddPanel.querySelectorAll('.dwg-trans-btn').forEach(b=>b.addEventListener('click',()=>changeDrawingStatus(d, b.dataset.to, project, currentUser, currentRole, canBill)));
}

// Refresh drawing detail in place after a status change / revision / edit.
// Those sub-flows sit ONE page on top of drawing detail, which itself sits on
// top of project detail (2 levels deep) — opts.replace only swaps the
// immediate top of the stack, so it can't collapse both levels at once and
// would leave a stale hidden copy of drawing detail behind. clearAll() + a
// fresh 2-level reconstruction (project detail, then drawing detail on top of
// it) avoids that leak entirely, at the cost of a full re-fetch of both.
function reopenDrawing(d, project, currentUser, currentRole, canBill){
  window.Overlay.clearAll();
  openProjectDetail(project, currentUser, currentRole, canBill, 'Drawings');
  openDrawingDetail(d, project, currentUser, currentRole, canBill);
}

async function changeDrawingStatus(d, to, project, currentUser, currentRole, canBill){
  // ── WS35 approval gate (mirror of the firestore.rules clause — defense in depth) ──
  const cap = window.canApproveDrawing(d, project);
  if (to === 'approved' && !cap.approve) {
    Notifs.showToast(d.createdBy===currentUser.uid||d.assignedTo===currentUser.uid
      ? 'You cannot approve your own drawing — the Design Lead or a manager must approve it.'
      : 'Only the project Design Lead or a manager can approve drawings.', 'error');
    return;
  }
  if (to === 'released' && !cap.release) {
    Notifs.showToast('Only the project Design Lead or a manager can release drawings.', 'error');
    return;
  }
  if (to === 'released' && !(d.fileUrl||d.driveUrl)) {
    Notifs.showToast('Attach a drawing file before releasing', 'error');
    return;
  }
  // ── WS35 handoff hardening: never silently release into a void ──
  if (to === 'released' && !project?.jobProjectId) {
    const msg = 'This Design project is NOT linked to a Job Project — releasing will only notify the Production department; nothing will appear in any Job Project document register. Link it via Edit Project first, or release anyway?';
    const ok = (typeof confirmDialog === 'function') ? await confirmDialog({ message: msg }) : confirm(msg);
    if (!ok) return;
  }
  const who = window.userProfile?.displayName || currentUser.email || '';
  const nowIso = new Date().toISOString();   // ISO instant — display via fmtManila (decision 10)
  const st = drawingStatus(to);
  const actEntry = { at:nowIso, event:`Status → ${st.label} (Rev ${d.currentRev||'A'})`, by:currentUser.uid, byName:who };
  const update = {
    status: to,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    activity: firebase.firestore.FieldValue.arrayUnion(actEntry),
  };
  if (to==='approved') { update.approver=currentUser.uid; update.approverName=who; update.approvedAt=firebase.firestore.FieldValue.serverTimestamp(); }
  if (to==='released') { update.releasedBy=currentUser.uid; update.releasedByName=who; update.releasedAt=firebase.firestore.FieldValue.serverTimestamp(); }
  try {
    await db.collection('design_drawings').doc(d.id).update(update);
    d.status = to;
    d.activity = [...(d.activity||[]), actEntry];
    if (to==='approved'){ d.approver=currentUser.uid; d.approverName=who; }
    if (to==='released'){ d.releasedBy=currentUser.uid; d.releasedByName=who; }
  } catch(e){ console.warn(e); Notifs.showToast('Could not update status','error'); return; }
  // Cross-department side effects — best-effort; never block the status change.
  try {
    if (to==='for_review') {
      // WS35: tell the approver an approval is waiting (nobody was notified before)
      if (project?.designLead && project.designLead!==currentUser.uid) {
        await Notifs.send(project.designLead,{title:'🔏 Drawing awaiting your approval',body:`"${d.title}" (${project?.name||d.projectName||''}) Rev ${d.currentRev||'A'} was submitted for review`,icon:'🔏',type:'drawing_for_review',link:'dept:Design',dedupKey:`dwg-rev-${d.id}-${d.currentRev}`});
      } else {
        await Notifs.sendToDept('Design',{title:'🔏 Drawing awaiting approval',body:`"${d.title}" Rev ${d.currentRev||'A'} needs a Design Lead or manager to approve`,icon:'🔏',type:'drawing_for_review',link:'dept:Design'});
      }
    }
    if (to==='approved' && d.assignedTo && d.assignedTo!==currentUser.uid) {
      await Notifs.send(d.assignedTo,{title:'✅ Drawing approved',body:`"${d.title}" was approved`,icon:'✅',type:'drawing_approved',link:'dept:Design',dedupKey:`dwg-appr-${d.id}-${d.currentRev}`});
    }
    if (to==='released') {
      await Notifs.sendToDept('Production',{title:'📐 Drawing released',body:`"${d.title}" (${project?.name||d.projectName||''}) is released for production`,icon:'📐',type:'drawing_released',link:'dept:Production'});
      if (project?.jobProjectId) {
        await db.collection('job_projects').doc(project.jobProjectId).update({
          // drawingId + url are WS28's intake hook — its future production flow reads
          // this register, never design_drawings directly. url = fileUrl (WS15 precedence).
          documents: firebase.firestore.FieldValue.arrayUnion({ type:'Drawing', ref:`${d.title} Rev ${d.currentRev||'A'}`, drawingId:d.id, url:d.fileUrl||d.driveUrl||null, at:nowIso, by:who }),
          timeline:  firebase.firestore.FieldValue.arrayUnion({ at:nowIso, event:`Drawing released: ${d.title} Rev ${d.currentRev||'A'}`, by:who }),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('projects-unified');
      }
    }
  } catch(e){ console.warn('drawing release side-effect failed', e); }
  Notifs.showToast(`Drawing → ${st.label}`,'success');
  reopenDrawing(d, project, currentUser, currentRole, canBill);
}

function openDrawingRevisionModal(d, project, currentUser, currentRole, canBill){
  const newRev = nextRev(d.currentRev||'A');
  // ⚠ SCOPED TO THIS PANEL, NOT document (see the const below) — openPage's
  // ~300ms teardown window means a dying revision window still holds #rv-note /
  // #rv-save-btn / #rv-cancel-btn, so the save could cut this revision using the
  // PREVIOUS drawing's change note.
  const rvPanel = openPage(`New Revision — Rev ${newRev}`, `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Cutting <strong>Rev ${escHtml(newRev)}</strong> of "${escHtml(d.title||'')}". The drawing returns to <strong>Draft</strong> for re-review.</div>
    <div class="form-group"><label>Change Note</label><textarea id="rv-note" rows="3" placeholder="What changed in this revision"></textarea></div>
    <div class="form-group"><label>Updated File (optional)</label><div id="rv-file"></div></div>
  `, `<button class="btn-primary" id="rv-save-btn">Save Rev ${newRev}</button><button class="btn-secondary" id="rv-cancel-btn">Cancel</button>`);
  let uploaded = null;
  Drive.renderUploadArea('rv-file', r=>{ uploaded=r; }, {label:'Upload updated DWG/PDF', dept:'Design', subfolder:'Drawings'});
  rvPanel.querySelector('#rv-cancel-btn').addEventListener('click',()=>reopenDrawing(d, project, currentUser, currentRole, canBill));
  rvPanel.querySelector('#rv-save-btn').addEventListener('click', async () => {
    const note = rvPanel.querySelector('#rv-note').value.trim();
    const who = window.userProfile?.displayName || currentUser.email || '';
    const nowIso = new Date().toISOString();
    const fileUrl  = uploaded?.url || d.fileUrl || null;
    const fileName = uploaded?.name || d.fileName || null;
    const driveUrl = uploaded ? (uploaded.driveUrl||null) : (d.driveUrl||null);
    const revEntry = { rev:newRev, status:'draft', fileUrl, fileName, driveUrl, note, by:currentUser.uid, byName:who, at:nowIso };
    const actEntry = { at:nowIso, event:`Rev ${newRev} created`, by:currentUser.uid, byName:who };
    try {
      await db.collection('design_drawings').doc(d.id).update({
        currentRev:newRev, status:'draft',
        fileUrl, fileName, driveUrl, fileSource: uploaded?.source || d.fileSource || null,
        approver:null, approverName:null, approvedAt:null,
        releasedBy:null, releasedByName:null, releasedAt:null,
        revisions: firebase.firestore.FieldValue.arrayUnion(revEntry),
        activity:  firebase.firestore.FieldValue.arrayUnion(actEntry),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      Object.assign(d, { currentRev:newRev, status:'draft', fileUrl, fileName, driveUrl, approver:null, approverName:null, releasedBy:null, releasedByName:null, releasedAt:null });
      d.revisions = [...(d.revisions||[]), revEntry];
      d.activity  = [...(d.activity||[]), actEntry];
      Notifs.showToast(`Rev ${newRev} saved`,'success');
    } catch(e){ console.warn(e); Notifs.showToast('Could not save revision','error'); return; }
    reopenDrawing(d, project, currentUser, currentRole, canBill);
  });
}

async function openDrawingEditModal(d, project, currentUser, currentRole, canBill){
  // ── WINDOW INVERSION (v14 smoothness pass) ── window first, users read second.
  const dePanel = openPage('Edit Drawing', window.skeletonHtml('rows', 3), `<button class="btn-primary" id="de-save-btn" disabled>Save</button><button class="btn-secondary" id="de-cancel-btn">Cancel</button>`);
  const deBody  = dePanel.querySelector('.page-panel-body');
  // ⚠ SCOPED TO dePanel, NOT document — reopenDrawing() reconstructs two levels
  // in one tick, so a dying Edit Drawing window can still hold every #de-* id and
  // would win a document-wide lookup at bind time AND inside the save handler.
  dePanel.querySelector('#de-cancel-btn').addEventListener('click',()=>reopenDrawing(d, project, currentUser, currentRole, canBill));
  dePanel.querySelector('#de-save-btn').addEventListener('click', async () => {
    const asel = dePanel.querySelector('#de-assignee');
    const assignedTo = asel.value || null;
    const assignedToName = asel.value ? (asel.options[asel.selectedIndex]?.dataset.name || null) : null;
    const prevAssignee = d.assignedTo || null;
    const who = window.userProfile?.displayName || currentUser.email || '';
    const update = {
      title:     dePanel.querySelector('#de-title').value.trim() || d.title,
      drawingNo: dePanel.querySelector('#de-no').value.trim(),
      type:      dePanel.querySelector('#de-type').value,
      assignedTo, assignedToName,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    try {
      await db.collection('design_drawings').doc(d.id).update(update);
      Object.assign(d, update);
      if (assignedTo && assignedTo!==prevAssignee && assignedTo!==currentUser.uid) {
        try { await Notifs.send(assignedTo,{title:'🎨 Drawing assigned',body:`"${update.title}" — ${project?.name||''}`,icon:'🎨',type:'drawing_assigned',link:'dept:Design',dedupKey:`dwg-reassign-${d.id}-${assignedTo}`}); } catch(_){}
      }
      Notifs.showToast('Drawing saved','success');
    } catch(e){ console.warn(e); Notifs.showToast('Could not save','error'); return; }
    reopenDrawing(d, project, currentUser, currentRole, canBill);
  });

  // ── skeleton → fetch → fill (or error) ──────────────────────────────────────
  await window.withLoadingAndError(deBody,
    () => dbCachedGet('users', ()=>db.collection('users').get(), 60000).catch(()=>({docs:[]})),
    (uSnap) => {
      if (!pageStillOpen(dePanel)) return;   // dismissed mid-flight — see pageStillOpen()
      const users = uSnap.docs.map(u=>({id:u.id,...u.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
      deBody.innerHTML = `
    <div class="form-group"><label>Title</label><input id="de-title" value="${escHtml(d.title||'')}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Drawing No.</label><input id="de-no" value="${escHtml(d.drawingNo||'')}"/></div>
      <div class="form-group"><label>Type</label><select id="de-type">${DRAWING_TYPES.map(t=>`<option value="${t}" ${d.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label>Assign Designer</label>
      <select id="de-assignee"><option value="">— Unassigned —</option>
        ${users.map(u=>`<option value="${u.id}" data-name="${escHtml(u.displayName||u.email)}" ${d.assignedTo===u.id?'selected':''}>${escHtml(u.displayName||u.email)}</option>`).join('')}
      </select>
    </div>
  `;
      const deSave = dePanel.querySelector('#de-save-btn');
      if (deSave) deSave.disabled = false;
    },
    { skeleton: 'rows', skeletonCount: 3 });
}

// Delegate a Design task scoped to a project (writes department:'Design' + projectId).
async function openAddProjectTaskModal(project, currentUser, currentRole, canBill){
  // ── WINDOW INVERSION (v14 smoothness pass) ── window first, users read second.
  // `picks` is hoisted above openPage for the same reason `uploaded` is in
  // openDrawingCreateModal: the save handler is wired in the tap frame and closes
  // over it, while the chip UI that mutates it only exists after the fill.
  // The title is data-independent (it comes from the `project` argument, not from
  // the read), so it is final from the first frame — no neutral placeholder and
  // no title swap on fill is needed anywhere in this file.
  let picks = [];
  const ptPanel = openPage('Delegate Task — '+escHtml(project.name||''), window.skeletonHtml('rows', 4), `<button class="btn-primary" id="pt-save-btn" disabled>Create Task</button><button class="btn-secondary" id="pt-cancel-btn">Cancel</button>`);
  const ptBody  = ptPanel.querySelector('.page-panel-body');
  // ⚠ SCOPED TO ptPanel, NOT document — openPage's ~300ms teardown window means a
  // dying Delegate Task window still holds every #pt-* id, so the save could
  // create the task from the PREVIOUS form's title/description/priority/due date.
  ptPanel.querySelector('#pt-cancel-btn').addEventListener('click',()=>{ window.Overlay.clearAll(); openProjectDetail(project, currentUser, currentRole, canBill, 'Tasks'); });
  ptPanel.querySelector('#pt-save-btn').addEventListener('click', async () => {
    const title = ptPanel.querySelector('#pt-title').value.trim();
    if (!title){ Notifs.showToast('Enter a task title','error'); return; }
    const who = window.userProfile?.displayName || currentUser.email || '';
    try {
      const ref = await db.collection('tasks').add({
        title, description: ptPanel.querySelector('#pt-desc').value.trim(),
        priority: ptPanel.querySelector('#pt-priority').value, status:'backlog',
        dueDate: ptPanel.querySelector('#pt-due').value,
        department:'Design', projectId:project.id, projectName:project.name||'',
        assignedTo:picks.map(a=>a.uid), assignedToNames:picks.map(a=>a.name),
        createdBy:currentUser.uid, createdByName:who,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      for (const a of picks) {
        if (a.uid!==currentUser.uid) {
          try { await Notifs.send(a.uid,{title:'📌 New Task Assigned',body:`"${title}" — ${project.name||''}`,icon:'📌',type:'task_assigned',taskId:ref.id,dedupKey:`task-assigned-${ref.id}-${a.uid}`}); } catch(_){}
        }
      }
      try { await Notifs.sendToOwner({title:'📌 New Task Created',body:`${who} created "${title}"`,icon:'📌',type:'task_created',dedupKey:`task-created-${ref.id}`}); } catch(_){}
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('tasks-all');
      Notifs.showToast('Task created','success');
    } catch(e){ console.warn(e); Notifs.showToast('Could not create task','error'); return; }
    window.Overlay.clearAll(); openProjectDetail(project, currentUser, currentRole, canBill, 'Tasks');
  });

  // ── skeleton → fetch → fill (or error) ──────────────────────────────────────
  await window.withLoadingAndError(ptBody,
    () => dbCachedGet('users', ()=>db.collection('users').get(), 60000).catch(()=>({docs:[]})),
    (uSnap) => {
      if (!pageStillOpen(ptPanel)) return;   // dismissed mid-flight — see pageStillOpen()
      const users = uSnap.docs.map(u=>({id:u.id,...u.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
      ptBody.innerHTML = `
    <div class="form-group"><label>Title</label><input id="pt-title" placeholder="Task name"/></div>
    <div class="form-group"><label>Description</label><textarea id="pt-desc" rows="2"></textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Priority</label><select id="pt-priority"><option value="low">${emojiIcon('🟢',16)} Low</option><option value="medium" selected>${emojiIcon('🟡',16)} Medium</option><option value="high">${emojiIcon('🔴',16)} High</option><option value="urgent">${emojiIcon('🚨',16)} Urgent</option></select></div>
      <div class="form-group"><label>Due Date</label><input id="pt-due" type="date" value="${today()}"/></div>
    </div>
    <div class="form-group"><label>Assign To (add multiple)</label>
      <select id="pt-assignee-sel"><option value="">— Add assignee —</option>${users.map(u=>`<option value="${u.id}" data-name="${escHtml(u.displayName||u.email)}">${escHtml(u.displayName||u.email)}</option>`).join('')}</select>
      <div id="pt-chips" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"></div>
    </div>
  `;
      // WIRED AFTER THE FILL — #pt-chips and #pt-assignee-sel are both in the
      // markup injected one line up. Scoped to ptBody for the same reason as the
      // Edit Project chips.
      const renderPicks = () => {
        const wrap = ptBody.querySelector('#pt-chips');
        if (!wrap) return;
        wrap.innerHTML = picks.map(a=>`<span class="badge badge-blue pt-chip" data-uid="${a.uid}" style="cursor:pointer">${escHtml(a.name)} ${emojiIcon('✕',16)}</span>`).join('');
        if (window.lucide) lucide.createIcons({ nodes: [wrap] });
        wrap.querySelectorAll('.pt-chip').forEach(ch=>ch.addEventListener('click',()=>{ picks=picks.filter(x=>x.uid!==ch.dataset.uid); renderPicks(); }));
      };
      ptBody.querySelector('#pt-assignee-sel').addEventListener('change',e=>{
        const uid=e.target.value, name=e.target.options[e.target.selectedIndex]?.dataset.name||'';
        if (uid && !picks.some(a=>a.uid===uid)) picks.push({uid,name});
        e.target.value=''; renderPicks();
      });
      const ptSave = ptPanel.querySelector('#pt-save-btn');
      if (ptSave) ptSave.disabled = false;
    },
    { skeleton: 'rows', skeletonCount: 4 });
}

// ── Cross-project Drawings dashboard (Design subtab) ──
async function renderDrawingsDashboard(container, currentUser, currentRole){
  container.innerHTML = '<div class="loading-placeholder">Loading drawings…</div>';
  // v14 prod-fixlist — the PRIMARY read (design_drawings) was console.warn-only
  // with drawings left [], so a genuine permission error rendered identically to
  // "no drawings match". Surfaced as a retry block. The secondary `projects`
  // read just below (projMap, used only to resolve project name/lead for the
  // per-drawing approval check) stays a soft-fail on purpose — same
  // primary-hard/secondary-soft split production.js's header documents for its
  // own design-board read.
  let drawings;
  try {
    const snap = await db.collection('design_drawings').orderBy('createdAt','desc').get();
    drawings = snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch(e){
    console.warn('drawings dashboard load failed', e);
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load drawings</h4><p>${escHtml(e.message||String(e))}</p><button type="button" class="btn-secondary btn-sm dwg-dash-retry-btn" style="margin-top:14px">Retry</button></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [container] });
    container.querySelector('.dwg-dash-retry-btn')?.addEventListener('click', ()=>renderDrawingsDashboard(container, currentUser, currentRole));
    return;
  }
  const projMap = {};
  try { const ps = await db.collection('projects').get(); ps.docs.forEach(d=>projMap[d.id]={id:d.id,...d.data()}); } catch(_){}
  const counts = {}; DRAWING_STATUSES.forEach(s=>counts[s.id]=0);
  drawings.forEach(d=>{ if (counts[d.status]!=null) counts[d.status]++; });
  // v12 WS35 — drawings this user can personally approve right now.
  const mine = drawings.filter(d => d.status==='for_review' && window.canApproveDrawing(d, projMap[d.projectId]).approve);
  const designers = [...new Set(drawings.map(d=>d.assignedToName).filter(Boolean))].sort();
  const projects  = [...new Set(drawings.map(d=>d.projectName).filter(Boolean))].sort();
  let fStatus='All', fDesigner='All', fProject='All';
  const selStyle = 'padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:12px';

  const renderList = () => {
    const showing = drawings.filter(d=>
      (fStatus==='All'||d.status===fStatus) &&
      (fDesigner==='All'||d.assignedToName===fDesigner) &&
      (fProject==='All'||d.projectName===fProject)
    );
    const listEl = document.getElementById('dwg-dash-list');
    listEl.innerHTML = showing.length
      ? `<div class="item-list">${showing.map(drawingCard).join('')}</div>`
      : `<div class="empty-state" style="padding:20px"><div class="empty-icon">${emojiIcon('📐',44)}</div><h4>No drawings match</h4></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [listEl] });
    listEl.querySelectorAll('.item-card[data-dwg]').forEach(card=>card.addEventListener('click',()=>{
      const d = drawings.find(x=>x.id===card.dataset.dwg);
      if (d) openDrawingDetail(d, projMap[d.projectId] || {id:d.projectId, name:d.projectName}, currentUser, currentRole, false);
    }));
  };

  container.innerHTML = `
    <div class="kpi-row" style="margin-bottom:12px">
      <div class="kpi-card" id="dwg-kpi-mine" style="cursor:pointer;border-color:var(--accent)"><div class="kpi-label">${emojiIcon('🔏',16)} For my approval</div><div class="kpi-value">${mine.length}</div></div>
      ${DRAWING_STATUSES.map(s=>`<div class="kpi-card"><div class="kpi-label">${s.label}</div><div class="kpi-value">${counts[s.id]||0}</div></div>`).join('')}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <select id="dwg-f-status" style="${selStyle}"><option value="All">All statuses</option>${DRAWING_STATUSES.map(s=>`<option value="${s.id}">${s.label}</option>`).join('')}</select>
      <select id="dwg-f-designer" style="${selStyle}"><option value="All">All designers</option>${designers.map(n=>`<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('')}</select>
      <select id="dwg-f-project" style="${selStyle}"><option value="All">All projects</option>${projects.map(n=>`<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('')}</select>
    </div>
    <div id="dwg-dash-list"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });
  document.getElementById('dwg-f-status').addEventListener('change',e=>{ fStatus=e.target.value; renderList(); });
  document.getElementById('dwg-f-designer').addEventListener('change',e=>{ fDesigner=e.target.value; renderList(); });
  document.getElementById('dwg-f-project').addEventListener('change',e=>{ fProject=e.target.value; renderList(); });
  document.getElementById('dwg-kpi-mine')?.addEventListener('click',()=>{ fStatus='for_review'; document.getElementById('dwg-f-status').value='for_review'; renderList(); });
  renderList();
}

// ══════════════════════════════════════════════════
//  DESIGN — Folders (owner's flow, 2026-08-11): "allow design team to make
//  folders. two type: projects, sales order". Lives entirely on hub_folders
//  (§3.4 of the design-flow spec) — NOT a new collection, so it never competes
//  with window.DesignFolders / the Files hub as a second file system. A folder
//  is a plain hub_folders doc distinguished by folderType ('project' |
//  'sales_order'); files are hub_files rows linked by folderId only.
// ══════════════════════════════════════════════════
async function renderDesignFolders(container, currentUser, currentRole) {
  container.innerHTML = '<div class="loading-placeholder">Loading folders…</div>';
  const canManage = canEditDept('Design');
  const who = (window.userProfile && userProfile.displayName) || (currentUser && currentUser.email) || '';
  let folders, files;
  try {
    // equality-only — served by the existing (scope, department) composite
    // index (firestore.indexes.json), no new index needed.
    const snap = await db.collection('hub_folders').where('scope','==','projects').where('department','==','Design').get();
    folders = snap.docs.map(d=>({id:d.id,...d.data()}));
    files = await FilesHub.loadFiles('projects').catch(()=>[]);
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load folders</h4><p>${escHtml(err.message||String(err))}</p><button type="button" class="btn-secondary btn-sm design-folders-retry-btn" style="margin-top:14px">Retry</button></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [container] });
    container.querySelector('.design-folders-retry-btn')?.addEventListener('click', ()=>renderDesignFolders(container, currentUser, currentRole));
    return;
  }
  // legacy docs (pre-dating folderType) read as 'project' everywhere
  folders.forEach(f => { f.folderType = f.folderType || 'project'; });

  // ── Folder detail page — files table + Upload, Rename, Delete ──────────────
  // Nested so it shares `container`, letting Rename/Delete refresh the list
  // beneath it on close (openPage panel-scoping rule: all lookups on `_panel`).
  function openDesignFolderDetail(folder) {
    const folderFiles = files.filter(f => f.folderId === folder.id && !f.deleted);
    const canDelete = folder.createdBy === currentUser.uid || ['president','manager','secretary'].includes(currentRole);
    const isAutoFolder = /^proj__/.test(folder.id);
    const typeBadge = folder.folderType === 'sales_order'
      ? `<span class="badge badge-purple">${emojiIcon('🧾',13)} Sales Order</span>`
      : `<span class="badge badge-blue">${emojiIcon('📁',13)} Project</span>`;
    const _panel = openPage(folder.name || 'Folder', `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        ${typeBadge}
        ${canManage?`<button class="btn-primary btn-sm" id="dfd-upload-btn">＋ Upload</button>`:''}
      </div>
      ${folderFiles.length ? `<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Name</th><th>By</th><th>Date</th><th>Ver</th><th></th></tr></thead><tbody>
        ${folderFiles.map(f=>`<tr>
          <td>${escHtml(f.name||'')}</td>
          <td style="font-size:11px">${escHtml(f.uploaderName||'')}</td>
          <td style="font-size:11px;color:var(--text-muted)">${f.createdAt&&f.createdAt.toDate?f.createdAt.toDate().toLocaleDateString('en-PH'):''}</td>
          <td><span class="badge badge-gray">v${f.currentV||1}</span></td>
          <td><button class="btn-secondary btn-sm dfd-view-btn" data-id="${f.id}">${emojiIcon('👁',16)}</button></td>
        </tr>`).join('')}</tbody></table></div>`
        : `<div class="empty-state" style="padding:20px"><div class="empty-icon">${emojiIcon('📁',44)}</div><h4>No files in this folder yet</h4></div>`}
      <div id="dfd-upload-area" style="margin-top:10px;display:none"></div>
    `, `${canDelete?`<button class="btn-secondary btn-sm" id="dfd-rename-btn">Rename</button><button class="btn-danger btn-sm" id="dfd-delete-btn">Delete</button>`:''}<button class="btn-secondary" onclick="closeModal()">Close</button>`);
    if (window.lucide) lucide.createIcons({ nodes: [_panel] });
    // ⚠ SCOPED TO `_panel`, NOT document — same closing-panel-lingers-300ms
    // hazard as every other openPage flow in this file.
    _panel.querySelectorAll('.dfd-view-btn').forEach(b=>b.addEventListener('click',()=>{
      const f = folderFiles.find(x=>x.id===b.dataset.id); if (f) window.openFilePreview(f);
    }));
    _panel.querySelector('#dfd-upload-btn')?.addEventListener('click', () => {
      const area = _panel.querySelector('#dfd-upload-area'); area.style.display='block';
      Drive.renderUploadArea('dfd-upload-area', async (r, file) => {
        const FV = firebase.firestore.FieldValue;
        const upWho = window.userProfile?.displayName || currentUser.email || '';
        await db.collection('hub_files').add({           // FULL WS38 Spec-1 shape + domain fields
          name: (file?.name || r.name || 'File'), description:'', fileType:'File', kind:'file',
          scope:'projects', department:'Design', folderId: folder.id,
          projectId: folder.projectId || null, clientId: folder.clientId || null,
          url: r.url, driveUrl: null, size: file?.size || null, contentType: file?.type || null,
          source:'firebase', currentV: 1,
          versions: [{ v:1, url:r.url, name:(file?.name||r.name||''), size:file?.size||null,
            contentType:file?.type||null, note:'', by:currentUser.uid, byName:upWho, at:new Date().toISOString() }],
          archived:false, deleted:false, deletedAt:null, deletedBy:null,
          visibility:'company', sharedUserIds:[], editorUserIds:[], shares:[],
          uploadedBy: currentUser.uid, uploaderName: upWho,
          createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp(),
        });
        Notifs.showToast('File added to the folder — it also appears in the Files hub','success');
        window.Overlay.clearAll();
        files = await FilesHub.loadFiles('projects').catch(()=>[]);
        openDesignFolderDetail(folder);
      }, { label:'Upload file', dept:'Design', subfolder:'Files' });   // WS38 storage-path contract: 2 segments, never deeper
    });
    _panel.querySelector('#dfd-rename-btn')?.addEventListener('click', async () => {
      const name = await window.promptDialog({ title:'Rename Folder', value: folder.name||'', required:true });
      if (name==null) return;
      try {
        await db.collection('hub_folders').doc(folder.id).update({ name: name.trim() });
        folder.name = name.trim();
        Notifs.showToast('Folder renamed','success');
        closeModal();
        renderDesignFolders(container, currentUser, currentRole);
      } catch(ex){ Notifs.showToast('Rename failed: '+(ex.message||ex.code),'error'); }
    });
    _panel.querySelector('#dfd-delete-btn')?.addEventListener('click', async () => {
      if (isAutoFolder) { Notifs.showToast('This folder belongs to a project — it is managed automatically.','error'); return; }
      if (folderFiles.length) { Notifs.showToast(`Move or delete the ${folderFiles.length} file(s) inside first — deleting a folder never deletes files.`,'error'); return; }
      const ok = await confirmDialog({ message:`Delete folder "${folder.name||'Folder'}"? This can't be undone.`, danger:true, confirmLabel:'Delete' });
      if (!ok) return;
      try {
        await db.collection('hub_folders').doc(folder.id).delete();
        Notifs.showToast('Folder deleted','success');
        closeModal();
        renderDesignFolders(container, currentUser, currentRole);
      } catch(ex){ Notifs.showToast('Delete failed: '+(ex.message||ex.code),'error'); }
    });
  }

  // ── List + chip-tab type filter (client-side — folders are already loaded) ──
  let typeFilter = 'all';
  const renderList = () => {
    const listHost = container.querySelector('#df-list');
    if (!listHost) return;
    const shown = typeFilter==='all' ? folders : folders.filter(f=>f.folderType===typeFilter);
    listHost.innerHTML = !shown.length
      ? `<div class="empty-state" style="padding:20px"><div class="empty-icon">${emojiIcon('📁',44)}</div><h4>No folders yet</h4></div>`
      : `<div class="item-list">${shown.map(f=>{
          const cnt = files.filter(x=>x.folderId===f.id && !x.deleted).length;
          const typeBadge = f.folderType==='sales_order'
            ? `<span class="badge badge-purple">${emojiIcon('🧾',13)} Sales Order</span>`
            : `<span class="badge badge-blue">${emojiIcon('📁',13)} Project</span>`;
          return `<div class="item-card" data-id="${f.id}" style="cursor:pointer">
            <div class="item-top"><div class="item-title">${escHtml(f.name||'Folder')}</div>${typeBadge}</div>
            <div class="item-meta"><span>${emojiIcon('📎',16)} ${cnt} file${cnt===1?'':'s'}</span>${f.createdByName?`<span>${emojiIcon('👤',16)} ${escHtml(f.createdByName)}</span>`:''}</div>
          </div>`;
        }).join('')}</div>`;
    if (window.lucide) lucide.createIcons({ nodes: [listHost] });
    listHost.querySelectorAll('.item-card').forEach(card=>card.addEventListener('click',()=>{
      const f = shown.find(x=>x.id===card.dataset.id);
      if (f) openDesignFolderDetail(f);
    }));
  };

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
      ${window.chipTabs([{key:'all',label:'All'},{key:'sales_order',label:'Sales Orders'},{key:'project',label:'Projects'}],'all')}
      ${canManage?`<button class="btn-primary btn-sm" id="df-new-btn">+ New Folder</button>`:''}
    </div>
    <div id="df-list"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });
  window.bindChipTabs(container.querySelector('.chip-tabs'), (key)=>{ typeFilter = key; renderList(); });
  renderList();

  container.querySelector('#df-new-btn')?.addEventListener('click', () => {
    // ⚠ SCOPED TO `_panel`, NOT document — see the recurring note in this file.
    const npPanel = openPage('New Folder', `
      <div class="form-group"><label>Name</label><input id="df-name" placeholder="Folder name"/></div>
      <div class="form-group"><label>Type</label>
        <select id="df-type" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          <option value="project">Projects</option>
          <option value="sales_order">Sales order</option>
        </select>
      </div>
    `, `<button class="btn-primary" id="df-new-save">Create</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    npPanel.querySelector('#df-new-save').addEventListener('click', async () => {
      const name = npPanel.querySelector('#df-name').value.trim();
      if (!name) { Notifs.showToast('Enter a folder name','error'); return; }
      const folderType = npPanel.querySelector('#df-type').value;
      try {
        await db.collection('hub_folders').add({
          name, parentId:null, scope:'projects', department:'Design',
          folderType, salesOrderId:null,
          createdBy:currentUser.uid, createdByName:who,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        closeModal();
        renderDesignFolders(container, currentUser, currentRole);
      } catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
    });
  });
}
