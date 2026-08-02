# V14 WAVE 2 — ARCHITECTURE SPEC (split + tests + invariants)

_Fable-authored 2026-08-03. Strategy: **physical split first, ES modules second.** Stage A (this wave) splits the monoliths into per-domain `<script defer>` files that keep the `window.*` contract and load order — provably-equivalent moves, shippable per batch. Stage B (ESM + import map) happens only after Stage A is fully landed and boot-verified, as its own wave-section. Rationale: converting 28k lines to ESM in one motion is a big-bang rewrite; physical splits are `git mv`-grade refactors._

## Batch A — Money-math tests (I5) — RUN FIRST, exclusive files: js/money-core.js (new), js/statutory-tables.js, js/departments.js, tests/** (new), .github/workflows/ci.yml, index.html, sw.js

1. **js/money-core.js** (new): pure money functions, no DOM/Firebase. Move `window.vatSplit` (departments.js ≈9842) here **verbatim**. Evaluate `computePayLine` (departments.js ≈3201): move it ONLY if it is a self-contained pure function (no closure over render-local state); if it closes over anything, leave it in departments.js and note it for a later extraction. End the file with a UMD-style guard so Node can require it:
   `if (typeof module !== 'undefined' && module.exports) module.exports = { vatSplit, ... };`
2. **js/statutory-tables.js**: append the same module.exports guard (no logic changes).
3. **index.html**: load money-core.js immediately BEFORE departments.js. **sw.js**: add to PRECACHE.
4. **tests/money.test.mjs** (node:test, zero deps): vatSplit — inclusive/exclusive/exempt, zero, rounding edges, legacy no-vatAmount rows; computeStatutory — structure + `verified:false` flag surfaces + a few current-placeholder values (labeled as placeholder-pinning tests, updated when the accountant verifies); computePayLine (if moved) — base/allowance/deduction/CA scenarios pinned to current outputs (behavior-pinning: the tests document today's math, they do not redefine it).
5. **.github/workflows/ci.yml**: add a `node --test tests/` step alongside the existing node --check lint.
6. Salary/VAT math is byte-untouched — moves are verbatim; tests PIN current behavior.

## Batch B — Pilot extraction (I1 stage A pilot) — AFTER Batch A, exclusive files: js/screens/** (new), js/departments.js, index.html, sw.js

Pilot with the **Design department** (renderDesign + project detail + drawing detail, departments.js ≈7507–8600): move verbatim into `js/screens/design.js`, functions still attached to `window`. Load after departments.js (callers resolve at runtime via window). Add to index.html + PRECACHE. `node --check` both; boot must be zero-error with Design screens still routable. Report exact line ranges moved. This proves the extraction protocol; subsequent batches repeat it per domain (approvals, finance-reports, purchasing/production, sales/AEC, HR/payroll-UI…) in later sessions.

## Batch C — Invariants (I6) — anytime, exclusive: .github/workflows/ci.yml (after A)

CI greps that FAIL the build on: new `z-index:[0-9]{4}` literals in js/ (stacking regression), `openModal(` count increase beyond the blessed list (optional — skip if flaky), missing PRECACHE entry for any js/screens/*.js or css/*.css file referenced in index.html.

## Protocol (all batches)
Verbatim moves only; no behavior change. node --check everything; main session boots + commits per batch; nothing pushed without Neil. Version strings owned by the pre-commit hook.
