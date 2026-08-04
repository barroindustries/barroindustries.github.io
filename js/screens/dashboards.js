/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Dashboard + core-page screens
   js/screens/dashboards.js

   Wave 7 Pass 9 — split verbatim out of js/app.js, 2026-08-03, following the
   Wave 2 (design.js) / Wave 7 Pass 1-8 extraction protocol. Still plain
   `window.*`/bare-global-attached functions, no ESM, no bundler — a physical
   split only, not a module. Loads LAST of every js/screens/*.js file (after
   design/tasks/sales/hr/production/finance/approvals/govit/partners/people):
   the screens below call almost every other screen's shared globals at
   runtime (fetchUsersWithPayroll, renderClientProfiles, window.Projects,
   window.Ledger, window.CashAdvance, ledgerForPeriod, Period.parse, etc.) —
   bare-global/window.* resolution, never at parse time, same convention as
   every other Wave 7 pass. app.js's navigateTo switch and the bottom-nav
   route tables (config.js) reach forward into this file's window.render /
   bare render() entry points the same way (see the pass report's caller
   table); notifications.js's deep-links (openMemoById, etc.) do too.

   Contents (screen order matches original app.js top-to-bottom; app.js kept
   its router/auth/nav/shell machinery — navigateTo, buildNav/buildBottomNav/
   buildSidebarNav, openPage/openModal primitives, presence heartbeat, boot,
   the quote-builder iframe host, checkBackupHealth/renderBackupHealthBanner,
   renderMyDepartment/renderDualDeptPicker/renderDeptModule, the Profile
   Drawer, and _promptPhoneNumber — none of that moved):
   - System Health: renderSystemHealth (president/finance page; reads this
     file's own SYSTEM_HEALTH_JOBS... no — reads app.js's SYSTEM_HEALTH_JOBS
     constant, which STAYED behind since checkBackupHealth also needs it).
   - President tools: renderAuditLog, renderProductDatabase.
   - The 6 role dashboards: renderDashboard (role dispatcher — the
     isPartner()/renderPartnerDashboard and isBrilliantOnly()/
     renderBrilliantSteel branches were already routed to partners.js/Wave 7
     Pass 6 before this pass; verified still correct), liveDateTime (shared
     live-clock helper), renderPresidentDashboard, renderManagerDashboard,
     renderSecretaryDashboard, renderFinanceDashboard, renderEmployeeDashboard.
     getAllQuotes (bk_quotes+bs_quotes+legacy quotes merge) moved alongside
     since only dashboard/analytics code in this file calls it non-
     defensively; departments.js/people.js already called it through a
     typeof guard before this move and still do.
   - SOPs: renderSOPs, openSOPEditor.
   - Personal Finance + KPI/attendance-score cluster: renderPersonalFinance,
     getKpiScore, countWorkDays, _attRecScore, getAttendanceScore,
     openEmpStandingsModal, openWorkerProfilePanel, renderWorkerProfileTab.
   - Progress Reports: renderProgressReports.
   - Company: renderCompany, renderCompanyBiOps, renderCompanyOverview,
     renderCompanyMemos, openMemoDetailModal/openMemoById/deleteMemo,
     renderMemosPage, renderCompanyPolicies, renderCompanyDownloads,
     renderCompanyHandbook. (NOT to be confused with people.js's
     renderCompanyOverviewNew/renderPresidentMessageCard — that's a
     different, dead-code, same-purpose function Wave 7 Pass 7 found and
     left alone; THIS file's renderCompany/renderCompanyOverview is the one
     the 'company' nav case actually calls.)
   - Departments: renderDepartments (admin grid landing page — judgment
     call: not named in the Pass 9 brief but sits contiguously in this same
     "core pages" block with an identical shape/access-gate to Company, so
     it moved with the rest rather than being left as a lone island).
   - Analytics: renderAnalytics.
   - Team (accounts admin — distinct from people.js's renderTeamTab, the
     employee-facing team directory): renderTeam, openAddEmployeeModal,
     _getWorkerAuth, openCreateWorkerModal, openEditEmployeeModal.
   - Mini Calendar: _calMonthOffset, renderMiniCal (used by
     renderPresidentDashboard/renderEmployeeDashboard above).
   - renderAccessDenied, formatNum — small helpers used exclusively by the
     screens in this file (verified via full-tree grep before moving).
   - Suggestion Box: renderSuggestionBox, loadSuggestions.
   - Help: renderHelp, renderHelpAdmin, renderHelpEmployee, renderHelpPartner.

   Wave 7 Pass 9 8-point pass, applied in this file only:
   - chipTabs: converted 3 remaining hand-rolled .subtab-bar instances found
     in this cluster — renderProgressReports' "By Department / All Members"
     top tabs, its per-department "All Tasks / By Member" card tabs (was a
     delegated forEach over every [data-dt] button on the page — now one
     bindChipTabs per card, correctly scoped), and renderHelp's role-
     conditional guide tabs. Left the Audit Log's .subtab-bar alone — it's
     two <select> filters reusing the class purely for flex layout, not an
     actual tab bar.
   - aria-label: added to 3 icon-only buttons that had no accessible name
     (Company Memos/Downloads delete buttons, Team's per-row edit-employee
     button).
   - KPI-failure silent-zero → warn-once: renderPresidentDashboard,
     renderManagerDashboard, renderSecretaryDashboard, renderFinanceDashboard
     each declared an identical local `safeGet` that swallowed every
     Firestore read error into an empty snapshot with NO signal anywhere —
     a broken rule/index/network blip just showed every KPI sourced from it
     as 0, silently. renderProgressReports and renderAnalytics had the same
     shape (safeGet / the `cg` cache wrapper). renderEmployeeDashboard had
     3 more inline instances (cash_advances/attendance_extensions/
     kpi_targets), and renderPresidentDashboard + renderFinanceDashboard
     each had a silent Projects.listAll() catch. Added one shared
     _dashWarnOnce(label, err) (right above renderDashboard) that
     console.warns once per collection per page-load — not per re-render,
     so normal dashboard nav doesn't spam — and wired all of the above
     through it with a per-collection label. Nothing user-facing changed
     (still degrades to 0/empty on failure); the failure is just visible in
     devtools now instead of invisible.
   - Surfaces: audited every openModal/openPage call in this cluster —
     already compliant (openEmpStandingsModal/openWorkerProfilePanel/detail
     flows use openPage; the few openModal call sites are pre-existing,
     explicitly-commented "v14 Batch5 A3 — KEEP as openModal" single-field/
     one-time-info cases, not stragglers).
   - Tables (item 4): NOT done — found 23 `data-table` instances in this
     file (Team, Analytics, Company Overview, Audit Log, System Health,
     Progress Reports, Memos, etc.) and ZERO using `.table-cards`, versus
     .table-cards already adopted in finance.js/hr.js/govit.js/partners.js/
     sales.js/people.js/production.js/departments.js/modules.js. This is
     bigger than "a dense table or two was missed" — it's this whole file
     never having had the pass. Converting properly means adding per-<td>
     role classes (tc-avatar/tc-name/tc-detail/etc., see styles.css ~2028)
     to every one of the 23 tables, which is a real redesign, not a class
     add, and isn't safely verifiable without a live responsive check.
     Left deliberately for a follow-up pass; flagged in the Pass 9 report.
   - Empty-state (item 3): NOT swept — 28 raw `class="empty-state"` divs vs
     1 renderEmptyState() call in this file, but that ratio matches the rest
     of the pre-existing codebase (people.js 14:6, departments.js 16:1,
     finance.js 5:0, hr.js 8:0) — a codebase-wide gap predating this pass,
     not something to force-fix here per the "no forced sweep" instruction.
   - sopPanel (item 8): N/A — that gap list (Design/IT/Purchasing/Sales) is
     department screens, not dashboards; nothing in this file's scope.
   ═══════════════════════════════════════════════════ */

async function renderSystemHealth() {
  if (!isPresident() && currentRole !== 'finance') return;
  const c = document.getElementById('page-content');
  c.innerHTML = window.skeletonHtml('rows');

  const [healthDocs, errorRows] = await Promise.all([
    Promise.all(SYSTEM_HEALTH_JOBS.map(job =>
      db.collection('system_health').doc(job.id).get().catch(() => null)
    )),
    (async () => {
      try {
        const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
        const snap = await db.collection('error_log')
          .where('ts', '>=', since)
          .orderBy('ts', 'desc')
          .limit(200)
          .get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (_) {
        return [];
      }
    })(),
  ]);

  const now = Date.now();
  const jobs = SYSTEM_HEALTH_JOBS.map((job, i) => {
    const snap = healthDocs[i];
    const d = snap && snap.exists ? snap.data() : null;
    const lastMs = d?.lastRunAt?.toDate?.()?.getTime?.() || 0;
    const stale = !lastMs || (now - lastMs) > job.staleMs;
    const errored = d?.lastStatus === 'error';
    const status = !d ? 'unknown' : errored ? 'error' : stale ? 'stale' : 'ok';
    return { ...job, data: d, lastMs, status, errors: d?.errors || 0 };
  });

  const badge = (status) => {
    if (window.statusBadge2) return window.statusBadge2('systemHealth', status);
    const cls = status === 'ok' ? 'badge-green' : status === 'stale' ? 'badge-orange' : status === 'error' ? 'badge-red' : 'badge-gray';
    const label = { ok: 'Healthy', stale: 'Stale', error: 'Error', unknown: 'No data' }[status] || status;
    return `<span class="badge ${cls}">${escHtml(label)}</span>`;
  };

  const fmtAbs = (ms) => ms ? window.fmtManila(new Date(ms)) : '—';
  const fmtRel = (ms) => {
    if (!ms) return 'never';
    const diffMs = now - ms;
    const mins = Math.round(diffMs / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 48) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return `${days}d ago`;
  };

  const errorCount7d = errorRows.length;
  const recentErrors = errorRows.slice(0, 10);

  c.innerHTML = `
    <div class="page-header"><h2>${emojiIcon('📡',20)} System Health</h2>
      <span class="badge ${jobs.some(j=>j.status==='error'||j.status==='stale') ? 'badge-red' : 'badge-green'}">
        ${jobs.filter(j=>j.status==='error'||j.status==='stale').length} of ${jobs.length} need attention
      </span>
    </div>
    <p style="font-size:12px;color:var(--text-muted);margin:0 0 12px">
      Heartbeat status for scheduled jobs and functions. Daily/attendance/digest jobs are flagged stale after 36h without a report; the monthly backup and its size guard after 40 days.
    </p>
    <div class="card"><div class="card-body" style="padding:0">
      <div class="table-wrap"><table class="data-table table-cards" id="sh-jobs-table">
        <thead><tr><th>Job</th><th>Cadence</th><th>Status</th><th>Last run (Manila)</th><th>Errors</th></tr></thead>
        <tbody>
          ${jobs.map(j => `
            <tr class="sh-job-row">
              <td class="tc-name">${escHtml(j.label)} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
              <td class="tc-detail" data-label="Cadence" style="font-size:12px;color:var(--text-muted)">${escHtml(j.cadence)}</td>
              <td class="tc-net">${badge(j.status)}</td>
              <td class="tc-detail" data-label="Last run" style="font-size:12px" title="${escHtml(fmtAbs(j.lastMs))}">${escHtml(fmtRel(j.lastMs))}${j.lastMs ? ` <span style="color:var(--text-muted)">(${escHtml(fmtAbs(j.lastMs))})</span>` : ''}</td>
              <td class="tc-detail" data-label="Errors" style="font-size:12px">${j.errors ? `<span style="color:var(--danger,#b91c1c)">${j.errors}${j.data?.label ? ' — ' + escHtml(j.data.label) : ''}</span>` : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>
    </div></div>

    <h3 style="margin:20px 0 8px;font-size:15px">Error log (last 7 days)</h3>
    <div class="card"><div class="card-body">
      ${!errorRows.length
        ? window.renderEmptyState({ icon: '✅', title: 'No errors logged', hint: 'error_log has been clean for the last 7 days.' })
        : `
        <p style="font-size:12px;color:var(--text-muted);margin:0 0 10px">${errorCount7d} error${errorCount7d===1?'':'s'} in the last 7 days. Showing the 10 most recent.</p>
        <div class="table-wrap"><table class="data-table table-cards no-toggle">
          <thead><tr><th>When</th><th>Page</th><th>Message</th><th>Version</th></tr></thead>
          <tbody>
            ${recentErrors.map(e => `
              <tr>
                <td data-label="When" style="white-space:nowrap;font-size:12px">${escHtml(e.ts?.toDate ? window.fmtManila(e.ts.toDate()) : '—')}</td>
                <td data-label="Page" style="font-size:12px">${escHtml(e.page || '—')}</td>
                <td data-label="Message" style="font-size:11px;color:var(--text-muted);max-width:340px;word-break:break-word">${escHtml(e.message || '—')}</td>
                <td data-label="Version" style="font-size:11px;color:var(--text-muted)">${escHtml(e.version || '—')}</td>
              </tr>`).join('')}
          </tbody>
        </table></div>`}
    </div></div>
    <p style="font-size:11px;color:var(--text-muted);margin-top:10px">Cloud Function errors (executeApprovalOnUpdate, sendNotificationQuota) beyond their own heartbeat entry require a manual check in the <a href="https://console.firebase.google.com/" target="_blank" rel="noopener">Firebase console</a> logs.</p>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  // Card view (≤700px): tap the row to reveal cadence/last-run/errors — same
  // class-toggle idiom as the shared .table-cards pattern (styles.css ~2028).
  c.querySelectorAll('#sh-jobs-table tr.sh-job-row').forEach(tr => {
    tr.addEventListener('click', () => tr.classList.toggle('tc-expanded'));
  });
}

async function renderAuditLog() {
  if (!isPresident()) return;
  const c = document.getElementById('page-content');
  c.innerHTML = window.skeletonHtml('rows');
  let entries = [];
  try {
    const snap = await db.collection('audit_log').orderBy('ts','desc').limit(500).get();
    entries = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  } catch (e) {
    c.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Could not load audit log</h4><p style="font-size:12px;color:var(--text-muted)">${escHtml(e.message||'')}</p></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    return;
  }
  const entities = [...new Set(entries.map(e=>e.entity).filter(Boolean))].sort();
  const actions  = [...new Set(entries.map(e=>e.action).filter(Boolean))].sort();
  const actBadge = a => ({create:'badge-green',update:'badge-blue',delete:'badge-red',approve:'badge-green',reject:'badge-orange',reset:'badge-orange'}[a]||'badge-gray');
  const fmtTs = ts => { try { return ts?.toDate ? ts.toDate().toLocaleString('en-PH',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'; } catch(_) { return '—'; } };

  c.innerHTML = `
    <div class="page-header"><h2>${emojiIcon('📜',20)} Audit Log</h2><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="badge badge-gray">${entries.length} entr${entries.length===1?'y':'ies'}</span><button class="btn-secondary btn-sm" id="security-backfill-btn" title="One-time: backfill the username login map">${emojiIcon('🔧',16)} Security backfill</button><button class="btn-secondary btn-sm" id="audit-csv">${emojiIcon('⬇',16)} CSV</button></div></div>
    <p style="font-size:12px;color:var(--text-muted);margin:0 0 12px">Append-only trail of changes to sensitive data (payroll, finance, inventory, products, production, deals, passwords). Newest first, last 500.</p>
    <div class="subtab-bar" style="flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <select id="audit-entity" style="padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)">
        <option value="all">All entities</option>${entities.map(e=>`<option value="${escHtml(e)}">${escHtml(e)}</option>`).join('')}
      </select>
      <select id="audit-action" style="padding:6px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)">
        <option value="all">All actions</option>${actions.map(a=>`<option value="${escHtml(a)}">${escHtml(a)}</option>`).join('')}
      </select>
    </div>
    <div class="card"><div class="card-body" style="padding:0">
      ${!entries.length ? `<div class="empty-state" style="padding:30px"><div class="empty-icon">${emojiIcon('📜',44)}</div><h4>No audit entries yet</h4><p>Sensitive changes will be recorded here.</p></div>` :
      `<div class="table-wrap"><table class="data-table table-cards">
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>ID</th><th>Details</th></tr></thead>
        <tbody id="audit-tbody"></tbody>
      </table></div>`}
    </div></div>`;
  if (window.lucide) lucide.createIcons({ nodes: [c] });

  const draw = () => {
    const fe = document.getElementById('audit-entity')?.value || 'all';
    const fa = document.getElementById('audit-action')?.value || 'all';
    const rows = entries.filter(e => (fe==='all'||e.entity===fe) && (fa==='all'||e.action===fa));
    const tb = document.getElementById('audit-tbody');
    if (!tb) return;
    tb.innerHTML = rows.map(e => `
      <tr class="audit-row">
        <td class="tc-detail" data-label="When" style="white-space:nowrap;font-size:12px">${fmtTs(e.ts)}</td>
        <td class="tc-name">${escHtml(e.actorName||'—')}${e.actorRole?`<div style="font-size:11px;color:var(--text-muted)">${escHtml(e.actorRole)}</div>`:''} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
        <td class="tc-net"><span class="badge ${actBadge(e.action)}">${escHtml(e.action||'—')}</span></td>
        <td class="tc-detail" data-label="Entity" style="font-size:12px">${escHtml(e.entity||'—')}</td>
        <td class="tc-detail" data-label="ID" style="font-size:11px;font-family:monospace;color:var(--text-muted)">${escHtml(e.entityId||'—')}</td>
        <td class="tc-detail" data-label="Details" style="font-size:11px;color:var(--text-muted);max-width:240px;word-break:break-word">${escHtml(JSON.stringify(e.details||{}))}</td>
      </tr>`).join('') || '<tr><td colspan="6" style="padding:16px;text-align:center;color:var(--text-muted)">No entries match the filter.</td></tr>';
    if (window.lucide) lucide.createIcons({ nodes: [tb] });
    tb.querySelectorAll('tr.audit-row').forEach(tr => tr.addEventListener('click', () => tr.classList.toggle('tc-expanded')));
  };
  document.getElementById('audit-entity')?.addEventListener('change', draw);
  document.getElementById('audit-action')?.addEventListener('change', draw);
  document.getElementById('security-backfill-btn')?.addEventListener('click', () => window.runSecurityBackfill());
  document.getElementById('audit-csv')?.addEventListener('click', () => {
    const fe = document.getElementById('audit-entity')?.value || 'all';
    const fa = document.getElementById('audit-action')?.value || 'all';
    const rows = entries.filter(e => (fe==='all'||e.entity===fe) && (fa==='all'||e.action===fa));
    window.exportCSV('audit-log', rows, [
      { key:'when', label:'When', get:e=>fmtTs(e.ts) },
      { key:'actorName', label:'Who' }, { key:'actorRole', label:'Role' },
      { key:'action', label:'Action' }, { key:'entity', label:'Entity' }, { key:'entityId', label:'Entity ID' },
      { key:'details', label:'Details', get:e=>JSON.stringify(e.details||{}) },
    ]);
  });
  draw();
}

async function renderProductDatabase() {
  if (!isPresident()) return;
  const c = document.getElementById('page-content');
  c.innerHTML = window.skeletonHtml('cards');

  let snap, metaSnap;
  try {
    await seedCatalogIfNeeded();
    [snap, metaSnap] = await Promise.all([
      db.collection('products').limit(1000).get(),
      db.collection('productMeta').doc('config').get(),
    ]);
  } catch (err) {
    c.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Could not load products</h4><p style="font-size:12px;color:var(--text-muted)">${escHtml(err.message||'')}</p><button class="btn-secondary" id="pdb-retry-btn" style="margin-top:10px">Retry</button></div>`;
    document.getElementById('pdb-retry-btn')?.addEventListener('click', () => renderProductDatabase());
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    return;
  }
  const products = snap.docs.map(d => normalizeProduct({ id: d.id, ...d.data() }));
  const meta = metaSnap.exists ? metaSnap.data() : { categories: [] };
  const categories = meta.categories || [];

  // Group by category
  const byCategory = {};
  products.forEach(p => {
    const cat = p.category || 'uncategorized';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(p);
  });
  const allCatIds = [...new Set([...categories.map(c => c.id), ...Object.keys(byCategory)])];

  const fmt = n => `₱${window.fmtN2(n || 0)}`;
  const measureStr = m => (m && (m.W || m.D || m.H)) ? `${m.W || '—'} × ${m.D || '—'} × ${m.H || '—'} mm` : '—';

  // prefix scopes element IDs so the hidden "Add Product" form and an
  // inline "Edit" row never collide (getElementById only ever finds the
  // first match in the DOM, which silently broke saves when both existed).
  const formRow = (p = {}, prefix = 'pdb-f') => `
    <div class="form-group"><label>Title</label><input type="text" id="${prefix}-title" placeholder="e.g. SS Prep Table" value="${(p.title||'').replace(/"/g,'&quot;')}"></div>
    <div class="form-group"><label>Code</label><input type="text" id="${prefix}-code" placeholder="e.g. SF-006" value="${p.id||''}" ${p.id?'disabled':''}></div>
    <div class="form-group"><label>Category</label>
      <select id="${prefix}-cat">
        ${allCatIds.map(cid=>`<option value="${cid}" ${p.category===cid?'selected':''}>${pdbCategoryLabel(cid, categories)}</option>`).join('')}
        <option value="__new__">+ New Category…</option>
      </select>
    </div>
    <div class="form-group" id="${prefix}-newcat-wrap" style="display:none"><label>New Category Name</label><input type="text" id="${prefix}-newcat" placeholder="Category name"></div>
    <div class="form-group"><label>Unit</label><input type="text" id="${prefix}-unit" placeholder="unit / sqm / lot" value="${escHtml(p.unit||'')}"></div>
    <div class="form-group"><label>Price (₱)</label><input type="number" inputmode="decimal" id="${prefix}-price" placeholder="0.00" min="0" step="0.01" value="${p.basePrice||''}"></div>
    <div class="form-group"><label>Capital — Materials (₱)</label>
      <div style="display:flex;gap:6px;align-items:center">
        <input type="number" inputmode="decimal" id="${prefix}-capmat" placeholder="0.00" min="0" step="0.01" value="${p.capitalMaterials||''}" style="flex:1">
        <button type="button" class="btn-secondary btn-sm pdb-bom-btn" data-prefix="${prefix}" data-bom="${encodeURIComponent(JSON.stringify(p.bom||[]))}" title="Build from raw-material prices in Inventory">${emojiIcon('🧮',16)} BOM</button>
      </div>
      <div id="${prefix}-bom-note" style="font-size:11px;color:var(--text-muted);margin-top:3px">${(p.bom&&p.bom.length)?`${p.bom.length} material line(s) linked to inventory`:''}</div>
    </div>
    <div class="form-group"><label>Capital — Labor (₱)</label><input type="number" inputmode="decimal" id="${prefix}-caplab" placeholder="0.00" min="0" step="0.01" value="${p.capitalLabor||''}"></div>
    <div class="form-group"><label>Measurement — Width (mm)</label><input type="number" inputmode="numeric" id="${prefix}-w" min="0" value="${p.measurement?.W||''}"></div>
    <div class="form-group"><label>Measurement — Depth (mm)</label><input type="number" inputmode="numeric" id="${prefix}-d" min="0" value="${p.measurement?.D||''}"></div>
    <div class="form-group"><label>Measurement — Height (mm)</label><input type="number" inputmode="numeric" id="${prefix}-h" min="0" value="${p.measurement?.H||''}"></div>
    <div class="form-group"><label>Pricing Type</label>
      <select id="${prefix}-formula">
        <option value="fixed" ${p.formulaType==='fixed'||!p.formulaType?'selected':''}>Fixed price</option>
        <option value="per_length" ${p.formulaType==='per_length'?'selected':''}>Scales by length (width)</option>
        <option value="per_area" ${p.formulaType==='per_area'?'selected':''}>Scales by area (sqm)</option>
      </select>
    </div>
    <div class="form-group" id="${prefix}-coef-wrap"><label id="${prefix}-coef-label">Price per extra mm (₱)</label><input type="number" inputmode="decimal" id="${prefix}-coef" min="0" step="0.01" value="${p.formula?.pricePerExtraMm||p.formula?.pricePerSqm||''}"></div>
    <div class="form-group" style="grid-column:1/-1"><label>Specifications</label><textarea id="${prefix}-specs" rows="2" placeholder="Material grade, thickness, finish, etc.">${escHtml(p.specifications||'')}</textarea></div>
    <div class="form-group" style="grid-column:1/-1"><label>Product Photo</label>
      <div style="display:flex;gap:10px;align-items:center">
        <img id="${prefix}-photo-prev" src="${(p.photoUrl||'').replace(/"/g,'&quot;')}" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border);${p.photoUrl?'':'display:none'}">
        <div id="${prefix}-photo-up" style="flex:1"></div>
      </div>
    </div>
  `;

  c.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <h2 style="font-size:20px;font-weight:800;color:var(--text)">${emojiIcon('📦',20)} Product Database</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-secondary btn-sm" id="pdb-import-btn" title="Add any new items from products-database.json (e.g. the Baking line). Never overwrites your edits.">⟳ Import new from catalog</button>
        <button class="btn-primary btn-sm" id="pdb-add-btn">+ Add Product</button>
      </div>
    </div>

    <div id="pdb-add-form" style="display:none" class="card" style="margin-bottom:16px">
      <div class="card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${formRow()}
        <div style="grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end">
          <button class="btn-secondary btn-sm" id="pdb-cancel-btn">Cancel</button>
          <button class="btn-primary btn-sm" id="pdb-save-btn">Save Product</button>
        </div>
      </div>
    </div>

    <div id="pdb-tables">
      ${allCatIds.map(catId => {
        const prods = byCategory[catId] || [];
        return `
        <div class="card" style="margin-bottom:14px">
          <div class="card-header" style="display:flex;align-items:center;justify-content:space-between">
            <h3 style="font-size:14px;font-weight:700">${pdbCategoryLabel(catId, categories)}</h3>
            <span style="font-size:12px;color:var(--text-muted)">${prods.length} item${prods.length!==1?'s':''}</span>
          </div>
          <div class="card-body" style="padding:0">
            ${!prods.length ? '<div style="padding:16px;color:var(--text-muted);font-size:13px">No products in this category.</div>' : `
            <div class="table-wrap">
              <table class="data-table table-cards">
                <thead><tr><th>Code</th><th>Title</th><th>Measurement</th><th>Specifications</th><th>Unit</th><th style="text-align:right">Price</th><th style="text-align:right">Capital (Mat.)</th><th style="text-align:right">Capital (Labor)</th><th></th></tr></thead>
                <tbody>
                  ${prods.map(p => `
                    <tr data-pid="${escHtml(p.id)}" class="pdb-row">
                      <td class="tc-detail" data-label="Code"><span style="font-family:monospace;font-size:12px">${escHtml(p.id)}</span></td>
                      <td class="tc-name">${escHtml(p.title||'')}${!p.photoUrl?` <span title="No photo yet" style="opacity:.5">${emojiIcon('📷',16)}</span>`:''} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
                      <td class="tc-detail" data-label="Measurement" style="font-size:12px">${measureStr(p.measurement)}</td>
                      <td class="tc-detail" data-label="Specifications" style="font-size:12px;max-width:220px">${escHtml(p.specifications||'—')}</td>
                      <td class="tc-detail" data-label="Unit">${escHtml(p.unit||'—')}</td>
                      <td class="tc-net" style="text-align:right">${fmt(p.basePrice)}</td>
                      <td class="tc-detail" data-label="Capital (Mat.)" style="text-align:right">${fmt(p.capitalMaterials)}</td>
                      <td class="tc-detail" data-label="Capital (Labor)" style="text-align:right">${fmt(p.capitalLabor)}</td>
                      <td class="tc-actions" style="text-align:right;white-space:nowrap">
                        <button class="btn-secondary btn-sm pdb-edit-btn" data-pid="${escHtml(p.id)}">Edit</button>
                        <button class="btn-danger btn-sm pdb-del-btn" data-pid="${escHtml(p.id)}" data-name="${escHtml(p.title||'')}" style="margin-left:4px">Delete</button>
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>`}
          </div>
        </div>`;
      }).join('')}
    </div>
  `;
  // Icons render once at mount — syncCoefLabel toggles visibility/text only on
  // each formula change, it must not re-scan the DOM for icons every time.
  if (window.lucide) lucide.createIcons({ nodes: [c] });

  const coefLabelFor = ft => ft === 'per_area' ? 'Price per extra sqm (₱)' : 'Price per extra mm (₱)';
  const syncCoefLabel = prefix => {
    const ft = document.getElementById(`${prefix}-formula`)?.value;
    const wrap = document.getElementById(`${prefix}-coef-wrap`);
    const label = document.getElementById(`${prefix}-coef-label`);
    if (!wrap || !label) return;
    wrap.style.display = ft === 'fixed' ? 'none' : '';
    label.textContent = coefLabelFor(ft);
  };

  function wireForm(prefix = 'pdb-f') {
    document.getElementById(`${prefix}-cat`).addEventListener('change', e => {
      document.getElementById(`${prefix}-newcat-wrap`).style.display = e.target.value === '__new__' ? '' : 'none';
    });
    document.getElementById(`${prefix}-formula`).addEventListener('change', () => syncCoefLabel(prefix));
    syncCoefLabel(prefix);
    if (window.Drive?.renderUploadArea) Drive.renderUploadArea(`${prefix}-photo-up`, r => {
      pdbPhoto[prefix] = r.url;                                  // r = {url, name} per drive.js contract
      const img = document.getElementById(`${prefix}-photo-prev`);
      if (img) { img.src = r.url; img.style.display = ''; }
    }, { accept:'image/*', label:'Upload photo (JPG/PNG)', dept:'Sales', subfolder:'Product Photos' });
  }

  // Add product toggle
  document.getElementById('pdb-add-btn').addEventListener('click', () => {
    document.getElementById('pdb-add-form').style.display = '';
    document.getElementById('pdb-add-btn').style.display = 'none';
    wireForm('pdb-f');
  });

  // Import any new catalog items (e.g. the Baking line) from products-database.json
  document.getElementById('pdb-import-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('pdb-import-btn');
    if (!await confirmDialog({ message: 'Import any new products from the catalog file?\n\nThis ADDS items not already in your database (and merges new categories like Baking). It never overwrites or deletes your existing edits.' })) return;
    btn.disabled = true; btn.textContent = 'Importing…';
    try {
      const added = await importNewCatalogItems();
      dbCacheInvalidate && dbCacheInvalidate('products');
      Notifs.showToast(added ? `Imported ${added} new product${added !== 1 ? 's' : ''}` : 'Already up to date — nothing new to import', 'success');
      renderProductDatabase();
    } catch (e) {
      console.warn('[products] import failed', e);
      Notifs.showToast('Import failed — check connection and try again', 'error');
      btn.disabled = false; btn.textContent = '⟳ Import new from catalog';
    }
  });
  document.getElementById('pdb-cancel-btn').addEventListener('click', () => {
    renderProductDatabase();
  });

  // Bill-of-materials per open form (keyed by prefix), set when a BOM is applied.
  const pdbBom = {};
  // Photo URL per open form (keyed by prefix), set when a photo is uploaded.
  const pdbPhoto = {};

  async function collectAndSaveProduct(existingId, prefix = 'pdb-f') {
    const title   = document.getElementById(`${prefix}-title`).value.trim();
    const code    = (document.getElementById(`${prefix}-code`).value.trim() || existingId || '').toUpperCase();
    const catSel  = document.getElementById(`${prefix}-cat`).value;
    const category = catSel === '__new__' ? document.getElementById(`${prefix}-newcat`).value.trim() : catSel;
    const unit    = document.getElementById(`${prefix}-unit`).value.trim();
    const basePrice = parseFloat(document.getElementById(`${prefix}-price`).value) || 0;
    const capitalMaterials = parseFloat(document.getElementById(`${prefix}-capmat`).value) || 0;
    const capitalLabor = parseFloat(document.getElementById(`${prefix}-caplab`).value) || 0;
    const W = parseFloat(document.getElementById(`${prefix}-w`).value) || 0;
    const D = parseFloat(document.getElementById(`${prefix}-d`).value) || 0;
    const H = parseFloat(document.getElementById(`${prefix}-h`).value) || 0;
    const formulaType = document.getElementById(`${prefix}-formula`).value;
    const coef = parseFloat(document.getElementById(`${prefix}-coef`).value) || 0;
    const specifications = document.getElementById(`${prefix}-specs`).value.trim();
    if (!title || !code || !category) { Notifs.showToast('Title, code, and category are required', 'error'); return false; }

    const measurement = { ...(W ? { W } : {}), ...(D ? { D } : {}), ...(H ? { H } : {}) };
    const formula = formulaType === 'per_length' ? { baseLengthMm: W || 0, pricePerExtraMm: coef }
      : formulaType === 'per_area' ? { pricePerSqm: coef }
      : {};

    // Preserve / persist the bill-of-materials. Use the version applied this
    // session if any, otherwise the one carried on the BOM button (original).
    let bom = pdbBom[prefix];
    if (bom === undefined) {
      const btn = document.querySelector(`.pdb-bom-btn[data-prefix="${prefix}"]`);
      try { bom = btn ? JSON.parse(decodeURIComponent(btn.dataset.bom || '[]')) : []; }
      catch (_) { bom = []; }
    }

    // Build the payload first, then only touch photoUrl if THIS session actually
    // uploaded one — merge:true otherwise keeps the existing photo untouched.
    const payload = {
      title, category, unit, basePrice, capitalMaterials, capitalLabor,
      measurement, specifications, formulaType, formula, bom: bom || [],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      ...(existingId ? {} : { createdAt: firebase.firestore.FieldValue.serverTimestamp() }),
    };
    if (pdbPhoto[prefix] !== undefined) payload.photoUrl = pdbPhoto[prefix];
    await db.collection('products').doc(code).set(payload, { merge: true });
    window.logAudit && window.logAudit(existingId ? 'update' : 'create', 'product', code, { title, basePrice });
    return true;
  }

  // ── Bill-of-Materials modal — compute Materials capital from Inventory ──
  // Loads raw materials from inventory_items; each line = qty × live unit cost.
  // Re-applying re-prices against current inventory, so a steel-price change in
  // Inventory flows into the product's material cost the next time it's applied.
  async function openBomModal(prefix, existingBom) {
    const target = document.getElementById(`${prefix}-capmat`);
    if (!target) return;
    // v14 Batch5 A3 — substantial detail/edit content (dynamic inventory table
    // + apply action), CONVERT openModal→openPage. This call site reads the
    // body element back out after the async inventory fetch resolves, so it
    // must use the panel openPage RETURNS instead of the old #modal-body
    // singleton id (openPage creates a fresh per-call panel, no such id).
    const panel = openPage(`${emojiIcon('🧮',16)} Materials from Inventory`, `<div style="padding:24px">${window.skeletonHtml('rows')}</div>`,
      '<button class="btn-primary" id="bom-apply">Apply to Materials Cost</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>');
    const snap = await db.collection('inventory_items').orderBy('name').get().catch(() => ({ docs: [] }));
    const mats = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(i => (i.kind || 'material') === 'material');
    const qtyById = {};
    (existingBom || []).forEach(l => { qtyById[l.itemId] = l.qty; });

    const body = panel.querySelector('.page-panel-body');
    if (!mats.length) {
      if (body) body.innerHTML = `<div class="empty-state" style="padding:20px"><div class="empty-icon">${emojiIcon('📦',44)}</div><h4>No raw materials in Inventory</h4><p>Add raw materials (with unit cost) in the Inventory module first, then build a BOM here.</p></div>`;
      if (window.lucide) lucide.createIcons({ nodes: [body] });
      return;
    }
    const rows = mats.map(m => `
      <tr>
        <td style="font-weight:600">${escHtml(m.name || '—')}<div style="font-size:11px;color:var(--text-muted)">₱${window.fmtN2(m.unitCost||0)} / ${escHtml(m.unit||'unit')}</div></td>
        <td style="width:90px"><input type="number" inputmode="decimal" min="0" step="0.01" class="bom-qty" data-id="${m.id}" data-cost="${m.unitCost||0}" data-name="${escHtml(m.name||'')}" data-unit="${escHtml(m.unit||'')}" value="${qtyById[m.id]||''}" placeholder="0" style="width:100%;padding:5px;text-align:center"></td>
        <td class="bom-line-total" style="text-align:right;width:90px">₱0.00</td>
      </tr>`).join('');
    if (body) body.innerHTML = `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Enter the quantity of each raw material used per unit. Line cost = qty × current Inventory unit price.</div>
      <div class="table-wrap" style="max-height:46vh;overflow:auto"><table class="data-table">
        <thead><tr><th>Material (unit price)</th><th>Qty</th><th style="text-align:right">Line ₱</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-weight:700;border-top:2px solid var(--border);padding-top:10px">
        <span>Total Materials Cost</span><span id="bom-total" style="font-size:16px">₱0.00</span>
      </div>`;

    const recompute = () => {
      let total = 0;
      body.querySelectorAll('.bom-qty').forEach(inp => {
        const q = parseFloat(inp.value) || 0;
        const cost = parseFloat(inp.dataset.cost) || 0;
        const line = q * cost;
        total += line;
        inp.closest('tr').querySelector('.bom-line-total').textContent = '₱' + window.fmtN2(line);
      });
      const tEl = document.getElementById('bom-total');
      if (tEl) tEl.textContent = '₱' + window.fmtN2(total);
      return total;
    };
    body.querySelectorAll('.bom-qty').forEach(inp => inp.addEventListener('input', recompute));
    recompute();

    document.getElementById('bom-apply').addEventListener('click', () => {
      const lines = [];
      let total = 0;
      body.querySelectorAll('.bom-qty').forEach(inp => {
        const q = parseFloat(inp.value) || 0;
        if (q <= 0) return;
        const cost = parseFloat(inp.dataset.cost) || 0;
        total += q * cost;
        lines.push({ itemId: inp.dataset.id, name: inp.dataset.name, unit: inp.dataset.unit, unitCost: cost, qty: q });
      });
      pdbBom[prefix] = lines;
      target.value = total ? total.toFixed(2) : '';
      const note = document.getElementById(`${prefix}-bom-note`);
      if (note) note.textContent = lines.length ? `${lines.length} material line(s) linked to inventory · ₱${window.fmtN2(total)}` : '';
      closeModal();
      Notifs.showToast('Materials cost computed from inventory', 'success');
    });
  }

  document.getElementById('pdb-save-btn').addEventListener('click', async () => {
    const btn = document.getElementById('pdb-save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const ok = await collectAndSaveProduct(null, 'pdb-f');
      if (ok) { Notifs.showToast('Product saved!', 'success'); renderProductDatabase(); }
      else { btn.disabled = false; btn.textContent = 'Save Product'; }
    } catch (e) { Notifs.showToast('Error saving product', 'error'); btn.disabled = false; btn.textContent = 'Save Product'; }
  });

  // Edit & Delete
  c.addEventListener('click', async e => {
    // Card view (≤700px): tap a product row (outside its buttons) to reveal
    // the full spec/capital breakdown — same tap-to-expand idiom as the
    // shared .table-cards pattern (styles.css ~2028).
    const pdbRow = e.target.closest('tr.pdb-row');
    if (pdbRow && !e.target.closest('button, a')) { pdbRow.classList.toggle('tc-expanded'); return; }
    // BUILD MATERIALS FROM INVENTORY (BOM)
    if (e.target.classList.contains('pdb-bom-btn')) {
      const prefix = e.target.dataset.prefix;
      let bom = pdbBom[prefix];
      if (bom === undefined) { try { bom = JSON.parse(decodeURIComponent(e.target.dataset.bom || '[]')); } catch (_) { bom = []; } }
      openBomModal(prefix, bom);
      return;
    }
    // DELETE
    if (e.target.classList.contains('pdb-del-btn')) {
      const pid  = e.target.dataset.pid;
      const name = e.target.dataset.name;
      if (!await confirmDialog({ message: `Delete "${escHtml(name)}"? This cannot be undone.`, danger: true, html: true })) return;
      await db.collection('products').doc(pid).delete();
      window.logAudit && window.logAudit('delete', 'product', pid, { name });
      Notifs.showToast('Product deleted', 'success');
      renderProductDatabase();
      return;
    }
    // EDIT — open the same form pre-filled, inline above the row's table
    if (e.target.classList.contains('pdb-edit-btn')) {
      const pid = e.target.dataset.pid;
      const prod = products.find(p => p.id === pid);
      if (!prod) return;
      const tr = c.querySelector(`tr[data-pid="${pid}"]`);
      const colSpan = tr.children.length;
      tr.outerHTML = `<tr data-pid="${pid}" data-editing="1"><td colspan="${colSpan}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px 0">
          ${formRow(prod, 'pdb-e')}
          <div style="grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end">
            <button class="btn-secondary btn-sm pdb-cancel-edit-btn">Cancel</button>
            <button class="btn-primary btn-sm pdb-save-edit-btn" data-pid="${pid}">Save</button>
          </div>
        </div>
      </td></tr>`;
      wireForm('pdb-e');
      return;
    }
    // SAVE EDIT
    if (e.target.classList.contains('pdb-save-edit-btn')) {
      const pid = e.target.dataset.pid;
      e.target.disabled = true; e.target.textContent = 'Saving…';
      try {
        const ok = await collectAndSaveProduct(pid, 'pdb-e');
        if (ok) { Notifs.showToast('Product updated!', 'success'); renderProductDatabase(); }
        else { e.target.disabled = false; e.target.textContent = 'Save'; }
      } catch (err) { Notifs.showToast('Error saving product', 'error'); e.target.disabled = false; e.target.textContent = 'Save'; }
      return;
    }
    // CANCEL EDIT
    if (e.target.classList.contains('pdb-cancel-edit-btn')) {
      renderProductDatabase();
    }
  });
}

// Merge the real quote collections (Barro Kitchens + Brilliant Steel) plus the
// legacy `quotes` collection into one {docs:[...]} shape, so dashboards and
// analytics reflect where quotes are actually saved (bk_quotes / bs_quotes).
async function getAllQuotes() {
  // Self-cache under the shared 'all-quotes' key so every caller (dashboard,
  // analytics, partner activity) reuses one snapshot instead of re-reading three
  // collections each. Invalidated on quote writes via dbCacheInvalidate('all-quotes').
  return dbCachedGet('all-quotes', async () => {
    const [bk, bs, legacy] = await Promise.all([
      db.collection('bk_quotes').get().catch(()=>({docs:[]})),
      db.collection('bs_quotes').get().catch(()=>({docs:[]})),
      db.collection('quotes').get().catch(()=>({docs:[]}))
    ]);
    return { docs: [...bk.docs, ...bs.docs, ...legacy.docs] };
  }, 30000);
}

// ── DASHBOARD ─────────────────────────────────────
// Wave 7 Pass 9 — dashboard/analytics/progress-reports KPI reads used to
// swallow Firestore read failures completely silently (empty catch → empty
// snapshot), so a broken security rule, missing index, or offline read just
// rendered as "0"/empty with zero signal anywhere, on every affected card.
// This warns once per collection/query per page-load (not per re-render, so
// repeat dashboard navigations don't spam) — visible in devtools instead of
// invisible. Applied to: renderPresidentDashboard, renderManagerDashboard,
// renderSecretaryDashboard, renderFinanceDashboard, renderEmployeeDashboard,
// renderProgressReports, renderAnalytics (the safeGet/cg helpers each of
// those defines locally, plus a couple of inline .catch()s).
const _dashWarned = new Set();
function _dashWarnOnce(label, err) {
  if (_dashWarned.has(label)) return;
  _dashWarned.add(label);
  console.warn(`[Dashboard] "${label}" read failed \u2014 any KPI/count sourced from it will show as 0/empty until this is fixed:`, err);
}

async function renderDashboard() {
  if (isPresident()) {
    await renderPresidentDashboard();
  } else if (currentRole === 'secretary') {
    await renderSecretaryDashboard();
  } else if (currentRole === 'manager') {
    await renderManagerDashboard();
  } else if (currentRole === 'finance') {
    await renderFinanceDashboard();
  } else if (isPartner()) {
    await renderPartnerDashboard();
  } else if (isBrilliantOnly()) {
    renderBrilliantSteel(currentUser, currentRole, 'Quotations Summary');
  } else {
    await renderEmployeeDashboard();
  }
}

// Partner — Project Details (PARTNER_STAGE, renderPartnerProjects) — moved
// verbatim to js/screens/partners.js (Wave 7 Pass 6, 2026-08-03). The
// navigateTo 'partner-projects' case above still calls renderPartnerProjects()
// as a bare global identifier.

// renderPartnerDashboard — moved verbatim to js/screens/partners.js (Wave 7
// Pass 6, 2026-08-03). renderDashboard's isPartner() branch above still
// calls it as a bare global identifier. Uses this file's liveDateTime
// (below, shared with every other dashboard) the same way.

// Single clock interval — cleared before each new dashboard render
let _liveDateInterval = null;
function liveDateTime(elId) {
  if (_liveDateInterval) { clearInterval(_liveDateInterval); _liveDateInterval = null; }
  const update = () => {
    const el = document.getElementById(elId);
    if (!el) { clearInterval(_liveDateInterval); _liveDateInterval = null; return; }
    const str = new Date().toLocaleString('en-PH', {
      weekday:'long', year:'numeric', month:'long', day:'numeric',
      hour:'2-digit', minute:'2-digit', second:'2-digit'
    });
    // Mutate the existing text node's data instead of reassigning .textContent:
    // a .data write is a characterData mutation, which app.js's #page-content
    // MutationObserver (childList/subtree only) does NOT react to — so this
    // per-second tick no longer retriggers a full fitKpiValues() re-fit pass.
    // Same visible output, just without the childList mutation.
    if (el.firstChild && el.firstChild.nodeType === 3 && el.childNodes.length === 1) {
      el.firstChild.data = str;
    } else {
      el.textContent = str;
    }
  };
  update();
  _liveDateInterval = setInterval(update, 1000);
  // Belt-and-braces: dashboard re-renders already clear this on the next call,
  // but a sign-out mid-dashboard shouldn't leave a clock ticking either.
  Session.addCleanup(() => { if (_liveDateInterval) { clearInterval(_liveDateInterval); _liveDateInterval = null; } });
}

async function renderPresidentDashboard() {
  const c = document.getElementById('page-content');
  c.innerHTML = window.skeletonHtml('cards');
  try {
    const safeGet = async (q, label) => { try { return await q.get(); } catch(e) { _dashWarnOnce(label || 'query', e); return { docs:[], size:0 }; } };
    const todayStr = bizDate();
    const [usersSnap, tasksSnap, subsSnap, quotesSnap, approvalsSnap, caSnap, extSnap, signupSnap, leaveSnap, finDelSnap, payDelSnap, bsDelSnap, bkDelSnap, clientDelSnap, poSnap, raiseSnap, ledgerSnap, prevLedSnap, invSnap, projList] = await Promise.all([
      dbCachedGet('users',         () => db.collection('users').get(),                                    30000),
      dbCachedGet('tasks-all',     () => db.collection('tasks').get(),                                    30000),
      dbCachedGet('submissions',   () => db.collection('submissions').get(),                              30000),
      dbCachedGet('all-quotes',    getAllQuotes,                                                          30000),
      dbCachedGet('approvals-pending',   () => safeGet(db.collection('approval_requests').where('status','==','pending'), 'approval_requests'),     30000),
      dbCachedGet('ca-pending',          () => safeGet(db.collection('cash_advances').where('status','==','pending'), 'cash_advances'),         30000),
      dbCachedGet('att-ext-pending',     () => safeGet(db.collection('attendance_extensions').where('status','==','pending'), 'attendance_extensions'), 30000),
      dbCachedGet('signups-pending',     () => safeGet(db.collection('signup_requests').where('status','==','pending'), 'signup_requests'),       30000),
      // v14 fix — mirror the Approvals page's full 14-source fetch (approvals.js:140-155)
      // so the Command Center's pending total/badge never disagrees with the queue it
      // links to (navigateTo('approvals')). Previously only 5 of 14 sources were counted.
      // The President is the ONLY approver for these six sources (APPROVAL_CAPS,
      // approvals.js:112-116), so omitting them hid exactly what only they can clear.
      dbCachedGet('leave-pending',       () => safeGet(db.collection('leave_requests').where('status','==','pending'), 'leave_requests'),         30000),
      dbCachedGet('findel-pending',      () => safeGet(db.collection('finance_delete_requests').where('status','==','pending'), 'finance_delete_requests'), 30000),
      dbCachedGet('paydel-pending',      () => safeGet(db.collection('payroll_delete_requests').where('status','==','pending'), 'payroll_delete_requests'), 30000),
      dbCachedGet('bsdel-pending',       () => safeGet(db.collection('bs_quotes').where('deleteRequested','==',true), 'bs_quotes'),               30000),
      dbCachedGet('bkdel-pending',       () => safeGet(db.collection('bk_quotes').where('deleteRequested','==',true), 'bk_quotes'),               30000),
      dbCachedGet('clientdel-pending',   () => safeGet(db.collection('clients').where('deleteRequested','==',true), 'clients'),                   30000),
      dbCachedGet('po-pending',          () => safeGet(db.collection('purchase_requisitions').where('approvalStatus','==','pending'), 'purchase_requisitions'), 30000),
      dbCachedGet('raises-pending',      () => safeGet(db.collection('pending_raises').where('status','==','pending_approval'), 'pending_raises'), 30000),
      ledgerForPeriod('month'),
      ledgerForPeriod('prev'),
      dbCachedGet('inventory_items',     () => safeGet(db.collection('inventory_items'), 'inventory_items'),                                       45000),
      (window.Projects && window.Projects.listAll ? window.Projects.listAll() : Promise.resolve([])).catch(e => { _dashWarnOnce('projects', e); return []; }),
    ]);

    const users       = usersSnap.docs.map(d=>({id:d.id,...d.data()}));
    const allTasks    = tasksSnap.docs.map(d=>({id:d.id,...d.data()}));
    const CLOSED_STATUSES = ['done','approved','archived'];
    const openTasks   = allTasks.filter(t=>!CLOSED_STATUSES.includes(t.status));
    const doneTasks   = allTasks.filter(t=>CLOSED_STATUSES.includes(t.status));
    const overdueTasks= openTasks.filter(t=>t.dueDate && t.dueDate < todayStr);
    const highPriority= openTasks.filter(t=>t.priority==='high').length;
    const pendingSubs = subsSnap.docs.filter(d=>d.data().status==='pending').length;
    // Active pipeline = value of all non-rejected quotes (BK + BS), not the legacy `quotes` collection.
    // v13 fix: sum total||grandTotal||amount (many BS/BK quotes store the value under grandTotal,
    // not total) — the old `q.total||0` counted those as zero, so the pipeline under-reflected reality.
    // v14 accuracy fix — dedupe revision chains: R1/R2/R3 of the same quote were
    // ALL summed, triple-counting the pipeline. window.latestQuoteRevisions keeps
    // only the newest revision per lineage (same dedup the Sales summary uses).
    // 30-agent beta sweep fix — this card's rule (dedupe, exclude rejected/lost) was
    // the one kept correct in the audit, so it's now the shared canonical pipeline
    // formula (window.quotePipelineValue, sales.js) instead of an inline one-off —
    // the Sales tab's Pipeline ₱ and the Analytics screen's Pipeline Value KPI were
    // rewritten to call the same function, so this number can no longer drift from
    // theirs. Output is byte-identical to the previous inline calc.
    const _rawQuotes = quotesSnap.docs.map(d=>d.data());
    const totalQuotes = window.quotePipelineValue ? window.quotePipelineValue(_rawQuotes) : 0;
    const pendingApprovals = approvalsSnap.size;
    const pendingCA   = caSnap.size;
    const pendingExtensions = extSnap.size || 0;
    const pendingSignups = signupSnap.size || 0;
    // v14 fix — the remaining 9 Approvals-page sources (approvals.js:145-154).
    // tasksSnap/allTasks is already loaded above, so the review-task count is
    // free (no extra fetch); the rest come from the Promise.all above.
    const pendingReview  = allTasks.filter(t=>t.status==='review').length;
    const pendingLeave   = leaveSnap.size || 0;
    const pendingFinDel  = finDelSnap.size || 0;
    const pendingPayDel  = payDelSnap.size || 0;
    const pendingBsDel   = bsDelSnap.size || 0;
    const pendingBkDel   = bkDelSnap.size || 0;
    const pendingClientDel = clientDelSnap.size || 0;
    const pendingPO      = poSnap.size || 0;
    const pendingRaises  = raiseSnap.size || 0;
    const totalPending = pendingApprovals + pendingCA + pendingExtensions + pendingSubs + pendingSignups
      + pendingReview + pendingLeave + pendingFinDel + pendingPayDel + pendingBsDel + pendingBkDel + pendingClientDel + pendingPO + pendingRaises;

    // Total payroll burn (sum of net pay of all employees)
    const payrollBurn = users.reduce((s,u)=>(s+(u.salary||0)+(u.allowance||0)-(u.deductions||0)),0);

    // Month-to-date financials (ledger: credit = income, debit = expense) for remote oversight
    const mtdLedger  = ledgerSnap.docs.map(d=>d.data());     // already this-month-bounded
    const mtdNet = mtdLedger.filter(e=>ledgerKind(e)==='income').reduce((s,e)=>s+(e.amount||0),0)
                 - mtdLedger.filter(e=>ledgerKind(e)==='expense').reduce((s,e)=>s+(e.amount||0),0);
    const prevLedger = prevLedSnap.docs.map(d=>d.data());    // already prev-month-bounded
    const prevNet = prevLedger.filter(e=>ledgerKind(e)==='income').reduce((s,e)=>s+(e.amount||0),0)
                  - prevLedger.filter(e=>ledgerKind(e)==='expense').reduce((s,e)=>s+(e.amount||0),0);
    // Inventory low-stock count
    const lowStock = invSnap.docs.map(d=>d.data()).filter(i=>(i.reorderLevel||0)>0 && (i.qty||0)<=(i.reorderLevel||0)).length;
    // Receivables outstanding (+ 90+ day overdue) — owner cash-flow visibility.
    const _dS = ts => { try { const t = ts && ts.toDate ? ts.toDate() : (ts && ts.seconds ? new Date(ts.seconds*1000) : null); return t?Math.floor((Date.now()-t.getTime())/86400000):0; } catch(_) { return 0; } };
    const _openAR = (projList||[]).filter(p=>(p.arBalance||0)>0 && !['paid','cancelled','lost'].includes(String(p.stage||'').toLowerCase()));
    const arOutstanding = _openAR.reduce((s,p)=>s+(p.arBalance||0),0);
    const arOverdue = _openAR.filter(p=>_dS(p.createdAt)>90).reduce((s,p)=>s+(p.arBalance||0),0);

    // Sort open tasks: overdue first, then by priority (high→medium→low), then by dueDate
    const priorityOrder = { high:0, medium:1, low:2 };
    const sortedOpen = [...openTasks].sort((a,b)=>{
      const aOvr = a.dueDate && a.dueDate < todayStr ? 0 : 1;
      const bOvr = b.dueDate && b.dueDate < todayStr ? 0 : 1;
      if (aOvr !== bOvr) return aOvr - bOvr;
      const ap = priorityOrder[a.priority]??2, bp = priorityOrder[b.priority]??2;
      if (ap !== bp) return ap - bp;
      return (a.dueDate||'').localeCompare(b.dueDate||'');
    });

    const taskBadge = (t) => {
      const isOverdue = t.dueDate && t.dueDate < todayStr;
      if (isOverdue) return `<span class="badge badge-red">Overdue</span>`;
      if (t.status==='done') return window.statusBadge2 ? window.statusBadge2('task','done') : `<span class="badge badge-green">Done</span>`;
      if (t.priority==='high') return `<span class="badge badge-red">High</span>`;
      return window.statusBadge2 ? window.statusBadge2('task', t.status||'open') : `<span class="badge badge-blue">${t.status||'open'}</span>`;
    };
    const getAssignedNames = (t) => {
      const uids = Array.isArray(t.assignedTo) ? t.assignedTo : (t.assignedTo ? [t.assignedTo] : []);
      if (!uids.length) return 'Unassigned';
      return uids.map(uid => escHtml(users.find(u=>u.id===uid)?.displayName || '?')).join(', ');
    };

    c.innerHTML = `
      <div class="page-header">
        <h2>Command Center</h2>
        <span class="badge badge-blue">${ROLES[currentRole]?.label||'President'}</span>
      </div>
      <div id="live-clock" class="live-clock-line"></div>

      ${overdueTasks.length>0?`
      <div class="alert-banner alert-danger" onclick="navigateTo('tasks')">
        <span>${emojiIcon('⚠️',16)} <strong>${overdueTasks.length} overdue task${overdueTasks.length>1?'s':''}</strong> need immediate attention</span>
        <span class="alert-chevron">›</span>
      </div>`:''}

      ${totalPending>0?`
      <div class="alert-banner alert-warn" onclick="navigateTo('approvals')">
        <span>${emojiIcon('📋',16)} <strong>${totalPending} pending</strong> — ${[pendingSignups>0?pendingSignups+' signup'+(pendingSignups!==1?'s':''):'', pendingApprovals>0?pendingApprovals+' approval'+(pendingApprovals!==1?'s':''):'', pendingCA>0?pendingCA+' CA'+(pendingCA!==1?'s':''):'', pendingExtensions>0?pendingExtensions+' extension'+(pendingExtensions!==1?'s':''):'', pendingSubs>0?pendingSubs+' submission'+(pendingSubs!==1?'s':''):'', pendingReview>0?pendingReview+' review'+(pendingReview!==1?'s':''):'', pendingLeave>0?pendingLeave+' leave'+(pendingLeave!==1?'s':''):'', (pendingFinDel+pendingPayDel)>0?(pendingFinDel+pendingPayDel)+' delete req'+((pendingFinDel+pendingPayDel)!==1?'s':''):'', (pendingBsDel+pendingBkDel+pendingClientDel)>0?(pendingBsDel+pendingBkDel+pendingClientDel)+' record delete'+((pendingBsDel+pendingBkDel+pendingClientDel)!==1?'s':''):'', pendingPO>0?pendingPO+' PO'+(pendingPO!==1?'s':''):'', pendingRaises>0?pendingRaises+' raise'+(pendingRaises!==1?'s':''):''].filter(Boolean).join(' · ')}</span>
        <span class="alert-chevron">›</span>
      </div>`:''}

      <div class="kpi-row">
        <div class="kpi-card">
          <div class="kpi-icon-wrap" style="background:var(--info-soft)"><i data-lucide="users" style="stroke:var(--info);width:18px"></i></div>
          <div class="kpi-label">Team</div>
          <div class="kpi-value">${users.length}</div>
        </div>
        <div class="kpi-card ${openTasks.length>0?'accent':''}">
          <div class="kpi-icon-wrap" style="background:var(--primary-soft)"><i data-lucide="check-square" style="stroke:var(--primary);width:18px"></i></div>
          <div class="kpi-label">Open Tasks</div>
          <div class="kpi-value">${openTasks.length}</div>
          <div class="kpi-sub">${doneTasks.length} done · ${highPriority} high</div>
        </div>
        <div class="kpi-card ${overdueTasks.length>0?'red':''}">
          <div class="kpi-icon-wrap" style="background:var(--danger-soft)"><i data-lucide="alert-triangle" style="stroke:var(--danger);width:18px"></i></div>
          <div class="kpi-label">Overdue</div>
          <div class="kpi-value">${overdueTasks.length}</div>
        </div>
        <div class="kpi-card green">
          <div class="kpi-icon-wrap" style="background:var(--success-soft)"><i data-lucide="trending-up" style="stroke:var(--success);width:18px"></i></div>
          <div class="kpi-label">Quote Pipeline</div>
          <div class="kpi-value" style="font-size:15px">₱${formatNum(totalQuotes)}</div>
        </div>
        <div class="kpi-card warn">
          <div class="kpi-icon-wrap" style="background:var(--warning-soft)"><i data-lucide="banknote" style="stroke:var(--warning);width:18px"></i></div>
          <div class="kpi-label">Monthly Payroll</div>
          <div class="kpi-value" style="font-size:15px">₱${formatNum(payrollBurn)}</div>
        </div>
        <div class="kpi-card ${mtdNet>=0?'green':'red'}" style="cursor:pointer" onclick="navigateTo('dept:Finance')">
          <div class="kpi-icon-wrap" style="background:var(--success-soft)"><i data-lucide="line-chart" style="stroke:var(--success);width:18px"></i></div>
          <div class="kpi-label">Net Income (MTD)</div>
          <div class="kpi-value" style="font-size:15px;color:${mtdNet>=0?'var(--success)':'var(--danger)'}">₱${formatNum(mtdNet)}</div>
          <div style="margin-top:3px">${window.momDelta ? window.momDelta(mtdNet, prevNet, true) : ''}</div>
        </div>
        <div class="kpi-card ${arOverdue>0?'red':''}" style="cursor:pointer" onclick="navigateTo('dept:Finance')">
          <div class="kpi-icon-wrap" style="background:var(--primary-soft)"><i data-lucide="hand-coins" style="stroke:var(--primary);width:18px"></i></div>
          <div class="kpi-label">A/R Outstanding</div>
          <div class="kpi-value" style="font-size:15px">₱${formatNum(arOutstanding)}</div>
          ${arOverdue>0?`<div class="kpi-sub" style="color:var(--danger)">₱${formatNum(arOverdue)} overdue 90+d</div>`:''}
        </div>
        <div class="kpi-card ${lowStock>0?'red':''}" style="cursor:pointer" onclick="navigateTo('inventory')">
          <div class="kpi-icon-wrap" style="background:var(--danger-soft)"><i data-lucide="boxes" style="stroke:var(--danger);width:18px"></i></div>
          <div class="kpi-label">Low Stock</div>
          <div class="kpi-value">${lowStock}</div>
          <div class="kpi-sub">${lowStock>0?'needs reorder':'all stocked'}</div>
        </div>
      </div>

      <div class="dashboard-grid">
        <div class="card">
          <div class="card-header">
            <h3>Live Task Feed</h3>
            <button class="btn-primary btn-sm" onclick="navigateTo('tasks')">All Tasks</button>
          </div>
          <div class="card-body" style="padding:0">
            ${!sortedOpen.length
              ? `<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon('✅',44)}</div><p>All tasks done!</p></div>`
              : sortedOpen.slice(0,8).map(t=>{
                  const isOverdue = t.dueDate && t.dueDate < todayStr;
                  return `<div class="task-feed-item ${isOverdue?'task-overdue':''}">
                    <div class="task-feed-dot priority-dot-${t.priority||'medium'}"></div>
                    <div style="flex:1;min-width:0">
                      <div class="task-feed-title">${escHtml(t.title)}</div>
                      <div class="task-feed-meta">
                        ${getAssignedNames(t)}
                        ${t.dueDate?` · <span style="color:${isOverdue?'var(--danger)':'var(--text-muted)'}">Due ${t.dueDate}</span>`:''}
                        ${t.department?` · ${escHtml(t.department)}`:''}
                      </div>
                    </div>
                    ${taskBadge(t)}${(t.openFollowUpCount||0)>0?`<span class="badge badge-orange" style="margin-left:4px">${emojiIcon('📣',16)} ${t.openFollowUpCount}</span>`:''}
                  </div>`;
                }).join('')}
          </div>
        </div>

        <div>
          <div class="card" style="margin-bottom:16px">
            <div class="card-header"><h3>${emojiIcon('📅',20)} Calendar</h3></div>
            <div class="card-body" id="mini-cal"></div>
          </div>
          <div class="card">
            <div class="card-header"><h3>Quick Actions</h3></div>
            <div class="card-body" style="display:flex;flex-direction:column;gap:8px">
              <button class="quick-action-btn" onclick="navigateTo('tasks')">
                <i data-lucide="plus-circle"></i> New Task
              </button>
              <button class="quick-action-btn" onclick="navigateTo('approvals')">
                <i data-lucide="shield-check"></i> Review Approvals
                ${totalPending>0?`<span class="badge badge-red" style="margin-left:auto">${totalPending}</span>`:''}
              </button>
              <button class="quick-action-btn" onclick="navigateTo('progress')">
                <i data-lucide="trending-up"></i> Progress Reports
              </button>
              <button class="quick-action-btn" onclick="navigateTo('bk-quote-builder')">
                <i data-lucide="file-plus"></i> BK Quote Builder
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    liveDateTime('live-clock');
    renderMiniCal();
    if (window.lucide) lucide.createIcons({ nodes: [c] });
  } catch(err) {
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Dashboard error</h4><p style="font-size:12px;color:var(--text-muted)">${err.message}</p></div>`;
  }
}

// ── MANAGER DASHBOARD ─────────────────────────────
// Department-scoped oversight: team attendance, dept task health, dept approvals.
async function renderManagerDashboard() {
  const c = document.getElementById('page-content');
  c.innerHTML = window.skeletonHtml('cards');
  try {
    const safeGet = async (q, label) => { try { return await q.get(); } catch(e) { _dashWarnOnce(label || 'query', e); return { docs:[], size:0 }; } };
    const todayStr = bizDate();
    const depts = currentDepts || [];
    const [usersSnap, tasksSnap, subsSnap, approvalsSnap, caSnap, attExtSnap, leaveSnap, poSnap] = await Promise.all([
      dbCachedGet('users',     () => db.collection('users').get(), 30000),
      dbCachedGet('tasks-all', () => db.collection('tasks').get(), 30000),
      dbCachedGet('submissions', () => db.collection('submissions').get(), 30000),
      dbCachedGet('approvals-pending', () => safeGet(db.collection('approval_requests').where('status','==','pending'), 'approval_requests'), 30000),
      dbCachedGet('ca-pending',        () => safeGet(db.collection('cash_advances').where('status','==','pending'), 'cash_advances'),     30000),
      // Re-audit 2026-08-03: deptPending below used to omit pending attendance
      // extensions entirely, even though APPROVAL_CAPS lists 'attendance' as
      // manager-actionable and both the President/Secretary dashboards already
      // fold it into their totals — a manager saw no alert/badge for a team
      // member's pending Time-In extension.
      dbCachedGet('att-ext-pending', () => safeGet(db.collection('attendance_extensions').where('status','==','pending'), 'attendance_extensions'), 30000),
      // v14 fix — APPROVAL_CAPS (approvals.js:105,106,111) also authorizes a
      // manager on 'leave' and 'po-approval'; 'review-task' is covered for free
      // below via deptTasks (tasksSnap is already fetched, no extra query needed).
      // Both new sources are dept/team-scoped the same way submissions/attendance
      // extensions already are, below.
      dbCachedGet('leave-pending', () => safeGet(db.collection('leave_requests').where('status','==','pending'), 'leave_requests'), 30000),
      dbCachedGet('po-pending',    () => safeGet(db.collection('purchase_requisitions').where('approvalStatus','==','pending'), 'purchase_requisitions'), 30000),
    ]);
    const users = usersSnap.docs.map(d=>({id:d.id,...d.data()}));
    const inDept = (u) => { const ud = Array.isArray(u.departments)?u.departments:(u.department?[u.department]:[]); return depts.some(d=>ud.includes(d)); };
    const team = users.filter(inDept);
    const teamIds = new Set(team.map(u=>u.id));
    const allTasks = tasksSnap.docs.map(d=>({id:d.id,...d.data()}));
    const deptTasks = allTasks.filter(t => depts.includes(t.department) ||
      (Array.isArray(t.assignedTo)?t.assignedTo:(t.assignedTo?[t.assignedTo]:[])).some(uid=>teamIds.has(uid)));
    const CLOSED = ['done','approved','archived'];
    const openT = deptTasks.filter(t=>!CLOSED.includes(t.status));
    const doneT = deptTasks.filter(t=>CLOSED.includes(t.status));
    const overdueT = openT.filter(t=>t.dueDate && t.dueDate < todayStr);
    const subs = subsSnap.docs.map(d=>({id:d.id,...d.data()}));
    const attExtPending = attExtSnap.docs.filter(d=>teamIds.has(d.data().uid)).length;
    // v14 fix — review-task count is free via deptTasks (same dept/assignedTo
    // scoping as "Department Tasks" below); leave and PO are dept/team-scoped
    // the same way submissions is scoped above (createdBy/uid resp. requestingDept/createdBy).
    const reviewPending = deptTasks.filter(t=>t.status==='review').length;
    const leavePending  = leaveSnap.docs.filter(d=>teamIds.has(d.data().userId)).length;
    const poPending     = poSnap.docs.filter(d=>{ const p=d.data(); return depts.includes(p.requestingDept) || teamIds.has(p.createdBy); }).length;
    const deptPending = subs.filter(s=>s.status==='pending' && (depts.includes(s.department)||teamIds.has(s.createdBy)||teamIds.has(s.uid))).length
      + (approvalsSnap.size||0) + (caSnap.size||0) + attExtPending + reviewPending + leavePending + poPending;

    // Today's attendance for the team (admin can read attendance/{uid}/records/{date})
    // Attendance status is derived via the shared window.attRecKind reader (config.js),
    // which DOES check a `status` key (present/half/absent/leave/unpaid-leave, plus
    // 'none' for no record yet) — kept consistent with every other attendance reader.
    const attStatus = (data) => {
      const kind = !data ? 'unmarked' : window.attRecKind(data);
      return kind === 'none' ? 'unmarked' : kind;
    };
    // Re-audit 2026-08-03: this ran N uncached Firestore reads (one per team
    // member) on EVERY render, unlike every other read on this dashboard —
    // for a larger team that's real read-quota cost and latency that scales
    // with headcount, for data that only changes a handful of times a day.
    // Cache keyed by dept+day so switching subtabs/re-rendering within the
    // same minute reuses the same batch instead of re-reading per employee.
    const att = await dbCachedGet('mgr-att-today:'+depts.join(',')+':'+todayStr, () => Promise.all(team.map(u =>
      db.collection('attendance').doc(u.id).collection('records').doc(todayStr).get()
        .then(d => ({ uid:u.id, name:u.displayName||u.email, status: attStatus(d.exists ? d.data() : null) }))
        .catch(() => ({ uid:u.id, name:u.displayName||u.email, status:'unmarked' })))), 60000);
    const present = att.filter(a=>a.status==='present').length;
    const half    = att.filter(a=>a.status==='half').length;
    const unmarked = att.filter(a=>a.status==='unmarked').length;

    const priorityOrder = { high:0, medium:1, low:2 };
    const sortedOpen = [...openT].sort((a,b)=>{
      const aO=a.dueDate&&a.dueDate<todayStr?0:1, bO=b.dueDate&&b.dueDate<todayStr?0:1;
      if(aO!==bO) return aO-bO;
      return (priorityOrder[a.priority]??2)-(priorityOrder[b.priority]??2);
    });
    const nameOf = uid => escHtml(users.find(u=>u.id===uid)?.displayName || '?');
    const assignedNames = t => { const ids=Array.isArray(t.assignedTo)?t.assignedTo:(t.assignedTo?[t.assignedTo]:[]); return ids.length?ids.map(nameOf).join(', '):'Unassigned'; };

    c.innerHTML = `
      <div class="page-header"><h2>Manager Dashboard</h2><span class="badge badge-purple">${escHtml(depts.join(' · ')||'Manager')}</span></div>
      <div id="live-clock" class="live-clock-line"></div>
      ${overdueT.length?`<div class="alert-banner alert-danger" onclick="navigateTo('tasks')"><span>${emojiIcon('⚠️',16)} <strong>${overdueT.length} overdue</strong> in your ${depts.length>1?'departments':'department'}</span><span class="alert-chevron">›</span></div>`:''}
      ${deptPending?`<div class="alert-banner alert-warn" onclick="navigateTo('approvals')"><span>${emojiIcon('📋',16)} <strong>${deptPending} pending</strong> approval${deptPending>1?'s':''} / request${deptPending>1?'s':''}</span><span class="alert-chevron">›</span></div>`:''}
      <div class="kpi-row">
        <div class="kpi-card"><div class="kpi-icon-wrap" style="background:var(--info-soft)"><i data-lucide="users" style="stroke:var(--info);width:18px"></i></div><div class="kpi-label">Team</div><div class="kpi-value">${team.length}</div></div>
        <div class="kpi-card green"><div class="kpi-icon-wrap" style="background:var(--success-soft)"><i data-lucide="user-check" style="stroke:var(--success);width:18px"></i></div><div class="kpi-label">Present today</div><div class="kpi-value">${present}</div><div class="kpi-sub">${half} half · ${unmarked} not in yet</div></div>
        <div class="kpi-card ${openT.length?'accent':''}"><div class="kpi-icon-wrap" style="background:var(--primary-soft)"><i data-lucide="check-square" style="stroke:var(--primary);width:18px"></i></div><div class="kpi-label">Open Tasks</div><div class="kpi-value">${openT.length}</div><div class="kpi-sub">${doneT.length} done</div></div>
        <div class="kpi-card ${overdueT.length?'red':''}"><div class="kpi-icon-wrap" style="background:var(--danger-soft)"><i data-lucide="alert-triangle" style="stroke:var(--danger);width:18px"></i></div><div class="kpi-label">Overdue</div><div class="kpi-value">${overdueT.length}</div></div>
      </div>
      <div class="dashboard-grid">
        <div class="card">
          <div class="card-header"><h3>Department Tasks</h3><button class="btn-primary btn-sm" onclick="navigateTo('tasks')">All Tasks</button></div>
          <div class="card-body" style="padding:0">
            ${!sortedOpen.length?`<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon('✅',44)}</div><p>No open tasks in your department</p></div>`:
              sortedOpen.slice(0,8).map(t=>{const ov=t.dueDate&&t.dueDate<todayStr;return `<div class="task-feed-item ${ov?'task-overdue':''}">
                <div class="task-feed-dot priority-dot-${t.priority||'medium'}"></div>
                <div style="flex:1;min-width:0"><div class="task-feed-title">${escHtml(t.title)}</div><div class="task-feed-meta">${assignedNames(t)}${t.dueDate?` · <span style="color:${ov?'var(--danger)':'var(--text-muted)'}">Due ${t.dueDate}</span>`:''}</div></div>
                <span class="badge ${ov?'badge-red':'badge-blue'}">${ov?'Overdue':t.status||'open'}</span>${(t.openFollowUpCount||0)>0?`<span class="badge badge-orange" style="margin-left:4px">${emojiIcon('📣',16)} ${t.openFollowUpCount}</span>`:''}</div>`;}).join('')}
          </div>
        </div>
        <div>
          <div class="card" style="margin-bottom:16px">
            <div class="card-header"><h3>${emojiIcon('👥',20)} Team Today</h3><button class="btn-primary btn-sm" onclick="navigateTo('attendance')">Attendance</button></div>
            <div class="card-body" style="padding:0">
              ${!team.length?'<div class="empty-state" style="padding:20px"><p>No team members assigned</p></div>':
                att.slice(0,12).map(a=>{
                  const dot = { present:'var(--success)', half:'var(--warning)', absent:'var(--danger)', leave:'var(--success)', 'unpaid-leave':'var(--text-muted)' }[a.status] || 'var(--text-muted)';
                  const cls = { present:'badge-green', half:'badge-orange', absent:'badge-red', leave:'badge-green', 'unpaid-leave':'badge-gray' }[a.status] || 'badge-gray';
                  const label = { present:'present', half:'half', absent:'absent', leave:`${emojiIcon('🌴',16)} leave`, 'unpaid-leave':`${emojiIcon('📅',16)} unpaid leave`, unmarked:'not in' }[a.status] || a.status;
                  return `<div style="display:flex;align-items:center;gap:10px;padding:8px 16px;border-bottom:1px solid var(--border)">
                  <span style="width:8px;height:8px;border-radius:50%;background:${dot}"></span>
                  <span style="flex:1;font-size:13px">${escHtml(a.name)}</span>
                  <span class="badge ${cls}" style="font-size:10px">${label}</span>
                </div>`;}).join('')}
            </div>
          </div>
          <div class="card"><div class="card-header"><h3>Quick Actions</h3></div>
            <div class="card-body" style="display:flex;flex-direction:column;gap:8px">
              <button class="quick-action-btn" onclick="navigateTo('tasks')"><i data-lucide="plus-circle"></i> New Task</button>
              <button class="quick-action-btn" onclick="navigateTo('approvals')"><i data-lucide="shield-check"></i> Approvals${deptPending?`<span class="badge badge-red" style="margin-left:auto">${deptPending}</span>`:''}</button>
              <button class="quick-action-btn" onclick="navigateTo('team-directory')"><i data-lucide="users"></i> Team Directory</button>
            </div>
          </div>
        </div>
      </div>`;
    liveDateTime('live-clock');
    if (window.lucide) lucide.createIcons({ nodes: [c] });
  } catch(err) {
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Dashboard error</h4><p style="font-size:12px;color:var(--text-muted)">${escHtml(err.message||'')}</p></div>`;
  }
}

// ── CORPORATE SECRETARY DASHBOARD ─────────────────
// Company-wide OVERSIGHT portal. The Corporate Secretary reviews everything across
// the company (manager-level access, but org-wide rather than dept-scoped). Authority
// is read/oversight only: the President approves every request, and deletions of key
// records route through the President. So this surfaces the full pending-approvals
// picture + governance shortcuts — and never any approve buttons.
async function renderSecretaryDashboard() {
  const c = document.getElementById('page-content');
  c.innerHTML = window.skeletonHtml('cards');
  try {
    const safeGet = async (q, label) => { try { return await q.get(); } catch(e) { _dashWarnOnce(label || 'query', e); return { docs:[], size:0 }; } };
    const todayStr = bizDate();
    const [usersSnap, tasksSnap, subsSnap, apprSnap, caSnap, extSnap, signupSnap, leaveSnap, finDelSnap, payDelSnap, reviewSnap, bsDelSnap, bkDelSnap, clientDelSnap, poSnap, raiseSnap] = await Promise.all([
      dbCachedGet('users',       () => db.collection('users').get(), 30000),
      dbCachedGet('tasks-all',   () => db.collection('tasks').get(), 30000),
      dbCachedGet('submissions', () => db.collection('submissions').get(), 30000),
      safeGet(db.collection('approval_requests').where('status','==','pending'), 'approval_requests'),
      safeGet(db.collection('cash_advances').where('status','==','pending'), 'cash_advances'),
      safeGet(db.collection('attendance_extensions').where('status','==','pending'), 'attendance_extensions'),
      safeGet(db.collection('signup_requests').where('status','==','pending'), 'signup_requests'),
      safeGet(db.collection('leave_requests').where('status','==','pending'), 'leave_requests'),
      safeGet(db.collection('finance_delete_requests').where('status','==','pending'), 'finance_delete_requests'),
      safeGet(db.collection('payroll_delete_requests').where('status','==','pending'), 'payroll_delete_requests'),
      safeGet(db.collection('tasks').where('status','==','review'), 'tasks'),
      // v14 fix — the remaining Approvals-page sources (approvals.js:149-154) the
      // Secretary's oversight badge/KPI/breakdown were missing.
      safeGet(db.collection('bs_quotes').where('deleteRequested','==',true), 'bs_quotes'),
      safeGet(db.collection('bk_quotes').where('deleteRequested','==',true), 'bk_quotes'),
      safeGet(db.collection('clients').where('deleteRequested','==',true), 'clients'),
      safeGet(db.collection('purchase_requisitions').where('approvalStatus','==','pending'), 'purchase_requisitions'),
      safeGet(db.collection('pending_raises').where('status','==','pending_approval'), 'pending_raises'),
    ]);
    const users = usersSnap.docs.map(d=>({id:d.id,...d.data()}));
    const allTasks = tasksSnap.docs.map(d=>({id:d.id,...d.data()}));
    const CLOSED = ['done','approved','archived'];
    const openT = allTasks.filter(t=>!CLOSED.includes(t.status));
    const overdueT = openT.filter(t=>t.dueDate && t.dueDate < todayStr);
    const pendingSubs = subsSnap.docs.filter(d=>d.data().status==='pending').length;
    // v14 fix — quote/client deletes fold into the existing "Deletion Requests"
    // bucket (same grouping the finance/payroll deletes already used); PO and
    // raises are distinct request types, tracked separately.
    const pendingDeletes = (finDelSnap.size||0) + (payDelSnap.size||0) + (bsDelSnap.size||0) + (bkDelSnap.size||0) + (clientDelSnap.size||0);
    const pendingPO = poSnap.size||0;
    const pendingRaises = raiseSnap.size||0;
    const totalPending = (apprSnap.size||0)+(caSnap.size||0)+(extSnap.size||0)+(signupSnap.size||0)+(leaveSnap.size||0)+(reviewSnap.size||0)+pendingSubs+pendingDeletes+pendingPO+pendingRaises;
    const activeStaff = users.filter(u=>u.role!=='partner').length;
    const rows = [
      ['Sign-ups', signupSnap.size||0, `${emojiIcon('👤',16)}`],
      ['Cash Advances', caSnap.size||0, `${emojiIcon('💸',16)}`],
      ['Leave Requests', leaveSnap.size||0, `${emojiIcon('🌴',16)}`],
      ['Attendance Extensions', extSnap.size||0, `${emojiIcon('⏰',16)}`],
      ['Work Submissions', pendingSubs, `${emojiIcon('📤',16)}`],
      ['Tasks for Review', reviewSnap.size||0, `${emojiIcon('📋',16)}`],
      ['Quote Approvals', apprSnap.size||0, `${emojiIcon('📝',16)}`],
      ['Purchase Requisitions', pendingPO, `${emojiIcon('🧾',16)}`],
      ['Raise Requests', pendingRaises, `${emojiIcon('📈',16)}`],
      ['Deletion Requests', pendingDeletes, `${emojiIcon('🗑',16)}`],
    ].filter(r=>r[1]>0);

    c.innerHTML = `
      <div class="page-header"><h2>${emojiIcon('🗂',20)} Corporate Secretary</h2><span class="badge badge-gold">Oversight</span></div>
      <div id="live-clock" class="live-clock-line"></div>
      <div class="alert-banner" style="cursor:default"><span>${emojiIcon('👁',16)} <strong>Oversight role.</strong> You can review everything across the company. The President approves all requests, and deletions of key records require President approval.</span></div>
      ${totalPending?`<div class="alert-banner alert-warn" onclick="navigateTo('approvals')"><span>${emojiIcon('📋',16)} <strong>${totalPending} request${totalPending>1?'s':''}</strong> awaiting the President's approval — review the queue</span><span class="alert-chevron">›</span></div>`:''}
      ${pendingDeletes?`<div class="alert-banner alert-danger" onclick="navigateTo('approvals')"><span>${emojiIcon('🗑',16)} <strong>${pendingDeletes} deletion request${pendingDeletes>1?'s':''}</strong> pending President approval</span><span class="alert-chevron">›</span></div>`:''}
      <div class="kpi-row">
        <div class="kpi-card"><div class="kpi-icon-wrap" style="background:var(--info-soft)"><i data-lucide="users" style="stroke:var(--info);width:18px"></i></div><div class="kpi-label">People</div><div class="kpi-value">${activeStaff}</div></div>
        <div class="kpi-card ${totalPending?'accent':''}" style="cursor:pointer" onclick="navigateTo('approvals')"><div class="kpi-icon-wrap" style="background:var(--warning-soft)"><i data-lucide="shield-check" style="stroke:var(--warning);width:18px"></i></div><div class="kpi-label">Pending Approvals</div><div class="kpi-value">${totalPending}</div></div>
        <div class="kpi-card ${openT.length?'accent':''}"><div class="kpi-icon-wrap" style="background:var(--primary-soft)"><i data-lucide="check-square" style="stroke:var(--primary);width:18px"></i></div><div class="kpi-label">Open Tasks</div><div class="kpi-value">${openT.length}</div></div>
        <div class="kpi-card ${overdueT.length?'red':''}"><div class="kpi-icon-wrap" style="background:var(--danger-soft)"><i data-lucide="alert-triangle" style="stroke:var(--danger);width:18px"></i></div><div class="kpi-label">Overdue</div><div class="kpi-value">${overdueT.length}</div></div>
      </div>
      <div class="dashboard-grid">
        <div class="card">
          <div class="card-header"><h3>Pending Approval Queue</h3><button class="btn-primary btn-sm" onclick="navigateTo('approvals')">Open Approvals</button></div>
          <div class="card-body" style="padding:0">
            ${!rows.length
              ? `<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon('✅',44)}</div><p>No pending requests — all clear.</p></div>`
              : rows.map(([label,n,ic])=>`<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border)"><span style="font-size:16px">${ic}</span><span style="flex:1;font-size:13px">${label}</span><span class="badge badge-orange">${n}</span></div>`).join('')}
          </div>
        </div>
        <div>
          <div class="card"><div class="card-header"><h3>Corporate Records & Governance</h3></div>
            <div class="card-body" style="display:flex;flex-direction:column;gap:8px">
              <button class="quick-action-btn" onclick="navigateTo('approvals')"><i data-lucide="shield-check"></i> Approvals (oversight)${totalPending?`<span class="badge badge-red" style="margin-left:auto">${totalPending}</span>`:''}</button>
              <button class="quick-action-btn" onclick="navigateTo('memos')"><i data-lucide="clipboard-check"></i> Memos & Resolutions</button>
              <button class="quick-action-btn" onclick="navigateTo('dept:Admin')"><i data-lucide="building-2"></i> Admin — Policies & HR Docs</button>
              <button class="quick-action-btn" onclick="navigateTo('team-directory')"><i data-lucide="users"></i> Team Directory</button>
              <button class="quick-action-btn" onclick="navigateTo('departments')"><i data-lucide="layout-grid"></i> Departments</button>
              <button class="quick-action-btn" onclick="navigateTo('attendance')"><i data-lucide="calendar"></i> Attendance</button>
              <button class="quick-action-btn" onclick="navigateTo('progress')"><i data-lucide="trending-up"></i> Progress Reports</button>
            </div>
          </div>
        </div>
      </div>`;
    liveDateTime('live-clock');
    if (window.lucide) lucide.createIcons({ nodes: [c] });
  } catch(err) {
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Dashboard error</h4><p style="font-size:12px;color:var(--text-muted)">${escHtml(err.message||'')}</p></div>`;
  }
}

// ── Finance period filter ─────────────────────────
// Superseded by window.Period / window.periodPicker / window.bindPeriodPicker
// in js/config.js (v12 WS12) — ONE shared engine for every money screen,
// supporting any month/quarter/year, not just month/prev/ytd/all. The
// finPeriodMatch/finPeriodLabel aliases there keep old callers working.

// ── FINANCE DASHBOARD ─────────────────────────────
// Money oversight: income/expense/net (selectable period), payroll, expense-by-category, pending payables.
async function renderFinanceDashboard() {
  const c = document.getElementById('page-content');
  c.innerHTML = window.skeletonHtml('cards');
  try {
    const safeGet = async (q, label) => { try { return await q.get(); } catch(e) { _dashWarnOnce(label || 'query', e); return { docs:[], size:0 }; } };
    const todayStr = bizDate();
    const period = window._FIN_DASH_PERIOD || 'month';
    const plabel = finPeriodLabel(period);
    const [usersSnap, ledgerSnap, prevLedSnap, expSnap, caSnap, invSnap, jobSnap, projList] = await Promise.all([
      dbCachedGet('users', fetchUsersWithPayroll, 30000),
      ledgerForPeriod(period),
      ledgerForPeriod('prev'),
      dbCachedGet('expenses-pending', () => safeGet(db.collection('expenses').where('status','==','pending'), 'expenses'),         45000),
      dbCachedGet('ca-pending',      () => safeGet(db.collection('cash_advances').where('status','==','pending'), 'cash_advances'),      30000),
      dbCachedGet('inventory_items', () => safeGet(db.collection('inventory_items'), 'inventory_items'),                                   45000),
      dbCachedGet('job_costs',       () => safeGet(db.collection('job_costs'), 'job_costs'),                                         45000),
      (window.Projects && window.Projects.listAll ? window.Projects.listAll() : Promise.resolve([])).catch(e => { _dashWarnOnce('projects', e); return []; }),
    ]);
    const users = usersSnap.docs.map(d=>({id:d.id,...d.data()}));
    const payrollGross = users.reduce((s,u)=>s+(u.salary||0)+(u.allowance||0),0);
    const payrollDeduct = users.reduce((s,u)=>s+(u.deductions||0),0);
    const payrollNet = payrollGross - payrollDeduct;

    const periodLedger = ledgerSnap.docs.map(d=>d.data());   // already period-bounded — no re-filter
    const mtdIncome  = periodLedger.filter(e=>ledgerKind(e)==='income').reduce((s,e)=>s+(e.amount||0),0);
    const mtdExpense = periodLedger.filter(e=>ledgerKind(e)==='expense').reduce((s,e)=>s+(e.amount||0),0);
    const mtdNet = mtdIncome - mtdExpense;
    // Previous calendar month net — for a month-over-month indicator on the net card.
    const _prevL = prevLedSnap.docs.map(d=>d.data());         // already prev-month-bounded
    const prevNet = _prevL.filter(e=>ledgerKind(e)==='income').reduce((s,e)=>s+(e.amount||0),0)
                  - _prevL.filter(e=>ledgerKind(e)==='expense').reduce((s,e)=>s+(e.amount||0),0);

    // ── Receivables aging (v12 WS40 decision 2 — ONE shared window.arAging() helper,
    // invoice-due-date anchor with project-age fallback; rewired here off the old
    // inline _daysSince bucket loop so Finance Dashboard and Analytics→Finance never
    // show a 4th independently-computed AR number) ──
    const _daysSince = ts => { try { const t = ts && ts.toDate ? ts.toDate() : (ts && ts.seconds ? new Date(ts.seconds*1000) : null); return t ? Math.floor((Date.now()-t.getTime())/86400000) : 0; } catch(_) { return 0; } };
    const openAR = (projList||[]).filter(p=>(p.arBalance||0)>0 && !['paid','cancelled','lost'].includes(String(p.stage||'').toLowerCase()));
    const aging = window.arAging(openAR);
    const arTotal = aging.total;
    // Per-client rollup for the collections drill-down (oldest first = chase first) —
    // unchanged: project-age based, a separate feature from the aging buckets above.
    const _arByClient = {};
    openAR.forEach(p=>{ const k=(String(p.clientName||'').trim())||'(no client)'; const g=_arByClient[k]||(_arByClient[k]={client:k,total:0,oldest:0,count:0}); g.total+=p.arBalance||0; const d=_daysSince(p.createdAt); if(d>g.oldest)g.oldest=d; g.count++; });
    const arClients = Object.values(_arByClient).sort((a,b)=>(b.oldest-a.oldest)||(b.total-a.total));
    // Dynamic "chase this bucket" copy (replaces the old hardcoded 90+ line) — same
    // logic as the Insights 'ar-largest' rule (config.js), inlined here since this
    // screen doesn't have the M metrics bag.
    const _arBuckets = [['d90','90+ days'],['d6190','61–90 days'],['d3160','31–60 days'],['cur','0–30 days']];
    const [_arTopKey, _arTopLabel] = _arBuckets.reduce((m,b)=> aging[b[0]] > aging[m[0]] ? b : m);

    const pendingExp = expSnap.docs.map(d=>({id:d.id,...d.data()}));   // already pending-bounded
    const pendingExpTotal = pendingExp.reduce((s,e)=>s+(e.amount||0),0);
    // Expense by category — from the LEDGER (single source of truth), so it always
    // reconciles with the Expense KPI above (payroll, COS, disbursements, approved expenses).
    const byCat = {};
    periodLedger.filter(e=>ledgerKind(e)==='expense').forEach(e=>{ const k=e.category||'Other'; byCat[k]=(byCat[k]||0)+(e.amount||0); });
    const catRows = Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
    const catMax = catRows.reduce((m,[,v])=>Math.max(m,v),0)||1;
    const monthExpTotal = catRows.reduce((s,[,v])=>s+v,0);

    const lowStock = invSnap.docs.map(d=>d.data()).filter(i=>(i.reorderLevel||0)>0 && (i.qty||0)<=(i.reorderLevel||0)).length;
    const jobs = jobSnap.docs.map(d=>d.data());
    const totalMargin = jobs.reduce((s,j)=>s+((j.revenue||0)-((j.materialsCost||0)+(j.laborCost||0)+(j.otherCost||0))),0);

    c.innerHTML = `
      <div class="page-header"><h2>Finance Dashboard</h2><span class="badge badge-green">${ROLES[currentRole]?.label||'Finance'}</span></div>
      <div id="live-clock" class="live-clock-line"></div>
      <div id="fin-dash-period">${window.periodPicker(period, {closedBadge:true})}</div>
      ${pendingExp.length?`<div class="alert-banner alert-warn" onclick="navigateTo('cash-advances')"><span>${emojiIcon('💸',16)} <strong>${pendingExp.length} expense${pendingExp.length>1?'s':''}</strong> awaiting approval · ₱${formatNum(pendingExpTotal)}</span><span class="alert-chevron">›</span></div>`:''}
      <div class="kpi-row">
        <div class="kpi-card green"><div class="kpi-icon-wrap" style="background:var(--success-soft)"><i data-lucide="trending-up" style="stroke:var(--success);width:18px"></i></div><div class="kpi-label">Income (${plabel})</div><div class="kpi-value" style="font-size:15px">₱${formatNum(mtdIncome)}</div></div>
        <div class="kpi-card red"><div class="kpi-icon-wrap" style="background:var(--danger-soft)"><i data-lucide="trending-down" style="stroke:var(--danger);width:18px"></i></div><div class="kpi-label">Expense (${plabel})</div><div class="kpi-value" style="font-size:15px">₱${formatNum(mtdExpense)}</div></div>
        <div class="kpi-card ${mtdNet>=0?'green':'red'}"><div class="kpi-icon-wrap" style="background:var(--success-soft)"><i data-lucide="line-chart" style="stroke:var(--success);width:18px"></i></div><div class="kpi-label">Net Income (${plabel})</div><div class="kpi-value" style="font-size:15px;color:${mtdNet>=0?'var(--success)':'var(--danger)'}">₱${formatNum(mtdNet)}</div>${period==='month'&&window.momDelta?`<div style="margin-top:2px">${window.momDelta(mtdNet, prevNet, true)}</div>`:''}</div>
        <div class="kpi-card warn"><div class="kpi-icon-wrap" style="background:var(--warning-soft)"><i data-lucide="banknote" style="stroke:var(--warning);width:18px"></i></div><div class="kpi-label">Payroll (run-rate)</div><div class="kpi-value" style="font-size:15px">₱${formatNum(payrollNet)}</div><div class="kpi-sub">${users.length} staff · already in Expense</div></div>
        <div class="kpi-card ${pendingExpTotal>0?'accent':''}" style="cursor:pointer" onclick="navigateTo('cash-advances')"><div class="kpi-icon-wrap" style="background:var(--primary-soft)"><i data-lucide="receipt" style="stroke:var(--primary);width:18px"></i></div><div class="kpi-label">Payables (pending)</div><div class="kpi-value" style="font-size:15px">₱${formatNum(pendingExpTotal)}</div></div>
        <div class="kpi-card ${lowStock>0?'red':''}" style="cursor:pointer" onclick="navigateTo('inventory')"><div class="kpi-icon-wrap" style="background:var(--danger-soft)"><i data-lucide="boxes" style="stroke:var(--danger);width:18px"></i></div><div class="kpi-label">Low Stock</div><div class="kpi-value">${lowStock}</div></div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h3>${emojiIcon('📥',20)} Receivables Aging <span style="font-size:11px;color:var(--text-muted);font-weight:400">· by invoice due date</span></h3><div style="display:flex;align-items:center;gap:8px"><span style="font-weight:800">₱${formatNum(arTotal)}</span>${arTotal>0?'<button class="btn-secondary btn-sm" id="ar-drill-btn">By client ›</button>':''}</div></div>
        <div class="card-body">
          ${arTotal===0?`<div class="empty-state" style="padding:16px"><p>No open receivables ${emojiIcon('🎉',16)}</p></div>`:`
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px">
            ${[['Current ≤30d',aging.cur,'var(--success)'],['31–60d',aging.d3160,'var(--warning)'],['61–90d',aging.d6190,'#FF9500'],['90+ d',aging.d90,'var(--danger)']].map(([lbl,val,col])=>`
              <div style="background:var(--surface2);border-radius:10px;padding:10px 12px">
                <div style="font-size:11px;color:var(--text-muted)">${lbl}</div>
                <div style="font-size:15px;font-weight:800;color:${col}">₱${formatNum(val)}</div>
                <div style="font-size:10px;color:var(--text-muted)">${arTotal?Math.round(val/arTotal*100):0}%</div>
              </div>`).join('')}
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:10px">${openAR.length} open project${openAR.length===1?'':'s'} with a balance. ${_arTopKey==='cur'?'Receivables are current.':`Chase the <strong style="color:var(--danger)">${_arTopLabel}</strong> bucket first (₱${formatNum(aging[_arTopKey])}).`}</div>`}
        </div>
      </div>
      <div class="dashboard-grid">
        <div class="card">
          <div class="card-header"><h3>Expenses by Category (${plabel})</h3><button class="btn-primary btn-sm" onclick="navigateTo('dept:Finance')">Finance</button></div>
          <div class="card-body">
            ${!catRows.length?`<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon('📊',44)}</div><p>No expenses recorded this month</p></div>`:
              catRows.map(([k,v])=>`<div style="margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span>${escHtml(k)}</span><span style="font-weight:700">₱${formatNum(v)}</span></div>
                <div style="height:8px;background:var(--surface2);border-radius:4px;overflow:hidden"><div style="height:100%;width:${Math.round(v/catMax*100)}%;background:var(--primary);border-radius:4px"></div></div>
              </div>`).join('')+`<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;border-top:1px solid var(--border);padding-top:8px;margin-top:8px"><span>Total</span><span>₱${formatNum(monthExpTotal)}</span></div>`}
          </div>
        </div>
        <div>
          <div class="card" style="margin-bottom:16px">
            <div class="card-header"><h3>${emojiIcon('💰',20)} Payroll Summary</h3><button class="btn-primary btn-sm" onclick="navigateTo('dept:Finance')">Payroll</button></div>
            <div class="card-body">
              <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:13px"><span>Gross (salary + allowance)</span><strong>₱${formatNum(payrollGross)}</strong></div>
              <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:13px;color:var(--text-muted)"><span>Deductions</span><span>− ₱${formatNum(payrollDeduct)}</span></div>
              <div style="display:flex;justify-content:space-between;padding:8px 0 2px;font-size:14px;font-weight:700;border-top:2px solid var(--border)"><span>Net Payroll</span><span>₱${formatNum(payrollNet)}</span></div>
            </div>
          </div>
          <div class="card"><div class="card-header"><h3>Quick Actions</h3></div>
            <div class="card-body" style="display:flex;flex-direction:column;gap:8px">
              <button class="quick-action-btn" onclick="navigateTo('cash-advances')"><i data-lucide="receipt"></i> Review Expenses${pendingExp.length?`<span class="badge badge-red" style="margin-left:auto">${pendingExp.length}</span>`:''}</button>
              <button class="quick-action-btn" onclick="navigateTo('dept:Finance')"><i data-lucide="calculator"></i> Accounting & Reports</button>
              <button class="quick-action-btn" onclick="navigateTo('inventory')"><i data-lucide="boxes"></i> Inventory & Job Costs</button>
            </div>
          </div>
        </div>
      </div>`;
    liveDateTime('live-clock');
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    window.bindPeriodPicker(document.getElementById('fin-dash-period'), (newKey) => {
      window._FIN_DASH_PERIOD = newKey; renderFinanceDashboard();
    }, { closedBadge:true, activeKey: period });
    // Receivables drill-down — clients sorted by oldest debt (chase the top first).
    document.getElementById('ar-drill-btn')?.addEventListener('click', () => {
      const ageCol = d => d>90?'var(--danger)':d>60?'#FF9500':d>30?'var(--warning)':'var(--text-muted)';
      const rows = arClients.map(g=>`<tr>
        <td data-label="Client" style="font-weight:600">${escHtml(g.client)}</td>
        <td data-label="Outstanding" style="text-align:right;font-weight:700">₱${formatNum(g.total)}</td>
        <td data-label="Oldest" style="text-align:center;color:${ageCol(g.oldest)};font-weight:600">${g.oldest}d</td>
        <td data-label="Projects" style="text-align:center">${g.count}</td>
      </tr>`).join('');
      openPage(`${emojiIcon('📥',16)} Receivables by Client`, `
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Open project balances, oldest first — chase the top of the list. Total <strong>₱${formatNum(arTotal)}</strong> across ${arClients.length} client${arClients.length===1?'':'s'}.</div>
        <div class="table-wrap" style="max-height:52vh;overflow:auto"><table class="data-table table-cards no-toggle">
          <thead><tr><th>Client</th><th style="text-align:right">Outstanding</th><th style="text-align:center">Oldest</th><th style="text-align:center">Projects</th></tr></thead>
          <tbody>${rows||'<tr><td colspan="4">No open receivables</td></tr>'}</tbody>
        </table></div>`,
        `<button class="btn-secondary" id="ar-csv-btn">${emojiIcon('⬇',16)} CSV</button><button class="btn-secondary" onclick="closeModal()">Close</button>`);
      document.getElementById('ar-csv-btn')?.addEventListener('click', ()=>window.exportCSV('receivables-by-client', arClients, [
        {key:'client',label:'Client'},{key:'total',label:'Outstanding',get:g=>g.total},{key:'oldest',label:'Oldest (days)',get:g=>g.oldest},{key:'count',label:'Open Projects',get:g=>g.count}]));
    });
  } catch(err) {
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Dashboard error</h4><p style="font-size:12px;color:var(--text-muted)">${escHtml(err.message||'')}</p></div>`;
  }
}

async function renderEmployeeDashboard() {
  const c = document.getElementById('page-content');
  c.innerHTML = window.skeletonHtml('rows');
  try {
    const now      = new Date();
    const todayStr = bizDate();
    const uid = currentUser.uid;
    const [myTasksSnap, attSnap, caSnap, extSnap, kpiProfile, monthAttScore] = await Promise.all([
      db.collection('tasks').where('assignedTo','array-contains', uid).get()
        .catch(()=>db.collection('tasks').where('assignedTo','==', uid).get()),
      db.collection('attendance').doc(uid).collection('records').doc(todayStr).get(),
      db.collection('cash_advances').where('userId','==', uid).get().catch(e => { _dashWarnOnce('cash_advances', e); return {docs:[]}; }),
      db.collection('attendance_extensions').doc(`${uid}_${todayStr}`).get().catch(e => { _dashWarnOnce('attendance_extensions', e); return {exists:false,data:()=>({})}; }),
      db.collection('kpi_targets').doc(uid).get().catch(e => { _dashWarnOnce('kpi_targets', e); return null; }),
      getAttendanceScore(uid)
    ]);

    const DONE_TASK_STATUSES = ['approved','archived','done'];
    const myTasks    = myTasksSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const openTasks  = myTasks.filter(t=>!DONE_TASK_STATUSES.includes(t.status));
    const doneTasks  = myTasks.filter(t=>DONE_TASK_STATUSES.includes(t.status));
    const overdue    = openTasks.filter(t=>t.dueDate && t.dueDate < todayStr);
    const u = userProfile;
    const net = (u.salary||0)+(u.allowance||0)-(u.deductions||0);

    // Holiday / Sunday check — anchored to Manila time
    const phHolidays = typeof getPHHolidays === 'function' ? getPHHolidays(bizYear()) : {};
    const todayHoliday = phHolidays[todayStr];
    const isSundayToday = bizDow() === 0;
    const isNoWorkDay = isSundayToday || !!todayHoliday;

    // Attendance — new model: 0 / 0.5 / 1.0
    const attData     = attSnap.exists ? attSnap.data() : {};
    const hasLogin    = !!attData.loginTime;
    const attScore    = window.attRecScore(attData);
    const hasFull     = attScore >= 1.0;
    const hasLogout   = !!attData.logoutTime;

    // Attendance window: 7:00–9:00 AM Manila time (or approved extension)
    const nowHour      = bizHour();
    const inWindow     = nowHour >= 7 && nowHour < 9;   // normal 2-hr window
    const beforeWindow = nowHour < 7;
    const extData      = extSnap.exists ? extSnap.data() : null;
    const _ext = window.attExtActive(extData, now);
    const extApproved = _ext.active;
    const extPending   = extData?.status === 'pending';
    const extDenied    = extData?.status === 'denied';
    const extExpired   = extData?.status === 'approved'
                           && (!extData?.expiresAt || now >= extData.expiresAt.toDate());
    const canTimeIn    = !hasLogin && (inWindow || extApproved);
    const extExpiresStr = extApproved
      ? _ext.expiresAt.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})
      : '';

    // KPI computation
    const taskScore = myTasks.length > 0 ? Math.round((doneTasks.length / myTasks.length) * 100) : 0;
    const kpiTarget  = kpiProfile?.exists ? kpiProfile.data() : {};
    const targetScore = kpiTarget.targetScore || 80;
    const kpiColor = taskScore >= targetScore ? 'var(--success)' : taskScore >= 60 ? 'var(--warning)' : 'var(--danger)';

    // Recent CA
    const recentCA = caSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{
      const ta = a.createdAt?.toMillis?.() || 0;
      const tb = b.createdAt?.toMillis?.() || 0;
      return tb - ta;
    });

    // Monthly attendance for Current Standing card (fetched in Promise.all above)
    // Manila calendar Y/M/D (device-local clock can be off-by-one near UTC midnight).
    const workDaysDash = countWorkDays(+todayStr.slice(0,4), +todayStr.slice(5,7)-1, +todayStr.slice(8,10));
    const attDaysFull = Math.round(monthAttScore * workDaysDash);
    const caBalance = recentCA.filter(a=>a.status==='approved'&&(a.balance||0)>0).reduce((s,a)=>s+(a.balance||0),0);

    const isLeaveToday       = attData.status === 'leave';
    const isUnpaidLeaveToday = attData.status === 'unpaid_leave';
    const attBadgeClass = isLeaveToday ? 'badge-green' : isUnpaidLeaveToday ? 'badge-gray' : isNoWorkDay ? 'badge-gray' : hasFull ? 'badge-green' : hasLogin ? 'badge-orange' : 'badge-gray';
    const attLabel      = isLeaveToday ? `${emojiIcon('🌴',16)} On Leave` : isUnpaidLeaveToday ? `${emojiIcon('📅',16)} Unpaid Leave` : isNoWorkDay ? (isSundayToday?'Sunday':'Holiday') : hasFull ? `100% Full ${emojiIcon('✅',16)}` : hasLogin ? `50% Timed In ${emojiIcon('🟡',16)}` : 'Not Timed In';

    // Dept quick tab buttons
    const deptTabsHTML = currentDepts.length ? `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><h3>My Departments</h3></div>
        <div class="card-body" style="display:flex;gap:10px;flex-wrap:wrap;padding-top:6px">
          ${currentDepts.map(dept => {
            const cfg = DEPARTMENTS[dept] || {};
            return `<button class="dept-quick-tab" onclick="navigateTo('dept:${dept}')">
              <span style="font-size:18px">${emojiIcon(cfg.lucideIcon||cfg.icon||'folder',18)}</span>
              <span>${dept}</span>
            </button>`;
          }).join('')}
        </div>
      </div>` : '';

    const taskOutcomeMet = myTasks.length > 0 && taskScore >= targetScore;

    c.innerHTML = `
      <div class="page-header">
        <h2>${emojiIcon('👋',20)} Hi, ${escHtml((u.displayName||'').split(' ')[0])}!</h2>
      </div>
      <div id="live-clock" class="live-clock-line"></div>

      ${overdue.length>0?`<div class="alert-banner alert-danger" onclick="navigateTo('tasks')"><span>${emojiIcon('⚠️',16)} <strong>${overdue.length} overdue task${overdue.length>1?'s':''}</strong></span><span class="alert-chevron">›</span></div>`:''}

      <!-- Departmental Tabs -->
      ${deptTabsHTML}

      <!-- KPI Stats Row -->
      <div class="kpi-row" style="margin-bottom:16px">
        <div class="kpi-card ${openTasks.length>0?'accent':''}">
          <div class="kpi-card-top"><div class="kpi-label">Open Tasks</div>${window.iconTile('check-square','var(--warning)',null,28)}</div>
          <div class="kpi-value">${openTasks.length}</div>
          <div class="kpi-sub">${doneTasks.length} done · ${overdue.length} overdue</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-card-top"><div class="kpi-label">Task KPI</div>${window.iconTile('target',kpiColor,null,28)}</div>
          <div class="kpi-value" style="color:${kpiColor}">${taskScore}%</div>
          <div class="kpi-sub">${taskOutcomeMet?`${emojiIcon('✅',16)} Target met`:`${emojiIcon('❌',16)} Below target`} (${targetScore}%)</div>
        </div>
        <div class="kpi-card green">
          <div class="kpi-card-top"><div class="kpi-label">Net Pay</div>${window.iconTile('wallet','var(--success)',null,28)}</div>
          <div class="kpi-value" style="font-size:15px">₱${formatNum(net)}</div>
          <div class="kpi-sub">Base ₱${formatNum(u.salary)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-card-top"><div class="kpi-label">Department</div>${window.iconTile('building-2','var(--primary)',null,28)}</div>
          <div class="kpi-value" style="font-size:11px;line-height:1.4">${currentDepts.join(', ')||'Unassigned'}</div>
        </div>
      </div>

      <!-- Current Standing Card -->
      <div class="card dash-hero-card" style="margin-bottom:16px">
        <div class="card-header">
          <h3>${emojiIcon('📊',20)} Current Standing — ${now.toLocaleDateString('en-PH',{month:'long',year:'numeric'})}</h3>
        </div>
        <div class="card-body" style="display:flex;gap:16px;flex-wrap:wrap;padding:12px 16px">
          <div style="flex:1;min-width:120px;text-align:center;padding:10px;background:rgba(48,209,88,0.08);border-radius:10px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:4px">Attendance</div>
            <div style="font-size:22px;font-weight:800;color:${monthAttScore>=0.9?'var(--success)':monthAttScore>=0.6?'var(--warning)':'var(--danger)'}">${Math.round(monthAttScore*100)}%</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">~${attDaysFull} / ${workDaysDash} days</div>
          </div>
          <div style="flex:1;min-width:120px;text-align:center;padding:10px;background:rgba(10,132,255,0.08);border-radius:10px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:4px">Task KPI</div>
            <div style="font-size:22px;font-weight:800;color:${kpiColor}">${taskScore}%</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${doneTasks.length}/${myTasks.length} tasks done</div>
          </div>
          <div style="flex:1;min-width:120px;text-align:center;padding:10px;background:rgba(255,100,0,0.08);border-radius:10px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:4px">CA Balance</div>
            <div style="font-size:22px;font-weight:800;color:${caBalance>0?'var(--danger)':'var(--success)'}">₱${formatNum(caBalance)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${caBalance>0?'Outstanding':'No balance'}</div>
          </div>
        </div>
      </div>

      <!-- Attendance Card -->
      <div class="card" style="margin-bottom:16px">
        <div class="card-header">
          <h3>Today's Attendance <span style="font-size:12px;font-weight:400;color:var(--text-muted)">${now.toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric'})}</span></h3>
          <span class="badge ${attBadgeClass}">${attLabel}</span>
        </div>
        <div class="card-body">
          ${isNoWorkDay ? `
            <div style="display:flex;align-items:center;gap:14px;padding:4px 0">
              <div style="font-size:32px">${isSundayToday?`${emojiIcon('😴',16)}`:`${emojiIcon('🎌',16)}`}</div>
              <div>
                <div style="font-size:14px;font-weight:700;color:var(--text)">${isSundayToday?'It\'s Sunday — rest day!':todayHoliday.name}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:3px">No attendance required today. Enjoy your ${isSundayToday?'day off':'holiday'}!</div>
              </div>
            </div>`
          : hasFull ? `
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:40px;height:40px;border-radius:50%;background:rgba(48,209,88,0.15);display:flex;align-items:center;justify-content:center;font-size:20px">${emojiIcon('✅',20)}</div>
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--success)">Full attendance — 100%</div>
                <div style="font-size:11px;color:var(--text-muted)">Timed in + all notifications checked ${emojiIcon('✓',16)}</div>
              </div>
            </div>
            ${(hasLogin && !hasLogout) ? `<button class="btn-secondary" id="time-out-btn" style="width:100%;margin-top:10px">
              <i data-lucide="log-out" style="width:14px;margin-right:6px"></i>Time Out</button>` : ''}
            ${hasLogout ? `<div style="font-size:11px;color:var(--text-muted);margin-top:8px">${emojiIcon('👋',11)} Timed out · ${(attData.hoursWorked||0).toFixed(1)}h logged</div>` : ''}`
          : hasLogin ? `
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
              <div style="width:40px;height:40px;border-radius:50%;background:rgba(255,159,10,0.15);display:flex;align-items:center;justify-content:center;font-size:20px">${emojiIcon('🟡',20)}</div>
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--warning)">50% — Timed In</div>
                <div style="font-size:11px;color:var(--text-muted)">${extApproved?'Check notifications before '+extExpiresStr+' → 100%':'Check all notifications before 9:00 AM → 100%'}</div>
              </div>
            </div>
            ${!hasFull?`<div style="background:var(--surface2);border-radius:10px;padding:12px;font-size:12px;color:var(--text-muted)">
              Tap the ${emojiIcon('🔔',16)} bell → check <em>every</em> notification before 9:00 AM${extApproved?' (before '+extExpiresStr+')':''} → 100%.
            </div>`:''}
            ${(hasLogin && !hasLogout) ? `<button class="btn-secondary" id="time-out-btn" style="width:100%;margin-top:10px">
              <i data-lucide="log-out" style="width:14px;margin-right:6px"></i>Time Out</button>` : ''}
            ${hasLogout ? `<div style="font-size:11px;color:var(--text-muted);margin-top:8px">${emojiIcon('👋',11)} Timed out · ${(attData.hoursWorked||0).toFixed(1)}h logged</div>` : ''}
          ` : canTimeIn ? `
            <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
              ${extApproved?`<span style="color:var(--warning)">${emojiIcon('⏰',16)} Extension approved — expires ${extExpiresStr}</span><br>`:''}
              <strong>Step 1:</strong> Time in (7–9 AM) = 50%.<br>
              <strong>Step 2:</strong> Check every notification before 9:00 AM = 100%.
            </p>
            <button class="btn-primary" id="check-in-btn" style="width:100%">
              <i data-lucide="log-in" style="width:14px;margin-right:6px"></i>Time In (Step 1)
            </button>`
          : beforeWindow ? `
            <div style="text-align:center;padding:10px 0;color:var(--text-muted);font-size:13px">
              <div style="font-size:24px;margin-bottom:6px">${emojiIcon('⏳',24)}</div>
              Time In window opens at <strong>7:00 AM</strong>
            </div>`
          : extPending ? `
            <div style="display:flex;align-items:center;gap:10px;padding:4px 0">
              <div style="font-size:24px">${emojiIcon('⏳',24)}</div>
              <div>
                <div style="font-size:13px;font-weight:600">Extension requested</div>
                <div style="font-size:11px;color:var(--text-muted)">Waiting for president to approve. Refresh to check status.</div>
              </div>
            </div>`
          : extDenied ? `
            <div style="display:flex;align-items:center;gap:10px;padding:4px 0">
              <div style="font-size:24px">${emojiIcon('❌',24)}</div>
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--danger)">Extension denied</div>
                <div style="font-size:11px;color:var(--text-muted)">Attendance marked absent for today.</div>
              </div>
            </div>`
          : extExpired ? `
            <div style="display:flex;align-items:center;gap:10px;padding:4px 0">
              <div style="font-size:24px">${emojiIcon('⌛',24)}</div>
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--text-muted)">Extension expired</div>
                <div style="font-size:11px;color:var(--text-muted)">The 6-hour window has closed.</div>
              </div>
            </div>`
          : `
            <div style="padding:4px 0">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
                <div style="font-size:24px">${emojiIcon('⚠️',24)}</div>
                <div>
                  <div style="font-size:13px;font-weight:600;color:var(--warning)">Time window missed</div>
                  <div style="font-size:11px;color:var(--text-muted)">Time In window was 7:00–9:00 AM. You can request an extension.</div>
                </div>
              </div>
              <button class="btn-secondary" id="req-ext-btn" style="width:100%">${emojiIcon('⏰',16)} Request Time Extension</button>
            </div>`}
        </div>
      </div>

      <!-- Management row: Tasks + KPI -->
      <div class="dashboard-grid">
        <div class="card">
          <div class="card-header">
            <h3>My Tasks</h3>
            <button class="btn-primary btn-sm" onclick="navigateTo('tasks')">View All</button>
          </div>
          <div class="card-body" style="padding:0">
            ${!myTasks.length
              ? `<div class="empty-state" style="padding:20px"><div class="empty-icon">${emojiIcon('✅',44)}</div><p>No tasks assigned yet</p></div>`
              : openTasks.slice(0,5).map(t=>{
                  const isOverdue = t.dueDate && t.dueDate < todayStr;
                  return `<div class="task-feed-item ${isOverdue?'task-overdue':''}">
                    <div class="task-feed-dot priority-dot-${t.priority||'medium'}"></div>
                    <div style="flex:1;min-width:0">
                      <div class="task-feed-title">${escHtml(t.title)}</div>
                      ${t.dueDate?`<div class="task-feed-meta" style="color:${isOverdue?'var(--danger)':'var(--text-muted)'}">Due ${t.dueDate}</div>`:''}
                    </div>
                    <span class="badge ${isOverdue?'badge-red':t.priority==='high'?'badge-red':'badge-blue'}">${isOverdue?'Overdue':t.priority||'open'}</span>
                    ${(t.openFollowUpCount||0)>0?`<span class="badge badge-orange" style="margin-left:4px">${emojiIcon('📣',16)} ${t.openFollowUpCount}</span>`:''}
                  </div>`;
                }).join('')}
          </div>
        </div>

        <div>
          <div class="card" style="margin-bottom:16px">
            <div class="card-header"><h3>KPI Summary</h3></div>
            <div class="card-body">
              <div style="margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:13px">
                  <span>Task Completion</span><strong style="color:${kpiColor}">${doneTasks.length}/${myTasks.length} (${taskScore}%)</strong>
                </div>
                <div class="kpi-bar-track"><div class="kpi-bar-fill" style="width:${taskScore}%;background:${kpiColor}"></div></div>
              </div>
              <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:8px">
                <span style="color:var(--text-muted)">Expected Outcome</span>
                <strong style="color:${taskOutcomeMet?'var(--success)':'var(--danger)'}">${taskOutcomeMet?`${emojiIcon('✅',16)} Met`:`${emojiIcon('❌',16)} Not Met`}</strong>
              </div>
              <button class="btn-secondary btn-sm" style="margin-top:12px;width:100%" onclick="navigateTo('personal-finance')">
                Full Payslip & KPI →
              </button>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><h3>${emojiIcon('📅',20)} Calendar</h3></div>
            <div class="card-body" id="mini-cal"></div>
          </div>
        </div>
      </div>
    `;

    liveDateTime('live-clock');
    renderMiniCal();
    if (window.lucide) lucide.createIcons({ nodes: [c] });

    // Attendance buttons — new model
    document.getElementById('check-in-btn')?.addEventListener('click', async () => {
      // Check if no new notifs today (or all already read) → auto 100%
      // Manila midnight (not UTC) so early-morning notifications are counted.
      const todayStart = new Date(todayStr + 'T00:00:00+08:00').getTime();
      let autoFull = false;
      try {
        const notifSnap = await db.collection('notifications').doc(currentUser.uid).collection('items')
          .where('createdAt', '>=', new firebase.firestore.Timestamp(Math.floor(todayStart/1000), 0)).get();
        const todayNotifs = notifSnap.docs.map(d => d.data());
        autoFull = todayNotifs.length === 0 || todayNotifs.every(n => n.read);
      } catch {}
      try {
        await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).set({
          loginTime: firebase.firestore.FieldValue.serverTimestamp(),
          uid: currentUser.uid, date: todayStr,
          attendanceScore: autoFull ? 1.0 : 0.5,
          fullTime: autoFull,
          autoFull
        }, { merge: true });
      } catch (err) {
        Notifs.showToast(err?.code === 'permission-denied'
          ? 'Time In was rejected — today\'s record is admin-managed or your account lacks permission. Ask an admin to record your attendance.'
          : 'Time In failed to save: ' + (err?.message || err), 'error');
        return;
      }
      // Toasts render via textContent — plain emoji only, never emojiIcon() HTML.
      Notifs.info(autoFull
        ? '✅ Full attendance (100%) — no unchecked notifications!'
        : '🟡 Timed in (50%). Open 🔔 and check off every notification before 9:00 AM for 100%.');
      renderEmployeeDashboard();
    });

    // Office self-service Time Out button
    document.getElementById('time-out-btn')?.addEventListener('click', async () => {
      const inTs = attData.loginTime?.toDate ? attData.loginTime.toDate() : null;
      const hrs  = inTs ? window.computeHoursBetween(inTs, new Date()) : 0;
      try {
        await db.collection('attendance').doc(currentUser.uid).collection('records').doc(todayStr).set({
          logoutTime: firebase.firestore.FieldValue.serverTimestamp(),
          hoursWorked: hrs
        }, { merge: true });
      } catch (err) {
        Notifs.showToast('Time Out failed to save: ' + (err?.message || err), 'error');
        return;
      }
      Notifs.info(`👋 Timed out — ${hrs.toFixed(1)}h logged.`);
      renderEmployeeDashboard();
    });

    // Request extension button
    document.getElementById('req-ext-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('req-ext-btn');
      btn.disabled = true; btn.textContent = 'Requesting…';
      try {
        await db.collection('attendance_extensions').doc(`${currentUser.uid}_${todayStr}`).set({
          uid:         currentUser.uid,
          userName:    userProfile.displayName || currentUser.email,
          date:        todayStr,
          status:      'pending',
          requestedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // Notify president
        await Notifs.sendToOwner({
          title: '⏰ Attendance Extension Requested',
          body:  `${userProfile.displayName||currentUser.email} missed the 7–9am window on ${todayStr} and is requesting an extension.`,
          icon:  '⏰', type: 'att_extension',
          link:  'attendance'
        });
        dbCacheInvalidate && dbCacheInvalidate('att-ext-pending');
        Notifs.success('Extension requested — waiting for president approval.');
        renderEmployeeDashboard();
      } catch(err) {
        btn.disabled = false; btn.textContent = '⏰ Request Time Extension';
        Notifs.showToast('Failed to submit request','error');
      }
    });

  } catch(err) {
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>${err.message}</h4></div>`;
  }
}

// ── SOPs (Firestore-backed, president-editable) ───
async function renderSOPs() {
  const DEFAULT_SOPS = [
    {
      title: '📅 Daily Attendance',
      icon: '📅',
      items: [
        'Time in by <strong>8:00 AM</strong> via the Operations App → Attendance tab.',
        'Tap <em>Time In</em>. The system records the exact Manila time.',
        'If arriving after 8:00 AM, the record is automatically flagged as <strong>Late</strong>.',
        'For absences: notify your Manager or President via Posts/Messages <em>before</em> 8:00 AM.',
        'Extension requests (remote work, off-site) must be submitted through the Attendance page.',
        'Time out is recorded automatically at end of shift or can be tapped manually.',
        'Attendance directly affects your monthly KPI score and payroll calculation.',
      ]
    },
    {
      title: '💰 Cash Advance (CA)',
      icon: '💰',
      items: [
        'Submit a CA request via <em>Personal Finance → Cash Advance</em>.',
        'Maximum CA is <strong>₱50,000</strong>. Requests above this are not accepted.',
        'All requests start as <em>Pending</em> and require Finance/President approval.',
        'Once approved, cash is released by the Finance team.',
        'Deductions begin on the next payroll (25th of the month).',
        '7 days before payday, you will receive a reminder to set your preferred deduction amount.',
        'Do not file a new CA while a previous balance remains unpaid without prior approval.',
      ]
    },
    {
      title: '📊 Monthly Self-Assessment',
      icon: '📊',
      items: [
        'Complete your self-assessment by the <strong>last working day of each month</strong>.',
        'Access via <em>Personal Finance → Self Evaluate</em>.',
        'Rate your performance honestly — this feeds the President\'s KPI review.',
        'Self-assessments that are not completed default to 0/5 for that month.',
        'You will receive a push notification reminder on the last day of the month and on the 1st.',
      ]
    },
    {
      title: '📄 Sales Quotations (BK / BS)',
      icon: '📄',
      items: [
        'All quotations must be created via the <strong>Quote Builder</strong> in the app — no free-hand quotes.',
        'Fill in client name, contact details, and all line items before submitting.',
        'Once complete, use <em>Submit for Approval</em> — do not share with clients before the President approves.',
        'The President reviews quotes and may return them for revision with notes.',
        'Approved quotes are marked <em>Filed</em> and may be shared as PDF with the client.',
        'Follow up with clients within <strong>2 business days</strong> of sharing the quote.',
        'Log all client decisions (accepted, declined, negotiating) in the Client Data tab.',
      ]
    },
    {
      title: '🤝 Partner Deal Process (50/50)',
      icon: '🤝',
      items: [
        'Partners (Brilliant Steel / external) bring in clients and co-manage projects.',
        'When a client prospect is identified, the partner creates a quote via Quote Builder and submits for approval.',
        'Once the client accepts and the project begins, the <strong>President registers the deal</strong> in the Partners → Deals tab.',
        'The deal records: client name, total contract value, and Barro Industries\' project cost.',
        'Gross Profit = Contract Value − Cost. <strong>Partner Share = 50% of Gross Profit.</strong>',
        'The partner can see their deal pipeline and earnings in their dashboard at any time.',
        'Payment is released by Finance when the project is marked <em>Completed</em> and approved by the President.',
        'Always agree on the project scope in writing (quote) before starting fabrication.',
      ]
    },
    {
      title: '📁 Files & Document Management',
      icon: '📁',
      items: [
        'All project files, proposals, and client documents are uploaded via <em>Files</em> in the app.',
        'Files are stored in Firebase Storage and mirrored to Google Drive nightly.',
        'Name files clearly: <strong>[Dept]-[ClientOrProject]-[Date]</strong> e.g. <em>Sales-GerrysBulacan-2026-06-17.pdf</em>.',
        'Do not share download links outside the app — use the app\'s built-in file sharing.',
        'Sensitive HR and Finance documents are restricted to Finance/President roles.',
        'Old or superseded files should be archived, not deleted.',
      ]
    },
    {
      title: '🔔 Notifications & Communication',
      icon: '🔔',
      items: [
        'Enable push notifications on your device for the app — critical for deadline alerts.',
        'For urgent matters, use the <em>Posts</em> tab for team-wide announcements.',
        'Task comments are the official record for task-related discussions — use them.',
        'Do not use personal messaging apps for work instructions that need a paper trail.',
        'The President may send a forced message to all users via the app for major announcements.',
      ]
    },
    {
      title: '🖥️ IT & System Access',
      icon: '🖥️',
      items: [
        'Report all IT issues via <em>IT Department → IT Tickets</em>.',
        'Do not share your login credentials with anyone — each account is personal.',
        'If you believe your account was accessed without permission, notify IT immediately.',
        'Company devices used for work must be logged in to the Operations App.',
        'Software installation on company assets requires IT approval first.',
        'App sessions auto-logout after 10 days of inactivity — this is by design for security.',
      ]
    },
    {
      title: '✅ Tasks & Work Plans',
      icon: '✅',
      items: [
        'All assigned tasks appear in <em>My Tasks</em>. Check daily.',
        'Update task status as work progresses: <em>In Progress → Submitted for Review → Done</em>.',
        'If a task is blocked, set it to <em>On Hold</em> and add a comment explaining why.',
        'Overdue tasks are flagged automatically — address or escalate immediately.',
        'Do not close a task without confirming completion with the assigning manager.',
        'Proposals and work submissions go through the <em>Submissions</em> tab for approval.',
      ]
    },
    {
      title: '🏛️ Government Biddings',
      icon: '🏛️',
      items: [
        'All PhilGEPS bid opportunities are logged in <em>Government Biddings → PhilGEPS</em>.',
        'Active bids must have complete documentation uploaded before the bid deadline.',
        'Track bid status: Open → Submitted → Awarded/Failed.',
        'Post-bid evaluation notes must be filed in the Archive tab win or lose.',
        'All bidding documents require President approval before submission.',
      ]
    },
  ];

  const c = document.getElementById('page-content');
  c.innerHTML = window.skeletonHtml('rows');
  const canEditSOPs = isPresident() || currentRole === 'manager';

  // SOPs live in Firestore so the president can edit them in-app without a code
  // push. Seed the built-in defaults the first time an admin opens the page.
  let snap = await db.collection('sops').orderBy('order').get().catch(()=>({docs:[],empty:true}));
  if (snap.empty && canEditSOPs) {
    try {
      const batch = db.batch();
      DEFAULT_SOPS.forEach((s,i)=> batch.set(db.collection('sops').doc(), { title:s.title, items:s.items, order:i }));
      await batch.commit();
      snap = await db.collection('sops').orderBy('order').get();
    } catch(e) { /* seed failed → fall back to in-code defaults below */ }
  }
  const sops = (snap.docs && snap.docs.length)
    ? snap.docs.map(d=>({id:d.id, ...d.data()}))
    : DEFAULT_SOPS.map((s,i)=>({id:null, order:i, ...s}));

  c.innerHTML = `
    <div class="page-header">
      <h2>${emojiIcon('📋',20)} Standard Operating Procedures</h2>
      <p style="font-size:13px;color:var(--text-muted);margin-top:4px">Barro Industries — Official SOPs for all staff and partners</p>
      ${canEditSOPs?`<button class="btn-primary btn-sm" id="sop-add-btn" style="margin-top:10px">＋ Add SOP</button>`:''}
    </div>
    <div id="sop-list" style="display:flex;flex-direction:column;gap:8px">
      ${sops.map((s,i)=>`
        <div class="card sop-card" style="overflow:hidden">
          <div class="sop-header" style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;cursor:pointer;user-select:none" data-sop-idx="${i}">
            <div style="font-size:15px;font-weight:700">${s.title}</div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
              ${canEditSOPs&&s.id?`<button class="sop-edit-btn btn-secondary btn-sm" data-sop-id="${s.id}" onclick="event.stopPropagation()" title="Edit">${emojiIcon('✎',16)}</button>`:''}
              <span class="sop-chevron" style="font-size:18px;transition:transform .2s">›</span>
            </div>
          </div>
          <div class="sop-body" style="display:none;padding:0 16px 16px 16px">
            <ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:7px">
              ${(s.items||[]).map(item=>`<li style="font-size:13px;line-height:1.6;color:var(--text-primary)">${item}</li>`).join('')}
            </ol>
          </div>
        </div>`).join('')}
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  // Accordion toggle
  c.querySelectorAll('.sop-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const body    = hdr.nextElementSibling;
      const chevron = hdr.querySelector('.sop-chevron');
      const isOpen  = body.style.display !== 'none';
      body.style.display    = isOpen ? 'none'  : 'block';
      chevron.style.transform = isOpen ? ''     : 'rotate(90deg)';
    });
  });
  // President / manager: edit or add SOPs
  if (canEditSOPs) {
    c.querySelectorAll('.sop-edit-btn').forEach(btn =>
      btn.addEventListener('click', () => openSOPEditor(btn.dataset.sopId, sops.find(s=>s.id===btn.dataset.sopId))));
    document.getElementById('sop-add-btn')?.addEventListener('click', () =>
      openSOPEditor(null, { title:'', items:[], order:sops.length }));
  }
}

// President/manager SOP editor. Items are stored as an array of strings; basic
// inline HTML (<strong>/<em>) is allowed since only admins can write (matches
// the original built-in SOPs). The textarea round-trips raw HTML safely.
function openSOPEditor(id, sop) {
  sop = sop || { title:'', items:[], order:0 };
  openPage(id ? 'Edit SOP' : 'Add SOP', `
    <div class="form-group"><label>Title (include an emoji, e.g. ${emojiIcon('📅',16)} Daily Attendance)</label>
      <input id="sop-e-title" value="${escHtml(sop.title||'')}" placeholder="📋 Procedure name"/></div>
    <div class="form-group"><label>Steps — one per line (you can use &lt;strong&gt; and &lt;em&gt;)</label>
      <textarea id="sop-e-items" rows="10" style="font-family:inherit">${(sop.items||[]).map(escHtml).join('\n')}</textarea></div>
    <div id="sop-e-err" class="error-msg hidden" style="margin-top:6px"></div>
  `, `<button class="btn-primary" id="sop-e-save">Save</button>${id?'<button class="btn-danger" id="sop-e-del">Delete</button>':''}<button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  document.getElementById('sop-e-save').addEventListener('click', async () => {
    const title = document.getElementById('sop-e-title').value.trim();
    const items = document.getElementById('sop-e-items').value.split('\n').map(x=>x.trim()).filter(Boolean);
    const err = document.getElementById('sop-e-err');
    if (!title || !items.length) { err.textContent='Title and at least one step are required.'; err.classList.remove('hidden'); return; }
    const data = { title, items, order: sop.order ?? 0 };
    try {
      if (id) await db.collection('sops').doc(id).update(data);
      else    await db.collection('sops').add(data);
      closeModal(); renderSOPs();
    } catch(e) { err.textContent = 'Save failed: '+(e.message||e.code); err.classList.remove('hidden'); }
  });
  document.getElementById('sop-e-del')?.addEventListener('click', async () => {
    if (!await confirmDialog({ message: 'Delete this SOP permanently?', danger: true })) return;
    try { await db.collection('sops').doc(id).delete(); closeModal(); renderSOPs(); }
    catch(e) { Notifs.showToast('Delete failed','error'); }
  });
}

// ── Personal Finance ──────────────────────────────
window.renderPersonalFinance = async function(currentUser, currentRole, opts) {
  opts = opts || {};                                   // { host?: Element, selfOnly?: bool }
  const c = opts.host || document.getElementById('page-content');
  const pres = (isPresident() || currentRole === 'manager') && !opts.selfOnly;

  if (pres) {
    // President sees all employees' finance
    c.innerHTML = `
      <div class="page-header"><h2>${emojiIcon('💳',20)} Personal Finance — Team</h2></div>
      <div id="pf-content">${window.skeletonHtml('rows')}</div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    // Fetch users, all tasks, kpi_evals, and kpi_targets in parallel — single round trip
    // instead of up to 3 queries per user (N+1 fix).
    const [snap, tasksAllSnap, evalsSnap, kpiTargetsSnap] = await Promise.all([
      dbCachedGet('users',       () => db.collection('users').get(),        30000),
      dbCachedGet('tasks-all',   () => db.collection('tasks').get(),        30000),
      dbCachedGet('kpi-evals',   () => db.collection('kpi_evals').get(),    60000),
      dbCachedGet('kpi-targets', () => db.collection('kpi_targets').get(),  60000),
    ]);
    const users = snap.docs.map(d=>({id:d.id,...d.data()}));
    // Build lookup maps from the bulk fetches
    const allTasks      = tasksAllSnap.docs.map(d=>({id:d.id,...d.data()}));
    const evalsMap      = Object.fromEntries(evalsSnap.docs.map(d=>[d.id, d.data()]));
    const kpiTargetsMap = Object.fromEntries(kpiTargetsSnap.docs.map(d=>[d.id, d.data()]));
    const DONE_ST = ['done','approved','archived'];
    // Manila business-calendar period (avoid device-local off-by-one in payroll).
    const _bz2 = bizDate();
    const bz2Y = +_bz2.slice(0,4), bz2M = +_bz2.slice(5,7)-1, bz2D = +_bz2.slice(8,10);
    const daysElapsed2 = countWorkDays(bz2Y, bz2M, bz2D);
    const daysInMonth2 = countWorkDays(bz2Y, bz2M,
                           new Date(bz2Y, bz2M+1, 0).getDate());
    const defaultMonth2 = _bz2.slice(0,7);
    const userRows = await Promise.all(users.map(async u => {
      const net = (u.salary||0)+(u.allowance||0)-(u.deductions||0);
      // KPI score — computed from bulk-fetched data, no extra Firestore reads
      const userTasks   = allTasks.filter(t =>
        (Array.isArray(t.assignedTo) ? t.assignedTo.includes(u.id) : t.assignedTo === u.id)
      );
      const tasksDone   = userTasks.filter(t=>DONE_ST.includes(t.status)).length;
      const tasksTotal  = userTasks.length;
      const taskScore   = tasksTotal ? Math.min(1, tasksDone / tasksTotal) : 0.5;
      const kpiTargetD  = kpiTargetsMap[u.id] || {};
      const delivScore  = typeof kpiTargetD.deliverableScore === 'number'
        ? Math.min(1, kpiTargetD.deliverableScore / 100) : 0.5;
      const kpi = taskScore * 0.7 + delivScore * 0.3;
      // Attendance score still requires a per-user subcollection read
      const att = await getAttendanceScore(u.id);
      const mult = kpi*0.7 + att*0.3;
      const computed = net * mult * (daysElapsed2 / daysInMonth2);
      const depts = (Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(', ')||'—';
      // Eval — from the already-fetched bulk snapshot (no extra reads)
      const evalD = evalsMap[u.id] || {};
      const selfDone2 = evalD.selfAssessMonth === defaultMonth2;
      return { uid:u.id, name:u.displayName||u.email, depts, net, kpi, att, computed, tasksDone, tasksTotal, evalD, selfDone: selfDone2, row: `<tr class="pf-perf-row">
        <td class="tc-name">${escHtml(u.displayName||u.email)} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
        <td class="tc-detail" data-label="Dept">${escHtml(depts)}</td>
        <td class="tc-detail" data-label="Net Pay">₱${formatNum(net)}</td>
        <td class="tc-detail" data-label="Task KPI">${Math.round(kpi*100)}%<br><span style="font-size:10px;color:var(--text-muted)">${tasksDone}/${tasksTotal} tasks</span></td>
        <td class="tc-detail" data-label="Attendance">${Math.round(att*100)}%</td>
        <td class="tc-net"><strong style="color:var(--primary-light)">₱${formatNum(computed)}</strong><br><span style="font-size:10px;color:var(--text-muted)">${daysElapsed2}/${daysInMonth2} days</span></td>
        <td class="tc-detail" data-label="Self /10" style="text-align:center">
          ${selfDone2
            ? `<span style="font-weight:700">${evalD.selfGrade!=null?evalD.selfGrade+'<small>/10</small>':`${emojiIcon('✅',16)}`}</span>
               ${evalD.selfNotes?`<div style="font-size:10px;color:var(--text-muted);max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(evalD.selfNotes)}</div>`:''}`
            : `<span style="color:var(--danger);font-size:11px;font-weight:700">${emojiIcon('⚠️',11)} Pending</span>`
          }
        </td>
        <td class="tc-detail" data-label="Pres /10" style="text-align:center">
          <span style="font-weight:700;color:var(--success)">${evalD.presidentGrade!=null?evalD.presidentGrade+'<small>/10</small>':evalD.presidentGradeFromTasks!=null?evalD.presidentGradeFromTasks+`<small>/10 ${emojiIcon('🔒',16)}</small>`:'—'}</span>
        </td>
        <td class="tc-actions" style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn-secondary btn-sm view-profile-btn" data-uid="${u.id}" data-name="${(u.displayName||u.email).replace(/"/g,'&quot;')}" data-salary="${u.salary||0}" data-allowance="${u.allowance||0}" data-deductions="${u.deductions||0}" data-mdone="${tasksDone}" data-mtotal="${tasksTotal}">Profile</button>
          <button class="btn-secondary btn-sm grade-emp-btn" data-uid="${u.id}" data-name="${escHtml(u.displayName||u.email)}" data-presgrade="${evalD.presidentGrade||''}" data-presnotes="${escHtml(evalD.presidentNotes||'')}" data-presimprove="${escHtml(evalD.presidentImprovements||'')}">Grade</button>
        </td>
      </tr>` };
    }));
    const defaultMonth = defaultMonth2;
    const monthLabel = new Date(bz2Y, bz2M, 1).toLocaleString('en-PH',{month:'long',year:'numeric'});
    document.getElementById('pf-content').innerHTML = `
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><h3>Payroll — ${monthLabel}</h3></div>
        <div id="pf-payrun-summary" style="padding:14px 16px">${window.skeletonHtml('cards')}</div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-header"><h3>Performance &amp; Attendance — ${monthLabel}</h3></div>
        <div style="font-size:12px;color:var(--text-muted);padding:8px 16px">Task KPI and attendance — a performance reference, not the pay computation. Actual pay runs through Finance → Payroll.</div>
        <div class="table-wrap">
          <table class="data-table table-cards">
            <thead><tr><th>Employee</th><th>Dept</th><th>Net Pay</th><th>Task KPI</th><th>Attendance</th><th>Earned So Far</th><th>Self /10</th><th>Pres /10</th><th></th></tr></thead>
            <tbody>${userRows.map(r=>r.row).join('')}</tbody>
          </table>
        </div>
      </div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [document.getElementById('pf-content')] });
    document.querySelectorAll('#pf-content tr.pf-perf-row').forEach(tr => {
      tr.addEventListener('click', (ev) => {
        if (ev.target.closest('button, a')) return;
        tr.classList.toggle('tc-expanded');
      });
    });
    // v12 WS20 D1 — Path B's own payroll-writing engine is gone; this is now a
    // READ-ONLY summary of the real pay_runs/{month} doc, linking to the one
    // payroll engine (departments.js renderPayrollManagement).
    (async () => {
      const wrap = document.getElementById('pf-payrun-summary');
      if (!wrap) return;
      const doc = await db.collection('pay_runs').doc(defaultMonth).get().catch(()=>null);
      const data = (doc && doc.exists) ? doc.data() : {};
      const state = data.state || 'draft';
      const stateLabel = { draft:'Not started', computed:'Computed', verified:'Verified', disbursed:'Disbursed' }[state] || 'Not started';
      const badgeClass = state==='disbursed' ? 'badge-green' : (state==='verified'||state==='computed') ? 'badge-blue' : 'badge-gray';
      wrap.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <span class="badge ${badgeClass}">${stateLabel}</span>
            ${data.totalNet!=null?`<span style="font-size:13px;color:var(--text-muted);margin-left:8px">₱${formatNum(data.totalNet)} · ${data.employeeCount||0} staff</span>`:''}
          </div>
          <button class="btn-primary btn-sm" id="pf-open-payroll-btn">Open Payroll →</button>
        </div>`;
      document.getElementById('pf-open-payroll-btn')?.addEventListener('click', () => window.renderFinance(currentUser, currentRole, 'Payroll'));
    })();
    // Grade buttons
    document.querySelectorAll('.grade-emp-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const { uid, name, presgrade, presnotes, presimprove } = btn.dataset;
        openPage(`Grade: ${name}`, `
          <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">Assign a performance grade for ${escHtml(name)} (1 = poor, 10 = outstanding). Improvement areas are visible to the employee.</p>
          <div class="form-group"><label>President Grade (1–10)</label>
            <input id="pres-grade-input" type="number" inputmode="numeric" min="1" max="10" step="1" value="${presgrade||''}" placeholder="e.g. 8"/>
          </div>
          <div class="form-group"><label>General Notes (internal only)</label>
            <textarea id="pres-grade-notes" rows="2" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);resize:vertical" placeholder="Internal remarks…">${escHtml(presnotes||'')}</textarea>
          </div>
          <div class="form-group">
            <label>${emojiIcon('📝',16)} Development Areas <span style="font-size:11px;color:var(--primary-light)">(shown to employee)</span></label>
            <textarea id="pres-improve-input" rows="3" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:2px solid var(--primary-light);border-radius:8px;background:var(--surface);color:var(--text);resize:vertical" placeholder="What should this employee focus on improving? They will see this.">${escHtml(presimprove||'')}</textarea>
          </div>
        `, `<button class="btn-primary" id="save-pres-grade-btn">Save Grade</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
        document.getElementById('save-pres-grade-btn')?.addEventListener('click', async () => {
          const grade   = parseInt(document.getElementById('pres-grade-input').value);
          const notes   = document.getElementById('pres-grade-notes').value.trim();
          const improve = document.getElementById('pres-improve-input').value.trim();
          if (!grade || grade < 1 || grade > 10) { Notifs.showToast('Enter 1–10.','error'); return; }
          await db.collection('kpi_evals').doc(uid).set({
            presidentGrade: grade, presidentNotes: notes,
            presidentImprovements: improve,
            presidentId: currentUser.uid,
            presidentUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          // Notify employee
          const notifBody = improve
            ? `The president graded your performance: ${grade}/10. Check your Personal Finance page for development areas.`
            : `The president graded your performance: ${grade}/10.`;
          await Notifs.send(uid, { title:'📊 KPI Grade Updated', body: notifBody, icon:'📊', type:'kpi_grade' });
          closeModal(); Notifs.success(`Grade ${grade}/10 saved for ${name}.`);
          window.renderPersonalFinance(currentUser, currentRole, opts);
        });
      });
    });
    // Profile buttons
    document.querySelectorAll('.view-profile-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const { uid, name, salary, allowance, deductions, mdone, mtotal } = btn.dataset;
        openWorkerProfilePanel(uid, name, {
          salary: +salary, allowance: +allowance, deductions: +deductions,
          mDone: +mdone, mTotal: +mtotal
        });
      });
    });
    // Path B's own payroll-writing engine (Record Payroll) is retired — v12
    // WS20 D1. Payroll now runs exclusively through the one engine in
    // departments.js (Finance → Payroll), linked from the summary card above.
    return;
  }

  // Employee sees their own
  const u = userProfile;
  const net = (u.salary||0)+(u.allowance||0)-(u.deductions||0);
  // Manila business-calendar Y/M/D — pay-period & day logic must NOT use the
  // device-local clock (off-by-one near the UTC midnight boundary corrupts payroll).
  const _bz = bizDate();                       // "YYYY-MM-DD" Manila
  const bzYear  = parseInt(_bz.slice(0,4), 10);
  const bzMonth = parseInt(_bz.slice(5,7), 10) - 1; // 0-indexed to match Date semantics
  const bzDay   = parseInt(_bz.slice(8,10), 10);
  const daysElapsed  = countWorkDays(bzYear, bzMonth, bzDay);
  const daysInMonth  = countWorkDays(bzYear, bzMonth,
                         new Date(bzYear, bzMonth+1, 0).getDate());

  // kpi_targets is fetched here (alongside everything else) instead of letting
  // getKpiScore() re-query it internally, and myTasksSnap below is passed into
  // getKpiScore as preTasks so it skips its own internal tasks query — this
  // screen already fetches the identical assignedTo-array-contains query for
  // its own task list rendering, so without this the same query ran twice
  // per page view. Numbers produced are unchanged (same math, same inputs).
  const [att, cashAdvSnap, salaryHistSnap, evalSnap, myTasksSnap, kpiTargetSnap] = await Promise.all([
    getAttendanceScore(currentUser.uid),
    db.collection('cash_advances').where('userId','==',currentUser.uid).get().catch(()=>({docs:[]})),
    db.collection('salary_history').where('userId','==',currentUser.uid).orderBy('month','desc').limit(12).get().catch(()=>({docs:[]})),
    db.collection('kpi_evals').doc(currentUser.uid).get().catch(()=>null),
    db.collection('tasks').where('assignedTo','array-contains',currentUser.uid).get()
      .catch(()=>db.collection('tasks').where('assignedTo','==',currentUser.uid).get()).catch(()=>({docs:[]})),
    db.collection('kpi_targets').doc(currentUser.uid).get().catch(()=>null)
  ]);
  const kpi = await getKpiScore(currentUser.uid, myTasksSnap.docs.map(d=>d.data()), kpiTargetSnap);

  const cashAdvances  = cashAdvSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{
    const ta = a.createdAt?.toMillis?.() || 0;
    const tb = b.createdAt?.toMillis?.() || 0;
    return tb - ta;
  });
  const salaryHistory = salaryHistSnap.docs.map(d=>({id:d.id,...d.data()}));
  const totalAdvance  = cashAdvances.filter(a=>a.status==='approved'&&(a.balance||0)>0).reduce((s,a)=>s+(a.balance||0),0);

  // v12 WS23 — applied raises only (salary_raises is written only at materialize,
  // so it's inherently safe for an employee to see — no still-pending/scheduled
  // raise ever appears here).
  const _raiseSnap = await db.collection('salary_raises').where('subjectId','==',currentUser.uid).limit(50).get().catch(()=>({docs:[]}));
  const myRaises = _raiseSnap.docs.map(d=>d.data()).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));

  const evalData       = evalSnap?.exists ? evalSnap.data() : {};
  const selfGrade      = evalData.selfGrade ?? null;
  // presidentGrade: manual override first, then auto-averaged from task scores
  // Employees see only the averaged grade (presidentGradeFromTasks), and only on the 1st of the month
  const isFirstOfMonth = bzDay === 1;
  const presGrade      = isFirstOfMonth ? (evalData.presidentGradeFromTasks ?? null) : null;
  const selfNotes      = evalData.selfNotes || '';
  const presidentImprovements = evalData.presidentImprovements || '';
  const currentMonth   = _bz.slice(0,7);
  const selfAssessMonth = evalData.selfAssessMonth || null;
  const selfDoneThisMonth = selfAssessMonth === currentMonth;
  const isPayrollWindow = bzDay <= 7;

  const DONE_TASK_STATUSES_PR = ['done','approved','archived'];
  const myTasks  = myTasksSnap.docs.map(d=>d.data());
  const doneTasks= myTasks.filter(t=>DONE_TASK_STATUSES_PR.includes(t.status));
  const taskPct  = myTasks.length ? Math.round(doneTasks.length/myTasks.length*100) : 0;
  const kpiProfile = await db.collection('kpi_targets').doc(currentUser.uid).get().catch(()=>null);
  const targetScore   = kpiProfile?.exists ? (kpiProfile.data().targetScore||80) : 80;
  const outcomeMet    = taskPct >= targetScore;

  // Computed earnings — v12 WS20 D8: the SAME pure computePayLine the real
  // engine uses (one source of math for computation AND preview). Employees
  // can't read pay_runs (finance-only rule) to check disburse state directly,
  // but salary_history is now written ONLY at Disburse — so a matching-month
  // mirror existing IS the disbursed signal. When it exists, every figure
  // below shows the FROZEN line, not a live re-projection.
  const frozenThisMonth = salaryHistory.find(h => h.month === currentMonth);
  const isFinalMonth    = !!frozenThisMonth;
  const dispKpi = isFinalMonth ? (frozenThisMonth.kpiScore ?? kpi) : kpi;
  const dispAtt = isFinalMonth ? (frozenThisMonth.attScore ?? att) : att;
  const multiplier = isFinalMonth ? (frozenThisMonth.perfFactor ?? (dispKpi*0.7+dispAtt*0.3)) : (kpi*0.7+att*0.3);
  const projLine = (!isFinalMonth && window.computePayLine)
    ? window.computePayLine({ ...u, id: currentUser.uid }, { month: currentMonth, policy: 'flat', kpiScore: kpi, attScore: att, caPlan: [], caBalance: totalAdvance })
    : null;
  // netBeforeCA / netPay — pre-CA, so the existing "Cash Advance Balance" line
  // further down isn't double-subtracted.
  const computedMonth = isFinalMonth ? (frozenThisMonth.netPay ?? frozenThisMonth.finalPay ?? 0) : (projLine ? projLine.netBeforeCA : net*multiplier);
  const earnedSoFar   = isFinalMonth ? computedMonth : computedMonth * (daysElapsed / daysInMonth); // a disbursed month is fully earned, no proration

  // YTD = completed months from salary history + current month earned so far
  const thisYear  = String(bzYear);
  const ytdHistory= salaryHistory.filter(h=>h.month?.startsWith(thisYear));
  const ytdPay    = ytdHistory.reduce((s,h)=>s+(h.finalPay||h.netPay||0),0) + earnedSoFar;

  const monthLabel = new Date(bzYear, bzMonth, 1).toLocaleString('en-PH',{month:'long',year:'numeric'});
  const kpiColor  = dispKpi>=0.8?'var(--success)':dispKpi>=0.6?'var(--warning)':'var(--danger)';
  const attColor  = dispAtt>=0.85?'var(--success)':dispAtt>=0.6?'var(--warning)':'var(--danger)';

  c.innerHTML = `
    <div class="page-header">
      <h2>Personal Finance</h2>
      <button class="btn-primary btn-sm" id="req-advance-btn">+ Cash Advance</button>
    </div>

    ${isPayrollWindow && !selfDoneThisMonth ? `
    <div style="background:linear-gradient(135deg,#b71c1c,#c62828);color:var(--white,#fff);border-radius:12px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
      <span style="font-size:24px">${emojiIcon('⚠️',24)}</span>
      <div style="flex:1">
        <div style="font-weight:800;font-size:14px;margin-bottom:2px">Self-Assessment Required for ${monthLabel}</div>
        <div style="font-size:12px;opacity:0.9">Complete your self-evaluation before payroll is finalized. Click <strong>Self Evaluate</strong> in the KPI card below.</div>
      </div>
    </div>` : ''}

    ${presidentImprovements ? `
    <div style="background:linear-gradient(135deg,var(--surface2),var(--surface));border:2px solid var(--primary-light);border-radius:12px;padding:14px 18px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--primary-light);margin-bottom:6px">${emojiIcon('📝',16)} Your Development Areas — from President</div>
      <div style="font-size:13px;line-height:1.6;color:var(--text);white-space:pre-wrap">${escHtml(presidentImprovements)}</div>
    </div>` : ''}

    <!-- Top KPI stats -->
    <div class="kpi-row">
      <div class="kpi-card green">
        <div class="kpi-label">Earned So Far</div>
        <div class="kpi-value" style="font-size:15px">₱${formatNum(earnedSoFar)}</div>
        <div class="kpi-sub">${daysElapsed} of ${daysInMonth} days · YTD ₱${formatNum(ytdPay)}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Task KPI</div>
        <div class="kpi-value" style="color:${kpiColor}">${taskPct}%</div>
        <div class="kpi-sub">${doneTasks.length}/${myTasks.length} done</div>
      </div>
      <div class="kpi-card accent">
        <div class="kpi-label">Attendance</div>
        <div class="kpi-value" style="color:${attColor}">${Math.round(dispAtt*100)}%</div>
        <div class="kpi-sub">${daysElapsed} days elapsed</div>
      </div>
      <div class="kpi-card ${computedMonth<net*0.9?'red':'green'}">
        <div class="kpi-label">${isFinalMonth?'Final — Disbursed':'Projected Full Month'}</div>
        <div class="kpi-value" style="font-size:14px">₱${formatNum(computedMonth)}</div>
        <div class="kpi-sub">Base ₱${formatNum(net)}</div>
      </div>
    </div>

    <!-- KPI Evaluation Card -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <h3>${emojiIcon('📊',20)} KPI Evaluation — ${monthLabel}</h3>
        <button class="btn-secondary btn-sm" id="self-eval-btn">Self Evaluate</button>
      </div>
      <div class="card-body">
        <!-- Tasks section -->
        <div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:13px">
            <span style="font-weight:600">Tasks Completed</span>
            <strong style="color:${kpiColor}">${doneTasks.length} of ${myTasks.length}</strong>
          </div>
          <div class="kpi-bar-track"><div class="kpi-bar-fill" style="width:${taskPct}%;background:${kpiColor}"></div></div>
          <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:12px;color:var(--text-muted)">
            <span>Target: ${targetScore}%</span>
            <strong style="color:${outcomeMet?'var(--success)':'var(--danger)'}">
              ${outcomeMet?`${emojiIcon('✅',16)} Expected Outcome Met`:`${emojiIcon('❌',16)} Expected Outcome Not Met`}
            </strong>
          </div>
        </div>
        <!-- Grades -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px">
          <div style="background:var(--s2);border-radius:10px;padding:12px;border:1.5px solid var(--border)">
            <div style="font-size:11px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:6px">Self Evaluation</div>
            <div style="font-size:28px;font-weight:800;color:${selfGrade?'var(--primary-light)':'var(--text-muted)'}">
              ${selfGrade!=null?selfGrade:'—'}<span style="font-size:14px;font-weight:400">/10</span>
            </div>
            ${selfNotes?`<div style="font-size:11px;color:var(--text-muted);margin-top:4px;font-style:italic">"${escHtml(selfNotes)}"</div>`:''}
          </div>
          <div style="background:var(--s2);border-radius:10px;padding:12px;border:1.5px solid var(--border)">
            <div style="font-size:11px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:6px">Performance Grade</div>
            <div style="font-size:28px;font-weight:800;color:${presGrade!=null?'var(--success)':'var(--text-muted)'}">
              ${presGrade!=null?presGrade:'—'}<span style="font-size:14px;font-weight:400">/10</span>
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${presGrade!=null?'Avg. from completed tasks':'Available on the 1st of each month'}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Payroll Breakdown -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><h3>Payroll Breakdown — ${monthLabel}</h3></div>
      <div class="card-body">
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">
          Days covered: ${daysElapsed} of ${daysInMonth} days this month
        </div>
        <div class="payslip-row"><span>Base Salary</span><strong>₱${formatNum(u.salary)}</strong></div>
        <div class="payslip-row"><span>Allowances</span><span style="color:var(--success)">+₱${formatNum(u.allowance)}</span></div>
        <div class="payslip-row"><span>Deductions</span><span style="color:var(--danger)">-₱${formatNum(u.deductions)}</span></div>
        <div class="payslip-row"><span>Net Pay (Full Month)</span><strong>₱${formatNum(net)}</strong></div>
        <div style="height:1px;background:var(--border);margin:12px 0"></div>
        <div style="font-size:12px;color:var(--text-muted);font-weight:700;text-transform:uppercase;margin-bottom:8px;letter-spacing:0.5px">${isFinalMonth?'Performance Multiplier (final)':'Performance Multiplier'}</div>
        <div class="payslip-row">
          <span>Task KPI (70%) — ${taskPct}% completion</span>
          <span style="color:${kpiColor}">${(dispKpi*0.7).toFixed(2)}×</span>
        </div>
        <div class="payslip-row">
          <span>Attendance (30%) — ${Math.round(dispAtt*100)}% rate (${daysElapsed} days)</span>
          <span style="color:${attColor}">${(dispAtt*0.3).toFixed(2)}×</span>
        </div>
        <div class="payslip-row" style="font-weight:700">
          <span>Combined Multiplier</span>
          <span>${multiplier.toFixed(2)}×</span>
        </div>
        <div style="height:1px;background:var(--border);margin:12px 0"></div>
        <div class="payslip-row">
          <span>${isFinalMonth?'Final Pay — Disbursed':`Projected Full Month (₱${formatNum(net)} × ${multiplier.toFixed(2)})`}</span>
          <strong>₱${formatNum(computedMonth)}</strong>
        </div>
        <div class="payslip-row">
          <span>${isFinalMonth?'Earned This Month':`Earned So Far (${daysElapsed}/${daysInMonth} days)`}</span>
          <strong style="color:var(--primary-light)">₱${formatNum(earnedSoFar)}</strong>
        </div>
        <div class="payslip-row" style="background:var(--surface2);border-radius:8px;padding:10px 14px;margin-top:8px">
          <span>Cash Advance Balance</span><span style="color:var(--danger)">-₱${formatNum(totalAdvance)}</span>
        </div>
        <div class="payslip-row" style="font-size:16px;font-weight:800;margin-top:8px;padding-top:8px;border-top:2px solid var(--border)">
          <span>Take-Home So Far</span><span style="color:var(--success)">₱${formatNum(Math.max(0,earnedSoFar-totalAdvance))}</span>
        </div>
        ${isFinalMonth && frozenThisMonth.hrNote && frozenThisMonth.hrNote.text ? `
        <div style="margin-top:10px;padding:10px 14px;background:var(--surface2);border:1px solid var(--border);border-radius:8px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);margin-bottom:4px">${emojiIcon('📝',14)} Note from HR</div>
          <div style="font-size:13px;color:var(--text);white-space:pre-wrap">${escHtml(frozenThisMonth.hrNote.text)}</div>
        </div>` : ''}
        <button class="btn-secondary" style="margin-top:14px;width:100%" id="my-payslip-btn">Generate Payslip PDF</button>
      </div>
    </div>

    <!-- Salary History -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><h3>Salary History</h3></div>
      <div class="card-body" style="padding:0">
        ${!salaryHistory.length
          ? '<div class="empty-state" style="padding:20px"><p style="font-size:13px;color:var(--text-muted)">No history yet. Records are added monthly by admin.</p></div>'
          : `<div class="table-wrap"><table class="data-table table-cards">
              <thead><tr><th>Month</th><th>Base</th><th>Allowance</th><th>Deductions</th><th>Net</th><th>KPI</th><th>Att</th><th>Final</th><th>Note</th><th></th></tr></thead>
              <tbody>${salaryHistory.map(h=>`<tr data-hist-id="${h.id}" class="sal-hist-row">
                <td class="tc-name">${h.month||'—'} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
                <td class="tc-detail" data-label="Base">₱${formatNum(h.salary)}</td>
                <td class="tc-detail" data-label="Allowance" style="color:var(--success)">+₱${formatNum(h.allowance)}</td>
                <td class="tc-detail" data-label="Deductions" style="color:var(--danger)">-₱${formatNum(h.deductions)}</td>
                <td class="tc-detail" data-label="Net">₱${formatNum(h.netPay)}</td>
                <td class="tc-detail" data-label="KPI">${h.kpiScore?Math.round(h.kpiScore*100)+'%':'—'}</td>
                <td class="tc-detail" data-label="Att">${h.attScore?Math.round(h.attScore*100)+'%':'—'}</td>
                <td class="tc-net"><strong>₱${formatNum(h.finalPay)}</strong></td>
                <td class="tc-detail" data-label="Note" style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${h.hrNote&&h.hrNote.text?escHtml(h.hrNote.text):''}">${h.hrNote&&h.hrNote.text?escHtml(h.hrNote.text):'—'}</td>
                <td class="tc-actions">${currentRole==='president'||currentRole==='owner'
                  ? `<button class="btn-danger btn-sm ph-delete-btn" data-id="${h.id}" data-month="${h.month||''}">Delete</button>`
                  : currentRole==='finance'
                    ? `<button class="btn-secondary btn-sm ph-req-delete-btn" data-id="${h.id}" data-month="${h.month||''}" style="font-size:11px;color:var(--danger)">Request Delete</button>`
                    : ''}</td>
              </tr>`).join('')}</tbody>
            </table></div>`}
      </div>
    </div>

    ${myRaises.length ? `
    <!-- Salary changes (v12 WS23) — applied raises only, never scheduled/pending -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-header"><h3>Salary Changes</h3></div>
      <div class="card-body" style="padding:0">
        <div class="table-wrap"><table class="data-table table-cards no-toggle">
          <thead><tr><th>Effective</th><th>Old → New</th><th>Change</th><th>Reason</th></tr></thead>
          <tbody>${myRaises.map(r=>{
            const up = (r.changeAmount||0) >= 0;
            return `<tr>
              <td data-label="Effective" style="white-space:nowrap;font-size:12px">${escHtml(r.effectiveDate||'—')}</td>
              <td data-label="Old → New" style="white-space:nowrap">₱${formatNum(r.oldAmount||0)} → <strong>₱${formatNum(r.newAmount||0)}</strong></td>
              <td data-label="Change" style="white-space:nowrap;color:${up?'var(--success)':'var(--danger)'};font-weight:700">${up?'+':''}₱${formatNum(r.changeAmount||0)}${r.changePct!=null?` (${r.changePct>=0?'+':''}${r.changePct}%)`:''}</td>
              <td data-label="Reason" style="font-size:12px">${escHtml(r.reason||'—')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>
    </div>` : ''}

    <!-- Cash Advances -->
    <div class="card">
      <div class="card-header">
        <h3>Cash Advances</h3>
        <div style="display:flex;gap:8px;align-items:center">
          ${cashAdvances.filter(a=>a.status==='pending').length?`<span class="badge badge-orange">${cashAdvances.filter(a=>a.status==='pending').length} pending</span>`:''}
          ${totalAdvance>0?`<button class="btn-secondary btn-sm" id="ca-deduct-req-btn">${emojiIcon('💳',16)} Set Deduction</button>`:''}
        </div>
      </div>
      ${totalAdvance>0?`<div style="background:rgba(255,100,0,0.08);border-bottom:1px solid var(--border);padding:10px 16px;display:flex;gap:20px;font-size:13px">
        <span>Outstanding Balance: <strong style="color:var(--danger)">₱${formatNum(totalAdvance)}</strong></span>
        <span>Monthly Due: <strong>₱${formatNum(cashAdvances.filter(a=>a.status==='approved'&&(a.balance||0)>0).reduce((s,a)=>s+(a.monthlyPayment||0),0))}</strong></span>
      </div>`:''}
      <div class="card-body" style="padding:0">
        ${!cashAdvances.length
          ? '<div class="empty-state" style="padding:20px"><p>No cash advances yet.</p></div>'
          : `<div class="table-wrap"><table class="data-table table-cards">
              <thead><tr><th>Date</th><th>Amount</th><th>Balance</th><th>Monthly</th><th>Reason</th><th>Status</th></tr></thead>
              <tbody>${cashAdvances.map(a=>`<tr class="ca-row">
                <td class="tc-name">${a.date||'—'} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
                <td class="tc-detail" data-label="Amount">₱${formatNum(a.amount)}</td>
                <td class="tc-net" style="color:${(a.balance||0)>0?'var(--danger)':'var(--success)'}">₱${formatNum(a.balance||0)}</td>
                <td class="tc-detail" data-label="Monthly">${a.monthlyPayment?'₱'+formatNum(a.monthlyPayment):'—'}</td>
                <td class="tc-detail" data-label="Reason" style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(a.reason||'—')}</td>
                <td class="tc-detail" data-label="Status"><span class="badge ${a.status==='approved'?'badge-green':a.status==='rejected'?'badge-red':a.status==='paid'?'badge-green':'badge-orange'}">${a.status}</span></td>
              </tr>`).join('')}</tbody>
            </table></div>`}
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  // Card view (≤700px): tap a row (outside its buttons) to reveal the full
  // breakdown — same tap-to-expand idiom as the shared .table-cards pattern.
  c.querySelectorAll('tr.sal-hist-row, tr.ca-row').forEach(tr => {
    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('button, a')) return;
      tr.classList.toggle('tc-expanded');
    });
  });

  // Salary history delete (president) / request delete (finance)
  document.querySelectorAll('.ph-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await confirmDialog({ message: `Delete payroll record for ${escHtml(btn.dataset.month)}? This cannot be undone.`, danger: true, html: true })) return;
      await db.collection('salary_history').doc(btn.dataset.id).delete();
      Notifs.success('Record deleted.');
      window.renderPersonalFinance(currentUser, currentRole, opts);
    });
  });
  document.querySelectorAll('.ph-req-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await confirmDialog({ message: `Request deletion of payroll record for ${escHtml(btn.dataset.month)}? The president will be notified.`, danger: true, html: true })) return;
      const presSnap = await db.collection('users').where('role','==','president').limit(1).get().catch(()=>({empty:true}));
      if (!presSnap.empty) {
        await Notifs.send(presSnap.docs[0].id, {
          title: '🗑️ Payroll Delete Request',
          body: `${userProfile?.displayName||currentUser.email} is requesting to delete the payroll history record for ${btn.dataset.month}. Record ID: ${btn.dataset.id}`,
          icon: '🗑️', type: 'payroll_delete_request', link: 'approvals'
        });
      }
      Notifs.success('Deletion request sent to president.');
      btn.disabled = true; btn.textContent = '⏳ Requested';
    });
  });

  // Self Evaluation button
  document.getElementById('self-eval-btn')?.addEventListener('click', () => {
    openPage(`Self-Assessment — ${monthLabel}`, `
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">
        This is <strong>required for payroll</strong> every 1st of the month. Be honest — the president also grades you.
      </p>
      <div class="form-group">
        <label>Self Grade (1–10) <span style="color:var(--danger)">*</span></label>
        <input id="self-grade-input" type="number" inputmode="numeric" min="1" max="10" step="1" value="${selfGrade!=null?selfGrade:''}" placeholder="e.g. 7"/>
      </div>
      <div class="form-group">
        <label>What did you accomplish this month? <span style="color:var(--danger)">*</span></label>
        <textarea id="self-notes-input" rows="3" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);resize:vertical" placeholder="List your key accomplishments and contributions…">${escHtml(selfNotes)}</textarea>
      </div>
      <div class="form-group">
        <label>What can you improve? <span style="color:var(--danger)">*</span></label>
        <textarea id="self-improve-input" rows="3" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);resize:vertical" placeholder="Be specific about areas you want to work on…">${escHtml(evalData.selfImprovements||'')}</textarea>
      </div>
    `, `<button class="btn-primary" id="save-self-eval-btn">Submit Assessment</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('save-self-eval-btn')?.addEventListener('click', async () => {
      const grade    = parseInt(document.getElementById('self-grade-input').value);
      const notes    = document.getElementById('self-notes-input').value.trim();
      const improve  = document.getElementById('self-improve-input').value.trim();
      if (!grade || grade < 1 || grade > 10) { Notifs.showToast('Enter a grade between 1 and 10.','error'); return; }
      if (!notes)   { Notifs.showToast('Please describe your accomplishments.','error'); return; }
      if (!improve) { Notifs.showToast('Please describe your improvement areas.','error'); return; }
      await db.collection('kpi_evals').doc(currentUser.uid).set({
        selfGrade: grade, selfNotes: notes, selfImprovements: improve,
        selfAssessMonth: currentMonth,
        selfUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        userId: currentUser.uid, userName: userProfile.displayName || currentUser.email
      }, { merge: true });
      // Notify president
      await Notifs.sendToOwner({
        title: '📋 Self-Assessment Submitted',
        body: `${userProfile.displayName||currentUser.email} submitted their self-assessment for ${monthLabel}.`,
        icon: '📋', type: 'self_assessment'
      });
      closeModal();
      Notifs.success('Self-assessment submitted!');
      window.renderPersonalFinance(currentUser, currentRole, opts);
    });
  });

  // v12 WS22 decision 4 — this second, independent request form is retired
  // (its create always omitted `balance`, which firestore.rules' `balance==0`
  // check denies — the button was dead today). Replaced by the ONE shared form.
  document.getElementById('req-advance-btn')?.addEventListener('click', () => window.CashAdvance.openRequestForm());

  // v12 WS24 — the ONE branded payslip template, no pop-ups. Reads the frozen
  // salary_history mirror if this month is already disbursed (official=true);
  // otherwise falls back to a labelled projection via the same computePayLine
  // the real engine uses (never the old KPI×Attendance multiplier).
  document.getElementById('my-payslip-btn')?.addEventListener('click', async () => {
    const month = bizDate().slice(0,7);
    const uid = currentUser.uid, year = (window.bizYear?bizYear():new Date().getFullYear());
    const shSnap = await db.collection('salary_history').doc(`${uid}_${month}`).get().catch(()=>null);
    let model;
    if (shSnap?.exists) {
      model = window.toPayslipModel({...shSnap.data(), uid, month}, 'monthly');
      model.official = true;
    } else {
      const line = window.computePayLine
        ? window.computePayLine(userProfile, {month, projection:true, policy:'flat'})
        : {uid, month, base:userProfile.salary||0, allowance:userProfile.allowance||0, name:userProfile.displayName};
      model = window.toPayslipModel({...line, uid, month}, 'monthly');
      model.official = false;
    }
    model.employee.name = userProfile.displayName||''; model.employee.idNumber = userProfile.employeeId||''; model.employee.department = (userProfile.department||'');
    model.ytd = await window.payslipYtdMonthly(uid, year);
    window.renderPayslipPage(model, ()=>navigateTo('personal-finance'));
  });

  // CA Deduction Override — employee requests how much to deduct this payroll
  // v12 WS22 decision 9 — this used to write directly to payroll_ca_overrides,
  // which firestore.rules restricts to finance/admin only, so a plain
  // employee's write here was silently rejected. Now files a real
  // approval_requests doc; on approval, CashAdvance.planFor() reads it as
  // that month's custom deduction amount.
  document.getElementById('ca-deduct-req-btn')?.addEventListener('click', async () => {
    const month = bizDate().slice(0,7);   // Manila pay-period YYYY-MM
    const activeCA = cashAdvances.filter(a=>a.status==='approved'&&(a.balance||0)>0);
    if (!activeCA.length) { Notifs.showToast('No active cash advance balance.', 'error'); return; }
    const totalBal = activeCA.reduce((s,a)=>s+(a.balance||0),0);
    const existing = await db.collection('approval_requests')
      .where('userId','==',currentUser.uid).where('type','==','ca_deduct').where('month','==',month).where('status','==','pending')
      .limit(1).get().catch(()=>({docs:[]}));
    const currentRequest = existing.docs[0]?.data()?.amount || '';

    openPage('Set CA Deduction for This Payroll', `
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">
        Your current outstanding CA balance is <strong>₱${formatNum(totalBal)}</strong>.<br>
        Request how much you want deducted from your <strong>${new Date(month+'-01').toLocaleString('en-PH',{month:'long',year:'numeric'})}</strong> payroll.
        Finance/the President reviews this before it takes effect. If not approved, the plan's normal installment applies.
      </p>
      <div class="form-group">
        <label>Deduction Amount (₱) — max ₱${formatNum(totalBal)}</label>
        <input id="ca-override-amt" type="number" inputmode="decimal" step="100" min="0" max="${totalBal}" value="${currentRequest||totalBal}" placeholder="${totalBal}"/>
      </div>
      <div class="form-group">
        <label>Reason / Note (optional)</label>
        <input id="ca-override-note" placeholder="e.g., Please deduct ₱3,000 only this month"/>
      </div>
    `, `<button class="btn-primary" id="save-ca-override-btn">Submit Request</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    document.getElementById('save-ca-override-btn')?.addEventListener('click', async () => {
      const amt = parseFloat(document.getElementById('ca-override-amt').value)||0;
      const note = document.getElementById('ca-override-note').value.trim();
      if (amt <= 0 || amt > totalBal) { Notifs.showToast(`Enter an amount between ₱1 and ₱${formatNum(totalBal)}.`, 'error'); return; }
      await db.collection('approval_requests').add({
        type: 'ca_deduct',
        userId: currentUser.uid,
        userName: userProfile.displayName || currentUser.email,
        month, amount: amt, reason: note,
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await Notifs.sendToOwner({
        title: '💳 CA Deduction Request',
        body: `${userProfile.displayName||currentUser.email} requests ₱${formatNum(amt)} CA deduction for ${month} payroll.`,
        icon: '💳', type: 'ca_deduct_req', link: 'approvals'
      });
      closeModal();
      Notifs.success(`CA deduction request (₱${formatNum(amt)}) submitted!`);
    });
  });
};

// getKpiScore(uid, preTasks?, preKpiSnap?) — preTasks/preKpiSnap are optional
// pre-fetched inputs (a plain tasks-data array, and a kpi_targets DocumentSnapshot)
// for callers that already hold both from their own Promise.all (e.g.
// renderPersonalFinance below), so this doesn't re-run the identical
// assignedTo-array-contains tasks query and kpi_targets doc read a second
// time. Callers that omit them keep the original behavior — same two
// Firestore reads, same math, unchanged.
async function getKpiScore(uid, preTasks, preKpiSnap) {
  try {
    // Task completion score (70% weight)
    const DONE_STATUSES = ['done','approved','archived'];
    let tasks;
    if (Array.isArray(preTasks)) {
      tasks = preTasks;
    } else {
      const taskSnap = await db.collection('tasks').where('assignedTo','array-contains',uid).get()
        .catch(()=>db.collection('tasks').where('assignedTo','==',uid).get());
      tasks = taskSnap.docs.map(d=>d.data());
    }
    const taskScore = tasks.length ? Math.min(1, tasks.filter(t=>DONE_STATUSES.includes(t.status)).length / tasks.length) : 0.5;

    // Deliverable quality score (30% weight) — read from kpi_targets collection
    let delivScore = 0.5;
    try {
      const kpiDoc = preKpiSnap !== undefined ? preKpiSnap : await db.collection('kpi_targets').doc(uid).get();
      if (kpiDoc && kpiDoc.exists) {
        const d = kpiDoc.data();
        delivScore = typeof d.deliverableScore === 'number' ? Math.min(1, d.deliverableScore / 100) : 0.5;
      }
    } catch {}

    return taskScore * 0.7 + delivScore * 0.3;
  } catch { return 0.5; }
}

// ── Shared helpers — used by all attendance/KPI calcs ──────────────────────

/**
 * Count Mon–Sat workdays from the 1st up to and including `upTo` date.
 * Sundays (day 0) AND public holidays are excluded, so the payroll denominator
 * matches the attendance calendar (which already treats holidays as no-penalty).
 */
function countWorkDays(year, month, upToDay) {
  const hol = (typeof getPHHolidays === 'function') ? getPHHolidays(year) : {};
  let count = 0;
  for (let d = 1; d <= upToDay; d++) {
    if (new Date(year, month, d).getDay() === 0) continue; // Sunday
    const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    if (hol[ds]) continue;                                 // public holiday
    count++;
  }
  return Math.max(1, count);
}

/** Normalise a Firestore attendance record to a 0/0.5/1.0 score.
 *  Delegates to the shared window.attRecScore (config.js) — paid leave is
 *  stored as attendanceScore:1.0 so it flows through untouched. Name/signature
 *  kept identical: called by getAttendanceScore, which WS20's payroll Compute
 *  depends on via getAttendanceScore/attScore. */
function _attRecScore(r) {
  return window.attRecScore(r);
}

// getAttendanceScore(uid, month?) — payroll recall spec §A2. `month` is an
// optional 'YYYY-MM'; every pre-existing caller passes only `uid` (this file
// at :1375/:2015/:2165/:2709/:2872, js/screens/people.js:2557) and gets
// BYTE-IDENTICAL current-month behavior via the `month || todayStr.slice(0,7)`
// fallback below — this is the backward-compat contract the spec requires.
// The new second arg lets computePayRun (departments.js) score a DELAYED
// month's actual attendance instead of always scoring "today-to-date",
// fixing the bug where recomputing June in August scored August's
// attendance-to-date onto June's payroll.
async function getAttendanceScore(uid, month) {
  try {
    const todayStr = bizDate();                            // YYYY-MM-DD Manila
    const m = month || todayStr.slice(0,7);
    const b = window.monthBounds(m, todayStr);
    if (b.isFuture) return 1; // no month has happened yet — neutral, matches computePayRun's "no data" philosophy
    const y    = parseInt(m.slice(0,4),10);
    const mIdx = parseInt(m.slice(5,7),10) - 1;
    // Denominator = workdays in-scope for this month (Mon–Sat, holidays
    // excluded) up through b.upToDay — the full month for a past month, or
    // elapsed-to-today for the current month (countWorkDays itself unchanged).
    const workDaysElapsed = countWorkDays(y, mIdx, b.upToDay);
    const snap = await db.collection('attendance').doc(uid).collection('records')
      .where(firebase.firestore.FieldPath.documentId(), '>=', b.startDate)
      .where(firebase.firestore.FieldPath.documentId(), '<=', b.endDate).get();
    const totalScore = snap.docs.reduce((sum, doc) => sum + _attRecScore(doc.data()), 0);
    return Math.min(1, totalScore / workDaysElapsed);
  } catch { return 0.5; }
}

// printPayslip() retired (v12 WS24) — replaced by window.renderPayslipPage(),
// the ONE branded template, called from the my-payslip-btn handler above.
// No more pop-ups.

// ── Employee Standings Modal ───────────────────────
async function openEmpStandingsModal(uid, name, preloaded) {
  // v14 Batch5 A3 — read-only detail report (KPI + salary breakdown + attendance
  // grid), CONVERT openModal→openPage. Body is populated after async Firestore
  // reads resolve, so capture the panel openPage returns and query its own
  // body element instead of the old #modal-body singleton id.
  const panel = window.openPage(`${emojiIcon('📊',16)} ${name} — Standings`, `<div style="padding:30px;text-align:center">${window.skeletonHtml('table')}</div>`);
  const body = panel.querySelector('.page-panel-body');

  try {
    // Manila business-calendar (attendance grid must match the employee's local day).
    const _bz = bizDate();
    const bzY = +_bz.slice(0,4), bzM = +_bz.slice(5,7)-1, bzD = +_bz.slice(8,10);
    const monthLabel = new Date(bzY, bzM, 1).toLocaleString('en-PH', { month: 'long', year: 'numeric' });
    const monthStart = `${_bz.slice(0,7)}-01`;

    const [attScore, caSnap, attRecSnap] = await Promise.all([
      getAttendanceScore(uid),
      db.collection('cash_advances').where('userId','==',uid).get().catch(()=>({docs:[]})),
      db.collection('attendance').doc(uid).collection('records')
        .where(firebase.firestore.FieldPath.documentId(), '>=', monthStart).get()
        .catch(()=>({docs:[]}))
    ]);

    const caList  = caSnap.docs.map(d=>({id:d.id,...d.data()}));
    const caBalance = caList.filter(a=>a.status==='approved'&&(a.balance||0)>0).reduce((s,a)=>s+(a.balance||0),0);
    const caActive  = caList.filter(a=>a.status==='approved'&&(a.balance||0)>0).length;

    const net    = preloaded.salary + preloaded.allowance - preloaded.deductions;
    const kpiPct = preloaded.mTotal ? Math.round(preloaded.mDone / preloaded.mTotal * 100) : 0;
    const attPct = Math.round(attScore * 100);
    const attColor = attPct >= 80 ? 'var(--success,#30d158)' : attPct >= 50 ? 'var(--warning,#ffa040)' : 'var(--danger,#ff4444)';
    const kpiColor = kpiPct >= 80 ? 'var(--success,#30d158)' : kpiPct >= 50 ? 'var(--warning,#ffa040)' : 'var(--danger,#ff4444)';

    // Build attendance day grid
    const attRecords = {};
    attRecSnap.docs.forEach(d => { attRecords[d.id] = d.data(); });
    const daysInMonth = new Date(bzY, bzM+1, 0).getDate();
    const dayBoxes = [];
    for (let d = 1; d <= Math.min(bzD, daysInMonth); d++) {
      const ds = `${_bz.slice(0,7)}-${String(d).padStart(2,'0')}`;
      const rec = attRecords[ds];
      const dow = bizDow(ds); // 0=Sun (Manila-anchored)
      if (dow === 0) { dayBoxes.push(`<div class="att-day-box" style="background:rgba(100,100,100,0.15);border:1px solid rgba(100,100,100,0.2);opacity:0.5" title="${ds} — Sunday"><span style="font-size:9px;color:var(--text-muted)">${d}</span><br><span style="font-size:10px">${emojiIcon('✗',10)}</span></div>`); continue; }
      const kind = window.attRecKind(rec);
      const score = window.attRecScore(rec);
      const dispKind = kind === 'none' ? 'absent' : kind; // no record for an elapsed workday = absent
      const b = window.attKindBadge(dispKind);
      const bg = dispKind==='present'||dispKind==='leave' ? 'rgba(48,209,88,0.18)' : dispKind==='half' ? 'rgba(255,160,64,0.18)' : dispKind==='unpaid-leave' ? 'rgba(142,142,147,0.18)' : 'rgba(255,68,68,0.12)';
      const bc = dispKind==='present'||dispKind==='leave' ? 'rgba(48,209,88,0.4)' : dispKind==='half' ? 'rgba(255,160,64,0.4)' : dispKind==='unpaid-leave' ? 'rgba(142,142,147,0.4)' : 'rgba(255,68,68,0.25)';
      const attLabel = dispKind==='leave' ? 'Leave' : dispKind==='unpaid-leave' ? 'Unpaid Leave' : dispKind==='present' ? 'Full' : dispKind==='half' ? 'Half' : 'Absent';
      dayBoxes.push(`<div class="att-day-box" style="background:${bg};border:1px solid ${bc};border-radius:5px;padding:3px 4px;text-align:center;min-width:28px" title="${ds} — ${attLabel}"><span style="font-size:9px;color:var(--text-muted)">${d}</span><br><span style="font-size:11px;color:${b.c};font-weight:700">${b.m}</span></div>`);
    }

    body.innerHTML = `
      <div style="padding:4px 0 16px">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:16px;text-align:center">${monthLabel}</div>

        <!-- KPI Row -->
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:18px">
          <div style="background:var(--surface2,rgba(255,255,255,0.05));border-radius:12px;padding:14px;text-align:center">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Attendance</div>
            <div style="font-size:26px;font-weight:800;color:${attColor}">${attPct}%</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:3px">${attRecSnap.docs.length} days logged</div>
          </div>
          <div style="background:var(--surface2,rgba(255,255,255,0.05));border-radius:12px;padding:14px;text-align:center">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Task KPI</div>
            <div style="font-size:26px;font-weight:800;color:${kpiColor}">${kpiPct}%</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:3px">${preloaded.mDone}/${preloaded.mTotal} done</div>
          </div>
          <div style="background:var(--surface2,rgba(255,255,255,0.05));border-radius:12px;padding:14px;text-align:center">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">CA Balance</div>
            <div style="font-size:22px;font-weight:800;color:${caBalance>0?'var(--danger,#ff4444)':'var(--success,#30d158)'}">${caBalance>0?'₱'+formatNum(caBalance):'₱0'}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:3px">${caActive} active loan${caActive!==1?'s':''}</div>
          </div>
        </div>

        <!-- Salary Breakdown -->
        <div style="background:var(--surface2,rgba(255,255,255,0.05));border-radius:12px;padding:14px;margin-bottom:18px">
          <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Salary Computation</div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><span style="font-size:13px">Base Salary</span><span style="font-size:13px;font-weight:600">₱${formatNum(preloaded.salary)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><span style="font-size:13px;color:var(--success,#30d158)">+ Allowances</span><span style="font-size:13px;font-weight:600;color:var(--success,#30d158)">₱${formatNum(preloaded.allowance)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><span style="font-size:13px;color:var(--danger,#ff4444)">− Deductions</span><span style="font-size:13px;font-weight:600;color:var(--danger,#ff4444)">₱${formatNum(preloaded.deductions)}</span></div>
          ${caBalance > 0 ? `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06)"><span style="font-size:13px;color:var(--danger,#ff4444)">− CA Outstanding</span><span style="font-size:13px;font-weight:600;color:var(--danger,#ff4444)">₱${formatNum(caBalance)}</span></div>` : ''}
          <div style="display:flex;justify-content:space-between;padding:8px 0;margin-top:2px"><span style="font-size:14px;font-weight:700">Net Pay</span><span style="font-size:16px;font-weight:800;color:var(--primary-light,#6c8ef5)">₱${formatNum(Math.max(0, net - caBalance))}</span></div>
          ${caBalance > 0 ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px">* Net deducted by CA outstanding balance</div>` : ''}
        </div>

        <!-- Attendance Grid -->
        <div style="background:var(--surface2,rgba(255,255,255,0.05));border-radius:12px;padding:14px">
          <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Attendance This Month</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${dayBoxes.join('')}</div>
          <div style="display:flex;gap:12px;margin-top:10px;font-size:11px;color:var(--text-muted);flex-wrap:wrap">
            <span><span style="color:var(--success);font-weight:700">${emojiIcon('✓',16)}</span> Full</span>
            <span><span style="color:#ffa040;font-weight:700">½</span> Half</span>
            <span><span style="color:#ff6b6b;font-weight:700">${emojiIcon('✗',16)}</span> Absent</span>
            <span>${emojiIcon('🌴',16)} Leave</span>
            <span>${emojiIcon('📅',16)} Unpaid Leave</span>
            <span style="opacity:.6">${emojiIcon('✗',16)} Sundays</span>
          </div>
        </div>
      </div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [body] });
  } catch(err) {
    body.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><p>${err.message}</p></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [body] });
  }
}

// ── Worker Profile Panel ──────────────────────────
// v14 Phase 2c — rebuilt on window.openPage (the real page-stack primitive,
// see openPage above). The panel is now one Overlay 'page' entry like any
// other pushed page: Back always returns to whatever was open before it
// (list view or another page) with its scroll/tab state intact, and a modal
// opened while this panel is on top stacks visibly above it (Batch 1 1c
// dynamic z-order) instead of rendering behind. Deleted: the hand-rolled
// fixed z-4000 shell + its own translateY slide animation, its own
// #wp-back-btn wiring (openPage's built-in .page-panel-back already calls
// Overlay.dismissTop()), its direct Overlay.push('worker-profile', ...), and
// the defensive stale-entry pop that used to guard against double-registration
// (a symptom of the old destroy-without-popping fragility — the real stack
// just pushes a second panel cleanly, so the guard is unnecessary now).
function openWorkerProfilePanel(uid, name, preloaded) {
  const bodyHTML = `
    <div style="position:sticky;top:-16px;z-index:1;background:var(--bg);margin:-16px -16px 0;padding:16px 16px 0">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px" id="wp-subtitle">Worker Profile</div>
      <div style="display:flex;border-bottom:1px solid var(--border)">
        ${['Overview','Salary','Tasks','Attendance'].map((t,i)=>`<button class="wp-tab" data-tab="${t.toLowerCase()}" style="flex:1;padding:11px 4px;border:none;background:none;font-size:12px;font-weight:600;cursor:pointer;color:${i===0?'var(--primary-light)':'var(--text-muted)'};border-bottom:${i===0?'2px solid var(--primary-light)':'2px solid transparent'};transition:color .15s,border-color .15s">${t}</button>`).join('')}
      </div>
    </div>
    <div id="wp-tab-content" style="padding-top:16px">
      <div style="text-align:center;padding:40px">${window.skeletonHtml('rows')}</div>
    </div>`;
  const headerRightHTML = `<button class="btn-secondary btn-sm" id="wp-payslip-btn">${emojiIcon('🖨️',16)} Payslip</button>`;
  // (name renders as the page title as plain text via openPage/_setPanelTitle
  // — no manual escaping needed, same contract as every other openPage call.)
  const panel = window.openPage(name, bodyHTML, '', { headerRightHTML });

  function activateTab(tabName) {
    panel.querySelectorAll('.wp-tab').forEach(t => {
      const a = t.dataset.tab === tabName;
      t.style.color = a ? 'var(--primary-light)' : 'var(--text-muted)';
      t.style.borderBottomColor = a ? 'var(--primary-light)' : 'transparent';
    });
    renderWorkerProfileTab(uid, name, preloaded, tabName, panel);
  }
  panel.querySelectorAll('.wp-tab').forEach(tab => { tab.addEventListener('click', () => activateTab(tab.dataset.tab)); });
  panel.querySelector('#wp-payslip-btn')?.addEventListener('click', async () => {
    const month = bizDate().slice(0,7);
    const year = (window.bizYear?bizYear():new Date().getFullYear());
    const shSnap = await db.collection('salary_history').doc(`${uid}_${month}`).get().catch(()=>null);
    let model;
    if (shSnap?.exists) {
      model = window.toPayslipModel({...shSnap.data(), uid, month}, 'monthly');
      model.official = true;
    } else {
      model = window.toPayslipModel({ uid, month, name, base:preloaded?.salary||0, allowance:preloaded?.allowance||0, deductions:preloaded?.deductions||0 }, 'monthly');
      model.official = false;
    }
    model.ytd = await window.payslipYtdMonthly(uid, year);
    // v14 wave7 pass3: renderPayslipPage is a real openPage now — it stacks
    // above this panel and Back returns here. The old dismiss-first
    // workaround is gone; onClose falls back to Personal Finance only when
    // the profile panel itself is no longer open.
    window.renderPayslipPage(model, ()=>{ if (!window.Overlay.isOpen()) renderPersonalFinance(currentUser, currentRole); });
  });
  activateTab('overview');
  return panel;
}

async function renderWorkerProfileTab(uid, name, preloaded, tabName, panel) {
  const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const content = panel.querySelector('#wp-tab-content');
  const subtitle = panel.querySelector('#wp-subtitle');
  content.innerHTML = `<div style="text-align:center;padding:40px">${window.skeletonHtml('rows')}</div>`;
  try {
    if (tabName === 'overview') {
      subtitle.textContent = 'Overview';
      const [kpi, att, caSnap, userSnap, evalSnap] = await Promise.all([
        getKpiScore(uid), getAttendanceScore(uid),
        db.collection('cash_advances').where('userId','==',uid).get().catch(()=>({docs:[]})),
        db.collection('users').doc(uid).get().catch(()=>null),
        db.collection('kpi_evals').doc(uid).get().catch(()=>null)
      ]);
      const u = userSnap?.exists ? userSnap.data() : {};
      const evalD = evalSnap?.exists ? evalSnap.data() : {};
      const caBalance = caSnap.docs.map(d=>d.data()).filter(a=>a.status==='approved'&&(a.balance||0)>0).reduce((s,a)=>s+(a.balance||0),0);
      const net = (preloaded.salary||0)+(preloaded.allowance||0)-(preloaded.deductions||0);
      const mult = kpi*0.7+att*0.3;
      const _bzS = bizDate();
      const bzSY = +_bzS.slice(0,4), bzSM = +_bzS.slice(5,7)-1, bzSD = +_bzS.slice(8,10);
      const daysElapsed = countWorkDays(bzSY, bzSM, bzSD);
      const daysInMonth = countWorkDays(bzSY, bzSM, new Date(bzSY,bzSM+1,0).getDate());
      const earnedSoFar = net*mult*(daysElapsed/daysInMonth);
      const kpiPct = Math.round(kpi*100), attPct = Math.round(att*100);
      const kpiColor = kpiPct>=80?'var(--success)':kpiPct>=50?'var(--warning)':'var(--danger)';
      const attColor = attPct>=80?'var(--success)':attPct>=50?'var(--warning)':'var(--danger)';
      const dept = (Array.isArray(u.departments)&&u.departments.length?u.departments.join(', '):u.department)||'—';
      const role = u.role?(window.ROLES?.[u.role]?.label||u.role):'—';
      const monthLabel = new Date(bzSY, bzSM, 1).toLocaleString('en-PH',{month:'long',year:'numeric'});
      const selfGrade = evalD.selfGrade??null, presGrade = evalD.presidentGrade??evalD.presidentGradeFromTasks??null;
      content.innerHTML = `
        <div style="background:var(--surface2);border-radius:14px;padding:16px;margin-bottom:14px;display:flex;align-items:center;gap:14px">
          <div style="width:50px;height:50px;border-radius:50%;background:linear-gradient(135deg,var(--primary),var(--primary-light));display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:var(--white,#fff);flex-shrink:0">${(name||'?')[0].toUpperCase()}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:2px">${esc(name)}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">${esc(dept)}</div>
            <div style="display:flex;gap:5px;flex-wrap:wrap">
              <span class="badge badge-blue" style="font-size:10px">${esc(role)}</span>
              ${u.employeeId?`<span class="badge badge-gray" style="font-size:10px">ID: ${esc(u.employeeId)}</span>`:''}
            </div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">
          <div style="background:var(--surface2);border-radius:12px;padding:12px;text-align:center"><div style="font-size:10px;color:var(--text-muted);margin-bottom:3px">Task KPI</div><div style="font-size:24px;font-weight:800;color:${kpiColor}">${kpiPct}%</div><div style="font-size:10px;color:var(--text-muted)">${preloaded.mDone||0}/${preloaded.mTotal||0} done</div></div>
          <div style="background:var(--surface2);border-radius:12px;padding:12px;text-align:center"><div style="font-size:10px;color:var(--text-muted);margin-bottom:3px">Attendance</div><div style="font-size:24px;font-weight:800;color:${attColor}">${attPct}%</div><div style="font-size:10px;color:var(--text-muted)">${daysElapsed} days</div></div>
          <div style="background:var(--surface2);border-radius:12px;padding:12px;text-align:center"><div style="font-size:10px;color:var(--text-muted);margin-bottom:3px">CA Balance</div><div style="font-size:20px;font-weight:800;color:${caBalance>0?'var(--danger)':'var(--success)'}">₱${formatNum(caBalance)}</div><div style="font-size:10px;color:var(--text-muted)">${caBalance>0?'outstanding':'cleared'}</div></div>
        </div>
        <div style="background:var(--surface2);border-radius:12px;padding:14px;margin-bottom:14px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);margin-bottom:10px">${monthLabel} — Pay</div>
          <div class="payslip-row"><span>Base Salary</span><strong>₱${formatNum(preloaded.salary)}</strong></div>
          <div class="payslip-row"><span style="color:var(--success)">+ Allowances</span><span style="color:var(--success)">₱${formatNum(preloaded.allowance)}</span></div>
          <div class="payslip-row"><span style="color:var(--danger)">− Deductions</span><span style="color:var(--danger)">₱${formatNum(preloaded.deductions)}</span></div>
          <div class="payslip-row" style="font-weight:700;border-top:1px solid var(--border);margin-top:6px;padding-top:6px"><span>Net (Full Month)</span><span>₱${formatNum(net)}</span></div>
          <div class="payslip-row"><span style="color:var(--text-muted)">× Multiplier (${mult.toFixed(2)}×)</span><span></span></div>
          <div class="payslip-row" style="font-size:15px;font-weight:800;border-top:1px solid var(--border);margin-top:6px;padding-top:6px"><span>Earned So Far</span><span style="color:var(--primary-light)">₱${formatNum(earnedSoFar)}</span></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div style="background:var(--surface2);border-radius:12px;padding:12px;text-align:center"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Self Grade</div><div style="font-size:28px;font-weight:800;color:${selfGrade!=null?'var(--primary-light)':'var(--text-muted)'}">${selfGrade!=null?selfGrade:'—'}<span style="font-size:12px;font-weight:400">/10</span></div></div>
          <div style="background:var(--surface2);border-radius:12px;padding:12px;text-align:center"><div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">President Grade</div><div style="font-size:28px;font-weight:800;color:${presGrade!=null?'var(--success)':'var(--text-muted)'}">${presGrade!=null?presGrade:'—'}<span style="font-size:12px;font-weight:400">/10</span></div></div>
        </div>`;

    } else if (tabName === 'salary') {
      subtitle.textContent = 'Salary History';
      const snap = await db.collection('salary_history').where('userId','==',uid).orderBy('month','desc').limit(12).get().catch(()=>({docs:[]}));
      const history = snap.docs.map(d=>d.data());
      content.innerHTML = history.length ? `
        <div class="table-wrap"><table class="data-table table-cards">
          <thead><tr><th>Month</th><th>Base</th><th>Allow.</th><th>Deduct.</th><th>Net</th><th>KPI</th><th>Att</th><th>Final</th></tr></thead>
          <tbody>${history.map(h=>`<tr class="wp-sal-row">
            <td class="tc-name">${h.month||'—'} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td><td class="tc-detail" data-label="Base">₱${formatNum(h.salary||0)}</td>
            <td class="tc-detail" data-label="Allow." style="color:var(--success)">+₱${formatNum(h.allowance||0)}</td>
            <td class="tc-detail" data-label="Deduct." style="color:var(--danger)">-₱${formatNum(h.deductions||0)}</td>
            <td class="tc-detail" data-label="Net">₱${formatNum(h.netPay||0)}</td>
            <td class="tc-detail" data-label="KPI">${h.kpiScore!=null?Math.round(h.kpiScore*100)+'%':'—'}</td>
            <td class="tc-detail" data-label="Att">${h.attScore!=null?Math.round(h.attScore*100)+'%':'—'}</td>
            <td class="tc-net"><strong style="color:var(--primary-light)">₱${formatNum(h.finalPay||0)}</strong></td>
          </tr>`).join('')}</tbody>
        </table></div>
        <div style="margin-top:10px;font-size:12px;color:var(--text-muted)">Last ${history.length} recorded month${history.length!==1?'s':''}</div>
      ` : `<div class="empty-state" style="padding:40px"><div class="empty-icon">${emojiIcon('📊',44)}</div><p>No salary records yet.</p></div>`;
      if (window.lucide) lucide.createIcons({ nodes: [content] });
      content.querySelectorAll('tr.wp-sal-row').forEach(tr => tr.addEventListener('click', () => tr.classList.toggle('tc-expanded')));

    } else if (tabName === 'tasks') {
      subtitle.textContent = 'Task History';
      const snap = await db.collection('tasks').where('assignedTo','array-contains',uid).get()
        .catch(()=>db.collection('tasks').where('assignedTo','==',uid).get()).catch(()=>({docs:[]}));
      const tasks = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
      const DONE = ['done','approved','archived'];
      const done = tasks.filter(t=>DONE.includes(t.status)).length;
      const SC = {done:'var(--success)',approved:'var(--success)',archived:'var(--text-muted)',in_progress:'var(--primary-light)',pending:'var(--warning)',review:'var(--warning)'};
      content.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">
          <div style="background:var(--surface2);border-radius:10px;padding:10px;text-align:center"><div style="font-size:20px;font-weight:800;color:var(--success)">${done}</div><div style="font-size:10px;color:var(--text-muted)">Completed</div></div>
          <div style="background:var(--surface2);border-radius:10px;padding:10px;text-align:center"><div style="font-size:20px;font-weight:800;color:var(--primary-light)">${tasks.length-done}</div><div style="font-size:10px;color:var(--text-muted)">Active</div></div>
          <div style="background:var(--surface2);border-radius:10px;padding:10px;text-align:center"><div style="font-size:20px;font-weight:800">${tasks.length}</div><div style="font-size:10px;color:var(--text-muted)">Total</div></div>
        </div>
        ${tasks.length ? tasks.map(t=>`<div style="background:var(--surface2);border-radius:10px;padding:11px 13px;margin-bottom:7px;border-left:3px solid ${SC[t.status]||'var(--border)'}"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px"><div style="font-size:13px;font-weight:600;color:var(--text);flex:1">${esc(t.title||'Untitled')}</div><span class="badge" style="background:${SC[t.status]||'var(--surface2)'};color:var(--white,#fff);font-size:10px;white-space:nowrap;flex-shrink:0">${t.status||'pending'}</span></div>${t.department?`<div style="font-size:11px;color:var(--text-muted);margin-top:3px">${esc(t.department)}</div>`:''}</div>`).join('')
          : `<div class="empty-state" style="padding:30px"><div class="empty-icon">${emojiIcon('✅',44)}</div><p>No tasks assigned.</p></div>`}`;
      if (window.lucide) lucide.createIcons({ nodes: [content] });

    } else if (tabName === 'attendance') {
      subtitle.textContent = 'Attendance';
      const _bzA = bizDate();
      const bzAY = +_bzA.slice(0,4), bzAM = +_bzA.slice(5,7)-1, bzAD = +_bzA.slice(8,10);
      const monthStart = `${_bzA.slice(0,7)}-01`;
      const snap = await db.collection('attendance').doc(uid).collection('records')
        .where(firebase.firestore.FieldPath.documentId(),'>=',monthStart).get().catch(()=>({docs:[]}));
      const recs = {}; snap.docs.forEach(d => { recs[d.id] = d.data(); });
      const daysInMonth = new Date(bzAY,bzAM+1,0).getDate();
      const monthLabel = new Date(bzAY, bzAM, 1).toLocaleString('en-PH',{month:'long',year:'numeric'});
      let full=0, half=0, absent=0;
      const boxes = [];
      for (let d=1; d<=Math.min(bzAD,daysInMonth); d++) {
        const ds = `${_bzA.slice(0,7)}-${String(d).padStart(2,'0')}`;
        const dow = bizDow(ds);
        if (dow===0) { boxes.push(`<div style="background:rgba(100,100,100,0.1);border:1px solid rgba(100,100,100,0.15);border-radius:5px;padding:3px 4px;text-align:center;min-width:28px;opacity:0.4"><span style="font-size:9px;color:var(--text-muted)">${d}</span><br><span style="font-size:10px">—</span></div>`); continue; }
        const rec = recs[ds];
        const kind = window.attRecKind(rec);
        const score = window.attRecScore(rec);
        const dispKind = kind === 'none' ? 'absent' : kind; // no record for an elapsed workday = absent
        const b = window.attKindBadge(dispKind);
        const bg = dispKind==='present'||dispKind==='leave' ? 'rgba(48,209,88,0.18)' : dispKind==='half' ? 'rgba(255,160,64,0.18)' : dispKind==='unpaid-leave' ? 'rgba(142,142,147,0.18)' : 'rgba(255,68,68,0.12)';
        const bc = dispKind==='present'||dispKind==='leave' ? 'rgba(48,209,88,0.4)' : dispKind==='half' ? 'rgba(255,160,64,0.4)' : dispKind==='unpaid-leave' ? 'rgba(142,142,147,0.4)' : 'rgba(255,68,68,0.25)';
        if (dispKind==='present' || dispKind==='leave') full++;
        else if (dispKind==='half') half++;
        else absent++; // covers 'absent' and 'unpaid-leave'
        boxes.push(`<div style="background:${bg};border:1px solid ${bc};border-radius:5px;padding:3px 4px;text-align:center;min-width:28px"><span style="font-size:9px;color:var(--text-muted)">${d}</span><br><span style="font-size:11px;color:${b.c};font-weight:700">${b.m}</span></div>`);
      }
      content.innerHTML = `
        <div style="font-size:13px;font-weight:700;margin-bottom:12px">${monthLabel}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">
          <div style="background:rgba(48,209,88,0.1);border:1px solid rgba(48,209,88,0.3);border-radius:10px;padding:10px;text-align:center"><div style="font-size:22px;font-weight:800;color:var(--success)">${full}</div><div style="font-size:10px;color:var(--text-muted)">Full Days</div></div>
          <div style="background:rgba(255,160,64,0.1);border:1px solid rgba(255,160,64,0.3);border-radius:10px;padding:10px;text-align:center"><div style="font-size:22px;font-weight:800;color:#ffa040">${half}</div><div style="font-size:10px;color:var(--text-muted)">Half Days</div></div>
          <div style="background:rgba(255,68,68,0.1);border:1px solid rgba(255,68,68,0.25);border-radius:10px;padding:10px;text-align:center"><div style="font-size:22px;font-weight:800;color:#ff6b6b">${absent}</div><div style="font-size:10px;color:var(--text-muted)">Absences</div></div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${boxes.join('')}</div>
        <div style="display:flex;gap:12px;margin-top:10px;font-size:11px;color:var(--text-muted);flex-wrap:wrap">
          <span><span style="color:var(--success);font-weight:700">${emojiIcon('✓',16)}</span> Full</span>
          <span><span style="color:#ffa040;font-weight:700">½</span> Half</span>
          <span><span style="color:#ff6b6b;font-weight:700">${emojiIcon('✗',16)}</span> Absent</span>
          <span>${emojiIcon('🌴',16)} Leave</span>
          <span>${emojiIcon('📅',16)} Unpaid Leave</span>
        </div>`;
      if (window.lucide) lucide.createIcons({ nodes: [content] });
    }
  } catch(err) {
    content.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><p>${err.message}</p></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [content] });
  }
}

// printWorkerPayslip() retired (v12 WS24) — near-verbatim duplicate of the old
// printPayslip() (same retired KPI×Attendance multiplier). Its only caller,
// #wp-payslip-btn, now calls window.renderPayslipPage() directly (see
// openWorkerProfilePanel below).

// ── Progress Reports ──────────────────────────────
async function renderProgressReports() {
  if (!isPresident() && currentRole !== 'manager' && currentRole !== 'secretary') {
    document.getElementById('page-content').innerHTML = renderAccessDenied('Progress Reports');
    return;
  }
  const c = document.getElementById('page-content');
  c.innerHTML = window.skeletonHtml('rows');
  try {
    const safeGet = async (q, label) => { try { return await q.get(); } catch(e) { _dashWarnOnce(label || 'query', e); return { docs:[], size:0 }; } };
    const [usersSnap, tasksSnap, attSnap] = await Promise.all([
      fetchUsersWithPayroll().catch(()=>({docs:[],size:0})),
      safeGet(db.collection('tasks'), 'tasks'),
      safeGet(db.collection('attendance'), 'attendance')
    ]);
    const users = usersSnap.docs.map(d=>({id:d.id,...d.data()}));
    const tasks = tasksSnap.docs.map(d=>d.data());
    const DONE_TASK_STATUSES = ['done','approved','archived'];
    const isDoneTask = t => DONE_TASK_STATUSES.includes(t.status);

    // Group by dept
    const deptMap = {};
    users.forEach(u => {
      const depts = Array.isArray(u.departments)&&u.departments.length ? u.departments : u.department ? [u.department] : ['Unassigned'];
      depts.forEach(dept => {
        if (!deptMap[dept]) deptMap[dept] = { members:[], tasks:[] };
        deptMap[dept].members.push(u);
      });
    });
    tasks.forEach(t => { if (t.department && deptMap[t.department]) deptMap[t.department].tasks.push(t); });

    // Current month filter (Manila business calendar on both sides of the compare)
    const _bzPr = bizDate();
    const monthStr = _bzPr.slice(0,7);
    const monthLabel = new Date(+_bzPr.slice(0,4), +_bzPr.slice(5,7)-1, 1).toLocaleString('en-PH',{month:'long',year:'numeric'});
    const monthTasks = tasks.filter(t => {
      const ts = t.createdAt?.seconds ? new Date(t.createdAt.seconds*1000) : null;
      return ts && bizDate(ts).slice(0,7) === monthStr;
    });

    // Helper to check assignedTo array
    const isAssigned = (t, uid) => Array.isArray(t.assignedTo) ? t.assignedTo.includes(uid) : t.assignedTo === uid;

    c.innerHTML = `
      <div class="page-header"><h2>${emojiIcon('📈',20)} Progress Reports & KPIs</h2><span class="badge badge-blue">${monthLabel}</span></div>
      <div class="kpi-row">
        <div class="kpi-card accent"><div class="kpi-label">All Tasks (Total)</div><div class="kpi-value">${tasks.length}</div><div class="kpi-sub">${tasks.filter(isDoneTask).length} done</div></div>
        <div class="kpi-card green"><div class="kpi-label">This Month Tasks</div><div class="kpi-value">${monthTasks.length}</div><div class="kpi-sub">${monthTasks.filter(isDoneTask).length} done</div></div>
        <div class="kpi-card"><div class="kpi-label">Overall KPI</div><div class="kpi-value">${tasks.length?Math.round(tasks.filter(isDoneTask).length/tasks.length*100):0}%</div></div>
      </div>
      ${window.chipTabs([{key:'dept',label:'By Department'},{key:'members',label:'All Members'}], 'dept', {cls:'progress-top-tabs'})}
      <div id="progress-dept-view"></div>
      <div id="progress-members-view" style="display:none">
        <div class="card">
          <div class="card-header"><h3>${emojiIcon('👥',20)} All Members Progress</h3></div>
          <div class="card-body" style="padding:0">
            <div class="table-wrap"><table class="data-table table-cards">
              <thead><tr><th></th><th>Member</th><th>Department</th><th>This Month</th><th>All Time</th><th>KPI</th><th></th></tr></thead>
              <tbody>
                ${users.filter(u=>u.role!=='partner').map(u=>{
                  const uDone   = tasks.filter(t=>isAssigned(t,u.id)&&isDoneTask(t)).length;
                  const uTotal  = tasks.filter(t=>isAssigned(t,u.id)).length;
                  const uMDone  = monthTasks.filter(t=>isAssigned(t,u.id)&&isDoneTask(t)).length;
                  const uMTotal = monthTasks.filter(t=>isAssigned(t,u.id)).length;
                  const uPct    = uTotal ? Math.round(uDone/uTotal*100) : 0;
                  const depts   = Array.isArray(u.departments)&&u.departments.length ? u.departments.join(', ') : u.department||'—';
                  return `<tr class="prm-row">
                    <td class="tc-avatar">
                      <div style="width:32px;height:32px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--white,#fff);flex-shrink:0">
                        ${u.photoUrl?`<img src="${escHtml(u.photoUrl)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`:(u.displayName||'?')[0].toUpperCase()}
                      </div>
                    </td>
                    <td class="tc-name">
                      <div style="font-size:13px;font-weight:600">${escHtml(u.displayName||u.email)} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></div>
                      <div style="font-size:11px;color:var(--text-muted)">${escHtml(u.role||'')}</div>
                    </td>
                    <td class="tc-detail" data-label="Department" style="font-size:12px;color:var(--text-muted)">${escHtml(depts)}</td>
                    <td class="tc-detail" data-label="This Month" style="font-size:12px"><strong>${uMDone}</strong>/${uMTotal}</td>
                    <td class="tc-detail" data-label="All Time" style="font-size:12px"><strong>${uDone}</strong>/${uTotal}</td>
                    <td class="tc-net"><span class="badge ${uPct>=80?'badge-green':uPct>=50?'badge-orange':'badge-red'}">${uPct}%</span></td>
                    <td class="tc-actions"><button class="btn-sm btn-outline emp-standings-btn" data-uid="${u.id}" data-name="${encodeURIComponent(u.displayName||u.email)}" data-mdone="${uMDone}" data-mtotal="${uMTotal}" data-salary="${u.salary||0}" data-allowance="${u.allowance||0}" data-deductions="${u.deductions||0}" style="font-size:11px;padding:3px 8px">${emojiIcon('📊',11)} View</button></td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table></div>
          </div>
        </div>
      </div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    const deptView = document.getElementById('progress-dept-view');
    Object.entries(deptMap).forEach(([dept, data]) => {
      const cfg = DEPARTMENTS[dept]||{icon:'🗂️',color:'var(--primary-light)'};
      const total = data.tasks.length;
      const done  = data.tasks.filter(isDoneTask).length;
      const pct   = total ? Math.round(done/total*100) : 0;
      // month-only stats for this dept
      const mTasks = data.tasks.filter(t => {
        const ts = t.createdAt?.seconds ? new Date(t.createdAt.seconds*1000) : null;
        return ts && bizDate(ts).slice(0,7) === monthStr;
      });
      const mDone = mTasks.filter(isDoneTask).length;
      const mPct  = mTasks.length ? Math.round(mDone/mTasks.length*100) : 0;
      deptView.innerHTML += `
        <div class="card" style="margin-bottom:12px">
          <div class="card-header" style="border-left:4px solid ${cfg.color}">
            <h3>${emojiIcon(cfg.lucideIcon||cfg.icon,20)} ${dept}</h3>
            <div style="display:flex;gap:8px;align-items:center">
              <span class="badge ${mPct>=80?'badge-green':mPct>=50?'badge-orange':'badge-red'}" title="This month KPI">${emojiIcon('📅',16)} ${mPct}%</span>
              <span class="badge ${pct>=80?'badge-green':pct>=50?'badge-orange':'badge-red'}" title="All-time KPI">Overall ${pct}%</span>
            </div>
          </div>
          <div class="card-body">
            <div class="progress-bar-wrap" style="margin-bottom:8px"><div class="progress-bar-fill" style="width:${pct}%;background:${cfg.color}"></div></div>
            <div style="display:flex;gap:20px;font-size:12px;color:var(--text-muted);margin-bottom:12px">
              <span>${emojiIcon('👥',16)} ${data.members.length} members</span>
              <span>${emojiIcon('✅',16)} ${done}/${total} tasks done (all time)</span>
              <span>${emojiIcon('📅',16)} ${mDone}/${mTasks.length} done this month</span>
            </div>
            ${window.chipTabs([{key:`${dept}-tasks`,label:'All Tasks'},{key:`${dept}-members`,label:'By Member'}], `${dept}-tasks`, {cls:'prog-dept-tabs'})}
            <div id="prog-${dept.replace(/\s+/g,'_')}-content">
              <div class="table-wrap"><table class="data-table table-cards no-toggle">
                <thead><tr><th>Task</th><th>Assigned To</th><th>Status</th><th>Due</th></tr></thead>
                <tbody>
                  ${data.tasks.slice(0,10).map(t=>`<tr>
                    <td data-label="Task" style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(t.title)}</td>
                    <td data-label="Assigned To" style="font-size:12px">${escHtml(t.assignedToName||'—')}</td>
                    <td data-label="Status"><span class="badge ${isDoneTask(t)?'badge-green':t.status==='review'?'badge-orange':'badge-blue'}">${t.status||'open'}</span></td>
                    <td data-label="Due" style="font-size:11px;color:var(--text-muted)">${t.dueDate||'—'}</td>
                  </tr>`).join('')}
                  ${data.tasks.length>10?`<tr><td colspan="4" style="font-size:12px;color:var(--text-muted);text-align:center">+ ${data.tasks.length-10} more tasks</td></tr>`:''}
                </tbody>
              </table></div>
            </div>
            <div id="prog-${dept.replace(/\s+/g,'_')}-members" style="display:none">
              <div class="table-wrap"><table class="data-table table-cards">
                <thead><tr><th>Member</th><th>All Tasks Done</th><th>This Month</th><th>KPI</th><th></th></tr></thead>
                <tbody>
                  ${data.members.map(u=>{
                    const uDone  = tasks.filter(t=>isAssigned(t,u.id)&&isDoneTask(t)).length;
                    const uTotal = tasks.filter(t=>isAssigned(t,u.id)).length;
                    const uMDone = monthTasks.filter(t=>isAssigned(t,u.id)&&isDoneTask(t)).length;
                    const uMTotal= monthTasks.filter(t=>isAssigned(t,u.id)).length;
                    const uPct   = uTotal ? Math.round(uDone/uTotal*100) : 0;
                    return `<tr class="prm-row">
                      <td class="tc-name">${escHtml(u.displayName||u.email)} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
                      <td class="tc-detail" data-label="All Tasks Done">${uDone}/${uTotal}</td>
                      <td class="tc-detail" data-label="This Month">${uMDone}/${uMTotal}</td>
                      <td class="tc-net"><span class="badge ${uPct>=80?'badge-green':uPct>=50?'badge-orange':'badge-red'}">${uPct}%</span></td>
                      <td class="tc-actions"><button class="btn-sm btn-outline emp-standings-btn" data-uid="${u.id}" data-name="${encodeURIComponent(u.displayName||u.email)}" data-mdone="${uMDone}" data-mtotal="${uMTotal}" data-salary="${u.salary||0}" data-allowance="${u.allowance||0}" data-deductions="${u.deductions||0}" style="font-size:11px;padding:3px 8px">${emojiIcon('📊',11)} View</button></td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table></div>
            </div>
          </div>
        </div>`;
    });
    if (window.lucide) lucide.createIcons({ nodes: [deptView] });

    // Wire up subtab toggles inside progress cards
    deptView.querySelectorAll('.prog-dept-tabs').forEach(scope => {
      window.bindChipTabs(scope, (key) => {
        const dept = key.replace(/-tasks$|-members$/,'');
        const deptId = dept.replace(/\s+/g,'_');
        const isTask = key.endsWith('-tasks');
        document.getElementById(`prog-${deptId}-content`).style.display = isTask  ? '' : 'none';
        document.getElementById(`prog-${deptId}-members`).style.display = isTask  ? 'none' : '';
      });
    });

    // Wire up top-level tabs (By Department / All Members)
    window.bindChipTabs(c.querySelector('.progress-top-tabs'), (tab) => {
      document.getElementById('progress-dept-view').style.display    = tab==='dept'    ? '' : 'none';
      document.getElementById('progress-members-view').style.display = tab==='members' ? '' : 'none';
    });

    // Wire up employee standings modal buttons (in both views)
    c.querySelectorAll('.emp-standings-btn').forEach(btn => {
      btn.addEventListener('click', () => openEmpStandingsModal(
        btn.dataset.uid,
        decodeURIComponent(btn.dataset.name),
        { mDone: +btn.dataset.mdone, mTotal: +btn.dataset.mtotal,
          salary: +btn.dataset.salary, allowance: +btn.dataset.allowance, deductions: +btn.dataset.deductions }
      ));
    });
    // Card view (≤700px): tap a member row (outside its View button) to
    // reveal the full breakdown — covers both "All Members" and each
    // department's "By Member" table (both share the .prm-row class).
    c.querySelectorAll('tr.prm-row').forEach(tr => {
      tr.addEventListener('click', (ev) => {
        if (ev.target.closest('button, a')) return;
        tr.classList.toggle('tc-expanded');
      });
    });
  } catch(err) {
    document.getElementById('page-content').innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>${err.message}</h4></div>`;
  }
}

// ── Company ───────────────────────────────────────
async function renderCompany() {
  const c = document.getElementById('page-content');
  const canAdd = isPresident();
  c.innerHTML = `
    <div class="page-header"><h2>${emojiIcon('🏢',20)} Company</h2></div>
    ${window.chipTabs([
      {key:'overview',label:'Overview'},
      {key:'memos',label:'Memos'},
      {key:'policies',label:'Policies'},
      {key:'downloads',label:'Downloads'},
      {key:'handbook',label:'Handbook'},
      {key:'bi-ops',label:'The System'},
    ], 'overview', {cls:'company-tabs'})}
    <div id="company-tab-content"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  function switchCompanyTab(tab) {
    const ct = document.getElementById('company-tab-content');
    if (tab==='overview')        renderCompanyOverview(ct, canAdd);
    else if (tab==='memos')      renderCompanyMemos(ct, isPresident() || currentRole==='manager'); // memos: managers are admins per firestore.rules + sidebar
    else if (tab==='policies')   renderCompanyPolicies(ct, canAdd);
    else if (tab==='downloads')  renderCompanyDownloads(ct, canAdd);
    else if (tab==='handbook')   renderCompanyHandbook(ct, canAdd);
    else if (tab==='bi-ops')     renderCompanyBiOps(ct);
  }
  window.bindChipTabs(c.querySelector('.company-tabs'), (key)=>switchCompanyTab(key));
  switchCompanyTab('overview');
}

// ── Company: The System (fka "BI Ops") ────────────
function renderCompanyBiOps(ct) {
  ct.innerHTML = `
    <div style="padding:16px 0">

      <!-- Hero -->
      <div style="display:flex;align-items:center;gap:18px;background:linear-gradient(135deg,#0a0e09 0%,#0d1510 100%);border:1px solid rgba(255,215,0,0.18);border-radius:16px;padding:20px 22px;margin-bottom:18px">
        <img src="icons/barro-industries.png" alt="Barro Industries" style="width:72px;height:72px;border-radius:14px;flex-shrink:0;object-fit:contain"/>
        <div>
          <div style="font-size:11px;font-weight:600;letter-spacing:2.5px;color:#B8860B;margin-bottom:4px">${escHtml((window.BRAND&&window.BRAND.fullName)||'Barro Industries Operating System')}</div>
          <div style="font-size:20px;font-weight:700;color:var(--white,#fff);line-height:1.2">Barro Industries</div>
          <!-- ‼️ FLAG FOR NEIL (v12 WS09) — this positioning copy ("Business Intelligence
               Operations Platform") is now false vs. the v12 vision (a full business-operating
               system, not a narrow BI/analytics tool). Needs new prose, not a string swap;
               left as-is pending a content pass. -->
          <div style="font-size:13px;color:#8a8070;margin-top:3px">Business Intelligence Operations Platform</div>
        </div>
      </div>

      <!-- About -->
      <div class="co-section">
        <h3 class="co-section-title">What is ${escHtml((window.BRAND&&window.BRAND.shortName)||'Barro Ops')}?</h3>
        <p class="co-body">
          <strong style="color:var(--gold)">${escHtml((window.BRAND&&window.BRAND.shortName)||'Barro Ops')}</strong> is Barro Industries' central operating system — a single platform for tasks, finance,
          production, and every department's day-to-day work. It transforms raw data into clear,
          actionable insights, giving every team member a single source of truth for company performance.
        </p>
      </div>

      <!-- Capabilities -->
      <div class="co-section">
        <h3 class="co-section-title">Core Capabilities</h3>
        <div class="co-biz-grid" style="grid-template-columns:1fr 1fr">
          <div class="co-value-card">
            <div class="co-value-icon" style="background:rgba(255,214,10,0.10)"><i data-lucide="layout-dashboard" style="width:20px;height:20px;stroke:var(--gold)"></i></div>
            <div class="co-value-name">Unified Dashboards</div>
            <div class="co-value-desc">Real-time KPIs, revenue metrics, and operational data across all departments in one view.</div>
          </div>
          <div class="co-value-card">
            <div class="co-value-icon" style="background:var(--info-soft)"><i data-lucide="link" style="width:20px;height:20px;stroke:var(--info)"></i></div>
            <div class="co-value-name">Data Integration</div>
            <div class="co-value-desc">Connects with existing tools and data sources without disrupting current workflows.</div>
          </div>
          <div class="co-value-card">
            <div class="co-value-icon" style="background:var(--success-soft)"><i data-lucide="zap" style="width:20px;height:20px;stroke:var(--success)"></i></div>
            <div class="co-value-name">Automated Reporting</div>
            <div class="co-value-desc">Scheduled reports and alerts surface critical information automatically — no manual pulls.</div>
          </div>
          <div class="co-value-card">
            <div class="co-value-icon" style="background:rgba(255,159,10,0.10)"><i data-lucide="search" style="width:20px;height:20px;stroke:#FF9F0A"></i></div>
            <div class="co-value-name">Deep Analytics</div>
            <div class="co-value-desc">Drill into trends, anomalies, and forecasts with tools built for both executives and staff.</div>
          </div>
        </div>
      </div>

      <!-- Platform -->
      <div class="co-section">
        <h3 class="co-section-title">Available On</h3>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
          ${[['smartphone','iOS','Mobile App'],['smartphone','Android','Mobile App'],['monitor','Desktop','Mac & Windows'],['globe','Web','Browser']].map(([icon,name,sub])=>`
            <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 10px;text-align:center">
              <i data-lucide="${icon}" style="width:22px;height:22px;stroke:var(--gold);margin-bottom:6px"></i>
              <div style="font-size:13px;font-weight:600;color:var(--text)">${name}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${sub}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Footer badge -->
      <div style="text-align:center;padding:14px 0 4px">
        <span style="font-size:10px;font-weight:600;letter-spacing:2px;color:#4a4035">Barro Industries · Operating System · 2026</span>
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [ct] });
}

// ── Company: Overview ─────────────────────────────
async function renderCompanyOverview(ct, canAdd) {
  // Fetch the president's profile by role — not by hardcoded email
  let photoURL = '';
  let presidentName = 'President';
  try {
    const presSnap = await db.collection('users').where('role','==','president').limit(1).get();
    if (!presSnap.empty) {
      const pd = presSnap.docs[0].data();
      photoURL     = pd.photoUrl || pd.photoURL || '';
      presidentName = pd.displayName || pd.email || presidentName;
    }
  } catch(e) { /* non-critical */ }
  const initials = 'NB';
  ct.innerHTML = `
    <!-- Hero Banner -->
    <div class="co-hero">
      <div class="co-hero-bg"></div>
      <img src="icons/barro-industries.png" class="co-hero-logo" alt="Barro Industries" onerror="this.style.display='none'"/>
      <div class="co-hero-text">
        <h1 class="co-hero-title">BARRO INDUSTRIES</h1>
        <p class="co-hero-tagline">Building the Future, Brick by Brick.</p>
      </div>
    </div>

    <!-- About -->
    <div class="co-section">
      <h3 class="co-section-title">About the Company</h3>
      <p class="co-body">
        <strong>Barro Industries OPC</strong> is a manufacturing company built on precision, quality, and a commitment to
        long-term growth. We design and produce products that meet the demands of today's market while laying the groundwork
        for tomorrow's innovations. Our ambition extends beyond current operations — with a clear direction toward research
        and development as we continue to scale and evolve.
      </p>
      <p class="co-body" style="margin-top:10px">
        Driven by a lean, capable team and a culture of accountability, Barro Industries OPC operates with the discipline
        of a company that builds for the long run — not just the next quarter.
      </p>
    </div>

    <!-- Trademark -->
    <div class="co-section">
      <h3 class="co-section-title">Our Brand</h3>
      <div class="co-biz-grid">
        <div class="co-biz-card">
          <img src="icons/barro-industries.png" class="co-biz-logo" alt="Barro Industries OPC" onerror="this.style.display='none'"/>
          <div class="co-biz-info">
            <div class="co-biz-name">Barro Industries OPC</div>
            <div class="co-biz-desc">The company. A manufacturing business focused on building quality products and systems, with a long-term vision toward research and development.</div>
            <span class="badge badge-gold">Company</span>
          </div>
        </div>
        <div class="co-biz-card">
          <img src="icons/barrokit.png" class="co-biz-logo" alt="Barro Kitchens" onerror="this.style.display='none'"/>
          <div class="co-biz-info">
            <div class="co-biz-name">Barro Kitchens™</div>
            <div class="co-biz-desc">A registered trademark of Barro Industries OPC. One-stop shop for kitchen design and build — from concept to completion, residential and commercial.</div>
            <span class="badge badge-blue">Trademark</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Vision -->
    <div class="co-section">
      <h3 class="co-section-title">Where We're Headed</h3>
      <div class="co-biz-grid" style="grid-template-columns:1fr 1fr">
        <div class="co-value-card">
          <div class="co-value-icon" style="background:rgba(255,214,10,0.12)"><i data-lucide="factory" style="width:20px;height:20px;stroke:var(--gold)"></i></div>
          <div class="co-value-name">Manufacturing</div>
          <div class="co-value-desc">Our foundation. We build with precision and hold our products to the highest standard.</div>
        </div>
        <div class="co-value-card">
          <div class="co-value-icon" style="background:var(--info-soft)"><i data-lucide="flask-conical" style="width:20px;height:20px;stroke:var(--info)"></i></div>
          <div class="co-value-name">R&amp;D (Future Direction)</div>
          <div class="co-value-desc">We are building toward a research and development capability — innovating products and processes for sustainable, scalable growth.</div>
        </div>
      </div>
    </div>

    <!-- President's Message -->
    <div class="co-section">
      <h3 class="co-section-title">Message from the President</h3>
      <div class="co-president-card">
        <div class="co-president-left">
          ${photoURL
            ? `<img src="${escHtml(photoURL)}" class="co-president-photo" alt="President"/>`
            : `<div class="co-president-initials">${initials}</div>`
          }
          <div class="co-president-name">${escHtml(presidentName)}</div>
          <div class="co-president-title">President<br>Barro Industries</div>
        </div>
        <div class="co-president-msg">
          <div class="co-quote-mark">"</div>
          <p>
            Every business we build, every team we grow, and every decision we make is driven by one
            conviction: that we are here to create something that lasts. Barro Industries was not built
            overnight, and it will not stop growing anytime soon.
          </p>
          <p>
            To every member of this team — your work matters. Each task you complete, each client you
            serve, and each day you show up is a brick in the foundation of something bigger than any
            one of us. I ask you to bring your best, stay accountable, and take ownership of your role
            in this company's story.
          </p>
          <p>
            To our partners — thank you for trusting us. Our relationship is built on quality and
            reliability, and we intend to keep it that way.
          </p>
          <p style="margin-top:16px;font-style:normal;font-weight:600;color:var(--gold)">
            — Building the Future, Brick by Brick.
          </p>
        </div>
      </div>
    </div>

    <!-- Core Values -->
    <div class="co-section">
      <h3 class="co-section-title">Our Core Values</h3>
      <div class="co-values-grid">
        <div class="co-value-card">
          <div class="co-value-icon" style="background:rgba(255,214,10,0.12)"><i data-lucide="star" style="width:20px;height:20px;stroke:var(--gold)"></i></div>
          <div class="co-value-name">Excellence</div>
          <div class="co-value-desc">We do not settle for good enough. Every output is a reflection of our brand.</div>
        </div>
        <div class="co-value-card">
          <div class="co-value-icon" style="background:rgba(52,199,89,0.10)"><i data-lucide="shield-check" style="width:20px;height:20px;stroke:#34C759"></i></div>
          <div class="co-value-name">Integrity</div>
          <div class="co-value-desc">We operate with transparency and do what we say we will do.</div>
        </div>
        <div class="co-value-card">
          <div class="co-value-icon" style="background:var(--info-soft)"><i data-lucide="users" style="width:20px;height:20px;stroke:var(--info)"></i></div>
          <div class="co-value-name">People First</div>
          <div class="co-value-desc">Our team and our clients are at the center of every decision we make.</div>
        </div>
        <div class="co-value-card">
          <div class="co-value-icon" style="background:rgba(255,149,0,0.10)"><i data-lucide="trending-up" style="width:20px;height:20px;stroke:#FF9500"></i></div>
          <div class="co-value-name">Growth</div>
          <div class="co-value-desc">We invest in continuous improvement — for the business and for each individual.</div>
        </div>
      </div>
    </div>

    <!-- System Credit -->
    <div class="co-section">
      <div class="co-credit-card">
        <div class="co-credit-icon"><i data-lucide="code-2" style="width:18px;height:18px;stroke:var(--primary-light)"></i></div>
        <div class="co-credit-body">
          <div class="co-credit-title">Operations System</div>
          <div class="co-credit-sub">Developed by <strong>Neil Barro</strong> &nbsp;·&nbsp; v${window.APP_VERSION||'9.4'}</div>
          <div class="co-credit-note">Internal platform for operations, attendance, KPIs, finance, and team management.</div>
        </div>
      </div>
    </div>

    ${canAdd ? `
    <!-- Admin Controls -->
    <div class="co-section">
      <h3 class="co-section-title">${emojiIcon('⚙️',20)} Admin Controls</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn-danger" id="co-force-logout-btn" style="display:flex;align-items:center;gap:6px">
          <i data-lucide="log-out" style="width:15px;height:15px;stroke:currentColor"></i> Force Logout All Members
        </button>
      </div>
      <p style="font-size:12px;color:var(--text-muted);margin-top:8px">Immediately signs out all active sessions. Use during security incidents or system updates.</p>
    </div>` : ''}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [ct] });
  if (canAdd) {
    document.getElementById('co-force-logout-btn')?.addEventListener('click', async () => {
      if (!await confirmDialog({ message: 'This will immediately sign out ALL active members. Continue?', danger: true })) return;
      await db.collection('settings').doc('system').set({
        forceLogoutAt: firebase.firestore.FieldValue.serverTimestamp(),
        excludeUid: currentUser.uid,
        triggeredBy: currentUser.uid
      }, { merge: true });
      Notifs.showToast('All members have been logged out.', 'success');
    });
  }
  if (window.lucide) lucide.createIcons({ nodes: [ct] });
}

// ── Company: Memos ────────────────────────────────
// Memos support optional "conforme" — tagged recipients must tick an
// acknowledgment ("I have read and agree") which is recorded with a timestamp.
// Storage on each memo doc:
//   recipients:     [uid, …]          — who must conforme
//   recipientNames: { uid: name }     — cached names for the tracker
//   conformes:      { uid: {at, name} }  — who has acknowledged + when
// A tagged recipient can write ONLY their own conformes[uid] entry (firestore.rules).
async function renderCompanyMemos(ct, canAdd) {
  ct.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-size:13px;color:var(--text-muted)">Official memos from management</div>
      ${canAdd?`<button class="btn-primary btn-sm" id="add-memo-btn">+ New Memo</button>`:''}
    </div>
    <div id="memos-list">${window.skeletonHtml('rows')}</div>
  `;
  const me = currentUser?.uid;
  const snap = await db.collection('memos').orderBy('createdAt','desc').get().catch(()=>({docs:[],empty:true}));
  const memos = snap.docs.map(d=>({id:d.id,...d.data()}));
  const list = document.getElementById('memos-list');

  // Derive conforme state for a memo relative to the current user.
  const conformeMeta = (m) => {
    const recips = Array.isArray(m.recipients) ? m.recipients : [];
    const conformes = m.conformes || {};
    return {
      recips, conformes,
      total: recips.length,
      done:  recips.filter(uid => conformes[uid]).length,
      iAmRecipient: recips.includes(me),
      iConformed:   !!conformes[me]
    };
  };
  const conformeDate = (entry) => {
    const d = entry?.at?.toDate ? entry.at.toDate() : null;
    return d ? d.toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'}) : '';
  };
  // Status chip shown on a memo card.
  const statusChip = (m) => {
    const cm = conformeMeta(m);
    if (cm.iAmRecipient && !cm.iConformed) return `<span class="badge badge-orange" style="white-space:nowrap">${emojiIcon('⚠',16)} Conforme needed</span>`;
    if (cm.iAmRecipient && cm.iConformed)  return `<span class="badge badge-green" style="white-space:nowrap">${emojiIcon('✓',16)} Conformed</span>`;
    if (canAdd && cm.total)                return `<span class="badge ${cm.done>=cm.total?'badge-green':'badge-blue'}" style="white-space:nowrap">${cm.done}/${cm.total} conformed</span>`;
    return '';
  };

  if (!memos.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('📋',44)}</div><h4>No memos yet</h4><p>Management memos will appear here.</p></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [list] });
  } else {
    list.innerHTML = memos.map(m=>{
      const d = m.createdAt?.toDate ? m.createdAt.toDate() : new Date();
      const chip = statusChip(m);
      return `<div class="co-doc-card" data-id="${m.id}">
        <div class="co-doc-icon" style="background:var(--info-soft)"><i data-lucide="file-text" style="width:18px;height:18px;stroke:var(--info)"></i></div>
        <div class="co-doc-body">
          <div class="co-doc-title">${escHtml(m.title)} ${chip}</div>
          <div class="co-doc-meta">From: ${escHtml(m.from||'Management')} &nbsp;·&nbsp; ${d.toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'})}</div>
          <div class="co-doc-preview">${escHtml((m.content||'').slice(0,120))}${m.content?.length>120?'…':''}</div>
        </div>
        ${canAdd?`<button class="btn-icon co-del-btn" data-id="${m.id}" title="Delete" aria-label="Delete memo"><i data-lucide="trash-2" style="width:14px;height:14px;stroke:var(--danger)"></i></button>`:''}
      </div>`;
    }).join('');
    list.querySelectorAll('.co-doc-card').forEach(card=>{
      card.addEventListener('click', e=>{
        if(e.target.closest('.co-del-btn')) return;
        openMemoDetail(memos.find(x=>x.id===card.dataset.id));
      });
    });
    list.querySelectorAll('.co-del-btn').forEach(btn=>{
      btn.addEventListener('click',async e=>{e.stopPropagation();if(await confirmDialog({message:'Delete this memo?', danger:true})){await window.deleteMemo(btn.dataset.id);renderCompanyMemos(ct,canAdd);}});
    });
    if(window.lucide) lucide.createIcons({nodes:[list]});
  }

  // ── Detail modal — delegates to the standalone opener so the General Posts
  // feed's memo mirror cards can open + acknowledge a memo from anywhere.
  // Refresh this list after a conforme / delete. ──
  function openMemoDetail(m) {
    openMemoDetailModal(m, () => renderCompanyMemos(ct, canAdd));
  }

  // ── Create modal ──
  document.getElementById('add-memo-btn')?.addEventListener('click',()=>{
    openPage('New Memo',`
      <div class="form-group"><label>Memo Title</label><input id="memo-title" placeholder="e.g. Updated Leave Policy"/></div>
      <div class="form-group"><label>From</label><input id="memo-from" placeholder="Management / HR / Finance" value="${escHtml(currentUser?.displayName||'Management')}"/></div>
      <div class="form-group"><label>Content</label><textarea id="memo-content" rows="7" placeholder="Write the memo here…"></textarea></div>
      <div class="form-group">
        <label>Require Conforme From <span style="font-weight:400;color:var(--text-muted)">(tag people)</span></label>
        <input id="memo-recip-search" placeholder="Search name…" style="margin-bottom:6px"/>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span id="memo-recip-count" style="font-size:11px;color:var(--text-muted)">No one tagged</span>
          <button type="button" class="btn-link" id="memo-recip-toggle" style="font-size:11px;background:none;border:none;color:var(--primary,#0A84FF);cursor:pointer;padding:0">Select all</button>
        </div>
        <div id="memo-recip-list" style="max-height:190px;overflow:auto;border:1.5px solid var(--border);border-radius:8px;padding:6px;background:var(--surface)"><div style="padding:10px">${window.skeletonHtml('rows')}</div></div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:6px">Tagged people get a notification and must tick “I agree (Conforme)”. Leave empty for an information-only memo.</div>
      </div>
      <div id="memo-file-upload"></div>
    `,`<button class="btn-primary" id="save-memo-btn">Publish Memo</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    let uploadedFile=null;
    Drive.renderUploadArea('memo-file-upload',r=>{uploadedFile=r;},{label:'Attach document (optional)',dept:'Admin',subfolder:'Memos'});

    // Populate the recipient picker.
    const selected = new Set();
    let people = [];
    const listEl  = document.getElementById('memo-recip-list');
    const countEl = document.getElementById('memo-recip-count');
    const updateCount = () => { countEl.textContent = selected.size ? `${selected.size} tagged — must give conforme` : 'No one tagged'; };
    const paintList = (filter='') => {
      const q = filter.trim().toLowerCase();
      const rows = people.filter(u => !q || (u.name||'').toLowerCase().includes(q) || (u.role||'').toLowerCase().includes(q));
      listEl.innerHTML = rows.length ? rows.map(u => `
        <label style="display:flex;gap:9px;align-items:center;padding:6px 4px;font-size:13px;cursor:pointer;border-radius:6px">
          <input type="checkbox" class="memo-recip-chk" data-uid="${u.id}" ${selected.has(u.id)?'checked':''} style="width:16px;height:16px;cursor:pointer"/>
          <span>${escHtml(u.name)} <span style="color:var(--text-muted);font-size:11px">· ${escHtml(u.role||'')}</span></span>
        </label>`).join('') : `<div style="font-size:12px;color:var(--text-muted);padding:8px">No matches</div>`;
      listEl.querySelectorAll('.memo-recip-chk').forEach(chk => chk.addEventListener('change', () => {
        if (chk.checked) selected.add(chk.dataset.uid); else selected.delete(chk.dataset.uid);
        updateCount();
      }));
    };
    (async () => {
      try {
        const snap = typeof dbCachedGet==='function'
          ? await dbCachedGet('users', () => db.collection('users').get(), 30000)
          : await db.collection('users').get();
        people = snap.docs.map(d=>({id:d.id, ...d.data()}))
          // Internal staff only — external partners and Brilliant-Steel-only users
          // have no Memos nav entry, so don't tag them for conforme here.
          .filter(u => u.id !== me && u.role !== 'partner'
            && !(Array.isArray(u.departments) && u.departments.length===1 && u.departments[0]==='Brilliant Steel'))
          .map(u => ({ id:u.id, name:u.displayName||u.email||'Unknown', role:(window.ROLES?.[u.role]?.label)||u.role||'' }))
          .sort((a,b)=>a.name.localeCompare(b.name));
        paintList();
      } catch(err) { listEl.innerHTML = `<div style="font-size:12px;color:var(--danger);padding:8px">Could not load people: ${escHtml(err.message)}</div>`; }
    })();
    document.getElementById('memo-recip-search').addEventListener('input', e => paintList(e.target.value));
    document.getElementById('memo-recip-toggle').addEventListener('click', () => {
      const visible = people.filter(u => { const q=document.getElementById('memo-recip-search').value.trim().toLowerCase(); return !q || (u.name||'').toLowerCase().includes(q) || (u.role||'').toLowerCase().includes(q); });
      const allOn = visible.length && visible.every(u => selected.has(u.id));
      visible.forEach(u => allOn ? selected.delete(u.id) : selected.add(u.id));
      updateCount();
      paintList(document.getElementById('memo-recip-search').value);
    });

    document.getElementById('save-memo-btn').addEventListener('click',async()=>{
      const title=document.getElementById('memo-title').value.trim();
      if(!title) { Notifs.showToast('Memo title required','error'); return; }
      const from    = document.getElementById('memo-from').value.trim();
      const content = document.getElementById('memo-content').value;
      const recipients = [...selected];
      const recipientNames = {};
      recipients.forEach(uid => { const p = people.find(x=>x.id===uid); recipientNames[uid] = p ? p.name : uid; });
      const saveBtn = document.getElementById('save-memo-btn');
      saveBtn.disabled = true; saveBtn.textContent = 'Publishing…';
      try {
        const memoRef = await db.collection('memos').add({
          title,
          from,
          content,
          fileUrl: uploadedFile?.url||null,
          recipients,
          recipientNames,
          requireConforme: recipients.length>0,
          conformes: {},
          addedBy: currentUser.uid,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // Surface the memo in the General Posts feed as a click-to-open mirror
        // card so staff don't miss it on the separate Memos tab. Internal-only:
        // partners only ever load the "Partners" feed sub-tab, never "General",
        // so they never see this. The card links back to the memo (conforme is
        // given there); tagged recipients are already notified below, so the
        // mirror itself is silent — no all-staff broadcast.
        try {
          await db.collection('posts').add({
            dept:        'General',
            status:      'published',
            kind:        'memo',
            memoId:      memoRef.id,
            title,
            content:     (content || '').slice(0, 500),
            authorId:    currentUser.uid,
            authorName:  from || userProfile?.displayName || 'Management',
            authorPhoto: null,
            pinned:      false,
            hearts:      [],
            createdAt:   firebase.firestore.FieldValue.serverTimestamp()
          });
        } catch(_) {}
        // Notify each tagged recipient that their conforme is requested.
        if (recipients.length) {
          const issuer = userProfile?.displayName || 'Management';
          await Promise.all(recipients.map(uid =>
            Notifs.send(uid, { title:'📋 Memo needs your conforme', body:`${issuer}: ${title}`, icon:'📋', type:'memo' }).catch(()=>{})
          ));
        }
        closeModal();
        Notifs.success(recipients.length ? `Memo published — ${recipients.length} tagged for conforme.` : 'Memo published.');
        renderCompanyMemos(ct,canAdd);
      } catch(err) {
        saveBtn.disabled = false; saveBtn.textContent = 'Publish Memo';
        Notifs.showToast('Could not publish: '+err.message, 'error');
      }
    });
  });
  if(window.lucide) lucide.createIcons({nodes:[ct]});
}

// ── Memo detail modal (standalone) ────────────────
// Self-contained so a memo can be opened + acknowledged from anywhere — the
// Company → Memos list AND the General Posts feed's memo mirror cards. `onChange`
// (optional) refreshes whatever view launched it after a conforme or delete.
function openMemoDetailModal(m, onChange) {
  if (!m) return;
  const me = currentUser?.uid;
  const canAdd = isPresident() || currentRole === 'manager';
  const recips = Array.isArray(m.recipients) ? m.recipients : [];
  const conformes = m.conformes || {};
  const cm = {
    recips, conformes,
    total: recips.length,
    done:  recips.filter(uid => conformes[uid]).length,
    iAmRecipient: recips.includes(me),
    iConformed:   !!conformes[me]
  };
  const conformeDate = (entry) => {
    const dd = entry?.at?.toDate ? entry.at.toDate() : null;
    return dd ? dd.toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'}) : '';
  };
  const d = m.createdAt?.toDate ? m.createdAt.toDate() : new Date();
  const names = m.recipientNames || {};
  // Only render the attachment link if it resolves to a real http(s) URL —
  // never trust the stored value as a raw href (blocks javascript:/data: XSS).
  const memoFile = (typeof safeHttpUrl==='function') ? safeHttpUrl(m.fileUrl) : (/^https?:\/\//i.test(m.fileUrl||'') ? m.fileUrl : '');

  // Conforme block — the action for a tagged recipient, or the status note.
  let conformeBlock = '';
  if (cm.iAmRecipient) {
    if (cm.iConformed) {
      conformeBlock = `<div style="margin-top:16px;padding:12px 14px;border-radius:10px;background:rgba(52,199,89,0.10);border:1px solid rgba(52,199,89,0.35);font-size:13px;color:var(--text-2)">
        ${emojiIcon('✓',16)} You gave your conforme${conformeDate(cm.conformes[me])?` on <b>${conformeDate(cm.conformes[me])}</b>`:''}.</div>`;
    } else {
      conformeBlock = `<div style="margin-top:16px;padding:14px;border-radius:10px;background:rgba(255,159,10,0.08);border:1px solid rgba(255,159,10,0.35)">
        <label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer;font-size:13px;line-height:1.5;color:var(--text)">
          <input type="checkbox" id="memo-conforme-chk" style="margin-top:2px;width:18px;height:18px;flex-shrink:0;cursor:pointer"/>
          <span><b>Conforme.</b> I have read and understood this memo and signify my agreement.</span>
        </label>
        <button class="btn-primary" id="memo-conforme-btn" disabled style="margin-top:12px;opacity:.55">Submit Conforme</button>
      </div>`;
    }
  }

  // Tracker — visible to admins / the author. Who has acknowledged, who's pending.
  let trackerBlock = '';
  if (canAdd && cm.total) {
    const rows = cm.recips.map(uid => {
      const nm = escHtml(names[uid] || uid);
      const entry = cm.conformes[uid];
      return entry
        ? `<div style="display:flex;justify-content:space-between;gap:10px;font-size:12.5px;padding:5px 0"><span>${nm}</span><span style="color:var(--success,#34C759);white-space:nowrap">${emojiIcon('✓',16)} ${escHtml(conformeDate(entry)||'Conformed')}</span></div>`
        : `<div style="display:flex;justify-content:space-between;gap:10px;font-size:12.5px;padding:5px 0"><span>${nm}</span><span style="color:var(--text-muted);white-space:nowrap">Pending</span></div>`;
    }).join('');
    trackerBlock = `<hr class="divider"/>
      <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:4px">Conforme tracker · ${cm.done}/${cm.total}</div>
      ${rows}`;
  }

  // v14 Batch5 A3 — memo detail/conforme-tracker: detail+history content, CONVERT.
  // All ids referenced below (memo-conforme-chk/-btn, del-memo-btn) are queried
  // via document.getElementById, which is document-scoped — no dependency on
  // the old #modal-body singleton, so this is a same-signature swap.
  openPage(m.title,`
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">From: ${escHtml(m.from||'Management')} &nbsp;·&nbsp; ${d.toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'})}</div>
    <p style="font-size:14px;line-height:1.8;white-space:pre-wrap;color:var(--text-2)">${escHtml(m.content||'')}</p>
    ${memoFile?`<a href="${escHtml(memoFile)}" target="_blank" rel="noopener noreferrer" class="btn-secondary" style="display:inline-block;margin-top:14px">${emojiIcon('📎',16)} Open Attachment</a>`:''}
    ${conformeBlock}
    ${trackerBlock}
    ${canAdd?`<hr class="divider"/><button class="btn-danger" id="del-memo-btn" data-id="${m.id}">Delete Memo</button>`:''}
  `);

  // Wire the conforme checkbox → enable submit → record acknowledgment.
  const chk = document.getElementById('memo-conforme-chk');
  const btn = document.getElementById('memo-conforme-btn');
  if (chk && btn) {
    chk.addEventListener('change', () => {
      btn.disabled = !chk.checked;
      btn.style.opacity = chk.checked ? '1' : '.55';
    });
    btn.addEventListener('click', async () => {
      if (!chk.checked) return;
      btn.disabled = true; btn.textContent = 'Submitting…';
      const myName = userProfile?.displayName || currentUser?.email || 'Unknown';
      try {
        await db.collection('memos').doc(m.id).update({
          ['conformes.'+me]: { at: firebase.firestore.FieldValue.serverTimestamp(), name: myName }
        });
        // Let the issuer know an acknowledgment came in (best-effort).
        if (m.addedBy && m.addedBy !== me) {
          try { await Notifs.send(m.addedBy, { title:'Conforme received', body:`${myName} acknowledged: ${m.title}`, icon:'✅', type:'memo' }); } catch(_) {}
        }
        Notifs.success('Conforme recorded — thank you.');
        closeModal();
        onChange?.();
      } catch(err) {
        btn.disabled = false; btn.textContent = 'Submit Conforme';
        Notifs.showToast('Could not record conforme: '+err.message, 'error');
      }
    });
  }
  document.getElementById('del-memo-btn')?.addEventListener('click',async e2=>{if(await confirmDialog({message:'Delete this memo?', danger:true})){await window.deleteMemo(e2.currentTarget.dataset.id);closeModal();onChange?.();}});
}
window.openMemoDetailModal = openMemoDetailModal;

// Open a memo by id (fetches the doc, then shows its detail modal). Entry point
// for the General Posts feed's memo mirror cards.
window.openMemoById = async function(memoId, onChange) {
  if (!memoId) return;
  try {
    const doc = await db.collection('memos').doc(memoId).get();
    if (!doc.exists) { Notifs.showToast('This memo is no longer available.', 'error'); onChange?.(); return; }
    openMemoDetailModal({ id: doc.id, ...doc.data() }, onChange);
  } catch(err) {
    Notifs.showToast('Could not open memo: '+err.message, 'error');
  }
};

// Delete a memo AND any General-feed mirror cards that point at it, so removing
// a memo never leaves a dangling "memo no longer available" card in Posts.
window.deleteMemo = async function(memoId) {
  await db.collection('memos').doc(memoId).delete();
  try {
    const mir = await db.collection('posts').where('memoId','==',memoId).get();
    await Promise.all(mir.docs.map(docu => docu.ref.delete()));
  } catch(_) {}
};

// Standalone Memos route — renders the same memos UI into the full page so
// notification deep-links and the sidebar item can reach it directly (not only
// via the Company → Memos tab).
async function renderMemosPage() {
  const c = document.getElementById('page-content');
  c.innerHTML = `<div class="page-header"><h2>${emojiIcon('📋',20)} Memos</h2></div><div id="memos-page-host"></div>`;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  renderCompanyMemos(document.getElementById('memos-page-host'), isPresident() || currentRole==='manager' || currentRole==='secretary');
}
window.renderMemosPage = renderMemosPage;

// ── Company: Policies ─────────────────────────────
async function renderCompanyPolicies(ct, canAdd) {
  ct.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-size:13px;color:var(--text-muted)">Company rules, regulations, and official policies</div>
      ${canAdd?`<button class="btn-primary btn-sm" id="add-policy-btn">+ Add Policy</button>`:''}
    </div>
    <div class="policy-grid" id="policy-grid">${window.skeletonHtml('cards')}</div>
  `;
  const snap = await db.collection('policies').orderBy('createdAt','desc').get().catch(()=>({docs:[],empty:true}));
  const policies = snap.docs.map(d=>({id:d.id,...d.data()}));
  const grid = document.getElementById('policy-grid');
  if (!policies.length) {
    grid.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">${emojiIcon('📄',44)}</div><h4>No policies yet</h4><p>Add company policies and they'll appear here.</p></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [grid] });
  } else {
    grid.innerHTML = policies.map(p=>`
      <div class="policy-card" data-id="${p.id}">
        <div class="policy-icon">${p.icon||`${emojiIcon('📄',16)}`}</div>
        <div class="policy-title">${escHtml(p.title)}</div>
        <div class="policy-desc">${escHtml(p.description||'')}</div>
        ${p.fileUrl?`<a href="${(typeof safeHttpUrl==='function')?safeHttpUrl(p.fileUrl):p.fileUrl}" target="_blank" rel="noopener noreferrer" class="btn-link" style="font-size:12px;margin-top:6px;display:block">${emojiIcon('📎',12)} View Document</a>`:''}
      </div>`).join('');
    if (window.lucide) lucide.createIcons({ nodes: [grid] });
    grid.querySelectorAll('.policy-card').forEach(card=>{
      card.addEventListener('click',e=>{
        if(e.target.tagName==='A') return;
        const p=policies.find(x=>x.id===card.dataset.id);
        // v14 Batch5 A3 — policy detail view: CONVERT (detail content). del-policy-btn
        // is looked up via document.getElementById, unaffected by the container swap.
        openPage(p.title,`<p style="font-size:14px;line-height:1.7;white-space:pre-wrap;color:var(--text-2)">${escHtml(p.content||'No content.')}</p>${p.fileUrl?`<a href="${(typeof safeHttpUrl==='function')?safeHttpUrl(p.fileUrl):p.fileUrl}" target="_blank" rel="noopener noreferrer" class="btn-secondary" style="display:inline-block;margin-top:14px">${emojiIcon('📎',16)} Open File</a>`:''}${canAdd?`<hr class="divider"/><button class="btn-danger" id="del-policy-btn" data-id="${p.id}">Delete</button>`:''}`);
        document.getElementById('del-policy-btn')?.addEventListener('click',async e2=>{if(await confirmDialog({message:'Delete this policy?', danger:true})){await db.collection('policies').doc(e2.currentTarget.dataset.id).delete();closeModal();renderCompanyPolicies(ct,canAdd);}});
      });
    });
  }
  document.getElementById('add-policy-btn')?.addEventListener('click',()=>{
    openPage('Add Policy',`
      <div class="form-group"><label>Title</label><input id="pol-title"/></div>
      <div class="form-group"><label>Icon</label><input id="pol-icon" placeholder="📄" maxlength="4"/></div>
      <div class="form-group"><label>Short Description</label><input id="pol-desc"/></div>
      <div class="form-group"><label>Full Content</label><textarea id="pol-content" rows="6"></textarea></div>
      <div id="pol-file-upload"></div>
    `,`<button class="btn-primary" id="save-pol-btn">Save Policy</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    let uploadedFile=null;
    Drive.renderUploadArea('pol-file-upload',r=>{uploadedFile=r;},{label:'Attach document',dept:'Admin',subfolder:'Policies'});
    document.getElementById('save-pol-btn').addEventListener('click',async()=>{
      const title=document.getElementById('pol-title').value.trim(); if(!title) return;
      await db.collection('policies').add({title,icon:document.getElementById('pol-icon').value.trim()||`${emojiIcon('📄',16)}`,description:document.getElementById('pol-desc').value.trim(),content:document.getElementById('pol-content').value,fileUrl:uploadedFile?.url||null,addedBy:currentUser.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      closeModal(); renderCompanyPolicies(ct,canAdd);
    });
  });
}

// ── Company: Downloads ────────────────────────────
async function renderCompanyDownloads(ct, canAdd) {
  ct.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-size:13px;color:var(--text-muted)">Forms, templates, and official documents for download</div>
      ${canAdd?`<button class="btn-primary btn-sm" id="add-dl-btn">+ Upload Resource</button>`:''}
    </div>
    <div id="downloads-list">${window.skeletonHtml('rows')}</div>
  `;
  const snap = await db.collection('resources').orderBy('createdAt','desc').get().catch(()=>({docs:[],empty:true}));
  const docs = snap.docs.map(d=>({id:d.id,...d.data()}));
  const list = document.getElementById('downloads-list');

  const catIcons = { Forms:'file-plus', Templates:'layout-template', Reports:'bar-chart-2', Others:'folder' };
  const catColors = { Forms:'#34C759', Templates:'#0A84FF', Reports:'#FF9500', Others:'#9e9e9e' };

  if (!docs.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('📥',44)}</div><h4>No downloads yet</h4><p>Upload forms, templates, and documents for the team.</p></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [list] });
  } else {
    // Group by category
    const cats = [...new Set(docs.map(d=>d.category||'Others'))];
    list.innerHTML = cats.map(cat=>{
      const items = docs.filter(d=>(d.category||'Others')===cat);
      const icon = catIcons[cat]||'folder';
      const color = catColors[cat]||'#9e9e9e';
      return `<div style="margin-bottom:20px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:10px">${escHtml(cat)}</div>
        ${items.map(d=>`
          <a href="${(typeof safeHttpUrl==='function')?(safeHttpUrl(d.fileUrl)||'#'):(d.fileUrl||'#')}" target="_blank" rel="noopener noreferrer" class="co-dl-row" data-id="${d.id}">
            <div class="co-dl-icon" style="background:${color}18"><i data-lucide="${icon}" style="width:16px;height:16px;stroke:${color}"></i></div>
            <div class="co-dl-info">
              <div class="co-dl-name">${escHtml(d.title)}</div>
              <div class="co-dl-desc">${escHtml(d.description||'')}</div>
            </div>
            <i data-lucide="download" style="width:16px;height:16px;stroke:var(--text-muted);flex-shrink:0"></i>
            ${canAdd?`<button class="btn-icon co-del-btn" data-id="${d.id}" style="margin-left:4px" title="Delete" aria-label="Delete download"><i data-lucide="trash-2" style="width:13px;height:13px;stroke:var(--danger)"></i></button>`:''}
          </a>`).join('')}
      </div>`;
    }).join('');
    list.querySelectorAll('.co-del-btn').forEach(btn=>{
      btn.addEventListener('click',async e=>{e.preventDefault();e.stopPropagation();if(await confirmDialog({message:'Remove this resource?', danger:true})){await db.collection('resources').doc(btn.dataset.id).delete();renderCompanyDownloads(ct,canAdd);}});
    });
  }
  if(window.lucide) lucide.createIcons({nodes:[list]});

  document.getElementById('add-dl-btn')?.addEventListener('click',()=>{
    openPage('Upload Resource',`
      <div class="form-group"><label>Title</label><input id="dl-title" placeholder="e.g. Daily Time Record Form"/></div>
      <div class="form-group"><label>Category</label>
        <select id="dl-cat"><option value="Forms">Forms</option><option value="Templates">Templates</option><option value="Reports">Reports</option><option value="Others">Others</option></select>
      </div>
      <div class="form-group"><label>Description (optional)</label><input id="dl-desc" placeholder="Short description"/></div>
      <div id="dl-file-upload"></div>
    `,`<button class="btn-primary" id="save-dl-btn">Upload</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    let uploadedFile=null;
    Drive.renderUploadArea('dl-file-upload',r=>{uploadedFile=r;},{label:'Select file to upload',dept:'Admin',subfolder:'Resources'});
    document.getElementById('save-dl-btn').addEventListener('click',async()=>{
      const title=document.getElementById('dl-title').value.trim(); if(!title||!uploadedFile) return;
      await db.collection('resources').add({title,category:document.getElementById('dl-cat').value,description:document.getElementById('dl-desc').value.trim(),fileUrl:uploadedFile.url,source:uploadedFile.source,addedBy:currentUser.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      closeModal(); renderCompanyDownloads(ct,canAdd);
    });
  });
}

// ── Company: Handbook ─────────────────────────────
async function renderCompanyHandbook(ct, canAdd) {
  // Try to load a custom handbook from Firestore; fall back to built-in default
  const snap = await db.collection('handbook').orderBy('order','asc').get().catch(()=>({docs:[]}));
  const sections = snap.docs.map(d=>({id:d.id,...d.data()}));

  const defaultSections = [
    { title:'Welcome to Barro Industries', icon:'home', content:`You are now part of a team committed to building something great. At Barro Industries, we believe that people are our most important asset. This handbook is your guide to understanding how we work, what we expect, and how we take care of each other.\n\nRead it thoroughly. Keep it as a reference. And if you ever have questions, your manager is always the first point of contact.` },
    { title:'Work Hours & Attendance', icon:'clock', content:`Office hours are Monday to Friday, 8:00 AM – 5:00 PM, unless otherwise stated by your department head.\n\n• Full Day: 8 hours of work, logged in the Operations System.\n• Half Day: 4 hours, also logged in the system.\n• Overtime must be pre-approved by your manager.\n• Attendance is logged daily through the Operations app — this affects your KPI score.\n• Three unexcused absences in a month will be reviewed by HR.` },
    { title:'Code of Conduct', icon:'shield-check', content:`All employees are expected to:\n\n• Treat every colleague, client, and partner with respect.\n• Maintain confidentiality of company information.\n• Avoid conflicts of interest and disclose any that arise.\n• Use company resources responsibly and only for work purposes.\n• Report any unethical behavior to your manager immediately.\n\nViolations of this code may result in disciplinary action up to and including termination.` },
    { title:'Performance & KPI', icon:'trending-up', content:`Your performance is evaluated monthly using the KPI system:\n\n• Task Score (70%) — based on tasks completed vs assigned.\n• Deliverable Score (30%) — quality assessment set by the president.\n\nKPI scores affect your monthly final pay. Employees with consistently high KPI scores are prioritized for salary increases and promotions.\n\nKPI results are visible in the Operations System under Personal Finance.` },
    { title:'Salary & Benefits', icon:'credit-card', content:`Salary is processed monthly. Your payslip breakdown is available in the app under Personal Finance:\n\n• Base Salary — your fixed monthly rate.\n• Allowances — transportation, meal, or other allowances as applicable.\n• Deductions — SSS, PhilHealth, Pag-IBIG, withholding tax.\n• KPI Adjustment — bonus or adjustment based on your monthly KPI score.\n• Final Pay — your take-home amount.\n\nYear-to-Date (YTD) totals are visible in the app.` },
    { title:'Leave Policy', icon:'calendar', content:`Employees are entitled to:\n\n• Vacation Leave: 15 days per year (prorated for new hires)\n• Sick Leave: 15 days per year\n• Special Leave as required by law (maternity, paternity, solo parent, etc.)\n\nLeave requests must be filed at least 2 business days in advance except for emergencies. Submit leave requests through your manager. Unused vacation leave may be converted to cash at year-end subject to company guidelines.` },
    { title:'Cash Advance Policy', icon:'banknote', content:`Employees may request a cash advance through the Operations System.\n\n• Maximum CA is 50% of monthly net salary.\n• Must specify repayment date (typically deducted from next salary).\n• Requires management approval before disbursement.\n• Only one active CA per employee at a time.\n• Repeated CAs without full repayment may be declined.\n\nSubmit requests through Personal Finance → Cash Advance in the app.` },
    { title:'Confidentiality', icon:'lock', content:`All company information — client data, financial records, pricing, strategies, and internal communications — is confidential.\n\n• Do not share internal information with unauthorized parties.\n• Do not discuss client projects on personal social media.\n• Confidentiality obligations continue even after employment ends.\n\nViolation of this policy is grounds for immediate termination and may result in legal action.` },
  ];

  const displaySections = sections.length ? sections : defaultSections;
  ct.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
      <div style="font-size:13px;color:var(--text-muted)">Employee Handbook — policies, conduct, and benefits</div>
      ${canAdd?`<button class="btn-secondary btn-sm" id="add-handbook-btn">+ Add Section</button>`:''}
    </div>
    <div class="handbook-accordion" id="handbook-content">
      ${displaySections.map((s,i)=>`
        <div class="handbook-item" data-idx="${i}">
          <button class="handbook-header">
            <div style="display:flex;align-items:center;gap:10px">
              <div class="handbook-icon"><i data-lucide="${escHtml(s.icon||'file-text')}" style="width:15px;height:15px;stroke:var(--gold)"></i></div>
              <span>${escHtml(s.title)}</span>
            </div>
            <i data-lucide="chevron-down" class="handbook-chevron" style="width:16px;height:16px;stroke:var(--text-muted)"></i>
          </button>
          <div class="handbook-body hidden"><pre class="handbook-text">${escHtml(s.content||'')}</pre></div>
        </div>
      `).join('')}
    </div>
  `;
  ct.querySelectorAll('.handbook-header').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const item=btn.closest('.handbook-item');
      const body=item.querySelector('.handbook-body');
      const chev=item.querySelector('.handbook-chevron');
      const open=!body.classList.contains('hidden');
      body.classList.toggle('hidden',open);
      chev.style.transform=open?'':'rotate(180deg)';
    });
  });
  if(window.lucide) lucide.createIcons({nodes:[ct]});

  document.getElementById('add-handbook-btn')?.addEventListener('click',()=>{
    openPage('Add Handbook Section',`
      <div class="form-group"><label>Section Title</label><input id="hb-title"/></div>
      <div class="form-group"><label>Icon (Lucide name)</label><input id="hb-icon" placeholder="e.g. file-text, clock, shield-check" value="file-text"/></div>
      <div class="form-group"><label>Content</label><textarea id="hb-content" rows="8" placeholder="Write section content…"></textarea></div>
    `,`<button class="btn-primary" id="save-hb-btn">Add Section</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('save-hb-btn').addEventListener('click',async()=>{
      const title=document.getElementById('hb-title').value.trim(); if(!title) return;
      const order = sections.length + defaultSections.length;
      await db.collection('handbook').add({title,icon:document.getElementById('hb-icon').value.trim()||'file-text',content:document.getElementById('hb-content').value,order,addedBy:currentUser.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      closeModal(); renderCompanyHandbook(ct,canAdd);
    });
  });
}

// ── Departments ───────────────────────────────────
async function renderDepartments() {
  if (!isPresident() && currentRole !== 'manager' && currentRole !== 'secretary') {
    document.getElementById('page-content').innerHTML = renderAccessDenied('Departments');
    return;
  }
  const c = document.getElementById('page-content');

  // All known departments from config + Brilliant Steel
  const allDepts = Object.keys(DEPARTMENTS).filter(k => k !== 'Brilliant Steel');

  c.innerHTML = `
    <div class="page-header">
      <h2>${emojiIcon('🗂️',20)} Departments</h2>
      <button class="btn-primary btn-sm" id="add-dept-btn">+ Add</button>
    </div>
    <div class="dept-grid" id="dept-grid">
      ${allDepts.map(name => {
        const cfg = DEPARTMENTS[name] || {};
        const subtabs = (cfg.subtabs || []).slice(0, 4);
        return `
          <div class="dept-card dept-card-clickable" data-dept="${name}" style="border-top-color:${cfg.color||'var(--primary-light)'}; cursor:pointer">
            <div class="dept-icon-large">${window.deptIconTile(cfg, 44)}</div>
            <div class="dept-name" style="font-weight:700;font-size:14px;margin:4px 0">${name}</div>
            <div class="dept-subtabs-preview">
              ${subtabs.map(s => `<span class="dept-subtab-chip">${s}</span>`).join('')}
            </div>
            <div class="dept-open-hint">Tap to open →</div>
          </div>`;
      }).join('')}
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });

  // Click → open full department module
  c.querySelectorAll('.dept-card-clickable').forEach(card => {
    card.addEventListener('click', () => navigateTo('dept:' + card.dataset.dept));
  });

  document.getElementById('add-dept-btn')?.addEventListener('click', () => {
    openPage('Add Department', `
      <div class="form-group"><label>Name</label>
        <select id="dept-name-sel">
          <option value="">-- Select --</option>
          ${Object.keys(DEPARTMENTS).map(k=>`<option value="${k}">${k}</option>`).join('')}
          <option value="custom">Custom…</option>
        </select>
      </div>
      <div class="form-group hidden" id="dept-custom-wrap"><label>Custom Name</label><input id="dept-custom-name"/></div>
      <div class="form-group"><label>Department Head</label><input id="dept-head"/></div>
      <div class="form-group"><label>Members (comma-separated)</label><textarea id="dept-members" rows="3"></textarea></div>
    `, `<button class="btn-primary" id="save-dept-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('dept-name-sel').onchange = function() {
      document.getElementById('dept-custom-wrap').classList.toggle('hidden', this.value !== 'custom');
    };
    document.getElementById('save-dept-btn').addEventListener('click', async () => {
      const sel  = document.getElementById('dept-name-sel').value;
      const name = sel === 'custom' ? document.getElementById('dept-custom-name').value.trim() : sel;
      if (!name) return;
      const members = document.getElementById('dept-members').value.split(',').map(s=>s.trim()).filter(Boolean);
      await db.collection('departments').add({
        name, head: document.getElementById('dept-head').value.trim(),
        members, createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); renderDepartments();
    });
  });
}

// ── Analytics ─────────────────────────────────────
async function renderAnalytics() {
  if(!isPresident()&&currentRole!=='manager'&&currentRole!=='secretary'&&currentRole!=='finance'){document.getElementById('page-content').innerHTML=renderAccessDenied('Analytics');return;}
  const c=document.getElementById('page-content');
  c.innerHTML=window.skeletonHtml('cards');
  const safeGet = async (q, label) => { try { return await q.get(); } catch(e) { _dashWarnOnce(label || 'query', e); return { docs:[], size:0 }; } };
  // Analytics re-reads the same heavy collections on every visit — cache 60s, keyed by the
  // active period so switching "This Month" ↔ "YTD" ↔ "All Time" doesn't serve stale rows
  // from a differently-bounded query (Phase 86 item 3). Uses the SAME canonical unqualified
  // keys as dashboards/writers for the 'all' case (no more 'an_' prefix) so a post-then-view
  // still sees fresh data on the one path other screens' dbCacheInvalidate() calls target.
  const cg = (key,q,ttl=60000) => dbCachedGet(key, ()=>q.get(), ttl).catch(e => { _dashWarnOnce(key, e); return {docs:[],size:0}; });

  // ── Phase 86: period scope ──────────────────────────────────────────
  // Chip/select on the Overview tab (This Month / Last Month / YTD / All Time), stored in
  // window._AN_PERIOD so every subtab's fetch + KPI math reads the same value. Defaults to
  // YTD per the phase spec (was implicitly "This Month" before).
  const anKey = window._AN_PERIOD || 'ytd';
  const _anP = Period.parse(anKey);
  const _sixStart = ymAddMonths(bizDate().slice(0,7), -5) + '-01';   // covers the 6-month trend charts
  // Bound = the EARLIER (more inclusive) of the selected period's start and 6-months-back, so
  // month-over-month delta badges and the 6-month trend charts (which need last month / trailing
  // 6mo data even when "This Month" is selected) never come up short. 'All Time' stays fully
  // unbounded — this is the literal "All = today's behavior" requirement, and it's also the
  // deliberate escape hatch for any explicitly all-time KPI (see notes below).
  window._AN_FETCH_START = (anKey === 'all') ? null
    : ((_anP.start && _anP.start < _sixStart) ? _anP.start : _sixStart);
  window._AN_LED_START = window._AN_FETCH_START;   // back-compat alias, same value
  const _boundStart = window._AN_FETCH_START;                                     // 'YYYY-MM-DD' string, or null
  const _boundTS = _boundStart ? firebase.firestore.Timestamp.fromDate(new Date(_boundStart+'T00:00:00')) : null;

  // Fetch upfront ONLY what Overview + the shared metrics bag (M) need — every subtab besides
  // Overview reuses these same arrays for at least one KPI, so they aren't worth deferring.
  // Deferred (see loadSubs/loadExpenses/loadFinanceExtras below): submissions, expenses,
  // cash_advances, payslips — each consumed by exactly one or two subtabs, never Overview.
  const [usersSnap,tasksSnap,quotesSnap,ledgerSnap,govSnap,jpSnap,jcSnap,dpSnap,clientsSnap] = await Promise.all([
    dbCachedGet('users', fetchUsersWithPayroll, 30000).catch(()=>({docs:[],size:0})),
    cg('tasks-all:'+anKey, _boundTS ? db.collection('tasks').where('createdAt','>=',_boundTS) : db.collection('tasks')),
    dbCachedGet('all-quotes', getAllQuotes, 60000).catch(()=>({docs:[]})),
    (window._AN_LED_START ? ledgerSince(window._AN_LED_START) : dbCachedGet('ledger', ()=>db.collection('ledger').get().catch(()=>({docs:[]})), 60000)),
    cg('gov_biddings:'+anKey, _boundTS ? db.collection('gov_biddings').where('createdAt','>=',_boundTS).orderBy('createdAt','desc') : db.collection('gov_biddings').orderBy('createdAt','desc')),
    cg('job_projects:'+anKey, _boundTS ? db.collection('job_projects').where('createdAt','>=',_boundTS) : db.collection('job_projects')),
    cg('job_costs:'+anKey, _boundTS ? db.collection('job_costs').where('createdAt','>=',_boundTS) : db.collection('job_costs')),
    cg('projects:'+anKey, _boundTS ? db.collection('projects').where('createdAt','>=',_boundTS) : db.collection('projects')),
    window.Clients.listAll().catch(()=>[]),
  ]);
  const users=usersSnap.docs.map(d=>({id:d.id,...d.data()}));
  const tasks=tasksSnap.docs.map(d=>({id:d.id,...d.data()}));
  const quotes=quotesSnap.docs.map(d=>({id:d.id,...d.data()}));
  const allClients = Array.isArray(clientsSnap) ? clientsSnap : [];
  // Lazy per-subtab collections (Phase 86 item 2) — populated on first visit to the subtab
  // that actually reads them, cached in these closure vars keyed by anKey via loadedFor.
  let subs=[], expenses=[], cas=[], payslips=[];
  let _loadedFor = { subs:null, expenses:null, finance:null };
  const loadSubs = async () => {
    if (_loadedFor.subs === anKey) return;
    const q = _boundTS ? db.collection('submissions').where('createdAt','>=',_boundTS) : db.collection('submissions');
    const snap = await cg('submissions:'+anKey, q);
    subs = snap.docs.map(d=>({id:d.id,...d.data()}));
    _loadedFor.subs = anKey;
  };
  const loadExpenses = async () => {
    if (_loadedFor.expenses === anKey) return;
    const q = _boundStart ? db.collection('expenses').where('date','>=',_boundStart) : db.collection('expenses');
    const snap = await cg('expenses:'+anKey, q);
    expenses = snap.docs.map(d=>({id:d.id,...d.data()}));
    _loadedFor.expenses = anKey;
  };
  const loadFinanceExtras = async () => {
    if (_loadedFor.finance === anKey) return;
    // v13 review fix: CA Outstanding/Pending are BALANCE-BOOK metrics — an advance
    // from last year that still carries a balance must always count. Never bound
    // this fetch by period (the 60s cg cache keeps the cost acceptable).
    const caQ = db.collection('cash_advances');
    const psQ = _boundStart ? db.collection('payslips').where('payPeriodStart','>=',_boundStart) : db.collection('payslips');
    const [caSnap, psSnap] = await Promise.all([cg('cash_advances:all', caQ), cg('payslips:'+anKey, psQ)]);
    cas = caSnap.docs.map(d=>({id:d.id,...d.data()}));
    payslips = psSnap.docs.map(d=>({id:d.id,...d.data()}));
    _loadedFor.finance = anKey;
  };
  const ledger=ledgerSnap.docs.map(d=>({id:d.id,...d.data()}));
  const govBids=govSnap.docs.map(d=>({id:d.id,...d.data()}));
  const jobProjects=jpSnap.docs.map(d=>({id:d.id,...d.data()}));
  // Unified project list (job_projects + Design board) via the canonical shape, so
  // receivables / top-clients reflect ALL projects, not just sales-driven jobs.
  const designProjects=(dpSnap?.docs||[]).map(d=>({id:d.id,...d.data()}));
  const allProjects = (window.Projects && window.Projects.normalize)
    ? [...jobProjects.map(p=>window.Projects.normalize(p,'job')), ...designProjects.map(p=>window.Projects.normalize(p,'design'))]
    : jobProjects.map(p=>({...p, arBalance:(p.arBalance!=null?p.arBalance:(+p.contractAmount||0)-(+p.amountCollected||0)), contractAmount:+p.contractAmount||0, stage:p.stage}));
  const jobCosts=jcSnap.docs.map(d=>({id:d.id,...d.data()}));

  const fmt=n=>isNaN(n)?'0':window.fmtN2(n);
  const thisMonth=bizDate().slice(0,7);   // Manila YYYY-MM
  const inMonth=(obj,field='createdAt')=>{
    const v=obj[field];
    if(!v) return false;
    const d=v.toDate?v.toDate():new Date(v);
    return bizDate(d).slice(0,7) === thisMonth;
  };

  // ── Period helpers (month-over-month) ───────────────
  const _ty=+thisMonth.slice(0,4), _tm=+thisMonth.slice(5,7);
  const lastMonth = _tm===1 ? `${_ty-1}-12` : `${_ty}-${String(_tm-1).padStart(2,'0')}`;
  const ymOf = (v)=>{ if(!v) return ''; if(typeof v==='string') return v.slice(0,7); const d=v.toDate?v.toDate():new Date(v); return bizDate(d).slice(0,7); };
  // last 6 calendar months, oldest→newest, anchored to Manila current month
  const months6=[]; for(let i=5;i>=0;i--){ const d=new Date(_ty,_tm-1-i,1); months6.push({ym:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,label:d.toLocaleString('default',{month:'short'})}); }
  const sum=(arr,f)=>arr.reduce((s,x)=>s+(+f(x)||0),0);
  // delta badge — arrow shows direction, colour shows good/bad (goodUp=false ⇒ up is bad, e.g. expenses)
  const delta=(cur,prev,goodUp=true)=>{
    cur=+cur||0; prev=+prev||0;
    if(cur===0&&prev===0) return `<span style="font-size:11px;color:var(--text-muted)">— vs last mo</span>`;
    const dir=cur>prev?1:cur<prev?-1:0;
    const pct=prev===0?100:Math.round((cur-prev)/Math.abs(prev)*100);
    const good=dir===0?null:((dir>0)===goodUp);
    const col=good===null?'#8e8e93':good?'var(--success)':'var(--danger)';
    const arrow=dir>0?'▲':dir<0?'▼':'—';
    return `<span style="font-size:11px;font-weight:600;color:${col}">${arrow} ${Math.abs(pct)}%</span> <span style="font-size:11px;color:var(--text-muted)">vs last mo</span>`;
  };

  // ── v12 WS40 — shared metrics bag (Spec 2d) ─────────────────────────
  // Sales-department quotes, hoisted so both the metrics bag and renderSales
  // read the SAME filtered array instead of re-filtering independently.
  const salesQuotes=quotes.filter(q=>q.department==='Sales'||q.type==='sales'||!q.department);
  // Re-audit 2026-08-03: renderSales's KPI tiles were chain-deduped (latest revision
  // per lineage only) but the metrics bag (buildMetricsSync) and renderOverview kept
  // counting every raw quote doc, so a quote re-filed as R2/R3 could still double-count
  // revenue/win-rate here even though the Sales tab right next to it showed the deduped
  // number — the exact "false win-rate drop" the owner flagged. Same helper, applied to
  // every quote-derived figure on this page, not just renderSales's own KPI row.
  const chainAllQuotes = window.latestQuoteRevisions ? window.latestQuoteRevisions(quotes).latest : quotes;
  const chainSalesQuotes = window.latestQuoteRevisions ? window.latestQuoteRevisions(salesQuotes).latest : salesQuotes;
  // Pure, synchronous — reads ONLY already-fetched arrays (WS16 no-refetch rule).
  // Re-run whenever window._AN_PERIOD changes (Overview's picker) so the
  // Conclusions card can never describe a period the KPI cards next to it
  // disagree with (the exact "wrong sentence" risk the spec warns against).
  // cash/turns are populated separately (cash: below, once, not period-scoped;
  // turns: Spec 4b, Finance-tab-only lazy fetch) and preserved across re-syncs.
  const buildMetricsSync = () => {
    const anPeriod = window._AN_PERIOD || 'ytd';
    const ledInP  = sum(ledger.filter(l=>ledgerKind(l)==='income'&&finPeriodMatch(l.date,anPeriod)), l=>l.amount);
    const ledOutP = sum(ledger.filter(l=>ledgerKind(l)==='expense'&&finPeriodMatch(l.date,anPeriod)), l=>l.amount);
    const wonQuotesP = sum(chainAllQuotes.filter(q=>q.status==='accepted'&&finPeriodMatch(ymOf(q.createdAt),anPeriod)), q=>q.total);
    const revP = ledInP || wonQuotesP;
    const netP = revP - ledOutP;
    const payrollTotal = sum(users, u=>(+u.salary||0)+(+u.allowance||0)-(+u.deductions||0));
    // "this period vs previous same-type period" (WS32 wonMTD/wonPrev ymOf pattern) —
    // scoped to calendar month regardless of the Overview picker, mirroring the
    // existing wonMTD/wonPrev revenue-delta convention elsewhere on this page.
    const qStat     = window.quoteWinStats(chainSalesQuotes.filter(qq=>ymOf(qq.createdAt)===thisMonth));
    const qPrevStat = window.quoteWinStats(chainSalesQuotes.filter(qq=>ymOf(qq.createdAt)===lastMonth));
    const bidStat   = window.bidWinStats(govBids);
    const prodTasksM   = tasks.filter(t=>t.department==='Production'||t.category==='Production');
    const prodDoneM    = prodTasksM.filter(t=>['done','approved','archived'].includes(t.status));
    const prodOverdueM = prodTasksM.filter(t=>!['done','approved','archived'].includes(t.status)&&t.dueDate&&t.dueDate<bizDate());
    const onTimeRateM  = (prodDoneM.length+prodOverdueM.length)>0 ? Math.round(prodDoneM.length/(prodDoneM.length+prodOverdueM.length)*100) : 100;
    const _fuToday = bizDate();
    const dueFuM = allClients.filter(cl=>cl.followUpDate&&cl.followUpDate<=_fuToday&&!['won','lost'].includes(window.crmStageOf(cl))).length;
    return {
      periodLabel: finPeriodLabel(anPeriod),
      revP, ledOutP, netP,
      payrollTotal, payrollRatio: window.payrollRatio(payrollTotal, revP),
      aging: window.arAging(allProjects),
      q: qStat, qPrev: qPrevStat, bid: bidStat,
      onTimeRate: onTimeRateM, prodDoneCount: prodDoneM.length, prodOverdueCount: prodOverdueM.length,
      dueFu: dueFuM,
      cash: (M && M.cash) || null,
      turns: (M && M.turns) || null,
    };
  };
  let M = null;
  M = buildMetricsSync();
  // Cash position (decision 1) — cheap (cached BankAccounts.list()+ledgerForPeriod
  // reads), not period-scoped, fetched once. Registry-empty OR denied (non-finance
  // role) IS the feature flag → placeholder card; NEVER falls back to Net Cash.
  try {
    if (window.BankAccounts?.cashPosition && (await window.BankAccounts.list()).length)
      M.cash = await window.BankAccounts.cashPosition();
  } catch(_) { /* denied/offline → placeholder */ }

  const SUBTABS = [
    {id:'overview',label:'Overview',icon:emojiIcon('📊',16)},
    {id:'sales',label:'Sales',icon:emojiIcon('🛒',16)},
    {id:'marketing',label:'Marketing',icon:emojiIcon('📣',16)},
    {id:'finance',label:'Finance',icon:emojiIcon('💰',16)},
    {id:'production',label:'Production',icon:emojiIcon('🏭',16)},
    {id:'government',label:'Gov. Biddings',icon:emojiIcon('🏛️',16)},
    {id:'strategy',label:'Strategy',icon:emojiIcon('🎯',16)},
  ];

  c.innerHTML=`
    <div class="page-header"><h2>${emojiIcon('📊',20)} Analytics & Performance</h2></div>
    ${window.chipTabs(SUBTABS.map(t=>({key:t.id,label:t.label,icon:t.icon})), 'overview', {cls:'an-subtabs'})}
    <div id="analytics-content"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });

  const renderOverview = async () => {
    M = buildMetricsSync();   // v12 WS40 — refresh so the Conclusions card below never lags this tab's own period picker
    const CT = window.chartTheme();
    const anPeriod = window._AN_PERIOD || 'ytd';
    const anPlabel = M.periodLabel;
    // ── Cash flow (canonical source = ledger) ──
    // ledgerKind() classifies income/expense (v12 WS13) — asset/liability rows
    // (e.g. the Inventory leg) are excluded automatically instead of being
    // swept into "expense" by a raw type==='debit' check.
    const ledIn  = ym => sum(ledger.filter(l=>ledgerKind(l)==='income'&&(l.date||'').slice(0,7)===ym), l=>l.amount);
    const ledOut = ym => sum(ledger.filter(l=>ledgerKind(l)==='expense'&&(l.date||'').slice(0,7)===ym), l=>l.amount);
    // sales-based revenue fallback for months where the ledger is still sparse (accepted quotes by createdAt month)
    const wonQuotesMonth = ym => sum(chainAllQuotes.filter(q=>q.status==='accepted'&&ymOf(q.createdAt)===ym), q=>q.total);
    // period-aware totals (This Month / Since Jan 1 / All Time) — v12 WS40: computed
    // once in buildMetricsSync (Spec 2d); reused here byte-identical, not recomputed.
    const revMTD  = M.revP, ledOutP = M.ledOutP;
    const revPrev = ledIn(lastMonth) || wonQuotesMonth(lastMonth);
    const netMTD  = M.netP, netPrev = revPrev - ledOut(lastMonth);
    // ── Profitability (job_costs) ──
    const jcRev  = sum(jobCosts, j=>j.revenue);
    const jcCost = sum(jobCosts, j=>(+j.materialsCost||0)+(+j.laborCost||0)+(+j.otherCost||0));
    const grossProfit = jcRev - jcCost;
    const grossMargin = jcRev>0 ? Math.round(grossProfit/jcRev*100) : null;
    // ── Receivables (open projects — job + design, via unified shape) ──
    const arOf = p => +p.arBalance||0; // normalized shape already derives arBalance
    const openProjects = allProjects.filter(p=>!['paid','cancelled','completed'].includes(p.stage));
    const receivables = sum(openProjects, arOf);
    // ── Payroll efficiency ── (v12 WS40 Spec 2a/4e — window.payrollRatio, byte-identical)
    const totalPayroll = M.payrollTotal;
    const payrollPct = M.payrollRatio;
    // ── Top clients by signed contract (fallback: accepted quotes) ──
    const clientRev={};
    allProjects.filter(p=>p.stage!=='cancelled').forEach(p=>{const k=p.clientName||'—';clientRev[k]=(clientRev[k]||0)+(+p.contractAmount||0);});
    if(!Object.keys(clientRev).length) chainAllQuotes.filter(q=>q.status==='accepted').forEach(q=>{const k=q.clientName||q.client||'—';clientRev[k]=(clientRev[k]||0)+(+q.total||0);});
    const topClients=Object.entries(clientRev).filter(e=>e[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const clientTotal=topClients.reduce((s,e)=>s+e[1],0)||1;
    // ── v12 WS40 Spec 3 — Conclusions card ──
    const _sevColor = { bad: window.cssVar('--danger','#FF453A'), warn: window.cssVar('--warning','#FF9F0A'),
      info: window.cssVar('--text-muted','#8e8e93'), good: window.cssVar('--success','#30D158') };
    const _insights = window.Insights.compute(M).slice(0, window.ANALYTICS_POLICY.maxInsights);
    const _insightsHtml = _insights.map(i=>`
      <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:16px;line-height:1.3">${i.icon}</span>
        <div><div style="font-size:13px;color:${_sevColor[i.severity]}">${i.text}</div>${i.action?`<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${i.action}</div>`:''}</div>
      </div>`).join('');

    const wrap=document.getElementById('analytics-content');
    const _anDelta = (cur,prev) => anPeriod==='month' ? delta(cur,prev,true) : `<span style="font-size:11px;color:var(--text-muted)">${anPlabel}</span>`;
    const _cashAccts = M.cash ? Object.values(M.cash.perAccount||{}) : [];
    wrap.innerHTML=`
      <div id="an-overview-period">${window.periodPicker(anPeriod, {closedBadge:true})}</div>
      <div class="kpi-row" style="margin-top:16px">
        <div class="kpi-card green"><div class="kpi-label">Revenue (${anPlabel})</div><div class="kpi-value">₱${fmt(revMTD)}</div><div style="margin-top:4px">${_anDelta(revMTD,revPrev)}</div></div>
        <div class="kpi-card ${netMTD>=0?'green':'warn'}"><div class="kpi-label">Net Cash (${anPlabel})</div><div class="kpi-value">₱${fmt(netMTD)}</div><div style="margin-top:4px">${_anDelta(netMTD,netPrev)}</div></div>
        <div class="kpi-card accent"><div class="kpi-label">Gross Margin</div><div class="kpi-value">${grossMargin==null?'—':grossMargin+'%'}</div><div style="margin-top:4px;font-size:11px;color:var(--text-muted)">${grossMargin==null?'add job costs':'₱'+fmt(grossProfit)+' profit'}</div></div>
        <div class="kpi-card warn"><div class="kpi-label">Receivables</div><div class="kpi-value">₱${fmt(receivables)}</div><div style="margin-top:4px;font-size:11px;color:var(--text-muted)">${openProjects.length} open job${openProjects.length===1?'':'s'}</div></div>
        <div class="kpi-card"><div class="kpi-label">Payroll % of Revenue</div><div class="kpi-value">${payrollPct==null?'—':payrollPct+'%'}</div><div style="margin-top:4px;font-size:11px;color:var(--text-muted)">₱${fmt(totalPayroll)}/mo</div></div>
        <div class="kpi-card ${M.cash?(M.cash.total>=window.ANALYTICS_POLICY.cashFloor?'green':'warn'):''}"><div class="kpi-label">${emojiIcon('🏦',16)} Cash Position</div><div class="kpi-value">${M.cash?'₱'+fmt(M.cash.total):'—'}</div><div style="margin-top:4px;font-size:11px;color:var(--text-muted)">${M.cash?'Excludes statutory remittances until the WS39 remittance flow ships.':'Register bank accounts (Finance → Bank Accounts) to activate'}</div>${_cashAccts.length?`<details style="margin-top:6px"><summary style="cursor:pointer;font-size:11px;color:var(--text-muted)">${_cashAccts.length} account${_cashAccts.length===1?'':'s'} ›</summary><div style="margin-top:6px;display:flex;flex-direction:column;gap:3px">${_cashAccts.map(x=>`<div style="display:flex;justify-content:space-between;font-size:11px"><span>${escHtml(window.BankAccounts.label(x.account))}</span><span style="font-weight:600">₱${fmt(x.balance)}</span></div>`).join('')}</div></details>`:''}</div>
      </div>
      <div class="card" style="margin-bottom:16px"><div class="card-header"><h3>${emojiIcon('📌',20)} Conclusions</h3></div><div class="card-body">${_insightsHtml}<div style="margin-top:8px;text-align:right"><a href="javascript:void(0)" id="an-see-strategy" style="font-size:12px;font-weight:600">See all → ${emojiIcon('🎯',16)} Strategy</a></div></div></div>
      <div class="an-row2" style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card"><div class="card-header"><h3>Cash Flow — last 6 months</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="bh-cash-chart"></canvas></div></div></div>
        <div class="card"><div class="card-header"><h3>Revenue vs Cost</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="bh-margin-chart"></canvas></div></div></div>
      </div>
      <div class="an-row2" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card"><div class="card-header"><h3>Top Clients by Revenue</h3></div><div class="card-body">${topClients.length?topClients.map(([name,val])=>`
          <div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:3px"><span>${escHtml(name)}</span><span style="font-weight:600">₱${fmt(val)}</span></div>
            <div style="height:6px;background:#ffffff14;border-radius:3px;overflow:hidden"><div style="height:100%;width:${Math.round(val/clientTotal*100)}%;background:#0A84FF"></div></div>
          </div>`).join(''):`<p style="color:var(--text-muted);text-align:center;padding:12px">No client revenue yet</p>`}</div></div>
        <div class="card"><div class="card-header"><h3>Receivables — Open Jobs</h3></div><div class="card-body"><div class="table-wrap"><table class="data-table table-cards no-toggle">
          <thead><tr><th>Client</th><th>Stage</th><th>Outstanding</th></tr></thead>
          <tbody>${openProjects.length?openProjects.slice().sort((a,b)=>arOf(b)-arOf(a)).slice(0,10).map(p=>`<tr><td data-label="Client">${escHtml(p.clientName||p.name||'—')}</td><td data-label="Stage"><span class="badge badge-blue">${escHtml((p.stage||'—').replace(/_/g,' '))}</span></td><td data-label="Outstanding">₱${fmt(arOf(p))}</td></tr>`).join(''):`<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">No open jobs</td></tr>`}</tbody>
        </table></div></div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Team Performance</h3></div><div class="card-body"><div class="table-wrap"><table class="data-table table-cards">
        <thead><tr><th>Name</th><th>Role</th><th>Dept</th><th>Tasks Done</th><th>Net Pay</th></tr></thead>
        <tbody>${users.map(u=>{
          const done=tasks.filter(t=>(Array.isArray(t.assignedTo)?t.assignedTo.includes(u.id):t.assignedTo===u.id)&&['done','approved','archived'].includes(t.status)).length;
          const net=(u.salary||0)+(u.allowance||0)-(u.deductions||0);
          return `<tr class="an-team-row"><td class="tc-name">${escHtml(u.displayName||u.email||'—')} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td><td class="tc-detail" data-label="Role"><span class="badge badge-blue">${escHtml(ROLES[u.role]?.label||u.role||'—')}</span></td><td class="tc-detail" data-label="Dept">${escHtml((Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(', ')||'—')}</td><td class="tc-detail" data-label="Tasks Done">${done}</td><td class="tc-net">₱${fmt(net)}</td></tr>`;
        }).join('')}</tbody>
      </table></div></div></div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [wrap] });
    wrap.querySelectorAll('tr.an-team-row').forEach(tr => tr.addEventListener('click', () => tr.classList.toggle('tc-expanded')));
    document.getElementById('an-see-strategy')?.addEventListener('click', () => {
      c.querySelector('.an-subtabs .chip-tab[data-chip="strategy"]')?.click();
    });
    // Cash in vs cash out, 6-month trend
    if (!window.Chart) { await window.ensureChart(); }
    new Chart(document.getElementById('bh-cash-chart'),{type:'bar',data:{labels:months6.map(m=>m.label),datasets:[
      {label:'Cash In',data:months6.map(m=>ledIn(m.ym)||wonQuotesMonth(m.ym)),backgroundColor:CT.good},
      {label:'Cash Out',data:months6.map(m=>ledOut(m.ym)),backgroundColor:CT.bad},
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:CT.text}},tooltip:{callbacks:{label:c=>` ${c.dataset.label}: ₱${fmt(c.parsed.y)}`}}},scales:{y:{ticks:{color:CT.text,callback:v=>'₱'+window.fmtN2(v)},grid:{color:CT.grid}},x:{ticks:{color:CT.text},grid:{display:false}}}}});
    // Gross profit vs cost (profitability)
    if (!window.Chart) { await window.ensureChart(); }
    new Chart(document.getElementById('bh-margin-chart'),{type:'doughnut',data:{labels:['Gross Profit','Cost'],datasets:[{data:[Math.max(grossProfit,0),jcCost],backgroundColor:[CT.good,CT.muted],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:CT.text}},tooltip:{callbacks:{label:c=>` ${c.label}: ₱${fmt(c.parsed)}`}}}}});
    window.bindPeriodPicker(document.getElementById('an-overview-period'), (newKey) => {
      window._AN_PERIOD = newKey; window._anRenderOverview && window._anRenderOverview();
    }, { closedBadge:true, activeKey: anPeriod });
  };
  window._anRenderOverview = renderOverview;

  const renderSales = async () => {
    const CT = window.chartTheme();
    // Owner report 2026-08-03: superseded revisions inflated Total Quotes and
    // the win rate. Dedupe to each chain's LATEST revision (same helper the
    // quote lists use) before any counting — a quote re-filed 3 times is ONE
    // quote with one outcome, not three.
    const _rev = window.latestQuoteRevisions
      ? window.latestQuoteRevisions(salesQuotes)
      : { latest: salesQuotes, supersededIds: new Set() };
    const chainQuotes = _rev.latest;
    // v12 WS40 Spec 2a / RE-GROUNDED 3 — the ONE win-rate source; now fed the
    // chain-deduped set instead of raw docs.
    const q = window.quoteWinStats(chainQuotes);
    const wonQ = q.won, lostQ = q.lost, openQ = q.open;
    const wonCount = q.wonCount, lostCount = q.lostCount;
    const winRate  = q.winRate==null ? 0 : q.winRate;    // KPI keeps its 0-when-empty default
    // 30-agent beta sweep fix — this KPI used to read q.pipelineVal (quoteWinStats'
    // OPEN-only total, which drops won-but-not-yet-superseded quotes), so it showed
    // a smaller number than the Command Center's Quote Pipeline card for the same
    // underlying quotes. Now calls the same window.quotePipelineValue (sales.js) the
    // Command Center and the Sales tab's Pipeline ₱ use: latest revision per
    // lineage, excluding rejected/lost — won quotes ARE included.
    const won2     = q.wonVal;
    const pipeline = window.quotePipelineValue ? window.quotePipelineValue(chainQuotes) : q.pipelineVal;
    const salesSubs=subs.filter(s=>s.department==='Sales'||s.type?.includes('sales'));
    const salesTasks=tasks.filter(t=>t.department==='Sales'||t.category==='Sales');
    const doneSalesTasks=salesTasks.filter(t=>['done','approved','archived'].includes(t.status));
    const wonMTD =sum(wonQ.filter(q=>ymOf(q.createdAt)===thisMonth),q=>q.total||q.grandTotal||0);
    const wonPrev=sum(wonQ.filter(q=>ymOf(q.createdAt)===lastMonth),q=>q.total||q.grandTotal||0);
    const avgDeal=wonCount?won2/wonCount:0;
    // CRM funnel — ALL brands, one cached read (decision 9). Taxonomy = the shared
    // window.CRM_STAGES export; the inline CRMP literal is DELETED.
    const stageCount={lead:0,prospect:0,won:0,lost:0};
    allClients.forEach(cl=>{ stageCount[window.crmStageOf(cl)]++; });
    const clTotal=allClients.length;
    const clWon=stageCount.won, clLost=stageCount.lost;
    const clConv = clWon+clLost>0 ? Math.round(clWon/(clWon+clLost)*100) : null;
    const dueFu = M.dueFu;   // v12 WS40 — shared with the metrics bag (Spec 2d), not recomputed
    const wrap=document.getElementById('analytics-content');
    wrap.innerHTML=`
      <div class="kpi-row" style="margin-top:16px">
        <div class="kpi-card green"><div class="kpi-label">Revenue Won</div><div class="kpi-value">₱${fmt(won2)}</div><div style="margin-top:4px">${delta(wonMTD,wonPrev,true)}</div></div>
        <div class="kpi-card accent"><div class="kpi-label">Pipeline Value</div><div class="kpi-value">₱${fmt(pipeline)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Win Rate (quotes)</div><div class="kpi-value">${winRate}%</div><div style="margin-top:4px;font-size:11px;color:var(--text-muted)">${wonCount}W / ${lostCount}L</div></div>
        <div class="kpi-card"><div class="kpi-label">Avg Deal Size</div><div class="kpi-value">₱${fmt(avgDeal)}</div></div>
        <div class="kpi-card warn"><div class="kpi-label">Total Quotes</div><div class="kpi-value">${chainQuotes.length}</div>${_rev.supersededIds.size?`<div style="margin-top:4px;font-size:11px;color:var(--text-muted)">${_rev.supersededIds.size} superseded revision${_rev.supersededIds.size===1?'':'s'} excluded</div>`:''}</div>
        <div class="kpi-card"><div class="kpi-label">Tasks Done</div><div class="kpi-value">${doneSalesTasks.length}/${salesTasks.length}</div></div>
      </div>
      ${clTotal?`<div class="card" style="margin-bottom:16px">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
          <h3>CRM Pipeline · All Brands</h3>
          <span style="font-size:12px;color:var(--text-muted)">${clTotal} client${clTotal===1?'':'s'}${dueFu?` · <span style="color:var(--danger)">${dueFu} follow-up${dueFu>1?'s':''} due</span>`:''}</span>
        </div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px">
            ${window.CRM_STAGES.map(s=>`<div style="background:var(--surface2);border-radius:10px;padding:10px 12px"><div style="font-size:11px;color:var(--text-muted)">${emojiIcon(s.icon,14)} ${s.label}</div><div style="font-size:18px;font-weight:800;color:${s.color}">${stageCount[s.key]}</div><div style="font-size:10px;color:var(--text-muted)">${clTotal?Math.round(stageCount[s.key]/clTotal*100):0}%</div></div>`).join('')}
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:10px;border-top:1px solid var(--border);padding-top:8px">
            Client conversion: <strong>${clConv==null?'—':clConv+'%'}</strong> (won vs lost clients) ·
            Quote win rate: <strong>${winRate}%</strong> (won vs lost quotes — the authoritative KPI above).
            Creating a Sales Order auto-moves the client to ${emojiIcon('✅',16)} Won.
          </div>
        </div>
      </div>`:''}
      <div class="an-row2" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card"><div class="card-header"><h3>Quote Status Breakdown</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="sq-chart"></canvas></div></div></div>
        <div class="card"><div class="card-header"><h3>Monthly Quote Volume</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="sq2-chart"></canvas></div></div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Recent Quotes</h3></div><div class="card-body"><div class="table-wrap"><table class="data-table table-cards no-toggle">
        <thead><tr><th>Client</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>${salesQuotes.slice(0,20).map(q=>{
          const d=q.createdAt?.toDate?q.createdAt.toDate():new Date(q.createdAt||0);
          const statusColor = window.isQuoteWon(q)?'var(--success)':window.isQuoteLost(q)?'var(--danger)':'var(--info)';
          return `<tr><td data-label="Client">${escHtml(q.clientName||q.client||'—')}</td><td data-label="Amount">₱${fmt(q.total||q.amount||0)}</td><td data-label="Status"><span style="color:${statusColor};font-weight:600">${q.status||'draft'}</span></td><td data-label="Date">${d.toLocaleDateString('en-PH')}</td></tr>`;
        }).join('')}</tbody>
      </table></div></div></div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [wrap] });
    if (!window.Chart) { await window.ensureChart(); }
    new Chart(document.getElementById('sq-chart'),{type:'bar',data:{labels:['Open','Won','Lost'],
      datasets:[{data:[openQ.length,wonQ.length,lostQ.length],backgroundColor:[CT.neutral,CT.good,CT.bad]}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{color:CT.text},grid:{color:CT.grid}},x:{ticks:{color:CT.text},grid:{display:false}}}}});
    // last 6 months volume — anchored to Manila current month
    const months=[],counts=[];
    const _anchY=+thisMonth.slice(0,4), _anchM=+thisMonth.slice(5,7)-1;
    for(let i=5;i>=0;i--){const d=new Date(_anchY,_anchM-i,1);months.push(d.toLocaleString('default',{month:'short'}));counts.push(salesQuotes.filter(q=>{const qd=q.createdAt?.toDate?q.createdAt.toDate():new Date(q.createdAt||0);return qd.getMonth()===d.getMonth()&&qd.getFullYear()===d.getFullYear();}).length);}
    if (!window.Chart) { await window.ensureChart(); }
    new Chart(document.getElementById('sq2-chart'),{type:'line',data:{labels:months,datasets:[{label:'Quotes',data:counts,borderColor:CT.neutral,backgroundColor:CT.neutralA,fill:true,tension:0.4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{color:CT.text},grid:{color:CT.grid}},x:{ticks:{color:CT.text},grid:{display:false}}}}});
  };

  const renderMarketing = async () => {
    await Promise.all([loadSubs(), loadExpenses()]);   // Phase 86 item 2 — lazy, Marketing-only reads
    const CT = window.chartTheme();
    const mktTasks=tasks.filter(t=>t.department==='Marketing'||t.category==='Marketing');
    const doneMkt=mktTasks.filter(t=>['done','approved','archived'].includes(t.status));
    const mktSubs=subs.filter(s=>s.department==='Marketing');
    const mktExp=expenses.filter(e=>e.department==='Marketing'&&e.status==='approved').reduce((s,e)=>s+(e.amount||0),0);
    const mktUsers=users.filter(u=>(Array.isArray(u.departments)?u.departments:u.department?[u.department]:[]).includes('Marketing'));
    const doneMktMTD=mktTasks.filter(t=>['done','approved','archived'].includes(t.status)&&ymOf(t.createdAt)===thisMonth).length;
    const doneMktPrev=mktTasks.filter(t=>['done','approved','archived'].includes(t.status)&&ymOf(t.createdAt)===lastMonth).length;
    const costPerTask=doneMkt.length?mktExp/doneMkt.length:0;
    const wrap=document.getElementById('analytics-content');
    wrap.innerHTML=`
      <div class="kpi-row" style="margin-top:16px">
        <div class="kpi-card"><div class="kpi-label">Team Members</div><div class="kpi-value">${mktUsers.length}</div></div>
        <div class="kpi-card accent"><div class="kpi-label">Tasks</div><div class="kpi-value">${mktTasks.length}</div></div>
        <div class="kpi-card green"><div class="kpi-label">Completed</div><div class="kpi-value">${doneMkt.length}</div><div style="margin-top:4px">${delta(doneMktMTD,doneMktPrev,true)}</div></div>
        <div class="kpi-card warn"><div class="kpi-label">Budget Used</div><div class="kpi-value">₱${fmt(mktExp)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Cost / Completed Task</div><div class="kpi-value">₱${fmt(costPerTask)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Submissions</div><div class="kpi-value">${mktSubs.length}</div></div>
      </div>
      <div class="an-row2" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card"><div class="card-header"><h3>Task Completion Rate</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="mkt-task-chart"></canvas></div></div></div>
        <div class="card"><div class="card-header"><h3>Task Status Breakdown</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="mkt-status-chart"></canvas></div></div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Marketing Team</h3></div><div class="card-body"><div class="table-wrap"><table class="data-table table-cards no-toggle">
        <thead><tr><th>Name</th><th>Role</th><th>Tasks Done</th><th>Tasks Active</th></tr></thead>
        <tbody>${mktUsers.map(u=>{
          const uTasks=mktTasks.filter(t=>Array.isArray(t.assignedTo)?t.assignedTo.includes(u.id):t.assignedTo===u.id);
          const uDone=uTasks.filter(t=>['done','approved','archived'].includes(t.status)).length;
          const uActive=uTasks.filter(t=>['todo','in-progress','review'].includes(t.status)).length;
          return `<tr><td data-label="Name">${escHtml(u.displayName||u.email||'—')}</td><td data-label="Role"><span class="badge badge-blue">${escHtml(ROLES[u.role]?.label||u.role)}</span></td><td data-label="Tasks Done">${uDone}</td><td data-label="Tasks Active">${uActive}</td></tr>`;
        }).join('')}</tbody>
      </table></div></div></div>
    `;
    const taskStatuses=['todo','in-progress','review','done','approved','archived'];
    const statusCounts=taskStatuses.map(s=>mktTasks.filter(t=>t.status===s).length);
    if (!window.Chart) { await window.ensureChart(); }
    new Chart(document.getElementById('mkt-task-chart'),{type:'doughnut',data:{labels:['Done','Active'],datasets:[{data:[doneMkt.length,mktTasks.length-doneMkt.length],backgroundColor:[CT.good,CT.muted],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:CT.text}}}}});
    if (!window.Chart) { await window.ensureChart(); }
    new Chart(document.getElementById('mkt-status-chart'),{type:'bar',data:{labels:taskStatuses.map(s=>s.charAt(0).toUpperCase()+s.slice(1)),datasets:[{data:statusCounts,backgroundColor:CT.warn}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{color:CT.text},grid:{color:CT.grid}},x:{ticks:{color:CT.text,font:{size:10}},grid:{display:false}}}}});
  };

  const renderFinanceAnalytics = async () => {
    await loadFinanceExtras();   // Phase 86 item 2 — lazy, Finance-only reads (cash_advances + payslips)
    const CT = window.chartTheme();
    // Follows the SAME period as the Overview tab's picker (window._AN_PERIOD) —
    // showing "This Month" here while Overview shows "Last Month" would be a
    // confusing split-brain on one page (v12 WS12 D3).
    const finAnPeriod = window._AN_PERIOD || 'ytd';
    const finAnLabel = finPeriodLabel(finAnPeriod);
    const totalPayroll = M.payrollTotal;   // v12 WS40 — same formula, single source (Spec 2d)
    // Payroll is posted as type:'debit' category:'Payroll Expense' (no type:'payslip' exists).
    const _isPayroll=l=>l.category==='Payroll Expense';
    const disbursed=ledger.filter(_isPayroll).reduce((s,l)=>s+(l.amount||0),0);
    const disbursedThisMonth=ledger.filter(l=>_isPayroll(l)&&Period.match(l.date,finAnPeriod)).reduce((s,l)=>s+(l.amount||0),0);
    const caTotal=cas.filter(a=>a.status==='approved').reduce((s,a)=>s+(a.amount||0),0);
    const caPending=cas.filter(a=>a.status==='pending').length;
    // Expenses come from the ledger (single source of truth) — approved expenses,
    // payroll, COS and disbursements are all posted there. ledgerKind() classifies
    // income/expense (v12 WS13) so asset/liability legs (e.g. Inventory) don't
    // silently inflate this total.
    const ledDebits=ledger.filter(l=>ledgerKind(l)==='expense');
    const totalExp=ledDebits.reduce((s,l)=>s+(l.amount||0),0);
    const expThisMonth=ledDebits.filter(l=>Period.match(l.date,finAnPeriod)).reduce((s,l)=>s+(l.amount||0),0);
    const payslipsThisMonth=payslips.filter(p=>inMonth(p));
    const finIn = ym => sum(ledger.filter(l=>ledgerKind(l)==='income'&&(l.date||'').slice(0,7)===ym),l=>l.amount);
    const finOut= ym => sum(ledger.filter(l=>ledgerKind(l)==='expense'&&(l.date||'').slice(0,7)===ym),l=>l.amount);
    const finInP  = sum(ledger.filter(l=>ledgerKind(l)==='income'&&Period.match(l.date,finAnPeriod)),l=>l.amount);
    const finOutP = sum(ledger.filter(l=>ledgerKind(l)==='expense'&&Period.match(l.date,finAnPeriod)),l=>l.amount);
    const netMTD=finInP-finOutP, netPrev=finIn(lastMonth)-finOut(lastMonth);
    // v12 WS40 Spec 2a/4e/RE-GROUNDED 2 — shared formula, DIFFERENT denominator than
    // Overview's M.payrollRatio (finInP = pure ledger income here, not revMTD's
    // accepted-quote fallback) — decision 5's "same denominator" claim was wrong in
    // real code; do not unify.
    const payrollPct = window.payrollRatio(totalPayroll, finInP);
    // v12 WS40 Spec 4b/6b — Inventory Turns KPI, lazy-fetched (Finance tab only, so
    // Overview never pays this cost). inventory_items uses the SAME cache key/TTL as
    // every other reader (RE-GROUNDED 8, 45s); ledgerSince keys+caches itself under
    // 'ledger>='+start (reached by the 'ledger' alias invalidation) — call it
    // directly rather than double-wrapping in cg(), which expects a Query, not a Promise.
    const turnsStart = (() => { const d=new Date(bizDate()+'T12:00:00'); d.setDate(d.getDate()-365);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })();
    const [invSnap, ledger365Snap] = await Promise.all([
      cg('inventory_items', db.collection('inventory_items'), 45000),
      window.ledgerSince(turnsStart),
    ]);
    M.turns = window.inventoryTurns(ledger365Snap.docs.map(d=>d.data()), invSnap.docs.map(d=>d.data()), 365);
    const wrap=document.getElementById('analytics-content');
    wrap.innerHTML=`
      <div class="kpi-row" style="margin-top:16px">
        <div class="kpi-card accent"><div class="kpi-label">Total Payroll (Est.)</div><div class="kpi-value">₱${fmt(totalPayroll)}</div></div>
        <div class="kpi-card ${netMTD>=0?'green':'warn'}"><div class="kpi-label">Net Income (${finAnLabel})</div><div class="kpi-value">₱${fmt(netMTD)}</div>${finAnPeriod==='month'?`<div style="margin-top:4px">${delta(netMTD,netPrev,true)}</div>`:''}</div>
        <div class="kpi-card"><div class="kpi-label">Payroll % of Revenue</div><div class="kpi-value">${payrollPct==null?'—':payrollPct+'%'}</div></div>
        <div class="kpi-card green"><div class="kpi-label">Disbursed (${finAnLabel})</div><div class="kpi-value">₱${fmt(disbursedThisMonth)}</div></div>
        <div class="kpi-card warn"><div class="kpi-label">CA Outstanding</div><div class="kpi-value">₱${fmt(caTotal)}</div></div>
        <div class="kpi-card"><div class="kpi-label">CA Pending</div><div class="kpi-value">${caPending}</div></div>
        <div class="kpi-card"><div class="kpi-label">Expenses (${finAnLabel})</div><div class="kpi-value">₱${fmt(expThisMonth)}</div></div>
        <div class="kpi-card"><div class="kpi-label">${emojiIcon('📦',16)} Inventory Turns</div><div class="kpi-value">${M.turns&&M.turns.turns!=null?M.turns.turns.toFixed(1)+'× /yr':'—'}</div><div style="margin-top:4px;font-size:11px;color:var(--text-muted)">${M.turns&&M.turns.turns!=null?'~'+M.turns.daysOnHand+'d on hand · WAC-costed, meaningful going-forward from WS29 ship date':'pending WS29 inventory movements'}</div></div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h3>${emojiIcon('📥',20)} Receivables Aging</h3><span style="font-weight:800">₱${fmt(M.aging.total)}</span></div>
        <div class="card-body">
          ${M.aging.total===0?`<div class="empty-state" style="padding:16px"><p>No open receivables ${emojiIcon('🎉',16)}</p></div>`:`
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px">
            ${[['0–30d',M.aging.cur,'var(--success)'],['31–60d',M.aging.d3160,'var(--warning)'],['61–90d',M.aging.d6190,'#FF9500'],['90+ d',M.aging.d90,'var(--danger)']].map(([lbl,val,col])=>`
              <div style="background:var(--surface2);border-radius:10px;padding:10px 12px">
                <div style="font-size:11px;color:var(--text-muted)">${lbl}</div>
                <div style="font-size:15px;font-weight:800;color:${col}">₱${fmt(val)}</div>
                <div style="font-size:10px;color:var(--text-muted)">${M.aging.total?Math.round(val/M.aging.total*100):0}%</div>
              </div>`).join('')}
          </div>
          ${M.aging.topDebtor?`<div style="font-size:11px;color:var(--text-muted);margin-top:10px">Largest balance: <strong>${escHtml(M.aging.topDebtor.name)}</strong> (₱${fmt(M.aging.topDebtor.amount)}).</div>`:''}`}
        </div>
      </div>
      <div class="an-row2" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card"><div class="card-header"><h3>Expense Categories</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="fin-exp-chart"></canvas></div></div></div>
        <div class="card"><div class="card-header"><h3>Cash Advance Status</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="fin-ca-chart"></canvas></div></div></div>
      </div>
      <div class="card" style="margin-bottom:16px"><div class="card-header"><h3>Net Income — last 6 months</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="fin-net-chart"></canvas></div></div></div>
      <div class="card"><div class="card-header"><h3>Payslips — This Month (${payslipsThisMonth.length})</h3></div><div class="card-body"><div class="table-wrap"><table class="data-table table-cards">
        <thead><tr><th>Worker</th><th>Pay Period</th><th>Gross</th><th>Net</th><th>Prepared By</th></tr></thead>
        <tbody>${payslipsThisMonth.slice(0,20).map(p=>`<tr class="pslip-row"><td class="tc-name">${escHtml(p.workerName||'—')} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td><td class="tc-detail" data-label="Pay Period">${escHtml(p.periodLabel||p.payPeriod||'—')}</td><td class="tc-detail" data-label="Gross">₱${fmt(p.grossPay||0)}</td><td class="tc-net">₱${fmt(p.netPay||0)}</td><td class="tc-detail" data-label="Prepared By">${escHtml(p.preparedBy||'—')}</td></tr>`).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No payslips this month</td></tr>'}</tbody>
      </table></div></div></div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [wrap] });
    wrap.querySelectorAll('tr.pslip-row').forEach(tr => tr.addEventListener('click', () => tr.classList.toggle('tc-expanded')));
    const cats=[...new Set(ledDebits.map(l=>l.category||'Other'))].slice(0,6);
    const catAmts=cats.map(cat=>ledDebits.filter(l=>(l.category||'Other')===cat).reduce((s,l)=>s+(l.amount||0),0));
    if (!window.Chart) { await window.ensureChart(); }
    new Chart(document.getElementById('fin-exp-chart'),{type:'bar',data:{labels:cats,datasets:[{data:catAmts,backgroundColor:CT.neutral}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>` ₱${window.fmtN2(c.parsed.y)}`}}},scales:{y:{ticks:{color:CT.text,callback:v=>'₱'+window.fmtN2(v)},grid:{color:CT.grid}},x:{ticks:{color:CT.text,font:{size:10}},grid:{display:false}}}}});
    if (!window.Chart) { await window.ensureChart(); }
    new Chart(document.getElementById('fin-ca-chart'),{type:'doughnut',data:{labels:['Approved','Pending','Rejected'],datasets:[{data:[cas.filter(a=>a.status==='approved').length,cas.filter(a=>a.status==='pending').length,cas.filter(a=>a.status==='rejected').length],backgroundColor:[CT.good,CT.warn,CT.bad],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:CT.text}}}}});
    if (!window.Chart) { await window.ensureChart(); }
    new Chart(document.getElementById('fin-net-chart'),{type:'line',data:{labels:months6.map(m=>m.label),datasets:[{label:'Net Income',data:months6.map(m=>finIn(m.ym)-finOut(m.ym)),borderColor:CT.good,backgroundColor:CT.goodA,fill:true,tension:0.4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>` ₱${fmt(c.parsed.y)}`}}},scales:{y:{ticks:{color:CT.text,callback:v=>'₱'+window.fmtN2(v)},grid:{color:CT.grid}},x:{ticks:{color:CT.text},grid:{display:false}}}}});
  };

  const renderProduction = async () => {
    await loadSubs();   // Phase 86 item 2 — lazy, shared with Marketing (prodSubs below)
    const CT = window.chartTheme();
    const prodTasks=tasks.filter(t=>t.department==='Production'||t.category==='Production');
    const prodUsers=users.filter(u=>(Array.isArray(u.departments)?u.departments:u.department?[u.department]:[]).includes('Production'));
    const prodSubs=subs.filter(s=>s.department==='Production');
    // v12 WS40 Spec 2d/4f — reused from the shared metrics bag, not recomputed;
    // relabeled "On-time task completion" (task-based, not delivery-based — a true
    // delivery metric is a documented WS28 wire-in, decision 4; the task metric is
    // not redefined in place).
    const doneProdCount = M.prodDoneCount, prodOverdueCount = M.prodOverdueCount;
    const onTimeRate = M.onTimeRate;
    const wrap=document.getElementById('analytics-content');
    wrap.innerHTML=`
      <div class="kpi-row" style="margin-top:16px">
        <div class="kpi-card"><div class="kpi-label">Team Size</div><div class="kpi-value">${prodUsers.length}</div></div>
        <div class="kpi-card accent"><div class="kpi-label">Total Tasks</div><div class="kpi-value">${prodTasks.length}</div></div>
        <div class="kpi-card green"><div class="kpi-label">Completed</div><div class="kpi-value">${doneProdCount}</div></div>
        <div class="kpi-card ${onTimeRate>=80?'green':'warn'}"><div class="kpi-label">On-time task completion</div><div class="kpi-value">${onTimeRate}%</div></div>
        <div class="kpi-card warn"><div class="kpi-label">Overdue</div><div class="kpi-value">${prodOverdueCount}</div></div>
        <div class="kpi-card"><div class="kpi-label">Submissions</div><div class="kpi-value">${prodSubs.length}</div></div>
      </div>
      <div class="an-row2" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card"><div class="card-header"><h3>Task Status</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="prod-status-chart"></canvas></div></div></div>
        <div class="card"><div class="card-header"><h3>Output Per Member</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="prod-member-chart"></canvas></div></div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Production Tasks</h3></div><div class="card-body"><div class="table-wrap"><table class="data-table table-cards no-toggle">
        <thead><tr><th>Task</th><th>Status</th><th>Assigned</th><th>Priority</th></tr></thead>
        <tbody>${prodTasks.slice(0,20).map(t=>{
          const assignedNames=(Array.isArray(t.assignedTo)?t.assignedTo:[t.assignedTo]).map(uid=>users.find(u=>u.id===uid)?.displayName||'?').join(', ');
          const sc={todo:'#636366','in-progress':'var(--info)',review:'#FF9F0A',done:'var(--success)',approved:'var(--success)',archived:'#636366'}[t.status]||'#636366';
          return `<tr><td data-label="Task">${escHtml(t.title||'—')}</td><td data-label="Status"><span style="color:${sc};font-weight:600">${t.status||'—'}</span></td><td data-label="Assigned">${escHtml(assignedNames||'—')}</td><td data-label="Priority">${t.priority||'—'}</td></tr>`;
        }).join('')}</tbody>
      </table></div></div></div>
    `;
    const taskStatuses=['todo','in-progress','review','done','approved'];
    if (!window.Chart) { await window.ensureChart(); }
    new Chart(document.getElementById('prod-status-chart'),{type:'doughnut',data:{labels:taskStatuses.map(s=>s.charAt(0).toUpperCase()+s.slice(1)),datasets:[{data:taskStatuses.map(s=>prodTasks.filter(t=>t.status===s).length),backgroundColor:[CT.muted,CT.neutral,CT.warn,CT.good,CT.goodAlt],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:CT.text}}}}});
    const topMembers=prodUsers.slice(0,8);
    if (!window.Chart) { await window.ensureChart(); }
    new Chart(document.getElementById('prod-member-chart'),{type:'bar',data:{labels:topMembers.map(u=>(u.displayName||u.email||'?').split(' ')[0]),datasets:[{label:'Done',data:topMembers.map(u=>prodTasks.filter(t=>(Array.isArray(t.assignedTo)?t.assignedTo.includes(u.id):t.assignedTo===u.id)&&['done','approved','archived'].includes(t.status)).length),backgroundColor:CT.good}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{color:CT.text},grid:{color:CT.grid}},x:{ticks:{color:CT.text,font:{size:10}},grid:{display:false}}}}});
  };

  const renderGovernment = async () => {
    const CT = window.chartTheme();
    const wonBids=govBids.filter(b=>b.status==='won');
    const lostBids=govBids.filter(b=>b.status==='lost');
    const pendingBids=govBids.filter(b=>!b.status||b.status==='pending'||b.status==='submitted');
    const totalWon=wonBids.reduce((s,b)=>s+(b.contractAmount||b.bidAmount||0),0);
    const totalBid=govBids.reduce((s,b)=>s+(b.bidAmount||b.contractAmount||0),0);
    // v12 WS40 Spec 2a/3/RE-GROUNDED 3 — the ONE bid-win-rate source (M.bid ==
    // window.bidWinStats(govBids)); KPI keeps its 0-when-empty default and is
    // ALWAYS labeled "(Government)" so it's never confused with quote win rate.
    const winRate = M.bid.winRate==null ? 0 : M.bid.winRate;
    const avgContract=wonBids.length?totalWon/wonBids.length:0;
    const bidsMTD=govBids.filter(b=>ymOf(b.createdAt)===thisMonth).length;
    const bidsPrev=govBids.filter(b=>ymOf(b.createdAt)===lastMonth).length;
    // fallback if govBids is empty — show from tasks tagged as gov
    const govTasks=tasks.filter(t=>t.department==='Government Biddings'||t.category==='Government'||t.category==='Gov Biddings');
    const wrap=document.getElementById('analytics-content');
    wrap.innerHTML=`
      <div class="kpi-row" style="margin-top:16px">
        <div class="kpi-card green"><div class="kpi-label">Contracts Won</div><div class="kpi-value">₱${fmt(totalWon)}</div></div>
        <div class="kpi-card accent"><div class="kpi-label">Total Bids</div><div class="kpi-value">${govBids.length}</div><div style="margin-top:4px">${delta(bidsMTD,bidsPrev,true)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Win Rate (Government)</div><div class="kpi-value">${winRate}%</div><div style="margin-top:4px;font-size:11px;color:var(--text-muted)">${wonBids.length}W / ${lostBids.length}L</div></div>
        <div class="kpi-card"><div class="kpi-label">Avg Contract</div><div class="kpi-value">₱${fmt(avgContract)}</div></div>
        <div class="kpi-card warn"><div class="kpi-label">Pending / Submitted</div><div class="kpi-value">${pendingBids.length}</div></div>
        <div class="kpi-card"><div class="kpi-label">Gov Tasks</div><div class="kpi-value">${govTasks.length}</div></div>
      </div>
      <div class="an-row2" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card"><div class="card-header"><h3>Bid Outcomes</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="gov-outcome-chart"></canvas></div></div></div>
        <div class="card"><div class="card-header"><h3>Gov Department Tasks</h3></div><div class="card-body"><div class="chart-wrap"><canvas id="gov-task-chart"></canvas></div></div></div>
      </div>
      <div class="card"><div class="card-header"><h3>Bidding Records</h3></div><div class="card-body">${govBids.length?`<div class="table-wrap"><table class="data-table table-cards">
        <thead><tr><th>Project</th><th>Agency</th><th>Bid Amount</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>${govBids.slice(0,20).map(b=>{
          const d=b.createdAt?.toDate?b.createdAt.toDate():new Date(b.createdAt||0);
          const sc={won:'var(--success)',lost:'var(--danger)',pending:'#FF9F0A',submitted:'var(--info)'}[b.status]||'#636366';
          return `<tr class="gov-bid-row"><td class="tc-name">${escHtml(b.projectName||b.title||'—')} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td><td class="tc-detail" data-label="Agency">${escHtml(b.agency||'—')}</td><td class="tc-detail" data-label="Bid Amount">₱${fmt(b.bidAmount||b.contractAmount||0)}</td><td class="tc-net"><span style="color:${sc};font-weight:600">${b.status||'pending'}</span></td><td class="tc-detail" data-label="Date">${d.toLocaleDateString('en-PH')}</td></tr>`;
        }).join('')}</tbody>
      </table></div>`:`<p style="color:var(--text-muted);padding:16px;text-align:center">No bidding records found. Add records to the <code>gov_biddings</code> collection in Firestore.</p>`}</div></div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [wrap] });
    wrap.querySelectorAll('tr.gov-bid-row').forEach(tr => tr.addEventListener('click', () => tr.classList.toggle('tc-expanded')));
    if (!window.Chart) { await window.ensureChart(); }
    new Chart(document.getElementById('gov-outcome-chart'),{type:'doughnut',data:{labels:['Won','Lost','Pending'],datasets:[{data:[wonBids.length,lostBids.length,pendingBids.length],backgroundColor:[CT.good,CT.bad,CT.warn],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:CT.text}}}}});
    const govStatuses=['todo','in-progress','review','done'];
    if (!window.Chart) { await window.ensureChart(); }
    new Chart(document.getElementById('gov-task-chart'),{type:'bar',data:{labels:govStatuses.map(s=>s.charAt(0).toUpperCase()+s.slice(1)),datasets:[{data:govStatuses.map(s=>govTasks.filter(t=>t.status===s).length),backgroundColor:CT.accent}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{ticks:{color:CT.text},grid:{color:CT.grid}},x:{ticks:{color:CT.text},grid:{display:false}}}}});
  };

  // ── v12 WS40 Spec 4g — Strategy subtab: full conclusions, wire-in status,
  // market-research notes (decision 10). Reuses M/allClients/etc from the shared
  // renderAnalytics closure — zero new reads beyond Overview's own fetch, except
  // the ≤6-doc strategy_notes read (cached). No charts in v1 (no ensureChart).
  const STRAT_DEPTS = [
    {id:'general',label:'General'}, {id:'sales',label:'Sales'}, {id:'marketing',label:'Marketing'},
    {id:'production',label:'Production'}, {id:'finance',label:'Finance'}, {id:'gov',label:'Gov. Biddings'},
  ];
  // v1 ship matrix (Spec 8) — cross-referenced against V12-PLAN workstreams 28/29/30/32/36
  // so a later session knows exactly what "wires in" once each of those ships.
  const STRAT_SHIP_MATRIX = [
    ['Quote win rate (+ prev-period delta rule)', `${emojiIcon('✅',16)} live`, 'now (post-WS32 helpers)'],
    ['Bid win rate (Government)', `${emojiIcon('✅',16)} live`, 'now'],
    ['Payroll ratio (% of revenue)', `${emojiIcon('✅',16)} live`, 'now'],
    ['On-time task completion (Production)', `${emojiIcon('✅',16)} live`, 'now'],
    ['AR aging (due-date anchor + fallback)', `${emojiIcon('✅',16)} live`, 'now'],
    ['Conclusions card + Strategy tab + notes', `${emojiIcon('✅',16)} live`, 'now'],
    ['Theme-aware charts (13 sites)', `${emojiIcon('✅',16)} live`, 'now'],
    ['Daily digest (Actions cron → notif/push)', `${emojiIcon('✅',16)} live`, 'now (after secret check)'],
    ['Cash Position KPI', `${emojiIcon('🔲',16)} placeholder`, 'WS36 implemented + ≥1 bank account registered'],
    ['Inventory turns KPI + turns-slow rule', `${emojiIcon('🔲',16)} "—" until COS rows exist`, 'WS29 implemented (consume-time COS @ WAC)'],
    ['On-time DELIVERY % (second KPI)', `⛔ not built`, 'WS28 stageHistory (delivery enteredAt vs due date)'],
    ['Material price-trend insights', `⛔ not built`, 'WS29 movement cost trail + WS30 PO receiving'],
    ['Purchasing recommendations', `⛔ not built`, 'WS30 purchase_requisitions/receiving analytics'],
    ['job_costs materials in any metric', `⛔ excluded`, 'per WS29 decision 11(c) — third manual number, unreliable'],
  ];
  const renderStrategy = async () => {
    const wrap=document.getElementById('analytics-content');
    wrap.innerHTML = window.skeletonHtml('rows');
    const notesSnap = await cg('strategy_notes', db.collection('strategy_notes'));
    const notesByDept = {};
    notesSnap.docs.forEach(d=>{ notesByDept[d.id] = d.data(); });
    let activeDept = STRAT_DEPTS.some(d=>d.id===window._AN_STRAT_DEPT) ? window._AN_STRAT_DEPT : 'general';
    const canWrite = ['president','manager','finance'].includes(currentRole);

    const _sevColor = { bad: window.cssVar('--danger','#FF453A'), warn: window.cssVar('--warning','#FF9F0A'),
      info: window.cssVar('--text-muted','#8e8e93'), good: window.cssVar('--success','#30D158') };
    const _sevLabel = { bad:`${emojiIcon('🔴',16)} Needs attention`, warn:`${emojiIcon('🟠',16)} Watch`, info:`${emojiIcon('🔵',16)} Notable`, good:`${emojiIcon('🟢',16)} On track` };
    const allInsights = window.Insights.compute(M);   // uncapped — Overview shows a capped preview of the same list
    const insightsHtml = ['bad','warn','info','good'].map(sev => {
      const rows = allInsights.filter(i=>i.severity===sev);
      if (!rows.length) return '';
      return `<div style="margin-bottom:14px"><div style="font-size:11px;font-weight:700;color:${_sevColor[sev]};text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">${_sevLabel[sev]}</div>
        ${rows.map(i=>`<div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-size:16px;line-height:1.3">${i.icon}</span><div><div style="font-size:13px;color:${_sevColor[sev]}">${i.text}</div>${i.action?`<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${i.action}</div>`:''}</div></div>`).join('')}
      </div>`;
    }).join('');

    const shipRows = STRAT_SHIP_MATRIX.map(([m,s,a])=>`<tr><td data-label="Metric / feature">${escHtml(m)}</td><td data-label="v1 status">${escHtml(s)}</td><td data-label="Activates when" style="color:var(--text-muted);font-size:12px">${escHtml(a)}</td></tr>`).join('');

    const renderNotesFor = (deptId) => {
      const doc = notesByDept[deptId] || {};
      const entries = (doc.entries||[]).slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,30);
      return `
        <div style="max-height:340px;overflow:auto">
          ${entries.length? entries.map(e=>`<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px"><div style="color:var(--text-muted);font-size:11px">${escHtml(e.date||'')} · ${escHtml(e.byName||'—')}</div><div>${escHtml(e.note||'')}</div></div>`).join('') : `<p style="color:var(--text-muted);text-align:center;padding:16px">No notes yet for this department.</p>`}
        </div>
        ${canWrite ? `
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
          <textarea id="strat-note-text" rows="3" placeholder="Add a market-research note…" style="width:100%;resize:vertical"></textarea>
          <button class="btn-primary btn-sm" id="strat-note-add" style="align-self:flex-start">Add note</button>
        </div>` : ''}
      `;
    };

    wrap.innerHTML = `
      <div class="card" style="margin-top:16px;margin-bottom:16px"><div class="card-header"><h3>${emojiIcon('🎯',20)} Full Conclusions</h3></div><div class="card-body">${insightsHtml || '<p style="color:var(--text-muted);text-align:center;padding:16px">No insights yet.</p>'}</div></div>
      <div class="card" style="margin-bottom:16px"><div class="card-header"><h3>Wire-in status</h3></div><div class="card-body"><div class="table-wrap"><table class="data-table table-cards no-toggle">
        <thead><tr><th>Metric / feature</th><th>v1 status</th><th>Activates when</th></tr></thead>
        <tbody>${shipRows}</tbody>
      </table></div></div></div>
      <div class="card"><div class="card-header"><h3>${emojiIcon('📚',20)} Market Research Notes</h3></div><div class="card-body">
        <div id="strat-notes-tabs">${window.chipTabs(STRAT_DEPTS.map(d=>({key:d.id,label:d.label})), activeDept, {cls:'strat-notes-chips'})}</div>
        <div id="strat-notes-body" style="margin-top:10px">${renderNotesFor(activeDept)}</div>
      </div></div>
    `;
    if (window.lucide) lucide.createIcons({ nodes: [wrap] });

    const bindNoteAdd = () => {
      document.getElementById('strat-note-add')?.addEventListener('click', async () => {
        const ta = document.getElementById('strat-note-text');
        const text = (ta?.value||'').trim();
        if (!text) return;
        try {
          const entry = { date: window.bizDate(), by: currentUser.uid,
            byName: userProfile?.displayName || currentUser.email, note: text };
          await db.collection('strategy_notes').doc(activeDept).set({
            dept: activeDept,
            entries: firebase.firestore.FieldValue.arrayUnion(entry),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          dbCacheInvalidate('strategy_notes');
          Notifs.success('Note added');
          notesByDept[activeDept] = notesByDept[activeDept] || { entries: [] };
          notesByDept[activeDept].entries = [...(notesByDept[activeDept].entries||[]), entry];
          document.getElementById('strat-notes-body').innerHTML = renderNotesFor(activeDept);
          bindNoteAdd();
        } catch(e) { Notifs.showToast('Failed to add note: ' + (e.message||e), 'error'); }
      });
    };
    bindNoteAdd();

    window.bindChipTabs(document.getElementById('strat-notes-tabs'), (key) => {
      activeDept = key; window._AN_STRAT_DEPT = key;
      document.getElementById('strat-notes-body').innerHTML = renderNotesFor(activeDept);
      bindNoteAdd();
    });
  };

  const TAB_RENDERERS = {
    overview: renderOverview,
    sales: renderSales,
    marketing: renderMarketing,
    finance: renderFinanceAnalytics,
    production: renderProduction,
    government: renderGovernment,
    strategy: renderStrategy,
  };

  // Wire subtab clicks
  window.bindChipTabs(c.querySelector('.an-subtabs'), (key)=>{
    // Destroy existing charts before swapping tabs so Chart.js doesn't leak canvases.
    if(window.Chart) document.getElementById('analytics-content')?.querySelectorAll('canvas').forEach(cv=>{const ex=Chart.getChart(cv);if(ex)ex.destroy();});
    TAB_RENDERERS[key]?.();
  });

  // v12 WS40 Spec 1b (RE-GROUNDED 5a) — re-render the active tab's charts with the
  // live theme's chrome colors on every 'bi-theme-change' (setTheme dispatches it,
  // including the 'auto' matchMedia flip). Self-removing once the Analytics subtab
  // bar is gone from the DOM (navigated away), mirroring the chart-disposal lifecycle above.
  const onTheme = () => {
    const bar = c.querySelector('.an-subtabs');
    if (!bar || !document.body.contains(bar)) { window.removeEventListener('bi-theme-change', onTheme); return; }
    const active = bar.querySelector('.chip-tab.active')?.dataset.chip || 'overview';
    (TAB_RENDERERS[active] || renderOverview)();
  };
  window.addEventListener('bi-theme-change', onTheme);

  // Load initial tab
  renderOverview();
}

// ── Team / Payroll ────────────────────────────────
async function renderTeam() {
  if(!isPresident()&&currentRole!=='manager'){document.getElementById('page-content').innerHTML=renderAccessDenied('Team');return;}
  const c=document.getElementById('page-content');
  c.innerHTML=`
    <div class="page-header">
      <h2>${emojiIcon('👥',20)} Team & Payroll</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn-secondary btn-sm" id="team-csv-btn">${emojiIcon('⬇',16)} CSV</button>
        <button class="btn-secondary btn-sm" id="add-worker-btn">${emojiIcon('👷',16)} Create Worker Account</button>
        <button class="btn-primary btn-sm" id="add-emp-btn">+ Add Employee Profile</button>
        ${(isPresident()||currentDepts.includes('IT'))?`<button class="btn-danger btn-sm" id="force-logout-all-btn">${emojiIcon('🔴',16)} Logout All</button>`:''}
      </div>
    </div>
    <div id="team-table">${window.skeletonHtml('table')}</div>`;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  // Short TTL here so the online/offline presence dots reflect "now", not a
  // stale snapshot left by another screen. Uses a DISTINCT key from the shared
  // 'users' cache (standardized at 30s) so its 8s freshness is deterministic.
  // Must use the payroll-aware fetcher so the Team table's Base/Allowance/Net
  // columns and the CSV export carry merged pay (pay lives in payroll/{uid}).
  // A rejected users read must not strand the Team table on "Loading…" —
  // every other fetchUsersWithPayroll call site catches; this one didn't.
  const snap=await dbCachedGet('users-presence', fetchUsersWithPayroll, 8000).catch(()=>({docs:[]}));
  const users=snap.docs.map(d=>({id:d.id,...d.data()}));
  const now = Date.now();
  const onlineThresholdMs = 3 * 60 * 1000; // 3 min = online
  const recentThresholdMs = 30 * 60 * 1000; // 30 min = recently active
  function getPresence(u) {
    const ls = u.lastSeen?.toDate ? u.lastSeen.toDate() : null;
    if (!ls) return { dot: 'gray', label: 'Unknown' };
    const diff = now - ls.getTime();
    if (diff < onlineThresholdMs) return { dot: 'green', label: 'Online' };
    if (diff < recentThresholdMs) return { dot: 'orange', label: Math.floor(diff/60000)+'m ago' };
    const hrs = Math.floor(diff/3600000);
    const days = Math.floor(diff/86400000);
    return { dot: 'gray', label: days>0?days+'d ago':hrs+'h ago' };
  }
  document.getElementById('team-table').innerHTML=`<div class="card"><div class="table-wrap"><table class="data-table table-cards" id="team-payroll-table">
    <thead><tr><th>Employee</th><th>Status</th><th>Username</th><th>ID</th><th>Role</th><th>Departments</th><th>Base</th><th>Net</th><th></th></tr></thead>
    <tbody>${users.map(u=>{const net=(u.salary||0)+(u.allowance||0)-(u.deductions||0);const depts=(Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join(', ')||'—';const pres=getPresence(u);return `<tr class="team-row">
      <td class="tc-name">${escHtml(u.displayName||u.email)} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
      <td class="tc-detail" data-label="Status"><span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text-muted)"><span style="width:8px;height:8px;border-radius:50%;background:${pres.dot==='green'?'var(--presence-online)':pres.dot==='orange'?'var(--presence-away)':'#636366'};flex-shrink:0${pres.dot==='green'?';box-shadow:0 0 0 2px rgba(48,209,88,0.3)':''};display:inline-block"></span>${pres.label}</span></td>
      <td class="tc-detail" data-label="Username">${u.username?`<code style="font-size:11px">${escHtml(u.username)}</code>`:'<span style="color:var(--text-muted);font-size:11px">email login</span>'}</td>
      <td class="tc-detail" data-label="ID"><code style="font-size:11px">${escHtml(u.employeeId||'—')}</code></td>
      <td class="tc-detail" data-label="Role"><span class="badge badge-blue">${escHtml(ROLES[u.role]?.label||u.role)}</span></td>
      <td class="tc-detail" data-label="Departments">${escHtml(depts)}</td>
      <td class="tc-detail" data-label="Base">₱${formatNum(u.salary)}</td>
      <td class="tc-net"><strong>₱${formatNum(net)}</strong></td>
      <td class="tc-actions"><button class="btn-icon edit-emp-btn" data-uid="${u.id}" title="Edit employee" aria-label="Edit ${escHtml(u.displayName||u.email)}"><i data-lucide="pencil" style="width:14px;height:14px;stroke:currentColor"></i></button></td>
    </tr>`;}).join('')}</tbody>
  </table></div></div>`;
  document.querySelectorAll('.edit-emp-btn').forEach(btn=>btn.addEventListener('click',()=>{const u=users.find(x=>x.id===btn.dataset.uid);if(u)openEditEmployeeModal(u);}));
  // Card view (≤700px): tap a row (outside its edit button) to reveal the
  // full breakdown — same tap-to-expand idiom as the shared .table-cards
  // pattern (mirrors hr.js loadPayrollTable).
  document.querySelectorAll('#team-payroll-table tr.team-row').forEach(tr => {
    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('button, a')) return;
      tr.classList.toggle('tc-expanded');
    });
  });
  document.getElementById('add-emp-btn').addEventListener('click', openAddEmployeeModal);
  document.getElementById('add-worker-btn').addEventListener('click', openCreateWorkerModal);
  document.getElementById('team-csv-btn')?.addEventListener('click', () => window.exportCSV('team-payroll', users, [
    { key:'displayName', label:'Name', get:u=>u.displayName||u.email },
    { key:'username', label:'Username' }, { key:'employeeId', label:'Employee ID' },
    { key:'role', label:'Role', get:u=>ROLES[u.role]?.label||u.role },
    { key:'departments', label:'Departments', get:u=>(Array.isArray(u.departments)&&u.departments.length?u.departments:u.department?[u.department]:[]).join('; ') },
    { key:'salary', label:'Base', get:u=>u.salary||0 }, { key:'allowance', label:'Allowance', get:u=>u.allowance||0 },
    { key:'deductions', label:'Deductions', get:u=>u.deductions||0 },
    { key:'net', label:'Net', get:u=>(u.salary||0)+(u.allowance||0)-(u.deductions||0) },
  ]));
  document.getElementById('force-logout-all-btn')?.addEventListener('click', async () => {
    if (!await confirmDialog({ message: 'This will immediately sign out ALL active members. Continue?', danger: true })) return;
    await db.collection('settings').doc('system').set({
      forceLogoutAt: firebase.firestore.FieldValue.serverTimestamp(),
      excludeUid: currentUser.uid,
      triggeredBy: currentUser.uid
    }, { merge: true });
    Notifs.showToast('All members have been logged out.', 'success');
  });
  if (window.lucide) lucide.createIcons({ nodes: [document.getElementById('team-table')] });
}

function openAddEmployeeModal() {
  openPage('Add Employee Profile',`
    <p style="font-size:12px;color:var(--text-muted);background:var(--surface2);padding:10px;border-radius:8px;margin-bottom:14px">Adds a profile record only. Use <strong>${emojiIcon('👷',16)} Create Worker Account</strong> to also create a username login.</p>
    <div class="form-group"><label>Display Name</label><input id="emp-name"/></div>
    <div class="form-group"><label>Email (if they have one)</label><input id="emp-email" type="email"/></div>
    <div class="form-group"><label>Employee ID</label><input id="emp-eid" placeholder="e.g. BI-2026-001"/></div>
    <div class="form-row">
      <div class="form-group"><label>Role</label><select id="emp-role">${Object.entries(ROLES).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></div>
      <div class="form-group"><label>Primary Dept</label><select id="emp-dept"><option value="">None</option>${Object.keys(DEPARTMENTS).map(k=>`<option value="${k}">${k}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label>Secondary Dept (if dual)</label><select id="emp-dept2"><option value="">None</option>${Object.keys(DEPARTMENTS).map(k=>`<option value="${k}">${k}</option>`).join('')}</select></div>
    <div class="form-group"><label>Job Title</label><input id="emp-title"/></div>
    <div class="form-row">
      <div class="form-group"><label>Base Salary (₱)</label><input id="emp-salary" type="number" inputmode="decimal" value="0"/></div>
      <div class="form-group"><label>Allowance (₱)</label><input id="emp-allow" type="number" inputmode="decimal" value="0"/></div>
    </div>
    <div class="form-group"><label>Deductions (₱)</label><input id="emp-deduct" type="number" inputmode="decimal" value="0"/></div>
    <div class="form-group"><label>Start Date</label><input id="emp-start" type="date" value="${bizDate()}"/></div>
  `,`<button class="btn-primary" id="save-emp-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  document.getElementById('save-emp-btn').addEventListener('click',async()=>{
    const dept1=document.getElementById('emp-dept').value;
    const dept2=document.getElementById('emp-dept2').value;
    const depts=[dept1,dept2].filter(Boolean);
    const ref = await db.collection('users').add({
      displayName:document.getElementById('emp-name').value.trim(),
      email:document.getElementById('emp-email').value.trim(),
      employeeId:document.getElementById('emp-eid').value.trim(),
      role:document.getElementById('emp-role').value,
      departments:depts, department:depts[0]||'',
      title:document.getElementById('emp-title').value.trim(),
      startDate:document.getElementById('emp-start').value,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    // Pay lives in the protected payroll/{uid} collection, keyed by the user doc id.
    await db.collection('payroll').doc(ref.id).set({
      salary:parseFloat(document.getElementById('emp-salary').value)||0,
      allowance:parseFloat(document.getElementById('emp-allow').value)||0,
      deductions:parseFloat(document.getElementById('emp-deduct').value)||0,
    });
    window.logAudit && window.logAudit('create','payroll',ref.id,{ salary:parseFloat(document.getElementById('emp-salary').value)||0 });
    dbCacheInvalidate('users'); dbCacheInvalidate('users-presence'); closeModal(); renderTeam();
  });
}

// ── Secondary Firebase app — used only for creating/updating worker accounts
//    so HR's own session is never interrupted
function _getWorkerAuth() {
  try { return firebase.app('worker-admin').auth(); }
  catch { return firebase.initializeApp(window.firebaseConfig, 'worker-admin').auth(); }
}

// ── Create Worker Account (username + password, no email required) ────────
function openCreateWorkerModal() {
  const suggestUsername = () => {
    const name = document.getElementById('cw-name')?.value.trim() || '';
    const parts = name.toLowerCase().replace(/[^a-z0-9 ]/g,'').split(/\s+/).filter(Boolean);
    let uname = '';
    if (parts.length >= 2) uname = parts[0][0] + parts[parts.length-1]; // e.g. jdelacruz
    else if (parts.length === 1) uname = parts[0];
    const el = document.getElementById('cw-username');
    if (el && !el._edited) el.value = uname;
  };

  const initialPw = generatePassword('worker');

  openPage(`${emojiIcon('👷',16)} Create Worker Account`, `
    <p style="font-size:12px;color:var(--text-muted);background:var(--surface2);padding:10px;border-radius:8px;margin-bottom:14px">
      Creates a username + password login. The worker does <strong>not</strong> need an email address.
      HR manages all credentials.
    </p>
    <div class="form-row">
      <div class="form-group"><label>Full Name <span style="color:var(--danger)">*</span></label><input id="cw-name" placeholder="e.g. Juan dela Cruz"/></div>
      <div class="form-group"><label>Employee ID</label><input id="cw-eid" placeholder="BI-2026-001"/></div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Username <span style="color:var(--danger)">*</span></label>
        <input id="cw-username" placeholder="e.g. jdelacruz" autocomplete="off" style="text-transform:lowercase"/>
        <div style="font-size:11px;color:var(--text-muted);margin-top:3px">Letters and numbers only. Auto-suggested from name.</div>
      </div>
      <div class="form-group">
        <label>Initial Password <span style="color:var(--danger)">*</span></label>
        <div style="display:flex;gap:6px;align-items:center">
          <input id="cw-password" value="${initialPw}" autocomplete="off" style="flex:1"/>
          <button type="button" class="btn-secondary btn-sm" id="cw-regen-pw" title="Generate new password">${emojiIcon('🔄',16)}</button>
        </div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Role</label><select id="cw-role">${Object.entries(ROLES).map(([k,v])=>`<option value="${k}" ${k==='employee'?'selected':''}>${v.label}</option>`).join('')}</select></div>
      <div class="form-group"><label>Primary Department</label><select id="cw-dept"><option value="">None</option>${Object.keys(DEPARTMENTS).map(k=>`<option value="${k}">${k}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label>Job Title</label><input id="cw-title" placeholder="e.g. Machine Operator"/></div>
    <div class="form-row">
      <div class="form-group"><label>Base Salary (₱)</label><input id="cw-salary" type="number" inputmode="decimal" value="0"/></div>
      <div class="form-group"><label>Allowance (₱)</label><input id="cw-allow" type="number" inputmode="decimal" value="0"/></div>
    </div>
    <div class="form-group"><label>Start Date</label><input id="cw-start" type="date" value="${bizDate()}"/></div>
    <div id="cw-error" class="error-msg hidden" style="margin-top:8px"></div>
  `, `<button class="btn-primary" id="cw-save-btn">Create Account</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  // Auto-suggest username from name
  document.getElementById('cw-name').addEventListener('input', suggestUsername);
  document.getElementById('cw-username').addEventListener('input', () => {
    document.getElementById('cw-username')._edited = true;
  });
  document.getElementById('cw-username').addEventListener('input', e => {
    e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,'');
  });
  document.getElementById('cw-regen-pw').addEventListener('click', () => {
    document.getElementById('cw-password').value = generatePassword('worker' + Date.now());
  });

  document.getElementById('cw-save-btn').addEventListener('click', async () => {
    const btn  = document.getElementById('cw-save-btn');
    const errEl= document.getElementById('cw-error');
    errEl.classList.add('hidden');

    const name     = document.getElementById('cw-name').value.trim();
    const username = document.getElementById('cw-username').value.trim().toLowerCase();
    const password = document.getElementById('cw-password').value.trim();
    const role     = document.getElementById('cw-role').value;
    const dept     = document.getElementById('cw-dept').value;
    const title    = document.getElementById('cw-title').value.trim();
    const salary   = parseFloat(document.getElementById('cw-salary').value)||0;
    const allow    = parseFloat(document.getElementById('cw-allow').value)||0;
    const eid      = document.getElementById('cw-eid').value.trim();
    const start    = document.getElementById('cw-start').value;

    if (!name)     { errEl.textContent='Full name is required.'; errEl.classList.remove('hidden'); return; }
    if (!username) { errEl.textContent='Username is required.'; errEl.classList.remove('hidden'); return; }
    if (!password) { errEl.textContent='Password is required.'; errEl.classList.remove('hidden'); return; }

    // Check username uniqueness against the canonical usernames/{u} map
    // (v12 WS19) — a single doc get, and the source login itself resolves from.
    const unameTaken = await db.collection('usernames').doc(username).get();
    if (unameTaken.exists) { errEl.textContent='Username already taken. Choose another.'; errEl.classList.remove('hidden'); return; }

    btn.disabled = true; btn.textContent = 'Creating…';

    // Auth email is synthetic — worker never needs to see or use this
    const authEmail = `${username}@bi.barroindustries`;
    try {
      // Create Firebase Auth account via secondary app (doesn't affect HR's session)
      const workerAuth = _getWorkerAuth();
      const cred = await workerAuth.createUserWithEmailAndPassword(authEmail, password);
      const uid  = cred.user.uid;
      await workerAuth.signOut();

      // Write Firestore profile using the Auth UID as the doc ID
      await db.collection('users').doc(uid).set({
        displayName: name,
        username:    username,
        authEmail:   authEmail,
        email:       authEmail,        // fallback for any email display
        employeeId:  eid,
        role, department: dept, departments: dept ? [dept] : [],
        title,
        startDate:   start,
        hrManagedAccount: true,
        createdBy:   currentUser.uid,
        createdAt:   firebase.firestore.FieldValue.serverTimestamp()
      });
      // Keep the username -> email login map in sync (v12 WS19).
      await db.collection('usernames').doc(username).set({ email: authEmail, uid });
      // Pay → protected payroll/{uid} (keyed by Auth UID == users doc id).
      await db.collection('payroll').doc(uid).set({ salary, allowance: allow, deductions: 0 });
      window.logAudit && window.logAudit('create','payroll',uid,{ salary, allowance: allow });

      dbCacheInvalidate('users'); dbCacheInvalidate('users-presence');

      // Show credentials to HR — only time the password is displayed in full.
      // v14 Batch5 A3 — KEEP as openModal: a one-time info alert (no form, one
      // action), not detail/history content. This modal opens ON TOP OF the
      // "Create Worker Account" openPage (which is still on the stack — Batch1
      // 1c renders the modal above it correctly), so Done must close BOTH
      // surfaces, not just this modal. A bare closeModal() would only pop the
      // modal and reveal the stale, already-submitted form underneath. Use
      // Overlay.clearAll() (same pattern as the departments.js task-edit save)
      // to tear down both stacked entries in one shot, then refresh Team.
      openModal(`${emojiIcon('✅',16)} Worker Account Created`, `
        <p style="margin-bottom:12px">Hand these credentials to <strong>${escHtml(name)}</strong>:</p>
        <div style="background:var(--surface2);border:1.5px solid var(--border);border-radius:10px;padding:16px;font-family:monospace;font-size:15px;line-height:2">
          <div>Username: <strong style="color:var(--primary-light)">${escHtml(username)}</strong></div>
          <div>Password: <strong style="color:var(--primary-light)">${escHtml(password)}</strong></div>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin-top:10px">${emojiIcon('⚠️',12)} Write this down now. The password won't be shown again in plain text.</p>
      `, `<button class="btn-primary" onclick="Overlay.clearAll();renderTeam()">Done</button>`);
    } catch(err) {
      btn.disabled = false; btn.textContent = 'Create Account';
      errEl.textContent = err.code === 'auth/email-already-in-use'
        ? 'Username already registered. Choose another.'
        : (err.message || 'Account creation failed.');
      errEl.classList.remove('hidden');
    }
  });
}

function openEditEmployeeModal(u) {
  const curDepts = Array.isArray(u.departments)&&u.departments.length ? u.departments : u.department ? [u.department] : [];
  openPage(`Edit: ${u.displayName||u.email}`,`
    ${u.username ? `
    <div style="background:var(--surface2);border-radius:8px;padding:10px 12px;margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span style="font-size:13px">${emojiIcon('👷',13)} Worker account — login: <strong style="color:var(--primary-light)">${escHtml(u.username)}</strong></span>
      <button class="btn-secondary btn-sm" id="eu-reset-pw-btn" style="margin-left:auto">${emojiIcon('🔑',16)} Reset Password</button>
    </div>` : ''}
    <div class="form-group"><label>Display Name</label><input id="eu-name" value="${escHtml(u.displayName||'')}"/></div>
    <div class="form-group"><label>Employee ID</label><input id="eu-eid" value="${escHtml(u.employeeId||'')}"/></div>
    <div class="form-group"><label>Job Title</label><input id="eu-title" value="${escHtml(u.title||'')}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Role</label><select id="eu-role">${Object.entries(ROLES).map(([k,v])=>`<option value="${k}" ${u.role===k?'selected':''}>${v.label}</option>`).join('')}</select></div>
      <div class="form-group"><label>Primary Dept</label><select id="eu-dept"><option value="">None</option>${Object.keys(DEPARTMENTS).map(k=>`<option value="${k}" ${curDepts[0]===k?'selected':''}>${k}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label>Secondary Dept</label><select id="eu-dept2"><option value="">None</option>${Object.keys(DEPARTMENTS).map(k=>`<option value="${k}" ${curDepts[1]===k?'selected':''}>${k}</option>`).join('')}</select></div>
    <div class="form-row">
      <div class="form-group"><label>Base Salary (₱)</label><input id="eu-salary" type="number" inputmode="decimal" value="${u.salary||0}"/></div>
      <div class="form-group"><label>Allowance (₱)</label><input id="eu-allow" type="number" inputmode="decimal" value="${u.allowance||0}"/></div>
    </div>
    <div class="form-group"><label>Deductions (₱)</label><input id="eu-deduct" type="number" inputmode="decimal" value="${u.deductions||0}"/></div>
  `,`<button class="btn-primary" id="save-eu-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  document.getElementById('save-eu-btn').addEventListener('click',async()=>{
    const dept1=document.getElementById('eu-dept').value;
    const dept2=document.getElementById('eu-dept2').value;
    const depts=[dept1,dept2].filter(Boolean);
    await db.collection('users').doc(u.id).update({
      displayName:document.getElementById('eu-name').value.trim(),
      employeeId:document.getElementById('eu-eid').value.trim(),
      title:document.getElementById('eu-title').value.trim(),
      role:document.getElementById('eu-role').value,
      departments:depts, department:depts[0]||'',
    });
    // Pay is stored in the protected payroll/{uid} collection (finance/admin write).
    await db.collection('payroll').doc(u.id).set({
      salary:parseFloat(document.getElementById('eu-salary').value)||0,
      allowance:parseFloat(document.getElementById('eu-allow').value)||0,
      deductions:parseFloat(document.getElementById('eu-deduct').value)||0,
    }, {merge:true});
    window.logAudit && window.logAudit('update','payroll',u.id,{ salary:parseFloat(document.getElementById('eu-salary').value)||0 });
    dbCacheInvalidate('users'); dbCacheInvalidate('users-presence'); closeModal(); renderTeam();
  });

  // Reset Password (worker accounts only)
  // v14 Batch5 A3 — KEEP as openModal: a small single-field quick sheet nested
  // over the Edit Employee openPage. Its follow-up "Password Reset" success
  // screen below is also openModal, so Batch1 1b's modal-over-modal swap
  // (Overlay.replaceTop) reuses this SAME Overlay entry for the success
  // content — one closeModal() from either screen pops exactly one entry and
  // reveals Edit Employee underneath. Converting either half to openPage
  // would lose that free in-place swap and require opts.replace plumbing for
  // no UX gain, so both stay modals.
  document.getElementById('eu-reset-pw-btn')?.addEventListener('click', () => {
    const newPw = generatePassword(u.displayName||'worker');
    openModal(`${emojiIcon('🔑',16)} Reset Password`, `
      <p style="margin-bottom:10px">Set a new password for <strong>${escHtml(u.displayName)}</strong> (username: <code>${escHtml(u.username)}</code>).</p>
      <div class="form-group">
        <label>New Password</label>
        <div style="display:flex;gap:6px">
          <input id="rp-newpw" value="${escHtml(newPw)}" style="flex:1" autocomplete="off"/>
          <button type="button" class="btn-secondary btn-sm" id="rp-regen" aria-label="Regenerate">${emojiIcon('🔄',16)}</button>
        </div>
      </div>
      <div id="rp-error" class="error-msg hidden" style="margin-top:8px"></div>
    `, `<button class="btn-primary" id="rp-save-btn">Set Password</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

    document.getElementById('rp-regen').addEventListener('click', () => {
      document.getElementById('rp-newpw').value = generatePassword(u.displayName||'worker'+Date.now());
    });

    document.getElementById('rp-save-btn').addEventListener('click', async () => {
      const errEl  = document.getElementById('rp-error');
      const saveBtn= document.getElementById('rp-save-btn');
      errEl.classList.add('hidden');
      const newPassword = document.getElementById('rp-newpw').value.trim();
      if (!newPassword || newPassword.length < 6) {
        errEl.textContent = 'Password must be at least 6 characters.'; errEl.classList.remove('hidden'); return;
      }

      saveBtn.disabled = true; saveBtn.textContent = 'Resetting…';
      try {
        // Server-side reset via Admin SDK — no password is ever stored or recovered.
        const resetFn = firebase.functions().httpsCallable('adminResetPassword');
        await resetFn({ targetUid: u.id, newPassword });
        window.logAudit && window.logAudit('reset','password',u.id,{ name:u.displayName||'' });  // never log the password

        openModal(`${emojiIcon('✅',16)} Password Reset`, `
          <p style="margin-bottom:12px">New credentials for <strong>${escHtml(u.displayName)}</strong>:</p>
          <div style="background:var(--surface2);border:1.5px solid var(--border);border-radius:10px;padding:16px;font-family:monospace;font-size:15px;line-height:2">
            <div>Username: <strong style="color:var(--primary-light)">${escHtml(u.username)}</strong></div>
            <div>Password: <strong style="color:var(--primary-light)">${escHtml(newPassword)}</strong></div>
          </div>
          <p style="font-size:12px;color:var(--text-muted);margin-top:10px">${emojiIcon('⚠️',12)} Write this down and hand it to the employee.</p>
        `, `<button class="btn-primary" onclick="closeModal()">Done</button>`);
      } catch(err) {
        saveBtn.disabled = false; saveBtn.textContent = 'Set Password';
        // HttpsError messages from the callable are surfaced verbatim
        // (e.g. permission-denied, not-found, weak password).
        errEl.textContent = err.message || 'Reset failed.';
        errEl.classList.remove('hidden');
      }
    });
  });
}

// ── Mini Calendar ─────────────────────────────────
let _calMonthOffset = 0;
async function renderMiniCal() {
  const el=document.getElementById('mini-cal'); if(!el) return;
  // Open tasks with due dates → event dots on the calendar (only the current user's tasks)
  let tasks=[];
  const uid=currentUser&&currentUser.uid;
  if(uid){
    try {
      const fetcher=()=>db.collection('tasks').where('assignedTo','array-contains',uid).get()
        .catch(()=>db.collection('tasks').where('assignedTo','==',uid).get());
      const snap=await (typeof dbCachedGet==='function' ? dbCachedGet('tasks-cal-'+uid,fetcher,30000) : fetcher());
      tasks=snap.docs.map(d=>({id:d.id,...d.data()})).filter(t=>t.dueDate && !['done','approved','archived'].includes(t.status));
    } catch(_) {}
  }
  const todayStr=(typeof bizDate==='function'?bizDate():new Date().toISOString().slice(0,10));
  // Anchor the calendar to the Manila current month (+ user nav offset), so the
  // grid doesn't jump a month near the UTC midnight boundary.
  const base=new Date(+todayStr.slice(0,4), +todayStr.slice(5,7)-1, 1); base.setMonth(base.getMonth()+_calMonthOffset);
  const year=base.getFullYear(), month=base.getMonth();
  const firstDay=new Date(year,month,1).getDay(); const days=new Date(year,month+1,0).getDate();
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const pad=n=>String(n).padStart(2,'0');
  const ym=`${year}-${pad(month+1)}`;
  const byDay={};
  tasks.forEach(t=>{ if((t.dueDate||'').slice(0,7)===ym){ const d=parseInt(t.dueDate.slice(8,10),10); (byDay[d]=byDay[d]||[]).push(t); } });
  el.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-weight:700;font-size:14px">
      <button class="cal-nav" data-dir="-1" style="background:none;border:none;color:var(--text);cursor:pointer;font-size:18px;line-height:1;padding:2px 10px;border-radius:8px">‹</button>
      <span>${months[month]} ${year}</span>
      <button class="cal-nav" data-dir="1" style="background:none;border:none;color:var(--text);cursor:pointer;font-size:18px;line-height:1;padding:2px 10px;border-radius:8px">›</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center">
      ${['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=>`<div style="font-size:10px;font-weight:700;color:var(--text-muted);padding:4px">${d}</div>`).join('')}
      ${Array(firstDay).fill('<div></div>').join('')}
      ${Array.from({length:days},(_,i)=>{const day=i+1;const ds=`${ym}-${pad(day)}`;const isToday=ds===todayStr;const cnt=(byDay[day]||[]).length;
        return `<div class="cal-day" data-date="${ds}" style="position:relative;padding:6px 2px;border-radius:10px;font-size:12px;cursor:${cnt?'pointer':'default'};${isToday?'background:var(--primary);color:var(--white,#fff);font-weight:700':cnt?'background:var(--surface2)':''}">${day}${cnt?`<span style="position:absolute;bottom:3px;left:50%;transform:translateX(-50%);width:5px;height:5px;border-radius:50%;background:${isToday?'var(--white,#fff)':'var(--danger)'}"></span>`:''}</div>`;}).join('')}
    </div>
    <div id="cal-day-detail" style="margin-top:10px;font-size:12px;color:var(--text-muted);min-height:16px"></div>`;
  el.querySelectorAll('.cal-nav').forEach(b=>b.addEventListener('click',()=>{ _calMonthOffset+=parseInt(b.dataset.dir,10); renderMiniCal(); }));
  el.querySelectorAll('.cal-day').forEach(c=>c.addEventListener('click',()=>{
    const day=parseInt(c.dataset.date.slice(8,10),10); const dayTasks=byDay[day]||[];
    const det=document.getElementById('cal-day-detail'); if(!det) return;
    det.innerHTML = dayTasks.length
      ? `<div style="font-weight:700;color:var(--text);margin-bottom:3px">${emojiIcon('📅',16)} ${c.dataset.date} — ${dayTasks.length} due</div>${dayTasks.slice(0,4).map(t=>`<div>• ${escHtml(t.title)}</div>`).join('')}<a style="color:var(--primary);cursor:pointer;font-weight:600" onclick="navigateTo('tasks')">View all tasks →</a>`
      : '';
    if (window.lucide) lucide.createIcons({ nodes: [det] });
  }));
}

// ── Helpers ───────────────────────────────────────
function renderAccessDenied(section) {
  return `<div class="access-denied"><div class="ad-icon">${emojiIcon('🔒',16)}</div><h3>Access Restricted</h3><p>You don't have access to ${section}.</p></div>`;
}
function formatNum(n) { return Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}); }

// ── Suggestion Box ────────────────────────────────
async function renderSuggestionBox(wrap) {
  const pres = isRealPresident();
  wrap.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-header" style="display:flex;align-items:center;gap:10px">
        <span style="font-size:20px">${emojiIcon('💡',20)}</span>
        <div>
          <h3 style="margin:0">Suggestion Box</h3>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Share ideas, feedback, or concerns — ${pres ? 'all submissions shown below' : 'submitted anonymously to the president'}</div>
        </div>
      </div>
      <div class="card-body">
        <div class="form-group" style="margin-bottom:10px">
          <label style="font-size:12px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.4px">Category</label>
          <select id="sug-category" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
            <option value="General">General</option>
            <option value="Operations">Operations</option>
            <option value="Payroll & Benefits">Payroll & Benefits</option>
            <option value="Work Environment">Work Environment</option>
            <option value="Tools & Systems">Tools & Systems</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:14px">
          <label style="font-size:12px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.4px">Your Suggestion</label>
          <textarea id="sug-text" rows="4" placeholder="Type your suggestion or feedback here…" style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);resize:vertical;box-sizing:border-box"></textarea>
        </div>
        <button class="btn-primary" id="sug-submit-btn" style="width:100%">Submit Anonymously</button>
        <div id="sug-msg" style="margin-top:10px;font-size:13px;text-align:center;display:none"></div>
      </div>
    </div>
    ${pres ? `<div class="card"><div class="card-header"><h3>All Submissions</h3></div><div class="card-body" id="sug-list">${window.skeletonHtml('rows')}</div></div>` : ''}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [wrap] });

  document.getElementById('sug-submit-btn').addEventListener('click', async () => {
    const text = document.getElementById('sug-text').value.trim();
    const category = document.getElementById('sug-category').value;
    const msg = document.getElementById('sug-msg');
    if (!text) { msg.style.display='block'; msg.style.color='var(--danger)'; msg.textContent='Please write something first.'; return; }
    document.getElementById('sug-submit-btn').disabled = true;
    await db.collection('suggestions').add({
      text,
      category,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await Notifs.sendToOwner({ title:'💡 New Suggestion', body:`New "${category}" suggestion submitted.`, icon:'💡', type:'suggestion' });
    document.getElementById('sug-text').value = '';
    msg.style.display = 'block'; msg.style.color = 'var(--success)';
    msg.textContent = '✓ Submitted! Thank you for your feedback.';
    document.getElementById('sug-submit-btn').disabled = false;
    if (pres) loadSuggestions();
  });

  if (pres) loadSuggestions();
}

async function loadSuggestions() {
  const list = document.getElementById('sug-list');
  if (!list) return;
  const snap = await db.collection('suggestions').orderBy('createdAt','desc').limit(50).get().catch(()=>({docs:[],empty:true}));
  if (snap.empty) { list.innerHTML = '<div class="empty-state" style="padding:24px 0">No suggestions yet.</div>'; return; }
  list.innerHTML = snap.docs.map(d => {
    const s = d.data();
    const ts = s.createdAt?.toDate ? s.createdAt.toDate().toLocaleString('en-PH',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
    return `
    <div style="padding:14px;background:var(--s2);border-radius:10px;margin-bottom:10px;border:1px solid var(--border)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--primary-light)">${escHtml(s.category||'General')}</span>
        <span style="font-size:11px;color:var(--text-muted)">${ts}</span>
      </div>
      <div style="font-size:14px;color:var(--text);line-height:1.55;white-space:pre-wrap">${escHtml(s.text||'')}</div>
      <button class="btn-secondary btn-sm sug-delete-btn" data-id="${d.id}" style="margin-top:8px;color:var(--danger);font-size:11px">Delete</button>
    </div>`;
  }).join('');
  list.querySelectorAll('.sug-delete-btn').forEach(btn => btn.addEventListener('click', async () => {
    if (!await confirmDialog({ message: 'Delete this suggestion?', danger: true })) return;
    await db.collection('suggestions').doc(btn.dataset.id).delete();
    loadSuggestions();
  }));
}

// ── Help / Guide ──────────────────────────────────
function renderHelp() {
  const c = document.getElementById('page-content');
  const bsOnly   = isBrilliantOnly();
  const extPartner = isPartner(); // external partner role
  const isAnyPartner = bsOnly || extPartner;
  const pres     = isPresident() || currentRole === 'manager' || currentRole === 'secretary';
  const section  = isAnyPartner ? 'partner' : pres ? 'admin' : 'employee';

  const sections = {
    admin:    renderHelpAdmin,
    employee: renderHelpEmployee,
    partner:  renderHelpPartner
  };

  c.innerHTML = `
    <div class="page-header">
      <h2>Help &amp; Guide</h2>
    </div>
    ${window.chipTabs(
      pres
        ? [{key:'admin',label:'Admin Guide'},{key:'employee',label:'Employee Guide'},{key:'partner',label:'Partner Guide'},{key:'storage',label:'Storage Setup'},{key:'suggestions',icon:emojiIcon('💡',16),label:'Suggestion Box'}]
        : isAnyPartner
          ? [{key:'partner',label:'Partner Guide'},{key:'suggestions',icon:emojiIcon('💡',16),label:'Suggestion Box'}]
          : [{key:'employee',label:'Your Guide'},{key:'suggestions',icon:emojiIcon('💡',16),label:'Suggestion Box'}],
      section, {cls:'help-tabs'}
    )}
    <div id="help-content"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });

  const load = (sub) => {
    const wrap = document.getElementById('help-content');
    if (sub === 'storage') {
      wrap.innerHTML = `<div class="card"><div class="card-body">
        <h3 style="margin-bottom:14px;font-size:16px">Storage System</h3>
        <div id="storage-status-wrap"></div>
        <div style="margin-top:20px;padding:16px;background:var(--s2);border-radius:var(--r);font-size:13px;line-height:1.7">
          <p style="font-weight:700;margin-bottom:8px">To activate Google Drive storage:</p>
          <ol style="padding-left:18px;color:var(--text-2)">
            <li>Go to <strong>console.cloud.google.com</strong></li>
            <li>Create a project → Enable <strong>Google Drive API</strong></li>
            <li>Create an <strong>API Key</strong> + <strong>OAuth 2.0 Client ID</strong></li>
            <li>Create a folder in Drive named <strong>BI-Operations</strong></li>
            <li>Paste credentials into <code>js/config.js</code> and set <code>DRIVE_ENABLED: true</code></li>
            <li>Redeploy to Netlify</li>
          </ol>
          <p style="margin-top:12px;color:var(--text-muted)">Full step-by-step instructions are in <code>GOOGLE_DRIVE_SETUP.md</code> in your project folder.</p>
        </div>
      </div></div>`;
      Drive.renderStorageStatus('storage-status-wrap');
    } else if (sub === 'suggestions') {
      renderSuggestionBox(wrap);
    } else if (sections[sub]) {
      wrap.innerHTML = sections[sub]();
      if (window.lucide) lucide.createIcons({ nodes: [wrap] });
    }
  };

  window.bindChipTabs(c.querySelector('.help-tabs'), (sub) => load(sub));

  load(section);
}

function renderHelpAdmin() {
  return `
  <div class="help-guide">
    <div class="help-hero">
      <div class="help-hero-icon" style="background:rgba(255,45,120,0.10)"><i data-lucide="shield" style="stroke:var(--pink);width:28px;height:28px"></i></div>
      <div><h2>Admin / President Guide</h2><p>Full command-center access to all features</p></div>
    </div>

    <div class="help-section">
      <h3><i data-lucide="log-in" class="help-h-icon"></i> Logging In</h3>
      <ol class="help-steps">
        <li>Open the app on your phone or browser</li>
        <li>Tap <strong>Admin</strong> on the login screen</li>
        <li>Enter your email and password → tap <strong>Sign In</strong></li>
        <li>You'll land on your <strong>Command Center</strong> dashboard</li>
      </ol>
    </div>

    <div class="help-section">
      <h3><i data-lucide="home" class="help-h-icon"></i> Command Center Dashboard</h3>
      <p>Your dashboard shows real-time business metrics at a glance:</p>
      <ul class="help-list">
        <li><strong>Red banner</strong> — overdue tasks that need immediate action. Tap to go straight to tasks.</li>
        <li><strong>Amber banner</strong> — pending approvals and cash advance requests waiting for your review.</li>
        <li><strong>KPI cards</strong> — team size, open tasks, overdue count, quote pipeline value, monthly payroll burn.</li>
        <li><strong>Live Task Feed</strong> — all open tasks sorted by urgency (overdue first → high priority). Tap "All Tasks" to manage them.</li>
        <li><strong>Quick Actions</strong> — one-tap shortcuts to New Task, Approvals, Team, and Progress Reports.</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="check-square" class="help-h-icon"></i> Managing Tasks</h3>
      <ol class="help-steps">
        <li>Tap <strong>Tasks</strong> in the sidebar → <strong>Departmental</strong> tab to see all team tasks</li>
        <li>Use the <strong>My Tasks</strong> tab for tasks assigned to you personally</li>
        <li>Tap <strong>+ New Task</strong> → fill in title, assignee, department, priority, due date</li>
        <li>Tasks with red dots = high priority. Tasks in red = overdue.</li>
        <li>Tap any task card to update status, add notes, or mark done</li>
      </ol>
    </div>

    <div class="help-section">
      <h3><i data-lucide="shield-check" class="help-h-icon"></i> Approvals</h3>
      <ul class="help-list">
        <li><strong>Quote / ROA tab</strong> — Brilliant Steel quote requests from agents. Review total, client name, agent. Tap Approve or Reject.</li>
        <li><strong>Cash Advances tab</strong> — Employee CA requests. See amount, repayment date, reason. Approve sends a notification to the employee.</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="users" class="help-h-icon"></i> Team &amp; Payroll</h3>
      <ol class="help-steps">
        <li>Go to <strong>Team &amp; Payroll</strong> in the sidebar</li>
        <li>See all employees with their salary breakdown (base, allowance, deductions, net)</li>
        <li>Tap ${emojiIcon('✏️',16)} to edit any employee's details, role, or pay</li>
        <li>Tap <strong>+ Add Employee</strong> → fill in their profile (create their login in Firebase Console first)</li>
        <li>Tap <strong>Record Payroll</strong> → select month → saves salary history for all employees</li>
      </ol>
    </div>

    <div class="help-section">
      <h3><i data-lucide="trending-up" class="help-h-icon"></i> Progress Reports</h3>
      <p>See each department's task completion rate, member KPIs, and attendance for the current month. Use the subtabs to drill into individual department members.</p>
    </div>

    <div class="help-section">
      <h3><i data-lucide="bar-chart-2" class="help-h-icon"></i> Analytics</h3>
      <p>Charts for task completion by department, team performance table, and monthly trends. Use this to spot underperforming departments or employees.</p>
    </div>

    <div class="help-section">
      <h3><i data-lucide="hard-drive" class="help-h-icon"></i> Files &amp; Storage</h3>
      <ul class="help-list">
        <li>All files uploaded in the app go to <strong>Google Drive</strong> (if configured) or <strong>Firebase Cloud Storage</strong></li>
        <li>Files are organized by department folder automatically</li>
        <li>Every file becomes a shareable link — tap the link to open in Drive viewer</li>
        <li>To set up Google Drive, tap the <strong>Storage Setup</strong> tab above</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="moon" class="help-h-icon"></i> Tips</h3>
      <ul class="help-list">
        <li>Tap your <strong>avatar</strong> in the topbar to open your profile drawer, then pick <strong>Light, Dark, or Astral</strong> from the theme picker (or leave it on Auto to follow your device)</li>
        <li>Tap your <strong>avatar</strong> in the topbar to update your profile photo and display name</li>
        <li>The app works offline — cached data loads even without signal</li>
        <li>Add to your home screen on iPhone: Safari → Share → Add to Home Screen</li>
      </ul>
    </div>
  </div>`;
}

function renderHelpEmployee() {
  return `
  <div class="help-guide">
    <div class="help-hero">
      <div class="help-hero-icon" style="background:var(--info-soft)"><i data-lucide="user" style="stroke:var(--blue);width:28px;height:28px"></i></div>
      <div><h2>Employee Guide</h2><p>Your personal dashboard for tasks, attendance, and pay</p></div>
    </div>

    <div class="help-section">
      <h3><i data-lucide="log-in" class="help-h-icon"></i> How to Log In</h3>
      <ol class="help-steps">
        <li>Open the app link your admin gave you (save it to your phone's home screen!)</li>
        <li>On the login screen, tap <strong>Employee</strong></li>
        <li>Enter your company email (e.g. <em>yourname@barroindustries.com</em>)</li>
        <li>Enter your password → tap <strong>Sign In</strong></li>
        <li>If you forgot your password → tap <strong>Forgot password?</strong> to get a reset email</li>
      </ol>
      <div class="help-tip">${emojiIcon('💡',16)} <strong>Tip:</strong> On iPhone, go to Safari → Share button → "Add to Home Screen" to install the app like a native app.</div>
    </div>

    <div class="help-section">
      <h3><i data-lucide="home" class="help-h-icon"></i> Your Dashboard</h3>
      <p>When you log in, you see your personal dashboard with:</p>
      <ul class="help-list">
        <li><strong>Attendance card</strong> — log your attendance for today (see below)</li>
        <li><strong>Net Pay</strong> — your current monthly take-home amount</li>
        <li><strong>Open Tasks</strong> — how many tasks are assigned to you right now</li>
        <li><strong>Task KPI</strong> — your performance score (tasks completed vs. total). Your target is shown below the percentage.</li>
        <li><strong>Task list</strong> — your most urgent open tasks. Red = overdue, orange = high priority.</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="calendar" class="help-h-icon"></i> Logging Attendance</h3>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:10px">Attendance is worth <strong>30%</strong> of your monthly pay. Both steps must be completed within the <strong>7:00–9:00 AM window</strong> each workday.</p>
      <ol class="help-steps">
        <li><strong>Step 1 — Time In (50%) · 7:00–9:00 AM:</strong> Open the app between 7am and 9am and tap <strong>Time In</strong> on your dashboard. This records that you showed up for work.</li>
        <li><strong>Step 2 — Check Notifications (100%) · before 9:00 AM:</strong> Tap the ${emojiIcon('🔔',16)} bell icon. Each notification has a checkbox — <strong>check every one individually.</strong> Once all are checked before 9am, your attendance automatically upgrades to 100%.</li>
        <li>Your attendance badge turns green (${emojiIcon('✅',16)}) when both steps are done.</li>
        <li><strong>Missed the window?</strong> If it is already past 9am and you have not yet timed in, tap <strong>${emojiIcon('⏰',16)} Request Time Extension</strong> on your dashboard. This sends a request to the president.</li>
        <li><strong>Extension approval:</strong> If the president approves, you will receive a notification and your dashboard will show a Time In button with an expiry time. You have <strong>6 hours from the time of approval</strong> to complete both steps.</li>
        <li><strong>Extension denied or expired:</strong> The day is recorded as absent. Maintain the habit of opening the app before 9am to avoid this.</li>
      </ol>
      <div class="help-tip">${emojiIcon('⚠️',16)} <strong>Key rules:</strong> The Time In window is <em>7:00–9:00 AM only</em>. You cannot time in before 7am or after 9am without an approved extension. Notifications must also be checked before 9am for full attendance. Always check each notification individually — there is no "mark all" shortcut.</div>
    </div>

    <div class="help-section">
      <h3><i data-lucide="check-square" class="help-h-icon"></i> Managing Your Tasks</h3>
      <ol class="help-steps">
        <li>Tap <strong>My Tasks</strong> in the bottom nav or sidebar</li>
        <li>You'll see all tasks assigned to you, sorted by urgency</li>
        <li>Tap any task to see the full details (description, due date, priority)</li>
        <li>When you finish a task, tap <strong>Mark Done</strong> — this improves your KPI score</li>
        <li>Use the filter dropdown to view open, done, or all tasks</li>
        <li>Tap <strong>+ New Task</strong> to create a task yourself</li>
      </ol>
      <div class="help-tip">${emojiIcon('💡',16)} <strong>Your KPI score</strong> = tasks completed ÷ total tasks assigned. Higher score = higher computed pay.</div>
    </div>

    <div class="help-section">
      <h3><i data-lucide="credit-card" class="help-h-icon"></i> Personal Finance &amp; Payslip</h3>
      <ol class="help-steps">
        <li>Tap <strong>Personal Finance</strong> in the sidebar</li>
        <li>See your <strong>base salary, allowances, deductions,</strong> and <strong>net pay</strong></li>
        <li>Your <strong>KPI</strong> and <strong>attendance scores</strong> are shown with progress bars</li>
        <li>The <strong>Computed Pay</strong> card shows your actual take-home after KPI adjustment</li>
        <li>Tap <strong>Generate Payslip PDF</strong> to print or save your payslip</li>
        <li><strong>Salary History</strong> section shows all past months' records</li>
      </ol>
    </div>

    <div class="help-section">
      <h3><i data-lucide="banknote" class="help-h-icon"></i> Requesting a Cash Advance</h3>
      <ol class="help-steps">
        <li>Go to <strong>Personal Finance</strong></li>
        <li>Tap <strong>+ Cash Advance</strong> in the top-right</li>
        <li>Enter the <strong>amount needed</strong>, <strong>date needed</strong>, <strong>repayment date</strong>, and <strong>reason</strong></li>
        <li>Tap <strong>Submit Request</strong></li>
        <li>Your request goes to the president for approval</li>
        <li>You'll receive an in-app notification when approved or declined</li>
      </ol>
    </div>

    <div class="help-section">
      <h3><i data-lucide="folder" class="help-h-icon"></i> Files</h3>
      <ul class="help-list">
        <li>Tap <strong>Files</strong> to see your department's shared files</li>
        <li>Tap the upload area to attach a file — it saves to Google Drive (or cloud storage) automatically</li>
        <li>Every uploaded file becomes a link — tap to open it</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="user" class="help-h-icon"></i> Your Profile</h3>
      <ul class="help-list">
        <li>Tap your <strong>avatar/initials</strong> in the top-right corner</li>
        <li>Tap your photo to upload a new profile picture</li>
        <li>You can update your display name here</li>
        <li>Your employee ID, role, and department are shown (not editable by you)</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="moon" class="help-h-icon"></i> Tips &amp; Shortcuts</h3>
      <ul class="help-list">
        <li>Use the <strong>bottom navigation bar</strong> for quick access to your most-used pages</li>
        <li>Open your <strong>profile drawer</strong> (tap your avatar) to switch between Light, Dark, and Astral themes</li>
        <li>The app works on any phone or computer browser — no app store needed</li>
        <li>You'll get push notifications for task deadlines and approval results</li>
      </ul>
    </div>
  </div>`;
}

function renderHelpPartner() {
  return `
  <div class="help-guide">
    <div class="help-hero">
      <div class="help-hero-icon" style="background:rgba(255,214,10,0.10)"><i data-lucide="handshake" style="stroke:var(--gold);width:28px;height:28px"></i></div>
      <div><h2>Partner Guide — Brilliant Steel</h2><p>Quote builder, client management, and file sharing</p></div>
    </div>

    <div class="help-section">
      <h3><i data-lucide="log-in" class="help-h-icon"></i> How to Log In</h3>
      <ol class="help-steps">
        <li>Open the app link provided by Barro Industries admin</li>
        <li>On the login screen, tap <strong>Partner</strong></li>
        <li>Enter your Brilliant Steel email address</li>
        <li>Enter your password → tap <strong>Sign In</strong></li>
        <li>Your account must be set up by Barro Industries admin first — contact them if you can't log in</li>
      </ol>
      <div class="help-tip">${emojiIcon('💡',16)} <strong>Tip:</strong> Save the app link to your phone's home screen for quick access. On iPhone: Safari → Share → "Add to Home Screen".</div>
    </div>

    <div class="help-section">
      <h3><i data-lucide="home" class="help-h-icon"></i> Your Dashboard</h3>
      <p>After logging in, you'll see your Brilliant Steel dashboard with:</p>
      <ul class="help-list">
        <li><strong>Quote pipeline value</strong> — total value of all quotes you've built</li>
        <li><strong>Quick access</strong> to Quote Builder, Quotations, and Client Data</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="calculator" class="help-h-icon"></i> Building a Quote</h3>
      <ol class="help-steps">
        <li>Tap <strong>Quotes</strong> in the bottom nav or <strong>Quote Builder</strong> in the sidebar</li>
        <li>Select or create a <strong>client</strong> from your client list</li>
        <li>Add <strong>line items</strong> — description, quantity, unit price. The total calculates automatically.</li>
        <li>Add any <strong>notes or terms</strong> at the bottom</li>
        <li>Tap <strong>Save Draft</strong> to save without sending</li>
        <li>When ready, tap <strong>Submit for Approval</strong> — this sends the quote to Barro Industries president for review</li>
        <li>You'll receive a notification when it's approved or returned for revision</li>
      </ol>
      <div class="help-tip">${emojiIcon('⚠️',16)} <strong>Note:</strong> Quotes are not final until approved by the Barro Industries president.</div>
    </div>

    <div class="help-section">
      <h3><i data-lucide="file-text" class="help-h-icon"></i> Quotations Summary</h3>
      <ul class="help-list">
        <li>See all your quotes with their current status: Draft, Sent, Accepted, Rejected</li>
        <li>Use the filter tabs to find quotes by status</li>
        <li>Tap any quote to view or edit it (drafts only)</li>
        <li>Approved quotes can be downloaded or shared as PDF</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="book-open" class="help-h-icon"></i> Client Data</h3>
      <ol class="help-steps">
        <li>Tap <strong>Clients</strong> in the sidebar</li>
        <li>See all your saved clients with contact information</li>
        <li>Tap <strong>+ Add Client</strong> to add a new client (name, company, email, phone)</li>
        <li>Tap any client to view their history and quotes</li>
      </ol>
    </div>

    <div class="help-section">
      <h3><i data-lucide="folder" class="help-h-icon"></i> Files</h3>
      <ul class="help-list">
        <li>Tap <strong>Files</strong> to access shared documents with Barro Industries</li>
        <li>Upload product specs, drawings, or documents — they save to the shared Google Drive folder</li>
        <li>Files from Barro Industries for you will also appear here</li>
        <li>All files become shareable links — tap to open in your browser</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="bell" class="help-h-icon"></i> Notifications</h3>
      <ul class="help-list">
        <li>Tap the <strong>bell icon</strong> in the top-right to see all notifications</li>
        <li>You'll be notified when a quote is approved, rejected, or needs revision</li>
        <li>Tap a notification to go directly to the relevant item</li>
        <li>Tap <strong>Mark all read</strong> to clear the badge count</li>
      </ul>
    </div>

    <div class="help-section">
      <h3><i data-lucide="help-circle" class="help-h-icon"></i> Need Help?</h3>
      <ul class="help-list">
        <li>Contact Barro Industries admin for account issues, password resets, or access problems</li>
        <li>For quote questions, use the in-app notification to message back on a quote</li>
      </ul>
    </div>
  </div>`;
}
