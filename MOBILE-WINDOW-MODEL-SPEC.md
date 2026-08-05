# MOBILE WINDOW MODEL — Implementation Spec

**Date:** 2026-08-05 · **Author:** Fable (planning session) · **Status:** ready for implementation
**Owner report:** on iPhone, an open chat thread behaves like an overlay, not a window — with the
keyboard up, the thread header slides under the iOS status bar, the chat **inbox list bleeds
through below the composer**, and the in-thread search bar floats as a third misaligned layer.
Owner's words: *"it should be a different window, no overlaps, no redundancies"* — and he expects
the same model for **every** pushed page (tasks etc.), not a chat-only patch.

**Target device:** iPhone, installed to home screen (standalone PWA, `viewport-fit=cover`).
That is the environment every decision below is calibrated for.

---

## 0. Root cause (verified in code — do not re-derive)

1. `css/styles.css:3803-3845` — `@media (max-width:640px) body.chat-fullscreen #chat-thread-panel
   { top:0!important; bottom:var(--kb-offset,0)!important; … z-index:var(--z-dialog) }`.
   `js/chat.js:1521-1540` (`_onViewportResize`) computes
   `offset = max(0, innerHeight − vv.height − vv.offsetTop)` and writes it to `--kb-offset`.
2. `position:fixed` resolves against the **layout viewport**, which iOS does **not** shrink when
   the keyboard opens (the keyboard overlays it). Raising `bottom` by the keyboard height
   therefore opens a transparent band between the panel's new bottom edge and the layout-viewport
   bottom — the chat inbox (`#page-content`) shows through it. That is the bleed in the
   screenshot.
3. iOS additionally **pans** the layout viewport upward to reveal the focused input
   (`visualViewport.offsetTop > 0`). Every `position:fixed` element rides that pan — the thread
   header slides up under the status bar. chat.js listens only for vv `resize`, never `scroll`,
   so pure pans are never even observed.
4. Nothing beneath the top page is inert: `.page-under{visibility:hidden}` (styles.css:2214)
   covers stacked *panels* only — the base route `#page-content` is never hidden. There is **no
   body scroll lock anywhere in the app**, so iOS is free to scroll/pan the document behind any
   open page.
5. Chat maintains a bespoke second mechanism on top of the generic page stack
   (`body.chat-fullscreen`, its own 640px breakpoint vs the shell's 768px, a duplicate hidden
   `.page-panel-head` above its own `.ms-thread-header` — flagged "for the CSS owner" at
   js/chat.js:944-948). That is the "redundancies" half of the complaint.

---

## 1. Design decisions

### 1.1 Viewport anchoring — anchor the open page to the *visual viewport rectangle*

**Chosen:** a single central `visualViewport` listener (`ViewportSync`, new, in js/config.js)
publishes two CSS custom properties on `<html>`:

| var | value | meaning |
|---|---|---|
| `--vvh` | `visualViewport.height` px | height of the actually-visible area |
| `--vv-top` | `visualViewport.offsetTop` px | how far iOS has panned the layout viewport |

and the phone-tier `.page-panel` rule becomes:

```css
top: var(--vv-top, 0px); height: var(--vvh, 100%); bottom: auto;
```

Why this is the only geometry the iOS keyboard cannot break: fixed-position coordinates are
layout-viewport coordinates; `offsetTop` and `offsetTop + height` are exactly the visible rect's
top/bottom edges *in those same coordinates*. Whatever iOS does — overlay the keyboard, pan to
the caret, interactive-drag-dismiss — the panel's header stays glued to the visible top and its
composer/footer stays glued just above the keyboard. No band can open below it (the panel's
bottom edge *is* the keyboard's top edge), and the header cannot ride under the status bar (the
`--vv-top` offset exactly counters the pan).

`top`/`height` are driven, **not** `transform` — `.page-panel`'s slide-in transition is
`transition: transform .3s` (styles.css:2193), so transform is owned by the open/close animation
and top/height changes apply instantly with no tween. The handler is rAF-coalesced; iOS 16+
interactive keyboard dismissal streams vv `scroll` events and this tracks them smoothly.

**Rejected / partial alternatives (be aware, do not resurrect):**
- **`100dvh` / `svh` / `lvh`** — dynamic viewport units track browser-chrome (URL bar) resizing,
  **not the soft keyboard**, on iOS. `100dvh` is unchanged with the keyboard open. Solves nothing
  here; also does nothing about the pan (`offsetTop`). Keep existing `dvh` usages as-is.
- **`interactive-widget=resizes-content` viewport meta** — **ignored by iOS Safari/standalone**
  entirely. On Android/Chromium ≥108 it is genuinely useful: installed (standalone) PWAs default
  to keyboard-overlays-content there, and this key restores layout-viewport resizing so
  `innerHeight == vv.height` and the same var-driven geometry degrades to a no-op. We **add it**
  (Batch 5) as Android hardening, but it is explicitly *not* the iOS fix.
- **VirtualKeyboard API (`navigator.virtualKeyboard`, `env(keyboard-inset-height)`)** —
  Chromium-only. Not available on iOS. Do not use.

**iOS standalone quirks handled explicitly:**
- vv events are occasionally swallowed around keyboard show/hide in standalone mode → ViewportSync
  re-syncs on window `focusin`/`focusout` with 250ms + 700ms delayed passes.
- Pure pans fire vv `scroll` (no `resize`) → ViewportSync listens to **both**.
- `env(safe-area-inset-top)` stays constant through pans, so notch padding on headers remains
  correct at every keyboard state.

**Named fallback:** if `window.visualViewport` is absent (no supported iOS this app targets, but
belt-and-braces), ViewportSync publishes `--vvh: innerHeight`, `--vv-top: 0` — the panel covers
the full layout viewport. Degraded (keyboard may cover the composer) but **layering never
breaks**, because of 1.2.

### 1.2 Occlusion — nothing behind an open window may ever paint

New body class **`page-open`**, toggled centrally by openPage/teardown (never by callers), active
only on the phone shell (≤768px). Under it, the shell chrome **and the base route** stop
painting:

```css
body.page-open #topbar, body.page-open #top-nav-strip,
body.page-open #bottom-nav, body.page-open .main-content {
  visibility: hidden; transition: visibility 0s linear 0.35s;
}
```

- `visibility` (not `display`): fixed bars keep their layout; zero reflow; hit-testing excluded.
- The `0.35s` delay lets the panel's 0.3s slide-in play *over* the previous screen exactly as it
  does today; when the class is removed on close, the rule no longer matches so paint restores
  **instantly** — the slide-out reveals the screen beneath, unchanged UX.
- This is the belt to 1.1's braces: even if a future geometry bug reopens a gap, what shows
  through is the flat `var(--bg)` html background — never the inbox rows from the screenshot.
- `#main-content` additionally gets the `inert` attribute while a window is open on phone
  (guarded `'inert' in el`; iOS 15.5+), so the base route can't take focus or scroll intents.
- `.page-under` (stacked panels) stays exactly as-is — it already handles panel-under-panel.

### 1.3 Body scroll lock — centralized, refcounted, iOS-proof

New **`window.ScrollLock`** (js/config.js), the classic iOS pattern — `overscroll-behavior` alone
does **not** stop iOS auto-scrolling the document to a focused input:

- `acquire()`: on first acquisition, save `window.scrollY`, then
  `body { position:fixed; top:-savedY px; left:0; right:0; width:100%; overflow:hidden }`.
- `release()`: on last release, clear those five inline styles and `window.scrollTo(0, savedY)` —
  exact scroll restoration.
- Refcounted so stacked pages and qb-fullscreen never double-lock or early-unlock.

Acquired **per page push** on the phone shell inside `openPage` and released in that page's
teardown/replace paths (flag rides the panel element — symmetric even through
`Overlay.clearAll()` mass teardown, which runs every teardown). Also acquired/released by
`enterQbFullscreen`/`exitQbFullscreen`. **No caller ever touches it directly.**

With the document unscrollable, iOS has nothing to scroll and falls back to pure visual-viewport
panning — which 1.1 tracks. Inputs inside the panel still auto-reveal fine: their scrollable
ancestor is `.page-panel-body` (or chat's `#chat-thread-scroll`), which remains scrollable.

### 1.4 Chrome de-duplication — one mechanism, one header, one breakpoint

- **`body.chat-fullscreen` is deleted** (CSS block styles.css:3797-3845 and the chat.js
  enter/exit functions). Chrome hiding for *every* open window is `body.page-open` (1.2). The
  `--kb-offset` mechanism is retired completely (CSS rule, both JS writers, the teardown
  `removeProperty`).
- **Header:** chat keeps its rich `.ms-thread-header` (avatar, presence, search/info buttons —
  the generic plain-text `.page-panel-head` cannot host those, per the analysis already written
  at js/chat.js:932-948). The generic head is hidden **by CSS** at all widths:
  `#chat-thread-panel .page-panel-head { display:none; }` — replacing the inline-style stopgap at
  js/chat.js:1075-1076 and resolving the "flagged for the CSS owner" comment. Net: exactly one
  header per window, everywhere.
- **Breakpoint: 768px wins.** It is what the entire mobile shell keys on (top-nav-strip,
  bottom-nav, sidebar collapse, the `.page-panel` mobile override at styles.css:2529, and
  `body.qb-fullscreen` — whose comment at styles.css:3847-3853 already calls chat's 640px a
  "one-off"). JS check: new `window.isPhoneShell()` = `matchMedia('(max-width:768px)').matches`,
  used by app.js and chat.js alike; chat's `_isPhoneWidth()` (640) is deleted.
  **What changes on 641-768px** (landscape phones / small tablets): a chat thread now hides the
  top strip / bottom nav and goes full-bleed like every other window, instead of rendering inside
  chrome. That is a deliberate *alignment* with the owner's window model, not a regression — and
  those widths already hide chrome for the quote builder today. ≥769px is untouched.
- **Full-bleed model generalized:** at ≤768px every `.page-panel` covers from the very top of the
  screen (`--vv-top` is 0 at rest); the header row carries the notch inset
  (`padding-top: calc(12px + env(safe-area-inset-top))` on `.page-panel-head`, and the
  equivalent on chat's `.ms-thread-header`). This is exactly the model chat-fullscreen already
  shipped, now owned by the generic panel. The `body::after` status-bar cap (styles.css:2487)
  stays for the base route; open windows simply cover it.

### 1.5 What this does NOT touch

- **Desktop (>768px) must stay byte-identical.** Base `.page-panel` rule (styles.css:2191-2195)
  unchanged; ≥1024px two-pane chat (styles.css:3766-3795, the `#chat-thread-panel` `left:calc(…)
  !important` rule) unchanged; `body.page-open` is never set on desktop; ScrollLock never
  acquired on desktop; ViewportSync's vars exist on desktop but nothing consumes them there.
- **`body.qb-fullscreen`** (styles.css:3854-3877) keeps its own class and geometry — the iframe
  is a separate document that pads its own safe areas, the owner has not reported it, and folding
  it is not required for "no overlaps". Only change: it now also acquires/releases ScrollLock.
- **Modals** — the ≤639px full-cover modal (styles.css:5014-5046) has the same *theoretical*
  keyboard exposure but was not reported; out of scope this pass. (Future option: point its
  `height` at `var(--vvh)` too — note only, do not implement.)
- **Money code, Firestore, rules, gestures.js, sw.js logic** — untouched. `CACHE_VER` is derived
  from `APP_VERSION` by the pre-commit hook automatically; do not hand-edit.
- Do not add any behavior the owner didn't ask for.

---

## 2. Implementation batches

**Hard project constraints:** one agent per shared file, ever (js/config.js, css/styles.css,
js/app.js, js/chat.js, index.html are each owned by exactly one batch below). NEVER run
`git stash` / `git reset --hard` / `git checkout -- <file>` / `git clean`. The pre-commit hook
re-stages index.html/js/config.js/sw.js (version bump) — run `git diff --cached` before
committing and commit each batch separately. Batches run **in this order, serially**; every
intermediate state is shippable.

---

### Batch 1 — js/config.js (primitives; inert until consumed)

**Insertion point:** immediately after the `window.Overlay = { … }` object closes
(js/config.js:1253, just before the `// ── Confirm / prompt dialogs (v12 WS11) …` comment).

Add exactly:

```js
// ── Mobile window model (2026-08 owner report) — shared primitives ─────────
// isPhoneShell: THE phone-tier check for the window model. 768px matches the
// mobile shell (top-nav-strip / bottom-nav / sidebar collapse) and
// body.qb-fullscreen; chat's old one-off 640px check is retired.
window.isPhoneShell = function () {
  try { return window.matchMedia('(max-width: 768px)').matches; }
  catch (_) { return (window.innerWidth || 0) <= 768; }
};

// ViewportSync — single owner of the visual-viewport CSS variables.
// Publishes on <html>:
//   --vvh    visualViewport.height (px) — height of the VISIBLE area
//   --vv-top visualViewport.offsetTop (px) — how far iOS panned the layout
//            viewport to reveal a focused input
// The ≤768px .page-panel rule (styles.css) anchors every open page to exactly
// this rectangle (top:var(--vv-top); height:var(--vvh)). position:fixed
// resolves against the LAYOUT viewport, which the iOS keyboard overlays (it
// never shrinks) and PANS to reveal the caret — anchoring to the visual rect
// is the only geometry the keyboard cannot break. rAF-coalesced; the
// focusin/focusout re-sync passes cover iOS standalone builds that swallow a
// vv event around keyboard show/hide; the 'scroll' listener covers pure pans
// (offsetTop changes without a resize), which the old chat handler missed.
window.ViewportSync = (function () {
  let raf = 0;
  function apply() {
    raf = 0;
    const de = document.documentElement;
    const vv = window.visualViewport;
    if (vv) {
      de.style.setProperty('--vvh', Math.round(vv.height) + 'px');
      de.style.setProperty('--vv-top', Math.round(vv.offsetTop) + 'px');
    } else {
      de.style.setProperty('--vvh', window.innerHeight + 'px');
      de.style.setProperty('--vv-top', '0px');
    }
  }
  function schedule() { if (!raf) raf = requestAnimationFrame(apply); }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', schedule, { passive: true });
    window.visualViewport.addEventListener('scroll', schedule, { passive: true });
  }
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  ['focusin', 'focusout'].forEach(function (t) {
    window.addEventListener(t, function () {
      setTimeout(schedule, 250); setTimeout(schedule, 700);
    }, { passive: true });
  });
  apply();
  return { refresh: schedule };
})();

// ScrollLock — refcounted body scroll lock (iOS-proof position:fixed +
// saved-scrollY pattern; overscroll-behavior alone does NOT stop iOS from
// auto-scrolling the document to a focused input). Acquired by openPage /
// enterQbFullscreen on the phone shell, released symmetrically on close;
// refcounted so stacked pages never double-lock or early-unlock. Restores
// the exact scroll position on the final release. Callers NEVER lock/unlock
// scroll themselves — this is the only mechanism.
window.ScrollLock = {
  _n: 0, _y: 0,
  acquire() {
    if (++this._n > 1) return;
    this._y = window.scrollY || window.pageYOffset || 0;
    const b = document.body;
    b.style.position = 'fixed';
    b.style.top = (-this._y) + 'px';
    b.style.left = '0'; b.style.right = '0'; b.style.width = '100%';
    b.style.overflow = 'hidden';
  },
  release() {
    if (this._n === 0) return;
    if (--this._n > 0) return;
    const b = document.body;
    b.style.position = ''; b.style.top = '';
    b.style.left = ''; b.style.right = ''; b.style.width = '';
    b.style.overflow = '';
    window.scrollTo(0, this._y);
  }
};
```

No other change in this file. This batch alone changes zero behavior (nothing consumes the vars
or the lock yet).

---

### Batch 2 — css/styles.css (geometry + occlusion + chat de-dup)

**2a. Replace** styles.css:2526-2529 — currently:

```css
  /* Full-screen page panel (openPage) — was pinned below the old #topbar;
     now covers from the very top, same as it used to cover the old
     top-nav-strip underneath the topbar. */
  .page-panel { top: env(safe-area-inset-top, 0px); }
```

(inside the `@media (max-width: 768px)` mobile-shell block that starts at line 2454) — with:

```css
  /* ── Mobile window model (2026-08) — a pushed page IS the window. ──
     Anchored to the VISUAL-viewport rect (--vvh/--vv-top, written by
     ViewportSync in js/config.js), not the layout viewport: position:fixed
     resolves against the layout viewport, which the iOS keyboard overlays
     (never shrinks) and PANS to reveal the focused caret — the old
     bottom-lift approach opened a bleed band above the keyboard and slid the
     header under the status bar (owner screenshot, chat thread). Pinning
     top to the pan offset and height to the visible height keeps the header
     glued below the status bar and the footer/composer glued above the
     keyboard at every keyboard state. top/height (not transform) so the
     .3s transform slide-in transition is never tweened by keyboard moves.
     Full-bleed from the top of the screen: the head row carries the notch
     inset itself. */
  .page-panel {
    top: var(--vv-top, 0px);
    height: var(--vvh, 100%);
    bottom: auto;
  }
  .page-panel-head {
    padding-top: calc(12px + env(safe-area-inset-top, 0px));
  }
  /* Occlusion, belt-and-braces: while ANY window is open on the phone shell
     (body.page-open, toggled centrally by openPage/teardown in js/app.js),
     the shell chrome and the base route stop painting — no geometry mistake
     can ever bleed the layer behind a window again (the exact failure in
     the owner's screenshot: the chat inbox showing through below a
     keyboard-lifted panel). visibility (not display): fixed bars keep their
     layout, and the 0.35s delay lets the panel's 0.3s slide-in play over
     the previous screen exactly as before; on close the class is gone so
     this rule stops matching and paint restores INSTANTLY — the slide-out
     reveals the screen beneath, unchanged. */
  body.page-open #topbar,
  body.page-open #top-nav-strip,
  body.page-open #bottom-nav,
  body.page-open .main-content {
    visibility: hidden;
    transition: visibility 0s linear 0.35s;
  }
```

**2b. Delete** the entire `body.chat-fullscreen` section, styles.css:3797-3845 — from the comment
line `/* ── Owner req #2 — full-screen chat on phone (Facebook Messenger style). …` through the
closing `}` of its `@media (max-width: 640px)` block (the line directly above the
`/* ── Owner req (2026-08-03 mobile-shell batch) — Quote Builder fullscreen …` comment).
**Replace it in place** with:

```css
/* ── Chat thread on the phone shell — window-model residue only. The old
   body.chat-fullscreen mechanism (chat-only chrome hiding at a one-off
   ≤640px breakpoint, plus a --kb-offset bottom lift that opened the
   keyboard bleed band) is retired: chrome hiding + keyboard geometry are
   owned by the generic window model (body.page-open + the --vvh/--vv-top
   .page-panel rules in the ≤768px shell block). What remains is chat's own
   chrome: openPage's generic head is redundant over the rich
   .ms-thread-header (avatar/presence/search/info — they don't fit the
   plain-text .page-panel-title slot), so it is hidden at ALL widths — this
   was an inline-style stopgap in js/chat.js (_buildThreadPanel), CSS owns
   it now — and on the phone shell the thread header carries the notch
   inset because the panel is full-bleed. */
#chat-thread-panel .page-panel-head { display: none; }
@media (max-width: 768px) {
  #chat-thread-panel .ms-thread-header {
    /* base rule fixes height:56px (box-sizing:border-box) — grow via
       min-height so the inset never clips the title/back/actions. */
    height: auto;
    min-height: calc(56px + env(safe-area-inset-top, 0px));
    padding-top: calc(8px + env(safe-area-inset-top, 0px));
    padding-bottom: 8px;
  }
}
```

(No `!important` needed: `#chat-thread-panel .ms-thread-header` outranks the base
`.ms-thread-header` at styles.css:4679.)

**Do not touch:** the base `.page-panel` rule (2191-2195), `.page-under` (2214), the qb block
(3854-3877), the ≥1024 two-pane chat rules (3766-3795), `#chat-thread-panel .messenger-body
{ max-height:none }` (3933), the ≤639 modal block (5014+).

**Note on z-index:** the deleted rule forced the chat panel to `--z-dialog` (5000); it now uses
the Overlay dynamic 300-398 tier like every panel. Correct: dialogs/toasts still stack above it,
chrome (z ≤100) is both below it and visibility-hidden.

---

### Batch 3 — js/app.js (central state sync + qb lock)

**3a.** After js/app.js:3092 (`let _pageSeq = 0;`), add:

```js
// ── Mobile window model — body.page-open + inert sync ──────────────────────
// Called after every push/teardown mutation of _pageStack. On the phone
// shell (≤768px) an open page is a WINDOW: shell chrome + base route stop
// painting (body.page-open, styles.css) and the base route goes inert so it
// can never take focus or scroll intents behind the window.
function _syncWindowState() {
  const phone = !!(window.isPhoneShell && window.isPhoneShell());
  const open = phone && window._pageStack.length > 0;
  document.body.classList.toggle('page-open', open);
  const mc = document.getElementById('main-content');
  if (mc && 'inert' in mc) mc.inert = open;
}
window.addEventListener('resize', _syncWindowState, { passive: true });
```

**3b.** In `openPage`, in the `doReplace` branch (js/app.js:3111-3119), directly after
`if (prevTop.isConnected) prevTop.remove();` add:

```js
      // Window model: replace tears the old top down WITHOUT running its
      // teardown() — release the scroll lock its own push acquired.
      if (prevTop._scrollLocked && window.ScrollLock) { window.ScrollLock.release(); prevTop._scrollLocked = false; }
```

**3c.** In `openPage`, directly after `stack.push(p);` (js/app.js:3151, before
`document.body.appendChild(p);`) add:

```js
  // Window model: every page acquires the (refcounted) document scroll lock
  // on the phone shell — iOS can then only PAN the visual viewport (tracked
  // by ViewportSync), never scroll the base route behind the window. The
  // flag rides the panel so teardown/replace release exactly what this push
  // acquired, symmetric even through Overlay.clearAll().
  if (window.ScrollLock && window.isPhoneShell && window.isPhoneShell()) {
    window.ScrollLock.acquire(); p._scrollLocked = true;
  }
  _syncWindowState();
```

**3d.** In the `teardown` closure (js/app.js:3159-3173), directly after
`if (idx !== -1) stack.splice(idx, 1);` add:

```js
    if (p._scrollLocked && window.ScrollLock) { window.ScrollLock.release(); p._scrollLocked = false; }
    _syncWindowState();
```

**3e.** `enterQbFullscreen` (js/app.js:1579-1585): after
`document.body.classList.add('qb-fullscreen');` add:

```js
  if (window.ScrollLock) window.ScrollLock.acquire();
```

**3f.** `exitQbFullscreen` (js/app.js:1586-1589): it is called unconditionally from navigateTo
(js/app.js:2131) and renderQuoteBuilderIframe (js/app.js:1655) even when fullscreen was never
entered — release only when the class was actually on:

```js
function exitQbFullscreen() {
  const wasOn = document.body.classList.contains('qb-fullscreen');
  document.body.classList.remove('qb-fullscreen');
  if (wasOn && window.ScrollLock) window.ScrollLock.release();
  if (_qbExitPill) { _qbExitPill.remove(); _qbExitPill = null; }
}
```

All ScrollLock/isPhoneShell references are guarded (`window.X &&`) so app.js never hard-depends
on Batch 1 having run (script order already guarantees it, but the guard makes rollback of
Batch 1 non-fatal).

---

### Batch 4 — js/chat.js (retire the bespoke mechanism)

**4a.** Delete the call `_enterFullscreenIfPhone();` and its trailing comment at js/chat.js:1081.

**4b.** Delete `_exitFullscreen();` and its trailing comment at js/chat.js:256 (in
`teardownThread`).

**4c.** Delete the whole fullscreen block js/chat.js:1503-1513 (the `// ── Full-screen thread on
phone…` comment, `_isPhoneWidth`, `_enterFullscreenIfPhone`, `_exitFullscreen`). Nothing else
references them.

**4d.** In `teardownThread`, delete js/chat.js:251-254 (the Wave1-P0-fix-#1 comment plus
`document.documentElement.style.removeProperty('--kb-offset');`) — the var no longer exists.

**4e.** Delete the composer `blur` handler and its comment, js/chat.js:1469-1476, replacing with:

```js
    // Desktop/tablet only (>768px): reset the inline soft-keyboard lift on
    // blur (see _onViewportResize). Phone geometry is CSS-owned (--vvh).
    input.addEventListener('blur', () => {
      if (_threadPanelEl && !(window.isPhoneShell && window.isPhoneShell()))
        _threadPanelEl.style.bottom = '0px';
    });
```

**4f.** Replace `_onViewportResize` (js/chat.js:1521-1540) with:

```js
  function _onViewportResize() {
    const vv = window.visualViewport; if (!vv) return;
    const panel = _threadPanelEl; if (!panel || !panel.isConnected) return;   // openPage-returned panel (Phase2b #3)
    // Phone (≤768px): panel geometry is owned by the window model — the
    // ≤768px .page-panel rule tracks --vvh/--vv-top written by ViewportSync
    // (js/config.js). No per-chat writes. Desktop/tablet (>768px): keep the
    // old inline bottom lift for soft keyboards on touch laptops, where that
    // CSS never applies.
    if (!(window.isPhoneShell && window.isPhoneShell())) {
      panel.style.bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px';
    }
    const scroll = document.getElementById('chat-thread-scroll');
    // Only re-pin to the bottom if the reader was ALREADY there before the
    // keyboard/viewport change (Wave1 P2 fix #17).
    if (scroll && _isNearBottomEl(scroll)) scroll.scrollTop = scroll.scrollHeight;
  }
```

(The listener add at 1492 and remove at 248 stay — the scroll re-snap still needs them.)

**4g.** Delete the inline generic-head hide, js/chat.js:1072-1078 — the comment block
`// Chat renders its own messenger header …`, the `genericHead` const, the `display='none'`
line — but **keep** the `#chat-panel-back` listener wiring. Replacement:

```js
    // Generic .page-panel-head is hidden by CSS (#chat-thread-panel
    // .page-panel-head, styles.css) — one header per window; the messenger
    // header's own back chevron routes through the stack.
    document.getElementById('chat-panel-back')
      ?.addEventListener('click', () => window.Overlay.dismissTop());
```

**4h.** Comment hygiene (stale references to the deleted mechanism — update text only):
- js/chat.js:944-948: replace the sentence beginning `Net effect: openPage's native header bar …
  flagged for the CSS owner.` with: `Net effect: openPage's generic head is hidden by CSS
  (#chat-thread-panel .page-panel-head { display:none }) — .ms-thread-header is the window's
  single header at every width.`
- js/chat.js:1056-1059 (`p.id='chat-thread-panel'` comment): reword to: `// preserve the id:
  styles.css keys the phone thread-header notch inset AND the .messenger-body max-height:none
  override off this exact "#chat-thread-panel" id.`

---

### Batch 5 — index.html (Android keyboard hardening)

Line 5, replace:

```html
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"/>
```

with:

```html
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content"/>
```

Rationale: Chromium ≥108 defaults *installed* PWAs to keyboard-overlays-content; this key
restores layout-viewport resizing on Android so `innerHeight == vv.height` and the var-driven
geometry degrades to a no-op there. iOS ignores the key entirely (harmless). No other index.html
change. (Remember: the pre-commit hook rewrites version strings in this file — commit this batch
alone.)

---

## 3. Verification

No test suite exists; no real iPhone is available to implementing agents (the owner verifies on
device). Serve with `npx serve -p 3838 .` and use the in-app browser at **375×812** (mobile
preset) and **1280×800** (desktop preset). Never verify via `file://`.

### Per-batch local checks

**Batch 1:** in the console —
`getComputedStyle(document.documentElement).getPropertyValue('--vvh')` returns a px value ≈
innerHeight and `--vv-top` returns `0px`. `ScrollLock.acquire()` → body has
`position:fixed`; `ScrollLock.release()` → all five inline styles empty and scroll position
restored (scroll a long page first). Zero console errors on boot.

**Batch 2 (needs 1):** at 375×812, log in, open any task detail (or chat thread):
`getComputedStyle(panel)` shows `position:fixed`, `top:0px`, `height` == innerHeight px,
`bottom:auto`. Chat thread shows exactly **one** header (`.page-panel-head` computed
`display:none`, one `.ms-thread-header`). Simulate a keyboard locally by hand-setting the vars:
`document.documentElement.style.setProperty('--vvh','400px');
document.documentElement.style.setProperty('--vv-top','120px')` — the panel must snap to that
exact rect and everything visible outside it must be flat background **after Batch 3** (before
Batch 3, base content may show — expected, class not yet toggled). Reset the vars after. At
1280×800: panel `top` == `calc(topbar+inset)` as before, `height:auto`, chat two-pane inbox +
thread `left` offset unchanged (compare against `git show HEAD~1:css/styles.css` visually, never
by mutating the tree).

**Batch 3 (needs 1+2):** at 375×812: open a page → `document.body.classList.contains('page-open')`
true; after ~350ms `#bottom-nav`/`#top-nav-strip`/`.main-content` computed `visibility:hidden`;
`#main-content` has `inert`. Scroll the dashboard down first, open + close a page → scroll
position restored exactly and body has no leftover inline styles. Stack two pages (task → worker
profile), close both → same. Navigate via bottom-nav-equivalent while a page is open
(`navigateTo` → `Overlay.clearAll()` path) → class gone, body styles gone, no negative-refcount
weirdness on the next open. Quote Builder page at 375 width → body fixed while qb-fullscreen,
restored on exit (also via device-Back / `Overlay.dismissTop()`). At 1280×800: `page-open` never
appears, body never gets inline styles. With `?dev` in the URL: no `[stacking] off-scale z-index`
console errors.

**Batch 4 (needs 1-3):** open/close a chat thread 3×: no `chat-fullscreen` class ever appears on
body (`document.body.className`), `--kb-offset` never appears on `<html>`
(`document.documentElement.style.cssText`), thread opens full-bleed with single header, inbox
fully hidden behind it, closing restores the inbox instantly. Switch conversations from a
push-notification-style call (`Chat.openConversation` while a thread is open) — replace path —
then close once: back at the inbox with scroll restored (proves 3b's replace-release is
symmetric). Desktop 1280: thread panel unchanged, composer works, `panel.style.bottom` only ever
written at >768px.

**Batch 5:** view-source shows the new meta; app boots; Lighthouse/console clean. Nothing else
observable locally.

### Owner-verify-on-device (must be flagged in the handoff message)

On the installed home-screen app (after deploy, force-quit and reopen twice so the new
`CACHE_VER` service worker takes over):
1. Chat thread: open keyboard → header stays below the status bar, composer sits directly on the
   keyboard, **nothing** of the inbox visible anywhere; type, send, scroll while keyboard open.
2. Slow-drag keyboard dismissal (interactive dismiss) — panel tracks continuously.
3. In-thread search (the third layer in the screenshot) with keyboard up.
4. Task detail comment composer with keyboard; any HR/People form page with keyboard.
5. Rotate to landscape and back with a page open; app-switcher away and back.
6. Quote Builder fullscreen enter/exit; a printable doc (openPrintableDoc) opened from a page —
   print/share sheet still works while the scroll lock is active.
7. Back-gesture/edge-swipe closes windows one at a time; scroll position of the list behind is
   exactly where it was.

---

## 4. Rollback (ordered)

Each batch is its own commit. Roll back with `git revert <sha>` newest-first — **never** reset or
checkout. Dependency notes:
- Batch 5 and Batch 1 revert standalone.
- Batches 2 and 4 must be reverted **together** (reverting 2 alone restores
  `body.chat-fullscreen` CSS that 4 no longer toggles → chat would lose chrome-hiding; reverting
  4 alone re-adds a class with no CSS → harmless but pointless).
- Batch 3 reverts standalone (all its calls are `window.X &&`-guarded).
- Full rollback order: 5 → 4 → 3 → 2 → 1.
If a stuck scroll-lock is ever reported in the field before a fix lands, the console one-liner
`ScrollLock._n=1; ScrollLock.release()` clears it — for diagnosis only, not a substitute for
reverting.

---

## 5. Blast radius — surfaces to manually re-check after Batch 3 (all use openPage; ~132 sites)

Spot-open at 375×812 at minimum one page from each: tasks detail + comments
(js/screens/tasks.js), worker profile (js/screens/people.js, js/screens/dashboards.js), HR forms
(js/screens/hr.js), finance doc/payslip pages (js/screens/finance.js, js/print-docs.js —
openPrintableDoc from inside a page), design (js/screens/design.js), gov biddings
(js/screens/govit.js), approvals (js/screens/approvals.js), CRM (js/screens/crm.js), production
(js/screens/production.js), sales (js/screens/sales.js), generic CRUD pages
(js/ui-crud-table.js), notifications inbox page (js/notifications.js), and chat's secondary pages
(New Message, Shared Media, Forward to…, Attach a record, Add members — js/chat.js). For each:
opens full-bleed, single header clears the notch inset, closes cleanly, base scroll restored.

## 6. Open items for the owner (decide before/at review, not blockers to start)

1. Confirm the 641-768px consequence in 1.4 (chat + every page goes chrome-hidden full-window on
   landscape-phone/small-tablet widths).
2. Confirm modals stay out of scope this pass (1.5).
3. Whether the quote builder should later fold fully into the window model (currently keeps its
   own class + ScrollLock only).
