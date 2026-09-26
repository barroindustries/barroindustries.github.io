/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Client Portals (internal control screen)
   js/screens/client-portals.js

   NEW 2026-09-26 (CLIENT-PORTAL-CHIBABS-SPEC.md §6/§6.1, WS-C of a
   three-workstream build). This is the President/admin-side control screen
   for the client-facing signing + progress portal (the public page is a
   separate standalone file at projects/<client>/<page>/index.html, owned by
   WS-A; the four asia-east1 callables + firestore.rules/storage.rules
   additions are WS-B's — see functions/portal-core.js).

   Generalises to future clients: this screen never hardcodes any single
   client's name or content — every client's proposal content is imported
   per-portal via pasted JSON (§6 item 2). The first client's import JSON
   lives OUTSIDE this repo, under ~/Desktop/<client>/ (D6 of the spec:
   GitHub Pages serves this repo verbatim, so a client's contract price
   must never be committed here). Neil pastes that file's contents into the
   Import panel from his own machine — this repo never sees it.

   Role gate (owner ruling): president/manager/secretary may VIEW; only
   president/manager may WRITE. Secretary is view-only everywhere in this
   codebase (Corporate Secretary = view-only approvals) — every write
   control below is hidden for that role, matching what firestore.rules
   enforces (isAdmin() read / isSeniorAdmin() write). The `accountAdmin`
   flag (users.accountAdmin) is an unrelated account-management power and
   plays no part in this screen's gating.

   Load-order / idiom: plain window.*-attached classic script, lazy-loaded
   via js/config.js PAGE_SCRIPTS['client-portals'] the first time the page
   is navigated to (js/app.js navigateTo 'client-portals' case) — same
   convention as every other js/screens/*.js file (see inventory.js/todo.js
   headers). window.renderClientPortals() takes no arguments and reads
   window.currentRole / window.currentUser / window.userProfile itself.

   Data model (frozen interface, §1 of the spec — read from and write to
   these field names exactly, do not invent new ones):
     client_portals/{portalId}                         — the portal doc
     client_portals/{portalId}/acceptances/{refNo}      — CF-only, read-only here
     client_portals/{portalId}/events/{eventId}         — append-only audit log
     client_portals/{portalId}/updates/{updateId}       — progress notes/photos
     client_portal_outbox/{refNo}                       — manual-send queue
   client_portal_secrets / client_portal_sessions / client_portal_ratelimit
   have NO rules match at all — this screen never touches them; the only
   door to the secret is the portalAdminRotateCode callable's one-time
   plaintext response.

   Every staff-initiated write also appends its own `events` doc (rules:
   create-only, actor.uid == auth.uid, at == request.time) alongside
   window.logAudit(), per §6's "Fire window.logAudit(...) alongside the
   portal's own events doc for every write." The events `kind` enum in the
   spec (§1.3) does not include a value for "portal created" or "content
   imported" — this file reuses 'status_set' for creation (detail:{to:'draft',
   created:true}) and adds a 'content_imported' kind for the JSON import
   (not in the documented enum; flagged to the coordinator — rules do not
   validate the `kind` string so this is non-blocking).

   SPEC AMBIGUITY FLAGGED (resolved locally, see report): §6 item 2 says the
   importer "rejects any item key matching /cost|margin|markup|price|
   subtotal|qty|quantity/i" — but §1.1's own item shape includes `atCost`
   (bool), which contains the substring "cost" and would be rejected by a
   literal reading of that regex, making the frozen schema's own field
   unimportable. This file's validator special-cases the two schema-defined
   boolean flags (`atCost`, `optional`) as always-allowed and applies the
   forbidden-word regex to every other key, which satisfies the evident
   intent (block invented money fields) without contradicting §1.1.
   ═══════════════════════════════════════════════════ */

'use strict';

// ── Local constants ──────────────────────────────────────────────────────
const CP_STEP_COUNT = 8;
// Coordinator correction 2026-09-26: the spec's §6 item 2 regex omitted
// "amount" (and total/rate/disc), which §1.1's own items row explicitly
// forbids ("No qty, unitPrice, amount, cost, subtotal keys, ever" — a
// per-item AMOUNT is exactly the invented-price hazard this exists to
// block). Scoped to `items` entries only — milestones[].amount and
// payments[].amount are legitimate money fields elsewhere in the doc and
// must never be run through this filter.
const CP_ITEM_FORBIDDEN_KEY_RE = /cost|margin|markup|price|subtotal|qty|quantity|amount|total|rate|disc/i;
const CP_ITEM_ALWAYS_ALLOWED_KEYS = new Set(['no', 'name', 'dims', 'spec', 'zoneNo', 'utilities', 'atCost', 'optional']);
const CP_ZONE_COLOR = { cook: '#E5484D', prep: '#F0B429', store: '#3B82F6', dish: '#38BDF8', foh: '#8B5CF6', opt: '#8E8E93' };

// ── Module-local state (repainted on every tab/nav change — no persistence
// needed beyond the current visit, same pattern as todo.js's _todo* state) ──
let _cpView = 'list';          // 'list' | 'detail'
let _cpPortals = [];           // cached list rows
let _cpCurrentId = null;       // portalId of the open detail view
let _cpCurrentPortal = null;   // full doc of the open detail view
let _cpTab = 'Overview';
let _cpNewPortalOpen = false;
let _cpImportOpen = false;
let _cpAddPaymentOpen = false;

// ── Entry point ──────────────────────────────────────────────────────────
window.renderClientPortals = async function () {
  const c = deptContainer();
  if (!['president', 'manager', 'secretary'].includes(window.currentRole)) {
    c.innerHTML = `
      <div class="page-header"><div><h2>${emojiIcon('lock', 20)} Client Portals</h2></div></div>
      <div class="empty-state"><p>You don't have access to this screen.</p></div>`;
    if (window.lucide) lucide.createIcons({ nodes: [c] });
    return;
  }
  const canWrite = ['president', 'manager'].includes(window.currentRole);
  _cpView = 'list';
  _cpCurrentId = null;
  _cpCurrentPortal = null;
  c.innerHTML = `
    <div class="page-header">
      <div>
        <h2>${emojiIcon('file-signature', 20)} Client Portals</h2>
        <p style="font-size:12px;color:var(--text-muted);margin:2px 0 0">Client signing + progress portals — access code gated, no automated email</p>
      </div>
    </div>
    ${window.sopPanel('How Client Portals works', [
      'Each client gets one portal: a client slug + page slug (e.g. chibabs / projectconfirmation) that maps to a static page under projects/&lt;client&gt;/&lt;page&gt;/ on the live site.',
      'Import that client’s proposal content as JSON (figures, milestones, zones, equipment, terms) — the page never invents a number, so per-item pricing never appears there.',
      'Generate an access code and hand it to the client out-of-band (phone/in person) — the code is shown exactly once, never stored in readable form.',
      'Go live once content is imported and a code exists. The client enters the code on the public page and signs; you get a notification + push the moment they do.',
      'There is no automated email — use the Manual send panel (mailto / Gmail / copy) after a signature lands.',
      'Progress, Payments and Updates on the tabs below drive what the client sees on their own progress view after signing.'
    ])}
    <div id="cp-root">${window.skeletonHtml('cards')}</div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });
  await _cpLoadList(canWrite);
};

// ── Shared fetchers ──────────────────────────────────────────────────────
async function _cpFetchPortals() {
  const snap = await db.collection('client_portals').orderBy('createdAt', 'desc').limit(200).get();
  return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
}
async function _cpFetchOutboxPending() {
  const snap = await db.collection('client_portal_outbox').where('status', '==', 'pending').limit(50).get();
  return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
}
function _cpInvalidate(portalId) {
  window.dbCacheInvalidate('client_portals');
  if (portalId) window.dbCacheInvalidate('client_portal:' + portalId);
}

// ── Staff audit event (best-effort, alongside window.logAudit) ───────────
function _cpEvent(portalId, kind, detail) {
  try {
    db.collection('client_portals').doc(portalId).collection('events').add({
      at: firebase.firestore.FieldValue.serverTimestamp(),
      kind: kind,
      actor: {
        type: 'staff',
        uid: (window.currentUser && window.currentUser.uid) || null,
        name: (window.userProfile && window.userProfile.displayName) || (window.currentUser && window.currentUser.email) || 'staff'
      },
      detail: detail || {}
    }).catch(() => {});
  } catch (_) { /* never throw */ }
  window.logAudit('update', 'client_portal', portalId, Object.assign({ kind: kind }, detail || {}));
}

// ── Small formatting helpers ──────────────────────────────────────────────
function _cpStatusPill(status) {
  const map = {
    draft: { cls: 'badge-gray', label: 'Draft' },
    live: { cls: 'badge-green', label: 'Live' },
    signed: { cls: 'badge-blue', label: 'Signed' },
    closed: { cls: 'badge-red', label: 'Closed' }
  };
  const m = map[status] || { cls: 'badge-gray', label: status || 'unknown' };
  return `<span class="badge ${m.cls}">${escHtml(m.label)}</span>`;
}
function _cpDaysLeft(validUntil) {
  if (!validUntil) return '';
  const today = window.bizDate();
  const days = Math.round((new Date(validUntil + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
  if (days < 0) return `<span class="badge badge-red">EXPIRED</span>`;
  return `<span class="badge badge-orange">${days}d left</span>`;
}

/* ══════════════════════ LIST VIEW ══════════════════════ */

async function _cpLoadList(canWrite) {
  const root = document.getElementById('cp-root');
  if (!root) return;
  try {
    const [portals, outbox] = await Promise.all([
      window.dbCachedGet('client_portals', _cpFetchPortals, 30000),
      _cpFetchOutboxPending().catch(() => [])
    ]);
    _cpPortals = portals || [];
    root.innerHTML = _cpRenderList(_cpPortals, outbox || [], canWrite);
    if (window.lucide) lucide.createIcons({ nodes: [root] });
  } catch (e) {
    root.innerHTML = `<div class="empty-state"><p>Could not load portals — ${escHtml(e.message || String(e))}</p></div>`;
  }
}

function _cpRenderList(portals, outbox, canWrite) {
  const newPanel = canWrite ? _cpRenderNewPortalForm() : '';
  const outboxBanner = outbox.length ? `
    <div class="alert-card" style="border-color:var(--warning,#F0B429);margin-bottom:16px">
      <strong>${outbox.length} confirmation${outbox.length > 1 ? 's' : ''} waiting to be sent</strong>
      <p style="font-size:12px;color:var(--text-muted);margin:4px 0 0">Open a signed portal's Signature tab to send the manual confirmation.</p>
    </div>` : '';
  const cards = portals.length ? portals.map(p => _cpRenderListCard(p)).join('') :
    `<div class="empty-state"><p>No portals yet.${canWrite ? ' Create one below.' : ''}</p></div>`;
  return `
    ${outboxBanner}
    ${canWrite ? `<button class="btn-secondary" onclick="cpToggleNewPortal()" style="margin-bottom:12px">${emojiIcon('plus', 16)} New portal</button>` : ''}
    ${newPanel}
    <div class="cp-card-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">${cards}</div>
  `;
}

function _cpRenderListCard(p) {
  const proposal = p.proposal || {};
  const client = p.client || {};
  const step = (p.progress && p.progress.currentStep) || 0;
  const ref = (p.acceptance && p.acceptance.refNo) || '';
  return `
    <div class="card" style="cursor:pointer" onclick="cpOpenPortal('${escHtml(p.id)}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div>
          <div style="font-weight:700">${escHtml(client.company || client.name || p.id)}</div>
          <div style="font-size:12px;color:var(--text-muted)">${escHtml(proposal.number || '—')}</div>
        </div>
        ${_cpStatusPill(p.status)}
      </div>
      <div style="margin-top:8px;font-size:12px;color:var(--text-muted)">
        Step ${step}/${CP_STEP_COUNT}${ref ? ` · Ref ${escHtml(ref)}` : ''}
      </div>
    </div>`;
}

function _cpRenderNewPortalForm() {
  if (!_cpNewPortalOpen) return '';
  return `
    <div class="card" style="margin-bottom:12px">
      <h4 style="margin-top:0">New portal</h4>
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="form-group"><label>Client slug</label><input id="cp-new-clientslug" placeholder="chibabs" /></div>
        <div class="form-group"><label>Page slug</label><input id="cp-new-pageslug" placeholder="projectconfirmation" /></div>
      </div>
      <div id="cp-new-urlpreview" style="font-size:12px;color:var(--text-muted);margin:4px 0 10px;font-family:monospace"></div>
      <div class="form-group"><label>Client / company name</label><input id="cp-new-company" placeholder="Company Name Inc." /></div>
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="form-group"><label>Contact name</label><input id="cp-new-contact" placeholder="Juan Dela Cruz" /></div>
        <div class="form-group"><label>Address</label><input id="cp-new-address" placeholder="Site address" /></div>
      </div>
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="form-group"><label>Proposal number</label><input id="cp-new-propno" placeholder="BKMLVB…" /></div>
        <div class="form-group"><label>Proposal title</label><input id="cp-new-proptitle" placeholder="Commercial Kitchen Proposal" /></div>
      </div>
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="form-group"><label>Date issued</label><input id="cp-new-issuedon" type="date" value="${window.bizDate()}" /></div>
        <div class="form-group"><label>Valid until</label><input id="cp-new-validuntil" type="date" /></div>
      </div>
      <p style="font-size:12px;color:var(--text-muted)">The page folder <code>projects/&lt;client&gt;/&lt;page&gt;/index.html</code> must exist in the repo (copy an existing client portal page's folder).</p>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn-primary" onclick="cpCreatePortal()">Create portal</button>
        <button class="btn-secondary" onclick="cpToggleNewPortal()">Cancel</button>
      </div>
    </div>
  `;
}

window.cpToggleNewPortal = function () {
  _cpNewPortalOpen = !_cpNewPortalOpen;
  const canWrite = ['president', 'manager'].includes(window.currentRole);
  _cpLoadList(canWrite);
  if (_cpNewPortalOpen) _cpBindNewPortalPreview();
};

function _cpBindNewPortalPreview() {
  const cs = document.getElementById('cp-new-clientslug');
  const ps = document.getElementById('cp-new-pageslug');
  const prev = document.getElementById('cp-new-urlpreview');
  if (!cs || !ps || !prev) return;
  const upd = () => {
    const c = (cs.value || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    const p = (ps.value || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
    prev.textContent = (c && p) ? `https://barroindustries.com/projects/${c}/${p}/  →  portalId: ${c}__${p}` : 'Enter both slugs to preview the URL and portal id.';
  };
  cs.addEventListener('input', upd);
  ps.addEventListener('input', upd);
  upd();
}

window.cpCreatePortal = async function () {
  const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const clientSlug = val('cp-new-clientslug').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const pageSlug = val('cp-new-pageslug').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const slugRe = /^[a-z0-9-]{2,40}$/;
  if (!slugRe.test(clientSlug) || !slugRe.test(pageSlug)) {
    Notifs.showToast('Client slug and page slug must each be 2–40 lowercase letters/digits/hyphens', 'error');
    return;
  }
  const portalId = `${clientSlug}__${pageSlug}`;
  const company = val('cp-new-company');
  const contactName = val('cp-new-contact');
  const address = val('cp-new-address');
  const propNo = val('cp-new-propno');
  const propTitle = val('cp-new-proptitle');
  const issuedOn = val('cp-new-issuedon') || window.bizDate();
  const validUntil = val('cp-new-validuntil');
  if (!company || !propNo) {
    Notifs.showToast('Company name and proposal number are required', 'error');
    return;
  }
  try {
    const existing = await db.collection('client_portals').doc(portalId).get();
    if (existing.exists) { Notifs.showToast('A portal with that client/page slug already exists', 'error'); return; }
    await db.collection('client_portals').doc(portalId).set({
      status: 'draft',
      sessionsGeneration: 1,
      client: { name: contactName, company: company, contactName: contactName, address: address },
      proposal: { number: propNo, title: propTitle, issuedOn: issuedOn, validUntil: validUntil || null },
      acceptance: null,
      progress: { currentStep: 0, steps: {} },
      payments: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: (window.currentUser && window.currentUser.uid) || null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: (window.currentUser && window.currentUser.uid) || null
    });
    _cpEvent(portalId, 'status_set', { to: 'draft', created: true });
    _cpInvalidate(portalId);
    _cpNewPortalOpen = false;
    Notifs.showToast('Portal created as draft', 'success');
    await cpOpenPortal(portalId);
  } catch (e) {
    Notifs.showToast('Could not create portal: ' + (e.message || e), 'error');
  }
};

/* ══════════════════════ DETAIL VIEW ══════════════════════ */

window.cpOpenPortal = async function (portalId) {
  _cpView = 'detail';
  _cpCurrentId = portalId;
  _cpTab = 'Overview';
  const c = deptContainer();
  c.innerHTML = `<div id="cp-root">${window.skeletonHtml('rows')}</div>`;
  await _cpLoadDetail(portalId);
};

async function _cpFetchPortalDoc(portalId) {
  const doc = await db.collection('client_portals').doc(portalId).get();
  if (!doc.exists) throw new Error('Portal not found');
  return Object.assign({ id: doc.id }, doc.data());
}

async function _cpLoadDetail(portalId) {
  const root = document.getElementById('cp-root');
  if (!root) return;
  try {
    const portal = await window.dbCachedGet('client_portal:' + portalId, () => _cpFetchPortalDoc(portalId), 15000);
    _cpCurrentPortal = portal;
    root.innerHTML = _cpRenderDetail(portal);
    if (window.lucide) lucide.createIcons({ nodes: [root] });
    window.bindChipTabs(root, (key) => { _cpTab = key; _cpRepaintTabBody(); });
    await _cpRenderTabBody(portal);
  } catch (e) {
    root.innerHTML = `<div class="empty-state"><p>${escHtml(e.message || String(e))}</p>
      <button class="btn-secondary" onclick="cpBackToList()">Back to list</button></div>`;
  }
}

window.cpBackToList = function () {
  window.renderClientPortals();
};

// The detail header's sub-line (proposal no. + status pill + contract total).
// Extracted so _cpRepaintTabBody can refresh it after a status change: the
// handlers refetch _cpCurrentPortal but used to repaint only the tab body,
// leaving the header pill reading "Draft" after Go live until a full reload
// (owner-visible: it looks like the portal never went live).
function _cpDetailSubHtml(p) {
  const proposal = p.proposal || {}, figures = p.figures || {};
  return `${escHtml(proposal.number || '')} ${_cpStatusPill(p.status)} ${figures.contractTotal ? window.fmtPeso(figures.contractTotal, { dp: 0 }) : ''}`;
}

function _cpRenderDetail(p) {
  const canWrite = ['president', 'manager'].includes(window.currentRole);
  const client = p.client || {}, proposal = p.proposal || {}, figures = p.figures || {};
  const tabs = ['Overview', 'Progress', 'Payments', 'Updates', 'Signature', 'Audit', 'Settings'];
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <button class="btn-icon" onclick="cpBackToList()" title="Back">${emojiIcon('arrow-left', 18)}</button>
      <div>
        <div style="font-weight:700;font-size:16px">${escHtml(client.company || client.name || p.id)}</div>
        <div id="cp-detail-sub" style="font-size:12px;color:var(--text-muted)">${_cpDetailSubHtml(p)}</div>
      </div>
    </div>
    ${window.chipTabs(tabs.map(t => ({ key: t, label: t })), _cpTab)}
    <div id="cp-tab-body" style="margin-top:12px">${window.skeletonHtml('rows')}</div>
  `;
}

async function _cpRepaintTabBody() {
  const el = document.getElementById('cp-tab-body');
  if (el) el.innerHTML = window.skeletonHtml('rows');
  // Keep the header in step with the refetched doc — status changes repaint
  // through here, and a stale pill misreports whether the client link is live.
  const sub = document.getElementById('cp-detail-sub');
  if (sub && _cpCurrentPortal) sub.innerHTML = _cpDetailSubHtml(_cpCurrentPortal);
  await _cpRenderTabBody(_cpCurrentPortal);
}

async function _cpRenderTabBody(portal) {
  const el = document.getElementById('cp-tab-body');
  if (!el) return;
  const canWrite = ['president', 'manager'].includes(window.currentRole);
  try {
    switch (_cpTab) {
      case 'Overview': el.innerHTML = _cpRenderOverview(portal, canWrite); break;
      case 'Progress': el.innerHTML = _cpRenderProgress(portal, canWrite); break;
      case 'Payments': el.innerHTML = _cpRenderPayments(portal, canWrite); break;
      case 'Updates': el.innerHTML = await _cpRenderUpdates(portal, canWrite); break;
      case 'Signature': el.innerHTML = await _cpRenderSignature(portal, canWrite); break;
      case 'Audit': el.innerHTML = await _cpRenderAudit(portal); break;
      case 'Settings': el.innerHTML = _cpRenderSettings(portal, canWrite); break;
      default: el.innerHTML = '';
    }
    if (window.lucide) lucide.createIcons({ nodes: [el] });
  } catch (e) {
    el.innerHTML = `<div class="empty-state"><p>${escHtml(e.message || String(e))}</p></div>`;
  }
}

/* ── Overview tab: content review + JSON import ─────────────────────────── */

function _cpRenderOverview(p, canWrite) {
  const client = p.client || {}, proposal = p.proposal || {}, figures = p.figures || {};
  const milestones = p.milestones || [];
  const zones = p.zones || [];
  const items = p.items || [];
  const hasContent = !!(figures.contractTotal && milestones.length && items.length);
  const msRows = milestones.map(m => `
    <tr>
      <td>${escHtml(m.key)}</td><td>${escHtml(m.label || '')}</td>
      <td>${m.pct != null ? m.pct + '%' : ''}</td>
      <td>${m.amount != null ? window.fmtPeso(m.amount, { dp: 0 }) : ''}</td>
      <td>${escHtml(m.dueOn || '')}</td>
      <td>${m.restated ? '±' : ''}</td>
    </tr>
    ${(m.parts || []).map(pt => `<tr style="color:var(--text-muted);font-size:12px"><td></td><td style="padding-left:16px">${escHtml(pt.label)}</td><td></td><td>${window.fmtPeso(pt.amount, { dp: 0 })}</td><td>${escHtml(pt.dueOn || '')}</td><td></td></tr>`).join('')}
  `).join('');
  return `
    <div class="card">
      <h4 style="margin-top:0">Client &amp; proposal</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px">
        <div><b>Company</b><br>${escHtml(client.company || '—')}</div>
        <div><b>Contact</b><br>${escHtml(client.contactName || '—')}</div>
        <div><b>Address</b><br>${escHtml(client.address || '—')}</div>
        <div><b>Proposal no.</b><br>${escHtml(proposal.number || '—')}</div>
        <div><b>Issued</b><br>${escHtml(proposal.issuedOn || '—')}</div>
        <div><b>Valid until</b><br>${escHtml(proposal.validUntil || '—')} ${_cpDaysLeft(proposal.validUntil)}</div>
      </div>
    </div>
    ${hasContent ? `
    <div class="card">
      <h4 style="margin-top:0">Confirmed figures</h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;font-size:13px">
        <div><b>Contract total</b><br>${window.fmtPeso(figures.contractTotal, { dp: 0 })}</div>
        <div><b>Scope</b><br>${figures.itemCount || 0} items · ${figures.unitCount || 0} units · ${figures.zoneCount || 0} zones</div>
        <div><b>Lead time</b><br>${figures.leadDays || 0} days · turnover ${escHtml(figures.turnoverBy || '')}</div>
        <div><b>Warranty</b><br>${figures.warrantyMonths || 0} months</div>
      </div>
    </div>
    <div class="card">
      <h4 style="margin-top:0">Milestones</h4>
      <table class="data-table"><thead><tr><th>Key</th><th>Label</th><th>%</th><th>Amount</th><th>Due</th><th></th></tr></thead>
      <tbody>${msRows}</tbody>
      <tfoot><tr><td colspan="3"><b>Total</b></td><td><b>${window.fmtPeso(milestones.reduce((a, m) => a + (m.amount || 0), 0), { dp: 0 })}</b></td><td></td><td></td></tr></tfoot></table>
    </div>
    <div class="card">
      <h4 style="margin-top:0">Zones &amp; equipment</h4>
      ${zones.map(z => `
        <div style="margin-bottom:10px">
          <div style="font-weight:700;font-size:13px;color:${CP_ZONE_COLOR[z.colorKey] || 'var(--text)'}">Zone ${z.no} — ${escHtml(z.name)} <span style="font-weight:400;color:var(--text-muted)">(${escHtml(z.planColour || '')})</span></div>
          <div style="font-size:12px;color:var(--text-muted)">${(z.itemNos || []).length} item(s): ${(z.itemNos || []).join(', ')}</div>
        </div>`).join('')}
      <p style="font-size:12px;color:var(--text-muted)">${items.length} items in the import (specs only — no quantity/price fields, by design).</p>
    </div>
    <div class="card">
      <h4 style="margin-top:0">Steps &amp; terms</h4>
      <p style="font-size:12px;color:var(--text-muted)">${(p.steps || []).length} flow-of-events steps · ${(p.terms || []).length} terms paragraphs · ${(p.workflow || []).length} workflow blocks imported.</p>
    </div>
    ` : `<div class="empty-state"><p>No content imported yet.${canWrite ? ' Use Import JSON below.' : ''}</p></div>`}
    ${canWrite ? _cpRenderImportPanel() : ''}
  `;
}

function _cpRenderImportPanel() {
  return `
    <div class="card">
      <h4 style="margin-top:0">Import proposal content (JSON)</h4>
      <p style="font-size:12px;color:var(--text-muted)">Paste the client's off-repo content JSON (e.g. <code>~/Desktop/&lt;client&gt;/&lt;client&gt;-portal-content.json</code>). Validated before writing — milestones must sum to the contract total, and no item may carry a price/qty/cost field.</p>
      ${_cpImportOpen ? `
        <textarea id="cp-import-json" rows="8" style="width:100%;font-family:monospace;font-size:12px" placeholder="{ &quot;proposal&quot;: {...}, &quot;figures&quot;: {...}, &quot;milestones&quot;: [...], ... }"></textarea>
        <div id="cp-import-errors" style="color:var(--danger,#e5484d);font-size:12px;margin-top:6px"></div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn-primary" onclick="cpImportJson()">Validate &amp; import</button>
          <button class="btn-secondary" onclick="cpToggleImport()">Cancel</button>
        </div>
      ` : `<button class="btn-secondary" onclick="cpToggleImport()">${emojiIcon('upload', 16)} Import JSON</button>`}
    </div>
  `;
}

window.cpToggleImport = function () {
  _cpImportOpen = !_cpImportOpen;
  _cpRepaintTabBody();
};

// Client-side port of the server's milestoneCheck arithmetic (§7.2) — same
// rounding rule (round(total*pct/100)) so a portal never goes live with
// milestones that don't reproduce the confirmed total.
function _cpMilestoneCheck(total, milestones) {
  const errors = [];
  if (!Array.isArray(milestones) || !milestones.length) { errors.push('milestones must be a non-empty array'); return { ok: false, errors: errors }; }
  const pctSum = milestones.reduce((a, m) => a + (Number(m.pct) || 0), 0);
  if (pctSum !== 100) errors.push(`milestone pcts sum to ${pctSum}, expected 100`);
  let amtSum = 0;
  milestones.forEach(m => {
    const expect = Math.round(total * (Number(m.pct) || 0) / 100);
    if (expect !== Number(m.amount)) errors.push(`${m.key}: amount ${m.amount} does not equal round(total*pct/100)=${expect}`);
    amtSum += Number(m.amount) || 0;
    if (Array.isArray(m.parts) && m.parts.length) {
      const partsSum = m.parts.reduce((a, pt) => a + (Number(pt.amount) || 0), 0);
      if (partsSum !== Number(m.amount)) errors.push(`${m.key}: parts sum to ${partsSum}, expected ${m.amount}`);
    }
  });
  if (amtSum !== total) errors.push(`milestone amounts sum to ${amtSum}, expected total ${total}`);
  return { ok: errors.length === 0, errors: errors };
}

function _cpValidateItemKeys(items) {
  const errors = [];
  (items || []).forEach(it => {
    Object.keys(it || {}).forEach(k => {
      if (CP_ITEM_ALWAYS_ALLOWED_KEYS.has(k)) return;
      if (CP_ITEM_FORBIDDEN_KEY_RE.test(k)) errors.push(`item ${it.no != null ? it.no : '?'}: forbidden key "${k}"`);
    });
  });
  return errors;
}

window.cpImportJson = async function () {
  const ta = document.getElementById('cp-import-json');
  const errBox = document.getElementById('cp-import-errors');
  if (!ta) return;
  let parsed;
  try {
    parsed = JSON.parse(ta.value);
  } catch (e) {
    errBox.textContent = 'Invalid JSON: ' + e.message;
    return;
  }
  const errors = [];
  const REQUIRED_TOP = ['proposal', 'figures', 'milestones', 'zones', 'items', 'workflow', 'steps', 'terms'];
  REQUIRED_TOP.forEach(k => { if (!(k in parsed)) errors.push(`missing top-level key "${k}"`); });
  if (parsed.figures && parsed.milestones) {
    const mc = _cpMilestoneCheck(Number(parsed.figures.contractTotal) || 0, parsed.milestones);
    if (!mc.ok) errors.push(...mc.errors);
  }
  if (parsed.items) errors.push(..._cpValidateItemKeys(parsed.items));
  if (errors.length) {
    errBox.innerHTML = errors.map(e => escHtml(e)).join('<br>');
    return;
  }
  errBox.textContent = '';
  const patch = {
    proposal: firebase.firestore.FieldValue ? Object.assign({}, _cpCurrentPortal.proposal || {}, parsed.proposal || {}) : parsed.proposal,
    figures: parsed.figures,
    milestones: parsed.milestones,
    zones: parsed.zones,
    items: parsed.items,
    workflow: parsed.workflow,
    steps: parsed.steps,
    terms: parsed.terms,
    agreementsRequired: parsed.agreementsRequired || ['scope', 'price', 'terms', 'payment'],
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: (window.currentUser && window.currentUser.uid) || null
  };
  if (parsed.client) patch.client = Object.assign({}, _cpCurrentPortal.client || {}, parsed.client);
  try {
    await db.collection('client_portals').doc(_cpCurrentId).update(patch);
    _cpEvent(_cpCurrentId, 'content_imported', { proposalNumber: (parsed.proposal || {}).number || null });
    _cpInvalidate(_cpCurrentId);
    _cpImportOpen = false;
    Notifs.showToast('Content imported', 'success');
    _cpCurrentPortal = await _cpFetchPortalDoc(_cpCurrentId);
    _cpRepaintTabBody();
  } catch (e) {
    errBox.textContent = 'Write failed: ' + (e.message || e);
  }
};

/* ── Progress tab ─────────────────────────────────────────────────────── */

function _cpRenderProgress(p, canWrite) {
  const steps = p.steps || [];
  if (!steps.length) return `<div class="empty-state"><p>Import proposal content first — the flow-of-events steps drive this tab.</p></div>`;
  const progress = p.progress || { currentStep: 0, steps: {} };
  const stateFor = n => (progress.steps && progress.steps[String(n)]) || { state: n === 1 && progress.currentStep === 0 ? 'pending' : 'pending' };
  return `
    <div class="card">
      <h4 style="margin-top:0">Flow of events (current step: ${progress.currentStep || 0}/${CP_STEP_COUNT})</h4>
      ${steps.map(s => {
        const st = stateFor(s.no);
        const badge = st.state === 'done' ? '<span class="badge badge-green">Done</span>'
          : st.state === 'current' ? '<span class="badge badge-orange">Current</span>'
          : '<span class="badge badge-gray">Pending</span>';
        return `
        <div style="border-bottom:1px solid var(--border);padding:10px 0">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div>
              <div style="font-weight:700;font-size:13px">${s.no}. ${escHtml(s.title)}</div>
              <div style="font-size:12px;color:var(--text-muted)">${escHtml(s.dateLabel || '')}</div>
            </div>
            ${badge}
          </div>
          ${st.on ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px">On ${escHtml(st.on)}${st.note ? ' — ' + escHtml(st.note) : ''}</div>` : ''}
          ${canWrite ? `
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;align-items:center">
            <input type="date" id="cp-step-date-${s.no}" value="${window.bizDate()}" style="width:140px" />
            <input type="text" id="cp-step-note-${s.no}" placeholder="short note" style="flex:1;min-width:120px" />
            <button class="btn-secondary" onclick="cpSetStepCurrent(${s.no})">Set current</button>
            <button class="btn-primary" onclick="cpMarkStepDone(${s.no})">Mark done</button>
            <button class="btn-icon" onclick="cpResetStep(${s.no})" title="Reset">${emojiIcon('rotate-ccw', 14)}</button>
          </div>` : ''}
        </div>`;
      }).join('')}
    </div>
  `;
}

window.cpSetStepCurrent = async function (n) {
  const date = (document.getElementById('cp-step-date-' + n) || {}).value || window.bizDate();
  const note = ((document.getElementById('cp-step-note-' + n) || {}).value || '').slice(0, 500);
  const patch = {};
  patch['progress.steps.' + n] = { state: 'current', on: date, note: note };
  patch['progress.currentStep'] = n;
  patch.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
  try {
    await db.collection('client_portals').doc(_cpCurrentId).update(patch);
    _cpEvent(_cpCurrentId, 'stage_set', { step: n, state: 'current', on: date });
    _cpInvalidate(_cpCurrentId);
    _cpCurrentPortal = await _cpFetchPortalDoc(_cpCurrentId);
    _cpRepaintTabBody();
  } catch (e) { Notifs.showToast('Could not update step: ' + (e.message || e), 'error'); }
};

window.cpMarkStepDone = async function (n) {
  const date = (document.getElementById('cp-step-date-' + n) || {}).value || window.bizDate();
  const note = ((document.getElementById('cp-step-note-' + n) || {}).value || '').slice(0, 500);
  const patch = {};
  // Rule: marking step n done sets 1..n done and n+1 current.
  for (let i = 1; i <= n; i++) {
    const existing = (_cpCurrentPortal.progress && _cpCurrentPortal.progress.steps && _cpCurrentPortal.progress.steps[String(i)]) || {};
    patch['progress.steps.' + i] = { state: 'done', on: i === n ? date : (existing.on || date), note: i === n ? note : (existing.note || '') };
  }
  if (n < CP_STEP_COUNT) {
    patch['progress.steps.' + (n + 1)] = { state: 'current', on: window.bizDate(), note: '' };
    patch['progress.currentStep'] = n + 1;
  } else {
    patch['progress.currentStep'] = CP_STEP_COUNT;
  }
  patch.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
  try {
    await db.collection('client_portals').doc(_cpCurrentId).update(patch);
    _cpEvent(_cpCurrentId, 'stage_set', { step: n, state: 'done', on: date });
    _cpInvalidate(_cpCurrentId);
    _cpCurrentPortal = await _cpFetchPortalDoc(_cpCurrentId);
    _cpRepaintTabBody();
  } catch (e) { Notifs.showToast('Could not update step: ' + (e.message || e), 'error'); }
};

window.cpResetStep = async function (n) {
  const ok = await window.confirmDialog({ title: 'Reset step?', message: `Reset step ${n} back to pending?`, confirmLabel: 'Reset' });
  if (!ok) return;
  const patch = {};
  patch['progress.steps.' + n] = { state: 'pending', on: null, note: '' };
  patch.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
  try {
    await db.collection('client_portals').doc(_cpCurrentId).update(patch);
    _cpEvent(_cpCurrentId, 'stage_set', { step: n, state: 'pending' });
    _cpInvalidate(_cpCurrentId);
    _cpCurrentPortal = await _cpFetchPortalDoc(_cpCurrentId);
    _cpRepaintTabBody();
  } catch (e) { Notifs.showToast('Could not reset step: ' + (e.message || e), 'error'); }
};

/* ── Payments tab ─────────────────────────────────────────────────────── */

function _cpMilestonePartOptions(milestones) {
  const opts = [];
  (milestones || []).forEach(m => {
    if (Array.isArray(m.parts) && m.parts.length) {
      m.parts.forEach((pt, idx) => opts.push({ value: m.key + '|' + idx, label: `${m.key} — ${pt.label} (${window.fmtPeso(pt.amount, { dp: 0 })})`, amount: pt.amount }));
    } else {
      opts.push({ value: m.key + '|', label: `${m.key} — ${m.label || ''} (${window.fmtPeso(m.amount, { dp: 0 })})`, amount: m.amount });
    }
  });
  return opts;
}

function _cpRenderPayments(p, canWrite) {
  const milestones = p.milestones || [];
  const payments = p.payments || [];
  if (!milestones.length) return `<div class="empty-state"><p>Import proposal content first — milestones drive this tab.</p></div>`;
  const receivedByMilestone = {};
  payments.forEach(pay => { receivedByMilestone[pay.milestoneKey] = (receivedByMilestone[pay.milestoneKey] || 0) + (Number(pay.amount) || 0); });
  const outstandingRows = milestones.map(m => {
    const received = receivedByMilestone[m.key] || 0;
    const outstanding = (m.amount || 0) - received;
    return `<tr><td>${escHtml(m.key)}</td><td>${window.fmtPeso(m.amount, { dp: 0 })}</td><td>${window.fmtPeso(received, { dp: 0 })}</td><td>${window.fmtPeso(outstanding, { dp: 0 })}</td></tr>`;
  }).join('');
  const paymentRows = payments.length ? payments.map(pay => `
    <tr>
      <td>${escHtml(pay.milestoneKey)}${pay.partIndex != null ? ' (' + (Number(pay.partIndex) + 1) + ')' : ''}</td>
      <td>${window.fmtPeso(pay.amount, { dp: 0 })}</td>
      <td>${escHtml(pay.receivedOn || '')}</td>
      <td>${escHtml(pay.method || '')}</td>
      <td>${escHtml(pay.refNo || '')}</td>
      ${canWrite ? `<td>${window.currentRole === 'president' ? `<button class="btn-icon" onclick="cpRemovePayment('${escHtml(pay.id)}')" title="Remove">${emojiIcon('trash-2', 14)}</button>` : ''}</td>` : ''}
    </tr>`).join('') : `<tr><td colspan="6" style="color:var(--text-muted)">No payments recorded yet.</td></tr>`;
  const options = _cpMilestonePartOptions(milestones);
  return `
    <div class="card">
      <h4 style="margin-top:0">Outstanding by milestone</h4>
      <table class="data-table"><thead><tr><th>Milestone</th><th>Amount</th><th>Received</th><th>Outstanding</th></tr></thead><tbody>${outstandingRows}</tbody></table>
    </div>
    <div class="card">
      <h4 style="margin-top:0">Payments recorded</h4>
      <table class="data-table"><thead><tr><th>Milestone</th><th>Amount</th><th>Received on</th><th>Method</th><th>Ref no.</th>${canWrite ? '<th></th>' : ''}</tr></thead><tbody>${paymentRows}</tbody></table>
      ${canWrite ? (_cpAddPaymentOpen ? `
        <div style="margin-top:12px;border-top:1px solid var(--border);padding-top:12px">
          <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="form-group"><label>Milestone / part</label>
              <select id="cp-pay-ms" onchange="cpPayMsChanged()">${options.map(o => `<option value="${escHtml(o.value)}" data-amount="${o.amount}">${escHtml(o.label)}</option>`).join('')}</select>
            </div>
            <div class="form-group"><label>Amount</label><input id="cp-pay-amount" type="number" value="${options[0] ? options[0].amount : ''}" /></div>
          </div>
          <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="form-group"><label>Received on</label><input id="cp-pay-date" type="date" value="${window.bizDate()}" /></div>
            <div class="form-group"><label>Method</label><input id="cp-pay-method" placeholder="Bank transfer / cash / GCash" /></div>
          </div>
          <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div class="form-group"><label>Reference no.</label><input id="cp-pay-refno" /></div>
            <div class="form-group"><label>Internal note (never shown to client)</label><input id="cp-pay-note" /></div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn-primary" onclick="cpAddPayment()">Add payment</button>
            <button class="btn-secondary" onclick="cpToggleAddPayment()">Cancel</button>
          </div>
        </div>
      ` : `<button class="btn-secondary" style="margin-top:10px" onclick="cpToggleAddPayment()">${emojiIcon('plus', 16)} Add payment</button>`) : ''}
    </div>
  `;
}

window.cpToggleAddPayment = function () { _cpAddPaymentOpen = !_cpAddPaymentOpen; _cpRepaintTabBody(); };
window.cpPayMsChanged = function () {
  const sel = document.getElementById('cp-pay-ms');
  const amt = document.getElementById('cp-pay-amount');
  if (!sel || !amt) return;
  const opt = sel.options[sel.selectedIndex];
  amt.value = opt ? opt.getAttribute('data-amount') : '';
};

window.cpAddPayment = async function () {
  const sel = document.getElementById('cp-pay-ms');
  if (!sel) return;
  const [milestoneKey, partIndexRaw] = sel.value.split('|');
  const payment = {
    id: 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    milestoneKey: milestoneKey,
    partIndex: partIndexRaw === '' ? null : Number(partIndexRaw),
    amount: Number((document.getElementById('cp-pay-amount') || {}).value) || 0,
    receivedOn: (document.getElementById('cp-pay-date') || {}).value || window.bizDate(),
    method: ((document.getElementById('cp-pay-method') || {}).value || '').slice(0, 80),
    refNo: ((document.getElementById('cp-pay-refno') || {}).value || '').slice(0, 80),
    note: ((document.getElementById('cp-pay-note') || {}).value || '').slice(0, 500)
  };
  if (!payment.amount || payment.amount <= 0) { Notifs.showToast('Enter a valid amount', 'error'); return; }
  try {
    const fresh = await _cpFetchPortalDoc(_cpCurrentId);
    const payments = (fresh.payments || []).concat([payment]);
    await db.collection('client_portals').doc(_cpCurrentId).update({ payments: payments, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    _cpEvent(_cpCurrentId, 'payment_add', { milestoneKey: payment.milestoneKey, amount: payment.amount });
    _cpInvalidate(_cpCurrentId);
    _cpAddPaymentOpen = false;
    Notifs.showToast('Payment recorded', 'success');
    _cpCurrentPortal = await _cpFetchPortalDoc(_cpCurrentId);
    _cpRepaintTabBody();
  } catch (e) { Notifs.showToast('Could not add payment: ' + (e.message || e), 'error'); }
};

window.cpRemovePayment = async function (paymentId) {
  if (window.currentRole !== 'president') return;
  const ok = await window.confirmDialog({ title: 'Remove payment?', message: 'This removes the payment record. This cannot be undone.', danger: true, confirmLabel: 'Remove' });
  if (!ok) return;
  try {
    const fresh = await _cpFetchPortalDoc(_cpCurrentId);
    const payments = (fresh.payments || []).filter(pay => pay.id !== paymentId);
    await db.collection('client_portals').doc(_cpCurrentId).update({ payments: payments, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    _cpEvent(_cpCurrentId, 'payment_remove', { paymentId: paymentId });
    _cpInvalidate(_cpCurrentId);
    _cpCurrentPortal = await _cpFetchPortalDoc(_cpCurrentId);
    _cpRepaintTabBody();
  } catch (e) { Notifs.showToast('Could not remove payment: ' + (e.message || e), 'error'); }
};

/* ── Updates tab ──────────────────────────────────────────────────────── */

async function _cpFetchUpdates(portalId) {
  const snap = await db.collection('client_portals').doc(portalId).collection('updates').orderBy('at', 'desc').limit(100).get();
  return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
}

async function _cpRenderUpdates(p, canWrite) {
  const updates = await _cpFetchUpdates(_cpCurrentId);
  const visible = updates.filter(u => u.visible !== false);
  const rows = visible.length ? visible.map(u => `
    <div class="card" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <div style="font-weight:700">${escHtml(u.title || '')}</div>
        ${canWrite ? `<button class="btn-icon" onclick="cpDeleteUpdate('${escHtml(u.id)}')" title="Delete">${emojiIcon('trash-2', 14)}</button>` : ''}
      </div>
      <div style="font-size:13px;white-space:pre-wrap">${escHtml(u.body || '')}</div>
      ${u.stepNo ? `<div style="font-size:12px;color:var(--text-muted)">Step ${escHtml(String(u.stepNo))}</div>` : ''}
      ${(u.photos || []).length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:6px;margin-top:8px">${u.photos.map(ph => `<a href="${escHtml(ph.url)}" target="_blank" rel="noopener"><img src="${escHtml(ph.url)}" alt="${escHtml(ph.caption || '')}" style="width:100%;border-radius:6px" /></a>`).join('')}</div>` : ''}
    </div>
  `).join('') : `<div class="empty-state"><p>No updates posted yet.</p></div>`;
  return `
    ${canWrite ? `
    <div class="card">
      <h4 style="margin-top:0">Post an update</h4>
      <div class="form-group"><label>Title</label><input id="cp-upd-title" placeholder="Fabrication underway" /></div>
      <div class="form-group"><label>Body</label><textarea id="cp-upd-body" rows="3"></textarea></div>
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="form-group"><label>Step (optional)</label>
          <select id="cp-upd-step"><option value="">—</option>${Array.from({ length: CP_STEP_COUNT }, (_, i) => i + 1).map(n => `<option value="${n}">${n}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>Photos</label><input id="cp-upd-photos" type="file" accept="image/*" multiple /></div>
      </div>
      <button class="btn-primary" onclick="cpPostUpdate(this)">Post update</button>
    </div>` : ''}
    ${rows}
  `;
}

window.cpPostUpdate = async function (btn) {
  const title = ((document.getElementById('cp-upd-title') || {}).value || '').slice(0, 120);
  const body = ((document.getElementById('cp-upd-body') || {}).value || '').slice(0, 2000);
  const stepVal = (document.getElementById('cp-upd-step') || {}).value;
  const fileInput = document.getElementById('cp-upd-photos');
  if (!title) { Notifs.showToast('Title is required', 'error'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Posting…'; }
  try {
    const photos = [];
    const files = (fileInput && fileInput.files) ? Array.from(fileInput.files) : [];
    for (const file of files) {
      const uploaded = await window.Drive.uploadFile(file, 'client-portals', _cpCurrentId + '/progress');
      photos.push({ url: uploaded.url, caption: '', path: uploaded.id });
    }
    await db.collection('client_portals').doc(_cpCurrentId).collection('updates').add({
      at: firebase.firestore.FieldValue.serverTimestamp(),
      title: title,
      body: body,
      stepNo: stepVal ? Number(stepVal) : null,
      photos: photos,
      createdBy: (window.currentUser && window.currentUser.uid) || null,
      visible: true
    });
    _cpEvent(_cpCurrentId, 'update_post', { title: title });
    Notifs.showToast('Update posted', 'success');
    _cpRepaintTabBody();
  } catch (e) {
    Notifs.showToast('Could not post update: ' + (e.message || e), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Post update'; }
  }
};

window.cpDeleteUpdate = async function (updateId) {
  const ok = await window.confirmDialog({ title: 'Delete update?', message: 'The client will no longer see this update.', danger: true, confirmLabel: 'Delete' });
  if (!ok) return;
  try {
    await db.collection('client_portals').doc(_cpCurrentId).collection('updates').doc(updateId).update({ visible: false });
    _cpEvent(_cpCurrentId, 'update_delete', { updateId: updateId });
    Notifs.showToast('Update removed', 'success');
    _cpRepaintTabBody();
  } catch (e) { Notifs.showToast('Could not delete update: ' + (e.message || e), 'error'); }
};

/* ── Signature tab (acceptance record + manual send) ─────────────────── */

async function _cpFetchAcceptance(p) {
  if (!p.acceptance || !p.acceptance.refNo) return null;
  const doc = await db.collection('client_portals').doc(_cpCurrentId).collection('acceptances').doc(p.acceptance.refNo).get();
  return doc.exists ? doc.data() : null;
}
async function _cpFetchOutboxForPortal(portalId) {
  const snap = await db.collection('client_portal_outbox').where('portalId', '==', portalId).limit(10).get();
  return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
}

async function _cpRenderSignature(p, canWrite) {
  if (!p.acceptance) return `<div class="empty-state"><p>Not signed yet.</p></div>`;
  const [full, outbox] = await Promise.all([_cpFetchAcceptance(p), _cpFetchOutboxForPortal(_cpCurrentId)]);
  const a = full || p.acceptance;
  const signedAt = a.signedOnManila || (a.signedAt && a.signedAt.toDate ? window.bizDate(a.signedAt.toDate()) : '');
  const signer = a.signer || p.acceptance.signer || {};
  const sigImg = a.signatureMode === 'drawn' && a.signaturePng
    ? `<img src="${escHtml(a.signaturePng)}" alt="signature" style="max-width:320px;border:1px solid var(--border);border-radius:6px;background:#fff" />`
    : `<div style="font-family:'Brush Script MT',cursive;font-size:28px">${escHtml(a.typedName || signer.name || '')}</div>`;
  const outboxCard = outbox.map(o => _cpRenderOutboxDraft(o)).join('');
  return `
    <div class="card" id="receipt">
      <h4 style="margin-top:0">Acceptance record</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:13px">
        <div><b>Reference</b><br><span style="font-family:monospace">${escHtml(p.acceptance.refNo || '')}</span></div>
        <div><b>Signed on</b><br>${escHtml(signedAt)}</div>
        <div><b>Signer</b><br>${escHtml(signer.name || '')} — ${escHtml(signer.designation || '')}</div>
        <div><b>E-mail</b><br>${escHtml(signer.email || '')}</div>
        <div><b>Phone</b><br>${escHtml(signer.phone || '')}</div>
        <div><b>Company</b><br>${escHtml(signer.company || '')}</div>
        ${full && full.client ? `<div><b>IP</b><br>${escHtml(full.client.ip || '')}</div>
        <div><b>User agent</b><br style="font-size:11px">${escHtml((full.client.userAgent || '').slice(0, 80))}</div>` : ''}
      </div>
      <div style="margin-top:12px"><b>Signature</b><br>${sigImg}</div>
      <button class="btn-secondary" style="margin-top:12px" onclick="cpPrintReceipt()">${emojiIcon('printer', 16)} Print receipt copy</button>
    </div>
    ${outboxCard}
  `;
}

function _cpRenderOutboxDraft(o) {
  const bodyEnc = encodeURIComponent(o.body || '');
  const subjEnc = encodeURIComponent(o.subject || '');
  const toEnc = encodeURIComponent(o.to || '');
  return `
    <div class="card">
      <h4 style="margin-top:0">Manual send ${o.status === 'sent' ? '<span class="badge badge-green">Sent</span>' : '<span class="badge badge-orange">Pending</span>'}</h4>
      <div style="font-size:12px;color:var(--text-muted)">To: ${escHtml(o.to || '')}</div>
      <div style="font-size:13px;font-weight:700;margin-top:4px">${escHtml(o.subject || '')}</div>
      <pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;background:var(--s1,rgba(255,255,255,0.04));padding:10px;border-radius:8px;margin-top:6px">${escHtml(o.body || '')}</pre>
      ${o.status !== 'sent' ? `
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <a class="btn-secondary" href="mailto:${toEnc}?subject=${subjEnc}&body=${bodyEnc}">${emojiIcon('mail', 16)} Open in Mail</a>
        <a class="btn-secondary" href="https://mail.google.com/mail/?view=cm&fs=1&to=${toEnc}&su=${subjEnc}&body=${bodyEnc}" target="_blank" rel="noopener">${emojiIcon('external-link', 16)} Open in Gmail</a>
        <button class="btn-secondary" onclick="cpCopyOutbox(this)">${emojiIcon('copy', 16)} Copy subject + body</button>
        <button class="btn-primary" onclick="cpMarkSent('${escHtml(o.id)}', 'other')">Mark as sent</button>
      </div>` : `<div style="font-size:12px;color:var(--text-muted);margin-top:6px">Sent ${escHtml(o.sentVia || '')} on ${o.sentAt && o.sentAt.toDate ? window.bizDate(o.sentAt.toDate()) : ''}</div>`}
    </div>
  `;
}

window.cpPrintReceipt = function () {
  window.print();
};

window.cpCopyOutbox = async function (btn) {
  const card = btn.closest('.card');
  const subject = card.querySelector('h4').nextElementSibling.nextElementSibling.textContent;
  const body = card.querySelector('pre').textContent;
  const text = `${subject}\n\n${body}`;
  try { await navigator.clipboard.writeText(text); Notifs.showToast('Copied', 'success'); }
  catch (_) { Notifs.showToast('Could not copy — select the text manually', 'error'); }
};

window.cpMarkSent = async function (outboxId, via) {
  try {
    await db.collection('client_portal_outbox').doc(outboxId).update({
      status: 'sent',
      sentAt: firebase.firestore.FieldValue.serverTimestamp(),
      sentBy: (window.currentUser && window.currentUser.uid) || null,
      sentVia: via || 'other'
    });
    _cpEvent(_cpCurrentId, 'outbox_marked_sent', { outboxId: outboxId });
    Notifs.showToast('Marked as sent', 'success');
    _cpRepaintTabBody();
  } catch (e) { Notifs.showToast('Could not mark as sent: ' + (e.message || e), 'error'); }
};

/* ── Audit tab ────────────────────────────────────────────────────────── */

async function _cpFetchEvents(portalId) {
  const snap = await db.collection('client_portals').doc(portalId).collection('events').orderBy('at', 'desc').limit(100).get();
  return snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
}

async function _cpRenderAudit(p) {
  const events = await _cpFetchEvents(_cpCurrentId);
  if (!events.length) return `<div class="empty-state"><p>No events yet.</p></div>`;
  const rows = events.map(e => {
    const at = e.at && e.at.toDate ? e.at.toDate().toLocaleString('en-PH') : '';
    const actorName = (e.actor && e.actor.name) || (e.actor && e.actor.type) || '';
    return `<tr><td style="white-space:nowrap">${escHtml(at)}</td><td>${escHtml(e.kind || '')}</td><td>${escHtml(actorName)}</td><td style="font-size:11px;color:var(--text-muted)">${escHtml(JSON.stringify(e.detail || {}).slice(0, 200))}</td></tr>`;
  }).join('');
  return `<div class="card"><table class="data-table"><thead><tr><th>When</th><th>Kind</th><th>Actor</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ── Settings tab: status / access code / sessions / validity ──────────── */

function _cpRenderSettings(p, canWrite) {
  if (!canWrite) return `<div class="empty-state"><p>View-only — status and access-code controls are hidden for your role.</p></div>`;
  const status = p.status;
  const hasContent = !!(p.figures && p.figures.contractTotal && (p.milestones || []).length);
  const hasCode = !!p.codeVersion;
  const canGoLive = status === 'draft' && hasContent && hasCode;
  return `
    <div class="card">
      <h4 style="margin-top:0">Status</h4>
      <p style="font-size:13px">Current: ${_cpStatusPill(status)}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${status === 'draft' ? `<button class="btn-primary" ${canGoLive ? '' : 'disabled'} onclick="cpGoLive()">Go live</button>` : ''}
        ${status === 'live' || status === 'signed' ? `<button class="btn-danger" onclick="cpClosePortal()">Close</button>` : ''}
        ${status === 'closed' ? `<button class="btn-secondary" onclick="cpReopenPortal()">Reopen to live</button>` : ''}
      </div>
      ${status === 'draft' && !canGoLive ? `<p style="font-size:12px;color:var(--text-muted);margin-top:6px">${!hasContent ? 'Import proposal content ' : ''}${!hasContent && !hasCode ? 'and ' : ''}${!hasCode ? 'generate an access code ' : ''}before going live.</p>` : ''}
    </div>
    <div class="card">
      <h4 style="margin-top:0">Validity</h4>
      <div class="form-row" style="display:flex;gap:8px;align-items:flex-end">
        <div class="form-group"><label>Valid until</label><input id="cp-validuntil" type="date" value="${(p.proposal || {}).validUntil || ''}" /></div>
        <button class="btn-secondary" onclick="cpExtendValidity()">Extend</button>
      </div>
    </div>
    <div class="card">
      <h4 style="margin-top:0">Access code</h4>
      <p style="font-size:13px">${hasCode ? `Code v${p.codeVersion}${p.codeRotatedAt ? ' — rotated ' + (p.codeRotatedAt.toDate ? window.bizDate(p.codeRotatedAt.toDate()) : '') : ''}` : 'No code generated yet.'}</p>
      <button class="btn-primary" onclick="cpRotateCode()">${hasCode ? 'Rotate code' : 'Generate code'}</button>
      <p style="font-size:12px;color:var(--text-muted);margin-top:6px">Rotating invalidates the previous code but not existing sessions.</p>
    </div>
    <div class="card">
      <h4 style="margin-top:0">Sessions</h4>
      <button class="btn-danger" onclick="cpRevokeSessions()">Revoke all sessions</button>
      <p style="font-size:12px;color:var(--text-muted);margin-top:6px">Signs every current viewer out immediately. The access code still works.</p>
    </div>
  `;
}

window.cpGoLive = async function () {
  try {
    await db.collection('client_portals').doc(_cpCurrentId).update({ status: 'live', updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    _cpEvent(_cpCurrentId, 'status_set', { to: 'live' });
    _cpInvalidate(_cpCurrentId);
    Notifs.showToast('Portal is live', 'success');
    _cpCurrentPortal = await _cpFetchPortalDoc(_cpCurrentId);
    _cpRepaintTabBody();
  } catch (e) { Notifs.showToast('Could not go live: ' + (e.message || e), 'error'); }
};

window.cpClosePortal = async function () {
  const ok = await window.confirmDialog({ title: 'Close portal?', message: 'The client link stops working until reopened.', danger: true, confirmLabel: 'Close' });
  if (!ok) return;
  try {
    await db.collection('client_portals').doc(_cpCurrentId).update({ status: 'closed', updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    _cpEvent(_cpCurrentId, 'status_set', { to: 'closed' });
    _cpInvalidate(_cpCurrentId);
    Notifs.showToast('Portal closed', 'success');
    _cpCurrentPortal = await _cpFetchPortalDoc(_cpCurrentId);
    _cpRepaintTabBody();
  } catch (e) { Notifs.showToast('Could not close portal: ' + (e.message || e), 'error'); }
};

window.cpReopenPortal = async function () {
  try {
    await db.collection('client_portals').doc(_cpCurrentId).update({ status: 'live', updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    _cpEvent(_cpCurrentId, 'status_set', { to: 'live', reopened: true });
    _cpInvalidate(_cpCurrentId);
    Notifs.showToast('Portal reopened', 'success');
    _cpCurrentPortal = await _cpFetchPortalDoc(_cpCurrentId);
    _cpRepaintTabBody();
  } catch (e) { Notifs.showToast('Could not reopen portal: ' + (e.message || e), 'error'); }
};

window.cpExtendValidity = async function () {
  const val = (document.getElementById('cp-validuntil') || {}).value;
  if (!val) { Notifs.showToast('Pick a date', 'error'); return; }
  try {
    await db.collection('client_portals').doc(_cpCurrentId).update({ 'proposal.validUntil': val, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    _cpEvent(_cpCurrentId, 'validity_extended', { validUntil: val });
    _cpInvalidate(_cpCurrentId);
    Notifs.showToast('Validity updated', 'success');
    _cpCurrentPortal = await _cpFetchPortalDoc(_cpCurrentId);
    _cpRepaintTabBody();
  } catch (e) { Notifs.showToast('Could not extend validity: ' + (e.message || e), 'error'); }
};

// The one callable this screen invokes. asia-east1 is MANDATORY (spec §2) —
// the default-region SDK call silently targets us-central1 and fails.
window.cpRotateCode = async function () {
  const ok = await window.confirmDialog({ title: 'Generate / rotate code?', message: 'The previous code (if any) stops working immediately. The new code is shown once — have somewhere ready to copy it to.', confirmLabel: 'Generate' });
  if (!ok) return;
  try {
    const fn = firebase.app().functions('asia-east1').httpsCallable('portalAdminRotateCode');
    const res = await fn({ portalId: _cpCurrentId });
    const data = res.data || {};
    _cpShowCodeModal(data.code, data.codeVersion);
    _cpInvalidate(_cpCurrentId);
    _cpCurrentPortal = await _cpFetchPortalDoc(_cpCurrentId);
    _cpRepaintTabBody();
  } catch (e) { Notifs.showToast('Could not generate code: ' + (e.message || e), 'error'); }
};

function _cpShowCodeModal(code, codeVersion) {
  window.openModal('Access code generated', `
    <div style="text-align:center;padding:12px 0">
      <p style="font-size:12px;color:var(--text-muted)">Shown once. It is not stored anywhere readable — copy it now.</p>
      <div id="cp-code-display" style="font-family:monospace;font-size:28px;letter-spacing:2px;font-weight:700;margin:12px 0">${escHtml(code || '')}</div>
      <button class="btn-primary" onclick="cpCopyCode('${escHtml(code || '')}')">${emojiIcon('copy', 16)} Copy</button>
      <p style="font-size:12px;color:var(--text-muted);margin-top:10px">Code version ${codeVersion}</p>
    </div>
  `, '', {});
}

window.cpCopyCode = async function (code) {
  try { await navigator.clipboard.writeText(code); Notifs.showToast('Copied', 'success'); }
  catch (_) { Notifs.showToast('Could not copy — select the text manually', 'error'); }
};

window.cpRevokeSessions = async function () {
  const ok = await window.confirmDialog({ title: 'Revoke all sessions?', message: 'Every currently signed-in viewer is logged out immediately. The access code itself still works.', danger: true, confirmLabel: 'Revoke all' });
  if (!ok) return;
  try {
    await db.collection('client_portals').doc(_cpCurrentId).update({ sessionsGeneration: firebase.firestore.FieldValue.increment(1), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    _cpEvent(_cpCurrentId, 'sessions_revoked', {});
    _cpInvalidate(_cpCurrentId);
    Notifs.showToast('All sessions revoked', 'success');
  } catch (e) { Notifs.showToast('Could not revoke sessions: ' + (e.message || e), 'error'); }
};
