# Workstream 18 — Keyboard Shortcuts

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

Grounded against the v12 branch as of the current checkout (post Phase-1 commit 9281be1; line numbers below re-verified live via grep just now, not taken from the stale audit).

**1. Keydown/keyup listeners in the whole repo -- confirmed very few, exactly 4, none of them a shortcut dispatcher:**
- `js/app.js:206` -- `['click','keydown','mousemove','touchstart','scroll'].forEach(e => document.addEventListener(e, resetLogoutTimer, {passive:true}))` inside `startAutoLogout()` (js/app.js:203-208). Purely an activity-reset timer for auto-logout; ignores `e.key` entirely.
- `quote-builder-v2.html:1172-1178` -- `document.getElementById('searchInput').addEventListener('keydown', e=>{ if(e.key==='ArrowDown'){...} else if(e.key==='ArrowUp'){...} else if(e.key==='Enter'){...} else if(e.key==='Escape') closeDropdown(); });` Scoped to one input, inside the quote builder's own document (loaded in an iframe), closes only its own autocomplete dropdown.
- `js/departments.js:1868-1870` -- `document.getElementById('comment-in-${docId}')?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendComment(); } });` Enter-to-send on a comment textarea.
- `js/drive.js:227-230` -- `[urlIn, nameIn].forEach(el => el?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveLink(); } }));` Enter-to-save on two link-attachment inputs.
No global, centralized, or document-level shortcut/keymap handler exists anywhere today. No `?` cheat sheet. No Alt+digit nav. No Ctrl/Cmd+K anywhere (`grep ctrlKey\\|metaKey` across js/*.js and quote-builder-v2.html returns nothing).

**2. window.openModal / window.closeModal (js/app.js:7075-7096) -- does NOT listen for Escape today:**
```
window.openModal=function(title,bodyHTML,footerHTML='',opts){ ... document.getElementById('modal-overlay').classList.remove('hidden'); document.getElementById('modal-overlay').classList.add('active'); };
window.closeModal=function(){ document.getElementById('modal-overlay').classList.add('hidden'); document.getElementById('modal-overlay').classList.remove('active'); };
document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('modal-close')?.addEventListener('click',closeModal);
  document.getElementById('modal-overlay')?.addEventListener('click',e=>{if(e.target===document.getElementById('modal-overlay'))closeModal();});
});
```
Only two dismissal paths exist: click the X button, or click the overlay backdrop. No keyboard path.

Three OTHER independent overlay-like surfaces exist, each with its own ad-hoc open/close mechanism and none wired to Escape:
- `#profile-drawer` + `#drawer-overlay` (index.html:274-285): opened/closed via `closeProfileDrawer()` (js/app.js:7063-7069), toggles `.open`/`.hidden` classes; closed by the drawer's own back-button (`#profile-close`) or clicking `#drawer-overlay`.
- `#sidebar` + `#sidebar-overlay` (index.html:209,230): opened/closed via `closeSidebar()` (js/app.js:996-1000) and the DOMContentLoaded wiring at js/app.js:1003-1009 (menu-toggle click, sidebar-overlay click, plus an edge-swipe gesture at 1011-1055). No keyboard path.
- `#task-fullscreen-panel` (js/departments.js:678-687, created around line 712+): a DOM node created/destroyed outright (not hidden-toggled) via `closeTaskPanel()`, which is `window.closeTaskPanel` (js/departments.js:687) and is already called defensively from `navigateTo()` (js/app.js:1843) on every page change. No keyboard path today.

**3. Global Search -- already built as a full PAGE, not an overlay/palette, entry point already exists:**
- Topbar magnifier button: `index.html:182-184` -- `<button class=\"notif-btn\" id=\"global-search-btn\" aria-label=\"Search\" style=\"display:none\" onclick=\"navigateTo('search')\"><i data-lucide=\"search\"></i></button>`. Starts hidden inline; visibility is set at runtime.
- Visibility gating in `buildNav()`, js/app.js:815-821: `const gs = document.getElementById('global-search-btn'); if (gs) { gs.style.display = (isPartner() || isBrilliantOnly()) ? 'none' : ''; gs.setAttribute('aria-label', 'Global search'); }` -- hidden for partner and Brilliant-Steel-only accounts.
- Router entry: `js/app.js:1899` -- `case 'search': window.renderGlobalSearch?.(); break;` inside the big `switch(page)` in `navigateTo()` (js/app.js:1828-onward).
- Implementation: `window.renderGlobalSearch = async function(initialQuery){...}` at js/modules.js:2402-2464 (IIFE at js/modules.js:2398-2465, internal-staff-only comment at 2395-2397). It independently re-blocks partner/Brilliant-Steel-only accounts (js/modules.js:2405-2406: `const blocked = (typeof isPartner==='function' && isPartner()) || (typeof isBrilliantOnly==='function' && isBrilliantOnly());`), replaces `#page-content` entirely (full page, matches the owner's 'no pop-ups' directive), takes an optional `initialQuery` string, auto-focuses its input, and does a 220ms-debounced client-side search across tasks/clients(sales+design+bs)/inventory/products/quotes fetched via `dbCachedGet`.
- No overlay/palette version of search exists; today Ctrl/Cmd+K or `/` would have to invoke this exact full-page flow (`navigateTo('search')`) unless Fable decides otherwise.

**4. Nav data source for a prospective Alt+1..9 -- `getSidebarItems()` at js/app.js:838-905+**, called from `buildSidebarNav()` (js/app.js:940-961) which is only rebuilt from `buildNav()` (called on login/role bootstrap, per CLAUDE.md nav conventions). Returns a role/department-dependent ordered array of `{icon, label, page, section?, sectionLabel?}` objects (e.g. `{icon:'home', label:'Dashboard', page:'dashboard'}`); the `page` field is the exact string `navigateTo()` expects, including the `dept:X` prefix form (js/app.js:1856-1860 handles that prefix specially). The array's content and length differ completely across president/manager/secretary vs. generic-partner vs. Brilliant-Steel-partner vs. plain employee (4 distinct branches, js/app.js:848-905).

**5. localStorage precedent for client-only UI prefs** (relevant if Fable wants a 'shortcuts enabled' or 'seen cheat sheet' flag): theme already uses this pattern -- `localStorage.getItem('bi-theme')` / `setTimeout`-free direct `localStorage.setItem('bi-theme', theme)` at js/app.js:319, 782, 791, 796. No Firestore field is used for any comparable per-device UI preference today.

**6. Script/file sizes as of this read** (confirms task prompt's estimates and that Phase 1 shifted line numbers only slightly): js/app.js 7769 lines, js/departments.js 12766 lines, js/modules.js 2465 lines, js/config.js 365 lines.

**7. Cross-reference confirming plan accuracy:** `grep -c \"confirm(\\|alert(\\|prompt(\"` gives app.js:15, departments.js:55, modules.js:9 = 79 total, exactly matching workstream 11's '79 native confirm()/alert()/prompt()' claim -- confirms the audit's counts are trustworthy elsewhere in this plan even though line numbers must be re-grepped per file.

## Data model

This workstream is purely client-side UI/UX (a global key-event dispatcher + a help overlay). Grep confirms it needs **no new Firestore collection and no firestore.rules change** -- there is nothing here resembling a document write.

The only plausible 'data' touchpoints, both optional and precedented by existing patterns rather than required by the plan text:
- **localStorage** (device-local, not synced) -- the existing precedent is the theme key: `bi-theme` (get/set as cited above). If Fable wants a 'don't show the cheat sheet again' or 'shortcuts on/off' toggle, the established convention is a `bi-`-prefixed localStorage key, not a Firestore field -- no per-user server-side preference field exists anywhere in the `users/{uid}` doc shape for comparable UI toggles (only `notifSettings.*` exists, written via `db.collection('users').doc(currentUser.uid).update()` per js/app.js:7050-7056, and that's for actual push-notification categories, a different concern).
- **getSidebarItems() array** (js/app.js:838) is the de-facto 'data model' for Alt+1..9 -- it's an in-memory JS array of `{icon,label,page,section,sectionLabel}`, rebuilt at login/role-bootstrap time by `buildNav()`, not persisted anywhere. It is NOT keyed/stable across roles -- the same Alt+3 would point at a different `page` value depending on whether `currentRole`/`currentDepts` puts the user in the president/manager/secretary branch, the generic-partner branch, the Brilliant-Steel-partner branch, or the plain-employee branch (js/app.js:848-905).
- **Global Search's own data reads** (js/modules.js:2416-2424) are unrelated to this workstream's own data model but are what a Ctrl/Cmd+K-triggered search would ultimately invoke: `tasks`, `bk_quotes`/`getAllQuotes()`, `sales_clients`, `design_clients`, `bs_clients`, `inventory_items`, `products` (all read-only, cached via `dbCachedGet`). No new reads/writes needed for workstream 18 itself; only reused if Ctrl/Cmd+K is wired to the existing search page.

## Constraints — must respect

- Load order (index.html:289-311): firebase SDKs+Chart.js+Lucide -> firebase-config.js -> config.js -> [inline version-stamp script] -> drive.js -> notifications.js -> departments.js -> app.js -> modules.js, all with `defer`. All `defer` scripts finish executing BEFORE `DOMContentLoaded` fires. Evidence the codebase is already careful about this: config.js:309 and config.js:358 defensively write `var esc = window.escHtml || function(s){...}` because escHtml (defined in modules.js:9, loaded last) does not exist yet when config.js's TOP-LEVEL code runs. Conclusion for workstream 18: a global keymap initializer must NOT be top-level code in config.js if it needs to call functions defined later (window.openModal, window.closeTaskPanel, window.renderGlobalSearch, window.escHtml) -- it must run inside a DOMContentLoaded callback (all of those are guaranteed defined by then), most naturally added into the existing boot handler at js/app.js:31-36 which already wraps each init step in its own try/catch specifically so 'a cosmetic failure ... must never block the auth listener'.
- Zero existing focus-guard pattern anywhere in the repo: `grep -rn "tagName.*INPUT\|tagName.*TEXTAREA\|isContentEditable\|matches('input" js/*.js quote-builder-v2.html` returns NOTHING. Every existing keydown listener is scoped to one specific input element (quote-builder-v2.html:1172 searchInput; js/departments.js:1869 comment-in-{docId}; js/drive.js:228 urlIn/nameIn), so none of them ever needed to ask 'is a text field focused' -- a document-level global handler is new territory and must invent this check from scratch (e.g. document.activeElement.tagName === 'INPUT'/'TEXTAREA' or .isContentEditable) before treating bare keys like `/` or `?` as shortcuts.
- Zero existing ctrlKey/metaKey handling anywhere: `grep -rn "ctrlKey\|metaKey" js/*.js quote-builder-v2.html` returns nothing -- Ctrl/Cmd+K is fully greenfield, no precedent to conform to or collide with.
- Existing single-purpose keydown listener already lives on `document`: js/app.js:206 `['click','keydown','mousemove','touchstart','scroll'].forEach(e => document.addEventListener(e, resetLogoutTimer, {passive:true}))` for auto-logout activity tracking -- it's passive and never calls preventDefault/reads e.key, so adding a second, separate document keydown listener for shortcuts is additive/non-conflicting, but confirms `document` already carries global listeners and the new one must be idempotently attached once (there is no existing 'already initialized' guard anywhere in the boot code to copy from).
- iframe boundary: the quote builder renders in `<iframe id="qb-frame">` (js/app.js:1121) and `<iframe id="partners-qb-frame">` (js/app.js:3559), a separate document -- a keydown listener on the main app's `document` will never see key events whose focus target is inside those iframes. quote-builder-v2.html already has its own local Escape/Arrow/Enter handler (line 1172-1178) scoped only to its own search dropdown, proving the iframe is a wholly separate event-listener context that the main app cannot reach without postMessage (there is already an iframe->parent postMessage bridge with origin-checking at js/app.js:7643-7645 that could be reused/extended).
- escHtml discipline (CLAUDE.md, js/modules.js:9): any dynamic/user-derived text rendered by a new cheat-sheet or shortcut-driven UI must go through escHtml() before innerHTML.
- Cache-bust discipline (CLAUDE.md): any new/edited .js file (new keymap module, or edits to app.js/config.js/modules.js) requires bumping CACHE_VER in sw.js and, if a new file is created, adding it to sw.js's PRECACHE list and to index.html's script tags -- CACHE_VER itself and APP_VERSION are auto-bumped by .git/hooks/pre-commit; do not hand-edit APP_VERSION.
- No build step / no ES modules: everything is a plain <script defer> attaching functions to `window`; a new keymap feature must follow the same window.* global-function-module pattern already used throughout (see js/notifications.js's `window.Notifs` IIFE for the established 'namespaced IIFE exposing one window object' style if Fable wants a self-contained module rather than loose globals).
- Owner's standing directive at the top of V12-PLAN.md: 'no pop-ups (full pages with Back)' -- this is in tension with workstream 18's own wording ('Ctrl/⌘K or / global search', '? cheat sheet') which both sound like overlay/palette UX; Fable must reconcile which parts of 18 are allowed to be modal-overlay-based (the existing #modal-overlay mechanism is already used pervasively elsewhere, e.g. js/app.js:4689, so it may be considered pre-approved infrastructure) versus which must become full navigateTo() pages.

## DECIDED — architecture spec (Fable, 2026-07-10)

This workstream is **purely client-side UI**. **No new Firestore collection and NO `firestore.rules` change is required** (stated explicitly per deliverable #7). The one persisted touchpoint is a single device-local `localStorage` flag (`bi-kbd-hint-seen`) following the existing `bi-theme` precedent — no server-side `users/{uid}` field.

### Resolved decisions (one line each)

1. **Where the keymap lives** → In **`js/app.js`** as a self-contained `window.Keymap` IIFE inserted immediately after the modal code (after js/app.js:7096), initialized by ONE line added to the existing boot `DOMContentLoaded` at js/app.js:31-36. Rationale: every function it calls (`getSidebarItems`, `isPartner`, `isBrilliantOnly`, `navigateTo`, `openModal`, `closeModal`, `closeSidebar`, `closeProfileDrawer`, `closeTaskPanel`) already lives in app.js or is a `window.*` global defined by DOMContentLoaded time — co-location avoids a new-file/PRECACHE/index.html/script-tag triple-edit and the config.js forward-reference trap, at the cost of ~130 lines in an already-large file (acceptable; WS16's split targets departments.js, not app.js).
2. **Ctrl/⌘K vs `/`** → **Both open search. `Ctrl/⌘K` fires even while a text input is focused** (conventional command-palette behavior, and it can never be a literal character); **`/` fires ONLY when no text input is focused** so users type a literal slash into any field freely. Rationale: matches Slack/Notion/Linear muscle memory and the plan's "Ctrl/⌘K or /" wording without stealing the slash key from every textbox.
3. **Search invocation UI** → Reuse the **existing full-page `navigateTo('search')` → `renderGlobalSearch()`** unchanged. No new palette overlay. Rationale: honors the owner's explicit "no pop-ups (full pages with Back)" directive, zero new UI, and the search page already auto-focuses its input.
4. **`?` cheat sheet UI** → A **modal overlay reusing the existing `window.openModal()` infra** (pre-approved: openModal is used ~107× app-wide for utility dialogs). Rationale: a keyboard cheat sheet is a transient reference card, not a destination page — a full `navigateTo` page with a Back button would be heavier than the affordance warrants, and `openModal` is explicitly treated as approved infrastructure in the brief. It is Escape-closeable via the same overlay mechanism.
5. **Alt+1..9 binding source** → Bind against the **live, role-dependent `getSidebarItems()` array at keypress time** (first 9 items, `.slice(0,9)`), zero duplication. The `?` cheat sheet renders the SAME list so the per-role mapping is always discoverable and self-documenting. Rationale: a hand-curated table would diverge from the single source of truth as later workstreams (32/37/38) add nav destinations.
6. **Escape stacking model** → A **lightweight ordered `window.OverlayEsc` probe registry**. Escape closes the single **topmost** open overlay (first match in priority order) and stops there. Rationale: correct when two overlays are ever open simultaneously, and requires ZERO edits to existing open/close functions (probes DOM-detect "is open" at keydown time rather than push/pop on open).
7. **localStorage toggle** → Shortcuts are **silent always-on** (no enable/disable toggle). Add ONE **first-run discovery toast** pointing at `?`, gated by a `localStorage` `bi-kbd-hint-seen` flag (shown once, ever, per device). Rationale: discoverability without a settings surface nobody asked for.
8. **WS11 forward-compat (confirm/prompt overlay)** → Escape is built **generically via the `OverlayEsc` registry**: WS11's `confirmDialog` will `window.OverlayEsc.register({...})` its own probe at the FRONT of the list and MUST NOT add its own keydown listener. This workstream **owns the global Escape keydown listener**; all future overlays integrate by registering a probe. (Binding cross-workstream contract.)
9. **WS10 forward-compat (History API / popstate)** → The Escape handler ONLY closes overlays; it **never touches `navBack`/history**. WS10's future `popstate` handler should, if it wants Back to also dismiss overlays, call `window.OverlayEsc.closeTopmost()` first and swallow the pop if it returned `true`. Both paths funnel through one function — no double-handling.
10. **iframe reach (quote builder)** → **Out of scope / accept the blind spot.** Global shortcuts silently do not fire while focus is inside `#qb-frame`/`#partners-qb-frame` (separate iframe documents). Rationale: the quote builder is a self-contained full-screen tool with its own Esc handler (quote-builder-v2.html:1172) and its own Back; forwarding keys via postMessage doubles scope for marginal benefit. Documented as known behavior; a follow-up can add postMessage forwarding later if the owner asks.

---

### New functions (all inside the `window.Keymap` IIFE in js/app.js, added after line 7096)

```js
window.Keymap.init()                    // idempotent one-time listener attach
window.Keymap.isTextInputFocused()      // -> boolean; focus guard
window.Keymap.openSearch(e)             // partner/BS-gated navigateTo('search')
window.Keymap.toggleCheatSheet(e)       // open/close the ? modal
window.Keymap.navByIndex(n)             // Alt+N -> getSidebarItems()[n-1].page
window.Keymap.buildCheatSheetHTML()     // -> escaped HTML string for openModal body

window.OverlayEsc.register(probe)       // probe = { isOpen: ()=>bool, close: ()=>void }, unshifted to front
window.OverlayEsc.closeTopmost()        // -> boolean; closes first-open probe, returns whether it closed one
```

### The overlay-Escape registry (paste as-is, before `window.Keymap`)

```js
// ── Overlay Escape registry ───────────────────────
// Ordered list of overlay probes (front = highest priority / topmost).
// Any future overlay type (WS11 confirmDialog, etc.) registers a probe here
// instead of adding its own keydown listener — this is the single Esc owner.
window.OverlayEsc = (function () {
  const probes = [
    // #modal-overlay (openModal + the ? cheat sheet both use this singleton)
    { isOpen: () => document.getElementById('modal-overlay')?.classList.contains('active'),
      close: () => (window.closeModal ? window.closeModal() : null) },
    // task-fullscreen-panel (created/destroyed node)
    { isOpen: () => !!document.getElementById('task-fullscreen-panel'),
      close: () => (window.closeTaskPanel ? window.closeTaskPanel() : null) },
    // #profile-drawer
    { isOpen: () => document.getElementById('profile-drawer')?.classList.contains('open'),
      close: () => (typeof closeProfileDrawer === 'function' ? closeProfileDrawer() : null) },
    // #sidebar (mobile flyout)
    { isOpen: () => document.getElementById('sidebar')?.classList.contains('open'),
      close: () => (typeof closeSidebar === 'function' ? closeSidebar() : null) },
  ];
  return {
    register(probe) { if (probe && typeof probe.isOpen === 'function' && typeof probe.close === 'function') probes.unshift(probe); },
    closeTopmost() {
      for (const p of probes) {
        let open = false; try { open = !!p.isOpen(); } catch (_) {}
        if (open) { try { p.close(); } catch (_) {} return true; }
      }
      return false;
    },
  };
})();
```

Note: `#qb-fullscreen` (quote-builder host) is deliberately NOT a probe — it is a full-screen tool with its own Back/Esc, per decision #10.

### The exact focus-guard predicate (no prior art exists — this is canonical)

```js
isTextInputFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    // A disabled/readonly input still "has focus" but isn't being typed into;
    // treat readonly as not-typing so shortcuts still work over it.
    if (el.readOnly || el.disabled) return false;
    return true;
  }
  if (el.isContentEditable) return true;
  return false;
}
```

### The literal keymap dispatch table (paste as-is)

```js
// Each entry: match(e) predicate, allowInInput (fire even when a text field is
// focused?), and run(e). Escape and Ctrl/⌘K are allowed in inputs; bare '/' , '?'
// and Alt+N are suppressed while typing. Alt+digit uses e.code (Option+digit on
// macOS mangles e.key into a special char, but e.code stays 'Digit1'..'Digit9').
const KEYMAP = [
  { id: 'escape',
    allowInInput: true,
    match: e => e.key === 'Escape',
    run:   () => window.OverlayEsc.closeTopmost() },   // returns bool; we preventDefault only if it closed one

  { id: 'search-cmdk',
    allowInInput: true,
    match: e => (e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey,
    run:   e => window.Keymap.openSearch(e) },

  { id: 'search-slash',
    allowInInput: false,
    match: e => e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey,
    run:   e => window.Keymap.openSearch(e) },

  { id: 'cheatsheet',
    allowInInput: false,
    match: e => e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey,
    run:   e => window.Keymap.toggleCheatSheet(e) },

  { id: 'nav-alt-digit',
    allowInInput: false,
    match: e => e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code),
    run:   e => window.Keymap.navByIndex(parseInt(e.code.slice(5), 10)) },
];
```

### The full `window.Keymap` module (paste after the OverlayEsc block)

```js
// ── Global keyboard shortcuts ─────────────────────
// Esc closes topmost overlay · Ctrl/⌘K or / opens search · Alt+1..9 nav · ? cheat sheet.
window.Keymap = (function () {
  let _inited = false;

  function isTextInputFocused() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      if (el.readOnly || el.disabled) return false;
      return true;
    }
    return !!el.isContentEditable;
  }

  function openSearch(e) {
    // THIRD entry point into the search page — repeat the partner/BS-only guard
    // (topbar button hides it, renderGlobalSearch re-blocks it; this must too).
    const blocked = (typeof isPartner === 'function' && isPartner()) ||
                    (typeof isBrilliantOnly === 'function' && isBrilliantOnly());
    if (blocked) return false;
    if (e) e.preventDefault();
    navigateTo('search');
    return true;
  }

  function navByIndex(n) {
    let items = [];
    try { items = (typeof getSidebarItems === 'function') ? getSidebarItems() : []; } catch (_) { return false; }
    const it = items[n - 1];
    if (!it || !it.page) return false;
    navigateTo(it.page);
    return true;
  }

  function buildCheatSheetHTML() {
    const esc = window.escHtml || (s => (s == null ? '' : String(s)));
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
    const cmd = isMac ? '⌘' : 'Ctrl';
    const rows = [
      ['Esc', 'Close dialog / drawer / panel'],
      [cmd + ' K', 'Open search'],
      ['/', 'Open search'],
      ['?', 'Show this cheat sheet'],
    ];
    let items = [];
    try { items = (typeof getSidebarItems === 'function') ? getSidebarItems() : []; } catch (_) {}
    const navRows = items.slice(0, 9).map((it, i) =>
      `<tr><td class="kbd-cell"><kbd>Alt</kbd> + <kbd>${i + 1}</kbd></td><td>${esc(it.label || it.page)}</td></tr>`).join('');
    const coreRows = rows.map(([k, d]) =>
      `<tr><td class="kbd-cell"><kbd>${esc(k)}</kbd></td><td>${esc(d)}</td></tr>`).join('');
    return `<div class="kbd-cheatsheet">
      <table class="kbd-table"><tbody>${coreRows}</tbody></table>
      ${navRows ? `<h4 class="kbd-subhead">Jump to</h4><table class="kbd-table"><tbody>${navRows}</tbody></table>` : ''}
    </div>`;
  }

  function toggleCheatSheet(e) {
    if (e) e.preventDefault();
    // If our cheat sheet is already the open modal, Esc-style toggle closes it.
    if (window._cheatSheetOpen && document.getElementById('modal-overlay')?.classList.contains('active')) {
      window.closeModal(); window._cheatSheetOpen = false; return;
    }
    window.openModal('Keyboard shortcuts', buildCheatSheetHTML());
    window._cheatSheetOpen = true;
  }

  function onKeydown(e) {
    if (e.defaultPrevented) return;
    const typing = isTextInputFocused();
    for (const entry of KEYMAP) {
      let ok = false; try { ok = entry.match(e); } catch (_) {}
      if (!ok) continue;
      if (typing && !entry.allowInInput) return;   // don't fire text-suppressed shortcuts while typing
      const acted = entry.run(e);
      // Esc: only swallow the event if we actually closed an overlay.
      if (entry.id === 'escape') { if (acted) e.preventDefault(); return; }
      // Everything else that ran already preventDefault'd inside run(); stop.
      return;
    }
  }

  function maybeShowFirstRunHint() {
    try {
      if (localStorage.getItem('bi-kbd-hint-seen')) return;
      // Only hint internal staff who actually have shortcuts worth discovering.
      const blocked = (typeof isPartner === 'function' && isPartner()) ||
                      (typeof isBrilliantOnly === 'function' && isBrilliantOnly());
      if (blocked) return;
      if (window.Notifs && Notifs.showToast) Notifs.showToast('Tip: press ? for keyboard shortcuts', 'success');
      localStorage.setItem('bi-kbd-hint-seen', '1');
    } catch (_) {}
  }

  function init() {
    if (_inited) return;
    _inited = true;
    document.addEventListener('keydown', onKeydown);   // non-passive: we may preventDefault
  }

  return { init, isTextInputFocused, openSearch, navByIndex, toggleCheatSheet, buildCheatSheetHTML,
           maybeShowFirstRunHint };
})();
```

Define the `KEYMAP` const in the same IIFE scope (above `window.Keymap`'s return), or inline it just before `onKeydown` — it references `window.Keymap.*` which is resolved at call time, so ordering inside the file is safe.

### Before/after — boot init (js/app.js:31-36)

**Before:**
```js
document.addEventListener('DOMContentLoaded', () => {
  // A cosmetic failure in theme/login init must never block the auth listener
  // below from attaching — that would strand the app on the splash screen.
  try { initTheme(); } catch(e) { console.error('initTheme failed', e); }
  try { initLogin(); } catch(e) { console.error('initLogin failed', e); }
  try { Notifs.initToggle(); } catch(e) { console.error('Notifs.initToggle failed', e); }
```

**After (add one guarded line):**
```js
document.addEventListener('DOMContentLoaded', () => {
  // A cosmetic failure in theme/login init must never block the auth listener
  // below from attaching — that would strand the app on the splash screen.
  try { initTheme(); } catch(e) { console.error('initTheme failed', e); }
  try { initLogin(); } catch(e) { console.error('initLogin failed', e); }
  try { Notifs.initToggle(); } catch(e) { console.error('Notifs.initToggle failed', e); }
  try { window.Keymap.init(); } catch(e) { console.error('Keymap.init failed', e); }
```

`Keymap.init()` is idempotent (`_inited` guard) — it is safe even though `navigateTo()` runs constantly; the listener attaches exactly once at boot, never from `navigateTo`. Do **not** call `Keymap.init()` from anywhere else.

### Before/after — reset the cheat-sheet flag on close (js/app.js:7089-7096)

The cheat sheet reuses `#modal-overlay`, so a normal close (X button, backdrop click, or another `openModal`) must clear `window._cheatSheetOpen` so the `?` toggle stays in sync.

**Before:**
```js
window.closeModal=function(){
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-overlay').classList.remove('active');
};
```

**After:**
```js
window.closeModal=function(){
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-overlay').classList.remove('active');
  window._cheatSheetOpen = false;
};
```

Also clear it at the top of `openModal` so opening a DIFFERENT modal doesn't leave the flag set — **Before** (js/app.js:7075-7076):
```js
window.openModal=function(title,bodyHTML,footerHTML='',opts){
  opts = opts || {};
```
**After:**
```js
window.openModal=function(title,bodyHTML,footerHTML='',opts){
  opts = opts || {};
  if (title !== 'Keyboard shortcuts') window._cheatSheetOpen = false;
```

### Optional first-run hint wiring

Call `window.Keymap.maybeShowFirstRunHint()` once, right after the first successful `navigateTo('dashboard')` post-login. The natural spot is inside the auth bootstrap in `auth.onAuthStateChanged` after `buildNav()` runs (near js/app.js:85 where it navigates to dashboard). Guard it in try/catch. This is optional-but-recommended; skipping it just means users discover `?` on their own.

### CSS — cheat-sheet styling (append to css/styles.css)

No `<kbd>` styling exists anywhere today; add:
```css
.kbd-cheatsheet .kbd-table { width:100%; border-collapse:collapse; }
.kbd-cheatsheet .kbd-table td { padding:7px 10px; border-bottom:1px solid var(--border); font-size:14px; color:var(--text); }
.kbd-cheatsheet .kbd-cell { white-space:nowrap; width:1%; }
.kbd-cheatsheet kbd {
  display:inline-block; min-width:22px; text-align:center; padding:2px 7px;
  font:600 12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;
  background:var(--surface); color:var(--text);
  border:1px solid var(--border); border-bottom-width:2px; border-radius:6px;
}
.kbd-cheatsheet .kbd-subhead { margin:16px 0 6px; font-size:12px; text-transform:uppercase;
  letter-spacing:.04em; color:var(--text-muted); }
```
Uses existing theme vars (`--border`, `--surface`, `--text`, `--text-muted`) so it works in both themes automatically.

---

### Migration / rollout checklist (apply order)

1. **js/app.js** — insert the `window.OverlayEsc` block, then the `KEYMAP` const + `window.Keymap` IIFE, immediately after the modal `DOMContentLoaded` wiring (after line 7096).
2. **js/app.js:31-36** — add `try { window.Keymap.init(); } catch(e){...}` to the boot `DOMContentLoaded` (before/after above).
3. **js/app.js:7075 & 7089** — add the two `window._cheatSheetOpen` resets to `openModal`/`closeModal` (before/after above).
4. **js/app.js ~85** (optional) — add `try { window.Keymap.maybeShowFirstRunHint(); } catch(_){}` after post-login `navigateTo('dashboard')`.
5. **css/styles.css** — append the `.kbd-cheatsheet` block.
6. **sw.js** — bump `CACHE_VER` (e.g. `bi-ops-vNN` → `vNN+1`). No PRECACHE change (no new file). `APP_VERSION`/version strings auto-bump via pre-commit hook — do NOT hand-edit.
7. **No new script tag in index.html** (code lives in app.js). **No firestore.rules change.**
8. Commit; deploy via `git push origin master` (GitHub Pages). No `firebase deploy` needed for this workstream.

### Cross-workstream binding contracts

- **WS11 (styled confirm/prompt):** `confirmDialog`/`promptDialog` MUST register their overlay with `window.OverlayEsc.register({ isOpen, close })` (their `close` resolving the promise as cancelled) and MUST NOT attach their own `keydown`/Escape listener. WS18 owns the single global Escape handler.
- **WS10 (URL routing + Back):** its future `popstate` handler should call `window.OverlayEsc.closeTopmost()` first; if it returns `true`, treat Back as "closed an overlay" and do not additionally pop the page. The Escape handler here never calls `navBack`/history, so the two never double-fire.
- **WS17 (design consolidation):** the `<kbd>` styles use theme vars and can be folded into the design system later without behavior change.

### Manual test matrix (no automated suite exists)

1. **Escape** with: (a) a modal open (`openModal` from any screen) → modal closes; (b) profile drawer open → drawer closes; (c) mobile sidebar open → sidebar closes; (d) task fullscreen panel open → panel closes; (e) nothing open → no error, event not swallowed. (f) modal open AND drawer open simultaneously (if reachable) → Escape closes the modal first (topmost), a second Escape closes the drawer.
2. **Ctrl/⌘K** with no input focused → search page; **with a text input focused** (e.g. a comment box) → still opens search (input's literal 'k' not typed).
3. **`/`** with no input focused → search page; **with a text input focused** → types a literal `/`, does NOT open search.
4. **`?`** with no input focused → cheat-sheet modal opens; press `?` again or Escape → closes; the Alt+N list in the sheet matches the current role's sidebar order. In a text input, `?` types literally.
5. **Alt+1..9** as **president** → jumps to president sidebar items 1..9; as **employee** → employee items; as **partner/BS-only** → their items (search shortcuts `?`/Alt+N still work, but Ctrl+K and `/` must NOT reach search — verify `navigateTo('search')` is blocked). Test on macOS specifically (Option+digit) to confirm `e.code` path fires despite mangled `e.key`.
6. **Partner / Brilliant-Steel-only account:** Ctrl+K and `/` do nothing (openSearch returns false before navigate) — the shortcut is a third entry point and must stay gated.
7. **Inside the quote-builder iframe:** confirm global shortcuts silently don't fire (known/accepted per decision #10); the iframe's own Esc still closes its autocomplete.
8. **Double-attach guard:** navigate across 5+ pages, then press Escape once with a modal open → it closes exactly once (listener attached once, not per navigation).
9. **First-run hint:** fresh device (clear `localStorage`) → the `?` tip toast shows once after login; reload → does not show again.

### Explicit: no rules change

**No `firestore.rules` changes are required for this workstream.** The only persisted state is the device-local `localStorage` key `bi-kbd-hint-seen` (string `'1'`), which never touches Firestore and needs no rule.

## Risks / cross-workstream interactions

- ⚠️ iframe focus blind spot: a `document`-level keydown listener on the main app document will never observe key events while focus is inside `#qb-frame` or `#partners-qb-frame` (separate iframe documents) -- users inside the quote builder lose ALL global shortcuts silently; nothing errors, it will just look like the feature 'doesn't work' in that one screen unless documented or fixed via postMessage.
- ⚠️ Enter-key collisions: js/departments.js:1868-1870 (`comment-in-{docId}` Enter-to-send, `e.preventDefault()`) and js/drive.js:227-230 (urlIn/nameIn Enter-to-save, `e.preventDefault()`) already own Enter inside their specific inputs. A global handler must never treat bare Enter as a shortcut trigger (it isn't in the plan's key list: Esc / Ctrl-K / '/' / Alt+1-9 / '?' -- so low risk, but worth stating explicitly since it's the one key three different local handlers already fight over).
- ⚠️ Double-attachment risk: `navigateTo()` (js/app.js:1828) runs on EVERY page change (very frequently) and is a plausible-but-wrong place to (re-)initialize a global keydown listener; if Fable's spec doesn't explicitly say 'initialize exactly once, at boot, inside the existing DOMContentLoaded handler (js/app.js:31)' a naive implementer could attach a fresh listener on every navigation, stacking N duplicate handlers and firing shortcuts N times per keypress after N page visits. No existing 'already initialized' guard flag exists anywhere in the boot code to copy verbatim -- Fable should specify one (e.g. `if (window._keymapInit) return; window._keymapInit = true;`).
- ⚠️ Partner/Brilliant-Steel-only gating must be triple-checked, not just doubled: the search entry point is ALREADY independently gated twice today -- once by hiding the topbar button (js/app.js:818, `isPartner()||isBrilliantOnly()`) and again inside `renderGlobalSearch` itself (js/modules.js:2405-2406, same two checks) with an explicit code comment at js/modules.js:2395-2397 warning 'the UI must explicitly exclude them -- never rely on rules alone'. A Ctrl/Cmd+K shortcut is a THIRD entry point into the same page and must repeat the identical `isPartner()||isBrilliantOnly()` guard before calling `navigateTo('search')`, or a partner/BS-only account could reach a page their button doesn't show them.
- ⚠️ CSS duplication: `.modal-overlay` is defined twice (css/styles.css:2097 and 3394) and `.sidebar-overlay` twice (1192 and 3671), most likely theme or responsive-breakpoint overrides layered on a base block -- but this means z-index/stacking values can't be read off a single citation; before writing any 'find the topmost overlay to close' logic, the actual cascade/precedence needs to be checked in the browser, not assumed from one grep hit.
- ⚠️ Same-function collision with OTHER workstreams: this workstream's natural insertion points -- `navigateTo()` (js/app.js:1828, also touched by workstream 10's History-API rewrite and workstream 31's quote-builder teardown logic at the same lines 1845-1847), `getSidebarItems()`/`buildNav()` (js/app.js:838-905, 940-961, also touched by workstream 9's BRAND rename sweep and workstream 33's AEC nav entry) -- are all high-traffic shared functions multiple other in-flight/upcoming workstreams also edit; sequencing/merge order across workstreams 9, 10, 18 touching the same ~60-line region of app.js is a real integration risk if built out of order.
- ⚠️ Workstream 11 (native confirm/alert/prompt replacement, not yet built) will add a 5th overlay type later; if 18 hard-codes 'these are the 4 overlays that exist' rather than a registerable list, 18's Escape handler will need a follow-up patch the moment 11 ships (both are Phase-2 items with no committed build order yet beyond the Build Log's 'NEXT UP: 9, 10, 11').
- ⚠️ Owner directive tension already flagged in constraints/openDecisions: 'no pop-ups (full pages with Back)' vs. this workstream literally proposing overlay-shaped UI (cheat sheet, possibly a search palette) -- if Fable picks the overlay route without reconciling this, it risks contradicting an explicit, quoted owner directive at the top of the plan document, which is exactly the kind of thing the owner is likely to flag back.

## Files likely touched

`js/app.js (boot DOMContentLoaded near line 31 for one-time init; buildNav()/getSidebarItems() region 815-905 if Alt+N reuses live nav data; openModal/closeModal region 7075-7096 if Escape hooks into modal specifically; navigateTo() region 1828-1861 if search-shortcut reuses the existing case 'search' path)`, `index.html (possible new <script defer> tag for a standalone keymap module; possible new cheat-sheet trigger affordance in the topbar; global-search-btn at line 182-184 if its onclick/gating logic is centralized into the new handler)`, `js/config.js (only if Fable decides the keymap module belongs in the earliest-loaded shared-utility file, per its existing role housing DEPARTMENTS/ROLES/dbCachedGet)`, `js/modules.js (renderGlobalSearch, js/modules.js:2402-2464, only if it needs to accept a new 'invoked via shortcut' parameter or behavior tweak; escHtml at line 9 if the cheat sheet renders any dynamic text)`, `js/departments.js (closeTaskPanel, lines 678-687, if the task fullscreen panel is registered into a shared overlay-close mechanism)`, `css/styles.css (new cheat-sheet modal content styling, <kbd>-style key badges -- no existing precedent found anywhere in the stylesheet; possible z-index cleanup given the duplicate .modal-overlay/.sidebar-overlay blocks noted above)`, `sw.js (CACHE_VER bump mandatory for any JS/CSS edit here; PRECACHE list addition only if a brand-new js file is created)`, `quote-builder-v2.html (only if Fable decides the iframe should forward key events to the parent app via postMessage, extending the existing bridge pattern at js/app.js:7643-7645)`

## Expected deliverable format

> Fable's output for this workstream should be structured so Sonnet can implement it with zero further judgment calls:
> 
> 1. **Explicit resolution of each open decision above as a stated choice with one sentence of rationale** (file location, search-entry behavior, cheat-sheet overlay-vs-page, Alt+N binding source, Escape stacking model, localStorage toggle or not, forward-compat stance on workstreams 10/11).
> 2. **Exact function signatures** for every new function (e.g. `function initGlobalKeymap()`, `function isTextInputFocused()`, `function closeTopmostOverlay()`, `function openCheatSheet()`), each annotated with which existing file/line it is added near.
> 3. **A literal, pasteable keymap dispatch table** (JS object/array mapping key-combo predicate -> action, e.g. `{key:'k', ctrlOrCmd:true, action: () => ...}`), not prose describing one.
> 4. **Before/after code blocks** anchored to the exact current line numbers cited in this brief (e.g. the precise diff to insert into js/app.js:31-36's DOMContentLoaded body, and to js/app.js:7075-7096's openModal/closeModal), not just descriptions of what to add, so a line-number drift between grounding and build is caught by the diff context itself, not assumed.
> 5. **The exact focus-guard predicate** as runnable code (which elements/attributes count as 'text input has focus'), since zero prior art exists to crib from.
> 6. **A numbered migration checklist** in apply order: (a) create/edit files, (b) bump CACHE_VER in sw.js + add to PRECACHE if new file, (c) add script tag to index.html if new file, (d) wire cheat-sheet CSS, (e) manual test matrix (Escape with modal open / drawer open / sidebar open / task panel open / nothing open; Ctrl+K and `/` with and without a text input focused; Alt+1..9 as president vs. as employee vs. as partner; verify partner/BS-only accounts still can't reach search via the shortcut).
> 7. **Explicit statement 'no firestore.rules changes required for this workstream'** (or, if Fable chooses to persist a shortcuts-preference server-side instead of localStorage, the exact rules diff and `users/{uid}` field name) so Sonnet doesn't go hunting for a rules change that isn't needed, or silently skip one that is.
> 8. No PowerPoint/Word/PDF output -- deliverable is a plain-text/markdown build spec (matching how the other 39 workstreams in V12-PLAN.md are consumed) that becomes the corresponding checklist-item update in V12-PLAN.md once built.
