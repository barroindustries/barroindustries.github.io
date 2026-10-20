# PRODUCT-CONFIGURATOR-SPEC — product-family configurators: one configuration model, one pricing path, for the Quote Builder AND the public "Add to quote"

_Architect: Fable 5.1 · 2026-10-21 · Status: SPEC (nothing built yet). Companion of `specs/PUBLIC-QUOTE-REQUEST-SPEC.md` (read it first — §6.2 `js/pricing-core.js`, §3.4 the catalogue data island, §5.3 `qrEstimate`)._
_Owner's words: "lets upgrade our sales computation" — product families with configurable options (preparation tables, sinks, cabinets, wall shelving, racks, stoves with per-position burners and add-ons, "etc etc"). His message ended "next will be" — this spec is built to absorb more families without a schema change._

> **Read before anything else:** CLAUDE.md, STATUS.md, `specs/PUBLIC-QUOTE-REQUEST-SPEC.md`, `quote-builder-v2.html` L3392–3700 (`selectProduct` → `buildCalcPanel` → `renderDimInputs` → `computePrice` → `addItemFromCalc`), L6604–6700 (`applyComputedPricing`, costed-line auto-pricer — untouched by this spec), L7925 (`loadEditableState`), L8281+ (`TUTORIAL_VERSION`, `WHATS_NEW`, `TOUR_STEPS`), `.claude/skills/quote-builder-tutorial/SKILL.md`, `js/app.js` L2551 (`catalogDocFromJson`) and the Product Database page (`renderProductDatabase` in js/screens/inventory.js — find it with grep), `firestore.rules` `products` / `product_costs` blocks (L1384–1407).

---

## 0. Summary

Today a catalogue product is one SKU with one `formulaType` (`fixed | per_length | per_area | per_run | configurable`), a `basePrice`, a dimension formula (`baseLengthMm`, `pricePerExtraMm`, `rateW100/D100/H100`, `pricePerSqm`, `pricePerRun`) and, on 26 SKUs, `specs[]` drop-downs with `priceAdder[]`. Sinks with 1/2/3 basins, tables with 1/2/3 layers and stoves with 1/2/3/4 burners are **separate SKUs** (PW-004…009, PW-001…003, CE-001…004).

This spec adds a **family layer on top of the SKUs, not instead of them**: a **family** is a named option schema (option groups, choice types, per-position slots, dimension rules, constraints) plus a map of **today's SKUs onto their default configurations**. A configured item is `{ family, config, dims, qty }`; its price is **the matched SKU's existing list price (unchanged, byte-identical) plus signed option deltas** read from a **private, server-side pricing table the owner fills in** (`product_pricing/{familyId}`, never shipped to the browser). One pure function, `priceConfiguredItem()`, is used by the Quote Builder (staff) and by `qrEstimate` (public). Every existing product ID stays valid; an unconfigured SKU prices exactly as today — pinned by an identity test over all 165 SKUs.

**Scope here:** schema + pricing model + the owner pricing-input sheet (every option, mode, EMPTY value) + the 165-SKU family mapping + tests + Quote Builder configurator UI (tutorial contract) + the public sheet hook + phasing. **No peso value is invented anywhere in this spec.**

---

## 1. Owner decisions needed (proposals — approve, amend or strike; defaults the implementer uses are marked)

| # | Proposal | Default if not ruled |
|---|---|---|
| P1 | **Family list and option groups in §3** (the owner named tables, sinks, cabinets, wall shelving, racks, stoves; the rest are my proposals grounded in the master). | Build §3 as written; families marked *(proposed)* are built **schema-only** (no SKU is re-pointed to them until the owner approves), families marked *(fixed-SKU)* get no configurator. |
| P2 | **Module widths for burner positions and add-ons** (§3.1 `slotWidthMm`) — these are DIMENSIONS, not prices, but still the owner's fabrication rule. Proposed from the master's own progression (1 burner W600 → 2 W800 → 3 W1000 → 4 W1200 ⇒ ~200 mm per extra open-top position + a 400 mm end allowance). | Use the proposed numbers; they only drive the `W ≥ Σ slots` constraint and the suggested default width — never a price. |
| P3 | **Pricing values** — the §5 sheet is EMPTY by design. Until a family's sheet is filled and `published: true`, that family is **not configurable** (SKU mode only) in both the builder and the public sheet. | Nothing is priced from a blank cell, ever (§4.4). |
| P4 | **Where staff fill the sheet:** a "Family pricing" editor on the Inventory › Product Pricelist screen (president + finance), one form per family generated from the schema. | Build it in Phase A (§7); until then Finance can fill the doc from the Firestore console using the exact shape in §4.3. |
| P5 | **Phase order** (§8): A = schema + pricing table + pure function + Quote Builder; B = public sheet; the public quote request (companion spec) ships BEFORE both in plain SKU mode. | As recommended. |

---

## 2. Data model

### 2.1 Files

| File | Role | Loaded by | Mirror / guard |
|---|---|---|---|
| `js/product-families.js` (UMD, like `js/cir-forms.js`) | the FAMILY SCHEMA + SKU → default-config map (`window.PRODUCT_FAMILIES`). **No prices. Public by nature** (the catalogue page needs it). | `quote-builder-v2.html`, `/catalogue/` page, internal screens (via `PAGE_SCRIPTS`), tests | byte-identical `functions/product-families.js`; ci-invariants CHECK 10 (companion spec) extended to this pair; `tests/catalogue-public.test.mjs` runs `MONEY_RE`/`FORMULA_RE`/`BRAND_RE` over the file's serialized export (it must carry no price vocabulary) |
| `js/pricing-core.js` (companion spec §6.2) | gains the ADDITIVE export `priceConfiguredItem` + `resolveConfiguration` + `validateConfiguration` (§4) | builder, functions, tests | byte-identical `functions/pricing-core.js`; `tests/pricing-core.test.mjs` |
| Firestore `product_pricing/{familyId}` | the PRIVATE option price table (§4.3) | Admin SDK in `qrEstimate`; the builder in its `!PARTNER_MODE` load branch; the Family-pricing editor | `firestore.rules` §6: `isAuth() && !isPartner() && (isSeniorAdmin() \|\| canFinance())` read/write — same tier as `product_costs` |
| Firestore `products/{id}` | unchanged; gains two OPTIONAL fields written by the mapping seed: `family: 'sink'`, `config: {…}` (the SKU's default configuration) — informational for the Product Database page; the schema file is the authority | — | `products` create/update rules already lock cost fields; add `family`/`config` to no allowlist (none exists for products) — no rules change for this |

### 2.2 Family schema (`PRODUCT_FAMILIES`)

```js
var PRODUCT_FAMILIES = {
  version: 1,                               // bump on ANY schema change; stamped on items and on pricing docs
  families: {
    sink: {
      id: 'sink', label: 'Sinks', category: 'prep_washing', status: 'approved' | 'proposed' | 'fixed',
      primarySku: 'PW-004',                 // fallback SKU when no exact match (§4.2)
      matchKeys: ['basins', 'faucet'],      // which option keys decide the SKU match (§4.2) — the others are deltas only
      dims: {                               // dimension rules (mm). Absent axis = not customisable. Overrides QR_DEF.LIMITS for this family.
        W: { min: 500,  max: 4000, step: 10, perBasinMin: 500 },   // perBasinMin: W >= basins × perBasinMin (constraint c1)
        D: { min: 500,  max: 900,  step: 10 },
        H: { min: 750,  max: 950,  step: 10 }
      },
      groups: [                             // ordered; rendered top to bottom by the builder AND the public sheet
        { key: 'basins',     label: 'Number of basins',  type: 'count',   min: 1, max: 4, default: 1 },
        { key: 'alignment',  label: 'Basin position',    type: 'enum',    options: [{v:'left',l:'Left'},{v:'center',l:'Centre'},{v:'right',l:'Right'}], default: 'center',
                             showWhen: { basins: { lte: 2 } } },        // 3–4 basins fill the length; alignment is meaningless
        { key: 'undershelf', label: 'Undershelf',        type: 'boolean', default: false },
        { key: 'upperShelves', label: 'Upper shelves',   type: 'count',   min: 0, max: 2, default: 0 },
        { key: 'faucet',     label: 'Faucet',            type: 'enum',    options: [{v:'none',l:'None'},{v:'gooseneck',l:'Gooseneck'},{v:'prerinse',l:'Pre-rinse spray'}], default: 'gooseneck' },
        { key: 'basinDepth', label: 'Basin depth',       type: 'enum',    options: [{v:'250',l:'250 mm'},{v:'300',l:'300 mm'},{v:'350',l:'350 mm'}], default: '300' },
        { key: 'drainboards',label: 'Drainboards',       type: 'count',   min: 0, max: 2, default: 0 },
        { key: 'bottom',     label: 'Bottom',            type: 'enum',    options: [{v:'open',l:'Open legs'},{v:'slotted',l:'Slotted bottom shelf'},{v:'cabinet',l:'Enclosed cabinet'}], default: 'open' }
      ],
      constraints: [
        { id: 'c1', rule: 'dimMinPerCount', dim: 'W', count: 'basins', perUnitMm: 500, message: 'Width must be at least 500 mm per basin.' },
        { id: 'c2', rule: 'forbid', when: { bottom: 'cabinet' }, forbid: { undershelf: true }, message: 'A cabinet base already encloses the bottom — no separate undershelf.' }
      ],
      skus: {                               // today's SKUs → their default configuration (the SKU keeps its own basePrice/formula)
        'PW-004': { basins: 1, alignment: 'center', undershelf: false, upperShelves: 0, faucet: 'gooseneck', basinDepth: '300', drainboards: 0, bottom: 'open' },
        …
      }
    },
    …
  }
};
```

**Choice types**

| `type` | Config value | UI (builder + public sheet) | Pricing modes allowed (§4.1) |
|---|---|---|---|
| `enum` | one option `v` string | segmented control / select | `adder` (per value), `perW100` (per value) |
| `count` | integer `min..max` | stepper | `adderPerUnit`, `perW100PerUnit` |
| `boolean` | `true/false` | toggle | `adder`, `perW100` |
| `slots` | array of `n` option `v` strings, `n` in `minSlots..maxSlots`, each slot drawn from `slotOptions` | a row of position tiles ("Position 1: Wok · Position 2: HP large …") with +/− position | `perSlot` (per slot value) |
| `addons` | array of distinct option `v` strings (multi-select) | checkbox chips | `adder` (per value) |

Common group attributes: `key` (`^[a-z][a-zA-Z0-9]{1,30}$`, unique in the family), `label`, `type`, `default`, `showWhen` (visibility predicate `{ key: {eq|neq|lte|gte|in} }` — a hidden group is forced to its default in `resolveConfiguration`), `hint`, `public: true|false` (default `true`; `false` = staff-only option, hidden on the public sheet and forced to default there, e.g. top gauge).

**Constraint rules** (evaluated by `validateConfiguration`; each has `id`, `message`):

| `rule` | Shape | Meaning |
|---|---|---|
| `dimMinPerCount` | `{dim, count, perUnitMm}` | `dims[dim] >= config[count] × perUnitMm` |
| `dimMinSlots` | `{dim, slots, widths:{v:mm}, endAllowanceMm}` | `dims[dim] >= Σ widths[slot] + endAllowanceMm` |
| `dimMax` / `dimMin` | `{dim, mm, when}` | conditional absolute bound |
| `forbid` | `{when, forbid}` | if every `when` matches, none of `forbid` may match |
| `require` | `{when, require}` | if every `when` matches, every `require` must match |
| `maxCount` | `{key, max, when}` | conditional cap on a count/slots length |

`when`/`forbid`/`require` are `{ key: value }` maps (equality; for `slots`/`addons` a value `{ includes: 'v' }` or `{ count: {gte|lte: n} }`).

**Mapping rule (hard):** every one of the 165 product ids appears in exactly one family's `skus` map OR in `PRODUCT_FAMILIES.fixedSkus` (array of ids with no configurator). A test enumerates the private master (when available) and the public island and fails on any id missing from both or present in both.

---

## 3. Families — the proposal (grounded in the master; status per family)

Legend: **approved** = owner named it (build in Phase A) · *proposed* = my proposal (schema-only until approved; SKUs stay fixed) · *(fixed-SKU)* = no configurator, listed for completeness.
Option defaults shown are the SKU-neutral family defaults; each SKU's own default config is in the mapping (§3.9).

### 3.1 `range` — Open-top ranges / stoves (cooking_line) — **approved** ("stoves")
- `positions` **slots**, `minSlots 1`, `maxSlots 6`, `slotOptions`: `wok` Wok burner · `hp_small` High-pressure, small · `hp_large` High-pressure, large · `lp_small` Low-pressure, small · `lp_large` Low-pressure, large · `soup` Soup / stock-pot burner. Default `['lp_small']`.
- `addons` **addons**: `griller` Lava-rock griller section · `griddle` Griddle plate section · `fryer` Fryer section · `oven` Oven under the range (SS/BI combo, thermostat). Default `[]`.
- `base` **enum**: `legs` Open legs · `bottomshelf` Bottom shelf · `cabinet` Enclosed cabinet base (talyase/kuba type) · `oven` Oven base. Default `legs`. Constraint: `addons includes oven` ⇔ `base = oven` (rule `require` both ways); `base = oven` ⇒ `D ≥ 700` and `H ≥ 850` (`dimMin when`).
- `grade` **enum** `public:false`: `std` Standard (1.1–1.2 mm top) · `inst` Institutional (1.4 mm top, 1.2 mm side, 2" posts). Default `std`.
- `waterCooledEdge` **boolean** (wok ranges), `showWhen positions includes wok`. Default `false`.
- dims: `W {min 500, max 3000, step 10}`, `D {min 600, max 1200}`, `H {min 450, max 950}`.
- constraint `dimMinSlots` on `W`: `slotWidthMm` **(P2, proposed)** `wok 450, hp_large 400, hp_small 300, lp_large 350, lp_small 300, soup 400`, add-on widths `griller 300, griddle 300, fryer 350, oven 0`, `endAllowanceMm 200`. Suggested default width = that sum (the builder pre-fills it; the user may widen).
- Pricing (§4.1): `positions` → `perSlot`; `addons` → `adder` per value; `base` → `adder` per value; `grade` → `multiplier` (institutional) OR `adder` — owner picks the mode in the sheet (default `adder`); `waterCooledEdge` → `adder`. Length beyond the matched SKU's default keeps using the SKU's `pricePerExtraMm`/`rateW100` (unchanged machinery).
- SKUs: CE-001 `[lp_small]` · CE-002 `[lp_small,lp_small]` · CE-003 `[lp_small×3]` · CE-004 `[hp_large×4]` · CE-005 `[hp_small×4]` (square) · CE-006 `[wok]` · CE-013 `[hp_large,hp_large,soup,soup]` base `cabinet` grade `inst` · CE-014 `[hp_small×4]` base `oven` addons `[oven]` · CE-015 `[hp_large,hp_large,lp_small,lp_small]` addons `[griller,griddle]` base `cabinet` grade `inst` · CE-017 `[hp_large×4]` grade `inst` (unpriced) · CE-018 `[soup]` grade `inst` (unpriced) · CE-025 `[wok,wok]` waterCooledEdge `true` (unpriced) · CE-027 `[lp_small×3]` base `bottomshelf` (unpriced) · CE-029 `[lp_small,lp_small,hp_large,hp_large]`.
  `matchKeys: ['positions','addons','base']`, `primarySku: 'CE-003'`.

### 3.2 `griller_griddle` — Grillers, griddles and combis (cooking_line) — *proposed*
- `sections` **slots** `1..3`, options `griller` Lava-rock griller · `griddle` Griddle plate · `burner_lp` Open LP burner · `burner_hp` Open HP burner. Default `['griddle']`.
- `plate` **enum** (griddle plate): `semi_nonstick` · `ms_plate` 1/4" MS plate · `ss_plate`. Default `semi_nonstick`. `showWhen sections includes griddle`.
- `base` **enum**: `stand` Stand · `bottomshelf` · `cabinet`. Default `stand`.
- `grade` as 3.1 (`public:false`).
- dims `W {500..2500}`, `D {600..900}`, `H {700..950}`; `dimMinSlots` widths `griller 300, griddle 300, burner_lp 300, burner_hp 300`, `endAllowanceMm 100`.
- Pricing: `sections` perSlot; `plate` adder; `base` adder; `grade` adder.
- SKUs: CE-007 `[griller,griddle]` · CE-008 `[griller,griddle,burner_lp,burner_lp]` (maxSlots → 4 for this family) · CE-010 `[griddle]` · CE-019 `[griller]` grade inst (unpriced) · CE-021 `[griddle]` plate `ms_plate` grade inst (unpriced) · CE-023 `[griddle]` (3-burner griddle — add `burners` **count** 1..3 default 1, pricing adderPerUnit) · CE-026 `[griller]` base bottomshelf (unpriced) · CE-028 `[griddle]` base bottomshelf (unpriced).

### 3.3 `fryer` — Fryers (cooking_line) — *proposed*
- `tanks` **count** 1..2 default 1 · `baskets` **count** 1..3 default 1 · `valve` **enum** `ball` Ball valve · `kitz` Kitz valve default `ball` · `grade` (`public:false`).
- dims `W {400..1200}`, `D {600..900}`, `H {750..950}`. Constraint `dimMinPerCount W per tank 350`.
- Pricing: `tanks` adderPerUnit, `baskets` adderPerUnit, `valve` adder, `grade` adder.
- SKUs: CE-009 tanks 2 baskets 2 · CE-020 tanks 1 grade inst (unpriced) · CE-022 tanks 1 baskets 3 (no dims in master → dims optional).

### 3.4 Cooking-line *(fixed-SKU)*: CE-011 rice steamer, CE-012/CE-016 deck ovens (keep as two SKUs; a `deckOven` family `trays 6|12`, `decks 1|2|3` is *proposed* for later), CE-024 display warmer (keeps its `Layout` spec), CE-030 salamander, CE-031 electric heater.

### 3.5 `prep_table` — Preparation / work tables (prep_washing + baking) — **approved**
- `layers` **enum** `1` · `2` · `3` default `1` (owner's "layers: 1/2/3" = top + undershelves; `2` = top + 1 undershelf, `3` = top + 2).
- `upperShelves` **count** 0..2 default 0 (owner's "upper shelves: 1/2").
- `backsplash` **enum** `none` · `100` 100 mm · `150` 150 mm default `none`.
- `casters` **boolean** default `false` (movable).
- `drawers` **count** 0..3 default 0.
- `serviceSink` **boolean** default `false` (small integrated sink, PW-028 pattern). `require` `faucet` only via the sink family — here it is a boolean with its own adder.
- `topGauge` **enum** `public:false`: `std` 1.2 mm · `hd` 1.5 mm heavy-duty default `std`.
- `mount` **enum**: `floor` Floor-standing · `wall_bracket` Wall-bracket (no legs) default `floor`. `forbid when mount=wall_bracket: casters true, drawers>0, layers≠1`.
- dims `W {500..7000, step 10}`, `D {300..1000}`, `H {600..950}`. Constraint: `upperShelves > 0 ⇒ H ≥ 850`.
- Pricing: `layers` → `perW100` per value (an extra shelf scales with length — the owner may choose `adder` instead in the sheet); `upperShelves` perW100PerUnit; `backsplash` perW100 per value; `casters` adder; `drawers` adderPerUnit; `serviceSink` adder; `topGauge` multiplier or adder (owner picks); `mount` adder.
- SKUs: PW-001 layers 1 · PW-002 layers 2 casters true · PW-003 layers 3 · PW-011 layers 1 (rice-cooker table, low) · PW-017 layers 1 (frame only — `topGauge` n/a; keep as SKU with `frameOnly` boolean `public:false`) · PW-019 layers 3 backsplash 100 · PW-020 layers 1 · PW-021 layers 1 mount wall_bracket · PW-026 layers 2 upperShelves 2 (unpriced) · PW-028 layers 2 serviceSink true (unpriced) · PW-029 layers 2 (unpriced) · PW-032 layers 2 (unpriced) · PW-039 layers 1 (pass-thru counter) · PW-042 layers 1 (cashier) · PW-050 layers 1 · BA-001 layers 1 topGauge std (its `Undershelf` spec maps to `layers`, `Top Gauge` to `topGauge`) · BA-002 layers 2 backsplash 100 (`Drawers` spec → `drawers`) · BA-009 layers 1 + `mixerCutout` boolean (family-specific extra group, baking only, `showWhen category=baking` is NOT a thing — add the group with `default false`; it just stays false for others) · BA-010 layers 2 upperShelves 0/1 (`Overshelf` → `upperShelves`), `crumbTray` boolean.
  `matchKeys: ['layers','casters','mount']`, `primarySku: 'PW-001'`.

### 3.6 `sink` — Sinks and sink tables (prep_washing + baking) — **approved** (schema in §2.2)
- SKUs: PW-004 basins 1 faucet gooseneck (its two specs map to `basinDepth`, `faucet`) · PW-005 basins 1 drainboards 1 · PW-006 basins 2 faucet prerinse · PW-007 basins 2 faucet prerinse basinDepth 350 · PW-008 basins 3 · PW-009 basins 2 bottom slotted · PW-018 basins 3 bottom cabinet · PW-022 basins 1 bottom cabinet · PW-025 basins 3 bottom cabinet (unpriced) · PW-036 basins 1 · PW-037 basins 2 bottom slotted · PW-051 basins 1 (its `Basin Type` spec → `basins` 1/2) · BA-012 basins 2 basinDepth 350 drainboards 1 (`Drainboards`, `Faucet` specs map directly).
  `matchKeys: ['basins','faucet','bottom']`, `primarySku: 'PW-004'`.

### 3.7 `cabinet` — Cabinets (prep_washing) — **approved**, owner left the options to us *(proposed options)*
- `mount` **enum**: `floor` Floor-standing · `countertop` Countertop · `hanging` Wall-hung · `l_type` L-shaped floor. Default `floor`.
- `doors` **enum**: `none` Open front · `single` Single door · `double` Double door · `butterfly` Butterfly (lift-up) · `sliding` Sliding. Default `single`.
- `doorCount` **count** 1..6 default 2, `showWhen doors neq none`.
- `shelves` **count** 0..4 default 1 (internal shelves).
- `drawers` **count** 0..4 default 0.
- `drainTube` **boolean** default `false` (wet storage).
- `openBays` **count** 0..3 default 0 (open sections without doors, PW-047 pattern).
- `enclosureOnly` **boolean** `public:false` default false (PW-016: enclosure over an existing cabinet).
- dims `W {450..4000}`, `D {300..1000}`, `H {300..2100}`. Constraints: `hanging ⇒ H ≤ 1000`; `drawers > 0 ⇒ mount ≠ hanging`; `doorCount ≤ floor(W / 400)` (`maxCount` with `perUnitMm`-style bound — implement as rule `countMaxPerDim {key:'doorCount', dim:'W', perUnitMm:400}`).
- Pricing: `mount` adder; `doors` adder per value; `doorCount` adderPerUnit; `shelves` perW100PerUnit; `drawers` adderPerUnit; `drainTube` adder; `openBays` adder per unit; `enclosureOnly` adder (negative allowed — the sheet accepts signed values).
- SKUs: PW-015 floor shelves 3 drainTube true · PW-016 enclosureOnly true · PW-031 floor drawers 2 · PW-038 floor shelves 3 drainTube true doorCount 2 · PW-041 l_type · PW-045 hanging butterfly · PW-046 hanging butterfly doorCount 4 · PW-047 countertop doors butterfly doorCount 1 + openBays 3 (mixed — mapped as closest; staff adjust) · PW-048 countertop (its `Configuration` spec → two configs; keep the spec as-is AND map default) · PW-014 UVC cabinet → *(fixed-SKU)*.
  `matchKeys: ['mount','doors']`, `primarySku: 'PW-015'`.

### 3.8 `wall_shelf` — Wall shelving (prep_washing) — **approved** *(proposed options)*
- `tiers` **count** 1..3 default 1 · `support` **enum** `bracket` Wall brackets · `post` Floor posts default `bracket` · `surface` **enum** `solid` · `slotted` default `solid` · `lip` **boolean** (back stopper/upstand) default `false`.
- dims `W {300..3500}`, `D {250..600}`, `H {25..1500}` (H = overall height incl. tiers; single-tier H ≈ sheet thickness — keep H optional: `optional: true` on the axis).
- Pricing: `tiers` perW100PerUnit; `support` adder; `surface` perW100; `lip` perW100.
- SKUs: PW-023 tiers 1 · PW-024 tiers 3 support post · PW-033 tiers 2 (unpriced). `matchKeys ['tiers','support']`, `primarySku 'PW-023'`.

### 3.9 `rack` — Racks and trolleys (prep_washing + baking) — **approved** *(proposed options)*
- `kind` **enum**: `dish` Open dish rack · `slotted` Slotted clean-dish rack · `tray` Tray-slide rack/trolley · `cooling` Cooling rack · `shelving` Shelving unit. Default `dish`.
- `tiers` **count** 2..20 default 4 (for `tray` kind = tray slots).
- `mobility` **enum** `feet` Adjustable feet · `casters` Casters · `casters_brake` Casters with brake. Default `feet`.
- `shelfType` **enum** `wire` · `perforated` · `solid` default `solid`, `showWhen kind in [cooling, shelving]`.
- `traySize` **enum** `600x400` · `450x650` default `600x400`, `showWhen kind = tray`.
- dims `W {400..2000}`, `D {400..1000}`, `H {800..2100}`. Constraint `tiers × 75 ≤ H − 150` for `tray` (rule `dimMinPerCount H per tier 75` + fixed allowance — implement `dimMinPerCount` with optional `plusMm`).
- Pricing: `kind` adder; `tiers` adderPerUnit; `mobility` adder; `shelfType` adder; `traySize` adder.
- SKUs: PW-010 dish tiers 4 casters · PW-027 cooling casters · PW-030 slotted · PW-034 tray tiers 20 casters · PW-035 dish tiers 5 · PW-049 shelving tiers 12 · BA-003 tray tiers 15 (`Tiers`, `Tray Size` specs map) · BA-004 cooling tiers 2 (`Shelf Type`, `Casters` specs map). `matchKeys ['kind','mobility']`, `primarySku 'PW-010'`.

### 3.10 `hood` — Range hoods (exhaust_system) — *proposed*
- `type` **enum** `wall` Wall-mounted canopy · `island` Island · `slim` Slim/low-profile default `wall` · `filters` **count** 1..12 (baffle filters; suggested = ceil(W/500), editable) · `lamps` **count** 0..6 · `greaseCup` **boolean** default true · `grade` (`public:false`) std/inst.
- dims `W {600..7000}`, `D {300..1300}`, `H {300..700}`. `dimMinPerCount W per filter 400`.
- Pricing: `type` adder; `filters` adderPerUnit; `lamps` adderPerUnit; `greaseCup` adder; `grade` adder. Length uses the matched SKU's `pricePerExtraMm` + `rateD100` as today.
- SKUs: EX-001 wall · EX-002 wall (5 m) · EX-003 wall grade inst · EX-018 island · EX-019 island · EX-020 slim · EX-021 wall (low profile). `matchKeys ['type','grade']`, `primarySku 'EX-001'`.

### 3.11 `blower` — Blowers (exhaust_system + fresh_air_system) — *proposed, likely fixed-SKU (supplier items)*
- `hp` **enum** `1` · `2` · `3` · `5` · `phase` **enum** `single` · `three` · `casing` **enum** `gi` · `ss` · `drive` **enum** `direct` · `belt` · `withSwitch` **boolean**. Pricing: all `adder`. SKUs: EX-005, EX-006, EX-016, EX-022, EX-014, FA-001, FA-002, FA-008. **Recommendation: keep fixed-SKU** (bought-in units; prices move with the supplier) unless the owner wants one line in the sheet.

### 3.12 `duct_run` — Ducting (exhaust + fresh air) — *proposed* (thin): EX-004 and FA-003 stay `per_length`/`per_run`; add `material` **enum** `gi` · `bi` · `ss` (adder per run) and `insulated` **boolean** (adder per run). SKUs EX-004 (gi), FA-003 (gi). EX-017 / FA-009 (full-spec systems) → *(fixed-SKU)*.

### 3.13 `gas_line` — LPG lines (gas_line) — *proposed*: `tanks` **count** 0..12 (50 kg cylinders in the cage) · `appliances` **count** 1..20 (connection points) · `runMetres` **count** 1..100 · `manifold` **boolean**. Pricing: `tanks` adderPerUnit, `appliances` adderPerUnit, `runMetres` adderPerUnit, `manifold` adder. SKUs: GL-001 tanks 4 manifold true · GL-002 (topping) appliances n · GL-003 appliances 2. **Phase C candidate** — keep fixed-SKU now.

### 3.14 `fire_suppression` — *proposed*: `agent` enum `wet_chemical` · `nozzles` count 1..12 · `tankGallons` enum `4` · `6` · `hoodIntegration` boolean · `bfpCert` boolean. SKUs FS-001..004. FS-005/006 fixed. **Phase C candidate.**

### 3.15 *(fixed-SKU, no configurator)*: all `refrigeration` (RF-001..006, supplier units — pass-through candidates), BA-005..008, BA-011 (keep their existing `specs[]` drop-downs — the legacy `specs`/`priceAdder` path stays fully supported), PW-012/013/014/040/043/044/052/053, EX-007..013, EX-015, EX-017, EX-023..027 (EX-026 keeps its `Size` spec), FA-004..007, FA-009, FA-010, GL-*, FS-*, MS-* (all 17).

### 3.16 Mapping table (the `skus` maps + `fixedSkus`, one place)

The implementer builds `PRODUCT_FAMILIES.families[*].skus` and `PRODUCT_FAMILIES.fixedSkus` exactly from §3.1–§3.15 (165 ids, no duplicates, no omissions — test). SKUs whose master `specs[]` map onto a family group (listed per family above) keep their `specs[]` in `products` untouched; **in family mode the group replaces the drop-down; in SKU mode (family unpublished) the drop-down works as today.** The existing `priceAdder[]` of such a spec is NOT reused for the family delta (the sheet has its own cell) — this avoids double-counting and keeps SKU-mode prices byte-identical.

---

## 4. Pricing

### 4.1 Pricing modes (per option group, chosen by the owner in the sheet; the schema lists the ALLOWED modes per group)

| mode | Cell(s) in the sheet | Contribution to the unit price |
|---|---|---|
| `adder` | one signed peso value per option value (`enum`/`boolean`) | `value[chosen] − value[skuDefault]` |
| `adderPerUnit` | one signed peso value per unit (`count`) | `value × (chosen − skuDefault)` |
| `perW100` | one signed peso value per option value, per 100 mm of W | `(value[chosen] − value[skuDefault]) × (W / 100)` |
| `perW100PerUnit` | one value per unit per 100 mm of W (`count`) | `value × (chosen − skuDefault) × (W / 100)` |
| `perSlot` | one signed value per slot option (`slots`) | `Σ value[slot]` over chosen − `Σ value[slot]` over skuDefault |
| `multiplier` | one factor per option value (e.g. `1.00` / `1.25`) | `(SKU price incl. dimension formula) × (factor[chosen] / factor[skuDefault] − 1)` — applied LAST, before rounding |

**Delta-from-the-SKU rule (what makes backward compatibility exact):** the price of a configured item is
```
unitPrice = round( skuListPrice(sku, dims, legacySpecIdx)                     // = priceCatalogItem today, byte-identical
                   + Σ_groups delta(group, config[key], skus[sku][key], W)        // 0 when config == the SKU's default config
                 ) × multiplierDelta … (see 4.2 step 6)
```
so a SKU at its default configuration prices EXACTLY as today regardless of what the sheet says (every delta is `chosen − skuDefault = 0`). The sheet values are therefore **"relative to the family's zero point"**, and the owner only needs internal consistency within a family, not against each SKU's historic price.

### 4.2 `resolveConfiguration` + `priceConfiguredItem` — ADDITIVE exports in `js/pricing-core.js`

```
resolveConfiguration(family, rawConfig) -> { config }           // fills defaults, forces hidden (showWhen) groups and public:false groups to default when opts.public
validateConfiguration(family, config, dims, LIMITS) -> { ok, errors:[{id,message}], suggestedW }
matchSku(family, config) -> { sku, exact:bool }                   // step 1 below
priceConfiguredItem(product, family, config, dims, pricing, constants, opts) -> { unitPrice, priced, sku, exact, deltas:[{key, mode, amount}], missingInputs:[key], warnings:[], sizeAdjusted }
```
Steps of `priceConfiguredItem`:
1. **Match the SKU.** `matchSku`: among `family.skus`, the SKUs whose default config equals `config` on every `matchKeys` key; if several, the one whose FULL default config has the most equal keys; tie → first in map order. None → `family.primarySku`, `exact:false`. (`product` passed in must be the matched SKU's product record — the caller resolves it from `byId`; the function asserts `product.id === sku`.)
2. **Dims.** `sel.dims` = the caller's dims limited to the SKU's `defaultDimensions` keys (a family axis the SKU has no default for is ignored for the SKU formula but still validated by the family rules). `legacySpecIdx` = the SKU's `specs[]` default indices (family mode never uses the drop-downs — §3.16).
3. **Base.** `base = priceCatalogItem(product, {dims, runs:null, specIdx: legacySpecIdx}, constants)` — the companion spec's function, unchanged.
4. **Deltas.** For each group with a pricing entry in `pricing.options[key]`: compute the delta per §4.1 using `pricing.options[key].values`. **Any needed cell that is `null`/absent ⇒ push `key` to `missingInputs`, skip the delta.** A group WITHOUT a pricing entry and WITH `config[key] !== skuDefault[key]` ⇒ also `missingInputs`.
5. `priced = base.priced && missingInputs.length === 0`. When `missingInputs.length > 0` the function still returns `unitPrice` of the base + the deltas it could compute (staff see it in the builder with a ⚠ naming the missing inputs); the PUBLIC estimate treats `priced:false` as "priced after review" (never a partial figure — companion spec §6.3).
6. `multiplier` groups: `factorDelta = Π (factor[chosen] / factor[skuDefault])`; `unitPrice = max(0, round((base.unitPrice + Σ additive deltas) × factorDelta))`.
7. `sizeAdjusted` from base; `warnings` = base warnings (+ `'Closest catalogue item used: ' + sku` when `!exact`).

Pure: no DOM, no Firebase, no clock. Same UMD/`module.exports` shape. **Nothing in `priceCatalogItem` changes.**

### 4.3 Where the values live — Firestore `product_pricing/{familyId}` (private)

```
product_pricing/sink = {
  familyId: 'sink', schemaVersion: 1,           // must equal PRODUCT_FAMILIES.version or the doc is ignored (treated unpublished)
  published: false,                            // the ONLY switch that enables family mode (builder + public)
  updatedAt, updatedBy, updatedByName,
  options: {
    basins:       { mode: 'adderPerUnit',   value: null },
    alignment:    { mode: 'adder',          values: { left: null, center: null, right: null } },
    undershelf:   { mode: 'perW100',        values: { 'false': null, 'true': null } },
    upperShelves: { mode: 'perW100PerUnit', value: null },
    faucet:       { mode: 'adder',          values: { none: null, gooseneck: null, prerinse: null } },
    basinDepth:   { mode: 'adder',          values: { '250': null, '300': null, '350': null } },
    drainboards:  { mode: 'adderPerUnit',   value: null },
    bottom:       { mode: 'adder',          values: { open: null, slotted: null, cabinet: null } }
  },
  notes: ''                                    // free text for Finance
}
```
- **Rules** (`firestore.rules`, insert after the `product_costs/{docId}` block): `match /product_pricing/{familyId} { allow read, write: if isAuth() && !isPartner() && (isSeniorAdmin() || canFinance()); }` — the `product_costs` tier. Partners and the public never read it; `qrEstimate` reads it with the Admin SDK (cached with the products, same 10-min TTL, keyed into the LRU key).
- Values are **signed integers in pesos** (or decimal factors for `multiplier`); `null` = not yet provided. `published` may only be flipped to `true` by the editor when every cell the schema needs is non-null (editor-side check; the function's `missingInputs` guards the rest).
- **Never shipped to the browser of a public visitor; never in the repo; never in the data island; never in a notification or receipt.** The builder receives it only in internal sessions (`!PARTNER_MODE`), exactly like `product_costs`.

### 4.4 Guarantees (each pinned by a test)
- G1 **Identity:** for every SKU in every family, `priceConfiguredItem(product, family, skus[sku], product.defaultDimensions, ANY pricing doc, constants).unitPrice === priceCatalogItem(product, {dims: defaultDimensions, specIdx: defaults}, constants).unitPrice`. Tested over synthetic fixtures AND, when `BARRO_PRODUCT_MASTER` points at the private master, over **all 165 real SKUs** (identity only — the test stores and prints NO prices; it skips with a notice when the env var is absent, e.g. in CI).
- G2 **No price from a blank cell:** a `null` cell ⇒ `missingInputs` contains the key and `priced === false`; the delta is never treated as 0.
- G3 **Unpublished = SKU mode:** `published !== true` or `schemaVersion` mismatch ⇒ callers must not call `priceConfiguredItem` (the builder hides the family groups; `qrEstimate` rejects `family`/`config` on the item with `invalid-argument`).
- G4 **Determinism:** same inputs ⇒ same output; `matchSku` tie-breaking is map order.

### 4.5 Mutation list for `tests/pricing-core.test.mjs` (each must fail ≥ 1 test in a scratch copy; record which)
flip `chosen − skuDefault` to `chosen` (breaks G1); treat `null` as 0 (breaks G2); apply `multiplier` before the additive deltas; use `D` instead of `W` in `perW100`; make `matchSku` ignore `matchKeys`; let a `showWhen`-hidden group keep a non-default value; let `validateConfiguration` pass `W < basins × 500`.

---

## 5. Owner pricing-input sheet (EMPTY — for the owner / Finance; one row per cell; "unit" says what the number means)

Fill in pesos (signed; negative allowed, e.g. an open-front cabinet cheaper than a doored one). A row left blank keeps that option **unpriced** (the family cannot be published). The sheet is reproduced as the Family-pricing editor (P4) and as `docs/PRICING-INPUT-SHEET.md` (generated from the schema by `node scripts/pricing-sheet.js`, so it can never drift from the code — the script is Phase A).

**Family `range` (stoves)** — zero point: `positions [lp_small]`, `addons []`, `base legs`, `grade std`, `waterCooledEdge false`

| Option | Mode | Cell | Unit | Value |
|---|---|---|---|---|
| positions | perSlot | wok | ₱ per position | |
| positions | perSlot | hp_small | ₱ per position | |
| positions | perSlot | hp_large | ₱ per position | |
| positions | perSlot | lp_small | ₱ per position | |
| positions | perSlot | lp_large | ₱ per position | |
| positions | perSlot | soup | ₱ per position | |
| addons | adder | griller | ₱ | |
| addons | adder | griddle | ₱ | |
| addons | adder | fryer | ₱ | |
| addons | adder | oven | ₱ | |
| base | adder | legs / bottomshelf / cabinet / oven | ₱ each (4 cells) | |
| grade | adder OR multiplier (tick one) | std / inst | ₱ each, or factor each | |
| waterCooledEdge | adder | false / true | ₱ each | |

**Family `griller_griddle`** — zero point `sections [griddle]`, `plate semi_nonstick`, `base stand`, `grade std`, `burners 1`

| Option | Mode | Cell | Unit | Value |
|---|---|---|---|---|
| sections | perSlot | griller / griddle / burner_lp / burner_hp | ₱ per section (4 cells) | |
| plate | adder | semi_nonstick / ms_plate / ss_plate | ₱ (3) | |
| base | adder | stand / bottomshelf / cabinet | ₱ (3) | |
| burners | adderPerUnit | per burner | ₱ | |
| grade | adder | std / inst | ₱ (2) | |

**Family `fryer`** — zero point `tanks 1`, `baskets 1`, `valve ball`, `grade std`

| Option | Mode | Cell | Unit | Value |
|---|---|---|---|---|
| tanks | adderPerUnit | per tank | ₱ | |
| baskets | adderPerUnit | per basket | ₱ | |
| valve | adder | ball / kitz | ₱ (2) | |
| grade | adder | std / inst | ₱ (2) | |

**Family `prep_table`** — zero point `layers 1`, `upperShelves 0`, `backsplash none`, `casters false`, `drawers 0`, `serviceSink false`, `topGauge std`, `mount floor`, `mixerCutout false`, `crumbTray false`, `frameOnly false`

| Option | Mode | Cell | Unit | Value |
|---|---|---|---|---|
| layers | perW100 (or adder — tick) | 1 / 2 / 3 | ₱ per 100 mm of length, each (3) | |
| upperShelves | perW100PerUnit | per shelf | ₱ per 100 mm per shelf | |
| backsplash | perW100 | none / 100 / 150 | ₱ per 100 mm (3) | |
| casters | adder | false / true | ₱ (2) | |
| drawers | adderPerUnit | per drawer | ₱ | |
| serviceSink | adder | false / true | ₱ (2) | |
| topGauge | multiplier OR adder | std / hd | factor or ₱ (2) | |
| mount | adder | floor / wall_bracket | ₱ (2) | |
| mixerCutout | adder | false / true | ₱ (2) | |
| crumbTray | adder | false / true | ₱ (2) | |
| frameOnly | adder | false / true | ₱ (2, signed) | |

**Family `sink`** — zero point `basins 1`, `alignment center`, `undershelf false`, `upperShelves 0`, `faucet gooseneck`, `basinDepth 300`, `drainboards 0`, `bottom open`

| Option | Mode | Cell | Unit | Value |
|---|---|---|---|---|
| basins | adderPerUnit | per basin | ₱ | |
| alignment | adder | left / center / right | ₱ (3) | |
| undershelf | perW100 | false / true | ₱ per 100 mm (2) | |
| upperShelves | perW100PerUnit | per shelf | ₱ per 100 mm per shelf | |
| faucet | adder | none / gooseneck / prerinse | ₱ (3) | |
| basinDepth | adder | 250 / 300 / 350 | ₱ (3) | |
| drainboards | adderPerUnit | per drainboard | ₱ | |
| bottom | adder | open / slotted / cabinet | ₱ (3) | |

**Family `cabinet`** — zero point `mount floor`, `doors single`, `doorCount 2`, `shelves 1`, `drawers 0`, `drainTube false`, `openBays 0`, `enclosureOnly false`

| Option | Mode | Cell | Unit | Value |
|---|---|---|---|---|
| mount | adder | floor / countertop / hanging / l_type | ₱ (4) | |
| doors | adder | none / single / double / butterfly / sliding | ₱ (5) | |
| doorCount | adderPerUnit | per door | ₱ | |
| shelves | perW100PerUnit | per shelf | ₱ per 100 mm per shelf | |
| drawers | adderPerUnit | per drawer | ₱ | |
| drainTube | adder | false / true | ₱ (2) | |
| openBays | adderPerUnit | per bay | ₱ (signed) | |
| enclosureOnly | adder | false / true | ₱ (2, signed) | |

**Family `wall_shelf`** — zero point `tiers 1`, `support bracket`, `surface solid`, `lip false`

| Option | Mode | Cell | Unit | Value |
|---|---|---|---|---|
| tiers | perW100PerUnit | per tier | ₱ per 100 mm per tier | |
| support | adder | bracket / post | ₱ (2) | |
| surface | perW100 | solid / slotted | ₱ per 100 mm (2) | |
| lip | perW100 | false / true | ₱ per 100 mm (2) | |

**Family `rack`** — zero point `kind dish`, `tiers 4`, `mobility feet`, `shelfType solid`, `traySize 600x400`

| Option | Mode | Cell | Unit | Value |
|---|---|---|---|---|
| kind | adder | dish / slotted / tray / cooling / shelving | ₱ (5) | |
| tiers | adderPerUnit | per tier | ₱ | |
| mobility | adder | feet / casters / casters_brake | ₱ (3) | |
| shelfType | adder | wire / perforated / solid | ₱ (3) | |
| traySize | adder | 600x400 / 450x650 | ₱ (2) | |

**Family `hood`** — zero point `type wall`, `filters 2`, `lamps 1`, `greaseCup true`, `grade std`

| Option | Mode | Cell | Unit | Value |
|---|---|---|---|---|
| type | adder | wall / island / slim | ₱ (3) | |
| filters | adderPerUnit | per baffle filter | ₱ | |
| lamps | adderPerUnit | per lamp | ₱ | |
| greaseCup | adder | false / true | ₱ (2) | |
| grade | adder | std / inst | ₱ (2) | |

Families `blower`, `duct_run`, `gas_line`, `fire_suppression`: sheets generated by the script once the owner approves them (P1); not reproduced here.

**Dimension-rate reminder (no new cells):** length/depth/height beyond a SKU's default keeps pricing through that SKU's existing `pricePerExtraMm` / `rateD100` / `rateH100`. The owner may want to REVIEW those existing per-mm rates per family (several SKUs carry `0`); that review is outside this sheet and happens in the Product Database page as today.

---

## 6. Rules diff (`firestore.rules`)

Insert after the `product_costs/{docId}` block (L1404–1407):
```
    // Product-family option pricing (specs/PRODUCT-CONFIGURATOR-SPEC.md §4.3) — the private pricing
    // table behind configurable products. Same tier as product_costs; never partner, never public.
    match /product_pricing/{familyId} {
      allow read, write: if isAuth() && !isPartner() && (isSeniorAdmin() || canFinance());
    }
```
`products` rules: unchanged (`family`/`config` are plain informational fields; the existing `isAdmin()` update gate covers them). No index. No storage change. **Deploy before Phase A code** (`release.sh rules`).

---

## 7. Quote Builder changes (`quote-builder-v2.html`) — under the tutorial contract

User-visible ⇒ **`TUTORIAL_VERSION` 42 → 43**, a `WHATS_NEW` entry, Help copy, a tour step. Exact list:

1. **Load:** `<script defer src="js/product-families.js"></script>` after `js/pricing-core.js`. In `loadDatabase()`'s `!PARTNER_MODE` branch add `product_pricing` to the SAME `Promise.all` as `product_costs` (`db.collection('product_pricing').get()` → `FAMILY_PRICING = { [familyId]: data }`, only docs with `published === true && schemaVersion === PRODUCT_FAMILIES.version`); partner sessions: `FAMILY_PRICING = {}` (family mode off — partners keep SKU mode; their quotes are unaffected).
2. **`selectProduct(id)`:** if the product's id is in a family whose pricing is loaded and published → `buildCalcPanel(p, { family, config: skus[id] })`; else today's path. Fixed no-spec products still add directly.
3. **`buildCalcPanel`** in family mode renders, above the dimension inputs: a "Configuration" block with one control per group (segmented buttons for `enum` ≤ 4 options else `<select>`; stepper for `count`; toggle for `boolean`; the **position tiles** row for `slots` with "+ position"/"− position" and a per-tile select; chips for `addons`), honouring `showWhen`, with the family's `dims` rules replacing the generic inputs (`min/max/step` attributes) and a "Suggested width: N mm — Use" link when `dimMinSlots` applies. Constraint violations show inline (`validateConfiguration().errors`) and disable "Add to quote" until resolved. A "Catalogue item: PW-006 (closest match)" line shows `matchSku` live so staff see which SKU's price is the base. `public:false` groups render with a small "internal" tag.
4. **`computePrice(p)`** (already delegating to `priceCatalogItem`, companion spec): in family mode delegate to `priceConfiguredItem(matchedProduct, family, config, dimsMm, FAMILY_PRICING[family.id], DB.constants)`; `calcPriceWarning` gains `missingInputs` ("Pricing input missing for: Faucet, Bottom — ask Finance to complete the family pricing") and the `!exact` note. `recomputePrice`'s hint shows "Catalogue PW-004 + N options".
5. **`addItemFromCalc`:** the item gains `family: id`, `config: {…}`, `familyVersion`, `matchedSku`; `specs` snapshot = one `{label, value}` per visible group (labels from the schema, values = option labels) so the printed quotation reads "Basins: 2 · Faucet: Pre-rinse spray · Bottom: Slotted"; `dims` string as today. `id` = the matched SKU (so every downstream consumer — costing, BOM, Inventory links, `applyComputedPricing`'s `itemCostBasis(item)` — keeps working on a real product id). `name` = the SKU name + " (configured)" when `!exact` or any delta ≠ 0.
6. **Edit a configured line:** the items table's existing per-line "⚙" (or the name cell click, whichever exists — grep `editItem`/`reopenCalc`) reopens the calc panel in family mode with the stored `config`/dims. If no per-line edit exists today, add a small "⚙ configure" link on family lines only (tutorial-worthy; include in the What's New bullet).
7. **Persistence:** `buildQuotePayload` strips nothing new (config carries no prices); `loadEditableState`/`normalizeLoadedItems` pass `family/config` through untouched; **old quotes without `family` reopen exactly as before** (test by reopening a filed quote fixture).
8. **Import format (`docs/QB-IMPORT-FORMAT.md` + `QB_IMPORT_SPEC_TEXT`):** optional `family` + `config` on an item → runs through `resolveConfiguration` + `validateConfiguration` + `matchSku`; invalid → import warning, item lands unconfigured. Keep the two texts in sync (the doc's own rule).
9. **Pricelist picker (📦):** family products show a "configurable" chip; tapping opens the calc panel in family mode.
10. **Partner mode:** no configuration controls (`applyPartnerMode` hides the block); BS/generic partners quote SKUs as today.
11. **Tutorial:** `WHATS_NEW` `{ver:43, date:'<ship date>', items:['Configurable products — sinks, tables, cabinets, shelves, racks and stoves now open a Configuration panel: pick basins, layers, burner positions, add-ons and sizes, and the price follows the option pricing Finance has set. The catalogue item used as the base is shown beside the price.', 'Lines you configured carry their options onto the quotation and can be re-opened with ⚙ configure.']}`; Help "How a quote gets made" bullet for configuration; `TOUR_STEPS` step targeting `#calcConfig` (`needsWorkspace` as the calc panel requires); re-verify every tour selector.
12. **Family-pricing editor** (P4) lives in the app (`js/screens/inventory.js`, Product Pricelist), NOT in the builder (the builder's product-edit form was removed by ruling 2026-09-01). Spec: a "Family pricing" chip → one card per family (status: unpublished / incomplete n cells / published), a generated form from the schema (mode select where the schema allows a choice, one input per cell, signed integers), Save (writes the §4.3 doc with `updatedAt/By`), Publish toggle (enabled only when complete), "Unpublish". Gated `isSeniorAdmin || canFinance` client-side (mirror of the rule). Every write `logAudit('update','product_pricing',familyId,{published})`.

---

## 8. Phasing — recommendation and justification

| Phase | Ships | Depends on | Independently shippable because |
|---|---|---|---|
| **0 — Public quote request in SKU mode** (companion spec, as written) | catalogue "Add to quote" with size/qty/legacy specs/note; server estimate on list prices; Sales › Quote requests | nothing from this spec | the public sheet reads `family`/`config` only when the island marks a product `configurable` — in Phase 0 it never does |
| **A — Configurator core + Quote Builder** | `product-families.js` (+mirror), `priceConfiguredItem` (+tests, G1–G4, mutations), `product_pricing` rules + editor, builder family mode (tutorial 43), `scripts/pricing-sheet.js` → `docs/PRICING-INPUT-SHEET.md` | owner approval of §3 (P1) and module widths (P2); rules deployed first | staff can configure and price in the builder as soon as a family is published; unpublished families and partner sessions are byte-identical to today; the public site is untouched |
| **B — Public sheet in family mode** | the island carries `family` + `defaultConfig` per SKU (price-free); the public "Add to quote" sheet renders the family groups (`public:true` only) with the family dims rules and constraints; `qrEstimate`/`qrSubmit` accept `{family, config}` per item and price via `priceConfiguredItem` using the Admin-read `product_pricing`; the internal screen and "Open in Quote Builder" carry `config` through | Phase A deployed AND at least one family `published` | a visitor only sees configuration on families the server reports published (the island is static, so the page asks `qrEstimate`'s response `familiesPublished: [ids]` — add that key in Phase B — or simpler: the page treats a family as configurable only after a successful estimate response lists it; until then SKU mode) |
| **C — Owner's "next"** (gas line, fire suppression, blowers, deck ovens…) | new families = new entries in the schema + their sheets; no code change beyond the schema file and tests | — | the schema is data; `PRODUCT_FAMILIES.version` bump + mirror |

**Why A before B:** (1) every family needs the owner's pesos before any configured figure can be shown anywhere — the builder is where Finance fills and **checks** the sheet against real quotations before the public sees a range; (2) B's public estimate is bounded by rate limits and the range anyway, but a wrong delta published to the public is a reputational problem, while in the builder it is caught by staff; (3) B needs Phase 0's plumbing (island, sheet, callables) and A's function — doing B first would mean a public configurator with no published pricing, i.e. nothing to show. **Why 0 before A:** it ships the owner's requested flow now, with zero dependency on pricing inputs that do not exist yet.

---

## 9. Tests

- `tests/pricing-core.test.mjs` (extend): `resolveConfiguration` defaults/`showWhen`/`public:false`; `validateConfiguration` every constraint rule type with synthetic families; `matchSku` exact/closest/tie order; `priceConfiguredItem` each pricing mode with synthetic values (never real pesos), G1 identity on synthetic SKUs, G2 null cell, G3 caller contract (documented; enforced in the builder/callable tests), multiplier ordering; the §4.5 mutation list; **real-master identity test** gated on `process.env.BARRO_PRODUCT_MASTER` (loads the file with `stripJsonComments` from `scripts/build-catalogue.js`, iterates every family's `skus`, asserts identity, prints only counts).
- `tests/product-families.test.mjs` (new): schema well-formedness (keys regex, unique keys, every `default` valid, every `showWhen`/constraint key exists, `matchKeys ⊆ group keys`, `primarySku ∈ skus`); **mapping completeness** against the island (`#qr-catalogue` ids from `index.html`/the catalogue page) and against the master when available: 165 ids, each in exactly one of `skus` ∪ `fixedSkus`; `JSON.stringify(PRODUCT_FAMILIES)` matches neither `MONEY_RE` nor `FORMULA_RE` nor `BRAND_RE`; mirror byte-equality with `functions/product-families.js`.
- `tests/catalogue-public.test.mjs` (extend, Phase B): island `family`/`defaultConfig` fields carry no price tokens; `defaultConfig` equals the schema's `skus[id]`.
- `tests/quote-request.test.mjs` (extend, Phase B): `normaliseItems` with `{family, config}` → rejects when unpublished (G3), validates via `validateConfiguration`, prices via `priceConfiguredItem`, `publicEstimate` still has exactly its key set (+ `familiesPublished`).
- Builder parity (manual, Phase A acceptance): for each approved family, the SKU at its default config shows the SAME calc-panel price as before the change (record ≥ 2 SKUs per family in the commit message); a reopened pre-feature filed quote renders identically.

---

## 10. File-by-file (Phase A unless marked)

| File | Change |
|---|---|
| `js/product-families.js` (new) + `functions/product-families.js` (cp) | §2–§3 schema + mapping |
| `js/pricing-core.js` + `functions/pricing-core.js` | ADDITIVE exports §4.2 (existing exports untouched) |
| `tests/pricing-core.test.mjs`, `tests/product-families.test.mjs` | §9 |
| `scripts/ci-invariants.sh` | CHECK 10 covers the third mirror pair; CHECK 9 scans `js/product-families.js` for price tokens |
| `scripts/pricing-sheet.js` (new) + `docs/PRICING-INPUT-SHEET.md` (generated) | §5 sheet from the schema; `node --check` clean; CommonJS |
| `firestore.rules` | §6 block |
| `quote-builder-v2.html` | §7 items 1–11 (tutorial 43) |
| `docs/QB-IMPORT-FORMAT.md` | §7.8 |
| `js/screens/inventory.js` | §7.12 Family-pricing editor (Product Pricelist chip) |
| `js/app.js` (`catalogDocFromJson`) + Product Database seed | write `family`/`config` on seed/import (informational) — optional, Phase A |
| `sw.js` | `'/js/product-families.js'` after `'/js/pricing-core.js'` (the builder is precached) |
| `js/config.js` | `PAGE_SCRIPTS` for the Inventory product-pricelist route and `dept:Sales`/`bk-quotations` gain `js/product-families.js` (the internal Quote-requests screen shows option labels) |
| Phase B: `scripts/build-catalogue.js`, `js/quote-request.js`, `css/quote-request.css`, `functions/qr-core.js`, `functions/index.js`, `js/screens/quote-requests.js` | per §8 row B; island gains `family`, `defaultConfig`; sheet renders groups; callables accept `{family, config}`; internal screen renders `config` as label/value rows; "Open in Quote Builder" passes `family/config` on each item |
| `STATUS.md` | entry + open rulings P1–P5 |

Deploy order per phase: rules → (functions, Phase B only: `qrEstimate`, `qrSubmit`, selective) → `release.sh push`. Phase A has no functions change (the mirror files ship but no export changes) — still redeploy `qrEstimate`/`qrSubmit` in Phase B so they carry the schema.

---

## 11. STATUS.md entry text (Phase A)

> **2026-xx-xx — Product-family configurators (Phase A, SHIPPED vX.Y.Z; spec `specs/PRODUCT-CONFIGURATOR-SPEC.md`).** "Upgrade our sales computation": catalogue SKUs now map onto **families** (range/stoves with per-position burners + griller/griddle/fryer/oven add-ons, prep tables, sinks, cabinets, wall shelves, racks; griller-griddle, fryer, hood proposed) defined in `js/product-families.js` (mirror `functions/product-families.js`, CHECK 10). A configured item prices as **the matched SKU's unchanged list price + signed option deltas** from the private `product_pricing/{family}` table (finance/senior-admin tier, never public; `priceConfiguredItem` in `js/pricing-core.js`, pinned + mutation-tested; **identity test over all 165 SKUs proves unconfigured prices are byte-identical**). Blank cells never price (family stays unpublished → SKU mode). Quote Builder opens a Configuration panel for published families (tutorial v43); Inventory › Product Pricelist gains the **Family pricing** editor; `docs/PRICING-INPUT-SHEET.md` is generated from the schema. **Owner inputs pending:** P1 family approval, P2 module widths, the sheet itself (P3). Phase B (public "Add to quote" in family mode) follows once a family is published.

---

## 12. Out of scope

Costing/BOM per option (the true-cost engine keeps pricing from `product_costs` on the matched SKU; option-level BOM is a later costing phase); changing any existing SKU price or per-mm rate; partner-mode configuration; a public configurator before a family is published; inventing any peso value.
