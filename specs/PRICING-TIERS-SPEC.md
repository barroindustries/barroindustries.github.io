# PRICING-TIERS-SPEC.md — Per-Item Quantity-Break Volume Discounts (Quote Builder v2)

**Status:** SPEC — approved model chosen by Neil: a line item's discount is keyed off **its own qty**
crossing configured thresholds (e.g. 5% off at 10+ units, 10% off at 50+). No cross-line aggregation.
**This changes quote totals. It is money math.** Every formula below is grounded in the current code of
`quote-builder-v2.html` (line refs are as of commit `6c3a899`). The feature ships **opt-in**: with no
tiers configured, every existing quote computes **byte-identical** totals (see §1.3 and §8).

Implementer notes: builder = `quote-builder-v2.html` (self-contained iframe page with its OWN Firebase
via `js/firebase-config.js`, lines 1374–1378). Admin screen = `renderProductDatabase()` in
`js/screens/dashboards.js` (~line 304). No change to `js/app.js`'s postMessage bridge is required.
No `firestore.rules` change is required (§2.4). The pre-commit hook auto-bumps `APP_VERSION` /
`CACHE_VER`; `quote-builder-v2.html` is already in sw.js PRECACHE (line 33).

---

## 0. Current pricing pipeline (verified, read before touching anything)

The builder's money flow has exactly two stages, and the new feature touches only stage 2 plus one
render function:

**Stage 1 — per-line.** `computePrice(p)` (line 2560) prices ONE unit from the product formula
(`per_length` line 2567 / `per_area` line 2590 / `per_run` line 2595 / fixed `basePrice`), applies
`DB.constants.materialPriceIndexMultiplier`, spec adders, and returns `Math.max(0,Math.round(price))`
— **whole pesos**. Every line in `items[]` carries `{qty, unit, unitPrice, amount, category,
formulaType, capitalMaterials, capitalLabor, ...}` (shape built at `addItemFromCalc`, line 2685).
`amount = unitPrice × qty` is maintained at every mutation site: `addItemFromCalc` (2695),
`updateQty` (3116), `bumpQty` (3118+), `updatePrice` (3126), `duplicateItem` (3136, deep-copies),
`addCustomItem` (2712, amount 0). `loadEditableState` / `LOAD_QUOTE` restore items verbatim.

**Stage 2 — totals.** `computeTotals()` (line 2811), verbatim today:

```
subtotal    = Σ items[i].amount                                   (2812)
diAdded     = diInclude ? diAmount : 0                            (2827)  // Delivery & Installation
preDiscount = subtotal + diAdded                                  (2828)
discountAmt = discMode==='amount' ? clamp(discAmtCustom, 0..preDiscount)
                                  : preDiscount × discPct/100     (2830)  // quote-level discount
net         = preDiscount − discountAmt                           (2831)
vatAmt      = showVat ? net × vatRate : 0                         (2832)  // vatRate = DB.constants.vat = 0.12
grand       = net + vatAmt                                        (2833)
commissionAmt = commMode==='amount' ? max(0,commAmtCustom)
                                    : grand × commPct/100         (2835)  // on the GRAND total
```

Consumers of `computeTotals()` — all inherit the new math automatically, none re-derive totals from
items: `renderTotals()` (2840, writes `#totalsTbl`, the SAME table the A4 print restyles),
`updateRunningTotalPill` (2869), Quick-Quote badge (2068), `renderPaymentSchedule(grand)` (2896),
`buildAgentBox` (4476, agent-copy commission box), `computeMarginSummary` (3298, uses `.net` as
ex-VAT sell — margins will correctly shrink when a break applies), and `buildQuotePayload()` (4237),
which stamps `subtotal / discountAmount / netAmount / vatAmount / total / grandTotal /
commissionAmount / payment.{downPayment,balance}` into the filed doc. **app.js writes the payload
verbatim (`db.collection(coll).add(data)`, ~3812) — nothing outside the builder ever recomputes a
quote total.** The A4 print output is the live DOM under `@media print` (CSS 475–662); there is no
separate print renderer.

> Correction to the task brief: there is **no `vatSplit`** anywhere in the builder. VAT is a single
> `showVat` checkbox (line 1071) that ADDS 12% on `net`; the footer note (2852) just says
> "VAT included/exclusive". Spec everything against `showVat` only.

---

## 1. Config model

### 1.1 Shape

A single global tier ladder, applied to any line by that line's own `qty`:

```jsonc
// productMeta/config  (existing doc — NEW top-level field)
{
  "categories": [...],          // existing
  "laborRoles": [...],          // existing
  "constants":  {...},          // existing (vat, materialPriceIndexMultiplier, …)
  "volumeTiers": [              // NEW — sorted ascending by minQty, unique minQty
    { "minQty": 10, "discountPct": 5 },
    { "minQty": 50, "discountPct": 10 }
  ]
}
```

- `minQty`: integer ≥ 2. `discountPct`: number, 0 < pct < 100 (UI caps at 50, see §5.1).
- Rule: **highest applicable tier wins** — the tier with the largest `minQty ≤ qty`. Thresholds are
  **inclusive** (`qty >= minQty`): at tiers above, qty 10 → 5%, qty 50 → 10%.
- **v2 option (design for, don't build):** a per-product override `volumeTiers` array on the
  `products/{id}` doc that replaces the global ladder for that product. The v1 helper (§3.1) takes
  the ladder as an argument precisely so v2 is a lookup change, not a math change.

### 1.2 Where it lives — `productMeta/config`, top-level field (recommended)

Why this doc and not a new `app_config/pricing`:

1. **The builder already reads it.** `loadDatabase()` fetches `productMeta/config` in the same
   `Promise.all` as products (lines 1548–1551) and it already carries the OTHER global pricing knobs
   (`constants.vat`, `constants.materialPriceIndexMultiplier`). Zero new round trips, and it works in
   BOTH deployment modes — embedded iframe AND the standalone `npx serve -p 3737` tool — because the
   builder has its own Firebase; a postMessage-only delivery would break standalone mode.
2. **Rules already cover it.** `match /productMeta/{docId}` (firestore.rules 1130–1133): read
   `isAuth()`, write `isAdmin()` (president/manager/secretary). **No rules deploy needed.**
3. **Merge-safety verified.** The two other writers of this doc are `seedCatalogIfNeeded`
   (app.js 1950 — only runs when the doc doesn't exist yet) and `importNewCatalogItems`
   (app.js 1990 — `set({categories, laborRoles, constants}, {merge:true})`). A top-level
   `volumeTiers` field is **not in either write set**, so `{merge:true}` leaves it untouched.
   Do **NOT** nest tiers inside `constants` — that object IS spread-merged on catalog import and is
   one stray refactor away from clobbering the ladder.

Editing writes: `db.collection('productMeta').doc('config').set({ volumeTiers: cleaned }, { merge:true })`.

### 1.3 Who edits it, and where in the nav

The **Product Database** screen — president-only nav entry (`js/config.js` 522, `when:'isPresident'`;
router gate app.js 2197), rendered by `renderProductDatabase()` in `js/screens/dashboards.js` (~304).
Add a **"Volume Pricing (Quantity Breaks)"** card there (§5.1). Note the asymmetry and accept it for
v1: the UI is president-only but the Firestore rule allows any `isAdmin()` writer — identical to how
`constants.vat` and the material multiplier are governed today. If Neil later wants president-only
writes, that's a field-level rule on `productMeta/config`, out of scope here.

### 1.4 THE SAFETY CONTRACT — empty default

**No tiers configured (`volumeTiers` absent, `[]`, or unreadable) ⇒ ZERO behavior change.**
Concretely: `VOLUME_TIERS = []` → the helper returns `null` for every line → `volumeBreakTotal = 0`
→ `preDiscount = subtotal − 0 + diAdded`, which is float-exact-identical to today's
`subtotal + diAdded` → every number in `computeTotals()`'s return, every rendered row, the print
output, and every payload money field is **byte-identical** to the pre-feature build. No per-line
notes render, no totals row renders. The feature is invisible until Neil types the first tier in.
This must be **proven, not assumed** — §8.1 is a mandatory pre-ship gate.

---

## 2. Application math (the crux)

### 2.1 What the break applies to

The break applies to the **line amount** (`item.amount = unitPrice × qty`), NOT by rewriting
`unitPrice`. Rationale (each alternative was rejected for a concrete reason):

- **Rewriting `unitPrice` is unsafe.** Five mutation sites keep `amount = unitPrice × qty` in sync
  (§0); a discounted unitPrice would be silently re-multiplied, double-applied on qty edits, and
  would poison the persisted item (localStorage draft, `editableState`, `#quote=` share links) with
  a value that no longer matches the product formula. It would also corrupt `computePrice`'s
  contract that unitPrice is the formula output.
- **Mutating `amount` in place is fragile** — every one of the five sites (plus `LOAD_QUOTE`,
  Quick-Estimate handoff from sales.js, drag-reorder, duplicate) would need the discount re-applied;
  missing one silently misprices.
- Instead: **`unitPrice` and `amount` stay GROSS everywhere, untouched.** The break is a separate,
  derived, per-line figure computed at read time by ONE pure helper, and subtracted ONCE in
  `computeTotals()`. Single choke point; the items table code and all mutation sites keep zero diff.

### 2.2 The helper (single source of truth)

```js
// Global, set by loadDatabase (§4). Always an array; [] = feature off.
let VOLUME_TIERS = [];

// Pure. Returns null (no break) or {minQty, pct, amt} — amt in WHOLE PESOS.
function volumeBreakFor(item, tiers = VOLUME_TIERS){
  if (!tiers.length) return null;                    // safety contract, §1.4
  if (item.volumeBreakOff) return null;              // per-line opt-out, §2.5
  const qty = Number(item.qty) || 0;
  let best = null;
  for (const t of tiers){ if (qty >= t.minQty) best = t; }   // pre-sorted asc → last hit = highest tier
  if (!best) return null;
  const gross = Number(item.amount) || 0;            // the SAME number subtotal sums — never re-derive
  const amt = Math.round(gross * best.discountPct / 100);
  return amt > 0 ? { minQty: best.minQty, pct: best.discountPct, amt } : null;
}
```

**Rounding rule:** whole pesos per line (`Math.round`), matching the builder's existing conventions —
`computePrice` rounds unitPrice to whole pesos (2614) and `formatPeso` displays whole pesos (4552).
The **totals-level figure is the SUM of the per-line rounded amounts, never an independent
percentage-of-subtotal recompute** — so the printed per-line notes always sum exactly to the totals
row, with no centavo drift, ever. The base is `item.amount` (not `unitPrice*qty` re-multiplied) so
the break keys off the identical float that `subtotal` sums.

### 2.3 Revised `computeTotals()` — exact order of operations

Three changed/added lines; everything else stays textually identical:

```js
const subtotal = items.reduce((s,i)=>s+i.amount,0);                    // UNCHANGED — GROSS
const volumeBreakTotal = items.reduce((s,i)=>{                         // NEW
  const b = volumeBreakFor(i); return s + (b ? b.amt : 0);
},0);
...
const preDiscount = subtotal - volumeBreakTotal + diAdded;             // was: subtotal + diAdded
...   // discountAmt, net, vatAmt, grand, commissionAmt — UNCHANGED TEXT
return { subtotal, volumeBreakTotal, /* …existing fields unchanged… */ };
```

Full revised chain, explicit:

```
subtotal        = Σ amount                       (GROSS — semantics unchanged)
volumeBreakTotal= Σ per-line Math.round(amount × tierPct/100)   over lines with a matching tier
diAdded         = diInclude ? diAmount : 0       (D&I is NEVER volume-discounted)
preDiscount     = subtotal − volumeBreakTotal + diAdded
discountAmt     = pct mode: preDiscount × discPct/100
                  flat mode: clamp(discAmtCustom, 0 .. preDiscount)     ← clamp now correctly
                                                                          post-break (see §7)
net             = preDiscount − discountAmt
vatAmt          = showVat ? net × 0.12 : 0        ← VAT base is POST-break, POST-quote-discount
grand           = net + vatAmt
commissionAmt   = pct mode: grand × commPct/100   ← commission base is POST-everything
                  flat mode: max(0, commAmtCustom)
```

**VAT and commission are automatically computed on post-break figures** because both derive from the
`preDiscount → net → grand` chain and the break is subtracted at the top of that chain. This is the
correct BIR-facing behavior: VAT is owed on the actual (discounted) selling price, and agents earn
commission on what the client actually pays. Do NOT "optimize" by computing VAT on `subtotal` — that
would overstate VAT by 12% of every discount.

**Stacking with the quote-level discount is multiplicative by design** (volume first, then quote
discount on the reduced base): 10% volume + 5% quote = 1 − (0.90 × 0.95) = **14.5%** effective, not
15%. This is intentional — the volume break is a line-level price adjustment; the quote discount is a
negotiation on the resulting total. It can never double-discount beyond either input, and the flat
discount clamps to the post-break `preDiscount` so a flat discount can never drive `net` negative.

### 2.4 Worked example (use these exact numbers in verification, §8.2)

Tiers `[{10,5},{50,10}]`. Line A: 12 × ₱2,000 = ₱24,000 → 5% tier → break ₱1,200.
Line B: 3 × ₱10,000 = ₱30,000 → no tier. D&I ₱5,000 included; quote discount 5%; VAT on;
commission 3%:

```
subtotal        = 54,000        volumeBreakTotal = 1,200
preDiscount     = 54,000 − 1,200 + 5,000 = 57,800
discountAmt     = 57,800 × 5%            =  2,890
net             = 54,910
vatAmt          = 54,910 × 12%           =  6,589.20
grand           = 61,499.20     (displays ₱61,499 via formatPeso)
commissionAmt   = 61,499.20 × 3%         =  1,844.976
```

### 2.5 New per-line fields

| Field | Direction | Meaning |
|---|---|---|
| `volumeBreakOff` | **INPUT** — persisted | Per-line opt-out (rep waived the auto break). Rides `items[]` through localStorage, `editableState`, duplicate, LOAD_QUOTE — no extra plumbing needed since items persist whole. Absent/falsy = break applies. |
| `volumeBreakPct` | OUTPUT — stamped | The applied tier's pct, stamped onto the item **only when a break applied**, at `buildQuotePayload()` time (record of what was filed). |
| `volumeBreakAmt` | OUTPUT — stamped | Whole-peso break amount, same stamping rule. |

**Outputs are never inputs.** During any live session, breaks are recomputed from `(qty, amount,
VOLUME_TIERS)` on every `renderItems`/`computeTotals` pass; stale stamped values loaded from an old
payload or draft are ignored and overwritten at the next payload build. When no break applies,
`buildQuotePayload()` must `delete` any stale `volumeBreakPct/Amt` left on the item from a prior
state. Payload additions at top level: `volumeBreakTotal: t.volumeBreakTotal` (always present; `0`
when off — additive field, existing fields keep their exact semantics: `subtotal` stays GROSS,
`netAmount`/`total` now reflect the break through the chain).

---

## 3. UI

### 3.1 Admin editor — "Volume Pricing (Quantity Breaks)" card on the Product Database screen

In `renderProductDatabase()` (`js/screens/dashboards.js` ~304), below the existing catalog tools:

- Table of tier rows: **Min qty** (number input, step 1) | **Discount %** (number input, step 0.5) |
  remove (✕). "+ Add tier" appends a row. Max 10 tiers.
- **Save** validates then writes `set({volumeTiers}, {merge:true})` + success toast; **the builder
  picks changes up on its next load** (or its "↻ Reload DB" button, line 811) — state this in the
  card's helper text so Neil isn't surprised an open builder doesn't live-update.
- Validation (blocking): minQty integer ≥ 2 (a 1-qty tier is a base-price cut — blocked with that
  hint); minQty unique; 0 < discountPct ≤ 50 (values > 30 require an "are you sure" confirm);
  auto-sort ascending on save. Warning (non-blocking): a higher tier with a LOWER pct than the tier
  below it.
- Empty state: "No tiers — volume discounts are OFF. Quotes are unchanged until you add one."
- A live preview line under the table: "e.g. a 12-unit line gets −5%" computed from the draft rows.

### 3.2 Per-line display in the builder (screen AND A4 print)

In `renderItems()` (2741), inside the **Amount** cell (2789), when `volumeBreakFor(item)` returns a
break:

```
₱24,000
Vol −5% (10+ units): −₱1,200        ← small muted line, class "vol-note"
```

- `vol-note` is **NOT** `.no-print` — it renders on the client's A4 printout deliberately
  (transparency is the selling point of published quantity breaks). Style it like the existing
  `spec-line` small text; add a print rule sizing it ~7.5pt alongside the 475–514 print block.
- Clicking the note (screen only) toggles `item.volumeBreakOff` with a confirm toast; when a line is
  opted out but a tier WOULD match, render a `.no-print` muted chip "Vol discount off — tap to apply
  (−₱X)" so the waiver is visible to the rep but invisible to the client.
- Category subtotal rows (2802) stay GROSS — they sum `item.amount` today and keep doing so; the
  break surfaces per-line and in the totals box only, so no number on the page changes meaning.

### 3.3 Totals box (`renderTotals`, 2840 — same table the print uses)

Insert directly after the Subtotal row, before D&I:

```js
if(t.volumeBreakTotal>0) html+=`<tr class="discount"><td>Volume Discount (qty breaks)</td><td>−${formatPeso(t.volumeBreakTotal)}</td></tr>`;
```

and widen the Net-row condition (2848) to `if(t.discountAmt>0||t.diAdded>0||t.volumeBreakTotal>0)` —
otherwise a break-only quote would print Subtotal → VAT → Grand with an unexplained gap. With no
tiers, neither change renders anything (safety contract). `updateRunningTotalPill`, payment schedule,
agent box, and margin panel need **zero edits** — they consume `computeTotals()` outputs.

---

## 4. Config delivery to the iframe

**Mechanism: the builder's own existing Firestore read.** In `loadDatabase()` (1533), the Firestore
success path already destructures `metaSnap` (1550): add
`VOLUME_TIERS = normalizeVolumeTiers(meta.volumeTiers);` next to the existing
`constants: meta.constants || {}` mapping. **Not** the postMessage bridge — the builder must work
standalone (port 3737) where there is no parent, and the Firestore read already exists in the same
round trip. The bridge (`QB_READY`/`LOAD_QUOTE`, app.js 1657–1681) is untouched.

Defensive normalization (defense in depth against a hand-edited doc):

```js
function normalizeVolumeTiers(raw){
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw
    .map(t => ({ minQty: Math.floor(Number(t && t.minQty)), discountPct: Number(t && t.discountPct) }))
    .filter(t => Number.isFinite(t.minQty) && t.minQty >= 1
              && Number.isFinite(t.discountPct) && t.discountPct > 0 && t.discountPct < 100
              && !seen.has(t.minQty) && seen.add(t.minQty))
    .sort((a,b) => a.minQty - b.minQty);
}
```

**Fallback contract — every non-Firestore path yields `[]` (no breaks), NEVER a wrong total:**
`file://` embedded path (1537), `products-database.json` fetch path (1614 — the JSON has no
`volumeTiers` key and must not gain one; Firestore is the single source of truth, keeping the
catalog-import merge in §1.2 moot), `getEmbeddedDB()` fallback (1634), and any thrown read. Failure
direction is deliberately conservative: a session that can't load tiers quotes the client **more**
(gross price), never less — an offline/fallback session can never undercharge. The status line
(1633) already tells the rep they're on fallback data. Partner sessions (`PARTNER_MODE`, 1669) read
`productMeta` under `isAuth()` and **do** get the tiers — intended: published quantity breaks apply
to partner-filed quotes identically. Reset `VOLUME_TIERS = []` at the top of every `loadDatabase()`
run so a "Reload DB" that lands on a fallback path can't retain stale tiers.

---

## 5. Edge cases (exact behavior, each)

1. **Qty below all tiers** → helper returns `null`; line renders exactly as today; contributes 0 to
   `volumeBreakTotal`.
2. **Qty exactly at a threshold** → tier applies (`>=`, §1.1). Qty 10 on a `{10,5}` tier gets 5%.
3. **Manually price-overridden line** (`updatePrice`, 3126) → the break still applies, recomputed
   live against the NEW gross (`amount` is refreshed by updatePrice itself) — the model keys off qty
   only, per Neil's decision. A rep who has hand-negotiated a price and does NOT want stacking taps
   the vol-note to set `volumeBreakOff` (§3.2). The toggle survives save/reopen/duplicate.
4. **per_length / per_area products** — `qty` is a count of PIECES; dimensions are already priced
   into `unitPrice` by `computePrice`. One 6-meter counter is qty 1 → no break; ten 500mm shelves on
   one line are qty 10 → break. Correct under the chosen model; document it in the admin card's
   helper text ("breaks count pieces, not meters").
5. **per_run products** — `unitPrice = pricePerRun × runs` (2595); `runs` (`runsVal`) NEVER counts
   toward the break; only `item.qty` does. A 1-qty line of 60 runs gets no break.
6. **Qty 0 / garbage qty** — unreachable via UI (`updateQty`/`bumpQty`/`addItemFromCalc` all clamp
   `Math.max(1,…)`), but a hand-edited payload could carry it: `Number(qty)||0` matches no tier
   (all `minQty ≥ 1` post-normalization... minQty ≥ 1 would match qty 1+; qty 0 matches nothing) →
   no break, amount contributes as-is. Never NaN: every input is `Number(x)||0`-guarded.
7. **Interaction with the quote-level discount** — multiplicative stacking, volume first (§2.3).
   Flat-mode clamp uses the post-break `preDiscount`, so flat discount + volume break can reduce
   `net` to exactly 0 but never below.
8. **Custom items** (`addCustomItem`, id `CUSTOM`) and Quick-Estimate handoff lines — qty-keyed like
   any other line; breaks apply. (Global tiers are product-agnostic by design.)
9. **Split lines don't aggregate** — two lines of 5 units of the same product ≠ one line of 10.
   This is the chosen per-item model, stated plainly in the admin card. (Cross-line same-product
   aggregation is the v2 note in §1.1.)
10. **Reopen / new revision / `#quote=` share links** — breaks are recomputed from the **current**
    ladder against the loaded qtys; the originally-filed doc's stored numbers stay frozen in
    Firestore. A revision under a changed ladder reprices — consistent with a revision being a fresh
    offer (stored `unitPrice` is likewise kept, not re-fetched). Flag in the release note to Neil:
    "changing tiers changes what an old quote's REVISION will total."
11. **Tiers changed while a builder tab is open** — not live-pushed; takes effect on next builder
    load or "↻ Reload DB" (§3.1, §4).

---

## 6. Where this math could go wrong — implementer checklist

- **VAT base**: must be `net` (post-break). Comes free from §2.3's chain — do not touch line 2832.
- **Commission base**: `grand` (post-break, post-discount, post-VAT) — do not touch line 2835.
- **Flat-discount clamp**: `preDiscount` must already have the break subtracted (it does in §2.3) or
  a flat discount could exceed the real pre-VAT base and go negative.
- **Double-count**: the break is subtracted in exactly ONE place (`preDiscount`). It must NOT also
  mutate `item.amount`/`unitPrice`, category subtotals, or `subtotal` — if any of those change, the
  break compounds. `payload.subtotal` stays gross.
- **Rounding drift**: totals row = Σ per-line rounded amounts, never `subtotal × pct` recomputed
  (§2.2). Per-line note, stamped `volumeBreakAmt`, and totals row must all be the same integers.
- **Stale stamps**: `volumeBreakPct/Amt` are outputs only; delete them at payload build when no
  break applies (§2.5).
- **Config clobber**: top-level `volumeTiers` field, never inside `constants` (§1.2); no
  `volumeTiers` key in `products-database.json` (§4).
- **Fallback direction**: every failure path → `[]` → gross pricing (§4). Never cache tiers across
  a reload into a fallback path.
- **Do not touch** `computePrice()` — the break is not a unit-price concern (§2.1).

---

## 7. Firestore rules & deployment

- **No rules change**: `productMeta/{docId}` read `isAuth()` / write `isAdmin()` (rules 1130) already
  covers the config; tiers are customer-facing discount policy, safe under authenticated read
  (including partners — intended, §4). No composite index. Nothing to `firebase deploy`.
- App deploy is the normal `git push origin master`; the pre-commit hook bumps `APP_VERSION` →
  `CACHE_VER`, cache-busting both `quote-builder-v2.html` and `js/screens/dashboards.js`.

---

## 8. Verification (mandatory — `computeTotals` has NO unit tests)

### 8.1 Gate 1 — the zero-impact proof (MUST pass before ship, with tiers still unconfigured)

Prove: with `volumeTiers` absent, representative quotes are **byte-identical** vs. the pre-change
build. Procedure:

1. Baseline: on current master, open the builder and reconstruct at least these four quotes (or
   reopen real filed ones): (a) BK quote with a per_length item + custom dims, (b) per_area + per_run
   mix with spec adders, (c) quote with D&I included + **flat** discount + VAT on + pct commission,
   (d) a partner-mode quote. For each, run in the iframe console:
   `JSON.stringify(computeTotals())` and save the exact strings; also print-preview and keep the PDFs.
2. Load the feature build (no tiers configured; verify `VOLUME_TIERS` is `[]` in console). Reopen the
   same quotes; re-run `JSON.stringify(computeTotals())`.
3. PASS = strings identical **except** the single additive `volumeBreakTotal: 0` key (raw floats, not
   rounded display); print previews visually identical (no vol-note, no Volume Discount row, Net row
   appears under exactly the same conditions as before); filed payload diff shows only
   `volumeBreakTotal: 0` and no per-line stamps.
4. Also confirm both fallback paths (Firestore blocked → JSON; JSON blocked → embedded) still boot
   with `VOLUME_TIERS = []`.

### 8.2 Gate 2 — configured-tier math (set `[{10,5},{50,10}]` on a test basis)

| Case | Expect |
|---|---|
| qty 9 ×₱2,000 | no note; totals unchanged from gross |
| qty 10 ×₱2,000 | note "Vol −5% (10+): −₱1,000"; volumeBreakTotal 1,000 |
| qty 49 / qty 50 ×₱2,000 | 5% (₱4,900) / 10% (₱10,000) — highest-tier-wins, inclusive threshold |
| §2.4 worked example, exactly | net 54,910 · vat 6,589.20 · grand 61,499.20 · commission 1,844.976 (console-check raw floats) |
| Tap note → off | break removed from that line only; `.no-print` "off" chip; survives file→reopen and duplicate |
| Manual price ₱2,500 on qty-12 line | break recomputes to Math.round(30,000×5%)=₱1,500 live |
| Flat discount > post-break preDiscount | clamps to preDiscount; net = 0, never negative |
| Sum check | Σ printed per-line notes === Volume Discount totals row === `volumeBreakTotal`, to the peso |
| File → Firestore doc | `volumeBreakTotal` stamped; discounted lines carry `volumeBreakPct/Amt`; undiscounted lines carry neither; `subtotal` gross; `netAmount/total` post-break |
| Print (client) vs agent copy | vol-notes + Volume Discount row on BOTH; commission still only on agent copy |
| Margin panel (internal view) | `miSell` drops by the post-discount amount; COGS unchanged |
| Offline / fallback session | no breaks; status line shows fallback; totals gross |

### 8.3 Gate 3 — admin editor

Add/remove/reorder rows; save; verify doc field in Firestore console; run `importNewCatalogItems`
("Import new items" button) afterward and confirm `volumeTiers` survived the merge; verify a
non-president admin can't reach the screen (router gate) ; verify builder picks tiers up after
"↻ Reload DB".

---

## 9. Implementation touchpoints (for the executor)

| File | Change |
|---|---|
| `quote-builder-v2.html` | `VOLUME_TIERS` global + `normalizeVolumeTiers` + `volumeBreakFor` (near computePrice, ~2560); 3-line `computeTotals` edit (§2.3); vol-note in Amount cell of `renderItems` (~2789) + toggle handler; totals row + Net-row condition in `renderTotals` (~2844/2848); stamp/clean fields + `volumeBreakTotal` in `buildQuotePayload` (~4237); `VOLUME_TIERS` load/reset in `loadDatabase` (~1550); `.vol-note` CSS + print sizing (~510) |
| `js/screens/dashboards.js` | Volume Pricing card in `renderProductDatabase` (~304): editor + validation + `set({volumeTiers},{merge:true})` |
| `firestore.rules` / indexes / `js/app.js` / sw.js | **no changes** (hook auto-bumps CACHE_VER) |

Out of scope (explicitly): per-product tier overrides, cross-line aggregation, partner-specific
ladders, live push of config changes into open builders, any change to `computePrice`.
