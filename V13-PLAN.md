# Barro Industries Operating System — v13 Full Review & Remodel Plan

> **REPORT ONLY.** No code was changed to produce this document. This is the complete v13 review of the entire codebase and the **200-phase remodel program** with full instructions — Part E: system phases 1–100 · Part G/H: UI/UX review + phases 101–200 (laptop & phone optimized; every button, display, and linkage rechecked). Produced 2026-07-12.

---

## How this review was done

Ten parallel review agents each read **every line** of their assigned slice — ~45,500 lines of first-party code in total:

| Slice | Lines read |
|---|---|
| js/app.js | 8,680 |
| js/departments.js (two agents, 1–7900 / 7901–15623) | 15,623 |
| js/modules.js + js/chat.js + js/gestures.js | 4,191 |
| Platform layer: index.html, config.js, firebase-config.js, notifications.js, drive.js, bir.js, letterhead.js, statutory-tables.js, qrcode.js (vendored — verified only), sw.js, firebase-messaging-sw.js, manifest.json, track.html | ~4,700 |
| css/styles.css + index.html inline styles | 5,133 |
| firestore.rules + storage.rules + firestore.indexes.json + functions/index.js + firebase.json (with a full client-collection ↔ rules coverage diff) | ~2,100 |
| scripts/*.js + .github/workflows/*.yml + .git/hooks/pre-commit + import-clickup-tasks.js (with a backup-coverage diff and live `gh run` history check) | ~1,600 |
| quote-builder-v2.html + products-database.json + Barro_Operations_Tracker.html + t/ + v/ + _sop_preview.html | ~4,000+ |
| ROADMAP.md + V12-PLAN.md + CLAUDE.md + all guides + fable-workplan/ (34 briefs, 95 "FLAG FOR NEIL" items) + repo-wide TODO grep | ~4,300 |

Every claim in the findings below carries a `file:line` reference verified by the agent that read that line. The raw per-layer reports are preserved in the session scratchpad (`reports/01…10`).

---

# PART A — Executive summary

**Where v12 stands.** All 42 workstreams are implemented. The app is feature-complete for the owner's vision (one system replacing chat, files, accounting, payroll, CRM, quoting, production, BI). Code quality inside each feature is generally disciplined: escaping is near-universal, the rules file has **zero coverage gaps** (a first — every client-touched collection has an explicit match), the payroll engine is unified, and the WS42 theme system's Astral blur budget is genuinely enforced.

**What v13 actually is.** The review found that v13 is *not* primarily a feature release. It is four things, in priority order:

1. **A data-safety release.** The monthly backup has been silently exporting an empty file for every comment thread ever posted (it queries a subcollection name that has never existed), chat messages are not backed up at all, and the restore workflow has never been run once. Several one-time migrations and rules/index deploys from v12 were never confirmed executed.
2. **A live-money correctness release.** The payroll Disburse button has a double-click race that can double-deduct cash advances; four ledger posters treat a failed dedupe read as "no duplicate — post it"; Sales and Production can post into closed accounting periods; sequential IDs (employee ID, project number, order number) are minted non-atomically; and the quote builder silently ignores the Depth/Height pricing rates on all 35 per-length products (systematic under-quoting).
3. **A security-hardening release.** A stored-XSS path in the quote builder, internal cost/margin data visible to generic partners, any authed user able to publish posts directly past the approval flow, plaintext generated passwords stored in Firestore, employee personal emails in a public repo, and Storage folders where any signed-in user can delete anyone's files.
4. **The architecture remodel.** Two monoliths (app.js 8,680 / departments.js 15,623 lines), a 1,681-line "config" file that is actually the app's service layer, a 5,133-line stylesheet built as three cascade-override eras with the same selector declared up to six times, three hand-synced copies of the pricing math, six hand-rolled ledger-upsert implementations, and a load-bearing script order held together by convention. The remodel converts this to ~35 focused ES modules, one Ledger service, one pricing engine, one Approvals service, a layered `@layer` CSS architecture, and a router registry — **all without adding a build step**.

**Sizing.** 200 phases in two programs. **System program (Phases 1–100, Part E):** Stages 0–2 (safety net, live money, security) are deliberately front-loaded and independent of the remodel — they protect real pesos and real data *now*; Stages 3–5 are the remodel itself; Stages 6–9 are declutter, feature completion, accounting depth, and hardening/launch. **UI/UX program (Phases 101–200, Part H):** built from a second dedicated four-audit review (Part G) — navigation linkage, button↔handler wiring, phone/laptop optimization, display truth — it fixes every dead control, orphan route, back-button break, and inconsistent display, then unifies the app on one component kit and verifies every button per role per device.

---

# PART B — Findings register

Severity: **C** = critical (data loss / money corruption / exploitable), **H** = high, **M** = medium. Each finding names the phase that fixes it.

## Critical

| ID | Finding | Evidence | Fixed in |
|---|---|---|---|
| C1 | **Every comment thread ever posted is unrecoverable from backup.** `monthly-backup.js:227` queries subcollection `task-comments`; the real name is `comments` ({collection}/{docId}/comments — departments.js:2114, writes at 2265/2276/2312). `task_messages.json` has always been an empty array. | scripts/monthly-backup.js:223-234 | Phase 2 |
| C2 | **Chat messages are not in the backup at all.** `conversations/{id}/messages` (chat.js:481,531,577,620,840) is a subcollection; the backup has no generic subcollection walker. | scripts/monthly-backup.js | Phase 3 |
| C3 | **Restore has never been tested.** `restore.yml` has zero executions ever (created 2026-07-10). `_counters` max-merge, timestamp revive, and manifest mapping are all unexercised. Also missing the `GOOGLE_SERVICE_ACCOUNT` fallback secret. | .github/workflows/restore.yml | Phase 4 |
| C4 | **Payroll Disburse double-click race (live money).** `pr-disburse-go` (departments.js:4211-4232) is never disabled before its async handler; `disbursePayRun` checks `state!=='verified'` once at entry (3519) and flips state only at the end (3640-3644); the ledger upsert's existence check is non-transactional. Two concurrent runs = duplicate `PAY-{month}-{uid}` rows + double `CashAdvance.deduct`. | js/departments.js:3507-3646, 4211-4232 | Phase 11 |
| C5 | **Ledger dedupe fails open at 4 posting sites.** `.limit(1).get().catch(()=>({empty:true}))` — a read error is interpreted as "no duplicate exists," then the entry is posted. Sites: DPROJ- (8057), SO- (10122), PROJ- (13534), purchase disbursement (15383). The correct transactional pattern already exists at receiveLineIntoItem (15121-15155). | js/departments.js | Phases 12–13 |
| C6 | **Sales Order income and Production COS skip the period lock.** `assertPeriodOpen` is absent from `openRecordSaleModal` (10034-10157) and `consumeProductionMaterials` (13913-13997) — closed accounting periods accept new postings. | js/departments.js | Phase 13 |
| C7 | **Non-atomic sequential IDs.** Employee ID (`users.get().size+1`, 10714 + duplicate 11273), project number (13246), production order number (14177) — concurrent approvals/conversions mint duplicate IDs used as join keys on invoices, registers, printed POs. Correct `_counters` pattern exists at nextAECNumber (11620-11628). | js/departments.js | Phase 15 |
| C8 | **Stored XSS in the quote builder.** `renderItems()` injects `item.name` / spec / notes unescaped into innerHTML (quote-builder-v2.html:1972-1974); the data round-trips Firestore and re-renders when a President/admin reopens the quote. Escape helpers already exist in the same file (txtEsc/attrEsc, 1083-1085). | quote-builder-v2.html | Phase 26 |
| C9 | **Internal cost & margin visible to generic partners.** `applyPartnerMode()` (1202-1223) leaves the "Cost & Margin (Internal)" section (909-936) and its tab button (444) visible to ALL partners, including CO.PT generics with no profit-split arrangement. | quote-builder-v2.html | Phase 26 |
| C10 | **Any authed user can publish posts directly.** UI is president-only-publish + pending-approval, but the rule is `allow create: if isAuth();` (firestore.rules:168) with no status/role constraint. | firestore.rules:166-179 | Phase 22 |
| C11 | **Generated passwords stored in plaintext** in `signup_requests.generatedPassword` (departments.js:10717-10719 + duplicate 11285-11290), displayed in toast + modal; readable by anyone with read access to the collection, forever. | js/departments.js | Phase 28 |
| C12 | **per_length pricing ignores Depth/Height on all 35 products.** The DB documents `rateD100` (products-database.json `_meta` line 8), every per_length product carries the rates, the UI shows an editable Depth on the printout — but `computePrice()` reads only `dimsMm.W` (1794-1799). Silent under-quoting; identically wrong in the Quick Estimate port (departments.js:6923-6954). | quote-builder-v2.html, js/departments.js | Phase 19 |

## High

| ID | Finding | Evidence | Fixed in |
|---|---|---|---|
| H1 | Ledger + project record updated as two non-transactional writes in three flows — failure between them diverges the ledger from `payments[]`/`amountCollected`/`arBalance` (Design flow's catch only console.warns and its own comment expects routine failures). | departments.js:8035-8076, 10118-10150, 13530-13549 | Phases 12–13 |
| H2 | Printed quote total ≠ stored total: print rounds to whole pesos, Firestore stores raw floats, in-app views render 2dp — three different numbers for one quote. | quote-builder-v2.html:1993-2013, 2953-2956; app.js:8563-8565 | Phase 19 |
| H3 | `approval_requests` create is a bare `isAuth()` with zero field validation — forgeable type/userId/amount, and approved `ca_deduct` amounts feed payroll deduction math. | firestore.rules:697-712 | Phase 21 |
| H4 | Storage collaborative folders (tasks/posts/general/departments): any signed-in internal user can **delete or overwrite anyone's file**; also breaks the Files-Hub president-only-purge intent at the blob level. | storage.rules:188-219 | Phase 23 |
| H5 | Editing a Cash Disbursement's amounts never recomputes `vatAmount`; the stale figure flows into Net VAT Payable — a live BIR number. | departments.js:5306-5316, 1863, 4471-4526 | Phase 16 |
| H6 | Expense cache invalidation targets a key that is never populated (`'expenses'` vs the real `'expenses-pending'`/`'expenses-recent'`) — Finance Overview shows stale approvals. | departments.js:1726, 2102, 6727-6728 | Phase 16 |
| H7 | Month labels built without `timeZone:'Asia/Manila'` at 6+ sites — including `disbursePayRun`'s ledger descriptions (3527) and the **printed payslip period label** (6534). Wrong month for any viewer west of UTC. | departments.js:1980, 3527, 3709, 3825, 4286, 6534 | Phase 17 |
| H8 | Attendance edit modal converts an approved-leave day to "Present" on a no-change Save (pre-fill lacks the leave branch the calendar cell logic has), leaving a contradictory record read by payroll. | modules.js:1200 vs 1149-1163, write 1238-1239 | Phase 17 |
| H9 | Chat composer: failed send permanently disables the Send button and silently discards typed text + attachment; double-Enter sends duplicates (no in-flight guard on keydown). | chat.js:397-413, 518-545 | Phase 63 |
| H10 | Employee personal Gmail addresses hardcoded in `import-clickup-tasks.js` in a **public** GitHub repo. | import-clickup-tasks.js:10-39 | Phase 5 |
| H11 | Reminder system (attendance/deadline/low-stock/AEC) is client-triggered only — if no tab is open 7–9 AM, nobody is reminded. No scheduled Cloud Function exists. | notifications.js:606-628; functions/index.js | Phase 67 |
| H12 | Six OVERRIDES-filtered collections are backed up as creation-month snapshots only — later status/balance changes are never re-captured; a restore silently reverts them. | scripts/monthly-backup.js:118-163 | Phase 90 |
| H13 | v12 deploy/run gap: rules/indexes/storage deploys for WS12–WS41 and 5 one-time maintenance buttons + 2 migrations are not confirmed executed (incl. the WS13 double-expensing restatement — the actual bug fix — and the WS19 usernames backfill). | V12-PLAN.md Build Log | Phases 1, 9 |
| H14 | New SW takes over live tabs silently (unconditional skipWaiting + clients.claim) — a 10-day-session tab can run old in-memory state against new code with no "reload to update" prompt. | sw.js:54-73 | Phase 62 |

## Medium (selected — full detail in Part C)

| ID | Finding | Evidence | Fixed in |
|---|---|---|---|
| M1 | `renderApprovals` (~1,100 lines) duplicates every approve/reject write inline twice (all-view + subtab); double-fetches ~13 collections per page load. | departments.js:10451-11562 | Phases 35, 59 |
| M2 | Six hand-rolled ref-keyed ledger-upsert implementations; six hand-rolled print-window scaffolds; four quote-status badge maps with inconsistent vocab. | departments.js (multiple) | Phases 14, 39, 40 |
| M3 | `escHtml` — the app's sole XSS defense — is defined in the second-to-last loaded file; every earlier file calls it on an undocumented "never at parse time" invariant. | modules.js:9-13 | Phase 32 |
| M4 | config.js is a 1,681-line service layer (CashAdvance, Insights, BankAccounts, LeaveAccrual, dialogs, COA) living in a file named "config" because of load-order constraints. | js/config.js | Phase 33 |
| M5 | CSS: same selector declared up to 6× across three cascade eras; confirmed visual bug (topbar logo hybrid in Dark/Astral); pink focus ring in every theme (`--brand-primary` override at 5014 beats the correct rule at 279); z-index landmine (page-panel 4000 vs modal 200); no print fallback for Dark/Astral. | css/styles.css | Phases 51–58 |
| M6 | Unbounded reads: Analytics (13 collections, mostly unbounded), Finance Overview full-ledger fetch (6729) that its own sibling code calls a "compliance landmine" (4439-4446), BS tabs 3× uncached bs_quotes, 8 uncached full `users` reads. | app.js, departments.js | Phases 87–89 |
| M7 | Secretary "view-only" is enforced only at the money/identity tier; kpi_evals delete is open to secretary (438); posts approve rule looser than UI intent. Needs an explicit policy ruling. | firestore.rules | Phases 25, 60 |
| M8 | Cash-advance private records are transmitted to manager/secretary browsers and hidden only at display time; totals drift by centavos between admin list (recomputed) and employee card (stored). | modules.js:1524-1614; config.js:1437-1444 | Phases 18, 29 |
| M9 | Two uncoordinated left-edge gesture handlers race on the same strip (gestures.js 24px vs app.js sidebar-swipe 22px). | gestures.js:82-92; app.js:1160-1182 | Phase 64 |
| M10 | Statutory tables are placeholders (`verified:false`); 13th-month accrual divides by fixed 12 (wrong for mid-year hires, un-bannered); regular employees have no TIN/SSS/PhilHealth/Pag-IBIG fields anywhere. | statutory-tables.js; bir.js:610 | Phases 70, 71, 79 |
| M11 | Notifications: >30 unread silently invisible (limit 30 listener); broadcasts have no dedup; no rate limit on cross-user create (each write = 1 function invocation + 1 FCM send). | notifications.js:17, 294-353 | Phases 30, 66 |
| M12 | Pre-commit hook is unversioned (single-machine), soft-fails on regex drift, double-bumps on amend/merge; CACHE_VER is a commit counter unrelated to APP_VERSION. | .git/hooks/pre-commit | Phase 6 |
| M13 | Docs: GOOGLE_DRIVE_SETUP.md and SETUP_GUIDE.md describe an architecture that no longer exists; PUBLISHING_GUIDE.md recommends Netlify against CLAUDE.md's explicit "Not Netlify"; Employee_Guide predates the entire payroll/HR bundle. | repo root | Phases 5, 93 |
| M14 | Dead weight: 103-line unreachable Company Overview + orphaned `president_message` collection/rule; dead DRIVE/SHEETS/EMAIL config blocks; ~40+ confirmed-dead CSS lines; superseded tracker HTML + xlsx; `ledger_entries` rule orphaned on master; `hub_folders(scope,department)` index unused. | multiple | Phases 5, 49, 51, 95 |

**Resolved during cross-check (no action needed):** the 2026-07-09 payroll Compute ReferenceError is **confirmed fixed** (computePayLine/computePayRun/disbursePayRun read in full; all variables cleanly scoped). The feared partner leak via `Clients.listAll` is blocked at the rules level (`clients` read is `!isPartner()`, firestore.rules:1380) — it remains a perf/defense-in-depth item only. `it_network` is rules-restricted (887). Firestore rules coverage: **no client-used collection lacks a match block.**

---

# PART C — Layer-by-layer review summaries

## C1. js/app.js (8,680 lines)
Core shell + far too much else: auth state machine, router, nav builders, 5 role dashboards, plus a CMS (Company hub 5591-6407), an HR admin console (7168-7529), a ~690-line Analytics engine (6478-7166), a product-catalog importer, ID-card print, and ~700 lines of static help/SOP copy. Duplication: `safeGet` ×5, the closed-task status array `['done','approved','archived']` ×8+, error-render block ×6, attendance grid ×2, peso formatters ×3. Bugs: UTC fallbacks in payslip month math (4920, 5209), unfiltered full-collection read in `newRevisionFromDoc` (1396-1402), no `.catch` on Product Database loads (1655-1658), no idempotency on the QUOTE_FILED postMessage bridge (8542-8657), silent seed/import caps at 1000/2000 docs (1465-1525). Security: `fileUrl` into `href` without `safeHttpUrl` at 6249/6256/6308 (memo modal at 6118 does it right); claims refresh never re-gates the currently open page. Positives: escHtml discipline, crypto-random passwords, secondary-app worker creation, Cloud Function password reset.

## C2. js/departments.js first half (1–7,900)
Finance heart. The payroll engine (3386-3646) is clean and unified; the ReferenceError is gone. The critical items are the Disburse race (C4), fail-open dedupes, wrong cache keys (H6), CDJ VAT staleness (H5), and Manila-label bugs (H7). Architecture: six ledger-upsert implementations, ~6 near-identical finance CRUD screens, two pricing/VAT engines (Quick Estimate adds VAT exclusively; Finance splits inclusively — same figures disagree by the VAT amount), ~500 lines of one-time migrations inline, the admin-role literal repeated at 9+ sites, `.subtab-bar` stragglers at 760/1613/5526. `financeDelete` wraps an async Promise executor that can hang forever (453).

## C3. js/departments.js second half (7,901–15,623)
Design/IT/BS/Approvals/CRM/Production/Purchasing. `renderApprovals` is a ~1,100-line god function with byte-identical approve/reject blocks duplicated between the "all" view and subtabs (signup 10712/11265, finance-delete 10833/11095, leave 10932/11167) and a 2× fetch of ~13 collections per load. Non-atomic ID minting (C7). Fail-open ledger dedupes + missing period locks (C5, C6). Six print-window scaffolds; four quote-status badge maps. Plaintext passwords (C11). escHtml discipline in this range is genuinely clean (~40 sites spot-checked, zero violations). The correct patterns for everything broken here already exist in the same file (nextAECNumber counters, receiveLineIntoItem transaction, CashAdvance/RaiseFlow services) — the remodel is largely "apply the file's own best patterns everywhere."

## C4. js/modules.js + js/chat.js + js/gestures.js
`escHtml` — the app's single XSS defense — lives in the second-to-last loaded file (M3). Two cash-advance write paths (president modal bypasses the CashAdvance service with a third rounding formula). Attendance edit modal can silently convert approved leave to "Present" (H8). Chat: the only realtime listeners in the app, with a disciplined teardown contract, but full-innerHTML re-render per snapshot (wipes open reaction pickers), unbounded `loadEarlier` growth, failed-send data loss + duplicate-Enter sends (H9), typing docs that never clean up. 103 lines of unreachable Company Overview + orphaned `president_message` collection. Confirmed left-edge gesture collision between gestures.js and app.js's sidebar swipe (M9). posts rules gap (C10).

## C5. Platform layer (config, SW, notifications, drive, BIR, index.html)
config.js is the de-facto service layer (M4). Dead DRIVE/SHEETS/EMAIL flag blocks with placeholder creds. `dbCachedGet`: per-call-site TTLs, hand-maintained alias map for invalidation — fragile but currently correct. Notifications: O(users) fan-out writes, 30-item listener ceiling (M11), no dedup on broadcasts. SW: silent takeover of live tabs (H14), CACHE_VER as commit counter, sensible precache (no mismatches). Reminders are client-presence-dependent (H11). Statutory tables are labelled placeholders — correctly bannered in BIR screens; the 13th-month formula is not (M10). BRAND is hand-mirrored in 4 non-JS files. No CSP/SRI on CDN scripts. qrcode.js is vendored (MIT, intact) — excluded from audit. track.html/t//v/ are live public pages, correctly noindex + token-keyed.

## C6. css/styles.css (5,133 lines)
Three cascade eras (base → Liquid Glass 3348-3843 → iOS Overhaul 4184-4591) re-declare the same selectors up to 6×; correctness depends purely on source order. Confirmed visual bug: topbar logo renders a flat-blue + leftover-gold-glow hybrid in Dark/Astral (937-946 vs 4704-4711; Light is rescued by an accident of specificity at 2943). Focus ring is pink in every theme (5014's `--brand-primary` beats 279's `--primary`). 188 lines of hardcoded hex bypass the token system (nav-icon gradients ×18, bottom-nav strokes ×14, light-mode patches). z-index: PTR indicator (300) above modals (200); page-panel (4000) buries any modal opened over it. Only payslip+BIR have print styles — everything else prints Dark/Astral backgrounds. Astral blur budget is well-enforced (all 33 backdrop-filters correctly scoped); `.loading-placeholder` shimmer is the one expensive animation running in every theme. ~40 confirmed-dead lines (lower bound — needs the mechanical sweep in Phase 51).

## C7. firestore.rules + storage.rules + functions
**Zero rules coverage gaps** — every client-touched collection matched (best result of the audit). Two-tier secretary design is deliberate and mostly consistent; gaps: kpi_evals delete (438), posts approve tier, and a needed policy ruling on how literal "view-only" is meant (M7). Real holes: approval_requests create (H3), posts create (C10), Storage collaborative-folder deletes (H4), hearts array unscoped (Low-Med), projects create bare-isAuth (Low). Functions (Node 22, v1 API): push relay is well-built (data-only messages, token pruning); claims sync + backfill correct; `createUserDocOnAuthCreate` defaults to us-central1 (region inconsistency); adminResetPassword verifies caller role server-side (correct) but allows 6-char passwords. Indexes: all live queries covered; hub_files' 6-composite matrix maps 1:1 to loadFiles branches (deliberate, excellent); one orphan index; `ledger_entries` rule orphaned on master pending a worktree branch.

## C8. Automation (scripts/, workflows, hooks)
Backup auto-discovers root collections (no static EXPORTS — that memory is stale) but: comments bug (C1), no subcollection walker (C2), creation-snapshot semantics on 6 collections (H12), phantom EXCLUDE entries. Restore: never executed (C3), missing SA fallback secret. Sync: healthy 10/10 runs, idempotent per-file, sensible failure handling. Digest: correct TZ math (relies on runner being UTC — unasserted). monthly-backup.yml's comment mis-converts PH time (fires the 2nd, not the 1st — cosmetic). All workflows correctly pin Node 20; nothing enforces it for future additions. Pre-commit hook unversioned/soft-fail/double-bumping (M12). PII in import-clickup-tasks.js (H10). No secrets committed; workflow permissions least-privilege.

## C9. Standalone tools
quote-builder-v2: the postMessage protocol is sound (parent origin-checks), draft persistence sensible, amortization math correct — but C8/C9/C12/H2 live here, commission is computed on the VAT-inclusive grand (policy decision needed), 21 products have null basePrice (price as ₱0 silently), and the static JSON fallback lacks all capital/margin fields (fallback mode shows ~100% margins). Three hand-synced implementations of the pricing/schedule math across QB / Quick Estimate / config.js. quote-builder v1 is already deleted (docs stale). Operations Tracker HTML + xlsx are superseded and disconnected — archive. t/ and v/ are live production pages.

## C10. Docs & backlog
V12-PLAN.md is authoritative and thorough. ROADMAP.md carries ~8 items no workstream ever covered (auto job-costing, HR depth, PhilGEPS import, Production role, field ops, error logging, pagination, fan-out function). 95 "FLAG FOR NEIL" decisions across 34 fable-workplan briefs — the real decision backlog (Part F). Three guides actively contradict the current architecture (M13). First-party code is essentially free of TODO markers — deferred work is tracked in planning docs, which is the right convention.

---

# PART D — v13 target architecture

## D1. Module system: native ES modules, no build step
Browsers have long shipped `<script type="module">`. The conversion:
- Each new file is an ES module with explicit `import`/`export`. Functions still needed by inline `onclick="..."` handlers in template-string HTML get a one-line `window.X = X` at the bottom of their module — the global contract survives, the load-order fragility dies.
- index.html swaps the 13-script defer chain for module scripts; module resolution replaces manual ordering. sw.js / firebase-messaging-sw.js stay classic scripts (worker scope).
- Migration is incremental (leaf files first, monolith splits after), file-by-file, each step shippable.

## D2. Target file layout (~35 modules replacing 13 files)
```
js/
  core/        boot.js, router.js, nav.js, overlay.js, guard.js, keymap.js
  lib/         helpers.js (escHtml, safeHttpUrl, fmt, round2, initials, presence,
               DONE_TASK_STATUSES, safeGet, renderErrorState), time.js (biz*), csv.js
  data/        db-cache.js (dbCachedGet v2 + TTL/invalidation registry), repos.js
  services/    ledger.js, payroll-engine.js, cash-advance.js, approvals.js,
               pricing-engine.js, insights.js, bank-accounts.js, leave.js,
               clients.js, notifications-svc.js
  ui/          chip-tabs.js, dialogs.js, sop-panel.js, crud-table.js, print-docs.js,
               attendance-grid.js, status-meta.js
  features/    dashboards.js, profile.js, hr.js, company.js, analytics.js, catalog.js,
               partners.js, quote-host.js, dept-finance.js, dept-sales.js,
               dept-design.js, dept-it.js, dept-bs.js, dept-production.js,
               dept-purchasing.js, dept-gov.js, approvals-page.js, crm.js,
               files-hub.js, inventory.js, posts.js, team.js, attendance.js,
               search.js, chat.js, my-profile.js
  migrations/  migrations.js (all one-time/repair tools, lazy-loaded)
config.js      pure config: BRAND, DEPARTMENTS, ROLES, nav arrays, flags, COA
```

## D3. The five load-bearing services
1. **`Ledger`** — the single money API. `Ledger.post({ref, kind, amount, vatTreatment, dept, projectId, bankAccountId, ...})` runs dedupe-check + write **in one transaction**, calls `vatSplit` centrally, enforces `assertPeriodOpen` unconditionally, invalidates caches, and optionally updates the linked project doc in the same transaction. Every poster (expenses, CRJ, CDJ, payroll, payslips, Design payments, Record Sale, project billing, Production COS, purchase disbursement, manual entries) becomes a thin caller. Kills C5, C6, H1, and M2's upsert sextet in one structure.
2. **`PayrollEngine`** — computePayLine/computePayRun/disbursePayRun/reopenPayRun + RaiseFlow as a pure, DOM-free module; Disburse acquires a transactional state lock before any money write (C4).
3. **`Approvals`** — per-type `{approve, reject}` services (Signup, FinanceDelete, PayrollDelete, Leave, …) used by both the aggregated view and subtabs; `renderApprovals` shrinks to render/dispatch (M1).
4. **`PricingEngine`** — one implementation of computePrice/computeTotals/balance schedule shared by the quote-builder iframe (same-origin script include), Quick Estimate, and config.js consumers; one VAT convention (C12, H2, and the three-way drift).
5. **`Counters`** — `nextId('employees' | 'job_projects' | 'production_orders')` atomic transactions everywhere a human-facing sequential ID is minted (C7).

## D4. Data layer
`db-cache.js`: central TTL registry per collection, invalidation manifest derived from the same registry (no hand-maintained alias map), one `users` directory cache shared by every picker. Query rules: every list read is bounded (period, limit, or where) — the Analytics/Overview unbounded reads get period pickers backed by `ledgerForPeriod`-style helpers.

## D5. CSS architecture
Native `@layer tokens, base, shell, components, departments, chat, astral;` across split files (tokens/base/shell/components/departments/chat/print/astral). Astral extracted wholesale into a conditionally-loaded file. One definition per selector. Token taxonomy collapsed (aliases deleted, focus ring on `--primary`). z-index scale as tokens. Generic `.print-target` system + dark-theme print fallback.

## D6. Server-side moves (Cloud Functions)
Scheduled reminders (attendance/deadlines/low-stock/AEC follow-ups) — the highest-value platform fix (H11); approval **execution** on status→approved re-deriving amounts from authoritative sources (H3's second half); notification fan-out with per-sender quotas (M11); future: postLedgerEntry validation. All new functions pinned `asia-east1`, v1 API to match existing.

## D7. What deliberately does NOT change
No framework, no bundler, no paid services. Firestore + GitHub Pages + Drive mirror stay. The iframe isolation of the quote builder stays (only its math is extracted). The `window.*` contract for inline handlers stays. All Part F invariants (Disburse-only money moves, CashAdvance sole mutator, financeDelete flow, Manila time, escHtml, no pop-ups) are preserved by construction.

---

# PART E — Phases 1–100: the system program

**Phase protocol (applies to every phase):**
- Work on `master` in small commits (the pre-commit hook auto-bumps versions — never hand-edit `APP_VERSION`/`CACHE_VER`).
- Re-read the current file state before editing (concurrent OneDrive sessions); `node --check` every edited JS file.
- New JS/CSS files must be added to **both** index.html and sw.js `PRECACHE`.
- Rules/indexes/storage/functions deploy separately from `git push` (`~/.npm-global/bin/firebase deploy --only …`); re-`git diff` the rules file immediately before any rules deploy.
- Any phase touching money paths must preserve the Part F invariants and be verified against live-like data before push.
- **Deploy/push only with Neil's approval.** Phases marked 🔴 touch live money or live data.

---

## STAGE 0 — Ground truth & safety net (Phases 1–10)

### Phase 1 — Close the v12 deploy gap 🔴
**Goal:** Everything v12 built is actually live before v13 changes anything. (H13)
**Files:** none (operations only).
**Instructions:**
1. `git status` / `git log origin/master..master` — confirm the local WS42 commits awaiting push; get Neil's approval and `git push origin master`.
2. Deploy backend artifacts in order: `firebase deploy --only firestore:rules`, then `--only firestore:indexes`, then `--only storage`, then `cd functions && npm run deploy`.
3. Wait 60s (rules propagation), then log in as a non-admin test account and click through one screen per department to catch any rules regression (blank-screen class).
4. Run president-console `backfillUserClaims()` (required after any functions/storage deploy).
**Verify:** Firebase console shows today's rules/indexes/functions timestamps; no console errors on a role-spread smoke test.
**Depends:** —

### Phase 2 — Fix the comments backup bug 🔴
**Goal:** Comment threads become recoverable (C1).
**Files:** scripts/monthly-backup.js.
**Instructions:**
1. In `fetchTaskComments` (scripts/monthly-backup.js:223-234), change `.collection('task-comments')` → `.collection('comments')`.
2. Generalize it: iterate not just `tasks` but every parent collection `renderComments` is invoked with (`tasks`, `submissions` — grep `renderComments(` call sites for the current list) and emit one `{parent}_comments.json` per parent collection.
3. Update `restore-from-backup.js`'s skip-list comments to name the new files explicitly.
4. `workflow_dispatch` monthly-backup.yml; download the Drive output and confirm the comments JSONs are non-empty.
**Verify:** the dispatched run's `_summary.txt` lists comment files with counts > 0.
**Depends:** Phase 1 (nothing structural — can run first if needed).

### Phase 3 — Generic subcollection walker in the backup 🔴
**Goal:** Chat messages and all future subcollections are backed up (C2).
**Files:** scripts/monthly-backup.js.
**Instructions:**
1. Port the walker pattern from sync-to-drive.js:251-256 (`doc.ref.listCollections()`): for each exported root doc, enumerate subcollections; export each as `{root}__{subname}.json` entries keyed by `{docId}/{subDocId}`.
2. Skip-list ephemeral subcollections explicitly: `typing`, `readers` (chat), with a comment for each exclusion.
3. Cap per-subcollection export with a `limit` + warning log so one huge thread can't blow the run (log what was truncated — no silent caps).
4. Record subcollection files in `_manifest.json` with their parent path so restore can reconstruct.
5. Dispatch a run; verify `conversations__messages.json` exists and is non-empty.
**Verify:** manifest lists subcollection entries; spot-check one message round-trips (fields intact).
**Depends:** Phase 2.

### Phase 4 — Restore drill 🔴
**Goal:** Restore is a tested path, not a hope (C3).
**Files:** .github/workflows/restore.yml, scripts/restore-from-backup.js.
**Instructions:**
1. Add the missing `GOOGLE_SERVICE_ACCOUNT: ${{ secrets.GOOGLE_SERVICE_ACCOUNT }}` line to restore.yml's env block (parity with the other two workflows).
2. Dispatch restore.yml in dry-run (default) against last month's backup; read the full log — every file must map to a collection via `_manifest.json` with zero "unmapped" warnings.
3. Create a throwaway Firebase project (or use the emulator with the backup JSONs) and do a committed restore there; verify `_counters` end at max values and ISO timestamps revive as Timestamps.
4. If a staging project is not acceptable, commit-restore exactly one low-risk collection (e.g. `suggestions`) into production and diff before/after.
5. Extend restore-from-backup.js to handle the Phase-3 subcollection files (write to `parent/{docId}/{sub}/{subDocId}`).
6. Write `RESTORE_RUNBOOK.md` (repo root): when to restore, exact dispatch inputs, expected duration, post-restore checks.
**Verify:** one committed restore has succeeded somewhere; runbook exists.
**Depends:** Phases 2–3.

### Phase 5 — Repo hygiene & PII removal
**Goal:** Public repo carries no PII, no misleading docs, no superseded artifacts (H10, M13, M14).
**Files:** repo root.
**Instructions:**
1. Delete `import-clickup-tasks.js` (PII: employee Gmails at lines 10-39; one-time script long since run). Note: git history still holds it — acceptable per Neil, or do a history rewrite later if he wants (separate decision; do NOT force-push without explicit approval).
2. Delete `GOOGLE_DRIVE_SETUP.md` and `SETUP_GUIDE.md` (describe an architecture that no longer exists; Netlify/`main`/wrong project id). Replace each with a 2-line stub pointing at CLAUDE.md + DRIVE_SYNC_SETUP.md, or delete outright.
3. Rewrite `PUBLISHING_GUIDE.md` scoped to GitHub Pages only (or delete; CLAUDE.md's Commands section already covers deploy).
4. Move `Barro_Operations_Tracker.html`, `Barro_Client_Records_Tracker.xlsx`, `Barro_Government_Biddings_Tracker.xlsx` into `archive/` with a README line ("superseded by in-app Gov Biddings + Clients, 2026-06").
5. Move `_sop_preview.html` to `dev/`.
6. Delete the dead config blocks `DRIVE_CONFIG`/`SHEETS_CONFIG` (js/config.js:107-127) and — after confirming EMAIL is permanently off with Neil — `EMAIL_CONFIG` plus its two notifications.js references.
**Verify:** `git grep -i "netlify"` returns nothing actionable; repo root contains only live files.
**Depends:** —

### Phase 6 — Version the pre-commit hook; unify versioning
**Goal:** The version/cache bump survives fresh clones and can't silently no-op (M12).
**Files:** new `.githooks/pre-commit`, sw.js, CLAUDE.md.
**Instructions:**
1. Copy `.git/hooks/pre-commit` to `.githooks/pre-commit` (tracked); document `git config core.hooksPath .githooks` as a one-time setup line in CLAUDE.md.
2. Harden: if the `APP_VERSION` or `CACHE_VER` grep fails to match, `exit 1` with a loud message (currently soft-exits 0 and ships stale versions).
3. Derive `CACHE_VER` from `APP_VERSION` (`bi-ops-v12.0.44` style) so one counter tells one story; keep the bump unconditional (over-busting is harmless).
4. Guard against amend double-bumps: skip the bump when `GIT_EDITOR` context indicates `--amend` is in play is unreliable — instead, make the bump idempotent per content hash: if the diff being committed contains no changes outside the three version files, skip.
**Verify:** fresh clone + `core.hooksPath` setup bumps correctly; a doc-only amend doesn't double-bump.
**Depends:** —

### Phase 7 — CI checks for a no-build repo
**Goal:** The three recurring drift classes (syntax, Node version, backup coverage) fail loudly in CI.
**Files:** new `.github/workflows/ci.yml`, new `scripts/check-backup-coverage.js`.
**Instructions:**
1. ci.yml on push/PR: job 1 runs `node --check` on every `js/*.js` and `scripts/*.js`; job 2 greps `.github/workflows/*.yml` and fails if any workflow running scripts/ isn't `node-version: '20'`; add `"engines": {"node": "20.x"}` to scripts/package.json.
2. `check-backup-coverage.js`: grep `js/` for `\.collection\(['"]([a-z_0-9]+)['"]` root collections; diff against monthly-backup.js's EXCLUDE + OVERRIDES + a `KNOWN_SUBCOLLECTIONS` list; exit 1 listing any collection with no recorded backup decision. Wire as job 3.
3. Prune the phantom EXCLUDE entries `presence`, `sessions` (monthly-backup.js:167) while touching it.
**Verify:** CI green on master; introduce a fake collection in a branch and watch job 3 fail.
**Depends:** —

### Phase 8 — Client-side error logging
**Goal:** Production errors become visible without a user report (ROADMAP item 16).
**Files:** js/config.js (or new js/lib/errlog.js in Stage 3 layout), firestore.rules, index.html.
**Instructions:**
1. Add `window.onerror` + `window.onunhandledrejection` handlers that write `{message, stack (truncated 2000), page: currentPage, version: APP_VERSION, uid, ua, ts}` to an `error_log` collection — throttled (max 5/session, dedup by message hash) and wrapped in try/catch so logging can never crash the app.
2. Rules: `error_log` — create: isAuth() with `hasOnly` field allowlist + length caps + `ts == request.time` (copy the audit_log create pattern at firestore.rules:1234-1238); read/delete: admin.
3. Surface count-per-day on the president dashboard's health banner (extend `checkBackupHealth`).
4. Add `error_log` to the backup's known-collections list (auto-discovered anyway; record the decision).
**Verify:** throw a test error in console → doc appears; non-admin cannot read the collection.
**Depends:** Phase 7 (coverage linter knows the new collection).

### Phase 9 — Execute the pending one-time migrations 🔴
**Goal:** All v12 data migrations actually applied (H13).
**Files:** none (operations checklist).
**Instructions (run as president, in order, each idempotent):**
1. Finance → Reports → "🔄 Sync to ledger".
2. Projects → "🔖 Tag" (projectKind backfill).
3. Finance → "🏷 Tag account types", then "🧾 Restate material costs" — ⚠️ tell Neil first: past-period expense totals WILL drop by the restated amount (that IS the double-expensing fix).
4. "🔧 Security backfill" (usernames map for worker login).
5. `node scripts/migrate-files-hub.js` (with FIREBASE_SERVICE_ACCOUNT) — the second of its two required runs if only one has happened; harmless if complete.
6. Browser console: `remapDesignProjectClients()` (after confirming `migrateClientBooks()` already ran — check a legacy client doc for `migratedTo`).
7. Do NOT run "↻ Run Annual Accrual" — blocked on the LEAVE_POLICY decision (Phase 69).
8. Record each run + result in ROADMAP.md's session log.
**Verify:** each tool reports 0 remaining items on a re-run.
**Depends:** Phase 1 (rules must be deployed first).

### Phase 10 — QA baseline & regression checklist
**Goal:** A written, repeatable smoke test exists before the remodel starts moving walls.
**Files:** new `QA-CHECKLIST.md`.
**Instructions:**
1. Write a per-role checklist (president / manager / secretary / finance / employee / agent / partner): login portal, dashboard load, one write per major module (task, expense, quote, attendance, chat message, file upload), Approvals action, logout.
2. Add per-theme (Light/Dark/Astral) and per-tier (phone/tablet/desktop) spot checks — reuse WS42 Batch F's QA notes.
3. Add the "money invariants" section: compute a pay run on a test month and cancel before Verify; confirm a closed period rejects a manual ledger entry; confirm financeDelete routes to approval.
4. This checklist is the exit gate for Stages 4, 5 and Phase 97.
**Verify:** one full pass executed and dated in the file.
**Depends:** Phase 1.

---

## STAGE 1 — Live-money correctness (Phases 11–20)

### Phase 11 — Transactional Disburse lock 🔴
**Goal:** Double-click/double-tab can never double-pay (C4).
**Files:** js/departments.js (disbursePayRun ~3507-3646, modal handler ~4211-4232).
**Instructions:**
1. In the `pr-disburse-go` click handler, `btn.disabled = true` synchronously before any `await` (mirror the expense-approve pattern at 2029); re-enable only on failure.
2. Open `disbursePayRun` with a Firestore transaction that reads `pay_runs/{month}`, asserts `state === 'verified'`, and writes `state: 'disbursing', disbursingAt, disbursingBy` — the transaction IS the lock; a concurrent call fails the assert and aborts cleanly with a toast.
3. Proceed with the existing per-employee ledger/CA writes; on completion set `state: 'disbursed'` (existing code); on partial failure leave `'disbursing'` and surface a "resume disbursement" path that re-runs idempotently off the deterministic `PAY-{month}-{uid}` refs.
4. Rules: extend the `pay_runs` state machine (firestore.rules:584) to allow `verified → disbursing → disbursed` president-only, and forbid `disbursing → verified` (no un-locking mid-flight except via reopenPayRun after manual review).
5. Deploy rules; test with two browser tabs clicking Disburse simultaneously on a test month.
**Verify:** second tab gets a clean rejection; ledger has exactly one PAY- row per employee.
**Depends:** Phases 1, 10.

### Phase 12 — The Ledger service 🔴
**Goal:** One transactional money API; dedupe can never fail open (C5, H1 — the highest-leverage refactor in the codebase).
**Files:** new js/finance-ledger.js (or js/services/ledger.js under the Stage-3 layout — create the file now, move later), index.html, sw.js.
**Instructions:**
1. Implement `window.Ledger.post(entry)` where entry = `{ref, kind, date, description, amount, vatTreatment, dept, projectId, bankAccountId, source, legs?}`:
   a. `assertPeriodOpen(entry.date)` — unconditional, first line.
   b. Inside ONE `db.runTransaction`: query-by-ref existence check via a deterministic doc id — write ledger docs at `ledger/{ref}` (doc-id = ref) so existence is a `tx.get(doc)`, not a query (transactions can't run queries; the deterministic-id scheme removes the need). For legacy rows with random ids, keep a one-time backfill mapping (Phase 14).
   c. Compute VAT centrally via `window.vatSplit(amount, entry.vatTreatment)`.
   d. If `entry.projectSync` is provided (`{collection, docId, fields}`), update the project doc **in the same transaction** — kills the two-write drift (H1).
   e. `dbCacheInvalidate('ledger')` on success.
2. Add `Ledger.remove(ref)` delegating to the existing financeDelete flow (never direct delete).
3. Unit-style self-test: a `window.Ledger._selfTest()` dev function that posts+reposts the same ref against the emulator/test doc and asserts single write.
4. Register the new file in index.html (before departments.js) + PRECACHE.
**Verify:** `node --check`; repost same ref twice → one doc; closed period → loud rejection.
**Depends:** Phase 11 (shares patterns), Phase 10.

### Phase 13 — Migrate all posters to Ledger; close the period-lock gaps 🔴
**Goal:** No inline `ledger.add()` outside the service; closed periods are actually closed (C5, C6).
**Files:** js/departments.js.
**Instructions:**
1. Rewrite the five feature-side posters to call `Ledger.post` with `projectSync` where applicable: Design payment (8035-8076), Record Sale (10098-10156 — **adds the missing assertPeriodOpen**), Project billing (13513-13549), Production COS (13913-13997 — **adds the missing assertPeriodOpen**; keep the two-leg COS + inventory-contra structure as `legs`), Purchase disbursement (15292-15427).
2. Rewrite the finance-side posters the same way: postExpenseToLedger (1703), postCRJToLedger (1736), postCDJToLedger (1783), manual ledger entry (4804-4826), payslip submit (6083-6107).
3. Delete each site's hand-rolled `.catch(()=>({empty:true}))` dedupe.
4. Rules: keep the Production contra-leg special case (firestore.rules:996-1027) — verify it still matches the service's write shape; deploy if touched.
5. Run the QA money-invariants section (Phase 10.3) end-to-end.
**Verify:** `grep -n "collection('ledger').add" js/` returns only finance-ledger.js; a closed test period rejects a Record Sale.
**Depends:** Phase 12.

### Phase 14 — Ledger upsert consolidation + payroll poster 🔴
**Goal:** The payroll engine and any updater use the same single upsert (M2).
**Files:** js/departments.js, js/finance-ledger.js.
**Instructions:**
1. Add `Ledger.upsertByRef(ref, buildEntry)` (transactional read-modify-write) and route payroll's inline `upsertLedger` (3571-3579) plus resyncLedgerForSource (1846-1900) through it.
2. Legacy rows: one-time migration tool (goes in migrations.js at Phase 37; write it now inline) that copies random-id ledger docs to deterministic `ledger/{ref}` ids for refs matching the known prefixes, deleting originals — president-only button, dry-run first, report counts.
3. Keep `financeDeleteCascade` (383-437) pointed at the new id scheme.
**Verify:** re-running Compute→Disburse on a test month updates rather than duplicates rows; cascade delete still reverses.
**Depends:** Phases 12–13.

### Phase 15 — Atomic sequential IDs 🔴
**Goal:** No duplicate employee/project/order numbers under concurrency (C7).
**Files:** js/departments.js, js/letterhead.js (nextSerial), js/bir.js (nextSerialInRange).
**Instructions:**
1. Build one `window.nextCounterId(counterName, format)` on the `_counters/{name}` transaction pattern (generalizing nextAECNumber, departments.js:11620-11628).
2. Replace: employee ID mint at 10714-10717 AND its duplicate at 11273-11276 (`_counters/employees` — note app.js's loadUserProfile already uses this counter; unify on the same doc so both paths share the sequence); job project number at 13246-13247 (`_counters/job_projects`); production order number at 14177-14178 (`_counters/production_orders`).
3. Seed each counter transactionally at `max(existing)` on first use (read current max once inside the seeding transaction).
4. Refactor letterhead nextSerial + bir nextSerialInRange to share the same core (keep their range/format semantics).
**Verify:** two simultaneous signup approvals in two tabs mint distinct BI-YYYY-### ids.
**Depends:** Phase 10.

### Phase 16 — Cache-key and CDJ VAT fixes 🔴
**Goal:** Finance Overview reflects reality; edited disbursements carry correct input VAT (H5, H6).
**Files:** js/departments.js, js/config.js.
**Instructions:**
1. Change dbCacheInvalidate('expenses') at 1726 and 2102 to invalidate `'expenses-pending'` and `'expenses-recent'` (or better: register `expenses` → those keys in the alias map at config.js:463-471 so the call sites stay simple).
2. CDJ edit (5306-5316): on save, recompute `vatAmount` from the edited material/sundry amounts via vatSplit before writing; then let resyncLedgerForSource mirror it. Alternatively drop the stored field and have resync always recompute — pick recompute-on-save to keep the doc self-describing.
3. Audit every other financeEditModal field list that edits amounts feeding derived fields; apply the same recompute rule (grep `financeEditModal(` call sites).
**Verify:** approve an expense → Overview pending card updates within one render; edit a CDJ amount → ledger row's VAT changes accordingly.
**Depends:** Phase 13 (resync now routes via Ledger).

### Phase 17 — Manila-time label & attendance-integrity fixes 🔴
**Goal:** Dates on money documents are Manila-correct everywhere; leave days can't be silently overwritten (H7, H8).
**Files:** js/departments.js, js/modules.js, js/app.js, js/config.js.
**Instructions:**
1. Add `window.fmtMonthLabel(ymOrDate)` in config.js that formats via `toLocaleString('en-PH', {timeZone:'Asia/Manila', month:'long', year:'numeric'})`; replace the raw constructions at departments.js:1980, 3527, 3709-3710, 3825, 4286, 6534.
2. Replace the UTC fallbacks in app.js payslip month math (4920, 5209) with `bizDate()`-only (bizDate is guaranteed by load order; delete the fallback branch).
3. Replace the noon-anchor DOW hacks (app.js:5104, 5342) and the near-due window (departments.js:809-811) with `bizDow`/UTC-anchored addDays (pattern at departments.js:6236).
4. Fix IT license expiry (departments.js:9182-9184) to compare against `today()`.
5. Attendance edit modal (modules.js:1200): pre-fill via `attRecKind(rec)` including leave/unpaid-leave branches; block Save-as-present on a leave day without an explicit "convert leave to worked day?" confirmDialog that also clears `leaveType`/`leaveReqId` on confirm.
**Verify:** set OS timezone to US-Pacific; payslip month + disburse labels remain correct; leave-day edit requires explicit confirmation.
**Depends:** Phase 10.

### Phase 18 — Cash Advance single-writer 🔴
**Goal:** Exactly one code path creates/computes CA money (M8 part).
**Files:** js/modules.js, js/config.js.
**Instructions:**
1. Rewrite `openPresidentCashAdvanceModal` (modules.js:1659-1740) to call `CashAdvance.request()` then `CashAdvance.approve()` (both already transactional) instead of the direct `cash_advances.add()` with its own formula at 1711.
2. `renderCAList` (1587): render stored `a.totalPayable` (as the employee card at 1465 already does); delete the `monthly*terms` recompute.
3. In CashAdvance.approve (config.js:1437-1444), compute `monthlyPayment = _caRound2(total/terms)` and set `totalPayable = _caRound2(monthly * terms)` **derived from the rounded monthly** (or store the residual on the last installment — pick one; derived-from-monthly keeps sum-of-payments exactly equal to totalPayable).
4. Make `CashAdvance.reject` transactional with a pending-status guard (config.js:1517-1530), matching approve.
**Verify:** ₱1,000 over 3 terms shows identical totals in admin list, employee card, and stored doc; reject racing approve loses cleanly.
**Depends:** Phase 10.

### Phase 19 — Quote math corrections 🔴
**Goal:** Quotes price what the printout shows; stored totals equal printed totals (C12, H2).
**Files:** quote-builder-v2.html, js/departments.js (Quick Estimate), js/app.js (bridge), products-database.json.
**Instructions:**
1. `computePrice()` per_length branch (QB 1794-1799): add the documented terms — `+ ((D-baseD)/100)*rateD100 + ((H-baseH)/100)*rateH100` where the product carries them (missing base dims default to the entered value → zero delta). Mirror identically in `qeUnitPrice` (departments.js:6923-6954). ⚠️ This raises some quoted prices — Neil must approve the pricing change and the go-live date; consider logging old-vs-new price on the first week of quotes.
2. Rounding: in `computeTotals()` round `discountAmt`, `net`, `vatAmt`, `grand`, `commissionAmt` to 2dp at computation; in `buildQuotePayload` write the rounded values; keep `formatPeso` whole-peso display but print with 2dp on the totals block so print == stored == in-app.
3. Commission basis: present Neil the one-line decision — commission on VAT-inclusive grand (today) vs ex-VAT net; implement his answer in computeTotals + buildAgentBox (2908).
4. Fix the 21 null-basePrice products (list in the report): price them or mark `inactive: true` and filter from the picker; make the picker badge "no price" items loudly.
5. postMessage hardening while here: target origin `window.location.origin` instead of `'*'` (2747, 2765, 2887); add a `nonce` to QUOTE_FILED and have the app.js bridge (8542-8657) ignore a repeated nonce (idempotency).
**Verify:** a Depth-modified range prices differently; file a quote → printed, stored, and Sales-tab totals all match to the centavo.
**Depends:** Phase 10; coordinate with Phase 38 (engine extraction) — do the math fix first, extraction second.

### Phase 20 — financeDelete fix + payroll reconciliation report 🔴
**Goal:** The delete gate can't hang; historical double-pay incidents are findable (WS20's deferred item).
**Files:** js/departments.js.
**Instructions:**
1. Rewrite `window.financeDelete` (441-490) without the async-executor anti-pattern: `async function financeDelete(...) { const ok = await confirmDialog(...); if (!ok) return false; ... }` — plain async, no `new Promise`.
2. Build the deferred payroll reconciliation report (president-only, under Finance → Reports): for each month with a pay_run, diff ledger `PAY-` rows against pay_runs lines and salary_history; flag employees with >1 payment-shaped row per month, amounts differing from the frozen run, or salary_history rows with no matching run (the Path-B era fingerprint). Read-only report + CSV export; any fix routes through financeDelete/manual entry, never auto-mutation.
**Verify:** report runs over all history without error; known-good months show zero flags.
**Depends:** Phases 13–14 (deterministic refs make the diff reliable).

---

## STAGE 2 — Security hardening (Phases 21–30)

### Phase 21 — Validate approval_requests creation
**Goal:** Requests can't be forged for other users or with arbitrary shapes (H3).
**Files:** firestore.rules (697-712).
**Instructions:**
1. Replace `allow create: if isAuth();` with: `isAuth() && d.get('userId','') == request.auth.uid` (finance/admin may file on behalf: `|| isFinanceOrAdmin()`), `d.get('status','') == 'pending'`, `d.get('type','') in [<enumerate the live types — grep approval_requests writes: 'signup','attendance','submission','review-task','leave','ca_deduct','quote', ...>]`, `d.keys().hasOnly([...])` with the union of legit fields, `amount` (when present) a non-negative number.
2. Grep every client write to approval_requests and confirm each satisfies the new shape before deploying (blank-screen prevention).
3. Deploy rules; regression-test each request type creation as a normal employee.
**Verify:** devtools attempt to create a request with another userId is denied.
**Depends:** Phase 1.

### Phase 22 — Close the posts rules gap
**Goal:** Server enforces the publish/approval model the UI promises (C10, M7 part).
**Files:** firestore.rules (166-179), js/modules.js.
**Instructions:**
1. create: `isAuth() && !isPartner()` AND (`isPresident() ? status in ['published','pending'] : status == 'pending'`) + `hasOnly` field allowlist + `authorUid == request.auth.uid`.
2. update: keep author/admin edits; add explicit publish-transition clause — decide with Neil whether secretary may approve posts (UI currently says no at modules.js:45, rule says yes via isAdmin). Implement the decision on BOTH sides.
3. hearts: scope the diff to the caller's own uid membership change (mirror the chat reactions pattern at 396-399): new hearts must equal old ± exactly `[request.auth.uid]`.
4. Deploy; test: employee direct-publish attempt denied; heart-toggle still works; forged hearts array denied.
**Verify:** as above.
**Depends:** Phase 1.

### Phase 23 — Storage ownership on collaborative folders
**Goal:** Only the uploader or an admin can delete/overwrite a file (H4).
**Files:** js/drive.js, storage.rules (188-219).
**Instructions:**
1. In Drive.uploadFile (and every direct `storage.ref().put` site — grep `.put(`), set `customMetadata: {uploadedBy: currentUser.uid}`.
2. storage.rules collaborative paths (tasks/posts/general/General/{department}): split `write` into `create` (signed-in + size/type caps, as today) and `update/delete` requiring `resource.metadata.uploadedBy == request.auth.uid || isAdminClaim()`; legacy blobs with no metadata: allow admin-only delete (`resource.metadata.uploadedBy == null && isAdminClaim()`).
3. Deploy storage rules; run backfillUserClaims if claims shape changed (it didn't — skip unless prompted).
4. Optional follow-up (Files Hub parity): a scheduled function or manual tool to stamp uploadedBy metadata onto legacy blobs from hub_files docs.
**Verify:** user B cannot delete user A's task attachment; A still can; president still can.
**Depends:** Phase 1.

### Phase 24 — Chat file access posture
**Goal:** Decide and implement the chat-files read model (rules finding 8).
**Files:** storage.rules (146-158), js/chat.js.
**Instructions:**
1. Present the trade-off to Neil: (a) keep open-get + unguessable names (status quo, documented), or (b) participant-checked reads via per-conversation custom claims are impractical — the workable hardening is moving chat uploads under `chat-files/{convId}/` with a Firestore-mirrored allowlist enforced at the app layer + signed URLs. Recommend (a) + documentation now, revisit if chat carries sensitive finance docs.
2. Whatever the ruling: document it in storage.rules comments and SECURITY notes; add `rel="noopener noreferrer"` audit for chat link renders (already present — confirm).
3. Replace the inline `onclick="window.open('${...}')"` image-open pattern (chat.js:779) with the data-attribute + addEventListener pattern already used at modules.js:176-179.
**Verify:** image bubbles still open; no inline-interpolated URLs remain in chat.js (`grep "onclick=\"window.open" js/chat.js` → empty).
**Depends:** —

### Phase 25 — Rules tier cleanup (secretary ruling, kpi_evals, projects, users)
**Goal:** The two-tier secretary model is explicit and consistently enforced (M7, findings 3/5/6).
**Files:** firestore.rules, docs.
**Instructions:**
1. Get Neil's one-paragraph ruling: which write surfaces secretary keeps (minor approvals per the standing decision) vs loses. Default recommendation: keep attendance/leave/signup/submission actions; remove kpi_evals delete, hub_files ACL changes, and destructive deletes (projects/design_drawings/production_orders/stock_movements/clients) by introducing `isSeniorAdmin()` on those deletes.
2. kpi_evals delete (438): `isFinanceOrAdmin()` → `isMoneyAdmin()` minimum.
3. projects create (797): add `!isPartner()` + `createdBy == request.auth.uid` + minimal shape.
4. users self-signup (113): `request.resource.data.role == 'employee'` → `.get('role','') == 'employee'` (convention consistency).
5. Deploy; run the role-spread smoke test (Phase 10 checklist).
**Verify:** secretary account matches the ruling exactly; no blank screens.
**Depends:** Phases 1, 21–22.

### Phase 26 — Quote builder XSS + partner cost exposure 🔴
**Goal:** Close C8 and C9.
**Files:** quote-builder-v2.html.
**Instructions:**
1. Retrofit `txtEsc()`/`attrEsc()` (1083-1085) onto renderItems: `${txtEsc(item.name)}`, spec text, notes (1972-1974); search dropdown product name (1652); calc-panel title (1705). Note the cells are contenteditable — escape on render, and on `editName`/blur handlers read `textContent` (not innerHTML) before storing.
2. Add `GENERIC_PARTNER` detection (the `?pcoName=` CO.PT path, 1202-1223): when set, remove `btnInternal` (444) and the Cost & Margin section (909-936) from the DOM entirely (not display:none).
3. Confirm with Neil whether Brilliant Steel keeps internal-cost visibility (standing 50/50 arrangement says yes).
4. Bump CACHE_VER via commit; test by planting `<img src=x onerror=alert(1)>` as an item name in a test quote and reopening it — must render inert text.
**Verify:** XSS probe inert; a CO.PT partner session shows no Internal tab.
**Depends:** Phase 10.

### Phase 27 — App-side XSS consistency sweep
**Goal:** The escaping conventions hold at 100%, not 98% (app.js/departments.js title findings).
**Files:** js/app.js, js/departments.js.
**Instructions:**
1. app.js: wrap `fileUrl` in `safeHttpUrl()` at 6249, 6256, 6308 (policies + downloads; memo modal at 6118 is the reference pattern); add `rel="noopener noreferrer"` to every `target="_blank"` anchor missing it (grep).
2. departments.js: escape user-derived strings in modal/page titles at 1534 (`escHtml(s.title)`), 3791 (`escHtml(rec.userName)`), 6240 (`escHtml(profile.name)`); grep `openPage(\`` and `openModal(` for any other interpolated user fields and fix the same way.
3. Grep-audit: `grep -nE "innerHTML|insertAdjacentHTML" js/*.js | wc` — sample 20 random sites for escHtml discipline; log results in the commit message.
**Verify:** a user named `<b>x</b>` renders literally in every touched title.
**Depends:** —

### Phase 28 — Kill plaintext generated passwords 🔴
**Goal:** No credential is ever persisted readable (C11).
**Files:** js/departments.js (10712-10727, 11265-11320), functions/index.js, firestore.rules.
**Instructions:**
1. Change the signup-approval flow: instead of storing `generatedPassword` on the request doc, (a) create the Auth user with the generated password via the existing secondary-app pattern or a new `adminCreateUser` callable (preferred: callable — server-side, no client secondary app), (b) show the password ONCE in the approval modal for the admin to hand over, (c) never write it to Firestore; store only `passwordDelivered: true`.
2. One-time cleanup tool (migrations): strip `generatedPassword` from all historical signup_requests docs (`FieldValue.delete()`), count and report.
3. Consider (Neil decision): switch to Firebase's password-reset-email flow for employees with real emails — removes password handling entirely; keep generated passwords only for username-based worker accounts.
4. Raise adminResetPassword's minimum length from 6 → 10 while in functions.
**Verify:** new approval writes no password field; historical docs cleaned; worker can still log in.
**Depends:** Phases 1, 15 (same code region — coordinate).

### Phase 29 — Partner & privacy data-flow hardening
**Goal:** Sensitive rows stop traveling to browsers that only hide them (M8, Clients defense-in-depth).
**Files:** js/modules.js, js/departments.js, firestore.rules.
**Instructions:**
1. cash_advances admin list (modules.js:1524-1560): query `where('private','!=',true)` for non-president/finance viewers (or split private records to a subcollection/flagged query) so manager/secretary never receive private docs over the wire; keep the display filter as belt-and-braces. Composite index if needed → firestore.indexes.json + deploy.
2. Clients.listAll (departments.js:205-222): add `where('brands','array-contains',brand)` server-side when opts.brand is set (index as needed); rules already deny partners — this is wire-hygiene + perf for internal roles.
3. renderSalesPartnerQuotes (7701-7735): add a comment-block contract naming the rule line it depends on; add owner filtering as defense-in-depth where cheap.
4. Document in firestore.rules header: the three public-get surfaces (usernames, order_tracking, id_verify) and the invariant that they stay `list:false` + token-keyed.
**Verify:** manager's network tab shows no private CA docs; brand-scoped client queries return scoped sets.
**Depends:** Phase 1.

### Phase 30 — Notification abuse limits + CDN integrity
**Goal:** The open notification-create can't be weaponized; CDN compromise is detectable (M11 part, no-CSP finding).
**Files:** firestore.rules (182-197), js/notifications.js, index.html.
**Instructions:**
1. Notifications dedup: extend `dedupKey` checking to sendToDept/sendToAll/sendToOwner (notifications.js:294-353) — derive a default dedupKey (type+targetId+bizDate) when absent.
2. Rate limiting (client-honest tier now, server enforcement in Phase 68's callable): per-sender in-app throttle in Notifs.send; document the server-side quota as Phase 68 scope.
3. index.html: add SRI `integrity` + `crossorigin` attributes to the pinned CDN scripts (Firebase 10.12.2, Lucide 0.468.0; compute hashes from the exact pinned files); add them to the Chart.js lazy-loader (config.js:811-820) too. Add a conservative CSP meta (`script-src 'self' https://www.gstatic.com https://unpkg.com https://cdn.jsdelivr.net 'unsafe-inline'` — inline handlers force unsafe-inline for now; note the Phase-50 goal of removing inline handlers where cheap, then tightening).
4. Test all three themes + login + chat + charts with CSP on; loosen only what breaks, documenting each allowance.
**Verify:** app fully functional with CSP active; tampered CDN file (hash mismatch simulation) refuses to load.
**Depends:** Phase 1.

---

## STAGE 3 — Re-architecture I: foundations & services (Phases 31–40)

### Phase 31 — Architecture decision record
**Goal:** The remodel's rules are written before the first file moves.
**Files:** new `ARCHITECTURE.md`.
**Instructions:**
1. Document: the Part-D layout; ES-module conversion rules (export named functions; `window.X = X` only for inline-handler needs, marked `// @global: inline handlers`); import-order-free initialization (each module self-contained; boot.js is the only entry orchestrator); the "no business logic in render functions" rule for services; file-size guardrail (~800 lines soft cap); the PRECACHE/index.html registration checklist.
2. Define the migration invariant: after every phase the app must run — no big-bang.
3. Add the router-registry contract (Phase 50): `registerPage(name, {render, guard, nav})`.
4. Get Neil's sign-off before Stage 4 begins.
**Verify:** doc reviewed; CLAUDE.md updated to point at it.
**Depends:** Stages 0–2 conceptually complete (can be written in parallel).

### Phase 32 — Shared helpers module (lib layer)
**Goal:** The duplicated primitives become one implementation each; escHtml moves to safe ground (M3, app.js §5).
**Files:** new js/lib-helpers.js (final home js/lib/helpers.js at Phase 50's re-path), js/config.js, js/modules.js, all callers.
**Instructions:**
1. Create lib-helpers.js loading FIRST after firebase-config.js: move `escHtml`, `safeHttpUrl` (from modules.js:9-24); add `DONE_TASK_STATUSES = ['done','approved','archived']`; `safeGet(query, fallback)`; `renderErrorState(container, err)`; one canonical `fmtPeso(n, {dp})`; `round2`; `avatarInitials(name)` (escaped); `presenceBucket(lastSeen)`; `fmtMonthLabel` (from Phase 17).
2. Replace call sites: DONE-status array ×8+ (app.js 2493, 2700, 2814, 3050, 4401, 4596, 5315, 5401 + departments/modules hits by grep); safeGet ×5 (2474, 2683, 2797, 2886, 6483); error-render ×6; peso formatters ×3 (app.js 1672, 6530 + departments.js:10 stays as the canonical target or is re-exported); initials ×4 (chat.js 168/263/699, departments.js 2147); presence ×2 (chat.js 631-639 + app.js team local).
3. Keep `window.escHtml` etc. assigned for inline handlers; leave one-line re-exports at old locations for one release (`window.escHtml = window.escHtml || ...` ordering safety), then remove.
4. index.html + PRECACHE registration; `node --check` all touched files; full smoke test (this touches everything).
**Verify:** `grep -c "done','approved','archived" js/` → 1; QA checklist pass.
**Depends:** Phase 31.

### Phase 33 — Split config.js into config + services
**Goal:** config.js becomes pure configuration (M4).
**Files:** js/config.js → new js/svc-cash-advance.js, js/svc-insights.js, js/svc-bank-accounts.js, js/svc-leave.js, js/ui-dialogs.js (Overlay + confirm/prompt + chipTabs + sopPanel + periodPicker), js/lib-csv.js; index.html; sw.js.
**Instructions:**
1. Move verbatim (no logic changes in this phase): CashAdvance (1328-1681) → svc-cash-advance.js; Insights (718-778) → svc-insights.js; BankAccounts (580-633) → svc-bank-accounts.js; LeaveAccrual (307-354) → svc-leave.js; Overlay/dialogs/chipTabs/sopPanel/setSubroute/periodPicker (918-1004 + related) → ui-dialogs.js; exportCSV (848-872) → lib-csv.js.
2. config.js keeps: APP_VERSION, BIZ_TZ + biz* time helpers, BRAND/brandEntity, DEPARTMENTS, ROLES, LEAVE_POLICY (data), nav arrays, COA (data), Period/finPeriod helpers, dbCachedGet (until Phase 88), statutory-adjacent constants.
3. Load order in index.html: lib-helpers → config → ui-dialogs → svc-* → (rest unchanged). gestures.js needs Overlay — keep it after ui-dialogs.
4. Every moved global keeps its `window.` name — zero call-site changes required.
5. PRECACHE all new files; smoke test per role.
**Verify:** app boots with zero console errors; CashAdvance flows work; config.js < 900 lines.
**Depends:** Phase 32.

### Phase 34 — ES-module pilot on leaf files
**Goal:** Prove the module pattern on low-risk files before the monoliths (D1).
**Files:** js/statutory-tables.js, js/letterhead.js, js/gestures.js, index.html.
**Instructions:**
1. Convert the three leaf files to `<script type="module">`: add `export` to their public functions, keep the `window.X = X` lines, remove reliance on implicit globals by importing from lib-helpers/config once those are modules — for the pilot, modules may still read `window.*` (hybrid is fine and shippable).
2. index.html: `type="module"` on the three tags (modules are deferred by default; order among modules no longer matters, but keep position for readability).
3. Confirm sw.js caching treats them identically (same-origin fetch — it does).
4. Document the conversion recipe in ARCHITECTURE.md (this exact diff is the template for all later conversions).
**Verify:** payslips still print (letterhead), statutory compute still banner-warns, gestures still work on mobile; zero console errors on hard reload + SW update cycle.
**Depends:** Phases 31–33.

### Phase 35 — The Approvals service
**Goal:** One write path per approval type; renderApprovals halves (M1).
**Files:** new js/svc-approvals.js, js/departments.js (10451-11562).
**Instructions:**
1. Build `window.Approvals` with per-type `{approve(id, ctx), reject(id, ctx)}` for the three duplicated types: Signup (from 10712-10727 / 11265-11320 — fold in Phase 15's atomic employeeId + Phase 28's no-plaintext-password flow), FinanceDelete + PayrollDelete (10833-10875 / 11095-11136), Leave (10932-10942 / 11167-11177 → delegate to the existing approveLeaveRequest/rejectLeaveRequest).
2. Existing services (CashAdvance, RaiseFlow, approvePurchaseOrder, financeExecuteDelete, approveQuoteApproval) get thin registry entries so ALL types dispatch uniformly: `Approvals.dispatch(type, action, id)`.
3. Rewrite both the 'all' aggregated view and each subtab to call the registry; delete the inline duplicates.
4. Merge the double fetch: `loadApprovalsSub('all')`'s result set also feeds the badge counts (10500-10514 dies).
5. Full approvals regression per type (QA checklist section).
**Verify:** every approval type works from BOTH the all-view and its subtab; network tab shows one fetch wave, not two.
**Depends:** Phases 15, 28, 32.

### Phase 36 — Extract finance-ledger.js and payroll-engine.js
**Goal:** The money core becomes two pure, DOM-free modules (D3).
**Files:** js/finance-ledger.js (exists since Phase 12 — now absorb), new js/payroll-engine.js, js/departments.js.
**Instructions:**
1. finance-ledger.js absorbs: postExpenseToLedger, postCRJToLedger, postCDJToLedger, resyncLedgerForSource, _deleteLedgerByRef/_syncLedgerLeg, financeDeleteCascade, financeExecuteDelete/financeDelete, backfill tools' ledger cores.
2. payroll-engine.js: computePayLine, computePayRun, disbursePayRun (with Phase 11's lock), reopenPayRun, RaiseFlow (departments.js 3155-3661) — zero DOM references (assert: no `document.` in file); renderPayrollManagement stays behind and calls the engine.
3. Both convert to ES modules per the Phase-34 recipe; register in index.html (before departments.js) + PRECACHE.
4. Run a full test-month Compute → Verify → Disburse → reopen cycle against test data.
**Verify:** `grep -c "document\." js/payroll-engine.js` → 0; money cycle identical results pre/post split (diff the pay_run doc).
**Depends:** Phases 11–14, 34.

### Phase 37 — migrations.js
**Goal:** ~520 lines of one-time tools leave the hot path.
**Files:** new js/migrations.js (lazy-loaded), js/departments.js, js/app.js.
**Instructions:**
1. Move: backfillProjectKind/runProjectKindBackfill (101-127), remapDesignProjectClients (169-185), migrateClientBooks (320-369), backfillLedgerFromJournals + backfillPayrollLedger (1925-1992), runTagAccountTypes/runRestateMaterialCosts/runFixUndatedRows (4577-4685), runCADataRepair (5438-5497), migrateStrandedBKQuotes (app.js 8620s), Phase-14's ledger-id migration, Phase-28's password-strip tool.
2. Lazy-load: not in the standard script chain; a president-only "Maintenance" page (`import('./migrations.js')` on demand — dynamic import works in classic-script pages when the target is a module).
3. Each tool: dry-run default, loud counts, idempotent — verify each still passes a dry-run after the move.
**Verify:** main bundle line-count drops; Maintenance page lists and dry-runs every tool.
**Depends:** Phases 34, 36.

### Phase 38 — pricing-engine.js
**Goal:** One pricing implementation for quote builder, Quick Estimate, and schedules (D3, kills the three-way drift).
**Files:** new js/pricing-engine.js, quote-builder-v2.html, js/departments.js (6905-7209), js/config.js (780-808).
**Instructions:**
1. Extract from QB post-Phase-19: `computeUnitPrice(product, dims, specs, meta)`, `computeTotals(items, opts)`, `buildBalanceSchedule(grand, dp, months, rate)` — pure functions, no DOM, no Firestore.
2. quote-builder-v2.html includes it via `<script src="js/pricing-engine.js">` (same-origin; iframe isolation for UI preserved, math shared).
3. Quick Estimate (qeUnitPrice, 6923-6955) and config.js buildBalanceSchedule (780-808) delegate to the engine; delete the "faithful port" comments and the exclusive-VAT divergence — Quick Estimate adopts the engine's convention and labels VAT identically to the QB.
4. Table-driven test harness: a dev-only `PricingEngine._selfTest()` with ~10 fixture products (incl. per_length with D/H rates, null-price, discount+VAT ordering) asserting exact totals.
**Verify:** same line items produce identical totals in QB, Quick Estimate, and the payment schedule; self-test green.
**Depends:** Phase 19, 34.

### Phase 39 — print-docs.js
**Goal:** Six print scaffolds become one (M2).
**Files:** new js/print-docs.js, js/departments.js.
**Instructions:**
1. Build `openPrintableDoc({title, bodyHtml, brand, watermark, pageCss})` wrapping the window.open + document.write + button-bar + `@page/@media print` boilerplate; body content still comes from callers; buildLetterhead stays the header/footer source.
2. Migrate: buildBillingInvoiceHTML (8748-8903), printDeliveryReceipt (13149-13224), openInventoryCountForm print path (14376-14488), openAECPrintSheet (11871-11935), printPurchaseOrder (15433-15577), printReceivingReport (15581-15623) — each shrinks to its body table.
3. Confirm each printed doc pixel-matches its predecessor (print-preview side-by-side).
**Verify:** all six documents print with letterhead, correct page CSS, no console errors.
**Depends:** Phase 34.

### Phase 40 — Status metadata unification
**Goal:** One vocabulary + badge map per status domain (M2).
**Files:** new js/ui-status-meta.js (or fold into lib-helpers), js/departments.js.
**Instructions:**
1. `QUOTE_STATUS_META` array + `quoteStatusBadge(q)` covering the union vocabulary (draft/pending/approved/rejected/returned/won/accepted/lost/needs_revision/expired — enumerate from the four implementations at 9604, 9670, 10408, 12155-12160); replace all four.
2. Resolve the tasks `'submitted'`/`'review'` alias (566-567 vs 1159): pick `'review'` as canonical, migrate the dropdown, one-time data sweep for stragglers (migrations.js), keep read-compat for both for one release.
3. Export the existing PROD_STAGES/JOB_STAGES/CRM_STAGES/AEC_STAGES from the same module for discoverability (move, keep names).
**Verify:** the same quote shows the same badge on all four screens; task filters bucket consistently.
**Depends:** Phase 32.

---

## STAGE 4 — Re-architecture II: the monolith splits (Phases 41–50)

**Stage rule:** every split phase is move-verbatim-then-verify — no logic changes ride along with a move. Each phase ends with: index.html + PRECACHE updated, `node --check` green, QA smoke pass, commit.

### Phase 41 — app.js split A: boot, overlay, nav/router shell
**Goal:** The stable core isolates first (app.js §7 plan).
**Files:** new js/core-boot.js, js/core-overlay.js, js/core-nav.js; js/app.js; index.html; sw.js.
**Instructions:**
1. core-boot.js ← app.js 1-493: state globals + ROLE_TYPE_MAP, auth state machine, presence heartbeat, force-logout, checkBackupHealth, claims refresh, auto-logout, reminders, splash/showLogin/showApp, pull-to-refresh. Consolidate the two DOMContentLoaded listeners (31, 1151) into one while moving.
2. core-overlay.js ← 7770-7822 (openModal/openPage/closeModal).
3. core-nav.js ← 906-1209 (nav builders, sidebar edge-swipe — flag for Phase 64), 2016-2147 (hashFor/parseHash/navigateTo/setActiveNav), 7823-7992 (router listeners + Keymap), 7993-8027 (fitKpiValues).
4. Load order: core-overlay → core-nav → core-boot after the svc layer; app.js (remainder) after.
5. While moving navigateTo: no rewrites yet (registry comes in Phase 50) — the switch moves intact.
**Verify:** login → dashboard → 5 pages → logout, all roles; hash deep-links still resolve; Esc/⌘K shortcuts work.
**Depends:** Phases 31-34.

### Phase 42 — app.js split B: dashboards + profile
**Goal:** Role dashboards and the profile/ID complex become feature files.
**Files:** new js/feat-dashboards.js, js/feat-profile.js; js/app.js.
**Instructions:**
1. feat-dashboards.js ← 2148-3402 (getAllQuotes, renderDashboard + 5 role dashboards + time-in/out + attendance-extension handlers 3406-3467), 8028-8077 (renderMiniCal). Apply the Phase-32 shared helpers as call-site replacements (safeGet/DONE statuses/error-render are already global — just delete the local copies while moving).
2. feat-profile.js ← 495-664 (loadUserProfile/applyUserUI), 3468-3701 (ID cards + print), 5066-5377 (standings modal + worker profile panel), 7530-7768 (profile drawer). Extract the duplicated attendance-grid into `renderAttendanceGrid(uid, monthAnchor, container)` in ui layer during this move (both copies at 5096-5114 and 5340-5354 call it).
**Verify:** each role's dashboard renders identical KPIs pre/post (screenshot diff); ID card prints; attendance grids match.
**Depends:** Phase 41.

### Phase 43 — app.js split C: HR + company/static content
**Goal:** The HR console and CMS leave app.js; static copy becomes data (app.js §7.6).
**Files:** new js/feat-hr.js, js/feat-company.js, new data/help-content.js (or JSON); js/app.js.
**Instructions:**
1. feat-hr.js ← 4375-5063 (Personal Finance — split into renderPersonalFinanceAdmin / renderPersonalFinanceSelf at the existing if(pres) seam; router picks by role), 5384-5589 (Progress Reports), 7168-7529 (Team & Payroll + employee/worker modals + password reset).
2. feat-company.js ← 4097-4345 (SOPs + Gov Biddings entry + generic dept + files tab), 5591-6476 (Company hub + Departments admin), 8084-8166 (Suggestion Box etc.).
3. Static copy out of code: DEFAULT_SOPS (4099-4222), handbook seeds, Help guides (8167-8539) move to `data/help-content.js` exporting plain objects — content edits stop being code diffs.
4. Migrate `#progress-top-tabs` (5434-5437) and `#help-tabs` (8186-8198) to chipTabs while moving (the two straggler subtab bars in app.js).
**Verify:** Personal Finance admin + self views work per role; Company tabs render; Help/SOP content identical.
**Depends:** Phase 42.

### Phase 44 — app.js split D: analytics, catalog, partners, quote host
**Goal:** app.js is done — reduced to a thin shell (target < 400 lines).
**Files:** new js/feat-analytics.js, js/feat-catalog.js, js/feat-partners.js, js/feat-quote-host.js; js/app.js.
**Instructions:**
1. feat-analytics.js ← 6478-7166 verbatim (the self-contained closure — lowest-risk extraction). Fix the unscoped lucide call at 5697's pattern if present here; bound reads come in Phase 87, not now.
2. feat-catalog.js ← 1420-2015 (catalog seed/import + Product Database + BOM modal) + 1548-1647 (renderAuditLog). Add the missing `.catch` on the product reads (1655-1658) while moving (error-state instead of stuck loading).
3. feat-partners.js ← 2184-2452 (partner dashboards/projects), 3702-4014 (dept routing stays in core-nav; Partners dept + loadPartnersDeptTab move), 4015-4095 (deal modal).
4. feat-quote-host.js ← 1224-1421 (iframe host + reviewed-quote save) + 8541-8677 (postMessage bridge with Phase-19's nonce idempotency).
5. What remains in app.js: nothing but a deprecation comment or delete the file and update index.html/PRECACHE accordingly.
**Verify:** analytics charts render all subtabs; catalog import dry-runs; partner portal + quote filing round-trip.
**Depends:** Phase 43.

### Phase 45 — departments.js split A: finance screens & CRUD component
**Goal:** The six copy-paste finance tables become one component; finance UI leaves the monolith.
**Files:** new js/ui-crud-table.js, js/feat-finance.js; js/departments.js.
**Instructions:**
1. ui-crud-table.js: `renderFinanceCrudTable({container, collection, title, columns, formFields, ledgerSync, canDelete})` — table + add/edit modal (financeEditModal-based) + financeDelete routing + CSV export hook.
2. feat-finance.js ← renderFinance shell (2981-3154), Taxes (4323-4410), Reports (4434-4549), period tools (4552-4576), Ledger tab (4688-4859), Bank Accounts (4865-5071), CRJ (5074-5191), CDJ (5194-5322), Records (5325-5426), Finance CA (5498-5615), Finance Overview (6719-6784) — expressing Taxes/CRJ/CDJ/Records via the CRUD component (Ledger/Bank keep their custom renderers, share the modal/delete plumbing).
3. Cash/Expense module (1605-2109 minus the ledger cores already in finance-ledger.js) moves here too.
4. Convert the renderCash + renderFinanceCA subtab bars to chipTabs while moving (stragglers at 1613, 5526).
**Verify:** every finance tab CRUDs; ledgerSync fires via Ledger service; row counts pre/post identical.
**Depends:** Phases 36, 41.

### Phase 46 — departments.js split B: HR/payroll UI + tasks + submissions
**Goal:** Payroll screens and the task system get their own homes.
**Files:** new js/feat-payroll-ui.js, js/feat-tasks.js; js/departments.js.
**Instructions:**
1. feat-payroll-ui.js ← renderPayrollManagement (3663-4320), HR Profiles + Worker IDs (5619-6003), Payslip workflow + template (6011-6716), renderHR + raise UI (3040-3154). All engine calls already route to payroll-engine.js.
2. feat-tasks.js ← task status system + renderDeptTasks (561-745), renderTasks/openTaskDetail complex (750-1283), task modals (1296-1479), Submissions (1485-1600), renderComments (2114-2351). Decompose openTaskDetail per the followUpCard precedent into renderTaskStatusCard/StandingCard/AssigneeCard/ScoreCard + binders — this is the one permitted logic-touch (structure only).
3. Replace the repeated role literal (752, 898, 974, 1300, 1501, 1532, 1607, 1638, 6012) with isFinancePriv()/new isAdminTier() while moving.
4. Task dropdown: cached users read (1136-1141 → dbCachedGet like 1303).
**Verify:** payroll month cycle on test data; task lifecycle end-to-end (create→submit→review→score); comments thread.
**Depends:** Phases 36, 45.

### Phase 47 — departments.js split C: approvals page, CRM, files hub
**Goal:** The approvals UI, client book, and file UI stand alone.
**Files:** new js/feat-approvals-page.js, js/feat-crm.js, js/feat-files-hub.js; js/departments.js.
**Instructions:**
1. feat-approvals-page.js ← renderApprovals/loadApprovalsSub (10451-11562, already service-backed since Phase 35) + quote-approval helpers (11485-11561).
2. feat-crm.js ← window.Clients + migrations pointers (193-313), AEC directory (11563-11935), CRM_STAGES/renderClientProfiles/openClientHub (11941-12255), Budgeting (12260-12471), Marketing (2356-2976 — or its own feat-marketing.js if size warrants; prefer separate file).
3. feat-files-hub.js ← renderFileCollection/bindFileCollection (12476-12881), renderDocCollection (12884-13012), DesignFolders (137-162), plus modules.js's renderFilesHub shell (2590-2676).
4. Share-dialog users read (12680) → cached directory.
**Verify:** approvals per type; client hub timeline; file upload/share/recycle; gov-biddings doc moves.
**Depends:** Phases 35, 45.

### Phase 48 — departments.js split D: design, IT, BS/sales, production, purchasing
**Goal:** departments.js ceases to exist.
**Files:** new js/dept-design.js, js/dept-it.js, js/dept-sales.js, js/dept-production.js, js/dept-purchasing.js; delete js/departments.js.
**Instructions:**
1. dept-design.js ← 7741-8737 (Design + project detail + drawings) + openBillingInvoice body (print core already in print-docs).
2. dept-it.js ← 8905-9465.
3. dept-sales.js ← renderSales shell + Quick Estimate host + SOP editor + BK/partner quotes (6794-7735), Brilliant Steel module (9474-9762 + 10178-10446), order tracking + sales orders + Record Sale (9767-10176 — money cores already in Ledger), Projects lifecycle (13232-13692).
4. dept-production.js ← 13018-13224 + 13694-14522 (QC, orders board, consumeProductionMaterials caller, count form, materials).
5. dept-purchasing.js ← 14532-15427 (print bodies via print-docs).
6. window.Projects (55-97) → svc layer (js/svc-projects.js) — it's a data service, not a screen.
7. Delete departments.js from index.html + PRECACHE; verify nothing references the filename (`grep -rn "departments.js" index.html sw.js CLAUDE.md`).
**Verify:** full QA checklist pass — this is the largest single step; budget a full regression session.
**Depends:** Phases 45–47.

### Phase 49 — modules.js split + dead-code deletion
**Goal:** The last monolith dissolves; confirmed dead code dies.
**Files:** new js/feat-posts.js, js/feat-team.js, js/feat-attendance.js, js/feat-cash-advance-ui.js, js/feat-inventory.js, js/feat-leave-ui.js, js/feat-search.js, js/feat-my-profile.js; delete js/modules.js; firestore.rules.
**Instructions:**
1. Split along the existing seams: Posts (41-345), Team+EOM (351-902; extract the invite flow into svc-onboarding.js or a callable per Phase 28's direction), Holidays+Attendance (907-1388), Cash Advance UI (1394-1740, post-Phase-18), Inventory IIFE (1853-2189), Leave IIFE (2197-2493), Global Search IIFE (2502-2582), My Profile (2681-2996).
2. Delete: renderCompanyOverviewNew + renderPresidentMessageCard (1746-1848), PRESIDENT_UID (29), workingDays (2211-2218).
3. Remove the `president_message` collection rule (firestore.rules:490) + deploy; delete any lingering president_message docs (migrations tool, president-approved).
4. escHtml/safeHttpUrl are already in lib-helpers (Phase 32) — confirm no duplicate definitions remain.
**Verify:** posts/team/attendance/CA/inventory/leave/search/profile all function; `git grep renderCompanyOverviewNew` → empty.
**Depends:** Phases 32, 18, 46–48.

### Phase 50 — Router registry + guards + full module conversion
**Goal:** The navigateTo switch becomes a registry; every page declares its own access gate; the script chain is fully modular (D1, D2).
**Files:** js/core-nav.js, all feat-*/dept-* files, index.html, sw.js, ARCHITECTURE.md.
**Instructions:**
1. `registerPage(name, {render, guard, title, nav})` in core-nav; each feature file registers its pages at module init; navigateTo becomes lookup + `guard(currentRole, currentDepts)` + render, with renderAccessDenied on failure — the shared guard() kills the 8 copy-pasted role gates and fixes the "demoted user keeps the open admin page" hole (re-run the guard on claims refresh: startClaimsListener triggers `navigateTo(currentPage, {force:true})`).
2. Convert every remaining classic script to `type="module"` per the Phase-34 recipe; index.html's chain order now only matters for the non-module SDK tags.
3. Re-path files into the Part-D directory layout (js/core/, js/lib/, js/svc/, js/features/, js/ui/, js/data/) in ONE commit (pure renames; update index.html + PRECACHE + any dynamic import paths).
4. Update CLAUDE.md's architecture section (load order description, new layout) and ARCHITECTURE.md.
5. Full QA pass + SW update cycle test (old tab → new SW → reload prompt once Phase 62 lands; before that, verify silent takeover still functions).
**Verify:** deep-link every page cold; role-demotion mid-session re-gates the open page; `grep -c "defer" index.html` matches expectation.
**Depends:** Phases 41–49.

---

## STAGE 5 — Design-system remodel (Phases 51–58)

### Phase 51 — Mechanical CSS inventory
**Goal:** An exhaustive, safe-to-delete dead-selector list (M14 CSS part).
**Files:** new scripts/css-inventory.js; css/styles.css (deletions only).
**Instructions:**
1. Script: extract every class/id selector from styles.css; extract every class-string literal from js/**/*.js + *.html (class=, classList, className, querySelector); diff → report `dead-selectors.txt` with line numbers. (Haiku-tier mechanical task.)
2. Manually review the report for dynamic-classname false negatives (template `${...}` class fragments — grep each candidate once before deleting).
3. Delete confirmed-dead rules, starting with the already-verified set: .topbar-title (969-978), .topbar-brand family ×3 (981-986, 2755-2758, 2948-2951), .team-card-grid (3002), .expense-card (2094), .approval-request-bar (2084-2089), .quote-subtotal/.quote-actions (2081-2082), .member-chip (2175-2179), .payroll-photo (3268), + the byte-identical duplicate at 2948-2951.
4. Wire the inventory script into ci.yml as a warn-only job (new dead selectors get flagged, not blocked).
**Verify:** visual smoke across the three themes after deletion; report archived in the commit.
**Depends:** —

### Phase 52 — tokens.css + token cleanup
**Goal:** The token contract stands alone and is internally consistent (M5 part).
**Files:** new css/tokens.css; css/styles.css; index.html; sw.js.
**Instructions:**
1. Move :root tokens (13-185) + the three theme blocks (html.light 2524-2582, html.theme-dark 2589-2648, html.theme-astral token part 2658-2751) into tokens.css, loaded before styles.css.
2. Delete the legacy alias blocks (2568-2580, 2634-2646) after grep-replacing their few consumers to the semantic tokens.
3. Fix the focus ring: delete the 5014 redeclaration; keep 279 on `var(--primary)`.
4. Add `--primary-fill` to ALL three theme blocks (currently theme-dark only, 2601) with the correct per-theme value so a fourth theme can't silently miss it.
5. Prune the ~30 defined-but-never-consumed tokens (from the inventory's var() usage list) — comment-tag any kept deliberately.
6. Add a `--press-scale` token; unify the 0.96/0.97/0.98/0.99 press-state zoo onto it (incl. the !important block at 4397-4402 — drop the !important).
7. Fix index.html:114's inline gradient to `var(--grad-green)`.
**Verify:** three themes visually unchanged except the focus ring (now theme-primary); WCAG-check the dark `--on-primary`/`--primary-fill` pair ≥ 4.5:1 (verify commit 31cdbef's fix landed; adjust the token if not).
**Depends:** Phase 51.

### Phase 53 — @layer architecture + file split
**Goal:** Cascade order becomes declared, not positional (M5 core).
**Files:** new css/base.css, css/shell.css, css/components.css, css/departments.css, css/chat.css; css/styles.css shrinks; index.html; sw.js.
**Instructions:**
1. Declare `@layer tokens, base, shell, components, departments, chat, astral, print;` first in tokens.css.
2. Split styles.css: reset/utilities/type/buttons/forms/badges (267-512) → base.css `@layer base`; topbar/sidebar/bottom-nav/top-nav-strip/drawer/modal/dialog (the §2-table selectors) → shell.css `@layer shell`; cards/KPI/lists/tables/id-card/subtabs/chips → components.css; module-specific (Posts/Team/Attendance/CA/Company/payroll/login) → departments.css; .ms-* Messenger block (3844-4183) → chat.css (lift-and-shift — already clean).
3. Wrap each file's rules in its layer; keep source untouched otherwise in this phase (consolidation is Phase 54).
4. index.html: replace the single stylesheet link with the ordered set (HTTP/2 makes multiple files cheap; alternatively a styles.css of pure @imports — prefer explicit links); PRECACHE all.
5. Move the Google-Fonts import out of CSS into a `<link>` in `<head>` with preconnect (the fix index.html:43-46 already asks for).
**Verify:** computed styles identical on key screens (spot-check via javascript_tool getComputedStyle diffs on topbar/modal/chip); Lighthouse render-blocking improves.
**Depends:** Phase 52.

### Phase 54 — Selector consolidation
**Goal:** One definition per component; the known visual bug dies (M5).
**Files:** css/shell.css, css/components.css.
**Instructions:**
1. For each multi-declared selector (.top-nav-strip ×6, #sidebar ×6, .modal-box ×5, .task-feed-item ×4, .subtab-btn.active ×4, .nav-item.active ×4, .top-nav-item ×4, .notif-item ×3, .page-header ×3, .subtab-bar ×3): compute the effective final style (devtools), write ONE consolidated rule + its media-query variants, delete the era-layers' copies.
2. Fix .topbar-logo-card/.topbar-logo-img/.topbar-logo-fallback: one definition implementing the CURRENT (iOS-era flat) design intent for all themes — kills the gold-glow hybrid in Dark/Astral; delete the accidental Light rescue patch (2943-2947) once the base is right; give the fallback badge a background that contrasts with its text.
3. Delete the now-empty Liquid-Glass-era non-Astral shells (the Astral parts move in Phase 55).
**Verify:** screenshot diff of topbar/sidebar/modals/nav across 3 themes × 3 tiers against pre-phase captures — intended changes only (logo card).
**Depends:** Phase 53.

### Phase 55 — astral.css extraction + conditional load
**Goal:** The showpiece theme pays its own way (M5, CSS §6.1).
**Files:** new css/astral.css; css/*; js/core-boot.js (theme loader).
**Instructions:**
1. Move every `html.theme-astral` rule (theme block extras 2658-2751, the entire Liquid Glass Astral content 3348-3843, scattered Astral component rules) into astral.css `@layer astral`.
2. Conditional load: theme switcher injects `<link id="astral-css" href="css/astral.css">` when Astral is selected (and on boot if persisted); removing the link on switch-away is optional (layer scoping makes it inert) — keep it simple: load-once, never unload.
3. Keep astral.css in PRECACHE (offline theme switching).
4. Confirm the blur-budget invariant: `grep -c backdrop-filter css/*.css` — all hits in astral.css only.
5. Move the splash-bar animation fix here or Phase 57 (it currently runs in all themes).
**Verify:** Light/Dark never fetch astral.css on cold load (network tab); Astral unchanged visually.
**Depends:** Phase 54.

### Phase 56 — Print layer
**Goal:** Any screen prints legibly; print templates share one mechanism (M5 print findings).
**Files:** new css/print.css.
**Instructions:**
1. Generic system: `@media print { body * {visibility:hidden} .print-target, .print-target * {visibility:visible} .no-print{display:none!important} }` — migrate payslip (5055-5097) and BIR (5099-5120) onto `.print-target`, deleting the duplicated resets.
2. Global fallback: `@media print { body, .card, .data-table, #page-content { background:#fff!important; color:#000!important; } }` so a Dark/Astral user's Ctrl+P is readable.
3. print-docs.js documents (separate windows) keep their own inline page CSS — unaffected.
**Verify:** print-preview a payslip, a BIR book, and a raw dashboard from Astral — all legible.
**Depends:** Phase 53.

### Phase 57 — Motion & animation performance pass
**Goal:** No layout/paint-storm animations; reduced-motion complete (CSS §4).
**Files:** css/*.css.
**Instructions:**
1. goldShine (262-265) and splashBarRun (1772-1775): rewrite `left` animation as `transform: translateX()`.
2. splashBarRun: scope the infinite run to the splash's actual lifetime (it already is splash-only; keep) — but drop it from non-Astral themes if Neil wants strict budget, else document the exception.
3. `.loading-placeholder` (2328-2335): replace the background-clip:text + background-position shimmer with an opacity pulse (compositor-friendly) in Light/Dark; keep the fancy shimmer Astral-only if desired.
4. Remove `will-change: background-position` (392, 1946, 1980, 2354).
5. Verify the reduced-motion block (5028-5053) covers the new animation names.
**Verify:** Performance panel shows no layout thrash during splash/loading; reduced-motion kills all movement.
**Depends:** Phase 55.

### Phase 58 — z-index scale + stacking fixes
**Goal:** Stacking is a designed system; the two known landmines are defused (M5 z-index findings).
**Files:** css/tokens.css, css/shell.css, index.html (inline 316), js/core-overlay.js.
**Instructions:**
1. Tokens: `--z-shell:90; --z-topbar:100; --z-panel:150; --z-drawer:195; --z-modal:200; --z-page-panel:210; --z-dialog:5000; --z-ptr:180; --z-splash:9999` — re-map every literal (full inventory is in the CSS report) onto tokens; move index.html:316's inline drawer-overlay z-index into the stylesheet.
2. Fix ranking: pull `.page-panel` from 4000 to just above modal (210) AND add an Overlay-level guard in core-overlay.js — openModal over an open page-panel must either stack above it (dialog tier) or be queued; pick stack-above (modal → --z-dialog tier when a page-panel is open).
3. PTR indicator below modal/notif layers (--z-ptr 180 < 200); test pull-to-refresh with a modal open.
4. Replace the hardcoded 56px/50px PTR offsets (1782, 1857-1859) with var(--topbar-h)/var(--top-nav-h).
**Verify:** modal over page-panel is visible and clickable; PTR ring renders under modals; no visual regressions in drawer/notif stacking.
**Depends:** Phase 54.

---

## STAGE 6 — UX declutter & PWA polish (Phases 59–66)

### Phase 59 — Approvals declutter: chips, counts, Grading
**Goal:** The most-visited admin page matches the owner's declutter directive (ROADMAP NEXT-UP 1).
**Files:** js/feat-approvals-page.js.
**Instructions:**
1. Replace the subtab bar with chipTabs + per-type counts (the counts now come free from the Phase-35 single fetch), defaulting to the unified "All Requests" list.
2. Add a **Grading** chip: aggregates completed tasks with no presidentScore/presidentGrade + KPI self-assessments awaiting president grade; each row deep-links to the existing scoring UI.
3. Collapse resolved items behind a "History" chip (default view = pending only) — addresses the never-pruned-resolved-docs growth on the read side.
4. Empty-state and per-chip SOP hints via sopPanel.
**Verify:** counts match reality per type; grading queue drains as the president scores.
**Depends:** Phase 47 (or apply directly to departments.js if Stage 4 is deferred — the phase is independent of the split).

### Phase 60 — Secretary two-tier approvals UI
**Goal:** Secretary acts on minor items, escalates major ones (ROADMAP NEXT-UP 2, M7).
**Files:** js/feat-approvals-page.js, js/svc-approvals.js, firestore.rules (per Phase 25's ruling).
**Instructions:**
1. Capability map in svc-approvals: per type × role → {act | escalate | view}. Secretary acts on: signups, attendance extensions, leave, submissions, review-tasks; escalates: finance/payroll deletes, CA, raises, quote approvals, anything money-moving.
2. For "escalate" types, secretary sees a "Request President approval" button that pings the president (Notifs.send with dedupKey) and stamps `escalatedBy/At` on the request.
3. Rules already permit the minor set (Phase 25 ruling enforced server-side); the map is UX truth, rules are enforcement truth — add a parity comment linking both files.
**Verify:** secretary session: can approve a leave, cannot see an approve button on a finance delete, escalation notifies the president once.
**Depends:** Phases 25, 35, 59.

### Phase 61 — Per-department SOP panels
**Goal:** Every department states its workflow in-app (ROADMAP NEXT-UP 5).
**Files:** each dept-*/feat-* file; data/help-content.js.
**Instructions:**
1. Write/port a short SOP per department (Finance, Sales, Design, IT, Production, Purchasing, Gov Biddings, Marketing, BS/Partners, HR) into data/help-content.js — source from the existing sops collection + DEFAULT_SOPS + the fable-workplan briefs.
2. Mount `sopPanel(deptKey)` at the top of each department screen (collapsed by default, "How this works" affordance).
3. Keep the Firestore sops collection as the president-editable override layer: panel renders override if present, else the shipped default.
**Verify:** each department shows its panel; president edit round-trips.
**Depends:** Phase 48 (or apply to current files — independent of the split).

### Phase 62 — Service-worker update UX
**Goal:** No more silent mid-session code swaps (H14).
**Files:** sw.js, js/core-boot.js.
**Instructions:**
1. sw.js: remove the unconditional `skipWaiting()` from install; instead listen for a `{type:'SKIP_WAITING'}` message.
2. core-boot: on `registration.updatefound` → new worker `installed` with an existing controller → show a persistent toast "Update ready — Reload" (Notifs.showToast with action); on click, post SKIP_WAITING, then on `controllerchange` do `location.reload()`.
3. Keep `clients.claim()` on activate (first-install path unaffected).
4. Auto-apply exception: if the tab is idle at the login screen, apply silently (no user disruption).
**Verify:** deploy a trivial change; open tab shows the toast instead of silently swapping; reload lands on the new CACHE_VER.
**Depends:** Phase 6 (version scheme), Phase 41.

### Phase 63 — Chat correctness & render efficiency
**Goal:** Sends never lose data; the thread stops re-rendering the world (H9, chat perf 1-3).
**Files:** js/chat.js (or feat-chat).
**Instructions:**
1. Composer: shared `isSending` guard checked by BOTH the click and Enter handlers; wrap doSend in try/catch/finally — on failure: re-enable button, toast the error, PRESERVE input.value/pendingFile/pendingLink; clear only on confirmed success (fixes duplicate-Enter + silent-loss together).
2. Keyed thread render: give each message node `data-mid`; on snapshot, patch only added/changed/removed mids instead of the full innerHTML replace (804-859) — preserves open reaction pickers/timestamps and cuts render cost.
3. Cap `_earlier` at ~6 pages (300 messages) with a "jump to latest" affordance; document the window.
4. Typing hygiene: also delete own typing doc on visibilitychange→hidden and pagehide; accept residual orphans (display-filtered) — optionally a weekly cleanup in the digest script.
5. Inbox cascade: debounce the refresh cascade (dept channels + readers + presence) to one run per 2s burst.
**Verify:** airplane-mode send fails loudly with text intact; double-Enter sends once; reacting from another account no longer closes an open picker.
**Depends:** Phase 24 (inline-onclick fix rides with this if not already done).

### Phase 64 — One edge-swipe owner
**Goal:** The two racing left-edge gestures become one dispatcher (M9).
**Files:** js/gestures.js, js/core-nav.js (sidebar swipe at old app.js 1160-1182).
**Instructions:**
1. Delete initSidebarSwipe from core-nav; extend gestures.js's edge handler to decide per-state: overlay stack non-empty → back (dismissTop); at a root page with sidebar closed → open sidebar; otherwise → history back.
2. Expose the root-page/sidebar state via a small query hook (window.Gestures.setContext or read window.Overlay + a callback core-nav registers).
3. Keep the sheet-dismiss gesture as is.
4. Test matrix: phone-width — swipe on dashboard (opens sidebar), swipe with modal open (closes modal), swipe deep in a dept page (goes back).
**Verify:** no double-actions on a single swipe anywhere in the matrix.
**Depends:** Phase 41.

### Phase 65 — Lifecycle hygiene: timers, listeners, icon scans
**Goal:** Nothing stale fires after signout; no whole-document icon rescans (app.js §3/§6 leftovers).
**Files:** js/core-boot.js, js/feat-*.js.
**Instructions:**
1. Central `Session.addCleanup(fn)` registry in core-boot; signout runs all cleanups (clears reminder setTimeouts at old 105/3531ff, presence/claims listeners, chat teardown) — audit every setInterval/setTimeout attached to session state (`grep -n "setTimeout\|setInterval" js/`) and register each.
2. Fix the unscoped `lucide.createIcons()` at old app.js 5697 → scoped `{nodes:[container]}`; move the per-change icon scan at 1782 out of the change handler (icons render once at mount).
3. Add the Phase-50 guard re-run on claims change (if not already landed).
**Verify:** sign out → sign in as another role within 3s: no stale toast/reminder from the previous session; Company→The System tab no longer rescans the document (perf profile).
**Depends:** Phases 41–44.

### Phase 66 — Notifications inbox v2
**Goal:** Unread never silently exceeds the window; broadcasts are deduped (M11).
**Files:** js/notifications.js.
**Instructions:**
1. Listener strategy: keep the 30-item live window BUT badge from a separate `where('read','==',false)` count query (aggregation count() if available on the SDK version; else a capped-500 count read) so unread >30 still shows correctly; "See all" paginates older items with startAfter.
2. Default dedupKeys on sendToDept/sendToAll/sendToOwner (Phase 30's work — verify landed; extend to per-recipient exists-check batching).
3. Mark-all-read batches in 499-doc chunks (verify existing implementation handles >499).
**Verify:** seed 40 unread → badge shows 40; re-firing the same digest doesn't duplicate.
**Depends:** Phase 30.

---

## STAGE 7 — Feature completion (Phases 67–78)

### Phase 67 — Scheduled reminders go server-side
**Goal:** Reminders fire whether or not a tab is open (H11 — highest-value platform fix).
**Files:** functions/index.js, js/notifications.js.
**Instructions:**
1. New scheduled function (v1 `functions.pubsub.schedule('30 7 * * 1-6').timeZone('Asia/Manila')`, region asia-east1): attendance reminder — query users without a today attendance record, write notification docs (the push relay does the rest).
2. Second schedule (daily 08:30 Manila): task deadlines (due today/overdue, per assignee), low-stock digest, AEC follow-ups — port the query logic from notifications.js checkDeadlines/checkLowStock/checkAECFollowups; reuse each check's existing dedupKey so client and server never double-send.
3. Keep the client-side checks for one release as belt-and-braces (dedupKeys make them no-ops when the server won), then remove.
4. `cd functions && npm run deploy`; confirm Cloud Scheduler jobs created; monitor first firings in logs.
**Verify:** with zero tabs open at 07:30 Manila, a test user receives the attendance push.
**Depends:** Phase 1.

### Phase 68 — Server-side approval execution
**Goal:** Approved money requests are applied from authoritative data, not request-doc fields (H3 completion).
**Files:** functions/index.js, js/svc-approvals.js, firestore.rules.
**Instructions:**
1. Firestore trigger on approval_requests update to status=='approved' for type=='ca_deduct': re-derive the deduction from cash_advances.balance (authoritative), write the applied outcome + `appliedBy:'server'`, reject-with-note if the request amount exceeds balance.
2. Client-side CashAdvance.planFor consumes only server-applied outcomes.
3. Add a callable `sendNotificationQuota` wrapper OR a per-sender counter doc enforced in the trigger for notification spam (Phase 30's server half) — implement whichever is cheaper; document quotas.
4. Deploy functions + any rules tweaks.
**Verify:** an approved over-balance request is auto-rejected with a note; normal one applies exactly the balance-derived amount.
**Depends:** Phases 21, 67.

### Phase 69 — Leave policy decision + accrual go-live 🔴
**Goal:** Leave grants match PH law and Neil's policy; the accrual runs (blocked decision).
**Files:** js/config.js (LEAVE_POLICY), js/svc-leave.js, functions (optional schedule).
**Instructions:**
1. Present Neil the WS25 decision set: grants ({vacation:5,sick:5} placeholder vs PH Labor Code 5-day combined SIL floor), probation proration, carry-over/commutation at rollover. Record answers in this file's Part F register.
2. Implement the ruled policy in LEAVE_POLICY + LeaveAccrual; update the leave UI copy.
3. Run "↻ Run Annual Accrual" (president) — first live run; verify leave_balances via spot checks.
4. Optional: move annual accrual to a scheduled function (Jan 1 Manila) with the same idempotent doc-id scheme.
**Verify:** balances match the ruled policy for a probationary, a regular, and a tenured test employee.
**Depends:** Phase 9 (item 7 deliberately skipped there), Phase 25.

### Phase 70 — Statutory tables verification workflow 🔴
**Goal:** Real 2026 SSS/PhilHealth/Pag-IBIG/TRAIN numbers, accountant-signed (M10).
**Files:** js/statutory-tables.js, js/bir.js.
**Instructions:**
1. Package the current placeholder table + official 2026 sources checklist for Neil's accountant; receive verified brackets.
2. Enter the verified numbers; set `verified: true`, `verifiedBy/verifiedAt` fields; keep the unverified-banner machinery for future years (a new year without a verified table re-banners automatically — verify that logic).
3. Recompute a test payslip against the accountant's manual computation — must match to the centavo.
4. The DRAFT watermark on 1601-C/2316/alphalist lifts automatically (bir.js gates on the flag — confirm).
**Verify:** worksheet outputs match accountant's samples; banners gone; DRAFT watermarks gone.
**Depends:** Phase 9.

### Phase 71 — Employee statutory-ID capture
**Goal:** TIN/SSS/PhilHealth/Pag-IBIG exist for regular employees (WS39's data gap).
**Files:** js/feat-hr.js, js/feat-profile.js, firestore.rules, js/bir.js.
**Instructions:**
1. Add the four ID fields to the HR employee editor and (read-only) to My Profile; store on `payroll/{uid}` (pay-adjacent, already finance-gated) — NOT on users (public-read to authed).
2. Rules: payroll match already moneyAdmin-write/owner-read — no change needed; verify.
3. bir.js alphalist/2316: read from payroll docs; the TIN-completeness banner now reflects reality.
4. HR runs a collection drive; track completeness on the HR screen (X of Y captured).
**Verify:** alphalist shows real TINs for captured employees; non-finance roles can't read others' IDs.
**Depends:** Phase 70.

### Phase 72 — Weekly production pay from kiosk hours 🔴
**Goal:** Production weekly pay computes from recorded hours instead of hand-entry (ROADMAP NEXT-UP 3 remainder).
**Files:** js/feat-payroll-ui.js, js/payroll-engine.js.
**Instructions:**
1. Decision to Neil first: make `hoursWorked` authoritative for weekly workers (currently informational; attendanceScore stays canonical for monthly staff) — per the WS26 note this was deliberately deferred.
2. On approval: payslip generator's "⟳ Load from kiosk" becomes the default compute — weekly gross = Σ(hoursWorked capped at 8/day + approved OT) × hourlyRate (fixed-weekly ÷ 48 or the ruled divisor); manual override stays with an audit note.
3. Employer-share statutory columns stay manual until Phase 70's verified tables cover weekly (departments.js:6500 note).
4. Parallel-run one payweek: hand-entered vs computed; reconcile before switching defaults.
**Verify:** parallel week matches or differences are explained and accepted.
**Depends:** Phases 36, 70.

### Phase 73 — HR depth: 201 files, onboarding, review cycle
**Goal:** The HR pillar from the never-covered backlog (ROADMAP item 8).
**Files:** js/feat-hr.js, firestore.rules, storage.rules.
**Instructions:**
1. 201 file: per-employee document folder (contracts, IDs, clearances) — reuse hub_files with a `hr201:{uid}` scope, visibility locked to financeOrAdmin + the employee (read-only); storage path `hr201/{uid}/` with claims-gated rules.
2. Onboarding checklist: template doc (accounts, IDs, orientation steps) instantiated per new hire; surfaces on the HR screen until complete.
3. Performance review cycle: a `reviews` collection (period, self-assessment ref, president grade, notes) knitting the existing kpi_evals into a scheduled cycle with status chips; reminder via the Phase-67 scheduler.
4. Rules for the new collection + backup-coverage registration + indexes as needed.
**Verify:** a test hire walks the checklist; a review round-trips self-assessment → grade.
**Depends:** Phases 67, 46.

### Phase 74 — Quote acceptance → job costing integration
**Goal:** Accepted quotes auto-create job_costs without breaking the permission model (ROADMAP item 4 — design constraint documented there).
**Files:** functions/index.js, firestore.rules, js/dept-sales.js.
**Instructions:**
1. Implement server-side (the ROADMAP's own recommended clean path): Firestore trigger on bk_quotes/bs_quotes status → accepted/won creates `job_costs/{quoteId}` with `merge:true` (idempotent, preserves finance-entered costs) — no client read friction, job_costs stays finance-read-only.
2. Seed the doc with quote line-item costs where capital fields exist; flag `needsCosting: true` otherwise.
3. Finance screen: "needs costing" chip on the job-costs list.
4. Deploy functions; test acceptance from both quote flows.
**Verify:** accepting a quote yields exactly one job_costs doc; re-accepting doesn't clobber finance edits.
**Depends:** Phase 67 (functions patterns), Phase 48.

### Phase 75 — Inventory upgrade
**Goal:** Valuation, movement history, categories, reorder flow (ROADMAP NEXT-UP 6).
**Files:** js/feat-inventory.js, js/dept-purchasing.js, firestore.indexes.json.
**Instructions:**
1. Valuation header: Σ qty×unitCost overall + per category; category field + chip filters on the stock list.
2. Movements: per-item drill-down timeline from stock_movements (already written by Production/Purchasing — this is the read UI); index (itemId, ts) if needed.
3. Reorder: reorderPoint per item; below-point rows badge + one-click "Add to RFQ" (the Purchasing "From low stock" path already exists — link it).
4. In/out clarity: movement rows show source (PO receive, production consume, count correction, manual).
5. Consider the Production-role question (ROADMAP 18) — present to Neil; implement `isProductionDept()`-scoped write rules if ruled (rules currently any-non-partner).
**Verify:** valuation matches a hand-computed sample; movement history reconciles qty.
**Depends:** Phase 49.

### Phase 76 — Government Biddings depth
**Goal:** PhilGEPS import, per-bid checklist, deadline reminders (ROADMAP item 9 remainder).
**Files:** js/feat-company.js (gov module), functions (reminders), firestore.rules.
**Instructions:**
1. Structured entry: parse-paste helper for PhilGEPS reference format (ref no, title, agency, budget, closing date) into gov_philgeps docs.
2. Per-bid checklist: standard document list (PhilGEPS cert, mayor's permit, ITR, financial docs...) as a sub-map with checkboxes + file links (hub_files refs).
3. Deadline reminders: fold closing-date reminders into the Phase-67 daily scheduler (7/3/1 days out, dept-targeted).
**Verify:** a pasted PhilGEPS block populates a bid; checklist persists; reminder fires on schedule.
**Depends:** Phase 67.

### Phase 77 — CRM timeline & win-rate wiring
**Goal:** The per-client history view + stage-aware analytics (ROADMAP item 7 remainder).
**Files:** js/feat-crm.js, js/feat-analytics.js.
**Instructions:**
1. Client hub timeline: Clients.timelineFor already joins quotes/orders/projects/payments (departments.js 193-313) — surface it as the hub's default tab with type icons + money summary line.
2. Analytics: roll CRM stage into the sales win-rate (stage-weighted pipeline value; won/lost conversion by source via LEAD_SOURCES).
3. Follow-up overdue nudges already exist — link them to the timeline entries.
**Verify:** a client with history shows a complete, ordered timeline; win-rate matches hand-count on test data.
**Depends:** Phases 44, 47.

### Phase 78 — Field ops: delivery photos + GPS attendance
**Goal:** The last never-covered backlog pillar (ROADMAP item 15), scoped MVP.
**Files:** js/feat-attendance.js, js/dept-production.js (delivery), storage.rules.
**Instructions:**
1. Delivery/site photo capture: camera-input on delivery receipts + site visits → Storage `field-ops/{yyyymm}/`, linked from the DR doc; claims-gated storage rule.
2. GPS-stamped attendance (Neil decision on privacy first): capture geolocation at time-in/out where permitted, store lat/lng+accuracy on the attendance record; admin view shows a "far from site" flag against configured site coordinates; NO hard blocking (advisory anti-spoof only, per WS26's deferred-geofence decision).
3. Graceful denial: no location permission → record marked "no GPS", never blocks time-in.
**Verify:** DR carries its photo; time-in from far away flags but succeeds.
**Depends:** Phases 49, 23.

---

## STAGE 8 — Accounting depth (Phases 79–86)

### Phase 79 — Payslip legal identity + 13th-month fix 🔴
**Goal:** Documents carry the right entity and the right accrual math (M10, C4-adjacent BIR findings).
**Files:** js/bir.js, js/config.js, js/feat-payroll-ui.js.
**Instructions:**
1. Neil decisions (Part F register): payslip legal entity (DTI trade name vs OPC) — implement the ruling in toPayslipModel/brandEntity mapping; obtain and set the OPC TIN (config.js:1277 `opcTin:''`).
2. 13th-month accrual (bir.js:610): replace `baseSum/12` with months-actually-worked math — accrual = Σ(monthly basic earned in the calendar year)/12 counting only months with salary_history rows; banner the figure as accrual-estimate until year-end.
3. Add the same accrual line to the payslip generator's additionals when December runs.
**Verify:** a mid-year hire's 13th-month accrual matches hand computation; payslips show the ruled entity + TIN.
**Depends:** Phases 70, 46.

### Phase 80 — Chart of accounts maturation + balance sheet
**Goal:** From category P&L to a real BS (ROADMAP item 6, WS13 foundation).
**Files:** js/feat-finance.js, js/config.js (COA).
**Instructions:**
1. Extend COA with balance-sheet accounts (cash/bank per bank_accounts, AR from job_projects.arBalance, inventory asset from WS13's restatement, CA receivable from cash_advances balances, liabilities: statutory payable legs from payroll disburse, SSS/PH/PI/BIR payable, equity: retained).
2. Balance-sheet report: as-of-date snapshot assembling ledger balances by accountType + the live subledgers (AR/inventory/CA) with a reconciliation footnote where ledger and subledger disagree (they should match post-Stage-1 — surfacing drift is the feature).
3. Print via .print-target; CSV export.
**Verify:** Assets = Liabilities + Equity on test data; drift report empty after Stage-1 fixes.
**Depends:** Phases 13-14, 45.

### Phase 81 — Cash flow statement + bank reconciliation
**Goal:** The remaining core statements (ROADMAP item 6).
**Files:** js/feat-finance.js.
**Instructions:**
1. Cash flow (direct method): period cash in/out from ledger rows carrying bankAccountId, bucketed operating/investing/financing via accountType mapping; ties to bank-account drilldown totals.
2. Bank reconciliation: per bank account + month — app-side ledger lines vs a pasted/CSV-imported bank statement; match on amount+date window; unmatched lines listed both directions; save a `bank_recons/{account}_{month}` doc with cleared refs. New collection: rules (canFinance) + backup registration.
3. Reconciled months badge on the bank screen.
**Verify:** a seeded statement reconciles to zero unmatched on test data.
**Depends:** Phase 80.

### Phase 82 — BIR filing finalization 🔴
**Goal:** The BIR suite produces filing-ready output (WS39 flags).
**Files:** js/bir.js, js/config.js (BIRCONFIG).
**Instructions:**
1. Neil/accountant decisions (Part F): VAT registration status (if non-VAT → build the 2551Q percentage-tax screen and hide 2550); OR/SI ATP series details (permit no., prefix, range, pad) → enable minting; prior-period creditable input VAT opening figure.
2. Implement the ruled branches; keep DRAFT watermarks tied to statutory `verified` + these config gates.
3. Reconciliation note at bir.js:517-519 (financeDeleteCascade aggregate gap): after Stage 1's deterministic refs, rebuild the 1601-C aggregate from per-employee rows (authoritative) instead of ledger legs, or fix the cascade to reverse aggregate legs — pick per accountant preference.
**Verify:** accountant signs off a sample 2550/2551 + 1601-C month against manual computation.
**Depends:** Phases 70, 79.

### Phase 83 — Expense single-source audit + restatement verification 🔴
**Goal:** The June-audit finance items are provably closed (memory: finance-reporting-open-items).
**Files:** js/feat-finance.js (report), migrations.js (verifier).
**Instructions:**
1. Build a one-shot verifier (president Maintenance page): (a) every expenses doc with status approved has exactly one EXP- ledger row; (b) no ledger expense row lacks a source doc; (c) WS13 restatement applied — purchase-tagged rows carry accountType Inventory-asset, consumption rows COS; report counts + drill-down list.
2. Run it; fix stragglers via financeDelete/manual entries (never auto-mutate).
3. VAT: verify all 5 expense-write paths net input VAT consistently (WS39 found 2 of 5 did) — the Stage-1 Ledger service centralizes this; the verifier asserts no gross-VAT expense rows remain post-cutover.
4. Confirm the two project collections stay unified through Projects.normalize (Phase 48's svc-projects) — verifier asserts zero un-normalized docs.
**Verify:** verifier reports zero exceptions; archive the report in ROADMAP session log.
**Depends:** Phases 9, 13-14.

### Phase 84 — Period-close hardening (rules side)
**Goal:** A closed month rejects writes at the RULES layer for every money collection (C6's server half).
**Files:** firestore.rules.
**Instructions:**
1. Generalize the ledger's `ledgerPeriodOpen()` helper (976-987) and apply it to create/update on: cash_receipt_journal, cash_disbursement_journal, general_journal, expenses (approval transition), payslips (submit transition) — matching each doc's date field.
2. Ensure finance_periods reads inside rules stay null-safe (`.get('closed', false)`) — a month with no period doc is OPEN.
3. Deploy; test: closed month rejects a CRJ write from devtools even though the UI also blocks it.
**Verify:** client + rules both reject; open months unaffected.
**Depends:** Phase 13.

### Phase 85 — finance_rollup aggregates + ledger pagination
**Goal:** Dashboards stop scanning the whole ledger (M6 finance part; WS16's deferred rollup).
**Files:** js/svc (new svc-rollup or inside finance-ledger.js), js/feat-finance.js, js/feat-dashboards.js.
**Instructions:**
1. `finance_rollup/{yyyymm}` doc: income/expense/vat/cos totals per month, maintained transactionally by Ledger.post (increment on write — same transaction) + a rebuild-from-ledger tool (migrations) for drift repair.
2. Finance Overview + president dashboard KPIs read rollups (period picker unchanged for detail views).
3. Ledger tab pagination: startAfter cursor (100/page) both directions; Bank drilldown keeps 'all' scan but notes the ceiling.
4. Rules for finance_rollup (canFinance read; write via the same canFinance gate the ledger uses — the client maintains it inside the Ledger transaction).
**Verify:** rollup equals a fresh full-scan computation (rebuild tool proves it); Overview loads with O(months) reads.
**Depends:** Phases 12-13, 45.

### Phase 86 — Analytics query bounding
**Goal:** The BI tab's cost stops growing without bound (M6).
**Files:** js/feat-analytics.js, firestore.indexes.json.
**Instructions:**
1. Add a period scope (this month / quarter / YTD / all) defaulting to YTD; bound every one of the 13 reads by the period's date field (tasks by createdAt, expenses by date, payslips by payPeriodStart, etc.); add composite indexes where where+orderBy demands, deploy indexes.
2. Lazy-load per subtab: fetch only the collections the visible subtab needs (overview needs ~5, not 13).
3. Keep the 60s cg() cache; key it by period.
**Verify:** cold Analytics load fetches only visible-tab collections (network tab); YTD numbers match previous full-scan values for the same window.
**Depends:** Phase 44.

---

## STAGE 9 — Performance, durability, QA, docs, launch (Phases 87–100)

### Phase 87 — Read-pattern sweep
**Goal:** No unbounded or uncached hot-path reads remain (M6).
**Files:** feature files, firestore.indexes.json.
**Instructions:**
1. Convert client-side stage filters to server-side wheres: purchase_requisitions rfq/pr (14571, 14832 → where('stage','==',…)), BS tabs' triple bs_quotes fetch → one cached read shared by the three tabs, production orders board → where + dbCachedGet.
2. Route the 8 bare `users` reads through one cached directory accessor (Phase 32's helper + dbCachedGet('users')).
3. Personal-Finance N+1: batch getAttendanceScore via one range query per month over attendance collectionGroup (index: collectionGroup records by docId range) or accept per-user parallel reads with a cache — measure first, fix if > 1s at current roster.
4. Memoize getPHHolidays per year (module-level map).
**Verify:** page-load read counts drop (log via a dev counter); no behavior change.
**Depends:** Stage 4 complete.

### Phase 88 — db-cache v2
**Goal:** Cache policy is declared once, invalidation can't drift (platform §2).
**Files:** js/data/db-cache.js (from config.js's dbCachedGet), all callers.
**Instructions:**
1. Central registry: `{collection: {ttl, keys:[patterns], invalidatedBy:[collections]}}` — TTLs stop being per-call-site literals; dbCacheInvalidate derives affected keys from the registry (replaces the hand-maintained _alias map at config.js:463-471).
2. Keep the 'users' fetcher-override guard but make it explicit API (`dbCachedGet.users()`).
3. Add a dev assertion: dbCachedGet with an unregistered key logs a warning (registry completeness).
4. Migrate call sites mechanically (same keys, TTLs from registry).
**Verify:** expense approve → overview refresh (regression of H6 fix still green); warning log empty in a full click-through.
**Depends:** Phase 87.

### Phase 89 — Backup v2: snapshot semantics + coverage automation
**Goal:** Restore reflects current state for every collection (H12, automation recs).
**Files:** scripts/monthly-backup.js, scripts/check-backup-coverage.js, DRIVE_SYNC_SETUP.md.
**Instructions:**
1. Switch tasks/cash_advances/salary_history/posts/attendance_extensions/suggestions from creation-month filters to full snapshots (matching everything else); keep the date-filtered CSVs as ADDITIONAL month-report files where useful, clearly named `*_created_{month}.csv`.
2. Size guard: log per-collection export sizes in _summary.txt; alert (system_health) when any exceeds a threshold — revisit windowed snapshots only when a real size problem appears, with restore semantics documented.
3. _summary.txt documents semantics per file (full vs month-created vs subcollection).
4. Coverage linter (Phase 7) extended to subcollections (KNOWN_SUBCOLLECTIONS vs chained `.collection(` grep).
**Verify:** dispatch run: a task closed last month appears with current status in this month's export.
**Depends:** Phases 2-4, 7.

### Phase 90 — Observability & alerting
**Goal:** Silent failures become visible in-app (automation rec 7, error-log follow-through).
**Files:** js/feat-dashboards.js (health panel), functions/index.js, scripts/*.
**Instructions:**
1. System-health panel (president + finance): daily_sync + monthly_backup heartbeats with staleness thresholds (36h/40d), last digest run, error_log 7-day sparkline, Cloud Function error note (manual check link to console).
2. Workflows write failure heartbeats too (on job failure step, `if: failure()` writes system_health with status:'error') — currently only success paths write.
3. Function-side: wrap scheduled functions in try/catch that writes system_health docs.
**Verify:** force a workflow failure on a branch → banner appears for president.
**Depends:** Phases 8, 67.

### Phase 91 — Device/perf verification pass
**Goal:** The remodel measurably improved, not regressed, real-device performance.
**Files:** none (measurement + targeted fixes).
**Instructions:**
1. Baseline vs v12: cold boot, dashboard TTI, Finance tab, Analytics YTD, chat thread — on a mid-range Android (staff-typical), tablet, desktop; all three themes.
2. Lighthouse + Performance traces; fix the top regressions only (no scope creep); confirm content-visibility rows and the Phase-57 animation work show up in traces.
3. Verify PRECACHE size didn't balloon (~35 modules — consider HTTP/2 fine, but check SW install time on the test device).
4. Record results in QA-CHECKLIST.md.
**Verify:** boot + nav at parity or better vs v12 baseline on the Android device.
**Depends:** Stages 4-5 complete.

### Phase 92 — Rules file conventions + wildcard retirement
**Goal:** The rules file is maintainable at its new size (rules recs 1-4).
**Files:** firestore.rules.
**Instructions:**
1. Extract shared validators: isNonNegNumber(v), isBoundedString(v,max), plus named validXxxCreate/Update helpers for the >3-field collections (campaigns, bank_accounts, purchase_requisitions, leave_*, notifications, approval_requests).
2. Section-header + rationale comment per match block (95% done — finish); add the PR-checklist note to ARCHITECTURE.md.
3. files_.* wildcard (1403-1415): confirm zero live writes to files_<scope> (grep + a week of error_log watch), then delete the wildcard; legacy collections stay readable via an explicit archived-collections match if still linked anywhere, else drop.
4. Deploy + role-spread smoke test.
**Verify:** rules compile; brace-balance check; no blank screens.
**Depends:** Phases 21-25, 49.

### Phase 93 — Docs rewrite
**Goal:** Every doc tells the truth about v13 (M13).
**Files:** CLAUDE.md, ARCHITECTURE.md, Employee_Guide.md, Partner_Guide.md, ROADMAP.md, DRIVE_SYNC_SETUP.md.
**Instructions:**
1. CLAUDE.md: new module layout, load-order note (modules resolve imports; only SDK tags are ordered), updated commands, the .githooks setup line, updated conventions (Ledger service, Approvals service, pricing engine, print-docs, chipTabs-only).
2. Employee_Guide v2: current attendance (time-in/out, kiosk, extensions, leave), pay (Compute→Verify→Disburse cadence, payslips, CA), chat/files/IDs/posts — screenshots optional, accuracy mandatory.
3. Partner_Guide v2: Quick Quote, quote lifecycle + approvals, files hub, order tracking links.
4. ROADMAP.md: mark the v13 program; prune superseded NOT-YET-DONE items (each now has a phase); keep the session-log convention.
5. Delete/stub the Phase-5 leftovers if any remain.
**Verify:** a new employee can follow the guide end-to-end without hitting a stale instruction.
**Depends:** Stage 4+ complete (write once the architecture settles).

### Phase 94 — Index & rules-artifact reconciliation
**Goal:** Deployed artifacts match the repo exactly; orphans resolved (rules §2/§5).
**Files:** firestore.indexes.json, firestore.rules.
**Instructions:**
1. Resolve ledger_entries: check the worktree branch (.claude/worktrees/wf_783ec1d0*) — merge or abandon with Neil; delete the rule if abandoned.
2. Drop the unused hub_folders(scope,department) index, or add the department-scoped folder query it anticipated (Files Hub dept view) — pick with Neil; default drop.
3. `firebase firestore:indexes` diff against the file; reconcile any console-created strays into the repo.
4. Add composite indexes accumulated by Stage 7-8 phases if any were console-hotfixed.
**Verify:** console indexes == repo file; rules contain no dead matches.
**Depends:** Phases 86-87.

### Phase 95 — Products data pipeline
**Goal:** The static fallback can never silently diverge again (standalone-tools recs).
**Files:** new scripts/export-products.js, .github/workflows (extend sync), products-database.json, quote-builder-v2.html.
**Instructions:**
1. export-products.js: regenerate products-database.json from the Firestore products collection (including capital fields, correct categories); run inside the nightly sync workflow; commit-if-changed (the keepalive pattern) or upload to Drive — prefer repo commit so the fallback ships.
2. Refresh getEmbeddedDB() (QB 2979-3015) from the same export at build of that file — or reduce it to a "builder unavailable offline" notice (prefer the notice; the 12-product embedded set misleads).
3. Fallback banner: when the QB runs on JSON/embedded fallback, show "offline catalog — prices may be stale; internal costs unavailable" and hide the margin panel (fixes the ₱0-cost/100%-margin illusion).
**Verify:** nightly run refreshes the JSON; fallback mode banners and hides margins.
**Depends:** Phases 19, 38.

### Phase 96 — Full-role regression QA
**Goal:** Every role, theme, and tier passes the complete checklist before cut.
**Files:** QA-CHECKLIST.md (results).
**Instructions:**
1. Execute the full Phase-10 checklist (grown by each stage's additions) across all 7 roles × 3 themes × 3 tiers; log every failure as a fix-before-cut item.
2. Money-invariant drill on a staging month: full payroll cycle, CA lifecycle, quote→order→production→COS→billing→payment chain, period close/reopen.
3. Restore-from-backup spot drill (Phase 4 runbook) — quarterly cadence starts here.
**Verify:** zero open P0/P1 items.
**Depends:** everything through Phase 95.

### Phase 97 — Security re-verification
**Goal:** Every Stage-2 closure is independently re-tested (findings register sign-off).
**Files:** none (test pass + fixes).
**Instructions:**
1. Re-run each C/H security probe from Part B as written: XSS payloads (quote items, titles, chat), forged approval_requests, direct posts publish, hearts forgery, Storage cross-user delete, partner Internal-tab access, plaintext-password absence, notifications spam throttle, CSP/SRI active.
2. Devtools-level rules probing per role (the register's attack lines, not just UI paths).
3. Document results in a dated SECURITY-VERIFICATION.md section; fix + re-test any survivor.
**Verify:** all register items marked CLOSED with evidence.
**Depends:** Stage 2 + Phase 92.

### Phase 98 — Pending-decision register clearance 🔴
**Goal:** Every FLAG-FOR-NEIL that gates v13 is decided and implemented (Part F).
**Files:** V13-PLAN.md Part F, various.
**Instructions:**
1. Walk Part F's decision register with Neil in one session; record each ruling inline.
2. Implement the quick ones immediately (payPolicy stance, CA interest default, marketing landing tab, WS41 icon set, dashboard ID-card dedupe, Recycle-Bin purge policy, Files-Hub Drive-mirror delete behavior).
3. Defer-with-date anything Neil parks; nothing stays undated.
**Verify:** register shows a ruling or a dated deferral for every row.
**Depends:** ongoing; final sweep here.

### Phase 99 — v13.0.0 cut 🔴
**Goal:** Ship it.
**Files:** js/config.js (version — via hook), all.
**Instructions:**
1. Freeze: no non-fix commits after Phase 96 signs off.
2. Stamp v13.0.0 (hand-set the minor/major once, then let the hook resume patch bumps — mirror the v12 stamping procedure).
3. Neil approves: `git push origin master`; deploy rules/indexes/storage/functions in order; backfillUserClaims; run the two idempotent buttons; 60s propagation wait; production smoke test (QA short list) on the live domain.
4. Announce to staff (post + notification) with the Employee_Guide v2 link; brief the partner(s) on Partner_Guide v2.
5. Tag the commit `v13.0.0`; ROADMAP session-log entry.
**Verify:** live app reports v13.0.0; error_log quiet for 24h.
**Depends:** Phases 96-98.

### Phase 100 — Post-launch watch + v14 seed
**Goal:** A stable week, then the next horizon.
**Files:** ROADMAP.md.
**Instructions:**
1. Daily for 7 days: error_log review, system_health checks, Function logs, user reports channel; hotfix protocol = fix → node --check → push (hook bumps) → verify.
2. Confirm the first scheduled-function firings (attendance reminder, digest) and the first nightly product export.
3. Write the v14 seed list into ROADMAP.md from what v13 deliberately parked: notification fan-out quotas server-wide, chat message search, per-conversation retention, Blaze-tier PITR export decision, PhilGEPS API integration (vs paste-parse), performance pagination at data scale, any Part-F dated deferrals.
4. Run /memory consolidation for the assistant-side project memory (payroll bug closed, new architecture layout, v13 conventions).
**Verify:** week closes with zero unresolved P1s; v14 seed list exists.
**Depends:** Phase 99.

---

# PART F — Execution ground rules

## F1. Invariants v13 must never break (from the docs-mining sweep — enforce in every phase review)
- Money moves ONLY at payroll Disburse; `pay_runs` immutable at `disbursed`; president-only transition.
- `CashAdvance` is the sole mutator of cash_advances/worker_profiles.caBalance.
- Finance deletes route through financeDelete → President approval — never direct.
- Attendance self-write score capped {0, 0.5, 1.0}; can never overwrite an admin-edited day (computePayRun reads it directly).
- Ledger refs deterministic + idempotent (SO-/PROJ-/DPROJ-/EXP-/CRJ-/CDJ-/POCOS-/PAY-/WPAY-) with transactional existence checks (Stage 1 upgrades this from "checked" to "guaranteed").
- Period close gates every ledger writer client-side AND rules-side.
- Statutory tables untrusted until `verified: true`.
- Every new collection: explicit rules match + backup decision + (if queried compound) index — the coverage linter enforces the first two.
- Storage rules = custom claims only; backfillUserClaims after functions/storage deploys.
- Manila time via bizDate/bizHour/bizDow; escHtml on all user content; NO pop-ups (confirmDialog/promptDialog/openPage only).
- Drive is a private backup mirror — the app never serves Drive URLs.
- order_tracking/{token} and id_verify/{token} stay get-only, list:false, unguessable.
- Node 20 for all Drive-touching automation. CACHE_VER/APP_VERSION are hook-managed.

## F2. Decision register (owner rulings needed — phases reference these)
| # | Decision | Gates phase | Default recommendation |
|---|---|---|---|
| D1 | LEAVE_POLICY grants/probation/carry-over (PH SIL 5-day floor vs current placeholder) | 69 | Adopt statutory floor + explicit company top-up |
| D2 | Statutory tables accountant verification | 70 | Schedule with accountant now — longest lead time |
| D3 | Weekly production pay: hoursWorked becomes authoritative? | 72 | Yes, with one parallel-run week |
| D4 | Commission basis: VAT-inclusive grand vs ex-VAT net | 19 | Ex-VAT net (commission shouldn't ride on tax) |
| D5 | per_length D/H rate activation date (prices rise) | 19 | Next quote-book cycle, with old-vs-new log |
| D6 | Payslip legal entity + OPC TIN | 79 | Accountant call |
| D7 | VAT registration status (2550 vs 2551Q) | 82 | Accountant call |
| D8 | OR/SI ATP series details | 82 | Enter when permit at hand; minting stays off |
| D9 | Secretary write-surface ruling (literal view-only vs minor-acts tier) | 25, 60 | Minor-acts tier (matches standing decision) |
| D10 | Secretary may approve posts? | 22 | No (match current UI) |
| D11 | CA interest default (2%/mo vs 0) + legacy mismatch cases | 18-adjacent | 0 default, explicit per-loan opt-in |
| D12 | payPolicy 'performance' activation | — (inert) | Keep 'flat' until KPI data trusted |
| D13 | Chat-files read posture (open-get + unguessable vs app-layer gating) | 24 | Keep + document; revisit if finance docs flow through chat |
| D14 | Brilliant Steel keeps internal-cost visibility? | 26 | Yes (50/50 arrangement); CO.PT generics no |
| D15 | git-history rewrite to purge PII file? | 5 | No (delete forward only), unless Neil wants the scrub |
| D16 | Recycle-bin auto-purge (30d?) + Delete-forever Drive-mirror behavior | 98 | 30-day purge; mirror deletion documented as manual |
| D17 | Production role (tighter inventory writes) | 75 | Yes — dedicated claim-backed role |
| D18 | GPS attendance privacy posture | 78 | Advisory-only flags, no blocking |
| D19 | Dashboard ID-card duplication (WS41 leftover) | 98 | Remove from dashboard, keep in My Profile |
| D20 | EMAIL_CONFIG: wire up or delete | 5 | Delete |

## F3. Suggested execution rhythm
- Stages 0–2 first, in order — they are independent of the remodel and protect live money/data now. Roughly: Stage 0 one session-week, Stage 1 one, Stage 2 one.
- Stage 3 before Stage 4 (services before splits). Stage 5 can interleave with Stage 4 (different files).
- Stages 6–8 are parallelizable per-feature once Stage 4 lands. Stage 9 is strictly last.
- Every phase = spec → implement (Sonnet subagents per the model-routing policy) → review on main session → QA slice → commit. Deploys and money-touching runs 🔴 always wait for Neil.


---

# PART G — UI/UX review (the second audit wave)

Four dedicated auditors swept the app for exactly what the owner asked: **all buttons, all displays, all linkages — unified, true, reliable — on laptop and phone.**

- **Navigation linkage:** the full route table (39 routes + 11 dept sub-routes) crossed against every nav surface per role.
- **Button↔handler wiring:** 888 literal-id interactive elements, 1,399 `getElementById` bindings, 212 inline `onclick` handlers — mechanically extracted and every candidate defect manually read in context.
- **Phone/laptop optimization:** touch targets, tables at 390 px, keyboards, safe areas, breakpoints, hover/focus/shortcuts, with per-screen verdicts on 25+ screens.
- **Display truth:** every currency/date format variant, status-badge map, empty/loading/error state, toast, and "number that lies."

**The good news first (verified strengths to preserve):** zero broken `onclick` globals out of 212; zero true duplicate-id bugs out of 15 candidates; all 65 data tables correctly scroll-wrapped for phones; blanket iOS-zoom guard catches every input; safe-area coverage is thorough; the toast-before-write discipline is clean; no screen is unusable on a phone. The problems are *unification and truth* problems, not wreckage.

## G1. UI/UX findings register

Severity: **U-C** = user-facing critical (invisible/wrong/duplicating), **U-H** = high, **U-M** = medium. Each maps to its fix phase.

| ID | Finding | Evidence | Fixed in |
|---|---|---|---|
| U-C1 | **Approvals "Pending" badges are invisible.** `badge-warn` (7 uses on the Approvals page) and `badge-amber` (2 uses) have **no CSS rule anywhere** — they render as transparent, uncolored pills exactly where status matters most. | departments.js:10649,10989,11071,11148,11197,11248,11342, 2449, 12158; styles.css has no rule | Phase 102 |
| U-C2 | **9 money-save buttons have no double-click guard at all** (no confirm, no disable): CRJ, CDJ, manual ledger, records, tax, payroll-fields, payslip-edit (which also deducts CA), president cash-advance grant, sales-order create. Double-tap = duplicate financial documents. Plus the confirmed Disburse case (C4). | departments.js:5139-5168, 5262-5292, 4804-4826, 5384-5396, 4378-4391, 4108-4136, 6189-6227, 9878-; modules.js:1694- | Phase 103 |
| U-C3 | **Two dead filter dropdowns**: Finance→Records type filter (`rec-filter`) and IT→Assets status filter (`it-asset-filter`) are rendered but bound to nothing — changing them does nothing, silently. | departments.js:5332, 9075 (only occurrences) | Phase 101 |
| U-C4 | **Back button broken on the employee dashboard's department cards** (and the Departments grid): they call `renderDeptModule()` directly, bypassing the router — no hash, no history; Back exits the page under the rendered content, refresh loses the view. | app.js:3118 (highest traffic), 6445, 3726 | Phase 104 |
| U-C5 | **Worker profile panel ignores the Back button** (full-screen overlay never registers with Overlay), and the task panel is closed via a bypass in 7 places that leaves a stale history entry — the next Back press is silently eaten. | app.js:5173-5207; departments.js:1132,1153,1163,1166,1172,1189,1281 | Phase 105 |
| U-C6 | **Seven orphan/near-orphan routes** — fully built screens with no nav path: `submissions`, `cash` (a complete Cash & Expenses screen), `my-dept`, `bk-quotations`, `dept:Partners` (unreachable even for permitted roles), `notifications` full page (desktop), `team` (buried 2 hops deep). | app.js:2092-2135 switch vs all nav surfaces | Phase 106 |
| U-C7 | **Approvals badge count disagrees with its own list**: the header total never queries `pending_raises`, but the "All Requests" list shows them. Unread notification badge counts only within a 30-item window (true 100 shows 30). | departments.js:10500-10525 vs 10583-10623; notifications.js:14-23 | Phase 118 |
| U-C8 | **Same value renders differently across screens**: 7+ peso formatters (a ₱12,345.50 quote shows ₱12,346 in Quick Estimate/print); CA "Total Payable" recomputed on the admin card vs stored value on the employee card — two figures for one document. | departments.js:10, 6905; app.js:8082, 1672, 6530; modules.js:1654, 1587 vs 1462; 20 bare `.toLocaleString()` sites | Phases 111–113, 118 |
| U-H1 | 40 of 42 `toLocaleDateString` and 30+ `toLocaleString` displays have **no Manila timezone pin** — wrong calendar day on ~40 screens for any device not set to Manila. The purpose-built fix (`fmtManila`, config.js:17-50) is used in only 3 places. | grep inventory in Part G source reports | Phase 114 |
| U-H2 | **Quote status renders green, blue, orange, amber, or gray for the same status string** depending on the screen — 5 disagreeing badge maps, one of which silently falls back to gray. | app.js:2435; departments.js:9604/9670/10408, 12155-12161, 578-581 via 7593/7730 | Phase 115 |
| U-H3 | **48% of toasts default to neutral blue** — 108 success-sounding confirmations and 11 denial messages render identically to info; two actions are entirely silent (IT Access revoke, Submission approve/reject). | notifications.js:525-571 + 486-call inventory | Phase 117 |
| U-H4 | **Role/nav mismatches**: secretary shown a Partners card that dead-ends in "Admin access only"; dept-assignment dropdowns allow assigning employees to Admin/Partners (producing broken sidebar links); Secretary's "Policies & HR Docs" button routes to a "coming soon" stub while the real feature lives elsewhere; Inventory/Sales-Orders/Projects reachable by hash with no internal gate. | departments.js:3754-3758; app.js:7250-7447, 6453, 2858, 965-967 vs 1023-1025 | Phase 107 |
| U-H5 | **Touch-target gaps**: 32px topbar avatar, `.btn-danger` excluded from the coarse-pointer rescue (delete buttons ~34px on touch tablets), raw 16px checkboxes in money screens (bank reconciliation). | styles.css:1056-1065, 388; departments.js:5039 etc. | Phase 131 |
| U-H6 | **Subtab deep-linking works on only 4 of ~15 tabbed screens** — the rest reset to the first tab on refresh/Back. | wired: departments.js:2981/3003, 6794/6816; app.js:3760/3776; modules.js:2695/2710 | Phase 193 |
| U-H7 | **No modal focus trap** (Tab walks out of open modals); **focus ring is pink in every theme** (token bug, also M5); text sizes are ~100% px (OS text-scaling has no effect — a11y gap). | styles.css greps; 1,938 px vs 2 rem | Phases 125, 138, 144 |
| U-M1 | Terminology drift: bottom-nav says "Cash" for Cash Advances — and the same route means *expense review* for finance roles; "Quotation" vs "Quote"; "Disburse" vs "Mark Paid". | config.js:362; app.js:2951-2997; departments.js:6853+ | Phase 119 |
| U-M2 | bir.js is the one file the emoji→Lucide sweep never touched (raw emoji in its buttons/headings); LUCIDE_EMOJI_MAP regressions are silent. | bir.js:84,126,163,440,628,665 | Phase 120 |
| U-M3 | Dead UI code: `theme-toggle-btn`/`toggleTheme` orphan, `bn-notif-badge`, `qb-fullscreen` shim; expense-Reject invalidates no cache (pending KPI stale 45s). | app.js:892-921; notifications.js:31; departments.js:2044-2050 | Phases 109, 118 |
| U-M4 | Laptop gaps: no max-width at ultrawide (content stretches edge-to-edge), thin keyboard-shortcut map, AEC table forces horizontal scroll on every phone (min-width:860px), PWA locked to portrait despite the tablet tier. | styles.css:1320-1324; manifest.json:9; departments.js:11812 | Phases 126, 137, 141, 145 |
| U-M5 | Empty/loading/error states are 146 hand-rolled variants with no shared component; two stuck-spinner paths confirmed; primary actions live top-right (thumb-hostile), no FAB/action-bar pattern. | inventory in display audit | Phases 121–122, 132 |

The full per-audit detail (route tables, wiring inventories, per-screen device verdicts, format-variant counts) is archived in the session scratchpad (`reports/11…14`).

---

# PART H — Phases 101–200: the UI/UX program

Same phase protocol as Part E (small commits, hook-managed versions, node --check, PRECACHE registration, Neil approves pushes; 🔴 = touches money-adjacent UI). The UI/UX program can start any time after Stage 0; phases that overlap a Part-E refactor say so in **Depends** — do the fix once, in whichever program runs first, and mark the twin done.

---

## STAGE U0 — Linkage truth & dead-control kills (Phases 101–110)

### Phase 101 — Wire the two dead filters
**Goal:** No control in the app does nothing (U-C3).
**Files:** js/departments.js.
**Instructions:**
1. `rec-filter` (5332): add a `change` listener that filters the Records table rows by `type` (client-side over the already-fetched list), following the exact pattern at 8732-8734 (`dwg-f-status` etc.). Re-render the tbody only.
2. `it-asset-filter` (9075): same — filter the assets list by status value.
3. Grep for any other `<select id=` inside templates with zero references (the audit found only these two, but re-run the check after wiring: `python3` extraction from the wiring audit, archived in scratchpad reports/14).
**Verify:** each filter visibly narrows its table; "All" restores.
**Depends:** —

### Phase 102 — Make the invisible badges visible
**Goal:** Status pills always carry color (U-C1).
**Files:** css/styles.css (or css/components.css post-Phase 53).
**Instructions:**
1. Add `.badge-warn` and `.badge-amber` rules using the existing warning tokens (`--warning`/`--warning-soft`) with per-theme overrides matching the `.badge-orange`/`.badge-green` pattern; ensure Light-theme contrast (dark amber text on soft amber bg).
2. Audit every `badge-*` class emitted in JS vs every `.badge-*` rule in CSS (one grep each way); add any other missing pair the sweep finds.
3. Screenshot the Approvals page before/after in all three themes.
**Verify:** Approvals "Pending"/"For Review" pills render colored in Light/Dark/Astral.
**Depends:** —

### Phase 103 — Double-click guards on every money save 🔴
**Goal:** No financial write can be double-fired from the UI (U-C2; complements Part E Phase 11).
**Files:** js/departments.js, js/modules.js, js/lib (helper).
**Instructions:**
1. Add `window.busy(btn, asyncFn)` helper: disables the button, swaps label to a spinner/`Working…`, always re-enables in `finally`, returns the promise. Copy the proven pattern from rs-save (departments.js:10117) / rec-save (15380).
2. Wrap the 9 Tier-1 handlers: save-crj-btn (5139), save-cdj-btn (5262), save-led-btn (4804), save-rec-btn (5384), save-tax-btn (4378), save-ep-btn (4108), pe-save-btn (6189 — this one also deducts CA), save-pca-btn (modules.js:1694), so-save (9878).
3. Wrap the 2 Tier-2 handlers (save-pay-btn 8022, gen-inv-btn 8092) after their confirm gates.
4. pr-disburse-go (4220-4231): disable synchronously on click — this is the UI half of Part E Phase 11's transactional lock; implement both.
5. Sweep the remaining ~85 unverified lower-stakes async handlers with a quick pass: any handler that `add()`s a document gets busy() (deletes/edits behind confirmDialog may keep the dialog as their gate).
**Verify:** rapid double-click on each wrapped button produces exactly one document (test against a scratch collection where feasible); button re-enables after a forced failure.
**Depends:** coordinate with Part E Phases 11–13 (same code regions).

### Phase 104 — Router-bypass fixes (Back button, part 1)
**Goal:** Every department entry goes through the router (U-C4).
**Files:** js/app.js.
**Instructions:**
1. app.js:3118 (employee dashboard dept quick-tabs): `onclick="renderDeptModule('${dept}')"` → `onclick="navigateTo('dept:${dept}')"`.
2. app.js:6445 (Departments grid): same conversion in the addEventListener.
3. app.js:3726 (dual-dept picker): same, or delete with the `my-dept` orphan decision in Phase 106.
4. Confirm navigateTo's dept: case updates hash + history + setActiveNav (it does — 2086-2090); test Back returns to dashboard/Departments and refresh preserves the dept view.
**Verify:** phone + desktop: dashboard → dept card → Back lands on dashboard; refresh stays on the dept.
**Depends:** —

### Phase 105 — Overlay integrity (Back button, part 2)
**Goal:** Every full-screen surface answers to the Back button exactly once (U-C5).
**Files:** js/app.js, js/departments.js.
**Instructions:**
1. `openWorkerProfilePanel` (app.js:5173-5207): register `window.Overlay.push('worker-profile', teardownFn)` on open, mirroring openTaskDetail; its close button routes through `Overlay.dismissTop()`.
2. The 7 task-panel bypass sites (departments.js:1132, 1153, 1163, 1166, 1172, 1189, 1281): replace `closeTaskPanel(); …` with `window.Overlay.dismissTop(); …` (verify dismissTop invokes closeTaskPanel via the registered teardown; keep the follow-on render/modal call).
3. Mobile sidebar + profile drawer: decide (recommend) pushing a lightweight history entry on open so device Back closes them, matching user expectation on Android; wire through Overlay so Escape/Back/scrim all converge. The router comment at app.js:7846-7847 documents today's exception — update it.
4. Regression: open task → edit modal → Back → Back → Back sequence lands exactly where expected each press.
**Verify:** no double-press-to-leave anywhere; Android back closes sidebar/drawer/panels in LIFO order.
**Depends:** Phase 104.

### Phase 106 — Orphan-route decisions & cleanup
**Goal:** Every route is reachable or deleted (U-C6).
**Files:** js/app.js, js/departments.js, js/config.js.
**Instructions (per route, with Neil's one-word ruling each):**
1. `submissions` — fully built inbox. Recommend: surface as an Approvals chip (work submissions already flow there) and DELETE the standalone route, or add a sidebar item under the employee bucket. Implement ruling.
2. `cash` (Cash & Expenses screen) — superseded by Finance→Cash tab? Verify feature parity with renderCash inside dept:Finance; if duplicate, delete route + renderer; if unique (personal expense filing), add nav entry where employees find it.
3. `my-dept` + renderMyDepartment + dual-dept picker — vestigial: delete (dept links are direct now).
4. `bk-quotations` — delete the case (Sales quotes live in dept:Sales).
5. `dept:Partners` — add a sidebar entry in the president bucket (president/manager per its gate) so permitted roles can reach it without hash-typing.
6. `notifications` — see Phase 108.
7. `team` — add a sidebar item in the president bucket ("Team & Payroll") or fold its unique functions (worker accounts, force-logout, CSV) into HR and delete; ruling.
8. Kill the dead `navigateTo('cash-advance')` singular at departments.js:5609 (fix to 'cash-advances' or remove the dead branch).
**Verify:** `grep` each removed key returns nothing; every kept route has ≥1 nav path per permitted role.
**Depends:** —

### Phase 107 — Role/nav mismatch repairs
**Goal:** Nav never promises what a role can't open (U-H4).
**Files:** js/app.js, js/departments.js.
**Instructions:**
1. Secretary + Partners: either include secretary in renderPartnersDept's gate (matches isAdmin elsewhere) or exclude the Partners card from the Departments grid for secretary (6418). Pick with the Phase-25 secretary ruling; implement consistently on BOTH sides.
2. Dept-assignment dropdowns (app.js:7250, 7252, 7445, 7447, 6453): filter out `Partners` (and `Brilliant Steel` where not intended) using the existing exclusion pattern at departments.js:14714-14715; decide whether `Admin` is assignable (it routes to a stub — probably exclude).
3. Secretary dashboard "Admin — Policies & HR Docs" (2858): retarget to `navigateTo('company','policies')` (the real feature), or build the Admin dept module; recommend retarget.
4. Inventory / sales-orders / projects-lifecycle: add explicit render-entry gates matching the sidebar conditions (dept membership or finance/admin) via the shared guard() (Part E Phase 50) — closes the hash-URL data-access hole; verify against firestore.rules reads so the gate matches server truth.
**Verify:** secretary click-through hits zero dead-ends; a Production-only employee typing #/sales-orders gets Access Denied.
**Depends:** Part E Phase 25 ruling; guard() from Phase 50 (or a local gate if run earlier).

### Phase 108 — Notifications page parity on desktop
**Goal:** The full notifications page is reachable everywhere (U-C6 part).
**Files:** js/notifications.js, js/app.js.
**Instructions:**
1. Keep the desktop dropdown, add a "See all" footer link inside the panel routing to `navigateTo('notifications')` (currently the page is mobile-only via the ≤768px branch at notifications.js:709-717).
2. Page gains the >30 pagination from Part E Phase 66 (coordinate).
3. Add the page to the profile-drawer "More" list for discoverability.
**Verify:** desktop: bell → panel → See all → full page; badge count matches page count (post-Phase 118).
**Depends:** Phase 66 (Part E) for pagination.

### Phase 109 — Dead-reference cleanup
**Goal:** No bindings to elements that don't exist (U-M3).
**Files:** js/app.js, js/notifications.js.
**Instructions:**
1. Delete `toggleTheme()` + the two `theme-toggle-btn` references (app.js:892-921) — the profile-drawer theme swatches are the real UI. OR (Neil ruling) resurrect a topbar quick-toggle; recommend delete.
2. Delete the `bn-notif-badge` branch (notifications.js:31).
3. Delete the `qb-fullscreen` legacy cleanup shims (app.js:1228, 2073) — v1 overlay is long gone.
**Verify:** grep each id returns zero; theme switching still works via drawer.
**Depends:** —

### Phase 110 — Wiring guards in CI
**Goal:** This class of defect can't silently return (Part G method → permanent check).
**Files:** new scripts/check-ui-wiring.js, .github/workflows/ci.yml.
**Instructions:**
1. Productionize the audit extractions (the corrected `(?<![\w-])id=["']` regex and the global-name inventory from scratchpad reports/14): report (a) getElementById targets never rendered (allowlist the `.id=` createElement set), (b) rendered selects/buttons with no binding and no onclick (allowlist read-only form fields by suffix convention), (c) onclick → missing window global.
2. Run as a warn-only CI job (the false-positive taxonomy is documented; hard-fail only on class (c), which had zero false positives).
3. Document the allowlist conventions in ARCHITECTURE.md.
**Verify:** CI green on master; introducing a fake `onclick="nope()"` in a branch fails the job.
**Depends:** Part E Phase 7 (ci.yml exists).

---

## STAGE U1 — One design language: formats, statuses, feedback (Phases 111–120)

### Phase 111 — The one peso formatter
**Goal:** A single `fmtPeso` exists and the bare-locale calls die (U-C8).
**Files:** js/lib-helpers.js (Part E Phase 32's home), js/app.js, js/departments.js.
**Instructions:**
1. Implement `window.fmtPeso(n, {dp=2, sign=false})` → `'₱' + Number(n||0).toLocaleString('en-PH', {minimumFractionDigits:dp, maximumFractionDigits:dp})`; `fmtPesoWhole(n)` = dp:0 with explicit rounding for customer-facing docs.
2. Replace the 20 bare `.toLocaleString()` currency sites first (app.js:2444, 3858, 3944, 3957, 8622, 8649; departments.js:9597, 9613, 9937, 9939, 10143-44, 10391, 10411, 12461, 13435, 13542-43, 13677) — these are the device-locale bugs.
3. Fix the uncapped formatter at app.js:1672 (missing maximumFractionDigits) by deleting it in favor of fmtPeso.
**Verify:** set OS locale to en-US: dashboard KPIs still render ₱ + en-PH grouping + exactly 2dp.
**Depends:** Part E Phase 32 (or create lib-helpers early).

### Phase 112 — Formatter migration sweep
**Goal:** Every peso in the app flows through fmtPeso (~330 legacy call sites).
**Files:** js/*.js.
**Instructions:**
1. Scripted, mechanical replacement (Haiku-tier): `fmt(` (departments.js ~230 sites), `formatNum(` (app.js ~77), `fmtN(` (modules.js ~15), local `fmt`/`f`/`num` variants (app.js:6530; departments.js:6604, 8749, 14379, 14235; modules.js:1855) → `fmtPeso(`. Keep `window.fmt = fmtPeso` as a one-release compatibility alias, then remove.
2. `node --check` + spot-render 10 screens; diff a payslip and an income statement pre/post (values must be byte-identical).
**Verify:** `grep -c "toLocaleString('en-PH'" js/` ≈ 1 (inside fmtPeso only); QA money screens unchanged.
**Depends:** Phase 111.

### Phase 113 — Customer-facing rounding rule 🔴
**Goal:** Printed and stored and listed totals agree (U-C8 + Part E H2/D4).
**Files:** quote-builder-v2.html, js/departments.js (qePeso), js/pricing-engine.js.
**Instructions:**
1. Implement Neil's D4/D5 rulings (commission basis; per_length activation) with Part E Phase 19 — this phase is the DISPLAY half: pick ONE rule (recommend: totals computed and stored at 2dp; customer-facing prints show 2dp too — whole-peso display only if Neil prefers, in which case *storage still keeps 2dp* and display rounds consistently in BOTH Quick Estimate and the builder).
2. Point qePeso (departments.js:6905) and formatPeso (QB:2953) at the ruled display mode; both delegate to pricing-engine totals.
**Verify:** the ₱12,345.50 test quote shows the same figure in the builder, Quick Estimate, print, Sales list, and Firestore doc.
**Depends:** Part E Phases 19, 38.

### Phase 114 — Manila-pin every date display
**Goal:** No screen shows the wrong calendar day anywhere on Earth (U-H1).
**Files:** js/*.js, new CI grep gate.
**Instructions:**
1. Extend lib-helpers: `fmtDateM(v)` (en-PH date, timeZone Asia/Manila), `fmtDateTimeM(v)` (wraps existing fmtManila), `fmtTimeM(v)`.
2. Migrate the 40 unpinned `toLocaleDateString` sites and 30+ `toLocaleString` sites (inventory in scratchpad reports/13; e.g. app.js:170, 1594, 2461, 3995, 8149; departments.js:601, 2154, 4286, 10654, 11077, 13068, 13379) — scripted assist + manual review of each context (some are labels, some are doc fields).
3. Chat's en-CA grouping (chat.js:658) is functionally correct (already BIZ_TZ-pinned) — leave the mechanism, align the visible label format with fmtDateM.
4. CI gate: grep for `toLocaleDateString(` / `toLocaleString(` outside lib-helpers → warn job (allowlist the pinned wrappers).
**Verify:** device TZ = US Pacific, 7 AM Manila: task dates, payslip period, ledger dates all show the Manila day.
**Depends:** Phase 111 pattern; coordinates with Part E Phase 17 (money-doc labels — don't double-migrate).

### Phase 115 — One quote-status truth
**Goal:** A quote status has one color and one label everywhere (U-H2).
**Files:** js/ui-status-meta.js (Part E Phase 40's module).
**Instructions:**
1. This is Part E Phase 40's item 1 — execute there if not yet done; this phase adds the two audit-found extras: delete the LOCAL `statusBadge()` at departments.js:12155-12161 that shadows the global, and extend the global map so quote statuses stop falling back to gray (578-581 → the new QUOTE_STATUSES lookup at call sites 7593/7730).
2. Regression: render the same quote doc on all 5 screens (app.js:2435 dashboard, 9604 files, 9670 summary, 10408 client data, 12155 client hub) — identical badge.
**Verify:** as above, in all three themes.
**Depends:** Part E Phase 40.

### Phase 116 — Status meta for every domain
**Goal:** Zero hand-rolled status ternaries remain (U-H2 tail).
**Files:** js/ui-status-meta.js, js/app.js, js/departments.js, js/modules.js.
**Instructions:**
1. Add meta tables + lookups for: task status (app.js:6968), gov-biddings (7015), IT ×5 (departments.js:9019, 9092, 9192, 9309, 9432), leave (11071, 11148; modules.js:2205 lvBadge), CA (unify modules.js:1575 inline-style vs 1484 class mechanisms), purchase-requisition stages (15034 raw dataset values).
2. One `statusBadge(domain, id)` API; all call sites migrate; keep PROD_STAGES/DRAWING_STATUSES/PARTNER_STAGE as members of the same registry.
3. Delete every replaced ternary; grep gate for `badge-` construction outside the module (warn job).
**Verify:** spot-render each domain's list; colors/labels match the meta table exactly.
**Depends:** Phase 115.

### Phase 117 — Toast semantics
**Goal:** Success looks like success, errors look like errors, nothing is silent (U-H3).
**Files:** js/notifications.js, all callers.
**Instructions:**
1. Add `Notifs.success(msg)`, `Notifs.error(msg)`, `Notifs.info(msg)`; keep showToast for compatibility but log a dev warning when called without a type.
2. Retype the 108 success-sounding default-info calls → success (scripted candidate list from scratchpad reports/13; manual skim each) and the 11 mistyped denials (departments.js:3935, 10852, 10873, 10908, 10926; modules.js:1099) → error/info per meaning.
3. Fix the two silent actions: IT Access Revoke (9345-9349) and Submission Approve/Reject (1550-1558) get success toasts.
4. Standardize copy: past-tense confirmations ("Saved", "Approved — requester notified"), actionable errors ("Couldn't save — check connection and retry").
**Verify:** approving anything shows green; denying shows the denial style; every write path emits exactly one toast.
**Depends:** —

### Phase 118 — Numbers that stop lying 🔴
**Goal:** Every displayed count/total equals stored truth (U-C7, U-C8, U-M3).
**Files:** js/departments.js, js/modules.js, js/notifications.js.
**Instructions:**
1. Approvals badge: add `pending_raises` to the count query set (departments.js:10500-10525) — or complete Part E Phase 35's merge (badge derives from the same fetch as the list) which fixes it structurally; do whichever lands first, verify the other.
2. Unread badge: count via a dedicated unread query, not the 30-item window (Part E Phase 66's item 1 — coordinate; verify here).
3. CA admin card (modules.js:1587): render stored `a.totalPayable` (Part E Phase 18 twin — verify done, else do here).
4. Expense Reject (2044-2050): add the missing `dbCacheInvalidate('expenses-pending'/'expenses-recent')` so the Payables KPI drops immediately.
5. Sweep for other client-side recomputes shown next to stored fields: grep `* terms`, `* qty` patterns in display templates; list + fix or annotate as intentional derived-display.
**Verify:** seed 40 unread → badge 40; reject an expense → KPI decrements on next render; a raise request is counted AND listed.
**Depends:** Part E Phases 18, 35, 66 (twin items — verify, don't duplicate).

### Phase 119 — One name per concept
**Goal:** The same thing is called the same thing everywhere (U-M1).
**Files:** js/config.js, js/app.js, js/departments.js, new UI-GLOSSARY.md.
**Instructions:**
1. Write UI-GLOSSARY.md: Cash Advance (never bare "Cash"/"CA" in labels; "CA" allowed in dense table cells only), Quote (not Quotation), Sales Order, Disburse (payroll) vs Record Payment (everything else), department display names, role display names, action-verb standards (Save/Create/Approve/Deny/Delete).
2. Bottom-nav label config.js:362 'Cash' → 'Advance' (or 'Cash Adv.' — pick what fits icon-only + tooltip; with Phase 133's label decision).
3. Split the dual-meaning route: finance/manager dashboards' "Review Expenses"/"Payables" buttons (app.js:2951, 2957, 2997) stop targeting 'cash-advances' — target the Finance expenses tab (`dept:Finance` + subtab) so "Cash Advance" always means employee advances.
4. Sweep "Quotation" → "Quote" in UI strings (departments.js:6853, 6858, 7244 + grep); align "Mark Paid" (app.js:3834) with the glossary verb.
**Verify:** grep for banned labels returns only glossary-permitted contexts.
**Depends:** —

### Phase 120 — bir.js icon sweep + emoji lint
**Goal:** The last emoji-buttoned file joins the design system (U-M2).
**Files:** js/bir.js, js/config.js, ci.
**Instructions:**
1. Convert bir.js's button/heading emoji to `emojiIcon()` (⚙ 84, 🖨 126/665, 💾 440, 📄 628, 🧾 163) — add any missing glyphs to LUCIDE_EMOJI_MAP.
2. Lint: CI warn-job greps `<button|<h[1-4]` template lines for raw emoji ranges outside emojiIcon( — catches future regressions AND unmapped-glyph silent fallbacks (log emojiIcon misses to console.warn in dev).
**Verify:** BIR suite renders Lucide icons; lint clean.
**Depends:** Part E Phase 7 (ci.yml).

---

## STAGE U2 — The shared UX component kit (Phases 121–130)

### Phase 121 — renderEmptyState
**Goal:** One empty-state component, 146 hand-rolled variants retired (U-M5).
**Files:** js/ui (new ui-states.js), all render files.
**Instructions:**
1. `renderEmptyState({icon, title, hint, action})` returning the standard block; action = optional `{label, onclick}` CTA (e.g. "No clients yet — Add your first client").
2. Scripted migration of the 146 `empty-state` sites (mechanical where structure matches; manual for the ~20 with custom content); every migrated site gains a hint line — write the missing hints from the glossary voice.
3. Component renders identically in all three themes; add to the gallery (Phase 130).
**Verify:** every list screen's empty state shows icon + title + hint; grep for raw `class="empty-state"` outside the component → 0.
**Depends:** Phase 119 (voice).

### Phase 122 — withLoadingAndError
**Goal:** No screen can get stuck on a spinner or fail silently (U-M5).
**Files:** js/ui-states.js, worst-offender screens first.
**Instructions:**
1. `withLoadingAndError(container, fetcher, renderer, {loadingText, emptyCheck, emptyState})`: shows loading, awaits fetcher in try/catch, renders error-state with a Retry button on failure, renderEmptyState when empty.
2. Fix the confirmed offenders through it: renderProductDatabase (app.js:1649-1657), loadSubsList (departments.js:1499-1527), qeLoadDB silent degrade (6908-6917 — failure now says "Product catalog unavailable — retry", never fake-empty).
3. Migrate remaining fetch-render screens opportunistically during Stage U5-U7 screen passes (each screen phase's checklist includes it).
**Verify:** airplane-mode each fixed screen: error + Retry appears; Retry recovers.
**Depends:** Phase 121.

### Phase 123 — Button system
**Goal:** One button language: variants, sizes, states (incl. busy) (U-C2 tail, M5 press-scale).
**Files:** css/components.css, js/lib (busy helper from Phase 103).
**Instructions:**
1. Codify variants (primary/secondary/outline/danger/success/ghost/link) × sizes (sm/md/lg) × states (default/hover/active/focus/disabled/busy) — one CSS block each, press feedback via `--press-scale` (Part E Phase 52), busy state shows inline spinner (CSS animation, reduced-motion aware).
2. Ensure .btn-danger joins every coarse-pointer/mobile min-height rescue (styles.css:388 + 2415-2421 — U-H5 twin).
3. Sweep inline `style=` font-size/padding overrides on buttons (e.g. the 11px delete buttons) → size classes.
**Verify:** gallery page shows the full matrix; no inline-styled buttons remain (grep).
**Depends:** Part E Phases 52-54 (tokens/layers); Phase 103 (busy).

### Phase 124 — Form kit
**Goal:** Every form field looks and behaves identically.
**Files:** css/components.css, js/ui-form.js (optional helpers), screens.
**Instructions:**
1. Standard field block: label (always visible, no placeholder-as-label), input, help text, error text slot; required marker convention; disabled/readonly styles.
2. Add the 2 missing `inputmode="decimal"` in modules.js; audit `type="date"`/`type="time"` rendering across phone browsers; select styling parity.
3. Validation display standard: inline error under field + field border token; never a bare toast for field errors (toast reserved for submit-level outcomes).
4. Checkbox/radio: 44px hit area via label wrapping (fixes .ba-recon-chk class — U-H5) — one `.check-row` component.
**Verify:** gallery matrix; bank-reconciliation checkboxes tappable on a phone.
**Depends:** Phase 123.

### Phase 125 — Modal / sheet / page-panel standard
**Goal:** One overlay contract: footer submits, focus trapped, Back/Escape parity (U-H7).
**Files:** js/core-overlay.js, css/shell.css, screens.
**Instructions:**
1. Focus trap in openModal/openPage/dialogs: on open, focus first field; Tab cycles inside; on close, focus returns to the trigger element. Implement once in Overlay.
2. Footer rule: audit forms whose submit lives inline in #modal-body (grep submit-button ids vs modal-footer usage); migrate them to #modal-footer so the keyboard-avoidance architecture protects them all (mobile audit §3 caveat).
3. Bottom-sheet behavior (≤639px) verified per modal: taller-than-viewport forms scroll in body, footer pinned; sheet swipe-dismiss (gestures) doesn't conflict with inner scroll.
4. Escape/Back/scrim all route through Overlay.dismissTop (already the design — assert with a test pass).
**Verify:** keyboard-only: open modal → Tab never escapes → Esc closes → focus back on trigger. Phone: long form's Save always visible.
**Depends:** Phases 104-105; Part E Phase 41 (core-overlay home).

### Phase 126 — Table kit
**Goal:** One table pattern with mobile strategy and consistent actions.
**Files:** css/components.css, js/ui (table helpers), screens.
**Instructions:**
1. Standard: .table-wrap scroll container (already universal — codify), sticky header option, right-aligned numeric columns, row-action button set (icon buttons with aria-labels), consistent zebra/hover (hover:hover gated).
2. Scroll affordance on phones: edge-fade gradient + one-time "swipe →" hint on tables wider than the viewport.
3. AEC table (departments.js:11812): drop min-width:860px; mark priority columns and let the rest wrap/hide via a `data-priority` column pattern (or accept scroll + affordance — Neil taste call, default: priority columns).
4. CSV-export button placement standardized on table headers (10 existing exports align).
**Verify:** every table screen at 390px scrolls with visible affordance; AEC usable portrait.
**Depends:** Phase 123.

### Phase 127 — Chips, cards, list items
**Goal:** The remaining subtab/card/list variance collapses into the kit.
**Files:** css/components.css, screens.
**Instructions:**
1. chipTabs everywhere: verify the Part E stragglers landed (Tasks-president 760, Cash 1613, Finance CA 5526, progress/help tabs) + grep `.subtab-bar` → 0 remaining emissions.
2. Card anatomy: header (title+action), body, footer meta — normalize the ~6 ad-hoc card shapes (dashboard KPI, item-card, dept card, policy card, team card, file card) onto shared classes where visually identical.
3. List-item pattern: leading icon/avatar, two-line text, trailing meta/action — align task feed, notif items, approval rows, file rows.
**Verify:** visual sweep — same-purpose surfaces look identical across departments.
**Depends:** Part E Stage 5 (layers).

### Phase 128 — Loading skeletons
**Goal:** One loading language, cheap to render (ties Part E Phase 57).
**Files:** css/components.css, js/ui-states.js.
**Instructions:**
1. Skeleton row/card components (opacity pulse in Light/Dark; shimmer allowed Astral-only per the blur/motion budget) replacing the mixed `.loading-placeholder` text pattern.
2. withLoadingAndError uses skeletons for list/table screens, spinner text only for tiny panels.
**Verify:** loading states are non-janky on a mid-range Android (Performance trace: no layout thrash).
**Depends:** Phases 122; Part E Phase 57.

### Phase 129 — Icon integrity
**Goal:** No icon ever renders as an empty tag or stray emoji (U-M2 tail).
**Files:** js/*, ci.
**Instructions:**
1. Runtime dev-check: after each navigateTo render, scan for `i[data-lucide]:empty` (icons never hydrated) and console.warn with the page name — run the full click-through once, fix any hits (the static scan found zero same-line misses but couldn't prove dynamic assemblies).
2. emojiIcon unmapped-glyph dev warning (Phase 120's item) verified live.
3. Icon-size/stroke consistency: audit data-lucide size attributes vs CSS sizing — one sizing convention.
**Verify:** full click-through logs zero warnings.
**Depends:** Phase 120.

### Phase 130 — Component gallery
**Goal:** The kit is visible, testable, and self-documenting.
**Files:** new js/feat-gallery.js (president/dev-only route).
**Instructions:**
1. A gallery page rendering every component in every state (buttons matrix, fields incl. error states, badges incl. every status domain, chips, cards, tables, empty/loading/error states, toasts triggerable, modal/sheet demo) — in the current theme; theme-switch to compare.
2. Register behind a president-only guard; exclude from nav for other roles.
3. This page is the visual-QA fixture for Stage U9's screenshot baseline.
**Verify:** gallery renders clean in all three themes at phone + laptop widths.
**Depends:** Phases 121-129.

---

## STAGE U3 — Phone optimization (Phases 131–140)

### Phase 131 — Touch-target completion
**Goal:** Every interactive element ≥44px effective on touch (U-H5).
**Files:** css/styles.css (later components.css).
**Instructions:**
1. Add `.topbar-avatar` to the pointer:coarse ::after expansion list (styles.css:305-308) or size it 40px+ with padding to 44.
2. Add `.btn-danger` to the coarse rescue at 388; add `.ms-thread-menu-btn` to the ::after list.
3. `.check-row` label-wrap pattern (Phase 124) applied to the audit's checkbox list (ba-recon-chk 5039, mc-channel 2500, hrp-include-payroll 5890, rs-prod 10081 + grep for bare `type="checkbox"` in templates).
4. `.pressable` sweep: add to remaining small action buttons for consistent press feedback.
**Verify:** Chrome DevTools touch simulation: tap every audited element at 390px without mis-taps.
**Depends:** Phases 123-124.

### Phase 132 — Thumb-zone action strategy
**Goal:** Primary actions reachable one-handed on phones (U-M5 tail).
**Files:** css/shell.css, screens.
**Instructions:**
1. Introduce a mobile-only sticky action bar: on phones, a screen's single primary action (page-header's main button — "+ Add", "New Quote", "Compute") mirrors into a bottom-anchored bar above the bottom nav (safe-area aware, hides on scroll-down/shows on scroll-up).
2. Implement as opt-in per screen (`pageAction({label, icon, onclick})` helper) and roll out to the ~15 highest-traffic screens during Stage U5-U7 passes; keep header buttons on desktop.
3. No FAB (owner's professional-look directive favors a labeled bar over a floating circle) — confirm with Neil (D-U1 in the register).
**Verify:** phone: create a task/quote/expense entirely with the right thumb.
**Depends:** Phase 123.

### Phase 133 — Bottom-nav labels & audit
**Goal:** Nav is discoverable and consistent per role (mobile audit §5).
**Files:** js/config.js, css/shell.css.
**Instructions:**
1. Decision (D-U2): icon-only (today) vs icon+10px labels. Recommend labels — "readable everywhere" directive; 6-7 items still fit at 360px with 10px labels (Messenger-style).
2. Implement ruling; verify per-role sets (employee 6 / president 7 / partner 6-7) fit 320px worst-case; tooltips on desktop top-strip equivalents.
3. Re-check active-state contrast in all themes (ties the --primary-fill token).
**Verify:** 320px viewport: no truncation/overlap; active item obvious in Astral.
**Depends:** Phase 119 (label text).

### Phase 134 — Mobile table strategy rollout
**Goal:** The scroll affordance ships; worst tables get priority columns (U-M4/126 rollout).
**Files:** css/components.css, top-5 widest screens.
**Instructions:**
1. Ship Phase 126's edge-fade + swipe hint globally.
2. Apply the priority-column pattern to the five widest tables (payroll management, ledger, AEC directory, approvals-all, inventory) — non-priority columns hidden ≤480px behind a per-row expand.
3. Keep full columns ≥768px.
**Verify:** the five tables usable portrait without zoom; row expand reveals hidden fields.
**Depends:** Phase 126.

### Phase 135 — Long-form keyboard survival
**Goal:** No submit button ever hides behind the keyboard (mobile audit §3 caveat).
**Files:** js/core-overlay.js, screens with openPage forms.
**Instructions:**
1. Audit inline-body submit buttons (Phase 125's migration list) — confirm all moved to footers.
2. For full-page (openPage) forms: add `scroll-margin-bottom` + focus-scroll-into-view on input focus; sticky footer bar for the page-level Save (reuses Phase 132's bar).
3. Test the three longest forms (HR profile, product editor, PO form) with the keyboard open on Android + iOS Safari.
**Verify:** every form's Save tappable with keyboard open.
**Depends:** Phases 125, 132.

### Phase 136 — Gesture & safe-area regression suite
**Goal:** Gestures never fight; notches never clip (ties Part E Phase 64).
**Files:** QA-CHECKLIST.md + fixes as found.
**Instructions:**
1. Execute the gesture matrix on real devices (edge-swipe owner from Part E Phase 64 must be landed): edge-swipe at root/deep/modal/sheet/chat; PTR with modal open (Part E Phase 58's z-fix verified); sheet-dismiss vs inner scroll.
2. Safe-area visual pass on a notched iPhone + punch-hole Android: topbar, bottom bar, sheets, toasts, chat composer, splash.
3. Fix anything found; record the matrix as a permanent QA-CHECKLIST section.
**Verify:** matrix green on both device classes.
**Depends:** Part E Phases 58, 64.

### Phase 137 — Orientation & tablet posture
**Goal:** The PWA respects how tablets are held (U-M4).
**Files:** manifest.json, css.
**Instructions:**
1. Decision (D-U3): drop `"orientation":"portrait-primary"` → `"any"` (recommended — the 769-1023px tier + two-pane chat already exist), or keep the phone lock and document.
2. If freed: landscape spot-pass on tablet tier (chat two-pane, dashboards, tables) — fix egregious stretches only.
3. Bump manifest version-adjacent caches (hook handles CACHE_VER; verify manifest re-fetch behavior on installed PWAs).
**Verify:** installed PWA rotates on a tablet; phone experience unchanged.
**Depends:** —

### Phase 138 — Type scale & OS text scaling
**Goal:** OS accessibility text-size settings actually work (U-H7 tail).
**Files:** css/tokens.css + all font-size declarations.
**Instructions:**
1. Introduce a rem-based type scale in tokens (`--fs-xs…--fs-2xl` mapped to rem; root stays 16px-default so nothing changes visually at 100%).
2. Scripted conversion of font-size px → the nearest scale token (styles.css has ~1,900 px declarations; font-size subset only — extract, map, review outliers manually).
3. Test at OS text scale 130%: layout holds (containers use max-content-safe patterns; truncation with ellipsis where needed), no overlap on the five densest screens.
**Verify:** 130% OS scale: readable, unbroken dashboards/tables/nav.
**Depends:** Part E Phase 52 (tokens home).

### Phase 139 — Offline & update UX
**Goal:** The PWA tells the truth about connectivity and versions (ties Part E Phase 62).
**Files:** js/core-boot.js, js/ui-states.js, sw.js.
**Instructions:**
1. Offline banner: `navigator.onLine` + fetch-failure heuristic → slim top banner "Offline — showing cached data"; writes queue message where Firestore persistence will sync ("Saved — will sync when online") vs hard-fail actions (payments) blocked with explanation.
2. Verify Firestore offline persistence behavior per major write path; classify each as queue-safe or block-offline; implement the block list (money paths: block).
3. SW update toast (Part E Phase 62) verified as part of this UX set.
**Verify:** airplane mode: banner appears; a task edit queues + syncs on reconnect; a Disburse attempt is blocked with a clear message.
**Depends:** Part E Phase 62.

### Phase 140 — Phone QA sweep & burn-down
**Goal:** Every screen certified at 390px per role.
**Files:** QA results + fixes.
**Instructions:**
1. Execute the 25+ screen matrix (mobile audit §9 as the checklist) × the 7 roles' reachable subsets at 390px — every screen: renders, scrolls correctly, actions reachable, no overflow, gestures sane.
2. Log and fix everything found (timebox fixes to this stage's scope: layout/touch only; logic bugs route to the register).
3. Record certification in QA-CHECKLIST.md with device/OS versions.
**Verify:** zero open phone-layout defects.
**Depends:** Phases 131-139.

---

## STAGE U4 — Laptop/desktop optimization (Phases 141–150)

### Phase 141 — Ultrawide layout cap
**Goal:** Content stays readable on big monitors (U-M4).
**Files:** css/shell.css.
**Instructions:**
1. `.main-content { max-width: 1680px; margin-inline: auto; }` (tunable token `--content-max`); verify against sidebar offset math.
2. Dashboard grids: audit at 1920/2560 — cap card growth, prefer more columns over stretched cards (KPI rows go 4-up → 6-up before stretching).
3. Tables keep full available width inside the cap.
**Verify:** 2560px monitor: line lengths and cards look intentional; no regression at 1280px.
**Depends:** Part E Phase 53.

### Phase 142 — Desktop density & multi-column forms
**Goal:** Big screens show more, not bigger.
**Files:** css/components.css, top forms/screens.
**Instructions:**
1. Two-column form layout ≥1024px for the long editors (HR profile, product editor, PO, client editor) — CSS grid on the existing field blocks, no markup rewrites where avoidable.
2. Optional compact density for tables ≥1024px (reduced row padding token) — default on for ledger/payroll/inventory.
3. Detail panels (task, worker profile) use side-panel width (600-720px) rather than full-screen on ≥1024px.
**Verify:** the long forms fit one screen at 1440px; tables show ~30% more rows in compact.
**Depends:** Phase 141.

### Phase 143 — Hover completeness
**Goal:** Every interactive element responds to a mouse (mobile audit §7).
**Files:** css.
**Instructions:**
1. Sweep interactive classes without a (hover:hover-gated) hover state: cards, list rows, chips, icon buttons, nav items, table rows (partially done) — add token-based hover styles.
2. Cursor discipline: `cursor:pointer` on all clickables (grep for click-bound classes without it), `default` on non-interactive, `text` preserved on selectable data cells (user-select audit: enable selection on table/data text where blocked).
**Verify:** mouse pass over 10 screens: everything clickable signals affordance.
**Depends:** Phase 127.

### Phase 144 — Keyboard-first: traps, order, returns
**Goal:** Full keyboard operability (U-H7).
**Files:** js/core-overlay.js, screens.
**Instructions:**
1. Land the Overlay focus trap (Phase 125 item 1) if not yet; add focus-return-to-trigger everywhere.
2. Tab-order audit on the five most keyboard-used screens (finance forms, approvals, payroll): DOM order = visual order; fix stragglers.
3. Enter submits single-field modals (promptDialog already?); Escape parity verified.
4. Skip-to-content link for keyboard users landing on the app shell.
**Verify:** complete an expense entry + approval end-to-end mouse-free.
**Depends:** Phase 125.

### Phase 145 — Keymap expansion
**Goal:** Power users fly (mobile audit §7).
**Files:** js/core-nav.js (Keymap), data/help-content.js (cheat sheet).
**Instructions:**
1. Add: `n` (context New — task/quote/expense per current screen via pageAction registry), `g d`/`g t`/`g a`… (go-to two-key sequences for top pages), `[`/`]` (subtab prev/next on chipTabs screens), `Cmd/Ctrl+Enter` (submit focused modal form).
2. All shortcuts suppressed while typing in inputs (existing guard — verify); update the `?` cheat sheet.
**Verify:** each shortcut on 3 screens; no input-field interference.
**Depends:** Phase 132's pageAction registry.

### Phase 146 — Desktop panels & layout paradigms
**Goal:** Desktop screens use desktop patterns where they pay (mobile audit §7, notif parity).
**Files:** js/feat-approvals-page.js, js/notifications.js, css.
**Instructions:**
1. Approvals ≥1280px: master-detail — list left, selected request's detail/actions right (no full-page hop per item); falls back to current flow below.
2. Notifications panel: virtualized/paged list inside the dropdown + the Phase-108 See-all page.
3. Evaluate (don't over-build) other master-detail candidates: chat (already two-pane), files hub (preview pane) — files preview pane ≥1280px if cheap.
**Verify:** approvals triage of 10 items in under a minute without page hops.
**Depends:** Phases 59-60 (Part E), 108.

### Phase 147 — Print-from-screen polish
**Goal:** On-screen prints are as deliberate as the letterhead docs (ties Part E Phase 56).
**Files:** css/print.css.
**Instructions:**
1. Extend the generic print layer with per-screen tuning for the screens people actually print: ledger view, income statement (already ok — verify), approvals list, team roster, inventory count.
2. `.no-print` sweep: nav/chrome/buttons excluded everywhere; page titles + printed-on date header via a shared print-header block.
**Verify:** Ctrl+P on those five screens: clean, paginated, dated output from any theme.
**Depends:** Part E Phase 56.

### Phase 148 — Charts at width
**Goal:** Analytics reads well on big screens.
**Files:** js/feat-analytics.js, chart theming.
**Instructions:**
1. Chart.js sizing: responsive containers with sane max-heights; legends right-side ≥1280px; tooltip/number formatting via fmtPeso/fmtDateM.
2. Color mapping through CHART_COLORS/chartTheme tokens verified in all three themes (Astral contrast pass).
3. Axis label density rules (maxTicks) so wide charts don't sprawl.
**Verify:** analytics on 1920px: no stretched/squashed charts; theme switch redraws correctly.
**Depends:** Part E Phase 86.

### Phase 149 — Selection, copy & data ergonomics
**Goal:** Desktop users can get data out of the screen.
**Files:** css, js/ui table helpers.
**Instructions:**
1. Enable text selection on data tables/cells app-wide (audit `user-select:none` scope — keep it on controls only).
2. Copy-cell/copy-row affordance on data tables (right-click is native once selection works; add a copy icon on row hover for key columns like reference numbers).
3. Reference numbers (SO-/PROJ-/PAY- etc.) rendered as click-to-copy chips.
**Verify:** copy a ledger ref with one click; select/copy a table region.
**Depends:** Phase 126.

### Phase 150 — Laptop QA sweep & burn-down
**Goal:** Every screen certified at 1280/1440/1920/2560 per role.
**Files:** QA results + fixes.
**Instructions:** run the same matrix as Phase 140 at the four widths + keyboard-only spot checks + hover pass; log, fix layout-scope items, certify in QA-CHECKLIST.md.
**Verify:** zero open laptop-layout defects.
**Depends:** Phases 141-149.

---

## STAGE U5 — Screen-by-screen unification I: shell & daily screens (Phases 151–160)

**Standard checklist applied by EVERY phase in Stages U5–U7 (the "unification pass"):** kit components only (buttons/forms/tables/cards/chips/empty/loading/error per Stage U2) · fmtPeso + fmtDateM/fmtManila everywhere · statusBadge(domain) everywhere · toasts via Notifs.success/error with glossary copy · pageAction mirrored on phone (Phase 132) · chipTabs + setSubroute/initialSubtab deep-linking · escHtml on titles too · busy() on every write button · 390px + 1440px verified in all three themes · SOP panel where the department has one. Each phase below lists only its screen-specific work items on top of that checklist.

### Phase 151 — Login & splash
Portal cards' role gating copy; error styling via field-kit; splash animation motion-budget compliant; "Update ready" toast placement; password-manager autocomplete attributes (`username`/`current-password`); Caps-lock hint. **Files:** index.html, js/core-boot.js, css. **Verify:** login on phone/laptop, wrong-password path, all themes.

### Phase 152 — Dashboards (5 roles + partner)
Unify KPI card grid (one component, 4/6-up rules), quick-actions block, alerts/pending strips onto kit cards; all money via fmtPeso (kills the bare toLocaleString cluster at app.js:2444+); mini-cal placement; remove duplicated ID-card block per D19 ruling; per-role content differences documented in code comments. **Files:** js/feat-dashboards.js. **Verify:** each role's dashboard at 390/1440; numbers match Finance-tab truths.

### Phase 153 — Tasks & task detail
Task detail panel = Overlay-registered side panel (720px desktop / full mobile — Phase 142 pattern); status card/standing/score/follow-up sub-components (Part E Phase 46 decomposition ridden); statusBadge('task'); comments thread uses chat kit visuals; deep-link `#/tasks/{id}`. **Files:** js/feat-tasks.js. **Verify:** full task lifecycle both devices; Back behavior clean (U-C5 fixed paths).

### Phase 154 — Approvals
Post-declutter polish: chips with TRUE counts (Phase 118), Grading chip UX, master-detail desktop (Phase 146), per-type row templates unified, badge colors live (U-C1 fixed), escalation action styling (secretary), empty per chip. **Files:** js/feat-approvals-page.js. **Verify:** counts = list lengths per chip; triage flow ≤3 taps mobile.

### Phase 155 — Chat
Composer failure-recovery + keyed render landed (Part E Phase 63) verified against kit; wallpaper menu touch target; inbox rows = list-item kit; unread truth; link-attachment UX copy; two-pane ≥1024px polish. **Files:** js/chat.js. **Verify:** send/fail/retry/reactions on phone; two-pane desktop.

### Phase 156 — Posts
Approval flow surfaced honestly (pending state visible to author); hearts optimistic-with-rollback; image posts sizing rules; empty feed CTA per role (president: post; employee: submit). **Files:** js/feat-posts.js. **Verify:** post → approve → publish loop; hearts on/off.

### Phase 157 — Team directory & profiles
Presence dots consistent with chat's buckets (shared helper); calling-card modal kit-ified; worker profile panel (Overlay-fixed) tabs = chipTabs; EOM banner/card unified; statusNote editing UX. **Files:** js/feat-team.js, js/feat-profile.js. **Verify:** directory → profile → DM path; EOM cycle.

### Phase 158 — Attendance & holidays
Calendar grid = shared attendance-grid component (Part E Phase 42); leave-day edit guard (Part E Phase 17) verified in UX (explicit convert dialog); kiosk modal ergonomics on shared tablets (big targets); holidays admin CRUD on kit. **Files:** js/feat-attendance.js. **Verify:** month nav phone; admin edit paths incl. leave day.

### Phase 159 — Leave & cash advance
Balance displays from stored truth only; request forms on form-kit with clear policy copy (post-D1 ruling); CA schedule table shows stored totalPayable + per-installment; admin/employee views reconcile visibly (same numbers). **Files:** js/feat-leave-ui.js, js/feat-cash-advance-ui.js. **Verify:** request→approve→balance loop shows identical figures on both sides.

### Phase 160 — Notifications & global search
Notif page + panel parity (Phase 108/146); per-type icons; mark-all UX; search: grouped results kit, keyboard nav (↑↓ Enter), recent-searches, partner gating copy. **Files:** js/notifications.js, js/feat-search.js. **Verify:** search-to-navigate under 3s; notif triage both devices.

---

## STAGE U6 — Screen-by-screen unification II: finance & HR (Phases 161–170)

### Phase 161 — Finance Overview 🔴
KPIs from finance_rollup (Part E Phase 85) with staleness honesty (asterisk + "as of" when cache-served); pending strips truthful post-118; quick links respect the cash-advances/expenses route split (Phase 119). **Files:** js/feat-finance.js. **Verify:** KPI = report totals for the same period.

### Phase 162 — Ledger & journals 🔴
CRUD-table component styling; ref chips click-to-copy (Phase 149); period picker standard; entry forms on form-kit with vatSplit preview; busy() everywhere (U-C2 closed here — verify); pagination (Part E Phase 85). **Files:** js/feat-finance.js. **Verify:** add/edit/delete-request round-trips; refs copyable.

### Phase 163 — Reports 🔴
IS/BS/CF on one report shell (period picker, print-target, CSV, drill-down links to ledger rows); DRAFT/estimate labeling rules (VAT worksheet honesty); consistent totals typography. **Files:** js/feat-finance.js. **Verify:** period switch, print, CSV per report.

### Phase 164 — Bank accounts & reconciliation 🔴
Drilldown = master-detail desktop; reconcile checkboxes on check-row kit (44px — U-H5); statement-import UX (Part E Phase 81) with match-state colors via status meta; balances from stored anchors. **Files:** js/feat-finance.js. **Verify:** reconcile a seeded month on phone + laptop.

### Phase 165 — Payroll management 🔴
Compute→Verify→Disburse strip as a visible state machine (steps, who/when stamps); disburse UX post-lock (Phase 11 + 103): confirmation summarises total + employee count; per-row edit modal on form-kit; priority-column mobile table (Phase 134). **Files:** js/feat-payroll-ui.js. **Verify:** full test-month cycle; double-click harmless; state visible at every step.

### Phase 166 — Payslips 🔴
History timeline per worker; generator form two-column desktop; print = letterhead standard; stage badges via meta; Manila period labels verified (H7 closed); JPEG download naming convention. **Files:** js/feat-payroll-ui.js. **Verify:** generate→verify→submit→print; label correct on a US-locale machine.

### Phase 167 — HR profiles & 201
Profile editor two-column; statutory-ID fields (Part E Phase 71) with completeness meter; 201 file area on files-kit; worker ID print batch UX (progress per Phase 185). **Files:** js/feat-hr.js. **Verify:** complete a profile to 100%; batch-print 3 IDs.

### Phase 168 — Taxes & BIR suite 🔴
bir.js visual adoption of the kit (post-Phase 120 icons); DRAFT watermark states honest (verified-flag driven); worksheet tables print-tuned; form pickers (2550 vs 2551 post-D7). **Files:** js/bir.js. **Verify:** each worksheet renders, prints, and labels its draft/final state truthfully.

### Phase 169 — Budgeting
Budget-vs-actual bars (chart tokens); dept-member edit affordances per rules truth; period consistency with finance screens. **Files:** js/feat-crm.js (budgeting home) or dept-finance. **Verify:** budget line edit → ledger actuals reflect.

### Phase 170 — Personal Finance (admin + self)
The split renders (Part E Phase 43) each get the pass: admin table with attendance/KPI columns priority-columned for mobile; self view payslip access + CA standing from stored truth;月 labels Manila-pinned. **Files:** js/feat-hr.js. **Verify:** both views both devices; numbers agree with payroll screens.

---

## STAGE U7 — Screen-by-screen unification III: operations & partners (Phases 171–180)

### Phase 171 — Sales
Quotes pipeline chips + per-customer grouping (ROADMAP NEXT-UP 4); Quick Estimate = pricing-engine truth (Phase 113 verified); AEC directory priority-columns (min-width gone); SOP panel; quote-status meta everywhere. **Files:** js/dept-sales.js. **Verify:** quote lifecycle; same totals engine-wide.

### Phase 172 — Quote builder (iframe internals)
The internal UI's own responsiveness pass (the mobile audit's uncovered area): 390px layout of catalog/calc/items; touch targets; partner-mode surface truth (C9 closed — verify no internal traces leak); print output typography; postMessage origin (Phase 19.5) verified. **Files:** quote-builder-v2.html. **Verify:** build a quote start-to-print on a phone as partner + as sales.

### Phase 173 — CRM / clients hub
Timeline default tab (Part E Phase 77); stage chips with counts; client editor form-kit; brand badges consistent; follow-up nudges surfaced. **Files:** js/feat-crm.js. **Verify:** client journey visible end-to-end.

### Phase 174 — Marketing
Campaign cards + spend visibility rules honest (finance-only sees ₱); leads → clients flow clarity; templates/proposals doc-cards on files-kit. **Files:** js/feat-crm.js or dept module. **Verify:** campaign CRUD; lead conversion path.

### Phase 175 — Design
Project hub tabs deep-linked; drawing status meta central (already good — verify); approval gate UX (two-party) explicit about who can approve; financials tab = Ledger-service truth. **Files:** js/dept-design.js. **Verify:** drawing lifecycle; payment posts once.

### Phase 176 — IT
Asset/software/access/network tabs on kit; the wired asset filter (Phase 101) verified; license expiry via Manila dates (Part E Phase 17); network-credentials screen gets an extra "sensitive" visual treatment + copy-to-clipboard (no plaintext toasts). **Files:** js/dept-it.js. **Verify:** filters, expiry flags, credential copy UX.

### Phase 177 — Production
Order board stage meta; QC checklist ergonomics on shop-floor devices (large targets, offline-tolerant per Phase 139); DR print; materials-consumption confirmation shows COS math before commit. **Files:** js/dept-production.js. **Verify:** order through stages on a tablet.

### Phase 178 — Purchasing
RFQ→PR→PO stepper visual; verdict-field separation mirrored in UI (who-can-what per rules); receive resolver table mobile-ready; disbursement handoff to Finance explicit. **Files:** js/dept-purchasing.js. **Verify:** full P2P cycle; role-appropriate buttons only.

### Phase 179 — Inventory
Valuation header; category chips; movement drill-down; reorder → RFQ link; count-form print + variance commit UX (transactional per Part E — verify affordance). **Files:** js/feat-inventory.js. **Verify:** count → variance → movement log chain visible.

### Phase 180 — Gov biddings, files hub, company, partners portal
Gov: checklist + deadline chips (Part E Phase 76). Files hub: preview pane desktop (Phase 146), share dialog role copy, recycle-bin clarity (purge policy post-D16). Company: memos conforme tracking UX, policies/downloads safeHttpUrl verified. Partners/BS portal: partner-eye QA — everything visible is partner-appropriate (C9/isolation verified visually). **Files:** respective modules. **Verify:** partner session shows zero internal data; files share/preview both devices.

---

## STAGE U8 — Feedback, reliability & accessibility depth (Phases 181–190)

### Phase 181 — Optimistic-update policy
Classify every write: optimistic-safe (hearts, statusNote, read-receipts — update UI, rollback on failure with toast) vs confirm-first (money, approvals — busy() + await). Implement rollback helpers; document in ARCHITECTURE.md. **Verify:** offline heart un-hearts itself with an error toast on failure.

### Phase 182 — Error recovery everywhere
withLoadingAndError rollout completed across ALL fetch-render screens (grep for remaining raw awaits in render fns); every error state has Retry; global fetch-failure listener increments the error-log (Part E Phase 8). **Verify:** kill network mid-session: every open screen degrades to a retryable state, none stick.

### Phase 183 — Confirmation & undo standards
confirmDialog copy pattern ("This will X. This cannot be undone." only when true); soft-delete-with-undo-toast for the reversible deletes (posts, notes, non-finance docs) — 6-second undo window; destructive = danger button styling always. **Verify:** delete a post → undo restores; finance deletes still route to approval (never undo-style).

### Phase 184 — Form validation UX
Inline field errors on kit slots; submit disabled until required valid OR submit-attempt highlights all invalid (pick: highlight-on-attempt — friendlier); input preserved on every failure (generalize the chat fix); number/date bounds with human messages. **Verify:** submit an invalid expense: every problem visibly flagged, nothing lost.

### Phase 185 — Long-operation progress
Compute payroll, batch ID print, CSV exports, catalog import, backfills: progress affordance (n of m, or indeterminate bar + step text), cancel where safe, completion toast with summary counts. **Verify:** compute a 20-employee month: progress visible, summary accurate.

### Phase 186 — Notification UX depth
Per-type icons/colors; grouping by day (Manila); settings surface (which reminder types a user gets — reads existing toggles); dedup verified (Phase 30/66); "You're all caught up" state. **Verify:** a day's mixed notifications group and read cleanly.

### Phase 187 — Contrast & theming a11y 🔴(visual)
WCAG AA audit all three themes on the token pairs (text/bg, on-primary/primary-fill — verify 31cdbef closed the 2.90:1 finding, else fix token), badge colors, chart colors, focus ring (now --primary per Phase 52); fix failing pairs at the TOKEN level only. **Verify:** automated contrast check on the gallery page passes AA for all themes.

### Phase 188 — Screen-reader baseline
Landmarks (header/nav/main); aria-labels on every icon-only button (bottom nav, topbar, row actions — the icon-only nav from Phase 133 especially); table headers th/scope; modal aria-modal + labelledby; live-region for toasts. Not full AAA — a solid baseline. **Verify:** VoiceOver/TalkBack pass on login→dashboard→approve-one-item.

### Phase 189 — Motion & vestibular
prefers-reduced-motion honored by every animation incl. new kit spinners/skeletons/sheet transitions (extend the 5028-5053 block); no parallax/scale surprises; splash bar compliant (Part E Phase 57 verified). **Verify:** reduced-motion ON: app is calm everywhere.

### Phase 190 — A11y verification & burn-down
Keyboard-only full pass (Phase 144 scope × all screens), axe-style automated scan on the gallery + 10 screens, fix P1s, record known-limitations list. **Verify:** zero P1 a11y defects open.

---

## STAGE U9 — Verification & lock-in (Phases 191–200)

### Phase 191 — Screenshot baseline
Scripted captures (headless where pre-login/gallery allows; manual protocol for authed screens): every screen × 3 themes × 390/1440px → versioned baseline folder. Future diffs compare against it. **Verify:** baseline archive complete + indexed.

### Phase 192 — The button matrix 🔴
Execute the full wiring inventory as a live test: EVERY button/select/action clicked once per reachable role (the 888-element inventory from the audit is the checklist, grouped by screen); log result (worked / wrong / dead); fix or file every non-green. This is the owner's "recheck all buttons" — done literally. **Verify:** 100% of inventory rows marked green.

### Phase 193 — The linkage matrix + deep-link rollout
Every nav entry → expected screen per role (route table as checklist); every hash deep-link; roll out setSubroute/initialSubtab to the ~11 unwired tabbed screens (Marketing, Design, IT, Production, Purchasing, Brilliant Steel incl. the dropped subtab arg at app.js:3747, Gov, Company, Inventory, Files, Approvals, Analytics); Back/refresh preserves tab everywhere. **Verify:** refresh any subtab: you stay there; matrix 100% green.

### Phase 194 — Copy proofread
Full-text pass over labels/empty states/toasts/dialogs/help against UI-GLOSSARY: grammar, tone, PH-English consistency, no leftover dev-speak; one terminology grep suite becomes a CI warn job. **Verify:** glossary-violation grep clean.

### Phase 195 — Cross-theme certification
Light/Dark/Astral full sweep post-everything (the Stage U5-U7 passes verified per-screen; this is the integrated pass): theme switch live on each screen, Astral budget re-verified (backdrop-filter count), print from each theme. **Verify:** zero theme-specific defects open.

### Phase 196 — Cross-device certification
Re-run Phases 140 + 150 matrices end-to-end post-all-changes on real devices (staff-typical Android, iPhone, tablet, office laptop); gesture matrix (136) re-run. **Verify:** certified matrix archived in QA-CHECKLIST.md.

### Phase 197 — Performance re-verification
Lighthouse + traces vs the Part E Phase 91 baseline after the entire UI program: boot, dashboard TTI, biggest tables, chat; confirm the kit (skeletons, keyed renders, content-visibility) net-improved; fix top-3 regressions if any. **Verify:** ≥ parity with Phase 91 baseline on the Android device.

### Phase 198 — UI decision register clearance
Walk the UI decisions with Neil: D-U1 action bar vs FAB, D-U2 bottom-nav labels, D-U3 orientation, rounding display rule (with D4/D5), density defaults, master-detail rollouts, undo windows — implement stragglers, date any deferrals. **Verify:** register fully ruled.

### Phase 199 — UI-STANDARDS.md
Codify the whole system: component kit API, formatting helpers (fmtPeso/fmtDateM rules), status-meta registry, toast/confirm/undo rules, linkage rules (router-only navigation, Overlay contract, deep-link requirements), device budgets (touch targets, breakpoints, motion), the CI guard suite (wiring, emoji, glossary, dead-CSS, contrast). New-screen checklist = one page. CLAUDE.md points to it. **Verify:** a new screen built by the checklist passes all gates first try.

### Phase 200 — Final sign-off: unified, true, reliable
Execute QA-CHECKLIST end-to-end (system + UI programs); re-run the three matrices (button/linkage/device) summary sheets; Neil walks the app on his phone + laptop against the Part B + Part G registers — every C/H/U-C/U-H item demonstrably closed or explicitly deferred-with-date; declare the v13 program complete; leftovers seed v14 (with Part E Phase 100). **Verify:** sign-off recorded in ROADMAP.md session log.

---

# Consolidated close

- **Phases 1–100 (Part E):** system program — data safety, live money, security, architecture, design system, features, accounting, launch.
- **Phases 101–200 (Part H):** UI/UX program — linkage truth, one design language, component kit, phone + laptop optimization, three screen-by-screen unification passes, reliability/a11y depth, and literal verification of every button, display, and linkage.
- Execution rhythm per Part F3; UI decision register in Phases 198 + F2. Both programs share Stage 0's safety net as the common prerequisite.

— End of report. 200 phases. —
