# COSTING PHASE 1 — Quote Builder true costing (shadow mode) + partner isolation

**Date:** 2026-08-26 · **Author:** Fable (spec) → Sonnet (implementation) · **Approved by:** Neil ("lets apply these rules in the system")
**Scope:** `quote-builder-v2.html` ONLY. One file, one builder. No other file may be edited.
**Design source:** the costing blueprint (analysis artifact) + prototype approved by Neil 2026-08-26. Decision register DC1–DC8 applied at recommended defaults.

## What this phase ships

Shadow-mode true costing inside the Quote Builder's **Internal** view, the custom-item costing gate, and closure of the cost-data leak into filed quotes. It does NOT change any customer-facing price, any filed total, or anything a partner sees. Catalog `computePrice()` and `computeTotals()` are UNTOUCHED.

## Hard rules (violating any of these = stop and escalate)

1. **NEVER run `git stash`, `git reset --hard`, `git checkout -- <file>`, or `git clean`.** Concurrent sessions edit this tree live. Read baselines with `git show HEAD:quote-builder-v2.html` if needed.
2. **Do not edit any file except `quote-builder-v2.html`.** No index.html, no sw.js, no config.js (version/cache are auto-bumped by the pre-commit hook at commit time — not your concern), no firestore.rules.
3. **Do not commit or push.** Leave changes in the working tree; the main session reviews, commits, pushes.
4. **All new UI must be invisible and absent (not hidden — absent from the DOM) in partner mode.** See §Partner isolation.
5. Line numbers below are from a 2026-08-26 audit; the file evolves — re-locate each anchor by searching for the quoted identifier, never trust the number blindly.
6. Additive changes only: do not rename, reorder, or restructure existing functions, item schemas, or postMessage message shapes.

## Existing anchors (verify each before use)

| What | Anchor | ~Line |
|---|---|---|
| Partner mode flag | `PARTNER_MODE = ` (reads `?portal=partner`) | 1916 |
| Partner DOM removal | `applyPartnerMode()` — `.remove()`s `#btnInternal`, `#costMarginWrap` | 1957–1963 |
| DB load + cost read | `loadDatabase()`; `product_costs` read gated `if (!PARTNER_MODE)` | 1770–1890, 1811–1819 |
| Price engine (DO NOT TOUCH) | `computePrice(p)` | 2926–2981 |
| Quote totals (DO NOT TOUCH) | `computeTotals(subset)` / `totalsLines()` | 3321–3358 / 3414 |
| Cost/margin panel (REPLACE CONTENTS) | `computeMarginSummary(laborEst)` | 4230–4262 |
| Labor estimator (reuse) | `buildLaborTable` / `autoEstimateLabor` / `computeLaborTotal` | 4166–4229 |
| Items carry cost fields (LEAK) | item push sites with `capitalMaterials` | ~2744, ~3064 |
| File payload (STRIP HERE) | `buildQuotePayload` → `items: items` | ~5356 |
| Existing approval checkbox | `#reqApprovalCheck` | ~5136 |
| Verify & File | `doVerifyAndFile()` / `#btnVerify` | ~855 |
| Company registry / D14 | `CO` registry; Brilliant Steel keeps cost visibility, PT never | 1561–1640 |

## 1 · Costing settings doc

Read `product_costs/_settings` in the same non-partner branch that already reads `product_costs` (extend the existing `costSnap` fetch or add a doc get beside it — one read, cached in a module global `COSTING_SETTINGS`). Rules already gate `product_costs/{id}` to finance/admin, and the read already only happens when `!PARTNER_MODE`, so partners never fetch it. If the doc is missing or the read fails, use these defaults (also the doc's initial shape):

```js
{
  wastePct: 0.06,          // materials waste allowance
  consumablesPct: 0.08,    // of direct labor
  loadedLaborRate: 150,    // ₱/h — wage grossed up for utilization; NOT settings/laborRates
  baseOH: 0.25,            // OH pool ÷ target monthly direct cost (DC1, DC2)
  sizeBands: [[80000,1.5],[200000,1.3],[400000,1.15],[800000,1.0],[1600000,0.85],[null,0.7]],
  ohMin: 0.10, ohMax: 0.45, // DC3 clamps
  targetMargin: 0.20,       // DC6, margin on price
  updatedAt: null           // server timestamp when a later phase adds the editor
}
```

Do NOT write this doc from the quote builder (writes are a later President-screen phase); read-only with in-memory defaults. Never place any of these values in `productMeta/config` (partners can read that).

## 2 · Internal cost panel v2 (replaces the body of the margin summary)

All rendering stays inside the existing `#costMarginWrap` container (already `.remove()`d for PT partners) AND every new render call is additionally guarded `if (PARTNER_MODE) return;`. Brilliant Steel (BS) keeps visibility per the standing D14 ruling — BS is not PARTNER-blocked from Internal today; preserve exactly the current BS behavior.

Compute (pure function, no Firestore reads at render time):

```
materials  = Σ item.capitalMaterials×qty  (live values; product_costs-backed for catalog items)
matWaste   = materials × wastePct
laborHrs   = Σ labor estimator hours (reuse computeLaborTotal/laborEst paths; fall back to Σ item.capitalLabor treated as pesos when no hours exist — keep today's laborForCogs precedence, do not double count)
labor      = hours×loadedLaborRate when hours exist, else capitalLabor pesos
consumables= labor × consumablesPct
direct     = materials + matWaste + labor + consumables        // = FLOOR
sizeF      = band lookup on direct
ohPct      = clamp(baseOH × sizeF, ohMin, ohMax)               // pace factor: NOT in this phase — render the chip as "pace —" with title "live pace lands with the Overhead dashboard phase"
ohAmt      = direct × ohPct
trueCost   = direct + ohAmt
target     = trueCost ÷ (1 − targetMargin)
sell       = computeTotals().net                               // ex-VAT, unchanged
marginPct  = (sell − trueCost) ÷ sell
```

Panel UI (match the existing builder styling: `.section`, `.sec-title`, existing badge/pill classes; no new fonts/colors beyond the file's own tokens):
- Buildup rows: Materials / + Waste 6% / + Labor (Xh × ₱150 or capital labor) / + Consumables 8% / **DIRECT = FLOOR** / + OH (base 25% × size Y.YY, pace —) / **TRUE COST**.
- Ladder: FLOOR / TRUE COST / TARGET (20%) / **QUOTED (net)** with peso values.
- Margin line: actual margin at quoted net, colored: red `< 0 vs floor` (i.e. sell < direct), orange `sell < trueCost`, amber `margin < targetMargin`, green otherwise.
- Shadow-mode label visible on the panel: `SHADOW — reference only, does not change quote prices` (small gray badge).
- Below floor (`sell < direct`): show a red note "Below floor — President approval required" and auto-tick `#reqApprovalCheck` if present and unticked (do not create a new approval mechanism; do not force-file anything).

Keep `computeMarginSummary`'s existing external contract: same function name, still callable where it is called today; extend its return object rather than replacing fields other code reads (grep call sites first).

## 3 · Custom-item costing gate

First LOCATE how non-catalog/custom lines are added today (search: "custom", "misc", "manual item", item objects without a catalog `id`/`productId`). Report what you find in your summary. Then:

- In **Internal view only**, each custom line gets two optional numeric inputs: `Materials ₱` and `Labor hrs` (+ the settings math applies automatically). Store on the item as `costMat` / `costHrs` (new additive fields, in-session only — see §4 for persistence).
- A custom line with neither field set is **uncosted**: show an amber "needs costing" chip on the line (internal view only).
- `doVerifyAndFile()`: if any custom line is uncosted, block with the builder's existing warning/confirm UI pattern: message "N custom line(s) have no cost basis — cost them in Internal view before filing." Blocking = do not proceed to file. (If a hard block breaks an existing flow you cannot resolve, escalate rather than soften to a confirm.)
- Client view and partner mode: no new UI whatsoever for custom lines.

## 4 · Close the cost-field leak in filed payloads

In `buildQuotePayload` (and any other path that sends items out via postMessage for saving — `QUOTE_DRAFT`, `QUOTE_FILED`, `QUOTE_UPDATE`), map items to strip cost basis before sending: remove `capitalMaterials`, `capitalLabor`, `costMat`, `costHrs` from every item. In-session objects keep them; only outbound payloads are cleaned. Do not strip anything else. `LOAD_QUOTE` of legacy docs that still carry the fields must keep working (the panel already falls back to live `product_costs` values — verify it does after your change; if the fallback is actually items-first, re-point the panel to prefer live `product_costs` and use item fields only when live data is absent).

Print/PDF and Agent Copy paths: verify they never render cost fields (they shouldn't today; confirm and state so).

## 5 · Partner isolation (the "make sure" requirement)

After implementation, PROVE all of the following and include the evidence in your final report:

1. `?portal=partner&pcoName=X` boot: `#costMarginWrap` absent, `#btnInternal` absent, zero occurrences of floor/true-cost/OH strings in `document.body.innerHTML`.
2. Grep the file: every new function you added either renders inside `#costMarginWrap` or begins with a `PARTNER_MODE` early-return.
3. A filed payload (simulate `buildQuotePayload()` in console) contains no `capitalMaterials`, `capitalLabor`, `costMat`, `costHrs` on any item.
4. `product_costs` / `_settings` reads remain inside the `!PARTNER_MODE` branch.
5. Brilliant Steel behavior unchanged (BS Internal view still shows the cost panel — now the v2 panel).

## Verification protocol (before reporting done)

- Serve the repo root (a static server on any free port ≥3845; do NOT touch ports 3737/3838/3842/3843/3844) or reuse plain `file://` where fetch fallbacks allow; headless Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new --screenshot=...`.
- Boot 1 (internal): default page → switch Internal → add a catalog item (embedded DB fallback path is fine, cost basis may be ₱0 — the panel must render gracefully with a "no cost basis on this item" note rather than fake numbers).
- Boot 2 (partner): `?portal=partner&pcoName=Test` → screenshot → assert isolation list above.
- Extract the page `<script>` and `node --check` it (write to a temp .js first). Zero console errors on both boots (`--enable-logging=stderr` or read console via CDP if available; at minimum no blank page and correct DOM).
- Do NOT bump versions; do NOT touch sw.js/PRECACHE (file already precached).

## Report format

Summary of edits (function + what changed), anchors actually found (with real line numbers), custom-item mechanism discovered, isolation evidence (5 points), screenshots paths, anything escalated. No diffs in prose — the main session reads `git diff` itself.
