# Inventory Department — Implementation Spec (2026-08-31)

**Author:** Fable (design pass) · **Implementer:** Sonnet subagent, following this spec exactly.
**Owner request (Neil, 2026-08-31):** "there should be inventory — where raw materials can be found, etc; finished product database (pricing); raw material database (pricing); adjust other departments to this new change, remove redundancies."

Escalate ambiguities back to the coordinator instead of improvising. Every file:line anchor below was verified on 2026-08-31 but this tree is edited live — **re-verify each anchor by reading before editing.**

---

## 0. Design summary

Inventory already exists in pieces: a stock ledger (`inventory_items`, kinds `material|product`) with a movements audit trail (`stock_movements`) buried under Production's tabs; a raw-material price database (`material_prices`, Kingsway 2025) under Purchasing → Price List; and a finished-product catalog (`products` + `productMeta`, selling prices) with a President-only editor. This change **promotes Inventory to a first-class department** and makes it the single home of the databases:

| New Inventory tab | Source | What changes |
|---|---|---|
| **Stock** | `renderInventory` Stock view moved out of `js/modules.js` | + new `location` field ("where it's stored") |
| **Raw Materials** | `window.renderMaterialPriceList` (stays in departments.js, called from here) | + supplier line shown ("where to buy"); secretary edit-predicate fix |
| **Finished Products** | NEW read-only browse of `products` catalog with prices | President gets "Open editor →" to existing `product-database` screen |
| **Movements** | moved from modules.js | unchanged |
| **Count Form** | moved from `js/screens/production.js` | unchanged behavior, same localStorage draft key |
| **Job Costing** | moved from modules.js (finance-tier only) | unchanged |

Redundancies removed: Production drops **Materials / Inventory / Count Form** tabs (8 → 5); Purchasing drops **Price List** (5 → 4). Both get a one-button link to the new department instead. The wide-open `inventory_items`/`stock_movements` write rules are tightened to the roles/depts that actually touch stock.

**No new Firestore collections. No new composite indexes. No money-core changes.**

---

## 1. New file: `js/screens/inventory.js`

Create with a LOAD-ORDER CONTRACT header comment (template: `js/screens/crm.js:14-34`). Contents:

### 1.1 Entry point
```
window.renderInventoryDept = async function (currentUser, currentRole, subtab = window.initialSubtab('Stock'))
```
- Early-return guard: if `window.isExternalPartnerUser?.(...)` / `currentRole === 'partner'` → render nothing (partners must never see costs/suppliers).
- Tabs: `['Stock','Raw Materials','Finished Products','Movements','Count Form']`, plus `'Job Costing'` appended when role ∈ president/manager/finance (same predicate the old module used at `js/modules.js:70,75`).
- Skeleton shape: copy the CRM pattern (`js/screens/crm.js:37-62`) — `deptContainer()`, page-header with `emojiIcon('📦',20)`, `sopPanel('How Inventory works', [...])` (3–5 bullets: stock in/out with audit trail; raw-material price list feeds costing & quotes; finished-product prices are the live catalog; counts post variances), `chipTabs`, `#inv-content`, `bindChipTabs` + `setSubroute`.
- Dispatcher `loadInvContent(...)` wrapped in try/catch with a Retry button — copy the Production shape (`js/screens/production.js:2459-2477`), NOT CRM's (no error branch).

### 1.2 Write predicate — must mirror the new rules EXACTLY (§6)
```js
function invCanWrite() {
  const r = window.currentRole;
  if (r === 'partner' || r === 'secretary') return false;
  if (r === 'president' || r === 'manager' || r === 'finance') return true;
  return ['Inventory','Purchasing','Production','Finance'].some(d => canEditDept(d) === true && /* dept membership */ (window.currentDepts||[]).includes(d));
}
```
Implementation note: `canEditDept` returns true for admin roles regardless of membership — the mirror we need is: senior admin (president/manager) OR finance role OR (non-secretary member of Inventory/Purchasing/Production/Finance). Write it as a plain explicit check against `window.currentRole` + `window.currentDepts`; do not route through `canEditDept` alone (see the cautionary comment at `js/screens/production.js:2480-2495` — UI predicates that are broader than rules ship dead controls).
- **Delete item** buttons: president/manager only (rules make delete `isSeniorAdmin()`).

### 1.3 Stock tab — move from `js/modules.js`
Move the Inventory IIFE internals (`js/modules.js:68-450` region: `renderStock` :95, `itemHistoryModal` :199, `itemModal` :217, `moveModal` :286, `renderMovements` :322, `renderJobs` :371, `jobModal` :413) into this file. Keep behavior identical except:
- **New field `location`** (string, free text — storage location, e.g. "Main warehouse / Rack B"): add input to `itemModal` (near supplier fields, `js/modules.js:232-233`), save it (`:254`), show a Location column in the stock list (`:157` region), include in the search filter (`:136`) and CSV export (`:191`). Absent field renders as `—`. No rules change needed for a field.
- Gate all mutating controls (Add/Edit/Delete/± buttons) on `invCanWrite()`; delete on president/manager.
- Keep `dbCachedGet('inventory_items', ..., 45000)` keys and `dbCacheInvalidate('inventory_items')` calls exactly as they are (choke-point invalidation contract from PERF-WAVE1).
- Do **not** keep a `window.renderInventory` shim; instead grep the whole repo for `renderInventory` callers and update them all (known: `js/screens/production.js` Inventory tab — being deleted; `js/app.js` `case 'inventory'` — §4). If any other caller turns up, escalate.

### 1.4 Raw Materials tab
Body = `await window.renderMaterialPriceList(contentEl)` — that function stays in `js/departments.js:5766` (eager-loaded core, always available; do NOT move the 350-line block). See §5 for the two small changes inside it.

### 1.5 Finished Products tab — NEW renderer `renderFinishedProducts(contentEl)`
- Data: `dbCachedGet('products-catalog', () => db.collection('products').limit(1000).get(), 45000)` + `dbCachedGet('product-meta', () => db.collection('productMeta').doc('config').get(), 300000)`, both `.catch(...)` soft-fail with `renderEmptyState`. (`products` read rule is `isAuth()` — every internal role can read; partners never reach this screen per §1.1 guard.)
- Columns/cards: photo thumb (`photoUrl`, fallback icon), Name (`title || name`), Category (label from `productMeta.categories`, fallback raw), Unit, **Base Price** (`fmt(basePrice ?? baseRate)`), Lead Time. Search box (name/category/notes) + category chips (from productMeta, with counts) + cap at 150 rows with "Show all N" (`js/screens/production.js:2534-2541` pattern).
- **Never fetch or display `product_costs`** — cost basis stays out of this screen entirely.
- Header note: "Live catalog — selling prices. Edited by the President." When `currentRole === 'president'`: button `Open editor →` → `navigateTo('product-database')`.
- Optional linkage (small): in the Stock tab's `itemModal`, when `kind === 'product'`, show a datalist of catalog names (from the same cached `products` read, soft-fail to nothing) to prefill `name` — a light bridge between free-typed finished-goods stock and the catalog. Store nothing new; name prefill only. If this bloats the modal, skip it and note it as skipped.

### 1.6 Count Form tab — move from `js/screens/production.js`
Move verbatim: `PROD_COUNT_DRAFT_KEY` + draft helpers (production.js:3334-3346), `renderProdInventoryForm` (:3348, rename `renderCountForm`), `openInventoryCountForm` (:3520). Keep:
- the localStorage draft key string `'bi-prod-count-draft-'` **unchanged** (drafts survive the move),
- the post-variances gate `['president','manager','finance']` (:3370) unchanged,
- the deterministic `CNT_<formNo>_<itemId>` movement ids and full-items-list posting subtlety (:3463 comment) unchanged,
- letterhead print via `window.buildLetterhead`/`openPrintableDoc` (js/letterhead.js — listed in PAGE_SCRIPTS §3).

### 1.7 Movements + Job Costing tabs
Moved `renderMovements` / `renderJobs` + `jobModal` as-is. Job Costing stays finance-tier gated in UI (rules already `isMoneyAdmin()` at firestore.rules:3586).

---

## 2. `js/modules.js` — remove the moved code

Delete the Inventory IIFE block (approx `js/modules.js:68-450` — read first, cut exactly the IIFE). Grep modules.js afterward for any internal references to the deleted names (`renderStock`, `itemModal`, `moveModal`, `renderMovements`, `renderJobs`, `jobModal`, `renderInventory`, `itemHistoryModal`) — there must be none. modules.js is eager-loaded; this shrinks the boot bundle.

---

## 3. `js/config.js` — department + lazy-load wiring

1. **DEPARTMENTS** (`js/config.js:215-316`): insert a new key **immediately after `'Production'`** (literal key order = display order; navOrder is fractional per the precedent at :293-300):
```js
'Inventory': { icon: '📦', lucideIcon: 'package', color: '#f59f00', navOrder: 9.5,
               subtabs: ['Stock','Raw Materials','Finished Products','Movements','Count Form'] },
```
(Verify `lucide` 0.468.0 has `package` — it does; if the implementer finds otherwise use `boxes`.)
2. **LUCIDE_EMOJI_MAP** (`:403-424`): add `'📦': 'package'` if not present.
3. **Production subtabs** (`:272-277`): replace with `['Orders','Job Orders','Budgeting','Tasks','Files']` (this also fixes the stale list that was missing 'Job Orders'); delete the stale `departments.js:13667` pointer comment.
4. **Purchasing subtabs** (`:278-281`): remove `'Price List'` → `['Request for Quotation','Purchase Requests','Budgeting','Tasks']`.
5. **PAGE_SCRIPTS** (`:1522-1645`, inside the `_PERF1_PAYROLL_ENGINE` → `window.ensurePage` region — ci-invariants slices exactly that region):
```js
'dept:Inventory': ['js/screens/inventory.js', 'js/letterhead.js'],
'inventory':      ['js/screens/inventory.js', 'js/letterhead.js'],   // legacy standalone route
```

---

## 4. `js/app.js` — routing

1. `renderDeptModule` switch (`js/app.js:3241-3292`): add `case 'Inventory': window.renderInventoryDept?.(currentUser, currentRole); break;`
2. Main `navigateTo` switch: find the existing `case 'inventory'` (legacy route used by old "Open full Inventory →" buttons) and point it at `window.renderInventoryDept?.(currentUser, currentRole)`.
3. `_SKELETON_KIND` (`:2669-2687`): add `'dept:Inventory': 'rows'` (and `'inventory': 'rows'` if page keys are listed individually — match the map's existing key style).
4. Cheap comment fix while in the file: `js/app.js:2413` says "153-item catalog"; the JSON holds 165 — change to "the products-database.json catalog" (count-free so it can't go stale again).

---

## 5. `js/departments.js` — Price List touch-ups (block stays here)

1. **`mplCanEdit()`** (`js/departments.js:5640`) currently includes `isAdminPriv()` → secretary, but `firestore.rules:2403` uses `isSeniorAdmin()` — a secretary gets editable cells and a denied write. Replace with an explicit mirror of the rule (`isSeniorAdmin || canFinance || isPurchasingDept`):
```js
const mplCanEdit = () => {
  const r = window.currentRole;
  if (r === 'president' || r === 'manager' || r === 'finance') return true;
  if (r === 'secretary' || r === 'partner') return false;
  return ['Purchasing','Finance'].some(d => (window.currentDepts||[]).includes(d));
};
```
2. **Show the supplier** ("where raw materials can be found — where to buy"): in `mplRenderList` (`:5784`), when a single category chip is active render a subtle line under the chips — `Supplier: <cat.supplier> · <cat.year>` (escHtml'd); on the `All` view add a `Supplier` column to the table rows (each row knows its category doc). Include `supplier` in the search haystack (`:5838-5841`).
3. Delete the stale completed-handoff wiring comment block (`:5602-5630`) — all four wiring points it describes were done; replace with one line pointing at `js/screens/inventory.js` + `js/screens/production.js:3680` as the callers.

---

## 6. `firestore.rules` — tighten inventory writes (deploy BEFORE the code push)

Replace the two blocks at `firestore.rules:3575-3584`:
```
// Inventory stock ledger. Reads stay open to all internal staff (Production
// pickers, dashboards). Writes are limited to the people who actually move
// stock: senior admins, Finance, and members of Inventory / Purchasing /
// Production. Secretary is view-only (ruling 2026-08-09 pattern). Deletes are
// senior-admin only — an item row anchors its movement history.
match /inventory_items/{docId} {
  allow read:   if isAuth() && !isPartner();
  allow create, update: if isAuth() && !isPartner() && !isSecretary()
    && (isSeniorAdmin() || canFinance() || inDept('Inventory') || isPurchasingDept() || isProductionDept());
  allow delete: if isAuth() && isSeniorAdmin();
}
// Stock movement log — append-only for the same writer set; history is never
// rewritten except by senior admins.
match /stock_movements/{docId} {
  allow read:   if isAuth() && !isPartner();
  allow create: if isAuth() && !isPartner() && !isSecretary()
    && (isSeniorAdmin() || canFinance() || inDept('Inventory') || isPurchasingDept() || isProductionDept());
  allow update, delete: if isAuth() && isSeniorAdmin();
}
```
Notes: `inDept()` already carries the secretary/Finance-IT exclusion and uses `.get(field, default)` internally — safe on docs missing `departments`. All existing write paths remain covered: Production consumption (`isProductionDept`), Purchasing receiving (`isPurchasingDept`), count-form posting (president/manager/finance), manual stock ops (Inventory dept + the same set). **Behavior change to report to Neil:** staff outside these depts (e.g. Sales, Design, Marketing employees) could previously edit stock and unit costs; now they are read-only. Secretary loses stock-movement edit rights (was `isAdmin()`).

No other rules changes. `material_prices`, `products`, `productMeta`, `product_costs`, `job_costs` rules are already correct for the new screen (Finished Products tab reads `products`, which is `isAuth()`).

---

## 7. `js/screens/production.js` — slim to 5 tabs

1. `subs` (`:2434`) → `['Orders','Job Orders','Budgeting','Tasks','Files']`; remove the `Materials`/`Inventory`/`Count Form` cases from `loadProdContent` (`:2459`); unknown/legacy subtab falls through to Orders (deep links like `#/dept/Production/Inventory` must not blank-screen).
2. Delete `renderProdMaterials` (`:3607`) and the moved Count Form code (`:3334-3346`, `:3348-3519`, `:3520-…`) — after confirming §1.6 moved them.
3. Orders tab header (near the CSV button, `:2637` region): add a link button `📦 Inventory` → `navigateTo('dept:Inventory')`.
4. Purchasing shell (`:3656-3690`): tabs array (`:3658`) minus `'Price List'`; remove its dispatch case (`:3680`); in the RFQ tab header add link button `📋 Price List` → navigate to the Inventory dept's Raw Materials subtab (use the same mechanism as other cross-subtab links in the file if one exists; otherwise `location.hash = '#/dept/Inventory/Raw Materials'` via `hashFor`/`navigateTo` — check `js/app.js:2615-2628` and follow the app's canonical pattern; landing on Stock is NOT acceptable, the button says Price List).
5. **Do not touch:** `prodOrderModal`'s `inventory_items` picker, `consumeProductionMaterials`, `receiveLineIntoItem`, `materialPriceListPOHook` call site (`:4329-4336`), QC/DR gates, labor logs.

---

## 8. `sw.js`

Add `'/js/screens/inventory.js',` to `PRECACHE` (alongside the other `js/screens/*` entries). Do not touch `CACHE_VER` or `precache-manifest.json` — hook-owned.

---

## 9. What is deliberately OUT of scope (do not do)

- No supplier master collection (supplier stays free text; surfacing it is enough for now).
- No `productId` FK migration for finished-goods stock (name-prefill datalist only, §1.5, optional).
- No changes to the quote builder, `product_costs`, `material_prices` seeding, ledger, or money-core.
- No NAV_REGISTRY entries (the dept card + member sidebar deptLoop are the nav; ci-invariants check 7 exempts `dept:*` anyway). No bottom-nav entries.
- No Budgeting/Tasks/Files tabs for Inventory (declutter direction).
- No edits to `scripts/monthly-backup.js` / `check-backup-coverage.js` (no new collections).

---

## 10. Verification (implementer runs before reporting done)

1. `node --check` every edited/created JS file **including `js/screens/inventory.js`** (CI's syntax job skips `js/screens/` — run it manually).
2. `node --test tests/*.test.mjs` (money untouched — must stay green).
3. `bash scripts/ci-invariants.sh` (PRECACHE ↔ PAGE_SCRIPTS check 2b will catch missed wiring; note: manifest check 8 compares HEAD and only settles at commit time — a pre-commit mismatch on *uncommitted* files is expected, everything else must pass).
4. `node scripts/check-ui-wiring.js` and `node scripts/check-backup-coverage.js`.
5. Grep sweeps — all must return zero live callers: `renderInventory\b` (outside inventory.js), `renderProdMaterials`, `renderProdInventoryForm`, `openInventoryCountForm` (outside inventory.js), `'Price List'` in production.js, `'Count Form'` in production.js.
6. Report honestly what was verified headlessly vs. what needs a logged-in click-through.

**Do NOT commit, push, or deploy** — the coordinator reviews the diff, deploys rules first, then commits. Never run `git stash`/`reset --hard`/`checkout --`/`clean` (live shared tree).
