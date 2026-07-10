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
| 09 | [09-brand.md](09-brand.md) | ✅ IMPLEMENTED | BRAND module + full rename sweep |
| 10-11 | [10-11-nav-dialogs.md](10-11-nav-dialogs.md) | ✅ IMPLEMENTED | URL routing + real Back + styled dialogs (no-pop-ups mandate) |
| 12 | [12-period.md](12-period.md) | ✅ IMPLEMENTED | Period engine + period close |
| 13 | [13-coa.md](13-coa.md) | ✅ IMPLEMENTED | Chart of accounts — fixes double material expensing (critical) |
| 14 | [14-letterhead.md](14-letterhead.md) | ✅ IMPLEMENTED | Shared document letterhead engine |
| 15 | [15-durability.md](15-durability.md) | ✅ IMPLEMENTED | Records durability — backups, restore, Drive privacy |
| 16 | [16-perf.md](16-perf.md) | ✅ IMPLEMENTED | Performance & scale — unbounded reads, caching |
| 17 | [17-design.md](17-design.md) | ✅ IMPLEMENTED | Design-system consolidation — CSS tokens, icons, themes |
| 18 | [18-shortcuts.md](18-shortcuts.md) | ✅ IMPLEMENTED | Keyboard shortcuts |
| 19 | [19-security.md](19-security.md) | ✅ IMPLEMENTED | Security closes — partner lockdown, secretary tier, attendance forgery |

## Phase 3 — Payroll & HR

| WS | Brief | Open decisions | One-line current state |
|---|---|---|---|
| 20 | [20-payroll-engine.md](20-payroll-engine.md) | ✅ IMPLEMENTED | One payroll engine — unify the two compute paths |
| 21 | [21-statutory.md](21-statutory.md) | ✅ IMPLEMENTED | Statutory tables — SSS/PhilHealth/Pag-IBIG/TRAIN + 13th month |
| 22 | [22-ca-installments.md](22-ca-installments.md) | ✅ IMPLEMENTED | Cash-advance installments in payroll (Neil's mid-session spec) |
| 23 | [23-raises.md](23-raises.md) | ✅ IMPLEMENTED | Effective-dated raises |
| 24 | [24-payslip.md](24-payslip.md) | ✅ IMPLEMENTED | The payslip — ONE branded template (print button currently dead) |
| 25 | [25-leave.md](25-leave.md) | ✅ IMPLEMENTED | Leave that actually works — balances never seeded today |
| 26 | [26-attendance-v2.md](26-attendance-v2.md) | ✅ IMPLEMENTED | Attendance v2 — time-out, hours, holidays admin |
| 27 | [27-ids.md](27-ids.md) | ✅ IMPLEMENTED | Employee + worker ID cards, worker-login unblock |

## Phase 4 — Operations & departments

| WS | Brief | Open decisions | One-line current state |
|---|---|---|---|
| 28 | [28-production-flow.md](28-production-flow.md) | 8 | Production process flow — rename stages to match the real shop floor |
| 29 | [29-inventory.md](29-inventory.md) | 9 | Inventory correctness — moving weighted-average cost, receive-path bug confirmed |
| 30 | [30-purchasing.md](30-purchasing.md) | 12 | Purchasing — no PO approval gate exists at all today |
| 31 | [31-quotation-builder-v3.md](31-quotation-builder-v3.md) | 14 | Quotation builder v3 — Quick Quote mode, repair the quote→approval→order chain |
| 32 | [32-sales-crm.md](32-sales-crm.md) | 14 | Sales — Client Relations hub — bs_clients confirmed orphaned |
| 33 | [33-aec-directory.md](33-aec-directory.md) | 12 | AEC Partner Directory — wholly greenfield, strong existing analogs |
| 34 | [34-marketing.md](34-marketing.md) | 12 | Marketing suite — campaigns/leads/calendar greenfield, materials library is not |
| 35 | [35-design-suite.md](35-design-suite.md) | 10 | Design dept suite — drawing "approval" has no real approver gate |
| 36 | [36-finance-additions.md](36-finance-additions.md) | 14 | Finance additions — bank-accounts registry, no dimension exists anywhere |
| 37 | [37-team-chat.md](37-team-chat.md) | 7 | Team Chat — real-time listeners are genuinely new territory (only 3 exist today) |
| 38 | [38-files-hub.md](38-files-hub.md) | 14 | Files Hub — found dead shadowed code; per-file sharing is architecturally hard |

## Phase 5 — Intelligence & BIR

| WS | Brief | Open decisions | One-line current state |
|---|---|---|---|
| 39 | [39-bir-suite.md](39-bir-suite.md) | 15 | BIR suite — a 3000-row report-truncation landmine found; VAT partially already netted |
| 40 | [40-analytics.md](40-analytics.md) | 15 | Analytics with conclusions — 13 charts hardcode colors that clash with the new theme |

## Status — Phase 4+5 GROUNDED, not yet DECIDED (research pass, 2026-07-10)

All 13 Phase-4/5 briefs are now fact-gathered (file:line citations, current-state findings,
data shapes, open decisions) — the SAME grounding pass Phase 2/3 went through before Fable
decided their architecture. **None of these 13 has a `## DECIDED` section yet.** Per the
established cost-effective split (Fable decides, Sonnet implements mechanically), the next
step is a Fable session per brief — do NOT let a Sonnet session invent these architecture
decisions.

**Cross-workstream dependencies surfaced by this research pass** (read before assigning a
build order): WS31 (quote fix) and WS32 (CRM hub) both touch the BK/BS quote-collection
split — resolve WS31's `bs_quotes` stranding bug before or alongside WS32's client-unification
decision. WS32 and WS35 independently confirmed the same `sales_clients`/`design_clients`/
`bs_clients` three-way fragmentation — one decision should cover both. WS34's materials-library
sub-feature and WS35's project/client folders both overlap with WS38's Files Hub — sequence
WS38 first if its scope includes killing the underlying `files_<scope>` pattern. WS28's stage
rename risks silently breaking the public order-tracker's three independently-drifting
translation maps — do not decide WS28 without reading that risk note. WS40's win-rate/
cash-position/inventory-turns metrics are each blocked on WS32/WS36/WS29 respectively landing
first. WS39 (BIR) depends on employee TIN/SSS#/PhilHealth# fields that don't exist on regular
`users` docs today (only on weekly `worker_profiles`) — a real data-capture gap, not just a
reporting one.

## Status — Phases 2+3 ALL 18 DECIDED (Fable, 2026-07-10) ✅

Every Phase-2 + Phase-3 brief now carries a full `## DECIDED` spec (resolved decisions + exact
signatures, before/after code, data shapes, rules diffs, migration + test checklists) — ready for
Sonnet to implement mechanically.

- **Phase 2:** 09-brand, 10-11-nav-dialogs, 12-period, 13-coa, 14-letterhead, 15-durability,
  16-perf, 17-design, 18-shortcuts, 19-security — DECIDED.
- **Phase 3:** 20-payroll-engine, 21-statutory, 22-ca-installments, 23-raises, 24-payslip,
  25-leave, 26-attendance-v2, 27-ids — DECIDED.

**Seams reconciled post-merge:** letterhead API is canonically `window.buildLetterhead(opts)`
(WS14 owns it; WS24 calls it); `window.BRAND` is canonically WS9's (WS27's interim dropped, add
`verifyBase`). See the `‼️ SEAM RECONCILIATION` notes in 24/27/09.

### Recommended Sonnet implementation order (dependency-safe)
1. **12 + 13 together** (one diff — shared functions + composed ledger rules).
2. **19** (security rules — foundational; unblocks worker login for 27).
3. **09 + 14** (BRAND + letterhead — many later docs depend on them).
4. **20 + 21 + 22** (payroll bundle — one engine; statutory + CA plug into its lines[]).
5. **23, 24** (raises, payslip — depend on the payroll bundle).
6. **10-11** (routing + dialogs — large mechanical migration).
7. **15, 16, 17, 18** (durability, perf, design system, shortcuts — mostly independent).
8. **25, 26, 27** (leave, attendance v2, IDs).

### ‼️ Items that need Neil (not decideable by engineering)
- **WS21 statutory rates** — placeholders; an accountant must verify 2026 SSS/PhilHealth/Pag-IBIG/
  TRAIN numbers and flip `verified:true` before payroll go-live.
- **WS20 'performance' pay policy** — ships inert on 'flat'; Neil flips it to change pay basis.
- **WS22 CA interest default** (2%/mo vs 0) + mid-repayment interest-mismatch list.
- **WS09** — OPC TIN missing from code; the false 'Business Intelligence Platform' Company-tab
  prose needs a real rewrite.
