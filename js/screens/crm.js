/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — CRM department
   js/screens/crm.js (added 2026-08-04)

   New department consolidating lead management: a funnel Dashboard, the AEC
   directory MOVED IN from Sales (js/screens/sales.js's renderAECDirectory —
   reused as-is, not rebuilt), a net-new ROC (restaurant) lead directory that
   mirrors AEC's structure, and a Pipeline tab (leads in Quotation + a
   "Convert to Quote" action on Won leads). Imports live in js/migrations.js
   (window.importCrmSeed).

   Still a plain `window.*`-attached classic script — no ESM, no bundler.

   LOAD-ORDER CONTRACT (see index.html + CLAUDE.md "Script load order is
   load-bearing"):
     - Loads AFTER js/departments.js (canEditDept, deptContainer, fmt,
       skeletonHtml, chipTabs/bindChipTabs, renderEmptyState, sopPanel, etc.)
       and AFTER js/screens/sales.js, whose window.renderAECDirectory this
       file's AEC Leads tab calls directly.
     - Every function here is invoked only at runtime (chip clicks, button
       handlers, navigateTo() dispatch) — never at parse time — so it is
       equally safe for js/app.js (loads AFTER this file) to reference
       window.renderCRM in its renderDeptModule switch, same forward-reference
       convention every js/screens/*.js file already documents.
     - window.renderCRM is the entry point called from js/app.js's
       renderDeptModule, 'CRM' case: renderDeptModule calls every department
       renderer as render_X(currentUser, currentRole) — NO container argument
       — each renderer fetches its own container via deptContainer() (see
       renderSales in sales.js for the identical convention). renderCRM
       matches that exactly.
     - window.ROC_STATUSES / ROC_TERMINAL are plain `window.X = [...]`
       assignments (not bare consts) for the same reason AEC_TYPES/AEC_STAGES
       are in sales.js — any future lazily-loaded status-meta helper can read
       them defensively regardless of load order.
   ═══════════════════════════════════════════════════ */

window.renderCRM = async function (currentUser, currentRole, subtab = window.initialSubtab('Dashboard')) {
  window._crmCurrentUser = currentUser;
  window._crmCurrentRole = currentRole;
  const c = deptContainer();
  const crmTabs = ['Dashboard', 'AEC Leads', 'ROC Leads', 'Pipeline'];
  subtab = crmTabs.includes(subtab) ? subtab : 'Dashboard';
  c.innerHTML = `
    <div class="page-header">
      <div>
        <h2>${emojiIcon('🎯', 20)} CRM — Lead Management</h2>
        <p style="font-size:12px;color:var(--text-muted);margin:2px 0 0">AEC + restaurant prospecting, one funnel · Lead → Quotation → Won → Sales pipeline</p>
      </div>
    </div>
    ${window.sopPanel ? window.sopPanel('How CRM works', [
      'Dashboard rolls up both directories into one funnel: New → Contacted → Meeting Set → Quotation → Won/Lost.',
      'AEC Leads is the architect/engineer/contractor prospecting directory (moved in from Sales).',
      'ROC Leads is the restaurant-chain prospecting directory — same add/edit/print workflow as AEC.',
      'Pipeline surfaces leads in Quotation and lets you Convert a Won lead straight into the Quote Builder.'
    ]) : ''}
    ${window.chipTabs(crmTabs.map(s => ({ key: s, label: s })), subtab)}
    <div id="crm-content">${window.skeletonHtml('rows')}</div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  loadCRMContent(currentUser, currentRole, subtab);
  window.bindChipTabs(c, (key) => { window.setSubroute(key); loadCRMContent(currentUser, currentRole, key); });
};

async function loadCRMContent(currentUser, currentRole, sub) {
  const content = document.getElementById('crm-content');
  if (!content) return;
  switch (sub) {
    case 'Dashboard':
      await renderCRMDashboard(content, currentUser, currentRole);
      break;
    case 'AEC Leads':
      // Reuse the existing directory verbatim — do NOT rebuild it (sales.js).
      await window.renderAECDirectory(content, currentUser, currentRole);
      break;
    case 'ROC Leads':
      await renderROCDirectory(content, currentUser, currentRole);
      break;
    case 'Pipeline':
      await renderCRMPipeline(content, currentUser, currentRole);
      break;
  }
}

// ══════════════════════════════════════════════════
//  Shared cross-directory helpers
// ══════════════════════════════════════════════════

// AEC's live schema (sales.js) uses a DIFFERENT vocabulary — stage keys
// new/contacted/prospect/partner/dormant + a separate quoteSent boolean —
// than the xlsx-derived Status vocabulary this department's Dashboard/
// Pipeline are built around (New/Contacted/Meeting Set/Quotation/Won/Lost).
// This is a READ-ONLY derived bucket for cross-directory rollups only — it
// never touches renderAECDirectory's own data or UI. Judgment call (flagged
// to Neil): 'prospect' → 'Meeting Set', and quoteSent (regardless of stage,
// short of the two terminal stages) → 'Quotation'.
function aecFunnelStatus(c) {
  // aecStageOf is sales.js's own top-level function declaration — globally
  // callable here the same way renderAECDirectory is (see that file's header:
  // "function declarations DO attach to window in a classic, non-module
  // script"). Reusing it (rather than re-deriving the stage lookup here)
  // means this can never drift from AEC_STAGES's real fallback behavior.
  const stage = aecStageOf(c);
  if (stage === 'partner') return 'Won';
  if (stage === 'dormant') return 'Lost';
  if (c.quoteSent) return 'Quotation';
  if (stage === 'prospect') return 'Meeting Set';
  if (stage === 'contacted') return 'Contacted';
  return 'New';
}

// ROC is a brand-new collection with no legacy vocabulary to bridge — status
// is stored as the literal label string already (see ROC_STATUSES below), so
// this is just a safe accessor (defaults an unset/unknown value to 'New').
function rocFunnelStatus(r) {
  return (window.ROC_STATUSES || []).some(s => s.key === (r && r.status)) ? r.status : 'New';
}

const CRM_FUNNEL_ORDER = ['New', 'Contacted', 'Meeting Set', 'Quotation', 'Won', 'Lost'];
const CRM_FUNNEL_META = {
  New:          { color: '#8e8e93',                icon: '○'  },
  Contacted:    { color: '#5856D6',                icon: '📞' },
  'Meeting Set':{ color: '#FFAA00',                icon: '🤝' },
  Quotation:    { color: '#0A84FF',                icon: '📄' },
  Won:          { color: 'var(--success,#30D158)', icon: '🏆' },
  Lost:         { color: '#636366',                icon: '💤' },
};

// Fetch both lead directories in parallel.
//
// NO swallowing `.catch(()=>({docs:[]}))` here. That WAS this file's original
// hard rule and it was the wrong rule: it made crmFetchAll a promise that can
// never reject, which made withLoadingAndError's error+Retry branch
// (js/ui-states.js) structurally unreachable on the two tabs built on it. A
// failed read painted a complete, confident page — every KPI 0, every funnel
// row 0/0/0, and the green "✅ No follow-ups due — every lead is on track" —
// pixel-identical to a CRM that genuinely has no leads in it, with no Retry.
// The partner account the catches were written for is already refused at the
// boundary (firestore.rules: aec_contacts/roc_leads `read: isAuth() &&
// !isPartner()`), so they bought nothing there and cost the error state for
// every real reader. Both directory tabs of this same feature —
// renderROCDirectory below and renderAECDirectory (sales.js) — have always
// surfaced a failed read with a Retry; the Dashboard and Pipeline now agree
// with their own siblings instead of contradicting them tab to tab.
//
// Each read is tagged with WHICH directory failed before being re-thrown. A
// re-throwing .catch is the opposite of a swallowing one: the promise still
// rejects, it just rejects with something a human can act on.
async function crmFetchAll() {
  const failing = (label) => (err) => {
    throw new Error(`Couldn't load the ${label} — ${(err && err.message) || String(err)}`);
  };
  const [aecSnap, rocSnap] = await Promise.all([
    db.collection('aec_contacts').get().catch(failing('AEC lead directory')),
    db.collection('roc_leads').get().catch(failing('ROC lead directory')),
  ]);
  return {
    aec: aecSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    roc: rocSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  };
}

// ══════════════════════════════════════════════════
//  Dashboard tab — funnel KPIs
// ══════════════════════════════════════════════════
async function renderCRMDashboard(container, currentUser, currentRole) {
  await window.withLoadingAndError(container, crmFetchAll, ({ aec, roc }) => {
    const today = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0, 10));

    const funnelCounts = {}; CRM_FUNNEL_ORDER.forEach(k => funnelCounts[k] = { aec: 0, roc: 0 });
    aec.forEach(c => { const s = aecFunnelStatus(c); if (funnelCounts[s]) funnelCounts[s].aec++; });
    roc.forEach(r => { const s = rocFunnelStatus(r); if (funnelCounts[s]) funnelCounts[s].roc++; });

    const wonCount = funnelCounts.Won.aec + funnelCounts.Won.roc;

    const aecTerminal = window.AEC_TERMINAL || ['partner', 'dormant'];
    const dueAEC = aec.filter(c => c.followUpDate && c.followUpDate <= today && !aecTerminal.includes(aecStageOf(c)));
    const dueROC = roc.filter(r => r.nextFollowUp && r.nextFollowUp <= today &&
      !(window.ROC_TERMINAL || []).includes(rocFunnelStatus(r)));
    const dueCount = dueAEC.length + dueROC.length;

    const dueRows = [
      ...dueAEC.map(c => ({ name: c.company || '(no name)', date: c.followUpDate, kind: 'AEC' })),
      ...dueROC.map(r => ({ name: r.restaurantName || '(no name)', date: r.nextFollowUp, kind: 'ROC' })),
    ].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    container.innerHTML = `
      <div class="kpi-row" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        <div class="kpi-card"><div class="kpi-label">Total AEC Leads</div><div class="kpi-value">${aec.length}</div></div>
        <div class="kpi-card"><div class="kpi-label">Total ROC Leads</div><div class="kpi-value">${roc.length}</div></div>
        <div class="kpi-card green"><div class="kpi-label">Won → Pipeline</div><div class="kpi-value">${wonCount}</div></div>
        <div class="kpi-card ${dueCount ? 'red' : ''}"><div class="kpi-label">Follow-ups Due</div><div class="kpi-value">${dueCount}</div></div>
      </div>
      <h4 style="margin:0 0 8px">Funnel — combined AEC + ROC</h4>
      <div style="overflow-x:auto;margin-bottom:16px">
        <table class="data-table table-cards" style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="text-align:left;padding:7px 8px;border-bottom:1px solid var(--border);font-size:10px;text-transform:uppercase;color:var(--text-muted)">Status</th>
            <th class="c" style="padding:7px 8px;border-bottom:1px solid var(--border);font-size:10px;text-transform:uppercase;color:var(--text-muted)">AEC</th>
            <th class="c" style="padding:7px 8px;border-bottom:1px solid var(--border);font-size:10px;text-transform:uppercase;color:var(--text-muted)">ROC</th>
            <th class="c" style="padding:7px 8px;border-bottom:1px solid var(--border);font-size:10px;text-transform:uppercase;color:var(--text-muted)">Total</th>
          </tr></thead>
          <tbody>${CRM_FUNNEL_ORDER.map(k => {
            const m = CRM_FUNNEL_META[k], row = funnelCounts[k];
            return `<tr data-label="${escHtml(k)}">
              <td style="padding:7px 8px;border-bottom:1px solid var(--border)"><span class="badge" style="font-size:9px;background:${m.color};color:var(--on-primary)">${m.icon} ${escHtml(k)}</span></td>
              <td class="c" style="padding:7px 8px;border-bottom:1px solid var(--border)" data-label="AEC">${row.aec}</td>
              <td class="c" style="padding:7px 8px;border-bottom:1px solid var(--border)" data-label="ROC">${row.roc}</td>
              <td class="c" style="padding:7px 8px;border-bottom:1px solid var(--border)" data-label="Total"><strong>${row.aec + row.roc}</strong></td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      <h4 style="margin:0 0 8px">${emojiIcon('⏰', 16)} Follow-ups due</h4>
      <div id="crm-due-list">${
        dueRows.length
          ? `<div style="display:flex;flex-direction:column;gap:6px">${dueRows.map(d => `
              <div style="display:flex;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:12px">
                <span><span class="badge" style="font-size:9px;margin-right:6px">${escHtml(d.kind)}</span>${escHtml(d.name)}</span>
                <span style="color:var(--danger)">${escHtml(d.date)}</span>
              </div>`).join('')}</div>`
          : window.renderEmptyState({ icon: '✅', title: 'No follow-ups due', hint: 'Every lead with a follow-up date is on track.' })
      }</div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [container] });
  }, { skeleton: 'cards', skeletonCount: 4 });
}

// ══════════════════════════════════════════════════
//  ROC (restaurant) Lead Directory — mirrors AEC's structure
//  (sales.js's renderAECDirectory: add/edit/detail/print, card-reflow
//  table, follow-up reminders, status funnel). Collection: roc_leads.
// ══════════════════════════════════════════════════
window.ROC_STATUSES = [
  { key: 'New',           label: 'New',           color: '#8e8e93',                icon: '○'  },
  { key: 'Contacted',     label: 'Contacted',     color: '#5856D6',                icon: '📞' },
  { key: 'Meeting Set',   label: 'Meeting Set',   color: '#FFAA00',                icon: '🤝' },
  { key: 'Quotation',     label: 'Quotation',     color: '#0A84FF',                icon: '📄' },
  { key: 'Won',           label: 'Won',           color: 'var(--success,#30D158)', icon: '🏆' },
  { key: 'Lost',          label: 'Lost',          color: '#636366',                icon: '💤' },
];
window.ROC_TERMINAL = ['Won', 'Lost'];
function rocStatusMeta(k) { return window.ROC_STATUSES.find(s => s.key === k) || window.ROC_STATUSES[0]; }

// Atomic directory number via _counters/roc_leads — exact mirror of
// nextAECNumber (sales.js), just a different counter doc. Firestore rules'
// existing _counters/{docId} block already covers any docId, no rules change
// needed for this counter.
async function nextROCNumber() {
  const ref = db.collection('_counters').doc('roc_leads');
  return db.runTransaction(async t => {
    const cur = await t.get(ref);
    const next = (cur.exists ? (cur.data().count || 0) : 0) + 1;
    t.set(ref, { count: next }, { merge: true });
    return next;
  });
}

async function renderROCDirectory(container, currentUser, currentRole) {
  container.innerHTML = window.skeletonHtml('table');
  let snap;
  try { snap = await db.collection('roc_leads').orderBy('itemNo', 'asc').get(); }
  catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️', 44)}</div><h4>Couldn't load the ROC directory</h4><p>${escHtml(err.message || String(err))}</p><button type="button" class="btn-secondary btn-sm roc-retry-btn" style="margin-top:14px">Retry</button></div>`;
    container.querySelector('.roc-retry-btn')?.addEventListener('click', () => renderROCDirectory(container, currentUser, currentRole));
    if (window.lucide) lucide.createIcons({ nodes: [container] });
    return;
  }
  const leads = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // Same write-access model as the (now-widened) AEC directory: CRM OR Sales
  // dept members, matching the roc_leads firestore.rules create/update rule.
  const canEdit = canEditDept('CRM') || canEditDept('Sales');
  // Delete gate = the client mirror of the roc_leads DELETE rule
  // (firestore.rules: `allow delete: if isAuth() && isAdmin()`), not a
  // hand-rolled role array. The literal this replaces —
  // ['president','owner','manager'] — omitted 'secretary', whom isAdmin() DOES
  // include, so the Corporate Secretary could add and edit leads but was never
  // shown the delete button for a single one. That is the whole of "prune the
  // junk" in a lead directory, and these two lead collections deliberately
  // carry NO delete-request flow to fall back on (the rule's own comment says
  // so: low-stakes list, not a finance record), so there was no escalation
  // either. isAdminPriv() (js/departments.js) is president/owner/manager/
  // secretary — exactly isAdmin(), with 'owner' as the legacy alias for
  // president. renderAECDirectory (sales.js) now resolves through the same
  // predicate, and drawVentureBrief (ventures.js) — written days later against
  // the byte-identical `allow delete: if isAuth() && isAdmin()` rule — already
  // listed the role; only these two lead directories had been left behind.
  const canDeleteDirect = window.isAdminPriv();
  const today = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0, 10));

  const isOverdue = r => r.nextFollowUp && r.nextFollowUp <= today && !window.ROC_TERMINAL.includes(rocFunnelStatus(r));
  const dueCount = leads.filter(isOverdue).length;

  const statusCounts = { all: leads.length };
  window.ROC_STATUSES.forEach(s => statusCounts[s.key] = leads.filter(r => rocFunnelStatus(r) === s.key).length);

  let statusFilter = 'all', search = '';

  container.innerHTML = `
    <style>
      @media (min-width: 701px) {
        #roc-tbl{min-width:820px}
        #roc-tbl th,#roc-tbl td{border-bottom:1px solid var(--border);padding:7px 8px;text-align:left;vertical-align:top;font-size:12px}
        #roc-tbl th{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted)}
        #roc-tbl td.c,#roc-tbl th.c{text-align:center}
      }
      #roc-tbl tbody tr{cursor:pointer}
    </style>
    ${dueCount ? `<div class="alert-banner alert-warn" style="margin-bottom:10px"><span>${emojiIcon('⏰', 16)} <strong>${dueCount}</strong> ROC follow-up${dueCount > 1 ? 's' : ''} due</span></div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      ${window.chipTabs([{ key: 'all', label: 'All', count: statusCounts.all }, ...window.ROC_STATUSES.map(s => ({ key: s.key, label: s.label, icon: emojiIcon(s.icon, 14), count: statusCounts[s.key] }))], 'all', { cls: 'roc-status-tabs' })}
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${canEdit ? `<button class="btn-primary btn-sm" id="roc-add-btn">+ Add Lead</button>` : ''}
        <button class="btn-secondary btn-sm" id="roc-csv-btn">${emojiIcon('⬇', 16)} CSV</button>
        <button class="btn-secondary btn-sm" id="roc-print-btn">${emojiIcon('🖨', 16)} Print</button>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 10px">
      <input id="roc-search" placeholder="🔍 Search restaurant / person / email…" style="flex:1;min-width:180px;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:12px"/>
    </div>
    <div id="roc-table"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  const shownRows = () => leads.filter(r =>
    (statusFilter === 'all' || rocFunnelStatus(r) === statusFilter) &&
    (!search || [r.restaurantName, r.contactPerson, r.email, r.phone, r.cityProvince, r.cuisine]
      .join(' ').toLowerCase().includes(search))
  );

  const rowHtml = r => { const st = rocStatusMeta(rocFunnelStatus(r)); const od = isOverdue(r);
    return `<tr data-id="${r.id}">
      <td class="c tc-detail" data-label="#">${r.itemNo || ''}</td>
      <td class="tc-name"><strong>${escHtml(r.restaurantName || '')}</strong>${r.chainType ? `<div style="font-size:10px;color:var(--text-muted)">${escHtml(r.chainType)}</div>` : ''}</td>
      <td class="tc-detail" data-label="Contact Person">${escHtml(r.contactPerson || '')}</td>
      <td class="tc-detail" data-label="Contact Info" style="font-size:11px">${r.phone ? `${emojiIcon('📞', 16)} ${escHtml(r.phone)}<br>` : ''}${r.email ? `${emojiIcon('✉️', 16)} ${escHtml(r.email)}` : ''}</td>
      <td class="tc-detail" data-label="Cuisine" style="font-size:11px">${escHtml(r.cuisine || '')}</td>
      <td class="tc-detail" data-label="City/Province" style="font-size:11px">${escHtml(r.cityProvince || '')}</td>
      <td class="tc-net"><span class="badge" style="font-size:9px;background:${st.color};color:var(--on-primary)">${st.icon} ${st.label}</span></td>
      <td class="tc-detail" data-label="Follow-up" style="font-size:11px;color:${od ? 'var(--danger)' : 'var(--text-muted)'}">${r.nextFollowUp ? `${emojiIcon('⏰', 16)} ${escHtml(r.nextFollowUp)}${od ? ' · due' : ''}` : ''}</td>
      <td class="c tc-actions" style="white-space:nowrap">
        ${canEdit ? `<button class="btn-secondary btn-sm roc-edit-btn" data-id="${r.id}" title="Edit" aria-label="Edit lead">${emojiIcon('✎', 16)}</button>` : ''}
        ${canDeleteDirect ? `<button class="btn-secondary btn-sm roc-del-btn" data-id="${r.id}" data-name="${escHtml(r.restaurantName || '')}" style="color:var(--danger)" aria-label="Delete lead">${emojiIcon('trash-2', 13)}</button>` : ''}
      </td></tr>`; };

  const openROCDetail = (r) => {
    const st = rocStatusMeta(rocFunnelStatus(r));
    const _panel = openPage(`${escHtml(r.restaurantName || 'ROC Lead')}`, `
      <div style="display:flex;flex-direction:column;gap:6px;font-size:13px">
        <div>#${r.itemNo || ''} · <span class="badge" style="background:${st.color};color:var(--on-primary);font-size:9px">${st.icon} ${escHtml(st.label)}</span></div>
        ${r.chainType ? `<div>${emojiIcon('📇', 16)} ${escHtml(r.chainType)}</div>` : ''}
        ${r.contactPerson ? `<div>${emojiIcon('👤', 16)} ${escHtml(r.contactPerson)}</div>` : ''}
        ${r.phone ? `<div>${emojiIcon('📞', 16)} ${escHtml(r.phone)}</div>` : ''}
        ${r.email ? `<div>${emojiIcon('✉️', 16)} ${escHtml(r.email)}</div>` : ''}
        ${r.cuisine ? `<div>${emojiIcon('🍽️', 16)} ${escHtml(r.cuisine)}</div>` : ''}
        ${r.kitchenSize ? `<div>${emojiIcon('📐', 16)} Kitchen size: ${escHtml(r.kitchenSize)}</div>` : ''}
        ${r.cityProvince ? `<div>${emojiIcon('📍', 16)} ${escHtml(r.cityProvince)}</div>` : ''}
        ${r.nextFollowUp ? `<div>${emojiIcon('⏰', 16)} Follow-up: ${escHtml(r.nextFollowUp)}</div>` : ''}
        ${r.remarks ? `<div style="margin-top:4px;padding:8px;background:rgba(128,128,128,.08);border-radius:8px">${emojiIcon('💬', 16)} ${escHtml(r.remarks)}</div>` : ''}
      </div>
    `, `${canEdit ? `<button class="btn-primary" id="roc-detail-edit">${emojiIcon('✎', 16)} Edit</button>` : ''}<button class="btn-secondary" onclick="closeModal()">Close</button>`);
    // ⚠ SCOPED TO THIS PANEL, NOT document.
    // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second record
    // inside that window and two panels carry the same ids at once —
    // document.getElementById() returns the FIRST in document order, which is
    // the DYING one. The handler then binds to a button nobody can see, and the
    // visible button does nothing. That is exactly the "needs multiple attempts
    // to get to the edit form" the Corporate Secretary reported on 2026-08-10,
    // reproduced in the browser: two #roc-detail-edit in the DOM, getElementById
    // resolving into the dead panel, the visible button firing nothing.
    // ⚠ REPLACE, DO NOT close-then-open.
    // closeModal() is Overlay.dismissTop(), which is history.back() — and that
    // is ASYNCHRONOUS. `closeModal(); openXEditor(c);` therefore pushes the
    // editor's history entry FIRST and lets the queued back land SECOND, so the
    // back pops the panel that was just opened: the editor flashes up and dies,
    // leaving you staring at the detail panel as if the button did nothing.
    // Tap again and the panel/history pairing drifts further, until a later
    // close unwinds past the panel entirely and drops you on the page
    // underneath — the President's 2026-08-10 report, "it went to dashboard
    // after clicking edit twice", reproduced exactly in the browser.
    //
    // opts.replace tears the current panel's DOM down directly and swaps the
    // Overlay entry via replaceTop, touching no history at all, so one Back
    // still closes the (now different) surface and depth stays correct.
    _panel.querySelector('#roc-detail-edit')?.addEventListener('click', () => openROCEditor(r, { replace: true }));
  };

  const openROCEditor = (r, opts) => {
    const e = r || {};
    const sel = 'style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)"';
    const _panel = openPage(r ? 'Edit ROC Lead' : 'Add ROC Lead', `
      <div class="form-group"><label>Restaurant Name</label><input id="roc-name" value="${escHtml(e.restaurantName || '')}" placeholder="Restaurant / chain name"/></div>
      <div class="form-row">
        <div class="form-group"><label>Chain Type</label><input id="roc-chain" value="${escHtml(e.chainType || '')}" placeholder="e.g. Fast food, Fine dining, Franchise"/></div>
        <div class="form-group"><label>Cuisine</label><input id="roc-cuisine" value="${escHtml(e.cuisine || '')}"/></div>
      </div>
      <div class="form-group"><label>Contact person</label><input id="roc-person" value="${escHtml(e.contactPerson || '')}"/></div>
      <div class="form-row">
        <div class="form-group"><label>Phone</label><input id="roc-phone" type="tel" value="${escHtml(e.phone || '')}"/></div>
        <div class="form-group"><label>Email</label><input id="roc-email" type="email" value="${escHtml(e.email || '')}"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>City / Province</label><input id="roc-city" value="${escHtml(e.cityProvince || '')}"/></div>
        <div class="form-group"><label>Kitchen size</label><input id="roc-kitchen" value="${escHtml(e.kitchenSize || '')}" placeholder="e.g. Small, Medium, Large"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Status</label><select id="roc-status" ${sel}>${window.ROC_STATUSES.map(s => `<option value="${s.key}" ${(e.status || 'New') === s.key ? 'selected' : ''}>${s.icon} ${s.label}</option>`).join('')}</select></div>
        <div class="form-group"><label>Follow-up date</label><input id="roc-followup" type="date" value="${escHtml(e.nextFollowUp || '')}"/></div>
      </div>
      <div class="form-group"><label>Remarks</label><textarea id="roc-remarks" rows="3">${escHtml(e.remarks || '')}</textarea></div>
    `, `<button class="btn-primary" id="roc-save-btn">${r ? 'Save' : 'Save Lead'}</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`, opts || {});
    // ⚠ SCOPED TO THIS PANEL, NOT document.
    // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second record
    // inside that window and two panels carry the same ids at once —
    // document.getElementById() returns the FIRST in document order, which is
    // the DYING one. The handler then binds to a button nobody can see, and the
    // visible button does nothing. That is exactly the "needs multiple attempts
    // to get to the edit form" the Corporate Secretary reported on 2026-08-10,
    // reproduced in the browser: two #roc-save-btn in the DOM, getElementById
    // resolving into the dead panel, the visible button firing nothing.
    _panel.querySelector('#roc-save-btn').addEventListener('click', async () => {
      const restaurantName = _panel.querySelector('#roc-name').value.trim();
      if (!restaurantName) { Notifs.showToast('Restaurant name is required.', 'error'); return; }
      const data = {
        restaurantName,
        chainType: _panel.querySelector('#roc-chain').value.trim(),
        cuisine: _panel.querySelector('#roc-cuisine').value.trim(),
        contactPerson: _panel.querySelector('#roc-person').value.trim(),
        phone: _panel.querySelector('#roc-phone').value.trim(),
        email: _panel.querySelector('#roc-email').value.trim(),
        cityProvince: _panel.querySelector('#roc-city').value.trim(),
        kitchenSize: _panel.querySelector('#roc-kitchen').value.trim(),
        status: _panel.querySelector('#roc-status').value,
        nextFollowUp: _panel.querySelector('#roc-followup').value || '',
        remarks: _panel.querySelector('#roc-remarks').value.trim(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };
      try {
        if (r) {
          await db.collection('roc_leads').doc(r.id).update(data);
          window.logAudit && window.logAudit('update', 'roc_lead', r.id, { restaurantName, status: data.status });
        } else {
          data.itemNo = await nextROCNumber();
          data.createdBy = currentUser.uid;
          data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
          await db.collection('roc_leads').add(data);
          window.logAudit && window.logAudit('create', 'roc_lead', String(data.itemNo), { restaurantName });
        }
        closeModal(); Notifs.success('ROC lead saved');
        renderROCDirectory(container, currentUser, currentRole);
      } catch (ex) { Notifs.showToast('Save failed: ' + (ex.message || ex.code), 'error'); }
    });
  };

  const bindRows = () => {
    const el = document.getElementById('roc-table'); if (!el) return;
    el.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const r = leads.find(x => x.id === tr.dataset.id); if (r) openROCDetail(r);
    }));
    el.querySelectorAll('.roc-edit-btn').forEach(b => b.addEventListener('click', () => openROCEditor(leads.find(x => x.id === b.dataset.id))));
    el.querySelectorAll('.roc-del-btn').forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmDialog({ message: `Delete ROC lead "${escHtml(b.dataset.name)}"? This cannot be undone.`, danger: true, html: true }))) return;
      try {
        await db.collection('roc_leads').doc(b.dataset.id).delete();
        window.logAudit && window.logAudit('delete', 'roc_lead', b.dataset.id, { restaurantName: b.dataset.name });
        Notifs.success('ROC lead deleted');
        renderROCDirectory(container, currentUser, currentRole);
      // Say WHY, the same way the Save handler above already does. A bare
      // "Delete failed" on a button that is now offered to a wider set of
      // roles is the least actionable message possible — a rules denial, an
      // offline write and a doc someone else already removed all read the same.
      } catch (ex) { Notifs.showToast('Delete failed: ' + (ex.message || ex.code), 'error'); }
    }));
  };

  const renderTable = () => {
    const rows = shownRows();
    const el = document.getElementById('roc-table'); if (!el) return;
    el.innerHTML = !rows.length
      ? window.renderEmptyState({
          icon: '🍽️',
          title: `No ROC leads${leads.length ? ' match the filters' : ' yet'}`,
          hint: (canEdit && !leads.length) ? 'Add restaurant chains to start the prospecting pipeline.' : undefined
        })
      : `<div style="overflow-x:auto"><table id="roc-tbl" class="data-table table-cards" style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th class="c" style="width:36px">#</th><th>Restaurant</th><th>Contact Person</th>
            <th>Contact Info</th><th style="width:100px">Cuisine</th><th style="width:110px">City/Province</th><th style="width:120px">Status</th>
            <th style="width:110px">Follow-up</th><th style="width:80px"></th>
          </tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [el] });
    bindRows();
  };

  const ROC_CSV_COLUMNS = [
    { key: 'itemNo', label: 'Item #' },
    { key: 'restaurantName', label: 'Restaurant Name' },
    { key: 'chainType', label: 'Chain Type' },
    { key: 'contactPerson', label: 'Contact Person' },
    { key: 'cuisine', label: 'Cuisine' },
    { key: 'kitchenSize', label: 'Kitchen Size' },
    { key: 'cityProvince', label: 'City / Province' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'status', label: 'Status' },
    { key: 'nextFollowUp', label: 'Next Follow-up' },
    { key: 'remarks', label: 'Remarks' },
  ];

  const filterLabel = () => {
    const bits = [];
    if (statusFilter !== 'all') bits.push('status: ' + rocStatusMeta(statusFilter).label);
    if (search) bits.push(`search: "${search}"`);
    return bits.length ? bits.join(' · ') : 'All leads';
  };

  window.bindChipTabs(container.querySelector('.roc-status-tabs'), (key) => { statusFilter = key; renderTable(); });
  document.getElementById('roc-search')?.addEventListener('input', (e) => { search = e.target.value.trim().toLowerCase(); renderTable(); });
  document.getElementById('roc-add-btn')?.addEventListener('click', () => openROCEditor(null));
  document.getElementById('roc-csv-btn')?.addEventListener('click', () => window.exportCSV('roc-leads', shownRows(), ROC_CSV_COLUMNS));
  document.getElementById('roc-print-btn')?.addEventListener('click', () => openROCPrintSheet(shownRows(), filterLabel()));
  renderTable();
}

// Printable ROC lead sheet — mirrors openAECPrintSheet (sales.js) exactly,
// restaurant fields in place of AEC's type/region.
function openROCPrintSheet(rows, scopeLabel) {
  const e = s => escHtml(s);
  const todayStr = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0, 10));
  const _lh = window.buildLetterhead ? window.buildLetterhead({
    orientation: 'landscape',
    docTitle: 'ROC RESTAURANT LEAD SHEET',
    dateLabel: 'As of ' + todayStr,
    extraMeta: [scopeLabel || 'All leads', rows.length + ' lead' + (rows.length === 1 ? '' : 's')],
    signatures: [{ label: 'Prepared by', name: (window.userProfile && userProfile.displayName) || '', title: 'CRM' }],
    footerNote: ((window.BRAND && window.BRAND.fullName) || 'Barro Industries Operating System') + ' · Generated ' + new Date().toLocaleString('en-PH') + ' · Internal prospecting directory — handle contact details accordingly.'
  }) : null;
  const body = rows.map(r => { const st = rocStatusMeta(rocFunnelStatus(r));
    return `<tr>
      <td class="c">${r.itemNo || ''}</td>
      <td class="b">${e(r.restaurantName || '')}</td>
      <td>${e(r.chainType || '')}</td>
      <td>${e(r.contactPerson || '')}</td>
      <td>${e(r.phone || '')}</td>
      <td>${e(r.email || '')}</td>
      <td>${e(r.cuisine || '')}</td>
      <td>${e(r.cityProvince || '')}</td>
      <td class="c">${st.label}</td>
      <td class="c">${e(r.nextFollowUp || '')}</td>
    </tr>`; }).join('');
  const pageCss = `
  .page{width:297mm;min-height:210mm;margin:0 auto;background:#fff;padding:10mm 12mm}
  table{margin-top:8px}
  th,td{font-size:9.5px}
  th{background:#1E3A5F;color:#fff;font-size:8px;text-transform:uppercase;letter-spacing:.04em}
${_lh ? _lh.printCSS : ''}
  @media print{ .page{padding:0;width:auto;min-height:0} th{-webkit-print-color-adjust:exact;print-color-adjust:exact} }`;
  const bodyHtml = `
  ${_lh ? _lh.headerHTML : `<div style="border-bottom:3px solid #1E3A5F;padding-bottom:8px;margin-bottom:8px"><div style="font-size:20px;font-weight:900;color:#1E3A5F">BARRO INDUSTRIES</div><div style="font-size:10px;color:#555">ROC Restaurant Lead Sheet · ${e(todayStr)}</div></div>`}
  <table>
    <thead><tr>
      <th style="width:26px">#</th><th style="width:14%">Restaurant</th><th style="width:10%">Chain Type</th>
      <th style="width:11%">Contact Person</th><th style="width:9%">Phone</th><th style="width:13%">Email</th>
      <th style="width:9%">Cuisine</th><th>City/Province</th><th style="width:8%">Status</th><th style="width:8%">Follow-up</th>
    </tr></thead>
    <tbody>${body || `<tr><td colspan="10" class="c" style="padding:14px">No leads match the current filters.</td></tr>`}</tbody>
  </table>
  ${_lh ? _lh.footerHTML : ''}`;
  window.openPrintableDoc({
    title: `ROC Restaurant Lead Sheet — ${todayStr}`,
    barLabel: `${emojiIcon('🍽️', 16)} ROC Restaurant Lead Sheet`,
    bodyHtml, pageCss,
    winFeatures: 'width=1100,height=720'
  });
}

// ══════════════════════════════════════════════════
//  Pipeline tab — leads in Quotation + Convert-to-Quote on Won leads
// ══════════════════════════════════════════════════

// Reuses the SAME window._qbReopenState + navigateTo('bk-quote-builder')
// mechanism js/app.js's renderQuoteBuilderIframe already uses for "Reopen"/
// "New Revision" (js/app.js ~1515-1580): the builder iframe reads
// window._qbReopenState once on render and, if present, posts it into the
// iframe as a LOAD_QUOTE message (loadEditableState in quote-builder-v2.html
// fills clientName/clientCompany/clientAddress/clientPhone/clientEmail from
// whatever object is handed to it). Deliberately NOT setting sourceDocId/
// quoteNo/filedAt/items — that keeps this a FRESH, never-filed quote (no
// parentQuoteId chain, no existing line items) with only the client contact
// fields pre-populated. Caveat flagged to Neil: because reopenState is
// non-null, the desktop builder header still shows the generic "(editing a
// copy)" sublabel (app.js line ~1547) even though nothing existing is being
// edited — that label string lives in app.js's renderQuoteBuilderIframe,
// which this pass deliberately did not touch (out of scope / shared file).
function crmConvertLeadToQuote(lead, kind) {
  const company = kind === 'aec' ? (lead.company || '') : (lead.restaurantName || '');
  const address = kind === 'aec' ? (lead.address || (lead.region || '').split(' — ')[0] || '') : (lead.cityProvince || '');
  window._qbReopenState = {
    clientName: lead.contactPerson || company || '',
    clientCompany: company,
    clientAddress: address,
    clientPhone: lead.phone || '',
    clientEmail: lead.email || '',
  };
  Notifs.showToast && Notifs.showToast('Opening Quote Builder, pre-filled from ' + (company || 'this lead') + '…');
  navigateTo('bk-quote-builder');
}
window.crmConvertLeadToQuote = crmConvertLeadToQuote;

async function renderCRMPipeline(container, currentUser, currentRole) {
  await window.withLoadingAndError(container, crmFetchAll, ({ aec, roc }) => {
    const merged = [
      ...aec.map(c => ({ kind: 'aec', raw: c, name: c.company || '(no name)', contact: c.contactPerson || '', phone: c.phone || '', email: c.email || '', status: aecFunnelStatus(c) })),
      ...roc.map(r => ({ kind: 'roc', raw: r, name: r.restaurantName || '(no name)', contact: r.contactPerson || '', phone: r.phone || '', email: r.email || '', status: rocFunnelStatus(r) })),
    ];
    const quotationLeads = merged.filter(x => x.status === 'Quotation');
    const wonLeads = merged.filter(x => x.status === 'Won');

    const rowsHtml = (list, withConvert) => !list.length
      ? window.renderEmptyState({ icon: withConvert ? '🏆' : '📄', title: withConvert ? 'No Won leads yet' : 'Nothing in Quotation right now' })
      : `<div style="overflow-x:auto"><table class="data-table table-cards" style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="text-align:left;padding:7px 8px;border-bottom:1px solid var(--border);font-size:10px;text-transform:uppercase;color:var(--text-muted)">Directory</th>
            <th style="text-align:left;padding:7px 8px;border-bottom:1px solid var(--border);font-size:10px;text-transform:uppercase;color:var(--text-muted)">Name</th>
            <th style="text-align:left;padding:7px 8px;border-bottom:1px solid var(--border);font-size:10px;text-transform:uppercase;color:var(--text-muted)">Contact</th>
            <th style="text-align:left;padding:7px 8px;border-bottom:1px solid var(--border);font-size:10px;text-transform:uppercase;color:var(--text-muted)">Phone / Email</th>
            ${withConvert ? '<th style="width:120px"></th>' : ''}
          </tr></thead>
          <tbody>${list.map((x, i) => `<tr data-label="${escHtml(x.name)}">
            <td style="padding:7px 8px;border-bottom:1px solid var(--border)" data-label="Directory"><span class="badge" style="font-size:9px">${x.kind === 'aec' ? 'AEC' : 'ROC'}</span></td>
            <td style="padding:7px 8px;border-bottom:1px solid var(--border)" data-label="Name"><strong>${escHtml(x.name)}</strong></td>
            <td style="padding:7px 8px;border-bottom:1px solid var(--border)" data-label="Contact">${escHtml(x.contact)}</td>
            <td style="padding:7px 8px;border-bottom:1px solid var(--border);font-size:11px" data-label="Phone / Email">${x.phone ? escHtml(x.phone) + '<br>' : ''}${x.email ? escHtml(x.email) : ''}</td>
            ${withConvert ? `<td style="padding:7px 8px;border-bottom:1px solid var(--border)"><button class="btn-primary btn-sm crm-convert-btn" data-i="${i}">${emojiIcon('🧮', 14)} Convert to Quote</button></td>` : ''}
          </tr>`).join('')}</tbody>
        </table></div>`;

    container.innerHTML = `
      <h4 style="margin:0 0 8px">${emojiIcon('📄', 16)} In Quotation (${quotationLeads.length})</h4>
      <div style="margin-bottom:20px">${rowsHtml(quotationLeads, false)}</div>
      <h4 style="margin:0 0 8px">${emojiIcon('🏆', 16)} Won — ready to convert (${wonLeads.length})</h4>
      <div id="crm-won-list">${rowsHtml(wonLeads, true)}</div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [container] });
    container.querySelectorAll('.crm-convert-btn').forEach(btn => btn.addEventListener('click', () => {
      const x = wonLeads[Number(btn.dataset.i)];
      if (x) crmConvertLeadToQuote(x.raw, x.kind);
    }));
  }, { skeleton: 'rows' });
}
