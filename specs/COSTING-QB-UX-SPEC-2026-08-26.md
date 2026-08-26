# QUOTE BUILDER UX — client tab = print layout · editable OH · per-item computation

**Date:** 2026-08-26 · **Author:** Fable, from Neil's direction: "client tab should be the print layout already · internal side is where we will make the quotation, adding an item etc, and at the bottom is the oh etc · once edited the oh a detailed computation of per item will show."
**File:** `quote-builder-v2.html` ONLY. All Phase-1/pace structures (`computeTrueCost`, `renderTrueCostPanelHtml`, `COSTING_SETTINGS`, `paceFactor`, isolation flags) already exist — extend, don't rebuild. Same hard rules as COSTING-PHASE1-SPEC (no destructive git, no commits, additive, verify headless, honest report).

## 1 · Client tab renders the printed quotation

Today the Client toggle shows the same form sections with client-inappropriate controls hidden; printing restyles via `@media print`. Neil wants the Client tab to BE the document: a paper-like, read-only preview identical to Print/PDF output — letterhead, quote meta, item table, totals, terms, signature blocks — on a white sheet (page-width container, subtle shadow), no inputs anywhere.

- FIRST investigate how Print/PDF currently produces the document (search `doPrint`, `@media print`, any print-container markup). Then implement so preview and print CANNOT drift: extract or wrap ONE source of document markup/styles used by both. If the print path prints the live form DOM via CSS visibility, acceptable pragmatic path: a `renderClientPreview()` that clones/derives the same DOM state into a `.qb-doc-sheet` container styled to match the print stylesheet 1:1, re-rendered on every state change while Client view is active. State any visual diffs honestly in the report.
- The Client/Internal toggle keeps working both ways; all editing happens in Internal only.
- **Partners:** partner sessions live in client view permanently — they get the same print-layout presentation. Zero cost data (nothing new to leak — this is presentation only). Verify partner boot renders the document preview correctly and can still use whatever partner-permitted actions exist today (e.g. Share/Print buttons stay in the topbar, not inside the sheet).
- Quick Quote / other modes: leave untouched; if the client-preview interacts badly with one, escalate rather than force.

## 2 · Internal layout: OH panel last

Internal stays the workspace (add items, edit specs, labor). Confirm the cost/OH panel (`#costMarginWrap` inside `.int-panel`) is the LAST major section of the Internal view; if something currently renders below it, move the panel to the bottom (pure section reorder, no logic change). Report the final order.

## 3 · Editable OH% + per-item detailed computation

In the cost panel:
- The OH line becomes an editable percent input, default = the suggested value (base × pace × size, clamped — what `computeTrueCost()` computes today). Beside it: `suggested 34.5% · reset` (click resets to suggested; keeps auto-updating with live pace until manually overridden). Store the override in-session as e.g. `state.ohOverridePct` (a quote-level value, NOT per item; do NOT add it to outbound payloads — snapshot phase isn't built; note this in code).
- `computeTrueCost()` honors the override: `ohPct = clamp(override ?? suggested, ohMin, ohMax)`.
- **Per-item computation table** — renders inside `#costMarginWrap`, expanded automatically the first time the OH% is edited and toggleable via a small "Per-item computation" chip thereafter. Columns per quote line (catalog + costed customs): Item · Qty · Unit price (current quote price for the line, from the existing item amount/qty) · Direct/unit (materials×(1+waste) + labor + consumables + packaging from the same cost basis `computeTrueCost` uses) · OH/unit (direct × ohPct) · True cost/unit · Margin at current price ((unit price − true)/unit price) with the panel's existing status colors. Totals row must reconcile with the aggregate panel numbers (same math, same rounding — derive both from one computation, don't recompute independently). Uncosted custom lines render a "needs costing" chip in place of numbers. Sections/delivery adders that aren't items: exclude from the per-item table, note their handling under it in one muted line.
- Internal view only; `GENERIC_PARTNER` sees none of this (existing guards); BS sees the table (computed results) but not the OH input (BS gets read-only OH% — same principle as the cost-entry carve-out: BS views, internal decides).

## Verify before reporting
`node --check` extracted script · headless boots: internal (edit OH → table appears, math reconciles, reset works), BS partner (doc preview + read-only panel), generic partner (doc preview, zero cost DOM) · screenshots of client-tab preview and the per-item table · report with line ranges, print-vs-preview drift notes, escalations.
