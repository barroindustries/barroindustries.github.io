# MOBILE-WINDOW-RECON

Ground-truth map of the current mobile overlay/window model, for the team implementing
`MOBILE-WINDOW-MODEL-SPEC.md`. Read this alongside the spec — this file is *what exists*,
the spec is *what to build*.

**Provenance.** Produced by a 6-lens read-only sweep (overlays, call-sites, overlay-api,
scroll, breakpoints, refute-diagnosis). Findings labelled CONFIRMED survived three
independent adversarial refuters; findings that were killed are listed in §7 so nobody
re-derives them. Every claim carries a `file:line`. Line numbers were re-verified against
the working tree on 2026-08-05 at the time of writing; this repo is edited LIVE by
concurrent sessions, so re-`grep` before you edit.

**Hard constraint that shaped this sweep:** nothing here was executed on a device. There is
no build step and no test suite. Every claim about iOS runtime behaviour (visual-viewport
panning, `env()` values with the keyboard up, `dvh` semantics) is inferred from the
CSS/JS contract, and is flagged as such where it matters. §8 lists what must be measured.

---

## 1. Root cause

### 1.1 The one-sentence version

A pushed page is a `position: fixed` box anchored to the **layout** viewport, and the app
has exactly **one** surface anywhere that reads `window.visualViewport` — so on iOS, where
the soft keyboard shrinks the *visual* viewport but not the *layout* viewport, every
pushed page keeps its pre-keyboard geometry and its primary action row ends up behind the
keyboard.

### 1.2 The mechanism, step by step

**Step 1 — the page primitive is layout-viewport-anchored.**

`window.openPage()` (js/app.js:3104) is the documented form primitive — its own header
comment reads "Forms swap openModal→openPage" (js/app.js:3093). It builds a
`.page-panel` (js/app.js:3126-3138) and appends it to `document.body` (js/app.js:3153).

```
.page-panel{ position:fixed; top:calc(var(--topbar-h) + env(safe-area-inset-top,0px));
  left:0; right:0; bottom:0; background:var(--bg); z-index:var(--z-page-panel);
  display:flex; flex-direction:column;
  transform:translateX(100%); transition:transform .3s ...; overflow:hidden; }
```
— css/styles.css:2191-2193, phone override `top: env(safe-area-inset-top, 0px)` at
css/styles.css:2529 (inside `@media (max-width: 768px)` opened at css/styles.css:2454).

`bottom: 0` resolves against the layout viewport. iOS does not shrink the layout viewport
for the keyboard.

**Step 2 — the primary action row is the bottom of that fixed box.**

The panel is a flex column: `.page-panel-body{ flex:1; overflow-y:auto }`
(css/styles.css:2203) then `.page-panel-foot{ flex-shrink:0; ... }`
(css/styles.css:2205-2207). The foot holds the Save/Cancel row —
e.g. `<button class="btn-primary" id="mc-save">Save</button>` at js/departments.js:1103.
The foot is *outside* the scrolling body, so iOS cannot scroll it into view; it is
`flex-shrink:0`, so it cannot be compressed. It sits exactly at the panel's `bottom:0`,
i.e. behind the keyboard, for as long as any field is focused.

**Step 3 — nothing compensates. There is exactly one visualViewport listener in the app.**

`grep -rn "visualViewport" js/` returns hits only in js/chat.js:
- js/chat.js:1492 — `window.visualViewport.addEventListener('resize', _onViewportResize, {passive:true})`
- js/chat.js:248 — the matching `removeEventListener`
- js/chat.js:1521-1540 — the handler

No global `focusin` handler, no `scrollIntoView` outside chat search/jump
(js/chat.js:3307, 3358, 4386), and the viewport meta carries **no** `interactive-widget`
hint: `width=device-width, initial-scale=1.0, viewport-fit=cover` (index.html:5). The app
runs `apple-mobile-web-app-capable` standalone (index.html:33-34), so iOS's default
`resizes-visual` behaviour applies.

**Step 4 — this bug already shipped once, and was fixed for chat only.**

css/styles.css:3819-3826 is a postmortem in the stylesheet:

> "Wave1 P0 fix #1 — soft-keyboard offset. A plain `bottom:0!important` here permanently
> pinned the panel to the viewport's ORIGINAL bottom edge, hiding the composer behind the
> on-screen keyboard on **every phone**"

The fix: `_onViewportResize` computes
`offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)` (js/chat.js:1524),
writes it to `--kb-offset` on `documentElement` (js/chat.js:1532) **and** to
`panel.style.bottom` inline (js/chat.js:1533). CSS consumes it at
`bottom: var(--kb-offset, 0) !important` (css/styles.css:3827).

That rule is scoped to **one element in one media query**:
`body.chat-fullscreen #chat-thread-panel` (css/styles.css:3817) inside
`@media (max-width: 640px)` (css/styles.css:3803). The generic `.page-panel`
(css/styles.css:2192, plain `bottom:0`) and all its call sites never got it. So the failure
is a *known-reproduced regression class*, not a theory — it was fixed for the single
surface where someone reported it.

**Step 5 — `openModal` has the identical shape and is also unfixed.**

At ≤639px `.modal-box` becomes a full-cover fixed page:
`position:fixed !important; top/left/right/bottom:0 !important;
height/min-height/max-height:100dvh !important` (css/styles.css:5033-5044), with
`.modal-footer` as a `flex-shrink:0` sibling of an `overflow-y:auto` body
(css/styles.css:2245-2250; phone safe-area padding at css/styles.css:5051-5055).
`dvh` tracks dynamic *browser UI*, not the keyboard, so this is the same defect by a
second route. Note the box is over-constrained (top + bottom + height all set), so
`bottom` is dropped per CSS 2.1 §10.6.4 — which matters because the repo's proven remedy
*is* a `bottom` override.

At 640-768px the modal fails by a third mechanism: `.modal-box` is not fixed there, it is
bottom-pinned inside the fixed overlay via `align-items/align-self: flex-end`
(css/styles.css:4976, 4985) on `.modal-overlay { position:fixed; inset:0 }`
(css/styles.css:2166-2167).

**Step 6 — `promptDialog` force-focuses a field in a centred fixed box.**

`window.promptDialog` (js/config.js:1281-1311) injects `<input id="dlg-input">` (or a
`<textarea>` when `opts.multiline`, js/config.js:1286-1287) and calls
`setTimeout(() => input.focus(), 40)` (js/config.js:1301) — it *guarantees* the keyboard
opens. `.dialog-overlay` is `position:fixed; inset:0; align-items:center;
justify-content:center` (css/styles.css:2217-2218) and `.dialog-box` is a
`max-width:400px` card (css/styles.css:2226-2227) with **no** `max-height` and **no**
scrollable ancestor. The phone media query deliberately keeps it centred — the comment at
css/styles.css:5057-5058 says "the box itself stays centered (unlike openModal)". So
dialogs are the one surface left vertically centred against the layout viewport.

### 1.3 Additional root causes the sweep found beyond the original diagnosis

These are separate defects with the same blast radius. Each was independently confirmed.

**(A) The panel tracks the visual viewport's SIZE but never its POSITION.**
The single visualViewport listener subscribes to `'resize'` only (js/chat.js:1492; the
teardown at js/chat.js:248 removes only `'resize'`). iOS reports a *pan* of the visual
viewport via `'scroll'`, not `'resize'`, so `vv.offsetTop` is sampled once
(js/chat.js:1524) and never re-read. Two symptoms, one number P (the pan):
- `top` is hard-pinned by `top: 0 !important` (css/styles.css:3818) and **nothing in JS
  ever writes `top`** — so the header renders at screen y = −P, i.e. rises under the
  status bar by exactly P.
- If the pan post-dates the resize sample, the stored `--kb-offset` is too large by P, so
  the panel's bottom edge sits P above the keyboard, opening a visible band through which
  `#page-content` shows.

Remediation constraint: an inline `panel.style.top = vv.offsetTop` will **not** work — it
is defeated by the same `top: 0 !important` at css/styles.css:3818 (this is exactly the
footgun that forced `bottom` through a custom property in the first place). The fix must
either mirror the `--kb-offset` pattern with a second custom property consumed by an
`!important` `top`, or use a combined `transform: translateX(0) translateY(Npx)` (must
re-assert `translateX(0)` or it clobbers `.page-panel.open`, css/styles.css:2194) — and
must bind `'scroll'` alongside `'resize'`.

**(B) Nothing hides `#page-content` behind a panel; the inbox is fully painted underneath.**
`openPage` hides only the *previous page-panel*
(`prevTop.classList.add('page-under'); prevTop.style.visibility='hidden'`,
js/app.js:3147-3149; `.page-under{visibility:hidden}` at css/styles.css:2214).
`body.chat-fullscreen` hides only `#topbar`, `#top-nav-strip`, `#bottom-nav`
(css/styles.css:3804-3808). The stylesheet author knew: css/styles.css:3813 literally says
`#page-content — can peek through`. The only thing keeping the inbox off screen is that
the fixed panel happens to cover it, so any geometry error at all re-exposes it. A rule
keyed off the page stack (`visibility:hidden` on `#page-content` while a page is open)
would make the bleed structurally impossible; there is no such rule.

**(C) Nothing locks document scroll while a page is open.**
No `body.style.overflow`, no `documentElement.style.overflow`, no scrollLock helper, no
`position:fixed` body lock, no scroll save/restore anywhere in js/ (verified:
`grep -rn "document.body.style\|window.scrollTo\|pageYOffset\|window.scrollY\|scrollRestoration" js/`
returns **zero** hits outside js/vendor/). The only body lock in the app is
`body.sidebar-open { overflow: hidden; }` (css/styles.css:1214), applied at js/app.js:1470
and removed at js/app.js:1452, for the nav drawer only. `.page-panel-body` also has no
`overscroll-behavior` (css/styles.css:2203-2204), so its overscroll chains to the
document. This is the raw material iOS pans to reveal a focused field — i.e. it is a
contributing cause of (A), not just an independent nit.

**(D) `.page-panel.open` keeps a non-`none` transform in the steady state.**
`transform:translateX(100%)` → `.open{transform:translateX(0)}` (css/styles.css:2193-2194);
nothing resets it to `none` on screen (the only `transform:none` is print-only at
js/print-docs.js:99). Every panel is therefore a containing block for its own
`position:fixed` descendants. One live dependency already exists:
js/print-docs.js:361 renders `<div class="wm">` inside a panel body, styled
`.pd-host .wm{position:fixed}` at js/print-docs.js:106 — and the same injected block
neutralizes the panel with `transform:none!important` at js/print-docs.js:99 precisely so
the watermark anchors to the printed page. Preserve this deliberately or the print
watermark breaks.

**(E) Sign-out never clears the overlay stack — panels stay painted over the login screen.**
The null-user branch is `stopClaimsListener(); Session.runCleanups(); showLogin();`
(js/app.js:153-158). `Session.runCleanups()` (js/app.js:36-42) only drains registered fns
and nothing registers an Overlay cleanup. `showLogin()` (js/app.js:519-523) only unhides
`#login-screen` and hides `#app-shell`. But `#app-shell` spans index.html:192-300, and
every overlay surface is a **sibling** of it: `#modal-overlay` (index.html:305),
`#profile-drawer` (319), `#drawer-overlay` (330), `#dialog-overlay` (335), and
openPage panels (`document.body.appendChild(p)`, js/app.js:3153). `#login-screen` is
`z-index:1` (css/styles.css:144) vs the panel's inline 300+ (js/config.js:1214). Four
sign-out paths all lack `Overlay.clearAll()`:
- president force-logout — js/app.js:228
- inactivity auto-logout — js/app.js:425
- sidebar Sign Out button — js/app.js:1044
- profile-drawer Sign Out (`onclick="auth.signOut()"`, js/app.js:2862) — the worst one,
  because the drawer is *itself* an open Overlay entry (pushed at js/app.js:2874), making
  stale-overlay-over-login deterministic on the primary mobile sign-out route.

`Overlay._stack`, `window._pageStack`, and `body.chat-fullscreen` / `qb-fullscreen` /
`sidebar-open` all survive the session boundary. Any centralized lock or visualViewport
listener keyed to "a page is open" will leak straight onto the login screen.

### 1.4 Corrections to the original diagnosis

| Original claim | Verified correction |
|---|---|
| "Raising `bottom` alone opens a visible bleed band" | **Refuted.** With `offset = innerHeight − vv.height − vv.offsetTop` (js/chat.js:1524) and `bottom: var(--kb-offset)` (css/styles.css:3827), the panel's bottom edge lands exactly on the visual viewport's bottom edge — the band below it is behind the keyboard and invisible. Step (2) is the fix working as designed. The bleed appears only when the stored offset exceeds the true gap, i.e. when it goes stale (cause A). |
| "The header goes under the status bar because iOS pans and the fixed panel rides along — unavoidable" | **Corrected.** Not separate and not unavoidable: it is the top edge of the same geometry the code already manages at the bottom edge. `top: 0 !important` (css/styles.css:3818) nails it, `_onViewportResize` writes only `bottom` (js/chat.js:1532-1533), and the header's own notch clearance (`min-height: calc(56px + env(safe-area-inset-top))`, css/styles.css:3841-3842) only helps while the panel is un-panned. |
| "The floating search bar is a third positioning bug" | **Corrected.** `.ms-thread-search-bar` has no `position` and no `z-index` — it is `display:flex; padding:6px 10px; border-bottom; background:var(--surface)` (css/styles.css:4752-4757), the second static child of the panel body (js/chat.js:1000-1006). It cannot float. What's on screen is either the panel's second row with the panel's top panned off, or the *inbox's* own `#chat-search-input` (js/chat.js:4421) showing through the bleed band. |
| "The `.page-panel` transform changes how the panel's own `fixed` resolves" | **Refuted.** An element's own transform never establishes its own containing block; `#chat-thread-panel` **is** the `.page-panel`, so its `fixed` still resolves against the ICB. Neither `html` (css/styles.css:69-75) nor `body` (css/styles.css:119-133) declares transform/filter/perspective/contain. The transform matters only for *descendants* (see cause D). |
| "The offset formula is wrong for standalone PWA" | **Refuted.** `innerHeight − vv.height − vv.offsetTop` is algebraically exact for a fixed element whose containing block is the layout viewport, and `viewport-fit=cover` (index.html:5) supplies the assumption it needs. The failure is temporal (never re-evaluated on pan), not arithmetic. Rewriting the formula fixes nothing. |
| "`#chat-thread-panel .messenger-body{max-height:none}` or the inline `cssText` at chat.js:1070 contributes to the bleed" | **Refuted.** css/styles.css:3932-3933 only *removes* the 380px cap; js/chat.js:1070 sets the panel body to `overflow:hidden`, which if anything prevents escape (and `.page-panel` is also `overflow:hidden`, css/styles.css:2193). |

---

## 2. Surface inventory

Every `position: fixed` surface in the app, its geometry, stacking, safe-area handling and
keyboard behaviour. "KB-aware" = does anything adjust it for the soft keyboard.

### 2.1 Page / modal / dialog surfaces (the ones a rebuild must own)

| Surface | Geometry | z | Breakpoints | Safe-area | KB-aware | Notes |
|---|---|---|---|---|---|---|
| `.page-panel` (openPage) | `fixed; top:calc(--topbar-h + inset-top); left/right/bottom:0; overflow:hidden; transform:translateX(...)` — css/styles.css:2191-2194 | inline `300+2n` from js/config.js:1214 (beats `--z-page-panel:210`, css/tokens.css:153) | `top: env(inset-top)` at ≤768px — css/styles.css:2529 | head/body/foot each pad `max(16px, env(inset-left/right))` and `env(inset-bottom)` — css/styles.css:2198, 2204, 2206; mobile 12px at css/styles.css:6222-6224 | **NO** | The core defect surface. Appended to `document.body` (js/app.js:3153). |
| `.page-panel-foot` | `flex-shrink:0`, last flex child, `padding-bottom: calc(12px + env(inset-bottom))` — css/styles.css:2205-2207 | — | — | bottom inset only | **NO** | The Save button. Behind the keyboard. |
| `#chat-thread-panel` | IS a `.page-panel` (js/chat.js:1052, id stamped js/chat.js:1056). Phone: `top:0 !important; bottom:var(--kb-offset,0) !important; left/right:0 !important` — css/styles.css:3817-3829 | inline `300+2n` — the stylesheet `z-index: var(--z-dialog)` at css/styles.css:3832 is **dead** (no `!important`) | phone rules gated `@media (max-width:640px)` css/styles.css:3803; two-pane left inset only at ≥1024px css/styles.css:3766, 3781 | header carries `min-height: calc(56px + env(inset-top))`, `padding-top: calc(8px + env(inset-top))` — css/styles.css:3840-3843. **No left/right inset anywhere** | **YES (bottom only)** | The only KB-aware surface in the app. Tracks size, not position. |
| `.modal-overlay` | `fixed; inset:0; flex center` + 4-side safe-area padding — css/styles.css:2166-2173 | `--z-modal:200` (css/tokens.css:152), overridden inline to `300+2n` when pushed with `el` (js/app.js:3077) | ≤768px → `align-items:flex-end; padding:0` css/styles.css:4976; ≤639px → opaque `var(--bg)` css/styles.css:5028-5031 | 4-side, dropped on mobile | **NO** | |
| `.modal-box` | ≤639px: `fixed; top/left/right/bottom:0; height/min/max-height:100dvh !important` — css/styles.css:5033-5044. 640-768px: flex child, `align-self:flex-end !important` css/styles.css:4985, `max-height:92dvh !important` css/styles.css:4979-4987. Base: `max-height:92dvh` css/styles.css:3563-3568 | — | 639 / 768 | header/footer pad `max(20px, env(inset-left/right))`, footer `max(14px, env(inset-bottom))` — css/styles.css:5046-5055; body `calc(20px + env(inset-bottom))` css/styles.css:5056 | **NO** | Over-constrained (top+height+bottom) → `bottom` dropped. |
| `.modal-footer` | `flex-shrink:0` sibling of `overflow-y:auto` `.modal-body` — css/styles.css:2245-2250 | — | — | — | **NO** | Cannot be scrolled into view. |
| `.dialog-overlay` | `fixed; inset:0; align-items:center; justify-content:center` + 4-side `max(20px, env(...))` padding — css/styles.css:2217-2221 | `--z-dialog:5000` (css/tokens.css:154) — **kept**, because dialogs push with no `el` (js/config.js:1275, 1305) | ≤639px: scrim goes opaque only; box **stays centred** — css/styles.css:5057-5063 | 4-side | **NO** | Force-focuses its input (js/config.js:1301). No `max-height`, no scrollable ancestor. |
| `.drawer` (profile) | `fixed; top/right/bottom:0; width:min(400px,100vw)` — css/styles.css:2261-2270 | `--z-drawer:195`; ≤768px `--z-drawer-2:198` (css/styles.css:2298-2306) | ≥640 padding-right inset css/styles.css:2277; ≤639 bottom sheet css/styles.css:2283-2293; ≤768 full-screen css/styles.css:2298-2306 | bottom + right | **NO** | `.drawer-body` is `flex:1; overflow-y:auto` (css/styles.css:2327) so iOS *can* scroll a field into view here. |
| `#drawer-overlay` scrim | `.modal-overlay`, `--z-drawer-scrim:190` — css/styles.css:2273 | 190 | — | — | — | Falls *behind* anything in the 300 tier. |
| `.ms-lightbox` | `fixed; inset:0; rgba(6,6,10,.94)` — css/styles.css:4433-4437; appended to `document.body` js/chat.js:3827 | inline `300+2n` (pushed with `el`, js/chat.js:3985) | — | `.ms-lightbox-top` pads inset-top css/styles.css:4441-4445 | n/a | Clean. |

### 2.2 Mobile shell chrome (all layout-viewport pinned, none KB-aware)

| Surface | Geometry | z | Breakpoint | Safe-area | Notes |
|---|---|---|---|---|---|
| `.topbar` | `fixed; top:0; height:calc(--topbar-h + inset-top)` — css/styles.css:3467-3477 | `--z-topbar:100` | `display:none` at ≤768px — css/styles.css:2461 | top | Not on phone at all. |
| `.top-nav-strip` | `fixed; top:calc(--topbar-h + inset-top); height:50px` — css/styles.css:810-826; phone `top: env(inset-top)` css/styles.css:2477-2481; desktop `top:0; left:50%` css/styles.css:4955-4964 | `--z-shell-2:94` (css/tokens.css:141); desktop `--z-topbar-2:101` | shown ≤768px css/styles.css:2505 | top; final padding winner css/styles.css:5565-5570 | Occluded by any open page-panel (94 < 302). |
| `body::after` notch cap | `fixed; top:0; height: env(inset-top)`, opaque gradient — css/styles.css:2487-2493 | `--z-topbar:100` | ≤768px | is the inset | Opaque status-bar band. |
| `.bottom-nav` | `fixed; bottom:0; height:calc(var(--bottom-nav-h,56px) + env(inset-bottom))` — css/styles.css:5183-5203 | `--z-bottom-nav:95` (css/tokens.css:142) | base `display:none` css/styles.css:5183-5184; `display:flex !important` ≤768px css/styles.css:2531; again 769-819px css/styles.css:2588 | bottom | Occluded by page-panels. |
| `#sidebar` | `fixed; top:calc(--topbar-h + inset-top); bottom:0` — css/styles.css:1005-1013; phone `top:env(inset-top); translateX(-100%)` css/styles.css:2473 | `--z-shell:90`; `.open` → `--z-shell-open:96` | ≤768px off-canvas | top | Only surface with a body scroll lock (css/styles.css:1214). |
| `body.sidebar-open::after` scrim | `fixed; inset:0; rgba(0,0,0,.48)` — css/styles.css:1220-1227 | raw literal `95` | — | — | Off-token literal; the dev z-lint (js/app.js:3198-3222) only scans body's direct children, so a `::after` is never flagged. |
| `#ptr-indicator` | `fixed; top: calc(env(inset-top) + 56px)` — css/styles.css:1639-1651; ≤768px `+ 56 + 50 + 8` css/styles.css:1688-1692 | `--z-ptr:180` | ≤768px | top | **Budgets 56px for a `#topbar` that is `display:none` at that exact breakpoint** (css/styles.css:2461). Rests ~56px too low. |
| `#qb-frame` (Quote Builder) | `body.qb-fullscreen`: `fixed; top:env(inset-top); left/right/bottom:0; width:100vw; height:calc(100dvh - env(inset-top)); z-index:var(--z-dialog,5000)` — css/styles.css:3864-3877 | **live 5000** (pushed with no `el`, js/app.js:1584) | ≤768px css/styles.css:3854 | top only — comment at css/styles.css:3866-3868 notes `env()` resolves to 0 *inside* an iframe, so the builder can't clear the notch itself | Over-constrained + `dvh`. The iframe cannot see the parent's keyboard state. |
| `.qb-exit-pill` | `fixed; bottom: calc(16px + env(inset-bottom)); left: calc(12px + env(inset-left))` — css/styles.css:3883-3900 | `--z-toast:9990` | not media-scoped | bottom+left | Only exit besides device Back — sits in the bottom-left thumb zone, i.e. where the keyboard is. |
| `#bi-toast` | `fixed`, bottom from `matchMedia('(max-width:640px)')` — js/notifications.js:1087-1091 | `--z-toast:9990` | JS 640px vs CSS 768px | bottom | Mobile branch omits bottom-nav clearance → toast paints over the nav at ≤640px. Self-removes after 3.5s (js/notifications.js:1109). |
| `#backup-health-banner` | `fixed; top:0; padding-top:calc(10px + env(inset-top))` — js/app.js:290 | `--z-system-banner:9995` | — | top | Overlays rather than pushes; covers `.top-nav-strip` while shown. |
| `#push-prompt-overlay` | `fixed; inset:0; align-items:flex-end; padding-bottom:calc(env(inset-bottom)+16)` — js/notifications.js:781-786 | `--z-dialog:5000` (no `el`, js/notifications.js:860) | — | bottom | No input. Clean. |
| `#splash-screen` | `fixed; inset:0` — css/styles.css:1615-1621 | `--z-splash:9999` | — | — | Clean. |
| `.notif-panel` / `.notif-backdrop` | `fixed` — css/styles.css:920-937 | `--z-panel:150` / 140 | `display:none` ≤768px css/styles.css:2546 | right/top | Never on phone. |
| `#gesture-back-pill` | `fixed; top:0; left:0`, moved by `translate3d(x, clientY−17, 0)` — js/gestures.js:92-104, 228-232 | `--z-toast:9990` | — | — | `clientY` is visual-viewport-relative on iOS; a fixed element is layout-viewport-relative. Desyncs by `visualViewport.offsetTop`. (Moot today — see 2.4.) |

### 2.3 Composer / popover surfaces inside the chat panel

| Surface | Positioning | Keyboard interaction |
|---|---|---|
| `.messenger-input-row` | `position:relative`, `padding: 8px 10px calc(8px + env(inset-bottom))` — css/styles.css:4226-4235 (padding at 4231) | Keeps full home-indicator padding while lifted over the keyboard → permanent dead gap. Shared with the doc/task comment composer (js/departments.js:783), which is **not** bottom-anchored, so the inset is dead padding mid-page there too. Wrong in both directions. |
| `.ms-mention-dd` | `absolute; left:6px; right:6px; bottom:calc(100% + 4px); max-height:200px; z-index:5` — css/styles.css:4353-4358 | Opens upward inside an `overflow:hidden` panel (css/styles.css:2193) → clipped, not scrolled, when the panel shrinks. |
| `.ms-emoji-grid` | `absolute; left:6px; bottom:calc(100% + 4px); width:264px` — css/styles.css:4369-4375, **no `max-height`** | Same, worse. Clipping threshold unverified (needs a runtime). |
| `.ms-thread-header` | `position:relative; flex-shrink:0; height:56px; padding:0 8px 0 4px` — css/styles.css:4679-4684 | Not fixed. **No left/right safe-area padding** — in landscape on a notched phone the back chevron/avatar/ⓘ sit under the sensor housing. Note `.page-panel-head`, which *does* pad `max(16px, env(inset-left/right))` (css/styles.css:2198), is `display:none`'d for chat at js/chat.js:1076, and `.page-panel-body`'s own left/right insets are wiped by `padding:0` in the inline `cssText` at js/chat.js:1070. |
| `.ms-thread-search-bar` | static, `display:flex; padding:6px 10px` — css/styles.css:4752-4757 | Not a floating layer. Focusing it (js/chat.js:3381) opens the keyboard from an element with **no** `--kb-offset` blur reset — the reset is bound to the composer textarea only (js/chat.js:1473-1476). |
| `.ms-scroll-fab` | `position:absolute` inside the non-scrolling scroll-wrap, z 2 — css/styles.css:4184-4190 | Clean. |
| `.ms-pinned-bar` | `position:relative` — css/styles.css:4787 | Clean. |

### 2.4 Surfaces confirmed clean / inert

- **`position: sticky`** — only two in the whole stylesheet: `thead th` (css/styles.css:1906)
  and `.table-scroll.sticky-head thead th` / `.table-wrap.sticky-head thead th`
  (css/styles.css:1936-1937), both `top:0; z-index:1` scoped inside their own scroll
  container. No keyboard interaction.
- **Gestures** — `js/gestures.js` is entirely inert. Both root `touchstart` listeners are
  commented out per an owner decision (js/gestures.js:352-353); `Gestures.enable/disable`
  remain as no-op stubs (js/gestures.js:355-358). Edge-swipe-back and sheet
  swipe-dismiss cannot fire.
- **No offline banner exists.** `grep` for offline-banner / `navigator.onLine` finds only
  attachment-send guards (js/chat.js:1425, 3081) and a stale mention in the z-lint comment
  at js/app.js:3192.
- **`.bottom-nav.nav-shrunk`** (css/styles.css:1236-1240) is documented as "triggered by JS
  scroll listener" — no JS anywhere sets that class. Dead CSS.
- **`quote-builder-v2.html`** was NOT audited. It is a separate self-contained document
  with its own `420/700/768` media queries (lines 193, 303, 363, 381, 658), sized by the
  iframe, and `env()` resolves to 0 inside it.

### 2.5 The two z-index systems

There are two, and the token scale is partly fictional.

1. **Token scale** — `--z-*` in css/tokens.css:135-157 (`--z-scrim:85`, `--z-shell:90`,
   `--z-shell-2:94`, `--z-bottom-nav:95`, `--z-shell-open:96`, `--z-topbar:100`,
   `--z-topbar-2:101`, `--z-panel:150`, `--z-ptr:180`, `--z-drawer-scrim:190`,
   `--z-drawer:195`, `--z-drawer-2:198`, `--z-modal:200`, `--z-page-panel:210`,
   `--z-dialog:5000`, `--z-toast:9990`, `--z-system-banner:9995`, `--z-splash:9999`).
2. **Dynamic inline tier 300-398** — `Overlay.push`/`replaceTop` set
   `el.style.zIndex = String(300 + this._stack.length * 2)` whenever an element is passed
   (js/config.js:1214, 1228). The dev lint whitelists `z>=300 && z<=398` (js/app.js:3216).

Inline beats any non-`!important` stylesheet declaration. Consequences:
- `--z-modal:200` and `--z-page-panel:210` **never render**.
- `body.chat-fullscreen #chat-thread-panel { z-index: var(--z-dialog) }`
  (css/styles.css:3832) is **dead code** — the panel renders at ~302, not 5000.
  This is currently the *safe* outcome: `#dialog-overlay` (5000, static at index.html:335)
  still renders above the chat thread. **Do not "fix" this line with `!important`** — at an
  equal 5000 the later DOM sibling (the runtime-appended panel) wins, and confirm/prompt
  dialogs opened from a thread (js/chat.js:2906, 2942, 4272, 4325) would be buried.
- Surfaces pushed **without** an element keep their token z and therefore fall *behind*
  anything in the dynamic tier: dialog (js/config.js:1275, 1305), sidebar (js/app.js:1471),
  qb-fullscreen (js/app.js:1584), drawer (js/app.js:2874), push-prompt
  (js/notifications.js:860). They also still consume a stack slot, inflating the z of
  anything pushed above them.

---

## 3. Call-site atlas

### 3.1 Counts, and how confident to be in them

`grep -rn "openPage(" js/` returns **132 lines**. Eight are prose inside comments —
js/ui-crud-table.js:37, 39, 171, 173; js/screens/finance.js:1656, 1657;
js/screens/tasks.js:474, 688 — leaving **124 executable call sites**. (Six further comment
lines spell it `openPage (` with a space and were never in the 132: js/chat.js:929,
js/print-docs.js:6, js/screens/govit.js:43, js/screens/hr.js:3579,
js/screens/dashboards.js:3039, 5378. Do not subtract them twice.)

`grep -rn "openModal(" js/` returns **21 lines**, of which 2 are comments → **19 executable**.

| Category | Count | Confidence |
|---|---|---|
| (a) executable `openPage(` call sites | **124** | High — reproduced by three independent parses. One parser reported 126; the discrepancy is multi-line calls. Treat as "≈124-126". |
| (b) mounts a soft-keyboard control (text-ish `<input>`, `<textarea>`, `contenteditable`) | **91 (73%)** | Medium-high. Reproduced by two parses; a third could only reach 80 statically because many bodies are variables. Reclassifying date/time pickers as non-keyboard flips **zero** sites, so all 91 are true text entry. |
| (c) passes a non-empty `footerHTML` | **108** | Medium (one parse said 107). |
| (a)∩(c) — text field **and** a bottom-pinned Save/Cancel bar | **87** | Medium. This is the regression set. |
| (a) only, no footer | 4 — js/chat.js:1052, 3660, 4525; js/screens/tasks.js:612 | Medium; at least 6 further footerless sites carry inline field markup (js/screens/dashboards.js:2793, js/screens/approvals.js:1269, js/screens/tasks.js:837, js/screens/production.js:579, js/screens/people.js:340, 499), so treat "exactly 4" as unreliable. |
| `openModal(` sites that mount a keyboard control | **10** of 19 — js/app.js:2709, js/departments.js:590, 2574, 4065, js/screens/dashboards.js:5457, js/screens/hr.js:849, 2365, 2483, js/screens/people.js:468, js/screens/sales.js:2351 | High |
| **Total keyboard surfaces across both hosts** | **≈101** | — |

### 3.2 The keyboard-bearing set (the regression risk)

Per-file density of the 91 openPage keyboard pages:

| File | Count | | File | Count |
|---|---|---|---|---|
| js/departments.js | 14 | | js/screens/tasks.js | 5 |
| js/screens/dashboards.js | 13 | | js/chat.js | 3 |
| js/screens/hr.js | 9 | | js/config.js | 3 |
| js/screens/design.js | 8 | | js/modules.js | 3 |
| js/screens/govit.js | 8 | | js/screens/finance.js | 3 |
| js/screens/people.js | 8 | | js/screens/approvals.js | 2 |
| js/screens/production.js | 8 | | js/screens/sales.js | 2 |
| | | | js/screens/crm.js | 1 |
| | | | js/ui-crud-table.js | 1 |

**Ten of the 91 are invisible to a naive grep of the call line** — their body is a variable
or async-filled. These are the ones a manual sweep will miss:

| Call site | Where the field actually is |
|---|---|
| js/chat.js:1052 | `<textarea id="chat-input">` built at js/chat.js:1036 |
| js/chat.js:3660 | `input#chat-ref-search` |
| js/chat.js:4525 | `input#chat-pick-search` |
| js/departments.js:4201 | `input#gb-title` + `textarea#gb-desc` |
| js/screens/dashboards.js:681 | `input.bom-qty`, injected after an async fill |
| js/screens/finance.js:167 | generated input/textarea fields |
| js/screens/hr.js:3762 | `input#pe-name` etc. |
| js/ui-crud-table.js:176 | generic — see 3.4 |
| js/screens/tasks.js:612 | gains a `<textarea>` only **after** mount, via `window.renderComments` (js/departments.js:783) |
| js/screens/tasks.js:1078 | same, via js/screens/tasks.js:1093 → js/departments.js:695 → 783 |

### 3.3 Call sites that override or measure panel internals — the fix must not break these

**Style overrides (3 locations, 5 statements):**

| Site | What it does |
|---|---|
| js/chat.js:1069-1070 | `bodyEl.style.cssText = 'flex:1;min-height:0;overflow:hidden;padding:0;display:flex;flex-direction:column;'` — kills `.page-panel-body`'s own `overflow-y:auto` **and all its safe-area padding** |
| js/chat.js:1075-1076 | `genericHead.style.display='none'`; back button re-routed through `Overlay.dismissTop()` at js/chat.js:1077-1078 |
| js/screens/tasks.js:621-624 | `bodyEl.style.cssText='flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0'` — keeps the scroll, zeroes padding |
| js/print-docs.js:99-101 | `@media print` block (injected with the body at js/print-docs.js:357; `.pd-host` class added at js/print-docs.js:378): `.pd-host.page-panel{position:static!important;inset:auto!important;height:auto!important;overflow:visible!important;transform:none!important}`, `.pd-host .page-panel-body{overflow:visible!important;height:auto!important}`, `.pd-host .page-panel-head,.pd-host .page-panel-foot{display:none!important}` |

js/print-docs.js:99 is **the only place in the app that releases `.page-panel`'s
transform**. Any geometry rewrite must keep this print escape hatch matching the new
property set, or printing breaks.

**Geometry readers (2 helpers, 9 call sites):**

- `window.fitA4Sheet` — js/screens/hr.js:4079-4081 does
  `stage.closest('.page-panel-body')` then reads `bodyEl.clientWidth`, scale
  `= (w - 16) / 794`; live re-fit on `resize`/`orientationchange` at
  js/screens/hr.js:4087-4088. Callers: js/screens/hr.js:3672 (payslip panel),
  js/screens/hr.js:1810 (`{live:false}`, Print-All, non-panel).
- js/print-docs.js:326-332 — same pattern for every printable document. Eight callers:
  js/app.js:2561, js/departments.js:2393, js/screens/crm.js:498, js/screens/sales.js:1684,
  js/screens/production.js:348, 1832, 2934, 2977.

**Both subtract a flat 16 from a padding-inclusive `clientWidth`.** True content width is
`clientWidth − 24` on mobile (12px/side, css/styles.css:6222-6224) and `clientWidth − 32`
on desktop (16px/side, css/styles.css:2203-2204). So the sheet is **already** over-scaled
by ~8px on phone and ~16px on desktop today. Changing the body padding shifts the fit by
the padding delta *on top of* an existing over-width.

**Structural dependents (5)** — `panel.querySelector('.page-panel-body').innerHTML = …`
after an async fetch. These break if the body element is renamed or nested rather than
restyled: js/modules.js:203, js/departments.js:3367, js/app.js:3887,
js/screens/dashboards.js:688, js/screens/dashboards.js:2935.

**Padding-coupled sticky (1)** — js/screens/dashboards.js:3053 uses
`position:sticky; top:-16px; margin:-16px -16px 0; padding:16px 16px 0` for the
worker-profile tab bar, a hand-computed negation of `.page-panel-body`'s 16px desktop
padding. Mobile already overrides that to 12px (css/styles.css:6222-6224), so it is
**already ≥4px off on phone** (more in landscape, since the padding is
`max(12px, env(safe-area-inset-*))`).

**CSS-side coupling the js/-only grep misses:** js/chat.js:1056 renames the panel to
`#chat-thread-panel`, and css/styles.css:3781-3784 (≥1024px) plus css/styles.css:3817-3833
(≤640px) then override that host's `left/top/bottom/right/z-index` with `!important`.
css/styles.css:2529 overrides `.page-panel`'s `top` on mobile. Reconcile these alongside
the print hatch.

### 3.4 One call site that is really four

js/ui-crud-table.js:176 is `openPage(cfg.addModal.title, body, cfg.addModal.footerHtml)`,
where `body` is `cfg.addModal.bodyHtml` (string or function, js/ui-crud-table.js:175) and
`beforeOpen` may async-fetch markup first (js/ui-crud-table.js:170-174). It is reached from
four `window.renderFinanceCrudTable` configs: js/screens/finance.js:377 (Add Tax Record),
1654, 1763 (New Cash Disbursement Entry — 8+ number/text inputs, js/screens/finance.js:1766-1780),
1870. Static analysis of the call line shows **no inputs at all**, so any tooling sweep
undercounts it 4:1. It is also the only place the body markup comes from a config object
rather than the call site — the natural place to regression-test "forms I don't control".

### 3.5 Page depth and `opts.replace`

`opts.replace` appears at exactly 4 openPage sites:
- js/chat.js:1053 — conditional, `replace: alreadyOpen` computed from `window._pageStack`
  at js/chat.js:1049-1051 (`stack[stack.length-1].id === 'chat-thread-panel'`)
- js/screens/hr.js:235 — `{replace:true}`
- js/screens/hr.js:2607 — `{replace:true}`
- js/screens/hr.js:3665 — `replace: hostOpts.replace === true`; forwarded from
  js/screens/hr.js:3884

**Maximum verified stack depth is 3, not 4.** Verified 3-deep chains:
- Personal Finance base → Worker profile (js/screens/dashboards.js:2322 → :3065) →
  Payslip (js/screens/dashboards.js:3076 → js/screens/hr.js:3663) → Edit details
  (js/screens/hr.js:3670 → :3762)
- Design project detail (js/screens/design.js:252) → Drawing detail (:704 → :834) →
  New Revision (:954) / Edit Drawing (:993) — the file documents this exact shape at
  js/screens/design.js:868-873
- Chat thread or Design project detail → Task detail (js/screens/tasks.js:612) →
  Edit Task (js/screens/tasks.js:692-694 → :837)

Correction to an earlier claim: the Grade page (js/screens/dashboards.js:2284) is **not** a
parent of the Worker profile. `.view-profile-btn` (js/screens/dashboards.js:2229) and
`.grade-emp-btn` (:2230) are sibling buttons in the same table row on the same base screen,
bound independently at :2281 and :2319. `openWorkerProfilePanel` has exactly one call site
repo-wide (:2322). Both are depth 1.

Roughly **19-20** call sites are reachable at depth ≥2.

**Why depth matters for geometry:** a buried panel stays mounted with `visibility:hidden`
(js/app.js:3148-3149, css/styles.css:2214), and a `visibility:hidden` element still has
layout. Any `100dvh`/visualViewport-driven sizing applied broadly to `.page-panel` will
keep recalculating for up to 2 buried panels. (Today `--kb-offset` is *not* a global
hazard — its only consumer is `body.chat-fullscreen #chat-thread-panel`,
css/styles.css:3827 — but it becomes one the moment a rebuild widens that selector.)

### 3.6 Nested inner scrollers (11 sites)

Pages that own a scroll container *inside* `.page-panel-body`'s scroll:

| Site | Scroller |
|---|---|
| js/screens/dashboards.js:681 | `.table-wrap max-height:46vh; overflow:auto` — :702 |
| js/screens/dashboards.js:1535 | Receivables, `max-height:52vh; overflow:auto` — :1537 |
| js/screens/dashboards.js:3842 | `#memo-recip-list max-height:190px` — :3853 |
| js/screens/design.js:834 | `max-height:150px` — :854 |
| js/screens/production.js:579 | `max-height:160px` — :630 |
| js/departments.js:3365 | client-hub timeline, `max-height:420px` — :3417 |
| js/chat.js:4525 | `#chat-group-members max-height:220px` — :4511 |
| js/chat.js:4199 | `.chat-about-members max-height:220px` — declared in CSS at css/styles.css:4645 |
| js/screens/tasks.js:612 | see below |
| js/screens/tasks.js:1078 | see below |
| js/screens/dashboards.js:3053 | `position:sticky` against the body scroller (not a scroller itself) |

js/chat.js:1052 is the deliberate **inverse** — js/chat.js:1070 sets `.page-panel-body` to
`overflow:hidden`, making `#chat-thread-scroll` the single scroll region.

**The task-detail case is a dead-CSS bug the v14 rebuild missed.** `renderComments` emits
`<div class="messenger-body">` (js/departments.js:744), which is
`flex:1; overflow-y:auto; max-height:380px; min-height:120px` (css/styles.css:3919-3922).
The only rule that lifts the cap is
`#task-fullscreen-panel .messenger-body, #chat-thread-panel .messenger-body { max-height: none; }`
(css/styles.css:3932-3933) — and **`#task-fullscreen-panel` no longer exists**. `openPage`
assigns `id = 'page-panel-' + seq` (js/app.js:3127) and only chat re-stamps its own id
(js/chat.js:1056); the only remaining reference in js/ is a historical comment at
js/chat.js:893. The three companion rules at css/styles.css:4857-4866
(`#task-fullscreen-panel .messenger-wrap` / `#task-comments-wrap`) are dead too.

Worse, the task panel is a **three-layer** scroll stack: js/screens/tasks.js:624 sets
`.page-panel-body` to `flex:1;overflow-y:auto`, while its own `bodyHTML` still opens with
`#task-info-scroll` — `overflow-y:auto; max-height:42%` (js/screens/tasks.js:527) — above
the 380px comment list. The authoring comment at js/screens/tasks.js:597-602, 617-624 says
the panel was converted to a "Single natural scroll region (info + comments + composer
flow together), instead of the old forced split." Only the JS override was updated; the
42% info scroller and the 380px cap both survived. Fix both alongside any geometry change.

---

## 4. Overlay / `_pageStack` contract

### 4.1 The two stacks

- **`window.Overlay._stack`** (js/config.js:1209) — entries are
  `{ id: <int seq>, kind: <string>, teardown: <fn>, el: <Element|null> }` (js/config.js:1213).
  Live kinds: `page`, `modal`, `dialog`, `drawer`, `sidebar`, `lightbox`, `push-prompt`,
  `qb-fullscreen`. (A comment at js/screens/dashboards.js:3047 references a
  `'worker-profile'` push — **stale**, no such push exists. Do not treat it as a live kind.)
- **`window._pageStack`** (js/app.js:3091) — holds only page-panel *elements*.

**There is no enforced invariant tying them together.** This is the source of several
edge cases below.

### 4.2 The only four `_stack` mutators — and the correct hook shape

`_stack` is written in exactly four places:

| Function | Lines | What it does |
|---|---|---|
| `push` | js/config.js:1211-1219 | the only `.push`; sets inline z; `history.pushState` |
| `replaceTop` | js/config.js:1224-1231 | in-place field swap on the top entry; **no** history change |
| `_popOne` | js/config.js:1235-1239 | `.pop()` then `top.teardown()` inside try/catch |
| `clearAll` | js/config.js:1240-1252 | tight `while` pop loop, each teardown in try/catch |

Nothing outside `window.Overlay` writes `_stack` (external references are read-only:
js/app.js:1478-1479, js/app.js:2961-2962).

**Recommended hook: one private `_sync()` called as the LAST statement of all four.**

```
push       → js/config.js:1218 (after pushState)
replaceTop → js/config.js:1229
_popOne    → js/config.js:1238 (after the teardown call)
clearAll   → js/config.js:1251 (after the while-loop)
```

`_sync()` recomputes desired state as a **pure function of `_stack`** and diffs against a
module-local `_applied` flag:

```js
const want = _stack.some(e => LOCKING_KINDS.has(e.kind));
if (want !== _applied) { _applied = want; want ? apply() : release(); }
```

This is leak-proof by construction: it survives double push, `replaceTop`'s discarded
teardown, `clearAll` mid-teardown, and a teardown that throws (all four sites already wrap
teardown in try/catch, so `_sync` still runs). **Do not use a paired acquire-in-openPage /
release-in-teardown refcount** — see 4.3.

**Predicate scope.** At minimum `page` and `modal`: at ≤639px a modal *is* a phone page
(`position:fixed; inset:0; height:100dvh` over an opaque scrim, css/styles.css:5028-5044),
not a sheet. Also consider `dialog` (`.dialog-overlay` is `position:fixed; inset:0`,
css/styles.css:2217, and goes fully opaque at ≤639px, css/styles.css:5057-5063) and
`lightbox` (css/styles.css:4433-4437). **Exclude `sidebar`** — it already carries its own
lock via `body.sidebar-open{overflow:hidden}` (css/styles.css:1214, set js/app.js:1470,
removed js/app.js:1452); a second mechanism will fight it.

### 4.3 Leak edge cases (every one found)

**(1) `replaceTop` silently discards the previous entry's teardown.**
js/config.js:1227 overwrites `top.kind/teardown/el`; the old closure is never invoked on
any path. Two live callers: openModal's modal-over-modal branch (js/app.js:3074-3075) and
openPage's `opts.replace` (js/app.js:3176).

Today this leaks nothing, because both callers hand-roll the equivalent cleanup —
openPage's replace branch does `stack.pop()` (js/app.js:3114), `prevTop._onClose()`
(:3116), `_focusTrapDetach(prevTop)` (:3117), `prevTop.remove()` (:3118); openModal reuses
the same static `#modal-overlay`/`#modal-box` and `_focusTrapAttach` self-detaches
(js/app.js:2984). The only real residue is that `_focusReturn(_trigger)` for the
superseded surface never runs.

**But it is exactly the hazard that kills a caller-side refcount.** If a rebuild acquires
in `openModal`/`openPage` and releases in their teardown closures, every
`openPage({replace:true})` and every modal-over-modal permanently increments by one and the
lock survives forever. Deriving from `_stack` at the four mutators is immune.

**(2) `openPage({replace:true})` checks the WRONG stack.**
`doReplace = opts.replace === true && stack.length > 0` reads `window._pageStack`
(js/app.js:3107-3108), while `Overlay.replaceTop(...)` (js/app.js:3176) overwrites the top
of `Overlay._stack` **with no kind check** — unlike openModal, which correctly guards with
`Overlay.topKind() === 'modal'` (js/app.js:3074). If a non-page entry is on top, its
teardown is silently discarded.

Not reachable via the three hr.js sites today (all place an awaited Firestore write between
any dialog dismissal and the replace). The plausible one is **chat**: js/chat.js:1051 gates
on `stack[stack.length-1].id === 'chat-thread-panel'`, a `_pageStack` check blind to a
`'lightbox'` entry pushed above it (js/chat.js:3985). A deep-linked conversation switch
(js/notifications.js:147 → `openConversation` → js/chat.js:1052) while an image lightbox is
open orphans the lightbox. **One-line fix: add `Overlay.topKind() === 'page'` to the
`doReplace` condition at js/app.js:3108.**

Second-order: in the clobber case the entry one slot down still holds the *outgoing* page's
teardown, so its `onClose` fires twice (eagerly at js/app.js:3116, again at js/app.js:3161).
Chat survives only because `teardownThread` is explicitly idempotent (js/chat.js:221-227).

**(3) `dismissTop()` is asynchronous — `dismissTop(); navigateTo()` in one tick
double-consumes history.**
`dismissTop(){ if (this._stack.length) history.back(); }` (js/config.js:1234) — the entry
is *not* popped synchronously; the pop happens in the popstate handler
(js/app.js:3227 → js/config.js:1235-1239).

`openMoreNavSheet` does `Overlay.dismissTop(); navigateTo(btn.dataset.page);` in the same
click handler (js/app.js:1349-1350). Trace: `back()` queued → `navigateTo` runs
synchronously, still sees `Overlay.isOpen()` true and calls `clearAll()` (js/app.js:2100),
setting `_pendingRewind=1` → `navigateTo` `replaceState`s the still-current overlay entry
with the new page and renders it (js/app.js:2108-2113) → **then** the queued popstate lands
with the stack empty, so js/app.js:3227 falls through and js/app.js:3230-3231 navigates back
to the origin page. The tap renders the target page and it is immediately yanked back.

Same pattern at js/app.js:2945 for profile-drawer shortcuts (drawer pushed js/app.js:2874,
`dismissTop` via `requestCloseProfileDrawer` js/app.js:2963). The sidebar path
(js/app.js:1281-1285) is **safe** because it navigates first — that ordering is the fix.
The `dismissTop(); renderTasks(...)` pairs (js/screens/tasks.js:645, 674, 684, 700) are fine
because `renderTasks` touches no history.

**Implication for the rebuild:** any lock/listener state machine must tolerate a popstate
arriving *after* `clearAll` already emptied the stack.

**(4) `closeModal(); openPage-opening-fn()` — same race, six sites.**
`closeModal()` is `Overlay.dismissTop()` (js/app.js:3183). Because `openPage` synchronously
pushes (js/app.js:3178 → js/config.js:1216), the queued popstate tears down the panel that
was *just* opened. Deterministically racy:

| Site | Target | Symptom |
|---|---|---|
| js/screens/crm.js:326 | `openROCEditor` → openPage js/screens/crm.js:332 | Edit ROC lead = dead button |
| js/screens/sales.js:1484 | `openAECEditor` → openPage js/screens/sales.js:1490 | Edit AEC contact = dead button |
| js/screens/production.js:1440 | `openDeliveryReceiptModal` → openPage :247/:260 | Record Delivery Receipt = dead |
| js/departments.js:2834 | `openJobProjectDetail` → openPage js/screens/production.js:579 | "Open the existing project" = dead (read-only page, not a form) |
| js/screens/production.js:984 | `openBillingInvoice` → `openPrintableDoc` → openPage js/print-docs.js:374 | Billing invoice print view = dead |
| js/screens/production.js:661 | `prodOrderModal` (async, js/screens/production.js:1328) → openPage :1356 | **Intermittent** — three `await dbCachedGet` at :1336/:1345/:1349; on a cache hit the microtasks drain before the traversal task and it races, on a cache miss it works |

Because both surfaces are openPage panels, the stack ends self-consistent (teardown
re-reveals the previous panel, js/app.js:3168-3172) — nothing gets permanently stuck; the
symptom is a dead button.

**Do not blind-fix two lookalikes:** js/screens/production.js:2566 (`openReceiveResolver`)
is safe because `dbCacheInvalidate` at :2564 forces a real fetch; js/departments.js:3461-3462
(`reopenQuoteFromDoc` / `newRevisionFromDoc`) have an intervening `await` (js/app.js:1753)
whose ordering was not verified.

Correct pattern is already in the tree: open the new page directly on top without closing
first (js/screens/tasks.js:687-694, whose comment records this exact race being removed), or
`Overlay.clearAll()` before reopening (js/screens/design.js:311-314), which deliberately
avoids `history.go(-n)` and defers via `_pendingRewind`.

**(5) `clearAll()` strands `_pendingRewind` — 14 call sites.**
`clearAll` deliberately does **not** rewind history (the iOS race hotfix, documented at
js/config.js:1244-1251); it pops+tears down every entry and does
`this._pendingRewind = (this._pendingRewind||0) + n`. The **only** consumer is `navigateTo`,
which converts a pending rewind into a single `history.replaceState` absorbing **ONE** stale
entry (js/app.js:2108-2113) and then zeroes the counter regardless of n.

Sites that `clearAll()` then re-open without navigating, leaving the flag armed:
js/screens/design.js:314, 590, 671, 782, 813, 861, 875, 1047, 1083; js/screens/hr.js:2667;
js/screens/tasks.js:931; js/chat.js:4334; js/screens/dashboards.js:5391;
**js/screens/production.js:895**.

Consequences:
- (a) A later `navigateTo` silently uses `replaceState` instead of `pushState`. Harmless
  while stale overlay entries remain to be absorbed; **destroys a legitimate page history
  entry** once prior Back presses have consumed those stale entries (fromHistory
  navigations never clear the flag, js/app.js:2103).
- (b) Only 1 of n is ever absorbed, so surplus stale `t:'overlay'` entries persist and each
  costs an extra dead Back press (each maps to `s.base` via js/app.js:3230-3231).
- (c) Each stale-entry pop decrements `window._navDepth` (js/app.js:3228) with no matching
  increment (`Overlay.push` stores `d` at js/config.js:1216 but never increments), so the
  top-bar back chevron's `showBack` test (js/app.js:2088) drifts permanently wrong.

(b) and (c) are **not limited to those 14 sites** — because js/app.js:2100 calls `clearAll()`
and :2108-2113 absorbs exactly one entry regardless of n, *any* ordinary nav click that
closes a ≥2-deep stack produces the same surplus. **The real fix belongs in the absorb
logic (consume n, not 1), not only at the stranding call sites.**

**(6) `openModal` can push a SECOND `'modal'` entry onto the same DOM node.**
It only collapses into `replaceTop` when `Overlay.topKind()==='modal'` (js/app.js:3074-3078).
If the top is `'dialog'`, `'page'`, `'lightbox'`, `'drawer'`, `'sidebar'`, `'qb-fullscreen'`
or `'push-prompt'`, it **pushes** — but all modals share the single static `#modal-overlay`
(index.html:305). Two Overlay entries then point at one element: the first Back hides it,
the second Back appears to do nothing. A push-count-based lock would double-count one
visible surface here.

**(7) `_closing` is a dead flag — there is no re-entrancy guard.**
`_popOne` sets `this._closing = true` around the teardown and resets it (js/config.js:1238),
but **nothing anywhere reads `_closing`** (grep returns only js/config.js:1209 and :1238).
`clearAll` doesn't set it at all. A teardown that re-enters Overlay is completely unguarded:
`clearAll`'s `while (this._stack.length)` would observe a stack mutated underneath it, and a
teardown that pushes during `clearAll` would loop forever or tear down the fresh surface.
Today no teardown re-enters — js/chat.js:228 explicitly documents "NEVER calls
dismissTop/history.back()" — but that is convention, not enforcement.

**(8) `clearAll` un-hides each buried page immediately before destroying it.**
The loop has no yield (js/config.js:1243). With pages [A,B]: B's teardown does
`newTop.classList.remove('page-under'); newTop.style.visibility=''` (js/app.js:3168-3172),
making A visible; then A's teardown immediately removes `.open` and schedules
`p.remove()` at +300ms (js/app.js:3164). The user sees each buried page flash in and slide
out, and both nodes stay in the DOM for 300ms with dynamic z above the freshly-rendered
page underneath. Note `.page-under` is applied **both** as an inline `visibility:hidden`
and as the class (js/app.js:3148-3149) — the class now carries the real rule
(css/styles.css:2214), so clearing only the class leaves the inline style winning.

**(9) Teardown keeps the removed panel in the DOM for 300ms.**
`setTimeout(() => { if (p.isConnected) p.remove(); }, 300)` (js/app.js:3164) matches the
`.3s` transition (css/styles.css:2193), while `newTop.style.visibility=''` fires
immediately. **Two panels are laid out simultaneously during that window**, both matching
`.page-panel`. Any new per-panel machinery (ResizeObserver, per-panel visualViewport
handler, `--kb-offset` writer) needs the same `isConnected` guard the existing code already
uses at js/app.js:3169.

**(10) Session boundary — see §1.3(E).** No hook exists. Add a `Session.addCleanup(...)` in
the bootstrap block at js/app.js:117-152, or an explicit hard reset in the null-user branch
at js/app.js:153-158, that: runs remaining teardowns; sets `Overlay._stack.length = 0`,
`Overlay._pendingRewind = 0`, `window._pageStack.length = 0`; removes every `.page-panel`
from the DOM; drops `chat-fullscreen`/`qb-fullscreen`/`sidebar-open`; calls `_sync()`.

**(11) `navigateTo` only clears overlays on non-history navigations.**
`if (!opts.fromHistory && ... Overlay.isOpen()) Overlay.clearAll();` (js/app.js:2100). The
fromHistory path *relies* on the popstate handler having returned early when
`Overlay.isOpen()` (js/app.js:3227). The invariant holds today but is implicit and
unasserted. The `hashchange` handler (js/app.js:3233-3237) calls `navigateTo` **without**
`fromHistory`, so it does clearAll. Separately, `navigateTo`'s defensive
`window.closeTaskPanel()` (js/app.js:2122) compares
`Overlay.topEl() === _activeTaskPanelEl` (js/screens/tasks.js:484) — `topEl()` returns null
for el-less entries and `_activeTaskPanelEl` is null when no task page is open, so
`null === null` matches spuriously. Harmless only because `dismissTop` guards on
`_stack.length` and `clearAll` already emptied the stack one line earlier. **A rebuild that
changes clearAll ordering re-arms this.**

**(12) `_showAddDealModal` bypasses Overlay entirely.**
js/screens/partners.js:966-967 hand-builds a `.modal-overlay active` div and appends it to
`document.body` with **no** `Overlay.push`. No `_stack`-derived lock can ever cover it;
it needs a separate fix.

### 4.4 The existing visualViewport listener is the right precedent — with caveats

`_onViewportResize` (js/chat.js:1521-1540) works because it is a **stable module-scope
function reference** (so `addEventListener` dedupes identical `(type, fn, capture)` triples
and a double-add is free) and because it bails on `!panel || !panel.isConnected`
(js/chat.js:1522-1523).

Its side effects are **not panel-scoped**: it writes `--kb-offset` on
`document.documentElement` (js/chat.js:1532) plus an inline `bottom` on the panel (:1533).
`--kb-offset` has **three JS touch points and one CSS reader**:

| | Location |
|---|---|
| Writer (resize) | js/chat.js:1532 |
| Writer (composer blur reset) | js/chat.js:1474, inside js/chat.js:1473-1476 |
| Teardown removeProperty | js/chat.js:254 |
| Sole CSS reader | css/styles.css:3827 |

Any plan that retires this mechanism must handle **all three** JS touch points.

Two further gotchas:
- The blur reset is bound to the composer textarea `#chat-input` only. Focusing the
  in-thread search (`#chat-search-input-thread`, js/chat.js:1003, focused at js/chat.js:3381)
  raises the keyboard from an element with **no** reset. And `_onViewportResize`
  early-returns on `!panel.isConnected` (js/chat.js:1522-1523) *before* it would zero the
  var, so a resize arriving while the panel is detached cannot clear it either. Normal close
  is clean (teardown removeProperty at js/chat.js:254, wired as `onClose` at js/chat.js:1054).
- `teardownThread` is invoked **twice** on the replace path (once via `prevTop._onClose()`
  at js/app.js:3116, once via the new page's teardown). It is explicitly written to be
  idempotent (js/chat.js:221-227). **The new listener manager must be too** — the RELEASE
  side must be exactly-once, and it must reset the document-level custom property, because
  a stale `--kb-offset` on `<html>` outlives any panel.

### 4.5 Complete set of entry points into `dismissTop()`

Swipe gestures are disabled (js/gestures.js:352-353), so the full set is:
`.page-panel-back` (js/app.js:3154) · `#modal-close` / `#modal-overlay` backdrop
(js/app.js:3185-3186) · `window.closeModal()` (js/app.js:3183) · dialog OK/Cancel/backdrop
(js/config.js:1276-1278, 1307-1309) · Escape via `Keymap.closeTopOverlay()` (js/app.js:3291)
· top-bar chevron `navBack()` → `history.back()` (js/app.js:2092) · OS/browser Back →
popstate → `_popOne()` (js/app.js:3227).

**Every one funnels through popstate.** That is the single release point a rebuild can rely
on for Back-initiated closes.

---

## 5. Scroll-lock hazards

**Baseline facts.** The DOCUMENT is the app's page scroller. `.main-content` never receives
`overflow`, `height`, or `flex` in **any** of its six declarations (css/styles.css:1174-1183,
2494-2502, 2592-2596, 2606, 5362-5367, 6178-6181) — only margins, padding, min-height,
max-width. No ancestor creates a scroll container either: `html` (css/styles.css:69-75)
declares no `overflow`; `body` (css/styles.css:119-133) declares only
`min-height:100dvh; overflow-x:hidden; position:relative; overscroll-behavior-y:none`;
`#app-shell` sets no overflow; `#page-content` sets only `overflow-x: clip`
(css/styles.css:1187), which does not coerce `overflow-y` to auto.

Note `.main-content` is a **column flex item**, not a normal-flow block —
`#app-shell` is `.screen { display:flex; min-height:100dvh }` (css/styles.css:391) plus
`#app-shell { flex-direction: column }` (css/styles.css:745). No `flex` shorthand is set on
`.main-content`, which is why it still stretches to auto height and the document keeps
scrolling.

**A lock already exists and is the wrong kind.** `body.sidebar-open { overflow: hidden; }`
(css/styles.css:1214), applied at js/app.js:1470 and removed at js/app.js:1452. Because
`html` sets no overflow, that `overflow:hidden` propagates to the viewport per the CSS
overflow-propagation rule — so it *is* a real lock in spec terms (the app already relies on
the same propagation for `body{overflow-x:hidden}` at css/styles.css:124). Whether it holds
in iOS standalone WebKit is unverified from this repo. Either way: a new
`position:fixed`-style lock must **subsume or explicitly supersede** it, not run alongside
— they interleave on ordinary paths (both the drawer and page-panels are phone surfaces
and both route through the same `Overlay` stack, js/app.js:1471 / js/app.js:3178), and
while `body{position:fixed}` is active `window.scrollY` reads 0, so any handler that
re-reads scroll at teardown restores to 0 and the page snaps to top.

### Hazard 1 — a transform-based lock destroys the entire app chrome (hard constraint)

The lock **must not** put `transform`, `filter`, `perspective`, `backdrop-filter`,
`will-change: transform`, `contain: paint|layout|strict|content`,
`container-type: size|inline-size`, or the individual `translate`/`rotate`/`scale`
properties on `<body>`. Any of those makes body the containing block for **every**
`position:fixed` descendant at once. Verified fixed body-descendants:
`.topbar` (css/styles.css:3474), `.top-nav-strip` (812), `.bottom-nav` (5185),
`#sidebar` (1008), `.sidebar-overlay` (1167), `.page-panel` (2191, body-appended
js/app.js:3153), `.drawer` (2262), `.modal-overlay` (2167), `.dialog-overlay` (2217),
`body::after` (2488), `body.sidebar-open::after` (1221), `.qb-exit-pill` (3884),
`#splash-screen` (1623), `#ptr-indicator` (1640), `.notif-panel` (921),
`.notif-backdrop` (937), `.ms-lightbox` (4434), the toast (js/notifications.js:1093/1108),
the push prompt (js/notifications.js:781/839), the backup-health banner (js/app.js:290/295),
the fatal-error screen (js/app.js:543), the profile-photo gate (js/app.js:862), and the
gesture pill (js/gestures.js:93/103).

Overlays using `inset: 0` would not merely translate — they would **resize** to body's
full document-height padding box.

`position: fixed` on body is safe, because `position:fixed` on an element does not itself
create a containing block for its fixed descendants. It is not the *only* safe approach —
any lock avoiding the properties above works — but it is the one that composes with this
tree.

**Scope correction:** the same warning does **not** apply to `#main-content`. Per
index.html:290-293 it contains only `#page-content`, all the chrome above is either a
sibling inside `#app-shell` or a direct body child, and no `position:fixed` element renders
inside `#page-content`. The element with real (partial) risk is `#app-shell`
(index.html:192) — a transform there breaks topbar, top-nav-strip, sidebar,
sidebar-overlay, PTR indicator and bottom-nav, though not the body-level modal/drawer/
dialog/page-panel/toast/banner.

### Hazard 2 — `body{position:fixed}` needs `left:0; right:0; width:100%`

An out-of-flow box with `left/right/width: auto` is **shrink-to-fit**. Measured in an
isolated repro of this exact `html`/`body` cascade: `body.offsetWidth` collapsed
375 → 30px under `position:fixed; top:-Ypx` alone; adding `left:0; right:0; width:100%`
restored it. This is the real requirement, and it is sufficient — the minimal rule
`position:fixed; top:-Ypx; left:0; right:0; width:100%` fully locked the document
(`documentElement.scrollHeight` dropped to `clientHeight`, `window.scrollTo(0,1500)` left
`scrollY` at 0) and preserved content position pixel-for-pixel.

`height:100%` / `bottom:0` / `overflow:hidden` are optional hardening, **not** correctness
requirements: a `height:auto` fixed box sizes to its content and therefore has zero
vertical scrollable overflow, so its computed `overflow-y: auto` is inert, and the viewport
clips the overhang. (Body's computed `overflow-y` is *already* `auto` today under
`position:relative`, because `overflow-x:hidden` + `overflow-y:visible` computes to `auto`
— `position:fixed` changes nothing about that.)

*Caveat: measured in Chromium, not iOS WebKit. The mechanism is engine-independent, but the
iOS confirmation is owed.*

### Hazard 3 — `html { scroll-behavior: smooth }` makes any unlock restore ANIMATE

css/styles.css:70 sets `scroll-behavior: smooth` on `html`, overridden only under
`@media (prefers-reduced-motion: reduce)` (css/styles.css:5874). A `window.scrollTo(0, savedY)`
on unlock would therefore animate. Use `window.scrollTo({ top: savedY, left: 0, behavior: 'instant' })`
or set `documentElement.style.scrollBehavior='auto'` around the restore.

*This is a spec-review item, not a current defect — there is no `window.scrollTo` anywhere
in the app today.* Note also that a proposed `ScrollLock.release()` called from
`exitQbFullscreen` would fire on desktop/tablet too unless gated the same way the openPage
push is.

### Hazard 4 — `history.scrollRestoration` is never set, and every overlay open/close is a push/pop

`grep` for `scrollRestoration` across js/, index.html, sw.js, css/ returns **zero** hits.
`Overlay.push` does `history.pushState` per surface (js/config.js:1216), `dismissTop()` is
`history.back()` (js/config.js:1234), and teardown — where an unlock+restore would live —
runs inside the popstate handler (js/app.js:3227 → js/config.js:1235-1239).

With `scrollRestoration` at its `'auto'` default the browser snapshots scroll AT PUSH TIME.
Under a `position:fixed` lock that snapshot is 0, and the UA re-applies 0 on the Back that
triggers the unlock — racing the manual restore in the same frame.

Today this cannot fire (no lock, no manual restore, and the existing `overflow:hidden` lock
preserves the offset rather than zeroing it). **Set `history.scrollRestoration = 'manual'`
once at boot BEFORE shipping any `position:fixed` lock.** Cheap, correct, prerequisite.

Scope note: "every open/close is a push/pop" is not strictly true — `replaceTop`
deliberately touches no history (js/config.js:1224-1231) and `clearAll` intentionally leaves
stale entries rather than rewinding (js/config.js:1240-1252).

### Hazard 5 — pull-to-refresh's "am I at the top" guard is already blind, and becomes unconditionally true

Two compounding defects, **present today, before any lock**:

- `_scrolledAncestor(el)` walks upward from the touch target but its loop condition
  explicitly stops at `document.body` / `document.documentElement`
  (js/app.js:670-677: `while (n && n !== document.body && n !== document.documentElement)`),
  so it never inspects the document scroller — the one that matters for a top-of-page check.
  The same blind helper is re-used in `touchmove` (js/app.js:692), so an armed pull is never
  disarmed mid-drag either.
- The momentum guard listens for `scroll` on `#main-content` (js/app.js:663), which has no
  `overflow` and therefore **never fires**, so `_lastMcScrollAt` stays 0 and
  `Date.now() - 0 < 400` (js/app.js:682) is never true.

Net: PTR can already arm mid-page. A slow mid-page downward swipe ≥250px held ≥320ms
triggers `navigateTo(currentPage)`, and ≥380px triggers `location.reload()`
(js/app.js:708-721) — **silently**, because index.html:285-287 omits the `.ptr-label` /
`.ptr-ring-*` nodes the code writes to, so no "Release to refresh" text ever appears.
The function's own header comment (js/app.js:586-590) asserts a gate ("only arms when the
content is ALREADY resting at the EXACT top (scrollTop 0) AND no scroll happened in the last
400ms") that does not exist in the code.

Under `body{position:fixed}` the document scrollTop is 0 by definition, so even a *corrected*
top-check would report "at the top" and PTR would arm anywhere. This only bites if the new
phone page renders **inside** `#main-content`/`#page-content` — the PTR listeners are bound
to `mc`, and openPage panels live on `document.body`, out of reach.

Separately: `updateInd()` writes `mc.style.transform = translateY(...)` during a drag
(js/app.js:634-635), turning `#main-content` into a containing block for any `position:fixed`
descendant of `#page-content` for the duration of the pull. One shipping instance already
exists — `#qb-frame` (js/app.js:1649, child of `#page-content` per js/app.js:1595) goes
`position:fixed` under `body.qb-fullscreen` (css/styles.css:3865) — though in practice the
fullscreen iframe swallows the touches.

### Hazard 6 — html2canvas is the only export path on iOS standalone, and it reads window scroll

`js/vendor/html2canvas.min.js` references `pageYOffset` (3×), `scrollY` (5×),
`pageXOffset` (3×), `scrollX` (5×) and `windowBounds` (7×): its default capture window
derives from live window scroll offsets, and it clones the whole document — including
`<body>`'s inline style — into an offscreen iframe. Under the lock, body carries
`position: fixed; top: -1234px`, which the clone inherits.

The capture targets are wrapped in a `position:fixed; left:-99999px; top:0` div appended to
`document.body` (js/print-docs.js:158-177; js/screens/hr.js:3946-3966 with the
`wrap.style.cssText` at :3961). Being fixed, that wrapper *should* stay viewport-anchored
even with a fixed body — no transform is involved — so it probably survives.

**This is a static-analysis inference only.** The minified control flow was not traced, and
this is the delivery mechanism for every payslip, quote and printable document on iOS
standalone (js/print-docs.js:290-309, `_handleDocPrintOrPdf`). **Highest-risk unverified
interaction in this document.** Test Save-as-JPEG and Print/Save-PDF on a real iPhone with
the lock active, from a doc opened while the page behind was scrolled well down.

### Hazard 7 — `window.print()` fallback does not neutralize a fixed body

On non-iOS-standalone the doc host calls `window.print()` directly (js/print-docs.js:291;
autoPrint at js/print-docs.js:301, 386-393). The global print stylesheet resets
`#page-content{position:static!important; width:100%!important; ...}` (css/styles.css:5988)
and forces `body` background/color (css/styles.css:5978) — but never resets body's
`position`/`top`/`height`/`overflow`. Under the lock, print would paginate only the visible
viewport slice and clip everything below. **Fix: add
`body{position:static!important; top:auto!important; height:auto!important; overflow:visible!important}`
to the `@media print` block (css/styles.css:5969-5998).** Desktop-only; the iOS path goes
through html2canvas.

### Hazard 8 — auto-logout's idle reset listens for `scroll` on `document`

`startAutoLogout` registers `['click','keydown','mousemove','touchstart','scroll']` on
`document` (js/app.js:408-419). Scroll events from nested elements do not bubble, so once
body is locked the document never scrolls and a user scrolling inside a page's inner
scroller generates zero `scroll` events. `touchstart` is also in the list and does fire, so
auto-logout still works on iPhone — the `scroll` entry becomes dead weight, and the
behaviour would break on a mouse-only device where the only activity is wheel-scrolling
inside a panel.

### Hazard 9 — `content-visibility: auto` can make the restore land a few pixels off

`.task-feed-item`, `.chat-inbox-row`, `.team-masonry > .team-member-card` and
`.data-table tbody tr` all use `content-visibility: auto` with `contain-intrinsic-size`
placeholders that the stylesheet itself documents as approximations (css/styles.css:1200-1207).
Rows below the fold are size-skipped to the placeholder; when the lock releases and
`scrollTo(0, savedY)` runs, rows between 0 and savedY re-render at their true heights and
the restored offset can be off by the accumulated placeholder error on long lists (task
feed, chat inbox, ledger tables). `.card-body { overflow-anchor: none }` (css/styles.css:2562)
disables the browser's scroll-anchoring compensation that would otherwise absorb some of it.

### Hazard 10 — no inner scroller declares `overscroll-behavior`

`overscroll-behavior` is declared only on `html` (`none`, css/styles.css:74) and `body`
(`overscroll-behavior-y: none`, css/styles.css:132) — they exist to stop native
pull-to-refresh fighting the SPA's own. **None** of the app's inner scrollers declare it:
`.page-panel-body` (css/styles.css:2203-2204), `.modal-body` (2245, mobile 2560),
`.drawer-body` (2327), `#chat-thread-scroll`, `.table-wrap` (2559), `.top-nav-strip`
(819-821). They chain overscroll to the document, which is exactly how a "locked" page leaks
a scroll to the page behind on iOS. **Add `overscroll-behavior: contain` to each one that
lives inside the new phone page.**

For `touch-action`: the app sets `touch-action: manipulation` on interactive elements
(css/styles.css:88) and `touch-action: none` only on the chat lightbox
(css/styles.css:4455, 4459) — nothing on body/html, which is correct for the lock (a
`touch-action: none` on body would kill scrolling inside the page panel too).

### Hazard 11 — safe-area padding will double-count under a visual-viewport-anchored layout

`.page-panel-foot` pads `calc(12px + env(safe-area-inset-bottom))` (css/styles.css:2205-2207);
`.page-panel-body` pads `calc(16px + env(safe-area-inset-bottom))` at the bottom
(css/styles.css:2203-2204, reduced to 12px on mobile at css/styles.css:6222-6224);
`.messenger-input-row` pads `calc(8px + env(safe-area-inset-bottom))` (css/styles.css:4231).

When the keyboard is up the home indicator is hidden, but `env(safe-area-inset-bottom)` does
**not** go to 0 (unverified on iOS — see §8). If the rebuild anchors the panel to the visual
viewport, the foot gains the keyboard offset **and** keeps the ~34px inset — a visible dead
gap above the keyboard on every one of the ~108 footer-bearing pages. The safe-area padding
needs to be conditioned on keyboard state (folded into the same custom property), not left
as a static `env()`.

The `.messenger-input-row` comment (css/styles.css:4228-4230) justifies the inset on the
premise that "every consumer of this row is bottom:0-anchored full-screen". That premise is
**false** for the task/doc comment composer (js/departments.js:783), which flows inside
`.page-panel-body`'s scroll (js/screens/tasks.js:621-624) — so the one hardcoded value is
wrong in both directions.

### Hazard 12 — `scrollIntoView` calls that the lock silently FIXES, but with a smooth-scroll caveat

The **only** three `scrollIntoView` calls in js/ are in chat:
js/chat.js:3307 (`{block:'center', behavior:'smooth'}`), js/chat.js:3358 (same), and
js/chat.js:4386 (`{block:'start'}`, instant). `scrollIntoView` scrolls every scrollable
ancestor including the document, so today a jump-to-quoted-message can also shift the page
behind the chat panel. Under a lock the document can't move — a net improvement. The
residual risk: the two smooth ones, combined with `html{scroll-behavior:smooth}`
(css/styles.css:70), can still be in flight when the panel closes and will interleave with
an unlock restore.

### Hazard 13 — `navigateTo()` never resets scroll

`navigateTo` (js/app.js:2094+) syncs history, tears down overlays, wipes `#page-content`,
and renders — it never touches window scroll. So navigating from a scrolled-down dashboard
keeps the previous Y. Critically, `navigateTo` is also called FROM the popstate handler with
`fromHistory: true` (js/app.js:3231), i.e. in the same tick as an overlay teardown. If the
unlock+restore lives in a teardown, and the same Back press also triggers a page navigation
(the stale-overlay-entry path, js/app.js:3230), the restore and a full page re-render race in
one frame. **Choose deliberately: restore-then-render, or restore-to-0 on cross-page
navigation.**

### 5.14 The good news: the JS surface is unusually lock-friendly

Complete inventory after grepping all of js/ (excluding js/vendor/ and js/qrcode.js):

- **Window scroll reads/writes: ZERO.** No `window.scrollY`, `pageYOffset`,
  `window.scrollTo`, `scrollBy`, `document.scrollingElement`, `scrollRestoration` anywhere.
- **IntersectionObserver: zero. ResizeObserver: zero.**
- **MutationObserver: one**, on `#page-content` childList/subtree for KPI font-fitting —
  unaffected by a lock.
- **Scroll listeners: three total** — `document` (auto-logout idle reset, js/app.js:410/416),
  `#main-content` (PTR momentum guard, js/app.js:663 — dead, Hazard 5),
  `#chat-thread-scroll` (scroll-to-bottom FAB, js/chat.js:1481).
- **`Element.scrollTop` reads/writes** are all confined to inner scrollers: js/chat.js:1539,
  2700, 4379, 4387, 4390 (writes) and 1519, 3223, 4343-4344 (reads), plus
  js/departments.js:794 (task-comment pin-to-bottom). **All unaffected by a body lock.**
- **Window `resize` listeners: four** — js/app.js:3563 (KPI fit),
  js/print-docs.js:335-336 (A4 scale-to-fit + orientationchange), js/screens/hr.js:4087-4088
  (payslip A4 fit). All read `clientWidth`/`offsetWidth`; none reads scroll.
- **Document-height dependencies in JS: none.** The only ones are CSS
  (`body{min-height:100dvh}` css/styles.css:124, `.main-content{min-height:calc(100dvh - --topbar-h)}`
  css/styles.css:1174-1183).

The real risk in this migration is not scattered scroll code — it is the Overlay/history
plumbing (§4), the two CSS-level footguns on `body` itself (Hazards 1 and 2), and the
html2canvas export path (Hazard 6).

---

## 6. Breakpoint map

Presented as facts. The 640-vs-768 question is a product call, not a code call — §6.5 lays
out both sides without a recommendation.

### 6.1 Census

`css/styles.css` contains **32-33 width-based `@media` queries** across **16 distinct px
thresholds**: 360, 380, 399, 420, 480, 639, 640, 641, 700, 701, 768, 769, 819, 820, 1023,
1024. That is **five ±1 boundary clusters** (639/640/641, 700/701, 768/769, 819/820,
1023/1024) plus **five** small-phone tweak tiers.

*(Count caveat: one line, css/styles.css:5007, is prose inside a comment that mentions a
media query. Counts of 32 vs 33 differ on whether that line is included.)*

**Small-phone tweak tiers (cosmetic only, no surface changes):**
360 (css/styles.css:5556, brand sub hidden) · 380 (5264, bottom-nav item padding) ·
399 (3991, chat bubble max-width 72%→85%) · 420 (2611, 2944, login card + theme grid) ·
480 (601, 3370, 5379, login container, subtab padding, company-overview cards).

### 6.2 The five tiers

**TIER A — "sheet/dialog", ≤639px.**
Drawer becomes a bottom sheet (css/styles.css:2283). `openModal` becomes a full-cover
opaque page instead of a bottom sheet (css/styles.css:5014). JS mirror:
`SHEET_DX_MQ = '(max-width: 639px)'` gates swipe-to-dismiss (js/gestures.js:35, applied
js/gestures.js:266 — currently inert, §2.4).

**TIER B — "phone density", ≤640px.**
The WS43 breathability pass (css/styles.css:6089) and the V14 MOBILE DENSITY PASS
(css/styles.css:6160): page-header h2 `clamp(1.375rem, 5.5vw, 1.625rem)`, main-content
padding 10px, card padding 12px, kpi-card `min-height:0` + corner-pinned icon, chip-tabs
horizontal scroll, form inputs 40px, table cell padding 8/10, card radius 10px + no shadow.
Also table-wrap scroll fade (1942) and chat fullscreen (3803). `.drawer` padding-right at
`min-width:640` (2276) is the *inverse* of this tier. JS mirrors: toast bottom offset
(js/notifications.js:1088) and `_isPhoneWidth() { return window.innerWidth <= 640; }`
(js/chat.js:1507).

**TIER C — "tablet / landscape-phone gap", 641-768px.**
The ONLY block scoped exclusively here is css/styles.css:5334 (`.item-card` r14 /
`.kpi-card` r16 + `16px 14px` padding / `.card` r18). Everything else in this band is
inherited from Tier D.

**TIER D — "mobile shell", ≤768px.**
`#topbar` hidden (css/styles.css:2461) · top-nav-strip shown (2505) · bottom-nav shown
(2531) · sidebar off-canvas (2473) · `body::after` notch cap (2487) ·
`.page-panel { top: env(inset-top) }` (2529) · modal→bottom sheet (4974) · drawer→full-screen
(2298, 5302) · PTR offset (1688) · page-header h2 2rem (4893) · main-content padding 16px
(5361) · text-rendering (2626) · qb-fullscreen (3854). JS mirrors: js/app.js:813
(avatar→drawer), js/app.js:1415/1422 (`TOPBAR_MOBILE_MQ`), js/app.js:1463 (sidebar overlay
mode), js/app.js:1559 (`QB_FULLSCREEN_MQ`), js/notifications.js:1288 (bell→page not
dropdown), js/gestures.js:73.

**TIER E — tablet rails / desktop.**
769-819px (css/styles.css:2582, phone treatment on a wider canvas) · 820-1023px (2600, 72px
icon rail) · ≥1024px (3766 chat two-pane, 4954 centred top-nav-strip).

**Cross-boundary third axis: 700/701.** `.table-cards` responsive table→card mode flips at
≤700 (css/styles.css:1976) and `.an-row2` stacks at ≤700 (6287), while `.tc-caret` hides at
≥701 (2033). Independent of everything above.

`quote-builder-v2.html` has its own internal 420/700/768 queries (lines 193, 303, 363, 381,
658) — it is a separate document sized by the iframe, and `env()` resolves to 0 inside it
(noted at css/styles.css:3866-3868).

### 6.3 What actually renders at 700px today (everything that is not chat)

- **Shell (from ≤768):** no `#topbar`; `#top-nav-strip` at `top:env(inset)` holding the brand
  stack + relocated search/notif/menu/avatar (`placeTopbarActions`, js/app.js:1415-1432);
  `#bottom-nav` visible with labels; `#sidebar` off-canvas + edge-swipe armed
  (js/gestures.js:73 — inert); opaque `body::after` notch cap; `.main-content` margin-top
  `calc(--top-nav-h + inset)`, padding 16px (css/styles.css:5361).
- **Surfaces:** `openModal` renders as a **92dvh bottom sheet** — `align-items:flex-end`,
  border-radius `22px 22px 0 0`, translucent scrim, pull handle, `sheetRise` animation
  (css/styles.css:4974-5005). It does NOT get the ≤639 full-cover opaque page treatment
  (5014). Drawers DO go full-screen (2298). `.page-panel` covers everything below the notch.
- **Density:** no ≤640 pass. `page-header h2` = 2rem/32px (css/styles.css:4893), not the
  clamp. Cards keep radius 18px + box-shadow (5334 + base). `.kpi-card` = `16px 14px`
  padding, radius 16, icon badge stacked above the label (the "billboard" look the density
  pass kills at ≤640). chip-tabs wrap instead of horizontal-scrolling. Form inputs at base
  height, not 40px.
- **Tables:** ≤700 matches, so `.table-cards` tables ARE in tap-to-expand card mode
  (css/styles.css:1976); and because ≥701 doesn't match, `.tc-caret` is visible (2033).
  `.an-row2` analytics panels stack (6287).
- **JS:** every 768-keyed check reads mobile. The one 640-keyed check that is not chat —
  the toast offset — reads **desktop** (§6.6).

Net character: **a phone shell wrapped around tablet-density content** — full mobile
navigation and mobile tables, but desktop-scale typography, padding and card chrome, and
popup-style modals.

### 6.4 The key deflation: chat is ALREADY visually fullscreen at 641-768px

The 640-vs-768 tension is far smaller than it looks.

The chat thread panel is **not** a bespoke fixed element — `chat.js` builds it via
`window.openPage()` (js/chat.js:1052) and stamps the id `chat-thread-panel` onto the
returned `.page-panel` (js/chat.js:1056). Therefore:

1. `.page-panel` is `position:fixed; left:0; right:0; bottom:0; background:var(--bg)`
   (css/styles.css:2191-2193), and at ≤768px its top is overridden to `env(safe-area-inset-top)`
   (css/styles.css:2529). At 700px it spans the whole viewport except the notch band.
   (The two-pane left inset at css/styles.css:3781 is gated `@media (min-width:1024px)`,
   css/styles.css:3766, so it does not apply.)
2. `Overlay.push()` writes an **inline** `z-index = 300 + stack.length*2` (js/config.js:1214,
   called from js/app.js:3178), which beats every stylesheet z-index. The panel sits at
   ~302/304 — above `#top-nav-strip` (`--z-shell-2:94`), `#bottom-nav`
   (`--z-bottom-nav:95`) and `body::after` (`--z-topbar:100`).
3. So at 641-768px today, the top strip and bottom nav are **already fully occluded** by an
   opaque panel. Painted, but invisible and un-tappable.

This is not chat-specific — it holds for **every** openPage panel at any width below the
1024px two-pane split.

The visible difference between `body.chat-fullscreen` and no-fullscreen is therefore not
"chrome shows vs hides". It is exactly:
(a) the notch band, and (b) `.ms-thread-header` geometry.

Verified exhaustive against the whole `body.chat-fullscreen` block (css/styles.css:3803-3845),
which is inert above 640px. Its `bottom: var(--kb-offset)` rule is **not** a third
difference — js/chat.js:1533 writes the same offset inline, and `.page-panel`'s competing
`bottom:0` (css/styles.css:2192) carries no `!important`, so the inline write governs above
640px. That is deliberate and documented at js/chat.js:1525-1531.

### 6.5 Concrete deltas of moving chat 640→768

Assuming both css/styles.css:3803 and js/chat.js:1507 change to 768. At a 700px viewport:

**DELTA 1 — paint/hit-test, one visible edge case.**
`#top-nav-strip` and `#bottom-nav` go `display:none` (css/styles.css:3804-3808) instead of
being painted-then-occluded. (`#topbar` is already `display:none` at ≤768, css/styles.css:2461
— not part of this.) No steady-state pixel change; saves two fixed-layer composites. **The
one genuinely visible difference on an inset-top:0 device** is the ~300ms `.page-panel`
translateX slide-in (css/styles.css:2193-2194, `.open` added at js/app.js:3156 while
`_enterFullscreenIfPhone()` runs synchronously at js/chat.js:1081): today the strip and
bottom nav are on screen for that ~300ms; after the change they vanish instantly at open.
`display:none` additionally removes them from the focus/accessibility tree, which occlusion
does not.

**DELTA 2 — fires on EVERY device, including inset-top: 0. (This is the correction to the
original "only if inset > 0" framing.)**
The `.ms-thread-header` override (css/styles.css:3839-3843) has **four** declarations, not
two: `height: auto !important`, `min-height: calc(56px + inset)`,
`padding-top: calc(8px + inset)`, `padding-bottom: 8px`. The base is a hard
`height:56px; padding: 0 8px 0 4px` with a 1px border-bottom (css/styles.css:4679-4683) and
global `box-sizing: border-box` (css/styles.css:68) — exactly 56px today.

After the flip with `env()` = 0: `height:auto` un-fixes the 56px, so the flex row sizes to
its tallest child — `.ms-thread-back` at 44px (css/styles.css:4685-4690, first child per
js/chat.js:989-991) — plus 8+8 padding plus 1px border ≈ **61px**. `min-height:56px` does not
cap it. So the header grows **56px → ~61px**, its contents re-centre ~2.5px lower, and the
message list starts ~5px lower. On an inset-bearing device that 5px is **on top of** the
inset, not instead of it.

**DELTA 3 — only if `env(safe-area-inset-top) > 0`.**
The panel's top goes `env(inset)` → `0 !important` (css/styles.css:3818), so the status-bar
band changes from the `body::after` cap (a linear-gradient of `--topbar-bg` over `--bg`,
css/styles.css:2487-2493) to the messenger header's `var(--surface)`. On a 744px iPad mini
in portrait that is a ~24px band changing colour. On a 667px iPhone SE in landscape:
no change.

**NON-DELTAS** (they look like they should change and do not):
- **Keyboard handling** — js/chat.js:1532-1533 writes both `--kb-offset` and the inline
  `bottom`, and the blur handler resets both (js/chat.js:1473-1476). Both paths already work
  at every width.
- **z-index** — dead (§2.5).
- **Horizontal safe areas** — unchanged; `.ms-thread-header` has no left/right inset at any
  width (§6.7).
- **The chat inbox** — single-pane below 1024px either way (css/styles.css:3766).
- **Modals opened from the thread** — Overlay's dynamic 300+2n tier keeps them above the
  panel regardless (js/config.js:1214).

**WHAT THE CHANGE DOES NOT FIX.** At 700px, `openModal` surfaces stay 92dvh translucent-scrim
bottom sheets with a pull handle (css/styles.css:4974-5005) — the full-cover opaque "pushed
page" treatment is scoped ≤639px (css/styles.css:5014). A 700px device would have fullscreen
chat + fullscreen quote builder + **popup-looking modals**. That residual inconsistency is
the real decision, not the chat number itself.

**Which devices are actually in the band.** Reasoned from published logical widths, not
measured: iPhone SE/8 landscape = 667, iPhone 8 Plus landscape = 736 (both home-button
devices with zero safe-area inset in every orientation); iPad mini 6 portrait = 744, older
iPad portrait = 768 (nonzero inset-top). **Every notched iPhone in landscape is 812-956 CSS
px — above the band entirely.** So Delta 3 is zero on every phone in the band and nonzero
only on iPad-class portrait, where the ≤768 geometry (top: `env(inset-top)` + the opaque
`body::after` cap) is arguably the *correct* rendering and `top: 0` would be the regression.

### 6.6 Independent 640/768 mismatches (nothing to do with chat)

**Toast offset is keyed to 640 while the bottom nav exists to 768.**
`Notifs.showToast` computes `isMobile = matchMedia('(max-width: 640px)').matches`
(js/notifications.js:1088) then sets bottom to `calc(16px + env(inset-bottom))` when mobile,
`calc(16px + 52px + 16px + env(inset-bottom))` otherwise (js/notifications.js:1089-1091).
The inline comment at js/notifications.js:1087 — "Mobile (no bottom-nav) gets a smaller
offset; desktop reserves bottom-nav space" — is **backwards**: `.bottom-nav` is
`display:none` at base (css/styles.css:5183-5184), `display:flex` at ≤768px
(css/styles.css:2531) and again at 769-819px (2588), with height
`calc(var(--bottom-nav-h,56px) + env(inset-bottom))` (css/styles.css:5188; token 56px at
css/tokens.css:131).

Per tier: at ≤640px the ~38-41px toast (z 9990, css/tokens.css:155) lands entirely inside
the 56px nav band (nav z 95) and, lacking `pointer-events:none`, both covers it and
**intercepts taps on the centre nav item(s) for 3.5s** (js/notifications.js:1109). At
641-819px the 84px "desktop" offset happens to be correct. At ≥820px it reserves 68px for a
nav that is hidden — cosmetic. The correct value already exists one file over:
`.main-content` uses `calc(var(--bottom-nav-h) + env(inset-bottom) + 18px)` at ≤640px
(css/styles.css:6180-6182). Fix: add `var(--bottom-nav-h,56px)` to the mobile branch and
`pointer-events:none`.

**`#ptr-indicator` budgets 56px for a hidden topbar.** css/styles.css:1688-1692 sets
`top: calc(env(inset-top) + 56px + 50px + 8px)` inside `@media (max-width: 768px)` — topbar
56 + nav strip 50 + 8 — but the same breakpoint sets `#topbar { display: none; }`
(css/styles.css:2461). The spinner rests ~56px lower than the bar it clears. Cosmetic, but
it is exactly the kind of hardcoded shell arithmetic a rebuild must not inherit (the same
literals appear at css/styles.css:3781-3784 for the desktop chat panel left offset, with a
comment warning to recompute them by hand).

### 6.7 Landscape: no left/right safe-area anywhere in the messenger

`.page-panel` is `left:0; right:0` at every width (css/styles.css:2192). The one piece of
chrome that DOES pad `max(16px, env(safe-area-inset-left/right))` — `.page-panel-head`
(css/styles.css:2198) — is `display:none`'d for chat (js/chat.js:1076), and
`.page-panel-body`'s own left/right insets (css/styles.css:2204) are wiped by the `padding:0`
in js/chat.js:1070. None of the three inner surfaces re-adds it: `.ms-thread-header`
`padding: 0 8px 0 4px` (css/styles.css:4681), `.messenger-body` `padding: 16px 12px`
(css/styles.css:3920), `.messenger-input-row` bottom-inset only (css/styles.css:4231).

With `viewport-fit=cover` (index.html:5) and `"orientation":"any"` in manifest.json, on a
notched iPhone in landscape the back chevron, avatar, ⓘ button and the composer's ➕/send
controls sit under the sensor housing / rounded corners. **This is true today at every
width; the 640→768 change neither causes nor fixes it.** Note those devices are 812-956px,
i.e. *outside* the 641-768 band. Flagged because a "page as window" rebuild that goes
edge-to-edge makes this the dominant landscape defect. Fix target is js/chat.js:1070 (keep
the horizontal safe-area padding, or push it onto the three inner surfaces), not the head's
`display:none`. Not device-verified.

### 6.8 No JS breakpoint except `TOPBAR_MOBILE_MQ` re-evaluates on rotation

Grepping every `resize`/`orientationchange` listener in js/ (excluding vendor) yields four:
js/app.js:3563 (KPI font auto-fit), js/print-docs.js:335-336 (A4 scale-to-fit),
js/screens/hr.js:4087-4088 (payslip A4 fit), and js/chat.js:1492 (a `visualViewport`
listener, not a window rotation listener). **None touches a breakpoint decision.**

The only breakpoint with a live listener is `TOPBAR_MOBILE_MQ` (`max-width:768px`,
js/app.js:1415), whose `change` handler re-runs `placeTopbarActions()` (js/app.js:1434-1438).

So:
- `_enterFullscreenIfPhone()` runs **once**, inside `_buildThreadPanel` (js/chat.js:1081).
  Rotate after opening and the body class is whatever it was at open — stale in **both**
  directions (open in portrait then rotate: class present but inert; open in landscape then
  rotate to portrait: class never added, so no fullscreen at all).
- `enterQbFullscreen()`/`exitQbFullscreen()` run once per `renderQuoteBuilderIframe()`
  (js/app.js:1655-1656) and on `navigateTo` away (js/app.js:2131).

**Chat degrades gracefully** — the panel is an openPage panel and falls back to generic
`.page-panel` styling. **Quote Builder does not:** js/app.js:1650 emits `#qb-frame` with an
empty inline style on the mobile branch, and the only `#qb-frame` CSS in the tree lives
inside `body.qb-fullscreen @media (max-width:768px)` (css/styles.css:3864-3876). Rotating a
≤768 portrait device into a >768 landscape (iPad mini 744 → 1133) strips the iframe's only
sizing rule and collapses it to the UA default (~300×150), with no listener to recover. The
floating `.qb-exit-pill` is intentionally unscoped by the media query
(css/styles.css:3878-3883), so it stays visible and clickable over the broken layout.

**Interaction with the 640/768 decision:** raising chat to 768 would make a stale class stay
ACTIVE across an SE-class phone's rotation (667 → still ≤768), i.e. 768 accidentally makes
rotation *more* consistent for SE/8-class phones. It makes it *worse* for iPad mini (744
portrait → 1133 landscape), where the class would be set in portrait then go inert on
rotation into the ≥1024 two-pane layout (css/styles.css:3766, 3781).

### 6.9 Comments that assert breakpoint intent the code does not deliver

Treat these as unreliable during the rebuild:

1. **css/styles.css:3799-3802** — "Desktop/tablet (>640px, the two-pane scaffolding above)
   is completely untouched." The two-pane scaffolding starts at **1024px**
   (css/styles.css:3766), so 641-1023px is neither the phone-fullscreen tier NOR the two-pane
   tier. The comment collapses three tiers into two.
2. **css/styles.css:3848-3853** (qb block) — "mirroring `body.chat-fullscreen` directly
   above." It does not mirror it: qb moves the element itself to a **live** z-index 5000
   (pushed with no `el`, js/app.js:1584), while chat's z declaration is dead and the element
   sits at ~302; qb offsets **below** the notch (`top: env(inset-top)`) and relies on the
   parent's `body::after` cap precisely because `env()` resolves to 0 inside an iframe
   (css/styles.css:3866-3868), while chat goes `top:0` and lets its own header pad the inset.
   Different mechanism, different layer, **opposite** notch strategy. Correct, not a bug —
   but do not unify them naively.
3. **css/styles.css:5007-5013** documents that the ≤639 modal block was deliberately reduced
   to a **DELTA** over the ≤768 baseline, with per-property `!important` chosen to win
   specific cascade fights, "Verified computed-equivalent at 375px/700px/800px." **Collapsing
   639/640/641 into one number will break that delta relationship** — those blocks are not
   independent.

---

## 7. Claims that did not survive verification

Do not re-derive these. Each was killed by majority vote of independent refuters.

1. **"Only ONE surface is visualViewport-aware, and only under two simultaneous conditions
   (body.chat-fullscreen AND ≤640px)"** — the listener registers at *every* width and writes
   `panel.style.bottom` unconditionally (js/chat.js:1533); only the CSS *consumption* of
   `--kb-offset` is gated. Rotating to landscape does **not** break the keyboard offset,
   because `.page-panel { bottom:0 }` (css/styles.css:2192) carries no `!important` and the
   inline write wins. Documented as intentional at js/chat.js:1530-1531.
2. **"promptDialog's auto-focused input lands behind the keyboard"** — the *input* generally
   does not; a short centred card puts it above the fold. What is reliably occluded is the
   OK/Cancel `.dialog-actions` row (css/styles.css:2230). Aggravated by js/config.js:1309
   (backdrop tap cancels and discards typed text — exactly the gesture used to dismiss a
   keyboard). The claim's supporting rationale was also unsound: there is no scroll lock, and
   iOS focus auto-zoom is already defeated by `pointer:coarse` `font-size:1rem`
   (css/styles.css:324-326). The z-index sub-claim was false.
3. **"Toast bottom offset is inverted between phone and desktop"** — half right. The ≤640px
   half is real (§6.6); the 641-819px "desktop" branch is *correct* because the nav is still
   shown there, and the ≥820px case is cosmetic whitespace. Severity is medium (a 3.5s
   transient tap-shadow over one or two nav tabs), not high.
4. **"Pages stack up to 4 deep"** — max verified depth is **3**. The cited 4th level was a
   misread: Grade and Worker Profile are sibling depth-1 buttons in the same table row
   (js/screens/dashboards.js:2229-2230, handlers :2281 and :2319).
5. **"replaceTop leaks the lock and the visualViewport listener"** — the listener is removed
   via `prevTop._onClose()` (js/app.js:3116 → js/chat.js:1054 → js/chat.js:248), and
   `replaceTop` does not push, so a refcount whose ±1 both live at the four mutators
   *balances*. The leak is a property of **caller-side** acquire only. The residue is
   cosmetic (`_focusReturn` skipped). See §4.3(1) for the accurate framing.
6. **"openPage({replace:true}) orphans a modal above it"** — the invariant hole is real
   (§4.3(2)) but no *modal* path is reachable: all three hr.js replace sites are
   self-refreshes with an awaited network round-trip. The realistic clobber is a chat
   **lightbox**, and the stated symptom was wrong (the new page paints *above* the orphan,
   which only resurfaces later).
7. **"The DOCUMENT is the only page scroller and nothing currently locks it"** — the first
   half is right, the second is false: `body.sidebar-open { overflow: hidden; }`
   (css/styles.css:1214) is a live, spec-valid lock. Also `.main-content` is a flex item, not
   a normal-flow block, and a body lock is not the *only* lever (`.page-panel` is already a
   fixed window with its own inner scroller and needs no lock).
8. **"`body{overflow-x:hidden}` turns body into a broken unclipped scroll container the
   moment you set position:fixed"** — falsified by measurement. Computed `overflow-y` is
   *already* `auto` today; a fixed `height:auto` body has zero scrollable overflow; the
   viewport clips it; `documentElement.scrollHeight` drops to `clientHeight`. `height:100%` /
   `bottom:0` / `overflow:hidden` are optional. The real requirement is
   `left:0; right:0; width:100%` (shrink-to-fit), for a different reason. See Hazard 2.
9. **"`html{scroll-behavior:smooth}` makes the unlock restore animate — visible flicker
   today"** — no `window.scrollTo` exists anywhere in the app, and the current lock
   (`overflow:hidden`) preserves the offset, so there is no restore to animate. Valid
   *spec-review* item only. See Hazard 3.
10. **"`history.scrollRestoration` unset means the UA fights your manual restore"** — cannot
    fire today: no manual restore and no `position:fixed` lock exist. Valid **prerequisite**,
    not a live defect. See Hazard 4.
11. **"replaceTop + a naive lock permanently freezes the app"** — same as (5); the arithmetic
    was backwards and no lock exists to leak.
12. **"There are five width tiers governed by six numbers plus four small-phone tiers / 13
    distinct thresholds"** — the counts were wrong (16 distinct thresholds, five ±1 clusters,
    **five** small-phone tiers, seven mutually-exclusive bands if Tier E is split). The tier
    *architecture* and every per-line attribution held. Corrected in §6.1.
13. **"body.chat-fullscreen's only real effect is the safe-area-top band, which is 0px in the
    641-768 band"** — category error: `body.chat-fullscreen` is `@media (max-width:640px)`
    (css/styles.css:3803) gated by `innerWidth <= 640` (js/chat.js:1507), so it never applies
    in 641-768 at all. In its real scope (≤640, portrait phones) `env(safe-area-inset-top)` is
    ~47-59px on a notched iPhone, not 0. The block also has five declarations, not four.
14. **"Moving chat 640→768 produces zero deltas on an inset-top:0 device"** — false; the
    `.ms-thread-header` growth (Delta 2) fires unconditionally, and the ~300ms slide-in
    difference is visible too. Corrected in §6.5.
15. **"No JS breakpoint re-evaluates on rotation (three listeners)"** — the *conclusion*
    holds but the enumeration was wrong (four sites; js/screens/hr.js:4087-4088 was missed,
    and js/chat.js:1492 is a visualViewport listener not a rotation listener), and the qb
    sizing collapse was understated. Corrected in §6.8.
16. **"Nothing locks scroll while a full-screen page-panel is open" (as a high-impact
    finding)** — factually true (§1.3(C)) but produces no standalone user-visible symptom
    today, because the panel is opaque and full-bleed. Keep as a hardening item behind the
    real pan fix, not as a headline defect.
17. **"`styles.css:3832` (dead chat z-index) is a high-impact defect"** — the mechanism is
    real (§2.5) but the impact today is **zero** and the current behaviour is the *safe* one.
    It is a landmine note for a future editor, not a bug to fix.

---

## 8. Open questions the owner must answer before implementation

**Device measurements — none of these can be resolved from this repo.**

1. **Does iOS standalone actually pan the visual viewport here, and does it report the pan
   via `visualViewport` `'scroll'` (offsetTop) or via a document scroll that only
   `window.scroll` would see?** This decides whether the fix binds `'scroll'`, `'scroll'` +
   `'resize'`, or something else. Neither is bound today. **This is the single highest-value
   measurement** — cause (A) in §1.3 is the unifying diagnosis and its remedy depends on the
   answer.
2. **What is the event ORDER on iOS between the keyboard `'resize'` and the focus-reveal
   pan?** If `resize` fires last with the pan already applied, only the header symptom
   appears; if it fires first, both appear. This predicts whether the bleed is intermittent.
3. **Does `env(safe-area-inset-bottom)` report 0 or its full value while the keyboard is
   presented?** Determines the size of the dead gap in the composer and whether the
   double-count in Hazard 11 is ~34px or 0.
4. **What is `env(safe-area-inset-top)` in landscape on Neil's actual iPhone in standalone
   PWA mode?** Delta 3 in §6.5 rests entirely on it. Also confirm iPad portrait
   (~20-24px expected).
5. **Does `body.sidebar-open { overflow: hidden }` (css/styles.css:1214) actually hold in iOS
   standalone WebKit?** If yes, the new lock may be able to reuse it rather than introduce a
   second mechanism.
6. **Does html2canvas Save-as-JPEG and Print/Save-PDF survive a `position:fixed` body?**
   (Hazard 6.) Test on a real iPhone, from a doc opened while the page behind was scrolled
   well down. This is the delivery mechanism for every payslip, quote and printable document
   on iOS standalone.

**Product / scope decisions.**

7. **Chat 640 → 768: which tier does chat conceptually belong to?** 640 is not an arbitrary
   one-off — it is the phone-density tier boundary shared by two large CSS passes
   (css/styles.css:6089, 6160), the table fade (1942) and the drawer inset (2276). Aligning
   chat to 768 moves it OFF that tier and onto the shell tier. Both are defensible. Note the
   change fixes none of the real 641-768 inconsistencies (§6.5), and the band may be
   uninhabited (§6.5, device list).
8. **Does the rebuild unify 639/640/641 into one number?** If so, budget for
   css/styles.css:5007-5013 — the ≤639 modal block is a *delta* over the ≤768 baseline with
   per-property `!important` chosen to win specific cascade fights. They are not independent.
9. **Does the new phone page render inside `#page-content`/`#main-content`, or on
   `document.body` like `openPage` does today (js/app.js:3153)?** If inside, Hazard 5 (PTR
   arming everywhere) and the `#main-content` transform during a pull (js/app.js:634-635)
   both become live.
10. **Should `openModal` and `promptDialog` be migrated onto the same window primitive?**
    A fix scoped to `openPage` leaves ~19 modal call sites (10 keyboard-bearing) and ~21
    prompt call sites unfixed, and `promptDialog` is the only one that *guarantees* the
    keyboard opens (js/config.js:1301).
11. **Should `body.chat-fullscreen` and `body.qb-fullscreen` be migrated onto the new lock
    primitive?** They are the app's current "page as window" pattern and neither locks scroll.
    If the rebuild adds a third convention you will have three. Note `qb-fullscreen` pushes an
    Overlay entry (js/app.js:1584) while `chat-fullscreen` does **not** (it toggles the class
    directly from `_enterFullscreenIfPhone`/`_exitFullscreen`, js/chat.js:1507-1513, with
    `_exitFullscreen()` in the thread teardown at js/chat.js:256) — so a lock keyed purely on
    Overlay stack depth would cover QB but silently **miss chat**.
12. **`navigateTo` never resets scroll (Hazard 13). Restore-then-render, or restore-to-0 on
    cross-page navigation?** Pick one deliberately.

**Cleanups the sweep found that are worth folding in regardless of the decisions above.**

13. Dead `#task-fullscreen-panel` CSS + the leftover 42% `#task-info-scroll` — the task
    comment list is stuck at a 380px inner scroller the v14 rewrite intended to remove
    (§3.6).
14. `Overlay.topKind() === 'page'` guard on `doReplace` at js/app.js:3108 — one line (§4.3(2)).
15. The six `closeModal(); openX()` dead buttons (§4.3(4)).
16. `_pendingRewind` absorbs 1 of n at js/app.js:2108-2113 — fix the absorb logic, not the 14
    call sites (§4.3(5)).
17. Session-boundary overlay reset (§1.3(E), §4.3(10)) — required before any centralized lock.
18. `body{position:static!important; ...}` in the `@media print` block (Hazard 7) — required
    before any `position:fixed` body lock ships.
19. The `fitA4Sheet` / `openPrintableDoc` `- 16` gutter is already ~8px wrong on phone and
    ~16px on desktop (§3.3) — fix it in the same pass that touches `.page-panel-body` padding.
20. `#ptr-indicator`'s `56 + 50 + 8` arithmetic budgets for a hidden `#topbar` (§6.6).
21. Toast bottom offset + `pointer-events:none` (§6.6).

---

*End of dossier. Read-only pass — no files edited, no git state mutated, `APP_VERSION` /
`CACHE_VER` untouched.*
