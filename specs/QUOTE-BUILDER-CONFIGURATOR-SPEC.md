# QUOTE-BUILDER-CONFIGURATOR-SPEC — Package A (A4 configurator · A1 handoff · A2 price protection · A3 two-way link · A5 contact details)

Status: SPEC (read-only planning, 2026-10-28; owner approved Package A with the configurator as the centrepiece, defaults in §11 accepted unless he says otherwise). Implementers: Sonnet subagents, one per work chunk (§12). Escalate any ambiguity; do not invent. Every line number below was verified against the tree on 2026-10-28 and is a locator, not a contract — re-grep before editing.

Governing rules (CLAUDE.md): no bundler; `window.*` globals; builder is a self-contained iframe with no module imports; versions are hook-owned; money paths need tests that are mutation-tested; "rules land before code"; any user-visible builder change bumps `TUTORIAL_VERSION` (42 → **43**) with a `WHATS_NEW` entry and Help/tour sync; the repo is PUBLIC — never commit a price; the public website must never mention Brilliant Steel (nothing here touches the public site). NEVER run `git stash`, `git reset --hard`, `git checkout -- <file>` or `git clean` (shared live tree).

---

## 1. Summary and user stories

The quote builder (`quote-builder-v2.html`) gains a **Configurator** for the six website families (`prep_table`, `sink`, `stove`, `cabinet`, `wall_shelf`, `rack`) that uses the SAME definitions (`js/qr-families.js` walked by `js/product-families.js`) and the SAME math (`js/pricing-core.js` → `priceConfiguredItem`, already shared with the server) as the public catalogue and the `qrEstimate`/`qrSubmit` callables. A configured line stores `familyId + config + size + specs` and round-trips through every save/reopen/revision/template/import/print path. Website RFQs and project briefs hand off into the builder with the request reference, client fields, lead source, location code, project type and the estimate the client saw; lines arrive at the website price basis and are protected from the cost-plus auto-pricer until staff choose otherwise. Filing writes the quote back onto the request; a client acceptance moves the request to `converted`. Letterheads get the domain e-mail and the Quezon City address.

**Sales staff.** "A sink RFQ arrives with 2 basins, pre-rinse faucet, 1800 mm. I open it in the builder: the client's details, WB lead source, ML location and 'Restaurant' purpose are filled; the line is a real configured sink at the website price; I change it to 3 basins and the price updates; I see the cost-based price beside it and keep the website figure; when I file, the request shows 'Quoted — BK-ML-WB-261028-001'."
**President / Finance.** "An option cell I have not approved cannot silently become a price — the builder flags 'priced after review' and forces a typed price. The cost & margin panel does not treat a 6-burner stove as a 1-burner CE-001. A quote filed outside the estimate range the client saw is called out before filing."
**Partner (role `partner`).** "Nothing changes for me: SKU mode, no configurator, no option amounts, no cost data."

Out of scope: Package B/C (listed in §13). No change to public estimate math or anything the public website shows.

---

## 2. Architecture

### 2.1 What the builder loads (script tags, after line 1879 `js/pricing-core.js`)

```html
<script defer src="js/pricing-core.js"></script>        <!-- existing, line 1879 -->
<script defer src="js/qr-families.js"></script>         <!-- NEW: window.QR_FAMILIES (generated, price-free) -->
<script defer src="js/product-families.js"></script>    <!-- NEW: window.ProductFamilies (validation, describe, migrateAbsorbed) -->
<script defer src="js/qb-configured.js"></script>       <!-- NEW: window.QBConfigured (pure; §2.2) -->
```
All three are UMD (`module.exports` under Node, `window.*` in a browser), already precached (`sw.js` lines 112–114) — add `/js/qb-configured.js` to `PRECACHE` after `/js/product-families.js`. `file://` opens still work (families are static; pricing sheets absent → every configured line "priced after review").

**Decision — `priceConfiguredItem` does NOT move.** It already lives in `js/pricing-core.js` (lines 341–448), is exported on `window` (line 42) and mirrored byte-identically at `functions/pricing-core.js` (ci-invariants CHECK 10, lines 862–890). No new mirror, no CI change for it.

### 2.2 New pure module `js/qb-configured.js` (NOT mirrored; browser + Node; no DOM, no Firebase, no clock)

UMD shim copied from `js/product-families.js` lines 23–27 (`window.QBConfigured` / `module.exports`). Dependencies passed in, never required: `PF` (ProductFamilies), `PC` (PricingCore), `FAM` (QR_FAMILIES). Exports:

| export | signature | purpose |
|---|---|---|
| `priceLine` | `(deps, {family, primary, config, size, sheet, constants}) → {unitPrice, priced, reason, missing, base, deltas, pricedSize, warnings}` | the builder's ONE configured-price path. Applies the server's soft-width rule first (mirror of `functions/qr-core.js` `computeBasket` lines 497–502: if `PF.minWidth(fam, config)` is soft and `size.W < mw.mm`, price at `mw.mm` and push the same warning sentence), then `PC.priceConfiguredItem(primary, family, config, pricedSize, sheet, constants, {schemaVersion: FAM.version})`. **Parity test vs `functions/qr-core.js computeBasket`** (§9). |
| `buildLine` | `(deps, {family, primary, config, size, qty, unit, note, basis}) → item` | the builder item shape (§3.1): `specs = PF.describe`, `dims = PF.sizeTextLabelled`, `name = family.label`, `id = family.primary`. |
| `costBasisFor` | `(deps, item, liveById) → {mat, capLaborPesos, hrs:0, laborAbsent, hasBasis, isCustom:false, approx:bool, basisSku, scale, note}` | §4.5 configured cost basis. |
| `nearestAbsorbed` | `(family, config) → {sku, exact:bool, score}` | §4.5 scoring. |
| `fromRequestItem` | `(it, line) → item` | A1: one `quote_requests.items[]` row (+ its `internal.lines[]` row) → builder item (§6.1). Replaces `_qrToBuilderItem`'s family branch; plain branch kept inside it too so one function owns the mapping. |
| `purposeFor` | `({useFor, entityType, cirProjectType, cirBizType}) → string` | §6.3 table. |
| `locationCodeFor` | `(addressText) → 'LU'|'BG'|'ML'|'SB'|'CL'|'DA'|'CB'|'IG'|'OT'` | §6.4 table. |
| `comparableTotal` | `(items, totals) → number` | §7. |
| `estimateCheck` | `(comparable, estimate) → {applicable, inRange, low, high, comparable, pctOff, direction:'below'|'above'|null}` | §7. |
| `isAutoPriceable` | `(item) → bool` | §5 rule R1 (the single predicate `applyComputedPricing` calls). |
| `migrateLegacyConfiguredLine` | `(deps, item) → item|null` | §10.3: an old "(configured)" plain line or an absorbed-SKU line → configured line via `PF.migrateAbsorbed`. |

### 2.3 Where the option sheets come from in the builder

`loadDatabase()` (`quote-builder-v2.html` ~2250–2400), inside the existing `if (!PARTNER_MODE)` branch, in its OWN `try/catch` (same posture as `material_prices`, lines 2317–2333): `db.collection('product_pricing').get()` → `FAMILY_PRICING = { [familyId]: rawDoc }` (raw; `priceConfiguredItem` sanitises via `normalisePricingDoc`). Permission denied → `FAMILY_PRICING = {}` + `console.warn`, builder keeps working (§5 R4). Partner sessions never attempt the read and `FAMILY_PRICING` stays `{}`.

**Kill switch (no deploy):** `productMeta/config.quoteBuilder.configurator === false` (read from `meta` already fetched at line 2272) → `CONFIGURATOR_ON=false`: no Configure buttons, no hints, existing configured lines still load/print/total at their stored price and show a "configurator off" chip; editing them is disabled.

### 2.4 Rules gate for the sheet (DECISION, rules land first)

`product_pricing` read today = `isSeniorAdmin() || canFinance()` (firestore.rules line 1437). A Sales employee's internal builder session could not price options live. **Decision:** widen READ to the same tier that already sees the per-line "Base + options" build-up on Sales › Quote requests (`qrCanWrite` ≡ `cirWriter()`): president/manager, finance tier, or a non-secretary Sales member. WRITE unchanged. Partners never (`!isPartner()` stays). Secretary never. Exact diff in §3.5. If the deploy rejects a forward reference to `cirWriter()` (defined at line 330, used at 1437 — Firestore functions are scope-wide, so it should not), define `function qbSheetReader() { return isSeniorAdmin() || canFinance() || (!isSecretary() && inDept('Sales')); }` immediately above the block instead.

### 2.5 Partner portal (`?portal=partner`, company `BS`, generic `PT`) — DECISION

**Configurator unavailable in every partner session.** `applyPartnerMode()` (line 2448) removes `#configPanel`, every `data-cfg` control and the "Sold online as" hint from the DOM (same `.remove()` idiom as `#btnAdmin`); `CONFIGURATOR_ON=false` when `PARTNER_MODE`. A configured line that reaches a partner session renders as a read-only line at its stored price, options printed as specs; no deltas, no base, no "priced after review" reason text. **Internal staff quoting under company BS** (owner ruling 2026-09-01: they are Barro employees) keep the configurator; BS already suppresses the cost panel and the ×2.50 auto-pricer (`computeMarginSummary` line 6360), so §4.5/§5 cost rules simply do not run there.

---

## 3. Data model

### 3.1 Configured line — builder `items[]` entry (superset of `addItemFromCalc`'s shape, lines 3706–3722)

```js
{
  id: 'PW-004',                 // the family's PRIMARY SKU (fam.primary) — every downstream consumer keeps a real product id
  category: 'prep_washing',     // fam.category
  name: 'Sink',                 // fam.label; staff may edit the name cell as today
  familyId: 'sink',             // PRESENCE of familyId === "this is a configured line"
  familyVersion: 1,             // QR_FAMILIES.version at the time the line was (re)configured
  config: { basins:2, alignment:'center', undershelf:true, upper:false, faucet:'prerinse' },   // PF.validateLine(...).config (canonical)
  size: { W:1800, D:700, H:900 },   // mm, validated; the family's own axes only
  dims: 'L1800 × W700 × H900 mm',   // PF.sizeTextLabelled — printed; staff may overtype (specEdit-style), never read back for pricing
  specs: [ {label:'Sinks', value:'2 sinks'}, … ],   // PF.describe(fam, config) — printed on the client document; NEVER amounts
  specStr: 'Sinks: 2 sinks, …',
  qty: 2, unit: 'pc', unitPrice: <number>, amount: <number>,
  leadTime: '—', laborHours: null, formulaType: 'per_length',   // primary's formulaType
  notes: '',
  priceBasis: 'website' | 'cost' | 'manual',   // §5. 'website' = list + approved deltas; 'cost' = auto-pricer owns it; 'manual' = typed / forced
  basisUnitPrice: <number>,     // the website-basis figure last computed (0 when unpriced); printed nowhere; same sensitivity as unitPrice
  needsPrice: true|undefined,   // set when the website basis is NOT priced (unapproved / blank cell / size) and no price has been typed — Verify hard-gate (§5 R5)
  sourceRef: { kind:'qr', ref:'QR-261021-K7M2PX', n:3 } | undefined,   // which request line this came from
  _cfg: { reason, missing:[], base, deltas:[], warnings:[], pricedSize }   // RUNTIME ONLY — stripped from every payload (§3.2); recomputed on load
}
```
Rules: `familyId` absent ⇒ a plain line, byte-identical to today. `priceManual` keeps its existing meaning (a typed price sticks) and is still stripped from the payload / carried in the cost sidecar; `priceBasis:'manual'` is the persisted twin that survives filing.

### 3.2 Quote payload / Firestore quote doc (`bk_quotes` / `bs_quotes`)

`buildQuotePayload()` (line 7680): the destructuring strip at line 7722 gains `_cfg`. Everything else on the line (`familyId, familyVersion, config, size, specs, priceBasis, basisUnitPrice, needsPrice, sourceRef`) rides inside `items[]` and `editableState.items[]` unchanged — no bridge change for lines (the bridge copies `payload.items` wholesale, app.js lines 5302/5373).

New TOP-LEVEL payload keys (need the bridge allowlist, app.js QUOTE_UPDATE ~5276 and QUOTE_FILED ~5362):
```js
sourceRef:     { kind:'qr'|'cir', ref:'QR-…'|'CIR-…' } | null,
estimateCheck: { low, high, comparable, inRange, pctOff, reason:'' } | null    // §7; null when no estimate on the source
```
`editableState` carries `sourceRef` too (so a reopen/revision/draft keeps the link; a template strips it — add `'sourceRef','estimateCheck'` to `TEMPLATE_LINEAGE_DROP_FIELDS`, line 7863).

`quote_costs` sidecar (`buildCostSidecar`, line 7666): add per row `cfgCost: { basisSku, scale, approx }` when the line is configured and a basis was found — optional, recomputed anyway on reopen.

### 3.3 `quote_requests/{ref}` — new staff-written fields (rules §3.5)

```js
quotes: [ { docId, coll:'bk_quotes'|'bs_quotes', quoteNumber:'BK-ML-WB-261028-001', version:1, total:<number>, status:'filed'|'pending_approval'|'accepted'|'needs_revision', filedAt:'<ISO>', byName } ],   // ≤ 50, newest last
quoteDocId: '<latest docId>',   // existing key, kept for back-compat
lastQuoteAt: <serverTimestamp>,
status: 'quoted'                // existing enum value
```
### 3.4 `client_info_requests/{ref}` — same three keys; enum gains `'quoted'` (new → in_review → contacted → **quoted** → converted; archived anywhere).

### 3.5 Rules diffs — `firestore.rules` (exact; three hunks; CHECK 8 headroom is fine)

**(a) product_pricing read (line 1437):**
```
-      allow read: if isAuth() && !isPartner() && (isSeniorAdmin() || canFinance());
+      // 2026-10-28 QUOTE-BUILDER-CONFIGURATOR-SPEC §2.4: the quote builder prices options live for the same Sales tier that already
+      // sees the per-line build-up on Sales › Quote requests (cirWriter). Writes stay finance-tier; partners and the secretary never.
+      allow read: if isAuth() && !isPartner() && (isSeniorAdmin() || canFinance() || cirWriter());
```
**(b) quote_requests update (lines 356–362):** extend `hasOnly([...])` with `'quotes','lastQuoteAt'` and add
```
        && (!request.resource.data.diff(resource.data).affectedKeys().hasAny(['quotes']) || (request.resource.data.get('quotes', []) is list && request.resource.data.get('quotes', []).size() <= 50))
```
**(c) client_info_requests update (lines 334–340):** `hasOnly` gains `'quoteDocId','quotes','lastQuoteAt'`; enum becomes `['new','in_review','contacted','quoted','converted','archived']`; same `quotes` list guard as (b).

No `storage.rules`, no index changes. Admin-SDK writes from `respondToQuote` bypass rules.

---

## 4. UI — the Configurator in the builder

### 4.1 Where it opens
A NEW panel `#configPanel` (sibling of `#calcPanel`, same `.open` class mechanics, same place in the Estimator's `#addItemsSection`; `needsWorkspace:true` for the tour). Opened by: (1) **Configure** chips at the top of the category tabs/search area: six buttons generated from `QR_FAMILIES.order` ("⚙ Sink", "⚙ Stove", …) — `openConfigurator(familyId)`; (2) a **"configure instead"** link on absorbed SKUs (§4.6); (3) **⚙ configure** on an existing configured line (§4.7); (4) the handoff loader when a request line is configured (§6). `#calcPanel` is untouched.

### 4.2 Fields — generated from the definition, never hard-coded
For `fam = QR_FAMILIES.families[familyId]`, in `fam.groups` order:
- `type:'choice'`: ≤ 4 options → segmented pills (`button[data-cfg-group][data-cfg-v]`); > 4 → `<select>`. Label `g.label`, option label `o.l`, hint `o.hint` as `title`.
- `type:'slots'` (stove `positions`): an ordered row of tiles, each a `<select>` of `g.options`, with "+ position" / "− position" bounded by `g.minSlots`/`g.maxSlots`; tiles are reorderable with ◀ ▶ buttons (order matters — `canonicalConfig` keeps it).
- `type:'multi'` (addons): checkbox chips.
- Sizes: one input per key of `fam.dims` (label `dims[k].label`, `min/max/step/default` from the definition, **mm only** — the measurement-unit toggle of the calc panel does not apply; caption "mm").
- Qty stepper, unit (default `fam.unit`), note.
Nothing in the panel is written by hand per family; adding a family to `scripts/public-families.json` must light up here with zero code change (test: every group type/dim key in the generated file renders).

### 4.3 Validation (every keystroke, before pricing)
`PF.validateLine(fam, config, size)` is the authority: errors render inline under the offending control; **Add/Update is disabled while `!ok`**. Hard width rule (`PF.minWidth(...).hard`): the Length input shows "Minimum N mm for these options — Use" and refuses below. Soft rule (stove): warning "Priced at the usual N mm length for these burners" (same sentence as the server). `PF.forcedMins` (oven → min height) applied as the input's `min` with a hint. Absent definitions (file:// without scripts, kill switch) → the panel does not open; toast "Configurator unavailable".

### 4.4 Live price
On every valid change: `QBConfigured.priceLine(...)` with `primary = DB.products.find(p => p.id === fam.primary)`, `sheet = FAMILY_PRICING[familyId] || null`, `constants = DB.constants`. Display:
- priced: big figure `formatPeso(unitPrice)`, caption "Catalogue base <SKU> at this size ₱B + options ₱Δ" (staff-only, internal sessions), chip **website basis**.
- not priced: figure replaced by **"Priced after review"** badge + the reason in plain words (same four strings as `_qrFamilyLineNoteHtml`, quote-requests.js lines 435–447) + a required **"Your price ₱"** input (the line lands `priceBasis:'manual'`, `priceManual:true`, `needsPrice` cleared once > 0). If left blank, the line still lands at 0 with `needsPrice:true` and the row shows a red "needs a price" chip; Verify blocks (§5 R5).
- `FAMILY_PRICING` empty because the read was denied: caption "Option amounts not readable in this session — ask Finance" and the same manual-price flow.
Preview image: **not in this package**; reserve an empty `#cfgPreview` div and show `PF.summaryLine(fam, config, size)` as a one-line text summary instead. Follow-up in §13.

### 4.5 Cost & Margin — cost basis for a configured line (DECISION, stated plainly)
`itemCostBasis(item, liveById)` (line 6193) gains, before the catalogue branch: `if (item.familyId) return QBConfigured.costBasisFor(deps, item, liveById);`. The basis:
1. `nearestAbsorbed(fam, config)`: score every SKU in `fam.absorbed` against `config`: per `choice` group +1 if equal; per `multi` group + Jaccard(selected sets); per `slots` group + (multiset overlap ÷ max length). Highest score wins; tie → first in `absorbed` map order; `exact` iff `PF.sameConfig(fam, config, absorbed[sku])`. The primary is always in `absorbed` (verified for all six), so a match always exists.
2. `skuProduct = liveById.get(sku)`; `skuCost = capitalMaterials/capitalLabor` of that SKU (from `product_costs`, already merged onto `DB.products`, lines 2350–2351). If both are 0 → `hasBasis:false` (the panel says "No cost basis on this item yet", auto-pricer skips, exactly like an uncosted catalogue line today).
3. `skuList = PC.priceCatalogItem(skuProduct, {dims: skuProduct.defaultDimensions, runs:null, specIdx: defaults}, constants).unitPrice`; `cfgList = item.basisUnitPrice > 0 ? item.basisUnitPrice : item._cfg.base` (the configured list figure, or the base alone when unpriced). `scale = cfgList / skuList`, clamped to `[0.25, 4]` (clamped ⇒ `approx:true`, note "scale clamped"). `mat = skuCost.capitalMaterials × scale`, `capLaborPesos = skuCost.capitalLabor × scale`, `hrs = 0`.
4. `approx = !exact || size differs from the SKU's default dims || clamped`. The experiment table row shows a chip "cost ≈ from PW-006 ×1.18" (approx) or "cost from PW-006" (exact). **There are no per-option cost deltas in the system; this is a proportional scaling of the nearest absorbed SKU's cost, the best defensible basis available, and it is labelled approximate wherever it is shown.**
Mutation targets for this path are in §9.

### 4.6 Product picker hint
In `renderDropdown` (line 3286) and `renderPricelist` (3365) rows, and in `buildCalcPanel`'s title (3454): if `absorbedFamilyOf(id)` (reverse index built once from `QR_FAMILIES.families[*].absorbed`) → append `<span class="cfg-hint">Sold online as: <Family label> (configurable)</span> <button … onclick="configureInstead('PW-006')">configure instead</button>`. `configureInstead(sku)` = `PF.migrateAbsorbed(QR_FAMILIES, sku, {})` → `openConfigurator(familyId, {config, dims})`. Hidden entirely when `!CONFIGURATOR_ON`.

### 4.7 Editing a configured line
`renderItems` (line 4791): for `item.familyId`, the spec line shows a **⚙ configure** button (no-print) → `openConfigurator(item.familyId, {config:item.config, dims:item.size, qty, unit, notes, editIdx: idx})`; the panel's primary button reads "Update line". Updating replaces `config/size/specs/dims/specStr/basisUnitPrice/_cfg`; `unitPrice` per §5 R3. The Specs/Dims cells stay contenteditable (print wording) but a later ⚙ update regenerates them (toast "Specs rewritten from the options").

### 4.8 Mobile (staff use phones)
`#configPanel` under 768 px is a full-width bottom sheet (reuse the `.mobile-sheet` mechanics of `toggleMobileSheet`, line 2841): sticky header (family name, ✕), scrollable body, **sticky footer** with the live price/"Priced after review" and the Add/Update button; pills wrap; the slots row scrolls horizontally; all targets ≥ 44 px; the Length "Use N mm" link is a button. Keyboard: Esc closes; focus returns to the opener.

### 4.9 Tutorial (TUTORIAL_VERSION 43)
`WHATS_NEW` prepend `{ver:43, date:'<ship date Manila>', items:[ 'Configure a sink, prep table, stove, cabinet, wall shelf or rack right in the builder — the same options and prices as the website; the price follows the option amounts Finance approved, and an unapproved option asks you for a price instead of guessing.', 'Website quote requests open as real configured lines at the website price. The calculator shows the cost-based price beside it — choose per line or "Apply cost-based to all".', 'Verify & File warns when the total falls outside the estimate range the client saw online.', 'Filing a quote from a website request links it back: the request shows the quote number and status.', 'Letterheads now show hello@barroindustries.com and the Quezon City address.' ]}`. Help "How a quote gets made": add the configure step after "Add items". `TOUR_STEPS`: insert after `#addItemsSection` a step `{ target:'#configPanel', needsWorkspace:true, needsConfigurator:true, title:'Configure a product', … }` — the tour opens the panel read-only for the step and closes it on leave (tour must not mutate quote state: open with the family default and never Add). Re-verify every selector. Follow `.claude/skills/quote-builder-tutorial/SKILL.md`.

---

## 5. Behaviour rules — auto-pricer vs website basis vs manual (normative)

- **R1 `isAutoPriceable(item)`** = `item.id !== 'MISCFEE' && !item.priceManual && (item.priceBasis === undefined || item.priceBasis === 'cost')`. `applyComputedPricing` (line 6595) replaces its `if (item.id==='MISCFEE' || item.priceManual) return;` with `if (!QBConfigured.isAutoPriceable(item)) return;`. Nothing else in the auto-pricer changes.
- **R2 Defaults.** A configured line added in the builder: `priceBasis:'website'` when priced, else `'manual'` + `needsPrice`. A line handed off from an RFQ (plain or configured): `'website'` when `line.priced`, else `'manual'` + `needsPrice` (plain unpriced RFQ lines too — today they land at 0 and get auto-priced silently; that is exactly what A2 forbids). A catalogue line picked by staff in the builder: `priceBasis` undefined (today's behaviour, auto-priceable).
- **R3 Re-configuring** a line in `priceBasis:'website'` recomputes `unitPrice = basisUnitPrice` (live). In `'cost'`: recompute `basisUnitPrice` only; the auto-pricer owns `unitPrice` and re-runs on the next `computeMarginSummary`. In `'manual'`: `unitPrice` untouched; chip "manual — website basis now ₱X" invites a reset.
- **R4 Per-line choice (Internal view, experiment table, `renderTrueCostPanelHtml` ~6460+).** Each line with a `basisUnitPrice` shows two figures: *website ₱X* and *cost-based ₱Y (margin m%)*, the active one bold, and a toggle "Use cost-based" / "Use website". A header button **"Apply cost-based to all"** sets `priceBasis:'cost'` on every line that has a cost basis (`hasBasis`) and clears `priceManual` (confirm dialog, lists how many lines). "Use website" sets `priceBasis:'website'`, `unitPrice=basisUnitPrice`, deletes `priceManual`. `updatePrice` (line 5774) additionally sets `priceBasis='manual'` and clears `needsPrice` when > 0. `resetPricesToComputed` (6576) also sets `priceBasis='cost'` on lines currently `'manual'`/`'website'` that have a cost basis.
- **R5 Hard gate.** `needsPriceReason()` (new, beside `uncostedCustomLinesReason`, line 7348): `n = items.filter(i => i.needsPrice && !(i.unitPrice > 0)).length` → "n configured line(s) have no price yet — type a price or ask Finance to approve the option sheet." Wired into `canFile()` and `fileQuotation()` exactly like the uncosted-custom gate; `''` in PARTNER_MODE.
- **R6 BS company:** `computeMarginSummary` already returns before the auto-pricer on BS; configured lines on BS keep `priceBasis:'website'`/`'manual'` and are never repriced.
- **R7 Printed client document** (`renderClientPreview`, `doPrint`): a configured line prints name, `specs` rows, `dims`, qty, unit, unitPrice, amount — never `basisUnitPrice`, `_cfg`, deltas, base, reason, SKU id, "approx" chips (all `.no-print` or internal-view-only). Workforce copy prints specs/dims, no prices (unchanged).

---

## 6. Handoff mapping (A1)

### 6.1 QR → builder (`qrOpenInBuilder`, quote-requests.js ~716; `_qrToBuilderItem` ~683 replaced by `QBConfigured.fromRequestItem`)

| builder field (`_qbReopenState` key) | source | note |
|---|---|---|
| `clientName / clientCompany / clientPhone / clientEmail` | `contact.name/company/mobile/email` | as today |
| `clientAddress` | `intake.address` | as today |
| `currentCo` | `'BK'` | website leads are Barro Kitchens |
| `qnoMethod` | `'WB'` | Lead Source select (line 1214) |
| `qnoLoc` | `locationCodeFor(intake.address)` | §6.4 |
| `purpose` | `purposeFor({useFor: intake.useFor, entityType: intake.entityType})` | §6.3 |
| `subject` | `''` (staff use ✨ Auto) | |
| `items[]` | each `items[n]` + `internal.lines[n]` via `fromRequestItem` | configured ⇒ §3.1 line with `familyId/config/size/specs` from the request row, `basisUnitPrice = line.unitPrice`, `priceBasis` per R2, `sourceRef {kind:'qr', ref, n}`; plain ⇒ today's shape + `priceBasis` per R2 + `sourceRef` |
| `sourceRef` | `{kind:'qr', ref, estimate: estimate.shown ? {low, high, step, vatBasis, deliveryIncluded} : null, targetDate, targetFlexible, useForLabel, entityType, notes: intake.notes, name}` | the builder shows these in the handoff bar (§6.5); only `kind/ref` are filed |
| `handoff:true` | literal | §6.6 |

`loadEditableState` (line 7894): add `qnoMethod/qnoLoc` to the list of ids it sets (today only `resumeDraft` sets them, lines 7251–7252) and call `buildQuoteNo()` after, unless `state.quoteNo` was given. `setCompany(state.currentCo)` already exists.

### 6.2 CIR → builder (`cirPrefillQuote`, client-info-requests.js ~737)

| builder field | v2 (`project_brief_v2`) | v1 (`commissary_brief`) |
|---|---|---|
| client fields | `summary.name/company/phone/email`, `_cirClientAddress(sub)` | same (as today) |
| `currentCo` / `qnoMethod` | `'BK'` / `'WB'` | same |
| `qnoLoc` | `locationCodeFor(summary.location || summary.siteAddress)` | `locationCodeFor(answers.site_address)` |
| `purpose` | `purposeFor({cirProjectType: answers.project_type})` | `purposeFor({cirBizType: summary.bizType})` |
| `sourceRef` | `{kind:'cir', ref, projectType: facts.type, budget: facts.budget, targetDate: facts.target, photosCount: summary.photoCount, estimate: null}` | same via `_cirFacts` |
| `items[]` | none (a brief has no item list) | none |
| `handoff:true` | | |

### 6.3 Project-type → builder `#purpose` (options at line 1245: Restaurant · Hotel Restaurant · Hospital / Institutional · Government / Bidding · Residential · Cafe / Coffee Shop · Catering / Food Service · Other)

| QR `useFor` | purpose | | CIR v2 `project_type` | purpose |
|---|---|---|---|---|
| restaurant_cafe | Restaurant | | restaurant | Restaurant |
| hotel_resort | Hotel Restaurant | | cafe | Cafe / Coffee Shop |
| commissary | Catering / Food Service | | bakery | Other *(open question §11)* |
| catering | Catering / Food Service | | commissary | Catering / Food Service |
| school | Hospital / Institutional | | hotel | Hotel Restaurant |
| hospital | Hospital / Institutional | | catering | Catering / Food Service |
| government | Government / Bidding | | hospital, school, laboratory | Hospital / Institutional |
| home | Residential | | government | Government / Bidding |
| other / unknown | Other | | home | Residential |
| | | | other / unknown | Other |

`entityType === 'government'` overrides to **Government / Bidding**. CIR v1 `bizType` (free string): case-insensitive keyword scan — `hotel`→Hotel Restaurant; `caf`→Cafe / Coffee Shop; `restaurant|grill|fast`→Restaurant; `hospital|clinic|school|univers|lab`→Hospital / Institutional; `government|lgu|agency`→Government / Bidding; `home|residen`→Residential; `commissary|catering|central`→Catering / Food Service; else Other.

### 6.4 Address → `#qnoLoc` (options line 1205). Case-insensitive, first match in this order:
`la union`→LU · `baguio|benguet`→BG · `subic|olongapo|zambales`→SB · `clark|angeles|pampanga|mabalacat`→CL · `davao`→DA · `cebu|mandaue|lapu-lapu|lapu lapu`→CB · `ilocos|vigan|laoag`→IG · `metro manila|manila|ncr|quezon city|makati|pasig|taguig|mandaluyong|pasay|parañaque|paranaque|caloocan|marikina|muntinlupa|las piñas|las pinas|valenzuela|malabon|navotas|san juan|pateros|bgc`→ML · else `OT`. Pure, pinned by tests.

### 6.5 Handoff bar in the builder (`#handoffBar`, no-print, above the client form)
"From website request **QR-261021-K7M2PX** · Restaurant / café · private · target 2026-11-30 (flexible) · client saw ₱L – ₱H · [Open request]". For CIR: "From project brief **CIR-…** · Hospital or clinic · budget <band> · 7 photos · [Open brief]". Client notes in a collapsible `<details>`. "Open request" posts `{type:'QB_OPEN_SOURCE', payload:{sourceRef:{kind, ref}}}` to the parent; app.js navigates to `dept:Sales` quote-requests/briefs detail (`navigateTo` + the screen's existing detail opener). Persisted in `editableState.sourceRef` so a reopened quote shows the bar again (estimate included — it is the client-shown range, not internal).

### 6.6 Draft-resume hijack
`renderQuoteBuilderIframe` (app.js 2215): `if (reopenState && (reopenState.sourceDocId || reopenState.handoff)) qbSrc += '…reopen=1'`. The builder already skips `checkDraftResume()` on `reopen` (line 7184) and hides the banner on `LOAD_QUOTE` (7964). The reopen strip label (app.js 2290) gains a case: `reopenState.handoff ? 'from a website request' : …`.

---

## 7. Estimate-range check (A2)

**Comparable total** (VAT-exclusive, delivery excluded, same basis as `js/qr-def.js` `ESTIMATE` v1 = sum of priced list lines ex-VAT):
`comparableTotal(items, t) = Σ item.amount over items where id !== 'MISCFEE' − t.volumeBreakTotal − t.discountAmt` where `t = computeTotals()` (line 4914; `discountAmt` is the quote-level discount already capped, `volumeBreakTotal` the per-line breaks). Rush fee, FOC, VAT, delivery/installation (`diAmount`, MISCFEE lines, misc) are excluded. Options mode: use `basisTotals()`'s section.

`estimateCheck(comparable, est)` → `applicable = !!(est && est.low > 0 && est.high > 0)`; `inRange = low ≤ comparable ≤ high`; `pctOff = direction==='above' ? (comparable−high)/high : (low−comparable)/low`, rounded to 0.1 %.

Verify & File modal (`buildVerifyModal`, line 7385, after the reopen block): when `applicable && !inRange` show a verify-item "⚠️ Outside the estimate the client saw — client saw ₱L – ₱H online; this quote's comparable total (ex-VAT, before delivery) is ₱C, 12.4 % above. Review the lines or explain the difference when you send it." **`const ESTIMATE_RANGE_MODE = 'warn';`** (one constant beside `TUTORIAL_VERSION`): `'warn'` never blocks; `'reason'` renders a textarea and `canFile()` requires ≥ 10 characters, stored in `estimateCheck.reason`. Always filed: `estimateCheck {low, high, comparable, inRange, pctOff, reason}` (null when not applicable). Only the client-shown range is used — never `internal.exactTotal`.

---

## 8. Two-way link (A3) — flows and states

### 8.1 On file (app.js bridge, QUOTE_FILED / QUOTE_APPROVAL_REQUESTED, after `docRef` and `stampRoot`; QUOTE_UPDATE after the update)
If `payload.sourceRef && ['qr','cir'].includes(kind) && /^(QR|CIR)-\d{6}-[A-Z0-9]{6}$/.test(ref)`: `linkQuoteToRequest(sourceRef, {docId, coll, quoteNumber: data.fileName, version, total: data.total, status: data.status, byName})` — `collection = kind==='qr' ? 'quote_requests' : 'client_info_requests'`; read the doc; `quotes = (existing.quotes||[]).filter(q => q.docId !== docId).concat([entry]).slice(-50)`; `update({ quotes, quoteDocId: docId, lastQuoteAt: serverTimestamp(), updatedAt: serverTimestamp(), ...(statusShouldAdvance ? { status:'quoted', statusChangedAt, statusChangedBy: uid, statusChangedByName } : {}) })` where `statusShouldAdvance = ['new','in_review','contacted'].includes(existing.status)` (never demote `converted`/`archived`). Best-effort `try/catch` + `console.warn` + toast "Quote filed; could not update the request link" — never fails the filing. Partner sessions skip.

### 8.2 On client response (`functions/index.js respondToQuote`, inside the best-effort block after the internal quote update, lines ~1702–1712)
`const sref = qSnap.data().sourceRef;` if valid shape: `nextStatus = qr.requestStatusAfterResponse(existing.status, newStatus)` (pure, in `functions/qr-core.js`): `accepted` ⇒ `'converted'` unless already `'converted'|'archived'`; `changes_requested` ⇒ unchanged. Update the request: `status` (when changed), `quotes[i].status` for the matching `docId` (`'accepted'|'needs_revision'`), `updatedAt`. Admin SDK; wrapped in its own try/catch; logged. Redeploy `functions:respondToQuote` only.

### 8.3 Request detail shows its quotes (`_qrRenderDetail` ~465 and the CIR detail)
New card "Quotes" after the action card: one row per `quotes[]` entry — quote number, `v`ersion, status pill, total (`qrCanWrite` only; the secretary sees number + status), filed date, **Open** → `reopenQuoteFromDoc(coll, docId, 'bk-quote-builder')` (the existing opener; a `permission-denied` toasts "Only its author or an admin can open this quote"). Empty state: "No quote yet — Open in Quote Builder". Status select gains `'quoted'` for CIR (line 485 `statusOptions`), and both lists' status filter/pill maps.

### 8.4 State table

| request | event | → status | who writes |
|---|---|---|---|
| QR new / in_review | quote filed or sent for approval with `sourceRef` | quoted | bridge (client, rules §3.5b) |
| QR quoted | another revision filed | quoted (quotes[] appended) | bridge |
| QR quoted / in_review / new | client **accepts** via `/q/` | converted | `respondToQuote` (Admin SDK) |
| QR any | client requests changes | unchanged; `quotes[i].status = needs_revision` | `respondToQuote` |
| QR converted / archived | anything above | unchanged (never demoted) | — |
| CIR new / in_review / contacted | quote filed with `sourceRef` | quoted | bridge (rules §3.5c) |
| CIR quoted | accept | converted | `respondToQuote` |
| any | staff status select | as chosen (enum) | screen (existing) |
"Convert to client" (CRM) keeps setting `converted` as today; after a quote, `converted` therefore means "client record exists and/or quote accepted" — see §11.

---

## 9. Tests (add/change per file; mutation targets for every money path)

**New `tests/qb-configured.test.mjs`** (`require('../js/qb-configured.js')` with real `js/product-families.js`, `js/pricing-core.js`, `js/qr-families.js`; synthetic products/sheets — NO real prices):
- `priceLine` PARITY: for 300 random valid (family, config, size) triples and 3 synthetic sheets (approved/unapproved/blank-cell), `priceLine(...)` equals `functions/qr-core.js computeBasket([...]).lines[0]` on `unitPrice, priced, reason, missing, base, deltas, warnings` — including the stove soft-width case. **Mutations (each must fail ≥ 1 test; record which):** drop the soft-width substitution; apply it to hard rules too; pass `size` instead of `pricedSize`; pass `FAM.version+1`; treat a blank cell as 0.
- `costBasisFor`/`nearestAbsorbed`: exact match → `approx:false`, scale = cfgList/skuList; nearest by score (choice/multi/slots cases with a constructed tie → map order); clamp at 0.25 and 4 flags approx; zero SKU cost → `hasBasis:false`; size ≠ default → approx. **Mutations:** scale inverted; clamp removed; tie → last; use primary instead of nearest; `hasBasis` true on zero cost.
- `isAutoPriceable`: table over `{priceManual, priceBasis}` × MISCFEE. **Mutations:** treat `'website'` as auto; treat `'manual'` as auto; ignore `priceManual`.
- `comparableTotal`/`estimateCheck`: MISCFEE excluded, discount and volume breaks subtracted, VAT/rush/delivery ignored; boundaries `low` and `high` inclusive; `applicable:false` on null/0. **Mutations:** include MISCFEE; forget the discount; exclusive bounds; swap low/high.
- `fromRequestItem`: configured priced → `familyId/config/size/specs`, `priceBasis:'website'`, `basisUnitPrice`, no `priceManual`, `sourceRef {kind:'qr', ref, n}`; configured unpriced (each reason) → `'manual'`, `needsPrice:true`, `unitPrice 0`; plain priced → `'website'`; plain unpriced → `'manual'` + `needsPrice`. Hostile strings pass through unescaped (rendering escapes) and never become HTML in `specStr`.
- `purposeFor` and `locationCodeFor`: every row of §6.3/§6.4 pinned; government override; unknown → Other/OT; `'Quezon City, Metro Manila'` → ML; `'San Fernando, La Union'` → LU.
- `migrateLegacyConfiguredLine`: a `PW-006` plain line with specs → sink config via `specMap`, size kept on step; a non-absorbed id → null.

**`tests/family-staff.test.mjs`** `describe('Open in Quote Builder')` (lines 812–858): rewrite — configured line lands with `familyId/config/size`, `priceBasis:'website'`, **no `priceManual`** when priced; unpriced → `priceBasis:'manual'`, `needsPrice:true`, `unitPrice 0`, still no bare-SKU price; fixed priced line → `priceBasis:'website'`; `qrOpenInBuilder` state carries `currentCo:'BK', qnoMethod:'WB', qnoLoc, purpose, sourceRef.kind/ref/estimate, handoff:true`. Rules text test (line 860 block): `product_pricing` read contains `cirWriter()`; `quote_requests` allowlist contains `'quotes'` and `'lastQuoteAt'`; CIR enum contains `'quoted'`; CIR allowlist contains `'quoteDocId'`.
**`tests/cir-staff-briefs.test.mjs`** (Prefill block ~345): v1 and v2 prefill carry `sourceRef {kind:'cir'}`, `qnoMethod 'WB'`, mapped purpose and location; a hospital brief → "Hospital / Institutional".
**`tests/quote-request.test.mjs`** "functions/index.js glue" (line 1020): `requestStatusAfterResponse` table (accepted×{new,in_review,quoted}→converted; converted/archived unchanged; changes_requested never changes); `respondToQuote` source contains the `sourceRef` block and the `/^(QR|CIR)-/` guard. **Mutations:** demote converted; advance on changes_requested.
**New `tests/quote-builder-static.test.mjs`** (string assertions over `quote-builder-v2.html`): the three new script tags in order after `pricing-core.js`; `_cfg` in the strip destructuring; `applyComputedPricing` body contains `QBConfigured.isAutoPriceable`; `itemCostBasis` contains `item.familyId`; `TUTORIAL_VERSION === 43`; `WHATS_NEW[0].ver === 43`; `TOUR_STEPS` targets `#configPanel` and the id exists; `ESTIMATE_RANGE_MODE` declared; `applyPartnerMode` removes `#configPanel`; no `barroindustries@gmail.com`; `21 Capricorn St., Tandang Sora, Quezon City, 1116 Metro Manila` present for BK and BI; `CO.BS` unchanged vs `git show HEAD:quote-builder-v2.html` — no e-mail invented.
**New `tests/contact-details.test.mjs`** (A5): `js/config.js` BK/BI `contact/creds/address/addressShort/email`, `js/screens/sales.js QUOTE_BRANDS` BK/BI, `functions/portal-core.js` signature all carry `hello@barroindustries.com` and the Capricorn address; no `gmail` in those four files outside comments; BS entries unchanged; `tests/privacy-notices.test.mjs` untouched (old notice versions keep the Gmail string by design).
**`tests/pricing-core.test.mjs`**: no change (assert the export list is unchanged — one line).
Gates after everything: `node --test tests/*.test.mjs && bash scripts/ci-invariants.sh && node scripts/check-ui-wiring.js`.

---

## 10. Rollout order, flags, migration

1. **Rules** (§3.5, three hunks) — `git diff firestore.rules` shows only them; `bash scripts/release.sh rules`. Nothing else may ship first.
2. **Functions** — `firebase deploy --only functions:respondToQuote` (selective; `functions/qr-core.js` gains one pure export). Record via `release.sh record functions`.
3. **App + builder** — one commit (hook bumps versions): `js/qb-configured.js`, `sw.js` PRECACHE line, `js/config.js` PAGE_SCRIPTS (`'dept:Sales'` and `'bk-quotations'` gain `'js/qb-configured.js'`), `quote-builder-v2.html`, `js/app.js`, `js/screens/quote-requests.js`, `js/screens/client-info-requests.js`, A5 files, tests, STATUS.md. `release.sh push` → `verify`.
4. Live smoke (President, phone): website RFQ with one configured sink + one fixed item → Sales › Quote requests → Open in Quote Builder → change basins → price moves → file → request shows the quote → `/q/` accept → request `converted`. Then flip `productMeta/config.quoteBuilder.configurator=false` and confirm the panel disappears and existing lines still print; flip back.

**Flags / kill switches:** `productMeta/config.quoteBuilder.configurator` (doc flag, no deploy); `ESTIMATE_RANGE_MODE` constant; partner mode is hard-off. Rollback = `git revert`; the rules hunks are harmless if orphaned; `respondToQuote` without `sourceRef` on any doc is a no-op.

**Migration (10.3):** quotes filed before this ship with "(configured)" plain `priceManual` lines reopen exactly as before (no `familyId` ⇒ plain path; `priceManual` grafted from the sidecar keeps them off the auto-pricer). `renderItems` offers **"⚙ convert to configured"** on any plain line whose `id` is absorbed (`migrateLegacyConfiguredLine`); conversion keeps `unitPrice` and sets `priceBasis:'manual'`. No data migration script. Old `quote_requests` without `quotes[]` show the empty state.

---

## 11. Risks / open questions for the owner (recommended default in bold; defaults in force unless he overrides)

1. Widening `product_pricing` READ to non-secretary Sales members (§2.4) exposes the option amounts to the same people who already see the build-up on the RFQ screen. **Default: widen as specified.** Alternative: a `qbPriceConfigured` callable so the builder never reads the sheet.
2. Cost basis for a configured line is a proportional scale of the nearest absorbed SKU's cost (§4.5), labelled approximate. **Default: ship as specified; per-option cost cells later (schema reserved: `options[g][v].cost`).**
3. `converted` on a request now also means "quote accepted" (§8.4). **Default: accept the overload.** Alternative: add `'accepted'` to both enums.
4. CIR `bakery` → `Other` purpose. **Default: Other.** Option: add "Bakery" to `#purpose`.
5. Estimate-range check warns only. **Default: `'warn'`** (owner default 2026-10-28).
6. `CO.BS` has no e-mail (pre-existing quirk, line 1935). **Left as is; do not invent one.**
7. Preview images in the builder (§4.4) deferred. **Default: text summary now.**

---

## 12. Work breakdown (file ownership; land in this order)

| # | chunk | owns (no other chunk edits these) | depends on |
|---|---|---|---|
| **WS-0** Rules + server | `firestore.rules` (§3.5), `functions/qr-core.js` (`requestStatusAfterResponse`), `functions/index.js` (`respondToQuote` §8.2), `tests/quote-request.test.mjs` (§9 glue block), rules-text assertions in `tests/family-staff.test.mjs` lines 860+ | — (deploy rules first) |
| **WS-1** Pure module | `js/qb-configured.js`, `tests/qb-configured.test.mjs`, `sw.js` (one PRECACHE line) | WS-0 (parity fixtures import `functions/qr-core.js` read-only) |
| **WS-2** Builder | `quote-builder-v2.html` only (script tags, `#configPanel` + CSS, configurator functions, line shape, `itemCostBasis` hook, R1–R7, Verify warning + gate, handoff bar, `QB_OPEN_SOURCE` post, strip list, template drop list, `loadEditableState` ids, migration button, **CO.BK/CO.BI contact edits**, TUTORIAL 43 / WHATS_NEW / Help / TOUR), `tests/quote-builder-static.test.mjs` | WS-1 API |
| **WS-3** App side | `js/app.js` (bridge allowlists `sourceRef`/`estimateCheck`, `linkQuoteToRequest`, `handoff` → `reopen=1`, strip label, `QB_OPEN_SOURCE` handler), `js/screens/quote-requests.js` (handoff via `QBConfigured`, Quotes card), `js/screens/client-info-requests.js` (prefill, `'quoted'` option/filter, Quotes card), `tests/family-staff.test.mjs` Open-in-Builder block, `tests/cir-staff-briefs.test.mjs` prefill block | WS-1 API; WS-0 rules deployed before testing live |
| **WS-4** Contact details + docs | `js/config.js` (BK/BI contact lines 2860–2904 AND the two PAGE_SCRIPTS lines from §10.3), `js/screens/sales.js` QUOTE_BRANDS BK/BI, `functions/portal-core.js` line 645, `tests/contact-details.test.mjs`, `STATUS.md` | independent |

(Coordinator change vs the original draft: WS-4 owns ALL `js/config.js` edits, including WS-1's PAGE_SCRIPTS lines, so no two agents edit that file.)

Acceptance for the package: all three gates green; every §9 mutation recorded as killed; §10.4 smoke done; no price token added to any committed file; public website byte-identical (`git diff -- index.html catalogue/ site/ css/site.css` empty).

---

## 13. Follow-ups (not in this package)
Package B: send-to-client from the request, response-time tracking, service-only requests, photo upload on the QR form. Package C: preview images in the builder, per-option cost cells, `/catalogue/?configure=<family>` deep link, "Bakery" purpose, `'accepted'` request status, the third company letterhead e-mail/address, a `qbPriceConfigured` callable if the owner later wants the sheet unreadable by Sales.

---

## 14. ADDENDUM — Standard construction (owner ruling 2026-10-28) and the staff-only 1.2 mm top option

Status: SPEC addendum (planning 2026-10-28). Lands AFTER WS-0/WS-1 and after WS-2/WS-3 where noted; file ownership in §14.8. Line numbers are locators — re-grep. Owner ruling: made-to-order fabricated equipment (the six families and custom fabrication) is **SS304 · 1.5 mm (16 ga) top plates on tables, sinks and stoves · square-tube posts with adjustable bullet feet · 1.2 mm body and shelving**. 1.5 mm is the DEFAULT; 1.2 mm stays a lighter option, chosen by staff only. Owner: show it on quotes AND the website. Fixed bought-in catalogue items keep their own notes (CE-016 "SS202 1.0mm inner", CE-020 "SS1.2mm top, 0.8mm lower", …) — nothing rewrites a product note, and every public sentence is scoped to "made-to-order" so it cannot contradict them. Still in force: no prices public; Brilliant Steel/Vesta/Barro Steel never named publicly; no grade or finish option on the WEBSITE configurators (standard text only); the SS316 grade is a staff-only Quote Builder choice since 2026-10-28 (specs/CONFIGURATOR-GRADE-TITLES-SPEC.md); no real price in a committed file.

Verified facts (2026-10-28): `scripts/public-families.json` version is 1; `renderFamiliesJs` writes js/ + functions/ copies (CHECK 10); `priceConfiguredItem` prices a `choice` value only when `v !== g.default`, and a blank cell is `missing_input` (never zero); `normalisePricingDoc` builds a null cell for every group the family defines; `fpStatus` marks a sheet "Out of date — approve again" when `schemaVersion !== QR_FAMILIES.version`; NO family sheet is imported/approved yet (STATUS pending op), so a version bump costs nothing live; `functions/qr-core.js normaliseItems` calls `PF.validateLine(fam, raw.config, raw.dims)` with no options and stores `PF.describe(...)`; the only products spec "Top Gauge" is on BA-001 (absorbed by prep_table, never a website card; "1.2mm (std)" default / "1.5mm heavy-duty" with an adder); there is NO UI for editing `specs[].options/default/priceAdder`; primaries' notes show thinner tops (CE-001 "SS304 1.1mm top, 0.8mm body"); `qb-configured.js nearestAbsorbed` compares raw absorbed configs; `tests/product-families.test.mjs` ~199 bans a "gauge" group label and pins group shapes; `tests/seo-products.test.mjs` 761–767 counts option rows == `fam.groups.length`; `tests/catalogue-layout.test.mjs` 173–186 pins card ending `Size → Material → Learn more`; PDFs rebuilt by `node scripts/build-downloads.js`; `tests/content-assets.test.mjs` ~773 requires PDF page count == HTML page count.

### 14.1 Single source of truth — `scripts/public-families.json` (generated by `node scripts/build-catalogue.js`)

**(a) `version`: 1 → 2.** (§14.4; owner Q1.)

**(b) New family field `construction`** (string, public). Tokens `{<groupKey>}` name a `choice` group; each option of that group gains field `c` (its construction phrase):

| family | `construction` |
|---|---|
| prep_table | `SS304 stainless steel · {top} · 1.2 mm undershelves and upper shelves · square-tube posts with adjustable bullet feet` |
| sink | `SS304 stainless steel · {top} · 1.2 mm undershelf, upper shelf and panels · square-tube posts with adjustable bullet feet` |
| stove | `SS304 stainless steel · {top} · 1.2 mm body and panels · square-tube posts with adjustable bullet feet` |
| cabinet | `SS304 stainless steel · 1.2 mm body, doors and shelves · {type}` — `type` options gain `c`: floor → `square-tube posts with adjustable bullet feet`, wall → `wall-hung` |
| wall_shelf | `SS304 stainless steel · 1.2 mm shelves · fixed to the wall` |
| rack | `SS304 stainless steel · 1.2 mm shelves · square-tube frame · {wheels}` — `wheels` options gain `c`: true → `on wheels`, false → `adjustable bullet feet` |

Sink bowls are NOT claimed as 1.5 mm (owner Q5). No "gauge" word in labels, no money token, no brand. (Verify each family's real group keys/values — e.g. cabinet `type`, rack `wheels` — and use the actual keys.)

**(c) New group on prep_table, sink, stove** (appended LAST in `groups`):
```json
{ "key": "top", "label": "Top plate", "type": "choice", "default": 1.5, "staffOnly": true,
  "options": [
    { "v": 1.5, "l": "1.5 mm (16 ga)", "s": "1.5 mm top", "c": "1.5 mm (16 ga) top plate", "hint": "Standard" },
    { "v": 1.2, "l": "1.2 mm",         "s": "1.2 mm top", "c": "1.2 mm top plate (lighter)", "hint": "Lighter" } ] }
```
`v` numeric (sheet cell keys `'1.5'`/`'1.2'`). `absorbed` maps do NOT gain `top`; every absorbed SKU converts to the 1.5 default. `preview` rules ignore `top`.

**(d) `scripts/build-catalogue.js`** (`checkFamily` ~638, constants ~614–620): `FAMILY_KEYS` and `FAMILY_PUBLIC_KEYS` gain `'construction'` (emitted after `description`); `GROUP_KEYS` gains `'staffOnly'` (boolean, only on `choice` groups); `OPTION_KEYS` gains `'c'`. Validate: `construction` non-empty; every `{token}` names a `choice` group and every option of that group has `c`; absorbed configs must state every NON-staffOnly option and may not state a staffOnly one (~787); the primary check (~790) compares `PF.canonicalConfig(fam, PF.validateConfiguration(fam, ab[f.primary], {staff:true}).config)` with the canonical default config. `renderFamilyCard` (~1030): rows = `PF.publicGroups(fam)` options → `Size` → **`['Construction', PF.constructionLine(fam, PF.defaultConfig(fam))]`** → `Material` (still last). Public-text guard (~801) scans the new strings. Run the build; commit `catalogue/index.html`, `js/qr-families.js`, `functions/qr-families.js` (qr-published.json unchanged).

### 14.2 Logic — `js/product-families.js` (edit, then `cp` to `functions/product-families.js`; CHECK 10)

Existing signatures unchanged; only an OPTIONAL trailing `opts`.
- `publicGroups(family)` → `groups.filter(g => g.staffOnly !== true)`.
- `validateConfiguration(family, raw, opts)`: PUBLIC mode (`!(opts && opts.staff === true)`: server, website, tests' default) — a staffOnly key PRESENT with value `!== g.default` is an error `'"' + g.label + '" is chosen by our staff when the quotation is prepared.'` and the config takes the default; present-and-default accepted; absent → default (both modes). Staff mode validates it like any choice. `validateLine(family, rawConfig, rawDims, opts)` passes `opts` through. `functions/qr-core.js` NOT edited (calls without opts → public enforcement automatic).
- `constructionLine(family, config)` → `''` when no `construction`; else tokens replaced by the chosen option's `c` (fallback `f`, then `l`); absent/invalid value → group default. Pure, never throws.
- `defaultConfig(family)` (add if absent) → every group at its default.
- `describe(family, config)` → one row per NON-staffOnly group (as today), then, when `family.construction`, a final row `{ label: 'Construction', value: constructionLine(family, config) }`. No separate `Top plate` row.
- `summaryParts`: a staffOnly group contributes its `s` ONLY when `config[key] !== g.default`.
- `cells(family)`: unchanged (lists `top` with `1.5` baseline) — how Finance enters the 1.2 cell. `canonicalConfig`/`sameConfig`: unchanged.
- `migrateAbsorbed`: unchanged; its output validates in PUBLIC mode for all 44 absorbed SKUs (test).

**Consumers passing `{staff:true}`:** `js/screens/family-pricing.js` `fpTry` (~476) plus the group header caption (~219) "Staff-only option — offered in the Quote Builder, never on the website"; the builder (§14.6); `js/qb-configured.js` (`buildLine`, `migrateLegacyConfiguredLine`, any `validateLine` call) plus **`nearestAbsorbed`/`scoreConfig`/`canonical` fill an absent group key on the ABSORBED side with `g.default` before comparing** (else `exact` is never true once `top` exists).

### 14.3 Where the standard construction shows

| surface | rendering | owner |
|---|---|---|
| Builder configured line (printed quote, Verify, workforce copy) | the `Construction` row of `specs` (from `PF.describe`), never an amount | WS-5C |
| Builder `#configPanel` | staffOnly groups render as pills with a `staff` chip (title "Not offered on the website"); summary = `PF.summaryLine` | WS-5C |
| Stored `quote_requests.items[].specs` | server `PF.describe` → new requests carry the Construction row; old stored requests keep their specs and stay valid; ⚙ re-configure regenerates | WS-5A (mirror) |
| Website configurator sheet (`js/quote-request.js` ~1167) | iterate `PF.publicGroups(fam)`; after the groups a read-only `<p class="qr-hint qr-construction">` = `'Construction: ' + PF.constructionLine(fam, st.config)`; review/receipt via `lineSpecsText` unchanged | WS-5B |
| Catalogue card | Construction row between Size and Material | WS-5A |
| `/products/<slug>/` ×6 | `<dl>` "What you can choose": `<div><dt>Construction</dt><dd>{constructionLine(default)}.</dd></div>` before Material; `/products/` hub: under "Two grades, three finishes": "Made-to-order tables, sinks and stoves have a 1.5 mm (16 gauge) top plate; bodies and shelving are 1.2 mm; floor-standing pieces stand on square-tube posts with adjustable bullet feet." | WS-5B |
| FAQ "What material do you use?" (visible + FAQPage JSON-LD, identical) | after "…polished to a professional finish.": "Our made-to-order tables, sinks and stoves have a 1.5 mm (16 gauge) top plate, with 1.2 mm bodies and shelving and square-tube posts with adjustable bullet feet; bought-in equipment such as fryers, ovens and refrigeration keeps the specification shown in its catalogue notes." (guide link sentence stays last) | WS-5B |
| llms.txt | key fact after Materials: "- Construction: made-to-order tables, sinks and stoves have a 1.5 mm (16 gauge) top plate; bodies and shelving 1.2 mm; square-tube posts with adjustable bullet feet." | WS-5B |
| PDFs | `scripts/downloads/catalogue.js` reads card specs → Construction row flows to family pages; its materials table filter (~327) gains `'Construction'`; add the hub sentence to "Materials and finishes" in catalogue.js (~313) and profile.js (~134); `node scripts/build-downloads.js` regenerates `downloads/src/*.html` + 3 PDFs (page counts unchanged — shorten a caption if a page overflows) | WS-5B |

### 14.4 Pricing — nothing changes silently

- **Default = zero point.** No delta for `top: 1.5` → every public configuration prices as today. `top: 1.2` reads `options.top['1.2']`: blank → `missing_input`, missing `'Top plate: 1.2 mm'` → "priced after review" (builder §4.4 manual flow). Sign convention: the cell is the SIGNED amount added for 1.2 mm — Finance enters a NEGATIVE number or 0; never derived.
- **Confirmation gate = the approval mechanism.** `version` 2 makes every sheet "Out of date — approve again" and configured lines "priced after review" until Finance/President re-approves each family at schema 2 — acknowledging "the base item's list price is the 1.5 mm price". Nothing is approved today; regenerate the seed (`node scripts/derive-family-pricing.js`; `fpPlanImport` refuses schema 1).
- **Base price semantics (owner Q2, default A):** A — primaries' list prices unchanged and now mean the 1.5 mm product. B — President raises primaries' `basePrice` on the Product Database.
- **Derive script** (`scripts/derive-family-pricing.js`): prep_table/sink/stove `setCell('top', '1.2', lbl('top', 1.2), blank(...))` with text "The standard top is now 1.5 mm (16 ga); the base item's list price is read as the 1.5 mm price. Enter what a 1.2 mm top takes OFF (a negative amount), or 0 if it should cost the same." — plus the BA-001 "Top Gauge" adder as a cross-reference inside the note ONLY (via `specAdder('BA-001','Top Gauge','1.2mm (std)','1.5mm heavy-duty')`), cell stays BLANK. Source holds no number.
- Family pricing screen: no logic change beyond §14.2 caption; `fpCounts` counts the new blank cell.

### 14.5 Plain products with a "Top Gauge" spec — BA-001 only

New `scripts/flip-top-gauge-default.js` (Admin SDK, `FIREBASE_SERVICE_ACCOUNT` like `scripts/migrate-files-hub.js`; **dry-run by default, `--apply` to write**; prints ids and option labels only — never `priceAdder`). For each `products` doc with a spec label `/^top gauge$/i`: `"1.2mm (std)"` → `"1.2mm (lighter)"`, `"1.5mm heavy-duty"` → `"1.5mm (16 ga, standard)"` (others reported, untouched), `default` → the 1.5 option; `priceAdder` untouched. Idempotent. Effect: builder calc panel opens BA-001 on 1.5 and adds the master's existing 1.5 adder (visible in the select label); website unaffected.

### 14.6 Builder (WS-5C — `quote-builder-v2.html` only, after WS-2)

`#configPanel` renders staffOnly choice groups like any ≤4-option group plus `<span class="cfg-staff-chip no-print">staff</span>`; every `PF.validateLine`/`validateConfiguration` call in the builder passes `{staff:true}`; `configureInstead` and ⚙ edit pass the line's `config` (absent `top` → 1.5). Tutorial: if ver 43 has not shipped, append to `WHATS_NEW[0].items`: "Tables, sinks and stoves now quote with a 1.5 mm (16 ga) top as standard and print their construction on the quote; staff can still pick a lighter 1.2 mm top, priced once Finance enters its amount."; if 43 shipped, `TUTORIAL_VERSION` 44 with that entry. Help "Configure a product" gains one sentence on the staff-only option. Partner sessions unchanged.

### 14.7 Tests (mutation-tested; record each killed mutant) and CI

- **product-families.test.mjs** — shape pins gain `['top','choice',[1.5,1.2]]` on prep_table/sink/stove ("owner ruling 2026-10-28"); keep banned "gauge" label regex; absorbed counts `[9,10,15,4,3,3]` unchanged. New "construction" block: `constructionLine` per family at default = §14.1 strings; `describe` ends with Construction and never emits `Top plate`; `summaryParts` omits `top` at default, says `1.2 mm top` otherwise; public `validateConfiguration` refuses `{top:1.2}` with the exact message, accepts `{top:1.5}`/absent; staff accepts 1.2; no absorbed config states a staffOnly key; `migrateAbsorbed` output validates PUBLIC for all 44; `publicGroups` excludes exactly `top`; generator output === committed js/qr-families.js. **Mutants:** public accepts 1.2; describe emits `Top plate`; `constructionLine` ignores config; `summaryParts` emits default; staff refuses; generator drops `construction` from `FAMILY_PUBLIC_KEYS`.
- **catalogue-layout.test.mjs** (173–191) — rows: public groups, Size, Construction (pinned per family), Material last; never "staff"/"Top plate" on a card.
- **family-page.test.mjs** — no control for `top`; payload config never has `top`; Construction hint shows the 1.5 sentence; `sanitizeFamilyItem` with stored `top:1.2` → dropped with notice, `top:1.5` kept.
- **quote-request.test.mjs** (new describe block, not WS-0's) — `normaliseItems`: `top:1.2` refused with message, `top:1.5`/absent accepted, stored `config.top === 1.5`; stored specs have Construction, no `Top plate`; `computeBasket` default unchanged vs fixture sheet; sheet at schema 1 → `not_approved`. **Mutants:** server passes `{staff:true}`; version left at 1.
- **family-staff.test.mjs** (family-pricing blocks 170–579 only) — Top plate cells with caption; `fpTry` prices 1.2 after a negative cell, "Priced after review — … Top plate: 1.2 mm" when blank; schema-1 sheet reads "Out of date — approve again".
- **derive-family-pricing.test.mjs** — `top/1.2` present and BLANK for three families; seed `schemaVersion` 2; no-number scan passes.
- **qb-configured.test.mjs** — `nearestAbsorbed` exact for the primary at full default incl. `top`; `{…, top:1.2}` not exact, nearest still primary; `priceLine` blank top cell → missing `['Top plate: 1.2 mm']`. **Mutant:** no default fill → exact false.
- **seo-products.test.mjs** (761–767) — Construction row on six pages `=== PF.constructionLine(fam, defaults) + '.'`; option-row count `=== PF.publicGroups(fam).length`; FAQ sentence pinned (visible + JSON-LD). **content-assets.test.mjs** (187) — llms.txt Construction line; PDFs rebuilt. **site-public-surface.test.mjs** ~1181 — `js/quote-request.js` uses `publicGroups(`.
- **quote-builder-static.test.mjs** (WS-5C) — builder `validateLine(` calls carry `staff:true`; `cfg-staff-chip`; WHATS_NEW bullet.
- CI: CHECK 10 and CHECK 9 unchanged ("1.5 mm", "16 ga" are not money tokens). Gates: `node --test tests/*.test.mjs && bash scripts/ci-invariants.sh && node scripts/check-ui-wiring.js`.

### 14.8 Rollout and file ownership

| # | chunk | owns | after |
|---|---|---|---|
| **WS-5A** Definitions + logic | `scripts/public-families.json`, `scripts/build-catalogue.js`, generated `js/qr-families.js` + `functions/qr-families.js` + `catalogue/index.html`, `js/product-families.js` + `functions/product-families.js`, `scripts/derive-family-pricing.js`, `js/screens/family-pricing.js`, `js/qb-configured.js` (ONLY `{staff:true}` calls + default-fill), tests: product-families, catalogue-layout, derive-family-pricing, family-staff 170–579, quote-request (new block), qb-configured (new block) | WS-0, WS-1, WS-3 |
| **WS-5B** Public surfaces | `js/quote-request.js`, `products/*/index.html` (7), `faq/index.html`, `llms.txt`, `scripts/downloads/catalogue.js`, `scripts/downloads/profile.js`, `downloads/src/*.html`, `downloads/*.pdf`, tests: family-page, seo-products, site-public-surface, content-assets | WS-5A |
| **WS-5C** Builder | `quote-builder-v2.html`, `tests/quote-builder-static.test.mjs` | WS-2, WS-5A |
| **WS-5D** Data + ops | `scripts/flip-top-gauge-default.js`, `STATUS.md` (pending ops) | independent |

WS-2/WS-3 read `js/qr-families.js` and `js/product-families.js` but must not edit them.

**Deploy order (after Package A §10.1–10.3):** (1) one app commit with WS-5A–D → `release.sh push`. (2) President: `node scripts/derive-family-pricing.js` → Inventory › Family pricing → Import → enter the three `Top plate: 1.2 mm` amounts (negative or 0) → Approve ×6 (schema 2). (3) `firebase deploy --only functions:qrEstimate,functions:qrSubmit` → `release.sh record functions` (old functions + new page safe; new functions + schema-1 sheets = "priced after review", today's state anyway). (4) `node scripts/flip-top-gauge-default.js` dry run → `--apply`. (5) Confirm the 3 PDFs open. (6) Smoke: website sink defaults; builder sink → Top plate 1.2 → "Priced after review — Top plate: 1.2 mm" → typed price → print shows "Construction: SS304 stainless steel · 1.2 mm top plate (lighter) · …". Rollback = `git revert` + redeploy the two callables.

### 14.9 Owner questions (defaults in bold, in force unless overridden)

1. Bump family schema to 2 so sheets must be re-approved knowing the base is the 1.5 mm price? **Yes.**
2. Base prices: **A — unchanged; list price now buys the 1.5 mm top.** B — raise primaries' base prices.
3. 1.2 mm cell: **blank until Finance types it (negative or 0).**
4. BA-001 "Top Gauge": **flip script (default → 1.5, labels renamed, adder unchanged) — its builder default price rises by the master's own 1.5 adder.**
5. Wording: **as written; sink bowls not claimed as 1.5 mm.**
6. Public caveat about bought-in equipment keeping its notes: **include.**
7. Staff quoting under BS: **1.2 option available there too**; partners never (and partner feature is being removed after this package).
