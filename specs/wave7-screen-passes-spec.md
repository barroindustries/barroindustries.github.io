# V14 WAVE 7 — SCREEN PASSES SPEC

_Fable-authored 2026-08-03. Ten sequential passes; each = the 8-point treatment + module extraction per the Wave-2 protocol (verbatim move to js/screens/<domain>.js, window-attached, loads after departments.js, index.html + PRECACHE). One Sonnet agent per pass; main session verifies/commits/pushes between passes (autonomy granted)._

## The 8-point treatment (apply to every screen in the pass)
1. chipTabs everywhere (kill any remaining hand-rolled .subtab-bar — Tasks, Brilliant Steel, Design project detail, legacy Cash are the known four).
2. Surfaces: openPage/sheet only; any straggler modal/detail flow onto the stack. **renderPayslipPage (raw #page-content swap) becomes an openPage in Pass 3.**
3. Loading/empty/error: skeletonHtml + renderEmptyState + error-with-retry on every async fetch (withLoadingAndError where shape fits).
4. Tables: .table-cards role classes if any dense table was missed.
5. Icons: Lucide-only in innerHTML sinks; aria-labels on icon-only buttons.
6. Headers: one page header; kill redundant stacked section headers.
7. Styling: confident token swaps as you pass (no forced sweep).
8. sopPanel where a department lacks one (Design, IT, Purchasing, Sales top-level are the known gaps).

## Passes (order; extraction target; scope notes)
1. **tasks.js** — Tasks board + Submissions + task detail/edit (already openPage) + Approvals stays in departments.js (too entangled with services; extract only if clean) — if Approvals extraction is unsafe, do its 8-point in place and say so.
2. **sales.js** — renderSales + AEC + quotations lists (+ revision-chain UI: quote lists gain a linked revision timeline using rootQuoteId/parentQuoteId from Wave 3 Q5 — the ONE net-new feature in Wave 7).
3. **hr-payroll.js** — HR hub, payroll management UI, payslip pages (renderPayslipPage → openPage), HR profiles, attendance admin bits living in departments.js. computePayRun/disbursePayRun/money logic STAY in departments.js (services, not screens).
4. **production.js** — Production + Purchasing + Inventory screens + projects lifecycle UI (posters/services stay).
5. **govit.js** — Gov Biddings (single tab definition — kill the duplicate declaration in renderDocCollection bucket config) + IT.
6. **partners.js** — Brilliant Steel + Partners dept + partner portal screens; parity audit across the 3 variants (report any screen missing from a variant).
7. **people.js** (from modules.js) — Posts, Team directory, Attendance, Leave, CA UI, Holidays, Company Overview.
8. **finance-screens.js** — the Finance render* UI shells (renderFinance nav, Overview, Records, Taxes shells; ledger/journals/reports RENDERERS may move; Ledger service + posters + financeDelete STAY in finance-ledger.js/departments.js).
9. **dashboards.js** — the 6 role dashboards + Company + Analytics + Memos/SOPs/Help + global search.
10. **Cleanup pass** — whatever remains in departments.js should be: shared services, shared renderers (doc collections, file collections), print builders. Report the final line counts of all files; delete provably dead code found along the way (list each).

## Protocol per pass
Verbatim moves (diff-verified); node --check all touched; tests 20/20; invariants pass (PRECACHE!); boot zero-error; report: functions moved + line ranges, 8-point changes made, anything deliberately left. Main session commits/pushes between passes.
