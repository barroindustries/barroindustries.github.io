# V14 WAVE 4 — FINANCE SPEC

_Fable-authored 2026-08-03. Rulings applied: N4 = 7-group layout APPROVED. N1 = accountant pending → statutory stays placeholder, D10 hard-block ships. Batches run SEQUENTIALLY (all touch departments.js). Line numbers shifted by the Wave-2B Design extraction (~1,000 lines) — grep function names, never trust absolute numbers. The ledger is the single source of truth; deterministic refs; never double-count (see finance memories). Salary MATH untouchable; tests/money.test.mjs must pass after every batch._

## Batch F1 — IA restructure (departments.js)
renderFinance currently renders 18 chips in two groups (finTabs+hrTabs). Rebuild as the approved 7 groups:
1. **Overview** (existing Overview)
2. **Money In/Out** — merged surface: Ledger + Cash Receipts + Cash Disbursements as segmented sub-chips INSIDE the group (keep the three underlying render functions; this is navigation-level grouping, not a data merge). Bank Accounts lives here too.
3. **Reports** (Financial Reports + period compare)
4. **Payroll & HR** — Payroll, HR Profiles, Cash Advances, SSS/Gov
5. **Purchases & Inventory** — Purchases, Inventory, Sales Orders
6. **Taxes & BIR** — Taxes, BIR
7. **Records** — Records, Tasks
- Alias map: every OLD chip key must still resolve (deep links, initialSubtab, notifications) — e.g. 'Ledger' → group 'Money In/Out' sub-chip 'Ledger'. NO dead route.
- **Finance Tools page**: new president-only page (openPage from a button in Overview header) hosting the 5 maintenance buttons currently cluttering Reports (Tag account types / Restate material costs / Fix undated / Migrate ledger ids / Sync to ledger) + the CA data repair. Their handlers move verbatim.
- DEPARTMENTS.Finance.subtabs (config.js is NOT yours — report the new truthful list; main session updates config).

## Batch F2 — finance_rollup (finance-ledger.js + departments.js + scripts/monthly-backup.js)
- `finance_rollup/{yyyymm}` doc: `{month, income, expense, vatOutput, vatInput, byCategory:{cat:{income,expense}}, count, updatedAt}`.
- Maintained INSIDE Ledger.post/postMulti/remove/upsertByRef transactions (increment deltas; remove/edit = subtract old + add new). Manila month from the row's date via bizDate discipline.
- `Ledger.rebuildRollups(fromMonth?)` — president tool (add to Finance Tools): full scan → rewrite all rollup docs; idempotent.
- Repoint Overview totals + all-time cards to rollups (sum 12/N docs); Reports keep row-level reads for drill-down. Until `rebuildRollups` runs once, rollups are incomplete → Overview shows a one-line "Totals need a rebuild — Finance Tools → Rebuild rollups" notice when rollup docs are missing for months that have ledger rows (cheap existence check).
- **Rules + backup (MAIN SESSION, not agents):** firestore.rules match for finance_rollup (read: canFinance/isAdmin; write: same — client-maintained), EXPORTS += 'finance_rollup' in scripts/monthly-backup.js.

## Batch F3 — Interactive Reports (departments.js)
- Income Statement rows clickable → openPage drill-down listing the underlying ledger rows for that category+period (reuse ledgerForPeriod filter), CSV export of the drill.
- Period compare: current vs previous period + same period last year (3 columns, delta %, momDelta helper exists).
- Reports header cleaned (maintenance buttons already gone via F1).

## Batch F4 — Payroll correctness + UX (departments.js + bir.js)
- **13th month**: replace baseSum/12 with months-actually-worked (hire month from employee profile startDate if present, else first month with salary_history/pay data; document fallback). Fix BOTH sites (payslip model builder + bir.js Alphalist) + add "estimate" banner on the Alphalist figure. UPDATE tests/money.test.mjs if computePayLine surface changes (it shouldn't — 13th month is computed outside payLine).
- **D10 hard block**: disbursePayRun refuses (clear dialog, not toast) while window.STATUTORY?.verified !== true. Compute/Verify still allowed.
- **One-sheet expense approval**: approve flow's second promptBankAccount modal folds into the approve sheet (bank select inside the confirm surface). promptBankAccount stays for other callers.
- **Payroll card reflow**: ≤700px the 14-col payroll table renders as cards (name/photo/net prominent; tap expands full breakdown). Pattern: a `.table-cards` variant — put the CSS in styles.css (you own it this batch) as the REUSABLE pattern (Wave 6 reuses it).
- Payroll reconciliation report behind the existing president button: ledger PAY- rows vs pay_runs lines vs salary_history for a month — three-way diff table, mismatches highlighted, CSV. Read-only.

## Batch F5 — Balance Sheet + Cash Flow + Bank Reconciliation (departments.js, bir.js)
- **BS**: as-of-date report — Cash (per bankAccountId + unassigned), AR (billing invoices unpaid — sales_orders/billing docs), Inventory (from inventory valuation if present, else omit with note), CA receivable (CashAdvance balances), AP (unpaid POs if tracked), Equity = plug (assets − liabilities) labeled "computed". Working-paper styling like the FS, DRAFT watermark until accountant.
- **CF**: month range — operating in/out from ledger cash rows grouped by category, per-bank ending balances.
- **Bank reconciliation**: per bank account — ledger rows vs manual statement-balance input; running cleared/uncleared toggle persisted on the ledger row (`cleared:bool`); difference surfaced. Rules: ledger row update of `cleared` only for canFinance.
- All three: print via the A4 engine, letterheaded.

## Protocol
Per batch: node --check, `node --test tests/*.test.mjs` 20/20, boot zero-error, invariants pass, commit+push (autonomy granted). Rules/backup edits + `firebase deploy --only firestore:rules` are MAIN-SESSION steps after F2 and F5 (re-diff first).
