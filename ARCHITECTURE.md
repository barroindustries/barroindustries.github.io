# Barro Industries Operating System — Architecture (v13)

Living document. Updated 2026-07-12 as v13 waves 1–17 shipped. Read with CLAUDE.md and V13-PLAN.md.

## Load-bearing services (all window-global, classic scripts)
| Service | File | Contract |
|---|---|---|
| `Ledger` | js/finance-ledger.js | THE money API. `post(entry)` / `postMulti(entries)` / `upsertByRef(ref, build)` — transactional, deterministic `ledger/{ref}` ids, unconditional `assertPeriodOpen`, central `vatSplit`, atomic `projectSync`, cache invalidation. **No feature code writes `collection('ledger')` directly.** `migrateLegacyRows({dryRun})` for the one-time id migration. |
| `Approvals` | js/svc-approvals.js | `dispatch(type, action, id, ctx)` registry — the ONLY approve/reject write path per type. |
| `CashAdvance` | js/config.js | Sole mutator of cash_advances/caBalance. Rounding: monthly first, totalPayable derived. |
| `Session` | js/app.js | `addCleanup(fn)` — every timer/listener holding user state registers; sign-out runs all. |
| `busy(btn, fn)` | js/config.js | Mandatory on every money/approval button (sync disable → finally restore). |
| `STATUS_META` / `statusBadge2(domain,id)` | js/ui-status-meta.js | One badge truth. 15 domains. Never hand-roll a status ternary. |
| `renderEmptyState` / `withLoadingAndError` | js/ui-states.js | Every fetch-render screen: loading + error(Retry) + empty. |
| `renderFinanceCrudTable(container,cfg)` | js/ui-crud-table.js | Config-driven finance CRUD (Taxes/Records/CRJ/CDJ adopted). |
| `openPrintableDoc(opts)` | js/print-docs.js | The only window.open print scaffold. |
| Formatters | js/config.js | `fmtPeso` / `fmtN2` / `fmtPesoWhole` / `fmtMonthLabel` / `fmtManila` / `bizDate/bizDow(dateStr?)`. No bare `toLocaleString` on money; no un-pinned date rendering. |
| `Notifs.success/error/info` | js/notifications.js | Typed toasts only; bare `showToast(msg)` dev-warns. Broadcasts carry deterministic dedup doc-ids + `senderUid`. |

## Hard conventions (enforced by CI where possible)
- **Router-only navigation**: pages change via `navigateTo`; every full-screen surface registers with `Overlay` (Back button = contract). Subtab deep-linking via `setSubroute/initialSubtab`.
- **escHtml on ALL user content incl. modal/page titles**; `safeHttpUrl` on user-supplied hrefs; `rel="noopener noreferrer"` on `target="_blank"`.
- **New file checklist**: script tag in index.html (order matters: helpers/services before departments.js) + sw.js PRECACHE + commit (hook bumps versions).
- **⚠️ Version-hook re-stage footgun**: the pre-commit hook re-stages config.js/index.html/sw.js — one concurrent editor per those files; `git diff --cached` before commit; see memory note.
- **Rules/functions/storage deploy separately from push**; re-`git diff` the rules file immediately before deploying; paired client+rules changes deploy rules FIRST.
- **z-index via --z-* tokens** (app layers); **type via --fs-* rem tokens**; print via the shared `@media print` visibility system (.print-target).
- **Firestore reads**: bounded queries; `dbCachedGet` with registered invalidation; `.catch` on list reads (blank-screen class).
- **CI guards** (.github/workflows/ci.yml): node --check sweep, Node-20 pin lint, backup-coverage check, UI-wiring guard (onclick→global hard-fail). Allowlists: scripts/ui-wiring-allowlist.json.
- **Money invariants**: V13-PLAN.md Part F1 is binding (Disburse-only money moves, financeDelete approval flow, Manila time, no pop-ups, period locks both sides).

## Target layout (Part D of V13-PLAN.md) — not yet executed
The app.js/departments.js/modules.js → ~35 ES-module split (Stage 3-4, Phases 32-34/36/38/41-50) remains
planned-not-built; run each split phase as its own session with full regression per the plan.
