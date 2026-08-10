/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Extended Modules v1
   modules.js — shared cross-file helpers (escHtml, safeHttpUrl,
                PRESIDENT_UID, isRealPresident) + Inventory.

   As of Wave 7 Pass 7 (2026-08-03) the People screens this file used
   to hold (Posts, Team, Attendance, Cash Advance UI, Company Overview,
   Leave, Global Search, Files Hub, My Profile) moved verbatim to
   js/screens/people.js — see that file's header. What's left here is
   (a) helpers ~120+ call sites across every other JS file depend on by
   bare-global name, which MUST stay put, and (b) Inventory, which
   physically lived in the middle of the moved range but isn't a people
   screen (see the note where it starts, below, for why it didn't move
   either).
═══════════════════════════════════════════════════ */
'use strict';

// ── HTML escape — prevents XSS when inserting user content into innerHTML ──
function escHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── URL allow-list — only return http(s) URLs, else '' ──
// Blocks javascript:, data:, and other breakout vectors before a user-supplied
// URL is used as a src/href or opened in a new tab.
function safeHttpUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(String(url), window.location.origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
  } catch { return ''; }
}

// ── PRESIDENT UID (Neil Barro) ────────────────────
// This controls whose photo/name shows in the president
// message card in Company Overview.
const PRESIDENT_UID = 'neilbarro870@gmail.com'; // fallback: match by email

// Role-based president check — the role itself is the authority; an email match
// is no longer required (roles are assigned/enforced by Firestore rules).
function isRealPresident() {
  return currentRole === 'president';
}


// ══════════════════════════════════════════════════
//  PEOPLE SCREENS — moved verbatim to js/screens/people.js (Wave 7 Pass 7,
//  2026-08-03). Posts feed (renderPosts/loadPosts/openNewPostModal), Team
//  directory (renderTeamTab + End-of-Month standings), Attendance
//  (getPHHolidays/loadHolidayOverrides/renderAttendancePage/
//  renderHolidaysAdmin), Cash Advance UI (renderCashAdvancePage and friends
//  — the CashAdvance SERVICE stays in config.js), and Company Overview
//  (renderCompanyOverviewNew/renderPresidentMessageCard — later DELETED,
//  Wave 7 Pass 10 cleanup, see that file's header) all moved together.
//  See js/screens/people.js's header for the load-order contract and the
//  full contents list.
//
//  Inventory, directly below, deliberately did NOT move — see the note in
//  js/screens/people.js's header for why.
// ══════════════════════════════════════════════════
// ══════════════════════════════════════════════════
//  INVENTORY — raw materials, finished goods, stock log, job costing
// ══════════════════════════════════════════════════
(function(){
  const peso = n => '₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const num  = n => Number(n||0).toLocaleString('en-PH');
  const canEditInv = () => currentRole !== 'partner';
  const isFinAdmin = () => ['president','manager','finance'].includes(currentRole);

  window.renderInventory = async function(container, sub='Stock'){
    // container may be an element (embedded as a dept subtab) or omitted (full page).
    const c = (container && container.nodeType) ? container
            : (typeof container === 'string' ? document.getElementById(container)
            : document.getElementById('page-content'));
    const tabs = ['Stock','Movements'];
    if (isFinAdmin()) tabs.push('Job Costing');
    c.innerHTML = `
      <div class="page-header"><h2>${emojiIcon('📦',20)} Inventory</h2></div>
      ${window.chipTabs(tabs.map(s=>({key:s,label:s})), sub, {cls:'inv-tabs'})}
      <div id="inv-content">${window.skeletonHtml('rows')}</div>`;
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    loadInv(sub);
    window.bindChipTabs(c.querySelector('.inv-tabs'), (key)=>loadInv(key));
  };

  function loadInv(sub){
    const el = document.getElementById('inv-content');
    if (sub==='Movements')   return renderMovements(el);
    if (sub==='Job Costing') return renderJobs(el);
    return renderStock(el);
  }

  async function renderStock(el){
    el.innerHTML = window.skeletonHtml('table');
    const snap = await dbCachedGet('inventory_items', () => db.collection('inventory_items').get().catch(()=>({docs:[]})), 45000);
    const items = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
    const ce = canEditInv();
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
        <input id="inv-search" placeholder="🔎 Search item, supplier, category…" style="flex:1;min-width:160px;padding:8px 12px;border:1.5px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font-size:13px"/>
        <button class="btn-secondary btn-sm" id="inv-csv">${emojiIcon('⬇',16)} CSV</button>
        ${ce?'<button class="btn-primary btn-sm" id="inv-add-btn">＋ Add Item</button>':''}
      </div>
      <div class="card"><div class="card-body" style="padding:0"><div id="inv-table"></div></div></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [el] });

    const filtered = () => items.filter(i=>{
      if (kindFilter!=='all' && (i.kind||'material')!==kindFilter) return false;
      if (catFilter!=='all' && catOf(i)!==catFilter) return false;
      if (search){ const s=search.toLowerCase(); if(!((i.name||'').toLowerCase().includes(s)||(i.supplier||'').toLowerCase().includes(s)||(i.category||'').toLowerCase().includes(s))) return false; }
      return true;
    });

    const renderTable = () => {
      const shown = filtered();
      const shownValue = shown.reduce((s,i)=>s+((i.qty||0)*(i.unitCost||0)),0);
      const tbl = document.getElementById('inv-table');
      if (!tbl) return;
      tbl.innerHTML = !shown.length ? `<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon('📦',44)}</div><h4>No items match</h4></div>` :
        `<div class="table-wrap"><table class="data-table table-cards">
          <thead><tr><th>Item</th><th>Type</th><th>On Hand</th><th>Reorder</th><th>Unit Cost</th><th>Value</th><th>Supplier</th><th></th></tr></thead>
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
              <td class="tc-actions" style="white-space:nowrap">
                <button class="btn-secondary btn-sm inv-hist-btn" data-id="${i.id}" title="Movement history">${emojiIcon('📜',16)}</button>
                ${ce?`<button class="btn-success btn-sm inv-in-btn" data-id="${i.id}" title="Stock In">＋</button>
                <button class="btn-secondary btn-sm inv-out-btn" data-id="${i.id}" title="Stock Out">−</button>
                <button class="btn-secondary btn-sm inv-edit-btn" data-id="${i.id}" title="Edit">${emojiIcon('✎',16)}</button>`:''}
              </td>
            </tr>`;}).join('')}</tbody>
          <tfoot><tr><td colspan="5" style="text-align:right;font-weight:700;color:var(--text-muted)">Shown value</td><td style="font-weight:700">${peso(shownValue)}</td><td colspan="2"></td></tr></tfoot>
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
      {key:'unitCost',label:'Unit Cost',get:i=>i.unitCost||0},{key:'value',label:'Stock Value',get:i=>(i.qty||0)*(i.unitCost||0)},{key:'supplier',label:'Supplier'}]));
    if(ce) document.getElementById('inv-add-btn')?.addEventListener('click',()=>itemModal(null,()=>renderStock(el)));
    renderTable();
  }

  // Per-item movement history — equality query (no composite index), sorted client-side.
  async function itemHistoryModal(item){
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

  function itemModal(item, onSaved){
    const e=item||{};
    const _panel = openPage(item?'Edit Item':'Add Inventory Item', `
      <div class="form-group"><label>Name</label><input id="iv-name" value="${escHtml(e.name||'')}" placeholder="e.g. Stainless Sheet 4x8 ga.16"/></div>
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
      <div id="iv-err" class="error-msg hidden"></div>
    `, `<button class="btn-primary" id="iv-save">Save</button>${item?'<button class="btn-danger" id="iv-del">Delete</button>':''}<button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    // ⚠ SCOPED TO THIS PANEL, NOT document.
    // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second record
    // inside that window and two panels carry the same ids at once —
    // document.getElementById() returns the FIRST in document order, which is
    // the DYING one, so the handler binds to a button nobody can see and the
    // visible button does nothing — and a save that runs in that window reads
    // the PREVIOUS record's field values and writes them onto this one.
    // (Corporate Secretary report, reproduced in-browser 2026-08-10.)
    const $iv = (id) => _panel.querySelector('#' + id);
    $iv('iv-save').addEventListener('click', async ()=>{
      const name=$iv('iv-name').value.trim();
      const err=$iv('iv-err');
      if(!name){ err.textContent='Name is required.'; err.classList.remove('hidden'); return; }
      const data={ name, kind:$iv('iv-kind').value,
        unit:$iv('iv-unit').value.trim(), category:$iv('iv-cat').value.trim(),
        qty:parseFloat($iv('iv-qty').value)||0, reorderLevel:parseFloat($iv('iv-reorder').value)||0,
        unitCost:parseFloat($iv('iv-cost').value)||0,
        supplier:$iv('iv-supplier').value.trim(), supplierContact:$iv('iv-supcontact').value.trim(),
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

  function moveModal(item, type, onSaved){
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

  async function renderMovements(el){
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

  async function renderJobs(el){
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

  function jobModal(job, onSaved){
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
})();

// ══════════════════════════════════════════════════
//  LEAVE MANAGEMENT, GLOBAL SEARCH, FILES HUB, MY PROFILE — moved verbatim
//  to js/screens/people.js (Wave 7 Pass 7, 2026-08-03). See that file's
//  header for the load-order contract and the full contents list.
// ══════════════════════════════════════════════════
