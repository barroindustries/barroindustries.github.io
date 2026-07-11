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
| 28 | [28-production-flow.md](28-production-flow.md) | ✅ DECIDED | Production process flow — rename stages to match the real shop floor |
| 29 | [29-inventory.md](29-inventory.md) | 9 (grounded, not decided) | Inventory correctness — moving weighted-average cost, receive-path bug confirmed |
| 30 | [30-purchasing.md](30-purchasing.md) | 12 (grounded, not decided — Wave B, needs WS29 first) | Purchasing — no PO approval gate exists at all today |
| 31 | [31-quotation-builder-v3.md](31-quotation-builder-v3.md) | 14 (grounded, not decided — Wave B, needs WS32 first) | Quotation builder v3 — Quick Quote mode, repair the quote→approval→order chain |
| 32 | [32-sales-crm.md](32-sales-crm.md) | ✅ DECIDED | Sales — Client Relations hub — bs_clients confirmed orphaned |
| 33 | [33-aec-directory.md](33-aec-directory.md) | ✅ DECIDED | AEC Partner Directory — wholly greenfield, strong existing analogs |
| 34 | [34-marketing.md](34-marketing.md) | 12 (grounded, not decided — Wave B, needs WS32+WS38 first) | Marketing suite — campaigns/leads/calendar greenfield, materials library is not |
| 35 | [35-design-suite.md](35-design-suite.md) | 10 (grounded, not decided — Wave B, needs WS32+WS38 first) | Design dept suite — drawing "approval" has no real approver gate |
| 36 | [36-finance-additions.md](36-finance-additions.md) | ✅ DECIDED | Finance additions — bank-accounts registry, no dimension exists anywhere |
| 37 | [37-team-chat.md](37-team-chat.md) | ✅ DECIDED | Team Chat — real-time listeners are genuinely new territory (only 3 exist today) |
| 38 | [38-files-hub.md](38-files-hub.md) | 14 (grounded, not decided) | Files Hub — found dead shadowed code; per-file sharing is architecturally hard |

## Phase 5 — Intelligence & BIR

| WS | Brief | Open decisions | One-line current state |
|---|---|---|---|
| 39 | [39-bir-suite.md](39-bir-suite.md) | 15 (grounded, not decided) | BIR suite — a 3000-row report-truncation landmine found; VAT partially already netted |
| 40 | [40-analytics.md](40-analytics.md) | 15 (grounded, not decided — Wave B, needs WS29+WS32+WS36 first) | Analytics with conclusions — 13 charts hardcode colors that clash with the new theme |

## Status — Phase 4+5: 5 of 13 DECIDED, 3 grounded-only, 5 not yet dispatched (2026-07-10)

**Decided (Fable decision session #4, 2026-07-10): WS28, WS32, WS33, WS36, WS37.** Each has a
full `## DECIDED` spec (resolved decisions, exact code/data shapes, rules diffs, migration +
test checklists) — ready for Sonnet to implement mechanically, same bar as Phase 2-3.

**Grounded but NOT yet decided (their Fable pass hit the account's session usage limit before
finishing — files are untouched, safe to resume, no corruption): WS29 (Inventory), WS38 (Files
Hub), WS39 (BIR suite).** Re-dispatch these 3 first — they were "Wave A" (independently
decidable) and several other undecided workstreams wait on them.

**Not yet dispatched at all (Wave B — depends on Wave A landing first): WS30 (needs WS29),
WS31 (needs WS32 — now available), WS34 (needs WS32 — now available — + WS38), WS35 (needs
WS32 — now available — + WS38), WS40 (needs WS29 + WS32 — now available — + WS36 — now
available).** WS31/34/35 can now read WS32's finished client-unification decision immediately.
WS40 still needs WS29 to land (WS36 is done).

**Cross-workstream dependencies** (read before dispatching Wave B): WS31 (quote fix) and WS32
(CRM hub, now DECIDED) both touch the BK/BS quote-collection split — WS31's Fable pass should
read WS32's finished spec before deciding. WS32 (now DECIDED) resolved the
`sales_clients`/`design_clients`/`bs_clients` three-way fragmentation that WS35 also
independently found — WS35's Fable pass should read WS32's decision and align to it, not
re-decide it. WS34's materials-library sub-feature and WS35's project/client folders both
overlap with WS38's Files Hub (not yet decided) — decide WS38 before WS34/WS35. WS28 (now
DECIDED) resolved the stage-rename-vs-public-tracker risk — see its own spec. WS40's win-rate/
cash-position/inventory-turns metrics are blocked on WS32 (done, use it), WS36 (done, use its
stated cash-position handoff), and WS29 (not yet decided — wait for it). WS39 (BIR) depends on
employee TIN/SSS#/PhilHealth# fields that don't exist on regular `users` docs today (only on
weekly `worker_profiles`) — a real data-capture gap, not just a reporting one; this is
self-contained within WS39's own decision, no external dependency.

### To resume in a new session (exact next steps)
1. Re-dispatch Fable-tier agents for **WS29, WS38, WS39** (the 3 that hit the session limit
   before finishing — same prompt pattern as WS28/32/33/36/37, see the git log commit
   "v12: Fable decision session #4" for the exact prompts used, or re-derive from each
   brief's own "Expected deliverable format" section).
2. Once WS29 + WS38 land, dispatch Wave B: **WS30** (reads WS29), **WS31** (reads WS32 —
   already done), **WS34** (reads WS32 + WS38), **WS35** (reads WS32 + WS38), **WS40** (reads
   WS29 + WS32 + WS36 — WS32/WS36 already done).
3. Commit each wave as it lands (`git add fable-workplan/NN-*.md && git commit`), matching the
   "Fable decision session #N" commit-message pattern already used 4 times this engagement.
4. Once all 13 are DECIDED, begin Sonnet implementation — same per-file parallel-subagent
   pattern used for WS09-27 (see V12-PLAN.md's Build Log for the exact playbook: implement →
   verify (`node --check`, rules brace-balance, cross-agent grep checks) → commit → deploy
   (`git push origin master` + `firebase deploy --only firestore:rules`/`storage` if rules
   changed)). Sequence implementation in the SAME dependency order as the decision waves
   above (Wave A workstreams' code before Wave B's, since Wave B's code will literally import/
   call things Wave A's implementation creates).

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
