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
      'Projects tracks each design job; Drawings holds the working files.',
      'Clients keeps the design client book; Product Designs and References are the asset libraries.',
      'Tasks is the department board for design work in progress.'
    ])}
    ${window.chipTabs(['Projects','Drawings','Clients','Product Designs','References','Tasks'].map(s=>({key:s,label:s})), subtab)}
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
    case 'Clients':     await renderClientProfiles(content, currentUser, currentRole, 'design'); break;
    case 'Product Designs':
      content.innerHTML = renderFileCollection('Product Designs', 'design-files', currentRole);
      bindFileCollection('design-files', currentUser, 'Design', 'Product Designs');
      break;
    case 'References':
      content.innerHTML = renderFileCollection('Reference Files', 'design-refs', currentRole);
      bindFileCollection('design-refs', currentUser, 'Design', 'References');
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

async function renderProjects(container, currentUser, currentRole) {
  const snap = await db.collection('projects').orderBy('createdAt','desc').get().catch(()=>({docs:[],empty:true}));
  const projects = snap.docs.map(d => ({id:d.id,...d.data()}));
  const canAdd = currentRole === 'president' || currentRole === 'owner' || currentRole === 'manager';
  const canBill = ['president','owner','manager','finance'].includes(currentRole) || canEditDept('Finance');

  container.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:14px">
      ${canAdd?`<button class="btn-primary btn-sm" id="add-project-btn">+ New Project</button>`:''}
    </div>
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
    openPage('New Project', `
      <div class="form-group"><label>Project Name</label><input id="proj-name" placeholder="e.g. Kitchen Design — ABC Corp"/></div>
      <div class="form-group"><label>Client</label><input id="proj-client" placeholder="Client name"/></div>
      <div class="form-row">
        <div class="form-group"><label>Start Date</label><input id="proj-start" type="date" value="${today()}"/></div>
        <div class="form-group"><label>Due Date</label><input id="proj-due" type="date"/></div>
      </div>
      <div class="form-group"><label>Contract Amount (₱)</label><input id="proj-contract" type="number" step="0.01" min="0" placeholder="Total project value (optional)" inputmode="decimal"/></div>
      <div class="form-group"><label>Notes</label><textarea id="proj-notes" rows="3"></textarea></div>
    `, `<button class="btn-primary" id="save-proj-btn">Save Project</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    document.getElementById('save-proj-btn').addEventListener('click', async () => {
      await db.collection('projects').add({
        name:           document.getElementById('proj-name').value.trim(),
        client:         document.getElementById('proj-client').value.trim(),
        startDate:      document.getElementById('proj-start').value,
        dueDate:        document.getElementById('proj-due').value,
        contractAmount: parseFloat(document.getElementById('proj-contract').value) || 0,
        notes:          document.getElementById('proj-notes').value.trim(),
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
  openPage(escHtml(p.name||'Project'), `
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
    document.querySelectorAll('#pd-tabs .subtab-btn').forEach(b=>b.classList.toggle('active', b.dataset.pd===t));
    const host = document.getElementById('pd-tab-body');
    if (!host) return;
    if      (t==='Overview')   renderProjOverview(host, p, currentUser, currentRole, canBill);
    else if (t==='Drawings')   renderProjectDrawings(host, p, currentUser, currentRole, canBill);
    else if (t==='Files')      renderProjectFiles(host, p, currentUser, currentRole);
    else if (t==='Tasks')      renderProjectTasks(host, p, currentUser, currentRole, canBill);
    else if (t==='Financials') renderProjFinancials(host, p, currentUser, currentRole, canBill);
    else if (t==='Activity')   renderProjActivity(host, p, currentUser, currentRole);
  };
  document.querySelectorAll('#pd-tabs .subtab-btn').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.pd)));
  showTab(initialTab);
};

// ── Overview tab ──
function renderProjOverview(host, p, currentUser, currentRole, canBill){
  const canManage = canEditDept('Design');
  const team = p.teamNames || [];
  host.innerHTML = `
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
  document.getElementById('proj-edit-btn')?.addEventListener('click',()=>openProjectEditModal(p, currentUser, currentRole, canBill));
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
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px">
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
  document.getElementById('proj-payment-btn')?.addEventListener('click', async () => {
    const bankOpts = await window.BankAccounts.optionsHTML();
    openPage('Record Payment', `
      <div class="form-group"><label>Amount (₱)</label><input id="pay-amt" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00"/></div>
      <div class="form-group"><label>Date</label><input id="pay-date" type="date" value="${today()}"/></div>
      <div class="form-group"><label>Method</label><input id="pay-method" placeholder="e.g. Bank transfer, Cash, Cheque"/></div>
      <div class="form-group"><label>Reference / Note</label><input id="pay-note" placeholder="OR no., remarks"/></div>
      <div class="form-group"><label>Deposited to (company account) — optional</label>
        <select id="pay-bank" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${bankOpts}</select></div>
    `, `<button class="btn-primary" id="save-pay-btn">Save Payment</button><button class="btn-secondary" id="pay-back-btn">Cancel</button>`);
    document.getElementById('pay-back-btn').addEventListener('click', reopen);
    document.getElementById('save-pay-btn').addEventListener('click', async () => {
      const amt = parseFloat(document.getElementById('pay-amt').value) || 0;
      if (amt <= 0) { Notifs.showToast('Enter a valid amount','error'); return; }
      const acct = await window.BankAccounts.pick(document.getElementById('pay-bank').value);
      const payment = {
        amount: amt,
        date:   document.getElementById('pay-date').value || today(),
        method: document.getElementById('pay-method').value.trim(),
        note:   document.getElementById('pay-note').value.trim(),
        byName: currentUser.displayName || currentUser.email || '',
        by:     currentUser.uid
      };
      if (!(await confirmDialog({message:`Record payment of ₱${fmt(amt)} for "${escHtml(p.name)}"? This updates the project balance.`, html:true}))) return;
      const payBtn = document.getElementById('save-pay-btn');
      if (payBtn) payBtn.disabled = true; // guard against double-click double-posting
      try {
        // v13 Phase 13 — the project.payments append now rides inside the SAME
        // transaction as the ledger post (projectSync), so the two can never
        // drift apart (previously: payments array committed in its own tx, then
        // the ledger post was a best-effort follow-up that could silently fail).
        // arrayUnion avoids needing to read the current array first.
        const vatRate = 12, net = +(amt/(1+vatRate/100)).toFixed(2), vatAmount = +(amt-net).toFixed(2);
        // Deterministic ref (project id + existing-payments-count) → idempotent on retry/backfill.
        const priorCount = Array.isArray(p.payments) ? p.payments.length : 0;
        const dref = `DPROJ-${p.id}-${priorCount}`;
        await window.Ledger.post({
          ref: dref, date: payment.date, kind: 'credit',
          accountType: 'income', account: 'Sales Revenue', category: 'Sales Revenue',
          description: `Design project — ${p.name||p.id}${payment.note?' ('+payment.note+')':''}`,
          amount: amt, source: 'Design', projectId: p.id,
          extra: { net, vatAmount, ...window.BankAccounts.tag(acct, 'in') },
          projectSync: { collection: 'projects', docId: p.id, fields: { payments: firebase.firestore.FieldValue.arrayUnion(payment) } }
        });
        p.payments = [...(p.payments||[]), payment];
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('projects-unified');
        Notifs.showToast('Payment recorded','success');
        reopen();
      } catch(e) { console.warn(e); Notifs.showToast('Could not save payment','error'); if (payBtn) payBtn.disabled = false; }
    });
  });

  // Create a billing invoice for collection of balance
  document.getElementById('proj-invoice-btn')?.addEventListener('click', () => {
    const bal = (Number(p.contractAmount)||0) - projectPaid(p);
    openPage('Billing Invoice — Collection of Balance', `
      <div class="form-group"><label>Bill To</label><input id="inv-billto" value="${escHtml(p.client||'')}"/></div>
      <div class="form-row">
        <div class="form-group"><label>Invoice Date</label><input id="inv-date" type="date" value="${today()}"/></div>
        <div class="form-group"><label>Due Date</label><input id="inv-due" type="date"/></div>
      </div>
      <div class="form-group"><label>Particulars</label><input id="inv-desc" value="Collection of outstanding balance"/></div>
      <div class="form-group"><label>Amount to Collect (₱)</label><input id="inv-amt" type="number" inputmode="decimal" step="0.01" min="0" value="${bal>0?bal.toFixed(2):'0.00'}"/></div>
      <div class="form-group"><label>Notes / Payment Instructions</label><textarea id="inv-notes" rows="3">Kindly settle the amount due on or before the due date. Payable to Barro Industries OPC.</textarea></div>
    `, `<button class="btn-primary" id="gen-inv-btn">Generate Invoice</button><button class="btn-secondary" id="inv-back-btn">Cancel</button>`);
    document.getElementById('inv-back-btn').addEventListener('click', reopen);
    document.getElementById('gen-inv-btn').addEventListener('click', async () => {
      const amt = parseFloat(document.getElementById('inv-amt').value) || 0;
      if (amt <= 0) { Notifs.showToast('Enter a valid amount','error'); return; }
      const contractC = Number(p.contractAmount) || 0;
      const paidC     = projectPaid(p);
      const seq = ((p.invoices || []).length + 1);
      const inv = {
        no:             'INV-' + today().replace(/-/g,'') + '-' + String(seq).padStart(3,'0'),
        date:           document.getElementById('inv-date').value || today(),
        due:            document.getElementById('inv-due').value || '',
        billTo:         document.getElementById('inv-billto').value.trim(),
        desc:           document.getElementById('inv-desc').value.trim(),
        amount:         amt,
        notes:          document.getElementById('inv-notes').value.trim(),
        contractAmount: contractC,
        paidToDate:     paidC,
        balanceBefore:  contractC - paidC,
        projectName:    p.name || '',
        issuedBy:       currentUser.displayName || currentUser.email || '',
        createdAt:      today()
      };
      if (!(await confirmDialog({message:`Generate billing invoice ${inv.no} for ₱${fmt(amt)} (${escHtml(p.name||'')})?`, html:true}))) return;
      const invBtn = document.getElementById('gen-inv-btn');
      if (invBtn) invBtn.disabled = true; // guard against double-click double-posting
      try {
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
  let tasks = [];
  try {
    const snap = await db.collection('tasks').where('projectId','==',p.id).get();
    tasks = snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch(e){ console.warn('project tasks load failed', e); }
  tasks.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  host.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
      ${canManage?`<button class="btn-primary btn-sm" id="proj-add-task-btn">+ Delegate Task</button>`:''}
    </div>
    ${tasks.length?`<div class="item-list">${tasks.map(taskCard).join('')}</div>`:`<div class="empty-state" style="padding:20px"><div class="empty-icon">${emojiIcon('📋',44)}</div><h4>No tasks for this project</h4></div>`}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [host] });
  host.querySelectorAll('.item-card[data-id]').forEach(card=>card.addEventListener('click',()=>openTaskDetail(card.dataset.id, currentUser, currentRole)));
  document.getElementById('proj-add-task-btn')?.addEventListener('click',()=>openAddProjectTaskModal(p, currentUser, currentRole, canBill));
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
  const [uSnap, allClients, jSnap] = await Promise.all([
    dbCachedGet('users', ()=>db.collection('users').get(), 60000).catch(()=>({docs:[]})),
    window.Clients.listAll().catch(()=>[]),
    db.collection('job_projects').orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
  ]);
  const users   = uSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  const clients = [...allClients].sort((a,b)=>
    (b.brands.includes('design')?1:0)-(a.brands.includes('design')?1:0) || (a.name||'').localeCompare(b.name||''));
  const jobs    = jSnap.docs.map(d=>({id:d.id,...d.data()}));
  let team = (p.team||[]).map((uid,i)=>({uid, name:(p.teamNames||[])[i]||uid}));

  openPage('Edit Project', `
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
  `, `<button class="btn-primary" id="pe-save-btn">Save</button><button class="btn-secondary" id="pe-cancel-btn">Cancel</button>`);

  document.getElementById('pe-cancel-btn').addEventListener('click',()=>{ window.Overlay.clearAll(); openProjectDetail(p, currentUser, currentRole, canBill, 'Overview'); });

  const renderChips = () => {
    const wrap = document.getElementById('pe-team-chips');
    wrap.innerHTML = team.map(a=>`<span class="badge badge-blue team-chip" data-uid="${a.uid}" style="cursor:pointer">${escHtml(a.name)} ${emojiIcon('✕',16)}</span>`).join('');
    if (window.lucide) lucide.createIcons({ nodes: [wrap] });
    wrap.querySelectorAll('.team-chip').forEach(ch=>ch.addEventListener('click',()=>{ team=team.filter(x=>x.uid!==ch.dataset.uid); renderChips(); }));
  };
  renderChips();
  document.getElementById('pe-team-sel').addEventListener('change',e=>{
    const uid=e.target.value, name=e.target.options[e.target.selectedIndex]?.dataset.name||'';
    if (uid && !team.some(a=>a.uid===uid)) team.push({uid,name});
    e.target.value=''; renderChips();
  });
  // Picking a client auto-fills the display name (free text remains an override).
  document.getElementById('pe-client').addEventListener('change', e => {
    const nm = e.target.options[e.target.selectedIndex]?.dataset.name || '';
    const disp = document.getElementById('pe-clientname');
    if (nm && !disp.value.trim()) disp.value = nm;
  });

  document.getElementById('pe-save-btn').addEventListener('click', async () => {
    const prevTeam = new Set(p.team||[]);
    const prevJob  = p.jobProjectId || null;
    const clientSel = document.getElementById('pe-client');
    const leadSel   = document.getElementById('pe-lead');
    const jobSel    = document.getElementById('pe-job');
    const clientId  = clientSel.value || null;
    const clientNameSel = clientSel.options[clientSel.selectedIndex]?.dataset.name || '';
    const update = {
      name:           document.getElementById('pe-name').value.trim() || p.name || 'Project',
      client:         document.getElementById('pe-clientname').value.trim() || clientNameSel || '',
      clientId,
      startDate:      document.getElementById('pe-start').value,
      dueDate:        document.getElementById('pe-due').value,
      status:         document.getElementById('pe-status').value,
      contractAmount: parseFloat(document.getElementById('pe-contract').value) || 0,
      notes:          document.getElementById('pe-notes').value.trim(),
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
          try { await Notifs.send(a.uid,{title:'🎨 Added to a Design project',body:`You're on "${update.name}"`,icon:'🎨',type:'project_team',dedupKey:`projteam-${p.id}-${a.uid}`}); } catch(_){}
        }
      }
      // notify Finance when a job-project link is newly set
      if (update.jobProjectId && update.jobProjectId!==prevJob) {
        try { await Notifs.sendToDept('Finance',{title:'🔗 Design project linked',body:`"${update.name}" linked to job ${update.jobProjectNo||''}`,icon:'🔗',type:'project_link'}); } catch(_){}
      }
      Notifs.showToast('Project saved','success');
    } catch(e){ console.warn(e); Notifs.showToast('Could not save project','error'); return; }
    window.Overlay.clearAll(); openProjectDetail(p, currentUser, currentRole, canBill, 'Overview');
  });
}

// ── Per-project Drawings ──
async function renderProjectDrawings(host, p, currentUser, currentRole, canBill){
  host.innerHTML = '<div class="loading-placeholder">Loading drawings…</div>';
  const canManage = canEditDept('Design');
  let drawings = [];
  try {
    const snap = await db.collection('design_drawings').where('projectId','==',p.id).get();
    drawings = snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch(e){ console.warn('drawings load failed', e); }
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
  document.getElementById('proj-add-dwg-btn')?.addEventListener('click',()=>openDrawingCreateModal(p, currentUser, currentRole, canBill));
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
  document.getElementById('pf-upload-btn')?.addEventListener('click', async () => {
    const area = document.getElementById('pf-upload-area'); area.style.display='block';
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
  const uSnap = await dbCachedGet('users', ()=>db.collection('users').get(), 60000).catch(()=>({docs:[]}));
  const users = uSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  openPage('New Drawing', `
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
  `, `<button class="btn-primary" id="dw-save-btn">Create Drawing</button><button class="btn-secondary" id="dw-cancel-btn">Cancel</button>`);
  let uploaded = null;
  Drive.renderUploadArea('dw-file', r=>{ uploaded=r; }, {label:'Upload DWG/PDF/drawing', dept:'Design', subfolder:'Drawings'});
  document.getElementById('dw-cancel-btn').addEventListener('click',()=>{ window.Overlay.clearAll(); openProjectDetail(project, currentUser, currentRole, canBill, 'Drawings'); });
  document.getElementById('dw-save-btn').addEventListener('click', async () => {
    const title = document.getElementById('dw-title').value.trim();
    if (!title){ Notifs.showToast('Enter a drawing title','error'); return; }
    const asel = document.getElementById('dw-assignee');
    const assignedTo = asel.value || null;
    const assignedToName = asel.value ? (asel.options[asel.selectedIndex]?.dataset.name || null) : null;
    const note = document.getElementById('dw-note').value.trim();
    const who = window.userProfile?.displayName || currentUser.email || '';
    const nowIso = new Date().toISOString();
    const rev0 = { rev:'A', status:'draft', fileUrl:uploaded?.url||null, fileName:uploaded?.name||null, driveUrl:uploaded?.driveUrl||null, note, by:currentUser.uid, byName:who, at:nowIso };
    try {
      const ref = await db.collection('design_drawings').add({
        projectId: project.id, projectName: project.name||'',
        title, drawingNo: document.getElementById('dw-no').value.trim(),
        type: document.getElementById('dw-type').value,
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
        try { await Notifs.send(assignedTo,{title:'🎨 Drawing assigned',body:`"${title}" — ${project.name||''}`,icon:'🎨',type:'drawing_assigned',dedupKey:`dwg-assign-${ref.id}`}); } catch(_){}
      }
      window.logAudit && window.logAudit('create','design_drawing',ref.id,{project:project.name, title});
      Notifs.showToast('Drawing created','success');
    } catch(e){ console.warn(e); Notifs.showToast('Could not create drawing','error'); return; }
    window.Overlay.clearAll(); openProjectDetail(project, currentUser, currentRole, canBill, 'Drawings');
  });
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
  openPage(`${drawingTypeIcon(d.type)} ${escHtml(d.title||'Drawing')}`, `
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
  document.getElementById('dwg-back-btn').addEventListener('click',()=>{ window.Overlay.clearAll(); openProjectDetail(project, currentUser, currentRole, canBill, 'Drawings'); });
  document.getElementById('dwg-rev-btn')?.addEventListener('click',()=>openDrawingRevisionModal(d, project, currentUser, currentRole, canBill));
  document.getElementById('dwg-edit-btn')?.addEventListener('click',()=>openDrawingEditModal(d, project, currentUser, currentRole, canBill));
  document.querySelectorAll('.dwg-trans-btn').forEach(b=>b.addEventListener('click',()=>changeDrawingStatus(d, b.dataset.to, project, currentUser, currentRole, canBill)));
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
        await Notifs.send(project.designLead,{title:'🔏 Drawing awaiting your approval',body:`"${d.title}" (${project?.name||d.projectName||''}) Rev ${d.currentRev||'A'} was submitted for review`,icon:'🔏',type:'drawing_for_review',dedupKey:`dwg-rev-${d.id}-${d.currentRev}`});
      } else {
        await Notifs.sendToDept('Design',{title:'🔏 Drawing awaiting approval',body:`"${d.title}" Rev ${d.currentRev||'A'} needs a Design Lead or manager to approve`,icon:'🔏',type:'drawing_for_review'});
      }
    }
    if (to==='approved' && d.assignedTo && d.assignedTo!==currentUser.uid) {
      await Notifs.send(d.assignedTo,{title:'✅ Drawing approved',body:`"${d.title}" was approved`,icon:'✅',type:'drawing_approved',dedupKey:`dwg-appr-${d.id}-${d.currentRev}`});
    }
    if (to==='released') {
      await Notifs.sendToDept('Production',{title:'📐 Drawing released',body:`"${d.title}" (${project?.name||d.projectName||''}) is released for production`,icon:'📐',type:'drawing_released'});
      if (project?.jobProjectId) {
        await db.collection('job_projects').doc(project.jobProjectId).update({
          // drawingId + url are WS28's intake hook — its future production flow reads
          // this register, never design_drawings directly. url = fileUrl (WS15 precedence).
          documents: firebase.firestore.FieldValue.arrayUnion({ type:'Drawing', ref:`${d.title} Rev ${d.currentRev||'A'}`, drawingId:d.id, url:d.fileUrl||null, at:nowIso, by:who }),
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
  openPage(`New Revision — Rev ${newRev}`, `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Cutting <strong>Rev ${escHtml(newRev)}</strong> of "${escHtml(d.title||'')}". The drawing returns to <strong>Draft</strong> for re-review.</div>
    <div class="form-group"><label>Change Note</label><textarea id="rv-note" rows="3" placeholder="What changed in this revision"></textarea></div>
    <div class="form-group"><label>Updated File (optional)</label><div id="rv-file"></div></div>
  `, `<button class="btn-primary" id="rv-save-btn">Save Rev ${newRev}</button><button class="btn-secondary" id="rv-cancel-btn">Cancel</button>`);
  let uploaded = null;
  Drive.renderUploadArea('rv-file', r=>{ uploaded=r; }, {label:'Upload updated DWG/PDF', dept:'Design', subfolder:'Drawings'});
  document.getElementById('rv-cancel-btn').addEventListener('click',()=>reopenDrawing(d, project, currentUser, currentRole, canBill));
  document.getElementById('rv-save-btn').addEventListener('click', async () => {
    const note = document.getElementById('rv-note').value.trim();
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
  const uSnap = await dbCachedGet('users', ()=>db.collection('users').get(), 60000).catch(()=>({docs:[]}));
  const users = uSnap.docs.map(u=>({id:u.id,...u.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  openPage('Edit Drawing', `
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
  `, `<button class="btn-primary" id="de-save-btn">Save</button><button class="btn-secondary" id="de-cancel-btn">Cancel</button>`);
  document.getElementById('de-cancel-btn').addEventListener('click',()=>reopenDrawing(d, project, currentUser, currentRole, canBill));
  document.getElementById('de-save-btn').addEventListener('click', async () => {
    const asel = document.getElementById('de-assignee');
    const assignedTo = asel.value || null;
    const assignedToName = asel.value ? (asel.options[asel.selectedIndex]?.dataset.name || null) : null;
    const prevAssignee = d.assignedTo || null;
    const who = window.userProfile?.displayName || currentUser.email || '';
    const update = {
      title:     document.getElementById('de-title').value.trim() || d.title,
      drawingNo: document.getElementById('de-no').value.trim(),
      type:      document.getElementById('de-type').value,
      assignedTo, assignedToName,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    try {
      await db.collection('design_drawings').doc(d.id).update(update);
      Object.assign(d, update);
      if (assignedTo && assignedTo!==prevAssignee && assignedTo!==currentUser.uid) {
        try { await Notifs.send(assignedTo,{title:'🎨 Drawing assigned',body:`"${update.title}" — ${project?.name||''}`,icon:'🎨',type:'drawing_assigned',dedupKey:`dwg-reassign-${d.id}-${assignedTo}`}); } catch(_){}
      }
      Notifs.showToast('Drawing saved','success');
    } catch(e){ console.warn(e); Notifs.showToast('Could not save','error'); return; }
    reopenDrawing(d, project, currentUser, currentRole, canBill);
  });
}

// Delegate a Design task scoped to a project (writes department:'Design' + projectId).
async function openAddProjectTaskModal(project, currentUser, currentRole, canBill){
  const uSnap = await dbCachedGet('users', ()=>db.collection('users').get(), 60000).catch(()=>({docs:[]}));
  const users = uSnap.docs.map(u=>({id:u.id,...u.data()})).sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));
  openPage('Delegate Task — '+escHtml(project.name||''), `
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
  `, `<button class="btn-primary" id="pt-save-btn">Create Task</button><button class="btn-secondary" id="pt-cancel-btn">Cancel</button>`);
  document.getElementById('pt-cancel-btn').addEventListener('click',()=>{ window.Overlay.clearAll(); openProjectDetail(project, currentUser, currentRole, canBill, 'Tasks'); });
  let picks = [];
  const renderPicks = () => {
    const wrap = document.getElementById('pt-chips');
    wrap.innerHTML = picks.map(a=>`<span class="badge badge-blue pt-chip" data-uid="${a.uid}" style="cursor:pointer">${escHtml(a.name)} ${emojiIcon('✕',16)}</span>`).join('');
    if (window.lucide) lucide.createIcons({ nodes: [wrap] });
    wrap.querySelectorAll('.pt-chip').forEach(ch=>ch.addEventListener('click',()=>{ picks=picks.filter(x=>x.uid!==ch.dataset.uid); renderPicks(); }));
  };
  document.getElementById('pt-assignee-sel').addEventListener('change',e=>{
    const uid=e.target.value, name=e.target.options[e.target.selectedIndex]?.dataset.name||'';
    if (uid && !picks.some(a=>a.uid===uid)) picks.push({uid,name});
    e.target.value=''; renderPicks();
  });
  document.getElementById('pt-save-btn').addEventListener('click', async () => {
    const title = document.getElementById('pt-title').value.trim();
    if (!title){ Notifs.showToast('Enter a task title','error'); return; }
    const who = window.userProfile?.displayName || currentUser.email || '';
    try {
      const ref = await db.collection('tasks').add({
        title, description: document.getElementById('pt-desc').value.trim(),
        priority: document.getElementById('pt-priority').value, status:'backlog',
        dueDate: document.getElementById('pt-due').value,
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
}

// ── Cross-project Drawings dashboard (Design subtab) ──
async function renderDrawingsDashboard(container, currentUser, currentRole){
  container.innerHTML = '<div class="loading-placeholder">Loading drawings…</div>';
  let drawings = [];
  try {
    const snap = await db.collection('design_drawings').orderBy('createdAt','desc').get();
    drawings = snap.docs.map(d=>({id:d.id,...d.data()}));
  } catch(e){ console.warn('drawings dashboard load failed', e); }
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
