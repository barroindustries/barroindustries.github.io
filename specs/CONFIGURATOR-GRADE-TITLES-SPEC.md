# CONFIGURATOR — LINE TITLES + STAFF-ONLY STEEL GRADE — SPEC (2026-10-28)

Status: SPEC, owner rulings final (2026-10-28). Implementer: a Sonnet subagent, max effort, following this file exactly; escalate ambiguity, never improvise. Line numbers are locators only — re-grep before editing. Read CLAUDE.md first (hook-owned versions, no `git stash` / `reset --hard` / `checkout --` / `clean`, script load order, CHECK 10 mirrors).

## 0. Rulings in one paragraph

(1) A configured line in the Quote Builder gets a proper **title** (the item `name` that flows to the saved quote and the printed quote): "SS Preparation Table", "SS Sink", "SS Dish Table", "SS Range Stove" / "SS Range Stove Combination (Griller, Fryer)" (selected add-ons, family option order, joined ", ", their labels), "SS Wok Range", by type "SS Griddle" / "SS Lava-Rock Griller" / "SS Fryer" / "SS Griller + Griddle Combination", "Gas Deck Oven", "SS Range Hood", "SS Cabinet", "SS Wall Shelving", "SS Rack". The public website's card / page names stay unchanged. (2) Every one of the 11 families gets a **staff-only `grade` choice** (304 default / 316) following the `top` precedent exactly, except that it HAS its own spec row and that row is the FIRST row: "Stainless Steel 304 Food Grade" or "Stainless Steel 316 Laboratory Grade". The website never shows nor accepts 316; a 316 line is "priced after review" until the owner fills one signed cell per family in Inventory › Family pricing. The Construction line must not contradict a 316 choice. The standing rule "no grade (SS316) OPTION in any configurator" is relaxed ONLY for the staff Quote Builder; the website stays SS304 text-only. (3) Builder change ⇒ tutorial: `TUTORIAL_VERSION` 45 → 46, a `WHATS_NEW` entry, Help copy.

## 1. Recon — what exists (verified 2026-10-28)

- Family DEFINITIONS are data: `scripts/public-families.json` (`version: 3`, `order` of 11 ids, `families`, `fixed`). `scripts/build-catalogue.js` validates it (`checkFamily`, allowlists `FAMILY_KEYS` / `GROUP_KEYS` / `OPTION_KEYS` / `FAMILY_PUBLIC_KEYS` ≈ lines 618-623; construction-token check ≈ 730-741; absorbed check ≈ 840-850) and GENERATES `js/qr-families.js` + byte-identical `functions/qr-families.js` (`renderFamiliesJs` ≈ 941), the `catalogue/index.html` data island + family cards (`renderFamilyCard` ≈ 1098: walks `PF.publicGroups`, Construction row = `PF.constructionLine(fam, PF.defaultConfig(fam))`, Material row = `FAMILY_MATERIAL`), and `functions/qr-published.json`. It writes nothing else; the 11 `products/*/index.html` are hand-written (and currently carry another session's uncommitted WIP — see §7).
- LOGIC is `js/product-families.js` (ES5 UMD, pure, price-free), mirrored by `cp` to `functions/product-families.js` (ci-invariants CHECK 10). Relevant: `publicGroups` (drops `staffOnly`), `validateConfiguration(family, raw, opts)` (public mode refuses a non-default staff-only value with "… is chosen by our staff when the quotation is prepared." and takes the default; `{staff:true}` accepts it), `constructionLine` (fills `{group}` tokens with option `c`, default when absent), `describe` (one row per PUBLIC applying group, then Construction — a staff-only group has NO row), `summaryParts` (a staff-only choice contributes only when non-default), `cells` (every option of every group; `baseline` = the choice default), `migrateAbsorbed`.
- The `top` precedent (five families: prep_table, sink, dish_table, stove, wok_range), appended LAST: `{ key:'top', label:'Top plate', type:'choice', default:1.5, staffOnly:true, options:[{v:1.5,l:'1.5 mm (16 ga)',s:'1.5 mm top',c:'1.5 mm (16 ga) top plate',hint:'Standard'},{v:1.2,l:'1.2 mm',s:'1.2 mm top',c:'1.2 mm top plate (lighter)',hint:'Lighter'}] }`; the construction templates read `"SS304 stainless steel · {top} · …"` (prep_table, sink, dish_table, stove, wok_range) or `"SS304 stainless steel · …"` with no top token (cooking_line, hood, cabinet, wall_shelf, rack); deck_oven's has no grade claim (`"Insulated double-wall decks … · stainless steel outer body · {stand}"`).
- `js/pricing-core.js` `priceConfiguredItem` is GENERIC: any `choice` group whose value ≠ default is priced from `options[group][String(v)]` = `{flat, perW100}`; a blank `flat` → `missing` → `reason 'missing_input'` (= "priced after review (Material: Stainless Steel 316 Laboratory Grade)"). **No edit to pricing-core.js** (money-core contract; it already handles `top` the same way). `normalisePricingDoc` keeps every group the family defines → the new cells pass through.
- `firestore.rules` `product_pricing/{familyId}` validates the family id list, `approved`, `approvedBy` and "figures unchanged while approved" — it does NOT validate cell keys. **No rules change, no rules deploy.**
- `js/screens/family-pricing.js` is generic: rows from `PF.cells`, `schemaVersion` = `QR_FAMILIES.version`, staff-only note on a `staffOnly` group (≈ line 237), the president-only importer refuses a seed whose `schemaVersion` ≠ the app's. `scripts/derive-family-pricing.js` writes the PRIVATE gitignored seed; `tests/derive-family-pricing.test.mjs` requires EVERY non-baseline cell of every family to be in the seed (derived or BLANK with a written reason). The staff-only top cell is seeded BLANK by `topPlateCell()` in the five recipes.
- `js/qb-configured.js`: `buildLine` (≈ 117-162; `name: fam.label`, `specs: d.PF.describe(...)`), `completeConfig` (fills ABSENT keys with defaults — generic, covers `grade`), `fromRequestItem` (≈ 354; `name: str(row.name)`), `migrateLegacyConfiguredLine` (≈ 498-532; `out.name = fam.label` ≈ 516). `functions/qr-core.js` ≈ 399-415 validates PUBLIC (no opts) and stores `name: fam.label`, `specs: PF.describe(fam, v.config)`.
- `quote-builder-v2.html`: `openConfigurator` (≈ 4262; re-validates a saved config in staff mode, absent staff-only key = default), `cfgGroupHtml` (≈ 4377: staff chip on a `staffOnly` group; a choice shows a hint line only when some option carries `hint`), `cfgRenderBody` (≈ 4390: `fam.groups.map((g, gi) => …)` draws applying groups by index), `cfgMakeLine` → `QBConfigured.buildLine` (≈ 4052), `cfgApplyEdit` (≈ 4068: copies `['id','familyId','familyVersion','config','size','dims','specs','specStr','formulaType','qty','unit','notes','basisUnitPrice']` from the fresh line onto the old — `name` is NOT in that list), `TUTORIAL_VERSION = 45` (≈ 9243), `WHATS_NEW` (≈ 9248).
- Schema: no `product_pricing` sheet is approved in production (STATUS: all pending), so bumping `version` 3 → 4 costs nothing live.

## 2. Data design (scripts/public-families.json)

### 2.1 The `grade` group — FIRST group of every family, identical in all 11
```json
{ "key": "grade", "label": "Material", "type": "choice", "default": 304, "staffOnly": true, "specRow": true,
  "options": [
    { "v": 304, "l": "Stainless Steel 304 Food Grade",       "s": "SS304", "c": "SS304 stainless steel" },
    { "v": 316, "l": "Stainless Steel 316 Laboratory Grade", "s": "SS316", "c": "SS316 stainless steel" } ] }
```
- Position: index 0 of `groups` (so the describe row and the pricing-sheet rows come first by group order — no special casing). `top` stays LAST where it exists.
- NO `hint` on either option: `describe` appends a hint in parentheses, and the row must read exactly the label. The builder then draws no hint line for this group (existing rule).
- `specRow: true` is the ONE new group field: "a staff-only group that still has its own specification row". `top` does not get it (it stays Construction-only). Build check: `specRow` boolean, allowed only with `staffOnly === true`.
- Numeric values 304 / 316 like `top`'s 1.5 / 1.2; sheet cell keys are therefore `"304"` (baseline) and `"316"`.

### 2.2 Construction templates
Replace the literal prefix `SS304 stainless steel` with the token `{grade}` in the 10 families that have it: prep_table, sink, dish_table, stove, wok_range → `"{grade} · {top} · …"`; cooking_line, hood, cabinet, wall_shelf, rack → `"{grade} · …"`. deck_oven's template is UNCHANGED (no grade claim; its grade row states it; the public deck-oven page keeps "SS304" wording exactly as it is). At the defaults `constructionLine` renders byte-identically to today ("SS304 stainless steel · 1.5 mm (16 ga) top plate · …"), so every catalogue card, product page and FAQ sentence that quotes it is unchanged; with 316 it reads "SS316 stainless steel · …" and cannot contradict the grade row.

### 2.3 Titles — two family fields + one option field
- `title` (string, REQUIRED on every family): a template whose `{group}` tokens are filled from the configuration. A **choice** token → the chosen option's `t` (new OPTION field, "title word"), falling back to its `l`; absent/invalid value → the default option. A **multi** token → the SELECTED options' labels `l`, in the family's option order, joined `", "` (empty when none). A slots token is a build error.
- `titleAny` (object, OPTIONAL): `{ "group": "<multi group key>", "template": "<template>" }` — used INSTEAD of `title` when that multi group applies and has at least one selection.
- Values:
  | family | title | extra |
  |---|---|---|
  | prep_table | `SS Preparation Table` | |
  | sink | `SS Sink` | |
  | dish_table | `SS Dish Table` | |
  | stove | `SS Range Stove` | `titleAny: { group: "addons", template: "SS Range Stove Combination ({addons})" }` |
  | wok_range | `SS Wok Range` | |
  | cooking_line | `{type}` | `type` options get `t`: griddle `SS Griddle`, griller `SS Lava-Rock Griller`, fryer `SS Fryer`, combi `SS Griller + Griddle Combination` |
  | deck_oven | `Gas Deck Oven` | |
  | hood | `SS Range Hood` | |
  | cabinet | `SS Cabinet` | |
  | wall_shelf | `SS Wall Shelving` | |
  | rack | `SS Rack` | |
- Titles never mention the grade (the row does). `label` (card/page name) is untouched.

### 2.4 Schema version + readme
`version: 3 → 4`. Extend `_readme` with: "4 = the staff-only steel grade (304 / 316, `grade`, first group, its own first spec row via `specRow`) on every family, and the line titles (`title`, `titleAny`, option `t`) the Quote Builder names a configured line with". Also the sentence that today says "A group marked staffOnly (the 1.2 mm top plate) is never offered on the website …" → add "(the 1.2 mm top plate, the SS316 grade)". No figure anywhere.

## 3. Logic (js/product-families.js — then `cp js/product-families.js functions/product-families.js`)

1. `describe(family, config)`: walk `family.groups` in order; skip a group that does not apply (`groupApplies`); skip a `staffOnly` group UNLESS `g.specRow === true`; rows as today; Construction last. Net effect: `[Material, …public rows…, Construction]`. Update the header comment ("A staff-only group has no row of its own unless it is marked specRow — the grade row is first because the group is first").
2. NEW `lineTitle(family, config)` → string. Pure, never throws. Algorithm: `tpl = family.title`; if `family.titleAny` names a multi group that exists, applies, and whose selection (filtered to the group's real option values, in option order) is non-empty → `tpl = family.titleAny.template`; fill `{token}`s per §2.3; return `''` when `family.title` is not a non-empty string (callers fall back to `family.label`). Export it.
3. No other function changes. `validateConfiguration`, `summaryParts` ("SS316" first in the summary when chosen, nothing when 304), `cells` (grade cells first; 304 baseline, 316 signed), `migrateAbsorbed` (absorbed configs never state `grade` → default) all behave correctly as written.
4. Comment hygiene in this file and in `js/qr-def.js`, `js/quote-request.js`, `js/qr-preview.js`, `functions/qr-def.js`: do NOT write "SS316", "316L" or "laboratory" anywhere (code or comments) — tests/site-public-surface pins those files as free of it (§6). Say "the staff-only grade" instead.

## 4. Build + seed (scripts/)

`scripts/build-catalogue.js`:
- `FAMILY_KEYS` and `FAMILY_PUBLIC_KEYS`: add `'title'`, `'titleAny'` (insert both right after `'description'` in BOTH lists — deterministic output order). `GROUP_KEYS`: add `'specRow'`. `OPTION_KEYS`: add `'t'`.
- `checkFamily`: `title` non-empty string (error `"title" must be a non-empty string`); every `{token}` in `title` (and in `titleAny.template`) names a group of this family that is `choice` or `multi` (error `title: {x} does not name a choice or multi group of this family`); a `t` present on an option must be a non-empty string; `titleAny`, when present, is an object with exactly `group` (a `multi` group of this family) and `template` (non-empty) (error `titleAny: "group" must name a multi group of this family`); `specRow`, when present, is boolean and only allowed with `staffOnly === true` (error `"specRow" must be true or false, and belongs to a staff-only group only`). The public-text guard (`stringPaths`) already scans every string of the family, so `title` / `t` are checked for price / brand words automatically — confirm with a test (§6).
- The comment block at `FAMILY_MATERIAL` (≈ 1072): reword "The configurators and the quote flow offer NO grade or finish choice yet" → "The WEBSITE configurators and the quote flow offer no grade or finish choice (the SS316 grade is a staff-only choice in the Quote Builder, 2026-10-28)".
- Run `node scripts/build-catalogue.js`. It must rewrite ONLY `js/qr-families.js` + `functions/qr-families.js`. PROVE `catalogue/index.html` and `functions/qr-published.json` are untouched: `shasum -a 256` both before and after; identical hashes required (the card's Construction row is the defaults line, which is byte-identical). If `catalogue/index.html` changes, STOP and report — do not stage it (§7).

`scripts/derive-family-pricing.js`: add `gradeCell()` next to `topPlateCell()` and call it ONCE for every family (after the per-family recipes, before the length-rate block — not inside each `if (fid === …)`), i.e. `setCell('grade', '316', lbl('grade', 316), blank('The standard material is SS304; the base item\'s list price is read as the SS304 price. Enter what SS316 ADDS for this family (a positive amount; add a per-100-mm rate only if the premium grows with length), or 0. The master has no SS316 figure, so this is always left blank here.'))`. No figure, no cross-reference. Update the file header (≈ line 29-35) with one sentence about the grade cell.

## 5. Builder side

`js/qb-configured.js`:
- `buildLine`: `name: d.PF.lineTitle(fam, v.config) || fam.label` (guard for a PF without `lineTitle`: `typeof d.PF.lineTitle === 'function'`).
- `migrateLegacyConfiguredLine`: `out.name = lineTitle || fam.label` (same guard).
- `fromRequestItem`: when `rowFam` resolves (deps given), `out.name = lineTitle(rowFam, out.config) || str(row.name)`; without deps the server's name passes through as today. Update the function comment.
- `completeConfig` unchanged (it already fills `grade: 304` for an old stored config).

`quote-builder-v2.html`:
- `cfgApplyEdit`: add `'name'` to the copied-field list, so re-configuring a line refreshes its title (the rest of the edit rules are untouched). A FILED / saved quote is never rewritten: load paths only recompute `_cfg`, never `name`.
- Nothing else in the panel needs code: the grade group renders first as a select with the "staff" chip (existing `staffOnly` rendering); `specStr` prints "Material: Stainless Steel 304 Food Grade, …, Construction: …" first.
- Tutorial (contract: `.claude/skills/quote-builder-tutorial/SKILL.md`): `TUTORIAL_VERSION = 46`; prepend `{ ver:46, date:'2026-10-28', items:[ 'Configured lines now carry a proper name on the quote — "SS Range Stove", "SS Range Stove Combination (Griller, Fryer)", "SS Griddle", "SS Lava-Rock Griller", "Gas Deck Oven" and so on — and the name updates when you re-configure the line.', 'Every configured product starts with a Material row: Stainless Steel 304 Food Grade as standard, or Stainless Steel 316 Laboratory Grade — a staff-only choice (the website never offers it). A 316 line shows "Priced after review" until Finance enters the 316 amount for that product in Inventory › Family pricing.' ] }`; in `#helpBody` configurator copy add one sentence on the Material row + staff-only 316. Re-verify `TOUR_STEPS` selectors still resolve (no id changes expected).

## 6. Tests (add / update; never loosen a pin — move it)

Version pins 3 → 4: `tests/product-families.test.mjs` (≈ 171, 1424-1425), `tests/family-staff.test.mjs` (≈ 682 + header comment), `tests/derive-family-pricing.test.mjs` (≈ 93), `tests/qb-configured.test.mjs` (≈ 1246), `tests/quote-request.test.mjs` (≈ 818). (`tests/pricing-core.test.mjs` ≈ 773 is a normaliser round-trip, leave it.)

`tests/product-families.test.mjs`:
- "publicGroups leaves out exactly the staff-only group" (≈ 1328-1350) → staff-only groups are exactly `grade` at index 0 on ALL 11 and `top` LAST on the five; deepEqual the `grade` group to §2.1 (word for word) and keep the `top` deepEqual.
- (≈ 1358) absorbed configs state neither `grade` nor `top`; every absorbed SKU converts and validates PUBLIC with `grade === 304`.
- cells test (≈ 1368): per family, the `grade` cells are `[['304','Stainless Steel 304 Food Grade','option',true],['316','Stainless Steel 316 Laboratory Grade','option',false]]` and come FIRST.
- public wording rule (≈ 1378-1389): rewrite — the `grade` text appears in NO public group (`PF.publicGroups`), the group's hints are absent, no money / brand words; the construction templates start with `{grade}` on the 10 families and deck_oven's is the literal string of today; `constructionLine` at defaults equals today's sentences for all 11 (pin the 11 strings), and with `grade: 316` starts with "SS316 stainless steel · " on the 10 and is unchanged on deck_oven.
- build-refusal test (≈ 1391): add the §4 errors (bad `title`, `{positions}` title token, `titleAny.group` naming a choice group, `specRow` on a public group, `t` empty, a price pattern inside `title`).
- generated-file test (≈ 1419-1425): `"staffOnly": true` count 16; version 4; `fresh` matches `"construction": "\{grade\} · \{top\} · 1\.2 mm undershelves`.
- NEW `lineTitle` block: every family at defaults = the §2.3 title; stove with addons `['fryer','griller']` stored → validated config is `['griller','fryer']` → "SS Range Stove Combination (Griller, Fryer)"; all four add-ons → "SS Range Stove Combination (Griller, Griddle, Oven, Fryer)"; stove with `addons: []` → "SS Range Stove"; cooking_line each type → the four titles; an absent / invalid `type` → "SS Griddle"; a family without `title` → `''`; null / junk inputs never throw; titles never contain "304" / "316".
- NEW `describe` block: first row is `{ label:'Material', value:'Stainless Steel 304 Food Grade' }` for every family at defaults, `'…316 Laboratory Grade'` with `grade: 316`, last row Construction; `top` still has no row; `summaryParts` with 316 starts with `'SS316'` and with 304 reads exactly as before.
- Public mode: `validateConfiguration(fam, { grade: 316 })` → error "\"Material\" is chosen by our staff when the quotation is prepared." and `config.grade === 304`; `{ grade: 304 }` accepted; staff mode accepts 316; `validateLine` server-style (no opts) rejects 316 on every family.

`tests/pricing-core.test.mjs` (additive): with an approved schema-4 sheet whose `grade.316.flat` is null, a 316 line → `priced false, reason 'missing_input', missing ['Material: Stainless Steel 316 Laboratory Grade']`; with a FAKE odd figure in `flat` (and one case with `perW100`) the delta `grade:316` is added; a 304 line adds no delta. Fake figures only (public repo).

`tests/qb-configured.test.mjs`: `buildLine` names (every family at defaults + the stove / cooking_line cases); `migrateLegacyConfiguredLine` names; `fromRequestItem` with deps retitles, without deps keeps the server name; `completeConfig` fills `grade: 304` on a config without it (extend the `withoutTop` fixture ≈ 1371 to strip `grade` too → `withoutStaff`); specs first row Material (update ≈ 1659-1666 label lists: `['Material','Type','Fry baskets','Base','Construction']` etc.); the random priceLine-vs-computeBasket sweep still agrees (configs there are public → 304).

`tests/quote-request.test.mjs` (≈ 771-775, 853, 865) and `tests/quote-request-callables.test.mjs` (≈ 847, 1248): the server's `specs` = `['Material', …publicActiveGroups labels…, 'Construction']`, Material value "Stainless Steel 304 Food Grade"; a submitted `config.grade = 316` is REFUSED by the callable like `top: 1.2` is (copy that existing case); the public basket/`publicConfig` drops `grade`.

`tests/quote-builder-static.test.mjs` (≈ 1594-1632, 1705-1758, 2033): the STAFF list → `grade` on all 11 + `top` on five; chips count per family generic; the drawn label for index 0 is "Material" + chip; `makeLine(...)` names; the printed row list at ≈ 2033 → `['Material','Type','Burners','Base']` after filtering Construction; `cfgApplyEdit` copies `name` (pin by regex on the source list); `TUTORIAL_VERSION === 46` and a `ver:46` `WHATS_NEW` entry exist (there are existing patterns for this — follow them).

`tests/site-public-surface.test.mjs` (≈ 1199-1203, 1216): rewrite the rule — (a) `PF.publicGroups` of every family contains no group whose key/label/options match `/316|grade|mirror|satin|brushed|finish|material/i`; (b) `js/qr-def.js`, `js/quote-request.js`, `js/qr-preview.js`, `js/product-families.js`, `functions/qr-def.js` still match none of `/SS ?316|316L|satin|mirror finish|laboratory/i` (drop the two `qr-families.js` from that list — they carry the staff-only group, exactly as they carry the 1.2 mm top); (c) `js/quote-request.js` still walks `publicGroups`, never `fam.groups`, never `{staff:true}`; (d) the flagged list is `[prep_table.grade, prep_table.top, sink.grade, sink.top, dish_table.grade, dish_table.top, stove.grade, stove.top, wok_range.grade, wok_range.top, cooking_line.grade, deck_oven.grade, hood.grade, cabinet.grade, wall_shelf.grade, rack.grade]`; (e) NEW: the text of `catalogue/index.html`, `products/index.html`, every `products/*/index.html`, `faq/index.html`, `llms.txt` (scripts/styles stripped) contains neither "Stainless Steel 316 Laboratory Grade" nor "Stainless Steel 304 Food Grade" (the group's exact labels never reach a public page; the owner's "SS316 laboratory-grade" marketing wording there is different text and stays). **This file has another session's uncommitted hunks — see §7 for how to commit yours only.**

`tests/family-page.test.mjs` (≈ 504-512): STAFF premise → `publicGroups` = groups minus `['grade', 'top']`; the "never kept, offered or sent" block gets a `grade: 316` twin of each `top: 1.2` case.

`tests/family-staff.test.mjs`: the Family pricing screen lists the `Material` row first on every card with the staff-only note, baseline 304 not entered, one `316` input pair (flat, per 100 mm); import of a seed with `grade|316` works; schema 4.

`tests/derive-family-pricing.test.mjs`: every family's seed has `grade.316` BLANK with a reason that names SS316 and says "ADDS" and carries no digit-peso figure; the coverage test (≈ 103-111) passes with the new cells.

`tests/seo-products.test.mjs` (≈ 792-797) needs NO change (the page rows count `publicGroups`; Construction equals the defaults line) — run it to prove the public pages are unaffected. Do not edit the WIP-modified `tests/seo-*.test.mjs`, `tests/catalogue-*.test.mjs`, `tests/content-assets.test.mjs`, `tests/project-brief-page.test.mjs`.

Mutation record (scratch copies only, never the shared tree): grade row not first; `specRow` ignored (no row); `lineTitle` ignoring option order / using `s` instead of `l` / falling back to `''` for a missing type; public mode accepting 316; `cfgApplyEdit` without `name`; derive missing the grade cell; a construction template still starting "SS304" on one family — each must fail at least one test. Record the list in the commit message.

## 7. Workflow, commit, deploy

Gates before the commit: `node --test tests/*.test.mjs && bash scripts/ci-invariants.sh && node scripts/check-ui-wiring.js`. Then `cp js/product-families.js functions/product-families.js` (CHECK 10) — run the gates again after the copy.

The working tree holds UNRELATED uncommitted website WIP (products/*/index.html, catalogue/index.html, tests/seo-*.test.mjs, tests/site-public-surface.test.mjs, tests/catalogue-*.test.mjs, …). Never `git stash` / `reset --hard` / `checkout --` / `clean`. Commit by explicit path ONLY:

```
git add scripts/public-families.json js/qr-families.js functions/qr-families.js js/product-families.js functions/product-families.js \
        js/qb-configured.js scripts/build-catalogue.js scripts/derive-family-pricing.js quote-builder-v2.html \
        tests/product-families.test.mjs tests/pricing-core.test.mjs tests/qb-configured.test.mjs tests/quote-request.test.mjs \
        tests/quote-request-callables.test.mjs tests/quote-builder-static.test.mjs tests/family-page.test.mjs \
        tests/family-staff.test.mjs tests/derive-family-pricing.test.mjs specs/QUOTE-BUILDER-CONFIGURATOR-SPEC.md \
        specs/CONFIGURATOR-GRADE-TITLES-SPEC.md STATUS.md
```
`tests/site-public-surface.test.mjs` is WIP-modified and `.github/workflows/ci.yml` runs the suite, so its new assertions MUST be in the commit without the other session's hunks. Stage index-only hunks: `git show HEAD:tests/site-public-surface.test.mjs > <scratch>/base.mjs`; apply ONLY the §6 edits to a copy `<scratch>/mine.mjs` (same edits as you made in the working-tree file); `diff -u <scratch>/base.mjs <scratch>/mine.mjs | sed 's#<scratch>/base.mjs#a/tests/site-public-surface.test.mjs#; s#<scratch>/mine.mjs#b/tests/site-public-surface.test.mjs#' > <scratch>/mine.patch`; `git apply --cached <scratch>/mine.patch`. Verify with `git diff --cached --stat` that no WIP file (catalogue/index.html, products/*, tests/seo-*, …) is staged, and `git diff --cached -- tests/site-public-surface.test.mjs` shows only your hunks. Then commit normally (the pre-commit hook bumps the version; never `--no-verify`). `specs/QUOTE-BUILDER-CONFIGURATOR-SPEC.md` ≈ line 363: change "no grade (SS316) or finish OPTION in any configurator (standard TEXT only)" → "no grade or finish option on the WEBSITE configurators (standard text only); the SS316 grade is a staff-only Quote Builder choice since 2026-10-28 (specs/CONFIGURATOR-GRADE-TITLES-SPEC.md)".

Deploy order (owner runs; record in STATUS): (1) `bash scripts/release.sh functions` — the qr* callables (asia-east1) must ship the regenerated `functions/qr-families.js` + `functions/product-families.js` (the server's `describe` now writes the Material row first; `release.sh`'s functions hash does not cover these files — redeploy by hand if it says "unchanged"). (2) `release.sh push`. Either order is SAFE live: the website never sends `grade` (publicConfig drops staff-only keys), both server versions validate a grade-less config, and no `product_pricing` sheet is approved. No rules deploy. (3) One-time: `node scripts/derive-family-pricing.js` → Inventory › Family pricing › Import derived starting values (president) — the schema-4 seed; the previous unapproved schema-3 sheets are superseded. (4) Owner enters the 316 cell per family when ready; until then every 316 line is "priced after review".

## 8. File ownership
- `scripts/public-families.json` — grade group ×11, construction ×10, title/titleAny/t, version 4, readme.
- `js/product-families.js` (+ `functions/product-families.js` by cp) — `describe`, `lineTitle`, exports, comments.
- `js/qr-families.js`, `functions/qr-families.js` — GENERATED only.
- `scripts/build-catalogue.js` — allowlists + checks + one comment. `scripts/derive-family-pricing.js` — `gradeCell`.
- `js/qb-configured.js` — three `name` sites. `quote-builder-v2.html` — `cfgApplyEdit` + tutorial.
- Tests listed in §6. `specs/QUOTE-BUILDER-CONFIGURATOR-SPEC.md` one line. `STATUS.md` (live note + pending actions).
- NOT touched: `js/pricing-core.js`, `js/money-core.js`, `firestore.rules`, `functions/qr-core.js`, `js/quote-request.js`, `js/qr-preview.js`, `js/screens/family-pricing.js`, `catalogue/index.html`, `products/**`, `.claude/skills/quote-builder-tutorial/SKILL.md`.

## 9. Decisions I made / risks
- D1 `grade` is the FIRST group (not appended last like `top`): the "first row" and "first cell" requirements then fall out of group order with one generic flag (`specRow`) instead of positional special cases. Consequence: the builder panel shows Material first too (sensible), and index-based test fixtures shift by one.
- D2 Row label is "Material" (prints "Material: Stainless Steel 304 Food Grade"); the owner named only the value text. Change the `label` string in §2.1 if he wants "Grade" or "Steel grade".
- D3 The 316 cell is the generic signed `{flat, perW100}` pair like every other choice (no new cell shape, no family-pricing.js edit); recommendation to the owner: enter a flat premium, leave per-100-mm blank unless the premium really grows with length. Seeded BLANK always.
- D4 `{grade}` token in construction keeps the public defaults output byte-identical (proved by hash in §4); deck_oven's construction untouched (owner's SS304-only page wording stays; a 316 deck oven relies on its Material row).
- D5 `describe` is shared with the server, so a website quote REQUEST's stored `specs` (staff Quote-requests screen, client confirmation) now also begins with "Material: Stainless Steel 304 Food Grade" — always 304 there. Not a static-page change; consistent with the site's "SS304 as standard" claim. If the owner objects, the alternative is a `describe(family, config, opts)` with `opts.staff` gating `specRow` — not chosen (two spec shapes for one line).
- D6 Saved / filed quotes keep their stored `name`; only `buildLine` (new line), `cfgApplyEdit` (re-configure), `migrateLegacyConfiguredLine` (convert) and `fromRequestItem` (request opened in the builder) produce titles.
- D7 Titles carry no grade word; the Material row carries it.
- R1 The estimate signature (functions/qr-core.js ≈ 470-484) hashes `specs`: a client who fetched an estimate on the old functions and submits on the new ones gets the usual "estimate changed — refresh" path during the deploy minute. Same as any family change; acceptable.
- R2 `js/qr-families.js` ships the strings "Stainless Steel 316 Laboratory Grade" to the public catalogue page's JS (never rendered) — exactly as it ships the 1.2 mm top today. The §6 site-public-surface rewrite pins that no public HTML text carries it.
- R3 The WIP tree: if `node scripts/build-catalogue.js` reports or writes a change to `catalogue/index.html`, something in the WIP island differs — stop, report the diff, do not stage it.
- R4 Schema bump invalidates the owner's unapproved schema-3 seed imports (they were never approved; re-import is a one-time action, §7).
