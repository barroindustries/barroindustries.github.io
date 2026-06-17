# Barro Industries Ops System — Roadmap & Handoff

_Last updated: 2026-06-17 — current version **v9.4.49+**, cache `bi-ops-v33+` (auto-bumped on commit)._
This file is the running source of truth for what's done and what's left to make the app
"fully functional to run the company remotely." Update it as work lands.

---

## ✅ DONE

### V10 — Partner & Sales portal launch hardening (this push)
- **Removed BK Packages** from Sales (subtab, quick-launch tool, and the package presets in the quote scope dropdown → replaced with One-Stop-Shop / Supply & Install / Supply Only / Fabrication Only / Custom).
- **Baking category added** (9 categories now: cooking, prep & washing, refrigeration, **baking**, exhaust, fresh air, gas line, fire suppression, miscellaneous). 12 new SS304-specced baking products (BA-001…012) with size constants (rateW100/D100/H100), configurable spec options (gauge, tiers, drainboards…), `material` blocks (SS304 grade/gauge/finish), labor hours and lead times.
- **Catalog → Firestore made additive.** New "⟳ Import new from catalog" button on the Product Database page adds any catalog items NOT already in Firestore (e.g. the Baking line) and merges new categories, **without** overwriting President edits. Seeder + import share one `catalogDocFromJson()` mapper that now carries specs/material/labor/leadtime/formula.
- **Quote builder reads the rich fields from Firestore** (`specs`, `material`, `laborHours`, `leadTime`) — previously `specs` was hardcoded `[]`, so configurable options were lost. Baking tab added to the (hardcoded) category bar. Verified end-to-end: tab filters to 12 items, calc panel + size scaling + spec adders all render.
- **Partner quote builder is Brilliant-Steel-only, no admin.** `?portal=partner` (set automatically for partner / Brilliant-only users) locks the company to Brilliant Steel, hides the company switcher, and removes the **Admin** (database) view and **Agent Copy** button. Internal cost view is kept (partner needs it for the 50/50).
- **One-Stop-Shop branding** on Barro Kitchens quotes (print header subtitle: "Commercial Kitchen One-Stop-Shop • Design · Fabricate · Install").
- **Print layout** — repeating column headers across pages (`thead{display:table-header-group}`) and no row/category-group splits (`page-break-inside:avoid`) for easier multi-page reading.
- **Partner portal clarity** — added a 3-step "How your Brilliant Steel partner portal works" explainer on the partner dashboard (Build → Submit → Earn 50%), explicitly framing them as a **profit-sharing partner, not a commission agent**.
- All V10 changes touch only already-ruled collections (`products`, `productMeta`) — no Firestore rules change needed.

### Production department (new, post-V10)
- New **Production** department (config + nav + router) with subtabs **Orders · Materials · Tasks · Files**.
- **Orders** — shop-floor work-order pipeline on a new `production_orders` collection. Stages: Queued → Cutting → Welding/Fab → Assembly → Finishing → QC → Ready → Delivered. KPI row (active / due ≤7d / overdue / delivered), orders grouped by stage with one-tap **Advance →**, priority + due-date flags, auto order numbers (PO-YYMM-###), linked-quote + team fields. Full create/edit/delete modal.
- **Materials** — reads `inventory_items` (raw materials), low-stock highlights, deep-link to full Inventory.
- **Tasks** — Production-dept task board (`renderDeptTasks`). **Files** — Production file collection.
- Firestore rule for `production_orders` added (internal staff read/write, partners excluded, admin-only delete) and **deployed**. Verified end-to-end in the running app (render, KPIs, empty state, New Order modal).

### Quote-file visibility — one-way partner↔sales (post-V10)
- **Rules:** `bs_quotes` (partner) now readable by any internal/non-partner staffer (partners still see only their own); `bk_quotes` (Barro Kitchens / internal sales) explicitly excludes partners (creator-or-admin only). So **partner quotes are visible to Sales, but Sales quotes are NOT visible to partners.** Deployed.
- **UI:** new read-only **Partner Quotes** subtab in the Sales portal (stat cards + list of Brilliant Steel quotes) so Sales staff can actually see them.
- The two quote "files" are the existing separate collections `bs_quotes` (partner) and `bk_quotes` (sales).

### Internal control — cost & margin synced to DB (post-V10)
- The builder's **Internal** view gained a **Cost & Margin** panel: Materials cost + Labor (estimated table, with the per-product labor capital shown as a fallback and explicitly *not* double-counted) → **COGS**, vs the ex-VAT quoted price → **Gross Margin (₱ + %)**, colour-coded.
- Materials/labor figures pull from each product's `capitalMaterials` / `capitalLabor` **in the database** (editable on the President's Product Database page); line items now carry these values, and the V10 Firestore mapping fix means `laborHours` (for the labor auto-estimate) also flows from the DB. Verified end-to-end (BA-001 ×2: materials ₱12k, labor est ₱3.1k, COGS ₱15.1k, sell ₱32k, margin ₱16.9k / 53%).
### Bill-of-Materials → Inventory price sync (post-V10)
- The President's Product Database editor gained a **🧮 BOM** button beside Capital—Materials. It opens a modal listing **raw materials from `inventory_items`** with their live unit prices; enter qty-per-unit and it computes the material cost (Σ qty × unit price), writes it into the Materials-capital field, and stores the `bom` array on the product.
- **Synced:** re-opening + re-applying the BOM re-prices against current Inventory unit costs — so a steel-price change in Inventory flows into the product's material cost (and therefore the Internal Cost & Margin panel). Verified end-to-end (2×₱3,500 sheet + 4×₱850 tube = ₱10,400 → auto-filled).
- _Future polish:_ auto-recompute all products' `capitalMaterials` on an inventory price change (batch), rather than per-product re-apply.

### High-priority "run remotely" gaps — CLOSED (post-V10, ultracode pass)
Designed via a fan-out spec workflow, then implemented + adversarially reviewed (5 findings, all fixed) before deploy.
- **Per-role dashboards.** `renderManagerDashboard` (team attendance present/half/not-in derived from `fullTime`/`attendanceScore`/`loginTime`, dept task health, dept pending) + `renderFinanceDashboard` (MTD income/expense/net from ledger, payroll summary, expense-by-category bars, pending payables, low stock). The dispatch already routed manager→/finance→ but the fns were undefined (live "Dashboard error" bug) — now defined. No new collections.
- **Audit log.** `window.logAudit(action,entity,id,details)` (config.js, fire-and-forget) instrumented at ~12 sensitive mutation sites (payroll ×4, product save/delete, inventory save/delete, stock movement, production order save/delete, expense, password reset, leave approve/reject). President-only `renderAuditLog` viewer (filterable). Rule: **forgery-proof** — create requires `actorUid==auth.uid && actorRole==getRole() && ts==request.time` + `keys().hasOnly([...])`; immutable (`update:false`); president may prune (`delete: isPresident`).
- **Leave management.** `leave_requests` + `leave_balances/{uid}` collections. Employee "My Leave" (balance KPIs, request modal: 4 types, working-day calc excl. Sundays, client balance check) + finance/admin approve/reject (decrements balance, notifies). Rules: create shape-validated (`days` 1–366, `userName` string); **only finance/admin update** (employees can't tamper post-approval); president deletes. Balances in their own collection so finance writes them without broad `users` write.
- All three deployed (`firestore.rules`) and verified in the running app (stubbed Firestore for the auth-gated paths). Sidebar: Leave (all roles), Audit Log (president, Security section).

### Low-stock daily digest (post-V10)
- `Notifs.checkLowStock(uid, role)` — admins (president/manager/finance) get **one batched notification per day** listing items at/below reorder level (deduped by `lowstock-{uid}-{date}`, matching the owner's batch/daily preference). Fires on app load alongside `checkDeadlines`/`checkAttendanceReminder`; links to Inventory. Verified (2-low-item digest, well-stocked excluded, non-admins skipped). _Note: client-triggered (fires when an admin opens the app); a scheduled Cloud Function would make it time-of-day guaranteed — deferred._


### Critical fixes (production was broken at launch)
- **Dashboard crash** — TDZ `ReferenceError` in `renderPresidentDashboard` (president + manager saw "Dashboard error"). Fixed.
- **Messaging** — task/submission `comments` + `readers` subcollections had no Firestore rule (v10 deploy denied them). Added rules.
- **7 launch regressions** from the v10 rules-hardening, all fixed + verified:
  Files (all tabs, `files_*`), Client CRM (`sales_clients`/`design_clients`), Budgeting (`budgets_*`),
  Finance Overview (unguarded `expenses` query), BK quote save (unfiltered count query), IT Access/Network
  subtabs (admin-only data shown to non-admins), Budgeting ledger spend.

### Security (all verified)
- **🔴 Plaintext passwords removed** — `hrPwToken` stored `btoa(password)` on the world-readable users doc.
  Replaced with a callable Cloud Function `adminResetPassword` (Admin SDK, role-checked); no password is
  ever stored. Existing tokens purged. (`functions/index.js`)
- **🔴 Pay moved off the users doc** — `salary/allowance/deductions/sss/philhealth/pagibig/tax` were
  world-readable. Moved to a protected `payroll/{uid}` collection (read: owner or finance/admin; write:
  finance/admin). Reads go through `window.fetchUsersWithPayroll()` (merged into the `users` cache);
  writes redirected; data migrated; users-doc fields removed. See memory `payroll-collection-architecture`.
- **XSS pass** — ~290 user-controlled `innerHTML` interpolations escaped with `escHtml()` across all 4 JS
  files (context-correct; no JS-handler breakage; modal titles use textContent so left raw).

### Features shipped
- **SOPs editable in-app** — moved from hardcoded array to a `sops` collection; president/manager ✎ edit + "Add SOP".
- **Finance → Reports** — income statement (income/expense by category, net income) from the ledger, This Month / YTD / All Time, VAT/BIR reference, print.
- **Files folders + Archive** — folder organization + autocomplete + archive/restore across every Files tab.
- **Inventory module** (new) — raw materials + finished goods, on-hand qty, reorder-level alerts, unit cost,
  stock value, suppliers, stock in/out log, and finance-only **job costing** (revenue vs materials/labor/other = margin).
  Collections: `inventory_items`, `stock_movements`, `job_costs`.
- **Quote builder full-screen** — full viewport, floating Close, app chrome bypassed.
- **Command Center oversight** — president dashboard now surfaces **Net Income (MTD)** and **Low Stock** (tap-through).

### Polish / hygiene
- Mobile audit (23 pages, no layout breakage); fixed currency-KPI clipping (`.kpi-value` responsive clamp) and small tap targets.
- Repo hygiene — untracked `node_modules` + `.DS_Store` (−5,544 files; already gitignored).

---

## 🔜 NOT YET DONE (prioritized roadmap)

### High priority — closes real "run remotely" gaps
1. **Per-role dashboards.** Managers reuse the president dashboard; finance/agents reuse the employee one.
   Build a **Manager dashboard** (team attendance summary, dept pending approvals, dept task health) and a
   **Finance dashboard** (payroll calendar, expense-by-category, AR/AP at a glance).
2. **Leave management.** No vacation/sick-leave requests or balances. Add a `leave_requests` collection +
   approval flow + balance tracking; surface on attendance/HR.
3. **Audit log.** No who-changed-what trail on sensitive data (payroll, finance, inventory). Add an
   `audit_log` (append-only) written on key mutations — important for remote accountability.
4. **Sales ↔ inventory ↔ costing integration.** When a quote is **accepted**, auto-create a `job_costs`
   entry; optionally a BOM that deducts `inventory_items` when a job is fulfilled. Today they're separate.
   ⚠️ **Permission constraint to design around first:** `job_costs` read is finance/admin-only (margins),
   and `bk_quotes` read is creator-or-admin only — so a *sales* user accepting a quote can neither read
   `job_costs` (to dedup) nor would finance be able to read `bk_quotes` (to import). Cleanest path: split
   `job_costs` rules (`create: non-partner`, `read/update/delete: finance/admin`) and write the entry keyed
   by the quote id with `merge:true` (idempotent, preserves finance-entered costs), OR trigger it from a
   Cloud Function on the bk_quotes status change (server-side, no client read friction). Not rushed
   post-launch to avoid a hasty rules change.
5. ✅ **Low-stock + key-event push.** DONE — `Notifs.checkLowStock` daily digest (see DONE section).

### Medium priority
6. **Accounting depth.** Current Reports is a category-based P&L + VAT *estimate*. For real filing add a
   chart of accounts, balance sheet, cash-flow, bank reconciliation, and BIR form generation (2550M/Q, 1601C, alphalist).
7. **CRM lifecycle.** Client list is flat. Add lead→prospect→won/lost stages, follow-up reminders, and a
   per-client history timeline (quotes, deals, files).
8. **HR depth.** 201 file / employee documents per person, onboarding checklist, structured performance-review cycle (KPI data exists but no review workflow).
9. **Government Biddings.** PhilGEPS structured entry/import, per-bid document checklist, deadline reminders.
10. **Exports.** CSV/PDF export across payroll, inventory, and finance reports; optional scheduled email digest to the president.
11. **Global search.** Across tasks, clients, files, inventory.

### Nice-to-have / hardening
12. **Notification fan-out → Cloud Function** (reliability for >100 staff; deferred — low value at current size, adds cost).
13. **Files "Download all as zip"** (deferred per owner; needs JSZip).
14. **Marketing/Design modules** are still generic doc collections — add dept-specific KPIs/content.
15. **Field ops** — photo capture for deliveries/site visits; GPS-stamped attendance (anti-spoof).
16. **Client-side error logging** to Firestore for remote debugging/monitoring.
17. **Performance at scale** — dashboards do several full-collection `.get()`s; add pagination + composite
    indexes as data grows. Verify the monthly backup GitHub Action actually runs; document restore.
18. **Production role** — inventory write is currently "any non-partner." Consider a dedicated Production
    role and tighter inventory/item-definition vs. stock-movement permissions.

---

## ⚙️ Key rules / gotchas (read before editing)
- **Bump is automatic** — the pre-commit hook bumps `APP_VERSION` (config.js) + `CACHE_VER` (sw.js). Don't hand-edit.
- **Firestore rules don't cascade** to subcollections and don't match by name prefix. Enumerate every
  collection (incl. `comments`/`readers`, `files_*`, `budgets_*`, `*_clients`, `inventory_*`, `payroll`)
  before deploying rules. Unconstrained `.get()` on owner/admin-restricted collections fails for non-admins.
  (See memory `firestore-rules-collection-coverage`.)
- **Pay lives in `payroll/{uid}`**, NOT users. Read via `fetchUsersWithPayroll()`; write to `payroll` (finance/admin). (memory `payroll-collection-architecture`)
- **Manila time** — use `bizDate()/bizHour()/bizDow()`; never raw `toISOString()`/`getDay()`. (memory `manila-time-helpers`)
- **Always `escHtml()`** user content before `innerHTML` (helper in modules.js).
- **Rules propagation** takes ~10–60s after `firebase deploy --only firestore:rules` — a denied write right
  after deploy is usually just propagation, not a bug.
- **Deploy** — `git push origin master` (GitHub Pages); rules: `npx firebase-tools deploy --only firestore:rules`; functions: `cd functions && npm run deploy`.
