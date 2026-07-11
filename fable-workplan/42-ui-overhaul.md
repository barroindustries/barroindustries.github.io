# Workstream 42 — Complete UI Overhaul (30 phases) — Barro Industries Operating System

> **DECIDED 2026-07-11 (Fable session).** This is the implementation spec. Sonnet executes it
> phase by phase, in order, in six batches (A–F, 5 phases each). Escalate ambiguities back to
> the main session instead of improvising. **Do not push** — commit locally per batch; Neil
> approves the push at the end.

## Vision (Neil's brief, verbatim intent)

A merger of **Facebook, Google Drive, OneDrive, Apple, Microsoft** design languages:
- **Minimal + simple Light and Dark modes**, then a third showpiece **Astral** mode.
- **Mobile-first excellence**: iPhone + Android, notch/safe-area aware, phone-shape adaptive,
  gesture support (edge swipe-back, sheet swipe-dismiss).
- **Chat looks like Facebook Messenger** — bubbles, gradients, chat wallpapers/patterns.
- **Icons**: all good-looking and unique to the BI Operating System (no raw emoji, department
  color-coded tiles).
- Fully responsive **desktop / iPad / phone**; nothing cut off, proportions right.
- **Performance is a hard constraint** — the redesign must not slow the app down.

## Ground rules (apply to EVERY phase)

1. **Read before editing.** Line numbers below were verified 2026-07-11 but the repo moves;
   re-locate with grep before each edit.
2. **No new libraries, no build step.** Vanilla CSS/JS only. Keep everything in
   `css/styles.css` (single file, single HTTP request) and existing JS files.
3. **Never hand-edit versions/cache**: the pre-commit hook bumps `APP_VERSION` + `CACHE_VER`.
4. **Performance budget (hard):**
   - `backdrop-filter` allowed ONLY in the Astral theme and only on topbar/modals/bottom-nav.
     Light & Dark themes use solid/95%-opaque backgrounds — zero blur.
   - Continuous animations (mesh drift, aurora, starfield twinkle) run ONLY in Astral, and are
     disabled under `@media (prefers-reduced-motion: reduce)`.
   - No new fonts beyond the existing Inter import. No images for patterns — CSS gradients/
     `radial-gradient` dots only (or one tiny inline SVG data-URI ≤ 1 KB).
   - Touch/scroll listeners added in this WS must be `{ passive: true }` except where
     `preventDefault` is required (edge-swipe), and that one is scoped to a 24px edge strip.
   - Transitions: `transform`/`opacity` only for anything animating on scroll/gesture.
5. **Every phase ends with:** `node --check` on each touched JS file; preview on port 3838
   (launch config `app`); zero new console errors; no horizontal page scroll at 375px.
6. **Escape user content** with `escHtml()`; Manila-time helpers for dates; all existing
   functional behavior (handlers, Firestore calls, ids used by JS) must be preserved —
   this WS is presentation + interaction only. **No Firestore rules changes.**
7. Commit at the end of each batch with message `v12 WS42 batch X: <summary>`.

## Current-state anchors (verified)

- `css/styles.css` (~4700 lines): token-based. `:root` = the old "premium dark glass" theme
  (lines 14–155): `--bg/--s0..--s3/--glass/--surface/--primary/--border/--text*/--sh*/--r*`,
  layout vars (`--topbar-h:56px`, `--sidebar-w:258px`, `--bottom-nav-h:52px`,
  `--top-nav-h:50px`), type scale `--fs-*`, motion vars, component-bg vars
  (`--topbar-bg`, `--sidebar-bg`, `--modal-bg`, …), `--brand-primary` role aliases,
  `--theme-color` (synced to `<meta theme-color>` by `setTheme`).
- Themes today (`js/app.js:832–886`): `THEMES = { auto, office (light Fluent), midnight }`
  plus legacy classes `theme-pink`/`theme-grey` still referenced in CSS. Default `office`.
  `setTheme` removes `['light','theme-office','theme-midnight','theme-pink','theme-grey']`,
  adds the new class, persists `localStorage['bi-theme']`, dispatches `bi-theme-change`,
  syncs `<meta theme-color>` from `--theme-color`. Theme picker buttons at app.js:7624.
- Light overrides exist as ~hundreds of `html.light .foo, html.theme-pink .foo, …` literal
  rules scattered through styles.css (e.g. 667–681, 1569–1593, 3812). This is the main tech
  debt this WS removes: components must read tokens, themes must only redefine tokens.
- Shell (v12 WS41, Facebook-inspired): topbar (`#topbar-avatar`, `#topbar-menu-btn`,
  `#topbar-depts-btn`, `#topbar-chat-btn`), `buildNav()` at app.js:897 →
  `buildSidebarNav() / buildBottomNav() / buildTopNavStrip()`; bottom-nav arrays in
  `js/config.js:293–345` (`BOTTOM_NAV_ITEMS`, `PRESIDENT_BOTTOM_NAV`, `PARTNER_*`,
  `BRILLIANT_*`) already using Lucide names.
- Back/overlay system: `window.Overlay` (config.js:859) — push/dismissTop wired to real
  browser history (WS10). Chat threads, dialogs, drawers all push onto it. **Gestures must
  call `window.Overlay.dismissTop()` / `history.back()` — never invent a parallel stack.**
- Chat: `js/chat.js` (800 lines) — `window.Chat` IIFE + `window.renderChatPage`. Firestore
  `conversations/{id}/messages`. Existing CSS `.messenger-wrap/-header/-body/-empty/
  -input-row` (styles.css 3708–3820) shared with task-chat in departments.js:2142.
  Typing indicator + readers already exist.
- Icons: `DEPARTMENTS` in config.js:139–186 each have `icon` (emoji), `lucideIcon`, `color`.
  `lucideIconHtml(glyph)` + emoji→Lucide map at config.js:191–207 with `.emoji-icon`
  fallback. **545 raw emoji remain in departments.js**, more in modules.js/app.js.
- `index.html`: `viewport-fit=cover` already set (line 5); `theme-color` #FAF9F8 (line 8);
  single stylesheet `css/styles.css` (line 29).
- Safe-area: `env(safe-area-inset-top)` used in ~10 places; bottom/left/right coverage is
  incomplete (audit in Phase 11).

---

# THE 30 PHASES

## BATCH A — Theme foundation (Phases 1–5)

### Phase 1 — Semantic token consolidation
Goal: one complete semantic token contract that all three themes redefine; components stop
referencing raw palette vars.

- In `:root`, add/normalize this **semantic set** (keep existing names working as aliases —
  do NOT delete vars still referenced):
  `--bg` (app canvas) · `--bg-2` (inset/wells) · `--surface` (cards) · `--surface-2` (hover)
  · `--surface-3` (active) · `--border` · `--border-strong` · `--text` · `--text-2` ·
  `--text-muted` · `--primary` (interactive accent) · `--primary-soft` (10–12% tint bg for
  selected pills) · `--on-primary` · `--success/--warning/--danger/--info` (+ `-soft` tints)
  · `--sh-sm/--sh/--sh-lg` · `--r-sm:10px --r:14px --r-lg:18px --r-xl:24px --pill:999px` ·
  `--topbar-bg --sidebar-bg --bottom-nav-bg --modal-bg --drawer-bg --notif-bg
  --login-card-bg` · `--chat-bg --bubble-in-bg --bubble-in-text --bubble-out-bg
  --bubble-out-text` (new, for chat) · `--theme-color`.
- Map legacy vars to semantics: `--s0→--bg-2`, `--s1→--surface`, `--s2→--surface-2`,
  `--s3→--surface-3`, `--surface2→--surface-2` (keep the old names defined = same values).
- Grep JS for inline `var(--...)` usages (app.js/departments.js/modules.js/chat.js build HTML
  with inline styles) and list every token referenced; ensure each is in the contract.
- Acceptance: app renders pixel-identical (this phase changes definitions, not visuals).

### Phase 2 — Light theme (new default): "Fluent × Drive minimal"
Goal: `html.light` becomes a pure token override block near the top of styles.css; kill the
scattered per-component light rules progressively (each later phase deletes the ones for the
components it restyles; Phase 28 sweeps the rest).

Exact palette (Google-Drive-meets-Fluent, FB blue accent):
```
--bg:#F7F8FA; --bg-2:#EFF1F4; --surface:#FFFFFF; --surface-2:#F2F4F7; --surface-3:#E8EBEF;
--border:rgba(16,24,40,0.10); --border-strong:rgba(16,24,40,0.18);
--text:#1C1E21; --text-2:rgba(28,30,33,0.72); --text-muted:rgba(28,30,33,0.48);
--primary:#0866FF; --primary-soft:rgba(8,102,255,0.10); --on-primary:#FFF;
--success:#1B873F; --warning:#B54708; --danger:#D92D20; --info:#0866FF;
--sh-sm:0 1px 2px rgba(16,24,40,0.06); --sh:0 2px 8px rgba(16,24,40,0.08);
--sh-lg:0 12px 32px rgba(16,24,40,0.14);
--topbar-bg:#FFFFFF; --sidebar-bg:#F7F8FA; --bottom-nav-bg:rgba(255,255,255,0.97);
--modal-bg:#FFFFFF; --drawer-bg:#FFFFFF; --notif-bg:#FFFFFF; --login-card-bg:#FFFFFF;
--chat-bg:#FFFFFF; --bubble-in-bg:#F0F2F5; --bubble-in-text:#1C1E21;
--bubble-out-bg:linear-gradient(135deg,#0866FF,#0A7CFF); --bubble-out-text:#FFF;
--theme-color:#FFFFFF;
```
- Flat, airy: cards = white on #F7F8FA with 1px border + `--sh-sm`; hover lifts to `--sh`.
  No glass, no blur, no gradients on surfaces.
- Body text color/scrollbars/selection restyled via tokens.

### Phase 3 — Dark theme: "Messenger dark minimal"
New class `theme-dark` (neutral, NOT the old glass):
```
--bg:#0F1114; --bg-2:#0A0C0E; --surface:#1A1D21; --surface-2:#24282D; --surface-3:#2E333A;
--border:rgba(255,255,255,0.09); --border-strong:rgba(255,255,255,0.16);
--text:#E4E6EB; --text-2:rgba(228,230,235,0.72); --text-muted:rgba(228,230,235,0.45);
--primary:#4599FF; --primary-soft:rgba(69,153,255,0.14); --on-primary:#FFF;
--success:#31A24C; --warning:#F7B928; --danger:#F0284A; --info:#4599FF;
--topbar-bg:#16181B; --sidebar-bg:#121417; --bottom-nav-bg:rgba(22,24,27,0.97);
--modal-bg:#1A1D21; --drawer-bg:#16181B; --notif-bg:#1A1D21; --login-card-bg:#1A1D21;
--chat-bg:#0F1114; --bubble-in-bg:#2E333A; --bubble-in-text:#E4E6EB;
--bubble-out-bg:linear-gradient(135deg,#0866FF,#0A7CFF); --bubble-out-text:#FFF;
--theme-color:#16181B;
```
Solid surfaces, subtle borders, no glow shadows, no mesh background (`body::before/::after`
mesh layers get `display:none` under `html.theme-dark` and `html.light`).

### Phase 4 — Astral theme + switcher migration
- New class `theme-astral` = the showpiece: today's `:root` cosmic look, refined — deep-space
  `#070710` canvas, the existing `meshDrift` aurora layers, ADD a CSS starfield (two
  `radial-gradient` dot layers, `background-repeat`, slow `transform` parallax — cheap), glass
  chrome (`backdrop-filter: blur(18px)` on topbar/modal/bottom-nav ONLY), lavender/pink/gold
  accents (keep current `:root` values), gradient buttons.
- **Token strategy:** make `:root` = Light values? NO — keep `:root` as base defaults and
  have all THREE themes as explicit override blocks (`html.light`, `html.theme-dark`,
  `html.theme-astral`); `:root` keeps astral-ish values as fallback but `initTheme` always
  applies a class, so effectively every session has an explicit theme.
- `js/app.js` THEMES map becomes:
  `auto` (OS scheme → `light` / `theme-dark`) · `light` ("Light") · `dark` ("Dark") ·
  `astral` ("Astral"). Migration in `initTheme`: stored `office|pink|grey → light`,
  `midnight → dark`, missing → `light` (default stays light per 2026-07-08 decision).
  Keep removing legacy classes in `setTheme` so old sessions clean up.
- Theme picker (app.js:7624 region): three preview cards (mini mock: canvas+card+accent dot
  rendered with each theme's actual colors) + Auto toggle. Lucide icons: `sun`, `moon`,
  `sparkles`.
- Update `<meta name="theme-color">` default in index.html to `#FFFFFF`.

### Phase 5 — Type, radius, shadow & density normalization
- Global: body `--fs-base:14px`, `--lh-base:1.5`; page titles use `--fs-3xl/600`; card titles
  `--fs-lg/600`; section labels 12px/600/uppercase/`--text-muted` letter-spacing .04em.
- Radii: inputs/buttons `--r-sm`, cards `--r`, modals/sheets `--r-lg`, avatars/pills `--pill`.
- Sweep styles.css for hard-coded `border-radius`/`box-shadow`/font-size px literals in the
  first ~1000 lines (global elements) → tokens. (Component-specific sweeps happen in their
  own phases.)
- Focus states: universal `:focus-visible { outline:2px solid var(--primary); outline-offset:2px }`.

## BATCH B — Shell & components (Phases 6–10)

### Phase 6 — Topbar (Facebook style)
- 56px; Light/Dark: solid `--topbar-bg` + bottom 1px `--border` (no blur); Astral keeps glass.
- Left: circular 36px brand logo + two-line brand (hide sub-line under 480px). Center
  (desktop ≥1024px only): the existing top-nav strip becomes FB-style icon tabs — 48px-wide
  icon buttons with 3px bottom active indicator in `--primary`, tooltip labels.
- Right: 36px circular icon buttons (`--surface-2` bg, hover `--surface-3`): search, depts
  grid (`layout-grid`), chat, bell with badge, avatar menu. Badges: 16px `--danger` pill,
  white 10px text.
- Keep all existing ids/handlers (`topbar-depts-btn`, `topbar-chat-btn`, avatar, menu-btn).

### Phase 7 — Sidebar (Drive/OneDrive style, desktop)
- `--sidebar-w:264px`, bg `--sidebar-bg`, NO border between sidebar and canvas in Light
  (Drive look), 1px border in Dark/Astral.
- Nav items: 36px rows, 8px radius **full-pill on active** (`--primary-soft` bg +
  `--primary` text/icon, like Drive's selected item), hover `--surface-2`. 20px Lucide icons
  stroke-width 2. Section headers per Phase 5 label style. Department items show their
  16px dept color dot or mini tile (Phase 21 system).
- Collapse behavior unchanged; just restyle.

### Phase 8 — Bottom nav (mobile, FB style)
- Height `calc(var(--bottom-nav-h) + env(safe-area-inset-bottom))`, padding-bottom the inset;
  `--bottom-nav-h:56px`. Solid `--bottom-nav-bg` + top border (blur only in Astral).
- Items: ≥44px touch targets, 24px icons, 10px labels, active = `--primary` icon+label with a
  small 4px top indicator bar (FB style); inactive `--text-muted`. Badge dots supported.
- Press feedback: `transform: scale(0.92)` on `:active`, 120ms.

### Phase 9 — Core components: cards, buttons, inputs, chips, tables
- Cards: `--surface`, 1px `--border`, `--r`, `--sh-sm`; hover (pointer devices only, wrap in
  `@media (hover:hover)`) `--sh` + border-strong. Kill gradient card borders/glow outside Astral.
- Buttons: primary = solid `--primary`/`--on-primary`, `--r-sm`, 36px (40px on touch), no
  gradient in Light/Dark (Astral may keep gradient primary); secondary = `--surface-2` +
  border; ghost = transparent hover `--surface-2`; destructive = `--danger`. Consistent
  padding 0 14px, `--fs-base` 600.
- Inputs/selects/textareas: `--surface` bg (Light: #FFF; Dark: `--surface-2`), 1px border,
  `--r-sm`, 38px, focus ring `--primary` (border + 3px `--primary-soft` ring). **16px font on
  touch devices** (`@media (pointer:coarse)`) to stop iOS zoom.
- `.chip-tabs/.chip-tab/.chip-count`: pills, active = `--primary-soft` bg + `--primary` text
  (FB filter-chip look); count pill inherits.
- Tables: header row `--bg-2` sticky, row hover `--surface-2`, 1px row borders; EVERY table
  already should sit in a scroll wrapper — restyle `.table-scroll` (thin scrollbar, edge fade).
- Delete the corresponding `html.light …` legacy overrides for everything restyled here.

### Phase 10 — Modals, drawers, sheets, toasts
- Desktop modals: centered, `--modal-bg`, `--r-lg`, `--sh-lg`, 1px border; backdrop
  `rgba(0,0,0,.4)` (Light) / `.6` (Dark/Astral); sizes default/wide/full preserved
  (`openModal` opts untouched).
- **Mobile (<640px): modals become bottom sheets** — slide up from bottom, top corners
  `--r-xl`, 36×4px grab handle, `max-height: calc(100dvh - env(safe-area-inset-top) - 24px)`,
  internal scroll, `padding-bottom: env(safe-area-inset-bottom)`. CSS-only transform
  (existing modal markup; add `.modal-sheet` styles keyed off the breakpoint).
- Drawers (notifications, dept switcher): same sheet treatment on mobile, right-side panel
  on desktop.
- Toasts: pill, `--surface` + border + `--sh-lg`, colored 20px status icon instead of full
  colored background (keep `--toast-*` vars pointing at the new looks so notifications.js
  needs no edit); position above bottom-nav + safe-area on mobile.

## BATCH C — Mobile & gestures (Phases 11–15)

### Phase 11 — Safe-area & notch audit (all four insets)
- Grep every `position:fixed|sticky` block in styles.css; each must account for the relevant
  `env(safe-area-inset-*)`. Known gaps: toasts, FABs, `.page-panel` bottom, chat composer,
  modals' sheet mode, landscape left/right insets (`padding-left/right:
  max(12px, env(safe-area-inset-left/right))` on topbar, bottom-nav, page content).
- `background-color` behind the notch: html/body bg = `--bg` so overscroll/notch areas match;
  `overscroll-behavior-y: none` on body (prevents pull-to-refresh fighting the SPA),
  `-webkit-tap-highlight-color: transparent`.
- Use `100dvh` instead of `100vh` everywhere it appears (URL-bar-safe).

### Phase 12 — Gestures: edge swipe-back + sheet swipe-dismiss
New file **`js/gestures.js`** (add to index.html after config.js, before app.js; add to
sw.js PRECACHE — hook bumps CACHE_VER):
- **Edge swipe-back (Android/iPhone parity):** touchstart within 24px of left edge →
  track horizontal drag; if dx > 70px && |dy| < 40px on touchend → if `window.Overlay` stack
  non-empty call `Overlay.dismissTop()`, else `history.back()`. Visual affordance: a small
  chevron pill that follows the finger (single reused DOM node, transform-only). touchmove
  listener non-passive ONLY while a drag started in the edge strip is active.
- **Sheet swipe-dismiss:** on mobile sheets (Phase 10) drag the grab-handle/header down;
  >120px or velocity flick → `Overlay.dismissTop()`; else spring back (transform transition).
- Both disabled when `matchMedia('(pointer:fine)')` and inside horizontally-scrollable
  elements (check `closest('[data-hscroll], .table-scroll')`).
- Expose `window.Gestures = { enable, disable }` for chat thread to reuse.

### Phase 13 — Touch ergonomics
- Audit interactive elements for ≥44×44px effective target on `pointer:coarse` (padding or
  ::after hit-area expansion for small icon buttons: nav icons, chip close, table row actions).
- `touch-action: manipulation` on buttons/links (kills 300ms-ish delays / double-tap zoom).
- Momentum scrolling `-webkit-overflow-scrolling:touch` on all internal scrollers; hide
  scrollbars on mobile scrollers, thin elsewhere.
- Active-state feedback (scale/opacity) standardized via a `.pressable` utility applied in
  shell + list rows.

### Phase 14 — Overflow & cut-off audit (phones)
- At 360/375/390/414px: walk every route in `navigateTo`'s switch (grep the case list) and
  fix horizontal overflow: long unbroken strings (`overflow-wrap:anywhere` on card bodies,
  chat bubbles, table cells), grids that don't collapse (`repeat(auto-fill,minmax(…))`
  audit), fixed-width modals/forms → `width:min(…, calc(100vw - 32px))`, stat-tile rows →
  2-col grid on phones, chip bars wrap (they do — verify).
- Global guard: `#page-content { overflow-x: clip }` plus per-widget fixes (never rely on the
  guard alone — find the actual offenders with a DevTools-style JS probe in preview:
  `[...document.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+1)`).

### Phase 15 — iPad / tablet tier
- Add a real 640–1023px tier: sidebar hidden (bottom nav shown) in portrait ≤ 819px; from
  820px–1023px show a **72px icon rail** (icons only, tooltips) instead of full sidebar;
  ≥1024px full sidebar (current behavior).
- Dashboard/stat grids: 2-col on tablet, 3–4 on desktop; modals `wide` caps at
  `min(920px, calc(100vw - 48px))`.
- Chat page: ≥1024px splits into Messenger-style two-pane (320px inbox + thread); below that
  single-pane with overlay thread (current behavior).

## BATCH D — Messenger-grade chat (Phases 16–20)

### Phase 16 — Inbox (chat list) restyle
`renderChatPage` + `_attachInbox` markup (chat.js:696+):
- Rows: 56px avatar-led (44px round avatar w/ dept-gradient fallback initials), name 15px/600,
  preview 13px `--text-muted` single-line ellipsis, right-aligned relative time; **unread =
  bold name/preview + 8px `--primary` dot** (FB pattern); active-now = 10px green dot with
  2px `--surface` ring on the avatar (presence data exists — `lastSeen` TTL like Team view).
- Pill search field on top ("Search chats"), chip filters (existing chips) below it.
- Row press feedback + hover per Phase 13/9.

### Phase 17 — Thread bubbles (the Messenger look)
Rewrite the message-list renderer's classes/CSS (chat.js:560 region; keep data flow +
listeners untouched):
- Bubbles `max-width:72%` (85% <400px), padding 8px 12px, `--fs-base`/`--lh-snug`.
- **Grouping:** consecutive messages from the same sender within 2 min form a group — radius
  logic: own messages right-aligned, `18px` corners except the shared side (4px between
  group members: first = 18 18 4 18, middle = 18 4 4 18, last = 18 4 18 18; mirrored for
  incoming). Avatar (24px) shown once per incoming group, bottom-aligned.
- Own bubbles: `--bubble-out-bg` gradient, `--bubble-out-text`; incoming: `--bubble-in-bg`.
  Astral may use pink→blue gradient for own bubbles.
- **Day separators** ("Today", "Yesterday", else `Mon, Jul 7` — via `bizDate`) and FB-style
  time-gap separators (>20 min) centered 11px `--text-muted`.
- Tap a bubble → toggles a timestamp/status line under it (mobile); hover shows it (desktop).
  Read receipts: tiny 14px avatar(s) of readers at the last-read message (readers listener
  exists), fallback ✓✓ glyphs via Lucide `check`/`check-check`.
- Link/file/image messages restyled as rounded attachment cards inside the bubble.

### Phase 18 — Chat wallpapers (bg theme/pattern)
- `--chat-bg` painted on `.messenger-body` + a **wallpaper layer**: presets, all CSS-only:
  `default` (plain `--chat-bg`) · `doodle` (subtle repeating radial-dot lattice, 3–4% ink) ·
  `gradient-blue` (FB blue→purple soft) · `gradient-sunset` (pink→gold) · `astral`
  (starfield dots on deep navy). Each defined for light+dark (ink color flips).
- Per-conversation persistence: `conversations/{id}.wallpaper` (string key) — a small
  "Wallpaper" option in the thread header ⋮ menu writes it (participants can write the conv
  doc already — verify rule; if participants can't update, fall back to
  `localStorage['bi-chat-wp-<convId>']` and note it in the batch report. **No rules edits.**)
- Bubble contrast guard: when a gradient wallpaper is active, incoming bubbles get a solid
  `--surface`-based bg + border so text never sits on the gradient.

### Phase 19 — Composer (Messenger input row)
- `.messenger-input-row` → pill textarea (auto-grow to 5 lines) in `--surface-2`, circular
  36px icon buttons: attach (`paperclip`), send (`--primary` filled circle, Lucide
  `arrow-up`/`send`, disabled until text/file). Emoji stays native keyboard.
- Sits above `env(safe-area-inset-bottom)`; on-screen-keyboard handling: use
  `visualViewport.resize` to keep composer + last message visible (scroll anchor), no layout
  jump. Typing indicator restyled as an incoming mini-bubble with 3 bouncing dots
  (CSS animation, pauses under reduced-motion).
- Send micro-interaction: bubble pops in with 150ms scale/opacity (transform-only).

### Phase 20 — Chat mobile shell + task-chat parity
- Thread on mobile: true fullscreen (100dvh), header 56px with 44px back button (also edge
  swipe-back via Gestures), avatar+name+active-status; safe-area top/bottom.
- Two-pane desktop layout from Phase 15 verified with the new components.
- **Task chat** (departments.js:2142 `messenger-wrap` in the task panel) and any other
  `.messenger-*` consumers inherit the new bubble/composer/wallpaper CSS automatically —
  verify classes match; adjust its markup minimally if class names diverge.
- Remove the old `html.light .messenger-body …` overrides (3812 region) — token-driven now.

## BATCH E — Icons & key screens (Phases 21–25)

### Phase 21 — BI icon-tile system
- New utility `window.deptIconTile(deptKeyOrObj, size)` in config.js: returns a rounded
  **squircle tile** (`--r-sm`, size 28/36/44) with a per-dept **duotone gradient** derived
  from `DEPARTMENTS[].color` (linear-gradient of color → color lightened ~18%; precompute a
  `gradient` field per dept in DEPARTMENTS rather than computing at runtime) and the dept's
  white Lucide icon centered (stroke-width 2.25). This is the "unique to BI" icon language —
  used for: sidebar dept items, dept switcher grid, dashboard dept cards, chat channel
  avatars, approvals type badges.
- Refresh `DEPARTMENTS[].color` to a harmonized modern set (keep hue identity):
  Admin #3B5BDB · Finance #2F9E44 · HR #E64980 · Sales #F76707 · Marketing #D6336C ·
  Gov Biddings #0CA678 · IT #1C7ED6 · Design #7048E8 · Production #A05A2C ·
  Purchasing #099268 · Brilliant Steel #495057 · Partners #1971C2.
- Generic pattern `iconTile(lucideName, colorA, colorB, size)` exposed for non-dept uses.

### Phase 22 — Emoji sweep: departments.js (~545)
- Replace raw emoji rendered into UI chrome (headers, buttons, tabs, empty states, badges)
  with `lucideIconHtml('<emoji>')` (extend the EMOJI→Lucide map in config.js for every glyph
  encountered — enumerate first with the grep from the recon:
  `grep -on "[emoji-ranges]" js/departments.js | sort | uniq -c`).
- KEEP emoji inside user-generated content and inside notification message TEXT (those go to
  FCM). Only chrome changes. After the map covers a glyph, `lucide.createIcons()` must run
  after each affected render — verify the render fns already call it (most do; add where not).

### Phase 23 — Emoji sweep: modules.js, app.js, chat.js + notification inbox icons
- Same treatment for modules.js (Posts/Team/Attendance/CA/Company) and remaining app.js
  spots (dashboard, approvals, search), chat.js chips.
- Notification inbox rows: icon column becomes a colored icon-tile (Phase 21 generic) mapped
  from notification type; strip leading emoji from titles is already done — extend to the
  new mapping.

### Phase 24 — Dashboard restyle (FB feed × Apple widgets)
- Greeting header (name, date, weather-free), then **widget grid**: stat tiles (Apple-style:
  big number `--fs-5xl`/700, 13px label, icon-tile top-right, sparkline where Chart.js data
  already exists), tasks-due card, approvals card, EOM banner, calendar — all `--surface`
  cards per Phase 9, 12px gap, `grid-template-columns: repeat(auto-fit, minmax(160px,1fr))`
  for tiles, single column feed <640px.
- Kill remaining gradient/glow hero cards outside Astral. Charts re-themed via a
  `bi-theme-change` listener updating Chart.js default colors (grid `--border`, ticks
  `--text-muted`) — one helper, applied where charts are created.

### Phase 25 — Login & splash
- Login: minimal Apple-style — centered 380px card (`--login-card-bg`), circular logo, big
  title, segmented portal picker (Admin/Employee/Partner as a 3-segment control), inputs per
  Phase 9, primary button full-width; Light default; Astral variant gets the aurora bg.
  Version line small `--text-muted`.
- Splash: keep circular logo; simple fade/scale in Light/Dark; Astral keeps the fancy
  animation. Splash bg = `--bg` from the persisted theme (read localStorage in the inline
  head script that already exists for theme-color — verify; if not present, add a tiny
  pre-CSS class application in index.html `<head>` so there's no light/dark flash).

## BATCH F — Motion, performance, QA (Phases 26–30)

### Phase 26 — Motion system
- Standardize: page enter = 160ms fade/4px-rise on `#page-content > *` (once per navigate,
  transform/opacity only); sheet/modal/drawer springs via `--ios-enter`; list stagger capped
  at first 8 items.
- `@media (prefers-reduced-motion: reduce)`: kill all non-essential animation globally
  (single rule: `*,*::before,*::after { animation-duration:.01ms !important;
  transition-duration:.01ms !important }` + opt-outs for opacity-only fades if needed).
- Remove always-running animations outside Astral (grep `animation:` in styles.css; anything
  infinite must be Astral-scoped or interaction-triggered).

### Phase 27 — Performance pass
- `content-visibility:auto; contain-intrinsic-size` on heavy list rows (task lists, ledger
  tables, chat inbox rows, team grid) — verify no layout jump.
- Confirm blur budget (grep `backdrop-filter` — every hit must be inside
  `html.theme-astral` scope or removed).
- Font: add `<link rel="preconnect">` for fonts.googleapis.com/gstatic in index.html; keep
  `display=swap`.
- styles.css hygiene: delete now-dead legacy theme blocks (`theme-pink`, `theme-grey`,
  `theme-midnight`, `theme-office` selectors once the migration maps them away — KEEP the
  class names being removed in setTheme's cleanup list), target ≤ current file size.
- Measure: preview → Performance-ish sanity via `read_console_messages` clean + scripted
  scroll of the heaviest screen; document before/after styles.css byte size in the report.

### Phase 28 — Cross-theme QA sweep
- Script a probe: for each of the 3 themes, walk pre-login surfaces + (post-login screens are
  limited headlessly — do static analysis instead): grep styles.css + JS template literals
  for **hard-coded hex colors** in inline styles; convert stragglers to tokens (allowlist:
  brand logo colors, dept gradient data, chart series palettes).
- Contrast: verify text-on-surface pairs ≥ 4.5:1 in Light and Dark (spot-check computed
  values via javascript_tool on the preview).
- Every remaining `html.light .foo` compound legacy rule either deleted or consciously kept
  (list survivors in the batch report — target: zero except Company-Overview print styles).

### Phase 29 — Cross-device QA
- `resize_window` sweep: 360×740, 375×812 (notch), 390×844, 414×896, 768×1024, 820×1180,
  1024×768, 1280×800 — on each: no horizontal scroll, topbar/bottom-nav intact, safe-area
  padding present (simulate via forcing `--safe-*` fallbacks? env() can't be simulated —
  instead verify the calc() chains exist via computed styles), modals fit, chat composer
  visible.
- Fix everything found; rerun until clean.

### Phase 30 — Integration, docs, handoff
- sw.js PRECACHE includes `js/gestures.js`; `node --check` all touched JS; full preview pass
  (console clean, globals present: `Gestures`, `deptIconTile`, THEMES keys).
- Docs: V12-PLAN.md build-log entry (WS42 IMPLEMENTED), ROADMAP.md session note, update the
  in-app help text that references "sun/moon icon" (app.js:8235) to the new theme picker.
- Final local commit; produce the diffstat + a list of anything deferred/flagged for Neil.
  **Do not push.**

---

## Batch acceptance gate (run after EACH batch)
1. `node --check js/*.js` (touched files) — pass.
2. Preview port 3838: zero console errors; login screen renders; theme switching cycles all
   three + auto without layout breakage.
3. 375px width: no horizontal page scroll on login + (where reachable) dashboard.
4. `git add -A && git commit -m "v12 WS42 batch X: …"` (hook bumps version/cache).
5. Report back: what changed, file/line highlights, anything ambiguous escalated, survivors
   deferred to Phase 28.
