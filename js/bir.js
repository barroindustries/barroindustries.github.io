/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — BIR Suite (v12 WS39)
   js/bir.js  (loads AFTER config.js / statutory-tables.js / letterhead.js,
               BEFORE departments.js — departments.js calls these helpers)
   ═══════════════════════════════════════════════════
   Books of account prints (General Journal · General Ledger · Cash Receipts
   Book · Cash Disbursements Book), statutory WORKSHEETS (2550M/Q VAT, 1601-C
   withholding, Alphalist / 2316), and a working-paper Financial Statement.

   Everything here is a WORKSHEET — figures for the accountant to transcribe
   into eBIRForms/eFPS, never an official filing by itself. Every print uses
   brandEntity('bir') (the DTI-registered taxpayer with a real TIN) — NEVER
   the default 'corporate' (OPC) entity, which has no TIN on file.
   ═══════════════════════════════════════════════════ */
'use strict';

// UMD-ish shim (v14 re-audit — matches js/money-core.js's exact pattern):
// makes `window` exist under plain Node so tests/money.test.mjs can
// `require()` this file directly (for window.computeVatSummary, a pure
// function per its own comment below) with zero build step. In the browser,
// window already exists, so this is a no-op.
if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

// ── window.BIRCONFIG ─────────────────────────────────────────────────────
window.BIRCONFIG = {
  // ‼️ FLAG FOR NEIL — PLACEHOLDER. true = files 2550M/Q (the app's existing
  // behavior — 12% VAT computed on every sale — only makes sense if this is
  // true). If the DTI entity is actually Non-VAT/percentage-tax, set false →
  // the VAT screen hides itself and shows a "entity is Non-VAT (2551Q)"
  // notice instead of silently producing the wrong form. 2551Q is NOT built.
  vatRegistered: true,
  // ‼️ FLAG FOR NEIL — OR/SI series stay NULL (minting disabled, the "Next OR
  // #" buttons stay hidden) until the real Authority-to-Print facts arrive.
  // Example shape once known:
  //   or: { counterKey:'or_series_2026A', prefix:'OR-', start:1, end:5000, pad:6, atpNo:'ATP #…' }
  series: { or: null, si: null }
};

// ── Category → default VAT treatment for the general expense flow ───────
window.VAT_DEFAULT_BY_CATEGORY = {
  'Office Supplies': 'inclusive', 'Materials': 'inclusive', 'Utilities': 'inclusive',
  'Meals': 'exempt', 'Transportation': 'exempt', 'Other': 'exempt'
};

// ── Shared input-VAT form field (used by Add-Expense / Ledger manual entry /
//    dept budget-expense modal — Spec 3) ─────────────────────────────────
window.vatFieldHTML = function (id, def) {
  return `<div class="form-group"><label>Input VAT</label>
    <select id="${id}" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;width:100%;background:var(--surface);color:var(--text)">
      <option value="inclusive" ${def === 'inclusive' ? 'selected' : ''}>VATable — 12% included in amount</option>
      <option value="exempt" ${def !== 'inclusive' ? 'selected' : ''}>VAT-exempt / no VAT on receipt</option>
    </select></div>`;
};
window.readVatField = function (id, amount) {
  const t = document.getElementById(id)?.value || 'exempt';
  return { vatTreatment: t, inputVat: t === 'exempt' ? 0 : window.vatSplit(amount || 0, 'inclusive').vat };
};

// ── ONE VAT-summary computation, shared by Financial Reports, the 2550
//    worksheet and the Financial Statement print — never re-derive this math
//    (reuses the exact renderFinancialReports logic incl. the legacy
//    amount−amount/1.12 fallback). rows = ledger row objects for the period. ──
window.computeVatSummary = function (rows) {
  const income = rows.filter(e => ledgerKind(e) === 'income');
  const expense = rows.filter(e => ledgerKind(e) === 'expense');
  // v14 fix: previously hardcoded to 'Sales Revenue' only — window.COA.income
  // also lists 'Other Income' (js/config.js), but any row posted under that
  // category was invisible to this function entirely (not even bucketed as
  // exempt), silently understating Output VAT/VAT payable for anything
  // VATable booked as Other Income (e.g. a scrap-material sale, rental
  // income). Falls back to the literal COA.income pair if window.COA isn't
  // loaded (this file's own tests require() it standalone).
  const incomeCats = (window.COA && window.COA.income) || ['Sales Revenue', 'Other Income'];
  const salesRows = income.filter(e => incomeCats.includes(e.category || ''));
  let vatableSales = 0, exemptSales = 0, outputVat = 0;
  salesRows.forEach(e => {
    const amt = e.amount || 0;
    const v = (e.vatAmount != null) ? e.vatAmount : (amt - amt / 1.12);   // legacy fallback
    if (v > 0) { outputVat += v; vatableSales += amt - v; } else exemptSales += amt;
  });
  const inputVat = expense.reduce((s, e) => s + (e.inputVat || 0), 0);
  return { vatableSales, exemptSales, outputVat, inputVat, netVat: outputVat - inputVat };
};

// ── Unverified-statutory-rates watermark/banner (WS21 discipline, ONE
//    wording — do not re-word per screen, drift risk) ────────────────────
window.birUnverifiedBanner = function (year) {
  const t = window.STATUTORY && window.STATUTORY[year];
  if (!t || t.verified !== false) return '';
  return `<div class="bir-banner">⚠ DRAFT — statutory tables for ${escHtml(String(year))} are UNVERIFIED (WS21 placeholder rates). Do not file until the accountant verifies the SSS / PhilHealth / Pag-IBIG / TRAIN withholding rates and flips STATUTORY[${escHtml(String(year))}].verified to true.</div>`;
};

// ── OR/SI minting hook — Spec 8 call sites. Renders nothing (and wires
//    nothing) while BIRCONFIG.series[seriesKey] is null — dormant by design
//    until Neil supplies the real ATP range. ─────────────────────────────
window.birOrButtonHTML = function (fieldId, seriesKey) {
  seriesKey = seriesKey || 'or';
  if (!(window.BIRCONFIG && window.BIRCONFIG.series && window.BIRCONFIG.series[seriesKey])) return '';
  return ` <button type="button" class="btn-secondary btn-sm bir-or-btn" data-field="${escHtml(fieldId)}" data-series="${escHtml(seriesKey)}" style="margin-top:4px" title="Mint the next OR number from the registered ATP series">${window.emojiIcon('⚙',14)} Next OR #</button>`;
};
window.wireBirOrButtons = function (scope) {
  (scope || document).querySelectorAll('.bir-or-btn').forEach(btn => {
    if (btn._birWired) return;
    btn._birWired = true;
    btn.addEventListener('click', async () => {
      try {
        const serial = await window.nextSerialInRange(btn.dataset.series);
        const input = document.getElementById(btn.dataset.field);
        if (input) input.value = serial;
      } catch (err) {
        if (window.Notifs && window.Notifs.showToast) window.Notifs.showToast(err.message || 'Could not mint serial', 'error');
      }
    });
  });
};

// ── Spec 8 — ATP-range-aware serial (NO year reset; refuses to mint past
//    the registered range). window.nextSerial (letterhead.js) stays
//    untouched — that one is for employee IDs / general future docs. ─────
window.nextSerialInRange = async function (seriesKey) {          // 'or' | 'si'
  const cfg = (window.BIRCONFIG.series || {})[seriesKey];
  if (!cfg) throw new Error('Series not configured — BIRCONFIG.series.' + seriesKey + ' is null (awaiting ATP details).');
  const ref = db.collection('_counters').doc(cfg.counterKey);
  const n = await db.runTransaction(async t => {
    const c = await t.get(ref);
    const cur = c.exists ? (c.data().count || (cfg.start - 1)) : (cfg.start - 1);
    const next = cur + 1;
    if (next > cfg.end) throw new Error(`${cfg.prefix} series exhausted (ATP range ${cfg.start}–${cfg.end}). Register a new series with BIR before issuing more.`);
    t.set(ref, { count: next, start: cfg.start, end: cfg.end, atpNo: cfg.atpNo || '' }, { merge: true });
    return next;
  });
  return `${cfg.prefix}${String(n).padStart(cfg.pad || 6, '0')}`;
};

// ── Shared print scaffolding — same-document window.print(), no pop-ups
//    (WS24 payslip pattern). The isolation CSS (.bir-print / @media print)
//    lives in css/styles.css; letterhead printCSS is injected inline here. ──
window.birToolbarHTML = function (opts) {
  opts = opts || {};
  return `<div class="no-print" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
    <button class="btn-primary btn-sm" onclick="window.print()">${window.emojiIcon('🖨',14)} Print</button>
    ${opts.csvId ? `<button class="btn-secondary btn-sm" id="${opts.csvId}">${window.emojiIcon('⬇',14)} CSV</button>` : ''}
    ${opts.extraButtons || ''}
  </div>`;
};
// ONE letterhead call shape for every WS39 print — entity ALWAYS 'bir'
// (never buildLetterhead's own default, which resolves to the OPC entity
// with a blank TIN — a genuine filing defect).
window.birBuildPrintHTML = function (opts) {
  const lh = window.buildLetterhead({
    entity: window.brandEntity('bir'),
    docTitle: opts.docTitle, dateLabel: opts.dateLabel, extraMeta: opts.extraMeta || [],
    accent: '#1E3A5F', signatures: opts.signatures || null,
    footerNote: 'WORKSHEET — figures for accountant transcription into eBIRForms/eFPS, not an official filing by itself · Barro Industries Operating System · ' + new Date().toLocaleString('en-PH')
  });
  return `<style>${lh.printCSS}</style>
    <div class="bir-print${opts.watermark ? ' bir-watermark' : ''}">
      ${lh.headerHTML}
      ${opts.bodyHTML}
      ${lh.footerHTML}
    </div>`;
};

// ═══════════════════════════════════════════════════════════
//  renderBIRTab — the Finance → BIR sub-tab entry point (Spec 15)
// ═══════════════════════════════════════════════════════════
window.renderBIRTab = async function (container, currentUser, currentRole) {
  const activeDoc = window._birActiveDoc || 'books';
  const docs = [
    { key: 'books', label: '📚 Books' },
    { key: 'vat', label: '🧾 VAT (2550)' },
    { key: 'wht', label: '💼 Withholding (1601-C)' },
    { key: 'alpha', label: '📋 Alphalist / 2316' },
    { key: 'fs', label: '📊 Financial Statements' }
  ];
  container.innerHTML = `
    <div style="margin-bottom:10px">
      <h3 style="margin:0 0 4px">${window.emojiIcon('🧾',20)} BIR Suite</h3>
      <div style="font-size:11px;color:var(--text-muted)">Books of account, statutory worksheets &amp; the Financial Statement — figures for your accountant to transcribe into eBIRForms/eFPS. These are WORKSHEETS, not official filings.</div>
    </div>
    <div id="bir-doc-picker">${window.chipTabs(docs, activeDoc)}</div>
    <div id="bir-doc-area" style="margin-top:12px"><div class="loading-placeholder">Loading…</div></div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [container] });
  const renderBirDoc = (key) => {
    window._birActiveDoc = key;
    const area = document.getElementById('bir-doc-area');
    if (!area) return;
    if (key === 'books') return window.renderBirBooks(area, currentUser, currentRole);
    if (key === 'vat') return window.renderBirVat(area, currentUser, currentRole);
    if (key === 'wht') return window.renderBirWht(area, currentUser, currentRole);
    if (key === 'alpha') return window.renderBirAlpha(area, currentUser, currentRole);
    if (key === 'fs') return window.renderBirFS(area, currentUser, currentRole);
  };
  window.bindChipTabs(document.getElementById('bir-doc-picker'), renderBirDoc);
  renderBirDoc(activeDoc);
};

// ═══════════════════════════════════════════════════════════
//  Spec 5 — Books of account (all date-range-bounded, all brandEntity('bir'))
// ═══════════════════════════════════════════════════════════
window.renderBirBooks = async function (container, currentUser, currentRole) {
  const state = window._birBooksState || (window._birBooksState = { doc: 'gj', period: 'month' });
  const bookDocs = [
    { key: 'gj', label: 'General Journal' },
    { key: 'gl', label: 'General Ledger' },
    { key: 'crb', label: 'Cash Receipts Book' },
    { key: 'cdb', label: 'Cash Disbursements Book' }
  ];
  container.innerHTML = `
    <div id="bir-book-picker">${window.chipTabs(bookDocs, state.doc)}</div>
    <div id="bir-books-period" style="margin-top:8px">${window.periodPicker(state.period, {})}</div>
    <div id="bir-books-body" style="margin-top:10px"><div class="loading-placeholder">Building…</div></div>
  `;
  window.bindChipTabs(document.getElementById('bir-book-picker'), (key) => {
    state.doc = key; window.renderBirBooks(container, currentUser, currentRole);
  });
  window.bindPeriodPicker(document.getElementById('bir-books-period'), (key) => {
    state.period = key; window.renderBirBooks(container, currentUser, currentRole);
  }, { activeKey: state.period });
  const bodyEl = document.getElementById('bir-books-body');
  const pParsed = window.Period.parse(state.period);
  if (state.doc === 'gj') return window.birRenderGJ(bodyEl, pParsed);
  if (state.doc === 'gl') return window.birRenderGL(bodyEl, pParsed);
  if (state.doc === 'crb') return window.birRenderCRB(bodyEl, pParsed);
  if (state.doc === 'cdb') return window.birRenderCDB(bodyEl, pParsed);
};

// General Journal — synthesized from ledger (period-bounded rows whose
// refNumber does NOT start with CRJ-/CDJ-) PLUS legacy general_journal docs
// tagged "(legacy)". The orphaned collection gets no new writer.
window.birRenderGJ = async function (bodyEl, pParsed) {
  if (!bodyEl) return;
  bodyEl.innerHTML = '<div class="loading-placeholder">Building…</div>';
  const [ledgerSnap, gjSnap] = await Promise.all([
    window.ledgerForPeriod(pParsed.key), window.gjForPeriod(pParsed.key)
  ]);
  const ledRows = ledgerSnap.docs.map(d => d.data())
    .filter(e => !/^(CRJ|CDJ)-/.test(e.refNumber || ''))
    .map(e => ({
      date: e.date, particulars: e.description || e.account || '—', ref: e.refNumber || '',
      debit: e.type === 'debit' ? (e.amount || 0) : 0, credit: e.type === 'credit' ? (e.amount || 0) : 0, legacy: false
    }));
  const legacyRows = gjSnap.docs.flatMap(d => {
    const e = d.data();
    const particulars = e.accountTitle || e.description || '—';
    const ref = e.reference || e.refNumber || '';
    const rows = [];
    if (e.debit) rows.push({ date: e.date, particulars, ref, debit: e.debit || 0, credit: 0, legacy: true });
    if (e.credit) rows.push({ date: e.date, particulars, ref, debit: 0, credit: e.credit || 0, legacy: true });
    return rows;
  });
  const rows = [...ledRows, ...legacyRows].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const totDebit = rows.reduce((s, r) => s + r.debit, 0), totCredit = rows.reduce((s, r) => s + r.credit, 0);
  const bodyRows = rows.map(r => `<tr>
    <td>${r.date || '—'}</td>
    <td>${escHtml(r.particulars)}${r.legacy ? ' <span class="badge badge-gray" style="font-size:9px">legacy</span>' : ''}</td>
    <td><code>${escHtml(r.ref)}</code></td>
    <td class="num">${r.debit ? '₱' + fmt(r.debit) : '—'}</td>
    <td class="num">${r.credit ? '₱' + fmt(r.credit) : '—'}</td>
  </tr>`).join('');
  const table = `<table class="bir-t"><thead><tr><th>Date</th><th>Particulars</th><th>Ref</th><th>Debit</th><th>Credit</th></tr></thead>
    <tbody>${bodyRows || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No entries this period</td></tr>'}</tbody>
    <tfoot><tr class="bir-total-row"><td colspan="3">TOTAL</td><td class="num">₱${fmt(totDebit)}</td><td class="num">₱${fmt(totCredit)}</td></tr></tfoot></table>`;
  const printHTML = window.birBuildPrintHTML({ docTitle: 'GENERAL JOURNAL', dateLabel: pParsed.label, bodyHTML: table });
  bodyEl.innerHTML = window.birToolbarHTML({ csvId: 'bir-gj-csv' }) + printHTML;
  if (window.lucide) lucide.createIcons({ nodes: [bodyEl] });
  document.getElementById('bir-gj-csv')?.addEventListener('click', () => window.exportCSV('general-journal-' + pParsed.key, rows, [
    { key: 'date', label: 'Date' }, { key: 'particulars', label: 'Particulars' }, { key: 'ref', label: 'Ref' },
    { key: 'debit', label: 'Debit' }, { key: 'credit', label: 'Credit' }, { key: 'legacy', label: 'Legacy?' }
  ]));
};

// General Ledger — a NEW per-account (T-account) view: period-bounded ledger
// rows grouped by account (ledgerKind()/COA order), each account a section
// with rows chronological + a running balance + section totals.
window.birRenderGL = async function (bodyEl, pParsed) {
  if (!bodyEl) return;
  bodyEl.innerHTML = '<div class="loading-placeholder">Building…</div>';
  const ledgerSnap = await window.ledgerForPeriod(pParsed.key);
  const rows = ledgerSnap.docs.map(d => d.data()).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const KIND_ORDER = ['income', 'expense', 'asset', 'liability', 'equity'];
  const CREDIT_NORMAL = { income: true, liability: true, equity: true, expense: false, asset: false };
  const sections = {};
  rows.forEach(r => {
    const kind = ledgerKind(r);
    const acct = r.account || r.category || 'Uncategorized';
    const key = kind + '|' + acct;
    if (!sections[key]) sections[key] = { kind, account: acct, rows: [] };
    sections[key].rows.push(r);
  });
  const acctIndex = (kind, acct) => { const arr = (window.COA && window.COA[kind]) || []; const i = arr.indexOf(acct); return i === -1 ? 999 : i; };
  const sectionList = Object.values(sections).sort((a, b) => {
    const ki = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
    if (ki !== 0) return ki;
    const ai = acctIndex(a.kind, a.account) - acctIndex(b.kind, b.account);
    if (ai !== 0) return ai;
    return a.account.localeCompare(b.account);
  });
  let grandDebit = 0, grandCredit = 0;
  const csvRows = [];
  const sectionsHTML = sectionList.map(sec => {
    let bal = 0, secDebit = 0, secCredit = 0;
    const creditNormal = CREDIT_NORMAL[sec.kind];
    const rowsHTML = sec.rows.map(r => {
      const d = r.type === 'debit' ? (r.amount || 0) : 0, c = r.type === 'credit' ? (r.amount || 0) : 0;
      secDebit += d; secCredit += c; grandDebit += d; grandCredit += c;
      bal += creditNormal ? (c - d) : (d - c);
      csvRows.push({ account: sec.account, kind: sec.kind, date: r.date, particulars: r.description || '', ref: r.refNumber || '', debit: d, credit: c, balance: bal });
      return `<tr><td>${r.date || '—'}</td><td>${escHtml(r.description || '—')}</td><td><code>${escHtml(r.refNumber || '')}</code></td>
        <td class="num">${d ? '₱' + fmt(d) : '—'}</td><td class="num">${c ? '₱' + fmt(c) : '—'}</td><td class="num">₱${fmt(bal)}</td></tr>`;
    }).join('');
    return `<div class="bir-sec-h">${escHtml(sec.account)} <span style="font-weight:400;text-transform:none;font-size:8pt">(${escHtml(sec.kind)})</span></div>
      <table class="bir-t"><thead><tr><th>Date</th><th>Particulars</th><th>Ref</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
      <tbody>${rowsHTML}</tbody>
      <tfoot><tr class="bir-total-row"><td colspan="3">Section Total</td><td class="num">₱${fmt(secDebit)}</td><td class="num">₱${fmt(secCredit)}</td><td class="num">₱${fmt(bal)}</td></tr></tfoot></table>`;
  }).join('');
  const body = sectionsHTML || `<div class="empty-state"><div class="empty-icon">${window.emojiIcon('📒',44)}</div><h4>No ledger entries this period</h4></div>`;
  const grand = `<div class="bir-sec-h">GRAND TOTAL</div><table class="bir-t"><tbody><tr class="bir-total-row"><td>All accounts</td><td class="num">₱${fmt(grandDebit)}</td><td class="num">₱${fmt(grandCredit)}</td></tr></tbody></table>`;
  const printHTML = window.birBuildPrintHTML({ docTitle: 'GENERAL LEDGER', dateLabel: pParsed.label, bodyHTML: body + grand });
  bodyEl.innerHTML = window.birToolbarHTML({ csvId: 'bir-gl-csv' }) + printHTML;
  if (window.lucide) lucide.createIcons({ nodes: [bodyEl] });
  document.getElementById('bir-gl-csv')?.addEventListener('click', () => window.exportCSV('general-ledger-' + pParsed.key, csvRows, [
    { key: 'account', label: 'Account' }, { key: 'kind', label: 'Kind' }, { key: 'date', label: 'Date' }, { key: 'particulars', label: 'Particulars' },
    { key: 'ref', label: 'Ref' }, { key: 'debit', label: 'Debit' }, { key: 'credit', label: 'Credit' }, { key: 'balance', label: 'Balance' }
  ]));
};

// Cash Receipts Book — reads cash_receipt_journal DIRECTLY (date-range-
// bounded), one row per source transaction. Output VAT is looked up from the
// mirrored ledger row (CRJ-{id}) where present — postCRJToLedger does not
// always set vatAmount, so this column is often blank; that's accurate, not
// a bug in this print.
window.birRenderCRB = async function (bodyEl, pParsed) {
  if (!bodyEl) return;
  bodyEl.innerHTML = '<div class="loading-placeholder">Building…</div>';
  const [crjSnap, ledgerSnap] = await Promise.all([
    (pParsed.type === 'all'
      ? db.collection('cash_receipt_journal').get()
      : db.collection('cash_receipt_journal').where('date', '>=', pParsed.start).where('date', '<=', pParsed.end).get()
    ).catch(() => ({ docs: [] })),
    window.ledgerForPeriod(pParsed.key)
  ]);
  const ledgerByRef = {};
  ledgerSnap.docs.forEach(d => { const e = d.data(); if (e.refNumber) ledgerByRef[e.refNumber] = e; });
  const rows = crjSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  let totCash = 0, totRev = 0, totSundry = 0, totVat = 0;
  const csvRows = [];
  const bodyRows = rows.map(e => {
    const vat = (ledgerByRef['CRJ-' + e.id] && ledgerByRef['CRJ-' + e.id].vatAmount) || 0;
    totCash += e.debitCash || 0; totRev += e.creditSalesRevenue || 0; totSundry += e.creditSundryAmount || 0; totVat += vat;
    csvRows.push({ date: e.date, ref: e.reference || '', customer: e.customer || '', cash: e.debitCash || 0, revenue: e.creditSalesRevenue || 0,
      sundryAcct: e.creditSundryAcct || '', sundryAmt: e.creditSundryAmount || 0, outputVat: vat });
    return `<tr><td>${e.date || '—'}</td><td><code>${escHtml(e.reference || '—')}</code></td><td>${escHtml(e.customer || '—')}</td>
      <td class="num">₱${fmt(e.debitCash)}</td><td class="num">${e.creditSalesRevenue ? '₱' + fmt(e.creditSalesRevenue) : '—'}</td>
      <td>${escHtml(e.creditSundryAcct || '—')}${e.creditSundryAmount ? ' — ₱' + fmt(e.creditSundryAmount) : ''}</td>
      <td class="num">${vat ? '₱' + fmt(vat) : '—'}</td></tr>`;
  }).join('');
  const table = `<table class="bir-t"><thead><tr><th>Date</th><th>OR/Ref</th><th>Customer</th><th>Cash/Dr Total</th><th>Cr Sales Revenue</th><th>Cr Sundry</th><th>Output VAT</th></tr></thead>
    <tbody>${bodyRows || '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No cash receipts this period</td></tr>'}</tbody>
    <tfoot><tr class="bir-total-row"><td colspan="3">TOTAL</td><td class="num">₱${fmt(totCash)}</td><td class="num">₱${fmt(totRev)}</td><td class="num">₱${fmt(totSundry)}</td><td class="num">₱${fmt(totVat)}</td></tr></tfoot></table>`;
  const printHTML = window.birBuildPrintHTML({ docTitle: 'CASH RECEIPTS BOOK', dateLabel: pParsed.label, bodyHTML: table });
  bodyEl.innerHTML = window.birToolbarHTML({ csvId: 'bir-crb-csv' }) + printHTML;
  if (window.lucide) lucide.createIcons({ nodes: [bodyEl] });
  document.getElementById('bir-crb-csv')?.addEventListener('click', () => window.exportCSV('cash-receipts-book-' + pParsed.key, csvRows, [
    { key: 'date', label: 'Date' }, { key: 'ref', label: 'OR/Ref' }, { key: 'customer', label: 'Customer' }, { key: 'cash', label: 'Cash/Dr Total' },
    { key: 'revenue', label: 'Cr Sales Revenue' }, { key: 'sundryAcct', label: 'Cr Sundry Acct' }, { key: 'sundryAmt', label: 'Cr Sundry Amount' },
    { key: 'outputVat', label: 'Output VAT' }
  ]));
};

// Cash Disbursements Book — reads cash_disbursement_journal DIRECTLY
// (date-range-bounded). Input VAT is on the CDJ doc itself (vatAmount).
window.birRenderCDB = async function (bodyEl, pParsed) {
  if (!bodyEl) return;
  bodyEl.innerHTML = '<div class="loading-placeholder">Building…</div>';
  const cdjSnap = await (pParsed.type === 'all'
    ? db.collection('cash_disbursement_journal').get()
    : db.collection('cash_disbursement_journal').where('date', '>=', pParsed.start).where('date', '<=', pParsed.end).get()
  ).catch(() => ({ docs: [] }));
  const rows = cdjSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  let totCash = 0, totMat = 0, totLab = 0, totAP = 0, totSundry = 0, totVat = 0;
  const csvRows = [];
  const bodyRows = rows.map(e => {
    totCash += e.creditCash || 0; totMat += e.debitMaterial || 0; totLab += e.debitLabor || 0; totAP += e.debitAP || 0;
    totSundry += e.debitSundryAmount || 0; totVat += e.vatAmount || 0;
    csvRows.push({ date: e.date, ref: e.reference || '', payee: e.payee || '', cash: e.creditCash || 0, material: e.debitMaterial || 0,
      labor: e.debitLabor || 0, ap: e.debitAP || 0, sundryAcct: e.debitSundryAcct || '', sundryAmt: e.debitSundryAmount || 0,
      inputVat: e.vatAmount || 0, vatTreatment: e.vatTreatment || '' });
    return `<tr><td>${e.date || '—'}</td><td><code>${escHtml(e.reference || '—')}</code></td><td>${escHtml(e.payee || '—')}</td>
      <td class="num">₱${fmt(e.creditCash)}</td><td class="num">${e.debitMaterial ? '₱' + fmt(e.debitMaterial) : '—'}</td>
      <td class="num">${e.debitLabor ? '₱' + fmt(e.debitLabor) : '—'}</td><td class="num">${e.debitAP ? '₱' + fmt(e.debitAP) : '—'}</td>
      <td>${escHtml(e.debitSundryAcct || '—')}${e.debitSundryAmount ? ' — ₱' + fmt(e.debitSundryAmount) : ''}</td>
      <td class="num">${e.vatAmount ? '₱' + fmt(e.vatAmount) : '—'}</td><td>${e.vatTreatment === 'exempt' ? 'Exempt' : (e.vatAmount ? 'VATable' : '—')}</td></tr>`;
  }).join('');
  const table = `<table class="bir-t"><thead><tr><th>Date</th><th>Voucher/Ref</th><th>Payee</th><th>Cr Cash</th><th>Dr Material</th><th>Dr Labor</th><th>Dr AP</th><th>Dr Sundry</th><th>Input VAT</th><th>Treatment</th></tr></thead>
    <tbody>${bodyRows || '<tr><td colspan="10" style="text-align:center;color:var(--text-muted)">No disbursements this period</td></tr>'}</tbody>
    <tfoot><tr class="bir-total-row"><td colspan="3">TOTAL</td><td class="num">₱${fmt(totCash)}</td><td class="num">₱${fmt(totMat)}</td><td class="num">₱${fmt(totLab)}</td><td class="num">₱${fmt(totAP)}</td><td class="num">₱${fmt(totSundry)}</td><td class="num">₱${fmt(totVat)}</td><td></td></tr></tfoot></table>`;
  const printHTML = window.birBuildPrintHTML({ docTitle: 'CASH DISBURSEMENTS BOOK', dateLabel: pParsed.label, bodyHTML: table });
  bodyEl.innerHTML = window.birToolbarHTML({ csvId: 'bir-cdb-csv' }) + printHTML;
  if (window.lucide) lucide.createIcons({ nodes: [bodyEl] });
  document.getElementById('bir-cdb-csv')?.addEventListener('click', () => window.exportCSV('cash-disbursements-book-' + pParsed.key, csvRows, [
    { key: 'date', label: 'Date' }, { key: 'ref', label: 'Voucher/Ref' }, { key: 'payee', label: 'Payee' }, { key: 'cash', label: 'Cr Cash Total' },
    { key: 'material', label: 'Dr Materials' }, { key: 'labor', label: 'Dr Labor' }, { key: 'ap', label: 'Dr AP' }, { key: 'sundryAcct', label: 'Dr Sundry Acct' },
    { key: 'sundryAmt', label: 'Dr Sundry Amount' }, { key: 'inputVat', label: 'Input VAT' }, { key: 'vatTreatment', label: 'VAT Treatment' }
  ]));
};

// ═══════════════════════════════════════════════════════════
//  Spec 6a — 2550M/Q VAT worksheet
// ═══════════════════════════════════════════════════════════
window.renderBirVat = async function (container, currentUser, currentRole) {
  if (!window.BIRCONFIG || !window.BIRCONFIG.vatRegistered) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${window.emojiIcon('🧾',44)}</div><h4>2551Q — not yet built</h4>
      <p style="color:var(--text-muted)">BIRCONFIG.vatRegistered is set to false — this entity is flagged Non-VAT / percentage-tax. The 2550 VAT worksheet does not apply and 2551Q has not been built. ‼️ Confirm the entity's actual VAT registration status with the accountant.</p></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [container] });
    return;
  }
  const state = window._birVatState || (window._birVatState = { period: 'month', priorCreditable: 0 });
  container.innerHTML = `
    <div id="bir-vat-period">${window.periodPicker(state.period, {})}</div>
    <div id="bir-vat-body" style="margin-top:10px"><div class="loading-placeholder">Building…</div></div>
  `;
  window.bindPeriodPicker(document.getElementById('bir-vat-period'), (key) => {
    // v14 fix: priorCreditable is an accountant-typed figure for ONE specific
    // period's 2550 worksheet — it must not silently carry over when the
    // period picker switches (e.g. June's manually-entered prior-credit
    // otherwise kept applying to July's Net VAT calc with no visual cue it
    // was stale). Reset it whenever the period actually changes.
    if (key !== state.period) state.priorCreditable = 0;
    state.period = key;
    window.renderBirVat(container, currentUser, currentRole);
  }, { activeKey: state.period });
  await window.birRenderVatBody(document.getElementById('bir-vat-body'), state, currentUser);
};

window.birRenderVatBody = async function (bodyEl, state, currentUser) {
  if (!bodyEl) return;
  const pParsed = window.Period.parse(state.period);
  if (pParsed.type !== 'month' && pParsed.type !== 'quarter') {
    bodyEl.innerHTML = `<div class="empty-state"><div class="empty-icon">${window.emojiIcon('📅',44)}</div><h4>Pick a month or a quarter</h4><p style="color:var(--text-muted)">2550M files monthly, 2550Q quarterly — use the Custom picker above to pick a specific month or quarter (not All Time / Year).</p></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [bodyEl] });
    return;
  }
  bodyEl.innerHTML = '<div class="loading-placeholder">Building…</div>';
  const ledgerSnap = await window.ledgerForPeriod(pParsed.key);
  const rows = ledgerSnap.docs.map(d => d.data());
  const f = window.computeVatSummary(rows);
  const worksheetType = pParsed.type === 'quarter' ? '2550Q' : '2550M';
  const net = f.netVat - (state.priorCreditable || 0);
  const year = pParsed.type === 'quarter' ? pParsed.key.match(/^quarter:(\d{4})/)[1] : pParsed.key.slice(6, 10);
  const watermark = !!(window.STATUTORY && window.STATUTORY[year] && window.STATUTORY[year].verified === false);
  const banner = window.birUnverifiedBanner(year);
  const table = `<table class="bir-t"><tbody>
      <tr><td>VATable Sales (net of VAT)</td><td class="num">₱${fmt(f.vatableSales)}</td></tr>
      <tr><td>VAT-Exempt Sales</td><td class="num">₱${fmt(f.exemptSales)}</td></tr>
      <tr class="bir-total-row"><td>Output VAT</td><td class="num">₱${fmt(f.outputVat)}</td></tr>
      <tr><td>Less: Input VAT this period</td><td class="num">−₱${fmt(f.inputVat)}</td></tr>
      <tr><td>Less: Prior-period creditable input VAT <span class="no-print" style="font-weight:400">(accountant-supplied — <input id="bir-vat-prior" type="number" step="0.01" value="${state.priorCreditable || 0}" style="width:110px;padding:2px 6px"/>)</span></td>
        <td class="num">−₱${fmt(state.priorCreditable || 0)}</td></tr>
      <tr class="bir-total-row"><td>Net VAT ${net >= 0 ? 'Payable' : 'Creditable'}</td><td class="num">₱${fmt(Math.abs(net))}</td></tr>
    </tbody></table>`;
  const printHTML = window.birBuildPrintHTML({
    docTitle: worksheetType + ' — VAT WORKSHEET', dateLabel: pParsed.label, bodyHTML: banner + table, watermark
  });
  const canSave = !!(window.isFinancePriv && window.isFinancePriv());
  bodyEl.innerHTML = window.birToolbarHTML({
    csvId: 'bir-vat-csv',
    extraButtons: canSave ? `<button class="btn-secondary btn-sm" id="bir-vat-save-tax">${window.emojiIcon('💾',14)} Save to Taxes tab</button>` : ''
  }) + printHTML;
  if (window.lucide) lucide.createIcons({ nodes: [bodyEl] });
  document.getElementById('bir-vat-prior')?.addEventListener('input', (ev) => {
    state.priorCreditable = parseFloat(ev.target.value) || 0;
    window.birRenderVatBody(bodyEl, state, currentUser);
  });
  document.getElementById('bir-vat-csv')?.addEventListener('click', () => window.exportCSV('vat-worksheet-' + pParsed.key, [
    { label: 'VATable Sales', amount: f.vatableSales }, { label: 'Exempt Sales', amount: f.exemptSales },
    { label: 'Output VAT', amount: f.outputVat }, { label: 'Input VAT this period', amount: f.inputVat },
    { label: 'Prior-period creditable', amount: state.priorCreditable || 0 },
    { label: 'Net VAT ' + (net >= 0 ? 'Payable' : 'Creditable'), amount: Math.abs(net) }
  ], [{ key: 'label', label: 'Line' }, { key: 'amount', label: 'Amount' }]));
  document.getElementById('bir-vat-save-tax')?.addEventListener('click', async () => {
    await db.collection('tax_records').add({
      period: pParsed.label, type: 'VAT',
      amount: Math.max(0, f.netVat - (state.priorCreditable || 0)), dueDate: '', status: 'pending',
      worksheetType: pParsed.type === 'quarter' ? '2550Q' : '2550M',
      sourceFigures: { ...f, priorCreditable: state.priorCreditable || 0 }, generatedBy: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (window.Notifs) Notifs.success('Saved to Taxes tab.');
  });
};

// ═══════════════════════════════════════════════════════════
//  Spec 6b — 1601-C + agency remittance cross-check
// ═══════════════════════════════════════════════════════════
window.renderBirWht = async function (container, currentUser, currentRole) {
  const state = window._birWhtState || (window._birWhtState = { period: 'month' });
  container.innerHTML = `
    <div id="bir-wht-period">${window.periodPicker(state.period, {})}</div>
    <div id="bir-wht-body" style="margin-top:10px"><div class="loading-placeholder">Building…</div></div>
  `;
  window.bindPeriodPicker(document.getElementById('bir-wht-period'), (key) => {
    state.period = key; window.renderBirWht(container, currentUser, currentRole);
  }, { activeKey: state.period });
  await window.birRenderWhtBody(document.getElementById('bir-wht-body'), state);
};

window.birRenderWhtBody = async function (bodyEl, state) {
  if (!bodyEl) return;
  const pParsed = window.Period.parse(state.period);
  if (pParsed.type !== 'month') {
    bodyEl.innerHTML = `<div class="empty-state"><div class="empty-icon">${window.emojiIcon('📅',44)}</div><h4>Pick a month</h4><p style="color:var(--text-muted)">1601-C is a monthly remittance worksheet — use the Custom picker above to pick a specific month.</p></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [bodyEl] });
    return;
  }
  bodyEl.innerHTML = '<div class="loading-placeholder">Building…</div>';
  const month = pParsed.key.slice(6); // 'month:YYYY-MM' -> 'YYYY-MM'
  const year = month.slice(0, 4);
  const [shSnap, wpSnap, whtLegSnap, sssLegSnap, phLegSnap, hdmfLegSnap] = await Promise.all([
    db.collection('salary_history').where('month', '==', month).get().catch(() => ({ docs: [] })),
    db.collection('payslips').where('payPeriodStart', '>=', month + '-01').where('payPeriodStart', '<=', month + '-31').get().catch(() => ({ docs: [] })),
    db.collection('ledger').where('refNumber', '==', `WHTPAY-${month}`).limit(1).get().catch(() => ({ docs: [] })),
    db.collection('ledger').where('refNumber', '==', `SSSPAY-${month}`).limit(1).get().catch(() => ({ docs: [] })),
    db.collection('ledger').where('refNumber', '==', `PHPAY-${month}`).limit(1).get().catch(() => ({ docs: [] })),
    db.collection('ledger').where('refNumber', '==', `HDMFPAY-${month}`).limit(1).get().catch(() => ({ docs: [] }))
  ]);
  let recomputedTax = 0;
  const rows = shSnap.docs.map(d => d.data()).map(r => {
    const gross = (r.base ?? r.salary ?? 0) + (r.allowance || 0);
    const erSss = r.er?.sss || 0, erPh = r.er?.philhealth || 0, erPi = r.er?.pagibig || 0;
    recomputedTax += (r.tax || 0);
    return { name: r.userName || '—', gross, sssEE: r.sss || 0, sssER: erSss, phEE: (r.philhealth ?? r.philHealth ?? 0), phER: erPh,
      hdmfEE: (r.pagibig ?? r.pagIbig ?? 0), hdmfER: erPi, tax: r.tax || 0, weekly: false };
  });
  wpSnap.docs.map(d => d.data()).forEach(p => {
    const dg = p.deductions?.govt || {};
    const taxW = p.deductions?.other?.taxes || 0;
    recomputedTax += taxW;
    rows.push({ name: p.workerName || '—', gross: p.grossPay || 0, sssEE: dg.sss || 0, sssER: null,
      phEE: dg.philhealth || 0, phER: null, hdmfEE: dg.pagibig || 0, hdmfER: null, tax: taxW, weekly: true });
  });
  const whtLeg = whtLegSnap.docs[0]?.data()?.amount || 0;
  const sssLegAmt = sssLegSnap.docs[0]?.data()?.amount || 0;
  const phLegAmt = phLegSnap.docs[0]?.data()?.amount || 0;
  const hdmfLegAmt = hdmfLegSnap.docs[0]?.data()?.amount || 0;
  const diff = recomputedTax - whtLeg;
  // v14 fix: the WHTPAY-{month} remittance leg is normally posted separately,
  // AFTER payroll and ahead of the BIR deadline — not at disburse time. So
  // whtLeg===0 while recomputedTax>0 is the routine, expected "not yet
  // remitted" state, not a data-integrity problem. Previously this exact
  // state fired the same alarming "known financeDeleteCascade gap" wording
  // every single month before the remittance was recorded, training users to
  // ignore the banner — which also hid the case where a REAL post-remittance
  // mismatch occurs. Split into a neutral info note (not-yet-posted) vs. the
  // real alarm (posted but doesn't match).
  let reconcileWarning = '';
  if (whtLeg === 0 && recomputedTax > 0) {
    reconcileWarning = `<div class="bir-banner" style="border-color:var(--text-muted)">ℹ Withholding Tax Payable (WHTPAY-${escHtml(month)}) hasn't been posted yet — per-employee total (₱${fmt(recomputedTax)}) is what's owed once the remittance is recorded.</div>`;
  } else if (Math.abs(diff) > 0.01) {
    reconcileWarning = `<div class="bir-banner">⚠ Ledger aggregate (₱${fmt(whtLeg)}) ≠ per-employee total (₱${fmt(recomputedTax)}) — a deleted employee payroll leaves the aggregate legs overstated (known financeDeleteCascade gap); the per-employee total is authoritative for filing.</div>`;
  }
  const watermark = !!(window.STATUTORY && window.STATUTORY[year] && window.STATUTORY[year].verified === false);
  const banner = window.birUnverifiedBanner(year);
  const bodyRows = rows.map(r => `<tr>
    <td>${escHtml(r.name)}${r.weekly ? ' <span class="badge badge-gray" style="font-size:9px">weekly</span>' : ''}</td>
    <td class="num">₱${fmt(r.gross)}</td>
    <td class="num">${fmt(r.sssEE)} / ${r.sssER == null ? '—<sup>†</sup>' : fmt(r.sssER)}</td>
    <td class="num">${fmt(r.phEE)} / ${r.phER == null ? '—<sup>†</sup>' : fmt(r.phER)}</td>
    <td class="num">${fmt(r.hdmfEE)} / ${r.hdmfER == null ? '—<sup>†</sup>' : fmt(r.hdmfER)}</td>
    <td class="num">₱${fmt(r.tax)}</td>
  </tr>`).join('');
  const table = `<table class="bir-t"><thead><tr><th>Employee</th><th>Gross</th><th>SSS EE/ER</th><th>PhilHealth EE/ER</th><th>Pag-IBIG EE/ER</th><th>Tax Withheld</th></tr></thead>
    <tbody>${bodyRows || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No payroll for this month</td></tr>'}</tbody>
    <tfoot><tr class="bir-total-row"><td colspan="5">TOTAL Tax Withheld (per-employee)</td><td class="num">₱${fmt(recomputedTax)}</td></tr></tfoot></table>
    <div style="font-size:9pt;color:#666;margin-top:4px">† weekly/production workers' employer share is manual-only (not tracked in-app, WS24 decision 3).</div>
    <div class="bir-sec-h">Agency remittance cross-check (vs. posted ledger legs)</div>
    <table class="bir-t"><tbody>
      <tr><td>Withholding Tax Payable (WHTPAY-${escHtml(month)})</td><td class="num">₱${fmt(whtLeg)}</td></tr>
      <tr><td>SSS Payable (SSSPAY-${escHtml(month)})</td><td class="num">₱${fmt(sssLegAmt)}</td></tr>
      <tr><td>PhilHealth Payable (PHPAY-${escHtml(month)})</td><td class="num">₱${fmt(phLegAmt)}</td></tr>
      <tr><td>Pag-IBIG Payable (HDMFPAY-${escHtml(month)})</td><td class="num">₱${fmt(hdmfLegAmt)}</td></tr>
    </tbody></table>`;
  const printHTML = window.birBuildPrintHTML({
    docTitle: '1601-C — MONTHLY WITHHOLDING TAX WORKSHEET', dateLabel: pParsed.label, bodyHTML: banner + reconcileWarning + table, watermark
  });
  const csvRows = rows.map(r => ({ employee: r.name, weekly: r.weekly, gross: r.gross, sssEE: r.sssEE, sssER: r.sssER, phEE: r.phEE, phER: r.phER, hdmfEE: r.hdmfEE, hdmfER: r.hdmfER, tax: r.tax }));
  bodyEl.innerHTML = window.birToolbarHTML({ csvId: 'bir-wht-csv' }) + printHTML;
  if (window.lucide) lucide.createIcons({ nodes: [bodyEl] });
  document.getElementById('bir-wht-csv')?.addEventListener('click', () => window.exportCSV('1601c-' + month, csvRows, [
    { key: 'employee', label: 'Employee' }, { key: 'weekly', label: 'Weekly?' }, { key: 'gross', label: 'Gross' },
    { key: 'sssEE', label: 'SSS EE' }, { key: 'sssER', label: 'SSS ER' }, { key: 'phEE', label: 'PhilHealth EE' }, { key: 'phER', label: 'PhilHealth ER' },
    { key: 'hdmfEE', label: 'Pag-IBIG EE' }, { key: 'hdmfER', label: 'Pag-IBIG ER' }, { key: 'tax', label: 'Tax Withheld' }
  ]));
};

// ═══════════════════════════════════════════════════════════
//  Spec 6c — Alphalist (year) + 2316 (per employee)
// ═══════════════════════════════════════════════════════════
window.renderBirAlpha = async function (container, currentUser, currentRole) {
  const defaultYear = window.bizYear ? window.bizYear() : new Date().getFullYear();
  const state = window._birAlphaState || (window._birAlphaState = { period: 'year:' + defaultYear });
  container.innerHTML = `
    <div id="bir-alpha-period">${window.periodPicker(state.period, {})}</div>
    <div id="bir-alpha-body" style="margin-top:10px"><div class="loading-placeholder">Building…</div></div>
  `;
  window.bindPeriodPicker(document.getElementById('bir-alpha-period'), (key) => {
    state.period = key; window.renderBirAlpha(container, currentUser, currentRole);
  }, { activeKey: state.period });
  await window.birRenderAlphaBody(document.getElementById('bir-alpha-body'), state, currentUser);
};

window.birRenderAlphaBody = async function (bodyEl, state, currentUser) {
  if (!bodyEl) return;
  const pParsed = window.Period.parse(state.period);
  if (pParsed.type !== 'year') {
    bodyEl.innerHTML = `<div class="empty-state"><div class="empty-icon">${window.emojiIcon('📅',44)}</div><h4>Pick a year</h4><p style="color:var(--text-muted)">Alphalist / 2316 are annual documents — use the Custom picker above and pick a year (leave month/quarter blank).</p></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [bodyEl] });
    return;
  }
  bodyEl.innerHTML = '<div class="loading-placeholder">Building…</div>';
  const year = pParsed.key.slice(5); // 'year:YYYY' -> 'YYYY'
  const [shSnap, wpSnap, payrollSnap, usersSnap] = await Promise.all([
    db.collection('salary_history').where('month', '>=', year + '-01').where('month', '<=', year + '-12').get().catch(() => ({ docs: [] })),
    db.collection('payslips').where('payPeriodStart', '>=', year + '-01-01').where('payPeriodStart', '<=', year + '-12-31').get().catch(() => ({ docs: [] })),
    db.collection('payroll').get().catch(() => ({ docs: [] })),
    // v14 Wave 4 Batch F4 — hire dates for the 13th-month accrual guard below
    // (shared window.thirteenthMonthFor helper); one batch read, not N.
    (window.dbCachedGet ? window.dbCachedGet('users', () => db.collection('users').get(), 30000) : db.collection('users').get()).catch(() => ({ docs: [] }))
  ]);
  const payrollById = {}; payrollSnap.docs.forEach(d => { payrollById[d.id] = d.data(); });
  const usersByUid = {}; usersSnap.docs.forEach(d => { usersByUid[d.id] = d.data(); });
  // Group monthly salary_history rows by userId (keep the raw rows too — the
  // shared 13th-month helper needs them, not just the running sums).
  const byUid = {};
  const rowsByUid = {};
  shSnap.docs.map(d => d.data()).forEach(r => {
    const uid = r.userId; if (!uid) return;
    if (!byUid[uid]) byUid[uid] = { uid, name: r.userName || '—', weekly: false, gross: 0, sss: 0, philhealth: 0, pagibig: 0, tax: 0 };
    const a = byUid[uid];
    a.gross += (r.base ?? r.salary ?? 0) + (r.allowance || 0);
    a.sss += r.sss || 0; a.philhealth += (r.philhealth ?? r.philHealth ?? 0); a.pagibig += (r.pagibig ?? r.pagIbig ?? 0);
    a.tax += r.tax || 0;
    (rowsByUid[uid] || (rowsByUid[uid] = [])).push(r);
  });
  // Group weekly payslips by workerId (IDs come from the payslip doc itself —
  // worker_profiles free-text, per §3 grounding).
  const byWorker = {};
  wpSnap.docs.map(d => d.data()).forEach(p => {
    const wid = p.workerId; if (!wid) return;
    if (!byWorker[wid]) byWorker[wid] = { uid: wid, name: p.workerName || '—', weekly: true, gross: 0, sss: 0, philhealth: 0, pagibig: 0, tax: 0,
      tin: '', ssNum: '', phNum: '', pagibigNum: '' };
    const a = byWorker[wid]; const dg = p.deductions?.govt || {};
    a.gross += p.grossPay || 0; a.sss += dg.sss || 0; a.philhealth += dg.philhealth || 0; a.pagibig += dg.pagibig || 0;
    a.tax += (p.deductions?.other?.taxes || 0);
    if (p.tinNum) a.tin = p.tinNum; if (p.ssNum) a.ssNum = p.ssNum; if (p.phNum) a.phNum = p.phNum; if (p.pagibigNum) a.pagibigNum = p.pagibigNum;
  });
  // v14 Wave 4 Batch F4 — shared window.thirteenthMonthFor (defined in
  // departments.js, near the payslip model builder): same hire-month-guarded
  // formula as the payslip's YTD card, fed the pre-fetched users map so this
  // doesn't cost one read per employee.
  const monthlyRows = await Promise.all(Object.values(byUid).map(async a => {
    const pay = payrollById[a.uid] || {};
    const th = await window.thirteenthMonthFor(a.uid, year, rowsByUid[a.uid] || [], usersByUid);
    return { ...a, tin: pay.tinNum || '', ssNum: pay.ssNum || '', phNum: pay.phNum || '', pagibigNum: pay.pagibigNum || '',
      thirteenthAccrual: th.thirteenthAccrual, monthsWorked: th.monthsWorked, taxableComp: Math.max(0, a.gross - a.sss - a.philhealth - a.pagibig) };
  }));
  const rows = [
    ...monthlyRows,
    ...Object.values(byWorker).map(a => ({ ...a, thirteenthAccrual: 0, taxableComp: Math.max(0, a.gross - a.sss - a.philhealth - a.pagibig) }))
  ].sort((a, b) => a.name.localeCompare(b.name));
  const missingCount = rows.filter(r => !r.tin).length;
  const missingBanner = missingCount
    ? `<div class="bir-banner">⚠ ${missingCount} employee${missingCount === 1 ? '' : 's'} missing TIN — not filing-ready. Fill via Finance → Payroll → Edit Payroll (regular employees) or the HR worker profile (weekly workers).</div>`
    : '';
  // v14 Wave 4 Batch F4 — the 13th-month column is a computed estimate (basic
  // salary actually earned this year / 12, guarded to months on/after hire);
  // it is NOT a substitute for the accountant-prepared figure used in filing.
  const thirteenthBanner = `<div class="bir-banner">⚠ 13th-Month Accrual is an ESTIMATE computed from recorded salary_history — verify with your accountant before filing.</div>`;
  const watermark = !!(window.STATUTORY && window.STATUTORY[year] && window.STATUTORY[year].verified === false);
  const wmBanner = window.birUnverifiedBanner(year);
  const bodyRows = rows.map(r => `<tr>
    <td>${escHtml(r.name)}${r.weekly ? ' <span class="badge badge-gray" style="font-size:9px">weekly</span>' : ''}</td>
    <td>${r.tin ? escHtml(r.tin) : '<span style="color:var(--danger)">⚠ TIN missing</span>'}</td>
    <td class="num">₱${fmt(r.gross)}</td>
    <td class="num">₱${fmt(r.sss + r.philhealth + r.pagibig)}</td>
    <td class="num">₱${fmt(r.thirteenthAccrual)}</td>
    <td class="num">₱${fmt(r.taxableComp)}</td>
    <td class="num">₱${fmt(r.tax)}</td>
    <td class="no-print"><button class="btn-secondary btn-sm bir-2316-btn" data-uid="${escHtml(r.uid)}">${window.emojiIcon('📄',14)} 2316</button></td>
  </tr>`).join('');
  const table = `<table class="bir-t"><thead><tr><th>Employee</th><th>TIN</th><th>Gross Comp.</th><th>SSS+PH+HDMF</th><th>13th-Month Accrual</th><th>Taxable Comp.</th><th>Tax Withheld</th><th class="no-print"></th></tr></thead>
    <tbody>${bodyRows || '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">No payroll for this year</td></tr>'}</tbody></table>`;
  const printHTML = window.birBuildPrintHTML({ docTitle: 'ALPHALIST — ANNUAL COMPENSATION SUMMARY', dateLabel: 'Year ' + year, bodyHTML: wmBanner + missingBanner + thirteenthBanner + table, watermark });
  bodyEl.innerHTML = window.birToolbarHTML({ csvId: 'bir-alpha-csv' }) + printHTML;
  if (window.lucide) lucide.createIcons({ nodes: [bodyEl] });
  document.getElementById('bir-alpha-csv')?.addEventListener('click', () => window.exportCSV('alphalist-' + year, rows, [
    { key: 'name', label: 'Employee' }, { key: 'tin', label: 'TIN' }, { key: 'gross', label: 'Gross Compensation' },
    { key: 'statutory', label: 'SSS+PH+HDMF', get: r => r.sss + r.philhealth + r.pagibig }, { key: 'thirteenthAccrual', label: '13th-Month Accrual' },
    { key: 'taxableComp', label: 'Taxable Compensation' }, { key: 'tax', label: 'Tax Withheld' }
  ]));
  bodyEl.querySelectorAll('.bir-2316-btn').forEach(btn => btn.addEventListener('click', () => {
    const row = rows.find(r => r.uid === btn.dataset.uid);
    if (row) window.birRender2316(bodyEl, row, year, state);
  }));
};

window.birRender2316 = function (bodyEl, row, year, state) {
  const watermark = !!(window.STATUTORY && window.STATUTORY[year] && window.STATUTORY[year].verified === false);
  const wmBanner = window.birUnverifiedBanner(year);
  const sig = (window.BRAND && window.BRAND.legal && window.BRAND.legal.signatory) || { name: '', title: '' };
  const table = `<table class="bir-t"><tbody>
    <tr><td>Employee</td><td>${escHtml(row.name)}</td></tr>
    <tr><td>TIN</td><td>${row.tin ? escHtml(row.tin) : '<span style="color:var(--danger)">⚠ MISSING</span>'}</td></tr>
    <tr><td>Address</td><td>&nbsp;</td></tr>
    <tr><td>Gross Compensation</td><td class="num">₱${fmt(row.gross)}</td></tr>
    <tr><td>Non-Taxable (SSS/PhilHealth/Pag-IBIG)</td><td class="num">₱${fmt(row.sss + row.philhealth + row.pagibig)}</td></tr>
    <tr><td>13th-Month Pay (accrual)</td><td class="num">₱${fmt(row.thirteenthAccrual)}</td></tr>
    <tr><td>Taxable Compensation</td><td class="num">₱${fmt(row.taxableComp)}</td></tr>
    <tr class="bir-total-row"><td>Total Tax Withheld (YTD)</td><td class="num">₱${fmt(row.tax)}</td></tr>
  </tbody></table>`;
  const printHTML = window.birBuildPrintHTML({
    docTitle: 'BIR FORM 2316', dateLabel: 'Year ' + year, watermark, bodyHTML: wmBanner + table,
    signatures: [{ label: 'Employee', name: row.name, title: '' }, { label: 'Employer', name: sig.name, title: sig.title }]
  });
  bodyEl.innerHTML = `<div class="no-print" style="display:flex;gap:8px;margin-bottom:10px">
    <button class="btn-secondary btn-sm" id="bir-2316-back">← Back to Alphalist</button>
    <button class="btn-primary btn-sm" onclick="window.print()">${window.emojiIcon('🖨',14)} Print</button>
  </div>` + printHTML;
  if (window.lucide) lucide.createIcons({ nodes: [bodyEl] });
  document.getElementById('bir-2316-back')?.addEventListener('click', () => window.birRenderAlphaBody(bodyEl, state));
};

// ═══════════════════════════════════════════════════════════
//  Spec 7 — Financial Statement (working paper): Income Statement + VAT
//  Summary + PROVISIONAL Balance Sheet
// ═══════════════════════════════════════════════════════════
window.renderBirFS = async function (container, currentUser, currentRole) {
  const defaultYear = window.bizYear ? window.bizYear() : new Date().getFullYear();
  const state = window._birFsState || (window._birFsState = { period: 'year:' + defaultYear });
  container.innerHTML = `
    <div id="bir-fs-period">${window.periodPicker(state.period, {})}</div>
    <div id="bir-fs-body" style="margin-top:10px"><div class="loading-placeholder">Building…</div></div>
  `;
  window.bindPeriodPicker(document.getElementById('bir-fs-period'), (key) => {
    state.period = key; window.renderBirFS(container, currentUser, currentRole);
  }, { activeKey: state.period });
  await window.birRenderFSBody(document.getElementById('bir-fs-body'), state);
};

window.birRenderFSBody = async function (bodyEl, state) {
  if (!bodyEl) return;
  bodyEl.innerHTML = '<div class="loading-placeholder">Building…</div>';
  const pParsed = window.Period.parse(state.period);
  const [periodSnap, cumSnap] = await Promise.all([
    window.ledgerForPeriod(pParsed.key),
    // All-time-THROUGH-period-end read, for Retained Earnings (cumulative net
    // income) — one extra bounded (upper-bound-only) query, cached.
    pParsed.end
      ? window.dbCachedGet('ledger<=' + pParsed.end, () => db.collection('ledger').where('date', '<=', pParsed.end).get().catch(() => ({ docs: [] })), 60000)
      : window.ledgerForPeriod('all')
  ]);
  const rows = periodSnap.docs.map(d => d.data());
  const cumRows = cumSnap.docs.map(d => d.data());

  // 1. Income Statement (period)
  const income = rows.filter(e => ledgerKind(e) === 'income');
  const expense = rows.filter(e => ledgerKind(e) === 'expense');
  const byCat = arr => { const m = {}; arr.forEach(e => { const k = e.category || e.account || 'Other'; m[k] = (m[k] || 0) + (e.amount || 0); }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const totIncome = income.reduce((s, e) => s + (e.amount || 0), 0), totExpense = expense.reduce((s, e) => s + (e.amount || 0), 0);
  const netIncome = totIncome - totExpense;
  const incCats = byCat(income), expCats = byCat(expense);

  // 2. VAT Summary (period) — the ONE shared computation.
  const vs = window.computeVatSummary(rows);

  // 3. Balance Sheet — PROVISIONAL. Per-account net (debit-positive) from
  // cumulative-to-period-end rows; Retained Earnings is DERIVED (cumulative
  // net income), not read from a posted account.
  const perAccount = {};
  cumRows.forEach(r => {
    const kind = ledgerKind(r);
    if (kind === 'income' || kind === 'expense') return;
    const acct = r.account || r.category || 'Uncategorized';
    const key = kind + '|' + acct;
    if (!perAccount[key]) perAccount[key] = { kind, acct, net: 0 };
    perAccount[key].net += (r.type === 'debit' ? (r.amount || 0) : -(r.amount || 0));
  });
  const cumIncome = cumRows.filter(r => ledgerKind(r) === 'income').reduce((s, e) => s + (e.amount || 0), 0);
  const cumExpense = cumRows.filter(r => ledgerKind(r) === 'expense').reduce((s, e) => s + (e.amount || 0), 0);
  const retainedEarnings = cumIncome - cumExpense;
  const assetRows = Object.values(perAccount).filter(a => a.kind === 'asset');
  const liabRows = Object.values(perAccount).filter(a => a.kind === 'liability');
  const eqRows = Object.values(perAccount).filter(a => a.kind === 'equity');
  const totalAssets = assetRows.reduce((s, a) => s + a.net, 0);
  const totalLiab = liabRows.reduce((s, a) => s - a.net, 0);      // liabilities are credit-normal
  const totalEquityPosted = eqRows.reduce((s, a) => s - a.net, 0); // equity is credit-normal
  const totalEquity = totalEquityPosted + retainedEarnings;
  const plug = totalAssets - (totalLiab + totalEquity);

  const catRowsHTML = arr => arr.map(([k, v]) => `<tr><td style="padding-left:24px">${escHtml(k)}</td><td class="num">₱${fmt(v)}</td></tr>`).join('');
  const acctRowsHTML = (arr, sign) => arr.map(a => `<tr><td style="padding-left:24px">${escHtml(a.acct)}</td><td class="num">₱${fmt(sign * a.net)}</td></tr>`).join('');

  const body = `
    <div class="bir-sec-h">1. Income Statement — ${escHtml(pParsed.label)}</div>
    <table class="bir-t"><tbody>
      <tr class="bir-total-row"><td>INCOME</td><td></td></tr>
      ${catRowsHTML(incCats) || '<tr><td style="padding-left:24px;color:var(--text-muted)">No income recorded</td><td class="num">₱0.00</td></tr>'}
      <tr class="bir-total-row"><td>Total Income</td><td class="num">₱${fmt(totIncome)}</td></tr>
      <tr class="bir-total-row"><td>EXPENSES</td><td></td></tr>
      ${catRowsHTML(expCats) || '<tr><td style="padding-left:24px;color:var(--text-muted)">No expenses recorded</td><td class="num">₱0.00</td></tr>'}
      <tr class="bir-total-row"><td>Total Expenses</td><td class="num">₱${fmt(totExpense)}</td></tr>
      <tr class="bir-total-row"><td>NET INCOME</td><td class="num">₱${fmt(netIncome)}</td></tr>
    </tbody></table>

    <div class="bir-sec-h">2. VAT Summary — ${escHtml(pParsed.label)}</div>
    <table class="bir-t"><tbody>
      <tr><td>VATable Sales (net)</td><td class="num">₱${fmt(vs.vatableSales)}</td></tr>
      <tr><td>Exempt Sales</td><td class="num">₱${fmt(vs.exemptSales)}</td></tr>
      <tr><td>Output VAT</td><td class="num">₱${fmt(vs.outputVat)}</td></tr>
      <tr><td>Input VAT</td><td class="num">₱${fmt(vs.inputVat)}</td></tr>
      <tr class="bir-total-row"><td>Net VAT ${vs.netVat >= 0 ? 'Payable' : 'Creditable'}</td><td class="num">₱${fmt(Math.abs(vs.netVat))}</td></tr>
    </tbody></table>

    <div class="bir-sec-h">3. Balance Sheet — PROVISIONAL (as of ${escHtml(pParsed.end || 'today')})</div>
    <div style="font-size:9pt;color:#666;margin:4px 0 8px">Provisional statement derived from single-entry ledger records — for management + accountant working-paper use; not an audited Financial Statement.</div>
    <table class="bir-t"><tbody>
      <tr class="bir-total-row"><td>ASSETS</td><td></td></tr>
      ${acctRowsHTML(assetRows, 1) || '<tr><td style="padding-left:24px;color:var(--text-muted)">—</td><td class="num">₱0.00</td></tr>'}
      <tr class="bir-total-row"><td>Total Assets</td><td class="num">₱${fmt(totalAssets)}</td></tr>
      <tr class="bir-total-row"><td>LIABILITIES</td><td></td></tr>
      ${acctRowsHTML(liabRows, -1) || '<tr><td style="padding-left:24px;color:var(--text-muted)">—</td><td class="num">₱0.00</td></tr>'}
      <tr class="bir-total-row"><td>Total Liabilities</td><td class="num">₱${fmt(totalLiab)}</td></tr>
      <tr class="bir-total-row"><td>EQUITY</td><td></td></tr>
      ${acctRowsHTML(eqRows, -1)}
      <tr><td style="padding-left:24px">Retained Earnings (cumulative net income)</td><td class="num">₱${fmt(retainedEarnings)}</td></tr>
      <tr class="bir-total-row"><td>Total Equity</td><td class="num">₱${fmt(totalEquity)}</td></tr>
      <tr class="bir-total-row"><td>Unreconciled difference (single-entry records)</td><td class="num">₱${fmt(plug)}</td></tr>
    </tbody></table>`;
  const printHTML = window.birBuildPrintHTML({ docTitle: 'FINANCIAL STATEMENT (WORKING PAPER)', dateLabel: pParsed.label, bodyHTML: body });
  bodyEl.innerHTML = window.birToolbarHTML({}) + printHTML;
  if (window.lucide) lucide.createIcons({ nodes: [bodyEl] });
};

// ═══════════════════════════════════════════════════════════
//  v14 Wave 4 Batch F5 — Balance Sheet · Cash Flow · Bank Reconciliation
//  Finance → Reports sub-chips (wired in departments.js's FINANCE_GROUPS +
//  loadFinanceContent switch). Working-paper style like the FS above —
//  figures for the accountant, not a filed statement.
// ═══════════════════════════════════════════════════════════

// ── Shared cash-as-of computation — the ONE codepath the Balance Sheet's Cash
//    section AND the Cash Flow report's start/end totals both call, so the
//    two screens can never silently disagree (same rows, same math — only the
//    asOf date differs). "Unassigned" = income/expense rows never tagged to a
//    bank account (legacy rows, or an entry made without picking one — bankFlow
//    is only ever set alongside bankAccountId, via BankAccounts.tag). That cash
//    is real; it's surfaced as its own line rather than silently dropped.
window.finCashAsOf = async function (asOfDate) {
  const [accounts, snap] = await Promise.all([
    window.BankAccounts.list({ activeOnly: false }),
    window.ledgerForPeriod('all')
  ]);
  const rows = snap.docs.map(d => d.data());
  const per = window.BankAccounts.computeBalances(accounts, rows, { asOf: asOfDate });
  const taggedTotal = Object.values(per).reduce((s, x) => s + x.balance, 0);
  const unassigned = rows
    .filter(r => !r.bankAccountId && r.date && r.date <= asOfDate)
    .reduce((s, r) => {
      const k = window.ledgerKind(r);
      if (k === 'income') return s + (r.amount || 0);
      if (k === 'expense') return s - (r.amount || 0);
      return s;
    }, 0);
  return { accounts, per, taggedTotal, unassigned, total: taggedTotal + unassigned };
};

// ── AR — the SAME derived figure (contract − collected, or the stored
//    arBalance for job_projects when present) used by the AR Aging KPI
//    (window.arAging) and every project-lifecycle card. A "billing invoice"
//    is a printed snapshot of a project's contract (see openBillingInvoice in
//    departments.js) — it carries no independent paid/unpaid flag of its own.
//    The project's own collected-vs-contract balance is the one place paid
//    status is actually maintained, so that's the source of truth here.
window.finArReceivable = async function () {
  const projects = await window.Projects.listAll().catch(() => []);
  return projects.reduce((s, p) => s + (+p.arBalance || 0), 0);
};

// ── Cash-advance receivable — READ ONLY (per spec). Same status/balance
//    filter renderFinanceCA already uses for its "Outstanding" KPI (status
//    'approved' + balance>0) — reused, not re-derived, so this can never
//    disagree with the Cash Advances tab's own number.
window.finCaReceivable = async function () {
  const snap = await db.collection('cash_advances').get().catch(() => ({ docs: [] }));
  return snap.docs.map(d => d.data())
    .filter(a => a.status === 'approved' && (a.balance || 0) > 0)
    .reduce((s, a) => s + (a.balance || 0), 0);
};

// ── Inventory valuation — same qty×unitCost formula as the Inventory tab's
//    own "Stock Value" KPI (js/modules.js renderStock). Deliberately NOT the
//    ledger's own 'Inventory' account: per the finance-reporting-open-items
//    audit, production consumption isn't fully wired to finance yet, so the
//    ledger's mirror can drift from physical stock — inventory_items is the
//    more reliable figure.
window.finInventoryValue = async function () {
  const snap = await db.collection('inventory_items').get().catch(() => ({ docs: [] }));
  return snap.docs.map(d => d.data()).reduce((s, i) => s + ((i.qty || 0) * (i.unitCost || 0)), 0);
};

// ═══════════════════════════════════════════════════════════
//  BALANCE SHEET — as-of-date working paper
// ═══════════════════════════════════════════════════════════
window.renderBalanceSheet = async function (container, currentUser, currentRole) {
  const state = window._finBsState || (window._finBsState = { asOf: window.bizDate ? window.bizDate() : today() });
  container.innerHTML = `
    <div class="no-print" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px">
      <div class="form-group" style="margin:0"><label style="font-size:11px">As of date</label>
        <input id="bs-asof" type="date" value="${state.asOf}" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)"/></div>
      <button class="btn-secondary btn-sm" id="bs-today-btn">Today</button>
    </div>
    <div id="bs-body"><div class="loading-placeholder">Building…</div></div>
  `;
  const redo = () => window.birRenderBSBody(document.getElementById('bs-body'), state.asOf);
  document.getElementById('bs-asof').addEventListener('change', (e) => {
    state.asOf = e.target.value || (window.bizDate ? window.bizDate() : today()); redo();
  });
  document.getElementById('bs-today-btn').addEventListener('click', () => {
    state.asOf = window.bizDate ? window.bizDate() : today();
    document.getElementById('bs-asof').value = state.asOf;
    redo();
  });
  await redo();
};

window.birRenderBSBody = async function (bodyEl, asOf) {
  if (!bodyEl) return;
  bodyEl.innerHTML = '<div class="loading-placeholder">Building…</div>';
  const year = asOf.slice(0, 4);
  const watermark = !!(window.STATUTORY && window.STATUTORY[year] && window.STATUTORY[year].verified === false);
  const wmBanner = window.birUnverifiedBanner(year);

  const [cash, arTotal, caTotal, invTotal, cumSnap] = await Promise.all([
    window.finCashAsOf(asOf),
    window.finArReceivable(),
    window.finCaReceivable(),
    window.finInventoryValue(),
    window.dbCachedGet('ledger<=' + asOf, () => db.collection('ledger').where('date', '<=', asOf).get().catch(() => ({ docs: [] })), 60000)
  ]);

  // Liabilities — cumulative-to-date perAccount derivation (same shape as the
  // FS's own provisional Balance Sheet above), restricted to accountType
  // 'liability'. 'Accounts Payable' is EXCLUDED and reported as an omission:
  // every AP posting in this ledger is a settlement (debit, reducing AP) —
  // see postCDJToLedger/cdjLedgerExpense in departments.js — there is no leg
  // anywhere that CREDITS (incurs) AP when a purchase is made on credit, so
  // the account's running balance is structurally meaningless in isolation
  // (drifts negative forever). purchase_requisitions has no paid/unpaid or
  // amount-owed field either — there is no reliable AP source today.
  const liabNet = {};
  cumSnap.docs.forEach(d => {
    const r = d.data();
    if (window.ledgerKind(r) !== 'liability') return;
    const acct = r.account || r.category || 'Uncategorized';
    if (acct === 'Accounts Payable') return;
    liabNet[acct] = (liabNet[acct] || 0) + (r.type === 'debit' ? (r.amount || 0) : -(r.amount || 0));
  });
  const liabRows = Object.entries(liabNet)
    .map(([acct, net]) => ({ acct, value: -net }))            // liabilities are credit-normal
    .filter(r => Math.abs(r.value) > 0.005);
  const totalLiabilities = liabRows.reduce((s, a) => s + a.value, 0);

  const totalAssets = cash.total + arTotal + caTotal + invTotal;
  const totalEquity = totalAssets - totalLiabilities;          // spec: plug, labeled computed

  const acctRows = cash.accounts.map(a => {
    const bal = cash.per[a.id] ? cash.per[a.id].balance : 0;
    return `<tr><td style="padding-left:24px">${escHtml(window.BankAccounts.label(a))}${a.active === false ? ' <span class="badge badge-gray" style="font-size:9px">closed</span>' : ''}</td><td class="num">₱${fmt(bal)}</td></tr>`;
  }).join('');

  const body = `
    <div class="bir-sec-h">ASSETS</div>
    <table class="bir-t"><tbody>
      <tr class="bir-total-row"><td>Cash</td><td></td></tr>
      ${acctRows || '<tr><td style="padding-left:24px;color:var(--text-muted)">No bank accounts registered</td><td class="num">₱0.00</td></tr>'}
      <tr><td style="padding-left:24px">Unassigned / untagged cash movements</td><td class="num">₱${fmt(cash.unassigned)}</td></tr>
      <tr class="bir-total-row"><td style="padding-left:12px">Total Cash</td><td class="num">₱${fmt(cash.total)}</td></tr>
      <tr><td>Accounts Receivable <span style="font-size:9px;color:var(--text-muted)">(job/design projects, current balance)</span></td><td class="num">₱${fmt(arTotal)}</td></tr>
      <tr><td>Cash Advances Receivable <span style="font-size:9px;color:var(--text-muted)">(active employee balances)</span></td><td class="num">₱${fmt(caTotal)}</td></tr>
      <tr><td>Inventory <span style="font-size:9px;color:var(--text-muted)">(stock valuation, qty × unit cost)</span></td><td class="num">₱${fmt(invTotal)}</td></tr>
      <tr class="bir-total-row"><td>TOTAL ASSETS</td><td class="num">₱${fmt(totalAssets)}</td></tr>
    </tbody></table>

    <div class="bir-sec-h">LIABILITIES</div>
    <table class="bir-t"><tbody>
      ${liabRows.length ? liabRows.map(a => `<tr><td style="padding-left:24px">${escHtml(a.acct)}</td><td class="num">₱${fmt(a.value)}</td></tr>`).join('')
        : '<tr><td style="padding-left:24px;color:var(--text-muted)">—</td><td class="num">₱0.00</td></tr>'}
      <tr class="bir-total-row"><td>TOTAL LIABILITIES</td><td class="num">₱${fmt(totalLiabilities)}</td></tr>
    </tbody></table>
    <div style="font-size:9pt;color:#666;margin:4px 0 8px">Accounts Payable omitted — not reliably tracked (only settlement/debit legs exist in the ledger; no leg incurs/credits it, and purchase_requisitions has no paid/unpaid or amount-owed field). Statutory payables above accrue at payroll disbursement; a remittance only reduces them here if manually posted as a matching debit via the General Ledger.</div>

    <div class="bir-sec-h">EQUITY</div>
    <table class="bir-t"><tbody>
      <tr class="bir-total-row"><td>Total Equity <span style="font-weight:400;font-size:9px">(computed — working paper: Total Assets − Total Liabilities)</span></td><td class="num">₱${fmt(totalEquity)}</td></tr>
    </tbody></table>
    <div style="font-size:9pt;color:#666;margin:4px 0 8px">Provisional statement — Accounts Receivable and Cash Advances Receivable are the CURRENT outstanding balance (not reconstructed for ${escHtml(asOf)} specifically; job/design projects and cash advances don't carry a per-date balance history). Inventory is today's stock valuation for the same reason. Cash and Liabilities are genuinely as-of ${escHtml(asOf)} from dated ledger rows.</div>`;

  const printHTML = window.birBuildPrintHTML({
    docTitle: 'BALANCE SHEET (WORKING PAPER)', dateLabel: 'As of ' + asOf, watermark, bodyHTML: wmBanner + body
  });
  bodyEl.innerHTML = window.birToolbarHTML({}) + printHTML;
  if (window.lucide) lucide.createIcons({ nodes: [bodyEl] });
};

// ═══════════════════════════════════════════════════════════
//  CASH FLOW — month-range working paper. Uses window.finCashAsOf for its
//  start/end totals — the EXACT same function the Balance Sheet's Cash
//  section calls — so "Cash at end of period" here and the Balance Sheet's
//  Total Cash for the same as-of date can never silently disagree.
// ═══════════════════════════════════════════════════════════
window.renderCashFlowReport = async function (container, currentUser, currentRole) {
  const curYm = window.bizDate ? window.bizDate().slice(0, 7) : today().slice(0, 7);
  const state = window._finCfState || (window._finCfState = { from: curYm, to: curYm });
  container.innerHTML = `
    <div class="no-print" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px">
      <div class="form-group" style="margin:0"><label style="font-size:11px">From</label>
        <input id="cf-from" type="month" value="${state.from}" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)"/></div>
      <div class="form-group" style="margin:0"><label style="font-size:11px">To</label>
        <input id="cf-to" type="month" value="${state.to}" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)"/></div>
    </div>
    <div id="cf-body"><div class="loading-placeholder">Building…</div></div>
  `;
  const redo = () => window.birRenderCFBody(document.getElementById('cf-body'), state);
  document.getElementById('cf-from').addEventListener('change', e => { state.from = e.target.value || state.from; redo(); });
  document.getElementById('cf-to').addEventListener('change', e => { state.to = e.target.value || state.to; redo(); });
  await redo();
};

window.birRenderCFBody = async function (bodyEl, state) {
  if (!bodyEl) return;
  bodyEl.innerHTML = '<div class="loading-placeholder">Building…</div>';
  let { from, to } = state;
  if (from > to) { const t = from; from = to; to = t; }
  const start = from + '-01', end = to + '-31';
  const rangeKey = 'ledger:range:' + start + '..' + end;   // 'ledger:' prefix ⇒ swept by dbCacheInvalidate('ledger')
  const [rangeSnap, cashStart, cashEnd] = await Promise.all([
    window.dbCachedGet(rangeKey, () => db.collection('ledger').where('date', '>=', start).where('date', '<=', end).get().catch(() => ({ docs: [] })), 45000),
    window.finCashAsOf(window.ymAddMonths(from, -1) + '-31'),
    window.finCashAsOf(end)
  ]);
  const rangeRows = rangeSnap.docs.map(d => d.data());
  const tagged = rangeRows.filter(r => r.bankFlow === 'in' || r.bankFlow === 'out');
  const byCat = {};
  tagged.forEach(r => {
    const cat = r.category || r.account || 'Other';
    if (!byCat[cat]) byCat[cat] = { in: 0, out: 0 };
    byCat[cat][r.bankFlow] += (r.amount || 0);
  });
  const catRows = Object.entries(byCat).sort((a, b) => (b[1].in + b[1].out) - (a[1].in + a[1].out));
  const totalIn = tagged.filter(r => r.bankFlow === 'in').reduce((s, r) => s + (r.amount || 0), 0);
  const totalOut = tagged.filter(r => r.bankFlow === 'out').reduce((s, r) => s + (r.amount || 0), 0);
  const untaggedNet = rangeRows.filter(r => !r.bankAccountId).reduce((s, r) => {
    const k = window.ledgerKind(r);
    if (k === 'income') return s + (r.amount || 0);
    if (k === 'expense') return s - (r.amount || 0);
    return s;
  }, 0);

  const rangeStartEnd = window.ymAddMonths(from, -1) + '-31';
  const label = (from === to) ? window.Period.parse('month:' + from).label
    : (window.Period.parse('month:' + from).label + ' — ' + window.Period.parse('month:' + to).label);

  const catRowsHtml = catRows.map(([cat, v]) => `<tr>
      <td style="padding-left:24px">${escHtml(cat)}</td>
      <td class="num" style="color:var(--success)">${v.in ? '₱' + fmt(v.in) : '—'}</td>
      <td class="num" style="color:var(--danger)">${v.out ? '₱' + fmt(v.out) : '—'}</td>
    </tr>`).join('');

  const perBankRows = cashEnd.accounts.map(a => {
    const bal = cashEnd.per[a.id] ? cashEnd.per[a.id].balance : 0;
    return `<tr><td style="padding-left:24px">${escHtml(window.BankAccounts.label(a))}</td><td class="num">₱${fmt(bal)}</td></tr>`;
  }).join('');

  const body = `
    <div class="bir-sec-h">1. Operating Cash In/Out by Category — ${escHtml(label)}</div>
    <table class="bir-t"><thead><tr><th>Category</th><th>Cash In</th><th>Cash Out</th></tr></thead><tbody>
      ${catRowsHtml || '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">No bank-tagged cash movement this range</td></tr>'}
      <tr class="bir-total-row"><td>Total</td><td class="num" style="color:var(--success)">₱${fmt(totalIn)}</td><td class="num" style="color:var(--danger)">₱${fmt(totalOut)}</td></tr>
    </tbody></table>

    <div class="bir-sec-h">2. Reconciliation to Cash Position</div>
    <table class="bir-t"><tbody>
      <tr><td>Cash at start of period (${escHtml(rangeStartEnd)})</td><td class="num">₱${fmt(cashStart.total)}</td></tr>
      <tr><td style="padding-left:24px">+ Cash In (operating, tagged)</td><td class="num">₱${fmt(totalIn)}</td></tr>
      <tr><td style="padding-left:24px">− Cash Out (operating, tagged)</td><td class="num">−₱${fmt(totalOut)}</td></tr>
      ${untaggedNet ? `<tr><td style="padding-left:24px">± Untagged movement (unassigned)</td><td class="num">₱${fmt(untaggedNet)}</td></tr>` : ''}
      <tr class="bir-total-row"><td>Cash at end of period (${escHtml(end)})</td><td class="num">₱${fmt(cashEnd.total)}</td></tr>
    </tbody></table>
    <div style="font-size:9pt;color:#666;margin:4px 0 8px">"Cash at end of period" is computed by the exact same function the Balance Sheet's Cash section calls (window.finCashAsOf) — set the Balance Sheet's as-of date to ${escHtml(end)} and its Total Cash figure will match this one exactly.</div>

    <div class="bir-sec-h">3. Per-Bank Ending Balance — as of ${escHtml(end)}</div>
    <table class="bir-t"><tbody>
      ${perBankRows || '<tr><td style="padding-left:24px;color:var(--text-muted)">No bank accounts registered</td><td class="num">₱0.00</td></tr>'}
      <tr><td style="padding-left:24px">Unassigned / untagged</td><td class="num">₱${fmt(cashEnd.unassigned)}</td></tr>
      <tr class="bir-total-row"><td>Total Cash</td><td class="num">₱${fmt(cashEnd.total)}</td></tr>
    </tbody></table>`;

  const printHTML = window.birBuildPrintHTML({ docTitle: 'CASH FLOW STATEMENT (WORKING PAPER)', dateLabel: label, bodyHTML: body });
  bodyEl.innerHTML = window.birToolbarHTML({ csvId: 'cf-csv' }) + printHTML;
  if (window.lucide) lucide.createIcons({ nodes: [bodyEl] });
  document.getElementById('cf-csv')?.addEventListener('click', () => window.exportCSV('cash-flow-' + from + '_' + to,
    catRows.map(([cat, v]) => ({ category: cat, in: v.in, out: v.out, net: v.in - v.out })),
    [{ key: 'category', label: 'Category' }, { key: 'in', label: 'Cash In' }, { key: 'out', label: 'Cash Out' }, { key: 'net', label: 'Net' }]
  ));
};

// ═══════════════════════════════════════════════════════════
//  BANK RECONCILIATION — per account + month. `cleared` is a NEW, separate
//  field from the existing `reconciled` flag used by the Bank Accounts
//  drilldown (js/departments.js renderBankAccountDrilldown) — that screen's
//  quick per-row toggle predates this batch and stays untouched; this is a
//  dedicated month-scoped reconciliation workflow with a statement-balance
//  input, per spec. Both fields can coexist on the same ledger row.
// ═══════════════════════════════════════════════════════════
window.renderBankRec = async function (container, currentUser, currentRole) {
  const accounts = await window.BankAccounts.list({ activeOnly: false }).catch(() => []);
  if (!accounts.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">${emojiIcon('🏦', 44)}</div><h4>No bank accounts registered</h4><p>Add one in Money In/Out → Bank Accounts before reconciling.</p></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [container] });
    return;
  }
  const state = window._finBrecState || (window._finBrecState = {
    acctId: (accounts.find(a => a.isDefault) || accounts[0]).id,
    month: window.bizDate ? window.bizDate().slice(0, 7) : today().slice(0, 7)
  });
  if (!accounts.find(a => a.id === state.acctId)) state.acctId = accounts[0].id;
  const acctOpts = accounts.map(a => `<option value="${escHtml(a.id)}" ${a.id === state.acctId ? 'selected' : ''}>${escHtml(window.BankAccounts.label(a))}</option>`).join('');
  container.innerHTML = `
    <div class="no-print" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px">
      <div class="form-group" style="margin:0"><label style="font-size:11px">Account</label>
        <select id="brec-acct" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)">${acctOpts}</select></div>
      <div class="form-group" style="margin:0"><label style="font-size:11px">Month</label>
        <input id="brec-month" type="month" value="${state.month}" style="padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)"/></div>
    </div>
    <div id="brec-body"><div class="loading-placeholder">Loading…</div></div>
  `;
  const redo = () => window.birRenderBankRecBody(document.getElementById('brec-body'), accounts, state, currentUser, currentRole);
  document.getElementById('brec-acct').addEventListener('change', e => { state.acctId = e.target.value; redo(); });
  document.getElementById('brec-month').addEventListener('change', e => { state.month = e.target.value || state.month; redo(); });
  await redo();
};

window.birRenderBankRecBody = async function (bodyEl, accounts, state, currentUser, currentRole) {
  if (!bodyEl) return;
  bodyEl.innerHTML = '<div class="loading-placeholder">Building…</div>';
  const acct = accounts.find(a => a.id === state.acctId);
  if (!acct) { bodyEl.innerHTML = '<div class="empty-state">Account not found.</div>'; return; }
  const monthStart = state.month + '-01', monthEnd = state.month + '-31';
  const ymKey = state.month.replace('-', '');
  const canClear = !!(window.isFinancePriv && window.isFinancePriv());
  const canStmt = ['president', 'manager', 'finance'].includes(currentRole);   // matches bank_accounts rules' isMoneyAdmin(), narrower than canFinance()

  const snap = await window.ledgerForPeriod('all');
  const allRows = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => r.bankAccountId === acct.id);
  const monthRows = allRows.filter(r => (r.date || '') >= monthStart && (r.date || '') <= monthEnd)
    .sort((x, y) => (x.date || '').localeCompare(y.date || ''));
  const clearedRows = allRows.filter(r => r.cleared === true);
  const per = window.BankAccounts.computeBalances([acct], clearedRows, { asOf: monthEnd });
  const clearedBalance = per[acct.id] ? per[acct.id].balance : +(acct.openingBalance || 0);

  const stmtBalances = acct.stmtBalances || {};
  const savedStmt = stmtBalances[ymKey];
  const difference = (savedStmt != null) ? (savedStmt - clearedBalance) : null;
  const inBalance = difference != null && Math.abs(difference) < 0.005;
  const uncleared = monthRows.filter(r => r.cleared !== true);

  const rowsHtml = monthRows.map(r => `<tr>
      <td style="font-size:11px">${r.date || '—'}</td>
      <td style="font-size:12px">${escHtml(r.description || '—')}</td>
      <td><code>${escHtml(r.refNumber || '—')}</code></td>
      <td style="color:${r.bankFlow === 'in' ? 'var(--success)' : 'var(--danger)'}">${r.bankFlow === 'in' ? '+' : '-'}₱${fmt(r.amount || 0)}</td>
      <td style="text-align:center"><input type="checkbox" class="brec-clear-chk" data-id="${escHtml(r.id)}" ${r.cleared ? 'checked' : ''} ${canClear ? '' : 'disabled'}/></td>
    </tr>`).join('');

  const unclearedHtml = uncleared.map(r => `<li>${r.date || '—'} — ${escHtml(r.description || '—')} — ${r.bankFlow === 'in' ? '+' : '-'}₱${fmt(r.amount || 0)}</li>`).join('');

  const body = `
    <div class="kpi-row">
      <div class="kpi-card"><div class="kpi-label">Cleared Balance (thru ${escHtml(monthEnd)})</div><div class="kpi-value" style="font-size:15px">₱${fmt(clearedBalance)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Statement Ending Balance</div>
        <div class="no-print" style="display:flex;gap:6px;align-items:center;margin-top:2px">
          <input id="brec-stmt" type="number" step="0.01" inputmode="decimal" placeholder="Enter amount" value="${savedStmt != null ? savedStmt : ''}"
            style="width:120px;padding:6px 8px;border:1.5px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text)" ${canStmt ? '' : 'disabled'}/>
          ${canStmt ? `<button class="btn-secondary btn-sm" id="brec-stmt-save">Save</button>` : ''}
        </div>
        <div style="font-size:14px;font-weight:700">${savedStmt != null ? '₱' + fmt(savedStmt) : '—'}</div>
      </div>
      <div class="kpi-card ${difference == null ? '' : (inBalance ? 'green' : 'red')}">
        <div class="kpi-label">Difference (Statement − Cleared)</div>
        <div class="kpi-value" style="font-size:15px">${difference == null ? '—' : '₱' + fmt(difference)}</div>
      </div>
    </div>
    ${difference == null ? `<div style="font-size:12px;color:var(--text-muted);margin:8px 0">Enter the bank statement's ending balance for ${escHtml(state.month)} above to compute the difference.</div>`
      : inBalance ? `<div style="font-size:12px;color:var(--success);margin:8px 0">${emojiIcon('✓', 14)} Reconciled — statement matches cleared transactions.</div>`
      : `<div style="font-size:12px;color:var(--danger);margin:8px 0">${emojiIcon('⚠', 14)} Out of balance by ₱${fmt(Math.abs(difference))}.</div>`}

    <div class="bir-sec-h">${escHtml(window.BankAccounts.label(acct))} — ${escHtml(state.month)}</div>
    <table class="bir-t"><thead><tr><th>Date</th><th>Description</th><th>Ref #</th><th>Amount</th><th>Cleared</th></tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No transactions this month</td></tr>'}</tbody></table>

    <div class="bir-sec-h">Uncleared Items (${uncleared.length})</div>
    ${uncleared.length ? `<ul style="font-size:12px;margin:4px 0 0 18px">${unclearedHtml}</ul>` : '<div style="font-size:12px;color:var(--text-muted)">None — every row this month is cleared.</div>'}
  `;

  const printHTML = window.birBuildPrintHTML({ docTitle: 'BANK RECONCILIATION', dateLabel: window.BankAccounts.label(acct) + ' — ' + state.month, bodyHTML: body });
  bodyEl.innerHTML = window.birToolbarHTML({}) + printHTML;
  if (window.lucide) lucide.createIcons({ nodes: [bodyEl] });

  bodyEl.querySelectorAll('.brec-clear-chk').forEach(chk => chk.addEventListener('change', async () => {
    const prev = !chk.checked;
    try {
      await db.collection('ledger').doc(chk.dataset.id).update({
        cleared: chk.checked,
        clearedBy: currentUser ? currentUser.uid : null,
        clearedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('ledger');
      Notifs.success(chk.checked ? 'Marked cleared' : 'Marked uncleared');
      window.birRenderBankRecBody(bodyEl, accounts, state, currentUser, currentRole);
    } catch (ex) { Notifs.showToast('Could not update: ' + (ex.message || ex), 'error'); chk.checked = prev; }
  }));
  document.getElementById('brec-stmt-save')?.addEventListener('click', async () => {
    const val = parseFloat(document.getElementById('brec-stmt').value);
    if (!Number.isFinite(val)) { Notifs.showToast('Enter a valid amount', 'error'); return; }
    try {
      await db.collection('bank_accounts').doc(acct.id).update({ ['stmtBalances.' + ymKey]: val });
      window.BankAccounts.invalidate();
      Notifs.success('Statement balance saved');
      const fresh = await window.BankAccounts.list({ activeOnly: false });
      window.birRenderBankRecBody(bodyEl, fresh, state, currentUser, currentRole);
    } catch (ex) { Notifs.showToast('Could not save: ' + (ex.message || ex), 'error'); }
  });
};

// v14 re-audit — test-support export guard (matches js/money-core.js's exact
// pattern). window.computeVatSummary is pure (rows in, object out; its only
// external dependency, window.ledgerKind, is stubbed by the test the same
// way tests/money.test.mjs already stubs window.bizYear) — everything else
// in this file is DOM/Firestore-driven render code, not exported/tested here.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeVatSummary: window.computeVatSummary
  };
}
