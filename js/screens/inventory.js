/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Inventory department
   js/screens/inventory.js (added 2026-08-31, INVENTORY-DEPT-SPEC-2026-08-31)

   New department promoting Inventory from a Production sub-screen + a
   js/modules.js IIFE to a first-class department, and making it the single
   home of three databases that used to live scattered across other
   screens: the stock ledger (Stock/Movements, moved verbatim from
   js/modules.js), the raw-material supplier price list (Raw Materials —
   still rendered by js/departments.js's window.renderMaterialPriceList,
   just given a real tab here), and a NEW read-only browse of the finished-
   goods selling-price catalog (Finished Products). Count Form and Job
   Costing moved in from js/screens/production.js and js/modules.js
   respectively. Production and Purchasing each lost their own copies of
   this data (Materials/Inventory/Count Form off Production; Price List off
   Purchasing) and now link here instead — see those files' headers.

   Still a plain `window.*`-attached classic script — no ESM, no bundler.

   LOAD-ORDER CONTRACT (see index.html + CLAUDE.md "Script load order is
   load-bearing"):
     - Lazy-loaded (js/config.js PAGE_SCRIPTS 'dept:Inventory' / 'inventory'
       keys, via js/app.js's window.ensurePage) — NOT one of index.html's
       eager `defer` scripts. It is fetched the first time the Inventory
       department (or the legacy `#/inventory` route) is navigated to, so it
       always parses after every eager script (config.js, departments.js,
       app.js, modules.js) has already run.
     - window.renderInventoryDept is the entry point js/app.js's
       renderDeptModule calls ('Inventory' case) and its navigateTo switch
       calls ('inventory' legacy case) — called as
       render_X(currentUser, currentRole), NO container argument, same
       convention every js/screens/*.js department renderer already
       documents (see js/screens/crm.js's header) — this file fetches its
       own container via deptContainer() (js/departments.js, eager).
     - The Raw Materials tab calls window.renderMaterialPriceList
       (js/departments.js, eager) — always available regardless of load
       order once this file's top-level statements have run (the call
       happens at chip-click/dispatch time, never at parse time).
     - window.postStockMovement / window.buildStockMovement (js/config.js),
       canEditDept/deptContainer/dbCachedGet/dbCacheInvalidate
       (js/departments.js/js/config.js), emojiIcon/chipTabs/bindChipTabs/
       sopPanel/skeletonHtml/renderEmptyState (js/config.js/js/ui-states.js)
       — all called as window.* / bare-global at runtime, same pattern as
       every other screens file.
     - js/letterhead.js (window.buildLetterhead/openPrintableDoc, used by
       the Count Form's Print button) is bundled alongside this file in
       PAGE_SCRIPTS so it is guaranteed present without a separate guard.
   ═══════════════════════════════════════════════════ */

const peso = n => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num  = n => Number(n || 0).toLocaleString('en-PH');

window.renderInventoryDept = async function (currentUser, currentRole, subtab = window.initialSubtab('Stock')) {
  // Partners must never see costs/suppliers — this department has no NAV
  // entry for them, but guard the entry point itself in case of a direct
  // deep link. window.userProfile is the signed-in user's PROFILE doc
  // (role/departments/title) — isExternalPartnerUser needs that shape, not
  // the bare Firebase Auth `currentUser` object this function receives.
  if (currentRole === 'partner' || window.isExternalPartnerUser?.(window.userProfile)) return;

  const c = deptContainer();
  const tabs = ['Stock', 'Raw Materials', 'Finished Products', 'Movements', 'Count Form'];
  if (['president', 'manager', 'finance'].includes(currentRole)) tabs.push('Job Costing');
  subtab = tabs.includes(subtab) ? subtab : 'Stock';
  c.innerHTML = `
    <div class="page-header">
      <div>
        <h2>${emojiIcon('📦', 20)} Inventory</h2>
        <p style="font-size:12px;color:var(--text-muted);margin:2px 0 0">Stock, raw materials, finished products, movements &amp; job costing</p>
      </div>
    </div>
    ${window.sopPanel('How Inventory works', [
      'Stock tracks raw materials and finished goods on hand — Stock In/Out and manual edits all post to a full movement audit trail.',
      'Raw Materials is the supplier price list Purchasing maintains; it feeds costing and quote pricing everywhere else in the app.',
      'Finished Products is the live selling-price catalog — prices are edited by the President in Product Database.',
      'Count Form records a physical count and posts variances, correcting on-hand quantities with each correction logged to history.',
      'Job Costing (Finance/admin) tracks materials + labor vs revenue per project.'
    ])}
    ${window.chipTabs(tabs.map(s => ({ key: s, label: s })), subtab)}
    <div id="inv-content">${window.skeletonHtml('rows')}</div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  loadInvContent(currentUser, currentRole, subtab);
  window.bindChipTabs(c, (key) => { window.setSubroute(key); loadInvContent(currentUser, currentRole, key); });
};

async function loadInvContent(currentUser, currentRole, sub) {
  const el = document.getElementById('inv-content');
  try {
    if (sub === 'Raw Materials')     return await window.renderMaterialPriceList(el, currentUser, currentRole);
    if (sub === 'Finished Products') return await renderFinishedProducts(el);
    if (sub === 'Movements')         return await renderMovements(el);
    if (sub === 'Count Form')        return await renderCountForm(el, currentRole);
    if (sub === 'Job Costing')       return await renderJobs(el);
    return await renderStock(el);
  } catch (e) {
    console.error('Inventory load error', e);
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load</h4><p>${escHtml(e.message||String(e))}</p><button type="button" class="btn-secondary btn-sm inv-retry-btn" style="margin-top:14px">Retry</button></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [el] });
    el.querySelector('.inv-retry-btn')?.addEventListener('click', () => loadInvContent(currentUser, currentRole, sub));
  }
}

// ── Write predicate — MUST mirror firestore.rules' inventory_items /
// stock_movements create/update conjunct exactly:
//   isSeniorAdmin() || canFinance() || inDept('Inventory') ||
//   isPurchasingDept() || isProductionDept()
// (secretary and partner already excluded by isSeniorAdmin/canFinance/
// inDept()'s own carve-outs, but excluded again here up front so this
// reads as the plain deny-first check it is, not a canEditDept() detour —
// canEditDept() returns true for admin roles regardless of department
// membership, which is NOT what the write rule tests once role isn't
// already senior-admin/finance; see production.js:2480-2495 for the
// standing cautionary note on UI predicates broader than their rule.)
function invCanWrite() {
  const r = window.currentRole;
  if (r === 'partner' || r === 'secretary') return false;
  if (r === 'president' || r === 'manager' || r === 'finance') return true;
  return ['Inventory', 'Purchasing', 'Production', 'Finance'].some(d => (window.currentDepts || []).includes(d));
}
// Delete is senior-admin only (rules: isSeniorAdmin() on both collections).
function invCanDelete() {
  return ['president', 'manager'].includes(window.currentRole);
}

// ══════════════════════════════════════════════════
//  STOCK — moved verbatim from js/modules.js's Inventory IIFE, plus a new
//  `location` field (free-text storage location) and gating on
//  invCanWrite()/invCanDelete() in place of the old canEditInv().
// ══════════════════════════════════════════════════
async function renderStock(el) {
  el.innerHTML = window.skeletonHtml('table');
  const snap = await dbCachedGet('inventory_items', () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000);
  const items = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  const ce = invCanWrite();
  const low = items.filter(i=>(i.reorderLevel||0)>0 && (i.qty||0) <= (i.reorderLevel||0));
  const totalValue = items.reduce((s,i)=>s+((i.qty||0)*(i.unitCost||0)),0);
  const matValue  = items.filter(i=>(i.kind||'material')!=='product').reduce((s,i)=>s+((i.qty||0)*(i.unitCost||0)),0);
  const prodValue = totalValue - matValue;
  // Category grouping — items without a category fall into "Uncategorized" so
  // the value breakdown and filter chips never crash on missing data.
  const catOf = i => (i.category||'').trim() || 'Uncategorized';
  const catNames = Array.from(new Set(items.map(catOf))).sort((a,b)=> a==='Uncategorized'?1:b==='Uncategorized'?-1:a.localeCompare(b));
  const catStats = catNames.map(cn=>{
    const its = items.filter(i=>catOf(i)===cn);
    return { name:cn, count:its.length, value: its.reduce((s,i)=>s+((i.qty||0)*(i.unitCost||0)),0) };
  });
  let kindFilter='all', catFilter='all', search='';

  el.innerHTML = `
    <div class="kpi-row" style="margin-bottom:12px">
      <div class="kpi-card"><div class="kpi-label">Items</div><div class="kpi-value">${items.length}</div></div>
      <div class="kpi-card ${low.length?'red':''}"><div class="kpi-label">Low Stock</div><div class="kpi-value">${low.length}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Stock Value</div><div class="kpi-value">${peso(totalValue)}</div></div>
    </div>
    <div style="font-size:12px;color:var(--text-muted);margin:0 2px 6px">Materials ${peso(matValue)} · Finished goods ${peso(prodValue)}</div>
    ${catStats.length?`<div style="font-size:12px;color:var(--text-muted);margin:0 2px 10px">By category: ${catStats.map(cs=>`${escHtml(cs.name)} ${peso(cs.value)}`).join(' · ')}</div>`:''}
    ${low.length?`<div class="alert-banner alert-warn" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>${emojiIcon('⚠️',16)} <strong>${low.length} item${low.length>1?'s':''}</strong> at or below reorder level</span>${ce?`<button class="btn-secondary btn-sm" id="inv-reorder-btn" title="Open Purchasing to raise an RFQ for low-stock materials">${emojiIcon('📉',16)} Reorder via RFQ</button>`:''}</div>`:''}
    ${window.chipTabs([{key:'all',label:'All'},{key:'material',label:'Raw Materials'},{key:'product',label:'Finished Goods'}],'all',{cls:'inv-kind'})}
    ${catStats.length?window.chipTabs([{key:'all',label:`All (${items.length})`}].concat(catStats.map(cs=>({key:cs.name,label:`${cs.name} (${cs.count})`}))),'all',{cls:'inv-cat-chips'}):''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <input id="inv-search" placeholder="🔎 Search item, supplier, category, location…" style="flex:1;min-width:160px;padding:8px 12px;border:1.5px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font-size:13px"/>
      <button class="btn-secondary btn-sm" id="inv-csv">${emojiIcon('⬇',16)} CSV</button>
      ${ce?'<button class="btn-primary btn-sm" id="inv-add-btn">＋ Add Item</button>':''}
    </div>
    <div class="card"><div class="card-body" style="padding:0"><div id="inv-table"></div></div></div>`;
  if (window.lucide) lucide.createIcons({ nodes: [el] });

  const filtered = () => items.filter(i=>{
    if (kindFilter!=='all' && (i.kind||'material')!==kindFilter) return false;
    if (catFilter!=='all' && catOf(i)!==catFilter) return false;
    if (search){ const s=search.toLowerCase(); if(!((i.name||'').toLowerCase().includes(s)||(i.supplier||'').toLowerCase().includes(s)||(i.category||'').toLowerCase().includes(s)||(i.location||'').toLowerCase().includes(s))) return false; }
    return true;
  });

  const renderTable = () => {
    const shown = filtered();
    const shownValue = shown.reduce((s,i)=>s+((i.qty||0)*(i.unitCost||0)),0);
    const tbl = document.getElementById('inv-table');
    if (!tbl) return;
    tbl.innerHTML = !shown.length ? `<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon('📦',44)}</div><h4>No items match</h4></div>` :
      `<div class="table-wrap"><table class="data-table table-cards">
        <thead><tr><th>Item</th><th>Type</th><th>On Hand</th><th>Reorder</th><th>Unit Cost</th><th>Value</th><th>Supplier</th><th>Location</th><th></th></tr></thead>
        <tbody>${shown.map(i=>{
          const lowItem=(i.reorderLevel||0)>0 && (i.qty||0)<=(i.reorderLevel||0);
          return `<tr class="inv-row">
            <td class="tc-name" style="font-weight:600">${escHtml(i.name||'—')}${i.category?`<div style="font-size:11px;color:var(--text-muted)">${escHtml(i.category)}</div>`:''} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
            <td class="tc-detail" data-label="Type"><span class="badge ${(i.kind||'material')==='product'?'badge-blue':'badge-gray'}">${(i.kind||'material')==='product'?'Finished':'Material'}</span></td>
            <td class="tc-net" style="font-weight:700;color:${lowItem?'var(--danger)':'inherit'}">${num(i.qty||0)} ${escHtml(i.unit||'')}${lowItem?` ${emojiIcon('⚠️',16)}`:''}</td>
            <td class="tc-detail" data-label="Reorder" style="font-size:12px;color:var(--text-muted)">${num(i.reorderLevel||0)}</td>
            <td class="tc-detail" data-label="Unit Cost">${peso(i.unitCost||0)}</td>
            <td class="tc-detail" data-label="Value">${peso((i.qty||0)*(i.unitCost||0))}</td>
            <td class="tc-detail" data-label="Supplier" style="font-size:12px">${escHtml(i.supplier||'—')}</td>
            <td class="tc-detail" data-label="Location" style="font-size:12px">${escHtml(i.location||'—')}</td>
            <td class="tc-actions" style="white-space:nowrap">
              <button class="btn-secondary btn-sm inv-hist-btn" data-id="${i.id}" title="Movement history">${emojiIcon('📜',16)}</button>
              ${ce?`<button class="btn-success btn-sm inv-in-btn" data-id="${i.id}" title="Stock In">＋</button>
              <button class="btn-secondary btn-sm inv-out-btn" data-id="${i.id}" title="Stock Out">−</button>
              <button class="btn-secondary btn-sm inv-edit-btn" data-id="${i.id}" title="Edit">${emojiIcon('✎',16)}</button>`:''}
            </td>
          </tr>`;}).join('')}</tbody>
        <tfoot><tr><td colspan="5" style="text-align:right;font-weight:700;color:var(--text-muted)">Shown value</td><td style="font-weight:700">${peso(shownValue)}</td><td colspan="3"></td></tr></tfoot>
      </table></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [tbl] });
    // Card view (≤700px) — tap a row to reveal the full breakdown.
    tbl.querySelectorAll('tr.inv-row').forEach(tr => {
      tr.addEventListener('click', (ev) => {
        if (ev.target.closest('button, a')) return;
        tr.classList.toggle('tc-expanded');
      });
    });
    // Row actions
    tbl.querySelectorAll('.inv-hist-btn').forEach(b=>b.addEventListener('click',()=>itemHistoryModal(items.find(i=>i.id===b.dataset.id))));
    if(ce){
      tbl.querySelectorAll('.inv-edit-btn').forEach(b=>b.addEventListener('click',()=>itemModal(items.find(i=>i.id===b.dataset.id),()=>renderStock(el))));
      tbl.querySelectorAll('.inv-in-btn').forEach(b=>b.addEventListener('click',()=>moveModal(items.find(i=>i.id===b.dataset.id),'in',()=>renderStock(el))));
      tbl.querySelectorAll('.inv-out-btn').forEach(b=>b.addEventListener('click',()=>moveModal(items.find(i=>i.id===b.dataset.id),'out',()=>renderStock(el))));
    }
  };

  window.bindChipTabs(el.querySelector('.inv-kind'), (key)=>{ kindFilter=key; renderTable(); });
  if (catStats.length) window.bindChipTabs(el.querySelector('.inv-cat-chips'), (key)=>{ catFilter=key; renderTable(); });
  let _t; document.getElementById('inv-search')?.addEventListener('input', e=>{ clearTimeout(_t); const v=e.target.value; _t=setTimeout(()=>{ search=v.trim(); renderTable(); },180); });
  document.getElementById('inv-reorder-btn')?.addEventListener('click', ()=>{ try{ Notifs.info('Opening Purchasing — use “From low stock” to raise an RFQ.'); }catch(_){} navigateTo('dept:Purchasing'); });
  document.getElementById('inv-csv')?.addEventListener('click',()=>window.exportCSV('inventory', filtered(), [
    {key:'name',label:'Item'},{key:'kind',label:'Type',get:i=>(i.kind||'material')},{key:'category',label:'Category'},
    {key:'qty',label:'On Hand',get:i=>i.qty||0},{key:'unit',label:'Unit'},{key:'reorderLevel',label:'Reorder',get:i=>i.reorderLevel||0},
    {key:'unitCost',label:'Unit Cost',get:i=>i.unitCost||0},{key:'value',label:'Stock Value',get:i=>(i.qty||0)*(i.unitCost||0)},{key:'supplier',label:'Supplier'},
    {key:'location',label:'Location'}]));
  if(ce) document.getElementById('inv-add-btn')?.addEventListener('click',()=>itemModal(null,()=>renderStock(el)));
  renderTable();
}

// Per-item movement history — equality query (no composite index), sorted client-side.
async function itemHistoryModal(item) {
  if(!item) return;
  const panel = openPage(`${emojiIcon('📜',16)} `+(item.name||'Item')+' — Movement History', window.skeletonHtml('table'),
    `<button class="btn-secondary" onclick="closeModal()">Close</button>`);
  const snap = await db.collection('stock_movements').where('itemId','==',item.id).get().catch(()=>({docs:[]}));
  const mv = snap.docs.map(d=>d.data()).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
  const body = panel.querySelector('.page-panel-body');
  const html = !mv.length ? `<div class="empty-state" style="padding:18px"><div class="empty-icon">${emojiIcon('📋',44)}</div><h4>No movements recorded</h4></div>` :
    `<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">On-hand now: <strong>${num(item.qty||0)} ${escHtml(item.unit||'')}</strong></div>
     <div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>Qty</th><th>Project / Note</th><th>By</th></tr></thead>
     <tbody>${mv.map(m=>`<tr>
       <td style="font-size:12px">${escHtml(m.date||'—')}</td>
       <td><span class="badge ${m.type==='in'?'badge-green':m.type==='adjust'?'badge-blue':'badge-orange'}">${m.type==='in'?'IN':m.type==='adjust'?'ADJ':'OUT'}</span></td>
       <td>${num(m.qty||0)}</td>
       <td style="font-size:12px">${m.refNumber?`<span class="badge badge-gray" style="margin-right:4px">${escHtml(m.refNumber)}</span>`:''}${escHtml(m.project||m.note||'—')}</td>
       <td style="font-size:11px">${escHtml(m.byName||'—')}</td>
     </tr>`).join('')}</tbody></table></div>`;
  if (body) body.innerHTML = html;
}

function itemModal(item, onSaved) {
  const e=item||{};
  const _panel = openPage(item?'Edit Item':'Add Inventory Item', `
    <div class="form-group"><label>Name</label><input id="iv-name" list="iv-name-datalist" value="${escHtml(e.name||'')}" placeholder="e.g. Stainless Sheet 4x8 ga.16"/><datalist id="iv-name-datalist"></datalist></div>
    <div class="form-row">
      <div class="form-group"><label>Type</label><select id="iv-kind"><option value="material" ${e.kind!=='product'?'selected':''}>Raw Material</option><option value="product" ${e.kind==='product'?'selected':''}>Finished Good</option></select></div>
      <div class="form-group"><label>Unit</label><input id="iv-unit" value="${escHtml(e.unit||'')}" placeholder="sheet / m / kg / pc"/></div>
    </div>
    <div class="form-group"><label>Category</label><input id="iv-cat" value="${escHtml(e.category||'')}" placeholder="e.g. Stainless, Fasteners, Cooking Equipment"/></div>
    <div class="form-row">
      <div class="form-group"><label>On-hand Qty</label><input id="iv-qty" type="number" inputmode="decimal" step="0.01" value="${e.qty||0}"/></div>
      <div class="form-group"><label>Reorder Level</label><input id="iv-reorder" type="number" inputmode="decimal" step="0.01" value="${e.reorderLevel||0}"/></div>
    </div>
    <div class="form-group"><label>Unit Cost (₱)</label><input id="iv-cost" type="number" inputmode="decimal" step="0.01" value="${e.unitCost||0}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Supplier</label><input id="iv-supplier" value="${escHtml(e.supplier||'')}"/></div>
      <div class="form-group"><label>Supplier Contact</label><input id="iv-supcontact" value="${escHtml(e.supplierContact||'')}"/></div>
    </div>
    <div class="form-group"><label>Location</label><input id="iv-location" value="${escHtml(e.location||'')}" placeholder="e.g. Main warehouse / Rack B"/></div>
    <div id="iv-err" class="error-msg hidden"></div>
  `, `<button class="btn-primary" id="iv-save">Save</button>${(item && invCanDelete())?'<button class="btn-danger" id="iv-del">Delete</button>':''}<button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  // ⚠ SCOPED TO THIS PANEL, NOT document.
  // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second record
  // inside that window and two panels carry the same ids at once —
  // document.getElementById() returns the FIRST in document order, which is
  // the DYING one, so the handler binds to a button nobody can see and the
  // visible button does nothing — and a save that runs in that window reads
  // the PREVIOUS record's field values and writes them onto this one.
  // (Corporate Secretary report, reproduced in-browser 2026-08-10.)
  const $iv = (id) => _panel.querySelector('#' + id);
  // Light bridge to the Finished Products catalog — prefills the Name field
  // from a datalist of product titles so free-typed finished-goods stock can
  // match the catalog's naming. Prefill only; nothing new is stored, and a
  // failed/slow fetch just leaves the datalist empty (soft-fail).
  dbCachedGet('products-catalog', () => db.collection('products').limit(1000).get(), 45000).then(snap => {
    const dl = _panel.querySelector('#iv-name-datalist');
    if (!dl) return;
    const names = Array.from(new Set((snap.docs||[]).map(d => (d.data().title || d.data().name || '').trim()).filter(Boolean))).sort();
    dl.innerHTML = names.map(n => `<option value="${escHtml(n)}"></option>`).join('');
  }).catch(()=>{});
  $iv('iv-save').addEventListener('click', async ()=>{
    const name=$iv('iv-name').value.trim();
    const err=$iv('iv-err');
    if(!name){ err.textContent='Name is required.'; err.classList.remove('hidden'); return; }
    const data={ name, kind:$iv('iv-kind').value,
      unit:$iv('iv-unit').value.trim(), category:$iv('iv-cat').value.trim(),
      qty:parseFloat($iv('iv-qty').value)||0, reorderLevel:parseFloat($iv('iv-reorder').value)||0,
      unitCost:parseFloat($iv('iv-cost').value)||0,
      supplier:$iv('iv-supplier').value.trim(), supplierContact:$iv('iv-supcontact').value.trim(),
      location:$iv('iv-location').value.trim(),
      updatedAt:firebase.firestore.FieldValue.serverTimestamp() };
    try{
      if(item){
        const oldQty = item.qty||0;
        const newQty = parseFloat($iv('iv-qty').value)||0;
        const delta = newQty - oldQty;
        const upd = { ...data };
        delete upd.qty;
        if (Math.abs(delta) > 1e-9) upd.qty = firebase.firestore.FieldValue.increment(delta);
        await db.collection('inventory_items').doc(item.id).update(upd);
        window.logAudit&&window.logAudit('update','inventory_item',item.id,{name,qty:data.qty});
        // A manual on-hand edit changes stock without a Stock In/Out — log an
        // 'adjust' movement so the history reflects every quantity change.
        if (Math.abs((data.qty||0) - oldQty) > 1e-9) {
          await window.postStockMovement({ itemId:item.id, itemName:name, type:'adjust',
            qty:Math.abs((data.qty||0)-oldQty), note:`Manual edit ${num(oldQty)} → ${num(data.qty||0)}`,
            source:'manual', unitCost:data.unitCost||null, qtyAfter:data.qty||0 }).catch(()=>{});
        }
      }
      else { data.createdAt=firebase.firestore.FieldValue.serverTimestamp(); const _r=await db.collection('inventory_items').add(data); window.logAudit&&window.logAudit('create','inventory_item',_r.id,{name,qty:data.qty}); }
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('inventory_items');
      closeModal(); Notifs.success('Item saved'); onSaved&&onSaved();
    }catch(ex){ err.textContent='Save failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
  });
  $iv('iv-del')?.addEventListener('click', async ()=>{
    if(!(await confirmDialog({ message: 'Delete this item?', danger: true }))) return;
    try{ await db.collection('inventory_items').doc(item.id).delete(); window.logAudit&&window.logAudit('delete','inventory_item',item.id,{name:item.name||''}); if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('inventory_items'); closeModal(); Notifs.success('Item deleted'); onSaved&&onSaved(); }
    catch(ex){ Notifs.showToast('Delete failed','error'); }
  });
}

function moveModal(item, type, onSaved) {
  if(!item) return;
  const _panel = openPage((type==='in'?`${emojiIcon('➕',16)} Stock In — `:`${emojiIcon('➖',16)} Stock Out — `)+(item.name||''), `
    <div style="font-size:13px;color:var(--text-muted);margin-bottom:10px">Current on-hand: <strong>${num(item.qty||0)} ${escHtml(item.unit||'')}</strong></div>
    <div class="form-group"><label>Quantity to ${type==='in'?'add':'remove'}</label><input id="mv-qty" type="number" inputmode="decimal" step="0.01" min="0"/></div>
    ${type==='out'?`<div class="form-group"><label>Project / Job (optional)</label><input id="mv-project" placeholder="e.g. Gerry's Grill — Bulacan"/></div>`:''}
    <div class="form-group"><label>Note (optional)</label><input id="mv-note" placeholder="PO #, reason, etc."/></div>
    <div id="mv-err" class="error-msg hidden"></div>
  `, `<button class="btn-primary" id="mv-save">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  // ⚠ SCOPED TO THIS PANEL, NOT document.
  // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second record
  // inside that window and two panels carry the same ids at once —
  // document.getElementById() returns the FIRST in document order, which is
  // the DYING one, so the handler binds to a button nobody can see and the
  // visible button does nothing — and a save that runs in that window reads
  // the PREVIOUS record's field values and writes them onto this one.
  // (Corporate Secretary report, reproduced in-browser 2026-08-10.)
  const $mv = (id) => _panel.querySelector('#' + id);
  $mv('mv-save').addEventListener('click', async ()=>{
    const qty=parseFloat($mv('mv-qty').value)||0;
    const err=$mv('mv-err');
    if(qty<=0){ err.textContent='Enter a quantity greater than 0.'; err.classList.remove('hidden'); return; }
    const delta = type==='in'? qty : -qty;
    try{
      await db.collection('inventory_items').doc(item.id).update({ qty: firebase.firestore.FieldValue.increment(delta), updatedAt:firebase.firestore.FieldValue.serverTimestamp() });
      await window.postStockMovement({ itemId:item.id, itemName:item.name||'', type, qty,
        project: type==='out'?($mv('mv-project')?.value.trim()||''):'',
        note:$mv('mv-note').value.trim(),
        source:'manual', unitCost:item.unitCost||null, qtyAfter:(item.qty||0)+delta });
      window.logAudit&&window.logAudit('create','stock_movement',item.id,{itemName:item.name||'',type,qty,delta});
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('inventory_items');
      closeModal(); Notifs.success('Stock updated'); onSaved&&onSaved();
    }catch(ex){ err.textContent='Failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
  });
}

// ══════════════════════════════════════════════════
//  MOVEMENTS — moved verbatim from js/modules.js.
// ══════════════════════════════════════════════════
async function renderMovements(el) {
  el.innerHTML=window.skeletonHtml('table');
  const snap=await db.collection('stock_movements').orderBy('createdAt','desc').limit(200).get().catch(()=>({docs:[]}));
  const mv=snap.docs.map(d=>d.data());
  const typeBadge = t => t==='in'?'<span class="badge badge-green">IN</span>':t==='adjust'?'<span class="badge badge-blue">ADJ</span>':'<span class="badge badge-orange">OUT</span>';
  let typeFilter='all', search='';
  el.innerHTML=`<div class="card"><div class="card-header" style="display:flex;justify-content:space-between;align-items:center"><h3>${emojiIcon('📋',20)} Stock Movement Log</h3>${mv.length?`<button class="btn-secondary btn-sm" id="mv-csv">${emojiIcon('⬇',16)} CSV</button>`:''}</div>
    <div class="card-body">
    ${!mv.length?`<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon('📋',44)}</div><h4>No movements yet</h4></div>`:`
    ${window.chipTabs([{key:'all',label:'All'},{key:'in',label:'In'},{key:'out',label:'Out'},{key:'adjust',label:'Adjust'}],'all',{cls:'mv-type'})}
    <input id="mv-search" placeholder="🔎 Search item, project, note…" style="width:100%;padding:8px 12px;border:1.5px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font-size:13px;margin-bottom:10px"/>
    <div id="mv-table"></div>`}
    </div></div>`;
  if (window.lucide) lucide.createIcons({ nodes: [el] });
  const filtered = () => mv.filter(m=>{
    if (typeFilter!=='all' && (m.type||'out')!==typeFilter) return false;
    if (search){ const s=search.toLowerCase(); if(!((m.itemName||'').toLowerCase().includes(s)||(m.project||'').toLowerCase().includes(s)||(m.note||'').toLowerCase().includes(s)||(m.refNumber||'').toLowerCase().includes(s))) return false; }
    return true;
  });
  const renderRows = () => {
    const rows = filtered(); const tbl=document.getElementById('mv-table'); if(!tbl) return;
    tbl.innerHTML = !rows.length ? `<div class="empty-state" style="padding:18px"><div class="empty-icon">${emojiIcon('🔎',44)}</div><h4>No movements match</h4></div>` :
      `<div class="table-wrap"><table class="data-table table-cards">
        <thead><tr><th>Date</th><th>Item</th><th>Type</th><th>Source</th><th>Qty</th><th>Project</th><th>Note</th><th>By</th></tr></thead>
        <tbody>${rows.map(m=>`<tr class="mv-row">
          <td class="tc-avatar" style="font-size:12px;white-space:nowrap">${escHtml(m.date||'—')}</td>
          <td class="tc-name" style="font-weight:600">${escHtml(m.itemName||'—')} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
          <td class="tc-detail" data-label="Type">${typeBadge(m.type)}</td>
          <td class="tc-detail" data-label="Source" style="font-size:11px;color:var(--text-muted)">${escHtml(m.source||'manual')}${m.refNumber?`<div>${escHtml(m.refNumber)}</div>`:''}</td>
          <td class="tc-net">${num(m.qty||0)}</td>
          <td class="tc-detail" data-label="Project" style="font-size:12px">${escHtml(m.project||'—')}</td>
          <td class="tc-detail" data-label="Note" style="font-size:12px">${escHtml(m.note||'—')}</td>
          <td class="tc-detail" data-label="By" style="font-size:11px">${escHtml(m.byName||'—')}</td>
        </tr>`).join('')}</tbody></table></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [tbl] });
    tbl.querySelectorAll('tr.mv-row').forEach(tr => tr.addEventListener('click', () => tr.classList.toggle('tc-expanded')));
  };
  if (mv.length){
    window.bindChipTabs(el.querySelector('.mv-type'), (key)=>{ typeFilter=key; renderRows(); });
    let _t; document.getElementById('mv-search')?.addEventListener('input', e=>{ clearTimeout(_t); const v=e.target.value; _t=setTimeout(()=>{ search=v.trim(); renderRows(); },180); });
    renderRows();
  }
  document.getElementById('mv-csv')?.addEventListener('click',()=>window.exportCSV('stock-movements', filtered(), [
    {key:'date',label:'Date'},{key:'itemName',label:'Item'},{key:'type',label:'Type',get:m=>m.type==='in'?'IN':m.type==='adjust'?'ADJ':'OUT'},
    {key:'source',label:'Source',get:m=>m.source||'manual'},{key:'refNumber',label:'Ref',get:m=>m.refNumber||''},
    {key:'unitCost',label:'Unit Cost',get:m=>m.unitCost==null?'':m.unitCost},
    {key:'qty',label:'Qty',get:m=>m.qty||0},{key:'project',label:'Project'},{key:'note',label:'Note'},{key:'byName',label:'By'}]));
}

// ══════════════════════════════════════════════════
//  JOB COSTING — moved verbatim from js/modules.js. Finance-tier UI gate
//  (rules already isMoneyAdmin() at firestore.rules — unchanged).
// ══════════════════════════════════════════════════
function isFinAdmin() { return ['president','manager','finance'].includes(window.currentRole); }

async function renderJobs(el) {
  el.innerHTML=window.skeletonHtml('table');
  const snap=await db.collection('job_costs').orderBy('createdAt','desc').limit(200).get().catch(()=>({docs:[]}));
  const jobs=snap.docs.map(d=>({id:d.id,...d.data()}));
  const ce=isFinAdmin();
  el.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px">
      <div style="font-size:12px;color:var(--text-muted);flex:1">Materials + labor vs revenue = margin per project</div>
      ${jobs.length?`<button class="btn-secondary btn-sm" id="jobs-csv">${emojiIcon('⬇',16)} CSV</button>`:''}
      ${ce?'<button class="btn-primary btn-sm" id="job-add-btn">＋ New Job</button>':''}
    </div>
    <div class="card"><div class="card-body" style="padding:0">
    ${!jobs.length?`<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon('🧮',44)}</div><h4>No job costs yet</h4></div>`:
    `<div class="table-wrap"><table class="data-table table-cards">
      <thead><tr><th>Project</th><th>Revenue</th><th>Materials</th><th>Labor</th><th>Other</th><th>Cost</th><th>Margin</th>${ce?'<th></th>':''}</tr></thead>
      <tbody>${jobs.map(j=>{const cost=(j.materialsCost||0)+(j.laborCost||0)+(j.otherCost||0);const margin=(j.revenue||0)-cost;const pct=j.revenue?Math.round(margin/j.revenue*100):0;return `<tr class="job-row">
        <td class="tc-name" style="font-weight:600">${escHtml(j.project||'—')}${j.quoteRef?`<div style="font-size:11px;color:var(--text-muted)">${escHtml(j.quoteRef)}</div>`:''} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
        <td class="tc-detail" data-label="Revenue">${peso(j.revenue||0)}</td>
        <td class="tc-detail" data-label="Materials">${peso(j.materialsCost||0)}</td>
        <td class="tc-detail" data-label="Labor">${peso(j.laborCost||0)}</td>
        <td class="tc-detail" data-label="Other">${peso(j.otherCost||0)}</td>
        <td class="tc-detail" data-label="Cost">${peso(cost)}</td>
        <td class="tc-net" style="font-weight:700;color:${margin>=0?'var(--success)':'var(--danger)'}">${peso(margin)}<div style="font-size:11px">${pct}%</div></td>
        ${ce?`<td class="tc-actions"><button class="btn-secondary btn-sm job-edit-btn" data-id="${j.id}" title="Edit">${emojiIcon('✎',16)}</button></td>`:''}
      </tr>`;}).join('')}</tbody></table></div>`}
    </div></div>`;
  if (window.lucide) lucide.createIcons({ nodes: [el] });
  el.querySelectorAll('tr.job-row').forEach(tr => tr.addEventListener('click', (ev) => {
    if (ev.target.closest('button, a')) return;
    tr.classList.toggle('tc-expanded');
  }));
  document.getElementById('jobs-csv')?.addEventListener('click',()=>window.exportCSV('job-costing', jobs, [
    {key:'project',label:'Project'},{key:'quoteRef',label:'Quote Ref'},{key:'revenue',label:'Revenue',get:j=>j.revenue||0},
    {key:'materialsCost',label:'Materials',get:j=>j.materialsCost||0},{key:'laborCost',label:'Labor',get:j=>j.laborCost||0},{key:'otherCost',label:'Other',get:j=>j.otherCost||0},
    {key:'cost',label:'Total Cost',get:j=>(j.materialsCost||0)+(j.laborCost||0)+(j.otherCost||0)},
    {key:'margin',label:'Margin',get:j=>(j.revenue||0)-((j.materialsCost||0)+(j.laborCost||0)+(j.otherCost||0))}]));
  if(ce){
    document.getElementById('job-add-btn')?.addEventListener('click',()=>jobModal(null,()=>renderJobs(el)));
    el.querySelectorAll('.job-edit-btn').forEach(b=>b.addEventListener('click',()=>jobModal(jobs.find(j=>j.id===b.dataset.id),()=>renderJobs(el))));
  }
}

function jobModal(job, onSaved) {
  const e=job||{};
  const _panel = openPage(job?'Edit Job Cost':'New Job Cost', `
    <div class="form-group"><label>Project / Client</label><input id="jb-project" value="${escHtml(e.project||'')}" placeholder="e.g. Gerry's Grill — Bulacan"/></div>
    <div class="form-group"><label>Quote Ref (optional)</label><input id="jb-quote" value="${escHtml(e.quoteRef||'')}" placeholder="BK-LU-FB-..."/></div>
    <div class="form-row">
      <div class="form-group"><label>Revenue (₱)</label><input id="jb-rev" type="number" inputmode="decimal" step="0.01" value="${e.revenue||0}"/></div>
      <div class="form-group"><label>Materials Cost (₱)</label><input id="jb-mat" type="number" inputmode="decimal" step="0.01" value="${e.materialsCost||0}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Labor Cost (₱)</label><input id="jb-lab" type="number" inputmode="decimal" step="0.01" value="${e.laborCost||0}"/></div>
      <div class="form-group"><label>Other Cost (₱)</label><input id="jb-oth" type="number" inputmode="decimal" step="0.01" value="${e.otherCost||0}"/></div>
    </div>
    <div id="jb-err" class="error-msg hidden"></div>
  `, `<button class="btn-primary" id="jb-save">Save</button>${job?'<button class="btn-danger" id="jb-del">Delete</button>':''}<button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  // ⚠ SCOPED TO THIS PANEL, NOT document.
  // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second record
  // inside that window and two panels carry the same ids at once —
  // document.getElementById() returns the FIRST in document order, which is
  // the DYING one, so the handler binds to a button nobody can see and the
  // visible button does nothing — and a save that runs in that window reads
  // the PREVIOUS record's field values and writes them onto this one.
  // (Corporate Secretary report, reproduced in-browser 2026-08-10.)
  const $jb = (id) => _panel.querySelector('#' + id);
  $jb('jb-save').addEventListener('click', async ()=>{
    const project=$jb('jb-project').value.trim();
    const err=$jb('jb-err');
    if(!project){ err.textContent='Project name is required.'; err.classList.remove('hidden'); return; }
    const data={ project, quoteRef:$jb('jb-quote').value.trim(),
      revenue:parseFloat($jb('jb-rev').value)||0, materialsCost:parseFloat($jb('jb-mat').value)||0,
      laborCost:parseFloat($jb('jb-lab').value)||0, otherCost:parseFloat($jb('jb-oth').value)||0,
      updatedAt:firebase.firestore.FieldValue.serverTimestamp() };
    try{
      if(job) await db.collection('job_costs').doc(job.id).update(data);
      else { data.createdAt=firebase.firestore.FieldValue.serverTimestamp(); await db.collection('job_costs').add(data); }
      closeModal(); Notifs.success('Job cost saved'); onSaved&&onSaved();
    }catch(ex){ err.textContent='Save failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
  });
  $jb('jb-del')?.addEventListener('click', async ()=>{
    if(!(await confirmDialog({ message: 'Delete this job cost?', danger: true }))) return;
    // Re-audit 2026-08-03: this deleted a money-adjacent job-cost record with only
    // a toast — no audit trail of who removed it (unlike itemModal's delete a few
    // lines above, which does log it).
    try{ await db.collection('job_costs').doc(job.id).delete(); window.logAudit&&window.logAudit('delete','job_cost',job.id,{project:job.project||''}); closeModal(); Notifs.success('Deleted'); onSaved&&onSaved(); }
    catch(ex){ Notifs.showToast('Delete failed','error'); }
  });
}

// ══════════════════════════════════════════════════
//  FINISHED PRODUCTS — NEW read-only browse of the selling-price catalog
//  (`products` + `productMeta`). Deliberately never touches `product_costs`
//  (capital/margin) — this screen is for finding a product and its selling
//  price, not for costing. The President still edits prices/specs in the
//  existing Product Database screen (`navigateTo('product-database')`).
// ══════════════════════════════════════════════════
async function renderFinishedProducts(el) {
  el.innerHTML = window.skeletonHtml('table');
  let products = [], meta = {};
  try {
    const [pSnap, mSnap] = await Promise.all([
      dbCachedGet('products-catalog', () => db.collection('products').limit(1000).get(), 45000).catch(()=>({docs:[]})),
      dbCachedGet('product-meta', () => db.collection('productMeta').doc('config').get(), 300000).catch(()=>null)
    ]);
    products = (pSnap.docs||[]).map(d=>({id:d.id,...d.data()}));
    meta = (mSnap && mSnap.exists) ? mSnap.data() : {};
  } catch (e) {
    el.innerHTML = window.renderEmptyState({ icon:'⚠️', title:"Couldn't load the catalog", hint: e.message||String(e) });
    if (window.lucide) lucide.createIcons({ nodes: [el] });
    return;
  }
  const categories = Array.isArray(meta.categories) ? meta.categories : [];
  const catLabel = (catId) => (categories.find(c=>c.id===catId)||{}).label || catId || 'Uncategorized';
  const isPresident = window.currentRole === 'president';

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:10px">
      <p style="font-size:12px;color:var(--text-muted);margin:0;max-width:520px">Live catalog — selling prices. Edited by the President.</p>
      ${isPresident?`<button class="btn-secondary btn-sm" id="fp-edit-btn">${emojiIcon('✎',14)} Open editor →</button>`:''}
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
      <input id="fp-search" placeholder="🔎 Search name, category, notes…" style="flex:1;min-width:160px;padding:8px 12px;border:1.5px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font-size:13px"/>
    </div>
    ${categories.length?window.chipTabs([{key:'all',label:'All',count:products.length}].concat(categories.map(c=>({key:c.id,label:c.label||c.id,count:products.filter(p=>p.category===c.id).length}))),'all',{cls:'fp-cat-chips'}):''}
    <div class="table-wrap" style="margin-top:6px"><table class="data-table table-cards">
      <thead><tr><th></th><th>Name</th><th>Category</th><th>Unit</th><th>Base Price</th><th>Lead Time</th></tr></thead>
      <tbody id="fp-tbody"></tbody>
    </table></div>
    <div id="fp-showall-wrap"></div>`;
  if (window.lucide) lucide.createIcons({ nodes: [el] });

  const state = { cat: 'all', q: '', showAll: false };
  const FP_CAP = 150;
  const renderRows = () => {
    const q = state.q.trim().toLowerCase();
    let rows = products;
    if (state.cat !== 'all') rows = rows.filter(p => p.category === state.cat);
    if (q) rows = rows.filter(p => {
      const title = (p.title||p.name||'').toLowerCase();
      const cat = catLabel(p.category).toLowerCase();
      const notes = (p.specifications||p.notes||'').toLowerCase();
      return title.includes(q) || cat.includes(q) || notes.includes(q);
    });
    const capped = state.showAll ? rows : rows.slice(0, FP_CAP);
    const tbody = el.querySelector('#fp-tbody');
    tbody.innerHTML = !capped.length ? `<tr><td colspan="6">${window.renderEmptyState({icon:'📦',title:'No products match'})}</td></tr>` :
      capped.map(p => {
        const price = Number(p.basePrice ?? p.baseRate ?? 0);
        const thumb = p.photoUrl
          ? `<img src="${escHtml(p.photoUrl)}" alt="" style="width:32px;height:32px;object-fit:cover;border-radius:6px"/>`
          : `<span style="font-size:20px">${emojiIcon('📦',20)}</span>`;
        return `<tr>
          <td style="width:40px">${thumb}</td>
          <td class="tc-name" style="font-weight:600">${escHtml(p.title||p.name||'—')}</td>
          <td class="tc-detail" data-label="Category" style="font-size:12px">${escHtml(catLabel(p.category))}</td>
          <td class="tc-detail" data-label="Unit" style="font-size:12px">${escHtml(p.unit||'—')}</td>
          <td class="tc-net" style="font-weight:700">${peso(price)}</td>
          <td class="tc-detail" data-label="Lead Time" style="font-size:12px">${escHtml(p.leadTime||'—')}</td>
        </tr>`;
      }).join('');
    const wrap = el.querySelector('#fp-showall-wrap');
    wrap.innerHTML = (!state.showAll && rows.length > FP_CAP)
      ? `<div style="text-align:center;margin:10px 0"><button type="button" class="btn-secondary btn-sm" id="fp-show-all">Show all ${rows.length}</button></div>` : '';
    wrap.querySelector('#fp-show-all')?.addEventListener('click', ()=>{ state.showAll = true; renderRows(); });
  };

  el.querySelector('#fp-search')?.addEventListener('input', e => { state.q = e.target.value; state.showAll = false; renderRows(); });
  if (categories.length) window.bindChipTabs(el.querySelector('.fp-cat-chips'), (key) => { state.cat = key; state.showAll = false; renderRows(); });
  el.querySelector('#fp-edit-btn')?.addEventListener('click', ()=>navigateTo('product-database'));
  renderRows();
}

// ══════════════════════════════════════════════════
//  COUNT FORM — moved verbatim from js/screens/production.js
//  (renderProdInventoryForm renamed renderCountForm; PROD_COUNT_DRAFT_KEY /
//  loadCountDraft / saveCountDraft / openInventoryCountForm kept, including
//  the localStorage draft key string 'bi-prod-count-draft-<uid>' UNCHANGED
//  so in-progress drafts survive the move).
// ══════════════════════════════════════════════════

// v14 prod-fixlist — namespaced per signed-in user. The key used to be one
// fixed global string, so a shared shop-floor device/kiosk used by more than
// one person during the same count cycle had one person's in-progress counts
// silently overwritten by the next person opening the Count Form. Falls back
// to a shared 'anon' bucket if no user is signed in yet (shouldn't happen —
// this form is behind auth).
const PROD_COUNT_DRAFT_KEY = 'bi-prod-count-draft';
function prodCountDraftKey(){
  const uid = (typeof currentUser !== 'undefined' && currentUser && currentUser.uid) || 'anon';
  return PROD_COUNT_DRAFT_KEY + '-' + uid;
}
function loadCountDraft(){ try { return JSON.parse(localStorage.getItem(prodCountDraftKey()) || '{}') || {}; } catch(e){ return {}; } }
function saveCountDraft(d){ try { localStorage.setItem(prodCountDraftKey(), JSON.stringify(d)); } catch(e){} }

async function renderCountForm(el, currentRole, kindFilter='all'){
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

  window.bindChipTabs(el, (key)=>renderCountForm(el,currentRole,key));
  document.getElementById('cf-addrow')?.addEventListener('click',()=>{ draft.extras.push({}); persist(); renderCountForm(el,currentRole,kindFilter); });
  document.getElementById('cf-clear')?.addEventListener('click', async ()=>{
    if(!(await confirmDialog({message:'Clear all counts, remarks and header fields on this form?', danger:true}))) return;
    localStorage.removeItem(prodCountDraftKey()); Notifs.success('Form cleared'); renderCountForm(el,currentRole,kindFilter);
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
    renderCountForm(el, currentRole, kindFilter);
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
