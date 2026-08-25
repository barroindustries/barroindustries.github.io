# BREAK-EVEN v2 — editable overhead, payroll split, profit-goal sales target

**Date:** 2026-08-26 · **Author:** Fable · **Builder files:** `js/money-core.js`, `js/screens/finance.js`, `tests/money.test.mjs` ONLY.
**Neil's asks:** "allow me to edit the overhead" + "i want to know how much we need to sell to make profits".

Context: `window.computeBreakeven` (js/money-core.js ~:300) already returns `{fixedTotal, variableTotal, contributionMarginRatio, breakEvenRevenue, coveragePct, gapToBreakEven, classifiedFixed[], classifiedVariable[], unclassified[], perDayNeeded(days)}` from `finance_config/breakeven` config `{fixed[], variable[], none[], manualFixed[{label,amount}]}` with keyword fallbacks (finance.js ~:1018). The Break-even tab is `renderBreakevenTab` (finance.js ~:1054). Verify all anchors by search.

## 1 · money-core (keep backward compatible; extend, don't rename)
- Add to the result object: `contributionPesos` (= income − variableTotal, null-safe) and `requiredSales(profitTarget)` — a function like `perDayNeeded`: `(fixedTotal + max(0,profitTarget)) / contributionMarginRatio`, null when ratio is null/≤0.
- **Payroll split correctness fix:** today the whole category `Payroll Expense` keyword-classifies as FIXED, which wrongly treats fabricator direct labor as overhead. Implement split support: computeBreakeven gains an optional `payrollSplit` input `{directPesos, officePesos}`; when provided, it replaces the single Payroll Expense amount with two synthetic classified entries: office → fixed ("Payroll — Office"), direct → variable ("Payroll — Fabricators (direct labor)"). No behavior change when absent.
- Extend `tests/money.test.mjs` with cases: requiredSales math (550000 fixed, 0.30 ratio, 0 profit → 1,833,333.33; with profit target), contributionPesos, payrollSplit reclassification. Run the test file and make it pass (`node tests/money.test.mjs` or however it runs — check its header).

## 2 · Break-even tab (finance.js)
- Compute the split for the selected month: fetch ledger rows via `window.ledgerForPeriod(periodKey)` (config.js ~:1169), filter `category === 'Payroll Expense'`, sum by `refNumber` prefix — `PAYW-`, `WPAY-`, `NETPAYW-`, `SSSPAYW-` etc. (weekly/worker refs) → `directPesos`; everything else (`PAY-…`) → `officePesos`. Pass as `payrollSplit`. Cache with the tab's existing data loading pattern.
- **Overhead card (editable):** list classified fixed rows (category + amount, read-only — they come from the ledger) THEN the `manualFixed` rows with add / edit / delete (label + amount inputs), saved to `finance_config/breakeven.manualFixed` — write gated by the tab's existing finance permission (whatever gates the classification config today; verify and reuse). Show **Total monthly overhead ₱X** prominently. Include a one-line hint that fabricator payroll is auto-classified as direct labor via ledger refs, not overhead.
- **Contribution card:** contribution in pesos + margin %, from the extended result.
- **Profit goal:** number input (default from `finance_config/breakeven.profitGoal` or 0), persisted on change to the same config doc. Display: `Required sales = (overhead + goal) ÷ CM%` as **"Sell ₱X/month to make ₱goal profit"**, plus per-day for the days remaining this month (`bizDate()` for today), plus a progress bar of month-to-date income vs required (reuse existing bar/kpi classes).
- Keep every existing metric the tab shows today; this is additive. `escHtml` on labels; `fmtN2` money; toasts via `Notifs.success/error`; `.catch` fallbacks on all reads.

## Guardrails
No git stash/reset/checkout/clean; no commits; no other files; escalate ambiguity in the report. `node --check` both JS files; run the money tests; headless boot for console errors; state honestly what needs login. Report functions touched with line ranges + test output.
