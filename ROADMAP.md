# Barro Industries Ops System — Roadmap & Handoff

_Last updated: 2026-06-17 — current version **v9.4.48**, cache `bi-ops-v32`._
This file is the running source of truth for what's done and what's left to make the app
"fully functional to run the company remotely." Update it as work lands.

---

## ✅ DONE

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
5. **Low-stock + key-event push.** Inventory reorder is visual-only; send a push to admins when stock hits
   reorder level. (Note owner's cost preference — batch/daily digest, not per-event.)

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
