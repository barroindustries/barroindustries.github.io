/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Government Biddings + IT screens
   js/screens/govit.js

   Wave 7 Pass 5 — split out of js/app.js (Gov Biddings) and
   js/departments.js (IT) verbatim, 2026-08-03, following the Wave 2
   (design.js) / Wave 7 Pass 1-4 extraction protocol. Still plain
   `window.*`-attached globals, no ESM, no bundler — this file is a
   physical split only, not a module.

   Contents:
   - Government Biddings: window.GOV_BUCKETS (the ONE canonical
     PhilGEPS/Active Bids/Archive bucket definition — see "Dedupe"
     below) and renderGovBiddings (was a bare `function` in app.js,
     called bare at its one call site — js/app.js's navigateTo switch,
     'Government Biddings' case — unaffected by the move since plain
     top-level function declarations in a classic <script> resolve as
     globals regardless of which file defines them, same as every other
     bare-global forward-reference this wave's passes document).
   - IT Department: window.renderIT (Overview/IT Tickets/Assets/
     Software/Access Control/Network/Tasks subtabs), loadITContent
     (the subtab content dispatcher), openITTicketModal.

   Dedupe (Wave 7 Pass 5's one required fix): the gov bucket list used
   to be declared TWICE — once as a chipTabs literal + a
   `gov_${sub.toLowerCase()...}` string-derivation in app.js's
   renderGovBiddings, and again as a hardcoded `GOV_BUCKETS` const
   inside js/departments.js's window.renderDocCollection (needed there
   for the bucket-move <select> in openGovBidDetail). Both produced the
   identical 3-entry mapping (PhilGEPS→gov_philgeps, Active Bids→
   gov_active_bids, Archive→gov_archive) — confirmed by diff before
   touching either. Now there is ONE definition, `window.GOV_BUCKETS`
   below; renderGovBiddings consumes it directly (chipTabs list +
   collection lookup), and departments.js's renderDocCollection reads it
   as `const GOV_BUCKETS = window.GOV_BUCKETS;` instead of re-declaring
   the array. Effective bucket list is byte-identical before/after (see
   pass report for the before/after diff).

   Wave 7 Pass 5 conversion (8-point treatment):
   1. chipTabs — both screens already used window.chipTabs()/
      bindChipTabs() (Gov's `.gov-tabs`, IT's un-classed default) with
      no hand-rolled .subtab-bar found in either. Verified, unchanged.
   2. Surfaces — both already 100% openPage (IT ticket/asset/software/
      access/network modals, Gov's Add-Doc/bid-detail modals in
      departments.js); no raw #page-content swaps or stray modal flows
      found in the moved code. Verified, unchanged.
   3. Loading/empty/error — IT's per-subtab Firestore reads (Overview's
      2-query Promise.all, IT Tickets, Assets, Software, Access Control,
      Network) all previously swallowed failures into "0 rows" via a
      blanket `.catch(()=>({docs:[]}))`, so a real permission error
      rendered identically to an empty subtab (the exact anti-pattern
      production.js's header already flagged and fixed for Production/
      Purchasing/Projects). All six now try/await the read and render a
      "Couldn't load — Retry" block (same markup/idiom as production.js)
      on failure, with Retry re-invoking loadITContent for that subtab.
      Two hand-rolled empty-states that matched window.renderEmptyState()'s
      exact icon+h4 shape were switched to the helper: IT Tickets' "No
      tickets" and Network's "No network notes yet". Overview's "No open
      tickets" mini empty-state (icon+p, no h4, tighter inline padding —
      a decorative fragment inside the "Recent Open Tickets" card, not
      the subtab's primary empty state) does NOT match that shape, so
      per the same rule production.js's header documents it was left
      as-is. Gov Biddings already had loading (skeletonHtml via
      renderDocCollection) and empty/error states; unchanged.
   4. Tables — IT's Assets/Software/Access Control tables already carry
      `.table-cards` (Wave 6-B2 mobile card-reflow) — verified intact
      post-move, no regression.
   5. Icons — Lucide-only sinks confirmed (no emojiIcon() HTML leaking
      into Notifs.showToast text sinks in either screen). Two icon-only
      buttons were missing aria-labels: Assets' and Software's per-row
      pencil edit buttons (`edit-asset-btn`/`edit-sw-btn`) — added
      aria-label="Edit asset" / "Edit software" respectively.
   6. Headers — one page header each (Gov Biddings, IT Department);
      verified, unchanged.
   7. Styling — two confident token swaps: the Overview "In Progress"
      ticket-count stat and Software's expiry-soon date both hardcoded
      `#FF9F0A` inline; swapped to `var(--warning,#FF9F0A)`, matching
      the fallback pattern already used elsewhere in departments.js
      (Finance Tools rollup banner, Approvals pending-count, budget
      progress bars). No forced sweep beyond these two.
   8. sopPanel — both already had one (contrary to the Wave 7 spec's
      "known gap" list, which flagged Design/IT/Purchasing/Sales
      top-level as gaps): IT's `window.sopPanel('How IT works', […])`
      and Gov's `window.sopPanel('How Government Biddings works', […])`
      were both already present pre-move. Verified, no action needed —
      the spec's IT gap appears to have been closed in an earlier pass;
      noting it here so it isn't mistaken for still-outstanding.

   DELIBERATELY LEFT IN departments.js (grepped for outside callers
   before this move; genuinely shared per the Wave 7 spec):
     - window.renderDocCollection — the shared doc-collection renderer.
       Used by Gov Biddings (this file's renderGovBiddings) AND by
       Marketing's marketing_templates/marketing_plans/
       marketing_proposals collections (js/departments.js's Marketing
       screen) — a genuinely cross-department shared renderer, exactly
       as this pass's brief specified. Its Gov-specific lifecycle
       (openGovBidDetail: view/edit/status/move-bucket/delete) stays
       inside it, now reading the bucket list from window.GOV_BUCKETS
       (see "Dedupe" above) instead of a private copy.
     - canEditDept, deptContainer, dbCachedGet/dbCacheInvalidate,
       statusBadgeClass/statusLabel2, confirmDialog, openPage/closeModal,
       Notifs, Drive, db, today() — generic app-wide helpers untouched,
       called as window.* / bare-global at runtime like every other pass.

   ═══════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════
//  GOVERNMENT BIDDINGS
// ══════════════════════════════════════════════════
window.GOV_BUCKETS = [
  { key: 'PhilGEPS',    label: 'PhilGEPS',    collection: 'gov_philgeps' },
  { key: 'Active Bids', label: 'Active Bids', collection: 'gov_active_bids' },
  { key: 'Archive',     label: 'Archive',     collection: 'gov_archive' },
];

function renderGovBiddings() {
  const c = document.getElementById('page-content');
  c.innerHTML = `
    <div class="page-header"><h2>${emojiIcon('🏛️',20)} Government Biddings</h2></div>
    ${window.sopPanel('How Government Biddings works', [
      'PhilGEPS holds the posted opportunities you are tracking.',
      'Move a live one to Active Bids while you prepare and submit the documents.',
      'Won or closed bids move to Archive for the record.'
    ])}
    ${window.chipTabs(window.GOV_BUCKETS.map(b=>({key:b.label,label:b.label})), 'PhilGEPS', {cls:'gov-tabs'})}
    <div id="gov-content"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  const loadGov = sub => renderDocCollection(document.getElementById('gov-content'), window.GOV_BUCKETS.find(b=>b.label===sub).collection, sub, currentUser, currentRole, {icon:'🏛️', dept:'Government Biddings'});
  loadGov('PhilGEPS');
  window.bindChipTabs(c.querySelector('.gov-tabs'), (key)=>loadGov(key));
}

// ══════════════════════════════════════════════════
//  IT DEPARTMENT
// ══════════════════════════════════════════════════
window.renderIT = async function(currentUser, currentRole, subtab = 'Overview') {
  const c = deptContainer();
  const canEdit = canEditDept('IT');
  // it_access / it_network are admin-read-only (Firestore rules). Hide those
  // subtabs from non-admins so they don't see a misleadingly-empty table for
  // records they simply aren't permitted to read.
  const itAdmin = currentRole === 'president' || currentRole === 'manager';
  const subtabs = itAdmin
    ? ['Overview','IT Tickets','Assets','Software','Access Control','Network','Tasks']
    : ['Overview','IT Tickets','Assets','Software','Tasks'];
  if (!itAdmin && (subtab === 'Access Control' || subtab === 'Network')) subtab = 'Overview';
  c.innerHTML = `
    <div class="page-header"><h2>${emojiIcon('💻',20)} IT Department</h2></div>
    ${window.sopPanel('How IT works', [
      'Staff raise issues in IT Tickets; IT works them to resolution.',
      'Assets and Software track company hardware and licences.',
      'Access Control and Network hold credentials/config — admin-only.'
    ])}
    ${window.chipTabs(subtabs.map(s=>({key:s,label:s})), subtab)}
    <div id="it-content">${window.skeletonHtml('rows')}</div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  loadITContent(currentUser, currentRole, subtab, canEdit);
  window.bindChipTabs(c, (key) => loadITContent(currentUser, currentRole, key, canEdit));
};

async function loadITContent(currentUser, currentRole, sub, canEdit) {
  const content = document.getElementById('it-content');
  if (!content) return;

  // ── Overview ──────────────────────────────────────
  if (sub === 'Overview') {
    // v14 Wave 7 Pass 5 — real errors used to render identically to "0 tickets/
    // assets" via a blanket .catch(()=>({docs:[]})). Surface a retry block instead.
    let tickets, assets;
    try {
      const [ticketsSnap, assetsSnap] = await Promise.all([
        db.collection('it_tickets').get(),
        db.collection('it_assets').get()
      ]);
      tickets  = ticketsSnap.docs.map(d=>({id:d.id,...d.data()}));
      assets   = assetsSnap.docs.map(d=>({id:d.id,...d.data()}));
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load</h4><p>${escHtml(err.message||String(err))}</p><button type="button" class="btn-secondary btn-sm it-retry-btn" style="margin-top:14px">Retry</button></div>`;
      if (window.lucide) lucide.createIcons({ nodes: [content] });
      content.querySelector('.it-retry-btn')?.addEventListener('click', ()=>loadITContent(currentUser, currentRole, sub, canEdit));
      return;
    }
    const openT    = tickets.filter(t=>t.status==='open').length;
    const inProgT  = tickets.filter(t=>t.status==='in-progress').length;
    const totalA   = assets.length;
    const activeA  = assets.filter(a=>a.status==='active').length;
    content.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:20px">
        <div class="card" style="text-align:center;padding:16px">
          <div style="font-size:28px;margin-bottom:4px">${emojiIcon('🎫',28)}</div>
          <div style="font-size:22px;font-weight:700;color:var(--accent)">${openT}</div>
          <div style="font-size:12px;color:var(--text-muted)">Open Tickets</div>
        </div>
        <div class="card" style="text-align:center;padding:16px">
          <div style="font-size:28px;margin-bottom:4px">${emojiIcon('⏳',28)}</div>
          <div style="font-size:22px;font-weight:700;color:var(--warning,#FF9F0A)">${inProgT}</div>
          <div style="font-size:12px;color:var(--text-muted)">In Progress</div>
        </div>
        <div class="card" style="text-align:center;padding:16px">
          <div style="font-size:28px;margin-bottom:4px">${emojiIcon('🖥️',28)}</div>
          <div style="font-size:22px;font-weight:700;color:var(--text)">${totalA}</div>
          <div style="font-size:12px;color:var(--text-muted)">Total Assets</div>
        </div>
        <div class="card" style="text-align:center;padding:16px">
          <div style="font-size:28px;margin-bottom:4px">${emojiIcon('✅',28)}</div>
          <div style="font-size:22px;font-weight:700;color:var(--success)">${activeA}</div>
          <div style="font-size:12px;color:var(--text-muted)">Active Assets</div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Recent Open Tickets</h3></div>
        <div class="item-list" style="padding:8px 12px 12px">
          ${tickets.filter(t=>t.status==='open').slice(0,5).map(t=>`
            <div class="item-card">
              <div class="item-top">
                <div class="item-title">${escHtml(t.title||'Untitled')}</div>
                <span class="badge ${t.priority==='high'?'badge-red':t.priority==='medium'?'badge-orange':'badge-gray'}">${t.priority||'low'}</span>
              </div>
              <div class="item-meta">
                <span>${escHtml(t.category||'General')}</span>
                ${t.requestedBy?`<span>${emojiIcon('👤',16)} ${escHtml(t.requestedBy)}</span>`:''}
                ${t.createdAt?`<span>${new Date(t.createdAt.toDate()).toLocaleDateString('en-PH',{month:'short',day:'numeric'})}</span>`:''}
              </div>
            </div>`).join('') || `<div class="empty-state" style="padding:16px"><div class="empty-icon">${emojiIcon('✅',44)}</div><p>No open tickets</p></div>`}
        </div>
      </div>`;
    if (window.lucide) lucide.createIcons({ nodes: [content] });
    return;
  }

  // ── IT Tickets ────────────────────────────────────
  if (sub === 'IT Tickets') {
    let tickets;
    try {
      const snap = await db.collection('it_tickets').orderBy('createdAt','desc').get();
      tickets = snap.docs.map(d=>({id:d.id,...d.data()}));
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load</h4><p>${escHtml(err.message||String(err))}</p><button type="button" class="btn-secondary btn-sm it-retry-btn" style="margin-top:14px">Retry</button></div>`;
      if (window.lucide) lucide.createIcons({ nodes: [content] });
      content.querySelector('.it-retry-btn')?.addEventListener('click', ()=>loadITContent(currentUser, currentRole, sub, canEdit));
      return;
    }
    content.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <select id="it-ticket-filter" class="select-sm">
          <option value="all">All Tickets</option>
          <option value="open">Open</option>
          <option value="in-progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <button class="btn-primary btn-sm" id="new-it-ticket-btn">+ New Ticket</button>
      </div>
      <div id="it-ticket-list" class="item-list"></div>`;
    function renderTickets(filter) {
      const list = document.getElementById('it-ticket-list');
      const shown = filter==='all' ? tickets : tickets.filter(t=>t.status===filter);
      if (!shown.length) { list.innerHTML=window.renderEmptyState({icon:'🎫',title:'No tickets'}); if (window.lucide) lucide.createIcons({ nodes: [list] }); return; }
      if (window.lucide) lucide.createIcons({ nodes: [list] });
      list.innerHTML = shown.map(t=>`
        <div class="item-card it-ticket-card" data-id="${t.id}" style="cursor:pointer">
          <div class="item-top">
            <div class="item-title">${escHtml(t.title||'Untitled')}</div>
            <span class="badge ${window.statusBadgeClass('it_ticket', t.status||'open')}">${window.statusLabel2('it_ticket', t.status||'open')}</span>
          </div>
          <div class="item-meta">
            <span class="badge badge-blue" style="font-size:10px">${escHtml(t.category||'General')}</span>
            <span class="badge ${t.priority==='high'?'badge-red':t.priority==='medium'?'badge-orange':'badge-gray'}" style="font-size:10px">${t.priority||'low'} priority</span>
            ${t.requestedBy?`<span>${emojiIcon('👤',16)} ${escHtml(t.requestedBy)}</span>`:''}
            ${t.assignedTo?`<span>${emojiIcon('🔧',16)} ${escHtml(t.assignedTo)}</span>`:''}
          </div>
        </div>`).join('');
      if (window.lucide) lucide.createIcons({ nodes: [list] });
      list.querySelectorAll('.it-ticket-card').forEach(card => {
        card.addEventListener('click', () => {
          const t = tickets.find(x=>x.id===card.dataset.id);
          if (t) openITTicketModal(t, currentUser, canEdit, ()=>loadITContent(currentUser, currentRole, 'IT Tickets', canEdit));
        });
      });
    }
    renderTickets('all');
    document.getElementById('it-ticket-filter').onchange = e => renderTickets(e.target.value);
    document.getElementById('new-it-ticket-btn')?.addEventListener('click', () => {
      openPage('New IT Ticket', `
        <div class="form-group"><label>Title</label><input id="it-t-title" placeholder="Brief description of issue"/></div>
        <div class="form-row">
          <div class="form-group"><label>Category</label>
            <select id="it-t-cat"><option>Hardware</option><option>Software</option><option>Network</option><option>Access / Accounts</option><option>Printer</option><option>Other</option></select>
          </div>
          <div class="form-group"><label>Priority</label>
            <select id="it-t-pri"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
          </div>
        </div>
        <div class="form-group"><label>Description</label><textarea id="it-t-desc" rows="4" placeholder="What's happening? Include any error messages."></textarea></div>
        <div class="form-group"><label>Requested By</label><input id="it-t-req" value="${escHtml(currentUser.displayName||'')}"/></div>
      `, `<button class="btn-primary" id="save-it-ticket-btn">Submit Ticket</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('save-it-ticket-btn').addEventListener('click', async () => {
        const title = document.getElementById('it-t-title').value.trim();
        if (!title) { Notifs.showToast('Please enter a title.','error'); return; }
        await db.collection('it_tickets').add({
          title, category: document.getElementById('it-t-cat').value,
          priority: document.getElementById('it-t-pri').value,
          description: document.getElementById('it-t-desc').value.trim(),
          requestedBy: document.getElementById('it-t-req').value.trim(),
          status: 'open', createdBy: currentUser.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        closeModal(); loadITContent(currentUser, currentRole, 'IT Tickets', canEdit);
      });
    });
    return;
  }

  // ── Assets ────────────────────────────────────────
  if (sub === 'Assets') {
    let assets;
    try {
      const snap = await db.collection('it_assets').orderBy('createdAt','desc').get();
      assets = snap.docs.map(d=>({id:d.id,...d.data()}));
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load</h4><p>${escHtml(err.message||String(err))}</p><button type="button" class="btn-secondary btn-sm it-retry-btn" style="margin-top:14px">Retry</button></div>`;
      if (window.lucide) lucide.createIcons({ nodes: [content] });
      content.querySelector('.it-retry-btn')?.addEventListener('click', ()=>loadITContent(currentUser, currentRole, sub, canEdit));
      return;
    }
    // v14 Wave 6 B2 — card reflow (≤700px, shared .table-cards CSS pattern).
    // Same <tr>/<td> markup at every width; tc-avatar=Type, tc-name=Name,
    // tc-net=Status stay visible on phone, the rest is the tap-to-expand
    // breakdown. colspan/column COUNT must still match <thead> 1:1 (desktop
    // is a plain table — the tc-* class just decides mobile layout).
    const assetRowHtml = a => `<tr class="asset-row">
              <td class="tc-avatar" style="font-size:11px;color:var(--text-muted)">${escHtml(a.type||'—')}</td>
              <td class="tc-name">${escHtml(a.name||'—')} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
              <td class="tc-detail" data-label="Serial / ID"><code style="font-size:11px">${escHtml(a.serial||'—')}</code></td>
              <td class="tc-detail" data-label="Assigned To">${escHtml(a.assignedTo||'—')}</td>
              <td class="tc-net"><span class="badge ${window.statusBadgeClass('it_asset', a.status||'active')}">${window.statusLabel2('it_asset', a.status||'active')}</span></td>
              <td class="tc-detail" data-label="Purchased">${a.purchasedDate||'—'}</td>
              ${canEdit?`<td class="tc-actions"><button class="btn-icon edit-asset-btn" data-id="${a.id}" aria-label="Edit asset"><i data-lucide="pencil" style="width:14px;height:14px"></i></button></td>`:''}
            </tr>`;
    const bindAssetRowToggle = (scopeEl) => scopeEl.querySelectorAll('tr.asset-row').forEach(tr => tr.addEventListener('click', (ev) => {
      if (ev.target.closest('button, a')) return;
      tr.classList.toggle('tc-expanded');
    }));
    content.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <select id="it-asset-filter" class="select-sm">
          <option value="all">All Assets</option>
          <option value="active">Active</option>
          <option value="maintenance">In Maintenance</option>
          <option value="retired">Retired</option>
        </select>
        ${canEdit?`<button class="btn-primary btn-sm" id="new-asset-btn">+ Add Asset</button>`:''}
      </div>
      <div class="card"><div class="table-wrap"><table class="data-table table-cards">
        <thead><tr><th>Name</th><th>Type</th><th>Serial / ID</th><th>Assigned To</th><th>Status</th><th>Purchased</th>${canEdit?'<th></th>':''}</tr></thead>
        <tbody id="it-asset-tbody">
          ${!assets.length?`<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px">No assets recorded</td></tr>`
            :assets.map(assetRowHtml).join('')}
        </tbody>
      </table></div></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [content] });
    bindAssetRowToggle(content);
    if (canEdit) {
      document.getElementById('new-asset-btn')?.addEventListener('click', () => {
        openPage('Add Asset', `
          <div class="form-row">
            <div class="form-group"><label>Asset Name</label><input id="a-name" placeholder="e.g. Dell Laptop 01"/></div>
            <div class="form-group"><label>Type</label>
              <select id="a-type"><option>Laptop</option><option>Desktop</option><option>Monitor</option><option>Printer</option><option>Network Device</option><option>Phone</option><option>Tablet</option><option>Server</option><option>Other</option></select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Serial / Asset ID</label><input id="a-serial" placeholder="SN-XXXXX"/></div>
            <div class="form-group"><label>Assigned To</label><input id="a-assigned" placeholder="Employee name"/></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Purchase Date</label><input id="a-date" type="date"/></div>
            <div class="form-group"><label>Status</label>
              <select id="a-status"><option value="active">Active</option><option value="maintenance">In Maintenance</option><option value="retired">Retired</option></select>
            </div>
          </div>
          <div class="form-group"><label>Notes</label><textarea id="a-notes" rows="2"></textarea></div>
        `, `<button class="btn-primary" id="save-asset-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
        document.getElementById('save-asset-btn').addEventListener('click', async () => {
          await db.collection('it_assets').add({
            name: document.getElementById('a-name').value.trim(),
            type: document.getElementById('a-type').value,
            serial: document.getElementById('a-serial').value.trim(),
            assignedTo: document.getElementById('a-assigned').value.trim(),
            purchasedDate: document.getElementById('a-date').value,
            status: document.getElementById('a-status').value,
            notes: document.getElementById('a-notes').value.trim(),
            createdBy: currentUser.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          closeModal(); loadITContent(currentUser, currentRole, 'Assets', canEdit);
        });
      });
      const bindAssetEditBtns = (scopeEl) => scopeEl.querySelectorAll('.edit-asset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const asset = assets.find(a=>a.id===btn.dataset.id);
          if (!asset) return;
          openPage('Edit Asset', `
            <div class="form-row">
              <div class="form-group"><label>Asset Name</label><input id="ea-name" value="${escHtml(asset.name||'')}"/></div>
              <div class="form-group"><label>Assigned To</label><input id="ea-assigned" value="${escHtml(asset.assignedTo||'')}"/></div>
            </div>
            <div class="form-group"><label>Status</label>
              <select id="ea-status">
                <option value="active" ${asset.status==='active'?'selected':''}>Active</option>
                <option value="maintenance" ${asset.status==='maintenance'?'selected':''}>In Maintenance</option>
                <option value="retired" ${asset.status==='retired'?'selected':''}>Retired</option>
              </select>
            </div>
            <div class="form-group"><label>Notes</label><textarea id="ea-notes" rows="2">${escHtml(asset.notes||'')}</textarea></div>
          `, `<button class="btn-primary" id="upd-asset-btn">Update</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
          document.getElementById('upd-asset-btn').addEventListener('click', async () => {
            await db.collection('it_assets').doc(asset.id).update({
              name: document.getElementById('ea-name').value.trim(),
              assignedTo: document.getElementById('ea-assigned').value.trim(),
              status: document.getElementById('ea-status').value,
              notes: document.getElementById('ea-notes').value.trim(),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            closeModal(); loadITContent(currentUser, currentRole, 'Assets', canEdit);
          });
        });
      });
      bindAssetEditBtns(content);
      if (window.lucide) lucide.createIcons({ nodes: [content] });
      document.getElementById('it-asset-filter').addEventListener('change', e => {
        const fv = e.target.value;
        const filtered = fv==='all' ? assets : assets.filter(a => (a.status||'active')===fv);
        const tbody = document.getElementById('it-asset-tbody');
        if (!tbody) return;
        tbody.innerHTML = !filtered.length ? `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px">No assets recorded</td></tr>`
          : filtered.map(assetRowHtml).join('');
        if (window.lucide) lucide.createIcons({ nodes: [tbody] });
        bindAssetRowToggle(tbody);
        bindAssetEditBtns(tbody);
      });
    } else {
      document.getElementById('it-asset-filter').addEventListener('change', e => {
        const fv = e.target.value;
        const filtered = fv==='all' ? assets : assets.filter(a => (a.status||'active')===fv);
        const tbody = document.getElementById('it-asset-tbody');
        if (!tbody) return;
        tbody.innerHTML = !filtered.length ? `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px">No assets recorded</td></tr>`
          : filtered.map(assetRowHtml).join('');
        if (window.lucide) lucide.createIcons({ nodes: [tbody] });
        bindAssetRowToggle(tbody);
      });
    }
    return;
  }

  // ── Software ──────────────────────────────────────
  if (sub === 'Software') {
    let items;
    try {
      const snap = await db.collection('it_software').orderBy('name','asc').get();
      items = snap.docs.map(d=>({id:d.id,...d.data()}));
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load</h4><p>${escHtml(err.message||String(err))}</p><button type="button" class="btn-secondary btn-sm it-retry-btn" style="margin-top:14px">Retry</button></div>`;
      if (window.lucide) lucide.createIcons({ nodes: [content] });
      content.querySelector('.it-retry-btn')?.addEventListener('click', ()=>loadITContent(currentUser, currentRole, sub, canEdit));
      return;
    }
    content.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
        ${canEdit?`<button class="btn-primary btn-sm" id="new-sw-btn">+ Add Software</button>`:''}
      </div>
      <div class="card"><div class="table-wrap"><table class="data-table table-cards">
        <thead><tr><th>Software</th><th>Vendor</th><th>License Type</th><th>License Key / ID</th><th>Seats</th><th>Expiry</th><th>Status</th>${canEdit?'<th></th>':''}</tr></thead>
        <tbody>
          ${!items.length?`<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:20px">No software records</td></tr>`
            :items.map(s=>{
              // Compare date strings against today() (Manila-anchored) instead of raw
              // new Date() math, which drifts a day when the device TZ isn't Manila
              // (v13 Phase 17).
              const _in30 = new Date(today() + 'T12:00:00Z'); _in30.setUTCDate(_in30.getUTCDate() + 30);
              const isExp  = !!s.expiryDate && s.expiryDate < today();
              const isSoon = !!s.expiryDate && !isExp && s.expiryDate <= _in30.toISOString().slice(0,10);
              // v14 Wave 6 B2 — card reflow: avatar=Vendor, name=Software, net=Expiry
              // (the field worth surfacing at a glance); rest is tap-to-expand detail.
              return `<tr class="sw-row">
                <td class="tc-avatar" style="font-size:11px;color:var(--text-muted)">${escHtml(s.vendor||'—')}</td>
                <td class="tc-name">${escHtml(s.name||'—')} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
                <td class="tc-detail" data-label="License Type">${escHtml(s.licenseType||'—')}</td>
                <td class="tc-detail" data-label="License Key / ID"><code style="font-size:10px">${escHtml(s.licenseKey||'—')}</code></td>
                <td class="tc-detail" data-label="Seats">${s.seats||'—'}</td>
                <td class="tc-net" style="color:${isExp?'var(--danger)':isSoon?'var(--warning,#FF9F0A)':'inherit'}">${s.expiryDate||'—'}${isExp?` ${emojiIcon('⚠️',16)}`:isSoon?` ${emojiIcon('🔔',16)}`:''}</td>
                <td class="tc-detail" data-label="Status"><span class="badge ${window.statusBadgeClass('it_software', s.status||'active')}">${window.statusLabel2('it_software', s.status||'active')}</span></td>
                ${canEdit?`<td class="tc-actions"><button class="btn-icon edit-sw-btn" data-id="${s.id}" aria-label="Edit software"><i data-lucide="pencil" style="width:14px;height:14px"></i></button></td>`:''}
              </tr>`;
            }).join('')}
        </tbody>
      </table></div></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [content] });
    content.querySelectorAll('tr.sw-row').forEach(tr => tr.addEventListener('click', (ev) => {
      if (ev.target.closest('button, a')) return;
      tr.classList.toggle('tc-expanded');
    }));
    document.getElementById('new-sw-btn')?.addEventListener('click', () => {
      openPage('Add Software / License', `
        <div class="form-row">
          <div class="form-group"><label>Software Name</label><input id="sw-name" placeholder="e.g. Adobe Creative Cloud"/></div>
          <div class="form-group"><label>Vendor</label><input id="sw-vendor" placeholder="e.g. Adobe"/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>License Type</label>
            <select id="sw-ltype"><option>Subscription</option><option>Perpetual</option><option>Open Source</option><option>Trial</option><option>Volume</option></select>
          </div>
          <div class="form-group"><label>Seats / Users</label><input id="sw-seats" type="number" inputmode="numeric" placeholder="1"/></div>
        </div>
        <div class="form-group"><label>License Key / ID</label><input id="sw-key" placeholder="XXXX-XXXX-XXXX"/></div>
        <div class="form-row">
          <div class="form-group"><label>Purchase Date</label><input id="sw-bought" type="date"/></div>
          <div class="form-group"><label>Expiry Date</label><input id="sw-exp" type="date"/></div>
        </div>
        <div class="form-group"><label>Notes</label><textarea id="sw-notes" rows="2"></textarea></div>
      `, `<button class="btn-primary" id="save-sw-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('save-sw-btn').addEventListener('click', async () => {
        const name = document.getElementById('sw-name').value.trim();
        if (!name) { Notifs.showToast('Enter a name.','error'); return; }
        await db.collection('it_software').add({
          name, vendor: document.getElementById('sw-vendor').value.trim(),
          licenseType: document.getElementById('sw-ltype').value,
          seats: parseInt(document.getElementById('sw-seats').value)||1,
          licenseKey: document.getElementById('sw-key').value.trim(),
          purchasedDate: document.getElementById('sw-bought').value,
          expiryDate: document.getElementById('sw-exp').value,
          notes: document.getElementById('sw-notes').value.trim(),
          status: 'active', createdBy: currentUser.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        closeModal(); loadITContent(currentUser, currentRole, 'Software', canEdit);
      });
    });
    content.querySelectorAll('.edit-sw-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sw = items.find(x=>x.id===btn.dataset.id);
        if (!sw) return;
        openPage('Edit Software / License', `
          <div class="form-row">
            <div class="form-group"><label>Software Name</label><input id="esw-name" value="${escHtml(sw.name||'')}"/></div>
            <div class="form-group"><label>Vendor</label><input id="esw-vendor" value="${escHtml(sw.vendor||'')}"/></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>License Type</label>
              <select id="esw-ltype">
                ${['Subscription','Perpetual','Open Source','Trial','Volume'].map(t=>`<option ${sw.licenseType===t?'selected':''}>${t}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Seats / Users</label><input id="esw-seats" type="number" inputmode="numeric" value="${sw.seats||1}"/></div>
          </div>
          <div class="form-group"><label>License Key / ID</label><input id="esw-key" value="${escHtml(sw.licenseKey||'')}"/></div>
          <div class="form-row">
            <div class="form-group"><label>Purchase Date</label><input id="esw-bought" type="date" value="${escHtml(sw.purchasedDate||'')}"/></div>
            <div class="form-group"><label>Expiry Date</label><input id="esw-exp" type="date" value="${escHtml(sw.expiryDate||'')}"/></div>
          </div>
          <div class="form-group"><label>Status</label>
            <select id="esw-status">
              <option value="active" ${sw.status==='active'?'selected':''}>Active</option>
              <option value="expired" ${sw.status==='expired'?'selected':''}>Expired</option>
              <option value="retired" ${sw.status==='retired'?'selected':''}>Retired</option>
            </select>
          </div>
          <div class="form-group"><label>Notes</label><textarea id="esw-notes" rows="2">${escHtml(sw.notes||'')}</textarea></div>
        `, `<button class="btn-primary" id="upd-sw-btn">Update</button><button class="btn-danger" id="del-sw-btn">Delete</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
        document.getElementById('upd-sw-btn').addEventListener('click', async () => {
          const name = document.getElementById('esw-name').value.trim();
          if (!name) { Notifs.showToast('Enter a name.','error'); return; }
          await db.collection('it_software').doc(sw.id).update({
            name, vendor: document.getElementById('esw-vendor').value.trim(),
            licenseType: document.getElementById('esw-ltype').value,
            seats: parseInt(document.getElementById('esw-seats').value)||1,
            licenseKey: document.getElementById('esw-key').value.trim(),
            purchasedDate: document.getElementById('esw-bought').value,
            expiryDate: document.getElementById('esw-exp').value,
            status: document.getElementById('esw-status').value,
            notes: document.getElementById('esw-notes').value.trim(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: currentUser.uid
          });
          closeModal(); loadITContent(currentUser, currentRole, 'Software', canEdit);
        });
        document.getElementById('del-sw-btn').addEventListener('click', async () => {
          if (!(await confirmDialog({message:`Delete software record "${escHtml(sw.name||'')}"? This cannot be undone.`, danger:true, html:true}))) return;
          await db.collection('it_software').doc(sw.id).delete();
          closeModal(); loadITContent(currentUser, currentRole, 'Software', canEdit);
        });
      });
    });
    if (window.lucide) lucide.createIcons({ nodes: [content] });
    return;
  }

  // ── Access Control ────────────────────────────────
  if (sub === 'Access Control') {
    let records;
    try {
      const snap = await db.collection('it_access').orderBy('createdAt','desc').get();
      records = snap.docs.map(d=>({id:d.id,...d.data()}));
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load</h4><p>${escHtml(err.message||String(err))}</p><button type="button" class="btn-secondary btn-sm it-retry-btn" style="margin-top:14px">Retry</button></div>`;
      if (window.lucide) lucide.createIcons({ nodes: [content] });
      content.querySelector('.it-retry-btn')?.addEventListener('click', ()=>loadITContent(currentUser, currentRole, sub, canEdit));
      return;
    }
    content.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
        ${canEdit?`<button class="btn-primary btn-sm" id="new-access-btn">+ Add Record</button>`:''}
      </div>
      <div class="card"><div class="table-wrap"><table class="data-table table-cards">
        <thead><tr><th>Employee</th><th>System / App</th><th>Access Level</th><th>Status</th><th>Granted By</th><th>Date</th>${canEdit?'<th></th>':''}</tr></thead>
        <tbody>
          ${!records.length?`<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px">No access records</td></tr>`
            :records.map(r=>`<tr class="access-row">
              <td class="tc-name">${escHtml(r.employee||'—')} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
              <td class="tc-avatar" style="font-size:11px;color:var(--text-muted)">${escHtml(r.system||'—')}</td>
              <td class="tc-detail" data-label="Access Level"><span class="badge badge-blue">${escHtml(r.level||'Read')}</span></td>
              <td class="tc-net"><span class="badge ${r.status==='active'?'badge-green':'badge-gray'}">${r.status||'active'}</span></td>
              <td class="tc-detail" data-label="Granted By">${escHtml(r.grantedBy||'—')}</td>
              <td class="tc-detail" data-label="Date">${r.date||'—'}</td>
              ${canEdit?`<td class="tc-actions"><button class="btn-sm btn-danger revoke-access-btn" data-id="${r.id}" data-emp="${escHtml(r.employee||'this user')}" style="font-size:11px;padding:3px 8px">Revoke</button></td>`:''}
            </tr>`).join('')}
        </tbody>
      </table></div></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [content] });
    content.querySelectorAll('tr.access-row').forEach(tr => tr.addEventListener('click', (ev) => {
      if (ev.target.closest('button, a')) return;
      tr.classList.toggle('tc-expanded');
    }));
    document.getElementById('new-access-btn')?.addEventListener('click', () => {
      openPage('Grant Access', `
        <div class="form-row">
          <div class="form-group"><label>Employee Name</label><input id="ac-emp" placeholder="Full name"/></div>
          <div class="form-group"><label>System / App</label><input id="ac-sys" placeholder="e.g. Google Workspace, Firebase"/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Access Level</label>
            <select id="ac-lvl"><option>Read</option><option>Write</option><option>Admin</option><option>Owner</option></select>
          </div>
          <div class="form-group"><label>Date Granted</label><input id="ac-date" type="date" value="${today()}"/></div>
        </div>
        <div class="form-group"><label>Notes</label><textarea id="ac-notes" rows="2"></textarea></div>
      `, `<button class="btn-primary" id="save-access-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('save-access-btn').addEventListener('click', async () => {
        await db.collection('it_access').add({
          employee: document.getElementById('ac-emp').value.trim(),
          system: document.getElementById('ac-sys').value.trim(),
          level: document.getElementById('ac-lvl').value,
          date: document.getElementById('ac-date').value,
          grantedBy: currentUser.displayName||currentUser.uid,
          notes: document.getElementById('ac-notes').value.trim(),
          status: 'active', createdBy: currentUser.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        closeModal(); loadITContent(currentUser, currentRole, 'Access Control', canEdit);
      });
    });
    content.querySelectorAll('.revoke-access-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!(await confirmDialog({message:`Revoke access for ${escHtml(btn.dataset.emp)}?`, danger:true, html:true}))) return;
        await db.collection('it_access').doc(btn.dataset.id).update({ status:'revoked', revokedAt: firebase.firestore.FieldValue.serverTimestamp(), revokedBy: currentUser.uid });
        loadITContent(currentUser, currentRole, 'Access Control', canEdit);
      });
    });
    return;
  }

  // ── Network ───────────────────────────────────────
  if (sub === 'Network') {
    let notes;
    try {
      const snap = await db.collection('it_network').orderBy('createdAt','desc').get();
      notes = snap.docs.map(d=>({id:d.id,...d.data()}));
    } catch (err) {
      content.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load</h4><p>${escHtml(err.message||String(err))}</p><button type="button" class="btn-secondary btn-sm it-retry-btn" style="margin-top:14px">Retry</button></div>`;
      if (window.lucide) lucide.createIcons({ nodes: [content] });
      content.querySelector('.it-retry-btn')?.addEventListener('click', ()=>loadITContent(currentUser, currentRole, sub, canEdit));
      return;
    }
    const NET_TYPES = ['WiFi','Router / Modem','IP Config','VPN','ISP Details','Server','General'];
    content.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
        ${canEdit?`<button class="btn-primary btn-sm" id="new-net-btn">+ Add Network Note</button>`:''}
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        ${!notes.length?window.renderEmptyState({icon:'🌐',title:'No network notes yet'})
          :notes.map(n=>`
            <div class="card">
              <div class="card-header">
                <h3>${emojiIcon('🌐',20)} ${escHtml(n.title||'Untitled')}</h3>
                <span class="badge badge-blue" style="font-size:10px">${escHtml(n.type||'General')}</span>
              </div>
              <div style="padding:0 16px 16px;font-size:13px;white-space:pre-wrap;color:var(--text)">${escHtml(n.content||'')}</div>
              ${n.updatedAt?`<div style="padding:0 16px 8px;font-size:11px;color:var(--text-muted)">Updated ${new Date(n.updatedAt.toDate()).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})}</div>`:''}
              ${canEdit?`<div style="display:flex;gap:8px;padding:0 16px 14px">
                <button class="btn-sm btn-secondary edit-net-btn" data-id="${n.id}" style="font-size:11px;padding:3px 10px">Edit</button>
                <button class="btn-sm btn-danger del-net-btn" data-id="${n.id}" data-title="${escHtml(n.title||'this note')}" style="font-size:11px;padding:3px 10px">Delete</button>
              </div>`:''}
            </div>`).join('')}
      </div>`;
    if (window.lucide) lucide.createIcons({ nodes: [content] });
    const netModal = (existing) => {
      openPage(existing?'Edit Network Note':'Add Network Note', `
        <div class="form-row">
          <div class="form-group"><label>Title</label><input id="net-title" value="${escHtml(existing?.title||'')}" placeholder="e.g. Office WiFi Credentials"/></div>
          <div class="form-group"><label>Type</label>
            <select id="net-type">${NET_TYPES.map(t=>`<option ${existing?.type===t?'selected':''}>${t}</option>`).join('')}</select>
          </div>
        </div>
        <div class="form-group"><label>Content / Notes</label><textarea id="net-content" rows="6" placeholder="SSID, passwords, IPs, ports, etc.">${escHtml(existing?.content||'')}</textarea></div>
      `, `<button class="btn-primary" id="save-net-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      document.getElementById('save-net-btn').addEventListener('click', async () => {
        const title = document.getElementById('net-title').value.trim();
        if (!title) { Notifs.showToast('Enter a title.','error'); return; }
        const payload = {
          title, type: document.getElementById('net-type').value,
          content: document.getElementById('net-content').value,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: currentUser.uid
        };
        if (existing) {
          await db.collection('it_network').doc(existing.id).update(payload);
        } else {
          await db.collection('it_network').add({ ...payload, createdBy: currentUser.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
        closeModal(); loadITContent(currentUser, currentRole, 'Network', canEdit);
      });
    };
    document.getElementById('new-net-btn')?.addEventListener('click', () => netModal(null));
    content.querySelectorAll('.edit-net-btn').forEach(btn => {
      btn.addEventListener('click', () => { const n = notes.find(x=>x.id===btn.dataset.id); if (n) netModal(n); });
    });
    content.querySelectorAll('.del-net-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!(await confirmDialog({message:`Delete network note "${escHtml(btn.dataset.title)}"? This cannot be undone.`, danger:true, html:true}))) return;
        await db.collection('it_network').doc(btn.dataset.id).delete();
        loadITContent(currentUser, currentRole, 'Network', canEdit);
      });
    });
    return;
  }

  // ── Tasks ─────────────────────────────────────────
  if (sub === 'Tasks') {
    await renderDeptTasks(content, 'IT', currentUser, currentRole);
    return;
  }
}

function openITTicketModal(ticket, currentUser, canEdit, onRefresh) {
  const isAssigned = canEdit || ticket.createdBy === currentUser.uid;
  openPage(`${emojiIcon('🎫',16)} ${escHtml(ticket.title||'Ticket')}`, `
    <div style="margin-bottom:12px">
      <div class="item-meta" style="gap:8px;margin-bottom:8px">
        <span class="badge ${window.statusBadgeClass('it_ticket', ticket.status||'open')}">${window.statusLabel2('it_ticket', ticket.status||'open')}</span>
        <span class="badge ${ticket.priority==='high'?'badge-red':ticket.priority==='medium'?'badge-orange':'badge-gray'}">${ticket.priority||'low'} priority</span>
        <span class="badge badge-blue" style="font-size:10px">${escHtml(ticket.category||'General')}</span>
      </div>
      ${ticket.description?`<p style="font-size:13px;margin-bottom:12px;white-space:pre-wrap">${escHtml(ticket.description)}</p>`:''}
      ${ticket.requestedBy?`<div style="font-size:12px;color:var(--text-muted)">Requested by: ${escHtml(ticket.requestedBy)}</div>`:''}
    </div>
    ${canEdit?`
      <div class="form-row" style="margin-top:12px">
        <div class="form-group"><label>Status</label>
          <select id="it-t-status">
            <option value="open" ${ticket.status==='open'?'selected':''}>Open</option>
            <option value="in-progress" ${ticket.status==='in-progress'?'selected':''}>In Progress</option>
            <option value="resolved" ${ticket.status==='resolved'?'selected':''}>Resolved</option>
            <option value="closed" ${ticket.status==='closed'?'selected':''}>Closed</option>
          </select>
        </div>
        <div class="form-group"><label>Assigned To (IT)</label><input id="it-t-assign" value="${escHtml(ticket.assignedTo||'')}"/></div>
      </div>
      <div class="form-group"><label>Resolution Notes</label><textarea id="it-t-res" rows="3">${escHtml(ticket.resolutionNotes||'')}</textarea></div>
    `:'<p style="font-size:12px;color:var(--text-muted)">Only IT staff can update this ticket.</p>'}
  `, canEdit?`<button class="btn-primary" id="upd-ticket-btn">Update Ticket</button><button class="btn-secondary" onclick="closeModal()">Close</button>`
    :`<button class="btn-secondary" onclick="closeModal()">Close</button>`);
  document.getElementById('upd-ticket-btn')?.addEventListener('click', async () => {
    await db.collection('it_tickets').doc(ticket.id).update({
      status: document.getElementById('it-t-status').value,
      assignedTo: document.getElementById('it-t-assign').value.trim(),
      resolutionNotes: document.getElementById('it-t-res').value.trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: currentUser.uid
    });
    closeModal(); onRefresh?.();
  });
}
