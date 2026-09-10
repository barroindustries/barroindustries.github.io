# QB-IMPORT-NOCOSTING-SPEC-2026-09-11

Owner request (Neil, 2026-09-11):
1. Quote builder: **import items from a raw file** — he'll hand any list to Claude, Claude
   produces a raw file in a format we define, he imports it and the items are added to the
   quote. Complete details supported, but every field except the name may be blank and
   everything stays editable after import.
2. **"No costing" option beside the costing** on a line — an explicit way to say "this line
   doesn't need a cost basis", clearing the needs-costing warning and the filing block.

All work is in `quote-builder-v2.html` (single self-contained file, ~7.9k lines) plus one new
doc `docs/QB-IMPORT-FORMAT.md` and a STATUS.md note. No Firestore rules, no app.js, no money-core.

Anchors below are `grep`-able strings, not line numbers — the file shifts.

---

## Part 1 — the import file format (`barro-qb-import` v1)

JSON. One object:

```json
{
  "format": "barro-qb-import",
  "version": 1,
  "sections": [
    {
      "label": "Option A — Full Kitchen",
      "items": [
        {
          "name": "Stainless Prep Table",
          "specs": "SS304 1.2mm top, undershelf",
          "dims": "L1200 × W600 × H850 mm",
          "qty": 2,
          "unit": "pc",
          "unitPrice": 25000,
          "leadTime": "3 weeks",
          "notes": "client to confirm height",
          "noCosting": false,
          "costing": {
            "materialsLump": 12000,
            "bom": [ { "material": "SS sheet 4'x8' 1.2mm 304", "qty": 2, "unitPrice": 3500 } ],
            "laborDays": 1.5
          }
        }
      ]
    }
  ],
  "items": []
}
```

Parser tolerance rules (implement exactly):
- Accept any of: a bare **array** of item objects; `{items:[…]}`; `{sections:[…]}`; both keys
  together (top-level `items` are section-less). `format`/`version` keys are OPTIONAL and not
  validated (warn if `format` present and ≠ `"barro-qb-import"`, but still import).
- **`name` is the only required field.** An item whose name is missing/blank after trim is
  SKIPPED and counted in the warnings. Everything else may be absent, `null`, or `""`.
- `specs` may be: a string; an array of strings (join with `" • "`); or an array of
  `{label, value}` objects (render each as `label: value`, join `" • "`). Lands in
  `item.specEdit` (the custom-line spec text), `item.specs` stays `[]`.
- `qty`: `Math.max(1, parseInt(v)||1)`. `unit`: default `'pc'`. `unitPrice`: `Number(v)`; if a
  finite number > 0 was given, set it AND `priceManual:true` (a price from Neil's list must
  stick — the auto-pricer skips manual lines). Absent/blank/0 → `unitPrice:0`, no
  `priceManual`, so a line with costing data auto-prices itself via the existing
  `applyComputedPricing()` (no new code — verify it happens in Internal view).
- `leadTime`, `notes`, `dims`: plain strings, trimmed; absent → `''` (leadTime `''` like
  addCustomItem, NOT `'—'`).
- `noCosting`: truthy → `item.noCosting = true` (Part 3).
- `costing` (optional object): `materialsLump` (finite ≥0) → `item.costMat`;
  `laborDays` → `item.costLaborDays`; `laborHours` → `item.costHrs`;
  `bom` array → `item.bom = rows.map(r => ({name:String(r.material??r.name??'').trim(), qty:Number(r.qty)||0, unitPrice:Number(r.unitPrice)||0, src:'import'}))`,
  dropping rows with no name. Only set fields that were actually given — an absent
  `materialsLump` must NOT create `costMat` (the `undefined`-means-never-entered contract in
  `updateCustomCost` applies). Always give the item a `bom` array (empty if none) to match
  `addCustomItem()`'s shape.
- Numbers that fail to coerce → treated as absent, one warning line each.
- Cap: more than **200 items** total → refuse with a clear message (no partial import).
- Strings are stored RAW (trimmed only). Rendering already escapes via `txtEsc`/`attrEsc` —
  do not double-escape. NEVER innerHTML any string from the file into the preview without
  `txtEsc()`.

Every imported item is a standard custom line, exactly `addCustomItem()`'s shape:

```js
{ id:'CUSTOM', category:<see Part 2.5>, name, dims, specs:[], specEdit, qty, unit,
  unitPrice, amount:unitPrice*qty, leadTime, notes, laborHours:null, formulaType:'fixed',
  bom:[…], /* + costMat/costLaborDays/costHrs/noCosting/priceManual only when given */ }
```

## Part 2 — Import UI

1. **Button** — in `#productSearchRow` (anchor: `onclick="addSection()"`), after the
   ＋ Section button:
   `<button class="btn btn-outline no-print" id="btnImportItems" style="background:var(--mid-blue);white-space:nowrap;" onclick="openImportModal()" title="Import items from a JSON file (ask Claude to make one — 📋 format inside)">📥 Import</button>`
2. **Partner lockout** — in `applyPartnerMode()` (anchor: `document.getElementById('btnOpenProductDb')?.remove();`)
   add `document.getElementById('btnImportItems')?.remove();`. Also guard every new function
   with `if(PARTNER_MODE) return;` (belt-and-braces, same as `updateCustomCost`). Internal
   staff keep the button in every view/company (imported costing data simply has no UI under
   BS — that's existing behavior, fine).
3. **Modal** — copy the `bomModal` pattern (anchor: `id="bomModal"`), new
   `id="importModal"`, `z-index:2600`, `max-width:640px`, title `📥 Import items`. Body
   (static HTML, ids for JS):
   - one-line explainer: "Hand Claude any list (photo, Excel, text) with the format spec below;
     import the JSON file it gives back. Only the item name is required — everything else can
     be blank and edited after."
   - `<button onclick="copyImportSpec()">📋 Copy format spec for Claude</button>` — copies
     `QB_IMPORT_SPEC_TEXT` (a JS const, Part 4) via `navigator.clipboard.writeText` with a
     `document.execCommand('copy')` textarea fallback; toast on success/failure.
   - `<input type="file" id="importFileInput" accept=".json,application/json,.txt" style="display:none" onchange="handleImportFile(this)">`
     plus a visible button that clicks it, AND a `<textarea id="importPasteBox">` ("…or paste
     the JSON here") with an oninput debounce (~300ms) that parses.
   - `<div id="importPreview">` — after a parse: item count, section count, a scrollable list
     (`txtEsc`'d name — qty × unit — price or "auto" or "no price"), and a warnings list
     (skipped rows, ignored values). On parse error: the error message, import disabled.
   - Footer: `<button class="btn btn-green" id="importApplyBtn" disabled onclick="applyImport()">Add N items to quote</button>`
     + Cancel. The N updates from the parse.
4. **Functions** (put them near `addCustomItem()`; all `no-print`/internal concerns above):
   - `openImportModal()` / `closeImportModal()` — display flex/none, clear state on open.
   - `handleImportFile(input)` — `FileReader.readAsText`, then `parseImportText`.
   - `parseImportText(text)` — implements Part 1; stores result in a module-level
     `_importParsed = {sections:[{label, items:[…normalized]}], warnings:[…]}` (section-less
     items under a `label:null` pseudo-section); renders the preview; enables the button.
   - `applyImport()` — Part 2.5, then `ensureItemUids(); saveToStorage(); renderItems();
     showToast('📥 Imported N item(s)'); closeImportModal();`. Items APPEND — never replace.
5. **Section mapping** (`applyImport`):
   - `label:null` items → `category = currentCatFilter!=='all' ? currentCatFilter : 'miscellaneous'`
     (mirror `addCustomItem()` exactly).
   - A labeled section: compare trimmed label case-insensitively against every existing
     section's `sectionLabel(catId)` over `sectionKeys()`; match → reuse that `catId`
     (do NOT set `catLabel` on the new items when the match is a database category);
     no match → `const newId = nextSectionId()` ONCE per section, every item in it gets
     `category:newId, catLabel:<label>`. Compute each new section's id BEFORE pushing its
     items (nextSectionId scans `items`).

## Part 3 — "No costing" option on a custom line

New additive flag `item.noCosting` (persists free via `bkqb_items` wholesale serialization).

1. `customCostParts()` (anchor: `const chip = uncosted`): render, beside the existing
   chip/gate button inside `rowHtml`'s flex row, a checkbox:
   `<label class="no-print" style="display:inline-flex;align-items:center;gap:3px;font-size:10.5px;color:var(--gray-dark);cursor:pointer;" title="Tick when this line intentionally has no cost basis — clears the needs-costing warning and the filing block."><input type="checkbox" ${item.noCosting?'checked':''} onchange="toggleNoCosting(${idx},this.checked)">no costing</label>`
   Chip logic becomes three-state: costed → no chip (unchanged); uncosted && noCosting →
   neutral chip `<span class="ms-chip" style="background:#eee;color:var(--gray-dark);">no costing</span>`;
   uncosted && !noCosting → existing warn chip. The 🧮 button and workspace stay available
   either way (entering a real basis later simply makes the flag moot).
2. New `function toggleNoCosting(idx, on){ if(PARTNER_MODE) return; const it=items[idx];
   if(!it||it.id!=='CUSTOM') return; if(on) it.noCosting=true; else delete it.noCosting;
   saveToStorage(); renderItems(); }` — `renderItems()` already re-runs
   `computeMarginSummary()`→`refreshBomModal()` in Internal view.
3. `uncostedCustomLinesReason()` (anchor: `items.filter(i=>i.id==='CUSTOM' && !customLineHasMaterialsBasis(i))`):
   add `&& !i.noCosting` — a flagged line no longer blocks filing.
4. Cost & Margin panel + OH-per-item table: wherever a CUSTOM line currently shows the warn
   "needs costing" chip (anchor: the `needs costing` occurrences near `renderTrueCostPanelHtml`
   and the `needsCostingChip` const), show the neutral "no costing" chip instead when
   `item.noCosting` && no basis. Do NOT touch the catalog-item chip (the one pointing at
   Inventory → Product Pricelist).
5. **Explicitly unchanged:** `itemCostBasis()`, `computeTrueCost()`, `applyComputedPricing()`,
   `customLineHasMaterialsBasis()` — a no-costing line has mat 0 and contributes nothing;
   the 80%-labor assumption on 0 materials is 0. Do not add branches there.

## Part 4 — format spec text + doc

1. JS const `QB_IMPORT_SPEC_TEXT` (plain string near the import functions): a prompt-ready
   brief for Claude — "Convert the list I give you into a Barro quote-builder import file.
   Output ONLY valid JSON, no markdown fences…", the schema of Part 1 in compact form, the
   rules (only `name` required; NEVER invent prices/costs/specs — leave unknown fields out;
   put uncertainties in `notes`; `noCosting:true` for lines that shouldn't carry a cost
   basis; group into `sections` only when the source list is grouped), and one minimal + one
   full example.
2. `docs/QB-IMPORT-FORMAT.md` — the same content in readable Markdown (state it mirrors
   `QB_IMPORT_SPEC_TEXT`; keep the two in sync).

## Part 5 — tutorial contract (mandatory, per .claude/skills/quote-builder-tutorial)

- `TUTORIAL_VERSION` 31 → **32**.
- Prepend `WHATS_NEW`: `{ ver:32, date:'2026-09-11', items:[
    '📥 Import items — hand Claude any list (photo, Excel, plain text), get back a small file, and the Import button on the Estimator adds every item to the quote in one go. Only the item name is required; blanks stay editable. The 📋 button inside copies the exact format brief to give Claude.',
    '"No costing" tick — a custom line that genuinely has no cost basis (a pass-through, a client-supplied unit) can now be marked no costing beside its Cost gate; the needs-costing warning clears and the quote can file.',
  ]}`.
- Update the **Add items** bullet in `#helpBody` (anchor: `➕ Custom item for non-catalog work`)
  and the matching `TOUR_STEPS` estimator step body (anchor: `Picking a product opens a
  calculator`) to mention 📥 Import and the no-costing tick. No new tour step; re-grep every
  `TOUR_STEPS` target id still resolves.

## Part 6 — verification & gates

1. `node --test tests/*.test.mjs && bash scripts/ci-invariants.sh && node scripts/check-ui-wiring.js` — all green.
2. Serve (`launch.json` config `quote-builder`, port 3737), open `quote-builder-v2.html`,
   Internal view: no console errors; drive `parseImportText()` + `applyImport()` directly with
   a 3-item sample (one full, one name-only, one `noCosting` + no price) via the paste box;
   confirm rows render, blanks editable, the costed-no-price line auto-prices, filing gate
   ignores the flagged line, checkbox toggles the chip; screenshot for Neil.
3. Refresh → imported items + `noCosting` survive the draft restore.
4. Repo hygiene: NEVER `git stash`/`reset --hard`/`checkout --`/`clean`. If `Edit` hits the
   OneDrive "modified since read" race twice, switch to a python exact-match replace script
   (or desktop-commander `edit_block`). Do not commit — the main session reviews, commits
   (hook bumps the version), updates STATUS.md, and pushes.
