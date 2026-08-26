# CUSTOM ITEM BOM — pricelist-backed materials, crew-day labor, auto-specs

**Date:** 2026-08-26 · **Author:** Fable, from Neil: "when adding custom item, allow to list down materials · if material is in the inventory pricelist take the price from there · allow to list down quotient for labor cost as well computed at 30k per 6 days wherein i put a set amount of time then it computes the labor cost · and when these materials are inputted already, said materials will show in the specifications, summarized form."
**File:** `quote-builder-v2.html` ONLY. Builds ON TOP of the Phase-1 custom-item gate (`costMat`/`costHrs`, `customCostGateHtml`, `updateCustomCost`, `uncostedCustomLinesReason`) and the QB-UX pass that may have landed just before — read the file as it IS, reconcile with whatever the per-item computation table looks like now. Same hard rules as COSTING-PHASE1-SPEC.

## 1 · Material rows on custom items (Internal view only)

Each `id:'CUSTOM'` line's cost gate grows from one lump "Materials ₱" into a small BOM list:
- Rows: `item.bom = [{name, plId, qty, unitPrice, src}]` — `src` ∈ `'pricelist'|'manual'`. Add-row button, per-row remove. Qty accepts decimals (sheets ×1.5).
- **Type-ahead against the Material Price List:** in the existing `!PARTNER_MODE` load path, fetch the `material_prices` collection once (catch → empty; flatten all docs' `items[]` into one array of `{plId:id, name, price, catId}` — the seed's normalized `name` field, e.g. "SS304 Sheet 1.2mm (2B, 4×8ft)"). The row's name input filters this list (simple contains, cap 8 suggestions); picking one fills `name`, `plId`, `unitPrice` (live price) and marks `src:'pricelist'` with a small badge. Free-typed names with a hand-entered price are `src:'manual'` — always possible (materials not in the list, AND the graceful path for roles whose rules deny the `material_prices` read: today that read is senior-admin/finance/purchasing; a plain sales session gets permission-denied → empty suggestions → manual entry still works. Note this in the report; widening the rules is a main-session decision, not yours).
- Materials total = Σ qty × unitPrice. Backward compatibility: if `bom` is empty/absent, fall back to the existing `costMat` lump (do not delete that field or its input — relabel it "or lump-sum materials ₱" as the fallback).

## 2 · Crew-day labor

- New settings in `COSTING_DEFAULTS` (and read from `product_costs/_settings` when present): `crewWeekRate: 30000`, `crewWeekDays: 6` → day rate = rate/days = **₱5,000/day**.
- The custom line's labor input becomes "Labor time (days)" (decimals allowed): `costLaborDays` → labor pesos = days × 5000, shown live beside the input ("2.5 d × ₱5,000 = ₱12,500 · ₱30k/6d crew rate"). Keep `costHrs` working as a legacy fallback when present (hours × loadedLaborRate) but the UI input is days now.
- `computeTrueCost()` / the per-item table / `uncostedCustomLinesReason()` all use: custom line labor = bom/crew-day pesos (or legacy), custom line materials = BOM total (or lump). A line is COSTED when it has (bom rows OR costMat) — labor optional (some customs are materials-only).

## 3 · Specs auto-summary (client-visible, cost-free)

When a custom line has BOM rows, maintain a summarized materials line inside the item's existing specifications text — the field that prints on the quotation:
- Format: `Materials: SS304 Sheet 1.2mm ×2 · SS Round Tube 1/2" ×6 · Gooseneck Faucet ×1` — **names and quantities only, never prices**.
- Managed-line approach: the auto-summary owns exactly one line (prefix `Materials:`) inside the specs; regenerate that line on every BOM change without touching anything else the user typed. Deleting all BOM rows removes the line. If the specs mechanism is per-item free text (`Click to add specifications…`), append/replace the managed line at its end.
- The summary shows in Internal, in the Client/print document, everywhere specs already render — that is the point.

## 4 · Leak closure extension

Outbound payload strip (`buildQuotePayload`) must now ALSO remove `bom`, `costLaborDays` (and keep stripping `costMat`/`costHrs`/`capitalMaterials`/`capitalLabor`). The specs TEXT (names+qty) stays — it is client-facing by design and carries no prices. Verify with the same simulated-payload test as Phase 1.

## Verify
node --check · headless internal boot: add custom item → add 2 pricelist materials (inject fake `material_prices` data in-page if unauthenticated) + 1 manual row + 1.5 labor days → materials total, labor ₱7,500, specs line correct, panel + per-item table reconcile, gate clears · generic partner boot: zero new DOM · payload strip proof · screenshots · report with line ranges + escalations.
