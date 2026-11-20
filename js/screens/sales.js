/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Sales + AEC + Quotations screens
   js/screens/sales.js

   Wave 7 Pass 2 — split out of js/departments.js verbatim, 2026-08-03,
   following the Wave 2 (design.js) / Wave 7 Pass 1 (tasks.js) extraction
   protocol. Still plain `window.*`-attached globals, no ESM, no bundler —
   this file is a physical split only, not a module.

   Contents: the Sales portal (renderSales/salesSubNav/loadSalesContent),
   Quick Estimate (the qe-prefixed helpers + renderQuickEstimate), the Sales SOP editor
   (renderSalesSOP/renderSalesSOPView/renderSalesSOPEditor/
   drawSalesSOPEditor/salesSopGatherDOM/salesSopSave), the AEC partner
   directory (AEC_TYPES/AEC_STAGES/AEC_TERMINAL/AEC_REGIONS/aecTypeMeta/
   aecStageOf/aecStageMeta/aecContacted/aecProspected/nextAECNumber/
   renderAECDirectory incl. its local openAECDetail/openAECPrintSheet), the
   BK/BS quotation-list builders (latestQuoteRevisions/
   renderBKQuotationsSummary/renderSalesBSQuotes/
   renderBSQuotationsSummary/bindQuoteActions), and the Wave 7 Pass 2 net-new
   feature — the revision-chain UI (buildQuoteChains/quoteRevDeltaHtml/
   quoteChainToggleHtml/quoteChainHistoryRows, wired into all three
   quote-list renderers above).

   DELIBERATELY LEFT IN departments.js (grepped for outside callers before
   this move):
     - openBillingInvoice / buildBillingInvoiceHTML / downloadJPEG — sit
       physically between the old Sales and IT sections but are Design
       project-billing helpers (js/screens/design.js's renderProjFinancials
       calls window.openBillingInvoice — see that file's header), unrelated
       to Sales. Untouched by this move.
     - nextCounterId — the generic `_counters/{name}` atomic-sequence
       helper AEC's nextAECNumber is built on top of; also used by
       job_projects (departments.js ~11881) and production_orders
       (~12852), so it stays a shared departments.js helper. nextAECNumber
       itself (AEC-only caller) moved here and still calls the global
       nextCounterId-adjacent pattern inline (it doesn't actually call
       nextCounterId — it has its own tiny transaction — so there is no
       cross-file dependency here at all).
     - renderSalesOrders / openSalesOrderModal / openRecordSaleModal /
       transferOrderToProduction / order-tracking utils (orderTrackUrl,
       makeTrackCode, uniqueTrackCode, showOrderTrackModal,
       syncOrderTracking, ensureOrderTracking) — these back BOTH the BK/BS
       "Sales Order" quote-card buttons AND Finance's own "Sales Orders"
       subtab (departments.js loadFinanceContent, case 'Sales Orders'), so
       they're a shared service, not a Sales screen. bindQuoteActions here
       still calls window-global openSalesOrderModal by bare identifier;
       resolves fine at runtime regardless of file (same forward-reference
       pattern documented in tasks.js/design.js).
     - renderBSClientData / renderBSFiles / renderBrilliantSteel /
       loadBSContent — Brilliant Steel department screens (Wave 7 Pass 6,
       partners.js). loadBSContent's 'Quotations Summary' case calls this
       file's renderBSQuotationsSummary as a bare global identifier — same
       cross-file, runtime-only resolution.
     - renderApprovals (+ approveQuoteApproval/returnQuoteToPartner/
       openQuoteApprovalReview) — stays with Approvals per the Pass 1
       precedent; it calls window.reopenQuoteFromDoc/newRevisionFromDoc
       (app.js) directly, not anything in this file.
     - renderClientProfiles/renderFileCollection/bindFileCollection/
       renderDocCollection/CRM_STAGES — shared client/file-collection
       renderers used by every department, not Sales-specific.
     - reopenQuoteFromDoc / newRevisionFromDoc (js/app.js) — per the task
       brief, these stay in app.js. They stamp rootQuoteId/parentQuoteId
       (Wave 3 Q5) onto the builder's reopened state; this file's
       revision-chain UI only READS those two fields off already-fetched
       quote docs, never writes them.

   LOAD-ORDER CONTRACT (see index.html + CLAUDE.md "Script load order
   is load-bearing"):
     - Loads AFTER js/departments.js and js/screens/design.js/tasks.js.
       Every function in this file is invoked only at runtime (click
       handlers, navigateTo() dispatch, promise callbacks) — never at parse
       time — so it is safe for departments.js's shared helpers (canEditDept,
       deptContainer, fmt, today, statusBadge, escHtml, emojiIcon,
       skeletonHtml, chipTabs/bindChipTabs, renderClientProfiles,
       renderFileCollection, bindFileCollection, renderDeptTasks,
       openSalesOrderModal, dbCachedGet, etc.) to still be undefined at the
       moment THIS file's top-level code runs, and equally safe for
       departments.js's renderBrilliantSteel/loadBSContent (which load
       BEFORE this file but only call into it later, at runtime) to
       reference this file's globals.
     - window.renderSales is the entry point called from outside this file
       (js/app.js navigateTo() switch, case 'Sales'; and the 'bk-quotations'
       deep-link, which calls window.renderSales?.(user, role, 'Quotes')).
     - window.latestQuoteRevisions is also window-attached for external
       callers (was already exported pre-move).
     - window.AEC_TYPES / AEC_STAGES / AEC_TERMINAL / AEC_REGIONS are
       plain `window.X = [...]` assignments (not bare consts), so they were
       already globally readable pre-move and remain so — js/notifications.js
       (checkAECFollowups) reads window.AEC_TERMINAL defensively at call
       time, and js/ui-status-meta.js lazily reads window.AEC_STAGES; both
       resolve correctly regardless of load order since neither is
       dereferenced until well after all page scripts have run.
     - SALES_SOP_ORANGE / DEFAULT_SALES_SOP / CRM-unrelated locals and
       aecTypeMeta/aecStageOf/aecStageMeta/aecContacted/aecProspected are
       plain top-level `const`/`function` declarations (script-scoped for
       const; function declarations DO attach to window in a classic,
       non-module script) — same caveat design.js documents for
       DRAWING_STATUSES. They stay in THIS file alongside every function
       that reads them.
   ═══════════════════════════════════════════════════ */

window.renderSales = async function(currentUser, currentRole, subtab = window.initialSubtab('Clients')) {
  window._bkCurrentUser = currentUser;
  window._bkCurrentRole = currentRole;
  const c = deptContainer();
  // 'Analytics' (owner ruling 2026-09-01: "in addition to it being in their
  // drawer it should also be in sales department page") embeds the same
  // sales-scoped view renderSalesAnalytics() serves on the Analytics page —
  // quota to meet, OH to cover, floor, pace and the discount signal.
  const salesTabs = ['Clients','Briefs','Quote requests','Quotes','Won','Analytics','Brilliant Steel','Files','SOP','Budgeting','Tasks'];
  // Legacy deep-link keys → new consolidated tab.
  const alias = { 'BK Quotes':'Quotes', 'Quotations':'Quotes', 'Quick Estimate':'Quotes',
                  'Partner':'Brilliant Steel', 'Partner Quotes':'Brilliant Steel', 'Partner Files':'Brilliant Steel',
                  'Work Plans':'Files', 'Proposals':'Files',
                  'Client Briefs':'Briefs', 'Client Information Requests':'Briefs', 'Info Requests':'Briefs',
                  'Quote Requests':'Quote requests', 'QuoteRequests':'Quote requests',
                  'Projects':'Won', 'Won / Projects':'Won', 'Won jobs':'Won' };
  subtab = alias[subtab] || (salesTabs.includes(subtab) ? subtab : 'Clients');
  c.innerHTML = `
    <div class="page-header">
      <div>
        <h2>${emojiIcon('🍽️',20)} Barro Kitchens — Sales</h2>
        <p style="font-size:12px;color:var(--text-muted);margin:2px 0 0">Inquiry → Quote → Approval → Payment → Sales Order → Delivery</p>
      </div>
    </div>
    ${window.sopPanel('How Sales works', [
      'Clients is the CRM book. Log every inquiry here the same day, with its source. The architect / engineer / contractor prospecting directory lives in the CRM department.',
      'Briefs holds the Client Information forms from barroindustries.com, and Quote requests holds the "Get a quote" requests from the catalogue. Review the answers, then Convert to client. On a quote request, Open in Quote Builder to price it.',
      'Quotes: tap ＋ New Quotation to open the quote builder, always from here (the standalone page is preview only and cannot file). The Barro Kitchens configurators are on: pick the area tab, Configure the product, then Add to Quote. Prices come from the Standard Price List; use Add custom item for anything else. Quick Estimate is only a rough price check.',
      'Every quote needs the President\'s approval. In the builder tap Verify & File, then Send for approval (get the link), and send the link to him by Messenger or Viber. He approves it in Approvals and you are notified.',
      'Filed quotes land in Records. For the client copy of an approved quote, Reopen it, Verify & File with Update the original quote in place, then PDF ▾ → Download PDF. On each quote: Mark sent when it goes out, Lost (with a reason) when the client says no, New Revision for any change.',
      'When the client pays, tap Record payment on the quote. The President confirms it in the app (Finance may confirm when he cannot be reached). Then open Sales Orders and tap Generate SO & JO to hand the job to Production.',
      'Won / Projects lists every won job from the moment its payment is recorded (the same records as the Projects page): client, quote number, amount, stage, payments and balance. Tap Open for the full project folder.',
      'Brilliance Steel is a read-only window into that company\'s quotes and files, for coordination.',
      'Analytics shows your month against its quota. Files holds Work Plans and Proposals. SOP is the full step-by-step process. Tasks is the department board.'
    ])}
    ${window.chipTabs(salesTabs.map(s=>({key:s,label: s==='Won' ? 'Won / Projects' : s==='Brilliant Steel' ? 'Brilliance Steel' : s})), subtab)}
    <div id="sales-content">${window.skeletonHtml('rows')}</div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  // Bind the OUTER bar first: loadSalesContent can render inner sub-nav chips,
  // and binding afterwards would also attach this outer handler to those.
  window.bindChipTabs(c, (key) => { window.setSubroute(key); loadSalesContent(currentUser, currentRole, key); });
  loadSalesContent(currentUser, currentRole, subtab);
};

// Scoped inner sub-nav (chip toggle) for a consolidated Sales tab. Binds ONLY
// its own buttons (not the outer Sales chip bar, nor any chips a sub-view
// renders) by querying inside the dedicated `.sales-subnav` bar element.
function salesSubNav(content, keys, active, headerHtml, onSelect) {
  const chips = keys.map(k =>
    `<button type="button" class="chip-tab${k===active?' active':''}" data-chip="${escHtml(k)}">${escHtml(k)}</button>`
  ).join('');
  content.innerHTML = `
    ${headerHtml || ''}
    <div class="chip-tabs sales-subnav" style="margin-bottom:12px">${chips}</div>
    <div id="sales-subview">${window.skeletonHtml('rows')}</div>`;
  const bar = content.querySelector('.sales-subnav');
  const view = content.querySelector('#sales-subview');
  bar.querySelectorAll('.chip-tab').forEach(btn => btn.addEventListener('click', () => {
    bar.querySelectorAll('.chip-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    onSelect(btn.dataset.chip, view);
  }));
  onSelect(active, view);
  if (window.lucide) lucide.createIcons({ nodes: [content] });
}

async function loadSalesContent(currentUser, currentRole, sub) {
  const content = document.getElementById('sales-content');
  if (!content) return;
  switch(sub) {
    case 'Clients':
      await renderClientProfiles(content, currentUser, currentRole, 'barro');
      break;

    case 'Briefs':
      if (window.renderClientBriefs) await window.renderClientBriefs(content, currentUser, currentRole);
      else content.innerHTML = window.renderEmptyState({ icon: '⚠️', title: 'Briefs screen not loaded', hint: 'Reload the app and try again.' });
      break;

    case 'Quote requests':
      if (window.renderQuoteRequests) await window.renderQuoteRequests(content, currentUser, currentRole);
      else content.innerHTML = window.renderEmptyState({ icon: '⚠️', title: 'Quote requests screen not loaded', hint: 'Reload the app and try again.' });
      break;

    case 'Won':
      await renderSalesWonProjects(content, currentUser, currentRole);
      break;

    case 'Analytics':
      // dashboards.js is an eager bundle, so this global is always present.
      await window.renderSalesAnalytics(content);
      break;

    case 'Quotes': {
      // One tab, all three quote paths. "＋ New Quotation" opens the full
      // builder; Quick Estimate is a fast price-check that hands off to it;
      // Records lists everything filed (with New Revision / Reopen).
      const header = `
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:12px">
          <button class="btn-primary btn-sm" onclick="navigateTo('bk-quote-builder')">＋ New Quotation</button>
          <span style="font-size:12px;color:var(--text-muted)">Build every quote here: the Barro Kitchens configurators are on, and the President approves each quote before it goes out. Filed &amp; revised quotes live under <strong>Records</strong> (Mark sent · Record payment · Lost · New Revision). <strong>Quick Estimate</strong> is only a rough price check.</span>
        </div>`;
      salesSubNav(content, ['Records','Quick Estimate'], 'Records', header, (key, view) => {
        if (key === 'Quick Estimate') renderQuickEstimate(view, currentUser, currentRole);
        else renderBKQuotationsSummary(view, currentUser, currentRole);
      });
      break;
    }

    case 'Brilliant Steel':
      salesSubNav(content, ['Quotes','Files'], 'Quotes',
        `<div style="font-size:12px;color:var(--text-muted);background:rgba(15,108,189,.06);border:1px solid var(--border);border-radius:10px;padding:8px 12px;margin-bottom:12px">${emojiIcon('🤝',16)} Brilliance Steel — quotes &amp; files shared with Sales for coordination.</div>`,
        (key, view) => {
          if (key === 'Files') renderBSFiles(view, currentUser, currentRole);
          else renderSalesBSQuotes(view, currentUser, currentRole);
        });
      break;

    case 'Files':
      salesSubNav(content, ['Work Plans','Proposals'], 'Work Plans', '', (key, view) => {
        if (key === 'Proposals') {
          view.innerHTML = renderFileCollection('Proposals', 'sales-props', currentRole);
          bindFileCollection('sales-props', currentUser, 'Sales', 'Proposals');
        } else {
          renderDocCollection(view, 'work_plans', 'Work Plans', currentUser, currentRole, { icon:'📋', color:'#e65100', dept:'Sales' });
        }
      });
      break;

    case 'SOP':
      renderSalesSOP(content);
      break;

    case 'Budgeting':
      await window.renderBudgeting(content, currentUser, currentRole, 'Sales');
      break;

    case 'Tasks':
      await renderDeptTasks(content, 'Sales', currentUser, currentRole);
      break;
  }
}

// ══════════════════════════════════════════════════
//  SALES — WON / PROJECTS (owner, 2026-11-20: "we have a lot of clients won
//  right now, theyre in the projects tab. i want it to be shown in sales
//  department too")
//  A read-only Sales window onto the SAME job_projects records the Projects
//  page (renderProjectLifecycle, js/screens/production.js) shows — nothing is
//  copied or written here. The linked sales_orders are read only to show the
//  order's payment state (SalesFlow.orderState). Rules: job_projects and
//  sales_orders are readable by any staff with a profile, so no rules change.
//  Money follows the Projects page: a Production-only viewer never sees it
//  (isProductionOnlyViewer, production.js — in the dept:Sales bundle; if it is
//  somehow missing, money stays hidden).
// ══════════════════════════════════════════════════
const WON_FILTERS = [
  { key:'active',    label:'Active',         test:p=>!['paid','cancelled'].includes(p.stage) },
  { key:'won',       label:'Won',            test:p=>p.stage==='won' },
  { key:'in_design', label:'In Design',      test:p=>p.stage==='in_design' },
  { key:'in_production', label:'In Production', test:p=>p.stage==='in_production' },
  { key:'delivery',  label:'For Delivery / Delivered', test:p=>p.stage==='for_delivery'||p.stage==='delivered' },
  { key:'completed', label:'Completed',      test:p=>p.stage==='completed' },
  { key:'paid',      label:'Paid / Closed',  test:p=>p.stage==='paid' },
  { key:'cancelled', label:'Cancelled',      test:p=>p.stage==='cancelled' },
  { key:'all',       label:'All',            test:()=>true },
];

async function renderSalesWonProjects(content, currentUser, currentRole) {
  content.innerHTML = window.skeletonHtml('rows');
  const showMoney = typeof isProductionOnlyViewer === 'function' && !isProductionOnlyViewer();
  let projects;
  try {
    const snap = await db.collection('job_projects').orderBy('createdAt','desc').get();
    projects = snap.docs.map(d=>({ id:d.id, ...d.data() }));
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load the won jobs</h4><p>${escHtml(err.message||String(err))}</p><button type="button" class="btn-secondary btn-sm won-retry-btn" style="margin-top:14px">Retry</button></div>`;
    content.querySelector('.won-retry-btn')?.addEventListener('click', ()=>renderSalesWonProjects(content, currentUser, currentRole));
    return;
  }
  if ((typeof isBrilliantOnly==='function') && isBrilliantOnly()) projects = projects.filter(p=>p.createdBy===currentUser.uid);
  // The order behind each job (one sales order per quote chain) — soft-fail: the list still shows without it.
  const soByProject = new Map();
  try {
    const sos = await db.collection('sales_orders').get();
    sos.docs.forEach(d=>{ const o={ id:d.id, ...d.data() }; if (o.projectId && !soByProject.has(o.projectId)) soByProject.set(o.projectId, o); });
  } catch(_) {}

  const stageOf = id => (window.JOB_STAGES||[]).find(s=>s.id===id) || { id, label:id||'—', icon:'', color:'#78909c' };
  const balOf = p => Math.max(0, (Number(p.contractAmount)||0) - (Number(p.amountCollected)||0));
  const dateOf = v => { const d = v?.toDate ? v.toDate() : (v ? new Date(v) : null); return d && !isNaN(d) ? d.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : ''; };
  const live = projects.filter(p=>p.stage!=='cancelled');
  const kContract = live.reduce((s,p)=>s+(Number(p.contractAmount)||0),0);
  const kCollected = live.reduce((s,p)=>s+(Number(p.amountCollected)||0),0);
  const kBalance = live.reduce((s,p)=>s+balOf(p),0);
  const activeCount = projects.filter(WON_FILTERS[0].test).length;

  let filter = 'active', q = '';
  content.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px">
      <span style="font-size:12px;color:var(--text-muted)">Every won job, from the moment its payment is recorded: the same records as the Projects page. Tap <strong>Open</strong> for the full project folder.</span>
      <button type="button" class="btn-secondary btn-sm" onclick="navigateTo('projects-lifecycle')">Open the Projects board →</button>
    </div>
    <div class="kpi-row" style="margin-bottom:14px">
      <div class="kpi-card"><div class="kpi-label">Won jobs</div><div class="kpi-value">${live.length}</div></div>
      <div class="kpi-card accent"><div class="kpi-label">Active</div><div class="kpi-value">${activeCount}</div></div>
      ${showMoney ? `
      <div class="kpi-card"><div class="kpi-label">Contract value</div><div class="kpi-value" style="font-size:15px">₱${fmt(kContract)}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Collected</div><div class="kpi-value" style="font-size:15px">₱${fmt(kCollected)}</div></div>
      <div class="kpi-card ${kBalance>0?'warn':''}"><div class="kpi-label">Balance due</div><div class="kpi-value" style="font-size:15px">₱${fmt(kBalance)}</div></div>` : ''}
    </div>
    <div style="margin-bottom:10px"><input type="text" class="ms-input won-search" placeholder="Search client, quote no. or project no." style="width:100%;max-width:420px"/></div>
    <div class="chip-tabs won-filters" style="margin-bottom:12px">${WON_FILTERS.map(f=>{
      const n = projects.filter(f.test).length;
      return `<button type="button" class="chip-tab${f.key===filter?' active':''}" data-won="${f.key}">${escHtml(f.label)} <span class="chip-count${n?' on':''}">${n}</span></button>`;
    }).join('')}</div>
    <div class="won-list"></div>`;

  const list = content.querySelector('.won-list');
  const row = p => {
    const st = stageOf(p.stage);
    const so = soByProject.get(p.id);
    const SF = window.SalesFlow;
    const osKey = so && SF ? SF.orderState(so) : null;
    const os = osKey ? SF.ORDER_STATE_META[osKey] : null;
    const pays = Array.isArray(p.payments) ? p.payments : [];
    const last = pays.length ? pays[pays.length-1] : null;
    const bal = balOf(p);
    return `<tr class="won-row" data-id="${escHtml(p.id)}">
      <td class="tc-avatar"><code>${escHtml(p.quoteNumber||'—')}</code><div style="font-size:10px;color:var(--text-muted);font-family:monospace">${escHtml(p.projectNo||'')}</div></td>
      <td class="tc-name"><strong>${escHtml(p.clientName||p.name||'—')}</strong> ${p.company?`<span class="badge ${window.isInternalQuoteCompany?.(p.company)?'badge-orange':'badge-gray'}" style="font-size:9px">${escHtml(p.company)}</span>`:''}<div style="font-size:11px;color:var(--text-muted)">${escHtml(dateOf(p.createdAt))} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></div></td>
      ${showMoney ? `<td class="tc-net">₱${fmt(p.contractAmount||0)}</td>` : ''}
      <td class="tc-detail" data-label="Stage"><span class="badge" style="background:${st.color};color:var(--on-primary)">${st.icon} ${escHtml(st.label)}</span></td>
      ${showMoney ? `
      <td class="tc-detail" data-label="Collected">₱${fmt(p.amountCollected||0)}</td>
      <td class="tc-detail" data-label="Balance"><span style="color:${bal>0?'var(--warning)':'var(--success)'};font-weight:600">₱${fmt(bal)}</span></td>
      <td class="tc-detail" data-label="Payments">${pays.length ? `${pays.length} · last ₱${fmt(last.amount||0)}${last.date?` <span style="color:var(--text-muted);font-size:11px">${escHtml(last.date)}</span>`:''}` : '<span style="color:var(--text-muted)">None yet</span>'}</td>` : ''}
      <td class="tc-detail" data-label="Order">${os ? `<span class="badge ${os.cls}" style="font-size:10px">${escHtml(os.label)}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td class="tc-actions"><button type="button" class="btn-secondary btn-sm won-open" data-id="${escHtml(p.id)}">Open</button></td>
    </tr>`;
  };
  const draw = () => {
    const f = WON_FILTERS.find(x=>x.key===filter) || WON_FILTERS[0];
    const needle = q.trim().toLowerCase();
    const rows = projects.filter(f.test).filter(p => !needle ||
      [p.clientName, p.name, p.quoteNumber, p.oldQuoteNumber, p.projectNo].some(v => String(v||'').toLowerCase().includes(needle)));
    list.innerHTML = !rows.length
      ? window.renderEmptyState({ icon:'🤝', title: projects.length ? 'No won jobs match' : 'No won jobs yet', hint: projects.length ? 'Try another filter or search.' : 'A job appears here as soon as a client\'s payment is recorded on a quote.' })
      : `<div class="card"><div class="table-wrap"><table class="data-table table-cards">
          <thead><tr><th>Quote # / Project</th><th>Client</th>${showMoney?'<th>Contract</th>':''}<th>Stage</th>${showMoney?'<th>Collected</th><th>Balance</th><th>Payments</th>':''}<th>Order</th><th></th></tr></thead>
          <tbody>${rows.map(row).join('')}</tbody></table></div></div>`;
    if (window.lucide) lucide.createIcons({ nodes:[list] });
    list.querySelectorAll('tr.won-row').forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('.won-open')) return;
      tr.classList.toggle('tc-expanded');
    }));
    list.querySelectorAll('.won-open').forEach(b => b.addEventListener('click', () => {
      const p = projects.find(x=>x.id===b.dataset.id);
      if (p && typeof openJobProjectDetail === 'function') openJobProjectDetail(p);
      else navigateTo('projects-lifecycle');
    }));
  };
  const bar = content.querySelector('.won-filters');
  bar.querySelectorAll('.chip-tab').forEach(btn => btn.addEventListener('click', () => {
    bar.querySelectorAll('.chip-tab').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); filter = btn.dataset.won; draw();
  }));
  content.querySelector('.won-search').addEventListener('input', e => { q = e.target.value; draw(); });
  draw();
}

// ══════════════════════════════════════════════════
//  SALES — QUICK ESTIMATE
//  Fast price-check calculator over the SAME product data source the full
//  Quote Builder uses: live Firestore `products` collection first (so a
//  President price edit reaches Quick Estimate immediately, same as the
//  full builder), falling back to products-database.json only if Firestore
//  is empty/unreachable — re-audit fix, this used to read the static JSON
//  unconditionally and could silently quote stale prices. Add many lines,
//  see a live total, then (optionally) hand the whole basket off to the
//  Quote Builder as a formal quotation draft.
//  Pricing mirrors quote-builder-v2.html computePrice() so estimates match.
// ══════════════════════════════════════════════════
const qePeso = n => '₱' + Math.round(Number(n) || 0).toLocaleString('en-PH');
const qeNum  = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
window._qeItems = window._qeItems || [];   // basket persists within the session

// Set when BOTH sources below fail, cleared on every fresh attempt. Read by
// renderQuickEstimate, which refuses to draw a priceable-looking calculator
// over a product list it never actually received.
window._qeDBError = null;

async function qeLoadDB() {
  if (window._qeDB) return window._qeDB;
  window._qeDBError = null;
  // Firestore first — same shape/mapping as quote-builder-v2.html's
  // loadDatabase(), so the two tools can never disagree on a live price.
  try {
    if (typeof db === 'undefined') throw new Error('firestore not initialized');
    // product_costs is finance/admin-only (cost basis was migrated OFF the
    // products doc — see migrateProductCostsOut + firestore.rules). These
    // items flow into the Quote Builder via qeCreateFormalQuote(), whose
    // margin panel reads item.capitalMaterials/capitalLabor — without this
    // read a Quick-Estimate-originated quote showed ₱0 COGS. A session the
    // rules deny (plain sales staff) just gets costs of 0, same as before.
    const [snap, metaSnap, costSnap] = await Promise.all([
      db.collection('products').limit(1000).get(),
      db.collection('productMeta').doc('config').get(),
      db.collection('product_costs').limit(1000).get().catch(() => null),
    ]);
    if (snap.empty) throw new Error('no products in firestore yet');
    const meta = metaSnap.exists ? metaSnap.data() : {};
    const costMap = {};
    if (costSnap) costSnap.docs.forEach(cd => { costMap[cd.id] = cd.data(); });
    window._qeDB = {
      products: snap.docs.map(d => {
        const p = d.data();
        const c = costMap[d.id];
        return {
          id: d.id,
          category: p.category,
          name: p.title || p.name || '',
          formulaType: p.formulaType || 'fixed',
          basePrice: p.basePrice ?? p.baseRate ?? 0,
          defaultDimensions: p.measurement || p.defaultDimensions || {},
          formula: p.formula || {},
          specs: Array.isArray(p.specs) ? p.specs : [],
          capitalMaterials: (c && c.capitalMaterials) ?? p.capitalMaterials ?? 0,
          capitalLabor: (c && c.capitalLabor) ?? p.capitalLabor ?? 0,
          laborHours: p.laborHours || null,
          leadTime: p.leadTime || '',
          unit: p.unit || 'pc',
        };
      }),
      categories: meta.categories || [],
      constants: meta.constants || {},
    };
    return window._qeDB;
  } catch (e) {
    console.warn('Quick Estimate: Firestore product load failed, falling back to products-database.json', e);
  }
  // Fallback: static JSON (offline / Firestore empty / read error)
  try {
    const r = await fetch('products-database.json?v=' + Date.now());
    // fetch() only rejects on a NETWORK failure — a 404/500 resolves happily
    // and then r.json() either throws on the error body or, worse, parses a
    // stray JSON payload into a product database that isn't one.
    if (!r.ok) throw new Error('products-database.json → HTTP ' + r.status);
    window._qeDB = await r.json();
    return window._qeDB;
  } catch (e) {
    console.warn('Quick Estimate: products DB load failed', e);
    // Do NOT park the failure in window._qeDB. Caching an empty product list
    // in the SUCCESS slot meant every later visit short-circuited on the first
    // line of this function and rendered a fully-formed calculator whose only
    // dropdown option was "— Select a product —": indistinguishable from a
    // company with no products, permanent for the rest of the session, and
    // un-retryable by construction. Record the failure instead and let the
    // caller say so; the next call re-attempts both sources.
    window._qeDBError = e;
    return { categories: [], products: [], constants: {} };
  }
}

// Unit price for product `p` given the chosen dims/specs — faithful port of the
// Quote Builder's computePrice() so the two tools never disagree on a number.
function qeUnitPrice(p, ctx) {
  if (!p) return 0;
  ctx = ctx || {};
  const consts  = (window._qeDB && window._qeDB.constants) || {};
  const matMult = consts.materialPriceIndexMultiplier || 1.0;
  const dd = p.defaultDimensions || {};
  let price = p.basePrice || 0;

  if (p.formulaType === 'per_length' && p.formula) {
    const W = qeNum(ctx.W, dd.W != null ? dd.W : 900);
    const base = p.formula.baseLengthMm || 900;
    const ppm = p.formula.pricePerExtraMm || 0;
    price = (p.basePrice || 0) + Math.max(0, W - base) * ppm;
  } else if (p.formulaType === 'per_area' && p.formula) {
    const W = qeNum(ctx.W, dd.W != null ? dd.W : 1000);
    const H = qeNum(ctx.H, dd.H != null ? dd.H : 1000);
    price = ((W * H) / 1e6) * (p.formula.pricePerSqm || 0);
  } else if (p.formulaType === 'per_run' && p.formula) {
    const runs = qeNum(ctx.runs, 1) || 1;
    price = (p.formula.pricePerRun || p.basePrice || 0) * runs;
  }

  price *= matMult;

  if (p.specs && p.specs.length && Array.isArray(ctx.specIdx)) {
    p.specs.forEach((s, i) => {
      const oi = parseInt(ctx.specIdx[i] || 0);
      const adder = (s.priceAdder && s.priceAdder[oi]) ? s.priceAdder[oi] : 0;
      price += adder;
    });
  }
  return Math.max(0, Math.round(price));
}

// Read the current picker form into a {W,H,runs,specIdx} context object
function qeReadCtx(p) {
  const ctx = { specIdx: [] };
  const w = document.getElementById('qe-dim-W'); if (w) ctx.W = w.value;
  const h = document.getElementById('qe-dim-H'); if (h) ctx.H = h.value;
  const r = document.getElementById('qe-dim-runs'); if (r) ctx.runs = r.value;
  if (p && p.specs) p.specs.forEach((s, i) => {
    const sel = document.getElementById('qe-spec-' + i);
    ctx.specIdx[i] = sel ? parseInt(sel.value || 0) : 0;
  });
  return ctx;
}

function qeSelectedProduct() {
  const sel = document.getElementById('qe-product');
  if (!sel || !sel.value) return null;
  // Guard _qeDB itself, not just .products: it is no longer written on a total
  // load failure (see qeLoadDB), so it can legitimately be undefined here.
  return (((window._qeDB && window._qeDB.products) || [])).find(p => p.id === sel.value) || null;
}

// Dimension / spec inputs shown depend on the selected product's formula
function qeRenderDims() {
  const box = document.getElementById('qe-dims');
  const p = qeSelectedProduct();
  if (!box) return;
  if (!p) { box.innerHTML = ''; return; }
  const dd = p.defaultDimensions || {};
  let html = '';
  const inputStyle = 'width:90px;padding:7px 9px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:13px';
  const wrap = (label, inner) => `<div style="display:flex;flex-direction:column;gap:3px"><label style="font-size:10px;font-weight:700;color:var(--text-muted);letter-spacing:.03em">${label}</label>${inner}</div>`;

  if (p.formulaType === 'per_length') {
    html += wrap('Length (mm)', `<input type="number" id="qe-dim-W" value="${dd.W != null ? dd.W : 900}" oninput="qePreview()" style="${inputStyle}">`);
  } else if (p.formulaType === 'per_area') {
    html += wrap('Width (mm)', `<input type="number" id="qe-dim-W" value="${dd.W != null ? dd.W : 1000}" oninput="qePreview()" style="${inputStyle}">`);
    html += wrap('Height (mm)', `<input type="number" id="qe-dim-H" value="${dd.H != null ? dd.H : 1000}" oninput="qePreview()" style="${inputStyle}">`);
  } else if (p.formulaType === 'per_run') {
    html += wrap('Runs / sections', `<input type="number" id="qe-dim-runs" value="1" min="1" oninput="qePreview()" style="${inputStyle}">`);
  }
  if (p.specs && p.specs.length) {
    p.specs.forEach((s, i) => {
      const opts = (s.options || []).map((o, oi) => `<option value="${oi}">${escHtml(o)}</option>`).join('');
      html += wrap(escHtml(s.label || ('Option ' + (i + 1))), `<select id="qe-spec-${i}" onchange="qePreview()" style="${inputStyle};width:auto;min-width:120px">${opts}</select>`);
    });
  }
  if (p.formulaType === 'configurable') {
    html += `<div style="align-self:flex-end;font-size:10px;color:var(--text-muted);max-width:180px">Configurable item — base price shown; fine-tune in the full builder.</div>`;
  }
  box.innerHTML = html;
}

// Live unit-price preview for the product currently in the picker
function qePreview() {
  const p = qeSelectedProduct();
  const out = document.getElementById('qe-unit-price');
  const lead = document.getElementById('qe-lead');
  if (!out) return;
  if (!p) { out.textContent = '₱0'; if (lead) lead.textContent = ''; return; }
  const unit = qeUnitPrice(p, qeReadCtx(p));
  out.textContent = qePeso(unit);
  if (lead) lead.textContent = p.leadTime ? ('Lead time: ' + p.leadTime) : '';
}

function qeOnProductChange() { qeRenderDims(); qePreview(); }

function qeAddItem() {
  const p = qeSelectedProduct();
  if (!p) { Notifs.showToast('Pick a product first', 'info'); return; }
  const ctx = qeReadCtx(p);
  const qty = Math.max(1, parseInt(document.getElementById('qe-qty')?.value || 1));
  const unitPrice = qeUnitPrice(p, ctx);

  // dims display string + spec snapshot (matches the builder's line-item shape
  // so the formal-quote handoff loads cleanly)
  const dimParts = [];
  if (ctx.W != null && document.getElementById('qe-dim-W')) dimParts.push((p.formulaType === 'per_length' ? 'L' : 'W') + qeNum(ctx.W, 0));
  if (ctx.H != null && document.getElementById('qe-dim-H')) dimParts.push('H' + qeNum(ctx.H, 0));
  if (ctx.runs != null && document.getElementById('qe-dim-runs')) dimParts.push(qeNum(ctx.runs, 1) + ' run(s)');
  const specSnapshot = [];
  if (p.specs) p.specs.forEach((s, i) => specSnapshot.push({ label: s.label, value: (s.options || [])[ctx.specIdx[i] || 0] || '' }));
  const specStr = specSnapshot.map(s => s.value).filter(Boolean).join(', ');

  window._qeItems.push({
    id: p.id, category: p.category, name: p.name,
    dims: dimParts.join(' × '),
    specs: specSnapshot, specStr,
    qty, unit: p.unit || 'pc',
    unitPrice, amount: unitPrice * qty,
    leadTime: p.leadTime || '—',
    laborHours: p.laborHours || null,
    capitalMaterials: p.capitalMaterials || 0,
    capitalLabor: p.capitalLabor || 0,
    formulaType: p.formulaType,
  });
  qeRenderItems();
}

function qeRemoveItem(i) { window._qeItems.splice(i, 1); qeRenderItems(); }
function qeSetQty(i, v) {
  const it = window._qeItems[i]; if (!it) return;
  it.qty = Math.max(1, parseInt(v || 1));
  it.amount = it.unitPrice * it.qty;
  qeRenderItems();
}
async function qeClearAll() {
  if (!window._qeItems.length) return;
  if (!(await confirmDialog({message:'Clear all items from this estimate?', danger:true}))) return;
  window._qeItems = []; qeRenderItems();
}

function qeRenderItems() {
  const wrap = document.getElementById('qe-items');
  if (!wrap) return;
  const items = window._qeItems;
  if (!items.length) {
    wrap.innerHTML = `<div style="text-align:center;padding:28px 12px;color:var(--text-muted);font-size:13px;border:1.5px dashed var(--border);border-radius:12px">No items yet — pick a product above and tap <strong>Add to estimate</strong>.</div>`;
    qeRenderTotals(); return;
  }
  const rows = items.map((it, i) => `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 6px">
        <div style="font-weight:700;font-size:12.5px;color:var(--text)">${escHtml(it.name)}</div>
        <div style="font-size:10.5px;color:var(--text-muted)">${escHtml([it.dims, it.specStr].filter(Boolean).join(' · ') || it.unit)}</div>
      </td>
      <td style="padding:8px 6px;text-align:right;white-space:nowrap">${qePeso(it.unitPrice)}</td>
      <td style="padding:8px 6px;text-align:center">
        <input type="number" min="1" value="${it.qty}" onchange="qeSetQty(${i}, this.value)"
          style="width:54px;padding:5px 6px;border:1.5px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font-size:12px;text-align:center">
      </td>
      <td style="padding:8px 6px;text-align:right;font-weight:700;white-space:nowrap">${qePeso(it.amount)}</td>
      <td style="padding:8px 2px;text-align:center">
        <button onclick="qeRemoveItem(${i})" title="Remove" aria-label="Remove item" style="background:none;border:none;cursor:pointer;color:var(--danger,#e53935);font-size:15px;line-height:1">${emojiIcon('✕',15)}</button>
      </td>
    </tr>`).join('');
  wrap.innerHTML = `
    <div class="table-wrap"><table style="width:100%;border-collapse:collapse;min-width:340px">
      <thead><tr style="border-bottom:2px solid var(--border);font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">
        <th style="padding:6px;text-align:left">Item</th>
        <th style="padding:6px;text-align:right">Unit ₱</th>
        <th style="padding:6px;text-align:center">Qty</th>
        <th style="padding:6px;text-align:right">Amount</th>
        <th style="padding:6px"></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  qeRenderTotals();
}

function qeRenderTotals() {
  const box = document.getElementById('qe-totals');
  if (!box) return;
  const items = window._qeItems;
  const subtotal = items.reduce((s, it) => s + (it.amount || 0), 0);
  const vatRate = ((window._qeDB && window._qeDB.constants && window._qeDB.constants.vat) || 0.12);
  const showVat = !!(document.getElementById('qe-vat') && document.getElementById('qe-vat').checked);
  const vatAmt = showVat ? subtotal * vatRate : 0;
  const grand = subtotal + vatAmt;
  const count = items.reduce((s, it) => s + (it.qty || 0), 0);
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted);margin-bottom:4px"><span>Subtotal (${count} pc${count===1?'':'s'}, ${items.length} line${items.length===1?'':'s'})</span><span>${qePeso(subtotal)}</span></div>
    ${showVat ? `<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted);margin-bottom:4px"><span>VAT (${Math.round(vatRate*100)}%)</span><span>${qePeso(vatAmt)}</span></div>` : ''}
    <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:800;color:var(--text);border-top:1.5px solid var(--border);padding-top:8px;margin-top:4px"><span>Total</span><span>${qePeso(grand)}</span></div>`;
}

// Hand the whole basket to the full Quote Builder as a fresh draft. Uses the
// same _qbReopenState mechanism the Quotations "Reopen" action uses.
function qeCreateFormalQuote() {
  if (!window._qeItems.length) { Notifs.showToast('Add at least one item first', 'info'); return; }
  const client = (document.getElementById('qe-client') || {}).value || '';
  window._qbReopenState = {
    currentCo: 'BK',
    clientName: client.trim(),
    items: window._qeItems.map(it => ({ ...it })),
  };
  window._qbReopenAsRevision = false;
  Notifs.showToast('Opening Quote Builder with your ' + window._qeItems.length + ' item(s)…', 'success');
  navigateTo('bk-quote-builder');
}

async function renderQuickEstimate(container, currentUser, currentRole) {
  container.innerHTML = window.skeletonHtml('cards');
  const db = await qeLoadDB();
  // An unreadable product database used to render as a complete, working-looking
  // calculator whose product dropdown was simply empty — the same "confident
  // nothing" this pass removed from the CRM funnel. Say it failed, and offer the
  // retry the cached-failure bug in qeLoadDB used to make impossible.
  if (window._qeDBError) {
    const msg = window._qeDBError.message || String(window._qeDBError);
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div>
      <h4>Couldn't load the product database</h4>
      <p>${escHtml(msg)}</p>
      <p style="font-size:11px;color:var(--text-muted);max-width:420px;margin:6px auto 0">Prices come from the live <code>products</code> collection, with <code>products-database.json</code> as the offline fallback — both were unreachable, so nothing can be priced right now.</p>
      <button type="button" class="btn-secondary btn-sm qe-retry-btn" style="margin-top:14px">Retry</button></div>`;
    container.querySelector('.qe-retry-btn')?.addEventListener('click', () => renderQuickEstimate(container, currentUser, currentRole));
    if (window.lucide) lucide.createIcons({ nodes: [container] });
    return;
  }
  const cats = db.categories || [];
  const products = (db.products || []).slice();

  // group products under category optgroups
  const byCat = {};
  products.forEach(p => { (byCat[p.category] = byCat[p.category] || []).push(p); });
  const catLabel = id => { const c = cats.find(x => x.id === id); return c ? `${c.icon || ''} ${c.label}` : id; };
  const optgroups = Object.keys(byCat).map(cid => `
    <optgroup label="${escHtml(catLabel(cid))}">
      ${byCat[cid].map(p => `<option value="${p.id}">${escHtml(p.shortName || p.name)}</option>`).join('')}
    </optgroup>`).join('');

  const ctrlStyle = 'padding:9px 11px;border:1.5px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font-size:13px';

  container.innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);background:rgba(230,81,0,.07);border:1px solid var(--border);border-radius:10px;padding:8px 12px;margin-bottom:14px">
      ${emojiIcon('⚡',16)} <strong>Quick Estimate</strong> — a rough price check from the live product database. Add as many items as you like. The quote itself is built in the Quote Builder, where the Barro Kitchens configurators and the Standard Price List set the price.
    </div>

    <!-- Picker -->
    <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:14px;margin-bottom:14px">
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
        <div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:200px">
          <label style="font-size:10px;font-weight:700;color:var(--text-muted);letter-spacing:.03em">Product</label>
          <select id="qe-product" onchange="qeOnProductChange()" style="${ctrlStyle}">
            <option value="">— Select a product —</option>
            ${optgroups}
          </select>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px">
          <label style="font-size:10px;font-weight:700;color:var(--text-muted);letter-spacing:.03em">Qty</label>
          <input type="number" id="qe-qty" value="1" min="1" style="${ctrlStyle};width:70px">
        </div>
      </div>
      <div id="qe-dims" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px"></div>
      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
        <div>
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">Unit price</div>
          <div id="qe-unit-price" style="font-size:22px;font-weight:800;color:var(--primary,#e65100)">₱0</div>
          <div id="qe-lead" style="font-size:10.5px;color:var(--text-muted)"></div>
        </div>
        <button class="btn-primary" onclick="qeAddItem()" style="padding:11px 20px;font-weight:700">＋ Add to estimate</button>
      </div>
    </div>

    <!-- Basket -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
      <h3 style="font-size:14px;font-weight:800;color:var(--text);margin:0">Estimate Items</h3>
      <button onclick="qeClearAll()" class="btn-secondary btn-sm">Clear all</button>
    </div>
    <div id="qe-items" style="margin-bottom:14px"></div>

    <!-- Totals -->
    <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:14px;margin-bottom:14px">
      <!-- The tick is the native control (no inline width/height — see the checkbox
           carve-out in css/styles.css). min-height gives this a real tap target: it
           was a 14px-tall row, and a stray tap here moves the customer's total by 12%. -->
      <label style="display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--text);margin-bottom:10px;cursor:pointer;min-height:44px">
        <input type="checkbox" id="qe-vat" onchange="qeRenderTotals()"> Add VAT (12%)
      </label>
      <div id="qe-totals"></div>
    </div>

    <!-- Client + handoff -->
    <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:14px">
      <label style="font-size:10px;font-weight:700;color:var(--text-muted);letter-spacing:.03em">Client name (optional — carried into the quote)</label>
      <input type="text" id="qe-client" placeholder="e.g. Juan Dela Cruz / ABC Restaurant" style="${ctrlStyle};width:100%;margin:5px 0 12px;box-sizing:border-box">
      <button class="btn-primary" onclick="qeCreateFormalQuote()" style="width:100%;padding:13px;font-weight:800;font-size:14px">${emojiIcon('📄',14)} Create Formal Quotation →</button>
      <p style="font-size:11px;color:var(--text-muted);margin:8px 0 0;text-align:center">Opens the full Quote Builder pre-filled with these items, where you can refine them, send the quote for approval, and download the PDF once it is approved.</p>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  qeRenderItems();   // render any items already in the session basket
}

// ── Sales SOP — Inquiry → Close-out ───────────────
// Editable playbook. Persisted to settings/sales_sop (President-only write per
// firestore.rules → settings); falls back to DEFAULT_SALES_SOP when no doc exists.
// Body text supports lightweight **bold** markup; everything is escaped first.
const SALES_SOP_ORANGE = '#e65100';
// Quotes list (2026-11-20, owner "complete the whole system"): the card title used to prepend the company code to
// every number, so a number that already carries it read "BK-BKLUFB261119-003R1". Prefix only when it is missing.
window.quoteDisplayNo = function (q) {
  const co = String((q && q.company) || 'BK');
  const no = String((q && q.quoteNumber) || (q && q.id ? String(q.id).slice(-6).toUpperCase() : ''));
  return no.toUpperCase().startsWith(co.toUpperCase()) ? no : co + '-' + no;
};
// The approval state of a FILED quote, in the Approvals screen's words. Before this the card said "Filed" for an approved
// quote. Returns null when the normal status badge should stay (not filed, already ordered, or no approval state).
window.quoteApprovalBadge = function (q) {
  if (!q || q.salesOrderId || q.status !== 'filed') return null;
  return ({
    approved:       { cls: 'badge-green',  label: 'Approved' },
    pending_review: { cls: 'badge-orange', label: 'Pending approval' },
    pending:        { cls: 'badge-orange', label: 'Pending approval' },
    needs_revision: { cls: 'badge-orange', label: 'Returned' },
    rejected:       { cls: 'badge-red',    label: 'Rejected' },
  })[q.approvalStatus] || null;
};
const DEFAULT_SALES_SOP = {
  // Version 3 = the process of 2026-11-20: the Barro Kitchens configurators in the quote builder, the President approves every quote,
  // Record payment -> the President confirms -> Sales generates the SO & JO, and the Won / Projects tab. (Version 2 was the 2026-11-19 flow,
  // before the configurators.) A SAVED SOP without sopVersion >= 3 is an older version: renderSalesSOPView offers the President the new default.
  sopVersion: 3,
  intro: "How Barro Kitchens sells, from the first inquiry to the last payment. Each step shows who owns it and where to do it in the app. Follow the steps in order: no quote goes out without the President's approval, and no job goes to Production until a payment is confirmed.",
  steps: [
    { short:'Lead', title:'Lead Comes In', owner:'Sales', tab:'Clients · Briefs · Quote requests',
      desc:'Every inquiry goes straight to Sales. Log it and answer it the same day.',
      actions:[
        'Website requests arrive on their own: **Briefs** holds the Client Information forms, **Quote requests** holds the "Get a quote" requests from the catalogue.',
        'Open each new one, read the answers, then tap **Convert to client**.',
        'Anything else (call, Messenger, Facebook, referral, walk-in): add the client in **Clients** with contact details, source and what they want.'
      ], out:'Every lead is a client record with its source.' },
    { short:'Qualify', title:'Qualify the Request', owner:'Sales', tab:'Clients',
      desc:'Know what the client needs before you spend time on a quote.',
      actions:[
        'Confirm the scope: a standard product, a kitchen layout, or a custom job.',
        'Ask for the site location, the budget range, the target date and who decides.',
        'For a large or unusual job, or a key account, tell the President early: he closes the big accounts with you.',
        'Park or close leads that are not a real fit, so the list stays honest.'
      ], out:'A clear scope you can quote.' },
    { short:'Visit', title:'Site Visit & Measurement', owner:'Operations (Rene)', tab:'Files → Work Plans',
      desc:'Only when exact measurements are needed, such as a custom kitchen or a tight site. Sales works remotely, so Rene visits. Skip it for standard products.',
      actions:[
        'Ask Rene to book the visit. Give him the client\'s contact details, the address and what to check.',
        'The site-visit fee is optional. If it is charged, it is credited to the job when the client goes ahead.',
        'Rene brings back measurements, photos and a hand layout. Save them in **Files → Work Plans**.',
        'Rene never quotes a price on site. Prices come only from Sales.'
      ], out:'Measurements, photos and a layout ready for the quote.' },
    { short:'Quote', title:'Build the Quotation', owner:'Sales', tab:'Quotes',
      desc:'Build every quote in the quote builder. The Barro Kitchens configurators are on for everyone.',
      actions:[
        'Open **Sales → Quotes → ＋ New Quotation**, or **Open in Quote Builder** on a quote request. Always open it from inside the app: the standalone page is preview only and cannot file.',
        'In **Add items**, pick the tab for the area. Each product card shows a "from" price. Tap **Configure**: the recommended options are already selected, so change only what the client asked for, then tap **Add to Quote**. A standard item takes three taps or fewer.',
        'Prices come from the Standard Price List, so do not retype them. For grilling and bakery items use the catalogue search; for anything else use **Add custom item**.',
        'Terms start at 65% down payment and 35% on delivery, a 6-month service warranty and a hairline finish. The discount starts at none: give one only from the discount list, 30% at most. The "offer up to n%" line in the calculator is only a hint.',
        'The quote number is automatic and unique: never type one. If you see "The configurators did not load", tap **Reload DB**. If it stays, tell the President.'
      ], out:'A complete quote, ready to send for approval.' },
    { short:'Approve', title:'President Approves', owner:'President (Neil)', tab:'Quote Builder · Approvals',
      desc:'The President approves every quote before it goes out to the client.',
      actions:[
        'In the builder tap **Verify & File**, then tap **Send for approval (get the link)**.',
        'Send the approval link to the President by Messenger or Viber.',
        'He reviews the quote in **Approvals** and approves it, or returns it with a note. You are notified either way.',
        'If it comes back, fix what he asked for and send it for approval again.'
      ], out:'An approved quote, filed and ready to send.' },
    { short:'Send', title:'Send the Quotation', owner:'Sales', tab:'Quotes → Records',
      desc:'Give the client the approved quote and record that it went out.',
      actions:[
        'To get the PDF of an approved quote, tap **↻ Reopen** on it in **Quotes → Records**, then **Verify & File**. Choose **Update the original quote in place** (it keeps the number and the approval) and tap **File Quotation**.',
        'Then use **PDF ▾ → Download PDF** (on a phone: **☰ → Download PDF**). It is an A4 file named by the quote number.',
        'Check the PDF before it goes out. Each line shows its item code in small grey text, for example PS-PT-1200.',
        'Send the PDF to the client, or tap **Share** on the quote for the client link.',
        '**Agent Copy** (also in the **PDF ▾** menu) is internal: never send it to the client. **Workforce Copy** has no prices and is for the crew.',
        'Tap **Mark sent** on the quote the same day, and confirm that the client received it.'
      ], out:'Quotation sent and marked Sent.' },
    { short:'Follow-up', title:'Follow-up & Negotiation', owner:'Sales', tab:'Quotes → Records',
      desc:'Most deals are won in the follow-up.',
      actions:[
        'Follow up within 2 working days of sending.',
        'To change a quote, tap **New Revision** (or **↻ Reopen** and choose **File as a new revision**). Every version stays on record as R2, R3 and so on. **Update in place** keeps the same number.',
        'A revised quote goes back to the President unless his approval still covers the change.',
        'If the client says no, tap **Lost** and choose the reason. Every lost quote needs a reason. If the client comes back, tap **Reopen quote**.'
      ], out:'A clear client decision: paying, or Lost with a reason.' },
    { short:'Drawings', title:'Drawings', owner:'Rene / Design, or the client\'s own', tab:'Sales Orders · Projects',
      desc:'Agree what will be built before the client pays.',
      actions:[
        'When the client is ready to go ahead, ask Rene for the layout and shop drawings, and agree them with the client.',
        'If the client already has a drawing, keep the file: you attach it when you generate the job order.',
        'For a large job the President approves the drawings.'
      ], out:'An agreed drawing, or the client\'s own.' },
    { short:'Payment', title:'Record the Payment', owner:'Sales records · President confirms (Finance as stand-in)', tab:'Quotes → Records · Sales Orders',
      desc:'No job starts without a confirmed payment.',
      actions:[
        'When the client pays, tap **Record payment** on the quote: amount, date paid, method, VAT, reference or OR number, and the receipt. The receipt or proof of payment is required.',
        'The contract amount is the quote total and cannot be typed. To change it, make a **New Revision** of the quote and have it approved.',
        'Tap **Record payment — send to President**. He is notified and confirms in one tap (**Confirm payment**, in **Approvals** or on **Sales Orders**). If he cannot be reached, Finance may confirm in his place; the app records who confirmed and tells him.',
        'If something is wrong it comes back with a reason. Tap **Fix & resubmit** on **Sales Orders**.'
      ], out:'Payment confirmed and posted to the ledger, once.' },
    { short:'Generate', title:'Sales Order & Job Order', owner:'Sales', tab:'Sales Orders',
      desc:'Hand the job to Production yourself. The sales order and job order are the handoff to Rene: no Finance step and no handoff meeting.',
      actions:[
        'In **Sales Orders**, tap **Generate SO & JO** on the order that shows Payment confirmed.',
        'Enter the target date, priority and notes for Production. All three are required.',
        'Drawings: choose **The client supplied the drawing** or **Our drawing is already done**, and attach the file. If nothing is drawn yet, choose **Not drawn yet — send to Design first**, and attach the drawing yourself later with **Attach drawing** on the Sales Orders row.',
        'Tap **Generate**. The **Documents ready** box offers the PDFs: the Sales Order, and the Job Order and Handoff pack once a drawing is attached.',
        'Keep the client updated with the tracking **Link**.'
      ], out:'Sales order and job order with Production.' },
    { short:'Track', title:'Production, Delivery & Turnover', owner:'Operations (Rene) · Sales watches', tab:'Won / Projects',
      desc:'Rene owns the job from the handoff: fabrication, quality check, delivery, installation and turnover. Sales keeps watching, and stays the client\'s contact for prices.',
      actions:[
        'Open **Sales → Won / Projects** to see every won job: stage, contract, amount collected and balance. Filter by stage, or search by client, quote number or project number.',
        'Tap **Open** on a job for its full project folder.',
        'Rene is the client\'s contact for schedule, installation and permits. Sales answers questions about prices, change orders and the balance.',
        'A change after payment: Rene gathers the details and never quotes. Sales prices the change and the client signs it; nothing starts until it is signed and any added down payment is paid. Do not record it as a new payment: ask the President to update the order.'
      ], out:'Job delivered and accepted by the client.' },
    { short:'Balance', title:'Balance & Close-out', owner:'Sales follows up · Finance bills', tab:'Won / Projects',
      desc:'The job closes when the balance is paid.',
      actions:[
        'When the job is delivered, Finance is told to bill the balance. Sales stays the client\'s contact and follows up until it is paid.',
        'Finance records each payment on the project. Check the balance on **Won / Projects**.',
        'If a payment is late: Sales chases first, Finance sends the statement, and the President steps in only after 30 days overdue.',
        'A fully paid job closes itself after delivery, and the President is told.',
        'Warranty and service calls go to Rene. If a client calls Sales about one, pass it on.'
      ], out:'Balance collected and the job closed (Paid / Closed).' },
  ],
  rules: [
    'Log **every** inquiry and answer it the same day. An unlogged lead is a lost lead.',
    'No quotation goes out without the President\'s approval (Step 5).',
    'No job goes to Production without a payment the President has confirmed (Step 9).',
    'Build every quote in the quote builder, opened from inside the app. Prices come from the Standard Price List; discounts only from the discount list, 30% at most.',
    'Only Sales gives prices. Rene never quotes on site, and the crew never sees a price: give them the **Workforce Copy**.',
    'One voice for the client: Sales for quotes, prices, change orders and the balance; Rene for schedule, site, installation, permits and warranty; Finance for billing.',
    'Every client group chat includes Sales and Rene. The President joins only key-account chats.',
    'Give clients only the business mobile, hello@barroindustries.com and the Facebook page. Never the President\'s personal number.',
    'Bring the President in early for large accounts, unusual jobs and serious complaints. For anything else he is the last step, not the first.',
    'Keep quote and order status current (**Mark sent**, **Lost**, **Record payment**) so the pipeline shows the truth.',
    'Follow up within 2 working days of sending a quote, and report weekly: leads received, quotes sent, deals closed and balances still owed.'
  ]
};

// Escape, then apply tiny **bold** markup. Safe for President-entered content.
function sopFmt(s){ return (window.escHtml?escHtml(s):String(s==null?'':s)).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>'); }
function sopFmtDate(ts){
  try{
    const d = ts && ts.toDate ? ts.toDate()
      : (ts instanceof Date ? ts
      : (ts && ts.seconds ? new Date(ts.seconds*1000)
      : (typeof ts==='string' ? new Date(ts) : null)));
    return d ? d.toLocaleDateString('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric'}) : '';
  }catch(_){ return ''; }
}

async function renderSalesSOP(container) {
  container.innerHTML = window.skeletonHtml('rows');
  let data = null, loadErr = null;
  try {
    const doc = await db.collection('settings').doc('sales_sop').get();
    if (doc.exists) data = doc.data();
  } catch(err){
    // Was a bare `catch(_){}`. Falling through to DEFAULT_SALES_SOP stays the
    // right BEHAVIOUR — the default is the real playbook and an unreadable
    // settings doc must not blank the tab — but presenting it silently is the
    // lie: a President edit may well exist and simply not have loaded, and the
    // reader has no way to tell "this is the company's SOP" from "this is the
    // shipped default because the saved one didn't arrive". Keep the fallback,
    // and say which one they are looking at.
    loadErr = err;
  }
  if (!data || !Array.isArray(data.steps) || !data.steps.length) data = DEFAULT_SALES_SOP;
  window._salesSopData = data;
  renderSalesSOPView(container, data, loadErr);
}

// `loadErr` is optional and set only by renderSalesSOP above; the editor's
// Cancel path re-renders with two arguments and so shows no banner, which is
// correct — that path is displaying data it definitely has.
function renderSalesSOPView(container, data, loadErr) {
  const O = SALES_SOP_ORANGE;
  const steps = Array.isArray(data.steps) ? data.steps : [];
  const rules = Array.isArray(data.rules) ? data.rules : [];
  const canEdit = (typeof isPresident==='function' && isPresident());
  const updated = data.updatedAt
    ? `<div style="margin-top:8px;font-size:11px;color:var(--text-muted)">Updated ${sopFmtDate(data.updatedAt)}${data.updatedBy?(' · '+escHtml(data.updatedBy)):''}</div>`
    : '';

  const loadWarn = loadErr
    ? `<div class="alert-banner alert-warn" style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <span>${emojiIcon('⚠️',16)} Showing the built-in default SOP — the saved version couldn't be read (${escHtml(loadErr.message||String(loadErr))}). Any edits the President has published are <strong>not</strong> reflected below.</span>
        <button type="button" class="btn-secondary btn-sm sop-reload-btn">Retry</button>
      </div>`
    : '';

  // A SAVED SOP with no sopVersion >= 3 is an older version of the process (the shipped default is always current, so it never shows this).
  // The President can load the new default into the editor in one tap; everyone else is told it is being updated.
  const oldSopBanner = (data.sopVersion >= 3) ? '' : (canEdit
    ? `<div class="alert-banner" style="cursor:default;margin-bottom:12px">The sales process was updated (Nov 2026): the Barro Kitchens configurators, the President's approval of every quote, Record payment, Generate SO &amp; JO and the Won / Projects tab. This saved SOP is the older version. <button class="btn-secondary btn-sm" id="sop-load-v2">Load the new default</button></div>`
    : `<div class="alert-banner" style="cursor:default;margin-bottom:12px">This SOP is being updated to the new sales process.</div>`);

  container.innerHTML = `
    ${loadWarn}
    ${oldSopBanner}
    <div style="background:linear-gradient(135deg,rgba(230,81,0,.14),rgba(230,81,0,.04));border:1px solid rgba(230,81,0,.35);border-radius:14px;padding:16px 18px;margin-bottom:16px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:24px">${emojiIcon('📖',24)}</span>
          <h3 style="margin:0;font-size:17px;color:var(--text)">Sales SOP — Inquiry to Close-out</h3>
        </div>
        ${canEdit?`<button class="btn-secondary btn-sm" id="sop-edit-btn" style="flex-shrink:0">${emojiIcon('✏️',16)} Edit SOP</button>`:''}
      </div>
      <p style="margin:0;font-size:12.5px;color:var(--text-muted);line-height:1.6">${sopFmt(data.intro||'')}</p>
      ${updated}
    </div>

    <!-- At-a-glance pipeline -->
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:20px;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:12px">
      ${steps.map((s,i)=>`
        <span style="display:inline-flex;align-items:center;gap:6px;background:var(--surface2);border:1px solid var(--border);border-radius:999px;padding:5px 11px;font-size:11px;font-weight:700;color:var(--text)">
          <span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:${O};color:var(--on-primary);font-size:10px">${i+1}</span>
          ${escHtml(s.short||s.title||'')}
        </span>
        ${i<steps.length-1?`<span style="color:${O};font-weight:800">›</span>`:''}
      `).join('')}
    </div>

    <!-- Steps -->
    <div style="display:flex;flex-direction:column;gap:12px">
      ${steps.map((s,i)=>`
        <div style="display:flex;gap:14px;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px;border-left:4px solid ${O}">
          <div style="flex-shrink:0;width:38px;height:38px;border-radius:50%;background:${O};color:var(--on-primary);display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:800">${i+1}</div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:4px">
              <h4 style="margin:0;font-size:15px;color:var(--text)">${escHtml(s.title||'')}</h4>
              ${s.owner?`<span style="font-size:10.5px;font-weight:700;color:${O};background:rgba(230,81,0,.12);border:1px solid rgba(230,81,0,.3);border-radius:999px;padding:2px 9px">${emojiIcon('👤',16)} ${escHtml(s.owner)}</span>`:''}
              ${s.tab?`<span style="font-size:10.5px;font-weight:700;color:var(--text-muted);background:var(--surface2);border:1px solid var(--border);border-radius:999px;padding:2px 9px">${emojiIcon('📍',16)} ${escHtml(s.tab)}</span>`:''}
            </div>
            ${s.desc?`<p style="margin:0 0 8px;font-size:12.5px;color:var(--text-muted);line-height:1.55">${sopFmt(s.desc)}</p>`:''}
            ${(Array.isArray(s.actions)&&s.actions.length)?`<ul style="margin:0 0 10px;padding-left:18px;font-size:12.5px;color:var(--text);line-height:1.7">
              ${s.actions.map(a=>`<li>${sopFmt(a)}</li>`).join('')}
            </ul>`:''}
            ${s.out?`<div style="font-size:11.5px;color:var(--success);font-weight:700;background:rgba(48,209,88,.1);border-radius:8px;padding:6px 10px;display:inline-block">${emojiIcon('✓',16)} Output: ${sopFmt(s.out)}</div>`:''}
          </div>
        </div>
      `).join('')}
    </div>

    ${rules.length?`<!-- Golden rules -->
    <div style="margin-top:18px;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px">
      <h4 style="margin:0 0 10px;font-size:14px;color:var(--text)">${emojiIcon('⭐',14)} Golden Rules</h4>
      <ul style="margin:0;padding-left:18px;font-size:12.5px;color:var(--text);line-height:1.8">
        ${rules.map(r=>`<li>${sopFmt(r)}</li>`).join('')}
      </ul>
    </div>`:''}

    <p style="text-align:center;font-size:11px;color:var(--text-muted);margin:16px 0 4px">
      Barro Kitchens (Barro Industries OPC) · Sales Department · Standard Operating Procedure
    </p>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  // Scoped to this container, not document.getElementById — openPage keeps a
  // dying panel in the DOM for ~300ms and an unscoped lookup can find its
  // Retry button instead of this one.
  container.querySelector('.sop-reload-btn')?.addEventListener('click', () => renderSalesSOP(container));
  if (canEdit) document.getElementById('sop-edit-btn')?.addEventListener('click', () => renderSalesSOPEditor(container, data));
  // "Load the new default": the existing editor, prefilled with DEFAULT_SALES_SOP; the existing Save writes it (sopVersion included).
  if (canEdit) container.querySelector('#sop-load-v2')?.addEventListener('click', () => renderSalesSOPEditor(container, DEFAULT_SALES_SOP));
}

// ── SOP editor (President only) ───────────────────
function renderSalesSOPEditor(container, data) {
  // Deep-clone into a working draft so Cancel discards unsaved edits.
  window._salesSopDraft = {
    sopVersion: data.sopVersion || 0,
    intro: data.intro || '',
    steps: (data.steps || []).map(s => ({
      short:s.short||'', title:s.title||'', owner:s.owner||'', tab:s.tab||'',
      desc:s.desc||'', actions:Array.isArray(s.actions)?s.actions.slice():[], out:s.out||''
    })),
    rules: Array.isArray(data.rules) ? data.rules.slice() : []
  };
  drawSalesSOPEditor(container);
}

function drawSalesSOPEditor(container) {
  const d = window._salesSopDraft;
  const O = SALES_SOP_ORANGE;
  const fld = 'width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:13px;box-sizing:border-box;font-family:inherit';
  const lbl = 'display:block;font-size:10.5px;font-weight:700;color:var(--text-muted);margin:8px 0 3px;text-transform:uppercase;letter-spacing:.04em';

  const stepCard = (s,i) => `
    <div class="sop-step-edit" data-si="${i}" style="background:var(--surface);border:1px solid var(--border);border-left:4px solid ${O};border-radius:12px;padding:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-weight:800;color:${O};font-size:13px">Step ${i+1}</span>
        <span style="display:flex;gap:5px">
          <button class="btn-secondary btn-sm sop-mv-up" data-i="${i}" title="Move up" aria-label="Move step up" ${i===0?'disabled':''}>↑</button>
          <button class="btn-secondary btn-sm sop-mv-down" data-i="${i}" title="Move down" aria-label="Move step down" ${i===d.steps.length-1?'disabled':''}>↓</button>
          <button class="btn-secondary btn-sm sop-rm-step" data-i="${i}" title="Remove step" aria-label="Remove step" style="color:#ff6b6b">${emojiIcon('trash-2',14)}</button>
        </span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><label style="${lbl}">Title</label><input data-f="title" value="${escHtml(s.title)}" style="${fld}"/></div>
        <div><label style="${lbl}">Pipeline label (short)</label><input data-f="short" value="${escHtml(s.short)}" placeholder="e.g. Quote" style="${fld}"/></div>
        <div><label style="${lbl}">Owner / Role</label><input data-f="owner" value="${escHtml(s.owner)}" style="${fld}"/></div>
        <div><label style="${lbl}">System tab</label><input data-f="tab" value="${escHtml(s.tab)}" style="${fld}"/></div>
      </div>
      <label style="${lbl}">Description</label>
      <textarea data-f="desc" rows="2" style="${fld};resize:vertical">${escHtml(s.desc)}</textarea>
      <label style="${lbl}">Actions (one per line)</label>
      <textarea data-f="actions" rows="3" style="${fld};resize:vertical">${escHtml((s.actions||[]).join('\n'))}</textarea>
      <label style="${lbl}">Output</label>
      <input data-f="out" value="${escHtml(s.out)}" style="${fld}"/>
    </div>`;

  container.innerHTML = `
    <div style="background:rgba(230,81,0,.08);border:1px solid rgba(230,81,0,.3);border-radius:12px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--text-muted)">
      ${emojiIcon('✏️',16)} <b style="color:var(--text)">Editing Sales SOP.</b> Changes are visible to everyone once saved. Use <code>**bold**</code> for emphasis.
    </div>

    <label style="${lbl}">Intro</label>
    <textarea id="sop-intro" rows="3" style="${fld};resize:vertical">${escHtml(d.intro)}</textarea>

    <div style="display:flex;justify-content:space-between;align-items:center;margin:18px 0 8px">
      <h4 style="margin:0;font-size:14px;color:var(--text)">Steps (${d.steps.length})</h4>
      <button class="btn-secondary btn-sm" id="sop-add-step">+ Add step</button>
    </div>
    <div id="sop-steps-edit" style="display:flex;flex-direction:column;gap:12px">
      ${d.steps.map((s,i)=>stepCard(s,i)).join('')}
    </div>

    <label style="${lbl};margin-top:18px">Golden Rules (one per line)</label>
    <textarea id="sop-rules" rows="6" style="${fld};resize:vertical">${escHtml((d.rules||[]).join('\n'))}</textarea>

    <div style="display:flex;gap:8px;margin-top:18px;position:sticky;bottom:0;background:var(--bg);padding:10px 0">
      <button class="btn-primary btn-sm" id="sop-save">${emojiIcon('💾',16)} Save SOP</button>
      <button class="btn-secondary btn-sm" id="sop-cancel">Cancel</button>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  document.getElementById('sop-add-step')?.addEventListener('click', () => {
    salesSopGatherDOM();
    d.steps.push({ short:'', title:'New Step', owner:'', tab:'', desc:'', actions:[], out:'' });
    drawSalesSOPEditor(container);
  });
  document.getElementById('sop-save')?.addEventListener('click', () => salesSopSave(container));
  document.getElementById('sop-cancel')?.addEventListener('click', () => renderSalesSOPView(container, window._salesSopData || DEFAULT_SALES_SOP));
  container.querySelectorAll('.sop-rm-step').forEach(b => b.addEventListener('click', () => {
    salesSopGatherDOM(); d.steps.splice(+b.dataset.i, 1); drawSalesSOPEditor(container);
  }));
  container.querySelectorAll('.sop-mv-up').forEach(b => b.addEventListener('click', () => {
    salesSopGatherDOM(); const i=+b.dataset.i; if(i>0){ const t=d.steps[i-1]; d.steps[i-1]=d.steps[i]; d.steps[i]=t; } drawSalesSOPEditor(container);
  }));
  container.querySelectorAll('.sop-mv-down').forEach(b => b.addEventListener('click', () => {
    salesSopGatherDOM(); const i=+b.dataset.i; if(i<d.steps.length-1){ const t=d.steps[i+1]; d.steps[i+1]=d.steps[i]; d.steps[i]=t; } drawSalesSOPEditor(container);
  }));
}

// Read the editor inputs back into the working draft (preserves edits across redraws).
function salesSopGatherDOM() {
  const d = window._salesSopDraft; if (!d) return;
  const introEl = document.getElementById('sop-intro'); if (introEl) d.intro = introEl.value;
  const rulesEl = document.getElementById('sop-rules'); if (rulesEl) d.rules = rulesEl.value.split('\n').map(x=>x.trim()).filter(Boolean);
  document.querySelectorAll('.sop-step-edit').forEach(card => {
    const i = +card.dataset.si; const st = d.steps[i]; if (!st) return;
    card.querySelectorAll('[data-f]').forEach(inp => {
      const f = inp.dataset.f;
      if (f === 'actions') st.actions = inp.value.split('\n').map(x=>x.trim()).filter(Boolean);
      else st[f] = inp.value;
    });
  });
}

async function salesSopSave(container) {
  salesSopGatherDOM();
  const d = window._salesSopDraft;
  // Drop fully-empty steps.
  d.steps = (d.steps||[]).filter(s => (s.title||'').trim() || (s.desc||'').trim() || (s.actions||[]).length);
  const btn = document.getElementById('sop-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    await db.collection('settings').doc('sales_sop').set({
      intro: d.intro||'', steps: d.steps, rules: d.rules||[],
      ...(d.sopVersion >= 2 ? { sopVersion: d.sopVersion } : {}),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: (typeof currentUser!=='undefined' && currentUser && currentUser.email) || ''
    }, { merge:true });
    const fresh = { intro:d.intro||'', steps:d.steps, rules:d.rules||[], sopVersion: d.sopVersion || 0,
      updatedAt: new Date(), updatedBy: (typeof currentUser!=='undefined' && currentUser && currentUser.email) || '' };
    window._salesSopData = fresh;
    window.Notifs?.showToast?.('SOP saved');
    renderSalesSOPView(container, fresh);
  } catch(e) {
    window.Notifs?.showToast?.('Save failed — ' + (e?.message||e));
    if (btn) { btn.disabled = false; btn.textContent = '💾 Save SOP'; }
  }
}


// ── BK Quotations Summary ────────────────────────
// Group quotes into revision lineages — base quote number (sans the -Rn suffix)
// + client — and keep only the LATEST revision of each. Returns the deduped
// `latest` array + a Set of superseded (older-revision) ids, so KPI totals stop
// double-counting R1 + R2 + … of the same quote.
window.latestQuoteRevisions = function(quotes){
  // Dash-OPTIONAL /-?R\d+/ — the v14 compact filed format is dash-free before
  // the R (…260803-013R1, not …-013-R1), so the old dash-required /-R\d+/
  // matched NOTHING: every revision got revOf=1 and a distinct lineage, so R1
  // and R2 of one quote were never grouped and BOTH counted (inflated the BK
  // quotations KPIs). Same fix already applied to app.js revOf + bumpRevisionNo.
  const revOf = q => { const m=String(q.quoteNumber||q.editableState?.quoteNo||'').match(/-?R(\d+)\s*$/i); return m?parseInt(m[1],10):1; };
  const lineageOf = q => {
    const base = String(q.quoteNumber||q.editableState?.quoteNo||'').replace(/-?R\d+\s*$/i,'').trim();
    const client = (q.clientName||'').trim().toLowerCase();
    return base ? (base+'||'+client) : ('id::'+q.id);   // unnumbered → its own lineage (no dedup)
  };
  const best = new Map();
  (quotes||[]).forEach(q => {
    const k = lineageOf(q), cur = best.get(k);
    const better = !cur || revOf(q) > revOf(cur) ||
      (revOf(q)===revOf(cur) && (q.createdAt?.seconds||0) >= (cur.createdAt?.seconds||0));
    if (better) best.set(k, q);
  });
  const latest = [...best.values()];
  const keep = new Set(latest.map(q=>q.id));
  const supersededIds = new Set((quotes||[]).filter(q=>!keep.has(q.id)).map(q=>q.id));
  return { latest, supersededIds };
};

// ── Canonical quote PIPELINE value (30-agent beta sweep fix) ─────────────
// Three screens computed "pipeline value" three different ways off the same
// quotes: this BS Quote Analytics card summed ALL active quotes including
// rejected ones (no exclusion at all); the Analytics screen's "Pipeline
// Value" KPI used window.quoteWinStats().pipelineVal, which only counts OPEN
// (undecided) quotes and silently drops won ones; the Command Center's Quote
// Pipeline card used yet a third inline calc. Command Center's rule — latest
// revision per lineage (window.latestQuoteRevisions), excluding
// rejected/lost — is the one kept correct in the audit, so it becomes THE
// single definition here; the Command Center card, this screen's Pipeline ₱,
// and the Analytics screen's Pipeline Value KPI all now call this one
// function instead of three separate inline formulas. `quotes` may be raw
// (undeduped) or already deduped — the dedup below is a no-op on an
// already-deduped array (one doc per lineage either way).
window.quotePipelineValue = function(quotes){
  const latest = window.latestQuoteRevisions ? window.latestQuoteRevisions(quotes||[]).latest : (quotes||[]);
  const active = latest.filter(q => !['rejected','lost'].includes(q.status));
  return active.reduce((s,q)=>s+(Number(q.total)||Number(q.grandTotal)||Number(q.amount)||0),0);
};

// ── Wave 7 Pass 2 — revision-chain UI (the one net-new feature this pass) ──
// Groups a flat, already createdAt-desc-sorted quote array into per-lineage
// chains keyed by Wave 3 Q5's rootQuoteId. Fallback: a doc with no
// rootQuoteId (every pre-Wave-3 quote) groups under its OWN id, i.e. becomes
// a singleton chain of 1 — which renders identically to the old flat list
// (see each call site below: chain.history.length < 2 short-circuits to the
// exact same markup as before this pass). Pure grouping over data the
// caller already fetched for its list — no reads, no writes, no refetch.
//   Returns [{ key, primary, history }], one entry per chain, in the same
//   relative order as the first occurrence of that chain's key in `quotes`.
//   `history` is oldest→newest; `primary` is history's last element (the
//   newest revision — what a non-chain-aware list already showed standalone,
//   since quotes are fetched createdAt-desc and a chain's newest revision is
//   always the first of its members encountered in that order).
function buildQuoteChains(quotes) {
  const revOf = q => { const m = String(q.quoteNumber || q.editableState?.quoteNo || '').match(/-R(\d+)\s*$/i); return m ? parseInt(m[1],10) : 1; };
  const groups = new Map();
  const order = [];
  (quotes || []).forEach(q => {
    const key = q.rootQuoteId || q.id;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(q);
  });
  return order.map(key => {
    const members = groups.get(key).slice().sort((a, b) =>
      (revOf(a) - revOf(b)) || ((a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)));
    return { key, primary: members[members.length - 1], history: members };
  });
}

// Peso + % delta of one chain revision vs the one immediately before it —
// same coloured-arrow visual language as window.momDelta (config.js), just
// labelled for a revision-to-revision comparison instead of a calendar month
// (momDelta's own label text is hardcoded to "vs last mo", so it isn't
// reusable verbatim here; this mirrors its up/good-color/pct-rounding logic).
function quoteRevDeltaHtml(cur, prev) {
  cur = Number(cur) || 0; prev = Number(prev) || 0;
  if (!prev) return `<span style="font-size:11px;color:var(--text-muted)">first filing</span>`;
  const diff = cur - prev;
  if (!diff) return `<span style="font-size:11px;color:var(--text-muted)">→ no change</span>`;
  const up = diff > 0;
  const color = up ? 'var(--success,#30D158)' : 'var(--danger,#e5484d)';
  // Re-audit fix — a near-zero prior revision (e.g. a ₱1 typo corrected to
  // ₱50,000 in R2) used to render as nonsense like "+4999900%" since the
  // only guard was an exactly-zero check. Below a ₱100 prior-revision
  // floor, the percentage is meaningless (dividing by a near-zero base) —
  // label it a flat data correction instead and let the peso diff (already
  // shown, unaffected by this change) carry the real information.
  const pctHtml = Math.abs(prev) < 100
    ? `<span style="font-weight:400;color:var(--text-muted)">(data correction)</span>`
    : `<span style="font-weight:400;color:var(--text-muted)">(${up?'+':'−'}${Math.abs(Math.round((diff/Math.abs(prev))*100))}%)</span>`;
  return `<span style="font-size:11px;font-weight:700;color:${color}">${up?'▲':'▼'} ₱${fmt(Math.abs(diff))} ${pctHtml}</span>`;
}

// Hidden <tr> siblings (table row structure, not <details> — a <tbody>'s
// only valid direct children are <tr>) revealed by a "v N · history" toggle
// in the chain's primary <tr>. Used by renderBSQuotationsSummary's table
// list. Each history row keeps working Reopen/New Revision buttons with the
// SAME bs-reopen-btn/bs-rev-btn classes the primary row uses, so
// bindQuoteActions (which queries the whole list container, not just
// top-level rows) binds them for free.
function quoteChainTableRowsHtml(chain) {
  if (chain.history.length < 2) return '';
  return chain.history.map((q, i) => {
    const prev = i > 0 ? chain.history[i - 1] : null;
    const tot = Number(q.total) || Number(q.grandTotal) || Number(q.amount) || 0;
    const prevTot = prev ? (Number(prev.total) || Number(prev.grandTotal) || Number(prev.amount) || 0) : 0;
    const ts = q.createdAt?.toDate ? q.createdAt.toDate().toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '';
    const status = q.status || q.approvalStatus || 'draft';
    return `<tr class="bsq-hist-row" data-chain="${escHtml(chain.key)}" hidden>
      <td class="tc-avatar" style="padding-left:22px"><code>R${i+1}</code></td>
      <td class="tc-detail" colspan="2" data-label="Revision">${escHtml(ts)} · ${escHtml(q.agentName||q.createdByName||'—')} · <strong>₱${fmt(tot)}</strong></td>
      <td class="tc-detail" colspan="2" data-label="vs prior">${i>0?quoteRevDeltaHtml(tot,prevTot):'<span style="font-size:11px;color:var(--text-muted)">first filing</span>'}</td>
      <td class="tc-actions" style="white-space:nowrap">
        ${(status==='filed'||status==='approved')?`<button class="btn-secondary btn-sm bs-reopen-btn" data-id="${q.id}" title="Open this quote in the builder to edit — re-filing saves a new copy">↻ Reopen</button>`:''}
        ${(status==='filed'||status==='approved')&&q.editableState?`<button class="btn-secondary btn-sm bs-rev-btn" data-id="${q.id}" title="Start a new revision (R2, R3…) for this client with today's date">${emojiIcon('⎘',16)} New Revision</button>`:''}
        ${(status==='filed'||status==='approved')&&!q.editableState?`<span style="font-size:10px;color:var(--text-muted)" title="No editable snapshot was saved for this revision, so Reopen has nothing to load and New Revision isn't offered.">no snapshot</span>`:''}
      </td>
    </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
//  QUOTE: MARK SENT · LOST · REOPEN (SALES-QUICK-FIXES-SPEC-2026-11-19 §3.1, §5.1)
//  All three are ordinary updates on the quote (creator or admin, per firestore.rules) and are collection-aware:
//  `coll` is 'bk_quotes' or 'bs_quotes' (only the BK list wires them in this batch). The pure rules — which reasons
//  exist, what a valid note is, which statuses show the buttons — live in js/sales-flow-core.js.
// ═══════════════════════════════════════════════════════════════════════════
// "Sent" is a STAMP, not a status: `status` is left alone, so Share, the stale badge, the follow-up reminders and the
// builder bridge keep treating the quote as filed. One tap, no dialog.
window.markQuoteSent = async function(coll, id, onDone) {
  onDone = onDone || (()=>{});
  const u = window.currentUser || {};
  const who = (window.userProfile && window.userProfile.displayName) || u.email || '';
  try {
    await db.collection(coll).doc(id).update({
      sentAt: firebase.firestore.FieldValue.serverTimestamp(), sentDate: window.bizDate(), sentBy: u.uid, sentByName: who
    });
    if (coll === 'bs_quotes' && window.invalidateBsQuotesCache) window.invalidateBsQuotesCache(u.uid);
    window.logAudit && window.logAudit('update', 'quote', id, { sent: true });
    Notifs.success('Marked as sent');
    onDone();
  } catch (e) {
    Notifs.showToast('Could not mark as sent: ' + (e.message || e.code), 'error');
  }
};

// Lost needs a reason (and a note when the reason is "Other"). The previous status is kept so Reopen can put the quote back.
window.openMarkQuoteLost = function(coll, q, onDone) {
  onDone = onDone || (()=>{});
  const SF = window.SalesFlow;
  const _panel = openPage('Mark quote as lost', `
    <div style="font-size:12px;margin-bottom:10px"><strong>${escHtml(q.quoteNumber || String(q.id).slice(-6).toUpperCase())}</strong> — ${escHtml(q.clientName || 'Unnamed')}</div>
    <div class="form-group">
      ${SF.LOST_REASONS.map(r => `<label class="check-row" style="display:flex"><input type="radio" name="lost-reason" value="${escHtml(r.code)}"/> ${escHtml(r.label)}</label>`).join('')}
    </div>
    <div class="form-group"><textarea id="lost-note" rows="2" maxlength="300" placeholder="Note (required for Other)"></textarea></div>
    <div id="lost-err" class="error-msg hidden"></div>
  `, `<button class="btn-danger" id="lost-save">Mark as lost</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  // ⚠ scoped to THIS panel, not document (a closing panel lingers ~300ms and would win a document-level lookup)
  const $ = (id) => _panel.querySelector('#' + id);
  $('lost-save').addEventListener('click', () => window.busy($('lost-save'), async () => {
    const code = (_panel.querySelector('input[name="lost-reason"]:checked') || {}).value || '';
    const note = ($('lost-note').value || '').trim();
    const bad = SF.validateLost(code, note);
    if (bad) { const err = $('lost-err'); err.textContent = bad; err.classList.remove('hidden'); return; }
    const u = window.currentUser || {};
    const who = (window.userProfile && window.userProfile.displayName) || u.email || '';
    const label = SF.lostReasonLabel(code);
    try {
      await db.collection(coll).doc(q.id).update({
        ...window.quoteStateFields('lost'),
        lostReason: code, lostReasonLabel: label, lostNote: note,
        lostAt: firebase.firestore.FieldValue.serverTimestamp(), lostBy: u.uid, lostByName: who,
        lostPrevStatus: q.status, lostPrevApprovalStatus: q.approvalStatus || null
      });
    } catch (e) {
      const err = $('lost-err'); err.textContent = 'Failed: ' + (e.message || e.code); err.classList.remove('hidden'); return;
    }
    if (coll === 'bs_quotes' && window.invalidateBsQuotesCache) window.invalidateBsQuotesCache(u.uid);
    window.logAudit && window.logAudit('update', 'quote', q.id, { lost: code });
    // N6: tell the President (not when he marked it himself). A failed notification never fails the write.
    if (!(typeof isRealPresident === 'function' && isRealPresident())) {
      try {
        await Notifs.sendToOwner({ title: '✖️ Quote lost',
          body: `${who}: ${q.quoteNumber || String(q.id).slice(-6).toUpperCase()} — ${q.clientName || 'Unnamed'}. Reason: ${label}${note ? ' — ' + note : ''}`,
          icon: '✖️', type: 'quote_lost', link: coll === 'bs_quotes' ? 'bs-quotations' : 'bk-quotations' });
      } catch (_) {}
    }
    closeModal();
    Notifs.success('Quote marked as lost');
    onDone();
  }));
};

// Back to where it was (the status and approval status saved when it was marked lost). Leaves a trace in the audit log.
window.reopenLostQuote = async function(coll, q, onDone) {
  onDone = onDone || (()=>{});
  const prev = q.lostPrevStatus || 'filed';
  const ok = await window.confirmDialog({ message: 'Reopen this quote? It goes back to "' + window.statusLabel2('quote', prev) + '".' });
  if (!ok) return;
  const u = window.currentUser || {};
  const FV = firebase.firestore.FieldValue;
  try {
    await db.collection(coll).doc(q.id).update({
      status: prev, approvalStatus: q.lostPrevApprovalStatus || 'filed',
      lostReason: FV.delete(), lostReasonLabel: FV.delete(), lostNote: FV.delete(), lostAt: FV.delete(),
      lostBy: FV.delete(), lostByName: FV.delete(), lostPrevStatus: FV.delete(), lostPrevApprovalStatus: FV.delete()
    });
  } catch (e) {
    Notifs.showToast('Could not reopen the quote: ' + (e.message || e.code), 'error');
    return;
  }
  if (coll === 'bs_quotes' && window.invalidateBsQuotesCache) window.invalidateBsQuotesCache(u.uid);
  window.logAudit && window.logAudit('update', 'quote', q.id, { reopened: true, from: q.lostReason || '' });
  Notifs.success('Quote reopened');
  onDone();
};

async function renderBKQuotationsSummary(container, currentUser, currentRole) {
  const isPrivileged = ['president','manager','finance'].includes(currentRole);
  const isAdmin = ['president','manager','secretary'].includes(currentRole);
  container.innerHTML = window.skeletonHtml('rows');
  const q = isPrivileged
    ? db.collection('bk_quotes').orderBy('createdAt','desc')
    : db.collection('bk_quotes').where('createdBy','==',currentUser.uid).orderBy('createdAt','desc');
  // 8-point #3 — a failed read used to silently render as "no quotations"
  // (the old .catch(()=>({docs:[]})) swallowed the error entirely). Surface
  // it instead, with a retry that just re-invokes this same render call.
  let snap;
  try { snap = await q.get(); }
  catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load quotations</h4><p>${escHtml(err.message||String(err))}</p><button type="button" class="btn-secondary btn-sm bkq-retry-btn" style="margin-top:14px">Retry</button></div>`;
    container.querySelector('.bkq-retry-btn')?.addEventListener('click', () => renderBKQuotationsSummary(container, currentUser, currentRole));
    if (window.lucide) lucide.createIcons({ nodes: [container] });
    return;
  }
  const allDocs = snap.docs.map(d=>({id:d.id,...d.data()}));
  // QB-DRAFTS-SPEC-2026-09-11 — explicit drafts (status:'draft', createdAt
  // set) get their own chip-tab pane below and leave the flat list/KPIs
  // entirely; `quotes` (used everywhere else in this function) becomes the
  // non-draft remainder.
  const draftDocs = allDocs.filter(q=>(q.status||'draft')==='draft');
  const quotes = allDocs.filter(q=>(q.status||'draft')!=='draft');
  // The one-slot autosave (draft_{uid}) carries no createdAt, so the
  // orderBy('createdAt') query above never returns it — fetch it directly so
  // a crash-recovery draft shows up here too, even before it's ever been
  // explicitly named via 💾 Save draft.
  const slotDoc = await db.collection('bk_quotes').doc('draft_'+currentUser.uid).get().catch(()=>null);
  if (slotDoc && slotDoc.exists && !draftDocs.some(d=>d.id===slotDoc.id)) {
    draftDocs.unshift({ id: slotDoc.id, ...slotDoc.data(), _autosave:true });
  }

  // KPI totals count only the LATEST revision of each quote — older revisions
  // (R1 when an R2 exists) are superseded and must not inflate the value/counts.
  const { latest: activeQuotes, supersededIds } = window.latestQuoteRevisions(quotes);
  // H8 fix — some BK/BS quotes store the value under grandTotal (or amount), not
  // total; a bare q.total silently reads as ₱0 for those. Same fallback chain as
  // app.js's quote pipeline (~line 2815).
  // Quote Value leaves out quotes that are lost (or rejected): a dead quote is not pipeline.
  const total      = activeQuotes.filter(q => !window.isQuoteLost(q)).reduce((s,q)=>s+(Number(q.total)||Number(q.grandTotal)||Number(q.amount)||0),0);
  const accepted   = activeQuotes.filter(q=>q.status==='accepted');
  const acceptedT  = accepted.reduce((s,q)=>s+(Number(q.total)||Number(q.grandTotal)||Number(q.amount)||0),0);
  // "Sent" is a stamp (sentAt, written by Mark sent), not a status — `status` stays 'filed' so Share, the stale badge and the reminders keep working.
  // Legacy quotes with status 'sent' still count.
  const sent       = activeQuotes.filter(q => q.sentAt || q.status==='sent').length;
  const lost       = activeQuotes.filter(q => q.status==='lost').length;
  // QB-DRAFTS-SPEC-2026-09-11 — drafts no longer live inside `quotes`/
  // `activeQuotes`; count the dedicated bucket instead (autosave slot incl.).
  const draft      = draftDocs.length;
  // v12 WS31 Spec 10 — "filed but no Sales Order yet" staleness, pure client-side
  // over rows this screen already fetched. Zero new reads.
  const staleDaysOf = q => (q.status==='filed' && !q.salesOrderId && q.createdAt)
    ? Math.floor((Date.now() - (q.createdAt.seconds||0)*1000) / 86400000) : 0;
  const staleCount = activeQuotes.filter(q => staleDaysOf(q) > window.QUOTE_STALE_DAYS).length;

  // Single quote card — reused by both the flat list and the by-customer view.
  const quoteCard = (q) => {
    const superseded = supersededIds.has(q.id);
    const wonish = !superseded && ['filed','accepted','won','approved'].includes(q.status);
    const canDel = isAdmin || currentRole==='finance' || q.createdBy===currentUser.uid;
    // bk_quotes holds TWO companies now (owner ruling 2026-08-07): Barro
    // Kitchens AND Barro Industries, the parent company's general-fabrication
    // identity. Everything brand-bearing on this card derives from q.company so
    // a fabrication quote is never presented — or acted on — as a kitchen one.
    // Legacy docs predate the field entirely, hence the 'BK' default.
    const qco    = q.company || 'BK';
    const label  = `${qco} quote ${q.quoteNumber||q.id.slice(-6).toUpperCase()} (${q.clientName||'Unnamed'})`;
    // Barro Kitchens is the default identity of this list, so only the OTHER
    // company gets a tag — kitchen cards stay exactly as they were.
    const coTag  = qco === 'BK' ? '' :
      ` <span class="badge badge-blue" style="font-size:9px" title="General fabrication quote — issued under the parent company, not Barro Kitchens">${escHtml(window.quoteCompanyLabel(qco))}</span>`;
    const staleDays = staleDaysOf(q);
    return `
      <div class="item-card" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap${superseded?';opacity:.6':(q.status==='lost'?';opacity:.7':'')}">
        <div style="flex:1;min-width:160px">
          <div class="item-title" style="font-size:13px">${escHtml(window.quoteDisplayNo(q))} — ${escHtml(q.clientName||'Unnamed')}${coTag}${superseded?' <span class="badge badge-gray" style="font-size:9px">superseded</span>':''}</div>
          <div class="item-meta" style="margin-top:4px">
            <span>${escHtml(q.scope||'Custom')}</span>
            <span>${escHtml(q.agentName||'—')}</span>
            ${q.date?`<span>${q.date}</span>`:''}
            ${staleDays > window.QUOTE_STALE_DAYS ? `<span class="badge badge-orange" style="font-size:9px" title="Filed but no payment recorded yet">${emojiIcon('⚠',9)} ${staleDays}d no SO</span>` : ''}
          </div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700${superseded?';text-decoration:line-through;color:var(--text-muted)':''}">₱${fmt(Number(q.total)||Number(q.grandTotal)||Number(q.amount)||0)}</div>
          ${(() => { const ab = window.quoteApprovalBadge(q); return ab
            ? `<span class="badge ${ab.cls}" style="margin-top:4px">${ab.label}</span>`
            : `<span class="badge ${window.statusBadgeClass('quote', q.salesOrderId?'won':(q.status||'draft'))}" style="margin-top:4px">${window.statusLabel2('quote', q.salesOrderId?'won':(q.status||'draft'))}</span>`; })()}
          ${(q.sentAt || q.status==='sent')?`<span class="badge badge-blue" style="font-size:9px;margin-left:4px">Sent${q.sentDate ? ' · ' + escHtml(q.sentDate) : ''}</span>`:''}
          ${q.status==='lost'?`<div style="font-size:10px;color:var(--text-muted)">${escHtml(q.lostReasonLabel||'')}${q.lostNote ? ' — ' + escHtml(q.lostNote) : ''}</div>`:''}
          ${q.deleteRequested?`<span class="badge badge-red" style="font-size:10px;margin-left:4px">${emojiIcon('🗑',10)} del req</span>`:''}
          ${window.quoteShareChipHtml(q)}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;width:100%;justify-content:flex-end;align-items:center">
          ${q.editableState?`<button class="btn-secondary btn-sm bk-reopen-btn" data-id="${q.id}" title="Open this quote in the builder to edit — re-filing saves a new copy">↻ Reopen</button>`:''}
          ${q.editableState?`<button class="btn-secondary btn-sm bk-rev-btn" data-id="${q.id}" title="Start a new revision (R2, R3…) for this client with today's date">${emojiIcon('⎘',16)} New Revision</button>`:''}
          ${!q.editableState?`<span style="font-size:10px;color:var(--text-muted)" title="This quote was filed before edit history was captured (or the snapshot write failed) — there's nothing here to reopen or revise.">No editable snapshot</span>`:''}
          ${window.QUOTE_SHAREABLE_STATUSES.includes(q.status)?`<button class="btn-secondary btn-sm bk-share-btn" data-id="${q.id}" title="Get a client-facing link — no login needed — to Accept or Request changes">${emojiIcon('🔗',16)} Share</button>`:''}
          ${window.SalesFlow.canMarkSent(q, superseded)?`<button class="btn-secondary btn-sm bk-sent-btn" data-id="${q.id}" title="Record that this quotation went out to the client">${emojiIcon('📨',16)} Mark sent</button>`:''}
          ${wonish?`<button class="btn-success btn-sm bk-so-btn" data-id="${q.id}" data-qno="${escHtml(q.quoteNumber||'')}" data-client="${escHtml(q.clientName||'')}" data-client-id="${q.clientId||''}" data-total="${Number(q.total)||Number(q.grandTotal)||Number(q.amount)||0}" data-co="${escHtml(qco)}" ${q.salesOrderId?'disabled':''}>${q.salesOrderId?`${emojiIcon('✓',16)} Ordered`:`${emojiIcon('💵',16)} Record payment`}</button>`:''}
          ${window.SalesFlow.canMarkLost(q, superseded)?`<button class="btn-secondary btn-sm bk-lost-btn" data-id="${q.id}" style="color:var(--danger)" title="The client said no — choose the reason">Lost</button>`:''}
          ${window.SalesFlow.canReopenLost(q)?`<button class="btn-secondary btn-sm bk-unlost-btn" data-id="${q.id}" title="Put this quote back where it was">Reopen quote</button>`:''}
          ${(canDel && !q.deleteRequested)?`<button class="btn-secondary btn-sm bk-del-btn" data-id="${q.id}" data-label="${escHtml(label)}" data-by="${q.createdBy||''}">${emojiIcon('🗑',16)} Delete</button>`:''}
        </div>
      </div>`;
  };

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:20px">
      <div class="stat-card"><div class="stat-num">${activeQuotes.length}</div><div class="stat-label">Total Quotes${supersededIds.size?` <span style="font-size:9px;color:var(--text-muted)">(+${supersededIds.size} rev)</span>`:''}</div></div>
      <div class="stat-card"><div class="stat-num">₱${fmt(total)}</div><div class="stat-label">Quote Value</div></div>
      <div class="stat-card"><div class="stat-num">${accepted.length}</div><div class="stat-label">Accepted</div></div>
      <div class="stat-card"><div class="stat-num">₱${fmt(acceptedT)}</div><div class="stat-label">Accepted Value</div></div>
      <div class="stat-card"><div class="stat-num">${sent}</div><div class="stat-label">Sent</div></div>
      <div class="stat-card"><div class="stat-num">${lost}</div><div class="stat-label">Lost</div></div>
      <div class="stat-card"><div class="stat-num">${draft}</div><div class="stat-label">Drafts</div></div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <h4 style="font-weight:700;margin:0">All Quotations${staleCount?` <span class="badge badge-orange" style="font-size:10px;font-weight:700">${emojiIcon('⚠',10)} ${staleCount} stale</span>`:''}</h4>
      ${window.chipTabs([{key:'list',label:'List'},{key:'customer',label:'By Customer'},{key:'drafts',label:'📝 Drafts'}],'list',{cls:'bkq-view'})}
    </div>
    <div id="bkq-body"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  const bindCardActions = () => {
    container.querySelectorAll('.bk-so-btn').forEach(b=>b.addEventListener('click', e=>openSalesOrderModal(e.currentTarget.dataset, currentUser, currentRole, container)));
    // Re-audit fix (HIGH) — this used to set window._qbReopenState directly and
    // navigate, bypassing window.reopenQuoteFromDoc (app.js). That function is
    // the only path that stamps sourceDocId/sourceCollection/rootQuoteId onto
    // the reopened state, so a quote reopened via this button (the more
    // commonly used action vs. New Revision) always refiled with
    // parentQuoteId:null/rootQuoteId:null and self-stamped a brand-new
    // rootQuoteId — silently breaking buildQuoteChains' revision-chain link
    // back to the original. Routing through the shared helper (same one
    // .bk-rev-btn already uses below) fixes both this list and the nested
    // chain-history rows in one place.
    container.querySelectorAll('.bk-reopen-btn').forEach(b=>b.addEventListener('click', e=>
      window.reopenQuoteFromDoc('bk_quotes', e.currentTarget.dataset.id, 'bk-quote-builder')));
    container.querySelectorAll('.bk-rev-btn').forEach(b=>b.addEventListener('click', e=>
      window.newRevisionFromDoc('bk_quotes', e.currentTarget.dataset.id, 'bk-quote-builder')));
    container.querySelectorAll('.bk-share-btn').forEach(b=>b.addEventListener('click', e=>
      window.shareQuoteWithClient('bk_quotes', e.currentTarget.dataset.id, ()=>renderBKQuotationsSummary(container, currentUser, currentRole))));
    // Sent / Lost / Reopen (SALES-QUICK-FIXES-SPEC §5.1): a Sent stamp, a Lost with a reason, and a way back.
    const bkRerender = () => renderBKQuotationsSummary(container, currentUser, currentRole);
    container.querySelectorAll('.bk-sent-btn').forEach(b=>b.addEventListener('click', e=>
      window.busy(e.currentTarget, () => window.markQuoteSent('bk_quotes', e.currentTarget.dataset.id, bkRerender))));
    container.querySelectorAll('.bk-lost-btn').forEach(b=>b.addEventListener('click', e=>{
      const q = allDocs.find(x => x.id === e.currentTarget.dataset.id); if (q) window.openMarkQuoteLost('bk_quotes', q, bkRerender);
    }));
    container.querySelectorAll('.bk-unlost-btn').forEach(b=>b.addEventListener('click', e=>{
      const q = allDocs.find(x => x.id === e.currentTarget.dataset.id); if (q) window.reopenLostQuote('bk_quotes', q, bkRerender);
    }));
    container.querySelectorAll('.bk-del-btn').forEach(b=>b.addEventListener('click', e=>{
      const d=e.currentTarget.dataset;
      window.requestQuoteDelete('bk_quotes', d.id, d.label, d.by, ()=>renderBKQuotationsSummary(container, currentUser, currentRole));
    }));
  };

  // Wave 7 Pass 2 — chain-aware card: the newest revision renders exactly
  // like quoteCard() always has (unchanged function, unchanged markup); a
  // chain of 2+ additionally gets a "v N · history" <details> underneath
  // with each older revision's date/filer/total/delta-vs-previous and its
  // own working Reopen/New Revision buttons (bindCardActions above already
  // queries the whole container, so it binds these nested buttons too).
  // Chains of 1 (every doc without a same-lineage sibling — including every
  // pre-Wave-3 doc, which has no rootQuoteId at all) render NOTHING extra.
  const quoteChainCard = (chain) => {
    const primaryHtml = quoteCard(chain.primary);
    if (chain.history.length < 2) return primaryHtml;
    const rows = chain.history.map((q, i) => {
      const prev = i > 0 ? chain.history[i - 1] : null;
      const tot = Number(q.total) || Number(q.grandTotal) || Number(q.amount) || 0;
      const prevTot = prev ? (Number(prev.total) || Number(prev.grandTotal) || Number(prev.amount) || 0) : 0;
      const ts = q.date || (q.createdAt?.toDate ? q.createdAt.toDate().toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '');
      return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px${i?';border-top:1px solid var(--border)':''}">
        <div style="flex:1;min-width:120px;font-size:12px"><strong>R${i+1}</strong> · ${escHtml(ts)} · ${escHtml(q.agentName||'—')}</div>
        <div style="font-size:12px;font-weight:700">₱${fmt(tot)}</div>
        <div>${i>0?quoteRevDeltaHtml(tot,prevTot):'<span style="font-size:11px;color:var(--text-muted)">first filing</span>'}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          ${q.editableState?`<button class="btn-secondary btn-sm bk-reopen-btn" data-id="${q.id}" title="Open this quote in the builder to edit — re-filing saves a new copy">↻ Reopen</button>`:''}
          ${q.editableState?`<button class="btn-secondary btn-sm bk-rev-btn" data-id="${q.id}" title="Start a new revision (R2, R3…) for this client with today's date">${emojiIcon('⎘',16)} New Revision</button>`:''}
          ${!q.editableState?`<span style="font-size:10px;color:var(--text-muted)" title="This revision was filed before edit history was captured — there's nothing here to reopen or revise.">No editable snapshot</span>`:''}
        </div>
      </div>`;
    }).join('');
    return `${primaryHtml}
      <details class="quote-chain-history" style="margin:-6px 0 10px">
        <summary style="cursor:pointer;font-size:11px;color:var(--text-muted);padding:4px 6px">v${chain.history.length} · history</summary>
        <div style="background:var(--s1,rgba(255,255,255,.03));border:1px solid var(--border);border-radius:10px;margin-top:4px">${rows}</div>
      </details>`;
  };

  // QB-DRAFTS-SPEC-2026-09-11 — Drafts pane card: client name (or "Untitled
  // draft"), company tag, ₱ value when > 0, an "Auto-saved" badge for the
  // one autosave slot doc, saved-when date, and Resume/Delete actions.
  const draftCard = (q) => {
    const qco = q.company || 'BK';
    const coTag = qco === 'BK' ? '' :
      ` <span class="badge badge-blue" style="font-size:9px" title="General fabrication quote — issued under the parent company, not Barro Kitchens">${escHtml(window.quoteCompanyLabel(qco))}</span>`;
    const amt = Number(q.total)||Number(q.grandTotal)||Number(q.amount)||0;
    const savedAt = q.draftAt || q.createdAt;
    const savedWhen = savedAt?.toDate ? savedAt.toDate().toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '';
    const label = q.clientName || q.clientCompany || 'Untitled draft';
    return `
      <div class="item-card" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:160px">
          <div class="item-title" style="font-size:13px">${escHtml(label)}${coTag}${q._autosave?' <span class="badge badge-gray" style="font-size:9px">Auto-saved</span>':''}</div>
          <div class="item-meta" style="margin-top:4px">
            ${savedWhen?`<span>${escHtml(savedWhen)}</span>`:''}
          </div>
        </div>
        ${amt>0?`<div style="text-align:right"><div style="font-weight:700">₱${fmt(amt)}</div></div>`:''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;width:100%;justify-content:flex-end;align-items:center">
          ${q.editableState?`<button class="btn-secondary btn-sm bk-draft-resume-btn" data-id="${q.id}" title="Open this draft in the builder">↻ Resume</button>`:`<span style="font-size:10px;color:var(--text-muted)" title="No editable snapshot was saved for this draft.">no snapshot</span>`}
          <button class="btn-secondary btn-sm bk-draft-del-btn" data-id="${q.id}" data-label="${escHtml(label)}">${emojiIcon('🗑',16)} Delete</button>
        </div>
      </div>`;
  };
  const bindDraftActions = () => {
    container.querySelectorAll('.bk-draft-resume-btn').forEach(b=>b.addEventListener('click', e=>
      window.resumeDraftFromDoc('bk_quotes', e.currentTarget.dataset.id)));
    container.querySelectorAll('.bk-draft-del-btn').forEach(b=>b.addEventListener('click', async e=>{
      const d=e.currentTarget.dataset;
      if (!(await confirmDialog({message:`Delete draft "${escHtml(d.label)}"? This cannot be undone.`, danger:true, html:true}))) return;
      try {
        await db.collection('bk_quotes').doc(d.id).delete();
        Notifs.success('Draft deleted');
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('all-quotes');
        renderBKQuotationsSummary(container, currentUser, currentRole);
      } catch(ex){ Notifs.showToast('Delete failed: '+(ex.message||ex.code),'error'); }
    }));
  };

  const renderBody = (view) => {
    const body = container.querySelector('#bkq-body');
    if (!body) return;
    if (view === 'drafts') {
      if (!draftDocs.length) {
        body.innerHTML = window.renderEmptyState({ icon:'📝', title:'No drafts.', hint:'💾 Save draft in the quote builder parks an unfinished quote here — no amounts needed.' });
        return;
      }
      const sorted = [...draftDocs].sort((a,b)=>((b.draftAt?.seconds||b.createdAt?.seconds||0)-(a.draftAt?.seconds||a.createdAt?.seconds||0)));
      body.innerHTML = `<div class="item-list">${sorted.map(draftCard).join('')}</div>`;
      bindDraftActions();
      if (window.lucide) lucide.createIcons({ nodes: [body] });
      return;
    }
    if (!quotes.length) { body.innerHTML = window.renderEmptyState({ icon:'📋', title:'No quotations yet' }); return; }
    if (window.lucide) lucide.createIcons({ nodes: [body] });
    if (view === 'customer') {
      const groups = {};
      quotes.forEach(q=>{ const k=((q.clientName||'').trim())||'Unnamed'; (groups[k]=groups[k]||[]).push(q); });
      body.innerHTML = Object.keys(groups).sort((a,b)=>a.localeCompare(b)).map(name=>{
        const gq=groups[name];
        // Customer total = latest revisions only (superseded ones don't add up).
        const active=gq.filter(x=>!supersededIds.has(x.id)); const gt=active.reduce((s,x)=>s+(Number(x.total)||Number(x.grandTotal)||Number(x.amount)||0),0);
        return `<details open style="background:var(--s1);border:1px solid var(--border);border-radius:12px;padding:8px 12px;margin-bottom:10px">
          <summary style="cursor:pointer;font-weight:700;font-size:13px;display:flex;align-items:center;gap:8px">
            <span style="flex:1">${escHtml(name)} <span class="badge badge-gray" style="font-size:10px">${active.length}${gq.length!==active.length?` +${gq.length-active.length}`:''}</span></span>
            <span style="font-weight:700;color:var(--text-muted)">₱${fmt(gt)}</span>
          </summary>
          <div class="item-list" style="margin-top:8px">${buildQuoteChains(gq).map(quoteChainCard).join('')}</div>
        </details>`;
      }).join('');
    } else {
      body.innerHTML = `<div class="item-list">${buildQuoteChains(quotes).map(quoteChainCard).join('')}</div>`;
    }
    bindCardActions();
  };

  window.bindChipTabs(container.querySelector('.bkq-view'), (key)=>renderBody(key));
  renderBody('list');

  // v12 WS31 — one-time stranding-repair banner (president only). Quotes filed
  // with "Send to president for review first" on company:'BK' used to be
  // hardcoded into bs_quotes (the old QUOTE_APPROVAL_REQUESTED bug); surface
  // any still-stranded docs here with a one-click, idempotent repair.
  if (currentRole === 'president') {
    db.collection('bs_quotes').where('company','==','BK').get().then(strandedSnap => {
      const n = strandedSnap.docs.length;
      if (!n) return;
      const bar = document.createElement('div');
      bar.className = 'alert-banner';
      bar.style.cssText = 'margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap';
      bar.innerHTML = `<span>${emojiIcon('🧭',16)} ${n} Barro Kitchens quote(s) are stranded in the Brilliance Steel collection.</span><button class="btn-primary btn-sm" id="bkq-repair-btn">Repair now</button>`;
      if (window.lucide) lucide.createIcons({ nodes: [bar] });
      container.prepend(bar);
      document.getElementById('bkq-repair-btn').addEventListener('click', async () => {
        const btn = document.getElementById('bkq-repair-btn');
        btn.disabled = true; btn.textContent = 'Repairing…';
        try {
          const out = await window.migrateStrandedBKQuotes();
          window.logAudit && window.logAudit('migrate','bk_quotes',null,out);
          Notifs.success(`Moved ${out.moved} quote(s), patched ${out.reqsPatched} approval request(s)`);
          renderBKQuotationsSummary(container, currentUser, currentRole);
        } catch (ex) {
          Notifs.showToast('Repair failed: '+(ex.message||ex.code),'error');
          btn.disabled = false; btn.textContent = 'Repair now';
        }
      });
    // Deliberately non-blocking and non-visual: this probe only decides whether
    // to OFFER a repair banner, so a failed probe withholds an offer rather
    // than asserting anything false — unlike the swallowed reads this pass
    // removed elsewhere in the file. Logged so it is at least diagnosable
    // instead of vanishing.
    }).catch(err => console.warn('[bkq] stranded-BK-quote probe failed — repair banner not offered', err));
  }
}

// ── Brilliant Steel Quotes (read-only window into Brilliant Steel quotes) ──
// One-way visibility: internal Sales can see Brilliant Steel quotes. Backed by
// the bs_quotes read rule (any internal staff).
async function renderSalesBSQuotes(container, currentUser, currentRole) {
  container.innerHTML = window.skeletonHtml('table');
  // 8-point #3 — surface a read failure instead of the old silent
  // .catch(()=>({docs:[]})) fallback (which rendered indistinguishably
  // from "no quotes yet").
  let snap;
  try { snap = await db.collection('bs_quotes').orderBy('createdAt','desc').get(); }
  catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load Brilliance Steel quotes</h4><p>${escHtml(err.message||String(err))}</p><button type="button" class="btn-secondary btn-sm spq-retry-btn" style="margin-top:14px">Retry</button></div>`;
    container.querySelector('.spq-retry-btn')?.addEventListener('click', () => renderSalesBSQuotes(container, currentUser, currentRole));
    if (window.lucide) lucide.createIcons({ nodes: [container] });
    return;
  }
  const quotes = snap.docs.map(d=>({id:d.id,...d.data()}));
  const total = quotes.reduce((s,q)=>s+(Number(q.total)||Number(q.grandTotal)||Number(q.amount)||0),0);
  const accepted = quotes.filter(q=>['accepted','filed','approved'].includes(q.status));

  // Read-only card — unchanged from the pre-Wave-7 markup, just pulled into
  // a named function so the Wave 7 Pass 2 chain wrapper below can call it
  // for both a chain's primary (newest) revision and, compactly, its history.
  const bsQuoteCard = (q) => `
    <div class="item-card" style="display:flex;align-items:center;gap:12px">
      <div style="flex:1;min-width:0">
        <div class="item-title" style="font-size:13px">${escHtml(q.quoteNumber||q.id.slice(-6).toUpperCase())} — ${escHtml(q.clientName||'Unnamed')}</div>
        <div class="item-meta" style="margin-top:4px">
          <span>${emojiIcon('👤',16)} ${escHtml(q.createdByName||q.agentName||'Brilliance Steel')}</span>
          ${q.date?`<span>${escHtml(q.date)}</span>`:''}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-weight:700">₱${fmt(Number(q.total)||Number(q.grandTotal)||Number(q.amount)||0)}</div>
        <span class="badge ${window.statusBadgeClass('quote', q.status||'draft')}" style="margin-top:4px">${window.statusLabel2('quote', q.status||'draft')}</span>
      </div>
    </div>`;

  // Wave 7 Pass 2 — same chain wrapper as renderBKQuotationsSummary's
  // quoteChainCard, adapted for this read-only card (no action buttons to
  // preserve here — there were none before this pass either).
  const bsQuoteChainCard = (chain) => {
    const primaryHtml = bsQuoteCard(chain.primary);
    if (chain.history.length < 2) return primaryHtml;
    const rows = chain.history.map((q, i) => {
      const prev = i > 0 ? chain.history[i - 1] : null;
      const tot = Number(q.total) || Number(q.grandTotal) || Number(q.amount) || 0;
      const prevTot = prev ? (Number(prev.total) || Number(prev.grandTotal) || Number(prev.amount) || 0) : 0;
      const ts = q.date || (q.createdAt?.toDate ? q.createdAt.toDate().toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '');
      return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px${i?';border-top:1px solid var(--border)':''}">
        <div style="flex:1;min-width:120px;font-size:12px"><strong>R${i+1}</strong> · ${escHtml(ts)} · ${escHtml(q.createdByName||q.agentName||'Brilliance Steel')}</div>
        <div style="font-size:12px;font-weight:700">₱${fmt(tot)}</div>
        <div>${i>0?quoteRevDeltaHtml(tot,prevTot):'<span style="font-size:11px;color:var(--text-muted)">first filing</span>'}</div>
      </div>`;
    }).join('');
    return `${primaryHtml}
      <details class="quote-chain-history" style="margin:-6px 0 10px">
        <summary style="cursor:pointer;font-size:11px;color:var(--text-muted);padding:4px 6px">v${chain.history.length} · history</summary>
        <div style="background:var(--s1,rgba(255,255,255,.03));border:1px solid var(--border);border-radius:10px;margin-top:4px">${rows}</div>
      </details>`;
  };

  container.innerHTML = `
    <div style="font-size:12px;color:var(--text-muted);background:rgba(10,132,255,.07);border:1px solid var(--border);border-radius:10px;padding:8px 12px;margin-bottom:14px">
      ${emojiIcon('🤝',16)} Read-only view of <strong>Brilliance Steel</strong> quotes. Sales can see these for coordination.
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:20px">
      <div class="stat-card"><div class="stat-num">${quotes.length}</div><div class="stat-label">Brilliance Steel Quotes</div></div>
      <div class="stat-card"><div class="stat-num">₱${fmt(total)}</div><div class="stat-label">Total Value</div></div>
      <div class="stat-card"><div class="stat-num">${accepted.length}</div><div class="stat-label">Accepted / Filed</div></div>
    </div>
    <div class="item-list">
      ${!quotes.length
        ? window.renderEmptyState({ icon:'📋', title:'No Brilliance Steel quotes yet', hint:"Brilliance Steel quotes will appear here as they're created." })
        : buildQuoteChains(quotes).map(bsQuoteChainCard).join('')}
    </div>`;
  if (window.lucide) lucide.createIcons({ nodes: [container] });
}
// ══════════════════════════════════════════════════
//  SALES — AEC PARTNER DIRECTORY (v12 WS33)
// ══════════════════════════════════════════════════
// Architects/Engineers/Contractors prospecting directory (owner spec 2026-07-09).
// Type colors are the OWNER'S mandate (A=yellow / E=red / C=blue). They are
// CATEGORY colors, not status colors — rendered as small circular letter chips
// so a red "E" reads as a class marker, unlike the word-badges used for stage.
window.AEC_TYPES = [
  { key:'architect',  label:'Architect',  letter:'A', color:'#FFC300' },
  { key:'engineer',   label:'Engineer',   letter:'E', color:'#e5484d' },
  { key:'contractor', label:'Contractor', letter:'C', color:'#0A84FF' },
];
// Pipeline stage ladder — single-select filter, same {key,label,color,icon} shape
// as CRM_STAGES (departments.js). 'partner'/'dormant' are terminal.
window.AEC_STAGES = [
  { key:'new',       label:'Not Contacted', color:'#8e8e93',                icon:'○'  },
  { key:'contacted', label:'Contacted',     color:'#5856D6',                icon:'📞' },
  { key:'prospect',  label:'Prospect',      color:'#FFAA00',                icon:'🔥' },
  { key:'partner',   label:'Partner',       color:'var(--success,#30D158)', icon:'🤝' },
  { key:'dormant',   label:'Dormant',       color:'#636366',                icon:'💤' },
];
// Terminal stages — excluded from follow-up nudges. Read defensively by
// checkAECFollowups (notifications.js) at call-time, so load order is safe.
window.AEC_TERMINAL = ['partner','dormant'];
// The 18 official PH administrative regions (incl. NIR, re-established 2024).
// Stored VERBATIM as the region value (no key→label mapping; filter by equality).
window.AEC_REGIONS = [
  'NCR — National Capital Region',
  'CAR — Cordillera',
  'Region I — Ilocos',
  'Region II — Cagayan Valley',
  'Region III — Central Luzon',
  'Region IV-A — CALABARZON',
  'MIMAROPA — Southwestern Tagalog',
  'Region V — Bicol',
  'Region VI — Western Visayas',
  'NIR — Negros Island',
  'Region VII — Central Visayas',
  'Region VIII — Eastern Visayas',
  'Region IX — Zamboanga Peninsula',
  'Region X — Northern Mindanao',
  'Region XI — Davao',
  'Region XII — SOCCSKSARGEN',
  'Region XIII — Caraga',
  'BARMM — Bangsamoro',
];
function aecTypeMeta(k){ return window.AEC_TYPES.find(t => t.key === k) || window.AEC_TYPES[0]; }
function aecStageOf(c){ return window.AEC_STAGES.some(s => s.key === (c && c.stage)) ? c.stage : 'new'; }
function aecStageMeta(k){ return window.AEC_STAGES.find(s => s.key === k) || window.AEC_STAGES[0]; }
// The owner's two derived tracker columns (Decision 6):
function aecContacted(c){ return aecStageOf(c) !== 'new'; }
function aecProspected(c){ return ['prospect','partner'].includes(aecStageOf(c)); }
// Atomic directory number via _counters/aec_contacts — mirrors nextSerial's
// transaction (letterhead.js) but returns the PLAIN integer (a citable
// row number, not a year-prefixed document serial). Gaps after deletes are fine.
// Requires the _counters docId carve-out in firestore.rules (Spec 2b).
async function nextAECNumber(){
  const ref = db.collection('_counters').doc('aec_contacts');
  return db.runTransaction(async t => {
    const cur  = await t.get(ref);
    const next = (cur.exists ? (cur.data().count || 0) : 0) + 1;
    t.set(ref, { count: next }, { merge:true });
    return next;
  });
}

// window-exposed explicitly (was already reachable as a bare global function
// declaration in this classic, non-module script, but the CRM screen — a
// different file — calls it as window.renderAECDirectory, so this makes the
// contract explicit rather than relying on that implicit hoisting behavior).
window.renderAECDirectory = renderAECDirectory;

async function renderAECDirectory(container, currentUser, currentRole) {
  // 8-point #3 — this screen had no loading state at all before this pass
  // (straight to a blank container while the read was in flight), and a
  // failed read used to silently render as "no contacts" via
  // .catch(()=>({docs:[]})). Both fixed the same way as the quote lists
  // above: skeleton while loading, error-with-retry on failure.
  container.innerHTML = window.skeletonHtml('table');
  let snap;
  try { snap = await db.collection('aec_contacts').orderBy('itemNo','asc').get(); }
  catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load the AEC directory</h4><p>${escHtml(err.message||String(err))}</p><button type="button" class="btn-secondary btn-sm aec-retry-btn" style="margin-top:14px">Retry</button></div>`;
    container.querySelector('.aec-retry-btn')?.addEventListener('click', () => renderAECDirectory(container, currentUser, currentRole));
    if (window.lucide) lucide.createIcons({ nodes: [container] });
    return;
  }
  const contacts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // Widened 2026-08-04 (AEC moved into the CRM department): a user assigned
  // to CRM but not Sales must still be able to manage this directory — same
  // additive widening as the aec_contacts firestore.rules create/update rule.
  // Sales-only members keep working exactly as before; this only ADDS
  // capability for CRM members, never removes any.
  const canEdit = canEditDept('Sales') || canEditDept('CRM');
  // Delete gate = the client mirror of the aec_contacts DELETE rule
  // (firestore.rules: `allow delete: if isAuth() && isAdmin()`), not a
  // hand-rolled role array. Note the asymmetry this fixes: canEdit one line up
  // has always resolved through canEditDept(), which is secretary-aware, so
  // Add and Edit were offered to the Corporate Secretary while the literal
  // below — ['president','owner','manager'] — silently withheld Delete from
  // the one role assigned to organize this directory. aec_contacts and
  // roc_leads deliberately have NO delete-request flow (the rule's own comment
  // calls them low-stakes lists), so there was no escalation to fall back on
  // either: the capability the boundary already granted was simply unreachable.
  // isAdminPriv() (js/departments.js) is president/owner/manager/secretary —
  // exactly isAdmin(), 'owner' being the legacy alias for president.
  // Deliberately NOT applied to the bs_quotes delete gate further down this
  // file (renderBSQuotationsSummary): that one is stricter than its rule too,
  // but a quote is a money-bearing record and its screen already offers a
  // working "Request Delete" escalation, so it is a narrower-UI choice rather
  // than a dead end. Widening it is the owner's call, not this fix's.
  const canDeleteDirect = window.isAdminPriv();
  const today = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10));

  const isOverdue = c => c.followUpDate && c.followUpDate <= today && !window.AEC_TERMINAL.includes(aecStageOf(c));
  const dueCount = contacts.filter(isOverdue).length;

  const typeCounts = { all: contacts.length };
  window.AEC_TYPES.forEach(t => typeCounts[t.key] = contacts.filter(c => c.type === t.key).length);
  const stageCounts = {};
  window.AEC_STAGES.forEach(s => stageCounts[s.key] = contacts.filter(c => aecStageOf(c) === s.key).length);

  let typeFilter = 'all', stageFilter = 'all', regionFilter = 'all', search = '';

  container.innerHTML = `
    <style>
      /* v14 Wave 6 B2 — scoped to ≥701px only: below that the shared .table-cards
         CSS (styles.css) takes over row layout (flex card, padding:0, no border),
         and these ID-selector rules would otherwise out-specificity it. */
      @media (min-width: 701px) {
        #aec-tbl{min-width:860px}
        #aec-tbl th,#aec-tbl td{border-bottom:1px solid var(--border);padding:7px 8px;text-align:left;vertical-align:top;font-size:12px}
        #aec-tbl th{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted)}
        #aec-tbl td.c,#aec-tbl th.c{text-align:center}
      }
      #aec-tbl tbody tr{cursor:pointer}
    </style>
    ${dueCount ? `<div class="alert-banner alert-warn" style="margin-bottom:10px"><span>${emojiIcon('⏰',16)} <strong>${dueCount}</strong> AEC follow-up${dueCount>1?'s':''} due</span></div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      ${window.chipTabs([{key:'all',label:'All',count:typeCounts.all}, ...window.AEC_TYPES.map(t=>({key:t.key,label:t.label,count:typeCounts[t.key]}))], 'all', {cls:'aec-type-tabs'})}
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${canEdit ? `<button class="btn-primary btn-sm" id="aec-add-btn">+ Add Contact</button>` : ''}
        <button class="btn-secondary btn-sm" id="aec-csv-btn">${emojiIcon('⬇',16)} CSV</button>
        <button class="btn-secondary btn-sm" id="aec-print-btn">${emojiIcon('🖨',16)} Print</button>
      </div>
    </div>
    ${window.chipTabs([{key:'all',label:'All Stages'}, ...window.AEC_STAGES.map(s=>({key:s.key,label:s.label,icon:emojiIcon(s.icon,14),count:stageCounts[s.key]}))], 'all', {cls:'aec-stage-tabs'})}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 10px">
      <select id="aec-region-filter" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:12px">
        <option value="all">All regions</option>
        ${window.AEC_REGIONS.map(r=>`<option value="${escHtml(r)}">${escHtml(r)}</option>`).join('')}
      </select>
      <input id="aec-search" placeholder="🔍 Search company / person / email…" style="flex:1;min-width:180px;padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:12px"/>
    </div>
    <div id="aec-table"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  // AND-composed filter predicate — the one place all four dimensions combine.
  const shownRows = () => contacts.filter(c =>
    (typeFilter   === 'all' || c.type === typeFilter) &&
    (stageFilter  === 'all' || aecStageOf(c) === stageFilter) &&
    (regionFilter === 'all' || (c.region || '') === regionFilter) &&
    (!search || [c.company, c.contactPerson, c.email, c.phone, c.address]
      .join(' ').toLowerCase().includes(search))
  );

  const typeChip = c => { const t = aecTypeMeta(c.type);
    return `<span title="${escHtml(t.label)}" style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:${t.color};color:var(--on-primary);font-size:10px;font-weight:800">${t.letter}</span>`; };

  // v14 Wave 6 B2 — card reflow (≤700px, shared .table-cards CSS pattern).
  // Row already click-navigates to openAECDetail (bound in bindRows below) —
  // the detail page IS the expansion, so tc-detail cells stay hidden on
  // phone with no separate tap-to-expand toggle (no caret/JS added), same
  // idiom as renderBankAccounts.
  const rowHtml = c => { const st = aecStageMeta(aecStageOf(c)); const od = isOverdue(c);
    return `<tr data-id="${c.id}">
      <td class="c tc-detail" data-label="#">${c.itemNo || ''}</td>
      <td class="c tc-avatar">${typeChip(c)}</td>
      <td class="tc-name"><strong>${escHtml(c.company || '')}</strong>${c.address ? `<div style="font-size:10px;color:var(--text-muted)">${escHtml(c.address)}</div>` : ''}</td>
      <td class="tc-detail" data-label="Contact Person">${escHtml(c.contactPerson || '')}</td>
      <td class="tc-detail" data-label="Contact Info" style="font-size:11px">${c.phone ? `${emojiIcon('📞',16)} ${escHtml(c.phone)}<br>` : ''}${c.email ? `${emojiIcon('✉️',16)} ${escHtml(c.email)}` : ''}</td>
      <td class="tc-detail" data-label="Region" style="font-size:11px">${escHtml((c.region || '').split(' — ')[0])}</td>
      <td class="tc-net"><span class="badge" style="font-size:9px;background:${st.color};color:var(--on-primary)">${st.icon} ${st.label}</span></td>
      <td class="c tc-detail" data-label="Quote">${c.quoteSent ? `${emojiIcon('✅',16)}${c.quoteSentDate ? `<div style="font-size:9px;color:var(--text-muted)">${escHtml(c.quoteSentDate)}</div>` : ''}` : '—'}</td>
      <td class="tc-detail" data-label="Follow-up" style="font-size:11px;color:${od ? 'var(--danger)' : 'var(--text-muted)'}">${c.followUpDate ? `${emojiIcon('⏰',16)} ${escHtml(c.followUpDate)}${od ? ' · due' : ''}` : ''}</td>
      <td class="c tc-actions" style="white-space:nowrap">
        ${canEdit ? `<button class="btn-secondary btn-sm aec-edit-btn" data-id="${c.id}" title="Edit" aria-label="Edit contact">${emojiIcon('✎',16)}</button>` : ''}
        ${canDeleteDirect ? `<button class="btn-secondary btn-sm aec-del-btn" data-id="${c.id}" data-company="${escHtml(c.company || '')}" style="color:var(--danger)" aria-label="Delete contact">${emojiIcon('trash-2',13)}</button>` : ''}
      </td></tr>`; };

  const openAECDetail = (c) => {
    const t = aecTypeMeta(c.type), st = aecStageMeta(aecStageOf(c));
    const _panel = openPage(`${t.letter} · ${escHtml(c.company || 'AEC Contact')}`, `
      <div style="display:flex;flex-direction:column;gap:6px;font-size:13px">
        <div>#${c.itemNo || ''} · <span class="badge" style="background:${t.color};color:var(--on-primary);font-size:9px">${escHtml(t.label)}</span> <span class="badge" style="background:${st.color};color:var(--on-primary);font-size:9px">${st.icon} ${st.label}</span></div>
        ${c.contactPerson ? `<div>${emojiIcon('👤',16)} ${escHtml(c.contactPerson)}</div>` : ''}
        ${c.phone ? `<div>${emojiIcon('📞',16)} ${escHtml(c.phone)}</div>` : ''}
        ${c.email ? `<div>${emojiIcon('✉️',16)} ${escHtml(c.email)}</div>` : ''}
        ${c.region ? `<div>${emojiIcon('📍',16)} ${escHtml(c.region)}</div>` : ''}
        ${c.address ? `<div>${emojiIcon('🏠',16)} ${escHtml(c.address)}</div>` : ''}
        <div>${emojiIcon('📄',16)} Quotation: ${c.quoteSent ? `sent${c.quoteSentDate ? ' ' + escHtml(c.quoteSentDate) : ''}${c.quoteRef ? ' · ' + escHtml(c.quoteRef) : ''}` : 'not sent'}</div>
        ${c.followUpDate ? `<div>${emojiIcon('⏰',16)} Follow-up: ${escHtml(c.followUpDate)}</div>` : ''}
        ${c.lastContact ? `<div>${emojiIcon('🕓',16)} Last contact: ${escHtml(c.lastContact)}</div>` : ''}
        ${c.potential ? `<div style="margin-top:4px;padding:8px;background:rgba(128,128,128,.08);border-radius:8px">${emojiIcon('💬',16)} ${escHtml(c.potential)}</div>` : ''}
      </div>
    `, `${canEdit ? `<button class="btn-primary" id="aec-detail-edit">${emojiIcon('✎',16)} Edit</button>` : ''}<button class="btn-secondary" onclick="closeModal()">Close</button>`);
    // ⚠ SCOPED TO THIS PANEL, NOT document.
    // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second record
    // inside that window and two panels carry the same ids at once —
    // document.getElementById() returns the FIRST in document order, which is
    // the DYING one. The handler then binds to a button nobody can see, and the
    // visible button does nothing. That is exactly the "needs multiple attempts
    // to get to the edit form" the Corporate Secretary reported on 2026-08-10,
    // reproduced in the browser: two #aec-detail-edit in the DOM, getElementById
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
    _panel.querySelector('#aec-detail-edit')?.addEventListener('click', () => openAECEditor(c, { replace: true }));
  };

  const openAECEditor = (c, opts) => {
    const e = c || {};
    const sel = 'style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)"';
    const _panel = openPage(c ? 'Edit AEC Contact' : 'Add AEC Contact', `
      <div class="form-row">
        <div class="form-group"><label>Type</label><select id="aec-type" ${sel}>${window.AEC_TYPES.map(t=>`<option value="${t.key}" ${e.type===t.key?'selected':''}>${t.letter} — ${t.label}</option>`).join('')}</select></div>
        <div class="form-group"><label>Stage</label><select id="aec-stage" ${sel}>${window.AEC_STAGES.map(s=>`<option value="${s.key}" ${aecStageOf(e)===s.key?'selected':''}>${s.icon} ${s.label}</option>`).join('')}</select></div>
      </div>
      <div class="form-group"><label>Company</label><input id="aec-company" value="${escHtml(e.company||'')}" placeholder="Firm / company name"/></div>
      <div class="form-group"><label>Contact person</label><input id="aec-person" value="${escHtml(e.contactPerson||'')}"/></div>
      <div class="form-row">
        <div class="form-group"><label>Phone</label><input id="aec-phone" type="tel" value="${escHtml(e.phone||'')}"/></div>
        <div class="form-group"><label>Email</label><input id="aec-email" type="email" value="${escHtml(e.email||'')}"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>PH Region</label><select id="aec-region" ${sel}>
          <option value="">— Region —</option>
          ${window.AEC_REGIONS.map(r=>`<option value="${escHtml(r)}" ${e.region===r?'selected':''}>${escHtml(r)}</option>`).join('')}
        </select></div>
        <div class="form-group"><label>Follow-up date</label><input id="aec-followup" type="date" value="${escHtml(e.followUpDate||'')}"/></div>
      </div>
      <div class="form-group"><label>Address</label><textarea id="aec-address" rows="2">${escHtml(e.address||'')}</textarea></div>
      <div class="form-group" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <!-- min-height only: the label was a 13px-tall strip beside two 38px inputs.
             No width/height on the input — the native tick is sized by the carve-out. -->
        <label style="display:flex;align-items:center;gap:6px;margin:0;min-height:38px"><input type="checkbox" id="aec-quotesent" ${e.quoteSent?'checked':''}/> Quotation sent</label>
        <input id="aec-quotedate" type="date" value="${escHtml(e.quoteSentDate||'')}" style="max-width:150px"/>
        <input id="aec-quoteref" placeholder="Quote # (optional)" value="${escHtml(e.quoteRef||'')}" style="max-width:160px"/>
      </div>
      <div class="form-group"><label>Feedback / partnership potential</label><textarea id="aec-potential" rows="3">${escHtml(e.potential||'')}</textarea></div>
    `, `<button class="btn-primary" id="aec-save-btn">${c ? 'Save' : 'Save Contact'}</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`, opts || {});
    // ⚠ SCOPED TO THIS PANEL, NOT document.
    // openPage keeps a CLOSING page in the DOM for ~300ms. Open a second record
    // inside that window and two panels carry the same ids at once —
    // document.getElementById() returns the FIRST in document order, which is
    // the DYING one. The handler then binds to a button nobody can see, and the
    // visible button does nothing. That is exactly the "needs multiple attempts
    // to get to the edit form" the Corporate Secretary reported on 2026-08-10,
    // reproduced in the browser: two #aec-save-btn in the DOM, getElementById
    // resolving into the dead panel, the visible button firing nothing.
    _panel.querySelector('#aec-save-btn').addEventListener('click', async () => {
      const company = _panel.querySelector('#aec-company').value.trim();
      if (!company) { Notifs.showToast('Company is required.','error'); return; }
      const quoteSent = _panel.querySelector('#aec-quotesent').checked;
      const data = {
        type: _panel.querySelector('#aec-type').value,
        stage: _panel.querySelector('#aec-stage').value,
        company,
        contactPerson: _panel.querySelector('#aec-person').value.trim(),
        phone: _panel.querySelector('#aec-phone').value.trim(),
        email: _panel.querySelector('#aec-email').value.trim(),
        region: _panel.querySelector('#aec-region').value,
        address: _panel.querySelector('#aec-address').value.trim(),
        quoteSent,
        quoteSentDate: quoteSent ? (_panel.querySelector('#aec-quotedate').value || today) : '',
        quoteRef: _panel.querySelector('#aec-quoteref').value.trim(),
        potential: _panel.querySelector('#aec-potential').value.trim(),
        followUpDate: _panel.querySelector('#aec-followup').value || '',
        lastContact: today,   // Manila-correct stamp — mirrors sales_clients
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };
      try {
        if (c) {
          await db.collection('aec_contacts').doc(c.id).update(data);
          window.logAudit && window.logAudit('update','aec_contact',c.id,{company,stage:data.stage});
        } else {
          data.itemNo   = await nextAECNumber();   // mint BEFORE create; a failed create just leaves a gap
          data.addedBy  = currentUser.uid;
          data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
          await db.collection('aec_contacts').add(data);
          window.logAudit && window.logAudit('create','aec_contact',String(data.itemNo),{company});
        }
        closeModal(); Notifs.success('AEC contact saved');
        renderAECDirectory(container, currentUser, currentRole);
      } catch(ex){ Notifs.showToast('Save failed: ' + (ex.message||ex.code),'error'); }
    });
  };

  const bindRows = () => {
    const el = document.getElementById('aec-table'); if (!el) return;
    el.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const c = contacts.find(x => x.id === tr.dataset.id); if (c) openAECDetail(c);
    }));
    el.querySelectorAll('.aec-edit-btn').forEach(b => b.addEventListener('click', () => openAECEditor(contacts.find(x => x.id === b.dataset.id))));
    el.querySelectorAll('.aec-del-btn').forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmDialog({message:`Delete AEC contact "${escHtml(b.dataset.company)}"? This cannot be undone.`, danger:true, html:true}))) return;
      try {
        await db.collection('aec_contacts').doc(b.dataset.id).delete();
        window.logAudit && window.logAudit('delete','aec_contact',b.dataset.id,{company:b.dataset.company});
        Notifs.success('AEC contact deleted');
        renderAECDirectory(container, currentUser, currentRole);
      // Say WHY — matches the Save handler above. A bare "Delete failed" on a
      // button now offered to a wider set of roles cannot be acted on: a rules
      // denial, an offline write and an already-deleted doc all read the same.
      } catch(ex){ Notifs.showToast('Delete failed: ' + (ex.message||ex.code),'error'); }
    }));
  };

  const renderTable = () => {
    const rows = shownRows();
    const el = document.getElementById('aec-table'); if (!el) return;
    el.innerHTML = !rows.length
      ? window.renderEmptyState({
          icon: '📇',
          title: `No AEC contacts${contacts.length ? ' match the filters' : ' yet'}`,
          hint: (canEdit && !contacts.length) ? 'Add architects, engineers and contractors to start the partnership pipeline.' : undefined
        })
      : `<div style="overflow-x:auto"><table id="aec-tbl" class="data-table table-cards" style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th class="c" style="width:36px">#</th><th class="c" style="width:40px">Type</th><th>Company</th><th>Contact Person</th>
            <th>Contact Info</th><th style="width:80px">Region</th><th style="width:120px">Stage</th>
            <th class="c" style="width:70px">Quote</th><th style="width:110px">Follow-up</th><th style="width:80px"></th>
          </tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [el] });
    bindRows();
  };

  // The owner's full column list — used by BOTH the on-screen CSV button and as
  // the reference for the monthly-backup csvFields (Spec 8). Derived columns
  // (Contacted?/Prospected?) come from the stage ladder per Decision 6.
  const AEC_CSV_COLUMNS = [
    { key:'itemNo',        label:'Item #' },
    { key:'type',          label:'Type',                 get:r => aecTypeMeta(r.type).label },
    { key:'company',       label:'Company' },
    { key:'contactPerson', label:'Contact Person' },
    { key:'phone',         label:'Phone' },
    { key:'email',         label:'Email' },
    { key:'region',        label:'PH Region' },
    { key:'address',       label:'Address' },
    { key:'stage',         label:'Stage',                get:r => aecStageMeta(aecStageOf(r)).label },
    { key:'contacted',     label:'Contacted?',           get:r => aecContacted(r) ? 'Yes' : 'No' },
    { key:'prospected',    label:'Prospected Project?',  get:r => aecProspected(r) ? 'Yes' : 'No' },
    { key:'quoteSent',     label:'Quotation Sent?',      get:r => r.quoteSent ? 'Yes' : 'No' },
    { key:'quoteSentDate', label:'Quote Sent Date' },
    { key:'quoteRef',      label:'Quote Ref' },
    { key:'potential',     label:'Feedback / Partnership Potential' },
    { key:'followUpDate',  label:'Follow-up Date' },
    { key:'lastContact',   label:'Last Contact' },
  ];

  const filterLabel = () => {
    const bits = [];
    if (typeFilter   !== 'all') bits.push(aecTypeMeta(typeFilter).label + 's');
    if (stageFilter  !== 'all') bits.push('stage: ' + aecStageMeta(stageFilter).label);
    if (regionFilter !== 'all') bits.push(regionFilter.split(' — ')[0]);
    if (search) bits.push(`search: "${search}"`);
    return bits.length ? bits.join(' · ') : 'All contacts';
  };

  window.bindChipTabs(container.querySelector('.aec-type-tabs'),  (key) => { typeFilter  = key; renderTable(); });
  window.bindChipTabs(container.querySelector('.aec-stage-tabs'), (key) => { stageFilter = key; renderTable(); });
  document.getElementById('aec-region-filter')?.addEventListener('change', (e) => { regionFilter = e.target.value; renderTable(); });
  document.getElementById('aec-search')?.addEventListener('input', (e) => { search = e.target.value.trim().toLowerCase(); renderTable(); });
  // Owner, 2026-08-10: "add contact button, let it be a floating button on the
  // right bottom side which follows along when scrolling". This directory runs
  // to 129 rows, so the header button scrolls out of reach exactly when you are
  // deep in the list looking for a duplicate. The FAB is appended to <body>,
  // not to the screen container — a position:fixed element inside a transformed
  // or scrolling ancestor is positioned against THAT ancestor, not the viewport,
  // and would scroll away with it.
  //
  // Both buttons run the SAME opener; the header one stays for anyone who is
  // already at the top.
  document.getElementById('aec-add-btn')?.addEventListener('click', () => openAECEditor(null));
  window.mountDirectoryFab('aec-fab', canEdit, 'Add Contact', () => openAECEditor(null));
  document.getElementById('aec-csv-btn')?.addEventListener('click', () => window.exportCSV('aec-contacts', shownRows(), AEC_CSV_COLUMNS));
  document.getElementById('aec-print-btn')?.addEventListener('click', () => openAECPrintSheet(shownRows(), filterLabel()));
  renderTable();
}

// Printable AEC contact sheet — landscape-A4 letterhead multi-row table,
// mirroring openInventoryCountForm incl. the defensive `_lh ? … : fallback`
// pattern. Prints the CURRENTLY-FILTERED rows. The free-text "potential" notes
// are DELIBERATELY omitted (Decision 10). Wave 3 E-CALLERS: now requests
// orientation:'landscape' from buildLetterhead (the engine's single @page
// authority) instead of relying on a local @page winning by CSS-order luck.
function openAECPrintSheet(rows, scopeLabel){
  const e = s => escHtml(s);
  const todayStr = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10));
  const _lh = window.buildLetterhead ? window.buildLetterhead({
    orientation: 'landscape',
    docTitle: 'AEC PARTNER CONTACT SHEET',
    dateLabel: 'As of ' + todayStr,
    extraMeta: [scopeLabel || 'All contacts', rows.length + ' contact' + (rows.length === 1 ? '' : 's')],
    signatures: [{ label:'Prepared by', name:(window.userProfile && userProfile.displayName) || '', title:'Sales' }],
    footerNote: ((window.BRAND && window.BRAND.fullName) || 'Barro Industries Operating System') + ' · Generated ' + new Date().toLocaleString('en-PH') + ' · Internal prospecting directory — handle contact details accordingly.'
  }) : null;
  const body = rows.map(c => { const t = aecTypeMeta(c.type), st = aecStageMeta(aecStageOf(c));
    return `<tr>
      <td class="c">${c.itemNo || ''}</td>
      <td class="c"><span class="tchip" style="background:${t.color}">${t.letter}</span></td>
      <td class="b">${e(c.company || '')}</td>
      <td>${e(c.contactPerson || '')}</td>
      <td>${e(c.phone || '')}</td>
      <td>${e(c.email || '')}</td>
      <td>${e((c.region || '').split(' — ')[0])}</td>
      <td>${e(c.address || '')}</td>
      <td class="c">${st.label}</td>
      <td class="c">${c.quoteSent ? `✔ ` + e(c.quoteSentDate || '') : '—'}</td>
      <td class="c">${e(c.followUpDate || '')}</td>
    </tr>`; }).join('');
  const pageCss = `
  .page{width:297mm;min-height:210mm;margin:0 auto;background:#fff;padding:10mm 12mm}
  table{margin-top:8px}
  th,td{font-size:9.5px}
  th{background:#1E3A5F;color:#fff;font-size:8px;text-transform:uppercase;letter-spacing:.04em}
  .tchip{display:inline-block;width:14px;height:14px;line-height:14px;border-radius:50%;color:#fff;font-weight:800;font-size:9px;text-align:center}
${_lh ? _lh.printCSS : ''}
  @media print{ .page{padding:0;width:auto;min-height:0} .tchip,th{-webkit-print-color-adjust:exact;print-color-adjust:exact} }`;
  const bodyHtml = `
  ${_lh ? _lh.headerHTML : `<div style="border-bottom:3px solid #1E3A5F;padding-bottom:8px;margin-bottom:8px"><div style="font-size:20px;font-weight:900;color:#1E3A5F">BARRO INDUSTRIES</div><div style="font-size:10px;color:#555">AEC Partner Contact Sheet · ${e(todayStr)}</div></div>`}
  <table>
    <thead><tr>
      <th style="width:26px">#</th><th style="width:30px">Type</th><th style="width:14%">Company</th>
      <th style="width:11%">Contact Person</th><th style="width:9%">Phone</th><th style="width:13%">Email</th>
      <th style="width:7%">Region</th><th>Address</th><th style="width:8%">Stage</th>
      <th style="width:8%">Quote Sent</th><th style="width:8%">Follow-up</th>
    </tr></thead>
    <tbody>${body || `<tr><td colspan="11" class="c" style="padding:14px">No contacts match the current filters.</td></tr>`}</tbody>
  </table>
  ${_lh ? _lh.footerHTML : ''}`;
  window.openPrintableDoc({
    title: `AEC Partner Contact Sheet — ${todayStr}`,
    barLabel: `${emojiIcon('📇',16)} AEC Partner Contact Sheet`,
    bodyHtml, pageCss,
    winFeatures: 'width=1100,height=720'
  });
}

// ── Brilliant Steel Quotations Summary ────────────
async function renderBSQuotationsSummary(container, currentUser, currentRole) {
  // H5 fix — set a loading state immediately (matches renderBSQuotationFiles) and
  // wrap the whole body in try/catch so a read failure shows a friendly error
  // instead of leaving the container stuck (previously: no loading state, no
  // try/catch, and no .catch() on the reads at all).
  container.innerHTML = window.skeletonHtml('table');
  const isPrivileged = currentRole === 'president' || currentRole === 'owner' || currentRole === 'manager';
  // Sales dept employees can see all quotes; everyone else only sees their own
  const canSeeAll = isPrivileged ||
    (currentRole === 'employee' && (window.currentDepts||[]).includes('Sales'));
  try {
    // Cached read, scoped separately from getBsQuotesOrdered above — this tab's
    // canSeeAll gate differs (Sales-dept employees only, not all employees) and
    // the query has no orderBy, so it must not share a cache key with the
    // ordered Files/Client-Data query (would leak scope-mismatched results).
    const bsqKey = canSeeAll ? 'bs_quotes-flat-all' : `bs_quotes-flat-own-${currentUser.uid}`;
    // The two `.catch(()=>({docs:[]}))` that used to sit on these reads are
    // gone. This whole body is already wrapped in the try/catch below, which
    // paints a named error + Retry — but the swallowing catches resolved the
    // rejection before it could ever get there, so a denied or offline read
    // rendered a fully-formed screen claiming zero quotes, ₱0 pipeline, 0%
    // win rate and five empty status buckets. Every one of those is a
    // confident number derived from nothing. dbCachedGet re-throws (and
    // negative-caches for 4s) rather than storing a failure as data, so the
    // rejection now reaches the handler that can tell the user about it.
    const snap = await dbCachedGet(bsqKey, () => canSeeAll
      ? db.collection('bs_quotes').get()
      : db.collection('bs_quotes').where('createdBy','==',currentUser.uid).get(),
      50000);
    const all = snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const forApproval   = all.filter(q=>q.status==='pending_approval'||q.approvalStatus==='pending_review'||q.status==='sent');
    const filed         = all.filter(q=>q.status==='filed'||q.approvalStatus==='approved');
    const drafts        = all.filter(q=>!q.status||q.status==='draft');
    const needsRevision = all.filter(q=>q.status==='needs_revision'||q.approvalStatus==='needs_revision');
    const rejected      = all.filter(q=>q.approvalStatus==='rejected'||q.status==='rejected');
    // v12 WS31 Spec 10 — "filed but no Sales Order yet" staleness, pure client-side
    // over rows this screen already fetched. Zero new reads.
    const staleDaysOf = q => (q.status==='filed' && !q.salesOrderId && q.createdAt)
      ? Math.floor((Date.now() - (q.createdAt.seconds||0)*1000) / 86400000) : 0;
    const staleCount = all.filter(q => staleDaysOf(q) > window.QUOTE_STALE_DAYS).length;

    // Wave 7 Pass 2 — chains built over the FULL `all` array (already loaded
    // above, no refetch) so a chain's history is complete even when an older
    // revision sits in a different status bucket than its newest revision.
    // A bucket's renderList() only shows a row for docs that are the PRIMARY
    // (newest) of their chain; chainByPrimaryId misses on any other doc, so
    // that row falls back to rendering standalone — identical to pre-Pass-2
    // behaviour for that edge case.
    const chainByPrimaryId = new Map(buildQuoteChains(all).map(c => [c.primary.id, c]));

    const renderList = (quotes) => !quotes.length
      ? window.renderEmptyState({ icon:'📋', title:'No quotations here' })
      : `<div class="card"><div class="table-wrap"><table class="data-table table-cards">
          <thead><tr><th>Quote #</th><th>Client</th><th>Total</th><th>Agent</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>${quotes.map(q=>{
            const status = q.status||q.approvalStatus||'draft';
            const badge = window.statusBadgeClass('quote', status);
            const ts = q.createdAt?.toDate?q.createdAt.toDate().toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}):'';
            const canDeleteDirect = currentRole==='president'||currentRole==='owner'||currentRole==='manager';
            // QB-DRAFTS-SPEC-2026-09-11 — a draft's own creator may delete it
            // directly too (firestore.rules now allows this for status:'draft'
            // docs) — no admin-approval detour for your own unfinished draft.
            const canDeleteDraftDirect = canDeleteDirect || (status==='draft' && q.createdBy===currentUser.uid);
            const staleDays = staleDaysOf(q);
            const chain = chainByPrimaryId.get(q.id);
            const chainToggle = (chain && chain.history.length > 1)
              ? ` <button type="button" class="chain-toggle-btn" data-chain="${escHtml(chain.key)}" aria-expanded="false" title="${chain.history.length} revisions for ${escHtml(q.quoteNumber||q.id)}" style="border:none;background:none;cursor:pointer;font-size:10px;color:var(--text-muted);text-decoration:underline;padding:0;margin-left:2px;display:block">v${chain.history.length} · history</button>`
              : '';
            return `<tr class="bsq-row">
              <td class="tc-avatar"><code>${escHtml(q.quoteNumber||q.id.slice(-8))}</code>${chainToggle}</td>
              <td class="tc-name"><strong>${escHtml(q.clientName||'—')}</strong><div style="font-size:11px;color:var(--text-muted)">${escHtml(q.clientCompany||'')} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></div></td>
              <td class="tc-net">₱${fmt(q.total||q.grandTotal||0)}</td>
              <td class="tc-detail" data-label="Agent">${escHtml(q.agentName||q.createdByName||'—')}</td>
              <td class="tc-detail" data-label="Status">
                <span class="badge ${badge}">${window.statusLabel2('quote', status)}</span>
                ${q.deleteRequested?`<span class="badge badge-red" style="font-size:9px;margin-left:4px">${emojiIcon('🗑',9)} del req</span>`:''}
                ${staleDays > window.QUOTE_STALE_DAYS ? `<span class="badge badge-orange" style="font-size:9px;margin-left:4px" title="Filed but no Sales Order yet">${emojiIcon('⚠',9)} ${staleDays}d no SO</span>` : ''}
                ${window.quoteShareChipHtml(q)}
                <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${ts}</div>
              </td>
              <td class="tc-actions" style="white-space:nowrap;display:flex;gap:6px;flex-wrap:wrap">
                ${isPrivileged&&(status==='pending_approval'||status==='pending_review'||status==='sent')?`
                  <button class="btn-primary btn-sm bs-approve-btn" data-id="${q.id}" data-by="${q.createdBy}" data-name="${escHtml(q.clientName||'')}" data-qno="${escHtml(q.quoteNumber||'')}">${emojiIcon('✅',16)} Approve</button>
                  <button class="btn-danger btn-sm bs-reject-btn" data-id="${q.id}" data-by="${q.createdBy}" data-name="${escHtml(q.clientName||'')}" data-qno="${escHtml(q.quoteNumber||'')}">${emojiIcon('❌',16)} Reject</button>
                  <button class="btn-secondary btn-sm bs-edit-return-btn" data-id="${q.id}" data-by="${q.createdBy}" data-name="${escHtml(q.clientName||'')}" data-qno="${escHtml(q.quoteNumber||'')}">${emojiIcon('✎',16)} Edit &amp; Return</button>
                `:''}
                ${(status==='filed'||status==='approved')?`<button class="btn-secondary btn-sm bs-reopen-btn" data-id="${q.id}" title="Open this quote in the builder to edit — re-filing saves a new copy">↻ Reopen</button>`:''}
                ${(status==='filed'||status==='approved')&&q.editableState?`<button class="btn-secondary btn-sm bs-rev-btn" data-id="${q.id}" title="Start a new revision (R2, R3…) for this client with today's date">${emojiIcon('⎘',16)} New Revision</button>`:''}
                ${(status==='filed'||status==='approved')&&!q.editableState?`<span style="font-size:10px;color:var(--text-muted);align-self:center" title="No editable snapshot was saved for this quote, so Reopen has nothing to load and New Revision isn't offered.">no snapshot</span>`:''}
                ${status==='draft'?(q.editableState?`<button class="btn-secondary btn-sm bs-draft-resume-btn" data-id="${q.id}" title="Open this draft in the builder">↻ Resume</button>`:`<span style="font-size:10px;color:var(--text-muted);align-self:center" title="No editable snapshot was saved for this draft.">no snapshot</span>`):''}
                ${window.QUOTE_SHAREABLE_STATUSES.includes(status)?`<button class="btn-secondary btn-sm bs-share-btn" data-id="${q.id}" title="Get a client-facing link — no login needed — to Accept or Request changes">${emojiIcon('🔗',16)} Share</button>`:''}
                ${(status==='filed'||status==='approved')?`<button class="btn-success btn-sm bs-so-btn" data-id="${q.id}" data-qno="${escHtml(q.quoteNumber||'')}" data-client="${escHtml(q.clientName||'')}" data-client-id="${q.clientId||''}" data-total="${q.total||q.grandTotal||0}" data-co="${escHtml(q.company||'BS')}" ${q.salesOrderId?'disabled':''}>${q.salesOrderId?`${emojiIcon('✓',16)} Ordered`:`${emojiIcon('🧾',16)} Sales Order`}</button>`:''}
                ${canDeleteDraftDirect
                  ? `<button class="btn-secondary btn-sm bs-del-btn" data-id="${q.id}" data-qno="${escHtml(q.quoteNumber||'')}" style="color:var(--danger)">${emojiIcon('🗑',16)} Delete</button>`
                  : `<button class="btn-secondary btn-sm bs-delreq-btn" data-id="${q.id}" data-qno="${escHtml(q.quoteNumber||'')}" ${q.deleteRequested?'disabled':''}>${q.deleteRequested?`${emojiIcon('⏳',16)} Requested`:`${emojiIcon('🗑',16)} Request Delete`}</button>`}
              </td>
            </tr>${chain ? quoteChainTableRowsHtml(chain) : ''}`;
          }).join('')}</tbody>
        </table></div></div>`;

    // ── Quote analytics ──
    // 30-agent beta sweep fix — this card used to define "won" as salesOrderId-only
    // and divide by ALL quotes (drafts/pending/rejected included in the
    // denominator), while the Command Center and Analytics screen used two more
    // divergent formulas again — same underlying quotes, up to 3 different numbers.
    // Now shares ONE definition with both other screens: window.quoteWinStats
    // (config.js — THE canonical won/lost/win-rate formula, won = salesOrderId OR
    // status 'won'/'accepted', rate = won/(won+lost)) for Win Rate/Successful/Won ₱,
    // and window.quotePipelineValue (above — the same "latest revision, excluding
    // rejected/lost" rule the Command Center's Quote Pipeline card uses) for
    // Pipeline ₱. Count only the LATEST revision of each quote so R1+R2… don't
    // inflate the pipeline value / quote count (same dedup as the BK summary).
    const { latest: bsActive } = window.latestQuoteRevisions(all);
    const qStats      = window.quoteWinStats(bsActive);
    const totalMade   = bsActive.length;
    const successful  = qStats.wonCount;
    const winRate     = qStats.winRate==null ? 0 : qStats.winRate;
    const wonValue    = qStats.wonVal;
    const pipelineVal = window.quotePipelineValue(bsActive);
    const analytics = `
      <div class="card" style="margin-bottom:14px;border:1.5px solid var(--primary)">
        <div class="card-header"><h3>${emojiIcon('📊',20)} Quote Analytics</h3></div>
        <div class="card-body">
          <div class="kpi-row">
            <div class="kpi-card"><div class="kpi-label">Quotes Made</div><div class="kpi-value">${totalMade}</div></div>
            <div class="kpi-card green"><div class="kpi-label">Successful</div><div class="kpi-value">${successful}</div></div>
            <div class="kpi-card accent"><div class="kpi-label">Win Rate</div><div class="kpi-value">${winRate}%</div></div>
            <div class="kpi-card"><div class="kpi-label">Pipeline ₱</div><div class="kpi-value" style="font-size:15px">₱${fmt(pipelineVal)}</div></div>
            <div class="kpi-card green"><div class="kpi-label">Won ₱</div><div class="kpi-value" style="font-size:15px">₱${fmt(wonValue)}</div></div>
          </div>
        </div>
      </div>`;
    const kpiRow = `
      ${analytics}
      <div class="kpi-row" style="margin-bottom:14px">
        <div class="kpi-card warn"><div class="kpi-label">Pending Approval</div><div class="kpi-value">${forApproval.length}</div></div>
        <div class="kpi-card green"><div class="kpi-label">Filed / Approved</div><div class="kpi-value">${filed.length}</div></div>
        <div class="kpi-card accent"><div class="kpi-label">Needs Revision</div><div class="kpi-value">${needsRevision.length}</div></div>
        <div class="kpi-card red"><div class="kpi-label">Rejected</div><div class="kpi-value">${rejected.length}</div></div>
      </div>`;

    container.innerHTML = `
      ${kpiRow}
      <div class="subtab-bar" style="margin-top:0;flex-wrap:wrap">
        <button class="subtab-btn active" data-qsub="filed">Filed / Approved (${filed.length})</button>
        <button class="subtab-btn" data-qsub="for-approval">Pending Approval (${forApproval.length})</button>
        ${needsRevision.length?`<button class="subtab-btn" data-qsub="needs-revision" style="border-color:var(--warning);color:var(--warning)">↩ Needs Revision (${needsRevision.length})</button>`:''}
        <button class="subtab-btn" data-qsub="drafts">Drafts (${drafts.length})</button>
        <button class="subtab-btn" data-qsub="rejected">Rejected (${rejected.length})</button>
        ${staleCount?`<span class="badge badge-orange" style="align-self:center;font-size:11px;font-weight:700">${emojiIcon('⚠',11)} ${staleCount} stale</span>`:''}
      </div>
      <div id="qs-content">${renderList(filed)}</div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [container] });

    const qsContent = container.querySelector('#qs-content');
    container.querySelectorAll('[data-qsub]').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('[data-qsub]').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        const which = btn.dataset.qsub;
        const listMap = { 'filed': filed, 'for-approval': forApproval, 'drafts': drafts, 'rejected': rejected, 'needs-revision': needsRevision };
        qsContent.innerHTML = renderList(listMap[which]||[]);
        bindQuoteActions(qsContent, currentUser, currentRole, container);
        if (window.lucide) lucide.createIcons({ nodes: [qsContent] }); // subtab re-render bypasses the outer pass — icons went blank
      });
    });
    bindQuoteActions(qsContent, currentUser, currentRole, container);
  } catch (err) {
    // 8-point #3 — add a retry action to the pre-existing H5-fix error state
    // (message-only before this pass). Titled after the thing that failed, the
    // same way every other list in this file names its own failure, now that
    // the swallowing catches above no longer keep this branch unreachable.
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load Brilliance Steel quotations</h4><p>${escHtml(err.message||String(err))}</p><button type="button" class="btn-secondary btn-sm bsq-retry-btn" style="margin-top:14px">Retry</button></div>`;
    container.querySelector('.bsq-retry-btn')?.addEventListener('click', () => renderBSQuotationsSummary(container, currentUser, currentRole));
    if (window.lucide) lucide.createIcons({ nodes: [container] });
  }
}
function bindQuoteActions(el, currentUser, currentRole, container) {
  // Wave 7 Pass 2 — "v N · history" toggle for a chain's primary row. Reveals
  // the sibling <tr class="bsq-hist-row" data-chain="…" hidden> rows
  // quoteChainTableRowsHtml() rendered right after this row.
  el.querySelectorAll('.chain-toggle-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const key = e.currentTarget.dataset.chain;
      const open = e.currentTarget.getAttribute('aria-expanded') === 'true';
      e.currentTarget.setAttribute('aria-expanded', String(!open));
      el.querySelectorAll(`tr.bsq-hist-row[data-chain="${CSS.escape(key)}"]`).forEach(tr => { tr.hidden = open; });
    });
  });
  // Card view (≤700px) — tap a row to reveal the full breakdown.
  el.querySelectorAll('tr.bsq-row').forEach(tr => {
    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('button, a')) return;
      tr.classList.toggle('tc-expanded');
    });
  });
  // Direct delete (president/manager only — Firestore rules enforce isAdmin)
  el.querySelectorAll('.bs-del-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const b = e.currentTarget;
      if (!(await confirmDialog({message:`Delete quote "${escHtml(b.dataset.qno||b.dataset.id)}"? This cannot be undone.`, danger:true, html:true}))) return;
      try {
        await db.collection('bs_quotes').doc(b.dataset.id).delete();
        window.logAudit && window.logAudit('delete','quote',b.dataset.id,{ quoteNo:b.dataset.qno });
        Notifs.success('Quote deleted');
        window.invalidateBsQuotesCache(currentUser.uid);
        renderBSQuotationsSummary(container, currentUser, currentRole);
      // Name the cause — a rules denial and an offline write are very different
      // problems and "Delete failed" distinguishes neither.
      } catch(ex){ Notifs.showToast('Delete failed: '+(ex.message||ex.code),'error'); }
    });
  });
  // Request delete (sales staff) — flags the quote + notifies the president
  el.querySelectorAll('.bs-delreq-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const b = e.currentTarget;
      const reasonIn = await promptDialog({message:'Reason for deleting this quote? (sent to the president for approval)', required:true, multiline:true});
      if (reasonIn == null) return;
      const reason = reasonIn || '';
      try {
        await db.collection('bs_quotes').doc(b.dataset.id).update({
          deleteRequested:true, deleteReason:reason,
          deleteRequestedBy:currentUser.uid, deleteRequestedAt:firebase.firestore.FieldValue.serverTimestamp()
        });
        await Notifs.sendToOwner({ title:'🗑 Quote Delete Requested', body:`${userProfile?.displayName||currentUser.email} requests deleting quote "${b.dataset.qno}".${reason?' Reason: '+reason:''}`, icon:'🗑', type:'quote_delete_request', link:'approvals' });
        Notifs.success('Delete request sent to president');
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:bs_quotes-delete'); // PERF-WAVE1
        window.invalidateBsQuotesCache(currentUser.uid);
        renderBSQuotationsSummary(container, currentUser, currentRole);
      } catch(ex){ Notifs.showToast('Request failed: '+(ex.message||ex.code),'error'); }
    });
  });
  // Reopen a filed quote in the builder to edit — re-filing saves a new copy.
  // Re-audit fix (HIGH) — routed through window.reopenQuoteFromDoc (app.js),
  // the only path that stamps sourceDocId/sourceCollection/rootQuoteId onto
  // the reopened state; the old inline version here skipped all three,
  // silently breaking the revision-chain link on refile. Same fix as the
  // .bk-reopen-btn handler above.
  el.querySelectorAll('.bs-reopen-btn').forEach(btn => {
    btn.addEventListener('click', e =>
      window.reopenQuoteFromDoc('bs_quotes', e.currentTarget.dataset.id, 'bs-quote-builder'));
  });
  // New revision (R2, R3…) of a filed quote — same client/items, today's date.
  el.querySelectorAll('.bs-rev-btn').forEach(btn => {
    btn.addEventListener('click', e =>
      window.newRevisionFromDoc('bs_quotes', e.currentTarget.dataset.id, 'bs-quote-builder'));
  });
  // QB-DRAFTS-SPEC-2026-09-11 — resume a draft into the builder (no revision
  // chain, unlike Reopen above).
  el.querySelectorAll('.bs-draft-resume-btn').forEach(btn => {
    btn.addEventListener('click', e =>
      window.resumeDraftFromDoc('bs_quotes', e.currentTarget.dataset.id));
  });
  // Convert a won quote into a Sales Order (capture payment + receipt → finance)
  el.querySelectorAll('.bs-so-btn').forEach(btn => {
    btn.addEventListener('click', e => openSalesOrderModal(e.currentTarget.dataset, currentUser, currentRole, container));
  });
  // Share a client-facing link (CLIENT-QUOTE-PAGE-SPEC.md) — no login needed,
  // Accept / Request changes writes back via the respondToQuote callable.
  el.querySelectorAll('.bs-share-btn').forEach(btn => {
    btn.addEventListener('click', e =>
      window.shareQuoteWithClient('bs_quotes', e.currentTarget.dataset.id, () => renderBSQuotationsSummary(container, currentUser, currentRole)));
  });
  el.querySelectorAll('.bs-approve-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const b = e.currentTarget;
      await db.collection('bs_quotes').doc(b.dataset.id).update({
        status: 'filed', approvalStatus: 'approved',
        approvedAt: firebase.firestore.FieldValue.serverTimestamp(), approvedBy: currentUser.uid
      });
      await db.collection('approval_requests').where('quoteId','==',b.dataset.id).get().then(s => s.docs.forEach(d => d.ref.update({status:'approved'})));
      if (b.dataset.by) await Notifs.send(b.dataset.by, { title:'✅ Quote Approved!', body:`Quotation "${b.dataset.qno}" for ${b.dataset.name} was approved and filed.`, icon:'✅', type:'quote_approved', link:'bs-quotations' });
      Notifs.success('Quote approved and filed!');
      window.invalidateBsQuotesCache(currentUser.uid);
      renderBSQuotationsSummary(container, currentUser, currentRole);
    });
  });
  el.querySelectorAll('.bs-reject-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const b = e.currentTarget;
      await db.collection('bs_quotes').doc(b.dataset.id).update({
        status: 'rejected', approvalStatus: 'rejected',
        rejectedAt: firebase.firestore.FieldValue.serverTimestamp(), rejectedBy: currentUser.uid
      });
      await db.collection('approval_requests').where('quoteId','==',b.dataset.id).get().then(s => s.docs.forEach(d => d.ref.update({status:'rejected'})));
      if (b.dataset.by) await Notifs.send(b.dataset.by, { title:'❌ Quote Not Approved', body:`Quotation "${b.dataset.qno}" for ${b.dataset.name} was not approved.`, icon:'❌', type:'quote_rejected', link:'bs-quotations' });
      Notifs.error('Quote rejected.');
      window.invalidateBsQuotesCache(currentUser.uid);
      renderBSQuotationsSummary(container, currentUser, currentRole);
    });
  });
  // ── WINDOW FIRST, READ SECOND (v14 smoothness pass) ─────────────────────
  // This handler used to be `async e => {}` and read the quote BEFORE it had
  // drawn anything:
  //     const snap = await db.collection('bs_quotes').doc(id).get();
  //     const q = snap.data();
  //     openPage(title, <form built from q>, footer);
  // so the tap produced ZERO pixels until the round trip landed. By the time
  // the panel finally appeared the press state had already released and there
  // was nothing in the DOM for the entrance to animate — this is the shape
  // behind "the clicks feel slow". The window is now pushed SYNCHRONOUSLY, in
  // the same frame as the tap, carrying a skeleton body; the same read then
  // fills it with the same form. Same collection, same doc id, same rendered
  // markup — only WHEN it appears changed. Structural twin of
  // openQuoteTemplatesPicker (js/app.js), which already does this.
  el.querySelectorAll('.bs-edit-return-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const b = e.currentTarget;

      // TITLE is built from the row's own dataset, never from the read, so it
      // is already correct in the tap frame and never has to be patched later.
      //
      // FOOTER is passed synchronously and is byte-identical to the old string
      // EXCEPT that the two WRITING actions start `disabled`; the renderer
      // below clears that the moment the fields exist, from which point the
      // markup matches the pre-conversion output exactly. Three reasons the
      // footer is not deferred alongside the body:
      //   • it carries emojiIcon() glyphs, i.e. `<i data-lucide>` nodes, and
      //     handing it to openPage means openPage's own icon sweep hydrates
      //     them exactly as before — a deferred footer would need its own;
      //   • openPage hides .page-panel-foot when footerHTML is '' (app.js), so
      //     deferring it would pop the whole footer bar in mid-load and shove
      //     the body up — a second, worse motion on top of the one we removed;
      //   • `disabled` is the honest state: both handlers read #pres-client &
      //     friends out of the body, and the body is still a skeleton.
      // Cancel deliberately stays live — backing out must work during the load.
      const p = openPage(`${emojiIcon('✎',16)} Edit Quote — ${b.dataset.qno}`,
        // 'rows' × 5 is the closest anatomy the shared skeleton builder
        // (js/ui-states.js) offers to this form's five stacked label+field
        // groups. Nothing hand-rolled here on purpose — no bespoke markup
        // that merely imitates a skeleton.
        window.skeletonHtml('rows', 5), `
        <button class="btn-success" id="pres-approve-edit-btn" disabled>${emojiIcon('✅',16)} Save &amp; Approve</button>
        <button class="btn-primary" id="pres-return-btn" disabled>↩ Save &amp; Return</button>
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      `);
      const bodyEl = p.querySelector('.page-panel-body');
      // Scoped to THIS panel rather than document.getElementById: a fast double
      // tap can stack two edit panels, and a document-wide lookup by id would
      // hand back the OLDER panel's button (both carry the same id), wiring the
      // new panel's save to a buried window. Free correctness, same cost.
      const approveBtn = p.querySelector('#pres-approve-edit-btn');
      const returnBtn  = p.querySelector('#pres-return-btn');

      // The fetched quote, published by the renderer once the read lands. Every
      // consumer reads it from here, so a click that somehow arrives before the
      // fill (or after a failed read) is a silent no-op rather than a TypeError.
      let q = null;

      const getEdits = () => ({
        clientName:    document.getElementById('pres-client').value.trim(),
        clientCompany: document.getElementById('pres-company').value.trim(),
        scope:         document.getElementById('pres-scope').value.trim(),
        total:         parseFloat(document.getElementById('pres-total').value)||q.total||0,
        presidentNotes: document.getElementById('pres-notes').value.trim(),
        editedByPresident: true,
        editedAt: firebase.firestore.FieldValue.serverTimestamp(),
        editedBy: currentUser.uid
      });

      // ── Footer listeners are wired ONCE, HERE — deliberately not in the
      // renderer. The usual rule after this inversion is "wire listeners after
      // the fill", and it applies to anything inside .page-panel-body; these
      // two buttons are the exception because they live in .page-panel-foot,
      // which openPage built synchronously above, so they already exist. Wiring
      // them in the renderer would be actively WRONG: withLoadingAndError's
      // error state ships a Retry button that re-invokes the renderer, and the
      // footer is outside the container it owns, so the buttons are NOT
      // re-created between attempts — each retry would stack another handler on
      // the same node and one tap would fire two writes. `disabled` plus the
      // `if (!q)` guard cover the click-before-fill window instead.
      approveBtn.addEventListener('click', async () => {
        if (!q) return;
        const edits = getEdits();
        await db.collection('bs_quotes').doc(b.dataset.id).update({
          ...edits, status: 'filed', approvalStatus: 'approved',
          approvedAt: firebase.firestore.FieldValue.serverTimestamp(), approvedBy: currentUser.uid
        });
        await db.collection('approval_requests').where('quoteId','==',b.dataset.id).get().then(s => s.docs.forEach(d => d.ref.update({status:'approved'})));
        if (b.dataset.by) await Notifs.send(b.dataset.by, { title:'✅ Quote Approved!', body:`Quotation "${b.dataset.qno}" for ${edits.clientName||b.dataset.name} was approved and filed.`, icon:'✅', type:'quote_approved', link:'bs-quotations' });
        closeModal();
        Notifs.success('Quote edited, approved and filed!');
        window.invalidateBsQuotesCache(currentUser.uid);
        renderBSQuotationsSummary(container, currentUser, currentRole);
      });

      returnBtn.addEventListener('click', async () => {
        if (!q) return;
        const edits = getEdits();
        await db.collection('bs_quotes').doc(b.dataset.id).update({
          ...edits, status: 'needs_revision', approvalStatus: 'needs_revision',
          returnedAt: firebase.firestore.FieldValue.serverTimestamp(), returnedBy: currentUser.uid
        });
        if (b.dataset.by) await Notifs.send(b.dataset.by, {
          title: '↩ Quote Returned for Revision',
          body: `"${b.dataset.qno}" for ${edits.clientName||b.dataset.name} was reviewed and returned. Please check the notes and re-submit.`,
          icon: '✎', type: 'quote_returned', link: 'bs-quotations'
        });
        closeModal();
        Notifs.success('Quote updated and returned to submitter.');
        window.invalidateBsQuotesCache(currentUser.uid);
        renderBSQuotationsSummary(container, currentUser, currentRole);
      });

      // ── skeleton → read → form, via the shared wrapper (js/ui-states.js).
      // Using it rather than hand-rolling buys the failure path for free: a
      // rejected read (offline, rules denial, deleted doc) paints an error
      // block with a working Retry instead of an eternal skeleton, and Retry
      // re-runs this exact fetcher.
      // The wrapper's own first act is `container.innerHTML = skeletonHtml(
      // opts.skeleton, opts.skeletonCount)` — the identical string already
      // handed to openPage above, repainted in the same frame, so the user
      // cannot see it. Passing the skeleton to openPage as WELL is what makes
      // the tap-frame paint a property of this call site rather than of the
      // wrapper's internal ordering.
      window.withLoadingAndError(bodyEl, async () => {
        const snap = await db.collection('bs_quotes').doc(b.dataset.id).get();
        // Pre-conversion this dereferenced snap.data() unguarded, so a quote
        // deleted between the list render and the tap threw a TypeError out of
        // an async listener: unhandled rejection, no window, no feedback at
        // all. Now it routes to the wrapper's error state — and because the
        // footer stays disabled on that path, the user still cannot act on a
        // record that turned out not to exist.
        if (!snap.exists) throw new Error('This quotation no longer exists — it may have been deleted.');
        return snap.data();
      }, (data) => {
        // ── CLOSED MID-FLIGHT ── the user can tap Back before the read lands.
        // Bail before anything with a side effect OUTSIDE this container runs
        // (publishing `q`, enabling the footer of a dismissed window). The
        // wrapper's own writes into a detached bodyEl are inert: setting
        // innerHTML on a node that is no longer in the document paints nothing
        // and cannot re-attach it, so a closed window stays closed.
        if (!bodyEl.isConnected) return;
        q = data;
        bodyEl.innerHTML = `
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">Edit this quotation directly. You can approve after editing, or return it to the submitter.</p>
        <div class="form-group"><label>Client Name</label>
          <input id="pres-client" type="text" value="${(q.clientName||'').replace(/"/g,'&quot;')}" style="width:100%"/>
        </div>
        <div class="form-group"><label>Client Company</label>
          <input id="pres-company" type="text" value="${(q.clientCompany||'').replace(/"/g,'&quot;')}" style="width:100%"/>
        </div>
        <div class="form-group"><label>Scope / Description</label>
          <textarea id="pres-scope" rows="3" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical">${escHtml(q.scope||q.description||'')}</textarea>
        </div>
        <div class="form-group"><label>Adjusted Total (₱)</label>
          <input id="pres-total" type="number" value="${q.total||q.grandTotal||0}" style="width:100%" inputmode="decimal"/>
        </div>
        <div class="form-group"><label>President's Notes / Feedback</label>
          <textarea id="pres-notes" rows="3" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text);resize:vertical" placeholder="Optional notes for the submitter…">${escHtml(q.presidentNotes||'')}</textarea>
        </div>
      `;
        // The footer is now backed by real fields — from here the window is
        // indistinguishable from the pre-conversion one.
        approveBtn.removeAttribute('disabled');
        returnBtn.removeAttribute('disabled');
        // NO lucide sweep here, on purpose. This form contains no data-lucide
        // nodes at all (the only glyphs on this window are the ✎ in the title
        // and the ✅ in the footer, both hydrated by openPage's own sweep when
        // it built the panel), and withLoadingAndError already runs the single
        // guarded `[data-lucide]:not(svg)` sweep over bodyEl the moment this
        // renderer returns (js/ui-states.js) — which correctly finds nothing
        // and skips the document-wide rebuild. An unconditional call here
        // would pay 3-5ms to hydrate zero icons.
      }, { skeleton: 'rows', skeletonCount: 5 });
    });
  });
}

// ══════════════════════════════════════════════════
//  SALES — Share Quote With Client (CLIENT-QUOTE-PAGE-SPEC.md)
//
//  A salesperson taps 🔗 Share on a filed/approved/accepted quote card and
//  gets a public, no-login link (/q/?<token>) the client can open on their
//  phone to review the quote and Accept / Request changes. The design north
//  star (spec §0): the worst a bad actor holding the link can do is read ONE
//  quote's client-facing fields and accept/decline it ONCE — nothing else.
//
//  Access model: the link resolves a SANITIZED MIRROR doc
//  (public_quotes/{token}), never the internal bs_quotes/bk_quotes doc
//  itself — a token-on-quote rules design would leak capitalMaterials/
//  capitalLabor/commission/editableState to anyone holding the link, and
//  Firestore rules cannot hide fields within a readable doc or inspect array
//  contents. buildPublicQuoteDoc() below is therefore the ONE function
//  allowed to write that mirror — it builds a BRAND NEW object field-by-
//  field (never spreads/...quoteDoc) — and every mirror .set() in this app
//  (mint, re-sync here, re-sync from the QUOTE_UPDATE bridge in js/app.js)
//  MUST go through it. The client's Accept/Request-changes response never
//  writes directly to Firestore at all — it goes through the respondToQuote
//  Cloud Function (functions/index.js), which is the ONLY write path; there
//  is no public write rule anywhere in firestore.rules for this collection.
// ══════════════════════════════════════════════════

// Card-action gate (spec §5.1): re-surfacing the link after acceptance is
// allowed on purpose — never for drafts/pending-approval/rejected/needs-
// revision, where there's nothing client-ready to share yet.
window.QUOTE_SHAREABLE_STATUSES = ['filed', 'approved', 'accepted'];

// Public brand strings ONLY (name/sub/creds/thanks — the four fields the
// public page prints). Deliberately DUPLICATED from quote-builder-v2.html's
// CO map (spec §5.2): that map lives inside the builder iframe and isn't
// reachable from this app frame. This is DATA, not code — keep the two in
// sync by hand if the BK/BI/BS letterhead ever changes.
window.QUOTE_BRANDS = {
  BK: {
    name: 'BARRO KITCHENS', sub: 'By Barro Industries OPC',
    creds: 'Barro Industries OPC  •  SEC Registered  •  hello@barroindustries.com  •  09276836300  •  21 Capricorn St., Tandang Sora, Quezon City, 1116 Metro Manila',
    thanks: 'Thank you for considering Barro Kitchens. We look forward to building a kitchen you can rely on for years.',
  },
  // Barro Industries — the parent company quoting general fabrication in its
  // own name. WITHOUT this entry a BI quote shown to a CUSTOMER would fall
  // through to resolveQuoteBrand's fallback and render as Brilliant Steel,
  // which is exactly backwards.
  BI: {
    name: 'BARRO INDUSTRIES OPC', sub: 'SEC-registered One Person Corporation',
    creds: 'Barro Industries OPC  •  SEC Registered  •  hello@barroindustries.com  •  09276836300  •  21 Capricorn St., Tandang Sora, Quezon City, 1116 Metro Manila',
    thanks: 'Thank you for considering Barro Industries. We look forward to fabricating work you can rely on for years.',
  },
  BS: {
    name: 'BRILLIANCE STEEL CORPORATION', sub: '',
    creds: 'Brilliance Steel Corporation  •  SEC / BIR Registered  •  Pasig City, Metro Manila  •  0927 683 6300',
    thanks: 'Thank you for considering Brilliance Steel Corporation. We are committed to quality steelworks delivered on time.',
  },
};

// v1 bankDetails visibility (spec §7.3) — included on the mirror and shown
// whenever non-empty, gated so a partner/BS quote never carries Barro's own
// account in the first place (mirrors quote-builder-v2.html's co.pay
// gating — only CO.BK carries a `pay` block, so bankDetails is only ever
// non-empty on a BK quote to begin with). ONE constant, right next to
// buildPublicQuoteDoc, so a future "reveal only after accept" hardening
// (Neil to decide — spec flags this as a safer v1.1 option, not taken here
// for simplicity) never requires hunting through the render/share code —
// flip this to false AND have functions/index.js's respondToQuote write
// bankDetails onto the mirror only on accept.
// GO-LIVE DECISION (2026-08-04): reveal-on-accept — bankDetails are NOT put on
// the public mirror at share time (this flag = false), so a link-holder cannot
// read the deposit account before accepting. functions/index.js respondToQuote
// writes them onto the mirror ONLY on accept and returns them for the page's
// accepted state. Flip to true to show them upfront (as printed on the quote).
window.QUOTE_MIRROR_SHOW_BANK_DETAILS_IMMEDIATELY = false;

// ── buildPublicQuoteDoc — THE allowlist projection (spec §2.3) ───────────
// Builds a BRAND NEW object field-by-field. NEVER spread/...quoteDoc — this
// is the ONLY line of defense keeping capitalMaterials/capitalLabor/
// laborHours/formulaType/commissionPct/commissionAmount/editableState/
// laborState/waiveFlags/createdBy/createdByRole/clientId/leadSource/
// location/parentQuoteId/rootQuoteId/clientAddress/clientPhone/clientEmail/
// photos[].path off the public internet. Any field NOT explicitly assigned
// below simply does not exist on the returned object — Code review gate
// (spec §2.3): any .set() on public_quotes that doesn't call this function
// is a bug.
window.buildPublicQuoteDoc = function(q, brand, coll, docId) {
  q = q || {};
  const items = Array.isArray(q.items) ? q.items.map(it => ({
    name:      (it && it.name) || '',
    dims:      (it && it.dims) || '',
    specStr:   (it && it.specStr) || '',
    qty:       Number(it && it.qty) || 0,
    unit:      (it && it.unit) || '',
    unitPrice: Number(it && it.unitPrice) || 0,
    amount:    Number(it && it.amount) || 0,
    leadTime:  (it && it.leadTime) || '',
  })) : [];
  // Tokened Storage download URLs only — never the storage `path`, never a
  // raw offline-only dataUrl (buildQuotePayload already strips dataUrl
  // before persisting, but this projection re-asserts it independently).
  const photos = Array.isArray(q.photos) ? q.photos
    .filter(p => p && p.url)
    .map(p => ({ url: p.url, caption: p.caption || '', itemIndex: (p.itemIndex != null ? p.itemIndex : null) }))
    : [];
  const di  = q.deliveryInstall || {};
  const pay = q.payment || {};
  const tl  = q.timeline || {};
  // Custom payment milestones (quote-builder-v2 "Use custom payment
  // milestones"). Re-projected field-by-field like everything else here — the
  // condition text is free-form operator input and lands on a public page, so
  // it is length-capped here and HTML-escaped at render time in q/index.html.
  // null/absent on every legacy quote; the five legacy payment fields above are
  // still copied verbatim so nothing downstream changes.
  const milestones = Array.isArray(pay.milestones) ? pay.milestones.slice(0, 24).map(m => ({
    pct:    Number(m && m.pct) || 0,
    label:  String((m && m.label) || '').slice(0, 80),
    date:   /^\d{4}-\d{2}-\d{2}$/.test(String((m && m.date) || '')) ? String(m.date) : '',
    amount: Number(m && m.amount) || 0,
  })) : null;
  // Narrow to a KNOWN brand code; anything else falls back to 'BS' (the retired
  // generic-partner 'PT' code is gone — PARTNER-REMOVAL-SPEC Phase 3). Driven by
  // QUOTE_BRANDS (BK/BI/BS) rather than a hardcoded pair, so this can't drift out
  // of step with resolveQuoteBrand below.
  const co  = window.QUOTE_BRANDS[q.company] ? q.company : 'BS';
  return {
    v: 1,
    co,
    brand: {
      name:   (brand && brand.name)   || '',
      sub:    (brand && brand.sub)    || '',
      creds:  (brand && brand.creds)  || '',
      thanks: (brand && brand.thanks) || '',
    },
    quoteNumber: q.quoteNumber || '',
    quoteDate:   q.quoteDate || '',
    validUntil:  q.validUntil || '',
    subject:     q.subject || '',
    purpose:     q.purpose || '',
    clientName:    q.clientName || '',
    clientCompany: q.clientCompany || '',
    salesperson:   q.salesperson || '',
    items,
    subtotal:       Number(q.subtotal) || 0,
    discountPct:    Number(q.discountPct) || 0,
    discountAmount: Number(q.discountAmount) || 0,
    netAmount:      Number(q.netAmount) || 0,
    vatIncluded:    !!q.vatIncluded,
    vatAmount:      Number(q.vatAmount) || 0,
    total:          Number(q.total) || Number(q.grandTotal) || 0,
    deliveryInstall: {
      amount:          Number(di.amount) || 0,
      includedInTotal: !!di.includedInTotal,
      free:            !!di.free,
      method:          di.method || '',
      notes:           di.notes || '',
    },
    payment: {
      downPaymentMode: pay.downPaymentMode || '',
      downPayment:     Number(pay.downPayment) || 0,
      balance:         Number(pay.balance) || 0,
      balanceMode:     pay.balanceMode || '',
      interestRate:    Number(pay.interestRate) || 0,
      milestones,   // additive; null on legacy quotes — q/index.html falls back to the rows above
    },
    bankDetails: window.QUOTE_MIRROR_SHOW_BANK_DETAILS_IMMEDIATELY ? (q.bankDetails || '') : '',
    timeline: {
      startDate:      tl.startDate || '',
      leadDays:       Number(tl.leadDays) || 0,
      completionDate: tl.completionDate || '',
    },
    remarks: q.remarks || '',
    photos,
    status: 'pending',
    clientResponse: { status: 'pending' },
    src: { coll: coll || '', id: docId || '' },
    sharedAt: firebase.firestore.FieldValue.serverTimestamp(),
    sharedByName: (window.userProfile && userProfile.displayName) || (window.currentUser && currentUser.email) || '',
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
};

// Resolve the four public brand strings for a quote: BK/BI/BS are static
// (QUOTE_BRANDS above); any other code falls back to Brilliant Steel's. (The
// generic-partner brand that used to be synthesised here for company:'PT' quotes
// went with the external partner role — PARTNER-REMOVAL-SPEC Phase 3.) It stays
// async because every caller awaits it.
window.resolveQuoteBrand = async function(quote) {
  // Table lookup, not a chain of === comparisons: the old two-arm ternary meant
  // every company code it didn't literally name — including 'BI' — silently
  // fell through to the fallback, so a Barro Industries fabrication quote would
  // have been branded as another company.
  const co = window.QUOTE_BRANDS[quote.company] ? quote.company : 'BS';
  return { co, brand: window.QUOTE_BRANDS[co] };
};

// 12-char crypto-random token, same 54-char unambiguous alphabet (no
// 0/O/1/I/l) as window.makeTrackCode (js/departments.js) — longer than
// order-tracking's 8 because a quote leaks full pricing + client identity
// (spec §2.2). 54^12 ≈ 6.4×10²⁰ combinations.
window.makeShareToken = function(len) {
  len = len || 12;
  const A = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = '';
  try {
    const a = new Uint32Array(len);
    (window.crypto || window.msCrypto).getRandomValues(a);
    for (let i = 0; i < len; i++) out += A[a[i] % A.length];
  } catch (_) {
    for (let j = 0; j < len; j++) out += A[Math.floor(Math.random() * A.length)];
  }
  return out;
};
// Collision-checked mint against public_quotes — an unauthenticated `get` on
// a public collection needs no auth, so the check always works even for a
// partner caller (same uniqueTrackCode() pattern, js/departments.js).
window.uniquePublicQuoteToken = async function() {
  for (let i = 0; i < 5; i++) {
    const code = window.makeShareToken(12);
    try {
      const s = await db.collection('public_quotes').doc(code).get();
      if (!s.exists) return code;
    } catch (_) { return code; }   // read blocked → collision odds are negligible anyway
  }
  return window.makeShareToken(16);
};
window.publicQuoteUrl = function(token) { return `${location.origin}/q/?${token}`; };

// Re-sync an EXISTING mirror after the underlying quote changed — used by
// BOTH shareQuoteWithClient's "already shared" re-share path below AND the
// QUOTE_UPDATE bridge's best-effort re-projection (js/app.js, spec §5.2/
// §6.3, "the mirror is a snapshot; an edit after sharing doesn't silently
// mutate what the client already saw" — this is the one place that DOES
// intentionally refresh it, on an explicit re-share or explicit in-place
// edit). Full overwrite of everything buildPublicQuoteDoc produces (so a
// field removed from the quote doesn't linger on the mirror), EXCEPT
// clientResponse/status/sharedAt, which are preserved from the existing
// mirror so a client's already-recorded response is never clobbered. Never
// mints a new token and never resurrects a revoked (deleted) mirror — minting
// only happens in shareQuoteWithClient. Returns true if it resynced, false
// if there was nothing to resync (no shareToken, or the mirror is gone).
window.resyncPublicQuoteMirror = async function(coll, docId, quote) {
  const token = quote && quote.shareToken;
  if (!token) return false;
  const ref = db.collection('public_quotes').doc(token);
  const existing = await ref.get();
  if (!existing.exists) return false;
  const old = existing.data() || {};
  const { brand } = await window.resolveQuoteBrand(quote);
  const fresh = window.buildPublicQuoteDoc(quote, brand, coll, docId);
  fresh.clientResponse = old.clientResponse || { status: 'pending' };
  fresh.status = old.status || 'pending';
  fresh.sharedAt = old.sharedAt || firebase.firestore.FieldValue.serverTimestamp();
  await ref.set(fresh, { merge: false });
  return true;
};

// Delete the mirror + clear the quote's shareToken (spec §5.3). The link
// instantly renders the public page's "no longer available" state — dead
// link, not a 404-equivalent's evil twin; re-sharing always mints a NEW
// token, an old one never comes back.
window.revokeQuoteShare = async function(coll, docId, token) {
  if (token) { try { await db.collection('public_quotes').doc(token).delete(); } catch (_) { /* best-effort */ } }
  await db.collection(coll).doc(docId).update({
    shareToken: firebase.firestore.FieldValue.delete(),
    shareRevokedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
};

// 🔗 shared / response-state chip — used by every quote list that renders a
// shareToken/clientResponse (BK cards + BS table here).
// clientResponse lives on the INTERNAL quote doc too, not just the mirror —
// functions/index.js's respondToQuote writes it there (spec §4.2 step 3) so
// this needs no extra read.
window.quoteShareChipHtml = function(q) {
  if (!q || !q.shareToken) return '';
  const cr = q.clientResponse || null;
  if (cr && cr.status === 'accepted') {
    return `<span class="badge badge-green" style="font-size:9px;margin-left:4px" title="${escHtml(cr.note || '')}">${emojiIcon('✅',9)} client accepted${cr.name ? ' — ' + escHtml(cr.name) : ''}</span>`;
  }
  if (cr && cr.status === 'changes_requested') {
    return `<span class="badge badge-orange" style="font-size:9px;margin-left:4px" title="${escHtml(cr.note || '')}">${emojiIcon('✏️',9)} changes requested${cr.name ? ' — ' + escHtml(cr.name) : ''}</span>`;
  }
  return `<span class="badge badge-blue" style="font-size:9px;margin-left:4px">${emojiIcon('🔗',9)} shared</span>`;
};

// ── Read-only quotation viewer ────────────────────────────────────────
// "Show the quotation this deal was won on" (owner request 2026-08-24).
// Opened from the job/project detail header (js/screens/production.js) and
// reusable anywhere a quote {collection, id} pair is at hand. Renders the
// SAME allowlist projection the public client page uses (buildPublicQuoteDoc
// above) — items, prices, terms, brand — NEVER editableState / capital /
// commission / margin internals, so any viewer cleared to see money sees
// nothing the printed quotation itself wouldn't show. Visibility is layered:
//   1. Callers gate the affordance (production.js: production-only viewers
//      have no money view so they never get the link; BS-only staff only
//      for bs_quotes).
//   2. Firestore rules remain the real gate on the doc read (bk_quotes:
//      creator or admin only; bs_quotes: any internal staff, or the partner
//      who filed it).
//   3. A denied read degrades to opts.fallback — the order snapshot the
//      calling record already displays on the screen underneath
//      (job_projects items/contract) — with a note that the filed
//      quotation itself is restricted. No new exposure either way.
// opts: { won: true to badge the quote as Won (the caller knows the deal
//              closed — job_projects only exist for won quotes),
//         fallback: {quoteNumber, clientName, company, items, total} }
window.openQuoteReadOnly = async function(coll, docId, opts) {
  opts = opts || {};
  if (!docId) return;
  if (!window.QUOTE_COLLECTIONS.includes(coll)) coll = 'bs_quotes';
  const fbNo = (opts.fallback && opts.fallback.quoteNumber) || '';
  const panel = window.openPage(`📋 Quotation${fbNo ? ' ' + escHtml(fbNo) : ''}`, window.skeletonHtml('rows'),
    `<span id="qv-reopen-slot" style="display:contents"></span><button class="btn-secondary" onclick="closeModal()">Close</button>`);
  const bodyEl = panel.querySelector('.page-panel-body');

  let q = null, readErr = null;
  try {
    const snap = await db.collection(coll).doc(docId).get();
    if (snap.exists) q = { id: snap.id, ...snap.data() };
  } catch (ex) { readErr = ex; }
  if (!bodyEl || !bodyEl.isConnected) return;   // dismissed while the read was in flight

  const money = (n) => '₱' + fmt(Number(n) || 0);
  const wonBadge = `<span class="badge ${window.statusBadgeClass('quote','won')}" style="font-size:10px">${window.statusLabel2('quote','won')}</span>`;

  if (!q) {
    // Doc unreadable (rules) or gone — degrade to the caller's own snapshot.
    const denied = !!(readErr && readErr.code === 'permission-denied');
    const note = denied
      ? 'The filed quotation document is restricted — only whoever filed it or an admin can open it. Showing the order snapshot recorded on this project instead.'
      : (readErr ? `Couldn't open the quotation (${escHtml(readErr.message || readErr.code || 'read failed')}).`
                 : 'This quotation document no longer exists — it may have been deleted. Showing the order snapshot recorded on this project instead.');
    const fb = opts.fallback;
    bodyEl.innerHTML = `
      <div class="alert-banner alert-warn" style="margin-bottom:12px"><span>${emojiIcon('🔒',16)} ${note}</span></div>
      ${fb ? `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px"><span style="font-family:monospace">${escHtml(fb.quoteNumber || '')}</span>${fb.company ? ' · ' + escHtml(fb.company) : ''} ${opts.won ? wonBadge : ''}</div>
      <div style="font-weight:700;font-size:15px;margin-bottom:10px">${escHtml(fb.clientName || '')}</div>
      ${(Array.isArray(fb.items) && fb.items.length) ? `
      <div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:0"><div class="table-wrap"><table class="data-table"><thead><tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead><tbody>
        ${fb.items.map(it => `<tr>
          <td style="font-size:12px">${escHtml(it.name || '')}${it.dims ? ` <span style="color:var(--text-muted)">(${escHtml(it.dims)})</span>` : ''}</td>
          <td style="font-size:12px;white-space:nowrap">${Number(it.qty) || 0} ${escHtml(it.unit || '')}</td>
          <td style="font-size:12px">${money(it.unitPrice)}</td>
          <td style="font-size:12px;font-weight:600">${money(it.amount)}</td>
        </tr>`).join('')}
      </tbody></table></div></div></div>` : ''}
      <div style="display:flex;justify-content:flex-end;font-size:14px;font-weight:800">Contract total&nbsp;&nbsp;${money(fb.total)}</div>` : ''}
    `;
    return;
  }

  // Full render off the allowlist projection (same fields the client sees).
  const { brand } = await window.resolveQuoteBrand(q);
  if (!bodyEl.isConnected) return;
  const v = window.buildPublicQuoteDoc(q, brand, coll, docId);
  const stKey = (opts.won || q.salesOrderId) ? 'won' : (q.status || 'draft');
  const di = v.deliveryInstall, pay = v.payment, tl = v.timeline;
  const hasDI  = !!(di.amount || di.free || di.method || di.notes);
  const hasTL  = !!(tl.startDate || tl.leadDays || tl.completionDate);
  const hasPay = !!((pay.milestones && pay.milestones.length) || pay.downPayment || pay.balance);
  const paymentRows = (pay.milestones && pay.milestones.length)
    ? pay.milestones.map(m => `<div style="display:flex;justify-content:space-between;gap:8px"><span>${m.pct ? m.pct + '% — ' : ''}${escHtml(m.label || '')}${m.date ? ` <span style="color:var(--text-muted)">(${escHtml(m.date)})</span>` : ''}</span><strong>${money(m.amount)}</strong></div>`).join('')
    : [
        pay.downPayment ? `<div style="display:flex;justify-content:space-between"><span>Down payment${pay.downPaymentMode ? ` <span style="color:var(--text-muted)">(${escHtml(pay.downPaymentMode)})</span>` : ''}</span><strong>${money(pay.downPayment)}</strong></div>` : '',
        pay.balance ? `<div style="display:flex;justify-content:space-between"><span>Balance${pay.balanceMode ? ` <span style="color:var(--text-muted)">(${escHtml(pay.balanceMode)})</span>` : ''}</span><strong>${money(pay.balance)}</strong></div>` : '',
        pay.interestRate ? `<div style="display:flex;justify-content:space-between"><span>Interest</span><strong>${pay.interestRate}%</strong></div>` : '',
      ].join('');
  bodyEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;margin-bottom:8px">
      <div>
        <div style="font-weight:800;font-size:16px;letter-spacing:.3px">${escHtml(v.brand.name || '')}</div>
        ${v.brand.sub ? `<div style="font-size:11px;color:var(--text-muted)">${escHtml(v.brand.sub)}</div>` : ''}
      </div>
      <div style="text-align:right">
        <span class="badge ${window.statusBadgeClass('quote', stKey)}">${window.statusLabel2('quote', stKey)}</span>${window.quoteShareChipHtml(q)}
      </div>
    </div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
      <span style="font-family:monospace;font-weight:700;color:var(--text)">${escHtml(v.quoteNumber || q.id)}</span>${v.quoteDate ? ` · ${escHtml(v.quoteDate)}` : ''}${v.validUntil ? ` · valid until ${escHtml(v.validUntil)}` : ''}
    </div>
    <div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:10px 14px;font-size:12px">
      <div><span style="color:var(--text-muted)">Client</span> <strong>${escHtml(v.clientName || '—')}</strong>${v.clientCompany ? ` · ${escHtml(v.clientCompany)}` : ''}</div>
      ${v.salesperson ? `<div style="margin-top:3px"><span style="color:var(--text-muted)">Salesperson</span> ${escHtml(v.salesperson)}</div>` : ''}
      ${v.subject ? `<div style="margin-top:3px"><span style="color:var(--text-muted)">Subject</span> ${escHtml(v.subject)}</div>` : ''}
      ${v.purpose ? `<div style="margin-top:3px"><span style="color:var(--text-muted)">Purpose</span> ${escHtml(v.purpose)}</div>` : ''}
    </div></div>
    ${v.items.length ? `
    <div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:0"><div class="table-wrap"><table class="data-table"><thead><tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead><tbody>
      ${v.items.map(it => `<tr>
        <td style="font-size:12px">${escHtml(it.name)}${it.dims ? ` <span style="color:var(--text-muted)">(${escHtml(it.dims)})</span>` : ''}${it.specStr ? `<div style="font-size:10px;color:var(--text-muted)">${escHtml(it.specStr)}</div>` : ''}${it.leadTime ? `<div style="font-size:10px;color:var(--text-muted)">Lead time: ${escHtml(it.leadTime)}</div>` : ''}</td>
        <td style="font-size:12px;white-space:nowrap">${it.qty} ${escHtml(it.unit)}</td>
        <td style="font-size:12px">${money(it.unitPrice)}</td>
        <td style="font-size:12px;font-weight:600">${money(it.amount)}</td>
      </tr>`).join('')}
    </tbody></table></div></div></div>` : ''}
    <div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:10px 14px;font-size:12px">
      <div style="display:grid;grid-template-columns:1fr auto;gap:3px 12px">
        <span style="color:var(--text-muted)">Subtotal</span><span style="text-align:right">${money(v.subtotal)}</span>
        ${v.discountAmount ? `<span style="color:var(--text-muted)">Discount${v.discountPct ? ` (${v.discountPct}%)` : ''}</span><span style="text-align:right">− ${money(v.discountAmount)}</span>
        <span style="color:var(--text-muted)">Net</span><span style="text-align:right">${money(v.netAmount)}</span>` : ''}
        ${v.vatAmount ? `<span style="color:var(--text-muted)">VAT${v.vatIncluded ? ' (included in total)' : ''}</span><span style="text-align:right">${money(v.vatAmount)}</span>` : ''}
        <span style="font-weight:800;border-top:1px solid var(--border);padding-top:4px">TOTAL</span><span style="text-align:right;font-weight:800;border-top:1px solid var(--border);padding-top:4px">${money(v.total)}</span>
      </div>
    </div></div>
    ${hasDI ? `<div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:10px 14px;font-size:12px">
      <strong>${emojiIcon('🚚',12)} Delivery &amp; Installation</strong>
      <div style="margin-top:5px;display:flex;flex-direction:column;gap:3px">
        ${di.free ? '<div>Free delivery &amp; installation</div>' : (di.amount ? `<div style="display:flex;justify-content:space-between"><span>Fee${di.includedInTotal ? ' <span style="color:var(--text-muted)">(included in total)</span>' : ''}</span><strong>${money(di.amount)}</strong></div>` : '')}
        ${di.method ? `<div><span style="color:var(--text-muted)">Method</span> ${escHtml(di.method)}</div>` : ''}
        ${di.notes ? `<div>${escHtml(di.notes)}</div>` : ''}
      </div></div></div>` : ''}
    ${hasPay ? `<div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:10px 14px;font-size:12px">
      <strong>${emojiIcon('💳',12)} Payment Terms</strong>
      <div style="margin-top:5px;display:flex;flex-direction:column;gap:3px">${paymentRows}</div>
    </div></div>` : ''}
    ${hasTL ? `<div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:10px 14px;font-size:12px">
      <strong>${emojiIcon('📅',12)} Timeline</strong>
      <div style="margin-top:5px;display:flex;flex-direction:column;gap:3px">
        ${tl.startDate ? `<div><span style="color:var(--text-muted)">Start</span> ${escHtml(tl.startDate)}</div>` : ''}
        ${tl.leadDays ? `<div><span style="color:var(--text-muted)">Lead time</span> ${tl.leadDays} days</div>` : ''}
        ${tl.completionDate ? `<div><span style="color:var(--text-muted)">Completion</span> ${escHtml(tl.completionDate)}</div>` : ''}
      </div></div></div>` : ''}
    ${v.remarks ? `<div class="card" style="margin-bottom:10px"><div class="card-body" style="padding:10px 14px;font-size:12px"><strong>${emojiIcon('📝',12)} Remarks</strong><div style="margin-top:4px">${escHtml(v.remarks)}</div></div></div>` : ''}
    ${v.photos.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
      ${v.photos.map(ph => `<a href="${escHtml(ph.url)}" target="_blank" rel="noopener"><img src="${escHtml(ph.url)}" alt="${escHtml(ph.caption || 'photo')}" loading="lazy" style="height:64px;width:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border)"/></a>`).join('')}
    </div>` : ''}
    ${v.brand.thanks ? `<div style="font-size:11px;color:var(--text-muted);margin-top:12px">${escHtml(v.brand.thanks)}</div>` : ''}
    ${v.brand.creds ? `<div style="font-size:10px;color:var(--text-muted);margin-top:6px">${escHtml(v.brand.creds)}</div>` : ''}
  `;

  // "Open in builder" — same audience the quotations screens give the Reopen
  // button (internal Sales edit rights, never the view-only secretary role),
  // and only when an editable snapshot exists to open.
  const slot = panel.querySelector('#qv-reopen-slot');
  if (slot && q.editableState && window.currentRole !== 'secretary'
      && typeof canEditDept === 'function' && canEditDept('Sales')) {
    slot.innerHTML = `<button class="btn-secondary" id="qv-reopen-btn" title="Open this quote in the builder — re-filing saves a new copy">↻ Open in builder</button>`;
    slot.querySelector('#qv-reopen-btn').addEventListener('click', () => {
      if (window.Overlay && Overlay.clearAll) Overlay.clearAll(); else closeModal();
      window.reopenQuoteFromDoc(coll, docId);
    });
  }
};

// ── The share action itself ───────────────────────────────────────────
// Wired as a 🔗 Share button on every filed/approved/accepted quote card
// (spec §5.1: BS flat list, BK quotations summary). `onDone` is an
// optional re-render callback (same convention as
// window.requestQuoteDelete) so the caller's list refreshes and picks up
// the new 🔗 shared chip / shareToken.
window.shareQuoteWithClient = async function(coll, docId, onDone) {
  try {
    const snap = await db.collection(coll).doc(docId).get();
    if (!snap.exists) { Notifs.showToast('Quote not found', 'error'); return; }
    const quote = { id: docId, ...snap.data() };
    if (!window.QUOTE_SHAREABLE_STATUSES.includes(quote.status)) {
      Notifs.showToast('Only filed, approved, or accepted quotes can be shared', 'info');
      return;
    }
    let token = quote.shareToken || null;
    const resynced = token ? await window.resyncPublicQuoteMirror(coll, docId, quote) : false;
    if (!resynced) {
      token = await window.uniquePublicQuoteToken();
      const { brand } = await window.resolveQuoteBrand(quote);
      const mirrorDoc = window.buildPublicQuoteDoc(quote, brand, coll, docId);
      await db.collection('public_quotes').doc(token).set(mirrorDoc);
      await db.collection(coll).doc(docId).update({
        shareToken: token,
        sharedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      quote.shareToken = token;
    }
    const url = window.publicQuoteUrl(token);
    window.showShareQuoteModal(url, quote, coll, token, onDone);
    if (typeof onDone === 'function') onDone();
  } catch (err) {
    console.error('[shareQuoteWithClient] failed', err);
    Notifs.showToast('Could not create share link: ' + (err.message || err.code), 'error');
  }
};

// Share modal — clone of window.showOrderTrackModal (js/departments.js)
// plus a native-share button (mobile PH — Viber/WhatsApp hand-off is the
// whole point, spec §5.2 step 5) and a Revoke action (spec §5.3).
window.showShareQuoteModal = function(url, quote, coll, token, onDone) {
  const qno = quote.quoteNumber || quote.id;
  openModal(`${emojiIcon('🔗',16)} Client Quote Link`, `
    <p style="font-size:13px;color:var(--text-2);margin-bottom:12px">Share this link with <strong>${escHtml(quote.clientName || 'the client')}</strong> for quotation <strong>${escHtml(qno)}</strong>. They can open it any time — <strong>no login needed</strong> — to review and Accept or Request changes. Internal costs, commission and your margin are never shown.</p>
    <div style="display:flex;gap:8px;align-items:center">
      <input id="qshare-url" readonly value="${escHtml(url)}" style="flex:1;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:12px" onclick="this.select()"/>
      <button class="btn-primary btn-sm" id="qshare-copy" style="white-space:nowrap">Copy</button>
    </div>
    <div style="margin-top:12px;display:flex;gap:14px;flex-wrap:wrap;align-items:center">
      <a href="${escHtml(url)}" target="_blank" rel="noopener" style="font-size:12px;color:var(--primary);font-weight:600">Preview the client view ↗</a>
      ${window.navigator && navigator.share ? `<button class="btn-secondary btn-sm" id="qshare-native">Share…</button>` : ''}
    </div>
    <p style="font-size:11px;color:var(--text-muted);margin-top:14px">Filing a new revision for this client? Revoke this link first so they never see a superseded offer — a new revision needs its own share.</p>
  `, `<button class="btn-danger btn-sm" id="qshare-revoke" style="margin-right:auto">Revoke link</button><button class="btn-secondary" onclick="closeModal()">Done</button>`);
  const copyBtn = document.getElementById('qshare-copy');
  copyBtn?.addEventListener('click', async () => {
    const inp = document.getElementById('qshare-url');
    try { await navigator.clipboard.writeText(inp.value); } catch (_) { inp.select(); try { document.execCommand('copy'); } catch (__) {} }
    copyBtn.textContent = '✓ Copied'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1600);
    Notifs.showToast('Quote link copied', 'success');
  });
  document.getElementById('qshare-native')?.addEventListener('click', async () => {
    try { await navigator.share({ title: 'Quotation ' + qno, url }); } catch (_) { /* user cancelled — ignore */ }
  });
  document.getElementById('qshare-revoke')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ message: 'Revoke this share link? The client will no longer be able to open it. Re-sharing mints a brand-new link.', danger: true }))) return;
    try {
      await window.revokeQuoteShare(coll, quote.id, token);
      closeModal();
      Notifs.success('Share link revoked.');
      if (typeof onDone === 'function') onDone();
    } catch (ex) { Notifs.showToast('Revoke failed: ' + (ex.message || ex.code), 'error'); }
  });
};
