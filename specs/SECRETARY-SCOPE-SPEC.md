# Corporate Secretary — scoped out of Finance and IT

Owner request, verbatim:
> "corporate secretary can access all departments except finance, and IT"

Owner rulings, 2026-08-08:
1. **Money requests stay VISIBLE, read-only.** She keeps seeing cash advances,
   salary raises and payroll-delete requests in Approvals so she can flag them to
   the President — the workflow already designed for her. Costs three read-only
   permissions.
2. **HR stays open.** She keeps People & Roles, attendance, leave approval, ID
   cards, holidays and work sites; she loses payroll, payslips, worker pay rates,
   expenses, the ledger and taxes.
3. **The role decision always wins.** If her profile is ever given the Finance or
   IT department, that must NOT hand the access back.

---

## The root finding — the obvious fix would have deleted the role

`isFinanceOrAdmin()` (firestore.rules:22) is **one name for two unrelated tiers**.
42 real call sites: only **17 are finance**. The other **25** are attendance,
tasks, leave, holidays, KPI, strategy notes, system health and ID-minting — the
secretary's actual job.

So deleting `'secretary'` from that helper does not scope the role, it **deletes**
it. Two of those 25 matter most: `tasks` update is the only non-assignee update
clause (no `isAdmin()` fallback), and `leave_requests` update IS the
approve/reject verb.

Also verified: `isFinanceOrAdmin() minus secretary` == `['president','manager','finance']`
== **exactly `isMoneyAdmin()`**. So narrowing it would create a duplicate set and a
future drift hazard.

**Therefore: SPLIT, don't narrow — and DELETE rather than edit.**

- Add `isOpsAdmin()` carrying the OLD body verbatim → the 25 oversight sites.
- Repoint the 17 finance sites to the existing `isMoneyAdmin()`.
- **Delete `isFinanceOrAdmin()` entirely.** A missed call site then becomes an
  unknown function and `firebase deploy --only firestore:rules` **refuses to
  compile**. The compiler becomes the test suite for a change that has no test
  suite. After the change `grep -c "isFinanceOrAdmin(" firestore.rules` must be 0.

## This closes a defect left open by the August security work

The `/expenses` vs `/ledger` actor asymmetry is resolved **at the root**, not
patched. Source `/expenses` update allowed `isFinanceOrAdmin()`; the mirrored
`/ledger` update requires `canFinance()`. The set delta is exactly `{secretary}`.
Repointing `/expenses` update to `isMoneyAdmin()` removes the gap; no other role
sits in it.

## Three finance-write leaks that survive the obvious fix

These reach the secretary through `isAdmin()` / `canProduction()`, **not** through
`isFinanceOrAdmin()`, so splitting the helper does nothing to them.

1. **`finance_rollup` create+update** — `canFinance() || canProduction()`, and
   `canProduction()` = `isAdmin() || isProductionDept()`, so the secretary passes.
   Read is `canFinance()`. **She can rewrite any open month's reported income,
   expense, vatOutput, vatInput and byCategory — figures she cannot even read.**
   Those docs ARE the Finance Overview and dashboard KPIs. Fix: `canProduction()`
   → `isProductionDept()`.
2. **`ledger` create, Production leg** — same `canProduction()` disjunct, same fix.
   Safe for everyone else: president/manager/finance already satisfy `canFinance()`.
3. **`product_costs`** — `isAdmin() || canFinance()`; capital material/labour and
   BOM unit costs, split out of `/products` precisely because it is cost basis.
   Fix: `isAdmin()` → `isSeniorAdmin()`.

Leave `canProduction()` itself alone — `production_orders` legitimately needs it,
and Production is a department she keeps.

## Ruling 3 must be enforced in the rules, not the UI

`canFinance()` = `isMoneyAdmin() || isFinanceDept()`. If her user doc ever carries
`Finance`, `isFinanceDept()` hands the whole money tier back and the carve-out
silently evaporates. Make the boundary self-enforcing inside `isFinanceDept()`
(same doc read, no extra `get()`), so no profile edit can undo the ruling.
Same principle for IT: use a dedicated `canIt()` that excludes the role, rather
than `canDept('IT')` which resolves through `isAdmin()` and so includes her.

## Do NOT touch

`isAdmin()` and `canDept()`. `canDept()` is the sole write gate for Sales work
plans, all five Marketing collections and the three Gov Bidding buckets — exactly
the departments she keeps. Narrowing `isAdmin()` would additionally strip signup
approval, submissions approval, memos create+delete (her corporate-records duty),
SOPs and chat admin.

---

## Two risks that must be handled in the same change

**1. Work Sites is the one true client-side lockout.** `openWorkSitesPage`
(js/screens/hr.js) gates on `isFinancePriv()`, but it is the `geo_sites`
attendance-geofence admin — pure HR, riding the finance predicate only because it
lives in `hr.js`. Its boundary rule stays on `isOpsAdmin()`, so after the change
**the rules would allow the write while the UI hides the button**. Type-B workers
cannot self-clock outside an active site, so nobody notices until a worker at a
new gate cannot punch in. Twelve of the thirteen `isFinancePriv()` readers are
genuinely finance; this one is not.

**2. The Approvals queue LIES when denied.** All 14 approvals queries end in
`.catch(e => ({size:0, docs:[]}))`, and the secretary dashboard uses `safeGet`.
After the change three of those are denied for her, so **a denied query renders as
"0 pending" — indistinguishable from "nothing needs attention"**. This is exactly
why ruling 1 (keep money requests visible, read-only) is the safer answer: it
avoids the silent-zero entirely for those three. Any category that IS closed must
be labelled explicitly rather than showing a count of 0.

## Build order

1. **Rules** — split the helper, repoint 42 sites, close the 3 leaks, enforce
   ruling 3 inside `isFinanceDept()`/`canIt()`. Verify on the emulator with a
   per-role differential matrix, as the August work did. **Do not deploy.**
2. **Client** — a per-department `canEditDept` carve-out (js/departments.js:20
   currently returns `true` for secretary before the department argument is even
   inspected), the Work Sites regate, and the Approvals labelling.
3. Nav: hide Finance and IT for the role.

Deploy order is the same as the August security work: **push the client first,
then deploy rules.** Rules ahead of the client denies queries the stale cached
build still sends.
