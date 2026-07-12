# V13 Program Status — as of 2026-07-12 (waves 1–17)

Legend: ✅ shipped+live · 🟨 partial (noted) · 🧭 needs-Neil · 🏗 planned-not-built (see V13-PLAN.md for full instructions)
Production: **v12.0.105**, rules/storage/functions all deployed, CI green, zero boot errors.

## Part E — system phases 1–100
| Phases | Status |
|---|---|
| 1 (deploy gap) | ✅ push+rules+storage+functions live; 🧭 Phase-9 buttons remain |
| 2–4 (backup/restore) | ✅ comments+chat+subcollections backed up (proven: 78 rescued records); restore dry-run passed; 🧭 committed staging-restore drill + RESTORE_RUNBOOK.md |
| 5–8 | ✅ (hygiene, hardened tracked hook, CI, error logging? — **error_log = 🏗 Phase 8 not built**) |
| 9 | 🧭 president-console one-time buttons + remapDesignProjectClients |
| 10 | 🟨 QA-CHECKLIST.md not written; verification has been per-wave boot checks |
| 11–18, 20 | ✅ (Disburse lock, Ledger service + all posters, atomic IDs, cache/VAT/Manila/leave-guard fixes, CA single-writer, financeDelete fix, reconciliation report) |
| 19 | 🧭 D4/D5 rulings (per_length pricing activation, commission basis, rounding rule) then build |
| 21–23, 26–27, 30 | ✅ (rules validation, posts, storage ownership, QB XSS+partner gate, link hardening, SRI/CSP+dedup+senderUid quota) |
| 24–25, 28–29 | 🟨 24 documented-in-rules only; 25 needs D9 ruling (kpi_evals delete still isFinanceOrAdmin); 28 plaintext-password flow needs design ruling; 29 wire-hygiene queries not built |
| 31 | ✅ ARCHITECTURE.md |
| 32–34, 36, 38, 41–50 | 🏗 the ES-module/monolith splits — run as dedicated sessions per plan |
| 35, 37, 39, 40 | ✅ (Approvals service, migrations.js, print-docs, status-meta) |
| 51, 56, 57, 58 | ✅ CSS: dead-code, print layer, motion, z-scale. 52–55 (tokens/@layer/astral split) 🏗 |
| 59–68 | ✅ except 60 (secretary two-tier UI = 🧭 D9), 61 (SOP panels only on Approvals; per-dept rollout 🏗) |
| 69–72 | 🧭 leave policy/statutory verification/production-pay rulings |
| 73–78 | 🏗 feature buildouts (HR depth, quote→job-cost fn, inventory, PhilGEPS, CRM timeline, field ops) |
| 79–83 | 🧭 accountant-gated (13th-month fix buildable but D6 entity/TIN pending; COA/BS/CF/BIR finalization) |
| 84–86 | ✅ 84 journals backstop; 85–86 (finance_rollup, analytics bounding) 🏗 |
| 87–91 | 🏗 read-sweep/cache-v2/backup-v2/observability panel/device perf baseline |
| 92 | 🟨 validators+headers done; wildcard retirement pending migration confirmation |
| 93–95 | 🏗 docs rewrite, index reconciliation (ledger_entries branch 🧭), products pipeline |
| 96–100 | 🧭 full-role QA, security re-verification, decision clearance, v13.0.0 cut, post-launch watch |

## Part H — UI/UX phases 101–200
| Phases | Status |
|---|---|
| 101–110 | ✅ all (dead controls, badges, guards, Back-button integrity, orphan-route work 🟨 106/107 partially — route deletions & role-mismatch retargets not all done, wiring CI ✅) |
| 111–120 | ✅ all except 113 (🧭 rounding ruling) and 119 (glossary/naming sweep 🏗) |
| 121–122, 129a | ✅ ui-states kit + adoptions + icon dev-check |
| 123–128, 130 | 🏗 button/form/table/card kit codification + gallery |
| 131, 138 | ✅ touch targets, rem scale. 132–137, 139–140 🏗/🧭 (action bar D-U1, nav labels D-U2, orientation D-U3, device sweeps) |
| 141, 143, 145, 149a | ✅ ultrawide cap, hover, Keymap, selection. 142, 144, 146–148, 150 🏗 |
| 151–180 (screen passes) | 🟨 172a QB phone pass done; the rest need logged-in role/device QA — run as dedicated sessions with the Stage-U5 checklist |
| 181–190 | 🏗 (a11y/reliability depth) |
| 191–200 | 🧭 verification matrices + sign-off (require devices, roles, Neil) |

## THE PUNCH-LIST (only you can do these)
1. **President console once** (Phase 9): Finance→Reports "🔄 Sync to ledger" · Projects "🔖 Tag" · "🏷 Tag account types" → "🧾 Restate material costs" (past expense totals will drop — that IS the fix) · "🔧 Security backfill" · console `remapDesignProjectClients()` · then dry-run "🧭 Migrate ledger ids" and Apply if collisions=0 (collisions → Reconciliation report).
2. **Decisions** (V13-PLAN Part F2, D1–D20 + D-U1..U3): highest-impact first — D2 statutory tables with your accountant (longest lead), D1 leave policy (blocks accrual run), D4/D5 quote pricing (revenue), D9 secretary scope, D6/D7/D8 BIR entity/VAT/ATP.
3. **Tomorrow ~7:30AM Manila**: confirm the first scheduled attendance-reminder push arrives (Cloud Scheduler's maiden run).
4. **When ready**: a dedicated session per remaining 🏗 block — the monolith splits (Stage 3–4), CSS @layer split, screen-by-screen passes, then the 191–200 verification matrices and the v13.0.0 cut.
