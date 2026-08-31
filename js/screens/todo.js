/* ═══════════════════════════════════════════════════
   BARRO INDUSTRIES — Personal To-Do
   js/screens/todo.js

   NEW 2026-09-01 (owner: "can this be added on the barro system — its in
   president only — add as personal to-do — should be on the app drawer").
   A private personal checklist, distinct from the department Tasks boards
   the system already has. The drawer entry is president-only (NAV_REGISTRY
   when:'isPresident'); the data is OWNER-only either way — firestore.rules
   scopes personal_todos/{uid}/items to request.auth.uid == uid, same
   privacy stance as Notes, so opening the feature to staff later is a nav
   change, not a rules change.

   Free text is rendered via innerHTML — every interpolation goes through
   escHtml(). Items live under the signed-in uid; the one query is
   owner-scoped so it is provable under the rules with no composite index
   (single orderBy createdAt).

   2026-09-01 BOARD-PARITY UPGRADE (PERSONAL-TODO-PARITY-SPEC-2026-09-01.md).
   Ported the shape of Neil's Barro Kitchens job-board artifact onto this
   screen: each item now also carries an area category (cat), a rush flag,
   a free-text note, and a sub-task checklist (subs), plus a one-time JSON
   Import panel that accepts the board's own "Export tasks" output. Legacy
   docs (text/done/dates only) are normalized on load — absent fields
   default to cat:'general', rush:false, note:'', subs:[]. The personal_todos/
   {uid} PARENT doc is now created (once per session, best-effort) before the
   first write purely so monthly-backup.js's collection .get() can see the
   uid at all — a parentless subcollection is invisible to that walk, so
   items were silently never backed up before this fix.

   2026-09-01 VISUAL RULING (mid-build, supersedes only the app-card styling
   from the original board-parity spec — the data model, handlers, escaping,
   optimistic-write/rollback pattern, and the parent-doc backup fix above are
   all unchanged). Neil, looking at the interim app-card screen, pointed at
   the ORIGINAL Barro Kitchens board artifact and said "keep it like this" —
   the screen must visually replicate the board's own look, not the app's
   .card vocabulary. Everything below is a self-contained "board" skin:
     - _todoInjectStyles() injects a Google Fonts <link> and a single scoped
       <style id="todoBoardCss"> block, both guarded by an id check so a
       repaint (or a second visit to the screen) never double-inserts them.
       Every CSS rule lives under a .todo-board root class so nothing here
       can leak onto any other screen.
     - Palette is entirely CSS custom properties on .todo-board (dark values,
       matching the app's dark-first :root default) overridden under
       html.light .todo-board (this app's real theme-class convention — see
       css/tokens.css's header comment — html.theme-astral intentionally
       gets no override and falls through to the same dark set as the base
       dark theme, per the owner's ruling).
     - DEVIATION FLAGGED: the filter chip row is hand-built (.tb-chip) rather
       than window.chipTabs()/bindChipTabs() — the ruling explicitly asked
       for the board's own small rectangular swatch-chip look ("visual parity
       beats the house helper here"), which chipTabs' pill/count styling
       cannot produce. todoFilterSet() is a new window-attached handler that
       replaces the old bindChipTabs wiring; behaviour (single active filter,
       repaint on select) is identical.
     - CORRECTED read of the ruling: "active chip = inverted (ink bg / paper
       text)" is implemented as ink-bg / **panel**-text, not paper-text.
       --tb-paper is explicitly transparent in the dark palette ("let the app
       ground show"), so paper text on an ink chip would be invisible in
       dark/astral. --tb-panel is opaque in both themes and is the same
       relationship the ruling was reaching for (a light chip needs a dark
       label and vice versa) — this reads as a naming slip in the ruling,
       not an intentional invisible-text instruction, so the smallest fix is
       swapping the one token rather than leaving inverted chips illegible
       for two of the app's three themes.
     - The native checkbox inputs (row + sub-step) keep their real
       <input type="checkbox"> element and onchange="todoToggle(...)" /
       onchange="todoSubToggle(...)" wiring — full appearance:none + a
       data-URI checkmark for the board's square/filled look, so keyboard
       and screen-reader semantics (and every already-verified handler
       binding) are untouched by the restyle.
   ═══════════════════════════════════════════════════ */

const TODO_CATS = {
  production: { label: 'Production' },
  sales:      { label: 'Sales' },
  design:     { label: 'Design' },
  purchasing: { label: 'Purchasing' },
  delivery:   { label: 'Delivery' },
  general:    { label: 'General' }
};

let _todoItems = [];        // [{id, text, done, createdAt, doneAt, updatedAt, cat, rush, note, subs}]
let _todoLoaded = false;
let _todoFilter = 'all';    // area filter: 'all' | one of TODO_CATS keys
let _todoExpanded = {};     // id -> true when its detail (note/steps) is open
let _todoNoteTimers = {};   // id -> debounce timeout for note saves
let _todoParentEnsured = false;
let _todoImportOpen = false;
let _todoLastCat = 'general'; // last-used Add-bar category, kept across paints

function _todoCol() {
  return db.collection('personal_todos').doc(currentUser.uid).collection('items');
}

// Legacy docs only ever had text/done/createdAt/doneAt/updatedAt — normalize
// every load so the rest of this file can assume the board-parity fields are
// always present.
function _todoNormalize(raw) {
  return {
    id: raw.id,
    text: raw.text || '',
    done: !!raw.done,
    createdAt: raw.createdAt || '',
    doneAt: raw.doneAt || '',
    updatedAt: raw.updatedAt || '',
    cat: (raw.cat && TODO_CATS[raw.cat]) ? raw.cat : 'general',
    rush: !!raw.rush,
    note: raw.note || '',
    subs: Array.isArray(raw.subs) ? raw.subs : []
  };
}

// Best-effort, once per session, before the first successful write (add or
// import). A failure here must never block the actual item write — it just
// means the {uid} parent doc (which exists ONLY so monthly-backup's
// collection .get() surfaces this uid) doesn't get created this time, so the
// flag is cleared to retry on the next write.
function _todoEnsureParent() {
  if (_todoParentEnsured) return Promise.resolve();
  _todoParentEnsured = true;
  return db.collection('personal_todos').doc(currentUser.uid)
    .set({ owner: currentUser.uid, createdAt: new Date().toISOString() }, { merge: true })
    .catch(() => { _todoParentEnsured = false; });
}

function _todoFmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

// ── Board skin: fonts + scoped stylesheet, injected once ───────────────────
function _todoInjectStyles() {
  if (!document.getElementById('todoBoardFonts')) {
    const link = document.createElement('link');
    link.id = 'todoBoardFonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap';
    document.head.appendChild(link);
  }
  if (document.getElementById('todoBoardCss')) return;
  const s = document.createElement('style');
  s.id = 'todoBoardCss';
  s.textContent = `
.todo-board{
  --tb-paper:transparent; --tb-panel:#1A2028; --tb-ink:#E6EBF0; --tb-steel:#93A2B4;
  --tb-line:#2A3340; --tb-accent:#4D9CE0; --tb-rush:#F0913A; --tb-rush-ink:#14100A; --tb-done:#58BD8B;
  --tb-cat-production:#8FA9C4; --tb-cat-sales:#3FBCA9; --tb-cat-design:#A78BE8;
  --tb-cat-purchasing:#D9A03C; --tb-cat-delivery:#E58AB8; --tb-cat-general:#93A5B8;
  max-width:640px; margin:0 auto; padding:20px 22px; border-radius:4px;
  background:var(--tb-paper); color:var(--tb-ink);
  font-family:'Barlow',system-ui,sans-serif;
}
html.light .todo-board{
  --tb-paper:#F2F4F7; --tb-panel:#FFFFFF; --tb-ink:#1A222E; --tb-steel:#64748B;
  --tb-line:#D8DEE7; --tb-accent:#0F62B0; --tb-rush:#C25E0A; --tb-rush-ink:#FFFFFF; --tb-done:#2E7D52;
  --tb-cat-production:#4A6785; --tb-cat-sales:#0E7C6E; --tb-cat-design:#6E4FBF;
  --tb-cat-purchasing:#8A5D07; --tb-cat-delivery:#B34A83; --tb-cat-general:#5B6B7C;
}
.todo-board .tb-cond{ font-family:'Barlow Condensed','Arial Narrow',sans-serif; }
.todo-board .tb-mono{ font-family:'IBM Plex Mono',ui-monospace,monospace; font-variant-numeric:tabular-nums; }

.todo-board .tb-head{ display:flex; align-items:flex-end; justify-content:space-between; gap:16px; }
.todo-board .tb-eyebrow{ font-family:'Barlow Condensed','Arial Narrow',sans-serif; font-size:10.5px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--tb-steel); margin:0 0 4px; }
.todo-board .tb-title{ font-family:'Barlow Condensed','Arial Narrow',sans-serif; font-weight:700; font-size:32px; line-height:1; letter-spacing:.01em; text-transform:uppercase; color:var(--tb-ink); margin:0; }
.todo-board .tb-openbox{ text-align:right; flex-shrink:0; }
.todo-board .tb-opennum{ font-family:'IBM Plex Mono',ui-monospace,monospace; font-variant-numeric:tabular-nums; font-size:28px; font-weight:500; line-height:1; color:var(--tb-accent); }
.todo-board .tb-openlabel{ font-family:'Barlow Condensed','Arial Narrow',sans-serif; font-size:10px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:var(--tb-steel); margin-top:3px; }
.todo-board .tb-importlink{ display:block; margin:7px 0 0; margin-left:auto; background:none; border:none; cursor:pointer; padding:0; font-family:'Barlow Condensed','Arial Narrow',sans-serif; font-size:10.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--tb-accent); }
.todo-board .tb-importlink:hover{ text-decoration:underline; }

.todo-board .tb-rule-strong{ height:2px; background:var(--tb-ink); margin-top:10px; }
.todo-board .tb-rule-thin{ height:1px; background:var(--tb-line); margin-top:3px; margin-bottom:16px; }

.todo-board .tb-import{ border:1px dashed var(--tb-line); border-radius:3px; padding:14px; margin-bottom:16px; }
.todo-board .tb-import-hint{ font-size:12.5px; color:var(--tb-steel); margin-bottom:8px; line-height:1.5; }
.todo-board .tb-import-box{ width:100%; min-height:90px; resize:vertical; font-family:'IBM Plex Mono',ui-monospace,monospace; font-size:12px; padding:8px 10px; border:1px solid var(--tb-line); border-radius:2px; background:var(--tb-panel); color:var(--tb-ink); }
.todo-board .tb-import-actions{ display:flex; gap:8px; margin-top:10px; }

.todo-board .tb-addbar{ display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
.todo-board .tb-input{ flex:1; min-width:160px; font-family:'Barlow',system-ui,sans-serif; font-size:14px; padding:9px 12px; border:1px solid var(--tb-line); border-radius:2px; background:var(--tb-panel); color:var(--tb-ink); }
.todo-board .tb-select{ font-family:'Barlow Condensed','Arial Narrow',sans-serif; text-transform:uppercase; letter-spacing:.03em; font-size:12.5px; font-weight:600; padding:9px 10px; border:1px solid var(--tb-line); border-radius:2px; background:var(--tb-panel); color:var(--tb-ink); }
.todo-board .tb-btn-accent{ font-family:'Barlow Condensed','Arial Narrow',sans-serif; text-transform:uppercase; letter-spacing:.04em; font-weight:700; font-size:13px; padding:9px 18px; border:none; border-radius:2px; background:var(--tb-accent); color:#fff; cursor:pointer; }
.todo-board .tb-btn-accent:hover{ filter:brightness(1.08); }
.todo-board .tb-btn-outline{ font-family:'Barlow Condensed','Arial Narrow',sans-serif; text-transform:uppercase; letter-spacing:.04em; font-weight:700; font-size:13px; padding:9px 18px; border:1px solid var(--tb-line); border-radius:2px; background:transparent; color:var(--tb-ink); cursor:pointer; }

.todo-board .tb-chips{ display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px; }
.todo-board .tb-chip{ display:inline-flex; align-items:center; gap:6px; font-family:'Barlow Condensed','Arial Narrow',sans-serif; text-transform:uppercase; letter-spacing:.04em; font-weight:600; font-size:11.5px; padding:5px 10px; border:1px solid var(--tb-line); border-radius:2px; background:var(--tb-panel); color:var(--tb-ink); cursor:pointer; }
.todo-board .tb-chip.active{ background:var(--tb-ink); border-color:var(--tb-ink); color:var(--tb-panel); }
.todo-board .tb-chip-swatch{ width:8px; height:8px; border-radius:1px; display:inline-block; flex-shrink:0; }
.todo-board .tb-chip-count{ font-family:'IBM Plex Mono',ui-monospace,monospace; opacity:.75; font-size:10.5px; }

.todo-board .tb-empty{ text-align:center; font-size:13px; color:var(--tb-steel); padding:22px 0; }

.todo-board .tb-row{ border-bottom:1px solid var(--tb-line); padding:11px 2px; }
.todo-board .tb-list .tb-row:first-child{ border-top:1px solid var(--tb-line); }
.todo-board .tb-row.tb-row-rush{ box-shadow:inset 3px 0 0 var(--tb-rush); padding-left:11px; }
.todo-board .tb-row-main{ display:flex; align-items:flex-start; gap:10px; }
.todo-board .tb-check{ -webkit-appearance:none; -moz-appearance:none; appearance:none; width:20px; height:20px; flex-shrink:0; margin:1px 0 0; border:2px solid var(--tb-steel); border-radius:2px; background-color:transparent; cursor:pointer; }
.todo-board .tb-check:checked{ background-color:var(--tb-done); border-color:var(--tb-done); background-repeat:no-repeat; background-position:center; background-size:12px 12px; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.3l3 3 6-6.6' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); }
.todo-board .tb-check:focus-visible{ outline:2px solid var(--tb-accent); outline-offset:2px; }
.todo-board .tb-row-body{ flex:1; min-width:0; cursor:pointer; }
.todo-board .tb-row-text{ font-family:'Barlow',system-ui,sans-serif; font-size:14.5px; font-weight:500; color:var(--tb-ink); }
.todo-board .tb-row-text.done{ text-decoration:line-through; color:var(--tb-steel); }
.todo-board .tb-row-meta{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:5px; font-size:11px; color:var(--tb-steel); }
.todo-board .tb-tag{ font-family:'Barlow Condensed','Arial Narrow',sans-serif; text-transform:uppercase; letter-spacing:.04em; font-weight:700; font-size:10px; padding:1px 7px; border-radius:2px; }
.todo-board .tb-date, .todo-board .tb-steps-ct{ font-family:'IBM Plex Mono',ui-monospace,monospace; font-size:10.5px; }
.todo-board .tb-chevron{ display:inline-block; color:var(--tb-steel); font-size:11px; transition:transform .15s; }
.todo-board .tb-chevron.open{ transform:rotate(180deg); }
.todo-board .tb-row-actions{ display:flex; align-items:center; gap:6px; flex-shrink:0; margin-top:1px; }
.todo-board .tb-rush-pill{ font-family:'Barlow Condensed','Arial Narrow',sans-serif; text-transform:uppercase; letter-spacing:.05em; font-weight:800; font-size:10px; padding:2px 9px; border:1px solid var(--tb-rush); border-radius:3px; background:transparent; color:var(--tb-rush); cursor:pointer; }
.todo-board .tb-rush-pill.active{ background:var(--tb-rush); color:var(--tb-rush-ink); }
.todo-board .tb-del{ background:none; border:none; cursor:pointer; color:var(--tb-steel); font-size:16px; line-height:1; padding:2px 5px; }
.todo-board .tb-del:hover{ color:var(--tb-rush); }

.todo-board .tb-detail{ margin:8px 0 6px 30px; padding:10px 0 4px 12px; border-left:2px solid var(--tb-line); display:flex; flex-direction:column; gap:10px; }
.todo-board .tb-note{ width:100%; min-height:60px; resize:none; overflow:hidden; font-family:'Barlow',system-ui,sans-serif; font-size:13px; padding:8px 10px; border:1px solid var(--tb-line); border-radius:2px; background:var(--tb-panel); color:var(--tb-ink); }
.todo-board .tb-step-row{ display:flex; align-items:center; gap:8px; padding:3px 0; }
.todo-board .tb-step-check{ -webkit-appearance:none; -moz-appearance:none; appearance:none; width:16px; height:16px; flex-shrink:0; border:2px solid var(--tb-steel); border-radius:2px; background-color:transparent; cursor:pointer; }
.todo-board .tb-step-check:checked{ background-color:var(--tb-done); border-color:var(--tb-done); background-repeat:no-repeat; background-position:center; background-size:10px 10px; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3.5 8.3l3 3 6-6.6' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); }
.todo-board .tb-step-text{ flex:1; min-width:0; font-family:'Barlow',system-ui,sans-serif; font-size:13px; color:var(--tb-ink); }
.todo-board .tb-step-text.done{ text-decoration:line-through; color:var(--tb-steel); }
.todo-board .tb-step-del{ background:none; border:none; cursor:pointer; color:var(--tb-steel); font-size:13px; padding:0 4px; }
.todo-board .tb-step-add{ display:flex; gap:6px; margin-top:4px; }
.todo-board .tb-step-input{ flex:1; min-width:0; font-family:'Barlow',system-ui,sans-serif; font-size:13px; padding:6px 9px; border:1px dashed var(--tb-line); border-radius:2px; background:var(--tb-panel); color:var(--tb-ink); }
.todo-board .tb-step-addbtn{ font-family:'Barlow Condensed','Arial Narrow',sans-serif; text-transform:uppercase; letter-spacing:.04em; font-weight:700; font-size:11px; padding:6px 10px; border:1px solid var(--tb-line); border-radius:2px; background:transparent; color:var(--tb-ink); cursor:pointer; }

.todo-board .tb-donehead{ display:flex; align-items:center; justify-content:space-between; margin-top:22px; padding-top:12px; border-top:1px solid var(--tb-line); margin-bottom:6px; }
.todo-board .tb-donehead-label{ font-family:'Barlow Condensed','Arial Narrow',sans-serif; text-transform:uppercase; letter-spacing:.06em; font-weight:700; font-size:11px; color:var(--tb-steel); }
.todo-board .tb-clearlink{ background:none; border:none; cursor:pointer; font-family:'Barlow',system-ui,sans-serif; font-size:11.5px; text-decoration:underline; color:var(--tb-steel); }
`;
  document.head.appendChild(s);
}

function _todoCatChip(cat) {
  const key = TODO_CATS[cat] ? cat : 'general';
  return `<span class="tb-tag" style="background:color-mix(in srgb, var(--tb-cat-${key}) 14%, transparent);color:var(--tb-cat-${key})">${escHtml(TODO_CATS[key].label)}</span>`;
}

function _todoAutoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function _todoSubRow(itemId, s) {
  const iid = escHtml(itemId);
  const sid = escHtml(s.id);
  return `
    <div class="tb-step-row">
      <input type="checkbox" class="tb-step-check" ${s.done ? 'checked' : ''} onchange="todoSubToggle('${iid}','${sid}')" aria-label="Step done">
      <div class="tb-step-text${s.done ? ' done' : ''}">${escHtml(s.text || '')}</div>
      <button type="button" class="tb-step-del" onclick="todoSubDelete('${iid}','${sid}')" title="Delete step">✕</button>
    </div>`;
}

function _todoDetail(it) {
  const id = escHtml(it.id);
  const noteVal = escHtml(it.note || '');
  const subs = it.subs || [];
  const subsHtml = subs.map(s => _todoSubRow(it.id, s)).join('');
  return `
    <div class="tb-detail">
      <textarea id="todoNote-${id}" class="tb-note" placeholder="Notes — measurements, client details, blockers…" maxlength="2000"
        oninput="todoNoteInput('${id}', this)"
      >${noteVal}</textarea>
      <div>
        ${subsHtml}
        <div class="tb-step-add">
          <input id="todoSubNew-${id}" class="tb-step-input" placeholder="Add a step" maxlength="200"
            onkeydown="if(event.key==='Enter')todoSubAdd('${id}')">
          <button type="button" class="tb-step-addbtn" onclick="todoSubAdd('${id}')">+ Add</button>
        </div>
      </div>
    </div>`;
}

function _todoRow(it) {
  const id = escHtml(it.id);
  const expanded = !!_todoExpanded[it.id];
  const dateSrc = it.done ? (it.doneAt || it.createdAt) : it.createdAt;
  const dateStr = _todoFmtDate(dateSrc);
  let subsCounter = '';
  if (it.subs && it.subs.length) {
    const total = it.subs.length;
    const doneCt = it.subs.filter(s => s.done).length;
    subsCounter = `<span class="tb-steps-ct" style="color:${doneCt === total ? 'var(--tb-done)' : 'var(--tb-steel)'}">${doneCt}/${total}</span>`;
  }
  const chevron = `<span class="tb-chevron${expanded ? ' open' : ''}">▾</span>`;
  const rushBtn = !it.done
    ? `<button type="button" class="tb-rush-pill${it.rush ? ' active' : ''}" onclick="todoRush('${id}')" title="Rush">RUSH</button>`
    : '';

  return `
    <div class="tb-row${it.rush && !it.done ? ' tb-row-rush' : ''}"${it.done ? ' style="opacity:.6"' : ''}>
      <div class="tb-row-main">
        <input type="checkbox" class="tb-check" ${it.done ? 'checked' : ''} onchange="todoToggle('${id}')" aria-label="Done">
        <div class="tb-row-body" onclick="todoExpand('${id}')">
          <div class="tb-row-text${it.done ? ' done' : ''}">${escHtml(it.text || '')}</div>
          <div class="tb-row-meta">
            ${_todoCatChip(it.cat)}
            <span class="tb-date">${escHtml(dateStr)}</span>
            ${it.note ? '<span title="Has a note">📝</span>' : ''}
            ${subsCounter}
            ${chevron}
          </div>
        </div>
        <div class="tb-row-actions">
          ${rushBtn}
          <button type="button" class="tb-del" onclick="todoDelete('${id}')" title="Delete">✕</button>
        </div>
      </div>
      ${expanded ? _todoDetail(it) : ''}
    </div>`;
}

window.renderPersonalTodo = async function () {
  const c = document.getElementById('page-content');
  if (!c) return;
  if (!(typeof isPresident === 'function' && isPresident())) {
    c.innerHTML = renderAccessDenied('Personal To-Do');
    return;
  }
  _todoInjectStyles();
  c.innerHTML = window.skeletonHtml('rows');
  try {
    const snap = await _todoCol().orderBy('createdAt', 'asc').get();
    _todoItems = snap.docs.map(d => _todoNormalize({ id: d.id, ...d.data() }));
    _todoLoaded = true;
  } catch (e) {
    _todoItems = []; _todoLoaded = false;
    c.innerHTML = `<div class="card" style="padding:22px;text-align:center;color:var(--text-muted)">
      Could not load your to-do list (${escHtml((e && e.message) || 'error')}). Check the connection and reopen.</div>`;
    return;
  }
  _todoPaint(true);
};

// focusAdd: steal focus into the Add input ONLY on the initial render and
// right after an add (rapid entry). Every other repaint (toggle, expand,
// chip select, sub edits) must NOT refocus — on mobile that pops the
// keyboard on every tap.
function _todoPaint(focusAdd) {
  const c = document.getElementById('page-content');
  if (!c) return;

  const openAll = _todoItems.filter(i => !i.done);
  const doneAll = _todoItems.filter(i => i.done);

  const catCounts = {};
  openAll.forEach(i => { catCounts[i.cat] = (catCounts[i.cat] || 0) + 1; });

  const inFilter = (i) => _todoFilter === 'all' || i.cat === _todoFilter;

  const open = openAll.filter(inFilter).sort((a, b) => {
    if (!!a.rush !== !!b.rush) return a.rush ? -1 : 1;
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
  const done = doneAll.filter(inFilter).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));

  const filterLabel = _todoFilter === 'all' ? '' : (TODO_CATS[_todoFilter] ? TODO_CATS[_todoFilter].label : _todoFilter);
  const nothingInAreaMsg = `Nothing in ${escHtml(filterLabel)} — switch chips or add above.`;

  let openEmptyHtml = '';
  if (!open.length) {
    let msg;
    if (_todoFilter !== 'all') msg = nothingInAreaMsg;
    else if (doneAll.length) msg = 'All done 🎉';
    else msg = 'Nothing here yet — add your first to-do above.';
    openEmptyHtml = `<div class="tb-empty">${msg}</div>`;
  }

  const importPanelHtml = _todoImportOpen ? `
    <div class="tb-import">
      <div class="tb-import-hint">Paste the JSON from the board's <strong>Export tasks</strong> button, then Import. Items are added as new (running it twice duplicates).</div>
      <textarea id="todoImportBox" class="tb-import-box"></textarea>
      <div class="tb-import-actions">
        <button class="tb-btn-accent" onclick="todoImportRun()">Import</button>
        <button class="tb-btn-outline" onclick="todoImportToggle()">Cancel</button>
      </div>
    </div>` : '';

  const chipsHtml = `
    <div class="tb-chips">
      <button type="button" class="tb-chip${_todoFilter === 'all' ? ' active' : ''}" onclick="todoFilterSet('all')">All</button>
      ${Object.keys(TODO_CATS).map(k => {
        const cnt = catCounts[k] || 0;
        return `<button type="button" class="tb-chip${_todoFilter === k ? ' active' : ''}" onclick="todoFilterSet('${k}')">
          <span class="tb-chip-swatch" style="background:var(--tb-cat-${k})"></span>${escHtml(TODO_CATS[k].label)}${cnt ? `<span class="tb-chip-count">${cnt}</span>` : ''}
        </button>`;
      }).join('')}
    </div>`;

  const doneSectionHtml = doneAll.length ? `
    <div class="tb-donehead">
      <span class="tb-donehead-label">Done · ${done.length}</span>
      <button type="button" class="tb-clearlink" onclick="todoClearDone()">Clear completed</button>
    </div>
    <div class="tb-list">
      ${done.length ? done.map(_todoRow).join('') : `<div class="tb-empty">${nothingInAreaMsg}</div>`}
    </div>` : '';

  c.innerHTML = `
    <div class="todo-board">
      <div class="tb-head">
        <div>
          <div class="tb-eyebrow">Barro Industries · Personal Board</div>
          <h1 class="tb-title">My To-Do</h1>
        </div>
        <div class="tb-openbox">
          <div class="tb-opennum">${openAll.length}</div>
          <div class="tb-openlabel">Open</div>
          <button type="button" class="tb-importlink" onclick="todoImportToggle()">⇪ Import</button>
        </div>
      </div>
      <div class="tb-rule-strong"></div>
      <div class="tb-rule-thin"></div>

      ${importPanelHtml}

      <div class="tb-addbar">
        <input id="todoNewText" class="tb-input" placeholder="Add a to-do… (Enter to add)" maxlength="500"
          onkeydown="if(event.key==='Enter')todoAdd()">
        <select id="todoNewCat" class="tb-select">
          ${Object.keys(TODO_CATS).map(k => `<option value="${k}"${k === _todoLastCat ? ' selected' : ''}>${escHtml(TODO_CATS[k].label)}</option>`).join('')}
        </select>
        <button type="button" class="tb-btn-accent" onclick="todoAdd()">+ Add</button>
      </div>

      ${chipsHtml}

      <div class="tb-list">
        ${open.length ? open.map(_todoRow).join('') : openEmptyHtml}
      </div>
      ${doneSectionHtml}
    </div>`;

  // Auto-grow every expanded note textarea to its content height (spec:
  // "set style.height from scrollHeight ... after paint").
  Object.keys(_todoExpanded).forEach(id => {
    if (!_todoExpanded[id]) return;
    const ta = document.getElementById('todoNote-' + id);
    if (ta) _todoAutoGrow(ta);
  });

  if (focusAdd) {
    const inp = document.getElementById('todoNewText');
    if (inp) inp.focus();
  }
}

window.todoFilterSet = function (key) {
  _todoFilter = key;
  _todoPaint();
};

window.todoAdd = async function () {
  const inp = document.getElementById('todoNewText');
  const catSel = document.getElementById('todoNewCat');
  const text = (inp && inp.value || '').trim();
  if (!text) return;
  const cat = (catSel && TODO_CATS[catSel.value]) ? catSel.value : 'general';
  _todoLastCat = cat;
  const nowIso = new Date().toISOString();
  const item = { text: text.slice(0, 500), done: false, createdAt: nowIso, doneAt: '', updatedAt: nowIso, cat, rush: false, note: '', subs: [] };
  await _todoEnsureParent();
  try {
    const ref = await _todoCol().add(item);
    _todoItems.push({ id: ref.id, ...item });
    _todoPaint(true);
  } catch (e) {
    window.Notifs?.showToast && Notifs.showToast('Could not save — ' + ((e && e.message) || 'error'), 'error');
  }
};

window.todoToggle = async function (id) {
  const it = _todoItems.find(x => x.id === id);
  if (!it) return;
  const prevRush = it.rush;
  it.done = !it.done;
  it.doneAt = it.done ? new Date().toISOString() : '';
  it.updatedAt = new Date().toISOString();
  // Board behaviour: marking a task done clears its rush flag. Sub-step
  // states are left untouched either way.
  if (it.done) it.rush = false;
  _todoPaint();
  try {
    await _todoCol().doc(id).update({ done: it.done, doneAt: it.doneAt, updatedAt: it.updatedAt, rush: it.rush });
  } catch (e) {
    it.done = !it.done; it.rush = prevRush; _todoPaint();
    window.Notifs?.showToast && Notifs.showToast('Could not update — ' + ((e && e.message) || 'error'), 'error');
  }
};

window.todoDelete = async function (id) {
  const idx = _todoItems.findIndex(x => x.id === id);
  if (idx < 0) return;
  const [removed] = _todoItems.splice(idx, 1);
  delete _todoExpanded[id];
  _todoPaint();
  try {
    await _todoCol().doc(id).delete();
  } catch (e) {
    _todoItems.splice(idx, 0, removed); _todoPaint();
    window.Notifs?.showToast && Notifs.showToast('Could not delete — ' + ((e && e.message) || 'error'), 'error');
  }
};

window.todoClearDone = async function () {
  const done = _todoItems.filter(i => i.done);
  if (!done.length) return;
  _todoItems = _todoItems.filter(i => !i.done);
  _todoPaint();
  try {
    await Promise.all(done.map(i => _todoCol().doc(i.id).delete()));
  } catch (e) {
    window.Notifs?.showToast && Notifs.showToast('Some items could not be cleared — reopen to re-sync.', 'error');
    window.renderPersonalTodo();
  }
};

window.todoExpand = function (id) {
  _todoExpanded[id] = !_todoExpanded[id];
  _todoPaint();
};

window.todoRush = async function (id) {
  const it = _todoItems.find(x => x.id === id);
  if (!it) return;
  const prev = it.rush;
  it.rush = !it.rush;
  it.updatedAt = new Date().toISOString();
  _todoPaint();
  try {
    await _todoCol().doc(id).update({ rush: it.rush, updatedAt: it.updatedAt });
  } catch (e) {
    it.rush = prev; _todoPaint();
    window.Notifs?.showToast && Notifs.showToast('Could not update — ' + ((e && e.message) || 'error'), 'error');
  }
};

// Update in-memory immediately (so the field keeps whatever the user is
// typing), auto-grow the box, and debounce the actual write 800ms per item —
// deliberately NO repaint here, or the textarea would lose focus mid-keystroke.
window.todoNoteInput = function (id, el) {
  const it = _todoItems.find(x => x.id === id);
  if (!it || !el) return;
  it.note = el.value.slice(0, 2000);
  _todoAutoGrow(el);
  if (_todoNoteTimers[id]) clearTimeout(_todoNoteTimers[id]);
  _todoNoteTimers[id] = setTimeout(async () => {
    delete _todoNoteTimers[id];
    const note = it.note;
    const updatedAt = new Date().toISOString();
    const prevUpdatedAt = it.updatedAt;
    it.updatedAt = updatedAt;
    try {
      await _todoCol().doc(id).update({ note, updatedAt });
    } catch (e) {
      it.updatedAt = prevUpdatedAt;
      window.Notifs?.showToast && Notifs.showToast('Could not save note — ' + ((e && e.message) || 'error'), 'error');
    }
  }, 800);
};

window.todoSubToggle = async function (id, subId) {
  const it = _todoItems.find(x => x.id === id);
  if (!it) return;
  const prevSubs = (it.subs || []).slice();
  it.subs = (it.subs || []).map(s => s.id === subId ? { ...s, done: !s.done } : s);
  it.updatedAt = new Date().toISOString();
  _todoPaint();
  try {
    await _todoCol().doc(id).update({ subs: it.subs, updatedAt: it.updatedAt });
  } catch (e) {
    it.subs = prevSubs; _todoPaint();
    window.Notifs?.showToast && Notifs.showToast('Could not update step — ' + ((e && e.message) || 'error'), 'error');
  }
};

window.todoSubDelete = async function (id, subId) {
  const it = _todoItems.find(x => x.id === id);
  if (!it) return;
  const prevSubs = (it.subs || []).slice();
  it.subs = (it.subs || []).filter(s => s.id !== subId);
  it.updatedAt = new Date().toISOString();
  _todoPaint();
  try {
    await _todoCol().doc(id).update({ subs: it.subs, updatedAt: it.updatedAt });
  } catch (e) {
    it.subs = prevSubs; _todoPaint();
    window.Notifs?.showToast && Notifs.showToast('Could not delete step — ' + ((e && e.message) || 'error'), 'error');
  }
};

window.todoSubAdd = async function (id) {
  const it = _todoItems.find(x => x.id === id);
  if (!it) return;
  const inp = document.getElementById('todoSubNew-' + id);
  const text = (inp && inp.value || '').trim();
  if (!text) return;
  if ((it.subs || []).length >= 60) {
    window.Notifs?.showToast && Notifs.showToast('Max 60 steps per item.', 'error');
    return;
  }
  const sub = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), text: text.slice(0, 200), done: false };
  const prevSubs = (it.subs || []).slice();
  it.subs = prevSubs.concat([sub]);
  it.updatedAt = new Date().toISOString();
  _todoPaint();
  const focusEl = document.getElementById('todoSubNew-' + id);
  if (focusEl) focusEl.focus();
  try {
    await _todoCol().doc(id).update({ subs: it.subs, updatedAt: it.updatedAt });
  } catch (e) {
    it.subs = prevSubs; _todoPaint();
    window.Notifs?.showToast && Notifs.showToast('Could not add step — ' + ((e && e.message) || 'error'), 'error');
  }
};

window.todoImportToggle = function () {
  _todoImportOpen = !_todoImportOpen;
  _todoPaint();
  if (_todoImportOpen) {
    const box = document.getElementById('todoImportBox');
    if (box) box.focus();
  }
};

// Accepts the board's export JSON: {"v":2,"updated":<ms>,"tasks":[...]}, or a
// bare array of tasks. Skips tasks with empty text; caps text/note/subs to
// the same limits the rules enforce so a legitimate paste never gets denied.
window.todoImportRun = async function () {
  const box = document.getElementById('todoImportBox');
  const raw = (box && box.value || '').trim();
  const fail = () => {
    window.Notifs?.showToast && Notifs.showToast("Couldn't read that — paste the exact Export text from the board.", 'error');
  };
  if (!raw) { fail(); return; }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    fail();
    return;
  }
  const tasks = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.tasks) ? parsed.tasks : null);
  if (!tasks) { fail(); return; }

  const nowIso = new Date().toISOString();
  const mapped = [];
  tasks.forEach((t) => {
    if (!t) return;
    const text = String(t.text == null ? '' : t.text).trim().slice(0, 500);
    if (!text) return;
    const cat = (t.cat && TODO_CATS[t.cat]) ? t.cat : 'general';
    const subsSrc = Array.isArray(t.subs) ? t.subs : [];
    const subs = subsSrc.slice(0, 60).map((s) => ({
      id: String((s && s.id) || Math.random().toString(36).slice(2)),
      text: String((s && s.text) || '').slice(0, 200),
      done: !!(s && s.done)
    }));
    const done = !!t.done;
    mapped.push({
      text,
      done,
      cat,
      rush: !!t.rush,
      note: String(t.note || '').slice(0, 2000),
      subs,
      createdAt: new Date(t.created || Date.now()).toISOString(),
      doneAt: (done && t.doneAt) ? new Date(t.doneAt).toISOString() : '',
      updatedAt: nowIso
    });
  });

  if (!mapped.length) { fail(); return; }

  await _todoEnsureParent();
  try {
    const col = _todoCol();
    const CHUNK = 450;
    for (let i = 0; i < mapped.length; i += CHUNK) {
      const slice = mapped.slice(i, i + CHUNK);
      const batch = db.batch();
      slice.forEach((item) => batch.set(col.doc(), item));
      await batch.commit();
    }
    _todoImportOpen = false;
    window.Notifs?.showToast && Notifs.showToast('Imported ' + mapped.length + ' tasks', 'success');
    window.renderPersonalTodo();
  } catch (e) {
    window.Notifs?.showToast && Notifs.showToast('Could not import — ' + ((e && e.message) || 'error'), 'error');
  }
};
