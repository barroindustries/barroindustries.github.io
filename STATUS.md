# STATUS — Barro Industries Operations System

> **This is the one page that is always current.** Read it first, every session.
> Update it before ending any session that changes state (same discipline as the version bump).
> History lives in [ROADMAP.md](ROADMAP.md) (frozen), plans in [docs/plans/](docs/plans/), audits in
> [docs/reviews/](docs/reviews/), feature specs in [specs/](specs/).

_Last updated: **2026-08-31**_

> **2026-08-31 owner rulings (costing):** consumables are **8% of MATERIALS** (was 8% of labor) — shipped in quote-builder-v2's true-cost engine, with why-tooltips on the waste/consumables rows. Real overhead entered in `finance_config/breakeven.manualFixed`: rent 50k + owner 100k + admin 75k + barracks 10k + travel 20k + marketing 30k + **Crew Standby Reserve 130k (₱30k/wk idle-crew backup)** + **Contingency buffer 85k** = **pool FIXED at ₱500,000/mo** (₱285k operating + ₱215k reserve & buffer; deliberate extra room — strong months over-fund, surplus backs up weak months; utilities absorbed by the buffer). Account structure proposed (OH/Crew/Materials/Tax/Savings/Equipment/Profit, waterfall funding) — see the pricing deck artifact. **OPTION B ADOPTED in the quote builder** (same day): suggested OH% is now the flat 25% base — pace/size compute as advisory chips only, no longer priced; `product_costs/_settings` seeded (crewWeekRate 40,000 = real crew cost, baseOH .25, targetMargin .20, laborPctOfMaterials .80) so custom labor prices at ₱6,667/day. **FINAL COSTING CONSTANTS (08-31 night, supersede all earlier same-day splits):** the selling peso = **40¢ direct · 30¢ OH · 30¢ MK** → OH 75% + MK 75% on direct (totalLoad 150%), **selling = direct × 2.50** rounded to ₱100; **labor is a formula line: +80% of materials** unless a POSITIVE crew-days/hours entry overrides (typed zero no longer drops it — v14.0.222); buildup order Waste → Labor → Consumables, **consumables +10% of materials (raised from 8%, v14.0.217)** → direct = materials × 1.96 when labor is assumed; crew default 40k/wk in code too. New targets: **floor ₱833,333 · quota ₱1,666,667 · ₱500k profit at quota** (pool ÷ 0.60 / ÷ 0.30). Custom-item BOM + computation opens as a POPUP modal (🧮 button per line; auto-opens on new custom items; follows edits live). **Admin view retired from the quote builder**; the product database editor now opens via the 📦 button beside the DB status bar (with ← Back; partners never see it) — the "needs a new home" flag is resolved. **Quick Quote retired** (buttons + ?mode=quick entry removed; wizard code dormant). **Labor & timeline estimate REPLACED by a Miscellaneous Costs table** (delivery/permits/rentals; each entry prices at cost × 2.5 rounded to ₱100; ticked = own MISCFEE line on the quotation, unticked = distributed into chosen item prices proportionally; reopened quotes adopt their MISCFEE lines back). **Misc carries NO MK — cost + 25% OH only (miscOhPct .25 in _settings, v14.0.223)**: items sell ×2.50, misc ×1.25, aggregate buildup splits the two paths and reconciles to the peso with the lines. **Internal cost surface REDESIGNED as one calculator (v14.0.224)**: "🧮 Calculator (Internal)" = the build waterfall (materials → +6% waste → +80% labor → +10% consumables → DIRECT → OH/MK dials → SELLING items → +misc → SELLING total → QUOTED with delta chip, floors + margin) beside an experiment table (per line: direct/u, sell/u, EDITABLE price/u bound to updatePrice, MK-eff, auto/manual chips); SHADOW chip replaced by "LIVE — this calculator prices the quote"; old Capital & Labor table retired. **Internal = NUMBERS ONLY (v14.0.225)**: the nine document sections (quote no., client, photos, delivery/timeline/payment/remarks, terms & conforme) carry .doc-details and collapse behind a 📄 Quote details toggle (static body.doc-details-collapsed default; partners un-collapse in applyPartnerMode; screen-only CSS so print/preview cloning untouched). Tutorials v12+v13. Earlier same-day iterations for history: **OPTION B v2 (superseded):** MK is a loading on DIRECT like OH and **OH + MK = 50%** — selling = direct × 1.50; **computed prices now FLOW INTO the quote** (each costed line auto-prices at direct/unit × 1.5 rounded to the nearest ₱100 so prices end in 00; hand-typed price sticks as a "manual" MK override, MK-effective column shows what it implies; ↺ re-apply link resets). MK% input added beside OH% (the two balance). New economics: **floor ₱1.5M · quota ₱3.0M · ₱500k profit at quota** (pool×3 / pool×6, derived). NOTE: costed CATALOG items also auto-reprice — this is the price cutover for any product with a capital-cost basis. **Pace dashboard retuned to Option B** (dashboards.js renderCosting): OH tile fixed 25% + ×1.5625 multiplier, pace relabeled advisory, `_pace` publishes flat suggestedOH (regime:"fixed-b") so even stale QB caches price flat, contribution uses a standard-cost estimate (materials × 1.94: waste 6% + consumables 8% + labor 80% of materials) when no variable costs are classified, and the card shows the derived floor/quota vs MTD sales. Direction set: fixed OH% + fixed markup, price varies only with measurements/specs; crew-week rate is really ₱40,000 (engine still charges 30k — pending `product_costs/_settings` seed).

## Where the project is

| | |
|---|---|
| **Production** | v14.0.203 (auto-bumps each commit — live check: `curl -sL https://barroindustries-operatingsystem.ravenmails.com/js/config.js \| grep APP_VERSION`) |
| **Deploy** | `git push origin master` → GitHub Pages (custom domain above; the github.io URL 301s to it). Firebase surfaces deploy separately — use `scripts/release.sh`. |
| **Active program** | V14 overhaul ([docs/plans/V14-OVERHAUL-PLAN.md](docs/plans/V14-OVERHAUL-PLAN.md)) — Wave 1 + 2A live. Current build thread: **costing system** (phases 1–2 shipped: true-cost panel, material price list, custom-item BOM, break-even v2, pace dashboard). NEW 2026-08-31: **Inventory department** ([specs/INVENTORY-DEPT-SPEC-2026-08-31.md](specs/INVENTORY-DEPT-SPEC-2026-08-31.md)) — Stock / Raw Materials (price list, moved from Purchasing) / Finished Products (catalog view) / Movements / Count Form (moved from Production); Production slimmed 8→5 tabs, Purchasing 5→4; `inventory_items`/`stock_movements` write rules tightened to Inventory/Purchasing/Production/Finance + senior admins (was: any internal staff; secretary now view-only). ALSO 2026-08-31 (v14.0.203): quote builder ships a built-in **Help & guided demo** — ❓ Help button, first-run "New to the quote builder?" banner, 14-step read-only spotlight tour, What's New panel — under a self-updating contract: every user-visible QB change must bump `TUTORIAL_VERSION` + add a What's-New entry ([.claude/skills/quote-builder-tutorial/SKILL.md](.claude/skills/quote-builder-tutorial/SKILL.md), spec [specs/QB-TUTORIAL-SPEC-2026-08-31.md](specs/QB-TUTORIAL-SPEC-2026-08-31.md)). |
| **Blocked on owner** | Office/monthly payroll disbursement — waiting on verified 2026 statutory rates (ruling #1 below). Everything else about office pay is built. |
| **Commit gates** | `node --test tests/*.test.mjs && bash scripts/ci-invariants.sh && node scripts/check-ui-wiring.js` — all three, before every commit. |

## Pending deploys & one-time actions

Run `scripts/release.sh` for the live drift report. Tick items here when done — this register is
what the script prints.

<!-- PENDING-OPS:BEGIN -->
- [x] **PUSH HELD — commit fce2637 (v14.0.200) local-only** — resolved 2026-08-31: the Inventory-department commit (v14.0.202) landed `js/screens/inventory.js` and both were pushed together; rules deployed first.
- [ ] **Seed the Material Price List** — President → costing screen seed button (shipped v14.0.191, never clicked). Costing math reads placeholder prices until then.
- [ ] **Phase-9 president one-time buttons** (pending since July): Finance → Reports → "🔄 Sync to ledger"; Projects → "🔖 Tag"; `remapDesignProjectClients` (browser console). All idempotent.
- [ ] **Verify `backfillUserClaims` was run** after the V11.1 storage-claims deploy (president, browser console). If unsure, run again — idempotent. Until it runs, Storage role-scoping treats un-stamped accounts wrong.
- [x] **Record the deploy baseline** — done 2026-08-30 (owner-confirmed): all 14 deployed functions diffed clean against repo exports; firestore/storage/functions hashes recorded. `release.sh push` now enforces, not warns.
<!-- PENDING-OPS:END -->

## Open rulings — decisions only the President can make

Ten-minute review at the start of any working session. Oldest first within severity.

| # | Raised | Decision needed | Blocks |
|---|---|---|---|
| 1 | 2026-08-10 | Enter + attest the **2026 SSS / PhilHealth / Pag-IBIG / withholding rates** at Finance → Taxes & BIR → Gov Rates (accountant's figures — never invented; the app refuses to disburse on placeholders by design). | **All office/monthly payroll.** |
| 2 | 2026-08-24 | Activate the **office pay split+flip** (₱10k base + KPI incentive, attendance retired) — after #1. | New office pay model going live. |
| 3 | 2026-07-12 | **D4/D5 quote math**: per-length pricing activation, commission basis, rounding rule. | Quote-math build (V13 Ph 19). |
| 4 | 2026-07-12 | **D9 secretary two-tier scope**: kpi_evals delete tier + minor-approvals UI. | V13 Ph 25/60. |
| 5 | 2026-08-10 | **HR gating**: should HR screens follow *department* rather than role? May HR staff create logins? | HR dept usability; onboarding ownership. |
| 6 | 2026-07-12 | **Password-reset flow** design (replaces the old plaintext-token idea, V13 Ph 28). | Password hygiene closure. |
| 7 | 2026-07-12 | **Leave policy + production-pay rulings** (V13 Ph 69–72). | Leave & PH holidays reaching either pay run. |
| 8 | 2026-08-10 | **Meetings**: add a `department` field (schema change)? Secretary calendar read scope. | Calendar privacy. |

Smaller pending rulings live in V13-PLAN Part F2 (D-registry) — none block money.

## Backlog — one ranked list (merged from V13 leftovers, V14, PERF wave-2, payroll review, handoffs)

1. **Statutory rates → payroll activation** (rulings #1–2; owner action, not a build).
2. **Costing cutover**: seed the price list, adopt the pace dashboard in daily use, enforce the custom-item gate end-to-end.
3. **Payroll correctness tail** (payroll review Ph 1–2): pro-rating for mid-period hires/leavers, effective-dated raises (running June must pay June's rate), leave + PH holidays into both runs, past-day attendance correction, layoff SoA final-pay + ledger entry.
4. **V14 remaining waves**: window-system leftovers, inline-style sweep batches, A4/print unification (see V14-OVERHAUL-PLAN).
5. **Release ritual owed from V13 (Ph 96–100)**: full-role QA + security re-verification + decision clearance — run as V14's closing wave.
6. **President "Pending ops" in-app panel** — surface the one-time-actions register above inside the app so unclicked buttons are visible where they live.
7. **PERF wave 2**: split hr.js / chat.js / dashboards.js payslip renderer; slim production.js out of 8 bundles; Lucide subset; CSS dedupe.
8. **Weekly-run parity steps 8–11**: adjust-panel hardening, batch payslip printing with per-worker receipt, Workers sub-view.
9. **Test breadth**: route-smoke test (render every route headlessly, fail on console errors) + Firestore rules emulator tests for the enumerated-collection coverage.
10. **Mobile one-window-at-a-time completion** (visual-viewport work shipped; true single-window model still owed).
11. **V13 module splits 32–50, CSS 52–55, finance_rollup 85** — *proposed KILL* as superseded by V14 + PERF work. Neil to confirm keep/kill.
12. **Accounting depth** (chart of accounts, balance sheet, cash flow, BIR forms) — accountant-gated (D6 entity/TIN pending).

## Maintenance contract for this file

- **Version/date header** — refresh on any session that ships.
- **Pending ops** — add a checkbox the moment a change needs a deploy or a one-time action; tick it only after verifying in prod.
- **Open rulings** — add with the date raised; delete only when ruled (record the ruling in a spec or memory).
- **Backlog** — re-rank freely; delete only when shipped or ruled dead.
