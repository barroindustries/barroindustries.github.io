# Workstream 17 — Design-System Consolidation

*Grounding brief — facts only. Resolve every open decision below, then replace the
checklist with `**DECIDED:**` + your spec (exact enough for Sonnet to implement with no
further judgment calls: function signatures, before/after code, data shapes, migration
steps, exact `firestore.rules` diffs where relevant).*

## Current state

REPO: v12 branch, /Users/neilbarro/.../Operation Systems Development. css/styles.css is 4,633 lines. The audit's 'override-stacked CSS' claim is literal and self-documented in the file, not inferred:

1) THREE stacked cascade layers, each redefining the same base selectors, with the codebase itself calling this out in banner comments:
   - Layer 0 'BARRO INDUSTRIES — Operations System v3, Premium Dark Design System' (styles.css:1-3245) — defines the base :root token block (styles.css:13-126: 44 named tokens — palette, gradients, surfaces s0-s3, borders, text, shadows sh-xs..sh-lg, radius r-xs..r-2xl+pill, layout, font, motion/--ease/--t1-3, component-bg aliases, toast tokens).
   - Layer 1 'LIQUID GLASS — Design Layer v1' (styles.css:3246-3251 banner: 'Written as cascade overrides — all prior rules still apply.') redefines .topbar (3295, dup of 801), .card (3345, dup of 1418), .subtab-btn (dup of 1826), plus adds new --glass-* tokens (3251-3266).
   - Layer 2 'iOS DESIGN OVERHAUL — v1' (styles.css:3834-3838 banner: 'Appended as cascade layer — overrides prior rules on cascade.') redefines .page-header (3855, dup of 1267), .kpi-value (4009, dup of 1326 AND already redefined once in Layer1-era comments at 3158-3159), .bottom-nav (4041, a THIRD definition — also at 1213 and 3487), and even re-overrides shared tokens inside a second :root block (3841-3852): --ease, --r, --r-sm, --r-lg, --r-xl literally reassigned a second time with a comment 'Override default ease with iOS standard.'
   Grep counts confirm the duplication: '.modal-box' appears in 12 rule lines (base block at 2104 + a full second copy at 3399, plus ::before/::after variants at 2120/3407/3945); '.bottom-nav' in 44 rule lines across 3 base redefinitions (1213, 3487, 4041) plus per-theme overrides; '.card'/.topbar/.page-header/.subtab-btn each defined twice.
   None of this is theoretical fragility — it is real: because every redefinition uses the *same selector at the same specificity*, correctness depends entirely on file order. Reordering, or inserting new rules between layers, silently changes rendered output with no error.

2) Theme mechanism (fully client-side, no Firestore involvement): js/app.js:770-777 defines `const THEMES = { office:{label:'Office',cls:'light theme-office'}, dark:{label:'Obsidian',cls:null}, midnight:{label:'Midnight',cls:'theme-midnight'}, light:{label:'Aurora',cls:'light'}, pink:{label:'Astral',cls:'theme-pink'}, grey:{label:'Slate',cls:'theme-grey'} }`. `setTheme(theme,persist=true)` (app.js:785-793) strips all theme classes off `<html>` then adds the target's `cls`; persists to `localStorage['bi-theme']` (default 'office', app.js:782/796). `toggleTheme()` (799-803) cycles a fixed array. `_applyThemeIcon` (805-811) swaps the header sun/moon `<i data-lucide>` icon only — it does NOT touch the `<meta name="theme-color">` tag. The theme picker UI is 6 buttons with `data-theme` attrs (app.js:6924-6930, 'theme-swatch' class) wired at app.js:7002-7015 by `getTheme()`/`setTheme()`+click listener — pure DOM, no widget framework.
   Class-per-theme approach: html.light, html.theme-office, html.theme-pink, html.theme-grey each get a full `:root`-style custom-property re-declaration (e.g. html.theme-office block at styles.css:2444-2513 remaps ~35 tokens including --pink/--blue/--primary all to Microsoft blue #0F6CBD, --r-* to Fluent's tighter 3-12px scale, --font to Segoe UI). html.theme-midnight (2332) and html.theme-pink (2659) and html.theme-grey (2717) do the same. This part of the token system is actually clean.
   BUT: separately, ~166-167 individual component-level override rules exist as grouped selectors `html.light .foo, html.theme-pink .foo, html.theme-grey .foo { ... }` (grep -c 'html\.light'=166, 'html\.theme-pink'=167, 'html\.theme-grey'=167 — nearly 1:1, confirming light/pink/grey are treated as a family) scattered across the file (e.g. styles.css:640-654 Company page, 1576-1618 ID cards, 2535-2552 login chrome, 3679-3820 messenger). These exist because ~166 components hardcode literal rgba()/hex values instead of consuming semantic tokens, forcing a parallel per-theme patch for each. THIS is the real duplicate-design-pass burden, not the base palette swap.

3) theme-color / manifest mismatch (concrete, already broken): index.html:8 `<meta name="theme-color" content="#FAF9F8"/>` (static, matches the Office/light bg) vs manifest.json `"theme_color": "#0a0a0a"` (static, matches the dark/Obsidian bg) — these two already disagree with each other, and neither updates when `setTheme()` runs. No `prefers-color-scheme` media query exists anywhere in css/styles.css or js/*.js (grep returned zero matches) — there is currently no 'Auto/System' theme option at all; every theme is 100% manual, localStorage-only (never written to any Firestore `users/{uid}` field — grep for 'bi-theme'/'themePref' outside app.js:319/782/791/796 found nothing).

4) Emoji-as-icon sizing: python3 Unicode-range scan (pictographs U+1F300-1FAFF, misc symbols/dingbats U+2600-27BF, regional indicators, misc-symbols-and-arrows U+2B00-2BFF) across js/app.js, departments.js, modules.js, config.js, notifications.js, drive.js found 1,160 emoji occurrences (app.js 292, departments.js 690, modules.js 139, config.js 14, notifications.js 21, drive.js 4) — matches the audit's ~1,100 figure. Top offenders: ✅99, ✓55, 📋53, 🗑53, ⚠35, ❌33, 📄32, 💸31, 🧾28, ✗27, 📊26, 📅25.
   CRITICAL NUANCE: the emoji migration is only PARTIAL scope, not a blank slate — Lucide is already loaded (index.html:295, unpkg.com/lucide@0.468.0, deferred, after Chart.js per the mandatory load order) and already used for: bottom-nav items (js/config.js:144-176, the `*_BOTTOM_NAV` arrays store Lucide icon-name strings like 'home','check-square','megaphone', NOT emoji) and the theme-toggle button icon (app.js:805-811, `<i data-lucide="${sun|moon}">`). What's still raw emoji: `window.DEPARTMENTS` config (js/config.js:70-121, e.g. Admin icon:'🏢', Finance icon:'💰', HR icon:'👥', Sales/Partners icon:'🤝', Marketing icon:'📢', Gov Biddings icon:'🏛️', IT icon:'💻', Design icon:'🎨', Production icon:'🏭', Purchasing icon:'🛒', Brilliant Steel icon:'⚙️') consumed as raw text at 6+ call sites (app.js:911 nav item build, 3318 dept card, 3919-3920 page-header+empty-state fallback, 5116, 6040 dept-icon-large; departments.js:606) — plus per-department accent hex colors (config.js:72-118, e.g. '#1a237e') stored as a THIRD independent color source alongside the CSS :root palette and the print-window inline styles. Also still-emoji: page-header prefixes (`<h2>📋 Submissions</h2>`, departments.js:1209), icon-only buttons (`<button ...>🗑</button>`, departments.js:744/1734), empty-state icons, and the `icon` field written into `notifications/{uid}/items/{id}` docs (departments.js:217,252,871,1312,1649; notifications.js:251 `send(...,{icon='🔔'...})`, 569 icon:'⏰', 593 icon:'🌅', 619 icon:'📦'). That `icon` field is rendered client-side only in the in-app inbox list (notifications.js:114-118: `const icon = n.icon || lead || '🔔'; ... <div class="notif-item-emoji">${escHtml(icon)}</div>`) — the actual OS-level FCM push icon is a separate, unrelated static asset (functions/index.js sends a data-only FCM payload with no `notification` block; firebase-messaging-sw.js:59 hardcodes `icon: '/icons/icon-192.png'`), so this Firestore-persisted emoji field is safely swappable without touching the Cloud Function or push behavior — but OLD persisted notification docs already have emoji strings in `icon`, so any rendering change must tolerate legacy values.

5) KPI auto-fit feature (must survive untouched or be re-verified): `window.fitKpiValues` (app.js:7103-7131, added/extended by the two most recent commits on this branch's history — 'dc0fafe Auto-fit also covers .stat-num cards' and 'aab024a Quote print: stop long quotes leaving page 1 blank') selects `.kpi-value, .stat-num` (hardcoded class-name string at app.js:7106), captures each element's natural font-size once via `getComputedStyle(el).fontSize` into `el.dataset.maxFs`, then shrinks in 1px steps (floor 11px, max 40 iterations) while `el.scrollWidth > el.clientWidth`. It's wired via a debounced (60ms) MutationObserver on `#page-content` (childList/subtree only, explicitly NOT attributes 'so our own font-size writes don't loop') plus a window resize listener (app.js:7119-7131). The CSS side is `.kpi-value { font-size: clamp(15px, 4.6vw, 28px); ... white-space: nowrap; font-variant-numeric: tabular-nums }` (styles.css:4007-4014, itself inside the 'iOS DESIGN OVERHAUL' layer) plus a stray now-superseded comment at styles.css:2288 and 3158-3159 pointing at 'the canonical clamp() rule ... which correctly wins by source order' — i.e. even the CSS authors are aware they're relying on cascade order, and left a comment instead of removing the redundant rule.

6) Print stylesheets are entirely separate hand-authored documents, NOT reachable from css/styles.css: two payslip print templates inline in app.js (STYLES const at app.js:4670 and 4989, each a single-line CSS string with hardcoded literals like `#1a237e`, `#f5f6fa`, ending in `@media print{body{padding:20px}button{display:none!important}}`), and four more `@media print{...}` blocks inside departments.js (4288, 6780, 7683, 11990/12708 — the last two identical single-liners `.bar,.barpad{display:none!important} body{background:#fff}...`). quote-builder-v2.html is a fully standalone document with its OWN `:root` block (line 8) and 149 `var(--...)` usages — a fourth, independent token set. track.html has no `:root`/CSS-var system at all. css/styles.css itself has ZERO `@media print` rules (grep confirmed 0), meaning none of the app-shell token work in this workstream reaches print output at all — that overlap is explicitly workstream 14's (shared letterhead engine) territory, but color-literal duplication across these ≥7 places (base :root, LIQUID GLASS glass-tokens, iOS-layer :root override, 5 light-family theme :root blocks, DEPARTMENTS.color in config.js, 6 print-template inline styles, quote-builder-v2.html's own :root) is the real 'no single source of truth for brand color' problem underlying both 14 and 17.

7) Accessibility focus states — a PARTIAL existing implementation, not zero: styles.css:4567-4602 ('ACCESSIBILITY — keyboard focus visibility') is a hand-curated allowlist of selectors (`a, button, [role="button"], [tabindex], input, textarea, select, .nav-item, .bottom-nav-item, .top-nav-item, .modal-close, .menu-toggle, .icon-btn, .btn, .btn-primary, .btn-secondary`) getting `outline: 2px solid var(--accent); outline-offset: 2px` on `:focus-visible`, with a parallel `:not(:focus-visible)` block to suppress the native ring on mouse clicks. It is NOT a universal `*:focus-visible` rule — any new/unlisted interactive element (e.g. a bare onclick `<div>`, an icon-only button not classed `.icon-btn`) gets no visible focus ring today. `@media (prefers-reduced-motion: reduce)` (styles.css:4604-4632) already exists and is comparably curated (targets specific animation classes, not blanket).

8) Typography scale: NONE exists. Zero `--fs-*`/`--text-*`/`--font-size-*` custom properties found. 274 raw `font-size:` declarations across ~21-34 distinct literal px values (8px through 56px) scattered with no naming/scale discipline.

9) safe-area-inset usage: 17 sites in css/styles.css (topbar/sidebar/bottom-nav/drawer offsets, e.g. styles.css:802-803,890,963,1053,1100,1202,1216,1672,1748,2160,2248,2250,4043,4089,4093,4123) all written as ad hoc `calc(Npx + env(safe-area-inset-X, 0px))` literals, no `--safe-*` tokens; plus 1 site each in js/app.js, js/departments.js and 3 in js/notifications.js (inline style strings). This is the PWA notch/home-indicator handling that must not regress.

10) Font loading: css/styles.css:8 `@import url('https://fonts.googleapis.com/css2?family=Inter:...')` — a render-blocking external Google Fonts import, no local/self-hosted fallback, sitting immediately above the `:root` token block. Lucide is fetched from unpkg.com (index.html:295), Chart.js from cdn.jsdelivr.net (index.html:294), both deferred and preconnected (index.html:25).

11) SW/version discipline: sw.js:11 `const CACHE_VER = 'bi-ops-v162';` — any edit to css/styles.css or any touched js/*.js file in this workstream requires bumping this string per CLAUDE.md, or users get stale cached CSS/JS after deploy.

## Data model

This workstream is almost entirely client-side presentation state — it does NOT introduce or require new Firestore collections, and firestore.rules likely needs zero changes (confirm this explicitly as part of Fable's scope call, per openDecisions).

Relevant shapes actually read/written today:
- localStorage key `bi-theme` (string, one of 'office'|'dark'|'midnight'|'light'|'pink'|'grey', default 'office') — the ENTIRE persistence layer for theme choice. Per-device, per-browser; never synced to Firestore.
- In-memory JS const `THEMES` (js/app.js:770-777): `{ [key]: { label: string, cls: string|null } }` — cls is a space-joined list of html classList tokens (null for the dark/Obsidian default, meaning dark has no class — it's the class-less baseline that the :root block at styles.css:13 targets directly).
- `window.DEPARTMENTS` (js/config.js:70-121): `{ [deptName]: { key: string, icon: string (emoji), color: string (hex), subtabs: string[], navOrder: number, isSeparate?: bool, isPartnerDept?: bool } }` — 12 entries (Admin, Finance, HR, Sales, Marketing, Government Biddings, IT, Design, Production, Purchasing, Brilliant Steel, Partners). The `icon` field is the emoji-migration target; `color` is an independent hex literal not tied to any CSS custom property.
- `*_BOTTOM_NAV` arrays (js/config.js:~144-180, one per role, e.g. EMPLOYEE_BOTTOM_NAV, MANAGER_BOTTOM_NAV, PARTNER_BOTTOM_NAV, BS_PARTNER_BOTTOM_NAV): `{ icon: string (Lucide icon name, e.g. 'home','check-square'), label: string, page: string }[]` — already-correct pattern to generalize from.
- `notifications/{uid}/items/{id}` Firestore docs (written via js/notifications.js `send()`, js/departments.js multiple call sites): `{ title: string, body: string, icon: string (emoji char, default '🔔'), type: string, link: string|null, dedupKey: string|null, taskId: string|null, read: bool, createdAt: Timestamp }` (exact field list per notifications.js:251-266 `send()` signature). `icon` here is legacy-emoji and persisted — any rendering change must handle old docs (fallback default, not a hard-fail).
- manifest.json: static `theme_color` (`#0a0a0a`) and `background_color` (`#0a0a0a`) fields — these are read once at PWA install time by the OS and CANNOT be changed at runtime by the running page (spec limitation); only the `<meta name="theme-color">` tag in the live DOM (index.html:8) can be updated dynamically per `setTheme()` call.
- No user-doc field currently stores theme preference; if Fable decides theme should be account-level (see openDecisions), that would be a new optional field (e.g. `users/{uid}.themePref`) on the EXISTING `users` collection (already has broad read/write rules per finance/admin patterns elsewhere in firestore.rules) — no new collection needed, low rules risk.

## Constraints — must respect

- Script load order is load-bearing (CLAUDE.md + index.html:290-296): Firebase SDK + Chart.js + Lucide → firebase-config.js → config.js → drive.js → notifications.js → departments.js → app.js → modules.js. Lucide is loaded at index.html:295 (unpkg.com/lucide@0.468.0) AFTER Chart.js and BEFORE the app's own scripts — any icon migration must call `lucide.createIcons()` (or `lucide.createIcons({nodes:[...]})`, the scoped form already used at app.js:810 and elsewhere) after every innerHTML write that introduces new `<i data-lucide>` tags, exactly like the existing theme-icon-swap code at app.js:805-811 already does — otherwise icons render as empty tags with no console error.
- CACHE_VER must be bumped in sw.js (currently 'bi-ops-v162', sw.js:11) on every JS/CSS file this workstream edits — non-negotiable per CLAUDE.md, and this workstream will almost certainly touch css/styles.css + js/app.js + js/config.js + js/departments.js + js/modules.js + js/notifications.js simultaneously, so this is a single bump at the end, not per-file.
- escHtml() discipline (CLAUDE.md, modules.js) still applies at every innerHTML site this workstream touches when interpolating any value that could contain user content — dept names/icons come from static config so are low-risk, but notification titles/bodies (which DO get user-influenced substrings, e.g. client names) already route through escHtml in some spots (notifications.js:118) and must keep doing so if icon-rendering logic is refactored inline with them.
- Every Firestore collection needs an explicit rules match — no cascade/prefix (CLAUDE.md + memory note 'firestore-rules-collection-coverage'). This workstream is not expected to add collections, but if the 'sync theme across devices' openDecision is answered 'yes' via a new field on the existing `users` doc, that field write must be checked against the CURRENT users-collection rules (self-write of non-privileged fields) before shipping — a missing/too-narrow rule silently denies the write.
- Reading an absent Firestore field in security rules denies the whole rule (memory note 'firestore-rules-missing-field-throws') — relevant only if a new optional theme-preference field is added to `users/{uid}` and referenced in rules; must use `.get(field, default)`.
- The codebase's own cascade layers are self-documented as intentionally additive/override-based ('Written as cascade overrides — all prior rules still apply', styles.css:3250; 'Appended as cascade layer — overrides prior rules on cascade', styles.css:3837) — meaning whoever built them KNEW this was fragile and chose it anyway for speed. Any consolidation must preserve the exact visual output of all 6 themes (verified by diffing rendered screenshots, not just 'no CSS errors'), because file-order-dependent selectors give zero build-time signal when something breaks.
- `window.fitKpiValues` (app.js:7103-7131) hardcodes the selector string `.kpi-value, .stat-num` and depends on reading `getComputedStyle(el).fontSize` as the 'natural' size before any shrinking — if class names are renamed or the box model (line-height/padding) changes as part of token consolidation, this function's selector list and its cached-natural-size assumption must be re-verified against real card widths (mobile 375px width is the tightest case per the 4.6vw clamp() at styles.css:4009-4013), or long peso figures will clip again (the exact bug fixed twice already this week per commits dc0fafe/aab024a).
- Print stylesheets (app.js:4670/4989 payslip STYLES consts; departments.js:4288/6780/7683/11990/12708 @media print blocks; quote-builder-v2.html's own :root+149 var() usages) are separate documents opened in their own windows/iframes and are OUT OF REACH of any css/styles.css token change — they hardcode brand colors independently (#1a237e appears in at least 2 print templates). This workstream's token renames should not assume they propagate there; that bridge is workstream 14's job.
- No `prefers-color-scheme` media query exists anywhere today (confirmed via grep across css/styles.css and all js/*.js) — 'Auto (system) theme' is a from-scratch addition on top of the existing class-toggle mechanism (`document.documentElement.classList`), not a tweak to an existing partial implementation.
- manifest.json's `theme_color`/`background_color` are read once at PWA-install time and cannot be updated live by the running page (a platform limitation, not a code bug) — only the `<meta name="theme-color">` DOM tag (index.html:8) can be kept in sync with `setTheme()` at runtime; Fable should not promise manifest-level live sync.

## DECIDED — architecture spec (Fable, 2026-07-10)

> Scope discipline for this workstream is deliberately **surgical, not a rewrite**. There is no automated test suite and every duplicate selector relies on file order, so a giant reorder/merge diff has high silent-regression risk. The plan below fixes the audit's *root cause* (order-dependence + no single token/type/icon system) with changes that are **provably visual-no-op** (dedup a shadowed rule, tokenize a px value to a token whose value equals that px, fold a duplicate `:root` reassignment into the canonical `:root`) plus a small set of *additive* features (Auto theme, dynamic theme-color, universal focus ring). Deep semantic-token purity (killing the ~166 `html.light .foo` component overrides) is explicitly **rejected for 17** and left as a documented follow-up — it touches ~874 `var()` sites for zero visual change and cannot be safely verified without tests.

### Resolved decisions (one line each)

1. **Token architecture depth → Option (a)+ (safe dedup), NOT (b).** Merge the duplicated base-selector rules and fold the duplicate `:root` token reassignments into ONE canonical `:root`; keep the existing clean per-theme `:root` re-declaration pattern; **do not** rewrite the ~166 `html.light/.theme-pink/.theme-grey .component{}` overrides. Rationale: (b) is a 874-site change with no test net and zero rendered-pixel benefit; (a)+ removes the actual footgun (duplicate/shadowed definitions) at no visual cost.
2. **Flatten vs `@layer` → NEITHER a physical flatten NOR blanket `@layer`.** Do not wrap the three banner sections in `@layer` — naive layering inverts specificity (a low-specificity rule in the "overhaul" layer would start beating a high-specificity base rule, changing pixels). Instead **delete the shadowed duplicates so there is genuinely one definition per selector**, which achieves "one ordered stylesheet" without a risky reorder. The three banner comments stay as section dividers only.
3. **Theme roster → picker shows 3 (Office · Auto · Obsidian); the other 4 classes stay in code, honored if already in localStorage, but are removed from the picker UI.** Matches the owner's "professional Microsoft/Apple, everything uniform, no redundancy" directive. No CSS/theme-class deletion, so nobody's saved choice breaks. ‼️ FLAG FOR NEIL below (reversible product call).
4. **Auto mechanics → 7th `THEMES.auto` entry, `cls` computed live from `matchMedia('(prefers-color-scheme: dark)')`, resolving Obsidian(dark)↔Office(light);** a `change` listener on the MediaQueryList re-applies instantly (no reload) while `auto` is the active choice.
5. **Theme persistence → stays 100% `localStorage` (`bi-theme`), per-device. No `users/{uid}` field, no rules change.** Cross-device consistency is delivered by *defaulting everyone to the same professional theme* + Auto-follows-OS, not by syncing a per-user preference. Zero schema/rules risk.
6. **DEPARTMENTS.icon → add a parallel `lucideIcon` field; switch the 6 render sites to Lucide; keep `icon` (emoji) and `color` untouched for back-compat.** Department glyphs become monochrome Lucide (uniform, professional) with color still supplied by `DEPARTMENTS.color`.
7. **`notifications` `icon` field → NOT migrated in Firestore; mapped at render time.** `notifications.js` render resolves emoji→Lucide via `window.LUCIDE_EMOJI_MAP` with a raw-emoji fallback, so the thousands of legacy persisted docs keep working. `send()` default stays a value; new sends may pass a Lucide name (both render correctly through the same helper).
8. **Focus-visible → replace the hand-curated allowlist with ONE universal `:focus-visible` rule**, plus an explicit opt-out for programmatically-focused containers (`[tabindex="-1"]`). Future-proof; no new component ever ships without a focus ring again.
9. **Typography scale → introduce `--fs-*` tokens whose values EQUAL the existing common px values, then sweep ALL `font-size:` declarations in `css/styles.css` (excluding `.kpi-value`/`.stat-num`).** Because each token equals the px it replaces, the whole-file sweep is a mechanical find/replace with **zero rendered change** — the safe kind of "big" diff. Inline JS `style="font-size:…"` strings are OUT of scope.
10. **Reach into quote-builder-v2.html + the 6 print templates → DEFERRED to workstream 14.** 17 is scoped to `css/styles.css` + the app shell (`app.js`, `config.js`, `departments.js`, `modules.js`, `notifications.js`, `index.html`, `manifest.json`, `sw.js`). Interface contract for 14/9 named in §H.
11. **safe-area-inset → LEFT EXACTLY AS-IS (no `--safe-*` tokenization).** It works; partial tokenization is the exact way this class of notch bug regresses. Out of scope, deliberately.
12. **Font `@import` → kept as-is.** Self-hosting is a separate infra change; the system-font fallback in `--font` already covers offline. Noted, not touched.
13. **`window.fitKpiValues` → untouched; protected.** The typography sweep explicitly excludes `.kpi-value` and `.stat-num` so their `font-size` (and `fitKpiValues`'s `getComputedStyle` natural-size read) is byte-identical.
14. **firestore.rules → ZERO changes.** Confirmed: this workstream introduces no collection and no new `users` field. (Decision 5 is what keeps it at zero.)

---

### A. Token policy + the ADDED/MERGED token tables

**Policy: no existing token is renamed.** Renaming any of the current 77 `var(--x)` names ripples to ~874 usages with no visual payoff — rejected (decision 1). We only (i) fold duplicate `:root` reassignments into the base `:root`, and (ii) ADD new tokens (typography, brand aliases, theme-color).

**A1 — MERGED tokens (fold the duplicate iOS `:root` at styles.css:3841-3852 into the base `:root` at styles.css:13-126).** These five tokens are currently declared twice at equal `:root` specificity; the later (iOS) value wins today. Folding them into the base block with the iOS value as canonical is a provable no-op (per-theme blocks that re-declare `--r-*`, e.g. `html.theme-office`, have higher specificity and are unaffected; no theme block re-declares `--ease`).

| token | base `:root` value now (styles.css:88-110) | iOS `:root` value now (styles.css:3846-3851) — **winning today** | canonical value after merge |
|---|---|---|---|
| `--ease` | `cubic-bezier(0.4,0,0.2,1)` | `cubic-bezier(0.25,0.46,0.45,0.94)` | `cubic-bezier(0.25,0.46,0.45,0.94)` |
| `--r` | `14px` | `16px` | `16px` |
| `--r-sm` | `10px` | `12px` | `12px` |
| `--r-lg` | `18px` | `20px` | `20px` |
| `--r-xl` | `24px` | `26px` | `26px` |

The iOS-only motion tokens in that same block (`--ios-spring`, `--ios-spring-out`, `--ios-enter`) are NOT duplicates — move them verbatim into the base `:root` too, so after the edit the entire `:root{…}` at 3841-3852 can be deleted (comment `/* iOS motion tokens — merged into base :root */` left in its place).

**A2 — ADDED tokens (append to the base `:root` at styles.css:126, before the closing `}`).** Values chosen to EQUAL the existing common px literals so the sweep is a no-op. These are theme-independent (font-size does not vary by theme today).

```css
  /* ── Typography scale (values == today's most-used px literals; no visual change on swap) ── */
  --fs-2xs: 10px;   /* micro labels, badges */
  --fs-xs:  11px;   /* captions, meta, timestamps */
  --fs-sm:  12px;   /* secondary text, chips */
  --fs-md:  13px;   /* dense body */
  --fs-base:14px;   /* DEFAULT body */
  --fs-lg:  16px;   /* emphasized body, inputs */
  --fs-xl:  18px;   /* card titles */
  --fs-2xl: 20px;   /* section headers */
  --fs-3xl: 24px;   /* page sub-headers */
  --fs-4xl: 28px;   /* page titles */
  --fs-5xl: 34px;   /* large numeric displays */
  --fs-6xl: 44px;   /* hero */
  /* line-heights (unitless) */
  --lh-tight: 1.2;
  --lh-snug:  1.35;
  --lh-base:  1.5;
  /* ── Brand-role aliases (decouple 'accent role' from the literal --pink) ── */
  --brand-primary:      var(--pink);   /* the app's primary accent ROLE — reassign here per theme, not by overloading --pink */
  --brand-primary-2:    var(--pink-2);
  --brand-on-primary:   var(--white);
  /* ── Status-bar / theme-color (read by setTheme() to sync <meta name=theme-color>) ── */
  --theme-color: var(--bg);
```

**A3 — The `--pink` split (the requested "used as literal AND as accent role" resolution).** Today `--pink` (#FF2D78) is consumed in TWO meanings: (1) literal brand pink in decorative gradients, and (2) generic "active/accent" role (e.g. `.bottom-nav-item.active{color:var(--pink)}` at styles.css:1255, `.topbar-avatar:hover{box-shadow:var(--sh-pink)}`). In the Office theme `html.theme-office` already re-points `--pink` to Microsoft blue (styles.css:2468) — proving "pink" is really being used as the accent role there. Resolution: **add `--brand-primary` (A2) as the accent ROLE token**; when new/edited component rules mean "the accent", they use `var(--brand-primary)`. We do NOT sweep-replace existing `var(--pink)` accent usages in this pass (out of the safe no-op envelope), but every rule this workstream *touches* that means "accent" uses `--brand-primary`. Five worked examples of the intended split:

| site | today | means | new usage when touched |
|---|---|---|---|
| `.bottom-nav-item.active` color (1255) | `var(--pink)` | accent role | `var(--brand-primary)` |
| `--grad-pink` (35) | `#FF2D78→#FF6B9D` | literal brand pink | unchanged (literal) |
| `.topbar-avatar:hover` shadow (959) | `var(--sh-pink)` | accent role | `var(--sh-pink)` unchanged (shadow token already theme-remapped at 2505) |
| focus ring (4587) | `var(--accent)` | accent role | `var(--brand-primary)` |
| `.subtab-btn.active` (1834) | `var(--pink)`/`var(--accent)` | accent role | `var(--brand-primary)` |

Because `--brand-primary` defaults to `var(--pink)`, and every theme already remaps `--pink`, this is backward-identical until a theme chooses to set `--brand-primary` independently — which is the hook WS9 (BRAND) will use.

---

### B. Duplicate base-selector merges (before/after, keyed to exact lines)

**Merge rule (mechanical, applies to every row):** produce ONE rule = the union of all declarations across the duplicate copies; on any property that appears in more than one copy, the **last (highest-line) copy's value wins**; place the merged rule **at the position of the last copy**; delete the earlier copies. Deleting a fully-shadowed earlier copy while preserving any earlier-only property at the later position is a visual no-op (nothing between them re-set those properties at equal-or-higher specificity — verify per theme per §I). Verified anchors:

| selector | copies (styles.css lines) | keep merged rule at | delete |
|---|---|---|---|
| `.topbar` | 801, 3295 | 3295 | 801 block (fold its unique props up into 3295) |
| `.topbar::after` | 812, 3302 | 3302 | 812 |
| `.card` | 1418, 3345 | 3345 | 1418 (fold unique props) |
| `.page-header` | 1267, 3855 | 3855 | 1267 (fold unique props) |
| `.subtab-btn` | 1826, + Layer-1 dup | later | earlier |
| `.modal-box` | 2104, 3399 | 3399 | 2104 (also reconcile `::before`/`::after` at 2120/3407/3945 the same way) |
| `.bottom-nav` | 1213, 3487, 4041 | 4041 | 1213 + 3487 (three-way union, 4041 values win) |
| `.kpi-value` | 1326, 4009 | **4009 (leave verbatim — protected)** | 1326 (fold only props NOT already in 4009; do NOT alter the `clamp()` line) |

Worked example — `.card` (styles.css:1418 → 3345):

```css
/* BEFORE — 1418 (base) */
.card { background: var(--grad-card); border: 1px solid var(--border); border-radius: var(--r-lg);
        position: relative; overflow: hidden; transition: border-color var(--t2) var(--ease); }
.card::before { /* … */ }
/* … and later, BEFORE — 3345 (LIQUID GLASS) */
.card { background: var(--glass-surface); backdrop-filter: var(--glass-blur);
        border: 1px solid var(--glass-border); box-shadow: var(--glass-spec), var(--glass-shadow);
        border-radius: var(--r-lg); }
```
```css
/* AFTER — single rule AT 3345's position; 1418 deleted. Union, glass (later) wins on conflicts. */
.card { background: var(--glass-surface); backdrop-filter: var(--glass-blur);
        border: 1px solid var(--glass-border); box-shadow: var(--glass-spec), var(--glass-shadow);
        border-radius: var(--r-lg);
        position: relative; overflow: hidden;                 /* preserved from 1418 (glass didn't set) */
        transition: border-color var(--t2) var(--ease); }     /* preserved from 1418 */
```

Worked example — `.kpi-value` (protected merge, 1326 → 4009):

```css
/* KEEP 4009 EXACTLY (do not touch clamp/nowrap/tabular-nums — fitKpiValues depends on it) */
.kpi-value { font-size: clamp(15px, 4.6vw, 28px); white-space: nowrap; font-variant-numeric: tabular-nums; /* …existing… */ }
/* From 1326, port up ONLY properties 4009 does not set (e.g. color, letter-spacing, font-weight). Delete 1326. */
```

Also delete the two now-stale "canonical clamp() wins by source order" comments at styles.css:2288 and 3158-3159 (they document the very fragility we just removed).

---

### C. `@layer` decision (explicit)

**No `@layer` is introduced, and no physical flatten is performed** (decision 2). After §B there is exactly one rule per previously-duplicated selector, so precedence no longer depends on hidden duplicate stacking. The three banner comments (`v3 base`, `LIQUID GLASS`, `iOS DESIGN OVERHAUL`) remain **as section headers only**. Rationale recorded for the next architect: wrapping the existing unlayered rules in `@layer base, glass, overhaul` would make every `overhaul` rule beat every `base` rule *regardless of specificity*, inverting cases where a high-specificity base rule currently wins — an unverifiable pixel change across 6 themes. If a future workstream WITH a screenshot-diff harness wants true layering, that is the safe time to do it.

---

### D. Icon migration

**D1 — Infrastructure (add to `js/config.js`, top-level, after `DEPARTMENTS`).**

```js
// ── Emoji → Lucide icon-name map (UI chrome). Extend as new glyphs appear. ──
window.LUCIDE_EMOJI_MAP = {
  '✅':'check-circle','✓':'check','☑':'check-square','❌':'x-circle','✗':'x','⚠':'alert-triangle','⚠️':'alert-triangle',
  '📋':'clipboard-list','🗑':'trash-2','🗑️':'trash-2','📄':'file-text','🧾':'receipt','📊':'bar-chart-3','📈':'trending-up','📉':'trending-down',
  '📅':'calendar','🕐':'clock','⏰':'alarm-clock','🌅':'sunrise','📦':'package','💸':'banknote','💰':'wallet','💵':'banknote',
  '🔔':'bell','🔒':'lock','🔓':'unlock','🔑':'key','⚙️':'settings','⚙':'settings','🔧':'wrench','🔍':'search','➕':'plus','➖':'minus',
  '✏️':'pencil','✏':'pencil','📝':'file-pen-line','📌':'pin','📎':'paperclip','🏢':'building-2','🏭':'factory','🏛️':'landmark','🏛':'landmark',
  '👥':'users','👤':'user','🤝':'handshake','📢':'megaphone','💻':'laptop','🎨':'palette','🛒':'shopping-cart','📁':'folder','📂':'folder-open',
  '🚀':'rocket','⭐':'star','🌟':'star','❓':'help-circle','ℹ️':'info','💡':'lightbulb','🎯':'target','�️':'link','🔗':'link','📧':'mail','📞':'phone',
  '🌴':'palm-tree','📖':'book-open','🖨️':'printer','⬇️':'download','⬆️':'upload','🔄':'refresh-cw','▶️':'play','⏸️':'pause','🏆':'trophy','🎁':'gift'
};
// Render helper: emoji OR a Lucide name -> Lucide <i>. Falls back to the raw emoji if unmapped.
// size in px (optional). ALWAYS follow an innerHTML write that uses this with lucide.createIcons(...).
window.emojiIcon = function(glyph, size){
  if (!glyph) return '';
  const name = window.LUCIDE_EMOJI_MAP[glyph] || (/^[a-z0-9-]+$/.test(glyph) ? glyph : null);
  if (!name) return `<span class="emoji-icon">${(window.escHtml?escHtml(glyph):glyph)}</span>`; // legacy/unmapped: keep emoji
  const s = size ? ` style=\"width:${size}px;height:${size}px\"` : '';
  return `<i data-lucide=\"${name}\"${s}></i>`;
};
```

**D2 — `DEPARTMENTS.lucideIcon` (add one field per entry, `js/config.js:70-121). Emoji `icon` and `color` stay.**

| dept | keep `icon` | add `lucideIcon` |
|---|---|---|
| Admin `🏢` | ✓ | `building-2` |
| Finance `💰` | ✓ | `wallet` |
| HR `👥` | ✓ | `users` |
| Sales `🤝` | ✓ | `handshake` |
| Marketing `📢` | ✓ | `megaphone` |
| Government Biddings `🏛️` | ✓ | `landmark` |
| IT `💻` | ✓ | `laptop` |
| Design `🎨` | ✓ | `palette` |
| Production `🏭` | ✓ | `factory` |
| Purchasing `🛒` | ✓ | `shopping-cart` |
| Brilliant Steel `⚙️` | ✓ | `settings` |
| Partners `🤝` | ✓ | `handshake` |

**D3 — The 6 DEPARTMENTS render sites → Lucide.** At each, replace the raw `cfg.icon` text interpolation with `emojiIcon(cfg.lucideIcon || cfg.icon, <size>)` and ensure a `lucide.createIcons()` call runs after that innerHTML write.

| site | before (pattern) | after |
|---|---|---|
| `app.js:911` nav item build | `…>${cfg.icon}<…` | `…>${emojiIcon(cfg.lucideIcon||cfg.icon,18)}<…` |
| `app.js:3318` dept card | `${cfg.icon}` | `${emojiIcon(cfg.lucideIcon||cfg.icon,22)}` |
| `app.js:3919-3920` page-header + empty-state fallback | `${cfg?.icon||'🗂️'}` | `${emojiIcon(cfg?.lucideIcon||cfg?.icon||'folder',24)}` |
| `app.js:5116` | `${cfg.icon}` | `${emojiIcon(cfg.lucideIcon||cfg.icon,20)}` |
| `app.js:6040` dept-icon-large | `${cfg.icon}` | `${emojiIcon(cfg.lucideIcon||cfg.icon,32)}` |
| `departments.js:606` | `${cfg.icon}` | `${emojiIcon(cfg.lucideIcon||cfg.icon,20)}` |

**createIcons reminder (per site):** `app.js:911`/`3318`/`5116`/`6040` feed nav/dashboard which already call `lucide.createIcons()` after render — VERIFY the call runs after these writes; if a site writes into a detached fragment, add `lucide.createIcons({nodes:[<container>]})`. `departments.js:606` is inside a `render*` — confirm that function ends with `lucide.createIcons()` (grep the function; add if missing).

**D4 — Notifications (render-time map, no Firestore migration).** `js/notifications.js:114-118`:

```js
// BEFORE
const icon = n.icon || lead || '🔔';
// …
<div class="notif-item-emoji">${escHtml(icon)}</div>
```
```js
// AFTER — resolve emoji OR Lucide-name to an <i>, tolerate legacy emoji, keep escHtml on any raw fallback
const icon = n.icon || lead || 'bell';
// …
<div class="notif-item-emoji">${window.emojiIcon(icon, 20)}</div>
```
Then after `list.innerHTML = …` in that render function, add `if (window.lucide) lucide.createIcons({ nodes: [list] });`. `send()` default (`notifications.js:251`) and reminder icons (569 `'⏰'`, 593 `'🌅'`, 619 `'📦'`) may stay emoji (they render fine through `emojiIcon`) OR be changed to `'alarm-clock'`/`'sunrise'`/`'package'` — either works; **no data backfill**.

**D5 — Profile shortcut emoji (`app.js:6949-6954`)** and page-header prefixes (e.g. `departments.js:1209 <h2>📋 Submissions</h2>`): replace the leading emoji with `emojiIcon(...)` per the map; these render functions already run `lucide.createIcons({nodes:[drawer]})` (app.js:6994) / end-of-render createIcons — verify.

**D6 — Distinct-glyph table (the ~130 chrome glyphs; top offenders by count fully specified, long tail via the map).** Sonnet applies `window.LUCIDE_EMOJI_MAP` mechanically to remaining `departments.js`/`modules.js` chrome emoji (icon-only buttons like `departments.js:744/1734 <button…>🗑</button>` → `<button…>${emojiIcon('trash-2',16)}</button>`, empty-state icons, header prefixes). **KEEP as brand/content (do NOT replace):** none required — all 1,160 occurrences are UI chrome; there is no colorful per-department brand glyph that survives (dept color-coding now comes from `DEPARTMENTS.color`, not the emoji). Any glyph NOT in the map renders unchanged via `emojiIcon`'s fallback, so partial completion never breaks a screen. Highest-frequency rows: ✅→`check-circle`(99), ✓→`check`(55), 📋→`clipboard-list`(53), 🗑→`trash-2`(53), ⚠→`alert-triangle`(35), ❌→`x-circle`(33), 📄→`file-text`(32), 💸→`banknote`(31), 🧾→`receipt`(28), ✗→`x`(27), 📊→`bar-chart-3`(26), 📅→`calendar`(25).

> **Rule for Sonnet at EVERY touched render function:** after any `innerHTML =`/`insertAdjacentHTML` that introduces `<i data-lucide>` (via `emojiIcon` or literal), call `lucide.createIcons()` (or the scoped `lucide.createIcons({nodes:[el]})`). Omitting it renders an empty tag with no console error.

---

### E. Theme: Auto, dynamic theme-color, picker (exact diffs)

**E1 — `THEMES` (app.js:770-777):**
```js
const THEMES = {
  auto:     { label: 'Auto',     cls: () => matchMedia('(prefers-color-scheme: dark)').matches ? null : 'light theme-office' },
  office:   { label: 'Office',   cls: 'light theme-office' },
  dark:     { label: 'Obsidian', cls: null },
  midnight: { label: 'Midnight', cls: 'theme-midnight' },
  light:    { label: 'Aurora',   cls: 'light' },
  pink:     { label: 'Astral',   cls: 'theme-pink' },
  grey:     { label: 'Slate',    cls: 'theme-grey' },
};
// cls may now be a string | null | function → string|null. Resolve everywhere via _themeCls().
function _themeCls(t){ const c = THEMES[t] && THEMES[t].cls; return typeof c === 'function' ? c() : c; }
```
`auto` resolves to Office(light)↔Obsidian(dark) (decision 4).

**E2 — `setTheme` (app.js:785-793) rewritten to use `_themeCls`, sync the meta tag, and remove ALL theme classes (superset across every theme):**
```js
function setTheme(theme, persist = true) {
  if (!THEMES[theme]) theme = 'office';
  const html = document.documentElement;
  // strip every class any theme could add (static strings + the two Auto resolves)
  ['light','theme-office','theme-midnight','theme-pink','theme-grey'].forEach(c => html.classList.remove(c));
  const cls = _themeCls(theme);
  if (cls) cls.split(' ').forEach(c => html.classList.add(c));
  if (persist) localStorage.setItem('bi-theme', theme);
  _applyThemeIcon(theme);
  _syncThemeColorMeta();          // NEW — keep <meta name=theme-color> in step with the rendered theme
}
// Read the resolved --theme-color (falls back to --bg) and write it to the meta tag.
function _syncThemeColorMeta(){
  let meta = document.querySelector('meta[name=\"theme-color\"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.appendChild(meta); }
  const cs = getComputedStyle(document.documentElement);
  const c = (cs.getPropertyValue('--theme-color') || cs.getPropertyValue('--bg') || '').trim();
  if (c) meta.setAttribute('content', c);
}
```

**E3 — Auto live-follow (insert next to `initTheme`, app.js:779-783):**
```js
function initTheme() {
  setTheme(localStorage.getItem('bi-theme') || 'office', false);
  // When 'auto' is active, follow the OS scheme instantly (no reload).
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const onOsScheme = () => { if ((localStorage.getItem('bi-theme') || 'office') === 'auto') setTheme('auto', false); };
  mq.addEventListener ? mq.addEventListener('change', onOsScheme) : mq.addListener(onOsScheme);
}
```

**E4 — `toggleTheme` (app.js:799-803):** cycle only the 3 picker themes: `const order = ['auto','office','dark'];`.

**E5 — `_applyThemeIcon` (app.js:805-811):** icon for `auto` = `monitor`; `dark`/`midnight` = `moon`; everything else = `sun`:
```js
const iconName = theme === 'auto' ? 'monitor' : (theme === 'dark' || theme === 'midnight') ? 'moon' : 'sun';
```

**E6 — Picker markup (app.js:6924-6931):** show 3 swatches only.
```html
<div class="theme-picker" id="drawer-theme-picker">
  <button class="theme-swatch theme-swatch-office" data-theme="office" title="Office (light)"><span class="theme-swatch-dot"></span>Office</button>
  <button class="theme-swatch" data-theme="auto" title="Match system"><span class="theme-swatch-dot"></span>Auto</button>
  <button class="theme-swatch theme-swatch-dark" data-theme="dark" title="Obsidian (dark)"><span class="theme-swatch-dot"></span>Obsidian</button>
</div>
```
Picker wiring (app.js:7002-7015) is unchanged (it reads `data-theme` and calls `setTheme`). `getTheme()` unchanged. A user whose `bi-theme` is a hidden value (`midnight`/`light`/`pink`/`grey`) still renders correctly — `setTheme` honors it; `updateActive()` simply marks no swatch active, which is fine.

**E7 — `manifest.json`:** cannot live-sync (install-time constant). Leave `background_color:'#0a0a0a'`. Set `theme_color:'#0F6CBD'` (the Office/default accent) so the installed-shell chrome matches the default professional theme instead of today's black. Fix `index.html:8` static `<meta name="theme-color" content="#FAF9F8"/>` — it becomes dynamic via `_syncThemeColorMeta()`, but leave a sensible static default matching the Office `--bg` (`#FAF9F8`) for first paint before JS runs.

---

### F. Focus-visible (styles.css:4571-4602 → universal)

```css
/* BEFORE: the 16-selector allowlist at 4571-4590 + the :not(:focus-visible) block at 4592-4602 */
/* AFTER — one universal rule + one opt-out. Delete the entire 4571-4602 allowlist. */
:focus-visible {
  outline: 2px solid var(--brand-primary);
  outline-offset: 2px;
  border-radius: var(--r-xs);
}
/* Programmatically-focused scroll/containers must not show a ring */
[tabindex="-1"]:focus-visible { outline: none; }
/* Suppress the UA ring on non-keyboard focus (kept, broadened to all elements) */
:focus:not(:focus-visible) { outline: none; }
```
Uses `--brand-primary` (was `--accent`; identical today, decouples for WS9). The `@media (prefers-reduced-motion)` block at 4604-4633 is untouched.

---

### G. Typography sweep (styles.css only; exact value map)

Sweep every `font-size:<px>;` declaration in `css/styles.css` → `font-size:var(--fs-*)` using the exact map below (token value == px, so no visual change). **EXCLUDE** `.kpi-value` (clamp, line 4009) and `.stat-num`. Where a px value falls between tokens (e.g. `15px`, `17px`, `22px`, `26px`), map to the NEAREST token ONLY if equal; otherwise **leave the raw px** (do not round — rounding is a visual change). Map: `10→--fs-2xs`, `11→--fs-xs`, `12→--fs-sm`, `13→--fs-md`, `14→--fs-base`, `16→--fs-lg`, `18→--fs-xl`, `20→--fs-2xl`, `24→--fs-3xl`, `28→--fs-4xl`, `34→--fs-5xl`, `44→--fs-6xl`. Non-matching literals (`8,9,15,17,19,21,22,26,32,36,40,48,56`) stay raw px this pass (a later pass may extend the scale). Inline JS `style` font-sizes are OUT of scope.

---

### H. Interface contract for WS9 (BRAND) and WS14 (letterhead)

- WS9 `window.BRAND.colors` becomes the source of truth for accent by assigning `--brand-primary` / `--brand-primary-2` at init (e.g. `document.documentElement.style.setProperty('--brand-primary', BRAND.colors.primary)`), rather than editing `--pink`. `DEPARTMENTS.color` stays the per-dept accent for now; WS9 may later derive it.
- WS14 (letterhead/print) OWNS all print `@media`/inline print `<style>` and `quote-builder-v2.html`'s `:root`. WS17 does NOT touch them. The canonical brand tokens WS14 should consume once 17 lands: `--brand-primary`, `--text`, `--text-2`, `--border`, `--bg`, `--fs-*`. WS14 must NOT assume `css/styles.css` tokens reach print windows (separate documents) — it re-declares these names locally with the same values.

---

### I. Migration checklist (sequential, safe order)

1. **Tokens:** fold the 5 duplicate `:root` reassignments + 3 iOS motion tokens (A1) into base `:root` (styles.css:13-126); delete the `:root{}` at 3841-3852 (leave a one-line comment). Append the ADDED tokens (A2).
2. **Duplicate-selector merges (B):** in ascending caution — `.topbar`/`.topbar::after`, `.page-header`, `.subtab-btn`, `.card`, `.modal-box`(+::before/::after), `.bottom-nav`(3-way), then `.kpi-value` (protected merge — do not touch the clamp line). Delete the stale comments at 2288 and 3158-3159.
3. **Focus-visible (F):** replace 4571-4602 with the universal rule.
4. **Typography sweep (G):** map font-size literals to `--fs-*`, excluding `.kpi-value`/`.stat-num`.
5. **Icon infra (D1):** add `LUCIDE_EMOJI_MAP` + `emojiIcon()` to `config.js`.
6. **DEPARTMENTS (D2):** add `lucideIcon` to all 12 entries.
7. **Dept render sites (D3):** swap the 6 sites; verify `createIcons` runs after each.
8. **Notifications (D4):** render-time map + `createIcons` after `list.innerHTML`.
9. **Chrome emoji (D5/D6):** apply the map across profile shortcuts, page-header prefixes, icon-only buttons, empty states; add `createIcons` after every touched render.
10. **Theme (E1-E7):** `THEMES`+`_themeCls`, `setTheme`+`_syncThemeColorMeta`, `initTheme` live-follow, `toggleTheme`, `_applyThemeIcon`, picker markup; `index.html:8` default + `manifest.json` `theme_color`.
11. **DO NOT touch:** safe-area `env()` calcs, the font `@import`, `fitKpiValues`, print/quote-builder styles, `firestore.rules`.
12. **FINAL:** bump `CACHE_VER` in `sw.js:11` (`bi-ops-v162` → `bi-ops-v163`) — single bump for all edits. (App code deploys via `git push origin master`; no rules deploy needed — zero rules change.)

---

### J. Manual verification checklist (no automated suite)

For **each of the 3 picker themes (Office, Auto→both OS modes, Obsidian)** AND spot-check the 4 hidden themes still render if forced via `localStorage.setItem('bi-theme','midnight')`:
1. **KPI auto-fit @ 375px:** open the finance dashboard at 375px width; a long peso figure (e.g. `₱1,234,567.89`) in a `.kpi-value` and a `.stat-num` card must shrink to fit, floor 11px, no clipping (the twice-fixed bug). Confirm `el.dataset.maxFs` still captures the CSS size (font-size still resolves via `--fs`/clamp).
2. **Modal:** open one representative modal (e.g. a task or expense modal) — border-radius, glass background, and `::before`/`::after` accents render as before the merge.
3. **Bottom-nav:** renders with correct height, active-item accent color, per-page icon strokes (styles.css:3181-3196), and the `.nav-shrunk` state on scroll.
4. **Icons:** dept cards/nav show Lucide glyphs (not empty boxes) — proves `createIcons` ran; a legacy notification (old emoji `icon`) and a new one both show an icon.
5. **Auto:** with theme=Auto, toggle OS light/dark (macOS System Settings) while the app is open → theme flips instantly, and the browser/status-bar `theme-color` follows (inspect `<meta name=theme-color>` content changes).
6. **Focus ring:** Tab through nav, buttons, inputs, AND a previously-unlisted element (a bare `onclick` div, an icon-only button) → all show the 2px `--brand-primary` ring; mouse-click shows none; a `[tabindex="-1"]` scroll container shows none.
7. **Print:** open a payslip/quote print preview → still renders in its own untouched styling (confirms 17 didn't leak into WS14 territory).
8. **Notch/PWA:** on an iOS device/simulator (or DevTools device with safe-area), topbar/bottom-nav still clear the notch & home indicator (safe-area untouched — sanity check only).

## Risks / cross-workstream interactions

- ⚠️ Direct interaction with workstream 14 (shared document letterhead engine): print stylesheets hardcode brand colors independently of any css/styles.css token (e.g. #1a237e repeated in app.js:4670 and 4989 payslip templates) — if 17 renames/removes tokens that 14 was planning to reuse for the new letterhead engine, sequencing/ordering between the two workstreams matters; recommend Fable state an explicit interface contract (e.g. 'the letterhead engine consumes token names X/Y/Z once 17 lands') rather than letting both pick names independently.
- ⚠️ Direct interaction with workstream 9 (BRAND module + rename sweep): department accent colors (config.js DEPARTMENTS.color, e.g. '#1a237e') and the CSS :root palette both currently encode brand color completely independently; if BRAND introduces a single `window.BRAND.colors` source of truth, 17's token layer should decide whether CSS custom properties get generated from BRAND at init time rather than being a third hand-duplicated place.
- ⚠️ Direct interaction with workstream 16 (performance/scale): `window.fitKpiValues` (app.js:7103-7131) attaches a MutationObserver to `#page-content` on every childList/subtree change plus a resize listener; any workstream-16 change to how/how-often departments.js re-renders (e.g. batching, virtual-list style updates) could interact with this observer's debounce (60ms) — verify neither workstream breaks the other's re-render assumptions.
- ⚠️ Regression risk is high and silent: because all three cascade layers rely purely on file order (no specificity bump), any consolidation tool/process that reorders CSS rules (e.g. an automated 'group by component' or alphabetize pass, or even a merge conflict that reorders blocks) changes rendered output across all 6 themes with zero build error. Every touched selector must be visually diffed per theme, not just linted.
- ⚠️ Emoji-to-Lucide migration is a JS content edit (app.js, departments.js, modules.js, config.js, notifications.js, drive.js), not a CSS edit — each of the ~130 distinct emoji glyphs (not all 1,160 raw occurrences) needs its own call-site fix, and every touched render function must remember to call `lucide.createIcons()` afterward or icons silently render empty; this exact 'forgot to re-call createIcons after dynamic re-render' failure mode already has precedent risk in a codebase this size (12.7k-line departments.js has many independent render* functions).
- ⚠️ Historical Firestore data risk: `notifications/*/items/*` docs already have emoji strings baked into the persisted `icon` field (not just live-rendered) — a UI change to how `icon` is interpreted (e.g. switching to Lucide-name lookup) must gracefully handle legacy emoji values already sitting in the database, or old notifications in a user's inbox render broken/blank icons.
- ⚠️ manifest.json theme_color (#0a0a0a) and index.html's static `<meta name="theme-color">` (#FAF9F8) already disagree with each other and with the actual default runtime theme (Office, whose --bg is #FAF9F8 per styles.css:2449) — 'theme-color meta follows theme' requires a JS-side fix inside `setTheme()` (app.js:785-793) to rewrite the meta tag's `content` on every theme change; the manifest.json value is a separate, install-time-only constant that cannot be live-synced by spec, so Fable should be explicit that only the meta tag becomes dynamic, to avoid a build spec that promises something the PWA spec can't deliver.
- ⚠️ `@import url(fonts.googleapis.com...)` (styles.css:8) is a render-blocking external font fetch with no local/self-hosted fallback, sitting directly above the token block this workstream will heavily edit — if a typography-scale pass touches the file header, re-verify PWA offline/slow-network behavior isn't worsened (the service worker's whole design point is an offline-capable shell).
- ⚠️ safe-area-inset handling (17 sites in css/styles.css + 5 more across js/app.js, departments.js, notifications.js) is currently ad hoc `calc(Npx + env(safe-area-inset-X, 0px))` literals with no `--safe-*` tokens — if consolidation introduces such tokens, ALL ~22 call sites must be updated consistently in the same pass, or iOS notch/home-indicator clipping regresses on a subset of screens (this exact class of PWA bug is easy to reintroduce partially).

## Files likely touched

`css/styles.css`, `js/app.js (THEMES/setTheme/getTheme/toggleTheme/_applyThemeIcon: lines 769-811; theme-swatch picker markup: 6924-6930; picker wiring: 7002-7015; fitKpiValues: 7098-7131; department render call sites using cfg.icon: 911, 3318, 3919-3920, 5116, 6040)`, `js/config.js (DEPARTMENTS icon/color fields: 70-121; *_BOTTOM_NAV arrays, already-Lucide reference pattern: ~144-180)`, `js/departments.js (department render call site 606; emoji-laden headers/buttons/empty-states/notification-icon fields throughout, e.g. 215-252, 744, 871, 1209-1327, 1649, 1734, 1934, 1987, 11275; the 4 inline @media print blocks at 4288/6780/7683/11990/12708 — likely OUT of scope, flagged for workstream 14 instead)`, `js/modules.js (emoji-laden headers/buttons/empty-states)`, `js/notifications.js (icon fallback rendering 103-118; send() default icon 251; reminder-icon call sites 569/593/619)`, `index.html (theme-color meta line 8 — made dynamic via JS; Lucide script tag line 295 — version/load-order preserved)`, `manifest.json (theme_color/background_color — reviewed for consistency with default runtime theme, understanding it can't live-sync)`, `sw.js (CACHE_VER bump — mandatory, last step)`, `quote-builder-v2.html (own :root + 149 var() usages — only if openDecision on scope says yes)`

## Expected deliverable format

> Fable's output should be structured so Sonnet can implement it mechanically with zero further judgment calls:
> 1. An explicit, final token table: every CSS custom property name (keeping vs renaming vs merging from the current 77 distinct var(--x) names / 104 declarations), one row per token, columns = {old name(s), new name, old value per theme (6 columns: office/dark/midnight/light/pink/grey), new value per theme, which of the 3 cascade layers it currently lives in}. No token should be left ambiguous between 'semantic' and 'raw palette' — pick one system and show it applied to at least 5 real examples (e.g. --pink used as both a brand-pink literal AND a generic 'accent' role today — show the split).
> 2. Before/after code blocks for every duplicate base-selector merge, keyed to the EXACT current line numbers found above (e.g. '.modal-box at styles.css:2104 + styles.css:3399 -> single merged rule at position X'), so Sonnet can locate-and-replace deterministically without re-deriving line numbers.
> 3. A `@layer` (or equivalent) decision made explicit with the exact `@layer` statement/ordering to add, OR an explicit statement that layers are being flattened and the exact merge order to follow.
> 4. An icon migration table: one row per distinct emoji glyph actually being replaced (not all 1,160 raw occurrences — the ~130 distinct glyphs), columns = {emoji, decision (replace with Lucide name / keep as brand content), Lucide icon name if replacing, exact call-site(s) with line number and a literal before/after code snippet, e.g. 'app.js:3919 `${cfg?.icon||"🗂️"}` -> `<i data-lucide="${cfg?.lucideIcon||"folder"}"></i>`'}, plus an explicit note next to every touched render function reminding Sonnet to add/keep the `lucide.createIcons()` call.
> 5. The exact `THEMES` object diff (app.js:770-777) showing the new 'auto' entry, plus the exact `matchMedia` + `change`-listener code block to insert near `initTheme()` (779-783), plus the exact meta-theme-color-sync code to insert inside `setTheme()` (785-793).
> 6. A numbered, sequential migration checklist (CSS token merge -> component selector dedup -> icon call-site swap -> theme-picker/meta-tag update -> focus-visible rule update -> typography-scale application -> final step: 'bump CACHE_VER in sw.js') so Sonnet executes in a safe order and can check items off.
> 7. A verification checklist: for each of the (6 or 7) themes, confirm dashboard KPI auto-fit still shrinks correctly at 375px width, a representative modal renders correctly, bottom-nav renders correctly, and a print-preview window still opens with its own (untouched) styling — i.e., an explicit regression checklist tied to the risks above, not just 'looks fine'.
