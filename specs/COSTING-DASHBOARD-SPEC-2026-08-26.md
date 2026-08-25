# COSTING DASHBOARD — Analytics "Costing" subtab + live pace feed

**Date:** 2026-08-26 · **Author:** Fable · Neil: "dashboard build or integrate in analytics with the breakeven" → integrate into **Analytics**, powered by the SAME break-even engine (one truth). Editing overhead stays on Finance › Break-even; the dashboard reads and links.

Two independent workstreams (separate builders, no shared files):

## Workstream A — files: `js/screens/dashboards.js`, `js/money-core.js`, `js/screens/finance.js`, `tests/money.test.mjs`

### A1 · Shared payroll-split helper (money-core)
Move the refNumber-prefix payroll split into money-core as `window.payrollSplitFromRows(rows)` → `{directPesos, officePesos}` (same prefixes finance.js's `beComputePayrollSplit` uses today — `PAYW-`,`WPAY-`,`NETPAYW-`,`SSSPAYW-`,`PHPAYW-`,`HDMFPAYW-`,`WHTPAYW-`,`EMPDEDW-`,`CADEDUCTW-` → direct). Rewire finance.js's helper to delegate to it (keep its name/callsites). Add 2 tests. Backward compatible, additive.

### A2 · Analytics subtab (dashboards.js, `renderAnalytics` ~5526)
- Add `{id:'costing',label:'Costing',icon:emojiIcon('🧮',16)}` to `SUBTABS`; filter it out for secretary exactly like the finance tab (money-tier). Add its dispatcher case + lazy renderer following the existing per-subtab pattern (Phase 86), reusing `_noteDenied` for permission-denied reads.
- **Data (current month, Manila via `bizDate()`):** ledger rows via `window.ledgerForPeriod(month)` (catch→denied); classification config `finance_config/breakeven` (catch→defaults); `window.computeBreakeven` with `payrollSplit` from A1 — identical inputs to the Break-even tab so numbers can never disagree.
- **Cards:**
  1. **Overhead pool** — fixedTotal ₱, top 5 fixed rows + manualFixed total, note "fabricator payroll counted as direct labor, not overhead". Chip-link "Edit overhead → Finance › Break-even" (use the exact `navigateTo` key the app uses for the Finance dept page; state in report which key).
  2. **Contribution MTD** — contributionPesos + CM% + progress bar vs target, where `targetContribution = fixedTotal + profitGoal` (profitGoal from the same config doc; 0 default). Sub-line: required sales for the goal via `requiredSales(profitGoal)` + per-day for days remaining.
  3. **Pace factor** — `pace = clamp(1 + 0.5×(1 − MTDcontrib/(targetContribution×elapsed))×elapsed, 0.85, 1.25)` with `elapsed = dayOfMonth/daysInMonth` (Manila). Show the gauge + the inputs that produced it. Guard: targetContribution ≤ 0 → pace 1.00, note "set overhead/profit goal".
  4. **Suggested OH%** — read `product_costs/_settings` (catch→code defaults matching quote-builder's `COSTING_DEFAULTS`: baseOH .25, ohMin .10, ohMax .45): `clamp(baseOH × pace, ohMin, ohMax)` shown with a static size-band reference table (0.7×–1.5×) and caption "per-quote size factor applies on top".
  5. **6-month trend** — `finance_rollup/{YYYY-MM}` for last 6 months (catch→denied): bars of income vs expense with a fixed-cost line if cheaply derivable from byCategory + classification; keep it simple, Chart.js like the rest of the screen, period label honest.
- **Publish the pace feed:** after computing, write `product_costs/_pace` = `{pace, baseOH, suggestedOH, computedAt: ISO now, byUid}` with `{merge:true}`, wrapped in catch (write allowed for senior-admin/finance per existing rules; silent skip on denial). This is what makes the quote builder's pace chip go live.
- Break-even tab (finance.js): add a small "Costing dashboard → Analytics" chip-link near its header (one line, reuse existing badge/chip classes).

## Workstream B — file: `quote-builder-v2.html` ONLY
- In the existing `!PARTNER_MODE` settings fetch (`Promise.all` in `loadDatabase`), also read `product_costs/_pace` (catch→null).
- In `computeTrueCost()`: if `_pace.computedAt` is within **7 days**, use `pace = clamp(_pace.pace, 0.85, 1.25)`; else `pace = 1`. `ohPct = clamp(baseOH × pace × sizeF, ohMin, ohMax)`.
- Panel chip: `pace ×1.061 · as of <short date>` when live, `pace —` (unchanged) when stale/absent. Title tooltip: "published by the Analytics costing dashboard".
- Same isolation rules as before (read stays inside `!PARTNER_MODE`; no partner-visible changes). `node --check` the extracted script + headless internal & partner boots.

## Shared guardrails
No git stash/reset/checkout/clean; no commits; additive only; escHtml on rendered strings; `.catch` on every read; `bizDate()` for all date math; verify with node --check + tests (A: run full `node --test tests/*.test.mjs`) + headless boot; honest report with line ranges + escalations.
