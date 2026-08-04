/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Brilliant Steel + Partners screens
   js/screens/partners.js

   Wave 7 Pass 6 — split out of js/departments.js (Brilliant Steel) and
   js/app.js (Partners dept + partner portal screens) verbatim, 2026-08-03,
   following the Wave 2 (design.js) / Wave 7 Pass 1-5 extraction protocol.
   Still plain `window.*`-attached globals, no ESM, no bundler — this file
   is a physical split only, not a module.

   Contents:
   - Brilliant Steel (from js/departments.js): window.renderBrilliantSteel
     (the 4-tab shell — Quote Builder/Quotations Summary/Client Data/Files),
     loadBSContent (the tab-content dispatcher), renderBSFiles (the Files
     tab's own 4-way sub-bar — Quotations/Images/Drawings/Documents),
     renderBSClientData (the partner-facing client accordion, quote-derived).
   - Partners (from js/app.js): PARTNER_STAGE + renderPartnerProjects (the
     read-only "My Projects" screen every partner variant's nav points at),
     renderPartnerDashboard (the partner-role dashboard, BS vs generic-partner
     branded via isGenericPartner()), renderPartnersDept + loadPartnersDeptTab
     (the ADMIN-side Partners department hub — Overview/Deals/Tasks/Quotes/
     Quote Builder/Activity chips) and its _showAddDealModal helper.

   DELIBERATELY LEFT IN departments.js/app.js (grepped for outside callers
   before this move; genuinely shared per the Wave 7 spec):
     - renderBSQuotationFiles / window.getBsQuotesOrdered /
       window.invalidateBsQuotesCache (departments.js) — renderBSQuotationFiles
       is called from BOTH this file's renderBSFiles (Files → Quotations tab)
       AND departments.js's renderApprovals (the 'quote-files' Approvals
       chip, loadApprovalsSub ~departments.js:5810) — a genuinely shared
       renderer, so it stays put and this file calls it as a bare global.
       getBsQuotesOrdered backs renderBSQuotationFiles (stays) AND this
       file's renderBSClientData (moved) — kept where its majority caller
       lives. invalidateBsQuotesCache has FIVE outside callers inside
       departments.js itself (the sales-order conversion flow, quote
       delete/approve paths) beyond anything in this file, so it's a shared
       service, not a Brilliant Steel screen.
     - renderBSQuotationsSummary / bindQuoteActions (js/screens/sales.js,
       Wave 7 Pass 2) — loadBSContent's 'Quotations Summary' case here still
       calls renderBSQuotationsSummary as a bare global identifier; same
       cross-file, runtime-only resolution documented in sales.js's own
       header ("renderBSClientData / renderBSFiles / renderBrilliantSteel /
       loadBSContent — Brilliant Steel department screens (Wave 7 Pass 6,
       partners.js)").
     - renderClientProfiles (departments.js) — loadBSContent's Client Data
       case calls this for internal-staff (non-partner) viewers; shared
       CRM-hub renderer used by every department, not Brilliant-Steel-only.
     - renderFileCollection/bindFileCollection (departments.js) — generic
       file-collection renderer renderBSFiles's Images/Drawings/Documents
       tabs delegate to; shared across every department's Files screens.
     - orderTrackUrl/makeTrackCode/uniqueTrackCode/showOrderTrackModal/
       syncOrderTracking/ensureOrderTracking, openSalesOrderModal,
       renderSalesOrders, transferOrderToProduction (departments.js) — back
       both BK/BS "Sales Order" flows AND Finance's Sales Orders subtab;
       already documented as a shared service in sales.js's header, unrelated
       to this file's screens beyond the fact that a won BS quote flows
       through them elsewhere.
     - isPresident/isPartner/isBrilliantOnly/isBrilliantPartner/
       isGenericPartner/partnerCompanyName/_navVariant/getSidebarItems
       (js/app.js) — the role/nav predicates every screen in the app reads,
       not partner-screen-specific; this file calls them as bare globals
       (isGenericPartner() in renderPartnerDashboard, partnerCompanyName()
       in renderPartnerProjects/renderPartnerDashboard).
     - liveDateTime (js/app.js) — the shared dashboard live-clock helper
       renderPartnerDashboard calls; used by every role's dashboard
       (renderPresidentDashboard, renderEmployeeDashboard, etc.), not moved.
     - renderQuoteBuilderIframe + its postMessage bridge (js/app.js) — per
       the task brief, these serve Sales too (BK quote builder) and stay in
       app.js; this file's chip callbacks (loadBSContent's 'Quote Builder'
       case, loadPartnersDeptTab's 'quote-builder' case) reach it two
       different ways — navigateTo('bs-quote-builder') for the former, a
       plain <iframe src="quote-builder-v2.html"> for the latter (that's the
       pre-existing behavior, unchanged by this move).

   LOAD-ORDER CONTRACT (see index.html + CLAUDE.md "Script load order is
   load-bearing"):
     - Loads AFTER js/departments.js and js/screens/sales.js/govit.js (index.html
       order). Every function in this file is invoked only at runtime (click
       handler, navigateTo case, renderDeptModule case) — never at parse
       time — so the cross-file bare-global calls above all resolve fine
       regardless of physical file order, same as every prior Wave 7 pass.
     - Added to sw.js PRECACHE (else offline installs 404 on this file).

   Wave 7 Pass 6 conversion (8-point treatment):
   1. chipTabs — the ONE required conversion this pass: renderBrilliantSteel's
      top-level 4-tab bar (Quote Builder/Quotations Summary/Client Data/Files)
      and renderBSFiles' own Quotations/Images/Drawings/Documents sub-bar
      were BOTH still hand-rolled `.subtab-bar`/`.subtab-btn` markup (the
      "Brilliant Steel" entry in the spec's known-four list covers both —
      confirmed there was no separate third BS bar). Both now render via
      window.chipTabs()/window.bindChipTabs(), same tab set, same default/
      active tab, same click behavior (renderBrilliantSteel's 'Quote Builder'
      chip still calls navigateTo('bs-quote-builder') — i.e. clicking it
      navigates to a different page entirely, same pre-existing quirk,
      unchanged). renderPartnersDept's own chip bar was already chipTabs
      pre-move (WS10/WS-era code) — verified, unchanged.
      Also verified (report-only per the task brief, NOT fixed — outside
      this file's scope): js/screens/design.js's window.openProjectDetail
      (~line 225) still has a hand-rolled `.subtab-bar`/`#pd-tabs` bar for
      the project-detail Overview/Drawings/Files/Tasks/Financials/Activity
      tabs — the "Design project detail" entry in the spec's known-four list
      was NOT closed by Design's Wave 2 extraction (only the top-level
      Design department tabs at design.js:60 use chipTabs). Flagged as a
      background task for a future pass; design.js is outside this pass's
      edit scope. Two more hand-rolled bars were found in departments.js
      while scanning, also out of scope for this pass (not Brilliant
      Steel/Partners, not on the spec's known-four list): renderCash's own
      subtab-bar (~departments.js:513, My/All Expenses/Summary) and the
      file-manager's folder-chip bar (~departments.js:6516, still literally
      class="subtab-bar" despite being called `chipBar` in a local variable
      name and using window.chipTabs-adjacent data-attribute wiring by hand).
   2. Surfaces — already 100% openPage/chip-driven content swaps; no raw
      #page-content swaps or stray modal flows found (partner deal creation
      uses a hand-built `.modal-overlay` div via _showAddDealModal, which
      pre-dates the openModal() helper but is self-contained and already
      wired to window.Overlay-free manual dismiss — left as-is, out of the
      "any straggler modal/detail flow onto the stack" scope since it's a
      simple, already-functioning create-form, not a detail/edit surface).
   3. Loading/empty/error — three fetches here previously swallowed failures
      silently (the same anti-pattern govit.js/production.js/sales.js's
      headers already documented and fixed elsewhere): renderPartnerDashboard's
      Promise.all (tasks/quotes/deals/projects — a thrown error left every
      dashboard card permanently blank with only a console.warn, no visible
      feedback), loadPartnersDeptTab's shared users/tasks/quotes fetch (every
      `.catch(()=>({docs:[]}))` per query made a real permission/network
      error render as an empty Partners dept with no way to tell), and its
      'deals' chip's own dealsSnap fetch (same pattern). All three now
      try/catch the read and render the standard "Couldn't load — Retry"
      block (icon+h4+message+button, same markup/idiom as govit.js/
      production.js/sales.js), Retry re-invoking the same render call.
      renderBSClientData's and renderPartnerProjects' catch blocks existed
      already but predated the Retry-button idiom (bare "Error: {message}"
      text, no recovery action) — upgraded to match. renderBSQuotationFiles
      (departments.js, stays there — see "deliberately left in" above) got
      the same upgrade in place since it's this pass's Files-tab dependency.
      Empty states (renderBSClientData "No client data yet", renderBSFiles/
      renderBSQuotationFiles "No quotation files yet", renderPartnerProjects
      "No projects yet", loadPartnersDeptTab's per-chip empties) already used
      the icon+h4 renderEmptyState-equivalent shape or renderEmptyState
      itself; unchanged. Loading states (skeletonHtml('rows')/('cards')) were
      already present on every screen; unchanged.
   4. Tables — renderBSClientData's quotation-history table and
      loadPartnersDeptTab's Deals/Quotes tables already used/were checked for
      `.table-cards`; the Deals and Quotes tables (loadPartnersDeptTab) did
      NOT have it (admin-only desktop-oriented tables, never had mobile
      card-reflow) — added `.table-cards` to both for mobile parity with
      every other department's tables. renderBSClientData's table already
      had it (verified, unchanged).
   5. Icons — Lucide-only sinks confirmed (no emojiIcon() HTML leaking into
      Notifs text sinks). All buttons already carry visible text alongside
      their icon (no icon-only buttons found in the moved code) except
      _showAddDealModal's `#deal-modal-close` × button, which already had
      aria-label="Close" pre-move — verified, unchanged.
   6. Headers — renderBrilliantSteel's custom icon+h2+p header (not the
      standard .page-header class — a pre-existing, intentional visual
      variant for this one screen) is the only header on that screen; no
      redundant stacked headers found. renderPartnersDept/renderPartnerProjects/
      renderPartnerDashboard each have exactly one .page-header; unchanged.
   7. Styling — one confident token swap: renderBrilliantSteel's `<h2>`
      hardcoded `color:#37474f` (the only occurrence of that hex in the
      codebase — grepped) → `var(--text)`, matching the default
      `.page-header h2` color every other department header relies on
      instead of inheriting it. No forced sweep beyond this one.
   8. sopPanel — neither Brilliant Steel nor Partners had one before this
      move and none was added: Brilliant Steel is a partner-facing
      transactional screen (Quote Builder/Quotations/Clients/Files) more
      akin to Sales' own quote tabs (which also lack a sopPanel) than a
      workflow department; Partners is an admin-only oversight screen. The
      spec's "known gaps" list (Design/IT/Purchasing/Sales top-level) does
      not name either, so none was added here — flagged for a product
      decision, not treated as a defect.

   PARITY AUDIT (report-only per the task brief; see the pass report for the
   full screen × variant matrix). One trivial drift item was fixed here as
   part of this pass: none qualified as "a missing nav item the variant's
   own screens already support" — every nav gap found (genericPartner
   lacking Client Data/bs-clients, partnerBS's bottom-nav lacking Client
   Data despite its sidebar having it, genericPartner's bottom-nav lacking
   Quotations/Files despite its sidebar having them, bsOnly's dashboard
   route skipping renderPartnerDashboard entirely) required a product
   decision on WHICH variant's config is "correct," not a same-screen nav
   omission — so all of it is reported, none auto-fixed. See config.js
   (read-only for this pass) for NAV_REGISTRY.

   ═══════════════════════════════════════════════════ */

// ══════════════════════════════════════════════════
//  BRILLIANT STEEL — Main Module (v3)
// ══════════════════════════════════════════════════

window.renderBrilliantSteel = async function(currentUser, currentRole, subtab = 'Quotations Summary') {
  const c = deptContainer();
  const tabs = ['Quote Builder','Quotations Summary','Client Data','Files'];
  c.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <span style="font-size:22px">${emojiIcon('⚙️',22)}</span>
      <div>
        <h2 style="font-size:18px;font-weight:800;color:var(--text)">Brilliant Steel</h2>
        <p style="font-size:11px;color:var(--text-muted)">Partner Company Operations</p>
      </div>
    </div>
    ${window.chipTabs(tabs.map(s => ({ key:s, label:s })), subtab, { cls:'bs-tabs' })}
    <div id="bs-content">${window.skeletonHtml('rows')}</div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  loadBSContent(currentUser, currentRole, subtab);
  window.bindChipTabs(c.querySelector('.bs-tabs'), (key) => {
    loadBSContent(currentUser, currentRole, key);
  });
};

async function loadBSContent(currentUser, currentRole, sub) {
  const content = document.getElementById('bs-content');
  switch(sub) {
    case 'Quote Builder':      navigateTo('bs-quote-builder'); break;
    case 'Quotations Summary': await renderBSQuotationsSummary(content, currentUser, currentRole); break;
    // Partners keep the quote-derived accordion (already scoped by bs_quotes
    // rules); internal staff get the unified CRM hub with stages/follow-ups/timeline.
    case 'Client Data': {
      const partnerView = currentRole === 'partner' ||
        ((window.currentDepts || []).length === 1 && (window.currentDepts || [])[0] === 'Brilliant Steel');
      if (partnerView) await renderBSClientData(content, currentUser, currentRole);
      else await renderClientProfiles(content, currentUser, currentRole, 'brilliant-steel');
      break;
    }
    case 'Files':              renderBSFiles(content, currentUser, currentRole); break;
  }
}

function renderBSFiles(container, currentUser, currentRole) {
  container.innerHTML = `
    ${window.chipTabs([
      { key:'Quotations', label:'Quotations', icon: emojiIcon('📋',14) },
      { key:'Images',     label:'Images',     icon: emojiIcon('🖼',14) },
      { key:'Drawings',   label:'Drawings',   icon: emojiIcon('📐',14) },
      { key:'Documents',  label:'Documents',  icon: emojiIcon('📄',14) },
    ], 'Quotations', { cls:'bs-files-tabs' })}
    <div id="bs-files-content"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });
  const load = async sub => {
    const fc = document.getElementById('bs-files-content');
    if (sub === 'Quotations') {
      await renderBSQuotationFiles(fc, currentUser, currentRole);
    } else {
      fc.innerHTML = renderFileCollection(`${sub}`, `bs-${sub.toLowerCase()}`, currentRole);
      bindFileCollection(`bs-${sub.toLowerCase()}`, currentUser, 'Brilliant Steel', sub);
    }
  };
  load('Quotations');
  window.bindChipTabs(container.querySelector('.bs-files-tabs'), (key) => load(key));
}

// ── Brilliant Steel Client Data ────────────────────
async function renderBSClientData(container, currentUser, currentRole) {
  container.innerHTML = window.skeletonHtml('cards');
  // See-everyone's-clients requires admin or Sales-dept membership — a bare
  // 'employee' whose only dept is Brilliant Steel must NOT see every client's
  // PII (mirrors renderBSQuotationFiles/renderBSQuotationsSummary's gate).
  const isPrivileged = currentRole === 'president' || currentRole === 'owner' || currentRole === 'manager'
    || (currentRole === 'employee' && (window.currentDepts || []).includes('Sales'));
  try {
    const snap = await window.getBsQuotesOrdered(currentUser, isPrivileged);
    const quotes = snap.docs.map(d=>({id:d.id,...d.data()}));

    // Build unique client map
    const clientMap = {};
    quotes.forEach(q => {
      const key = (q.clientName||'').trim().toLowerCase() || q.id;
      if (!clientMap[key]) {
        clientMap[key] = {
          name: q.clientName||'Unnamed',
          company: q.clientCompany||'',
          address: q.clientAddress||'',
          contact: q.clientContact||q.clientPhone||'',
          email: q.clientEmail||'',
          tin: q.clientTin||'',
          quotes: [],
          totalValue: 0,
          lastActivity: q.createdAt?.seconds||0
        };
      }
      clientMap[key].quotes.push(q);
      clientMap[key].totalValue += (q.total||q.grandTotal||0);
      if ((q.createdAt?.seconds||0) > clientMap[key].lastActivity) {
        clientMap[key].lastActivity = q.createdAt?.seconds||0;
        clientMap[key].email = q.clientEmail || clientMap[key].email;
        clientMap[key].contact = q.clientContact||q.clientPhone || clientMap[key].contact;
        clientMap[key].company = q.clientCompany || clientMap[key].company;
        clientMap[key].address = q.clientAddress || clientMap[key].address;
        clientMap[key].tin = q.clientTin || clientMap[key].tin;
      }
    });

    const clients = Object.values(clientMap).sort((a,b) => b.lastActivity - a.lastActivity);

    if (!clients.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('👤',44)}</div><h4>No client data yet</h4><p style="color:var(--text-muted);font-size:13px">Clients will appear here once quotations are filed.</p></div>`;
      if (window.lucide) lucide.createIcons({ nodes: [container] });
      return;
    }

    let searchVal = '';
    const render = (list) => {
      const wrap = container.querySelector('#bs-client-list');
      if (!wrap) return;
      if (!list.length) { wrap.innerHTML = '<div class="empty-state"><p>No clients match your search.</p></div>'; return; }
      wrap.innerHTML = list.map((cl,i) => `
        <div class="card" style="margin-bottom:10px">
          <div class="card-header" style="cursor:pointer;user-select:none" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
            <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">
              <div style="width:38px;height:38px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-weight:800;color:white;font-size:15px;flex-shrink:0">${(cl.name[0]||'?').toUpperCase()}</div>
              <div style="min-width:0">
                <div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(cl.name)}</div>
                ${cl.company?`<div style="font-size:11px;color:var(--text-muted)">${escHtml(cl.company)}</div>`:''}
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
              <span class="badge badge-blue">${cl.quotes.length} quote${cl.quotes.length!==1?'s':''}</span>
              <span style="font-size:13px;font-weight:700;color:var(--success)">₱${window.fmtN2(cl.totalValue)}</span>
              <span style="color:var(--text-muted);font-size:16px">›</span>
            </div>
          </div>
          <div class="card-body" style="display:none;padding-top:0">
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-bottom:12px;padding-top:10px;border-top:1px solid var(--border)">
              ${cl.address?`<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:.4px">Address</div><div style="font-size:13px;margin-top:2px">${escHtml(cl.address)}</div></div>`:''}
              ${cl.contact?`<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:.4px">Contact</div><div style="font-size:13px;margin-top:2px">${escHtml(cl.contact)}</div></div>`:''}
              ${cl.email?`<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:.4px">Email</div><div style="font-size:13px;margin-top:2px">${escHtml(cl.email)}</div></div>`:''}
              ${cl.tin?`<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:.4px">TIN</div><div style="font-size:13px;margin-top:2px">${escHtml(cl.tin)}</div></div>`:''}
            </div>
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:.4px;margin-bottom:8px">Quotation History</div>
            <div class="table-wrap"><table class="data-table table-cards">
              <thead><tr><th>Quote #</th><th>Amount</th><th>Status</th><th>Date</th>${isPrivileged?'<th>By</th>':''}<th></th></tr></thead>
              <tbody>${cl.quotes.map(q=>{
                const ts = q.createdAt?.toDate?q.createdAt.toDate().toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}):'';
                const status = q.status||q.approvalStatus||'draft';
                const badge = window.statusBadgeClass('quote', status);
                return `<tr class="bsq-row">
                  <td class="tc-name"><code>${escHtml(q.quoteNumber||q.id.slice(-8))}</code> <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
                  <td class="tc-net" style="font-weight:600">₱${window.fmtN2(q.total||q.grandTotal||0)}</td>
                  <td class="tc-detail" data-label="Status"><span class="badge ${badge}">${window.statusLabel2('quote', status)}</span>${window.quoteShareChipHtml(q)}</td>
                  <td class="tc-detail" data-label="Date" style="color:var(--text-muted);font-size:11px">${ts}</td>
                  ${isPrivileged?`<td class="tc-detail" data-label="By" style="font-size:12px;color:var(--text-muted)">${escHtml(q.agentName||q.createdByName||'—')}</td>`:''}
                  <td class="tc-actions" style="white-space:nowrap">${q.editableState?`<button class="btn-secondary btn-sm" onclick="event.stopPropagation();window.reopenQuoteFromDoc('bs_quotes','${q.id}','bs-quote-builder')" title="Open this quote in the builder to edit — re-filing saves a new copy">↻ Reopen &amp; Edit</button> <button class="btn-secondary btn-sm" onclick="event.stopPropagation();window.newRevisionFromDoc('bs_quotes','${q.id}','bs-quote-builder')" title="Start a new revision (R2, R3…) with today's date">${emojiIcon('⎘',16)} New Revision</button>`:'<span style="font-size:10px;color:var(--text-muted)">no snapshot</span>'}
                  ${window.QUOTE_SHAREABLE_STATUSES.includes(status)?` <button class="btn-secondary btn-sm" onclick="event.stopPropagation();window.shareQuoteWithClient('bs_quotes','${q.id}',()=>renderBSClientData(container, currentUser, currentRole))" title="Get a client-facing link — no login needed — to Accept or Request changes">${emojiIcon('🔗',16)} Share</button>`:''}</td>
                </tr>`;
              }).join('')}</tbody>
            </table></div>
          </div>
        </div>
      `).join('');
      if (window.lucide) lucide.createIcons({ nodes: [wrap] });
      wrap.querySelectorAll('tr.bsq-row').forEach(tr => tr.addEventListener('click', (ev) => {
        if (ev.target.closest('button, a')) return;
        tr.classList.toggle('tc-expanded');
      }));
    };

    container.innerHTML = `
      <div class="page-header" style="margin-bottom:14px">
        <h3 style="font-size:15px;font-weight:700">${emojiIcon('👤',15)} Client Data <span style="font-size:12px;font-weight:400;color:var(--text-muted)">${clients.length} client${clients.length!==1?'s':''}</span></h3>
        <input id="bs-client-search" placeholder="Search clients…" class="ms-input" style="max-width:260px"/>
      </div>
      <div id="bs-client-list"></div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [container] });
    render(clients);

    container.querySelector('#bs-client-search').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      render(q ? clients.filter(cl =>
        cl.name.toLowerCase().includes(q) ||
        (cl.company||'').toLowerCase().includes(q) ||
        (cl.address||'').toLowerCase().includes(q)
      ) : clients);
    });
  } catch(err) {
    // 8-point #3 (Wave 7 Pass 6) — was bare "Error loading clients: {message}"
    // text with no recovery; matches the Retry idiom every other pass uses.
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load client data</h4><p>${escHtml(err.message||String(err))}</p><button type="button" class="btn-secondary btn-sm bscd-retry-btn" style="margin-top:14px">Retry</button></div>`;
    container.querySelector('.bscd-retry-btn')?.addEventListener('click', () => renderBSClientData(container, currentUser, currentRole));
    if (window.lucide) lucide.createIcons({ nodes: [container] });
  }
}

// ── Partner — Project Details ────────────────────────────────────────
// Read-only view of the projects Barro Industries has tagged to this partner
// (job_projects.partnerUid). Generic partners use this in place of the BS
// client book. Shows scope, stage, contract value, the partner's share & timeline.
const PARTNER_STAGE = {
  quote:       { label:'Quoting',        cls:'badge-gray'   },
  order:       { label:'Order Confirmed',cls:'badge-blue'   },
  in_production:{ label:'In Production', cls:'badge-orange' },
  production:  { label:'In Production',  cls:'badge-orange' },
  delivery:    { label:'For Delivery',   cls:'badge-purple' },
  delivered:   { label:'Delivered',      cls:'badge-teal'   },
  paid:        { label:'Completed · Paid',cls:'badge-green'  },
  cancelled:   { label:'Cancelled',      cls:'badge-red'    }
};
async function renderPartnerProjects() {
  const c = document.getElementById('page-content');
  const co = partnerCompanyName();
  const uid = currentUser.uid;
  c.innerHTML = `
    <div class="page-header"><h2>${emojiIcon('💼',20)} My Projects</h2></div>
    <div style="font-size:12px;color:var(--text-muted);margin:-6px 0 12px;font-weight:600">Projects Barro Industries is running with ${escHtml(co)}</div>
    <div id="partner-projects-body">${window.skeletonHtml('cards')}</div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  try {
    const [projSnap, dealSnap] = await Promise.all([
      db.collection('job_projects').where('partnerUid','==',uid).get().catch(()=>({docs:[]})),
      db.collection('partner_deals').where('partnerUid','==',uid).get().catch(()=>({docs:[]}))
    ]);
    // Normalise both sources into one shape so legacy deals still appear.
    const projects = projSnap.docs.map(d=>({ id:d.id, _src:'project', ...d.data() }));
    const deals = dealSnap.docs.map(d=>{
      const x = d.data();
      return { id:d.id, _src:'deal', clientName:x.clientName, projectNo:x.id,
        stage:(x.status==='paid'?'paid':x.status==='completed'?'delivered':'order'),
        contractAmount:x.totalContractValue, capital:x.costAmount,
        split:{ partnerPct:50 }, notes:x.projectDescription||x.notes,
        createdAt:x.createdAt };
    });
    const all = [...projects, ...deals].sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const share = (p)=>{
      const pct = (p.split && typeof p.split.partnerPct==='number') ? p.split.partnerPct : 50;
      return Math.max(0, (p.contractAmount||0)-(p.capital||0)) * (pct/100);
    };
    const body = document.getElementById('partner-projects-body');
    if (!body) return;
    if (!all.length) {
      body.innerHTML = `<div class="empty-state" style="padding:40px 16px"><div class="empty-icon">${emojiIcon('💼',44)}</div>
        <p>No projects yet</p>
        <p style="font-size:12px;color:var(--text-muted)">Barro Industries will tag projects to ${escHtml(co)} here as they come in.</p></div>`;
      if (window.lucide) lucide.createIcons({ nodes: [body] });
      return;
    }
    const active = all.filter(p=>p.stage!=='cancelled' && p.stage!=='paid');
    const totalShare = all.filter(p=>p.stage!=='cancelled').reduce((s,p)=>s+share(p),0);
    body.innerHTML = `
      <div class="kpi-row" style="margin-bottom:14px">
        <div class="kpi-card accent"><div class="kpi-label">Active</div><div class="kpi-value">${active.length}</div></div>
        <div class="kpi-card"><div class="kpi-label">Total Projects</div><div class="kpi-value">${all.filter(p=>p.stage!=='cancelled').length}</div></div>
        <div class="kpi-card green"><div class="kpi-label">Your Share (est.)</div><div class="kpi-value" style="font-size:15px">₱${fmt(totalShare)}</div></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        ${all.map(p=>{
          const st = PARTNER_STAGE[p.stage] || { label:(p.stage||'Active'), cls:'badge-gray' };
          const pct = (p.split && typeof p.split.partnerPct==='number') ? p.split.partnerPct : 50;
          const margin = Math.max(0,(p.contractAmount||0)-(p.capital||0));
          return `<div class="card"><div class="card-body">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px">
              <div style="min-width:0">
                <div style="font-weight:800;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.clientName||p.projectNo||'Project')}</div>
                <div style="font-size:11px;color:var(--text-muted)">${escHtml(p.projectNo||'')}</div>
              </div>
              <span class="badge ${st.cls}" style="flex-shrink:0">${st.label}</span>
            </div>
            ${p.notes?`<div style="font-size:12px;color:var(--text-secondary,var(--text-muted));margin-bottom:8px">${escHtml(p.notes)}</div>`:''}
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:12px;border-top:1px solid var(--border);padding-top:8px">
              <div><div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.3px">Contract</div><div style="font-weight:700">₱${fmt(p.contractAmount||0)}</div></div>
              <div><div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.3px">Margin</div><div style="font-weight:700">₱${fmt(margin)}</div></div>
              <div><div style="color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:.3px">Your Share (${pct}%)</div><div style="font-weight:700;color:var(--success)">₱${fmt(share(p))}</div></div>
            </div>
          </div></div>`;
        }).join('')}
      </div>
      <div style="font-size:11px;color:var(--text-muted);text-align:center;margin-top:14px">Figures are set by Barro Industries. Contact us for any project questions.</div>
    `;
  } catch(e) {
    // 8-point #3 (Wave 7 Pass 6) — was bare "Couldn't load projects." text
    // with no recovery; matches the Retry idiom every other pass uses.
    const body = document.getElementById('partner-projects-body');
    if (body) {
      body.innerHTML = `<div class="empty-state" style="padding:30px"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load projects</h4><p>${escHtml(e.message||String(e))}</p><button type="button" class="btn-secondary btn-sm pp-retry-btn" style="margin-top:14px">Retry</button></div>`;
      body.querySelector('.pp-retry-btn')?.addEventListener('click', () => renderPartnerProjects());
      if (window.lucide) lucide.createIcons({ nodes: [body] });
    }
  }
}

async function renderPartnerDashboard() {
  const c = document.getElementById('page-content');
  const u = userProfile;
  const co = partnerCompanyName();
  const genericP = isGenericPartner();
  // Brilliant Steel partners see the 50/50 steel-project walkthrough; a generic
  // company partner sees a neutral, company-branded intro.
  const introCard = genericP ? `
    <div class="card dash-hero-card" style="margin-bottom:14px">
      <div class="card-body">
        <div style="font-size:14px;font-weight:800;margin-bottom:8px">${emojiIcon('🤝',14)} ${escHtml(co)} × Barro Industries — partner portal</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
          <div style="font-size:12px"><div style="font-size:18px">①</div><strong>Track your projects</strong><br><span style="color:var(--text-muted)">See every project Barro Industries is running with ${escHtml(co)} — status, scope &amp; timeline.</span></div>
          <div style="font-size:12px"><div style="font-size:18px">②</div><strong>Build a quote</strong><br><span style="color:var(--text-muted)">Generate quotes under <strong>${escHtml(co)}</strong> or Barro Kitchens branding.</span></div>
          <div style="font-size:12px"><div style="font-size:18px">③</div><strong>Stay in sync</strong><br><span style="color:var(--text-muted)">Tasks, files &amp; updates for our shared work — all in one place.</span></div>
        </div>
      </div>
    </div>` : `
    <div class="card dash-hero-card" style="margin-bottom:14px">
      <div class="card-body">
        <div style="font-size:14px;font-weight:800;margin-bottom:8px">${emojiIcon('🤝',14)} How your Brilliant Steel partner portal works</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
          <div style="font-size:12px"><div style="font-size:18px">①</div><strong>Build a quote</strong><br><span style="color:var(--text-muted)">Use the Quote Builder — it's pre-set to Brilliant Steel pricing.</span></div>
          <div style="font-size:12px"><div style="font-size:18px">②</div><strong>Submit for review</strong><br><span style="color:var(--text-muted)">Verify &amp; file your quote. Barro reviews and approves it with you.</span></div>
          <div style="font-size:12px"><div style="font-size:18px">③</div><strong>Earn your 50%</strong><br><span style="color:var(--text-muted)">On every closed collaborative project, profit is split <strong>50/50</strong> — tracked below.</span></div>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:8px;border-top:1px solid var(--border);padding-top:8px">You're a profit-sharing partner — not a commission agent. This portal is just for our shared steel projects.</div>
      </div>
    </div>`;
  c.innerHTML = `
    <div class="page-header"><h2>${emojiIcon('👋',20)} Welcome, ${escHtml((u.displayName||'Partner').split(' ')[0])}!</h2></div>
    ${genericP ? `<div style="font-size:12px;color:var(--text-muted);margin:-6px 0 10px;font-weight:600">${escHtml(co)} · Partner</div>` : ''}
    <div id="live-clock" class="live-clock-line"></div>
    ${introCard}
    <div id="partner-kpi"></div>
    <div id="partner-earnings-card"></div>
    <div id="partner-cards-row" style="display:flex;flex-direction:column;gap:14px">
      <div id="partner-tasks-card"></div>
      <div id="partner-quotes-card"></div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px">
      <button class="btn-secondary" onclick="navigateTo('bs-quote-builder')" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 8px;border-radius:14px;font-size:12px;font-weight:700">
        <span style="font-size:24px">${emojiIcon('🧮',24)}</span>Quote Builder
      </button>
      <button class="btn-secondary" onclick="navigateTo('bs-quotations')" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 8px;border-radius:14px;font-size:12px;font-weight:700">
        <span style="font-size:24px">${emojiIcon('📄',24)}</span>Quotations
      </button>
      ${genericP ? `<button class="btn-secondary" onclick="navigateTo('partner-projects')" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 8px;border-radius:14px;font-size:12px;font-weight:700">
        <span style="font-size:24px">${emojiIcon('💼',24)}</span>Projects
      </button>` : `<button class="btn-secondary" onclick="navigateTo('bs-clients')" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 8px;border-radius:14px;font-size:12px;font-weight:700">
        <span style="font-size:24px">${emojiIcon('📋',24)}</span>Clients
      </button>`}
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  liveDateTime('live-clock');

  try {
    const [tasksSnap, quotesSnap, dealsSnap, projSnap] = await Promise.all([
      db.collection('tasks').where('assignedTo','array-contains',currentUser.uid).get()
        .catch(()=>db.collection('tasks').where('assignedTo','==',currentUser.uid).get()),
      db.collection('bs_quotes').where('createdBy','==',currentUser.uid).orderBy('createdAt','desc').limit(20).get()
        .catch(()=>({docs:[]})),
      db.collection('partner_deals').where('partnerUid','==',currentUser.uid).orderBy('createdAt','desc').get()
        .catch(()=>({docs:[]})),
      db.collection('job_projects').where('partnerUid','==',currentUser.uid).get()
        .catch(()=>({docs:[]}))
    ]);

    const tasks  = tasksSnap.docs.map(d=>({id:d.id,...d.data()}));
    const quotes = quotesSnap.docs.map(d=>({id:d.id,...d.data()}));
    const deals  = dealsSnap.docs.map(d=>({id:d.id,...d.data()}));
    const sharedProjects = projSnap.docs.map(d=>({id:d.id,...d.data()})).filter(p=>p.stage!=='cancelled');
    const open   = tasks.filter(t=>!['done','approved','archived'].includes(t.status));
    const done   = tasks.filter(t=>['done','approved','archived'].includes(t.status));
    const totalQVal = quotes.reduce((s,q)=>s+(q.total||q.grandTotal||0),0);
    const todayStr  = bizDate();

    // ── Earnings card — driven by the job_projects spine ──
    // Expected earnings on a sales order = (contract − capital) × partner split %.
    const partnerShare = (p)=>{
      const pct = (p.split && typeof p.split.partnerPct==='number') ? p.split.partnerPct : 50;
      return Math.max(0, (p.contractAmount||0) - (p.capital||0)) * (pct/100);
    };
    const activeProjects = sharedProjects.filter(p=>p.stage!=='paid');
    const paidProjects   = sharedProjects.filter(p=>p.stage==='paid');
    // legacy partner_deals are merged in so older records still show
    const legacyEarned   = deals.filter(d=>d.status==='completed'||d.status==='paid').reduce((s,d)=>s+(d.partnerShare||0),0);
    const legacyPaid     = deals.filter(d=>d.status==='paid').reduce((s,d)=>s+(d.partnerShare||0),0);
    const expectedTotal  = sharedProjects.reduce((s,p)=>s+partnerShare(p),0) + (legacyEarned);
    const realizedTotal  = paidProjects.reduce((s,p)=>s+partnerShare(p),0) + legacyPaid;
    const pendingTotal   = Math.max(0, expectedTotal - realizedTotal);
    const el = document.getElementById('partner-earnings-card');
    if (el) el.innerHTML = (sharedProjects.length||deals.length) ? `
      <div class="card" style="margin-bottom:14px;border:2px solid var(--primary)">
        <div class="card-header"><h3>${emojiIcon('💰',20)} My Earnings (50/50 Split)</h3><span style="font-size:11px;color:var(--text-muted)">From sales orders</span></div>
        <div class="card-body">
          <div class="kpi-row" style="margin-bottom:12px">
            <div class="kpi-card accent"><div class="kpi-label">Active Projects</div><div class="kpi-value">${activeProjects.length}</div></div>
            <div class="kpi-card green"><div class="kpi-label">Expected Earnings</div><div class="kpi-value" style="font-size:15px">₱${fmt(expectedTotal)}</div></div>
            <div class="kpi-card"><div class="kpi-label">Realized (Paid)</div><div class="kpi-value" style="font-size:15px">₱${fmt(realizedTotal)}</div></div>
            <div class="kpi-card" style="border-color:var(--warning)"><div class="kpi-label">Pending</div><div class="kpi-value" style="font-size:15px;color:var(--warning)">₱${fmt(pendingTotal)}</div></div>
          </div>
          ${sharedProjects.length?`<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">
            ${sharedProjects.slice(0,6).map(p=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;padding:6px 0;border-bottom:1px solid var(--border)">
              <div style="min-width:0;flex:1"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.clientName||p.projectNo||'Project')}</div><div style="color:var(--text-muted);font-size:11px">${escHtml(p.projectNo||'')} · ${p.stage==='paid'?`${emojiIcon('✅',16)} paid`:'in progress'}</div></div>
              <div style="text-align:right;flex-shrink:0"><div style="font-weight:700;color:var(--success)">₱${fmt(partnerShare(p))}</div><div style="color:var(--text-muted);font-size:10px">of ₱${fmt(Math.max(0,(p.contractAmount||0)-(p.capital||0)))} margin</div></div>
            </div>`).join('')}
          </div>`:''}
          <div style="font-size:12px;color:var(--text-muted);text-align:center">Your share = 50% of (contract − capital) per project. Factors are set by Barro.</div>
        </div>
      </div>` : '';
    if (window.lucide) lucide.createIcons({ nodes: [el] });

    const needsRevision   = quotes.filter(q=>q.status==='needs_revision'||q.approvalStatus==='needs_revision');
    const pendingApproval = quotes.filter(q=>q.status==='pending_approval'||q.approvalStatus==='pending_review'||q.status==='sent');
    const filedQuotes     = quotes.filter(q=>q.status==='filed'||q.approvalStatus==='approved');


    document.getElementById('partner-tasks-card').innerHTML = `
      <div class="card">
        <div class="card-header"><h3>${emojiIcon('📋',20)} My Tasks</h3><button class="btn-primary btn-sm" onclick="navigateTo('tasks')">All Tasks</button></div>
        <div class="card-body" style="padding:0">
          ${!open.length?`<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon('✅',44)}</div><p>No open tasks</p></div>`:
            open.slice(0,5).map(t=>{
              const isOverdue = t.dueDate && t.dueDate < todayStr;
              return `<div class="task-feed-item" style="cursor:pointer" onclick="window.openTaskDetail&&window.openTaskDetail('${t.id}',window.currentUser,window.currentRole)">
                <div class="task-feed-dot priority-dot-${t.priority||'medium'}"></div>
                <div style="flex:1;min-width:0"><div class="task-feed-title">${escHtml(t.title)}</div>${t.dueDate?`<div class="task-feed-meta" style="color:${isOverdue?'var(--danger)':'var(--text-muted)'}">Due ${t.dueDate}</div>`:''}</div>
                <span class="badge ${isOverdue?'badge-red':'badge-blue'}">${isOverdue?'Overdue':t.status||'open'}</span>
                ${(t.openFollowUpCount||0)>0?`<span class="badge badge-orange" style="margin-left:4px">${emojiIcon('📣',16)} ${t.openFollowUpCount}</span>`:''}
              </div>`;
            }).join('')}
        </div>
      </div>`;

    document.getElementById('partner-quotes-card').innerHTML = `
      ${needsRevision.length?`<div class="card" style="border:2px solid var(--warning);margin-bottom:10px">
        <div class="card-header" style="background:rgba(255,159,10,.08)">
          <h3 style="color:var(--warning)">${emojiIcon('↩',18)} Returned for Revision (${needsRevision.length})</h3>
          <button class="btn-primary btn-sm" onclick="navigateTo('bs-quotations')">View All</button>
        </div>
        <div class="card-body" style="padding:0">
          ${needsRevision.map(q=>`<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border)">
            <span style="font-size:18px">${emojiIcon('📝',18)}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600">${q.quoteNumber||q.id.slice(-8)} — ${escHtml(q.clientName||'Client')}</div>
              ${q.presidentNotes?`<div style="font-size:12px;color:var(--warning);margin-top:2px;font-style:italic">"${escHtml(q.presidentNotes)}"</div>`:'<div style="font-size:12px;color:var(--text-muted)">Open Quote Builder to revise and resubmit.</div>'}
            </div>
          </div>`).join('')}
        </div>
      </div>`:''}
      <div class="card">
        <div class="card-header"><h3>${emojiIcon('📋',20)} My Quotations</h3><button class="btn-primary btn-sm" onclick="navigateTo('bs-quotations')">All Quotes</button></div>
        <div class="card-body" style="padding:0">
          ${!quotes.length?`<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon('📄',44)}</div><p>No quotes yet. Use Quote Builder to create one.</p></div>`:
            quotes.slice(0,5).map(q=>{
              const amt = q.total||q.grandTotal||0;
              const ts  = q.createdAt?.toDate?q.createdAt.toDate().toLocaleDateString('en-PH',{month:'short',day:'numeric'}):'';
              const st  = q.status||q.approvalStatus||'draft';
              const bc  = st==='filed'||st==='approved'?'badge-green':st==='needs_revision'?'badge-orange':st==='pending_approval'||st==='pending_review'||st==='sent'?'badge-blue':'badge-gray';
              const ico = st==='filed'||st==='approved'?`${emojiIcon('✅',16)}`:st==='needs_revision'?`${emojiIcon('↩',16)}`:st==='pending_approval'||st==='sent'?`${emojiIcon('⏳',16)}`:`${emojiIcon('📄',16)}`;
              return `<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border)">
                <div style="font-size:20px">${ico}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:600">${escHtml(q.clientName||'Unknown Client')}</div>
                  <div style="font-size:11px;color:var(--text-muted)">${escHtml(q.quoteNumber||'')} · ${ts}</div>
                </div>
                <div style="text-align:right;flex-shrink:0">
                  <div style="font-size:13px;font-weight:700">₱${window.fmtN2(amt)}</div>
                  <span class="badge ${bc}" style="font-size:10px">${st}</span>
                </div>
              </div>`;
            }).join('')}
        </div>
      </div>`;
  } catch(e) {
    // 8-point #3 (Wave 7 Pass 6) — a failed fetch used to leave every card
    // (KPI/earnings/tasks/quotes) permanently blank with only a
    // console.warn — no visible feedback, no way to recover short of a full
    // re-navigation. Surface it in the earnings-card slot (first content
    // area below the intro cards) with a retry that re-runs this render.
    console.warn('[partnerDashboard]',e);
    const slot = document.getElementById('partner-earnings-card');
    if (slot) {
      slot.innerHTML = `<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load your dashboard data</h4><p>${escHtml(e.message||String(e))}</p><button type="button" class="btn-secondary btn-sm pdash-retry-btn" style="margin-top:14px">Retry</button></div>`;
      slot.querySelector('.pdash-retry-btn')?.addEventListener('click', () => renderPartnerDashboard());
      if (window.lucide) lucide.createIcons({ nodes: [slot] });
    }
  }
}

// ══════════════════════════════════════════════════
//  PARTNERS DEPARTMENT (admin-side oversight hub)
// ══════════════════════════════════════════════════
async function renderPartnersDept() {
  if (!isPresident() && currentRole !== 'manager') {
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('🔒',44)}</div><p>Admin access only</p></div>`;
    return;
  }
  const c = document.getElementById('page-content');
  const initSub = window.initialSubtab('overview');
  c.innerHTML = `
    <div class="page-header">
      <h2>${emojiIcon('🤝',20)} Partners</h2>
    </div>
    ${window.chipTabs([
      {key:'overview',label:'Overview'},
      {key:'deals',label:'Deals',icon:emojiIcon('💰',14)},
      {key:'tasks',label:'Tasks'},
      {key:'quotes',label:'Quotes'},
      {key:'quote-builder',label:'Quote Builder'},
      {key:'activity',label:'Activity'},
    ], initSub, {cls:'partners-dept-tabs'})}
    <div id="partners-dept-content">${window.skeletonHtml('rows')}</div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  window.bindChipTabs(c.querySelector('.partners-dept-tabs'), (key)=>{ window.setSubroute(key); loadPartnersDeptTab(key); });
  loadPartnersDeptTab(initSub);
}

async function loadPartnersDeptTab(sub) {
  const content = document.getElementById('partners-dept-content');
  content.innerHTML = window.skeletonHtml('rows');

  // 8-point #3 (Wave 7 Pass 6) — this fetch used to swallow every failure
  // into `{docs:[]}` per query, so a real permission/network error rendered
  // identically to "no partners/tasks/quotes yet" with no way to tell.
  // Surface it instead, with a retry that re-invokes this same load call.
  let usersSnap, tasksSnap, quotesSnap;
  try {
    ([usersSnap, tasksSnap, quotesSnap] = await Promise.all([
      db.collection('users').where('role','==','partner').get(),
      db.collection('tasks').where('department','==','Partners').get(),
      db.collection('bs_quotes').orderBy('createdAt','desc').limit(50).get()
    ]));
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load the Partners hub</h4><p>${escHtml(err.message||String(err))}</p><button type="button" class="btn-secondary btn-sm pdept-retry-btn" style="margin-top:14px">Retry</button></div>`;
    content.querySelector('.pdept-retry-btn')?.addEventListener('click', () => loadPartnersDeptTab(sub));
    if (window.lucide) lucide.createIcons({ nodes: [content] });
    return;
  }

  const partners = usersSnap.docs.map(d=>({id:d.id,...d.data()}));
  const tasks    = tasksSnap.docs.map(d=>({id:d.id,...d.data()}));
  const quotes   = quotesSnap.docs.map(d=>({id:d.id,...d.data()}));

  // Also get tasks assigned to any partner uid
  const partnerUids = partners.map(p=>p.id);

  switch(sub) {
    case 'deals': {
      let dealsSnap;
      try { dealsSnap = await db.collection('partner_deals').orderBy('createdAt','desc').get(); }
      catch (err) {
        content.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load deals</h4><p>${escHtml(err.message||String(err))}</p><button type="button" class="btn-secondary btn-sm pdeals-retry-btn" style="margin-top:14px">Retry</button></div>`;
        content.querySelector('.pdeals-retry-btn')?.addEventListener('click', () => loadPartnersDeptTab('deals'));
        if (window.lucide) lucide.createIcons({ nodes: [content] });
        return;
      }
      const deals = dealsSnap.docs.map(d=>({id:d.id,...d.data()}));
      const totalContractVal = deals.reduce((s,d)=>s+(d.totalContractValue||0),0);
      const totalProfit      = deals.reduce((s,d)=>s+(d.grossProfit||0),0);
      const totalPartnerPay  = deals.reduce((s,d)=>s+(d.partnerShare||0),0);
      const totalPaid        = deals.filter(d=>d.status==='paid').reduce((s,d)=>s+(d.partnerShare||0),0);
      content.innerHTML = `
        <div class="kpi-row" style="margin-bottom:14px">
          <div class="kpi-card accent"><div class="kpi-label">Total Deals</div><div class="kpi-value">${deals.length}</div></div>
          <div class="kpi-card"><div class="kpi-label">Contract Value</div><div class="kpi-value" style="font-size:14px">₱${fmt(totalContractVal)}</div></div>
          <div class="kpi-card green"><div class="kpi-label">Gross Profit</div><div class="kpi-value" style="font-size:14px">₱${fmt(totalProfit)}</div></div>
          <div class="kpi-card accent"><div class="kpi-label">Partner Share</div><div class="kpi-value" style="font-size:14px">₱${fmt(totalPartnerPay)}</div></div>
          <div class="kpi-card"><div class="kpi-label">Paid Out</div><div class="kpi-value" style="font-size:14px">₱${fmt(totalPaid)}</div></div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
          <button class="btn-primary btn-sm" id="add-deal-btn">+ New Deal</button>
        </div>
        ${!deals.length?`<div class="empty-state"><div class="empty-icon">${emojiIcon('🤝',44)}</div><p>No deals yet. Click "+ New Deal" to record a partner deal.</p></div>`:
          `<div class="card"><div class="card-body" style="padding:0">
            <div class="table-wrap"><table class="data-table table-cards">
              <thead><tr><th>Client</th><th>Partner</th><th>Contract</th><th>Cost</th><th>Profit</th><th>Share (50%)</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                ${deals.map(d=>{
                  const stColor = d.status==='paid'?'badge-green':d.status==='completed'?'badge-blue':d.status==='cancelled'?'badge-red':'badge-orange';
                  return `<tr>
                    <td style="font-weight:600">${escHtml(d.clientName||'—')}</td>
                    <td style="font-size:12px;color:var(--text-muted)">${escHtml(d.partnerName||'—')}</td>
                    <td>₱${fmt(d.totalContractValue||0)}</td>
                    <td>₱${fmt(d.costAmount||0)}</td>
                    <td style="color:var(--success)">₱${fmt(d.grossProfit||0)}</td>
                    <td style="font-weight:700;color:var(--primary-light)">₱${fmt(d.partnerShare||0)}</td>
                    <td><span class="badge ${stColor}">${d.status||'active'}</span></td>
                    <td>
                      ${d.status==='active'?`<button class="btn-secondary btn-xs" onclick="window._closeDeal('${d.id}')">Close</button>`:''}
                      ${d.status==='completed'?`<button class="btn-primary btn-xs" onclick="window._markDealPaid('${d.id}')">Mark Paid</button>`:''}
                    </td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table></div>
          </div></div>`}
      `;
      if (window.lucide) lucide.createIcons({ nodes: [content] });
      document.getElementById('add-deal-btn')?.addEventListener('click', () => _showAddDealModal(partners, () => loadPartnersDeptTab('deals')));
      window._closeDeal   = async (id) => { if(!await confirmDialog({ message: 'Mark this deal as completed?' })) return; await db.collection('partner_deals').doc(id).update({status:'completed'}); loadPartnersDeptTab('deals'); };
      window._markDealPaid = async (id) => { if(!await confirmDialog({ message: 'Mark partner share as paid out?', danger: true })) return; await db.collection('partner_deals').doc(id).update({status:'paid', paidOutDate: firebase.firestore.FieldValue.serverTimestamp()}); loadPartnersDeptTab('deals'); };
      break;
    }
    case 'overview': {
      const openTasks = tasks.filter(t=>!['done','approved','archived'].includes(t.status));
      const doneTasks = tasks.filter(t=>t.status==='done'||t.status==='approved');
      const totalQuoteVal = quotes.reduce((s,q)=>s+(q.total||q.grandTotal||0),0);
      const pendingQuotes = quotes.filter(q=>q.status==='pending'||q.status==='submitted');
      content.innerHTML = `
        <div class="kpi-row" style="margin-bottom:16px">
          <div class="kpi-card accent"><div class="kpi-label">Partners</div><div class="kpi-value">${partners.length}</div></div>
          <div class="kpi-card"><div class="kpi-label">Open Tasks</div><div class="kpi-value">${openTasks.length}</div></div>
          <div class="kpi-card green"><div class="kpi-label">Done Tasks</div><div class="kpi-value">${doneTasks.length}</div></div>
          <div class="kpi-card accent"><div class="kpi-label">Total Quote Value</div><div class="kpi-value">₱${window.fmtN2(totalQuoteVal)}</div></div>
          <div class="kpi-card"><div class="kpi-label">Pending Quotes</div><div class="kpi-value">${pendingQuotes.length}</div></div>
        </div>
        <div class="card" style="margin-bottom:14px">
          <div class="card-header"><h3>${emojiIcon('👥',20)} Partner Accounts</h3>
            <button class="btn-primary btn-sm" onclick="navigateTo('team-directory')">Manage Team</button>
          </div>
          <div class="card-body" style="padding:0">
            ${!partners.length?'<div class="empty-state" style="padding:20px"><p>No partner accounts yet.</p></div>':
              partners.map(p=>{
                const pTasks = tasks.filter(t=>Array.isArray(t.assignedTo)?t.assignedTo.includes(p.id):t.assignedTo===p.id);
                const pDone  = pTasks.filter(t=>t.status==='done'||t.status==='approved').length;
                const pOpen  = pTasks.filter(t=>!['done','approved','archived'].includes(t.status)).length;
                const pPct   = pTasks.length ? Math.round(pDone/pTasks.length*100) : 0;
                const lastSeen = p.lastSeen?.toDate ? p.lastSeen.toDate() : null;
                const minsAgo  = lastSeen ? Math.floor((Date.now()-lastSeen)/60000) : null;
                const onlineDot = minsAgo!==null&&minsAgo<5 ? 'var(--presence-online)' : 'var(--presence-off)';
                return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border)">
                  <div style="position:relative">
                    <div style="width:38px;height:38px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:var(--white,#fff)">
                      ${p.photoUrl?`<img src="${escHtml(p.photoUrl)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`:(p.displayName||'?')[0].toUpperCase()}
                    </div>
                    <div style="position:absolute;bottom:0;right:0;width:10px;height:10px;border-radius:50%;background:${onlineDot};border:2px solid var(--surface)"></div>
                  </div>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:13px;font-weight:700">${escHtml(p.displayName||p.email)}</div>
                    <div style="font-size:11px;color:var(--text-muted)">${escHtml(p.email||'')} ${lastSeen?'· Last seen '+(minsAgo<60?minsAgo+'m ago':Math.floor(minsAgo/60)+'h ago'):''}</div>
                  </div>
                  <div style="text-align:right;flex-shrink:0">
                    <div style="font-size:11px;color:var(--text-muted)">Tasks: ${pOpen} open · ${pDone} done</div>
                    <span class="badge ${pPct>=80?'badge-green':pPct>=50?'badge-orange':'badge-red'}" style="font-size:10px">${pPct}% KPI</span>
                  </div>
                </div>`;
              }).join('')}
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3>${emojiIcon('📋',20)} Recent Tasks</h3>
            <button class="btn-primary btn-sm" onclick="document.querySelector('[data-sub=tasks]').click()">All Tasks</button>
          </div>
          <div class="card-body" style="padding:0">
            ${!tasks.length?'<div class="empty-state" style="padding:20px"><p>No tasks yet. Assign tasks with department = Partners.</p></div>':
              tasks.slice(0,5).map(t=>`<div class="task-feed-item">
                <div class="task-feed-dot priority-dot-${t.priority||'medium'}"></div>
                <div style="flex:1;min-width:0"><div class="task-feed-title">${escHtml(t.title)}</div>
                <div class="task-feed-meta">${t.dueDate?'Due '+t.dueDate:''}</div></div>
                ${window.statusBadge2 ? window.statusBadge2('task', t.status||'open') : `<span class="badge ${t.status==='done'||t.status==='approved'?'badge-green':t.status==='review'?'badge-orange':'badge-blue'}">${t.status||'open'}</span>`}
                ${(t.openFollowUpCount||0)>0?`<span class="badge badge-orange" style="margin-left:4px">${emojiIcon('📣',16)} ${t.openFollowUpCount}</span>`:''}
              </div>`).join('')}
          </div>
        </div>
      `;
      if (window.lucide) lucide.createIcons({ nodes: [content] });
      break;
    }
    case 'tasks': {
      content.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <span style="font-size:13px;color:var(--text-muted)">${tasks.length} task${tasks.length!==1?'s':''} in Partners dept</span>
          <button class="btn-primary btn-sm" onclick="navigateTo('tasks')">+ New Task</button>
        </div>
        ${!tasks.length?`<div class="empty-state"><div class="empty-icon">${emojiIcon('📋',44)}</div><p>No tasks yet. Create tasks and set department to "Partners".</p></div>`:
          `<div class="card"><div class="card-body" style="padding:0">
            ${tasks.map(t=>`<div class="task-feed-item" style="cursor:pointer" onclick="window.openTaskDetail&&window.openTaskDetail('${t.id}',window.currentUser,window.currentRole)">
              <div class="task-feed-dot priority-dot-${t.priority||'medium'}"></div>
              <div style="flex:1;min-width:0">
                <div class="task-feed-title">${escHtml(t.title)}</div>
                <div class="task-feed-meta">${Array.isArray(t.assignedToNames)&&t.assignedToNames.length?`${emojiIcon('👥',16)} `+escHtml(t.assignedToNames.join(', ')):''} ${t.dueDate?'· Due '+t.dueDate:''}</div>
              </div>
              ${window.statusBadge2 ? window.statusBadge2('task', t.status||'open') : `<span class="badge ${t.status==='done'||t.status==='approved'?'badge-green':t.status==='review'?'badge-orange':t.status==='overdue'?'badge-red':'badge-blue'}">${t.status||'open'}</span>`}
              ${(t.openFollowUpCount||0)>0?`<span class="badge badge-orange" style="margin-left:4px">${emojiIcon('📣',16)} ${t.openFollowUpCount}</span>`:''}
            </div>`).join('')}
          </div></div>`}
      `;
      if (window.lucide) lucide.createIcons({ nodes: [content] });
      break;
    }
    case 'quotes': {
      const totalVal = quotes.reduce((s,q)=>s+(q.total||q.grandTotal||0),0);
      const approved = quotes.filter(q=>q.status==='approved');
      const pending  = quotes.filter(q=>q.status==='pending'||q.status==='submitted');
      content.innerHTML = `
        <div class="kpi-row" style="margin-bottom:14px">
          <div class="kpi-card accent"><div class="kpi-label">Total Quotes</div><div class="kpi-value">${quotes.length}</div></div>
          <div class="kpi-card green"><div class="kpi-label">Approved</div><div class="kpi-value">${approved.length}</div></div>
          <div class="kpi-card"><div class="kpi-label">Pending</div><div class="kpi-value">${pending.length}</div></div>
          <div class="kpi-card accent"><div class="kpi-label">Pipeline Value</div><div class="kpi-value" style="font-size:16px">₱${window.fmtN2(totalVal)}</div></div>
        </div>
        ${!quotes.length?`<div class="empty-state"><div class="empty-icon">${emojiIcon('📄',44)}</div><p>No quotes yet.</p></div>`:
          `<div class="card"><div class="card-body" style="padding:0">
            <div class="table-wrap"><table class="data-table table-cards">
              <thead><tr><th>Client</th><th>Created By</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
              <tbody>
                ${quotes.map(q=>{
                  const ts = q.createdAt?.toDate?q.createdAt.toDate().toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}):'';
                  const amt = q.total||q.grandTotal||0;
                  return `<tr>
                    <td style="font-size:13px;font-weight:600">${escHtml(q.clientName||q.client||'—')}</td>
                    <td style="font-size:12px;color:var(--text-muted)">${escHtml(q.createdByName||'—')}</td>
                    <td style="font-size:13px;font-weight:600">₱${window.fmtN2(amt)}</td>
                    <td><span class="badge ${q.status==='approved'?'badge-green':q.status==='pending'||q.status==='submitted'?'badge-orange':'badge-gray'}">${q.status||'draft'}</span></td>
                    <td style="font-size:11px;color:var(--text-muted)">${ts}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table></div>
          </div></div>`}
      `;
      if (window.lucide) lucide.createIcons({ nodes: [content] });
      break;
    }
    case 'quote-builder': {
      content.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <span style="font-size:13px;color:var(--text-muted)">Create quotes for partner projects. Print/PDF when ready.</span>
          <button class="btn-secondary btn-sm" onclick="document.getElementById('partners-qb-frame').contentWindow.print()">${emojiIcon('🖨',16)} Print / PDF</button>
        </div>
        <iframe id="partners-qb-frame" src="quote-builder-v2.html"
          style="width:100%;height:calc(100dvh - 200px);min-height:500px;border:none;border-radius:12px;background:#f5f6fa;"
          allow="print" loading="lazy"></iframe>`;
      if (window.lucide) lucide.createIcons({ nodes: [content] });
      break;
    }
    case 'activity': {
      // Show recent notifications/actions from partner accounts.
      // Re-audit 2026-08-03: this used to slice to the first 5 partners BEFORE
      // fetching, off an unordered users query — so which partners' activity
      // showed up was arbitrary Firestore document order, and any partner past
      // #5 never appeared at all, with no indication anything was cut off. Fetch
      // every partner's recent items (still capped per-partner at limit(5)); the
      // final .slice(0,20) below already bounds the merged, globally-sorted list.
      const notifPromises = partners.map(p =>
        db.collection('notifications').doc(p.id).collection('items')
          .orderBy('createdAt','desc').limit(5).get().catch(()=>({docs:[]}))
          .then(snap => snap.docs.map(d=>({...d.data(), partnerName: p.displayName||p.email})))
      );
      const allNotifArrays = await Promise.all(notifPromises);
      const allActivity = allNotifArrays.flat().sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)).slice(0,20);
      content.innerHTML = `
        <div class="card"><div class="card-header"><h3>${emojiIcon('📡',20)} Recent Partner Activity</h3></div>
          <div class="card-body" style="padding:0">
            ${!allActivity.length?'<div class="empty-state" style="padding:20px"><p>No recent activity.</p></div>':
              allActivity.map(n=>{
                const ts = n.createdAt?.toDate?n.createdAt.toDate().toLocaleString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
                return `<div style="display:flex;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border);align-items:flex-start">
                  <div style="font-size:20px">${n.icon||`${emojiIcon('🔔',16)}`}</div>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:12px;font-weight:600;color:var(--primary-light)">${escHtml(n.partnerName)}</div>
                    <div style="font-size:13px;font-weight:600">${escHtml(n.title||'')}</div>
                    <div style="font-size:12px;color:var(--text-muted)">${escHtml(n.body||'')}</div>
                    <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${ts}</div>
                  </div>
                </div>`;
              }).join('')}
          </div>
        </div>
      `;
      if (window.lucide) lucide.createIcons({ nodes: [content] });
      break;
    }
  }
}

// ── Partner Deal Modal ────────────────────────────
function _showAddDealModal(partners, onSaved) {
  const partnerOpts = partners.map(p=>`<option value="${p.id}">${escHtml(p.displayName||p.email)}</option>`).join('');
  const modal = document.createElement('div');
  modal.className = 'modal-overlay active';
  modal.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-header"><h3>${emojiIcon('🤝',20)} New Partner Deal</h3><button class="modal-close" id="deal-modal-close" aria-label="Close">${emojiIcon('✕',16)}</button></div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
        <div><label class="form-label">Client Name *</label><input class="form-input" id="dl-client" placeholder="e.g. Gerry's Grill Bulacan"/></div>
        <div><label class="form-label">Project Description</label><input class="form-input" id="dl-desc" placeholder="e.g. Full kitchen setup with exhaust system"/></div>
        <div><label class="form-label">Partner *</label><select class="form-input" id="dl-partner"><option value="">— Select Partner —</option>${partnerOpts}</select></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div><label class="form-label">Total Contract Value (₱) *</label><input class="form-input" id="dl-contract" type="number" inputmode="decimal" min="0" placeholder="0"/></div>
          <div><label class="form-label">Project Cost to BI (₱) *</label><input class="form-input" id="dl-cost" type="number" inputmode="decimal" min="0" placeholder="0"/></div>
        </div>
        <div id="dl-calc" style="background:var(--surface-2);border-radius:10px;padding:12px;font-size:13px;display:none">
          <div style="display:flex;justify-content:space-between"><span>Gross Profit:</span><span id="dl-gross" style="font-weight:700;color:var(--success)">₱0</span></div>
          <div style="display:flex;justify-content:space-between;margin-top:6px"><span>Partner Share (50%):</span><span id="dl-share" style="font-weight:700;color:var(--primary-light)">₱0</span></div>
        </div>
        <div><label class="form-label">Notes</label><textarea class="form-input" id="dl-notes" rows="2" placeholder="Any additional notes…"></textarea></div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="deal-modal-cancel">Cancel</button>
        <button class="btn-primary" id="deal-modal-save">Save Deal</button>
      </div>
    </div>`;
  if (window.lucide) lucide.createIcons({ nodes: [modal] });
  document.body.appendChild(modal);
  const close = () => { modal.remove(); };
  document.getElementById('deal-modal-close').onclick = close;
  document.getElementById('deal-modal-cancel').onclick = close;
  const updateCalc = () => {
    const contract = parseFloat(document.getElementById('dl-contract').value)||0;
    const cost     = parseFloat(document.getElementById('dl-cost').value)||0;
    const gross    = contract - cost;
    const share    = gross * 0.5;
    const calc = document.getElementById('dl-calc');
    if (contract > 0 || cost > 0) {
      calc.style.display = 'block';
      document.getElementById('dl-gross').textContent = '₱'+fmt(Math.max(0,gross));
      document.getElementById('dl-share').textContent = '₱'+fmt(Math.max(0,share));
    } else { calc.style.display = 'none'; }
  };
  document.getElementById('dl-contract').addEventListener('input', updateCalc);
  document.getElementById('dl-cost').addEventListener('input', updateCalc);
  document.getElementById('deal-modal-save').onclick = async () => {
    const clientName = document.getElementById('dl-client').value.trim();
    const partnerSel = document.getElementById('dl-partner');
    const partnerUid = partnerSel.value;
    const partnerName = partnerSel.options[partnerSel.selectedIndex]?.text || '';
    const contract = parseFloat(document.getElementById('dl-contract').value)||0;
    const cost     = parseFloat(document.getElementById('dl-cost').value)||0;
    if (!clientName) { Notifs.showToast('Client name is required','error'); return; }
    if (!partnerUid) { Notifs.showToast('Select a partner','error'); return; }
    if (!contract)  { Notifs.showToast('Enter total contract value','error'); return; }
    const gross = contract - cost;
    const share = Math.max(0, gross * 0.5);
    const btn = document.getElementById('deal-modal-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await db.collection('partner_deals').add({
        clientName, projectDescription: document.getElementById('dl-desc').value.trim(),
        partnerUid, partnerName: partnerName.replace(/^— .* —$/, '').trim(),
        totalContractValue: contract, costAmount: cost,
        grossProfit: gross, partnerShare: share,
        status: 'active', notes: document.getElementById('dl-notes').value.trim(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: currentUser.uid
      });
      Notifs.showToast('Deal saved successfully','success');
      // Notify the partner
      safeNotify(()=>Notifs.send(partnerUid,{
        title:'🤝 New Deal Registered',
        body:`President registered a new deal: ${clientName}. Your 50% share: ₱${fmt(share)}.`,
        icon:'🤝', type:'partner_deal', link:'partner-projects'
      }));
      close(); onSaved?.();
    } catch(e) { btn.disabled=false; btn.textContent='Save Deal'; Notifs.showToast('Error: '+e.message,'error'); }
  };
}
