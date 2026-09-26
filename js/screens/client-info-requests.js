/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Client Information Requests (Sales › Briefs)
   js/screens/client-info-requests.js

   NEW 2026-09-26 (CLIENT-INFO-REQUEST-SPEC.md §5/§6, WS-C of a four-
   workstream build — WS-0 shared form definitions, WS-A the public intake
   page, WS-B the Cloud Functions/rules, WS-C this internal control screen).
   Renders the staff-facing list/detail for submissions of the public,
   no-account "Client Information Request" form at
   barroindustries.com/sales/clientinformationrequest/ — Neil's commissary
   kitchen project brief plus a Photos part. Every value on a submission is
   ATTACKER-CONTROLLED (an open public form): every interpolation into
   innerHTML in this file goes through escHtml(), and every URL (plans_link,
   resolved photo download URLs) goes through safeHttpUrl() before it is
   ever placed in an href/src, so a `javascript:` link or an
   `<img onerror>` payload renders as inert escaped text, never executes.

   Load-order / idiom: plain window.*-attached classic script, lazy-loaded
   via js/config.js PAGE_SCRIPTS['dept:Sales'] / ['bk-quotations'] the first
   time either page is navigated to — same convention as every other
   js/screens/*.js file (see inventory.js/todo.js headers). Loads AFTER
   js/cir-forms.js in both PAGE_SCRIPTS entries, so window.CIR_FORMS /
   window.CIR_PRIVACY_NOTICE / window.CIR_LIMITS are already defined by the
   time this file's top-level code runs — but every read of them below is
   still defensive (`window.CIR_FORMS && …`) in case that file ever fails to
   load, per the coordinator's instruction to consume WS-0's globals
   defensively. window.renderClientBriefs(container, currentUser, currentRole)
   is called from js/screens/sales.js's loadSalesContent() switch, case
   'Briefs' — `container` is that file's #sales-content div, passed in (not
   #page-content), because Briefs is a chip-tab subview of the Sales page,
   not a standalone top-level route. Every other function in this file
   re-derives its container from the module-local `_cirContainer` set on
   entry, rather than calling deptContainer(), for the same reason.

   Data model (frozen interface, spec §1.2/§1.3 — read from and write to
   these field names exactly):
     client_info_requests/{refNo}                — one doc per submission
     client_info_requests/{refNo}/notes/{noteId}  — internal notes, create-only
   This screen never touches cir_drafts / cir_ratelimit / cir_abuse (no
   rules match on those at all — Admin-SDK/Cloud-Functions only) and never
   calls the four PUBLIC callables (cirStartDraft/cirUploadPhoto/
   cirRemovePhoto/cirSubmit) — only the staff-authenticated cirAdminDelete,
   via the SAME firebase.app().functions('asia-east1') pattern
   js/screens/client-portals.js already uses for portalAdminRotateCode.

   Role gating (spec §5.2, owner rulings R1–R4 in the spec, §8):
     cirCanWrite()  — president/manager/owner, OR a non-secretary member of
                      the Sales department. Deliberately NOT canEditDept
                      ('Sales') — that helper resolves through isAdmin(),
                      which admits the Corporate Secretary, and the owner
                      ruling is that the secretary stays view-only here.
     cirCanDelete() — president/manager/owner only (ruling R2: President
                      AND Manager may delete; Sales staff and the Secretary
                      may not).
   Every write control (status select, Convert, Prefill Quote Builder, Add
   note) is hidden when cirCanWrite() is false; Delete is hidden when
   cirCanDelete() is false. The "Technical details" <details> (raw IP/user
   agent/accept-language/referer/fill time/draft id — the staff-only
   forensic block from spec §1.2's `client` object) reuses cirCanDelete()
   as its gate rather than re-typing the narrower "president/manager" prose
   in spec §5.5 — this codebase already treats 'owner' as a president-
   equivalent senior tier elsewhere (js/departments.js canEditDept:
   `['president','owner','manager'].includes(role)`), so a role that can
   permanently delete the brief and its photos can also see the forensic
   block on it; flagged here as a deliberate reading, not a re-ask.

   SPEC AMBIGUITY FLAGGED #1 — `fillEmptyOnly`. Spec §5.6 step 4 calls
   `fillEmptyOnly({ company, phone, email, address })` as if it were an
   existing shared helper ("fill-empty-only exactly as the two precedents").
   Grepped the whole repo: no such global exists anywhere. The actual
   precedent is inline code in js/departments.js's openLeadCaptureModal
   (~line 1500): `['company','phone','email'].forEach(k => { if
   (!existing[k] && vals[k]) upd[k] = vals[k]; });` — never factored into a
   function, and missing 'address'. This file implements the equivalent
   logic as a small file-local helper, `_cirFillEmptyOnly(existing, patch,
   vals)`, generalised to the four keys the spec's own §5.6 text lists,
   rather than inventing a new cross-file shared global the coordinator
   did not ask for and no other caller needs yet.

   SPEC AMBIGUITY FLAGGED #2 — the internal renderer's grid/full-width
   layout rule. Spec §1.4's "Rendering rule (page + internal renderer)"
   says a chips/table/photos field closes the current grid and a new one
   opens after it, explicitly scoping that rule to BOTH the public page and
   this internal renderer. cirRenderAnswers() below follows it literally:
   consecutive scalar fields (text/tel/email/select/number/date/url/
   textarea) are batched into one label/value `<table class="cir-kv">`,
   and each chips/table/photos field is flushed as its own full-width block
   in original field order — not simply "all kv rows, then all blocks."

   Every write in this file mirrors the client-portal control screen's
   pattern (js/screens/client-portals.js): optimistic re-fetch-and-repaint
   after a Firestore write, window.logAudit() alongside it, dbCacheInvalidate
   on the 'cir-list' cache key so the list reflects the change on next visit.
   There is no per-submission `events` audit subcollection for CIR (spec
   §3.1: "no events subcollection — staff actions are on the doc + audit_log"),
   unlike client_portals — so this file, unlike that one, does NOT write a
   second audit doc per action; window.logAudit()'s single audit_log entry
   is the whole trail here.
   ═══════════════════════════════════════════════════ */

'use strict';

// ── Role gating — verbatim from CLIENT-INFO-REQUEST-SPEC.md §5.2 ─────────
function cirCanWrite() {
  const role = window.currentRole || '';
  if (role === 'president' || role === 'manager' || role === 'owner') return true;
  if (role === 'secretary') return false;                     // standing boundary: view-only
  return (window.currentDepts || []).includes('Sales');       // Sales-dept staff of any other role
}
function cirCanDelete() { return ['president', 'manager', 'owner'].includes(window.currentRole || ''); }

// ── Small local constants ─────────────────────────────────────────────────
const CIR_PUBLIC_URL = 'https://barroindustries.com/sales/clientinformationrequest/';
const CIR_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CIR_STATUS_META = {
  new:        { cls: 'badge-blue',   label: 'New' },
  in_review:  { cls: 'badge-orange', label: 'In review' },
  contacted:  { cls: 'badge-purple', label: 'Contacted' },
  converted:  { cls: 'badge-green',  label: 'Converted' },
  archived:   { cls: 'badge-gray',   label: 'Archived' }
};

// ── Module-local state (repainted on every visit — no persistence beyond
// the current session, same pattern as todo.js's _todo* state) ───────────
let _cirContainer = null;      // the DOM node passed to renderClientBriefs — every later repaint targets this, not deptContainer()
let _cirView = 'list';         // 'list' | 'detail'
let _cirRows = [];             // cached list rows (client_info_requests docs)
let _cirCurrent = null;        // full doc of the open detail view
let _cirNotes = [];            // notes of the open detail view
let _cirStatusFilter = 'all';  // 'all' | 'new' | 'in_review' | 'contacted' | 'converted' | 'archived'
let _cirSearch = '';           // lowercased search string
let _cirUrlCache = {};         // Storage path → getDownloadURL() promise, memoised across the session

// ══════════════════════ ENTRY POINT ══════════════════════
window.renderClientBriefs = async function (container, currentUser, currentRole) {
  const c = container || deptContainer();
  if (!c) return;
  _cirContainer = c;
  _cirView = 'list';
  _cirCurrent = null;
  _cirNotes = [];
  c.innerHTML = _cirListShellHtml();
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  _cirBindListControls(c);
  await _cirLoadList();
};

// ══════════════════════ SHARED FETCHERS / CACHE ══════════════════════
function cirFetchList() {
  return window.dbCachedGet('cir-list', () =>
    db.collection('client_info_requests').orderBy('createdAt', 'desc').limit(200).get()
      .then(snap => snap.docs.map(d => Object.assign({ id: d.id }, d.data()))),
    30000);
}
function cirInvalidate() { window.dbCacheInvalidate('cir-list'); }
function cirFetchOne(refNo) {
  return db.collection('client_info_requests').doc(refNo).get().then(doc => {
    if (!doc.exists) throw new Error('Brief not found — it may have been deleted.');
    return Object.assign({ id: doc.id }, doc.data());
  });
}
function cirFetchNotes(refNo) {
  return db.collection('client_info_requests').doc(refNo).collection('notes').orderBy('at', 'asc').get()
    .then(snap => snap.docs.map(d => Object.assign({ id: d.id }, d.data())));
}
// Storage path → resolved download URL, memoised for the session. NEVER
// stores a bearer URL in Firestore (spec §1.3) — resolved at view time only,
// and always passed through safeHttpUrl() before it reaches a src/href.
function cirPhotoUrl(path) {
  if (!path) return Promise.resolve('');
  if (_cirUrlCache[path]) return _cirUrlCache[path];
  const p = storage.ref(path).getDownloadURL()
    .then(url => (window.safeHttpUrl ? window.safeHttpUrl(url) : url))
    .catch(() => '');
  _cirUrlCache[path] = p;
  return p;
}

// ══════════════════════ SMALL FORMAT HELPERS ══════════════════════
function cirStatusPill(status) {
  const m = CIR_STATUS_META[status] || { cls: 'badge-gray', label: status || 'unknown' };
  return `<span class="badge ${m.cls}">${escHtml(m.label)}</span>`;
}
// Day-difference age string. Computed from window.bizDate() Manila-date
// strings, compared via Date.UTC of their own y/m/d parts — never
// toISOString() and never a local `new Date(ts)` diff (CLAUDE.md "Manila
// time only").
function cirAge(ts) {
  if (!ts || typeof ts.toDate !== 'function') return '';
  const d = window.bizDate(ts.toDate());
  const today = window.bizDate();
  if (d === today) return 'today';
  const dp = d.split('-').map(Number), tp = today.split('-').map(Number);
  const dMs = Date.UTC(dp[0], dp[1] - 1, dp[2]);
  const tMs = Date.UTC(tp[0], tp[1] - 1, tp[2]);
  const days = Math.round((tMs - dMs) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return days + ' days ago';
}
// RA 10173 retention prompt (spec §5.4/§8 R3 — flag only, no auto-purge).
// Month difference from Manila-date parts, same no-toISOString discipline.
function _cirIsStale(createdAt) {
  if (!createdAt || typeof createdAt.toDate !== 'function') return false;
  const d = window.bizDate(createdAt.toDate());
  const today = window.bizDate();
  const dp = d.split('-').map(Number), tp = today.split('-').map(Number);
  let months = (tp[0] - dp[0]) * 12 + (tp[1] - dp[1]);
  if (tp[2] < dp[2]) months -= 1;
  return months >= 24;
}
// A stored server Timestamp, formatted for a human — NOT a business-date
// computation (bizDate/bizHour return date-only strings with no time-of-day),
// so this uses toLocaleString with an EXPLICIT Asia/Manila zone rather than
// bizDate, and never toISOString(). Same technique client-portals.js's Audit
// tab already uses (`e.at.toDate().toLocaleString('en-PH')`), made stricter
// with an explicit timeZone so it is correct regardless of the viewer's OS.
function _cirManilaDT(ts) {
  if (!ts || typeof ts.toDate !== 'function') return '';
  try {
    return ts.toDate().toLocaleString('en-PH', {
      timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  } catch (_) { return ''; }
}
// 'YYYY-MM-DD' → 'DD Mon YYYY', built from the string's own parts — never
// `new Date(str)` (spec §5.5: "no new Date(str)" — avoids local-timezone
// off-by-one on a bare date string).
function _cirFormatDate(v) {
  if (!v || typeof v !== 'string') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return v;
  const day = parseInt(m[3], 10);
  const mon = CIR_MONTHS_SHORT[parseInt(m[2], 10) - 1] || '';
  return `${day} ${mon} ${m[1]}`;
}
// select/chips option → label. Options are either a bare string (value ==
// label) or {v,l}. Returns null for a value not in the definition's option
// list (an "unlisted"/attacker-supplied chip value) so the caller can fall
// back to rendering the raw value, escaped.
function _cirOptionLabel(field, value) {
  const opts = field.options || [];
  for (let i = 0; i < opts.length; i++) {
    const o = opts[i];
    if (typeof o === 'string') { if (o === value) return o; }
    else if (o && o.v === value) return (o.l != null ? o.l : o.v);
  }
  return null;
}

// ══════════════════════ LIST VIEW ══════════════════════
function _cirListShellHtml() {
  return `
    <div class="page-header">
      <div>
        <h2>${emojiIcon('📥', 20)} Client Briefs</h2>
        <p style="font-size:12px;color:var(--text-muted);margin:2px 0 0">Client Information Requests from barroindustries.com</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn-secondary btn-sm" onclick="cirCopyLink()">${emojiIcon('🔗', 16)} Copy public link</button>
        <button type="button" class="btn-secondary btn-sm" id="cir-refresh-btn">${emojiIcon('↻', 16)} Refresh</button>
      </div>
    </div>
    <div id="cir-filter-row" style="margin-bottom:10px"></div>
    <div style="margin-bottom:12px">
      <input type="text" id="cir-search" placeholder="Search ref, company, name, email, phone…"
        style="width:100%;max-width:360px;padding:8px 12px;border:1.5px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font-size:13px" />
    </div>
    <div id="cir-table-root">${window.skeletonHtml('table')}</div>
  `;
}

// Copy-link is the one public global the spec names for this button; Refresh
// is not in the spec's public-globals list, so per the file's own "prefer
// addEventListener scoped to the container for everything else" convention
// (spec §5.1) it is wired here rather than via a new window.cirX global.
function _cirBindListControls(c) {
  const search = c.querySelector('#cir-search');
  if (search) {
    let t = null;
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => { _cirSearch = search.value.trim().toLowerCase(); _cirPaintTable(); }, 300);
    });
  }
  const refreshBtn = c.querySelector('#cir-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      cirInvalidate();
      await _cirLoadList();
      Notifs.showToast('Refreshed', 'success');
    });
  }
}

async function _cirLoadList() {
  const root = document.getElementById('cir-table-root');
  if (!root) return;
  await window.withLoadingAndError(root, cirFetchList, (rows) => {
    _cirRows = rows || [];
    _cirPaintFilterRow();
    _cirPaintTable();
  }, {
    skeleton: 'table',
    emptyCheck: (rows) => !rows || !rows.length,
    emptyState: { icon: '📥', title: 'No client briefs yet', hint: 'Send the public link to a prospective client — submissions land here.' }
  });
}

function _cirPaintFilterRow() {
  const row = document.getElementById('cir-filter-row');
  if (!row) return;
  const counts = { all: _cirRows.length, new: 0, in_review: 0, contacted: 0, converted: 0, archived: 0 };
  _cirRows.forEach(r => { if (counts[r.status] != null) counts[r.status]++; });
  const items = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'new', label: 'New', count: counts.new },
    { key: 'in_review', label: 'In review', count: counts.in_review },
    { key: 'contacted', label: 'Contacted', count: counts.contacted },
    { key: 'converted', label: 'Converted', count: counts.converted },
    { key: 'archived', label: 'Archived', count: counts.archived }
  ];
  row.innerHTML = window.chipTabs(items, _cirStatusFilter, { cls: 'cir-status-tabs' });
  window.bindChipTabs(row, (key) => { _cirStatusFilter = key; _cirPaintTable(); });
}

function _cirFilteredRows() {
  let rows = _cirRows;
  if (_cirStatusFilter && _cirStatusFilter !== 'all') rows = rows.filter(r => r.status === _cirStatusFilter);
  if (_cirSearch) {
    const q = _cirSearch;
    rows = rows.filter(r => {
      const s = r.summary || {};
      const hay = [r.id, s.company, s.name, s.email, s.phone].map(x => (x || '').toLowerCase()).join(' ');
      return hay.indexOf(q) !== -1;
    });
  }
  return rows;
}

function _cirPaintTable() {
  const root = document.getElementById('cir-table-root');
  if (!root) return;
  root.innerHTML = _cirTableHtml(_cirFilteredRows());
  if (window.lucide) lucide.createIcons({ nodes: [root] });
}

// Every cell value below is escHtml()'d — list rows are exactly as
// attacker-controlled as detail rows (spec: "Security, first-class").
function _cirTableHtml(rows) {
  if (!rows.length) {
    return window.renderEmptyState({ icon: '🔎', title: 'No matching briefs', hint: 'Try a different filter or search.' });
  }
  const trs = rows.map(r => {
    const s = r.summary || {};
    const refEsc = escHtml(r.id).replace(/'/g, "\\'");
    const staleBadge = _cirIsStale(r.createdAt) ? ` <span class="badge badge-amber" title="Past the 24-month retention promise (RA 10173) — review for deletion">review retention</span>` : '';
    return `
      <tr class="cir-row" data-ref="${escHtml(r.id)}" onclick="cirOpen('${refEsc}')" style="cursor:pointer">
        <td class="tc-avatar" style="font-family:monospace;white-space:nowrap">${escHtml(r.id)}</td>
        <td class="tc-detail" data-label="Received">${escHtml(r.submittedOnManila || '')}<div style="font-size:11px;color:var(--text-muted)">${escHtml(cirAge(r.createdAt))}</div>${staleBadge}</td>
        <td class="tc-name"><strong>${escHtml(s.company || '')}</strong><div style="font-size:11px;color:var(--text-muted)">${escHtml(s.name || '')}${s.phone ? ' · ' + escHtml(s.phone) : ''}${s.email ? ' · ' + escHtml(s.email) : ''}</div></td>
        <td class="tc-detail" data-label="Business">${escHtml(s.bizType || '')}</td>
        <td class="tc-detail" data-label="Budget">${escHtml(s.budget || '')}</td>
        <td class="tc-detail" data-label="Target">${escHtml(_cirFormatDate(s.targetDate || ''))}</td>
        <td class="tc-detail" data-label="Photos">${Number(s.photoCount) || 0}</td>
        <td class="tc-net">${cirStatusPill(r.status)}</td>
      </tr>`;
  }).join('');
  return `
    <div class="table-wrap"><table class="data-table table-cards">
      <thead><tr><th>Ref</th><th>Received</th><th>Company / Contact</th><th>Business</th><th>Budget</th><th>Target</th><th>Photos</th><th>Status</th></tr></thead>
      <tbody>${trs}</tbody>
    </table></div>`;
}

window.cirCopyLink = async function () {
  try {
    await navigator.clipboard.writeText(CIR_PUBLIC_URL);
    Notifs.showToast('Link copied', 'success');
  } catch (_) {
    Notifs.showToast('Could not copy automatically — ' + CIR_PUBLIC_URL, 'error');
  }
};

// ══════════════════════ DETAIL VIEW ══════════════════════
window.cirOpen = async function (refNo) {
  _cirView = 'detail';
  const root = _cirContainer || deptContainer();
  if (!root) return;
  root.innerHTML = window.skeletonHtml('rows');
  try {
    const [sub, notes] = await Promise.all([cirFetchOne(refNo), cirFetchNotes(refNo)]);
    _cirCurrent = sub;
    _cirNotes = notes;
    _cirRenderDetail();
  } catch (e) {
    root.innerHTML = `<div class="empty-state"><p>${escHtml(e.message || String(e))}</p>
      <button class="btn-secondary" onclick="cirBackToList()">Back to list</button></div>`;
  }
};

window.cirBackToList = function () {
  const root = _cirContainer || deptContainer();
  _cirView = 'list';
  _cirCurrent = null;
  _cirNotes = [];
  if (root) window.renderClientBriefs(root, window.currentUser, window.currentRole);
};

function _cirRenderDetail() {
  const root = _cirContainer || deptContainer();
  const sub = _cirCurrent;
  if (!root || !sub) return;
  const def = (window.CIR_FORMS && window.CIR_FORMS[sub.formId]) || null;
  const canWrite = cirCanWrite();
  const canDelete = cirCanDelete();
  const isSeniorStaff = cirCanDelete(); // see header comment — reused as the "technical details" gate
  const s = sub.summary || {};
  const a = sub.answers || {};
  const refNoEsc = escHtml(sub.id).replace(/'/g, "\\'");

  const telHref = 'tel:' + encodeURIComponent(s.phone || '');
  const mailHref = 'mailto:' + encodeURIComponent(s.email || '');
  const contactBits = [];
  if (s.name) contactBits.push(escHtml(s.name));
  if (a.position) contactBits.push(escHtml(a.position));
  if (s.phone) contactBits.push(`<a href="${telHref}">${escHtml(s.phone)}</a>`);
  if (s.email) contactBits.push(`<a href="${mailHref}">${escHtml(s.email)}</a>`);

  const statusOptions = [['new', 'New'], ['in_review', 'In review'], ['contacted', 'Contacted'], ['converted', 'Converted'], ['archived', 'Archived']];
  const statusSelectHtml = canWrite
    ? `<select onchange="cirSetStatus('${refNoEsc}', this.value)">${statusOptions.map(o => `<option value="${o[0]}"${o[0] === sub.status ? ' selected' : ''}>${o[1]}</option>`).join('')}</select>`
    : '';
  const convertedDate = (sub.convertedAt && sub.convertedAt.toDate) ? window.bizDate(sub.convertedAt.toDate()) : '';
  const convertHtml = sub.convertedClientId
    ? `<span style="font-size:12px;color:var(--text-muted)">Converted &rarr; client ${escHtml(sub.convertedClientId)}${convertedDate ? ' on ' + escHtml(convertedDate) : ''}</span>`
    : (canWrite ? `<button class="btn-secondary btn-sm" onclick="cirConvert('${refNoEsc}')">Convert to client</button>` : '');
  const prefillHtml = canWrite ? `<button class="btn-secondary btn-sm" onclick="cirPrefillQuote('${refNoEsc}')">Prefill Quote Builder</button>` : '';
  const printHtml = `<button class="btn-secondary btn-sm" onclick="cirPrint('${refNoEsc}')">${emojiIcon('printer', 16)} Print / PDF</button>`;
  const deleteHtml = canDelete ? `<button class="btn-danger btn-sm" onclick="cirDelete('${refNoEsc}')">Delete</button>` : '';

  const bodyHtml = def
    ? cirRenderAnswers(def, sub, 'screen')
    : `<div class="empty-state"><p>Form definition unavailable — reload the app. The brief's raw data is safe; only this preview is affected.</p></div>`;

  const consent = sub.consent || {};
  const consentHtml = `
    <div class="card"><h4 style="margin-top:0">Consent</h4>
      <p style="font-size:13px">Data-privacy consent given ${escHtml(_cirManilaDT(consent.consentedAt))} &middot; notice v${escHtml(consent.noticeVersion || '')}</p>
    </div>`;

  let technicalHtml = '';
  if (isSeniorStaff) {
    const client = sub.client || {};
    technicalHtml = `
      <details class="card"><summary style="cursor:pointer;font-weight:700">Technical details</summary>
        <table class="data-table cir-kv" style="margin-top:8px"><tbody>
          <tr><td style="width:38%;color:var(--text-muted)">IP</td><td>${escHtml(client.ip || '')}</td></tr>
          <tr><td style="width:38%;color:var(--text-muted)">User agent</td><td style="word-break:break-all">${escHtml(client.userAgent || '')}</td></tr>
          <tr><td style="width:38%;color:var(--text-muted)">Accept-language</td><td>${escHtml(client.acceptLanguage || '')}</td></tr>
          <tr><td style="width:38%;color:var(--text-muted)">Referer</td><td style="word-break:break-all">${escHtml(client.referer || '')}</td></tr>
          <tr><td style="width:38%;color:var(--text-muted)">Fill time</td><td>${client.fillMs != null ? Math.round(client.fillMs / 1000) + ' s' : ''}</td></tr>
          <tr><td style="width:38%;color:var(--text-muted)">Draft id</td><td style="font-family:monospace;word-break:break-all">${escHtml(sub.draftHash || '')}</td></tr>
        </tbody></table>
      </details>`;
  }

  const notesHtml = _cirNotesHtml(_cirNotes || [], refNoEsc, canWrite);

  root.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px">
      <button class="btn-icon" onclick="cirBackToList()" title="Back">${emojiIcon('arrow-left', 18)}</button>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:16px">${escHtml(s.company || '')}</div>
        <div style="font-size:12px;color:var(--text-muted)">${contactBits.join(' &middot; ')}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
          <span style="font-family:monospace">${escHtml(sub.id)}</span> &middot;
          ${escHtml(sub.submittedOnManila || '')} (${escHtml(cirAge(sub.createdAt))}) ${cirStatusPill(sub.status)}
        </div>
      </div>
    </div>
    <div class="card" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${statusSelectHtml}${convertHtml}${prefillHtml}${printHtml}${deleteHtml}
    </div>
    <div style="margin-top:12px">${bodyHtml}</div>
    ${consentHtml}
    ${technicalHtml}
    ${notesHtml}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [root] });
  _cirHydratePhotos(root);
}

function _cirNotesHtml(notes, refNoEsc, canWrite) {
  const rows = notes.length ? notes.map(n => `
    <div style="border-bottom:1px solid var(--border);padding:8px 0">
      <div style="font-size:12px;color:var(--text-muted)">${escHtml(n.authorName || '')} &middot; ${escHtml(_cirManilaDT(n.at))}</div>
      <div style="font-size:13px;white-space:pre-wrap">${escHtml(n.text || '')}</div>
    </div>`).join('') : `<p style="font-size:12px;color:var(--text-muted)">No notes yet.</p>`;
  const addForm = canWrite ? `
    <div style="margin-top:10px">
      <textarea id="cir-note-text" rows="2" placeholder="Add an internal note…" style="width:100%;box-sizing:border-box"></textarea>
      <button class="btn-primary btn-sm" style="margin-top:6px" onclick="cirAddNote('${refNoEsc}')">Add note</button>
    </div>` : '';
  return `<div class="card"><h4 style="margin-top:0">Notes</h4>${rows}${addForm}</div>`;
}

// ── Photo tile hydration (screen mode only — print mode resolves URLs
// up front, see cirPrint). Each <img data-cir-path> starts empty; this
// fills its src once the Storage download URL resolves, or replaces the
// tile with a plain "Photo unavailable" label on failure. Never uses the
// stored path as a src directly — always goes through cirPhotoUrl() so
// the URL is signed and safeHttpUrl()-checked. ──
function _cirHydratePhotos(root) {
  root.querySelectorAll('img[data-cir-path]').forEach(img => {
    const path = img.getAttribute('data-cir-path') || '';
    cirPhotoUrl(path).then(url => {
      if (url) {
        img.src = url;
      } else {
        const wrap = img.closest('.cir-ph-imgwrap');
        if (wrap) wrap.innerHTML = '<span style="font-size:11px;color:var(--text-muted);padding:8px;text-align:center">Photo unavailable</span>';
      }
    });
  });
}

window.cirPreviewPhoto = async function (idx) {
  const sub = _cirCurrent;
  if (!sub) return;
  const photos = sub.photos || [];
  const ph = photos[idx];
  if (!ph) return;
  try {
    const url = await cirPhotoUrl(ph.path);
    if (!url) { Notifs.showToast('Photo unavailable', 'error'); return; }
    window.openFilePreview({ url: url, name: ph.caption || ph.photoId || 'photo', contentType: 'image/jpeg' });
  } catch (e) {
    Notifs.showToast('Photo unavailable', 'error');
  }
};

// ══════════════════════ WRITE ACTIONS ══════════════════════
window.cirSetStatus = async function (refNo, status) {
  if (!cirCanWrite()) return;
  const uid = (window.currentUser && window.currentUser.uid) || null;
  const uname = (window.userProfile && window.userProfile.displayName) || (window.currentUser && window.currentUser.email) || '';
  try {
    await db.collection('client_info_requests').doc(refNo).update({
      status: status,
      statusChangedAt: firebase.firestore.FieldValue.serverTimestamp(),
      statusChangedBy: uid,
      statusChangedByName: uname,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    window.logAudit('update', 'client_info_request', refNo, { status: status });
    cirInvalidate();
    Notifs.showToast('Status updated', 'success');
    _cirCurrent = await cirFetchOne(refNo);
    _cirRenderDetail();
  } catch (e) {
    Notifs.showToast('Could not update status: ' + (e.message || e), 'error');
  }
};

window.cirAddNote = async function (refNo) {
  if (!cirCanWrite()) return;
  const ta = document.getElementById('cir-note-text');
  const text = ta ? ta.value.trim() : '';
  if (!text) { Notifs.showToast('Note text is required', 'error'); return; }
  const uid = (window.currentUser && window.currentUser.uid) || null;
  const uname = (window.userProfile && window.userProfile.displayName) || (window.currentUser && window.currentUser.email) || '';
  try {
    await db.collection('client_info_requests').doc(refNo).collection('notes').add({
      text: text.slice(0, 2000),
      authorUid: uid,
      authorName: uname,
      at: firebase.firestore.FieldValue.serverTimestamp()
    });
    window.logAudit('create', 'client_info_request_note', refNo, {});
    _cirNotes = await cirFetchNotes(refNo);
    _cirRenderDetail();
    Notifs.showToast('Note added', 'success');
  } catch (e) {
    Notifs.showToast('Could not add note: ' + (e.message || e), 'error');
  }
};

// Fill-empty-only merge — see header comment, SPEC AMBIGUITY #1. Only
// copies a key from `vals` onto `patch` when the existing client record has
// nothing there yet; never overwrites a value the client book already has.
function _cirFillEmptyOnly(existing, patch, vals) {
  Object.keys(vals).forEach(k => {
    const v = vals[k];
    if (!existing[k] && v) patch[k] = v;
  });
}

window.cirConvert = async function (refNo) {
  if (!cirCanWrite()) return;
  const ok = await window.confirmDialog({ title: 'Convert to client?', message: 'Create or update a client record from this brief?', confirmLabel: 'Convert' });
  if (!ok) return;
  try {
    const sub = (_cirCurrent && _cirCurrent.id === refNo) ? _cirCurrent : await cirFetchOne(refNo);
    const s = sub.summary || {};
    const a = sub.answers || {};
    const name = s.name || '';
    const company = s.company || '';
    if (!name) { Notifs.showToast('This brief has no contact name to convert', 'error'); return; }

    const FV = firebase.firestore.FieldValue;
    const existing = await window.Clients.findByName(name);
    const scopeStr = Array.isArray(a.scope) ? a.scope.join(', ') : '';
    const briefNote = ('Client brief ' + refNo + ' (' + (sub.submittedOnManila || '') + '): ' +
      [a.biz_type, 'site: ' + (a.site_address || ''), 'budget: ' + (a.budget || '—'),
        'target: ' + (a.target_date || '—'), 'scope: ' + scopeStr].filter(Boolean).join(' · ')).slice(0, 1000);

    let clientId;
    if (existing) {
      const upd = {
        updatedAt: FV.serverTimestamp(),
        brands: FV.arrayUnion('sales'),
        leadOrigin: existing.leadOrigin || 'inbound',
        source: existing.source || 'Client brief',
        cirRefs: FV.arrayUnion(refNo),
        notes: ((existing.notes ? existing.notes + '\n\n' : '') + briefNote).slice(0, 4000)
      };
      _cirFillEmptyOnly(existing, upd, { company: company, phone: s.phone, email: s.email, address: a.address });
      await db.collection('clients').doc(existing.id).update(upd);
      clientId = existing.id;
    } else {
      const uid0 = (window.currentUser && window.currentUser.uid) || null;
      const ref = await db.collection('clients').add({
        name: name, nameKey: window.clientNameKey(name), brands: ['sales'], stage: 'lead',
        company: company, phone: s.phone || '', email: s.email || '', address: a.address || '',
        notes: briefNote, followUpDate: '', lastContact: '', contactLog: [],
        leadOrigin: 'inbound', source: 'Client brief', campaignId: null, handedOffAt: null,
        cirRefs: [refNo],
        addedBy: uid0, createdBy: uid0,
        createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp()
      });
      clientId = ref.id;
    }

    const uid = (window.currentUser && window.currentUser.uid) || null;
    const uname = (window.userProfile && window.userProfile.displayName) || (window.currentUser && window.currentUser.email) || '';
    await db.collection('client_info_requests').doc(refNo).update({
      status: 'converted', convertedClientId: clientId, convertedAt: FV.serverTimestamp(), convertedBy: uid,
      statusChangedAt: FV.serverTimestamp(), statusChangedBy: uid, statusChangedByName: uname,
      updatedAt: FV.serverTimestamp()
    });

    if (typeof dbCacheInvalidate === 'function') dbCacheInvalidate('clients');
    cirInvalidate();
    window.logAudit('update', 'client_info_request', refNo, { converted: clientId });
    Notifs.showToast('Client record ' + (existing ? 'updated' : 'created') + ' — see Sales → Clients', 'success');
    _cirCurrent = await cirFetchOne(refNo);
    _cirRenderDetail();
  } catch (e) {
    Notifs.showToast('Could not convert: ' + (e.message || e), 'error');
  }
};

window.cirPrefillQuote = function (refNo) {
  if (!cirCanWrite()) return;
  const sub = (_cirCurrent && _cirCurrent.id === refNo) ? _cirCurrent : null;
  if (!sub) return;
  const s = sub.summary || {};
  const a = sub.answers || {};
  window._qbReopenState = {
    clientName: s.name || '',
    clientCompany: s.company || '',
    clientAddress: a.address || a.site_address || '',
    clientPhone: s.phone || '',
    clientEmail: s.email || ''
  };
  Notifs.showToast('Opening Quote Builder with this client’s details…', 'success');
  navigateTo('bk-quote-builder');
};

window.cirDelete = async function (refNo) {
  if (!cirCanDelete()) return;
  const ok = await window.confirmDialog({
    title: 'Delete this brief?',
    message: 'Removes the answers, notes and all photos permanently (RA 10173 erasure). This cannot be undone.',
    danger: true, confirmLabel: 'Delete'
  });
  if (!ok) return;
  try {
    await firebase.app().functions('asia-east1').httpsCallable('cirAdminDelete')({ refNo: refNo });
    window.logAudit('delete', 'client_info_request', refNo, {});
    cirInvalidate();
    Notifs.showToast('Brief deleted', 'success');
    window.cirBackToList();
  } catch (e) {
    Notifs.showToast('Could not delete: ' + (e.message || e), 'error');
  }
};

// ══════════════════════ PRINT / PDF ══════════════════════
window.cirPrint = async function (refNo) {
  try {
    const sub = (_cirCurrent && _cirCurrent.id === refNo) ? _cirCurrent : await cirFetchOne(refNo);
    const def = (window.CIR_FORMS && window.CIR_FORMS[sub.formId]) || null;
    const s = sub.summary || {};
    const company = s.company || '';
    const photos = sub.photos || [];
    const urlMap = {};
    await Promise.all(photos.map(ph => {
      if (!ph.path) return Promise.resolve();
      return cirPhotoUrl(ph.path).then(url => { urlMap[ph.path] = url || ''; });
    }));

    const userName = (window.userProfile && window.userProfile.displayName) || '';
    const lh = window.buildLetterhead ? window.buildLetterhead({
      orientation: 'portrait',
      docTitle: 'CLIENT INFORMATION REQUEST',
      dateLabel: 'Received ' + (sub.submittedOnManila || ''),
      extraMeta: [refNo, company],
      signatures: [{ label: 'Reviewed by', name: userName, title: 'Sales' }],
      footerNote: 'Barro Industries Operating System · Generated ' + new Date().toLocaleString('en-PH') + ' · Contains personal data (RA 10173) — handle accordingly.'
    }) : null;

    const consent = sub.consent || {};
    const consentLine = (window.CIR_PRIVACY_NOTICE && window.CIR_PRIVACY_NOTICE.consentLine) || '';
    const consentHtml = `<p style="font-size:11px;color:#555;margin-top:10px">Consent: ${escHtml(consentLine)} (Notice v${escHtml(consent.noticeVersion || '')}, given ${escHtml(_cirManilaDT(consent.consentedAt))})</p>`;

    const bodyHtml = (lh ? lh.headerHTML : '') +
      (def ? cirRenderAnswers(def, sub, 'print', urlMap) : '<p>Form definition unavailable.</p>') +
      consentHtml + (lh ? lh.footerHTML : '');

    const pageCss = `.page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:12mm 14mm} h4{margin:10px 0 4px;font-size:12px;text-transform:uppercase;color:#1E3A5F} table{width:100%;border-collapse:collapse} td,th{font-size:10px;padding:3px 4px;border-bottom:1px solid #ddd;vertical-align:top} .cir-kv td:first-child{width:38%;color:#555} .cir-ph-print{display:grid;grid-template-columns:repeat(3,1fr);gap:6px} .cir-ph-print img{width:100%;height:150px;object-fit:cover;border:1px solid #ccc} .cir-ph-print figcaption{font-size:9px;color:#555} fieldset,section{break-inside:avoid} ${lh ? lh.printCSS : ''} @media print{.page{padding:0;width:auto;min-height:0}}`;

    window.openPrintableDoc({
      title: 'Client Brief ' + refNo + ' — ' + company,
      barLabel: `${emojiIcon('📥', 16)} Client brief ${escHtml(refNo)}`,
      bodyHtml: bodyHtml,
      pageCss: pageCss
    });
  } catch (e) {
    Notifs.showToast('Could not open print view: ' + (e.message || e), 'error');
  }
};

// ══════════════════════ GENERIC ANSWERS WALKER (§1.4/§5.5) ══════════════════════
// Renders every section of `def`, walking fields in order. Consecutive
// scalar fields batch into one label/value table; a chips/table/photos
// field flushes that table and renders as its own full-width block — see
// SPEC AMBIGUITY #2 in the header comment. Unknown answer keys (an older
// form version) land in a trailing "Other answers" block instead of being
// silently dropped.
function cirRenderAnswers(def, sub, mode, photoUrlMap) {
  if (!def) return '<div class="empty-state"><p>Form definition unavailable — reload the app.</p></div>';
  let html = (def.sections || []).map((sec, i) => _cirRenderSection(sec, i + 1, sub, mode, photoUrlMap)).join('');
  html += _cirOtherAnswersHtml(def, sub, mode);
  return html;
}

function _cirFieldHasValue(f, sub) {
  if (f.type === 'photos') return !!(sub.photos && sub.photos.length);
  return !!(sub.answers && Object.prototype.hasOwnProperty.call(sub.answers, f.key));
}

function _cirRenderSection(sec, idx, sub, mode, photoUrlMap) {
  const fields = (sec.fields || []).filter(f => _cirFieldHasValue(f, sub));
  let inner;
  if (!fields.length) {
    inner = '<p style="font-size:12px;color:var(--text-muted)">— nothing filled in —</p>';
  } else {
    const parts = [];
    let rowBuffer = [];
    const flushRows = () => {
      if (rowBuffer.length) {
        parts.push(`<table class="data-table cir-kv"><tbody>${rowBuffer.join('')}</tbody></table>`);
        rowBuffer = [];
      }
    };
    fields.forEach(f => {
      if (f.type === 'table' || f.type === 'photos' || f.type === 'chips') {
        flushRows();
        parts.push(_cirRenderField(f, sub, mode, photoUrlMap));
      } else {
        rowBuffer.push(_cirRenderKvRow(f, sub));
      }
    });
    flushRows();
    inner = parts.join('');
  }
  if (mode === 'print') return `<section style="margin-bottom:14px"><h4>${idx}. ${escHtml(sec.title)}</h4>${inner}</section>`;
  return `<div class="card"><h4 style="margin-top:0">${idx}. ${escHtml(sec.title)}</h4>${inner}</div>`;
}

function _cirRenderField(f, sub, mode, photoUrlMap) {
  if (f.type === 'photos') return _cirRenderPhotosBlock(f, sub, mode, photoUrlMap);
  if (f.type === 'chips') return _cirRenderChipsBlock(f, sub, mode);
  if (f.type === 'table') return _cirRenderTableBlock(f, sub);
  return `<table class="data-table cir-kv"><tbody>${_cirRenderKvRow(f, sub)}</tbody></table>`;
}

function _cirRenderKvRow(f, sub) {
  const v = sub.answers ? sub.answers[f.key] : undefined;
  let valueHtml;
  if (f.type === 'url') {
    const safe = window.safeHttpUrl ? window.safeHttpUrl(v) : '';
    valueHtml = safe ? `<a href="${escHtml(safe)}" target="_blank" rel="noopener">${escHtml(v)}</a>` : escHtml(v);
  } else if (f.type === 'date') {
    valueHtml = escHtml(_cirFormatDate(v));
  } else if (f.type === 'number') {
    const n = Number(v);
    valueHtml = escHtml(isFinite(n) ? n.toLocaleString('en-PH') : String(v));
  } else if (f.type === 'select') {
    const lbl = _cirOptionLabel(f, v);
    valueHtml = escHtml(lbl != null ? lbl : v);
  } else if (f.type === 'textarea') {
    valueHtml = `<div style="white-space:pre-wrap">${escHtml(v)}</div>`;
  } else {
    valueHtml = escHtml(v); // text / tel / email
  }
  return `<tr><td style="width:38%;color:var(--text-muted)">${escHtml(f.label)}</td><td>${valueHtml}</td></tr>`;
}

function _cirRenderChipsBlock(f, sub, mode) {
  const vals = (sub.answers && sub.answers[f.key]) || [];
  const labels = vals.map(v => { const l = _cirOptionLabel(f, v); return l != null ? l : v; });
  let body;
  if (mode === 'print') {
    body = `<p style="font-size:11px;margin:2px 0 0">${escHtml(labels.join(', '))}</p>`;
  } else {
    body = labels.map(l => `<span class="badge badge-gray" style="margin:2px 4px 2px 0;display:inline-block">${escHtml(l)}</span>`).join('');
  }
  return `<div style="margin:8px 0"><div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;font-weight:600">${escHtml(f.label)}</div>${body}</div>`;
}

function _cirRenderTableBlock(f, sub) {
  const rows = (sub.answers && sub.answers[f.key]) || [];
  if (!rows.length) return '';
  const cols = f.columns || [];
  const thead = `<tr>${cols.map(c => `<th>${escHtml(c.label)}</th>`).join('')}</tr>`;
  const tbody = rows.map(r => `<tr>${cols.map(c => {
    const v = r[c.key];
    return `<td>${(v == null || v === '') ? '' : escHtml(String(v))}</td>`;
  }).join('')}</tr>`).join('');
  return `<div style="margin:8px 0"><div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;font-weight:600">${escHtml(f.label)}</div>
    <table class="data-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
}

// photoUrlMap (path → resolved URL) is required for mode:'print' (resolved
// up front by cirPrint, before the print doc is built); ignored for
// mode:'screen', which hydrates asynchronously via _cirHydratePhotos after
// the HTML below is injected into the DOM.
function _cirRenderPhotosBlock(f, sub, mode, photoUrlMap) {
  const photos = sub.photos || [];
  if (!photos.length) return '';
  const groups = f.groups || [];
  return groups.map(g => {
    const idxs = [];
    photos.forEach((ph, i) => { if (ph.group === g.key) idxs.push(i); });
    if (!idxs.length) return '';
    if (mode === 'print') {
      const tiles = idxs.map(i => {
        const ph = photos[i];
        const url = (photoUrlMap && photoUrlMap[ph.path]) || '';
        const imgHtml = url
          ? `<img src="${escHtml(url)}" alt="${escHtml(ph.caption || '')}">`
          : `<div style="width:100%;height:150px;border:1px solid #ccc;display:flex;align-items:center;justify-content:center;font-size:10px;color:#888">(photo unavailable)</div>`;
        return `<figure style="margin:0">${imgHtml}<figcaption>${escHtml(ph.caption || '')}</figcaption></figure>`;
      }).join('');
      return `<h4 style="margin:8px 0 4px">${escHtml(g.label)}</h4><div class="cir-ph-print">${tiles}</div>`;
    }
    const tiles = idxs.map(i => {
      const ph = photos[i];
      return `<button type="button" class="cir-ph" onclick="cirPreviewPhoto(${i})"
          style="display:flex;flex-direction:column;padding:0;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--surface);cursor:pointer;text-align:left">
        <div class="cir-ph-imgwrap" style="aspect-ratio:1;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--s1,rgba(255,255,255,.04))">
          <img data-cir-path="${escHtml(ph.path || '')}" alt="${escHtml(ph.caption || '')}" loading="lazy" style="width:100%;height:100%;object-fit:cover" />
        </div>
        ${ph.caption ? `<div style="font-size:11px;color:var(--text-muted);padding:4px 6px">${escHtml(ph.caption)}</div>` : ''}
      </button>`;
    }).join('');
    return `<div style="margin:8px 0"><div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;font-weight:600">${escHtml(g.label)} (${idxs.length})</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px">${tiles}</div></div>`;
  }).join('');
}

// Answer keys not defined by ANY section's fields (an older/newer
// formVersion) — never dropped, never crash the renderer, always escaped.
function _cirOtherAnswersHtml(def, sub, mode) {
  const known = {};
  (def.sections || []).forEach(sec => (sec.fields || []).forEach(f => { if (f.type !== 'photos') known[f.key] = true; }));
  const extra = Object.keys(sub.answers || {}).filter(k => !known[k]);
  if (!extra.length) return '';
  const rows = extra.map(k => `<tr><td style="width:38%;color:var(--text-muted)">${escHtml(k)}</td><td>${escHtml(JSON.stringify(sub.answers[k]))}</td></tr>`).join('');
  const title = 'Other answers (older form version)';
  if (mode === 'print') return `<section style="margin-bottom:14px"><h4>${escHtml(title)}</h4><table class="data-table cir-kv"><tbody>${rows}</tbody></table></section>`;
  return `<div class="card"><h4 style="margin-top:0">${escHtml(title)}</h4><table class="data-table cir-kv"><tbody>${rows}</tbody></table></div>`;
}
