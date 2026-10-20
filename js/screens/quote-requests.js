/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Quote requests (Sales › Quote requests)
   js/screens/quote-requests.js

   NEW 2026-10-21 (PUBLIC-QUOTE-REQUEST-SPEC.md §7.4/§8). The staff-facing list/detail for the
   public "Get a quote" requests sent from barroindustries.com/catalogue/ — a 3-step intake, an
   "Add to quote" basket of catalogue items (custom sizes, options, notes) and a SERVER-computed
   estimate range the visitor saw. Sibling and clone of js/screens/client-info-requests.js (Sales ›
   Briefs): same shell, same role gating, same idioms, no photos.

   EVERY value on a request is ATTACKER-CONTROLLED (an open public page): every interpolation into
   innerHTML in this file goes through escHtml(), every href is built with encodeURIComponent, and
   there is no value that is ever used as markup, as a URL, or as a script. Item names / ids /
   categories on a request were re-derived from the product master by the server, but they are
   escaped here all the same.

   Load-order / idiom: plain window.*-attached classic script, lazy-loaded via js/config.js
   PAGE_SCRIPTS['dept:Sales'] / ['bk-quotations'] (after js/qr-def.js, so window.QR_DEF is defined
   by the time this file's code runs — every read of it is still defensive). window.renderQuoteRequests
   (container, currentUser, currentRole) is called from js/screens/sales.js loadSalesContent(), case
   'Quote requests' — `container` is that file's #sales-content div, passed in (not #page-content),
   because this is a chip-tab subview of the Sales page. Every other function here re-derives its
   container from the module-local `_qrContainer`.

   Data model (frozen interface, spec §8 — read and write these field names exactly):
     quote_requests/{refNo}                 one doc per request (created ONLY by the qrSubmit callable)
     quote_requests/{refNo}/notes/{noteId}  internal notes, create-only
   This screen never touches qr_sessions / qr_ratelimit / qr_abuse (no rules match at all —
   Cloud Functions only) and never calls the public callables — only the staff-authenticated
   qrAdminDelete, via the same firebase.app().functions('asia-east1') pattern the CIR screen uses.

   THE PRICE BOUNDARY: `internal` on each request holds the exact total and the per-line LIST
   prices the server computed at submit time. They are staff-only by convention (the whole doc is
   staff-readable): they are rendered ONLY when qrCanWrite(), the secretary sees the client view
   (no prices), and the figure the VISITOR saw is the rounded range in `estimate`. Nothing here is
   ever copied into a notification, a print "client copy", or a URL.

   Role gating (spec §7.4, same as CIR §5.2):
     qrCanWrite()  — president/manager/owner, OR a non-secretary member of the Sales department.
                     Deliberately NOT canEditDept('Sales') (that resolves through isAdmin(), which
                     admits the Corporate Secretary, who stays view-only here).
     qrCanDelete() — president/manager/owner only.
   Every write control (status, Convert, Open in Quote Builder, Add note) is hidden when
   qrCanWrite() is false; Delete when qrCanDelete() is false. The "Technical details" block reuses
   qrCanDelete() as its gate.
   ═══════════════════════════════════════════════════ */

'use strict';

// ── Role gating — logic byte-identical to cirCanWrite / cirCanDelete ─────
function qrCanWrite() {
  const role = window.currentRole || '';
  if (role === 'president' || role === 'manager' || role === 'owner') return true;
  if (role === 'secretary') return false;                     // standing boundary: view-only
  return (window.currentDepts || []).includes('Sales');       // Sales-dept staff of any other role
}
function qrCanDelete() { return ['president', 'manager', 'owner'].includes(window.currentRole || ''); }

// ── Small local constants ─────────────────────────────────────────────────
const QR_REQ_PUBLIC_URL = 'https://barroindustries.com/catalogue/?quote=1';
const QR_REQ_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const QR_REQ_STATUS_META = {
  new:        { cls: 'badge-blue',   label: 'New' },
  in_review:  { cls: 'badge-orange', label: 'In review' },
  quoted:     { cls: 'badge-purple', label: 'Quoted' },
  converted:  { cls: 'badge-green',  label: 'Converted' },
  archived:   { cls: 'badge-gray',   label: 'Archived' }
};

// The only value this file ever puts inside an inline handler or an attribute: the server-minted reference (QR-yymmdd-XXXXXX,
// letters and digits only). Anything else renders as '' — never trust a document id just because the server wrote it.
function _qrRefAttr(id) { return /^QR-\d{6}-[A-Z2-9]{6}$/.test(String(id == null ? '' : id)) ? String(id) : ''; }

// ── Module-local state (repainted on every visit) ─────────────────────────
let _qrContainer = null;       // the DOM node passed to renderQuoteRequests — every later repaint targets this
let _qrView = 'list';          // 'list' | 'detail'
let _qrRows = [];              // cached list rows (quote_requests docs)
let _qrCurrent = null;         // full doc of the open detail view
let _qrNotes = [];             // notes of the open detail view
let _qrStatusFilter = 'all';   // 'all' | 'new' | 'in_review' | 'quoted' | 'converted' | 'archived'
let _qrSearch = '';            // lowercased search string

// ══════════════════════ ENTRY POINT ══════════════════════
window.renderQuoteRequests = async function (container, currentUser, currentRole) {
  const c = container || deptContainer();
  if (!c) return;
  _qrContainer = c;
  _qrView = 'list';
  _qrCurrent = null;
  _qrNotes = [];
  c.innerHTML = _qrListShellHtml();
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  _qrBindListControls(c);
  await _qrLoadList();
};

// ══════════════════════ SHARED FETCHERS / CACHE ══════════════════════
function qrFetchList() {
  return window.dbCachedGet('qr-list', () =>
    db.collection('quote_requests').orderBy('createdAt', 'desc').limit(200).get()
      .then(snap => snap.docs.map(d => Object.assign({ id: d.id }, d.data()))),
    30000);
}
function qrInvalidate() { window.dbCacheInvalidate('qr-list'); }
function qrFetchOne(refNo) {
  return db.collection('quote_requests').doc(refNo).get().then(doc => {
    if (!doc.exists) throw new Error('Quote request not found — it may have been deleted.');
    return Object.assign({ id: doc.id }, doc.data());
  });
}
function qrFetchNotes(refNo) {
  return db.collection('quote_requests').doc(refNo).collection('notes').orderBy('at', 'asc').get()
    .then(snap => snap.docs.map(d => Object.assign({ id: d.id }, d.data())));
}

// ══════════════════════ SMALL FORMAT HELPERS ══════════════════════
// Option value -> label from the shared definition (js/qr-def.js); a value the definition no longer knows is shown raw (escaped by the caller).
function _qrLabel(field, value) {
  const def = window.QR_DEF && window.QR_DEF.INTAKE && window.QR_DEF.INTAKE[field];
  const hit = def && (def.options || []).filter(o => o.v === value)[0];
  return hit ? hit.l : (value == null ? '' : String(value));
}
function _qrPeso(n) {
  const x = Number(n);
  return isFinite(x) ? '₱' + x.toLocaleString('en-PH') : '';
}
function _qrStatusPill(status) {
  const m = QR_REQ_STATUS_META[status] || { cls: 'badge-gray', label: status || 'unknown' };
  return `<span class="badge ${m.cls}">${escHtml(m.label)}</span>`;
}
// Day-difference age string, from window.bizDate() Manila-date strings (never toISOString, never a local Date diff).
function _qrAge(ts) {
  if (!ts || typeof ts.toDate !== 'function') return '';
  const d = window.bizDate(ts.toDate());
  const today = window.bizDate();
  if (d === today) return 'today';
  const dp = d.split('-').map(Number), tp = today.split('-').map(Number);
  const days = Math.round((Date.UTC(tp[0], tp[1] - 1, tp[2]) - Date.UTC(dp[0], dp[1] - 1, dp[2])) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return days + ' days ago';
}
// RA 10173 retention prompt (O4 — flag only, no auto-purge): 24 months or older.
function _qrIsStale(createdAt) {
  if (!createdAt || typeof createdAt.toDate !== 'function') return false;
  const d = window.bizDate(createdAt.toDate());
  const today = window.bizDate();
  const dp = d.split('-').map(Number), tp = today.split('-').map(Number);
  let months = (tp[0] - dp[0]) * 12 + (tp[1] - dp[1]);
  if (tp[2] < dp[2]) months -= 1;
  return months >= 24;
}
// A stored server Timestamp for a human, in Manila time (explicit zone — correct on any viewer's OS); never toISOString().
function _qrManilaDT(ts) {
  if (!ts || typeof ts.toDate !== 'function') return '';
  try {
    return ts.toDate().toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (_) { return ''; }
}
// 'YYYY-MM-DD' -> 'DD Mon YYYY' from the string's own parts (never new Date(str)).
function _qrFormatDate(v) {
  if (!v || typeof v !== 'string') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return v;
  return `${parseInt(m[3], 10)} ${QR_REQ_MONTHS_SHORT[parseInt(m[2], 10) - 1] || ''} ${m[1]}`;
}
// The builder's own size string (L = W, W = D, H = H; or "N run(s)").
function _qrDimString(it) {
  if (it && it.runs != null && it.runs !== '') return `${Number(it.runs)} run(s)`;
  const sz = it && it.size;
  if (!sz || typeof sz !== 'object') return '';
  const lab = { W: 'L', D: 'W', H: 'H' };
  const parts = [];
  ['W', 'D', 'H'].forEach(k => { if (sz[k] != null && sz[k] !== '') parts.push(lab[k] + Number(sz[k])); });
  return parts.length ? parts.join(' × ') + ' mm' : '';
}
function _qrItems(doc) { return Array.isArray(doc && doc.items) ? doc.items : []; }
function _qrLines(doc) { return (doc && doc.internal && Array.isArray(doc.internal.lines)) ? doc.internal.lines : []; }
function _qrLineFor(doc, it, idx) {
  const lines = _qrLines(doc);
  return lines.filter(l => l && l.n === it.n)[0] || lines[idx] || null;
}

// ══════════════════════ LIST VIEW ══════════════════════
function _qrListShellHtml() {
  return `
    <div class="page-header">
      <div>
        <h2>${emojiIcon('🧾', 20)} Quote requests</h2>
        <p style="font-size:12px;color:var(--text-muted);margin:2px 0 0">"Get a quote" requests from barroindustries.com — items, sizes and the estimate the client saw</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn-secondary btn-sm" onclick="qrCopyLink()">${emojiIcon('🔗', 16)} Copy public link</button>
        <button type="button" class="btn-secondary btn-sm" id="qr-refresh-btn">${emojiIcon('↻', 16)} Refresh</button>
      </div>
    </div>
    <div id="qr-filter-row" style="margin-bottom:10px"></div>
    <div style="margin-bottom:12px">
      <input type="text" id="qr-search" placeholder="Search ref, name, company, e-mail, mobile…"
        style="width:100%;max-width:360px;padding:8px 12px;border:1.5px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font-size:13px" />
    </div>
    <div id="qr-table-root">${window.skeletonHtml('table')}</div>
  `;
}

function _qrBindListControls(c) {
  const search = c.querySelector('#qr-search');
  if (search) {
    let t = null;
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { _qrSearch = search.value.trim().toLowerCase(); _qrPaintTable(); }, 300);
    });
  }
  const refreshBtn = c.querySelector('#qr-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      qrInvalidate();
      await _qrLoadList();
      Notifs.showToast('Refreshed', 'success');
    });
  }
}

async function _qrLoadList() {
  const root = document.getElementById('qr-table-root');
  if (!root) return;
  await window.withLoadingAndError(root, qrFetchList, (rows) => {
    _qrRows = rows || [];
    _qrPaintFilterRow();
    _qrPaintTable();
  }, {
    skeleton: 'table',
    emptyCheck: (rows) => !rows || !rows.length,
    emptyState: { icon: '🧾', title: 'No quote requests yet', hint: 'Visitors who use "Get a quote" on barroindustries.com land here.' }
  });
}

function _qrPaintFilterRow() {
  const row = document.getElementById('qr-filter-row');
  if (!row) return;
  const counts = { all: _qrRows.length, new: 0, in_review: 0, quoted: 0, converted: 0, archived: 0 };
  _qrRows.forEach(r => { if (counts[r.status] != null) counts[r.status]++; });
  const items = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'new', label: 'New', count: counts.new },
    { key: 'in_review', label: 'In review', count: counts.in_review },
    { key: 'quoted', label: 'Quoted', count: counts.quoted },
    { key: 'converted', label: 'Converted', count: counts.converted },
    { key: 'archived', label: 'Archived', count: counts.archived }
  ];
  row.innerHTML = window.chipTabs(items, _qrStatusFilter, { cls: 'qr-status-tabs' });
  window.bindChipTabs(row, (key) => { _qrStatusFilter = key; _qrPaintTable(); });
}

function _qrFilteredRows() {
  let rows = _qrRows;
  if (_qrStatusFilter && _qrStatusFilter !== 'all') rows = rows.filter(r => r.status === _qrStatusFilter);
  if (_qrSearch) {
    const q = _qrSearch;
    rows = rows.filter(r => {
      const s = r.summary || {};
      const hay = [r.id, s.company, s.name, s.email, s.mobile].map(x => (x || '').toLowerCase()).join(' ');
      return hay.indexOf(q) !== -1;
    });
  }
  return rows;
}

function _qrPaintTable() {
  const root = document.getElementById('qr-table-root');
  if (!root) return;
  root.innerHTML = _qrTableHtml(_qrFilteredRows());
  if (window.lucide) lucide.createIcons({ nodes: [root] });
}

// Every cell value is escHtml()'d — list rows are exactly as attacker-controlled as the detail view.
function _qrTableHtml(rows) {
  if (!rows.length) {
    return window.renderEmptyState({ icon: '🔎', title: 'No matching requests', hint: 'Try a different filter or search.' });
  }
  const trs = rows.map(r => {
    const s = r.summary || {};
    const refEsc = _qrRefAttr(r.id);
    const staleBadge = _qrIsStale(r.createdAt) ? ` <span class="badge badge-amber" title="Past the 24-month retention promise (RA 10173) — review for deletion">review retention</span>` : '';
    const entityPill = s.entityType === 'government'
      ? '<span class="badge badge-purple">Gov</span>'
      : (s.entityType ? '<span class="badge badge-gray">Private</span>' : '');
    const est = s.estimateShown ? `${escHtml(_qrPeso(s.estimateLow))} – ${escHtml(_qrPeso(s.estimateHigh))}` : '—';
    return `
      <tr class="qr-row" data-ref="${escHtml(r.id)}" onclick="qrOpen('${refEsc}')" style="cursor:pointer">
        <td class="tc-avatar" style="font-family:monospace;white-space:nowrap">${escHtml(r.id)}</td>
        <td class="tc-detail" data-label="Received">${escHtml(r.submittedOnManila || '')}<div style="font-size:11px;color:var(--text-muted)">${escHtml(_qrAge(r.createdAt))}</div>${staleBadge}</td>
        <td class="tc-name"><strong>${escHtml(s.name || '')}</strong>${s.company ? ` <span style="color:var(--text-muted)">· ${escHtml(s.company)}</span>` : ''}<div style="font-size:11px;color:var(--text-muted)">${escHtml(s.mobile || '')}${s.email ? ' · ' + escHtml(s.email) : ''}</div></td>
        <td class="tc-detail" data-label="Need">${escHtml(_qrLabel('need', s.need))}</td>
        <td class="tc-detail" data-label="Use">${escHtml(_qrLabel('useFor', s.useFor))}</td>
        <td class="tc-detail" data-label="Entity">${entityPill}</td>
        <td class="tc-detail" data-label="Items">${Number(s.itemCount) || 0}</td>
        <td class="tc-detail" data-label="Est. (client saw)">${est}</td>
        <td class="tc-net">${_qrStatusPill(r.status)}</td>
      </tr>`;
  }).join('');
  return `
    <div class="table-wrap"><table class="data-table table-cards">
      <thead><tr><th>Ref</th><th>Received</th><th>Name / Company</th><th>Need</th><th>Use</th><th>Entity</th><th>Items</th><th>Est. (client saw)</th><th>Status</th></tr></thead>
      <tbody>${trs}</tbody>
    </table></div>`;
}

window.qrCopyLink = async function () {
  try {
    await navigator.clipboard.writeText(QR_REQ_PUBLIC_URL);
    Notifs.showToast('Link copied', 'success');
  } catch (_) {
    Notifs.showToast('Could not copy automatically — ' + QR_REQ_PUBLIC_URL, 'error');
  }
};

// ══════════════════════ DETAIL VIEW ══════════════════════
window.qrOpen = async function (refNo) {
  _qrView = 'detail';
  const root = _qrContainer || deptContainer();
  if (!root) return;
  root.innerHTML = window.skeletonHtml('rows');
  try {
    const [doc, notes] = await Promise.all([qrFetchOne(refNo), qrFetchNotes(refNo)]);
    _qrCurrent = doc;
    _qrNotes = notes;
    _qrRenderDetail();
  } catch (e) {
    root.innerHTML = `<div class="empty-state"><p>${escHtml(e.message || String(e))}</p>
      <button class="btn-secondary" onclick="qrBackToList()">Back to list</button></div>`;
  }
};

window.qrBackToList = function () {
  const root = _qrContainer || deptContainer();
  _qrView = 'list';
  _qrCurrent = null;
  _qrNotes = [];
  if (root) window.renderQuoteRequests(root, window.currentUser, window.currentRole);
};

// The request card: what the visitor asked for (labels resolved from QR_DEF).
function _qrRequestCardHtml(doc) {
  const it = doc.intake || {};
  const row = (label, valueHtml) => `<tr><td style="width:38%;color:var(--text-muted)">${escHtml(label)}</td><td>${valueHtml}</td></tr>`;
  const need = _qrLabel('need', it.need) + (it.needOther ? ' — ' + it.needOther : '');
  const use = _qrLabel('useFor', it.useFor) + (it.useForOther ? ' — ' + it.useForOther : '');
  const target = it.targetFlexible ? 'Flexible — not sure yet' : _qrFormatDate(it.targetDate || '');
  return `
    <div class="card"><h4 style="margin-top:0">Request</h4>
      <table class="data-table qr-kv"><tbody>
        ${row('What they need', escHtml(need))}
        ${row('Use', escHtml(use))}
        ${row('Government / private', escHtml(_qrLabel('entityType', it.entityType)))}
        ${row('Target date', escHtml(target))}
        ${row('Delivery address', `<div style="white-space:pre-wrap">${escHtml(it.address || '')}</div>`)}
        ${it.notes ? row('Notes', `<div style="white-space:pre-wrap">${escHtml(it.notes)}</div>`) : ''}
      </tbody></table>
    </div>`;
}

// The items table. Prices (list unit + line + internal total) are rendered ONLY when `withPrices`.
function _qrItemsTableHtml(doc, withPrices) {
  const items = _qrItems(doc);
  if (!items.length) return '<p style="font-size:12px;color:var(--text-muted)">— no items —</p>';
  const rows = items.map((it, i) => {
    const size = _qrDimString(it);
    const sizeHtml = size
      ? escHtml(size) + (it.sizeCustom ? ' <span class="badge badge-amber">custom</span>' : '')
      : '<span style="color:var(--text-muted)">Standard size</span>';
    const specs = (Array.isArray(it.specs) ? it.specs : []).map(s => `${escHtml(s && s.label)}: ${escHtml(s && s.value)}`).join('<br>');
    let priceCells = '';
    if (withPrices) {
      const line = _qrLineFor(doc, it, i);
      let unit, total;
      if (line && line.priced) {
        unit = escHtml(_qrPeso(line.unitPrice));
        total = escHtml(_qrPeso(line.lineTotal));
      } else {
        unit = '<span class="badge badge-gray">priced on review</span>';
        total = '';
      }
      if (line && Array.isArray(line.warnings) && line.warnings.length) {
        unit += ` <span title="${escHtml(line.warnings.join(' '))}">${emojiIcon('⚠️', 14)}</span>`;
      }
      priceCells = `<td style="white-space:nowrap">${unit}</td><td style="white-space:nowrap;text-align:right">${total}</td>`;
    }
    return `<tr>
      <td>${Number(it.n) || i + 1}</td>
      <td><strong>${escHtml(it.name || '')}</strong><div style="font-family:monospace;font-size:11px;color:var(--text-muted)">${escHtml(it.id || '')}</div></td>
      <td>${sizeHtml}</td>
      <td style="font-size:12px">${specs}</td>
      <td>${Number(it.qty) || 0}${it.unit ? ' <span style="font-size:11px;color:var(--text-muted)">' + escHtml(it.unit) + '</span>' : ''}</td>
      <td style="font-size:12px;white-space:pre-wrap">${escHtml(it.note || '')}</td>
      ${priceCells}
    </tr>`;
  }).join('');
  const head = `<tr><th>#</th><th>Product</th><th>Size</th><th>Options</th><th>Qty</th><th>Note</th>${withPrices ? '<th>Unit (list)</th><th style="text-align:right">Line</th>' : ''}</tr>`;
  let foot = '';
  if (withPrices && doc.internal && doc.internal.exactTotal != null) {
    foot = `<tfoot><tr><td colspan="7" style="text-align:right;font-weight:700">Internal total (priced items, ex-VAT)</td><td style="text-align:right;font-weight:700;white-space:nowrap">${escHtml(_qrPeso(doc.internal.exactTotal))}</td></tr></tfoot>`;
  }
  const caption = withPrices
    ? '<p style="font-size:11px;color:var(--text-muted);margin:6px 0 0">Internal list prices at submission — never shown to the client.</p>'
    : '';
  return `<div class="table-wrap"><table class="data-table">${`<thead>${head}</thead>`}<tbody>${rows}</tbody>${foot}</table></div>${caption}`;
}

function _qrEstimateCardHtml(doc) {
  const e = doc.estimate || {};
  const le = doc.lastEstimate;
  let saw;
  if (e.shown) saw = `Client saw: <strong>${escHtml(_qrPeso(e.low))} – ${escHtml(_qrPeso(e.high))}</strong> <span style="color:var(--text-muted)">(step ${escHtml(_qrPeso(e.step))})</span>`;
  else saw = `No figure shown to the client (${escHtml(e.reason === 'disabled' ? 'estimate switched off' : 'basket below the minimum')}).`;
  // lastEstimate is what the visitor's OWN page said it displayed — client-reported, so it is labelled as unverified and the
  // server compares it with what it computed at submit (estimateMismatch: different basket, different range, or no figure now).
  const lastSaw = le && le.low != null && le.high != null
    ? `<p style="font-size:12px;color:var(--text-muted);margin:4px 0 0">Client-reported last figure (unverified): ${escHtml(_qrPeso(le.low))} – ${escHtml(_qrPeso(le.high))}</p>` : '';
  const warn = doc.estimateMismatch
    ? `<p style="font-size:12px;margin:6px 0 0">${emojiIcon('⚠️', 14)} The figure the client's page reported does not match the figure computed at submission (the basket changed, or the figure was altered) — rely on the figure above, not the client-reported one.</p>` : '';
  return `
    <div class="card"><h4 style="margin-top:0">Estimate</h4>
      <p style="font-size:13px;margin:0">${saw}</p>
      ${lastSaw}${warn}
      <p style="font-size:12px;color:var(--text-muted);margin:6px 0 0">
        ${Number(e.pricedCount) || 0} priced line(s) · ${Number(e.reviewCount) || 0} priced on review · ${Number(e.customSizeCount) || 0} custom size(s) · estimate v${escHtml(doc.estimateVersion != null ? doc.estimateVersion : '')}
      </p>
    </div>`;
}

function _qrRenderDetail() {
  const root = _qrContainer || deptContainer();
  const doc = _qrCurrent;
  if (!root || !doc) return;
  const canWrite = qrCanWrite();
  const canDelete = qrCanDelete();
  const c = doc.contact || {};
  const refEsc = _qrRefAttr(doc.id);
  const contactBits = [];
  if (c.name) contactBits.push(escHtml(c.name));
  if (c.mobile) contactBits.push(`<a href="${'tel:' + encodeURIComponent(c.mobile)}">${escHtml(c.mobile)}</a>`);
  if (c.email) contactBits.push(`<a href="${'mailto:' + encodeURIComponent(c.email)}">${escHtml(c.email)}</a>`);

  const statusOptions = [['new', 'New'], ['in_review', 'In review'], ['quoted', 'Quoted'], ['converted', 'Converted'], ['archived', 'Archived']];
  const statusSelectHtml = canWrite
    ? `<select onchange="qrSetStatus('${refEsc}', this.value)">${statusOptions.map(o => `<option value="${o[0]}"${o[0] === doc.status ? ' selected' : ''}>${o[1]}</option>`).join('')}</select>`
    : '';
  const convertedDate = (doc.convertedAt && doc.convertedAt.toDate) ? window.bizDate(doc.convertedAt.toDate()) : '';
  const convertHtml = doc.convertedClientId
    ? `<span style="font-size:12px;color:var(--text-muted)">Converted &rarr; client ${escHtml(doc.convertedClientId)}${convertedDate ? ' on ' + escHtml(convertedDate) : ''}</span>`
    : (canWrite ? `<button class="btn-secondary btn-sm" onclick="qrConvert('${refEsc}')">Convert to client</button>` : '');
  const builderHtml = canWrite ? `<button class="btn-primary btn-sm" onclick="qrOpenInBuilder('${refEsc}')">Open in Quote Builder</button>` : '';
  const printHtml = `<button class="btn-secondary btn-sm" onclick="qrPrint('${refEsc}', ${canWrite ? 'false' : 'true'})">${emojiIcon('printer', 16)} Print / PDF</button>`
    + (canWrite ? ` <button class="btn-secondary btn-sm" onclick="qrPrint('${refEsc}', true)">Print client copy</button>` : '');
  const deleteHtml = canDelete ? `<button class="btn-danger btn-sm" onclick="qrDelete('${refEsc}')">Delete</button>` : '';

  const consent = doc.consent || {};
  const consentHtml = `
    <div class="card"><h4 style="margin-top:0">Consent</h4>
      <p style="font-size:13px">Data-privacy consent given ${escHtml(_qrManilaDT(consent.consentedAt))} &middot; notice v${escHtml(consent.noticeVersion || '')}</p>
    </div>`;

  let technicalHtml = '';
  if (canDelete) {
    const cl = doc.client || {};
    const kv = (k, v, extra) => `<tr><td style="width:38%;color:var(--text-muted)">${escHtml(k)}</td><td${extra || ''}>${v}</td></tr>`;
    technicalHtml = `
      <details class="card"><summary style="cursor:pointer;font-weight:700">Technical details</summary>
        <table class="data-table qr-kv" style="margin-top:8px"><tbody>
          ${kv('IP', escHtml(cl.ip || ''))}
          ${kv('User agent', escHtml(cl.userAgent || ''), ' style="word-break:break-all"')}
          ${kv('Accept-language', escHtml(cl.acceptLanguage || ''))}
          ${kv('Referer', escHtml(cl.referer || ''), ' style="word-break:break-all"')}
          ${kv('Fill time', cl.fillMs != null ? escHtml(Math.round(cl.fillMs / 1000) + ' s') : '')}
          ${kv('Estimate calls', escHtml(cl.estimateCalls != null ? cl.estimateCalls : ''))}
          ${kv('Session', escHtml(doc.sessionHash || ''), ' style="font-family:monospace;word-break:break-all"')}
          ${doc.internal && doc.internal.productsLoadedAt ? kv('Product master read', escHtml(doc.internal.productsLoadedAt)) : ''}
        </tbody></table>
      </details>`;
  }

  const itemsHtml = `<div class="card"><h4 style="margin-top:0">Items (${_qrItems(doc).length})</h4>${_qrItemsTableHtml(doc, canWrite)}</div>`;

  root.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px">
      <button class="btn-icon" onclick="qrBackToList()" title="Back">${emojiIcon('arrow-left', 18)}</button>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:16px">${escHtml(c.company || c.name || '')}</div>
        <div style="font-size:12px;color:var(--text-muted)">${contactBits.join(' &middot; ')}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
          <span style="font-family:monospace">${escHtml(doc.id)}</span> &middot;
          ${escHtml(doc.submittedOnManila || '')} (${escHtml(_qrAge(doc.createdAt))}) ${_qrStatusPill(doc.status)}
        </div>
      </div>
    </div>
    <div class="card" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${statusSelectHtml}${builderHtml}${convertHtml}${printHtml}${deleteHtml}
    </div>
    <div style="margin-top:12px">${_qrRequestCardHtml(doc)}</div>
    ${itemsHtml}
    ${_qrEstimateCardHtml(doc)}
    ${consentHtml}
    ${technicalHtml}
    ${_qrNotesHtml(_qrNotes || [], refEsc, canWrite)}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [root] });
}

function _qrNotesHtml(notes, refEsc, canWrite) {
  const rows = notes.length ? notes.map(n => `
    <div style="border-bottom:1px solid var(--border);padding:8px 0">
      <div style="font-size:12px;color:var(--text-muted)">${escHtml(n.authorName || '')} &middot; ${escHtml(_qrManilaDT(n.at))}</div>
      <div style="font-size:13px;white-space:pre-wrap">${escHtml(n.text || '')}</div>
    </div>`).join('') : `<p style="font-size:12px;color:var(--text-muted)">No notes yet.</p>`;
  const addForm = canWrite ? `
    <div style="margin-top:10px">
      <textarea id="qr-note-text" rows="2" placeholder="Add an internal note…" style="width:100%;box-sizing:border-box"></textarea>
      <button class="btn-primary btn-sm" style="margin-top:6px" onclick="qrAddNote('${refEsc}')">Add note</button>
    </div>` : '';
  return `<div class="card"><h4 style="margin-top:0">Notes</h4>${rows}${addForm}</div>`;
}

// ══════════════════════ WRITE ACTIONS ══════════════════════
function _qrActor() {
  return {
    uid: (window.currentUser && window.currentUser.uid) || null,
    name: (window.userProfile && window.userProfile.displayName) || (window.currentUser && window.currentUser.email) || ''
  };
}

window.qrSetStatus = async function (refNo, status) {
  if (!qrCanWrite()) return;
  const a = _qrActor();
  try {
    await db.collection('quote_requests').doc(refNo).update({
      status: status,
      statusChangedAt: firebase.firestore.FieldValue.serverTimestamp(),
      statusChangedBy: a.uid,
      statusChangedByName: a.name,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    window.logAudit('update', 'quote_request', refNo, { status: status });
    qrInvalidate();
    Notifs.showToast('Status updated', 'success');
    _qrCurrent = await qrFetchOne(refNo);
    _qrRenderDetail();
  } catch (e) {
    Notifs.showToast('Could not update status: ' + (e.message || e), 'error');
  }
};

window.qrAddNote = async function (refNo) {
  if (!qrCanWrite()) return;
  const ta = document.getElementById('qr-note-text');
  const text = ta ? ta.value.trim() : '';
  if (!text) { Notifs.showToast('Note text is required', 'error'); return; }
  const a = _qrActor();
  try {
    await db.collection('quote_requests').doc(refNo).collection('notes').add({
      text: text.slice(0, 2000),
      authorUid: a.uid,
      authorName: a.name,
      at: firebase.firestore.FieldValue.serverTimestamp()
    });
    window.logAudit('create', 'quote_request_note', refNo, {});
    _qrNotes = await qrFetchNotes(refNo);
    _qrRenderDetail();
    Notifs.showToast('Note added', 'success');
  } catch (e) {
    Notifs.showToast('Could not add note: ' + (e.message || e), 'error');
  }
};

// Fill-empty-only merge: never overwrites a value the client book already has (same rule as the CIR convert).
function _qrFillEmptyOnly(existing, patch, vals) {
  Object.keys(vals).forEach(k => { if (!existing[k] && vals[k]) patch[k] = vals[k]; });
}

window.qrConvert = async function (refNo) {
  if (!qrCanWrite()) return;
  const ok = await window.confirmDialog({ title: 'Convert to client?', message: 'Create or update a client record from this quote request?', confirmLabel: 'Convert' });
  if (!ok) return;
  try {
    const doc = (_qrCurrent && _qrCurrent.id === refNo) ? _qrCurrent : await qrFetchOne(refNo);
    const c = doc.contact || {};
    const it = doc.intake || {};
    const e = doc.estimate || {};
    const name = c.name || '';
    if (!name) { Notifs.showToast('This request has no contact name to convert', 'error'); return; }

    const FV = firebase.firestore.FieldValue;
    const existing = await window.Clients.findByName(name);
    const n = _qrItems(doc).length;
    const briefNote = ('Quote request ' + refNo + ' (' + (doc.submittedOnManila || '') + '): ' +
      [_qrLabel('need', it.need), _qrLabel('useFor', it.useFor), _qrLabel('entityType', it.entityType),
        'target: ' + (it.targetDate || 'flexible'), n + ' item' + (n === 1 ? '' : 's'),
        e.shown ? 'est. ' + _qrPeso(e.low) + '–' + _qrPeso(e.high) : 'no estimate shown'].filter(Boolean).join(' · ')).slice(0, 1000);

    let clientId;
    if (existing) {
      const upd = {
        updatedAt: FV.serverTimestamp(),
        brands: FV.arrayUnion('sales'),
        leadOrigin: existing.leadOrigin || 'inbound',
        source: existing.source || 'Quote request',
        qrRefs: FV.arrayUnion(refNo),
        notes: ((existing.notes ? existing.notes + '\n\n' : '') + briefNote).slice(0, 4000)
      };
      _qrFillEmptyOnly(existing, upd, { company: c.company, phone: c.mobile, email: c.email, address: it.address });
      await db.collection('clients').doc(existing.id).update(upd);
      clientId = existing.id;
    } else {
      const uid0 = _qrActor().uid;
      const ref = await db.collection('clients').add({
        name: name, nameKey: window.clientNameKey(name), brands: ['sales'], stage: 'lead',
        company: c.company || '', phone: c.mobile || '', email: c.email || '', address: it.address || '',
        notes: briefNote, followUpDate: '', lastContact: '', contactLog: [],
        leadOrigin: 'inbound', source: 'Quote request', campaignId: null, handedOffAt: null,
        qrRefs: [refNo],
        addedBy: uid0, createdBy: uid0,
        createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp()
      });
      clientId = ref.id;
    }

    const a = _qrActor();
    await db.collection('quote_requests').doc(refNo).update({
      status: 'converted', convertedClientId: clientId, convertedAt: FV.serverTimestamp(), convertedBy: a.uid,
      statusChangedAt: FV.serverTimestamp(), statusChangedBy: a.uid, statusChangedByName: a.name,
      updatedAt: FV.serverTimestamp()
    });

    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('clients');
    qrInvalidate();
    window.logAudit('update', 'quote_request', refNo, { converted: clientId });
    Notifs.showToast('Client record ' + (existing ? 'updated' : 'created') + ' — see Sales → Clients', 'success');
    _qrCurrent = await qrFetchOne(refNo);
    _qrRenderDetail();
  } catch (err) {
    Notifs.showToast('Could not convert: ' + (err.message || err), 'error');
  }
};

// One request line -> the exact item shape quote-builder-v2's addItemFromCalc() pushes. `priceManual` is deliberately NOT
// set (the builder's auto-pricer may reprice a costed line, exactly as if staff had picked the item); an unpriced line
// (unitPrice 0) opens as a line staff must price. No cost fields: the builder takes the live cost basis by product id.
function _qrToBuilderItem(it, line) {
  const unitPrice = line && line.priced ? Number(line.unitPrice) || 0 : 0;
  const specs = (Array.isArray(it.specs) ? it.specs : []).map(s => ({ label: String(s && s.label || ''), value: String(s && s.value || '') }));
  const qty = Math.max(1, parseInt(it.qty, 10) || 1);
  return {
    id: String(it.id || ''), category: String(it.cat || ''), name: String(it.name || ''),
    dims: _qrDimString(it),
    specs: specs, specStr: specs.map(s => s.value).filter(Boolean).join(', '),
    qty: qty, unit: String(it.unit || 'pc'),
    unitPrice: unitPrice, amount: unitPrice * qty,
    leadTime: '—', laborHours: null,
    formulaType: String((line && line.formulaType) || 'fixed'),
    notes: String(it.note || '')
  };
}

window.qrOpenInBuilder = function (refNo) {
  if (!qrCanWrite()) return;
  const doc = (_qrCurrent && _qrCurrent.id === refNo) ? _qrCurrent : null;
  if (!doc) return;
  const c = doc.contact || {};
  const it = doc.intake || {};
  const items = _qrItems(doc).map((x, i) => _qrToBuilderItem(x, _qrLineFor(doc, x, i)));
  window._qbReopenState = {
    clientName: c.name || '',
    clientCompany: c.company || '',
    clientAddress: it.address || '',
    clientPhone: c.mobile || '',
    clientEmail: c.email || '',
    items: items
  };
  window._qbReopenAsRevision = false;
  Notifs.showToast('Opening Quote Builder with this request’s client and items…', 'success');
  navigateTo('bk-quote-builder');
};

window.qrDelete = async function (refNo) {
  if (!qrCanDelete()) return;
  const ok = await window.confirmDialog({
    title: 'Delete this quote request?',
    message: 'Removes the request and its notes permanently (RA 10173 erasure). This cannot be undone.',
    danger: true, confirmLabel: 'Delete'
  });
  if (!ok) return;
  try {
    await firebase.app().functions('asia-east1').httpsCallable('qrAdminDelete')({ refNo: refNo });
    window.logAudit('delete', 'quote_request', refNo, {});
    qrInvalidate();
    Notifs.showToast('Quote request deleted', 'success');
    window.qrBackToList();
  } catch (e) {
    Notifs.showToast('Could not delete: ' + (e.message || e), 'error');
  }
};

// ══════════════════════ PRINT / PDF ══════════════════════
// `clientCopy` true: no internal prices at all (what may be handed to the client / shown to a view-only role).
window.qrPrint = async function (refNo, clientCopy) {
  try {
    const doc = (_qrCurrent && _qrCurrent.id === refNo) ? _qrCurrent : await qrFetchOne(refNo);
    const withPrices = !clientCopy && qrCanWrite();            // a role without write access can never print the internal figures
    const c = doc.contact || {};
    const who = c.company || c.name || '';
    const userName = (window.userProfile && window.userProfile.displayName) || '';
    const lh = window.buildLetterhead ? window.buildLetterhead({
      orientation: 'portrait',
      docTitle: 'QUOTE REQUEST',
      dateLabel: 'Received ' + (doc.submittedOnManila || ''),
      extraMeta: [refNo, who],
      signatures: [{ label: 'Reviewed by', name: userName, title: 'Sales' }],
      footerNote: 'Barro Industries Operating System · Generated ' + new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) + ' · Contains personal data (RA 10173) — handle accordingly.'
    }) : null;

    const consent = doc.consent || {};
    const consentLine = (window.QR_DEF && window.QR_DEF.PRIVACY_NOTICE && window.QR_DEF.PRIVACY_NOTICE.consentLine) || '';
    const consentHtml = `<p style="font-size:11px;color:#555;margin-top:10px">Consent: ${escHtml(consentLine)} (Notice v${escHtml(consent.noticeVersion || '')}, given ${escHtml(_qrManilaDT(consent.consentedAt))})</p>`;
    const strip = withPrices
      ? '<p style="font-size:11px;font-weight:700;color:#8a1f11;margin:6px 0">INTERNAL — list prices. Do not give this copy to the client.</p>'
      : '<p style="font-size:11px;color:#555;margin:6px 0">Client copy — no prices.</p>';

    const bodyHtml = (lh ? lh.headerHTML : '') + strip +
      _qrPrintRequestHtml(doc) +
      `<section style="margin-bottom:14px"><h4>Items (${_qrItems(doc).length})</h4>${_qrItemsTableHtml(doc, withPrices)}</section>` +
      _qrPrintEstimateHtml(doc) +
      consentHtml + (lh ? lh.footerHTML : '');

    const pageCss = `.page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:12mm 14mm} h4{margin:10px 0 4px;font-size:12px;text-transform:uppercase;color:#1E3A5F} table{width:100%;border-collapse:collapse} td,th{font-size:10px;padding:3px 4px;border-bottom:1px solid #ddd;vertical-align:top;text-align:left} .qr-kv td:first-child{width:38%;color:#555} .badge{display:inline-block;border:1px solid #bbb;border-radius:8px;padding:0 4px;font-size:9px} section{break-inside:avoid} ${lh ? lh.printCSS : ''} @media print{.page{padding:0;width:auto;min-height:0}}`;

    window.openPrintableDoc({
      title: 'Quote request ' + refNo + ' — ' + who,
      barLabel: `${emojiIcon('🧾', 16)} Quote request ${escHtml(refNo)}`,
      bodyHtml: bodyHtml,
      pageCss: pageCss
    });
  } catch (e) {
    Notifs.showToast('Could not open print view: ' + (e.message || e), 'error');
  }
};

function _qrPrintRequestHtml(doc) {
  const it = doc.intake || {};
  const c = doc.contact || {};
  const row = (k, v) => `<tr><td>${escHtml(k)}</td><td>${v}</td></tr>`;
  const need = _qrLabel('need', it.need) + (it.needOther ? ' — ' + it.needOther : '');
  const use = _qrLabel('useFor', it.useFor) + (it.useForOther ? ' — ' + it.useForOther : '');
  const target = it.targetFlexible ? 'Flexible — not sure yet' : _qrFormatDate(it.targetDate || '');
  return `<section style="margin-bottom:14px"><h4>Request</h4><table class="qr-kv"><tbody>
    ${row('Name', escHtml(c.name || ''))}${row('Company / agency', escHtml(c.company || ''))}${row('Mobile', escHtml(c.mobile || ''))}${row('E-mail', escHtml(c.email || ''))}
    ${row('What they need', escHtml(need))}${row('Use', escHtml(use))}${row('Government / private', escHtml(_qrLabel('entityType', it.entityType)))}
    ${row('Target date', escHtml(target))}${row('Delivery address', `<div style="white-space:pre-wrap">${escHtml(it.address || '')}</div>`)}
    ${it.notes ? row('Notes', `<div style="white-space:pre-wrap">${escHtml(it.notes)}</div>`) : ''}
  </tbody></table></section>`;
}

function _qrPrintEstimateHtml(doc) {
  const e = doc.estimate || {};
  const line = e.shown
    ? `Estimate shown to the client: ${escHtml(_qrPeso(e.low))} – ${escHtml(_qrPeso(e.high))} (indicative, ${e.vatBasis === 'inclusive' ? 'VAT-inclusive' : 'VAT-exclusive'}; delivery and installation excluded).`
    : 'No estimate was shown to the client.';
  return `<section style="margin-bottom:14px"><h4>Estimate</h4><p style="font-size:11px;margin:2px 0">${line}</p></section>`;
}
