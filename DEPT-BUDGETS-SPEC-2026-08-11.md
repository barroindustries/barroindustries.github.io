# DEPT-BUDGETS-SPEC-2026-08-11 — Department Budgets: release, spend, confirm, reimburse

Implementation spec for the department budget system. Written for an implementer who has
NOT seen the design conversation. Everything you need is in this file; where a judgement
call was made it is marked **[JUDGEMENT]** with a one-line reason, and anything that needs
the owner's decision is marked **[OWNER]** and collected in §13.

---

## ⚠ 0. FILE CONTENTION — READ BEFORE EDITING ANYTHING

**Another implementer is editing `js/departments.js` in the SALES ORDER region
(~lines 3600–3935) at the same time as you.** Your `js/departments.js` changes are
confined to the **BUDGETING region (~4318–4555)**. Rules:

- Edit `js/departments.js` ONLY with surgical `Edit` (exact-string) calls inside
  4318–4555. **Never** rewrite or re-save the whole file. Never touch 3600–3935.
- Never run `git stash`, `git reset --hard`, `git checkout -- <file>`, `git clean`
  (CLAUDE.md — this has destroyed other agents' live work before).
- If `Edit` fails twice with "modified since read" (OneDrive mtime race), batch the
  remaining exact-match replacements through a small python script instead of retrying.
- The Marketing content switch (departments.js:1100–1137) already routes
  `'Budgeting'` → `renderBudgeting` — **you do not need to touch it.**
- Bump nothing by hand: `CACHE_VER`/`APP_VERSION` are handled by the pre-commit hook.

All other files you touch (config.js, screens/*.js, app.js, rules, indexes, sw.js,
index.html) are additive one-liners or new blocks — still edit surgically.

---

## 1. What this builds (owner's request + binding rulings)

Owner (verbatim): *"fix the system where finance releases a budget for departments. add a
department budget where those personel can write what those budget were used on then it
will be registered as an expense, allow finance to designate budgets to departments and
allow departments as well to request for budgets with attachments. … whenever they spend
they will log it into the system with proof of expense or receipts. allow this for all
departments"*

**Binding rulings (do not reopen):**

1. **Posting.** A department-logged spend appears IMMEDIATELY in that department's own
   budget view and immediately reduces their remaining balance. It posts to the shared
   `ledger` ONLY when Finance confirms it. **Departments never write to `/ledger`
   directly** — no new `/ledger` rule legs are added by this spec; every posting is a
   Finance-side action already permitted by the existing `canFinance()` create leg
   (firestore.rules:2663–2698).
2. **Overspend.** Logging a spend beyond the remaining budget is WARNED LOUDLY but
   ALLOWED. The line turns red, Finance is flagged, the department is told plainly.
3. **Release type (owner, 2026-08-11).** A budget release is one of TWO types, chosen by
   Finance at release time — *"if its a ceiling and not actual cash, department files for
   some kind of reimbursement"*:
   - **CASH FLOAT** — Finance physically hands money to a named **custodian** (a person).
     The release posts to the ledger (a "Cash Float — <Dept>" receivable, cash out).
     Confirmed spends *liquidate* the float. If the float goes negative, the excess is a
     payable **to the person who fronted it**.
   - **CEILING** — authorization only. Nothing posts at release (memo, like today's
     budget lines). Someone pays out of pocket; **every** confirmed spend creates a
     reimbursement payable **to the person who paid**.

   **The essential asymmetry — state it in code comments and UI copy:** under a float the
   company has ALREADY paid, so a confirmed spend only draws down the float; under a
   ceiling the company has NOT paid, so a confirmed spend creates a debt to a person.
   Both can end in owing an individual — a float only when it goes negative, a ceiling
   every single time. **Departments are never owed money; every payable is owed to a
   named PERSON.**
4. **Proof is required** to log a spend, with one escape: "No receipt available" demands a
   typed reason and is flagged distinctly to Finance. **[JUDGEMENT]** — a silently
   optional receipt field means no receipts.

**The exact gap being fixed:** `renderBudgeting` (departments.js:4321) gates every spend
figure AND the "Log Expense / Income" button on `canSeeSpend` (president/owner/manager/
finance only, line 4335), so a department member sees "—" everywhere and **cannot log
what they spent**. It is also wired to Marketing only (config.js:273–274,
departments.js:1127–1128).

---

## 2. Concept model

```
dept_budget_requests ──(Finance approves)──► dept_budget_releases ◄──(Finance creates directly)
                                                   │  type: 'float' | 'ceiling'
                                                   │  float → posts DBR-<id> to ledger
                                                   ▼
                                          dept_spend_logs  (status: pending)
                                                   │  ← dept member logs, proof attached,
                                                   │    remaining balance drops NOW
                                     (Finance confirms) │ (Finance rejects → member edits & resubmits)
                                                   ▼
                                    ledger legs via Ledger.postMulti/upsertByRef
                                      float:   DSP-<id> expense + DSP-<id>-FLT float drawdown
                                               (+ DSP-<id>-PAY for the over-float excess)
                                      ceiling: DSP-<id> expense + DSP-<id>-PAY payable to payer
                                                   │
                                    (Finance pays reimbursement) → DRP-<id>
                                    (Finance closes float)       → DBC-<releaseId>
```

- Existing `budgets_<dept>` **budget lines stay** exactly what they are today: planning
  memo sub-allocations. They post nothing. A spend may optionally tag a line.
- A **release** is the money-truth. The department's remaining balance is
  `Σ active releases − Σ spend logs (pending + confirmed)` — never derived from the
  ledger on the department side (members can't read `/ledger`, and must not).
- **Is a release a budget line, a parent of lines, or separate? Separate collection.**
  **[JUDGEMENT]** — it cannot live in `budgets_<dept>` because the `budgets_.*` wildcard
  (firestore.rules:3396–3417) lets a dept member update/delete their own dept's docs;
  a member could then edit the amount Finance released to them. There is no way to opt a
  same-prefixed collection out of that wildcard (union-permit trap, rules:3373–3382).

---

## 3. New collections and doc shapes

Three literal-named root collections. Names deliberately do **NOT** start with
`budgets_` or `files_` (wildcard capture, rules:3367–3417). Monthly backup discovers root
collections automatically (`db.listCollections()` — see comment at departments.js:4322).

### 3.1 `dept_budget_releases/{autoId}`

```js
{
  dept: 'Marketing',                    // exact DEPARTMENTS key
  type: 'float' | 'ceiling',            // REQUIRED at creation, immutable in UI
  title: 'Q3 campaign budget',          // required
  amount: 50000,                        // number > 0
  note: '',                             // optional free text
  date: '2026-08-11',                   // today() at creation
  status: 'active' | 'closed',
  // float only:
  custodianUid: '<uid>', custodianName: 'Ana Cruz',
  bankAccountId: '<id>'|null, bankAccountName: '<nick>'|null,  // where cash left from
  // linkage / audit:
  requestId: '<dept_budget_requests id>'|null,
  releasedBy: '<uid>', releasedByName: 'Neil Barro',
  createdAt: serverTimestamp(),
  // maintained by Finance confirm flow (see §6.3 — float split math):
  confirmedTotal: 0,                    // Σ confirmed spend amounts against this release
  // close-out (float):
  closedAt: ts|null, closedBy: uid|null, returnedAmount: number|null,
  ledgerRef: 'DBR-<docId>'|null         // float only; null for ceiling
}
```

### 3.2 `dept_budget_requests/{autoId}`

```js
{
  dept: 'Marketing',
  title: 'Trade show booth',            // "What is it for"
  amount: 20000,                        // number > 0
  reason: 'multiline detail…',          // required
  attachments: [{ name, url, path }],   // optional here (proof is for SPENDS)
  requestedBy: '<uid>', requestedByName: 'Ana Cruz',
  status: 'pending' | 'approved' | 'declined' | 'cancelled',
  reviewedBy: uid|null, reviewedByName: ''|null, reviewNote: ''|null,
  releaseId: '<dept_budget_releases id>'|null,   // set on approve
  createdAt: serverTimestamp(), decidedAt: ts|null
}
```

### 3.3 `dept_spend_logs/{autoId}`

```js
{
  dept: 'Marketing',
  releaseId: '<release id>',            // REQUIRED — every spend draws on a release
  releaseTitle: 'Q3 campaign budget',   // denormalized for display
  date: '2026-08-11',                   // spend date, defaults today()
  description: 'Facebook Ads payment',  // required
  amount: 3500,                         // number > 0
  budgetLineId: '<budgets_<dept> id>'|null, budgetLineName: 'Social Media Ads'|null,
  refNumber: 'OR #1234'|null,
  attachments: [{ name, url, path }],   // Drive.uploadFile results; [] only if noReceipt
  noReceipt: false, noReceiptReason: ''|'typed reason',
  paidByUid: '<uid>', paidByName: 'Ana Cruz',   // == loggedBy in v1 (see §13.5)
  overspendAtLog: false,                // true if it exceeded remaining when logged
  status: 'pending' | 'confirmed' | 'rejected',
  loggedBy: '<uid>', loggedByName: 'Ana Cruz',
  createdAt: serverTimestamp(), updatedAt: ts|null,
  // Finance decision:
  decidedBy: uid|null, decidedByName: ''|null, decidedAt: ts|null,
  rejectReason: ''|null,
  ledgerRefs: ['DSP-<docId>', 'DSP-<docId>-FLT']|null,   // set on confirm
  // reimbursement tracking (ceiling spends + over-float excess):
  reimbStatus: null | 'owed' | 'paid',
  reimbAmount: number|null,             // the payable portion (== amount for ceiling)
  reimbPaidAt: ts|null, reimbPaidBy: uid|null, reimbLedgerRef: 'DRP-<docId>'|null,
  // input VAT — captured by FINANCE at confirm time via window.readVatField (§6.3):
  // …vat fields spread onto the doc exactly as the old form did (departments.js:4529)
}
```

---

## 4. Permission matrix

Client helpers: `isDeptMember = (window.currentDepts||[]).includes(dept) &&
!deptBlockedForSecretary(dept)` (exactly as departments.js:4330 — **the secretary guard
is mandatory on every new dept-membership gate**); `canFinanceTier =
['president','owner','manager','finance'].includes(currentRole)` (the old `canSeeSpend`).

| Action | Dept member (own dept) | Finance tier (president/manager/finance role/Finance-dept) | Secretary | Partner | Other dept's member |
|---|---|---|---|---|---|
| See own dept's releases, remaining, spend logs, requests | ✅ | ✅ (all depts) | ✅ read-only (oversight) | ❌ | ❌ |
| See `/ledger` rows / ledger-synced table | ❌ (unchanged) | ✅ | ❌ | ❌ | ❌ |
| Log a spend | ✅ | ✅ | ❌ | ❌ | ❌ |
| Edit/withdraw own spend while pending/rejected | ✅ (own logs) | ✅ | ❌ | ❌ | ❌ |
| Request a budget | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create/close a release, approve/decline requests, confirm/reject spends, pay reimbursements | ❌ | ✅ | ❌ | ❌ | ❌ |
| Delete a release / a decided spend / a request | ❌ | President only (route UI through `financeDelete` semantics) | ❌ | ❌ | ❌ |
| Budget lines (`budgets_<dept>`) create/edit | ✅ (unchanged) | ✅ | blocked for Finance/IT via existing guards | ❌ | ❌ |

What a dept member must still NOT see: any other department's releases/spends/requests
(rules enforce via `inDept(resource.data.dept)`), the shared ledger, bank accounts,
anyone's reimbursement queue beyond their own spends' `reimbStatus`.

Rules-side member legs all carry `&& !isSecretary()` (same ruling-3 completion as the
`/ledger` Production legs, rules:2671–2678); the secretary keeps READ through an explicit
`isSecretary()` disjunct (same shape as `finance_delete_requests`, rules:2858).

---

## 5. Ledger postings — deterministic refs, all idempotent

Every posting goes through `window.Ledger` (js/finance-ledger.js) with a deterministic
ref, so a double-tap, retry, or re-confirm **cannot post twice**: `upsertByRef`/
`postMulti` transactionally no-op when the ref's doc already exists (finance-ledger.js:
350–398, 400–449). Set `refNumber` = the ref on every row. All rows carry `dept`,
`source: 'Finance'`, `date` (the source doc's date), and are posted only by Finance-tier
users, so the existing `/ledger` `canFinance()` create leg admits them — **no
firestore.rules change to `/ledger`.**

**[OWNER — §13.1]** The account NAMES below are plain-word placeholders for the owner to
bind to his chart of accounts. Do not invent account codes.

| Event | Ref(s) | Row shape (fields beyond the common ones) |
|---|---|---|
| **Float release** (create release, type float) | `DBR-<releaseId>` | `type:'debit', accountType:'asset', account:'Cash Float — <Dept>', category:'Cash Float — <Dept>', description:'Cash float released to <custodianName> — <title>', amount, bankFlow:'out', bankAccountId/Name` (if picked) |
| **Ceiling release** | — | **posts NOTHING** (memo only) |
| **Confirm spend — expense leg** (always) | `DSP-<spendId>` | `type:'debit', accountType:'expense', account:'<Dept> Expense', category:'<Dept> Expense', description, amount, budgetLineId/Name, deptSpendId:<spendId>, …VAT fields from readVatField` — mirrors the old `_deptExpRow` (departments.js:4517–4534) |
| **Confirm spend — float drawdown** (float, portion covered by float) | `DSP-<spendId>-FLT` | `type:'credit', accountType:'asset', account:'Cash Float — <Dept>', amount: floatPortion` (no bankFlow — no bank cash moves) |
| **Confirm spend — payable** (ceiling: full amount; float: only the over-float excess) | `DSP-<spendId>-PAY` | `type:'credit', accountType:'liability', account:'Reimbursement Payable', description:'Owed to <paidByName> — <description>', amount: payablePortion, payeeUid, payeeName` |
| **Pay reimbursement** | `DRP-<spendId>` | `type:'debit', accountType:'liability', account:'Reimbursement Payable', description:'Reimbursed <paidByName> — <description>', amount: reimbAmount, bankFlow:'out', bankAccountId/Name` |
| **Float close — unspent returned** | `DBC-<releaseId>` | `type:'credit', accountType:'asset', account:'Cash Float — <Dept>', description:'Float returned by <custodianName> — <title>', amount: returnedAmount, bankFlow:'in', bankAccountId/Name` |

Float split math at confirm time (spec §6.3): `floatRemaining = release.amount −
release.confirmedTotal` (confirmed only — pending spends have no ledger legs);
`floatPortion = min(spend.amount, max(floatRemaining, 0))`; `payablePortion =
spend.amount − floatPortion`. Post the multi-leg set with **one `Ledger.postMulti`
call** (single transaction, per-ref dedupe). Known accepted limitation: two Finance users
confirming two spends of the same float in the same second could mis-split the payable
portion — flagged in §13.8, acceptable for a 1–2 person finance office.

`window.ledgerKind` (config.js:2254) returns `accountType` when present, so asset/
liability legs are automatically excluded from every expense/income sum that filters on
`ledgerKind(e)==='expense'` — including renderBudgeting's per-line spend math
(departments.js:4350–4358). No changes needed to those sums.

Period close: `Ledger.postMulti` already calls `window.assertPeriodOpen(date)` per
distinct date (finance-ledger.js:410). On failure the toast is already shown — catch,
abort the confirm, leave the spend `pending`, and tell Finance:
`"That month is closed — reopen the period or fix the spend date first."`

Deletes/corrections: `/ledger` delete stays President-only; UI routes through
`window.financeDelete` (departments.js:673) as everywhere else. Deleting a confirmed
spend's ledger legs does NOT auto-revert the spend doc — the spend doc is the audit
record; Finance edits ledger rows through the existing `financeEditModal` (period-gated).

---

## 6. UI — screen by screen (exact copy in quotes)

General rules for ALL new UI: escape every user string with `escHtml()`; money via
`₱${fmt(n)}`; dates via `today()` exactly as the existing form does (departments.js:4462);
**panel-scoped lookups only** — inside any `openPage` panel use
`const $ = (id) => _panel.querySelector('#'+id)` (the money-critical race is documented at
departments.js:4487–4492); wrap every submit in `window.busy(btn, fn)` (config.js:2169);
tabs via `window.chipTabs`/`bindChipTabs`; explainers via `window.sopPanel`; Lucide via
`lucide.createIcons({nodes:[container]})`. Mobile 375px: KPI row wraps (existing
`.kpi-row`), tables use the existing `.data-table.table-cards` responsive pattern, release
cards are full-width stacked `div.card`s — no horizontal scroll, no truncated peso figures.

### 6.1 `renderBudgeting` — the department's own view (rewrite in place, departments.js 4321–4555)

Keep the signature `renderBudgeting(container, currentUser, currentRole, dept)` and the
collection computation (line 4324). Add one export line at the end of the region:
`window.renderBudgeting = renderBudgeting;` (needed by other screen files, §8).

**Gates (replace lines 4330–4335):**
```js
const isDeptMember   = (window.currentDepts||[]).includes(dept) && !deptBlockedForSecretary(dept);
const canFinanceTier = ['president','owner','manager','finance'].includes(currentRole);  // old canSeeSpend
const canLogSpend    = isDeptMember || canFinanceTier;          // THE fix: members can log
const canEditLines   = canFinanceTier || currentRole==='manager' || isDeptMember;        // old canEdit
const canSeeLedger   = canFinanceTier;                          // ledger query stays finance-tier
```

**Data load (extend lines 4338–4343):**
```js
const [budgetSnap, releaseSnap, spendSnap, reqSnap, ledgerSnap] = await Promise.all([
  db.collection(collection).orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
  db.collection('dept_budget_releases').where('dept','==',dept).orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
  db.collection('dept_spend_logs').where('dept','==',dept).orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
  db.collection('dept_budget_requests').where('dept','==',dept).orderBy('createdAt','desc').get().catch(()=>({docs:[]})),
  canSeeLedger ? db.collection('ledger').where('dept','==',dept).limit(100).get().catch(()=>({docs:[]}))
               : Promise.resolve({docs:[]})
]);
```
(The three new queries need composite indexes — §10.)

**Derived numbers (dept-side truth, never from ledger):**
- Per active release: `logged = Σ spends(releaseId, status in ['pending','confirmed'])`;
  `remaining = amount − logged`.
- KPI row (replaces lines 4360–4367): `Released` (Σ active release amounts) ·
  `Spent (logged)` (Σ pending+confirmed spends) · `Remaining` (difference; red when < 0) ·
  `Awaiting Finance` (count of pending spends). Delete the old
  "Spend tracking is visible to Finance & Management" hint (line 4367) — members now see
  real figures.

**Sections, top to bottom:**

1. `sopPanel('How your department budget works', [...])`:
   - `'Finance releases a budget to this department — either a cash float (someone here is holding company cash) or a spending limit (you pay first, then get paid back).'`
   - `'Every time you spend, log it here with the receipt. Your remaining balance updates immediately; the entry reaches the company books once Finance confirms it.'`
   - `'Going over budget is recorded, not hidden — the line turns red and Finance is flagged.'`
   - `'Need money for something? File a budget request with your supporting documents.'`
2. Action buttons row: `[+ Budget Line]` (canEditLines, unchanged behavior) ·
   `[📤 Log a Spend]` (canLogSpend) · `[🙋 Request a Budget]` (canLogSpend).
   The old combined "Log Expense / Income" direct-to-ledger form (lines 4458–4554) is
   **deleted** — the spend-log flow replaces it for everyone. **[JUDGEMENT]** two write
   paths to the same books breed double entries; Finance still has direct entry in
   Finance → Money In/Out. Income entries are Finance-only there (a department "income"
   is not a budget spend).
3. **"💰 Budget Releases" card** — one row/card per release, newest first:
   - Float: badge `💵 Cash float` + line `"Custodian: <name> — holding company cash"`.
   - Ceiling: badge `🧾 Spending limit` + line `"Pay out of pocket, then log the receipt to get paid back."`
   - Each shows: title, ₱amount, released date, `Remaining ₱X` (red + prefix `OVER BY ₱X`
     when negative), status chip (`Active`/`Closed`).
   - Overspent active release also renders a banner:
     `"⚠ You are ₱<x> over '<title>'. Everything still gets recorded — Finance has been flagged."`
   - Empty state (no releases at all): icon 💰 + `"No budget yet."` +
     `"<dept> hasn't been given a budget. You can request one."` + `[🙋 Request a Budget]`.
     **Never a broken screen** — all queries fail soft to empty docs.
   - Finance-tier viewers additionally get `[Close float]` on active floats (§6.3d) and
     `[+ Release Budget]` in the card header (opens §6.3a's form pre-set to this dept).
4. **Budget Allocation card** (lines 4374–4402) — kept as-is, EXCEPT the `Spent` column:
   for `canSeeLedger` it stays ledger-derived (unchanged, covers legacy rows); for dept
   members compute it from `dept_spend_logs` (pending+confirmed, matched on
   `budgetLineId`) instead of rendering `—`. Footnote under the table for members:
   `"Figures include spends still awaiting Finance confirmation."`
5. **"🧾 Spend Log" card** — from `dept_spend_logs` (replaces the members' empty ledger
   table; shown to everyone). Columns: Date · Description · Amount · Status · By.
   Status badges: `⏳ With Finance` (pending) · `✓ Confirmed` (green) · `✕ Rejected`
   (red; row expands to show `rejectReason` + `[Edit & resubmit]` for the logger).
   Flags rendered inline on the row: `🚩 No receipt` when `noReceipt`, `🔺 Over budget`
   when `overspendAtLog`. Attachment names link to their `url` (target=_blank).
   Pending rows show `[Withdraw]` to their logger (deletes the doc after
   `confirmDialog`).
6. **"🙋 My Budget Requests" card** — title, ₱amount, status badge
   (`⏳ Pending` / `✓ Approved` / `✕ Declined` with `reviewNote` shown), date.
7. Finance-tier viewers keep the existing ledger-synced table (lines 4404–4426) below
   everything, with one fix: the Type badge uses `ledgerKind(e)` —
   `expense`→`Expense` (red), `income`→`Income` (green), `asset`→`Float` (neutral),
   `liability`→`Payable` (neutral) — so float/payable legs don't masquerade as Income.

### 6.2 "Log a Spend" form — `window.openLogSpendForm(dept, releases, lines, onDone)` (new file, §7)

`openPage('Log a Spend — <dept>', …)`, panel-scoped `$`. Fields:

- **Release** `<select>` (required) — active releases only, option text
  `"<title> — ₱<fmt(remaining)> left"` plus `(cash float)` / `(spending limit)` suffix.
  Preselected when only one. Under the select, a context line that answers "whose money
  am I spending": float → `"💵 This is company cash held by <custodianName>."`;
  ceiling → `"🧾 You're spending your own money — Finance pays you back after confirming."`
- **Date** (default `today()`), **Description** (required), **Amount ₱** (required, > 0,
  `type=number step=0.01 min=0 inputmode=decimal`).
- **Budget Line** `<select>` optional — `— None / General —` + lines (same as old form).
- **Reference #** optional (`"OR #, Invoice #…"`).
- **Receipt / proof** — `<input type=file multiple accept="image/*,.pdf">` + live list of
  picked names. Below it a checkbox: `"No receipt available"` which (a) reveals a
  required textarea `"Why is there no receipt?"`, (b) shows warning copy:
  `"Spends without a receipt are flagged to Finance and may be questioned."`
- **Overspend warning** — recompute on amount input: if `amount > remaining` of the
  selected release, show a red panel:
  `"⚠ Over budget — this takes '<title>' ₱<x> past its limit. It will still be recorded, and Finance will see it flagged."`

Submit (`[Save Spend]`, wrapped in `busy`): validate description/amount/release; require
≥1 file OR checked-no-receipt-with-reason (toast `"Attach the receipt or explain why there isn't one"`);
if over budget, `confirmDialog({message:'This spend is over budget. Record it anyway?', danger:true})`
(buttons default OK/Cancel are fine). Then upload each file via
`await Drive.uploadFile(file, 'Finance', 'BudgetProofs')` (js/drive.js:45 — returns
`{id, name, url, …}`; store `{name, url, path:id}`), create the `dept_spend_logs` doc
(shape §3.3, `status:'pending'`, `paidByUid/Name = current user`, `overspendAtLog`
computed), notify Finance (§11), `closeModal()`, toast
`"Spend logged — Finance will confirm it. Your remaining balance is updated now."`,
call `onDone()` (re-renders Budgeting). Upload failures surface via
`Drive.uploadErrorMessage` patterns already in drive.js — abort the save, keep the form open.

Edit & resubmit (rejected/pending): same form, prefilled, existing attachments listed
with remove ✕; on save `update()` the same doc with `status:'pending'`, `updatedAt`.
(The rules restrict which keys this leg may touch — §9.)

### 6.3 Finance surface — `window.renderDeptBudgetsAdmin(content, currentUser, currentRole)` (new file, §7)

Wired as a new Finance group chip **"Dept Budgets"** (§8, finance.js). Internal
`chipTabs`: **To Confirm** (badge = pending count) · **Releases** · **Requests**
(badge = pending count) · **Reimbursements** (badge = owed count). Top `sopPanel('How
department budgets work', [...])` including the asymmetry sentence verbatim:
`'Under a float the company has already paid — a confirmed spend only draws down the float. Under a ceiling the company has not paid — every confirmed spend creates a debt to the person who paid. Departments are never owed money; every payable is owed to a named person.'`

**a) Releases tab.** `[+ Release Budget]` → `openPage('Release a Budget', …)`:
Department `<select>` (eligible list, §8) · Type — two fat radio cards, copy:
`"💵 Cash float — we hand the money to a custodian now. Posts to the books as cash out into 'Cash Float — <Dept>'."` /
`"🧾 Spending limit — no cash moves now. People pay out of pocket and are reimbursed per confirmed receipt."` ·
Title · Amount ₱ · float-only (shown/hidden on radio change): Custodian `<select>` of that
dept's members (from `fetchUsers`-style users query; required) + Bank account `<select>`
(from `bank_accounts`, optional) · Note. Save (busy): create release doc (§3.1,
`confirmedTotal:0`); **if float**: `await Ledger.upsertByRef('DBR-'+docId, buildEntry)`
posting the §5 row — on posting failure, show the error and mark the release card with
`"⚠ Not yet posted — tap Repost"` (a `[Repost]` button re-runs the same upsertByRef; the
deterministic ref makes retries safe). Notify the dept (§11).
List below: all releases across depts (filter chip row by dept), each with remaining,
custodian, status, and `[Close float]` on active floats.

**b) To Confirm tab.** Table of `dept_spend_logs` where `status=='pending'`, oldest
first: Date · Dept · Description · Amount · By · flags (`🚩 No receipt`, `🔺 Over budget`)
· `[Review]`. Review → `openPage` showing every field, attachment links, the release
context (`type`, remaining before/after, and for floats the computed split preview:
`"₱<floatPortion> from the float"` + when payablePortion > 0
`"₱<payablePortion> becomes owed to <paidByName> (float exceeded)"`; for ceilings
`"₱<amount> becomes owed to <paidByName> once confirmed"`), plus the VAT capture
(`window.vatFieldHTML('dsp-vat','exempt')` / `window.readVatField('dsp-vat', amount)` —
same pair the old form used, departments.js:4481, 4529). Buttons:
`[Confirm & Post to Ledger]` `[Reject]`.

**Confirm sequence (write it in this order — idempotence depends on it):**
1. `busy()`; re-read the release doc fresh; compute the float split (§5).
2. Build legs and `await Ledger.postMulti(legs)` — one transaction, per-ref dedupe,
   period-check included. Abort on throw (spend stays pending).
3. One `db.batch()`: update the spend doc (`status:'confirmed'`, `decidedBy/Name/At`,
   `ledgerRefs`, `reimbStatus:'owed'` + `reimbAmount` when payablePortion > 0, VAT
   fields) AND the release doc (`confirmedTotal: increment(amount)`).
4. Notify the logger (§11); `dbCacheInvalidate('ledger')` is already done inside Ledger.
   A crash between 2 and 3 is safe: re-confirming re-runs postMulti (all refs exist →
   no-op) and then completes the batch.

**Reject:** `promptDialog` for a required reason → update
`{status:'rejected', rejectReason, decidedBy/Name/At}` → notify logger. Nothing posts.
Rejected spends stop counting against remaining (dept view sums pending+confirmed only —
§6.1), and the member can edit & resubmit.

**c) Requests tab.** Pending `dept_budget_requests`, with attachments. `[Approve]` opens
the §6.3a release form **prefilled** with the request's dept/title/amount (Finance picks
type/custodian — the figures are never re-typed; amount field stays editable for partial
grants). Saving creates the release with `requestId`, then updates the request
`{status:'approved', releaseId, reviewedBy/Name, decidedAt}` in the same flow, notifies
the requester. `[Decline]` → required `reviewNote` → status `declined` → notify.

**d) Reimbursements tab.** All spends `reimbStatus=='owed'`, grouped by `paidByName`
with per-person subtotal. Header copy: `"Owed to people, not departments."` Row →
`[Mark paid]`: modal with Bank account `<select>` + date (default `today()`); posts
`DRP-<spendId>` via `upsertByRef` then updates the spend
`{reimbStatus:'paid', reimbPaidAt, reimbPaidBy, reimbLedgerRef}`; notify the payee
(§11). **[JUDGEMENT — flagged §13.2]** Reimbursements are settled as Finance's own
payment, NOT added to payroll: payroll is being rebuilt in a parallel workstream and
non-payroll money must not enter the pay run. Routing them through payroll later is the
owner's call.

**e) Close float** (from a/the release card): modal shows `Released ₱X · Confirmed
spends ₱Y · Float balance ₱Z` (`Z = max(X−Y, 0)`) and, when Y > X,
`"₱<Y−X> of the overspend is owed to whoever fronted it — settle it under Reimbursements."`
Blocked while the release has pending spends
(`"<n> spend(s) still awaiting confirmation — decide them first."`; query
`releaseId==id && status=='pending'`). If Z > 0: require a bank account and confirm
`"Custodian returns ₱<Z>?"` → post `DBC-<releaseId>` via `upsertByRef` (bankFlow 'in'),
then update the release `{status:'closed', closedAt, closedBy, returnedAmount:Z}`. If
Z == 0: just close. A closed float that still has `owed` reimbursements keeps them
visible in the Reimbursements tab until paid — a float is never left unsettleable.

### 6.4 Approvals visibility (js/screens/approvals.js — additive, small)

President/manager/secretary live in Approvals, not Finance. Add the pending-spend count
so the queue never lies by omission:
- In the `Promise.all` (approvals.js:157–172) add
  `_apq('Dept spend confirmations', 'finance-requests', db.collection('dept_spend_logs').where('status','==','pending'))`
  (equality-only — no composite index needed) and a matching destructured name.
- Add its `.size` into `pendingFinReqs` (line 202) and into `_cachedAllSnaps` (196).
- In the finance-requests pane add a link-out card (no action buttons — actions live in
  Finance to keep ONE confirm path):
  `"💸 <n> department spend(s) waiting for Finance confirmation"` + button
  `[Open Dept Budgets]` → `window.renderFinance(currentUser, currentRole, 'Dept Budgets')`.
Readable by all Approvals viewers: president/manager pass `canFinance()`, secretary has
the explicit read leg (§9).

---

## 7. New file: `js/screens/dept-budgets.js`

All new logic lives here to keep `js/departments.js` edits minimal. File-scope bindings
use `var` (or function declarations) — **never top-level `const`/`let`** (a second
evaluation must not throw). Attach to window:

- `window.renderDeptBudgetsAdmin(content, currentUser, currentRole)` — §6.3.
- `window.openLogSpendForm(dept, releases, lines, onDone)` — §6.2.
- `window.openBudgetRequestForm(dept, onDone)` — fields per §3.2; attachments via
  `Drive.uploadFile(file, 'Finance', 'BudgetProofs')`; toast
  `"Request sent to Finance."`; notifies Finance (§11).
- `window.renderDeptBudgetingPage(dept)` — paints `deptContainer()` with a
  `page-header` (`<dept> — Budgeting`) and calls
  `window.renderBudgeting(container, currentUser, currentRole, dept)`. Used by HR's card
  hub and Admin's signpost (§8), which have no chip-tab switch.

Cross-file calls (`window.renderBudgeting`, `window.Ledger`, `Drive`, `Notifs`,
`escHtml`, `fmt`, `openPage`, `busy`) resolve at click/render time — the standard
runtime forward-reference convention (index.html:412–418). Load order (§8) puts this
file after departments.js and finance-ledger.js anyway.

---

## 8. Rollout to ALL departments — enumerated

`'Budgeting'` is inserted **immediately before `'Tasks'`** (or last where there is no
Tasks) in each list. Every chip-tab dept calls
`await window.renderBudgeting(content, currentUser, currentRole, '<Dept>')` from its
content switch. Marketing (departments.js:1082, 1127–1128; config.js:273–274) is the
template and is **already wired — do not touch it**.

| Department | config.js subtabs anchor | Screen file — tab list anchor | Content switch anchor | Notes |
|---|---|---|---|---|
| Marketing | 273–274 (done) | departments.js:1082 (done) | departments.js:1127–1128 (done) | template |
| Sales | :257 | js/screens/sales.js:106 (`salesTabs`) | `loadSalesContent` switch, sales.js:155 | |
| CRM | :269 | js/screens/crm.js:41 (`crmTabs`) | `loadCRMContent` switch, crm.js:64 | |
| Government Biddings | :278 | js/screens/govit.js:127 (chipTabs from `GOV_BUCKETS`) | `loadGov`, govit.js:131 | Do NOT add to `GOV_BUCKETS` (each bucket maps to a collection). Append a literal `{key:'Budgeting',label:'Budgeting'}` chip to the mapped array and branch in `loadGov`: `if (key==='Budgeting') return window.renderBudgeting(el, currentUser, currentRole, 'Government Biddings');` |
| IT | :282 | govit.js:180–182 (**both** branches of the `itAdmin` ternary) | `loadITContent`, govit.js:199 (add an `if (sub==='Budgeting')` branch) | |
| Design | :286 | js/screens/design.js:60 (inline array in `chipTabs(...)`) | `loadDesignContent` switch, design.js:68 | |
| Production | :292 | js/screens/production.js:1139 (`subs`) | `loadProdContent`, production.js:1163 (add `if (sub==='Budgeting') return await window.renderBudgeting(el, …, 'Production');`) | |
| Purchasing | :296 | production.js:2110 (`tabs`) | `loadPurchasingContent`, production.js:2127 | |
| HR | :249 (also add for search parity) | — card hub, not chips | js/screens/hr.js `cards` array (~:425, inside `renderHR` at :400) | Add card `{ icon:'📊', title:'Budgeting', desc:'HR department budget — releases, spends & requests', go:()=>window.renderDeptBudgetingPage('HR') }`. Place after 'People & Roles'. |
| Admin | subtabs stay `[]` | — signpost, not chips | `renderAdminDept` (js/app.js, immediately after `renderDeptModule`, ~:3255) | Add one signpost row: label `Budgeting`, desc `Admin department budget`, action `window.renderDeptBudgetingPage('Admin')`. Same row shape as its existing entries. **[OWNER — §13.4]** |
| Finance | — | — | js/screens/finance.js: `FINANCE_GROUPS` (:232–249) + `loadFinanceContent` (:385) | Add group `{ key:'Dept Budgets', label:'Dept Budgets', members:['Dept Budgets'] }` after `'Money In/Out'`; add `case 'Dept Budgets': await window.renderDeptBudgetsAdmin(content, currentUser, currentRole); break;`. Finance's own operating budget = pick 'Finance' inside that surface. |
| Ventures | — | — | — | **EXCLUDED**: documentation-only by design, "no money fields by design" (config.js:298–316). **[OWNER — §13.4]** |
| Brilliant Steel | — | — | — | **EXCLUDED**: external/partner-facing (`isSeparate`). **[OWNER — §13.4]** |
| Partners | — | — | — | **EXCLUDED**: external (`isPartnerDept`). **[OWNER — §13.4]** |

"Eligible departments" for the Finance release form (§6.3a) = every row above that is not
EXCLUDED: Admin, Finance, HR, Sales, CRM, Marketing, Government Biddings, IT, Design,
Production, Purchasing.

Departments with no budget yet render §6.1's empty state with the request button —
never a broken screen.

### Load-order / cache wiring (mandatory pair)

- **index.html** — add after the finance.js tag (index.html:658):
  `<script defer src="js/screens/dept-budgets.js"></script>` with the standard two-line
  comment (loads after departments.js/finance-ledger.js; resolves cross-file globals at
  runtime).
- **sw.js** — add `'/js/screens/dept-budgets.js',` to `PRECACHE` right after
  `'/js/screens/finance.js',` (sw.js:82). Do NOT hand-edit `CACHE_VER` — the pre-commit
  hook derives it from `APP_VERSION`.

---

## 9. firestore.rules — exact new blocks

Place after the `bank_accounts` block (rules:2870–2878), before Payslips. **No change to
`/ledger` (2564) and no change to the `budgets_.*` wildcard (3396–3417).** Every field
read uses `.get(field, default)` (missing-field-throws memory). Member legs carry
`&& !isSecretary()` (assignment never beats the role decision); the secretary keeps
oversight READ via an explicit disjunct, same shape as `finance_delete_requests` (2858).

```
    // ── Department budgets (DEPT-BUDGETS-SPEC-2026-08-11) ──────────────
    // Three literal-named collections, deliberately NOT prefixed budgets_/
    // files_: the wildcard blocks below union-grant their looser semantics to
    // ANY same-prefixed name (see the union-permit trap note there), and
    // budgets_* would let a dept member edit the AMOUNT Finance released to
    // them. Money truth lives here; budgets_<dept> lines stay planning memo.
    // Departments NEVER write /ledger — every posting is a Finance action
    // through the existing canFinance() ledger legs.
    match /dept_budget_releases/{docId} {
      allow read: if isAuth() && (canFinance() || isSecretary()
        || (!isPartner() && inDept(resource.data.get('dept', ''))));
      allow create: if isAuth() && canFinance()
        && request.resource.data.get('dept', '') != ''
        && request.resource.data.get('type', '') in ['float', 'ceiling']
        && request.resource.data.get('amount', 0) is number
        && request.resource.data.get('amount', 0) > 0
        && request.resource.data.get('status', '') == 'active'
        && (request.resource.data.get('type', '') == 'ceiling'
            || request.resource.data.get('custodianUid', '') != '');
      allow update: if isAuth() && canFinance()
        && request.resource.data.get('amount', 0) is number
        && request.resource.data.get('amount', 0) > 0
        && request.resource.data.get('status', 'active') in ['active', 'closed']
        && request.resource.data.get('dept', '') == resource.data.get('dept', '');
      allow delete: if isAuth() && isPresident();
    }
    match /dept_budget_requests/{docId} {
      allow read: if isAuth() && (canFinance() || isSecretary()
        || (!isPartner() && inDept(resource.data.get('dept', ''))));
      allow create: if isAuth()
        && (canFinance() || (!isPartner() && !isSecretary()
                             && inDept(request.resource.data.get('dept', ''))))
        && request.resource.data.get('requestedBy', '') == request.auth.uid
        && request.resource.data.get('status', '') == 'pending'
        && request.resource.data.get('dept', '') != ''
        && request.resource.data.get('amount', 0) is number
        && request.resource.data.get('amount', 0) > 0;
      // Finance decides; OR the requester edits/cancels their own still-pending
      // request (status may only stay 'pending' or become 'cancelled').
      allow update: if isAuth() && (
        canFinance()
        || ( !isPartner() && !isSecretary()
          && resource.data.get('requestedBy', '') == request.auth.uid
          && resource.data.get('status', '') == 'pending'
          && request.resource.data.get('status', '') in ['pending', 'cancelled']
          && request.resource.data.get('dept', '') == resource.data.get('dept', '') )
      );
      allow delete: if isAuth() && ( isPresident()
        || ( resource.data.get('requestedBy', '') == request.auth.uid
          && resource.data.get('status', '') == 'pending' ) );
    }
    match /dept_spend_logs/{docId} {
      allow read: if isAuth() && (canFinance() || isSecretary()
        || (!isPartner() && inDept(resource.data.get('dept', ''))));
      // Proof is REQUIRED at the boundary, not just in the form: at least one
      // attachment, or a typed no-receipt reason (owner: receipts or an
      // explicit, flagged excuse — a silently optional field means none).
      allow create: if isAuth()
        && (canFinance() || (!isPartner() && !isSecretary()
                             && inDept(request.resource.data.get('dept', ''))))
        && request.resource.data.get('loggedBy', '') == request.auth.uid
        && request.resource.data.get('status', '') == 'pending'
        && request.resource.data.get('dept', '') != ''
        && request.resource.data.get('releaseId', '') != ''
        && request.resource.data.get('amount', 0) is number
        && request.resource.data.get('amount', 0) > 0
        && ( request.resource.data.get('attachments', []).size() > 0
          || request.resource.data.get('noReceiptReason', '') != '' );
      // (a) Finance decides/settles — money tier, any field.
      // (b) The logger edits their own pending/rejected log and resubmits:
      //     status can only be 'pending' again, identity/dept keys frozen.
      allow update: if isAuth() && (
        canFinance()
        || ( !isPartner() && !isSecretary()
          && resource.data.get('loggedBy', '') == request.auth.uid
          && resource.data.get('status', '') in ['pending', 'rejected']
          && request.resource.data.get('status', '') == 'pending'
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(
               ['date','description','amount','budgetLineId','budgetLineName',
                'refNumber','attachments','noReceipt','noReceiptReason',
                'overspendAtLog','releaseId','releaseTitle','status','updatedAt'])
          && request.resource.data.get('amount', 0) is number
          && request.resource.data.get('amount', 0) > 0
          && ( request.resource.data.get('attachments', []).size() > 0
            || request.resource.data.get('noReceiptReason', '') != '' ) )
      );
      // Undecided → the logger may withdraw. Decided → President only (a
      // confirmed spend has ledger legs; those route via financeDelete).
      allow delete: if isAuth() && ( isPresident()
        || ( resource.data.get('loggedBy', '') == request.auth.uid
          && resource.data.get('status', '') == 'pending' ) );
    }
```

Notes for the implementer:
- `inDept()` (rules:179) already blocks the secretary from Finance/IT membership; the
  explicit `!isSecretary()` on WRITE legs extends the ruling to every dept (they keep
  read). Do not "simplify" it away.
- Deploy: `~/.npm-global/bin/firebase deploy --only firestore` (rules + indexes; the CLI
  is not on PATH — memory). **Re-run `git diff firestore.rules` immediately before
  deploying** — concurrent sessions edit this tree live, and a full-file deploy ships
  whatever is on disk (deploy-recheck memory).

---

## 10. firestore.indexes.json — new composite indexes

Equality + `orderBy` on a different field ⇒ composite. Add to the `"indexes"` array:

```json
{ "collectionGroup": "dept_budget_releases", "queryScope": "COLLECTION",
  "fields": [ { "fieldPath": "dept", "order": "ASCENDING" },
              { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
{ "collectionGroup": "dept_budget_requests", "queryScope": "COLLECTION",
  "fields": [ { "fieldPath": "dept", "order": "ASCENDING" },
              { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
{ "collectionGroup": "dept_budget_requests", "queryScope": "COLLECTION",
  "fields": [ { "fieldPath": "status", "order": "ASCENDING" },
              { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
{ "collectionGroup": "dept_spend_logs", "queryScope": "COLLECTION",
  "fields": [ { "fieldPath": "dept", "order": "ASCENDING" },
              { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
{ "collectionGroup": "dept_spend_logs", "queryScope": "COLLECTION",
  "fields": [ { "fieldPath": "status", "order": "ASCENDING" },
              { "fieldPath": "createdAt", "order": "ASCENDING" } ] },
{ "collectionGroup": "dept_spend_logs", "queryScope": "COLLECTION",
  "fields": [ { "fieldPath": "reimbStatus", "order": "ASCENDING" },
              { "fieldPath": "createdAt", "order": "ASCENDING" } ] },
{ "collectionGroup": "dept_spend_logs", "queryScope": "COLLECTION",
  "fields": [ { "fieldPath": "releaseId", "order": "ASCENDING" },
              { "fieldPath": "status", "order": "ASCENDING" } ] }
```

(The Approvals count query — `where('status','==','pending')` with no orderBy — needs no
composite.)

## 10b. storage.rules — one function edit

Attachments upload via `Drive.uploadFile(file, 'Finance', 'BudgetProofs')` →
`Finance/BudgetProofs/<ts>_<rand>_<name>`, covered by `/Finance/{subfolder}/{fileName}`
(storage.rules:281–288): internal staff create/read, overwrite/delete finance-only —
exactly the receipt semantics needed. One gap: the Corporate Secretary is excluded from
the Finance tree (`financeTreeOpenToCaller`, :278–279) but has oversight READ of the
queue docs — an unopenable receipt makes that oversight blind. Budget proofs are
operational records owned by other departments, the precise carve-out
`financeOperationalSubfolder` (:275–277) exists for. Change:

```
    function financeOperationalSubfolder(sub) {
      return sub == 'SalesOrders' || sub == 'Collections' || sub == 'BudgetProofs';
    }
```

**[OWNER — §13.7]** Deploy: `~/.npm-global/bin/firebase deploy --only storage` (re-diff
first, same concurrency rule as §9).

---

## 11. Notifications (all via existing `Notifs` API — notifications.js:519 `send(uid, {…})`, :598 `sendToDept(dept, {…})`; wrap in `.catch(()=>{})` like departments.js:4548)

| Event | Call | Payload |
|---|---|---|
| Release created | `sendToDept(dept, …)` | title `'💰 Budget released to <dept>'`, body float: `'₱<fmt(amount)> cash float — <title>. Custodian: <custodianName>.'` / ceiling: `'₱<fmt(amount)> spending limit — <title>. Pay first, then log receipts for reimbursement.'`, type `'budget_release'`, link `'dept:<dept>'` |
| Spend logged | `sendToDept('Finance', …)` | title `'💸 <dept> logged a spend'`, body `'<loggedByName>: <description> — ₱<fmtN2(amount)>'` + append `' · OVER BUDGET by ₱<x>'` when overspendAtLog + `' · NO RECEIPT'` when noReceipt, type `'budget_spend'`, link `'dept:Finance'` |
| Spend confirmed | `send(loggedBy, …)` | title `'✅ Spend confirmed'`, body `'<description> — ₱<fmtN2(amount)> is now in the books.'` + for a ceiling/payable portion `' Finance owes you ₱<fmt(reimbAmount)> — reimbursement is on its way.'`, type `'budget_spend_result'` |
| Spend rejected | `send(loggedBy, …)` | title `'❌ Spend rejected'`, body `'<description> — ₱<fmtN2(amount)>. Reason: <rejectReason>. Edit it and resubmit.'`, type `'budget_spend_result'`, link `'dept:<dept>'` |
| Budget requested | `sendToDept('Finance', …)` | title `'🙋 <dept> requests a budget'`, body `'<requestedByName>: <title> — ₱<fmtN2(amount)>'`, type `'budget_request'`, link `'dept:Finance'` |
| Request approved | `send(requestedBy, …)` | title `'✅ Budget request approved'`, body `'<title> — released as a <cash float/spending limit> of ₱<fmt(amount)>.'` |
| Request declined | `send(requestedBy, …)` | title `'❌ Budget request declined'`, body `'<title>: <reviewNote>'` |
| Reimbursement paid | `send(paidByUid, …)` | title `'💵 Reimbursement paid'`, body `'₱<fmt(reimbAmount)> for <description>.'` |

---

## 12. Complete file-by-file change list

| # | File | Change | Anchor |
|---|---|---|---|
| 1 | `js/departments.js` | Rewrite `renderBudgeting` per §6.1; delete the old direct-ledger Log Expense form (4458–4554); add `window.renderBudgeting = renderBudgeting;` | **ONLY 4318–4555** (contention §0) |
| 2 | `js/screens/dept-budgets.js` | NEW — §7 | new file |
| 3 | `js/config.js` | Add `'Budgeting'` to 8 subtab arrays | :249, :257, :269, :278, :282, :286, :292, :296 |
| 4 | `js/screens/finance.js` | `FINANCE_GROUPS` entry + `loadFinanceContent` case | :232–249, :385 |
| 5 | `js/screens/sales.js` | tab + case | :106, :155 |
| 6 | `js/screens/crm.js` | tab + case | :41, :64 |
| 7 | `js/screens/design.js` | tab + case | :60, :68 |
| 8 | `js/screens/govit.js` | IT: tabs (both ternary branches) + case; GovB: extra chip + `loadGov` branch | :180–182, :199; :127, :131 |
| 9 | `js/screens/production.js` | Production tab + case; Purchasing tab + case | :1139, :1163; :2110, :2127 |
| 10 | `js/screens/hr.js` | Budgeting card in `cards` | ~:425 (inside `renderHR`, :400) |
| 11 | `js/app.js` | Admin signpost row | `renderAdminDept`, ~:3255 |
| 12 | `js/screens/approvals.js` | count query + `pendingFinReqs` + link-out card | :157–172, :196, :202, finance-requests pane (~:939–1016) |
| 13 | `index.html` | script tag | after :658 (`js/screens/finance.js`) |
| 14 | `sw.js` | PRECACHE entry | after :82 (`'/js/screens/finance.js',`) |
| 15 | `firestore.rules` | 3 new blocks (§9) | after :2878 (`bank_accounts`) |
| 16 | `firestore.indexes.json` | 7 composites (§10) | `"indexes"` array |
| 17 | `storage.rules` | `financeOperationalSubfolder` + `'BudgetProofs'` | :275–277 |

Deploys after merge: `git push origin master` (app), `firebase deploy --only firestore`,
`firebase deploy --only storage` (CLI at `~/.npm-global/bin/firebase`; re-diff each rules
file immediately before deploying). `CACHE_VER` is bumped by the pre-commit hook — do not
hand-edit versions.

---

## 13. Owner decisions needed (do NOT guess these) + flagged judgement calls

1. **Ledger account bindings.** The spec needs three plain-word accounts: **"Cash Float —
   <Dept>"** (an asset — money a custodian owes back), **"Reimbursement Payable"** (a
   liability — money owed to a named person), and the existing **"<Dept> Expense"**
   category. Owner binds these to his chart of accounts; no codes invented.
2. **Reimbursement settlement path.** Implemented as Finance's own payment (§6.3d), NOT
   through payroll — payroll is being rebuilt concurrently and non-payroll money must not
   enter the pay run. Routing reimbursements through payroll later is a reasonable option
   and is the owner's call.
3. **Tax treatment of reimbursements** — none implemented, nothing invented. If employee
   reimbursements have any Philippine tax/BIR implication, that is a question for his
   accountant.
4. **Excluded departments.** Ventures (documentation-only by design), Brilliant Steel and
   Partners (external) get no Budgeting tab; Admin gets a signpost row. Confirm.
5. **Payee = logger.** v1 assumes the person who logs a spend is the person who paid
   (`paidBy == loggedBy`) — the rule is stated in the form copy. If someone else paid,
   they log it themselves. Confirm, or a payee picker gets added later.
6. **Who may release.** Releases are `canFinance()` (president/manager/finance role/
   Finance-dept staff). If the owner wants President-only above some amount, that is a
   later gate — flag, default as spec'd.
7. **Secretary receipt read.** `BudgetProofs` added to the Finance-tree operational
   carve-out so the secretary's oversight read can open receipts (§10b). Confirm.
8. **Concurrent-confirm float split.** Two Finance users confirming spends of the same
   float in the same instant could mis-split a payable portion (§5). Accepted for a 1–2
   person office; a rules/transaction hardening pass can follow if it ever matters.
9. **Dept income entries** are out of the department flow (Finance logs income directly).
   Confirm.

---

## 14. Verification checklist (pass/fail)

Run as a Marketing-department **employee** (non-finance) unless stated. "M-member" =
that account; "FIN" = a finance-role account; "SEC" = the Corporate Secretary.

1. FIN: Finance → Dept Budgets → Releases → release a **ceiling** of ₱10,000 to
   Marketing titled "Test ceiling". PASS: Marketing members receive the notification;
   **no new `/ledger` row exists** (check Finance → Money In/Out → Ledger).
2. FIN: release a **float** of ₱5,000 to Marketing, custodian = M-member, bank account
   picked. PASS: exactly one ledger row `DBR-<id>` (asset, Cash Float — Marketing,
   bankFlow out); tapping the release form's save twice (double-tap) still yields **one**
   row.
3. M-member: Marketing → Budgeting shows both releases with the float/ceiling badges and
   custodian line; KPI `Remaining` = ₱15,000; **no** "visible to Finance & Management"
   hint; no "—" placeholders anywhere.
4. M-member: Log a Spend of ₱2,000 on the ceiling **without** attaching a file and
   without the no-receipt reason. PASS: blocked with the attach-or-explain toast; the doc
   is NOT created (also verify a direct console `db.collection('dept_spend_logs').add`
   with no attachments/reason is **permission-denied** — the rule enforces proof).
5. M-member: same spend with a photo attached. PASS: appears instantly in Spend Log as
   `⏳ With Finance`; `Remaining` drops to ₱13,000 **before** any Finance action; Finance
   gets the 💸 notification; ledger still has no `DSP-` row.
6. M-member: log ₱4,500 against the ₱5,000 float, then another ₱1,000 against it. PASS:
   the second shows the red over-budget panel and the confirm dialog; after saving, the
   release card reads `OVER BY ₱500` in red and the Finance notification body contains
   `OVER BUDGET by ₱500`.
7. FIN: To Confirm lists all three, flags visible. Confirm the ceiling spend. PASS:
   ledger gains `DSP-<id>` (Marketing Expense, debit) AND `DSP-<id>-PAY` (Reimbursement
   Payable, credit, description names the person); the spend shows `reimbStatus 'owed'`;
   M-member's view flips it to `✓ Confirmed` and their notification mentions being owed
   ₱2,000. Re-tapping Confirm (or replaying it) creates **no additional rows**.
8. FIN: confirm the ₱4,500 float spend then the ₱1,000 one. PASS: first posts
   `DSP-…-FLT` ₱4,500 only; second posts `DSP-…-FLT` ₱500 + `DSP-…-PAY` ₱500 to the
   custodian; `release.confirmedTotal` = 5,500.
9. FIN: Reject a fresh pending spend with a reason. PASS: no ledger rows; M-member sees
   `✕ Rejected` + reason + `[Edit & resubmit]`; resubmitting returns it to `⏳` and
   remaining reflects it again.
10. FIN: Reimbursements tab groups the two payables by person with subtotals; Mark paid
    on one. PASS: ledger gains `DRP-<id>` (liability debit, bankFlow out);
    `reimbStatus 'paid'`; payee notified; double-tap posts once.
11. FIN: Close the float. PASS: blocked while a pending spend exists (message names the
    count); after deciding it, close shows balance ₱0 / owed ₱500 and closes without a
    `DBC-` row (nothing to return); a second float closed with unspent balance posts
    exactly one `DBC-<id>` with bankFlow 'in'.
12. M-member: Request a Budget with an attachment. FIN: Requests tab → Approve. PASS:
    the release form opens **prefilled** with dept/title/amount (nothing re-typed);
    saving marks the request `approved` and links `releaseId`; requester notified.
13. Cross-dept isolation: a Sales-only member runs
    `db.collection('dept_spend_logs').where('dept','==','Marketing').get()` in the
    console. PASS: permission-denied; their own Sales → Budgeting works.
14. SEC: can open a department's Budgeting view and the Approvals finance-requests pane
    (sees the 💸 count card and can open a receipt link), but the Log/Request buttons are
    absent, and console writes to any of the three collections are permission-denied.
15. Partner account: all three collections unreadable (console get → permission-denied).
16. Every department in §8's table shows its Budgeting entry (chip/card/row), and a dept
    with no data renders the "No budget yet." empty state with a working Request button —
    check at 375px width: no horizontal scroll, peso figures fully visible.
17. Approvals (president): the finance-requests chip count includes pending dept spends;
    the pane's `[Open Dept Budgets]` lands on the Finance surface.
18. `ledgerKind` labeling: in the Budgeting ledger table (finance view), the
    float/payable legs read `Float`/`Payable`, not `Income`.
19. Period close: close the current finance period, then try confirming a pending spend
    dated in it. PASS: blocked with the reopen-or-redate message; the spend stays
    pending; reopening lets it through.
20. Console shows no errors on: fresh reload → each rolled-out department → Budgeting →
    open and cancel each form (the ~300ms `openPage` overlap race: open Log a Spend,
    close, immediately reopen and save — the saved values are the SECOND form's).
