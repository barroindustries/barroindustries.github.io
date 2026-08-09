/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Ventures department
   js/screens/ventures.js (added 2026-08-08)

   The owner's portfolio of side ventures (Tuklas, Haligi, SteelFab.ph,
   AngatAgri …) as long-form written BRIEFS: an executive summary plus
   user-defined, reorderable prose sections, links, and one attachment.

   DOCUMENTATION ONLY — deliberately NO money fields, no ledger, no figures,
   no accounting of any kind. If this ever needs numbers they belong in
   Finance, not here.

   ── WHAT IT COPIES ────────────────────────────────────────────────────
   Structurally a copy of js/screens/sales.js's renderSalesSOP family — the
   only prior art in this repo that models ONE record as MANY NAMED PROSE
   BLOCKS each with a sub-list, plus an add / remove / move-up / move-down
   editor. Same triad:
       drawVentureEditor()  →  vtGatherDOM()  →  vtSaveVenture()
   with gather called BEFORE every redraw so in-progress typing survives an
   add/remove/reorder. renderDocCollection (js/departments.js) was NOT
   reusable: it hard-caps at a single description textarea and unlocks its
   edit/delete lifecycle only for Government Biddings.

   ── TWO LOAD-BEARING DESIGN DECISIONS ─────────────────────────────────
   1. EVERYTHING RENDERS INTO #page-content, never an openPage() panel.
      sales.js's gather step resolves inputs with document.getElementById /
      document.querySelectorAll, which is correct today ONLY because it
      renders into #page-content where exactly one instance can exist.
      Lifting that pattern into a panel walks into this app's largest defect
      class: openPage defers node removal ~300ms, so a reopened panel leaves
      the dying one EARLIER in document order and a global lookup wins the
      stale node (measured post-mortems in js/screens/design.js and
      js/screens/production.js — one of them saved money then returned a
      blank window). A long-form brief is a full screen anyway, and this
      costs no panel-stack or history entry.
      BELT AND BRACES: every lookup in this file is scoped to the host
      element (host.querySelector / host.querySelectorAll) regardless, so it
      stays correct even if someone later moves it into a panel. This file
      contains ZERO `document.*` calls of its own — the only global-id
      dependency left is INSIDE Drive.renderUploadArea (js/drive.js), which
      takes a container id ('vt-upload') and resolves it with
      document.getElementById. That id exists only while the editor is on
      screen in the single #page-content host, which is precisely why
      decision 1 above is load-bearing rather than stylistic.

   2. THE VENTURE SWITCHER IS DATA-DRIVEN CHIP TABS, so it scales with NO
      code change. window.chipTabs takes [{key,label}] and key may differ
      from label, so the row is Portfolio + one chip per venture DOC:
      a fifth venture is a Firestore document, not an edit to this file.
      window.setSubroute(slug) plus the generic `dept:` hash handling in
      js/app.js (hashFor/parseHash → #/dept/Ventures/<slug>) make each brief
      a working deep link for free — no navigateTo case needed. Slugs are
      forced to [a-z0-9-] ("SteelFab.ph" → "steelfab-ph"), so they can never
      collide with the literal 'Portfolio' key. The fetch happens FIRST and
      the incoming subtab is validated against the loaded slugs, falling
      back to Portfolio.

   ── COLLECTION: `ventures` (top-level, one doc per venture) ────────────
   Read UNFILTERED and sorted CLIENT-SIDE (order, then name). That is
   deliberate: it keeps the firestore.rules read provable from the role
   alone (a LIST query is denied unless provable from the query itself) and
   needs no composite index. The read is wrapped in try/catch with a visible
   Retry — never a swallowing .catch(()=>({docs:[]})), which would render
   "no ventures yet" over a permission error.

   Doc shape:
     name, slug, tagline, icon (single emoji, PLAIN TEXT — see below),
     color (#rrggbb), status (active|exploring|paused|archived),
     stage (free text),
     summary  — the EXECUTIVE SUMMARY, its own top-level field because the
                portfolio card, the brief hero and the print header all want
                that one specific block
     sections — [{ title, body, bullets:[string], note }] user-defined and
                reorderable. SECTION TITLES ARE DATA, not fields and not an
                enum: VENTURE_DEFAULT_SECTIONS below is only the OUTLINE a
                NEW venture is seeded with (titles present, bodies empty).
                Hardcoding the prose itself is what rotted in
                renderCompanyBiOps, which still carries a live "FLAG FOR
                NEIL" comment saying its hardcoded copy is now false.
     links    — [{ label, url }], every url through safeHttpUrl()
     fileUrl  — string|null, one attachment (the `policies` pattern)
     order, createdBy, createdAt, updatedAt, updatedBy

   `icon` is OWNER-AUTHORED, so it goes through escHtml() as PLAIN TEXT and
   never through emojiIcon() — emojiIcon returns HTML and maps bare
   [a-z0-9-] strings to <i data-lucide>, so feeding it user content is the
   "app shows code"/wrong-glyph class of bug. Developer-authored glyphs in
   this file's own chrome do use emojiIcon().

   ── LOAD-ORDER CONTRACT (see index.html + CLAUDE.md) ──────────────────
     - Loads AFTER js/departments.js (canEditDept, deptContainer, escHtml,
       skeletonHtml, chipTabs/bindChipTabs, renderEmptyState, sopPanel,
       confirmDialog, openPrintableDoc, Drive.renderUploadArea …) and after
       js/screens/crm.js, in the department-screens cluster.
     - EVERY reference resolves at RUNTIME (chip clicks, button handlers,
       renderDeptModule dispatch) and never at parse time, so it is equally
       safe for js/app.js (which loads AFTER this file) to reference
       window.renderVentures in its renderDeptModule switch — the same
       forward-reference convention every js/screens/*.js file documents.
     - window.renderVentures is the entry point called from js/app.js's
       renderDeptModule, 'Ventures' case. renderDeptModule calls every
       department renderer as render_X(currentUser, currentRole) with NO
       container argument; each renderer fetches its own container via
       deptContainer(). renderVentures matches that exactly.
     - window.VENTURE_STATUSES / VENTURE_DEFAULT_SECTIONS are plain
       `window.X = [...]` assignments (not bare consts) for the same reason
       AEC_TYPES/ROC_STATUSES are — any future lazily-loaded helper can read
       them defensively regardless of load order.
     - STYLES: all CSS for this screen lives in a scoped <style> block
       injected by this file (the `.vt-` prefix). css/styles.css is owned by
       another in-flight build and was deliberately not touched.
   ═══════════════════════════════════════════════════ */

// Status vocabulary — the four the owner asked for. `key` is what is stored.
window.VENTURE_STATUSES = [
  { key: 'active',    label: 'Active',    color: 'var(--success,#30D158)', icon: '🟢' },
  { key: 'exploring', label: 'Exploring', color: '#0A84FF',               icon: '🔎' },
  { key: 'paused',    label: 'Paused',    color: '#FFAA00',               icon: '⏸' },
  { key: 'archived',  label: 'Archived',  color: '#8e8e93',               icon: '🗄' },
];
function vtStatusMeta(k) {
  return window.VENTURE_STATUSES.find(s => s.key === k) || window.VENTURE_STATUSES[1];
}

// The OUTLINE a brand-new venture is seeded with. Titles only — bodies stay
// empty, because the prose is the owner's to write. The owner's four-part
// outline is:
//    1. Executive summary   → the top-level `summary` FIELD (see header)
//    2. What it is — overview
//    3. Goals & milestones
//    4. Status & next steps
// Blocks 2-4 are seeded here as ordinary sections[]. They are fully
// renameable, removable and reorderable afterwards — this is a scaffold,
// not a schema.
window.VENTURE_DEFAULT_SECTIONS = [
  'What it is — overview',
  'Goals & milestones',
  'Status & next steps',
];

const VENTURE_DEFAULT_COLOR = '#7048E8';

// [a-z0-9-] only, per the deep-link contract in this file's header.
function vtSlugify(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}
// Keep slugs unique across the collection so a deep link is unambiguous.
function vtUniqueSlug(base, takenSlugs) {
  let s = vtSlugify(base) || 'venture';
  if (!takenSlugs.includes(s)) return s;
  for (let i = 2; i < 500; i++) { if (!takenSlugs.includes(s + '-' + i)) return s + '-' + i; }
  return s + '-' + Date.now();
}
// #rrggbb or #rgb only — anything else falls back, so this can never inject
// arbitrary text into a style attribute.
function vtSafeColor(c) {
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(String(c || '')) ? String(c) : VENTURE_DEFAULT_COLOR;
}
// Timestamp | Date | {seconds} | ISO string → Manila-formatted date.
// Mirrors sopFmtDate (sales.js); Manila tz explicitly, never a raw
// toISOString() (which is UTC and has broken attendance/payroll here before).
function vtFmtDate(ts) {
  try {
    const d = ts && ts.toDate ? ts.toDate()
      : (ts instanceof Date ? ts
      : (ts && ts.seconds ? new Date(ts.seconds * 1000)
      : (typeof ts === 'string' ? new Date(ts) : null)));
    return d ? d.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' }) : '';
  } catch (_) { return ''; }
}
// Escape, then apply tiny **bold** markup — same helper contract as sopFmt
// (sales.js). Escaping happens FIRST, so the markup pass can only ever see
// already-neutralised text.
function vtFmt(s) {
  const esc = window.escHtml ? escHtml(s) : String(s == null ? '' : s);
  return esc.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}
// Preserve the author's paragraph breaks in a prose body.
function vtProse(s) {
  return vtFmt(s).replace(/\n/g, '<br>');
}

// ── Scoped stylesheet ─────────────────────────────
// Injected with every render (innerHTML replaces the previous copy, so it
// never accumulates). Lives here rather than css/styles.css because that
// file is owned by another in-flight build — see the header + notDone.
// Mobile-first: no fixed widths, wide content scrolls inside its own box,
// tap targets >= 44px, and the sticky save bar clears the bottom nav and
// --sab-eff.
const VENTURE_CSS = `
<style>
  .vt-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
  .vt-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px;
           border-left:4px solid var(--vt-accent,${VENTURE_DEFAULT_COLOR});cursor:pointer;
           display:flex;flex-direction:column;gap:6px;min-width:0}
  .vt-card:active{background:var(--s2,rgba(128,128,128,.08))}
  .vt-card h4{margin:0;font-size:15px;color:var(--text);overflow-wrap:anywhere}
  .vt-card .vt-tag{font-size:11.5px;color:var(--text-muted);line-height:1.5;overflow-wrap:anywhere}
  .vt-card .vt-exc{font-size:12px;color:var(--text);line-height:1.6;
           display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
  .vt-glyph{font-size:22px;line-height:1;flex-shrink:0}
  .vt-badge{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:2px 9px;
           font-size:10px;font-weight:700;color:var(--on-primary);white-space:nowrap}
  .vt-chip{display:inline-flex;align-items:center;gap:4px;background:var(--surface2);
           border:1px solid var(--border);border-radius:999px;padding:2px 9px;
           font-size:10.5px;font-weight:700;color:var(--text-muted);white-space:nowrap}
  .vt-hero{background:var(--surface);border:1px solid var(--border);border-radius:14px;
           padding:16px;margin-bottom:14px;border-left:4px solid var(--vt-accent,${VENTURE_DEFAULT_COLOR})}
  .vt-sec{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px 16px}
  .vt-sec h4{margin:0 0 6px;font-size:14.5px;color:var(--text);overflow-wrap:anywhere}
  .vt-sec p{margin:0 0 8px;font-size:13px;color:var(--text);line-height:1.7;overflow-wrap:anywhere}
  .vt-sec ul{margin:0 0 8px;padding-left:18px;font-size:13px;color:var(--text);line-height:1.75}
  .vt-sec li{overflow-wrap:anywhere}
  .vt-note{font-size:11.5px;color:var(--text-muted);background:var(--surface2);
           border-radius:8px;padding:6px 10px;line-height:1.6;overflow-wrap:anywhere}
  .vt-lbl{display:block;font-size:10.5px;font-weight:700;color:var(--text-muted);
           margin:8px 0 3px;text-transform:uppercase;letter-spacing:.04em}
  .vt-fld{width:100%;padding:10px;border:1.5px solid var(--border);border-radius:8px;
           background:var(--surface);color:var(--text);font-size:13px;box-sizing:border-box;
           font-family:inherit;min-height:44px}
  textarea.vt-fld{resize:vertical}
  .vt-2col{display:grid;grid-template-columns:1fr;gap:8px}
  @media (min-width:560px){ .vt-2col{grid-template-columns:1fr 1fr} }
  .vt-actions{display:flex;gap:6px;flex-wrap:wrap}
  .vt-actions button{min-height:44px;min-width:44px}
  .vt-linkrow{display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap}
  .vt-linkrow > *{flex:1 1 140px;min-width:0}
  .vt-linkrow button{flex:0 0 auto}
  .vt-savebar{position:sticky;bottom:0;background:var(--bg);border-top:1px solid var(--border);
           padding:10px 0;margin-top:18px;display:flex;gap:8px;flex-wrap:wrap;z-index:3}
  /* .bottom-nav is display:none by default and only flex at <=819px
     (css/styles.css), so only that tier needs the bar lifted clear of it —
     plus --sab-eff, the ViewportSync-published safe-area inset. */
  @media (max-width:819px){
    .vt-savebar{bottom:calc(var(--bottom-nav-h,56px) + var(--sab-eff, env(safe-area-inset-bottom,0px)))}
  }
</style>`;

// ══════════════════════════════════════════════════
//  Entry point (js/app.js renderDeptModule, 'Ventures' case)
// ══════════════════════════════════════════════════
window.renderVentures = async function (currentUser, currentRole, subtab = window.initialSubtab('Portfolio')) {
  window._vtCurrentUser = currentUser;
  window._vtCurrentRole = currentRole;
  const c = deptContainer();
  if (!c) return;

  c.innerHTML = `
    ${VENTURE_CSS}
    <div class="page-header">
      <div>
        <h2>${emojiIcon('🚀', 20)} Ventures</h2>
        <p style="font-size:12px;color:var(--text-muted);margin:2px 0 0">The venture portfolio — executive summaries, overviews, goals &amp; status, one brief per venture</p>
      </div>
    </div>
    ${window.sopPanel ? window.sopPanel('How Ventures works', [
      'Portfolio lists every venture. Tap a card (or its chip above) to open its full written brief.',
      'A brief starts from a four-part outline: Executive summary, What it is, Goals & milestones, Status & next steps.',
      'Sections are yours — rename, reorder, add or remove any of them. Add links and one attachment per venture.',
      'Every venture gets its own chip and its own deep link, so a new venture needs no code change.'
    ]) : ''}
    <div id="vt-host">${window.skeletonHtml('cards', 4)}</div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [c] });

  loadVentures(c.querySelector('#vt-host'), subtab);
};

// Unfiltered read + CLIENT-SIDE sort (see header for why). Errors surface with
// a Retry — deliberately NOT swallowed into an empty list.
async function fetchVentures() {
  const snap = await db.collection('ventures').get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const oa = Number(a.order), ob = Number(b.order);
      const na = isFinite(oa) ? oa : 9999, nb = isFinite(ob) ? ob : 9999;
      if (na !== nb) return na - nb;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
}

async function loadVentures(host, subtab) {
  if (!host) return;
  host.innerHTML = window.skeletonHtml('cards', 4);
  let ventures;
  try {
    ventures = await fetchVentures();
  } catch (err) {
    host.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${emojiIcon('⚠️', 44)}</div>
        <h4>Couldn't load the venture portfolio</h4>
        <p>${escHtml((err && err.message) || String(err))}</p>
        <button type="button" class="btn-secondary btn-sm vt-retry" style="margin-top:14px">Retry</button>
      </div>`;
    host.querySelector('.vt-retry')?.addEventListener('click', () => loadVentures(host, subtab));
    if (window.lucide) lucide.createIcons({ nodes: [host] });
    return;
  }
  drawVenturesShell(host, ventures, subtab);
}

// Chip row (Portfolio + one chip per venture doc) + the selected view.
// Rebuilt whole on every navigation so the active chip is always correct.
function drawVenturesShell(host, ventures, subtab) {
  const slugs = ventures.map(v => v.slug).filter(Boolean);
  // Validate the incoming subtab against the LOADED slugs, not a static list.
  const active = (subtab === 'Portfolio' || slugs.includes(subtab)) ? subtab : 'Portfolio';

  const chips = [{ key: 'Portfolio', label: 'Portfolio', count: ventures.length }]
    .concat(ventures.map(v => ({ key: v.slug, label: v.name || v.slug })));

  host.innerHTML = `
    ${window.chipTabs(chips, active, { cls: 'vt-tabs' })}
    <div id="vt-view"></div>
  `;
  const view = host.querySelector('#vt-view');

  window.bindChipTabs(host.querySelector('.vt-tabs'), (key) => {
    window.setSubroute(key);
    drawVentureView(host, view, ventures, key);
  });

  drawVentureView(host, view, ventures, active);
}

function drawVentureView(host, view, ventures, key) {
  if (!view) return;
  if (key === 'Portfolio') { drawVenturePortfolio(host, view, ventures); return; }
  const v = ventures.find(x => x.slug === key);
  if (!v) { drawVenturePortfolio(host, view, ventures); return; }
  drawVentureBrief(host, view, ventures, v);
}

// Re-fetch and redraw, landing on `slug` (or Portfolio). Used after every write.
function reloadVentures(host, slug) {
  loadVentures(host, slug || 'Portfolio');
}

// ══════════════════════════════════════════════════
//  Portfolio view
// ══════════════════════════════════════════════════
function drawVenturePortfolio(host, view, ventures) {
  const canEdit = canEditDept('Ventures');

  view.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <div style="font-size:12px;color:var(--text-muted)">${ventures.length} venture${ventures.length === 1 ? '' : 's'}</div>
      ${canEdit ? `<button type="button" class="btn-primary btn-sm vt-add" style="min-height:44px">+ Add Venture</button>` : ''}
    </div>
    <div id="vt-cards">${
      ventures.length
        ? `<div class="vt-grid">${ventures.map(vtPortfolioCard).join('')}</div>`
        : window.renderEmptyState({
            icon: '🚀',
            title: 'No ventures yet',
            hint: canEdit
              ? 'Add a venture and it starts from the four-part outline: executive summary, what it is, goals & milestones, status & next steps.'
              : 'Nothing has been added to the venture portfolio yet.'
          })
    }</div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [view] });

  view.querySelector('.vt-add')?.addEventListener('click', () => openVentureEditor(host, view, ventures, null));
  view.querySelectorAll('.vt-card').forEach(card => card.addEventListener('click', () => {
    const v = ventures.find(x => x.id === card.dataset.id);
    if (!v) return;
    // Keep the chip row and the deep link in step with the card tap.
    window.setSubroute(v.slug);
    const bar = host.querySelector('.vt-tabs');
    if (bar) {
      bar.querySelectorAll('.chip-tab').forEach(b => b.classList.toggle('active', b.dataset.chip === v.slug));
    }
    drawVentureBrief(host, view, ventures, v);
  }));
}

function vtPortfolioCard(v) {
  const st = vtStatusMeta(v.status);
  const accent = vtSafeColor(v.color);
  const secs = Array.isArray(v.sections) ? v.sections : [];
  const links = Array.isArray(v.links) ? v.links : [];
  const written = secs.filter(s => (s && ((s.body || '').trim() || (Array.isArray(s.bullets) && s.bullets.length)))).length;
  return `
    <div class="vt-card" data-id="${escHtml(v.id)}" style="--vt-accent:${accent}">
      <div style="display:flex;align-items:flex-start;gap:10px;min-width:0">
        <span class="vt-glyph">${escHtml(v.icon || '🚀')}</span>
        <div style="flex:1;min-width:0">
          <h4>${escHtml(v.name || '(untitled venture)')}</h4>
          ${v.tagline ? `<div class="vt-tag">${escHtml(v.tagline)}</div>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap">
        <span class="vt-badge" style="background:${st.color}">${escHtml(st.icon)} ${escHtml(st.label)}</span>
        ${v.stage ? `<span class="vt-chip">${escHtml(v.stage)}</span>` : ''}
      </div>
      ${v.summary ? `<div class="vt-exc">${vtProse(v.summary)}</div>`
                  : `<div class="vt-tag" style="font-style:italic">No executive summary yet.</div>`}
      <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:10.5px;color:var(--text-muted);margin-top:2px">
        <span>${written}/${secs.length} section${secs.length === 1 ? '' : 's'} written</span>
        ${links.length ? `<span>${links.length} link${links.length === 1 ? '' : 's'}</span>` : ''}
        ${v.fileUrl ? `<span>1 attachment</span>` : ''}
      </div>
      <div style="font-size:11.5px;font-weight:700;color:${accent};margin-top:4px">Open brief →</div>
    </div>`;
}

// ══════════════════════════════════════════════════
//  Brief view (read)
// ══════════════════════════════════════════════════
function drawVentureBrief(host, view, ventures, v) {
  const canEdit = canEditDept('Ventures');
  const canDelete = ['president', 'owner', 'manager', 'secretary'].includes(window._vtCurrentRole || window.currentRole || '');
  const st = vtStatusMeta(v.status);
  const accent = vtSafeColor(v.color);
  const secs = Array.isArray(v.sections) ? v.sections : [];
  const links = (Array.isArray(v.links) ? v.links : [])
    .map(l => ({ label: (l && l.label) || '', url: (typeof safeHttpUrl === 'function') ? safeHttpUrl(l && l.url) : ((l && l.url) || '') }))
    .filter(l => l.url);
  const fileUrl = (typeof safeHttpUrl === 'function') ? safeHttpUrl(v.fileUrl) : (v.fileUrl || '');
  const updated = v.updatedAt
    ? `Updated ${vtFmtDate(v.updatedAt)}${v.updatedBy ? ' · ' + escHtml(v.updatedBy) : ''}`
    : '';

  view.innerHTML = `
    <div class="vt-hero" style="--vt-accent:${accent}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div style="display:flex;align-items:flex-start;gap:10px;min-width:0;flex:1 1 200px">
          <span class="vt-glyph" style="font-size:26px">${escHtml(v.icon || '🚀')}</span>
          <div style="min-width:0">
            <h3 style="margin:0;font-size:18px;color:var(--text);overflow-wrap:anywhere">${escHtml(v.name || '(untitled venture)')}</h3>
            ${v.tagline ? `<div style="font-size:12.5px;color:var(--text-muted);margin-top:2px;overflow-wrap:anywhere">${escHtml(v.tagline)}</div>` : ''}
          </div>
        </div>
        <div class="vt-actions">
          <button type="button" class="btn-secondary btn-sm vt-print" title="Print / save brief">${emojiIcon('🖨', 16)} Print</button>
          ${canEdit ? `<button type="button" class="btn-secondary btn-sm vt-edit">${emojiIcon('✏️', 16)} Edit</button>` : ''}
          ${canDelete ? `<button type="button" class="btn-secondary btn-sm vt-del" style="color:var(--danger)" aria-label="Delete venture">${emojiIcon('trash-2', 14)}</button>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:10px">
        <span class="vt-badge" style="background:${st.color}">${escHtml(st.icon)} ${escHtml(st.label)}</span>
        ${v.stage ? `<span class="vt-chip">${emojiIcon('📍', 14)} ${escHtml(v.stage)}</span>` : ''}
      </div>
      ${updated ? `<div style="margin-top:10px;font-size:11px;color:var(--text-muted)">${updated}</div>` : ''}
    </div>

    <div class="vt-sec" style="margin-bottom:12px;border-left:4px solid ${accent}">
      <h4>${emojiIcon('📄', 15)} Executive summary</h4>
      ${v.summary ? `<p>${vtProse(v.summary)}</p>`
                  : `<p style="color:var(--text-muted);font-style:italic">Not written yet.</p>`}
    </div>

    ${secs.length ? `<div style="display:flex;flex-direction:column;gap:12px">${secs.map(vtSectionHtml).join('')}</div>` : ''}

    ${links.length ? `
      <div class="vt-sec" style="margin-top:12px">
        <h4>${emojiIcon('🔗', 15)} Links</h4>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${links.map(l => `<a href="${l.url}" target="_blank" rel="noopener noreferrer" class="btn-link" style="font-size:12.5px;min-height:44px;display:flex;align-items:center;overflow-wrap:anywhere">${emojiIcon('🔗', 13)}&nbsp;${escHtml(l.label || l.url)}</a>`).join('')}
        </div>
      </div>` : ''}

    ${fileUrl ? `
      <div class="vt-sec" style="margin-top:12px">
        <h4>${emojiIcon('📎', 15)} Attachment</h4>
        <a href="${fileUrl}" target="_blank" rel="noopener noreferrer" class="btn-secondary btn-sm" style="display:inline-flex;align-items:center;min-height:44px">${emojiIcon('📎', 16)}&nbsp;Open attachment</a>
      </div>` : ''}

    ${(!secs.length && !v.summary) ? window.renderEmptyState({
        icon: '📝',
        title: 'This brief is empty',
        hint: canEdit ? 'Tap Edit to write the executive summary and fill in the outline.' : undefined
      }) : ''}

    ${vtReviewPanelHtml(v, canEdit)}
  `;
  if (window.lucide) lucide.createIcons({ nodes: [view] });
  vtBindReviewPanel(host, view, ventures, v);

  view.querySelector('.vt-edit')?.addEventListener('click', () => openVentureEditor(host, view, ventures, v));
  view.querySelector('.vt-print')?.addEventListener('click', () => openVenturePrintBrief(v));
  view.querySelector('.vt-del')?.addEventListener('click', async () => {
    // TYPE-TO-CONFIRM, 2026-08-10. This used to be one tap on a plain
    // confirmDialog, and what it destroys is not a row in a list: it is the
    // executive summary and every prose section of a brief someone wrote by
    // hand, with no soft-delete flag, no archive (the 'archived' STATUS is a
    // display badge, not a tombstone — see vtStatusMeta) and no restore. The
    // owner's ruling was to KEEP the capability and make the gesture cost
    // something, so this follows the one existing precedent in this app for an
    // unrecoverable delete — FilesHub's "purge from bin" (js/departments.js),
    // a required promptDialog whose text must match exactly — except that the
    // phrase is the VENTURE'S OWN NAME rather than the word DELETE, so muscle
    // memory from one brief cannot carry over to the next one.
    // Comparison is trimmed and case-insensitive: this is typed on a phone,
    // and the point is deliberate re-reading of the name, not typing accuracy.
    const phrase = String(v.name || '').trim() || 'DELETE';
    const typed = await promptDialog({
      title: 'Delete venture',
      message: `This permanently deletes the whole brief for "${phrase}" — executive summary, every section, links and the attachment reference. There is no archive and no undo. To confirm, type the venture name exactly: ${phrase}`,
      placeholder: phrase, required: true, confirmLabel: 'Delete forever'
    });
    if (typed == null) return;                       // Back / Esc / Cancel
    if (String(typed).trim().toLowerCase() !== phrase.toLowerCase()) {
      window.Notifs?.showToast?.(`Nothing deleted — type "${phrase}" exactly to confirm.`, 'error');
      return;
    }
    try {
      await db.collection('ventures').doc(v.id).delete();
      window.logAudit && window.logAudit('delete', 'venture', v.id, { name: v.name || '' });
      window.Notifs?.success?.('Venture deleted');
      reloadVentures(host, 'Portfolio');
    } catch (ex) {
      window.Notifs?.showToast?.('Delete failed — ' + ((ex && (ex.message || ex.code)) || ex), 'error');
    }
  });
}

function vtSectionHtml(s) {
  s = s || {};
  const bullets = Array.isArray(s.bullets) ? s.bullets.filter(Boolean) : [];
  if (!(s.title || '').trim() && !(s.body || '').trim() && !bullets.length && !(s.note || '').trim()) return '';
  return `
    <div class="vt-sec">
      ${s.title ? `<h4>${escHtml(s.title)}</h4>` : ''}
      ${s.body ? `<p>${vtProse(s.body)}</p>` : ''}
      ${bullets.length ? `<ul>${bullets.map(b => `<li>${vtFmt(b)}</li>`).join('')}</ul>` : ''}
      ${s.note ? `<div class="vt-note">${emojiIcon('💡', 13)} ${vtFmt(s.note)}</div>` : ''}
    </div>`;
}

// ══════════════════════════════════════════════════
//  Review notes — the REVIEWER's surface (added 2026-08-10)
// ══════════════════════════════════════════════════
// WHY THIS EXISTS. Reviewing ventures is a standing job (the Corporate
// Secretary was given it explicitly), and until now this screen had nowhere to
// put a review. The only thing called a "note" is sections[].note — a side-note
// field INSIDE the author's own editor — so recording an observation meant
// opening the editor, typing into someone else's prose, and saving, which
// re-stamps updatedBy with the reviewer's email and makes the reviewer look
// like the author of the brief. That is not a review surface; it is an edit.
//
// WHY A FIELD AND NOT A COLLECTION. The obvious shape is a `venture_notes`
// collection (or a ventures/{id}/notes subcollection), and both need a
// firestore.rules match block that does not exist — rules do NOT cascade into
// subcollections, and an unruled collection is a silent permission-denied, i.e.
// a review surface that looks empty instead of refusing. `reviewNotes` is an
// ordinary array field on the venture doc, so it is covered by the ventures
// UPDATE rule that is already deployed (canDept('Ventures') plus the name/status
// checks, which a merge update satisfies because request.resource.data is the
// MERGED document) — no rules change, no deploy, nothing that can silently fail.
//
// WHAT MAKES IT A REVIEW AND NOT AN EDIT. The write below touches ONLY
// reviewNotes/reviewedAt/reviewedBy. It never writes summary, sections, links
// or updatedBy, so the "Updated <date> · <email>" line in the hero keeps meaning
// what it says: who last changed the AUTHOR'S prose. And vtSaveVenture's payload
// does not carry reviewNotes and uses .update() (never .set()), so an author
// saving the brief cannot wipe a reviewer's notes either. The two are
// independent by construction, in both directions.
//
// `at` is a client Timestamp.now(), not serverTimestamp() — a sentinel is
// illegal inside an array element. Same call this repo already makes for task
// follow-ups (js/screens/tasks.js), and the display is a date, not an audit
// instant.
function vtReviewNotes(v) {
  return (Array.isArray(v && v.reviewNotes) ? v.reviewNotes : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => ((b && b.at && b.at.seconds) || 0) - ((a && a.at && a.at.seconds) || 0));
}
// A note may be removed by whoever wrote it, or by an admin role (the client
// mirror of firestore.rules' isAdmin(): president/manager/secretary). The write
// itself is the same ventures update either way — this only decides whether the
// control is offered.
function vtCanRemoveNote(n) {
  const me = (window._vtCurrentUser && window._vtCurrentUser.uid)
    || (window.currentUser && window.currentUser.uid) || '';
  if (n && n.byUid && n.byUid === me) return true;
  return typeof window.isAdminPriv === 'function' ? window.isAdminPriv() : false;
}
function vtReviewPanelHtml(v, canEdit) {
  const notes = vtReviewNotes(v);
  return `
    <div class="vt-sec" style="margin-top:12px" id="vt-review">
      <h4>${emojiIcon('🔍', 15)} Review notes${notes.length ? ` (${notes.length})` : ''}</h4>
      <p style="font-size:11.5px;color:var(--text-muted);margin:0 0 10px;line-height:1.6">
        A reviewer's observations, kept beside the brief and never inside it — adding one
        does not change the author's prose or the “Updated by” stamp above.
      </p>
      ${notes.length ? `<div style="display:flex;flex-direction:column;gap:8px">${notes.map(n => `
        <div class="vt-note" style="display:flex;gap:8px;align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="font-size:10.5px;font-weight:700;color:var(--text-muted);margin-bottom:3px">
              ${escHtml(n.byName || 'Reviewer')}${n.at ? ' · ' + escHtml(vtFmtDate(n.at)) : ''}
            </div>
            <div style="font-size:12.5px;color:var(--text);line-height:1.65;overflow-wrap:anywhere">${vtProse(n.body || '')}</div>
          </div>
          ${vtCanRemoveNote(n) ? `<button type="button" class="btn-secondary btn-sm vt-note-rm" data-nid="${escHtml(n.id || '')}"
              title="Remove this note" aria-label="Remove this review note"
              style="color:var(--danger);min-height:44px;min-width:44px;flex:0 0 auto">${emojiIcon('trash-2', 13)}</button>` : ''}
        </div>`).join('')}</div>`
        : `<div style="font-size:12px;color:var(--text-muted);font-style:italic">No review notes yet.</div>`}
      ${canEdit ? `
        <label class="vt-lbl" style="margin-top:12px">Add a review note</label>
        <textarea class="vt-fld" id="vt-note-input" rows="3"
          placeholder="What you observed, what needs a decision, what to check next. Use **bold** for emphasis."></textarea>
        <div style="margin-top:8px"><button type="button" class="btn-primary btn-sm vt-note-add" style="min-height:44px">${emojiIcon('💬', 15)} Add note</button></div>
      ` : ''}
    </div>`;
}
function vtBindReviewPanel(host, view, ventures, v) {
  view.querySelector('.vt-note-add')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const ta = view.querySelector('#vt-note-input');
    const body = ((ta && ta.value) || '').trim();
    if (!body) { window.Notifs?.showToast?.('Write the note first.', 'error'); return; }
    const me = window._vtCurrentUser || window.currentUser || {};
    const entry = {
      // Collision-free id from Firestore's own generator (the join key the
      // remove path matches on) — the same trick task follow-ups use.
      id: db.collection('ventures').doc().id,
      body,
      byUid: me.uid || '',
      byName: (window.userProfile && window.userProfile.displayName) || me.email || 'Reviewer',
      at: firebase.firestore.Timestamp.now()
    };
    btn.disabled = true;
    try {
      // arrayUnion, not a read-modify-write of the whole array: two reviewers
      // adding a note at the same moment must not overwrite each other.
      await db.collection('ventures').doc(v.id).update({
        reviewNotes: firebase.firestore.FieldValue.arrayUnion(entry),
        reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
        reviewedBy: entry.byName
      });
      if (ta) ta.value = '';
      window.Notifs?.success?.('Review note added');
      reloadVentures(host, v.slug);
    } catch (ex) {
      btn.disabled = false;
      window.Notifs?.showToast?.('Could not add the note — ' + ((ex && (ex.message || ex.code)) || ex), 'error');
    }
  });

  view.querySelectorAll('.vt-note-rm').forEach(b => b.addEventListener('click', async () => {
    const nid = b.dataset.nid;
    if (!(await confirmDialog({ title: 'Remove review note', message: 'Remove this review note? The brief itself is untouched.', danger: true, confirmLabel: 'Remove' }))) return;
    b.disabled = true;
    try {
      // Re-read first and hand arrayRemove the element EXACTLY as the server
      // holds it. arrayRemove matches by deep equality, so removing a note
      // rebuilt from the stale render could silently match nothing; this way it
      // matches, and it is still atomic — a note added by someone else between
      // the read and the write survives, which a read-filter-write would drop.
      const fresh = await db.collection('ventures').doc(v.id).get();
      const arr = (fresh.exists && Array.isArray(fresh.data().reviewNotes)) ? fresh.data().reviewNotes : [];
      const target = arr.find(n => n && n.id === nid);
      if (!target) { window.Notifs?.showToast?.('That note is already gone.'); reloadVentures(host, v.slug); return; }
      await db.collection('ventures').doc(v.id).update({
        reviewNotes: firebase.firestore.FieldValue.arrayRemove(target)
      });
      window.Notifs?.success?.('Note removed');
      reloadVentures(host, v.slug);
    } catch (ex) {
      b.disabled = false;
      window.Notifs?.showToast?.('Could not remove the note — ' + ((ex && (ex.message || ex.code)) || ex), 'error');
    }
  }));
}

// ══════════════════════════════════════════════════
//  Editor — the draw / gather / save triad (sales.js renderSalesSOPEditor)
// ══════════════════════════════════════════════════

// Deep-clone the doc into a working draft so Cancel discards unsaved edits.
// `existing` === null means "new venture": seeded with the outline titles from
// VENTURE_DEFAULT_SECTIONS, bodies empty (a scaffold, never prose).
function openVentureEditor(host, view, ventures, existing) {
  const isNew = !existing;
  const src = existing || {};
  window._vtDraft = {
    id: src.id || null,
    name: src.name || '',
    slug: src.slug || '',
    slugTouched: !!src.slug,      // once the owner edits the slug we stop deriving it
    tagline: src.tagline || '',
    icon: src.icon || '🚀',
    color: vtSafeColor(src.color),
    status: vtStatusMeta(src.status).key,
    stage: src.stage || '',
    summary: src.summary || '',
    sections: Array.isArray(src.sections) && src.sections.length
      ? src.sections.map(s => ({
          title: (s && s.title) || '', body: (s && s.body) || '',
          bullets: Array.isArray(s && s.bullets) ? s.bullets.slice() : [],
          note: (s && s.note) || ''
        }))
      : window.VENTURE_DEFAULT_SECTIONS.map(t => ({ title: t, body: '', bullets: [], note: '' })),
    links: Array.isArray(src.links) && src.links.length
      ? src.links.map(l => ({ label: (l && l.label) || '', url: (l && l.url) || '' }))
      : [],
    fileUrl: src.fileUrl || null,
    // { name, failed, message } while a file has been PICKED but not confirmed
    // attached; null otherwise. Lives on the draft so it survives the full
    // re-render every add-section / reorder / remove-link does. See the
    // attachment-integrity note in drawVentureEditor.
    pendingUpload: null,
    order: isFinite(Number(src.order)) ? Number(src.order) : ventures.length,
  };
  // Slugs already in use by OTHER ventures — the uniqueness set for this edit.
  window._vtTakenSlugs = ventures.filter(v => v.id !== (src.id || null)).map(v => v.slug).filter(Boolean);
  drawVentureEditor(host, view, ventures, isNew);
}

function drawVentureEditor(host, view, ventures, isNew) {
  const d = window._vtDraft;
  if (!d) return;
  const accent = vtSafeColor(d.color);

  const sectionCard = (s, i) => `
    <div class="vt-sec vt-sec-edit" data-si="${i}" style="border-left:4px solid ${accent}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:2px">
        <span style="font-weight:800;color:${accent};font-size:12.5px">Section ${i + 1}</span>
        <span class="vt-actions">
          <button type="button" class="btn-secondary btn-sm vt-mv-up" data-i="${i}" title="Move section up" aria-label="Move section up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="btn-secondary btn-sm vt-mv-down" data-i="${i}" title="Move section down" aria-label="Move section down" ${i === d.sections.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="btn-secondary btn-sm vt-rm-sec" data-i="${i}" title="Remove section" aria-label="Remove section" style="color:var(--danger)">${emojiIcon('trash-2', 14)}</button>
        </span>
      </div>
      <label class="vt-lbl">Section title</label>
      <input class="vt-fld" data-f="title" value="${escHtml(s.title)}" placeholder="e.g. Market &amp; opportunity"/>
      <label class="vt-lbl">Body</label>
      <textarea class="vt-fld" data-f="body" rows="4" placeholder="Write as much as you want. Blank lines are kept.">${escHtml(s.body)}</textarea>
      <label class="vt-lbl">Bullet points (one per line)</label>
      <textarea class="vt-fld" data-f="bullets" rows="3">${escHtml((s.bullets || []).join('\n'))}</textarea>
      <label class="vt-lbl">Side note (optional)</label>
      <input class="vt-fld" data-f="note" value="${escHtml(s.note)}"/>
    </div>`;

  const linkRow = (l, i) => `
    <div class="vt-linkrow vt-link-edit" data-li="${i}">
      <input class="vt-fld" data-lf="label" value="${escHtml(l.label)}" placeholder="Label (e.g. Website)"/>
      <input class="vt-fld" data-lf="url" type="url" value="${escHtml(l.url)}" placeholder="https://…"/>
      <button type="button" class="btn-secondary btn-sm vt-rm-link" data-i="${i}" title="Remove link" aria-label="Remove link" style="color:var(--danger);min-height:44px">${emojiIcon('trash-2', 14)}</button>
    </div>`;

  view.innerHTML = `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:var(--text-muted)">
      ${emojiIcon('✏️', 16)} <b style="color:var(--text)">${isNew ? 'New venture.' : 'Editing this venture.'}</b>
      Documentation only — prose, links and files. Use <code>**bold**</code> for emphasis.
      The outline is a starting point: rename, reorder, add or remove any section.
      <div style="margin-top:6px">
        ${emojiIcon('👀', 14)} Anyone with Ventures access reads this brief — that includes the
        Corporate Secretary, whose access is by ROLE and does not depend on a department
        assignment. Keep figures in Finance: the Finance boundary is drawn around
        collections, not around what a sentence happens to say, so a revenue or margin
        number typed into a section body is simply readable here.
      </div>
    </div>

    <div class="vt-2col">
      <div><label class="vt-lbl">Venture name</label><input class="vt-fld" id="vt-f-name" value="${escHtml(d.name)}" placeholder="e.g. SteelFab.ph"/></div>
      <div><label class="vt-lbl">Link slug (deep link)</label><input class="vt-fld" id="vt-f-slug" value="${escHtml(d.slug)}" placeholder="auto from the name"/></div>
      <div><label class="vt-lbl">Tagline / one-liner</label><input class="vt-fld" id="vt-f-tagline" value="${escHtml(d.tagline)}"/></div>
      <div><label class="vt-lbl">Stage (free text)</label><input class="vt-fld" id="vt-f-stage" value="${escHtml(d.stage)}" placeholder="e.g. Pilot, Year 1, Pre-launch"/></div>
      <div><label class="vt-lbl">Status</label>
        <select class="vt-fld" id="vt-f-status">${window.VENTURE_STATUSES.map(s =>
          `<option value="${s.key}" ${d.status === s.key ? 'selected' : ''}>${escHtml(s.label)}</option>`).join('')}</select>
      </div>
      <div><label class="vt-lbl">Icon (one emoji)</label><input class="vt-fld" id="vt-f-icon" value="${escHtml(d.icon)}" maxlength="4" placeholder="🚀"/></div>
      <div><label class="vt-lbl">Accent colour</label><input class="vt-fld" id="vt-f-color" type="color" value="${accent}" style="padding:4px"/></div>
      <div><label class="vt-lbl">Sort order</label><input class="vt-fld" id="vt-f-order" type="number" inputmode="numeric" value="${escHtml(String(d.order))}"/></div>
    </div>

    <label class="vt-lbl" style="margin-top:16px">Executive summary</label>
    <textarea class="vt-fld" id="vt-f-summary" rows="6" placeholder="The whole venture in a few paragraphs — what it is, why it exists, where it stands.">${escHtml(d.summary)}</textarea>

    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin:20px 0 8px">
      <h4 style="margin:0;font-size:14px;color:var(--text)">Sections (${d.sections.length})</h4>
      <button type="button" class="btn-secondary btn-sm vt-add-sec" style="min-height:44px">+ Add section</button>
    </div>
    <div id="vt-sections" style="display:flex;flex-direction:column;gap:12px">
      ${d.sections.map(sectionCard).join('')}
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin:20px 0 8px">
      <h4 style="margin:0;font-size:14px;color:var(--text)">Links (${d.links.length})</h4>
      <button type="button" class="btn-secondary btn-sm vt-add-link" style="min-height:44px">+ Add link</button>
    </div>
    <div id="vt-links" style="display:flex;flex-direction:column;gap:8px">
      ${d.links.length ? d.links.map(linkRow).join('')
        : `<div style="font-size:12px;color:var(--text-muted)">No links yet.</div>`}
    </div>

    <label class="vt-lbl" style="margin-top:20px">Attachment (one file or link)</label>
    ${d.fileUrl ? `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <a href="${(typeof safeHttpUrl === 'function') ? safeHttpUrl(d.fileUrl) : escHtml(d.fileUrl)}" target="_blank" rel="noopener noreferrer" class="btn-secondary btn-sm" style="min-height:44px;display:inline-flex;align-items:center">${emojiIcon('📎', 14)}&nbsp;Current attachment</a>
        <button type="button" class="btn-secondary btn-sm vt-rm-file" style="color:var(--danger);min-height:44px">Remove</button>
      </div>` : ''}
    <div id="vt-upload-notice"></div>
    <div id="vt-upload"></div>

    <div class="vt-savebar">
      <button type="button" class="btn-primary btn-sm vt-save" style="min-height:44px">${emojiIcon('💾', 16)} ${isNew ? 'Create venture' : 'Save changes'}</button>
      <button type="button" class="btn-secondary btn-sm vt-cancel" style="min-height:44px">Cancel</button>
    </div>
  `;
  if (window.lucide) lucide.createIcons({ nodes: [view] });

  // ── Upload area + ATTACHMENT INTEGRITY ──────────────────────────────────
  // Firebase Storage first, mirrored to Drive nightly (js/drive.js).
  //
  // ⚠ 2026-08-10 — the note that stood here was STALE and actively misleading.
  // It said the Ventures/Briefs/* path was "already covered by storage.rules'
  // generic /{department}/{subfolder}/{fileName} block ('Ventures' is not a
  // reserved top-level segment), so no storage.rules change was needed". Both
  // halves are false: 'Ventures' IS a reserved top-level segment and has its own
  // dedicated block, gated on isMemberOf('Ventures') = isAdminClaim() ||
  // hasClaimDept('Ventures') — and storage.rules' isAdminClaim() is
  // president|manager only, where firestore.rules' isAdmin() also includes
  // 'secretary'. So the two rule files disagree about who may do the same job:
  // Firestore lets the Corporate Secretary read, create, edit and delete a
  // venture brief with no department assignment, and Storage refuses their
  // upload unless their profile carries the Ventures department. That is a
  // storage.rules fix (or a one-click department assignment) and is not made
  // here — this file must not be read as evidence that it is already handled.
  //
  // Independently of who is allowed to upload, the REPORTING was broken, and
  // that half is fixed below. On a refused upload js/drive.js's handleFile
  // paints a red bar with the raw error, hides it after three seconds, raises
  // no toast, and — because it is the SUCCESS callback that carries the URL —
  // never tells this screen anything happened. The draft's fileUrl stayed null,
  // Save then wrote fileUrl:null and reported a cheerful "Venture saved". The
  // brief saved; the document did not, and the user was told otherwise.
  //
  // drive.js is not ours to change, so the PICK is what gets recorded here: a
  // file chosen and never confirmed by the success callback IS an attachment
  // this brief has not got, and that test depends on no message format and no
  // timing. The observer further down only enriches the wording when drive.js
  // does report a failure in its own status line.
  if (window.Drive && window.Drive.renderUploadArea) {
    window.Drive.renderUploadArea('vt-upload', (res) => {
      const d2 = window._vtDraft; if (!d2) return;
      const url = (res && (res.url || res.link)) || null;
      d2.fileUrl = url;
      // Only a real link clears the "not attached" state. A callback that
      // arrives with nothing usable is a failure wearing a success costume.
      d2.pendingUpload = url ? null
        : { name: (res && res.name) || 'the file', failed: true, message: 'The upload returned no link.' };
      vtPaintUploadNotice(view);
    }, { label: 'Attach a document', dept: 'Ventures', subfolder: 'Briefs' });
  }
  vtWatchUpload(view);
  vtPaintUploadNotice(view);

  // Derive the slug from the name until the owner edits the slug themselves.
  const nameEl = view.querySelector('#vt-f-name');
  const slugEl = view.querySelector('#vt-f-slug');
  slugEl?.addEventListener('input', () => { window._vtDraft.slugTouched = true; });
  nameEl?.addEventListener('input', () => {
    const dd = window._vtDraft; if (!dd || dd.slugTouched) return;
    if (slugEl) slugEl.value = vtSlugify(nameEl.value);
  });
  // Live accent preview so the colour picker reads as connected to the page.
  view.querySelector('#vt-f-color')?.addEventListener('input', (e) => {
    const c = vtSafeColor(e.target.value);
    view.querySelectorAll('.vt-sec-edit').forEach(el => { el.style.borderLeftColor = c; });
  });

  // Gather BEFORE every redraw so in-progress typing survives structural edits.
  view.querySelector('.vt-add-sec')?.addEventListener('click', () => {
    vtGatherDOM(view);
    window._vtDraft.sections.push({ title: '', body: '', bullets: [], note: '' });
    drawVentureEditor(host, view, ventures, isNew);
  });
  view.querySelectorAll('.vt-rm-sec').forEach(b => b.addEventListener('click', () => {
    vtGatherDOM(view);
    window._vtDraft.sections.splice(Number(b.dataset.i), 1);
    drawVentureEditor(host, view, ventures, isNew);
  }));
  view.querySelectorAll('.vt-mv-up').forEach(b => b.addEventListener('click', () => {
    vtGatherDOM(view);
    const a = window._vtDraft.sections, i = Number(b.dataset.i);
    if (i > 0) { const t = a[i - 1]; a[i - 1] = a[i]; a[i] = t; }
    drawVentureEditor(host, view, ventures, isNew);
  }));
  view.querySelectorAll('.vt-mv-down').forEach(b => b.addEventListener('click', () => {
    vtGatherDOM(view);
    const a = window._vtDraft.sections, i = Number(b.dataset.i);
    if (i < a.length - 1) { const t = a[i + 1]; a[i + 1] = a[i]; a[i] = t; }
    drawVentureEditor(host, view, ventures, isNew);
  }));
  view.querySelector('.vt-add-link')?.addEventListener('click', () => {
    vtGatherDOM(view);
    window._vtDraft.links.push({ label: '', url: '' });
    drawVentureEditor(host, view, ventures, isNew);
  });
  view.querySelectorAll('.vt-rm-link').forEach(b => b.addEventListener('click', () => {
    vtGatherDOM(view);
    window._vtDraft.links.splice(Number(b.dataset.i), 1);
    drawVentureEditor(host, view, ventures, isNew);
  }));
  view.querySelector('.vt-rm-file')?.addEventListener('click', () => {
    vtGatherDOM(view);
    window._vtDraft.fileUrl = null;
    drawVentureEditor(host, view, ventures, isNew);
  });

  view.querySelector('.vt-save')?.addEventListener('click', () => vtSaveVenture(host, view, ventures, isNew));
  view.querySelector('.vt-cancel')?.addEventListener('click', () => {
    const d3 = window._vtDraft;
    window._vtDraft = null;
    // Back to where they came from: the brief for an existing venture,
    // the portfolio for an abandoned new one.
    if (d3 && d3.id) {
      const v = ventures.find(x => x.id === d3.id);
      if (v) { drawVentureBrief(host, view, ventures, v); return; }
    }
    drawVenturePortfolio(host, view, ventures);
  });
}

// ── Attachment integrity helpers (see the long note in drawVentureEditor) ──
// One observer at a time: drawVentureEditor rebuilds the whole view (and with
// it drive.js's status node) on every add-section / reorder / remove-link, so
// the previous one is dropped rather than left watching a detached node.
let _vtUploadObs = null;
function vtWatchUpload(view) {
  if (_vtUploadObs) { try { _vtUploadObs.disconnect(); } catch (_) {} _vtUploadObs = null; }
  if (!view) return;
  // drive.js builds these ids from the container id it was handed ('vt-upload').
  const input  = view.querySelector('#file-input-vt-upload');
  const label  = view.querySelector('#upload-label-vt-upload');
  const status = view.querySelector('#upload-status-vt-upload');

  // A pick is a promise of an attachment. It is kept only when the success
  // callback lands; until then this brief does not have the file, and Save
  // below must not claim otherwise.
  const markPending = (file) => {
    const d = window._vtDraft; if (!d || !file) return;
    d.pendingUpload = { name: file.name || 'the file', failed: false, message: '' };
    vtPaintUploadNotice(view);
  };
  input?.addEventListener('change', (e) => markPending(e.target.files && e.target.files[0]));
  label?.addEventListener('drop', (e) => markPending(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]));

  // Enrichment only. drive.js writes its outcome into that status line and then
  // hides the whole bar three seconds later; watching the text is how the real
  // reason survives past those three seconds and onto a notice that stays put.
  // If this never fires (different message wording, no MutationObserver), the
  // pending flag above still does the load-bearing work on its own.
  if (status && typeof MutationObserver === 'function') {
    _vtUploadObs = new MutationObserver(() => {
      const d = window._vtDraft; if (!d || !d.pendingUpload) return;
      const txt = (status.textContent || '').trim();
      if (!/^❌|upload failed/i.test(txt)) return;
      d.pendingUpload.failed = true;
      d.pendingUpload.message = txt.replace(/^❌\s*/, '');
      vtPaintUploadNotice(view);
    });
    _vtUploadObs.observe(status, { childList: true, characterData: true, subtree: true });
  }
}
// The persistent counterpart to drive.js's three-second bar. Rendered from the
// draft, so it survives every editor redraw and is still on screen at the moment
// the user reaches for Save.
function vtPaintUploadNotice(view) {
  const host = view && view.querySelector('#vt-upload-notice');
  if (!host) return;
  const p = window._vtDraft && window._vtDraft.pendingUpload;
  if (!p) { host.innerHTML = ''; return; }
  const danger = !!p.failed;
  host.innerHTML = `
    <div style="margin-bottom:8px;padding:9px 12px;border-radius:10px;line-height:1.55;font-size:12px;
                border:1px solid ${danger ? 'var(--danger,#FF3B30)' : 'var(--border)'};
                background:var(--surface2);color:var(--text)">
      <b>${danger ? 'Not attached' : 'Still uploading'}:</b> ${escHtml(p.name)}.
      ${danger
        ? `This file was refused by Storage, so the brief does not have it${p.message ? ' — ' + escHtml(p.message) : ''}. Saving now saves everything else <b>without</b> this attachment. If this keeps happening, the Ventures folder permission is the thing to fix, not the file.`
        : `Wait for the upload to finish before saving — a save right now would leave the file off the brief.`}
    </div>`;
}

// Read the editor inputs back into the working draft. EVERY lookup is scoped
// to `view` (never document.*), so this stays correct even if this screen is
// ever hosted somewhere a second instance can exist — see this file's header.
function vtGatherDOM(view) {
  const d = window._vtDraft;
  if (!d || !view) return d;
  const val = (sel) => { const el = view.querySelector(sel); return el ? el.value : undefined; };
  const set = (key, sel, transform) => {
    const v = val(sel);
    if (v === undefined) return;
    d[key] = transform ? transform(v) : v;
  };

  set('name', '#vt-f-name', s => s.trim());
  set('slug', '#vt-f-slug', s => vtSlugify(s));
  set('tagline', '#vt-f-tagline', s => s.trim());
  set('stage', '#vt-f-stage', s => s.trim());
  set('status', '#vt-f-status', s => vtStatusMeta(s).key);
  set('icon', '#vt-f-icon', s => s.trim());
  set('color', '#vt-f-color', s => vtSafeColor(s));
  set('summary', '#vt-f-summary');
  set('order', '#vt-f-order', s => { const n = Number(s); return isFinite(n) ? n : 0; });

  view.querySelectorAll('.vt-sec-edit').forEach(card => {
    const i = Number(card.dataset.si);
    const s = d.sections[i];
    if (!s) return;
    card.querySelectorAll('[data-f]').forEach(inp => {
      const f = inp.dataset.f;
      if (f === 'bullets') s.bullets = inp.value.split('\n').map(x => x.trim()).filter(Boolean);
      else s[f] = inp.value;
    });
  });

  view.querySelectorAll('.vt-link-edit').forEach(row => {
    const i = Number(row.dataset.li);
    const l = d.links[i];
    if (!l) return;
    row.querySelectorAll('[data-lf]').forEach(inp => { l[inp.dataset.lf] = inp.value.trim(); });
  });

  return d;
}
// Exposed for the dev harness (dev/_ventures_preview.html) to assert the
// draw → edit → gather round-trip without Firebase.
window._vtGatherDOM = vtGatherDOM;

async function vtSaveVenture(host, view, ventures, isNew) {
  vtGatherDOM(view);
  const d = window._vtDraft;
  if (!d) return;

  if (!d.name) { window.Notifs?.showToast?.('Venture name is required.', 'error'); return; }
  // Slug is the deep-link key, so it must exist and be unique.
  d.slug = vtUniqueSlug(d.slug || d.name, window._vtTakenSlugs || []);
  // Drop sections that are entirely empty (same rule as salesSopSave).
  d.sections = (d.sections || []).filter(s =>
    (s.title || '').trim() || (s.body || '').trim() || (s.bullets || []).length || (s.note || '').trim());
  // Keep only links that carry a usable http(s) URL.
  d.links = (d.links || [])
    .map(l => ({ label: (l.label || '').trim(), url: (l.url || '').trim() }))
    .filter(l => ((typeof safeHttpUrl === 'function') ? safeHttpUrl(l.url) : l.url));

  // ── A save that lost a file must not report success ──────────────────────
  // pendingUpload is set the moment a file is picked and cleared only when the
  // upload confirms (see the attachment-integrity note in drawVentureEditor).
  // Still set at Save time means one of two things — the upload was refused, or
  // it is still in flight — and in BOTH the brief is about to be written
  // without the document the user believes they attached. So it is said out
  // loud, before the write, and the outcome toast at the bottom is downgraded
  // if they choose to go ahead anyway. Their prose is never thrown away: the
  // only two outcomes are "save without the file" and "go back to the editor".
  const lostFile = d.pendingUpload;
  if (lostFile) {
    const ok = await confirmDialog({
      title: lostFile.failed ? 'Attachment was not uploaded' : 'Attachment is still uploading',
      message: lostFile.failed
        ? `“${lostFile.name}” was refused and is not attached to this venture. Saving now saves the brief WITHOUT it.`
        : `“${lostFile.name}” has not finished uploading. Saving now saves the brief WITHOUT it.`,
      danger: true, confirmLabel: 'Save without the file', cancelLabel: 'Go back'
    });
    if (!ok) return;
  }

  const btn = view.querySelector('.vt-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  const actor = (window._vtCurrentUser && window._vtCurrentUser.email)
    || (window.currentUser && window.currentUser.email) || '';
  const payload = {
    name: d.name, slug: d.slug, tagline: d.tagline || '', icon: d.icon || '🚀',
    color: vtSafeColor(d.color), status: vtStatusMeta(d.status).key, stage: d.stage || '',
    summary: d.summary || '', sections: d.sections, links: d.links,
    fileUrl: d.fileUrl || null, order: isFinite(Number(d.order)) ? Number(d.order) : 0,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: actor,
  };

  try {
    if (d.id) {
      await db.collection('ventures').doc(d.id).update(payload);
      window.logAudit && window.logAudit('update', 'venture', d.id, { name: d.name, status: payload.status });
    } else {
      payload.createdBy = (window._vtCurrentUser && window._vtCurrentUser.uid)
        || (window.currentUser && window.currentUser.uid) || '';
      payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      const ref = await db.collection('ventures').add(payload);
      window.logAudit && window.logAudit('create', 'venture', ref.id, { name: d.name });
    }
    const slug = d.slug;
    window._vtDraft = null;
    // The write succeeded — but "saved" is only the whole truth when nothing
    // was lost on the way. An error-styled toast naming the missing file is
    // what stops the user walking away believing the document is filed.
    if (lostFile) {
      window.Notifs?.showToast?.(
        `${isNew ? 'Venture created' : 'Venture saved'} — but “${lostFile.name}” was NOT attached. Re-attach it when the upload works.`,
        'error');
    } else {
      window.Notifs?.success?.(isNew ? 'Venture created' : 'Venture saved');
    }
    window.setSubroute(slug);
    // Re-fetch so the chip row picks up a renamed / brand-new venture.
    reloadVentures(host, slug);
  } catch (ex) {
    window.Notifs?.showToast?.('Save failed — ' + ((ex && (ex.message || ex.code)) || ex), 'error');
    if (btn) { btn.disabled = false; btn.textContent = isNew ? 'Create venture' : 'Save changes'; }
  }
}

// ══════════════════════════════════════════════════
//  Printable brief
//  Routed through window.openPrintableDoc (js/print-docs.js) — window.print()
//  is a NO-OP inside the iOS home-screen webview, which is where this is read.
// ══════════════════════════════════════════════════
function openVenturePrintBrief(v) {
  const e = s => escHtml(s);
  const todayStr = (window.bizDate ? window.bizDate() : new Date().toISOString().slice(0, 10));
  const st = vtStatusMeta(v.status);
  const secs = (Array.isArray(v.sections) ? v.sections : []);
  const links = (Array.isArray(v.links) ? v.links : [])
    .map(l => ({ label: (l && l.label) || '', url: (typeof safeHttpUrl === 'function') ? safeHttpUrl(l && l.url) : ((l && l.url) || '') }))
    .filter(l => l.url);

  const _lh = window.buildLetterhead ? window.buildLetterhead({
    orientation: 'portrait',
    docTitle: 'VENTURE BRIEF — ' + String(v.name || '').toUpperCase(),
    dateLabel: 'As of ' + todayStr,
    extraMeta: [st.label + (v.stage ? ' · ' + v.stage : '')],
    signatures: [{ label: 'Prepared by', name: (window.userProfile && userProfile.displayName) || '', title: 'Ventures' }],
    footerNote: ((window.BRAND && window.BRAND.fullName) || 'Barro Industries Operating System') +
      ' · Generated ' + new Date().toLocaleString('en-PH') + ' · Internal venture documentation.'
  }) : null;

  const pageCss = `
  .page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:12mm 14mm}
  .vb-h1{font-size:20px;font-weight:900;color:#1E3A5F;margin:0}
  .vb-tag{font-size:11px;color:#555;margin:2px 0 0}
  .vb-meta{font-size:10px;color:#555;margin:6px 0 12px}
  .vb-sec{margin:0 0 12px;page-break-inside:avoid;break-inside:avoid}
  .vb-sec h3{font-size:12.5px;color:#1E3A5F;margin:0 0 4px;border-bottom:1px solid #ccc;padding-bottom:2px}
  .vb-sec p{font-size:10.5px;line-height:1.65;margin:0 0 5px;color:#111}
  .vb-sec ul{margin:0 0 5px;padding-left:16px;font-size:10.5px;line-height:1.6;color:#111}
  .vb-note{font-size:9.5px;color:#444;background:#f4f4f4;padding:5px 8px;border-radius:4px}
${_lh ? _lh.printCSS : ''}
  @media print{ .page{padding:0;width:auto;min-height:0} }`;

  const bodyHtml = `
  ${_lh ? _lh.headerHTML : `<div style="border-bottom:3px solid #1E3A5F;padding-bottom:8px;margin-bottom:10px">
      <div style="font-size:20px;font-weight:900;color:#1E3A5F">BARRO INDUSTRIES</div>
      <div style="font-size:10px;color:#555">Venture Brief · ${e(todayStr)}</div>
    </div>`}
  <div class="vb-sec">
    <div class="vb-h1">${e(v.name || 'Venture')}</div>
    ${v.tagline ? `<div class="vb-tag">${e(v.tagline)}</div>` : ''}
    <div class="vb-meta">Status: ${e(st.label)}${v.stage ? ' · Stage: ' + e(v.stage) : ''}${v.updatedAt ? ' · Updated ' + e(vtFmtDate(v.updatedAt)) : ''}</div>
  </div>
  <div class="vb-sec">
    <h3>Executive summary</h3>
    <p>${v.summary ? vtProse(v.summary) : '<i>Not written yet.</i>'}</p>
  </div>
  ${secs.map(s => {
    const bl = Array.isArray(s && s.bullets) ? s.bullets.filter(Boolean) : [];
    if (!(s && ((s.title || '').trim() || (s.body || '').trim() || bl.length || (s.note || '').trim()))) return '';
    return `<div class="vb-sec">
      ${s.title ? `<h3>${e(s.title)}</h3>` : ''}
      ${s.body ? `<p>${vtProse(s.body)}</p>` : ''}
      ${bl.length ? `<ul>${bl.map(b => `<li>${vtFmt(b)}</li>`).join('')}</ul>` : ''}
      ${s.note ? `<div class="vb-note">${vtFmt(s.note)}</div>` : ''}
    </div>`;
  }).join('')}
  ${links.length ? `<div class="vb-sec"><h3>Links</h3><ul>${links.map(l => `<li>${e(l.label || '')}${l.label ? ' — ' : ''}${e(l.url)}</li>`).join('')}</ul></div>` : ''}
  ${_lh ? _lh.footerHTML : ''}`;

  window.openPrintableDoc({
    title: `Venture Brief — ${v.name || 'Venture'} — ${todayStr}`,
    barLabel: `${emojiIcon('🚀', 16)} Venture Brief — ${escHtml(v.name || 'Venture')}`,
    bodyHtml, pageCss,
    winFeatures: 'width=900,height=1000'
  });
}
window.openVenturePrintBrief = openVenturePrintBrief;
