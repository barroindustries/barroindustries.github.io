# Public product configurator — build record and owner review (2026-10-21)

**Status: built and verified locally, including owner ruling (b) ("only the configurable products in Preparation, Washing and
Storage"). Nothing here is committed, pushed or deployed.** Simplified version of `specs/PRODUCT-CONFIGURATOR-SPEC.md`, built on
top of the live public quote flow (v14.0.317) without changing how a plain item is quoted. No price, rate or formula appears in
any file below (the repository is public); the only figures are in the PRIVATE option sheets (`product_pricing/{family}`,
finance tier) and in the owner's local, gitignored seed file.

## 1. What the visitor sees

* The catalogue keeps its five categories. **Six products are ONE configurable card each** ("Configurable" tag,
  representative photo where one exists, "Configure & add"): Preparation table, Sink, Stove, Cabinet, Wall shelving, Rack. The 44
  SKUs they absorb are no longer separate cards.
* **Owner ruling (b): in Preparation, Washing and Storage the public catalogue shows ONLY the configurable products.**
  Preparation = the Preparation table; Washing = the Sink; Storage = the Cabinet, Wall shelving and Rack. Every other specialised
  table, sink and washing item, cabinet, shelf, rack and trolley (28 SKUs, listed in section 2) is no longer published. They are
  excluded in the build (`scripts/public-categories.json`, `excludedProducts`), not deleted: the product master, the Quote
  Builder and the rest of the app are untouched. Equipment that is not one of the six types stays a fixed item in its natural
  category (the meat grinder and slicer moved to Cooking; the proofers were already in Cooking).
* **32 cards in all: Preparation 1 · Washing 1 · Cooking 21 (the stove + 20 fixed items) · Storage 3 · Refrigeration 6.**
  **70 published SKUs = 44 absorbed + 26 fixed; 49 SKUs are not published** (21 earlier exclusions: services, consumables, parts and
  architectural items, plus the 28 of ruling (b)). On a phone a category with a single card fills the row.
* Each configurator opens as a sheet with a live **preview image** at the top (see section 5), one control per option and
  nothing more, then the size, quantity and a note. Choices of four or fewer are segmented buttons; the stove has a
  burner-by-burner list (up to six positions, each with its own type chips and Remove) and add-ons as toggle chips. The first
  keyboard focus lands on the SELECTED option.
* The review sheet and the receipt show a configured line as its name, a labelled size ("L1000 × W500 × H850 mm") and its options
  in words ("2 sinks · left-aligned · with undershelf · without upper shelf · pre-rinse faucet"). An Edit opened from the review
  goes back to the review however the sheet is left (Save, Cancel, ×, Esc or the backdrop), and "Item updated." is shown after
  the review has reopened. A change of option hides a stale "already in your quote" prompt.
* **Sizes:** "Standard size" and the "Custom size" tag are relative to the usual size for the chosen options (a 2-sink table at
  1000 mm is its standard size, not custom). The stove's length follows its burners and add-ons until the visitor types a length
  of their own; "Reset to standard size" restores the usual size. An oven raises the depth and height to its minimums at once.
* **Phones:** the preview is compact (about 22 % of the screen, one caption line, the drawing's own text hidden; the same
  applies to any window under 640 px tall); on a landscape phone (under 520 px tall) and **whenever the on-screen keyboard is up**
  it shrinks to just its caption line so the field being typed into stays visible; the sheet body keeps every option heading
  clear of it when a control scrolls into view; a toast left over from the last action is cleared when the next sheet opens, a
  toast over an open phone sheet sits above its footer buttons, and over a desktop dialog it sits in the strip above it. In
  forced-colours (Windows high contrast) a selected segment or chip has a heavy system-colour outline.
* **Drafts:** a quote saved by the previous page (key `barro-qr-draft-v1`) is converted once: a fixed item stays; a SKU a family
  absorbed becomes that family at the closest configuration, **keeping the size it carried** (rounded to the 10 mm step and
  clamped to the family's limits; only a HARD rule, the sink length, or a forced minimum, the oven, raises it); an excluded or
  unknown SKU is dropped. ONE notice says everything that happened (converted, removed, reduced to the per-product limit) and
  is held back until no sheet is open (the homepage links open the intake at once). The old key is removed after a successful
  conversion. If the family scripts fail to load, configured lines are HELD, not destroyed: the stored draft is never written
  over and the visitor is told to reload. The new key is `barro-qr-draft-v2`.
* If any of the three new scripts fails to load the page still works: the picture is optional, and without the family files the
  plain items still quote.

### The options (exactly the owner's, nothing more)

| Family | Options | Size (mm, step 10; default = the primary SKU) |
|---|---|---|
| Preparation table | Layers 1 / 2 / 3 (2 = top + 1 undershelf, 3 = top + 2) · Upper shelves none / 1 / 2 | L 500–6000 (900) · W 400–1200 (600) · H 600–1100 (850) |
| Sink | Sinks 1–4 · Position centre / left / right · Undershelf with / without · Upper shelf with / without · Faucet gooseneck / pre-rinse | L 500–3500 (500) · W 400–900 (500) · H 700–1000 (850). **Hard rule: length at least 500 mm per sink** |
| Stove | Burner positions chosen one by one (1–6; wok, HP small, HP large, LP small, LP large, soup) · Add-ons griller / griddle / oven / fryer | L 400–3000 (600) · W 500–1000 (700) · H 400–1000 (850). **Guidance (soft):** the usual length is 400 mm plus 200 mm per burner, griller and griddle and 350 mm per fryer (calibrated to the catalogue stoves: 4 burners = 1200); it is pre-filled and may be changed; an oven raises the minimum depth to 700 and height to 850 |
| Cabinet | Type floor-standing / wall-hung · Doors swing / sliding · Shelves inside 1 / 2 / 3 | L 400–4000 (600) · W 300–1000 (500) · H 300–2200 (1800) |
| Wall shelving | Tiers 1 / 2 / 3 · Surface solid / slotted | L 300–3500 (1200) · Depth 250–600 (450) — no height |
| Rack | Tiers 3 / 4 / 5 / 6 · Wheels with / without | L 400–2000 (600) · W 400–1000 (500) · H 800–2100 (1600) |

The default of each family is exactly its primary SKU as sold, which is why the "standard" option adds nothing. Everything else (no
backsplash, casters, drawers, mount, grade or valve choices) is deliberately absent. **The 26 fixed items keep quantity, size
(existing caps) and a note only:** the master's ad-hoc option dropdowns are no longer offered on the PUBLIC sheet nor listed on
the cards (the three fixed items that had them are BA-006, BA-011 and CE-024; their estimate uses the standard option and a
visitor who wants another says so in the note). Internal data, the server's pricing of plain lines and the Quote Builder are
untouched.

## 2. Classification: absorbed, fixed or excluded — every SKU exactly once

Source of truth: `scripts/public-families.json` (families, absorbed SKUs, the fixed list; no prices) and
`scripts/public-categories.json` (`products` = the 70 published SKUs and their public category, `excludedProducts` = the 49
unpublished ones with the reason). `node scripts/build-catalogue.js` refuses the build if a master SKU is unclassified or a
published SKU is neither absorbed by exactly one family nor fixed. `ci-invariants` CHECK 10 and `tests/product-families.test.mjs`
prove it again (70 published = 44 absorbed + 26 fixed; 49 excluded; no SKU in two classes; the 28 ruling-(b) SKUs are
refused by the server).

| Family (card) | Primary (zero point) | Absorbed SKUs and the configuration each one maps to |
|---|---|---|
| **Preparation table** (Preparation) | PW-001 | PW-001 1 layer · PW-002 2 layers (movable) · PW-003 3 layers · PW-019 3 layers (back stopper) · PW-026 2 layers + 2 upper shelves · PW-032 2 layers + 1 upper shelf · BA-001 2 layers · BA-002 2 layers · BA-010 2 layers |
| **Sink** (Washing) | PW-004 | PW-004 1 sink, gooseneck · PW-005 1 sink · PW-006 2 sinks, pre-rinse · PW-007 2 sinks, pre-rinse (large) · PW-008 3 sinks · PW-009 2 sinks + undershelf, pre-rinse · PW-036 1 sink · PW-037 2 sinks + undershelf · PW-051 1 sink · BA-012 2 sinks + undershelf, pre-rinse |
| **Stove** (Cooking) | CE-001 | CE-001 1 LP · CE-002 2 LP · CE-003 3 LP · CE-004 4 HP large · CE-005 4 HP small · CE-006 1 wok · CE-008 2 LP + griller + griddle · CE-013 2 HP large + 2 soup · CE-014 4 HP small + oven · CE-015 2 HP large + 2 LP + griller + griddle · CE-017 2 HP large + 2 LP large · CE-018 1 soup · CE-025 2 wok · CE-027 3 LP · CE-029 2 LP + 2 HP large |
| **Cabinet** (Storage) | PW-015 | PW-015 floor, swing, 3 shelves · PW-038 same · PW-045 wall-hung, swing, 1 shelf · PW-046 wall-hung, swing, 1 shelf |
| **Wall shelving** (Storage) | PW-023 | PW-023 1 tier solid · PW-024 3 tiers slotted · PW-033 2 tiers solid |
| **Rack** (Storage) | PW-010 | PW-010 4 tiers on wheels · PW-030 4 tiers without wheels · PW-035 5 tiers without wheels |

### Final public list per category (32 cards)

* **Preparation (1):** Preparation table (absorbs 9 SKUs)
* **Washing (1):** Sink (absorbs 10 SKUs)
* **Cooking (21):** Stove (absorbs 15 SKUs) + **20 fixed:** meat grinder and slicer MS-015, MS-016 (moved here from Preparation) ·
  fryers CE-009, CE-020, CE-022 · grillers and griddles CE-007, CE-010, CE-019, CE-021, CE-023, CE-026, CE-028 · ovens CE-012,
  CE-016, CE-030 · steamer CE-011 · warmers and heaters CE-024, CE-031 · proofers BA-006, BA-011
* **Storage (3):** Cabinet (absorbs 4) · Wall shelving (absorbs 3) · Rack (absorbs 3)
* **Refrigeration (6) fixed:** RF-001 to RF-006

**Not published by ruling (b) (28 SKUs; reason recorded in `excludedProducts`):**

* **Preparation:** specialised tables PW-011, PW-017, PW-020, PW-021, PW-028, PW-039, PW-042, PW-050, BA-009 · oven stand BA-005
* **Washing:** sinks with cabinet PW-018, PW-022, PW-025 · dish table PW-029 · faucet PW-012
* **Storage:** specialised cabinets PW-014 (the UVC sterilising cabinet), PW-016, PW-031, PW-041, PW-047, PW-048 · racks, cooling
  racks and trolleys PW-027, PW-034, PW-049, BA-003, BA-004 · flour bin BA-007
* **Baking sheet pan BA-008:** dropped as a bakeware accessory rather than equipment

**Judgement calls to confirm (all reversible in the two JSON files, then `node scripts/build-catalogue.js`):** BA-008 (baking sheet
pan) dropped as an accessory; the oven stand BA-005 treated as a specialised stand/table and the flour bin BA-007 as a specialised
storage item; the faucet PW-012 as a washing item; the proofers BA-006 and BA-011 kept as fixed items in Cooking; the meat
grinder and slicer MS-015 and MS-016 moved to Cooking.

## 3. Pricing — server only, fail-closed

A configured line is priced **only on the server**: the family's primary SKU through the existing machinery
(`priceCatalogItem`, at the requested size) **plus signed option amounts** from the private sheet `product_pricing/{family}`.

* Sheet shape: per option value `{ flat, perW100 }` (an optional extra amount per 100 mm of length beyond the standard
  length; for the one family whose primary SKU has no length rule, wall shelving, the amounts scale with length in both
  directions and a separate `size.perW100` prices the length). The standard option needs no cell. A stove's burner
  positions are priced as the net difference from the standard layout. **A blank "per 100 mm" means the option does not depend
  on length (zero); enter an amount for options that grow with length.**
* **A blank amount is never zero.** Any blank in a chosen option makes the WHOLE line "priced after review": it is left out of
  the estimate and counted in the tray note ("1 item priced after review"), exactly like an unpriced SKU. The same happens
  when the family's sheet is missing, **not approved**, approved against another schema version, or unreadable. When every line
  of a basket is priced after review the tray says so instead of asking for more items. The response never contains a line
  figure, an option amount or the base price: the key set of the estimate response is pinned.
* **Hardening from the independent security review:** the sheets are read one document per family BY ID (a stray document
  cannot crowd a real sheet out); when the product master cannot be refreshed and a cached copy is served, the cached option
  sheets are NOT served (every family is "priced after review" at once, so an Unapprove is never undone by a failed read); a
  size basis that no longer matches the primary's formula, a custom depth or height the primary has no rate for, and a total at
  or below zero are all "priced after review" (never a partial figure); a soft-short stove body (six woks at 600 mm) is priced
  at its usual length with a staff warning; slot counts use null-prototype objects.
* Staff-side: the exact figure and how it was built (base at this size + options, or why it is not priced) live only in the
  staff-only `internal.lines[]` of the stored request (see open item 6).
* `js/pricing-core.js` gained ADDITIVE pure exports (`normalisePricingDoc`, `priceConfiguredItem`), mirrored byte-for-byte to
  `functions/` (CHECK 10). The four original exports are pinned by the SHA-256 of their source and by the frozen-oracle
  parity sweep against the old Quote Builder `computePrice`: SKU pricing and the Quote Builder are provably unchanged.
  `js/money-core.js` and `quote-builder-v2.html` have zero diff.
* Server validation is a strict allowlist from the same generated definition the page uses: only the keys
  `familyId, config, dims, qty, note`; every option key and value must exist with its exact type; sizes on the step and
  inside the caps; the sink length rule and the oven minimums are enforced; one family counts as ONE product for the 20-unit
  cap; own `__proto__` keys and the callable decoder's prototype trick are refused. The 49 unpublished SKUs, and the 44 absorbed
  ones, are refused as plain lines. `QR_DEF.VERSION` went 1 → 2, so a page loaded before the deploy is told to reload.

## 4. Staff side

* **Inventory › Family pricing** (`js/screens/family-pricing.js`; president, manager, finance, or a non-secretary member of the
  Finance department; never a partner or the secretary — mirrors the rules). One card per family: status (Not set up / Draft /
  Approved / Out of date), the amounts table with the confidence and a written derivation for each starting value, notes,
  **Save** (clears the approval), **Approve** (needs a saved sheet; writes only the approval fields), **Unapprove**, and a
  "Try a configuration" calculator that prices with the figures currently in the form. The **president-only "Import derived
  starting values"** reads the private seed file from his own computer and writes UNAPPROVED sheets.
  **Approve and Save are transactions:** each is valid only for the figures the editor was looking at; a sheet someone else saved
  meanwhile is NOT approved or overwritten, and the screen shows theirs. Unsaved amounts survive opening or closing another card,
  Approve stays disabled while edits are unsaved, a box holding unreadable text is invalid (never a silent blank), and Refresh
  drops every unsaved edit and note.
* **firestore.rules `product_pricing`:** finance tier read/create/update; never public, never partner; a new sheet starts
  unapproved and can only be created under one of the six family ids; an update that leaves `approved` true must name the
  writer's own uid as `approvedBy` and must not change the figures (`options`, `size`) in the same write, so every changed
  figure needs a fresh approval; `approved` must be a real boolean; delete refused for everyone.
* **Sales › Quote requests:** a configured line shows the family name ("Configurable" badge), every chosen option and the
  size; staff-only: the catalogue base item and the exact figure, or how it was built, or why it is not priced. The client copy
  shows no figure and no base item. **Open in Quote Builder** maps a configured line to its primary SKU named "… (configured)"
  with the options and size in the description and **always as a manual price** (a priced line keeps its figure; an unpriced
  one opens at zero for staff to price — the builder's auto-pricer can never put the bare SKU's price on a configured product).
  The Quote Builder itself is untouched (its tutorial contract does not apply).

## 5. Preview images (placeholders now, photos later)

Every configurator shows a ~4:3 preview contained on a soft neutral ground with a short cross-fade (none under
`prefers-reduced-motion`). `scripts/configurator-previews.json` maps combination keys to photos; with `images` empty (as
shipped) a generated inline-SVG placeholder shows: navy line art of the product that follows the current choice, the family
name in the serif, the chosen options in small text (wrapped to at most three lines of 46 characters, a long part broken between
words) and a muted "Preview image coming soon" (the stove is a top view of the burners in order with W / HP / LP / S circles and
add-on blocks, an add-on name squeezed to its block when there are many). No external request, no price.

Keys and fallbacks match the owner's shot list `docs/configurator-preview-photo-list.md` exactly (60 file names, 17 priority-1):
preparation table `prep_table-layers-{1|2|3}-upper-{0|1|2}` (falls back to `…-upper-0`); sink
`sink-basins-{1..4}-under-{yes|no}[-upper-yes][-align-{left|right}]` (exact → without alignment → without the upper shelf →
`sink-basins-N-under-yes`; optional faucet close-ups `sink-faucet-{prerinse|gooseneck}`); stove photo `stove-burners-{N}`
with the live burner diagram kept, optional `stove-addon-{oven|griller|griddle|fryer}` and `stove-burner-{wok|hp|lp|soup}`;
cabinet `cabinet-{floor|wall}-{swing|sliding}` (→ `-swing`); wall shelving `wall_shelf-tiers-{1|2|3}-{solid|slotted}`
(→ `-solid`); rack `rack-tiers-{3..6}-wheels-{yes|no}` (→ `rack-tiers-4-wheels-{same}`). Size never changes the picture.

**To add a real preview photo** (no code change):

1. Shoot to the shot list (4:3, at least 1600 × 1200, plain background, the same angle for one product).
2. Save a WebP named exactly by the key as `site/img/configurator/<family>/<key>.webp` (1600 × 1200 or larger) and a thumbnail
   of the same shape, about 400 px wide, beside it as `<key>-thumb.webp`.
3. Add one line under `images` in `scripts/configurator-previews.json`, for example
   `"sink": { "sink-basins-2-under-yes": "site/img/configurator/sink/sink-basins-2-under-yes.webp" }`.
4. Run `node scripts/build-catalogue.js`. It refuses a key that uses an option value the family does not have, a path other than
   the one above, a missing file or thumbnail, or a file that is not a readable WebP; otherwise it bakes the manifest into the
   catalogue's data island. Then the three gates, a commit (the hook bumps the version) and `release.sh push`.

The photos are lazy-loaded and are never precached (CHECK 9 and the service worker's PRECACHE guard).

## 6. Starting values: what the master supports (no figures here)

`node scripts/derive-family-pricing.js` reads the local private master and writes the PRIVATE, gitignored
`private/family-pricing.seed.json` (every option value with its derived amount, the derivation — which SKUs, which rule — and
a confidence, or BLANK). It prints statuses and confidence only, and refuses an output path inside the repository other than
`private/`. Evidence rules: the master's own option adder, or two SKUs that differ in exactly the option compared at one size;
extrapolations, proxies and layout choices stay BLANK with the candidates written in the note. **12 of 34 amounts are derived,
22 are blank.**

| Family | Derived (confidence) | Blank (no usable evidence) |
|---|---|---|
| Preparation table | 3 layers (low; the PW-001 / PW-003 pair the owner prescribed, the bakery table adder conflicts) · 2 layers (low; interpolated) · 1 upper shelf (medium; master adder) | 2 upper shelves |
| Sink | 2 sinks (low; the master adder is cross-checked against the double-sink SKUs, which conflict) · pre-rinse faucet (high; two adders agree) | 3 sinks · 4 sinks · position left / right (layout, suggested 0) · undershelf · upper shelf |
| Stove | LP small burner (medium) · wok (low) · HP large (low) | HP small · LP large · soup · griller · griddle · oven · fryer |
| Cabinet | — | wall-hung · sliding · 1 shelf · 2 shelves |
| Wall shelving | 3 tiers (low) · 2 tiers (low; interpolated) · the length rate (low; list price per 100 mm of standard length, proportional assumption) | slotted surface |
| Rack | without wheels (low; the bread rack's feet-versus-casters adder) | 3 tiers · 5 tiers · 6 tiers |

Data anomalies flagged in the private file for the owner: PW-005 and PW-036 carry the same list price at different default
lengths; PW-015 and PW-038 carry the same list price at very different sizes; the bakery tables BA-001, BA-002 and BA-010
price noticeably above the preparation-table model (see open item 2). The wall-shelving 3-tier amount comes from PW-024
(3 tiers, slotted) against PW-023 (1 tier, solid), so the slotted premium sits inside the tier amounts: when "slotted" is priced
separately, lower the tier amounts to avoid counting it twice.

## 7. Verification (all local; FAKE figures everywhere)

* **Three gates:** `node --test tests/*.test.mjs && bash scripts/ci-invariants.sh && node scripts/check-ui-wiring.js` — **1214 tests,
  0 failures**; all invariants pass and there are no wiring defects. In the shared tree the single expected exception before the
  hook runs is the PRECACHE MANIFEST check (three new PRECACHE entries). The **scratch hook-commit proof** (a copy of the repo
  WITHOUT the private master and the private seed, a real `git commit` through `.githooks/pre-commit`) bumped 14.0.317 → 14.0.318,
  derived `CACHE_VER` (`bi-ops-v14.0.318`), regenerated `precache-manifest.json` (83 entries, the three new files included) and
  then passed all three gates with exit 0 (1209 tests pass; the 4 "local only" checks that need the private master skip, as they do
  in CI). Nothing was committed or pushed in the shared tree.
* **New suites:** `product-families`, `family-page`, `family-staff`, `derive-family-pricing`, plus additions to `pricing-core`,
  `quote-request`, `quote-request-callables` and `catalogue-public`.
* **Mutation testing** (scratch copies only; 137 mutations over pricing, families, build, classification, server, rules, staff
  screens, public page, preview, CSS and derivation, each applied alone): every one is caught by at least one test. Gaps found
  along the way were closed with new tests (an extra allowed field on a configured line, a clash-lowering-confidence rule, a
  stored-name check, a basket hash ignoring the configuration). This round's mutations include: an edit that no longer returns to
  the review · a toast shown before the review reopens · a stale duplicate prompt · the length memory · the oven minimums · held
  draft lines destroyed · the old key removed while lines are on hold · the keyboard class · forced colours · the desktop toast ·
  the single-card layout · typed-but-unsaved amounts lost · unreadable text saved as blank · Save overwriting a stale sheet · the
  client copy naming the base item · a configured line without `priceManual` · unwrapped preview text · an excluded id in the
  server allowlist or in the fixed list.
* **Real Firestore emulator** (the Firebase emulator on a JRE found on this machine): the real `firestore.rules` against
  `product_pricing` over REST with unsigned-JWT identities for ten roles — **96 checks pass**, and 11 rule mutations (read opened
  to any signed-in user, partners allowed, created already approved, delete allowed, approver not named, figures or length rate
  changeable while approved, `approved` not a boolean, id not validated, update opened to everyone, finance tier widened) are all
  caught. The real `functions/index.js` callables with the real `firebase-admin` on the emulator, seeded with FAKE odd figures:
  **86 checks pass** — configured sink / stove / prep table estimates equal an independent BigInt re-derivation of the range; an
  unapproved family, a stale-schema sheet, an absent sheet and a blank amount are "priced after review"; invalid shapes are
  refused (including the decoder's prototype trick); **every excluded SKU (a faucet, the UVC cabinet, a special table, the baking
  sheet pan, a specialised rack) that exists in the master is refused as a plain line**; fixed items still estimate; submit
  stores the options, size and build-up and no fake figure reaches any response or notification; approving / un-approving a
  sheet flips a family between priced and after-review; a failed products read never serves cached sheets; 80 stray documents in
  `product_pricing` do not disturb the real sheets.
* **Browser (against the emulator-backed scratch server and in `?mock=1`):** the catalogue (all five categories) and all six
  sheets at 375 and 1440 px, no horizontal scroll, the sink sheet in two option states showing the preview change, the tray, the
  review sheet and a real submission. A scripted check focuses every control forwards and backwards on all six sheets at
  375×812, 375×667, 320×568, 414×896 and on landscape / short windows: **no option heading is ever hidden behind the pinned
  preview**; the preview is 21–22 % of a portrait phone screen; no tap target under 44 px at 320 and 360 px; keyboard-only
  operation; Esc / × / Cancel / Save from an Edit all return to the review exactly once with the toast visible; the focus lands
  on the selected option; the oven raises depth and height at once; a typed length survives a burner being added; Reset restores
  the usual size; the duplicate prompt hides on a change. Screenshots are in the session scratchpad (`shots-config/`,
  `shots-config/interim/`), not in the repo.
* **Independent reviews:** a security review (probes against the real callables, the rules in the emulator) and a functional /
  UX / accessibility review (Chromium and WebKit) of the uncommitted tree. Every finding is dispositioned in section 9.

## 8. Deploy steps (in this order)

1. `node scripts/build-catalogue.js` (idempotent) and the three gates. Commit through the hook (never `--no-verify`).
2. **Rules first:** `bash scripts/release.sh rules` (adds `product_pricing`, no composite index is needed; `firestore.rules` is 134,749
   bytes, under the 262,144 cap).
3. **Functions:** `release.sh`'s functions hash covers only `index.js` and `package.json`, so deploy by name:
   `firebase deploy --only functions:qrStartSession,functions:qrEstimate,functions:qrSubmit,functions:qrAdminDelete`, then
   `bash scripts/release.sh record functions`. (`cirSubmit` is unaffected.) The deploy carries the regenerated
   `functions/qr-published.json` (26 fixed ids), which is what refuses the 49 unpublished SKUs.
4. `bash scripts/release.sh push`, then `release.sh verify` and a smoke test of `/catalogue/`: 32 cards (Preparation 1, Washing 1,
   Cooking 21, Storage 3, Refrigeration 6), a sheet opens, two lines add, the tray shows "priced after review" until the sheets
   are approved.
5. **Owner, once, in the app** (Inventory › Family pricing, via All Departments › Inventory): **Import derived starting values**
   (president; pick `private/family-pricing.seed.json` from this computer), review every figure, fill the blanks, then **Approve
   each family**. Until a family is approved, its configured lines are simply "priced after review"; the public page keeps
   working. The sheets are read with the product master and cached per function instance for up to 10 minutes, so an Approve,
   Unapprove or edit reaches the public estimate within about ten minutes (a redeploy forces it at once). The kill switch
   `productMeta/config.quoteRequest.estimateEnabled=false` is unchanged.

## 9. Open items, judgement calls and review dispositions

**Owner rulings wanted**

1. **CE-008** (griller-griddle combi with two LP burners) is absorbed into the stove; keep it fixed if you prefer.
2. **BA-001, BA-002, BA-010** (bakery worktables) are absorbed into the preparation table; their list prices sit about 63–85 %
   above what the preparation-table model gives, so Finance should decide whether they stay absorbed.
3. **Ruling (b) judgement calls** (section 2): BA-008 dropped as an accessory; BA-005 oven stand and BA-007 flour bin excluded as
   specialised items; PW-012 faucet excluded as a washing item; BA-006 / BA-011 proofers stay fixed in Cooking; MS-015 / MS-016 moved
   to Cooking.
4. The stove module widths (200 mm per burner, griller and griddle; 350 mm fryer; 400 mm allowance) and the sink rule of 500 mm
   per sink are **proposed dimensions to confirm** (the stove widths are calibrated to the catalogue stoves).
5. **Who may approve a sheet.** Today any finance-tier user (president, manager, finance, or a Finance-department employee) may
   edit AND approve, including their own figures; the approver's uid is recorded and any edit clears the approval. If approval
   should be the president's alone, one condition in the rules and one in the screen does it.
6. **Option amounts are visible to Sales.** The staff-only `quote_requests.internal` record stores, for each configured line, the
   base price and each option's amount, and `quote_requests` is readable by every non-partner employee (it already holds the
   exact list totals); the Sales screen shows "Base + options". That bypasses the finance-tier privacy of `product_pricing` cell by
   cell. If the amounts should stay finance-only, the build-up must move to a finance-tier subdocument and the Sales screen show
   only the line figure. Not changed: it needs your ruling on the tier (security review H1).

**Accepted as they are (documented)**

7. 22 of 34 amounts are blank, so many configurations stay "priced after review" until Finance fills them; every family is
   unapproved until the owner approves it. A blank "per 100 mm" means no length dependence (zero).
8. Previews are placeholders until photos arrive (section 5). On a desktop-height window the pinned preview stays at 30 % of the
   window height; a phone gets the compact one.
9. The Quote Builder has no configurator: a configured line opens there as its primary SKU with the configuration in the
   description (configurator support in the builder is a later step). The master carries the data anomalies listed in section 6.
10. The three fixed items BA-006, BA-011 and CE-024 lose their public option dropdowns (fixed items are quantity + size + note
    only); a draft that had chosen one of those options silently falls back to the standard option.
11. The public estimate is still a rounded range of the whole basket behind the minimum-basket gate (ruling R1, unchanged). Measured
    by the security review: once a primary's price is known, one option amount can be recovered in about 7–9 adaptive probes
    (varying quantity and length) — the same exposure the live estimate already has for plain list prices; the rate limits, the
    gate and the kill switch are unchanged. The estimate's counts ("priced" / "after review") also show whether a family is
    approved and which cells are blank. A basket of 20 stoves with six woks multiplies one cell by 120; the cell cap (±100 million)
    and the rounding still apply.
12. Option amounts are not scaled by the material price index (`materialPriceIndexMultiplier`): the derived starting values embed
    the multiplier of the day they were derived; re-derive or re-enter after an index change.
13. The rules do not constrain the display fields `approvedByName` and `approvedAt` (the approver's uid, `approvedBy`, is enforced),
    and `schemaVersion` can be changed while a sheet stays approved; both need a finance-tier user, who is trusted to edit the sheet.
14. Family Pricing sits under Inventory, whose nav item is gated on the Production department for non-admins: the president and
    managers reach it through All Departments; a Finance-department member the rules allow may have no route to it.
15. Import replaces whole sheets (the confirmation says so) and has no "fill blanks only" mode; it is a one-time president action.
16. A v2 draft is not migrated if more SKUs are absorbed later (a family line that breaks a later-tightened rule is dropped, not
    raised); choosing Wall-hung keeps the 1800 mm floor-cabinet height until changed; if a family's primary SKU document were
    missing in Firestore every line of that family would be "no longer in the catalogue" while the card still offers Configure.
    When a photo is shown beside the placeholder diagram on a phone the diagram card is small.

**Independent review dispositions.** Security review: no blocker; **H1** open (item 6); **M1** fixed (stale cache never serves
sheets); **M2** fixed (Approve and Save are transactions) with self-approval open (item 5); **M3** fixed (a custom depth or height
the primary has no rate for is "after review"); **M4** documented (item 7); **L1, L2, L5, L8, N3, N4, N5** fixed (missing base
rates, soft-short stove body, sheets read by id and created only under the six ids, runtime size-basis check, zero totals,
null-prototype nets and `measurement` first, derive output path and parse error); **L3, L4, L6, L7, N1, N2** accepted (items
11–13). UX review: **H1** (keyboard) and **H2** (builder auto-pricing) fixed; **M1–M7** fixed (notices held until no sheet is open,
one combined notice, saved sizes kept, configured lines held when scripts fail, forced colours, unsaved amounts kept, approvals
bound to the figures seen); the **21 low findings** fixed except the v2-migration note, the import mode and the approval display
fields (items 13, 15, 16); the derive script's wording and the public readme no longer name the private collection.

## 10. STATUS.md draft (not applied; paste or adapt)

> **2026-10-21 — Public product configurator + owner ruling (b) (BUILT, verified locally, NOT committed/deployed).** The catalogue's six configurable products (preparation table, sink, stove, cabinet, wall shelving, rack) are one card each with a "Configure & add" sheet (options exactly as ruled, live preview image — generated placeholders until photos are supplied, shot list `docs/configurator-preview-photo-list.md`); the 44 SKUs they absorb are no longer cards. **Ruling (b):** Preparation, Washing and Storage show ONLY the configurable products; 28 specialised SKUs are excluded in the build (`scripts/public-categories.json`; master and Quote Builder untouched); 70 published = 44 absorbed + 26 fixed, 49 excluded; **32 cards** (Preparation 1, Washing 1, Cooking 21, Storage 3, Refrigeration 6); the server refuses excluded ids (`functions/qr-published.json`, 26 ids). Pricing is server-side only: primary SKU at the requested size + signed option amounts from the private `product_pricing/{family}` sheet (finance tier, approve per family, blank amount / unapproved / stale sheet = "priced after review", never zero, no figure in any response). New: `scripts/public-families.json` (source of truth), `js/product-families.js` + generated `js/qr-families.js` (mirrored to `functions/`, CHECK 10), `js/qr-preview.js`, `js/screens/family-pricing.js` (Inventory › Family pricing; president-only import of `private/family-pricing.seed.json` written by `scripts/derive-family-pricing.js`), additive `pricing-core` exports, `product_pricing` rules, `QR_DEF.VERSION` 2, draft key v2 with v1 migration. Review doc `docs/reviews/2026-10-21-configurator.md` (classification, options, derivation summary, how to add preview photos, verification, review dispositions, open items). **Deploy order:** commit through the hook → `release.sh rules` → selective deploy `qrStartSession,qrEstimate,qrSubmit,qrAdminDelete` + `release.sh record functions` → `release.sh push` → owner imports the starting values and approves each family.

**Pending-actions entry:** `- [ ] Deploy the public configurator (rules → qr* functions → push), then owner: Inventory › Family pricing → Import derived starting values → review → Approve each family.`

**Open rulings entry:** configurator items 1–6 in section 9 (CE-008 and the bakery tables absorbed; ruling-(b) judgement calls; proposed stove widths and sink rule; who may approve; option amounts visible to Sales).
