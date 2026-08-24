/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Department Modules
   departments.js
═══════════════════════════════════════════════════ */

'use strict';

// ── Shared helpers ────────────────────────────────
function deptContainer() { return document.getElementById('page-content'); }
function fmt(n) { return window.fmtN2(n); }
function today() { return (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10)); }
function priorityBadge(p) { return {high:'badge-red',medium:'badge-orange',low:'badge-green',urgent:'badge-red'}[p]||'badge-gray'; }

// Departments the Corporate Secretary may NOT reach. Owner ruling, 2026-08-08:
// "corporate secretary can access all departments except finance, and IT"
// (re-confirmed: "Dont give corporate secretary access to finance and it").
// Mirrors firestore.rules — isFinanceDept()'s role exclusion and canIt(). The
// RULES are the real boundary (this client talks to Firestore directly, so every
// gate in this file is advisory); this list only stops the UI offering a control
// whose write the boundary will refuse.
window.SECRETARY_BLOCKED_DEPTS = ['Finance', 'IT'];

// The blocked-set test as ONE expression, for the predicates that are keyed on
// DEPARTMENT MEMBERSHIP rather than on role. Owner ruling 3: an assignment must
// never beat the role decision — "one dropdown in People & Roles" cannot restore
// Finance access — so a `currentDepts.includes('Finance')` leg needs this said
// explicitly, exactly as firestore.rules' isFinanceDept() carries its own
// `role != 'secretary'` conjunct. Mirrors js/app.js's _deptBlockedForRole (the
// navigation interception point), which is deliberately private to that file.
function deptBlockedForSecretary(dept) {
  return (window.currentRole || '') === 'secretary'
    && (window.SECRETARY_BLOCKED_DEPTS || ['Finance', 'IT']).includes(dept);
}
window.deptBlockedForSecretary = deptBlockedForSecretary;

// Returns true if user is an admin role OR is a member of the given department.
// Use this for write-access checks inside department modules so that dept members
// can manage their own content regardless of their system role.
function canEditDept(dept) {
  const role = window.currentRole || '';
  if (['president','owner','manager'].includes(role)) return true;
  // 'secretary' (Corporate Secretary) keeps manager-level edit access across the
  // company EXCEPT Finance and IT.
  // ⚠ This line used to sit in the blanket admin list above and so returned true
  // BEFORE the `dept` argument was ever inspected — which is precisely what made
  // isFinancePriv() (= canEditDept('Finance')) true for the secretary and handed
  // them all 13 of its readers, the Finance screens included.
  if (role === 'secretary') return !window.SECRETARY_BLOCKED_DEPTS.includes(dept);
  // Accountant (finance role): full edit rights to the FINANCE department only — not
  // other departments. Deletes still route through President approval (financeDelete).
  if (role === 'finance') return dept === 'Finance';
  return (window.currentDepts || []).includes(dept);
}
// Shorthand for Finance-specific privilege (Payroll, HR Profiles, etc.)
// NOTE: as of 2026-08-09 this is FALSE for 'secretary'. Twelve of its thirteen
// readers are genuinely finance and that is the intent. The thirteenth was Work
// Sites (openWorkSitesPage, js/screens/hr.js) — the geo_sites attendance-geofence
// admin, pure HR, riding this predicate only because it lives in hr.js. It was
// moved to isOpsPriv() below in the same change; without that the rules would
// have allowed the write while the UI hid the button, and nobody would have
// noticed until a Type-B worker at a new gate could not punch in.
function isFinancePriv() { return canEditDept('Finance'); }
// Client mirror of firestore.rules' isOpsAdmin() — the company-OVERSIGHT tier
// (president/manager/secretary/finance), as distinct from the MONEY tier
// (isMoneyPriv, president/manager/finance). Use this for HR / attendance /
// leave / holiday / work-site admin controls, i.e. anything whose boundary rule
// is isOpsAdmin(). ('owner' is a legacy alias for president, matching the role
// lists in hr.js; it is not in window.ROLES.)
function isOpsPriv() {
  return ['president','owner','manager','secretary','finance'].includes(window.currentRole || '');
}
window.isOpsPriv = isOpsPriv;
// Client mirror of firestore.rules' isAdmin() — president/manager/secretary.
// DELIBERATELY EXCLUDES 'finance': isOpsPriv() (above) mirrors isOpsAdmin() and
// DOES include finance, and conflating the two shipped a dead control — the
// Attendance page offered a finance user Approve/Deny on time-extension
// requests whose rule (attendance_extensions update = isAdmin()) refuses them,
// and the handler had no error branch, so the tap looked like it worked.
// Use this for approve/deny verbs whose boundary rule is isAdmin(); use
// isOpsPriv() for viewing/editing attendance records themselves.
function isAdminPriv() {
  return ['president','owner','manager','secretary'].includes(window.currentRole || '');
}
window.isAdminPriv = isAdminPriv;
window.canEditDept = canEditDept;
window.isFinancePriv = isFinancePriv;
// v14 re-audit fix — MONEY-tier privilege: the client-side mirror of
// firestore.rules' isMoneyAdmin() (president/manager/finance). Deliberately
// NARROWER than isFinancePriv() above, which returns true for 'secretary' and
// for any Finance-DEPARTMENT member of any role, neither of which the rules
// let write pay. Use this — not isFinancePriv — for controls that write
// worker pay: worker_profiles rates/allowances/CA balance, worker_directory,
// and payslip issuance. isFinancePriv is left alone on purpose: it has ~13
// call sites across bir.js/finance.js/production.js/ui-crud-table.js and
// narrowing it globally would strip secretary from unrelated oversight
// screens they are meant to keep. ('owner' is a legacy alias for president
// used by the existing role lists in hr.js; it is not in window.ROLES.)
function isMoneyPriv() {
  return ['president','owner','manager','finance'].includes(window.currentRole || '');
}
window.isMoneyPriv = isMoneyPriv;

// Wrap a click handler so Firestore/JS errors surface as a toast + console.error
// instead of failing silently (the button just looks like it "did nothing").
function onClickSafe(btn, fn) {
  btn.addEventListener('click', async () => {
    try { await fn(); }
    catch (e) {
      console.error('[action failed]', e);
      Notifs.showToast(`Action failed: ${e.message||e}`, 'error');
    }
  });
}

// Best-effort notification send — never throw. A failed push/notification must
// not make an already-successful approve/deny/delete look like it failed.
async function safeNotify(fn) {
  try { await fn(); }
  catch (e) { console.warn('[notification failed, action itself still succeeded]', e); }
}

// ════════════════════════════════════════════════════════════════
//  PROJECTS — unified read layer over the two physical collections
//  `job_projects` (Sales/Production lifecycle) and `projects` (Design board)
//  stay SEPARATE on disk (different security models + schemas), but views that
//  need "all projects" read them through one normalized shape here. Writes still
//  go through each collection's own functions. No destructive migration.
// ════════════════════════════════════════════════════════════════
window.Projects = (function() {
  function sumPayments(d) { return (d.payments || []).reduce((s, x) => s + (Number(x.amount) || 0), 0); }
  // Canonical shape: {id, kind, no, name, clientName, contractAmount, collected,
  // arBalance, stage, payments, invoices, jobProjectId, partnerUid, createdAt, raw}
  function normalize(doc, kind) {
    const d = doc.data ? doc.data() : doc;
    const id = doc.id || d.id;
    const contract  = Number(d.contractAmount) || 0;
    const collected = (kind === 'job' && d.amountCollected != null) ? Number(d.amountCollected) : sumPayments(d);
    const arBalance = (kind === 'job' && d.arBalance != null) ? Number(d.arBalance) : Math.max(0, contract - collected);
    return {
      id, kind,
      no:        kind === 'job' ? (d.projectNo || '') : (d.no || ''),
      name:      d.name || d.clientName || '(untitled)',
      clientName: d.clientName || d.client || '',
      contractAmount: contract, collected, arBalance,
      stage:     kind === 'job' ? (d.stage || '') : (d.status || ''),
      payments:  d.payments || [], invoices: d.invoices || [],
      jobProjectId: d.jobProjectId || null,
      partnerUid: d.partnerUid || null,
      createdAt: d.createdAt || null,
      raw: d
    };
  }
  // listAll(scope): scope.partner skips the internal Design board; scope.partnerUid
  // filters job projects to that partner (mirrors the job_projects rule).
  async function listAll(scope) {
    scope = scope || {};
    const fetch = async () => {
      const jobSnap = await db.collection('job_projects').get().catch(() => ({ docs: [] }));
      const desSnap = scope.partner ? { docs: [] } : await db.collection('projects').get().catch(() => ({ docs: [] }));
      let jobs = jobSnap.docs.map(d => normalize(d, 'job'));
      if (scope.partnerUid) jobs = jobs.filter(j => j.partnerUid === scope.partnerUid);
      const designs = desSnap.docs.map(d => normalize(d, 'design'));
      return [...jobs, ...designs];
    };
    // Only the internal full list is cached (key invalidated on any project write);
    // partner-scoped reads bypass the cache to avoid leaking across scopes.
    if (scope.partner || scope.partnerUid) return fetch();
    return (typeof dbCachedGet === 'function') ? dbCachedGet('projects-unified', fetch, 30000) : fetch();
  }
  return { normalize, listAll, sumPayments };
})();

// backfillProjectKind + runProjectKindBackfill moved to js/migrations.js (v13 Phase 37)

// ════════════════════════════════════════════════════════════════
//  DESIGN — project/client folders (v12 WS35, WS38 Files Hub contract)
//  Deterministic hub_folders ids ⇒ idempotent "ensure" + cross-dept
//  discoverable from the Sales side (client__{clientId}). Get-then-create:
//  a blind set(..,{merge:true}) on an existing folder is an UPDATE, which
//  hub_folders' rule only grants to creator/admin — so any Design member
//  can safely "ensure" a folder exists without owning it.
// ════════════════════════════════════════════════════════════════
window.DesignFolders = {
  _who(){ return (window.userProfile && userProfile.displayName) || (currentUser && currentUser.email) || ''; },
  async _ensure(id, data){
    const ref = db.collection('hub_folders').doc(id);
    const snap = await ref.get().catch(()=>({exists:false}));
    if (!snap.exists) {
      await ref.set({ ...data, createdBy: currentUser.uid, createdByName: this._who(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    } else if (data.name && snap.data().name !== data.name) {
      // best-effort rename sync (creator/admin only per rules) — never block on it
      await ref.update({ name: data.name }).catch(()=>{});
    }
    return id;
  },
  ensureClientFolder(clientId, clientName){
    return this._ensure(`client__${clientId}`,
      { name: clientName || 'Client', parentId: null, scope:'projects', department:'Design', clientId, folderType:'project' });
  },
  async ensureProjectFolder(p, opts){
    opts = opts || {};
    const parentId = p.clientId
      ? await this.ensureClientFolder(p.clientId, p.client || 'Client') : null;
    return this._ensure(`proj__${p.id}`,
      { name: p.name || 'Project', parentId, scope:'projects', department:'Design',
        projectId: p.id, clientId: p.clientId || null,
        folderType: opts.folderType || 'project', salesOrderId: opts.salesOrderId || null });
  }
};

// remapDesignProjectClients moved to js/migrations.js (v13 Phase 37)

// ════════════════════════════════════════════════════════════════
//  UNIFIED CLIENT BOOK (v12 WS32) — one `clients` collection, one clientId.
//  Legacy sales_clients/design_clients/bs_clients are read-only archives once
//  migrateClientBooks() has run; until then listAll() falls back to them
//  (read-only compat view) so nothing goes blank between deploy and migration.
// ════════════════════════════════════════════════════════════════
window.Clients = (function () {
  const nameKey = s => window.clientNameKey(s);
  const brandOf = ui => ui === 'design' ? 'design' : ui === 'brilliant-steel' ? 'bs' : 'sales';
  const deptOf  = ui => ui === 'design' ? 'Design' : ui === 'brilliant-steel' ? 'Brilliant Steel' : 'Sales';
  function normalize(doc, legacyBrand) {
    const d = doc.data ? doc.data() : doc;
    return { id: doc.id || d.id, ...d,
      nameKey: d.nameKey || nameKey(d.name),
      brands: (Array.isArray(d.brands) && d.brands.length) ? d.brands : [legacyBrand || 'sales'],
      _legacy: !!legacyBrand };
  }
  // Cached (WS16 canonical key 'clients', 60s). opts.brand filters to one book.
  async function listAll(opts) {
    opts = opts || {};
    const fetch = async () => {
      const snap = await db.collection('clients').orderBy('createdAt', 'desc').get().catch(() => ({ docs: [] }));
      if (snap.docs.length) return snap.docs.map(d => normalize(d));
      // pre-migration compat: merge the three legacy books, read-only
      const [sc, dc, bc] = await Promise.all([
        db.collection('sales_clients').get().catch(() => ({ docs: [] })),
        db.collection('design_clients').get().catch(() => ({ docs: [] })),
        db.collection('bs_clients').get().catch(() => ({ docs: [] })),
      ]);
      return [...sc.docs.map(d => normalize(d, 'sales')), ...dc.docs.map(d => normalize(d, 'design')),
              ...bc.docs.map(d => normalize(d, 'bs'))]
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    };
    const all = (typeof dbCachedGet === 'function') ? await dbCachedGet('clients', fetch, 60000) : await fetch();
    return opts.brand ? all.filter(c => c.brands.includes(opts.brand)) : all;
  }
  async function findByName(name) {
    const key = nameKey(name); if (!key) return null;
    const snap = await db.collection('clients').where('nameKey', '==', key).limit(1).get().catch(() => ({ empty: true, docs: [] }));
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
  // Quote-filed upsert (replaces app.js:8196-8209's whole-collection scan with an
  // indexed nameKey query). Never touches stage/followUpDate on existing docs.
  // Returns the clientId (the FK the bridge stamps onto the quote) or null.
  async function upsertFromQuote(q) {
    // A builder-picked clientId is authoritative — update that doc directly and
    // skip the nameKey lookup (closes the typo-duplicate path, v12 WS31 Spec 2).
    if (q.clientId) {
      try {
        await db.collection('clients').doc(q.clientId).set({
          lastQuoteNumber: q.quoteNumber || '', lastQuoteTotal: q.total || 0,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
        if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('clients');
        return q.clientId;
      } catch (_) { /* fall through to nameKey path */ }
    }
    const name = (q.clientName || '').trim(); if (!name) return null;
    // 'sales' = the internal client book (Barro Kitchens AND Barro Industries,
    // whose general-fabrication quotes file alongside BK); 'bs' = the partner
    // book. Keyed off the shared registry so a new internal identity lands in
    // the right book automatically.
    const key = nameKey(name), brand = window.isInternalQuoteCompany(q.company || 'BK') ? 'sales' : 'bs';
    try {
      const FV = firebase.firestore.FieldValue;
      const snap = await db.collection('clients').where('nameKey', '==', key).limit(1).get();
      const cdata = { name, nameKey: key, brands: FV.arrayUnion(brand),
        company: q.clientCompany || '', phone: q.clientPhone || '', email: q.clientEmail || '',
        address: q.clientAddress || '', lastQuoteNumber: q.quoteNumber || '', lastQuoteTotal: q.total || 0,
        updatedAt: FV.serverTimestamp() };
      let id;
      if (!snap.empty) { id = snap.docs[0].id; await db.collection('clients').doc(id).set(cdata, { merge: true }); }
      else {
        cdata.stage = 'lead'; cdata.followUpDate = ''; cdata.contactLog = [];
        cdata.createdAt = FV.serverTimestamp(); cdata.createdBy = (auth.currentUser ? auth.currentUser.uid : null);
        const ref = await db.collection('clients').add(cdata); id = ref.id;
      }
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('clients');
      return id;
    } catch (_) { return null; }
  }
  // THE canonical client↔quote join (decision 3): clientId first, nameKey fallback.
  function quotesFor(client, quoteDocs) {
    const key = client.nameKey || nameKey(client.name);
    return quoteDocs.filter(q => (q.clientId && q.clientId === client.id) || nameKey(q.clientName) === key);
  }
  // One per-client view-model from CACHED fetchers only (WS16 — no fresh heavy reads).
  // Returns { quotes, orders, projects, payments, events } — events newest-first.
  async function timelineFor(client) {
    const toMs = v => !v ? 0 : (typeof v === 'string' ? (Date.parse(v) || 0)
      : v.seconds ? v.seconds * 1000 : (v.toDate ? v.toDate().getTime() : 0));
    const [qSnap, projects, soSnap, hubFiles] = await Promise.all([
      (typeof getAllQuotes === 'function' ? getAllQuotes() : Promise.resolve({ docs: [] })),
      window.Projects.listAll().catch(() => []),
      (typeof dbCachedGet === 'function'
        ? dbCachedGet('sales_orders', () => db.collection('sales_orders').get().catch(() => ({ docs: [] })), 60000)
        : db.collection('sales_orders').get().catch(() => ({ docs: [] }))),
      (window.FilesHub ? window.FilesHub.loadFiles('projects').catch(() => []) : Promise.resolve([]))
    ]);
    const key = client.nameKey || nameKey(client.name);
    // _coll = which collection the quote lives in (drives Reopen; survives WS31's
    // stranded-collection bug because we join by client, not by collection).
    const quotes = qSnap.docs
      .map(d => ({ id: d.id, _coll: (d.ref && d.ref.parent) ? d.ref.parent.id : 'bk_quotes', ...d.data() }))
      .filter(q => (q.clientId && q.clientId === client.id) || nameKey(q.clientName) === key)
      .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
    const orders = soSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(o => (o.clientId && o.clientId === client.id) || nameKey(o.clientName) === key);
    const projs = projects.filter(p => (p.raw && p.raw.clientId && p.raw.clientId === client.id) || nameKey(p.clientName) === key);
    const events = [];
    if (client.createdAt) events.push({ ts: toMs(client.createdAt), icon: '➕', text: 'Client added' });
    (client.contactLog || []).forEach(c0 => events.push({ ts: toMs(c0.date), icon: '📞',
      text: `Contact logged${c0.note ? ' — ' + c0.note : ''}${c0.by ? ' · ' + c0.by : ''}` }));
    quotes.forEach(q => events.push({ ts: toMs(q.createdAt), icon: '📄',
      text: `Quote ${q.quoteNumber || q.id.slice(-8)} · ₱${fmt(q.total || q.grandTotal || 0)} · ${q.status || q.approvalStatus || 'draft'}` }));
    orders.forEach(o => events.push({ ts: toMs(o.createdAt), icon: '🧾',
      text: `Sales Order ${o.quoteNumber || o.id.slice(-8)} · ₱${fmt(o.contractAmount || 0)}${o.paymentReceived ? ` (₱${fmt(o.paymentReceived)} received)` : ''}` }));
    projs.forEach(p => {
      ((p.raw && p.raw.timeline) || []).forEach(t => events.push({ ts: toMs(t.at), icon: '🏭', text: `${p.no ? p.no + ' · ' : ''}${t.event}` }));
      (p.payments || []).forEach(pm => events.push({ ts: toMs(pm.date), icon: '💰',
        text: `Payment ₱${fmt(pm.amount || 0)} (${pm.method || '—'}${pm.orRef ? ' · OR ' + pm.orRef : ''})` }));
      ((p.raw && p.raw.documents) || []).forEach(dc => events.push({ ts: toMs(dc.at), icon: '📎', text: `${dc.type}${dc.ref ? ' · ' + dc.ref : ''}` }));
    });
    if (client.followUpDate) events.push({ ts: toMs(client.followUpDate), icon: '⏰', text: `Follow-up scheduled ${client.followUpDate}` });
    events.sort((a, b) => b.ts - a.ts);
    const payments = projs.flatMap(p => (p.payments || []).map(pm => ({ ...pm, projectNo: p.no })));
    // v12 WS35: project/client files joined from the Files Hub (scope 'projects').
    const files = hubFiles.filter(f => f.clientId === client.id);
    return { quotes, orders, projects: projs, payments, events: events.slice(0, 80), files };
  }
  return { nameKey, brandOf, deptOf, normalize, listAll, findByName, upsertFromQuote, quotesFor, timelineFor };
})();

// migrateClientBooks moved to js/migrations.js (v13 Phase 37)

// ════════════════════════════════════════════════════════════════
//  FINANCE — edit anything, delete only with President approval
//  Finance staff may edit every finance record. Deletes are gated:
//  the President deletes immediately; everyone else files a request the
//  President approves in the Approvals tab. The same rule is enforced in
//  firestore.rules (delete → president only), so the gate can't be bypassed
//  from the client. All finance delete buttons route through financeDelete().
// ════════════════════════════════════════════════════════════════

// Resolve a ledger row by refNumber — READ-ONLY (v14 fix: previously this
// helper both looked up AND deleted the row in one step, called once per
// ref from inside financeDeleteCascade; see that function's header for why
// it's now split). Returns {ref, data} or null if not found.
async function _findLedgerRowByRef(ref) {
  const ls = await db.collection('ledger').where('refNumber','==',ref).limit(1).get().catch(()=>({docs:[]}));
  return ls.docs.length ? { ref: ls.docs[0].ref, data: ls.docs[0].data() } : null;
}

// ─────────────────────────────────────────────────────────────────────────
// v14 REGRESSION FIX — the four ledger-poster functions below were deleted by
// commit de4f5bd ('dead-code deletion') but are still called live via afterSave/
// onSaved callbacks (js/screens/finance.js, production.js, migrations.js), so
// every Cash Receipt / Cash Disbursement / Expense / production purchase saved
// to its source collection but threw ReferenceError before reaching the Ledger
// (the single source of truth) — income/expenses/VAT silently understated.
// Restored verbatim from a566391 (they route through window.Ledger). Caught by
// the 30-agent beta sweep, 2026-08-04.
// ─────────────────────────────────────────────────────────────────────────
async function postExpenseToLedger(expId, e, acct) {
  // M10 fix — a zero/NaN amount must never post a ₱0 EXP- entry; abort with a
  // clear error instead (callers already surface it: the approve-expense click
  // handler's try/catch toasts it, migrations.js's backfill catches it silently).
  const amount = Number(e.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Expense amount must be greater than ₱0 — refusing to post a ₱0/invalid EXP- entry.');
  }
  const ref = `EXP-${expId}`;
  const date = e.date || today();
  const category = e.category || 'General Expense';
  const result = await window.Ledger.post({
    ref, date, kind: 'debit',
    accountType: 'expense', account: category, category,
    description: `Expense — ${e.description||''}${e.submittedByName?` (${e.submittedByName})`:''}`,
    amount,
    source: 'Expense',
    // v12 WS39 — reclaimable input VAT (Add-Expense flow); legacy expenses with
    // no inputVat field fall back to 0, matching today's behavior exactly.
    extra: { inputVat: e.inputVat || 0, ...window.BankAccounts.tag(acct, 'out') }
  });
  if (!result.existed) { if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('expenses'); return true; }
  return false;
}

// New income from a cash receipt = Sales Revenue + Sundry income. AR collections
// are EXCLUDED — that money was already booked as income when the sale was recorded.
function crjLedgerIncome(e) { return (e.creditSalesRevenue||0) + (e.creditSundryAmount||0); }
// v12 WS36 — also mints the A/R-collection leg (asset credit, non-P&L; real cash that
// previously posted NO ledger row at all, invisible to cash position) when e.creditAR>0.
// The CRJ doc's own bankAccountId/bankAccountName (set at entry time) tags both legs.
async function postCRJToLedger(crjId, e) {
  const date = e.date || today();
  const income = crjLedgerIncome(e);
  const ar = e.creditAR || 0;
  if (income <= 0 && ar <= 0) return false;
  const tag = e.bankAccountId ? { bankAccountId: e.bankAccountId, bankAccountName: e.bankAccountName || null, bankFlow: 'in' } : {};
  const entries = [];
  if (income > 0) {                                       // new income — unchanged logic, now tagged
    const category = (e.creditSalesRevenue||0) >= (e.creditSundryAmount||0) ? 'Sales Revenue' : (e.creditSundryAcct||'Other Income');
    entries.push({ ref:`CRJ-${crjId}`, date, kind:'credit', accountType:'income', account:category, category,
      description:`Cash receipt — ${e.customer||''}${e.reference?` (${e.reference})`:''}`,
      amount:income, source:'Cash Receipt', extra: { ...tag } });
  }
  if (ar > 0) {                                           // v12 WS36 — A/R-collection leg (asset credit, non-P&L)
    entries.push({ ref:`CRJ-${crjId}-AR`, date, kind:'credit', accountType:'asset', account:'Accounts Receivable', category:'A/R Collection',
      description:`A/R collection — ${e.customer||''}${e.reference?` (${e.reference})`:''}`,
      amount:ar, source:'Cash Receipt', extra: { ...tag } });
  }
  const { existedAll } = await window.Ledger.postMulti(entries);
  return !existedAll;
}

// New expense from a disbursement = Material + Labor + Sundry. A/P settlements are
// EXCLUDED — that cost was already expensed when the payable was incurred.
// debitAccount (v12 WS13): 'inventory' (stock materials — posts as an ASSET, not
// an expense, until Production consumes it) vs 'material'/'sundry' (still direct
// expense, e.g. a purchase that never touches stock). This is the fix for the
// double-material-expensing bug — see consumeProductionMaterials for the other half.
function cdjLedgerExpense(e) { return (e.debitMaterial||0) + (e.debitLabor||0) + (e.debitSundryAmount||0); }
// v12 WS36 — also mints the A/P-settlement leg (liability debit, non-P&L; real cash
// that previously posted NO ledger row at all, invisible to cash position) when
// e.debitAP>0. The CDJ doc's own bankAccountId/bankAccountName tags both legs.
async function postCDJToLedger(cdjId, e) {
  const date = e.date || today();
  const expense = cdjLedgerExpense(e);
  if (expense <= 0 && !(e.debitAP > 0)) return false;
  const tag = e.bankAccountId ? { bankAccountId: e.bankAccountId, bankAccountName: e.bankAccountName || null, bankFlow: 'out' } : {};
  const entries = [];
  if (expense > 0) {
    let category;
    const mat = e.debitMaterial||0, lab = e.debitLabor||0, sun = e.debitSundryAmount||0;
    if (mat >= lab && mat >= sun) category = 'COS – Direct Material';
    else if (lab >= sun) category = 'COS – Direct Labor';
    else category = e.debitSundryAcct || 'Other Expense';
    const isInventory = e.debitAccount === 'inventory';
    const accountType = isInventory ? 'asset' : 'expense';
    const account = isInventory ? 'Inventory' : category;
    if (isInventory) category = 'Inventory – Materials';
    entries.push({ ref:`CDJ-${cdjId}`, date, kind:'debit', accountType, account, category,
      description: `Disbursement — ${e.payee||''}${e.reference?` (${e.reference})`:''}`,
      amount: expense, source: 'Cash Disbursement',
      // input VAT (reclaimable) carried through for the Net VAT Payable computation
      extra: { inputVat: e.vatAmount || 0, ...tag } });
  }
  if (e.debitAP > 0) {                                    // v12 WS36 — A/P-settlement leg (liability debit, non-P&L)
    entries.push({ ref:`CDJ-${cdjId}-AP`, date, kind:'debit', accountType:'liability', account:'Accounts Payable', category:'A/P Settlement',
      description:`A/P settlement — ${e.payee||''}${e.reference?` (${e.reference})`:''}`,
      amount:e.debitAP, source:'Cash Disbursement', extra: { ...tag } });
  }
  const { existedAll } = await window.Ledger.postMulti(entries);
  return !existedAll;
}

// v14 re-audit ROUND 2 — a FAILED ledger mirror is a books-integrity event, not
// a debug detail. resyncLedgerForSource's catch used to be a bare
// console.warn(), and its callers chain `.then(redo)` with no `.catch()`, so
// when the source doc saved but its mirrored ledger row did not, the user was
// told "Updated." and nothing else — /expenses and /ledger then disagreed
// permanently, with the P&L and VAT reading the ledger. (That is the shape the
// round-1 /ledger period gate accidentally created via the ungated /expenses
// door; the gate now lives on /expenses too, so the case should not arise —
// this makes it impossible for it to arise SILENTLY if a future source
// collection is mirrored without its own gate.)
window.ledgerMirrorFailed = function(err, collection, docId) {
  const msg = (err && (err.message || err.code)) || String(err);
  console.error('[ledger mirror] ' + collection + '/' + docId + ' failed to sync: ' + msg, err);
  if (window.Notifs && Notifs.showToast) {
    Notifs.showToast('Saved — but the ledger copy of this record did NOT update (' + msg +
      '). The books and this record now disagree; tell Finance before relying on any report.', 'error');
  }
};

// Re-sync the mirrored ledger row after a source doc (expense / CRJ / CDJ) is
// EDITED, so the ledger never drifts from the journal. Updates the amount/type/
// category in place, creates the row if it should now exist, or deletes it if the
// entry no longer qualifies (e.g. expense un-approved, or income/expense → 0).
async function resyncLedgerForSource(collection, docId) {
  try {
    const snap = await db.collection(collection).doc(docId).get();
    if (!snap.exists) return;
    const e = snap.data();
    let ref, type, amount, category, description, inputVat = null, accountType, account;
    if (collection === 'expenses') {
      ref = `EXP-${docId}`;
      if (e.status !== 'approved') { await _deleteLedgerByRef(ref); return; }
      type = 'debit'; amount = e.amount || 0; category = e.category || 'General Expense';
      description = `Expense — ${e.description || ''}${e.submittedByName ? ` (${e.submittedByName})` : ''}`;
      accountType = 'expense'; account = category;
      // v12 WS39 — carry input VAT through on an EDITED expense too (previously
      // left null here, so an edit never patched/gained inputVat on the mirrored
      // ledger row). `patch.inputVat` below picks this up automatically.
      inputVat = e.inputVat || 0;
    } else if (collection === 'cash_receipt_journal') {
      ref = `CRJ-${docId}`; type = 'credit'; amount = crjLedgerIncome(e);
      category = (e.creditSalesRevenue || 0) >= (e.creditSundryAmount || 0) ? 'Sales Revenue' : (e.creditSundryAcct || 'Other Income');
      description = `Cash receipt — ${e.customer || ''}${e.reference ? ` (${e.reference})` : ''}`;
      accountType = 'income'; account = category;
    } else if (collection === 'cash_disbursement_journal') {
      ref = `CDJ-${docId}`; type = 'debit'; amount = cdjLedgerExpense(e);
      const mat = e.debitMaterial || 0, lab = e.debitLabor || 0, sun = e.debitSundryAmount || 0;
      category = (mat >= lab && mat >= sun) ? 'COS – Direct Material' : (lab >= sun ? 'COS – Direct Labor' : (e.debitSundryAcct || 'Other Expense'));
      description = `Disbursement — ${e.payee || ''}${e.reference ? ` (${e.reference})` : ''}`;
      inputVat = e.vatAmount || 0;
      // Carries the debitAccount choice through on edit (v12 WS13) — an edited
      // disbursement must keep its asset/Inventory tag, not silently drift back
      // to expense-tagged.
      const isInventory = e.debitAccount === 'inventory';
      accountType = isInventory ? 'asset' : 'expense';
      account = isInventory ? 'Inventory' : category;
      if (isInventory) category = 'Inventory – Materials';
    } else return;
    // v12 WS36: a CRJ/CDJ main row can legitimately be zero (a pure A/R-collection
    // or A/P-settlement entry) — that must still fall through to the leg sync below,
    // not early-return past it, or an edit would silently stop keeping the -AR/-AP
    // leg in step with the source doc.
    if (amount > 0) {
      const src = (collection === 'expenses') ? 'Expense' : (collection === 'cash_receipt_journal') ? 'Cash Receipt' : 'Cash Disbursement';
      await window.Ledger.upsertByRef(ref, () => {
        const built = { ref, date: e.date || today(), kind: type, accountType, account, category, description, amount, source: src, extra: {} };
        if (inputVat != null) built.extra.inputVat = inputVat;
        if (e.bankAccountId) { built.extra.bankAccountId = e.bankAccountId; built.extra.bankAccountName = e.bankAccountName || null;
          built.extra.bankFlow = (collection === 'cash_receipt_journal') ? 'in' : 'out'; }
        return built;
      });
    } else {
      await _deleteLedgerByRef(ref);
    }
    // v12 WS36 — keep the A/R-/A/P-settlement legs in step with the source doc.
    if (collection === 'cash_receipt_journal') {
      const arTag = e.bankAccountId ? { bankAccountId: e.bankAccountId, bankAccountName: e.bankAccountName || null, bankFlow: 'in' } : {};
      await _syncLedgerLegViaUpsert(`CRJ-${docId}-AR`, e.creditAR || 0, () => ({
        ref: `CRJ-${docId}-AR`, date: e.date || today(), kind: 'credit', accountType: 'asset', account: 'Accounts Receivable',
        category: 'A/R Collection', description: `A/R collection — ${e.customer || ''}${e.reference ? ` (${e.reference})` : ''}`,
        amount: e.creditAR || 0, source: 'Cash Receipt', extra: { ...arTag }
      }));
    }
    if (collection === 'cash_disbursement_journal') {
      const apTag = e.bankAccountId ? { bankAccountId: e.bankAccountId, bankAccountName: e.bankAccountName || null, bankFlow: 'out' } : {};
      await _syncLedgerLegViaUpsert(`CDJ-${docId}-AP`, e.debitAP || 0, () => ({
        ref: `CDJ-${docId}-AP`, date: e.date || today(), kind: 'debit', accountType: 'liability', account: 'Accounts Payable',
        category: 'A/P Settlement', description: `A/P settlement — ${e.payee || ''}${e.reference ? ` (${e.reference})` : ''}`,
        amount: e.debitAP || 0, source: 'Cash Disbursement', extra: { ...apTag }
      }));
    }
  } catch (err) { window.ledgerMirrorFailed(err, collection, docId); }
}

// Cascade cleanup that must accompany the ACTUAL delete of certain finance
// docs (their linked ledger entries / CA balances). Runs in the deleter's
// context — always the President — so these ledger writes are permitted.
//
// v14 fix (money-critical): this function used to COMMIT its own writes
// (each ledger-row delete + each cash_advances.balance restore landed
// immediately, individually, many of them wrapped in a swallowing
// `.catch(()=>{})`), and financeExecuteDelete then deleted the SOURCE doc as
// a SEPARATE, LATER write. A crash/throw between the two left the cascade
// fully applied (ledger rows gone, CA balances restored) but the source doc
// still present — and a retry of the same delete would re-run this whole
// function a SECOND time, double-crediting every cash_advances.balance via
// increment(). Fixed by making this function a pure BUILDER: it only READS
// (to resolve which ledger rows/CA docs are involved) and stages every
// write onto the ONE `batch` the caller passes in — nothing commits here.
// financeExecuteDelete commits that batch together with the source-doc
// delete, so the whole cascade + the delete now succeed or fail as a single
// atomic unit; a retry after a failure is a true no-op (nothing was written
// the first time). Returns the pre-delete ledger row data so the caller can
// sync finance_rollup AFTER the batch commits — best-effort, never inside
// the atomic write itself (matches finance-ledger.js's documented
// CONSTRAINT: a rollup write must never gate/rollback a money write).
async function financeDeleteCascade(collection, docId, batch) {
  let d = null;
  try { const s = await db.collection(collection).doc(docId).get(); d = s.exists ? s.data() : null; } catch(_) {}
  if (!d) return [];
  const staleLedgerRows = []; // pre-delete row data, for post-commit rollup sync

  const stageLedgerDelete = async (ref) => {
    const found = await _findLedgerRowByRef(ref);
    if (!found) return;
    batch.delete(found.ref);
    staleLedgerRows.push(found.data);
  };

  if (collection === 'salary_history') {
    const ref = `PAY-${d.month}-${d.userId||''}`;
    await stageLedgerDelete(ref);
    // v12 WS20/21: the employer-share debit leg this employee's line posted
    // (gross-with-liability-legs booking). NOTE: the aggregate SSSPAY-/PHPAY-/
    // HDMFPAY-/WHTPAY-/NETPAY-{month} credit legs (shared across the WHOLE
    // run, not per-employee) are NOT adjusted here — they'd need re-deriving
    // from every other still-standing line for that month. Known gap, left
    // for whoever builds WS39 (BIR/remittance reports, the eventual owner of
    // these legs) since a wrong partial fix is worse than an honest one.
    await stageLedgerDelete(ref+'-ER');
    // Restore any cash-advance balances this payroll run deducted, so deleting the
    // run doesn't leave an employee's loan wrongly marked paid.
    if (Array.isArray(d.caDeductions)) {
      for (const cd of d.caDeductions) {
        if (cd && cd.caId && cd.amount > 0) {
          // v12 WS22 fix: every reader filters status==='approved' for an
          // outstanding balance — 'active' was never a recognized status and
          // made a reversed CA invisible to Compute's balance aggregation.
          batch.update(db.collection('cash_advances').doc(cd.caId), {
            balance: firebase.firestore.FieldValue.increment(cd.amount),
            status: 'approved', paidAt: firebase.firestore.FieldValue.delete()
          });
        }
      }
    }
  } else if (collection === 'payslips') {
    const ca = d.deductions?.other?.cashAdvance || 0;
    if (ca > 0 && d.workerId) batch.update(db.collection('worker_profiles').doc(d.workerId), { caBalance: firebase.firestore.FieldValue.increment(ca) });
    await stageLedgerDelete(`WPAY-${docId}`);
  } else if (collection === 'cash_receipt_journal' || collection === 'cash_disbursement_journal' || collection === 'expenses') {
    // Remove the mirrored ledger row(s) (CRJ-/CDJ-/EXP-<id>, plus the v12 WS36
    // A/R-/A/P-settlement legs CRJ-/CDJ-<id>-AR/-AP) so deleting the source
    // entry doesn't leave the books overstated.
    const prefix = collection === 'cash_receipt_journal' ? 'CRJ' : collection === 'cash_disbursement_journal' ? 'CDJ' : 'EXP';
    const refs = [`${prefix}-${docId}`, `${prefix}-${docId}-AR`, `${prefix}-${docId}-AP`];
    for (const r of refs) await stageLedgerDelete(r);
  } else if (collection === 'cash_advances') {
    // v12 WS36 — remove the mirrored cash-release ledger row (CA-<id>).
    await stageLedgerDelete(`CA-${docId}`);
  }
  return staleLedgerRows;
}

// Perform the real delete — cascade + source-doc delete as ONE atomic batch
// (see financeDeleteCascade's header for why this changed from two separate
// commits). Used by the President's direct delete AND by the Approvals
// screen when a request is approved.
window.financeExecuteDelete = async function(collection, docId) {
  const batch = db.batch();
  const staleLedgerRows = await financeDeleteCascade(collection, docId, batch);
  // v14 Wave 4 Batch F2 — a DIRECT delete of a ledger row itself (as opposed to
  // a cascade delete above, triggered by deleting the SOURCE doc) also needs
  // its finance_rollup contribution subtracted. Read before staging the
  // delete since the row is gone after commit.
  let _ledgerRowBeforeDelete = null;
  if (collection === 'ledger') {
    try { const s = await db.collection('ledger').doc(docId).get(); if (s.exists) _ledgerRowBeforeDelete = s.data(); } catch(_) {}
  }
  batch.delete(db.collection(collection).doc(docId));
  await batch.commit();
  if (typeof dbCacheInvalidate === 'function') {
    dbCacheInvalidate('ledger');
    // Pay-run deletes restore cash_advances balances above — cascade the CA
    // caches too (ca-approved-all + per-uid ca-mine-*, PERF-WAVE1).
    dbCacheInvalidate('ca-pending');
  }
  // finance_rollup deltas are best-effort, strictly AFTER the atomic delete
  // has committed — never gate the delete itself on a rollup write (matches
  // finance-ledger.js's CONSTRAINT note).
  for (const row of staleLedgerRows) {
    if (window.Ledger && typeof window.Ledger._syncRollup === 'function') await window.Ledger._syncRollup(row, -1);
  }
  if (_ledgerRowBeforeDelete && window.Ledger && typeof window.Ledger._syncRollup === 'function') {
    await window.Ledger._syncRollup(_ledgerRowBeforeDelete, -1);
  }
};

// President → delete now (with confirm). Anyone else → file a delete request for
// the President to approve. `label` is a human description of the record.
// Resolves to 'deleted' | 'requested' | 'cancelled'. onDone(outcome) optional.
window.financeDelete = async function(opts) {
  const { collection, docId, label } = opts;
  const onDone = opts.onDone || (()=>{});
  const u = window.currentUser || (typeof auth !== 'undefined' && auth.currentUser) || {};
  if (typeof isRealPresident === 'function' && isRealPresident()) {
    if (!(await confirmDialog({ message: `Delete ${escHtml(label)}? This cannot be undone.`, danger:true, html:true }))) return 'cancelled';
    try {
      await window.financeExecuteDelete(collection, docId);
      Notifs.success('Deleted.'); onDone('deleted'); return 'deleted';
    } catch(e) {
      Notifs.showToast('Delete failed: '+(e.message||e),'error'); return 'cancelled';
    }
  }
  return new Promise((resolve) => {
    openModal('Request Deletion — President Approval', `
      <p style="margin-bottom:12px;color:var(--text-muted);font-size:13px">Deleting <strong>${escHtml(label)}</strong> needs the President's approval. The record stays until it's approved.</p>
      <div class="form-group"><label>Reason for deletion</label><input id="fdr-reason" placeholder="e.g. Duplicate entry, wrong amount…"/></div>
    `, `<button class="btn-primary" id="fdr-submit">Submit for Approval</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    const submitBtn = document.getElementById('fdr-submit');
    submitBtn && submitBtn.addEventListener('click', async () => {
      const reason = (document.getElementById('fdr-reason').value||'').trim();
      if (!reason) { Notifs.showToast('Please enter a reason.','error'); return; }
      try {
        await db.collection('finance_delete_requests').add({
          collection, docId, label, reason,
          requestedBy:     u.uid || '',
          requestedByName: window.userProfile?.displayName || u.email || 'Finance',
          status:          'pending',
          createdAt:       firebase.firestore.FieldValue.serverTimestamp()
        });
        await safeNotify(() => Notifs.sendToOwner({
          title: '🗑 Finance Delete Request',
          body:  `${window.userProfile?.displayName || u.email || 'Finance'} requested deletion of ${label}. Reason: ${reason}`,
          icon: '🗑', type: 'finance_delete_request', link: 'approvals'
        }));
        closeModal();
        Notifs.success('Deletion request sent to the President for approval.');
        onDone('requested'); resolve('requested');
      } catch(e) {
        Notifs.showToast('Could not send request: '+(e.message||e),'error');
      }
    });
  });
};

// Delete a quote record WITH APPROVAL (never a silent hard delete). Three paths,
// each matched to what firestore.rules actually permits that actor:
//   president/manager/finance — financeDelete (President deletes now; the other
//     two file a finance_delete_requests row, whose create is canFinance()).
//   Corporate Secretary — canFinance() excludes them since the 2026-08-08
//     carve-out, so they flag the quote itself (deleteRequested), which
//     bk_quotes/bs_quotes update allows for isAdmin().
//   the quote's own CREATOR — same deleteRequested flag; they were never able
//     to write finance_delete_requests.
// The last two both land in Approvals → All Requests for the President.
// collection is one of window.QUOTE_COLLECTIONS ('bk_quotes' — which holds both
// Barro Kitchens and Barro Industries quotes — or 'bs_quotes').
window.requestQuoteDelete = async function(collection, docId, label, createdBy, onDone) {
  onDone = onDone || (()=>{});
  const role = window.currentRole || '';
  const u = window.currentUser || (typeof auth !== 'undefined' && auth.currentUser) || {};
  // DEAD CONTROL (fixed 2026-08-09). financeDelete's non-President branch writes
  // finance_delete_requests, whose create rule is canFinance() —
  // president/manager/finance only since the Corporate Secretary carve-out. So
  // routing 'secretary' here landed them on a modal whose Submit was refused,
  // with no way forward. Dropping them from this list lets them fall through to
  // the `deleteRequested` flag path below, which firestore.rules DOES allow for
  // isAdmin() (bk_quotes/bs_quotes update) and which the President actions in
  // Approvals → All Requests. Same outcome, a path that actually works.
  if (['president','manager','finance'].includes(role)) {
    return window.financeDelete({ collection, docId, label, onDone });
  }
  if (role === 'secretary') {
    const reason = ((await promptDialog({message:'Reason for deleting this quote? (sent to the President for approval)', required:true, multiline:true})) || '').trim();
    if (!reason) return;
    try {
      await db.collection(collection).doc(docId).update({
        deleteRequested: true, deleteReason: reason,
        deleteRequestedBy: u.uid, deleteRequestedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:' + collection + '-delete'); // PERF-WAVE1
      await safeNotify(() => Notifs.sendToOwner({
        title: '🗑 Quote Deletion Requested',
        body:  `${window.userProfile?.displayName || 'The Corporate Secretary'} requested deletion of ${label}. Reason: ${reason}`,
        icon: '🗑', type: 'delete_request', link: 'approvals'
      }));
      Notifs.success('Deletion request sent to the President for approval.');
      onDone('requested');
    } catch (e) {
      Notifs.showToast('Could not send request: '+(e.message||e),'error');
    }
    return 'requested';
  }
  if (createdBy && u.uid === createdBy) {
    const reason = ((await promptDialog({message:'Reason for deleting this quote? (sent to the President for approval)', required:true, multiline:true})) || '').trim();
    return db.collection(collection).doc(docId).update({
      deleteRequested: true, deleteReason: reason,
      deleteRequestedBy: u.uid, deleteRequestedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(async () => {
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:' + collection + '-delete'); // PERF-WAVE1
      await safeNotify(() => Notifs.sendToOwner({
        title: '🗑 Quote Delete Requested',
        body: `${(window.userProfile && window.userProfile.displayName) || u.email || 'A user'} requests deleting ${label}.${reason?' Reason: '+reason:''}`,
        icon: '🗑', type: 'quote_delete_request', link: 'approvals'
      }));
      Notifs.success('Delete request sent to the President.'); onDone('requested');
    }).catch(e => Notifs.showToast('Request failed: '+(e.message||e),'error'));
  }
  Notifs.showToast('You can only request deletion of your own quotes.', 'error');
  return Promise.resolve('denied');
};

// financeEditModal (generic finance-record edit modal) — moved verbatim to js/screens/finance.js (Wave 7 Pass 8, 2026-08-03).

// ── Task Status System — TASK_STATUSES/EMP_STATUSES/DONE_STATUSES/SCORE_STATUSES
// moved verbatim to js/screens/tasks.js (Wave 7 Pass 1, 2026-08-03). statusBadge/
// statusLabel below stay here (cross-domain: quotes, gov biddings, expenses, POs,
// attendance all read them too, not just tasks) but now read the status table via
// window.TASK_STATUSES since the TASK_STATUSES const itself moved with the rest
// of the Tasks status system.
function statusBadge(s) {
  const ts = (window.TASK_STATUSES||[]).find(x=>x.value===s);
  if (ts) return ts.badge;
  return {open:'badge-blue',done:'badge-green',pending:'badge-orange',draft:'badge-gray',sent:'badge-blue',accepted:'badge-green',reviewing:'badge-purple',rejected:'badge-red',approved:'badge-green'}[s]||'badge-gray';
}
function statusLabel(s) {
  const ts = (window.TASK_STATUSES||[]).find(x=>x.value===s);
  return ts?ts.label:({open:'Open',done:'Done',pending:'Pending'}[s]||s||'—');
}

// TASKS + SUBMISSIONS — normTask/fuTime/followUpCardInner/updateCardFollowUpBadge/
// assigneeChips/taskCard/notifyTaskInvolved/renderDeptTasks/renderTasks/
// loadPresidentTasks/loadTasksList/closeTaskPanel/openTaskDetail/
// recomputePresidentTaskScore/openEditTaskModal/openAddTaskModal/renderSubmissions/
// loadSubsList/openSubDetail/openAddSubModal — moved verbatim to
// js/screens/tasks.js (Wave 7 Pass 1, 2026-08-03). See that file's header for the
// load-order contract; renderApprovals below still calls several of these
// (normTask, notifyTaskInvolved, openTaskDetail, renderDeptTasks) as plain global
// identifiers at runtime, which resolves fine regardless of file — the same
// forward-reference pattern js/screens/design.js's header documents in reverse.

// window.renderCash/loadCashContent/expenseTable/bindExpenseActions/
// openAddExpenseModal ("Cash & Expenses" legacy screen) — DELETED, Wave 7
// Pass 10 cleanup (2026-08-03). Verified zero callers: `case 'cash'` in
// js/app.js's navigateTo switch (the only entry point) was removed in the
// same pass; grepped clean for navigateTo('cash')/page:'cash'/hashFor-cash
// across nav builders, seeds, and notification deep-links — nothing else
// reached it. js/screens/finance.js's header (Wave 7 Pass 8) already
// flagged this as dead when it moved the *actually reachable* Cash
// Receipt/Disbursement journals out of this file.

// ══════════════════════════════════════════════════
//  COMMENTS — Messenger-style UI with seen receipts
// ══════════════════════════════════════════════════
window.renderComments = async function(collection, docId, containerId, currentUser) {
  // liveEl: callers pass an id STRING for a container that lives INSIDE an
  // openPage panel (tasks.js 'task-comments-wrap' / 'sub-comments-wrap'), so
  // during the teardown window the comment thread rendered into the dying
  // panel and the visible task showed none. See window.liveEl (js/config.js).
  const container = (window.liveEl ? window.liveEl(containerId) : document.getElementById(containerId));
  if (!container) return;

  const isAdmin = currentRole === 'president' || currentRole === 'owner' || currentRole === 'manager' || currentRole === 'finance';
  const isImage = url => url && /\.(png|jpg|jpeg|gif|webp)(\?|$)/i.test(url);

  // Fetch comments + readers in parallel
  const [snap, readersSnap] = await Promise.all([
    db.collection(collection).doc(docId).collection('comments').orderBy('createdAt').get(),
    collection === 'tasks'
      ? db.collection(collection).doc(docId).collection('readers').get().catch(()=>({docs:[]}))
      : Promise.resolve({docs:[]})
  ]);
  const comments = snap.docs.map(d => ({id:d.id,...d.data()}));
  const readers  = readersSnap.docs.map(d=>({id:d.id,...d.data()}));

  // Mark current user as read (tasks only)
  if (collection === 'tasks') {
    const myName = userProfile?.displayName || currentUser.email;
    db.collection(collection).doc(docId).collection('readers').doc(currentUser.uid).set({
      uid: currentUser.uid, name: myName,
      readAt: firebase.firestore.FieldValue.serverTimestamp()
    }, {merge:true}).catch(()=>{});
  }

  // Build seen-by label per comment
  const getSeenBy = (comment) => {
    if (!comment.createdAt) return [];
    const commentMs = comment.createdAt.toMillis?.() || 0;
    return readers.filter(r => r.uid !== comment.authorId && (r.readAt?.toMillis?.() || 0) >= commentMs);
  };

  const initials = name => (name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
  const timeLabel = ts => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const now = new Date();
    const diffH = (now - d) / 3600000;
    if (diffH < 24) return d.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'});
    return d.toLocaleDateString('en-PH',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  };

  container.innerHTML = `
    <div class="messenger-wrap">
      <div class="messenger-header">
        <span style="font-weight:700">${emojiIcon('💬',16)} Messages</span>
        <span style="font-size:11px;color:var(--text-muted)">${comments.length} message${comments.length!==1?'s':''}</span>
      </div>
      <div class="messenger-body" id="msbody-${docId}">
        ${!comments.length ? `<div class="messenger-empty">No messages yet. Be the first to say something!</div>` :
          comments.map((c, idx) => {
            const isMine = c.authorId === currentUser.uid;
            const seenBy = getSeenBy(c);
            const isLast = idx === comments.length - 1;
            const canEdit   = c.authorId === currentUser.uid;
            const canDelete = canEdit || isAdmin;
            return `
            <div class="ms-row ${isMine?'ms-row-mine':'ms-row-theirs'}" data-cid="${c.id}">
              ${!isMine ? `<div class="ms-avatar" title="${escHtml(c.authorName||'User')}">${c.photoUrl?`<img src="${c.photoUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`:initials(c.authorName||'U')}</div>` : ''}
              <div class="ms-bubble-wrap">
                ${!isMine ? `<div class="ms-name">${escHtml(c.authorName||'User')}</div>` : ''}
                <div class="ms-bubble ${isMine?'ms-bubble-mine':'ms-bubble-theirs'} comment-bubble-tap" data-id="${c.id}">
                  ${c.text?`<div class="ms-text">${escHtml(c.text).replace(/\n/g,'<br/>')}</div>`:''}
                  ${c.fileUrl ? (c.fileSource!=='link' && isImage(c.fileUrl)
                    ? `<div style="margin-top:${c.text?'6':'0'}px"><img src="${safeHttpUrl(c.fileUrl)}" alt="${escHtml(c.fileName||'img')}" style="max-width:200px;max-height:160px;border-radius:var(--r-sm,10px);cursor:pointer" onclick="window.open('${safeHttpUrl(c.fileUrl)}','_blank')"/></div>`
                    : `<a href="${safeHttpUrl(c.fileUrl)}" target="_blank" rel="noopener" class="ms-file-chip">${emojiIcon(c.fileSource==='link'?'link':'paperclip',14)}<span>${escHtml(c.fileName||'Attachment')}</span></a>`
                  ) : ''}
                  <div class="ms-meta">
                    <span class="ms-time">${timeLabel(c.createdAt)}</span>
                    ${c.editedAt?'<span class="ms-edited">(edited)</span>':''}
                  </div>
                </div>
                ${canEdit||canDelete ? `<div class="ms-actions">
                  ${canEdit?`<button class="ms-act-btn comment-edit-btn" data-id="${c.id}" aria-label="Edit comment">${emojiIcon('✎',16)}</button>`:''}
                  ${canDelete?`<button class="ms-act-btn ms-del-btn comment-del-btn" data-id="${c.id}" aria-label="Delete comment">${emojiIcon('trash-2',14)}</button>`:''}
                </div>` : ''}
                ${isLast && seenBy.length ? `<div class="ms-seen">Seen by ${escHtml(seenBy.map(r=>r.name.split(' ')[0]).join(', '))}</div>` : ''}
              </div>
              ${isMine ? `<div class="ms-avatar ms-avatar-mine" title="You">${userProfile?.photoUrl?`<img src="${userProfile.photoUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>`:initials(userProfile?.displayName||currentUser.email)}</div>` : ''}
            </div>`;
          }).join('')}
      </div>
      <div id="ms-file-preview-${docId}" style="font-size:11px;color:var(--primary);padding:0 12px 4px;min-height:16px"></div>
      <div class="messenger-input-row">
        <label for="comment-file-${docId}" class="ms-attach-btn" title="Attach file">${emojiIcon('paperclip',18)}</label>
        <input type="file" id="comment-file-${docId}" style="display:none" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip"/>
        <button type="button" class="ms-attach-btn" id="comment-link-${docId}" title="Attach link">${emojiIcon('link',18)}</button>
        <textarea id="comment-in-${docId}" class="ms-input" rows="1" placeholder="Type a message…"></textarea>
        <button class="ms-send-btn" id="comment-send-${docId}" disabled>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        </button>
      </div>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  // Scroll to bottom
  const body = document.getElementById(`msbody-${docId}`);
  if (body) body.scrollTop = body.scrollHeight;

  // WS42 Phase 17 — tap a bubble to reveal its timestamp/status line (hidden by
  // default, hover reveals it on desktop via CSS `:hover`). Task chat has no
  // reaction picker, so this handler only toggles the one class.
  container.querySelectorAll('.comment-bubble-tap').forEach(b => {
    b.addEventListener('click', e => {
      if (e.target.closest('a') || e.target.closest('img')) return;
      b.classList.toggle('ms-time-shown');
    });
  });

  // WS42 Phase 19 — auto-grow the composer textarea up to the shared 5-line
  // cap (`.ms-input { max-height }` in styles.css does the actual clamping).
  const commentInput = document.getElementById(`comment-in-${docId}`);
  const commentSendBtn = document.getElementById(`comment-send-${docId}`);
  const autoGrowComment = () => { if (!commentInput) return; commentInput.style.height = 'auto'; commentInput.style.height = commentInput.scrollHeight + 'px'; };
  const updateCommentSendState = () => {
    if (!commentSendBtn) return;
    commentSendBtn.disabled = !((commentInput?.value || '').trim() || pendingLink || document.getElementById(`comment-file-${docId}`)?.files?.[0]);
  };

  // File attach preview
  let pendingLink = null;
  document.getElementById(`comment-file-${docId}`)?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) pendingLink = null;   // a file replaces a pending link
    const prev = document.getElementById(`ms-file-preview-${docId}`);
    if (prev) prev.textContent = f ? `📎 ${f.name}` : '';
    updateCommentSendState();
  });

  // Link attach
  document.getElementById(`comment-link-${docId}`)?.addEventListener('click', async () => {
    let url = ((await promptDialog({message:'Paste a link to attach:'})) || '').trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    pendingLink = url;
    const fileInp = document.getElementById(`comment-file-${docId}`);
    if (fileInp) fileInp.value = '';   // a link replaces a pending file
    const prev = document.getElementById(`ms-file-preview-${docId}`);
    if (prev) prev.textContent = `🔗 ${url}`;
    updateCommentSendState();
  });

  // Edit message
  container.querySelectorAll('.comment-edit-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cid = btn.dataset.id;
      const c   = comments.find(x=>x.id===cid);
      const newText = await promptDialog({message:'Edit message:', value:c?.text||'', multiline:true});
      if (newText === null || newText === (c?.text||'')) return;
      await db.collection(collection).doc(docId).collection('comments').doc(cid).update({
        text: newText.trim(), editedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      renderComments(collection, docId, containerId, currentUser);
    });
  });

  // Delete message
  container.querySelectorAll('.comment-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!(await confirmDialog({message:'Delete this message?', danger:true}))) return;
      await db.collection(collection).doc(docId).collection('comments').doc(btn.dataset.id).delete();
      renderComments(collection, docId, containerId, currentUser);
    });
  });

  const sendComment = async () => {
    const input   = document.getElementById(`comment-in-${docId}`);
    const fileInp = document.getElementById(`comment-file-${docId}`);
    const text    = input.value.trim();
    const file    = fileInp?.files?.[0];
    if (!text && !file && !pendingLink) return;

    const sendBtn = document.getElementById(`comment-send-${docId}`);
    if (sendBtn) { sendBtn.disabled = true; sendBtn.style.opacity = '.5'; }

    const myName = userProfile?.displayName || currentUser.email;

    let fileUrl = null, fileName = null, fileSource = null;
    if (file) {
      try {
        const path = `task-comments/${docId}/${Date.now()}_${file.name}`;
        const ref  = storage.ref(path);
        await ref.put(file, { customMetadata: { uploadedBy: (window.currentUser && currentUser.uid) || '' } });
        fileUrl  = await ref.getDownloadURL();
        fileName = file.name;
      } catch(err) {
        Notifs.showToast('File upload failed','error');
        if(sendBtn){sendBtn.disabled=false;sendBtn.style.opacity='1';}
        return;
      }
    } else if (pendingLink) {
      fileUrl = pendingLink;
      try { fileName = new URL(pendingLink).hostname.replace(/^www\./,''); } catch(_) { fileName = pendingLink; }
      fileSource = 'link';
    }

    await db.collection(collection).doc(docId).collection('comments').add({
      text: text||'', authorId: currentUser.uid, authorName: myName,
      fileUrl: fileUrl||null, fileName: fileName||null, fileSource: fileSource||null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Notify task assignees + creator (tasks only)
    if (collection === 'tasks') {
      try {
        const taskSnap = await db.collection('tasks').doc(docId).get();
        if (taskSnap.exists) {
          const task = taskSnap.data();
          const involved = new Set([...(task.assignedTo||[]), task.createdBy].filter(Boolean));
          involved.delete(currentUser.uid);
          // PLAIN EMOJI ONLY. This string becomes the notification BODY, which is
          // persisted and rendered as TEXT in the inbox and on the OS lock screen —
          // neither interprets HTML. emojiIcon() returns `<i data-lucide=…>` markup,
          // so this shipped literal code to the owner's phone:
          //   Neil Barro: <i data-lucide="link" style="width:16px;height:16px"></i> docs.google.com
          // Same class as the task-description generators fixed on 2026-08-08; this
          // is the notification-side instance. js/chat.js's own preview ladder
          // already carries this rule in a comment — see the plain 📣/🔗 there.
          const preview = text ? (text.length>60?text.slice(0,60)+'…':text) : `${fileSource==='link'?'🔗':'📎'} ${fileName||'File'}`;
          for (const uid of involved) {
            await Notifs.send(uid, {
              title: `💬 New message on "${task.title}"`,
              body: `${myName}: ${preview}`,
              icon: '💬', type: 'task_message'
            });
          }
        }
      } catch(e) { console.warn('Notif failed', e); }
    }

    input.value = '';
    if (fileInp) fileInp.value = '';
    pendingLink = null;
    const prev = document.getElementById(`ms-file-preview-${docId}`);
    if (prev) prev.textContent = '';
    renderComments(collection, docId, containerId, currentUser);
  };

  document.getElementById(`comment-send-${docId}`)?.addEventListener('click', sendComment);
  commentInput?.addEventListener('input', () => { autoGrowComment(); updateCommentSendState(); });
  commentInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComment(); }
  });
};

// ══════════════════════════════════════════════════
//  MARKETING DEPARTMENT
// ══════════════════════════════════════════════════
window.renderMarketing = async function(currentUser, currentRole, subtab = 'Campaigns') {
  const c = deptContainer();
  const tabs = (window.DEPARTMENTS?.Marketing?.subtabs) ||
    ['Campaigns','Leads','Promos','Insights','Advertising','Marketing Designs','Plan','Strategy','Budgeting','Proposals','Tasks'];
  c.innerHTML = `
    <div class="page-header"><h2>${emojiIcon('📢',20)} Marketing</h2></div>
    ${window.sopPanel('How Marketing works', [
      'Campaigns tracks each push: budget vs actual, dates, channels, and its materials.',
      'Leads is the capture inbox — new prospects land here, then hand off to Sales.',
      'Promos is the promotions calendar; Insights shows spend vs leads vs quotes vs wins.',
      'Advertising and Marketing Designs hold the creative asset libraries.',
      'Plan, Strategy and Proposals store playbooks and pitches; Tasks is the department board.'
    ])}
    ${window.chipTabs(tabs.map(s => ({ key:s, label:s })), subtab)}
    <div id="mkt-content">${window.skeletonHtml('rows')}</div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  loadMarketingContent(currentUser, currentRole, subtab);
  window.bindChipTabs(c, (key) => loadMarketingContent(currentUser, currentRole, key));
};

async function loadMarketingContent(currentUser, currentRole, sub) {
  const content = document.getElementById('mkt-content');
  switch(sub) {
    case 'Campaigns': await renderMktCampaigns(content, currentUser, currentRole); break;
    case 'Leads':     await renderMktLeads(content, currentUser, currentRole); break;
    case 'Promos':    await renderMktPromos(content, currentUser, currentRole); break;
    case 'Insights':  await renderMktInsights(content, currentUser, currentRole); break;
    case 'Strategy':
      content.innerHTML = window.sopPanel('Types of marketing (reference)', [
        'Digital: social (FB/IG/TikTok), search, email, website content.',
        'Field: exhibitions, in-office walk-ins, dealer visits, referral programs.',
        'Trade: distributor co-marketing, government-bid positioning, partner catalogues.'
      ]) + '<div id="mkt-strategy"></div>';
      await renderDocCollection(document.getElementById('mkt-strategy'), 'marketing_templates',
        'Strategy Templates', currentUser, currentRole, { icon:'🧭', color:'#880e4f', dept:'Marketing' });
      break;
    case 'Advertising':
      content.innerHTML = renderFileCollection('Advertising Materials', 'mkt-ads', currentRole);
      bindFileCollection('mkt-ads', currentUser, 'Marketing', 'Advertising');
      break;
    case 'Marketing Designs':
      content.innerHTML = renderFileCollection('Marketing Designs', 'mkt-designs', currentRole);
      bindFileCollection('mkt-designs', currentUser, 'Marketing', 'Designs');
      break;
    case 'Plan':
      await renderDocCollection(content, 'marketing_plans', 'Marketing Plans', currentUser, currentRole, { icon:'📅', color:'#880e4f', dept:'Marketing' });
      break;
    case 'Budgeting':
      await renderBudgeting(content, currentUser, currentRole, 'Marketing');
      break;
    case 'Proposals':
      await renderDocCollection(content, 'marketing_proposals', 'Marketing Proposals', currentUser, currentRole, { icon:'📝', color:'#880e4f', dept:'Marketing' });
      break;
    case 'Tasks':
      await renderDeptTasks(content, 'Marketing', currentUser, currentRole);
      break;
  }
}

// ── Marketing suite (v12 WS34): campaigns, leads inbox, promotions calendar,
// strategy templates, per-campaign insights. Builds on WS32's window.Clients
// (clients collection) and WS38's window.FilesHub (hub_files/hub_folders).
// Campaigns/promotions/marketing_templates are new literal-named root
// collections; leads write straight into `clients` (no new collection) with
// four additive fields — see fable-workplan/34-marketing.md.

// ── Spec 5 — Campaigns ───────────────────────────────
async function fetchCampaigns() {
  const snap = await (typeof dbCachedGet === 'function'
    ? dbCachedGet('campaigns', () => db.collection('campaigns').orderBy('createdAt','desc').get().catch(()=>({docs:[]})), 60000)
    : db.collection('campaigns').orderBy('createdAt','desc').get().catch(()=>({docs:[]})));
  return snap.docs.map(d => ({ id:d.id, ...d.data() }));
}

async function renderMktCampaigns(content, currentUser, currentRole) {
  const canEdit = canEditDept('Marketing');
  const camps = await fetchCampaigns();
  const today = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10);
  const stBadge = c0 => ({ planned:['badge-gray',`${emojiIcon('🗓',16)} Planned`], active:['badge-green','▶ Active'],
    done:['badge-blue',`✔ Done`], cancelled:['badge-red',`${emojiIcon('✖',16)} Cancelled`] })[c0.status] || ['badge-gray', c0.status||'—'];
  content.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="font-size:14px;margin:0">${emojiIcon('📣',14)} Campaigns (${camps.length})</h3>
      ${canEdit ? `<button class="btn-primary btn-sm" id="mkt-camp-add">＋ New Campaign</button>` : ''}
    </div>
    ${!camps.length ? `<div class="empty-state"><div class="empty-icon">${emojiIcon('📣',44)}</div><p>No campaigns yet.</p></div>`
      : `<div style="display:flex;flex-direction:column;gap:8px">${camps.map(c0 => { const [bc,bl]=stBadge(c0); return `
        <div class="item-card mkt-camp-row" data-id="${c0.id}" style="cursor:pointer">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
            <div style="min-width:0">
              <div style="font-weight:700;font-size:13px">${escHtml(c0.name||'')}
                <span class="badge ${bc}" style="font-size:9px">${bl}</span>
                ${(c0.endDate && c0.endDate < today && c0.status==='active') ? '<span class="badge badge-amber" style="font-size:9px">past end date</span>' : ''}</div>
              <div class="item-meta">
                <span>${emojiIcon('📅',16)} ${escHtml(c0.startDate||'—')} → ${escHtml(c0.endDate||'—')}</span>
                ${(c0.channels||[]).length ? `<span>${emojiIcon('📡',16)} ${c0.channels.map(ch=>escHtml(window.leadSourceLabel(ch))).join(', ')}</span>` : ''}
              </div>
            </div>
            <div style="font-size:12px;flex-shrink:0;text-align:right">Budget<br><strong>₱${fmt(c0.budget||0)}</strong></div>
          </div>
        </div>`; }).join('')}</div>`}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [content] });
  document.getElementById('mkt-camp-add')?.addEventListener('click', () =>
    openCampaignModal(null, () => renderMktCampaigns(content, currentUser, currentRole)));
  content.querySelectorAll('.mkt-camp-row').forEach(row => row.addEventListener('click', () =>
    openCampaignModal(camps.find(x => x.id === row.dataset.id), () => renderMktCampaigns(content, currentUser, currentRole))));
}

// One modal for create/edit/detail. Budget-line picker + actual-spend readout
// are money-tier only (finance/manager/owner/president) — the ledger is
// finance-gated in rules, so a non-money viewer sees "—", never a lying ₱0.
async function openCampaignModal(camp, onChange) {
  const isEdit = !!camp;
  const canMoneyTier = ['president','owner','manager','finance'].includes(window.currentRole);

  let lineOptions = '';
  if (canMoneyTier) {
    const linesSnap = await db.collection('budgets_marketing').get().catch(() => ({ docs: [] }));
    lineOptions = linesSnap.docs.map(d => `<option value="${d.id}" ${camp?.budgetLineId===d.id?'selected':''}>${escHtml(d.data().name||'')}</option>`).join('');
  }

  let spendHtml = '';
  if (isEdit) {
    if (canMoneyTier) {
      const ledgerSnap = await (typeof dbCachedGet === 'function'
        ? dbCachedGet('ledger-marketing', () => db.collection('ledger').where('dept','==','Marketing').get().catch(()=>({docs:[]})), 60000)
        : db.collection('ledger').where('dept','==','Marketing').get().catch(()=>({docs:[]})));
      const ledger = ledgerSnap.docs.map(d => d.data());
      const spent = camp.budgetLineId
        ? ledger.filter(e => e.budgetLineId === camp.budgetLineId && ledgerKind(e) === 'expense').reduce((s,e) => s + (e.amount||0), 0)
        : 0;
      const over = (camp.budget||0) > 0 && spent > camp.budget;
      spendHtml = `<div class="card" style="margin:10px 0"><div class="card-body" style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:12px;color:var(--text-muted)">Actual spend</span>
        <strong style="font-size:13px;${over?'color:var(--danger)':''}">₱${fmt(spent)} / ₱${fmt(camp.budget||0)}</strong>
      </div></div>`;
    } else {
      spendHtml = `<div style="font-size:12px;color:var(--text-muted);margin:10px 0">Actual spend — (finance-visible)</div>`;
    }
  }

  // V14 checkbox pass (2026-08-10). These sit inside the `Channels` .form-group,
  // so the carve-out at css/styles.css ~345 already restores a real native tick —
  // nothing here needs inline sizing. `check-row` (styles.css ~385) is the house
  // convention for a bare checkbox's tap target: it supplies display:inline-flex,
  // align-items:center, gap and a 44px min-height, which is why those three inline
  // declarations were dropped instead of being repeated. gap/font-size/margin stay
  // because they differ from the convention (these are compact wrapping chips).
  const chBoxes = (window.LEAD_SOURCES||[]).map(s => `<label class="check-row" style="gap:4px;font-size:12px;margin:2px 10px 2px 0">
      <input type="checkbox" class="mc-channel" value="${s.code}" ${(camp?.channels||[]).includes(s.code)?'checked':''}/> ${escHtml(s.label)}
    </label>`).join('');

  const _panel = openPage(isEdit ? 'Edit Campaign' : 'New Campaign', `
    <div class="form-group"><label>Name</label><input id="mc-name" value="${escHtml(camp?.name||'')}" placeholder="e.g. Q3 High-Pressure Stove Push"/></div>
    <div class="form-group"><label>Description</label><textarea id="mc-desc" rows="2">${escHtml(camp?.description||'')}</textarea></div>
    <div class="form-row">
      <div class="form-group"><label>Start date</label><input id="mc-start" type="date" value="${escHtml(camp?.startDate||'')}"/></div>
      <div class="form-group"><label>End date</label><input id="mc-end" type="date" value="${escHtml(camp?.endDate||'')}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Status</label>
        <select id="mc-status">${['planned','active','done','cancelled'].map(s => `<option value="${s}" ${(camp?.status||'planned')===s?'selected':''}>${s}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Budget (₱)</label><input id="mc-budget" type="number" step="0.01" min="0" value="${camp?.budget||0}" inputmode="decimal"/></div>
    </div>
    <div class="form-group"><label>Channels</label><div>${chBoxes}</div></div>
    ${canMoneyTier ? `<div class="form-group"><label>Budget line (optional — links actual spend)</label>
      <select id="mc-line"><option value="">— none —</option>${lineOptions}</select></div>` : ''}
    ${spendHtml}
    <div id="mc-materials"></div>
    <div id="mc-err" class="error-msg hidden" style="margin-top:8px"></div>
  `, `<button class="btn-primary" id="mc-save">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);

  // ⚠ SCOPED TO THIS PANEL, NOT document. openPage keeps a CLOSING page in the
  // DOM for ~300ms; a second record opened inside that window puts two panels
  // carrying the same ids in the DOM at once, and document.getElementById()
  // returns the FIRST in document order — the DYING one. Bind-time that gives a
  // dead button; inside the handler it is worse, because the save would read the
  // PREVIOUS campaign's field values and write them onto this one.
  const $ = (id) => _panel.querySelector('#' + id);
  $('mc-save').addEventListener('click', async () => {
    const err = $('mc-err');
    const name = $('mc-name').value.trim();
    const startDate = $('mc-start').value || '';
    const endDate = $('mc-end').value || '';
    if (!name) { err.textContent = 'Name is required.'; err.classList.remove('hidden'); return; }
    if (startDate && endDate && endDate < startDate) { err.textContent = 'End date must be on or after start date.'; err.classList.remove('hidden'); return; }
    const channels = Array.from(_panel.querySelectorAll('.mc-channel:checked')).map(cb => cb.value);
    const FV = firebase.firestore.FieldValue;
    const who = userProfile?.displayName || currentUser.email;
    const data = {
      name, description: $('mc-desc').value.trim(),
      channels, status: $('mc-status').value,
      startDate, endDate,
      budget: Math.max(0, parseFloat($('mc-budget').value) || 0),
      budgetLineId: canMoneyTier ? ($('mc-line').value || null) : (camp?.budgetLineId ?? null),
      updatedAt: FV.serverTimestamp()
    };
    try {
      if (isEdit) {
        await db.collection('campaigns').doc(camp.id).update(data);
      } else {
        data.createdBy = currentUser.uid; data.createdByName = who; data.createdAt = FV.serverTimestamp();
        await db.collection('campaigns').add(data);
      }
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('campaigns');
      Notifs.success('Campaign saved');
      closeModal(); onChange();
    } catch (ex) { err.textContent = 'Save failed: ' + (ex.message||ex.code); err.classList.remove('hidden'); }
  });

  // Spec 5c — Materials panel (Phase B: real Hub data once WS38 ships; Phase A
  // shows a placeholder). Only for an existing campaign being edited.
  if (isEdit) await renderCampaignMaterialsPanel(camp, _panel);
}

// Phase B (WS38-coupled): one hub_folders doc per campaign (scope:'materials',
// deterministic id `materials__<campaignId>`), files listed/uploaded through
// window.FilesHub — ordinary Hub data, nothing throwaway. Phase A (FilesHub not
// yet defined) shows a placeholder instead.
async function renderCampaignMaterialsPanel(camp, _panel) {
  // ⚠ Scoped to the campaign editor panel that called us (its #mc-materials),
  // not document — a closing editor panel lingers ~300ms and would otherwise
  // win the getElementById race and receive THIS campaign's materials list.
  const wrap = (_panel || document).querySelector('#mc-materials');
  if (!wrap) return;
  if (typeof window.FilesHub === 'undefined') {
    wrap.innerHTML = `<div style="font-size:11px;color:var(--text-muted);margin-top:10px">${emojiIcon('📁',11)} Materials arrive with the Files Hub (WS38).</div>`;
    if (window.lucide) lucide.createIcons({ nodes: [wrap] });
    return;
  }
  const folderId = `materials__${camp.id}`;
  // Ensure the campaign's hub folder exists (deterministic id ⇒ idempotent).
  // hub_folders update is creator-or-admin only, so a second (non-creator,
  // non-admin) Marketing user's merge-set here is a rules UPDATE that gets
  // denied — the catch swallows it; the folder already exists, so behavior
  // stays correct. Keep the catch — do not "fix" the denial.
  await db.collection('hub_folders').doc(folderId).set({
    name: camp.name || 'Campaign', parentId: null, scope: 'materials', department: 'Marketing',
    campaignId: camp.id, createdBy: currentUser.uid,
    createdByName: (userProfile?.displayName || currentUser.email),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true }).catch(() => {});

  const renderList = async () => {
    const files = (await FilesHub.loadFiles('materials')).filter(f => f.folderId === folderId);
    wrap.innerHTML = `
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:10px 0 4px">${emojiIcon('📁',16)} Materials (${files.length})</div>
      ${files.length ? `<div class="item-list">${files.map(f => `
        <div class="item-card" style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <span style="font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.kind==='link'?`${emojiIcon('🔗',16)}`:`${emojiIcon('📄',16)}`} ${escHtml(f.name||'File')}</span>
          <span style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn-secondary btn-sm mc-mat-preview" data-id="${f.id}" title="Preview">${emojiIcon('👁',16)}</button>
            ${FilesHub.canEdit(f) ? `<button class="btn-secondary btn-sm mc-mat-del" data-id="${f.id}" title="Remove">${emojiIcon('🗑',16)}</button>` : ''}
          </span>
        </div>`).join('')}</div>` : `<div style="font-size:12px;color:var(--text-muted)">No materials yet.</div>`}
      ${canEditDept('Marketing') ? `<div id="mc-mat-upload" style="margin-top:8px"></div>` : ''}
    `;
    if (window.lucide) lucide.createIcons({ nodes: [wrap] });
    wrap.querySelectorAll('.mc-mat-preview').forEach(b => b.addEventListener('click', () => {
      const f = files.find(x => x.id === b.dataset.id); if (f) window.openFilePreview(f);
    }));
    wrap.querySelectorAll('.mc-mat-del').forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmDialog({ message: 'Remove this material?', danger: true }))) return;
      try { await FilesHub.softDelete(b.dataset.id); Notifs.success('Removed'); renderList(); }
      catch (ex) { Notifs.showToast('Remove failed: ' + (ex.message||ex.code), 'error'); }
    }));
    if (canEditDept('Marketing')) {
      Drive.renderUploadArea('mc-mat-upload', async (result, file) => {
        const FV = firebase.firestore.FieldValue, nowIso = new Date().toISOString();
        await db.collection('hub_files').add({            // WS38 Spec-1 shape, verbatim
          name: result.name, description: '', fileType: 'Other',
          kind: result.source === 'link' ? 'link' : 'file',
          scope: 'materials', department: 'Marketing', folderId,
          url: result.url, driveUrl: null,
          size: file?.size || null, contentType: file?.type || null,
          source: result.source || 'firebase', currentV: 1,
          versions: [{ v:1, url:result.url, name:result.name, size:file?.size||null,
            contentType:file?.type||null, note:'', by:currentUser.uid,
            byName:(userProfile?.displayName||currentUser.email), at: nowIso }],
          archived:false, deleted:false, deletedAt:null, deletedBy:null,
          visibility:'company', sharedUserIds:[], editorUserIds:[], shares:[],
          uploadedBy: currentUser.uid, uploaderName:(userProfile?.displayName||currentUser.email),
          createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() });
        Notifs.success('Material added');
        renderList();
      }, { dept:'Marketing', subfolder:'Files', allowLinks:true });
    }
  };
  await renderList();
}

// ── Spec 6 — Leads inbox ─────────────────────────────
async function renderMktLeads(content, currentUser, currentRole) {
  const canEdit = canEditDept('Marketing');
  const all = await window.Clients.listAll({ brand: 'sales' });      // cached 'clients' key (WS32)
  if (all.some(c => c._legacy)) {                                     // WS32 migration not yet run
    content.innerHTML = `<div class="alert-banner alert-warn">${emojiIcon('🧭',16)} Run the client-book unification (Sales → Clients) before using the Leads inbox.</div>`;
    if (window.lucide) lucide.createIcons({ nodes: [content] });
    return;
  }
  const camps = await fetchCampaigns();
  const campName = id => escHtml((camps.find(c0 => c0.id === id) || {}).name || '');
  const mine = all.filter(c0 => c0.leadOrigin === 'marketing');
  const inbox = mine.filter(c0 => !c0.handedOffAt);
  const handed = mine.filter(c0 => !!c0.handedOffAt);
  const row = (c0, showHandoff) => `
    <div class="item-card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
        <div style="min-width:0">
          <div style="font-weight:700;font-size:13px">${escHtml(c0.name||'')}
            <span class="badge badge-gray" style="font-size:9px">${escHtml(window.leadSourceLabel(c0.source))}</span>
            ${c0.campaignId ? `<span class="badge badge-blue" style="font-size:9px">${emojiIcon('📣',9)} ${campName(c0.campaignId)}</span>` : ''}
            ${(() => { const st = crmStageMeta(crmStageOf(c0)); return `<span class="badge" style="font-size:9px;background:${st.color};color:var(--on-primary)">${st.icon} ${st.label}</span>`; })()}</div>
          <div class="item-meta">
            ${c0.company ? `<span>${emojiIcon('🏢',16)} ${escHtml(c0.company)}</span>` : ''}
            ${c0.phone ? `<span>${emojiIcon('📞',16)} ${escHtml(c0.phone)}</span>` : ''}
            ${c0.email ? `<span>${emojiIcon('✉️',16)} ${escHtml(c0.email)}</span>` : ''}
          </div>
        </div>
        ${showHandoff && canEdit ? `<button class="btn-primary btn-sm mkt-lead-handoff" data-id="${c0.id}">→ Send to Sales</button>` : ''}
      </div>
    </div>`;
  content.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="font-size:14px;margin:0">${emojiIcon('📥',14)} Leads Inbox (${inbox.length})</h3>
      ${canEdit ? `<button class="btn-primary btn-sm" id="mkt-lead-add">＋ Capture Lead</button>` : ''}
    </div>
    ${!inbox.length ? `<div class="empty-state" style="padding:18px"><p>No leads awaiting handoff.</p></div>`
      : `<div style="display:flex;flex-direction:column;gap:8px">${inbox.map(c0 => row(c0, true)).join('')}</div>`}
    ${handed.length ? `<h4 style="font-size:13px;margin:16px 0 6px">${emojiIcon('✅',13)} Handed to Sales (${handed.length})</h4>
      <div style="display:flex;flex-direction:column;gap:8px">${handed.slice(0,30).map(c0 => row(c0, false)).join('')}</div>` : ''}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [content] });
  document.getElementById('mkt-lead-add')?.addEventListener('click', () =>
    openLeadCaptureModal(camps, () => renderMktLeads(content, currentUser, currentRole)));
  content.querySelectorAll('.mkt-lead-handoff').forEach(btn => btn.addEventListener('click', async () => {
    const cl = inbox.find(x => x.id === btn.dataset.id); if (!cl) return;
    btn.disabled = true;
    const FV = firebase.firestore.FieldValue;
    const today = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10);
    const who = userProfile?.displayName || currentUser.email;
    try {
      await db.collection('clients').doc(cl.id).update({
        handedOffAt: FV.serverTimestamp(), handedOffBy: currentUser.uid, handedOffByName: who,
        contactLog: FV.arrayUnion({ date: today, by: who,
          note: 'Lead handed to Sales' + (cl.campaignId ? ' (campaign: ' + ((camps.find(c0=>c0.id===cl.campaignId)||{}).name || '') + ')' : '') }),
        updatedAt: FV.serverTimestamp() });
      await Notifs.sendToDept('Sales', {
        title: '📥 New lead from Marketing',
        body: `${cl.name}${cl.company ? ' · ' + cl.company : ''} — ${window.leadSourceLabel(cl.source)}${cl.campaignId ? ' · ' + ((camps.find(c0=>c0.id===cl.campaignId)||{}).name || '') : ''}. Open the Sales CRM to follow up.`,
        icon: '📥', type: 'lead_handoff', link: 'dept:Sales',
        dedupKey: `lead_handoff_${cl.id}`
      }, { fallbackToOwner: true });
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('clients');
      Notifs.success(`Lead sent to Sales: ${cl.name}`);
      renderMktLeads(content, currentUser, currentRole);
    } catch (ex) { btn.disabled = false; Notifs.showToast('Handoff failed: ' + (ex.message||ex.code), 'error'); }
  }));
}

// Capture modal — nameKey dedupe, first-touch attribution (never overwrite an
// existing campaignId once set), fill-empty-only on company/phone/email.
function openLeadCaptureModal(camps, onSaved) {
  const campOptions = camps.filter(c0 => c0.status !== 'cancelled')
    .map(c0 => `<option value="${c0.id}">${escHtml(c0.name||'')}</option>`).join('');
  const _panel = openPage('Capture Lead', `
    <div class="form-group"><label>Name</label><input id="lc-name" placeholder="Contact name"/></div>
    <div class="form-group"><label>Company</label><input id="lc-company"/></div>
    <div class="form-row">
      <div class="form-group"><label>Phone</label><input id="lc-phone" type="tel"/></div>
      <div class="form-group"><label>Email</label><input id="lc-email" type="email"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Source</label>
        <select id="lc-source">${(window.LEAD_SOURCES||[]).map(s => `<option value="${s.code}">${escHtml(s.label)}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Campaign</label>
        <select id="lc-campaign"><option value="">— none —</option>${campOptions}</select>
      </div>
    </div>
    <div class="form-group"><label>Notes</label><textarea id="lc-notes" rows="2"></textarea></div>
    <div id="lc-err" class="error-msg hidden" style="margin-top:8px"></div>
  `, `<button class="btn-primary" id="lc-save">Capture Lead</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  // ⚠ SCOPED TO THIS PANEL, NOT document — a closing capture panel lingers ~300ms
  // and would win the getElementById race, so the save would read the PREVIOUS
  // lead's fields and write them onto this one.
  const $ = (id) => _panel.querySelector('#' + id);
  $('lc-save').addEventListener('click', async () => {
    const err = $('lc-err');
    const name = $('lc-name').value.trim();
    if (!name) { err.textContent = 'Name is required.'; err.classList.remove('hidden'); return; }
    const vals = {
      company: $('lc-company').value.trim(),
      phone: $('lc-phone').value.trim(),
      email: $('lc-email').value.trim(),
    };
    const notes = $('lc-notes').value.trim();
    const source = $('lc-source').value;
    const campaignId = $('lc-campaign').value || null;
    try {
      const existing = await window.Clients.findByName(name);
      const FV = firebase.firestore.FieldValue;
      if (existing) {
        const upd = { updatedAt: FV.serverTimestamp(), leadOrigin: existing.leadOrigin || 'marketing',
          source: existing.source || source, brands: FV.arrayUnion('sales') };
        if (!existing.campaignId && campaignId) upd.campaignId = campaignId;   // first-touch: never overwrite
        ['company','phone','email'].forEach(k => { if (!existing[k] && vals[k]) upd[k] = vals[k]; }); // fill-empty only
        await db.collection('clients').doc(existing.id).update(upd);
        Notifs.success(`Existing client updated: ${name}`);
      } else {
        await db.collection('clients').add({
          name, nameKey: window.clientNameKey(name), brands: ['sales'], stage: 'lead',
          company: vals.company, phone: vals.phone, email: vals.email, address: '', notes,
          followUpDate: '', lastContact: '', contactLog: [],
          leadOrigin: 'marketing', source, campaignId: campaignId || null,
          handedOffAt: null,
          addedBy: currentUser.uid, createdBy: currentUser.uid,
          createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp() });
        Notifs.success(`Lead captured: ${name}`);
      }
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('clients');
      closeModal(); onSaved();
    } catch (ex) { err.textContent = 'Save failed: ' + (ex.message||ex.code); err.classList.remove('hidden'); }
  });
}

// ── Spec 7 — Promotions calendar (miniCal-pattern month grid) ───────────
let _promoMonthOffset = 0;
async function renderMktPromos(content, currentUser, currentRole) {
  const canEdit = canEditDept('Marketing');
  const snap = await (typeof dbCachedGet === 'function'
    ? dbCachedGet('promotions', () => db.collection('promotions').get().catch(()=>({docs:[]})), 60000)
    : db.collection('promotions').get().catch(()=>({docs:[]})));
  const promos = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  const camps = await fetchCampaigns();
  const campName = id => escHtml((camps.find(c0 => c0.id === id) || {}).name || '');
  const todayStr = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10);
  // Manila-anchored month base — same technique as renderMiniCal (app.js)
  const base = new Date(+todayStr.slice(0,4), +todayStr.slice(5,7)-1, 1);
  base.setMonth(base.getMonth() + _promoMonthOffset);
  const year = base.getFullYear(), month = base.getMonth();
  const mStart = `${year}-${String(month+1).padStart(2,'0')}-01`;
  const daysIn = new Date(year, month+1, 0).getDate();
  const mEnd = `${year}-${String(month+1).padStart(2,'0')}-${String(daysIn).padStart(2,'0')}`;
  // A promo is "on" a day when startDate<=day<=endDate (ISO strings compare lexically)
  const monthPromos = promos.filter(p => (p.startDate||'') <= mEnd && (p.endDate||p.startDate||'') >= mStart)
    .sort((a,b) => (a.startDate||'').localeCompare(b.startDate||''));
  const onDay = ds => monthPromos.filter(p => (p.startDate||'') <= ds && (p.endDate||p.startDate||'') >= ds);
  const firstDay = new Date(year, month, 1).getDay();
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const pad = n => String(n).padStart(2,'0');

  content.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h3 style="font-size:14px;margin:0">${emojiIcon('🗓',14)} ${months[month]} ${year}</h3>
      <div style="display:flex;align-items:center;gap:6px">
        <button class="btn-secondary btn-sm mkt-promo-nav" data-dir="-1">‹</button>
        <button class="btn-secondary btn-sm mkt-promo-nav" data-dir="1">›</button>
        ${canEdit ? `<button class="btn-primary btn-sm" id="mkt-promo-add" style="margin-left:6px">＋ New Promo</button>` : ''}
      </div>
    </div>
    <div class="card" style="margin-bottom:12px"><div class="card-body">
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center">
        ${['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=>`<div style="font-size:10px;font-weight:700;color:var(--text-muted);padding:4px">${d}</div>`).join('')}
        ${Array(firstDay).fill('<div></div>').join('')}
        ${Array.from({length:daysIn},(_,i)=>{
          const day=i+1; const ds=`${mStart.slice(0,8)}${pad(day)}`; const isToday=ds===todayStr;
          const cnt=onDay(ds).length;
          return `<div class="mkt-promo-day" data-date="${ds}" style="position:relative;padding:6px 2px;border-radius:10px;font-size:12px;cursor:${cnt?'pointer':'default'};${isToday?'background:var(--primary);color:var(--on-primary);font-weight:700':cnt?'background:var(--surface2)':''}">${day}${cnt?`<div style="display:flex;gap:2px;justify-content:center;margin-top:2px">${Array(Math.min(cnt,3)).fill(0).map(()=>`<span style="width:4px;height:4px;border-radius:50%;background:${isToday?'var(--on-primary)':'var(--danger)'}"></span>`).join('')}</div>`:''}</div>`;
        }).join('')}
      </div>
      <div id="mkt-promo-day-detail" style="margin-top:10px;font-size:12px;color:var(--text-muted);min-height:16px"></div>
    </div></div>
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin:8px 0 4px">This month (${monthPromos.length})</div>
    ${!monthPromos.length ? `<div class="empty-state" style="padding:18px"><p>No promos this month.</p></div>`
      : `<div style="display:flex;flex-direction:column;gap:8px">${monthPromos.map(p => `
        <div class="item-card">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
            <div style="min-width:0">
              <div style="font-weight:700;font-size:13px">${escHtml(p.title||'')}</div>
              <div class="item-meta">
                <span>${emojiIcon('📅',16)} ${escHtml(p.startDate||'—')} → ${escHtml(p.endDate||p.startDate||'—')}</span>
                ${p.channel ? `<span>${emojiIcon('📡',16)} ${escHtml(window.leadSourceLabel(p.channel))}</span>` : ''}
                ${p.campaignId ? `<span>${emojiIcon('📣',16)} ${campName(p.campaignId)}</span>` : ''}
              </div>
            </div>
            ${canEdit ? `<span style="display:flex;gap:4px;flex-shrink:0">
              <button class="btn-secondary btn-sm mkt-promo-edit" data-id="${p.id}" aria-label="Edit promo">${emojiIcon('✏️',16)}</button>
              <button class="btn-secondary btn-sm mkt-promo-del" data-id="${p.id}" aria-label="Delete promo">${emojiIcon('🗑',16)}</button>
            </span>` : ''}
          </div>
        </div>`).join('')}</div>`}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [content] });
  content.querySelectorAll('.mkt-promo-nav').forEach(b => b.addEventListener('click', () => {
    _promoMonthOffset += parseInt(b.dataset.dir,10); renderMktPromos(content, currentUser, currentRole);
  }));
  content.querySelectorAll('.mkt-promo-day').forEach(c => c.addEventListener('click', () => {
    const ds = c.dataset.date; const dayPromos = onDay(ds);
    const det = document.getElementById('mkt-promo-day-detail'); if (!det) return;
    det.innerHTML = dayPromos.length
      ? `<div style="font-weight:700;color:var(--text);margin-bottom:3px">${emojiIcon('📅',16)} ${escHtml(ds)} — ${dayPromos.length} promo${dayPromos.length>1?'s':''}</div>${dayPromos.map(p=>`<div>• ${escHtml(p.title||'')}</div>`).join('')}`
      : '';
    if (window.lucide) lucide.createIcons({ nodes: [det] });
  }));
  document.getElementById('mkt-promo-add')?.addEventListener('click', () =>
    openPromoModal(null, camps, () => renderMktPromos(content, currentUser, currentRole)));
  content.querySelectorAll('.mkt-promo-edit').forEach(b => b.addEventListener('click', () =>
    openPromoModal(monthPromos.find(x => x.id === b.dataset.id), camps, () => renderMktPromos(content, currentUser, currentRole))));
  content.querySelectorAll('.mkt-promo-del').forEach(b => b.addEventListener('click', async () => {
    if (!(await confirmDialog({ message: 'Delete this promo?', danger: true }))) return;
    try {
      await db.collection('promotions').doc(b.dataset.id).delete();
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('promotions');
      Notifs.success('Promo deleted');
      renderMktPromos(content, currentUser, currentRole);
    } catch (ex) { Notifs.showToast('Delete failed: ' + (ex.message||ex.code), 'error'); }
  }));
}

// title (required), start/end dates (end >= start, default end = start),
// channel <select> (LEAD_SOURCES + blank), campaign <select>, notes.
function openPromoModal(promo, camps, onSaved) {
  const isEdit = !!promo;
  const campOptions = camps.map(c0 => `<option value="${c0.id}" ${promo?.campaignId===c0.id?'selected':''}>${escHtml(c0.name||'')}</option>`).join('');
  const _panel = openPage(isEdit ? 'Edit Promo' : 'New Promo', `
    <div class="form-group"><label>Title</label><input id="pm-title" value="${escHtml(promo?.title||'')}" placeholder="e.g. 10% off double-burner ranges"/></div>
    <div class="form-row">
      <div class="form-group"><label>Start date</label><input id="pm-start" type="date" value="${escHtml(promo?.startDate||'')}"/></div>
      <div class="form-group"><label>End date</label><input id="pm-end" type="date" value="${escHtml(promo?.endDate||promo?.startDate||'')}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Channel</label>
        <select id="pm-channel"><option value="">—</option>${(window.LEAD_SOURCES||[]).map(s => `<option value="${s.code}" ${promo?.channel===s.code?'selected':''}>${escHtml(s.label)}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Campaign</label>
        <select id="pm-campaign"><option value="">— none —</option>${campOptions}</select>
      </div>
    </div>
    <div class="form-group"><label>Notes</label><textarea id="pm-notes" rows="2">${escHtml(promo?.notes||'')}</textarea></div>
    <div id="pm-promo-err" class="error-msg hidden" style="margin-top:8px"></div>
  `, `<button class="btn-primary" id="pm-promo-save">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  // ⚠ SCOPED TO THIS PANEL, NOT document — a closing promo panel lingers ~300ms
  // and would win the getElementById race, so the save would read the PREVIOUS
  // promo's fields and write them onto this one.
  const $ = (id) => _panel.querySelector('#' + id);
  $('pm-promo-save').addEventListener('click', async () => {
    const err = $('pm-promo-err');
    const title = $('pm-title').value.trim();
    if (!title) { err.textContent = 'Title is required.'; err.classList.remove('hidden'); return; }
    const startDate = $('pm-start').value || '';
    const endDate = $('pm-end').value || startDate;
    if (startDate && endDate < startDate) { err.textContent = 'End date must be on or after start date.'; err.classList.remove('hidden'); return; }
    const FV = firebase.firestore.FieldValue;
    const who = userProfile?.displayName || currentUser.email;
    const data = {
      title, startDate, endDate,
      channel: $('pm-channel').value || '',
      campaignId: $('pm-campaign').value || null,
      notes: $('pm-notes').value.trim(),
      updatedAt: FV.serverTimestamp()
    };
    try {
      if (isEdit) { await db.collection('promotions').doc(promo.id).update(data); }
      else { data.createdBy = currentUser.uid; data.createdByName = who; data.createdAt = FV.serverTimestamp();
        await db.collection('promotions').add(data); }
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('promotions');
      Notifs.success('Promo saved'); closeModal(); onSaved();
    } catch (ex) { err.textContent = 'Save failed: ' + (ex.message||ex.code); err.classList.remove('hidden'); }
  });
}

// ── Spec 8 — Insights (live rollup, no cache collection) ────────────────
async function renderMktInsights(content, currentUser, currentRole) {
  const canSpend = ['president','owner','manager','finance'].includes(currentRole);
  const [camps, clientsAll, qSnap, ledgerSnap] = await Promise.all([
    fetchCampaigns(),
    window.Clients.listAll(),                                   // 'clients' cache key (WS32)
    (typeof getAllQuotes === 'function' ? getAllQuotes() : Promise.resolve({ docs: [] })),  // 'all-quotes'
    canSpend
      ? (typeof dbCachedGet === 'function'
          ? dbCachedGet('ledger-marketing', () => db.collection('ledger').where('dept','==','Marketing').get().catch(()=>({docs:[]})), 60000)
          : db.collection('ledger').where('dept','==','Marketing').get().catch(()=>({docs:[]})))
      : Promise.resolve({ docs: [] })
  ]);
  const quotes = qSnap.docs.map(d => ({ id:d.id, ...d.data() }));
  const ledger = ledgerSnap.docs.map(d => d.data());
  const rows = camps.map(camp => {
    const leads = clientsAll.filter(c0 => c0.campaignId === camp.id);
    const seen = {}; const cQuotes = [];
    leads.forEach(c0 => window.Clients.quotesFor(c0, quotes)      // WS32 canonical join — clientId first, nameKey fallback
      .forEach(q => { if (!seen[q.id]) { seen[q.id] = 1; cQuotes.push(q); } }));
    const wins = cQuotes.filter(window.isQuoteWon);               // WS32 canonical outcome
    const spend = (canSpend && camp.budgetLineId)
      ? ledger.filter(e => e.budgetLineId === camp.budgetLineId && ledgerKind(e) === 'expense')
              .reduce((s,e) => s + (e.amount||0), 0)
      : null;                                                     // null ⇒ render '—', never ₱0
    return { camp, leads: leads.length,
      converted: leads.filter(c0 => crmStageOf(c0) === 'won').length,
      quotes: cQuotes.length,
      quoted: cQuotes.reduce((s,q) => s + (q.total||q.grandTotal||0), 0),
      wins: wins.length,
      wonVal: wins.reduce((s,q) => s + (q.total||q.grandTotal||0), 0),
      spend, cpl: (spend != null && leads.length) ? spend / leads.length : null };
  });
  const unattributed = clientsAll.filter(c0 => c0.leadOrigin === 'marketing' && !c0.campaignId).length;
  const totalSpend = canSpend ? rows.reduce((s,r) => s + (r.spend||0), 0) : null;
  const totalLeads = rows.reduce((s,r) => s + r.leads, 0);
  const totalWonVal = rows.reduce((s,r) => s + r.wonVal, 0);
  const stBadge = st => ({ planned:['badge-gray',`${emojiIcon('🗓',16)} Planned`], active:['badge-green','▶ Active'],
    done:['badge-blue',`✔ Done`], cancelled:['badge-red',`${emojiIcon('✖',16)} Cancelled`] })[st] || ['badge-gray', st||'—'];

  content.innerHTML = `
    <div class="kpi-row" style="margin-bottom:14px">
      <div class="kpi-card red"><div class="kpi-label">Total Spend</div><div class="kpi-value">${totalSpend!=null?'₱'+fmt(totalSpend):'—'}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Leads</div><div class="kpi-value">${totalLeads}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Total Wins ₱</div><div class="kpi-value">₱${fmt(totalWonVal)}</div></div>
    </div>
    ${!camps.length ? `<div class="empty-state" style="padding:20px"><div class="empty-icon">${emojiIcon('📈',44)}</div><p>No campaigns yet.</p></div>` : `
    <div class="table-wrap" style="overflow-x:auto">
      <table class="data-table table-cards">
        <thead><tr><th>Campaign</th><th>Status</th><th>Spend</th><th>Leads</th><th>CPL</th><th>Quotes</th><th>Quoted ₱</th><th>Wins</th><th>Won ₱</th></tr></thead>
        <tbody>
          ${rows.map(r => { const [bc,bl] = stBadge(r.camp.status);
            const overBudget = (r.spend!=null && (r.camp.budget||0)>0 && r.spend > r.camp.budget);
            return `<tr class="mi-row">
              <td class="tc-name" style="font-weight:600">${escHtml(r.camp.name||'')} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
              <td class="tc-detail" data-label="Status"><span class="badge ${bc}" style="font-size:9px">${bl}</span></td>
              <td class="tc-detail" data-label="Spend" style="${overBudget?'color:var(--danger)':''}">${r.spend!=null?'₱'+fmt(r.spend):`<span title="finance-visible">${emojiIcon('🔒',16)} —</span>`}</td>
              <td class="tc-detail" data-label="Leads">${r.leads}</td>
              <td class="tc-detail" data-label="CPL">${r.cpl!=null?'₱'+fmt(r.cpl):`<span title="finance-visible">${emojiIcon('🔒',16)} —</span>`}</td>
              <td class="tc-detail" data-label="Quotes">${r.quotes}</td>
              <td class="tc-detail" data-label="Quoted ₱">₱${fmt(r.quoted)}</td>
              <td class="tc-detail" data-label="Wins">${r.wins}</td>
              <td class="tc-net">₱${fmt(r.wonVal)}</td>
            </tr>`; }).join('')}
        </tbody>
      </table>
    </div>`}
    ${unattributed > 0 ? `<div style="font-size:11px;color:var(--text-muted);margin-top:10px">${emojiIcon('💡',11)} ${unattributed} marketing lead${unattributed>1?'s have':' has'} no campaign tag.</div>` : ''}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [content] });
  content.querySelectorAll('tr.mi-row').forEach(tr => tr.addEventListener('click', () => tr.classList.toggle('tc-expanded')));
}

// ══════════════════════════════════════════════════
//  FINANCE DEPARTMENT
// ══════════════════════════════════════════════════
// v14 Wave4 Batch F1 — IA restructure: 18 flat chips → 7 groups, each with one
// or more members. A "member" key is exactly the OLD flat chip key (unchanged),
// so every existing deep link / notification / HR-hub card / back-button that
// passes an old key straight into window.renderFinance(..., 'Ledger') etc. —
// or into window.currentSubtab via the URL hash — keeps resolving with zero
// call-site changes. FINANCE_KEY_TO_GROUP below IS the alias map: old key →
// owning group. loadFinanceContent's switch (17 renderers) is untouched.
// FINANCE_GROUPS/FINANCE_KEY_TO_GROUP, renderFinance, renderFinanceNav, openFinanceToolsPage, window.runRebuildRollups, loadFinanceContent — moved verbatim to js/screens/finance.js (Wave 7 Pass 8, 2026-08-03).

// openSalaryRaiseModal / openRaiseHistory — moved verbatim to js/screens/hr.js
// (Wave 7 Pass 3, 2026-08-03), alongside the rest of the Salary Raise UI.
// window.RaiseFlow right below (the raise-execution SERVICE they call) stays
// here — see its own header comment and js/screens/hr.js's file header for
// the full boundary explanation.

// ── Raise lifecycle service (v12 WS23) — schedule → approve → materialize ──
// pending_raises holds the schedule/approval; salary_raises stays the
// immutable APPLIED audit log (unchanged shape, written only at materialize).
// President acts immediately; everyone else files a pending_approval request.
window.RaiseFlow = (function () {
  const nowMonth = () => today().slice(0, 7);            // today() wraps window.bizDate() → 'YYYY-MM-DD'

  // Create a raise. President → 'scheduled' (+ apply now if due). Others → 'pending_approval'.
  async function submitRaise(desc, { newAmount, effectiveDate, reason }) {
    const u = window.currentUser || auth.currentUser || {};
    const cur = parseFloat(desc.current) || 0;
    const eff = effectiveDate || today();
    const effMonth = eff.slice(0, 7);
    const isPres = typeof isRealPresident === 'function' && isRealPresident();
    const base = {
      subjectType: desc.subjectType, subjectId: desc.subjectId, subjectName: desc.subjectName || '',
      field: desc.fieldLabel, targetField: desc.targetField,
      oldAmount: cur, newAmount,
      changeAmount: +(newAmount - cur).toFixed(2),
      changePct: cur > 0 ? +((newAmount - cur) / cur * 100).toFixed(2) : null,
      effectiveDate: eff, effectiveMonth: effMonth, reason: reason || '',
      requestedBy: u.uid || '', requestedByName: window.userProfile?.displayName || u.email || '',
      appliedAt: null, appliedInMonth: null, salaryRaiseId: null,
      rejectedBy: null, rejectedByName: null, rejectedAt: null, rejectReason: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (isPres) {
      const ref = await db.collection('pending_raises').add({
        ...base, status: 'scheduled',
        approvedBy: u.uid, approvedByName: base.requestedByName,
        approvedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (effMonth <= nowMonth()) await materialize(ref.id);   // same-day/back-dated → apply now
      return { outcome: 'applied-or-scheduled', id: ref.id };
    }
    const ref = await db.collection('pending_raises').add({
      ...base, status: 'pending_approval', approvedBy: null, approvedByName: null, approvedAt: null
    });
    await safeNotify(() => Notifs.sendToOwner({
      title: '💸 Raise Approval Request',
      body: `${base.requestedByName} requested a raise for ${base.subjectName}: ₱${fmt(cur)} → ₱${fmt(newAmount)} (eff ${eff}).`,
      icon: '💸', type: 'raise_request', link: 'approvals'
    }));
    return { outcome: 'requested', id: ref.id };
  }

  // Materialize a scheduled raise: write base-of-record + salary_raises audit + status→applied.
  // Idempotent: guarded on status=='scheduled'; salary_raises id == pending_raises id (merge).
  async function materialize(raiseId) {
    const snap = await db.collection('pending_raises').doc(raiseId).get();
    if (!snap.exists) return;
    const r = snap.data();
    if (r.status !== 'scheduled') return;                    // re-entrancy / already applied
    let liveOld = r.oldAmount;
    if (r.subjectType === 'payroll') {
      const p = await db.collection('payroll').doc(r.subjectId).get();
      liveOld = (p.exists && typeof p.data().salary === 'number') ? p.data().salary : r.oldAmount;
      await db.collection('payroll').doc(r.subjectId).set({ salary: r.newAmount }, { merge: true });
    } else { // worker_profile — scale hourly from LIVE values (rate may have moved since schedule)
      const wp = await db.collection('worker_profiles').doc(r.subjectId).get();
      const curDaily = (wp.exists && wp.data().dailyRate) || 0;
      const curHourly = (wp.exists && wp.data().hourlyRate) || 0;
      liveOld = curDaily || r.oldAmount;
      const newHourly = curDaily > 0 ? +((curHourly * (r.newAmount / curDaily))).toFixed(2) : +(r.newAmount / 8).toFixed(2);
      await db.collection('worker_profiles').doc(r.subjectId).update({
        dailyRate: r.newAmount, hourlyRate: newHourly,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    // Audit log — deterministic id so a retried sweep overwrites instead of duplicating.
    await db.collection('salary_raises').doc(raiseId).set({
      subjectType: r.subjectType, subjectId: r.subjectId, subjectName: r.subjectName || '',
      field: r.field, oldAmount: liveOld, newAmount: r.newAmount,
      changeAmount: +(r.newAmount - liveOld).toFixed(2),
      changePct: liveOld > 0 ? +((r.newAmount - liveOld) / liveOld * 100).toFixed(2) : null,
      effectiveDate: r.effectiveDate, reason: r.reason || '',
      grantedBy: r.approvedBy || r.requestedBy || '', grantedByName: r.approvedByName || r.requestedByName || '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await db.collection('pending_raises').doc(raiseId).update({
      status: 'applied', appliedAt: firebase.firestore.FieldValue.serverTimestamp(),
      appliedInMonth: nowMonth(), salaryRaiseId: raiseId
    });
    window.logAudit && window.logAudit('raise-apply', r.subjectType, r.subjectId, { from: liveOld, to: r.newAmount });
    if (r.subjectType === 'payroll' && r.subjectId) {
      await safeNotify(() => Notifs.send(r.subjectId, {
        title: '💸 Salary Update',
        body: `Your ${r.field} changed from ₱${fmt(liveOld)} to ₱${fmt(r.newAmount)}, effective ${r.effectiveDate}.`,
        icon: '💸', type: 'raise_applied', link: 'personal-finance'
      }));
    }
    if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('users'); dbCacheInvalidate('payroll'); }
  }

  // Screen-load sweep: apply every scheduled raise whose month has arrived. Month-gated so
  // future-dated raises never leak into any Compute. Single-field query → no composite index.
  async function applyDueRaises(subjectType) {
    const nm = nowMonth();
    const snap = await db.collection('pending_raises').where('status', '==', 'scheduled').get().catch(() => ({ docs: [] }));
    const due = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(r => r.subjectType === subjectType && (r.effectiveMonth || r.effectiveDate.slice(0, 7)) <= nm);
    for (const r of due) { try { await materialize(r.id); } catch (e) { console.error('applyDueRaises', r.id, e); } }
    return due.length;
  }

  // President approves a pending_approval request → schedule (+ apply if already due).
  async function approve(raiseId) {
    const ref = db.collection('pending_raises').doc(raiseId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().status !== 'pending_approval') return 'stale'; // re-entrancy guard
    const u = window.currentUser || auth.currentUser || {};
    await ref.update({
      status: 'scheduled', approvedBy: u.uid,
      approvedByName: window.userProfile?.displayName || u.email || 'President',
      approvedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    const r = snap.data();
    await safeNotify(() => Notifs.send(r.requestedBy, { title: '✅ Raise Approved',
      body: `Your raise request for ${r.subjectName} was approved.`, icon: '✅', type: 'raise_request', link: 'approvals' }));
    if ((r.effectiveMonth || r.effectiveDate.slice(0, 7)) <= nowMonth()) await materialize(raiseId);
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:pending_raises-pending'); // PERF-WAVE1
    return 'approved';
  }

  async function reject(raiseId, reason) {
    const ref = db.collection('pending_raises').doc(raiseId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().status !== 'pending_approval') return 'stale';
    const u = window.currentUser || auth.currentUser || {};
    await ref.update({ status: 'rejected', rejectedBy: u.uid,
      rejectedByName: window.userProfile?.displayName || u.email || 'President',
      rejectedAt: firebase.firestore.FieldValue.serverTimestamp(), rejectReason: reason || '' });
    const r = snap.data();
    await safeNotify(() => Notifs.send(r.requestedBy, { title: '❌ Raise Declined',
      body: `Your raise request for ${r.subjectName} was declined.${reason ? ' Reason: ' + reason : ''}`,
      icon: '❌', type: 'raise_request', link: 'approvals' }));
    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('approvals-pending:pending_raises-pending'); // PERF-WAVE1
    return 'rejected';
  }

  return { submitRaise, materialize, applyDueRaises, approve, reject };
})();

// window.openScheduledRaises — moved verbatim to js/screens/hr.js (Wave 7
// Pass 3, 2026-08-03), next to openRaiseHistory/openSalaryRaiseModal. Still
// calls window.RaiseFlow.approve/reject (above) as a plain global at runtime.

// window.renderHR (the HR hub card launcher) — moved verbatim to
// js/screens/hr.js (Wave 7 Pass 3, 2026-08-03). See that file's header for
// the load-order contract; js/app.js's navigateTo() switch (case 'HR')
// still calls it as window.renderHR.

// ═══════════════════════════════════════════════════════════
//  ONE PAYROLL ENGINE (v12 WS20) — Compute → Verify → Disburse
//  computePayLine: pure per-employee math (no writes, no reads).
//  computePayRun:  read-heavy, freezes lines[] onto pay_runs/{month}, no
//                  money-moving side effects — safe to re-run before Verify.
//  disbursePayRun: THE single mutating step — CA balances decrement, ledger
//                  posts, salary_history mirrors write, employees notified.
// ═══════════════════════════════════════════════════════════
// computePayLine moved verbatim to js/money-core.js (v14 Wave 2 Batch A —
// money-math tests, spec item I5). money-core.js loads BEFORE this file, so
// window.computePayLine is already defined by the time computePayRun below
// calls it — no behavior change.

/* ── THE DOUBLE-PAY GUARD — one expression, three callers ──────────────
   Why this is a named function rather than an inline chain: the monthly run
   (computePayRun, below), the Payroll roster and the roster's table preview
   (js/screens/hr.js) each decided independently who the monthly run pays, and
   they DID drift — the roster tested `payClass` alone while the engine also
   skipped removed staff and anyone bridged to a weekly worker profile, so the
   screen listed people Compute then silently dropped.

   It is the ONLY thing standing between the two populations and someone being
   paid MONTHLY and WEEKLY for the same period, and it gets more load-bearing —
   not less — as Office Team and Operations Team converge on one create path
   and one profile. It must therefore have exactly one definition.

   Two INDEPENDENT facts each mean "paid weekly", and both must be honoured:
     • payroll/{uid}.payClass === 'production'  — the declared pay class
     • an ACTIVE worker_profiles doc whose linkedUid == uid — the structural
       bridge, which can exist while payClass is still 'regular'
   Anyone matching EITHER is out of the monthly run. `status !== 'inactive'` is
   part of the linked test: an offboarded worker profile must not keep a person
   out of the monthly run forever.

   Returns null when the person IS paid monthly, otherwise a reason string that
   is recorded in pay_runs.skipped[] — a run always accounts for every member of
   staff and never silently drops one.

   NOTE ON ROLE: no clause here reads `role`. Every office role — president,
   manager, Corporate Secretary, finance, employee, agent — is paid by the
   monthly run on exactly the same terms. */
/* ── PERIOD-SCOPED EXCLUSION (owner ruling, 2026-08-10) ────────────────────
   "removing of certain members on payroll is strictly applied on that payroll
   period only unless said member is removed from system."

   WHAT WAS WRONG. payrollExcluded was written to payroll/{uid} with NO MONTH
   attached and read here with no month attached, so excluding someone from June
   excluded them from July, August and every month after — until a human
   remembered to put them back. The roster said so in its own words ("Excluded
   from this and every run until put back on payroll") and the consequences were
   silent: no payslip, no salary history, no ledger entry, no notification,
   their cash advance stopped being collected, and they dropped out of the BIR
   alphalist. After Compute the only trace was a count, with the names in a
   hover tooltip unreachable on a phone.

   Sharper still: a flag with no month meant that RECOMPUTING June today applied
   a decision made in August to June's run — and the unpaid-months card invites
   exactly that.

   WHAT IT IS NOW. `periodExcluded` is that period's own exclusion map, read
   from pay_runs/{month}.excluded. Of the five reasons a person is skipped, this
   is the ONLY one that is period-scoped. The four permanent ones — partner,
   removed from the system, production pay class, linked worker profile — stay
   AHEAD of it in the same order, because three of them are the double-pay guard
   and one is the owner's stated exception. Their 13 pinned tests are unchanged.

   ⚠ ORDER IS LOAD-BEARING. `removed` must keep winning over an exclusion, so a
   person who left the company reads as "removed", not as "excluded this month".
   ⚠ A MISSING periodExcluded MEANS PAY THEM. Callers that cannot read the run
   document must NOT silently pass {} — see computePayRun, which now refuses to
   compute on a failed read rather than paying someone a period says to skip. */
window.monthlyRunSkipReason = function(u, linkedUids, periodExcluded) {
  if (!u) return 'missing';
  // Money-critical — a fired/offboarded user (users/{uid}.removed === true, set
  // by People → Remove; js/app.js's auth gate already blocks THEIR login on this
  // flag) was once iterated and computed/disbursed like an active employee.
  if (u.removed === true)          return 'removed';
  if (u.payClass === 'production') return 'production';
  if (linkedUids && (linkedUids.has ? linkedUids.has(u.id) : linkedUids[u.id]))
                                   return 'linked-worker-profile';
  // Owner-requested (2026-08-07): not everyone on the staff list draws a
  // payroll. Before this, someone with no salary set was still computed — base
  // 0, but the statutory table still applied — so the roster showed a NEGATIVE
  // net pay (owner screenshot: four people at -P500.00, base P0.00 with SSS
  // -250 and PhilHealth -250 deducted from nothing).
  // Owner-requested (2026-08-07): not everyone on the staff list draws a
  // payroll. Before this, someone with no salary set was still computed — base
  // 0, but the statutory table still applied — so the roster showed a NEGATIVE
  // net pay (owner screenshot: four people at -P500.00, base P0.00 with SSS
  // -250 and PhilHealth -250 deducted from nothing).
  //
  // Now read from THIS PERIOD's map rather than a flag on the person. An entry
  // may be `true` or a reason string; anything falsy is not an exclusion, so a
  // stale `false` left behind by a put-back cannot skip anyone.
  if (periodExcluded) {
    const e = (typeof periodExcluded.get === 'function') ? periodExcluded.get(u.id) : periodExcluded[u.id];
    if (e) return 'excluded' + (typeof e === 'string' && e ? ': ' + e : '');
  }
  return null;
};

/* Read one period's exclusion map. Returns null — NOT {} — when the run
   document could not be READ, so the caller can tell "nobody is excluded" apart
   from "I do not know who is excluded". Those are the same shape and opposite
   meanings, and this app collapses denials into empty results everywhere else,
   which on a pay run would mean paying someone the period says to skip. */
window.periodExclusionsFor = async function(month) {
  try {
    const d = await db.collection('pay_runs').doc(month).get();
    if (!d.exists) return {};                      // no run yet = nobody excluded yet
    return (d.data() || {}).excluded || {};
  } catch (_) { return null; }                     // could not read — caller must stop
};

// window.buildPayRunLines — READ-ONLY line builder for a month, extracted
// VERBATIM out of computePayRun below (PAYROLL-LIVE-SPEC-2026-08-11 §4.4, D2:
// one pipeline, two callers). Same inputs, same maths, same skip reasons as
// the writer: computePayRun calls this and then writes; the live view
// (window.Payroll.preview, js/payroll.js) calls this and writes NOTHING.
// `overrides`/`policy` are read from the existing pay_runs/{month} doc when
// not passed — computePayRun already reads that doc for its own state gate
// and passes them in so this does not read it twice; preview() calls this
// bare, so it does its own (read-only) lookup here.
window.buildPayRunLines = async function(month, { policy, overrides } = {}) {
  let runPolicy = policy;
  let overridesEff = overrides;
  if (overridesEff === undefined) {
    const prevSnap = await db.collection('pay_runs').doc(month).get().catch(()=>null);
    const prev = (prevSnap && prevSnap.exists) ? prevSnap.data() : {};
    overridesEff = prev.overrides || {};
    if (runPolicy == null) runPolicy = prev.payPolicy || null;
  }
  // TASK-BASED-PAY-SPEC-2026-08-12 §6.2 — the precedence chain's third rung:
  //   explicit `policy` argument -> pay_runs/{month}.payPolicy -> this settings
  //   doc -> 'flat'.
  // Read ONLY when the first two rungs came back empty (i.e. a month never
  // prepared before) — fresh, no dbCachedGet, because a pay-deciding switch
  // must never be answered from a stale cache. A failed read THROWS rather
  // than guessing (same refusal stance as periodExcluded just below): guessing
  // 'flat' here could silently withhold task-based pay nobody actually
  // switched off; guessing 'taskbased' could apply a policy nobody confirmed.
  if (runPolicy == null) {
    let settingsSnap;
    try {
      settingsSnap = await db.collection('settings').doc('payrollOfficePolicy').get();
    } catch (err) {
      throw new Error('Could not read the pay method setting — nothing was worked out. Try again in a moment.');
    }
    const storedPolicy = (settingsSnap && settingsSnap.exists) ? (settingsSnap.data() || {}).policy : null;
    if (storedPolicy != null && window.PAY_POLICY_VALUES && window.PAY_POLICY_VALUES.indexOf(storedPolicy) === -1) {
      throw new Error('The pay method setting holds a value the app does not know — nothing was worked out. Fix it on the Gov Rates screen.');
    }
    runPolicy = storedPolicy || 'flat';
  }
  overridesEff = overridesEff || {};

  const usersSnap = await fetchUsersWithPayroll();
  // ONE definition, in js/config.js — this was a hand-duplicated copy of the
  // HR roster's identical predicate, i.e. two copies of a rule that decides
  // who gets paid. Now also covers the Partners department, which neither copy
  // did (owner ruling 2026-08-12: no Brilliant Steel or Partners on payroll).
  const isExternalPartner = (u) => window.isExternalPartnerUser(u);
  const allStaff = usersSnap.docs.map(d=>({id:d.id,...d.data()})).filter(u=>!isExternalPartner(u));

  // A regular-payroll uid can ALSO be paid weekly via a worker_profiles doc
  // (v12 WS20 D3, structural bridge — worker_profiles.linkedUid). Hard-skip
  // both routes into the monthly run so nobody is paid twice.
  const wpSnap = await db.collection('worker_profiles').get().catch(()=>({docs:[]}));
  const linkedUids = new Set(
    wpSnap.docs.map(d=>d.data()).filter(p=>p.status!=='inactive' && p.linkedUid).map(p=>p.linkedUid)
  );

  // THIS MONTH's exclusions (owner ruling 2026-08-10 — period-scoped, not a flag
  // on the person). Read BEFORE any line is built, and REFUSE on a failed read:
  // returning null here means "I could not find out who is excluded", which is
  // not the same as "nobody is excluded" even though both are falsy. Computing
  // (or PREVIEWING) through a denial would pay/show someone this period says to
  // skip — the exact silent-zero failure this app collapses into everywhere
  // else. A projection over an unreadable exclusion list is as dishonest as a
  // run over one, so this stays inside the builder for both callers.
  const periodExcluded = await window.periodExclusionsFor(month);
  if (periodExcluded === null) {
    throw new Error('Could not read this month\'s payroll exclusions — nothing was computed. Try again in a moment.');
  }

  // STATUTORY-BY-STATUS-SPEC-2026-08-12 — the President-gated switch that
  // decides whether employment status can exempt SSS/PhilHealth/Pag-IBIG.
  // Read fresh (no dbCachedGet — a payroll-deciding switch must never be a
  // stale cache read) and THROW on a failed read, same refusal stance as the
  // exclusions read just above: guessing "off" would silently restore
  // deductions for someone the report showed as exempt; guessing "on" would
  // apply a rule nobody confirmed.
  const statusRule = await window.statutoryStatusRuleOn();

  const skipped = [];
  const employees = [];
  for (const u of allStaff) {
    const reason = window.monthlyRunSkipReason(u, linkedUids, periodExcluded);
    if (reason) { skipped.push({ uid:u.id, name:u.displayName||u.email, reason }); continue; }
    employees.push(u);
  }
  employees.sort((a,b)=>(a.displayName||'').localeCompare(b.displayName||''));

  // Bulk-fetch once — avoids N+1 reads across the whole run.
  // PERF-WAVE1 WP9 — 'tasks-all' is an existing shared dbCachedGet key (also
  // used by dashboards.js, tasks.js, people.js); routing this scan through it
  // means a Compute run that follows a recent task-tab visit skips the whole-
  // collection read. 30s TTL; existing task write paths already call
  // dbCacheInvalidate('tasks-all') (tasks.js, approvals.js, design.js) so this
  // scan can go stale for at most one TTL window during a live edit, same
  // staleness bound the key already carries everywhere else it's used.
  const [tasksSnap, kpiTargetsSnap] = await Promise.all([
    dbCachedGet('tasks-all', () => db.collection('tasks').get(), 30000).catch(()=>({docs:[]})),
    db.collection('kpi_targets').get().catch(()=>({docs:[]}))
  ]);
  const allTasks = tasksSnap.docs.map(d=>({id:d.id,...d.data()}));
  const kpiTargetsMap = Object.fromEntries(kpiTargetsSnap.docs.map(d=>[d.id, d.data()]));

  const lines = await Promise.all(employees.map(async (emp) => {
    const userTasks = allTasks.filter(t => Array.isArray(t.assignedTo) ? t.assignedTo.includes(emp.id) : t.assignedTo === emp.id);
    // Payroll recall spec §A3.4 — month-scoped KPI. Replaces the old inline
    // "entire task history as it exists today" scoring (recomputing June in
    // August used to silently score August's live task state onto June's
    // pay). kpi_targets.deliverableScore has no history of its own — a
    // recomputed old month still uses TODAY's deliverable score; use a §C
    // Adjust override on a specific employee/month if that's materially
    // wrong for a delayed run.
    const kpiTargetD = kpiTargetsMap[emp.id] || {};
    const kpiScore = window.computeKpiForMonth(userTasks, month,
        kpiTargetD.deliverableScore, window.taskDoneMonth, window.taskCreatedMonth);
    // PAYROLL-ROSTER-ACCRUAL-2026-08-13 — additive DISPLAY metadata only.
    // window.kpiMonthBreakdown (js/pay-policy.js) mirrors computeKpiForMonth's
    // own in/out-of-scope loop to hand back the raw "doneInM of inScopeCount"
    // tasks the blended kpiScore above was built from, so the Payroll roster
    // can show its working ("tasks finished vs assigned") instead of a bare
    // percentage. kpiScore itself — computed above, on the frozen call — is
    // the ONLY number that ever reaches computePayLine; this breakdown is
    // never read by any money computation.
    const kpiBreak = window.kpiMonthBreakdown
      ? window.kpiMonthBreakdown(userTasks, month)
      : { doneInM: null, inScopeCount: null };
    // v14 perf fix: these two reads are independent of each other (neither's
    // input depends on the other's output) — was two SEQUENTIAL awaits per
    // employee (on top of the whole employee list already running
    // concurrently via this outer Promise.all). Doesn't reduce the total
    // Firestore read count (that would need cross-employee batching — a
    // bigger redesign, flagged separately), but halves this line's own
    // per-employee latency.
    const [attScore, planResult] = await Promise.all([
      // §A2 — month-scoped attendance (same "recomputing an old month scored
      // today's attendance" bug, now fixed the same way as KPI above).
      window.getAttendanceScore ? window.getAttendanceScore(emp.id, month) : Promise.resolve(1),
      window.CashAdvance ? window.CashAdvance.planFor(emp.id, month) : Promise.resolve({ plan: [] })
    ]);
    // §C3 — per-line overrides. Real month-scoped kpiScore/attScore are
    // always computed above FIRST, regardless of any override — they feed
    // the override's audit-trail `original` snapshot (hr.js's Adjust modal)
    // and are exactly what "Reset to computed" restores.
    const ovr = overridesEff[emp.id];
    const empEff = ovr ? { ...emp, allowance: (ovr.allowance ?? emp.allowance), deductions: (ovr.otherDeductions ?? emp.deductions) } : emp;
    const kpiEff = ovr?.kpiScore ?? kpiScore;
    const attEff = ovr?.attScore ?? attScore;
    // STATUTORY-BY-STATUS-SPEC-2026-08-12 — a pure derivation ABOVE
    // computePayLine/resolveStatutoryEE (both frozen, never edited by this
    // spec). When inactive, empForPay === empEff, byte-identical to today.
    const plan = window.statutoryStatusPlan(empEff, statusRule.on, { engine: 'month' });
    const empForPay = plan.active ? { ...empEff, statConfig: plan.statConfig } : empEff;
    let line = window.computePayLine(empForPay, { month, policy: runPolicy, kpiScore: kpiEff, attScore: attEff, caPlan: planResult.plan, caBalance: planResult.caBalance });
    if (ovr) line = window.applyPayLineOverride(line, ovr);
    // v12 WS39 — freeze statutory IDs onto the computed line (do NOT touch
    // computePayLine itself, WS20's frozen math). Read live from payroll/{uid}.
    line.tinNum = emp.tinNum || ''; line.ssNum = emp.ssNum || '';
    line.phNum = emp.phNum || '';   line.pagibigNum = emp.pagibigNum || '';
    // Frozen traceability words (spec §7.1) — describe what the maths
    // actually did, survive on stored lines, never recomputed against a
    // later status edit.
    line.employmentStatus = plan.status;
    line.statutoryBasis = plan.words;
    line.statusFlag = plan.flag;
    // PAYROLL-ROSTER-ACCRUAL-2026-08-13 — the KPI working, frozen alongside
    // the other traceability fields above. Additive only; does not touch any
    // figure computePayLine returned.
    line.kpiBreakdown = {
      doneInM: kpiBreak.doneInM, inScopeCount: kpiBreak.inScopeCount,
      deliverableScore: (typeof kpiTargetD.deliverableScore === 'number') ? kpiTargetD.deliverableScore : null
    };
    return line;
  }));

  // Push each flagged line's words (name-prefixed) into the returned
  // warnings array so the live view surfaces them exactly like every other
  // engine-raised warning — the stored path needs nothing extra, since the
  // screen derives its problems from the frozen line fields above.
  const statusWarnings = lines
    .filter(l => l.statusFlag)
    .map(l => `${l.name}: ${l.statusFlag.words}`);

  // The monthly path had no warnings array before this spec — the live view
  // still needs the key so it can concat it with the weekly fold's own
  // warnings uniformly. Now carries only the status-rule's own flags: when
  // the switch is off (or nobody is flagged), this is [] exactly as before.
  return { lines, skipped, warnings: statusWarnings, payPolicy: runPolicy };
};

window.computePayRun = async function(month, { policy } = {}) {
  // Payroll recall spec §C3 — read any existing run doc FIRST, before any
  // other work. Two jobs: (1) fail fast if this month is past the editable
  // window (verified/disbursing/disbursed) — the UI already pre-checks this
  // (hr.js's Compute handler), but the engine itself must refuse a direct
  // call too; (2) carry forward this month's saved per-line overrides and
  // previously chosen pay policy so BOTH survive every recompute (a
  // recompute replaces lines[] wholesale, but overrides/payPolicy must not
  // silently reset).
  const prevSnap = await db.collection('pay_runs').doc(month).get().catch(()=>null);
  const prev = (prevSnap && prevSnap.exists) ? prevSnap.data() : {};
  if (prev.state === 'verified' || prev.state === 'disbursing' || prev.state === 'disbursed') {
    throw new Error('Run is ' + prev.state + ' — President must Reopen first.');
  }
  const overrides = prev.overrides || {};
  // TASK-BASED-PAY-SPEC-2026-08-12 §6.2 — defer to the builder's own
  // precedence chain (explicit arg -> pay_runs.payPolicy -> settings doc ->
  // 'flat') instead of pre-resolving 'flat' here, which would make the
  // settings rung permanently unreachable on the write path.
  const runPolicy = policy || prev.payPolicy || null;

  // The read-only half — see window.buildPayRunLines above. Same inputs, same
  // maths, same skip reasons the live view reads; this caller adds only the
  // write below.
  const built = await window.buildPayRunLines(month, { policy: runPolicy, overrides });
  const { lines, skipped } = built;

  const totalNet = lines.reduce((s,l)=>s+l.finalPay, 0);
  const currentUser = window.currentUser;
  await db.collection('pay_runs').doc(month).set({
    // built.payPolicy is the RESOLVED policy (never the possibly-null local
    // above) — writing the local would persist `null` on a brand-new month
    // resolved off the settings doc, losing which policy actually ran.
    month, state:'computed', payPolicy: built.payPolicy,
    employeeCount: lines.length, totalNet, lines, skipped,
    computedBy: currentUser?.uid, computedByName: window.userProfile?.displayName || currentUser?.email,
    computedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge:true });

  return { lines, totals: { totalNet, employeeCount: lines.length }, skipped };
};

window.disbursePayRun = async function(month, opts = {}) {
  const bankAcct = opts.bankAccount || { bankAccountId: null, bankAccountName: null };
  // Fail fast, before any write — firestore.rules only rejects the FINAL
  // state-flip to 'disbursed' for a non-president, which would otherwise let
  // the CA deductions/ledger posts below succeed first (a partial disburse).
  // OWNER RULING 2026-08-10: Finance may release a checked period — for BOTH
  // teams, because "treat disbursement of office and operations the same".
  // This was President-only while firestore.rules had ALREADY been widened to
  // the money tier, and while the weekly run let Finance release. So the monthly
  // half of "one press, both teams" was untrue: Finance pressed Pay and got
  // "Only the President can disburse payroll" from a check the server no longer
  // agreed with. Now matched to the rule it is enforced by.
  const _mayRelease = (typeof window.isMoneyPriv === 'function')
    ? window.isMoneyPriv()
    : (typeof isRealPresident === 'function' && isRealPresident());
  if (!_mayRelease) {
    Notifs.showToast('Only Finance or the President can release payroll.','error'); return;
  }
  // D10 hard block (v14 Wave 4 Batch F4) — disbursing actually moves money
  // using SSS/PhilHealth/Pag-IBIG/withholding figures baked into the frozen
  // run lines at Compute/Verify time. If those came from an unverified
  // placeholder statutory table (js/statutory-tables.js — every number in
  // there is marked PLACEHOLDER until an accountant signs off), every payslip
  // this run produces is legally wrong. Compute and Verify stay allowed
  // (they only produce numbers to review); this is the last gate before any
  // write happens, and it's a blocking dialog — not a dismissable toast —
  // because a toast is too easy to miss/ignore on a "disburse payroll" click.
  const _payYear = String(month||'').slice(0,4);
  const _statTable = window.STATUTORY && window.STATUTORY[_payYear];
  if (!_statTable || _statTable.verified !== true) {
    await window.confirmDialog({
      title: 'Payroll cannot be released yet',
      // Was: two buttons both reading "Understood", naming no way forward and
      // nobody who could provide one. The gate is right — paying real wages on
      // placeholder government rates, and remitting the wrong amounts, is worse
      // than paying late — but a safety gate with no route out is a dead end,
      // and this one blocked the Office Team payroll all year. There is now a
      // screen that satisfies it without a code deploy.
      html: true,
      message: 'The SSS, PhilHealth, Pag-IBIG and withholding figures for <strong>' + _payYear
        + '</strong> are still the placeholders the app ships with. Paying on them would pay the wrong amounts '
        + 'and remit the wrong amounts to the government, so releasing is blocked.<br><br>'
        + '<strong>To unblock it:</strong> whoever files your BIR returns confirms the ' + _payYear
        + ' rates in <strong>Finance → Taxes &amp; BIR → Gov Rates</strong>. It takes a few minutes and needs no update to the app.',
      confirmLabel: 'Open Gov Rates', cancelLabel: 'Not now', danger: true
    }) && typeof window.renderFinance === 'function'
      && window.renderFinance(window.currentUser, window.currentRole, 'Gov Rates');
    return;
  }
  const runRef = db.collection('pay_runs').doc(month);
  const currentUser0 = window.currentUser;
  // Transactional lock (Part E Phase 11): the transaction itself IS the lock —
  // a concurrent second call re-reads the doc inside ITS OWN transaction, sees
  // 'disbursing' (not 'verified'), and throws before any money write happens.
  // A 'disbursing' run may be resumed by the same locker or the president —
  // the deterministic PAY-{month}-{uid} refs below make re-running idempotent.
  const run = await db.runTransaction(async (tx) => {
    const snap = await tx.get(runRef);
    if (!snap.exists) throw new Error('No pay run found for this month.');
    const d = snap.data();
    if (d.state === 'verified') {
      tx.update(runRef, {
        state: 'disbursing',
        disbursingAt: firebase.firestore.FieldValue.serverTimestamp(),
        disbursingBy: currentUser0?.uid || null,
        disbursingByName: window.userProfile?.displayName || currentUser0?.email || null
      });
      return d;
    }
    if (d.state === 'disbursing') {
      const isLocker = d.disbursingBy === currentUser0?.uid;
      const canResume = isLocker || (typeof isRealPresident === 'function' && isRealPresident());
      if (canResume) return d; // resume — idempotent re-run, no re-lock write needed
      throw new Error(`This run is locked mid-disbursement (started by ${d.disbursingByName||d.disbursingBy||'another session'}). Ask the President to Reopen it after investigating.`);
    }
    throw new Error(`This run is not in Verified state (currently: ${d.state||'draft'}).`);
  });
  // ⚠ RE-FILTER AGAINST THIS MONTH'S EXCLUSIONS BEFORE PAYING ANYONE.
  // The lines were FROZEN at Compute. firestore.rules deliberately permits an
  // exclusion write while a run is 'verified', so this sequence is legal and was
  // silently wrong:
  //     Compute -> Verify -> remove someone -> Disburse
  // The person still had a frozen line, so they got a payslip, their cash
  // advance was collected and their expense leg posted — the removal ignored
  // entirely, because nothing between Compute and payment re-read `excluded`.
  //
  // Identical to the defect found and fixed on the WEEKLY side (2026-08-10,
  // js/payroll-weekly.js); this is its monthly twin, and it exists because the
  // two runs were written independently — which is exactly what the owner's
  // unify ruling removes.
  //
  // It has been LATENT only because disbursement is blocked by the unverified
  // statutory tables (see the gate below). Fixed BEFORE that gate can open, so
  // loading verified rates cannot expose it.
  const _runExcl = (run && run.excluded) || {};
  const _isExcl = (uid) => {
    const e = (typeof _runExcl.get === 'function') ? _runExcl.get(uid) : _runExcl[uid];
    return !!e;
  };
  const _allLines = run.lines || [];
  const lines = _allLines.filter(l => l && !_isExcl(l.uid || l.userId || l.id));
  const _heldBack = _allLines.length - lines.length;
  if (_heldBack > 0) {
    console.info('[payroll] ' + _heldBack + ' line(s) held back — removed from ' + month + ' after this run was computed.');
  }
  if (!lines.length) { Notifs.showToast('This run has no computed lines.','error'); return; }

  // Checked once, before any write — a closed month can't be disbursed (v12 WS12).
  await window.assertPeriodOpen(month + '-01');

  // TASK-BASED-PAY-SPEC-2026-08-12 §8.4 — the minimum-wage floor, beside the
  // statutory-verified refusal above. Read fresh (no dbCachedGet — same
  // refusal stance as every other pay-deciding read in this function): a
  // failed read throws rather than proceeding on an unknown floor. When the
  // floor is NOT configured, this is inert BY DESIGN (§8.1 — the owner was
  // told loudly on the Gov Rates screen and in the roster warnings; the app
  // never invents the number). Policy-agnostic on purpose (§8.3/§14 Q4) — a
  // 'flat' salary below the floor is caught here too, not only a scaled one.
  let _wageFloorDoc;
  try {
    _wageFloorDoc = await db.collection('settings').doc('payrollWageFloor').get();
  } catch (err) {
    Notifs.showToast('Could not read the saved minimum wage — nothing was paid. Try again in a moment.', 'error');
    return;
  }
  const _floorMonthly = (_wageFloorDoc && _wageFloorDoc.exists) ? (_wageFloorDoc.data() || {}).monthlyFloor : null;
  if (_floorMonthly != null && typeof window.wageFloorCheck === 'function') {
    const _below = lines
      .map(l => ({ l, chk: window.wageFloorCheck(l, _floorMonthly) }))
      .filter(x => x.chk.checked && !x.chk.ok);
    if (_below.length) {
      const _names = _below.map(x => `${x.l.name} ${window.fmtPeso ? window.fmtPeso(x.chk.earned) : ('₱' + x.chk.earned)}`).join(', ');
      Notifs.showToast(
        `${_below.length} people are below the saved minimum wage of ${window.fmtPeso ? window.fmtPeso(_floorMonthly) : ('₱' + _floorMonthly)} for the month: ${_names}. Adjust their pay from their row, or correct the saved minimum on the Gov Rates screen. Nothing was paid.`,
        'error'
      );
      return;
    }
  }

  const currentUser = window.currentUser;
  const monthLabel  = window.fmtMonthLabel(month);

  // ── 1. Freeze the salary_history mirror (owner-readable, unlike pay_runs) ──
  const shBatch = db.batch();
  for (const line of lines) {
    const shRef = db.collection('salary_history').doc(`${line.uid}_${month}`);
    shBatch.set(shRef, {
      userId: line.uid, userName: line.name, month,
      salary: line.base, allowance: line.allowance, deductions: line.otherDeductions,
      // PAY-EXPLANATION-PARITY-2026-08-13 — additive, display-only mirror of
      // this line's one-off amounts (js/payroll.js's PC.applyOneOffs already
      // froze these onto `line` when the period was folded). Never read by
      // any money computation and never touches `deductions`/`finalPay`
      // above, which stay exactly as they were before this field existed.
      //
      // WHY THIS WAS MISSING MATTERS: `deductions` here is `otherDeductions`
      // AFTER a one-off deduction is folded in (money-core order), but
      // `salary` (`line.base`) is NEVER touched by a one-off EARNING fold —
      // only `gross`/`netBeforeCA`/`finalPay`/`effectiveGross` are. Without
      // these two fields, js/screens/dashboards.js's renderPersonalFinance
      // had no way to tell a frozen month's "How this take-home was worked
      // out" ledger that a one-off earning (e.g. a bonus) had been added —
      // its steps summed to less than finalPay by exactly that amount, and
      // the reconciliation guard fired a false "these figures do not add up"
      // warning on a perfectly correct payslip. js/screens/payroll.js's own
      // roster card never had this bug: PC.normalizeLine already carries
      // `oneOffs`/`oneOffEarnings`/`oneOffDeductions` on the LIVE pay_runs
      // line it reads from, which salary_history (the disbursed, employee-
      // readable mirror) never mirrored. This closes that gap for every
      // month disbursed from here on; a month frozen before this change
      // simply has no one-off figures to show (reads as 0, unchanged from
      // today — never a guess at what an old bonus was).
      oneOffEarnings: line.oneOffEarnings || 0,
      oneOffDeductions: line.oneOffDeductions || 0,
      // The withheld/unearned split this line was booked with, frozen alongside
      // everything else so a payslip reprint or a later audit can tell which
      // half of "Other Deductions" became a payable and which never was an
      // expense. Absent on pre-2026-08 rows -> all withheld, the old behaviour.
      deductionsUnearned: line.unearnedDeductions || 0,
      deductionsWithheld: (line.withheldDeductions != null ? line.withheldDeductions : (line.otherDeductions || 0)),
      sss: line.sss, philhealth: line.philhealth, pagibig: line.pagibig, tax: line.tax,
      philHealth: line.philhealth, pagIbig: line.pagibig, // legacy mixed-case mirror (transition — v12 WS21 decision 6)
      er: line.er, kpiScore: line.kpiScore, attScore: line.attScore, perfFactor: line.perfFactor,
      // TASK-BASED-PAY-SPEC-2026-08-12 §9.2 — additive field on an unpinned
      // doc shape; ?? null on every other policy (the key is absent on the
      // source line for 'flat'/'performance', §2.4), so payBasisSentence's
      // "no `preMultiplierNet`" fallback branch renders correctly for those.
      preMultiplierNet: line.preMultiplierNet ?? null,
      policy: line.policy, runMonth: month,
      caDeducted: line.caPlanned, netPay: line.netBeforeCA, finalPay: line.finalPay,
      // v12 WS39 — mirror the frozen statutory IDs so a historical salary_history
      // doc (payslip reprint) still carries the TIN/SSS/PhilHealth/Pag-IBIG that
      // were on file at disburse time.
      tinNum: line.tinNum || '', ssNum: line.ssNum || '', phNum: line.phNum || '', pagibigNum: line.pagibigNum || '',
      // Payroll recall spec §C5 — flag an overridden line on the
      // employee-visible payslip record. Every downstream figure (this
      // mirror, the PAY- ledger debit, netCashAgg below) already reads
      // line.finalPay/effectiveGross/etc., which §C3/§C2 already shifted
      // coherently — this is purely an additive audit flag, no money-math change.
      ...(line.overridden ? { overridden: true, overrideNote: line.overrideMeta?.note || '' } : {}),
      // "Note to employee" feature — mirror whatever HR left on
      // pay_runs/{month}.employeeNotes[line.uid] onto this OWNER-READABLE doc
      // so the employee can actually see it (pay_runs itself is finance/admin-
      // only per firestore.rules). Purely additive/display-only: never read by
      // computePayLine/computePayRun, never touches finalPay or any ledger
      // figure above/below. After this point pay_runs is rules-immutable, so a
      // post-disburse correction edits THIS field directly (hr.js's
      // openEmployeeNoteModal) — salary_history's own update rule has no
      // state gate, unlike pay_runs.
      ...(run.employeeNotes && run.employeeNotes[line.uid] ? { hrNote: run.employeeNotes[line.uid] } : {}),
      recordedBy: currentUser?.uid, recordedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge:true });
  }
  await shBatch.commit();

  // ── 2. Cash-advance deductions — THE only balance mutation, via the one
  //       shared service. financeDeleteCascade reverses caDeductions[] later.
  // v14 perf fix: each employee's CA deduction only ever touches THAT
  // employee's own cash_advances docs (line.caPlan's caId values are unique
  // per uid — see CashAdvance.planFor/deduct, js/config.js), so there is no
  // shared-document contention across employees. Was a plain sequential
  // for-loop (one Firestore read+batch per employee, one at a time); now
  // concurrent, same as computePayRun's own per-employee Promise.all above.
  // Money-critical fix (multi-month payroll recall) — CashAdvance.deduct
  // CLAMPS every installment to the CA's CURRENT balance
  // (`Math.min(cur.balance, p.amount)`, js/config.js), which can be LESS than
  // the FROZEN `line.caPlanned`/`line.caPlan` computePayRun locked in at
  // Compute time if the CA's balance moved between Compute and Disburse — a
  // manual "Record Payment", a different payroll run touching the same CA, or
  // recalling/re-disbursing an old month after a later month already reduced
  // it. Capture what was ACTUALLY deducted per employee (actualCaByUid) here
  // so the ledger legs below post the real number instead of the stale
  // frozen plan — see the aggregation loop for the reconciliation + the
  // needsReview flag left on salary_history when the two disagree.
  const actualCaByUid = {};
  // …and how much of that was INTEREST rather than principal, so the CADEDUCT
  // leg below credits the receivable only what approve() actually debited.
  const actualCaInterestByUid = {};

  // ── R1 ROOT CAUSE (money-critical) — actualCa collapsed to 0 on a RESUME ──
  // CashAdvance.deduct is idempotent PER MONTH: js/config.js:2578 skips any CA
  // whose payments[] already carries {source:'payroll', month:<this month>} and
  // therefore returns [] on a second pass over the SAME frozen lines. That made
  // `actualCaByUid[uid]` 0 on every Resume Disburse (hr.js's "Resume Disburse"
  // button) and on every reopen→recompute→re-disburse of a month whose CA batch
  // had already committed — even though the employees' CA balances HAD been
  // reduced and the money HAD been collected. Downstream that produced two real
  // money errors below: caPlannedAgg went to 0 (so the CADEDUCT credit that
  // retires 'Advances to Employees' vanished — the receivable never comes down)
  // and netCashAgg grew by the same amount (so Cash was credited more than
  // actually left the bank). It also raised a bogus caReconcile "shortfall"
  // flag for the full installment on every resume.
  //
  // FIX: payments[] on the cash_advances doc is the AUTHORITATIVE record of what
  // this month's payroll actually collected — it survives across passes, which
  // deduct()'s return value does not. When this run may have been disbursed
  // before, take the per-CA amount from THIS call when we have it, and otherwise
  // recover it from the CA's recorded payments[].
  //
  // SCOPED DELIBERATELY: a run that has never entered disburse (state 'verified'
  // and never reopened) CANNOT have a prior payroll payment for this month, so
  // it takes no extra read and behaves byte-identically to before. reopenedAt is
  // sticky (computePayRun/reopenPayRun both write {merge:true} and never clear
  // it), and 'disbursed' is terminal, so this flag is a safe over-approximation:
  // if it were ever wrong it would be wrong in the direction of the OLD
  // behaviour, never worse.
  const isRerunOfThisMonth = run.state === 'disbursing' || !!run.reopenedAt;

  // Sum what a PREVIOUS pass already recorded against this month for the CAs in
  // this plan. Failure-tolerant on purpose (see R2's reasoning below): a read
  // that fails falls back to the frozen plan amount — the same figure the
  // employee-visible salary_history/payslip already shows — rather than
  // aborting a disburse that has already moved money.
  // Returns {total, interest}: the interest half is needed because a repayment
  // credits 'Advances to Employees' only its PRINCIPAL portion (approve() only
  // debited that much) and books the rest as earned interest income. On the
  // recovery path the split is recomputed from the CA doc's own principal /
  // totalPayable via window._caSplitPayment, so a Resume Disburse reproduces
  // exactly what the original pass would have posted.
  const recoverPostedCa = async (caPlan, postedNowByCa) => {
    let sum = 0, interest = 0;
    const _split = (amt, ca, before) => (typeof window._caSplitPayment === 'function')
      ? window._caSplitPayment(amt, ca, before) : { principal: amt, interest: 0 };
    for (const p of (caPlan || [])) {
      if (!p || !p.caId) continue;
      if (postedNowByCa[p.caId] != null) {                      // deducted by THIS call
        sum += postedNowByCa[p.caId].amount;
        interest += postedNowByCa[p.caId].interest;
        continue;
      }
      let snap = null;
      try { snap = await db.collection('cash_advances').doc(p.caId).get(); }
      catch (err) {
        console.error('disbursePayRun: could not re-read cash advance', p.caId, '— falling back to the frozen plan amount', err);
        sum += (p.amount || 0);   // no doc to split against — treat as all principal
        continue;
      }
      if (!snap.exists) continue; // CA gone — nothing was collected against it
      const ca = snap.data();
      // Walk payments[] IN ORDER tracking the running collected total: this
      // doc's `balance` is already post-payment here, so the helper's default
      // (totalPayable - balance) would mis-place every payment on the schedule.
      // Only the rows for THIS month are counted, but every earlier row still
      // advances the cursor.
      let collected = 0;
      (ca.payments || []).forEach(pm => {
        const amt = (pm && pm.amount) || 0;
        if (pm && pm.source === 'payroll' && pm.month === month) {
          sum += amt;
          interest += _split(amt, ca, collected).interest;
        }
        collected = +(collected + amt).toFixed(2);
      });
    }
    return { total: +sum.toFixed(2), interest: +interest.toFixed(2) };
  };

  await Promise.all(lines.map(async (line) => {
    if (line.caPlan && line.caPlan.length) {
      const res = await window.CashAdvance.deduct(line.uid, month, line.caPlan, currentUser?.uid);
      let actual   = res.reduce((s,r)=>s+(r.amount||0), 0);
      // deduct() reports the principal/interest split per loan (it is the only
      // place the CA doc is in scope); a doc predating totalPayable, or a 0%
      // advance, reports no interest and behaves exactly as before.
      let actualInt = res.reduce((s,r)=>s+(r.interest||0), 0);
      if (isRerunOfThisMonth) {
        const postedNowByCa = {};
        res.forEach(r => {
          const e = postedNowByCa[r.caId] || (postedNowByCa[r.caId] = { amount: 0, interest: 0 });
          e.amount += (r.amount || 0); e.interest += (r.interest || 0);
        });
        const rec = await recoverPostedCa(line.caPlan, postedNowByCa);
        actual = rec.total; actualInt = rec.interest;
      }
      actualCaByUid[line.uid] = actual;
      actualCaInterestByUid[line.uid] = +actualInt.toFixed(2);
      if (res.length) await db.collection('salary_history').doc(`${line.uid}_${month}`)
        .set({ caDeductions: res }, { merge:true }).catch(()=>{});
    }
  }));

  // ── 3. Ledger — gross-with-liability-legs (v12 WS21 decision 11). Per-employee
  //       Payroll Expense debits (cost-center granularity); aggregate per-agency
  //       payable + cash credits (remittance/bank-transfer granularity). Balances:
  //       Σ(effectiveGross)+Σ(erShare) == Σ(statutory+er)+Σ(effectiveGross-statutory).
  // v13 Phase 13/14 — routed through the single Ledger.upsertByRef service
  // (transactional read-modify-write, deterministic id, legacy-ref-aware).
  // The prefetch-cache micro-optimization is gone; correctness (no fail-open
  // dedupe) matters more here than shaving one query per ref.
  const _KNOWN_PAY_FIELDS = ['date','type','accountType','account','category','description','amount','source','refNumber','addedBy','addedByName','createdAt'];
  const upsertLedger = async (ref, entry) => {
    // Any field beyond the known set (e.g. bankAccountId/bankAccountName/bankFlow
    // from BankAccounts.tag()) rides through as `extra` unchanged.
    const extra = {};
    Object.keys(entry).forEach(k => { if (!_KNOWN_PAY_FIELDS.includes(k)) extra[k] = entry[k]; });
    await window.Ledger.upsertByRef(ref, () => ({
      ref, date: entry.date, kind: entry.type, accountType: entry.accountType,
      account: entry.account, category: entry.category, description: entry.description,
      amount: entry.amount, source: entry.source, extra
    }));
  };

  // ── Defect 8 (statutory-config spec) — a leg that computes to ZERO must
  //    CLEAR a previously-posted leg carrying the same ref, never silently
  //    skip the write.
  //
  //    WHY THIS WAS LATENT UNTIL NOW: computeStatutory clamps the SSS MSC up
  //    to mscMin (js/statutory-tables.js:53-54), so line.er was always ≳₱750
  //    even at gross 0, and every agency aggregate was always positive — the
  //    old `if (erTotal > 0)` / `if (amount <= 0) return` guards were
  //    unreachable-as-false. `statConfig.{k} === 'exempt'` (resolveStatutoryEE,
  //    js/money-core.js) makes a genuine ₱0 reachable for the FIRST time, and
  //    upsertByRef is only ever called for the legs we DO post — so nothing
  //    else in the system overwrites a row this run no longer wants.
  //
  //    THE FAILING SEQUENCE this closes: Disburse posts SSSPAY-{month} and the
  //    per-uid -ER debits, then aborts before the terminal state flip below
  //    (browser closed / network drop). The President unlocks the stuck
  //    'disbursing' run via reopenPayRun (which does not touch the ledger),
  //    HR sets everyone to Exempt, and Compute→Verify→Disburse runs again.
  //    The per-uid PAY- debits are overwritten (they have no guard), but the
  //    stale SSSPAY credit and stale -ER debits used to SURVIVE — a phantom
  //    liability for a remittance that is no longer owed, and Payroll Expense
  //    overstated, i.e. the month's trial balance stops netting to zero.
  //
  //    CHOICE — ZERO IN PLACE, not delete, and not a reversing/contra entry:
  //      (a) `allow delete` on /ledger is PRESIDENT-ONLY (firestore.rules
  //          :1514). Disburse is reachable by money-tier finance admins, so a
  //          raw .delete() here would be permission-denied for exactly the
  //          people who run payroll — it would fail (or, if swallowed, leave
  //          the stale row anyway, which is the bug). Ledger.remove() is worse:
  //          it files a President APPROVAL REQUEST (financeDelete) and returns
  //          without deleting anything, so the books would stay wrong until a
  //          human clicked something.
  //      (b) This ledger models corrections as OVERWRITE-IN-PLACE on a
  //          deterministic ref (that is the whole point of Ledger.upsertByRef —
  //          see resyncLedgerForSource, :435), never as contra entries. A
  //          reversing entry would also break re-run idempotency: disburse
  //          twice and you would post two reversals against one original.
  //      (c) Zeroing goes through the SAME upsertByRef path, so finance_rollup
  //          self-corrects for free (old row synced at -1, the ₱0 row at +1 —
  //          net effect: the old amount is backed out, count unchanged).
  //    IDEMPOTENT EITHER WAY: re-running Disburse rebuilds the identical ₱0
  //    row (deterministic ref → same doc, {merge:true}); a nil leg that was
  //    never posted stays absent no matter how many times this runs.
  //
  //    The existence probe keeps the ledger clean: a nil leg that has NO row
  //    yet is simply not written (an all-exempt company must not accrue four
  //    junk ₱0.00 rows every month forever).
  //
  //    R2 — THE PROBE MUST NEVER BE ABLE TO ABORT A DISBURSE. It runs AFTER
  //    salary_history is frozen and AFTER the cash advances have been deducted,
  //    i.e. after real money has moved. The first cut of this helper copied
  //    Ledger._findLegacyRef's "throws propagate — never treated as empty"
  //    contract, but that contract belongs to a read whose failure aborts
  //    BEFORE any write; here it converts a transient offline/permission blip
  //    into a PARTIALLY-APPLIED disburse (CA balances reduced, ledger legs
  //    missing, run stuck in 'disbursing'). It also made the read reachable on
  //    a completely ordinary run: taxAgg === 0 is routine at these salary
  //    levels, so every disburse started issuing a query the old
  //    `if (amount <= 0) return` never issued.
  //
  //    TWO GUARDS, both failing in the SAME safe direction — "leave the row
  //    alone", which is exactly the pre-existing (HEAD) behaviour:
  //      1. Skip the probe entirely unless this month may already have ledger
  //         rows (isRerunOfThisMonth, derived above). A stale row for these
  //         deterministic month-scoped refs can only exist if disbursePayRun
  //         already ran for THIS month — which requires state 'disbursing'
  //         (aborted mid-run) or a reopen (reopenedAt, sticky). Nothing else in
  //         the codebase writes SSSPAY-/PHPAY-/HDMFPAY-/WHTPAY-/CADEDUCT-/
  //         NETPAY-/PAY-*-ER refs (bir.js only READS them). So a first-ever
  //         disburse issues ZERO extra reads and is byte-identical to HEAD.
  //      2. If the probe does run and fails, treat it as "no prior row" and
  //         skip the write. Failing to clear a stale row leaves the OLD
  //         behaviour standing (a known, separately-visible bookkeeping error a
  //         human can correct); aborting here leaves money half-moved.
  const upsertLedgerOrClear = async (ref, entry) => {
    if ((entry.amount || 0) > 0) { await upsertLedger(ref, entry); return; }
    if (!isRerunOfThisMonth) return; // this month has never been disbursed — no stale row can exist
    const prior = await db.collection('ledger').where('refNumber','==',ref).limit(1).get()
      .catch(err => { console.error('disbursePayRun: stale-leg probe failed for', ref, '— leaving any existing row untouched', err); return null; });
    if (!prior || !prior.docs.length) return; // nothing was ever posted for this ref — stay out of the ledger
    await upsertLedger(ref, { ...entry, amount: 0,
      description: `${entry.description} — ₱0.00 (nil this run; previously posted amount cleared)` });
  };
  const addedByName = window.userProfile?.displayName || currentUser?.email;

  // v14 fix (money-critical — see caPlannedAgg's ledger leg below for the
  // full worked-example proof): netCashAgg used to be
  // Σ(effectiveGross - statutoryTotal), which is the employee's pay BEFORE
  // otherDeductions/caPlanned — but money-core.js's finalPay (the actual
  // take-home cash) is netBeforeCA - caPlanned, i.e. gross minus statutory
  // minus otherDeductions minus caPlanned too. Every run with any CA
  // deduction overstated the Cash credit by exactly Σcaplanned (compounding
  // every month in Balance Sheet/Bank Rec). Fixed by subtracting caPlanned
  // here and posting the removed amount as its own ledger leg below —
  // crediting the SAME 'Advances to Employees' asset account
  // CashAdvance.approve debits at release (js/config.js) — so debits still
  // equal credits AND the Cash figure now reflects what actually left the
  // bank.
  //
  // 2026-08-07 — the otherDeductions half of this, which the note above left
  // open ("its correct offsetting account is undefined in the current COA"),
  // is now RESOLVED: the owner ruled that Other Deductions is used for two
  // different things depending on the employee, so money-core splits it into
  // withheldDeductions (money the company holds and owes onward -> a real
  // liability) and unearnedDeductions (absence/tardiness -> never a company
  // expense, so it is already out of effectiveGross). The Cash credit is now
  // stated directly as what actually leaves the bank — netBeforeCA - actualCa,
  // which IS money-core's finalPay when the CA plan collects in full — instead
  // of being re-derived from effectiveGross, and the withheld part gets its own
  // credit leg below. Identity (flat policy, per line):
  //   debit  effectiveGross            = gross - unearned
  //   credit statutory + actualCa + (netBeforeCA - actualCa) + withheld
  //        = statutory + (gross - statutory - otherDed) + (otherDed - unearned)
  //        = gross - unearned                                        ✓ balances
  // Legacy frozen lines (computed before the split existed) carry no
  // withheldDeductions field; they fall back to the full otherDeductions, which
  // is exactly the all-withheld default and balances identically.
  let sssAgg=0, phAgg=0, piAgg=0, taxAgg=0, netCashAgg=0, caPlannedAgg=0, withheldAgg=0, caInterestAgg=0;
  const caReconcileFlags = []; // {uid, name, shortfall} — surfaced to Finance/President below
  for (const line of lines) {
    sssAgg += (line.sss||0) + (line.er?.sss||0);
    phAgg  += (line.philhealth||0) + (line.er?.philhealth||0);
    piAgg  += (line.pagibig||0) + (line.er?.pagibig||0);
    taxAgg += (line.tax||0);
    // v14 money-critical fix — use what CashAdvance.deduct ACTUALLY posted
    // (actualCaByUid, captured above), not the frozen line.caPlanned, for
    // every ledger money leg below. actualCa <= plannedCa always (deduct()
    // only ever clamps DOWN to the CA's live balance, never up) — no line
    // with a plan can end up posting MORE than money-core.js's frozen figure.
    const plannedCa = line.caPlanned||0;
    const actualCa  = (line.caPlan && line.caPlan.length) ? (actualCaByUid[line.uid]||0) : plannedCa;
    const caShortfall = +((plannedCa - actualCa).toFixed(2));
    caPlannedAgg += actualCa;
    caInterestAgg += (line.caPlan && line.caPlan.length) ? (actualCaInterestByUid[line.uid]||0) : 0;
    // What actually leaves the bank for this employee. Stated directly rather
    // than re-derived from effectiveGross: the old form
    // (effectiveGross - statutoryTotal - actualCa) silently equals
    // netBeforeCA + otherDeductions - actualCa, so Cash was over-credited by
    // otherDeductions on EVERY run — money that was withheld and never left
    // the account. Five staff on a ₱1,500 deduction = ₱7,500/month, ₱90k/year
    // of cash the books said had gone and had not.
    netCashAgg += (line.netBeforeCA||0) - actualCa;
    withheldAgg += (line.withheldDeductions != null ? line.withheldDeductions : (line.otherDeductions||0));

    if (caShortfall > 0.01) {
      // The frozen plan (money-core.js's computePayLine — off-limits, not
      // touched) assumed more CA repayment than the CA balance could
      // actually absorb this run. netCashAgg above already reflects the
      // smaller ACTUAL deduction (so the aggregate bank-cash figure is
      // correct), but the employee-visible salary_history row (caDeducted:
      // line.caPlanned, finalPay: line.finalPay) still mirrors the ORIGINAL
      // frozen numbers, since finalPay is money-core's frozen output and
      // isn't recomputed here. Rather than guess whether/how to top up a
      // frozen finalPay figure, flag it for Finance/President to reconcile
      // by hand — the shortfall amount + a plain-language note, not a
      // silent money-math change.
      await db.collection('salary_history').doc(`${line.uid}_${month}`).set({
        caReconcileNeedsReview: true,
        caReconcileNote: `Frozen plan assumed ₱${plannedCa.toFixed(2)} cash-advance deduction this run, but only ₱${actualCa.toFixed(2)} could actually be collected (the CA balance moved between Compute and Disburse — e.g. a manual payment or another payroll run touched it first). The ₱${caShortfall.toFixed(2)} difference is correctly excluded from this run's ledger/cash totals, but the payslip's caDeducted/finalPay still show the original frozen plan — Finance should confirm ${line.name||line.uid} received the extra ₱${caShortfall.toFixed(2)}.`,
        caReconcilePlanned: plannedCa, caReconcileActual: actualCa, caReconcileShortfall: caShortfall,
        caReconcileMonth: month, caReconcileFlaggedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge:true }).catch(()=>{});
      window.logAudit && window.logAudit('ca-reconcile-flag','pay_run', month, { uid: line.uid, plannedCa, actualCa, caShortfall });
      caReconcileFlags.push({ uid: line.uid, name: line.name||line.uid, shortfall: caShortfall });
    }

    await upsertLedger(`PAY-${month}-${line.uid}`, {
      date: month+'-01', type:'debit', accountType:'expense', account:'Payroll Expense',
      description: `Payslip — ${line.name} (${monthLabel})`, amount: line.effectiveGross,
      category:'Payroll Expense', source:'Finance', refNumber:`PAY-${month}-${line.uid}`,
      addedBy: currentUser?.uid, addedByName, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    const erTotal = (line.er?.sss||0)+(line.er?.philhealth||0)+(line.er?.pagibig||0);
    // Defect 8 — was `if (erTotal > 0) await upsertLedger(...)`, which SKIPPED
    // (leaving a stale employer-share debit posted by an earlier, aborted
    // disburse of the same month) instead of clearing it. An all-exempt
    // employee has erTotal === 0 and must carry NO employer-share expense.
    await upsertLedgerOrClear(`PAY-${month}-${line.uid}-ER`, {
      date: month+'-01', type:'debit', accountType:'expense', account:'Payroll Expense',
      description: `Employer statutory share — ${line.name} (${monthLabel})`, amount: erTotal,
      category:'Payroll Expense', source:'Finance', refNumber:`PAY-${month}-${line.uid}-ER`,
      addedBy: currentUser?.uid, addedByName, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
  // Remove any old aggregate PAY-{month} leftover from pre-WS13 code (comment
  // preserved from the original: an aggregate on top of per-employee rows
  // double-counts payroll in every view that sums debits).
  // H3 note — this direct .delete() is exempt from the financeDelete approval
  // trail on purpose: it's automated legacy-row cleanup inside disbursePayRun's
  // own atomic run, not a user-initiated finance delete (contrast with the
  // user-facing _deleteLedgerByRef, which now routes through financeDelete).
  const _oldAgg = await db.collection('ledger').where('refNumber','==',`PAY-${month}`).limit(1).get().catch(()=>({docs:[]}));
  if (_oldAgg.docs.length) {
    const _oldAggData = _oldAgg.docs[0].data();
    await _oldAgg.docs[0].ref.delete().catch(()=>{});
    // v14 Wave 4 Batch F2 — this is a raw delete outside Ledger.remove(), same
    // as every other cascade above; keep finance_rollup in sync (best-effort).
    if (window.Ledger && typeof window.Ledger._syncRollup === 'function') await window.Ledger._syncRollup(_oldAggData, -1);
  }

  const aggLeg = async (ref, account, amount) => {
    // Defect 8 — was `if (amount <= 0) return;`. A month in which nobody owes
    // an agency anything (every employee 'exempt', or the whole run re-computed
    // to zero after a partially-written disburse was reopened) must CLEAR that
    // agency's payable credit, not leave the previous figure standing as a
    // phantom liability. upsertLedgerOrClear keeps the "never post a brand-new
    // ₱0 row" behaviour of the old guard, so a nil agency that was never posted
    // still produces no ledger row at all.
    await upsertLedgerOrClear(ref, {
      date: month+'-01', type:'credit', accountType:'liability', account,
      description: `${account} — ${monthLabel} payroll`, amount,
      category:'Payroll Expense', source:'Finance', refNumber: ref,
      addedBy: currentUser?.uid, addedByName, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  };
  await aggLeg(`SSSPAY-${month}`,  'SSS Payable',        sssAgg);
  await aggLeg(`PHPAY-${month}`,   'PhilHealth Payable', phAgg);
  await aggLeg(`HDMFPAY-${month}`, 'Pag-IBIG Payable',   piAgg);
  await aggLeg(`WHTPAY-${month}`,  'Withholding Tax Payable', taxAgg);
  // v14 fix — the other half of the netCashAgg correction above: the CA
  // repayment collected via payroll deduction must credit (reduce) the
  // SAME 'Advances to Employees' asset account CashAdvance.approve debited
  // at release (js/config.js ~1750), or that receivable never comes back
  // down and the provisional Balance Sheet's Total Assets grows forever by
  // every CA ever released. WORKED EXAMPLE: employee gross-minus-statutory
  // (effectiveGross-statutoryTotal) = ₱20,000, caPlanned = ₱2,000 this run.
  // BEFORE: netCashAgg included the full ₱20,000 as a Cash credit, with no
  // offsetting entry anywhere — Cash overstated by ₱2,000, CA balance never
  // reduced in the ledger. AFTER: netCashAgg credits Cash for ₱18,000 (the
  // real bank transfer) and this leg credits Advances to Employees for
  // ₱2,000 — debits (Payroll Expense ₱20,000-equivalent already booked
  // above) still equal credits (₱18,000 + ₱2,000), and the receivable
  // correctly steps down. NOTE: this fixes the payroll-deduction path only;
  // CashAdvance.recordPayment's manual "Record Payment" button (js/config.js)
  // has the identical gap and needs the same fix there — out of this file's
  // scope, flagged for a config.js-scoped follow-up.
  // R1 — these two legs stay on the ORIGINAL `> 0` guard, deliberately, and are
  // the ONLY legs that do. The clear-on-zero behaviour above is safe precisely
  // because the ER and agency legs are a PURE FUNCTION of the frozen run.lines:
  // re-derive them on any later pass and you get the same answer, so a zero
  // really does mean "this run owes nothing here" and the stale row really is
  // garbage. CADEDUCT and NETPAY are NOT re-derivable that way — both are
  // driven by actualCa, i.e. by what CashAdvance.deduct could still collect at
  // the moment it ran. A zero here is ambiguous: it can mean "no CA repayment
  // this run" OR "the repayment was already collected by an earlier pass /
  // belongs to an employee who has since dropped out of the run". Clearing on
  // that ambiguity DESTROYS a correct credit for money that genuinely left the
  // employees' CA balances — 'Advances to Employees' would never be retired and
  // Cash would be over-credited by the same amount, which is the exact
  // receivable-never-comes-down bug the v14 note above exists to kill.
  // The resume case that used to produce a spurious zero here is fixed at the
  // ROOT (recoverPostedCa, above), so on a Resume Disburse caPlannedAgg is once
  // again the real figure and this leg simply re-posts the identical amount.
  // The residual "employee dropped from the run between two passes leaves an
  // orphan leg" case is a genuine pre-existing gap that needs a per-run manifest
  // or a ref-prefix sweep, NOT a per-leg guard change — flagged, not patched.
  // Owner ruling 2026-08-07 — the repayment collected here is NOT all principal.
  // approve() debits 'Advances to Employees' the bare principal, so crediting it
  // the full installment (which includes interest) drove the receivable NEGATIVE
  // by exactly the interest on every loan ever repaid, and the interest the
  // business actually earns appeared nowhere in the P&L. The principal half
  // retires the receivable; the interest half is income, recognised as collected.
  // caPrincipalAgg + caInterestAgg === caPlannedAgg, so total credits — and the
  // debits==credits identity — are unchanged by this split.
  const caPrincipalAgg = +(caPlannedAgg - caInterestAgg).toFixed(2);
  if (caPrincipalAgg > 0) await upsertLedger(`CADEDUCT-${month}`, {
    date: month+'-01', type:'credit', accountType:'asset', account:'Advances to Employees',
    description: `Cash advance repayments — ${monthLabel} payroll`, amount: caPrincipalAgg,
    category:'Cash Advance', source:'Finance', refNumber:`CADEDUCT-${month}`,
    addedBy: currentUser?.uid, addedByName, createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  // Own ref so it is independently idempotent and distinguishable on a resync.
  // No bank tag: this is netted out of pay, no cash moved.
  if (caInterestAgg > 0) await upsertLedger(`CAINT-${month}`, {
    date: month+'-01', type:'credit', accountType:'income', account:'Other Income',
    description: `Cash advance interest earned — ${monthLabel} payroll`, amount: caInterestAgg,
    category:'Other Income', source:'Finance', refNumber:`CAINT-${month}`,
    addedBy: currentUser?.uid, addedByName, createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  // The offsetting credit for the money the Cash leg no longer claims left the
  // bank. This is a LIABILITY, not a bank movement — deliberately carries no
  // BankAccounts.tag, because the whole point is that this cash is still in the
  // account. It is settled when the withheld money is actually paid out (a
  // manual debit against the same account), the same way the statutory payable
  // legs above are settled on remittance.
  // Guard: `> 0` only, matching CADEDUCT/NETPAY rather than the clear-on-zero
  // aggLeg helper. withheldAgg is derived from the frozen run.lines and so IS
  // re-derivable, but on a Resume Disburse a line that has since dropped out of
  // the run would make a real, correct credit look like a zero — the exact
  // ambiguity that destroyed a ₱5,000 CA credit once already. A stale row here
  // is visible and correctable; a destroyed one is not.
  if (withheldAgg > 0) await upsertLedger(`EMPDED-${month}`, {
    date: month+'-01', type:'credit', accountType:'liability', account:'Employee Deductions Payable',
    description: `Employee deductions withheld — ${monthLabel} payroll`, amount: withheldAgg,
    category:'Employee Deductions Payable', source:'Finance', refNumber:`EMPDED-${month}`,
    addedBy: currentUser?.uid, addedByName, createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  if (netCashAgg > 0) await upsertLedger(`NETPAY-${month}`, {
    date: month+'-01', type:'credit', accountType:'asset', account:'Cash',
    description: `Net payroll cash — ${monthLabel}`, amount: netCashAgg,
    category:'Payroll Expense', source:'Finance', refNumber:`NETPAY-${month}`,
    addedBy: currentUser?.uid, addedByName, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    ...window.BankAccounts.tag(bankAcct,'out')
  });

  if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');

  // v14 money-critical fix — surface the CA reconcile flags set above (frozen
  // plan vs. actually-collectible CA deduction disagreed for these lines) as
  // an actionable Finance/President notification, not just a buried
  // salary_history field nobody happens to look at.
  if (caReconcileFlags.length) {
    const totalShort = caReconcileFlags.reduce((s,f)=>s+f.shortfall, 0);
    try {
      await Notifs.sendToDept('Finance', {
        title: '⚠️ Cash-advance deduction needs review',
        body: `${monthLabel} payroll: ${caReconcileFlags.length} employee(s) had a frozen CA installment clamped below plan (total ₱${window.fmtN2(totalShort)}) — ${caReconcileFlags.map(f=>f.name).join(', ')}. Check salary_history for details before confirming payout amounts.`,
        icon: '⚠️', type: 'payroll'
      }, { fallbackToOwner: true });
    } catch(_){ /* best-effort — never block disbursement over a notification */ }
  }

  // ── 4. Notify ────────────────────────────────────────────────────────
  // PAYSLIP-OVERHAUL-SPEC.md §5/§8 flag 4 — this runs AFTER every money
  // write above (salary_history freeze, CA deductions, ledger legs) has
  // already committed, so a notification failure here must NEVER poison a
  // disbursement that has already moved money. Previously a bare (unwrapped)
  // await — one bad write (e.g. a notifications rules mismatch, see the
  // rules-before-js deploy-ordering note below) would throw out of
  // disbursePayRun entirely, surfacing to the President as a failed
  // disburse even though the money had already moved. `link`/`month` let
  // notifications.js's _navigateFromNotif land the employee directly on
  // this month's payslip instead of a bare personal-finance route.
  try {
    await Promise.all(lines.map(line => Notifs.send(line.uid, {
      title: '💰 Payroll Disbursed',
      body: `Your ${monthLabel} pay of ₱${fmt(line.finalPay)} has been disbursed. Tap to view your payslip.`,
      icon: '💰', type: 'payroll', link: 'personal-finance', month,
      dedupKey: `payroll-disbursed-${line.uid}-${month}`
    })));
  } catch (notifyErr) {
    console.error('disbursePayRun: employee notify failed (money already moved, disbursement continues)', notifyErr);
  }

  // ── 5. Flip state — TERMINAL from here (v12 WS20 D5: no reopen, no recompute) ──
  await runRef.set({
    state:'disbursed', disbursedBy: currentUser?.uid, disbursedByName: addedByName,
    disbursedAt: firebase.firestore.FieldValue.serverTimestamp(),
    disbursedFrom: bankAcct.bankAccountId || null, disbursedFromName: bankAcct.bankAccountName || null,
    disbursingAt: firebase.firestore.FieldValue.delete(), disbursingBy: firebase.firestore.FieldValue.delete(),
    disbursingByName: firebase.firestore.FieldValue.delete()
  }, { merge:true });
  window.logAudit && window.logAudit('disburse-payrun','pay_run', month, { totalNet: run.totalNet, employeeCount: lines.length });
};

// President-only: verified → computed (undoes an in-progress run before it's
// disbursed). disbursed is terminal — there is no reopen from there.
window.reopenPayRun = async function(month) {
  const ref  = db.collection('pay_runs').doc(month);
  const snap = await ref.get();
  const st = snap.exists ? snap.data().state : null;
  if (!['verified','disbursing'].includes(st)) { Notifs.showToast('Only a Verified (or a stuck Disbursing) run can be reopened.','error'); return; }
  // Manual unlock of a 'disbursing' run is president-only — mirrors the
  // disburse gate itself (Part E Phase 11). A normal verified→computed
  // reopen stays open to any money-tier admin per existing behavior.
  if (st === 'disbursing' && !(typeof isRealPresident === 'function' && isRealPresident())) {
    Notifs.showToast('Only the President can unlock a run stuck mid-disbursement.','error'); return;
  }
  const currentUser = window.currentUser;
  await ref.set({
    state:'computed', reopenedBy: currentUser?.uid, reopenedByName: window.userProfile?.displayName||currentUser?.email,
    reopenedAt: firebase.firestore.FieldValue.serverTimestamp(),
    disbursingAt: firebase.firestore.FieldValue.delete(), disbursingBy: firebase.firestore.FieldValue.delete(),
    disbursingByName: firebase.firestore.FieldValue.delete()
  }, { merge:true });
  window.logAudit && window.logAudit('reopen-payrun','pay_run', month, {});
  Notifs.success(`${month} payroll reopened — Compute is available again.`);
};

// PAYROLL RECONCILIATION — buildThreeWayRecon/threeWayReconTableHTML/
// openPayrollReconciliation moved verbatim to js/screens/hr.js (Wave 7
// Pass 3, 2026-08-03). renderPayrollManagement below (whose Reconciliation
// button opens this screen) moved with it — see that file's header.

// renderPayrollManagement (incl. nested loadPayrollTable/loadPayRunStrip and
// the Payroll History table) — moved verbatim to js/screens/hr.js (Wave 7
// Pass 3, 2026-08-03). Still calls window.computePayRun/window.disbursePayRun/
// window.reopenPayRun (above) and window.RaiseFlow (further above) as plain
// globals at runtime — see that file's header for the full boundary
// explanation. departments.js's loadFinanceContent (case 'Payroll') still
// calls it as a bare global identifier.

// renderTaxesTab — moved verbatim to js/screens/finance.js (Wave 7 Pass 8, 2026-08-03).

// window.exportFinReportCSV, loadFinStatement, finCompareKeys, window.renderFinancialReports, window.openFinCategoryDrill — moved verbatim to js/screens/finance.js (Wave 7 Pass 8, 2026-08-03).

// ── Period close/reopen (v12 WS12) — president-only, audit-logged ────────
window.closeFinancePeriod = async function(monthKey) {
  await db.collection('finance_periods').doc(monthKey).set({
    closed: true, closedBy: currentUser.uid,
    closedByName: window.userProfile?.displayName || currentUser.email,
    closedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge:true });
  window.logAudit && window.logAudit('close-period','finance_periods',monthKey,{});
  dbCacheInvalidate('finperiod-'+monthKey);
  Notifs.success(`${monthKey} closed — no new entries can post until reopened.`);
};
window.reopenFinancePeriod = async function(monthKey) {
  await db.collection('finance_periods').doc(monthKey).set({
    closed: false, reopenedBy: currentUser.uid,
    reopenedByName: window.userProfile?.displayName || currentUser.email,
    reopenedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge:true });
  window.logAudit && window.logAudit('reopen-period','finance_periods',monthKey,{});
  dbCacheInvalidate('finperiod-'+monthKey);
  Notifs.success(`${monthKey} reopened.`);
};

// runTagAccountTypes, runRestateMaterialCosts, runFixUndatedRows, runMigrateLedgerIds
// moved to js/migrations.js (v13 Phase 37)

// renderLedgerTab — moved verbatim to js/screens/finance.js (Wave 7 Pass 8, 2026-08-03).

// window.renderBankAccounts, openBankAccountModal, renderBankAccountDrilldown — moved verbatim to js/screens/finance.js (Wave 7 Pass 8, 2026-08-03).

// renderCashReceiptJournal, renderCashDisbursementJournal — moved verbatim to js/screens/finance.js (Wave 7 Pass 8, 2026-08-03).

// renderRecordsTab — moved verbatim to js/screens/finance.js (Wave 7 Pass 8, 2026-08-03).

// openCADataRepairModal, renderFinanceCA — moved verbatim to js/screens/finance.js (Wave 7 Pass 8, 2026-08-03).

// HR PROFILES + WORKER PAYSLIPS — nextWorkerIdNumber/syncWorkerDirectory/
// ensureWorkerVerifyToken/openWorkerIDModal/batchPrintWorkerIDs/
// renderFinanceHRProfiles/openHRProfileForm/openWorkerKioskModal/
// PAYSLIP_STAGES/payslipStageBadge/openPayslipHistory/openPayslipEdit/
// openPayslipGenerator/computeDayHours/collectPayslipData/
// window.toPayslipModel/window.thirteenthMonthFor/window.payslipYtdMonthly/
// window.payslipYtdWeekly/window.buildPayslipHTML/window.renderPayslipPage/
// window.downloadPayslipJPEG — moved verbatim to js/screens/hr.js (Wave 7
// Pass 3, 2026-08-03; window.renderPayslipPage was also converted from a raw
// #page-content swap to a real openPage panel there — see that file's
// header). departments.js's loadFinanceContent (case 'HR Profiles') still
// calls renderFinanceHRProfiles as a bare global identifier; js/app.js still
// calls window.renderPayslipPage/window.toPayslipModel/window.payslipYtdMonthly
// directly (personal-finance + worker-profile Payslip buttons).

// renderFinanceOverview — moved verbatim to js/screens/finance.js (Wave 7 Pass 8, 2026-08-03).

// SALES + AEC + QUOTATION LISTS — moved verbatim to js/screens/sales.js (Wave 7 Pass 2, 2026-08-03). See that file's header for the load-order contract and what deliberately stayed behind.


// DESIGN DEPARTMENT — moved verbatim to js/screens/design.js (Wave 2 Batch B, 2026-08-03). See that file's header for the load-order contract.

// Open a billing invoice in a printable window
window.openBillingInvoice = function(p, inv) {
  buildBillingInvoiceHTML(p, inv);
};

function buildBillingInvoiceHTML(p, inv) {
  const f = n => (parseFloat(n)||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtD = s => { if(!s) return '—'; const dt=new Date(s); return isNaN(dt.getTime())?s:dt.toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'}); };
  const balanceAfter = (Number(inv.balanceBefore)||0) - (Number(inv.amount)||0);
  const docTitle = inv.kind === 'downpayment' ? 'DOWNPAYMENT INVOICE' : 'BILLING INVOICE';
  const _lh = window.buildLetterhead ? window.buildLetterhead({
    docTitle,
    entity: window.brandEntity ? window.brandEntity('bir') : null,
    accent: '#1E3A5F',
    dateLabel: 'Invoice Date: ' + fmtD(inv.date),
    signatures: [
      { label: 'Issued by',   name: inv.issuedBy || '', title: (window.BRAND && window.BRAND.name) || 'Barro Industries' },
      { label: 'Received by', name: '', title: 'Client' }
    ],
    footerNote: 'System-generated invoice · ' + ((window.BRAND && window.BRAND.name) || 'Barro Industries') + ' · ' + new Date().toLocaleString('en-PH')
  }) : null;

  const pageCss = `
  .page { width:210mm; min-height:297mm; margin:0 auto; background:#fff; padding:14mm; }
  td, th { border:1px solid #000; padding:5px 7px; vertical-align:middle; font-size:11px; }
  .meta-grid { display:flex; gap:12px; margin-bottom:12px; }
  .meta-box { flex:1; border:1px solid #000; padding:8px 10px; font-size:11px; line-height:1.7; }
  .meta-box .lbl { font-weight:700; text-transform:uppercase; font-size:9px; color:#333; }
  .section-header { background:#1E3A5F; color:#fff; font-weight:700; font-size:11px; padding:5px 7px; text-transform:uppercase; letter-spacing:.05em; }
  .number-cell { text-align:right; }
  .muted-row td { background:#f5f5f5; }
  .due-row td { font-weight:900; font-size:15px; background:#ffeb3b; color:#000; }
  .notes-box { border:1px solid #000; border-top:none; padding:10px; font-size:10px; line-height:1.6; }
  @media print {
    .page { width:auto; min-height:0; padding:10mm; }
  }
${_lh ? _lh.printCSS : ''}`;
  const bodyHtml = `
  ${_lh ? _lh.headerHTML : ''}

  <div class="meta-grid">
    <div class="meta-box">
      <div class="lbl">Bill To</div>
      <div style="font-weight:700;font-size:13px">${escHtml(inv.billTo||'—')}</div>
      ${inv.projectName?`<div style="font-size:10px;color:#333">Project: ${escHtml(inv.projectName)}</div>`:''}
    </div>
    <div class="meta-box">
      <div><span class="lbl">Invoice No:</span> ${escHtml(inv.no||'')}</div>
      <div><span class="lbl">Invoice Date:</span> ${fmtD(inv.date)}</div>
      <div><span class="lbl">Due Date:</span> ${inv.due?fmtD(inv.due):'Upon receipt'}</div>
    </div>
  </div>

  <div class="section-header">Account Summary</div>
  <table>
    <tr class="muted-row"><td style="width:70%">Total Contract Amount</td><td class="number-cell">₱${f(inv.contractAmount)}</td></tr>
    <tr class="muted-row"><td>Less: Payments Received to Date</td><td class="number-cell">(₱${f(inv.paidToDate)})</td></tr>
    <tr><td style="font-weight:700">Outstanding Balance</td><td class="number-cell" style="font-weight:700">₱${f(inv.balanceBefore)}</td></tr>
  </table>

  <div class="section-header" style="margin-top:12px">This Invoice</div>
  <table>
    <thead><tr><th style="width:70%">Particulars</th><th class="number-cell">Amount</th></tr></thead>
    <tbody>
      <tr><td>${escHtml(inv.desc||'Collection of outstanding balance')}</td><td class="number-cell">₱${f(inv.amount)}</td></tr>
      <tr class="due-row"><td style="text-align:right">AMOUNT DUE</td><td class="number-cell">₱${f(inv.amount)}</td></tr>
      <tr><td style="font-size:10px;color:#333">Remaining balance after this invoice is settled</td><td class="number-cell" style="font-size:10px;color:#333">₱${f(balanceAfter)}</td></tr>
    </tbody>
  </table>

  ${Array.isArray(inv.schedule) && inv.schedule.length ? `
  <div class="section-header" style="margin-top:12px">Payment Schedule — Balance After Downpayment</div>
  <table>
    <thead><tr><th style="width:8%">#</th><th>Milestone</th><th style="width:22%">Due Date</th><th class="number-cell" style="width:20%">Amount</th></tr></thead>
    <tbody>
      ${inv.schedule.map(s=>`<tr><td>${s.seq}</td><td>${escHtml(s.label||'')}</td><td>${s.dueDate?fmtD(s.dueDate):'TBD'}</td><td class="number-cell">₱${f(s.amount)}</td></tr>`).join('')}
      <tr class="muted-row"><td colspan="3" style="font-weight:700;text-align:right">Total balance after downpayment</td><td class="number-cell" style="font-weight:700">₱${f(inv.schedule.reduce((s,x)=>s+(+x.amount||0),0))}</td></tr>
    </tbody>
  </table>` : ''}
  ${inv.bank ? `
  <div class="section-header" style="margin-top:12px">Payment Instructions</div>
  <div class="notes-box">
    <strong>${inv.bank.type==='ewallet'?'E-wallet':'Deposit to'}:</strong> ${escHtml(inv.bank.bankName||'')}${inv.bank.branch?' — '+escHtml(inv.bank.branch):''}<br/>
    <strong>Account Name:</strong> ${escHtml(inv.bank.accountName||'')}<br/>
    <strong>Account No.:</strong> ${escHtml(inv.bank.accountNo||'')}<br/>
    Please send the deposit slip / transfer confirmation to ${escHtml((window.BRAND&&window.BRAND.legal.email)||'')} referencing invoice ${escHtml(inv.no||'')}.
  </div>` : ''}

  ${inv.notes?`<div class="section-header" style="margin-top:12px">Notes</div><div class="notes-box">${escHtml(inv.notes)}</div>`:''}

  ${_lh ? _lh.footerHTML : `
  <table style="margin-top:24px;border:none">
    <tr>
      <td style="border:none;padding:24px 10px 6px;text-align:center;width:50%">
        <div style="border-top:1px solid #000;padding-top:4px">${escHtml(inv.issuedBy||'')}</div>
        <div style="font-size:9px;color:#555">Issued By</div>
      </td>
      <td style="border:none;padding:24px 10px 6px;text-align:center;width:50%">
        <div style="border-top:1px solid #000;padding-top:4px">&nbsp;</div>
        <div style="font-size:9px;color:#555">Received By / Date</div>
      </td>
    </tr>
  </table>`}`;

  // v14 doc-print overhaul (DOCUMENTS-PRINT-SPEC.md §6.1) — this used to
  // lazy-load html2canvas from cdnjs.cloudflare.com for a hand-rolled Save
  // as JPEG button, which index.html's CSP script-src (`'self' gstatic
  // unpkg jsdelivr` only) has never allowed, so Save as JPEG failed on
  // every device. openPrintableDoc's built-in #pd-jpeg-btn now covers this
  // for free via the local vendored html2canvas + pdf-lite pipeline.
  window.openPrintableDoc({
    title: `${docTitle} — ${inv.no||''}`,
    pageId: 'invoice-page',
    barLabel: `${emojiIcon('🧾',16)} ${docTitle} — ${escHtml(inv.no||'')}`,
    bodyHtml, pageCss,
    accent: '#1E3A5F',
    bgColor: '#f0f0f0',
    winFeatures: 'width=900,height=700'
  });
}

// IT DEPARTMENT — moved verbatim to js/screens/govit.js (Wave 7 Pass 5,
// 2026-08-03): window.renderIT, loadITContent, openITTicketModal. See that
// file's header for the full contents list, the 8-point changes made
// (error-with-retry on every subtab's Firestore read, two aria-labels, two
// #FF9F0A -> var(--warning,#FF9F0A) token swaps), and what deliberately
// stayed here.

// BRILLIANT STEEL (main tabs) — moved verbatim to js/screens/partners.js
// (Wave 7 Pass 6, 2026-08-03): window.renderBrilliantSteel, loadBSContent,
// renderBSFiles, renderBSClientData. renderBSQuotationFiles/
// getBsQuotesOrdered/invalidateBsQuotesCache stay here (see their own
// comments below) — genuinely shared with Approvals' 'quote-files' chip and
// with sales.js's bindQuoteActions, called as bare globals from partners.js
// the same cross-file, runtime-only way every other pass documents. See
// partners.js's header for the full contents list and the 8-point changes
// made (hand-rolled .subtab-bar → chipTabs on both the top-level 4-tab bar
// and the Files sub-bar).

// Shared cached bs_quotes read (createdAt-desc, ordered) for the two BS tabs
// that use the identical isPrivileged/query shape (Files + Client Data).
// Keyed by exact scope so cached results are never shared across different
// access scopes (privileged "all" vs a specific user's own-only query).
// Clears every bs_quotes cache slot the acting user could be reading from
// (both the ordered Files/Client-Data cache and the flat Summary cache, in
// both their "all" and "own" scope) so a write is reflected immediately
// instead of waiting out the TTL. Config.js's dbCacheInvalidate has no
// wildcard/prefix support for this key (that alias list lives in config.js,
// which is out of scope here), so the concrete keys are cleared by hand.
window.invalidateBsQuotesCache = function(uid) {
  if (typeof dbCacheInvalidate !== 'function') return;
  dbCacheInvalidate('bs_quotes-ord-all');
  dbCacheInvalidate('bs_quotes-flat-all');
  if (uid) {
    dbCacheInvalidate(`bs_quotes-ord-own-${uid}`);
    dbCacheInvalidate(`bs_quotes-flat-own-${uid}`);
  }
};

window.getBsQuotesOrdered = async function(currentUser, isPrivileged) {
  const key = isPrivileged ? 'bs_quotes-ord-all' : `bs_quotes-ord-own-${currentUser.uid}`;
  return dbCachedGet(key, () => isPrivileged
    ? db.collection('bs_quotes').orderBy('createdAt','desc').get()
    : db.collection('bs_quotes').where('createdBy','==',currentUser.uid).orderBy('createdAt','desc').get(),
    50000);
};

async function renderBSQuotationFiles(container, currentUser, currentRole) {
  container.innerHTML = window.skeletonHtml('rows');
  // H6 fix — a bare 'employee' role must NOT see every bs_quotes doc; only
  // Sales-dept employees may (mirrors renderBSQuotationsSummary's canSeeAll
  // below). The old unconditional `|| currentRole === 'employee'` exposed every
  // partner's Brilliant Steel quote to any employee, regardless of department.
  const isPrivileged = currentRole === 'president' || currentRole === 'owner' || currentRole === 'manager' ||
    (currentRole === 'employee' && (window.currentDepts||[]).includes('Sales'));
  try {
    const snap = await window.getBsQuotesOrdered(currentUser, isPrivileged);
    const quotes = snap.docs.map(d=>({id:d.id,...d.data()}));

    // Group quotes by client name (folder per client)
    const clientFolders = {};
    quotes.forEach(q => {
      const key = (q.clientName||'').trim() || 'Unknown Client';
      if (!clientFolders[key]) clientFolders[key] = [];
      clientFolders[key].push(q);
    });

    const folders = Object.entries(clientFolders).sort((a,b) => {
      const latestA = Math.max(...a[1].map(q=>q.createdAt?.seconds||0));
      const latestB = Math.max(...b[1].map(q=>q.createdAt?.seconds||0));
      return latestB - latestA;
    });

    if (!folders.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('📁',44)}</div><h4>No quotation files yet</h4><p style="color:var(--text-muted);font-size:13px">Filed quotations will appear here, organized by client.</p></div>`;
      if (window.lucide) lucide.createIcons({ nodes: [container] });
      return;
    }

    container.innerHTML = `
      <div style="margin-bottom:12px">
        <input id="bs-qfile-search" placeholder="Search client or quote number…" class="ms-input" style="max-width:300px"/>
      </div>
      <div id="bs-qfile-folders" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px"></div>
    `;

    const renderFolders = (list) => {
      const grid = container.querySelector('#bs-qfile-folders');
      if (!list.length) { grid.innerHTML = '<p style="color:var(--text-muted);font-size:13px">No results.</p>'; return; }
      grid.innerHTML = list.map(([clientName, qs]) => {
        const total = qs.reduce((s,q)=>s+(q.total||q.grandTotal||0),0);
        const latestDate = qs[0].createdAt?.toDate?.()?.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})||'';
        return `
          <div class="card bs-qfolder-card" style="cursor:pointer" onclick="this.querySelector('.bs-qfolder-body').style.display=this.querySelector('.bs-qfolder-body').style.display==='block'?'none':'block'">
            <div class="card-header" style="gap:10px">
              <div style="font-size:28px;flex-shrink:0">${emojiIcon('📁',28)}</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(clientName)}</div>
                <div style="font-size:11px;color:var(--text-muted)">${qs.length} file${qs.length!==1?'s':''} · ₱${window.fmtN2(total)} · Last: ${latestDate}</div>
              </div>
            </div>
            <div class="bs-qfolder-body" style="display:none;padding:10px 16px 14px;border-top:1px solid var(--border)">
              ${qs.map(q => {
                const ts = q.createdAt?.toDate?.()?.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})||'';
                const status = q.status||q.approvalStatus||'draft';
                const badge = window.statusBadgeClass('quote', status);
                return `
                  <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
                    <span style="font-size:18px">${emojiIcon('📄',18)}</span>
                    <div style="flex:1;min-width:0">
                      <div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(q.quoteNumber||q.id.slice(-8))}</div>
                      <div style="font-size:11px;color:var(--text-muted)">${ts}${isPrivileged&&q.agentName?' · '+escHtml(q.agentName):''}</div>
                    </div>
                    <div style="text-align:right;flex-shrink:0">
                      <div style="font-size:12px;font-weight:700">₱${window.fmtN2(q.total||q.grandTotal||0)}</div>
                      <span class="badge ${badge}" style="font-size:10px">${window.statusLabel2('quote', status)}</span>
                    </div>
                  </div>`;
              }).join('')}
            </div>
          </div>`;
      }).join('');
      if (window.lucide) lucide.createIcons({ nodes: [grid] });
    };

    renderFolders(folders);

    container.querySelector('#bs-qfile-search').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      renderFolders(q ? folders.filter(([name, qs]) =>
        name.toLowerCase().includes(q) ||
        qs.some(qt => (qt.quoteNumber||'').toLowerCase().includes(q))
      ) : folders);
    });
  } catch(err) {
    // 8-point #3 (Wave 7 Pass 6) — was a bare "Error: {message}" with no way
    // to recover short of re-navigating; matches the retry idiom every other
    // pass's screens use (govit.js/production.js/sales.js).
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('⚠️',44)}</div><h4>Couldn't load quotation files</h4><p>${escHtml(err.message||String(err))}</p><button type="button" class="btn-secondary btn-sm bsqf-retry-btn" style="margin-top:14px">Retry</button></div>`;
    container.querySelector('.bsqf-retry-btn')?.addEventListener('click', () => renderBSQuotationFiles(container, currentUser, currentRole));
    if (window.lucide) lucide.createIcons({ nodes: [container] });
  }
}


// renderBSQuotationsSummary — moved verbatim to js/screens/sales.js (Wave 7 Pass 2, 2026-08-03), alongside its bindQuoteActions helper below. loadBSContent's 'Quotations Summary' case still calls it as a bare global identifier (safe: runtime-only call, resolves after all page scripts load).

// Show + copy the public client order-tracking link (reuses the shared modal).
// Short, on-brand tracking URL (own domain, short /t/ path + short code) — no
// third-party shortener (those read as suspicious). e.g. …ravenmails.com/t/?A1b2C3d4
window.orderTrackUrl = function(token){ return `${location.origin}/t/?${token}`; };

// Unguessable short code for a public tracking doc id. 8 chars from a 54-char
// unambiguous alphabet (no 0/O/1/I/l) ≈ 7×10¹³ combos — plenty for order status.
window.makeTrackCode = function(len){
  len = len || 8;
  var A = '23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ', out = '';
  try { var a = new Uint32Array(len); (window.crypto||window.msCrypto).getRandomValues(a);
    for (var i=0;i<len;i++) out += A[a[i] % A.length];
  } catch(_) { for (var j=0;j<len;j++) out += A[Math.floor(Math.random()*A.length)]; }
  return out;
};
async function uniqueTrackCode(){
  for (let i=0;i<5;i++){
    const code = window.makeTrackCode(8);
    try { const s = await db.collection('order_tracking').doc(code).get(); if(!s.exists) return code; }
    catch(_){ return code; }   // read blocked → collision odds are negligible anyway
  }
  return window.makeTrackCode(11);
}
window.showOrderTrackModal = function(url, orderNo){
  openModal(`${emojiIcon('🔗',16)} Client Order-Tracking Link`, `
    <p style="font-size:13px;color:var(--text-2);margin-bottom:12px">Share this link with the client for <strong>${escHtml(orderNo||'their order')}</strong>. They can open it any time — <strong>no login needed</strong> — to see their order status, dates and balance. Internal costs are never shown.</p>
    <div style="display:flex;gap:8px;align-items:center">
      <input id="track-url" readonly value="${escHtml(url)}" style="flex:1;padding:10px 12px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:12px" onclick="this.select()"/>
      <button class="btn-primary btn-sm" id="track-copy" style="white-space:nowrap">Copy</button>
    </div>
    <div style="margin-top:12px"><a href="${escHtml(url)}" target="_blank" rel="noopener" style="font-size:12px;color:var(--primary);font-weight:600">Preview the client view ↗</a></div>
  `, `<button class="btn-secondary" onclick="closeModal()">Done</button>`);
  const btn=document.getElementById('track-copy');
  btn?.addEventListener('click', async ()=>{
    const inp=document.getElementById('track-url');
    try{ await navigator.clipboard.writeText(inp.value); }catch(_){ inp.select(); try{document.execCommand('copy');}catch(__){} }
    btn.textContent='✓ Copied'; setTimeout(()=>{btn.textContent='Copy';},1600);
    Notifs.showToast('Tracking link copied','success');
  });
};

// Update a client's PUBLIC tracking doc (status advance, payment, dates). Keyed by
// the token stamped on the order/project. Best-effort — never blocks the caller.
// Passing `status` also stamps that stage's date (deep-merged, preserves history).
window.syncOrderTracking = async function(token, patch){
  if(!token || !patch) return;
  try{
    const upd = Object.assign({}, patch, { updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    if(patch.status){
      const day = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10);
      upd.stageStamps = { [patch.status]: day };   // set-merge deep-merges the map
    }
    await db.collection('order_tracking').doc(token).set(upd, { merge:true });
  }catch(_){ /* best-effort */ }
};

// Return the tracking token for a sales order, creating the public tracking doc
// on demand if it doesn't exist yet (e.g. orders made before this feature). Lets
// the "🔗 Link" button re-surface a shareable link for ANY order.
window.ensureOrderTracking = async function(o){
  if(o.trackingToken) return o.trackingToken;
  const dayStr = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10);
  let orderNo = o.quoteNumber || '';
  if(o.projectId){ try{ const ps=await db.collection('job_projects').doc(o.projectId).get(); if(ps.exists) orderNo = ps.data().projectNo || orderNo; }catch(_){} }
  const paid = o.recordedAmount || o.paymentReceived || 0;
  const tRef = db.collection('order_tracking').doc(await uniqueTrackCode());
  await tRef.set({
    orderId:o.id, projectId:o.projectId||null, orderNo:orderNo||('SO-'+o.id.slice(-6).toUpperCase()),
    clientName:o.clientName||'', company:window.quoteCompanyLabel(o.company), scope:o.project||'',
    status:(o.sentToProduction?'production':(o.sentToDesign?'design':'confirmed')), stageStamps:{ confirmed:dayStr },
    contractAmount:o.contractAmount||0, paid, balance:Math.max(0,(o.contractAmount||0)-paid),
    orderDate:dayStr, expectedDate:null,
    publicNote:'Thank you for your order! This page updates as your order moves through production and delivery.',
    createdAt:firebase.firestore.FieldValue.serverTimestamp(), updatedAt:firebase.firestore.FieldValue.serverTimestamp()
  });
  // ⚠ SILENT HALF-WRITE (fixed 2026-08-09). The public order_tracking doc above
  // is created by anyone who is not a partner, but STAMPING the token back onto
  // the order is `sales_orders` update = canFinance(). The 🔗 Link button is
  // rendered to EVERY viewer of the list, so for anyone outside the money tier
  // — the Corporate Secretary most sharply — this update was denied and the
  // bare catch swallowed it. The token was then never persisted, so every fresh
  // page load minted a NEW public tracking doc with a NEW token for the same
  // order: links shared earlier were orphaned and the collection accumulated
  // duplicates, with nothing on screen and nothing in the console.
  // Now the failure is surfaced, once, in plain terms.
  let stamped = true;
  try{ await db.collection('sales_orders').doc(o.id).update({ trackingToken:tRef.id }); }
  catch(e){
    stamped = false;
    console.warn('[order tracking] token not saved onto the order', e);
    // Toasts render via textContent — plain emoji only, never emojiIcon() HTML.
    if (window.Notifs) Notifs.showToast(
      'Link created, but it could not be saved onto the order — you do not have permission to edit sales orders. Share it now; re-opening will generate a different link. Ask Finance to save it.',
      'error');
  }
  if(o.projectId && stamped){ try{ await db.collection('job_projects').doc(o.projectId).update({ trackingToken:tRef.id }); }catch(_){} }
  o.trackingToken = tRef.id;
  return tRef.id;
};

// Convert a won quote into a Sales Order: capture payment + receipt, route to Finance.
async function openSalesOrderModal(d, currentUser, currentRole, container){
  const total = parseFloat(d.total)||0;
  // v12 WS36 — the quote's payment terms can't ride the dataset bag (nested object);
  // fetch the quote doc directly to prefill the DP%. Best-effort — never blocks the modal.
  let quotePay = null;
  // v14 sales-pipeline gap fix — carry the quote's line items forward onto the
  // sales_order AND job_project (below) so Production sees WHAT to build without
  // dereferencing back to a possibly-stale/re-revised quote doc. Reuses the SAME
  // quote fetch already done for quotePay — no extra read.
  let quoteItems = [];
  try { const qs = await db.collection(window.quoteCollectionFor(d.co)).doc(d.id).get();
        if (qs.exists) { quotePay = qs.data().payment || null; quoteItems = Array.isArray(qs.data().items) ? qs.data().items : []; } } catch(_) {}
  const dpPrefill = quotePay
    ? (quotePay.downPaymentMode === 'custom'
        ? (total > 0 ? +(100*(quotePay.downPayment||0)/total).toFixed(1) : '')
        : (parseFloat(quotePay.downPaymentMode) || ''))
    : '';
  const _panel = openPage(`${emojiIcon('🧾',16)} Create Sales Order`, `
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Client <strong>${escHtml(d.client||'')}</strong> · Quote ${escHtml(d.qno||'')}</div>
    <div class="form-group"><label>Project / Scope</label><input id="so-project" value="${escHtml((d.client||'')+' — '+(d.qno||''))}"/></div>
    <div class="form-row">
      <div class="form-group"><label>Contract Amount (₱)</label><input id="so-contract" type="number" step="0.01" value="${total}" inputmode="decimal"/></div>
      <div class="form-group"><label>Payment Received (₱)</label><input id="so-paid" type="number" step="0.01" placeholder="e.g. downpayment" inputmode="decimal"/></div>
    </div>
    <div class="form-group"><label>Downpayment % of contract (optional)</label>
      <input id="so-dp-pct" type="number" min="0" max="100" step="0.5" value="${dpPrefill}" inputmode="decimal" placeholder="e.g. 40"/>
      <div style="font-size:11px;color:var(--text-muted);margin-top:3px">Prefilled from the quote's payment terms — drives the Downpayment Invoice on the project.</div>
    </div>
    <div class="form-group"><label>Payment Method</label>
      <select id="so-method" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)"><option>Bank Transfer</option><option>GCash</option><option>Cash</option><option>Cheque</option><option>Other</option></select>
    </div>
    <div class="form-group"><label>VAT treatment (amount received)</label>
      <select id="so-vat" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
        <option value="inclusive" selected>VAT-inclusive — 12% already in the amount</option>
        <option value="exclusive">VAT-exclusive — add 12% on top</option>
        <option value="exempt">VAT-exempt / Zero-rated — no VAT</option>
      </select>
      <div style="font-size:11px;color:var(--text-muted);margin-top:3px">Only used if this order can be auto-recorded to Finance below (same treatment Finance's own Record Sale uses).</div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Target Date (for Production)</label><input id="so-target-date" type="date"/></div>
      <div class="form-group"><label>Priority (for Production)</label>
        <select id="so-priority" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          <option value="">Not set yet</option>
          <option value="Urgent">Urgent</option>
          <option value="High">High</option>
          <option value="Normal">Normal</option>
          <option value="Low">Low</option>
        </select>
      </div>
    </div>
    <div class="form-group"><label>Notes</label><textarea id="so-notes" rows="2" placeholder="Payment ref #, schedule + what/how to build, etc."></textarea></div>
    <div style="font-size:11px;color:var(--text-muted);margin:-6px 0 8px">Target date, priority and notes must be filled in before the job leaves Design for Production — set them now if you already know them, or Design will be asked for them at hand-off.</div>
    <div class="form-group"><label>Receipt / Proof of Payment</label><div id="so-receipt-upload"></div></div>
    <div id="so-err" class="error-msg hidden"></div>
  `, `<button class="btn-primary" id="so-save">Create &amp; Send to Finance</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  let receipt=null;
  if(window.Drive?.renderUploadArea) Drive.renderUploadArea('so-receipt-upload',(r)=>{receipt=r;},{label:'Upload receipt (photo/PDF)',accept:'image/*,.pdf',dept:'Finance',subfolder:'SalesOrders'});
  // ⚠ SCOPED TO THIS PANEL, NOT document. openPage keeps a CLOSING page in the
  // DOM for ~300ms; convert a second won quote inside that window and two panels
  // carry the same ids, with document.getElementById() resolving into the DYING
  // one. Money-critical here: the save would read the PREVIOUS quote's contract
  // amount, payment received and DP% and write them onto THIS order + ledger.
  const $ = (id) => _panel.querySelector('#' + id);
  $('so-save').addEventListener('click', () => window.busy($('so-save'), async ()=>{
    const err=$('so-err');
    const contract=parseFloat($('so-contract').value)||0;
    const paid=parseFloat($('so-paid').value)||0;
    const project=$('so-project').value.trim();
    if(!project){ err.textContent='Project is required.'; err.classList.remove('hidden'); return; }
    const dpPercent = Math.max(0, Math.min(100, parseFloat($('so-dp-pct').value)||0)) || null;
    // Sales→Production handoff fields (owner's rule) — optional here (Sales may not
    // know the target date yet), but REQUIRED before this order can actually be sent
    // to Production; see ensureProdHandoffFields/transferOrderToProduction below.
    const targetDate = $('so-target-date').value || '';
    const priority = $('so-priority').value || '';
    const notes = $('so-notes').value.trim();
    try{
      // 1) create the master project (the spine that ties the whole job together)
      const proj = await createJobProject({ ...d, total:contract, dpPercent, items: quoteItems, targetDate, priority, notes });
      // 2) sales order, linked to the project
      const ref=await db.collection('sales_orders').add({
        projectId:proj.id, quoteId:d.id, quoteNumber:d.qno||'', clientName:d.client||'', company:d.co||'BS',
        clientId: d.clientId || null,
        project, contractAmount:contract, paymentReceived:paid, items:quoteItems,
        paymentMethod:$('so-method').value,
        notes, targetDate, priority,
        receiptUrl:receipt?.url||null, receiptName:receipt?.name||null,
        status:'pending', createdBy:currentUser.uid, createdByName:userProfile?.displayName||currentUser.email,
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      // 3) stamp the back-links onto the quote IN THE CORRECT COLLECTION (was
      //    hardcoded to bs_quotes). Routed through the shared registry, so BI
      //    (Barro Industries, filed alongside BK) resolves without a third arm.
      const qc = window.quoteCollectionFor(d.co);
      try{ await db.collection(qc).doc(d.id).update({ salesOrderId:ref.id, projectId:proj.id, status:'won' }); if (qc==='bs_quotes') window.invalidateBsQuotesCache(currentUser.uid); }catch(_){}
      // 4) record the Sales Order on the project's document register + link the SO id
      try{ await db.collection('job_projects').doc(proj.id).update({ salesOrderId:ref.id,
        documents:firebase.firestore.FieldValue.arrayUnion({ type:'Sales Order', ref:proj.projectNo, at:new Date().toISOString(), by:userProfile?.displayName||currentUser.email }) }); }catch(_){}
      // 4b) CRM: a client with a signed order is WON — keeps client stage and the
      // quote-outcome win rate from drifting apart (v12 WS32 decision 8).
      try {
        let cid = d.clientId || null;
        if (!cid) { const c0 = await window.Clients.findByName(d.client); cid = c0 && c0.id; }
        if (cid) {
          await db.collection('clients').doc(cid).update({ stage:'won', updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
          if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('clients');
        }
      } catch(_){ /* best-effort — never block the order */ }
      // 5) client order-tracking link — created once the downpayment is captured.
      //    Public, unguessable token; client-SAFE fields only (no cost/margin).
      let trackUrl='';
      try{
        const tRef = db.collection('order_tracking').doc(await uniqueTrackCode());
        const dayStr = window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10);
        await tRef.set({
          orderId:ref.id, projectId:proj.id, orderNo:proj.projectNo, clientName:d.client||'',
          company:window.quoteCompanyLabel(d.co), scope:project,
          status:'confirmed', stageStamps:{ confirmed:dayStr },
          contractAmount:contract, paid:paid, balance:Math.max(0,contract-paid),
          orderDate:dayStr, expectedDate:null,
          publicNote:'Thank you for your order! This page updates as your order moves through production and delivery.',
          createdAt:firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt:firebase.firestore.FieldValue.serverTimestamp()
        });
        await db.collection('sales_orders').doc(ref.id).update({ trackingToken:tRef.id }).catch(()=>{});
        await db.collection('job_projects').doc(proj.id).update({ trackingToken:tRef.id }).catch(()=>{});
        trackUrl = window.orderTrackUrl(tRef.id);
      }catch(_){ /* tracking is best-effort — never block the order */ }
      const who=userProfile?.displayName||currentUser.email;
      // 5b) FINANCE AUTO-RECORD — closes the "Finance re-enters it" gap. Post ONLY
      // what was actually collected (never the full contract — the balance stays
      // AR on the project; never invented revenue), via the SAME deterministic ref
      // ('SO-<salesOrderId>') openRecordSaleModal's manual "Record Sale" path
      // already posts to (see its `ledgerRef` a few functions below) — Ledger's
      // deterministic-id read-then-write means a re-run can never double-post.
      // Deliberately gated to callers who already hold Finance/admin rights
      // (mirrors firestore.rules' canFinance()): the ledger's OWN rules gate both
      // its read (the service's legacy-ref dedupe guard) and its create to
      // canFinance()/isAdmin() only, and widening that so every Sales-staff or
      // partner order-creator could write straight to the books — self-reported
      // amount, no verification — is exactly the kind of money-safety regression
      // "be conservative" rules out. So this is pure best-effort: it silently
      // succeeds when the creator IS Finance/admin (a common real case — a
      // manager or Finance-dept staffer converting the quote themselves), and
      // is a no-op (rules deny it) for everyone else, who fall through to the
      // EXACT unchanged manual "Record Sale" queue that existed before this
      // change — zero regression risk either way.
      let autoPosted = false;
      // isFinancePriv() is canEditDept('Finance'), which resolves to exactly the
      // same set this used to spell out by hand (president/owner/manager/finance
      // OR a Finance-DEPARTMENT member) MINUS the Corporate Secretary — who the
      // hand-rolled version admitted through the department leg the moment their
      // profile listed Finance, posting straight to the ledger. Owner ruling 3.
      const canAutoPostLedger = isFinancePriv();
      if (canAutoPostLedger && paid > 0 && paid <= contract + 0.01) {
        try {
          const vatTreatment = $('so-vat').value;
          const { recorded, net, vat:vatAmount } = window.vatSplit(paid, vatTreatment);
          await window.Ledger.upsertByRef(`SO-${ref.id}`, () => ({
            ref: `SO-${ref.id}`, date: today(), kind: 'credit',
            accountType: 'income', account: 'Sales Revenue', category: 'Sales Revenue',
            description: `Sales order — ${d.client}${d.qno?' ('+d.qno+')':''}`,
            amount: recorded, source: 'Sales', projectId: proj.id,
            extra: { net, vatAmount, vatTreatment, autoPosted: true }
          }));
          await db.collection('sales_orders').doc(ref.id).update({
            status:'recorded', recordedAmount:recorded, recordedAt:firebase.firestore.FieldValue.serverTimestamp(),
            recordedBy:who, autoRecorded:true
          });
          // Sync the project's collected/AR the same way openRecordSaleModal does —
          // read-then-increment (not a blind set) even though this is the project's
          // very first payment, so this stays correct if that ever isn't true.
          const pSnap = await db.collection('job_projects').doc(proj.id).get();
          const curCollected = pSnap.exists ? (pSnap.data().amountCollected||0) : 0;
          const newCollected = curCollected + recorded;
          const newAR = Math.max(0, contract - newCollected);
          await db.collection('job_projects').doc(proj.id).update({
            amountCollected:newCollected, arBalance:newAR, updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
            payments:firebase.firestore.FieldValue.arrayUnion({ type:'Sales Order Payment', amount:recorded, vatAmount, net, method:$('so-method').value, orRef:'', date:today(), by:who, ledgerId:window.Ledger._sanitize(`SO-${ref.id}`), auto:true }),
            timeline:firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:`Sale auto-recorded ₱${window.fmtN2(recorded)} at order creation`, by:who })
          });
          autoPosted = true;
        } catch(_){ /* rules deny it for a non-Finance creator — falls back to the unchanged manual Record Sale queue */ }
      }
      window.logAudit&&window.logAudit('create','sales_order',ref.id,{client:d.client, contract, paid, projectNo:proj.projectNo, autoPosted});
      try{ await Notifs.sendToDept('Finance',{ title:'🧾 New Sales Order', body: autoPosted
          ? `${who}: ${d.client} — ₱${window.fmtN2(contract)} (₱${window.fmtN2(paid)} auto-recorded to the ledger). Project ${proj.projectNo}. Verify the receipt.`
          : `${who}: ${d.client} — ₱${window.fmtN2(contract)} (₱${window.fmtN2(paid)} received). Project ${proj.projectNo}. Record income + verify receipt.`,
        icon:'🧾', type:'sales_order', link:'sales-orders' }); }catch(_){}
      // Production is no longer notified at SO creation — it now hears about a job
      // exactly once, at the Design→Production handoff (transferOrderToProduction).
      try{ await Notifs.sendToOwner({ title:'🤝 Quote won → Project '+proj.projectNo, body:`${d.client} — ₱${window.fmtN2(contract)} closed by ${who}.`, icon:'🤝', type:'sales_order', link:'projects-lifecycle' }); }catch(_){}
      Notifs.success('Sales order + project '+proj.projectNo+' created'+(autoPosted?' + sale recorded':''));
      if (typeof container!=='undefined' && container) {
        // BK and BI both live in bk_quotes, so both re-render the internal
        // (Barro Kitchens) quotations summary — which badges the BI rows.
        if (window.isInternalQuoteCompany(d.co)) renderBKQuotationsSummary(container, currentUser, currentRole);
        else renderBSQuotationsSummary(container, currentUser, currentRole);
      }
      // Surface the shareable client tracking link (falls back to just closing).
      if (trackUrl) window.showOrderTrackModal(trackUrl, proj.projectNo);
      else closeModal();
    }catch(ex){
      // Money-critical fix — createJobProject's pre-write guard (production.js)
      // throws this specific code when the quote was already converted (double
      // conversion would double-count revenue). Surface it clearly instead of
      // the generic "Failed:" message, and offer a one-click way to open the
      // existing project instead of retrying the create.
      if (ex && ex.code === 'already-converted') {
        err.innerHTML = escHtml(ex.message) + (ex.existingProjectId
          ? ' <button type="button" class="btn-link" id="so-open-existing-btn" style="text-decoration:underline;color:var(--accent);background:none;border:none;padding:0;cursor:pointer;font:inherit">Open the existing project</button>'
          : '');
        err.classList.remove('hidden');
        if (ex.existingProjectId) {
          $('so-open-existing-btn')?.addEventListener('click', async () => {
            try {
              const exSnap = await db.collection('job_projects').doc(ex.existingProjectId).get();
              // // ⚠ replace, never closeModal()-then-open: dismissTop() is history.back(), which is
  // ASYNC, so the queued back lands AFTER the new panel is pushed and pops the panel
  // that was just opened — it flashes up and dies, and repeated taps drift the Overlay
  // and history stacks apart until a later close unwinds to the page underneath.
  // (President's report 2026-08-10, reproduced in-browser.) See js/screens/sales.js.
    if (exSnap.exists && typeof openJobProjectDetail === 'function') openJobProjectDetail({ id: exSnap.id, ...exSnap.data() }, { replace:true });
            } catch(_){}
          });
        }
        return;
      }
      err.textContent='Failed: '+(ex.message||ex.code); err.classList.remove('hidden');
    }
  }));
}

// Finance/admin view of incoming sales orders — record income to the ledger.
/* ═══════════════════════════════════════════════════════════════════════
   DELETE A SALES ORDER — the cascade, not a row delete.
   Owner, 2026-08-10: "allow to delete a sales order, since i was just testing
   the other one to see functons".

   firestore.rules already permitted this (`sales_orders` delete = isPresident());
   what was missing was a button and, more importantly, the cleanup behind it.
   Creating one order writes to SIX places, so removing only the row would leave:
     • income booked in the ledger against a sale that no longer exists
     • a production job with no order behind it, still live in Production
     • a quote stuck at status 'won', pointing at a dead salesOrderId
     • a client parked at stage 'won'
     • a PUBLIC order-tracking page that still resolves for anyone with the link

   OWNER RULINGS (2026-08-10) encoded here:
     1. The ledger entry is REVERSED, never deleted — an offsetting row so the
        books net to zero and both halves stay visible to an auditor. Same shape
        the cash-advance repayment reversal uses: opposite `kind` against the
        SAME account, distinct ref.
     2. FULL cascade, with a preview of exactly what will go, and type-to-confirm.
     3. President only — matches the rule, so the UI never offers what the server
        would refuse.

   ORDER OF OPERATIONS IS DELIBERATE. The reversal posts FIRST: if the ledger
   write fails (a closed period, a denied write), nothing has been destroyed yet
   and the whole thing aborts. The public tracking page goes next, because it is
   the only artefact exposed outside the company. The sales order itself goes
   LAST, through window.financeDelete, so it remains the thing that "exists"
   while its dependents are being unwound — a crash halfway leaves an order you
   can see and retry, not orphans you cannot find.
   ═══════════════════════════════════════════════════════════════════════ */
window.deleteSalesOrder = async function(o, onDone) {
  if (!o || !o.id) return;
  if (!(typeof isRealPresident === 'function' && isRealPresident())) {
    Notifs.showToast('Only the President can delete a sales order.', 'error'); return;
  }

  // ── Preview. Read, never assume: the row's `status` says 'recorded' but the
  // ledger entry only exists if a payment was actually taken, so a ₱0 order can
  // be 'recorded' with nothing in the books. Look before telling the owner what
  // will happen.
  const ledgerRef = `SO-${o.id}`;
  let ledgerRow = null;
  try {
    const ls = await db.collection('ledger').where('refNumber', '==', ledgerRef).limit(1).get();
    ledgerRow = ls.docs.length ? { id: ls.docs[0].id, ...ls.docs[0].data() } : null;
  } catch (_) { ledgerRow = undefined; }   // undefined = could not check

  // FAIL CLOSED. If the ledger could not be READ, we cannot know whether income
  // was booked against this order, and deleting anyway risks leaving revenue on
  // the books for a sale that no longer exists — silently, with the order gone
  // and nothing left to trace it by. Warning and proceeding was the first cut
  // here; that is informed consent for a cosmetic risk, not a money one. Every
  // other guard in this app that touches money or a boundary refuses on an
  // unreadable input (_assertShareTargetSafe, financeDelete), and this matches.
  if (ledgerRow === undefined) {
    Notifs.showToast('Could not check the ledger for this order, so nothing was deleted — try again in a moment.', 'error');
    return;
  }

  const qColl = (typeof window.quoteCollectionFor === 'function')
    ? window.quoteCollectionFor(o.company) : 'bk_quotes';
  const bits = [];
  bits.push(`the sales order itself (${o.clientName || 'unnamed'}, ${window.fmt ? window.fmt(o.contractAmount || 0) : ''})`);
  if (ledgerRow)               bits.push(`a REVERSING ledger entry for ${window.fmt ? window.fmt(ledgerRow.amount || 0) : ''} — the original stays, the two net to zero`);
  else if (ledgerRow === null) bits.push('no ledger entry — nothing was ever posted to the books for this order');
  if (o.projectId)             bits.push('its production job, and that job\'s payment record');
  if (o.quoteId)               bits.push('the quote rolls back from "won" so it can be used again');
  if (o.trackingToken)         bits.push('the PUBLIC order-tracking page (the link stops working)');

  // promptDialog, not confirmDialog: type-to-confirm is the house pattern for a
  // destructive action you cannot undo (js/screens/ventures.js does the same for
  // a venture brief), and confirmDialog has no such option. Note promptDialog
  // ESCAPES its message, so this preview is plain text — no markup.
  const phrase = String(o.clientName || '').trim() || 'DELETE';
  const typed = await promptDialog({
    title: 'Delete sales order',
    message: 'This removes:\n\n• ' + bits.join('\n• ')
      + '\n\nThere is no undo. To confirm, type the client name exactly: ' + phrase,
    placeholder: phrase, required: true, confirmLabel: 'Delete order'
  });
  if (typed == null) return;                        // Back / Esc / Cancel
  // Trimmed and case-insensitive: this gets typed on a phone, and the point is
  // deliberate re-reading of the name, not typing accuracy.
  if (String(typed).trim().toLowerCase() !== phrase.toLowerCase()) {
    Notifs.showToast(`Nothing deleted — type "${phrase}" exactly to confirm.`, 'error');
    return;
  }

  const who = (window.userProfile && userProfile.displayName) || (window.currentUser && currentUser.email) || '';
  try {
    // 1) REVERSE THE LEDGER FIRST — the only step that can fail for a reason
    // outside our control (closed period). Abort before destroying anything.
    if (ledgerRow) {
      await window.Ledger.post({
        ref: ledgerRef + '-REV',
        date: (typeof today === 'function') ? today() : window.bizDate(),
        kind: 'debit',                                  // opposite of the original credit
        accountType: 'income', account: 'Sales Revenue', category: 'Sales Revenue',
        description: `REVERSAL — sales order deleted (${o.clientName || ''}${o.quoteNumber ? ' ' + o.quoteNumber : ''}) by ${who}`,
        amount: Number(ledgerRow.amount) || 0,
        source: 'Finance', projectId: o.projectId || null,
        extra: { reversalOf: ledgerRef, reversedBy: who }
      });
    }

    // 2) the PUBLIC tracking page — the only thing visible outside the company
    if (o.trackingToken) {
      await db.collection('order_tracking').doc(o.trackingToken).delete().catch(() => {});
    }

    // 3) roll the quote back so it can be re-used
    if (o.quoteId) {
      await db.collection(qColl).doc(o.quoteId).update({
        status: 'sent',
        salesOrderId: firebase.firestore.FieldValue.delete(),
        projectId:    firebase.firestore.FieldValue.delete()
      }).catch(() => {});
    }

    // 4) the production job
    if (o.projectId) {
      await db.collection('job_projects').doc(o.projectId).delete().catch(() => {});
    }

    // 4b) the auto-created Design project + its folder (files in hub_files are left
    // in place — they remain visible in the Files hub, just unfoldered).
    if (o.designProjectId) {
      await db.collection('projects').doc(o.designProjectId).delete().catch(() => {});
      await db.collection('hub_folders').doc('proj__' + o.designProjectId).delete().catch(() => {});
    }

    // 5) the sales order LAST, through the established delete path (President →
    //    direct; anyone else → a request, though the guard above means only the
    //    President reaches here at all).
    await window.financeExecuteDelete('sales_orders', o.id);

    window.logAudit && window.logAudit('delete', 'sales_order', o.id, {
      client: o.clientName, contract: o.contractAmount,
      ledgerReversed: !!ledgerRow, projectDeleted: !!o.projectId, trackingRevoked: !!o.trackingToken,
      designDeleted: !!o.designProjectId
    });
    if (typeof dbCacheInvalidate === 'function') { dbCacheInvalidate('sales_orders'); dbCacheInvalidate('clients'); }
    Notifs.success('Sales order deleted.');
    onDone && onDone();
  } catch (e) {
    Notifs.showToast('Delete failed: ' + (e.message || e.code || e) + ' — nothing further was removed.', 'error');
  }
};

window.renderSalesOrders = async function(container){
  const c = container || deptContainer();
  // Anyone non-partner can SEE the list (read rule). Recording posts to the ledger,
  // which is open to finance/admin roles OR Finance-DEPARTMENT staff (matching the
  // canFinance() Firestore rule), so a Finance-dept member can register the sale.
  // isFinancePriv() is that same set — and, unlike the literal it replaced, it
  // drops the Corporate Secretary, whom canFinance() also excludes: the old
  // department leg handed them Record Sale / To Production the moment their
  // profile listed Finance, and the ledger write would then have been refused.
  const isFin = isFinancePriv();
  c.innerHTML=window.skeletonHtml('table');
  // Priority is read from and written to the LINKED job_project, not
  // sales_orders.priority. Two reasons: the project is the spine record
  // Production plans off (so Sales and Production can never see different
  // priorities for one job), and firestore.rules gates a sales_orders update to
  // finance/design — a Sales rep tapping a star on their own order would be
  // denied, whereas job_projects allows any non-partner staff a non-money write.
  const [snap, projSnap] = await Promise.all([
    db.collection('sales_orders').orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
    dbCachedGet('job_projects', ()=>db.collection('job_projects').orderBy('createdAt','desc').get(), 45000).catch(()=>({docs:[]}))
  ]);
  const orders = snap.docs.map(d=>({id:d.id,...d.data()}));
  const projById = {};
  projSnap.docs.forEach(d=>{ projById[d.id] = { id:d.id, ...d.data() }; });
  const pending = orders.filter(o=>o.status!=='recorded');
  const totalContract = orders.reduce((s,o)=>s+(o.contractAmount||0),0);
  const totalRecorded = orders.filter(o=>o.status==='recorded').reduce((s,o)=>s+(o.recordedAmount||o.paymentReceived||0),0);
  c.innerHTML = `
    <div class="page-header"><h2>${emojiIcon('🧾',20)} Sales Orders</h2><span style="font-size:12px;color:var(--text-muted)">Record the sale &amp; payment, then hand off to Design</span></div>
    <div class="kpi-row" style="margin-bottom:14px">
      <div class="kpi-card"><div class="kpi-label">Orders</div><div class="kpi-value">${orders.length}</div></div>
      <div class="kpi-card warn"><div class="kpi-label">To Record</div><div class="kpi-value">${pending.length}</div></div>
      <div class="kpi-card green"><div class="kpi-label">Contract ₱</div><div class="kpi-value" style="font-size:15px">₱${fmt(totalContract)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Recorded ₱</div><div class="kpi-value" style="font-size:15px">₱${fmt(totalRecorded)}</div></div>
    </div>
    <div class="card"><div class="card-body" style="padding:0">
    ${!orders.length?`<div class="empty-state" style="padding:24px"><div class="empty-icon">${emojiIcon('🧾',44)}</div><h4>No sales orders yet</h4><p>They appear here when a won quote is converted to a sales order.</p></div>`:
    `<div class="table-wrap"><table class="data-table table-cards">
      <thead><tr><th>Date</th><th>Client / Project</th><th>Priority</th><th>Contract</th><th>Received</th><th>Method</th><th>Receipt</th><th>By</th><th>Status</th><th></th></tr></thead>
      <tbody>${orders.map(o=>`<tr class="so-row">
        <td class="tc-avatar" style="white-space:nowrap">${o.createdAt?.toDate?o.createdAt.toDate().toLocaleDateString('en-PH',{month:'short',day:'numeric'}):''}</td>
        <td class="tc-name"><strong>${escHtml(o.clientName||'')}</strong><div style="font-size:11px;color:var(--text-muted)">${escHtml(o.project||'')}${o.quoteNumber?' · '+escHtml(o.quoteNumber):''} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></div></td>
        <td class="tc-detail" data-label="Priority">${(()=>{
          const pr = o.projectId ? projById[o.projectId] : null;
          if (!pr) return '<span style="font-size:11px;color:var(--text-muted)">—</span>';
          // isPartner() can't write a job_project they don't own, and the star
          // row is the only control here that isn't already gated — render it
          // read-only for them rather than offering a tap that will be refused.
          return window.priorityStarPicker
            ? window.priorityStarPicker({ value: pr.priority, coll:'job_projects', id: pr.id,
                                          editable: !(typeof isPartner==='function' && isPartner()), showLabel:false })
            : escHtml(pr.priority||'—');
        })()}</td>
        <td class="tc-detail" data-label="Contract">₱${fmt(o.contractAmount||0)}</td>
        <td class="tc-detail" data-label="Received">₱${fmt(o.recordedAmount||o.paymentReceived||0)}</td>
        <td class="tc-detail" data-label="Method" style="font-size:12px">${escHtml(o.paymentMethod||'')}</td>
        <td class="tc-detail" data-label="Receipt">${o.receiptUrl?`<a href="${escHtml(o.receiptUrl)}" target="_blank" class="btn-icon">${emojiIcon('📎',16)}</a>`:'—'}</td>
        <td class="tc-detail" data-label="By" style="font-size:11px">${escHtml(o.createdByName||'')}</td>
        <td class="tc-net"><span class="badge ${o.status==='recorded'?'badge-green':'badge-orange'}">${escHtml(o.status||'pending')}</span>${o.autoRecorded?`<span class="badge badge-blue" style="font-size:9px;margin-left:4px" title="Posted to the ledger automatically when the order was created">${emojiIcon('⚡',9)} auto</span>`:''}${o.sentToDesign&&!o.sentToProduction?`<span class="badge badge-purple" style="font-size:9px;margin-left:4px">${emojiIcon('🎨',9)} in design</span>`:''}${o.sentToProduction?`<span class="badge badge-blue" style="font-size:9px;margin-left:4px">${emojiIcon('🏭',9)} in production</span>`:''}</td>
        <td class="tc-actions" style="white-space:nowrap"><button class="btn-secondary btn-sm so-link-btn" data-id="${o.id}" title="Copy the client order-tracking link">${emojiIcon('🔗',16)} Link</button>${isFin?` ${o.status!=='recorded'?`<button class="btn-success btn-sm so-record-btn" data-id="${o.id}">Record Sale</button>`:(o.sentToProduction?`${emojiIcon('✓',16)}`:(o.sentToDesign?`<span title="With the Design team">${emojiIcon('🎨',16)}</span>`:`<button class="btn-secondary btn-sm so-design-btn" data-id="${o.id}">${emojiIcon('🎨',16)} To Design</button>`))}`:''}${(typeof isRealPresident==='function'&&isRealPresident())?` <button class="btn-danger btn-sm so-del-btn" data-id="${o.id}" title="Delete this sales order and everything it created">${emojiIcon('🗑',14)}</button>`:''}</td>
      </tr>`).join('')}</tbody>
    </table></div>`}
    </div></div>`;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  // Card view (≤700px) — tap a row to reveal the full breakdown.
  c.querySelectorAll('tr.so-row').forEach(tr => {
    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('button, a')) return;
      tr.classList.toggle('tc-expanded');
    });
  });
  // Stars repaint themselves in place — no re-render, so a planner re-ranking
  // several orders keeps their scroll position and any expanded rows.
  window.bindPriorityStars && window.bindPriorityStars(c);
  // Tracking link is available to every viewer of this list (non-partner).
  c.querySelectorAll('.so-link-btn').forEach(b=>b.addEventListener('click', async ()=>{
    const o = orders.find(x=>x.id===b.dataset.id); if(!o) return;
    const orig=b.innerHTML; b.disabled=true; b.textContent='…';
    try{ const tok = await window.ensureOrderTracking(o); window.showOrderTrackModal(window.orderTrackUrl(tok), o.clientName||o.project||''); }
    catch(e){ Notifs.showToast('Could not create link: '+(e.message||e.code),'error'); }
    b.disabled=false; b.innerHTML=orig;
  }));
  c.querySelectorAll('.so-del-btn').forEach(b=>b.addEventListener('click', ()=>{
    const o = orders.find(x=>x.id===b.dataset.id); if(!o) return;
    window.deleteSalesOrder(o, ()=>window.renderSalesOrders(container));
  }));
  if(isFin){
    c.querySelectorAll('.so-record-btn').forEach(b=>b.addEventListener('click', ()=>{
      const o = orders.find(x=>x.id===b.dataset.id); if(o) openRecordSaleModal(o, container);
    }));
    c.querySelectorAll('.so-design-btn').forEach(b=>b.addEventListener('click', async ()=>{
      const o = orders.find(x=>x.id===b.dataset.id); if(!o) return;
      await window.transferOrderToDesign(o); window.renderSalesOrders(container);
    }));
  }
};

// vatSplit moved verbatim to js/money-core.js (v14 Wave 2 Batch A —
// money-math tests, spec item I5). money-core.js loads before this file, so
// window.vatSplit is already defined by the time the callers below run.

// Finance records the sale + received payment, posts it to the ledger AND syncs the
// linked project's collected/AR, then optionally hands the job off to Production.
// This is the single bridge that was missing — previously "Record Income" only
// touched the ledger, so the Projects tab never reflected the money or the handoff.
async function openRecordSaleModal(o, container){
  const contract = o.contractAmount||0;
  const salesNoted = o.paymentReceived||0;
  const defaultAmt = o.recordedAmount||salesNoted||0;
  const bankOpts = await window.BankAccounts.optionsHTML(o.bankAccountId);
  const _panel = openPage(`${emojiIcon('💵',16)} Register Sale — `+escHtml(o.clientName||''), `
    <div class="card" style="margin-bottom:12px"><div class="card-body" style="padding:10px 14px;font-size:12px">
      <div style="font-weight:700;margin-bottom:6px">${emojiIcon('📋',16)} Sales Order Terms</div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:3px 12px">
        <span style="color:var(--text-muted)">Client / Project</span><span style="text-align:right">${escHtml(o.clientName||'')}${o.project?' · '+escHtml(o.project):''}</span>
        <span style="color:var(--text-muted)">Quote</span><span style="text-align:right">${escHtml(o.quoteNumber||'—')}</span>
        <span style="color:var(--text-muted)">Contract amount</span><span style="text-align:right;font-weight:700">₱${fmt(contract)}</span>
        <span style="color:var(--text-muted)">Payment noted by Sales</span><span style="text-align:right">₱${fmt(salesNoted)} ${o.paymentMethod?'· '+escHtml(o.paymentMethod):''}</span>
        ${o.notes?`<span style="color:var(--text-muted)">Terms / notes</span><span style="text-align:right">${escHtml(o.notes)}</span>`:''}
        ${o.receiptUrl?`<span style="color:var(--text-muted)">Receipt</span><span style="text-align:right"><a href="${escHtml(o.receiptUrl)}" target="_blank">${emojiIcon('📎',16)} View proof</a></span>`:''}
      </div>
    </div></div>
    <div style="font-size:12px;font-weight:700;margin-bottom:6px">${emojiIcon('✅',12)} Approve the collected amount</div>
    <div class="form-row">
      <div class="form-group"><label>Approved collected (₱)</label><input id="rs-amount" type="number" step="0.01" min="0" value="${defaultAmt}" inputmode="decimal"/>
        <div style="font-size:11px;color:var(--text-muted);margin-top:3px">Confirm what Finance actually received per the order terms.</div></div>
      <div class="form-group"><label>Method</label><select id="rs-method" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
        ${['Bank Transfer','GCash','Cash','Cheque','Other'].map(m=>`<option ${o.paymentMethod===m?'selected':''}>${m}</option>`).join('')}
      </select></div>
    </div>
    <div class="form-group"><label>Deposited to (company account)</label>
      <select id="rs-bankacct" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${bankOpts}</select>
      <div style="font-size:11px;color:var(--text-muted);margin-top:3px">Which company account received the cash — feeds the Bank Accounts balance. Further collections for this job are recorded on the linked Project (Projects → ${emojiIcon('💵',16)} Record Payment).</div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>VAT treatment</label>
        <select id="rs-vat" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
          <option value="inclusive" selected>VAT-inclusive — 12% already in the amount</option>
          <option value="exclusive">VAT-exclusive — add 12% on top</option>
          <option value="exempt">VAT-exempt / Zero-rated — no VAT</option>
        </select>
        <div style="font-size:11px;color:var(--text-muted);margin-top:3px">Pick what the quote/sales order specified — it varies per deal.</div>
      </div>
      <div class="form-group"><label>OR / Reference No.</label><input id="rs-ref" placeholder="Official Receipt no."/>${window.birOrButtonHTML ? window.birOrButtonHTML('rs-ref') : ''}</div>
    </div>
    <div class="card" style="margin:6px 0"><div class="card-body" style="padding:8px 14px;font-size:12px;display:grid;grid-template-columns:1fr auto;gap:2px 12px">
      <span style="color:var(--text-muted)">Recorded total (to ledger &amp; project)</span><span id="rs-appr" style="text-align:right;font-weight:700;color:var(--success)">₱${fmt(defaultAmt)}</span>
      <span style="color:var(--text-muted)">Net of VAT</span><span id="rs-net" style="text-align:right">₱${fmt(+(defaultAmt/1.12).toFixed(2))}</span>
      <span style="color:var(--text-muted)">Output VAT (12%)</span><span id="rs-vatamt" style="text-align:right">₱${fmt(+(defaultAmt-defaultAmt/1.12).toFixed(2))}</span>
      <span style="color:var(--text-muted)">Balance after this</span><span id="rs-bal" style="text-align:right;font-weight:700">₱${fmt(Math.max(0,contract-defaultAmt))}</span>
    </div></div>
    <!-- CHECKED BY DEFAULT and it starts a production job, so the state has to be
         unmistakable and the tap target real. NOT inside a .form-group, so the
         css/styles.css ~345 checkbox carve-out never reached it and the old inline
         16x16 was sizing it alone; class check-row (styles.css ~385) now gives the
         shared 18px box and a 44px-tall label. display:flex is kept over the
         convention's inline-flex so the whole row, not just the text, is tappable;
         gap/align-items/cursor are dropped because check-row supplies them. -->
    <label class="check-row" style="display:flex;font-size:13px;margin-top:4px">
      <input type="checkbox" id="rs-prod" checked/> Send to Design now (start drawings)
    </label>
    <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Posts income to the ledger (with VAT split), updates the project's collected balance, and hands the job to the Design team for drawings.</div>
    <div id="rs-err" class="error-msg hidden" style="margin-top:8px"></div>
  `, `<button class="btn-primary" id="rs-save">Approve &amp; Record</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
  window.wireBirOrButtons && window.wireBirOrButtons();
  // ⚠ SCOPED TO THIS PANEL, NOT document. openPage keeps a CLOSING page in the
  // DOM for ~300ms; register a second sale inside that window and two panels
  // carry the same ids, with document.getElementById() resolving into the DYING
  // one. This is the money-critical case: the ledger post would take the
  // PREVIOUS order's approved amount, VAT treatment, method, OR number and bank
  // account and book them against THIS sales order.
  const $ = (id) => _panel.querySelector('#' + id);
  const recompute=()=>{
    const entered=parseFloat($('rs-amount').value)||0;
    const t=$('rs-vat').value;
    const { recorded, net, vat }=window.vatSplit(entered,t);
    $('rs-appr').textContent='₱'+fmt(recorded);
    $('rs-net').textContent='₱'+fmt(net);
    $('rs-vatamt').textContent='₱'+fmt(vat);
    $('rs-bal').textContent='₱'+fmt(Math.max(0,contract-recorded));
  };
  $('rs-amount').addEventListener('input',recompute);
  $('rs-vat').addEventListener('change',recompute);
  $('rs-save').addEventListener('click', async ()=>{
    const err=$('rs-err');
    const saveBtn=$('rs-save');
    const entered=parseFloat($('rs-amount').value)||0;
    if(entered<0){ err.textContent='Amount cannot be negative.'; err.classList.remove('hidden'); return; }
    const method=$('rs-method').value, orRef=$('rs-ref').value.trim();
    const toDesign=$('rs-prod').checked;
    const who=userProfile?.displayName||currentUser.email;
    const vatTreatment=$('rs-vat').value;
    // `amount` = recorded total (the cash figure that hits the ledger + project balance)
    const { recorded:amount, net, vat:vatAmount }=window.vatSplit(entered,vatTreatment);
    // Guard the common foot-gun: entering the VAT-inclusive contract price as
    // "exclusive" grosses it up 12% over the contract → phantom over-collection.
    if(contract>0 && amount > contract + 0.5 && !(await confirmDialog({message:`Recorded total ₱${fmt(amount)} exceeds the contract ₱${fmt(contract)} (VAT-${vatTreatment}). Record anyway?`}))){ return; }
    const acctSel = $('rs-bankacct').value;
    if (amount > 0 && !acctSel && (await window.BankAccounts.list()).length) {
      err.textContent = 'Select the company account that received this payment.'; err.classList.remove('hidden'); return;
    }
    const acct = await window.BankAccounts.pick(acctSel);
    saveBtn.disabled=true; // guard against double-click double-posting
    try{
      // v13 Phase 13 (C6) — Ledger.post's deterministic id (SO-<id>) replaces the
      // fail-open .where('refNumber',...).catch(()=>({empty:true})) dupe guard,
      // AND calls assertPeriodOpen unconditionally — this closes the period-lock
      // gap Record Sale previously had (money could post into a closed month).
      let ledgerId=null;
      if(amount>0){
        const ledgerRef=`SO-${o.id}`;
        // Deterministic doc id == sanitize(ref) (no '/' in this ref scheme) — known
        // up front, so the payments-array leg can carry the real ledgerId instead
        // of a placeholder, same as the pre-migration two-step wrote it.
        const precomputedLedgerId = window.Ledger._sanitize(ledgerRef);
        // 1) ledger credit (Sales Revenue → feeds Output-VAT base), atomically
        //    synced with the linked project's collected/AR/payments/documents/
        //    timeline (previously a separate best-effort update after the ledger
        //    write — now the same transaction, so they can never drift apart).
        let projectSync = null;
        if (o.projectId) {
          const ps = await db.collection('job_projects').doc(o.projectId).get();
          if (ps.exists) {
            const p = ps.data();
            const newCollected = (p.amountCollected||0) + amount;
            const newAR = Math.max(0, (p.contractAmount||contract) - newCollected);
            const fields = { amountCollected:newCollected, arBalance:newAR, updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
              payments:firebase.firestore.FieldValue.arrayUnion({ type:'Sales Order Payment', amount, vatAmount, net, method, orRef, date:today(), by:who, ledgerId:precomputedLedgerId, bankAccountId: acct.bankAccountId||null, bankAccountName: acct.bankAccountName||null }),
              documents:firebase.firestore.FieldValue.arrayUnion({ type:'Official Receipt', ref:orRef||('₱'+window.fmtN2(amount)), at:new Date().toISOString(), by:who }),
              timeline:firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:`Sale recorded ₱${window.fmtN2(amount)} by Finance`, by:who }) };
            if (newAR<=0) fields.stage='paid';
            projectSync = { collection:'job_projects', docId:o.projectId, fields };
            if (o.trackingToken) window.syncOrderTracking(o.trackingToken, { paid:newCollected, balance:newAR });
          }
        }
        const res = await window.Ledger.post({
          ref: ledgerRef, date: today(), kind: 'credit',
          accountType: 'income', account: 'Sales Revenue', category: 'Sales Revenue',
          description: `Sales order — ${o.clientName}${o.quoteNumber?' ('+o.quoteNumber+')':''}`,
          amount, source: 'Finance', projectId: o.projectId||null,
          extra: { net, vatAmount, vatTreatment, ...window.BankAccounts.tag(acct,'in') },
          ...(projectSync ? { projectSync } : {})
        });
        if (res.existed) { closeModal(); Notifs.showToast('This sales order was already recorded.','error'); window.renderSalesOrders(container); return; }
        ledgerId = res.id;
      }
      // 2) mark the sales order recorded
      await db.collection('sales_orders').doc(o.id).update({ status:'recorded', recordedAmount:amount, recordedAt:firebase.firestore.FieldValue.serverTimestamp(), recordedBy:who, bankAccountId: acct.bankAccountId||null, bankAccountName: acct.bankAccountName||null });
      window.logAudit&&window.logAudit('create','ledger',ledgerId,{source:'sales_order', amount, client:o.clientName});
      // 4) optional handoff to Design — every recorded sale routes through Design
      // first now; transferOrderToDesign auto-creates the design project.
      const sentToDesign = toDesign ? await window.transferOrderToDesign({ ...o, status:'recorded' }) : false;
      closeModal();
      Notifs.success(sentToDesign ? 'Sale recorded + sent to Design'
        : (toDesign ? 'Sale recorded to ledger — the Design hand-off did not complete; use "To Design" on the order to finish it.' : 'Sale recorded to ledger'));
      window.renderSalesOrders(container);
    }catch(ex){ err.textContent='Failed: '+(ex.message||ex.code); err.classList.remove('hidden'); saveBtn.disabled=false; }
  });
}

// Sales→Production handoff gate (owner's rule, 2026-08): "Target date + Notes +
// Priority must ALREADY be entered by Sales" before a job can be sent to
// Production. If any is missing on the order, blocks with an inline "fill it in
// now" page (same fields Sales could have set on openSalesOrderModal) instead of
// transferring silently incomplete — Production would otherwise have to chase
// Sales for this. Returns a Promise<boolean>: true once all three are present
// (immediately, or right after the user saves them here), false if cancelled.
function ensureProdHandoffFields(o){
  return new Promise(resolve=>{
    const hasAll = !!((o.targetDate||'').trim() && (o.notes||'').trim() && (o.priority||'').trim());
    if (hasAll) { resolve(true); return; }
    const _panel = openPage(`${emojiIcon('🏭',16)} Before sending to Production`, `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">Target date, priority and notes weren't all set yet — Production needs them before the job can start.</div>
      <div class="form-row">
        <div class="form-group"><label>Target Date</label><input id="ph-date" type="date" value="${escHtml(o.targetDate||'')}"/></div>
        <div class="form-group"><label>Priority</label>
          <select id="ph-priority" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
            <option value="">Select…</option>
            ${['Urgent','High','Normal','Low'].map(pr=>`<option value="${pr}" ${o.priority===pr?'selected':''}>${pr}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group"><label>Notes for Production</label><textarea id="ph-notes" rows="3" placeholder="What to build, special instructions…">${escHtml(o.notes||'')}</textarea></div>
      <div id="ph-err" class="error-msg hidden"></div>
    `, `<button class="btn-primary" id="ph-save">Save &amp; Send to Production</button><button class="btn-secondary" id="ph-cancel">Cancel</button>`);
    // ⚠ SCOPED TO THIS PANEL, NOT document — a closing hand-off panel lingers
    // ~300ms and would win the getElementById race, so this save could stamp the
    // PREVIOUS order's target date, priority and Production notes onto this one.
    const $ = (id) => _panel.querySelector('#' + id);
    $('ph-cancel').addEventListener('click', ()=>{ closeModal(); resolve(false); });
    $('ph-save').addEventListener('click', () => window.busy($('ph-save'), async ()=>{
      const err=$('ph-err');
      const targetDate=$('ph-date').value;
      const priority=$('ph-priority').value;
      const notes=$('ph-notes').value.trim();
      if(!targetDate || !priority || !notes){ err.textContent='Target date, priority and notes are all required before sending to Production.'; err.classList.remove('hidden'); return; }
      try{
        if (o.id) await db.collection('sales_orders').doc(o.id).update({ targetDate, priority, notes });
        if (o.projectId) await db.collection('job_projects').doc(o.projectId).update({ targetDate, priority, notes });
        o.targetDate=targetDate; o.priority=priority; o.notes=notes;
        closeModal(); resolve(true);
      }catch(ex){ err.textContent='Save failed: '+(ex.message||ex.code); err.classList.remove('hidden'); }
    }));
  });
}

// Finance→Design handoff (owner's flow, 2026-08-11): every recorded sale goes to
// Design first. Auto-creates the Design-board project (collection `projects`, NOT
// job_projects), advances the job spine won→in_design, stamps the SO, syncs the
// public tracker to 'design', notifies Design. Idempotent: re-running finds the
// existing design project by salesOrderId instead of creating a twin.
// Returns Promise<boolean> like transferOrderToProduction.
window.transferOrderToDesign = async function(o){
  const who = userProfile?.displayName || currentUser.email;
  try{
    // 1) idempotence — an existing design project for this SO wins
    let designProjectId = o.designProjectId || null;
    if (!designProjectId){
      const ex = await db.collection('projects').where('salesOrderId','==',o.id).limit(1).get().catch(()=>({docs:[]}));
      if (ex.docs.length) designProjectId = ex.docs[0].id;
    }
    // 2) resolve the job project number for the display name
    let jobProjectNo = '';
    if (o.projectId){ try{ const ps = await db.collection('job_projects').doc(o.projectId).get(); if (ps.exists) jobProjectNo = ps.data().projectNo || ''; }catch(_){} }
    // 3) create the design project if missing (§3.1 shape)
    if (!designProjectId){
      const name = ((o.clientName||'Client')+' — '+(jobProjectNo||o.quoteNumber||'Order')).trim();
      const ref = await db.collection('projects').add({
        name, client:o.clientName||'', clientId:o.clientId||null,
        source:'sales_order', salesOrderId:o.id,
        jobProjectId:o.projectId||null, jobProjectNo:jobProjectNo||null,
        startDate:(window.bizDate?window.bizDate():new Date().toISOString().slice(0,10)),
        dueDate:o.targetDate||'', contractAmount:0, notes:'', status:'active',
        needsDrawings:null, productionHandoffAt:null,
        createdBy:currentUser.uid, createdByName:who,
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      designProjectId = ref.id;
      // typed folder — the SO folder IS the project folder (deterministic proj__ id)
      try { await window.DesignFolders.ensureProjectFolder(
        { id:designProjectId, name, client:o.clientName||'', clientId:o.clientId||null },
        { folderType:'sales_order', salesOrderId:o.id }); } catch(_){}
    }
    // 4) advance the job spine won → in_design (never drag a later stage backwards)
    if (o.projectId){
      const ps = await db.collection('job_projects').doc(o.projectId).get();
      if (ps.exists){
        const upd = { designProjectId, updatedAt:firebase.firestore.FieldValue.serverTimestamp() };
        if (ps.data().stage === 'won'){
          upd.stage = 'in_design';
          upd.timeline = firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:'Moved to In Design (sale recorded)', by:who });
        }
        await db.collection('job_projects').doc(o.projectId).update(upd);
      }
    }
    // 5) stamp the sales order
    await db.collection('sales_orders').doc(o.id).update({ sentToDesign:true,
      sentToDesignAt:firebase.firestore.FieldValue.serverTimestamp(), designProjectId });
    // 6) public client tracker
    if (o.trackingToken) window.syncOrderTracking(o.trackingToken, { status:'design' });
    // 7) notify the Design department (§6.1)
    try{ await Notifs.sendToDept('Design',{ title:'🎨 New order for design',
      body:`${o.clientName||'Client'}${jobProjectNo?' ('+jobProjectNo+')':''} — sale recorded by Finance. Prepare the drawings, then send to Production.`,
      icon:'🎨', type:'project_stage', link:'dept:Design' }, { fallbackToOwner:true }); }catch(_){}
    window.logAudit && window.logAudit('update','sales_order',o.id,{ sentToDesign:true, designProjectId });
    if (typeof dbCacheInvalidate==='function'){ dbCacheInvalidate('projects-unified'); dbCacheInvalidate('sales_orders'); }
    o.sentToDesign = true; o.designProjectId = designProjectId;
    return true;
  }catch(ex){ Notifs.showToast('Transfer to Design failed: '+(ex.message||ex.code),'error'); return false; }
};

// Advance the linked project to In Production and notify the Production team.
// Returns false (no-op) if the Sales→Production handoff fields are missing and
// the user cancels the fill-in prompt; true on a completed transfer.
async function transferOrderToProduction(o){
  const ok = await ensureProdHandoffFields(o);
  if (!ok) return false;
  // Owner's flow, 2026-08-18: Design "passes to sales for approval, and once
  // approved, forwards to production". Until now nothing checked that — the
  // released-drawings prompt in the Design hub is a soft confirm anyone can
  // click through, and Sales had no say at any point. This is the real gate,
  // and it reads the job project because that is where the Sales sign-off is
  // recorded (see setDesignApproval, js/screens/production.js). An order marked
  // noDrawingsNeeded is the documented way past it.
  if (o.projectId && !o.noDrawingsNeeded) {
    // jobDesignApproved lives in production.js, which is lazy (PERF-WAVE1).
    // Load it, and if it STILL isn't there, fail CLOSED — the catch below is
    // for Firestore read failures; letting a missing function fall through it
    // would silently skip the Sales-approval gate (verifier finding,
    // 2026-08-24; gate itself is the owner's 2026-08-18 ruling).
    if (typeof window.jobDesignApproved !== 'function' && window.ensureScript) {
      try { await window.ensureScript('js/screens/production.js'); } catch(_){}
    }
    if (typeof window.jobDesignApproved !== 'function') {
      Notifs.showToast('Could not verify Sales drawing approval — check your connection and try again.', 'error');
      return false;
    }
    try {
      const ps = await db.collection('job_projects').doc(o.projectId).get();
      if (ps.exists && !window.jobDesignApproved({ id:o.projectId, ...ps.data() }, o)) {
        const a = (ps.data().designApproval || {});
        Notifs.showToast(a.status === 'pending'
          ? 'Sales has not approved the drawings yet — this job cannot go to Production until they do.'
          : a.status === 'changes'
            ? 'Sales asked for changes to the drawings. Resolve them and send to Sales again before handing this to Production.'
            : 'Send the drawings to Sales for approval first — open the job in Projects and use "Send drawings to Sales".', 'error');
        return false;
      }
    } catch(_) { /* read failed — fall through rather than strand the job */ }
  }
  const who=userProfile?.displayName||currentUser.email;
  try{
    if(o.projectId){
      const ps=await db.collection('job_projects').doc(o.projectId).get();
      const stage=ps.exists?ps.data().stage:null;
      if(ps.exists && ['won','in_design'].includes(stage)){
        await db.collection('job_projects').doc(o.projectId).update({ stage:'in_production', updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
          timeline:firebase.firestore.FieldValue.arrayUnion({ at:new Date().toISOString(), event:'Moved to In Production (sale recorded)', by:who }) });
      }
    }
    await db.collection('sales_orders').doc(o.id).update({ sentToProduction:true,
      sentToProductionAt:firebase.firestore.FieldValue.serverTimestamp(),
      designDoneAt:firebase.firestore.FieldValue.serverTimestamp(), designDoneBy:who });
    if(o.trackingToken) window.syncOrderTracking(o.trackingToken, { status:'production' });
    try{ await Notifs.sendToDept('Production',{ title:'🏭 New job to produce', body:`${o.clientName} — design complete${o.noDrawingsNeeded?' (no drawings needed)':''}. Create the production order.`, icon:'🏭', type:'project_stage', link:'projects-lifecycle' }, { fallbackToOwner:true }); }catch(_){}
    window.logAudit&&window.logAudit('update','sales_order',o.id,{ sentToProduction:true });
    return true;
  }catch(ex){ Notifs.showToast('Transfer failed: '+(ex.message||ex.code),'error'); return false; }
}

// bindQuoteActions — moved verbatim to js/screens/sales.js (Wave 7 Pass 2, 2026-08-03), next to renderBSQuotationsSummary which it serves.

// Brilliant Steel Client Data — moved verbatim to js/screens/partners.js
// (Wave 7 Pass 6, 2026-08-03): async function renderBSClientData. Called
// from partners.js's own loadBSContent (bare-global, same file) and reads
// window.getBsQuotesOrdered, which stays here (see its comment above) —
// same cross-file, runtime-only resolution every other pass documents.

// renderApprovals + approveQuoteApproval/returnQuoteToPartner/openQuoteApprovalReview — moved verbatim to js/screens/approvals.js (Wave 7 Pass 8, 2026-08-03). See that file's header for the full boundary explanation; svc-approvals.js (Approvals.dispatch) remains the write-path service this UI calls.

// SALES — AEC PARTNER DIRECTORY (types/stages/regions/meta helpers) — moved verbatim to js/screens/sales.js (Wave 7 Pass 2, 2026-08-03). nextCounterId right below stays here (shared helper — also used by job_projects/production_orders).

// Generalized atomic sequence via _counters/{counterName} (Phase 15).
// seedFn (optional): async () => number — a one-time floor computed BEFORE
// the transaction (e.g. an existing collection's current row count), used
// only the first time the counter doc doesn't exist yet, so IDs minted
// pre-migration aren't reissued. formatFn (optional): number => value —
// shapes the raw sequence integer into the caller's ID string; omit to get
// the plain integer back (see nextAECNumber below).
async function nextCounterId(counterName, seedFn, formatFn){
  const ref = db.collection('_counters').doc(counterName);
  let seed = 0;
  try {
    const pre = await ref.get();
    if (!pre.exists && typeof seedFn === 'function') seed = (await seedFn()) || 0;
  } catch(_) {}
  return db.runTransaction(async t => {
    const cur  = await t.get(ref);
    const base = Math.max(cur.exists ? (cur.data().count || 0) : 0, seed);
    const next = base + 1;
    t.set(ref, { count: next }, { merge:true });
    return typeof formatFn === 'function' ? formatFn(next) : next;
  });
}

// nextAECNumber / renderAECDirectory (incl. its local openAECDetail/openAECPrintSheet) — moved verbatim to js/screens/sales.js (Wave 7 Pass 2, 2026-08-03). See that file's header for the load-order contract.
// ══════════════════════════════════════════════════
//  SHARED: Client Profiles
// ══════════════════════════════════════════════════
// CRM lifecycle stages (shared by all three client CRMs).
const CRM_STAGES = [
  { key:'lead',     label:'Lead',     color:'#8e8e93',               icon:'🌱' },
  { key:'prospect', label:'Prospect', color:'#FFAA00',               icon:'🔥' },
  { key:'won',      label:'Won',      color:'var(--success,#30D158)', icon:'✅' },
  { key:'lost',     label:'Lost',     color:'var(--danger,#e5484d)',  icon:'✖️' },
];
function crmStageOf(cl){ return ['lead','prospect','won','lost'].includes(cl && cl.stage) ? cl.stage : 'lead'; }
function crmStageMeta(k){ return CRM_STAGES.find(s=>s.key===k) || CRM_STAGES[0]; }
window.CRM_STAGES = CRM_STAGES; window.crmStageOf = crmStageOf; window.crmStageMeta = crmStageMeta;

async function renderClientProfiles(container, currentUser, currentRole, brand) {
  // Unified book, cached read, canEditDept gating (decisions 1/10/14).
  // quoteColl/builderNav are GONE: the hub joins quotes via clientId/nameKey across
  // all collections (Spec 2c) and derives the builder per quote (Spec 4).
  const COLL = 'clients';
  const brandKey = window.Clients.brandOf(brand);           // 'sales' | 'design' | 'bs'
  const clients  = await window.Clients.listAll({ brand: brandKey });
  const legacyMode = clients.some(c => c._legacy);          // migration not yet run
  const dept = window.Clients.deptOf(brand);
  const canAdd = !legacyMode && (canEditDept(dept) || (brand === 'barro' && currentRole === 'agent'));
  const canDeleteDirect = !legacyMode && (currentRole==='president'||currentRole==='owner'||currentRole==='manager');
  const today = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10));

  const counts = { all: clients.length, lead:0, prospect:0, won:0, lost:0 };
  clients.forEach(c=>counts[crmStageOf(c)]++);
  const isOpen = c => { const s=crmStageOf(c); return s!=='won' && s!=='lost'; };
  const dueFollowups = clients.filter(c=>c.followUpDate && c.followUpDate <= today && isOpen(c)).length;
  let stageFilter = 'all';

  const chips = [{key:'all',label:'All',count:counts.all}, ...CRM_STAGES.map(s=>({key:s.key,label:s.label,icon:emojiIcon(s.icon,14),count:counts[s.key]}))];

  container.innerHTML = `
    ${legacyMode && ['president','manager'].includes(currentRole) ? `
      <div class="alert-banner alert-warn" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span>${emojiIcon('🧭',16)} Client books not yet unified — showing the legacy read-only view.</span>
        <button class="btn-primary btn-sm" id="cl-migrate-btn">Unify client books</button>
      </div>` : legacyMode ? `<div class="alert-banner" style="margin-bottom:10px">${emojiIcon('🧭',16)} Read-only until an admin unifies the client books.</div>` : ''}
    ${dueFollowups?`<div class="alert-banner alert-warn" style="margin-bottom:10px"><span>${emojiIcon('⏰',16)} <strong>${dueFollowups}</strong> follow-up${dueFollowups>1?'s':''} due</span></div>`:''}
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      ${window.chipTabs(chips, 'all', {cls:'cl-stage-tabs'})}
      ${canAdd?`<button class="btn-primary btn-sm" id="add-client-btn">+ Add Client</button>`:''}
    </div>
    <div id="cl-list"></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  const clientCard = cl => {
    const st = crmStageMeta(crmStageOf(cl));
    const fu = cl.followUpDate || '';
    const fuOverdue = fu && fu <= today && isOpen(cl);
    return `<div class="item-card cl-card" data-id="${cl.id}" data-name="${escHtml(cl.name||'')}" style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;cursor:pointer">
      <div style="flex:1;min-width:0">
        <div class="item-title">${escHtml(cl.name)} <span class="badge" style="font-size:9px;background:${st.color};color:var(--on-primary)">${st.icon} ${st.label}</span>${cl.deleteRequested?` <span class="badge badge-red" style="font-size:9px">${emojiIcon('🗑',9)} del req</span>`:''}</div>
        <div class="item-meta">
          ${cl.company?`<span>${emojiIcon('🏢',16)} ${escHtml(cl.company)}</span>`:''}
          ${cl.email?`<span>${emojiIcon('✉️',16)} ${escHtml(cl.email)}</span>`:''}
          ${cl.phone?`<span>${emojiIcon('📞',16)} ${escHtml(cl.phone)}</span>`:''}
          ${cl.lastQuoteNumber?`<span>${emojiIcon('📄',16)} ${escHtml(cl.lastQuoteNumber)}</span>`:''}
          ${fu?`<span style="color:${fuOverdue?'var(--danger)':'var(--text-muted)'}">${emojiIcon('⏰',16)} ${escHtml(fu)}${fuOverdue?' · due':''}</span>`:''}
        </div>
        <div style="font-size:11px;color:var(--primary);margin-top:4px">${emojiIcon('📄',11)} View quotes / reopen →</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
        ${canAdd?`<button class="btn-secondary btn-sm cl-edit-btn" data-id="${cl.id}" title="Edit / set stage">${emojiIcon('✎',16)}</button>`:''}
        ${canDeleteDirect
          ? `<button class="btn-secondary btn-sm cl-del-btn" data-id="${cl.id}" data-name="${escHtml(cl.name||'')}" style="color:var(--danger)" aria-label="Delete client">${emojiIcon('trash-2',14)}</button>`
          : `<button class="btn-secondary btn-sm cl-delreq-btn" data-id="${cl.id}" data-name="${escHtml(cl.name||'')}" ${cl.deleteRequested?'disabled':''}>${cl.deleteRequested?`${emojiIcon('⏳',16)}`:emojiIcon('trash-2',14)}</button>`}
      </div>
    </div>`;
  };

  const openClientEditor = (cl) => {
    const e = cl || {};
    const _panel = openPage(cl?'Edit Client':'Add Client', `
      <div class="form-group"><label>Name</label><input id="cl-name" value="${escHtml(e.name||'')}" placeholder="Client full name"/></div>
      <div class="form-group"><label>Company</label><input id="cl-company" value="${escHtml(e.company||'')}" placeholder="Company name"/></div>
      <div class="form-row">
        <div class="form-group"><label>Email</label><input id="cl-email" type="email" value="${escHtml(e.email||'')}"/></div>
        <div class="form-group"><label>Phone</label><input id="cl-phone" type="tel" value="${escHtml(e.phone||'')}"/></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Stage</label><select id="cl-stage" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">${CRM_STAGES.map(s=>`<option value="${s.key}" ${crmStageOf(e)===s.key?'selected':''}>${s.icon} ${s.label}</option>`).join('')}</select></div>
        <div class="form-group"><label>Follow-up date</label><input id="cl-followup" type="date" value="${escHtml(e.followUpDate||'')}"/></div>
      </div>
      <div class="form-group"><label>Address</label><textarea id="cl-address" rows="2">${escHtml(e.address||'')}</textarea></div>
      <div class="form-group"><label>Notes</label><textarea id="cl-notes" rows="2">${escHtml(e.notes||'')}</textarea></div>
    `, `<button class="btn-primary" id="save-client-btn">${cl?'Save':'Save Client'}</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    // ⚠ SCOPED TO THIS PANEL, NOT document. openPage keeps a CLOSING page in the
    // DOM for ~300ms, so editing a second client inside that window puts two
    // #save-client-btn / #cl-name in the DOM and document.getElementById()
    // resolves into the DYING one — the visible Save does nothing, and worse,
    // the save that DOES run reads the PREVIOUS client's fields and writes them
    // onto this client's record. This is the Corporate Secretary's 2026-08-10
    // "the Edit form needs several taps" report.
    const $ = (id) => _panel.querySelector('#' + id);
    $('save-client-btn').addEventListener('click', async () => {
      const name = $('cl-name').value.trim();
      if (!name) { Notifs.showToast('Name is required.','error'); return; }
      const data = {
        name, company: $('cl-company').value.trim(),
        email: $('cl-email').value.trim(),
        phone: $('cl-phone').value.trim(),
        address: $('cl-address').value.trim(),
        notes: $('cl-notes').value.trim(),
        stage: $('cl-stage').value,
        followUpDate: $('cl-followup').value || '',
        lastContact: today,
        nameKey: window.Clients.nameKey(name),                       // keep the join key in sync on rename
        ...(cl ? {} : { brands: [brandKey], contactLog: [] }),       // brand membership on create only
      };
      try {
        if (cl) { await db.collection(COLL).doc(cl.id).update(data); window.logAudit&&window.logAudit('update','client',cl.id,{name,stage:data.stage}); }
        else { data.addedBy=currentUser.uid; data.createdAt=firebase.firestore.FieldValue.serverTimestamp(); await db.collection(COLL).add(data); }
        if (typeof dbCacheInvalidate==='function') dbCacheInvalidate('clients');
        closeModal(); Notifs.success('Client saved'); renderClientProfiles(container, currentUser, currentRole, brand);
      } catch(ex){ Notifs.showToast('Save failed: '+(ex.message||ex.code),'error'); }
    });
  };

  const bindCards = () => {
    container.querySelectorAll('.cl-card').forEach(card => card.addEventListener('click', (e) => {
      if (e.target.closest('.cl-del-btn, .cl-delreq-btn, .cl-edit-btn')) return;
      const cl = clients.find(c=>c.id===card.dataset.id); if(!cl) return;
      openClientHub(cl, { canEdit: canAdd, onChange: () => renderClientProfiles(container, currentUser, currentRole, brand) });
    }));
    container.querySelectorAll('.cl-edit-btn').forEach(b => b.addEventListener('click', () => openClientEditor(clients.find(c=>c.id===b.dataset.id))));
    container.querySelectorAll('.cl-del-btn').forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmDialog({message:`Delete client "${escHtml(b.dataset.name)}"? This cannot be undone.`, danger:true, html:true}))) return;
      try {
        await db.collection(COLL).doc(b.dataset.id).delete(); window.logAudit&&window.logAudit('delete','client',b.dataset.id,{name:b.dataset.name});
        if (typeof dbCacheInvalidate==='function') dbCacheInvalidate('clients');
        Notifs.success('Client deleted'); renderClientProfiles(container, currentUser, currentRole, brand);
      }
      catch(ex){ Notifs.showToast('Delete failed','error'); }
    }));
    container.querySelectorAll('.cl-delreq-btn').forEach(b => b.addEventListener('click', async () => {
      const reason = (await promptDialog({message:'Reason for deleting this client folder? (sent to the president for approval)', required:true, multiline:true}))||'';
      try {
        await db.collection(COLL).doc(b.dataset.id).update({ deleteRequested:true, deleteReason:reason, deleteRequestedBy:currentUser.uid, deleteRequestedAt:firebase.firestore.FieldValue.serverTimestamp() });
        if (typeof dbCacheInvalidate==='function') dbCacheInvalidate('clients');
        await Notifs.sendToOwner({ title:'🗑 Client Delete Requested', body:`${userProfile?.displayName||currentUser.email} requests deleting client "${b.dataset.name}".${reason?' Reason: '+reason:''}`, icon:'🗑', type:'client_delete_request', link:'approvals' });
        Notifs.success('Delete request sent to president'); renderClientProfiles(container, currentUser, currentRole, brand);
      } catch(ex){ Notifs.showToast('Request failed: '+(ex.message||ex.code),'error'); }
    }));
  };

  const renderList = () => {
    const shown = stageFilter==='all' ? clients : clients.filter(c=>crmStageOf(c)===stageFilter);
    const el = document.getElementById('cl-list'); if(!el) return;
    el.innerHTML = !shown.length
      ? `<div class="empty-state"><div class="empty-icon">${emojiIcon('👤',44)}</div><h4>No clients${stageFilter!=='all'?' in this stage':' yet'}</h4></div>`
      : `<div class="item-list">${shown.map(clientCard).join('')}</div>`;
    if (window.lucide) lucide.createIcons({ nodes: [el] });
    bindCards();
  };

  window.bindChipTabs(container.querySelector('.cl-stage-tabs'), (key)=>{ stageFilter=key; renderList(); });
  document.getElementById('add-client-btn')?.addEventListener('click', ()=>openClientEditor(null));
  document.getElementById('cl-migrate-btn')?.addEventListener('click', async () => {
    if (!(await confirmDialog({message:'Unify sales/design/BS client books into one CRM? Safe to re-run — already-migrated records are skipped.'}))) return;
    Notifs.showToast('Migrating client books…');
    try {
      // migrations.js is lazy (PERF-WAVE1) — this button renders on Design/
      // Sales/BS client tabs whose page sets don't include it.
      if (!window.migrateClientBooks && window.ensureScript) await window.ensureScript('js/migrations.js');
      const r = await window.migrateClientBooks();
      window.logAudit && window.logAudit('migrate','clients',null,r);
      Notifs.success(`Done: ${r.created} created, ${r.merged} merged, ${r.soTagged+r.jpTagged} records linked, ${r.unmatched} left name-matched.`);
      renderClientProfiles(container, currentUser, currentRole, brand);
    } catch (ex) { Notifs.showToast('Migration failed: ' + (ex.message||ex.code), 'error'); }
  });
  renderList();

  // "From quotes — not yet in CRM" promote section (closes the bs_clients/
  // renderBSClientData orphan's data-loss side, decision 2). Design has no
  // quote stream, so this only runs for the Sales/BS books.
  if (!legacyMode && canAdd && brand !== 'design') (async () => {
    try {
      const qs = await getAllQuotes();
      // Which book a quote's client belongs to. The old test was `!== 'BK'` /
      // `=== 'BK'`, which put Barro Industries (BI — the parent company's
      // general-fabrication quotes) in the PARTNER book. Split on
      // internal-vs-partner instead: BK and BI are both internal.
      const wantCo = brand === 'brilliant-steel'
        ? (co => !window.isInternalQuoteCompany(co))
        : (co => window.isInternalQuoteCompany(co));
      const known = new Set(clients.map(c => c.nameKey));
      const un = {};
      qs.docs.forEach(d => { const q = d.data(); const k = window.Clients.nameKey(q.clientName);
        if (!k || known.has(k) || !wantCo(q.company || 'BK')) return;
        if (!un[k]) un[k] = { clientName:(q.clientName||'').trim(), clientCompany:q.clientCompany||'', clientPhone:q.clientPhone||'',
          clientEmail:q.clientEmail||'', clientAddress:q.clientAddress||'', quoteNumber:q.quoteNumber||'', total:q.total||0,
          company: brand==='brilliant-steel' ? 'BS' : 'BK', n:0 };
        un[k].n++; });
      const list = Object.values(un); if (!list.length) return;
      const el = document.getElementById('cl-list'); if (!el) return;
      el.insertAdjacentHTML('beforeend', `
        <div class="card" style="margin-top:14px"><div class="card-header"><h3 style="font-size:13px">${emojiIcon('📄',13)} From quotes — not yet in CRM (${list.length})</h3></div>
        <div class="card-body">${list.map((u,i)=>`<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
          <div style="min-width:0"><div style="font-size:13px;font-weight:600">${escHtml(u.clientName)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${u.n} quote${u.n>1?'s':''}${u.quoteNumber?' · last '+escHtml(u.quoteNumber):''}</div></div>
          <button class="btn-secondary btn-sm cl-promote" data-i="${i}">＋ Save to CRM</button></div>`).join('')}</div></div>`);
      el.querySelectorAll('.cl-promote').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        const id = await window.Clients.upsertFromQuote(list[+b.dataset.i]);
        if (id) { Notifs.success('Client saved to CRM'); renderClientProfiles(container, currentUser, currentRole, brand); }
        else { b.disabled = false; Notifs.showToast('Save failed','error'); }
      }));
    } catch(_){}
  })();
}

// Per-client hub: profile + stage + follow-up + unified timeline (quotes, orders,
// project events, payments, contacts) — V12-PLAN 197-198. Internal-only (partners
// never reach this — decision 10), so no partner query-scoping is needed here.
async function openClientHub(cl, opts) {
  opts = opts || {};
  const panel = openPage(`${emojiIcon('👤',16)} ${escHtml(cl.name || 'Client')}`, window.skeletonHtml('cards'),
    `<button class="btn-secondary" onclick="closeModal()">Close</button>`);
  const body = panel.querySelector('.page-panel-body');
  const t = await window.Clients.timelineFor(cl);
  if (!body) return;
  const FV = firebase.firestore.FieldValue;
  const today = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0,10));
  const who = () => (userProfile?.displayName || currentUser?.email || '');
  const fmtD = ms => ms ? new Date(ms).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '';
  const st = crmStageMeta(crmStageOf(cl));
  const fuOverdue = cl.followUpDate && cl.followUpDate <= today && !['won','lost'].includes(crmStageOf(cl));
  const totalQuoted = t.quotes.reduce((s,q)=>s+(q.total||q.grandTotal||0),0);
  const wonVal = t.quotes.filter(window.isQuoteWon).reduce((s,q)=>s+(q.total||q.grandTotal||0),0);   // canonical (decision 8)
  const collected = t.payments.reduce((s,p)=>s+(+p.amount||0),0);
  const ar = t.projects.reduce((s,p)=>s+(+p.arBalance||0),0);
  // v13 Phase 40/115 -- local shadow of the global statusBadge() deleted; use the
  // centralized quote vocabulary in js/ui-status-meta.js instead (one truth
  // across files/summary/client-data/client-hub).
  const statusBadge = (q) => window.statusBadge2('quote', q.status || q.approvalStatus || 'draft', { fontSize: '9px' });
  body.innerHTML = `
    <div class="item-card" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
        ${opts.canEdit
          ? `<select id="ch-stage" style="padding:4px 8px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:12px">
              ${CRM_STAGES.map(s=>`<option value="${s.key}" ${crmStageOf(cl)===s.key?'selected':''}>${s.icon} ${s.label}</option>`).join('')}</select>`
          : `<span class="badge" style="font-size:10px;background:${st.color};color:var(--on-primary)">${st.icon} ${st.label}</span>`}
        ${cl.company?`<span style="font-size:12px;color:var(--text-muted)">${emojiIcon('🏢',12)} ${escHtml(cl.company)}</span>`:''}
        ${(cl.brands||[]).map(b=>`<span class="badge badge-gray" style="font-size:9px">${b==='sales'?'Sales':b==='design'?'Design':'Brilliant Steel'}</span>`).join('')}
      </div>
      <div class="item-meta">
        ${cl.email?`<span>${emojiIcon('✉️',16)} ${escHtml(cl.email)}</span>`:''}
        ${cl.phone?`<span>${emojiIcon('📞',16)} ${escHtml(cl.phone)}</span>`:''}
        ${cl.address?`<span>${emojiIcon('📍',16)} ${escHtml(cl.address)}</span>`:''}
      </div>
      <div style="font-size:12px;margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${cl.followUpDate
          ? `<span style="color:${fuOverdue?'var(--danger)':'var(--text-muted)'}">${emojiIcon('⏰',16)} Follow-up: <strong>${escHtml(cl.followUpDate)}</strong>${fuOverdue?' · due':''}</span>
             ${opts.canEdit?`<button class="btn-secondary btn-sm" id="ch-fu-done">${emojiIcon('✓',16)} Done</button>`:''}`
          : (opts.canEdit?`<button class="btn-secondary btn-sm" id="ch-fu-set">${emojiIcon('⏰',16)} Set follow-up</button>`:'')}
        ${opts.canEdit?`<button class="btn-secondary btn-sm" id="ch-log">${emojiIcon('📞',16)} Log contact</button>`:''}
      </div>
      ${cl.notes?`<div style="font-size:12px;color:var(--text-muted);margin-top:6px">${emojiIcon('📝',12)} ${escHtml(cl.notes)}</div>`:''}
      <div style="display:flex;gap:14px;margin-top:8px;font-size:12px;border-top:1px solid var(--border);padding-top:8px;flex-wrap:wrap">
        <span>Quotes: <strong>${t.quotes.length}</strong></span>
        <span>Quoted: <strong>₱${fmt(totalQuoted)}</strong></span>
        <span>Won: <strong style="color:var(--success)">₱${fmt(wonVal)}</strong></span>
        <span>Collected: <strong>₱${fmt(collected)}</strong></span>
        ${ar>0?`<span>AR: <strong style="color:var(--danger)">₱${fmt(ar)}</strong></span>`:''}
      </div>
    </div>
    ${window.chipTabs ? window.chipTabs([{key:'timeline',label:`${emojiIcon('🕓',13)} Timeline`},{key:'details',label:`${emojiIcon('🗂',13)} Details`}], 'timeline', {cls:'ch-tabs'}) : ''}
    <div class="ch-tab-pane" id="ch-tab-timeline">
      ${t.events.length?`<div style="border-left:2px solid var(--border);margin:0 0 14px 6px;padding-left:12px;display:flex;flex-direction:column;gap:8px;max-height:420px;overflow-y:auto">
        ${t.events.map(e=>`<div style="display:flex;gap:8px;align-items:baseline"><span style="flex-shrink:0">${emojiIcon(e.icon,14)}</span><span style="font-size:12px;flex:1">${escHtml(e.text)}</span><span style="font-size:11px;color:var(--text-muted);flex-shrink:0">${fmtD(e.ts)}</span></div>`).join('')}
      </div>`:(window.renderEmptyState ? window.renderEmptyState({icon:'🕓', title:'No activity yet for this client', hint:'Quotes, orders, project events and payments will show up here.'}) : '<div class="empty-state" style="padding:18px"><p>No activity yet for this client.</p></div>')}
    </div>
    <div class="ch-tab-pane" id="ch-tab-details" style="display:none">
      ${t.projects.length?`<h4 style="font-size:13px;margin:0 0 6px">${emojiIcon('🏗',13)} Projects (${t.projects.length})</h4>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">
        ${t.projects.map(p=>`<div class="item-card" style="display:flex;justify-content:space-between;gap:10px;align-items:center">
          <div style="min-width:0"><span style="font-weight:700;font-size:12px;font-family:monospace">${escHtml(p.no||p.id.slice(-6))}</span>
            <span class="badge badge-blue" style="font-size:9px">${escHtml((p.stage||'—').replace(/_/g,' '))}</span></div>
          <div style="font-size:11px;color:var(--text-muted);flex-shrink:0">₱${fmt(p.contractAmount)}${p.arBalance>0?` · AR ₱${fmt(p.arBalance)}`:' · paid'}</div>
        </div>`).join('')}
      </div>`:''}
      ${t.files.length?`<h4 style="font-size:13px;margin:0 0 6px">${emojiIcon('📁',13)} Files (${t.files.length})</h4>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">
        ${t.files.map(f=>`<div class="item-card ch-file-row" data-id="${f.id}" style="cursor:pointer;display:flex;justify-content:space-between;gap:10px;align-items:center">
          <div style="min-width:0"><span style="font-weight:600;font-size:12px">${escHtml(f.name||'File')}</span>
            ${f.projectId?`<span class="badge badge-gray" style="font-size:9px">${emojiIcon('🏗',9)} ${escHtml((t.projects.find(p=>p.id===f.projectId)||{}).no||'Project')}</span>`:''}</div>
          <div style="font-size:11px;color:var(--text-muted);flex-shrink:0">${emojiIcon('👁',11)} ${f.createdAt&&f.createdAt.toDate?f.createdAt.toDate().toLocaleDateString('en-PH'):''}</div>
        </div>`).join('')}
      </div>`:''}
      <h4 style="font-size:13px;margin:0 0 6px">${emojiIcon('📄',13)} Quotes (${t.quotes.length})</h4>
      ${!t.quotes.length?'<div class="empty-state" style="padding:18px"><p>No quotes recorded for this client yet.</p></div>':`<div style="display:flex;flex-direction:column;gap:8px">
        ${t.quotes.map(q=>`<div class="item-card" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:13px;font-family:monospace">${escHtml(q.quoteNumber||q.id.slice(-8))}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">₱${fmt(q.total||q.grandTotal||0)} ${statusBadge(q)} ${q.salesOrderId?'<span class="badge badge-green" style="font-size:9px">→ Sales Order</span>':''} ${q.createdAt?'· '+fmtD(q.createdAt.seconds?q.createdAt.seconds*1000:Date.parse(q.createdAt)||0):''}</div>
          </div>
          ${q.editableState?`<div style="display:flex;gap:6px;flex-shrink:0"><button class="btn-secondary btn-sm clq-reopen" data-id="${q.id}" data-coll="${q._coll}" data-co="${escHtml(q.company||'BS')}">↻ Reopen</button><button class="btn-secondary btn-sm clq-rev" data-id="${q.id}" data-coll="${q._coll}" data-co="${escHtml(q.company||'BS')}" title="Start a new revision (R2, R3…) with today's date">${emojiIcon('⎘',16)} New Revision</button></div>`:'<span style="font-size:10px;color:var(--text-muted);flex-shrink:0">no snapshot</span>'}
        </div>`).join('')}
      </div>`}
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [body] });
  const nav = co => window.quoteBuilderPageFor(co);
  const chTabs = body.querySelector('.ch-tabs');
  if (chTabs && window.bindChipTabs) {
    window.bindChipTabs(chTabs, (key) => {
      // ⚠ Scoped to THIS hub's body, not document — a closing client hub lingers
      // ~300ms and its panes carry the same ids, so document.getElementById()
      // would flip the DYING panel's tabs and leave the visible ones frozen.
      const timelinePane = body.querySelector('#ch-tab-timeline');
      const detailsPane = body.querySelector('#ch-tab-details');
      if (timelinePane) timelinePane.style.display = key === 'timeline' ? '' : 'none';
      if (detailsPane) detailsPane.style.display = key === 'details' ? '' : 'none';
    });
  }
  body.querySelectorAll('.clq-reopen').forEach(btn=>btn.addEventListener('click',()=>{ closeModal(); window.reopenQuoteFromDoc(btn.dataset.coll, btn.dataset.id, nav(btn.dataset.co)); }));
  body.querySelectorAll('.clq-rev').forEach(btn=>btn.addEventListener('click',()=>{ closeModal(); window.newRevisionFromDoc(btn.dataset.coll, btn.dataset.id, nav(btn.dataset.co)); }));
  body.querySelectorAll('.ch-file-row').forEach(row=>row.addEventListener('click',()=>{
    const f = t.files.find(x=>x.id===row.dataset.id); if (f) window.openFilePreview(f);
  }));
  const patch = async (upd, log) => {
    if (log) upd.contactLog = FV.arrayUnion(log);
    upd.updatedAt = FV.serverTimestamp();
    await db.collection('clients').doc(cl.id).update(upd);
    if (typeof dbCacheInvalidate==='function') dbCacheInvalidate('clients');
    closeModal(); opts.onChange && opts.onChange();
  };
  // ⚠ SCOPED TO THIS PANEL, NOT document. Opening a second client's hub while
  // the previous one is still in its ~300ms teardown puts two #ch-stage /
  // #ch-log / #ch-fu-* in the DOM; document.getElementById() would bind these
  // handlers to the DYING hub, leaving the visible controls inert.
  body.querySelector('#ch-stage')?.addEventListener('change', async e => {
    try { await patch({ stage: e.target.value }); Notifs.success('Stage updated'); } catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
  });
  body.querySelector('#ch-log')?.addEventListener('click', async () => {
    const note = (await promptDialog({message:'What happened? (call, site visit, email…)', multiline:true}))||'';
    if (!note.trim()) return;
    try { await patch({ lastContact: today }, { date: today, by: who(), note: note.trim() }); Notifs.success('Contact logged'); } catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
  });
  body.querySelector('#ch-fu-done')?.addEventListener('click', async () => {
    const next = ((await promptDialog({message:`Follow-up done ${emojiIcon('✓',16)} — schedule the next one? (YYYY-MM-DD, blank = none)`}))||'').trim();
    try { await patch({ followUpDate: next, lastContact: today }, { date: today, by: who(), note: 'Follow-up done' + (next ? ' → next ' + next : '') }); Notifs.success('Follow-up updated'); } catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
  });
  body.querySelector('#ch-fu-set')?.addEventListener('click', async () => {
    const d = ((await promptDialog({message:'Follow-up date (YYYY-MM-DD)'}))||'').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { if (d) Notifs.showToast('Use YYYY-MM-DD','error'); return; }
    try { await patch({ followUpDate: d }); Notifs.success('Follow-up set'); } catch(ex){ Notifs.showToast('Failed: '+(ex.message||ex.code),'error'); }
  });
}

// ══════════════════════════════════════════════════
//  SHARED: Budgeting
// ══════════════════════════════════════════════════
async function renderBudgeting(container, currentUser, currentRole, dept) {
  // Root collection, name computed at runtime — no backup registration needed:
  // scripts/monthly-backup.js discovers every root collection via db.listCollections().
  const collection = `budgets_${dept.toLowerCase().replace(/\s+/g,'_')}`;

  // DEPT-BUDGETS-SPEC-2026-08-11 §4 — permission matrix. The secretary guard is
  // mandatory on every dept-membership gate (owner ruling 3: an assignment must
  // never beat the role decision — the same reasoning as budgets_<dept> above).
  const isDeptMember   = (window.currentDepts||[]).includes(dept) && !deptBlockedForSecretary(dept);
  const canFinanceTier = ['president','owner','manager','finance'].includes(currentRole);
  const canLogSpend    = isDeptMember || canFinanceTier;          // THE fix: members can log
  const canEditLines   = canFinanceTier || currentRole==='manager' || isDeptMember;
  const canSeeLedger   = canFinanceTier;                          // ledger query stays finance-tier

  // Money-truth lives in dept_budget_releases/dept_spend_logs — NEVER derived
  // from /ledger on the department side (members can't read /ledger, and must
  // not). budgets_<dept> lines stay exactly what they were: planning memo.
  const [budgetSnap, releaseSnap, spendSnap, reqSnap, ledgerSnap] = await Promise.all([
    db.collection(collection).orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
    db.collection('dept_budget_releases').where('dept','==',dept).orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
    db.collection('dept_spend_logs').where('dept','==',dept).orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
    db.collection('dept_budget_requests').where('dept','==',dept).orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
    canSeeLedger ? db.collection('ledger').where('dept','==',dept).limit(100).get().catch(()=>({docs:[]}))
                 : Promise.resolve({docs:[]})
  ]);

  const items    = budgetSnap.docs.map(d=>({id:d.id,...d.data()}));
  const releases = releaseSnap.docs.map(d=>({id:d.id,...d.data()}));
  const spends   = spendSnap.docs.map(d=>({id:d.id,...d.data()}));
  const requests = reqSnap.docs.map(d=>({id:d.id,...d.data()}));
  const expenses = ledgerSnap.docs.map(d=>({id:d.id,...d.data()}))
    .sort((a,b)=>(b.date||'').localeCompare(a.date||''));

  const liveSpends = spends.filter(s=>s.status==='pending'||s.status==='confirmed');
  const activeReleases = releases.filter(r=>r.status==='active');
  activeReleases.forEach(r => {
    r._logged    = liveSpends.filter(s=>s.releaseId===r.id).reduce((s,x)=>s+(x.amount||0),0);
    r._remaining = (r.amount||0) - r._logged;
  });

  const totalReleased   = activeReleases.reduce((s,r)=>s+(r.amount||0),0);
  const totalLogged     = liveSpends.reduce((s,x)=>s+(x.amount||0),0);
  const totalRemaining  = totalReleased - totalLogged;
  const awaitingFinance = spends.filter(s=>s.status==='pending').length;

  // Budget-line "Spent" — ledger-derived for Finance (covers legacy rows);
  // dept_spend_logs (pending+confirmed) for members, instead of "—".
  items.forEach(item => {
    item.spent = canSeeLedger
      ? expenses.filter(e=>e.budgetLineId===item.id && ledgerKind(e)==='expense').reduce((s,e)=>s+(e.amount||0),0)
      : liveSpends.filter(s=>s.budgetLineId===item.id).reduce((s,x)=>s+(x.amount||0),0);
  });

  const relCard = (r) => {
    const isFloat = r.type === 'float';
    const notPosted = isFloat && r.status === 'active' && !r.ledgerRef;
    const remaining = r.status === 'active' ? r._remaining : null;
    const over = remaining != null && remaining < 0;
    return `<div class="card" style="margin-bottom:10px">
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <div>
            <span class="badge ${isFloat?'badge-blue':'badge-orange'}">${isFloat?`${emojiIcon('💵',12)} Cash float`:`${emojiIcon('🧾',12)} Spending limit`}</span>
            <span class="badge ${r.status==='active'?'badge-green':'badge-gray'}" style="margin-left:6px">${r.status==='active'?'Active':'Closed'}</span>
            <div style="font-weight:700;margin-top:4px">${escHtml(r.title)}</div>
            <div style="font-size:12px;color:var(--text-muted)">${isFloat?`Custodian: ${escHtml(r.custodianName||'—')} — holding company cash`:'Pay out of pocket, then log the receipt to get paid back.'}</div>
          </div>
          <div style="text-align:right">
            <div>₱${fmt(r.amount)}</div>
            <div style="font-size:11px;color:var(--text-muted)">Released ${escHtml(r.date||'')}</div>
            ${remaining!=null?`<div style="font-weight:700;color:${over?'var(--danger)':'var(--success)'}">${over?`OVER BY ₱${fmt(Math.abs(remaining))}`:`Remaining ₱${fmt(remaining)}`}</div>`:''}
          </div>
        </div>
        ${over?`<div style="margin-top:8px;padding:8px 12px;background:rgba(255,0,0,0.08);border-radius:8px;font-size:12px;color:var(--danger)">⚠ You are ₱${fmt(Math.abs(remaining))} over '${escHtml(r.title)}'. Everything still gets recorded — Finance has been flagged.</div>`:''}
        ${notPosted?`<div style="margin-top:8px;padding:8px 12px;background:rgba(255,0,0,0.08);border-radius:8px;font-size:12px;color:var(--danger);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <span>${emojiIcon('⚠️',14)} Not yet posted — tap Repost</span>
          ${canFinanceTier?`<button class="btn-danger btn-sm bud-repost-btn" data-id="${r.id}">Repost</button>`:''}
        </div>`:''}
        ${canFinanceTier && isFloat && r.status==='active'?`<div style="margin-top:8px;text-align:right"><button class="btn-secondary btn-sm bud-close-float-btn" data-id="${r.id}">Close float</button></div>`:''}
      </div>
    </div>`;
  };

  container.innerHTML = `
    ${window.sopPanel('How your department budget works', [
      'Finance releases a budget to this department — either a cash float (someone here is holding company cash) or a spending limit (you pay first, then get paid back).',
      'Every time you spend, log it here with the receipt. Your remaining balance updates immediately; the entry reaches the company books once Finance confirms it.',
      'Going over budget is recorded, not hidden — the line turns red and Finance is flagged.',
      'Need money for something? File a budget request with your supporting documents.'
    ])}

    <div class="kpi-row" style="margin-bottom:14px">
      <div class="kpi-card"><div class="kpi-label">Released</div><div class="kpi-value">₱${fmt(totalReleased)}</div></div>
      <div class="kpi-card red"><div class="kpi-label">Spent (logged)</div><div class="kpi-value">₱${fmt(totalLogged)}</div></div>
      <div class="kpi-card ${totalRemaining<0?'red':'green'}"><div class="kpi-label">Remaining</div><div class="kpi-value" style="${totalRemaining<0?'color:var(--danger)':''}">₱${fmt(totalRemaining)}</div></div>
      <div class="kpi-card accent"><div class="kpi-label">Awaiting Finance</div><div class="kpi-value">${awaitingFinance}</div></div>
    </div>

    ${(canEditLines||canLogSpend)?`<div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:12px;flex-wrap:wrap">
      ${canEditLines?`<button class="btn-secondary btn-sm" id="add-budget-line-btn">+ Budget Line</button>`:''}
      ${canLogSpend?`<button class="btn-primary btn-sm" id="log-spend-btn">${emojiIcon('📤',16)} Log a Spend</button>`:''}
      ${canLogSpend?`<button class="btn-secondary btn-sm" id="request-budget-btn">${emojiIcon('🙋',16)} Request a Budget</button>`:''}
    </div>`:''}

    <!-- Budget Releases -->
    <div class="card" style="margin-bottom:14px">
      <div class="card-header">
        <h3>${emojiIcon('💰',20)} Budget Releases</h3>
        ${canFinanceTier?`<button class="btn-primary btn-sm" id="release-budget-btn">${emojiIcon('➕',14)} Release Budget</button>`:''}
      </div>
      <div class="card-body">
        ${!releases.length
          ? `<div class="empty-state" style="padding:20px"><div class="empty-icon">${emojiIcon('💰',44)}</div><p>No budget yet.</p><p style="font-size:12px;color:var(--text-muted)">${escHtml(dept)} hasn't been given a budget. You can request one.</p>${canLogSpend?`<button class="btn-secondary btn-sm" id="empty-request-budget-btn">${emojiIcon('🙋',16)} Request a Budget</button>`:''}</div>`
          : releases.map(relCard).join('')}
      </div>
    </div>

    <!-- Budget allocations (unchanged, except the Spent/Remaining/% columns) -->
    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>${emojiIcon('📊',20)} Budget Allocation</h3></div>
      <div class="card-body" style="padding:0">
        ${!items.length?`<div class="empty-state" style="padding:20px"><div class="empty-icon">${emojiIcon('📊',44)}</div><p>No budget lines yet.</p></div>`:
          `<div class="table-wrap"><table class="data-table table-cards no-toggle">
            <thead><tr><th>Item</th><th>Allocated</th><th>Spent</th><th>Remaining</th><th>%</th></tr></thead>
            <tbody>
              ${items.map(i=>{
                const pct = i.budget>0?Math.min(Math.round(i.spent/i.budget*100),100):0;
                const rem = i.budget-i.spent;
                return `<tr>
                  <td data-label="Item" style="font-weight:600">${escHtml(i.name)}</td>
                  <td data-label="Allocated">₱${fmt(i.budget)}</td>
                  <td data-label="Spent" style="color:var(--danger)">₱${fmt(i.spent)}</td>
                  <td data-label="Remaining" style="color:${rem<0?'var(--danger)':'var(--success)'}">₱${fmt(rem)}</td>
                  <td data-label="%">
                    <div style="display:flex;align-items:center;gap:6px;min-width:80px">
                      <div style="flex:1;height:6px;background:var(--surface2);border-radius:3px">
                        <div style="width:${pct}%;height:100%;border-radius:3px;background:${pct>=90?'var(--danger)':pct>=70?'var(--warning,#ff9f0a)':'var(--primary-light)'}"></div>
                      </div>
                      <span style="font-size:11px;color:var(--text-muted);white-space:nowrap">${pct}%</span>
                    </div>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table></div>
          ${!canSeeLedger?`<div style="font-size:11px;color:var(--text-muted);padding:8px 14px 12px">Figures include spends still awaiting Finance confirmation.</div>`:''}`}
      </div>
    </div>

    <!-- Spend Log -->
    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>${emojiIcon('🧾',20)} Spend Log</h3></div>
      <div class="card-body" style="padding:0">
        ${!spends.length?`<div class="empty-state" style="padding:20px"><div class="empty-icon">${emojiIcon('🧾',44)}</div><p>No spends logged yet.</p></div>`:
          `<div class="table-wrap"><table class="data-table table-cards">
            <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Status</th><th>By</th><th>Proof</th><th></th></tr></thead>
            <tbody>
              ${spends.map(s=>{
                const statusBadge = s.status==='pending'?`<span class="badge badge-warn">${emojiIcon('⏳',12)} With Finance</span>`
                  : s.status==='confirmed'?`<span class="badge badge-green">✓ Confirmed</span>`
                  : `<span class="badge badge-red">✕ Rejected</span>${s.rejectReason?`<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escHtml(s.rejectReason)}</div>`:''}`;
                const flags = `${s.noReceipt?`<span class="badge badge-red" style="font-size:9px;margin-left:4px">${emojiIcon('🚩',10)} No receipt</span>`:''}${s.overspendAtLog?`<span class="badge badge-orange" style="font-size:9px;margin-left:4px">${emojiIcon('🔺',10)} Over budget</span>`:''}`;
                const atts = (s.attachments||[]).map(a=>`<a href="${safeHttpUrl(a.url)}" target="_blank" rel="noopener" style="display:block;font-size:11px">${escHtml(a.name)}</a>`).join('') || '—';
                const canAct = (s.status==='pending'||s.status==='rejected') && s.loggedBy===currentUser.uid;
                const actions = !canAct ? '' : `${s.status==='rejected'?`<button class="btn-secondary btn-sm bud-edit-spend-btn" data-id="${s.id}">Edit &amp; resubmit</button>`:''}${s.status==='pending'?`<button class="btn-danger btn-sm bud-withdraw-btn" data-id="${s.id}">Withdraw</button>`:''}`;
                return `<tr class="bud-spend-row">
                  <td class="tc-avatar" style="font-size:12px">${escHtml(s.date||'—')}</td>
                  <td class="tc-name" style="font-size:12px">${escHtml(s.description||'—')}${flags} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
                  <td class="tc-net" style="font-weight:600">₱${fmt(s.amount)}</td>
                  <td class="tc-detail" data-label="Status">${statusBadge}</td>
                  <td class="tc-detail" data-label="By" style="font-size:11px;color:var(--text-muted)">${escHtml(s.loggedByName||'—')}</td>
                  <td class="tc-detail" data-label="Proof" style="font-size:11px">${atts}</td>
                  <td class="tc-actions">${actions}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table></div>`}
      </div>
    </div>

    <!-- My Budget Requests -->
    <div class="card" style="margin-bottom:14px">
      <div class="card-header"><h3>${emojiIcon('🙋',20)} My Budget Requests</h3></div>
      <div class="card-body" style="padding:0">
        ${!requests.length?`<div class="empty-state" style="padding:20px"><div class="empty-icon">${emojiIcon('🙋',44)}</div><p>No requests yet.</p></div>`:
          `<div class="table-wrap"><table class="data-table table-cards no-toggle">
            <thead><tr><th>Title</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              ${requests.map(r=>{
                const badge = r.status==='pending'?`<span class="badge badge-warn">${emojiIcon('⏳',12)} Pending</span>`
                  : r.status==='approved'?`<span class="badge badge-green">✓ Approved</span>`
                  : r.status==='declined'?`<span class="badge badge-red">✕ Declined${r.reviewNote?` — ${escHtml(r.reviewNote)}`:''}</span>`
                  : `<span class="badge badge-gray">Cancelled</span>`;
                return `<tr>
                  <td data-label="Title" style="font-weight:600">${escHtml(r.title)}</td>
                  <td data-label="Amount">₱${fmt(r.amount)}</td>
                  <td data-label="Status">${badge}</td>
                  <td data-label="Date" style="font-size:11px;color:var(--text-muted)">${escHtml(r.date||'')}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table></div>`}
      </div>
    </div>

    <!-- Finance-tier ledger-synced table (unchanged, Type-badge fix so float/
         payable legs don't masquerade as Income — window.ledgerKind, config.js) -->
    ${canSeeLedger?`<div class="card">
      <div class="card-header">
        <h3>${emojiIcon('🧾',20)} Expense / Income Log</h3>
        <span style="font-size:11px;color:var(--text-muted)">Synced with Finance Ledger</span>
      </div>
      <div class="card-body" style="padding:0">
        ${!expenses.length?`<div class="empty-state" style="padding:20px"><div class="empty-icon">${emojiIcon('🧾',44)}</div><p>No expenses logged yet.</p></div>`:
          `<div class="table-wrap"><table class="data-table table-cards">
            <thead><tr><th>Date</th><th>Description</th><th>Line Item</th><th>Type</th><th>Amount</th><th>By</th></tr></thead>
            <tbody>
              ${expenses.map(e=>{
                const kind = ledgerKind(e);
                const typeBadge = kind==='expense'?`<span class="badge badge-red">Expense</span>`
                  : kind==='income'?`<span class="badge badge-green">Income</span>`
                  : kind==='asset'?`<span class="badge badge-gray">Float</span>`
                  : kind==='liability'?`<span class="badge badge-gray">Payable</span>`
                  : `<span class="badge badge-gray">${escHtml(kind)}</span>`;
                return `<tr class="bud-exp-row">
                  <td class="tc-avatar" style="font-size:12px">${e.date||'—'}</td>
                  <td class="tc-name" style="font-size:12px">${escHtml(e.description||'—')} <i data-lucide="chevron-down" class="tc-caret" style="width:12px;height:12px;vertical-align:-2px"></i></td>
                  <td class="tc-detail" data-label="Line Item" style="font-size:11px;color:var(--text-muted)">${escHtml(e.budgetLineName||'—')}</td>
                  <td class="tc-detail" data-label="Type">${typeBadge}</td>
                  <td class="tc-net" style="color:${kind==='income'?'var(--success)':kind==='expense'?'var(--danger)':'var(--text)'};font-weight:600">₱${fmt(e.amount)}</td>
                  <td class="tc-detail" data-label="By" style="font-size:11px;color:var(--text-muted)">${escHtml(e.addedByName||'—')}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table></div>`}
      </div>
    </div>`:''}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });

  container.querySelectorAll('tr.bud-exp-row').forEach(tr => tr.addEventListener('click', (ev) => {
    if (ev.target.closest('button, a')) return;
    tr.classList.toggle('tc-expanded');
  }));
  container.querySelectorAll('tr.bud-spend-row').forEach(tr => tr.addEventListener('click', (ev) => {
    if (ev.target.closest('button, a')) return;
    tr.classList.toggle('tc-expanded');
  }));

  const reload = () => renderBudgeting(container, currentUser, currentRole, dept);

  // Add budget line (unchanged)
  container.querySelector('#add-budget-line-btn')?.addEventListener('click', () => {
    const _panel = openPage('Add Budget Line', `
      <div class="form-group"><label>Item Name</label><input id="bg-name" placeholder="e.g. Social Media Ads"/></div>
      <div class="form-group"><label>Allocated Budget (₱)</label><input id="bg-budget" type="number" step="0.01" min="0" inputmode="decimal"/></div>
    `, `<button class="btn-primary" id="save-bg-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    // ⚠ SCOPED TO THIS PANEL, NOT document — a closing budget-line panel lingers
    // ~300ms and would win the getElementById race, so this could save the
    // PREVIOUS line's name and allocated budget.
    const $ = (id) => _panel.querySelector('#' + id);
    $('save-bg-btn').addEventListener('click', async () => {
      const name = $('bg-name').value.trim();
      if (!name) { Notifs.showToast('Enter item name','error'); return; }
      await db.collection(collection).add({
        name,
        budget: parseFloat($('bg-budget').value)||0,
        dept,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); reload();
    });
  });

  // §6.2/§6.3a/§7 — Log a Spend / Request a Budget / Release a Budget /
  // Repost / Close float. These live in js/screens/dept-budgets.js (loaded
  // after this file) and are called by window.* name at click time only —
  // the standard runtime forward-reference convention (index.html).
  container.querySelector('#log-spend-btn')?.addEventListener('click', () => {
    window.openLogSpendForm(dept, activeReleases, items, reload);
  });
  container.querySelector('#request-budget-btn')?.addEventListener('click', () => {
    window.openBudgetRequestForm(dept, reload);
  });
  container.querySelector('#empty-request-budget-btn')?.addEventListener('click', () => {
    window.openBudgetRequestForm(dept, reload);
  });
  container.querySelector('#release-budget-btn')?.addEventListener('click', () => {
    window.openReleaseBudgetForm({ dept }, reload);
  });
  container.querySelectorAll('.bud-repost-btn').forEach(btn => onClickSafe(btn, async () => {
    const r = releases.find(x=>x.id===btn.dataset.id);
    if (r) await window.repostFloatRelease(r, reload);
  }));
  container.querySelectorAll('.bud-close-float-btn').forEach(btn => onClickSafe(btn, async () => {
    const r = releases.find(x=>x.id===btn.dataset.id);
    if (r) await window.openCloseFloatModal(r, reload);
  }));
  container.querySelectorAll('.bud-withdraw-btn').forEach(btn => btn.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    const ok = await confirmDialog({ message:'Withdraw this spend?', danger:true });
    if (!ok) return;
    await db.collection('dept_spend_logs').doc(btn.dataset.id).delete();
    Notifs.success('Withdrawn.');
    reload();
  }));
  container.querySelectorAll('.bud-edit-spend-btn').forEach(btn => btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const s = spends.find(x=>x.id===btn.dataset.id);
    if (s) window.openEditSpendForm(s, activeReleases, items, reload);
  }));
}
window.renderBudgeting = renderBudgeting;

// ══════════════════════════════════════════════════
//  FILES MODULE — shared helper
// ══════════════════════════════════════════════════
window.renderFileCollection = function(title, containerId, currentRole) {
  return `
    <div class="card">
      <div class="card-header" style="flex-wrap:wrap;gap:6px">
        <h3>${emojiIcon('📁',20)} ${title}</h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn-secondary btn-sm" id="newfolder-btn-${containerId}">${emojiIcon('📁',16)} New Folder</button>
          <button class="btn-secondary btn-sm" id="addlink-btn-${containerId}">${emojiIcon('🔗',16)} Add Link</button>
          <button class="btn-primary btn-sm" id="upload-btn-${containerId}">+ Upload File</button>
        </div>
      </div>
      <div class="card-body" id="files-list-${containerId}">
        ${window.skeletonHtml('rows')}
      </div>
    </div>
  `;
};

window.bindFileCollection = function(containerId, currentUser, dept, scope, filterUid) {
  const listEl = document.getElementById(`files-list-${containerId}`);
  const uploadBtn = document.getElementById(`upload-btn-${containerId}`);
  const newFolderBtn = document.getElementById(`newfolder-btn-${containerId}`);
  const addLinkBtn = document.getElementById(`addlink-btn-${containerId}`);
  // v12 WS38 — Files Hub: files_<scope> is retired. Every scope now lives in the
  // single hub_files collection, namespaced by the `scope` field (see
  // window.FilesHub, js/drive.js). This function's own signature is UNCHANGED so
  // all 15 existing call sites across app.js/departments.js keep working as-is.
  const collection = 'hub_files';
  const scopeKey = scope.toLowerCase().replace(/\s+/g,'_');
  const RESERVED_FOLDER_NAMES = ['all','__archived__','__bin__'];
  let allFiles = [];
  let binFiles = [];
  let allFolders = [];
  let foldersById = {};
  let activeFolder = 'All';
  let viewMode = 'list';

  const folderName = id => (foldersById[id] && foldersById[id].name) || 'General';
  // Sharing/visibility is owner-or-admin only (Spec DECIDED §6: editors may
  // never change sharing) — narrower than FilesHub.canEdit(), which also
  // covers plain content/organization editors.
  const canShare = f => ['president','manager','owner'].includes(window.currentRole)
    || f.uploadedBy === currentUser.uid;

  const cardHtml = (f, isBin) => {
    const isLink = f.kind === 'link';
    const icon = isLink ? `${emojiIcon('🔗',16)}` : (/^image\//.test(f.contentType||'') ? `${emojiIcon('🖼️',16)}` : /pdf/.test(f.contentType||'') ? `${emojiIcon('📕',16)}` : `${emojiIcon('📄',16)}`);
    return `<div class="item-card fh-card" data-id="${f.id}" draggable="${(!isBin && FilesHub.canEdit(f))?'true':'false'}" data-file-row="${f.id}" style="cursor:pointer;text-align:center;padding:14px 8px">
      <div style="font-size:28px">${icon}</div>
      <div style="font-weight:600;font-size:12px;margin-top:6px;word-break:break-word">${escHtml(f.name||'File')}</div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${escHtml(folderName(f.folderId))}</div>
      <div style="font-size:10px;color:var(--text-muted)">${escHtml(f.uploaderName||'—')}</div>
    </div>`;
  };

  const renderList = () => {
    // Show every hub_folders doc for this scope as a chip — including ones with
    // zero files yet — so a just-created empty folder (per "Create a folder now,
    // then upload files or add links into it") stays reachable/clickable.
    const foldersToShow = allFolders;
    const archivedCount = allFiles.filter(f=>f.archived).length;
    const isBin = activeFolder === '__bin__';
    const showing = isBin
      ? binFiles
      : activeFolder === '__archived__'
        ? allFiles.filter(f=>f.archived)
        : allFiles.filter(f=>!f.archived && (activeFolder==='All' || (f.folderId||null)===activeFolder));

    const chips = [
      { key:'All', label:`${emojiIcon('📁',16)} All` },
      ...foldersToShow.map(fo => ({ key:fo.id, label:`${emojiIcon('📁',16)} ${escHtml(fo.name)}` })),
      ...(archivedCount ? [{ key:'__archived__', label:`${emojiIcon('🗄',16)} Archived (${archivedCount})` }] : []),
      { key:'__bin__', label:`${emojiIcon('🗑',16)} Recycle Bin (${binFiles.length})` }
    ];
    const chipBar = `<div class="subtab-bar" style="margin-bottom:10px">
      ${chips.map(c=>`<button class="subtab-btn file-folder-chip ${activeFolder===c.key?'active':''}" data-folder="${escHtml(c.key)}">${c.label}</button>`).join('')}
    </div>`;

    const emptyMsg = isBin ? 'Recycle Bin is empty'
      : (activeFolder!=='All' && activeFolder!=='__archived__') ? 'This folder is empty' : 'No files here';

    const rows = showing.length ? showing.map(f => {
      const isLink = f.kind === 'link';
      const canEdit = FilesHub.canEdit(f);
      const mirrored = f.driveUrl ? `<i data-lucide="${Drive.sourceIcon(f)}" title="Mirrored to Drive" style="width:12px;height:12px;stroke:var(--text-muted);vertical-align:-2px"></i>` : '';
      const verBadge = (f.versions && f.versions.length > 1) ? `<span class="badge badge-gray" style="margin-left:6px;font-size:10px">v${f.currentV||1}</span>` : '';
      return `<tr draggable="${(!isBin && canEdit)?'true':'false'}" data-file-row="${f.id}">
        <td class="tc-name">
          <a href="#" class="fh-preview-link" data-id="${f.id}" style="color:var(--primary);font-weight:600">${isLink?`${emojiIcon('🔗',16)} `:`${emojiIcon('📄',16)} `}${escHtml(f.name||'File')}</a>${mirrored}${verBadge}
          ${f.description?`<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escHtml(f.description)}</div>`:''}
        </td>
        <td class="tc-detail" data-label="Folder"><span class="badge badge-gray">${escHtml(folderName(f.folderId))}</span></td>
        <td class="tc-detail" data-label="Added By">${escHtml(f.uploaderName||'—')}</td>
        <td class="tc-net" style="font-size:11px;color:var(--text-muted)">${f.createdAt?new Date(f.createdAt.toDate()).toLocaleDateString('en-PH'):''}</td>
        <td class="tc-actions" style="white-space:nowrap">${isBin ? `
          ${canEdit?`<button class="btn-secondary btn-sm fh-restore" data-id="${f.id}">${emojiIcon('♻️',16)} Restore</button>`:''}
          ${window.currentRole==='president'?`<button class="btn-danger btn-sm fh-purge" data-id="${f.id}" data-name="${escHtml(f.name||'File')}">${emojiIcon('🗑',16)} Delete forever</button>`:''}
        ` : `
          <a href="${safeHttpUrl(f.url)}" target="_blank" class="btn-secondary btn-sm" title="${isLink?'Open link':'Download'}">${isLink?'↗':`${emojiIcon('⬇',16)}`}</a>
          <button class="btn-secondary btn-sm fh-preview" data-id="${f.id}" title="Preview">${emojiIcon('👁',16)}</button>
          ${canEdit?`<button class="btn-secondary btn-sm fh-version" data-id="${f.id}" title="Upload new version">${emojiIcon('⬆',16)}</button>`:''}
          ${canShare(f)?`<button class="btn-secondary btn-sm fh-share" data-id="${f.id}" title="Share">${emojiIcon('🔀',16)}</button>`:''}
          <button class="btn-secondary btn-sm file-arch-btn" data-id="${f.id}" data-arch="${f.archived?'0':'1'}" title="${f.archived?'Restore':'Archive'}">${f.archived?`${emojiIcon('♻️',16)}`:`${emojiIcon('🗄',16)}`}</button>
          ${canEdit?`<button class="btn-danger btn-sm fh-delete" data-id="${f.id}" data-name="${escHtml(f.name||'File')}" title="Move to Recycle Bin">${emojiIcon('🗑',16)}</button>`:''}
        `}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="5"><div class="empty-state" style="padding:18px"><div class="empty-icon">${emojiIcon('📁',44)}</div><h4>${emptyMsg}</h4></div></td></tr>`;

    const bodyHtml = viewMode === 'grid'
      ? `<div class="fh-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px">${
          showing.length ? showing.map(f=>cardHtml(f,isBin)).join('') : `<div class="empty-state" style="grid-column:1/-1;padding:18px"><div class="empty-icon">${emojiIcon('📁',44)}</div><h4>${emptyMsg}</h4></div>`
        }</div>`
      : `<div class="table-wrap"><table class="data-table table-cards">
          <thead><tr><th>Name</th><th>Folder</th><th>Added By</th><th>Date</th><th></th></tr></thead>
          <tbody>${rows}</tbody></table></div>`;

    listEl.innerHTML =
      window.chipTabs([{key:'list',label:`☰ List`},{key:'grid',label:'▦ Grid'}], viewMode, {cls:'fh-view'}) +
      chipBar + bodyHtml;
    if (window.lucide) lucide.createIcons({ nodes: [listEl] });

    window.bindChipTabs(listEl.querySelector('.fh-view'), key => { viewMode = key; renderList(); });

    // ── Folder-chip click (navigate) + drag-drop-to-move targets ──
    listEl.querySelectorAll('.file-folder-chip').forEach(b => {
      b.addEventListener('click', () => { activeFolder = b.dataset.folder; renderList(); });
      const key = b.dataset.folder;
      if (key !== '__archived__' && key !== '__bin__') {
        b.addEventListener('dragover', e => { e.preventDefault(); b.classList.add('drag-over'); });
        b.addEventListener('dragleave', () => b.classList.remove('drag-over'));
        b.addEventListener('drop', async e => {
          e.preventDefault(); b.classList.remove('drag-over');
          const fid = e.dataTransfer.getData('text/plain');
          if (!fid) return;
          try { await FilesHub.moveToFolder(fid, key === 'All' ? null : key); Notifs.success('Moved.'); loadFiles(); }
          catch (err) { Notifs.showToast('Move failed: ' + (err.message||err), 'error'); }
        });
      }
    });

    // ── Draggable rows/cards (drag-an-existing-file-onto-a-folder-chip) ──
    listEl.querySelectorAll('[data-file-row]').forEach(el => {
      if (el.getAttribute('draggable') === 'true') {
        el.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', el.dataset.fileRow));
      }
    });

    // ── Preview ──
    listEl.querySelectorAll('.fh-preview-link, .fh-preview').forEach(el => el.addEventListener('click', e => {
      e.preventDefault();
      const f = allFiles.find(x=>x.id===el.dataset.id) || binFiles.find(x=>x.id===el.dataset.id);
      if (f) window.openFilePreview(f);
    }));
    listEl.querySelectorAll('.fh-card').forEach(el => el.addEventListener('click', () => {
      const f = allFiles.find(x=>x.id===el.dataset.id) || binFiles.find(x=>x.id===el.dataset.id);
      if (f) window.openFilePreview(f);
    }));

    // ── Archive toggle (kept as-is, now against hub_files) ──
    listEl.querySelectorAll('.file-arch-btn').forEach(b => b.addEventListener('click', async () => {
      try {
        await db.collection(collection).doc(b.dataset.id).update({ archived: b.dataset.arch==='1', updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        const f = allFiles.find(x=>x.id===b.dataset.id); if (f) f.archived = b.dataset.arch==='1';
        renderList();
      } catch(e) { Notifs.showToast('Only the uploader, an editor, or an admin can archive this file','error'); }
    }));

    // ── Recycle Bin: soft-delete / restore / permanent delete ──
    listEl.querySelectorAll('.fh-delete').forEach(b => b.addEventListener('click', async () => {
      if (!(await confirmDialog({message:`Move "${escHtml(b.dataset.name)}" to the Recycle Bin?`, danger:true, html:true}))) return;
      try { await FilesHub.softDelete(b.dataset.id); Notifs.success('Moved to Recycle Bin.'); loadFiles(); }
      catch(e) { Notifs.showToast('Delete failed: ' + (e.message||e), 'error'); }
    }));
    listEl.querySelectorAll('.fh-restore').forEach(b => b.addEventListener('click', async () => {
      try { await FilesHub.restore(b.dataset.id); Notifs.success('Restored.'); loadFiles(); }
      catch(e) { Notifs.showToast('Restore failed: ' + (e.message||e), 'error'); }
    }));
    listEl.querySelectorAll('.fh-purge').forEach(b => b.addEventListener('click', async () => {
      const typed = await promptDialog({title:'Delete forever', message:`Type DELETE to permanently remove "${b.dataset.name}". This deletes the Storage file and cannot be undone. (The Google Drive mirror copy, if any, is kept — records-forever archive.)`, placeholder:'DELETE', required:true});
      if ((typed||'').trim().toUpperCase() !== 'DELETE') { if (typed) Notifs.showToast('Type DELETE exactly to confirm.','error'); return; }
      const f = binFiles.find(x=>x.id===b.dataset.id);
      if (!f) return;
      try { await FilesHub.purge(f); Notifs.success('Permanently deleted.'); loadFiles(); }
      catch(e) { Notifs.showToast('Delete failed: ' + (e.message||e), 'error'); }
    }));

    // ── New version ──
    listEl.querySelectorAll('.fh-version').forEach(b => b.addEventListener('click', () => {
      const f = allFiles.find(x=>x.id===b.dataset.id); if (!f) return;
      const _panel = openPage(`Upload new version — ${escHtml(f.name||'File')}`, `
        <div id="fh-version-upload"></div>
        <div class="form-group"><label>Note (optional)</label><input id="fh-version-note" placeholder="What changed?"/></div>
      `, `<button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      Drive.renderUploadArea('fh-version-upload', async (result, file) => {
        try {
          // ⚠ Scoped to THIS panel — a closing version panel lingers ~300ms and
          // document.getElementById() would read the PREVIOUS file's note.
          await FilesHub.uploadNewVersion(f, result, file, _panel.querySelector('#fh-version-note').value.trim());
          Notifs.success('New version uploaded.'); closeModal(); loadFiles();
        } catch(e) { Notifs.showToast('Upload failed: ' + (e.message||e), 'error'); }
      }, { label:'Choose new version', dept, subfolder:'Files', allowLinks:false });
    }));

    // ── Share ──
    listEl.querySelectorAll('.fh-share').forEach(b => b.addEventListener('click', async () => {
      const f = allFiles.find(x=>x.id===b.dataset.id); if (!f) return;
      const usersSnap = await dbCachedGet('users', ()=>db.collection('users').get(), 60000).catch(()=>({docs:[]}));
      const userOpts = usersSnap.docs.map(d=>({id:d.id,...d.data()}))
        .map(u=>`<option value="${u.id}">${escHtml(u.displayName||u.email||u.id)}</option>`).join('');
      const deptOpts = Object.keys(window.DEPARTMENTS||{}).map(d=>`<option value="${escHtml(d)}">${escHtml(d)}</option>`).join('');
      const roleOpts = ['president','manager','employee','agent','finance'].map(r=>`<option value="${r}">${r}</option>`).join('');
      const alreadyShared = (f.shares||[]).length ? (f.shares||[]).map(s=>escHtml(s.label||s.id)).join(', ') : '—';
      const _panel = openPage(`Share "${escHtml(f.name||'File')}"`, `
        <div class="form-group"><label>Share with</label>
          <select id="fh-share-type">
            <option value="user">Specific person</option>
            <option value="dept">Department</option>
            <option value="role">Role</option>
          </select>
        </div>
        <div class="form-group">
          <label>Target</label>
          <select id="fh-share-target-user">${userOpts}</select>
          <select id="fh-share-target-dept" class="hidden">${deptOpts}</select>
          <select id="fh-share-target-role" class="hidden">${roleOpts}</select>
        </div>
        <div class="form-group"><label>Permission</label>
          <select id="fh-share-perm"><option value="view">View</option><option value="edit">Edit</option></select>
        </div>
        <div style="font-size:11px;color:var(--text-muted)">Already shared with: ${alreadyShared}</div>
      `, `<button class="btn-primary" id="fh-share-save">Share</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
      // ⚠ SCOPED TO THIS PANEL, NOT document — a closing share panel lingers
      // ~300ms and would win the getElementById race, so the share could be
      // granted to the target picked for the PREVIOUS file.
      const $ = (id) => _panel.querySelector('#' + id);
      const typeSel = $('fh-share-type');
      const uSel = $('fh-share-target-user');
      const dSel = $('fh-share-target-dept');
      const rSel = $('fh-share-target-role');
      typeSel.addEventListener('change', () => {
        uSel.classList.toggle('hidden', typeSel.value!=='user');
        dSel.classList.toggle('hidden', typeSel.value!=='dept');
        rSel.classList.toggle('hidden', typeSel.value!=='role');
      });
      $('fh-share-save').addEventListener('click', async () => {
        const type = typeSel.value;
        const sel = type==='user' ? uSel : type==='dept' ? dSel : rSel;
        const id = sel.value;
        if (!id) { Notifs.showToast('Choose a target','error'); return; }
        const label = type==='user' ? (sel.options[sel.selectedIndex]?.textContent||id) : id;
        const perm = $('fh-share-perm').value;
        try { await FilesHub.share(f, {type, id, label}, perm); Notifs.success('Shared.'); closeModal(); loadFiles(); }
        catch(e) { Notifs.showToast('Share failed: ' + (e.message||e), 'error'); }
      });
    }));
  };

  const loadFiles = async () => {
    listEl.innerHTML = window.skeletonHtml('rows');
    if (filterUid) {
      const snap = await db.collection(collection)
        .where('scope','==',scopeKey).where('deleted','==',false).where('uploadedBy','==',filterUid)
        .get().catch(()=>({docs:[]}));
      allFiles = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    } else {
      allFiles = await FilesHub.loadFiles(scopeKey, { includeDeleted:false });
    }
    const [folders, bin] = await Promise.all([
      FilesHub.loadFolders(scopeKey),
      FilesHub.loadFiles(scopeKey, { includeDeleted:true })
    ]);
    allFolders = folders;
    foldersById = {}; folders.forEach(fo => { foldersById[fo.id] = fo; });
    binFiles = filterUid ? bin.filter(f=>f.uploadedBy===filterUid) : bin;
    renderList();
  };

  loadFiles();

  uploadBtn?.addEventListener('click', () => {
    const folderOpts = allFolders.map(fo=>`<option value="${fo.id}">${escHtml(fo.name)}</option>`).join('');
    const prefill = (activeFolder!=='All' && activeFolder!=='__archived__' && activeFolder!=='__bin__') ? activeFolder : '';
    const _panel = openPage('Upload File', `
      <div class="form-group"><label>File Name / Title</label><input id="fn-title" placeholder="Descriptive name"/></div>
      <div class="form-group"><label>File Type</label>
        <select id="fn-type"><option>Document</option><option>Image</option><option>Spreadsheet</option><option>PDF</option><option>Other</option></select>
      </div>
      <div class="form-group"><label>Folder</label>
        <select id="fn-folder">
          <option value="">— General (no folder) —</option>
          ${folderOpts}
          <option value="__new__">+ New folder…</option>
        </select>
        <input id="fn-folder-new" class="hidden" placeholder="New folder name" style="margin-top:6px"/>
      </div>
      <div id="fn-upload-area"></div>
    `, `<button class="btn-primary" id="save-fn-btn">Upload</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    // ⚠ SCOPED TO THIS PANEL, NOT document. openPage keeps a CLOSING page in the
    // DOM for ~300ms; open a second Upload File inside that window and two panels
    // carry the same ids, with document.getElementById() resolving into the DYING
    // one — the visible Upload button does nothing, and the upload that does run
    // reads the PREVIOUS panel's title, type and folder.
    const $ = (id) => _panel.querySelector('#' + id);
    if (prefill) $('fn-folder').value = prefill;
    $('fn-folder').addEventListener('change', e => {
      $('fn-folder-new').classList.toggle('hidden', e.target.value !== '__new__');
    });
    let uploadedFile = null, uploadedRaw = null;
    Drive.renderUploadArea('fn-upload-area', (r, file) => { uploadedFile = r; uploadedRaw = file; }, { label: 'Choose file', dept, subfolder: 'Files' });
    $('save-fn-btn').addEventListener('click', async () => {
      const uploaderName = (window.userProfile && userProfile.displayName) || currentUser.email;
      let folderId = $('fn-folder').value;
      if (folderId === '__new__') {
        const newName = $('fn-folder-new').value.trim();
        if (!newName) { Notifs.showToast('Enter a folder name','error'); return; }
        if (RESERVED_FOLDER_NAMES.includes(newName.toLowerCase())) { Notifs.showToast('Reserved name','error'); return; }
        const ref = await db.collection('hub_folders').add({
          name: newName, parentId: null, scope: scopeKey, department: dept,
          createdBy: currentUser.uid, createdByName: uploaderName,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        folderId = ref.id;
      }
      const isLink = uploadedFile && uploadedFile.kind === 'link';
      const now = new Date().toISOString();
      const title = $('fn-title').value.trim() || (uploadedFile?.name || 'File');
      const versionEntry = { v:1, url: uploadedFile?.url||'', name: uploadedFile?.name||title,
        size: uploadedRaw?.size||null, contentType: uploadedRaw?.type||null, note:'',
        by: currentUser.uid, byName: uploaderName, at: now };
      await db.collection(collection).add({
        name: title,
        description: '',
        fileType: $('fn-type').value,
        kind: isLink ? 'link' : 'file',
        scope: scopeKey,
        department: dept,
        folderId: folderId || null,
        url: uploadedFile?.url || '',
        driveUrl: null,
        size: uploadedRaw?.size || null, contentType: uploadedRaw?.type || null,
        source: uploadedFile?.source || 'firebase',
        currentV: 1,
        versions: [versionEntry],
        archived: false,
        deleted: false, deletedAt: null, deletedBy: null,
        visibility: 'company',
        sharedUserIds: [], editorUserIds: [], shares: [],
        uploadedBy: currentUser.uid, uploaderName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); loadFiles();
    });
  });

  // ── Create an (empty) folder ──────────────────────
  newFolderBtn?.addEventListener('click', () => {
    openModal('New Folder', `
      <div class="form-group"><label>Folder Name</label><input id="nf-name" placeholder="e.g. Contracts, 2026 Projects"/></div>
      <div style="font-size:11px;color:var(--text-muted)">Create a folder now, then upload files or add links into it.</div>
    `, `<button class="btn-primary" id="save-nf-btn">Create Folder</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    document.getElementById('save-nf-btn').addEventListener('click', async () => {
      const name = document.getElementById('nf-name').value.trim();
      if (!name) { Notifs.showToast('Enter a folder name','error'); return; }
      if (RESERVED_FOLDER_NAMES.includes(name.toLowerCase())) { Notifs.showToast('Reserved name','error'); return; }
      const uploaderName = (window.userProfile && userProfile.displayName) || currentUser.email;
      const ref = await db.collection('hub_folders').add({
        name, parentId: null, scope: scopeKey, department: dept,
        createdBy: currentUser.uid, createdByName: uploaderName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); activeFolder = ref.id; loadFiles();
    });
  });

  // ── Attach a link (URL) with title + description ──
  addLinkBtn?.addEventListener('click', () => {
    const folderOpts = allFolders.map(fo=>`<option value="${fo.id}">${escHtml(fo.name)}</option>`).join('');
    const prefill = (activeFolder!=='All' && activeFolder!=='__archived__' && activeFolder!=='__bin__') ? activeFolder : '';
    const _panel = openPage('Add Link', `
      <div class="form-group"><label>Title</label><input id="lk-title" placeholder="e.g. Google Drive folder, Spec sheet"/></div>
      <div class="form-group"><label>URL</label><input id="lk-url" type="url" placeholder="https://…"/></div>
      <div class="form-group"><label>Description</label><textarea id="lk-desc" rows="2" placeholder="Optional notes about this link"></textarea></div>
      <div class="form-group"><label>Folder</label>
        <select id="lk-folder"><option value="">— General (no folder) —</option>${folderOpts}</select>
      </div>
      <div id="lk-err" class="error-msg hidden"></div>
    `, `<button class="btn-primary" id="save-lk-btn">Add Link</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    // ⚠ SCOPED TO THIS PANEL, NOT document — a closing Add Link panel lingers
    // ~300ms and would win the getElementById race, so this could save the
    // PREVIOUS link's title, URL, description and folder.
    const $ = (id) => _panel.querySelector('#' + id);
    if (prefill) $('lk-folder').value = prefill;
    $('save-lk-btn').addEventListener('click', async () => {
      const err = $('lk-err');
      const title = $('lk-title').value.trim();
      let url = $('lk-url').value.trim();
      if (!title) { err.textContent='Enter a title.'; err.classList.remove('hidden'); return; }
      if (!url)   { err.textContent='Enter a URL.'; err.classList.remove('hidden'); return; }
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;  // tolerate bare domains
      const uploaderName = (window.userProfile && userProfile.displayName) || currentUser.email;
      const now = new Date().toISOString();
      const folderId = $('lk-folder').value || null;
      await db.collection(collection).add({
        name: title, description: $('lk-desc').value.trim(),
        fileType: 'Other', kind: 'link', scope: scopeKey, department: dept,
        folderId,
        url, driveUrl: null, size: null, contentType: null, source: 'link',
        currentV: 1, versions: [{ v:1, url, name:title, size:null, contentType:null, note:'', by:currentUser.uid, byName:uploaderName, at:now }],
        archived: false, deleted: false, deletedAt: null, deletedBy: null,
        visibility: 'company', sharedUserIds: [], editorUserIds: [], shares: [],
        uploadedBy: currentUser.uid, uploaderName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); loadFiles();
    });
  });
};

// ── Shared doc collection helper ──────────────────
window.renderDocCollection = function(container, collection, title, currentUser, currentRole, cfg) {
  const canAdd = cfg?.dept ? canEditDept(cfg.dept)
    : (currentRole==='president'||currentRole==='owner'||currentRole==='manager'||currentRole==='finance');
  // Government Biddings gets a full lifecycle (view/edit, status change, move between
  // PhilGEPS / Active Bids / Archive buckets, delete). Other collections that share
  // this renderer keep the original read-only-card behaviour.
  const isGov = cfg?.dept === 'Government Biddings';
  const canManageGov = isGov && canEditDept('Government Biddings');
  // v14 Wave 7 Pass 5 — GOV_BUCKETS used to be re-declared here (byte-identical
  // to renderGovBiddings' own copy in app.js at the time). Now there is ONE
  // canonical definition, window.GOV_BUCKETS (js/screens/govit.js), and this
  // just reads it — see that file's header for the before/after dedupe.
  const GOV_BUCKETS = window.GOV_BUCKETS;
  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div></div>
      ${canAdd?`<button class="btn-primary btn-sm" id="add-doc-btn-${collection}">+ Add</button>`:''}
    </div>
    <div id="doc-list-${collection}">${window.skeletonHtml('rows')}</div>
  `;
  const loadDocs = async () => {
    const snap = await db.collection(collection).get().catch(() => ({ docs: [] }));
    const docs = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const list = document.getElementById(`doc-list-${collection}`);
    if (!docs.length) { list.innerHTML=`<div class="empty-state" style="padding:20px"><div class="empty-icon">${emojiIcon(cfg?.icon||'📄',44)}</div><h4>No ${title} yet</h4></div>`; if (window.lucide) lucide.createIcons({ nodes: [list] }); return; }
    if (window.lucide) lucide.createIcons({ nodes: [list] });
    list.innerHTML = `<div class="item-list">${docs.map(d=>`
      <div class="item-card"${isGov?` data-gov-id="${d.id}" style="cursor:pointer"`:''}>
        <div class="item-top"><div class="item-title">${escHtml(d.title||d.name||'Untitled')}</div>
          ${window.statusBadge2 ? statusBadge2('gov', d.status||'active') : `<span class="badge ${statusBadge(d.status)}">${d.status||'active'}</span>`}
        </div>
        <div class="item-meta">
          ${d.agency?`<span>${emojiIcon('🏢',11)} ${escHtml(d.agency)}</span>`:''}
          ${d.description?`<span>${escHtml(d.description)}</span>`:''}
          ${d.deadline?`<span style="font-size:11px;color:var(--text-muted)">${emojiIcon('⏰',11)} Due ${new Date(d.deadline).toLocaleDateString('en-PH')}</span>`:''}
          ${d.fileUrl?`<a href="${safeHttpUrl(d.fileUrl)}" target="_blank" class="btn-link" style="font-size:11px" onclick="event.stopPropagation()">${emojiIcon('📎',11)} View File</a>`:''}
          ${d.createdAt?`<span style="font-size:11px;color:var(--text-muted)">${new Date(d.createdAt.toDate()).toLocaleDateString('en-PH')}</span>`:''}
        </div>
      </div>`).join('')}</div>`;
    if (window.lucide) lucide.createIcons({ nodes: [list] });
    if (isGov) {
      list.querySelectorAll('.item-card[data-gov-id]').forEach(card => {
        card.addEventListener('click', () => {
          const d = docs.find(x=>x.id===card.dataset.govId);
          if (d) openGovBidDetail(d);
        });
      });
    }
  };

  // ── Gov bidding detail / edit / move / delete ───────────────────────
  function openGovBidDetail(d) {
    const GOV_STATUSES = ['active','submitted','won','lost','cancelled','archived'];
window.GOV_STATUSES = GOV_STATUSES; // v13: STATUS_META 'gov' passthrough
    const body = canManageGov ? `
      <div class="form-group"><label>Title</label><input id="gb-title" value="${escHtml(d.title||d.name||'')}"/></div>
      <div class="form-row"><div class="form-group"><label>Procuring Entity / Agency</label><input id="gb-agency" value="${escHtml(d.agency||'')}"/></div><div class="form-group"><label>Reference / Bid No.</label><input id="gb-refno" value="${escHtml(d.refNo||'')}"/></div></div>
      <div class="form-row"><div class="form-group"><label>Submission Deadline</label><input id="gb-deadline" type="date" value="${escHtml(d.deadline||'')}"/></div><div class="form-group"><label>ABC (₱)</label><input id="gb-abc" type="number" inputmode="decimal" value="${d.abc!=null?d.abc:''}"/></div></div>
      <div class="form-group"><label>Description</label><textarea id="gb-desc" rows="3">${escHtml(d.description||'')}</textarea></div>
      <div class="form-row">
        <div class="form-group"><label>Status</label>
          <select id="gb-status">${GOV_STATUSES.map(s=>`<option value="${s}" ${(d.status||'active')===s?'selected':''}>${s}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>Bucket</label>
          <select id="gb-bucket">${GOV_BUCKETS.map(b=>`<option value="${b.collection}" ${b.collection===collection?'selected':''}>${b.label}</option>`).join('')}</select>
        </div>
      </div>
      ${d.fileUrl?`<a href="${safeHttpUrl(d.fileUrl)}" target="_blank" class="btn-link" style="font-size:12px;display:block;margin-bottom:8px">${emojiIcon('📎',12)} View File</a>`:''}
      <div id="gb-file-area"></div>
    ` : `
      <div style="margin-bottom:10px">${window.statusBadge2 ? statusBadge2('gov', d.status||'active') : `<span class="badge ${statusBadge(d.status)}">${d.status||'active'}</span>`}</div>
      <p style="font-size:14px;line-height:1.6;margin-bottom:10px">${escHtml(d.description||'No details.')}</p>
      ${d.fileUrl?`<a href="${safeHttpUrl(d.fileUrl)}" target="_blank" class="btn-link" style="font-size:12px;display:block">${emojiIcon('📎',12)} View File</a>`:''}
    `;
    const _panel = openPage(escHtml(d.title||d.name||'Bidding'), body,
      canManageGov
        ? `<button class="btn-primary" id="gb-save">Save</button><button class="btn-danger" id="gb-del">Delete</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`
        : `<button class="btn-secondary" onclick="closeModal()">Close</button>`);
    let gbFile = null;
    Drive.renderUploadArea('gb-file-area', r => { gbFile = r; }, { label: d.fileUrl ? 'Replace file' : 'Attach file', dept: 'Government Biddings', subfolder: collection });

    // ⚠ SCOPED TO THIS PANEL, NOT document. openPage keeps a CLOSING page in the
    // DOM for ~300ms; open a second bid inside that window and two panels carry
    // the same ids, with document.getElementById() resolving into the DYING one.
    // Bind-time that gives a dead Save/Delete; inside the handler it would write
    // the PREVIOUS bid's title, agency, deadline and ABC onto THIS bid — and the
    // bucket read decides a move (create-in-target + delete-here) batch.
    const $ = (id) => _panel.querySelector('#' + id);
    $('gb-save')?.addEventListener('click', async () => {
      const title = $('gb-title').value.trim();
      if (!title) { Notifs.showToast('Enter a title.','error'); return; }
      const targetCol = $('gb-bucket').value;
      const payload = {
        title,
        description: $('gb-desc').value.trim(),
        agency: $('gb-agency').value.trim(),
        refNo: $('gb-refno').value.trim(),
        deadline: $('gb-deadline').value || null,
        abc: parseFloat($('gb-abc').value) || null,
        status: $('gb-status').value,
        fileUrl: gbFile?.url || d.fileUrl || null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: currentUser.uid
      };
      if (targetCol !== collection) {
        if (!(await confirmDialog({message:`Move "${escHtml(title)}" to ${GOV_BUCKETS.find(b=>b.collection===targetCol)?.label||targetCol}?`, html:true}))) return;
        // Move = create in the target bucket + delete from current (atomic batch).
        const { id:_omitId, ...rest } = d;
        const batch = db.batch();
        const newRef = db.collection(targetCol).doc();
        batch.set(newRef, { ...rest, ...payload, addedBy: d.addedBy||currentUser.uid, createdAt: d.createdAt||firebase.firestore.FieldValue.serverTimestamp() });
        batch.delete(db.collection(collection).doc(d.id));
        await batch.commit();
        Notifs.success('Bid moved.');
      } else {
        await db.collection(collection).doc(d.id).update(payload);
        Notifs.success('Bid updated.');
      }
      closeModal(); loadDocs();
    });
    $('gb-del')?.addEventListener('click', async () => {
      if (!(await confirmDialog({message:`Delete "${escHtml(d.title||d.name||'this bid')}"? This cannot be undone.`, danger:true, html:true}))) return;
      await db.collection(collection).doc(d.id).delete();
      closeModal(); Notifs.success('Bid deleted.'); loadDocs();
    });
  }

  loadDocs();
  document.getElementById(`add-doc-btn-${collection}`)?.addEventListener('click', () => {
    const _panel = openPage(`Add ${title}`, `
      <div class="form-group"><label>Title</label><input id="gd-title"/></div>
      ${isGov?`<div class="form-row"><div class="form-group"><label>Procuring Entity / Agency</label><input id="gd-agency"/></div><div class="form-group"><label>Reference / Bid No.</label><input id="gd-refno"/></div></div>
      <div class="form-row"><div class="form-group"><label>Submission Deadline</label><input id="gd-deadline" type="date"/></div><div class="form-group"><label>ABC (₱)</label><input id="gd-abc" type="number" inputmode="decimal"/></div></div>`:''}
      <div class="form-group"><label>Description</label><textarea id="gd-desc" rows="3"></textarea></div>
      <div id="gd-file-area"></div>
    `, `<button class="btn-primary" id="save-gd-btn">Save</button><button class="btn-secondary" onclick="closeModal()">Cancel</button>`);
    let uploadedFile = null;
    Drive.renderUploadArea('gd-file-area', r => { uploadedFile = r; }, { label: 'Attach file', dept: title, subfolder: collection });
    // ⚠ SCOPED TO THIS PANEL, NOT document — a closing Add panel lingers ~300ms
    // and would win the getElementById race, so this could file the PREVIOUS
    // entry's title, agency, deadline and ABC as a brand-new record.
    const $ = (id) => _panel.querySelector('#' + id);
    $('save-gd-btn').addEventListener('click', async () => {
      const title = $('gd-title').value.trim();
      if (!title) { Notifs.showToast('Enter a title.','error'); return; }
      await db.collection(collection).add({
        title,
        description: $('gd-desc').value.trim(),
        // Gov-bidding fields exist only in the isGov add form above — reading
        // them unconditionally would throw on the Marketing/Sales collections
        // that share this renderer (their inputs don't exist).
        ...(isGov ? {
          agency: $('gd-agency').value.trim(),
          refNo: $('gd-refno').value.trim(),
          deadline: $('gd-deadline').value || null,
          abc: parseFloat($('gd-abc').value) || null,
        } : {}),
        fileUrl: uploadedFile?.url || null,
        status: 'active',
        addedBy: currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal(); loadDocs();
    });
  });
};

// PRODUCTION DEPARTMENT + PROJECT LIFECYCLE + PURCHASING DEPARTMENT — moved
// verbatim to js/screens/production.js (Wave 7 Pass 4, 2026-08-03). This was
// the entire tail of the file (PROD_STAGES/QC/Delivery Receipt through
// printReceivingReport at EOF) — one contiguous cut. See that file's header
// for the full contents list, the 8-point changes made, and what deliberately
// stayed here (window.Projects, openBillingInvoice/buildBillingInvoiceHTML,
// nextCounterId, the Ledger service, window.renderInventory in modules.js).
