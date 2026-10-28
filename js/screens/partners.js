/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Brilliant Steel department screens
   js/screens/partners.js  (the file name is kept on purpose: sw.js PRECACHE,
   PAGE_SCRIPTS and css comments reference it)

   Holds the internal Brilliant Steel department:
   - window.renderBrilliantSteel — the 4-chip shell (Quote Builder / Quotations
     Summary / Client Data / Files), loadBSContent (chip dispatcher),
     renderBSFiles (Files chip: Quotations / Images / Drawings / Documents),
     renderBSClientData (quote-derived client accordion for BS-only staff).

   Shared helpers this file calls as bare globals (defined elsewhere; resolved
   at runtime, never at parse time — see CLAUDE.md "Script load order"):
   renderBSQuotationFiles, getBsQuotesOrdered (departments.js);
   renderBSQuotationsSummary (sales.js); renderClientProfiles,
   renderFileCollection, bindFileCollection (departments.js);
   isBrilliantOnly, navigateTo (app.js).
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
        <p style="font-size:11px;color:var(--text-muted)">Brilliant Steel department</p>
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
    // Staff whose ONLY department is Brilliant Steel keep the quote-derived
    // accordion (scoped by bs_quotes rules); everyone else gets the unified CRM
    // hub with stages/follow-ups/timeline.
    case 'Client Data': {
      const bsOnlyView = (typeof isBrilliantOnly === 'function') && isBrilliantOnly();
      if (bsOnlyView) await renderBSClientData(content, currentUser, currentRole);
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
