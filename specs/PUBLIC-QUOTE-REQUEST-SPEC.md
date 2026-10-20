# PUBLIC-QUOTE-REQUEST-SPEC — "Get a quote" intake + catalogue "Add to quote" + server-side estimate → Sales › Quote requests

_Architect: Fable 5.1 · 2026-10-21 · Status: SPEC (nothing built yet)._
_Implementers: Sonnet subagents, max effort, one workstream each (§10). Verifiers: adversarial, per workstream._

> **Read before anything else:** CLAUDE.md (every rule), STATUS.md (2026-10-21 public-website entry, 2026-09-27 CIR entry, the `portalUnlock` transaction lesson), `specs/PUBLIC-WEBSITE-SPEC.md`, `specs/CLIENT-INFO-REQUEST-SPEC.md` (§2 callables, §3 rules, §5 internal screen — this feature is its **sibling** and reuses its idioms verbatim), `functions/index.js` L3212–3990 (`cirRequireIpKey`, `cirRateLimit`, `cirLogAbuse`, `cirNotifyStaff`, `cirStartDraft`, `cirSubmit`, `cirAdminDelete`), `functions/cir-core.js`, `functions/portal-core.js` (`rateLimitDecision`, `clientIpFrom`, `rateLimitIpKey`, `newViewerToken`, `tokenHash`, `manilaDateFrom`, `CODE_ALPHABET`), `js/screens/client-info-requests.js` (the internal screen to clone), `scripts/build-catalogue.js` (the allowlist + money/brand guards), and `quote-builder-v2.html` L3392–3700 (`selectProduct`, `buildCalcPanel`, `renderDimInputs`, `computePrice`, `recomputePrice`, `addItemFromCalc`).

---

## 0. Summary

**What it is.** Every "Get a quote" call-to-action on the public website opens a short, mobile-first **intake sheet** (what you need · what it is for · government or private · target date · name · mobile · e-mail · company · delivery address · privacy consent). The visitor then browses the public catalogue page and taps **Add to quote** on any product; a per-item sheet lets them set a **custom size (W × D × H mm, defaulting to the product's default)**, quantity, the product's built-in spec options, and a note. A persistent **quote tray** shows the item count and an **estimated total as a rounded range**. **No per-item price is ever shown or sent to the browser.** The range is computed **only on the server** by a new `asia-east1` callable from the live Firestore product master using the quote builder's own pricing math (moved into a pure, shared, tested module — not forked). A **review** step shows the list, the range and the disclaimers; **Submit** writes `quote_requests/{ref}` through a callable, returns an on-screen receipt `QR-yymmdd-XXXXXX`, and notifies every Sales-department user and the President in-app and by push. Staff work the request in a new **Sales › Quote requests** chip tab: list, detail (intake · items · sizes · the range the client saw · the exact internal figure and per-item list prices, staff only), status, notes, **Open in Quote Builder** (prefilled with the client fields and the items at their list prices), **Convert to client (CRM)**, and Delete (President/Manager).

**Security shape (non-negotiable, same as CIR).** The repo is PUBLIC and the link is OPEN: nothing about a session or submission is publicly readable in Firestore; `qr_sessions` / `qr_ratelimit` / `qr_abuse` have **no rules match at all** (Admin SDK only); `quote_requests` is staff-read, callable-create/delete, staff-update on an allowlisted key set; every public callable is rate-limited per-IP **and** by IP-independent global caps, fail-closed; honeypot + server timing; strict allowlist validation against a **versioned definition** shared byte-for-byte by page, functions and internal renderer (`js/qr-def.js` ↔ `functions/qr-def.js`, ci-enforced); submission content is **attacker-controlled** and `escHtml()`'d everywhere it is rendered. The browser never receives a price, a rate, a formula field name, a midpoint, or a per-item figure — only `{low, high}` for the whole basket, after a minimum-basket gate.

**Pricing source decision (§6):** Firestore `products` + `productMeta/config` read by the Admin SDK inside the callable (cached in-memory 10 min). No gitignored copy in `functions/`. Reasons in §6.

**Companion — product-family configurators (`specs/PRODUCT-CONFIGURATOR-SPEC.md`).** The owner's "upgrade our sales computation" adds a family/option layer (tables, sinks, cabinets, shelves, racks, stoves with per-position burners, …) used by BOTH the Quote Builder and this public sheet. This spec is **Phase 0** of that plan and ships first in plain SKU mode; §15 lists the exact seams Phase B plugs into. Nothing here depends on it.

---

## 1. Owner rulings

### 1.1 RULED 2026-10-21 (binding — implement, do not re-ask)

| # | Ruling | Exact value chosen by this spec |
|---|---|---|
| R1 | **Estimate is computed server-side only.** The browser never receives per-item prices, formulas, rates or the exact total. | `qrEstimate` callable (§5.3). Response carries `{low, high, step}` only. `js/pricing-core.js` is loaded by the quote builder and by Cloud Functions — **never** by any public page (§7.2). |
| R2 | **Rounded range, about −10 % / +15 %, with a ₱5k / ₱10k step.** | `low = floorToStep(exact × 0.90)`, `high = ceilToStep(exact × 1.15)`; `step = 5,000` when `exact < 500,000`, `10,000` when `500,000 ≤ exact < 5,000,000`, `50,000` when `exact ≥ 5,000,000`. **Why asymmetric:** list prices carry the fixed ×2.50 build and the month-pace discount ladder only ever moves DOWN (5–13 % is the usual pace discount, 30 % max), so −10 % covers the typical discount; the UPSIDE is where surprises live — custom sizes staff must re-price, delivery/installation lines, misc costs — so +15 %. **Why these steps:** ₱5,000 is coarser than any single spec adder (the master's adders are hundreds to low thousands) so a spec change inside one item never visibly moves the range on its own; ₱10k/₱50k keep large baskets at ~1–2 % granularity so the figure still reads as "an estimate", not a price. Pinned in `tests/pricing-core.test.mjs`. |
| R3 | **Disclaimer text is fixed:** "Estimate only — your final quotation is prepared after our team reviews your list, sizes and site." | Rendered under every range (tray, review, receipt) from `QR_DEF.COPY.estimateDisclaimer`. |
| R4 | **Rate limits per CIR** (per-IP + IP-independent global caps, fail-closed, honeypot, timing). | §5.1 `RATE` table. |
| R5 | **Mobile number + e-mail are required** (company/agency optional). | Philippine mobile validation §4.3. |
| R6 | **Submissions land in a new Sales › Quote requests list; notifications to every Sales-department user + the President** (same recipient resolution as CIR R1; partners always dropped). | §5.4 step 11, §8. |
| R7 | **Government entities get the same estimate plus a procurement note.** | When `intake.entityType === 'government'` the range is unchanged and this line is added (tray/review/receipt): "Government purchases follow procurement rules — the estimate is for budget planning only; pricing is finalised in the bid documents." (`QR_DEF.COPY.governmentNote`). |

### 1.2 OPEN — proceed on the defaults (one row each in STATUS "Open rulings")

| # | Question | Default the implementer uses |
|---|---|---|
| O1 | **VAT wording** — show the range VAT-exclusive or VAT-inclusive? | **VAT-exclusive**, with the line "Excludes 12 % VAT." directly under the range. (Business clients expect ex-VAT; the quote builder's ladder adds VAT after discount.) Switch = `QR_DEF.ESTIMATE.vatBasis: 'exclusive' \| 'inclusive'` — inclusive multiplies `exact` by 1.12 before ranging and changes the line to "Includes 12 % VAT." |
| O2 | **Delivery & installation** — included in the range or not? | **Excluded**, line: "Delivery and installation are quoted separately once we know the site." (`QR_DEF.ESTIMATE.deliveryIncluded: false`). |
| O3 | **Minimum basket before a figure is shown** (differencing mitigation, §6.4). | Show the range only when **≥ 2 distinct priced products OR exact ≥ ₱50,000**. Below that the tray shows "Add more items to see an estimate — or submit now for a full quotation." (`QR_DEF.ESTIMATE.minDistinct: 2`, `minExact: 50000`). |
| O4 | **Retention** of quote requests. | Same as CIR R3: **flag-only** at 24 months, no auto-purge; notice promises deletion of unconverted requests within 24 months. |
| O5 | **Target date** — required? | **Required unless the visitor ticks "Not sure yet"** (stored `null`, `targetFlexible: true`). |
| O6 | **Unpriced catalogue products** (22 of 165 carry no list price in the master, e.g. delivery/installation lots). | They can be added; they are **excluded from the figure** and the tray shows "N item(s) priced after review." They never block submission. |
| O7 | **Estimate kill-switch** — should the owner be able to hide the range entirely (e.g. if the residual risk in §6.5 is judged unacceptable later)? | Yes: `productMeta/config.quoteRequest.estimateEnabled` (bool, default `true` when absent). When `false`, `qrEstimate` returns `{shown:false, reason:'disabled'}` and the UI shows "Submit your list and we will send a quotation." — no code deploy needed to flip it (President edits the doc from the Product Database page, or a console write). |

---

## 2. Hard constraints (restated — every workstream honours these)

1. **Vanilla JS, no bundler, no ESM imports.** Public page scripts are classic `<script>`s; internal screen is a `js/screens/*.js` lazy file on `window.*`.
2. **Versions are hook-owned.** Never touch `APP_VERSION`, the `vX.Y.Z` strings, `CACHE_VER`, `precache-manifest.json`. Never `--no-verify`.
3. **Never** `git stash`, `git reset --hard`, `git checkout -- <file>`, `git clean`, `git add -A`. Stage explicitly; `git diff --cached` before every commit. Verify in a **scratch copy**, never by mutating the shared tree.
4. **Commit gates, all three, before every commit:** `node --test tests/*.test.mjs && bash scripts/ci-invariants.sh && node scripts/check-ui-wiring.js`.
5. **Rules land BEFORE the code that needs them** (`release.sh rules`), functions deploy **selectively** by name, then `release.sh push` (§11).
6. **`js/money-core.js` is frozen/additive-only.** This spec adds **nothing** to it; the new pure pricing math lives in a sibling file under the same contract (§7.1). **A money change without a test is not done**, and every pricing test is **mutation-tested** (break the function in a scratch copy, confirm the suite fails).
7. **`escHtml()` every piece of submission content** before `innerHTML`; URLs only via `safeHttpUrl()`. Notifications: **plain emoji**, never `emojiIcon()` (ci-invariants check 5), no `<` in title/body.
8. **Manila time only:** `window.bizDate()` in the app; `manilaDate()` / `portal.manilaDateFrom()` in functions. Never `toISOString().slice(0,10)` for a business date.
9. **No price token may reach a public surface.** `scripts/build-catalogue.js`'s `MONEY_RE`/`FORMULA_RE`/`BRAND_RE` apply to everything the catalogue page emits, including the new data island (§3.4). `tests/catalogue-public.test.mjs` pins it.
10. **Do not edit the concurrently-restructured website files directly** (`index.html` `#site` block, `css/site.css`, `js/site.js`, the `/catalogue/` template in `scripts/build-catalogue.js`) beyond the **named hooks** in §3 — coordinate through the coordinator; re-read the tree before touching them.
11. **Firestore rules do not cascade; every collection is enumerated in §9.** `firestore.rules` is 131,670 B (130 KB headroom) — the §9 block is ~1.2 KB; ci-invariants CHECK 8 guards the cap.
12. **Never stage a write and then throw inside the same transaction callback** (STATUS 2026-09-26 lesson). Transactions return a verdict; errors are raised after commit.

---

## 3. Public surface — pages, hooks, flow

### 3.1 Where the UI lives (decision)

All quote-request UI (intake sheet, add-to-quote sheet, tray, review, receipt) is **one classic script, `js/quote-request.js`, plus one stylesheet, `css/quote-request.css`, loaded ONLY by the standalone catalogue page `/catalogue/`**. The homepage `/` (index.html, the app shell) gets **no new script**: its "Get a quote" CTAs become links to `/catalogue/?quote=1`, which opens the intake sheet on load. Reasons: (a) index.html is the precached app shell — a new `<script src="js/…">` there would have to join `sw.js` PRECACHE (CHECK 2) and every staff install would download quote UI it never uses; (b) the catalogue page is where "Add to quote" happens anyway; (c) one mount point, one draft store, one page to QA. The existing `/sales/clientinformationrequest/` (project brief) stays as it is and keeps its "Start a project brief" links — only **"Get a quote"** CTAs change (owner's words: "every Get-a-quote CTA").

### 3.2 Hooks the website/catalogue agent must provide (named by role — the files are still changing; re-read the tree before wiring)

**Tree state at spec time (2026-10-21, uncommitted):** `scripts/build-catalogue.js` has been retargeted to bake the product block into **`catalogue/index.html`** between the `CATALOGUE:START/END` markers (that file is a hand-written shell — not yet in the tree — and index.html carries no products); catalogue filtering/search moved from `js/site.js` into a new **`js/catalogue.js`** (`js/site.js` is shared by `/` and `/catalogue/`); product photos arrived (`scripts/product-photos.json` → `site/img/products/<slug>.webp`, cards show a photo with a "Representative image" caption); the homepage CTAs currently still point at `/sales/clientinformationrequest/`. Therefore: H2/H4/H5 go in the **shell** `catalogue/index.html` OUTSIDE the markers (the island is injected by the build at a `<!-- QR:DATA -->` placeholder in the shell); H3 goes in `renderCard()`; `quote-request.js` must coexist with `js/catalogue.js` — it injects `.qr-add` INSIDE each `.cat-card` (never changes the card's classes, `data-name`, or `.is-hidden` handling) and is listed AFTER `js/catalogue.js`.

| Hook (role) | Where | Exact contract |
|---|---|---|
| H1 **Get-a-quote CTA** | every `<a>` whose visible text is "Get a quote" in `index.html` `#site` (hero, `#contact`, footer `.foot-links`) and in the `/catalogue/` header | `href="/catalogue/?quote=1"` and attribute `data-qr-start`. "Start a project brief" / "Open the project brief form" links keep `/sales/clientinformationrequest/`. |
| H2 **Catalogue data island** | `catalogue/index.html` shell: a `<!-- QR:DATA -->` placeholder line that the build replaces with `<script type="application/json" id="qr-catalogue">{…}</script>` (the build also accepts an existing island between `<!-- QR:DATA:START -->`/`<!-- QR:DATA:END -->` markers and rewrites it, same idempotent pattern as the CATALOGUE markers) | shape in §3.4, emitted by a new `renderCatalogueData(db)` export of `scripts/build-catalogue.js` that passes every product through the SAME `publicProduct()` allowlist (incl. `TEXT_FIXES` so names match the cards) and the SAME money/brand scans. |
| H3 **Card identity** | every product card in the generated catalogue | `li.cat-card` carries `data-id="<product id>"` (the id already appears as the tile text; this only adds the attribute). `quote-request.js` injects the "Add to quote" button into each card at runtime (`.cat-card[data-id] > .qr-add`) — the build template does NOT render the button, so the template changes are limited to `data-id` + the island + the loads below. |
| H4 **Loads** | `catalogue/index.html` shell `<head>` / end of body | `<link rel="stylesheet" href="/css/quote-request.css">` after `css/site.css`; before `</body>`, AFTER `js/site.js` and `js/catalogue.js`: `<script defer src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script><script defer src="https://www.gstatic.com/firebasejs/10.12.2/firebase-functions-compat.js"></script><script defer src="/js/qr-def.js"></script><script defer src="/js/quote-request.js"></script>` (same SDK version as the CIR page; **no** Firestore/Auth/Storage SDK; **never** `/js/pricing-core.js`). If the shell carries a CSP meta, it must allow `script-src https://www.gstatic.com`, `connect-src https://*.cloudfunctions.net`, `style-src 'unsafe-inline'` (the sheets use classes only; inline styles are not required). |
| H5 **Mount point** | `catalogue/index.html` shell, last child of `<body>` before the scripts | `<div id="qr-root"></div>` — the tray and sheets render inside it; nothing else in the page is written by `quote-request.js` except the injected `.qr-add` buttons and a `data-qr-count` attribute on `.cat-card[data-id]` (shows "in quote ×N" badge via CSS). The photo caption / `<img>` a card may carry is untouched. |
| H6 **Specs default** | `scripts/build-catalogue.js` allowlist + `tests/catalogue-public.test.mjs` | `publicProduct()` additionally emits `specs[].default` (the option LABEL string, e.g. `"300mm"`) — it is a label, not a price; it is scanned by the same money regex. The test's "none of basePrice formula formulaType laborHours leadTime priceAdder" assertion is unchanged; add an assertion that `specs[].default` is a member of `specs[].options`. This is the ONE allowlist change. |
| H7 **Tokens** | `css/site.css` → `css/quote-request.css` | The quote UI uses ONLY `var(--site-*)` tokens defined on `#site`/the catalogue page root (`--site-accent`, `--site-ink`, `--site-muted`, `--site-line`, `--site-soft`, `--site-radius`, `--font`) plus its own `--qr-*` fallbacks (`#qr-root{--qr-accent:var(--site-accent,#0F6CBD);…}`) so it follows whatever direction the site adopts (navy/gold/serif included) without edits. No colour literals except the fallbacks. |
| H8 **Sitemap/robots** | `robots.txt` / `sitemap.xml` | No change — `/catalogue/` is already public; the quote UI adds no URL. |
| H9 **Service worker** | `sw.js` | **No PRECACHE entry** for `/catalogue/`, `/css/quote-request.css`, `/js/quote-request.js`. A navigation to `/catalogue/` is network-first with a 3 s ceiling and never falls back to the app shell (`networkFirstTimeout` matches the same URL only). `js/qr-def.js` IS precached (§7.4) because the internal screen loads it via `PAGE_SCRIPTS`. |

### 3.3 Visitor flow (state machine; everything in `quote-request.js`)

```
boot ─► read draft (localStorage) ─► render tray if items>0 or intake done
  │
  ├─ ?quote=1 / #quote / click [data-qr-start] ─► INTAKE sheet (steps 1–3, see §4.1)
  │        done ─► toast "Now add items from the catalogue" ─► scroll to #catalogue (tray visible)
  │
  ├─ click .qr-add[data-id] ─► ITEM sheet (size · qty · specs · note) ─► Add ─► draft.items.push ─► tray
  │        (if the same id+size+specs already exists: offer "Add another" (qty+1) or "Add as new line")
  │
  ├─ tray "View quote" ─► REVIEW sheet: items list (edit/remove), intake summary (edit → INTAKE),
  │        contact fields (if intake not done, REVIEW shows the intake first),
  │        estimate block (range | gate message | disabled message), disclaimers, consent, Submit
  │
  └─ Submit ─► qrSubmit ─► RECEIPT sheet (ref no., Manila date, summary, print) ─► draft cleared
```

- **Estimate refresh:** the tray calls `qrEstimate` **debounced 1,200 ms** after any items change (add/remove/qty/size/spec), only when `items.length > 0`, and never more than once per unique basket (client-side cache keyed by `basketKey` = JSON of sorted `[id, size, specs, qty]`; survives in memory only — **the cache never enters localStorage**). While pending: tray shows "Estimating…". Errors: `resource-exhausted` → "Estimate paused for a while — you can still submit."; anything else → "Estimate unavailable right now — you can still submit." The last successful `{low, high, basketKey}` is kept in memory and sent with the submission as `lastEstimate` (server recomputes anyway; this lets staff see what the client last saw if the basket changed after the last estimate — the server records both).
- **Session token:** `qrStartSession` is called lazily the first time an estimate or a submit is needed; the token is stored in the draft (`sessionToken`, `sessionCreatedAtIso`). Expired (7 days) → new session.
- **Draft persistence (localStorage key `barro-qr-draft-v1`, all access in try/catch):**
  ```
  { v:1, intake:{…}|null, contact:{…}|null, items:[{uid, id, name, cat, unit, size:{W,D,H}|null, runs:number|null, specs:[{label,value}], qty, note}],
    sessionToken, sessionCreatedAtIso, startedAtMs, savedAtMs }
  ```
  **No prices, no estimate, no range are ever stored.** Saved on every change (debounced 300 ms). Cleared on successful submit and by "Clear quote" (confirm). `name`/`cat`/`unit` are stored for display only; the server re-derives them from the product master by `id` and ignores the stored copies.
- **Deep link survival across `/` → `/catalogue/`:** the homepage carries no quote UI; the draft lives in localStorage on the same origin, so a visitor who started on `/` (via the CTA, which navigates to `/catalogue/?quote=1`) and later returns to `/catalogue/` finds the tray intact.

### 3.4 Catalogue data island (`#qr-catalogue`) — price-free by construction

```json
{ "v": 1, "generatedOn": "2026-10-21",
  "products": [
    { "id": "CE-001", "name": "SS Open Top Low Pressure Stove (1 Burner)", "cat": "cooking_line", "unit": "pc",
      "dims": { "W": 600, "D": 700, "H": 850 },
      "specs": [ { "label": "Basin Depth", "options": ["250mm","300mm","350mm"], "default": "300mm" } ] }
  ] }
```
- Emitted by `renderCatalogueData(db)` in `scripts/build-catalogue.js`: `products = db.products.map(publicProduct)` (same allowlist, same `NOTE_OVERRIDES`, same brand scan), then projected to **only** `id, name, cat (= category), unit, dims (= defaultDimensions, only finite positive W/D/H), specs[].{label, options, default}`. `notes`/`material` are deliberately NOT in the island (they are already in the cards). The serialized island is run through `isMoneyish()` and `BRAND_RE` and the build THROWS on a hit. `</script` inside any string is escaped as `<\/script` (JSON-safe) — test it.
- **No `formulaType`, no `formula`, no `basePrice`, no `priceAdder`, no `leadTime`.** The client decides which dimensions are editable purely from `dims` keys present (W/D/H) and whether the unit is `run` (then "Number of runs" replaces size). The server decides pricing from the real `formulaType`.
- `tests/catalogue-public.test.mjs` gains: island JSON parses; every product has `id/name/cat`; `JSON.stringify(island)` matches neither `MONEY_RE` nor `FORMULA_RE` nor `/formulaType|basePrice|priceAdder|leadTime|laborHours/`; a fixture with `specs[].priceAdder` yields no `priceAdder`; `</script` is escaped.

---

## 4. Definitions — `js/qr-def.js` (canonical) ↔ `functions/qr-def.js` (byte-identical mirror, ci-enforced)

UMD shim exactly like `js/cir-forms.js`:
```js
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.QR_DEF = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  var VERSION = 1;                       // bump on ANY change to INTAKE/LIMITS/ESTIMATE/NOTICE/COPY
  var INTAKE = { … };  var LIMITS = { … };  var ESTIMATE = { … };  var PRIVACY_NOTICE = { … };  var COPY = { … };
  return { VERSION: VERSION, INTAKE: INTAKE, LIMITS: LIMITS, ESTIMATE: ESTIMATE, PRIVACY_NOTICE: PRIVACY_NOTICE, COPY: COPY };
});
```

### 4.1 `INTAKE` (option VALUES are stored; LABELS are shown)

```js
var INTAKE = {
  need: { label: 'What best describes what you need?', required: true, options: [
    { v: 'full_kitchen', l: 'Full kitchen design & build package' },
    { v: 'equipment',    l: 'Individual kitchen equipment' },
    { v: 'fabrication',  l: 'Custom stainless or metal fabrication' },
    { v: 'exhaust',      l: 'Exhaust hood, ducting & fresh-air system' },
    { v: 'gas_line',     l: 'LPG gas line & manifold' },
    { v: 'fire',         l: 'Fire suppression system' },
    { v: 'service',      l: 'Repair or maintenance of existing equipment' },
    { v: 'other',        l: 'Something else' }                      // reveals needOther (text ≤120, required when chosen)
  ]},
  useFor: { label: 'What will you use this for?', required: true, options: [
    { v: 'restaurant_cafe', l: 'Restaurant / café' },
    { v: 'hotel_resort',    l: 'Hotel / resort' },
    { v: 'commissary',      l: 'Commissary / central kitchen' },
    { v: 'catering',        l: 'Catering / events' },
    { v: 'school',          l: 'School / university' },
    { v: 'hospital',        l: 'Hospital / clinic' },
    { v: 'government',      l: 'Government office / LGU' },
    { v: 'home',            l: 'Home / residential' },
    { v: 'other',           l: 'Other' }                            // reveals useForOther (text ≤120, required when chosen)
  ]},
  entityType: { label: 'Are you a government or private entity?', required: true, options: [
    { v: 'private',    l: 'Private business or individual' },
    { v: 'government', l: 'Government agency / LGU / state school' }
  ]},
  targetDate: { label: 'Target date', required: true, flexibleLabel: 'Not sure yet' },   // O5
  name:        { label: 'Your name',                  required: true,  max: 120, autocomplete: 'name' },
  mobile:      { label: 'Mobile number',              required: true,  placeholder: '09XX XXX XXXX', autocomplete: 'tel' },
  email:       { label: 'E-mail',                     required: true,  max: 160, autocomplete: 'email' },
  company:     { label: 'Company / agency (optional)', required: false, max: 120, autocomplete: 'organization' },
  address:     { label: 'Delivery address',           required: true,  max: 500, rows: 2, autocomplete: 'street-address' },
  notes:       { label: 'Anything else we should know? (optional)', required: false, max: 1000, rows: 3 }
};
```
Steps on the page: **1** need + useFor + entityType · **2** targetDate + address · **3** name + mobile + email + company + notes + consent. Three screens, back/next, progress "Step n of 3".

### 4.2 `LIMITS`

```js
var LIMITS = {
  maxItems: 40,              // lines per request
  maxQtyPerLine: 20,         // qty (or runs) per line
  maxNote: 240,              // per-item note
  minDimMm: 100,  dimStepMm: 10,                     // sizes are integers, multiples of 10, ≥ 100
  maxDimFactor: 3, maxDimAbsMm: { W: 6000, D: 3000, H: 3000 },   // per dimension: ≤ min(default × 3, abs cap); a product with no default for that dim is not customisable in it
  maxRuns: 20,
  maxPayloadBytes: 60000,    // JSON.stringify(payload).length, checked client AND server
  minFillMs: 20000,          // submit must be ≥ 20 s after the session was created (server clock)
  sessionTtlMs: 7 * 24 * 3600e3,
  estimateDebounceMs: 1200,
  dupWindow: 'day'           // same email+mobile fingerprint on the same Manila date
};
```

### 4.3 Validation rules (server is the authority; the page mirrors them for UX)

| Field | Rule |
|---|---|
| `need`, `useFor`, `entityType` | must equal one option value |
| `needOther` / `useForOther` | required iff the matching select is `'other'`; `stripText` ≤ 120; otherwise must be absent |
| `targetDate` | `YYYY-MM-DD`, calendar-valid, `≥ manilaDate(now)` and `≤ now + 3 years`; OR `targetFlexible: true` with `targetDate: null` |
| `name` | `stripText`, 2..120 chars |
| `mobile` | strip spaces, dashes, dots, parentheses; accept `^09\d{9}$` or `^(\+?63)9\d{9}$`; **store normalised as `09XXXXXXXXX`**; else "Enter a Philippine mobile number (09XX XXX XXXX)." |
| `email` | `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, ≤ 160, lower-cased for the fingerprint only (stored as typed, trimmed) |
| `company` | optional, `stripText` ≤ 120 |
| `address` | multiline strip, 5..500 |
| `notes` | multiline strip ≤ 1000 |
| `items[]` | 1..`maxItems`; each `{ id, qty, size, runs, specs, note }` validated by `pricing-core.validateSelection` against the product master (§7.1): unknown `id` → `invalid-argument 'An item in your list is no longer in the catalogue — remove it and try again.'` (the page removes it and marks the line); `qty` integer 1..`maxQtyPerLine`; `size` present only for products with dims, each present key an integer multiple of 10 within bounds; `runs` present only for `unit === 'run'` products, integer 1..`maxRuns`; `specs` = `[{label, value}]` where each label is one of the product's spec labels (each at most once) and `value` is one of that spec's options — missing spec → the product's `default`; `note` `stripText` ≤ `maxNote` |
| `consent` | `agreed === true`, `noticeVersion === PRIVACY_NOTICE.version` |
| `honeypot` | must be `''` (field name `website_url`) — non-empty → fake success (§5.4) |

### 4.4 `ESTIMATE` (the ruled values, in one place)

```js
var ESTIMATE = {
  version: 1,                       // stamped on every stored estimate; bump when any number below changes
  lowFactor: 0.90, highFactor: 1.15,                                   // R2
  steps: [ { below: 500000, step: 5000 }, { below: 5000000, step: 10000 }, { below: Infinity, step: 50000 } ],   // R2
  minDistinct: 2, minExact: 50000,  // O3 gate: shown iff distinctPriced >= 2 OR exact >= 50000
  vatBasis: 'exclusive',            // O1
  deliveryIncluded: false,          // O2
  currency: 'PHP'
};
```

### 4.5 `PRIVACY_NOTICE` (version `'2026-10-21.1'`)

`consentLine`: "I agree to Barro Industries using these details and my item list to prepare an estimate and a quotation, in line with the Data Privacy Act of 2012 (RA 10173)."
`sections`: copy CIR's eight headings verbatim with these substitutions — "What we collect on this page": "Your name, company or agency, mobile number, e-mail, delivery address, your answers about what you need and what it is for, the items, sizes and notes you add to your quote, the date and time you send it, and your device's IP address and browser identifier."; "Why": "To estimate and prepare a quotation for the items you selected and to contact you about it."; "How long we keep it": "If no project follows, up to twenty-four (24) months from our last contact with you, then deleted. If a project follows, for the life of the project and ten (10) years after turnover. You may ask us to delete this request at any time."; "Security": "… This page stores a draft of your list and your details only in your own browser — never prices — and no advertising cookies." Everything else byte-for-byte from CIR (controller, lawful basis, sharing, rights).
Server computes `noticeSha256 = sha256(JSON.stringify(PRIVACY_NOTICE.sections))`.

### 4.6 `COPY` (every user-facing string the server or page needs to agree on)

```js
var COPY = {
  estimateDisclaimer: 'Estimate only — your final quotation is prepared after our team reviews your list, sizes and site.',   // R3
  vatExclusive: 'Excludes 12 % VAT.', vatInclusive: 'Includes 12 % VAT.',
  deliveryExcluded: 'Delivery and installation are quoted separately once we know the site.',
  governmentNote: 'Government purchases follow procurement rules — the estimate is for budget planning only; pricing is finalised in the bid documents.',   // R7
  gateMessage: 'Add more items to see an estimate — or submit now for a full quotation.',
  disabledMessage: 'Submit your list and we will send a quotation.',
  reviewCount: function (n) { return n + ' item' + (n === 1 ? '' : 's') + ' priced after review.'; },
  customSizeNote: 'Custom sizes are confirmed in the quotation.',
  receiptTitle: 'Quote request sent', receiptBody: 'Thank you. Our team will review your list and send a quotation. Keep your reference number.',
  privacyLine: 'We use these details only to prepare your quotation (RA 10173).'
};
```

---

## 5. Callables (`functions/index.js` — append after `cirAdminDelete`; pure logic in `functions/qr-core.js`)

### 5.0 Shared layout

- **`functions/qr-core.js`** — pure, zero-Firebase CommonJS, tested by `tests/quote-request.test.mjs`: `require('./portal-core')` (`CODE_ALPHABET`, `manilaDateFrom`, `newViewerToken`, `tokenHash`), `require('./qr-def')`, `require('./pricing-core')`. Exports: `RATE`, `refNo(nowMs, randomBytes)` → `'QR-' + yymmdd + '-' + 6×CODE_ALPHABET` (copy cir-core's body, prefix changed), `stripText` (re-export cir-core's), `validateIntake(raw)` → `{ok, errors, clean}`, `validateContact(raw)` → `{ok, errors, clean}` (mobile normalisation here), `normaliseItems(rawItems, productsById)` → `{ok, errors, items}` (uses `pricing.validateSelection`), `computeBasket(items, productsById, constants, estimateCfg)` → `{ exact, lines:[{id, unitPrice, lineTotal, priced, warnings, sizeAdjusted}], pricedCount, reviewCount, distinctPriced }` (uses `pricing.priceCatalogItem`), `rangeFor(exact, cfg)` → `{low, high, step}` (delegates to `pricing.estimateRange`), `gateFor(basket, cfg)` → `{shown, reason}`, `basketHash(items)` → sha256 of the canonical sorted JSON of `[id, size, runs, specs, qty]`, `botCheck`, `fingerprintDay(email, mobile, manilaDate)` (reuse cir-core's), `buildSummary(clean)`, `buildNotification(doc)` (plain emoji, no `<`), `privacyNoticeSha256()`, `publicEstimate(basket, range, gate, cfg, entityType)` → the EXACT response object of §5.3 (so the test can assert it contains no `exact`, no `lines`, no `unitPrice`).
- **`functions/index.js`** — thin Admin-SDK glue: `const qr = require('./qr-core');` next to the `cir` require (one line). Reuse `portalClientIp`, `cirRequireIpKey` (its abuse log lands in `cir_abuse` — acceptable, note in code), `cirRateLimit` (takes refs — pass `qr_ratelimit` refs), `portalSha256Hex`, `manilaDate`, `commitInChunks`, and the recipient-resolution body of `cirNotifyStaff` (extract `resolveSalesAndPresidentUids(db)` as a shared helper used by BOTH `cirNotifyStaff` and the new `qrNotifyStaff` — a pure refactor of the three-query union; CIR behaviour byte-identical).
- **Product master cache (`qrLoadProducts(db, nowMs)`):** reads `products` (limit 1000) + `productMeta/config` once per instance and caches `{ byId, constants, estimateEnabled, loadedAt }` for `QR_PRODUCTS_TTL_MS = 600000`. Each product is normalised with the SAME mapping `quote-builder-v2.html`'s `loadDatabase()` uses (`name: p.title||p.name`, `formulaType: p.formulaType||'fixed'`, `basePrice: p.basePrice ?? p.baseRate ?? 0`, `defaultDimensions: p.measurement || p.defaultDimensions || {}`, `formula: p.formula || {}`, `specs: Array.isArray(p.specs) ? p.specs : []`, `unit: p.unit || 'pc'`) — put this mapping in `qr-core.normaliseProductDoc(id, data)` and TEST it. `constants = meta.constants || {}`; `estimateEnabled = meta.quoteRequest?.estimateEnabled !== false`. A load failure → `unavailable` (fail closed; never price from a stale cache older than 24 h — if the cache is < 24 h old and a refresh fails, serve the cache and `console.error`).

### 5.1 Rate limiting

Buckets in `qr_ratelimit/{bucketId}` (bucketId = `portalSha256Hex(scope + '|' + ipKey)` for per-IP; literals `global_start`, `global_estimate`, `global_submit`). `cirRateLimit` semantics (every call counts; fail closed; lockout escalates). Config (`qr.RATE`):

| scope | window | max | lock | maxLock | why |
|---|---|---|---|---|---|
| `start` (per IP) | 1 h | 20 | 1 h | 24 h | as CIR |
| `globalStart` | 1 h | 300 | 30 min | 6 h | as CIR |
| `estimate` (per IP) | 1 h | **60** | 1 h | 24 h | an honest visitor changes the basket a few dozen times; a differencing attacker needs hundreds (§6.4) |
| `estimateSession` (per session token, counter on the `qr_sessions` doc, not a bucket) | 24 h | **150** | — | — | second bound independent of IP rotation; checked in the same transaction that bumps `estimateCount` |
| `globalEstimate` | 1 h | **2,000** | 15 min | 2 h | bounds total Firestore reads/compute; well above honest load |
| `submit` (per IP) | 24 h | 5 | 24 h | 7 d | as CIR |
| `globalSubmit` | 1 h | 40 | 30 min | 6 h | as CIR |

Additionally an **in-memory per-instance LRU (256 entries, 10 min)** keyed by `basketHash + estimateVersion + productsLoadedAt` returns a cached estimate without re-pricing. Cache hits still count against the buckets (it is a cost optimisation, not a security control).

### 5.2 `qrStartSession` — anonymous, `region('asia-east1').https.onCall`

Request `{ defVersion: number }`. Steps: `defVersion === QR_DEF.VERSION` else `failed-precondition 'This page was updated — please reload.'`; `ipInfo/ipKey` via `portalClientIp` + `cirRequireIpKey`; rate limit `start|ip` + `global_start`; mint `{token, tokenHash}` = `portal.newViewerToken()`; `qr_sessions/{tokenHash}.create({ createdAt: serverTimestamp, ipHash, uaHash, estimateCount: 0, lastEstimateAt: null, lastBasketHash: null, submittedAt: null, refNo: null })`; best-effort purge of ≤ 5 sessions older than `sessionTtlMs` (`orderBy('createdAt','asc').limit(5)`, age-filter in code, no index). Response `{ ok: true, sessionToken: token, serverNow: ISO }`.

### 5.3 `qrEstimate` — anonymous

Request:
```
{ sessionToken: string(43 base64url), defVersion: number, entityType: 'private'|'government',
  items: [ { id: string, qty: int, size: {W?:int, D?:int, H?:int} | null, runs: int | null, specs: [ {label, value} ] } ] }
```
Order:
1. Shape: `JSON.stringify(data).length ≤ LIMITS.maxPayloadBytes`; token regex `/^[A-Za-z0-9_-]{43}$/` else `unauthenticated 'Please reload the page.'`; `defVersion` match; `items` array 1..`maxItems`.
2. Rate limit (one transaction): `estimate|ip` + `global_estimate`.
3. Session: read `qr_sessions/{tokenHash}`; must exist, `submittedAt == null`, not expired → else `failed-precondition 'Your session expired — reload the page (your list is saved on this device).'`. Transaction: if `estimateCount >= RATE.estimateSession.max` and `lastEstimateAt` within 24 h → return verdict `blocked` (no write) → throw `resource-exhausted 'Estimate paused for today — you can still submit your list.'` AFTER the transaction; else `update({ estimateCount: +1, lastEstimateAt: serverTimestamp, lastBasketHash })`.
4. Products: `qrLoadProducts`. If `!estimateEnabled` → return `qr.publicEstimate(null, null, {shown:false, reason:'disabled'}, …)` (no pricing performed).
5. `qr.normaliseItems(items, byId)` → `invalid-argument` with the first error.
6. LRU lookup by `basketHash`; miss → `basket = qr.computeBasket(items, byId, constants, ESTIMATE)`; `range = qr.rangeFor(basket.exact, ESTIMATE)`; `gate = qr.gateFor(basket, ESTIMATE)`.
7. Best-effort log (never fails the call): every **20th** estimate per instance AND every gate-denied call writes `qr_abuse { kind:'estimate_sample', ipHash, detail:{ basketHash, lines: items.length, shown } }` — forensic sampling, no prices.
Response (**exactly** these keys, nothing else — pinned by test):
```
{ ok: true, shown: boolean, reason: null | 'gate' | 'disabled',
  low: number|null, high: number|null, step: number|null, currency: 'PHP',
  vatBasis: 'exclusive'|'inclusive', deliveryIncluded: false,
  pricedCount: number, reviewCount: number, customSizeCount: number,
  notes: string[],            // from COPY: vat line, delivery line, governmentNote when entityType==='government', customSizeNote when customSizeCount>0, reviewCount(n) when >0
  basketHash: string, estimateVersion: number, serverNow: ISO }
```
`low/high/step` are `null` whenever `shown === false`. `pricedCount/reviewCount` are counts of LINES (not pesos). **Never** `exact`, never per-line anything, never product-level flags beyond the counts.

### 5.4 `qrSubmit` — anonymous

Request:
```
{ sessionToken, defVersion, intake: { need, needOther?, useFor, useForOther?, entityType, targetDate|null, targetFlexible?, address, notes? },
  contact: { name, mobile, email, company? }, items: [ { id, qty, size, runs, specs, note } ],
  consent: { agreed: true, noticeVersion }, honeypot: string, fillMs: number,
  lastEstimate: { low, high, basketHash } | null }
```
Order (each failure code is what the page switches on — §5.6):
1. Shape + size; token; `defVersion`; `consent.agreed === true` else `invalid-argument 'Please tick the data privacy consent.'`; `noticeVersion === PRIVACY_NOTICE.version` else `failed-precondition 'The privacy notice was updated — please reload and review it again.'`.
2. Rate limit: `submit|ip` AND `global_submit`.
3. `qr.validateIntake`, `qr.validateContact` → `invalid-argument` (first 3 errors joined; `qr_abuse {kind:'bad_payload'}` on an unknown key).
4. Session read: exists, unsubmitted, unexpired → else `failed-precondition` (session message above).
5. Bot check: `honeypot !== ''` or `nowMs - session.createdAt < LIMITS.minFillMs` → `qr_abuse {kind}` best-effort and **return a plausible fake success** `{ ok:true, refNo: qr.refNo(nowMs), receivedAt, submittedOnManila, estimate: lastEstimate ? {low:lastEstimate.low, high:lastEstimate.high} : null }` — nothing written, no notification.
6. Products + `normaliseItems` → `invalid-argument` naming "An item in your list is no longer available — remove it and try again." (the page removes unknown ids and re-opens review).
7. `basket = computeBasket(...)`, `range = rangeFor(...)`, `gate = gateFor(...)` — computed **again on the server at submit time**; this is what is stored. If `lastEstimate` is present and `lastEstimate.basketHash !== basketHash(items)`, record `estimateMismatch: true` (staff see "client's last view may differ").
8. Duplicate guard: `fpDay = fingerprintDay(email, mobile, manilaDate())`; `quote_requests.where('fingerprintDay','==',fpDay).limit(1)` non-empty → `already-exists 'We already received a quote request from this e-mail and number today. Call 0927 683 6300 to add to it.'`.
9. Mint `refNo`; collision retry once; then `internal`.
10. **Transaction** (returns a verdict, never throws inside): re-read session (`submittedAt == null` else verdict `expired`); `tx.create(quote_requests/{refNo}, doc)` (§8.1 shape); `tx.update(session, { submittedAt: serverTimestamp, refNo })`. Verdict `expired` → throw `failed-precondition` after; other error → `internal 'Could not record your request — please try again.'`.
11. Post-commit, best-effort, each in its own try/catch: (a) `qrNotifyStaff(db, doc, refNo)` — recipients via the shared `resolveSalesAndPresidentUids` (Sales dept legacy field + array field + role president, deduped, partners dropped), `notifications/{uid}/items/{autoId}` with `{ ...qr.buildNotification(doc), dedupKey: 'qr_' + refNo + '_' + uid }` — exactly the rules allowlist (`title, body, icon, type, link, read, createdAt, dedupKey`), **no `senderUid`** (system send); (b) stale-session purge ≤ 5.
Response `{ ok: true, refNo, receivedAt: ISO, submittedOnManila, estimate: gate.shown ? { low, high } : null }`.

### 5.5 `qrAdminDelete` — **staff-authenticated**

Request `{ refNo: /^QR-\d{6}-[A-Z2-9]{6}$/ }`. `context.auth` required; `users/{uid}.role` ∈ `president|manager` else `permission-denied`. Delete `notes` subcollection (batched), delete the doc, write `audit_log { ts, action:'delete', entity:'quote_request', entityId: refNo, actorUid, actorName, actorRole, details:{ company: summary.company, items: summary.itemCount } }`. Idempotent. Response `{ ok: true }`.

### 5.6 Error codes the page must handle

| code | page behaviour |
|---|---|
| `resource-exhausted` | estimate: tray "Estimate paused for a while — you can still submit." submit: show message verbatim, keep draft, re-enable |
| `invalid-argument` | show message; for item errors remove the named/unknown line and re-open review; focus the first invalid field |
| `failed-precondition` | message + Reload button; draft kept |
| `already-exists` | message; keep draft; re-enable |
| `unauthenticated` | drop `sessionToken` from the draft, `qrStartSession` again, retry ONCE, else generic error |
| `unavailable` / `internal` / network | "Something went wrong on our side — your list is saved on this device. Please try again in a moment." + Retry; offline banner when `!navigator.onLine` |

---

## 6. Pricing: source, math reuse, custom sizes, the differencing attack

### 6.1 Pricing source — DECISION: Firestore `products` + `productMeta/config` via Admin SDK

Options weighed:
| Option | Deploy friction | Staleness | Public-repo exposure | Verdict |
|---|---|---|---|---|
| (a) gitignored `functions/products-database.json` copied from the private master at deploy time | High: the master is at `~/Desktop/barro-private/` on the owner's machine only — **on this machine that folder does not exist** (verified 2026-10-21), so a deploy from any other checkout would ship a function with no prices or a stale copy | Drifts from the President's live edits in the Product Database page | None (ignored) but easy to mis-stage | Rejected |
| (b) Firestore `products` + `productMeta/config` (the quote builder's **primary** source, 170 docs, seeded; `basePrice`, `formula`, `specs[].priceAdder`, `measurement` live on the docs; rules: `read: isAuth()` — never public) | None — the function reads at runtime | None — the same doc the President edits is what prices the estimate; 10-min cache | None — data never enters the repo | **Chosen** |
| (c) a private Storage object / Firestore doc holding the JSON | Needs a new upload step and a second copy to keep in sync with (b) | Drifts from (b) | None | Rejected (duplicate of b) |

Consequence: the public estimate equals what a staff member would see in the quote builder for the same catalogue items **before** any costed-line auto-repricing, volume tiers, discounts, misc costs, rush or VAT — i.e. the list-price path (`computePrice`). Costed catalogue items can auto-reprice in the builder (`applyComputedPricing`, direct × 2.50) — those lines are inside the +15 % band by design and the staff quotation is the authority. `volumeTiers` are **ignored** by the estimate (they only ever lower the figure, which the −10 % band already covers).

### 6.2 Math reuse — `js/pricing-core.js` (new, pure; sibling of money-core under the same frozen/additive, test-pinned, mutation-tested contract)

Why a sibling file and not an export added to `money-core.js`: Cloud Functions deploy only `functions/` (firebase.json), so the shared math must be mirrored there byte-for-byte (the `cir-forms` precedent, ci-enforced). Mirroring all 837 lines of `money-core.js` (payroll engines, statutory resolution) into a public-intake function bundle buys nothing and widens what a function reviewer must read. `pricing-core.js` is ~150 lines, has zero dependencies, and the quote builder (which does not load `money-core.js` either) can load it with one `<script>` tag. Its header states it is under **the money-core contract**: pure, no DOM/Firebase/clock, every change needs a pinned + mutation-tested test.

UMD shim as in money-core (`if (typeof window === 'undefined') globalThis.window = globalThis;` + trailing `module.exports` guard). Exports (all on `window.*` too):

```js
// priceCatalogItem(product, sel, constants) -> { unitPrice:int, priced:bool, warnings:string[], sizeAdjusted:bool }
//   product: { id, formulaType, basePrice, defaultDimensions, formula, specs }  (quote-builder DB shape)
//   sel:     { dims: {W?,D?,H?} (mm, ONLY the keys the caller shows as inputs), runs:number|null, specIdx:number[] (one index per product.specs entry) }
//   constants: { materialPriceIndexMultiplier?:number }
// BYTE-EQUIVALENT to quote-builder-v2.html computePrice() as of 2026-10-21 (L3611–3668), with the DOM reads replaced by `sel`:
//   price = basePrice
//   per_length: W = sel.dims.W ?? dd.W ?? 900; extra = max(0, W − (formula.baseLengthMm||900)); price = basePrice + extra × (formula.pricePerExtraMm||0);
//               for dim of [D,H]: if (dim in sel.dims) and dd[dim] != null and sel.dims[dim] > dd[dim]: rate = formula['rate'+dim+'100'];
//               rate == null → warnings.push('No rate on file for custom '+label+' — priced at default size for '+label) ; else price += ((val − dd[dim]) / 100) × rate
//   per_area:   W = sel.dims.W ?? dd.W ?? 1000; H = sel.dims.H ?? dd.H ?? 1000; price = (W×H/1e6) × (formula.pricePerSqm||0)
//   per_run:    runs = sel.runs || 1; price = (formula.pricePerRun || basePrice) × runs
//   price *= (constants.materialPriceIndexMultiplier || 1)
//   specs: for each product.specs[i]: adder = specs[i].priceAdder && specs[i].priceAdder[sel.specIdx[i]] ? … : 0; price += adder
//   unitPrice = max(0, round(price));  priced = unitPrice > 0
//   sizeAdjusted = any sel.dims key differs from dd (informational; for 'fixed'/'configurable' products the price does NOT change with size — exactly as the builder)
// validateSelection(product, raw, LIMITS) -> { ok, errors:string[], sel:{dims,runs,specIdx}, specs:[{label,value}], sizeCustom:bool }
//   dims allowed keys = keys of product.defaultDimensions with a finite positive value; per_area products expose W,H only; per_run products expose none and require runs; otherwise runs must be absent
//   each dim: integer, multiple of LIMITS.dimStepMm, >= LIMITS.minDimMm, <= min(default × LIMITS.maxDimFactor, LIMITS.maxDimAbsMm[dim])
//   specs: raw.specs = [{label,value}] → specIdx by label; a missing spec takes product.specs[i].default's index (or 0 if default absent); unknown label/value → error
// estimateRange(exact, cfg) -> { low, high, step }   // cfg = QR_DEF.ESTIMATE; exact <= 0 → {low:0, high:0, step: cfg.steps[0].step}
//   step = first cfg.steps entry with exact < below; low = floor(exact×lowFactor / step)×step; high = ceil(exact×highFactor / step)×step; if high === low → high = low + step
// estimateGate(basket, cfg) -> { shown:bool, reason:null|'gate' }   // shown = basket.distinctPriced >= cfg.minDistinct || basket.exact >= cfg.minExact
```

**Quote-builder delegation (WS-P, no user-visible change, no tutorial bump):** `quote-builder-v2.html` adds `<script defer src="js/pricing-core.js"></script>` immediately after `js/letterhead.js` (L1875), and `computePrice(p)` becomes: build `sel` from the existing globals/DOM (`dims: {…dimsMm}` for the keys present, `runs: runsVal`, `specIdx` from each `#spec_i` select, `0` when the select is absent), call `window.priceCatalogItem(p, sel, DB.constants||{})`, set `calcPriceWarning = r.warnings.join(' ')` (the builder's existing single-string warning — concatenate exactly `No rate on file for custom ${labels.join(' / ')} — priced at default size for ${labels.join('/')}.` by having pricing-core return `warnings` AND `missingRateLabels:[]`, and the builder composing the old sentence from `missingRateLabels` so the on-screen text is byte-identical), `return r.unitPrice`. The old body is **deleted** (no fallback fork). `file://` mode still works (relative script). **Parity proof (acceptance):** in a browser on `npx serve -p 3737 .`, for 6 products (one per formulaType + two with specs + one fixed-with-dims) at default and at custom sizes, the calc panel price before and after the change is identical (record the six pairs in the commit message). `sw.js` PRECACHE gains `'/js/pricing-core.js'` after `'/js/money-core.js'` (the builder is precached and must price offline).

### 6.3 Custom sizes — what the visitor sees and what the estimate does

| Product kind (derived client-side from the island) | Inputs shown | Estimate behaviour (server) |
|---|---|---|
| has `dims.W/D/H` (per_length and fixed-with-dims — the client cannot tell them apart and must not) | W, D, H number inputs (mm, step 10, min 100, max per §4.2), prefilled with defaults, "Reset to default" link | per_length: priced by the formula (length rate; D/H surcharge above default when a rate exists; a missing rate → `warnings`, counted in `customSizeCount`); fixed: price unchanged, `sizeAdjusted:true` → counted in `customSizeCount` → `COPY.customSizeNote` shown |
| `dims.W/H` only (per_area) | W, H | area × rate |
| `unit === 'run'` and no dims (per_run) | "Number of runs" (1..20) | runs × rate |
| no dims, unit pc/set/lot/system/bag/visit | no size inputs; note "Standard size" | basePrice |
| `basePrice` 0 in the master (22 products) | same inputs as its kind | `priced:false` → excluded, `reviewCount++` → `COPY.reviewCount(n)` |

Line total = `unitPrice × qty` (runs are NOT multiplied by qty twice: for per_run products the item sheet shows "Number of runs" and hides qty — `qty` is sent as 1). The client renders the size summary `L1200 × W600 × H850 mm` (builder's L/W/H labelling of W/D/H — copy `fixedItemDimString`'s `dimLabel` map) and a "custom" badge when any dim differs from default.

### 6.4 Differencing-attack analysis

**Threat.** A visitor adds item A, reads `[low, high]`, adds item B, reads again, and infers B's list price from the deltas; or varies quantity/size of one item and fits the slope. Only **list prices** (basePrice, per-mm rates, spec adders) are at stake — the cost basis, OH/MK multipliers, labour day rates and segment markups never participate in the estimate and cannot be recovered from it.

**What one query reveals.** With `low = floor(0.90·M/step)·step`, adding B of price p moves `low` by `0.90·p ± step`. One differencing gives p to within about ±`step/0.9` (±₱5.6k at the ₱5k step). **Repeated queries defeat quantisation:** `low(q) = floor(0.90·q·p/step)·step` for q = 1..20 lets an attacker fit `p` to a few pesos; dither (a stable pseudo-random ±3 % keyed per product) would only shift the recovered figure by a constant and was therefore **not adopted** (it would also make the estimate honest-user-visibly inconsistent with the quotation).

**Mitigations adopted (layered):**
1. **Range + step (R2):** no honest viewer sees a per-item figure; a casual differencing attempt gets ±₱5k.
2. **Minimum basket gate (O3):** a single cheap item (the easiest target) never shows a figure; the attacker must carry a ≥ ₱50k or ≥ 2-product basket, so every probe is a difference between two multi-item baskets.
3. **Per-line caps:** `qty ≤ 20`, `runs ≤ 20`, `items ≤ 40`, sizes snapped to 10 mm and bounded — fewer distinct observable points per item.
4. **Rate limits (R4):** 60 estimates/IP/hour with escalating lockout, 150/session/day, 2,000/hour global. Recovering one product's price to the peso needs ~20 probes; the whole 143-priced-product master needs thousands of probes across many IPs over days, and every probe is logged by sampled `qr_abuse` entries plus the rate-limit buckets.
5. **Response minimalism:** `{low, high, step}` only; no midpoint, no per-line flags, no product-level "sizeAdjusted"; counts only.
6. **No client-side math, no island prices:** the browser holds nothing to reverse-engineer; the formula shape is public only in the sense that `quote-builder-v2.html` is already a public file.
7. **Kill-switch (O7):** `productMeta/config.quoteRequest.estimateEnabled = false` hides the figure without a deploy.

### 6.5 Residual risk — stated honestly

A motivated party with a few IP addresses can recover the **list price of any individual product to within a few percent in an afternoon** (tens of probes per product under the limits above), and per-mm rates/spec adders with more effort. That is the same information a prospective buyer obtains by asking for three quotations, and it is strictly less than what `products-database.json` exposed publicly until 2026-09-27. **Nothing about cost, markup, labour rates or margins is derivable.** If the owner wants zero per-item inference, the only real option is O7 (no figure at all) — the range is a product decision, and this spec records the trade-off so it is made knowingly.

---

## 7. File-by-file change list

### 7.1 New files

| File | Purpose | Loaded by | sw.js PRECACHE? |
|---|---|---|---|
| `js/qr-def.js` | §4 definitions (UMD) | `/catalogue/` page; `PAGE_SCRIPTS['dept:Sales']` + `['bk-quotations']` (internal screen); tests | **YES** (`'/js/qr-def.js'` after `'/js/cir-forms.js'`) |
| `functions/qr-def.js` | byte-identical mirror (`cp`) | functions | no |
| `js/pricing-core.js` | §6.2 pure pricing math (money-core contract) | `quote-builder-v2.html`; tests | **YES** (`'/js/pricing-core.js'` after `'/js/money-core.js'`) |
| `functions/pricing-core.js` | byte-identical mirror (`cp`) | functions | no |
| `functions/qr-core.js` | §5.0 pure helpers | functions, tests | no |
| `js/quote-request.js` | §3 public UI (intake/item/tray/review/receipt, draft, callables, `?mock=1`) | `/catalogue/` only | **NO** (deliberate — §3.2 H9) |
| `css/quote-request.css` | §3 UI styles, `--site-*` tokens | `/catalogue/` only | **NO** |
| `js/screens/quote-requests.js` | §8 internal screen → `window.renderQuoteRequests` | `PAGE_SCRIPTS` lazy | **YES** (`'/js/screens/quote-requests.js'` after `'/js/screens/client-info-requests.js'`) |
| `tests/pricing-core.test.mjs` | §7.6 money tests | `node --test` | no |
| `tests/quote-request.test.mjs` | §7.6 qr-core + mirror tests | `node --test` | no |

### 7.2 Edited files (exact edits)

- **`scripts/build-catalogue.js`** — (1) `publicProduct()`: emit `specs[].default` when it is a string member of `options` (else omit); (2) new export `renderCatalogueData(db, opts)` → the §3.4 island JSON string (uses `renderCatalogue`'s product walk; throws `CatalogueGuardError` on any guard hit; escapes `</script`); (3) `renderCard()`: add `data-id="${esc(p.id)}"` to `<li class="cat-card">`; (4) `main()`: when the `/catalogue/` template is generated, inject the island + hooks H4/H5 (coordinate with the catalogue agent — if the template lives elsewhere, the island is written wherever that template's `<!-- QR:DATA -->` placeholder is; state the placeholder names in the template: `<!-- QR:DATA -->`, `<!-- QR:ROOT -->`, `<!-- QR:SCRIPTS -->`).
- **`tests/catalogue-public.test.mjs`** — §3.4 assertions + the `specs[].default ∈ options` assertion; mutation: make `renderCatalogueData` spread a raw product → test must fail.
- **`index.html`** — ONLY the H1 href swaps inside `#site` (hero `.hero-cta` first link, `#contact` primary button — NOTE its label "Open the project brief form" stays pointing at the brief; only links whose text is "Get a quote" change — and the footer "Get a quote" link). No new script/css. Verify `grep -c 'catalogue/?quote=1' index.html` ≥ 2.
- **`quote-builder-v2.html`** — §6.2 delegation: one `<script>` tag + `computePrice` body. **No tutorial bump** (no user-visible change) — record the parity pairs in the commit message.
- **`functions/index.js`** — one `require` line; `resolveSalesAndPresidentUids` extraction (CIR byte-identical behaviour); `qrLoadProducts`, `qrNotifyStaff`, `qrGlobalBucketRef(db, name)`, `qrIpBucketRef(db, scope, ipKey)`, `qrLogAbuse`, four exports (`qrStartSession`, `qrEstimate`, `qrSubmit`, `qrAdminDelete`) appended after `cirAdminDelete`.
- **`firestore.rules`** — §9 block inserted immediately after the `client_info_requests/{ref}/notes/{nid}` block. Nothing else.
- **`storage.rules`** — **no change** (no files in this feature).
- **`firestore.indexes.json`** — **no change** (single-field queries only: `orderBy createdAt`, `where fingerprintDay ==`, `orderBy createdAt asc` on sessions).
- **`js/config.js`** — `DEPARTMENTS['Sales'].subtabs`: `['Clients', 'Briefs', 'Quote requests', 'Quotes', 'Analytics', 'Partner', 'Files', 'SOP', 'Budgeting', 'Tasks']`; `PAGE_SCRIPTS['dept:Sales']` and `['bk-quotations']`: append `'js/qr-def.js', 'js/screens/quote-requests.js'`. Never touch `APP_VERSION`.
- **`js/screens/sales.js`** — `salesTabs` gains `'Quote requests'` after `'Briefs'`; `alias` gains `'Quote Requests':'Quote requests', 'Quote requests':'Quote requests', 'QuoteRequests':'Quote requests'`; `sopPanel` step: `'Quote requests holds every "Get a quote" request sent from barroindustries.com/catalogue/ — review the items and the estimate the client saw, then Open in Quote Builder to price it properly.'`; `loadSalesContent` `case 'Quote requests': if (window.renderQuoteRequests) await window.renderQuoteRequests(content, currentUser, currentRole); else content.innerHTML = window.renderEmptyState({ icon:'⚠️', title:'Quote requests screen not loaded', hint:'Reload the app and try again.' }); break;`.
- **`sw.js`** — the three PRECACHE lines in §7.1 (single-quoted, one per line). `CACHE_VER` untouched.
- **`scripts/ci-invariants.sh`** — new **CHECK 10 "QR MIRRORS"**: copy of check 7 for the pairs `js/qr-def.js ↔ functions/qr-def.js` and `js/pricing-core.js ↔ functions/pricing-core.js` (FAIL on missing or differing; PASS line names both). Also extend **CHECK 9** to run the brand regex over `css/quote-request.css` and `js/quote-request.js` (add to the `for pub in …` list) and to FAIL if `js/quote-request.js` contains any of `basePrice|priceAdder|pricePer|rateW100|rateD100|rateH100|formulaType|₱[0-9]` (the public script must carry no pricing vocabulary; `₱` followed by a digit only — the UI prints the server's figures with a local `peso()` formatter).
- **`scripts/ui-wiring-allowlist.json`** — only if `check-ui-wiring.js` warns; prefer literal ids. The public page is not scanned (it is not `index.html`/`js/` — `js/quote-request.js` IS under `js/` and IS scanned: every `onclick="qrX()"` must be a `window.qrX` global; prefer delegated `addEventListener` inside `#qr-root` so the scanner has nothing to flag).
- **`.githooks/pre-commit`** — **no change** (`js/`, `css/`, `quote-builder-v2.html`, `index.html` are shipping → bump; `functions/`, `tests/`, `scripts/`, `specs/`, `firestore.rules` are allowlisted).
- **`STATUS.md`** — §12.

### 7.3 `js/quote-request.js` — contract

- IIFE, `'use strict'`, zero dependencies beyond `window.QR_DEF` and the Firebase compat globals (`firebase.app().functions('asia-east1')`); `FIREBASE_CFG` copied verbatim from `sales/clientinformationrequest/index.html` L252–260; `REGION = 'asia-east1'`. If `QR_DEF` is missing → do nothing except log (the catalogue still works).
- Reads the island once: `JSON.parse(document.getElementById('qr-catalogue').textContent)` → `byId`. Injects `<button type="button" class="qr-add" data-id="…" aria-label="Add <name> to quote">Add to quote</button>` into every `.cat-card[data-id]` whose id is in `byId`.
- Sheets are `<div class="qr-sheet" role="dialog" aria-modal="true" aria-labelledby=…>` inside `#qr-root` with a backdrop; **focus management**: on open, focus the first control; Tab is trapped; Escape closes (not on the receipt); on close, focus returns to the trigger. Body scroll locked via `html.qr-lock`. Chips/radios are real `<input type="radio">`/`<select>`; every input has a `<label>`; errors in an `aria-live="assertive"` region; estimate status `aria-live="polite"`. Minimum 44 px targets; 16 px gutters; no horizontal scroll at 360 px; `prefers-reduced-motion` respected (sheet slide ≤ 150 ms, none when reduced).
- **Tray:** `<div class="qr-tray" id="qr-tray" hidden>` fixed bottom (phone) / bottom-right card (≥ 720 px): "🧾 N items · Est. ₱low – ₱high" (or `gateMessage`/`disabledMessage`/status) + "View quote" button. Count badge on cards via `data-qr-count`.
- **Peso formatting:** `peso(n)` → `'₱' + n.toLocaleString('en-PH')`; ONLY ever applied to `low`/`high` from the server.
- All visitor-typed text rendered via `textContent` or a local `esc()`; product names from the island are inserted via `esc()` too.
- **`?mock=1`** (QA seam, mirror CIR §4.6): `Qr.startSession/estimate/submit` resolve locally — mock estimate = `{shown: items.length>=2, low: 95000, high: 125000, step: 5000, …}`; `sim=gate` → shown:false; `sim=disabled`; `sim=ratelimit`; `sim=error`; `sim=dup`; `sim=slow` (3 s); `sim=stale` → submit rejects `invalid-argument` for the first item id.
- `beforeunload` is **not** used (no uploads). `offline`/`online` banner as CIR.
- Receipt: ref in large mono, Manila date, items (name · size · qty · specs · note), intake summary, the range if shown + disclaimers, "Save receipt as PDF" (`body.qr-print-receipt` + `window.print()`, `afterprint` cleanup), "Start another quote" (clears draft).

### 7.4 `js/screens/quote-requests.js` — clone of `client-info-requests.js`

Header comment in house style; `'use strict'`; module-local state `_qrContainer, _qrView, _qrRows, _qrCurrent, _qrNotes, _qrStatusFilter, _qrSearch`. Gating functions `qrCanWrite()` / `qrCanDelete()` **byte-identical in logic** to `cirCanWrite/cirCanDelete` (secretary view-only; president/manager/owner delete). Globals: `renderQuoteRequests(container, currentUser, currentRole)`, `qrOpen(ref)`, `qrBackToList()`, `qrSetStatus(ref, status)`, `qrAddNote(ref)`, `qrConvert(ref)`, `qrOpenInBuilder(ref)`, `qrPrint(ref)`, `qrDelete(ref)`, `qrCopyLink()` (copies `https://barroindustries.com/catalogue/?quote=1`).
- Fetch: `dbCachedGet('qr-list', () => db.collection('quote_requests').orderBy('createdAt','desc').limit(200).get()…, 30000)`; `dbCacheInvalidate('qr-list')`.
- **List columns:** Ref · Received (`submittedOnManila` + age) · Name / Company (mobile · email small) · Need (label via `QR_DEF.INTAKE.need`) · Use (label) · Entity (pill: Gov / Private) · Items (count) · **Est. (client saw)** `₱low–₱high` or "—" · Status pill (`new` blue · `in_review` orange · `quoted` purple · `converted` green · `archived` gray). Rows older than 24 months get the "review retention" amber pill (O4). Search over name/company/email/mobile/ref. Filter chips with counts.
- **Detail:** top bar (name · company · `tel:`/`mailto:` links built with `encodeURIComponent`, ref mono, received, status pill); action bar (status select · Open in Quote Builder · Convert to client · Print/PDF · Delete). Cards: **Request** (need/use/entity/target date or "Flexible"/delivery address/notes — labels from `QR_DEF`), **Items** table — `#` · Product (name, id mono) · Size (L×W×H mm, "custom" badge when `sizeCustom`, or "N runs") · Specs · Qty · Note · **Unit (list)** · **Line** — the last two columns and the **Internal total** row are rendered only when `qrCanWrite()` (secretary sees the client view: no prices) with a muted caption "Internal list prices at submission — never shown to the client"; per-line `priced:false` → "priced on review", `warnings` → ⚠ tooltip; **Estimate** card: "Client saw: ₱low – ₱high (step ₱…)" or "No figure shown (gate/disabled)", `pricedCount/reviewCount/customSizeCount`, `estimateVersion`, `estimateMismatch` warning when set, `lastEstimate` the client last fetched; **Consent** card; **Technical** `<details>` (president/manager): IP, UA, accept-language, fill time, estimate calls, session hash; **Notes** card (create-only subcollection, as CIR).
- **`qrOpenInBuilder(ref)`** (guard `qrCanWrite`): `window._qbReopenState = { clientName, clientCompany, clientAddress: intake.address, clientPhone: contact.mobile, clientEmail: contact.email, items: internal.items.map(toBuilderItem) }; navigateTo('bk-quote-builder');` where `toBuilderItem(line, clientItem)` builds **exactly the shape `addItemFromCalc` pushes**: `{ id, category: cat, name, dims: 'L1200 × W600 × H850 mm' (the builder's own string format, or 'N run(s)' for per_run, '' when no dims), specs: [{label, value}], specStr: specs.map(v).join(', '), qty, unit, unitPrice: line.unitPrice, amount: line.unitPrice × qty, leadTime: '—', laborHours: null, formulaType: line.formulaType, notes: clientItem.note || '' }` — `priceManual` is NOT set (the builder's auto-pricer may reprice costed lines, exactly as if staff had picked the item); `unitPrice: 0` lines (`priced:false`) open as unpriced custom lines the staff must price (the builder already handles `unitPrice:0` without `priceManual`). No `sourceDocId` (fresh quote; the draft-resume banner is not suppressed — correct, same as `cirPrefillQuote`). Toast "Opening Quote Builder with this request's client and items…". The builder's `loadEditableState` reads `state.items` through `normalizeLoadedItems` and the five client fields — verified at L7925–7955.
- **`qrConvert(ref)`** — identical to `cirConvert` with `briefNote = 'Quote request ' + ref + ' (' + submittedOnManila + '): ' + [needLabel, useLabel, entityLabel, 'target: ' + (targetDate||'flexible'), n + ' items', estimate shown ? 'est. ₱low–₱high' : 'no estimate shown'].join(' · ')`, `qrRefs: FV.arrayUnion(ref)`, `source: 'Quote request'`, then status `converted` + `convertedClientId/At/By`.
- **`qrPrint(ref)`** — `openPrintableDoc` + `buildLetterhead({ docTitle:'QUOTE REQUEST', dateLabel:'Received ' + submittedOnManila, extraMeta:[ref, company||name] })`; body = request card + items table (**with** the internal columns when `qrCanWrite`, flagged "INTERNAL — list prices" in the header strip; a second button "Print client copy" omits them) + estimate card + consent line. Same `pageCss` as CIR §5.7 minus photo rules.
- **`qrDelete(ref)`** — `confirmDialog({ danger:true })` → `httpsCallable('qrAdminDelete')({ refNo })` → `logAudit('delete','quote_request',ref,{})`, invalidate, back to list.
- Every value `escHtml()`'d; every URL through `safeHttpUrl()`; no `toISOString()`; dates via `bizDate`/string parts.

### 7.5 Notifications

`qr.buildNotification(doc)` → `{ title: '🧾 New quote request — ' + (company || name) (≤ 200), body: name + ' · ' + needLabel + ' · ' + useLabel + ' · ' + n + ' item' + (n===1?'':'s') + (estimate.shown ? ' · est. ₱' + low.toLocaleString('en-PH') + '–₱' + high.toLocaleString('en-PH') : '') + ' · Ref ' + refNo + '. Open Sales → Quote requests.' (≤ 2000), icon: '🧾', type: 'quote_request', link: 'dept:Sales' }`. Test: no `<`, within caps, plain emoji. (The **internal** exact figure never goes into a notification — push bodies can show on lock screens.)

### 7.6 Tests required (all pinned; money tests mutation-tested and the mutation recorded in the commit message)

**`tests/pricing-core.test.mjs`** (money — `createRequire` of `js/pricing-core.js`, zero deps): fixtures = synthetic products for each formulaType (NEVER real master numbers — the repo is public), with `rateD100`/`rateH100` present and absent, specs with adders incl. a negative adder, `materialPriceIndexMultiplier` 1 and 1.07, basePrice 0.
1. `priceCatalogItem` per_length: default dims → basePrice; +300 mm length → base + 300×ppm; D above default with rate → surcharge `(Δ/100)×rateD100`; D above default without rate → unchanged price + `missingRateLabels:['Width']` + warning text; D BELOW default → no discount (pinned quirk); H likewise.
2. per_area: `(W×H/1e6)×pricePerSqm`; per_run: `(pricePerRun||basePrice)×runs`; fixed with custom dims → price unchanged, `sizeAdjusted:true`; `configurable` → basePrice.
3. Multiplier applied before adders (pinned order: `(formula price) × mult + adders`); adders by index; absent select → index 0... NO — absent → the product default index (pricing-core takes `specIdx` already resolved; `validateSelection` resolves defaults — test both layers).
4. Rounding: `max(0, round(price))`; basePrice 0 → `priced:false`.
5. `validateSelection`: every rule in §4.3 items row (bounds, step, keys, per_area key set, per_run runs, specs by label/value, defaults, unknown → error).
6. `estimateRange`: pinned table — exact 0 → `{0,0,5000}`; 84,120 → `{75,000, 100,000, 5000}` (0.9×84,120 = 75,708 → floor 75,000; 1.15×84,120 = 96,738 → ceil 100,000); 499,999 → step 5,000; 500,000 → step 10,000 (`{450,000, 580,000}`); 5,000,000 → step 50,000 (`{4,500,000, 5,750,000}`); `high === low` never (an exact of 1 → `{0, 5000}`).
7. `estimateGate`: (1 product, 49,999) → false; (1 product, 50,000) → true; (2 products, 10,000) → true; (2 lines of the SAME product) → distinctPriced 1 → false unless ≥ 50k; unpriced products do not count toward distinct.
8. **Mutation list (each must fail ≥ 1 test in a scratch copy):** flip `>` to `>=` in the D/H surcharge; drop `Math.max(0, …)`; apply the multiplier after adders; change `lowFactor` to 0.95; make `ceil` a `round`; let a size below `minDimMm` pass.

**`tests/quote-request.test.mjs`** (`createRequire` of `functions/qr-core.js`): refNo shape/alphabet/Manila date; `validateIntake` every rule incl. `other`+text coupling, target-date window, flexible; `validateContact` mobile forms (`0917 123 4567`, `+63 917 123 4567`, `639171234567`, `63-917-1234567` → `09171234567`; `0817…`/`0917123456` rejected), email; `normaliseItems` unknown id/qty caps/`maxItems`; `computeBasket` sums and counts with a synthetic `byId`; `basketHash` canonical (order-independent, qty-sensitive); `publicEstimate` key set is EXACTLY the §5.3 list (deepEqual of `Object.keys(...).sort()`), contains no `exact`/`lines`/`unitPrice` anywhere (`JSON.stringify` regex), `notes` contain governmentNote iff government; `buildNotification` caps/no `<`; `normaliseProductDoc` legacy fields (`title`, `baseRate`, `measurement`); `botCheck`; mirror equality `js/qr-def.js == functions/qr-def.js` and `js/pricing-core.js == functions/pricing-core.js` (byte compare, as the CIR test does for cir-forms).

**`tests/catalogue-public.test.mjs`** — §3.4 additions.

---

## 8. Data model

### 8.1 `quote_requests/{refNo}` — created ONLY by `qrSubmit`; deleted ONLY by `qrAdminDelete`

```
{
  refNo: 'QR-261021-K7M2PX',        // == doc id
  defVersion: 1, estimateVersion: 1,
  status: 'new',                     // 'new' | 'in_review' | 'quoted' | 'converted' | 'archived'
  createdAt: <server Timestamp>, submittedOnManila: '2026-10-21', updatedAt: <server Timestamp>,

  summary: { name, company, mobile, email, need, useFor, entityType, targetDate, itemCount, estimateLow, estimateHigh, estimateShown },   // list view; strings '' when blank, numbers null when not shown

  contact: { name, mobile: '09XXXXXXXXX', email, company },
  intake:  { need, needOther, useFor, useForOther, entityType, targetDate: 'YYYY-MM-DD'|null, targetFlexible: bool, address, notes },   // blanks OMITTED

  items: [ { n: 1, id, name, cat, unit, qty, runs: null|int, size: {W,D,H}|null, sizeCustom: bool, specs: [{label, value}], note } ],   // client-facing, NO prices (name/cat/unit re-derived from the master)

  estimate: { shown, reason: null|'gate'|'disabled', low, high, step, vatBasis, deliveryIncluded, pricedCount, reviewCount, customSizeCount, notes: [...], basketHash, computedAt: <Timestamp> },   // what the server computed AT SUBMIT (= what the client saw if basketHash matched)
  lastEstimate: { low, high, basketHash } | null,   // what the client's page last displayed (client-reported)
  estimateMismatch: bool,

  internal: {                        // staff-only by convention (the whole doc is staff-read anyway; never copied into notifications/receipts)
    exactTotal: 84120,
    lines: [ { n, id, formulaType, unitPrice, lineTotal, priced, sizeAdjusted, warnings: [] } ],
    pricingSource: 'firestore:products', productsLoadedAt: <ISO>, materialPriceIndexMultiplier: 1,
    computedAt: <Timestamp>
  },

  consent: { agreed: true, noticeVersion, noticeSha256, consentedAt },
  client:  { ip, ipHash, userAgent (≤512), acceptLanguage (≤64), referer (≤300), fillMs, estimateCalls },
  fingerprintDay: '<sha256(lower(email)|digits(mobile))>|2026-10-21',
  sessionHash: '<qr_sessions doc id>',

  // staff-written (rules allowlist)
  statusChangedAt, statusChangedBy, statusChangedByName, convertedClientId, convertedAt, convertedBy, quoteDocId
}
```
`quote_requests/{refNo}/notes/{noteId}` — `{ text ≤2000, authorUid, authorName, at }`, create-only.

### 8.2 Admin-SDK-only collections (NO rules match)

- `qr_sessions/{sha256(sessionToken)}` — `{ createdAt, ipHash, uaHash, estimateCount, lastEstimateAt, lastBasketHash, submittedAt, refNo }`.
- `qr_ratelimit/{bucketId}` — portal bucket shape `{ count, windowStart, lockedUntil, lockStreak, updatedAt }`.
- `qr_abuse/{autoId}` — `{ at, kind, ipHash, detail }`, `kind ∈ 'honeypot' | 'too_fast' | 'duplicate' | 'bad_payload' | 'rate_limited' | 'estimate_sample' | 'estimate_gate'`.

### 8.3 Existing collections touched

`products` + `productMeta/config` (Admin read), `notifications/{uid}/items` (create, allowlisted shape), `users` (recipient lookup), `clients` (staff convert), `audit_log` (`qrAdminDelete`; the screen calls `logAudit`).

---

## 9. Rules diff — `firestore.rules` (insert after the `client_info_requests/{ref}/notes/{nid}` block; verbatim)

```
    // Public quote requests (specs/PUBLIC-QUOTE-REQUEST-SPEC.md) — created/deleted by callables only;
    // qr_sessions / qr_ratelimit / qr_abuse have NO match block (Admin SDK only). Secretary = view-only.
    match /quote_requests/{ref} {
      allow read: if isAuth() && !isPartner();
      allow create, delete: if false;
      allow update: if isAuth() && cirWriter()
        && request.resource.data.diff(resource.data).affectedKeys()
             .hasOnly(['status','statusChangedAt','statusChangedBy','statusChangedByName','convertedClientId','convertedAt','convertedBy','quoteDocId','updatedAt'])
        && request.resource.data.get('status','') in ['new','in_review','quoted','converted','archived']
        && (!('statusChangedBy' in request.resource.data.diff(resource.data).affectedKeys()) || request.resource.data.get('statusChangedBy','') == request.auth.uid)
        && (!('convertedBy' in request.resource.data.diff(resource.data).affectedKeys()) || request.resource.data.get('convertedBy','') == request.auth.uid);
    }
    match /quote_requests/{ref}/notes/{nid} {
      allow read: if isAuth() && !isPartner();
      allow create: if isAuth() && cirWriter()
        && request.resource.data.get('authorUid','') == request.auth.uid
        && request.resource.data.get('at', null) == request.time
        && isBoundedString(request.resource.data.get('text',''), 2000);
      allow update, delete: if false;
    }
```
Notes: `cirWriter()` is reused (same Sales/senior-admin/non-secretary tier). Attribution pinning (`statusChangedBy`/`convertedBy == request.auth.uid`) matches the CIR post-review hardening (STATUS 2026-09-27) — check the live CIR block for the exact idiom already deployed and mirror it. `storage.rules`: no change. `firestore.indexes.json`: no change. `products` rules: unchanged — Admin SDK bypasses rules; the public never reads them.

---

## 10. Workstreams (partitioned by file; A–D run in parallel after WS-0; each paired with an adversarial verifier)

- **WS-0 Definitions + pricing core (blocking):** `js/qr-def.js`, `functions/qr-def.js`, `js/pricing-core.js`, `functions/pricing-core.js`, `tests/pricing-core.test.mjs`, `scripts/ci-invariants.sh` (CHECK 10 + CHECK 9 extension). Acceptance: `node --check` on all; `node -e "require('./functions/qr-def.js').VERSION"` → 1; pricing tests green **and the §7.6 mutation list verified in a scratch copy** (record which test each mutation broke); `cmp` of both mirrors; ci-invariants PASS. Verifier: diff `priceCatalogItem` line-by-line against `quote-builder-v2.html computePrice` (L3611–3668) and confirm every branch, default and rounding is reproduced; confirm no real master price appears in any fixture.
- **WS-P Quote-builder delegation:** `quote-builder-v2.html` (§6.2) + `sw.js` (one PRECACHE line). Acceptance: the six parity pairs; tutorial contract untouched (no `TUTORIAL_VERSION` bump — justify in commit: no user-visible change); `?mode` flows unaffected; `file://` open still prices. Verifier: grep that the old formula body is gone (no second copy of `pricePerExtraMm` math outside pricing-core), and that `calcPriceWarning` text is byte-identical for a missing-rate case.
- **WS-A Public UI:** `js/quote-request.js`, `css/quote-request.css`, plus the H1–H6 hooks **in coordination with the catalogue agent** (`scripts/build-catalogue.js`, its test, `index.html` href swaps). Acceptance: `?mock=1` full flow (intake → add 3 items incl. a per_run and a specs product → tray range → review → submit → receipt → print); draft survives reload and `/` ↔ `/catalogue/`; every §5.6 path via `sim=`; keyboard-only completion; focus trap/return; 360 px no horizontal scroll; Lighthouse a11y ≥ 90 on `/catalogue/`; **no price token in the page source or any response** (`view-source` grep + DevTools network); island parses; CHECK 9 passes. Verifier (adversarial): inject `<img onerror>` into note/name/company and confirm tray/review/receipt escape it; set `qty=999`, `W=99999`, `W=1005`, a spec value not in options, an unknown product id (edit localStorage) — confirm the client blocks and, bypassing it (console), the server rejects each; confirm `localStorage` never contains a digit sequence matching `low`/`high`; confirm `js/quote-request.js` never references `pricing-core`.
- **WS-B Backend:** `functions/qr-core.js`, `functions/index.js`, `tests/quote-request.test.mjs`, `firestore.rules`. Acceptance: tests green (≥ 50 assertions); `node --check functions/index.js`; `git diff firestore.rules` shows only §9; `wc -c firestore.rules` < 200,000; `resolveSalesAndPresidentUids` refactor leaves `cirNotifyStaff` behaviour byte-identical (reviewer diff). Verifier: read every callable against §5 — fail-closed on bucket error; transaction verdict pattern (no throw inside); session counter increments atomically; LRU never serves across `productsLoadedAt`; `publicEstimate` is the ONLY path to the response object; products cache fail-closed after 24 h; fake success on bot writes nothing; notification field set ⊆ rules allowlist; `qrAdminDelete` reads `users/{uid}.role`, not a claim.
- **WS-C Internal screen:** `js/screens/quote-requests.js`, `js/screens/sales.js`, `js/config.js` (subtabs + two PAGE_SCRIPTS entries ONLY), `sw.js` (two PRECACHE lines). Acceptance: ci-invariants + check-ui-wiring PASS; `#/dept/Sales/Quote requests` deep-link; seeded doc renders (seed via the public page against prod after WS-B deploys, or the Admin-SDK REST path from memory `firebase-cli-rest-access`); Open in Quote Builder opens with the client fields AND the items at list prices; Convert creates/updates `clients`; secretary sees no prices/no write controls; Sales employee sees prices + writes, no Delete. Verifier: seed `name = '<img src=x onerror=alert(1)>'`, `note = '"><script>'`, `specs[0].value` not in options, unknown `id` — list/detail/print inert; `qrCanWrite()` false for secretary even with `currentDepts` ∋ Sales; no `toISOString()`; no `emojiIcon` in toasts/notifications; `git diff js/config.js sw.js` contains only the specified lines.
- **WS-D Docs + deploy (coordinator):** `STATUS.md`, `.deploy-state` via release.sh (§11).

---

## 11. Deploy order and commands (from the repo root, MAIN checkout — `.deploy-state` is per-checkout)

1. Gates: `node --test tests/*.test.mjs && bash scripts/ci-invariants.sh && node scripts/check-ui-wiring.js`.
2. `git diff firestore.rules` → only the §9 hunk. `bash scripts/release.sh rules` (records `.deploy-state`). **Rules land first.** (`storage` unchanged — skip.)
3. Functions — **selective, never blanket** (concurrent sessions edit this tree): `cd functions && npm install --no-audit --no-fund && cd .. && ~/.npm-global/bin/firebase deploy --only functions:qrStartSession,functions:qrEstimate,functions:qrSubmit,functions:qrAdminDelete`. Confirm `asia-east1` in the output. Because `resolveSalesAndPresidentUids` touches `cirSubmit`'s module scope, ALSO redeploy `functions:cirSubmit` in the same command (it is the only CIR export whose behaviour routes through the refactor). Then `bash scripts/release.sh record functions` (all 24+5 exports are deployed as of 2026-09-27; recording is correct now — STATUS).
4. Regenerate the catalogue: `node scripts/build-catalogue.js` (island + `data-id` + `specs[].default`), check its report (165 / 9, overrides unchanged).
5. Stage explicitly: `git add js/qr-def.js functions/qr-def.js js/pricing-core.js functions/pricing-core.js functions/qr-core.js functions/index.js tests/pricing-core.test.mjs tests/quote-request.test.mjs tests/catalogue-public.test.mjs firestore.rules scripts/ci-invariants.sh scripts/build-catalogue.js js/quote-request.js css/quote-request.css js/screens/quote-requests.js js/screens/sales.js js/config.js sw.js quote-builder-v2.html index.html catalogue/index.html STATUS.md specs/PUBLIC-QUOTE-REQUEST-SPEC.md` (adjust the catalogue path to wherever the catalogue agent generates it); `git diff --cached --stat`; commit (hook bumps the version, regenerates the manifest). Message: `feat: public "Get a quote" intake + catalogue Add-to-quote with server-side estimate → Sales › Quote requests (spec: specs/PUBLIC-QUOTE-REQUEST-SPEC.md)` + the parity pairs + the mutation record.
6. `bash scripts/release.sh push` → 1–3 min → `bash scripts/release.sh verify`; `curl -sIL https://barroindustries.com/catalogue/ | grep -m1 '^HTTP'` → 200; `curl -sL https://barroindustries.com/js/quote-request.js | grep -cE 'basePrice|priceAdder|rateW100'` → 0; `curl -sL https://barroindustries.com/catalogue/ | grep -c 'qr-catalogue'` → 1; `curl -s https://barroindustries.com/js/pricing-core.js >/dev/null` is reachable (it ships for the builder) — acceptable: it holds formula SHAPE, not numbers (the same shape `quote-builder-v2.html` already exposes).
7. Live smoke (President, phone): `/` → Get a quote → intake → add 3 items (one custom size, one with specs, one unpriced) → tray shows a range → review → submit → receipt; inbox + push arrive for Sales AND the President; Sales › Quote requests shows the row; detail shows items, client range, internal exact total; Open in Quote Builder lands the items at the same unit prices; print both copies; **Delete the test request**. Then test the gate (single cheap item → no figure) and the kill-switch (set `estimateEnabled:false` → "Submit your list…"; set back).
8. Rollback = `git revert` (never reset/checkout); callables can stay deployed (they are inert without the page); rules block is harmless if orphaned.

---

## 12. Acceptance checklist (tick all before "done")

- [ ] All three gates green; new CHECK 10 passes; CHECK 9 extended and passing; mutation list recorded.
- [ ] No price token in: `/catalogue/` source, `#qr-catalogue` island, `js/quote-request.js`, `css/quote-request.css`, any `qrEstimate`/`qrSubmit` response, localStorage draft, notifications, receipts.
- [ ] `qrEstimate` response keys exactly §5.3; `shown:false` ⇒ `low/high/step` null.
- [ ] Gate, disabled flag, government note, VAT line, delivery line, custom-size note, review-count line all render from `QR_DEF.COPY` (grep: no duplicated literals in `quote-request.js`).
- [ ] Rate limits exercised in prod with a forged `X-Forwarded-For` (as the CIR verification did): per-IP bucket keys on the right-most entry; untrusted → `resource-exhausted`.
- [ ] Quote-builder parity pairs recorded; `TUTORIAL_VERSION` unchanged.
- [ ] Internal screen: secretary view-only and price-free; Sales employee prices + writes, no Delete; President/Manager Delete; `Open in Quote Builder` reproduces unit prices; Convert flips status and links the client.
- [ ] Rules: `quote_requests` create/delete denied to a signed-in president from the console; update outside the allowlist denied; `qr_sessions` read denied.
- [ ] Phone (360×740): intake, item sheet, tray, review, receipt — no horizontal scroll, 44 px targets, focus visible, VoiceOver/TalkBack labels present.
- [ ] STATUS.md updated (§13) incl. open rulings O1–O7 and the pending live-smoke item.

---

## 13. STATUS.md entry text (paste at the top of the dated callouts; refresh the header)

> **2026-10-xx — Public "Get a quote" intake + catalogue Add-to-quote with a server-side estimate → Sales › Quote requests (NEW, SHIPPED vX.Y.Z).** Every "Get a quote" CTA on barroindustries.com opens a 3-step intake on `/catalogue/?quote=1` (need · use · government/private · target date · name · mobile · e-mail · company · delivery address · RA 10173 consent); each catalogue card gets **Add to quote** with custom W×D×H mm (default = product default), qty, the product's spec options and a note; a quote tray shows the item count and an **estimated range** (−10 %/+15 %, ₱5k/₱10k/₱50k steps, VAT-exclusive, delivery excluded, gated to ≥ 2 products or ≥ ₱50k) computed **only on the server** by `qrEstimate` from Firestore `products` + `productMeta/config` using the quote builder's own math, now in **`js/pricing-core.js`** (pure, money-core contract, `tests/pricing-core.test.mjs`, mutation-tested; the builder's `computePrice` delegates to it — no behaviour change, parity pairs in the commit) mirrored byte-for-byte at `functions/pricing-core.js` (ci-invariants **CHECK 10**, with `js/qr-def.js ↔ functions/qr-def.js`). **No per-item price ever reaches the browser** (island + public script guarded by CHECK 9 + `tests/catalogue-public.test.mjs`). Four `asia-east1` callables (`qrStartSession/qrEstimate/qrSubmit/qrAdminDelete`); `qr_sessions/qr_ratelimit/qr_abuse` have no rules match; `quote_requests` staff-read, callable-create/delete, 9-key staff update allowlist with attribution pinning. Rate limits per-IP + global + per-session (60 est/IP/h, 150/session/day, 2,000/h global; submit 5/IP/day, 40/h global), honeypot + 20 s timing, 60 KB payload, 40 lines × 20 qty. Receipt `QR-yymmdd-XXXXXX`. Notifies every Sales-department user + the President. Internal **Sales › Quote requests** (3rd chip): list/detail with the client's range AND the exact internal figure + per-line list prices (staff only; secretary sees the client view), status/notes, **Open in Quote Builder** (client fields + items at list prices via `_qbReopenState.items`), Convert to client, Delete (president/manager). Spec: `specs/PUBLIC-QUOTE-REQUEST-SPEC.md`. **Rulings baked in (2026-10-21):** server-side estimate · range −10/+15 with ₱5k/₱10k/₱50k steps · fixed disclaimer · CIR-grade limits · mobile+email required · Sales+President notified · government = same estimate + procurement note. **Residual risk, stated:** a determined party can recover individual LIST prices to within a few percent with tens of probes per product under the limits; cost basis/markup/labour rates are never derivable; kill-switch `productMeta/config.quoteRequest.estimateEnabled=false` hides the figure without a deploy.

Open rulings table — add one row: `| 11 | 2026-10-21 | **Quote-request estimate wording/gates** — defaults in force (spec §1.2): VAT-exclusive (O1), delivery excluded (O2), gate ≥ 2 products or ≥ ₱50k (O3), flag-only retention (O4), target date required-or-flexible (O5), unpriced items excluded (O6), kill-switch doc flag (O7). | Copy/polish only — nothing blocked. |`

Pending one-time actions — add: `- [ ] **Quote-request live smoke (President, phone)** — full flow per spec §11.7, then delete the test request; confirm the gate and the kill-switch.`

---

## 14. Out of scope (explicitly)

Prices on the public site in any form; per-item estimates; photo uploads on the quote request (the project brief has them); e-mail auto-replies to the visitor (Neil sends manually, as everywhere else); an automatic "convert to filed quote" (staff file from the builder); volume tiers / discounts / rush / misc costs in the estimate; a scheduled purge; analytics/pixels; any change to `js/money-core.js`; **product-family configuration (Phase A/B of `specs/PRODUCT-CONFIGURATOR-SPEC.md`)** — see §15 for the seams only.

---

## 15. Seams reserved for the configurator layer (Phase B of `specs/PRODUCT-CONFIGURATOR-SPEC.md`) — design now, build later

So that Phase B is additive and never a rewrite, Phase 0 reserves these shapes. Each is OPTIONAL and absent in Phase 0; a Phase-0 server REJECTS a present `family`/`config` with `invalid-argument` (configurator spec G3) rather than ignoring it.

| Seam | Phase 0 (this spec) | Phase B |
|---|---|---|
| Island product (§3.4) | `{id, name, cat, unit, dims, specs}` | `+ family: 'sink', defaultConfig: {…}` (price-free; from `PRODUCT_FAMILIES.families[*].skus`) |
| Draft item (§3.3) / request item (§5.3, §5.4) | `{id, qty, size, runs, specs, note}` | `+ family, config` — when present, `specs` (legacy drop-downs) must be absent (family mode replaces them, configurator §3.16) |
| `qrEstimate` response (§5.3) | fixed key set | `+ familiesPublished: string[]` — the page enables family mode only for ids in this list (the island is static; publication is a private Firestore flag) |
| `qr-core.normaliseItems` | `pricing.validateSelection` | `+ resolveConfiguration/validateConfiguration/matchSku`; `computeBasket` → `priceConfiguredItem` with the Admin-read `product_pricing` doc |
| `qrLoadProducts` | `products` + `productMeta/config` | `+ product_pricing` (same TTL; `productsLoadedAt` already keys the LRU, so a pricing edit invalidates estimates within 10 min) |
| Stored doc `items[]` (§8.1) | as written | `+ family, config, matchedSku`; `internal.lines[]` `+ deltas:[{key, mode, amount}], missingInputs:[]` |
| Internal screen (§7.4) | Specs column | renders `config` as "Label: value" rows from the schema; "Open in Quote Builder" passes `family/config` on each item so the builder reopens the Configuration panel |
| Item sheet (§7.3) | size/qty/legacy specs/note | renders the family's `public:true` groups + family dims rules + inline constraint messages; the server re-validates everything |
| `js/qr-def.js` `LIMITS` | generic dim bounds | a family's `dims` rules override them per item |

Rule for implementers of Phase 0: do not add any of the Phase-B fields "while you are there" — each reserved key is rejected by the server until the configurator spec's Phase A/B lands.
