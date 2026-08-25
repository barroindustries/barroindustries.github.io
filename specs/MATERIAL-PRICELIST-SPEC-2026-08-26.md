# MATERIAL PRICE LIST — Purchasing-owned supplier prices, synced everywhere

**Date:** 2026-08-26 · **Author:** Fable · **Builder files:** `js/departments.js` ONLY (Purchasing screen lives there). Seed data already at `data/material-pricelist-2025.json` (632 items, Kingsway Steel 2025, flattened from Neil's PRICELIST 2025.xls). Do NOT edit firestore.rules, scripts/, index.html, sw.js, config.js — the main session handles rules/backup/deploy.

**Purpose:** one live, editable supplier price list ("Material Price List") that Purchasing maintains and every costing surface reads. This is the material-price feed for the costing system (BOMs, quote costing) — Neil: "when a price is updated in purchasing … that updates the inventory pricelist".

## Data model — new collection `material_prices` (rules added by main session)

One doc per category: `material_prices/{catId}` where `catId = slug(cat)` (lowercase, alnum+dashes, ≤60 chars):

```js
{ cat, supplier: 'KINGSWAY STEEL ENTERPRISES', year: 2025,
  items: [ { id, sec, desc, grade, price, prevPrice?, updatedAt?, updatedBy?, source? } ],
  updatedAt, updatedBy }
```

`id` is the stable hash already present in the seed JSON. `source` ∈ 'pricelist-2025' | 'manual' | 'po'.

## Features

1. **Purchasing → "Price List" chip-tab** (use the `window.chipTabs`/`bindChipTabs` declutter pattern — NOT a hand-rolled subtab bar). Located wherever the Purchasing screen renders its subtabs today; find `renderPurchasing`-ish function in js/departments.js.
   - Category chips (grouped from docs) + a search box filtering desc/sec/grade across all loaded categories.
   - Table: Section / Item / Grade / Price / Updated. Long lists capped at 150 rows + "Show all" (existing app convention).
   - Reads via `dbCachedGet('material-prices', fetcher, ttl)` with `.catch(()=>({docs:[]}))`; `dbCacheInvalidate('material-prices')` after any write.
2. **Inline price edit** — gated `canPurchasing() || canFinance() || isAdmin()` (verify helper names in config.js/departments.js; read-only for everyone else with view access to Purchasing). Click price → number input → save updates that array item: `price`, `prevPrice` (old), `updatedAt` (`bizDate()` + time), `updatedBy` (current user name), `source:'manual'`; whole-doc update, toast success/error (`Notifs.success/error`), show `prevPrice → price` subtly after edit.
3. **Seed button** — "Import 2025 price list (Kingsway)" visible only when the collection is EMPTY (or with a confirm "re-seed overwrites edits" for president only). Fetches `data/material-pricelist-2025.json` (same-origin fetch), groups by `cat`, writes one doc per category (batched writes, ≤500 ops per batch). Idempotent by doc id.
4. **PO price hook** — locate the PO receive / RFQ-quote-accept flow in the purchasing code (search "receive", "RFQ", "PR", "purchase"). After a PO line is received with a unit price: fuzzy-match (case-insensitive substring either direction) the line's item name against pricelist `desc`/`sec`; on a single confident match whose price differs, show a NON-BLOCKING confirm ("Update price list: <desc> ₱old → ₱new?") → same update path with `source:'po'`. Zero or multiple matches → do nothing. If the receive flow can't be located confidently, SKIP this feature and say so in the report — do not guess.
5. **Cross-dept read surface:** in the Sales screen area do NOTHING this phase (quote-builder integration is a later phase); the collection + cache key IS the sync mechanism.

## Conventions & guardrails
- `escHtml()` on every user-visible string (desc/sec/grade are supplier data = untrusted).
- Manila time via `bizDate()`; money display `fmtN2`/`fmt` as the file already does.
- Never run git stash/reset/checkout/clean; do not commit; additive edits only; this is a live shared tree.
- New collection means firestore.rules + backup EXPORTS additions — NOT yours; list it in the report as "pending main session".

## Verify before reporting
`node --check js/departments.js`; headless boot of the app (port ≥3845 or reuse none of 3737/3838/3842-3844): no console errors pre-login; state honestly what needs login to exercise. Report: functions added (names + line ranges), where the tab hooks in, PO-hook status, escalations.
