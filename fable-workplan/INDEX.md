# Fable Work Order — INDEX

**18 workstreams, each fully grounded in the current v12 code** (facts, file:line citations,
data shapes, constraints, open decisions — gathered by 18 parallel research agents on
2026-07-09 so this session's tokens go to ARCHITECTURE DECISIONS, not re-discovery).

**Read this INDEX only to pick where to start.** Each brief lives in its own file — open ONE at
a time, resolve its open decisions, write your spec back into that file (`**DECIDED:**` +
exact function signatures / before-after code / migration steps / rules diffs — precise
enough that Sonnet implements it afterward with zero further judgment calls), then move on.
Loading one ~25-40K-character brief per session is the cost-effective way to use this —
don't open all 18 at once.

Full vision + all 40 workstreams: [`../V12-PLAN.md`](../V12-PLAN.md). Audit report:
https://claude.ai/code/artifact/8185aea0-da1b-4769-8f81-4a9a224fe241

**Suggested order:** money/security first (13, 19, 20-27 are the highest-stakes — use
high/xhigh effort there), then the shared foundation (9, 10-11, 14) other work depends on,
then the rest. Cross-workstream note: 9 and 14 both touch document branding — read 14 before
finalizing 9's rename sweep so the two don't conflict.

## Phase 2 — Foundation

| WS | Brief | Open decisions | One-line current state |
|---|---|---|---|
| 09 | [09-brand.md](09-brand.md) | 9 | BRAND module + full rename sweep |
| 10-11 | [10-11-nav-dialogs.md](10-11-nav-dialogs.md) | 7 | URL routing + real Back + styled dialogs (no-pop-ups mandate) |
| 12 | [12-period.md](12-period.md) | 9 | Period engine + period close |
| 13 | [13-coa.md](13-coa.md) | 8 | Chart of accounts — fixes double material expensing (critical) |
| 14 | [14-letterhead.md](14-letterhead.md) | 8 | Shared document letterhead engine |
| 15 | [15-durability.md](15-durability.md) | 9 | Records durability — backups, restore, Drive privacy |
| 16 | [16-perf.md](16-perf.md) | 7 | Performance & scale — unbounded reads, caching |
| 17 | [17-design.md](17-design.md) | 10 | Design-system consolidation — CSS tokens, icons, themes |
| 18 | [18-shortcuts.md](18-shortcuts.md) | 10 | Keyboard shortcuts |
| 19 | [19-security.md](19-security.md) | 8 | Security closes — partner lockdown, secretary tier, attendance forgery |

## Phase 3 — Payroll & HR

| WS | Brief | Open decisions | One-line current state |
|---|---|---|---|
| 20 | [20-payroll-engine.md](20-payroll-engine.md) | 8 | One payroll engine — unify the two compute paths |
| 21 | [21-statutory.md](21-statutory.md) | 12 | Statutory tables — SSS/PhilHealth/Pag-IBIG/TRAIN + 13th month |
| 22 | [22-ca-installments.md](22-ca-installments.md) | 11 | Cash-advance installments in payroll (Neil's mid-session spec) |
| 23 | [23-raises.md](23-raises.md) | 8 | Effective-dated raises |
| 24 | [24-payslip.md](24-payslip.md) | 7 | The payslip — ONE branded template (print button currently dead) |
| 25 | [25-leave.md](25-leave.md) | 10 | Leave that actually works — balances never seeded today |
| 26 | [26-attendance-v2.md](26-attendance-v2.md) | 8 | Attendance v2 — time-out, hours, holidays admin |
| 27 | [27-ids.md](27-ids.md) | 5 | Employee + worker ID cards, worker-login unblock |

## Status

**DECIDED (Fable, 2026-07-10): 12, 13, 20, 22** — the money core. Each now carries a full
`## DECIDED` spec ready for Sonnet: WS13 (chart of accounts + double-expensing fix, composed
rules with WS12), WS12 (Period engine + finance_periods close, composed rules with WS13 —
implement 12+13 as ONE diff), WS20 (one payroll engine: lines[] frozen on pay_runs, money moves
at Disburse, Path B deleted, transition-aware pay_runs rules), WS22 (CashAdvance service:
approve/plan/deduct, installment default, four approval-path bugs closed — ships with WS20 or
standalone per its sequencing note).
Remaining 14 briefs: grounded, decisions open. Suggested next: 19 (security), 21 (statutory),
9+14 together (brand/letterhead), 10-11, then the rest.
