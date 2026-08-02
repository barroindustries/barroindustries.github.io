# V14 WAVE 3 — DOCUMENTS + QUOTE BUILDER SPEC

_Fable-authored 2026-08-03. Rulings applied: N2 = DELETE dormant pricing (markups + depth), prices unchanged. Autonomous commit+push authorized (verify first). Three batches: Q and E-core run in parallel (disjoint files); E-callers runs after the Wave-2B departments.js extraction lands._

## BATCH Q — Quote Builder v3 core (owns: quote-builder-v2.html, js/app.js)

Audit grounding (line numbers from the 2026-08-03 audit): localStorage saves on every keystroke (`saveToStorage` 2767) but `loadFromStorage` (2823) deliberately never restores (boot-clean at 2850). Filing → `postMessage QUOTE_FILED` → app.js bridge (9159) writes bk_quotes/bs_quotes with `editableState` (9200); re-filing always writes a NEW versioned copy ("(2)", 9213). Reopen: `reopenQuoteFromDoc` (app.js 1662) + 450ms `setTimeout` race (app.js ~1589) before `LOAD_QUOTE`. President-only in-place edit path exists: `REQUEST_STATE`/`saveReviewedPartnerQuote` `.update()` (app.js 1611).

- **Q1 (F1) Draft resume:** on boot, if localStorage has a non-empty unfiled draft (items or client fields), show an in-builder banner "Resume unsaved quote for ‹client›? [Resume] [Discard]" instead of silently booting clean. Resume restores all bkqb_* keys; Discard clears them. Never auto-restore silently.
- **Q2 (F4) READY handshake:** builder posts `{type:'QB_READY'}` to parent on init; app.js queues any pending LOAD_QUOTE/QUOTE_STATE payload and sends it only on QB_READY (fallback: keep a 2s timer as belt-and-braces). Delete the 450ms setTimeout race.
- **Q3 (F5) Full state round-trip:** add laborState, waive flags, custom overallLead (and anything else `buildQuotePayload` omits vs live state) to editableState (3005) and restore them in `loadEditableState` (3072).
- **Q4 (F3) Edit-in-place vs revision:** editableState carries the source docId + collection on reopen. When filing a reopened quote, builder asks (inline choice on the File flow, not a popup-on-popup): "Update original" → post `{type:'QUOTE_UPDATE', docId, collection, payload}` → app.js bridge `.update()`s that doc (mirror the president path); "File as new revision" → existing QUOTE_FILED path.
- **Q5 (F6) Revision links:** every QUOTE_FILED write adds `rootQuoteId` (the chain origin) + `parentQuoteId` (doc it was reopened from; null for fresh quotes) — app.js 9200-9221. (List UI showing chains = Wave 7 screen pass; fields land now.)
- **Q6 (F2) Cloud draft:** debounced (5s idle) `{type:'QUOTE_DRAFT', payload}` → app.js bridge writes `{...payload, status:'draft', draftBy:uid}` to the same collection with deterministic id `draft_{uid}` (one draft slot per user — overwrites). On File, the draft doc is deleted. Builder shows "Saved ✓ · just now" chip (updates on ack message from parent). NOTE for main session: firestore.rules must allow the draft path (create/update/delete own `draft_{uid}` doc) — main session edits + deploys rules, NOT this agent.
- **Q7 (N2 ruling) Delete dormant pricing:** remove retail/commercial/government markup constants from the coefficient editor UI + defaults (2546 area) — computePrice never applied them, so output is unchanged; delete the depth-scaling documentation from products-database.json ONLY if that file were in scope — it is NOT; instead just do not reference depth fields anywhere and note in report. Confirm via before/after computePrice runs on 3 sample products that prices are identical.
- **Q8 (F9) A4:** add `@page{size:A4 portrait;margin:11mm 10mm 7mm}` to the builder's `@media print` (≈393); delete the legacy `#printHeader` fallback branch (398-410) so `#lhPrintHeader` is the only header path; keep-together on totals + signature blocks.
- Also: photos/`quotePhotos` must survive Q1/Q3/Q4/Q6 paths (they already ride editableState — verify).

Verify: node can't parse HTML — instead extract inline `<script>` to a temp file for `node --check`; run computePrice sanity via a small node harness on the extracted functions if feasible; report what could not be exercised without a browser login.

## BATCH E-CORE — the A4 engine (owns: js/letterhead.js, js/print-docs.js, css/styles.css, css/tokens.css)

- **E1:** `buildLetterhead(opts)` gains `orientation: 'portrait'|'landscape'` (default portrait) and emits `@page{size:A4 ${orientation}; margin:11mm 10mm 7mm}` in printCSS instead of the hardcoded portrait rule.
- **E2:** print-docs.js BASE_CSS gets a default `@page{size:A4 portrait;margin:11mm 10mm 7mm}` so pop-up docs are A4 even without letterhead; callers' duplicate conflicting `@page` rules are E-CALLERS work (not yours).
- **E3:** styles.css same-document print blocks (`#page-content` ≈5445-scope, `.payslip-print`, `.bir-print`) each get `size:A4 portrait` added to their existing `@page{margin:…}`.
- **E4:** add `--brand-navy:#1E3A5F;` to css/tokens.css; letterhead.js default accent reads it conceptually (JS can't read CSS vars server-side — hardcode #1E3A5F as the JS default and comment the token linkage). Do NOT change call sites passing #1a237e (E-CALLERS).
- Verify: brace balance, no computed change to screen styles (print-only edits), node --check letterhead.js/print-docs.js.

## BATCH E-CALLERS (AFTER Wave-2B lands; owns: js/departments.js, js/bir.js, js/app.js)

- Inventory count form (departments.js ≈14338): pass `orientation:'landscape'`, delete its own conflicting `@page`.
- PO/Receiving/Delivery (≈15427/15556/13085): delete their duplicate `@page` rules (letterhead's A4 wins).
- Billing invoice (≈8498): `@media print{.page{width:auto;min-height:0;padding:10mm}}` — kill the 210mm overflow. 
- Delete the 3 divergent legacy hardcoded headers (invoice ≈8537, PO ≈8499, inventory ≈8400) — letterhead only.
- Accent unification: every `buildLetterhead({accent:'#1a237e'})` call → '#1E3A5F'.
- Financial Report (≈4447) + Payroll Reconciliation (≈3516): inject letterhead headerHTML into a print-target wrapper so they stop printing bare.
- bir.js: entity/branding untouched; just confirm its prints inherit E3's A4.
- ID cards (app.js 3966): leave mechanism, only confirm `@page{size:auto}` still local — folding onto the engine is deferred (low value).

Protocol: verbatim-preserving where possible, no behavior change outside print output; node --check; main session boots, commits, pushes.
