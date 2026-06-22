# Barro Industries Ops System — Roadmap & Handoff

_Last updated: 2026-06-23 — current version **v11.0.1**, cache `bi-ops-v73`._

### v10.0.0 UI/UX fix pass (done)
- Quote builder topbar **unstuck** (scrolls away, not fixed); mobile verified (no page horizontal scroll; only the data table scrolls within its wrapper); desktop untouched.
- **Quote filing SOP:** filed BK quotes now route to `bk_quotes` (were always going to `bs_quotes` → invisible in Sales→Quotations); re-file saves a new **version "(2)"**; filing **auto-extracts the client** into sales_clients/bs_clients. (Approval round-trip stays in bs_quotes for the president handler.)
- **Notifications:** task-edit notifications now say *what* changed (due date→X, status→Y, priority, dept, assignees); fixed the **doubled icon** in the inbox (leading emoji stripped from title since the icon column shows it).
- **Activity/presence:** ping `lastSeen` on visibilitychange/focus (browsers throttle background-tab timers); Team view reads presence with a short TTL.
- **Task chat:** bubble `max-width:100%`+overflow-wrap so long messages can't force horizontal scroll.
- **Dashboard calendar:** month nav, due-task event dots, click-a-day to see/open tasks.
- **Themes:** added **Midnight** (deep-navy dark). Splash logo confirmed circular.
- Version stepped to **v10.0.0** (major milestone).

_Old header: v9.4.49+, cache bi-ops-v33+._
This file is the running source of truth for what's done and what's left to make the app
"fully functional to run the company remotely." Update it as work lands.

---

## ✅ DONE

### V11 — Security hardening + efficiency pass (this push, ultracode)
Orchestrated per-file (12 files, each diff adversarially verified); 3 blockers caught + fixed before deploy. App boot re-verified in the live preview (no console errors, all globals intact, Partner portal renders, dark default theme).
**⚠️ Backend NOT live until `firebase deploy` is run** — `git push` ships only the frontend. Run `npx firebase-tools deploy --only firestore,storage` (rules + indexes + storage.rules) and `npx firebase-tools deploy --only functions`.

**Security**
- **`storage.rules` added** (new file) + wired into `firebase.json` — closes the open/test-mode Cloud Storage bucket. Auth required everywhere, owner-scoped `profile-photos/{uid}` writes, 15/25 MB size caps, deny-by-default catch-all. ⚠️ **Residual:** the general `{dept}/{subfolder}/{file}` path is auth-only (Storage rules can't read Firestore roles), so a signed-in partner can still read payslip transfer proofs — closing that needs **custom claims** (tracked follow-up; see gotchas).
- **`firestore.rules`** — notification-inbox `create` constrained (anti-spoof/anti-spam: `hasOnly` allow-list incl. `taskId`, `read==false`, `createdAt==request.time`, title/body length caps); **null-safe `getRole()`** (`.data.get('role',null)` — no more deny-on-missing-field, per `firestore-rules-missing-field-throws`); **conservative partner read-lockdown** (`attendance_extensions`, `approval_requests`, `gov_biddings`, `sales_clients`, `design_clients`) — `bs_*` / `users` / `products` / `tasks` deliberately left readable so partner login/collaboration keeps working.
- **`partner_deals` composite index** (`partnerUid` + `createdAt`) — fixes the silently-empty partner earnings dashboard.
- **Cloud Function** clamps/validates the push payload (title/body/type length, drops malformed docs).
- **Manila-time sweep** — replaced raw `toISOString()`/`getDay()`/`getMonth()` business-day logic with `bizDate()/bizDow()/bizYear()` across app/departments/modules; **fixes the payslip pay-period + attendance UTC-date bug** (was wrong for the first 8 h of each Manila day).
- **Money safety** — cash-advance approve/pay and Design payment+invoice now run inside **Firestore transactions** with a `status==='pending'` re-read guard + amount confirmations (no double-approve / double-pay / orphaned invoice). Attendance "absent" now **soft-archives** (status flag) instead of deleting — preserves the audit trail payroll depends on.
- **XSS** — Posts `imageUrl` moved off the inline `onclick` (http(s) allow-list + `addEventListener` + `escHtml`); IT ticket title escaped.

**Efficiency**
- **Service worker** — JS/CSS switched from stale-while-revalidate to **network-first**, so a `CACHE_VER` bump now lands on the *first* reload instead of the second; PRECACHE aligned to the real shell assets (`bi-logo.svg`, `favicon.png`).
- **Dashboard reads cached** — `ledger`, `inventory_items`, and the pending-count badges (`approvals`/`ca`/`att-ext`/`signups`) now route through `dbCachedGet`; the `users` TTL was standardized; **cache invalidation wired on writes** (incl. the approvals / CA / attendance handlers, so badges don't keep showing actioned items for ~30 s).
- **Auth-callback boot guard** — a token refresh no longer re-runs the full bootstrap and bounces the user back to the dashboard mid-task.

**Workflows / UX**
- **Government Biddings lifecycle** — was add-only; cards now open a detail/edit modal with field edits, **status change, bucket move** (PhilGEPS ↔ Active Bids ↔ Archive), and delete-with-confirm (gated by `canEditDept`). Backward-compatible — other `renderDocCollection` users unchanged.
- **IT dead controls wired** — Software edit button (was inert), Network notes edit/delete (was add-only, so a typo'd credential was permanent).
- **`partner` added to `ROLES`** (was undefined → blank badges); president identified by **role, not hardcoded email**.
- **Dark default theme** (was light "Office", clashing with the dark splash/login/PWA chrome); **theme-aware toasts** with a green success state; **numeric keypads** (`inputmode`) on amount inputs; **a11y** — aria-labels on icon buttons, `aria-current` on active nav, `:focus-visible` rings, `prefers-reduced-motion`.

**Decision:** tasks kept **admin-gated** (not broadened to `canEditDept`) to match the Firestore tasks `update` rule (assignee-or-admin) — avoids surfacing edit/reassign buttons the backend would reject.
**Deferred:** CSS de-duplication (duplicate `.bottom-nav` / `.modal-box` blocks) — pure maintainability, high regression risk.

### V10 — Partner & Sales portal launch hardening (V10 push)
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
9. **Government Biddings.** ✅ In-app lifecycle shipped in V11 (detail/edit modal, status change, bucket move PhilGEPS↔Active↔Archive, delete). _Remaining:_ PhilGEPS structured entry/import, per-bid document checklist, deadline reminders.
10. ✅ **Exports.** DONE — `window.exportCSV` (config.js; dependency-free, quote/comma/newline escaping, UTF-8 BOM, CSV-formula-injection guard that preserves numbers) + 10 "⬇ CSV" buttons: team/payroll, inventory, stock movements, job costs, ledger, expenses, audit log, leave, production orders, dept tasks. PDF stays on the existing print() paths (payslips, income statement, quotes). _Remaining: optional scheduled email digest._
11. ✅ **Global search.** DONE — `renderGlobalSearch` page + topbar magnifier + sidebar item across tasks, clients (sales/design/bs), inventory, products, quotes; grouped clickable results, 220ms debounce, top-8/group. **Internal-only** — partners / Brilliant-Steel-only are gated out (UI hidden + early-return), since clients/products are partner-readable at the rules level. (Files search not included — files live in per-tab `files_*` collections; could be added.)

### Nice-to-have / hardening
12. **Notification fan-out → Cloud Function** (reliability for >100 staff; deferred — low value at current size, adds cost).
13. **Files "Download all as zip"** (deferred per owner; needs JSZip).
14. **Marketing/Design modules** are still generic doc collections — add dept-specific KPIs/content.
15. **Field ops** — photo capture for deliveries/site visits; GPS-stamped attendance (anti-spoof).
16. **Client-side error logging** to Firestore for remote debugging/monitoring.
17. **Performance at scale** — V11 cached the heavy dashboard reads (`ledger`/`inventory`/pending badges via
    `dbCachedGet`, with write-invalidation) + switched the SW to network-first + added the `partner_deals`
    index. _Remaining:_ pagination on the big collections as data grows; verify the monthly backup GitHub
    Action actually runs; document restore.
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
- **Cloud Storage rules can't read Firestore** (no role lookup). `storage.rules` (added V11) is auth + owner-scoped + size-capped only; true role/dept scoping of sensitive files (payslip transfer proofs, receipts) needs **custom claims** on the auth token. Residual gap after V11 — tracked follow-up.
- **Storage deploys separately** — `storage.rules` ships via `firebase deploy --only storage` (now wired in `firebase.json`), NOT on `git push`. Same for `firestore.rules`/indexes (`--only firestore`) and `functions`.
- **Manila time** — use `bizDate()/bizHour()/bizDow()`; never raw `toISOString()`/`getDay()`. (memory `manila-time-helpers`)
- **Always `escHtml()`** user content before `innerHTML` (helper in modules.js).
- **Rules propagation** takes ~10–60s after `firebase deploy --only firestore:rules` — a denied write right
  after deploy is usually just propagation, not a bug.
- **Deploy** — `git push origin master` (GitHub Pages); rules: `npx firebase-tools deploy --only firestore:rules`; functions: `cd functions && npm run deploy`.
