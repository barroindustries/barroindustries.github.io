# CONFIGURATOR-FAMILIES-2-SPEC — five new product configurators (hood · griddle/griller/fryer · wok range · gas deck oven · dish table)

Status: SPEC (read-only planning, 2026-10-28). Builds ON TOP of Package A ([QUOTE-BUILDER-CONFIGURATOR-SPEC.md](QUOTE-BUILDER-CONFIGURATOR-SPEC.md), incl. §14 standard construction) — everything here assumes Package A and §14 are in the tree (they are, uncommitted, 2026-10-28). Implementers: Sonnet subagents, one per workstream (§12). Escalate any ambiguity; do not invent. Every line number is a locator verified 2026-10-28, not a contract — re-grep before editing.

Governing rules (CLAUDE.md + owner): no bundler, `window.*` globals; **the repo is PUBLIC — no price, cost, adder or rate figure in any committed file** (this spec names SKUs, dimensions and sheet CELLS only; the amounts live in gitignored `products-database.json` / `private/`); Brilliant Steel / Vesta / Barro Steel never named publicly; **no steel-grade or finish OPTION in any configurator** (standard-construction TEXT is fine); product notes always shown whole; "Barro Kitchens" naming; `js/money-core.js` frozen; `js/pricing-core.js` is **not edited by this spec** (§5.3) — if an implementer believes it must be, stop and escalate; money paths need mutation-tested tests; rules land before code; mirrored files are byte-identical (CHECK 10); every user-visible builder change bumps `TUTORIAL_VERSION` with a `WHATS_NEW` entry; NEVER `git stash` / `reset --hard` / `checkout --` / `clean` (other agents edit this tree live; a partner-removal agent is editing `firestore.rules`, `functions/`, `js/app.js`, `js/config.js`, `js/departments.js`, screens — see §12 for how WS-2 touches the rules file).

---

## 1. Summary

Five configurable families join the six of Package A, through the SAME data file, logic, pricing math, sheets, screens and surfaces — no new mechanism except two small, generic additions to the family schema (§4): a group that applies only for some values of an earlier choice (`when`), and an upper size limit forced by an option (`maxDimWhen`). Adding a family is still "edit `scripts/public-families.json`, run `node scripts/build-catalogue.js`", plus the per-family evidence block in the derive script, a product page, a preview drawing and the test pins.

| id | label (client-facing) | category | primary SKU | size basis | staff `top` group |
|---|---|---|---|---|---|
| `dish_table` | Dish table | washing | PW-029 | linear (PW-029 is `fixed`) | **yes** |
| `wok_range` | Wok range | cooking | CE-006 | primary (per_length) | **yes** |
| `cooking_line` | Griddle, griller or fryer | cooking | CE-010 | primary (per_length) | no |
| `deck_oven` | Gas deck oven | cooking | CE-012 | linear (CE-012 is `fixed`) | no |
| `hood` | Range hood | **ventilation** (new category, owner Q1; else cooking) | EX-001 | primary (per_length) | no |

User stories. **Website visitor:** "I pick a wall hood 2400 × 900 with baffle filters and lights, see an estimate range, and send the request." **Sales staff:** "The RFQ opens in the builder as a configured hood at the website price; I change it to island and the price follows the approved sheet; an unapproved cell asks me for a price instead of guessing." **Finance / President:** "Each new family has its own sheet under Inventory › Family pricing, seeded from the master where the master really says something, blank where it does not; nothing reaches the public estimate until I approve the family at schema 3."

Out of scope: salamander oven (CE-030 stays a fixed item), exhaust ducting / blowers / installation (stay unpublished), preview photos (placeholders as today), per-option cost cells.

---

## 2. Verified facts (2026-10-28) the design rests on

- `scripts/public-families.json` is at **version 2**; no family sheet is approved yet (STATUS pending op), so a bump to **3** costs nothing live. `fpPlanImport` refuses a seed of another schema; `fpStatus` marks older approvals "Out of date — approve again".
- `checkFamily` (build-catalogue.js ~638) requires: `category` ∈ `PUBLIC_CATEGORIES`; `dims` with at least `W`; min ≤ default ≤ max on the step; the primary's configuration == the family defaults; absorbed configs state every PUBLIC group and never a staffOnly one; `loadPublicFamilies({published, master})` requires every published SKU to be absorbed or `fixed`, a `per_length` primary ⇒ `sizeBasis:'primary'`, any other ⇒ `'linear'`.
- `PUBLIC_CATEGORIES` is frozen to five (owner ruling 2026-10-21) and pinned by `tests/catalogue-public.test.mjs` 322/955/973 and `tests/site-public-surface.test.mjs` 518; `TILE_ICONS` keys must equal the category ids (`tests/catalogue-layout.test.mjs` 147). `EXCLUDED_CATEGORIES` (`exhaust_system`, `fresh_air_system`, `gas_line`, `fire_suppression`) skips the whole master category BEFORE `excludedProducts` is consulted (renderCatalogue ~1150); the master has **27** `exhaust_system` SKUs, 7 of which are hoods; `tests/quote-request.test.mjs` 323 pins 46 products in excluded categories and 244 pins 26 quotable fixed ids.
- `priceConfiguredItem` (`js/pricing-core.js` 352–448, mirrored to `functions/`): a `choice` value equal to the group default adds nothing; a blank cell is `missing_input`; a `linear` family prices length through `size.perW100` and leaves any OTHER axis ≠ default for review; a `primary` family leaves a custom axis the primary has no rate for (`missingRateLabels`) for review. **EX-001, CE-006, CE-010 have `rateW100` and `rateD100` but NO `rateH100`** → height must not be a dimension of those families (§4.4).
- Master facts (names/dims only): EX-001 per_length W1000 D900 H500 (baffle filter, lamp, switch); EX-002 per_length W5000; EX-003 per_length W5000 D1200 H600 (institutional); EX-018 fixed W1219 D1092 H508 (island); EX-019 fixed W4191 D762 (island large); EX-020 fixed W1800 D305 H355 (slim); EX-021 fixed W5480 D660 H508 (wall, long, low profile); EX-026 baffle filter (accessory, has a size spec); EX-027 3-bulb case (accessory). CE-010 per_length W700 D700 H850 (griddle with stand); CE-007 per_length W900 (combi griller-griddle); CE-009 per_length W700 (double fryer); CE-019/020/021 fixed W610 D711 H851 institutional griller / fryer (ball valve) / griddle (MS plate) — **unpriced**; CE-022 fixed, null dims (3-basket fryer); CE-023 fixed W610 D1219 H762 (3-burner griddle); CE-026 fixed W800 D600 H800 (lava-rock griller with bottom shelf, unpriced); CE-028 fixed W600 D600 H800 (griddle with bottom shelf, unpriced). CE-006 per_length W600 D700 H850 (1 HP wok burner, wok base); CE-025 fixed W1500 D800 H800 (Chinese wok range, recessed ring, water-cooled front edge, **unpriced**). CE-012 fixed W700 D700 H1400 (2-deck, 6 trays); CE-016 fixed, null dims (2-deck, 12 trays; note names SS202 inner, BI parts); BA-005 per_length W1300 (heavy-duty deck-oven stand, excluded from the catalogue, "Proofer Slots" spec). PW-029 fixed W1219 D660 H851 (dish table with bottom shelf) — **unpriced** and currently in `excludedProducts`; PW-030 (slotted clean dish rack) is absorbed by `rack`; PW-006 (double sink with pre-rinse) by `sink`.
- CE-006 and CE-025 are today absorbed by `stove` (`positions:['wok']` / `['wok','wok']`); CE-008 and CE-015 (griller + griddle + burners) too. `tests/product-families.test.mjs` 131 pins absorbed counts `[9,10,15,4,3,3]`; 524 pins preview-key counts; `tests/derive-family-pricing.test.mjs` ~268 uses CE-006 as evidence for the stove's `wok` position cell (the script reads the master `byId`, not the absorbed map — unaffected).
- Both configurator UIs are data-driven: `js/quote-request.js` 1181 walks `PF.publicGroups(fam)`; the builder's `cfgRenderBody` (quote-builder-v2.html ~4350) walks `fam.groups`; both call `PF.minWidth` / `PF.forcedMins` for the length hint and the forced minimums. `js/qr-preview.js` 182 `DRAW = {prep_table, sink, stove, cabinet, wall_shelf, rack}` — `placeholder()` has NO fallback for an unknown family id (line 217).
- The product pages are hand-written (~1270 lines each, `products/<slug>/index.html`, inline `<style id="page-css">` generated by `scripts/inline-page-css.js`); `FAMILY_PAGES` (build-catalogue.js 1035) gives each family its "Learn more" link; `tests/seo-products.test.mjs` 50–63 maps slug → family and 848 asserts the page set == `FAMS.order`; the hub says "six" (products/index.html 992, 1016, 1160/197) and llms.txt 27 says "six"; `scripts/downloads/catalogue.js` 311/333 says "Six"; `tests/content-assets.test.mjs` pins PDF page counts.
- `firestore.rules` 1404–1418: `product_pricing/{familyId}` create requires `familyId in ['prep_table','sink','stove','cabinet','wall_shelf','rack']`.
- `functions/qr-core.js` 42 requires `./qr-families`; `qrEstimate` and `qrSubmit` are the only callables that touch families (`respondToQuote` does not).
- Builder: `TUTORIAL_VERSION = 44` (quote-builder-v2.html 9200), `WHATS_NEW[0].ver === 44`.

---

## 3. The five families — definitions (what goes into `scripts/public-families.json`)

Conventions: `v` is stored; `l` shown; `s` summary phrase; `c` construction phrase (only for groups named by a `{token}`); `hint` plain, non-salesy, no price words. All sizes in mm, step 10 unless stated. Every family's primary configuration equals its defaults (the zero point). Absorbed configs state every public group (a `when`-gated group at its default when it does not apply). Family `order` becomes:

```
["prep_table", "sink", "dish_table", "stove", "wok_range", "cooking_line", "deck_oven", "hood", "cabinet", "wall_shelf", "rack"]
```
(grouped by category: Preparation · Washing · Cooking · Ventilation · Storage; owner Q8 may reorder.) `version`: **3**.

### 3.1 `dish_table` — Dish table (washing; primary PW-029; `sizeBasis:'linear'`)

- `description`: "Stainless steel dish table for the dishwasher. Choose the clean or the soiled side, which hand it sits on, a pre-rinse sink and an undershelf, then set your own size."
- `construction`: `SS304 stainless steel · {top} · 1.2 mm undershelf and splash · {side} · square-tube posts with adjustable bullet feet`
- groups (in order):
  1. `side` — "Side" — choice, default `clean`: `clean` l "Clean (landing)" s "clean side" c "raised back and side splash, clean-dish landing"; `soiled` l "Soiled (loading)" s "soiled side" c "raised splash, sloped to the dishwasher, soiled-dish loading".
  2. `hand` — "Dishwasher on the" — choice, default `left`: `left` l "Left" s "dishwasher on the left" hint "Facing the table"; `right` l "Right" s "dishwasher on the right" hint "Facing the table".
  3. `sink` — "Pre-rinse sink" — choice, default `none`, **`when: { "side": ["soiled"] }`**: `none` l "None" s "no sink"; `prerinse` l "With pre-rinse sink and spray faucet" s "pre-rinse sink".
  4. `undershelf` — "Undershelf" — choice, default `true`: `true` l "With" s "with undershelf"; `false` l "Without" s "without undershelf".
  5. `top` — the staff-only Top plate group, byte-identical to the sink's (§14.1c of Package A).
- `dims`: `W` "Length" 600–3000 default 1200; `D` "Width" 600–900 default 660. (No height: standard 850 mm working height, said in the product page and the card lead; PW-029's 851 is kept by `migrateAbsorbed` rounding.)
- `minDimWhen`: `[{ group:'sink', includes:'prerinse', min:{ W:1200 } }]`.
- `preview`: tokens `{ side:{from:'side'} }`, chain `["dish_table-{side}"]` (2 keys).
- `absorbed`: `PW-029: { side:'clean', hand:'left', sink:'none', undershelf:true }`.
- Catalogue: PW-029 moves from `excludedProducts` to `products: "washing"` in `scripts/public-categories.json`.
- Hint texts: side clean "Where washed dishes land"; soiled "Where dirty dishes are loaded". Validation: a `sink` other than `none` on the clean side is refused (`when`); pre-rinse sink forces length ≥ 1200.

### 3.2 `wok_range` — Wok range (cooking; primary CE-006; `sizeBasis:'primary'`)

- `description`: "Gas wok range with high-pressure burners. Choose one to three wok holes, a rear stock burner and a swan-neck water faucet, then set your own size."
- `construction`: `SS304 stainless steel · {top} · 1.2 mm body and panels · recessed wok rings with high-pressure burners · square-tube posts with adjustable bullet feet`
- groups:
  1. `holes` — "Wok holes" — choice, default `1`: `1` l "1" s "1 wok hole"; `2` l "2" s "2 wok holes"; `3` l "3" s "3 wok holes".
  2. `rear` — "Rear stock burner" — choice, default `false`: `false` l "None" s "no rear burner"; `true` l "With" s "with rear stock burner" hint "A low burner at the back for stock pots".
  3. `faucet` — "Water faucet" — choice, default `none`: `none` l "None" s "no faucet"; `swan` l "Swan-neck faucet" s "swan-neck faucet" hint "Over the range, for topping up and rinsing".
  4. `top` — staff-only Top plate group (same as the stove's).
- `dims`: `W` "Length" 600–2400 default 600; `D` "Width" 650–1000 default 700. (No height: standard 850.)
- `widthRule`: `{ hard:true, allowance:0, noun:'wok holes', terms:[{ group:'holes', perUnit:600 }] }` → 600 / 1200 / 1800.
- `minDimWhen`: `[{ group:'rear', includes:true, min:{ D:800 } }]`.
- `preview`: tokens `{ holes:{from:'holes'} }`, chain `["wok_range-holes-{holes}"]` (3 keys).
- `absorbed`: `CE-006: { holes:1, rear:false, faucet:'none' }`; `CE-025: { holes:2, rear:true, faucet:'none' }` (owner Q4 confirms CE-025's layout). **Both are REMOVED from `stove.absorbed`** (a SKU may be absorbed by one family only); the stove keeps its `wok` burner-position option.

### 3.3 `cooking_line` — Griddle, griller or fryer (cooking; primary CE-010; `sizeBasis:'primary'`)

- `description`: "Gas griddle, lava-rock griller, fryer or a griller-and-griddle combination on its own stand. Choose the type, the burners or baskets and the base, then set your own size."
- `construction`: `SS304 stainless steel · 1.2 mm body and panels · {type} · {base}`
- groups:
  1. `type` — "Type" — choice, default `griddle`: `griddle` l "Griddle" s "griddle" c "semi-non-stick griddle plate, gas-fired"; `griller` l "Lava-rock griller" s "lava-rock griller" c "V-type grill plates over lava rock, gas-fired"; `fryer` l "Fryer" s "fryer" c "stainless fry tanks with baskets, gas-fired"; `combi` l "Griller + griddle" s "griller and griddle" c "lava-rock griller and griddle side by side, one burner under each, gas-fired".
  2. `burners` — "Burners" — choice, default `1`, **`when: { "type": ["griddle","griller"] }`**: `1`/`2`/`3` l "1"/"2"/"3" s "1 burner"/"2 burners"/"3 burners".
  3. `baskets` — "Fry baskets" — choice, default `2`, **`when: { "type": ["fryer"] }`**: `1` l "1" s "1 basket" hint "Single tank"; `2` l "2" s "2 baskets" hint "Two tanks"; `3` l "3" s "3 baskets" hint "Three tanks".
  4. `base` — "Base" — choice, default `stand`: `stand` l "Open stand" s "open stand" c "square-tube stand with adjustable bullet feet"; `shelf` l "Stand with bottom shelf" s "with bottom shelf" c "square-tube stand with a 1.2 mm bottom shelf and adjustable bullet feet".
- `dims`: `W` "Length" 500–2000 default 700; `D` "Width" 600–900 default 700. (No height: standard 850.)
- `minDimWhen`: `[{ group:'burners', includes:2, min:{ W:900 } }, { group:'burners', includes:3, min:{ W:1200 } }, { group:'baskets', includes:3, min:{ W:1000 } }, { group:'type', includes:'combi', min:{ W:900 } }]`.
- `preview`: tokens `{ type:{from:'type'} }`, chain `["cooking_line-{type}"]` (4 keys).
- `absorbed` (all move OUT of `fixed`): `CE-010 {type:'griddle', burners:1, baskets:2, base:'stand'}`; `CE-007 {type:'combi', burners:1, baskets:2, base:'stand'}`; `CE-009 {type:'fryer', burners:1, baskets:2, base:'stand'}`; `CE-019 {type:'griller', burners:1, baskets:2, base:'stand'}`; `CE-020 {type:'fryer', burners:1, baskets:1, base:'stand'}`; `CE-021 {type:'griddle', burners:1, baskets:2, base:'stand'}`; `CE-022 {type:'fryer', burners:1, baskets:3, base:'stand'}`; `CE-023 {type:'griddle', burners:3, baskets:2, base:'stand'}`; `CE-026 {type:'griller', burners:1, baskets:2, base:'shelf'}`; `CE-028 {type:'griddle', burners:1, baskets:2, base:'shelf'}`. (Inapplicable groups are stated at their default — the build requires every public group.) CE-008 and CE-015 stay with the stove.

### 3.4 `deck_oven` — Gas deck oven (cooking; primary CE-012; `sizeBasis:'linear'`)

- `description`: "Gas-fired deck oven. Choose one to three decks, three or six trays per deck and a heavy-duty stand."
- `construction`: `Insulated double-wall decks with a gas burner, gas valve and thermometer per deck · stainless steel outer body · {stand}` (no grade claim — CE-016's own note names other grades; owner Q5 may change the wording).
- groups:
  1. `decks` — "Decks" — choice, default `2`: `1`/`2`/`3` l "1"/"2"/"3" s "1 deck"/"2 decks"/"3 decks".
  2. `trays` — "Trays per deck" — choice, default `3`: `3` l "3" s "3 trays per deck" hint "Standard width"; `6` l "6" s "6 trays per deck" hint "Wide body".
  3. `stand` — "Stand" — choice, default `none`: `none` l "None" s "no stand" c "set on your own base"; `heavy` l "Heavy-duty stand" s "with heavy-duty stand" c "on a cross-braced box-tube stand".
- `dims`: `W` "Width" 700–1500 step 10 default 700 — the only axis. The width FOLLOWS the trays per deck, it is not a free choice: `minDimWhen: [{ group:'trays', includes:6, min:{ W:1200 } }]` and `maxDimWhen: [{ group:'trays', includes:3, max:{ W:700 } }, { group:'trays', includes:6, max:{ W:1200 } }]` lock it to 700 or 1200 (owner Q5 confirms 1200). Height and depth follow the decks and are not sizes.
- `preview`: tokens `{ decks:{from:'decks'} }`, chain `["deck_oven-decks-{decks}"]` (3 keys).
- `absorbed` (out of `fixed`): `CE-012 {decks:2, trays:3, stand:'none'}`; `CE-016 {decks:2, trays:6, stand:'none'}` (null dims → `migrateAbsorbed` takes the default 700, then the forced minimum raises it to 1200).
- Sheet: `size.perW100` must be **0** (the width is a consequence of the tray count whose cost sits in the `trays:6` cell) — the derive script writes it BLANK with that instruction (§7).

### 3.5 `hood` — Range hood (ventilation, owner Q1; primary EX-001; `sizeBasis:'primary'`)

- `description`: "Stainless steel kitchen exhaust hood. Choose a wall, island or slim canopy, baffle grease filters and lighting, then set your own length and depth."
- `construction`: `SS304 stainless steel · welded canopy with grease trough and oil cup · {type} · {filters}` (no gauge claim: the master's hood notes name several gauges; owner Q2 may add one).
- groups:
  1. `type` — "Type" — choice, default `wall`: `wall` l "Wall canopy" s "wall canopy" c "wall-mounted canopy" hint "Against a wall, over a cooking line"; `island` l "Island canopy" s "island canopy" c "island canopy, open on all four sides" hint "Over a free-standing cooking block"; `slim` l "Slim, low profile" s "slim low-profile canopy" c "slim low-profile canopy" hint "Shallow, for low ceilings or a counter line".
  2. `filters` — "Grease filters" — choice, default `baffle`: `baffle` l "Baffle filters" s "baffle filters" c "stainless baffle grease filters"; `none` l "None (open canopy)" s "open canopy" c "open canopy, no filters" hint "Where filters are fitted elsewhere in the duct".
  3. `lighting` — "Lighting" — choice, default `true`: `true` l "With lamp and switch" s "with lighting"; `false` l "Without" s "without lighting".
- `dims`: `W` "Length" 600–6000 default 1000; `D` "Depth" 300–1500 default 900. (No height: the canopy height follows the type — wall and island about 500 mm, slim about 350 mm — said in the hints and the product page.)
- `minDimWhen`: `[{ group:'type', includes:'island', min:{ W:1200, D:700 } }, { group:'type', includes:'wall', min:{ D:500 } }]`; `maxDimWhen`: `[{ group:'type', includes:'slim', max:{ D:500 } }]`.
- `preview`: tokens `{ type:{from:'type'} }`, chain `["hood-{type}"]` (3 keys).
- `absorbed`: `EX-001 {type:'wall', filters:'baffle', lighting:true}`; `EX-002` same; `EX-003` same (institutional, W5000 D1200); `EX-018 {type:'island', filters:'baffle', lighting:true}`; `EX-019` same; `EX-020 {type:'slim', filters:'baffle', lighting:true}`; `EX-021 {type:'wall', filters:'baffle', lighting:true}`.
- Publication plumbing (WS-1): `EXCLUDED_CATEGORIES` loses `exhaust_system`; `scripts/public-categories.json` maps the seven hoods to `"ventilation"` and lists the other **20** `exhaust_system` SKUs under `excludedProducts` (reason text, one per kind): EX-004/009/010/011/012/013/017/023/024/025 "exhaust ducting and fittings: a component of the exhaust system, sold through the exhaust service"; EX-005/006/014/016/022 "exhaust blower: a component of the exhaust system, sold through the exhaust service"; EX-007/008 "blower control switch: an electrical component, not equipment"; EX-015 "delivery, labour and installation: a service line, not equipment"; EX-026 "baffle filter block: a replacement part of a hood, chosen inside the hood configurator"; EX-027 "hood lighting case: a part of a hood, chosen inside the hood configurator". `PUBLIC_CATEGORIES` gains `{ id:'ventilation', label:'Ventilation' }` after `cooking`; `TILE_ICONS.ventilation` = a simple canopy/fan path (any 1–3 `<path>` stroke icon in the existing style). If the owner answers Q1 = B, skip all of this paragraph except the hood SKUs' `excludedProducts`/mapping: map the seven hoods to `"cooking"`, still un-exclude `exhaust_system` and still list the other 20.

---

## 4. Schema additions (generic; `scripts/public-families.json` → `scripts/build-catalogue.js` → `js/product-families.js` ⇄ `functions/product-families.js`)

### 4.1 `when` on a group — "this option applies only for some values of an earlier choice"

```json
{ "key": "baskets", "label": "Fry baskets", "type": "choice", "default": 2, "when": { "type": ["fryer"] }, "options": [...] }
```
- Build (`checkFamily`): `GROUP_KEYS` gains `'when'`. `when` is a plain object; every key names a `choice` group that appears EARLIER in `groups` (no forward reference, no self reference, so there are no cycles) and is not itself `staffOnly`; every value is a non-empty array of that group's option values. A group with `when` may be `choice` or `multi` (not `slots`, not `staffOnly`).
- `PF.groupApplies(family, g, config)` → `true` when `g.when` is absent, else when for EVERY key the config's value (or that group's default when absent) is in the listed values. `PF.activeGroups(family, config)` = groups where it holds; `PF.publicActiveGroups` = the public ones of those.
- `validateConfiguration` (both modes, after the group's own validation, groups processed in order so the gating group is already in `config`): when the group does NOT apply and the raw value is present and differs from the default (compare `JSON.stringify` of the validated value vs the default — arrays included) → error `'"' + g.label + '" applies only when ' + whenText + '.'` and `config[key] = default`. Absent or default → silently the default. So a stored config is canonical: an inapplicable group is always at its default and `priceConfiguredItem` adds nothing for it (choice at default = no cell; multi default `[]` = no cells). **This is why `js/pricing-core.js` needs no edit.**
- `PF.whenText(family, g)` → `'Type is Fryer'` / `'Type is Griddle or Lava-rock griller'` / several keys joined with `' and '` (labels, not values).
- `minWidth`: a term whose group does not apply is skipped. `forcedMins`/`forcedMaxes`: a rule whose group does not apply is skipped.
- `describe` and `summaryParts`: an inapplicable group contributes nothing (no row, no phrase). `constructionLine`: unchanged (a token always resolves; the five families never put a token on a gated group — build check: a `{token}` may not name a `when`-gated group).
- `cells(family)`: every option of every group still gets a cell (Finance prices "3 baskets" once; it is reachable only for a fryer); each cell gains `when: whenText || ''` for the sheet caption.
- Catalogue card row (`renderFamilyCard`): a gated group's row value = options joined + `' (' + whenText + ')'`, e.g. `Fry baskets — 1 / 2 / 3 (Type is Fryer)`. Row count stays `publicGroups(fam).length` (the seo/catalogue tests count rows).

### 4.2 `maxDimWhen` — an option forces an UPPER size limit

Same shape as `minDimWhen` with `max` instead of `min`: `[{ group, includes, max:{ W?, D?, H? } }]`. Build: validated like `minDimWhen` (own axes, inside the axis limits, on the step); additionally, for every pair of a `minDimWhen` and a `maxDimWhen` rule that can hold at once on the same axis, `min ≤ max` (checked by evaluating both for every option value of the group they name — the five families only use single-group rules; a cross-group pair is reported, not evaluated). `FAMILY_KEYS`/`FAMILY_PUBLIC_KEYS` gain `'maxDimWhen'` (after `minDimWhen`).
- `PF.forcedMaxes(family, config)` → `{ W?, D?, H? }` (smallest wins). `validateDims`: `'With these options the ' + label.toLowerCase() + ' must be at most ' + N + ' mm.'` is an error. `standardDims`: after raising to the minimums, lower any axis above its forced maximum. `migrateAbsorbed`: after the minimum raise, lower to the forced maximum.
- Website (`js/quote-request.js`): `applyUsualLength` also lowers an axis above its forced maximum (only when the field is not the one being typed into — mirror the existing forced-minimum behaviour, which raises at once); `refreshSize` hint gains `'… and the width at most N mm'`; the input's `max` attribute follows it. Builder (`cfgRefresh`): input `max`, hint, and `cfgSplitErrors` routes `'must be at most'` to the axis.

### 4.3 Nothing else changes in the schema. `GROUP_TYPES`, `OPTION_KEYS`, `widthRule`, `preview`, `specMap`, `staffOnly`, `construction` as today. `version` 2 → 3.

### 4.4 Heights are not sizes for the new families
EX-001 / CE-006 / CE-010 carry no `rateH100`, so a custom height would always be "priced after review"; the linear families (PW-029, CE-012) price length only. Each new family therefore defines `W` (+ `D` where the primary has `rateD100`: hood, wok, cooking line; dish table keeps `D` as a linear family and a width ≠ 660 is left for review by the existing rule). The standard height is stated in text (card lead / page / hints), never as a control. `PF.sizeTextLabelled` prints only the axes a family has (as wall shelving does today).

---

## 5. Pricing

### 5.1 Model (unchanged)
`priceConfiguredItem(primary, family, config, dims, sheet, constants, {schemaVersion: 3})` — base = the primary at the requested size through its own rules; + the signed cells of the chosen non-default options; a `linear` family adds `size.perW100 × (W − refW) / 100`. Blank cell ⇒ `missing_input` ⇒ "priced after review" on the website (estimate excludes the line; `reviewCount`), and the builder's manual-price flow (Package A §4.4).

### 5.2 Sheet schema per family — `product_pricing/{familyId}` (cells the owner fills; NO numbers here)
`{ familyId, schemaVersion: 3, approved, approvedBy, approvedByName, approvedAt, options: { <group>: { <valueKey>: { flat, perW100 } } }, size: { perW100 } }` — exactly what `PF.cells(family)` lists, baseline cells excluded:

| family | cells (group:value) | `size.perW100` |
|---|---|---|
| dish_table | side:soiled · hand:right · sink:prerinse · undershelf:false · top:1.2 | yes (linear) — **blank until PW-029 has a list price** |
| wok_range | holes:2 · holes:3 · rear:true · faucet:swan · top:1.2 | n/a (primary) |
| cooking_line | type:griller · type:fryer · type:combi · burners:2 · burners:3 · baskets:1 · baskets:3 · base:shelf | n/a |
| deck_oven | decks:1 · decks:3 · trays:6 · stand:heavy | **0** (the width follows the trays; see §3.4) |
| hood | type:island · type:slim · filters:none · lighting:false | n/a |

Sign convention as Package A §14.4: a cell is the SIGNED amount added for that value (negative allowed: `filters:none`, `lighting:false`, `undershelf:false`, `baskets:1`, `decks:1`, `top:1.2`).

### 5.3 `js/pricing-core.js` — NOT edited
`when` is enforced by validation (inapplicable ⇒ default ⇒ no cell), `maxDimWhen` by validation (a size above the limit never reaches pricing). `tests/pricing-core.test.mjs` keeps its one-line "export list unchanged" assertion. If any implementer finds a reason to touch `pricing-core.js`, stop and escalate — `money-core.js` is frozen outright.

### 5.4 Estimate range (website) — unchanged behaviour
`qrEstimate` prices configured lines through `computeBasket` → `rangeFor` (`ESTIMATE` v1: ×0.90 / ×1.15, rounded to the steps). A new family with an unapproved sheet, a blank cell, an unpriced primary (PW-029 today; CE-025 is not a primary) or a locked width ≠ default on a linear family with a blank `size.perW100` counts as `reviewCount` and the page shows "priced after review" for that line, as today. The soft/hard width wording is the existing one. No server number changes.

### 5.5 Builder cost basis — unchanged logic
`QBConfigured.costBasisFor` scales the nearest absorbed SKU's cost (Package A §4.5); the primary is always absorbed, so a basis always exists; an unpriced/uncosted SKU → `hasBasis:false`, exactly as for an uncosted catalogue line. `nearestAbsorbed` scoring is generic (`when`-gated groups at default on both sides match trivially).

---

## 6. Surfaces

### 6.1 Website — `/catalogue/` (generated) and the configurator sheet (`js/quote-request.js`)
- Cards: one featured "Configurable" card per family, first in its category; rows = public groups (gated rows carry the `(Type is Fryer)` suffix) → Size (the family's real axes: "Made to your length and depth") → Construction (at defaults) → Material (last, unchanged line) → "Learn more" (needs `FAMILY_PAGES`, §6.3). Search keywords carry the absorbed SKU names.
- Sheet: iterate `PF.publicGroups`, but render a gated group HIDDEN (`fieldset[hidden]`) when `!PF.groupApplies(fam, g, st.config)`; `changed()` runs `PF.validateConfiguration(fam, st.config).config` back into `st.config` so a hidden group snaps to its default, then `syncAll()` toggles `hidden`. Construction hint, size block, `Use N mm`, custom-size note, review and receipt (`lineSpecsText`) all work from the data. Forced maximum per §4.2. `famPublicConfig`/`sanitizeFamilyItem` (website draft) keep working (unknown/invalid → notice, as today).
- Preview: `js/qr-preview.js` `DRAW` gains `dish_table`, `wok_range`, `cooking_line`, `deck_oven`, `hood` — five simple navy line drawings in the existing style (a hood canopy with/without a filter row and a lamp; a box with a plate/grill/tanks by type; a range with 1–3 rings and an optional rear ring and faucet; a stacked box per deck, wider for six trays; a table with splash, optional sink bowl, undershelf) — plus `DRAW_DEFAULT` (a plain box with the family label) used when `DRAW[family.id]` is absent, so a future family never throws. `scripts/configurator-previews.json` unchanged (`images: {}`); `docs/configurator-preview-photo-list.md` gains five sections listing the 15 keys of §3 (the shot-list test parses that document).
- Copy: `js/quote-request.js` header comments / strings that say "six" → "eleven"; the catalogue intro (build-catalogue.js `renderCatalogue` lines) if it counts them; `products/index.html` 992/1016/1160 + JSON-LD 197; `llms.txt` 27 ("the eleven configurable stainless-steel products") plus five link lines (one per page, same shape as 28–33); `scripts/downloads/catalogue.js` 311/333 ("Eleven products…").

### 6.2 Website — hub, sitemap, llms, PDFs
- `products/index.html` gains five cards in `#products-list` (same markup as 1023–1066: `<h3><a href=…>`, one-line options sentence — the seo test's hub phrases are extended with: "wall, island or slim canopy", "baffle filters and lighting", "one to three wok holes", "a rear stock burner and a swan-neck faucet", "griddle, lava-rock griller, fryer or griller and griddle", "one to three burners or fry baskets", "one to three decks", "three or six trays per deck", "clean or soiled side", "a pre-rinse sink and an undershelf"), the "Six …" headings/CTA become "Eleven …", the FAQ answer (visible + JSON-LD, identical) says "Our eleven products let you set your own size (a deck oven: its width follows the trays per deck; a hood: length and depth)…" — keep the sentence short and true.
- `sitemap.xml`: five `<url>` entries (lastmod = ship date). `docs/seo-keyword-map.md`: five rows.
- PDFs: `node scripts/build-downloads.js` regenerates `downloads/src/*.html` + the 3 PDFs: the catalogue PDF's "at a glance" table and one family page per family (now 11) — update the `tests/content-assets.test.mjs` page-count pins to the new counts; the profile PDF's materials wording unchanged.

### 6.3 Website — five NEW product pages (`products/<slug>/index.html`)
Copy a sibling page (the sinks page for dish_table, the stoves page for the four cooking/ventilation ones) and rewrite title/description/canonical/OG/JSON-LD/H1/lead/"What you can choose" `<dl>` (one row per public group with the option words, Size with the real axes, Construction = `PF.constructionLine(fam, defaults) + '.'`, Material last)/FAQ/CTA (`/catalogue/#cat-<category>`), then run `node scripts/inline-page-css.js` and the seo test. Titles must not repeat an existing page's title/description/H1 (the test checks). Slugs and `FAMILY_PAGES` entries:

| family | path | `about` | title (≤ 60 chars) |
|---|---|---|---|
| dish_table | `/products/stainless-steel-dish-tables/` | stainless steel dish tables | Stainless Steel Dish Table Philippines — Built to Order |
| wok_range | `/products/commercial-wok-ranges/` | commercial wok ranges | Commercial Wok Range Philippines — 1 to 3 Wok Holes |
| cooking_line | `/products/commercial-griddles-grillers-and-fryers/` | commercial griddles, grillers and fryers | Commercial Griddle, Griller & Fryer Philippines |
| deck_oven | `/products/gas-deck-ovens/` | gas deck ovens | Gas Deck Oven Philippines — 1 to 3 Decks, Built to Order |
| hood | `/products/stainless-steel-range-hoods/` | stainless steel range hoods | Stainless Steel Range Hood Philippines — Wall, Island, Slim |

Each page's "Related" links: hood ↔ `/services/exhaust-and-fresh-air-systems/`; deck oven ↔ `/products/commercial-gas-stoves/`; dish table ↔ sinks and racks. Never a price, never a partner brand, "Barro Kitchens" naming, Messenger button as the siblings. (Owner Q7: pages in this release — default yes.)

### 6.4 Staff — Inventory › Family pricing (`js/screens/family-pricing.js`)
Data-driven from `QR_FAMILIES.order` → eleven cards automatically. Change: the cell row caption shows `cell.when` ("only when Type is Fryer") in the same muted style as the staff-only caption; `fpTry` keeps `{staff:true}`; the import plan (`fpPlanImport`) refuses seeds of schema ≠ 3 (existing). Rules (§8) must allow the five new doc ids.

### 6.5 Staff — Sales › Quote requests
Generic: configured lines print `PF.describe` (now without inapplicable rows). The "Base + options" build-up lists the deltas by cell key. Nothing to code except re-running its tests.

### 6.6 Builder — `quote-builder-v2.html` (Package A §4 panel)
- Configure chips: generated from `QR_FAMILIES.order` → eleven chips ("⚙ Dish table", "⚙ Wok range", "⚙ Griddle, griller or fryer", "⚙ Gas deck oven", "⚙ Range hood", …). On phones the chip row wraps (it already does; verify ≥ 44 px targets).
- `cfgRenderBody`: render only `fam.groups.filter(g => PF.groupApplies(fam, g, st.config))`; after any option change `cfgEvaluate` (which validates with `{staff:true}`) writes `v.config` back into `st.config` so a gated group that stopped applying returns to its default and disappears. Forced maximum per §4.2 (`cfgRefresh`, `cfgSplitErrors`).
- Product picker hint (`absorbedFamilyOf`): automatically covers the 20 newly absorbed SKUs ("Sold online as: Range hood (configurable) · configure instead").
- `migrateLegacyConfiguredLine` / "⚙ convert to configured": a saved CE-006 line now converts to a `wok_range` line, CE-010 to `cooking_line`, etc. (through `PF.migrateAbsorbed`, generic).
- Kill switches (§9).
- **Tutorial (`TUTORIAL_VERSION` 44 → 45)**: prepend `{ ver:45, date:'<ship date Manila>', items:[ 'Five more products can be configured right in the builder — dish tables, wok ranges, griddles / grillers / fryers, gas deck ovens and range hoods — with the same options and prices as the website; an option Finance has not priced yet asks you for a price instead of guessing.', 'Some choices only show when they apply (fry baskets for a fryer, a pre-rinse sink on the soiled side of a dish table); a size that an option does not allow is corrected as you type.' ] }`. Help "Configure a product": list the eleven product kinds in one sentence. `TOUR_STEPS`: no new step (the same `#configPanel` step; `tourOpenConfigurator` keeps opening the sink). Follow `.claude/skills/quote-builder-tutorial/SKILL.md` (re-verify selectors; run the demo).

### 6.7 Printed quote / client document
Unchanged rules (Package A §5 R7): name, `specs` rows (now with the Construction row and only the applicable options), `dims` (only the family's axes), qty, unit, price. Never the SKU, deltas, reasons.

---

## 7. Derive script — `scripts/derive-family-pricing.js` (per-family evidence blocks; the source holds no number)

`deriveFamily` gains five blocks, same helpers (`setCell`, `decide`, `pairCand`, `adderCand`, `blank`). Evidence (names only; the amounts come from the master at run time; anything not listed is BLANK with a why):

- **dish_table** — PW-029 is unpriced: every cell BLANK with the note "PW-029 (the dish table) has no list price in the master yet — enter one on the Product Database first, then the length rate can be derived"; `size.perW100` BLANK with the same note; `top:1.2` BLANK (Package A §14.4 wording, BA-001 cross-reference). `absorbedCheck` reports "cannot be checked".
- **wok_range** — `holes:2` / `holes:3` BLANK ("CE-025, the only multi-hole wok range, is unpriced; the stove's wok-position cell is for a burner on a mixed range, not a wok hole with its ring — not used"); `rear:true` BLANK (cross-reference: the stove sheet's `soup` cell if the master prices CE-018, quoted in the note only); `faucet:swan` BLANK (cross-reference: the sink's pre-rinse faucet adder is a different fitting — note only); `top:1.2` BLANK.
- **cooking_line** — `type:fryer`: pair CE-009 vs CE-010 at the same size (both per_length, same default size: medium) — note that it is the TWO-basket fryer, the family default, so the figure is the whole type delta; `type:combi`: pair CE-007 vs CE-010 (per_length both; CE-007's 900 mm evaluated at the larger length ⇒ `approx`); `type:griller`: BLANK (CE-019 and CE-026 unpriced); `burners:2` BLANK (no 2-burner SKU); `burners:3`: CE-023 vs CE-010 only if CE-023's default depth is inside the family limits (it is 1219 > 900 ⇒ `insideLimits` false ⇒ BLANK with the note naming it); `baskets:1` BLANK (CE-020 unpriced); `baskets:3`: CE-022 vs CE-009 — CE-022 has null dims ⇒ fixed pair at the fryer's size, `fixedPair` ⇒ low; `base:shelf` BLANK (CE-026/CE-028 unpriced).
- **deck_oven** — `trays:6`: pair CE-016 vs CE-012 (both fixed, CE-016 null dims ⇒ `fixedPair`, low; note "12 trays versus 6 trays, two decks each"); `decks:1` / `decks:3` BLANK ("no 1- or 3-deck SKU; a per-deck figure would be an extrapolation — if you agree it is proportional, half / one-and-a-half of the 2-deck price, quoted in the note only"); `stand:heavy` BLANK with BA-005's list price at its standard length quoted in the note as the stand sold on its own ("a different product line; enter the figure you want"); `size.perW100`: **BLANK, not the proportional default** — the `linear` branch is skipped for this family (`fam.id === 'deck_oven'` is NOT the test; add a family flag in the script's own table `NO_LENGTH_RATE = ['deck_oven']` with the note "Enter 0: the width is fixed by the trays per deck and its cost sits in the 'Trays per deck: 6' cell").
- **hood** — `type:island`: pair EX-018 vs EX-001 (EX-018 fixed ⇒ `fixedPair`, approx: evaluated at EX-018's size); `type:slim`: pair EX-020 vs EX-001 (fixed pair, far apart in depth ⇒ low); `filters:none` BLANK with EX-026's list price quoted ("a filter block sold alone; the canopy without filters is unlikely to drop by exactly that — enter a negative figure or 0"); `lighting:false` BLANK with EX-027 quoted the same way. Note for all: EX-002/EX-003 are the same wall type at other sizes (used by `absorbedCheck` only).

Seed: `schemaVersion: 3`; `families` has eleven entries. The derive test's "all six" pin → "all eleven" with the five new ids; add one `it` per new family (fixture SKUs per the test's existing `prod()` helper with ARBITRARY fixture prices as the existing tests do — fixtures are not master prices).

---

## 8. Rules, functions, deploy

### 8.1 `firestore.rules` (one hunk, line 1409)
```
-        && familyId in ['prep_table', 'sink', 'stove', 'cabinet', 'wall_shelf', 'rack']
+        && familyId in ['prep_table', 'sink', 'dish_table', 'stove', 'wok_range', 'cooking_line', 'deck_oven', 'hood', 'cabinet', 'wall_shelf', 'rack']
```
Nothing else (read tier, update guard, delete unchanged). CHECK 8 headroom unaffected. **The partner-removal agent is editing this file concurrently:** WS-2 makes this one-line edit with a targeted `Edit` on that exact line (no wholesale rewrite), re-reads the file first, and runs `bash scripts/ci-invariants.sh` after. Deploy: `bash scripts/release.sh rules` BEFORE the app commit that ships the families (the family-pricing screen's "Set up" would otherwise be refused for a new id).

### 8.2 Functions
`functions/qr-families.js` (generated) and `functions/product-families.js` (`cp`) change ⇒ redeploy `firebase deploy --only functions:qrEstimate,functions:qrSubmit` (no other callable loads them); `release.sh record functions`. Order relative to the page: either order is safe — old functions + new page: the new family ids are refused with the existing "no longer offered" message until the deploy lands (minutes); new functions + old page: nothing asks for them. Do it right after `release.sh push`.

### 8.3 Deploy sequence (after Package A §10 and §14.8 have shipped, or in the same release)
1. Owner answers §11 (Q1, Q5, Q6 at least). 2. `release.sh rules` (§8.1). 3. One app commit (hook bumps versions) with WS-1/3/4/5/6 → `release.sh push` → `verify`. 4. `firebase deploy --only functions:qrEstimate,functions:qrSubmit` → `release.sh record functions`. 5. President: price PW-029 on the Product Database (Q6); `node scripts/derive-family-pricing.js` → Inventory › Family pricing → Import → fill the cells (deck oven `size` = 0) → Approve the families he wants live (schema 3). Until approval every configured line of a new family is "priced after review" — that is the intended safe state. 6. Confirm the 3 PDFs open; smoke (§10.4).
Rollback: `git revert` + redeploy the two callables; the rules hunk is harmless if orphaned; a sheet doc for a reverted family is ignored (`buildPricingIndex` drops unknown ids).

---

## 9. Kill switches

- Existing (Package A §2.3): `productMeta/config.quoteBuilder.configurator === false` → the whole builder configurator off; no deploy.
- **New, per family, no deploy:** `productMeta/config.families.disabled: string[]` (family ids). Honoured by: (a) `functions/qr-core.js normaliseItems` — a listed family is treated as unknown (`GONE_MSG`, `badIds`) so `qrEstimate`/`qrSubmit` refuse it and the website shows its existing "no longer offered" handling (the page then removes the line); the list is read from `productMeta/config` where the callables already read `constants`/`estimateEnabled` (`constantsOf`/`estimateEnabledOf` siblings → add `disabledFamiliesOf(meta)`); (b) the builder — `meta.families.disabled` (read beside `meta.quoteBuilder` at ~2480) hides those Configure chips, their "configure instead" hints, and renders their existing lines like "configurator off" (stored price, read-only); (c) Family pricing — a "Disabled on the website" chip on the card (read-only informational). The catalogue card itself keeps its button (static page) — the sure kill of a card is removing the family from `order` + `node scripts/build-catalogue.js` + push.
- `ESTIMATE_RANGE_MODE`, partner mode: unchanged.

---

## 10. Tests (each new or changed pin named; mutation targets for every money-adjacent path; record every killed mutant in the test header as Package A did)

### 10.1 Pins that MUST change (grep each; do not leave stale)
- `tests/product-families.test.mjs`: `ORDER` (56) → the eleven; 126–131 categories `['preparation','washing','washing','cooking','cooking','cooking','cooking','ventilation','storage','storage','storage']`, primaries `['PW-001','PW-004','PW-029','CE-001','CE-006','CE-010','CE-012','EX-001','PW-015','PW-023','PW-010']`, labels, absorbed counts `[9,10,1,13,2,10,2,7,4,3,3]`; 524 preview-key counts gain `dish_table 2, wok_range 3, cooking_line 4, deck_oven 3, hood 3`; the SHOT_LIST parse covers the five new doc sections; the `top` pins: `dish_table` and `wok_range` HAVE the group, `cooking_line`/`deck_oven`/`hood` do not (extend the two `for` loops at 1113/1183 with the three); construction-line pins (1038) gain the five default sentences of §3; `generator output === committed js/qr-families.js`.
- `tests/catalogue-public.test.mjs` 322–324: six categories (`ventilation` after `cooking`) and `EXCLUDED_CATEGORIES` without `exhaust_system`; 378/955/957/973 sections and nav; 1087 (where a product is classified) still holds.
- `tests/catalogue-layout.test.mjs` 147 (`TILE_ICONS`), 173–191 (eleven featured cards in `FAMS.order`; the CONSTRUCTION map gains five; a gated row carries `(Type is Fryer)`).
- `tests/site-public-surface.test.mjs` 518 sections; ~1181 `publicGroups(` still present.
- `tests/quote-request.test.mjs` 244 (`ALLOW.ids.length` 26 → **14**: MS-015, MS-016, CE-011, CE-024, CE-030, CE-031, BA-006, BA-011, RF-001…006), 323 (46 → **19**: 27 exhaust SKUs now pass the category gate; 20 are then excluded by id — assert that too), 330 category list gains `ventilation`, 725/737 `top` loops.
- `tests/quote-request-callables.test.mjs` 811 order.
- `tests/family-staff.test.mjs` 176 order; 185/606 "Not set up" loops may stay on the three storage ids.
- `tests/qb-configured.test.mjs` 407/1157 "all six" → eleven (loops over `FAMS.order`).
- `tests/derive-family-pricing.test.mjs` 76 "all six" → eleven + five `it`s (§7).
- `tests/seo-products.test.mjs` 50–63 `FAMILIES` map +5 (slug → fam/cat/key), 840 hub phrases +10, 848 order; the construction block's "six product pages" → eleven; `OTHER_PAGES` unchanged.
- `tests/content-assets.test.mjs`: llms.txt links +5 and the "eleven" line; PDF page counts.
- `tests/family-page.test.mjs`: add — a gated group is hidden until its condition holds, snaps to default when it stops holding, and the payload never carries a non-default inapplicable value; a forced maximum lowers the size and is in the hint.
- `tests/quote-builder-static.test.mjs`: `TUTORIAL_VERSION === 45`, `WHATS_NEW[0].ver === 45`; 1143 "all six families renders" → all eleven, and additionally: for `cooking_line` at `type:'griddle'` the `baskets` group is NOT rendered and at `type:'fryer'` `burners` is not; `cfgSplitErrors` routes "must be at most"; `families.disabled` read; chips count == `order.length`.

### 10.2 New logic tests — `tests/product-families.test.mjs` (new `describe('when / maxDimWhen')`) — **mutation-tested**
- `groupApplies`: absent `when` → true; single/multi value lists; gating value absent in config → uses the gating group's default.
- `validateConfiguration` (public AND staff): `cooking_line {type:'griddle', baskets:3}` → error `"Fry baskets" applies only when Type is Fryer.`, config `baskets:2`; `{type:'fryer', baskets:3}` ok; `{type:'fryer', burners:2}` → error, burners 1; `dish_table {side:'clean', sink:'prerinse'}` → error + `none`; absent gated key → default silently; `multi` gated group with `[]` vs non-empty.
- `minWidth` skips inapplicable terms (construct a fixture family with a gated numeric term; the five real families have no gated width term — the fixture pins the rule). `forcedMins`/`forcedMaxes` skip inapplicable rules.
- `forcedMaxes`/`validateDims`: `hood {type:'slim'} D 600` → `'With these options the depth must be at most 500 mm.'`; `deck_oven {trays:6}` W 700 → min error, W 1300 → max error, 1200 ok; `standardDims(deck_oven,{trays:6}).W === 1200` and `{trays:3}` → 700; `migrateAbsorbed(CE-016)` → W 1200.
- `describe`/`summaryParts` omit inapplicable rows/phrases; `cells` carries `when` text; `whenText` wording.
- Build (`checkFamily`): `when` naming a later group, a non-choice group, a staffOnly group, an unknown value, a `slots` gated group, a `{token}` on a gated group, `maxDimWhen` off-axis / below the forced min → each refused with its message.
- **Mutants (each must fail ≥ 1 test):** `groupApplies` ignores the value list (always true); validation keeps a non-default inapplicable value; `forcedMaxes` returns mins; `validateDims` treats "above max" as a warning; `minWidth` counts inapplicable terms; `describe` keeps inapplicable rows; build accepts a forward `when` reference.

### 10.3 Money-adjacent parity — `tests/qb-configured.test.mjs` + `tests/quote-request.test.mjs`
- `priceLine` PARITY (existing 300-triple random test) now draws from all eleven families — it MUST pass unchanged (`pricing-core.js` untouched; `when` canonical configs). Add three fixed cases: `cooking_line {type:'fryer', baskets:3}` prices `type:fryer` + `baskets:3` and NO `burners` cell; `{type:'griddle', burners:3}` prices `burners:3` only; `deck_oven {trays:6}` at W1200 prices `trays:6` + `size:W` (synthetic sheet `size.perW100` = 0 → delta 0, priced) and with `size.perW100` blank → `missing ['Size']`. **Mutants:** validation stops forcing the default (→ a `baskets` cell appears for a griddle, parity breaks); sheet cell for an inapplicable group priced.
- `computeBasket` (quote-request.test): a `hood` line at `type:'slim'`, D 600 → `normaliseItems` refuses with the max message; `families.disabled` containing `'hood'` → `GONE_MSG` + `badIds ['hood']`; `deck_oven` with `trays:6` and W absent → stored W 1200 (standardDims). **Mutants:** disabled list ignored; standardDims ignores the forced min.
- `nearestAbsorbed`: `cooking_line {type:'fryer', baskets:3, base:'stand'}` → `CE-022` exact; `{type:'fryer', baskets:2}` → `CE-009`; `wok_range {holes:2, rear:true}` → `CE-025`; a stove with `positions:['wok']` no longer finds CE-006 (nearest is CE-001 / tie rule) — pin it.

### 10.4 Gates and smoke
`node --test tests/*.test.mjs && bash scripts/ci-invariants.sh && node scripts/check-ui-wiring.js` (CHECK 9 scans the new public strings — no money words; CHECK 10 mirrors; CHECK 11 website loading unchanged). Live smoke (President, phone): website → Cooking → "Griddle, griller or fryer" → Fryer → baskets 3 → length snaps to ≥ 1000 → request; Sales › Quote requests → Open in Quote Builder → change to Griddle → baskets vanish, burners appear → "priced after review" (unapproved) → type a price → file. Hood: slim → depth capped at 500 in both UIs. Deck oven: trays 6 → width 1200 locked.

---

## 11. OWNER QUESTIONS (defaults in bold are in force unless he answers otherwise; answer by letter)

1. **Where do range hoods sit in the catalogue?** A — **a sixth public category "Ventilation" (after Cooking)**, hoods only, ducting/blowers stay unpublished. B — inside Cooking, no new category.
2. **Hood sizes and construction.** A — **length and depth in 10 mm steps, 600–6000 × 300–1500; wall ≥ 500 deep, island ≥ 1200 long and ≥ 700 deep, slim ≤ 500 deep; canopy height not chosen (wall/island ≈ 500, slim ≈ 350); construction text without a gauge.** B — lengths in 0.5 m steps only. C — as A but state a gauge (which?).
3. **Griddle / griller / fryer.** A — **types griddle · lava-rock griller · fryer · griller+griddle combi; burners 1–3 for griddle/griller; fry baskets 1–3 for a fryer, 2 standard; base = open stand or stand with bottom shelf.** B — also offer "countertop (no stand)". C — different basket counts / burner counts (say which).
4. **Wok range.** A — **1–3 wok holes at 600 mm per hole (hard minimum), optional rear stock burner (needs ≥ 800 deep), optional swan-neck faucet; CE-025 is treated as 2 holes + rear burner; CE-006 and CE-025 leave the stove family (the stove keeps its "wok" burner position).** B — add a water trough / water-cooled front option. C — different length per hole (say which).
5. **Gas deck oven.** A — **decks 1/2/3; 3 or 6 trays per deck (600 × 400 trays); body width fixed by the tray count: 700 mm for 3, 1200 mm for 6; optional heavy-duty stand; construction text with no steel-grade claim.** B — different tray size or widths (say which). C — no stand option.
6. **Dish table.** A — **PW-029 "SS Dish Table w/ Bottom" becomes the base product and gets a list price (it has none today — nothing prices until you enter one); clean/soiled, left/right (facing the table), pre-rinse sink on the soiled side only (needs ≥ 1200 long), undershelf, staff 1.2 mm top; length 600–3000, width 600–900, height standard 850.** B — use the sink family instead (no new family). C — change the ranges (say which).
7. **Product pages.** A — **five new SEO pages ship in the same release** (hub, sitemap, llms.txt, PDFs updated). B — catalogue cards first, pages later (the cards then have no "Learn more" link; the test pin is relaxed to "every page's family exists").
8. **Order and names on the website/builder.** A — **Preparation table · Sink · Dish table · Stove · Wok range · Griddle, griller or fryer · Gas deck oven · Range hood · Cabinet · Wall shelving · Rack.** B — other names/order (say which).

Not asked (decided here, say if wrong): no `top` group on hood / cooking line / deck oven; CE-030 salamander stays fixed; EX-026/EX-027 accessories are not published (they are the hood's filter/lighting options); the filters-none and lighting-none cells are SIGNED (negative allowed) and blank until Finance types them.

---

## 12. Workstreams (file ownership; no two agents edit one file; land in this order)

| # | chunk | owns | depends on |
|---|---|---|---|
| **WS-1** Definitions + logic + generators | `scripts/public-families.json` (§3, version 3), `scripts/public-categories.json`, `scripts/build-catalogue.js` (§4 checks, `PUBLIC_CATEGORIES`/`TILE_ICONS`/`EXCLUDED_CATEGORIES`, `FAMILY_PAGES` ×5, card row suffix), generated `js/qr-families.js` + `functions/qr-families.js` + `catalogue/index.html` + `functions/qr-published.json`, `js/product-families.js` + `cp` to `functions/product-families.js`, `js/qr-preview.js` (5 drawings + default), `scripts/derive-family-pricing.js` (§7), `js/screens/family-pricing.js` (caption + disabled chip), `docs/configurator-preview-photo-list.md`, tests: product-families, catalogue-public, catalogue-layout, derive-family-pricing, family-staff (order/pins only), qb-configured (pins + §10.3), quote-request (pins + §10.3 basket cases), quote-request-callables (order) | owner Q1–Q6, Q8 |
| **WS-2** Rules + server | `firestore.rules` (ONE targeted line, §8.1), `functions/qr-core.js` (`disabledFamiliesOf` + `normaliseItems` gate), `functions/index.js` (pass the list where `constantsOf(meta)` is read in `qrEstimate`/`qrSubmit` — **coordinate: the partner-removal agent is editing `functions/index.js`; make the two smallest possible `Edit`s, never a rewrite**), rules-text assertion in `tests/family-staff.test.mjs` (the `familyId in [...]` list), `tests/quote-request.test.mjs` disabled-list cases (hand the exact `it` blocks to WS-1 if both need the file at once — WS-1 owns the file; WS-2 sends it the block text) | — (deploy rules first) |
| **WS-3** Website configurator | `js/quote-request.js` (§6.1 hidden gated groups, forced maximum, "eleven"), tests: family-page, site-public-surface | WS-1 generated files |
| **WS-4** Builder | `quote-builder-v2.html` (§6.6: gated groups, forced max, chips, `families.disabled`, TUTORIAL 45 / WHATS_NEW / Help), `tests/quote-builder-static.test.mjs` | WS-1 |
| **WS-5** Public pages + docs | `products/<5 slugs>/index.html` (new), `products/index.html`, `sitemap.xml`, `llms.txt`, `docs/seo-keyword-map.md`, `scripts/downloads/catalogue.js` wording, `downloads/src/*.html` + `downloads/*.pdf` (`node scripts/build-downloads.js`, after WS-1's catalogue), tests: seo-products, content-assets | WS-1 (cards, FAMILY_PAGES); owner Q7 |
| **WS-6** Ops | `STATUS.md` (this program, pending ops: rules deploy, functions deploy, PW-029 price, derive → import → approve ×5, smoke), nothing else | after all |

WS-3/4/5 read `js/qr-families.js` / `js/product-families.js` but never edit them. No edits to `js/config.js`, `sw.js`, `js/app.js`, `js/pricing-core.js`, `js/money-core.js`, `js/qb-configured.js` (its logic is generic; if a test there needs a change it is a PIN change in WS-1).

Acceptance: three gates green; every §10 mutant recorded as killed; `git diff` shows no price token in any committed file (`git grep -nE '₱|PHP ?[0-9]' -- specs/ scripts/ js/ functions/ products/` adds nothing new); `private/` untouched by git; Package A smoke still passes for the six original families (sink basins → price moves); §10.4 smoke done; STATUS updated.

---

## 13. Follow-ups (not in this package)
Preview photos for the five families (shot list in the doc); per-option cost cells; a "Ventilation" service cross-link from the hood card; a `qbPriceConfigured` callable (Package A §13); salamander / rice steamer / proofer families if the owner wants them (each is one more §3 block).

## 14. OWNER ANSWERS (2026-10-28)

- Q2 hoods → **A** (any size, 10 mm steps, type limits as written, no gauge stated).
- Q3 griddle/griller/fryer → **A** (standard set; no countertop version).
- Q4 wok range → **A** (1–3 holes at 600 mm, optional rear burner ≥ 800 deep, optional swan-neck faucet; CE-006/CE-025 leave the stove family).
- Q5 deck oven → **A** (1/2/3 decks; 3 or 6 trays of 600×400; widths 700/1200; optional stand).
- Q1, Q6, Q7, Q8 → defaults in force (Ventilation category; PW-029 is the dish-table base and stays "priced after review" until the owner enters its list price; five SEO pages ship in the same release; order/names as A).
- Sequencing: the partner-removal Phase 3 (WS-H) lands and deploys FIRST; WS-2 here starts only after that commit, so `firestore.rules` / `functions/index.js` have a single writer at a time.
