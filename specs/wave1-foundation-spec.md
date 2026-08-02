# V14 WAVE 1 — FOUNDATION SPEC (One-Window system)

_Fable-authored 2026-08-03. Implementers: Sonnet agents, one per batch, EXCLUSIVE file ownership per batch (OneDrive + version-hook re-stage footgun — never edit a file outside your list). Do NOT commit; the main session commits per phase. Do NOT touch version strings or CACHE_VER (pre-commit hook owns them). `node --check` every JS file you edit before reporting done._

## Non-negotiable invariants (all batches)

- No behavior change outside your scope; refactors must be provably equivalent.
- `escHtml()` on any user content into innerHTML. Manila helpers for dates. Lucide via `<i data-lucide>` + `lucide.createIcons()`.
- Every dismissable surface = exactly ONE `Overlay` entry; popstate is the only teardown trigger (see config.js:986 contract).
- Report: files touched, line-count delta, every deviation from this spec, and anything you could not verify.

---

## BATCH 1 — Page-stack primitives (owns: js/app.js, js/config.js, js/gestures.js, js/ui-states.js)

### 1a. True page stack in `openPage` (app.js:8293)

Today `openPage` does `#page-panel?.remove()` then pushes a fresh Overlay entry → opening page B over page A destroys A but leaves its history entry (two Backs to exit; state lost). Replace with a real stack:

- Module-level `_pageStack: HTMLElement[]`. Each `openPage` call creates a NEW panel element (unique id `page-panel-{seq}`, keep class `page-panel`).
- If a page is already on top: add class `page-under` to it (CSS: `visibility:hidden` — element stays in DOM, scroll position and form state preserved). Do NOT remove it.
- Push ONE Overlay entry whose teardown: animates own panel out, removes it after 300ms, pops `_pageStack`, and removes `page-under` from the new top (if any).
- Back from page B therefore reveals page A exactly as the user left it; one more Back closes A. Apple push/pop semantics.
- `opts.replace === true`: swap the top page in place — tear down the current top panel's DOM directly (NOT via history.back), create the new panel, and swap the top Overlay entry's teardown via the new `Overlay.replaceTop` (below). Net history depth unchanged. Used later by multi-step flows.
- New opts (all optional, backward-compatible): `headerRightHTML` (string rendered right of the title, caller wires listeners on the returned element), `onClose` (called at teardown start — for callers owning listeners/timers), and return value: `openPage` now RETURNS the panel element.
- `navigateTo`'s `Overlay.clearAll()` path must clear `_pageStack` too (add a hook or clear it inside each teardown — teardown-based is safer).

### 1b. `openModal` fixes (app.js:8259)

- **Modal-over-modal**: if the top Overlay entry is kind `modal`, do NOT push a second entry — swap content in place and `Overlay.replaceTop('modal', newTeardown)`. One Back always closes the modal.
- **Modal-over-page renders behind (BUG)**: `--z-modal` is 200, `.page-panel` is 210 — a modal opened from a pushed page is invisible behind it. Fix structurally with dynamic stacking (1c): the modal overlay element gets its z from stack position at push time.

### 1c. Dynamic z-order from open order (config.js Overlay + app.js)

- Extend `Overlay.push(kind, teardown, el)` with optional third param: the surface's root element. On push, set `el.style.zIndex = 300 + stack.length * 2`. On `_popOne`/`clearAll`, nothing to restore (element is being torn down).
- Add `Overlay.replaceTop(kind, teardown, el)`: swaps the top entry's kind/teardown/el without touching history; re-applies the same z.
- Add `Overlay.topEl()` and `Overlay.topKind()` accessors (gestures needs them).
- `openModal` passes `#modal-overlay`; `openPage` passes its panel. `confirmDialog`/`promptDialog` (config.js:1014/1036) keep `--z-dialog` 5000 — dialogs always top; do NOT convert them.
- CSS tokens stay as the BASE for static chrome; stacked surfaces get inline z at push. Range 300–398 reserved; document this in the `--z-*` comment block reference (styles.css comment is Batch 2's file — leave a one-line comment in Overlay instead).

### 1d. Full-surface swipe-back (gestures.js)

- Current edge-swipe uses a 24px left strip. Add: when `Overlay.topKind() === 'page'` (or 'modal'? NO — pages only), a horizontal pan starting ANYWHERE on `Overlay.topEl()` arms swipe-back: start threshold dx>12px with |dx|>1.6·|dy| slope guard; live-translate the panel with the finger (transform only, compositor-friendly); commit at >35% viewport width OR flick velocity >0.5px/ms → `Overlay.dismissTop()`; else spring back (~200ms).
- Exclusions (do not arm): touches starting inside `.table-wrap`, `[data-hscroll]`, `input`, `textarea`, `select`, `[contenteditable]`, or any element with horizontal overflow (`el.scrollWidth > el.clientWidth` on nearest scrollable ancestor).
- `prefers-reduced-motion`: no live translation; commit on threshold only.
- Keep the existing edge-strip behavior for the base page (history.back) and existing sheet swipe-dismiss untouched. `pointer:fine` stays disabled as today.

### 1e. z-index dev lint (app.js, small)

- `window.devCheckStacking()`: dev-only (hostname localhost/127.0.0.1 or `?dev`). Scan `document.body`'s descendants with `position:fixed` (cheap: `document.querySelectorAll('body [style*="z-index"], body [class]')` is too broad — iterate `body`'s direct children + known containers; keep <5ms). For each fixed element, computed z-index must be: one of the `--z-*` token values, in the dynamic 300–398 range, 5000 (dialog), or ≥9000 (toast/push tokens). Violations → `console.error('[stacking] off-scale z-index', el)` once per element (WeakSet).
- Call it after every `Overlay.push` and inside `navigateTo` (post-render), dev only.

### Acceptance (Batch 1)
- Open page → open page from it → Back → first page intact (scroll/form preserved) → Back → base. One history entry each.
- Open modal from a pushed page → modal visible ABOVE the page. Back closes modal, page still there.
- Modal→modal: one Back closes.
- Swipe from mid-screen on a pushed page dismisses it; swipe inside a scrolling table does not.
- Zero console errors at boot; `node --check` passes.

---

## BATCH 2 — CSS foundation (owns: css/*, index.html, sw.js)

_The full 5-file @layer split is Wave 2 (architecture) — @layer inverts !important resolution across layers and must wait for the !important audit. This batch does the safe foundation only._

- **2a. Extract `css/tokens.css`**: move the contiguous `:root { ... }` token block at the TOP of styles.css (≈lines 13–193: palette, gradients, surfaces, semantic colors, shadows, radii, spacing, layout dims, type scale, motion, z-scale) verbatim into `css/tokens.css`. Link it in index.html IMMEDIATELY BEFORE styles.css. Do NOT move the html.light/theme-dark/theme-astral blocks (mid-file; moving them reorders the cascade — Wave 2).
- **2b. Spacing tokens on desktop (B1)**: the `--space-*` custom properties are currently defined/used only inside ≤768px media queries (see the comment at styles.css:96-97). Define them unconditionally in tokens.css `:root` (same values as the mobile definitions; if mobile overrides differ, keep the mobile override in place so nothing visually changes yet).
- **2c. Merge the duplicate modal media queries (B7)**: `@media (max-width:768px)` block at ≈4584 and `@media (max-width:639px)` at ≈4613 both restyle modals as bottom sheets with `!important`s. Compute the EFFECTIVE final value for every property at ≤639px and at 640–768px, then rewrite as ONE block (or one block + one small delta block) that produces byte-identical computed styles. Remove now-redundant `!important`s only where no competing rule needs them (verify by search).
- **2d. Consolidate `.drawer`**: four definitions (≈2421, 3831, 4625, 4828). Group them adjacently (order preserved relative to each other) under one commented section, merging only exact-duplicate declarations. No computed-style change.
- **2e. Wire-up**: add `css/tokens.css` to index.html and to the PRECACHE list in sw.js. Touch NOTHING else in sw.js.
- Acceptance: app boots visually identical in all three themes (light/dark/astral) at 375px, 768px, 1280px; report any computed-style diff you could not avoid.

---

## BATCH 3 — Push-prompt onto the stack (owns: js/notifications.js)

- The custom `#push-prompt-overlay` (≈notifications.js:692, `z-index:9100`) is not Overlay-registered: Back/Esc can't dismiss it and it outranks dialogs.
- Register it: `Overlay.push('push-prompt', teardown)` on open; all dismiss paths (Allow, Later, backdrop) go through `Overlay.dismissTop()`; teardown does the actual hide.
- z: use `var(--z-dialog)` (5000). It is a prompt, not chrome above toasts.
- Preserve existing gating logic (iOS standalone, re-prompt suppression) exactly.
- Acceptance: prompt shows, device Back dismisses it, Esc dismisses it, choosing Allow still triggers the FCM registration path, zero console errors.

---

## Phase 2 (AFTER Batch 1 lands — separate agents, do not start yet)

- **Task panel** (departments.js:898 + closeTaskPanel choreography at 1033/1054/1064/1077/1085/1102/1194): rebuild as `openPage` (headerRightHTML for actions, onClose for cleanup); delete the z-4000 shell and ALL close-before-open guards — the stack handles ordering now.
- **Chat thread** (chat.js:342 `_buildThreadPanel`): rebuild on `openPage` — keep the messenger header (avatar/title/subtitle/wallpaper menu) via headerRightHTML + a custom title node; keep `chat-fullscreen` phone class, visualViewport handling, teardownThread as onClose. Delete the z-4000 shell.
- **Worker profile** (app.js:5519): same treatment; delete the defensive stale-entry pop at 5514-5517.
- Then Batch 5 (openModal→openPage conversions) and Batch 6 (nav registry) per V14-OVERHAUL-PLAN.md.
