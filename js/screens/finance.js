/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Finance screens (Overview/Ledger/Journals/Bank
   Accounts/Reports/Taxes/Records/Cash Advances) + Finance Tools
   js/screens/finance.js

   Wave 7 Pass 8 — split out of js/departments.js verbatim, 2026-08-03,
   following the Wave 2 (design.js) / Wave 7 Pass 1-7 extraction
   protocol. Still plain `window.*`-attached globals, no ESM, no
   bundler — this file is a physical split only, not a module.

   HARD BOUNDARY (per the Wave 7 spec) — everything below is UI SHELL.
   The money-posting/service layer stays in js/departments.js and
   js/finance-ledger.js and is called from here only as a bare global
   at runtime (same forward-reference pattern every other pass in this
   wave documents — a plain top-level function/`window.*` assignment in
   a classic <script> resolves as a global regardless of which file
   defines it or load order, as long as the CALL happens after all
   scripts have parsed, which every call site below does — inside
   event handlers or async render functions, never at top-level
   script-parse time):
     - window.financeDelete / window.financeExecuteDelete /
       financeDeleteCascade — the delete-with-approval choke point.
     - postExpenseToLedger / postCRJToLedger / postCDJToLedger /
       resyncLedgerForSource / _findLedgerRowByRef (v14 renamed from
       _deleteLedgerRowByRef — now read-only, batch-based; see
       financeDeleteCascade's header in departments.js) — the ledger
       POSTING logic (expense/journal → ledger mirror).
     - window.assertPeriodOpen (js/config.js), window.closeFinancePeriod /
       window.reopenFinancePeriod — the period-close gate (read side in
       config.js, write side stays in departments.js as its
       symmetric counterpart, both money-control, not presentation).
     - window.Ledger.* (js/finance-ledger.js), window.BankAccounts.*
       and window.CashAdvance.* (js/config.js) — money services.
     - window.RaiseFlow (departments.js) — the raise-execution service.
     - window.computePayRun / window.disbursePayRun / window.reopenPayRun
       (departments.js) — payroll money math (Wave 7 Pass 3 boundary).
   None of the above are DEFINED in this file — every reference to them
   below is a CALL. See the pass report's money-math boundary proof for
   the full grep confirming zero service-function definitions moved.

   Contents (in original file order):
   - window.financeEditModal — generic edit modal for simple finance
     records (fields describe the form; on save does a plain
     collection.doc(docId).update(), no ledger involvement). Was
     physically adjacent to the finance delete services in
     departments.js (lines 287-482) but is itself pure UI — the one
     non-contiguous excerpt in this pass, called out explicitly in the
     Wave 7 spec's pass-8 scope.
   - FINANCE_GROUPS / FINANCE_KEY_TO_GROUP (the group→member chip-tab
     map), window.renderFinance, renderFinanceNav, openFinanceToolsPage
     (president-only maintenance page), window.runRebuildRollups (thin
     confirm+toast wrapper over window.Ledger.rebuildRollups),
     loadFinanceContent (the 17-case subtab dispatcher — untouched,
     still calls renderPayrollManagement/renderFinanceHRProfiles
     (js/screens/hr.js), renderPurchaseRequests (js/screens/
     production.js), renderSalesOrders (departments.js, deliberately
     shared with Sales — see sales.js's header), window.renderBIRTab/
     renderBalanceSheet/renderCashFlowReport/renderBankRec (js/bir.js),
     renderFileCollection/bindFileCollection/renderDeptTasks
     (departments.js, shared) as bare globals).
   - renderTaxesTab (window.renderFinanceCrudTable config for
     tax_records — the CRUD table renderer itself lives in
     js/ui-crud-table.js, out of this pass's scope, called as a bare
     global). Fixed a straggler: the file-attachment icon-only link in
     actionsExtra had no aria-label — added one (8-point item 5).
   - window.exportFinReportCSV, loadFinStatement, finCompareKeys,
     window.renderFinancialReports (Income Statement + VAT reference +
     compare-mode), window.openFinCategoryDrill (per-category
     drill-down page). Calls window.closeFinancePeriod/
     reopenFinancePeriod as bare globals (period-gate service, stays
     in departments.js).
   - renderLedgerTab (merged ledger + general_journal view). Calls
     window.Ledger.post (financeEditModal-driven manual journal entry)
     and window.financeDelete as bare globals.
   - window.renderBankAccounts, openBankAccountModal,
     renderBankAccountDrilldown — balances are DERIVED via
     window.BankAccounts.computeBalances (js/config.js service),
     nothing stored here can drift.
   - renderCashReceiptJournal, renderCashDisbursementJournal — both
     window.renderFinanceCrudTable configs whose afterSave hooks call
     postCRJToLedger/postCDJToLedger (stay in departments.js) and whose
     buildDoc guards call window.assertPeriodOpen (js/config.js).
   - renderRecordsTab (finance_records CRUD + the Accounting Documents
     file archive via renderFileCollection/bindFileCollection, shared
     globals).
   - openCADataRepairModal (UI wrapper over window.runCADataRepair,
     js/migrations.js) + renderFinanceCA (the Finance-admin Cash
     Advances tab — approve/reject/pay route through window.CashAdvance,
     edit/delete through financeEditModal/financeDelete). Fixed two
     stragglers here: the Pending/Active/All Records switcher was a
     hand-rolled `.subtab-bar` (8-point item 1 — converted to
     window.chipTabs/bindChipTabs) and the row edit/delete icon-only
     buttons had a `title` but no `aria-label` (8-point item 5 — added,
     matching the sibling ledger/bank-account row actions elsewhere in
     this file which already had it).
   - renderFinanceOverview (KPI totals from finance_rollup, Recent
     Expenses list with edit/delete via financeEditModal/financeDelete).

   Deliberately left as-is (documented, not fixed): the Income
   Statement table (renderFinancialReports) and the category
   drill-down table (openFinCategoryDrill) are dense multi-column
   report/print tables with colspan'd section rows and no per-cell
   `data-label` — NOT the same shape as the CRUD `.table-cards` pattern
   used elsewhere in this file (Ledger/Bank Accounts/Records/Overview),
   and retrofitting `.table-cards` without also adding `data-label` to
   every cell would silently break their mobile reflow. Left as
   scroll-on-mobile report tables, matching the precedent this wave's
   other passes set for print/report-shaped tables.

   Not moved (confirmed deliberately shared with other domains, per
   grep before this pass): window.openBillingInvoice/
   buildBillingInvoiceHTML/downloadJPEG, invalidateBsQuotesCache/
   getBsQuotesOrdered, renderBSQuotationFiles, order-tracking helpers,
   openSalesOrderModal/window.renderSalesOrders/openRecordSaleModal/
   transferOrderToProduction, renderClientProfiles/openClientHub/
   CRM_STAGES, renderFileCollection/bindFileCollection/
   renderDocCollection, renderBudgeting, nextCounterId — all stay in
   departments.js, called from here (loadFinanceContent's 'Sales
   Orders' case) as bare globals exactly as sales.js's own header
   documents. window.renderApprovals moved to js/screens/approvals.js
   alongside this pass — see that file's header.

   window.renderCash/loadCashContent/expenseTable/bindExpenseActions/
   openAddExpenseModal ("Cash & Expenses", departments.js lines
   514-965) is a SEPARATE, unreachable legacy screen — `case 'cash'`
   still exists in js/app.js's navigateTo switch but no nav item or
   deep link points at it anymore (grepped clean). It is NOT part of
   window.renderFinance/FINANCE_GROUPS and was left untouched in
   departments.js (out of this pass's scope; flagged for the Pass 10
   cleanup / dead-code sweep — it is also the "legacy Cash" hand-rolled
   `.subtab-bar` the 8-point spec's item 1 names as a known gap).
*/


// ── Generic finance-record edit modal ──────────────────────────────
// Generic edit modal for simple finance records. `fields` describe the form:
//   { key, label, type:'text'|'number'|'date'|'select'|'textarea', options?, full? }
// On save it .update()s the doc with the typed values + an edit audit stamp.
window.financeEditModal = function({ collection, docId, title, fields, onSaved, transform }) {
  const u = window.currentUser || (typeof auth !== 'undefined' && auth.currentUser) || {};
  const selStyle = 'padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)';
  const taStyle  = 'width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text)';
  const fieldHtml = f => {
    const v = f.value == null ? '' : f.value;
    if (f.type === 'select') {
      let opts = (f.options||[]).slice();
      // v14 fix (systemic footgun): if the record's current stored value
      // isn't in the declared options list — a hardcoded options array
      // drifting out of sync with the real data (e.g. the Ledger category
      // dropdown vs. COA.expense's real categories) — the browser silently
      // defaults the <select> to the FIRST option, and save() unconditionally
      // writes that back, corrupting the field on an otherwise-unrelated
      // edit. Auto-append the current value as an extra (still-selected)
      // option so drift is visible/preserved instead of silently overwritten.
      if (v !== '' && !opts.some(o => String(o) === String(v))) opts.push(v);
      return `<div class="form-group"><label>${f.label}</label><select id="fe-${f.key}" style="${selStyle}">${opts.map(o=>`<option ${String(o)===String(v)?'selected':''}>${escHtml(o)}</option>`).join('')}</select></div>`;
    }
    if (f.type === 'textarea') return `<div class="form-group"><label>${f.label}</label><textarea id="fe-${f.key}" rows="2" style="${taStyle}">${escHtml(v)}</textarea></div>`;
    const t = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
    return `<div class="form-group"><label>${f.label}</label><input id="fe-${f.key}" type="${t}" ${f.type==='number'?'step="0.01" inputmode="decimal"':''} value="${escHtml(v)}"/></div>`;
  };
  // Pack into 2-up rows, except fields flagged full:true which get their own row.
  let body = '', buf = [];
  const flush = () => { if (!buf.length) return; body += buf.length===2 ? `<div class="form-row">${buf.join('')}</div>` : buf[0]; buf = []; };
  fields.forEach(f => { if (f.full) { flush(); body += fieldHtml(f); } else { buf.push(fieldHtml(f)); if (buf.length===2) flush(); } });
  flush();
  openPage('Edit '+title, body, `<button class="btn-primary" id="fe-save">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  document.getElementById('fe-save').addEventListener('click', async () => {
    const upd = {};
    fields.forEach(f => {
      const el = document.getElementById('fe-'+f.key);
      if (!el) return;
      upd[f.key] = f.type === 'number' ? (parseFloat(el.value)||0) : (typeof el.value === 'string' ? el.value.trim() : el.value);
    });
    upd.editedBy     = u.uid || '';
    upd.editedByName = window.userProfile?.displayName || u.email || '';
    upd.editedAt     = firebase.firestore.FieldValue.serverTimestamp();
    if (typeof transform === 'function') { try { transform(upd); } catch(_e) {} }
    try {
      await db.collection(collection).doc(docId).update(upd);
      closeModal(); Notifs.success('Updated.'); onSaved && onSaved();
    } catch(e) { Notifs.showToast('Update failed: '+(e.message||e),'error'); }
  });
};

// ══════════════════════════════════════════════════
//  FINANCE & HR — nav shell (FINANCE_GROUPS/renderFinance/renderFinanceNav),
//  Finance Tools page, loadFinanceContent dispatcher
// ══════════════════════════════════════════════════
const FINANCE_GROUPS = [
  { key:'Overview',              label:'Overview',              members:['Overview'] },
  { key:'Money In/Out',          label:'Money In/Out',          members:['Ledger','Cash Receipts','Cash Disbursements','Bank Accounts'] },
  // v14 Wave4 F5 — Balance Sheet / Cash Flow / Bank Rec land here as sub-chips.
  // v14 post-release — Break-even lands as a Reports sub-chip (owner request:
  // "Add a computation for breakeven. Rents etc.").
  { key:'Reports',               label:'Reports',               members:['Reports','Balance Sheet','Cash Flow','Bank Rec','Break-even'] },
  // 2026-08-06 owner request ("Better if its just / Payroll / Then / Type a /
  // Type b"): 'Payroll' and 'HR Profiles' were the SAME pair of screens under
  // two chips. They are now one chip — window.renderPayrollHub (js/screens/
  // hr.js) with Type A / Type B tabs inside. 'HR Profiles' is gone from the
  // chip row but is NOT gone as a route: see FINANCE_LEGACY_KEYS below.
  { key:'Payroll & HR',          label:'Payroll & HR',          members:['Payroll','Cash Advances','SSS / Gov'] },
  { key:'Purchases & Inventory', label:'Purchases & Inventory', members:['Purchases','Inventory','Sales Orders'] },
  { key:'Taxes & BIR',           label:'Taxes & BIR',           members:['Taxes','BIR'] },
  { key:'Records',               label:'Records',               members:['Records','Tasks'] },
];
const FINANCE_KEY_TO_GROUP = {};
FINANCE_GROUPS.forEach(g => g.members.forEach(m => { FINANCE_KEY_TO_GROUP[m] = g.key; }));

// ── Retired subtab keys that must still ROUTE ─────────────────────────────
// A key that is no longer in any group's `members` is orphaned in
// FINANCE_KEY_TO_GROUP, and renderFinanceNav's unknown-key guard below
// (`if (!FINANCE_KEY_TO_GROUP[subtab]) subtab = 'Overview'`) would silently
// bounce it to Overview — so loadFinanceContent's `case 'HR Profiles'` would
// become dead code and every stored deep link to it would land on the wrong
// screen. Those links are real and outlive the rename: window.setSubroute
// writes the subtab into history state / the URL hash, so a bookmark, a
// back/forward entry, or a push-notification `link` captured before today
// still arrives here as 'HR Profiles'.
// Mapping value = the chip that REPLACED the retired key. It keeps the key
// resolvable for the group lookup and tells the sub-chip row which chip to
// light up; loadFinanceContent still receives the ORIGINAL key, so it can
// open the merged screen on the matching tab (here: Type B).
const FINANCE_LEGACY_KEYS = { 'HR Profiles': 'Payroll' };
Object.keys(FINANCE_LEGACY_KEYS).forEach(k => {
  const g = FINANCE_KEY_TO_GROUP[FINANCE_LEGACY_KEYS[k]];
  if (g) FINANCE_KEY_TO_GROUP[k] = g;
});

window.renderFinance = async function(currentUser, currentRole, subtab = window.initialSubtab('Overview')) {
  const c = deptContainer();
  const isPres = (typeof isPresident==='function') && isPresident();
  c.innerHTML = `
    <div class="page-header"><h2>${emojiIcon('💰',20)} Finance & HR</h2></div>
    ${window.sopPanel('How Finance works', [
      'Screens are grouped into 7 areas: Overview · Money In/Out (Ledger, Cash Receipts, Cash Disbursements, Bank Accounts) · Reports · Payroll & HR (Payroll, Cash Advances, SSS/Gov) · Purchases & Inventory · Taxes & BIR · Records.',
      'The ledger is the single source of truth — approved expenses, cash journals and payroll all post into it automatically.',
      'Record income/expense via Money In/Out; Reports reads the ledger for the P&L, VAT, Balance Sheet, Cash Flow, Bank Reconciliation and Break-even.',
      'Payroll is one screen with two tabs: Type A (regular staff, monthly — Compute → Verify → Disburse) and Type B (Production workers, weekly payslips, profiles & ID cards). It opens on Type A.',
      `Deleting any finance record needs President approval (the ${emojiIcon('🗑',16)} button files a request).`,
      isPres ? 'President-only maintenance & data-repair tools live behind the wrench button on Overview — out of the daily workflow.' : null
    ].filter(Boolean))}
    <div id="fin-tabs-wrap"></div>
    <div id="fin-content">${window.skeletonHtml('rows')}</div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  renderFinanceNav(currentUser, currentRole, subtab);
};

// Renders the group-chip row + (if the active group has >1 member) a second
// segmented sub-chip row, then loads the member's content. Re-run wholesale on
// every chip click — cheap (a handful of buttons) and keeps the active state
// of both rows trivially correct without hand-rolled DOM diffing.
function renderFinanceNav(currentUser, currentRole, subtab) {
  if (!FINANCE_KEY_TO_GROUP[subtab]) subtab = 'Overview'; // unknown key → safe default, never a dead end
  const groupKey = FINANCE_KEY_TO_GROUP[subtab];
  const group = FINANCE_GROUPS.find(g => g.key === groupKey) || FINANCE_GROUPS[0];
  const wrap = document.getElementById('fin-tabs-wrap');
  if (!wrap) return; // navigated away mid-render
  // A retired key has no chip of its own — highlight the chip that replaced it
  // (so an old 'HR Profiles' link shows "Payroll" active, not a row with
  // nothing selected). `subtab` itself is passed through to the content
  // dispatcher unchanged so it can still open the right tab inside.
  const chipKey = FINANCE_LEGACY_KEYS[subtab] || subtab;
  wrap.innerHTML = `
    ${window.chipTabs(FINANCE_GROUPS.map(g=>({key:g.key,label:g.label})), groupKey, {cls:'fin-group-tabs'})}
    ${group.members.length > 1 ? window.chipTabs(group.members.map(m=>({key:m,label:m})), chipKey, {cls:'fin-sub-tabs'}) : ''}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [wrap] });
  loadFinanceContent(currentUser, currentRole, subtab);

  window.bindChipTabs(wrap.querySelector('.fin-group-tabs'), (gKey) => {
    const g = FINANCE_GROUPS.find(x => x.key === gKey) || FINANCE_GROUPS[0];
    const member = g.members[0];
    window.setSubroute(member);
    renderFinanceNav(currentUser, currentRole, member);
  });
  const subRow = wrap.querySelector('.fin-sub-tabs');
  if (subRow) window.bindChipTabs(subRow, (mKey) => {
    window.setSubroute(mKey);
    renderFinanceNav(currentUser, currentRole, mKey);
  });
}

// ── Finance Tools (v14 Wave4 F1) — president-only maintenance & data-repair ──
// Hosts the 5 ledger-maintenance buttons that used to clutter the Reports
// header, plus the Cash-Advance data-repair entry that used to sit in the
// Cash Advances tab header. Handlers are moved verbatim (unchanged functions).
function openFinanceToolsPage() {
  openPage(`${emojiIcon('🔧',16)} Finance Tools`, `
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:14px">President-only maintenance &amp; data-repair utilities. Used occasionally — kept out of the daily Reports and Cash Advances workflow.</p>
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><h3>Ledger maintenance</h3></div>
      <div class="card-body" style="display:flex;flex-direction:column;align-items:flex-start;gap:8px">
        <button class="btn-secondary btn-sm" onclick="window.backfillLedgerFromJournals()" title="Post approved expenses + cash journals into the ledger">${emojiIcon('🔄',16)} Sync to ledger</button>
        <button class="btn-secondary btn-sm" onclick="window.runTagAccountTypes()" title="Backfill accountType on legacy ledger rows">${emojiIcon('🏷',16)} Tag account types</button>
        <button class="btn-secondary btn-sm" onclick="window.runRestateMaterialCosts()" title="Fix the double material-expensing bug on historical rows">${emojiIcon('🧾',16)} Restate material costs</button>
        <button class="btn-secondary btn-sm" onclick="window.runFixUndatedRows()" title="Repair ledger rows with a missing/malformed date">${emojiIcon('🩹',16)} Fix undated rows</button>
        <button class="btn-secondary btn-sm" onclick="window.runMigrateLedgerIds(this)" title="Migrate legacy random-id ledger rows to deterministic ids (dry-run first)">${emojiIcon('🧭',16)} Migrate ledger ids</button>
        <button class="btn-secondary btn-sm" onclick="window.runRebuildRollups(this)" title="Recompute finance_rollup monthly aggregates from a full ledger scan — the fix for any Overview-totals drift">${emojiIcon('🔁',16)} Rebuild rollups</button>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h3>Cash Advances</h3></div>
      <div class="card-body">
        <button class="btn-secondary btn-sm" id="fin-tools-ca-repair-btn" title="Scan every cash_advances record for legacy/inconsistent data (dry run first)">${emojiIcon('🔄',16)} CA Data Repair</button>
      </div>
    </div>
  `, `<button class="btn-secondary" onclick="closeModal()">Close</button>`);
  document.getElementById('fin-tools-ca-repair-btn')?.addEventListener('click', () => openCADataRepairModal());
}

// ── v14 Wave 4 Batch F2: Rebuild rollups (president, Finance Tools) ────────
// Full ledger rescan → recompute every finance_rollup/{yyyymm} doc from
// scratch (window.Ledger.rebuildRollups, js/finance-ledger.js). Idempotent —
// safe to run repeatedly — and the ONLY reconciliation path for the drift
// risk that _syncRollup's best-effort separate-write design accepts (a rules
// deploy not landed yet, a network blip on a post-commit sync, a raw ledger
// write that bypassed the Ledger service). Overview shows a one-line notice
// pointing here whenever finance_rollup is empty but the ledger isn't.
window.runRebuildRollups = async function(btn) {
  if (!window.Ledger || typeof window.Ledger.rebuildRollups !== 'function') {
    Notifs.showToast('Rollup tool not loaded', 'error'); return;
  }
  if (!(await confirmDialog({message:'Rebuild finance_rollup from a full ledger scan?\n\nThis recomputes every month\'s income/expense/VAT totals from scratch and overwrites the existing rollup docs. Safe to run repeatedly — this is the reconciliation tool for any Overview-totals drift.'}))) return;
  await window.busy(btn, async () => {
    Notifs.showToast('Rebuilding rollups… scanning the full ledger, please wait.');
    try {
      const r = await window.Ledger.rebuildRollups();
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('finance_rollup');
      window.logAudit && window.logAudit('rebuild-rollups','finance_rollup',null,r);
      Notifs.success(`Rebuilt ${r.months} month${r.months===1?'':'s'} of rollups from ${r.scanned} ledger row${r.scanned===1?'':'s'} ✓`);
    } catch (e) {
      Notifs.showToast('Rebuild failed: '+(e.message||e),'error');
    }
  });
};

async function loadFinanceContent(currentUser, currentRole, sub) {
  const content = document.getElementById('fin-content');
  switch(sub) {
    case 'Overview':     await renderFinanceOverview(content, currentUser, currentRole); break;
    case 'Reports':      await renderFinancialReports(content, currentUser, currentRole); break;
    // v14 Wave4 F5 — Balance Sheet / Cash Flow / Bank Rec (renderers in js/bir.js)
    case 'Balance Sheet': await window.renderBalanceSheet(content, currentUser, currentRole); break;
    case 'Cash Flow':     await window.renderCashFlowReport(content, currentUser, currentRole); break;
    case 'Bank Rec':      await window.renderBankRec(content, currentUser, currentRole); break;
    case 'Break-even':    await renderBreakevenTab(content, currentUser, currentRole); break;
    // One Payroll screen; Type A (monthly) / Type B (weekly Production) are
    // chip-tabs INSIDE it — see window.renderPayrollHub in js/screens/hr.js.
    // The `?:` is a load-order belt-and-braces, not a real branch: index.html
    // loads js/screens/hr.js (:496) BEFORE js/screens/finance.js (:523) and
    // both are `defer`, so the hub is always defined by the time any nav can
    // fire. Falling back to the bare renderer keeps this file free of a hard
    // dependency on that ordering if the script list is ever reshuffled.
    case 'Payroll':
      await (window.renderPayrollHub
        ? window.renderPayrollHub(content, currentUser, currentRole, 'A')
        : renderPayrollManagement(content, currentUser, currentRole));
      break;
    case 'Taxes':        await renderTaxesTab(content, currentUser, currentRole); break;
    case 'BIR':          await window.renderBIRTab(content, currentUser, currentRole); break;
    case 'Ledger':       await renderLedgerTab(content, currentUser, currentRole); break;
    case 'Bank Accounts': await window.renderBankAccounts(content); break;
    case 'Cash Receipts':       await renderCashReceiptJournal(content, currentUser, currentRole); break;
    case 'Cash Disbursements':  await renderCashDisbursementJournal(content, currentUser, currentRole); break;
    case 'Sales Orders':        await window.renderSalesOrders(content); break;
    case 'Inventory':           await window.renderInventory(content, 'Stock'); break;
    case 'Records':      await renderRecordsTab(content, currentUser, currentRole); break;
    case 'Purchases':
      // View-only window into the Purchasing department's purchase requests.
      // Purchasing creates RFQs → prices → converts to Purchase Requests; Finance
      // sees the committed purchases here but cannot edit them (write-gated in rules).
      await renderPurchaseRequests(content, currentUser, currentRole, { viewOnly:true, financeView:true });
      break;
    case 'SSS / Gov':
      content.innerHTML = renderFileCollection('SSS & Government Documents', 'fin-sss', currentRole);
      bindFileCollection('fin-sss', currentUser, 'Finance', 'SSS');
      break;
    // Back-compat route only — 'HR Profiles' no longer has a chip (see
    // FINANCE_LEGACY_KEYS above), but stored deep links still carry the key.
    // Land them on Type B, the tab that now holds exactly this screen, rather
    // than on a destination that no longer exists in the nav.
    case 'HR Profiles':
      await (window.renderPayrollHub
        ? window.renderPayrollHub(content, currentUser, currentRole, 'B')
        : renderFinanceHRProfiles(content, currentUser, currentRole));
      break;
    case 'Cash Advances':
      await renderFinanceCA(content, currentUser, currentRole);
      break;
    case 'Tasks':
      await renderDeptTasks(content, 'Finance', currentUser, currentRole);
      break;
  }
}

// ── Taxes Tab ───────────────────────────────────
async function renderTaxesTab(container, currentUser, currentRole) {
  return window.renderFinanceCrudTable(container, {
    collection: 'tax_records', currentUser, currentRole,
    orderBy: ['createdAt', 'desc'], limit: 50,
    emptyIcon: '📊', emptyLabel: 'No tax records yet',
    addBtnLabel: '+ Add Tax Record',
    actionsMode: 'always',
    columns: [
      { header: 'Period', mobile: 'avatar', cell: r => escHtml(r.period||'—') },
      { header: 'Type', mobile: 'name', cell: r => `<span class="badge badge-blue">${escHtml(r.type||'BIR')}</span>` },
      { header: 'Amount', mobile: 'net', cell: r => `<strong>₱${fmt(r.amount)}</strong>` },
      { header: 'Status', mobile: 'detail', cell: r => `<span class="badge ${r.status==='filed'?'badge-green':r.status==='paid'?'badge-blue':'badge-orange'}">${r.status||'pending'}</span>` },
      { header: 'Due Date', mobile: 'detail', cell: r => r.dueDate||'—' },
      { header: 'Filed By', mobile: 'detail', cell: r => escHtml(r.filedBy||'—') }
    ],
    actionsExtra: r => r.fileUrl ? `<a href="${safeHttpUrl(r.fileUrl)}" target="_blank" class="btn-secondary btn-sm" style="margin-left:4px" aria-label="View attached file">${emojiIcon('📎',16)}</a>` : '',
    editTitle: 'Tax Record',
    deleteLabel: r => `tax record "${(r.type||'Tax')+' — '+(r.period||r.id.slice(-5))}"`,
    editFields: r => [
      { key:'period', label:'Period', type:'text', value:r.period },
      { key:'type',   label:'Type',   type:'select', value:r.type, options:['BIR - Quarterly','BIR - Annual ITR','VAT','Withholding Tax','Percentage Tax'] },
      { key:'amount', label:'Amount (₱)', type:'number', value:r.amount },
      { key:'dueDate',label:'Due Date', type:'date', value:r.dueDate },
      { key:'status', label:'Status', type:'select', value:r.status||'pending', options:['pending','filed','paid'] }
    ],
    addModal: {
      title: 'Add Tax Record',
      bodyHtml: `
        <div class="form-row">
          <div class="form-group"><label>Period</label><input id="tax-period" placeholder="e.g. Q1 2026"/></div>
          <div class="form-group"><label>Type</label>
            <select id="tax-type" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
              <option>BIR - Quarterly</option><option>BIR - Annual ITR</option>
              <option>VAT</option><option>Withholding Tax</option><option>Percentage Tax</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Amount (₱)</label><input id="tax-amount" type="number" step="0.01" inputmode="decimal"/></div>
          <div class="form-group"><label>Due Date</label><input id="tax-due" type="date"/></div>
        </div>
        <div class="form-group"><label>Status</label>
          <select id="tax-status" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
            <option value="pending">Pending</option><option value="filed">Filed</option><option value="paid">Paid</option>
          </select>
        </div>
        <div id="tax-file-area"></div>
      `,
      footerHtml: `<button class="btn-primary" id="save-tax-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`,
      saveBtnId: 'save-tax-btn',
      afterOpen: (ctx) => { Drive.renderUploadArea('tax-file-area', f => ctx.setFile(f), {label:'Attach BIR receipt/form',dept:'Finance',subfolder:'Taxes'}); },
      buildDoc: (ctx) => ({
        period:   document.getElementById('tax-period').value.trim(),
        type:     document.getElementById('tax-type').value,
        amount:   parseFloat(document.getElementById('tax-amount').value)||0,
        dueDate:  document.getElementById('tax-due').value,
        status:   document.getElementById('tax-status').value,
        fileUrl:  ctx.getFile()?.url||null, fileName: ctx.getFile()?.name||null,
        filedBy:  ctx.currentUser.uid, filedByName: userProfile?.displayName||ctx.currentUser.email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }),
      successMsg: 'Tax record saved!'
    }
  });
}

// Export the currently-shown report period's ledger rows to CSV (accountant/BIR).
// v14 Wave4 F3 — when the on-screen report has Compare ON, window._finReportCompare
// (stashed by renderFinancialReports, same render pass — never recomputed here)
// carries the category-total maps for the previous period + same period last
// year, so each row also gets its category's Prev/YoY/Δ% context. Compare OFF
// (the default / legacy behavior) exports exactly the columns it always has.
window.exportFinReportCSV = function() {
  const rows = window._finReportRows || [];
  const slug = (window._finReportLabel || 'ledger').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  const cmp = window._finReportCompare || null;
  const cols = [
    { key:'date', label:'Date' },
    { key:'type', label:'Type' },
    { key:'category', label:'Category' },
    { key:'description', label:'Description' },
    { key:'refNumber', label:'Reference', get:r=>r.refNumber||'' },
    { key:'amount', label:'Amount', get:r=>r.amount||0 },
    { key:'vatAmount', label:'Output VAT', get:r=>r.vatAmount||0 },
    { key:'inputVat', label:'Input VAT', get:r=>r.inputVat||0 },
    { key:'source', label:'Source', get:r=>r.source||'' }
  ];
  if (cmp) {
    const forRow = (r, curMap, prevMap, yoyMap) => {
      const cat = r.category || 'Other';
      return { cur: curMap[cat]||0, prev: prevMap[cat]||0, yoy: yoyMap[cat]||0 };
    };
    const pick = r => window.ledgerKind(r)==='income'
      ? forRow(r, cmp.incCur, cmp.incPrev, cmp.incYoy)
      : forRow(r, cmp.expCur, cmp.expPrev, cmp.expYoy);
    cols.push(
      { key:'catPrev', label:'Category Total — ' + cmp.prevLabel, get:r=>pick(r).prev },
      { key:'catYoy',  label:'Category Total — ' + cmp.yoyLabel,  get:r=>pick(r).yoy },
      { key:'catDeltaPct', label:'Category Δ% vs Previous', get:r=>{
          const { cur, prev } = pick(r);
          if (!prev) return '';
          return Math.round(((cur - prev) / Math.abs(prev)) * 100);
        } }
    );
  }
  window.exportCSV('ledger-' + slug, rows, cols);
};

// v14 Wave4 F3 — ONE loader for every period-statement fetch the Reports
// screen makes: the on-screen current period AND (when Compare is on) the
// previous-period/same-period-last-year columns. Identical bounded reads
// (ledgerForPeriod/gjForPeriod) + identical merge/filter/ledgerKind grouping
// as the pre-F3 inline code, so a compare column can never be computed by a
// different codepath than the current period's own numbers — same math,
// different date range, guaranteed.
async function loadFinStatement(periodKey) {
  const parsed = window.Period.parse(periodKey);
  const [ledgerSnap, gjSnap] = await Promise.all([
    window.ledgerForPeriod(periodKey),
    window.gjForPeriod(periodKey)
  ]);
  const led = ledgerSnap.docs.map(d=>d.data());
  const gj  = gjSnap.docs.flatMap(d=>{ const e=d.data(); const rows=[];
    if (e.debit)  rows.push({date:e.date, type:'debit',  amount:e.debit,  category:'Journal Entry'});
    if (e.credit) rows.push({date:e.date, type:'credit', amount:e.credit, category:'Journal Entry'});
    return rows; });
  let rows = [...led, ...gj];
  // Belt-and-braces client-side filter for rows with odd/legacy date strings
  // (e.g. month-level 'YYYY-MM' rows) that the bounded query's exact-string
  // range compare might not line up with the parsed period boundaries.
  rows = rows.filter(e => window.Period.match(e.date, parsed));
  const income  = rows.filter(e=>ledgerKind(e)==='income');
  const expense = rows.filter(e=>ledgerKind(e)==='expense');
  const totIncome  = income.reduce((s,e)=>s+(e.amount||0),0);
  const totExpense = expense.reduce((s,e)=>s+(e.amount||0),0);
  return { parsed, rows, income, expense, totIncome, totExpense };
}

// v14 Wave4 F3 — Manila-safe period-shift for the Compare toggle. Pure
// integer arithmetic on the ALREADY Manila-resolved canonical period key
// (window.Period itself resolves everything off window.bizDate()) — no
// `new Date(...)`/UTC math, which is the exact class of bug the Manila-time
// helpers memory warns about. Returns {prevKey, yoyKey} (canonical Period
// keys, feedable straight back into ledgerForPeriod/gjForPeriod), or null
// for 'all' (no meaningful previous period to shift to).
function finCompareKeys(pParsed) {
  if (pParsed.type === 'month') {
    const [y, m] = pParsed.key.slice(6).split('-').map(Number);
    const shift = delta => {
      const idx = y * 12 + (m - 1) + delta;
      const ny = Math.floor(idx / 12), nm = (idx % 12) + 1;
      return 'month:' + ny + '-' + String(nm).padStart(2, '0');
    };
    return { prevKey: shift(-1), yoyKey: shift(-12) };
  }
  if (pParsed.type === 'quarter') {
    const m = pParsed.key.match(/^quarter:(\d{4})-Q([1-4])$/);
    const y = +m[1], q = +m[2];
    const shift = delta => {
      const idx = y * 4 + (q - 1) + delta;
      const ny = Math.floor(idx / 4), nq = (idx % 4) + 1;
      return 'quarter:' + ny + '-Q' + nq;
    };
    return { prevKey: shift(-1), yoyKey: shift(-4) };
  }
  if (pParsed.type === 'year') {
    const y = +pParsed.key.slice(5);
    // Year granularity: "previous period" and "same period last year" are
    // mathematically the same calendar year (year - 1) — there's no narrower
    // sub-period to distinguish them by. Both columns intentionally resolve
    // to the same key; this is correct, not a bug.
    return { prevKey: 'year:' + (y - 1), yoyKey: 'year:' + (y - 1) };
  }
  return null; // 'all' — Compare is disabled for this period type
}

// ── Financial Reports (Income Statement + VAT/BIR reference) ─────
// Computed from the ledger (ledgerKind() = income/expense, v12 WS13 chart-of-
// accounts aware) + general journal. Read-only summary for finance/admin;
// print-ready for filing. Period picker (v12 WS12) supports any month/quarter/
// year, not just This-Month/YTD/All — see window.Period in config.js.
// v14 Wave4 F3 — `compare` (default off) turns on the Previous/Same-period-
// last-year columns; every category row is also now a drill-down link (see
// window.openFinCategoryDrill below).
window.renderFinancialReports = async function(container, currentUser, currentRole, range='month', compare=false) {
  container.innerHTML = window.skeletonHtml('rows');
  // 'year' (legacy Reports spelling) is a Period alias for 'ytd' — same math.
  const periodKey = (range === 'year') ? 'ytd' : range;
  // v12 WS39 — period resolved FIRST, then date-range-bounded reads (WS16's
  // ledgerForPeriod/gjForPeriod), NOT the old "3000 most recent rows of ALL
  // TIME, then filter" pattern — that silently truncated any period older
  // than the newest 3000 ledger docs (the BIR-suite compliance landmine).
  const stmt = await loadFinStatement(periodKey);
  const { parsed: pParsed, rows: all, income, expense, totIncome, totExpense } = stmt;
  const net = totIncome - totExpense;
  const label = pParsed.type === 'all' ? 'All Time' : (periodKey === 'ytd' ? 'YTD ' + bizYear() : pParsed.label);
  // Stash the period's rows so the CSV export button (inline onclick) can reach them.
  window._finReportRows = all.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  window._finReportLabel = label;

  // Compare is meaningless for 'all' (no period boundary to shift) — force it
  // off rather than silently ignore a stale `true` carried over from a prior
  // period-picker selection.
  const compareOn = !!compare && pParsed.type !== 'all';

  // byCatWithRows groups by category AND keeps each category's row subset —
  // that row subset is later handed VERBATIM to openFinCategoryDrill, so the
  // drill page's total is computed from the exact same array this function
  // sums for the on-screen category total. Same data, same math, by
  // construction (no second fetch, no re-filter of a different row set).
  const byCatWithRows = arr => {
    const m = {};
    arr.forEach(e => { const k = e.category || 'Other'; (m[k] = m[k] || []).push(e); });
    return Object.entries(m)
      .map(([k, rs]) => [k, rs.reduce((s,e)=>s+(e.amount||0),0), rs])
      .sort((a,b) => b[1]-a[1]);
  };
  const incCats = byCatWithRows(income), expCats = byCatWithRows(expense);   // [category, total, rows]
  // kind::category -> rows, for the click-to-drill handler wired after render.
  const catRowMap = {};
  incCats.forEach(([k,,rs]) => { catRowMap['income::'+k]  = rs; });
  expCats.forEach(([k,,rs]) => { catRowMap['expense::'+k] = rs; });

  // ── Compare fetch (two extra period-bounded reads, ONLY when Compare is on) ──
  let cmp = null;
  if (compareOn) {
    const keys = finCompareKeys(pParsed);
    if (keys) {
      const [prevStmt, yoyStmt] = await Promise.all([
        loadFinStatement(keys.prevKey),
        loadFinStatement(keys.yoyKey)
      ]);
      const catTotalMap = arr => { const m={}; arr.forEach(e=>{const k=e.category||'Other'; m[k]=(m[k]||0)+(e.amount||0);}); return m; };
      cmp = {
        prevLabel: window.Period.parse(keys.prevKey).label,
        yoyLabel:  window.Period.parse(keys.yoyKey).label,
        incPrev: catTotalMap(prevStmt.income), expPrev: catTotalMap(prevStmt.expense),
        incYoy:  catTotalMap(yoyStmt.income),  expYoy:  catTotalMap(yoyStmt.expense),
        totIncomePrev: prevStmt.totIncome, totExpensePrev: prevStmt.totExpense,
        totIncomeYoy:  yoyStmt.totIncome,  totExpenseYoy:  yoyStmt.totExpense,
      };
    }
  }
  // Stashed for window.exportFinReportCSV — incCur/expCur are the CURRENT
  // period's own category totals (from incCats/expCats above), so the CSV's
  // Δ% is computed from the identical numbers the on-screen table shows.
  window._finReportCompare = (compareOn && cmp) ? {
    prevLabel: cmp.prevLabel, yoyLabel: cmp.yoyLabel,
    incCur: Object.fromEntries(incCats.map(([k,v])=>[k,v])),
    expCur: Object.fromEntries(expCats.map(([k,v])=>[k,v])),
    incPrev: cmp.incPrev, expPrev: cmp.expPrev,
    incYoy: cmp.incYoy, expYoy: cmp.expYoy,
  } : null;

  const cmpCols = compareOn && cmp;   // shorthand for the template below
  const catRow = (k, v, kind) => {
    const goodUp = kind === 'income';
    const chevron = `<i data-lucide="chevron-right" class="finrep-cat-chevron" style="width:13px;height:13px;vertical-align:-2px;opacity:.55;margin-right:4px"></i>`;
    let extra = '';
    if (cmpCols) {
      const prevMap = kind==='income' ? cmp.incPrev : cmp.expPrev;
      const yoyMap  = kind==='income' ? cmp.incYoy  : cmp.expYoy;
      const prevV = prevMap[k]||0, yoyV = yoyMap[k]||0;
      extra = `<td style="text-align:right;color:var(--text-muted)">₱${fmt(prevV)}</td>
        <td style="text-align:right;color:var(--text-muted)">₱${fmt(yoyV)}</td>
        <td style="text-align:right">${window.momDelta ? window.momDelta(v, prevV, goodUp) : ''}</td>`;
    }
    return `<tr class="finrep-cat-row" data-kind="${kind}" data-cat="${escHtml(k)}" tabindex="0" role="button" title="View ${escHtml(k)} entries for ${escHtml(label)}">
      <td style="padding-left:24px">${chevron}${escHtml(k)}</td>
      <td style="text-align:right">₱${fmt(v)}</td>
      ${extra}
    </tr>`;
  };
  const totalRow = (labelText, cur, prevVal, yoyVal, goodUp, color) => {
    let extra = '';
    if (cmpCols) {
      extra = `<td style="text-align:right;font-weight:700;color:var(--text-muted)">₱${fmt(prevVal)}</td>
        <td style="text-align:right;font-weight:700;color:var(--text-muted)">₱${fmt(yoyVal)}</td>
        <td style="text-align:right;font-weight:700">${window.momDelta ? window.momDelta(cur, prevVal, goodUp) : ''}</td>`;
    }
    return `<tr><td style="font-weight:700">${labelText}</td><td style="text-align:right;font-weight:700;color:${color}">₱${fmt(cur)}</td>${extra}</tr>`;
  };
  const emptyRow = (text) => `<tr><td style="padding-left:24px;color:var(--text-muted)">${text}</td><td style="text-align:right">₱0.00</td>${cmpCols?'<td></td><td></td><td></td>':''}</tr>`;

  const salesRows = income.filter(e=>(e.category||'')==='Sales Revenue');
  const sales = salesRows.reduce((s,e)=>s+(e.amount||0),0);
  // Output/Input VAT — ONE shared computation (window.computeVatSummary, js/bir.js,
  // v12 WS39) so Reports and the 2550 worksheet can never drift from each other.
  const vatSummary = window.computeVatSummary(all);
  const outputVat = vatSummary.outputVat, inputVat = vatSummary.inputVat, netVat = vatSummary.netVat;
  const isPres = (typeof isPresident==='function') && isPresident();
  const isClosableMonth = pParsed.type==='month' && pParsed.key !== 'month:'+bizDate().slice(0,7);
  let periodClosed = false;
  if (isClosableMonth) periodClosed = await window.isPeriodClosed(pParsed.start).catch(()=>false);

  // Wave 3 E-CALLERS — this screen prints via same-document window.print()
  // (#page-content is already the print-visible root, styles.css) but had no
  // letterhead: Ctrl+P / the Print button below just dumped the bare KPI
  // cards + tables. Inject the branded header into a print-only wrapper
  // (hidden on screen, shown under @media print — self-contained here since
  // this batch owns js/ only, not css/styles.css) so the filed report is
  // branded without touching the on-screen layout.
  const _finLh = window.buildLetterhead ? window.buildLetterhead({
    docTitle: 'FINANCIAL REPORT — INCOME STATEMENT & VAT REFERENCE',
    dateLabel: label,
    footerNote: ((window.BRAND && window.BRAND.fullName) || 'Barro Industries Operating System') + ' · Generated ' + new Date().toLocaleString('en-PH')
  }) : null;

  container.innerHTML = `
    ${_finLh ? `<style>.finrep-print-lh{display:none}@media print{.finrep-print-lh{display:block!important;margin-bottom:10px}}</style>
    <div class="finrep-print-lh">${_finLh.headerHTML}</div>` : ''}
    <style>.finrep-cat-row:hover{background:var(--s1,rgba(255,255,255,0.04))}</style>
    <div id="finrep-period">${window.periodPicker(periodKey, {})}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
      <div style="font-size:12px;color:var(--text-muted)">${label}${periodClosed?` &nbsp;<span class="badge badge-gray">${emojiIcon('🔒',16)} Closed</span>`:''}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        ${isPres&&isClosableMonth?(periodClosed
            ? `<button class="btn-secondary btn-sm" id="finrep-reopen-btn" data-month="${pParsed.key.slice(6)}">${emojiIcon('🔓',16)} Reopen ${pParsed.label}</button>`
            : `<button class="btn-secondary btn-sm" id="finrep-close-btn" data-month="${pParsed.key.slice(6)}" data-label="${escHtml(pParsed.label)}">${emojiIcon('🔒',16)} Close ${pParsed.label}</button>`
          ):''}
        <div class="chip-tabs" style="margin:0">
          <button type="button" class="chip-tab${compareOn?' active':''}" id="finrep-compare-chip"
            ${pParsed.type==='all'?'disabled style="opacity:.45;cursor:not-allowed" title="Compare needs a specific month/quarter/year, not All Time"':`title="${compareOn?'Turn off':'Turn on'} period comparison"`}>
            ${emojiIcon('🔀',16)} Compare
          </button>
        </div>
        <button class="btn-secondary btn-sm" onclick="window.exportFinReportCSV()" title="Export this period's ledger to CSV${compareOn?' (includes comparison columns)':''}">${emojiIcon('⬇',16)} CSV</button>
        <button class="btn-secondary btn-sm" onclick="window.print()">${emojiIcon('🖨',16)} Print</button>
      </div>
    </div>
    <div class="kpi-row" style="margin-bottom:14px">
      <div class="kpi-card green"><div class="kpi-label">Total Income</div><div class="kpi-value">₱${fmt(totIncome)}</div></div>
      <div class="kpi-card red"><div class="kpi-label">Total Expenses</div><div class="kpi-value">₱${fmt(totExpense)}</div></div>
      <div class="kpi-card ${net>=0?'accent':'red'}"><div class="kpi-label">Net Income</div><div class="kpi-value">₱${fmt(net)}</div></div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>${emojiIcon('📈',20)} Income Statement</h3>${cmpCols?`<span style="font-size:11px;color:var(--text-muted)">Click a category to view its entries</span>`:''}</div>
      <div class="card-body" style="padding:0"><div class="table-wrap"><table class="data-table">
        <thead><tr>
          <th>Account / Category</th><th style="text-align:right">${escHtml(label)}</th>
          ${cmpCols?`<th style="text-align:right">${escHtml(cmp.prevLabel)}</th><th style="text-align:right">${escHtml(cmp.yoyLabel)}</th><th style="text-align:right">Δ vs Previous</th>`:''}
        </tr></thead>
        <tbody>
          <tr><td colspan="${cmpCols?5:2}" style="font-weight:800;color:var(--success);background:rgba(48,209,88,0.06)">INCOME</td></tr>
          ${incCats.length?incCats.map(([k,v])=>catRow(k,v,'income')).join(''):emptyRow('No income recorded')}
          ${totalRow('Total Income', totIncome, cmpCols?cmp.totIncomePrev:0, cmpCols?cmp.totIncomeYoy:0, true, 'var(--success)')}
          <tr><td colspan="${cmpCols?5:2}" style="font-weight:800;color:var(--danger);background:rgba(255,69,58,0.06)">EXPENSES</td></tr>
          ${expCats.length?expCats.map(([k,v])=>catRow(k,v,'expense')).join(''):emptyRow('No expenses recorded')}
          ${totalRow('Total Expenses', totExpense, cmpCols?cmp.totExpensePrev:0, cmpCols?cmp.totExpenseYoy:0, false, 'var(--danger)')}
          <tr style="border-top:2px solid var(--border)">
            <td style="font-weight:800;font-size:14px">NET INCOME</td>
            <td style="text-align:right;font-weight:800;font-size:14px;color:${net>=0?'var(--success)':'var(--danger)'}">₱${fmt(net)}</td>
            ${cmpCols?(()=>{ const prevNet=cmp.totIncomePrev-cmp.totExpensePrev, yoyNet=cmp.totIncomeYoy-cmp.totExpenseYoy;
              return `<td style="text-align:right;font-weight:800;color:var(--text-muted)">₱${fmt(prevNet)}</td>
                <td style="text-align:right;font-weight:800;color:var(--text-muted)">₱${fmt(yoyNet)}</td>
                <td style="text-align:right;font-weight:800">${window.momDelta?window.momDelta(net,prevNet,true):''}</td>`; })():''}
          </tr>
        </tbody>
      </table></div></div>
    </div>

    <div class="card">
      <div class="card-header"><h3>${emojiIcon('🧾',20)} Tax / VAT Reference</h3></div>
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;padding:6px 0"><span>Sales Revenue (recorded total)</span><strong>₱${fmt(sales)}</strong></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--border)"><span>Output VAT (on sales)</span><strong>₱${fmt(outputVat)}</strong></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--border)"><span>Less: Input VAT (on purchases)</span><strong style="color:var(--success)">−₱${fmt(inputVat)}</strong></div>
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid var(--border);font-weight:800"><span>Net VAT ${netVat>=0?'Payable':'Creditable'}</span><strong style="color:${netVat>=0?'var(--danger)':'var(--success)'}">₱${fmt(Math.abs(netVat))}</strong></div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:10px;line-height:1.5">Output VAT is summed per sale's VAT treatment (inclusive / exclusive / exempt); input VAT from VATable purchases is netted off. Confirm with your accountant before BIR filing; attach official BIR forms via <em>Taxes</em>.</div>
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });
  window.bindPeriodPicker(document.getElementById('finrep-period'), (newKey) => {
    // periodPicker/Period use canonical keys; renderFinancialReports keeps its
    // legacy 'year' spelling for the YTD case so its own external callers
    // (and the CSV/print title) read naturally — everything else passes through.
    // Compare state carries across a period switch (auto-drops for 'all' via
    // the compareOn guard at the top of the function).
    renderFinancialReports(container, currentUser, currentRole, newKey === 'ytd' ? 'year' : newKey, compareOn);
  }, { activeKey: periodKey });
  document.getElementById('finrep-close-btn')?.addEventListener('click', async () => {
    const mk = document.getElementById('finrep-close-btn').dataset.month;
    if (!(await confirmDialog({message:`Close the books for ${document.getElementById('finrep-close-btn').dataset.label}?\n\nNo new entries can post to this month until it's reopened.`}))) return;
    await window.closeFinancePeriod(mk);
    renderFinancialReports(container, currentUser, currentRole, range, compareOn);
  });
  document.getElementById('finrep-reopen-btn')?.addEventListener('click', async () => {
    const mk = document.getElementById('finrep-reopen-btn').dataset.month;
    if (!(await confirmDialog({message:`Reopen ${mk} for editing?`}))) return;
    await window.reopenFinancePeriod(mk);
    renderFinancialReports(container, currentUser, currentRole, range, compareOn);
  });
  document.getElementById('finrep-compare-chip')?.addEventListener('click', () => {
    renderFinancialReports(container, currentUser, currentRole, range, !compareOn);
  });
  // v14 Wave4 F3 — click-to-drill. `rows` is the exact per-category array
  // element from byCatWithRows/catRowMap above (never refetched/refiltered),
  // so the drill page's total is guaranteed to equal this row's ₱ figure.
  container.querySelectorAll('.finrep-cat-row').forEach(tr => {
    const openDrill = () => {
      const rows = catRowMap[tr.dataset.kind + '::' + tr.dataset.cat] || [];
      window.openFinCategoryDrill(tr.dataset.cat, tr.dataset.kind, rows, label);
    };
    tr.addEventListener('click', openDrill);
    tr.addEventListener('keydown', (ev) => { if (ev.key==='Enter'||ev.key===' ') { ev.preventDefault(); openDrill(); } });
  });
};

// v14 Wave4 F3 — Income Statement category drill-down. `rows` MUST be the
// same period-bounded row subset renderFinancialReports already fetched and
// grouped (catRowMap, built from byCatWithRows) — never re-queried here.
// Invariant: sum(rows.map(r=>r.amount)) === the category total shown on the
// Income Statement, because both numbers come from the identical array.
window.openFinCategoryDrill = function(category, kind, rows, periodLabel) {
  const sorted = (rows || []).slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const total = sorted.reduce((s,e)=>s+(e.amount||0),0);
  const vatFlag = e => e.vatTreatment==='exempt' ? 'Exempt' : (((e.vatAmount||0)>0 || (e.inputVat||0)>0) ? 'VATable' : '—');

  // Same self-contained openPage-print pattern as openPayrollReconciliation
  // (js/departments.js) — the .page-panel host sits outside #page-content, so
  // it needs its own letterhead + A4 page rule rather than relying on the
  // shared #page-content print block.
  const _lh = window.buildLetterhead ? window.buildLetterhead({
    docTitle: (kind==='income'?'INCOME':'EXPENSE') + ' DETAIL — ' + category.toUpperCase(),
    dateLabel: periodLabel,
    footerNote: ((window.BRAND && window.BRAND.fullName) || 'Barro Industries Operating System') + ' · Generated ' + new Date().toLocaleString('en-PH')
  }) : null;
  const printCss = _lh ? `<style>
    .findrill-print-lh{display:none}
    @media print{
      body *{visibility:hidden!important}
      .findrill-print-wrap,.findrill-print-wrap *{visibility:visible!important}
      .findrill-print-wrap{position:absolute;left:0;top:0;width:100%;padding:8mm}
      .findrill-print-lh{display:block!important}
      @page{size:A4 portrait;margin:11mm 10mm 7mm}
    }
    ${_lh.printCSS}
  </style>` : '';

  window.openPage(`${emojiIcon(kind==='income'?'📈':'📉',16)} ${category} — ${periodLabel}`, `
    ${printCss}
    <div class="findrill-print-wrap">
      <div class="findrill-print-lh">${_lh?_lh.headerHTML:''}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">${escHtml(category)} · ${kind==='income'?'Income':'Expense'} · ${escHtml(periodLabel)} · ${sorted.length} entr${sorted.length===1?'y':'ies'}</div>
      <div class="card"><div class="card-body" style="padding:0">
        ${!sorted.length ? `<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon('📄',44)}</div><h4>No entries in this category for ${escHtml(periodLabel)}</h4></div>` :
        `<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Date</th><th>Reference</th><th>Description</th><th>VAT</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody>${sorted.map(e=>`<tr>
            <td style="white-space:nowrap">${escHtml(e.date||'—')}</td>
            <td><code>${escHtml(e.refNumber||'—')}</code></td>
            <td>${escHtml(e.description||'—')}</td>
            <td style="font-size:11px">${vatFlag(e)}</td>
            <td style="text-align:right">₱${fmt(e.amount||0)}</td>
          </tr>`).join('')}</tbody>
          <tfoot><tr style="border-top:2px solid var(--border)"><td colspan="4" style="font-weight:800">Total — ${escHtml(category)}</td><td style="text-align:right;font-weight:800">₱${fmt(total)}</td></tr></tfoot>
        </table></div>`}
      </div></div>
      <div class="findrill-print-lh">${_lh?_lh.footerHTML:''}</div>
    </div>
  `, `<button class="btn-secondary" id="findrill-csv-btn">${emojiIcon('⬇',16)} CSV</button><button class="btn-secondary" onclick="window.print()">${emojiIcon('🖨',16)} Print</button><button class="btn-secondary" onclick="closeModal()">Close</button>`);

  if (window.lucide) lucide.createIcons();
  document.getElementById('findrill-csv-btn')?.addEventListener('click', () => {
    const slug = (category + '-' + periodLabel).replace(/[^a-z0-9]+/gi,'-').toLowerCase();
    window.exportCSV('income-statement-' + slug, sorted, [
      { key:'date', label:'Date' },
      { key:'refNumber', label:'Reference', get:r=>r.refNumber||'' },
      { key:'description', label:'Description' },
      { key:'vat', label:'VAT', get:r=>vatFlag(r) },
      { key:'amount', label:'Amount', get:r=>r.amount||0 }
    ]);
  });
};

// ── Break-even (v14 post-release) ──────────────────────────────────────
// Owner request: "Add a computation for breakeven. Rents etc." Reuses the
// EXACT SAME period-bounded fetch as the Income Statement a few hundred
// lines up — loadFinStatement() (-> ledgerForPeriod/gjForPeriod, filtered +
// grouped by ledgerKind) — no second fetch machinery, so this screen's
// income/expense totals can never drift from Reports' own numbers for the
// same period, because both read through the one shared loader. All the
// actual break-even MATH (contribution margin, break-even revenue,
// coverage%, gap, per-day-needed) lives in the pure window.computeBreakeven
// (js/money-core.js, tested in tests/money.test.mjs) — this function's job
// is only fetch -> classify -> call it -> render.
//
// Classification source: finance_config/breakeven ({fixed:[cat],
// variable:[cat], none:[cat], manualFixed:[{label,amount}]} — canFinance
// read+write, rules already deployed). A category explicitly listed in
// `fixed`/`variable` uses that; one explicitly in `none` (deliberately
// marked "not classified" via the Classify editor below) is excluded from
// the math on purpose; every OTHER category — anything Finance has never
// touched, including a brand-new ledger category that shows up next month —
// falls through to the built-in keyword default just below (case-insensitive
// substring match) so new categories are never silently unclassified.
//
// There is no dedicated "Rent" line in window.COA (js/config.js) — this
// app's real expense categories are COS – Direct Material / COS – Direct
// Labor / Payroll Expense / Operating Expense / Utilities / Tax / Materials
// / General Expense / Other Expense (js/config.js ~1314). Real rent
// normally lands under Operating Expense or General Expense, and the
// default keyword list below deliberately does NOT match either of those
// generic bucket names (no "rent"/"lease" substring in them) — they show up
// as "unclassified" until Finance either (a) classifies that bucket via the
// editor, or (b) — the intended path for "Rents etc." specifically — adds
// it as its own manualFixed row ("Rent — HQ", amount) if it never posts to
// the ledger as its own category at all.
const BE_DEFAULT_FIXED_KW    = ['rent','utilit','salar','payroll','insuran','subscri','internet','lease'];
const BE_DEFAULT_VARIABLE_KW = ['material','cos','cost of sales','freight','deliver','commission'];

function beDefaultGuess(cat) {
  const lower = String(cat||'').toLowerCase();
  if (BE_DEFAULT_FIXED_KW.some(k => lower.includes(k))) return 'fixed';
  if (BE_DEFAULT_VARIABLE_KW.some(k => lower.includes(k))) return 'variable';
  return null; // no keyword hit -> unclassified by default
}
// Resolve every category present in byCategory down to computeBreakeven's
// {fixed:[cat], variable:[cat]} input shape: explicit finance_config choice
// wins, `none` is a deliberate exclusion (no default fallback), anything
// left over falls back to the keyword default per-category.
function beResolveClassification(cfg, categories) {
  const expFixed = new Set(cfg.fixed || []), expVariable = new Set(cfg.variable || []), expNone = new Set(cfg.none || []);
  const fixed = [], variable = [];
  categories.forEach(cat => {
    if (expFixed.has(cat))    { fixed.push(cat); return; }
    if (expVariable.has(cat)) { variable.push(cat); return; }
    if (expNone.has(cat))     return; // deliberately left unclassified — no default fallback
    const guess = beDefaultGuess(cat);
    if (guess === 'fixed') fixed.push(cat);
    else if (guess === 'variable') variable.push(cat);
  });
  return { fixed, variable };
}
// Tri-state resolved view for ONE category (same precedence as
// beResolveClassification) — used by the Classify editor to show what's
// actually in effect right now (explicit choice OR live default guess).
function beResolvedState(cfg, cat) {
  if ((cfg.fixed||[]).includes(cat))    return 'fixed';
  if ((cfg.variable||[]).includes(cat)) return 'variable';
  if ((cfg.none||[]).includes(cat))     return 'none';
  return beDefaultGuess(cat); // 'fixed' | 'variable' | null
}

async function renderBreakevenTab(container, currentUser, currentRole, periodKey) {
  periodKey = periodKey || 'month';
  container.innerHTML = window.skeletonHtml('rows');
  const canWrite = isFinancePriv();

  // ONE fetch — same function, same rows, as the Income Statement above.
  const stmt = await loadFinStatement(periodKey);
  const { parsed: pParsed, income, expense, totIncome } = stmt;
  const label = pParsed.type === 'all' ? 'All Time' : (periodKey === 'ytd' ? 'YTD ' + bizYear() : pParsed.label);

  // {cat:{income,expense}} — identical shape to finance_rollup.byCategory
  // (js/finance-ledger.js _rollupDelta/_syncRollup), built from the SAME
  // income/expense arrays loadFinStatement already returned (no second read).
  const byCategory = {};
  const bump = (arr, field) => arr.forEach(e => {
    const k = e.category || 'Other';
    const b = byCategory[k] || (byCategory[k] = { income:0, expense:0 });
    b[field] += (e.amount || 0);
  });
  bump(expense, 'expense');
  bump(income, 'income');
  const categories = Object.keys(byCategory);

  const cfgSnap = await db.collection('finance_config').doc('breakeven').get().catch(() => null);
  const cfg = (cfgSnap && cfgSnap.exists) ? (cfgSnap.data() || {}) : {};
  const classification = beResolveClassification(cfg, categories);
  const manualFixed = Array.isArray(cfg.manualFixed) ? cfg.manualFixed : [];

  const r = window.computeBreakeven({ income: totIncome, byCategory, classification, manualFixed });

  // Per-day-needed only makes sense for a single calendar month. Days-in-a-
  // month is plain calendar-length math (timezone-invariant), NOT the same
  // class of bug as "what day is it right now" — the Manila-time-helpers
  // guard (CLAUDE.md) is about wall-clock reads, not this, so no bizDate()
  // call belongs here; the month itself is already Manila-resolved upstream
  // by window.Period (bizDate()-driven), all this does is count its days.
  let perDay = null;
  if (pParsed.type === 'month') {
    const mm = pParsed.key.match(/^month:(\d{4})-(\d{2})$/);
    if (mm) perDay = r.perDayNeeded(new Date(+mm[1], +mm[2], 0).getDate());
  }

  const noRevenue = totIncome === 0;
  const negMargin = !noRevenue && r.contributionMarginRatio !== null && r.contributionMarginRatio <= 0;
  const beDisplay  = (typeof r.breakEvenRevenue === 'number') ? '₱' + fmt(r.breakEvenRevenue) : 'n/a';
  const covDisplay = (typeof r.coveragePct === 'number') ? r.coveragePct.toFixed(1) + '%' : '—';
  const cmrDisplay = (r.contributionMarginRatio !== null) ? (r.contributionMarginRatio * 100).toFixed(1) + '%' : '—';
  const barPct   = (typeof r.coveragePct === 'number') ? Math.max(0, Math.min(100, r.coveragePct)) : 0;
  const barColor = (typeof r.coveragePct === 'number' && r.coveragePct >= 100) ? 'var(--success)' : 'var(--warning)';

  // Stashed for the CSV button (inline pattern matches window.exportFinReportCSV above).
  window._beRows = [
    ...r.classifiedFixed.map(x => ({ classification:'Fixed', category:x.cat, amount:x.amt })),
    ...r.classifiedVariable.map(x => ({ classification:'Variable', category:x.cat, amount:x.amt })),
    ...r.unclassified.map(x => ({ classification:'Unclassified', category:x.cat, amount:x.amt })),
  ];

  const _beLh = window.buildLetterhead ? window.buildLetterhead({
    docTitle: 'BREAK-EVEN ANALYSIS',
    dateLabel: label,
    footerNote: ((window.BRAND && window.BRAND.fullName) || 'Barro Industries Operating System') + ' · Generated ' + new Date().toLocaleString('en-PH')
  }) : null;

  const catRow = (x) => `<tr><td>${escHtml(x.cat)}${x.manual?` <span class="badge badge-gray" style="font-size:9px">manual</span>`:''}</td><td style="text-align:right">₱${fmt(x.amt)}</td></tr>`;

  container.innerHTML = `
    ${_beLh ? `<style>.bke-print-lh{display:none}@media print{.bke-print-lh{display:block!important;margin-bottom:10px}}</style>
    <div class="bke-print-lh">${_beLh.headerHTML}</div>` : ''}
    <div id="bke-period">${window.periodPicker(periodKey, {})}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin:10px 0;flex-wrap:wrap;gap:8px">
      <div style="font-size:12px;color:var(--text-muted)">${escHtml(label)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${canWrite?`<button class="btn-secondary btn-sm" id="bke-classify-btn">${emojiIcon('🏷',16)} Classify</button>`:''}
        <button class="btn-secondary btn-sm" id="bke-csv-btn">${emojiIcon('⬇',16)} CSV</button>
        <button class="btn-secondary btn-sm" onclick="window.print()">${emojiIcon('🖨',16)} Print</button>
      </div>
    </div>

    ${noRevenue ? `<div class="card" style="margin-bottom:14px;border-left:3px solid var(--warning)"><div class="card-body">
        <strong>${emojiIcon('⚠️',16)} n/a — no revenue recorded</strong>
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px">No income was recorded for ${escHtml(label)}, so break-even revenue can't be computed against zero. Fixed costs below are still real — they're just shown without a revenue target.</div>
      </div></div>`
    : negMargin ? `<div class="card" style="margin-bottom:14px;border-left:3px solid var(--danger)"><div class="card-body">
        <strong>${emojiIcon('⚠️',16)} n/a — variable costs consume all (or more) of revenue</strong>
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Contribution margin is ${cmrDisplay} for ${escHtml(label)} — no amount of extra revenue at today's cost mix reaches break-even. Review the variable-cost classification or per-unit pricing.</div>
      </div></div>`
    : ''}

    <div class="kpi-row" style="margin-bottom:14px">
      <div class="kpi-card"><div class="kpi-label">Fixed Costs</div><div class="kpi-value">₱${fmt(r.fixedTotal)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Contribution Margin</div><div class="kpi-value">${cmrDisplay}</div></div>
      <div class="kpi-card ${typeof r.breakEvenRevenue==='number'?'accent':''}"><div class="kpi-label">Break-even Revenue</div><div class="kpi-value">${beDisplay}</div></div>
      <div class="kpi-card ${typeof r.coveragePct==='number'&&r.coveragePct>=100?'green':''}"><div class="kpi-label">Coverage</div><div class="kpi-value">${covDisplay}</div></div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>${emojiIcon('📉',20)} Progress to Break-even</h3></div>
      <div class="card-body">
        <div class="progress-bar-wrap" style="margin-bottom:8px"><div class="progress-bar-fill" style="width:${barPct}%;background:${barColor}"></div></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);flex-wrap:wrap;gap:8px">
          <span>Income so far: <strong style="color:var(--text)">₱${fmt(totIncome)}</strong></span>
          <span>Gap to break-even: <strong style="color:var(--text)">${typeof r.gapToBreakEven==='number'?'₱'+fmt(r.gapToBreakEven):'n/a'}</strong></span>
          ${perDay!=null?`<span>Needed per day (${escHtml(label)}): <strong style="color:var(--text)">₱${fmt(perDay)}</strong></span>`:''}
        </div>
      </div>
    </div>

    <div class="form-row" style="grid-template-columns:1fr 1fr">
      <div class="card" style="margin-bottom:14px">
        <div class="card-header"><h3>${emojiIcon('📌',18)} Fixed Costs (${r.classifiedFixed.length})</h3></div>
        <div class="card-body" style="padding:0"><div class="table-wrap"><table class="data-table">
          <thead><tr><th>Category</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody>${r.classifiedFixed.length ? r.classifiedFixed.map(catRow).join('') : `<tr><td colspan="2" style="color:var(--text-muted)">No fixed costs classified for ${escHtml(label)}</td></tr>`}</tbody>
          <tfoot><tr style="border-top:2px solid var(--border)"><td style="font-weight:800">Total Fixed</td><td style="text-align:right;font-weight:800">₱${fmt(r.fixedTotal)}</td></tr></tfoot>
        </table></div></div>
      </div>
      <div class="card" style="margin-bottom:14px">
        <div class="card-header"><h3>${emojiIcon('📊',18)} Variable Costs (${r.classifiedVariable.length})</h3></div>
        <div class="card-body" style="padding:0"><div class="table-wrap"><table class="data-table">
          <thead><tr><th>Category</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody>${r.classifiedVariable.length ? r.classifiedVariable.map(catRow).join('') : `<tr><td colspan="2" style="color:var(--text-muted)">No variable costs classified for ${escHtml(label)}</td></tr>`}</tbody>
          <tfoot><tr style="border-top:2px solid var(--border)"><td style="font-weight:800">Total Variable</td><td style="text-align:right;font-weight:800">₱${fmt(r.variableTotal)}</td></tr></tfoot>
        </table></div></div>
      </div>
    </div>

    ${r.unclassified.length ? `<div class="card" style="margin-bottom:14px;border-left:3px solid var(--warning)">
      <div class="card-header"><h3>${emojiIcon('⚠️',18)} Unclassified (${r.unclassified.length}) — excluded from the math above</h3></div>
      <div class="card-body" style="padding:0"><div class="table-wrap"><table class="data-table">
        <thead><tr><th>Category</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${r.unclassified.map(catRow).join('')}</tbody>
      </table></div></div>
      <div class="card-body" style="padding-top:10px;font-size:11px;color:var(--text-muted)">These categories posted expenses this period but aren't tagged Fixed or Variable — shown here, not silently dropped or guessed into a total.${canWrite?' Use Classify to tag them.':''}</div>
    </div>` : ''}

    <div class="bke-print-lh">${_beLh ? _beLh.footerHTML : ''}</div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  window.bindPeriodPicker(document.getElementById('bke-period'), (newKey) => {
    renderBreakevenTab(container, currentUser, currentRole, newKey);
  }, { activeKey: periodKey });

  document.getElementById('bke-csv-btn')?.addEventListener('click', () => {
    const slug = label.replace(/[^a-z0-9]+/gi,'-').toLowerCase();
    window.exportCSV('breakeven-' + slug, window._beRows, [
      { key:'classification', label:'Classification' },
      { key:'category', label:'Category' },
      { key:'amount', label:'Amount', get:x=>x.amount },
    ]);
  });

  document.getElementById('bke-classify-btn')?.addEventListener('click', () => {
    openBreakevenClassifyEditor(categories, cfg, () => renderBreakevenTab(container, currentUser, currentRole, periodKey));
  });
}

// ── Break-even Classify editor (Finance-gated) ─────────────────────────
// Tri-state chip per category (Fixed/Variable/None) + manual fixed-cost
// add/remove rows, saved to finance_config/breakeven. `categories` is only
// THIS PERIOD's byCategory keys — saving must not clobber explicit choices
// made in another period for a category absent from the current one, so
// the save handler starts from the existing doc's arrays and only replaces
// entries for categories actually shown in this editor session (see the
// save handler below for the exact merge).
function openBreakevenClassifyEditor(categories, cfg, onSaved) {
  const priorFixed = new Set(cfg.fixed || []), priorVariable = new Set(cfg.variable || []), priorNone = new Set(cfg.none || []);
  const explicitOf = cat => priorFixed.has(cat) ? 'fixed' : priorVariable.has(cat) ? 'variable' : priorNone.has(cat) ? 'none' : null;
  // selections holds ONLY categories with an explicit choice (carried over
  // from cfg, or set by a click below). A category absent from this map has
  // no override — it keeps riding the live keyword default forever.
  const selections = {};
  categories.forEach(cat => { const s = explicitOf(cat); if (s) selections[cat] = s; });
  let manualRows = (Array.isArray(cfg.manualFixed) ? cfg.manualFixed : []).map(m => ({ label:m.label||'', amount:+m.amount||0 }));

  const chipRow = (cat) => {
    const explicit = selections[cat];
    const guess = beDefaultGuess(cat);
    const btn = (val, lbl) => `<button type="button" class="chip-tab${explicit===val?' active':''}" data-cat="${escHtml(cat)}" data-val="${val}" style="padding:4px 10px;font-size:11px">${lbl}</button>`;
    const guessNote = !explicit ? `<span style="font-size:10px;color:var(--text-muted);margin-left:6px">(auto: ${guess==='fixed'?'Fixed':guess==='variable'?'Variable':'unclassified'})</span>` : '';
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border);flex-wrap:wrap">
      <span style="font-size:12px">${escHtml(cat)}${guessNote}</span>
      <div style="display:flex;align-items:center;gap:6px">
        <div class="chip-tabs" style="margin:0">${btn('fixed','Fixed')}${btn('variable','Variable')}${btn('none','None')}</div>
        ${explicit?`<button type="button" class="btn-secondary btn-sm bke-reset" data-cat="${escHtml(cat)}" style="padding:4px 8px;font-size:10px" title="Clear override — use the live default again" aria-label="Clear override for ${escHtml(cat)}">↺</button>`:''}
      </div>
    </div>`;
  };
  const manualRowHtml = (m, i) => `<div class="form-row" style="margin-bottom:6px">
    <div class="form-group"><label>Label</label><input class="bke-m-label" data-i="${i}" value="${escHtml(m.label)}" placeholder="e.g. Rent — HQ"/></div>
    <div class="form-group" style="display:flex;gap:6px;align-items:flex-end">
      <div style="flex:1"><label>Amount (₱)</label><input class="bke-m-amount" data-i="${i}" type="number" step="0.01" inputmode="decimal" value="${m.amount||0}"/></div>
      <button type="button" class="btn-danger btn-sm bke-m-del" data-i="${i}" aria-label="Remove manual fixed cost row">${emojiIcon('trash-2',14)}</button>
    </div>
  </div>`;

  const bind = () => {
    document.querySelectorAll('#bke-classify-cats [data-cat]').forEach(b => b.addEventListener('click', () => {
      selections[b.dataset.cat] = b.dataset.val; render();
    }));
    document.querySelectorAll('.bke-reset').forEach(b => b.addEventListener('click', () => {
      delete selections[b.dataset.cat]; render();
    }));
    document.querySelectorAll('.bke-m-label,.bke-m-amount').forEach(inp => inp.addEventListener('change', () => {
      const i = +inp.dataset.i;
      if (inp.classList.contains('bke-m-label')) manualRows[i].label = inp.value.trim();
      else manualRows[i].amount = parseFloat(inp.value)||0;
    }));
    document.querySelectorAll('.bke-m-del').forEach(b => b.addEventListener('click', () => {
      manualRows.splice(+b.dataset.i, 1); render();
    }));
  };
  const render = () => {
    document.getElementById('bke-classify-cats').innerHTML = categories.length
      ? categories.map(chipRow).join('')
      : `<div style="font-size:12px;color:var(--text-muted)">No categories posted this period yet.</div>`;
    document.getElementById('bke-classify-manual').innerHTML = manualRows.map(manualRowHtml).join('')
      || `<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">No manual fixed costs added.</div>`;
    if (window.lucide) lucide.createIcons();
    bind();
  };

  window.openPage(`${emojiIcon('🏷',18)} Classify Break-even Costs`, `
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Tag each ledger category Fixed or Variable for break-even math. Untouched categories keep using the built-in keyword default (rent/utilities/salaries → Fixed; materials/COS/freight/commissions → Variable) until classified here. "None" deliberately excludes a category from both totals.</p>
    <div id="bke-classify-cats" style="margin-bottom:16px"></div>
    <h4 style="margin:14px 0 6px">${emojiIcon('➕',16)} Manual Fixed Costs</h4>
    <p style="font-size:11px;color:var(--text-muted);margin-bottom:8px">For fixed costs that never post to the ledger as their own category — e.g. a rent figure tracked outside the ledger.</p>
    <div id="bke-classify-manual"></div>
    <button type="button" class="btn-secondary btn-sm" id="bke-m-add">${emojiIcon('➕',16)} Add Row</button>
  `, `<button class="btn-primary" id="bke-classify-save">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  render();
  document.getElementById('bke-m-add').addEventListener('click', () => { manualRows.push({label:'',amount:0}); render(); });
  document.getElementById('bke-classify-save').addEventListener('click', () => window.busy(document.getElementById('bke-classify-save'), async () => {
    const fixed = new Set(cfg.fixed || []), variable = new Set(cfg.variable || []), none = new Set(cfg.none || []);
    // Only categories actually shown in THIS editor session get re-decided;
    // everything outside that list (another period's categories) is left
    // exactly as it was in the previously-saved doc.
    categories.forEach(cat => { fixed.delete(cat); variable.delete(cat); none.delete(cat); });
    Object.keys(selections).forEach(cat => {
      if (selections[cat] === 'fixed') fixed.add(cat);
      else if (selections[cat] === 'variable') variable.add(cat);
      else if (selections[cat] === 'none') none.add(cat);
    });
    const manualFixedOut = manualRows.filter(m => m.label && m.amount).map(m => ({ label: m.label.trim(), amount: +(+m.amount).toFixed(2) }));
    try {
      await db.collection('finance_config').doc('breakeven').set({
        fixed: Array.from(fixed), variable: Array.from(variable), none: Array.from(none), manualFixed: manualFixedOut,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: (window.currentUser&&window.currentUser.uid)||'',
        updatedByName: (window.userProfile&&window.userProfile.displayName)||(window.currentUser&&window.currentUser.email)||''
      });
      closeModal();
      Notifs.success('Break-even classification saved.');
      onSaved && onSaved();
    } catch (e) {
      Notifs.showToast('Save failed: '+(e.message||e), 'error');
    }
  }));
}

// ── Ledger Tab (includes merged General Journal entries) ─────
async function renderLedgerTab(container, currentUser, currentRole) {
  const [ledgerSnap, gjSnap, ledgerAllSnap, gjAllSnap] = await Promise.all([
    db.collection('ledger').orderBy('date','desc').limit(100).get().catch(()=>({docs:[]})),
    db.collection('general_journal').orderBy('date','desc').limit(100).get().catch(()=>({docs:[]})),
    // M1 fix — the KPI headline totals must be all-time, not just the latest 100
    // rows the list below shows. Reuse the existing unbounded/cached 'all' readers
    // (same shared cache key Finance Overview's ledger total already relies on).
    window.ledgerForPeriod('all'),
    window.gjForPeriod('all')
  ]);

  // Normalize ledger entries (capped — drives the visible list only)
  const ledgerEntries = ledgerSnap.docs.map(d => ({id:d.id, _src:'ledger', ...d.data()}));

  // Normalize general journal entries to ledger shape (capped — visible list only)
  const gjEntries = gjSnap.docs.flatMap(d => {
    const e = {id:d.id, _src:'journal', ...d.data()};
    const rows = [];
    if (e.debit)  rows.push({...e, type:'debit',  amount:e.debit,  description:e.accountTitle||'—', category:'Journal Entry', refNumber:e.reference, source:'Journal'});
    if (e.credit) rows.push({...e, type:'credit', amount:e.credit, description:e.accountTitle||'—', category:'Journal Entry', refNumber:e.reference, source:'Journal'});
    return rows;
  });

  // Merge and sort by date desc — feeds the visible table/CSV only, unchanged
  const entries = [...ledgerEntries, ...gjEntries].sort((a,b)=>(b.date||'').localeCompare(a.date||''));

  // M1 fix — KPI totals from the UNBOUNDED all-time reads above, not the
  // capped `entries` list, so Total Credits/Debits/Balance are all-time-correct.
  const gjAllEntries = gjAllSnap.docs.flatMap(d => {
    const e = d.data();
    const rows = [];
    if (e.debit)  rows.push({ type:'debit',  amount:e.debit });
    if (e.credit) rows.push({ type:'credit', amount:e.credit });
    return rows;
  });
  const allEntries  = [...ledgerAllSnap.docs.map(d=>d.data()), ...gjAllEntries];
  const totalDebit  = allEntries.filter(e=>e.type==='debit').reduce((s,e)=>s+(e.amount||0),0);
  const totalCredit = allEntries.filter(e=>e.type==='credit').reduce((s,e)=>s+(e.amount||0),0);
  const balance     = totalCredit - totalDebit;
  const canFin      = isFinancePriv();

  container.innerHTML = `
    <div class="kpi-row">
      <div class="kpi-card green"><div class="kpi-label">Total Credits</div><div class="kpi-value">₱${fmt(totalCredit)}</div></div>
      <div class="kpi-card red"><div class="kpi-label">Total Debits</div><div class="kpi-value">₱${fmt(totalDebit)}</div></div>
      <!-- v14 fix: this is Σcredits−Σdebits across EVERY account type mixed
           together (income/expense/asset/liability) — neither cash on hand,
           net income, nor any standard accounting total. Relabeled + a
           tooltip + a pointer to the real reports, so it can't be misread
           as "how much money we have" or "our profit". -->
      <div class="kpi-card ${balance>=0?'accent':'red'}" title="Σ credits − Σ debits across ALL account types mixed together — not cash on hand or net income. See Reports (Income Statement) or Bank Accounts for those."><div class="kpi-label">Net Credit/Debit Skew</div><div class="kpi-value">₱${fmt(balance)}</div></div>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin:-6px 0 10px">Not a cash or profit figure — see <em>Reports</em> for Income Statement / VAT, or <em>Bank Accounts</em> for cash position.</div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:10px">
      ${entries.length?`<button class="btn-secondary btn-sm" id="ledger-csv-btn">${emojiIcon('⬇',16)} CSV</button>`:''}
      <button class="btn-primary btn-sm" id="add-ledger-btn">+ New Entry</button>
    </div>
    <div class="card">
      <div class="card-body" style="padding:0">
        ${!entries.length?`<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon('📒',44)}</div><h4>No ledger entries yet</h4></div>`:
          `<div class="table-wrap"><table class="data-table table-cards">
            <thead><tr><th>Date</th><th>Description / Account</th><th>Category</th><th>Source</th><th>Debit</th><th>Credit</th><th>Ref #</th><th>By</th>${canFin?'<th></th>':''}</tr></thead>
            <tbody>${entries.map(e=>`<tr class="ledger-row">
              <td class="tc-avatar" style="white-space:nowrap">${e.date||'—'}</td>
              <td class="tc-name">${escHtml(e.description||'—')} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
              <td class="tc-detail" data-label="Category"><span class="badge badge-blue">${escHtml(e.category||'General')}</span></td>
              <td class="tc-detail" data-label="Source" style="font-size:11px">${e.source&&e.source!=='Finance'?`<span class="badge badge-gray">${escHtml(e.source)}</span>`:'<span style="color:var(--text-muted)">Finance</span>'}</td>
              <td class="${e.type==='debit'?'tc-net':'tc-detail'}" ${e.type==='debit'?'':'data-label="Debit"'} style="color:var(--danger)">${e.type==='debit'?'₱'+fmt(e.amount):'-'}</td>
              <td class="${e.type==='credit'?'tc-net':'tc-detail'}" ${e.type==='credit'?'':'data-label="Credit"'} style="color:var(--success)">${e.type==='credit'?'₱'+fmt(e.amount):'-'}</td>
              <td class="tc-detail" data-label="Ref #"><code>${escHtml(e.refNumber||'—')}</code></td>
              <td class="tc-detail" data-label="By" style="font-size:11px">${escHtml(e.addedByName||'—')}</td>
              ${canFin?`<td class="tc-actions" style="white-space:nowrap">
                <button class="btn-secondary btn-sm led-edit-btn" data-id="${e.id}" data-src="${e._src}" aria-label="Edit ledger entry">${emojiIcon('✎',16)}</button>
                <button class="btn-danger btn-sm led-del-btn" data-id="${e.id}" data-src="${e._src}" data-label="${escHtml((e.description||'entry')+' — ₱'+fmt(e.amount))}" style="margin-left:4px" aria-label="Delete ledger entry">${emojiIcon('trash-2',14)}</button>
              </td>`:''}
            </tr>`).join('')}</tbody>
          </table></div>`}
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });
  // Card view (≤700px) — tap a row to reveal the full breakdown (see the
  // .table-cards comment in styles.css). No-op at desktop widths.
  container.querySelectorAll('tr.ledger-row').forEach(tr => {
    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('button, a')) return;
      tr.classList.toggle('tc-expanded');
    });
  });
  document.getElementById('ledger-csv-btn')?.addEventListener('click', () => window.exportCSV('ledger', entries, [
    {key:'date',label:'Date'},{key:'description',label:'Description'},{key:'category',label:'Category'},
    {key:'source',label:'Source',get:e=>e.source||'Finance'},
    {key:'debit',label:'Debit',get:e=>e.type==='debit'?(e.amount||0):''},
    {key:'credit',label:'Credit',get:e=>e.type==='credit'?(e.amount||0):''},
    {key:'refNumber',label:'Ref #'},{key:'addedByName',label:'By'}]));
  document.getElementById('add-ledger-btn').addEventListener('click', () => {
    // Account-type-aware account picker (v12 WS13) — grouped from window.COA,
    // defaulting from the credit/debit direction. This is the single easiest
    // place to accidentally post into a closed period (free date, no ref) —
    // highest-priority guard of the whole ledger surface (v12 WS12).
    const acctOptsFor = (accountType) => (window.COA[accountType]||[])
      .map(a => `<option value="${escHtml(a)}">${escHtml(a)}</option>`).join('');
    openPage('New Ledger Entry', `
      <div class="form-row">
        <div class="form-group"><label>Date</label><input id="led-date" type="date" value="${today()}"/></div>
        <div class="form-group"><label>Type</label>
          <select id="led-type" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
            <option value="credit">Credit (Income)</option><option value="debit">Debit (Expense)</option>
          </select>
        </div>
      </div>
      <div class="form-group"><label>Description / Account Title</label><input id="led-desc" placeholder="e.g. Client payment — ABC Corp, or Accumulated Depreciation"/></div>
      <div class="form-row">
        <div class="form-group"><label>Amount (₱)</label><input id="led-amount" type="number" step="0.01" inputmode="decimal"/></div>
        <div class="form-group"><label>Account Type</label>
          <select id="led-accttype" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
            <option value="income">Income</option><option value="expense" selected>Expense</option>
            <option value="asset">Asset</option><option value="liability">Liability</option><option value="equity">Equity</option>
          </select>
        </div>
      </div>
      <div class="form-group"><label>Account</label>
        <select id="led-account" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${acctOptsFor('expense')}</select>
      </div>
      <div class="form-group"><label>Reference Number</label><input id="led-ref" placeholder="OR #, Invoice #, JE #, etc."/></div>
      <div id="led-vat-wrap" style="display:none">${window.vatFieldHTML ? window.vatFieldHTML('led-vat','exempt') : ''}</div>
      <div id="led-file-area"></div>
    `, `<button class="btn-primary" id="save-led-btn">Save Entry</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    let ledFile = null;
    Drive.renderUploadArea('led-file-area', r=>{ledFile=r;},{label:'Attach receipt/invoice',dept:'Finance',subfolder:'Ledger'});
    const typeSel = document.getElementById('led-type'), acctTypeSel = document.getElementById('led-accttype'), acctSel = document.getElementById('led-account');
    // v12 WS39 — Input VAT only makes sense on a debit/expense row; show/hide
    // it as the type/account-type selections change (starts hidden: default
    // type is 'credit').
    const ledUpdateVatVisibility = () => {
      const wrap = document.getElementById('led-vat-wrap');
      if (wrap) wrap.style.display = (typeSel.value==='debit' && acctTypeSel.value==='expense') ? '' : 'none';
    };
    typeSel.addEventListener('change', () => {
      acctTypeSel.value = typeSel.value === 'credit' ? 'income' : 'expense';
      acctSel.innerHTML = acctOptsFor(acctTypeSel.value);
      ledUpdateVatVisibility();
    });
    acctTypeSel.addEventListener('change', () => { acctSel.innerHTML = acctOptsFor(acctTypeSel.value); ledUpdateVatVisibility(); });
    ledUpdateVatVisibility();
    document.getElementById('save-led-btn').addEventListener('click', () => window.busy(document.getElementById('save-led-btn'), async () => {
      const date = document.getElementById('led-date').value;
      const amount = parseFloat(document.getElementById('led-amount').value)||0;
      const ref = document.getElementById('led-ref').value.trim();
      // Guard like the CRJ/CDJ modals: a blank amount would post a ₱0 row, and a
      // blank ref makes Ledger.post throw inside busy() (no catch) — the click
      // would silently do nothing.
      if (!ref)    { Notifs.showToast('Enter a reference number.', 'error'); return; }
      if (!(amount > 0)) { Notifs.showToast('Enter a valid amount.', 'error'); return; }
      // v13 Phase 13 — first caller to hand assertPeriodOpen's job fully to the
      // service; Ledger.post checks the period itself, no separate pre-check here.
      try {
      const result = await window.Ledger.post({
        ref, date, kind: typeSel.value,
        accountType: acctTypeSel.value, account: acctSel.value, category: acctSel.value,
        description: document.getElementById('led-desc').value.trim(),
        amount,
        extra: {
          fileUrl: ledFile?.url||null,
          // v12 WS39 — input-VAT capture on manual Ledger-tab debit/expense entries.
          ...( typeSel.value==='debit' && acctTypeSel.value==='expense' && window.readVatField
               ? window.readVatField('led-vat', amount) : {} )
        }
      });
      // Money-critical fix — Ledger.post's dedupe guard means a ref that
      // collides with an EXISTING row (a typo re-using a prior OR #/JE #, or
      // this exact save retried) silently posts nothing and returns
      // {existed:true}. The result was never checked here, so the modal
      // closed and told the user "Ledger entry saved!" even though nothing
      // new was written — a genuinely new entry with a colliding ref just
      // vanished. Surface the collision instead of a false success, and keep
      // the modal open so the user can pick a different reference number.
      if (result && result.existed) {
        Notifs.showToast(`A ledger entry with reference "${ref}" already exists — nothing new was posted. Use a different reference number.`, 'error');
        return;
      }
      closeModal(); Notifs.success('Ledger entry saved!');
      renderLedgerTab(container, currentUser, currentRole);
      } catch (err) {
        // busy() re-throws without any user feedback — surface the reason
        // (closed period, missing ref, permission) instead of a dead button.
        Notifs.showToast('Save failed: ' + (err && err.message || err), 'error');
      }
    }));
  });

  // Edit (finance) / Delete (President approval) — a row is either a Finance
  // ledger entry or one leg of a General-Journal entry (data-src tells which).
  if (canFin) {
    const redo = () => renderLedgerTab(container, currentUser, currentRole);
    container.querySelectorAll('.led-edit-btn').forEach(btn => btn.addEventListener('click', () => {
      const e = entries.find(x=>x.id===btn.dataset.id && x._src===btn.dataset.src); if (!e) return;
      if (btn.dataset.src === 'journal') {
        window.financeEditModal({ collection:'general_journal', docId:e.id, title:'Journal Entry', onSaved:redo, fields:[
          { key:'date', label:'Date', type:'date', value:e.date },
          { key:'accountTitle', label:'Account Title', type:'text', value:e.accountTitle||e.description, full:true },
          { key:'debit',  label:'Debit (₱)',  type:'number', value:e.debit||0 },
          { key:'credit', label:'Credit (₱)', type:'number', value:e.credit||0 },
          { key:'reference', label:'Reference', type:'text', value:e.reference||e.refNumber, full:true }
        ]});
      } else {
        window.financeEditModal({ collection:'ledger', docId:e.id, title:'Ledger Entry', onSaved:redo, fields:[
          { key:'date', label:'Date', type:'date', value:e.date },
          { key:'type', label:'Type', type:'select', value:e.type, options:['credit','debit'] },
          { key:'description', label:'Description / Account', type:'text', value:e.description, full:true },
          { key:'amount', label:'Amount (₱)', type:'number', value:e.amount },
          // v14 fix: this was a hardcoded 7-item list that drifted out of
          // sync with the real COA (js/config.js window.COA.expense has
          // 'Payroll Expense'/'COS – Direct Material'/'COS – Direct Labor'/
          // 'General Expense'/'Other Expense', none of which matched here —
          // so opening this modal on almost any real expense row and saving
          // silently rewrote its category to 'Sales Revenue' (the first
          // option). Now built from the live Chart of Accounts so every real
          // category has an exact-matching option (financeEditModal's own
          // auto-append fallback above is a second, systemic safety net for
          // any value that still isn't in this list).
          { key:'category', label:'Category', type:'select', value:e.category||'Other', options:[
              ...((window.COA && window.COA.income) || ['Sales Revenue','Other Income']),
              ...((window.COA && window.COA.expense) || ['Operating Expense','Utilities','Tax','Materials','Other Expense']),
              'Journal Entry (Non-cash)', 'Cash Advance', 'A/R Collection', 'A/P Settlement', 'Other'
            ] },
          { key:'refNumber', label:'Reference Number', type:'text', value:e.refNumber, full:true }
        ]});
      }
    }));
    container.querySelectorAll('.led-del-btn').forEach(btn => btn.addEventListener('click', () => {
      const coll = btn.dataset.src === 'journal' ? 'general_journal' : 'ledger';
      window.financeDelete({ collection:coll, docId:btn.dataset.id, label:`ledger entry "${btn.dataset.label}"`, onDone:redo });
    }));
  }
}

// ── Bank Accounts registry + reconciliation (v12 WS36) ──
// Balances are DERIVED (window.BankAccounts.computeBalances) — nothing stored here
// can drift. Add/Edit/Delete gated to the money tier (matches bank_accounts rules:
// create/update isMoneyAdmin(), delete isPresident() via financeDelete).
window.renderBankAccounts = async function(container) {
  const c = container || deptContainer();
  c.innerHTML = window.skeletonHtml('rows');
  const canWrite = ['president','manager','finance'].includes(window.currentRole);
  const [accounts, ledgerSnap] = await Promise.all([
    window.BankAccounts.list({ activeOnly:false }),
    window.ledgerForPeriod('all')
  ]);
  const rows = ledgerSnap.docs.map(d => d.data());
  const bookBal = window.BankAccounts.computeBalances(accounts, rows);
  const recBal  = window.BankAccounts.computeBalances(accounts, rows, { reconciledOnly:true });
  const cashTotal = accounts.filter(a=>a.active!==false).reduce((s,a)=>s+(bookBal[a.id]?bookBal[a.id].balance:0),0);
  const unreconciled = rows.filter(r=>r.bankAccountId && !r.reconciled).length;
  const typeIcon = t => t==='ewallet' ? `${emojiIcon('📱',16)}` : t==='cash' ? `${emojiIcon('💵',16)}` : `${emojiIcon('🏦',16)}`;

  c.innerHTML = `
    <div class="page-header"><h2>${emojiIcon('🏦',20)} Bank Accounts</h2><span style="font-size:12px;color:var(--text-muted)">Company cash locations — balances derive from opening anchor + tagged ledger flows</span></div>
    <div class="kpi-row" style="margin-bottom:14px">
      <div class="kpi-card green"><div class="kpi-label">Cash Position</div><div class="kpi-value" style="font-size:15px">₱${fmt(cashTotal)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Active Accounts</div><div class="kpi-value">${accounts.filter(a=>a.active!==false).length}</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Unreconciled Rows</div><div class="kpi-value">${unreconciled}</div></div>
    </div>
    ${canWrite?`<div style="display:flex;justify-content:flex-end;margin-bottom:10px"><button class="btn-primary btn-sm" id="ba-add-btn">+ Add Account</button></div>`:''}
    <div class="card"><div class="card-body" style="padding:0">
    ${!accounts.length?`<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon('🏦',44)}</div><h4>No bank accounts registered</h4><p>Add every real company account (bank / e-wallet / petty cash) to start tracking balances.</p></div>`:
    `<div class="table-wrap"><table class="data-table table-cards">
      <thead><tr><th></th><th>Account</th><th>Opening</th><th>Book Balance</th><th>Reconciled Balance</th><th>Status</th>${canWrite?'<th></th>':''}</tr></thead>
      <tbody>${accounts.map(a=>{
        const bb = bookBal[a.id]?bookBal[a.id].balance:0, rb = recBal[a.id]?recBal[a.id].balance:0;
        // Row already navigates to the drilldown (.ba-row-link below) — the
        // detail page IS the expansion, so tc-detail cells stay hidden on
        // phone with no separate tap-to-expand toggle (no caret/JS added).
        return `<tr>
        <td class="tc-avatar">${typeIcon(a.type)}</td>
        <td class="tc-name ba-row-link" data-id="${escHtml(a.id)}" style="cursor:pointer"><strong>${escHtml(a.nickname||'')}</strong><div style="font-size:11px;color:var(--text-muted)">${escHtml(window.BankAccounts.label(a))}${a.isDefault?' · <span class="badge badge-blue" style="font-size:9px">default</span>':''}</div></td>
        <td class="tc-detail" data-label="Opening" style="font-size:12px">₱${fmt(a.openingBalance||0)}<div style="font-size:10px;color:var(--text-muted)">@ ${escHtml(a.openingDate||'—')}</div></td>
        <td class="tc-net" style="font-weight:700">₱${fmt(bb)}</td>
        <td class="tc-detail" data-label="Reconciled Balance">₱${fmt(rb)}</td>
        <td class="tc-detail" data-label="Status"><span class="badge ${a.active!==false?'badge-green':'badge-gray'}">${a.active!==false?'active':'closed'}</span></td>
        ${canWrite?`<td class="tc-actions" style="white-space:nowrap">
          <button class="btn-secondary btn-sm ba-edit-btn" data-id="${escHtml(a.id)}" aria-label="Edit bank account">${emojiIcon('✎',16)}</button>
          <button class="btn-danger btn-sm ba-del-btn" data-id="${escHtml(a.id)}" data-label="${escHtml(a.nickname||'bank account')}" style="margin-left:4px" aria-label="Delete bank account">${emojiIcon('trash-2',14)}</button>
        </td>`:''}
      </tr>`;}).join('')}</tbody>
    </table></div>`}
    </div></div>
    <div id="ba-drilldown"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes:[c] });

  const redo = () => window.renderBankAccounts(container);

  c.querySelectorAll('.ba-row-link').forEach(td => td.addEventListener('click', () => {
    const a = accounts.find(x=>x.id===td.dataset.id); if (a) renderBankAccountDrilldown(a);
  }));

  if (canWrite) {
    document.getElementById('ba-add-btn')?.addEventListener('click', () => openBankAccountModal(null, redo));
    c.querySelectorAll('.ba-edit-btn').forEach(btn => btn.addEventListener('click', () => {
      const a = accounts.find(x=>x.id===btn.dataset.id); if (a) openBankAccountModal(a, redo);
    }));
    c.querySelectorAll('.ba-del-btn').forEach(btn => btn.addEventListener('click', () => {
      window.financeDelete({ collection:'bank_accounts', docId:btn.dataset.id, label:`bank account "${btn.dataset.label}"`, onDone:redo });
    }));
  }
};

// Add/Edit modal — fields exactly per Spec 1 (nickname required; openingBalance
// number; openingDate default bizDate(); type select; isDefault checkbox, which
// on save clears every other doc's isDefault so at most one is ever true).
function openBankAccountModal(a, onDone) {
  const isEdit = !!a;
  a = a || { nickname:'', type:'bank', bankName:'', accountName:'', accountNo:'', branch:'',
    openingBalance:0, openingDate:(window.bizDate?window.bizDate():today()), active:true, isDefault:false, sortOrder:0, notes:'' };
  openPage(isEdit?'Edit Bank Account':'Add Bank Account', `
    <div class="form-row">
      <div class="form-group"><label>Nickname</label><input id="ba-nickname" value="${escHtml(a.nickname||'')}" placeholder="e.g. BDO Checking — Main"/></div>
      <div class="form-group"><label>Type</label><select id="ba-type" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
        <option value="bank" ${a.type==='bank'?'selected':''}>Bank</option>
        <option value="ewallet" ${a.type==='ewallet'?'selected':''}>E-wallet</option>
        <option value="cash" ${a.type==='cash'?'selected':''}>Cash (petty cash)</option>
      </select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Bank / Provider Name</label><input id="ba-bankname" value="${escHtml(a.bankName||'')}" placeholder="e.g. BDO, GCash"/></div>
      <div class="form-group"><label>Branch (optional)</label><input id="ba-branch" value="${escHtml(a.branch||'')}"/></div>
    </div>
    <div class="form-group"><label>Account Name (registered holder)</label><input id="ba-acctname" value="${escHtml(a.accountName||'')}" placeholder="e.g. BARRO INDUSTRIES OPC"/></div>
    <div class="form-group"><label>Account No. (full — prints on invoices; lists show masked)</label><input id="ba-acctno" value="${escHtml(a.accountNo||'')}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Opening Balance (₱)</label><input id="ba-opening" type="number" step="0.01" inputmode="decimal" value="${a.openingBalance||0}"/></div>
      <div class="form-group"><label>Opening Date</label><input id="ba-openingdate" type="date" value="${a.openingDate||(window.bizDate?window.bizDate():today())}"/></div>
    </div>
    <div class="form-group"><label>Notes (optional)</label><input id="ba-notes" value="${escHtml(a.notes||'')}"/></div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-top:4px;cursor:pointer">
      <input type="checkbox" id="ba-default" ${a.isDefault?'checked':''} style="width:16px;height:16px"/> Default account (preselected in pickers)
    </label>
    ${isEdit?`<label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-top:4px;cursor:pointer">
      <input type="checkbox" id="ba-active" ${a.active!==false?'checked':''} style="width:16px;height:16px"/> Active (uncheck to close — kept forever, hidden from pickers)
    </label>`:''}
    <div id="ba-err" class="error-msg hidden" style="margin-top:8px"></div>
  `, `<button class="btn-primary" id="ba-save-btn">${isEdit?'Save':'Add Account'}</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  document.getElementById('ba-save-btn').addEventListener('click', async () => {
    const err = document.getElementById('ba-err');
    const nickname = document.getElementById('ba-nickname').value.trim();
    if (!nickname) { err.textContent='Nickname is required.'; err.classList.remove('hidden'); return; }
    const data = {
      nickname,
      type: document.getElementById('ba-type').value,
      bankName: document.getElementById('ba-bankname').value.trim(),
      accountName: document.getElementById('ba-acctname').value.trim(),
      accountNo: document.getElementById('ba-acctno').value.trim(),
      branch: document.getElementById('ba-branch').value.trim(),
      currency: 'PHP',
      openingBalance: parseFloat(document.getElementById('ba-opening').value)||0,
      openingDate: document.getElementById('ba-openingdate').value || (window.bizDate?window.bizDate():today()),
      isDefault: document.getElementById('ba-default').checked,
      sortOrder: a.sortOrder||0,
      notes: document.getElementById('ba-notes').value.trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (isEdit) data.active = document.getElementById('ba-active').checked;
    try {
      if (data.isDefault) {
        // At most one isDefault=true — clear every other doc's flag first.
        const others = await db.collection('bank_accounts').get().catch(()=>({docs:[]}));
        await Promise.all(others.docs.filter(d=>d.id!==a.id && d.data().isDefault).map(d=>d.ref.update({isDefault:false})));
      }
      if (isEdit) {
        await db.collection('bank_accounts').doc(a.id).update(data);
        window.logAudit && window.logAudit('update','bank_account',a.id,{ nickname });
      } else {
        data.active = true;
        data.createdBy = currentUser.uid;
        data.createdByName = window.userProfile?.displayName || currentUser.email;
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        const ref = await db.collection('bank_accounts').add(data);
        window.logAudit && window.logAudit('create','bank_account',ref.id,{ nickname });
      }
      window.BankAccounts.invalidate();
      closeModal();
      Notifs.success(isEdit?'Bank account updated':'Bank account added');
      onDone && onDone();
    } catch (ex) { err.textContent='Failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
  });
}

// Drill-down (click a row) — every tagged ledger row for this account, a per-row
// reconcile checkbox, and a re-tag select to move a mis-tagged row to another
// account. Both writes are plain ledger updates, permitted by the existing
// ledger.update: canFinance() rule (no rules change needed).
async function renderBankAccountDrilldown(a) {
  const wrap = document.getElementById('ba-drilldown');
  if (!wrap) return;
  wrap.innerHTML = window.skeletonHtml('table');
  const [snap, bankOpts] = await Promise.all([ window.ledgerForPeriod('all'), window.BankAccounts.optionsHTML(a.id) ]);
  const rows = snap.docs.map(d => ({ id:d.id, ...d.data() }))
    .filter(r => r.bankAccountId === a.id && (!a.openingDate || (r.date||'') >= a.openingDate))
    .sort((x,y) => (x.date||'').localeCompare(y.date||''));
  let running = +(a.openingBalance||0);
  wrap.innerHTML = `
    <div class="card" style="margin-top:14px"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <strong>${escHtml(window.BankAccounts.label(a))} — transactions since ${escHtml(a.openingDate||'—')}</strong>
        <button class="btn-secondary btn-sm" id="ba-dd-close">${emojiIcon('✕',16)} Close</button>
      </div>
      ${!rows.length?`<div class="empty-state" style="padding:16px"><div class="empty-icon">${emojiIcon('📭',44)}</div><h4>No tagged transactions yet</h4></div>`:
      `<div class="table-wrap"><table class="data-table table-cards no-toggle">
        <thead><tr><th>Date</th><th>Description</th><th>Ref #</th><th>Amount</th><th>Running Balance</th><th>Reconciled</th><th>Re-tag to</th></tr></thead>
        <tbody>${rows.map(r=>{
          running += (r.bankFlow==='in'?1:-1) * (+r.amount||0);
          return `<tr>
          <td data-label="Date" style="font-size:11px">${r.date||'—'}</td>
          <td data-label="Description" style="font-size:12px">${escHtml(r.description||'—')}</td>
          <td data-label="Ref #"><code>${escHtml(r.refNumber||'—')}</code></td>
          <td data-label="Amount" style="color:${r.bankFlow==='in'?'var(--success)':'var(--danger)'}">${r.bankFlow==='in'?'+':'-'}₱${fmt(r.amount||0)}</td>
          <td data-label="Running Balance" style="font-weight:700">₱${fmt(running)}</td>
          <td data-label="Reconciled"><input type="checkbox" class="ba-recon-chk" data-id="${escHtml(r.id)}" ${r.reconciled?'checked':''}/></td>
          <td data-label="Re-tag to"><select class="ba-retag-sel" data-id="${escHtml(r.id)}" style="font-size:11px;padding:3px 6px;max-width:60%">${bankOpts}</select></td>
        </tr>`; }).join('')}</tbody>
      </table></div>`}
    </div></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [wrap] });
  document.getElementById('ba-dd-close')?.addEventListener('click', () => { wrap.innerHTML=''; });
  wrap.querySelectorAll('.ba-recon-chk').forEach(chk => chk.addEventListener('change', async () => {
    try {
      await db.collection('ledger').doc(chk.dataset.id).update({
        reconciled: chk.checked,
        reconciledBy: currentUser.uid,
        reconciledAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
      Notifs.success(chk.checked?'Marked reconciled':'Marked unreconciled');
    } catch (ex) { Notifs.showToast('Could not update: '+(ex.message||ex),'error'); chk.checked = !chk.checked; }
  }));
  wrap.querySelectorAll('.ba-retag-sel').forEach(sel => sel.addEventListener('change', async () => {
    const newId = sel.value;
    if (!newId || newId === a.id) return;
    try {
      const acct = await window.BankAccounts.pick(newId);
      await db.collection('ledger').doc(sel.dataset.id).update({
        bankAccountId: acct.bankAccountId, bankAccountName: acct.bankAccountName
      });
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
      Notifs.success('Row re-tagged to another account');
      renderBankAccountDrilldown(a);
    } catch (ex) { Notifs.showToast('Could not re-tag: '+(ex.message||ex),'error'); }
  }));
}

// ── Cash Receipt Journal (for cash-based receipts only) ──
async function renderCashReceiptJournal(container, currentUser, currentRole) {
  return window.renderFinanceCrudTable(container, {
    collection: 'cash_receipt_journal', currentUser, currentRole,
    orderBy: ['date', 'desc'], limit: 100,
    emptyIcon: '🧾', emptyLabel: 'No cash receipt entries yet',
    addBtnLabel: '+ New Receipt Entry',
    actionsMode: 'privOnly',
    kpiHtml: (records) => {
      const totalCash = records.reduce((s,e)=>s+(e.debitCash||0),0);
      return `<div class="kpi-row">
        <div class="kpi-card green"><div class="kpi-label">Total Cash Received</div><div class="kpi-value">₱${fmt(totalCash)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Entries</div><div class="kpi-value">${records.length}</div></div>
      </div>`;
    },
    columns: [
      { header: 'Reference', mobile: 'detail', cell: e => `<code>${escHtml(e.reference||'—')}</code>` },
      { header: 'Date', mobile: 'avatar', cell: e => e.date||'—' },
      { header: 'Customer', mobile: 'name', cell: e => escHtml(e.customer||'—') },
      { header: 'Debit Cash', mobile: 'net', style: 'color:var(--success)', cell: e => `₱${fmt(e.debitCash)}` },
      { header: 'Debit Sales Discount', mobile: 'detail', cell: e => e.debitSalesDiscount?'₱'+fmt(e.debitSalesDiscount):'—' },
      { header: 'Credit A/R', mobile: 'detail', cell: e => e.creditAR?'₱'+fmt(e.creditAR):'—' },
      { header: 'Credit Sales Revenue', mobile: 'detail', cell: e => e.creditSalesRevenue?'₱'+fmt(e.creditSalesRevenue):'—' },
      { header: 'Credit Sundry (Acct)', mobile: 'detail', cell: e => escHtml(e.creditSundryAcct||'—') },
      { header: 'Credit Sundry (Amount)', mobile: 'detail', cell: e => e.creditSundryAmount?'₱'+fmt(e.creditSundryAmount):'—' }
    ],
    editTitle: 'Cash Receipt',
    deleteLabel: e => `cash receipt "${(e.customer||'receipt')+' — ₱'+fmt(e.debitCash)}"`,
    editFields: e => [
      { key:'reference', label:'Reference', type:'text', value:e.reference },
      { key:'date', label:'Date', type:'date', value:e.date },
      { key:'customer', label:'Customer', type:'text', value:e.customer, full:true },
      { key:'debitCash', label:'Debit: Cash (₱)', type:'number', value:e.debitCash },
      { key:'debitSalesDiscount', label:'Debit: Sales Discount (₱)', type:'number', value:e.debitSalesDiscount },
      { key:'creditAR', label:'Credit: A/R (₱)', type:'number', value:e.creditAR },
      { key:'creditSalesRevenue', label:'Credit: Sales Revenue (₱)', type:'number', value:e.creditSalesRevenue },
      { key:'creditSundryAcct', label:'Credit: Sundry Account', type:'text', value:e.creditSundryAcct },
      { key:'creditSundryAmount', label:'Credit: Sundry Amount (₱)', type:'number', value:e.creditSundryAmount }
    ],
    // Edit doesn't just .update() the doc — the mirrored ledger row must stay in
    // sync, so onSaved chains resyncLedgerForSource(...).then(redo) instead of redo.
    editOnSaved: (e, redo) => () => { resyncLedgerForSource('cash_receipt_journal', e.id).then(redo); },
    addModal: {
      title: 'New Cash Receipt Entry',
      // beforeOpen fetches bankOpts BEFORE openPage() — same ordering as the
      // pre-migration `const bankOpts = await BankAccounts.optionsHTML(); openPage(...)`.
      beforeOpen: async () => ({ bankOpts: await window.BankAccounts.optionsHTML() }),
      bodyHtml: (pre) => `
        <div class="form-row">
          <div class="form-group"><label>Reference</label><input id="crj-ref" placeholder="OR #, Receipt #…"/>${window.birOrButtonHTML ? window.birOrButtonHTML('crj-ref') : ''}</div>
          <div class="form-group"><label>Date</label><input id="crj-date" type="date" value="${today()}"/></div>
        </div>
        <div class="form-group"><label>Customer</label><input id="crj-customer" placeholder="Customer name"/></div>
        <div class="form-row">
          <div class="form-group"><label>Debit: Cash (₱)</label><input id="crj-cash" type="number" step="0.01" value="0" inputmode="decimal"/></div>
          <div class="form-group"><label>Debit: Sales Discount (₱)</label><input id="crj-discount" type="number" step="0.01" value="0" inputmode="decimal"/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Credit: Accounts Receivable (₱)</label><input id="crj-ar" type="number" step="0.01" value="0" inputmode="decimal"/></div>
          <div class="form-group"><label>Credit: Sales Revenue (₱)</label><input id="crj-revenue" type="number" step="0.01" value="0" inputmode="decimal"/></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Credit: Sundry Account</label><input id="crj-sundry-acct" placeholder="e.g. Other Income"/></div>
          <div class="form-group"><label>Credit: Sundry Amount (₱)</label><input id="crj-sundry-amt" type="number" step="0.01" value="0" inputmode="decimal"/></div>
        </div>
        <div class="form-group"><label>Received into (company account)</label>
          <select id="crj-bank" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${pre.bankOpts}</select></div>
      `,
      footerHtml: `<button class="btn-primary" id="save-crj-btn">Save Entry</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`,
      saveBtnId: 'save-crj-btn',
      afterOpen: () => { window.wireBirOrButtons && window.wireBirOrButtons(); },
      buildDoc: async (ctx) => {
        const customer = document.getElementById('crj-customer').value.trim();
        const debitCash = parseFloat(document.getElementById('crj-cash').value)||0;
        if (!customer) { Notifs.showToast('Enter a customer name.','error'); return null; }
        if (!debitCash) { Notifs.showToast('Enter the cash amount received.','error'); return null; }
        const crjAcct = await window.BankAccounts.pick(document.getElementById('crj-bank').value);
        const crjData = {
          reference:           document.getElementById('crj-ref').value.trim(),
          date:                document.getElementById('crj-date').value,
          customer,
          debitCash,
          debitSalesDiscount:  parseFloat(document.getElementById('crj-discount').value)||0,
          creditAR:            parseFloat(document.getElementById('crj-ar').value)||0,
          creditSalesRevenue:  parseFloat(document.getElementById('crj-revenue').value)||0,
          creditSundryAcct:    document.getElementById('crj-sundry-acct').value.trim(),
          creditSundryAmount:  parseFloat(document.getElementById('crj-sundry-amt').value)||0,
          bankAccountId:  crjAcct.bankAccountId||null,
          bankAccountName: crjAcct.bankAccountName||null,
          addedBy:    ctx.currentUser.uid,
          addedByName: window.userProfile?.displayName || ctx.currentUser.email,
          createdAt:  firebase.firestore.FieldValue.serverTimestamp()
        };
        try {
          await window.assertPeriodOpen(crjData.date);
        } catch (e) { return null; } // toast already shown by assertPeriodOpen
        return crjData;
      },
      afterSave: async (docId, doc) => { await postCRJToLedger(docId, doc); }, // mirror new income into the ledger
      successMsg: 'Cash receipt entry saved!'
    }
  });
}

// ── Cash Disbursement Journal (for cash-based expenses only) ──
async function renderCashDisbursementJournal(container, currentUser, currentRole) {
  return window.renderFinanceCrudTable(container, {
    collection: 'cash_disbursement_journal', currentUser, currentRole,
    orderBy: ['date', 'desc'], limit: 100,
    emptyIcon: '🧾', emptyLabel: 'No cash disbursement entries yet',
    addBtnLabel: '+ New Disbursement Entry',
    actionsMode: 'privOnly',
    kpiHtml: (records) => {
      const totalCash = records.reduce((s,e)=>s+(e.creditCash||0),0);
      return `<div class="kpi-row">
        <div class="kpi-card red"><div class="kpi-label">Total Cash Disbursed</div><div class="kpi-value">₱${fmt(totalCash)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Entries</div><div class="kpi-value">${records.length}</div></div>
      </div>`;
    },
    columns: [
      { header: 'Reference', mobile: 'detail', cell: e => `<code>${escHtml(e.reference||'—')}</code>` },
      { header: 'Date', mobile: 'avatar', cell: e => e.date||'—' },
      { header: 'Payee', mobile: 'name', cell: e => escHtml(e.payee||'—') },
      { header: 'Credit Cash', mobile: 'net', style: 'color:var(--danger)', cell: e => `₱${fmt(e.creditCash)}` },
      { header: 'Debit COS–Direct Material', mobile: 'detail', cell: e => e.debitMaterial?'₱'+fmt(e.debitMaterial):'—' },
      { header: 'Debit Accounts Payable', mobile: 'detail', cell: e => e.debitAP?'₱'+fmt(e.debitAP):'—' },
      { header: 'Debit COS–Direct Labor', mobile: 'detail', cell: e => e.debitLabor?'₱'+fmt(e.debitLabor):'—' },
      { header: 'Debit Sundry (Acct)', mobile: 'detail', cell: e => escHtml(e.debitSundryAcct||'—') },
      { header: 'Debit Sundry (Amount)', mobile: 'detail', cell: e => e.debitSundryAmount?'₱'+fmt(e.debitSundryAmount):'—' }
    ],
    editTitle: 'Cash Disbursement',
    deleteLabel: e => `cash disbursement "${(e.payee||'disbursement')+' — ₱'+fmt(e.creditCash)}"`,
    editFields: e => [
      { key:'reference', label:'Reference', type:'text', value:e.reference },
      { key:'date', label:'Date', type:'date', value:e.date },
      { key:'payee', label:'Payee', type:'text', value:e.payee, full:true },
      { key:'creditCash', label:'Credit: Cash (₱)', type:'number', value:e.creditCash },
      { key:'debitMaterial', label:'Debit: COS – Direct Material (₱)', type:'number', value:e.debitMaterial },
      { key:'debitAP', label:'Debit: Accounts Payable (₱)', type:'number', value:e.debitAP },
      { key:'debitLabor', label:'Debit: COS – Direct Labor (₱)', type:'number', value:e.debitLabor },
      { key:'debitSundryAcct', label:'Debit: Sundry Account', type:'text', value:e.debitSundryAcct },
      { key:'debitSundryAmount', label:'Debit: Sundry Amount (₱)', type:'number', value:e.debitSundryAmount }
    ],
    editOnSaved: (e, redo) => () => { resyncLedgerForSource('cash_disbursement_journal', e.id).then(redo); },
    // Input VAT only applies to VATable purchases (material + sundry); mirrors the
    // create-path calc so an edited CDJ carries correct input VAT (v13 Phase 16).
    editTransform: (e) => (upd) => {
      if (e.vatTreatment === 'exempt') { upd.vatAmount = 0; return; }
      const base = (parseFloat(upd.debitMaterial)||0) + (parseFloat(upd.debitSundryAmount)||0);
      upd.vatAmount = window.vatSplit(base, 'inclusive').vat;
    },
    addModal: {
      title: 'New Cash Disbursement Entry',
      beforeOpen: async () => ({ bankOpts: await window.BankAccounts.optionsHTML() }),
      bodyHtml: (pre) => `
        <div class="form-row">
          <div class="form-group"><label>Reference</label><input id="cdj-ref" placeholder="Voucher #, Check #…"/></div>
          <div class="form-group"><label>Date</label><input id="cdj-date" type="date" value="${today()}"/></div>
        </div>
        <div class="form-group"><label>Payee</label><input id="cdj-payee" placeholder="Payee name"/></div>
        <div class="form-group"><label>Credit: Cash (₱)</label><input id="cdj-cash" type="number" step="0.01" value="0" inputmode="decimal"/></div>
        <div class="form-row">
          <div class="form-group"><label>Debit: COS – Direct Material (₱)</label><input id="cdj-material" type="number" step="0.01" value="0" inputmode="decimal"/></div>
          <div class="form-group"><label>Debit: Accounts Payable (₱)</label><input id="cdj-ap" type="number" step="0.01" value="0" inputmode="decimal"/></div>
        </div>
        <div class="form-group"><label>Debit: COS – Direct Labor (₱)</label><input id="cdj-labor" type="number" step="0.01" value="0" inputmode="decimal"/></div>
        <div class="form-row">
          <div class="form-group"><label>Debit: Sundry Account</label><input id="cdj-sundry-acct" placeholder="e.g. Utilities Expense"/></div>
          <div class="form-group"><label>Debit: Sundry Amount (₱)</label><input id="cdj-sundry-amt" type="number" step="0.01" value="0" inputmode="decimal"/></div>
        </div>
        <div class="form-group"><label>Input VAT</label>
          <select id="cdj-vat" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
            <option value="inclusive" selected>VATable — 12% input VAT in the cash amount (claimable)</option>
            <option value="exempt">No input VAT (exempt / non-VAT)</option>
          </select>
        </div>
        <div class="form-group"><label>Paid from (company account)</label>
          <select id="cdj-bank" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${pre.bankOpts}</select></div>
      `,
      footerHtml: `<button class="btn-primary" id="save-cdj-btn">Save Entry</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`,
      saveBtnId: 'save-cdj-btn',
      buildDoc: async (ctx) => {
        const payee = document.getElementById('cdj-payee').value.trim();
        const creditCash = parseFloat(document.getElementById('cdj-cash').value)||0;
        if (!payee) { Notifs.showToast('Enter a payee name.','error'); return null; }
        if (!creditCash) { Notifs.showToast('Enter the cash amount disbursed.','error'); return null; }
        // Input VAT only applies to VATable purchases (material + sundry). Direct labor
        // carries no input VAT, so it's excluded from the VAT base.
        const _cdjVatBase = (parseFloat(document.getElementById('cdj-material').value)||0)
          + (parseFloat(document.getElementById('cdj-sundry-amt').value)||0);
        const _cdjInputVat = document.getElementById('cdj-vat').value === 'exempt' ? 0 : window.vatSplit(_cdjVatBase,'inclusive').vat;
        const cdjBankSel = document.getElementById('cdj-bank').value;
        if (!cdjBankSel && (await window.BankAccounts.list()).length) { Notifs.showToast('Select the paying account.', 'error'); return null; }
        const cdjAcct = await window.BankAccounts.pick(cdjBankSel);
        const cdjData = {
          reference:         document.getElementById('cdj-ref').value.trim(),
          date:              document.getElementById('cdj-date').value,
          payee,
          creditCash,
          debitMaterial:     parseFloat(document.getElementById('cdj-material').value)||0,
          debitAP:           parseFloat(document.getElementById('cdj-ap').value)||0,
          debitLabor:        parseFloat(document.getElementById('cdj-labor').value)||0,
          debitSundryAcct:   document.getElementById('cdj-sundry-acct').value.trim(),
          debitSundryAmount: parseFloat(document.getElementById('cdj-sundry-amt').value)||0,
          vatAmount: _cdjInputVat, vatTreatment: document.getElementById('cdj-vat').value,
          bankAccountId:  cdjAcct.bankAccountId||null,
          bankAccountName: cdjAcct.bankAccountName||null,
          addedBy:    ctx.currentUser.uid,
          addedByName: window.userProfile?.displayName || ctx.currentUser.email,
          createdAt:  firebase.firestore.FieldValue.serverTimestamp()
        };
        try {
          await window.assertPeriodOpen(cdjData.date);
        } catch (e) { return null; } // toast already shown by assertPeriodOpen
        return cdjData;
      },
      afterSave: async (docId, doc) => { await postCDJToLedger(docId, doc); }, // mirror the expense into the ledger
      successMsg: 'Cash disbursement entry saved!'
    }
  });
}

// ── Records & Receipts Tab ──────────────────────
async function renderRecordsTab(container, currentUser, currentRole) {
  return window.renderFinanceCrudTable(container, {
    collection: 'finance_records', currentUser, currentRole,
    orderBy: ['createdAt', 'desc'], limit: 100,
    emptyIcon: '🧾', emptyLabel: 'No records yet',
    addBtnLabel: '+ Encode Record',
    actionsMode: 'privOnly',
    headerExtra: () => `
      <div style="display:flex;gap:8px">
        <select id="rec-filter" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:13px">
          <option value="">All Types</option>
          <option>Receipt</option><option>Invoice</option><option>Voucher</option>
          <option>Contract</option><option>Official Receipt</option><option>Other</option>
        </select>
      </div>`,
    filter: { id: 'rec-filter', matches: (r, fv) => (r.type||'')===fv },
    columns: [
      { header: 'Date', mobile: 'avatar', cell: r => r.date||'—' },
      { header: 'Type', mobile: 'detail', cell: r => `<span class="badge badge-blue">${escHtml(r.type||'—')}</span>` },
      { header: 'Description', mobile: 'name', cell: r => escHtml(r.description||'—') },
      { header: 'Amount', mobile: 'net', cell: r => `₱${fmt(r.amount)}` },
      { header: 'From/To', mobile: 'detail', cell: r => escHtml(r.party||'—') },
      { header: 'File', mobile: 'detail', cell: r => r.fileUrl?`<a href="${safeHttpUrl(r.fileUrl)}" target="_blank" class="btn-secondary btn-sm">${emojiIcon('📎',16)} View</a>`:'-' },
      { header: 'By', mobile: 'detail', style: 'font-size:11px', cell: r => escHtml(r.encodedByName||'—') }
    ],
    editTitle: 'Record',
    deleteLabel: r => `record "${(r.type||'record')+' — '+(r.description||r.id.slice(-5))}"`,
    editFields: r => [
      { key:'date', label:'Date', type:'date', value:r.date },
      { key:'type', label:'Type', type:'select', value:r.type, options:['Receipt','Invoice','Official Receipt','Voucher','Contract','Other'] },
      { key:'description', label:'Description', type:'text', value:r.description, full:true },
      { key:'amount', label:'Amount (₱)', type:'number', value:r.amount },
      { key:'party', label:'From / To', type:'text', value:r.party },
      { key:'notes', label:'Notes', type:'textarea', value:r.notes, full:true }
    ],
    addModal: {
      title: 'Encode Record / Receipt',
      bodyHtml: `
        <div class="form-row">
          <div class="form-group"><label>Date</label><input id="rec-date" type="date" value="${today()}"/></div>
          <div class="form-group"><label>Type</label>
            <select id="rec-type" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
              <option>Receipt</option><option>Invoice</option><option>Official Receipt</option>
              <option>Voucher</option><option>Contract</option><option>Other</option>
            </select>
          </div>
        </div>
        <div class="form-group"><label>Description</label><input id="rec-desc" placeholder="What is this for?"/></div>
        <div class="form-row">
          <div class="form-group"><label>Amount (₱)</label><input id="rec-amount" type="number" step="0.01" inputmode="decimal"/></div>
          <div class="form-group"><label>From / To</label><input id="rec-party" placeholder="Supplier, client, or payee"/></div>
        </div>
        <div class="form-group"><label>Notes</label><textarea id="rec-notes" rows="2" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);color:var(--text)"></textarea></div>
        <div id="rec-file-area"></div>
      `,
      footerHtml: `<button class="btn-primary" id="save-rec-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`,
      saveBtnId: 'save-rec-btn',
      afterOpen: (ctx) => { Drive.renderUploadArea('rec-file-area', f => ctx.setFile(f), {label:'Attach receipt scan / photo',dept:'Finance',subfolder:'Records'}); },
      buildDoc: (ctx) => ({
        date:         document.getElementById('rec-date').value,
        type:         document.getElementById('rec-type').value,
        description:  document.getElementById('rec-desc').value.trim(),
        amount:       parseFloat(document.getElementById('rec-amount').value)||0,
        party:        document.getElementById('rec-party').value.trim(),
        notes:        document.getElementById('rec-notes').value.trim(),
        fileUrl:      ctx.getFile()?.url||null, fileName: ctx.getFile()?.name||null,
        encodedBy:    ctx.currentUser.uid,
        encodedByName:userProfile?.displayName||ctx.currentUser.email,
        createdAt:    firebase.firestore.FieldValue.serverTimestamp()
      }),
      successMsg: 'Record saved!'
    },
    afterRender: (container, records) => {
      // ── Accounting Documents (file archive) ──────────────
      const acctSection = document.createElement('div');
      acctSection.style.marginTop = '24px';
      acctSection.innerHTML = renderFileCollection('Accounting Documents', 'fin-acct', currentRole);
      container.appendChild(acctSection);
      bindFileCollection('fin-acct', currentUser, 'Finance', 'Accounting');
    }
  });
}

// runCADataRepair moved to js/migrations.js (v13 Phase 37)

function openCADataRepairModal(onDone) {
  window.runCADataRepair(true).then(report => {
    const total = report.normalizedActive.length + report.interestRestored.length + report.legacyTermsBackfilled.length;
    const listRows = (arr, cols) => arr.length
      ? arr.map(r => `<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)">${escHtml(r.userName)} — ${cols(r)}</div>`).join('')
      : `<div style="font-size:12px;color:var(--text-muted)">None found.</div>`;
    openPage(`${emojiIcon('🔄',16)} Cash Advance Data Repair — Dry Run`, `
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">Scanned every cash_advances record. Nothing has been written yet.</p>
      <div style="margin-bottom:14px"><strong>Status 'active' → 'approved'</strong> (${report.normalizedActive.length})${listRows(report.normalizedActive, r=>`will be normalized`)}</div>
      <div style="margin-bottom:14px"><strong>Interest restored</strong> (${report.interestRestored.length})${listRows(report.interestRestored, r=>`₱${fmt(r.from)} → ₱${fmt(r.to)}`)}</div>
      <div style="margin-bottom:14px"><strong>${emojiIcon('⚠️',16)} Mid-repayment — needs your call, NOT auto-fixed</strong> (${report.midRepaymentFlagged.length})${listRows(report.midRepaymentFlagged, r=>`balance ₱${fmt(r.balance)}, paid ₱${fmt(r.paidSoFar)}, totalPayable ₱${fmt(r.totalPayable)}`)}</div>
      <div style="margin-bottom:14px"><strong>Legacy docs — explicit single-payment plan</strong> (${report.legacyTermsBackfilled.length})${listRows(report.legacyTermsBackfilled, r=>`terms:1 added`)}</div>
    `, total
      ? `<button class="btn-primary" id="ca-repair-apply-btn">Apply ${total} Fix${total>1?'es':''}</button><button class="btn-secondary" onclick="closeModal()">Close</button>`
      : `<button class="btn-secondary" onclick="closeModal()">Close</button>`);
    document.getElementById('ca-repair-apply-btn')?.addEventListener('click', async () => {
      if (!(await confirmDialog({message:`Apply ${total} cash-advance data fix(es)? This writes to live records.`}))) return;
      await window.runCADataRepair(false);
      closeModal();
      Notifs.success('CA data repair applied.');
      if (onDone) onDone();
    });
  });
}

async function renderFinanceCA(container, currentUser, currentRole) {
  const isPrivileged = isFinancePriv();
  container.innerHTML = window.skeletonHtml('rows');

  const snap = await db.collection('cash_advances').get().catch(()=>({docs:[]}));
  const all  = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>{
    const ta = a.createdAt?.toMillis?.() || 0;
    const tb = b.createdAt?.toMillis?.() || 0;
    return tb - ta;
  });
  const pending  = all.filter(a=>a.status==='pending');
  const active   = all.filter(a=>a.status==='approved'&&(a.balance||0)>0);
  const settled  = all.filter(a=>a.status==='approved'&&(a.balance||0)<=0);
  const rejected = all.filter(a=>a.status==='rejected');
  const totalOutstanding = active.reduce((s,a)=>s+(a.balance||0),0);

  container.innerHTML = `
    <div class="kpi-row" style="margin-bottom:14px">
      <div class="kpi-card red"><div class="kpi-label">Outstanding</div><div class="kpi-value" style="font-size:15px">₱${fmt(totalOutstanding)}</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Pending</div><div class="kpi-value">${pending.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Active Loans</div><div class="kpi-value">${active.length}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Settled</div><div class="kpi-value">${settled.length}</div></div>
    </div>
    ${isPrivileged?`<div style="display:flex;gap:8px;margin-bottom:14px">
      <button class="btn-primary btn-sm" id="fin-ca-add-btn">+ Add CA Record</button>
    </div>`:''}
    <div id="fin-ca-tabs" style="margin-bottom:14px">${window.chipTabs([
      {key:'pending', label:'Pending', count:pending.length},
      {key:'active',  label:'Active',  count:active.length},
      {key:'all',     label:'All Records'}
    ], 'pending')}</div>
    <div id="fin-ca-list"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  const renderFinCAList = (records) => {
    const list = document.getElementById('fin-ca-list');
    if (!records.length) { list.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('💸',44)}</div><p>None.</p></div>`; return; }
    if (window.lucide) lucide.createIcons({ nodes: [list] });
    list.innerHTML = records.map(a=>`
      <div class="ca-card" data-id="${a.id}">
        <div class="ca-card-header">
          <div class="ca-card-name">${escHtml(a.userName||'Unknown')} <span style="font-size:11px;color:var(--text-muted)">${escHtml(a.employeeId||'')}</span></div>
          <span class="badge ${statusBadge(a.status)}">${a.status}</span>
        </div>
        <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--text-muted);margin-bottom:10px">
          <span>Amount: <strong>₱${fmt(a.amount)}</strong></span>
          <span>Balance: <strong style="color:${(a.balance||0)>0?'var(--danger)':'var(--success)'}">₱${fmt(a.balance||0)}</strong></span>
          ${a.monthlyPayment?`<span>Monthly: <strong>₱${fmt(a.monthlyPayment)}</strong></span>`:''}
          <span>Date: ${a.date||'—'}</span>
        </div>
        ${a.reason?`<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${escHtml(a.reason)}</div>`:''}
        ${a.status==='pending'&&isPrivileged?`
        <div style="display:flex;gap:8px">
          <button class="btn-success btn-sm fin-ca-approve" data-id="${a.id}" data-uid="${a.userId}" data-amount="${a.amount}" data-name="${escHtml(a.userName||'')}">${emojiIcon('✓',16)} Approve</button>
          <button class="btn-danger btn-sm fin-ca-reject" data-id="${a.id}" data-uid="${a.userId}" data-name="${escHtml(a.userName||'')}">${emojiIcon('✗',16)} Reject</button>
        </div>`:''}
        ${a.status==='approved'&&(a.balance||0)>0&&isPrivileged?`
        <button class="btn-secondary btn-sm fin-ca-pay" data-id="${a.id}" data-balance="${a.balance||0}" data-monthly="${a.monthlyPayment||0}" data-uid="${a.userId||''}" data-name="${escHtml(a.userName||'')}">${emojiIcon('💳',16)} Record Payment</button>`:''}
        ${isPrivileged?`<button class="btn-secondary btn-sm fin-ca-edit" data-id="${a.id}" style="margin-left:4px" title="Edit" aria-label="Edit cash advance">${emojiIcon('✎',16)}</button>`:''}
        ${isPrivileged?`<button class="btn-secondary btn-sm fin-ca-del" data-id="${a.id}" data-label="${escHtml((a.userName||'CA')+' — ₱'+fmt(a.amount))}" style="color:var(--danger);margin-left:4px" title="${isRealPresident()?'Delete':'Request deletion'}" aria-label="${isRealPresident()?'Delete cash advance':'Request cash advance deletion'}">${emojiIcon('trash-2',14)}</button>`:''}
      </div>`).join('');
    if (window.lucide) lucide.createIcons({ nodes: [list] });

    // v12 WS22 — all three actions route through the one shared CashAdvance
    // service (fixes: this approve used to ignore totalPayable/interest, and
    // this payment path had no transaction guard).
    list.querySelectorAll('.fin-ca-approve').forEach(btn=>btn.addEventListener('click',e=>{
      window.CashAdvance.openApproveModal(e.currentTarget.dataset.id, () => renderFinanceCA(container,currentUser,currentRole));
    }));
    list.querySelectorAll('.fin-ca-reject').forEach(btn=>btn.addEventListener('click',async e=>{
      try { await window.CashAdvance.reject(e.currentTarget.dataset.id); Notifs.error(`Rejected for ${e.currentTarget.dataset.name}`); }
      catch (err) { Notifs.showToast(err.message||'Could not reject.','error'); }
      renderFinanceCA(container,currentUser,currentRole);
    }));
    list.querySelectorAll('.fin-ca-pay').forEach(btn=>btn.addEventListener('click',e=>{
      window.CashAdvance.openPaymentModal(e.currentTarget.dataset.id, () => renderFinanceCA(container,currentUser,currentRole));
    }));
    list.querySelectorAll('.fin-ca-edit').forEach(btn=>btn.addEventListener('click',()=>{
      const a = records.find(x=>x.id===btn.dataset.id) || all.find(x=>x.id===btn.dataset.id);
      if(!a) return;
      window.financeEditModal({ collection:'cash_advances', docId:a.id, title:'Cash Advance', onSaved:()=>renderFinanceCA(container,currentUser,currentRole), fields:[
        { key:'amount', label:'Amount (₱)', type:'number', value:a.amount },
        { key:'monthlyPayment', label:'Monthly Payment (₱)', type:'number', value:a.monthlyPayment },
        { key:'date', label:'Date', type:'date', value:a.date },
        { key:'reason', label:'Reason', type:'textarea', value:a.reason, full:true }
      ]});
    }));
    list.querySelectorAll('.fin-ca-del').forEach(btn=>btn.addEventListener('click',()=>{
      window.financeDelete({ collection:'cash_advances', docId:btn.dataset.id, label:`cash advance "${btn.dataset.label}"`, onDone:()=>renderFinanceCA(container,currentUser,currentRole) });
    }));
  };

  let currentSub='pending';
  const showSub=(sub)=>{
    currentSub=sub;
    const map={pending,active,all};
    renderFinCAList(sub==='all'?all:(map[sub]||[]));
  };
  showSub('pending');

  window.bindChipTabs(document.getElementById('fin-ca-tabs'), (key) => showSub(key));

  if(isPrivileged){
    document.getElementById('fin-ca-add-btn')?.addEventListener('click',()=>{
      window.renderCashAdvancePage && window.openPresidentCashAdvanceModal ? window.openPresidentCashAdvanceModal() : navigateTo('cash-advance');
    });
  }
}

// ── Finance Overview ──────────────────────────────
async function renderFinanceOverview(container, currentUser, currentRole) {
  // These collection-wide reads are only permitted for finance/admin by the
  // Firestore rules. A non-finance user who merely belongs to the Finance dept
  // can open this tab, so degrade gracefully instead of crashing the screen.
  // Totals come from finance_rollup (v14 Wave 4 Batch F2) — one doc per month,
  // client-maintained by window.Ledger's post/postMulti/upsertByRef/delete
  // hooks (js/finance-ledger.js) — instead of a full ledger collection scan.
  // The expenses collection is still read for the pending-approval queue +
  // the recent-expenses list (unaffected by this batch).
  const [pendSnap, recentSnap, rollupSnap] = await Promise.all([
    dbCachedGet('expenses-pending', () => db.collection('expenses').where('status','==','pending').get().catch(()=>({docs:[]})), 45000),
    dbCachedGet('expenses-recent',  () => db.collection('expenses').orderBy('date','desc').limit(50).get().catch(()=>({docs:[]})), 45000),
    dbCachedGet('finance_rollup',   () => db.collection('finance_rollup').get().catch(()=>({docs:[]})), 45000),
  ]);
  const pendingExpDocs = pendSnap.docs.map(d => ({id:d.id,...d.data()}));
  const expenses       = recentSnap.docs.map(d => ({id:d.id,...d.data()}));  // for the Recent Expenses card
  const rollups        = rollupSnap.docs.map(d => d.data());
  const isPriv     = isFinancePriv();
  const isPres     = (typeof isPresident==='function') && isPresident();
  const ledIncome  = rollups.reduce((s,r) => s + (r.income||0), 0);
  const ledExpense = rollups.reduce((s,r) => s + (r.expense||0), 0);
  const pendingExp = pendingExpDocs.reduce((s,e) => s + (e.amount||0), 0);
  // finance_rollup is empty before the very first Rebuild rollups run (or if
  // it's ever wiped mid-rebuild) — the cheap existence check the spec calls
  // for: don't scan the whole ledger, just confirm it isn't ALSO empty before
  // showing a zero total as if it were real.
  let needsRollupRebuild = false;
  if (!rollups.length) {
    const anyLedgerSnap = await db.collection('ledger').limit(1).get().catch(()=>({docs:[]}));
    needsRollupRebuild = anyLedgerSnap.docs.length > 0;
  }

  container.innerHTML = `
    ${isPres?`<div style="display:flex;justify-content:flex-end;margin-bottom:8px">
      <button class="btn-secondary btn-sm" id="fin-tools-btn" title="President-only maintenance &amp; data-repair tools">${emojiIcon('🔧',16)} Finance Tools</button>
    </div>`:''}
    ${needsRollupRebuild?`<div class="card" style="margin-bottom:12px;border-color:var(--warning,#FF9F0A)">
      <div class="card-body" style="display:flex;align-items:center;gap:8px;font-size:13px">
        ${emojiIcon('⚠️',16)} <span>Totals need a rebuild — ${isPres?'Finance Tools → Rebuild rollups.':'ask the President to run Finance Tools → Rebuild rollups.'}</span>
      </div>
    </div>`:''}
    <div class="kpi-row">
      <div class="kpi-card green"><div class="kpi-label">Total Income</div><div class="kpi-value">${needsRollupRebuild?'—':'₱'+fmt(ledIncome)}</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Total Expenses</div><div class="kpi-value">${needsRollupRebuild?'—':'₱'+fmt(ledExpense)}</div></div>
      <div class="kpi-card accent"><div class="kpi-label">Pending Expenses</div><div class="kpi-value">₱${fmt(pendingExp)}</div></div>
    </div>
    <div class="card">
      <div class="card-header" style="display:flex;justify-content:space-between;align-items:center"><h3>Recent Expenses</h3>${expenses.length?`<button class="btn-secondary btn-sm" id="exp-csv-btn">${emojiIcon('⬇',16)} CSV</button>`:''}</div>
      <div class="card-body">
        <div class="table-wrap">
          <table class="data-table table-cards">
            <thead><tr><th>Description</th><th>Amount</th><th>By</th><th>Status</th><th></th></tr></thead>
            <tbody>
              ${expenses.slice(0,10).map(e => `<tr class="exp-row">
                <td class="tc-name">${escHtml(e.description)} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
                <td class="tc-net">₱${fmt(e.amount)}</td>
                <td class="tc-detail" data-label="By">${escHtml(e.submittedByName||'—')}</td>
                <td class="tc-detail" data-label="Status"><span class="badge ${statusBadge(e.status)}">${e.status||'pending'}</span></td>
                <td class="tc-actions" style="white-space:nowrap">${e.fileUrl?`<a href="${safeHttpUrl(e.fileUrl)}" target="_blank" class="btn-icon">${emojiIcon('📎',16)}</a>`:''}${isPriv?`<button class="btn-secondary btn-sm exp-edit-btn" data-id="${e.id}" style="margin-left:4px" aria-label="Edit expense">${emojiIcon('✎',16)}</button><button class="btn-danger btn-sm exp-del-btn" data-id="${e.id}" data-label="${escHtml(e.description||e.id.slice(-5))}" style="margin-left:4px" aria-label="Delete expense">${emojiIcon('trash-2',14)}</button>`:''}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });
  container.querySelectorAll('tr.exp-row').forEach(tr => tr.addEventListener('click', (ev) => {
    if (ev.target.closest('button, a')) return;
    tr.classList.toggle('tc-expanded');
  }));
  document.getElementById('fin-tools-btn')?.addEventListener('click', () => openFinanceToolsPage());
  document.getElementById('exp-csv-btn')?.addEventListener('click', () => window.exportCSV('expenses', expenses, [
    {key:'date',label:'Date'},{key:'description',label:'Description'},{key:'category',label:'Category'},
    {key:'amount',label:'Amount',get:e=>e.amount||0},{key:'submittedByName',label:'By'},{key:'status',label:'Status',get:e=>e.status||'pending'},{key:'fileUrl',label:'Receipt'}]));

  if (isPriv) {
    const redo = () => renderFinanceOverview(container, currentUser, currentRole);
    container.querySelectorAll('.exp-edit-btn').forEach(btn => btn.addEventListener('click', () => {
      const e = expenses.find(x=>x.id===btn.dataset.id); if (!e) return;
      window.financeEditModal({ collection:'expenses', docId:e.id, title:'Expense', onSaved:()=>{ resyncLedgerForSource('expenses', e.id).then(redo); }, fields:[
        { key:'description', label:'Description', type:'text', value:e.description, full:true },
        { key:'amount', label:'Amount (₱)', type:'number', value:e.amount },
        { key:'category', label:'Category', type:'text', value:e.category },
        { key:'status', label:'Status', type:'select', value:e.status||'pending', options:['pending','approved','rejected','paid'] }
      ]});
    }));
    container.querySelectorAll('.exp-del-btn').forEach(btn => btn.addEventListener('click', () => {
      window.financeDelete({ collection:'expenses', docId:btn.dataset.id, label:`expense "${btn.dataset.label}"`, onDone:redo });
    }));
  }
}
