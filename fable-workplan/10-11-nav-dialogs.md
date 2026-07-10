# Workstream 10-11 — WS10 (URL routing + real Back) + WS11 (Styled confirm/prompt) — Barro Industries Operating System v12.0.0

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

Read on branch `v12` (repo root: `/Users/neilbarro/Library/CloudStorage/OneDrive-Personal/BARRO INDUSTRIES copy/Operation Systems Development`) via grep + targeted Read; line numbers re-located fresh since Phase 1 shifted things. Three separate, uncoordinated navigation surfaces exist today. NONE uses the URL or the History API. No prior art for a confirmDialog helper exists anywhere in the repo (`grep -rn confirmDialog js/*.js index.html` → zero hits).

**1. `navigateTo(page)` router — js/app.js:1828-1904**
Synchronous global function, no return value, switches on a plain string.
- L1828-1837 is the ONLY "history" that exists today — a plain in-memory array, never touches `window.history`/URL:
  ```
  try {
    if (!window._navGoingBack && window.currentPage && window.currentPage !== page) {
      window._navHistory = window._navHistory || [];
      window._navHistory.push(window.currentPage);
      if (window._navHistory.length > 25) window._navHistory.shift();
    }
  } catch (_) {}
  ```
- L1817-1826: `updateNavBackBtn()` shows/hides `#nav-back-btn` (a top-bar button) based on `_navHistory.length`; `window.navBack()` pops the array and calls `navigateTo(prev)` with a `window._navGoingBack=true` guard to avoid re-push loops. This is NOT the device/browser Back button — hardware Back on mobile and the browser's own Back are completely unwired to app state today; pressing them exits the PWA / goes to whatever was in the tab history before the app loaded (nothing, since there's no pushState).
- L1838-1856: sets `currentPage`/`window.currentPage`, `setActiveNav(page)` (L1906-1914, toggles `.active`/`aria-current` on `[data-page]` elements), tears down `closeTaskPanel()` (a THIRD navigation surface, see below) and — unless navigating into `bs-quote-builder`/`bk-quote-builder` — removes `#qb-fullscreen`; destroys live Chart.js instances under `#page-content` (leak guard); blanks `#page-content` to a loading placeholder.
- L1859-1863: `if (page.startsWith('dept:'))` is the ONLY param convention anywhere in the app (confirmed: this is the single `startsWith` hit in app.js). `page.slice(5)` → `renderDeptModule(dept)` (L3327-3341), which itself switches on 11 literal department names + a `default: renderGenericDept(dept)`.
- L1865-1902: the flat switch, every case verbatim: `dashboard, company, tasks, submissions, files, cash, personal-finance, my-dept, departments, analytics, approvals, team, progress, bs-quote-builder, bk-quote-builder, partner-projects, notifications, bs-quotations, bs-clients, bs-files, bk-quotations, help, sops, posts, memos, team-directory, attendance, cash-advances, leave, inventory, product-database, audit-log, search, sales-orders, projects-lifecycle` — 34 literal cases + the `dept:` prefix family + a `default` "Page not found" empty-state. Two cases (`product-database`, `audit-log`) gate on `isPresident()` inline inside the switch arm rather than before dispatch.
- 73 call sites invoke `navigateTo(...)` across app.js/departments.js/modules.js/index.html (`grep -c`), virtually all with a bare string literal (`navigateTo('tasks')`) or the one param form `navigateTo('dept:Finance')`; none pass any other param shape (no query-string-like page strings found).
- **No URL/hash parsing exists at all**: `grep -n "location.hash\|location.search\|URLSearchParams\|location.pathname" js/app.js js/departments.js js/modules.js index.html` returns zero routing-relevant hits (the two `location.pathname` hits in departments.js:11939/12657 are just building an absolute logo URL for print headers, unrelated). On every successful auth resolve the app hardcodes `navigateTo('dashboard')` (js/app.js:85, inside the `auth.onAuthStateChanged` handler) — a refresh (or any re-auth) always lands on the dashboard, never wherever the user was.
- `currentPage` is a plain `let` (js/app.js:11, `let currentPage = 'dashboard';`), never persisted to `localStorage`/`sessionStorage`.
- Pull-to-refresh (js/app.js:405-421) calls `await navigateTo(currentPage)` to re-render in place without a real reload — this already relies on the "same page → no history push" branch above, so it's a working example of the required idempotent-renavigation behavior any History-API rewrite must preserve.
- The repo is deployed as a **static site on GitHub Pages** (`git push origin master` → `barroindustries.github.io`, per CLAUDE.md) with **no `404.html`** in the repo root (`ls 404.html` → not found). GitHub Pages does not rewrite arbitrary paths to `index.html` server-side, so real (non-hash) `pushState` paths like `/dept/Finance` will 404 on a hard refresh or shared deep link unless a `404.html`-redirects-to-`index.html` shim is added — hash-based routing (`#/dept:Finance`) never leaves the client and sidesteps this entirely.

**2. `renderDeptModule` sub-tab state ("chipTabs") — orthogonal to navigateTo, undiscoverable by URL today**
Every department screen (Finance, Sales, Partners, Gov Biddings, Files, Company, etc.) renders internal sub-tabs via `window.chipTabs(items, activeKey, opts)` (js/config.js:307-322) + `window.bindChipTabs(scope, onSelect)` (js/config.js:326-335). `bindChipTabs` is pure DOM: it toggles `.active` classes and calls the `onSelect(key)` callback — it never touches `navigateTo`, the URL, or any history array. Example, js/app.js:3344-3366 (`renderPartnersDept`): chips `overview/deals/tasks/quotes/quote-builder/activity` are rendered, then `window.bindChipTabs(c.querySelector('.partners-dept-tabs'), key => loadPartnersDeptTab(key))`. So today, "Sales → Clients" and "Sales → Quotes" are indistinguishable as a `navigateTo` page (`dept:Sales`) and indistinguishable as a browser-history entry — refreshing or hitting Back always drops the user back to the department's default sub-tab.

**3. `openModal` / `closeModal` — js/app.js:7075-7096, single global singleton**
```
window.openModal=function(title,bodyHTML,footerHTML='',opts){
  opts = opts || {};
  document.getElementById('modal-title').textContent=title;
  document.getElementById('modal-body').innerHTML=bodyHTML;
  const footer=document.getElementById('modal-footer');
  footer.innerHTML=footerHTML;
  footer.classList.toggle('hidden',!footerHTML);
  const box=document.getElementById('modal-box');
  if(box){ box.classList.remove('modal-wide','modal-full');
    if(opts.size==='wide') box.classList.add('modal-wide');
    else if(opts.size==='full') box.classList.add('modal-full'); }
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('modal-overlay').classList.add('active');
};
window.closeModal=function(){
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-overlay').classList.remove('active');
};
```
- Backed by ONE DOM instance in index.html:260-267 (`#modal-overlay > #modal-box > #modal-title, #modal-body, #modal-footer`) — there is no stacking/z-index system for nested modals; a second `openModal()` call while one is open silently replaces the first's content in place.
- Dismissed by: clicking `#modal-close` or clicking the overlay background outside `#modal-box` (both wired once in a `DOMContentLoaded` listener, app.js:7093-7096). **No Escape-key handler exists anywhere** (`grep -n "Escape" js/*.js` → zero hits) — confirms WS18 (keyboard shortcuts, Esc-closes-overlays) is fully greenfield and will need to compose with whatever WS11 builds.
- Sizing: default `max-width:620px` (css/styles.css:2104-2114); opt-in `.modal-wide` (920px, css/styles.css:2117) and `.modal-full` (min(1200px,96vw)/94dvh, css/styles.css:2118) via `opts.size`. Only **4 of 107** `openModal()` call sites actually pass a `size` opt (js/departments.js:2526, 3939, 4084, 8403) — meaning most content-heavy forms (e.g. "New Quote", "New Project", "Create Sales Order") are rendering cramped inside the default 620px box today, which is itself evidence for the owner's "no pop-ups, full pages" directive.
- **107 total `openModal()` call sites**: 23 in js/app.js, 66 in js/departments.js, 18 in js/modules.js (grep counts, matches `grep -c` per file).
- There's existing Promise-based dialog prior art to mirror for API consistency: `window.financeDelete(opts)` (js/departments.js:186-215) already returns `new Promise(resolve => ...)`, resolves to a string outcome (`'deleted'|'requested'|'cancelled'`), and internally still calls native `confirm()` for the President path (L192) while falling back to an `openModal()`-based reason-entry form for everyone else (L198-201) — this is the closest existing pattern to what `confirmDialog()` should look/feel like (Promise + opts object + string outcome), and WS11 should probably absorb this call site too.

**4. Native `confirm()`/`prompt()`/`alert()` — 79 total call sites, matches the plan's "kill all 79" claim exactly**
- `confirm()`: 14 in js/app.js, 46 in js/departments.js, 8 in js/modules.js = 68.
- `prompt()`: 1 in js/app.js, 9 in js/departments.js, 1 in js/modules.js = 11.
- `alert()`: 0 in all three files (`grep -oE '\balert\('` → zero everywhere) — the codebase already uses `Notifs.showToast(msg, 'error'|'success')` (js/notifications.js) for one-shot messages instead of `alert()`, so WS11 only needs to replace `confirm`/`prompt`, not `alert`.
- 68 + 11 = 79, exactly matching V12-PLAN.md's workstream-11 line. Verified representative samples (not exhaustive) at: js/app.js:1616,1771,5484 (destructive-delete guards, "This cannot be undone"); js/departments.js:122,1576 (idempotent-sync confirmations — "Safe to run repeatedly"); js/departments.js:2598,2604,2625 (payroll state-transition confirmations, some carrying multi-line warning bodies); js/departments.js:244,1770,1785,9464,9514,10243 (`prompt()` used to collect a free-text reason/note, result trimmed and often required non-empty before proceeding); js/modules.js:1473,1533 (peso-amount confirmations interpolated into the message). The vast majority follow the `if (!confirm(...)) return;` early-return guard idiom; a handful (js/departments.js:5565, 5803, 5867, 5929) use `if (confirm(...)) { ... }` positive-branch style instead.

**5. A third, ad-hoc "full-screen panel" surface — task detail — js/departments.js:680-720ish**
`openTaskDetail(taskId, ...)` builds a hand-rolled `#task-fullscreen-panel` fixed-position `<div>` (NOT `openModal`, NOT a `navigateTo` page) with its own in-panel "back" button (`#task-panel-back` → `closeTaskPanel()`, js/departments.js:833). `closeTaskPanel()` (js/departments.js:680-687) animates it out and removes it from the DOM; `navigateTo()` unconditionally calls `closeTaskPanel()` as a teardown side effect on every navigation (app.js:1843) — but nothing today makes the *device* Back button close this panel before falling through to a page change, because device Back isn't wired to anything. The quote-builder iframe host (`#qb-fullscreen`, referenced app.js:1079,1846) is a fourth, similar full-screen overlay pattern with the same "torn down as a side effect of navigateTo" behavior and the same missing Back semantics.

## Data model

This workstream is almost entirely client-side/DOM state — it does not need new Firestore collections. The relevant "data model" is browser state:
- `window.currentPage` (string) and `window._navHistory` (array of prior page strings, cap 25) — both in-memory only, lost on refresh today; a History-API rewrite will replace/augment this with real `history.state` objects and/or the URL itself.
- Page identifiers are bare strings today (`'tasks'`, `'dept:Finance'`) — no structured `{page, params}` object exists; any richer param-carrying (e.g. `dept:Finance` + a sub-tab key, or a specific record id for a "detail" page) would be new design surface for WS10, not something to reverse from existing code.
- Modal state lives in the DOM itself (`#modal-title`/`#modal-body`/`#modal-footer`/`#modal-box` `innerHTML`/classList) — there is no JS-side "modal stack" object; `openModal()` is a side-effecting DOM-mutation function, not a return-value/state API.
- No `localStorage`/`sessionStorage` key is used for nav state today (checked: `grep -n "localStorage.setItem\|sessionStorage.setItem" js/app.js` shows no page/route/nav-related keys — existing keys are for other features like `bi-guest-name`, referenced in CLAUDE.md/memory as the source of a prior boot-crash bug, now null-guarded).
- The one existing Promise-returning UI helper to model `confirmDialog()` after is `window.financeDelete(opts)` (js/departments.js:186): takes an options object (`{collection, docId, label, onDone}`), returns a `Promise` resolving to a string outcome. `confirmDialog()` should very likely follow the same shape (`opts = {message, confirmLabel, cancelLabel, danger}` → `Promise<boolean>` or a similar string-outcome contract) for internal consistency, though the exact signature is Fable's call.

## Constraints — must respect

- Load order is fixed and load-bearing (CLAUDE.md): index.html defers scripts in order Firebase SDK+Chart.js+Lucide → firebase-config.js → config.js → drive.js → notifications.js → departments.js → app.js → modules.js. Any new global (e.g. `window.confirmDialog`, a new `window.Router` object) must be defined by the time the first script that calls it runs — `navigateTo`/`openModal` live in app.js (loaded after departments.js), so departments.js call sites currently invoke them via forward-reference through `window.*` at call time, not at parse time, which is safe today only because nothing calls them during departments.js's own top-level execution.
- Bump `CACHE_VER` in sw.js on every JS/CSS edit (CLAUDE.md) — both WS10 and WS11 will touch app.js/departments.js/modules.js/css/styles.css across nearly every screen, so this is a certainty, not a maybe, for whatever commit lands the work.
- `APP_VERSION`/version strings are auto-bumped by `.git/hooks/pre-commit` (CLAUDE.md) — do not hand-edit js/config.js's `APP_VERSION` or the `vX.Y.Z` strings in index.html.
- Every `.innerHTML` write must escape user-controlled content via `escHtml()` (modules.js) per CLAUDE.md convention. `confirmDialog()` messages very often interpolate user-entered names/labels today via raw template strings inside the native `confirm()` calls that will move into modal-based HTML (e.g. `Delete "${name}"?`, `Delete client "${btn.dataset.name}"?`) — moving these into `innerHTML`-rendered dialog bodies makes them newly `escHtml()`-relevant in a way the native `confirm()` (which only ever rendered plain text, immune to injection) was not; this is a real risk to flag, not just a style nit.
- Owner's standing directive (V12-PLAN.md vision section, verbatim): "no pop-ups (full pages with Back)" — this is the explicit mandate driving both WS10 (real Back/URL) and WS11 (kill native dialogs), and also implies some current `openModal()` call sites (the full-form ones, see risks/openDecisions) should arguably become pages under WS10 rather than staying modals under WS11's scope — the two workstreams are requested together specifically because this reclassification only makes sense done jointly.
- The pull-to-refresh handler (js/app.js:405-421) depends on `navigateTo(currentPage)` being idempotent (same-page call = no history push, no infinite reload) — verified this already works via the `page !== currentPage` guard (L1832); any router rewrite MUST preserve calling `navigateTo` with the current page as a safe no-op-ish re-render, not a route error or duplicate push.
- GitHub Pages static hosting, no server-side rewrite, no `404.html` in repo root today (CLAUDE.md: deploy = `git push origin master` → barroindustries.github.io, "No CI gate. Not Netlify."). Any pushState-based (non-hash) URL scheme needs a `404.html` shim redirecting back into `index.html` to survive a hard refresh/deep link on GH Pages; hash-based routing avoids this constraint entirely.
- Firestore rules require an explicit match per collection with no cascade/prefix inheritance (CLAUDE.md + memory: firestore-rules-collection-coverage) — irrelevant to routing/dialogs directly UNLESS WS10/11 introduce any new persisted-state collection (e.g. saving "last visited page" server-side instead of client-side) — flagged as an open decision below precisely because it would trigger this rule if chosen.
- Manila-time discipline (`window.bizDate()`/`bizHour()`/`bizDow()`, never raw `toISOString()`) — not directly implicated by routing/dialogs, but any "remember where the user was" persistence that includes a timestamp (e.g. session expiry on a saved deep link) must use these helpers, not `new Date().toISOString()`.
- No existing Escape-key handling anywhere in the app (verified via grep) — WS11's confirmDialog and WS10's modal/drawer-dismiss-on-Back need to either introduce Esc-handling themselves or explicitly hand this off to WS18 (keyboard shortcuts) without landing two competing keydown listeners.

## DECIDED — architecture spec (Fable, 2026-07-10)

### Resolved decisions (one-line ruling + rationale each)

1. **Hash-based routing, not pushState paths.** URLs are `#/dashboard`, `#/tasks`, `#/dept/Finance`, `#/dept/Finance/Purchases`. Rationale: GitHub Pages has no server rewrite and no `404.html`; real paths (`/dept/Finance`) 404 on hard refresh / shared deep link. Hash never leaves the client, survives refresh and deep-link with zero plumbing, and works in installed-PWA standalone mode where the URL bar is hidden anyway (the owner's "professional" ask is about visual design, not the address bar). **No `404.html` is created.**
2. **Two-level granularity (page + optional sub-tab), sub-tab routing OPT-IN per screen.** `history.state = {t:'page', page, subtab}`; the sub-tab is an optional 3rd hash segment. The router fully supports it, but sub-tab restore is *adopted* only on the 3 highest-value screens in this workstream (Finance, Partners, Sales) via a 2-line change each; every other `chipTabs` screen keeps session-only sub-tabs and can adopt the identical pattern later. This bounds blast radius while satisfying "refresh/Back keeps my place" where it matters most. Sub-tab switches use `replaceState` (not push) so Back exits the department instead of cycling through its chips.
3. **All dismissable overlays get a real history entry — device Back closes the top overlay before it ever changes pages.** A single `window.Overlay` LIFO stack (in config.js) is the one source of truth; every modal, full-screen page-panel, task-detail panel, quote-builder iframe, profile drawer, and confirm/prompt dialog pushes exactly one history entry on open. `popstate` is the SINGLE teardown trigger; UI-close paths (the X button, backdrop click, `closeModal()`, submit-success) all delegate to `history.back()`. This makes "Back works everywhere" true for all four of today's uncoordinated navigation surfaces with almost no per-call-site change.
4. **Forms become full-screen pages via a new `window.openPage()` with the IDENTICAL 4-arg signature as `openModal()`.** The migration for ~60 form call sites is the mechanical token swap `openModal(` → `openPage(`; nothing else in their build/submit flow changes because `closeModal()` is redefined to a generic overlay-dismiss that closes a page-panel too. This delivers the owner's literal "full pages with Back" without rewriting a single submit handler. True bespoke page conversions (routes with their own render functions) are explicitly OUT of scope and deferred — `openPage` satisfies the mandate now.
5. **`confirmDialog(opts) → Promise<boolean>` and a sibling `promptDialog(opts) → Promise<string|null>`, both in config.js.** Boolean is the exact 1:1 for `if(!confirm(x))return`; `string|null` is the exact 1:1 for `const x = prompt(msg,def)` (native prompt returns `null` on cancel, string on OK). Two helpers, not one overloaded one — the 68 confirm sites and 11 prompt sites map cleanly and the call site reads honestly. `financeDelete()`'s inner native `confirm()` (departments.js:192) is absorbed into `confirmDialog({danger:true})`.
6. **Yes — every converted confirm/prompt call site's enclosing function becomes `async` and the call is `await`ed.** Native `confirm`/`prompt` blocked synchronously; the replacements are Promises. The deliverable's table below flags the enclosing-function state. Verified: all 4 positive-branch `if(confirm(...)){…}` sites (app.js:5565, 5803, 5867, 5929) are ALREADY inside `async` handlers; there are ZERO inline `onclick="…confirm(…)…"` attribute handlers (grep confirmed), so no attribute-to-listener extraction is needed. The conversion is therefore uniformly mechanical.
7. **`confirmDialog`/`promptDialog`/`Overlay` live in js/config.js; `openPage`/`openModal`/`navigateTo` stay in js/app.js.** config.js loads 2nd (before departments.js's 55 dialog call sites), so those callers need no forward-reference gymnastics. The app.js router references `window.Overlay` only at runtime (inside `popstate`/`navigateTo`), which is safe. No new script file is added, so index.html's load order is untouched (only markup + a stylesheet block change).
8. **`window._navHistory` array is retired and replaced by the real History API.** `navBack()` → `history.back()`; the top-bar `#nav-back-btn` visibility is driven by an app-internal `window._navDepth` counter (incremented on each in-app push, decremented on pop) so it never reflects external/pre-app history. Pull-to-refresh's `navigateTo(currentPage)` stays a safe no-push re-render (guarded by `opts.replace`-less same-page detection).
9. **Esc-to-close is owned here, designed for WS18 to reuse without conflict.** `confirmDialog`/`promptDialog`/`openModal`/`openPage` all render into overlays carrying a stable `.overlay-active` class and are dismissed exclusively through `Overlay.dismissTop()`. WS11 ships ONE global `keydown` listener that calls `Overlay.dismissTop()` on Escape; WS18 must call `Overlay.dismissTop()` rather than add a second listener (documented in cross-workstream notes). No double-handling.
10. **No new Firestore collection, no server-side "last page" persistence.** Route state lives entirely in the URL hash + `history.state`; refresh restores from the hash. This deliberately avoids triggering the per-collection rules requirement. `currentPage` remains a client `let`; the hash is the durable record.

---

### New/changed global function signatures

```js
// ── js/config.js (new, after the chipTabs/bindChipTabs helpers ~L335) ──
window.Overlay = {
  _stack: [],            // [{ id, kind, teardown }]  LIFO
  _seq: 0,
  _closing: false,       // guard: true while a popstate-driven teardown runs
  isOpen(),                                   // → boolean (_stack.length > 0)
  push(kind, teardownFn),                     // kind: 'modal'|'page'|'task'|'qb'|'drawer'|'dialog'
                                              //   → id; pushes ONE history entry, runs teardownFn on pop
  dismissTop(),                               // UI-close path → history.back() (no DOM work here)
  _popOne(),                                  // INTERNAL — called by popstate; pops + tears down top
  clearAll()                                  // INTERNAL — navigateTo unwinds overlays before a page change
};

window.confirmDialog = function(opts) → Promise<boolean>;
//   opts = { title?='Confirm', message, confirmLabel?='Confirm', cancelLabel?='Cancel',
//            danger?=false, html?=false }
//   resolves true on confirm; false on cancel / backdrop / Esc / device-Back.

window.promptDialog = function(opts) → Promise<string|null>;
//   opts = { title?='', message, value?='', placeholder?='', required?=false,
//            multiline?=false, confirmLabel?='OK', cancelLabel?='Cancel' }
//   resolves trimmed string on OK; null on cancel / backdrop / Esc / device-Back.
//   if required && trimmed==='' → the OK button stays disabled (never resolves empty).

window.setSubroute = function(subtab) → void;   // replaceState the sub-tab onto the current page entry
window.initialSubtab = function(defaultKey) → string;  // URL sub-tab if it targets the current page, else defaultKey

// ── js/app.js (changed) ──
function navigateTo(page, opts) → void;
//   opts = { subtab?, replace?=false, fromHistory?=false }
//   fromHistory=true (popstate/hashchange) ⇒ render WITHOUT pushState.
//   replace=true ⇒ replaceState (initial load, same-page refresh).

window.openPage  = function(title, bodyHTML, footerHTML='', opts) → void;  // full-screen panel, Overlay-registered
window.openModal = function(title, bodyHTML, footerHTML='', opts) → void;  // small dialog, now Overlay-registered
window.closeModal = function() → void;    // generic: === Overlay.dismissTop() (closes page/modal/dialog top)
window.navBack   = function() → void;     // === history.back()
```

### `history.state` shapes (annotated literals)

```js
// Page entry (one per navigateTo):
{ t:'page', page:'dept:Finance', subtab:'Purchases', d:7 }   // d = app-internal depth counter
{ t:'page', page:'tasks',        subtab:null,        d:3 }
// Overlay entry (one per open modal/page/panel/dialog), sits ON TOP of a page entry:
{ t:'overlay', kind:'page', oid:12, base:{ page:'dept:Sales', subtab:'quotes' }, d:8 }
```

### Hash format & the parse/build helpers

```js
// Add to js/app.js, above navigateTo.
function hashFor(page, subtab){
  var segs = String(page).startsWith('dept:')
    ? ['dept', page.slice(5)].concat(subtab ? [subtab] : [])
    : [page].concat(subtab ? [subtab] : []);
  return '#/' + segs.map(encodeURIComponent).join('/');
}
function parseHash(h){                       // h defaults to location.hash
  h = (h==null ? location.hash : h).replace(/^#\/?/, '');
  if (!h) return { page:'dashboard', subtab:null };
  var s = h.split('/').map(decodeURIComponent);
  if (s[0]==='dept' && s[1]) return { page:'dept:'+s[1], subtab: s[2]||null };
  return { page: s[0]||'dashboard', subtab: s[1]||null };
}
```
Dept names with spaces (`Brilliant Steel`, `Government Biddings`) round-trip through `encodeURIComponent` → `#/dept/Brilliant%20Steel`.

---

### Before/after — `js/app.js` load-bearing functions

**A. `updateNavBackBtn` + `navBack` (app.js:1817-1826) — before:**
```js
function updateNavBackBtn() {
  const b = document.getElementById('nav-back-btn');
  if (b) b.style.display = (window._navHistory && window._navHistory.length) ? '' : 'none';
}
window.navBack = function() {
  window._navHistory = window._navHistory || [];
  const prev = window._navHistory.pop();
  if (prev) { window._navGoingBack = true; try { navigateTo(prev); } finally { window._navGoingBack = false; } }
  updateNavBackBtn();
};
```
**after:**
```js
function updateNavBackBtn() {
  const b = document.getElementById('nav-back-btn');
  // Real history now backs this: show the button whenever we've navigated at least
  // once within the app (depth>0) and we're not sitting on the dashboard root.
  if (b) b.style.display = ((window._navDepth||0) > 0 && window.currentPage !== 'dashboard') ? '' : 'none';
}
window.navBack = function(){ history.back(); };   // the top-bar chevron === device Back
```

**B. `navigateTo` (app.js:1828-1904) — before:** (the `try{_navHistory.push…}` block L1828-1837 and the signature `function navigateTo(page)`). **after** — replace L1828-1863 (everything from the signature down to and including the `dept:` branch) with:
```js
function navigateTo(page, opts) {
  opts = opts || {};
  const subtab = (opts.subtab !== undefined) ? opts.subtab : null;

  // If overlays are open and this is a real (non-history) navigation, tear them
  // down first so a nav click from inside a modal/page doesn't leave a dangling panel.
  if (!opts.fromHistory && window.Overlay && window.Overlay.isOpen()) window.Overlay.clearAll();

  // Sync the URL + history entry (skip when we're rendering FROM history).
  if (!opts.fromHistory) {
    const st = { t:'page', page, subtab, d: (opts.replace ? (window._navDepth||0) : (window._navDepth = (window._navDepth||0) + (page===window.currentPage?0:1))) };
    const url = hashFor(page, subtab);
    try { opts.replace ? history.replaceState(st,'',url) : history.pushState(st,'',url); } catch(_){}
  }

  currentPage = page;
  window.currentPage = page;
  window.currentSubtab = subtab;          // screens read this via initialSubtab()
  setActiveNav(page);
  updateNavBackBtn();
  if (typeof window.closeTaskPanel === 'function') window.closeTaskPanel();
  if (page !== 'bk-quote-builder' && page !== 'bs-quote-builder') {
    document.getElementById('qb-fullscreen')?.remove();
  }
  const c = document.getElementById('page-content');
  if (window.Chart) {
    c.querySelectorAll('canvas').forEach(canvas => { const ex = Chart.getChart(canvas); if (ex) ex.destroy(); });
  }
  c.innerHTML = '<div class="loading-placeholder">Loading…</div>';

  if (page.startsWith('dept:')) { renderDeptModule(page.slice(5)); return; }
  // …switch(page){ …unchanged… }
```
The `switch` block (L1865-1903) is UNCHANGED. Note: the depth-increment is inlined so a same-page re-render (pull-to-refresh) yields `page===currentPage` → `d` unchanged and pushState of an identical hash is harmless (Back still skips it because state.page equals current). The old `_navGoingBack`/`_navHistory` machinery is fully removed.

**C. `openModal`/`closeModal` (app.js:7075-7096) — before:** (the two functions + the `DOMContentLoaded` wiring shown in the brief). **after:**
```js
// Small dialog. Now registers with Overlay so device/browser Back closes it.
window.openModal = function(title, bodyHTML, footerHTML='', opts){
  opts = opts || {};
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  const footer = document.getElementById('modal-footer');
  footer.innerHTML = footerHTML; footer.classList.toggle('hidden', !footerHTML);
  const box = document.getElementById('modal-box');
  if (box){ box.classList.remove('modal-wide','modal-full');
    if (opts.size==='wide') box.classList.add('modal-wide');
    else if (opts.size==='full') box.classList.add('modal-full'); }
  const ov = document.getElementById('modal-overlay');
  ov.classList.remove('hidden'); ov.classList.add('active');
  window.Overlay.push('modal', () => { ov.classList.add('hidden'); ov.classList.remove('active'); });
};
// Full-screen routed panel — SAME signature as openModal. Forms swap openModal→openPage.
window.openPage = function(title, bodyHTML, footerHTML='', opts){
  opts = opts || {};
  document.getElementById('page-panel')?.remove();
  const p = document.createElement('div');
  p.id = 'page-panel'; p.className = 'page-panel overlay-active';
  p.innerHTML = `
    <div class="page-panel-head">
      <button class="page-panel-back" aria-label="Back"><i data-lucide="arrow-left"></i></button>
      <h3 class="page-panel-title"></h3><div style="width:40px"></div>
    </div>
    <div class="page-panel-body"></div>
    <div class="page-panel-foot"></div>`;
  p.querySelector('.page-panel-title').textContent = title;
  p.querySelector('.page-panel-body').innerHTML = bodyHTML;
  const foot = p.querySelector('.page-panel-foot');
  foot.innerHTML = footerHTML; foot.classList.toggle('hidden', !footerHTML);
  document.body.appendChild(p);
  p.querySelector('.page-panel-back').addEventListener('click', () => window.Overlay.dismissTop());
  window.lucide?.createIcons();
  requestAnimationFrame(() => p.classList.add('open'));
  window.Overlay.push('page', () => { p.classList.remove('open'); setTimeout(()=>p.remove(), 300); });
};
// Generic dismiss — closes whatever overlay is on top (dialog | modal | page | panel).
window.closeModal = function(){ window.Overlay.dismissTop(); };

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('modal-close')?.addEventListener('click', () => window.Overlay.dismissTop());
  document.getElementById('modal-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) window.Overlay.dismissTop();
  });
});
```

**D. Router wiring — add ONCE in app.js (near the DOMContentLoaded block, after the definitions above):**
```js
window.addEventListener('popstate', (e) => {
  // Overlay open? A Back press dismisses the top overlay and consumes the event.
  if (window.Overlay.isOpen()) { window.Overlay._popOne(); return; }
  window._navDepth = Math.max(0, (window._navDepth||0) - 1);
  const s = e.state || parseHash();
  const st = (s.t === 'overlay') ? s.base : s;        // stale overlay entry → render its underlying page
  navigateTo(st.page || 'dashboard', { subtab: st.subtab || null, fromHistory: true });
});
window.addEventListener('hashchange', () => {         // user typed/edited the URL hash
  const p = parseHash();
  if (p.page === window.currentPage && p.subtab === (window.currentSubtab||null)) return;
  navigateTo(p.page, { subtab: p.subtab, replace: true });
});
window.addEventListener('keydown', (e) => {           // Esc closes the top overlay (WS18 must reuse this path)
  if (e.key === 'Escape' && window.Overlay.isOpen()) { e.preventDefault(); window.Overlay.dismissTop(); }
});
```

**E. Auth-resolve initial route (app.js:85) — before:** `navigateTo('dashboard');` **after:**
```js
{ const r = parseHash(); navigateTo(r.page, { subtab: r.subtab, replace: true }); }  // deep-link / refresh survives
```

---

### New code — `js/config.js` (after `bindChipTabs`, ~L335)

```js
// ── Overlay stack: one history entry per dismissable surface ─────────────────
window.Overlay = {
  _stack: [], _seq: 0, _closing: false,
  isOpen(){ return this._stack.length > 0; },
  push(kind, teardown){
    const id = ++this._seq;
    this._stack.push({ id, kind, teardown });
    const base = { page: window.currentPage || 'dashboard', subtab: window.currentSubtab || null };
    try { history.pushState({ t:'overlay', kind, oid:id, base, d:(window._navDepth||0) }, '', location.hash); } catch(_){}
    return id;
  },
  dismissTop(){ if (this._stack.length) history.back(); },   // → popstate → _popOne
  _popOne(){
    const top = this._stack.pop(); if (!top) return;
    this._closing = true; try { top.teardown(); } catch(_){} this._closing = false;
  },
  clearAll(){
    if (!this._stack.length) return;
    const n = this._stack.length;
    while (this._stack.length){ const o = this._stack.pop(); try { o.teardown(); } catch(_){} }
    // Drop the overlays' history entries so the new page push lands cleanly.
    try { history.go(-n); } catch(_){}
  }
};

// ── Confirm / prompt dialogs (replace native confirm()/prompt()) ─────────────
function _dlgEsc(s){ return (window.escHtml||function(x){return String(x==null?'':x);})(s); }
window.confirmDialog = function(opts){
  opts = opts || {};
  return new Promise((resolve) => {
    const ov = document.getElementById('dialog-overlay');
    const msg = opts.html ? (opts.message||'') : _dlgEsc(opts.message||'');
    ov.innerHTML = `<div class="dialog-box overlay-active" role="alertdialog" aria-modal="true">
      ${opts.title ? `<h4 class="dialog-title">${_dlgEsc(opts.title)}</h4>` : ''}
      <div class="dialog-msg">${msg}</div>
      <div class="dialog-actions">
        <button class="btn-secondary" data-act="cancel">${_dlgEsc(opts.cancelLabel||'Cancel')}</button>
        <button class="${opts.danger?'btn-danger':'btn-primary'}" data-act="ok">${_dlgEsc(opts.confirmLabel||'Confirm')}</button>
      </div></div>`;
    ov.classList.remove('hidden'); ov.classList.add('active');
    let settled = false;
    const done = (val) => { if (settled) return; settled = true;
      ov.classList.add('hidden'); ov.classList.remove('active'); ov.innerHTML=''; resolve(val); };
    window.Overlay.push('dialog', () => done(false));           // Back/Esc/backdrop → false
    ov.querySelector('[data-act=ok]').onclick     = () => { window.Overlay.dismissTop(); done(true); };
    ov.querySelector('[data-act=cancel]').onclick = () => window.Overlay.dismissTop();
    ov.onclick = (e) => { if (e.target === ov) window.Overlay.dismissTop(); };
  });
};
window.promptDialog = function(opts){
  opts = opts || {};
  return new Promise((resolve) => {
    const ov = document.getElementById('dialog-overlay');
    const field = opts.multiline
      ? `<textarea id="dlg-input" rows="3" placeholder="${_dlgEsc(opts.placeholder||'')}"></textarea>`
      : `<input id="dlg-input" placeholder="${_dlgEsc(opts.placeholder||'')}"/>`;
    ov.innerHTML = `<div class="dialog-box overlay-active" role="dialog" aria-modal="true">
      ${opts.title ? `<h4 class="dialog-title">${_dlgEsc(opts.title)}</h4>` : ''}
      ${opts.message ? `<div class="dialog-msg">${_dlgEsc(opts.message)}</div>` : ''}
      <div class="form-group">${field}</div>
      <div class="dialog-actions">
        <button class="btn-secondary" data-act="cancel">${_dlgEsc(opts.cancelLabel||'Cancel')}</button>
        <button class="btn-primary" data-act="ok">${_dlgEsc(opts.confirmLabel||'OK')}</button>
      </div></div>`;
    ov.classList.remove('hidden'); ov.classList.add('active');
    const input = ov.querySelector('#dlg-input');
    input.value = opts.value || '';
    const okBtn = ov.querySelector('[data-act=ok]');
    const validate = () => { if (opts.required) okBtn.disabled = (input.value.trim()===''); };
    input.addEventListener('input', validate); validate(); setTimeout(()=>input.focus(),40);
    let settled = false;
    const done = (val) => { if (settled) return; settled = true;
      ov.classList.add('hidden'); ov.classList.remove('active'); ov.innerHTML=''; resolve(val); };
    window.Overlay.push('dialog', () => done(null));            // Back/Esc/backdrop → null (== native cancel)
    okBtn.onclick = () => { const v = input.value.trim(); if (opts.required && !v) return;
      window.Overlay.dismissTop(); done(v); };
    ov.querySelector('[data-act=cancel]').onclick = () => window.Overlay.dismissTop();
    ov.onclick = (e) => { if (e.target === ov) window.Overlay.dismissTop(); };
    if (!opts.multiline) input.addEventListener('keydown', e => { if (e.key==='Enter') okBtn.click(); });
  });
};

// ── Sub-tab routing helpers (opt-in per screen) ──────────────────────────────
window.setSubroute = function(subtab){
  const st = Object.assign({}, history.state||{t:'page',page:window.currentPage,d:(window._navDepth||0)}, { subtab });
  window.currentSubtab = subtab;
  try { history.replaceState(st, '', (window.hashFor||function(p,s){return location.hash;})(window.currentPage, subtab)); } catch(_){}
};
window.initialSubtab = function(defaultKey){
  return (window.currentSubtab != null) ? window.currentSubtab : defaultKey;
};
```
> `hashFor` is defined in app.js (loads after config.js); `setSubroute` references it as `window.hashFor` at runtime with a safe fallback. Add `window.hashFor = hashFor;` next to its definition in app.js.

**Sub-tab adoption (2-line change on the 3 in-scope screens):** in `renderPartnersDept` (app.js:3344), `renderFinance`, and `renderSales`, change the initial active-chip seed from a literal to `window.initialSubtab('overview')` (use each screen's real default key), and change the `bindChipTabs(scope, fn)` call to also route: wrap the callback — `bindChipTabs(scope, (key,btn)=>{ window.setSubroute(key); loadTab(key); })`. No signature change to `chipTabs`/`bindChipTabs` is required.

---

### `index.html` — new markup (add after the profile-drawer block, ~L285)

```html
<!-- Full-screen page panel host (openPage) is created/removed dynamically; no static markup. -->
<!-- Confirm / prompt dialog host (higher z than #modal-overlay so it nests on top) -->
<div id="dialog-overlay" class="dialog-overlay hidden"></div>
```
No change to `#modal-overlay`/`#modal-box`/`#modal-title`/`#modal-body`/`#modal-footer` (L260-267). No new `<script>` (all new globals live in existing config.js/app.js), so the load-order block is untouched.

### `css/styles.css` — add ONE new block (append near the existing modal rules ~L2118; do NOT duplicate into the second modal block at ~L3394)

```css
/* ── Full-screen page panel (openPage) ── */
.page-panel{ position:fixed; top:calc(var(--topbar-h) + env(safe-area-inset-top,0px));
  left:0; right:0; bottom:0; background:var(--bg); z-index:4000; display:flex; flex-direction:column;
  transform:translateY(100%); opacity:0; transition:transform .3s cubic-bezier(.4,0,.2,1),opacity .3s; overflow:hidden; }
.page-panel.open{ transform:translateY(0); opacity:1; }
.page-panel-head{ display:flex; align-items:center; gap:12px; padding:12px 16px;
  background:var(--surface); border-bottom:1px solid var(--border); flex-shrink:0; }
.page-panel-back{ background:none; border:none; color:var(--primary-light); cursor:pointer; padding:4px; display:flex; }
.page-panel-title{ flex:1; font-size:16px; font-weight:700; color:var(--text);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.page-panel-body{ flex:1; overflow-y:auto; padding:16px; -webkit-overflow-scrolling:touch; }
.page-panel-foot{ flex-shrink:0; padding:12px 16px; border-top:1px solid var(--border);
  display:flex; gap:8px; justify-content:flex-end; background:var(--surface); }
.page-panel-foot.hidden{ display:none; }

/* ── Confirm / prompt dialog ── */
.dialog-overlay{ position:fixed; inset:0; background:rgba(0,0,0,.6);
  backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
  z-index:5000; display:flex; align-items:center; justify-content:center; padding:20px; }
.dialog-overlay.hidden{ display:none; }
.dialog-box{ background:var(--modal-bg); border:1px solid var(--border); border-radius:var(--r-lg);
  box-shadow:var(--sh-lg); width:100%; max-width:400px; padding:22px; animation:popIn .22s var(--spring); }
.dialog-title{ font-size:16px; font-weight:700; margin-bottom:8px; color:var(--text); }
.dialog-msg{ font-size:14px; color:var(--text-muted); line-height:1.5; margin-bottom:16px; white-space:pre-wrap; }
.dialog-actions{ display:flex; gap:8px; justify-content:flex-end; }
```
`.btn-danger` (css/styles.css:321-328) is reused for `danger:true` confirms; do not add a new danger style.

---

### Full routing table (34 switch cases + dept family)

| navigateTo page | hash | sub-tab routing |
|---|---|---|
| dashboard | `#/dashboard` | — |
| company | `#/company` | session-only |
| tasks | `#/tasks` | — |
| submissions | `#/submissions` | — |
| files | `#/files` | session-only |
| cash | `#/cash` | — |
| personal-finance | `#/personal-finance` | — |
| my-dept | `#/my-dept` | — |
| departments | `#/departments` | — |
| analytics | `#/analytics` | — |
| approvals | `#/approvals` | — |
| team | `#/team` | — |
| progress | `#/progress` | — |
| bs-quote-builder | `#/bs-quote-builder` | — (qb iframe, Overlay-wired) |
| bk-quote-builder | `#/bk-quote-builder` | — (qb iframe, Overlay-wired) |
| partner-projects | `#/partner-projects` | — |
| notifications | `#/notifications` | — |
| bs-quotations | `#/bs-quotations` | — |
| bs-clients | `#/bs-clients` | — |
| bs-files | `#/bs-files` | — |
| bk-quotations | `#/bk-quotations` | — |
| help | `#/help` | — |
| sops | `#/sops` | session-only |
| posts | `#/posts` | — |
| memos | `#/memos` | — |
| team-directory | `#/team-directory` | — |
| attendance | `#/attendance` | — |
| cash-advances | `#/cash-advances` | — |
| leave | `#/leave` | — |
| inventory | `#/inventory` | — |
| product-database | `#/product-database` | president-gated (unchanged inline) |
| audit-log | `#/audit-log` | president-gated (unchanged inline) |
| search | `#/search` | — |
| sales-orders | `#/sales-orders` | — |
| projects-lifecycle | `#/projects-lifecycle` | — |
| `dept:<Name>` | `#/dept/<Name>` (+ `/<subtab>` on Finance/Sales/Partners) | ROUTED on the 3 in-scope screens; session-only elsewhere |

No route names are invented — hashes are the existing page strings verbatim (`dept:` → `dept/`).

---

### Dialog migration table — the 11 `prompt()` sites (complete, exact replacements)

All enclosing functions must be `async` (arrow handlers already are where noted). Replace `prompt(...)` with `await promptDialog({...})`; `null` return keeps native cancel semantics.

| file:line | before | after |
|---|---|---|
| app.js:1177 | `prompt('Notes for the partner…') \|\| ''` | `(await promptDialog({message:'Notes for the partner (what changed / what to confirm)?', multiline:true})) \|\| ''` |
| departments.js:244 | `(prompt('Reason for deleting this quote?…')\|\|'').trim()` | `((await promptDialog({message:'Reason for deleting this quote? (sent to the President for approval)', required:true, multiline:true}))\|\|'').trim()` |
| departments.js:1770 | `(prompt('Paste a link to attach:')\|\|'').trim()` | `((await promptDialog({message:'Paste a link to attach:'}))\|\|'').trim()` |
| departments.js:1785 | `prompt('Edit message:', c?.text\|\|'')` | `await promptDialog({message:'Edit message:', value:c?.text\|\|'', multiline:true})` |
| departments.js:3898 | `prompt('Manual override…', ps.status\|\|'draft')` | `await promptDialog({title:'Manual override', message:`Set status for ${ps.workerName}. Options: ${PAYSLIP_STAGES.join(', ')}`, value:ps.status\|\|'draft'})` |
| departments.js:8700 | `prompt('Reason for deleting this quote?…')\|\|''` | `(await promptDialog({message:'Reason for deleting this quote? (sent to the president for approval)', required:true, multiline:true}))\|\|''` |
| departments.js:9464 | `prompt('Notes for the partner…')\|\|''` | `(await promptDialog({message:'Notes for the partner (what to revise)?', multiline:true}))\|\|''` |
| departments.js:9514 | `prompt('Reason for rejection (optional):')\|\|''` | `(await promptDialog({message:'Reason for rejection (optional):', multiline:true}))\|\|''` |
| departments.js:9744 | `prompt('Reason for rejection (optional):')\|\|''` | `(await promptDialog({message:'Reason for rejection (optional):', multiline:true}))\|\|''` |
| departments.js:10243 | `prompt('Reason for deleting this client folder?…')\|\|''` | `(await promptDialog({message:'Reason for deleting this client folder? (sent to the president for approval)', required:true, multiline:true}))\|\|''` |
| modules.js:2354 | `prompt('Reason for rejection (optional):')\|\|''` | `(await promptDialog({message:'Reason for rejection (optional):', multiline:true}))\|\|''` |

### Dialog migration — the 68 `confirm()` sites (mechanical rule + verified special cases)

**Bulk rule (covers the 64 negative-idiom sites):** `if (!confirm(MSG)) return;` → `if (!await confirmDialog({ message: MSG })) return;`. If MSG contains "cannot be undone", "Delete", "Remove", or a peso figure being destroyed → add `danger:true`. Ensure the enclosing function is `async` (add the keyword; the guard is already an early return so no other change). Implementer re-greps at build time (`grep -nE '\bconfirm\(' js/*.js`) rather than trusting a frozen count.

**Verified special cases (positive-branch — already `async`, wrap the body):**
| file:line | transform |
|---|---|
| app.js:5565 | `if(confirm('Delete this memo?')){…}` → `if(await confirmDialog({message:'Delete this memo?', danger:true})){…}` |
| app.js:5803 | same pattern → `confirmDialog({message:'Delete this memo?', danger:true})` |
| app.js:5867 | `if(confirm('Delete?'))` → `if(await confirmDialog({message:'Delete this policy?', danger:true}))` |
| app.js:5929 | `if(confirm('Remove this resource?'))` → `if(await confirmDialog({message:'Remove this resource?', danger:true}))` |

**financeDelete (departments.js:192):** `if (!confirm(\`Delete ${label}? This cannot be undone.\`)) { resolve('cancelled'); return; }` → `if (!(await confirmDialog({ message:`Delete ${escHtml(label)}? This cannot be undone.`, danger:true, html:true }))) { resolve('cancelled'); return; }` — the enclosing `new Promise((resolve)=>{…})` executor must become `async (resolve)=>{…}` (safe: the promise still resolves via the existing `resolve()` calls). **escHtml is now required** because `label` moves from native-`confirm` plain text into HTML — this is the injection risk the brief flags; apply `html:true` + `escHtml()` on any confirm/prompt message that interpolates a user-entered name/label.

### `openModal` triage — the 107 sites

**Policy (decisive):** every `openModal()` call becomes ONE of exactly two things — no third option, no per-site judgment:

- **→ `openPage(` (mechanical token swap, ~65 sites):** any modal whose body is a multi-field create/edit FORM for a domain record. Concretely, swap these enumerated sites (from the brief's grounded pass) and any other `openModal` whose body contains ≥2 `.form-group`/`<input>`/`<textarea>`/`<select>` fields: departments.js:1029,1120 (Task), 1280 (Submission), 1614 (Expense), 1987 (Raise), 2242,2496 (Payroll record), 3038,3155,3264 (Ledger/Cash entries), 3687 (Worker profile), 3915,3999 (Payslip), 5388,8765,8999 (Quotes), 5975,6304 (Project), 6429,6597 (Drawing), 7004 (IT ticket), 7065,7103 (Asset), 8390 (Sales Order — drop its now-redundant `size:'wide'`), 10195 (Client), 11684 (Production Order), 12245 (RFQ), 12561 (Purchase); app.js:6565 (Employee profile — drop `size:'wide'`), 6629 (Worker account); modules.js:262,299 (Post), 1582 (CA request), 1992 (Inventory item), 2153 (Job cost), 2297 (Leave). The `opts.size` arg (if present) is dropped — `openPage` is always full-screen. Their existing `closeModal()` calls on submit-success work unchanged.
- **stays `openModal(` (history-aware small dialog, ~42 sites):** confirmations, single-field asks, credential-reveals (departments.js: Worker-Account-Created L6733-area, app.js:6798,6830 Reset-Password result — MUST stay a modal; navigating away right after minting a one-time secret is hostile), copy/link displays (departments.js:8330 order-tracking link), read-only lists/detail popovers (modules.js:246 Liked-by, 728/757 Standings, 1179 Attendance-edit, 405 Set-Note; app.js:6851 phone), and `financeDelete`'s reason form (departments.js:198). These gain Back-dismissal for free via the `openModal` rewrite — no per-site change.

**Not in scope:** converting `openPage` panels into *bespoke routed pages* with their own `navigateTo` cases and render functions. `openPage` satisfies "full pages with Back" mechanically; dedicated routes are a later progressive enhancement (flagged below).

---

### Task panel + quote-builder iframe (highest-risk gap) — IN SCOPE, wired to Overlay

**`openTaskDetail` (departments.js:690):** after `document.body.appendChild(panel)` and the slide-in, register: `window.Overlay.push('task', () => window.closeTaskPanel());`. **`closeTaskPanel` (departments.js:680)** becomes DOM-teardown-ONLY (its current body is already exactly that) — the `#task-panel-back` button (departments.js:732) changes from `onclick=closeTaskPanel` to `window.Overlay.dismissTop()`. `navigateTo`'s unconditional `closeTaskPanel()` teardown (app.js:1843) stays but is now redundant with `Overlay.clearAll()`; keep it as a belt-and-suspenders (idempotent — no-op if already removed).

**`renderQuoteBuilderIframe` (app.js:1076):** after the iframe host `#qb-fullscreen` is appended, register `window.Overlay.push('qb', () => document.getElementById('qb-fullscreen')?.remove());`. Because the qb host is itself reached via `navigateTo('bk-quote-builder')` (a page), it is BOTH a page and an overlay — resolve by NOT registering it as an overlay; instead it stays a normal routed page (`#/bk-quote-builder`) and its teardown remains the existing app.js:1846 line. Device Back from the quote builder therefore returns to the previous page (correct). **Decision: qb = page (no Overlay entry); task panel = overlay (Overlay entry).** This matches their real UX: qb is a destination, task-detail is a drill-in.

---

### Migration checklist (numbered, sequential — ordering is load-bearing)

1. **History layer, no call-site changes yet.** Add `hashFor`/`parseHash`/`window.hashFor` + `window._navDepth` to app.js; add `window.Overlay` + `setSubroute`/`initialSubtab` to config.js; rewrite `navigateTo` (B), `updateNavBackBtn`/`navBack` (A); add the `popstate`/`hashchange`/`keydown` wiring (D); change auth-resolve initial route (E). Verify Back/Forward/refresh across 3-4 top-level pages and that pull-to-refresh still re-renders in place.
2. **Overlay-ify the modal + panel surfaces.** Rewrite `openModal`/`closeModal`, add `openPage` (C); add `#dialog-overlay` markup + the CSS block; wire the task panel to Overlay (register + `#task-panel-back` → `dismissTop`). Verify: open a modal → device Back closes it (not the page); open task detail → Back closes it; open a modal then click a nav item → modal tears down and page changes.
3. **Build `confirmDialog`/`promptDialog`** (config.js). Verify against 3 sample sites (one `if(!confirm)` guard, one positive-branch, one `prompt` with default) — confirm nesting works (a confirmDialog opened from inside an `openPage` form; Back closes the dialog first, then the page).
4. **Sweep all `confirm()` sites** per the rule + special-case table; add `async` to each enclosing function; `escHtml`+`html:true` on any message interpolating a user label. Re-grep to confirm zero `\bconfirm\(` remain.
5. **Sweep all `prompt()` sites** per the 11-row table. Re-grep to confirm zero `\bprompt\(` remain.
6. **Sweep the ~65 form `openModal(`→`openPage(`** per the triage list; drop any `size:` arg on those. Re-verify each converted form still submits and closes (they call `closeModal()` → generic dismiss).
7. **Adopt sub-tab routing** on Finance/Sales/Partners (2-line change each: `initialSubtab` seed + routed `bindChipTabs` callback). Verify refresh on `#/dept/Finance/Purchases` restores the Purchases chip.
8. **CACHE_VER bump in sw.js** (mandatory — JS+CSS touched). Commit (pre-commit hook auto-bumps APP_VERSION/index.html version strings). No `firebase deploy` needed (no rules/collection change). Smoke test on a real server (`npx serve -p 3838 .`).

### Manual test checklist (no automated suite exists)

- [ ] Deep-link: paste `#/dept/Finance/Purchases` into a fresh tab → lands on Finance/Purchases after auth.
- [ ] Refresh on any page (not just dashboard) → same page restores (auth-resolve reads hash, not hardcoded dashboard).
- [ ] Device/browser Back through 3 page navigations → walks back correctly; top-bar chevron hidden on dashboard, shown elsewhere.
- [ ] Open a form (openPage) → visible back chevron; device Back and the chevron both close it and reveal the underlying page unchanged.
- [ ] Open modal → device Back closes modal only (page stays). Open modal → click a nav link → modal gone, page changed, and a subsequent Back goes to the page under the modal (not a ghost).
- [ ] Nested: openPage form → confirmDialog inside it → Back closes dialog first, second Back closes the page.
- [ ] Task detail: open → Back closes panel. Quote builder: open → Back returns to previous page.
- [ ] `confirmDialog` danger styling uses `.btn-danger`; cancel/backdrop/Esc all resolve false; `promptDialog` required-field disables OK until non-empty and returns null on cancel.
- [ ] Injection: a client/quote named `<img src=x onerror=alert(1)>` in a delete confirm renders as text, not markup (escHtml applied).
- [ ] Dashboard Back/Forward does NOT leak Chart.js canvases (charts destroyed on every `navigateTo`, including fromHistory renders).
- [ ] Pull-to-refresh still re-renders current page without adding a history entry or reloading.

### ‼️ FLAG FOR NEIL

- **Scope line on "pages":** this workstream delivers "full pages with Back" via `openPage` (full-screen sliding panels with a real Back button + history entry) — functionally identical UX to a routed page, achieved with a mechanical one-token swap. Converting the biggest forms (New Quote, New Project, Sales Order, Payslip editor) into *dedicated URL routes* (`#/quote/new`, deep-linkable, own render function) is deliberately deferred as a later enhancement. **Confirm this satisfies the "no pop-ups" mandate for v12** — if you want specific forms to be true bookmarkable routes now, name them and they'll get dedicated `navigateTo` cases.
- **Sub-tab routing is adopted on 3 screens only** (Finance, Sales, Partners) this pass; the other ~12 `chipTabs` screens keep session-only sub-tabs. Say the word if any other screen's sub-tab must survive refresh/Back and it'll be added (2-line change each).

## Risks / cross-workstream interactions

- ⚠️ **Representative breakdown of the 107 `openModal()` calls, by department/file, to inform the forms-become-pages vs. stays-a-dialog split (not exhaustively classified — a sample to ground Fable's own pass):**

*Likely full-page candidates (multi-field forms or rich detail/record views, several already opt into `.modal-wide`/`.modal-full` because the default 620px is visibly too small)* — e.g. js/departments.js: 'New/Edit Task' (L1029,1120), 'New Submission' (L1280), 'Add Expense/Receipt' (L1614), 'Give Raise' (L1987), 'Edit Payroll Record'/'Edit Payroll' (L2242,2496), 'New Ledger Entry'/'New Cash Receipt Entry'/'New Cash Disbursement Entry' (L3038,3155,3264), 'Add/Edit Worker Profile' (L3687, already full-height content), 'Generate Payslip'/'Edit Payslip' (L3915,3999), 'New/Edit Quote BK' (L5388, and the two later New/Edit Quote forms at L8999/L8765 — these are the biggest forms in the app), 'New Project'/'Edit Project' (L5975,6304), 'New Drawing'/'Edit Drawing' (L6429,6597), 'New IT Ticket' (L7004), 'Add/Edit Asset' (L7065,7103), 'Create Sales Order' (L8390, already `.modal-wide`), 'Add/Edit Client' (L10195), 'New/Edit Production Order' (L11684), 'New Request for Quotation' (L12245), 'Record Purchase — Cash Disbursement' (L12561); js/app.js: 'Record Monthly Payroll' (L4101, modules.js actually), 'Add Employee Profile' (L6565, already `.modal-wide`), 'Create Worker Account' (L6629); js/modules.js: 'New Post'/'Edit Post' (L262,299), 'Add/Edit Inventory Item' (L1992), 'Add/Edit Job Cost' (L2153), 'Request Leave' (L2297), 'Request Cash Advance' (L1582).

*Likely true small confirmations/single-field asks (plausibly stay as compact dialogs)* — e.g. js/departments.js: 'Request Deletion — President Approval' (L198, one textarea + submit), 'Client Order-Tracking Link' (L8330, display+copy), 'Approved — Action Required' (L9856, informational+single action); js/app.js: 'Set Your Note' (modules.js:405 actually), 'Add Your Phone Number' (L6851), 'Reset Password'/'Password Reset' result (L6798,6830 — credential-reveal, arguably must stay a modal since a full-page navigation away would be jarring right after generating a one-time secret), 'Worker Account Created' (L6733, same credential-reveal shape); js/modules.js: 'Liked by' (L246, read-only list), 'Employee of the Month — Standings' (L728/757, read-only), 'Set Your Note' (L405), '✎ Attendance — {date}' (L1179, small single-record edit), Item 'Movement History' (departments.js:1972 area referenced from modules.js, read-only list).

This is a representative sample only (roughly 60-70% of the 107 read as full forms per this pass; the rest split between small-input dialogs and read-only detail/list popovers) — Fable should still do its own classification pass before committing to a migration list, this is meant to save re-discovery time, not replace judgment.
- ⚠️ **Interaction with WS9 (BRAND module + rename sweep)**: both WS10 and WS11 will touch nearly every render function across app.js/departments.js/modules.js (WS10 because every `navigateTo`/`openModal` call site potentially changes shape; WS11 because every `confirm`/`prompt` call site changes). If WS9 lands first and also touches strings across the same files (title/brand text), there's a real merge-conflict/ordering risk — Fable's build spec should state an explicit ordering assumption (e.g. "assumes WS9 has already landed" or vice versa) rather than silently assuming a clean tree.
- ⚠️ **Interaction with WS16 (perf & scale) — `dbCachedGet`/Chart.js-on-demand**: `navigateTo` already destroys Chart.js instances on every page change (app.js:1850-1855) specifically to avoid leaks; a History-API rewrite that fires `navigateTo` from a `popstate` listener must preserve this teardown order (destroy charts → blank content → render new page) or dashboards will leak canvases on Back/Forward navigation, which didn't exist as a failure mode when `navigateTo` was only ever called from explicit UI clicks.
- ⚠️ **Interaction with WS17 (design-system consolidation)**: the `.modal-overlay`/`.modal-box` CSS is DUPLICATED in css/styles.css at two separate locations (lines ~2097-2118 AND ~3394-3407, both with near-identical rules, plus a third `html.light`-scoped override block at ~2590 and ~3679) — this is exactly the "override-stacked CSS" WS17 is meant to collapse. Whoever builds WS11's confirmDialog styling should be aware there are two live modal-box rule blocks to keep in sync (or consolidate as a byproduct), not one.
- ⚠️ **Interaction with WS18 (keyboard shortcuts, Esc closes overlays)**: confirmed zero existing Escape-key handling anywhere. If WS11 ships confirmDialog with its own Esc-to-cancel binding and WS18 later adds a global Esc-closes-overlays handler, there's a double-handling / event-order risk (e.g. both fire, or WS18's handler doesn't know about confirmDialog's DOM shape). Flag for Fable to either sequence these workstreams or have WS11 explicitly design confirmDialog's DOM/API so a later generic Esc handler can target it (e.g. a consistent `.dialog-overlay.active` class it can query for, mirroring how `updateNavBackBtn` already queries `_navHistory.length`).
- ⚠️ **The task-fullscreen-panel and `#qb-fullscreen` iframe host are a de-facto 3rd/4th navigation surface** or with no back-button semantics today (see currentState #5) — if WS10 only wires up `navigateTo` pages to History API and ignores these, the owner's "device Back works everywhere" expectation will silently not hold for task detail view or the quote builder, which are two of the most-used screens in the app. This is the single highest-risk gap if under-scoped.
- ⚠️ **Migration hazard — inline `onclick="..."` string handlers**: many `openModal`/`navigateTo` call sites are wired via inline HTML attribute strings (`onclick="navigateTo('dept:Finance')"`, confirmed dozens of examples in the app.js dashboard-rendering functions L2082-3092) rather than `addEventListener`. If `confirmDialog()`/async-ified confirm call sites end up needing to be `async` functions, any inline `onclick="if(!confirm('...'))return; doThing()"` pattern (present in departments.js, e.g. L5565 `if(confirm('Delete this memo?')){await window.deleteMemo(...)}`) will need restructuring since inline attribute handlers awkwardly support `await` — small but real mechanical-conversion friction across dozens of sites.
- ⚠️ **79-count is a moving target**: the audit's "79 native confirm()/alert()/prompt()" count was verified to still hold exactly (68 confirm + 11 prompt + 0 alert = 79) against the CURRENT `v12` branch state as of this brief, but Phase 1 already touched departments.js/app.js/modules.js once — future intervening commits before WS11 actually starts could shift this number slightly; the build spec should re-grep at implementation time rather than hardcode "79" as gospel.

## Files likely touched

`js/app.js (navigateTo, navBack/_navHistory, openModal/closeModal, updateNavBackBtn, setActiveNav, dashboard onclick="navigateTo(...)" call sites, closeTaskPanel teardown hook, #qb-fullscreen teardown hook, ~14 confirm()+1 prompt() call sites)`, `js/departments.js (~66 openModal() call sites across every department screen, ~46 confirm()+9 prompt() call sites, openTaskDetail/closeTaskPanel full-screen panel, financeDelete() Promise-dialog prior art, renderDeptModule + chip-tab sub-screens)`, `js/modules.js (~18 openModal() call sites, ~8 confirm()+1 prompt() call sites, Posts/Team/Attendance/CashAdvance/Inventory/Leave screens)`, `js/config.js (chipTabs/bindChipTabs — candidate home for confirmDialog() given its load-order position before departments.js; DEPARTMENTS map used by dept: routing)`, `index.html (#modal-overlay/#modal-box/#modal-title/#modal-body/#modal-footer markup L260-267; #profile-drawer/#drawer-overlay L274-285; possible new #confirm-dialog markup; script load order untouched but any new file added needs adding here per CLAUDE.md)`, `css/styles.css (.modal-overlay/.modal-box/.modal-wide/.modal-full, duplicated at ~L2097-2118 and ~L3394-3407 plus light-theme overrides at ~L2590/~L3679; any new confirmDialog-specific classes; .btn-danger already exists at L321-328 and should be reused for destructive-dialog styling)`, `sw.js (CACHE_VER bump — mandatory per CLAUDE.md for any JS/CSS edit)`, `404.html (new file, ONLY if Fable chooses real pushState paths over hash routing — needed for GitHub Pages deep-link/refresh survival; does not exist today)`, `js/notifications.js (only if confirmDialog's toast-adjacent UX is meant to share code with Notifs.showToast; not required, flagging as a possible touch point)`

## Expected deliverable format

> Fable's output should be consumable mechanically by a cheaper model with no further judgment calls, meaning:
> 
> 1. **Exact function signatures** for every new/changed global: e.g. the final `confirmDialog(opts)` signature (param names, types, return shape — Promise<boolean> vs richer outcome), the final `navigateTo(page, opts)` signature if params are added (e.g. a second arg for sub-tab / record id), and how `window.history.state` is shaped (e.g. `{page: 'dept:Finance', subtab: 'Purchases'}`).
> 2. **Before/after code blocks** for the load-bearing functions this brief cites by exact line — `navigateTo` (app.js:1828-1904), `navBack`/`updateNavBackBtn` (app.js:1817-1826), `openModal`/`closeModal` (app.js:7075-7096) — so Sonnet can diff-apply rather than reinvent.
> 3. **A full call-site migration table**, not just representative samples: every one of the 79 confirm/prompt sites (file:line) mapped to its replacement call (`await confirmDialog({...})`), flagging which enclosing functions need `async` added; every one of the 107 openModal sites (file:line) tagged either "stays a dialog" (with its confirmDialog/modal treatment) or "becomes a page" (with its target route name under the new router) — this brief's representative breakdown is a starting point, not a substitute for Fable's own complete pass.
> 4. **The exact routing table**: every one of the 34 `navigateTo` switch cases (plus the `dept:` family and any newly-split sub-tab routes) mapped to its final URL/hash pattern, so Sonnet can generate the `popstate`/`pushState` wiring without inventing route names itself.
> 5. **A numbered, sequential migration checklist** (not a prose plan) covering: (a) build the History-API layer without changing any call site yet, verify Back/Forward/refresh on a couple of pages; (b) migrate `openModal`/panel/iframe dismissal to push+pop history entries; (c) build `confirmDialog()`, verified against 2-3 sample call sites; (d) mechanically sweep the remaining confirm/prompt sites per the table from #3; (e) mechanically sweep the openModal-to-page migrations per the table from #3; (f) CACHE_VER bump + smoke test. Ordering matters because (b) and (c) both touch `openModal`'s call sites' surrounding control flow.
> 6. **The `404.html` file content verbatim**, if Fable picks real pushState paths — Sonnet should not have to decide GitHub-Pages SPA-fallback boilerplate itself.
> 7. **Explicit fallback/degradation behavior** for the task-fullscreen-panel and `#qb-fullscreen` overlays (either "wire into the same history mechanism as modals" with exact code, or "explicitly out of scope for this workstream, tracked as follow-up" — but a decision either way, not silence, since this brief flags it as the highest-risk gap).
