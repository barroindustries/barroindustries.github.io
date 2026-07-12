# V13 — All-Function Correctness & Reliability Review

**Date:** 2026-07-12 · **Scope:** every JS module + backend (rules, functions, scripts)
**Method:** parallel per-file audits (Sonnet), top findings hand-verified against source by Opus.
**Deliverable:** report only — no code changed. Focus: real correctness/reliability bugs (not style).

Files audited: `js/app.js`, `js/departments.js` (split), `js/modules.js`, `js/notifications.js`,
`js/chat.js`, `js/config.js`, `js/firebase-config.js`, `js/drive.js`, `functions/index.js`,
`firestore.rules`, `firestore.indexes.json`, `storage.rules`, `scripts/*`.

**Overall:** the finance engine (Compute→Verify→Disburse, `vatSplit`, deterministic ledger refs,
transactional disburse lock), rules coverage, and backups are genuinely well-hardened. The real
risks cluster in **edit/secondary paths** that skip the safeguards the primary paths enforce, a few
**concurrency** gaps, and **permission-denied being swallowed as empty data**.

Legend: ✅ verified against source · 🔶 reported by review, not yet line-verified · severity = impact.

---

## HIGH — fix first

| # | Sev | Location | Defect | Failure scenario |
|---|-----|----------|--------|------------------|
| H1 | HIGH ✅ | `departments.js:3737-3756` payroll history edit (`hist-edit-btn`) | Ledger sync writes **net** pay (`finalPay`) into the `PAY-{month}-{uid}` row, which `disbursePayRun` posts as **gross** (`effectiveGross`, line 3415) | Any edit through the Payroll History pencil silently understates Payroll Expense by the employee's SSS/PhilHealth/Pag-IBIG/tax, and the reconciliation tool (3505) then flags the drift the edit itself created |
| H2 | HIGH ✅ | `departments.js:3724-3762` same edit modal | No `assertPeriodOpen` guard (every other money-posting path calls it) | Finance/President can edit salary + rewrite the linked ledger amount for a **closed** accounting period, bypassing the period lock |
| H3 | HIGH ✅ | `departments.js:1779` `_deleteLedgerByRef` and `:3431-3432` `disbursePayRun` | Direct `.delete()` on `ledger` docs, bypassing `window.financeDelete` → President approval | Violates the documented invariant (memory: finance-delete-approval): ledger rows get deleted with no approval trail — every disburse also deletes a legacy `PAY-` row this way |
| H4 | HIGH ✅ | `modules.js:1636-1638` `renderCAList` (admin/president CA view) | `paidAmt = a.amount − balance` and `pct` use **principal**, not `totalPayable`; no `Math.min(100,…)` clamp. Employee view (1523-1526) does it correctly | Any interest-bearing advance shows a **negative "Paid ₱-500.00"** and a broken progress bar to decision-makers (confirmed by two independent reviewers) |
| H5 | HIGH ✅ | `departments.js:9383-9497` `renderBSQuotationsSummary` | The `bs_quotes.get()` + fallback are awaited with **no try/catch and no `.catch()`**; container is never given a loading state | A rules-denied read for any role leaves the Brilliant Steel "Quotations Summary" tab stuck blank with an unhandled rejection (sibling `renderBSQuotationFiles` wraps the same read correctly) |
| H6 | HIGH ✅ | `departments.js:9296` vs `9386` BS **Files** vs **Summary** gate | `isPrivileged` is `true` for role `employee` unconditionally and runs the unrestricted `bs_quotes` read; `canSeeAll` in Summary restricts non-Sales employees | A non-Sales employee (IT/Design) sees **all** client quotes — names, totals, agents — in the Files tab while seeing none in Summary. Data-exposure inconsistency; likely the opposite of intended |
| H7 | HIGH ✅ | `notifications.js:504-519` `sendToDept` | Both `users` queries `.catch(()=>({docs:[]}))`, so **permission-denied is indistinguishable from "no members"** | A caller whose rules deny the dept `users` query fires the `fallbackToOwner` "[no <dept> user assigned]" notice while the real department members are never notified — masks a permissions bug as a staffing gap |
| H8 | HIGH ✅ | `departments.js:7267,7297,7304` `renderBKQuotes` | Reads only `q.total`, missing the `|| q.grandTotal || 0` fallback used elsewhere | A BK quote stored under `grandTotal` shows/posts **₱0** in KPIs and Sales-Order creation |
| H9 | HIGH ✅ | `modules.js:2513-2520 / 2541-2546` `approveLeave` | Request set to `'approved'` **before** `applyLeaveApproval` (balance decrement + attendance write) runs | If the second step throws, the request is left `approved` with no deduction while the admin is told "Approve failed" — retry risks a **double** balance decrement |
| H10 | HIGH 🔶 | `departments.js:15129-15263` `recordPurchaseDisbursement` | Only a client-side `recordedToFinance` flag + soft dup-warning; no transaction/server idempotency | Two Finance users open the same received PR (button visible to both) and post → **two CDJ entries + two ledger debits** for one purchase |
| H11 | HIGH ✅ | `departments.js:13773+/13961` `consumeProductionMaterials` | Re-entrancy guard reads a **stale in-memory** `order.materialsConsumed`; stock uses a blind `increment(-q)` batch, not compare-and-set | Two concurrent "Consume" clicks on the same order both pass the guard → inventory qty **double-decrements** (COS/ledger are protected by deterministic refs; raw stock is not) |
| H12 | HIGH ✅ | `app.js:170-176` `startForceLogoutListener` | Compares client `Date.now()` (`sessionStart`) against the **server** `forceLogoutAt` timestamp | On a clock-skewed device the force-logout can be missed (stale session never signs out) or misfire — the security control is least reliable exactly during an incident |

---

## MEDIUM

| # | Location | Defect | Failure scenario |
|---|----------|--------|------------------|
| M1 | `departments.js:4499-4522` `renderLedgerTab` | Balance/Credits/Debits KPIs computed from only `.limit(100)` ledger + 100 journal docs | Past 100 entries the Ledger tab's headline totals silently undercount and disagree with Finance→Overview (unlimited) |
| M2 | `config.js:512-514` `isQuoteWon`/`isQuoteLost` | Not mutually exclusive — `isQuoteWon` short-circuits on `salesOrderId` regardless of `status` | A doc with `salesOrderId` **and** `status:'rejected'` is counted in both `won` and `lost`, skewing win-rate both ways |
| M3 | `firebase-config.js:29` `auth.setPersistence` | Promise neither awaited nor `.catch()`'d | In Safari private mode / some webviews LOCAL persistence rejects, silently falls back to session — breaks the documented 10-day session & background push, with no diagnostic |
| M4 | `notifications.js:460-484` `deleteForMessage` | 15s `createdAt`-window match on `chatId`+`type` | With the 60s per-recipient notif throttle, deleting a second rapid message can delete the (only) notification belonging to the **first** message, which is still in the chat |
| M5 | `modules.js:3007-3018` `renderRecentActivity` | Most reads in the `Promise.all` lack `.catch()` (only `audit_log` degrades) | One denied/failed collection query throws and blanks the whole Recent Activity feed instead of showing what loaded |
| M6 | `departments.js:10271-10286` Approvals "all" counters | 14 individually-caught reads each fall to `{docs:[]}` on denial | A Secretary/Manager whose rules deny e.g. `purchase_requisitions` sees "0 pending" — looks all-clear while POs actually wait |
| M7 | `departments.js:13315-13322` `openProjectBillingModal` | Pre-fills the payment amount from stored `arBalance` (known to drift; submit recomputes correctly) | Finance sees/accepts a wrong expected balance if `arBalance` drifted, though the posted ledger math stays correct |
| M8 | `notifications.js:539-554` `sendToAll` | `users.get()` has no `.catch()` (unlike siblings) and is called fire-and-forget | A denied read surfaces as an unhandled rejection instead of degrading |
| M9 | `app.js:~424` claims re-gate | Fixed 800ms `setTimeout` assumes token refresh + profile reload finished | On a slow network a demoted user's page re-renders with stale (over-privileged) role for longer than intended |
| M10 | `departments.js:1616-1632` `postExpenseToLedger` | No guard against a zero/NaN amount | A blank amount posts a legitimate-looking ₱0 `EXP-{id}` ledger debit |
| M11 | `modules.js:1533` `renderCAEmployeeCards` | Paid-off advance falls through to `'rejected'` badge when status never flips to `'paid'` | Employee who fully repaid sees "Rejected" instead of "Paid" — confusing/disputable |

---

## LOW / PLAUSIBLE (hardening, low urgency)

- `config.js dbCachedGet` — no negative-caching/backoff: a permission-denied hot key is re-fetched on **every** render with no throttle.
- `drive.js:19` upload path is `${dept}/${sub}/${Date.now()}_${name}` — two same-named files picked together can collide on the same millisecond and one silently overwrites the other.
- `functions/index.js:832` `sendNotificationQuota` is a **dead no-op** — `send()` never writes `senderUid`/`fromUid`/`createdBy`, so the per-sender quota never counts or warns.
- `firestore.rules:1491-1525` `files_*` / `budgets_*` wildcard blocks — correct today but any future collection literally prefixed `files_`/`budgets_` would be union-permitted; add a comment/test.
- `modules.js:961-986` `getPHHolidays` — Chinese New Year / Eid'l Fitr / Eid'l Adha hardcoded only **through 2028**; after that those days silently drop from attendance/leave math.
- Assorted `new Date().toISOString()` on file/timeline metadata (`departments.js:2412, 12642+`, etc.) instead of `bizDate()` — ISO sort is fine, but any later per-day Manila grouping is off by up to 8h near midnight.
- `photoUrl` inserted into `<img src>` via `escHtml` but **not** `safeHttpUrl` (`modules.js:140,656,1877`) — inconsistent with `imageUrl`/`fileUrl`; low risk since `img` doesn't execute schemes.
- `renderTeamCards`/`renderGlobalSearch` use a hand-rolled `.replace(/"/g,'&quot;')` instead of `escHtml()` for attributes — fragile if the markup context ever changes.
- `firebase-config.js:37-49` `enableIndexedDbPersistence` only handles `failed-precondition`/`unimplemented`; other failures (quota, privacy-blocked IndexedDB) pass silently.

---

## Verified NOT bugs (false positives, recorded so they aren't re-raised)

- `modules.js:2493` `writeLeaveAttendance` writes `status:'unpaid_leave'` (underscore) — **correct**: `attRecKind` (config.js:102) maps that stored status to the `'unpaid-leave'` kind all readers use.
- `app.js` — several first-pass flags the reviewer self-retracted on inspection: partner-dashboard nested `.catch` (outer try covers it), `passive` listener-removal matching, `_navDepth` compare-before-assign ordering. All confirmed fine.
- Backend is strong: `monthly-backup.js` auto-discovers collections via `listCollections()` (no hand-maintained EXPORTS to drift), Node pinned to 20 with a CI check, all Drive calls use `supportsAllDrives`, and `sendPushOnNotification`/`executeApproval`/`onQuoteWon` have real idempotency guards.

---

## Suggested fix order

1. **Finance integrity (H1–H3, H8):** payroll-edit net-vs-gross + period lock, ledger-delete approval bypass, BK quote-total fallback. These corrupt the books or the approval trail.
2. **Money shown wrong (H4, M1, M2):** CA admin progress math, Ledger-tab 100-doc cap, quote won/lost double-count.
3. **Permission-denied swallowed as empty (H5, H6, H7, M6):** BS Summary blank screen, BS Files over-exposure, `sendToDept` misroute, Approvals false "0 pending".
4. **Concurrency (H10, H11):** PR double-post and production consume double-decrement — move both to Firestore transactions / server-side idempotency.
5. **Reliability (H9, H12, M3, M4, M8):** leave-approval ordering, force-logout timestamp, persistence rejection, deleteForMessage window, sendToAll catch.

_Report only — awaiting your go-ahead before any code changes._
