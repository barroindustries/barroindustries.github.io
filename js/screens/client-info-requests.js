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

   TWO FORM VERSIONS (2026-10-22, spec §9). A brief renders with the definition it was SUBMITTED under — `window.CIR_FORMS[sub.formId]`:
   `commissary_brief` (the original, commissary-only questionnaire; every brief stored under it renders exactly as before) or
   `project_brief_v2` (the general project brief: a project type, common parts and ONE conditional part for that type). A section with
   `when: { key, in }` is shown only when the brief's own answer matches (the same rule as cir-core's sectionApplies — a brief can never
   hold an answer for another type's part, but should one ever turn up it is listed under "Other answers", never hidden). The list and
   the detail show the PROJECT TYPE prominently (summary.bizType holds its label; summary.location the city and province). Convert to
   client and Prefill Quote Builder read the facts they need through `_cirFacts` / `_cirClientAddress`, which work for both versions.

   QUOTES FROM A BRIEF (QUOTE-BUILDER-CONFIGURATOR-SPEC §6.2 / §8.3, 2026-10-28). Prefill Quote Builder opens the builder as a hand-off
   (company BK, lead source WB, the location code and purpose derived from the site and the project type, `sourceRef` naming this brief) —
   see _cirBuilderState; a brief has no item list, so it carries none. Filing a quote started there links it back (js/app.js
   linkQuoteToRequest): the brief lists its quotes (the Quotes card) and moves to Quoted — the status that sits between Contacted and Converted.

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
  quoted:     { cls: 'badge-teal',   label: 'Quoted' },        // 2026-10-28: a quote was filed from this brief (set by the Quote Builder link, or by staff)
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
let _cirStatusFilter = 'all';  // 'all' | 'new' | 'in_review' | 'contacted' | 'quoted' | 'converted' | 'archived'
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

// The definition a brief was submitted under — own keys only ('constructor' / '__proto__' are not forms).
function _cirDef(formId) {
  const all = window.CIR_FORMS;
  return (all && typeof formId === 'string' && Object.prototype.hasOwnProperty.call(all, formId)) ? all[formId] : null;
}
// A section with `when: { key, in: [...] }` applies only when the brief's own answer to `key` is one of the listed values (the SAME
// rule as functions/cir-core.js sectionApplies, which validated the brief on the way in). No `when` = always.
function _cirSectionApplies(sec, answers) {
  const w = sec && sec.when;
  if (!w) return true;
  const v = answers ? answers[w.key] : undefined;
  return typeof v === 'string' && Array.isArray(w.in) && w.in.indexOf(v) !== -1;
}
function _cirFindField(def, key) {
  let found = null;
  ((def && def.sections) || []).forEach(sec => (sec.fields || []).forEach(f => { if (!found && f.key === key) found = f; }));
  return found;
}
// The facts the list, the detail header, Convert and the notes need — from the summary the server built, falling back to the answers
// (so it works for a brief of either form version, and for one whose summary is thin).
function _cirFacts(sub, def) {
  const s = sub.summary || {}, a = sub.answers || {};
  let type = s.bizType || a.biz_type || '';
  if (!type && a.project_type) { const f = _cirFindField(def, 'project_type'); const l = f ? _cirOptionLabel(f, a.project_type) : null; type = l != null ? l : String(a.project_type); }
  const scopeField = _cirFindField(def, 'scope');
  const scope = Array.isArray(a.scope) ? a.scope.map(v => { const l = scopeField ? _cirOptionLabel(scopeField, v) : null; return l != null ? l : String(v); }) : [];
  // The budget the CLIENT stated. v1 stores its (string) option as the answer; v2 stores a band KEY and puts the band's LABEL in the summary, so a
  // brief whose summary is thin is resolved through the definition (an unknown key is shown as it is, never hidden). Empty when they gave none.
  let budget = s.budget || '';
  if (!budget && a.budget) { const bf = _cirFindField(def, 'budget'); const l = bf ? _cirOptionLabel(bf, a.budget) : null; budget = l != null ? l : String(a.budget); }
  return {
    type: type,
    location: s.location || s.siteAddress || a.site_address || '',   // v2: "City, Province"; v1: the site address
    street: s.location ? (s.siteAddress || '') : '',                  // v2's optional street / landmark
    target: s.targetDate || a.target_date || '',
    budget: budget,
    scope: scope
  };
}
// The address to put on a client record / quote: v1 has the client's own office address; v2 asks only where the project is.
function _cirClientAddress(sub) {
  const s = sub.summary || {}, a = sub.answers || {};
  if (a.address) return a.address;
  return [s.siteAddress, s.location].filter(Boolean).join(', ') || a.site_address || '';
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
      <input type="text" id="cir-search" placeholder="Search ref, company, name, project type, place…"
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
  const counts = { all: _cirRows.length, new: 0, in_review: 0, contacted: 0, quoted: 0, converted: 0, archived: 0 };
  _cirRows.forEach(r => { if (counts[r.status] != null) counts[r.status]++; });
  const items = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'new', label: 'New', count: counts.new },
    { key: 'in_review', label: 'In review', count: counts.in_review },
    { key: 'contacted', label: 'Contacted', count: counts.contacted },
    { key: 'quoted', label: 'Quoted', count: counts.quoted },
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
      const hay = [r.id, s.company, s.name, s.email, s.phone, s.bizType, s.location].map(x => (x || '').toLowerCase()).join(' ');
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
        <td class="tc-name"><strong>${escHtml(s.company || s.name || '')}</strong><div style="font-size:11px;color:var(--text-muted)">${[s.company ? s.name : '', s.phone, s.email].filter(Boolean).map(escHtml).join(' · ')}</div></td>
        <td class="tc-detail" data-label="Project type">${s.bizType ? `<span class="badge badge-blue" style="font-size:12px;white-space:normal">${escHtml(s.bizType)}</span>` : ''}${s.budget ? `<div style="font-size:11px;color:var(--text-muted);margin-top:3px">Budget ${escHtml(s.budget)}</div>` : ''}</td>
        <td class="tc-detail" data-label="Location">${escHtml(s.location || s.siteAddress || '')}</td>
        <td class="tc-detail" data-label="Target">${escHtml(_cirFormatDate(s.targetDate || ''))}</td>
        <td class="tc-detail" data-label="Photos">${Number(s.photoCount) || 0}</td>
        <td class="tc-net">${cirStatusPill(r.status)}</td>
      </tr>`;
  }).join('');
  return `
    <div class="table-wrap"><table class="data-table table-cards">
      <thead><tr><th>Ref</th><th>Received</th><th>Company / Contact</th><th>Project type</th><th>Location</th><th>Target</th><th>Photos</th><th>Status</th></tr></thead>
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

// ── Quotes filed from this brief (QUOTE-BUILDER-CONFIGURATOR-SPEC §8.3) ───────────────────────────────────────────────────────────────
// `quotes[]` is written by the staff session that files a quote started from this brief (js/app.js linkQuoteToRequest — newest LAST, at most
// 50) and its entries' status by respondToQuote when the client answers. Every entry is rendered as untrusted text: the document is writable by
// any Sales user, so `coll` must be one of the two quote collections and `docId` a plain id before either goes into the Open handler (and the
// handler is the existing reopenQuoteFromDoc, which only the quote's author or an admin can complete — it says so). The amount is staff-only:
// the view-only role (the Corporate Secretary) sees the number, the status and the date, and has no Open.
const CIR_QUOTE_STATUS_META = {
  filed:            { cls: 'badge-blue',   label: 'Filed' },
  pending_approval: { cls: 'badge-orange', label: 'Awaiting approval' },
  accepted:         { cls: 'badge-green',  label: 'Accepted' },
  needs_revision:   { cls: 'badge-amber',  label: 'Changes requested' }
};
const CIR_QUOTE_COLLS = { bk_quotes: 'bk-quote-builder', bs_quotes: 'bs-quote-builder' };   // collection -> the builder page that edits it
function _cirQuoteStatusPill(status) {
  const known = typeof status === 'string' && Object.prototype.hasOwnProperty.call(CIR_QUOTE_STATUS_META, status);
  const m = known ? CIR_QUOTE_STATUS_META[status] : { cls: 'badge-gray', label: (typeof status === 'string' && status) ? status : 'unknown' };
  return `<span class="badge ${m.cls}">${escHtml(m.label)}</span>`;
}
// An ISO instant string (the entry's filedAt) -> '12 Nov 2026' in Manila time; '' for anything that is not a date.
function _cirQuotedOn(iso) {
  if (typeof iso !== 'string' || !iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : _cirFormatDate(window.bizDate(d));
}
function _cirQuotesCardHtml(sub, canWrite) {
  const list = (Array.isArray(sub && sub.quotes) ? sub.quotes : []).filter(q => q && typeof q === 'object');
  if (!list.length) {
    return `<div class="card" style="margin-top:12px;padding:14px 16px"><h4 style="margin-top:0">Quotes</h4><p style="font-size:12px;color:var(--text-muted);margin:0">${canWrite ? 'No quote yet — Prefill Quote Builder.' : 'No quote yet.'}</p></div>`;
  }
  const rows = list.slice().reverse().map(q => {                       // newest first
    const coll = (typeof q.coll === 'string' && Object.prototype.hasOwnProperty.call(CIR_QUOTE_COLLS, q.coll)) ? q.coll : '';
    const docId = (typeof q.docId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(q.docId)) ? q.docId : '';
    const openHtml = (coll && docId)                                      // (the actions cell below is staff-only — the view-only role gets no cell at all)
      ? `<button type="button" class="btn-secondary btn-sm" onclick="reopenQuoteFromDoc('${coll}','${docId}','${CIR_QUOTE_COLLS[coll]}')">Open</button>` : '';
    const ver = Math.floor(Number(q.version));
    const total = (typeof q.total === 'number' && isFinite(q.total)) ? '₱' + q.total.toLocaleString('en-PH') : '';
    const filed = _cirQuotedOn(q.filedAt);
    // table-cards.no-toggle (css/styles.css §5): on a phone each quote is a card of label:value lines with Open (staff only) as the trailing
    // action, instead of a table the staff must scroll sideways to reach Open. Each value sits in ONE span so the flex row keeps it together.
    return `<tr>
      <td data-label="Quote"><span><span style="font-family:monospace">${escHtml(q.quoteNumber || '—')}</span>${ver >= 1 ? ` <span style="font-size:11px;color:var(--text-muted)">v${ver}</span>` : ''}</span></td>
      <td data-label="Status">${_cirQuoteStatusPill(q.status)}</td>
      ${canWrite ? `<td data-label="Total" style="text-align:right"><span style="white-space:nowrap">${escHtml(total)}</span></td>` : ''}
      <td data-label="Filed"><span>${escHtml(filed)}${q.byName ? ` <span style="font-size:11px;color:var(--text-muted)">· ${escHtml(q.byName)}</span>` : ''}</span></td>
      ${canWrite ? `<td class="tc-actions" style="text-align:right">${openHtml}</td>` : ''}
    </tr>`;
  }).join('');
  const head = `<tr><th>Quote</th><th>Status</th>${canWrite ? '<th style="text-align:right">Total</th>' : ''}<th>Filed</th>${canWrite ? '<th></th>' : ''}</tr>`;
  return `<div class="card" style="margin-top:12px;padding:14px 16px"><h4 style="margin-top:0">Quotes (${list.length})</h4><table class="data-table table-cards no-toggle"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}

function _cirRenderDetail() {
  const root = _cirContainer || deptContainer();
  const sub = _cirCurrent;
  if (!root || !sub) return;
  const def = _cirDef(sub.formId);
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

  const statusOptions = [['new', 'New'], ['in_review', 'In review'], ['contacted', 'Contacted'], ['quoted', 'Quoted'], ['converted', 'Converted'], ['archived', 'Archived']];
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
    <div class="card" style="padding:14px 16px"><h4 style="margin-top:0">Consent</h4>
      <p style="font-size:13px">Data-privacy consent given ${escHtml(_cirManilaDT(consent.consentedAt))} &middot; notice v${escHtml(consent.noticeVersion || '')}</p>
    </div>`;

  let technicalHtml = '';
  if (isSeniorStaff) {
    const client = sub.client || {};
    technicalHtml = `
      <details class="card" style="padding:14px 16px"><summary style="cursor:pointer;font-weight:700">Technical details</summary>
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
  const facts = _cirFacts(sub, def);
  const typePill = facts.type ? `<span class="badge badge-blue" style="font-size:13px;padding:3px 10px;white-space:normal;vertical-align:middle">${escHtml(facts.type)}</span>` : '';
  const glanceHtml = _cirGlanceHtml(facts);

  root.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px">
      <button class="btn-icon" onclick="cirBackToList()" title="Back">${emojiIcon('arrow-left', 18)}</button>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:16px">${escHtml(s.company || s.name || '')} ${typePill}</div>
        <div style="font-size:12px;color:var(--text-muted)">${contactBits.join(' &middot; ')}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
          <span style="font-family:monospace">${escHtml(sub.id)}</span> &middot;
          ${escHtml(sub.submittedOnManila || '')} (${escHtml(cirAge(sub.createdAt))}) ${cirStatusPill(sub.status)}
        </div>
      </div>
    </div>
    <div class="card" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:14px 16px">
      ${statusSelectHtml}${convertHtml}${prefillHtml}${printHtml}${deleteHtml}
    </div>
    ${_cirQuotesCardHtml(sub, canWrite)}
    ${glanceHtml}
    <div style="margin-top:12px">${bodyHtml}</div>
    ${consentHtml}
    ${technicalHtml}
    ${notesHtml}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [root] });
  _cirHydratePhotos(root);
}

// The brief at a glance, above the full answers: what kind of project, where, when, and what is wanted. Every value is escaped.
function _cirGlanceHtml(facts) {
  const cell = (label, inner) => `<div style="min-width:0"><div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);margin-bottom:3px">${escHtml(label)}</div>${inner}</div>`;
  const cells = [];
  cells.push(cell('Project type', `<div style="font-size:17px;font-weight:700">${escHtml(facts.type || '—')}</div>`));
  cells.push(cell('Location', `<div>${escHtml(facts.location || '—')}</div>${facts.street ? `<div style="font-size:12px;color:var(--text-muted)">${escHtml(facts.street)}</div>` : ''}`));
  if (facts.target) cells.push(cell('Timing', `<div>${escHtml(_cirFormatDate(facts.target))}</div>`));
  if (facts.budget) cells.push(cell('Budget', `<div>${escHtml(facts.budget)}</div>`));   // v1: the client's chosen range; v2: the band the client chose (optional) — either way theirs, never a Barro figure
  const scope = facts.scope.length
    ? `<div style="margin-top:12px">${cell('Wants', facts.scope.map(l => `<span class="badge badge-gray" style="margin:2px 4px 2px 0;display:inline-block">${escHtml(l)}</span>`).join(''))}</div>`
    : '';
  return `<div class="card" style="margin-top:12px;padding:14px 16px"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px">${cells.join('')}</div>${scope}</div>`;
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
  return `<div class="card" style="padding:14px 16px"><h4 style="margin-top:0">Notes</h4>${rows}${addForm}</div>`;
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
    const facts = _cirFacts(sub, _cirDef(sub.formId));
    const briefNote = ('Client brief ' + refNo + ' (' + (sub.submittedOnManila || '') + '): ' +
      [facts.type, facts.location ? 'site: ' + facts.location : '', facts.budget ? 'budget: ' + facts.budget : '',
        facts.target ? 'target: ' + _cirFormatDate(facts.target) : '', facts.scope.length ? 'scope: ' + facts.scope.join(', ') : ''].filter(Boolean).join(' · ')).slice(0, 1000);

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

// The state window._qbReopenState carries into the builder (QUOTE-BUILDER-CONFIGURATOR-SPEC §6.2) — a pure function of the brief. A brief has no
// item list, so there are none; everything else is what a website lead is: a Barro Kitchens quote (BK) from the Website lead source (WB).
//   qnoLoc    the quote-number location code from where the project is (_cirFacts().location: v2 "City, Province", v1 the site address)
//   purpose   v2: the project type the client chose (answers.project_type); v1: a keyword scan of the free-text business type (summary.bizType)
//   sourceRef what the builder's hand-off bar shows (the brief, its project type, the budget band the CLIENT chose, the target date, how many
//             photos); only { kind, ref } of it is ever filed on the quote. There is no estimate for a brief. A reference that is not a real
//             one (the server never mints one) gets no link at all.
//   handoff   makes the builder boot as an authoritative load (js/app.js _qbIsAuthoritativeLoad)
const CIR_REF_RE = /^CIR-\d{6}-[A-Z0-9]{6}$/;
function _cirBuilderState(sub) {
  const QB = window.QBConfigured;
  const s = sub.summary || {};
  const a = sub.answers || {};
  const facts = _cirFacts(sub, _cirDef(sub.formId));
  const state = {
    clientName: s.name || '',
    clientCompany: s.company || '',
    clientAddress: _cirClientAddress(sub),
    clientPhone: s.phone || '',
    clientEmail: s.email || '',
    currentCo: 'BK',
    qnoMethod: 'WB',
    qnoLoc: QB.locationCodeFor(facts.location),
    purpose: QB.purposeFor(a.project_type ? { cirProjectType: a.project_type } : { cirBizType: s.bizType || a.biz_type || '' }),
    handoff: true
  };
  if (typeof sub.id === 'string' && CIR_REF_RE.test(sub.id)) {
    state.sourceRef = {
      kind: 'cir',
      ref: sub.id,
      projectType: facts.type,
      budget: facts.budget,
      targetDate: facts.target,
      photosCount: Number(s.photoCount) || 0,
      estimate: null
    };
  }
  return state;
}

window.cirPrefillQuote = function (refNo) {
  if (!cirCanWrite()) return;
  const sub = (_cirCurrent && _cirCurrent.id === refNo) ? _cirCurrent : null;
  if (!sub) return;
  // QBConfigured is a lazy script of this page (js/config.js PAGE_SCRIPTS): without it the location code and purpose cannot be derived.
  if (!window.QBConfigured) { Notifs.showToast('The quote builder helpers did not load — reload the app and try again.', 'error'); return; }
  window._qbReopenState = _cirBuilderState(sub);
  window._qbReopenAsRevision = false;
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
    const def = _cirDef(sub.formId);
    const s = sub.summary || {};
    const company = s.company || s.name || '';
    const photos = sub.photos || [];
    const urlMap = {};
    await Promise.all(photos.map(ph => {
      if (!ph.path) return Promise.resolve();
      return cirPhotoUrl(ph.path).then(url => { urlMap[ph.path] = url || ''; });
    }));

    const userName = (window.userProfile && window.userProfile.displayName) || '';
    const lh = window.buildLetterhead ? window.buildLetterhead({
      orientation: 'portrait',
      docTitle: String((def && def.eyebrow) || 'Client information request').toUpperCase(),      // "PROJECT BRIEF" (v2) / "CLIENT INFORMATION REQUEST" (v1)
      dateLabel: 'Received ' + (sub.submittedOnManila || ''),
      extraMeta: [refNo, company, _cirFacts(sub, def).type].filter(Boolean),
      signatures: [{ label: 'Reviewed by', name: userName, title: 'Sales' }],
      footerNote: 'Barro Industries Operating System · Generated ' + new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) + ' · Contains personal data (RA 10173) — handle accordingly.'
    }) : null;

    const consent = sub.consent || {};
    // the consent line of the notice version this visitor actually ticked (a v1 brief shows the original wording)
    const notices = window.CIR_NOTICES || {};
    const noticeUsed = (typeof consent.noticeVersion === 'string' && Object.prototype.hasOwnProperty.call(notices, consent.noticeVersion)) ? notices[consent.noticeVersion] : window.CIR_PRIVACY_NOTICE;
    const consentLine = (noticeUsed && noticeUsed.consentLine) || '';
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
  // only the parts that apply to THIS brief (a hospital brief shows the hospital part, not the other eight), numbered in order
  const parts = (def.sections || []).filter(sec => _cirSectionApplies(sec, sub.answers));
  let html = parts.map((sec, i) => _cirRenderSection(sec, i + 1, sub, mode, photoUrlMap)).join('');
  html += _cirOtherAnswersHtml(parts, sub, mode);
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
  return `<div class="card" style="padding:14px 16px"><h4 style="margin-top:0">${idx}. ${escHtml(sec.title)}</h4>${inner}</div>`;
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
  // Defensive: a truthy NON-array here (a bare string from a future
  // formVersion, a hand-edited doc, an import) used to reach .map() and throw,
  // and cirOpen()'s outer catch turned that into an error card with no status,
  // notes, photos or delete reachable for the whole brief. The public path
  // can't produce it (cir-core validateAnswers coerces), so this is
  // defence in depth for everything that isn't the public path.
  const raw = sub.answers && sub.answers[f.key];
  const vals = Array.isArray(raw) ? raw : [];
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
  // Same defence as _cirRenderChipsBlock above.
  const rawRows = sub.answers && sub.answers[f.key];
  const rows = Array.isArray(rawRows) ? rawRows : [];
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

// Answer keys not shown by any PART that applies to this brief (an older/newer formVersion, or — which the server never lets in — an
// answer belonging to another project type's part) — never dropped, never crash the renderer, always escaped.
function _cirOtherAnswersHtml(parts, sub, mode) {
  const known = {};
  (parts || []).forEach(sec => (sec.fields || []).forEach(f => { if (f.type !== 'photos') known[f.key] = true; }));
  const extra = Object.keys(sub.answers || {}).filter(k => !known[k]);
  if (!extra.length) return '';
  const rows = extra.map(k => `<tr><td style="width:38%;color:var(--text-muted)">${escHtml(k)}</td><td>${escHtml(JSON.stringify(sub.answers[k]))}</td></tr>`).join('');
  const title = 'Other answers (older form version)';
  if (mode === 'print') return `<section style="margin-bottom:14px"><h4>${escHtml(title)}</h4><table class="data-table cir-kv"><tbody>${rows}</tbody></table></section>`;
  return `<div class="card" style="padding:14px 16px"><h4 style="margin-top:0">${escHtml(title)}</h4><table class="data-table cir-kv"><tbody>${rows}</tbody></table></div>`;
}
